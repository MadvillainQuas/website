"""NCAA Division II: the play-by-play replays to the OFFICIAL box, exactly, on real games.

    python scripts/ingest/ncaa_accuracy_test.py

Fifteen ncaa.com games of the 2025-26 season (the scraper checkout's validation/ncaa/captures_d2 - never this public
repository - gzipped GraphQL documents, men and women, all
three text dialects, overtimes and national-championship games) go through the website's own path - the scraper's
parse via adapters/ncaa.py, to_fiba, bundle_from_raw, translate, deriveGame in node - and every player's and team's
counting stats must equal ncaa.com's box, the final score included, and every period's points must equal the feed's
own running score (scripts/ingest/ncaa_accuracy.py does the comparing; this pins it). Each game is here for
something the parse once got wrong:

  6504938  a basket logged twice: a second made row that moved the score by nothing (voided)
  6507861  a basket the operator took back: the score falls back on every later row (voided)
  6538180  a jumper at 0:01 of overtime, waved off: the row's score passes the final (voided); a championship game
  6507828  a foul printed with a score from elsewhere in the game, one foul too many in the box's eyes
  6590855  a missed jumper nobody rebounded before the same player shot again (a correction left in)
  6506812  dialect B ("X misses two point jump shot" / "Xmisses ..."): every shot twice, no made free throw
           at all - each one placed where the feed's score shows it, so the halves' scores are right; overtime
  6507128  dialect B, 113-110 in overtime
  6520601  women, overtime: two free throws entered under the wrong side and taken back
  6518783  women: 'Grüttner' in the box, 'GrÌttner' in the play-by-play - the same player
  6520177  women: a jumper and its assist entered with a score from later in the game (18-18 at 8:29 of the
           first quarter, among rows at 2-3), which the box never counted; and a basket credited to the TEAM
           for a moment, then taken back
  6521331  women, dialect A without names: every miss written twice (the copy without a full stop, free throws
           and ten rows apart included), and no assist, steal, block or foul row at all (box-reconciled)
  6520898  women, dialect A without names, overtime
  6538041  women's national championship (regional)
and two that must NOT replay as exact, for the reasons the harness gives:
  6522288  result only: the feed's score rises by two at 0:54 of the fourth with no row for it (a made basket
           the provider left out - Lydia Haack's, the box says); the plays add up to 85-85, the result is 85-87
  6507902  the box contradicts itself: Cal St. East Bay's line leaves out the 4 points of a Chase Page whom the
           play-by-play never mentions; replayed, and his line is the one that cannot match

Needs the scraper checkout (the parse is there, as in production); without it this says so and passes nothing.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ncaa_accuracy as H  # noqa: E402
from adapters import ncaa as N  # noqa: E402

passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}" + (f"  -- {extra}" if extra != "" else ""))


EXACT = {
    "6504938": ("MBB", "voided"), "6507861": ("MBB", "voided"), "6538180": ("MBB", "voided"),
    "6507828": ("MBB", "surplus_dropped"), "6590855": ("MBB", "surplus_dropped"),
    "6506812": ("MBB", "injected"), "6507128": ("MBB", "injected"),
    "6520601": ("WBB", "voided"), "6518783": ("WBB", None), "6520177": ("WBB", "voided"),
    "6521331": ("WBB", "injected"), "6520898": ("WBB", "injected"), "6538041": ("WBB", None),
}
NOT_EXACT = {"6522288": ("WBB", "RESULT-ONLY"), "6507902": ("MBB", "DIFF")}

os.environ.setdefault("SCRAPER_DIR", N.DEFAULT_SCRAPER_DIR)
mod = H.adapter()._scraper({})
if not mod:
    print(f"\n(skipped: the scraper checkout's NCAA parse is not importable - {N.NcaaAdapter._mod_error})")
    sys.exit(0)

games = dict(EXACT, **NOT_EXACT)
datas, sites, batch = {}, {}, {}
for cid, (sport, _) in games.items():
    d = H.load_capture(cid)
    if d is None:
        ok(f"{cid}: the capture is on disk ({H.scraper_captures() / (cid + '.json.gz')})", False)
        continue
    datas[cid] = d
    sites[cid] = H.run_site(d, sport, cid)
    batch[cid] = sites[cid]["T"]
eng = H.engine(batch)
res = {cid: H.compare(cid, games[cid][0], datas[cid], sites[cid], eng[cid], 2.0) for cid in sites}

print("\nevery player's and team's line is ncaa.com's, and every period's points the feed's")
for cid, (sport, feature) in EXACT.items():
    r = res.get(cid)
    if not r:
        continue
    diffs = [(p["name"], p["diff"]) for p in r["players"]] + [("team " + "HA"[t["side"]], t["diff"]) for t in r["teams"]]
    ok(f"{sport} {cid} {r['game']}: exact", r["verdict"] == "EXACT", diffs or r["pbp_only"] or r["why"])
    ok(f"{sport} {cid}: the line score is the feed's", not r["line"], r["line"])
    if feature:
        ok(f"{sport} {cid}: ...by way of the parse's '{feature}'", r["flags"]["reconciled"].get(feature, 0) > 0,
           r["flags"]["reconciled"])

print("\nthe team lines: rebounds and turnovers charged to no player are in the log")
r = res.get("6538180")
if r:
    T = sites["6538180"]["T"]
    team_rebs = [e for e in T["events"] if e["t"] == "reb" and e["pid"] is None]
    team_tos = [e for e in T["events"] if e["t"] == "to" and e["pid"] is None]
    ok("team rebounds reach the log (no player named)", len(team_rebs) == 12, len(team_rebs))
    ok("...and team turnovers", len(team_tos) == 6, len(team_tos))

print("\nwhat must not replay as exact, and why")
r = res.get("6522288")
if r:
    ok("6522288: result only - its plays add up to 85-85", r["verdict"] == "RESULT-ONLY" and "85-85" in (r["why"] or ""), r["why"])
    ok("...and the one gap is Lydia Haack's basket the feed left out (box FGM 15, log 14)",
       [(p["name"], p["diff"].get("FGM")) for p in r["players"] if p["side"] == 1] == [("Lydia Haack", (14, 15))],
       r["players"])
r = res.get("6507902")
if r:
    ok("6507902: the box contradicts itself (team line below its players)", bool(r["flags"]["box_inconsistent"]),
       r["flags"]["box_inconsistent"])
    ok("...and the only line off is the player the play-by-play never names",
       [p["name"] for p in r["players"]] == ["Chase Page"] and r["published"] == "replayed", r["players"])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
