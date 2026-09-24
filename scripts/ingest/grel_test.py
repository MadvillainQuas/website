# -*- coding: utf-8 -*-
"""Greek Elite League (adapters/grel.py), offline, over captured stats.basket.gr pages:

    python scripts/ingest/grel_test.py

What it holds the adapter to:
  * names by Greece's own standard, ELOT 743, surname-first turned into first/family name, the
    data entry's mixed-script words repaired, club initials kept - and not one Greek character in a
    club, a box score, a lineup or the event log; the Greek original kept searchable;
  * the schedule from the round cache: 2025-26's 210 regular-season games (both halves) and 17
    post-season games, a round whose games are all final never read again, 2026-27's fixtures;
  * three games end to end, overtime included: every player's box equal to the play-by-play (every
    counting stat, fouls drawn too), the clubs' totals the league's TOTALS rows, stints five a side
    covering the game and summing to the score, the substitutions (whole new fives) turned into
    off/on pairs, fast breaks tagged, the full club names from the schedule, and the event log
    translate() builds dropping nothing.

Fixtures in scripts/ingest/data/grel/ (captured 2026-09-24): three 2025-26 game pages cut down to
the header and the loadDoc calls the adapter reads, and the 2025-26 round cache.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import get_adapter  # noqa: E402
from adapters import grel as G  # noqa: E402
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
from translate.fiba_events import translate  # noqa: E402
import names  # noqa: E402

DATA = os.path.join(HERE, "data", "grel")
GREEK = re.compile("[Ͱ-Ͽἀ-῿]")
PASS = FAIL = 0
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


TMP = tempfile.mkdtemp(prefix="grel_test_")
os.makedirs(os.path.join(TMP, "data", "feed", "GREL"))
shutil.copy(os.path.join(DATA, "rounds.json"), os.path.join(TMP, "data", "feed", "GREL", "rounds.json"))
CFG = {"repo_root": TMP}
ASKED = []


class Offline(G.GrelAdapter):
    def _get(self, url):
        ASKED.append(url)
        m = re.search(r"gamedetails/id/([0-9A-F]{8})", url)
        if m:
            p = os.path.join(DATA, f"game-{m.group(1)}.html")
            return open(p, encoding="utf-8").read() if os.path.exists(p) else None
        return None                      # a round page not in the cache: the network, which a test has not


def fresh():
    ASKED.clear()
    G.GrelAdapter._rounds = {}
    FibaLiveStatsAdapter._pipeline = False
    FibaLiveStatsAdapter._pipeline_warned = True
    return Offline()


# ============================================================================ names
print("-- names: ELOT 743, surname first turned round")
for raw, want in (("ΠΑΠΑΓΙΑΝΝΗΣ ΜΗΝΑΣ-ΡΑΦΑΗΛ", ("Minas-Rafail", "Papagiannis")),
                  ("ΚΟΗΣ ΠΑΝΑΓΙΩΤΗΣ", ("Panagiotis", "Kois")),
                  ("ΓΚΟΛΑΝΤΑΣ ΧΡΙΣΤΟΦΟΡΟΣ", ("Christoforos", "Gkolantas")),
                  ("ΑΓΓΕΛΟΠΟΥΛΟΣ ΕΥΑΓΓΕΛΟΣ", ("Evangelos", "Angelopoulos")),
                  ("SLATER II COLIN EDWARDEUX", ("Colin Edwardeux", "Slater II")),
                  ("ROSS ISAIAH - LEONJA", ("Isaiah-Leonja", "Ross")),
                  ("DE COLO NANDO", ("Nando", "De Colo"))):
    ok(f"{raw} -> {' '.join(want)}", G.person_parts(raw) == want, G.person_parts(raw))
for raw, want in (("ΕVERTECH ΠΑΠΑΓΟΥ", "Evertech Papagou"), ("ΚΟΡΟΙΒΟΣ ΑΣ ΑΜΑΛΙΑΔΑΣ", "Koroivos AS Amaliadas"),
                  ("VIKOS ΦALCONS", "Vikos Falcons"), ("ΚΑΕ ΠΑΝΙΩΝΙΟΣ ΓΣΣ 1890", "KAE Panionios GSS 1890"),
                  ("ΠΡΩΤΕΥΣ ΑΕΟ ΒΟΥΛΑΣ", "Protefs AEO Voulas")):
    ok(f"club {raw} -> {want}", G.club_name(raw) == want, G.club_name(raw))
for name, short in (("GAS Komotini", "Komotini"), ("AS Papagou", "Papagou"), ("Protefs AEO Voulas", "Protefs"),
                    ("AEPS Machites Peiramatiko", "Machites"), ("KAE Panionios GSS 1890", "Panionios"),
                    ("Kronos Ag. Dimitriou GS", "Kronos"), ("Vikos Falcons", "Vikos")):
    ok(f"short name: {name} -> {short} (never the club's GUID)", G.short_club(name) == short, G.short_club(name))
ok("club: ΑΕΠΣ is initials too", G.club_name("ΑΕΠΣ ΜΑΧΗΤΕΣ") == "AEPS Machites")
ok("Greek local time: 17:00 on 4 Oct 2025 (summer time) is 14:00 UTC; 17:00 on 10 Jan 2026 is 15:00 UTC",
   G.athens_to_utc(2025, 10, 4, "17:00")[0] == "2025-10-04T14:00:00+00:00"
   and G.athens_to_utc(2026, 1, 10, "17:00")[0] == "2026-01-10T15:00:00+00:00")

# ============================================================================ the schedule
print("\n-- the schedule, from the round cache")
a = fresh()
reg = list(a.discover("x", dict(CFG, season="2025-26")))
po = list(a.discover("x", dict(CFG, season="2025/26", stage="playoffs")))
ok("2025-26: 210 regular-season games (both halves), 17 post-season, all final",
   (len(reg), len(po)) == (210, 17) and all(g.status == "final" for g in reg + po), (len(reg), len(po)))
ok("...every round page from the cache: all its games final, so never read again (no request)", ASKED == [], ASKED[:3])
ok("rounds 1-30 across the two halves", {g.extra["round"] for g in reg} == {f"Round {n}" for n in range(1, 31)})
names_ = [g.home_name for g in reg + po] + [g.away_name for g in reg + po] + [g.extra["venue"] or "" for g in reg]
ok("not one Greek character in a club or venue", not any(GREEK.search(n) for n in names_),
   [n for n in names_ if GREEK.search(n)][:3])
ok("15 clubs (one sits out each round), each by its own team id, one name each",
   len({g.extra["home_code"] for g in reg}) == 15 and len({(g.extra["home_code"], g.home_name) for g in reg}) == 15)
ok("every fixture carries both clubs' short names, and none is a code",
   all(g.extra["home_short"] and "-" not in g.extra["home_short"] and g.extra["away_short"] for g in reg))
ok("Evertech Papagou and Vikos Falcons: the mixed-script names repaired",
   {"Evertech Papagou", "Vikos Falcons"} <= {g.home_name for g in reg})
g0 = next(g for g in reg if "106C4619" in g.external_id)
ok("AO Dafnis v Psychikou AE, 4 Oct 2025 17:00 Greek time = 14:00 UTC, key season_GUID",
   (g0.home_name, g0.away_name, g0.tipoff_at, g0.external_id)
   == ("AO Dafnis", "Psychikou AE", "2025-10-04T14:00:00+00:00", "2025-2026_106C4619-AFD0-498A-9BF3-65F2C838ABC9"),
   (g0.home_name, g0.away_name, g0.tipoff_at, g0.external_id))
a = fresh()
po27 = list(a.discover("x", dict(CFG, season="2026-27", stage="playoffs")))
ok("2026-27 post-season before it exists: the Final Four page's stand-in Round 1 is not taken as play-offs",
   po27 == [], [g.external_id for g in po27][:3])
for bad, cfg in (("a season token that is not a season", {"season": "twenty"}),
                 ("a stage that is neither regular nor playoffs", {"stage": "cup"})):
    try:
        list(fresh().discover("x", dict(CFG, **cfg)))
        raised = False
    except ValueError:
        raised = True
    ok(f"{bad} is an error, not a quiet empty run", raised)

# ============================================================================ games
print("\n-- three games end to end")
BOXKEYS = {"sPoints": "pts", "sTwoPointersMade": "p2m", "sTwoPointersAttempted": "p2a", "sThreePointersMade": "p3m",
           "sThreePointersAttempted": "p3a", "sFreeThrowsMade": "ftm", "sFreeThrowsAttempted": "fta",
           "sReboundsOffensive": "oreb", "sReboundsDefensive": "dreb", "sAssists": "ast", "sSteals": "stl",
           "sBlocks": "blk", "sTurnovers": "tov", "sFoulsPersonal": "pf"}
GAMES = {"106C4619-AFD0-498A-9BF3-65F2C838ABC9": ("AO Dafnis", 80, 85, "Psychikou AE", 4),
         "C032E1B5-1622-4595-8CFD-17BE599E1AF5": ("Protefs AEO Voulas", 105, 99, "Neaniki Estia Megaridos", 5),
         "3068118F-6ACA-4875-8918-8B431CCDC60A": ("Protefs AEO Voulas", 78, 69, "Evertech Papagou", 4)}
for gid, (home, hs, as_, away, periods) in GAMES.items():
    a = fresh()
    list(a.discover("x", dict(CFG, season="2025-26")))            # the live path's order: schedule first
    b = a.fetch(f"2025-2026_{gid}", dict(CFG))
    label = f"{gid[:8]}"
    if b is None:
        ok(label + ": fetched", False)
        continue
    raw = b.raw
    ok(f"{label}: {home} {hs}-{as_} {away}, {periods} periods, final - the full club names from the schedule",
       (b.home_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"], b.away_name, raw["period"], b.status)
       == (home, hs, as_, away, periods, "final"),
       (b.home_name, raw["tm"]["1"]["score"], raw["tm"]["2"]["score"], b.away_name, raw["period"], b.status))
    stored = json.dumps({"tm": {s: {k: v for k, v in raw["tm"][s].items() if k != "nameInternational"}
                                for s in ("1", "2")}, "pbp": raw["pbp"]}, ensure_ascii=False)
    stored = re.sub(r'"displayName": "[^"]*"', "", stored)
    ok(f"{label}: no Greek anywhere a reader sees (the original is kept only as displayName / nameInternational)",
       not GREEK.search(stored), GREEK.findall(stored)[:5])
    pnames = [r["player_name"] for s in ("home", "away") for r in b.box[s]]
    ok(f"{label}: every player named in Latin letters, first name first",
       all(re.fullmatch(r"[A-Z][A-Za-z' -]*", n) for n in pnames), [n for n in pnames if not re.fullmatch(r"[A-Z][A-Za-z' -]*", n)])
    # every counting stat of every player: the box = the play-by-play
    cnt = defaultdict(lambda: defaultdict(int))
    for e in raw["pbp"]:
        if not e.get("pno"):
            continue
        c, at = cnt[(e["tno"], e["pno"])], e["actionType"]
        if at in ("2pt", "3pt", "freethrow"):
            c[at + "a"] += 1
            c[at + "m"] += e["success"]
        elif at == "rebound":
            c["o" if e["subType"] == "offensive" else "d"] += 1
        else:
            c[at] += 1
    diffs = []
    for t in (1, 2):
        for pid, p in raw["tm"][str(t)]["pl"].items():
            c = cnt[(t, pid)]
            want = {"2pta": p["sTwoPointersAttempted"], "2ptm": p["sTwoPointersMade"], "3pta": p["sThreePointersAttempted"],
                    "3ptm": p["sThreePointersMade"], "freethrowa": p["sFreeThrowsAttempted"], "freethrowm": p["sFreeThrowsMade"],
                    "o": p["sReboundsOffensive"], "d": p["sReboundsDefensive"], "assist": p["sAssists"], "steal": p["sSteals"],
                    "block": p["sBlocks"], "turnover": p["sTurnovers"], "foul": p["sFoulsPersonal"], "foulon": p["sFoulsOn"]}
            diffs += [f"{p['name']} {k} pbp={c.get(k, 0)} box={v}" for k, v in want.items() if c.get(k, 0) != v]
    ok(f"{label}: every player's box = her play-by-play, all 14 counting stats and fouls drawn", not diffs, diffs[:5])
    ok(f"{label}: each club's players plus its team row are its TOTALS",
       all(sum(p["sPoints"] for p in raw["tm"][s]["pl"].values()) == raw["tm"][s]["tot_sPoints"]
           and sum(p["sReboundsOffensive"] for p in raw["tm"][s]["pl"].values()) + raw["tm"][s]["tot_sReboundsTeamOffensive"]
           == raw["tm"][s]["tot_sReboundsOffensive"] for s in "12"))
    length = 2400 + 300 * (periods - 4)
    ok(f"{label}: {len(b.stints)} stints, five a side, covering the whole game ({length}s), summing to the score",
       b.stints and all(len(r["home_lineup"].split(",")) == 5 and len(r["away_lineup"].split(",")) == 5 for r in b.stints)
       and abs(sum(r["duration"] for r in b.stints) - length) < 0.01
       and (sum(r["home_points"] for r in b.stints), sum(r["away_points"] for r in b.stints)) == (hs, as_),
       (len(b.stints), sum(r["duration"] for r in b.stints)))
    subs = [e for e in raw["pbp"] if e["actionType"] == "substitution"]
    ok(f"{label}: substitutions come as off/on pairs ({len(subs)} events)",
       subs and sum(e["subType"] == "out" for e in subs) == sum(e["subType"] == "in" for e in subs))
    fo = [e for e in raw["pbp"] if e["actionType"] == "foulon"]
    by_n = {e["actionNumber"]: e for e in raw["pbp"]}
    ok(f"{label}: drawn fouls point at the other club's foul ({sum(1 for e in fo if e.get('previousAction'))}/{len(fo)})",
       all(by_n[e["previousAction"]]["actionType"] == "foul" and by_n[e["previousAction"]]["tno"] == 3 - e["tno"]
           for e in fo if e.get("previousAction")) and sum(1 for e in fo if e.get("previousAction")) >= len(fo) * 0.8)
    ok(f"{label}: fast-break baskets tagged (the league counts {raw['grel']['fastBreaks']})",
       all(raw["tm"][s]["tot_sPointsFastBreak"] >= 2 * min(1, raw["grel"]["fastBreaks"][int(s) - 1]) for s in "12"))
    rep = translate(raw)["report"]
    ok(f"{label}: translate() drops nothing and matches every player", not rep["dropped"] and rep["unmatched"] == 0,
       (rep["dropped"], rep["unmatched"]))
    ok(f"{label}: no action the adapter does not know", not raw["grel"]["unknown"], raw["grel"]["unknown"])

ok("a game not yet played has no payload", G.raw_from_page("<html></html>") is None)
ok("a key that is not season_GUID is not fetched", fresh().fetch("106C4619", dict(CFG)) is None and ASKED == [])

# ============================================================================ wiring
print("\n-- wiring")
ok("the registry knows it, and a backfill can read a season",
   type(get_adapter("grel")).__name__ == "GrelAdapter"
   and '"grel"' in open(os.path.join(HERE, "run_ingest.py"), encoding="utf-8").read().split("SEASON_AWARE_ADAPTERS =", 1)[1][:500])
src = json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"]
rows = [s for s in src if s.get("adapter") == "grel"]
ok("two source rows, one league filed under Greece: the regular season and the post-season",
   sorted(s["adapter_config"]["stage"] for s in rows) == ["playoffs", "regular"]
   and {s["league_slug"] for s in rows} == {"greek-elite-league"} and all(s["league_country"] == "GR" for s in rows), rows)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
