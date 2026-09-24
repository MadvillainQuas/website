# -*- coding: utf-8 -*-
"""NBL Bulgaria (adapters/bgnbl.py), offline, over captured EUI embed-308 replies:

    python scripts/ingest/bgnbl_test.py

What it holds the adapter to:
  * every name in Latin by Bulgaria's own standard (names.bulgarian_latin): the feed sends
    Cyrillic only, and not one character of it may reach a club, a box score or a lineup;
  * the schedule: 2025-26's 190 played games, split into 166 regular-season and 24 play-off games
    by the round numbers starting again, cancelled games and "Unknown" play-off slots left out,
    clubs coded by their EUI entityId;
  * the fixtures the operator left on SCHEDULED although they were played (27 in 2025-26) counted
    as final, from the schedule and from the game feed alike - and a tie at the end of Q4, or a
    period not yet ended, never called final;
  * a season the feed is not on refused with a reason, never read as the current one;
  * three games end to end: the box the feed's own, stints covering all 40 minutes and summing to
    the score, and the event log translate() builds dropping nothing.

Fixtures in scripts/ingest/data/bgnbl/ (captured 2026-09-24, as the feed sends them - in Cyrillic -
trimmed to the fields the adapter reads): the 2025-26 schedule pages and three games: Botev 86-90
Beroe (one of the SCHEDULED-but-played), Levski 76-82 Minyor, and Balkan 81-80 Lokomotiv (play-off).
"""
import base64
import json
import os
import re
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import bgnbl as B  # noqa: E402
from adapters import lnb as LNB  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "bgnbl")
CYR = re.compile("[Ѐ-ӿ]")
PASS = FAIL = 0
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


class Reply:
    def __init__(self, body):
        self.status_code = 200 if body is not None else 404
        self.text = body or ""

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        pass


ASKED = []


def served(method, url, **kw):
    """requests.request, served from the fixtures by the decoded EUI state."""
    s = kw["params"]["state"]
    st = json.loads(zlib.decompress(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))))
    ASKED.append((url.rsplit("/", 1)[-1], st))
    if url.endswith("/fixtures"):
        name = f"fixtures-{st.get('s') or 'current'}-{st.get('z')}.json"
    else:
        name = f"game-{st.get('f')}-{st.get('z')}.json"
    path = os.path.join(DATA, name)
    return Reply(open(path, encoding="utf-8").read() if os.path.exists(path) else None)


LNB.requests.request = served
FibaLiveStatsAdapter._pipeline = False
FibaLiveStatsAdapter._pipeline_warned = True


def fresh():
    ASKED.clear()
    a = B.BgNblAdapter()
    a.min_request_gap_s = 0
    return a


SEASON = "3f73b7bb-9a47-11f0-8a96-b5a52c2e9fb9"

# ============================================================================ the schedule
print("-- the schedule")
a = fresh()
reg = list(a.discover("https://nbl.basketball.bg/games", {"season": "2025-26", "stage": "regular"}))
po = list(a.discover("https://nbl.basketball.bg/games#playoffs", {"season": "2025/26", "stage": "playoffs"}))
ok("2025-26: 166 regular-season games and 24 play-off games, all final", (len(reg), len(po)) == (166, 24)
   and all(g.status == "final" for g in reg + po), (len(reg), len(po), {g.status for g in reg + po}))
ok("...read from the feed's two tabs (RESULTS, FIXTURES) for each stage, nothing else",
   [x[1]["z"] for x in ASKED] == ["RESULTS", "FIXTURES"] * 2, ASKED)
names_ = [g.home_name for g in reg + po] + [g.away_name for g in reg + po] + [g.extra["venue"] or "" for g in reg + po]
ok("not one Cyrillic character in a club or venue name", not any(CYR.search(n) for n in names_),
   [n for n in names_ if CYR.search(n)][:4])
clubs = sorted({g.home_name for g in reg})
ok("the eleven clubs by the standard: Botev 2012 Vratsa, Cherno more Ticha, Minyor 2015, Rilski sportist ...",
   clubs == ["Akademik Bulteks 99", "Balkan", "Beroe-Stara Zagora", "Botev 2012 Vratsa", "Cherno more Ticha", "Levski",
             "Lokomotiv Plovdiv", "Minyor 2015", "Rilski sportist", "Shumen", "Spartak Pleven"], clubs)
ok("a club is coded by its EUI entityId, the same one id for all its games",
   all(re.fullmatch(r"[0-9a-f-]{36}", g.extra["home_code"]) for g in reg)
   and len({(g.home_name, g.extra["home_code"]) for g in reg}) == 11)
cut = max(g.tipoff_at for g in reg)
ok("every play-off game comes after the last regular-season game (their rounds start again at 1)",
   all(g.tipoff_at > cut for g in po) and {g.extra["round"] for g in po} >= {"Round: 1", "Round: 5"}
   and max(int(g.extra["round"].split()[-1]) for g in reg) == 33, cut)
raw_fx = json.load(open(os.path.join(DATA, "fixtures-current-FIXTURES.json"), encoding="utf-8"))["data"]["fixtures"]
raw_fx += json.load(open(os.path.join(DATA, "fixtures-current-RESULTS.json"), encoding="utf-8"))["data"]["fixtures"]
left_on_scheduled = {f["fixtureId"] for f in raw_fx if (f.get("status") or {}).get("value") == "SCHEDULED"
                     and all(c.get("score") not in (None, "") for c in f["competitors"])
                     and all(c.get("name") != "Unknown" for c in f["competitors"])}
got = {g.external_id.split("_")[1] for g in reg + po}
ok(f"the {len(left_on_scheduled)} games the operator left on SCHEDULED are final all the same",
   len(left_on_scheduled) == 27 and left_on_scheduled <= got)
ok("the cancelled game and the 'Unknown v Unknown' play-off slot are not games",
   not any((f.get("status") or {}).get("value") == "CANCELLED" and f["fixtureId"] in got for f in raw_fx)
   and not any(any(c.get("name") == "Unknown" for c in f["competitors"]) and f["fixtureId"] in got for f in raw_fx))
ok("the key carries both uuids (season_fixture), which the game feed needs",
   all(g.external_id.startswith(SEASON + "_") for g in reg))
a = fresh()
ok("2026-27 is refused while the feed is still on 2025-26 - never read as the current season",
   list(a.discover("x", {"season": "2026-27"})) == [])
for bad, cfg in (("a season token that is not a season", {"season": "twenty"}),
                 ("a stage that is neither regular nor playoffs", {"stage": "cup"})):
    try:
        list(fresh().discover("x", cfg))
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)

# ============================================================================ played or not
print("\n-- played or not")
old = {"startTimeUTC": "2025-10-04T15:00:00"}
ok("SCHEDULED with two scores, long past: played", B.scored_and_past(dict(old, competitors=[
    {"name": "A", "score": "86"}, {"name": "B", "score": "90"}])))
ok("...but not with an 'Unknown' side or a missing score", not B.scored_and_past(dict(old, competitors=[
    {"name": "Unknown", "score": "1"}, {"name": "B", "score": "2"}])) and not B.scored_and_past(dict(old, competitors=[
        {"name": "A", "score": ""}, {"name": "B", "score": "2"}])))
fx = {"status": "SCHEDULED", "startTimeUTC": "2025-10-04T15:00:00",
      "competitors": [{"score": "80"}, {"score": "82"}]}
four = {str(q): {"ended": True} for q in (1, 2, 3, 4)}
a = fresh()
ok("a game feed on SCHEDULED with all four quarters ended and a winner: final", a._played(fx, four))
ok("...a tie at the end of Q4 is overtime to come, not final",
   not a._played(dict(fx, competitors=[{"score": "80"}, {"score": "80"}]), four))
ok("...a quarter still running is not final", not a._played(fx, dict(four, **{"4": {"ended": False}})))
ok("...a cancelled game is never final", not a._played(dict(fx, status="CANCELLED"), four))

# ============================================================================ games
print("\n-- three games end to end")
GAMES = {"17e735e0-9af1-11f0-a0b4-fb21cc4f049c": ("Botev 2012 Vratsa", 86, 90, "Beroe-Stara Zagora", "left on SCHEDULED"),
         "8466f5c0-9f8b-11f0-8e21-0de8d27b78ae": ("Levski", 76, 82, "Minyor 2015", "regular season"),
         "38e6a80d-5483-11f1-9ec0-bf4515b49830": ("Balkan", 81, 80, "Lokomotiv Plovdiv", "play-off")}
for fid, (home, hs, as_, away, what) in GAMES.items():
    b = fresh().fetch(f"{SEASON}_{fid}", {})
    label = f"{fid[:8]} ({what})"
    if b is None:
        ok(label + ": fetched", False)
        continue
    raw = b.raw
    ok(f"{label}: {home} {hs}-{as_} {away}, final",
       (b.home_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"], b.away_name, b.status) == (home, hs, as_, away, "final"),
       (b.home_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"], b.away_name, b.status))
    left = CYR.findall(json.dumps(raw, ensure_ascii=False))
    ok(f"{label}: no Cyrillic anywhere in the payload the site stores", not left, left[:5])
    pnames = [r["player_name"] for s in ("home", "away") for r in b.box[s]]
    ok(f"{label}: every player named in Latin letters", pnames and all(re.fullmatch(r"[A-Za-z' .-]+", n) for n in pnames),
       [n for n in pnames if not re.fullmatch(r"[A-Za-z' .-]+", n)][:4])
    ok(f"{label}: each club's players add up to its score",
       sum(r["sPoints"] for r in b.box["home"]) == hs and sum(r["sPoints"] for r in b.box["away"]) == as_)
    ok(f"{label}: {len(b.stints)} stints, five a side, covering all 40 minutes",
       b.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints)
       and abs(sum(r["duration"] for r in b.stints) - 2400) < 0.01, sum(r["duration"] for r in b.stints))
    ok(f"{label}: stint points add up to the final score",
       (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (hs, as_))
    rep = translate(raw)["report"]
    ok(f"{label}: translate() drops nothing and matches every player", not rep["dropped"] and rep["unmatched"] == 0,
       (rep["dropped"], rep["unmatched"]))

# ============================================================================ wiring
print("\n-- wiring")
ok("the registry knows it, and a backfill can read a season",
   type(get_adapter("bgnbl")).__name__ == "BgNblAdapter"
   and '"bgnbl"' in open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().split("SEASON_AWARE_ADAPTERS =", 1)[1][:500])
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if s.get("adapter") == "bgnbl"]
ok("two source rows, one league filed under Bulgaria: the regular season and the play-offs",
   sorted(s["adapter_config"]["stage"] for s in rows) == ["playoffs", "regular"]
   and {s["league_slug"] for s in rows} == {"nbl-bulgaria"} and all(s["league_country"] == "BG" for s in rows)
   and [s.get("competition_kind") for s in rows if s["adapter_config"]["stage"] == "playoffs"] == ["playoff"], rows)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
