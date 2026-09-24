"""The Kosovo Superliga (adapters/fiba_site_schedule.py, site "kosovo"), offline:

    python scripts/ingest/kosovo_test.py

The federation (basketbolli.com) scores the Superliga on FIBA LiveStats (client KOS). Its Results page
lists the whole season under its weeks ("JAVA I" ...) and gives a game a LiveStats link once it is set
up; the league gets a new leagueId every season and the old page is purged. What this holds the
adapter to:
  * the current season's page read off the site's own menu ("PROCREDIT SUPERLIGA" -> leagueId=150);
  * the fixtures: keyed on the season, the week and the two clubs from the first sighting to the
    final, clubs coded by name (the feed's codes are three letters an operator types), crests from the
    site, Kosovo time -> UTC, a 20-0 forfeit and a game not yet dated left out;
  * the LiveStats id remembered against the key the moment the link appears, and the game fetched
    through the ordinary data.json path: box, play-by-play, shots and stints for the whole game;
  * both page layouts: 2026-27's (class="team-name"/"team-score") and the 2025-26 archive's.

Fixtures in scripts/ingest/data/kosovo/ (captured 2026-09-24): the site menu, the 2026-27 Results
page trimmed to its weeks and rows, and LiveStats' data.json for 2905713 (Rahoveci 029 101-106 Trepça).
"""
import json
import os
import sys
import tempfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "kosovo")
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


class Offline(F.FibaSiteScheduleAdapter):
    def __init__(self, menu=None):
        super().__init__()
        self.asked = []
        self.menu = menu

    def _page(self, url):
        self.asked.append(url)
        if url.rstrip("/") == F.KOS_SITE:
            return self.menu if self.menu is not None else text("home-menu.html")
        if url.endswith("/Results?leagueId=150"):
            return text("results-150.html")
        raise RuntimeError(f"no fixture for {url}")

    def _get_meta(self, url):
        self.asked.append(url)
        if "/2905713/" in url:
            return json.loads(text("fiba-2905713.json")), {"lm_ms": None, "etag": None, "recv_ms": 0}
        return None, {"lm_ms": None, "etag": None, "recv_ms": 0}


def fresh(menu=None):
    F.FibaSiteScheduleAdapter._kos_cache = (0.0, "", "")
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline(menu)


ROOT = tempfile.mkdtemp()
CFG = {"code": "KOS", "site": "kosovo", "repo_root": ROOT}

print("-- the source rows")
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if (s.get("adapter_config") or {}).get("site") == "kosovo"]
ok("a regular and a play-off source, in Kosovo (XK)", sorted(s["adapter_config"]["stage"] for s in rows) == ["playoffs", "regular"]
   and all(s["league_country"] == "XK" and s["league_slug"] == "kosovo-superliga" for s in rows), rows)

print("\n-- the current season, from the site's own menu")
a = fresh()
ok("PROCREDIT SUPERLIGA -> /Results?leagueId=150", a._kos_url(CFG) == "https://basketbolli.com/Results?leagueId=150")
ok("a menu without the league is no season at all, not a guessed one",
   fresh('<a href="/Results?leagueId=151">SUPERLIGA FEMRAT</a>')._kos_url(CFG) is None)
ok("another league on the same site is one config line away (menu_label)",
   a._kos_url(dict(CFG, menu_label="SUPERLIGA FEMRAT")) == "https://basketbolli.com/Results?leagueId=151")
ok("a season the site has purged is refused, not read as the current one",
   fresh()._kos(dict(CFG, stage="regular", season="2024-25")) == [])

print("\n-- the fixtures")
a = fresh()
games = a._kos(dict(CFG, stage="regular"))
page_rows = F.kosovo_rows(text("results-150.html"))
ok("the page lists the season: 112 games, 8 clubs x 28, under 28 weeks",
   len(page_rows) == 112 and max(r["week"] for r in page_rows) == 28)
ok("55 fixtures: every dated one but the 0-20 forfeit (56 have no date yet)",
   len(games) == 55 and sum(1 for r in page_rows if not r["date"]) == 56, len(games))
clubs = {g.home_name for g in games} | {g.away_name for g in games}
ok("8 clubs, with digits in a name kept (Rahoveci 029)", len(clubs) == 8 and "Rahoveci 029" in clubs, sorted(clubs))
g0 = next(g for g in games if g.external_id == "KOS150-W1-rahoveci-029-trepca")
ok("keyed on the season, the week and the clubs: KOS150-W1-rahoveci-029-trepca", g0 is not None)
ok("19/09/2026 19:00 in Kosovo is 17:00 UTC; final; Java 1", (g0.tipoff_at, g0.status, g0.extra["round"]) ==
   ("2026-09-19T17:00:00Z", "final", "Java 1"), g0)
ok("clubs coded by name, crests from the site over https",
   (g0.extra["home_code"], g0.extra["away_code"]) == ("rahoveci-029", "trepca")
   and g0.extra["home_logo"] == "https://basketbolli.com/images/rahoveci029.png", g0.extra)
ok("the forfeit (Sigal Prishtina 0-20 Peja) is left out",
   not any(g.home_name == "Sigal Prishtina" and g.away_name == "Peja" and g.extra["round"] == "Java 1" for g in games))
ok("three games played, the rest to come", sum(g.status == "final" for g in games) == 3
   and all(g.status == "scheduled" for g in games if g.status != "final"))
ok("no week is a play-off, so the play-off source finds nothing", fresh()._kos(dict(CFG, stage="playoffs")) == [])
known = a._idmap(CFG)
ok("the three LiveStats ids are remembered against their keys",
   known == {"KOS150-W1-rahoveci-029-trepca": "2905713", "KOS150-W1-bora-vellaznimi": "2905714",
             "KOS150-W1-bashkimi-golden-eagle-ylli": "2905715"}, known)

print("\n-- one game, end to end")
a = fresh()
b = a.fetch("KOS150-W1-rahoveci-029-trepca", dict(CFG, stage="regular", _tipoff_at=g0.tipoff_at))
ok("fetched through LiveStats 2905713", b is not None and any("/2905713/" in u for u in a.asked), a.asked)
ok("keyed on the site's key, final, the site's club names and codes",
   (b.external_id, b.status, b.home_name, b.away_name, b.raw["tm"]["1"]["code"]) ==
   ("KOS150-W1-rahoveci-029-trepca", "final", "Rahoveci 029", "Trepça", "rahoveci-029"))
ok("the score is the league's: 101-106", (b.team["home"]["points"], b.team["away"]["points"]) == (101, 106))
ok("every player's points add up to his club's",
   all(sum(p["sPoints"] for p in b.raw["tm"][s]["pl"].values()) == b.raw["tm"][s]["score"] for s in "12"))
ok("shots charted", sum(len(b.raw["tm"][s]["shot"]) for s in "12") > 100)
dur = sum(r["duration"] for r in b.stints)
ok(f"{len(b.stints)} stints, five a side, covering the game", b.stints and abs(dur - 2400) < 0.01
   and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints), dur)
ok("stint points add up to the score", (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (101, 106))
tr = translate(b.raw)
ok("the event log drops nothing but coach's challenges (no statistic in them), and matches every player",
   all(k.startswith("headcoachchallenge/") for k in tr["report"]["dropped"]) and tr["report"]["unmatched"] == 0,
   (tr["report"]["dropped"], tr["report"]["unmatched"]))
a = fresh()
ok("a game not set up on LiveStats yet is nothing to fetch, and LiveStats is never asked",
   a.fetch("KOS150-W2-trepca-peja", CFG) is None and not any("geniussports" in u for u in a.asked))

print("\n-- both page layouts")
old = ('<h2>JAVA III</h2><div class="match-row"><div class="teams-names"><div class="team"><h4 style="font-size: 18px">Bashkimi</h4>'
       '<img src="/web/2026im_/https://basketbolli.com/images/bashkimi2024logo.png" class="team-logo-large"/>'
       '<h4 style="color: var(--brand)">90</h4></div><p>VS</p><div class="team"><h4 style="font-size: 18px">Rahoveci 029</h4>'
       '<h4 style="color: var(--brand)">70</h4></div></div><div class="match-date shedule-page"><p> 18/01/2026 19:30 </p></div>'
       '<div class="details-button-wrapper "><a href="https://livestats.dcd.shared.geniussports.com/webcast/KOS/2756990/">LiveStats</a></div></div>')
r = F.kosovo_rows(old)
ok("the 2025-26 layout (no team-name classes) reads the same",
   r and (r[0]["home"], r[0]["away"], r[0]["home_score"], r[0]["away_score"], r[0]["week"], r[0]["fiba_id"]) ==
   ("Bashkimi", "Rahoveci 029", 90, 70, 3, "2756990"), r)
for rn, n in (("I", 1), ("IV", 4), ("IX", 9), ("XIV", 14), ("XIX", 19), ("XXVIII", 28)):
    ok(f"week {rn} is {n}", F._roman(rn) == n)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
