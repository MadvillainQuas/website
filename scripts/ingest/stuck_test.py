"""A game still live long after it could have been played is repaired, offline:

    python scripts/ingest/stuck_test.py

Four games sat LIVE on the front page from 26 to 30 Sep 2026 and every earlier fix covered only games from
then on. What holds now (stuck.py, run_ingest.repair_report, 0199's SQL twin):
  * a game live or finalising more than 4 h after tip-off is found at ANY age (Oaklands: tip-off Oct 2025);
  * one still open at 6 h is closed on its last state: FINAL when the fourth period or later was over or
    decided or the feed said final, VOID otherwise - and its feed row is closed with the reason, so no lane
    writes it back to live;
  * a voided game is never written live again by a feed that still says so;
  * the Czech federation's payload, which gives BOTH clubs the same code, no longer maps one roster onto both
    sides (the "same player on the team sheet" refusal that kept Slavia v Litomerice live for five days).
"""
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_ingest as RI  # noqa: E402
import stuck as S  # noqa: E402
import feedplatform as FP  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter, distinct_team_codes  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


NOW = datetime(2026, 9, 30, 14, 0, tzinfo=timezone.utc)

print("-- the verdict (the same table as supabase/tests/close-stuck-games.test.mjs)")
v = lambda *a: S.verdict(*a)[0]
ok("Oaklands: end of Q4, 118-50, feed final -> final", v(4, 0, 118, 50, "final") == "final")
ok("Vellaznimi: Q4 0:35, 68-83 -> decided, final", v(4, 35000, 68, 83, "live") == "final")
ok("...but a 2-point game with 35 s left is not decided (a 3 and a stop)", v(4, 35000, 68, 70, "live") == "void")
ok("Liverpool: Q1 7:15, 7-8 -> void, a result nobody can vouch for", v(1, 435000, 7, 8, "live") == "void")
ok("Slavia: the feed said final, finalise-game refused -> final on the feed's score", v(4, 300000, 96, 80, "final") == "final")
ok("level at 0:00 in Q4 -> void (overtime never played)", v(4, 0, 60, 60, "live") == "void")
ok("an overtime that ended 0:00 with the scores apart -> final", v(6, 0, 101, 99, "live") == "final")
ok("a feed that said final at a level score is not a result either", v(4, 0, 60, 60, "final") == "void")


class Fake:
    """games, game_state, external_games and the calls the repair makes."""
    def __init__(self, games, ext, state, rpc_ok=True):
        self.games, self.ext, self.state, self.rpc_ok = games, ext, state, rpc_ok
        self.patches, self.rpcs, self.inserts = [], [], []

    @staticmethod
    def _ids(q, key):
        i = q.index(key + "=in.(") + len(key) + 5
        return q[i:q.index(")", i)].split(",")

    def select_all(self, table, q):
        return self.select(table, q)

    def select(self, table, q):
        if table == "games":
            if "id=in.(" in q:
                want = self._ids(q, "id")
                return [dict(g) for g in self.games if g["id"] in want and ("status=in.(live,finalising)" not in q or g["status"] in ("live", "finalising"))]
            assert "status=in.(live,finalising)" in q and "tipoff_at=lt." in q
            cut = q.split("tipoff_at=lt.")[1].split("&")[0]
            return [dict(g) for g in self.games if g["status"] in ("live", "finalising") and g["tipoff_at"].replace("+00:00", "Z") < cut]
        if table == "external_games":
            want = self._ids(q, "game_id")
            return [dict(e) for e in self.ext if e["game_id"] in want]
        if table == "game_state":
            want = self._ids(q, "game_id")
            return [dict(s) for s in self.state if s["game_id"] in want]
        raise AssertionError(table)

    def patch(self, table, q, body):
        self.patches.append((table, q, body))
        if table == "games":
            for g in self.games:
                if q == f"id=eq.{g['id']}":
                    g.update(body)
        if table == "external_games":
            for e in self.ext:
                if q == f"adapter=eq.{e['adapter']}&external_id=eq.{e['external_id']}":
                    e.update(body)

    def rpc(self, fn, body=None):
        self.rpcs.append((fn, body))
        if fn == "close_stuck_games" and not self.rpc_ok:
            raise RuntimeError("404 Not Found - function public.close_stuck_games does not exist")
        return None

    def insert(self, table, rows):
        self.inserts.append((table, rows))


def world(rpc_ok=True):
    def g(i, hours, st="live"):
        return {"id": f"g{i}", "status": st, "tipoff_at": (NOW - timedelta(hours=hours)).isoformat(), "home_score": 0, "away_score": 0,
                "period": 1, "competition_id": "c1" if i % 2 else "c2", "stalled_since": None}
    games = [g(1, 24 * 340), g(2, 96), g(3, 100), g(4, 72), g(5, 3), g(6, 900, "final"), g(7, 5)]
    ext = [dict(game_id=f"g{i}", adapter=a, external_id=f"x{i}", competition_code=c, external_status=s, home_name=f"H{i}", away_name=f"A{i}", tipoff_at=None, error=None)
           for i, a, c, s in ((1, "fiba_livestats", "SLBW", "final"), (2, "fiba_site_schedule", "CZ1L", "final"), (3, "fiba_livestats", "NBLD1", "live"),
                              (4, "fiba_site_schedule", "KOS", "live"), (5, "fiba_livestats", "X", "live"), (7, "fiba_livestats", "X", "live"))]
    state = [dict(game_id="g1", period=4, clock_ms=0, score_home=118, score_away=50), dict(game_id="g2", period=4, clock_ms=0, score_home=96, score_away=80),
             dict(game_id="g3", period=1, clock_ms=435000, score_home=7, score_away=8), dict(game_id="g4", period=4, clock_ms=35000, score_home=68, score_away=83),
             dict(game_id="g7", period=4, clock_ms=200000, score_home=70, score_away=68)]
    return Fake(games, ext, state, rpc_ok)


print("\n-- finding them")
fk = world()
found = S.stuck_games(fk, NOW)
ok("every game live 4 h+ after tip-off, whatever its age: 1, 2, 3, 4 and 7; not the one 3 h in, not the final one",
   [x["id"] for x in found] == ["g1", "g2", "g3", "g4", "g7"], [x["id"] for x in found])
ok("state is the running score, period and clock", (found[3]["home"], found[3]["away"], found[3]["period"], found[3]["clock_ms"]) == (68, 83, 4, 35000), found[3])
ok("...age in seconds, feed rows attached", round(found[4]["age_s"]) == 5 * 3600 and found[0]["ext"][0]["competition_code"] == "SLBW")
ok("--ids takes a game id or an external id", [x["id"] for x in S.stuck_games(fk, NOW, ["g3", "x4"])] == ["g3", "g4"])
grouped = S.by_source(found)
ok("grouped by (adapter, code) for the catch-up's loop", set(grouped) == {("fiba_livestats", "SLBW"), ("fiba_site_schedule", "CZ1L"), ("fiba_livestats", "NBLD1"),
                                                                            ("fiba_site_schedule", "KOS"), ("fiba_livestats", "X")}
   and grouped[("fiba_livestats", "SLBW")][0]["tipoff_at"] == found[0]["tipoff_at"], list(grouped))

print("\n-- closing what the re-read could not finish")
fk = world(rpc_ok=False)
found = S.stuck_games(fk, NOW)
done = {c["id"]: c for c in S.close_stuck(fk, found, NOW)}
ok("no 0199 yet: the same rule from here - 1, 2, 4 final, 3 void; the game 5 h in (7) is left to its feed", {k: c["verdict"] for k, c in done.items()} == {"g1": "final", "g2": "final", "g3": "void", "g4": "final"}, done)
gm = {g["id"]: g for g in fk.games}
ok("games written: status, score, finalised_at; void keeps no score", gm["g1"]["status"] == "final" and gm["g1"]["home_score"] == 118 and gm["g1"]["finalised_at"] and gm["g3"]["status"] == "void")
em = {e["game_id"]: e for e in fk.ext}
ok("the feed rows are closed with the reason, so no lane reads them live again", all(em[i]["external_status"] == "final" and em[i]["error"].startswith("reconciled (") for i in ("g1", "g2", "g3", "g4")), em["g3"])
ok("the game 5 h in was not touched", gm["g7"]["status"] == "live" and em["g7"]["external_status"] == "live")
ok("audit rows, and standings rebuilt for the two competitions touched", len(fk.inserts) == 4 and sorted(b["p_competition"] for f, b in fk.rpcs if f == "recompute_standings") == ["c1", "c2"], (fk.inserts, fk.rpcs))
ok("idempotent: a second pass finds nothing to close", S.close_stuck(fk, S.stuck_games(fk, NOW), NOW) == [])

fk = world()
fk.rpc = lambda fn, body=None: fk.rpcs.append((fn, body)) or [dict(game_id="g1", was="live", verdict="final", reason="r", home_score=118, away_score=50)]
got = S.close_stuck(fk, S.stuck_games(fk, NOW), NOW)
ok("with 0199 applied the database function does it (ids and the 6 h cap passed)", got[0]["verdict"] == "final" and fk.rpcs[0][0] == "close_stuck_games"
   and fk.rpcs[0][1]["p_hard_hours"] == 6.0 and set(fk.rpcs[0][1]["p_ids"]) == {"g1", "g2", "g3", "g4"}, fk.rpcs)
fk = world(rpc_ok=False)
ok("a dry run changes nothing", S.close_stuck(fk, S.stuck_games(fk, NOW), NOW, dry=True) and not fk.patches and not fk.inserts)

print("\n-- the report, and failing loudly")
import io, contextlib  # noqa: E402
fk = world(rpc_ok=False)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    rc = RI.repair_report(fk, S.stuck_games(fk, NOW), False, True)
out = buf.getvalue()
ok("a line per game with what it was, what it is, how", "H3 v A3" in out and "-> void" in out and "closed final:" in out, out)
ok("a game inside the 6 h cap is not a failure: exit 0", rc == 0 and "STILL OPEN - inside the 6 h cap" in out, (rc, out))
fk = world(rpc_ok=False)
fk.rpc = lambda fn, body=None: (_ for _ in ()).throw(RuntimeError("500")) if fn == "close_stuck_games" else None
fk.patch = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("503"))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    rc = RI.repair_report(fk, S.stuck_games(fk, NOW), False, True)
ok("strict: games that could not be closed fail the run", rc == 1 and "still live after the repair" in buf.getvalue(), (rc, buf.getvalue()))

print("\n-- wiring")
src = open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read()
ok("a voided game is not written live again (write_platform) or given a log (write_event_log)",
   'cur[0].get("status") == "void"' in src and 'g[0].get("status") in ("final", "void")' in src)
ok("--repair-stalled writes every listed game through, whatever the stored hash says", 'stuck = set(repair["ext"]' in src)
wf = open(os.path.join(HERE, "..", "..", ".github", "workflows", "ingest.yml"), encoding="utf-8").read()
ok("the live lane (and so the hourly floor) runs the repair at the head of every pass", "run_ingest.py --config --repair-stalled" in wf and "Repair games stuck live" in wf)
rw = open(os.path.join(HERE, "..", "..", ".github", "workflows", "repair-stalled.yml"), encoding="utf-8").read()
ok("the repair workflow is strict and takes dry_run and ids", "--repair-stalled --strict" in rw and "dry_run:" in rw and "ids:" in rw)

print("\n-- the Czech payload that gave both clubs one code")
raw = {"tm": {"1": {"code": "SLA", "name": "Slavia Tygři Praha", "pl": {"4": {"shirtNumber": "1"}}},
              "2": {"code": "SLA", "name": "Slavoj BK Litoměřice", "pl": {"4": {"shirtNumber": "18"}}}}}
before = (FP.team_code(raw["tm"]["1"]), FP.team_code(raw["tm"]["2"]))
ok("read as it comes, both sides key their players 'SLA:<slot>' - one roster on both", before == ("SLA", "SLA"), before)
ok("distinct_team_codes blanks the pair", distinct_team_codes(raw) is True)
after = (FP.team_code(raw["tm"]["1"]), FP.team_code(raw["tm"]["2"]))
ok("each club is now keyed by its own name", after[0] != after[1] and all(after), after)
raw2 = {"tm": {"1": {"code": "OAK", "name": "A"}, "2": {"code": "CAR", "name": "B"}}}
ok("two different codes are left alone", distinct_team_codes(raw2) is False and raw2["tm"]["1"]["code"] == "OAK")
raw3 = {"tm": {"1": {"code": "", "name": "A"}, "2": {"code": "", "name": "B"}}}
ok("two blank codes are not a collision", distinct_team_codes(raw3) is False)
raw4 = {"pbp": [{"actionType": "game", "subType": "end"}], "clock": "00:00", "period": 4,
        "tm": {"1": {"code": "SLA", "name": "Slavia", "score": 96, "pl": {}}, "2": {"code": "SLA", "name": "Slavoj", "score": 80, "pl": {}}}}
try:
    b = FibaLiveStatsAdapter().bundle_from_raw(raw4, "1", {})
    ok("the adapter applies it before hashing and reading the payload", raw4["tm"]["2"]["code"] == "" and b.status == "final")
except Exception as exc:
    ok("the adapter applies it before hashing and reading the payload (bundle_from_raw ran)", False, repr(exc))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
