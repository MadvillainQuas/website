"""The two Danish leagues, offline:

    python scripts/ingest/dbl_test.py

BASKETLIGAEN (men, adapters/fiba_site_schedule.py, site "basketligaen"). basketligaen.dk is a Sportality
single-page app in front of a JSON API. Genius's hosted schedule for the league's client (DBBF) is empty and
the site links a game to LiveStats only once the operator opens it, but the API names the LiveStats id of every
game from the day the schedule exists (gameInfo.extId of /sports-v2/game-info/<uuid>) - all 132 of 2026-27, all
different; the post-game page's own "Tag mig derhen" link (webcast/DBBF/2868197) is that same id for the same game.
What this holds the adapter to:
  * the season, the series and the regular game type read off the site's own filter, never a constant;
  * the fixtures: keyed on the LiveStats id, UTC start, clubs by the site's short name and code, crests from the
    site, played / to come from the state; a game with no id yet left out;
  * each id asked for ONCE and kept, so a later pass is one schedule request;
  * a game not yet scored (data.json 403) fetches as None, and a scored one goes through the ordinary data.json
    path - box, play-by-play, shots and stints - with the feed's operator-typed codes ("Hol") replaced by the
    site's ("HOL"), so one club is never filed under two codes.

KVINDE BASKETLIGAEN (women, adapters/fiba_livestats.py on Genius tenant DAM): the same hosted path as SLB and
WBBL. Held here to: its source row, and the hosted page's match blocks -> ids, Copenhagen time -> UTC, crests.

Fixtures in scripts/ingest/data/dbl/ (captured 2026-09-27): the site's season filter, the whole regular-season
schedule (132 games, teamList trimmed), every game's extId, LiveStats' data.json for 2868126 (Holbaek-Stenhus
84-100 Randers Cimbria), and a trimmed DAM hosted page (six games).
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "dbl")
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
        return f.read()


FILTER = json.loads(load("filter.json"))
SCHEDULE = json.loads(load("schedule-regular.json"))
EXT = json.loads(load("gameinfo.json"))


class Offline(F.FibaSiteScheduleAdapter):
    def __init__(self, ext=None, schedule=None):
        super().__init__()
        self.asked = []
        self.ext = EXT if ext is None else ext
        self.schedule = SCHEDULE if schedule is None else schedule

    def _dbl_json(self, url):
        self.asked.append(url)
        if url.endswith("/season-series-game-types-filter"):
            return FILTER
        if "/game-schedule?" in url:
            return self.schedule if "gameTypeUuid=aprlbjgxlp" in url else {"gameInfo": [], "teamList": []}
        if "/game-info/" in url:
            uuid = url.rsplit("/", 1)[1]
            return {"gameInfo": {"gameUuid": uuid, "extId": self.ext.get(uuid)}} if uuid in self.ext else None
        raise RuntimeError(f"no fixture for {url}")

    def _get_meta(self, url):
        self.asked.append(url)
        if "/2868126/" in url:
            return json.loads(load("fiba-2868126.json")), {"lm_ms": None, "etag": None, "recv_ms": 0}
        return None, {"lm_ms": None, "etag": None, "recv_ms": 0}


def fresh(**kw):
    F.FibaSiteScheduleAdapter._dbl_cache = {}
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline(**kw)


ROOT = tempfile.mkdtemp()
CFG = {"code": "DBL", "site": "basketligaen", "repo_root": ROOT, "season": "2026-27"}

print("-- the source rows")
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
men = [s for s in src if (s.get("adapter_config") or {}).get("site") == "basketligaen"]
ok("Basketligaen: a regular and a play-off source, in Denmark (DK), men",
   sorted(s["adapter_config"]["stage"] for s in men) == ["playoffs", "regular"]
   and all(s["league_country"] == "DK" and s["league_slug"] == "basketligaen" and s["league_gender"] == "men"
           and s["adapter"] == "fiba_site_schedule" for s in men), men)
po = next(s for s in men if s["adapter_config"]["stage"] == "playoffs")
ok("...the play-offs are a competition of their own, kind playoff", po.get("competition_kind") == "playoff" and "Playoffs" in po.get("competition_label", ""))
women = [s for s in src if s["code"] == "KBL"]
ok("Kvinde Basketligaen: one Genius-hosted source on tenant DAM, Copenhagen time, Denmark, women",
   len(women) == 1 and women[0]["adapter"] == "fiba_livestats" and women[0]["adapter_config"]["client_code"] == "DAM"
   and women[0]["adapter_config"]["timezone"] == "Europe/Copenhagen" and women[0]["league_country"] == "DK"
   and women[0]["league_gender"] == "women" and women[0]["league_slug"] == "kvinde-basketligaen"
   and women[0]["scheduleUrls"] == ["https://hosted.wh.geniussports.com/DAM/en/schedule"], women)

print("\n-- the season, from the site's own filter")
a = fresh()
ok("2026 is the season the filter calls fg7gxxmm0w (2026/2027), the league's series is DBL, Grundspil is the regular type",
   any(s["uuid"] == "fg7gxxmm0w" and s["code"] == "2026" for s in FILTER["season"])
   and any(x["uuid"] == "m1ay3mpa4t" and x["code"] == "DBL" for x in FILTER["series"])
   and any(t["uuid"] == "aprlbjgxlp" and t["code"] == "regular" for t in FILTER["gameType"]))
ok("a season the site does not list is no season, not a guess", fresh()._dbl(dict(CFG, season="2035-36")) == [])
ok("no play-off game type yet, so the play-off source finds nothing (and asks for no game)", fresh()._dbl(dict(CFG, stage="playoffs")) == [])

print("\n-- the fixtures")
a = fresh()
games = a._dbl(CFG)
ok("all 132 games of 2026-27", len(games) == 132, len(games))
ok("13 played, 119 to come", sum(g.status == "final" for g in games) == 13 and sum(g.status == "scheduled" for g in games) == 119)
ok("keyed on the LiveStats id, all different", len({g.external_id for g in games}) == 132 and all(g.external_id.isdigit() for g in games))
g0 = next(g for g in games if g.external_id == "2868126")
ok("Holbæk-Stenhus v Randers Cimbria: final, 17 Sep 2026 17:00 UTC (19:00 in Denmark), at Holbæk Sportsby",
   (g0.home_name, g0.away_name, g0.status, g0.tipoff_at, g0.extra["venue"]) ==
   ("Holbæk-Stenhus", "Randers Cimbria", "final", "2026-09-17T17:00:00Z", "Holbæk Sportsby"), g0)
ok("clubs by the site's own code, crests from its CDN over https",
   (g0.extra["home_code"], g0.extra["away_code"]) == ("HOL", "RAN")
   and g0.extra["home_logo"] == "https://sportality.cdn.s8y.se/team-logos/hol2_hol.svg" and g0.extra["stage"] == "regular", g0.extra)
ok("the game the user's pre-game page showed (Bakken Bears v Gladsaxe, 30 Sep) has its id already: 2868202",
   any(g.external_id == "2868202" and g.home_name == "Bakken Bears" and g.away_name == "Gladsaxe" and g.status == "scheduled" for g in games))
ok("...and the post-game page's webcast link (DBBF/2868197) is Svendborg Rabbits v Holbæk-Stenhus, the same id the API gave",
   any(g.external_id == "2868197" and g.home_name == "Svendborg Rabbits" and g.away_name == "Holbæk-Stenhus" and g.status == "final" for g in games))
ok("twelve clubs", len({g.home_name for g in games} | {g.away_name for g in games}) == 12)
live = json.loads(json.dumps(SCHEDULE))
live["gameInfo"][20]["state"] = "live"
ok("a game the site calls live is live", [g.status for g in fresh(schedule=live)._dbl(CFG)].count("live") == 1)

print("\n-- each id is asked for once")
known = a._idmap(CFG)
ok("all 132 remembered against their game uuids", len(known) == 132 and known["c4hh5nig6t"] == "2868126", len(known))
asked_info = [u for u in a.asked if "/game-info/" in u]
ok("132 game-info requests the first time", len(asked_info) == 132, len(asked_info))
b2 = fresh()
b2._dbl(CFG)
ok("a second pass asks the schedule once and no game at all", [u for u in b2.asked if "/game-info/" in u] == []
   and sum(1 for u in b2.asked if "/game-schedule?" in u) == 1, b2.asked)
gone = {k: v for k, v in EXT.items() if k != "c4hh5nig6t"}
ROOT2 = tempfile.mkdtemp()
c = fresh(ext=gone)
left_out = c._dbl(dict(CFG, repo_root=ROOT2))
ok("a game with no LiveStats id yet is left out until it has one (131 of 132)", len(left_out) == 131 and all(g.external_id != "2868126" for g in left_out), len(left_out))

print("\n-- one game, end to end")
a = fresh()
b = a.fetch("2868126", dict(CFG, _tipoff_at=g0.tipoff_at))
ok("fetched through LiveStats 2868126", b is not None and any("/2868126/" in u for u in a.asked), a.asked[:4])
ok("kept under the id it was found by, final", b.external_id == "2868126" and b.status == "final", (b.external_id, b.status))
ok("the site's names and codes, not the operator's ('Hol' -> 'HOL')",
   (b.raw["tm"]["1"]["code"], b.raw["tm"]["1"]["name"], b.raw["tm"]["2"]["code"], b.raw["tm"]["2"]["name"]) ==
   ("HOL", "Holbæk-Stenhus", "RAN", "Randers Cimbria"), (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]))
ok("the score is the league's: 84-100", (b.team["home"]["points"], b.team["away"]["points"]) == (84, 100))
ok("every player's points add up to his club's",
   all(sum(p["sPoints"] for p in b.raw["tm"][s]["pl"].values()) == b.raw["tm"][s]["score"] for s in "12"))
ok("shots charted", sum(len(b.raw["tm"][s]["shot"]) for s in "12") > 100)
dur = sum(r["duration"] for r in b.stints)
ok(f"{len(b.stints)} stints, five a side, covering the game", b.stints and abs(dur - 2400) < 0.01
   and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints), dur)
ok("stint points add up to the score", (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (84, 100))
tr = translate(b.raw)
ok("the play-by-play translates into a scored log", len(tr["events"]) > 400 and (tr["home_score"], tr["away_score"]) == (84, 100),
   (len(tr["events"]), tr.get("home_score"), tr.get("away_score")))
ok("a game not yet scored (403 before the operator opens it) fetches as None, to be asked again", fresh().fetch("2868202", CFG) is None)

print("\n-- Kvinde Basketligaen: the hosted page")
html = load("dam-schedule.html")
wg = FibaLiveStatsAdapter().parse_schedule(html, "Europe/Copenhagen", None)
ok("six games, the match ids are LiveStats ids", [g.external_id for g in wg] == ["2896857", "2868648", "2868646", "2868650", "2868653", "2868656"], [g.external_id for g in wg])
ok("Falcon v Skovbakken Sirens: 20 Sep 2026 13:00 in Copenhagen is 11:00 UTC, final",
   (wg[0].home_name, wg[0].away_name, wg[0].tipoff_at, wg[0].status) == ("Falcon", "Skovbakken Sirens", "2026-09-20T11:00:00+00:00", "final"), wg[0])
ok("Danish letters survive (Hørsholm 79ers, Åbyhøj IF)", (wg[1].home_name, wg[1].away_name) == ("Hørsholm 79ers", "Åbyhøj IF"), (wg[1].home_name, wg[1].away_name))
ok("three played, three to come", [g.status for g in wg].count("final") == 3 and [g.status for g in wg].count("scheduled") == 3)
ok("crests come off the page", all(g.extra.get("home_logo") for g in wg), wg[0].extra)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
