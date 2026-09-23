"""Lithuania's NKL (adapters/fiba_site_schedule.py, site "nkl"), offline:

    python scripts/ingest/nkl_test.py

From 2026/27 the NKL runs on FIBA LiveStats (www.fibalivestats.com/u/BNW/<id>) with its schedule
on nkl.lt. What this holds the adapter to:
  * the schedule: the season read from nkl.lt's own inline array (306 games, 18 clubs x 34), keyed
    on nkl.lt's match id, coded by nkl.lt's club ids, crested over https, tip-offs Vilnius -> UTC,
    "regular" and "playoffs" kept apart by the league's stage type;
  * the LiveStats id: read off the homepage's match strip and remembered; for a fixture the strip
    does not show, the offset every known pair shares is TRIED and kept only when the feed names
    the fixture's two clubs - and refused when it names anybody else;
  * the fetch: the FIBA payload with nkl.lt's club ids and names put on it, keyed on the nkl.lt id.

Fixtures in scripts/ingest/data/nkl/ (captured 2026-09-23, before the season's first tip). The NKL's
own feeds answer 403 until a game is opened, so feed-standin.json is a GENUINE FIBA LiveStats
data.json from another league (EABL 2759719) with its two club names set to the fixture's - it
exercises the mapping and the code swap, not NKL statistics.
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
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_livestats import FIBA_DATA_URL, FibaLiveStatsAdapter  # noqa: E402

DATA = os.path.join(HERE, "data", "nkl")
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


STANDIN = json.loads(text("feed-standin.json"))


def feed_as(home, away):
    d = copy.deepcopy(STANDIN)
    d["tm"]["1"]["name"], d["tm"]["2"]["name"] = home, away
    for s in "12":
        d["tm"][s].pop("nameInternational", None)
        d["tm"][s]["shortName"] = ""
    return d


FEEDS = {
    "2895455": feed_as("Alytaus Patriotai", "Kauno Žalgiris-2"),           # on the homepage strip
    "2895480": feed_as("Mažeikių M Basket", "Jurbarko Jurbarkas-Karys-Manvesta"),  # 125770 + the offset
    "2895481": feed_as("Somebody Else", "Another Club"),                  # 125771 + the offset: wrong clubs
}


class Offline(F.FibaSiteScheduleAdapter):
    requests_made: list = []

    def _page(self, url):
        self.requests_made.append(url)
        if url == F.NKL_MATCHES:
            return text("matches.html")
        if url.rstrip("/") == F.NKL_SITE:
            return text("home.html")
        raise RuntimeError(url)

    def _get_meta(self, url):
        self.requests_made.append(url)
        m = re.search(r"/data/(\d+)/data\.json", url)
        raw = FEEDS.get(m.group(1)) if m else None
        return (copy.deepcopy(raw) if raw else None), {"lm_ms": None, "etag": None, "recv_ms": 0}


def fresh(root):
    Offline.requests_made = []
    F.FibaSiteScheduleAdapter._nkl_cache = (0.0, [])
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline(), {"code": "NKL", "site": "nkl", "season": "2026-27", "repo_root": root}


root = tempfile.mkdtemp()

print("-- the schedule")
a, cfg = fresh(root)
reg = list(a.discover("https://nkl.lt/matches/", dict(cfg, stage="regular")))
per = defaultdict(int)
for g in reg:
    per[g.extra["home_code"]] += 1
    per[g.extra["away_code"]] += 1
ok("2026/27 regular season: 306 games, 18 clubs x 34, every club coded by its nkl.lt id",
   len(reg) == 306 and len(per) == 18 and set(per.values()) == {34} and None not in per, (len(reg), len(per)))
g0 = next(g for g in reg if g.external_id == "125745")
ok("125745 Alytaus Patriotai v Kauno Žalgiris-2: codes 3386 / 266, 28 Sep 18:15 Vilnius = 15:15 UTC, in Alytus",
   (g0.home_name, g0.away_name, g0.extra["home_code"], g0.extra["away_code"], g0.tipoff_at, g0.extra["venue"])
   == ("Alytaus Patriotai", "Kauno Žalgiris-2", "3386", "266", "2026-09-28T15:15:00Z", "Alytaus sporto ir rekreacijos centras"),
   (g0.home_name, g0.away_name, g0.extra, g0.tipoff_at))
ok("every crest is https", all((g.extra["home_logo"] or "").startswith("https://nkl.lt/") for g in reg))
ok("nothing played yet: every game scheduled", {g.status for g in reg} == {"scheduled"})
ok("the play-off source finds nothing yet", list(a.discover("https://nkl.lt/matches/#playoffs", dict(cfg, stage="playoffs"))) == [])
ok("another season's games are not this season's", list(a.discover("x", dict(cfg, season="2025-26"))) == [])
ok("the whole season is one request", Offline.requests_made.count(F.NKL_MATCHES) == 1, Offline.requests_made)

print("\n-- the LiveStats id")
a, cfg = fresh(root)
ok("125745 is 2895455 by the homepage strip, and the strip's 15 pairs are remembered",
   a._nkl_fiba_id("125745", None, cfg) == "2895455" and len(a._idmap(cfg)) == 15, a._idmap(cfg))
rows = {str(r["id"]): r for r in a._nkl_matches()}
ok("125770 (not on the strip) is tried as 125770 + 2769710 and kept: the feed names its two clubs",
   a._nkl_fiba_id("125770", rows["125770"], cfg) == "2895480" and a._idmap(cfg).get("125770") == "2895480")
ok("125771's candidate names two other clubs: refused, nothing remembered",
   a._nkl_fiba_id("125771", rows["125771"], cfg) is None and "125771" not in a._idmap(cfg))
ok("a remembered id costs no request", (Offline.requests_made.clear() or True) and a._nkl_fiba_id("125770", rows["125770"], cfg) == "2895480"
   and Offline.requests_made == [])

print("\n-- fetch()")
a, cfg = fresh(root)
b = a.fetch("125745", cfg)
ok("125745 fetches, keyed on the nkl.lt id", b is not None and b.external_id == "125745")
ok("...with nkl.lt's club ids as the codes and its names on both clubs",
   b.raw["tm"]["1"]["code"] == "3386" and b.raw["tm"]["2"]["code"] == "266"
   and (b.home_name, b.away_name) == ("Alytaus Patriotai", "Kauno Žalgiris-2")
   and b.team["home"]["team_code"] == "3386", (b.raw["tm"]["1"]["code"], b.home_name))
ok("...and the FIBA box, stints and status come through untouched",
   b.status == "final" and len(b.box["home"]) == len(STANDIN["tm"]["1"]["pl"]) and b.stints)
ok("a fixture with no webcast known and no confirmed candidate is not fetched",
   fresh(tempfile.mkdtemp())[0].fetch("125771", dict(cfg, repo_root=tempfile.mkdtemp())) is None)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
