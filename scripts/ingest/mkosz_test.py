"""Hungary's NB I/A, men and women (adapters/mkosz.py), offline:

    python scripts/ingest/mkosz_test.py

The federation's programme page (mkosz.hu/bajnoksag-musor/<season>/<nat>/) lists a competition's games;
each game's netcasting storage file (netcasting4.webpont.com/storage/full<code>.html) is its rosters,
minutes and event log, which the adapter translates into the FIBA shape the pipeline already reads. What
this holds it to:
  * the programme: every game of the season and competition asked for (men hun, women whun, the
    play-offs hun_ply ...), Budapest time -> UTC, the clubs' federation ids as their codes, the hall,
    a played game final and one to come scheduled, and nothing from another season;
  * the feed decoded the way the page decodes it, and the box counted from the log the way the page
    counts it - checked column by column against the saved netcasting page of Szolnok 104-93 OSE Lions;
  * the play-by-play in FIBA's form: elapsed game time turned into the clock left in the period, the
    changes made in a break at the next period's 10:00, '3' on and '4' off, drawn fouls on their fouls,
    points adding up to the score;
  * THE MINUTES, REPLAYED: every player's minutes from the translated substitutions are the console's own
    to the second, with no unpaired substitution, in four games (men, women, play-offs); the one game whose
    log lost its changes (hun_134745) is caught and published as a result instead;
  * the shot chart's frame (360 x 240 px = the 28 x 15 m court).

Fixtures in scripts/ingest/data/mkosz/ (fetched 2026-10-15, gzipped): the 2026-27 programmes of hun,
whun and hun_ply (empty), 2025-26's hun_ply; the storage files of hun_134745 and hun_134777 (men),
whun_135517 and whun_135509 (women), hun_ply_134267 (2025-26 play-offs); and the two pages saved by hand,
the hunbasket.hu game centre and the netcasting page of hun_134745.
"""
import gzip
import math
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import mkosz as M  # noqa: E402
from translate.fiba_events import translate as fiba_translate  # noqa: E402
import names as N  # noqa: E402

DATA = os.path.join(HERE, "data", "mkosz")
PASS = FAIL = 0
GAMES = ("hun_134745", "hun_134777", "whun_135517", "whun_135509", "hun_ply_134267")
BROKEN = ("hun_134745", "hun_134747", "whun_135471", "whun_135473")     # logs that lost changes (2026-27 openers)


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:300]))


def text(name):
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        return f.read()


class Offline(M.MkoszAdapter):
    def __init__(self):
        super().__init__()
        self.asked = []

    def _get(self, url):
        self.asked.append(url)
        m = re.search(r"/bajnoksag-musor/(x\d{4})/([a-z_]+)/$", url)
        if m:
            name = f"musor_{m.group(1)}_{m.group(2)}.html.gz"
            return text(name) if os.path.exists(os.path.join(DATA, name)) else None
        m = re.search(r"/storage/full([a-z0-9_]+)\.html$", url)
        if m and m.group(1) in GAMES:
            return text(f"full_{m.group(1)}.txt.gz")
        return None


def feed(code):
    return M.decode(text(f"full_{code}.txt.gz"))


print("-- addresses")
ok("a season is x + its two years", [M.season_token({"season": s}) for s in ("2026-27", "2026/27", "2026", "x2526")]
   == ["x2627", "x2627", "x2627", "x2526"])
ok("...and back", M.season_name("x2627") == "2026-27")
ok("a competition from the row's nat, or its gender and stage",
   (M.nat_of({"nat": "whun_ply"}), M.nat_of({"stage": "playoffs"}), M.nat_of({"gender": "women", "stage": "playout"}))
   == ("whun_ply", "hun_ply", "whun_plya"))

print("\n-- the season's programme")
a = Offline()
men = list(a.discover("", {"season": "2026-27", "nat": "hun", "stage": "regular"}))
ok("the men's regular season: 14 clubs, 26 rounds, 182 games", len(men) == 182, len(men))
ok("...asked for at the address with its trailing slash", a.asked == ["https://mkosz.hu/bajnoksag-musor/x2627/hun/"], a.asked)
g = next(x for x in men if x.external_id == "hun_134745")
ok("the game's key is the netcasting code", g.external_id == "hun_134745")
ok("clubs as the federation names them", (g.home_name, g.away_name) == ("NHSZ-Szolnoki Olajbányász", "OSE Lions"), (g.home_name, g.away_name))
ok("the federation's club ids are the codes", (g.extra["home_code"], g.extra["away_code"]) == ("6015", "40010"), g.extra)
ok("crests of the season", g.extra["home_logo"] == "https://hunbasketimg.webpont.com/art/logo/x2627-6015.gif", g.extra["home_logo"])
ok("18:00 in Budapest (summer time) is 16:00 UTC", g.tipoff_at == "2026-09-25T16:00:00Z", g.tipoff_at)
ok("the hall", g.extra["venue"] == "Szolnok Városi Sportcsarnok", g.extra["venue"])
ok("a played game is final", g.status == "final")
late = next(x for x in men if x.external_id == "hun_134821")
ok("a game to come is scheduled", late.status == "scheduled" and late.tipoff_at == "2026-10-28T17:30:00Z", (late.status, late.tipoff_at))
ok("every id is this competition's", all(re.fullmatch(r"hun_\d+", x.external_id) for x in men))
wom = list(Offline().discover("", {"season": "2026-27", "nat": "whun"}))
ok("the women's: 110 games, whun_ ids", len(wom) == 110 and all(x.external_id.startswith("whun_") for x in wom), len(wom))
ok("a women's game", any(x.external_id == "whun_135517" and x.home_name == "Csata TKK" and x.away_name == "KSC Szekszárd" for x in wom))
po = list(Offline().discover("", {"season": "2025-26", "nat": "hun_ply", "stage": "playoffs"}))
ok("a past season's play-offs (the backfill's address): 40 games, all final",
   len(po) == 40 and all(x.status == "final" for x in po) and po[0].external_id == "hun_ply_134267", (len(po), po[:1]))
ok("...tagged with their stage", po[0].extra["stage"] == "playoffs")
ok("this season's play-offs, not yet drawn: none", list(Offline().discover("", {"season": "2026-27", "nat": "hun_ply"})) == [])
ok("a page of another season is never filed under the one asked for",
   M.schedule_rows(text("musor_x2627_hun.html.gz"), "x2526", "hun") == [])
now = datetime(2026, 10, 17, 17, 0, tzinfo=timezone.utc)
ok("status: to come / under way / over / not played",
   (M.status_of("2026-10-18T16:00:00Z", (0, 0), now), M.status_of("2026-10-17T16:00:00Z", (40, 38), now),
    M.status_of("2026-10-16T16:00:00Z", (90, 80), now), M.status_of("2026-10-16T16:00:00Z", (0, 0), now))
   == ("scheduled", "live", "final", "scheduled"))

print("\n-- the feed")
d = feed("hun_134745")
ok("decoded the page's way", d and d["i"]["hid"] == "6015" and d["i"]["hp"] == "104" and len(d["f"]) == 1280)
ok("the tweets are cut off before decoding", d and "twitter" not in d)
ok("a broken file is None, not an exception", M.decode("{\"i|x#") is None and M.decode("") is None)
ros = M.roster(d)
ok("the roster: starter, shirt, seconds, side", ros["A441829"] == {"starter": False, "shirt": "0", "short": "Pierre-Louis J.",
                                                                   "secs": 1181, "tno": 1}, ros["A441829"])
ok("five starters a side", [sum(1 for r in ros.values() if r["starter"] and r["tno"] == t) for t in (1, 2)] == [5, 5])
nm = M.full_names(d)
ok("full names from the players list, family name first in the feed", nm["A441829"][:2] == ("Josh", "PIERRE-LOUIS"), nm["A441829"])
ok("...which names.py turns into a name", N.person({"firstName": "Josh", "familyName": "PIERRE-LOUIS"})[:2] == ("Josh", "Pierre-Louis"))
ok("photographs over https", nm["A441829"][2] == "https://15th.webpont.com/art/player/photo/n5/A441829.png", nm["A441829"][2])
ok("the clock: elapsed game time -> time left in the period",
   (M.clock_left(18, 1), M.clock_left(600, 1), M.clock_left(600, 2), M.clock_left(2410, 5)) == ("09:42", "00:00", "10:00", "04:50"))
ok("a play at a boundary is the old period's until its end is read",
   (M.period_at(600, set()), M.period_at(600, {1}), M.period_at(601, set()), M.period_at(2400, {1, 2, 3, 4})) == (1, 2, 2, 5))

print("\n-- the saved netcasting page (Szolnok 104-93 OSE Lions): the box, column by column")
raw45 = M.MkoszAdapter.translate(d, "hun_134745")
page = text("netcasting_hun_134745.html.gz")
rows = {}
for m in re.finditer(r'<tr class="([AB]\d+)[^"]*">(.*?)</tr>', page, re.S):
    rows.setdefault(m.group(1), dict(re.findall(r'<span class="(TT[a-z0-9]+)">([^<]*)</span>', m.group(2))))
COLS = {"TTp": "sPoints", "TT2m": "sTwoPointersMade", "TT2a": "sTwoPointersAttempted", "TT3m": "sThreePointersMade",
        "TT3a": "sThreePointersAttempted", "TT1m": "sFreeThrowsMade", "TT1a": "sFreeThrowsAttempted",
        "TTrd": "sReboundsDefensive", "TTro": "sReboundsOffensive", "TTrt": "sReboundsTotal", "TTst": "sSteals",
        "TTto": "sTurnovers", "TTas": "sAssists", "TTf": "sFoulsPersonal", "TTfa": "sFoulsOn", "TTb": "sBlocks"}
pl45 = {**raw45["tm"]["1"]["pl"], **raw45["tm"]["2"]["pl"]}
secs = lambda s: (lambda m_, s_: int(m_) * 60 + int(s_))(*str(s or "0:00").split(":"))
diff = [(c, k, v, pl45.get(c, {}).get(f)) for c, cells in rows.items() for k, f in COLS.items()
        if k in cells and str(pl45.get(c, {}).get(f)) != cells[k].strip()]
ok("every player of the page's box is in the translation (24)", len(rows) == 24 and set(rows) == set(pl45), (len(rows), set(rows) ^ set(pl45)))
ok("every counting column is the page's", not diff, diff[:6])
ok("every player's minutes are the page's", all(secs(pl45[c]["sMinutes"]) == secs(cells["TTm"]) for c, cells in rows.items()))
ok("Pierre-Louis: 14 points, 5/8, 1/2, 1/2, 4 rebounds, 19:41", (pl45["A441829"]["sPoints"], pl45["A441829"]["sTwoPointersMade"],
   pl45["A441829"]["sReboundsTotal"], pl45["A441829"]["sMinutes"]) == (14, 5, 4, "19:41"))
h, w = raw45["tm"]["1"], raw45["tm"]["2"]
ok("the score and the quarters", (h["score"], w["score"], [h[f"p{i}_score"] for i in range(1, 5)]) == (104, 93, [30, 26, 20, 28]),
   (h["score"], w["score"], [h.get(f"p{i}_score") for i in range(1, 5)]))
ok("the clubs: federation id, name, short name, crest", (h["code"], h["name"], h["shortName"], h["logoT"]["url"]) ==
   ("6015", "NHSZ-Szolnoki Olajbányász", "Szolnoki Olajbanyasz", "https://hunbasketimg.webpont.com/art/logo/x2627-6015.gif"),
   (h["code"], h["name"], h["shortName"], h.get("logoT")))
club_reb = sum(1 for e in d["f"] if M._code(e) in (2002, 2003) and str(e.get("1")) == "1")
ok("the club's own rebounds in its totals, as LiveStats counts them (%d)" % club_reb,
   club_reb and h["tot_sReboundsTotal"] == sum(p["sReboundsTotal"] for p in h["pl"].values()) + club_reb,
   (h["tot_sReboundsTotal"], club_reb))
ok("THE LOG THAT LOST ITS CHANGES is repaired, not dropped", raw45["mkosz"]["log_ok"] and raw45["mkosz"]["repaired"] > 0,
   (raw45["mkosz"]["why"], raw45["mkosz"]["repaired"]))
b45 = Offline().fetch("hun_134745", {"_tipoff_at": "2026-09-25T16:00:00Z"})
ok("...and published with its event log and lineups",
   b45 and b45.translate is not False and b45.stints and b45.status == "final" and b45.team["home"].get("points") == 104,
   b45 and (b45.translate, len(b45.stints), b45.status))
ok("...the hall from the feed, the tip-off from the programme", b45 and b45.venue == "Szolnok Városi Sportcsarnok" and b45.tipoff_at == "2026-09-25T16:00:00Z")

print("\n-- the play-by-play, and THE MINUTES REPLAYED")


def minutes_replay(raw):
    tr = fiba_translate(raw)
    fmt = tr["format"]
    cum = lambda p, c: (min(p, fmt["periods"]) - 1) * fmt["period_ms"] + max(0, p - fmt["periods"] - 1) * fmt["ot_ms"] \
        + ((fmt["period_ms"] if p <= fmt["periods"] else fmt["ot_ms"]) - c)
    on, since, played = [set(tr["starters"][0]), set(tr["starters"][1])], {}, {}
    for side in (0, 1):
        for pid in on[side]:
            since[pid] = 0
    end = 0
    for ev in tr["events"]:
        if ev["t"] == "sub":
            t, now_ = ev["team"], cum(ev["period"], ev["clock"])
            o, i = ev["payload"].get("out"), ev["payload"].get("in")
            if o in since:
                played[o] = played.get(o, 0) + now_ - since.pop(o)
            on[t].discard(o)
            if i and i not in on[t]:
                on[t].add(i); since[i] = now_
        if ev["t"] == "game_end":
            end = cum(ev["period"], ev["clock"])
    for pid, t0 in since.items():
        played[pid] = played.get(pid, 0) + end - t0
    want = {f"{i}:{pno}": secs(p.get("sMinutes")) for i, k in enumerate(("1", "2")) for pno, p in (raw["tm"][k].get("pl") or {}).items()}
    off = {pid: (round(played.get(pid, 0) / 1000), s) for pid, s in want.items() if abs(round(played.get(pid, 0) / 1000) - s) > 1}
    return tr, want, off


for code in GAMES[1:]:
    dd = feed(code)
    raw = M.MkoszAdapter.translate(dd, code)
    ev = raw["pbp"]
    tr, want, off = minutes_replay(raw)
    made = {1: 0, 2: 0}
    for e in ev:
        if e.get("success") == 1:
            made[e["tno"]] += {"2pt": 2, "3pt": 3, "freethrow": 1}[e["actionType"]]
    hs, as_ = raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]
    print(f"   {code}: {raw['tm']['1']['name']} {hs}-{as_} {raw['tm']['2']['name']}")
    ok(f"{code}: the made shots add up to the score", made == {1: hs, 2: as_} and (hs, as_) == (int(dd["i"]["hp"]), int(dd["i"]["vp"])), (made, hs, as_))
    ok(f"{code}: ...and to the box's points", [sum(p["sPoints"] for p in raw["tm"][k]["pl"].values()) for k in ("1", "2")] == [hs, as_])
    ok(f"{code}: ...and to the quarters", [sum(raw["tm"][k][f"p{i}_score"] for i in range(1, 5)) for k in ("1", "2")] == [hs, as_])
    ok(f"{code}: events numbered oldest first", [e["actionNumber"] for e in ev] == list(range(1, len(ev) + 1)))
    ok(f"{code}: four periods opened and closed, then the game ends",
       [(e["period"], e["subType"]) for e in ev if e["actionType"] == "period"] == [(p, s) for p in range(1, 5) for s in ("start", "end")]
       and ev[-1]["actionType"] == "game" and ev[-1]["subType"] == "end", [(e["period"], e["subType"]) for e in ev if e["actionType"] == "period"])
    ok(f"{code}: every player event names a rostered player", all(e["pno"] in raw["tm"][str(e["tno"])]["pl"] for e in ev
                                                                    if e["actionType"] not in ("period", "game", "timeout") and e["pno"]))
    subs = [e for e in ev if e["actionType"] == "substitution"]
    ok(f"{code}: each change an out and an in at one clock", len(subs) % 2 == 0 and all(
        (x["subType"], y["subType"]) == ("out", "in") and (x["period"], x["gt"], x["tno"]) == (y["period"], y["gt"], y["tno"])
        for x, y in zip(subs[::2], subs[1::2])))
    ok(f"{code}: nobody changed after the final buzzer", not any(e["actionType"] == "substitution" and e["actionNumber"] >
                                                               max(x["actionNumber"] for x in ev if x["actionType"] == "period") for e in ev))
    ok(f"{code}: EVERY PLAYER'S MINUTES ARE THE CONSOLE'S, to the second ({len(want)} players)", not off, off)
    ok(f"{code}: ...nothing left unpaired", not [x for x in tr["report"]["warnings"] if "unpaired substitution" in x], tr["report"]["warnings"])
    ok(f"{code}: ...the log is trusted", raw["mkosz"]["log_ok"], raw["mkosz"]["why"])
    fouls = {e["actionNumber"]: e for e in ev if e["actionType"] == "foul"}
    fo = [e for e in ev if e["actionType"] == "foulon"]
    ok(f"{code}: a drawn foul follows its foul, by the other club ({len(fo)})",
       fo and all(e["previousAction"] in fouls and fouls[e["previousAction"]]["tno"] != e["tno"]
                  and e["actionNumber"] > e["previousAction"] for e in fo))

print("\n-- A LOG THAT LOST ITS CHANGES, rebuilt: five a side all game")


def floor_walk(raw):
    """through the translation: ms each side spent other than five on the floor, and each side's total ms"""
    tr = fiba_translate(raw)
    fmt = tr["format"]
    cum = lambda p, c: (min(p, fmt["periods"]) - 1) * fmt["period_ms"] + max(0, p - fmt["periods"] - 1) * fmt["ot_ms"] \
        + ((fmt["period_ms"] if p <= fmt["periods"] else fmt["ot_ms"]) - c)
    on, not5, prev, end = [set(tr["starters"][0]), set(tr["starters"][1])], [0, 0], 0, 0
    for ev in tr["events"]:
        if ev["t"] not in ("sub", "game_end"):
            continue
        now_ = cum(ev["period"], ev["clock"])
        for s in (0, 1):
            not5[s] += (now_ - prev) * (len(on[s]) != 5)
        prev = now_
        if ev["t"] == "game_end":
            end = now_
            break
        t, o, i = ev["team"], ev["payload"].get("out"), ev["payload"].get("in")
        on[t].discard(o)
        if i:
            on[t].add(i)
    return tr, not5, end


for code in BROKEN:
    dd = feed(code)
    raw = M.MkoszAdapter.translate(dd, code)
    tr, not5, end = floor_walk(raw)
    ros = M.roster(dd)
    official = [sum(r["secs"] for r in ros.values() if r["tno"] == t) for t in (1, 2)]
    print(f"   {code}: {raw['tm']['1']['name']} - {raw['tm']['2']['name']}, {raw['mkosz']['repaired']} repair(s);"
          f" the console's own minutes add up to {M.mmss(official[0])} and {M.mmss(official[1])} a side")
    ok(f"{code}: the log contradicts itself, and is repaired", M.replay(dd)["bad"] and raw["mkosz"]["repaired"] and raw["mkosz"]["log_ok"],
       (M.replay(dd)["bad"], raw["mkosz"]["repaired"], raw["mkosz"]["why"]))
    ok(f"{code}: FIVE A SIDE EVERY SECOND OF THE GAME", not5 == [0, 0] and end == 4 * 600000, (not5, end))
    ok(f"{code}: ...nothing left unpaired", not [x for x in tr["report"]["warnings"] if "unpaired substitution" in x], tr["report"]["warnings"])
    rp = M.replay(dd)
    ok(f"{code}: ...each side's minutes add to 200:00", [sum(v for p, v in rp["played"].items() if ros[p]["tno"] == t) for t in (1, 2)] == [12000, 12000])
    ok(f"{code}: ...the score still the score", (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]) == (int(dd["i"]["hp"]), int(dd["i"]["vp"])))
ok("a clean log is never touched (no repairs in the four trusted games)",
   all(M.MkoszAdapter.translate(feed(c), c)["mkosz"]["repaired"] == 0 and "subs" not in M.replay(feed(c)) for c in GAMES[1:]))

print("\n-- the changes made in a break are the next period's 10:00 (hun_134777)")
raw77 = M.MkoszAdapter.translate(feed("hun_134777"), "hun_134777")
ends = [e["actionNumber"] for e in raw77["pbp"] if e["actionType"] == "period" and e["subType"] == "end"]
brk = [e for e in raw77["pbp"] if e["actionType"] == "substitution" and ends[0] < e["actionNumber"] and e["period"] == 2 and e["gt"] == "10:00"]
ok("changes after the first quarter's end are filed at Q2 10:00", len(brk) >= 2, len(brk))
ok("...after the period's start, never before it",
   all(e["actionNumber"] > next(x["actionNumber"] for x in raw77["pbp"] if x["actionType"] == "period" and x["subType"] == "start" and x["period"] == 2) for e in brk))
ok("free throws are free throws, a close two has no shot type, a mid-range two is a jump shot, a dunk a dunk",
   {e["actionType"] for e in raw77["pbp"] if e["actionType"] in ("2pt", "3pt", "freethrow")} == {"2pt", "3pt", "freethrow"}
   and any(e["actionType"] == "2pt" and "subType" not in e for e in raw77["pbp"]))

print("\n-- the shot chart (360 x 240 px = 28 x 15 m)")
places, kinds = [], []
for code in GAMES:
    r = M.MkoszAdapter.translate(feed(code), code)
    by_n = {e["actionNumber"]: e for e in r["pbp"]}
    for t in ("1", "2"):
        for s in r["tm"][t]["shot"]:
            places.append(s); kinds.append(by_n[s["actionNumber"]])
ok("every placed shot is a field goal of the log, its result the play's",
   all(k["actionType"] == s["actionType"] and k.get("success") == s["r"] for s, k in zip(places, kinds)), len(places))
dist = lambda s: math.hypot((min(s["x"], 100 - s["x"]) / 100 * 28) - 1.575, (s["y"] / 100 - 0.5) * 15)
twos = [dist(s) for s in places if s["actionType"] == "2pt"]
threes = [dist(s) for s in places if s["actionType"] == "3pt"]
ok("twos inside the line, threes outside it (a marker's 0.4 m allowed) - %d shots" % len(places),
   len(places) > 600 and max(twos) <= 7.15 and min(threes) >= 6.2, (max(twos), min(threes)))
dunks = [dist(s) for s, k in zip(places, kinds) if k.get("subType") == "dunk"]
ok("the dunks at the rim", dunks and max(dunks) <= 0.6, dunks)
r77 = M.MkoszAdapter.translate(feed("hun_134777"), "hun_134777")
tr77 = fiba_translate(r77)
ok("the places reach the event log", sum(1 for e in tr77["events"] if e["t"] == "loc") == len(r77["tm"]["1"]["shot"]) + len(r77["tm"]["2"]["shot"]))

print("\n-- fetching")
a = Offline()
b = a.fetch("hun_134777", {"_tipoff_at": "2026-10-10T16:00:00Z"})
ok("a game fetched from its storage file, one request", b is not None and a.asked == ["https://netcasting4.webpont.com/storage/fullhun_134777.html"], a.asked)
ok("...final, translated, its lineups replayed", b and b.status == "final" and b.translate is not False and len(b.stints) > 10,
   b and (b.status, b.translate, len(b.stints)))
a = Offline()
ok("a game not yet tipped off: no request", a.fetch("hun_134797", {"_tipoff_at": "2099-10-17T17:00:00Z"}) is None and a.asked == [], a.asked)
ok("a key that is not a game's: no request", Offline().fetch("../etc", {}) is None)
fresh = dict(feed("whun_135517"), jr="0")
fresh["f"] = [e for e in fresh["f"] if M._code(e) in (1, 2, 1102, 6001)]
ok("rosters entered, nothing played: not started", not M.MkoszAdapter.started(fresh))
live = dict(feed("whun_135517"), jr="1")
live["f"] = [e for e in live["f"] if M._gt(e) < 900]
rl = M.MkoszAdapter.translate(live, "whun_135517")
ok("a game under way: no game end, the log trusted (minutes are only checked once it is over)",
   not any(e["actionType"] == "game" for e in rl["pbp"]) and rl["mkosz"]["log_ok"], rl["mkosz"]["why"])

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
