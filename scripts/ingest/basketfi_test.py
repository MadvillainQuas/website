"""Finland (adapters/basketfi.py), offline, over captured replies from TorneoPal and Sportradar's EUI embed:

    python scripts/ingest/basketfi_test.py

What it holds the adapter to:
  * the schedule: a league is a TorneoPal category, read whole (Korisliiga 2026-27: 204 games, 12 clubs
    x 34), each game keyed "<EUI season>_<EUI fixture>", tip-offs in UTC from the match's own offset
    (+03:00 in September, +02:00 in January), club codes from the EUI unless they are not an
    abbreviation of the club;
  * the fixtures TorneoPal never linked to a stats fixture (15 of I divisioona A's 132) joined on the
    clubs and the date, and a moved or doubled fixture joined only when it is unambiguous;
  * the stages: Korisliiga 2025-26's regular season is its 132 Runkosarja games plus the 60 of the upper
    and lower jatkosarja; its play-offs are 43 games, and the 7 "series" rows are not games;
  * the pre-season games as vetting: six played games (Korisliiga, both men's divisions, Naisten
    Korisliiga, and an overtime game) through the whole game path. Every box is the league's own,
    every player's line equals his tally in the event log, and stints cover the game five a side and
    sum to the score. The row Louie pasted from the page (Daniel Dolenc, KTP-Basket 82-80 Helsinki
    Seagulls) is checked value by value, and so are his two pasted play-by-play lines;
  * the official result: Leppävaaran Pyrintö v Puhuttaret is 64-63 after overtime on TorneoPal, and the
    stats feed stops at 63-63 with no overtime in it, so the game is held rather than filed as a draw.

Fixtures live in scripts/ingest/data/basketfi/ (captured 2026-09-24, trimmed to the fields read).
"""
import base64
import collections
import gzip
import json
import os
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import REGISTRY  # noqa: E402
from adapters import basketfi as F  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "basketfi")
KORIS27, DIVA27 = "12a43729-9bb6-11f1-9fef-97a68955b80f", "85b95a62-a1ef-11f1-9388-bf40fc38c4ea"
PREP_M, PREP_W = "94a519ae-9bb5-11f1-b5d4-1983a017e899", "d7cec18d-9bb5-11f1-a288-816fe52c70ea"
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def load(name):
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        return json.load(f)


class Offline(F.BasketFiAdapter):
    """Answers TorneoPal from its captured fixture lists and the EUI from its captured pages."""

    def __init__(self):
        super().__init__()
        self.asked = []

    def _req(self, method, url, **kw):
        p = kw.get("params") or {}
        if "torneopal" in url:
            call = url.rsplit("/", 1)[-1]
            self.asked.append((call, p.get("competition_id"), p.get("category_id")))
            name = f"tp-{p.get('competition_id')}-{p.get('category_id')}.json.gz"
            return load(name) if call == "getMatches" and os.path.exists(os.path.join(DATA, name)) else {}
        s = p["state"]
        st = json.loads(zlib.decompress(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))))
        page = url.rsplit("/", 1)[-1]
        self.asked.append((page, st.get("s", "")[:8], st.get("z")))
        if page == "fixtures":
            name = f"eui-{st['s'][:8]}-{st['z'].lower()}.json.gz"
            return load(name) if os.path.exists(os.path.join(DATA, name)) else {"data": {}}
        name = f"game-{st['f'][:8]}.json.gz"
        return load(name)[st["z"]] if os.path.exists(os.path.join(DATA, name)) else None


FibaLiveStatsAdapter._pipeline = False          # the in-repo stint builder, as on the Actions runner
FibaLiveStatsAdapter._pipeline_warned = True

print("-- registration")
ok("basketfi is registered, reads the embed as website 322 in English, and is a LiveStats-family adapter "
   "(so the live lane covers it)",
   REGISTRY.get("basketfi") is F.BasketFiAdapter and F.BasketFiAdapter.eui_site == 322
   and F.BasketFiAdapter.locale == "en-EN" and issubclass(F.BasketFiAdapter, FibaLiveStatsAdapter))
ok("the season's TorneoPal id is 'huki' and the two years",
   (F.competition_id({"season": "2026-27"}), F.competition_id({"season": "2025-26"}),
    F.competition_id({"torneopal_competition": "huki9999"})) == ("huki2627", "huki2526", "huki9999"))

print("\n-- the pieces")
ok("a club code is believed only as an abbreviation of its club",
   [F.plausible(c, n) for c, n in (("KTP", "KTP-Basket"), ("SEA", "Helsinki Seagulls"), ("KHJ", "Kauhajoki"),
                                   ("PYR", "Tampereen Pyrintö"), ("SAL", "Kouvottaret"), ("OUL", "ACO Basket"),
                                   ("ES2", "Äänekosken Huima"), ("", "Karkkila"))]
   == [True, True, True, True, False, False, False, False])
ok("tip-offs: the match's own offset in either spelling, midnight as a time still to come, no date as none",
   [F.tipoff({"date": "2026-09-29", "time": "18:30:00", "time_zone_offset": "+0300"}),
    F.tipoff({"date": "2027-01-09", "time": "17:00:00", "time_zone_offset": "+02:00"}),
    F.tipoff({"date": "2026-10-02", "time": "00:00:00", "time_zone_offset": "+0300"}),
    F.tipoff({"date": "", "time": ""})]
   == [("2026-09-29T15:30:00Z", False), ("2027-01-09T15:00:00Z", False), ("2026-10-02T12:00:00Z", True), (None, False)])
ok("the stages: a knock-out group is the play-offs, the jatkosarja is the regular season",
   [F.stage_of({"group_type": t}) for t in ("group_stage", "additional_group_stage", "knockout_full",
                                            "knockout_bronze", "knockout_final")]
   == ["regular", "regular", "playoffs", "playoffs", "playoffs"])

print("\n-- Korisliiga 2026-27")
a = Offline()
reg = list(a.discover("https://tulospalvelu.basket.fi/category/4!huki2627/group/303022/fixtures",
                      {"season": "2026-27", "category": 4, "stage": "regular"}))
clubs = collections.Counter()
for g in reg:
    clubs[g.home_name] += 1
    clubs[g.away_name] += 1
ok("204 regular-season fixtures, 12 clubs with 34 games each",
   len(reg) == 204 and len(clubs) == 12 and set(clubs.values()) == {34}, (len(reg), clubs))
ok("every game keyed <season>_<fixture>, tipping off in UTC, not yet played",
   all(g.external_id.startswith(KORIS27 + "_") and g.tipoff_at.endswith("Z") and g.status == "scheduled" for g in reg))
opener = next(g for g in reg if g.extra["torneopal"] == "1005902")
ok("the row Louie pasted (match 1005902): Kataja Basket v Helsinki Seagulls at Motonet Areena, 18:30 in "
   "Joensuu = 15:30 UTC, coded KAT v SEA, with both crests",
   (opener.home_name, opener.away_name, opener.extra["venue"], opener.tipoff_at, opener.extra["home_code"],
    opener.extra["away_code"], opener.extra["home_logo"].endswith("/1395x.png"), opener.extra["away_logo"].endswith("/17103x.png"))
   == ("Kataja Basket", "Helsinki Seagulls", "Motonet Areena", "2026-09-29T15:30:00Z", "KAT", "SEA", True, True),
   (opener.home_name, opener.away_name, opener.extra, opener.tipoff_at))
local = {str(m["match_id"]): m for m in load("tp-huki2627-4.json.gz")["matches"]}
shift = collections.Counter((g.tipoff_at[:7], int(local[g.extra["torneopal"]]["time"][:2]) - int(g.tipoff_at[11:13])) for g in reg)
ok("every tip-off is its local time less the match's offset: 3 hours to late October, 2 from then on",
   {h for (m, h) in shift if m == "2026-09"} == {3}
   and {h for (m, h) in shift if m >= "2026-11"} == {2}
   and {h for (m, h) in shift if m == "2026-10"} == {2, 3}, sorted(shift.items()))
kh = [g for g in reg if "Korihait" in (g.home_name, g.away_name)]
ok("Korihait's EUI code UKI (Uusikaupunki, not the club's name) is dropped; Kipinä Basket has none",
   kh and all(g.extra["home_code" if g.home_name == "Korihait" else "away_code"] == "" for g in kh)
   and all(g.extra["home_code" if g.home_name == "Kipinä Basket" else "away_code"] == ""
           for g in reg if "Kipinä Basket" in (g.home_name, g.away_name)))
ok("read with three requests: TorneoPal's fixture list, then the EUI's two pages of the same season",
   a.asked == [("getMatches", "huki2627", 4), ("fixtures", KORIS27[:8], "RESULTS"), ("fixtures", KORIS27[:8], "FIXTURES")],
   a.asked)
ok("no play-offs published yet: the play-off row finds none",
   list(Offline().discover("", {"season": "2026-27", "category": 4, "stage": "playoffs"})) == [])
for bad, cfg in (("an unknown stage", {"season": "2026-27", "category": 4, "stage": "finals"}),
                 ("a row with no category", {"season": "2026-27", "stage": "regular"})):
    try:
        list(Offline().discover("", cfg))
        ok(bad + " is refused", False)
    except ValueError:
        ok(bad + " is refused", True)

print("\n-- Miesten I divisioona A 2026-27: fixtures TorneoPal left unlinked")
tp_a = load("tp-huki2627-2.json.gz")["matches"]
unlinked = {str(m["match_id"]) for m in tp_a if not (m.get("match_external_id") or "").strip()}
div = list(Offline().discover("", {"season": "2026-27", "category": 2, "stage": "regular"}))
ok("all 132 fixtures are listed, the %d with no link on TorneoPal included" % len(unlinked),
   len(div) == 132 and len(unlinked) == 15 and unlinked <= {g.extra["torneopal"] for g in div},
   (len(div), len(unlinked)))
ok("...each joined to a different stats fixture", len({g.external_id for g in div}) == 132)
ok("ACO Basket's OUL and Äänekosken Huima's ES2 are not codes of theirs; Karkkila has none",
   all(g.extra["home_code" if g.home_name == n else "away_code"] == ""
       for n in ("ACO Basket", "Äänekosken Huima", "Karkkila") for g in div if n in (g.home_name, g.away_name)))

M = lambda mid, a_, b_, d, fx="": {"match_id": mid, "team_A_name": a_, "team_B_name": b_, "date": d,
                                   "match_external_id": fx, "match_type": "single"}
L = lambda fx, h, a_, d: {fx: {"fixtureId": fx, "startTimeLocal": d + "T18:30:00",
                               "competitors": [{"name": h, "isHome": True}, {"name": a_, "isHome": False}]}}
listing = {**L("fx-1", "A", "B", "2026-10-10"), **L("fx-2", "A", "B", "2027-01-20"), **L("fx-3", "C", "D", "2026-11-01"),
           **L("fx-4", "C", "D", "2026-11-12"), **L("fx-5", "E", "F", "2026-12-01")}
links = F.BasketFiAdapter.link([M(1, "A", "B", "2026-10-10"), M(2, "A", "B", "2027-01-27"), M(3, "C", "D", "2026-11-06"),
                                M(4, "B", "A", "2026-10-10"), M(5, "E", "F", "2026-12-01", "fx-5")], listing)
ok("the join: same clubs and date; a game moved a week still finds its one partner; two partners in the "
   "window are left alone; the clubs must be the same way round; TorneoPal's own link wins",
   links == {"1": "fx-1", "2": "fx-2", "5": "fx-5"}, links)

print("\n-- Korisliiga 2025-26: the stages")
r26 = list(Offline().discover("", {"season": "2025-26", "category": 4, "stage": "regular"}))
p26 = list(Offline().discover("", {"season": "2025-26", "category": 4, "stage": "playoffs"}))
groups = collections.Counter(g.extra["round"] for g in r26)
ok("the regular season is 192 games: the Runkosarja's 132 and the upper and lower jatkosarja's 30 each",
   len(r26) == 192 and groups == {"Runkosarja": 132, "Ylempi jatkosarja": 30, "Alempi jatkosarja": 30}, groups)
ok("the play-offs are 43 games, all played; the 7 series rows are not among them",
   len(p26) == 43 and all(g.status == "final" and g.extra["stage"] == "playoffs" for g in p26), len(p26))
ok("no game in both", not ({g.external_id for g in r26} & {g.external_id for g in p26}))


class Dated(Offline):
    """The same season with a date written on every row, the series rows' included."""

    def _req(self, method, url, **kw):
        r = super()._req(method, url, **kw)
        if "torneopal" in url and (r or {}).get("matches"):
            r = {"matches": [dict(m, date=m["date"] or "2026-04-20", time=m["time"] or "18:30:00") for m in r["matches"]]}
        return r


dated = list(Dated().discover("", {"season": "2025-26", "category": 4, "stage": "playoffs"}))
ok("a series row is not a game even with a date on it (its 4-1 is Salon Vilpas's quarter-final, not a score)",
   len(dated) == 43 and not any(g.extra["torneopal"] in ("1002354", "1004234") for g in dated), len(dated))


def check_game(fixture, season, category, home, away, score, what, codes=None):
    print(f"\n-- {what}")
    g = Offline()
    b = g.fetch(f"{season}_{fixture}", {"season": "2026-27", "category": category})
    if not b:
        ok("the game is read", False)
        return None
    raw = b.raw
    ok("final, both clubs named as TorneoPal names them, the score the official one",
       (b.status, b.home_name, b.away_name, b.team["home"]["points"], b.team["away"]["points"]) == ("final", home, away) + score,
       (b.status, b.home_name, b.away_name, b.team["home"]["points"], b.team["away"]["points"]))
    if codes is not None:
        ok("coded %s v %s" % codes, (raw["tm"]["1"]["code"], raw["tm"]["2"]["code"]) == codes,
           (raw["tm"]["1"]["code"], raw["tm"]["2"]["code"]))
    st = load(f"game-{fixture[:8]}.json.gz")["statistics"]["data"]
    rows = {r["personId"]: r for side in ("home", "away") for r in st["statistics"]["data"]["base"][side]["persons"][0]["rows"]}
    ok("every player's points are the league's own",
       all(p["sPoints"] == (rows[pno]["statistics"].get("points") or 0) for t in ("1", "2") for pno, p in raw["tm"][t]["pl"].items()))
    ok("the players' points add up to the score",
       tuple(sum(p["sPoints"] for p in raw["tm"][t]["pl"].values()) for t in ("1", "2")) == score)
    ok("four periods of play-by-play", {e["period"] for e in raw["pbp"]} == {1, 2, 3, 4})
    dur = sum(r["duration"] for r in b.stints)
    ok("stints cover the whole game (2400 s)", abs(dur - 2400) < 1, dur)
    ok("stint points sum to the score",
       (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == score)
    ok("five a side in every stint",
       all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
    tr = translate(raw)
    tally = collections.defaultdict(collections.Counter)
    for e in tr["events"]:
        if e["pid"]:
            s, t = tally[e["pid"]], e["t"]
            if t in ("p2_made", "p3_made", "ft_made"):
                s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
            if t in ("ast", "stl", "blk", "to", "foul"):
                s[t] += 1
            if t == "reb":
                s["oreb" if e["payload"]["off"] else "dreb"] += 1
    diffs = [(p["name"], k) for i, t in enumerate("12") for pno, p in raw["tm"][t]["pl"].items()
             for k, v in (("pts", p["sPoints"]), ("ast", p["sAssists"]), ("stl", p["sSteals"]), ("blk", p["sBlocks"]),
                          ("to", p["sTurnovers"]), ("foul", p["sFoulsPersonal"]), ("oreb", p["sReboundsOffensive"]),
                          ("dreb", p["sReboundsDefensive"]))
             # a foul after a player's fifth is the bench's (translator, d5a5662a), wherever a feed lets him play on
             if tally.get(f"{i}:{pno}", {}).get(k, 0) != (min(v, 5) if k == "foul" else v)]
    ok("the event log drops nothing and every player's line equals his box",
       not tr["report"]["dropped"] and not tr["report"]["unmatched"] and not diffs, (tr["report"]["dropped"], diffs[:5]))
    return b, g, tr


b, g, tr = check_game("79e23d93-9bc7-11f1-be69-a96e4c96efc7", PREP_M, 39227, "KTP-Basket", "Helsinki Seagulls", (82, 80),
                      "KTP-Basket 82-80 Helsinki Seagulls (Korisliiga pre-season, the page Louie saved)", ("KTP", "SEA"))
ok("fetched cold, as the live lane does: TorneoPal's list for the official result, the EUI's pages for the "
   "codes, then the game's two feeds",
   [x[0] for x in g.asked] == ["getMatches", "fixtures", "fixtures", "fixture_detail", "fixture_detail"], g.asked)
dol = next(p for p in b.raw["tm"]["1"]["pl"].values() if p["name"] == "Daniel Dolenc")
ok("Daniel Dolenc's line is the page's, value by value: #21, starter, 23:02, 13 pts, 2P 3/7, 3P 2/4, FT 1/2, "
   "2+4 rebounds, 2 ast, 0 to, 1 stl, 0 blk, 1 blocked, 4 fouls, +7",
   (dol["shirtNumber"], dol["starter"], dol["sMinutes"], dol["sPoints"], dol["sTwoPointersMade"], dol["sTwoPointersAttempted"],
    dol["sThreePointersMade"], dol["sThreePointersAttempted"], dol["sFreeThrowsMade"], dol["sFreeThrowsAttempted"],
    dol["sReboundsOffensive"], dol["sReboundsDefensive"], dol["sAssists"], dol["sTurnovers"], dol["sSteals"], dol["sBlocks"],
    dol["sBlocksReceived"], dol["sFoulsPersonal"], dol["sPlusMinusPoints"])
   == ("21", 1, "23:02", 13, 3, 7, 2, 4, 1, 2, 2, 4, 2, 0, 1, 0, 1, 4, 7), dol)
by_pid = {e["pid"]: e for e in tr["events"] if e["pid"]}
styles = next(pno for pno, p in b.raw["tm"]["1"]["pl"].items() if p["name"] == "Zion Styles")
puitt = next(pno for pno, p in b.raw["tm"]["2"]["pl"].items() if p["name"] == "Timi Puittinen")
three = [e for e in tr["events"] if e["pid"] == "0:" + styles and e["t"] == "p3_made" and e["period"] == 4 and e["clock"] == 92000]
sub = [e for e in tr["events"] if e["t"] == "sub" and e["payload"].get("in") == "1:" + puitt and e["period"] == 4 and e["clock"] == 149000]
ok("the pasted play-by-play: #10 Zion Styles' three made at P4 01:32, and #30 Timi Puittinen switching in at P4 02:29",
   len(three) == 1 and len(sub) == 1, (three, sub))
before = [e for e in b.raw["pbp"] if e["actionNumber"] < next(x["actionNumber"] for x in b.raw["pbp"]
          if x.get("pno") == styles and x["actionType"] == "3pt" and x["period"] == 4 and x["gt"] == "1:32")]
pts = [0, 0]
for e in before + [x for x in b.raw["pbp"] if x.get("pno") == styles and x["actionType"] == "3pt" and x["gt"] == "1:32"]:
    if e.get("success") == 1 and e["actionType"] in ("2pt", "3pt", "freethrow"):
        pts[e["tno"] - 1] += {"2pt": 2, "3pt": 3, "freethrow": 1}[e["actionType"]]
ok("...and the score after that three is the page's 80-75", pts == [80, 75], pts)



def fx_of(match_id, category):
    """A pre-season game's EUI fixture id, by its TorneoPal match id."""
    return next(m["match_external_id"] for m in load(f"tp-huki2627-{category}.json.gz")["matches"]
                if str(m["match_id"]) == str(match_id))


jba, _, jtr = check_game(fx_of(1006630, 39227), PREP_M, 39227, "Jyväskylä Basketball Academy", "Kataja Basket", (65, 101),
                         "Jyväskylä Basketball Academy 65-101 Kataja Basket (Korisliiga pre-season, a blowout)")
sm = next(pno for pno, p in jba.raw["tm"]["1"]["pl"].items() if p["name"] == "Santeri Manninen")
ok("Santeri Manninen's box has six fouls (a pre-season game let him play on); the log takes him off after "
   "his fifth and files the sixth as the bench's, as it does in every league",
   jba.raw["tm"]["1"]["pl"][sm]["sFoulsPersonal"] == 6
   and ("0:" + sm) in [f[0] for f in jtr["report"]["fouled_out"]]
   and any(e["t"] == "foul" and e["pid"] is None and e["team"] == 0 and e["period"] == 3 and e["clock"] == 70000
           for e in jtr["events"]), jtr["report"]["fouled_out"])
check_game(fx_of(1006586, 39227), PREP_M, 39227, "Karkkila", "Ura Basket", (89, 73),
           "Karkkila 89-73 Ura Basket (I divisioona A pre-season)")
check_game(fx_of(1006600, 39227), PREP_M, 39227, "Raiders Basket", "Team Pajulahti", (108, 79),
           "Raiders Basket 108-79 Team Pajulahti (I divisioona B pre-season)")
# Espoo Basket Team plays uncoded here: in the pre-season listing its second team wears EBT too, and one code
# for two clubs would make them one club
check_game(fx_of(1015641, 42825), PREP_W, 42825, "Espoo Basket Team", "BC Nokia", (77, 67),
           "Espoo Basket Team 77-67 BC Nokia (Naisten Korisliiga pre-season)", ("", "NOK"))

print("\n-- the official result wins: Leppävaaran Pyrintö v Puhuttaret, 4 Sep 2026")
held = Offline()
fx = fx_of(1006642, 42825)
ok("the stats feed stops at 63-63 with no overtime while TorneoPal has 64-63 after it: held, not filed as a draw",
   held.fetch(f"{PREP_W}_{fx}", {"season": "2026-27", "category": 42825}) is None)
free = Offline()
ok("...and with no official result to hold it to (a row with no category), the feed's own final is read",
   free.fetch(f"{PREP_W}_{fx}", {}) is not None)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
