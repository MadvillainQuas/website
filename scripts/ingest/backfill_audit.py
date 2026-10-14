"""CAN EVERY LEAGUE BE BACKFILLED? (2026-10-14)

For each league with a source, and each past season, this runs exactly what a season backfill runs
(run_ingest.backfill_sources -> expand_competition_sources -> fiba_format.stage_sources -> the adapter's
discover), then fetches ONE game of that season to prove its feed still answers with a box score and a
play-by-play. Nothing is written: no database row, no storage object.

What it says of each league-season:
  ok          games found, all inside the season, and a game's feed reads
  no-feed     games found, but the sampled game's feed has no box score (the schedule outlives the feed)
  wrong-season games found OUTSIDE the season asked for - the adapter ignored the season (a backfill
              would file this season's games under an old one: never queue one)
  none        no games for that season (the source does not hold it, or the season is named differently)
  skipped     the backfill would refuse it before reading (adapter not season-aware, calendar vs split)
  error       discovery threw

  python backfill_audit.py --worker-config [--league slb-men,bcb] [--seasons 2024-25,2023-24] [--out audit.json]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import json
import os
import sys
import time
from contextlib import redirect_stdout
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_ingest as R  # noqa: E402
from adapters import get_adapter  # noqa: E402
import fiba_format  # noqa: E402

SPLIT = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21"]
CALENDAR = ["2025", "2024", "2023", "2022", "2021", "2020"]

# THE LEAGUE CONSOLE'S "WHAT THE SOURCE HOLDS" (--coverage epinoia/admin/backfill-coverage.js). Each audited season
# becomes one word the backfill panel draws:
#   full     box scores and play-by-play            box      box scores, no play-by-play
#   mixed    box scores, play-by-play for some      part     some games have no box score
#   results  games listed, no box score at all      none     the source does not hold the season
#   skip     the source cannot read a past season (an audit that errors keeps what the file said before)
# WHY a season cannot be filled is something no feed says, so it is written here, from the evidence gathered when
# each league was looked into (2026-10-14). A season with no note gets its state's own words.
#   not-yet       before the league or competition began          not-played   no season was played (covid)
#   renamed       the league ran under another name then          current-only the source keeps only recent seasons
#   other-source  held only by a source this league does not read
_SPLIT_BEFORE = lambda first: [s for s in SPLIT if s < first]  # noqa: E731
NOTES = {
    "liga-u": {s: "not-yet" for s in _SPLIT_BEFORE("2025-26")},
    "bcb": {s: "not-yet" for s in _SPLIT_BEFORE("2025-26")},
    "w-league-future": {s: "not-yet" for s in _SPLIT_BEFORE("2024-25")},
    "liga-femenina-challenge": {"2020-21": "not-yet"},
    "bnxt-league": {"2020-21": "not-yet"},
    "lnb-espoirs-elite-2": {"2020-21": "not-yet"},
    "greek-elite-league": {"2021-22": "renamed", "2020-21": "renamed"},
    "slb-men": {s: "renamed" for s in _SPLIT_BEFORE("2024-25")},
    "nbl-bulgaria": {s: "other-source" for s in _SPLIT_BEFORE("2025-26")},
    "liga-ouro": {s: "not-played" for s in ("2024", "2023", "2022", "2021", "2020")},
    "u-sports": {"2020-21": "not-played"},
    "nbl1-men": {"2020": "not-played"},
    "nbl1-women": {"2020": "not-played"},
    "lnbm": {s: "current-only" for s in SPLIT},
    "lnbf": {s: "current-only" for s in SPLIT},
    "macedonian-super-league": {s: "current-only" for s in SPLIT},
    "kosovo-superliga": {s: "current-only" for s in SPLIT},
}


def coverage_of(kinds: set) -> str:
    """What a season's sampled games say it can be filled in with."""
    if kinds == {"full"}:
        return "full"
    if kinds == {"box"}:
        return "box"
    if "empty" not in kinds:
        return "mixed"
    return "results" if kinds == {"empty"} else "part"


BEGIN, END = "/* BEGIN DATA */", "/* END DATA */"


def write_coverage(path: str, results: list, today: str) -> int:
    """Merge this run's seasons into the console's coverage file: a league-season audited now replaces what it said,
    every other one is kept (an audit of one league rewrites that league's seasons only). Returns seasons written."""
    data = {"checked": today, "leagues": {}}
    if os.path.exists(path):
        text = open(path, encoding="utf-8").read()
        if BEGIN in text and END in text:
            data = json.loads(text.split(BEGIN, 1)[1].split(END, 1)[0])
    n = 0
    for r in results:
        code = r.get("coverage") or {"none": "none", "wrong-season": "none", "no-feed": "results",
                                     "skipped": "skip"}.get(r.get("state"))
        if not code:
            continue                                  # an error says nothing about the source: what was there stays
        lg = data["leagues"].setdefault(r["league"], {"seasons": {}})
        lg["seasons"][r["season"]] = code
        why = NOTES.get(r["league"], {}).get(r["season"])
        lg.setdefault("why", {})
        if why and code not in ("full", "box", "mixed", "part"):
            lg["why"][r["season"]] = why
        else:
            lg["why"].pop(r["season"], None)
        if not lg["why"]:
            lg.pop("why")
        lg["checked"] = today
        n += 1
    data["checked"] = today
    lines = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, sort_keys=True)}"
                       for k, v in sorted(data["leagues"].items()))
    body = "{\n\"checked\": " + json.dumps(data["checked"]) + ",\n\"leagues\": {\n" + lines + "\n}}"
    open(path, "w", encoding="utf-8", newline="\n").write(
        "'use strict';\n"
        "/* WHAT EACH LEAGUE'S SOURCE HOLDS, SEASON BY SEASON - for the backfill panel (backfill-ui.js).\n"
        "   GENERATED by scripts/ingest/backfill_audit.py --coverage, which reads every league's source the way a\n"
        "   backfill does and samples three games of each season. Do not edit by hand: re-run the audit (one league\n"
        "   at a time is fine - the rest of the file is kept), and put the reasons a season cannot be filled in its\n"
        "   NOTES. */\n"
        "(function (root) {\n"
        f"const DATA = {BEGIN}\n{body}\n{END};\n"
        "if (typeof module === 'object' && module.exports) module.exports = DATA;\n"
        "else root.EPINOIA_BACKFILL_COVERAGE = DATA;\n"
        "}(typeof globalThis !== 'undefined' ? globalThis : self));\n")
    return n


def window(season: str) -> tuple[datetime, datetime]:
    """The dates a season's games fall between (generous: pre-season friendlies, late finals)."""
    s = str(season)
    if len(s) == 4:
        y = int(s)
        return datetime(y, 1, 1, tzinfo=timezone.utc), datetime(y + 1, 1, 15, tzinfo=timezone.utc)
    y = int(s[:4])
    return datetime(y, 7, 1, tzinfo=timezone.utc), datetime(y + 1, 8, 15, tzinfo=timezone.utc)


def when(t) -> datetime | None:
    if not t:
        return None
    try:
        d = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def audit_one(league: dict, season: str, sources: list[dict]) -> dict:
    out = {"league": league["slug"], "season": season, "state": None, "sources": [], "games": 0, "outside": 0,
           "sample": None, "note": ""}
    job = {"league_id": league["id"], "league_slug": league["slug"], "season": season}
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            pinned = R.backfill_sources(job, sources)
            if not pinned:
                out["state"] = "skipped"
                out["note"] = "; ".join(dict.fromkeys(job.get("skipped") or [])) or "no season-aware source"
                return out
            expanded = R.expand_competition_sources(pinned)
            expanded = fiba_format.stage_sources(expanded, get_adapter)
        if not expanded:
            out["state"] = "none"
            out["note"] = "the source publishes no " + season + " competition"
            return out
        lo, hi = window(season)
        now = datetime.now(timezone.utc)
        played = []
        for src in expanded:
            adapter = get_adapter(src["adapter"])
            cfg = dict(src.get("adapter_config", {}), code=src.get("code"))
            with redirect_stdout(buf):
                games = list(adapter.discover(src["schedule_url"], cfg))
            dated = [(g, when(g.tipoff_at)) for g in games]
            inside = [g for g, t in dated if t and lo <= t <= hi]
            outside = [g for g, t in dated if t and not (lo <= t <= hi)]
            out["sources"].append({"code": src.get("code"), "label": src.get("competition_label") or src.get("label"),
                                   "url": src.get("schedule_url"), "games": len(games), "inside": len(inside), "outside": len(outside)})
            out["games"] += len(games); out["outside"] += len(outside)
            played += [(src, g, t) for g, t in dated if t and lo <= t <= hi and t < now]
        if not out["games"]:
            out["state"] = "none"; return out
        if out["outside"] and out["outside"] >= max(3, out["games"] // 4):
            out["state"] = "wrong-season"
            return out
        if not played:
            out["state"] = "none"; out["note"] = "games listed, none played inside the season"; return out
        # THREE GAMES, a quarter, a half and three quarters of the way through the season. One game said too little:
        # the Danish women's 2020-21 sampled the one game of fifty with no feed and read as "no-feed", and a season
        # whose feed kept a box for some clubs and not others (Slovakia 2021-22) reads as whole or empty by luck.
        picks = sorted({min(len(played) - 1, (len(played) * k) // 4) for k in (1, 2, 3)})
        samples = []
        for i in picks:
            src, g, t = played[i]
            adapter = get_adapter(src["adapter"])
            with redirect_stdout(buf):
                b = adapter.fetch(g.external_id, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
            if not b:
                samples.append({"id": str(g.external_id), "at": g.tipoff_at, "box": 0, "pbp": 0, "kind": "empty"})
                continue
            nbox = len((b.box or {}).get("home") or []) + len((b.box or {}).get("away") or [])
            # LiveStats' play-by-play is translated from the raw feed (fiba_events.translate), not carried in b.pbp
            raw = b.raw if isinstance(b.raw, dict) else {}
            npbp = len(b.pbp or []) or (len(raw.get("pbp")) if isinstance(raw.get("pbp"), list) else 0)
            samples.append({"id": str(g.external_id), "at": g.tipoff_at, "status": b.status, "box": nbox, "pbp": npbp,
                            "stints": len(b.stints or []),
                            "kind": "empty" if nbox < 10 else ("full" if npbp else "box")})
        out["samples"] = samples
        out["sample"] = samples[len(samples) // 2]
        kinds = {s["kind"] for s in samples}
        out["state"] = "no-feed" if kinds == {"empty"} else "ok"
        out["coverage"] = coverage_of(kinds)
        if out["coverage"] == "box":
            out["note"] = "box score only, no play-by-play"
        elif out["coverage"] == "mixed":
            out["note"] = "box scores; play-by-play for some games only"
        elif out["coverage"] == "part":
            out["note"] = f"{sum(1 for s in samples if s['kind'] == 'empty')} of {len(samples)} sampled games have no box score"
        return out
    except Exception as exc:
        out["state"] = "error"; out["note"] = f"{type(exc).__name__}: {exc}"[:300]
        return out
    finally:
        out["log"] = buf.getvalue()[-1500:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-config", action="store_true")
    ap.add_argument("--league", default=None, help="slugs, comma-separated (default: every league with a source)")
    ap.add_argument("--skip", default=None, help="slugs to leave out, comma-separated (a league with games on right now)")
    ap.add_argument("--seasons", default=None, help="override the seasons tried (split or calendar names)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=420, help="seconds per league-season")
    ap.add_argument("--out", default="backfill_audit.json")
    ap.add_argument("--coverage", default=None,
                    help="also merge the result into the console's file (epinoia/admin/backfill-coverage.js)")
    args = ap.parse_args()
    if args.worker_config:
        p = os.path.join(os.environ.get("APPDATA", ""), "epinoia", "worker.json")
        w = json.load(open(p, encoding="utf-8"))
        os.environ.setdefault("SUPABASE_URL", w["supabase_url"]); os.environ.setdefault("SUPABASE_SERVICE_KEY", w["service_key"])
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    sb = R.Supabase(url, key) if url and key else None        # READ ONLY: used for the source list and the leagues
    with redirect_stdout(io.StringIO()):
        sources = R.load_sources(sb, sb is None, None)
    leagues = sb.select("leagues", "select=id,slug,name&order=slug") if sb else []
    want = {x.strip() for x in (args.league or "").split(",") if x.strip()}
    skip = {x.strip() for x in (args.skip or "").split(",") if x.strip()}
    todo = []
    for lg in leagues:
        if (want and lg["slug"] not in want) or lg["slug"] in skip:
            continue
        mine = [s for s in sources if s.get("league_id") == lg["id"] or s.get("league_slug") == lg["slug"]]
        if not mine:
            continue
        cal = any((s.get("adapter_config") or {}).get("season_calendar") for s in mine)
        seasons = [x.strip() for x in args.seasons.split(",")] if args.seasons else (CALENDAR if cal else SPLIT)
        for season in seasons:
            todo.append((lg, season, mine))
    say = lambda *a, **k: print(*a, file=sys.stderr, flush=True, **{x: y for x, y in k.items() if x != "flush"})
    # PROGRESS ON STDERR: each worker swaps sys.stdout to swallow the adapters' own chatter, and that swap is process-wide
    say(f"{len(todo)} league-season(s) to audit, {args.threads} at a time")
    results = []
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.threads) as ex:
        futs = {ex.submit(audit_one, lg, season, mine): (lg, season) for lg, season, mine in todo}
        for f in cf.as_completed(futs):
            lg, season = futs[f]
            try:
                r = f.result(timeout=args.timeout)
            except Exception as exc:
                r = {"league": lg["slug"], "season": season, "state": "error", "note": f"timeout/{exc}"[:200]}
            results.append(r)
            say(f"{time.time() - t0:6.0f}s  {r['league']:<34} {r['season']:<8} {r['state']:<12} games {r.get('games', 0):>4}"
                  + (f" outside {r['outside']}" if r.get("outside") else "")
                  + (f"  sample box {r['sample'].get('box')} pbp {r['sample'].get('pbp')}" if r.get("sample") else "")
                  + (f"  - {r['note']}" if r.get("note") else ""))
    json.dump(sorted(results, key=lambda r: (r["league"], r["season"])), open(args.out, "w", encoding="utf-8"), indent=1)
    if args.coverage:
        n = write_coverage(args.coverage, results, datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        say(f"coverage: {n} league-season(s) written to {args.coverage}")
    by = {}
    for r in results:
        by.setdefault(r["league"], []).append(r["state"])
    print("\nleague".ljust(36), "states")
    for lg in sorted(by):
        say(lg.ljust(35), " ".join(sorted(by[lg])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
