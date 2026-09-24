"""The ABA League, ABA League 2 and the ABA U19 league (adapters/aba.py), offline, over captured aba-liga.com pages:

    python scripts/ingest/aba_test.py

What it holds the adapter to:
  * the schedule: one site, three leagues told apart by a number and a host (ABA on www, ABA 2 on druga,
    the U19 on www's calendar-u19). ABA 2026-27 is 180 games in two groups of ten, every club coded and
    crested, tip-offs Central European -> UTC across the clock change, a date with no time held as TBC;
  * the stages: ABA 2025-26's regular season is its 144 group games plus the 82 of its second phase
    ("Top8", "Play-out"); its play-offs are the 22 from the play-in to Finals, Round 4. The U19's
    classification games and places are play-offs. Groups ride on regular-season games only;
  * the vetting games: Louie's saved page (Igokea m:tel 92-88 FMP) and five captured games (an overtime
    game, the Finals' fourth game, a second-phase game, the ABA 2 final and the U19 final) through the
    whole game path. Every box is the league's own, every player's line equals his tally in the event
    log, stints cover the game five a side and sum to the score, and the shots sit on their actions.
    The box row Louie pasted (Nighael Ceaser) is checked value by value, and so are his two pasted
    play-by-play lines;
  * the names: the box prints "Jovanović Đ.", so a full name comes from the shot feed, the leader
    tables or, for the few who did neither, the player's own page, asked once.

Fixtures live in scripts/ingest/data/aba/ (captured 2026-09-24, scripts and styles stripped; each page reads
the same as the original, which the capture script checked).
"""
import collections
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import REGISTRY  # noqa: E402
from adapters import aba as A  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter, shot_dist_to_nearest_rim  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "aba")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def gz(name):
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        return f.read()


PLAYER_PAGES = json.loads(gz("players.json.gz"))


class Reply:
    def __init__(self, t):
        self.text = t


class Offline(A.AbaAdapter):
    """Answers aba-liga.com from the captured pages."""
    min_request_gap_s = 0

    def __init__(self):
        super().__init__()
        self.asked = []

    def _get(self, url, **kw):
        p = kw.get("params") or {}
        host, path = re.match(r"https://([a-z]+)\.aba-liga\.com(/.*)", url).groups()
        self.asked.append((host, path.split("/")[1]))
        m = re.fullmatch(r"/(calendar(?:-u19)?)/(\d+)/(\d+)/", path)
        if m:
            name = f"cal-{m.group(1)}-{m.group(2)}-{m.group(3)}.html.gz"
            return Reply(gz(name)) if os.path.exists(os.path.join(DATA, name)) else None
        m = re.fullmatch(r"/match/(\d+)/(\d+)/(\d+)/", path)
        if m:
            name = f"game-{m.group(3)}-{m.group(2)}-{m.group(1)}.html.gz"
            return Reply(gz(name)) if os.path.exists(os.path.join(DATA, name)) else None
        if path == A.SHOTS:
            name = f"shots-{p['lea']}-{p['sez']}-{p['id']}.json"
            with open(os.path.join(DATA, name), encoding="utf-8") as f:
                return Reply(f.read())
        m = re.fullmatch(r"/player/(\d+)/\d+/\d+/[^/]+/", path)
        if m and m.group(1) in PLAYER_PAGES:
            return Reply(PLAYER_PAGES[m.group(1)])
        return None


FibaLiveStatsAdapter._pipeline = False          # the in-repo stint builder, as on the Actions runner
FibaLiveStatsAdapter._pipeline_warned = True

print("-- registration")
ok("aba is registered and is a LiveStats-family adapter (so the live lane covers it)",
   REGISTRY.get("aba") is A.AbaAdapter and issubclass(A.AbaAdapter, FibaLiveStatsAdapter))
with open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8") as f:
    rows = [r for r in json.load(f)["sources"] if r.get("adapter") == "aba"]
ok("six rows: a regular season and a play-off row for each of league 1, 2 and 7, all men's, all filed "
   "under the Balkans (XB)",
   sorted((r["code"], r["adapter_config"]["league"], r["adapter_config"]["stage"]) for r in rows)
   == [("ABA", 1, "playoffs"), ("ABA", 1, "regular"), ("ABA2", 2, "playoffs"), ("ABA2", 2, "regular"),
       ("ABAU19", 7, "playoffs"), ("ABAU19", 7, "regular")]
   and all(r["league_country"] == "XB" and r["league_gender"] == "men" for r in rows),
   [(r["code"], r["adapter_config"]) for r in rows])
ok("groups from the feed on the regular rows only; each play-off row is its league's play-off competition",
   all(bool(r["adapter_config"].get("groups_from_feed")) == (r["adapter_config"]["stage"] == "regular") for r in rows)
   and all(r.get("competition_kind") == "playoff" and r["competition_label"] == r["league_name"] + " Playoffs"
           for r in rows if r["adapter_config"]["stage"] == "playoffs"))

print("\n-- the pieces")
ok("the season number is the start year less 2000 (or the row's own)",
   (A.season_number({"season": "2026-27"}), A.season_number({"season": "2025-26"}), A.season_number({"aba_season": 24}))
   == (26, 25, 24))
ok("the play-offs by their own words; rounds, weeks and a second league phase are the regular season",
   [A.stage_of(h) for h in ("ROUND 1", "WEEK 16", "Top8 - R1", "Play-out - R10", "Play-in R1", "Quarter-finals, Round 1",
                            "Quarter-Finals Round 3", "Semi-finals", "Finals, Round 4", "Final",
                            "Classification for 5-8", "For 7th place", "For 3rd place")]
   == ["regular"] * 4 + ["playoffs"] * 9)
ok("a group from the calendar's own column, in either form",
   [A.group_of(c) for c in ("A", "Round 3, Group B", " ", "<span>C</span>", "Top8")] == ["Group A", "Group B", "", "Group C", ""])
ok("tip-offs: Central European time to UTC, summer and winter, a date with no time as noon and TBC",
   [A.tipoff("Friday, 25.09.2026 18:00 CET"), A.tipoff("Saturday, 17.01.2026 20:00 CET"),
    A.tipoff("Wednesday, 29.04.2026 19:00 Local time"), A.tipoff("Sunday, 04.10.2026"), A.tipoff("TBA")]
   == [("2026-09-25T16:00:00Z", False), ("2026-01-17T19:00:00Z", False), ("2026-04-29T17:00:00Z", False),
       ("2026-10-04T12:00:00Z", True), (None, False)])
ok("the play-by-play's words are FIBA's: the bracket is the subType with its spaces gone",
   [A.classify("made 3 points", "jump shot"), A.classify("missed 2 points", "tip inlayup"),
    A.classify("made free throw", "1 of 2"), A.classify("substitution", "in"), A.classify("foul on", ""),
    A.classify("turnover", "bad pass"), A.classify("rebound", "offensive"), A.classify("waved", "")]
   == [("3pt", "jumpshot", 1), ("2pt", "tipinlayup", 0), ("freethrow", "1of2", 1), ("substitution", "in", None),
       ("foulon", "", None), ("turnover", "badpass", None), ("rebound", "offensive", None), (None, "", None)])
ok("a club name as a join key: no accents, no case, no club-form prefix",
   (A.fold("KK Borac WWIN"), A.fold("Budućnost VOLI"), A.fold("HKK Široki TT Kabeli"))
   == ("borac wwin", "buducnost voli", "siroki tt kabeli"))
menu = {A.fold(n): i for i, n in ((88, "Gorenjska gradbena družba Šenčur"), (68, "Cedevita Olimpija Ljubljana U19"),
                                  (69, "Cedevita Olimpija"), (5, "Partizan Mozzart Bet"))}
ok("a calendar name finds its crest by the same name, or by initials / a word left out of the menu's longer one",
   [A.club_id_for(n, menu) for n in ("GGD Šenčur", "Cedevita Olimpija U19", "Cedevita Olimpija", "Partizan Mozzart Bet", "Crvena zvezda")]
   == [88, 68, 69, 5, None])
ok("a full name split on the box's family name, whatever the accents; a given name of several words kept",
   [A.split_name("Kevin Duane Ferrell Jr", "Ferrell Jr"), A.split_name("Uros Banjac", "Banjac"),
    A.split_name("Đorđije Jovanović", "Jovanović"), A.split_name("Karel Guzman Abreu", "Guzman Abreu"),
    A.split_name("Jalen Smith", "Smyth"), A.split_name("Banjac", "Banjac")]
   == [("Kevin Duane", "Ferrell Jr"), ("Uros", "Banjac"), ("Đorđije", "Jovanović"), ("Karel", "Guzman Abreu"),
       ("Jalen", "Smith"), ("", "Banjac")])
ok("a player's own page: the heading, else the title",
   (A.player_page_name('<h1 class="main_title">\n\tUroš Banjac\t\t</h1>'),
    A.player_page_name("<title>Uroš Banjac &gt; Player : ABA League</title>"), A.player_page_name("<p>nothing</p>"))
   == ("Uroš Banjac", "Uroš Banjac", ""))

print("\n-- ABA League 2026-27")
a = Offline()
reg = list(a.discover("https://www.aba-liga.com/calendar/", {"league": 1, "season": "2026-27", "stage": "regular"}))
clubs = collections.Counter()
for g in reg:
    clubs[g.home_name] += 1
    clubs[g.away_name] += 1
ok("180 regular-season fixtures, 20 clubs with 18 games each", len(reg) == 180 and len(clubs) == 20
   and set(clubs.values()) == {18}, (len(reg), clubs))
ok("read with one request, the main host's calendar for season 26 of league 1", a.asked == [("www", "calendar")], a.asked)
ok("every game keyed <league>-<season>-<id>, in UTC, not yet played",
   all(re.fullmatch(r"1-26-\d+", g.external_id) and g.tipoff_at.endswith("Z") and g.status == "scheduled" for g in reg))
ok("two groups of ten, on both sides of every fixture",
   collections.Counter(g.extra["home_group"] for g in reg) == {"Group A": 90, "Group B": 90}
   and all(g.extra["home_group"] == g.extra["away_group"] for g in reg))
ok("every club coded and crested", all(g.extra["home_code"] and g.extra["away_code"] and g.extra.get("home_logo")
                                       and g.extra.get("away_logo") for g in reg))
first = reg[0]
ok("the opener: Budućnost VOLI v Cibona, 25 Sep 18:00 CET = 16:00 UTC, BUD v CIB with crests 12 and 2, Group A",
   (first.external_id, first.home_name, first.away_name, first.tipoff_at, first.extra["home_code"], first.extra["away_code"],
    first.extra["home_logo"], first.extra["away_logo"], first.extra["round"])
   == ("1-26-2", "Budućnost VOLI", "Cibona", "2026-09-25T16:00:00Z", "BUD", "CIB",
       A.LOGO.format(12), A.LOGO.format(2), "ROUND 1"), (first.external_id, first.extra, first.tipoff_at))
dub = next(g for g in reg if g.external_id == "1-26-7")
ok("Dubai Basketball's home games are printed on the league's clock: 16:00 on 27 Sep is 14:00 UTC",
   (dub.home_name, dub.away_name, dub.tipoff_at, dub.extra["home_code"]) == ("Dubai Basketball", "Vienna", "2026-09-27T14:00:00Z", "DUB"))
tbc = [g for g in reg if g.extra.get("time_tbc")]
ok("136 fixtures with a date and no time yet are held at noon UTC as TBC",
   len(tbc) == 136 and all(g.tipoff_at.endswith("T12:00:00Z") for g in tbc), len(tbc))
ok("no play-offs published yet: the play-off row finds none",
   list(Offline().discover("", {"league": 1, "season": "2026-27", "stage": "playoffs"})) == [])
for bad, cfg in (("an unknown stage", {"league": 1, "season": "2026-27", "stage": "finals"}),
                 ("a row with no league number", {"season": "2026-27", "stage": "regular"})):
    try:
        list(Offline().discover("", cfg))
        ok(bad + " is refused", False)
    except ValueError:
        ok(bad + " is refused", True)

print("\n-- ABA League 2025-26: the stages")
r25 = list(Offline().discover("", {"league": 1, "season": "2025-26", "stage": "regular"}))
p25 = list(Offline().discover("", {"league": 1, "season": "2025-26", "stage": "playoffs"}))
phase = collections.Counter("second phase" if re.match(r"Top8|Play-out", g.extra["round"]) else "groups" for g in r25)
ok("the regular season is 226 games, all played: 144 in the two groups and 82 in the Top8 and Play-out",
   len(r25) == 226 and phase == {"groups": 144, "second phase": 82} and all(g.status == "final" for g in r25), phase)
ok("...the groups ride on the first phase's games only",
   all(bool(g.extra.get("home_group")) == (not re.match(r"Top8|Play-out", g.extra["round"])) for g in r25))
ok("the play-offs are 22 games from the play-in to Finals, Round 4, all played, with no group",
   len(p25) == 22 and p25[0].extra["round"] == "Play-in R1" and p25[-1].extra["round"] == "Finals, Round 4"
   and all(g.status == "final" and g.extra["stage"] == "playoffs" and "home_group" not in g.extra for g in p25),
   [g.extra["round"] for g in p25])
ok("no game in both", not ({g.external_id for g in r25} & {g.external_id for g in p25}))
opener = next(g for g in r25 if g.external_id == "1-25-3")
ok("the game Louie linked (match 3): Igokea m:tel v FMP, 3 Oct 2025 18:30 CET = 16:30 UTC, IGO v FMP, final",
   (opener.home_name, opener.away_name, opener.tipoff_at, opener.extra["home_code"], opener.extra["away_code"], opener.status)
   == ("Igokea m:tel", "FMP", "2025-10-03T16:30:00Z", "IGO", "FMP", "final"))

print("\n-- ABA League 2 and the U19 league")
a2 = Offline()
d26 = list(a2.discover("https://druga.aba-liga.com/calendar/", {"league": 2, "season": "2026-27", "stage": "regular"}))
ok("ABA 2 is read from its own host", a2.asked == [("druga", "calendar")], a2.asked)
ok("ABA 2 2026-27: the 50 fixtures published so far, 16 clubs in groups A to D, every club coded and crested",
   len(d26) == 50 and len({g.home_name for g in d26} | {g.away_name for g in d26}) == 16
   and {g.extra["home_group"] for g in d26} == {"Group A", "Group B", "Group C", "Group D"}
   and all(g.extra["home_code"] and g.extra.get("home_logo") and g.extra.get("away_logo") for g in d26))
sen = next(g for g in d26 if g.external_id == "2-26-4")
ok("GGD Šenčur finds its crest through the menu's Gorenjska gradbena družba Šenčur (88)",
   (sen.away_name, sen.extra["away_code"], sen.extra["away_logo"]) == ("GGD Šenčur", "SEN", A.LOGO.format(88)), sen.extra)
a7 = Offline()
ok("the U19 2026-27 calendar is not published yet: nothing, from www's calendar-u19",
   list(a7.discover("", {"league": 7, "season": "2026-27", "stage": "regular"})) == [] and a7.asked == [("www", "calendar-u19")])
u25 = list(Offline().discover("", {"league": 7, "season": "2025-26", "stage": "regular"}))
u25p = list(Offline().discover("", {"league": 7, "season": "2025-26", "stage": "playoffs"}))
ok("the U19 2025-26: four groups of four, 6 games each, then 12 play-off games with the classification and "
   "place games among them",
   collections.Counter(g.extra["home_group"] for g in u25) == {"Group A": 6, "Group B": 6, "Group C": 6, "Group D": 6}
   and len(u25p) == 12 and {"Classification for 5-8", "For 7th place", "For 3rd place", "Final"} <= {g.extra["round"] for g in u25p},
   [g.extra["round"] for g in u25p])
ok("Cedevita Olimpija U19 finds its crest (68), not the senior club's",
   next(g for g in u25p if g.home_name == "Cedevita Olimpija U19").extra["home_logo"] == A.LOGO.format(68))


class Grouped(Offline):
    """The same calendars with a group written into every empty group cell, the play-offs' included."""

    def _get(self, url, **kw):
        r = super()._get(url, **kw)
        if r is not None and "/calendar" in url:
            r = Reply(re.sub(r"<td>\s*</td>\s*</tr>", "<td>A</td></tr>", r.text))
        return r


gp = list(Grouped().discover("", {"league": 7, "season": "2025-26", "stage": "playoffs"}))
ok("a group is never put on a play-off game, even where the calendar writes one",
   len(gp) == 12 and not any("home_group" in g.extra or "away_group" in g.extra for g in gp), [g.extra for g in gp[:2]])
shared = A.AbaAdapter._shared_codes([{"home": "Split", "away": "Spartak", "home_code": "SPL", "away_code": "SPA"},
                                     {"home": "Split U19", "away": "Spartak", "home_code": "SPL", "away_code": "SPA"}])
ok("a code two clubs of one calendar wear keys neither (a club is found by its code)", shared == {"SPL"}, shared)


def check_game(key, home, away, score, what, codes, periods=4):
    print(f"\n-- {what}")
    A.NAMES.clear()
    g = Offline()
    b = g.fetch(key, {"season": "2025-26"})
    if not b:
        ok("the game is read", False)
        return None, g, None
    raw = b.raw
    ok("final, both clubs named as the page names them, the score the official one, coded %s v %s" % codes,
       (b.status, b.home_name, b.away_name, b.team["home"]["points"], b.team["away"]["points"],
        raw["tm"]["1"]["code"], raw["tm"]["2"]["code"]) == ("final", home, away) + score + codes,
       (b.status, b.home_name, b.away_name, b.team["home"]["points"], b.team["away"]["points"], raw["tm"]["1"]["code"], raw["tm"]["2"]["code"]))
    ok("the players' points add up to the score",
       tuple(sum(p["sPoints"] for p in raw["tm"][t]["pl"].values()) for t in ("1", "2")) == score)
    ok("every play-by-play line understood", raw["aba"]["unknown"] == [], raw["aba"]["unknown"])
    got = sorted({(e["periodType"], e["period"]) for e in raw["pbp"]})
    ok(f"{periods} periods of play-by-play, each opened and closed, the game closed",
       len(got) == periods and sum(1 for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start") == periods
       and sum(1 for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end") == periods
       and raw["pbp"][-1]["actionType"] == "game" and [e["actionNumber"] for e in raw["pbp"]] == list(range(1, len(raw["pbp"]) + 1)), got)
    want = 2400 + 300 * (periods - 4)
    dur = sum(r["duration"] for r in b.stints)
    ok(f"stints cover the whole game ({want} s)", abs(dur - want) < 1, dur)
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
             if tally.get(f"{i}:{pno}", {}).get(k, 0) != (min(v, 5) if k == "foul" else v)]
    ok("the event log drops nothing and every player's line equals his box",
       not tr["report"]["dropped"] and not tr["report"]["unmatched"] and not diffs, (tr["report"]["dropped"], diffs[:5]))
    bare = [text for _, rows in A.period_tables(gz(f"game-{key}.html.gz")) for cells in rows for text in map(A.text, (cells[0], cells[2]))
            if text.strip("() ").lower() in ("offensive", "defensive")]
    team_reb = [e for e in raw["pbp"] if e["actionType"] == "rebound" and not e["pno"]]
    # (a player's "turnover (offensive)" is an offensive foul, FIBA's own subType; only the bare line is the club's rebound)
    ok("each bare (offensive) / (defensive) line is the club's own rebound (%d of them)" % len(bare),
       len(team_reb) == len(bare) > 0 and all(e["subType"] in ("offensive", "defensive") for e in team_reb),
       (len(bare), len(team_reb)))
    ok("every player named in full, the family name the box's own",
       all(p["firstName"] and p["familyName"] for t in "12" for p in raw["tm"][t]["pl"].values()),
       [p["name"] for t in "12" for p in raw["tm"][t]["pl"].values() if not p["firstName"]])
    shots = [s for t in "12" for s in raw["tm"][t]["shot"]]
    with open(os.path.join(DATA, f"shots-{key}.json"), encoding="utf-8") as f:
        chart = collections.Counter((int(s["ekipa"]), str(s["player_id"]), int(s["koordinata_uspeh"])) for s in json.load(f))
    fga = collections.Counter((e["tno"], e["pno"], e["success"]) for e in raw["pbp"] if e["actionType"] in ("2pt", "3pt"))
    wrong = [s for s in shots if (shot_dist_to_nearest_rim(s["x"], s["y"]) > 6.75) != (s["actionType"] == "3pt")]
    ok("the shot chart joined to the play-by-play: every charted shot of a player and result finds one of his "
       "(the chart's extras, a shot with no player or one more than the box, are left out), each on its own "
       "action, and at most two on the wrong side of the arc for their type (the league's own spots)",
       raw["aba"]["shots_joined"] == sum(min(n, fga[k]) for k, n in chart.items()) == len(shots) and len(wrong) <= 2
       and sum(fga.values()) == sum(p["sFieldGoalsAttempted"] for t in "12" for p in raw["tm"][t]["pl"].values())
       and all(any(e["actionNumber"] == s["actionNumber"] and e["pno"] == s["pno"] and e["success"] == s["r"] for e in raw["pbp"]) for s in shots),
       (raw["aba"]["shots"], raw["aba"]["shots_joined"], len(wrong)))
    return b, g, tr


b, g, tr = check_game("1-25-3", "Igokea m:tel", "FMP", (92, 88), "Igokea m:tel 92-88 FMP (the page Louie saved)", ("IGO", "FMP"))
raw = b.raw
ok("fetched cold, as the live lane does: the game page, its shot chart, the four players nobody printed in "
   "full, then the calendar for the clubs' codes",
   g.asked == [("www", "match"), ("www", "live-match")] + [("www", "player")] * 4 + [("www", "calendar")], g.asked)
ok("tipping off at 18:30 CET = 16:30 UTC, at J.U. Sportska dvorana Laktaši before 700",
   (b.tipoff_at, raw["aba"]["venue"], raw["aba"]["attendance"]) == ("2025-10-03T16:30:00Z", "J.U. Sportska dvorana Laktaši", 700),
   (b.tipoff_at, raw["aba"]["venue"], raw["aba"]["attendance"]))
ces = raw["tm"]["1"]["pl"]["5094"]
ok("Nighael Ceaser's row is the page's, value by value: #0, 20:19, 15 pts, 2P 6/9, 3P 0/0, FT 3/3, 0+4 rebounds, "
   "2 ast, 0 stl, 0 to, 1 blk, 1 blocked, 4 fouls, 4 drawn, 12 in the paint, 3 second-chance, 0 fast-break, +3",
   (ces["name"], ces["shirtNumber"], ces["sMinutes"], ces["sPoints"], ces["sTwoPointersMade"], ces["sTwoPointersAttempted"],
    ces["sThreePointersMade"], ces["sThreePointersAttempted"], ces["sFreeThrowsMade"], ces["sFreeThrowsAttempted"],
    ces["sReboundsDefensive"], ces["sReboundsOffensive"], ces["sReboundsTotal"], ces["sAssists"], ces["sSteals"],
    ces["sTurnovers"], ces["sBlocks"], ces["sBlocksReceived"], ces["sFoulsPersonal"], ces["sFoulsOn"],
    ces["sPointsInThePaint"], ces["sPointsSecondChance"], ces["sPointsFastBreak"], ces["sPlusMinusPoints"])
   == ("Nighael Ceaser", "0", "20:19", 15, 6, 9, 0, 0, 3, 3, 0, 4, 4, 2, 0, 0, 1, 1, 4, 4, 12, 3, 0, 3), ces)
barna = [e for e in raw["pbp"] if e["pno"] == "3675" and e["actionType"] == "3pt"]
ok("Louie's pasted scoring line: FMP's #88 Filip Barna, made 3 points (jump shot) at 00:36, 26 : 20 after it",
   any(e["gt"] == "00:36" and e["period"] == 1 and e["subType"] == "jumpshot" and e["success"] == 1 and (e["s1"], e["s2"]) == ("26", "20")
       and e["tno"] == 2 and e["shirtNumber"] == "88" for e in barna) and raw["tm"]["2"]["pl"]["3675"]["name"] == "Filip Barna",
   [(e["period"], e["gt"], e["s1"], e["s2"]) for e in barna])
ok("...and his substitution line: #14 Nikola Gašić in at 01:16",
   any(e["pno"] == "4776" and e["actionType"] == "substitution" and e["subType"] == "in" and e["gt"] == "01:16" and e["period"] == 1
       and e["shirtNumber"] == "14" for e in raw["pbp"]) and raw["tm"]["2"]["pl"]["4776"]["name"] == "Nikola Gašić")
ok("Jakov Mustapić took no shot and led nothing: his name is his own page's",
   (raw["tm"]["1"]["pl"]["2151"]["firstName"], raw["tm"]["1"]["pl"]["2151"]["familyName"]) == ("Jakov", "Mustapić"))

b6, g6, _ = check_game("1-25-6", "Budućnost VOLI", "Spartak Office Shoes", (93, 97),
                       "Budućnost VOLI 93-97 Spartak Office Shoes (an overtime game)", ("BUD", "SPA"), periods=5)
if b6:
    ok("Uroš Banjac's accents come from his own page, not his link's uros-banjac",
       b6.raw["tm"]["2"]["pl"]["3892"]["name"] == "Uroš Banjac", b6.raw["tm"]["2"]["pl"]["3892"]["name"])
    again = Offline()
    b6b = again.fetch("1-25-6", {"season": "2025-26"})
    ok("fetched again in the same process (the live lane's next poll): no player page asked, and still Uroš Banjac",
       ("www", "player") not in again.asked and b6b.raw["tm"]["2"]["pl"]["3892"]["name"] == "Uroš Banjac",
       (again.asked, b6b.raw["tm"]["2"]["pl"]["3892"]["name"]))
    ok("Kevin Duane Ferrell Jr: two given names, a suffixed family name",
       (b6.raw["tm"]["1"]["pl"]["4104"]["firstName"], b6.raw["tm"]["1"]["pl"]["4104"]["familyName"]) == ("Kevin Duane", "Ferrell Jr"))
    ok("the overtime is period 1 of type OVERTIME, five minutes long",
       {(e["periodType"], e["period"]) for e in b6.raw["pbp"]} >= {("OVERTIME", 1)} and b6.raw["tm"]["1"]["ot_score"] > 0)
check_game("1-25-251", "Partizan Mozzart Bet", "Dubai Basketball", (81, 83),
           "Partizan Mozzart Bet 81-83 Dubai Basketball (Finals, Round 4)", ("PAR", "DUB"))
check_game("1-25-170", "Budućnost VOLI", "U-BT Cluj-Napoca", (94, 89),
           "Budućnost VOLI 94-89 U-BT Cluj-Napoca (the second phase, Top8 - R3)", ("BUD", "CLU"))
b2, _, _ = check_game("2-25-84", "TFT Skopje", "HKK Široki TT Kabeli", (86, 87),
                      "TFT Skopje 86-87 HKK Široki TT Kabeli (the ABA 2 final, Round 2)", ("TFT", "SIR"))
if b2:
    mc = b2.raw["tm"]["2"]["pl"]["5200"]
    ok("the family name is the box's McCreary, not the play-by-play's MCCREARY title-cased",
       mc["familyName"] == "McCreary", (mc["firstName"], mc["familyName"]))
check_game("7-25-36", "Mega Superbet U19", "Crvena zvezda U19", (120, 78),
           "Mega Superbet U19 120-78 Crvena zvezda U19 (the U19 final)", ("MEG", "CZV"))

print("\n-- a game with nothing in it yet")
page = gz("game-1-25-3.html.gz")
ok("the header alone (no box, no play-by-play) is no game", A.raw_from_page(page[:page.find('id="matchTabs"')], []) is None)
ok("a page with no clubs is no game", A.raw_from_page("<html></html>", []) is None)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
