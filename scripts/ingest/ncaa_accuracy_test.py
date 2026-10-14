"""NCAA Division II: the play-by-play replays to the OFFICIAL box, exactly, on real games.

    python scripts/ingest/ncaa_accuracy_test.py

Sixteen ncaa.com games of the 2025-26 season between two Division II schools (the scraper checkout's
validation/ncaa/captures_d2 - never this public repository - gzipped GraphQL documents, men and women, all three
text dialects, overtimes and national-championship games) go through the website's own path - the scraper's parse
via adapters/ncaa.py, to_fiba, bundle_from_raw, translate, deriveGame in node - and every player's and team's
counting stats must equal ncaa.com's box, the final score included, and every period's points must equal the feed's
own running score (scripts/ingest/ncaa_accuracy.py does the comparing; this pins it). Each game is here for
something the parse once got wrong:

  6507861  a basket the operator took back: the score falls back on every later row (voided)
  6538180  a jumper at 0:01 of overtime, waved off: the row's score passes the final (voided); a championship game
  6507828  a foul printed with a score from elsewhere in the game, one foul too many in the box's eyes
  6590855  a missed jumper nobody rebounded before the same player shot again (a correction left in)
  6506812  dialect B ("X misses two point jump shot" / "Xmisses ..."): every shot twice, no made free throw
           at all - each one placed where the feed's score shows it, so the halves' scores are right; overtime
  6507128  dialect B, 113-110 in overtime
  6520601  women, overtime: two free throws entered under the wrong side and taken back
  6520177  women: a jumper and its assist entered with a score from later in the game (18-18 at 8:29 of the
           first quarter, among rows at 2-3), which the box never counted; and a basket credited to the TEAM
           for a moment, then taken back
  6521331  women, dialect A without names: every miss written twice (the copy without a full stop, free throws
           and ten rows apart included), and no assist, steal, block or foul row at all (box-reconciled)
  6521726  women, dialect A without names, overtime
  6522732  women: a basket the feed left out - St. Mary's (TX) 50 -> 52 at 5:11 of the fourth on "Layup MISSED by
           Texas-Dallas's Addy Self", and Raynne Malik one made two (and one attempt) short in the box: added
  6522969  women: the same, Westminster (UT) 38 -> 40 at 8:38 of the third, Emily Evans one made two short
  6538041  women's national championship (regional)
and two that must NOT replay as exact, for the reasons the harness gives:
  6522288  Lydia Haack's basket the feed left out (Concordia-St. Paul 62 -> 64 at 0:54 of the fourth on a Winona
           St. turnover) is added - the score adds up and replays, the line score is the feed's - but a missed
           shot of Vivica Bretton's is in neither copy of the feed's rows (box 14 attempts, rows 13), and a
           missed shot is never added
  6507902  the box contradicts itself: Cal St. East Bay's line leaves out the 4 points of a Chase Page whom the
           play-by-play never mentions; replayed, and his line is the one that cannot match
and one parse check on a game the site never reads (ETSU is Division I): 6518783, 'Grüttner' in the box and
'GrÌttner' in the play-by-play are the same player.

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
    "6507861": ("MBB", "voided"), "6538180": ("MBB", "voided"),
    "6507828": ("MBB", "surplus_dropped"), "6590855": ("MBB", "surplus_dropped"),
    "6506812": ("MBB", "injected"), "6507128": ("MBB", "injected"),
    "6520601": ("WBB", "voided"), "6520177": ("WBB", "voided"),
    "6521331": ("WBB", "injected"), "6521726": ("WBB", "injected"),
    "6522732": ("WBB", "basket_added"), "6522969": ("WBB", "basket_added"), "6538041": ("WBB", None),
}
NOT_EXACT = {"6522288": ("WBB", "DIFF"), "6507902": ("MBB", "DIFF")}

os.environ.setdefault("SCRAPER_DIR", N.DEFAULT_SCRAPER_DIR)
mod = H.adapter()._scraper({})
if not mod:
    print(f"\n(skipped: the scraper checkout's NCAA parse is not importable - {N.NcaaAdapter._mod_error})")
    sys.exit(0)

print("\nevery game here is between two Division II schools (the sample's own record of both conferences)")
smp = H.json.loads(H.SAMPLE.read_text())
listed = smp.get("_d2_conferences_2025") or {}
conf_of = {g["id"]: (s, g.get("conferences")) for s in ("MBB", "WBB") for g in smp.get(s, [])}
for cid in list(EXACT) + list(NOT_EXACT):
    s, confs = conf_of.get(cid, (None, None))
    ok(f"{cid}: in the sample, both teams in Division II conferences {confs}",
       bool(confs) and all(c in listed.get(s, ()) for c in confs), (s, confs))
ok("...and the sample holds no game against a school outside the division",
   all(all(c in listed[s] for c in g["conferences"]) for s in ("MBB", "WBB") for g in smp[s]))

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

print("\na basket the feed left out is added only on two witnesses, and with nothing else")
for cid, who in (("6522732", "Raynne Malik"), ("6522969", "Emily Evans"), ("6522288", "Lydia Haack")):
    s = sites.get(cid)
    if not s:
        continue
    added = [a for a in s["parsed"]["actions"] if a[0].startswith(("2pt shot", "3pt shot"))]
    ok(f"{cid}: one made two added, {who}'s", len(added) == 1 and added[0][0].startswith("2pt shot made")
       and who.replace(".", "") in added[0][0], added)
    if added:
        at = added[0][2]
        others = [a for a in s["parsed"]["actions"] if abs(a[2] - at) < 0.01 and a is not added[0]
                  and a[1] == added[0][1] and a[0].startswith("Assist")]
        ok(f"{cid}: ...with no assist made up for it", not others, others)
s = sites.get("6522732")
if s:
    plain = [a["actionNumber"] for a in s["raw"]["pbp"] if a.get("actionType") == "2pt" and a.get("success")
             and a.get("subType") == ""]
    seqs = {e["seq"] for e in s["T"]["events"] if e["t"] == "p2_made" and set(e["_ans"]) & set(plain)}
    ok("an added basket claims no kind of shot (no stype: neither at the rim nor a jumper)",
       len(plain) == 1 and len(seqs) == 1
       and not any(e["t"] == "stype" and e["payload"].get("ref") in seqs for e in s["T"]["events"]), (plain, seqs))

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
    ok("6522288: replayed now (its plays add up to 85-87 with Haack's basket)", r["published"] == "replayed"
       and r["flags"]["reconciled"].get("basket_added") == 1, (r["published"], r["why"], r["flags"]["reconciled"]))
    ok("...its line score is the feed's", not r["line"], r["line"])
    ok("...and the one line off is Vivica Bretton's missed shot the feed never wrote (13 attempts, box 14)",
       [(p["name"], p["diff"]) for p in r["players"]] == [("Vivica Bretton", {"FGA": (13, 14), "2PA": (9, 10)})],
       r["players"])
r = res.get("6507902")
if r:
    ok("6507902: the box contradicts itself (team line below its players)", bool(r["flags"]["box_inconsistent"]),
       r["flags"]["box_inconsistent"])
    ok("...and the only line off is the player the play-by-play never names",
       [p["name"] for p in r["players"]] == ["Chase Page"] and r["published"] == "replayed", r["players"])

print("\na parse check on a game the site does not read (ETSU is Division I)")
d = H.load_capture("6518783")
if d is not None:
    p = H.adapter().parse(mod, d, "WBB")
    who = [(k, v["name"], bool(v.get("synthetic"))) for k, v in p["site_box"][0].items() if "Bacoul" in v["name"]]
    ok("'GrÌttner' in the play-by-play is the box's 'Grüttner': one player, none made up",
       len(who) == 1 and not who[0][2] and any(f"#{who[0][0]} " in a[0] for a in p["actions"]), who)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
