"""The CEBL (Canada), offline:

    python scripts/ingest/cebl_test.py

adapters/fiba_site_schedule.py, site "cebl". The league's own schedule is the JSON API behind cebl.ca/games
(api.data.cebl.ca/games/<year>/ - the scraper pipeline's cebl_scraper.py reads the same), and every game on it
names its FIBA LiveStats match (stats_url_en -> /u/CEBL/<id>/). What this holds the adapter to:
  * two sources, the regular season and the finals, in Canada (CA), men, a calendar-year season;
  * the fixtures keyed on the LiveStats id, the year asked for being the season's, UTC tip-offs, the venue,
    the clubs' crests, and the clubs coded by the league's own team id; a cancelled game (the API's
    "CANELLED", an if-necessary finals game never played) is left out;
  * a game fetched through the ordinary data.json path with the league's names and codes on both sides, so a
    club is one club whatever the operator typed; every basket counted (the Elam ending stops the clock,
    never the scoring).

Fixtures in scripts/ingest/data/cebl/ (captured 2026-09-30): the 2026 schedule (129 games, fields trimmed) and
LiveStats' data.json for 2798717 (Edmonton Stingers 75-77 Winnipeg Sea Bears, 9 May 2026).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402

DATA = os.path.join(HERE, "data", "cebl")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


with open(os.path.join(DATA, "games-2026.json"), encoding="utf-8") as f:
    GAMES = json.load(f)
with open(os.path.join(DATA, "fiba-2798717.json"), encoding="utf-8") as f:
    RAW = f.read()


class Offline(F.FibaSiteScheduleAdapter):
    def __init__(self):
        super().__init__()
        self.asked = []

    def _cebl_games(self, config):
        self.asked.append("games/%s" % F._start_year(config.get("season") or ""))
        return GAMES

    def _get_meta(self, url):
        self.asked.append(url)
        if "/2798717/" in url:
            return json.loads(RAW), {"lm_ms": 1, "etag": None, "recv_ms": 2}
        return None, {"lm_ms": None, "etag": None, "recv_ms": 0}


print("-- the sources")
with open(os.path.join(os.path.dirname(os.path.dirname(HERE)), "config", "ingest-sources.json"), encoding="utf-8") as f:
    rows = [s for s in json.load(f)["sources"] if s["code"] == "CEBL"]
reg = next((s for s in rows if s["adapter_config"].get("stage") == "regular"), {})
fin = next((s for s in rows if s["adapter_config"].get("stage") == "playoffs"), {})
ok("CEBL: a regular and a finals source, site cebl, in Canada, men", len(rows) == 2 and reg.get("league_country") == "CA"
   and reg.get("league_gender") == "men" and all(s["adapter"] == "fiba_site_schedule" and s["adapter_config"]["site"] == "cebl" for s in rows))
ok("...a calendar-year season (a summer league)", all(s["adapter_config"].get("season_calendar") for s in rows))
ok("...the finals a competition of their own, kind playoff", fin.get("competition_kind") == "playoff" and "Finals" in fin.get("competition_label", ""))

print("\n-- the schedule")
CFG = {"code": "CEBL", "site": "cebl", "season": "2026", "stage": "regular"}
a = Offline()
games = a.discover("https://www.cebl.ca/games", CFG)
ok("the year asked for is the season's", a.asked == ["games/2026"], a.asked)
ok("the regular season: 120 games, all played", len(games) == 120 and all(g.status == "final" for g in games), len(games))
ok("keyed on the LiveStats id, all different", len({g.external_id for g in games}) == 120 and all(g.external_id.isdigit() for g in games))
g = next(x for x in games if x.external_id == "2798717")
ok("Edmonton Stingers v Winnipeg Sea Bears: 9 May 2026 19:30 UTC at the Edmonton EXPO Centre",
   (g.home_name, g.away_name, g.tipoff_at, g.extra["venue"]) == ("Edmonton Stingers", "Winnipeg Sea Bears", "2026-05-09T19:30:00Z", "Edmonton EXPO Centre"),
   (g.home_name, g.away_name, g.tipoff_at, g.extra.get("venue")))
ok("clubs coded by the league's team id, crests from the league", g.extra["home_code"] == "CEBL18" and g.extra["away_code"] == "CEBL24"
   and g.extra["home_logo"].startswith("https://") and g.extra["away_logo"].startswith("https://"))
ok("ten clubs", len({x.home_name for x in games} | {x.away_name for x in games}) == 10)
finals = Offline().discover("https://www.cebl.ca/games#finals", dict(CFG, stage="playoffs"))
ok("the finals: 7 games, the two cancelled if-necessary games left out", len(finals) == 7
   and not ({"2879494", "2879496"} & {x.external_id for x in finals}), [x.external_id for x in finals])
ok("no game is in both", not ({x.external_id for x in games} & {x.external_id for x in finals}))
live = [dict(x, status="IN_PROGRESS") if x["id"] == GAMES[0]["id"] else x for x in GAMES]
b = Offline(); b._cebl_games = lambda config: live
ok("a game the league calls in progress is live", [x.status for x in b.discover("", CFG)].count("live") == 1)

print("\n-- a game")
c = Offline()
bundle = c.fetch("2798717", CFG)
ok("fetched through LiveStats 2798717, final", bundle is not None and bundle.status == "final" and any("/2798717/" in u for u in c.asked))
t1, t2 = bundle.raw["tm"]["1"], bundle.raw["tm"]["2"]
ok("the league's codes and names on both sides ('EDM' -> CEBL18)", (t1["code"], t1["name"], t2["code"], t2["name"]) ==
   ("CEBL18", "Edmonton Stingers", "CEBL24", "Winnipeg Sea Bears"), (t1.get("code"), t1.get("name"), t2.get("code"), t2.get("name")))
ok("the score is the league's: 75-77", (bundle.team["home"]["points"], bundle.team["away"]["points"]) == (75, 77))
ok("every player's points add up to his club's",
   all(sum(p["sPoints"] for p in bundle.raw["tm"][s]["pl"].values()) == bundle.raw["tm"][s]["score"] for s in "12"))
ok("shots charted", sum(len(bundle.raw["tm"][s]["shot"]) for s in "12") > 100)
ok("stints five a side, their points adding up to the score (the Elam ending stops the clock, not the scoring)",
   bundle.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in bundle.stints)
   and (sum(r["home_points"] for r in bundle.stints), sum(r["away_points"] for r in bundle.stints)) == (75, 77))
ok("a game not scored yet is None", Offline().fetch("2999999", CFG) is None)
fresh = Offline(); fresh.fetch("2798717", dict(CFG, _fresh=True))
ok("a second look goes past the CDN copy (the stall rule's read)", any("/2798717/data.json?_=" in u for u in fresh.asked), fresh.asked)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
