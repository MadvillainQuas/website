"""BNXT League (adapters/bnxt.py), offline:

    python scripts/ingest/bnxt_test.py

What it holds the adapter to:
  * the source rows: the regular season and the two national play-offs (Belgium, the Netherlands)
    as competitions of their own, in one league filed under Belgium;
  * the schedule, from captured replies of the league's own API: the API's END-year seasons (2026-27
    is 2027), one request per phase, a Supercup never read as the league's, home first (side 1), a
    play-off entry's " playoff" tag dropped, Brussels time -> UTC;
  * a game whose play-by-play the league has purged (every 2025-26 game): nothing to fetch;
  * the translator, on a synthetic game written to the event codes the scraper validated in July 2026
    (20 of 20 games exact against the box) - because the league purges each season's film and
    2026-27 opens on 2 October, there is no real one to capture yet: made/missed twos, threes and free
    throws, rebounds (a player's and the team's), steals, turnovers, a foul and the foul drawn,
    assists, blocks, a substitution (player in, player2 out), a marker and an unknown code; periods,
    the final whistle, scores, 1of2/2of2, the drawn foul linked, five a side, stints and the event log;
  * the public token re-read from the site's own app script when the stored one is refused.

Fixtures in scripts/ingest/data/bnxt/ (captured 2026-09-24): the API's phase lists and per-phase
schedules for 2025-26 and 2026-27 (trimmed to the fields read) and one real 2025-26 box score.
"""
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import bnxt as B  # noqa: E402
from adapters import get_adapter  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "bnxt")
PASS = FAIL = 0
FX = json.load(open(os.path.join(DATA, "api.json"), encoding="utf-8"))
BOX = json.load(open(os.path.join(DATA, "box-10569.json"), encoding="utf-8"))


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


# ---------------------------------------------------------------- a synthetic game
def pl(pid, first, last):
    return {"id": pid, "first_name": first, "last_name": last}


HOME = [pl(101 + i, "Home", f"Player{i + 1}") for i in range(6)]
AWAY = [pl(201 + i, "Away", f"Player{i + 1}") for i in range(6)]


def e(order, period, minute, second, code, sub=None, home=True, player=None, player2=None):
    return {"order": order, "period": period, "minute": minute, "second": second, "event_code": code,
            "event_subcode": sub, "is_home": home, "player": player, "player2": player2}


FILM = [
    e(1, 1, 0, 0, 1101, home=True),                                   # a period marker: skipped
    e(2, 1, 0, 20, 1000, 1, True, HOME[0]),                           # 2pt jumpshot made  2-0
    e(3, 1, 0, 40, 1001, 3, False, AWAY[0]),                          # 3pt missed
    e(4, 1, 0, 41, 1002, None, True, HOME[1]),                        # defensive rebound
    e(5, 1, 1, 0, 1000, 2, True, HOME[2]),                            # 2pt layup made     4-0
    e(6, 1, 1, 0, 1008, None, True, HOME[0]),                         # the assist
    e(7, 1, 1, 30, 1007, None, False, AWAY[1]),                       # away foul
    e(8, 1, 1, 30, 1006, None, True, HOME[3]),                        # ...drawn by home #4
    e(9, 1, 1, 30, 1000, 4, True, HOME[3]),                           # FT made            5-0
    e(10, 1, 1, 30, 1001, 4, True, HOME[3]),                          # FT missed
    e(11, 1, 1, 31, 1002, None, False, None),                         # the away TEAM's defensive rebound
    e(12, 1, 2, 0, 1004, None, False, AWAY[2]),                       # steal
    e(13, 1, 2, 0, 1005, None, True, HOME[4]),                        # the turnover
    e(14, 1, 2, 10, 1001, 1, True, HOME[0]),                          # 2pt missed
    e(15, 1, 2, 10, 1009, None, False, AWAY[3]),                      # blocked
    e(16, 1, 2, 11, 1003, None, True, HOME[1]),                       # offensive rebound
    e(17, 1, 3, 0, 1011, None, True, HOME[5], HOME[4]),               # sub: #6 in, #5 out
    e(18, 1, 3, 0, 1234, None, True, HOME[0]),                        # a code nobody knows
    e(19, 2, 4, 0, 1000, 3, False, AWAY[0]),                          # 3pt made           5-3
    e(20, 3, 5, 0, 1000, 1, True, HOME[5]),                           # 2pt made           7-3
    e(21, 4, 9, 59, 1000, 1, False, AWAY[4]),                         # 2pt made           7-5
]


def box_from(film):
    """A box that is exactly the film's, so the checks below are the translator's alone."""
    stat = defaultdict(lambda: defaultdict(int))
    for x in film:
        p = (x.get("player") or {}).get("id")
        code, sub = x["event_code"], x["event_subcode"]
        if not p:
            continue
        s = stat[p]
        if code in (1000, 1001):
            made = code == 1000
            if sub == 4:
                s["free_throw_all"] += 1
                s["free_throw_made"] += made
                s["points"] += made
            elif sub == 3:
                s["three_point_all"] += 1
                s["three_point_made"] += made
                s["points"] += 3 * made
            else:
                s["two_point_all"] += 1
                s["two_point_made"] += made
                s["points"] += 2 * made
        key = {1002: "defensive_rebound", 1003: "offensive_rebound", 1004: "steal", 1005: "turnover",
               1007: "foul", 1006: "defensive_foul", 1008: "assist", 1009: "block"}.get(code)
        if key:
            s[key] += 1
    out = []
    for is_home, roster in ((True, HOME), (False, AWAY)):
        players = []
        for i, p in enumerate(roster):
            s = stat[p["id"]]
            s["throw_made"] = s["two_point_made"] + s["three_point_made"]
            s["throw_all"] = s["two_point_all"] + s["three_point_all"]
            s["total_rebound"] = s["defensive_rebound"] + s["offensive_rebound"]
            players.append({"player": p, "jersey": i + 1, "starter": i < 5, "minute": 8 if i < 5 else 0, **s})
        out.append({"is_home": is_home, "team": {"id": 900 if is_home else 901, "name": ("Home" if is_home else "Away") + " club playoff",
                                                 "team_logo": {"public_url": "https://bnxt.sportpress.info/storage/x.png"}},
                    "players": players, "total": {"points": sum(q.get("points", 0) for q in players)}})
    return out


# ---------------------------------------------------------------- the offline adapter
class Offline(B.BnxtAdapter):
    asked: list = []

    def _get(self, path, params=None):
        Offline.asked.append((path, dict(params or {})))
        if path.startswith("/phase/season/"):
            return FX.get(path.lstrip("/"))
        if path.startswith("/schedule/club/"):
            season = path.rsplit("/", 1)[1]
            return FX.get(f"schedule/club/{season}/{params['phase_id']}")
        if path == "/schedule/find/10569":
            return {"id": 10569, "status": "finished", "game_time": "2026-04-28 20:00:00", "competition": {"id": 24}}
        if path == "/schedule/find/99999":
            return {"id": 99999, "status": "finished", "game_time": "2026-10-02 20:00:00", "competition": {"id": 25}}
        if path == "/film/game/24/10569":
            return []                                  # purged
        if path == "/boxscore/game/24/10569":
            return BOX
        if path == "/film/game/25/99999":
            return FILM
        if path == "/boxscore/game/25/99999":
            return box_from(FILM)
        return None


def fresh():
    Offline.asked = []
    B.BnxtAdapter._games = {}
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


print("-- the source rows")
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if s.get("adapter") == "bnxt"]
ok("the regular season and the two national play-offs, one league, filed under Belgium",
   sorted((s["adapter_config"]["stage"], s["adapter_config"].get("phase_match", "")) for s in rows)
   == [("playoffs", "belgium"), ("playoffs", "netherlands"), ("regular", "")]
   and {s["league_slug"] for s in rows} == {"bnxt-league"} and all(s["league_country"] == "BE" for s in rows), rows)
ok("each play-off is a competition of its own, with its own URL",
   sorted(s.get("competition_label") for s in rows if s["adapter_config"]["stage"] == "playoffs")
   == ["BNXT Playoffs Belgium", "BNXT Playoffs Netherlands"]
   and len({s["scheduleUrls"][0] for s in rows}) == 3)
ok("the registry knows it, and a backfill can read a season",
   type(get_adapter("bnxt")).__name__ == "BnxtAdapter"
   and '"bnxt"' in open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().split("SEASON_AWARE_ADAPTERS =", 1)[1][:500])

print("\n-- the schedule")
a = fresh()
g26 = list(a.discover("", {"stage": "regular", "season": "2026-27"}))
ok("2026-27 is the API's season 2027", Offline.asked[0][0] == "/phase/season/2027", Offline.asked[:2])
ok("2026-27: 240 fixtures, all to come", len(g26) == 240 and all(g.status == "scheduled" for g in g26), len(g26))
f0 = next(g for g in g26 if g.external_id == "11271")
ok("11271: House of Talents Spurs Kortrijk v Donar Groningen, 2 Oct 20:00 Brussels = 18:00 UTC",
   (f0.home_name, f0.away_name, f0.tipoff_at, f0.extra["venue"]) ==
   ("House of Talents Spurs Kortrijk", "Donar Groningen", "2026-10-02T18:00:00Z", "Sportcampus Lange Munte"), f0)
ok("clubs coded by the league's id, crests over https",
   (f0.extra["home_code"], f0.extra["away_code"]) == ("565", "547") and f0.extra["home_logo"].startswith("https://"))
ok("one request per phase", sum(1 for p, _ in Offline.asked if p.startswith("/schedule/club/")) == 1)
a = fresh()
r25 = list(a.discover("", {"stage": "regular", "season": "2025-26"}))
be = list(a.discover("", {"stage": "playoffs", "season": "2025-26", "phase_match": "belgium"}))
nl = list(a.discover("", {"stage": "playoffs", "season": "2025-26", "phase_match": "netherlands"}))
ok("2025-26: 306 regular-season games, 22 in the Belgian play-offs, 18 in the Dutch - all final",
   (len(r25), len(be), len(nl)) == (306, 22, 18) and all(g.status == "final" for g in r25 + be + nl), (len(r25), len(be), len(nl)))
ok("the stages never share a game", not ({g.external_id for g in r25} & {g.external_id for g in be + nl}))
phases_read = [p["phase_id"] for path, p in Offline.asked if path.startswith("/schedule/club/")]
cup_ids = [ph["id"] for blk in FX["phase/season/2026"] for ph in blk["phases"] if "cup" in (ph["name"] or "").lower()]
ok("a Supercup phase is never read", cup_ids and not (set(cup_ids) & set(phases_read)), (cup_ids, phases_read))
ok("a play-off entry's club carries no ' playoff' tag",
   not any("playoff" in (g.home_name + g.away_name).lower() for g in be + nl), [g.home_name for g in be[:3]])
for bad in ({"stage": "cup"},):
    try:
        list(fresh().discover("", bad))
        raised = False
    except ValueError:
        raised = True
    ok("a stage that is neither regular nor playoffs is an error", raised)

print("\n-- a game the league has purged")
a = fresh()
ok("10569 (2025-26, film purged) is nothing to fetch", a.fetch("10569", {}) is None)
ok("...and its box is never asked for", not any(p.startswith("/boxscore/") for p, _ in Offline.asked), Offline.asked)

print("\n-- the translator (a synthetic game to the validated codes)")
raw = B.raw_from_bnxt(box_from(FILM), FILM, True, {"gameId": "99999"})
pbp = raw["pbp"]
ok("actionNumber 1..n", [x["actionNumber"] for x in pbp] == list(range(1, len(pbp) + 1)))
ok("four periods, each opened and closed once, the final whistle last",
   sum(1 for x in pbp if x["actionType"] == "period" and x["subType"] == "start") == 4
   and sum(1 for x in pbp if x["actionType"] == "period" and x["subType"] == "end") == 4 and pbp[-1]["actionType"] == "game")
first = next(x for x in pbp if x["actionType"] == "2pt")
ok("the clock counts down: 0:20 into the first quarter is 09:40", first["gt"] == "09:40", first["gt"])
ok("scores run with the play: 2-0, then 4-0 after the lay-up",
   first["s1"] == "2" and next(x for x in pbp if x["subType"] == "layup")["s1"] == "4")
fts = [x for x in pbp if x["actionType"] == "freethrow"]
ok("two free throws: 1of2 made, 2of2 missed", [(x["subType"], x["success"]) for x in fts] == [("1of2", 1), ("2of2", 0)], fts)
fo = next(x for x in pbp if x["actionType"] == "foulon")
ok("the drawn foul points at the other side's foul at the same clock",
   pbp[fo["previousAction"] - 1]["actionType"] == "foul" and pbp[fo["previousAction"] - 1]["tno"] == 2 and fo["tno"] == 1)
team_reb = [x for x in pbp if x["actionType"] == "rebound" and x["qualifier"] == ["team"]]
ok("a rebound with no player is the team's", len(team_reb) == 1 and team_reb[0]["tno"] == 2 and team_reb[0]["subType"] == "defensive")
subs = [(x["pno"], x["subType"]) for x in pbp if x["actionType"] == "substitution"]
ok("the substitution: #5 off, then #6 on", subs == [("105", "out"), ("106", "in")], subs)
ok("an unknown code is reported, not guessed", raw["bnxt"]["unknown"] == ["1234/None"], raw["bnxt"]["unknown"])
ok("a play-off entry's club has no ' playoff' tag in the box either", raw["tm"]["1"]["name"] == "Home club")

a = fresh()
b = a.fetch("99999", {})
ok("the fetch: box and film, final, 7-5", b is not None and b.status == "final"
   and (b.team["home"]["points"], b.team["away"]["points"]) == (7, 5), b and (b.status, b.team["home"]["points"]))
dur = sum(r["duration"] for r in b.stints)
ok(f"{len(b.stints)} stints, five a side, covering the game and summing to the score",
   abs(dur - 2400) < 0.01 and (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (7, 5)
   and all(len(r["home_lineup"].split(",")) == 5 for r in b.stints), (dur, len(b.stints)))
tr = translate(b.raw)
rep = tr["report"]
ok("the event log drops nothing, matches every player, and raises no warning",
   not rep["dropped"] and rep["unmatched"] == 0 and not rep["warnings"], (rep["dropped"], rep["unmatched"], rep["warnings"][:2]))

print("\n-- the token")
calls = []


class R:
    def __init__(self, text):
        self.text, self.status_code = text, 200


def fake_get(url, headers=None, timeout=None, params=None):
    calls.append(url)
    if url.endswith("/js/app.10c9f4a5.js"):
        return R('e.headers["Content-Type"]="application/json",e.headers["X-Authorization"]="NEWTOKEN123",e.headers["X-Localization"]')
    return R('<script defer="defer" src="/js/app.10c9f4a5.js"></script>')


real_get, B.requests.get = B.requests.get, fake_get
try:
    old = B.BnxtAdapter._token
    changed = B.BnxtAdapter()._refresh_token()
    ok("a refused token is re-read from the site's own app script", changed and B.BnxtAdapter._token == "NEWTOKEN123", calls)
finally:
    B.requests.get = real_get
    B.BnxtAdapter._token = old

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
