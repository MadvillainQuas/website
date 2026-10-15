"""The live lane's loop (run_ingest.live_keeper) with several games at once, against fakes - no network, no database.

    python scripts/ingest/lane_pool_test.py

Eight live games on a league's own back end, each write taking 0.3 s. One at a time that pass is 2.4 s and grows
with every game (35 on 14 Oct 2026: two minutes, games read every 92-145 s). The pool must write them together,
each exactly once, never one game in two workers at once; and EPINOIA_LANE_THREADS=1 must still be the old loop.
"""
import argparse
import os
import sys
import tempfile
import threading
import time

os.environ["EPINOIA_OBSERVER"] = "0"        # the off-CDN path: every game read by its adapter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_ingest as R  # noqa: E402
from adapters.base import GameBundle  # noqa: E402

# NEVER THE REAL WAIT FILE: live_lane.bat reads %TEMP%\epinoia_live_wait when the lane exits, and a test pass that
# ends with "nothing near" writes four hours there (14 Oct 2026: the PC's lane slept 4 h after this test ran)
R.LIVE_WAIT_FILE = os.path.join(tempfile.mkdtemp(prefix="lane_pool_test_"), "epinoia_live_wait")

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1; print("  PASS  " + what)
    else:
        FAIL += 1; print("  FAIL  " + what + ("" if saw is None else f"  -- saw {saw!r}"))


GAMES = [f"E2026_{n}" for n in range(1, 9)]


class FakeAdapter:
    def fetch(self, xid, cfg):
        return GameBundle(external_id=xid, status="final", home_name="Home " + xid, away_name="Away " + xid,
                          tipoff_at="2026-10-14T18:00:00+00:00", team={"home": {"points": 80}, "away": {"points": 70}},
                          box={"home": [], "away": []}, stints=[], payload_hash="h-" + xid, raw={})


class FakeSb:
    def select(self, *a, **k):
        return []

    def patch(self, *a, **k):
        return []

    def insert(self, *a, **k):
        return []

    def upsert(self, *a, **k):
        return []


def run(threads):
    R.LANE_THREADS = threads
    state = {"now": 0, "max": 0, "writes": [], "dup": False, "calls": 0}
    lock = threading.Lock()
    busy = set()

    def write_platform(sb, src, b, run_, observed=None, memory=None, venue=None, **k):
        with lock:
            if b.external_id in busy:
                state["dup"] = True
            busy.add(b.external_id)
            state["now"] += 1; state["max"] = max(state["max"], state["now"])
        time.sleep(0.3)
        with lock:
            state["now"] -= 1; busy.discard(b.external_id); state["writes"].append(b.external_id)
        return True

    def live_due(sb, fiba, now):
        state["calls"] += 1
        if state["calls"] == 1:
            return [(fiba[0], {"external_id": x, "home_name": "H", "away_name": "A", "tipoff_at": "2026-10-14T18:00:00+00:00",
                               "external_status": "live"}) for x in GAMES], None
        return [], None

    R.claim_live_lane = lambda: True
    R.live_due = live_due
    R.playing_today = lambda *a, **k: []
    R.version_in_db = lambda *a, **k: False
    R.write_supabase_feed = lambda *a, **k: None
    R.write_platform = write_platform
    R.flush_refresh = lambda *a, **k: 0
    R.console_kick.kick = lambda sb: ""
    R.console_kick.mail_cadence = lambda: ""
    R.get_adapter = lambda name: FakeAdapter()
    src = {"code": "EL", "adapter": "euroleague", "adapter_config": {}, "id": None}
    args = argparse.Namespace(live_loop=60, live_every=20, broadcast_every=2, shard=None, dry_run=False)
    t0 = time.time()
    code, _ = R.live_keeper(FakeSb(), [src], args)
    return state, time.time() - t0, code


print("\n-- the pool")
st, took, code = run(6)
ok("every game written exactly once", sorted(st["writes"]) == sorted(GAMES), st["writes"])
ok("several at once (up to the pool's six)", 2 <= st["max"] <= 6, st["max"])
ok("never one game in two workers at once", not st["dup"])
ok(f"the pass took {took:.1f} s, not the 2.4 s of eight writes one after another", took < 1.8, took)
ok("a clean pass", code == 0, code)

print("\n-- EPINOIA_LANE_THREADS=1: one at a time, as before")
st1, took1, code1 = run(1)
ok("every game written exactly once", sorted(st1["writes"]) == sorted(GAMES), st1["writes"])
ok("one at a time", st1["max"] == 1, st1["max"])
ok("...in the order they came due", st1["writes"] == GAMES, st1["writes"])

print("\n-- with FIBA's CDN games on the observer: one thread inside it at a time")
import feed_observer  # noqa: E402


class Snap:
    def __init__(self, xid):
        self.version, self.raw, self.lm_ms, self.recv_ms = 1, {"x": xid}, 1, 1
        self.stamp_ms, self.fetch_ms, self.changed_at_ms = 1, 5, int(time.time() * 1000)


class FakeObserver:
    inside, overlap, polls, took = 0, False, 0, []

    def __init__(self, *a, **k):
        self.st = {}

    def _in(self):
        FakeObserver.inside += 1
        if FakeObserver.inside > 1:
            FakeObserver.overlap = True
        time.sleep(0.01)
        FakeObserver.inside -= 1

    def observe_due(self, xids, every, armed=(), fast=2):
        self._in(); FakeObserver.polls += 1
        return len(xids)

    def take(self, xid):
        self._in(); FakeObserver.took.append(xid)
        return Snap(xid)

    def stamps(self, xid):
        self._in(); return None

    def forget(self, xid):
        self._in()

    def stats(self, xid):
        self._in()
        return {"polls": 1, "share304": 0, "max_poll_gap_ms": 0, "gaps_over_25s": 0, "gaps": 0, "versions": 1, "older": 0,
                "errors": 0, "stamped": 0, "late": 0, "contra": 0}


class CdnAdapter(FakeAdapter):
    def bundle_from_raw(self, raw, xid, cfg):
        return self.fetch(xid, cfg)


os.environ.pop("EPINOIA_OBSERVER")
feed_observer.FeedObserver = FakeObserver
CDN = [str(2900000 + n) for n in range(1, 7)]


def run_cdn():
    R.LANE_THREADS = 6
    writes, lock = [], threading.Lock()

    def write_platform(sb, src, b, run_, observed=None, memory=None, venue=None, **k):
        time.sleep(1.5)          # long enough for the main thread to look at the CDN while they run
        with lock:
            writes.append(b.external_id)
        return True

    calls = {"n": 0}

    def live_due(sb, fiba, now):
        calls["n"] += 1
        if calls["n"] == 1:
            return [(fiba[0], {"external_id": x, "home_name": "H", "away_name": "A", "tipoff_at": "2026-10-14T18:00:00+00:00",
                               "external_status": "live"}) for x in CDN], None
        return [], None

    R.live_due, R.write_platform, R.get_adapter = live_due, write_platform, (lambda name: CdnAdapter())
    src = {"code": "FIBA", "adapter": "fiba_livestats", "adapter_config": {}, "id": None}
    R.live_keeper(FakeSb(), [src], argparse.Namespace(live_loop=60, live_every=20, broadcast_every=2, shard=None, dry_run=False))
    return writes


w = run_cdn()
ok("every CDN game taken from the observer and written once", sorted(w) == sorted(CDN), w)
ok("never two threads inside the observer at once", not FakeObserver.overlap)
ok("...and it kept looking at the CDN while the writes ran", FakeObserver.polls >= 2, FakeObserver.polls)

print("\n-- live on demand (0264, NCAA D2): the full game only while watched, and at the final whistle")


class OnDemand(FakeAdapter):
    """A watched game B, an unwatched live game A (final on its second scoreboard read), a game C already final."""
    def __init__(self):
        self.reads = {"A": 0}
        self.fetched = []

    def scoreline(self, xid, cfg):
        if xid == "A":
            self.reads["A"] += 1
            st = "live" if self.reads["A"] == 1 else "final"
            return {"status": st, "period": 2, "clock_ms": 461000, "running": True, "home": 50, "away": 48}
        if xid == "C":
            return {"status": "final", "period": 2, "clock_ms": 0, "running": False, "home": 70, "away": 60}
        return {"status": "live", "period": 1, "clock_ms": 600000, "running": True, "home": 10, "away": 12}

    def fetch(self, xid, cfg):
        self.fetched.append(xid)
        return super().fetch(xid, cfg)


class OdSb(FakeSb):
    def __init__(self):
        self.state, self.patches, self.watch_asked = [], [], 0

    def select(self, table, q):
        if table == "game_watch":
            self.watch_asked += 1
            return [{"game_id": "gB"}]
        return []

    def upsert(self, table, rows, *a, **k):
        if table == "game_state":
            self.state.append(rows)
        return []

    def patch(self, table, q, body):
        self.patches.append((table, q, body))
        return []


def run_od():
    R.LANE_THREADS, R.INLINE_EVERY_S = 1, 1
    od, sb = OnDemand(), OdSb()
    writes = []
    calls = {"n": 0}

    def live_due(sb_, fiba, now):
        calls["n"] += 1
        if calls["n"] == 1:
            return [(fiba[0], {"external_id": x, "game_id": "g" + x, "home_name": "H", "away_name": "A",
                               "tipoff_at": "2026-11-14T00:00:00+00:00", "external_status": "live"}) for x in ("A", "B", "C")], None
        return [], None

    R.live_due, R.get_adapter = live_due, (lambda name: od)
    R.write_platform = lambda sb_, src, b, run_, observed=None, memory=None, venue=None, **k: writes.append(b.external_id) or True
    src = {"code": "NCAA_D2M", "adapter": "ncaa", "id": None, "adapter_config": {"live_on_demand": True, "sport": "MBB", "division": 2}}
    R.live_keeper(sb, [src], argparse.Namespace(live_loop=60, live_every=1, broadcast_every=2, shard=None, dry_run=False))
    return od, sb, writes


od, osb, ow = run_od()
ok("the watched game (B) is read and written in full, as any league's live game", "B" in od.fetched and "B" in ow, (od.fetched, ow))
ok("the game at its final whistle (C) is read and written in full", "C" in od.fetched and "C" in ow)
ok("the unwatched live game (A): its scoreboard line only - game_state, and its going live - no full read while live",
   any(r.get("game_id") == "gA" and r.get("score_home") == 50 for r in osb.state)
   and any(t == "games" and "gA" in q and b.get("status") == "live" for t, q, b in osb.patches)
   and od.fetched.index("A") > 0 if "A" in od.fetched else False, (od.fetched, osb.state, osb.patches))
ok("...then, at its final whistle, the whole game - so every player's line is in the season", "A" in ow and od.reads["A"] >= 2)
ok("which games are watched is one read a pass, not one a game", 1 <= osb.watch_asked <= 3, osb.watch_asked)

print("\n-- the same for U SPORTS (0268): the real adapter's scoreboard, its RSS as captured on 15 Oct 2026")
import gzip  # noqa: E402
from adapters import usports as U  # noqa: E402


class UsOffline(U.USportsAdapter):
    """The real scoreline over the captured RSS; fetch() records the full reads (the game pages are usports_test's)."""
    def __init__(self):
        self.fetched, self.asked = [], []

    def _get_text(self, url, encoding="utf-8", max_wait_s=U.WAF_MAX_WAIT_S):
        self.asked.append(url.replace(U.SITE, ""))
        if url.endswith("/2026-27/schedule?print=rss"):
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "usports", "rss-2026-27.xml.gz")
            with gzip.open(path, "rb") as f:
                return f.read().decode(encoding)
        return None

    def fetch(self, xid, cfg):
        self.fetched.append(xid)
        return FakeAdapter().fetch(xid, cfg)


class UsSb(OdSb):
    def select(self, table, q):
        if table == "game_watch":
            self.watch_asked += 1
            return [{"game_id": "g-watched"}]
        return []


def run_usports():
    R.LANE_THREADS, R.INLINE_EVERY_S = 1, 1
    U.USportsAdapter._boards, U.USportsAdapter._board_failed, U.USportsAdapter._line_of = {}, {}, {}
    us, sb = UsOffline(), UsSb()
    writes, calls = [], {"n": 0}
    games = {"u8xvsotcgoe6c0oq": "g-ubc", "86e2admlqeh3z8ki": "g-regina", "b1dmftofcla57yza": "g-dal",
             "htux65qsp51neg0g": "g-watched"}

    def live_due(sb_, fiba, now):
        calls["n"] += 1
        if calls["n"] == 1:
            return [(fiba[0], {"external_id": x, "game_id": g, "home_name": "H", "away_name": "A",
                               "tipoff_at": "2026-10-15T20:30:00+00:00", "external_status": "live"}) for x, g in games.items()], None
        return [], None

    R.live_due, R.get_adapter = live_due, (lambda name: us)
    R.write_platform = lambda sb_, src, b, run_, observed=None, memory=None, venue=None, **k: writes.append(b.external_id) or True
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "config", "ingest-sources.json"), encoding="utf-8") as f:
        import json
        src = dict(next(s for s in json.load(f)["sources"] if s.get("adapter") == "usports"), id=None)
    R.live_keeper(sb, [src], argparse.Namespace(live_loop=60, live_every=1, broadcast_every=2, shard=None, dry_run=False))
    return us, sb, writes


us, usb, uw = run_usports()
ok("UBC at Windsor, live and unwatched: its scoreboard line only - Windsor (home) 34, UBC 48, 2nd quarter 0:45 - and "
   "its going live; never read in full",
   any(r.get("game_id") == "g-ubc" and (r.get("score_home"), r.get("score_away"), r.get("period"), r.get("clock_ms"))
       == (34, 48, 2, 45000) for r in usb.state)
   and any(t == "games" and "g-ubc" in q and b.get("status") == "live" for t, q, b in usb.patches)
   and "u8xvsotcgoe6c0oq" not in us.fetched, (us.fetched, usb.state))
ok("Regina at Brandon, 'End of 4th' 88-85: the final whistle - read and written in full",
   "86e2admlqeh3z8ki" in us.fetched and "86e2admlqeh3z8ki" in uw, (us.fetched, uw))
ok("Dalhousie at Waterloo, not started on the scoreboard: nothing read, nothing written",
   "b1dmftofcla57yza" not in us.fetched and not any(r.get("game_id") == "g-dal" for r in usb.state))
ok("the game somebody has open: read and written in full, as any league's live game",
   "htux65qsp51neg0g" in us.fetched and "htux65qsp51neg0g" in uw, (us.fetched, uw))
ok("the whole evening from the season's RSS: one scoreboard request a minute, however many games",
   us.asked.count("/sports/mbkb/2026-27/schedule?print=rss") == 1, us.asked)

print("\n-- a final the feed has and the platform never closed: read again in full, a few times a pass (14 Oct 2026)")


class Settle(FakeAdapter):
    """L is live all pass (it keeps the loop going); S and K are final on their feed rows and still open here."""
    def fetch(self, xid, cfg):
        b = super().fetch(xid, cfg)
        if xid == "L":
            b.status = "live"
        return b


def run_settle():
    R.LANE_THREADS, R.INLINE_EVERY_S, R.LIVE_RECHECK_S = 1, 1, 0.5
    writes, asked, closed, calls = [], {"n": 0}, set(), {"n": 0}
    final_row = {"home_name": "H", "away_name": "A", "tipoff_at": "2026-10-14T16:00:00+00:00", "external_status": "final",
                 "payload_hash": "stored-by-the-other-lane"}

    def live_due(sb_, fiba, now):
        calls["n"] += 1
        if calls["n"] <= 6:
            return [(fiba[0], {"external_id": "L", "game_id": "gL", "home_name": "H", "away_name": "A",
                               "tipoff_at": "2026-10-14T19:00:00+00:00", "external_status": "live"})], None
        return [], None

    def unsettled_due(sb_, fiba, now):
        asked["n"] += 1
        return [(fiba[0], dict(final_row, external_id=x, game_id="g" + x)) for x in ("S", "K") if x not in closed]

    def write_platform(sb_, src, b, run_, observed=None, memory=None, venue=None, **k):
        writes.append(b.external_id)
        if b.external_id == "S" and writes.count("S") == 2:
            closed.add("S")                       # finalise-game lands on the second try
        return True

    R.live_due, R.unsettled_due, R.write_platform = live_due, unsettled_due, write_platform
    R.version_in_db = lambda *a, **k: True        # the feed row already holds each version: "another lane got there"
    R.get_adapter = lambda name: Settle()
    src = {"code": "EC", "adapter": "euroleague", "adapter_config": {}, "id": None}
    R.live_keeper(FakeSb(), [src], argparse.Namespace(live_loop=60, live_every=1, broadcast_every=2, shard=None, dry_run=False))
    return writes, asked["n"]


sw, s_asked = run_settle()
ok("a final never closed is written through, though the feed row already holds its version", "S" in sw and "K" in sw, sw)
ok("...again on the next recheck until it closes (S: twice), then no more", sw.count("S") == 2, sw)
ok(f"...and one that never closes is read {R.SETTLE_TRIES} times a pass, then left to the catch-up",
   sw.count("K") == R.SETTLE_TRIES, sw)
ok("the live game that kept the pass going is not written over a version the database holds", "L" not in sw, sw)
ok("the open finals are one read a recheck", s_asked >= R.SETTLE_TRIES + 1, s_asked)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
