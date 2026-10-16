"""Every league backfill-able, offline:

    python scripts/ingest/backfill_test.py

A season asked for from the console (0135 season_backfills) is the ordinary pass with adapter_config["season"]
changed, and run_ingest.backfill_sources refuses any source whose adapter is not known to read it. What this holds:
  * every adapter a configured league uses is either season-aware or named in NO_PAST with its reason - a new
    league cannot quietly be one the console's button does nothing for;
  * the pinned source: the season set, the live competition and schedule row cleared, and season_auto dropped,
    so NBL1's first_season gate (a guard for the ordinary pass) does not swallow a season somebody asked for;
  * a season asked for the other way from how the league names them ("2025-26" of a calendar-year league) is
    skipped, and the reasons end up on the request;
  * the four adapters added read the season they are handed: ABA's season number, Finland's competition (the
    national series before 2025-26) and the feed's reach, Brazil's schedule filter, the NBL's season year.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import json  # noqa: E402

import run_ingest as R  # noqa: E402
from adapters import aba as A  # noqa: E402
from adapters import basketfi as F  # noqa: E402
from adapters import lnbbr as L  # noqa: E402
from adapters import nbl as N  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


print("-- which leagues can be asked for")
with open(os.path.join(os.path.dirname(os.path.dirname(HERE)), "config", "ingest-sources.json"), encoding="utf-8") as f:
    CONFIG = json.load(f)["sources"]
used = {s["adapter"] for s in CONFIG}
ok("every configured adapter reads a season, or says why it cannot",
   not (used - R.SEASON_AWARE_ADAPTERS - set(R.NO_PAST)), sorted(used - R.SEASON_AWARE_ADAPTERS - set(R.NO_PAST)))
ok("...ABA, Finland, Brazil and the NBL among the season-aware", {"aba", "basketfi", "lnbbr", "nbl"} <= R.SEASON_AWARE_ADAPTERS)
ok("...and the BBL and Argentina's site the ones that cannot, with their reasons", set(R.NO_PAST) == {"bbl", "lnbar"}
   and "401" not in R.NO_PAST["bbl"] and "season being played" in R.NO_PAST["bbl"]
   and "season being played" in R.NO_PAST["lnbar"])
ok("no adapter is both", not (set(R.NO_PAST) & R.SEASON_AWARE_ADAPTERS))

print("\n-- pinning a league's sources to the season asked for")
SRC = [
    {"code": "NBL1M", "league_slug": "nbl1-men", "adapter": "nbl", "competition_id": "c-live", "id": "row-1",
     "adapter_config": {"org": "nbl1", "gender": "men", "stage": "regular", "season_calendar": True,
                        "first_season": "2027", "season": "2026", "season_auto": True}},
    {"code": "NBL", "league_slug": "nbl", "adapter": "nbl", "competition_id": "c-nbl", "id": "row-2",
     "adapter_config": {"org": "nbl", "stage": "regular"}},
    {"code": "BBL", "league_slug": "bbl", "adapter": "bbl", "competition_id": "c-bbl", "id": "row-3", "adapter_config": {}},
    {"code": "LOURO", "league_slug": "liga-ouro", "adapter": "lnbbr", "competition_id": None, "id": "row-4",
     "adapter_config": {"league_path": "liga-ouro", "season_calendar": True, "season": "2026", "season_auto": True}},
]
job = {"league_slug": "nbl1-men", "season": "2025"}
got = R.backfill_sources(job, SRC)
ac = got[0]["adapter_config"] if got else {}
ok("NBL1 2025: one source, the season pinned", len(got) == 1 and ac.get("season") == "2025", got)
ok("...the live competition and the schedule row cleared", got and got[0]["competition_id"] is None and got[0]["id"] is None)
ok("...season_auto dropped (a year asked for, not guessed)", "season_auto" not in ac)
ok("...the source the ordinary pass reads left as it was", SRC[0]["adapter_config"].get("season_auto") is True
   and SRC[0]["adapter_config"]["season"] == "2026" and SRC[0]["competition_id"] == "c-live")
ok("...and the NBL's reader then reads 2025, first_season 2027 notwithstanding", N.NblAdapter._year(ac, True) == 2025)
ok("the gate still holds for the ordinary pass's own guess", N.NblAdapter._year(SRC[0]["adapter_config"], True) is None)

job = {"league_slug": "nbl1-men", "season": "2024-25"}
ok("a calendar-year league asked for 2024-25: skipped", R.backfill_sources(job, SRC) == [])
ok("...and the request says how it names its seasons", any("calendar year" in x for x in job["skipped"]), job.get("skipped"))
job = {"league_slug": "nbl", "season": "2025"}
ok("a split-season league asked for 2025 (NBL reads that as 2025-26): skipped", R.backfill_sources(job, SRC) == []
   and any("two years" in x for x in job["skipped"]), job.get("skipped"))
job = {"league_slug": "nbl", "season": "2024-25"}
ok("...and asked for 2024-25, read", [s["adapter_config"]["season"] for s in R.backfill_sources(job, SRC)] == ["2024-25"])
job = {"league_slug": "bbl", "season": "2024-25"}
ok("the BBL: skipped, its reason on the request", R.backfill_sources(job, SRC) == [] and job["skipped"]
   and "season being played" in job["skipped"][0], job.get("skipped"))
job = {"league_slug": "liga-ouro", "season": "2025"}
got = R.backfill_sources(job, SRC)
ok("Liga Ouro 2025: pinned, season_auto dropped", len(got) == 1 and got[0]["adapter_config"]["season"] == "2025"
   and "season_auto" not in got[0]["adapter_config"])

print("\n-- ABA")
ok("2024-25 is the site's season 24, 2022-23 its 22", (A.season_number({"season": "2024-25"}), A.season_number({"season": "2022-23"})) == (24, 22))

print("\n-- Finland")
ok("2025-26 on: the top series' own competition (huki2526, huki2627)",
   (F.competition_id({"season": "2025-26"}), F.competition_id({"season": "2026-27"})) == ("huki2526", "huki2627"))
ok("before: the national series, named for the season (2024-2025)", F.competition_id({"season": "2024-25"}) == "2024-2025")
ok("a competition written into the row wins", F.competition_id({"season": "2024-25", "torneopal_competition": "x"}) == "x")
ok("the stats feed holds a season with a UUID (2024-25 on), not the old numbers (2023-24's 36328)",
   F.feed_holds("9ad61b62-90dc-11f1-a9d5-c9ca21b3272e") and not F.feed_holds("36328") and not F.feed_holds(""))


class Fin(F.BasketFiAdapter):
    def _matches(self, comp, cat):
        return [{"match_id": "1", "category_external_id": "36328", "match_external_id": "2306036", "status": "Played",
                 "team_A_name": "Kobrat", "team_B_name": "Kouvot", "date": "2023-10-04", "time": "18:30",
                 "group_type": "group_stage", "category_name": "Korisliiga"}]

    def _listing(self, season):
        raise AssertionError("an unserved season is never asked of the feed")

    def _get(self, url):
        return None                      # FIBA LiveStats' data.json refusing the season's links (403)


class FinLive(Fin):
    def _get(self, url):
        return {"tm": {"1": {}, "2": {}}} if url.endswith("/data/2306036/data.json") else None


# 2023-24 is not on the EUI; TorneoPal links it to FIBA LiveStats, whose data.json still holds Korisliiga's games
# (2306036) and refuses the divisions' links - both offline here
F.BasketFiAdapter._livestats_ok = {}
ok("a 2023-24 backfill whose links data.json refuses reads nothing rather than fixtures that can never be fetched",
   list(Fin().discover("", {"category": 4, "stage": "regular", "season": "2023-24"})) == [])
F.BasketFiAdapter._livestats_ok = {}
ok("...and one whose links it answers lists its games, keyed by the LiveStats id",
   [g.external_id for g in FinLive().discover("", {"category": 4, "stage": "regular", "season": "2023-24"})] == ["2306036"])
F.BasketFiAdapter._livestats_ok = {}

print("\n-- Brazil")
MENU = [("106", "NBB 2026/2027", True), ("97", "NBB 2025/2026", False), ("88", "NBB 2024/2025", False)]
OURO = [("102", "Liga Ouro 2026", True), ("93", "Liga Ouro 2025", False), ("51", "Liga Ouro 2019", False)]
ok("2024-25 is NBB's 88, 2024/2025 too", L.season_wanted(MENU, "2024-25") == "88" and L.season_wanted(MENU, "2024/2025") == "88")
ok("2025 is Liga Ouro's 93", L.season_wanted(OURO, "2025") == "93")
ok("a year never matches a split season, nor a split season a year",
   L.season_wanted(MENU, "2024") is None and L.season_wanted(OURO, "2024-25") is None)
ok("a season the filter does not hold (Liga Ouro 2022), or nonsense (2024-26), is None",
   L.season_wanted(OURO, "2022") is None and L.season_wanted(MENU, "2024-26") is None and L.season_wanted(MENU, "") is None)

PAGE = ("<div>" + "".join(f"<li onclick=\"filterBySeason('{sid}');\"><input type=\"radio\" value=\"{sid}\" "
                           f"{'checked' if chk else ''}><label>{label}</label></li>" for sid, label, chk in MENU) + "</div>")


class Br(L.LnbBrAdapter):
    def __init__(self):
        super().__init__()
        self.asked = []

    def _get(self, url):
        self.asked.append(url)
        return PAGE


L.LnbBrAdapter._schedule_at, L.LnbBrAdapter._season_ids = {}, {}
ok("the test page's filter reads as the site's", L.season_menu(PAGE) == MENU, L.season_menu(PAGE))
b = Br()
b._rows({"league_path": "nbb", "season": "2024-25"})
ok("a season asked for: the filter read, then that season's page", b.asked == [
    "https://lnb.com.br/nbb/tabela-de-jogos/", "https://lnb.com.br/nbb/tabela-de-jogos/?season%5B%5D=88"], b.asked)
b.asked = []
b._rows({"league_path": "nbb", "season": "2024-25"})
ok("...once: the filter's id and the page are kept", b.asked == [], b.asked)
ok("...under their own key, never the season on show's", "nbb?88" in L.LnbBrAdapter._schedule_at and "nbb" not in L.LnbBrAdapter._schedule_at)
b = Br()
b._rows({"league_path": "nbb", "season": "2026-27"})
ok("the season on show asked for by name: one read, kept as the ordinary pass's", b.asked == ["https://lnb.com.br/nbb/tabela-de-jogos/"]
   and "nbb" in L.LnbBrAdapter._schedule_at, b.asked)
L.LnbBrAdapter._schedule_at, L.LnbBrAdapter._season_ids = {}, {}
b = Br()
b._rows({"league_path": "liga-ouro", "season": "2026", "season_auto": True})
ok("run_ingest's own guess (season_auto) reads the season on show, as before", b.asked == ["https://lnb.com.br/liga-ouro/tabela-de-jogos/"], b.asked)
b = Br()
ok("a season the site does not have: nothing, and no page of another season",
   b._rows({"league_path": "nbb", "season": "2012-13"}) == [] and b.asked == ["https://lnb.com.br/nbb/tabela-de-jogos/"], b.asked)
L.LnbBrAdapter._schedule_at, L.LnbBrAdapter._season_ids = {}, {}

print("\n-- the NBL")
ok("2024-25 is the NBL's 2024, 2025 NBL1's 2025", (N.NblAdapter._year({"season": "2024-25"}, False), N.NblAdapter._year({"season": "2025"}, True)) == (2024, 2025))

print("\n-- what a backfill counts as done (2026-10-16)")
RI = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_ingest.py"), encoding="utf-8").read().replace("\r\n", "\n")
ok("a game the source sends nothing for is counted, not passed over",
   'tot["unavailable"] = tot.get("unavailable", 0) + 1\n                    continue' in RI)
ok("a write that threw, or could not place the game, is not 'written' on a backfill",
   "landed = not (job and said is False)" in RI and 'tot["unwritten"] = tot.get("unwritten", 0) + 1' in RI)
ok("nothing landed (and nothing from the runs before) is failed, with what came back",
   'not (tot["written"] + int(job.get("games_written") or 0))' in RI and 'error = (f"nothing could be written: of the' in RI)
ok("a run cut at --max-games that wrote something is put back for the rest",
   'if job and not tot.get("paused") and tot.get("more") and tot["written"]:' in RI)
ok("the season is archived only when it was done, and only its own league's games",
   'tot["written"] and state == "done" and job.get("league_slug")' in RI)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
