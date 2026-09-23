"""Lega Basket Serie A (adapters/lba.py), offline, over captured legabasket.it API replies:

    python scripts/ingest/lba_test.py

What it holds the adapter to:
  * the schedule: a season read by its own championships (the cups and the Supercoppa never
    asked for), "regular" and "playoffs" kept apart, the key the LBA match id, the club code the
    club_id (so a club keeps it through a new team id every season), tip-offs in UTC and a fixture
    with no time yet kept on its own date, and a phase that does not exist yet answered with
    nothing rather than an error;
  * one game: every player's box exactly the league's own, the clubs' totals exactly its totals
    row, the score and the periods adding up to it, the play-by-play numbered 1..n in play order
    with each period opened and closed once and the final whistle last, drawn fouls pointing at
    their fouls, stints five a side covering the whole game and summing to the score, and the event
    log translate() builds dropping nothing and summing to the same box;
  * a game still being played: live, clock and period from the feed, the score from the
    play-by-play, no final whistle invented.

Fixtures live in scripts/ingest/data/lba/ (captured 2026-09-23, trimmed to what the adapter reads).
The scraper-side sweep behind them: 21 games over 2024/25 and 2025/26 (OT, double OT, every
play-off round), all passing these same checks.
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
from adapters import lba as L  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "lba")
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
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


GAMES = ("25015", "25018", "25098", "25356", "24887")


class Offline(L.LbaAdapter):
    """The real adapter with its network calls served from the fixtures."""
    requests_made: list = []

    def _get_json(self, url, fresh=False, **params):
        self.requests_made.append((url.rsplit("/", 1)[-1], dict(params)))
        if url.endswith("/get-championships"):
            return load(f"championships-{params.get('s')}.json") or {"competitions": []}
        if url.endswith("/get-teams"):
            return load(f"teams-{params.get('year')}.json") or {"teams": []}
        if url.endswith("/get-championships-calendar-by-id"):
            ph = params.get("ph_id")
            return load(f"calendar-{params['id']}" + (f"-ph{ph}" if ph else "") + ".json")
        game = load(f"game-{params.get('id')}.json")
        if url.endswith("/get-championships-matches-by-id"):
            return game["match"] if game else None
        if url.endswith("/get-championships-matches-play-by-play"):
            return game["pbp"] if game else None
        return None


def fresh():
    Offline.requests_made = []
    # the production path: the Actions runner has no scraper folder, so stints come from stints.py
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


def secs(mmss):
    m, s = mmss.split(":")[:2]
    return int(m) * 60 + int(s)


# ============================================================================ the vocabulary
print("-- the vocabulary")


def act(description, q1=None, q2=None, **kw):
    return dict({"description": description, "action_1_qualifier_code": q1, "action_2_qualifier_code": q2,
                 "player_id": 7, "team_id": 1, "dunk": 0, "in_area": False}, **kw)


cases = [
    (act("2 punti segnato", "7", in_area=True), ("2pt", "layup", 1, ["pointsinthepaint"])),
    (act("2 punti sbagliato", "8"), ("2pt", "drivinglayup", 0, [])),
    (act("2 punti segnato", "9", dunk=1, in_area=True), ("2pt", "dunk", 1, ["pointsinthepaint"])),
    (act("2 punti segnato", "10", dunk=1, in_area=True), ("2pt", "alleyoopdunk", 1, ["pointsinthepaint"])),
    (act("2 punti segnato", "2", in_area=True), ("2pt", "floatingjumpshot", 1, ["pointsinthepaint"])),
    (act("3 punti segnato", "6", "500"), ("3pt", "pullupjumpshot", 1, ["fastbreak"])),
    (act("3 punti sbagliato", "1", "1007"), ("3pt", "jumpshot", 0, [])),
    (act("Tiro libero segnato", "500"), ("freethrow", "", 1, ["fastbreak"])),
    (act("Palla persa", "53"), ("turnover", "travel", None, [])),
    (act("Palle perse di squadra", "602", player_id=None), ("turnover", "shotclock", None, ["team"])),
    (act("Fallo commesso", "103"), ("foul", "personal", None, ["shooting"])),
    (act("Fallo commesso", "106"), ("foul", "offensive", None, [])),
    (act("Falli di squadra", "201", player_id=None), ("foul", "coachtechnical", None, [])),
    (act("Rimbalzi difensivi di squadra", player_id=None), ("rebound", "defensive", None, ["team"])),
    (act("Palla contesa"), ("jumpball", "won", None, [])),
    (act("Uscita"), ("substitution", "out", None, [])),
]
for a, want in cases:
    at, sub, succ, quals, unk = L.classify(a, {})
    ok(f"{a['description']} q{a['action_1_qualifier_code']}/{a['action_2_qualifier_code']} -> {want}",
       (at, sub, succ, quals) == want and unk is None, (at, sub, succ, quals, unk))
foul = act("Fallo commesso", "106", action_id=9)
at, sub, *_ = L.classify(act("Palla persa", None, linked_action_id=9), {9: foul})
ok("the turnover the league links to an offensive foul is turnover/offensive, as FIBA pairs them", (at, sub) == ("turnover", "offensive"))
for a in (act("Stoppata subita"), act("Palle recuperate di squadra", player_id=None), act("Inizio Tempo", player_id=None)):
    ok(f"{a['description']} records nothing (the box has it, or it is no player's stat)", L.classify(a, {})[0] is None
       and L.classify(a, {})[4] is None)
at, *_, unk = L.classify(act("Qualcosa di nuovo"), {})
ok("a description the tables do not know records nothing and is reported", at is None and unk == "action:Qualcosa di nuovo|", unk)

# ============================================================================ discover()
print("\n-- seasons and discover()")
ok("no season configured = the current season", L.LbaAdapter._season({}) == L.current_season())
ok("a fixture with no time yet (00:00 Italian time) is noon UTC on its own date",
   L.fixture_tip({"match_datetime": "2026-11-01T00:00:00.000+01:00"}) == ("2026-11-01T12:00:00+00:00", True))
ok("a fixture with a time is that time in UTC",
   L.fixture_tip({"match_datetime": "2026-09-26T19:30:00.000+02:00"}) == ("2026-09-26T17:30:00+00:00", False))

a = fresh()
g_new = list(a.discover("https://www.legabasket.it/competizioni/1/serie-a", {"season": "2026-27", "stage": "regular"}))
ok("2026/27 regular season: 240 fixtures", len(g_new) == 240, len(g_new))
ok("...read with five requests: the season's championships, its clubs, the phases, Andata, Ritorno",
   [r[0] for r in Offline.requests_made] == ["get-championships", "get-teams", "get-championships-calendar-by-id",
                                             "get-championships-calendar-by-id", "get-championships-calendar-by-id"]
   and Offline.requests_made[0][1] == {"s": 2026, "cs_id": 1, "items": 1000}, Offline.requests_made)
per = defaultdict(int)
for g in g_new:
    per[g.extra["home_code"]] += 1
    per[g.extra["away_code"]] += 1
teams26 = {str(t["club_id"]) for t in load("teams-2026.json")["teams"]}
ok("16 clubs, 30 games each, every code a club_id", len(per) == 16 and set(per.values()) == {30} and set(per) == teams26,
   (len(per), set(per.values())))
g0 = next((g for g in g_new if g.external_id == "25602"), None)
ok("Nutribullet Treviso v BC Roma: key 25602, codes 107 / 246 (club ids), 26 Sep 2026 17:30 UTC, at Palaverde",
   g0 is not None and (g0.home_name, g0.away_name, g0.extra["home_code"], g0.extra["away_code"], g0.tipoff_at,
                       g0.status, g0.extra["venue"])
   == ("Nutribullet Treviso Basket", "BC Roma", "107", "246", "2026-09-26T17:30:00+00:00", "scheduled", "Palaverde"),
   g0 and (g0.home_name, g0.away_name, g0.extra, g0.tipoff_at, g0.status))
tbc = [g for g in g_new if g.extra.get("time_tbc")]
ok("200 fixtures with no time yet are noon UTC on their date, marked time_tbc; 40 keep their real time",
   len(tbc) == 200 and all(g.tipoff_at.endswith("T12:00:00+00:00") for g in tbc), len(tbc))
ok("crests are the league's own https URLs", all((g.extra["home_logo"] or "").startswith("https://lba-media.") for g in g_new))
ok("the 2026/27 play-off source finds nothing yet (the league has no play-off championship for 2026)",
   list(a.discover("https://www.legabasket.it/competizioni/1/serie-a#playoffs", {"season": "2026-27", "stage": "playoffs"})) == [])

a = fresh()
g_reg = list(a.discover("https://www.legabasket.it/competizioni/1/serie-a", {"season": "2025/26", "stage": "regular"}))
g_po = list(a.discover("https://www.legabasket.it/competizioni/1/serie-a#playoffs", {"season": "2025/26", "stage": "playoffs"}))
g_all = list(a.discover("https://www.legabasket.it/competizioni/1/serie-a", {"season": "2025"}))
ok("2025/26 regular season: 210 games (15 clubs x 28), all final",
   len(g_reg) == 210 and all(g.status == "final" for g in g_reg), (len(g_reg), {g.status for g in g_reg}))
rounds = defaultdict(int)
for g in g_po:
    rounds[g.extra["round"].split(" - ")[0]] += 1
ok("2025/26 play-offs: quarter-finals 18 + semi-finals 8 + final 4 = 30",
   len(g_po) == 30 and dict(rounds) == {"Quarti di Finale": 18, "Semifinali": 8, "Finale": 4}, dict(rounds))
ok("no stage: both (240), and the two stages never share a game",
   len(g_all) == 240 and not ({g.external_id for g in g_reg} & {g.external_id for g in g_po}), len(g_all))
mil_25 = {g.extra["home_code"] for g in g_reg if g.home_name == "EA7 Emporio Armani Milano"}
mil_26 = {g.extra["home_code"] for g in g_new if g.home_name == "Armani Olimpia Milano"}
ok("Olimpia Milano is club 28 in both seasons, though its team id went 1714 -> 1751 and its name changed",
   mil_25 == mil_26 == {"28"}, (mil_25, mil_26))
a = fresh()
ok("a season the league has no Serie A for is refused (empty, reason printed), not read as nothing played",
   list(a.discover("https://www.legabasket.it/competizioni/1/serie-a", {"season": "1999-00"})) == [])
for bad, cfg in (("a season token that is not a season", {"season": "twenty"}),
                 ("a stage that is neither regular nor playoffs", {"stage": "coppa"})):
    try:
        list(fresh().discover("https://www.legabasket.it/competizioni/1/serie-a", cfg))
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)
ok("the registry knows it", type(get_adapter("lba")).__name__ == "LbaAdapter")

# ============================================================================ fetch() -> bundle
print("\n-- fetch(): one game, end to end, against the league's own box")
BOX = {"pun": "sPoints", "t2_r": "sTwoPointersMade", "t2_t": "sTwoPointersAttempted",
       "t3_r": "sThreePointersMade", "t3_t": "sThreePointersAttempted", "tl_r": "sFreeThrowsMade",
       "tl_t": "sFreeThrowsAttempted", "rimbalzi_o": "sReboundsOffensive", "rimbalzi_d": "sReboundsDefensive",
       "rimbalzi_t": "sReboundsTotal", "ass": "sAssists", "palle_p": "sTurnovers", "palle_r": "sSteals",
       "stoppate_dat": "sBlocks", "stoppate_sub": "sBlocksReceived", "falli_c": "sFoulsPersonal",
       "falli_sf": "sFoulsOn", "plus_minus": "sPlusMinusPoints"}


def check(label, b, game):
    m, sc_ = game["match"]["match"], game["match"]["scores"]
    raw = b.raw
    # (1) every player of the league's box, every field
    diffs = []
    for s, side in (("1", "ht"), ("2", "vt")):
        for r in sc_[side]["rows"]:
            p = raw["tm"][s]["pl"].get(str(r["player_id"]))
            if p is None:
                diffs.append(f"{r['player_id']} missing")
                continue
            for k, fiba in BOX.items():
                if p[fiba] != (r.get(k) or 0):
                    diffs.append(f"{p['name']} {fiba} {p[fiba]} != {r.get(k)}")
            if secs(p["sMinutes"]) != (r.get("sec") or 0):
                diffs.append(f"{p['name']} minutes")
    ok(f"{label}: every player's box = the league's box", not diffs, diffs[:5])
    # (2) the clubs' totals = the league's totals row (players + the team row)
    tdiffs = [f"team{s} {fiba}" for s, side in (("1", "ht"), ("2", "vt")) for k, fiba in BOX.items()
              if k not in ("falli_c", "plus_minus") and raw["tm"][s]["tot_" + fiba] != (sc_[side]["totals"].get(k) or 0)]
    ok(f"{label}: both clubs' totals = the league's totals rows (team rebounds and turnovers included)", not tdiffs, tdiffs[:4])
    ok(f"{label}: the paint and fast-break totals are their players' sums",
       all(raw["tm"][s]["tot_sPointsInThePaint"] == sum(p["sPointsInThePaint"] for p in raw["tm"][s]["pl"].values())
           and raw["tm"][s]["tot_sPointsFastBreak"] == sum(p["sPointsFastBreak"] for p in raw["tm"][s]["pl"].values())
           and raw["tm"][s]["tot_sPointsInThePaint"] > 0 for s in "12"))
    # (3) the scoreboard
    sc = {"1": m["home_final_score"], "2": m["visitor_final_score"]}
    ok(f"{label}: final score {sc['1']}-{sc['2']}, quarters as the league scores them, the periods adding up",
       all(raw["tm"][s]["score"] == sc[s] and sum(v for k, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k)) == sc[s]
           for s in "12")
       and all((raw["tm"]["1"][f"p{q}_score"], raw["tm"]["2"][f"p{q}_score"]) == (m[f"q{q}_hs"], m[f"q{q}_vs"]) for q in range(1, 5))
       and (raw["tm"]["1"]["ot_score"], raw["tm"]["2"]["ot_score"]) == (m["ot_hs"], m["ot_vs"]))
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    ok(f"{label}: tip-off from the game's own date, in UTC", b.tipoff_at == L.utc_iso(m["match_datetime"]), b.tipoff_at)
    # (4) the play-by-play
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n in play order", an == list(range(1, len(an) + 1)))
    el = [(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0), -secs(e["gt"])) for e in raw["pbp"]]
    ok(f"{label}: ...and the clock never runs backwards", all(x <= y for x, y in zip(el, el[1:])))
    ok(f"{label}: success 1/0, tno 0/1/2, pno a string, no private key",
       all(e["success"] in (0, 1) and not isinstance(e["success"], bool) and e["tno"] in (0, 1, 2)
           and isinstance(e["pno"], str) and not any(k.startswith("_") for k in e) for e in raw["pbp"]))
    npers = raw["period"]
    starts = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"]
    ends = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"]
    ok(f"{label}: {npers} periods, each started and ended once, one final whistle, last",
       len(starts) == len(ends) == npers and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1
       and raw["pbp"][-1]["actionType"] == "game")
    ok(f"{label}: no action kind the adapter does not know", not raw["lba"]["unknown"], raw["lba"]["unknown"])
    by_an = {e["actionNumber"]: e for e in raw["pbp"]}
    fo = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    linked = [e for e in fo if e.get("previousAction")]
    ok(f"{label}: every drawn foul points at the other side's foul ({len(linked)}/{len(fo)})",
       fo and len(linked) == len(fo) and all(by_an[e["previousAction"]]["actionType"] == "foul"
                                             and by_an[e["previousAction"]]["tno"] == 3 - e["tno"] for e in linked))
    ok(f"{label}: every charted shot sits on a shot action of the same number and club",
       all(by_an[s["actionNumber"]]["actionType"] == s["actionType"] and str(by_an[s["actionNumber"]]["tno"]) == t
           for t in "12" for s in raw["tm"][t]["shot"]) and sum(len(raw["tm"][t]["shot"]) for t in "12") > 100)
    # (5) starters, minutes and stints
    for s in "12":
        st = [k for k, p in raw["tm"][s]["pl"].items() if p["starter"] == 1]
        ok(f"{label}: team {s} has exactly five starters", len(st) == 5, st)
    on = {s: {k for k, p in raw["tm"][s]["pl"].items() if p["starter"]} for s in "12"}
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
    # the league's minutes are whole minutes, rounded so a team makes 200: within 90 s on 419 of 419
    # player lines of 21 games (two at exactly 90 s)
    mdiff = [f"{p['name']} {sec_on[(s, k)]:.0f}s != {p['sMinutes']}" for s in "12"
             for k, p in raw["tm"][s]["pl"].items() if abs(sec_on[(s, k)] - secs(p["sMinutes"])) > 90]
    ok(f"{label}: every player's minutes from the substitutions = the box's whole minutes (within 90 s)", not mdiff, mdiff[:4])
    length = 2400 + 300 * max(0, npers - 4)
    ok(f"{label}: {len(b.stints)} stints, every one five a side",
       b.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
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
    drawn = defaultdict(int)
    for e in tr["events"]:
        if e["t"] == "foul" and e["payload"].get("drawn"):
            drawn[e["payload"]["drawn"]] += 1
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


LABELS = {"25015": "the saved game (Milano v Tortona, 1st round 2025/26)", "25018": "an overtime game",
          "25098": "a double-overtime game", "25356": "a play-off final game", "24887": "a 2024/25 game"}
for gid in GAMES:
    a = fresh()
    game = load(f"game-{gid}.json")
    b = a.fetch(gid, {})
    if b is None:
        ok(f"{gid}: fetch returned a bundle", False)
        continue
    check(f"{gid} {LABELS[gid]}", b, game)
    if gid == "25098":
        ok("25098: two overtimes are periods 1 and 2 OVERTIME, scored p5 and p6, ot_score their sum",
           b.raw["period"] == 6 and {e["period"] for e in b.raw["pbp"] if e["periodType"] == "OVERTIME"} == {1, 2}
           and b.raw["tm"]["1"]["ot_score"] == b.raw["tm"]["1"]["p5_score"] + b.raw["tm"]["1"]["p6_score"])
    if gid == "25015":
        ok("25015: the club codes are club ids (Milano 28, Tortona 111 in 2025/26's own team list)",
           (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]) == ("28", "111"), (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]))

print("\n-- stable payloads")
h1 = fresh().fetch("25015", {}).payload_hash
h2 = fresh().fetch("25015", {}).payload_hash
ok("the same replies twice are the same payload (the worker skips an unchanged game)", h1 == h2)
a = fresh()
ok("a fixture weeks away is not fetched at all",
   a.fetch("25602", {"_tipoff_at": "2099-10-02T16:00:00+00:00"}) is None and Offline.requests_made == [])
ok("a key that is not an LBA match id is not fetched", fresh().fetch("proa-2026-1-2", {}) is None)

# ============================================================================ a game in progress
print("\n-- a game still being played")
live = copy.deepcopy(load("game-25015.json"))
live["match"]["match"]["game_status"] = "1"
acts = live["pbp"]["pbp"]["actions"]
cut = next(i for i, x in enumerate(acts) if x["period"] == 3 and secs(x["print_time"]) <= 300)
live["pbp"]["pbp"]["actions"] = acts[:cut]
raw = L.raw_from_game(live["match"], live["pbp"])
last_play = acts[cut - 1]
ok("halfway through Q3: live, period 3, the clock of the last action",
   FibaLiveStatsAdapter._status(raw) == "live" and raw["period"] == 3 and raw["clock"] == last_play["print_time"],
   (raw["period"], raw["clock"], last_play["print_time"]))
ok("...Q1 and Q2 closed, Q3 open, no final whistle invented",
   [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == [1, 2]
   and not any(e["actionType"] == "game" for e in raw["pbp"]))
ok("...and the score is the play-by-play's, not the header's final score",
   (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == L._score(last_play["score"]) != (71, 74),
   (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]))
ok("a game with no action yet has no payload", L.raw_from_game(live["match"], {"pbp": {"actions": []}}) is None)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
