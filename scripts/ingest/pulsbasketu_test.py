"""Poland's 1 Liga Mężczyzn and 1 Liga Kobiet (adapters/fiba_site_schedule.py, site "pulsbasketu"),
offline:

    python scripts/ingest/pulsbasketu_test.py

The federation scores both leagues on FIBA LiveStats (client POL), but its own sites never link a
game to LiveStats and POL's hosted Genius site is switched off. Puls Basketu's API names each game's
LiveStats id, so that is where the schedule and the id come from. What this holds the adapter to:
  * the schedule: every game of the season from one reply, keyed on the Puls game id, coded by the
    Puls club id, crested over https, tip-offs Warsaw -> UTC, 00:00 local read as "time not set",
    "regular" and "playoffs" kept apart by the schedule's own stage block;
  * the LiveStats id: read from the game's own reply, remembered, and not invented for a game the
    federation has not set up yet (no request to LiveStats at all for it);
  * the fetch: the genuine LiveStats payload (2902819 = Puls 37587, WKK Wrocław 66-80 Noteć
    Inowrocław, 2026-09-18) with Puls' club ids and names put on it, keyed on the Puls id, and the
    score the league's own.

Fixtures in scripts/ingest/data/pulsbasketu/ (captured 2026-09-24): the 1LM 2026/27 season list,
two trimmed game replies, and LiveStats' data.json for 2902819 as served.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters import get_adapter  # noqa: E402

DATA = os.path.join(HERE, "data", "pulsbasketu")
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
        return json.load(f)


class Offline(F.FibaSiteScheduleAdapter):
    """The real adapter with every request served from the fixtures, and counted."""

    def __init__(self):
        super().__init__()
        self.asked = []

    def _puls_json(self, url):
        self.asked.append(url)
        if "/league-seasons/1lm/games?season=2027" in url:
            return load("1lm-2027.json")
        if "/league-seasons/" in url:
            return None                          # a league with no such season: the site's 404
        gid = url.rsplit("/", 1)[-1]
        p = os.path.join(DATA, f"game-{gid}.json")
        return load(f"game-{gid}.json") if os.path.exists(p) else None

    def _get_meta(self, url):
        self.asked.append(url)
        if "/2902819/" in url:
            return load("fiba-2902819.json"), {"lm_ms": None, "etag": None, "recv_ms": 0}
        return None, {"lm_ms": None, "etag": None, "recv_ms": 0}


def fresh():
    F.FibaSiteScheduleAdapter._puls_cache = {}
    return Offline()


CFG = {"code": "PL1LM", "site": "pulsbasketu", "league": "1lm", "season": "2026-27"}

print("\n-- the source rows")
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if (s.get("adapter_config") or {}).get("site") == "pulsbasketu"]
ok("1LM and 1LK, a regular and a playoff row each", sorted((s["code"], s["adapter_config"]["stage"]) for s in rows) ==
   [("PL1LK", "playoffs"), ("PL1LK", "regular"), ("PL1LM", "playoffs"), ("PL1LM", "regular")], rows)
ok("no 2 Liga Mężczyzn", not any("2lm" in json.dumps(s).lower() for s in src))
ok("every row runs on the site-schedule adapter, in Poland",
   all(s["adapter"] == "fiba_site_schedule" and s["league_country"] == "PL" for s in rows))
ok("the playoff rows are play-off competitions with their own URL",
   all(s.get("competition_kind") == "playoff" and s["scheduleUrls"][0].endswith("#playoffs")
       for s in rows if s["adapter_config"]["stage"] == "playoffs"))
ok("the adapter can read a season (a backfill will not re-read this one)",
   "fiba_site_schedule" in open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().split("SEASON_AWARE_ADAPTERS", 1)[1][:400])

print("\n-- the schedule")
a = fresh()
games = a.discover("", dict(CFG, stage="regular"))
ok("the whole regular season: 240 games, 16 clubs", len(games) == 240 and
   len({g.extra["home_code"] for g in games} | {g.extra["away_code"] for g in games}) == 16,
   (len(games), len({g.extra["home_code"] for g in games})))
ok("one request for the season, by its end year", a.asked == [F.PULS_API + "/league-seasons/1lm/games?season=2027"], a.asked)
g0 = next(g for g in games if g.external_id == "37587")
ok("keyed on the Puls game id, clubs by name", (g0.home_name, g0.away_name) ==
   ("WKK Active Hotel Wrocław", "KSK Qemetica Noteć Inowrocław"), g0)
ok("18:00 in Wrocław on 18 September is 16:00 UTC", g0.tipoff_at == "2026-09-18T16:00:00Z", g0.tipoff_at)
ok("final, coded by the Puls club ids, crested over https", g0.status == "final" and
   (g0.extra["home_code"], g0.extra["away_code"]) == ("65", "2") and
   g0.extra["home_logo"].startswith("https://s1.static.esor.pzkosz.pl/"), g0.extra)
ok("the round is the league's own", g0.extra["round"] == "Runda Zasadnicza · 1 kolejka", g0.extra["round"])
tbc = [g for g in games if g.extra.get("time_tbc")]
ok("a fixture at 00:00 local has no time yet: noon UTC on its day, flagged",
   tbc and all(g.tipoff_at.endswith("T12:00:00Z") for g in tbc), len(tbc))
ok("the six games played by 2026-09-24 are final, the rest scheduled",
   sum(g.status == "final" for g in games) == 6 and all(g.status in ("final", "scheduled") for g in games))
ok("no group on a league played as one table", not any("home_group" in g.extra for g in games))
ok("the playoffs are empty until the league publishes them", a.discover("", dict(CFG, stage="playoffs")) == [])
ok("...and read from the same cached reply", len(a.asked) == 1, a.asked)
ok("a league with no such season yet (1LK before its first round) is no games, not an error",
   fresh().discover("", dict(CFG, league="1lk", code="PL1LK", stage="regular")) == [])
try:
    fresh().discover("", {"site": "pulsbasketu", "code": "X"})
    ok("a row without its league is refused", False)
except ValueError:
    ok("a row without its league is refused", True)

print("\n-- the LiveStats id, and the game")
root = tempfile.mkdtemp()
cfg = dict(CFG, repo_root=root, stage="regular")
a = fresh()
none = a.fetch("37594", cfg)
ok("a game not yet on LiveStats is nothing to fetch, and LiveStats is never asked",
   none is None and not any("geniussports" in u for u in a.asked), a.asked)
ok("...and nothing is remembered for it", "37594" not in a._idmap(cfg))
a = fresh()
b = a.fetch("37587", dict(cfg, _tipoff_at=g0.tipoff_at))
ok("37587 is LiveStats 2902819, and that is remembered",
   a._idmap(cfg).get("37587") == "2902819", a._idmap(cfg))
ok("the payload is fetched from LiveStats by that id",
   any(u.endswith("/data/2902819/data.json") for u in a.asked), a.asked)
ok("the bundle is keyed on the Puls id, final", b is not None and b.external_id == "37587" and b.status == "final",
   b and (b.external_id, b.status))
ok("the clubs carry Puls' names", (b.home_name, b.away_name) ==
   ("WKK Active Hotel Wrocław", "KSK Qemetica Noteć Inowrocław"), (b.home_name, b.away_name))
ok("the score is the league's own: 66-80", (b.team["home"].get("points"), b.team["away"].get("points")) == (66, 80),
   (b.team["home"].get("points"), b.team["away"].get("points")))
ok("each side's players add up to its score",
   all(sum(float(p.get("sPoints") or 0) for p in b.box[s]) == float(b.team[s]["points"])
       for s in ("home", "away")))
ok("the tip-off is the fixture's", b.tipoff_at == g0.tipoff_at, b.tipoff_at)
ok("stints are built for the whole game", len(b.stints) > 10, len(b.stints))
a2 = fresh()
a2.fetch("37587", dict(cfg, _tipoff_at=g0.tipoff_at))
ok("a remembered id costs no request to Puls Basketu for the game",
   not any(u.endswith("/games/37587") for u in a2.asked), a2.asked)

print("\n-- the registry")
ok("the row's adapter resolves", isinstance(get_adapter("fiba_site_schedule"), F.FibaSiteScheduleAdapter))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
