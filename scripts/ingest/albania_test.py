"""Albania (FSHB) and Azerbaijan (ABF) on Genius Sports' hosted pages, offline:

    python scripts/ingest/albania_test.py

Both federations keep their schedules on hosted.dcd.shared.geniussports.com (clients ALBS and ABS) and
score on FIBA LiveStats, so both ride the ordinary fiba_livestats path. What is new is Albania's
schedule, which ignores roundNumber=-1: a competition's page shows ONE match day with a calendar of
the others, per match type (REGULAR, FINALS). adapter_config.date_paged reads each type's calendar
and each of its days, and the match type is the stage. What this holds it to:
  * a day-paged season read day by day, REGULAR as the regular season and FINALS as the play-offs;
  * the kick-off in Albanian time -> UTC, the venue, both clubs;
  * a day that cannot be read stops the pass (a half-read season would drop real fixtures);
  * the new sources' competition regexes pick the league and nothing else from each client's list
    (Albania's men's and women's leagues, never a cup; Azerbaijan's ABL, never the Cup, the AQL, the
    TGBL or the amateur league), and a play-off source is named for its season.

Fixtures in scripts/ingest/data/albania/ (captured 2026-09-27 from competition 47347, KKM 2025-26),
trimmed to their match blocks and calendars: two regular-season days and the final.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402

DATA = os.path.join(HERE, "data", "albania")
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


class Offline(FibaLiveStatsAdapter):
    def __init__(self, missing=()):
        super().__init__()
        self.asked, self.missing = [], set(missing)

    def _hosted_page(self, url, params):
        self.asked.append(dict(params))
        mt, day = params.get("matchType", ""), params.get("dateFilter")
        if day:
            if day in self.missing:
                return None
            return text(f"day-{mt.lower()}-{day}.html")
        return text("calendar-regular.html" if mt == "REGULAR" else "calendar-finals.html")


URL = "https://hosted.wh.geniussports.com/ALBS/en/competition/47347/schedule?roundNumber=-1&"
CFG = {"code": "ALBM", "client_code": "ALBS", "timezone": "Europe/Tirane", "date_paged": True}

print("-- a day-paged season")
a = Offline()
reg = a.date_paged_games(URL, dict(CFG, stage="regular"))
ok("the regular season: every game of each REGULAR day", reg is not None and len(reg) == 4, reg and len(reg))
ok("...and only REGULAR pages asked", all(p.get("matchType") == "REGULAR" for p in a.asked), a.asked)
ok("each day asked once, by date", [p.get("dateFilter") for p in a.asked if p.get("dateFilter")] == ["2025-10-04", "2025-10-05"], a.asked)
g = min(reg.values(), key=lambda x: x.tipoff_at) if reg else None
ok("both clubs", g and (g.home_name, g.away_name) == ("KS Tirana", "Fieri Basket"), g and (g.home_name, g.away_name))
ok("19:00 in Tirana is 17:00 UTC in October", g and g.tipoff_at.startswith("2025-10-04T17:00:00"), g and g.tipoff_at)
ok("the venue", g and g.extra.get("venue") == "Pallati i Sportit Farie Hoti", g and g.extra.get("venue"))
ok("tagged regular", all(x.extra.get("stage") == "regular" for x in reg.values()))

a = Offline()
po = a.date_paged_games(URL, dict(CFG, stage="playoffs"))
ok("the play-offs: the FINALS days only", po is not None and list(po) == ["2845642"], po and list(po))
ok("...a final", po and po["2845642"].status == "final" and po["2845642"].extra.get("stage") == "playoffs")
ok("...no REGULAR page asked", all(p.get("matchType") == "FINALS" for p in a.asked), a.asked)

a = Offline()
both = a.date_paged_games(URL, dict(CFG))
ok("no stage: both", both is not None and len(both) == 5, both and len(both))

ok("a day that cannot be read files nothing", Offline(missing={"2025-10-05"}).date_paged_games(URL, dict(CFG, stage="regular")) is None)


print("\n-- the new sources pick their own competitions")
with open(os.path.join(ROOT, "config", "ingest-sources.json"), encoding="utf-8") as f:
    SOURCES = json.load(f)["sources"]


def picks(code, names):
    ac = next(s["adapter_config"] for s in SOURCES if s["code"] == code)
    inc = [re.compile(x, re.I) for x in ac.get("competitions_include") or []]
    exc = [re.compile(x, re.I) for x in ac.get("competitions_exclude") or []]
    return [n for n in names if any(r.search(n) for r in inc) and not any(r.search(n) for r in exc)]


ALBS = ["2024-25", "K.K.F. 2022-23", "K.K.F. 2023-24", "K.K.F. 2024-25", "Kampionati Kombetar Meshkuj",
        "Kampionati Kombetar Meshkuj 2023-24", "Kampionat Kombëtar", "Kategoria I-re M", "Kategoria I-rë Femra 2021-22",
        "Kategoria I-rë Meshkuj", "Kategoria I-rë Meshkuj 2022-23", "KKF 2025-26", "KKM 2025-26",
        "Kupa e Federatës Femra 2023-24", "Kupa e Federatës Meshkuj 2023-24", "Kupa F 2023-24", "Kupa M 2023-24",
        "Kupa M 2024-25", "Kupa M 2025-26", "SUPERKUPA MESHKUJ", "Superliga M 2022-23", "KKM 2026-27", "K.K.M 2026-27"]
ABS = ["ABL", "ABL 2024-2025", "ABL 2025-2026", "Amateur Basketball League", "AQL", "Azerbaijan CUP",
       "Azerbaijan CUP 2024", "Azerbaijan Cup 2026", "TGBL", "ABL 2026-2027"]
ok("Albania men: the national championship only", picks("ALBM", ALBS) == [
    "Kampionati Kombetar Meshkuj", "Kampionati Kombetar Meshkuj 2023-24", "KKM 2025-26", "Superliga M 2022-23", "KKM 2026-27", "K.K.M 2026-27"],
   picks("ALBM", ALBS))
ok("Albania women: the women's championship only", picks("ALBW", ALBS) == [
    "K.K.F. 2022-23", "K.K.F. 2023-24", "K.K.F. 2024-25", "KKF 2025-26"], picks("ALBW", ALBS))
ok("Azerbaijan: the ABL, never a cup or another league", picks("AZABL", ABS) == [
    "ABL", "ABL 2024-2025", "ABL 2025-2026", "ABL 2026-2027"], picks("AZABL", ABS))
alb = [s for s in SOURCES if s["code"] == "ALBM"]
ok("Albania: a regular and a play-off source, day-paged, in Tirana time",
   sorted(s["adapter_config"]["stage"] for s in alb) == ["playoffs", "regular"]
   and all(s["adapter_config"]["date_paged"] and s["adapter_config"]["timezone"] == "Europe/Tirane" for s in alb))
aze = [s for s in SOURCES if s["code"] == "AZABL"]
ok("Azerbaijan: split by phase, in Baku time", all(s["adapter_config"]["playoff_phases"] and s["adapter_config"]["timezone"] == "Asia/Baku" for s in aze)
   and sorted(s["adapter_config"]["stage"] for s in aze) == ["playoffs", "regular"])
ph = [re.compile(x, re.I) for x in aze[0]["adapter_config"]["playoff_phases"]]
phases = ["A GROUP ABL 25-26", "B GROUP ABL 25-26", "PLAY-IN", "PLAY-OFF 1/4", "PLAY OFF 1/2", "Final"]
ok("...the play-in, the play-offs and the final are the play-offs", [p for p in phases if any(r.search(p) for r in ph)]
   == ["PLAY-IN", "PLAY-OFF 1/4", "PLAY OFF 1/2", "Final"])

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
