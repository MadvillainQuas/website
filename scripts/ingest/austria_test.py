"""Austria's three leagues (adapters/austria.py), offline, over captured replies from basketballaustria.at's Sportradar embed:

    python scripts/ingest/austria_test.py

What it holds the adapter to:
  * the rows: source codes ATBSL, ATB2L, ATBDSL, a regular-season row and a play-off row each, on websites 260,
    262 and 261, country AT, the tiers, the flag;
  * the schedule: each league's season found by its competition id and start year on its own website, read whole
    (2026-27: BSL 110 games, 11 clubs x 20; B2L 154, 15 clubs; BDSL 84, 8 clubs x 21), keyed
    "<season>_<fixture>", tip-offs in UTC; the BDSL National League (another competition on 261) never read;
  * the stages, which fixtureType does not tell apart (REGULAR on every game, the final too): by the game's name
    code in 2025-26 (BSL 160 + 27, B2L 176 + 19 with the relegation series, BDSL 63 + 7), by name where a
    2024-25 play-off game has no stageCode (BSL 160 + 24), by the stage tab where a 2021-22 game has no name
    (BSL 132 + 30, the play-down with the play-offs);
  * four games, every player's line the league's own box, the score, the play-by-play's points the final score,
    stints covering the game five a side, overtime numbered 5 and 6, defensive rebounds where the BSL's website
    publishes none, and every player's MINUTES replayed from the translated substitutions equal to the box
    score's, with no substitution unpaired;
  * a 2019-20 game the embed kept no plays for: a result and a box, not a log.

Fixtures live in scripts/ingest/data/austria/ (captured 2026-10-15, links, images and the advanced box cut).
"""
import base64
import collections
import gzip
import json
import os
import re
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from adapters import REGISTRY  # noqa: E402
from adapters import austria as A  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "austria")
BSL26, BSL25, BSL24, BSL21, BSL19 = ("f59fdb0e-78b7-11f1-a992-0ddfca35eb80", "04d11475-5cee-11f0-868a-ef8300e5eae7",
                                     "62f45dd6-5bcc-11ef-b10a-3130a1b1aa48", "7fa37df2-154b-11ec-9c26-96f461542acb",
                                     "d3b20e2a-d3d7-11e9-972c-b24257e70dcc")
B2L26, BDSL26 = "8a06b595-8689-11f1-b3de-d7d055a7109f", "0019ffe8-8746-11f1-82a8-ad91fd7375a8"
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


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


class Offline(A.AustriaAdapter):
    """Answers every EUI request from the captured files, keyed on the website and the decoded state blob."""

    def __init__(self):
        super().__init__()
        self.asked = []

    def _req(self, method, url, **kw):
        s = kw["params"]["state"]
        st = json.loads(zlib.decompress(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))))
        site, page = url.rsplit("/", 2)[-2:]
        self.asked.append((site, page, st))
        if page == "fixtures":
            if "s" not in st:
                return load(f"listing-{site}.json.gz")
            name = f"fixtures-{st['s'][:8]}-{st['z'].lower()}.json.gz"
            return load(name) if os.path.exists(os.path.join(DATA, name)) else {"data": {}}
        name = f"game-{st['f'][:8]}.json.gz"
        return load(name)[st["z"]] if os.path.exists(os.path.join(DATA, name)) else None


def discover(league, season, stage="regular"):
    a = Offline()
    return a, list(a.discover("", {"league": league, "season": season, "stage": stage}))


FibaLiveStatsAdapter._pipeline = False          # the in-repo stint builder, as on the Actions runner
FibaLiveStatsAdapter._pipeline_warned = True

# ============================================================================ the rows
print("-- registration and the source rows")
ok("austria is registered and reads the embed in de-AT",
   REGISTRY.get("austria") is A.AustriaAdapter and A.AustriaAdapter.locale == "de-AT")
reg = json.loads(read(ROOT, "config", "ingest-sources.json"))
want = {"ATBSL": ("bsl", "basketball-superliga", "men"), "ATB2L": ("b2l", "basketball-zweite-liga", "men"),
        "ATBDSL": ("bdsl", "damen-superliga", "women")}
for code, (league, slug, gender) in want.items():
    rows = [s for s in reg["sources"] if s.get("code") == code]
    stages = sorted((r.get("adapter_config") or {}).get("stage") for r in rows)
    ok(f"{code}: a regular-season row and a play-off row, adapter austria, league {league}",
       stages == ["playoffs", "regular"] and all(r.get("adapter") == "austria" and r["adapter_config"].get("league") == league
                                                 and r["adapter_config"].get("code") == code for r in rows), rows)
    ok(f"{code}: country AT, slug {slug}, {gender}, created on first sight",
       all(r.get("league_country") == "AT" and r.get("league_slug") == slug and r.get("league_gender") == gender
           and r.get("create_league") and r["adapter_config"].get("auto_create") and r["adapter_config"].get("store_pbp") is False
           for r in rows), [(r.get("league_country"), r.get("league_slug"), r.get("league_gender")) for r in rows])
    ok(f"{code}: the play-off row is its own competition",
       any(r.get("competition_kind") == "playoff" and r["adapter_config"]["stage"] == "playoffs" for r in rows))
tiers = read(ROOT, "epinoia", "config.js")
ok("tiers: Superliga 1 men, Zweite Liga 2 men, Damen Superliga 1 women",
   re.search(r"/\* Austria \*/ 'basketball-superliga': \[1, 'm'\], 'basketball-zweite-liga': \[2, 'm'\], "
             r"'damen-superliga': \[1, 'w'\]", tiers) is not None)
ok("brand/flags/at.svg: red, white, red", "#c8102e" in read(ROOT, "epinoia", "brand", "flags", "at.svg"))
for rel in ("epinoia/country.js", "epinoia/nav.js"):
    m = re.search(r"HAVE_FLAG = \[([^\]]*)\]", read(ROOT, *rel.split("/")))
    ok(f"AT in HAVE_FLAG, in order ({rel})", m is not None and "'AT'" in m.group(1)
       and re.findall(r"'([A-Z]{2})'", m.group(1)) == sorted(re.findall(r"'([A-Z]{2})'", m.group(1))))

# ============================================================================ the schedule
print("\n-- 2026-27: each league on its own website, by its competition id")
a, bsl = discover("bsl", "2026-27")
ok("BSL: 110 regular-season games, 20 played, 90 to come",
   (len(bsl), sum(g.status == "final" for g in bsl), sum(g.status == "scheduled" for g in bsl)) == (110, 20, 90),
   (len(bsl), collections.Counter(g.status for g in bsl)))
clubs = collections.Counter()
for g in bsl:
    clubs.update([g.home_name, g.away_name])
ok("...11 clubs, 20 games each", len(clubs) == 11 and set(clubs.values()) == {20}, clubs)
ok("...read with three requests on website 260: the season list, then the season's results and fixtures",
   [(site, st.get("z")) for site, _, st in a.asked] == [("260", None), ("260", "RESULTS"), ("260", "FIXTURES")], a.asked)
ok("...every game keyed <season>_<fixture>, both clubs coded, tip-off in UTC",
   all(g.external_id.startswith(BSL26 + "_") and g.extra["home_code"] and g.extra["away_code"]
       and g.tipoff_at.endswith("Z") for g in bsl))
graz = next(g for g in bsl if g.external_id.endswith("90df8972-78bb-11f1-a5e8-b396d0dc8330"))
ok("the game Louie saved: Eagles Raiffeisen UBSC Graz v BK Karbon-X Dukes, 16:00 in Graz = 14:00 UTC, final",
   (graz.home_name, graz.away_name, graz.tipoff_at, graz.extra["home_code"], graz.status, graz.extra["venue"]) ==
   ("Eagles Raiffeisen UBSC Graz", "BK Karbon-X Dukes", "2026-10-11T14:00:00Z", "GRA", "final", "Raiffeisen Sportpark Graz"),
   (graz.home_name, graz.away_name, graz.tipoff_at, graz.extra))
ok("no play-offs published yet: the play-off row finds none", discover("bsl", "2026-27", "playoffs")[1] == [])

a, b2l = discover("b2l", "2026-27")
clubs = collections.Counter()
for g in b2l:
    clubs.update([g.home_name, g.away_name])
ok("B2L: 154 games (14 played) on website 262, 15 clubs",
   (len(b2l), sum(g.status == "final" for g in b2l), len(clubs)) == (154, 14, 15) and {s for s, _, _ in a.asked} == {"262"},
   (len(b2l), len(clubs), a.asked[:1]))
ok("...an umlaut in a club's code is kept as the feed writes it (WÖR, GÜS)",
   {"WÖR", "GÜS"} <= {g.extra["home_code"] for g in b2l} | {g.extra["away_code"] for g in b2l})
a, bdsl = discover("bdsl", "2026-27")
clubs = collections.Counter()
for g in bdsl:
    clubs.update([g.home_name, g.away_name])
ok("BDSL: 84 games (15 played) on website 261, 8 clubs x 21",
   (len(bdsl), sum(g.status == "final" for g in bdsl), len(clubs), set(clubs.values())) == (84, 15, 8, {21})
   and {s for s, _, _ in a.asked} == {"261"}, (len(bdsl), clubs))
ok("...the BDSL National League (another competition on 261) is not read: no TI Eagles Innsbruck, one season asked",
   "TI Eagles Innsbruck" not in clubs and [st.get("s") for _, _, st in a.asked if st.get("s")] == [BDSL26, BDSL26])

print("\n-- the stages: fixtureType is REGULAR on every game, so the game's name (or its stage tab) says")
for league, season, reg_n, po_n, po_codes in (("bsl", "2025-26", 160, 27, {"VF": 14, "SF": 8, "FIN": 5}),
                                              ("b2l", "2025-26", 176, 19, {"VF": 9, "SF": 5, "FIN": 3, "REL": 2}),
                                              ("bdsl", "2025-26", 63, 7, {"SF": 4, "FIN": 3})):
    r, p = discover(league, season)[1], discover(league, season, "playoffs")[1]
    ok(f"{league.upper()} {season}: {reg_n} regular-season games and {po_n} play-off games {po_codes}",
       (len(r), len(p)) == (reg_n, po_n) and dict(collections.Counter(g.extra["phase"] for g in p)) == po_codes,
       (len(r), len(p), collections.Counter(g.extra["phase"] for g in p)))
    ok("...no game in both, every play-off game marked so",
       not ({g.external_id for g in r} & {g.external_id for g in p}) and all(g.extra["stage"] == "playoffs" for g in p))
r25 = discover("bsl", "2025-26")[1]
ok("BSL 2025-26's Zwischenrunde (Platzierungs- and Qualifikationsrunde) is regular season: GD 110 + PR 29 + QR 21",
   dict(collections.Counter(g.extra["phase"] for g in r25)) == {"GD": 110, "PR": 29, "QR": 21})
fin = next(g for g in discover("bsl", "2025-26", "playoffs")[1] if g.external_id.endswith("28f43b1e-4f86-11f1-8c3c-6523e900af15"))
ok("...the final's game 5: Kapfenberg v Oberwart, 18:00 in Kapfenberg (summer time) = 16:00 UTC",
   (fin.home_name, fin.away_name, fin.tipoff_at, fin.extra["phase"]) ==
   ("Hefte Helfen Bulls Kapfenberg", "UNGER STEEL Gunners Oberwart", "2026-06-06T16:00:00Z", "FIN"), fin)
r24, p24 = discover("bsl", "2024-25")[1], discover("bsl", "2024-25", "playoffs")[1]
ok("BSL 2024-25: the play-off games carry no stageCode, their names say (160 + 24: VF 14, SF 7, FIN 3)",
   (len(r24), len(p24)) == (160, 24) and dict(collections.Counter(g.extra["phase"] for g in p24)) == {"VF": 14, "SF": 7, "FIN": 3},
   (len(r24), collections.Counter(g.extra["phase"] for g in p24)))
r21, p21 = discover("bsl", "2021-22")[1], discover("bsl", "2021-22", "playoffs")[1]
ok("BSL 2021-22: no game has a name, the stage tabs say (132 + 30, the play-down filed with the play-offs)",
   (len(r21), len(p21)) == (132, 30) and dict(collections.Counter(g.extra["phase"] for g in p21)) ==
   {"win2dayBSLPlay-offs": 25, "BSL Playdown": 5}, (len(r21), collections.Counter(g.extra["phase"] for g in p21)))
none = Offline()
ok("a year with no season on the website gives nothing, after one request",
   list(none.discover("", {"league": "bsl", "season": "2030-31"})) == [] and len(none.asked) == 1, none.asked)
for bad in ({"league": "bsl", "stage": "finals"}, {"league": "austria", "stage": "regular"}):
    try:
        Offline().discover("", bad)
        ok(f"refused: {bad}", False)
    except ValueError:
        ok(f"refused: {bad}", True)
ok("name codes: 'BSL-FIN - 005' FIN, 'GD-013' GD, 'BSDL-SF - 002' SF, 'B2L-REL - 001' REL, none ''",
   [A.name_code(n) for n in ("BSL-FIN - 005", "GD-013", "BSDL-SF - 002", "B2L-REL - 001", None)] == ["FIN", "GD", "SF", "REL", ""])
ok("a stage nobody knows is regular season, and says so",
   A.stage_of({"name": None, "stageCode": "x"}, {"x": "Sonderrunde"}) == ("regular", "?Sonderrunde")
   and A.stage_of({"name": None, "stageCode": "x"}, {"x": "Snickers®-Play-Offs"})[0] == "playoffs")
ok("a tip-off with no UTC time is the local one in Vienna's clock (CET in November, CEST in October)",
   A._local_to_utc("2026-11-28T17:30:00", "Europe/Vienna") == "2026-11-28T16:30:00Z"
   and A._local_to_utc("2026-10-11T16:00:00", "") == "2026-10-11T14:00:00Z")
g = Offline()._game({"seasonId": "s"}, {"fixtureId": "f", "name": "BSL-GD - 001", "startTimeLocal": "2026-12-26T18:00:00",
                                       "timezone": "Europe/Vienna", "status": {"value": "UNCONFIRMED"},
                                       "competitors": [{"name": "A", "code": "A", "isHome": True}, {"name": "B", "code": "B"}]},
                    "regular", {}, {})
ok("...and is used when startTimeUTC is missing; a game waiting for its result to be signed is polled as live",
   g.tipoff_at == "2026-12-26T17:00:00Z" and g.status == "live", g)


# ============================================================================ games
def minutes_replay(raw):
    """Every player's seconds on court, replayed from the translated 'sub' events (as kbl_test.py does),
    against the box score's sMinutes. An overtime period starts after ALL the regulation periods."""
    tr = translate(raw)
    fmt = tr["format"]

    def cum(p, c):
        if p <= fmt["periods"]:
            return (p - 1) * fmt["period_ms"] + fmt["period_ms"] - c
        return fmt["periods"] * fmt["period_ms"] + (p - fmt["periods"] - 1) * fmt["ot_ms"] + fmt["ot_ms"] - c
    on, since, played = [set(tr["starters"][0]), set(tr["starters"][1])], {}, {}
    for side in (0, 1):
        for pid in on[side]:
            since[pid] = 0
    end = 0
    for ev in tr["events"]:
        if ev["t"] == "sub":
            t, now = ev["team"], cum(ev["period"], ev["clock"])
            o, i = ev["payload"].get("out"), ev["payload"].get("in")
            if o in since:
                played[o] = played.get(o, 0) + now - since.pop(o)
            on[t].discard(o)
            if i and i not in on[t]:
                on[t].add(i)
                since[i] = now
        if ev["t"] == "game_end":
            end = cum(ev["period"], ev["clock"])
    for pid, t0 in since.items():
        played[pid] = played.get(pid, 0) + end - t0
    box_s = lambda txt: (lambda m, s: int(m) * 60 + int(s))(*str(txt or "0:00").split(":"))  # noqa: E731
    want = {f"{i}:{pno}": box_s(p.get("sMinutes")) for i, k in enumerate(("1", "2")) for pno, p in (raw["tm"][k].get("pl") or {}).items()}
    off = {pid: (round(played.get(pid, 0) / 1000), s) for pid, s in want.items() if abs(round(played.get(pid, 0) / 1000) - s) > 1}
    unpaired = [w for w in tr["report"].get("warnings", []) if "unpaired substitution" in w]
    return tr, want, off, unpaired


def check_game(league, season, fid, home, away, score, periods, what, league_own=()):
    """league_own: (name, stat, log, box) lines where the league's own log and its own box disagree - the box
    stands (it is the official line), and the test names each one rather than tolerating any."""
    print(f"\n-- {what}")
    g = Offline()
    b = g.fetch(f"{season}_{fid}", {"league": league})
    raw = b.raw
    ok("final, both clubs named, the league's score",
       (b.status, b.home_name, b.away_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == ("final", home, away) + score,
       (b.status, b.home_name, b.away_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]))
    ok("read off the league's own website (%s), two requests" % A.LEAGUES[league]["site"],
       [(s, st["z"]) for s, _, st in g.asked] == [(str(A.LEAGUES[league]["site"]), "pbp"), (str(A.LEAGUES[league]["site"]), "statistics")],
       g.asked)
    st = load(f"game-{fid[:8]}.json.gz")["statistics"]["data"]
    rows = {r["personId"]: r for side in ("home", "away") for r in st["statistics"]["data"]["base"][side]["persons"][0]["rows"]}
    ok("every player's points and total rebounds are the league's own",
       all(raw["tm"][t]["pl"][pno]["sPoints"] == (rows[pno]["statistics"].get("points") or 0)
           and raw["tm"][t]["pl"][pno]["sReboundsTotal"] == (rows[pno]["statistics"].get("rebounds") or 0)
           for t in ("1", "2") for pno in raw["tm"][t]["pl"]))
    ok("every player's defensive rebounds are his total less his offensive ones",
       all(p["sReboundsDefensive"] == p["sReboundsTotal"] - p["sReboundsOffensive"] for t in ("1", "2") for p in raw["tm"][t]["pl"].values()))
    pts = collections.Counter()
    for e in raw["pbp"]:
        if e.get("success") and e["actionType"] in ("2pt", "3pt", "freethrow"):
            pts[e["tno"]] += {"2pt": 2, "3pt": 3, "freethrow": 1}[e["actionType"]]
    ok("the play-by-play's points are the final score", (pts[1], pts[2]) == score, dict(pts))
    ok("the play-by-play covers %d periods, overtime numbered 5 on" % periods,
       {e["period"] for e in raw["pbp"]} == set(range(1, periods + 1)))
    ok("every shot has its place on the chart",
       sum(len(raw["tm"][t].get("shot") or []) for t in "12") == sum(1 for e in raw["pbp"] if e["actionType"] in ("2pt", "3pt")) > 100)
    length = 2400 + 300 * (periods - 4)
    dur = sum(r["duration"] for r in b.stints)
    ok("stints cover the whole game (%d s), five a side, summing to the score" % length,
       abs(dur - length) < 1 and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints)
       and (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == score,
       (dur, len(b.stints)))
    tr, want, off, unpaired = minutes_replay(raw)
    ok("every player's minutes, replayed from the substitutions, are the box score's to the second (%d players)" % len(want),
       not off, off)
    ok("...and no substitution is left unpaired", not unpaired, unpaired)
    tally = collections.defaultdict(collections.Counter)
    for e in tr["events"]:
        if e["pid"]:
            s, t = tally[e["pid"]], e["t"]
            if t in ("p2_made", "p3_made", "ft_made"):
                s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
            if t in ("ast", "stl", "blk", "to"):
                s[t] += 1
            if t == "reb":
                s["oreb" if e["payload"]["off"] else "dreb"] += 1
    diffs = [(p["name"], k, tally.get(f"{i}:{pno}", {}).get(k, 0), v) for i, t in enumerate("12") for pno, p in raw["tm"][t]["pl"].items()
             for k, v in (("pts", p["sPoints"]), ("ast", p["sAssists"]), ("stl", p["sSteals"]), ("blk", p["sBlocks"]),
                          ("to", p["sTurnovers"]), ("oreb", p["sReboundsOffensive"]), ("dreb", p["sReboundsDefensive"]))
             if tally.get(f"{i}:{pno}", {}).get(k, 0) != v]
    ok("the event log drops nothing and every player's line equals his box" + (" but the league's own %d" % len(league_own) if league_own else ""),
       not tr["report"]["dropped"] and not tr["report"]["unmatched"] and sorted(diffs) == sorted(league_own), (tr["report"]["dropped"], diffs[:5]))
    return b


b = check_game("bsl", BSL26, "90df8972-78bb-11f1-a5e8-b396d0dc8330", "Eagles Raiffeisen UBSC Graz", "BK Karbon-X Dukes", (102, 94), 6,
               "BSL: Graz 102-94 Dukes after two overtimes (the page Louie saved)")
ok("...the BSL's website publishes no defensive rebounds, and the club's 48 are 36 + 12, not 0 + 12",
   (b.raw["tm"]["1"]["tot_sReboundsDefensive"], b.raw["tm"]["1"]["tot_sReboundsOffensive"]) == (36, 12),
   (b.raw["tm"]["1"].get("tot_sReboundsDefensive"), b.raw["tm"]["1"].get("tot_sReboundsOffensive")))
# the feed names a player in one field (personName); names.py, not this adapter, splits it
knessl = next((p for p in b.raw["tm"]["1"]["pl"].values() if p.get("name") == "Jonathan Knessl"), {})
ok("...Jonathan Knessl, #12, a starter (the box's '* Jonathan Knessl (C)'), 39:41",
   (knessl.get("shirtNumber"), knessl.get("starter"), knessl.get("sMinutes")) == ("12", 1, "39:41"), knessl)
check_game("bsl", BSL25, "28f43b1e-4f86-11f1-8c3c-6523e900af15", "Hefte Helfen Bulls Kapfenberg", "UNGER STEEL Gunners Oberwart",
           (94, 80), 4, "BSL 2025-26 final, game 5: Kapfenberg 94-80 Oberwart (178 substitutions)")
check_game("b2l", B2L26, "99a8eac6-868e-11f1-a380-93079331e59d", "Union Deutsch Wagram Alligators", "Vienna Timberwolves",
           (102, 91), 4, "B2L: Deutsch Wagram 102-91 Vienna Timberwolves")
# THE LEAGUE'S OWN BOX AND LOG DISAGREE BY ONE DEFENSIVE REBOUND EACH for two players here: Helena Linder's box says 6
# rebounds (2 + 4) where the log has her 2 + 5, Valerie Voithofer's 2 (1 + 1) where it has 1 + 2. The box is the official
# line and is what is published; the stints and minutes, which come from the log's substitutions, are untouched.
check_game("bdsl", BDSL26, "18f476b7-9a41-11f1-8ed9-bf0a0b152ede", "BK Raiffeisen Duchess", "DBB Wels",
           (73, 78), 4, "BDSL: Duchess 73-78 Wels",
           league_own=[("Helena Linder", "dreb", 5, 4), ("Valerie Voithofer", "dreb", 2, 1)])

print("\n-- 2019-20: the embed kept the box and no plays")
old = Offline().fetch(f"{BSL19}_dc9e993e-d3d9-11e9-9940-0af267b29901", {"league": "bsl", "_tipoff_at": "2019-12-14T16:30:00Z"})
ok("Vienna Timberwolves 61-83 Wels: final, a box, published as a result (translate off, no stints)",
   old is not None and old.status == "final" and (old.raw["tm"]["1"]["score"], old.raw["tm"]["2"]["score"]) == (61, 83)
   and old.translate is False and old.stints == [] and len(old.box["home"]) >= 5,
   old and (old.status, old.translate, len(old.stints), len(old.box.get("home") or [])))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
