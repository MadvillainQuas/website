"""U SPORTS (adapters/usports.py), offline, over captured pages:

    python scripts/ingest/usports_test.py

What it holds the adapter to:
  * the schedule: season-less source URLs (#playoffs / #final8) read the right season path,
    the 500-event cap recovered from the club pages, exhibitions never discovered (the flagged
    ones and the one whose notes alone say so), conference_game False for every postseason game
    and True for every regular-season game the site flags 'conf' (and the site's flag agreeing
    with config/groups/usports.json), the event id as the key whether or not a box exists,
    tip-offs in UTC, and every club's code the same in discover() and fetch();
  * one game: every player's box exactly the site's, the clubs' totals and the final score
    exactly the site's (the shots the box credits to no player included), the period scores,
    five starters, stints five a side covering the whole game and adding up to the score, every
    play-by-play event numbered in order, translate() dropping and unmatching nothing, and the
    event log summing to the same box - bar the site's own documented quirks;
  * fetch() without discover() (the live lane) finding the game through its details page, and a
    game in progress read as live, never as final.

Fixtures live in scripts/ingest/data/usports/ (captured 2026-09-23, gzipped).
"""
import gzip
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import usports as U  # noqa: E402
from translate.fiba_events import translate  # noqa: E402
import groups  # noqa: E402

DATA = os.path.join(HERE, "data", "usports")
PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


def fixture(name, encoding="utf-8"):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rb") as f:
        return f.read().decode(encoding, errors="replace")


def fixture_for(url):
    u = url.replace(U.SITE, "")
    m = re.match(r"/sports/mbkb/(\d{4}-\d{2}[pc]?)/(schedule|boxscores/([^?]+)\.xml)(\?.*)?$", u)
    if not m:
        return None, "utf-8"
    sp, q = m.group(1), m.group(4) or ""
    if m.group(3):
        return f"game-{sp}_{m.group(3)}.html.gz", "utf-8"
    if q == "?print=ical":
        return f"ical-{sp}.ics.gz", "cp1252"
    if q.startswith("?teamId="):
        return f"team-{sp}-{q[8:]}.html.gz", "utf-8"
    if q.startswith("?eid="):
        return f"event-{sp}-{q[5:]}.html.gz", "utf-8"
    return f"schedule-{sp}.html.gz", "utf-8"


class Offline(U.USportsAdapter):
    """The real adapter with its one network call served from the fixtures."""
    requests_made: list = []

    def _get_text(self, url, encoding="utf-8"):
        self.requests_made.append(url)
        name, enc = fixture_for(url)
        return fixture(name, enc) if name else None


def fresh():
    U.USportsAdapter._events = {}
    U.USportsAdapter._icals = {}
    Offline.requests_made = []
    return Offline()


REG = U.SITE + "/sports/mbkb/schedule"
PO, F8 = REG + "#playoffs", REG + "#final8"

# ============================================================================ seasons, URLs
print("-- seasons and source URLs")
for tok, want in {"2026-27": "2026-27", "2026/27": "2026-27", "2026/2027": "2026-27", "2026": "2026-27",
                  "1999-00": "1999-00", "2025-27": None, "E2025": None}.items():
    ok(f"season token {tok!r} -> {want}", U.normalize_season(tok) == want, U.normalize_season(tok))
ok("current season from August on is the one starting that year",
   U.current_season(datetime(2026, 8, 1, tzinfo=timezone.utc)) == "2026-27"
   and U.current_season(datetime(2026, 7, 31, tzinfo=timezone.utc)) == "2025-26")
ok("the season-less URLs: regular / #playoffs / #final8",
   [U.parse_source_url(u)["stage"] for u in (REG, PO, F8)] == ["regular", "playoffs", "final8"]
   and all(U.parse_source_url(u)["season"] is None for u in (REG, PO, F8)))
ok("a URL naming a season path pins it",
   U.parse_source_url(U.SITE + "/sports/mbkb/2024-25p/schedule") == {"stage": "playoffs", "season": "2024-25"})
try:
    U.parse_source_url(REG + "#cup")
    raised = False
except ValueError:
    raised = True
ok("an unknown fragment is an error, not a quiet regular season", raised)
ok("team codes are the site's stats slugs",
   [U.team_code(n) for n in ("Toronto Metropolitan", "Saint Mary's", "Bishop's", "StFX", "UBCO")]
   == ["torontometropolitan", "saintmarys", "bishops", "stfx", "ubco"])

# ============================================================================ discover()
print("\n-- discover()")
a = fresh()
reg = list(a.discover(REG, {"season": "2025-26"}))
asked_reg = list(Offline.requests_made)
po = list(a.discover(PO, {"season": "2025-26"}))
f8 = list(a.discover(F8, {"season": "2025-26"}))
ok("2025-26 regular season: 488 games (the conference schedule), all final", len(reg) == 488
   and all(g.status == "final" for g in reg), (len(reg), {g.status for g in reg}))
ok("conference playoffs: 29 games; Final 8: 11", len(po) == 29 and len(f8) == 11, (len(po), len(f8)))
ok("the list's 500-event cap: the rest came from club pages (and only as many as needed)",
   sum(1 for u in asked_reg if "teamId=" in u) == 35 and asked_reg[0].endswith("/2025-26/schedule")
   and asked_reg[1].endswith("/2025-26/schedule?print=ical"), [u[-40:] for u in asked_reg[:3]])
late = [g for g in reg if (g.tipoff_at or "") >= "2026-01-16"]
ok("games after the cap are there (16 Jan - 21 Feb 2026)", len(late) >= 190, len(late))
ical = U.parse_ical(fixture("ical-2025-26.ics.gz", "cp1252"))
ok("the iCal lists all 698 regular-season events", len(ical) == 698, len(ical))
ids = {g.external_id for g in reg} | {g.external_id for g in po} | {g.external_id for g in f8}
ok("the key is the PrestoSports event id (16 characters), unique across the three paths",
   len(ids) == 528 and all(re.fullmatch(r"[a-z0-9]{16}", i) for i in ids))
ok("exhibitions are never discovered (the 209 flagged ones, and UQAM v St Michael's whose notes say so)",
   "exhibition" not in " ".join(str(g.extra.get("notes") or "").lower() for g in reg)
   and not any("St Michael" in (g.home_name + g.away_name) for g in reg))
nonconf_left = [e for e, v in ical.items() if "St Michael" in v["summary"] and "UQAM" in v["summary"]]
ok("...the UQAM v St Michael's event exists on the site and is left out",
   nonconf_left and not (set(nonconf_left) & ids), nonconf_left)
ok("conference_game: True for every regular-season game (all flagged conf by the site)",
   all(g.extra.get("conference_game") is True for g in reg))
ok("conference_game: False for every playoff and Final 8 game",
   all(g.extra.get("conference_game") is False for g in po + f8))
row_classes = {r["eid"]: r["classes"] for r in U.parse_schedule_rows(fixture("schedule-2025-26p.html.gz"), "2025-26p")}
conf_po = [g for g in po if "conf" in row_classes.get(g.external_id, [])]
ok("...including the 3 playoff games the site ALSO flags conf", len(conf_po) == 3
   and all(g.extra["conference_game"] is False for g in conf_po), len(conf_po))
spec_src = {"groups_file": "config/groups/usports.json"}
same = [groups.same_group(spec_src, "2025-26", g.home_name, g.away_name) for g in reg]
ok("the site's conf flag agrees with config/groups/usports.json on all 488 (same conference)",
   all(s is True for s in same), sum(1 for s in same if s is not True))
names_all = {g.home_name for g in reg + po + f8} | {g.away_name for g in reg + po + f8}
table = groups.membership(groups.load("config/groups/usports.json"), "2025-26")
ok("every club name the schedule uses is a spelling in config/groups/usports.json (48 clubs)",
   len(names_all) == 48 and all(groups.fold(n) in table for n in names_all), sorted(n for n in names_all if groups.fold(n) not in table))
ok("tip-offs are UTC ISO-8601", all(g.tipoff_at and g.tipoff_at.endswith("+00:00") for g in reg + po + f8))
g0 = next(g for g in reg if g.external_id == "cfrm4zwonl577zdh")
ok("UFV at Victoria, 10 Jan 2026 19:00 Pacific = 03:00 UTC on the 11th, venue from the iCal",
   g0.home_name == "Victoria" and g0.away_name == "UFV" and g0.tipoff_at == "2026-01-11T03:00:00+00:00",
   (g0.home_name, g0.away_name, g0.tipoff_at, g0.extra.get("venue")))
ok("codes are the folded names, crests https", g0.extra["home_code"] == "victoria" and g0.extra["away_code"] == "ufv"
   and g0.extra["home_logo"].startswith("https://cdn.prestosports.com/"), g0.extra)
f8g = next(g for g in f8 if g.extra.get("notes") and "Championship" in g.extra["notes"])
ok("the Final 8 final: Bishop's (home) v Carleton, neutral, rank prefixes stripped",
   f8g.home_name == "Bishop's" and f8g.away_name == "Carleton" and f8g.extra["neutral"], (f8g.home_name, f8g.away_name))
# THE KEY MUST NOT MOVE when the box is posted: the same page with every box link removed
html = fixture("schedule-2025-26p.html.gz")
unboxed = re.sub(r'data-boxscore="[^"]*"', "", re.sub(r'href="[^"]*/boxscores/[^"]*"', 'href="#"', html))
k_before = [r["eid"] for r in U.parse_schedule_rows(unboxed, "2025-26p")]
k_after = [r["eid"] for r in U.parse_schedule_rows(html, "2025-26p")]
ok("a fixture's key is the same before its box exists as after", k_before == k_after and all(k_after))
a = fresh()
g_next = list(a.discover(REG, {"season": "2026-27"}))
ok("2026-27 (nothing published yet): an empty season, not an error", g_next == [])
ok("no season configured = the current season", U.USportsAdapter._season({}) == U.current_season())
try:
    list(fresh().discover(REG, {"season": "twenty"}))
    raised = False
except ValueError:
    raised = True
ok("a season token that is not a season is an error", raised)
ok("the registry knows it", type(get_adapter("usports")).__name__ == "USportsAdapter")

# ============================================================================ fetch() -> bundle
print("\n-- fetch(): one game, end to end, against the site's own box")
disc = {g.external_id: g for g in reg + po + f8}
by_box = {(g.extra.get("box_url") or "").rsplit("/", 1)[-1][:-4]: g for g in disc.values() if g.extra.get("box_url")}
#: where the site's own box disagrees with its own play-by-play, the box is stored as published
#: and the event log follows the play-by-play; every such game is pinned here exactly.
QUIRKS = {
    # the box credits Kole Scott (Mount Royal #1) 4 assists; the play-by-play has 3 (and the team's
    # box AST is 13 against 12 assist lines)
    "20251107_e9f1": {"log": {"Kole Scott ast log=3 box=4"}},
}
#: minutes: the box's whole minutes against the replayed substitutions. The crews below keep
#: lineup data that contradicts itself (Memorial's first-quarter minutes add up to 43 of 50), so
#: one player ends a few minutes off; everyone else stays within the rounding.
MINUTES_MAX_S = {"20251024_chk2": 400}
GAMES = ["20260110_cfrm", "20251128_l3bo", "20260208_za1a", "20251024_chk2", "20251107_e9f1", "20260225_kx6b",
         "20260308_twon"]


def site_box(html):
    box = U.parse_box(html)
    box.pop("_root", None)
    return box


def check(label, b, html, quirk=None, max_min_s=150):
    quirk = quirk or {}
    raw = b.raw
    box = site_box(html)
    side_of = {"1": 1, "2": 0}                          # tno -> the page's side (0 visitor, 1 home)
    # (1) every player of the site's box, every field
    diffs = []
    F = {"sPoints": "pts", "sFieldGoalsMade": "fgm", "sFieldGoalsAttempted": "fga", "sThreePointersMade": "fg3m",
         "sThreePointersAttempted": "fg3a", "sFreeThrowsMade": "ftm", "sFreeThrowsAttempted": "fta",
         "sReboundsOffensive": "oreb", "sReboundsDefensive": "dreb", "sReboundsTotal": "treb",
         "sAssists": "ast", "sSteals": "stl", "sBlocks": "blk", "sTurnovers": "tov", "sFoulsPersonal": "pf"}
    n = 0
    for tno in "12":
        for p in box["teams"][side_of[tno]]["players"]:
            n += 1
            mine = raw["tm"][tno]["pl"].get(p["jersey"])
            if mine is None:
                diffs.append(f"#{p['shirt']} {p['name']}: missing")
                continue
            diffs += [f"#{p['shirt']} {k} {mine[k]} != {p[v]}" for k, v in F.items() if mine[k] != p[v]]
            if mine["sTwoPointersMade"] != p["fgm"] - p["fg3m"] or mine["sMinutes"] != "%d:00" % p["min"]:
                diffs.append(f"#{p['shirt']} 2P/min")
    ok(f"{label}: every player's box = the site's box ({n} players)", not diffs, diffs[:6])
    # (2) the clubs' totals and the score
    tdiff = []
    for tno in "12":
        t, s = raw["tm"][tno], side_of[tno]
        pts = 2 * t["tot_sFieldGoalsMade"] + t["tot_sThreePointersMade"] + t["tot_sFreeThrowsMade"]
        if not (t["score"] == box["teams"][s]["score"] == t["tot_sPoints"] == pts):
            tdiff.append((tno, t["score"], box["teams"][s]["score"], t["tot_sPoints"], pts))
        tot = box["teams"][s]["totals"]
        if t["tot_sReboundsTotal"] != int(tot[6]) or t["tot_sTurnovers"] != int(tot[10]) or t["tot_sAssists"] != int(tot[7]):
            tdiff.append((tno, "reb/to/ast"))
    ok(f"{label}: totals = the TOTALS row, points = the final score {raw['tm']['1']['score']}-{raw['tm']['2']['score']}",
       not tdiff, tdiff)
    per = raw["period"]
    qs = {tno: [raw["tm"][tno].get(f"p{q}_score", 0) for q in range(1, per + 1)] for tno in "12"}
    ok(f"{label}: {per} periods and their scores add up to the final",
       all(sum(qs[tno]) == raw["tm"][tno]["score"] for tno in "12"), qs)
    ok(f"{label}: status final, clock 00:00, codes the folded names",
       b.status == "final" and raw["clock"] == "00:00"
       and all(raw["tm"][t]["code"] == U.team_code(raw["tm"][t]["name"]) for t in "12"), (b.status, raw["clock"]))
    # (3) the play-by-play
    an = [e["actionNumber"] for e in raw["pbp"]]
    ok(f"{label}: actionNumber 1..n ascending, success 1/0, tno 0/1/2, pno a string, no private keys",
       an == list(range(1, len(an) + 1))
       and all(e.get("success", 0) in (0, 1) and not isinstance(e.get("success"), bool) for e in raw["pbp"])
       and all(e["tno"] in (0, 1, 2) and isinstance(e["pno"], str) for e in raw["pbp"])
       and not any(k.startswith("_") for e in raw["pbp"] for k in e))
    ok(f"{label}: periods start and end once each, the game ends once",
       [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "start"] == list(range(1, per + 1))
       and [e["period"] for e in raw["pbp"] if e["actionType"] == "period" and e["subType"] == "end"] == list(range(1, per + 1))
       and sum(1 for e in raw["pbp"] if e["actionType"] == "game") == 1)
    for tno in "12":
        st = [k for k, p in raw["tm"][tno]["pl"].items() if p["starter"] == 1]
        ok(f"{label}: team {tno} has exactly five starters", len(st) == 5, st)
    # (4) lineups: replay the substitutions; always five, minutes close to the box's
    on = {t: {k for k, p in raw["tm"][t]["pl"].items() if p["starter"]} for t in "12"}
    secs, last, bad = defaultdict(float), 0.0, 0
    offcourt = 0
    for e in raw["pbp"]:
        base = U.period_base(e["period"])
        t = base + U.period_len(e["period"]) - int(e["gt"][:2]) * 60 - int(e["gt"][3:])
        if t > last:
            if any(len(on[x]) != 5 for x in "12"):
                bad += 1
            for x in "12":
                for q in on[x]:
                    secs[(x, q)] += t - last
            last = t
        if e["actionType"] == "substitution" and e["pno"]:
            (on[str(e["tno"])].discard if e["subType"] == "out" else on[str(e["tno"])].add)(e["pno"])
        elif e["pno"] and e["actionType"] in ("2pt", "3pt", "freethrow", "rebound", "assist", "steal", "block",
                                              "turnover") and e["pno"] not in on[str(e["tno"])]:
            offcourt += 1
    drift = sorted(abs(secs[(x, k)] - U.S.num(p["sMinutes"].split(":")[0]) * 60)
                   for x in "12" for k, p in raw["tm"][x]["pl"].items())
    ok(f"{label}: five a side after every change, every play by a player on the floor", bad == 0 and offcourt == 0,
       (bad, offcourt))
    ok(f"{label}: minutes from the substitutions vs the box's whole minutes: median {statistics.median(drift):.0f}s, "
       f"max {drift[-1]:.0f}s (allowed {max_min_s}s)", statistics.median(drift) <= 60 and drift[-1] <= max_min_s)
    length = 2400 + 300 * max(0, per - 4)
    ok(f"{label}: {len(b.stints)} stints, every one five a side",
       b.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
    dur = sum(r["duration"] for r in b.stints)
    ok(f"{label}: stints cover the whole game ({length}s)", abs(dur - length) < 0.01, dur)
    hp, ap = sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)
    ok(f"{label}: stint points add up to the final score", (hp, ap) == (raw["tm"]["1"]["score"], raw["tm"]["2"]["score"]),
       (hp, ap))
    for tno, side in (("1", "home"), ("2", "away")):
        pm = sum(p["sPlusMinusPoints"] for p in raw["tm"][tno]["pl"].values())
        margin = (hp - ap) if tno == "1" else (ap - hp)
        ok(f"{label}: {side} plus/minus sums to 5 x the margin", pm == 5 * margin, (pm, margin))
    # (5) the event log the site will store
    tr = translate(raw)
    rep = tr["report"]
    ok(f"{label}: translate() drops nothing, matches every player, raises no warning",
       not rep["dropped"] and rep["unmatched"] == 0 and not rep["warnings"],
       (rep["dropped"], rep["unmatched"], rep["warnings"][:3]))
    logbox = defaultdict(lambda: defaultdict(int))
    for e in tr["events"]:
        if not e["pid"]:
            continue
        s, t = logbox[e["pid"]], e["t"]
        if t in ("p2_made", "p3_made", "ft_made"):
            s["pts"] += {"p2_made": 2, "p3_made": 3, "ft_made": 1}[t]
        if t[:2] in ("p2", "p3"):
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
    ediff = set()
    for i, tno in enumerate("12"):
        for pno, p in raw["tm"][tno]["pl"].items():
            e = logbox.get(f"{i}:{pno}", {})
            want = {"pts": p["sPoints"], "fga": p["sFieldGoalsAttempted"], "fgm": p["sFieldGoalsMade"],
                    "fta": p["sFreeThrowsAttempted"], "ftm": p["sFreeThrowsMade"], "oreb": p["sReboundsOffensive"],
                    "dreb": p["sReboundsDefensive"], "ast": p["sAssists"], "stl": p["sSteals"], "blk": p["sBlocks"],
                    "to": p["sTurnovers"], "pf": p["sFoulsPersonal"]}
            ediff |= {f"{p['name']} {k} log={e.get(k, 0)} box={v}" for k, v in want.items() if e.get(k, 0) != v}
    want_q = quirk.get("log", set())
    ok(f"{label}: the event log sums to the same box, player by player"
       + (f" (bar the site's {len(want_q)} known box quirk(s))" if want_q else ""), ediff == want_q, sorted(ediff)[:8])
    return raw


hashes = {}
for bid in GAMES:
    g = by_box[bid]
    a = fresh()
    list(a.discover(PO if g.extra["stage"] == "playoffs" else (F8 if g.extra["stage"] == "final8" else REG),
                    {"season": "2025-26"}))
    Offline.requests_made = []
    b = a.fetch(g.external_id, {"_tipoff_at": g.tipoff_at})
    label = f"{bid} {g.away_name} @ {g.home_name}"
    ok(f"{label}: fetch() after discover() costs one request (the game page)",
       b is not None and len(Offline.requests_made) == 1, Offline.requests_made)
    if b is None:
        continue
    ok(f"{label}: names and codes are discover()'s", b.home_name == g.home_name and b.away_name == g.away_name
       and b.raw["tm"]["1"]["code"] == g.extra["home_code"] and b.raw["tm"]["2"]["code"] == g.extra["away_code"],
       (b.home_name, b.away_name))
    html = fixture(f"game-{g.extra['season_path']}_{bid}.html.gz")
    check(label, b, html, QUIRKS.get(bid), MINUTES_MAX_S.get(bid, 150))
    a2 = fresh()
    list(a2.discover(PO if g.extra["stage"] == "playoffs" else (F8 if g.extra["stage"] == "final8" else REG),
                     {"season": "2025-26"}))
    b2 = a2.fetch(g.external_id, {"_tipoff_at": g.tipoff_at})
    ok(f"{label}: deterministic (same payload hash from a fresh adapter)", b2 is not None and b2.payload_hash == b.payload_hash)
    hashes[bid] = b.payload_hash

print("\n-- the same page gives the same payload in another process (set order must not leak)")
import hashlib  # noqa: E402
import subprocess  # noqa: E402
for bid, sp in (("20251024_chk2", "2025-26"), ("20260225_kx6b", "2025-26p")):
    code = ("import sys,json,hashlib,gzip; sys.path.insert(0, %r); from adapters import usports as U; "
            "h=gzip.open(%r,'rb').read().decode('utf-8'); r=U.raw_from_page(h, event_id='x'); "
            "print(hashlib.sha1(json.dumps(r, sort_keys=True).encode()).hexdigest())"
            % (HERE, os.path.join(DATA, f"game-{sp}_{bid}.html.gz")))
    seen = set()
    for seed in ("1", "2", "3"):
        out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                             env=dict(os.environ, PYTHONHASHSEED=seed), timeout=300)
        seen.add(out.stdout.strip())
    ok(f"{bid}: one payload under three hash seeds", len(seen) == 1 and "" not in seen, seen)

print("\n-- a 2024-25 game (the season axis), straight from its page")
html = fixture("game-2024-25_20241115_6lu6.html.gz")
raw = U.raw_from_page(html, event_id="6lu6-test", season_path="2024-25")
b = U.USportsAdapter().bundle_from_raw(raw, "6lu6-test", {})
check("20241115_6lu6 StFX @ UNB (2024-25, OT)", b, html)

print("\n-- details the game pages carry")
kx = U.raw_from_page(fixture("game-2025-26p_20260225_kx6b.html.gz"), event_id="x")
ok("kx6b: five names in no box (StatCrew ghosts) are team plays, and their 6 points still score",
   len(kx["usports"]["repairs"].get("ghost_names", [])) == 5
   and kx["tm"]["1"]["tot_sPoints"] == 85 and kx["tm"]["2"]["tot_sPoints"] == 76,
   kx["usports"]["repairs"].get("ghost_names"))
e9 = U.raw_from_page(fixture("game-2025-26_20251107_e9f1.html.gz"), event_id="x")
ok("e9f1: two shots printed with no type are settled as 2-point misses (the shooters' box FGA)",
   sum(1 for e in e9["pbp"] if e["actionType"] == "2pt" and e["subType"] == "" and e["success"] == 0) == 2)
twon = U.raw_from_page(fixture("game-2025-26c_20260308_twon.html.gz"), event_id="x")
ok("twon: the crest is the organisation's (logos/rpi/<code>), and the org codes are kept",
   twon["tm"]["1"]["logoT"]["url"].startswith("https://cdn.prestosports.com/action/cdn/logos/rpi/")
   and twon["usports"]["orgCodes"]["home"].startswith("CA"), twon["usports"]["orgCodes"])
za = U.raw_from_page(fixture("game-2025-26_20260208_za1a.html.gz"), event_id="x")
ok("za1a (2OT): periods 5 and 6 with their own scores", za["period"] == 6 and "p6_score" in za["tm"]["1"])

print("\n-- fetch() with no discover() in the process (the live lane)")
a = fresh()
b = a.fetch("cfrm4zwonl577zdh", {"_tipoff_at": "2026-01-11T03:00:00+00:00"})
ok("resolves the event through the season's iCal (uncapped), then reads the game: 2 requests",
   b is not None and b.home_name == "Victoria" and b.payload_hash == hashes.get("20260110_cfrm")
   and [u.replace(U.SITE, "") for u in Offline.requests_made]
   == ["/sports/mbkb/2025-26/schedule?print=ical", "/sports/mbkb/2025-26/boxscores/20260110_cfrm.xml"],
   Offline.requests_made)
za_ev = next(g for g in reg if (g.extra.get("box_url") or "").endswith("20260208_za1a.xml"))
a = fresh()
b = a.fetch(za_ev.external_id, {"_tipoff_at": za_ev.tipoff_at})
ok("...a game past the list's 500 cap resolves the same way (za1a, 8 Feb 2026)",
   b is not None and b.home_name == "Carleton", Offline.requests_made)
b2 = a.fetch(za_ev.external_id, {"_tipoff_at": za_ev.tipoff_at})
ok("...and the next poll costs one request (the game page)", b2 is not None and len(Offline.requests_made) == 3,
   Offline.requests_made)


class LinkedOffline(Offline):
    """An iCal whose link for cfrm is a video, not the box: the box address must be derived."""
    def _get_text(self, url, encoding="utf-8"):
        text = super()._get_text(url, encoding)
        if text and url.endswith("?print=ical"):
            text = text.replace("URL:/sports/mbkb/2025-26/boxscores/20260110_cfrm.xml", "URL:/links/abc123")
        return text


U.USportsAdapter._events, U.USportsAdapter._icals, Offline.requests_made = {}, {}, []
b = LinkedOffline().fetch("cfrm4zwonl577zdh", {"_tipoff_at": "2026-01-11T03:00:00+00:00"})
ok("an event whose iCal link is not its box: the box address is derived from the id and the local "
   "date (UTC date 11 Jan tried first, 10 Jan found)",
   b is not None and b.payload_hash == hashes.get("20260110_cfrm")
   and [u.rsplit("/", 1)[-1] for u in Offline.requests_made[1:]] == ["20260111_cfrm.xml", "20260110_cfrm.xml"],
   Offline.requests_made)
a = fresh()
ok("a game not tipped off is never fetched - not one request",
   a.fetch("zzzzzzzzzzzzzzzz", {"_tipoff_at": "2999-01-01T00:00:00+00:00"}) is None and Offline.requests_made == [])
a = fresh()
ok("an event on none of the season's pages -> None",
   a.fetch("zzzzzzzzzzzzzzzz", {"_tipoff_at": "2026-01-11T03:00:00+00:00"}) is None)

print("\n-- a game in progress")
html = fixture("game-2025-26_20260110_cfrm.html.gz")
cut = html.find('<span id="prd4">')
cut_row = html.find('<tr class="row', html.find("<tr class=\"row", cut) + 1)
for _ in range(60):                        # keep the first ~60 rows of the 4th quarter
    nxt = html.find('<tr class="row', cut_row + 1)
    if nxt < 0:
        break
    cut_row = nxt
end_tbl = html.find("</table>", cut_row)
live_html = html[:cut_row] + html[end_tbl:]
live_html = re.sub(r"(<th scope=\"col\" class=\"col-head text\">\s*)Final", r"\g<1>4th", live_html, count=1)
raw = U.raw_from_page(live_html, event_id="live")
b = U.USportsAdapter().bundle_from_raw(raw, "live-test", {})
ok("the line score not saying Final -> live", b.status == "live", b.status)
ok("no game end and period 4 still open",
   not any(e["actionType"] == "game" for e in raw["pbp"])
   and not any(e["actionType"] == "period" and e["subType"] == "end" and e["period"] == 4 for e in raw["pbp"]))
ok("the clock is where the play is (Q4, not 00:00)", raw["period"] == 4 and raw["clock"] not in ("00:00", "10:00"), raw["clock"])
ok("stints still five a side", all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints))
ok("a final page can never be forced final by the caller when it says otherwise",
   U.raw_from_page(live_html, event_id="live", final=True)["pbp"][-1]["actionType"] != "game")
ok("a page with no box score -> None", U.raw_from_page("<html><body>Not Found</body></html>") is None)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
