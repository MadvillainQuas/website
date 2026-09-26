"""The ingest asks the database only what it needs - no live Supabase, no network:
python scripts/ingest/quiet_test.py

THE NIGHTS THIS PINS. On 24 and 25 Sep 2026 the database stopped answering from ~23:40 UTC for an
hour or more, after a day of the ingest re-reading and rewriting everything it held: every source's
whole season read every two minutes of a live pass to find the two games near tip-off; every
fixture read twice and upserted on every half-hourly discovery pass; every fixture PATCHed because
"...Z" never equalled the stored "...+00:00"; eleven finished Czech games fully rewritten on every
catch-up. These checks hold the replacements to the answers the old code gave, on the same data.

The database is a small in-memory stand-in that evaluates the PostgREST filters these queries use
(eq, neq, gt, gte, lte, in, not.in, is.null, or/and trees, order, limit), so the old per-source
queries and the new bulk ones are answered from the same rows by the same rules.
"""
import os
import random
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_ingest as RI  # noqa: E402
from adapters.base import GameBundle, ScheduleGame  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


# ------------------------------------------------------------------ a PostgREST stand-in
def _split(s):
    """Split on top-level commas (not inside parentheses or double quotes)."""
    out, depth, q, cur = [], 0, False, ""
    for ch in s:
        if ch == '"':
            q = not q
        if not q and ch == "(":
            depth += 1
        if not q and ch == ")":
            depth -= 1
        if ch == "," and depth == 0 and not q:
            out.append(cur); cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def _val(v):
    return v[1:-1] if len(v) >= 2 and v[0] == '"' and v[-1] == '"' else v


def _cmp_key(col, v):
    if v is None:
        return None
    if col.endswith("_at"):
        return RI._instant(v)
    return str(v)


def _test(row, col, op, val):
    have = row.get(col)
    if op == "is":
        return (have is None) if val == "null" else (have is not None)
    if op in ("in", "not.in"):
        items = [_val(x) for x in _split(val[1:-1])] if val else []
        if have is None:
            return False
        inside = str(have) in items
        return inside if op == "in" else not inside
    if have is None:
        return False                      # SQL: a comparison with NULL is never true
    a, b = _cmp_key(col, have), _cmp_key(col, _val(val))
    return {"eq": a == b, "neq": a != b, "gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]


def _tree(row, expr, conj):
    parts = _split(expr)
    res = []
    for p in parts:
        m = re.match(r"^(and|or)\((.*)\)$", p)
        if m:
            res.append(_tree(row, m.group(2), m.group(1)))
            continue
        col, rest = p.split(".", 1)
        if rest.startswith("not.in."):
            op, val = "not.in", rest[len("not.in."):]
        else:
            op, val = rest.split(".", 1)
        res.append(_test(row, col, op, val))
    return all(res) if conj == "and" else any(res)


class FakeSB:
    def __init__(self, tables):
        self.t = tables
        self.calls = []

    def select(self, table, query):
        self.calls.append(("GET", table, query))
        rows = list(self.t.get(table, []))
        order = limit = None
        cols = None
        for part in query.split("&"):
            k, _, v = part.partition("=")
            if k == "select":
                cols = v
            elif k == "order":
                order = v
            elif k == "limit":
                limit = int(v)
            elif k == "or":
                rows = [r for r in rows if _tree(r, v[1:-1], "or")]
            else:
                if v.startswith("not.in."):
                    op, val = "not.in", v[len("not.in."):]
                else:
                    op, val = v.split(".", 1)
                rows = [r for r in rows if _test(r, k, op, val)]
        if order:
            col, direction = order.split(".")[:2]
            big = datetime.max.replace(tzinfo=timezone.utc)
            rows.sort(key=lambda r: _cmp_key(col, r.get(col)) or big, reverse=(direction == "desc"))
        if limit is not None:
            rows = rows[:limit]
        return [dict(r) for r in rows]

    def patch(self, table, query, body):
        self.calls.append(("PATCH", table, query, body)); return []

    def upsert(self, table, rows, on_conflict):
        self.calls.append(("UPSERT", table, rows)); return [{"id": "new-game"}]

    def insert(self, table, rows):
        self.calls.append(("INSERT", table, rows)); return True

    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


# ------------------------------------------------------------------ the code this replaced
def old_live_due(sb, sources, now):
    due, next_tip = [], None
    for src in sources:
        rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final"
                                           "&select=external_id,external_status,tipoff_at,game_date,home_name,away_name,payload_hash,game_id")
        today = now.date().isoformat(); yday = (now - timedelta(days=1)).date().isoformat()
        for r in rows:
            t = RI._tip(r); since = (now - t).total_seconds() if t else None
            recent = (since is not None and since < RI.LIVE_STALE) or (since is None and r.get("game_date") in (today, yday))
            if r.get("external_status") == "live" and recent:
                due.append((src, r))
            elif since is not None and -RI.LIVE_BEFORE_TIP <= since < RI.LIVE_AFTER_TIP:
                due.append((src, r))
            elif since is not None and since < -RI.LIVE_BEFORE_TIP and (next_tip is None or t < next_tip):
                next_tip = t
    return due, next_tip


def old_outstanding_rows(sb, src, now):
    rows = sb.select("external_games", f"adapter=eq.{src['adapter']}&competition_code=eq.{src['code']}&external_status=neq.final"
                                       "&select=external_id,external_status,tipoff_at,home_name,away_name")
    out = []
    for r in rows:
        t = RI._tip(r)
        if t is None:
            continue
        since = (now - t).total_seconds()
        if RI.LIVE_AFTER_TIP <= since < RI.OUTSTANDING_MAX_AGE:
            out.append(r)
    return out


# ------------------------------------------------------------------ same_instant / fixture_changed
print("-- a timestamp is a moment, not a spelling")
ok("'...Z' and '...+00:00' are the same moment", RI.same_instant("2026-10-04T17:00:00Z", "2026-10-04T17:00:00+00:00"))
ok("...and so is +02:00 two hours earlier", RI.same_instant("2026-10-04T17:00:00Z", "2026-10-04T19:00:00+02:00"))
ok("a minute apart is not", not RI.same_instant("2026-10-04T17:00:00Z", "2026-10-04T17:01:00+00:00"))
ok("nothing equals nothing, and not a time", RI.same_instant(None, "") and not RI.same_instant(None, "2026-10-04T17:00:00Z"))

stored = {"external_id": "7", "home_name": "Alba", "away_name": "Bayern", "external_status": "scheduled",
          "tipoff_at": "2026-10-04T17:00:00+00:00", "game_date": "2026-10-04"}
g = ScheduleGame(external_id="7", home_name="Alba", away_name="Bayern", tipoff_at="2026-10-04T17:00:00Z", status="scheduled")
ok("a fixture the schedule repeats word for word is unchanged", not RI.fixture_changed(stored, g))
ok("...a tip-off moved an hour is a change", RI.fixture_changed(stored, ScheduleGame(external_id="7", home_name="Alba", away_name="Bayern",
                                                                                     tipoff_at="2026-10-04T18:00:00Z", status="scheduled")))
ok("...a club the schedule now names differently is a change", RI.fixture_changed(stored, ScheduleGame(external_id="7", home_name="ALBA Berlin",
                                                                                                    away_name="Bayern", tipoff_at="2026-10-04T17:00:00Z")))
ok("...a fixture never stored is new", RI.fixture_changed(None, g))

# ------------------------------------------------------------------ live_due / outstanding, old vs new
print("-- the live lane's two bulk reads give the answers the per-league reads gave")
rng = random.Random(20260925)
now = datetime(2026, 9, 25, 1, 7, 33, 481000, tzinfo=timezone.utc)
codes = [("fiba_livestats", c) for c in ("SLB", "SLBW", "BCB", "CIBA", "WBBL")] + [("euroleague", "EL"), ("euroleague", "EC"),
         ("fiba_site_schedule", "CBFFE"), ("fiba_site_schedule", "SBA"), ("bleague", "BLJ")]
rows = []
for n in range(900):
    ad, code = rng.choice(codes)
    tip = None if rng.random() < 0.08 else now + timedelta(seconds=rng.randint(-10 * 86400, 10 * 86400) // 60 * 60)
    tip_s = None if tip is None else (tip.strftime("%Y-%m-%dT%H:%M:%S+00:00") if rng.random() < 0.5 else tip.strftime("%Y-%m-%dT%H:%M:%SZ"))
    gd = (tip.date().isoformat() if tip else rng.choice([now.date().isoformat(), (now - timedelta(days=1)).date().isoformat(), "2026-09-01", None]))
    rows.append({"adapter": ad, "competition_code": code, "external_id": str(100000 + n),
                 "external_status": rng.choice(["scheduled", "scheduled", "live", "final", "final", None]),
                 "tipoff_at": tip_s, "game_date": gd, "home_name": "H%d" % n, "away_name": "A%d" % n,
                 "payload_hash": rng.choice(["", "h%d" % n]), "game_id": rng.choice([None, "g%d" % n])})
# a few on the edges of every window, to the second
for i, secs in enumerate((RI.LIVE_BEFORE_TIP, RI.LIVE_BEFORE_TIP + 1, -RI.LIVE_AFTER_TIP, -RI.LIVE_AFTER_TIP + 1, -RI.LIVE_STALE,
                          -RI.LIVE_STALE + 1, -RI.OUTSTANDING_MAX_AGE, -RI.OUTSTANDING_MAX_AGE + 1)):
    for st in ("scheduled", "live"):
        t = (now + timedelta(seconds=secs)).replace(microsecond=0)
        rows.append({"adapter": "fiba_livestats", "competition_code": "SLB", "external_id": "edge%d%s" % (i, st), "external_status": st,
                     "tipoff_at": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "game_date": t.date().isoformat(), "home_name": "E", "away_name": "E",
                     "payload_hash": "", "game_id": None})
# rows under a code we read, but another adapter's - no source of ours; they must never be answered
for i in range(40):
    t = now + timedelta(minutes=rng.randint(-300, 600))
    rows.append({"adapter": "euroleague", "competition_code": "SLB", "external_id": "x%d" % i, "external_status": rng.choice(["scheduled", "live"]),
                 "tipoff_at": t.strftime("%Y-%m-%dT%H:%M:00Z"), "game_date": t.date().isoformat(), "home_name": "X", "away_name": "X",
                 "payload_hash": "", "game_id": None})
sources = [{"adapter": a, "code": c, "label": c} for a, c in codes] + [{"adapter": "fiba_livestats", "code": "SLB", "label": "SLB cup"},
                                                                       {"adapter": "fiba_livestats", "code": "NOROWS", "label": "empty"}]
db = FakeSB({"external_games": rows})
old_due, old_next = old_live_due(db, sources, now)
n_old = len(db.calls); db.calls.clear()
new_due, new_next = RI.live_due(db, sources, now)
n_new = len(db.calls)
key = lambda due: [(s["label"], r["external_id"]) for s, r in due]  # noqa: E731
ok("the same games are due, in the same order (%d of them)" % len(old_due), key(old_due) == key(new_due),
   (len(old_due), len(new_due), sorted(set(key(old_due)) ^ set(key(new_due)))[:6]))
ok("the same next tip-off (%s)" % old_next, old_next == new_next, (old_next, new_next))
ok("...in %d requests instead of %d" % (n_new, n_old), n_new <= 8 < n_old, (n_new, n_old))
db.calls.clear()
RI.live_due(db, sources, now)
sent = sum(len(FakeSB({"external_games": rows}).select("external_games", c[2])) for c in db.calls)
notfinal = sum(1 for r in rows if r["external_status"] not in ("final", None))
ok("...and the database sends back %d rows instead of every not-final row of every season (%d)" % (sent, notfinal),
   sent < notfinal / 2, (sent, notfinal))

db.calls.clear()
new_out = RI.outstanding_by_source(db, sources, now)
n_new = len(db.calls)
same = all(sorted(r["external_id"] for r in old_outstanding_rows(FakeSB({"external_games": rows}), s, now))
           == sorted(r["external_id"] for r in new_out.get((s["adapter"], s["code"]), [])) for s in sources)
ok("catch-up finds the same outstanding games for every source", same)
ok("...in %d requests for %d sources" % (n_new, len(sources)), n_new <= 4, n_new)

# ------------------------------------------------------------------ write_fixture: a peek, not a rewrite
print("-- a fixture the schedule has not changed costs no request at all")


class FakePlat:
    def team(self, league_id, t):
        return {"id": "t-" + (t.get("code") or t.get("name") or ""), "name": t.get("name")}


RI.source_competition = lambda sb, plat, src, league_id, ac: {"id": "comp1"}
src = {"adapter": "fiba_livestats", "code": "SLB", "label": "SLB", "league_id": "lg1"}
run = {"_platform": FakePlat()}
ext = {"external_id": "7", "game_id": "g7", "home_name": "Alba", "away_name": "Bayern", "external_status": "scheduled",
       "tipoff_at": "2026-10-04T17:00:00+00:00", "game_date": "2026-10-04"}
pre_games = {"g7": {"id": "g7", "status": "scheduled", "tipoff_at": "2026-10-04T17:00:00+00:00", "venue": "Uber Arena"}}
db = FakeSB({})
RI.write_fixture(db, src, ScheduleGame(external_id="7", home_name="Alba", away_name="Bayern", tipoff_at="2026-10-04T17:00:00Z",
                                       extra={"venue": "Uber Arena"}), run, pre={"ext": ext, "games": pre_games})
ok("unchanged fixture, '...Z' against the stored '...+00:00': no read, no write", db.calls == [], db.calls)
db = FakeSB({})
RI.write_fixture(db, src, ScheduleGame(external_id="7", home_name="Alba", away_name="Bayern", tipoff_at="2026-10-04T18:30:00Z",
                                       extra={"venue": "Uber Arena"}), run, pre={"ext": ext, "games": pre_games})
ok("a tip-off that moved: exactly one PATCH of the game", [c[:2] for c in db.calls] == [("PATCH", "games")], db.calls)
db = FakeSB({})
RI.write_fixture(db, src, ScheduleGame(external_id="7", home_name="Alba", away_name="Bayern", tipoff_at="2026-10-04T18:30:00Z"),
                 run, pre={"ext": ext, "games": {"g7": dict(pre_games["g7"], status="final")}})
ok("a FINISHED game is never touched from the schedule, whatever it says", db.writes() == [], db.writes())
db = FakeSB({"external_games": [dict(ext, adapter="fiba_livestats", competition_code="OTHER")]})
RI.write_fixture(db, src, ScheduleGame(external_id="7", home_name="Alba", away_name="Bayern", tipoff_at="2026-10-04T17:00:00Z"),
                 run, pre={"ext": None, "games": {}})
ok("a fixture stored under another source's code is still found (one read), never created twice",
   not any(c[0] == "UPSERT" and c[1] == "games" for c in db.calls) and any(c[1] == "external_games" for c in db.calls), db.calls)

# ------------------------------------------------------------------ lanes, videos, the Czech id
print("-- a version another lane already wrote is not written again")
b = GameBundle(external_id="99", status="live", home_name="A", away_name="B", tipoff_at=None, team={}, box={}, stints=[])
b.payload_hash = "abc"
db = FakeSB({"external_games": [{"adapter": "fiba_livestats", "external_id": "99", "payload_hash": "abc", "external_status": "live"}]})
ok("same payload, same status: skip", RI.version_in_db(db, {"adapter": "fiba_livestats"}, "99", b))
b.status = "final"
ok("same payload but now final (the stale-final rule): write", not RI.version_in_db(db, {"adapter": "fiba_livestats"}, "99", b))
b.status, b.payload_hash = "live", "new"
ok("a new payload: write", not RI.version_in_db(db, {"adapter": "fiba_livestats"}, "99", b))

print("-- a game the feed calls final that the platform never closed is found, and written again")


class _StuckSB:
    def __init__(self, rows=None, boom=False):
        self.rows, self.boom, self.q = rows or [], boom, None

    def select(self, table, query):
        if self.boom:
            raise RuntimeError("statement timeout")
        self.q = (table, query)
        return self.rows


sb_ = _StuckSB([{"external_id": 37600, "games": {"status": "live"}}, {"external_id": "37601", "games": {"status": "live"}}])
got = RI.unsettled_finals(sb_, {"adapter": "fiba_site_schedule", "code": "PL1LM"})
ok("the ids the platform still has live, as strings", got == {"37600", "37601"}, got)
ok("...asked of external_games by what games.status says, inside the outstanding window only",
   sb_.q[0] == "external_games" and "external_status=eq.final" in sb_.q[1] and "games.status=neq.final" in sb_.q[1]
   and "adapter=eq.fiba_site_schedule" in sb_.q[1] and "competition_code=eq.PL1LM" in sb_.q[1] and "tipoff_at=gt." in sb_.q[1], sb_.q)
ok("a read that fails finds none (never blocks a pass)", RI.unsettled_finals(_StuckSB(boom=True), {"adapter": "x", "code": "Y"}) == set())
src_ = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_ingest.py"), encoding="utf-8").read()
ok("the batch pass neither calls such a game done nor skips it as unchanged",
   src_.count("str(g.external_id) not in stuck") == 2 and "unsettled_finals(sb, src)" in src_)

print("-- a game's whole event log is read, not the first 1,000 plays")


class _Paged:
    """A PostgREST that caps every answer at 1,000 rows, honouring limit/offset like the real one."""

    def __init__(self, n):
        self.rows = [{"seq": i + 1} for i in range(n)]
        self.calls = 0

    def select(self, table, query):
        self.calls += 1
        kv = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
        lim, off = min(int(kv.get("limit", 1000)), 1000), int(kv.get("offset", 0))
        return self.rows[off:off + lim]


for n_, calls_ in ((0, 1), (999, 1), (1000, 2), (1004, 2), (2500, 3)):
    fake_ = _Paged(n_)
    got_ = RI.Supabase.select_all(fake_, "game_events", "game_id=eq.x&select=seq&order=seq")
    ok(f"{n_} plays: all of them, in order, in {calls_} read(s)", [r["seq"] for r in got_] == list(range(1, n_ + 1)) and fake_.calls == calls_, (len(got_), fake_.calls))
ok("the event log read in run_ingest.py is the paged one",
   'existing = sb.select_all("game_events"' in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_ingest.py"), encoding="utf-8").read())

print("-- the broadcast is looked for every five minutes of a live game, not every poll")
RI._VIDEO_LOOKED.clear()
seen = [RI.video_due("gA", "live") for _ in range(30)]
ok("thirty polls in a row: one look", seen.count(True) == 1, seen.count(True))
ok("...but the final write always gets its own", RI.video_due("gA", "final") and not RI.video_due("gA", "final"))
RI._VIDEO_LOOKED["gB"] = (RI.time.time() - RI.VIDEO_EVERY_S - 1, "live")
ok("...and five minutes later, another", RI.video_due("gB", "live"))

print("-- a Czech game comes back under the fixture's own id")
from adapters.fiba_site_schedule import FibaSiteScheduleAdapter  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
A = FibaSiteScheduleAdapter()
A._czech_match_id = lambda sid, config: "2890474"
orig = FibaLiveStatsAdapter.fetch
FibaLiveStatsAdapter.fetch = lambda self, gid, config: GameBundle(external_id=str(gid), status="final", home_name="H", away_name="A",
                                                                   tipoff_at=None, team={}, box={}, stints=[])
try:
    got = A.fetch("544553", {"site": "czech"})
finally:
    FibaLiveStatsAdapter.fetch = orig
ok("fetch('544553') -> a bundle keyed 544553, not the LiveStats 2890474", got is not None and got.external_id == "544553",
   got and got.external_id)

print("-- the AI dashboard reads the queue each tick, the history only when it has changed")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worker"))
import ai_dashboard as D  # noqa: E402
import ai_worker as W  # noqa: E402


class FakeJobs:
    def __init__(self):
        self.active, self.reads = [], []

    def select(self, table, query):
        self.reads.append((table, "not.in." in query))
        if table == "video_workers":
            return [{"id": "pc", "last_seen": None}]
        if "status=in." in query:
            return list(self.active)
        return [{"id": "old", "status": "done", "requested_at": "2026-09-20T10:00:00Z"}]


M = D.Model({"supabase_url": "http://x", "service_key": "k", "worker_id": "pc"})
M.db = FakeJobs()
M.refresh(False); M.refresh(False); M.refresh(False)
hist = [r for r in M.db.reads if r == ("video_jobs", True)]
ok("three quiet ticks: the history is read once, the queue three times", len(hist) == 1 and M.db.reads.count(("video_jobs", False)) == 3, M.db.reads)
M.db.reads.clear(); M.db.active = [{"id": "j1", "status": "running", "requested_at": "2026-09-25T01:00:00Z"}]
M.refresh(False)
ok("...a job joining the queue brings the history with it", ("video_jobs", True) in M.db.reads, M.db.reads)
M.db.reads.clear(); M.refresh(True)
ok("...and so does any button (full=True)", ("video_jobs", True) in M.db.reads)
ok("the running job and the history are both on the screen", [j["id"] for j in M.jobs] == ["j1", "old"], [j["id"] for j in M.jobs])

print("-- the worker's hourly sweep reads two keys of each clock track, and decides the same")
tracks = [{}, {"coverage": {"worker": W.VERSION, "read_frac": 0.9}, "samples": [{"t": 1}]},
          {"coverage": {"worker": W.VERSION, "read_frac": 0.2}, "samples": [{"t": 1}]},
          {"coverage": {"worker": "ai_worker/1.0", "read_frac": 0.99}, "samples": [{"t": 1}]},
          {"samples": [{"t": 1}]}, {"mode": "auto", "samples": []}]
for tr in tracks:
    slim = W.slim_track_row({"cov": tr.get("coverage"), "first": (tr.get("samples") or [None])[0]})
    ok("wants_reread(%s) is the same from the two keys" % str(tr)[:60], W.wants_reread(slim)[0] == W.wants_reread(tr)[0], (slim, tr))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
