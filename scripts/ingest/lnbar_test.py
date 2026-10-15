"""Argentina's leagues (adapters/lnbar.py), offline:

    python scripts/ingest/lnbar_test.py

laliganacional.com.ar serves La Liga Nacional, La Liga Argentina, La Liga Femenina and the Liga Desarrollo
from one ASP.NET site, as HTML: the fixture between two dates (an XHR fragment) and a page per game with
the box score in its rows' onclick JSON and the play-by-play in a list. What this holds it to:
  * the season's fixture of each league in one request, ids that do not depend on the link's token (which
    the site encrypts afresh on every view), clubs by IdClub, Argentina -> UTC, 00:00 as "time to be
    confirmed", a status read off the score and the clock (the fixture says none), only the season being
    played (a source pinned to another discovers nothing);
  * a game found again from its id - by its day's fixture, or the season's when the tip-off is not known;
  * the box score and the clubs' totals, the quarter and overtime lines, names passed through as written;
  * the play-by-play in the FIBA event shape, oldest first: each period's announcement of the five on court
    made one balanced change (and the first period's left to the box score's starters), fouls paired with
    the foul drawn, a foul line the site left out put back on the one player it can be, every shot,
    rebound, assist, steal, block and turnover adding up to the box score, and every player's minutes
    replayed through translate.fiba_events to the box score's.

Fixtures in scripts/ingest/data/lnbar/ (captured 2026-10-15; trimmed of inline images, drawings and scripts,
gzipped): each league's 2026-27 fixture as the XHR returns it, the four fixture pages as the user saved
them, and five games -
  laliga-112600-112553-1        Lanús 74-92 Gimnasia (CR), La Liga, 28 Sep 2026
  laliga-114607-113546-1        Racing (CH) 126-123 San Martín (C), La Liga, 8 Oct 2026, two overtimes
  lfb-113443-114152-1           Obras 74-70 Unión Florida, La Liga Femenina, 10 Oct 2026
  ligaproximo-112601-112555-1   Lanús 85-68 Gimnasia (CR), Liga Desarrollo, 27 Sep 2026
  laligaargentina-112559-114766-1  Quilmes (MDP) v River, La Liga Argentina, 15 Oct 2026, not yet started
(La Liga Argentina's season opened that evening: it has no finished game to hold here yet.)
"""
import gzip
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import lnbar as L  # noqa: E402
import names as N  # noqa: E402
from translate.fiba_events import translate as fiba_translate  # noqa: E402

DATA = os.path.join(HERE, "data", "lnbar")
PASS = FAIL = 0
NOW = datetime(2026, 10, 15, 21, 0, tzinfo=timezone.utc)
L.current_season = lambda now=None: "2026-27"          # the fixtures' season, whatever day this runs


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def load(name):
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        return f.read()


SEASON = {k: load(f"fixture-{k}-2026-27.html.gz") for k in L.LEAGUES}
# a token (as the season's fixture gave it) -> the game it opens
TOKEN_GAME = {r["token"]: r["xid"] for k, page in SEASON.items() for r in L.with_ids(L.fixture_rows(page), k)}


class Offline(L.LnbArAdapter):
    def __init__(self):
        super().__init__()
        self.asked = []

    def _get(self, url, params=None):
        self.asked.append((url, dict(params or {})))
        m = re.search(r"/([a-z]+)/fixture$", url)
        if m:
            page = SEASON.get(m.group(1), "")
            lo, hi = (params or {}).get("fechaInicio"), (params or {}).get("fechaFin")
            if lo and lo == hi:                     # one day: only that day's rows, as the site answers
                d = datetime.strptime(lo, "%Y-%m-%d").strftime("%d/%m/%Y")
                page = "".join(tr for tr in re.findall(r'<tr class="fila-tabla-calendarios.*?</tr>', page, re.S) if d in tr)
            return page
        m = re.search(r"/partido/([^/]+)/", url)
        xid = TOKEN_GAME.get(m.group(1)) if m else None
        path = os.path.join(DATA, f"game-{xid}.html.gz")
        return load(f"game-{xid}.html.gz") if xid and os.path.exists(path) else None


print("-- the season's fixtures")
L._TOKENS.clear()
a = Offline()
ll = a.discover("https://www.laliganacional.com.ar/laliga/fixture", {"league": "laliga"})
ok("La Liga: one request for the whole season", len(a.asked) == 1 and a.asked[0][1] == {
    "handler": "ProximosPartidos", "fechaInicio": "2026-08-01", "fechaFin": "2027-07-31"}, a.asked)
ok("La Liga 2026-27: 123 games published", len(ll) == 123, len(ll))
games = {k: Offline.schedule_games(L.fixture_rows(SEASON[k]), k, NOW) for k in L.LEAGUES}
counts = {k: (len(v), sum(1 for g in v if g.status == "final")) for k, v in games.items()}
ok("each league's games, and those played by 15 Oct (Liga Argentina's open that night)",
   counts == {"laliga": (123, 25), "laligaargentina": (144, 0), "lfb": (46, 11), "ligaproximo": (75, 25)}, counts)
ids = [g.external_id for v in games.values() for g in v]
ok("ids unique across the four leagues", len(ids) == len(set(ids)), len(ids) - len(set(ids)))
ok("the key comes from the schedule URL when the row names none",
   len(Offline().discover("https://www.laliganacional.com.ar/lfb/fixture", {})) == 46)
g = games["laliga"][0]
ok("the id: league, home and away IdEquipo, the pair's first game", g.external_id == "laliga-112600-112553-1", g.external_id)
ok("clubs named as the league writes them, un-shouted", (g.home_name, g.away_name) == ("Lanus", "Gimnasia (CR)"),
   (g.home_name, g.away_name))
ok("the club's code is its IdClub", (g.extra["home_code"], g.extra["away_code"]) == ("63", "1474"), g.extra)
ok("crests from the site", g.extra["home_logo"] == "https://www.laliganacional.com.ar/escudos/63/112600", g.extra["home_logo"])
ok("22:05 in Argentina is 01:05 UTC the next day", g.tipoff_at == "2026-09-29T01:05:00Z", g.tipoff_at)
ok("the arena", g.extra["venue"] == "Antonio Rotili", g.extra["venue"])
ok("a played game is final", g.status == "final" and g.extra.get("home_score") == 74)
tbc = next(x for x in games["laliga"] if x.extra.get("time_tbc"))
ok("00:00 is no time yet: noon UTC on the day, flagged", tbc.tipoff_at.endswith("T12:00:00Z") and tbc.status == "scheduled",
   (tbc.tipoff_at, tbc.status))
ok("a game to come is scheduled", next(x for x in games["laliga"] if x.external_id == "laliga-114763-114607-1").status == "scheduled")
row = dict(L.fixture_rows(SEASON["laliga"])[0], home_score=30, away_score=28, date="15/10/2026", time="17:00")
ok("a game under way is live (the fixture has no status: its clock says so)",
   Offline.schedule_games([row], "laliga", NOW)[0].status == "live")
twice = L.with_ids([dict(row, date="01/05/2027"), dict(row, date="20/04/2027"), dict(row, home_team="1", away_team="2")], "laliga")
ok("a pair met twice at one home: numbered by date", sorted(r["xid"] for r in twice) ==
   ["laliga-1-2-1", f"laliga-{row['home_team']}-{row['away_team']}-1", f"laliga-{row['home_team']}-{row['away_team']}-2"]
   and next(r for r in twice if r["date"] == "20/04/2027")["xid"].endswith("-1"), [(r["date"], r["xid"]) for r in twice])
names = {L.club_name(x) for x in ("BOCA", "LA UNION FSA", "LA UNION FSA.", "PE&#xD1;AROL (MDP)", "SAN MART&#xCD;N (C)", "PICO FC")}
ok("Boca is a name, FSA initials, the town in brackets kept", names == {"Boca", "La Union FSA", "La Union FSA.", "Penarol (MDP)",
                                                                        "San Martin (C)", "Pico FC"}, names)
saved = {k: len(L.fixture_rows(load(f"fixture-{k}-saved.html.gz"))) for k in L.LEAGUES}
ok("the fixture pages as saved read the same way", saved == {"laliga": 21, "laligaargentina": 51, "lfb": 35, "ligaproximo": 21}, saved)
a = Offline()
ok("another season: nothing discovered, nothing asked", a.discover("", {"league": "laliga", "season": "2025-26"}) == [] and a.asked == [])
try:
    Offline().discover("https://example.com/", {"league": "nba"})
    ok("an unknown league is refused", False)
except ValueError:
    ok("an unknown league is refused", True)

print("\n-- a game found again from its id")
L._TOKENS.clear()
a = Offline()
b = a.fetch("laliga-112600-112553-1", {"_tipoff_at": "2026-09-29T01:05:00Z"})
ok("by its day's fixture: two requests, the day then the game", b is not None and len(a.asked) == 2
   and a.asked[0][1].get("fechaInicio") == "2026-09-28" == a.asked[0][1].get("fechaFin"), a.asked)
a = Offline()
a.fetch("laliga-112600-112553-1", {})
ok("...and the token kept for the next read: one request", len(a.asked) == 1, a.asked)
L._TOKENS.clear()
a = Offline()
b2 = a.fetch("laliga-112600-112553-1", {})
ok("no tip-off known: the season's fixture", b2 is not None and a.asked[0][1].get("fechaInicio") == "2026-08-01", a.asked)
ok("the same game either way", b and b2 and b.payload_hash == b2.payload_hash)
a = Offline()
ok("a game not yet tipped off: no request at all", a.fetch("lfb-115386-114737-1", {"_tipoff_at": "2099-10-15T23:30:00Z"}) is None
   and a.asked == [], a.asked)
ok("a game not started: nothing to read", Offline().fetch("laligaargentina-112559-114766-1", {}) is None)
ok("not an id of this adapter", Offline().fetch("S49G14N1", {}) is None and Offline().fetch("nba-1-2-1", {}) is None)
ok("another league's game is not read under this league's source",
   Offline().fetch("lfb-113443-114152-1", {"league": "laliga"}) is None and Offline().fetch("lfb-113443-114152-1", {"league": "lfb"}) is not None)
L._TOKENS["laliga-1-2-1"] = "gone"
ok("a token that stops working is forgotten, to be found again", Offline().fetch("laliga-1-2-1", {}) is None
   and "laliga-1-2-1" not in L._TOKENS)


def box_s(txt):
    m, s = str(txt or "0:00").split(":")
    return int(m) * 60 + int(s)


def replay(raw):
    """Every player's seconds on court, replayed from the translated substitutions (kbl_test.py's replay; the
    elapsed time counts each overtime after all four quarters - kbl_test's formula, which has no overtime game
    to meet, put an overtime a whole quarter early)."""
    tr = fiba_translate(raw)
    fmt = tr["format"]
    plen = lambda q: fmt["period_ms"] if q <= fmt["periods"] else fmt["ot_ms"]   # noqa: E731
    cum = lambda p, c: sum(plen(q) for q in range(1, p)) + plen(p) - c            # noqa: E731
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
                on[t].add(i); since[i] = now
        if ev["t"] == "game_end":
            end = cum(ev["period"], ev["clock"])
    for pid, t0 in since.items():
        played[pid] = played.get(pid, 0) + end - t0
    return tr, played, end


GAMES = [
    # id, home, away, score, quarters (home, away), overtimes (home, away)
    ("laliga-112600-112553-1", "Lanus", "Gimnasia (CR)", (74, 92), ([12, 15, 18, 29], [26, 26, 21, 19]), ([], [])),
    ("laliga-114607-113546-1", "Racing (CH)", "San Martin (C)", (126, 123), ([30, 16, 19, 25], [18, 23, 23, 26]), ([16, 20], [16, 17])),
    ("lfb-113443-114152-1", "Obras", "Union Florida", (74, 70), ([22, 15, 15, 22], [20, 20, 17, 13]), ([], [])),
    ("ligaproximo-112601-112555-1", "Lanus", "Gimnasia (CR)", (85, 68), ([23, 19, 28, 15], [28, 16, 5, 19]), ([], [])),
]
COUNTED = {("rebound", "offensive"): "sReboundsOffensive", ("rebound", "defensive"): "sReboundsDefensive",
           ("assist", None): "sAssists", ("steal", None): "sSteals", ("block", None): "sBlocks", ("turnover", None): "sTurnovers"}

L._TOKENS.clear()
for xid, hn, an, score, quarters, ots in GAMES:
    print(f"\n-- {xid}: {hn} {score[0]}-{score[1]} {an}")
    b = Offline().fetch(xid, {})
    ok("fetched, final", b is not None and b.status == "final", b and b.status)
    if not b:
        continue
    raw = b.raw
    h, w = raw["tm"]["1"], raw["tm"]["2"]
    ok("the clubs and the score", (h["name"], w["name"], h["score"], w["score"]) == (hn, an) + score,
       (h["name"], w["name"], h["score"], w["score"]))
    ok("the quarter lines, from the running score", [[t.get(f"p{i}_score") for i in range(1, 5)] for t in (h, w)] == list(quarters),
       [[t.get(f"p{i}_score") for i in range(1, 5)] for t in (h, w)])
    ok("the overtimes", [[t.get(f"ot{i}_score") for i in range(1, len(ots[0]) + 1)] for t in (h, w)] == list(ots)
       and "ot%d_score" % (len(ots[0]) + 1) not in h, [[t.get(f"ot{i}_score") for i in (1, 2, 3)] for t in (h, w)])
    ok("the points add up", [sum(p["sPoints"] for p in t["pl"].values()) for t in (h, w)] == list(score))
    ok("the clubs' own totals", (h["tot_sPoints"], w["tot_sPoints"]) == score)
    ok("five starters a side, from the box", [sum(1 for p in t["pl"].values() if p["starter"]) for t in (h, w)] == [5, 5])
    ok("the arena and tip-off from the page", b.venue and b.tipoff_at and b.tipoff_at.endswith("Z"), (b.venue, b.tipoff_at))
    ev = raw["pbp"]
    ok("events numbered in order", [e["actionNumber"] for e in ev] == list(range(1, len(ev) + 1)))
    ok("it opens with the first period", ev[0]["actionType"] == "period" and ev[0]["subType"] == "start" and ev[0]["period"] == 1)
    ok("the first period's announcement is not ten substitutions",
       not any(e["actionType"] == "substitution" and e["period"] == 1 and e["gt"] == "10:00" for e in ev))
    starts = [e["period"] for e in ev if e["actionType"] == "period" and e["subType"] == "start"]
    ok("every period starts once", starts == list(range(1, 5 + len(ots[0]))), starts)
    ok("the game ends, last", ev[-1]["actionType"] == "game" and ev[-1]["subType"] == "end" and ev[-1]["period"] == 4 + len(ots[0]))
    made = {1: 0, 2: 0}
    for e in ev:
        if e.get("success") == 1:
            made[e["tno"]] += {"2pt": 2, "3pt": 3, "freethrow": 1}[e["actionType"]]
    ok("the made shots add up to the score", (made[1], made[2]) == score, made)
    tally, shots = {}, {}
    for e in ev:
        k = COUNTED.get((e["actionType"], e.get("subType")))
        if k and e["pno"]:
            tally[(e["tno"], e["pno"], k)] = tally.get((e["tno"], e["pno"], k), 0) + 1
        if e["actionType"] in ("2pt", "3pt", "freethrow") and e["pno"]:
            s = shots.setdefault((e["tno"], e["pno"], e["actionType"]), [0, 0])
            s[0] += e.get("success", 0); s[1] += 1
    FG = {"2pt": "sTwoPointers", "3pt": "sThreePointers", "freethrow": "sFreeThrows"}
    off = [(p["name"], k, tally.get((t, pno, k), 0), p[k]) for t, side in ((1, h), (2, w)) for pno, p in side["pl"].items()
           for k in COUNTED.values() if tally.get((t, pno, k), 0) != p[k]]
    off += [(p["name"], f, shots.get((t, pno, f), [0, 0]), [p[FG[f] + "Made"], p[FG[f] + "Attempted"]])
            for t, side in ((1, h), (2, w)) for pno, p in side["pl"].items() for f in FG
            if shots.get((t, pno, f), [0, 0]) != [p[FG[f] + "Made"], p[FG[f] + "Attempted"]]]
    ok("every player's shots, rebounds, assists, steals, blocks and turnovers are his box score's", not off, off[:5])
    fouls = {id(e): e for e in ev if e["actionType"] == "foul"}
    by_n = {e["actionNumber"]: e for e in ev}
    drawn = [e for e in ev if e["actionType"] == "foulon"]
    ok("every drawn foul follows its foul, the other side's at the same clock",
       all(by_n.get(e.get("previousAction"), {}).get("actionType") == "foul" and e["previousAction"] == e["actionNumber"] - 1
           and by_n[e["previousAction"]]["tno"] != e["tno"] and by_n[e["previousAction"]]["gt"] == e["gt"] for e in drawn))
    ok("every player event names a player (a foul only the team can be given excepted)",
       all(e["pno"] for e in ev if e["actionType"] not in ("period", "game", "timeout", "jumpball", "foul")))

    tr, played, end = replay(raw)
    want = {f"{i}:{pno}": box_s(p["sMinutes"]) for i, k in enumerate(("1", "2")) for pno, p in raw["tm"][k]["pl"].items()}
    # THE BOX CLOCKS TENTHS, THE LOG WHOLE SECONDS. A player's TiempoJuego is summed from a clock that runs in
    # tenths; each line of the log shows the second. Every stint can lose or gain under a second at each end, so a
    # player in three or four stints may differ by up to three - and no more: a lost change shows as minutes.
    gap = {pid: (round(played.get(pid, 0) / 1000), s) for pid, s in want.items() if abs(round(played.get(pid, 0) / 1000) - s) > 3}
    ok("every player's minutes replay to the box score's, to the clock's seconds (%d players)" % len(want), not gap, gap)
    team = [sum(played.get(f"{i}:{pno}", 0) for pno in raw["tm"][k]["pl"]) for i, k in enumerate(("1", "2"))]
    ok("five on the floor a side for the whole game (%d:%02d)" % (end // 60000, end // 1000 % 60), team == [5 * end, 5 * end], (team, end))
    ok("...and nothing left unpaired", not [x for x in tr["report"]["warnings"] if "unpaired substitution" in x],
       tr["report"]["warnings"])
    ok("...every event's player found", tr["report"]["unmatched"] == 0, tr["report"]["unmatched"])

print("\n-- names, the box score and the play-by-play's odd lines")
b = Offline().fetch("laliga-112600-112553-1", {})
fr = b.raw["tm"]["1"]["pl"]["219791"]
ok("a player keyed on his IdJugador, his line", (fr["shirtNumber"], fr["sMinutes"], fr["sPoints"], fr["starter"], fr["sReboundsTotal"],
                                                 fr["sPlusMinusPoints"]) == ("7", "33:41", 23, 1, 10, -8),
   (fr["shirtNumber"], fr["sMinutes"], fr["sPoints"], fr["starter"], fr["sReboundsTotal"], fr["sPlusMinusPoints"]))
ok("...his name as the feed wrote it, names.py's to decide", (fr["firstName"], fr["familyName"], fr["name"]) ==
   ("MARTIN", "FRANCHINO", "FRANCHINO, MARTIN") and N.person(fr)[:2] == ("Martin", "Franchino"), (fr["firstName"], fr["familyName"]))
jr = b.raw["tm"]["1"]["pl"]["430339"]
ok("...a suffix stays with the family name", N.person(jr)[:2] == ("Melvin Tyriek", "Johnson Jr"), N.person(jr)[:2])
dnp = b.raw["tm"]["1"]["pl"]["428243"]
ok("a player who did not come on is inactive", dnp["active"] == 0 and dnp["sMinutes"] == "0:00")
ok("his photo", fr.get("photoT") == "https://www.laliganacional.com.ar/fotos/219791")
ok("the club's code and crest", (b.raw["tm"]["1"]["code"], b.raw["tm"]["1"]["logoT"]["url"]) ==
   ("63", "https://www.laliganacional.com.ar/escudos/63/112600"))
ev = b.raw["pbp"]
mended = [e for e in ev if e["actionType"] == "foul" and e["period"] == 3 and e["gt"] == "02:19"]
ok("a foul line the site left out is put back, on the one player it can be (Franchino, his fourth)",
   len(mended) == 1 and mended[0]["pno"] == "219791" and mended[0]["tno"] == 1, mended)
ok("the opening tip from the arrow: Gimnasia won it", [(e["subType"], e["tno"]) for e in ev if e["actionType"] == "jumpball"]
   == [("lost", 1), ("won", 2)])
b = Offline().fetch("laliga-114607-113546-1", {})
bench = [e for e in b.raw["pbp"] if e.get("subType") == "coachtechnical"]
ok("the bench's technical (TBANQUILLO-C) is the team's, not a player's", len(bench) == 1 and bench[0]["pno"] == ""
   and bench[0]["tno"] == 2 and bench[0]["period"] == 5, bench)
ann = [e for e in b.raw["pbp"] if e["actionType"] == "substitution" and e["period"] == 5 and e["gt"] == "05:00"]
ok("an overtime's announcement: one balanced change at 5:00", len(ann) % 2 == 0
   and sum(1 for e in ann if e["subType"] == "in") == sum(1 for e in ann if e["subType"] == "out"), ann)
ok("foul kinds by their words", (L.foul_kind("FALTA-TECNICA"), L.foul_kind("FALTA-ANTIDEPORTIVA"), L.foul_kind("TBANQUILLO-B"),
                                 L.foul_kind("CANASTA-2P")) == ("technical", "unsportsmanlike", "benchtechnical", None))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
