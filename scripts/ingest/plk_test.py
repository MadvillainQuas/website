"""The ORLEN Basket Liga (adapters/plk.py), offline, over captured plk.pl API replies:

    python scripts/ingest/plk_test.py

What it holds the adapter to:
  * the schedule: a season token read right and resolved by the league's own season list, the cup
    and the Superpuchar never discovered, "regular" and "playoffs" kept apart, the key the PLK
    game id, the club code the PLK club id (and a renamed club still the same code), tip-offs in
    UTC, a season plk.pl does not have refused rather than read as an empty one;
  * one game: every player's box exactly the league's own, both clubs' totals exactly its sum row,
    the final score and the periods adding up to it, the play-by-play numbered 1..n in play order
    with each period opened and closed once, stints five a side covering the whole game and
    summing to the score, and the event log translate() builds dropping nothing and summing to the
    same box - including the two repairs (a split substitution, one player under two ids);
  * a game still being played: live, clock and period from the feed, no final whistle invented.

Fixtures live in scripts/ingest/data/plk/ (captured 2026-09-23, trimmed to what the adapter reads:
each action's "element" echo and the news / TV / referee blocks dropped).
"""
import copy
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import plk as P  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "plk")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


GAMES = ("200474", "200475", "200477", "179630", "223310")
SCHEDULES = {0: "schedule-2026-27.json", 29: "schedule-2026-27.json", 28: "schedule-2025-26.json"}


class Offline(P.PlkAdapter):
    """The real adapter with its network calls served from the fixtures."""
    requests_made: list = []

    def _get_json(self, url):
        self.requests_made.append(url)
        m = re.search(r"/schedule(?:\?seasonId=(\d+))?$", url)
        if m:
            name = SCHEDULES.get(int(m.group(1) or 0))
            return load(name) if name else {"seasons": [], "schedule": []}
        m = re.search(r"/game/(\d+)$", url)
        if m and m.group(1) in GAMES:
            return load(f"game-{m.group(1)}.json")
        return None


def fresh():
    P.PlkAdapter._schedules = {}
    Offline.requests_made = []
    # the production path: the Actions runner has no scraper folder, so stints come from stints.py
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


# ============================================================================ the vocabulary
print("-- the vocabulary")
cases = {
    ("5, J. Kowalski", "celny z wyskoku za 2"): ("2pt", "jumpshot", 1),
    ("5, J. Kowalski", "niecelny z wyskoku za 3"): ("3pt", "jumpshot", 0),
    ("5, J. Kowalski", "celny lay-up z drugiej strony za 2"): ("2pt", "reverselayup", 1),
    ("5, J. Kowalski", "celny alley-oop wsad za 2"): ("2pt", "alleyoopdunk", 1),
    ("5, J. Kowalski", "celny rzut wolny 2z3"): ("freethrow", "2of3", 1),
    ("5, J. Kowalski", "niecelny rzut wolny 1z1"): ("freethrow", "1of1", 0),
    ("5, J. Kowalski", "faul w ataku"): ("foul", "offensive", None),
    ("5, J. Kowalski", "strata - błąd kroków"): ("turnover", "travel", None),
    ("5, J. Kowalski", "zmiana - zejście"): ("substitution", "out", None),
}
for (at, sub), want in cases.items():
    a, st, succ, _, unk = P.classify({"actionType": at, "actionSubType": sub, "playerId": 7, "teamId": 1})
    ok(f"'{sub}' -> {want}", (a, st, succ) == want and unk is None, (a, st, succ, unk))
a, st, _, q, unk = P.classify({"actionType": "zbiórka w obronie", "teamId": 1, "playerId": 0})
ok("a team rebound is a rebound with qualifier 'team'", (a, st, q, unk) == ("rebound", "defensive", ["team"], None))
a, *_, unk = P.classify({"actionType": "5, J. Kowalski", "actionSubType": "coś nowego", "playerId": 7, "teamId": 1})
ok("a string the tables do not know records nothing and is reported", a is None and unk == "player:coś nowego", unk)

# ============================================================================ discover()
print("\n-- seasons and discover()")
ok("season 2026/27 is the PLK's id 29, 2025/26 is 28 (from the league's own season list)",
   P.season_id_for("2026/2027", load("schedule-2026-27.json")) == 29
   and P.season_id_for("2025/2026", load("schedule-2026-27.json")) == 28)
ok("a season plk.pl has never had names no id", P.season_id_for("1999/2000", load("schedule-2026-27.json")) is None)
ok("no season configured = the current season", P.PlkAdapter._season({}) == P.current_season())
ok("UTC tip-offs: '2026-10-02T16:00:00.000Z' -> '2026-10-02T16:00:00+00:00'",
   P.utc_iso("2026-10-02T16:00:00.000Z") == "2026-10-02T16:00:00+00:00", P.utc_iso("2026-10-02T16:00:00.000Z"))

a = fresh()
now = load("schedule-2026-27.json")
g_new = list(a.discover("https://plk.pl/terminarz", {"season": "2026-27", "stage": "regular"}))
ok("2026/27: 240 regular-season fixtures, the Superpuchar's two left out", len(g_new) == 240, len(g_new))
ok("...read with ONE request (the current season is the reply without a seasonId)",
   Offline.requests_made == ["https://plk.pl/api/webpage/schedule"], Offline.requests_made)
per = defaultdict(int)
for g in g_new:
    per[g.extra["home_code"]] += 1
    per[g.extra["away_code"]] += 1
ok("16 clubs, 30 games each", len(per) == 16 and set(per.values()) == {30}, dict(per))
g0 = next((g for g in g_new if g.external_id == "223468"), None)
ok("Energa Czarni Słupsk v Legia Warszawa: key 223468 (the game id of /mecz/223468/...), "
   "codes 8607 / 11, 2 Oct 2026 16:00 UTC, scheduled",
   g0 is not None and (g0.home_name, g0.away_name, g0.extra["home_code"], g0.extra["away_code"],
                       g0.tipoff_at, g0.status)
   == ("Energa Czarni Słupsk", "Legia Warszawa", "8607", "11", "2026-10-02T16:00:00+00:00", "scheduled"),
   g0 and (g0.home_name, g0.away_name, g0.extra, g0.tipoff_at, g0.status))
ok("crests are the league's own https URLs", all((g.extra["home_logo"] or "").startswith("https://") for g in g_new))
tbc = [g for g in g_new if g.extra.get("time_tbc")]
ok("196 fixtures with no time yet (00:00 local) are noon UTC on their own date, marked time_tbc",
   len(tbc) == 196 and all(g.tipoff_at.endswith("T12:00:00+00:00") for g in tbc), len(tbc))
ok("...and every other one keeps its real time", all(not g.tipoff_at.endswith("T12:00:00+00:00") or g.extra.get("time_tbc")
                                                     for g in g_new) and len(g_new) - len(tbc) == 44)
ok("a 00:00-local row is never read as the evening before in UTC",
   P.fixture_tip({"dateLocal": "2026-10-09 00:00", "date": "2026-10-08T22:00:00.000Z"})
   == ("2026-10-09T12:00:00+00:00", True))
ok("the 2026/27 play-off source finds nothing yet (no play-off round published)",
   list(a.discover("https://plk.pl/terminarz#playoffs", {"season": "2026-27", "stage": "playoffs"})) == [])

a = fresh()
g_reg = list(a.discover("https://plk.pl/terminarz", {"season": "2025/26", "stage": "regular"}))
g_po = list(a.discover("https://plk.pl/terminarz#playoffs", {"season": "2025/26", "stage": "playoffs"}))
g_all = list(a.discover("https://plk.pl/terminarz", {"season": "2025"}))
ok("2025/26 regular: 240 games, all final", len(g_reg) == 240 and all(g.status == "final" for g in g_reg),
   (len(g_reg), {g.status for g in g_reg}))
ok("2025/26 play-offs: play-in 3 + QF 17 + SF 6 + 3rd 2 + final 7 = 35", len(g_po) == 35, len(g_po))
ok("...and the rounds named for what they are",
   {g.extra["round"].split(" · ")[0] for g in g_po} == {"Play-in", "Ćwierćfinały", "Półfinały", "O 3 miejsce", "Finał"},
   sorted({g.extra["round"] for g in g_po})[:8])
ok("no stage: both (275), and never the cup's seven", len(g_all) == 275, len(g_all))
ok("the two stages never share a game", not ({g.external_id for g in g_reg} & {g.external_id for g in g_po}))
ok("an old season costs two requests: the season list, then that season",
   "https://plk.pl/api/webpage/schedule?seasonId=28" in Offline.requests_made)
gl = {g.extra["home_code"]: g.home_name for g in g_reg}
nl = {g.extra["home_code"]: g.home_name for g in g_new}
ok("a renamed club keeps its code: 2310 is Tauron GTK Gliwice in 2025/26 and Euvic GTK Gliwice in 2026/27",
   gl.get("2310") == "Tauron GTK Gliwice" and nl.get("2310") == "Euvic GTK Gliwice", (gl.get("2310"), nl.get("2310")))
a = fresh()
ok("a season plk.pl does not have is refused (empty, reason printed), not read as nothing played",
   list(a.discover("https://plk.pl/terminarz", {"season": "1999-00"})) == [])
for bad, cfg in (("a season token that is not a season", {"season": "twenty"}),
                 ("a stage that is neither regular nor playoffs", {"stage": "cup"})):
    try:
        list(fresh().discover("https://plk.pl/terminarz", cfg))
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)
ok("the registry knows it", type(get_adapter("plk")).__name__ == "PlkAdapter")

# ============================================================================ fetch() -> bundle
print("\n-- fetch(): one game, end to end, against the league's own box")
BOX_FIELDS = dict(P.BOX)


def check(label, b, reply):
    g = reply["game"]
    raw = b.raw
    sides = {"1": g["homeTeam"], "2": g["guestTeam"]}
    # (1) every player of the league's box, every field
    diffs = []
    for s, t in sides.items():
        for row in t["gameStatistics"]["playersStatistics"]:
            p = raw["tm"][s]["pl"].get(str(row["playerId"]))
            if p is None:
                diffs.append(f"{row['playerId']} missing")
                continue
            for k, fiba in BOX_FIELDS.items():
                if p[fiba] != row.get(k, 0):
                    diffs.append(f"{p['name']} {fiba} {p[fiba]} != {row.get(k)}")
            if p["sMinutes"] != P._mmss(row["playTimeSeconds"]):
                diffs.append(f"{p['name']} minutes")
    ok(f"{label}: every player's box = the league's box", not diffs, diffs[:5])
    # (2) the clubs' totals = the league's sum row (players + team row)
    tdiffs = [f"team{s} {fiba}" for s, t in sides.items() for k, fiba in BOX_FIELDS.items()
              if raw["tm"][s]["tot_" + fiba] != t["gameStatistics"]["sumStatistics"].get(k, 0)]
    ok(f"{label}: both clubs' totals = the league's sum rows", not tdiffs, tdiffs[:4])
    ok(f"{label}: team rows carry the team rebounds, the bundle's team totals too",
       b.team["home"]["oreb"] == g["homeTeam"]["gameStatistics"]["sumStatistics"]["reboundsOffensive"]
       and b.team["away"]["tov"] == g["guestTeam"]["gameStatistics"]["sumStatistics"]["turnovers"])
    # (3) the scoreboard
    sc = {"1": g["resultHome"], "2": g["resultGuest"]}
    ok(f"{label}: final score {sc['1']}-{sc['2']} and the periods add up to it",
       raw["tm"]["1"]["score"] == sc["1"] and raw["tm"]["2"]["score"] == sc["2"]
       and all(sum(v for k, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k)) == sc[s] for s in "12"))
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    ok(f"{label}: tip-off from the game's own date, in UTC", b.tipoff_at == P.utc_iso(g["date"]), b.tipoff_at)
    # (4) the play-by-play
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n in play order", an == list(range(1, len(an) + 1)))
    el = [(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0), -P._secs(e["gt"] + ":00"))
          for e in raw["pbp"]]
    ok(f"{label}: ...and the clock never runs backwards", all(x <= y for x, y in zip(el, el[1:])))
    ok(f"{label}: success 1/0, tno 0/1/2, pno a string, no private key",
       all(e["success"] in (0, 1) and not isinstance(e["success"], bool) and e["tno"] in (0, 1, 2)
           and isinstance(e["pno"], str) and not any(k.startswith("_") for k in e) for e in raw["pbp"]))
    npers = max(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0) for e in raw["pbp"])
    starts = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"]
    ends = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"]
    ok(f"{label}: {npers} periods, each started and ended once, one final whistle, last",
       len(starts) == len(ends) == npers == len(g["actionsAndShots"])
       and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1 and raw["pbp"][-1]["actionType"] == "game")
    ok(f"{label}: no action string the adapter does not know", not raw["plk"]["unknown"], raw["plk"]["unknown"])
    fo = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    linked = [e for e in fo if e.get("previousAction")]
    by_an = {e["actionNumber"]: e for e in raw["pbp"]}
    ok(f"{label}: every drawn foul points at the other side's foul at the same clock ({len(linked)}/{len(fo)})",
       fo and len(linked) == len(fo) and all(by_an[e["previousAction"]]["actionType"] == "foul"
                                             and by_an[e["previousAction"]]["tno"] == 3 - e["tno"]
                                             and by_an[e["previousAction"]]["gt"] == e["gt"] for e in linked))
    shots = [s for t in "12" for s in raw["tm"][t]["shot"]]
    ok(f"{label}: every charted shot sits on a shot action of the same number and club",
       shots and all(by_an[s["actionNumber"]]["actionType"] == s["actionType"]
                     and str(by_an[s["actionNumber"]]["tno"]) == t
                     for t in "12" for s in raw["tm"][t]["shot"]))
    # (5) starters, minutes and stints
    for s in "12":
        st = [k for k, p in raw["tm"][s]["pl"].items() if p["starter"] == 1]
        ok(f"{label}: team {s} has exactly five starters", len(st) == 5, st)
    on = {s: {k for k, p in raw["tm"][s]["pl"].items() if p["starter"]} for s in "12"}
    secs, last, six = defaultdict(float), 0.0, []
    for e in raw["pbp"]:
        q = e["period"] + (4 if e["periodType"] == "OVERTIME" else 0)
        t = sum(600 if i <= 4 else 300 for i in range(1, q)) + (600 if q <= 4 else 300) - P._secs(e["gt"] + ":00")
        for s in "12":
            for k in on[s]:
                secs[(s, k)] += t - last
        last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
        elif e["actionType"] != "substitution" and any(len(on[s]) != 5 for s in "12"):
            six.append(e["actionNumber"])
    ok(f"{label}: five a side at every action", not six, six[:5])
    mdiff = [f"{p['name']} {secs[(s, k)]:.0f}s != {p['sMinutes']}" for s in "12"
             for k, p in raw["tm"][s]["pl"].items()
             if abs(secs[(s, k)] - P._secs(p["sMinutes"] + ":00")) > 60]
    ok(f"{label}: every player's minutes from the substitutions = the box minutes (within a minute)",
       not mdiff, mdiff[:4])
    length = 2400 + 300 * max(0, npers - 4)
    lu = [(r["home_lineup"], r["away_lineup"]) for r in b.stints]
    ok(f"{label}: {len(b.stints)} stints, every one five a side",
       b.stints and all(len(h.split(",")) == 5 and len(x.split(",")) == 5 for h, x in lu))
    ok(f"{label}: stints cover the whole game ({length}s)", abs(sum(r["duration"] for r in b.stints) - length) < 0.01,
       sum(r["duration"] for r in b.stints))
    hp, ap = sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)
    ok(f"{label}: stint points add up to the final score", (hp, ap) == (sc["1"], sc["2"]), (hp, ap))
    # (6) the event log the site will store
    tr = translate(raw)
    rep = tr["report"]
    ok(f"{label}: translate() drops nothing and matches every player", not rep["dropped"] and rep["unmatched"] == 0,
       (rep["dropped"], rep["unmatched"]))
    ok(f"{label}: translate() raises no warning", not rep["warnings"], rep["warnings"][:3])
    box = defaultdict(lambda: defaultdict(int))
    for e in tr["events"]:
        if not e["pid"]:
            continue
        s, t = box[e["pid"]], e["t"]
        if t in ("p2_made", "p3_made", "ft_made"):
            s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
        if t.startswith("p2") or t.startswith("p3"):
            s["fga"] += 1
            s["fgm"] += t.endswith("made")
        if t.startswith("ft"):
            s["fta"] += 1
            s["ftm"] += t == "ft_made"
        if t == "reb":
            s["oreb" if e["payload"]["off"] else "dreb"] += 1
        for k in ("ast", "stl", "blk", "to"):
            if t == k:
                s[k] += 1
        if t == "foul":
            s["pf"] += 1
    drawn = defaultdict(int)
    for e in tr["events"]:
        if e["t"] == "foul" and e["payload"].get("drawn"):
            drawn[e["payload"]["drawn"]] += 1
    ediff = []
    for i, s in enumerate("12"):
        for pno, p in raw["tm"][s]["pl"].items():
            e = box.get(f"{i}:{pno}", {})
            want = {"pts": p["sPoints"], "fga": p["sFieldGoalsAttempted"], "fgm": p["sFieldGoalsMade"],
                    "fta": p["sFreeThrowsAttempted"], "ftm": p["sFreeThrowsMade"],
                    "oreb": p["sReboundsOffensive"], "dreb": p["sReboundsDefensive"],
                    "ast": p["sAssists"], "stl": p["sSteals"], "blk": p["sBlocks"],
                    "to": p["sTurnovers"], "pf": p["sFoulsPersonal"]}
            for k, v in want.items():
                if e.get(k, 0) != v:
                    ediff.append(f"{p['name']} {k} log={e.get(k, 0)} box={v}")
            if drawn.get(f"{i}:{pno}", 0) != p["sFoulsOn"]:
                ediff.append(f"{p['name']} fouls drawn log={drawn.get(f'{i}:{pno}', 0)} box={p['sFoulsOn']}")
    ok(f"{label}: the event log sums to every player's box, fouls drawn included", not ediff, ediff[:6])
    return tr


LABELS = {"200474": "the saved sample (Arka v Czarni, 23 Dec 2025)", "200475": "an overtime game",
          "200477": "a substitution split around a free throw", "179630": "one player under two ids",
          "223310": "a Final game"}
for gid in GAMES:
    a = fresh()
    reply = load(f"game-{gid}.json")
    b = a.fetch(gid, {})
    if b is None:
        ok(f"{gid}: fetch returned a bundle", False)
        continue
    check(f"{gid} {LABELS[gid]}", b, reply)
    if gid == "179630":
        ok("179630: Mario Ihring's actions (id 108810) are filed under his box row (65112)",
           b.raw["plk"]["repairs"] and all("-> 65112" in r for r in b.raw["plk"]["repairs"])
           and not any(e["pno"] == "108810" for e in b.raw["pbp"]), b.raw["plk"]["repairs"])
    if gid == "200475":
        ok("200475: the overtime is period 1 OVERTIME, scored as p5_score and ot_score",
           any(e["periodType"] == "OVERTIME" for e in b.raw["pbp"]) and "p5_score" in b.raw["tm"]["1"]
           and b.raw["tm"]["1"]["ot_score"] == b.raw["tm"]["1"]["p5_score"] and b.raw["period"] == 5)

print("\n-- stable payloads")
a = fresh()
h1 = a.fetch("200474", {}).payload_hash
h2 = fresh().fetch("200474", {}).payload_hash
ok("the same reply twice is the same payload (the worker skips an unchanged game)", h1 == h2)
ok("a fixture weeks away is not fetched at all",
   fresh().fetch("223468", {"_tipoff_at": "2099-10-02T16:00:00+00:00"}) is None and Offline.requests_made == [])
ok("a key that is not a PLK game id is not fetched", fresh().fetch("proa-2026-1-2", {}) is None)

# ============================================================================ a game in progress
print("\n-- a game still being played")
live = copy.deepcopy(load("game-200474.json"))
g = live["game"]
g["isFinished"] = False
q3 = next(q for q in g["actionsAndShots"] if q["quarterNumber"] == 3)
q3["playByPlay"] = [e for e in q3["playByPlay"] if P._secs(e["time"]) >= 300 and e.get("actionType") != "koniec części gry"]
g["actionsAndShots"] = [q for q in g["actionsAndShots"] if q["quarterNumber"] <= 3]
raw = P.raw_from_game(live)
ok("halfway through Q3: live, period 3, the clock of the last action typed",
   FibaLiveStatsAdapter._status(raw) == "live" and raw["period"] == 3
   and raw["clock"] == q3["playByPlay"][-1]["time"][:5], (raw["period"], raw["clock"]))
ok("...Q1 and Q2 are closed, Q3 is open, and no final whistle is invented",
   [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == [1, 2]
   and not any(e["actionType"] == "game" for e in raw["pbp"]))
ok("a game with no action typed yet has no payload (fetch returns None)",
   P.raw_from_game({"game": dict(g, actionsAndShots=[])}) is None)
ok("a finished game whose operator never typed 'koniec meczu' still gets its final whistle",
   FibaLiveStatsAdapter._status(P.raw_from_game({"game": dict(
       load("game-200474.json")["game"],
       actionsAndShots=[dict(q, playByPlay=[e for e in q["playByPlay"] if e.get("actionType") != "koniec meczu"])
                        for q in load("game-200474.json")["game"]["actionsAndShots"]])})) == "final")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
