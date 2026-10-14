"""The LKL (adapters/lkl.py), offline, over captured lkl.lt replies:

    python scripts/ingest/lkl_test.py

What it holds the adapter to:
  * the schedule: the league's calendar read whole (180 games, 10 clubs x 36), every club coded by
    the league's own team id and crested, tip-offs in UTC, a pair's fifth meeting a play-off;
  * one game: every player's box exactly the league's own, both clubs' totals exactly its team
    line, the score and quarters adding up, home and away found even where the feed lists the away
    side first, the play-by-play numbered 1..n in play order with each period opened and closed
    once, every drawn foul on its foul, every attempt on the shot chart, five a side throughout
    (starters inferred where an older box flags none, a split substitution put back together, an
    overtime that is ONE overtime), stints covering the game and summing to the score, and the
    event log translate() builds dropping nothing and summing to every box;
  * a game still being played: live, no final whistle invented;
  * a past season (a backfill): read off the results list for that season's id, never the calendar;
    a triple round robin split from its play-offs even with a league game never played; the clubs
    that have left coded off their own pages; a season not listed, or answered with another's games,
    giving nothing; a game whose feed kept only the box published as a result once it is old.

Fixtures live in scripts/ingest/data/lkl/ (captured 2026-09-23; the 2023-24 results list, the club
page lines and game 10886 on 2026-10-14). The sweep behind them: 21 games over 2025/26 and 2026/27,
all passing these same checks.
"""
import copy
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import lkl as K  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "lkl")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def text(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


def game(gid):
    return json.loads(text(f"game-{gid}.json"))


GAMES = ("11583", "11580", "11305", "11420", "11340")


class Offline(K.LklAdapter):
    requests_made: list = []

    def _get(self, url, accept="*/*"):
        self.requests_made.append(url)
        return None

    def _text(self, url, fresh=False):
        self.requests_made.append(url)
        name = {K.CALENDAR: "calendar-all.ics", K.SCHEDULE_PAGES[0]: "tvarkarastis.html",
                K.SCHEDULE_PAGES[1]: "rezultatai.html"}.get(url)
        return text(name) if name else ""

    def _json(self, kind, gid):
        self.requests_made.append(f"{kind}/{gid}")
        return game(gid).get(kind) if os.path.exists(os.path.join(DATA, f"game-{gid}.json")) else None


def fresh():
    Offline.requests_made = []
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


def secs(mmss):
    m, s = mmss.split(":")[:2]
    return int(m) * 60 + int(s)


# ============================================================================ the schedule
print("-- the calendar and discover()")
cal = K.parse_calendar(text("calendar-all.ics"))
ok("the calendar: 180 games, each with its id, a Vilnius tip-off turned UTC, home and away",
   len(cal) == 180 and all(g["id"].isdigit() and g["tip"] and g["home"] and g["away"] for g in cal), len(cal))
g0 = next(g for g in cal if g["id"] == "11578")
ok("11578 Gargždai v Žalgiris: 17 Sep 2026 18:30 Vilnius = 15:30 UTC",
   (g0["home"], g0["away"], g0["tip"]) == ("Gargždai", "Žalgiris", "2026-09-17T15:30:00+00:00"), g0)
a = fresh()
reg = list(a.discover("https://www.lkl.lt/tvarkarastis", {"stage": "regular"}))
per = defaultdict(int)
for g in reg:
    per[g.extra["home_code"]] += 1
    per[g.extra["away_code"]] += 1
ok("the regular season: 180 games, 10 clubs x 36, every club coded by its league team id",
   len(reg) == 180 and len(per) == 10 and set(per.values()) == {36} and None not in per, dict(per))
codes = {g.home_name: g.extra["home_code"] for g in reg}
ok("the codes are the schedule filter's (Hipocredit 41, Žalgiris 3, Nevėžis-Paskolų klubas 11)",
   (codes.get("Hipocredit"), codes.get("Žalgiris"), codes.get("Nevėžis-Paskolų klubas")) == ("41", "3", "11"),
   codes)
ok("every club has an https crest", all((g.extra["home_logo"] or "").startswith("https://") for g in reg))
ok("the play-off source finds nothing yet", list(a.discover("x#playoffs", {"stage": "playoffs"})) == [])
fake = cal + [dict(cal[0], id="99999", local="20270520T183000")]
ok("a pair's fifth meeting is a play-off", K.playoff_ids(fake) == {"99999"}, K.playoff_ids(fake))
try:
    list(fresh().discover("x", {"stage": "cup"}))
    raised = False
except ValueError:
    raised = True
ok("a stage that is neither regular nor playoffs is an error", raised)
ok("the registry knows it", type(get_adapter("lkl")).__name__ == "LklAdapter")

# ============================================================================ one game
print("\n-- fetch(): one game, end to end, against the league's own box")


def check(label, b, g):
    raw = b.raw
    box = g["boxscore"]["boxscore"]
    diffs = []
    for s, side in (("1", "home"), ("2", "away")):
        for r in box[side]["players"]:
            p = raw["tm"][s]["pl"].get(r["slug"])
            if p is None:
                diffs.append(f"{r['slug']} missing")
                continue
            want = {"sPoints": r["points"]["value"], "sAssists": r["assists"]["value"], "sSteals": r["steals"]["value"],
                    "sTurnovers": r["turnovers"]["value"], "sBlocks": r["blocks"]["value"],
                    "sFoulsPersonal": r["fouls"]["value"], "sFoulsOn": r["fouls_on"]["value"],
                    "sReboundsOffensive": r["offensive_rebounds"]["value"], "sReboundsDefensive": r["defensive_rebounds"]["value"],
                    "sFreeThrowsMade": K._pair(r["ft"]["value"])[0], "sFreeThrowsAttempted": K._pair(r["ft"]["value"])[1],
                    "sThreePointersMade": K._pair(r["fg3"]["value"])[0], "sTwoPointersAttempted": K._pair(r["fg2"]["value"])[1]}
            for k, v in want.items():
                if p[k] != (v or 0):
                    diffs.append(f"{p['name']} {k} {p[k]} != {v}")
    ok(f"{label}: every player's box = the league's box", not diffs, diffs[:5])
    sc = {"1": g["game-score"]["home"], "2": g["game-score"]["away"]}
    gs = g["boxscore"]["gameStatistics"]
    ok(f"{label}: home is the team whose points are the home score (team ids {raw['lkl']['homeTeamId']} / {raw['lkl']['awayTeamId']})",
       gs[raw["lkl"]["homeTeamId"]]["points"] == sc["1"] and gs[raw["lkl"]["awayTeamId"]]["points"] == sc["2"])
    ok(f"{label}: final score {sc['1']}-{sc['2']}, the quarters the league's own, the periods adding up",
       all(raw["tm"][s]["score"] == sc[s] and sum(v for k, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k)) == sc[s]
           for s in "12")
       and all(raw["tm"][s][f"p{q}_score"] == gs[tid]["quarter_scores"][str(q)]
               for s, tid in (("1", raw["lkl"]["homeTeamId"]), ("2", raw["lkl"]["awayTeamId"])) for q in range(1, 5)))
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    an = [e["actionNumber"] for e in raw["pbp"]]
    el = [(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0), -secs(e["gt"])) for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n in play order, the clock never running backwards",
       an == list(range(1, len(an) + 1)) and all(x <= y for x, y in zip(el, el[1:])))
    npers = raw["period"]
    starts = sum(1 for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start")
    ends = sum(1 for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end")
    ok(f"{label}: {npers} periods, each opened and closed once, the final whistle last",
       starts == ends == npers and raw["pbp"][-1]["actionType"] == "game")
    fo = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    ok(f"{label}: every drawn foul points at a foul ({len(fo)})", fo and all(e.get("previousAction") for e in fo))
    shots = sum(1 for e in raw["pbp"] if e["actionType"] in ("2pt", "3pt"))
    ok(f"{label}: every attempt on the shot chart ({raw['lkl']['shotsJoined']}/{shots})", raw["lkl"]["shotsJoined"] == shots)
    on = {s: {k for k, p in raw["tm"][s]["pl"].items() if p["starter"]} for s in "12"}
    ok(f"{label}: five starters a side", all(len(on[s]) == 5 for s in "12"), [len(on[s]) for s in "12"])
    sec_on, last, six = defaultdict(float), 0.0, []
    for e in raw["pbp"]:
        q = e["period"] + (4 if e["periodType"] == "OVERTIME" else 0)
        t = sum(600 if i <= 4 else 300 for i in range(1, q)) + (600 if q <= 4 else 300) - secs(e["gt"])
        for s in "12":
            for k in on[s]:
                sec_on[(s, k)] += t - last
        last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
        elif e["actionType"] != "substitution" and any(len(on[s]) != 5 for s in "12"):
            six.append(e["actionNumber"])
    ok(f"{label}: five a side at every action", not six, six[:5])
    md = [f"{p['name']} {sec_on[(s, k)]:.0f}s != {p['sMinutes']}" for s in "12" for k, p in raw["tm"][s]["pl"].items()
          if abs(sec_on[(s, k)] - secs(p["sMinutes"])) > 5]
    ok(f"{label}: every player's minutes from the substitutions = the box minutes (within 5 s)", not md, md[:4])
    length = 2400 + 300 * max(0, npers - 4)
    ok(f"{label}: {len(b.stints)} stints, five a side, covering {length}s, summing to the score",
       b.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints)
       and abs(sum(r["duration"] for r in b.stints) - length) < 0.01
       and (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (sc["1"], sc["2"]))
    tr = translate(raw)
    rep = tr["report"]
    ok(f"{label}: translate() drops nothing, matches every player, warns of nothing",
       not rep["dropped"] and rep["unmatched"] == 0 and not rep["warnings"], (rep["dropped"], rep["unmatched"], rep["warnings"][:2]))
    tally = defaultdict(lambda: defaultdict(int))
    drawn = defaultdict(int)
    for e in tr["events"]:
        if e["t"] == "foul" and e["payload"].get("drawn"):
            drawn[e["payload"]["drawn"]] += 1
        if not e["pid"]:
            continue
        s, t = tally[e["pid"]], e["t"]
        if t in ("p2_made", "p3_made", "ft_made"):
            s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
        if t in ("ast", "stl", "blk", "to", "foul"):
            s[t] += 1
        if t == "reb":
            s["oreb" if e["payload"]["off"] else "dreb"] += 1
    ed = []
    for i, s in enumerate("12"):
        for pno, p in raw["tm"][s]["pl"].items():
            e = tally.get(f"{i}:{pno}", {})
            for k, v in (("pts", p["sPoints"]), ("ast", p["sAssists"]), ("stl", p["sSteals"]), ("blk", p["sBlocks"]),
                         ("to", p["sTurnovers"]), ("foul", p["sFoulsPersonal"]), ("oreb", p["sReboundsOffensive"]),
                         ("dreb", p["sReboundsDefensive"])):
                if e.get(k, 0) != v:
                    ed.append(f"{p['name']} {k} log={e.get(k, 0)} box={v}")
            if drawn.get(f"{i}:{pno}", 0) != p["sFoulsOn"]:
                ed.append(f"{p['name']} drawn log={drawn.get(f'{i}:{pno}', 0)} box={p['sFoulsOn']}")
    ok(f"{label}: the event log sums to every player's box, fouls drawn included", not ed, ed[:6])


LABELS = {"11583": "the saved game (Hipocredit v Nevėžis)", "11580": "an overtime game",
          "11305": "an older game (the coach on team actions, no starters flagged)",
          "11420": "a substitution split around another action", "11340": "the feed listing the away side first"}
for gid in GAMES:
    a = fresh()
    b = a.fetch(gid, {})
    if b is None:
        ok(f"{gid}: fetch returned a bundle", False)
        continue
    check(f"{gid} {LABELS[gid]}", b, game(gid))
    if gid == "11580":
        ok("11580: ONE overtime (its opening substitutions are typed before its start marker)", b.raw["period"] == 5)
    if gid == "11583":
        ok("11583: the club codes are the team ids (Hipocredit 41, Nevėžis-Paskolų klubas 11)",
           (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]) == ("41", "11"), (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]))
        ok("11583: names are the play-by-play's full names", "Donatas Sabeckis" in {p["name"] for p in b.raw["tm"]["1"]["pl"].values()})

print("\n-- a game still being played")
live = copy.deepcopy(game("11583"))
q = live["play-by-play"]["quarters"]
q["regular"] = {k: v for k, v in q["regular"].items() if k in ("1", "2")}
q["regular"]["2"] = [e for e in q["regular"]["2"] if not (e["type"] == "period" and e["subtype"] == "end")]
raw = K.raw_from_game(live["boxscore"], live["play-by-play"], None, {"home": 41, "away": 38}, {}, "11583")
ok("in Q2: live, no final whistle, Q1 closed and Q2 open",
   FibaLiveStatsAdapter._status(raw) == "live" and raw["period"] == 2 and not any(e["actionType"] == "game" for e in raw["pbp"])
   and [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == [1])
ok("a game with no action yet has no payload", K.raw_from_game({}, {"quarters": {"regular": {}, "overtime": []}}) is None)
ok("a key that is not an LKL game id is not fetched", fresh().fetch("x-1", {}) is None)

# ============================================================================ a past season
# data/lkl/results-2023-24/ is the whole of 2023-24's results list as lkl.lt served it (20 pages,
# 2026-10-14); team-pages.txt the "teamId" line of the three clubs that have since left the league;
# game-10886.json a 2023-24 game whose feed kept the box and no plays.
print("\n-- a past season (a backfill): the results list, never the calendar")


class Reply:
    def __init__(self, text):
        self.text, self.encoding = text, "utf-8"


TEAM_LINES = dict(line.split("\t", 1) for line in text("team-pages.txt").splitlines() if "\t" in line)


class OfflinePast(Offline):
    """Offline, plus the results list: every season id is answered with 2023-24's pages (so a season
    asked for under another id is the site ignoring its filter)."""

    def _get(self, url, accept="*/*"):
        self.requests_made.append(url)
        page = re.search(r"loadResults\?.*\bpage=(\d+)", url)
        if page:
            p = os.path.join(DATA, "results-2023-24", "2023-24_%02d.html" % int(page.group(1)))
            return Reply(open(p, encoding="utf-8").read()) if os.path.exists(p) else None
        team = re.search(r"/komandos/([a-z0-9-]+)$", url)
        if team:
            return Reply(TEAM_LINES.get(team.group(1), "")) if team.group(1) in TEAM_LINES else None
        return None


def fresh_past():
    for cache in (K.LklAdapter._seasons, K.LklAdapter._team_ids, K.LklAdapter._past_clubs, K.LklAdapter._past_games):
        cache.clear()
    fresh()
    return OfflinePast()


seasons = K.parse_seasons(text("rezultatai.html"))
ok("the season filter: 2026-27 selected, 2023-24 is 34698, 2024-25 39252 (the KMT's own select ignored)",
   seasons["current"] == 2026 and seasons["ids"].get(2023) == "34698" and seasons["ids"].get(2024) == "39252"
   and "49437" not in seasons["ids"].values(), seasons)
rows, last = K.parse_results_page(text(os.path.join("results-2023-24", "2023-24_01.html")))
ok("a results page: ten games, the last page 20, the final 11112 Rytas v Žalgiris 12 Jun 2024 18:30 Vilnius = 15:30 UTC",
   len(rows) == 10 and last == 20 and (rows[0]["id"], rows[0]["home"]["slug"], rows[0]["away"]["slug"], rows[0]["tip"],
                                        rows[0]["home"]["code"], rows[0]["scored"])
   == ("11112", "rytas", "zalgiris", "2024-06-12T15:30:00+00:00", "RYT", True), (len(rows), last, rows[0]))
cur, _ = K.parse_results_page(text("rezultatai.html"))
ok("the current season's results page reads the same way (hall with its town)",
   cur and cur[0]["id"] == "11583" and cur[0]["venue"] == "Jonavos sporto arena, Jonava", cur[:1])

a = fresh_past()
reg = list(a.discover("https://www.lkl.lt/tvarkarastis", {"stage": "regular", "season": "2023-24"}))
read_once = len(a.requests_made)
po = list(a.discover("https://www.lkl.lt/tvarkarastis#playoffs", {"stage": "playoffs", "season": "2023-24"}))
per = defaultdict(int)
for g in reg:
    per[(g.home_name, g.extra["home_code"])] += 1
    per[(g.away_name, g.extra["away_code"])] += 1
ok("2023-24 regular: 164 games, 11 clubs, a triple round robin (30 each; Wolves and Lietkabelis 29 - one game never played)",
   len(reg) == 164 and len(per) == 11 and sorted(set(per.values())) == [29, 30], (len(reg), dict(per)))
ok("2023-24 play-offs: 26 games, the bronze series' opener 11110 (4 Jun 2024) among them, none before 12 May",
   len(po) == 26 and "11110" in {g.external_id for g in po} and min(g.tipoff_at for g in po) >= "2024-05-12",
   (len(po), sorted(g.external_id for g in po)[:5]))
ok("every game dated inside 2023-24, the calendar (2026-27's) never read",
   all("2023-07-01" <= g.tipoff_at <= "2024-08-15" for g in reg + po) and not any("kalendorius" in u for u in a.requests_made),
   [u for u in a.requests_made if "kalendorius" in u])
codes = {name: code for (name, code) in per}
ok("every club coded by its league team id: the filter's for the clubs still in the league, the club page's for the "
   "three that left (Wolves Twinsbet 9, Pieno žvaigždės 7, M Basket-Delamode 14)",
   None not in codes.values() and (codes.get("Hipocredit"), codes.get("Wolves Twinsbet"), codes.get("Pieno žvaigždės"),
                                   codes.get("M Basket-Delamode")) == ("41", "9", "7", "14"), codes)
ok("the season read once: 20 results pages and 3 club pages, the play-off row asking for neither again",
   sum("loadResults" in u for u in a.requests_made) == 20 and sum("/komandos/" in u for u in a.requests_made) == 3
   and not any("loadResults" in u or "/komandos/" in u for u in a.requests_made[read_once:]), a.requests_made[read_once:])
a = fresh_past()
ok("a season the site does not list: nothing, and no results page asked for",
   list(a.discover("x", {"stage": "regular", "season": "1979-80"})) == [] and not any("loadResults" in u for u in a.requests_made))
a = fresh_past()
ok("a season answered with another season's games (the filter ignored): nothing, not those games",
   list(a.discover("x", {"stage": "regular", "season": "2022-23"})) == [])
a = fresh_past()
ok("the season being played, asked for by name, is still the calendar's 180",
   len(list(a.discover("x", {"stage": "regular", "season": "2026-27"}))) == 180)
ok("the commonest meeting count is the round robin's; a tie goes to the smaller",
   K.regular_meetings([{"home": "a", "away": "b"}] * 3 + [{"home": "a", "away": "c"}] * 4) == 3)

print("\n-- a past game with a box and no plays (2021-22 to 2023-24): a result")
g10886 = game("10886")
raw = K.box_only_raw(g10886["boxscore"], g10886["game-score"], {}, "10886")
gs = g10886["boxscore"]["gameStatistics"]
ok("10886: home is Pieno žvaigždės (7) 71, away Žalgiris (3) 98, the quarters the league's own",
   raw and (raw["lkl"]["homeTeamId"], raw["lkl"]["awayTeamId"], raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == ("7", "3", 71, 98)
   and all(raw["tm"]["1"][f"p{q}_score"] == gs["7"]["quarter_scores"][str(q)] for q in range(1, 5))
   and sum(raw["tm"]["2"][f"p{q}_score"] for q in range(1, 5)) == 98, raw and raw["lkl"])
box = g10886["boxscore"]["boxscore"]
bad = [r["slug"] for s, side in (("1", "home"), ("2", "away")) for r in box[side]["players"]
       if raw["tm"][s]["pl"][r["slug"]]["sPoints"] != (r["points"]["value"] or 0)]
ok("10886: every player's points the league's, no play-by-play, nobody's points called the bench's",
   not bad and raw["pbp"] == [] and raw["tm"]["1"]["tot_sBenchPoints"] == 0, bad)
ok("a reply whose score is level (or missing) is not a result", K.box_only_raw(g10886["boxscore"], {"home": 71, "away": 71}) is None
   and K.box_only_raw(g10886["boxscore"], {}) is None)


a = fresh_past()
K.LklAdapter._past_clubs["7"] = {"name": "Pieno žvaigždės", "code": "PIE", "logo": None}
b = a.fetch("10886", {"_tipoff_at": "2024-03-01T16:00:00+00:00"})
ok("fetch: published as a result - final, not translated, no stints, the league's names",
   b is not None and (b.status, b.translate, b.stints, b.home_name, b.away_name) == ("final", False, [], "Pieno žvaigždės", "Žalgiris"),
   b and (b.status, b.translate, len(b.stints), b.home_name, b.away_name))
from datetime import datetime, timedelta, timezone  # noqa: E402
recent = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
ok("fetch: the same game three hours old is left alone (its plays may yet come)", fresh_past().fetch("10886", {"_tipoff_at": recent}) is None)

print("\n-- a 2020-21 game whose box has no away side (9714: the plays and the results list say 79-68)")
b = fresh_past().fetch("9714", {"_tipoff_at": "2021-03-03T16:00:00+00:00"})
ok("9714: 79-68 from the plays, not the empty box's (and the score reply's) 79-0; each quarter the plays'",
   b is not None and (b.raw["tm"]["1"]["score"], b.raw["tm"]["2"]["score"]) == (79, 68)
   and [b.raw["tm"]["2"][f"p{q}_score"] for q in range(1, 5)] == [12, 14, 16, 26],
   b and (b.raw["tm"]["1"]["score"], b.raw["tm"]["2"]["score"]))
ok("9714: a result - final, not translated, no stints (the away five cannot be put on court)",
   b is not None and (b.status, b.translate, b.stints) == ("final", False, []), b and (b.status, b.translate, len(b.stints)))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
