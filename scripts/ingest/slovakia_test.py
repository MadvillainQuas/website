"""The Slovak SBL (adapters/fiba_site_schedule.py, site=slovakia), offline:

    python scripts/ingest/slovakia_test.py

What this holds the adapter to:
  * the season's tournament id is read off the site's own season menu, for an older season as for this one;
  * a card's webcast link in either form: livestats.dcd.shared.geniussports.com/webcast/SBA/<id>/ (2023-24 on) and
    www.fibalivestats.com/webcast/EYOF/<id>/ (2022-23), the fixture keyed on that LiveStats id;
  * a season scored without LiveStats (2021-22 and before: no card, overview or stats page links a webcast) is read
    off the site's own box score, keyed "SK<season id>-<match id>" - but only a season that is over, never the one
    being played (where a card with no link is a game not set up YET);
  * the clubs' names with the site's HTML entities read ("Spišsk&#237; Rytieri" is Spišskí Rytieri).

Fixtures in scripts/ingest/data/slovakia/, all served 2026-10-14: the season menu; three cards each of 2021-11 (season
11609) and 2022-11 (season 8024); and match 125931's Štatistiky tab, trimmed to the header and the two box scores.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import fiba_site_schedule as F  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402

DATA = os.path.join(HERE, "data", "slovakia")
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


MENU, L2021, L2022, STATS = text("menu.html"), text("list-11609-2021-11.html"), text("list-8024-2022-11.html"), text("stats-125931.html")


class Fake(F.FibaSiteScheduleAdapter):
    """Every page from the fixtures: a month's list by its season id and month, the season menu on any September
    page (that is where the adapter reads it), the statistics page by its match; any other month is empty."""
    min_request_gap_s = 0

    def __init__(self, lists):
        super().__init__()
        self.lists, self.asked = lists, []

    def _page(self, url):
        self.asked.append(url)
        if "/Stats" in url:
            if url == F.SLOVAK_STATS.format(sid="11609", mid="125931"):
                return STATS
            raise RuntimeError("404 " + url)
        sid = url.split("/match-list/")[1].split("/")[0]
        month = url.split("month=")[1].split("&")[0]
        body = self.lists.get((sid, month), "")
        return (MENU if month.endswith("-09") else "") + body

    def _get_meta(self, url):
        self.asked.append(url)
        return None, {"lm_ms": None, "etag": None, "recv_ms": 0}


FibaLiveStatsAdapter._pipeline = False
FibaLiveStatsAdapter._pipeline_warned = True
CFG = {"code": "SBA", "site": "slovakia", "repo_root": tempfile.mkdtemp(prefix="slovakia_test_")}

print("-- a card")
cards = [F.slovak_card(c) for c in F._SK_CARD.findall(L2022)]
ok("2022-23's cards link www.fibalivestats.com/webcast/EYOF/<id>/: read as the LiveStats id",
   [c["fiba_id"] for c in cards] == ["2152584", "2152594", "2152595"], [c["fiba_id"] for c in cards])
ok("the clubs' names with the site's entities read: Spišskí Rytieri, MBK BANÍK Handlová",
   (cards[0]["home"], cards[1]["away"]) == ("Spišskí Rytieri", "MBK BANÍK Handlová"), (cards[0]["home"], cards[1]["away"]))
ok("...the hall too, and the club ids from the crests", cards[0]["venue"] == "Mestská športová hala, Spišská Nová Ves"
   and (cards[0]["home_code"], cards[0]["away_code"]) == ("664986", "664993"), cards[0])
old = [F.slovak_card(c) for c in F._SK_CARD.findall(L2021)]
ok("2021-22's cards link no webcast; they carry the site's own season and match ids, and the score",
   [(c["fiba_id"], c["site"], c["score"]) for c in old][0] == (None, ("11609", "125931"), (89, 81)), old[0])
ok("...their crests are the site's blank default: names from the alt text, no club id, and 'bude doplnené' is no hall",
   (old[0]["home"], old[0]["away"], old[0]["home_code"], old[0]["venue"]) == ("Inter Bratislava", "Patrioti Levice", None, None), old[0])

print("\n-- discovery")
a = Fake({("8024", "2022-11"): L2022})
g22 = a.discover("", dict(CFG, season="2022-23"))
ok("2022-23: the season id read off the menu (8024), its games keyed on their LiveStats ids",
   [g.external_id for g in g22] == ["2152584", "2152594", "2152595"]
   and any("/match-list/8024/" in u and "month=2022-11" in u for u in a.asked), ([g.external_id for g in g22], a.asked[:3]))
ok("...with their clubs, codes, and the kick-off (19:00 in Bratislava on 2 Nov 2022 is 18:00 UTC)",
   (g22[0].home_name, g22[0].extra["home_code"], g22[0].tipoff_at) == ("Spišskí Rytieri", "664986", "2022-11-02T18:00:00Z"),
   (g22[0].home_name, g22[0].extra, g22[0].tipoff_at))
a = Fake({("11609", "2021-11"): L2021})
g21 = a.discover("", dict(CFG, season="2021-22"))
ok("2021-22 (no webcast anywhere): its played games keyed on the site's ids, final",
   [g.external_id for g in g21] == ["SK11609-125931", "SK11609-125898", "SK11609-125904"]
   and {g.status for g in g21} == {"final"}, [(g.external_id, g.status) for g in g21])
ok("...with no club code or crest where the card has none of the club's own (its blank default is not a crest)",
   all(g.extra.get("home_code") is None and g.extra.get("home_logo") is None for g in g21), g21[0].extra)
now = F._start_year("")
season_now = f"{now}-{str(now + 1)[2:]}"
a = Fake({("11641", f"{now}-11"): L2021})          # 11641 is 2026/27 on the menu, and the configured id besides
cur = a.discover("", dict(CFG, season=season_now, season_ids={season_now: "11641"}))
ok("the season being played never keys a card without a webcast on the site's id (it is a game not set up yet)",
   cur == [] and any("/match-list/11641/" in u and f"month={now}-11" in u for u in a.asked),
   ([g.external_id for g in cur], [u for u in a.asked if f"month={now}-11" in u]))

print("\n-- the site's own box score")
a = Fake({("11609", "2021-11"): L2021})
b = a.fetch("SK11609-125931", dict(CFG, season="2021-22", _tipoff_at=g21[0].tipoff_at))
ok("one request, the match's statistics page, and LiveStats is never asked",
   a.asked == [F.SLOVAK_STATS.format(sid="11609", mid="125931")], a.asked)
ok("published as a result: final, no play-by-play to replay, 89-81",
   b is not None and b.status == "final" and b.translate is False
   and (b.team["home"]["points"], b.team["away"]["points"]) == (89, 81), b and (b.status, b.translate, b.team["home"].get("points")))
ok("...under the clubs' names as the cards print them, abbreviated as the page does (IBA, PLV)",
   b is not None and (b.home_name, b.away_name) == ("Inter Bratislava", "Patrioti Levice")
   and (b.raw["tm"]["1"]["shortName"], b.raw["tm"]["2"]["shortName"]) == ("IBA", "PLV"), b and (b.home_name, b.away_name))
ok("...each club coded by the site's own id for it (the id a crest carries where a card has one)",
   b is not None and (b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]) == ("664575", "664579"),
   b and (b.raw["tm"]["1"].get("code"), b.raw["tm"]["2"].get("code")))
plain = F.slovak_stats_page(STATS)
plain["clubs"] = [(tid, name, "") for tid, name, _ in plain["clubs"]]          # 2020-21's header: names, no abbreviation
raw2 = F.slovak_payload(plain)
ok("a page with no abbreviation short-names the club by its name, never by its id",
   raw2 is not None and (raw2["tm"]["1"]["shortName"], raw2["tm"]["2"]["shortName"]) == ("Inter Bratislava", "Patrioti Levice"),
   raw2 and raw2["tm"]["1"].get("shortName"))
ok("...12 players a side, keyed on the site's player ids, whose points make the score",
   b is not None and (len(b.box["home"]), len(b.box["away"])) == (12, 12)
   and all(sum(float(r["sPoints"]) for r in b.box[s]) == float(b.team[s]["points"]) for s in ("home", "away")),
   b and (len(b.box["home"]), len(b.box["away"])))
mal = b and next((r for r in b.box["home"] if r["player_id"] == "818973"), None)
ok("...Matúš Malovec: 12:00, 7 points, 1/1 two, 1/1 three, 2/3 FT, 2 fouls",
   mal is not None and (mal["sMinutes"], mal["sPoints"], mal["sTwoPointersMade"], mal["sThreePointersMade"],
                        mal["sFreeThrowsMade"], mal["sFreeThrowsAttempted"], mal["sFoulsPersonal"]) == ("12:00", 7, 1, 1, 2, 3, 2), mal)
ok("...the team line is the page's Spolu: 37 rebounds (13 + 24), 28/59 from the field",
   b is not None and (b.raw["tm"]["1"]["tot_sReboundsTotal"], b.raw["tm"]["1"]["tot_sFieldGoalsMade"],
                      b.raw["tm"]["1"]["tot_sFieldGoalsAttempted"]) == (37, 28, 59), b and b.raw["tm"]["1"].get("tot_sReboundsTotal"))
ok("...no quarters where the page has only 0:0 for every one", b is not None and "p1_score" not in b.raw["tm"]["1"],
   b and {k: v for k, v in b.raw["tm"]["1"].items() if k.startswith("p") and k.endswith("_score")})
ok("a page whose two tables are not the header's two clubs is not filed under them",
   F.slovak_payload(dict(F.slovak_stats_page(STATS), clubs=[("1", "Patrioti Levice", ""), ("2", "Inter Bratislava", "")])) is None)
ok("a page with no box score is nothing", F.slovak_payload(F.slovak_stats_page("<html></html>")) is None)
ok("an id that is not the site's form is nothing, without a request", Fake({}).fetch("SKX", dict(CFG, season="2021-22")) is None)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
