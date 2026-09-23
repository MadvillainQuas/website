"""ProA / ProB (adapters/twobbl.py), offline, over captured pages and ticker feeds:

    python scripts/ingest/twobbl_test.py

What it holds the adapter to:
  * the schedule: seasons read right, the BBL-Pokal never discovered, "regular" and "playoffs"
    kept apart, a fixture's key the same before and after it is played, tip-offs in UTC, and a
    "noch in Planung" page refused rather than read as an empty season;
  * one game: every player's box exactly the ticker's own box, both clubs' totals exactly the
    ticker's team rows, the final score, stints five-a-side covering the whole game, every
    play-by-play event numbered in order, and the event log translate() builds from it dropping
    nothing and summing to the same box.

Fixtures live in scripts/ingest/data/twobbl/ (captured 2026-09-23; see the adapter's note).
"""
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import twobbl as T  # noqa: E402
from translate.fiba_events import translate  # noqa: E402

DATA = os.path.join(HERE, "data", "twobbl")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def page(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


def game(gid):
    with open(os.path.join(DATA, f"game-{gid}.json"), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- an adapter with no network
PAGES = {("proa", "2024/2025"): "proa-2024-25.html",
         ("proa", "2025/2026"): "proa-2025-26.html", ("proa", "2026/2027"): "proa-2026-27.html",
         ("prob", "2025/2026"): "prob-2025-26.html", ("prob", "2026/2027"): "prob-2026-27.html",
         ("proa", "2025/26"): "proa-placeholder.html"}
GAMES = ("2003626", "2005789", "2003505", "2003787", "2003822", "2006724", "2003296", "2003329")


class Offline(T.TwoBBLAdapter):
    """The real adapter with its four network calls served from the fixtures."""
    requests_made: list = []

    def _get_text(self, url):
        self.requests_made.append(url)
        lg = "prob" if "spielplaene-prob" in url else "proa"
        m = re.search(r"season=([^&]+)", url)
        name = PAGES.get((lg, m.group(1) if m else ""))
        return page(name) if name else None

    def _get_json(self, url):
        self.requests_made.append(url)
        if url.endswith("/games.jsn"):
            return json.loads(page("games.jsn.json"))
        if url.endswith("/gamesLive.jsn"):
            return json.loads(page("gamesLive.jsn.json"))
        m = re.search(r"/(?:init|lt/info)/(\d+)$", url)
        if m and m.group(1) in GAMES:
            return game(m.group(1))["init" if "/init/" in url else "info"]
        return None

    def history(self, gid):
        self.requests_made.append(f"socket:{gid}")
        return game(gid)["socket"] if gid in GAMES else [[20]] * 7


def fresh():
    T.TwoBBLAdapter._pages = {}
    T.TwoBBLAdapter._ids = {}
    T.TwoBBLAdapter._rows = {}
    T.TwoBBLAdapter._inits = {}
    T.TwoBBLAdapter._infos = {}
    T.TwoBBLAdapter._board_cache = (0.0, [])
    return Offline()


# ============================================================================ seasons and time
print("-- seasons and tip-off times")
for tok, want in {"2026-27": "2026/2027", "2026/27": "2026/2027", "2026/2027": "2026/2027",
                  "26/27": "2026/2027", "2026": "2026/2027", "1999/00": "1999/2000",
                  "2025/27": None, "E2025": None, "": None}.items():
    ok(f"season token {tok!r} -> {want}", T.normalize_season(tok) == want, T.normalize_season(tok))
from datetime import datetime, timezone  # noqa: E402
ok("current season from August on is the one starting that year",
   T.current_season(datetime(2026, 8, 1, tzinfo=timezone.utc)) == "2026/2027"
   and T.current_season(datetime(2026, 7, 31, tzinfo=timezone.utc)) == "2025/2026")
ok("summer time: 25.09.2026 20:00 Berlin is 18:00 UTC",
   T.berlin_to_utc("25.09.2026", "20:00 Uhr") == "2026-09-25T18:00:00+00:00",
   T.berlin_to_utc("25.09.2026", "20:00 Uhr"))
ok("winter time: 13.12.2026 18:00 Berlin is 17:00 UTC",
   T.berlin_to_utc("13.12.2026", "18:00 Uhr") == "2026-12-13T17:00:00+00:00",
   T.berlin_to_utc("13.12.2026", "18:00 Uhr"))
ok("the tz-database-free fallback agrees (CEST in September, CET in December)",
   T._eu_offset_hours(datetime(2026, 9, 25, 20)) == 2 and T._eu_offset_hours(datetime(2026, 12, 13, 18)) == 1)

# ============================================================================ the schedule pages
print("\n-- the schedule pages")
counts = {}
for (lg, season), name in PAGES.items():
    p = T.parse_schedule(page(name))
    c = defaultdict(int)
    for r in p["rows"]:
        c[r["stage"]] += 1
    counts[(lg, season)] = (p, dict(c))
p, c = counts[("proa", "2025/2026")]
ok("ProA 2025/26: 306 main-round games (18 clubs, double round robin)", c.get("regular") == 306, c)
ok("ProA 2025/26: 25 playoff games, 23 BBL-Pokal games", c.get("playoffs") == 25 and c.get("cup") == 23, c)
ok("ProA 2025/26: the page says which season it shows", p["selected"] == "2025/2026", p["selected"])
labels = sorted({r["label"] for r in p["rows"] if r["stage"] == "playoffs"})
ok("playoff slides are the PO-... rounds", all(l.startswith("PO-") for l in labels), labels)
ok("cup slides are the BBL-Pokal ones", all("Pokal" in r["label"] for r in p["rows"] if r["stage"] == "cup"))
p, c = counts[("prob", "2025/2026")]
ok("ProB 2025/26: 338 main-round games (Nord 14 clubs + Sued 13) and 33 playoff games",
   c == {"regular": 338, "playoffs": 33}, c)
p, c = counts[("prob", "2026/2027")]
ok("ProB 2026/27: 392 fixtures, none played yet (Nord 14 + Sued 15)",
   c == {"regular": 392} and not any(r["gid"] for r in p["rows"]), c)
p, c = counts[("proa", "2025/26")]
ok("a malformed token's page ('noch in Planung') has no rows and says so",
   p["rows"] == [] and p["placeholder"] and p["selected"] is None, (len(p["rows"]), p["placeholder"]))

rows = counts[("proa", "2025/2026")][0]["rows"]
keys = T.fixture_keys(rows, "proa", "2025/2026")
ok("every fixture on a page has its own key", len({k for k, _ in keys}) == len(keys))
reg = [(k, r) for k, r in keys if r["stage"] == "regular"]
ok("a main-round key is league-season-home-away", all(re.fullmatch(r"proa-2025-\d+-\d+", k) for k, _ in reg), reg[:2])
po = [(k, r) for k, r in keys if r["stage"] == "playoffs"]
ok("a playoff key carries the round, since a pair meets up to five times",
   all(re.fullmatch(r"proa-2025-po-[a-z0-9-]+-spiel-\d-\d+-\d+", k) for k, _ in po), po[:2])
for k, r in keys[:3] + po[:2]:
    pk = T.parse_key(k)
    ok(f"parse_key({k}) gives the clubs back",
       pk and pk["home_id"] == r["home_id"] and pk["away_id"] == r["away_id"] and pk["season"] == "2025/2026", pk)
# THE KEY MUST NOT MOVE when the result arrives: the same page with every result blanked
html = page("proa-2025-26.html")
unplayed = re.sub(r'<a [^>]*href="[^"]*/g/\d+[^"]*"[^>]*>[^<]*</a>', "--:--", html)
keys_before = [k for k, _ in T.fixture_keys(T.parse_schedule(unplayed)["rows"], "proa", "2025/2026")]
ok("a fixture's key is the same before its game id exists as after", keys_before == [k for k, _ in keys])
moved = re.sub(r"(\d{2})\.(\d{2})\.2026", r"\1.\2.2027", html)
ok("...and does not change when the fixture is re-dated",
   [k for k, _ in T.fixture_keys(T.parse_schedule(moved)["rows"], "proa", "2025/2026")] == [k for k, _ in keys])
tips = [r["tip"] for r in rows]
ok("every row has a UTC tip-off", all(t and t.endswith("+00:00") for t in tips), tips[:3])

# ============================================================================ discover()
print("\n-- discover()")
a = fresh()
g_reg = list(a.discover(T.SCHEDULE_URLS["proa"], {"season": "2025-26", "stage": "regular"}))
g_po = list(a.discover(T.SCHEDULE_URLS["proa"], {"season": "2025-26", "stage": "playoffs"}))
g_all = list(a.discover(T.SCHEDULE_URLS["proa"], {"season": "2025-26"}))
ok("stage=regular: the 306 main-round games, all final", len(g_reg) == 306 and all(g.status == "final" for g in g_reg),
   (len(g_reg), {g.status for g in g_reg}))
ok("stage=playoffs: the 25 playoff games and nothing else", len(g_po) == 25
   and all(g.extra["round"].startswith("PO-") for g in g_po), len(g_po))
ok("no stage: both, and still never the BBL-Pokal", len(g_all) == 331
   and not any("Pokal" in g.extra["round"] for g in g_all), len(g_all))
ok("the two stages never share a game", not ({g.external_id for g in g_reg} & {g.external_id for g in g_po}))
a = fresh()
Offline.requests_made = []
g_frag = list(a.discover("https://www.2basketballbundesliga.de/spielplan/#playoffs", {"season": "2025-26", "stage": "playoffs"}))
ok("a '#playoffs' schedule URL (run_ingest keys sources by URL) reads the same page, fragment dropped",
   len(g_frag) == 25 and Offline.requests_made[0] == "https://www.2basketballbundesliga.de/spielplan/?season=2025/2026",
   Offline.requests_made[:1])
g0 = next(g for g in g_reg if g.extra.get("game_id") == "2003626")
ok("a played fixture: names from the page, codes are the numeric team ids, crests are https",
   g0.home_name == "BBC Bayreuth" and g0.extra["home_code"] == "425" and g0.extra["away_code"] == "436"
   and g0.extra["home_logo"] == "https://api.2basketballbundesliga.de/pics/li/425", (g0.home_name, g0.extra))
ok("its key is proa-2025-425-436", g0.external_id == "proa-2025-425-436", g0.external_id)
a = fresh()
g_new = list(a.discover(T.SCHEDULE_URLS["proa"], {"season": "2026-27", "stage": "regular"}))
ok("ProA 2026/27: 306 fixtures, the six cup games left out", len(g_new) == 306, len(g_new))
gi = next((g for g in g_new if g.external_id == "proa-2026-421-435"), None)
ok("GIESSEN 46ers v Artland Dragons (Spieltag 1): 25.09.2026 20:00 Berlin = 18:00 UTC, scheduled",
   gi and gi.tipoff_at == "2026-09-25T18:00:00+00:00" and gi.status == "scheduled",
   gi and (gi.tipoff_at, gi.status))
ok("...and its game id is already known from the ticker's matchday board (games.jsn)",
   gi and gi.extra.get("game_id") == "2005820", gi and gi.extra)
ok("an unplayed fixture has no game id and still a key", any(not g.extra.get("game_id") for g in g_new))
a = fresh()
g_b = list(a.discover(T.SCHEDULE_URLS["prob"], {"season": "2026-27", "stage": "regular"}))
ok("ProB 2026/27: 392 scheduled fixtures under prob- keys",
   len(g_b) == 392 and all(g.external_id.startswith("prob-2026-") for g in g_b)
   and all(g.status == "scheduled" for g in g_b), len(g_b))
with open(os.path.join(HERE, "..", "..", "config", "groups", "prob.json"), encoding="utf-8") as f:
    grp = json.load(f)
names = {n for g in grp["default"].values() for n in g}
seen = {g.home_name for g in g_b} | {g.away_name for g in g_b}
ok("every ProB 2026/27 club name is exactly the one config/groups/prob.json uses", seen <= names,
   sorted(seen - names))
a = fresh()
try:
    placeholder_refused = a._schedule("proa", "2025/26") is None
except RuntimeError:
    placeholder_refused = False
ok("a 'noch in Planung' page is refused (None, with the reason printed), not read as an empty season",
   placeholder_refused)
try:
    list(fresh().discover(T.SCHEDULE_URLS["proa"], {"season": "twenty"}))
    raised = False
except ValueError:
    raised = True
ok("a season token that is not a season is an error, not a quiet empty run", raised)
try:
    list(fresh().discover(T.SCHEDULE_URLS["proa"], {"season": "2025-26", "stage": "cup"}))
    raised = False
except ValueError:
    raised = True
ok("stage must be regular or playoffs", raised)
ok("no season configured = the current season", T.TwoBBLAdapter._season({}) == T.current_season())
ok("the registry knows it", type(get_adapter("twobbl")).__name__ == "TwoBBLAdapter"
   and type(get_adapter("bbl_2bbl")).__name__ == "Bbl2BblAdapter")

# ============================================================================ fetch() -> bundle
print("\n-- fetch(): one game, end to end, against the ticker's own box")
SEASON_OF = {"2003626": ("proa", "2025/2026"), "2005789": ("proa", "2025/2026"),
             "2003505": ("proa", "2025/2026"), "2003787": ("prob", "2025/2026"),
             "2003822": ("prob", "2025/2026")}
BOX = {"sPoints": 6, "sFreeThrowsMade": 7, "sFreeThrowsAttempted": 8, "sTwoPointersMade": 10,
       "sTwoPointersAttempted": 11, "sThreePointersMade": 13, "sThreePointersAttempted": 14,
       "sFoulsPersonal": 16, "sReboundsTotal": 17, "sAssists": 18, "sBlocks": 19, "sSteals": 20,
       "sTurnovers": 21, "sReboundsDefensive": 26, "sReboundsOffensive": 27}
TEAM = {"sFreeThrowsMade": 3, "sFreeThrowsAttempted": 4, "sTwoPointersMade": 6,
        "sTwoPointersAttempted": 7, "sThreePointersMade": 9, "sThreePointersAttempted": 10,
        "sFoulsPersonal": 12, "sReboundsDefensive": 13, "sReboundsOffensive": 14, "sBlocks": 15,
        "sSteals": 16, "sTurnovers": 17}


def check_bundle(label, b, feed, home_id, quirk=None):
    quirk = quirk or {}
    raw = b.raw
    fd = T.dedupe_socket(feed["socket"])
    a_is_home = str(feed["init"]["teamA"]["id"]) == str(home_id)
    tno_of_code = {1: "1", 2: "2"} if a_is_home else {1: "2", 2: "1"}
    # (1) every player of the ticker's box, every field, exactly
    diffs = []
    for m in fd["box"]:
        t = raw["tm"][tno_of_code[int(m[2])]]
        # a registered player is keyed by his ticker id, an unregistered one by "u" + shirt
        p = t["pl"].get(str(m[3])) or t["pl"].get(f"u{m[5]}")
        if p is None:
            diffs.append(f"#{m[5]} (id {m[3]}): not in the payload")
            continue
        for k, i in BOX.items():
            if p[k] != m[i]:
                diffs.append(f"#{m[5]} {k} {p[k]} != {m[i]}")
        if p["sFieldGoalsMade"] != m[10] + m[13] or p["sFieldGoalsAttempted"] != m[11] + m[14]:
            diffs.append(f"#{m[5]} FG")
        if p["sMinutes"] != T._mmss(m[24]):
            diffs.append(f"#{m[5]} minutes {p['sMinutes']} != {m[24]}s")
    ok(f"{label}: every player's box = the ticker's box ({len(fd['box'])} players)",
       not diffs and sum(len(raw["tm"][s]["pl"]) for s in "12") >= len(fd["box"]), diffs[:6])
    # (2) the clubs' totals = the ticker's team rows
    tdiffs = []
    for code, t2 in fd["team"].items():
        t = raw["tm"][tno_of_code[code]]
        for k, i in TEAM.items():
            if t["tot_" + k] != t2[i]:
                tdiffs.append(f"team{code} {k} {t['tot_' + k]} != {t2[i]}")
        if t["tot_sPoints"] != t2[3] + 2 * t2[6] + 3 * t2[9]:
            tdiffs.append(f"team{code} points")
    ok(f"{label}: both clubs' totals = the ticker's team rows", not tdiffs and len(fd["team"]) == 2, tdiffs[:4])
    # (3) the scoreboard
    last = max(fd["scores"], key=lambda m: (T.elapsed(m[2], m[3]), m[1]))
    sc = {tno_of_code[1]: last[4], tno_of_code[2]: last[5]}
    ok(f"{label}: final score {sc['1']}-{sc['2']} and the periods add up to it",
       raw["tm"]["1"]["score"] == sc["1"] and raw["tm"]["2"]["score"] == sc["2"]
       and all(sum(v for k, v in raw["tm"][s].items() if re.fullmatch(r"p\d+_score", k)) == sc[s] for s in "12"),
       ({k: v for k, v in raw["tm"]["1"].items() if k.endswith("_score")}, sc))
    ok(f"{label}: status final, clock 00:00", b.status == "final" and raw["clock"] == "00:00", (b.status, raw["clock"]))
    # (4) play-by-play numbering and vocabulary
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: every event has an integer actionNumber, 1..n ascending",
       an == list(range(1, len(an) + 1)) and all(isinstance(x, int) for x in an))
    ok(f"{label}: success is 1/0 (never a boolean), tno 0/1/2, pno a string",
       all(e.get("success", 0) in (0, 1) and not isinstance(e.get("success"), bool) for e in raw["pbp"])
       and all(e["tno"] in (0, 1, 2) and isinstance(e["pno"], str) for e in raw["pbp"]))
    ok(f"{label}: no private helper key leaks into the payload",
       not any(k.startswith("_") for e in raw["pbp"] for k in e))
    per = max(e["period"] for e in raw["pbp"])
    ok(f"{label}: periods start and end, and the game ends, once each",
       [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"] == list(range(1, per + 1))
       and [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == list(range(1, per + 1))
       and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1)
    # (5) starters and stints
    for s in "12":
        st = [k for k, p in raw["tm"][s]["pl"].items() if p["starter"] == 1]
        ok(f"{label}: team {s} has exactly five starters", len(st) == 5, st)
    # THE OPENING FIVES ARE RIGHT IF THE MINUTES ARE: replaying the substitutions from the starters
    # must give every player exactly the seconds the ticker's own box says he played. (The feed's
    # type-7 fives are only a prior: 2003505 and 2005789 re-send a DIFFERENT Q1 five mid-game.)
    on = {s: {k for k, p in raw["tm"][s]["pl"].items() if p["starter"]} for s in "12"}
    secs, last = defaultdict(int), 0
    for e in raw["pbp"]:
        t = T.elapsed(e["period"], T._secs(e["gt"]))
        for s in "12":
            for q in on[s]:
                secs[(s, q)] += t - last
        last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
    mdiff = [f"{p['name']} {secs[(s, k)]}s != {p['sMinutes']}" for s in "12" for k, p in raw["tm"][s]["pl"].items()
             if abs(secs[(s, k)] - T._secs(p["sMinutes"])) > 5]
    ok(f"{label}: every player's minutes from the substitutions = the box minutes", not mdiff, mdiff[:4])
    length = 2400 + 300 * max(0, per - 4)
    lu = [(r["home_lineup"], r["away_lineup"]) for r in b.stints]
    ok(f"{label}: {len(b.stints)} stints, every one five a side",
       b.stints and all(len(h.split(",")) == 5 and len(a_.split(",")) == 5 for h, a_ in lu))
    dur = sum(r["duration"] for r in b.stints)
    ok(f"{label}: stints cover the whole game ({length}s)", abs(dur - length) < 0.01, dur)
    hp, ap = sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)
    want_pts = quirk.get("pbp_points", (sc["1"], sc["2"]))
    ok(f"{label}: stint points add up to the final score"
       + (f" (the play-by-play's {want_pts}, see QUIRKS)" if "pbp_points" in quirk else ""),
       (hp, ap) == tuple(want_pts), (hp, ap))
    for s, side in (("1", "home"), ("2", "away")):
        pm = sum(p["sPlusMinusPoints"] for p in raw["tm"][s]["pl"].values())
        margin = (hp - ap) if s == "1" else (ap - hp)
        ok(f"{label}: {side} plus/minus sums to 5 x the play-by-play margin", pm == 5 * margin, (pm, margin))
    # (6) the event log the site will store
    tr = translate(raw)
    rep = tr["report"]
    ok(f"{label}: translate() drops nothing and matches every player", not rep["dropped"] and rep["unmatched"] == 0,
       (rep["dropped"], rep["unmatched"]))
    ok(f"{label}: translate() raises no warning", not rep["warnings"], rep["warnings"][:3])
    box = defaultdict(lambda: defaultdict(int))
    for e in tr["events"]:
        if not e["pid"]:
            continue
        s = box[e["pid"]]
        t = e["t"]
        if t in ("p2_made", "p3_made", "ft_made"):
            s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
        if t.startswith("p2") or t.startswith("p3"):
            s["fga"] += 1
            s["fgm"] += t.endswith("made")
        if t.startswith("ft"):
            s["fta"] += 1
            s["ftm"] += t == "ft_made"
        if t == "reb":
            s["oreb" if e["payload"]["off"] else "dreb"] += 1
        for k in ("ast", "stl", "blk", "to"):
            if t == k:
                s[k] += 1
        if t == "foul":
            s["pf"] += 1
    ediff = []
    for i, s in enumerate("12"):
        for pno, p in raw["tm"][s]["pl"].items():
            e = box.get(f"{i}:{pno}", {})
            want = {"pts": p["sPoints"], "fga": p["sFieldGoalsAttempted"], "fgm": p["sFieldGoalsMade"],
                    "fta": p["sFreeThrowsAttempted"], "ftm": p["sFreeThrowsMade"],
                    "oreb": p["sReboundsOffensive"], "dreb": p["sReboundsDefensive"],
                    "ast": p["sAssists"], "stl": p["sSteals"], "blk": p["sBlocks"],
                    "to": p["sTurnovers"], "pf": p["sFoulsPersonal"]}
            for k, v in want.items():
                if e.get(k, 0) != v:
                    ediff.append(f"{p['name']} {k} log={e.get(k, 0)} box={v}")
    return tr, ediff


SEASON_OF.update({"2003296": ("proa", "2024/2025"), "2003329": ("proa", "2025/2026")})
#: where the ticker's own box and its own play-by-play disagree, the box is stored as published
#: and the event log follows the play-by-play (which the score series agrees with). Every such
#: game is listed here with its exact differences, so any NEW difference still fails.
QUIRKS = {
    # the ticker stops at Q4 0:04: Baskin's last free throw is in the score series (and so in the
    # box, the schedule's 81:100 and the scoreboard) but not in the play-by-play, and the final
    # whistle is never written - the schedule's result is what closes the game (fetch's `ended`)
    "2003329": {"log": {"Trevor James Baskin pts log=17 box=18", "Trevor James Baskin ftm log=7 box=8",
                        "Trevor James Baskin fta log=9 box=10", "JaCobi Allen Wood fga log=7 box=8"},
                "pbp_points": (81, 99)},
}
hashes = {}
for gid, (lg, season) in SEASON_OF.items():
    a = fresh()
    p = T.parse_schedule(page(PAGES[(lg, season)]))
    key, row = next((k, r) for k, r in T.fixture_keys(p["rows"], lg, season) if r["gid"] == gid)
    b = a.fetch(key, {"_tipoff_at": row["tip"]})
    feed = game(gid)
    label = f"{gid} {row['home']} v {row['away']}"
    ok(f"{label}: fetch() resolves {key} to game {gid} with no ticker board and no discover()",
       b is not None and b.raw["twobbl"]["gameId"] == gid, key)
    if b is None:
        continue
    ok(f"{label}: names are the schedule's, codes the team ids",
       b.home_name == row["home"] and b.away_name == row["away"]
       and b.raw["tm"]["1"]["code"] == row["home_id"] and b.raw["tm"]["2"]["code"] == row["away_id"],
       (b.home_name, b.away_name, b.raw["tm"]["1"]["code"], b.raw["tm"]["2"]["code"]))
    tr, ediff = check_bundle(label, b, feed, row["home_id"], QUIRKS.get(gid))
    want = QUIRKS.get(gid, {}).get("log", set())
    ok(f"{label}: the event log sums to the same box, player by player"
       + (f" (bar the ticker's {len(want)} known box quirks)" if want else ""), set(ediff) == want, ediff[:8])
    b2 = fresh().fetch(key, {"_tipoff_at": row["tip"]})
    ok(f"{label}: the payload is deterministic (same hash twice)", b2 and b2.payload_hash == b.payload_hash)
    Offline.requests_made = []
    b3 = b2 and a.fetch(key, {"_tipoff_at": row["tip"]})
    ok(f"{label}: a second poll costs one socket read and no page request",
       b3 and b3.payload_hash == b.payload_hash and Offline.requests_made == [f"socket:{gid}"],
       Offline.requests_made)
    hashes[gid] = b.payload_hash

print("\n-- #00 is not #0 (game 2003296)")
a = fresh()
p = T.parse_schedule(page("proa-2024-25.html"))
key = next(k for k, r in T.fixture_keys(p["rows"], "proa", "2024/2025") if r["gid"] == "2003296")
b = a.fetch(key, {})
cra = b.raw["tm"]["1"]["pl"]
ok("Crailsheim's #00 Shahid and #0 Blunt are two players, not one",
   cra.get("2000402", {}).get("shirtNumber") == "00" and cra.get("2000338", {}).get("shirtNumber") == "0",
   {k: (v["name"], v["shirtNumber"]) for k, v in cra.items() if v["shirtNumber"] in ("0", "00")})
ok("...and #00's 21 points are on the sheet (the club's players add up to its 78)",
   cra.get("2000402", {}).get("sPoints") == 21 and sum(v["sPoints"] for v in cra.values()) == 78,
   sum(v["sPoints"] for v in cra.values()))

print("\n-- the unregistered #0 (game 2006724, a BBL-Pokal tie: fed straight to raw_from_feed)")
feed = game("2006724")
raw = T.raw_from_feed(feed["init"], feed["socket"], feed["info"], home_id="439", away_id="422",
                      home_name="Eisbären Bremerhaven", away_name="Basketball Löwen Braunschweig", game_id="2006724")
b = T.TwoBBLAdapter().bundle_from_raw(raw, "cup-2006724", {})
tr, ediff = check_bundle("2006724", b, feed, "439")
bra = raw["tm"]["2"]["pl"]
ok("the two players the ticker never registered get stable keys u0 / u13",
   "u0" in bra and "u13" in bra, sorted(bra))
ok("...and readable names", bra.get("u0", {}).get("name") == "Unregistered #0", bra.get("u0", {}).get("name"))
ok("...and #0's 18 points are his, not lost", bra.get("u0", {}).get("sPoints") == 18)
ok("2006724: the event log sums to the same box, player by player", not ediff, ediff[:6])

print("\n-- a game in progress")
feed = game("2003626")
cut = []
for m in feed["socket"]:
    if isinstance(m, list) and m and m[0] in (0, 1, 3) and len(m) > 3:
        q = m[2]
        clock = m[6] if m[0] == 1 else m[3]
        if q == 4 and clock < 300:
            continue                  # the last five minutes have not happened yet
        if m[0] == 3 and len(m) > 4 and m[4] == 2:
            continue                  # nor has the final whistle
    cut.append(m)
raw = T.raw_from_feed(feed["init"], cut, feed["info"], home_id="425", away_id="436", game_id="2003626")
b = T.TwoBBLAdapter().bundle_from_raw(raw, "live-test", {})
ok("no game end yet -> live", b.status == "live", b.status)
ok("no game/end event, and period 4 is still open",
   not any(e["actionType"] == "game" for e in raw["pbp"])
   and not any(e["actionType"] == "period" and e["subType"] == "end" and e["period"] == 4 for e in raw["pbp"]))
ok("the clock is where the play is (Q4, 05:00 or less left)", raw["period"] == 4 and raw["clock"] <= "05:00", raw["clock"])
ok("stints still five a side", all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
feed = game("2003626")
ok("no play at all -> nothing to store (None), not an empty game",
   T.raw_from_feed(feed["init"], [[20]] * 7, feed["info"], home_id="425", away_id="436") is None)
ok("a feed whose clubs are not the fixture's -> None (a wrong id resolution never stores)",
   T.raw_from_feed(feed["init"], feed["socket"], feed["info"], home_id="1", away_id="2") is None)

print("\n-- resolution and politeness")
a = fresh()
Offline.requests_made = []
ok("a fixture not tipped off is never fetched - not one request (a pre-game ticker test is not a result)",
   a.fetch("proa-2026-421-435", {"_tipoff_at": "2999-01-01T00:00:00+00:00"}) is None
   and Offline.requests_made == [], Offline.requests_made)
a = fresh()
b = a.fetch("proa-2026-421-435", {})
ok("an unplayed fixture resolves through the matchday board and returns None (no play yet)",
   b is None and T.TwoBBLAdapter._ids.get("proa-2026-421-435") == "2005820", T.TwoBBLAdapter._ids.get("proa-2026-421-435"))
board = [{"g": "9001", "l": "a", "n": "1", "d": "06.05.2026", "t1": "439", "t2": "435"},
         {"g": "9003", "l": "a", "n": "3", "d": "10.05.2026", "t1": "439", "t2": "435"}]
row = {"label": "PO-1/4 Finale Spiel 3", "stage": "playoffs", "home_id": "439", "away_id": "435"}
ok("a playoff pair on the board resolves by its game number",
   T.TwoBBLAdapter._board_match(board, "proa", "2025/2026", row) == "9003")
ok("...and a ProA pair never resolves to a ProB board slot",
   T.TwoBBLAdapter._board_match([dict(board[0], l="n")], "proa", "2025/2026", dict(row, label="Spieltag 3", stage="regular")) is None)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
