"""Israel's Winner League (IBSL) from basket.co.il + Segev Stats, offline:

    python scripts/ingest/ibsl_test.py

The fixtures (scripts/ingest/data/ibsl/, captured 2026-10-08): basket.co.il's Games list cut to a few rows of 2025-26
and 2026-27, the Winner League's clubs for both seasons, and Segev's getActions + getBoxScore for three games: 47
(Ramat Gan 84-67 Rishon, 12 Oct 2025), 56 (Netanya 95-93 Ramat Gan after two overtimes) and 398 (Eilat 98-101
Herzliya, the 2026-27 cup: changes typed across running seconds, new foul kinds, and the operator's own lineup slips).
What this holds the adapter to:
  * the rows: adapter ibsl, league winner-league, IL; the regular season, the play-offs (a playoff competition) and the
    Winner Cup (a cup), each its boards by name; registered, season-aware, translated;
  * discovery: basket.co.il's game id is the key; the club code is TeamUID (the same every season); names, short
    names, crests; Israel time -> UTC (IDT in October, IST in December); no time yet = noon UTC, time_tbc; a Segev id
    of "0" is none; a posted score is final; the stages take their own boards;
  * one game: every player's box line = his own actions re-counted; five starters; the final = basket.co.il's; the
    periods opened and closed once each (overtime as OVERTIME), the final whistle once; each drawn foul points at its
    foul; stints cover the game with five a side and add up to the final; lay-ups, dunks and alley-oops at the rim;
  * Segev's habits: a change typed across seconds is one moment; a change at a period's 0:00 belongs to the next;
    2026-27's foul kinds and replay reviews are known;
  * final or held: Segev's flag, or basket.co.il's same score three hours on; a result that differs (an awarded game)
    is held; a game with no Segev id is not fetched;
  * the flag and the bio reader.
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
DATA = os.path.join(HERE, "data", "ibsl")
from adapters import REGISTRY  # noqa: E402
from adapters import ibsl as I  # noqa: E402
from adapters.fiba_livestats import shot_dist_to_nearest_rim  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


GAMES = {2026: load("games-2026.json"), 2027: load("games-2027.json")}
TEAMS = {2026: load("teams-2026.json"), 2027: load("teams-2027.json")}
SEGEV = {}
for sid in ("47", "56", "398"):
    SEGEV[("getActions", sid)] = load(f"segev-{sid}-actions.json")
    SEGEV[("getBoxScore", sid)] = load(f"segev-{sid}-box.json")
CALLS = []


def fake_get(self, url, fresh=False, **params):
    CALLS.append((url, dict(params)))
    if url.endswith("/Games"):
        return GAMES.get(int(params.get("cYear")), {"games": []})
    if url.endswith("/Teams"):
        return TEAMS.get(int(params.get("cYear")), {"teams": []})
    if url == I.SEGEV:
        return SEGEV.get((params.get("method"), str(params.get("game_id"))), {"error": {"code": "-32000", "message": "game not found"}})
    return None


I.IbslAdapter._get_json = fake_get
I.IbslAdapter._pause = lambda self: None
A = I.IbslAdapter()
rows = {r["game_id"]: r for y in GAMES for r in GAMES[y]["games"]}
teams_of = {y: A._teams(y) for y in TEAMS}

# ---------------------------------------------------------------------------------------------------------- config
print("config rows")
reg = json.loads(open(os.path.join(ROOT, "config", "ingest-sources.json"), encoding="utf-8").read())
src = [s for s in reg["sources"] if s.get("code") == "IBSL"]
ok("three IBSL rows: the regular season, the play-offs, the Winner Cup",
   [s["adapter_config"].get("stage") for s in src] == ["regular", "playoffs", "cup"], [s["adapter_config"].get("stage") for s in src])
ok("each on adapter ibsl, league winner-league 'Winner League', country IL",
   all(s["adapter"] == "ibsl" and s["league_slug"] == "winner-league" and s["league_name"] == "Winner League" and s["league_country"] == "IL" for s in src))
ok("the play-offs are a playoff competition, the cup a cup",
   (src[1].get("competition_kind"), src[1].get("competition_label"), src[2].get("competition_kind"), src[2].get("competition_label"))
   == ("playoff", "Winner League Playoffs", "cup", "Winner Cup"), [(s.get("competition_kind"), s.get("competition_label")) for s in src])
import run_ingest  # noqa: E402
ok("registered, season-aware and translated", "ibsl" in REGISTRY and "ibsl" in run_ingest.SEASON_AWARE_ADAPTERS and "ibsl" in run_ingest.TRANSLATABLE_ADAPTERS)

# ---------------------------------------------------------------------------------------------------------- discovery
print("\ndiscovery")
reg_games = {g.external_id: g for g in A.discover("", {"stage": "regular", "season": "2026-27"})}
ok("2026-27 regular season: the Winner League's rows only, keyed on basket.co.il's game id",
   sorted(reg_games) == ["26646", "26672", "26700"], sorted(reg_games))
g = reg_games.get("26646")
ok("Maccabi Tel Aviv v Galil Elion: names as basket.co.il writes them",
   g and (g.home_name, g.away_name) == ("Maccabi Rapyd Tel Aviv", "Hapoel Alfi Benedek Galil Elion"), g and (g.home_name, g.away_name))
ok("...the club code is TeamUID (10, 1), the short name the club list's", g and (g.extra["home_code"], g.extra["away_code"], g.extra["home_short"], g.extra["away_short"])
   == ("10", "1", "Maccabi Tel-Aviv", "Hapoel Galil Elion"), g and g.extra)
ok("...20:15 Israel time on 10 Oct (IDT) is 17:15 UTC; scheduled; Segev id 419",
   g and g.tipoff_at == "2026-10-10T17:15:00+00:00" and g.status == "scheduled" and g.extra.get("segev_id") == "419", g and (g.tipoff_at, g.status, g.extra.get("segev_id")))
g = reg_games.get("26672")
ok("a Segev id of '0' is no id", g and g.extra.get("segev_id") is None, g and g.extra.get("segev_id"))
g = reg_games.get("26700")
ok("no time yet: noon UTC on its date, time_tbc", g and g.tipoff_at == "2026-12-06T12:00:00+00:00" and g.extra.get("time_tbc") is True, g and (g.tipoff_at, g.extra))
cup = {g.external_id: g for g in A.discover("", {"stage": "cup", "season": "2026-27"})}
ok("the cup takes the Winner Cup's rows: two played (final, with their scores), the final to come",
   sorted(cup) == ["26635", "26637", "26848"] and cup["26637"].status == "final" and cup["26848"].status == "scheduled"
   and (cup["26637"].extra["home_score"], cup["26637"].extra["away_score"]) == ("98", "101"), {k: v.status for k, v in cup.items()})
po = {g.external_id: g for g in A.discover("", {"stage": "playoffs", "season": "2025-26"})}
ok("2025-26 play-offs: the quarter-final and the semi-final boards, not the regular season",
   sorted(po) == ["26603", "26626"], sorted(po))
ok("...and that season's club ids give the same TeamUID (Jerusalem is 8 in both)",
   po["26603"].extra["home_code"] == "8" and teams_of[2027]["2114"]["uid"] == "8")
ok("a 13:00 game in October 2025 (IDT) is 10:00 UTC", I.fixture_tip(rows["26390"])[0] == "2025-10-12T10:00:00+00:00", I.fixture_tip(rows["26390"]))

# ---------------------------------------------------------------------------------------------------------- one game
MAP = {"sFieldGoalsAttempted": ("fga",), "sFieldGoalsMade": ("fgm",), "sThreePointersAttempted": ("3pa",), "sThreePointersMade": ("3pm",),
       "sFreeThrowsAttempted": ("fta",), "sFreeThrowsMade": ("ftm",), "sReboundsOffensive": ("oreb",), "sReboundsDefensive": ("dreb",),
       "sAssists": ("assist",), "sSteals": ("steal",), "sBlocks": ("block",), "sTurnovers": ("turnover",), "sFoulsPersonal": ("pf",)}


def recount(raw):
    cnt = {}
    for ev in raw["pbp"]:
        if not ev.get("pno"):
            continue
        c = cnt.setdefault((ev["tno"], ev["pno"]), {})
        at = ev["actionType"]
        add = lambda k, v=1: c.__setitem__(k, c.get(k, 0) + v)  # noqa: E731
        if at in ("2pt", "3pt"):
            add("fga"); add("fgm", ev["success"])
            if at == "3pt":
                add("3pa"); add("3pm", ev["success"])
        elif at == "freethrow":
            add("fta"); add("ftm", ev["success"])
        elif at == "rebound":
            add("oreb" if ev["subType"] == "offensive" else "dreb")
        elif at in ("assist", "steal", "block", "turnover"):
            add(at)
        elif at == "foul":
            add("pf")
    bad = []
    for s in ("1", "2"):
        for pno, p in raw["tm"][s]["pl"].items():
            c = cnt.get((int(s), pno), {})
            d = {k: (c.get(v[0], 0), p[k]) for k, v in MAP.items() if c.get(v[0], 0) != p[k]}
            if d:
                bad.append((s, p["shirtNumber"], d))
    return bad


def check_game(label, gid, sid, quarters, final, year):
    raw = I.raw_from_game(rows[gid], teams_of[year], SEGEV[("getActions", sid)], SEGEV[("getBoxScore", sid)], finished=True)
    b = A.bundle_from_raw(raw, gid, {})
    print(f"\n{label}")
    ok("the final is basket.co.il's", (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == final, (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]))
    ok("every player's box line = his own actions, re-counted", recount(raw) == [], recount(raw)[:2])
    ok("five starters a side", all(sum(p["starter"] for p in raw["tm"][s]["pl"].values()) == 5 for s in ("1", "2")))
    mins = [sum(int(p["sMinutes"].split(":")[0]) * 60 + int(p["sMinutes"].split(":")[1]) for p in raw["tm"][s]["pl"].values()) / 60 for s in ("1", "2")]
    want = 200 + 25 * (quarters - 4)
    ok(f"{want} minutes a side", all(abs(m - want) < 0.5 for m in mins), mins)
    starts = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"]
    ends = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"]
    ok(f"{quarters} periods opened and closed once each, the final whistle once",
       len(starts) == len(ends) == quarters and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1, (len(starts), len(ends)))
    ok("actionNumber 1..n in order", [e["actionNumber"] for e in raw["pbp"]] == list(range(1, len(raw["pbp"]) + 1)))
    num = {e["actionNumber"]: e for e in raw["pbp"]}
    drawn = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    ok("every drawn foul points at a foul by the other side",
       drawn and all(num.get(e.get("previousAction"), {}).get("actionType") == "foul" and num[e["previousAction"]]["tno"] != e["tno"] for e in drawn), len(drawn))
    st = b.stints or []
    ok(f"stints cover the {want * 12} seconds", abs(sum(float(x.get("duration") or 0) for x in st) - want * 12) < 2, sum(float(x.get("duration") or 0) for x in st))
    ok("...and add up to the final", (sum(int(x.get("home_points") or 0) for x in st), sum(int(x.get("away_points") or 0) for x in st)) == final)
    rim = [s for t in ("1", "2") for s in raw["tm"][t]["shot"] if s["subType"] in ("layup", "dunk", "alleyoop")]
    ok("every lay-up, dunk and alley-oop at the rim (within 1.22 m)", rim and all(shot_dist_to_nearest_rim(s["x"], s["y"]) <= 1.22 for s in rim), len(rim))
    threes = [shot_dist_to_nearest_rim(s["x"], s["y"]) for t in ("1", "2") for s in raw["tm"][t]["shot"] if s["actionType"] == "3pt"]
    ok("threes are drawn beyond the arc (most of them: the taps are coarse)", threes and sum(d > 6.75 for d in threes) / len(threes) > 0.85,
       sum(d > 6.75 for d in threes) / max(1, len(threes)))
    ok("nothing in the feed the adapter does not know", raw["ibsl"]["unknown"] == [], raw["ibsl"]["unknown"])
    return raw, b


raw47, b47 = check_game("Ramat Gan 84-67 Rishon (Segev 47, 2025-26)", "26390", "47", 4, (84, 67), 2026)
ok("the clubs: TeamUID codes (13, 5), basket.co.il's names and short names",
   (raw47["tm"]["1"]["code"], raw47["tm"]["2"]["code"], raw47["tm"]["1"]["name"], raw47["tm"]["2"]["shortName"])
   == ("13", "5", "Maccabi Cnaan Group Ramat Gan", "M. Rishon"), (raw47["tm"]["1"]["code"], raw47["tm"]["2"]["code"]))
ok("the box's own totals: biggest lead, paint, bench", raw47["tm"]["1"]["tot_sBiggestLead"] == 20 and raw47["tm"]["1"]["tot_sPointsInThePaint"] == 24
   and raw47["tm"]["1"]["tot_sBenchPoints"] == 28)
ok("quarter scores 22-20-18-24 v 14-22-17-14", [raw47["tm"]["1"][f"p{q}_score"] for q in range(1, 5)] == [22, 20, 18, 24]
   and [raw47["tm"]["2"][f"p{q}_score"] for q in range(1, 5)] == [14, 22, 17, 14])
ok("free throws read k of n", {e["subType"] for e in raw47["pbp"] if e["actionType"] == "freethrow"} <= {"1of1", "1of2", "2of2", "1of3", "2of3", "3of3"})
ok("a status of final", b47.status == "final")

raw56, b56 = check_game("Netanya 95-93 Ramat Gan, two overtimes (Segev 56)", "26397", "56", 6, (95, 93), 2026)
ok("the overtimes are OVERTIME periods 1 and 2", sorted({(e["periodType"], e["period"]) for e in raw56["pbp"] if e["actionType"] == "period"})
   == [("OVERTIME", 1), ("OVERTIME", 2), ("REGULAR", 1), ("REGULAR", 2), ("REGULAR", 3), ("REGULAR", 4)])

print("\nEilat 98-101 Herzliya, the 2026-27 cup (Segev 398)")
raw398 = I.raw_from_game(rows["26637"], teams_of[2027], SEGEV[("getActions", "398")], SEGEV[("getBoxScore", "398")], finished=True)
ok("2026-27's foul kinds and replay reviews are all known", raw398["ibsl"]["unknown"] == [], raw398["ibsl"]["unknown"])
ok("the final is basket.co.il's 98-101", (raw398["tm"]["1"]["score"], raw398["tm"]["2"]["score"]) == (98, 101))
ok("every player's box line = his own actions", recount(raw398) == [], recount(raw398)[:2])

# ---------------------------------------------------------------------------------------------------------- habits
print("\nSegev's habits")
ok("foul kinds with a reason after them are their family", (I.foul_kind("unsportsmanlike-flagrant"), I.foul_kind("unsportsmanlike-disruptive"),
   I.foul_kind("technical-administrative"), I.foul_kind("OffensiveFoulUnsportsmanlike"), I.foul_kind("personal"), I.foul_kind("x"))
   == ("unsportsmanlike", "unsportsmanlike", "technical", "unsportsmanlike", "personal", None))
ok("a bench's administrative technical is the bench's or coach's", I.classify({"type": "foul", "playerId": 0, "parameters": {"type": "technical-administrative", "isBenchFoul": 1}})[:2]
   == ("foul", "benchtechnical"))
info = SEGEV[("getActions", "47")]["result"]["gameInfo"]
h = info["homeTeam"]["players"]
P = lambda i: str(h[i]["id"])  # noqa: E731


def mini(acts):
    base = [{"quarter": 1, "type": "quarter", "parameters": {"type": "start-of-quarter", "quarter": 1}, "id": 1, "quarterTime": "10:00", "playerId": 0, "teamId": 0}]
    for n, a in enumerate(acts, start=2):
        a.setdefault("id", n)
        a.setdefault("parentActionId", 0)
        base.append(a)
    return {"result": {"gameInfo": info, "actions": base}}


def sub(q, clock, pid, way):
    return {"quarter": q, "type": "substitution", "quarterTime": clock, "playerId": int(pid), "teamId": int(info["homeTeam"]["id"]),
            "parameters": {"team": 1, "playerIn": "1" if way == "in" else None, "playerOut": "1" if way == "out" else None}}


def shot(q, clock, pid):
    return {"quarter": q, "type": "shot", "quarterTime": clock, "playerId": int(pid), "teamId": int(info["homeTeam"]["id"]), "score": "2-0",
            "parameters": {"team": 1, "points": 2, "type": "jump-shot", "made": "made", "coordX": 750, "coordY": 600}}


raw = I.raw_from_game(rows["26390"], teams_of[2026], mini([shot(1, "05:30", P(0)), sub(1, "05:20", P(0), "out"), sub(1, "05:19", P(1), "out"),
                                                            {"quarter": 1, "type": "clock", "quarterTime": "05:18", "playerId": 0, "teamId": 0, "parameters": {}},
                                                            sub(1, "05:17", P(2), "in"), sub(1, "05:16", P(3), "in"), shot(1, "05:00", P(2))]),
                      SEGEV[("getBoxScore", "47")], finished=False)
gts = [e["gt"] for e in raw["pbp"] if e["actionType"] == "substitution" and "inferred" not in e["qualifier"]]
ok("a change typed across running seconds (5:20, 5:19, 5:17, 5:16) is one moment, at 5:20", gts == ["05:20"] * 4, gts)
inf = [(e["gt"], e["pno"]) for e in raw["pbp"] if "inferred" in e["qualifier"]]
ok("a side that starts a period with nobody recorded on: whoever acts for it before coming on starts it (inferred)",
   inf == [("10:00", P(0))] and raw["ibsl"]["inferred"] == [{"period": 1, "periodType": "REGULAR", "side": 1, "pno": P(0)}], inf)
raw = I.raw_from_game(rows["26390"], teams_of[2026], mini([shot(1, "05:30", P(0)), sub(1, "00:00", P(0), "out"),
                                                            {"quarter": 2, "type": "quarter", "parameters": {"type": "start-of-quarter", "quarter": 2}, "quarterTime": "10:00", "playerId": 0, "teamId": 0},
                                                            sub(2, "10:00", P(2), "in"), shot(2, "09:00", P(2))]),
                      SEGEV[("getBoxScore", "47")], finished=False)
seq = [(e["actionType"], e["subType"], e["period"]) for e in raw["pbp"]]
ok("a change at a period's 0:00 belongs to the next period, after its start",
   seq.index(("period", "start", 2)) < seq.index(("substitution", "out", 2)) and ("substitution", "out", 1) not in seq, seq)
ok("a game still on: no final whistle, the clock the box's", not any(e["actionType"] == "game" for e in raw["pbp"]))
raw = I.raw_from_game(rows["26390"], teams_of[2026], mini([shot(1, "05:30", P(0)), sub(1, "00:01", P(0), "out"),
                                                            {"quarter": 1, "type": "quarter", "parameters": {"type": "end-of-quarter", "quarter": 1}, "quarterTime": "00:00", "playerId": 0, "teamId": 0},
                                                            {"quarter": 2, "type": "quarter", "parameters": {"type": "start-of-quarter", "quarter": 2}, "quarterTime": "10:00", "playerId": 0, "teamId": 0},
                                                            sub(2, "10:00", P(2), "in"), shot(2, "09:00", P(2))]),
                      SEGEV[("getBoxScore", "47")], finished=False)
seq = [(e["actionType"], e["subType"], e["period"]) for e in raw["pbp"]]
ok("...and one typed at 0:01 with nothing after it but the quarter's end too", ("substitution", "out", 2) in seq and ("substitution", "out", 1) not in seq, seq)

# ---------------------------------------------------------------------------------------------------------- final or held
print("\nfinal or held")
box = lambda h, a, fin: {"result": {"boxscore": {"gameInfo": {"homeScore": str(h), "awayScore": str(a), "gameFinished": fin}}}}  # noqa: E731
acts = lambda end: {"result": {"gameInfo": {}, "actions": ([{"type": "game", "parameters": {"type": "end-of-game"}}] if end else [])}}  # noqa: E731
r = dict(rows["26626"])
ok("an awarded game (basket.co.il 20-1, the feed 77-67 after three quarters) is held, and says why",
   I.decide(r, acts(True), box(77, 67, True), 10 * 3600)[1] and "20-1" in I.decide(r, acts(True), box(77, 67, True), 10 * 3600)[1])
r = dict(rows["26390"])
ok("Segev's flag never set, basket.co.il's same score three hours on: final", I.decide(r, acts(False), box(84, 67, False), 4 * 3600) == (True, None))
ok("...an hour in, no flag: still on", I.decide(r, acts(False), box(84, 67, False), 3600) == (False, None))
r2 = dict(r, score_team1="0", score_team2="0")
ok("Segev's end-of-game with nothing posted yet: final", I.decide(r2, acts(True), box(84, 67, False), 2 * 3600) == (True, None))
ok("a feed half-way through a game posted earlier is not held until three hours on", I.decide(r, acts(False), box(40, 38, False), 3600) == (False, None))

# ---------------------------------------------------------------------------------------------------------- fetch
print("\nfetch")
CALLS.clear()
b = A.fetch("26390", {"season": "2025-26", "_tipoff_at": "2025-10-12T10:00:00+00:00"})
ok("a played game: the bundle, final, its clubs", b is not None and b.status == "final" and (b.home_name, b.away_name)
   == ("Maccabi Cnaan Group Ramat Gan", "Maccabi Tapuzina Rishon LeZion"), b and (b.status, b.home_name))
ok("...two Segev calls (the actions carry the sheet)", sum(1 for u, _ in CALLS if u == I.SEGEV) == 2, [p.get("method") for u, p in CALLS if u == I.SEGEV])
CALLS.clear()
ok("a game with no Segev id yet is not fetched, and Segev is not asked",
   A.fetch("26672", {"season": "2026-27", "_tipoff_at": "2026-11-01T12:00:00+00:00"}) is None and not any(u == I.SEGEV for u, _ in CALLS))
ok("a game days away is not fetched at all", A.fetch("26646", {"season": "2026-27", "_tipoff_at": "2099-01-01T00:00:00+00:00"}) is None)

# ---------------------------------------------------------------------------------------------------------- shots
print("\nshot chart")
xy = I.shot_xy({"type": "jump-shot", "coordX": 420, "coordY": 728})
ok("a jump shot stays where it was tapped: 6.80 m out", abs(shot_dist_to_nearest_rim(*xy) - math.hypot((420 - 750) * 1.12, 728 - 157.5) / 100) < 0.01,
   shot_dist_to_nearest_rim(*xy))
xy = I.shot_xy({"type": "lay-up", "coordX": 570, "coordY": 252})
ok("a lay-up tapped 2.2 m out is drawn back to the rim, on its side", shot_dist_to_nearest_rim(*xy) <= 1.22 and xy[1] < 50, (shot_dist_to_nearest_rim(*xy), xy))

# ---------------------------------------------------------------------------------------------------------- site + bio
print("\nsite and bio")
ok("brand/flags/il.svg", os.path.exists(os.path.join(ROOT, "epinoia", "brand", "flags", "il.svg")))
for rel in ("epinoia/country.js", "epinoia/nav.js"):
    m = re.search(r"HAVE_FLAG = \[([^\]]*)\]", open(os.path.join(ROOT, *rel.split("/")), encoding="utf-8").read())
    ok(f"IL in HAVE_FLAG ({rel})", m is not None and "'IL'" in m.group(1))
import bio_sources  # noqa: E402
ok("the bio reader: basket.co.il's rosters for winner-league, its dates day-first",
   bio_sources.READERS.get("winner-league") is bio_sources.ibsl and bio_sources._dmy("04/12/1994") == "1994-12-04" and bio_sources._dmy("1994-12-04") is None)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
