"""WHICH LINES WERE FILED UNDER THE WRONG PERSON? (2026-10-14)

Until 0632ed87a the matcher read a record's half-name aliases ("Smith" on Tavis Smith) as names, so a new
player of the same surname on the club could be filed under the old one: Newcastle's Malcolm Smith (#45, SLB
2025-26) went into Tavis Smith's profile, game after game, silently. Lines it could not decide showed as
"Player #13" (found by their non-uuid ids); these are the ones that DID get decided - wrongly.

A final game's roster snapshot keeps, for every line, the name the feed gave and the platform id it was linked
to. A line is misfiled when the two names cannot be one person: full first names that are not the same, not a
nickname, not a spelling of each other (matching._forenames_conflict), or surnames that do not fit. Read-only:
it lists the games, by source, for run_ingest.py --refresh --ids to write again.

    python misfiled_audit.py --worker-config [--league slb-men] [--out misfiled.json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_ingest as R  # noqa: E402
import identity as I  # noqa: E402
import names as N  # noqa: E402
from matching import jaro_winkler, normalize, same_forename  # noqa: E402

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _one_name(a: str, b: str) -> bool:
    """Two first-name words that can be one person's: the same, a nickname, a spelling (JW 0.88), one inside the
    other (Tomiwa / Olutomiwa), or the same opening two letters (Alix / Alexandra)."""
    if a == b or same_forename(a, b) or jaro_winkler(a, b) >= 0.88:
        return True
    short, long_ = sorted((a, b), key=len)
    if len(short) == 1:
        return short == long_[0]                         # an initial (C Barone / Cami Barone)
    return (len(short) >= 3 and short in long_) or a[:2] == b[:2]


def misfiled(feed_name: str, row: dict) -> bool:
    """The feed's name for a line and the record it was linked to cannot be one person: the surname is the same (or
    a spelling of it) and NOT ONE first-name word could be the same person's - Michael filed under Jalen Graham,
    Malcolm under Tavis Smith. Word by word, so a middle name, a dropped one, a second spelling of the surname or a
    split the two sides made differently ("Re' Ale" Basquine) is never read as two people."""
    # latinised first (Đorđe is Dorde, not "orde"), and a stray shirt number in the name ("7 Temilola") is no name
    q = [w for w in normalize(N.latinise(feed_name if isinstance(feed_name, str) else "")).split() if not w.isdigit()]
    first_c = normalize(N.latinise(row.get("first_name") or "")).split()
    last_c = normalize(N.latinise(row.get("last_name") or "")).split()
    if not q or not last_c or not first_c:
        return False
    if set(q) <= set(first_c + last_c) or set(first_c + last_c) <= set(q):
        return False                                     # one is the other with names added or dropped
    # the record's surname, in the feed's words (a spelling counts: Nwankwo / Nwanko, Welch / Welsh)
    sur = [w for w in q if any(w == s or jaro_winkler(w, s) >= 0.85 for s in last_c)]
    if not sur:
        return False                                     # a different surname altogether: not this kind of fault
    first_q = [w for w in q if w not in sur]
    if not first_q:
        return False
    return not any(_one_name(a, b) for a in first_q for b in first_c)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-config", action="store_true")
    ap.add_argument("--league", default=None, help="league slugs, comma-separated (default: every league)")
    ap.add_argument("--out", default="misfiled.json")
    ap.add_argument("--page", type=int, default=400)
    args = ap.parse_args()
    if args.worker_config:
        w = json.load(open(os.path.join(os.environ.get("APPDATA", ""), "epinoia", "worker.json"), encoding="utf-8"))
        os.environ.setdefault("SUPABASE_URL", w["supabase_url"]); os.environ.setdefault("SUPABASE_SERVICE_KEY", w["service_key"])
    sb = R.Supabase(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    comps = None
    if args.league:
        lids = [x["id"] for x in sb.select("leagues", f"slug=in.({args.league})&select=id")]
        sids = [x["id"] for x in sb.select("seasons", f"league_id=in.({','.join(lids)})&select=id")] if lids else []
        comps = [x["id"] for x in sb.select("competitions", f"season_id=in.({','.join(sids)})&select=id")] if sids else []
        if not comps:
            print("no competitions for", args.league); return 1
    lines = []                  # (game_id, team name, shirt, feed name, player id)
    last = "00000000-0000-0000-0000-000000000000"
    while True:
        q = f"status=eq.final&id=gt.{last}&order=id&limit={args.page}&select=id,roster_snapshot"
        if comps is not None:
            q += f"&competition_id=in.({','.join(comps)})"
        rows = sb.select("games", q)
        for g in rows:
            for t in ((g.get("roster_snapshot") or {}).get("teams") or []):
                for p in t.get("players") or []:
                    if UUID.match(str(p.get("id") or "")) and p.get("name"):
                        lines.append((g["id"], t.get("name"), p.get("num"), p["name"], p["id"]))
        if len(rows) < args.page:
            break
        last = rows[-1]["id"]
        time.sleep(0.2)                     # a read-only sweep: gentle on the database
    ids = sorted({x[4] for x in lines})
    people = {}
    for i in range(0, len(ids), 150):
        for r in sb.select("players", f"id=in.({','.join(ids[i:i + 150])})&select=id,first_name,last_name"):
            people[r["id"]] = r
    flagged = [x for x in lines if x[4] in people and misfiled(x[3], people[x[4]])]
    # THE SAME PERSON UNDER ANOTHER NAME, OR SOMEBODY ELSE: the game's own shirt says. Each record's shirts in the
    # lines filed under it by its own name; a flagged line wearing one of them is that player under a nickname or a
    # second name (Jaye / Jeffrey Crockett), left alone. Another shirt is another person (Malcolm Smith #45 in Tavis
    # Smith's #11 profile), written again. A record with no line of its own name proves nothing either way: listed.
    own = defaultdict(set)
    flagged_set = {(x[0], x[4], x[2]) for x in flagged}
    for g, team, num, name, pid in lines:
        if (g, pid, num) not in flagged_set:
            own[pid].add(str(num))
    bad = [x for x in flagged if own[x[4]] and str(x[2]) not in own[x[4]]]
    same = [x for x in flagged if str(x[2]) in own[x[4]]]
    unsure = [x for x in flagged if not own[x[4]]]
    print(f"   {len(same)} flagged line(s) wear the record's own shirt - the same person, another name: left alone")
    print(f"   {len(unsure)} flagged line(s) on a record with no line of its own name: listed, not written")
    for g, team, num, name, pid in unsure[:20]:
        print(f"      ? {team}: #{num} {name} -> {people[pid].get('first_name')} {people[pid].get('last_name')}")
    games = sorted({x[0] for x in bad})
    plan = defaultdict(list)
    for i in range(0, len(games), 80):
        for e in sb.select("external_games", f"game_id=in.({','.join(games[i:i + 80])})&select=game_id,adapter,competition_code,external_id"):
            plan[f"{e['adapter']}|{e['competition_code']}"].append(e["external_id"])
    print(f"{len(lines)} linked lines in final games read; {len(bad)} filed under someone else, in {len(games)} game(s)")
    seen = set()
    for g, team, num, name, pid in bad:
        who = people[pid]
        k = (team, name, pid)
        if k not in seen:
            seen.add(k)
            print(f"   {team}: #{num} {name} -> filed under {who.get('first_name')} {who.get('last_name')}")
    for k, v in sorted(plan.items()):
        print(f"   {k}: {len(v)} game(s)")
    json.dump({"lines": bad, "plan": plan}, open(args.out, "w", encoding="utf-8"), indent=1, default=list)
    return 0


if __name__ == "__main__":
    sys.exit(main())
