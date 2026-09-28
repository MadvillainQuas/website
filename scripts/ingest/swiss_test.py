"""Swiss Basketball: the SB League and NLB, men and women (adapters/fiba_site_schedule.py, site "swiss"), offline:

    python scripts/ingest/swiss_test.py

swiss.basketball draws its schedules in the browser from Basketplan, the federation's match database,
which it proxies as XML; the games are scored on FIBA LiveStats (client SUI). What this holds the
adapter to:
  * the season id read off the schedule page's own window.seasons ('2026-2027': 31), never pinned;
  * the season's phases from findAllLeagueHoldings, each phase's games from showLeagueSchedule;
  * fixtures keyed on Basketplan's game id ("BP367239"), clubs coded by name, crests from Basketplan,
    Swiss time -> UTC, the phase deciding the stage (PLAYOFF -> playoffs, anything else regular);
  * the LiveStats id found from the widget first and the row's liveStatsLink second, and KEPT only
    when the feed names the fixture's own clubs: on 2026-09-27 Basketplan gave Lions v Nyon (men) the
    id of a women's game, 2909496, and the widget had the right one, 2909438;
  * the fetched game named by the schedule, so a club has one name and one code on both paths.

Fixtures in scripts/ingest/data/swiss/ (captured 2026-09-27): the SBL men's page's season map, the
2026-27 phases, the first two match days of the preliminary phase, the widget trimmed to three days,
and LiveStats' data.json for 2909438 (Lions de Geneve v BBC Nyon). The "other clubs" feed for
2909496 is made up here: the real one was still a 403 (not yet played) when the fixtures were taken.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402

DATA = os.path.join(HERE, "data", "swiss")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def text(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


OTHER_CLUBS = {"tm": {"1": {"name": "BBC Nyon Feminin", "shortName": "Nyon", "code": "NYO"},
                      "2": {"name": "Ravens Grand-Saconnex", "shortName": "Ravens", "code": "RAV"}}}


class Offline(F.FibaSiteScheduleAdapter):
    def __init__(self):
        super().__init__()
        self.asked, self.feeds = [], []
        F.FibaSiteScheduleAdapter._swiss_cache = {}

    def _page(self, url):
        self.asked.append(url)
        if "/national-competitions/" in url:
            return text("sbl-men-page.html")
        if "findAllLeagueHoldings" in url:
            return text("holdings-sbl-men-31.xml") if "seasonId=31" in url else "<basketplan/>"
        if "showLeagueSchedule" in url and "leagueHoldingId=11321" in url:
            return text("schedule-sbl-men-11321.xml")
        if "app-basketball/schedule" in url:
            return text("widget-2.json")
        raise AssertionError("unexpected request " + url)

    def _get_meta(self, url):
        self.feeds.append(url)
        meta = {"lm_ms": None, "recv_ms": None, "etag": None}
        if "/2909438/" in url:
            with open(os.path.join(DATA, "fiba-2909438.json"), encoding="utf-8") as f:
                return json.load(f), meta
        if "/2909496/" in url:
            return json.loads(json.dumps(OTHER_CLUBS)), meta
        return None, meta                 # not started: LiveStats answers 403


tmp = tempfile.mkdtemp()
CFG = {"site": "swiss", "code": "CHSBL", "basketplan_league": "1", "league_path": "sbl/men", "widget": "2",
       "season": "2026-27", "stage": "regular", "repo_root": tmp}

print("-- the season and its phases, from the site")
ok("season ids read off window.seasons", F.swiss_season_ids(text("sbl-men-page.html")).get(2026) == "31",
   F.swiss_season_ids(text("sbl-men-page.html")))
ok("2016-17 is on the list too", F.swiss_season_ids(text("sbl-men-page.html")).get(2016) == "21")
hold = F.swiss_holdings(text("holdings-sbl-men-31.xml"))
ok("one phase published so far: the preliminary round", [(h["id"], h["phase"]) for h in hold] == [("11321", "PRELIMINARY_ROUND")], hold)

print("\n-- the fixtures")
a = Offline()
games = a.discover("https://swiss.basketball/national-competitions/sbl/men/schedule", CFG)
by = {g.external_id: g for g in games}
ok("every game of two match days", len(games) == 10, len(games))
g = by.get("BP367239")
ok("keyed on Basketplan's game id", g is not None, sorted(by))
ok("home and away as the schedule names them", g and (g.home_name, g.away_name) == ("Starwings Basket", "A++ Massagno"),
   g and (g.home_name, g.away_name))
ok("17:30 in Birsfelden is 15:30 UTC in September", g and g.tipoff_at == "2026-09-26T15:30:00Z", g and g.tipoff_at)
ok("a played game is final", g and g.status == "final")
ok("clubs coded by name", g and (g.extra["home_code"], g.extra["away_code"]) == ("starwings-basket", "a-massagno"), g and g.extra)
ok("crests from Basketplan", g and str(g.extra["home_logo"]).startswith("https://www.basketplan.ch/uploadedImages/"), g and g.extra)
ok("the hall and its town", g and g.extra["venue"] == "Sporthalle, Birsfelden", g and g.extra["venue"])
ok("the match day as the round", g and g.extra["round"] == "Day 1" and g.extra["stage"] == "regular", g and g.extra)
later = [x for x in games if x.status == "scheduled"]
ok("games to come are scheduled", len(later) == 7, len(later))
po = a.discover("", dict(CFG, stage="playoffs"))
ok("no play-off phase yet: a play-off source finds nothing", po == [], po)
none = Offline().discover("", dict(CFG, season="2031-32"))
ok("a season the site does not list yet: nothing, and no guessing", none == [], none)

print("\n-- a game: the LiveStats id is checked against the fixture before it is kept")
a = Offline()
b = a.fetch("BP367241", CFG)
ok("Lions de Geneve v BBC Nyon fetched", b is not None)
ok("the widget's id tried first", a.feeds and "/2909438/" in a.feeds[0], a.feeds)
ok("...and Basketplan's wrong one (a women's game) never asked for", not any("/2909496/" in u for u in a.feeds), a.feeds)
with open(os.path.join(tmp, "data", "feed", "CHSBL", "idmap.json"), encoding="utf-8") as f:
    kept = json.load(f)
ok("the checked id kept for good", kept.get("367241") == "2909438", kept)
names = [t.get("name") for t in b.raw["tm"].values()] if b else []
ok("clubs named as the schedule names them", names == ["Lions de Genève pwd by Grand-Saconnex", "BBC Nyon"], names)
ok("the game is final, keyed on the fixture", b and b.status == "final" and b.external_id == "BP367241",
   b and (b.status, b.external_id))

a = Offline()
a._swiss_widget_ids = lambda config: {}           # the widget's window has moved on
ok("without the widget, a feed naming other clubs is not taken", a.fetch("BP367241", dict(CFG, repo_root=tempfile.mkdtemp())) is None)
ok("...it was asked, and refused", any("/2909496/" in u for u in a.feeds), a.feeds)

a = Offline()
ok("a game that has not started: nothing yet", a.fetch("BP367244", CFG) is None)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
