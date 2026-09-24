"""The FEB's leagues (adapters/feb.py), offline, over captured pages and API replies:

    python scripts/ingest/feb_test.py

What it holds the adapter to:
  * the source rows: six leagues (Primera FEB, Segunda FEB, Liga Femenina Endesa, Liga Femenina
    Challenge, Liga Femenina 2, Liga U), a regular and a play-off source each, the two-group leagues
    split into their groups, Tercera FEB left out, and the men's Liga Endesa still on the ACB's own
    adapter (the FEB site does not carry it);
  * the schedule: every fixture of a group from one calendar page, the other group by the page's
    own postback, knockout rounds from the series page the results page links, tip-offs from local
    time to UTC - the Canary Islands an hour behind the peninsula - a played game dated by its round
    until the feed dates it, the club code the club's id;
  * one game, end to end: every player's box = the league's own, the totals the league's plus the
    team's own rebounds and turnovers, the score and the periods, the play-by-play numbered 1..n in
    play order with every period opened and closed once, drawn fouls linked, shots charted, five a
    side at every action, stints covering the game and summing to the score, and the event log
    translate() builds matching every player's box - fouls drawn included - with no warning;
  * the repairs: a line filed under the other club (four assists of 2486258), the opening five
    written as substitutions;
  * the cost: one API request per game, the token read off a page, a club's roster once;
  * a game still being played.

Fixtures in scripts/ingest/data/feb/ (captured 2026-09-24): calendar, results, series, club and
player pages trimmed to their forms, dropdowns, headings and tables (the page token replaced by a
stand-in), and four KeyFacts replies trimmed to the fields the adapter reads.
"""
import copy
import json
import os
import re
import sys
import tempfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import feb as F  # noqa: E402
from adapters import get_adapter  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "feb")
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


def load(name):
    return json.loads(text(name))


class Resp:
    def __init__(self, status, body):
        self.status_code, self.text = status, body

    def json(self):
        return json.loads(self.text)


PAGES = {r"calendario\.aspx\?g=1&t=2026$": "cal-1-2026.html", r"calendario\.aspx\?g=1&t=2025$": "cal-1-2025.html",
         r"calendario\.aspx\?g=2&t=2026$": "cal-2-2026.html", r"calendario\.aspx\?g=74&t=2025$": "cal-74-2025.html",
         r"resultados\.aspx\?g=1&t=2025$": "res-1-2025.html", r"/series/44449$": "series-44449.html",
         r"/equipo/981431$": "equipo-981431.html", r"/jugador/981431/1517914$": "jugador-981431-1517914.html",
         r"resultados\.aspx\?g=4&t=2026$": "res-4-2026.html", r"/series/45080$": "series-45080.html",
         r"calendario\.aspx\?g=4&t=2026$": "INLINE:lfe-cal",
         r"/partido/\d+$": "res-1-2025.html"}           # any page carries the token
POSTBACKS = {"90000": "cal-2-2026-90000.html"}
# LF Endesa's 2026/27 calendar before its first round: one regular group and nothing else
INLINE = {"lfe-cal": ('<html><body><form name="aspnetForm" method="post" action="/calendario/lfendesa/4/2026">'
                      '<input type="hidden" name="_ctl0:token" value="eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDB9.test">'
                      '<select name="_ctl0:MainContentPlaceHolderMaster:gruposDropDownList">'
                      '<option selected="selected" value="89975">Liga Regular &#218;nico</option></select></body></html>')}
GAMES = ("2513900", "2486258", "2479452", "2513595")


class Offline(F.FebAdapter):
    """The real adapter with every request served from the fixtures, and counted."""
    min_request_gap_s = 0.0

    def __init__(self):
        super().__init__()
        self.asked = []
        self.unauthorised_once = False

    def _get(self, url, headers=None):
        self.asked.append(url)
        if url.startswith(F.API):
            if self.unauthorised_once:
                self.unauthorised_once = False
                return Resp(401, "")
            gid = url.rsplit("/", 1)[-1]
            p = os.path.join(DATA, f"keyfacts-{gid}.json")
            return Resp(200, text(f"keyfacts-{gid}.json")) if os.path.exists(p) else Resp(404, "")
        for pat, name in PAGES.items():
            if re.search(pat, url):
                return Resp(200, INLINE[name[7:]] if name.startswith("INLINE:") else text(name))
        return Resp(404, "")

    def _postback(self, url, page, group_value):
        self.asked.append(f"POSTBACK {group_value}")
        name = POSTBACKS.get(group_value)
        return text(name) if name else None


def fresh():
    F.FebAdapter._pages = {}
    F.FebAdapter._token = ("", 0.0)
    F.FebAdapter._fixtures = {}
    F.FebAdapter._caches = {}
    # the production path: the Actions runner has no scraper folder, so stints come from stints.py
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


ROOT = tempfile.mkdtemp()

# ============================================================================ the source rows
print("-- the source rows")
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if s.get("adapter") == "feb"]
want = {("FEB1", 1), ("FEB2", 2), ("LFE", 4), ("LFCH", 67), ("LF2", 9), ("LIGAU", 74)}
ok("six leagues, a regular and a play-off source each",
   {(s["code"], s["adapter_config"]["competition"]) for s in rows} == want and len(rows) == 12
   and {s["adapter_config"]["stage"] for s in rows} == {"regular", "playoffs"}, [(s["code"], s["adapter_config"].get("stage")) for s in rows])
ok("no Tercera FEB (competition 3)", not any(s["adapter_config"].get("competition") == 3 for s in rows))
ok("the men's Liga Endesa stays on the ACB's own adapter",
   any(s.get("league_slug") == "liga-endesa" and s["adapter"] == "acb" for s in src))
grouped = {s["code"] for s in rows if (s["adapter_config"].get("groups_from_feed") and s["adapter_config"]["stage"] == "regular")}
ok("Segunda FEB, LF2 and Liga U take their groups from the calendar", grouped == {"FEB2", "LF2", "LIGAU"}, grouped)
ok("...as 'groups' competitions", all(s["adapter_config"].get("competition_format") == "groups"
                                     for s in rows if s["code"] in grouped and s["adapter_config"]["stage"] == "regular"))
ok("every row is Spanish, and each league's two rows share one league",
   all(s["league_country"] == "ES" for s in rows)
   and all(len({s["league_slug"] for s in rows if s["code"] == c}) == 1 for c, _ in want))
ok("the play-off rows are play-off competitions with their own URL",
   all(s.get("competition_kind") == "playoff" and s["scheduleUrls"][0].endswith("#playoffs")
       for s in rows if s["adapter_config"]["stage"] == "playoffs"))
ok("the adapter can read a season (a backfill will not re-read this one)",
   '"feb"' in open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().split("SEASON_AWARE_ADAPTERS =", 1)[1][:500])
ok("the registry knows it", type(get_adapter("feb")).__name__ == "FebAdapter")

# ============================================================================ the schedule
print("\n-- the schedule")
a = fresh()
p26 = list(a.discover("", {"code": "FEB1", "competition": 1, "stage": "regular", "season": "2026-27", "repo_root": ROOT}))
clubs = {g.extra["home_code"] for g in p26} | {g.extra["away_code"] for g in p26}
ok("Primera FEB 2026/27: 306 fixtures, 18 clubs, from ONE page", len(p26) == 306 and len(clubs) == 18
   and len(a.asked) == 1 and "calendario.aspx?g=1&t=2026" in a.asked[0], (len(p26), len(clubs), a.asked))
g0 = next(g for g in p26 if g.external_id == "2535725")
ok("2535725 Bueno Arenas Albacete Basket at home, Saturday 26/09/2026 19:00 Madrid = 17:00 UTC, scheduled, Jornada 1",
   (g0.home_name, g0.tipoff_at, g0.status, g0.extra["round"], g0.extra["stage"]) ==
   ("BUENO ARENAS ALBACETE BASKET", "2026-09-26T17:00:00Z", "scheduled", "Jornada 1", "regular"), g0)
ok("club codes are the clubs' ids, crests over https", g0.extra["home_code"] == "1009716"
   and g0.extra["home_logo"].startswith("https://imagenes.feb.es/"), g0.extra)
ok("a one-group league carries no group", not any("home_group" in g.extra for g in p26))
tbc = [g for g in p26 if g.extra.get("time_tbc")]
ok("a fixture listed at 0:00 has no time yet (2535901, Tuesday 9 Feb 2027): noon UTC on its day, flagged",
   [(g.external_id, g.tipoff_at) for g in tbc] == [("2535901", "2027-02-09T12:00:00Z")], [(g.external_id, g.tipoff_at) for g in tbc])
ok("the page's token is kept for the game requests", bool(F.FebAdapter._token[0]))

a = fresh()
s26 = list(a.discover("", {"code": "FEB2", "competition": 2, "stage": "regular", "season": "2026", "repo_root": ROOT}))
by = defaultdict(set)
for g in s26:
    by[g.extra["home_group"]] |= {g.extra["home_code"], g.extra["away_code"]}
ok("Segunda FEB 2026/27: 364 fixtures, groups A and B of 14 clubs each",
   len(s26) == 364 and {k: len(v) for k, v in by.items()} == {"Grupo A": 14, "Grupo B": 14}, {k: len(v) for k, v in by.items()})
ok("...group B by one postback of the page's own dropdown", a.asked.count("POSTBACK 90000") == 1 and len(a.asked) == 2, a.asked)
ok("...and never a club in both groups", not (by["Grupo A"] & by["Grupo B"]))

a = fresh()
p25 = list(a.discover("", {"code": "FEB1", "competition": 1, "stage": "regular", "season": "2025-26", "repo_root": ROOT}))
ok("Primera FEB 2025/26: 272 games, all final", len(p25) == 272 and all(g.status == "final" for g in p25))
gA = next(g for g in p25 if g.external_id == "2486258")
ok("a played game shows only its score: dated by its round, noon UTC, until the feed dates it",
   gA.tipoff_at == "2025-09-26T12:00:00Z" and gA.extra.get("time_tbc"), (gA.tipoff_at, gA.extra))

a = fresh()
po = list(a.discover("", {"code": "FEB1", "competition": 1, "stage": "playoffs", "season": "2025-26", "repo_root": ROOT}))
rounds = defaultdict(int)
for g in po:
    rounds[g.extra["round"]] += 1
ok("the 2025/26 play-offs: 18 games from the series page the results page links",
   len(po) == 18 and dict(rounds) == {"1/4 Final": 15, "1/2 Final": 2, "Final": 1}, dict(rounds))
fin = next(g for g in po if g.external_id == "2513900")
ok("the final: Estudiantes (the federation's local) v Leyma Coruña, 07/06/2026 19:00 = 17:00 UTC",
   (fin.home_name, fin.away_name, fin.tipoff_at, fin.extra["stage"]) ==
   ("MOVISTAR ESTUDIANTES", "LEYMA CORUÑA", "2026-06-07T17:00:00Z", "playoffs"), fin)
ok("...and the regular season is never read by the play-off source", not ({g.external_id for g in po} & {g.external_id for g in p25}))

a = fresh()
lu = list(a.discover("", {"code": "LIGAU", "competition": 74, "stage": "playoffs", "season": "2025", "repo_root": ROOT}))
ok("Liga U's later phases are its play-off source (the third-place game, named by its phase)",
   any(g.external_id == "2513595" and g.extra["round"].startswith("3º-4º") for g in lu), [(g.external_id, g.extra["round"]) for g in lu])
ok("...a phase whose page cannot be read is skipped, not a failure", len(lu) >= 1)

print("\n-- a cup filed under the league")
for label, cup in (("Supercopa 1/2 Final", True), ("Supercopa Final", True), ("C.SM Reina 1/4 Final", True),
                   ("C.SM Reina Final", True), ("Play-Offs Final", False), ("Play-offs 1/4 Final", False),
                   ('2ª FASE Grupo "A"', False), ("PLAY-OUT 2ºB-7ºA", False), ("3º-4º 3º-4º", False)):
    ok(f"{label!r} is {'a cup, never' if cup else 'the league’s own phase, and'} read as the league's",
       bool(F.CUP.search(label)) == cup)
lfe_root = tempfile.mkdtemp()
a = fresh()
lfe = list(a.discover("", {"code": "LFE", "competition": 4, "stage": "playoffs", "season": "2026-27", "repo_root": lfe_root}))
ok("LF Endesa 2026/27 before its first round: the play-off source finds nothing - the Supercopa semi-finals "
   "(the results page's latest phase) are not the league's play-offs", lfe == [], [(g.external_id, g.extra) for g in lfe])
cache = a._cache({"code": "LFE", "repo_root": lfe_root})
ok("...and they are remembered as cup games (2528245 Casademont Zaragoza v Valencia, 2528246 Leganés v Jairis)",
   cache.get("cup_games") == ["2528245", "2528246"], cache.get("cup_games"))
b = fresh()
ok("...so a lane that fetches by stored id (the live lane, with no schedule) never fetches one as the league's",
   b.fetch("2528245", {"code": "LFE", "repo_root": lfe_root}) is None and not any(u.startswith(F.API) for u in b.asked), b.asked)

print("\n-- time zones and groups")
for name, canary in (("SPAR GRAN CANARIA", True), ("LA LAGUNA TOYOTA  ADAREVA", True), ("VEGA LAGUNERA TOYOTA  ADAREVA TENERIFE", True),
                     ("MAGEC TÍAS LANZAROTE CONTRA LA VIOLENCIA DE GÉNERO", True), ("HESTIA MENORCA", False),
                     ("PALMER BASKET MALLORCA PALMA", False), ("AZULMARINO MALLORCA PALMA", False), ("BALONCESTO LAGUNA DE DUERO", False)):
    ok(f"{name!r} plays at home in {'Canary' if canary else 'peninsular'} time", bool(F.CANARY_CLUB.search(name)) == canary)
ok("a venue in Las Palmas or Santa Cruz de Tenerife is Canary time",
   bool(F.CANARY_PLACE.search("C/ MANUEL DE FALLA, S/N, Las Palmas (Palmas de Gran Canaria, Las)"))
   and bool(F.CANARY_PLACE.search("CALLE TACORONTE S/N, Santa Cruz de Tenerife (San Cristóbal de La Laguna)"))
   and not F.CANARY_PLACE.search("Francisco Pérez Carballo, 2, A Coruña (Coruña, A)"))
for label, want_label in (('Liga Regular "A"', "Grupo A"), ('LIGA REGULAR GRUPO "B"', "Grupo B"),
                          ('Liga Regular "ESTE"', "Este"), ("Liga Regular Único", "")):
    ok(f"group {label!r} -> {want_label!r}", F.group_label(label) == want_label, F.group_label(label))
for bad, cfg in (("a row with no competition", {"code": "X"}), ("a stage that is neither", {"competition": 1, "stage": "cup"})):
    try:
        list(fresh().discover("", cfg))
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)

# ============================================================================ fetch() -> bundle
print("\n-- fetch(): one game, end to end, against the league's own box")
BOX = {"pts": "sPoints", "p2m": "sTwoPointersMade", "p2a": "sTwoPointersAttempted", "p3m": "sThreePointersMade",
       "p3a": "sThreePointersAttempted", "p1m": "sFreeThrowsMade", "p1a": "sFreeThrowsAttempted", "ro": "sReboundsOffensive",
       "rd": "sReboundsDefensive", "rt": "sReboundsTotal", "assist": "sAssists", "st": "sSteals", "to": "sTurnovers",
       "bs": "sBlocks", "tc": "sBlocksReceived", "pf": "sFoulsPersonal", "rf": "sFoulsOn", "pllss": "sPlusMinusPoints"}
TIPS = {"2513900": "2026-06-07T17:00:00Z", "2486258": "2025-09-27T17:00:00Z", "2479452": "2025-10-12T11:00:00Z",
        "2513595": "2026-05-17T11:00:00Z"}


def check(label, gid, b, reply):
    raw = b.raw
    lines = reply["PLAYBYPLAY"]["LINES"]
    side_of = {str(t["id"]): ("1" if str(t["id"]) == raw["tm"]["1"]["code"] else "2") for t in reply["SCOREBOARD"]["TEAM"]}
    # (1) every player of the league's box, every field
    diffs = []
    for t in reply["SCOREBOARD"]["TEAM"]:
        s = side_of[str(t["id"])]
        for row in t["PLAYER"]:
            p = raw["tm"][s]["pl"].get(str(row["id"]))
            if p is None:
                diffs.append(f"{row['id']} missing")
                continue
            for k, fk in BOX.items():
                if p[fk] != F._n(row.get(k)):
                    diffs.append(f"{row['name']} {fk} {p[fk]} != {row.get(k)}")
            if F._clock_secs(p["sMinutes"]) != F._n(row.get("min")):
                diffs.append(f"{row['name']} minutes")
    ok(f"{label}: every player's box = the league's box", not diffs, diffs[:5])
    # (2) totals: the league's (= its players) plus the team's own rebounds and turnovers
    tdiffs = []
    for t in reply["SCOREBOARD"]["TEAM"]:
        s = side_of[str(t["id"])]
        feed_side = "1" if t is reply["SCOREBOARD"]["TEAM"][0] else "2"
        team_reb = sum(1 for l in lines if l.get("action") == "rebound" and not l.get("idPlayer") and l.get("team") == feed_side)
        team_tov = sum(1 for l in lines if l.get("action") == "lose" and not l.get("idPlayer") and l.get("team") == feed_side)
        players = lambda k: sum(F._n(p.get(k)) for p in t["PLAYER"])  # noqa: E731
        if raw["tm"][s]["tot_sReboundsTotal"] != players("rt") + team_reb:
            tdiffs.append(f"team {s} rebounds")
        if raw["tm"][s]["tot_sTurnovers"] != players("to") + team_tov:
            tdiffs.append(f"team {s} turnovers")
        if raw["tm"][s]["tot_sPoints"] != players("pts"):
            tdiffs.append(f"team {s} points")
    ok(f"{label}: totals = the players' + the team's own rebounds and turnovers", not tdiffs, tdiffs)
    # (3) the scoreboard
    sc = {s: raw["tm"][s]["score"] for s in "12"}
    ok(f"{label}: final score {sc['1']}-{sc['2']} and the periods add up to it",
       all(sum(v for k, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k)) == sc[s] for s in "12"))
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    ok(f"{label}: tip-off from the feed's own start, local time -> UTC", b.tipoff_at == TIPS[gid], b.tipoff_at)
    # (4) the play-by-play
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n in play order", an == list(range(1, len(an) + 1)))
    el = [(e["period"] + (4 if e["periodType"] == "OVERTIME" else 0), -F._clock_secs(e["gt"])) for e in raw["pbp"]]
    ok(f"{label}: ...and the clock never runs backwards", all(x <= y for x, y in zip(el, el[1:])))
    ok(f"{label}: success 1/0, tno 0/1/2, pno a string, no private key",
       all(e["success"] in (0, 1) and not isinstance(e["success"], bool) and e["tno"] in (0, 1, 2)
           and isinstance(e["pno"], str) and not any(k.startswith("_") for k in e) for e in raw["pbp"]))
    npers = raw["period"]
    starts = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"]
    ends = [e for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"]
    ok(f"{label}: {npers} periods, each started and ended once, one final whistle, last",
       len(starts) == len(ends) == npers == len(reply["HEADER"]["QUARTERS"]["QUARTER"])
       and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1 and raw["pbp"][-1]["actionType"] == "game")
    ok(f"{label}: no line the adapter does not know", not raw["feb"]["unknown"], raw["feb"]["unknown"])
    by_an = {e["actionNumber"]: e for e in raw["pbp"]}
    fo = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    ok(f"{label}: every drawn foul points at the other side's foul, same clock ({len(fo)})",
       fo and all(by_an[e["previousAction"]]["actionType"] == "foul" and by_an[e["previousAction"]]["tno"] == 3 - e["tno"]
                  and by_an[e["previousAction"]]["gt"] == e["gt"] for e in fo))
    shots = [s for t in "12" for s in raw["tm"][t]["shot"]]
    positioned = sum(1 for l in lines if l.get("action") == "shoot" and "|" in str(l.get("Position") or ""))
    ok(f"{label}: every positioned shot charted ({len(shots)}), on a shot action of its own club",
       len(shots) == positioned and all(by_an[s["actionNumber"]]["actionType"] == s["actionType"]
                                        and str(by_an[s["actionNumber"]]["tno"]) == t for t in "12" for s in raw["tm"][t]["shot"]))
    ok(f"{label}: every shot on FIBA's court (0-100 both ways)", all(0 <= s["x"] <= 100 and 0 <= s["y"] <= 100 for s in shots))
    # (5) starters, minutes and stints
    for s in "12":
        st = [k for k, p in raw["tm"][s]["pl"].items() if p["starter"] == 1]
        ok(f"{label}: team {s} has exactly five starters", len(st) == 5, st)
    on = {s: {k for k, p in raw["tm"][s]["pl"].items() if p["starter"]} for s in "12"}
    secs, last, six = defaultdict(float), 0.0, []
    for e in raw["pbp"]:
        q = e["period"] + (4 if e["periodType"] == "OVERTIME" else 0)
        t = sum(600 if i <= 4 else 300 for i in range(1, q)) + (600 if q <= 4 else 300) - F._clock_secs(e["gt"])
        for s in "12":
            for k in on[s]:
                secs[(s, k)] += t - last
        last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
        elif e["actionType"] != "substitution" and any(len(on[s]) != 5 for s in "12"):
            six.append(e["actionNumber"])
    ok(f"{label}: five a side at every action", not six, six[:5])
    mdiff = [f"{p['name']} {secs[(s, k)]:.0f}s != {p['sMinutes']}" for s in "12" for k, p in raw["tm"][s]["pl"].items()
             if abs(secs[(s, k)] - F._clock_secs(p["sMinutes"])) > 60]
    ok(f"{label}: every player's minutes from the substitutions = the box minutes (within a minute)", not mdiff, mdiff[:4])
    length = 2400 + 300 * max(0, npers - 4)
    lu_ = [(r["home_lineup"], r["away_lineup"]) for r in b.stints]
    ok(f"{label}: {len(b.stints)} stints, every one five a side",
       b.stints and all(len(h.split(",")) == 5 and len(x.split(",")) == 5 for h, x in lu_))
    ok(f"{label}: stints cover the whole game ({length}s)", abs(sum(r["duration"] for r in b.stints) - length) < 0.01)
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
            want_ = {"pts": p["sPoints"], "fga": p["sFieldGoalsAttempted"], "fgm": p["sFieldGoalsMade"],
                     "fta": p["sFreeThrowsAttempted"], "ftm": p["sFreeThrowsMade"],
                     "oreb": p["sReboundsOffensive"], "dreb": p["sReboundsDefensive"],
                     "ast": p["sAssists"], "stl": p["sSteals"], "blk": p["sBlocks"],
                     "to": p["sTurnovers"], "pf": p["sFoulsPersonal"]}
            for k, v in want_.items():
                if e.get(k, 0) != v:
                    ediff.append(f"{p['name']} {k} log={e.get(k, 0)} box={v}")
            if drawn.get(f"{i}:{pno}", 0) != p["sFoulsOn"]:
                ediff.append(f"{p['name']} fouls drawn log={drawn.get(f'{i}:{pno}', 0)} box={p['sFoulsOn']}")
    ok(f"{label}: the event log sums to every player's box - offensive/defensive rebounds and fouls drawn included",
       not ediff, ediff[:6])


LABELS = {"2513900": "the 2025/26 Primera FEB final (overtime)", "2486258": "Primera FEB, four assists filed under the other club",
          "2479452": "LF Endesa in Gran Canaria (Canary time, a coach's technical)", "2513595": "Liga U's third-place game"}
for gid in GAMES:
    a = fresh()
    cfg = {"code": "T" + gid, "repo_root": ROOT}
    b = a.fetch(gid, cfg)
    if b is None:
        ok(f"{gid}: fetch returned a bundle", False)
        continue
    check(f"{gid} {LABELS[gid]}", gid, b, load(f"keyfacts-{gid}.json"))
    api = [u for u in a.asked if u.startswith(F.API)]
    ok(f"{gid}: ONE API request for the whole game (KeyFacts: box, play-by-play and shots)",
       api == [f"{F.API}/KeyFacts/{gid}"], api)

print("\n-- the repairs, the names, the cost")
b = fresh().fetch("2486258", {"code": "R1", "repo_root": ROOT})
ok("2486258: the four assists filed under the other club are the players' own club's",
   len(b.raw["feb"]["repairs"]) == 4 and all(r.startswith("assist #") for r in b.raw["feb"]["repairs"]), b.raw["feb"]["repairs"])
reply = load("keyfacts-2513900.json")
ins = [l for l in reply["PLAYBYPLAY"]["LINES"] if l.get("action") == "subst" and l.get("time") == "10:00" and l.get("quarter") == "1"]
b = fresh().fetch("2513900", {"code": "R2", "repo_root": ROOT})
q1_open = [e for e in b.raw["pbp"] if e["actionType"] == "substitution" and e["period"] == 1 and e["gt"] == "10:00"
           and e["periodType"] == "REGULAR"]
ok(f"the opening five written as {len(ins)} 'enters the court' lines is a lineup, not {len(ins)} substitutions",
   len(ins) >= 10 and not q1_open, (len(ins), len(q1_open)))
a = fresh()
cfg = {"code": "NAMES", "repo_root": ROOT}
b = a.fetch("2513900", cfg)
home = b.raw["tm"]["1"]["pl"]
ok("full names from the club's page: C. BARTON is Charles William Barton",
   (home["2451497"]["firstName"], home["2451497"]["familyName"]) == ("CHARLES WILLIAM", "BARTON"), home["2451497"])
ok("...and a player the club's page does not list, from his own page: S. GARCIA CALVO is Sergi",
   (home["1517914"]["firstName"], home["1517914"]["familyName"]) == ("SERGI", "GARCIA CALVO"), home["1517914"])
cache = json.load(open(os.path.join(ROOT, "data", "feed", "NAMES", "feb.json"), encoding="utf-8"))
ok("...remembered in data/feed/<code>/feb.json", cache["rosters"]["981431"].get("2451497") == "CHARLES WILLIAM BARTON")
a2 = Offline()
F.FebAdapter._pages = {}
a2.fetch("2513900", cfg)
ok("...so the next fetch asks about that club again not at all",
   not any("/equipo/981431" in u or "/jugador/981431/" in u for u in a2.asked), a2.asked)
ok("...and a player neither page names costs at most four player pages a game",
   sum(1 for u in a.asked if "/jugador/" in u) <= 2 * F.FebAdapter.MAX_PLAYER_PAGES)
a = fresh()
b = a.fetch("2479452", {"code": "TZ", "repo_root": ROOT})
ok("a club's venue teaches its time zone: SPAR Gran Canaria plays at home in Canary time",
   a._cache({"code": "TZ", "repo_root": ROOT})["tz"].get(b.raw["tm"]["1"]["code"]) == "Atlantic/Canary")
a = fresh()
a.unauthorised_once = True
b = a.fetch("2513595", {"code": "AUTH", "repo_root": ROOT})
ok("an expired token is fetched again once, and the game still comes", b is not None
   and sum(1 for u in a.asked if u.startswith(F.API)) == 2, a.asked)
a = fresh()
ok("a fixture weeks away is never fetched", a.fetch("2535725", {"code": "X", "_tipoff_at": "2099-09-26T17:00:00Z"}) is None
   and a.asked == [])
ok("a game the API does not have yet (404) is nothing to fetch", fresh().fetch("2535725", {"code": "X"}) is None)
ok("a key that is not an FEB game id is not fetched", fresh().fetch("proa-2026-1", {}) is None)
h1 = fresh().fetch("2513900", {"code": "H", "repo_root": ROOT}).payload_hash
h2 = fresh().fetch("2513900", {"code": "H", "repo_root": ROOT}).payload_hash
ok("the same reply twice is the same payload (the worker skips an unchanged game)", h1 == h2)

print("\n-- home is the calendar's")
F.FebAdapter._fixtures = {"2486258": ("981493", "979989")}          # a calendar that had Ourense at home
raw = F.raw_from_keyfacts(load("keyfacts-2486258.json"), home_id="981493")
ok("a fixture the calendar lists the other way round is turned round: team 1 is the calendar's home",
   raw["tm"]["1"]["code"] == "981493" and raw["tm"]["1"]["score"] == 76 and raw["tm"]["2"]["score"] == 87
   and raw["pbp"][-2]["s1"] == "76", (raw["tm"]["1"]["code"], raw["tm"]["1"]["score"], raw["pbp"][-2]["s1"]))

print("\n-- a game still being played")
live = copy.deepcopy(load("keyfacts-2513900.json"))
live["HEADER"].update({"status": "2", "statusText": "IN PROGRESS", "time": "04:59", "quarter": 3})
live["PLAYBYPLAY"]["LINES"] = [l for l in live["PLAYBYPLAY"]["LINES"]
                               if F._n(l.get("quarter")) < 3 or (F._n(l.get("quarter")) == 3 and F._clock_secs(l.get("time")) >= 300
                                                                  and l.get("action") != "period")]
raw = F.raw_from_keyfacts(live)
ok("halfway through Q3: live, period 3, the feed's own clock",
   FibaLiveStatsAdapter._status(raw) == "live" and raw["period"] == 3 and raw["clock"] == "04:59", (raw["period"], raw["clock"]))
ok("...Q1 and Q2 are closed, Q3 is open, and no final whistle is invented",
   [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == [1, 2]
   and not any(e["actionType"] == "game" for e in raw["pbp"]))
ok("a game with no play-by-play yet has no payload",
   F.raw_from_keyfacts(dict(live, PLAYBYPLAY={"LINES": []})) is None)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
