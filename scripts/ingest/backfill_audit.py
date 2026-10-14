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
        # one game from the middle of the season: early-season games are where feeds start late
        src, g, t = played[len(played) // 2]
        adapter = get_adapter(src["adapter"])
        with redirect_stdout(buf):
            b = adapter.fetch(g.external_id, dict(src.get("adapter_config", {}), _tipoff_at=g.tipoff_at))
        if not b:
            out["state"] = "no-feed"; out["sample"] = {"id": str(g.external_id), "at": g.tipoff_at, "box": 0, "pbp": 0}
            return out
        nbox = len((b.box or {}).get("home") or []) + len((b.box or {}).get("away") or [])
        # LiveStats' play-by-play is translated from the raw feed (fiba_events.translate), not carried in b.pbp
        raw = b.raw if isinstance(b.raw, dict) else {}
        npbp = len(b.pbp or []) or (len(raw.get("pbp")) if isinstance(raw.get("pbp"), list) else 0)
        out["sample"] = {"id": str(g.external_id), "at": g.tipoff_at, "status": b.status, "box": nbox, "pbp": npbp, "stints": len(b.stints or [])}
        out["state"] = "ok" if nbox >= 10 else "no-feed"
        if out["state"] == "ok" and not npbp:
            out["note"] = "box score only, no play-by-play"
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
    ap.add_argument("--seasons", default=None, help="override the seasons tried (split or calendar names)")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=420, help="seconds per league-season")
    ap.add_argument("--out", default="backfill_audit.json")
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
    todo = []
    for lg in leagues:
        if want and lg["slug"] not in want:
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
    by = {}
    for r in results:
        by.setdefault(r["league"], []).append(r["state"])
    print("\nleague".ljust(36), "states")
    for lg in sorted(by):
        say(lg.ljust(35), " ".join(sorted(by[lg])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
