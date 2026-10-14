"""The live lane's loop (run_ingest.live_keeper) with several games at once, against fakes - no network, no database.

    python scripts/ingest/lane_pool_test.py

Eight live games on a league's own back end, each write taking 0.3 s. One at a time that pass is 2.4 s and grows
with every game (35 on 14 Oct 2026: two minutes, games read every 92-145 s). The pool must write them together,
each exactly once, never one game in two workers at once; and EPINOIA_LANE_THREADS=1 must still be the old loop.
"""
import argparse
import os
import sys
import threading
import time

os.environ["EPINOIA_OBSERVER"] = "0"        # the off-CDN path: every game read by its adapter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_ingest as R  # noqa: E402
from adapters.base import GameBundle  # noqa: E402

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

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
