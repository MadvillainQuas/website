"""The NBL, WNBL and NBL1 (adapters/nbl.py), offline, over captured replies of the NBL's service:

    python scripts/ingest/nbl_test.py

What it holds the adapter to:
  * the vocabulary: every action string of a 22-game inventory mapped to FIBA's, the NBL's own
    foul names (Disruptive, Category One Technical, Flagrant) included, and a string it does not
    know reported rather than guessed;
  * the schedule: the NBL's and WNBL's main season only (never the pre-season, the Blitz or the
    Ignite Cup final), "regular" and "finals" kept apart - the WNBL's finals, which carry no
    match_type, included - NBL1 one gender over its conferences with each fixture's conference on
    it, its National Finals a source of their own, calendar-year seasons, a season the service does
    not have refused, and first_season keeping a row quiet; the key the match id, the club code
    the stats platform's club id, tip-offs in UTC, crests a PNG;
  * one game: every player's box counted from the play-by-play and equal to the league's own
    wherever the league's is current, both clubs' totals the league's, the score and the periods
    adding up, the play-by-play numbered 1..n in play order with each period opened and closed once,
    five a side at every action, stints covering the game and summing to the score, and the event
    log translate() builds dropping nothing and summing to the same box - through every repair: a
    league box frozen before the end, score columns away-first, team actions with no team, a block
    typed before its shot, a drawn foul before its foul, a substitution typed twice, a DNP flagged
    as a starter;
  * a game still being played: live, clock and period from the feed, no final whistle invented;
  * NBL1's conferences, learnt from the fixtures by groups.learn.

Fixtures live in scripts/ingest/data/nbl/ (captured 2026-09-23, trimmed to what the adapter reads
and gzipped; the trimmed replies give byte-for-byte the output of the full ones).
"""
import copy
import gzip
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import nbl as N  # noqa: E402
from adapters.base import ScheduleGame  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402
import groups  # noqa: E402

DATA = os.path.join(HERE, "data", "nbl")
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
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


class Offline(N.NblAdapter):
    """The real adapter with its network calls served from the fixtures."""
    requests_made: list = []

    def _get_json(self, url):
        self.requests_made.append(url)
        m = re.search(r"/get/(nbl1|wnbl|nbl)/seasons$", url)
        if m:
            return load(f"seasons-{m.group(1)}.json.gz")
        m = re.search(r"/get/matches/in/season/([0-9a-f-]+)\?limit=2000$", url)
        if m:
            return load(f"matches-{m.group(1)[:8]}.json.gz") or {"type": "matches", "count": 0, "data": []}
        m = re.search(r"/get/match/([0-9a-f-]+)/live/all$", url)
        if m:
            return load(f"game-{m.group(1)[:8]}.json.gz")
        return None


def fresh():
    N.NblAdapter._cache = {}
    Offline.requests_made = []
    # the production path: the Actions runner has no scraper folder, so stints come from stints.py
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


# ============================================================================ the vocabulary
print("-- the vocabulary")
ok("the adapter is registered under 'nbl'", type(get_adapter("nbl")).__name__ == "NblAdapter")
CASES = [
    ({"action_type": "2pt", "sub_type": "Driving Layup", "success": True, "player": {"id": "p"}}, ("2pt", "drivinglayup", 1)),
    ({"action_type": "2pt", "sub_type": "Fade Away", "success": False, "player": {"id": "p"}}, ("2pt", "fadeawayjumpshot", 0)),
    ({"action_type": "3pt", "sub_type": "Step Back Jump Shot", "success": True, "player": {"id": "p"}}, ("3pt", "stepbackjumpshot", 1)),
    ({"action_type": "2pt", "sub_type": "Alley Oop Dunk", "success": True, "player": {"id": "p"}}, ("2pt", "alleyoopdunk", 1)),
    ({"action_type": "2pt", "sub_type": None, "success": False, "player": {"id": "p"}}, ("2pt", "", 0)),
    ({"action_type": "freeThrow", "sub_type": "2Of3", "success": True, "player": {"id": "p"}}, ("freethrow", "2of3", 1)),
    ({"action_type": "rebound", "sub_type": "Offensive", "player": {"id": "p"}}, ("rebound", "offensive", None)),
    ({"action_type": "turnover", "sub_type": "Shot Clock"}, ("turnover", "shotclock", None)),
    ({"action_type": "turnover", "sub_type": "Travel", "player": {"id": "p"}}, ("turnover", "travel", None)),
    ({"action_type": "turnover", "sub_type": "Double Dribble", "player": {"id": "p"}}, ("turnover", "doubledribble", None)),
    ({"action_type": "foul", "sub_type": "Drawn", "player": {"id": "p"}}, ("foulon", "", None)),
    ({"action_type": "foul", "sub_type": "Disruptive", "player": {"id": "p"}}, ("foul", "personal", None)),
    ({"action_type": "foul", "sub_type": "Category One Technical", "player": {"id": "p"}}, ("foul", "technical", None)),
    ({"action_type": "foul", "sub_type": "Flagrant", "player": {"id": "p"}}, ("foul", "unsportsmanlike", None)),
    ({"action_type": "foul", "sub_type": "Coach Technical"}, ("foul", "coachtechnical", None)),
    ({"action_type": "substitution", "sub_type": "In", "player": {"id": "p"}}, ("substitution", "in", None)),
    ({"action_type": "jumpBall", "sub_type": "Won", "player": {"id": "p"}}, ("jumpball", "won", None)),
    ({"action_type": "timeOut", "sub_type": "Full"}, ("timeout", "full", None)),
    ({"action_type": "fixture", "sub_type": "End"}, ("game", "end", None)),
    ({"action_type": "period", "sub_type": "Start"}, ("period", "start", None)),
]
for e, want in CASES:
    a, st, succ, quals, unk = N.classify(e)
    ok(f"{e['action_type']} / {e.get('sub_type')} -> {want}", (a, st, succ) == want and unk is None, (a, st, succ, unk))
ok("a team rebound (no player) carries the 'team' qualifier",
   N.classify({"action_type": "rebound", "sub_type": "Defensive"})[3] == ["team"])
for e in ({"action_type": "main", "sub_type": "Start"}, {"action_type": "possession"},
          {"action_type": "possessionArrow"}, {"action_type": "period", "sub_type": "Confirmed"},
          {"action_type": "timeOut", "sub_type": "Officials"}):
    ok(f"{e['action_type']} / {e.get('sub_type')} records nothing, on purpose", N.classify(e)[0] is None and N.classify(e)[4] is None)
unk = N.classify({"action_type": "challenge", "sub_type": "Coach"})
ok("an action type nobody has seen is reported, not guessed", unk[0] is None and unk[4] == "challenge:Coach", unk)
odd = N.classify({"action_type": "foul", "sub_type": "Something New", "player": {"id": "p"}})
ok("...and an unknown foul still counts as one, reported", odd[:2] == ("foul", "personal") and odd[4], odd)

# ============================================================================ seasons + schedule
print("\n-- seasons and the schedule")
ok("'2026-27' is 2026 for the NBL; '2026' is 2026 for NBL1; '2026-27' is no NBL1 season",
   N.season_start_year("2026-27", False) == 2026 and N.season_start_year("2026", True) == 2026
   and N.season_start_year("2026-27", True) is None and N.season_start_year("2026-28", False) is None)
ok("season labels: 2026-27 and 2026", N.season_label(2026, False) == "2026-27" and N.season_label(2026, True) == "2026")
seasons = load("seasons-nbl.json.gz")["data"]
names = [s["name"] for s in N.pick_seasons(seasons, "nbl", 2025, "regular", None)]
ok("NBL 2025: NBL26 alone - not the Ignite Cup Final, the Blitz, the pre-season or the NBA games",
   names == ["NBL26"], names)
ok("NBL 2026: NBL27", [s["name"] for s in N.pick_seasons(seasons, "nbl", 2026, "regular", None)] == ["NBL27"])
wseasons = load("seasons-wnbl.json.gz")["data"]
ok("WNBL 2026: WNBL27, not the Townsville Tip-Off",
   [s["name"] for s in N.pick_seasons(wseasons, "wnbl", 2026, "regular", None)] == ["WNBL27"])
nseasons = load("seasons-nbl1.json.gz")["data"]
got = sorted(s["name"] for s in N.pick_seasons(nseasons, "nbl1", 2026, "regular", "men"))
ok("NBL1 2026 men: the men's conferences, not the women's, not the National Finals, not 2025",
   got == ["2026 North Men", "2026 South Men"], got)
got = [s["name"] for s in N.pick_seasons(nseasons, "nbl1", 2026, "national", "women")]
ok("NBL1 2026 women's National Finals: that season alone", got == ["2026 Women's National Finals"], got)
ok("a season's conference is its league's name", N.conference_of(
    next(s for s in nseasons if s["name"] == "2026 South Men")) == "NBL1 South")
ok("round names: WNBL's finals carry no match_type and are still finals; the Ignite Cup final is neither",
   N.row_stage({"match_type": None, "round": "SEMI FINAL SERIES 1"}) == "finals"
   and N.row_stage({"match_type": None, "round": "IGNITE CUP FINAL"}) == "cup"
   and N.row_stage({"match_type": "preseason", "round": "Preseason"}) == "preseason"
   and N.row_stage({"match_type": "final", "round": "1"}) == "finals"
   and N.row_stage({"match_type": None, "round": "5v6"}) == "finals"
   and N.row_stage({"match_type": "regular", "round": "12"}) == "regular")

a = fresh()
g = a.discover("https://www.nbl.com.au/schedule", {"org": "nbl", "stage": "regular", "season": "2026-27"})
ok("NBL 2026-27 regular season: 165 games", len(g) == 165, len(g))
cns = next(x for x in g if x.external_id == "36e0818b-58ad-11f1-89d2-fb9d3a8baf78")
ok("the key is the match id; the codes are the stats platform's club ids; the tip-off UTC",
   cns.home_name == "Cairns Taipans" and cns.extra["home_code"] == "bf4cfb88-410c-11f0-82f6-1b3c55488bbb"
   and cns.tipoff_at == "2026-09-23T09:30:00+00:00" and cns.status == "final" and cns.extra["round"] == "Round 2",
   (cns.home_name, cns.extra, cns.tipoff_at, cns.status))
ok("an NBL crest is the league's own PNG", cns.extra["home_logo"] == "https://cdn.nbl.com.au/app_assets/CNS.png",
   cns.extra["home_logo"])
ok("no NBL fixture carries a group", not any(x.extra.get("home_group") for x in g))
ok("NBL 2026-27 finals: none published yet",
   fresh().discover("", {"org": "nbl", "stage": "finals", "season": "2026-27"}) == [])
f26 = fresh().discover("", {"org": "nbl", "stage": "finals", "season": "2025-26"})
ok("NBL 2025-26 finals: 13 games, the Ignite Cup final not among them",
   len(f26) == 13 and all(x.extra["stage"] == "finals" for x in f26)
   and not any("cup" in (x.extra["round"] or "").lower() for x in f26), [x.extra["round"] for x in f26])
w26 = fresh().discover("", {"org": "wnbl", "stage": "finals", "season": "2025-26"})
ok("WNBL 2025-26 finals: 7 games (their match_type is empty)", len(w26) == 7, len(w26))
ok("...and 92 regular-season games", len(fresh().discover("", {"org": "wnbl", "stage": "regular", "season": "2025-26"})) == 92)
w27 = fresh().discover("", {"org": "wnbl", "stage": "regular", "season": "2026-27"})
ok("WNBL 2026-27: 99 fixtures, none played; a stats-platform crest asked for as a 200px PNG",
   len(w27) == 99 and all(x.status == "scheduled" for x in w27)
   and any((x.extra["home_logo"] or "").endswith("?size=200&format=png") for x in w27))
m26 = fresh().discover("", {"org": "nbl1", "stage": "regular", "gender": "men", "season": "2026"})
by_conf = defaultdict(int)
for x in m26:
    by_conf[x.extra.get("home_group")] += 1
ok("NBL1 2026 men, regular season: South 209 and North 104, the North's pre-season game left out",
   dict(by_conf) == {"NBL1 South": 209, "NBL1 North": 104}, dict(by_conf))
ok("...both sides of every fixture in its conference",
   all(x.extra["home_group"] == x.extra["away_group"] for x in m26))
fin = fresh().discover("", {"org": "nbl1", "stage": "finals", "gender": "men", "season": "2026"})
ok("NBL1 2026 men's conference finals: 9 South + 6 North", len(fin) == 15, len(fin))
nat = fresh().discover("", {"org": "nbl1", "stage": "national", "gender": "men", "season": "2026"})
ok("NBL1 2026 men's National Finals: 7 games, no conference on them",
   len(nat) == 7 and not any(x.extra.get("home_group") for x in nat), len(nat))
ok("a season the service does not have yet is said so, not read",
   fresh().discover("", {"org": "nbl1", "stage": "regular", "gender": "men", "season": "2027"}) == [])
a = fresh()
ok("first_season keeps a row quiet before its season - without asking the service anything",
   a.discover("", {"org": "nbl1", "stage": "regular", "gender": "men", "season": "2026", "season_auto": True,
                   "first_season": "2027"}) == [] and a.requests_made == [])
ok("...while a season written into the row is read whatever first_season says",
   len(fresh().discover("", {"org": "nbl1", "stage": "regular", "gender": "men", "season": "2026",
                             "first_season": "2027"})) == 313)
for bad, cfg in (("an org nobody runs", {"org": "abl"}), ("NBL1 without a gender", {"org": "nbl1"}),
                 ("a split season for NBL1", {"org": "nbl1", "gender": "men", "season": "2026-27"}),
                 ("a stage NBL does not have", {"org": "nbl", "stage": "national"})):
    try:
        fresh().discover("", cfg)
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)

# ============================================================================ one game
print("\n-- one game at a time")
LEAGUE_BOX = dict(N.LEAGUE_BOX)
GAMES = {
    "36e0818b-58ad-11f1-89d2-fb9d3a8baf78": "NBL27 Cairns 93-87 Tasmania (the saved sample)",
    "1b7bee1e-0fcb-11f1-b26e-b76e98ed2db8": "WNBL26 decider, Perth 105-108 Townsville (OT, the league's box frozen)",
    "24fed80e-d942-11f0-ae40-a990d4889692": "NBL1 Central women, Norwood 81-86 Woodville (team actions with no team)",
    "bd142077-20c1-11f1-95cc-79df6334c739": "NBL26 championship game 4, Adelaide 92-91 Sydney (substitutions typed twice)",
    "b1a89b88-4bef-11f0-aa25-4f4cd43b9dce": "NBL26 Cairns 83-82 Brisbane (six 'starters' a side)",
    "a541adc5-83e7-11f1-9127-15b828f83402": "NBL1 men's National Final, Forestville 67-70 Gold Coast (OT)",
}
FROZEN = {"1b7bee1e-0fcb-11f1-b26e-b76e98ed2db8"}


def check(gid, label, b, reply):
    m = reply["data"][0]
    raw = b.raw
    meta = raw["nbl"]
    side = {N.club_id(m["home_team"]): "1", N.club_id(m["away_team"]): "2"}
    frozen = gid in FROZEN
    # (1) the box: counted from the play-by-play, the league's own where the league's is current
    diffs = []
    for r in m["player_match_statistics"]:
        if str(r.get("period")) != "0":
            continue
        p = raw["tm"][side[N.club_id(r["team"])]]["pl"].get(r["player"]["id"])
        if p is None:
            diffs.append(f"{r['player']['full_name']} missing")
            continue
        for k, fiba in LEAGUE_BOX.items():
            if p[fiba] != r.get(k):
                diffs.append(f"{p['name']} {fiba} {p[fiba]} != {r.get(k)}")
        if not frozen and (p["sMinutes"] != N._mmss(N._secs(r["minutes"])) or p["sPlusMinusPoints"] != r["plus_minus"]):
            diffs.append(f"{p['name']} minutes {p['sMinutes']}/{r['minutes']} +/- {p['sPlusMinusPoints']}/{r['plus_minus']}")
    if frozen:
        ok(f"{label}: the league's box is seen to be frozen, and not used for minutes",
           diffs and not meta["leagueBoxCurrent"], meta["leagueBoxCurrent"])
    else:
        ok(f"{label}: every player's box = the league's box, minutes and plus-minus too",
           not diffs and meta["leagueBoxCurrent"], diffs[:5])
    # (2) the clubs' totals = the league's (players + team rebounds, team turnovers, the coach's foul)
    tdiffs = [f"team{side[N.club_id(t['team'])]} {fiba}" for t in m["team_match_statistics"] if str(t["period"]) == "0"
              for k, fiba in LEAGUE_BOX.items()
              if raw["tm"][side[N.club_id(t["team"])]]["tot_" + fiba] != t.get(k)]
    ok(f"{label}: both clubs' totals = the league's team totals", not tdiffs, tdiffs[:4])
    # (3) the scoreboard
    sc = {"1": int(m["home_score"]), "2": int(m["away_score"])}
    ok(f"{label}: final score {sc['1']}-{sc['2']} and the periods add up to it",
       raw["tm"]["1"]["score"] == sc["1"] and raw["tm"]["2"]["score"] == sc["2"]
       and all(sum(v for k, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k)) == sc[s] for s in "12"))
    ok(f"{label}: the last action's score is the final score, home first",
       [int(raw["pbp"][-1]["s1"]), int(raw["pbp"][-1]["s2"])] == [sc["1"], sc["2"]], raw["pbp"][-1])
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    ok(f"{label}: tip-off from the game's own start time, in UTC", b.tipoff_at == N.utc_iso(m["start_time"]), b.tipoff_at)
    # (4) the play-by-play
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n in play order", an == list(range(1, len(an) + 1)))
    el = [(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0), -N._secs(e["gt"])) for e in raw["pbp"]]
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
    ok(f"{label}: no action string the adapter does not know", not meta["unknown"], meta["unknown"])
    ok(f"{label}: every team action has its team", not meta["teamUnresolved"], meta["teamUnresolved"])
    by_an = {e["actionNumber"]: e for e in raw["pbp"]}
    fo = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    ok(f"{label}: every drawn foul points back at the other side's foul at the same clock ({len(fo)})",
       fo and all(e.get("previousAction") and e["previousAction"] < e["actionNumber"]
                  and by_an[e["previousAction"]]["actionType"] == "foul"
                  and by_an[e["previousAction"]]["tno"] == 3 - e["tno"]
                  and by_an[e["previousAction"]]["gt"] == e["gt"] for e in fo))
    blocks = [e for e in raw["pbp"] if e["actionType"] == "block"]
    ok(f"{label}: every block follows a missed shot of the other side ({len(blocks)})",
       all(any(by_an.get(e["actionNumber"] - k, {}).get("actionType") in ("2pt", "3pt")
               and by_an[e["actionNumber"] - k]["tno"] == 3 - e["tno"] and not by_an[e["actionNumber"] - k]["success"]
               for k in (1, 2, 3)) for e in blocks))
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
        t = sum(600 if i <= 4 else 300 for i in range(1, q)) + (600 if q <= 4 else 300) - N._secs(e["gt"])
        for s in "12":
            for k in on[s]:
                secs[(s, k)] += t - last
        last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
        elif e["actionType"] != "substitution" and any(len(on[s]) != 5 for s in "12"):
            six.append(e["actionNumber"])
    ok(f"{label}: five a side at every action", not six, six[:5])
    length = 2400 + 300 * max(0, npers - 4)
    mdiff = [f"{p['name']} {secs[(s, k)]:.0f}s != {p['sMinutes']}" for s in "12"
             for k, p in raw["tm"][s]["pl"].items() if abs(secs[(s, k)] - N._secs(p["sMinutes"])) > 60]
    ok(f"{label}: every player's minutes from the substitutions = the box minutes (within a minute)",
       not mdiff, mdiff[:4])
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
    return raw


raws = {}
for gid, label in GAMES.items():
    a = fresh()
    reply = load(f"game-{gid[:8]}.json.gz")
    b = a.fetch(gid, {})
    if b is None:
        ok(f"{gid}: fetch returned a bundle", False)
        continue
    raws[gid] = check(gid, label, b, reply)

W = raws.get("1b7bee1e-0fcb-11f1-b26e-b76e98ed2db8")
if W:
    sowah = next(p for p in W["tm"]["2"]["pl"].values() if p["familyName"] == "Sowah")
    ok("WNBL26 decider: Miela Sowah's 18 points come from the play-by-play (the frozen box says 16)",
       sowah["sPoints"] == 18, sowah["sPoints"])
    ok("...every side's minutes add up to 225 (the frozen box: 221:42)",
       all(abs(sum(N._secs(p["sMinutes"]) for p in W["tm"][s]["pl"].values()) - 5 * 2700) <= 5 for s in "12"),
       [sum(N._secs(p["sMinutes"]) for p in W["tm"][s]["pl"].values()) for s in "12"])
    ok("...the overtime is period 1 OVERTIME, scored as p5_score and ot_score",
       any(e["periodType"] == "OVERTIME" for e in W["pbp"]) and W["tm"]["1"]["ot_score"] == W["tm"]["1"]["p5_score"] == 13
       and W["tm"]["2"]["p5_score"] == 16 and W["period"] == 5)
    ok("...its team actions came with no team, and every one was given the right one",
       W["nbl"]["teamInferred"] >= 10 and not W["nbl"]["teamUnresolved"], W["nbl"]["teamInferred"])
ok("some sample game lists its scores away first, and is read home first all the same",
   any(r["nbl"]["scoresAwayFirst"] for r in raws.values()))
B = raws.get("bd142077-20c1-11f1-95cc-79df6334c739")
if B:
    ok("NBL26 championship game 4: the substitutions typed twice are taken once",
       len(B["nbl"]["subsDropped"]) >= 4, B["nbl"]["subsDropped"])
C = raws.get("b1a89b88-4bef-11f0-aa25-4f4cd43b9dce")
if C:
    dnp = [p["name"] for s in "12" for p in C["tm"][s]["pl"].values() if p["sMinutes"] == "0:00" and p["starter"]]
    ok("NBL26 Cairns v Brisbane: a DNP flagged as a starter does not start", not dnp, dnp)
ok("a block typed before its shot is put behind it, somewhere in the sample",
   sum(r["nbl"]["blocksReordered"] for r in raws.values()) > 0)

print("\n-- stable payloads")
h1 = fresh().fetch("36e0818b-58ad-11f1-89d2-fb9d3a8baf78", {}).payload_hash
h2 = fresh().fetch("36e0818b-58ad-11f1-89d2-fb9d3a8baf78", {}).payload_hash
ok("the same reply twice is the same payload (the worker skips an unchanged game)", h1 == h2)
a = fresh()
ok("a fixture weeks away is not fetched at all",
   a.fetch("69ae8846-7351-11f1-a3ab-45abfc40cea9", {"_tipoff_at": "2099-10-15T08:00:00+00:00"}) is None
   and a.requests_made == [])
a = fresh()
ok("a key that is not a match id is not fetched", a.fetch("tasmania-jewels-v-geelong-venom", {}) is None
   and a.requests_made == [])

# ============================================================================ a game in progress
print("\n-- a game still being played")
live = copy.deepcopy(load("game-36e0818b.json.gz"))
m = live["data"][0]
m["match_status"], m["status"] = "live", "IN_PROGRESS"
m["play_by_play"] = [e for e in m["play_by_play"]
                     if N.qnum(e) < 3 or (N.qnum(e) == 3 and (N._secs(e.get("clock")) or 0) >= 300
                                           and e.get("action_type") not in ("period", "fixture"))]
raw = N.raw_from_match(live)
last_clock = min((e["gt"] for e in raw["pbp"] if e["period"] == 3 and e["actionType"] not in ("period", "game")),
                 key=lambda c: N._secs(c))
ok("halfway through Q3: live, period 3, the clock of the last action",
   FibaLiveStatsAdapter._status(raw) == "live" and raw["period"] == 3 and raw["clock"] == last_clock,
   (raw["period"], raw["clock"], last_clock))
ok("...Q1 and Q2 are closed, Q3 is open, and no final whistle is invented",
   [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == [1, 2]
   and not any(e["actionType"] == "game" for e in raw["pbp"]))
ok("a game with nothing recorded yet has no payload (fetch returns None)",
   N.raw_from_match({"data": [dict(m, play_by_play=[])]}) is None)
done = copy.deepcopy(load("game-36e0818b.json.gz"))
done["data"][0]["play_by_play"] = [e for e in done["data"][0]["play_by_play"] if e.get("action_type") != "fixture"]
ok("a finished game whose operator never closed it still gets its final whistle (the result says complete)",
   FibaLiveStatsAdapter._status(N.raw_from_match(done)) == "final")

# ============================================================================ NBL1's conferences
print("\n-- NBL1's conferences, from the feed")
src = {"code": "NBL1M", "adapter": "nbl", "schedule_url": "https://www.nbl1.com.au/fixtures#men",
       "adapter_config": {"org": "nbl1", "gender": "men", "stage": "regular", "groups_from_feed": True,
                          "competition_format": "groups", "season": "2026"}}
ok("before discovery: no groups known, so none written", groups.spec_for(src) is None)
n = groups.learn(src, "2026", m26)
ok(f"learnt from the fixtures ({n} club-in-conference facts)", n == 2 * len(m26))
ok("a South club is in NBL1 South", groups.entry(src, "2026", "Eltham Wildcats") == {"group_name": "NBL1 South"})
ok("a North club is in NBL1 North", groups.entry(src, "2026", "Cairns Marlins") == {"group_name": "NBL1 North"},
   groups.entry(src, "2026", "Cairns Marlins"))
ok("two South clubs share a group; a South and a North club do not",
   groups.same_group(src, "2026", "Eltham Wildcats", "Frankston Blues") is True
   and groups.same_group(src, "2026", "Eltham Wildcats", "Cairns Marlins") is False)
ok("the competition is ranked in groups", groups.competition_format(src) == "groups")
ok("...and no division is written", "division_name" not in groups.entry(src, "2026", "Eltham Wildcats"))
nat_src = dict(src, schedule_url="https://www.nbl1.com.au/fixtures#men-national-finals",
               adapter_config={"org": "nbl1", "gender": "men", "stage": "national"})
ok("the National Finals source learns nothing and writes no group",
   groups.learn(nat_src, "2026", nat) == 0 and groups.spec_for(nat_src) is None)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
