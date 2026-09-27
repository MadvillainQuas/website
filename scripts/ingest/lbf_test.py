"""Serie A1 and A2 Femminile from the Lega Basket Femminile's own JSON (fiba_site_schedule site "lbf"), offline:

    python scripts/ingest/lbf_test.py

What this holds the source to:
  * the season's calendar and phases: the regular season is the round-robin phases, the play-offs everything else, and
    a phase is a group (Serie A2's two gironi) only when there is more than one round robin;
  * each game: the league's id, both clubs keyed on the league's slug with their crests, the UTC kick-off, the status;
    a three-letter code is a short name only when no other club in the competition has it;
  * the LiveStats id is asked for once per game and remembered; a game not set up yet is asked about again only after
    ten minutes; the feed is read under the league's club names and slugs; the league's venue is not used.
"""
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_site_schedule import FibaSiteScheduleAdapter  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def club(slug, name, short, logo=True):
    return {"id": "t-" + slug, "slug": slug, "name": name, "short_name": short,
            "logo_url": f"https://x.supabase.co/storage/v1/object/public/team-logos/2026-27/{slug}.svg" if logo else None}


def match(mid, start, home, away, status="scheduled"):
    return {"id": mid, "slug": "1-giornata/x", "status": status, "start_at": start, "home": home, "away": away,
            "home_points": None, "away_points": None}


TRI, CAGV, CAG, MIL1, MIL2 = (club("trieste", "Futurosa Basket Trieste", "TRI"), club("cagliari-virtus", "Virtus Cagliari", "CAG"),
                              club("cagliari", "Cus Cagliari", "CAG"), club("milano", "Repower Sanga Milano", "MIL"),
                              club("milano-stars", "Milano Basket Stars", None))
OVERVIEW_A2 = {"phases": [{"id": "pA", "name": {"it": "Girone A"}, "format": "round_robin"},
                          {"id": "pB", "name": {"it": "Girone B"}, "format": "round_robin"},
                          {"id": "pPO", "name": {"it": "Playoff"}, "format": "knockout"}]}
CAL_A2 = {"rounds": [
    {"id": "r1", "slug": "1-giornata", "phase_id": "pA", "matches": [match("m1", "2026-10-03T13:30:00.000Z", TRI, CAGV)]},
    {"id": "r2", "slug": "1-giornata-b", "phase_id": "pB", "matches": [match("m2", "2026-10-04T16:00:00.000Z", CAG, MIL1, "final"),
                                                                     match("m3", "2026-10-04T18:00:00.000Z", MIL2, CAG)]},
    {"id": "r3", "slug": "quarti", "phase_id": "pPO", "matches": [match("m9", "2027-04-20T18:00:00.000Z", TRI, MIL1)]}]}
OVERVIEW_A1 = {"phases": [{"id": "p1", "name": {"it": "Regular Season"}, "format": "round_robin"}]}
CAL_A1 = {"rounds": [{"id": "r1", "phase_id": "p1", "matches": [match("a1", "2026-10-03T13:00:00.000Z", club("costa-masnaga", "CLV-Limonta Costa Masnaga", "COS"),
                                                                        club("schio", "Famila Wuber Schio", "SCH"))]}]}

print("-- a calendar, by stage")
reg = F.lbf_games(CAL_A2, OVERVIEW_A2, "regular")
ok("the regular season is the round-robin phases", [g["id"] for g in reg] == ["m1", "m2", "m3"], [g["id"] for g in reg])
ok("...each game in its girone (two round robins: they are groups)", [g["group"] for g in reg] == ["Girone A", "Girone B", "Girone B"])
ok("the play-offs are the rest", [g["id"] for g in F.lbf_games(CAL_A2, OVERVIEW_A2, "playoffs")] == ["m9"])
ok("one round robin (Serie A1) is no group", F.lbf_games(CAL_A1, OVERVIEW_A1)[0]["group"] is None)


class Fake(FibaSiteScheduleAdapter):
    def __init__(self, files):
        super().__init__()
        self.files, self.asked = files, []

    def _lbf_json(self, path):
        self.asked.append(path)
        return self.files.get(path)


ROOT = tempfile.mkdtemp(prefix="lbf_test_")
CFG = {"site": "lbf", "lbf_competition": "serie-a2", "code": "LBFA2", "season": "2026-27", "stage": "regular", "repo_root": ROOT}
FILES = {"/competitions/serie-a2/2026-27/calendar-index.json": CAL_A2, "/competitions/serie-a2/2026-27/overview.json": OVERVIEW_A2}

print("\n-- discovery")
A = Fake(FILES)
games = A.discover("https://www.legabasketfemminile.it/it/serie-a2/", CFG)
by = {g.external_id: g for g in games}
ok("the season's own files, two requests", A.asked == ["/competitions/serie-a2/2026-27/calendar-index.json", "/competitions/serie-a2/2026-27/overview.json"], A.asked)
g1 = by["m1"]
ok("a game: the league's id, clubs, UTC kick-off, scheduled", g1.home_name == "Futurosa Basket Trieste" and g1.away_name == "Virtus Cagliari"
   and g1.tipoff_at == "2026-10-03T13:30:00Z" and g1.status == "scheduled", g1)
ok("...clubs keyed on the league's slugs, with their crests", g1.extra["home_code"] == "trieste" and g1.extra["away_code"] == "cagliari-virtus"
   and g1.extra["home_logo"].endswith("/trieste.svg"), g1.extra)
ok("...a unique code is the short name; CAG (two clubs) and a club with none are not",
   g1.extra.get("home_short") == "TRI" and "away_short" not in g1.extra and "home_short" not in by["m3"].extra, (g1.extra, by["m3"].extra))
ok("...and its girone", g1.extra["home_group"] == g1.extra["away_group"] == "Girone A")
ok("a finished game is final", by["m2"].status == "final")
ok("the play-off game is not the regular season's", "m9" not in by)

print("\n-- one game")
seen = {}


class FetchFake(Fake):
    def _get_meta(self, url):
        seen["url"] = url
        return {"tm": {"1": {"name": "CUS CAGLIARI", "code": "CCA"}, "2": {"name": "Sanga", "code": "SAN"}}}, {"lm_ms": 1, "recv_ms": 2}

    def bundle_from_raw(self, raw, external_id, config):
        seen["raw"] = raw

        class B:
            pass
        b = B()
        b.external_id, b.tipoff_at, b.venue = external_id, None, None
        return b


E = FetchFake(dict(FILES, **{"/matches/m2.json": {"genius_id": 2714381, "venue": {"name": "Palaleonessa"}},
                             "/matches/m1.json": {"genius_id": None}}))
b = E.fetch("m2", CFG)
ok("the LiveStats id from the league's page of the game; the game keeps the league's id",
   seen["url"].endswith("/2714381/data.json") and b.external_id == "m2", seen.get("url"))
ok("...under the league's club names and slugs", seen["raw"]["tm"]["1"] == {"name": "Cus Cagliari", "code": "cagliari"}
   and seen["raw"]["tm"]["2"] == {"name": "Repower Sanga Milano", "code": "milano"}, seen["raw"]["tm"])
ok("...and not the league's venue (it names other clubs' arenas)", b.venue is None)
E.asked.clear()
E.fetch("m2", CFG)
ok("the id is asked for once: the second fetch asks the league nothing", "/matches/m2.json" not in E.asked, E.asked)
seen.clear()
ok("a game not set up on LiveStats yet is not fetched", E.fetch("m1", CFG) is None and "url" not in seen)
E.asked.clear()
E.fetch("m1", CFG)
ok("...and not asked about again for ten minutes", E.asked == [], E.asked)
cache = json.load(open(os.path.join(ROOT, "data", "feed", "LBFA2", "games.json"), encoding="utf-8"))
cache["m1"]["checked"] = time.time() - F.LBF_RECHECK_S - 1
json.dump(cache, open(os.path.join(ROOT, "data", "feed", "LBFA2", "games.json"), "w", encoding="utf-8"))
E.asked.clear()
E.fetch("m1", CFG)
ok("...then asked again", E.asked == ["/matches/m1.json"], E.asked)

print("\n-- the config")
src = [s for s in json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
       if (s.get("adapter_config") or {}).get("site") == "lbf"]
ok("Serie A1 and A2, a regular season and a play-off source each, women's leagues",
   sorted((s["league_slug"], s["adapter_config"]["stage"]) for s in src) ==
   [("serie-a1-femminile", "playoffs"), ("serie-a1-femminile", "regular"), ("serie-a2-femminile", "playoffs"), ("serie-a2-femminile", "regular")]
   and all(s.get("league_gender") == "women" for s in src), [(s["league_slug"], s["adapter_config"].get("stage")) for s in src])
ok("only Serie A2's regular season ranks its gironi apart", [s["league_slug"] for s in src if s["adapter_config"].get("groups_from_feed")] == ["serie-a2-femminile"])

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
