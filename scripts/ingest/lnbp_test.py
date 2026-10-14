"""The LNBP (adapters/lnbp.py), offline, over captured replies from lnbp.mx's Sportradar embed:

    python scripts/ingest/lnbp_test.py

What it holds the adapter to:
  * the schedule: the league's season found by its competition id and the calendar year, read
    whole (2026: 196 games, 14 clubs x 28), each game keyed "<season>_<fixture>", tip-offs in UTC,
    the regular season and the play-offs told apart by fixtureType (2025: 197 + 39 + 5), and a
    year with no season published giving no games instead of somebody else's;
  * the clubs' names: the game feed calls a club "LEO", so the names come from the fixtures pages,
    including for a game fetched with no discovery pass first;
  * three games: every player's box exactly the league's own, the score from the club's totals,
    the play-by-play translated whole (every box line equal to its log), stints covering the game
    and summing to the score, overtime renumbered to period 5, and a basket the league logged with
    no player kept in the score, the stints and the log (its box's players are 2 points short).

Fixtures live in scripts/ingest/data/lnbp/ (captured 2026-09-23, trimmed to the fields read). The
sweep behind them was 20 games over 2025 and 2026, all passing these checks.
"""
import base64
import collections
import gzip
import json
import os
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import REGISTRY  # noqa: E402
from adapters import lnbp as P  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "lnbp")
S26, S25 = "cc7d79f3-43ee-11f1-b893-293ce3dbc120", "b1b57094-3f54-11f0-9a4e-9fb16b8df604"
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
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        return json.load(f)


class Offline(P.LnbpAdapter):
    """Answers every EUI request from the captured files, keyed on the decoded state blob."""

    def __init__(self):
        super().__init__()
        self.asked = []

    def _req(self, method, url, **kw):
        s = kw["params"]["state"]
        st = json.loads(zlib.decompress(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))))
        page = url.rsplit("/", 1)[-1]
        self.asked.append((page, st))
        if page == "fixtures":
            if "s" not in st:
                return load("listing.json.gz")
            year = {S26: "2026", S25: "2025"}.get(st["s"])
            return load(f"{st['z'].lower()}-{year}.json.gz") if year else {"data": {}}
        name = f"game-{st['f'][:8]}.json.gz"
        return load(name)[st["z"]] if os.path.exists(os.path.join(DATA, name)) else None


FibaLiveStatsAdapter._pipeline = False          # the in-repo stint builder, as on the Actions runner
FibaLiveStatsAdapter._pipeline_warned = True

print("-- registration")
ok("lnbp is registered and reads the embed as website 14, in Spanish",
   REGISTRY.get("lnbp") is P.LnbpAdapter and P.LnbpAdapter.eui_site == 14 and P.LnbpAdapter.locale == "es-ES")

print("\n-- the 2026 schedule")
a = Offline()
reg = list(a.discover("https://www.lnbp.mx/stats.html", {"season": "2026", "stage": "regular"}))
ok("196 regular-season games: 154 played, 42 to come",
   (len(reg), sum(g.status == "final" for g in reg), sum(g.status == "scheduled" for g in reg)) == (196, 154, 42),
   (len(reg), collections.Counter(g.status for g in reg)))
clubs = collections.Counter()
for g in reg:
    clubs[g.home_name] += 1
    clubs[g.away_name] += 1
ok("14 clubs, 28 games each", len(clubs) == 14 and set(clubs.values()) == {28}, clubs)
ok("every game keyed <season>_<fixture>, both clubs coded, tip-off in UTC",
   all(g.external_id.startswith(S26 + "_") and g.extra["home_code"] and g.extra["away_code"]
       and g.tipoff_at.endswith("Z") for g in reg))
leo = next(g for g in reg if g.external_id.endswith("d227b6cc-606a-11f1-a41c-e31854a0309d"))
ok("the game Louie saved: ABEJAS DE LEON v FRESEROS IRAPUATO, 20:00 in León = 02:00 UTC",
   (leo.home_name, leo.away_name, leo.tipoff_at, leo.extra["home_code"]) ==
   ("ABEJAS DE LEON", "FRESEROS IRAPUATO", "2026-09-22T02:00:00Z", "LEO"),
   (leo.home_name, leo.away_name, leo.tipoff_at))
ok("read with three requests: the season list, then the season's results and fixtures",
   [(p, st.get("z")) for p, st in a.asked] == [("fixtures", None), ("fixtures", "RESULTS"), ("fixtures", "FIXTURES")],
   a.asked)
ok("no play-offs published yet: the play-off row finds none",
   list(Offline().discover("", {"season": "2026", "stage": "playoffs"})) == [])

print("\n-- the regular season and the play-offs are one season, split by fixtureType")
r25 = list(Offline().discover("", {"season": "2025", "stage": "regular"}))
p25 = list(Offline().discover("", {"season": "2025", "stage": "playoffs"}))
ok("2025: 197 regular-season games and 44 play-off games (39 PLAYOFF + 5 FINAL)",
   (len(r25), len(p25)) == (197, 44), (len(r25), len(p25)))
ok("...no game in both, every play-off game marked so",
   not ({g.external_id for g in r25} & {g.external_id for g in p25}) and all(g.extra["stage"] == "playoffs" for g in p25))
none = Offline()
ok("a year with no season published gives nothing, after one request",
   list(none.discover("", {"season": "2027", "stage": "regular"})) == [] and len(none.asked) == 1, none.asked)
try:
    Offline().discover("", {"season": "2026", "stage": "finals"})
    ok("an unknown stage is refused", False)
except ValueError:
    ok("an unknown stage is refused", True)


def check_game(fid, home, away, score, periods, what):
    print(f"\n-- {what}")
    g = Offline()
    b = g.fetch(f"{S26}_{fid}", {})
    raw = b.raw
    ok("final, named in full, the league's score",
       (b.status, b.home_name, b.away_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == ("final", home, away) + score,
       (b.status, b.home_name, b.away_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]))
    ok("the names were read from the season's fixtures pages, once",
       [st.get("z") for p, st in g.asked if p == "fixtures"] == ["RESULTS", "FIXTURES"])
    st = load(f"game-{fid[:8]}.json.gz")["statistics"]["data"]
    rows = {r["personId"]: r for side in ("home", "away") for r in st["statistics"]["data"]["base"][side]["persons"][0]["rows"]}
    box_ok = all(raw["tm"][t]["pl"][pno]["sPoints"] == rows[pno]["statistics"].get("points", 0) or
                 (raw["tm"][t]["pl"][pno]["sPoints"] == 0 and rows[pno]["statistics"].get("points") is None)
                 for t in ("1", "2") for pno in raw["tm"][t]["pl"])
    ok("every player's points are the league's own", box_ok)
    ok("the play-by-play covers %d periods, overtime numbered 5 on" % periods,
       max(e["period"] for e in raw["pbp"]) == periods and {e["period"] for e in raw["pbp"]} == set(range(1, periods + 1)))
    dur = sum(r["duration"] for r in b.stints)
    ok("stints cover the whole game (%d s)" % (2400 + 300 * (periods - 4)), abs(dur - (2400 + 300 * (periods - 4))) < 1, dur)
    ok("stint points sum to the score",
       (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == score)
    ok("five a side in every stint",
       all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
    tr = translate(raw)
    tally = collections.defaultdict(collections.Counter)
    for e in tr["events"]:
        if e["pid"]:
            s, t = tally[e["pid"]], e["t"]
            if t in ("p2_made", "p3_made", "ft_made"):
                s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
            if t in ("ast", "stl", "blk", "to", "foul"):
                s[t] += 1
            if t == "reb":
                s["oreb" if e["payload"]["off"] else "dreb"] += 1
    diffs = [(p["name"], k) for i, t in enumerate("12") for pno, p in raw["tm"][t]["pl"].items()
             for k, v in (("pts", p["sPoints"]), ("ast", p["sAssists"]), ("stl", p["sSteals"]), ("blk", p["sBlocks"]),
                          ("to", p["sTurnovers"]), ("foul", p["sFoulsPersonal"]), ("oreb", p["sReboundsOffensive"]),
                          ("dreb", p["sReboundsDefensive"]))
             if tally.get(f"{i}:{pno}", {}).get(k, 0) != v]
    ok("the event log drops nothing and every player's line equals his box",
       not tr["report"]["dropped"] and not tr["report"]["unmatched"] and not diffs, (tr["report"]["dropped"], diffs[:5]))
    return b


check_game("d227b6cc-606a-11f1-a41c-e31854a0309d", "ABEJAS DE LEON", "FRESEROS IRAPUATO", (83, 89), 4,
           "Abejas de León 83-89 Freseros Irapuato (the page Louie saved)")
check_game("505ce350-5304-11f1-9b38-e34ebd3f0048", "FUERZA REGIA", "SOLES DE MEXICALI", (94, 91), 5,
           "Fuerza Regia 94-91 Soles de Mexicali, after one overtime (Sportradar keys it 11)")
b = check_game("ee2b1159-5615-11f1-8638-61d326e63b84", "LOBOS PUEBLA", "SOLES DE MEXICALI", (73, 80), 4,
               "Lobos Puebla 73-80 Soles de Mexicali: a basket logged with no player")
ok("...its players' points sum to 71 and the club's line to 73, as the league's own box has it",
   (sum(p["sPoints"] for p in b.raw["tm"]["1"]["pl"].values()), b.team["home"]["points"]) == (71, 73),
   (sum(p["sPoints"] for p in b.raw["tm"]["1"]["pl"].values()), b.team["home"]["points"]))

print("\n-- the feed's new shape (about 5 Oct 2026): the plays inside periodData, no pbp block")


def new_shape(reply):
    """A captured game's two replies as the embed sends them since early October 2026: `pbp` gone,
    `periodData` a list of periods for every game, each carrying its own events (the pbp feed) or
    only its score (the statistics feed)."""
    out = json.loads(json.dumps(reply))
    pbp = out["pbp"]["data"].pop("pbp")
    scores = out["statistics"]["data"].pop("periodData")["teamScores"]
    periods = []
    for key in sorted(pbp, key=int):
        pid, blk = int(key), pbp[key]
        periods.append({"periodId": pid, "started": True, "ended": bool(blk.get("ended")),
                        "isOvertime": bool(blk.get("isOvertime")), "isShootout": False, "durationMinutes": 10 if pid <= 4 else 5,
                        "teamScore": {eid: next((r["score"] for r in rows if r.get("periodId") == pid), 0) for eid, rows in scores.items()},
                        "events": blk.get("events") or []})
    out["pbp"]["data"]["periodData"] = periods
    out["statistics"]["data"]["periodData"] = [{k: v for k, v in per.items() if k != "events"} for per in periods]
    return out


class NewShape(Offline):
    def _req(self, method, url, **kw):
        s = kw["params"]["state"]
        st = json.loads(zlib.decompress(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))))
        if url.rsplit("/", 1)[-1] == "fixtures":
            return super()._req(method, url, **kw)
        name = f"game-{st['f'][:8]}.json.gz"
        return new_shape(load(name))[st["z"]] if os.path.exists(os.path.join(DATA, name)) else None


for fid, what in (("d227b6cc-606a-11f1-a41c-e31854a0309d", "Abejas de León v Freseros"),
                  ("505ce350-5304-11f1-9b38-e34ebd3f0048", "Fuerza Regia v Soles, after one overtime")):
    was, now = Offline().fetch(f"{S26}_{fid}", {}), NewShape().fetch(f"{S26}_{fid}", {})
    ok(what + ": the plays read off periodData, the same log as the old pbp block",
       len(now.raw["pbp"]) > 400 and now.raw["pbp"] == was.raw["pbp"], (len(now.raw["pbp"]), len(was.raw["pbp"])))
    ok("...the same stints, final, the same score and quarters",
       now.stints == was.stints and now.status == "final" and
       [(now.raw["tm"][t]["score"], now.raw["tm"][t].get("quarters")) for t in "12"] ==
       [(was.raw["tm"][t]["score"], was.raw["tm"][t].get("quarters")) for t in "12"],
       (len(now.stints), len(was.stints), now.status))
ok("a statistics-feed period list (no events) is never read as empty plays",
   P.LnbpAdapter._pbp_of_periods([{"periodId": 1, "started": True, "teamScore": {}}]) == {}
   and P.LnbpAdapter._pbp_of_periods(None) == {} and P.LnbpAdapter._pbp_of_periods({"teamScores": {}}) == {})

# ============================================================================ a season before the EUI
print("\n-- older seasons (a backfill): lnbp.mx's own site and FIBA LiveStats before 2025")
# lnbp.mx's back end as it answers (14 Oct 2026), cut to the fields read. The payload is a genuine LiveStats
# data.json from another league's test (data/cebl/fiba-2798717.json, Edmonton Stingers 75-77 Winnipeg Sea Bears)
# standing in for every game.
with open(os.path.join(HERE, "data", "cebl", "fiba-2798717.json"), encoding="utf-8") as _f:
    STANDIN = _f.read()


def site_game(gid, fiba, rnd, t1, t2, s1, s2, day="2021-10-02", at="20:00:00"):
    return {"id": gid, "fiba_id": fiba, "id_round": rnd, "id_team_1": t1, "id_team_2": t2, "score_1": s1, "score_2": s2,
            "name": "Abejas vs. Dorados", "event": {"date_start": day, "time_start": at, "venue": "Domo De La Feria"}}


SITE = {"/sports/seasons/all": {"items": [{"id": 32, "name": "2024 Varonil"}, {"id": 31, "name": "2024 Femenil"},
                                          {"id": 22, "name": "2021"}, {"id": 20, "name": "2019 - 2020"}]},
        ("/sports/rounds/season", 22): {"items": [{"id": 500, "name": "Jornada 1"}, {"id": 530, "name": "Semifinal de Zona - Juego 1"}]},
        ("/sports/rounds/season", 32): {"items": [{"id": 787, "name": "Jornada 26"}]},
        ("/sports/games/dates", "2021-01-01"): {"items": [
            site_game(2173, "1913643", 500, 1, 28, 75, 77),
            site_game(2174, "1913644", 500, 28, 1, 77, 75, day="2021-10-09"),         # the same two, the other way round
            site_game(2175, "1913645", 530, 1, 28, 75, 77, day="2021-11-02", at="19:30:00"),
            site_game(2176, "", 500, 1, 28, 80, 70),                                   # no LiveStats id: no box score
            site_game(2177, "1913646", 500, 1, 99, 60, 60),                            # a tie names nobody's side
            site_game(1999, "1791160", 400, 1, 28, 91, 78, day="2021-02-01")]},       # 2019-20's round, not 2021's
        ("/sports/games/dates", "2024-01-01"): {"items": [site_game(3198, "", 787, 47, 3, 82, 90, day="2024-09-27")]}}


class OldSite(Offline):
    def __init__(self):
        super().__init__()
        self.site, self.feed = [], []

    def _site(self, path, data):
        self.site.append(path)
        return SITE.get(path) or SITE.get((path, data.get("id_season") or data.get("date_start"))) or {}

    def _get(self, url):
        self.feed.append(url)
        return json.loads(STANDIN)

    def _get_meta(self, url):
        return self._get(url), {"lm_ms": None, "etag": None, "recv_ms": 0}


P.LnbpAdapter._site_names = {}
old = OldSite()
r21 = list(old.discover("", {"season": "2021", "stage": "regular", "_backfill": True}))
ok("2021 (before anything the EUI has of the league): read off lnbp.mx's own site, keyed by the LiveStats id",
   [g.external_id for g in r21] == ["1913643", "1913644"] and old.site[0] == "/sports/seasons/all", ([g.external_id for g in r21], old.site))
ok("...each club named as its games' data.json names it (never the site's 'Abejas'), the way round the score says",
   [(g.home_name, g.away_name) for g in r21] == [("Edmonton Stingers", "Winnipeg Sea Bears"), ("Winnipeg Sea Bears", "Edmonton Stingers")],
   [(g.home_name, g.away_name) for g in r21])
ok("...20:00 in central Mexico (summer time in 2021) is 01:00 UTC; final; no club code",
   r21[0].tipoff_at == "2021-10-03T01:00:00Z" and all(g.status == "final" and g.extra["home_code"] == "" for g in r21), r21[0])
ok("...no LiveStats id, a club no game names, another season's round: not games",
   not ({"", "1913646", "1791160"} & {g.external_id for g in r21}))
ok("...the names cost one data.json per club, not one per game (a tie teaches nothing, so 99 cost one more)",
   len(old.feed) == 2, old.feed)
p21 = list(OldSite().discover("", {"season": "2021", "stage": "playoffs", "_backfill": True}))
ok("the play-offs are the rounds the league calls finals and semi-finals",
   [(g.external_id, g.extra["round"], g.extra["stage"]) for g in p21] == [("1913645", "Semifinal de Zona - Juego 1", "playoffs")], p21)
b = OldSite().fetch("1913643", {"season": "2021", "_tipoff_at": r21[0].tipoff_at})
ok("the game: data.json, uncoded clubs (LiveStats' GTO is not the EUI's LEO), box and stints",
   b is not None and b.raw["tm"]["1"]["code"] == b.raw["tm"]["2"]["code"] == "" and len(b.box["home"]) >= 5 and b.stints
   and b.tipoff_at == "2021-10-03T01:00:00Z", b and (b.raw["tm"]["1"]["code"], len(b.box["home"])))
n24 = OldSite()
ok("2024: the site has the season and no LiveStats id on any game - nothing, and no game feed asked",
   list(n24.discover("", {"season": "2024", "stage": "regular", "_backfill": True})) == [] and not n24.feed, n24.site)
n27 = OldSite()
ok("2027 (after the EUI's first season, not published yet) is never looked for on the old site",
   list(n27.discover("", {"season": "2027", "stage": "regular"})) == [] and not n27.site)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
