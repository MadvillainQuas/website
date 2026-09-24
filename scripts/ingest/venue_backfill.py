"""The arena for games already stored (EPINOIA GO, docs/epinoia-go.md step 1.3).

The ingest writes games.venue when it files a fixture and, since 0162, when it writes a played game. A game
filed before an adapter learnt to keep its venue (EuroLeague and EuroCup until 2026-09-24) has none, and the
ingest will not visit it again once it is final. This reads each league's CURRENT-season schedule - discovery
only, the one or two pages the ingest reads every run, never a game - and fills games.venue where it is empty.
It never overwrites a venue already there. With 0162 applied, the trigger links each one to its arena.

    python scripts/ingest/venue_backfill.py --worker-config              what it would fill, per league
    python scripts/ingest/venue_backfill.py --worker-config --write      fill it
    python scripts/ingest/venue_backfill.py --worker-config --source EL  one league

Leagues whose feeds name no venue at all (Liga Endesa, ProA/ProB, LNBP, Kooperativa NBL, 1 Liga Mężczyzn,
Kosovo) are reported as such: their games take the home club's arena (0162 game_venue_id).
"""
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from adapters import get_adapter  # noqa: E402
import run_ingest as RI  # noqa: E402


def schedule_venues(adapter, src: dict) -> dict:
    """{external_id: (venue, address)} from one source's schedule."""
    games = list(adapter.discover(src["schedule_url"], dict(src.get("adapter_config", {}), code=src.get("code"))) or [])
    out = {}
    for g in games:
        ex = g.extra or {}
        v = (ex.get("venue") or "").strip()
        if v:
            out[str(g.external_id)] = (v, (ex.get("venue_address") or "").strip() or None)
    return out, len(games)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--worker-config", action="store_true")
    ap.add_argument("--write", action="store_true", help="fill the empty venues (without it, only report)")
    ap.add_argument("--source", help="one source code (EL, ABA, ...)")
    args = ap.parse_args(argv)
    if args.worker_config:
        cfg = json.load(open(os.path.join(os.environ["APPDATA"], "epinoia", "worker.json")))
        os.environ.setdefault("SUPABASE_URL", cfg["supabase_url"])
        os.environ.setdefault("SUPABASE_SERVICE_KEY", cfg["service_key"])
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY missing (use --worker-config)")
        return 2
    sb = RI.Supabase(url, key)
    sources = RI.load_sources(sb, True, None)
    seen, filled_total = set(), 0
    for src in sources:
        if args.source and src.get("code") != args.source:
            continue
        ident = (src["adapter"], json.dumps(src.get("adapter_config") or {}, sort_keys=True), src["schedule_url"].split("#")[0])
        if ident in seen:
            continue
        seen.add(ident)
        try:
            adapter = get_adapter(src["adapter"])
            venues, n = schedule_venues(adapter, src)
        except Exception as exc:
            print(f"  {src['code']:<8} {src['adapter']:<18} schedule unreadable: {exc}")
            continue
        if not venues:
            print(f"  {src['code']:<8} {src['adapter']:<18} {n} games, the feed names no venue (home club's arena)")
            continue
        ext = sb.select("external_games", f"adapter=eq.{src['adapter']}&game_id=not.is.null&select=external_id,game_id&limit=5000")
        gid = {str(r["external_id"]): r["game_id"] for r in ext if str(r["external_id"]) in venues}
        empty = set()
        ids = list(gid.values())
        for i in range(0, len(ids), 150):
            rows = sb.select("games", f"id=in.({','.join(ids[i:i + 150])})&venue=is.null&select=id")
            empty |= {r["id"] for r in rows}
        todo = [(x, g) for x, g in gid.items() if g in empty]
        print(f"  {src['code']:<8} {src['adapter']:<18} {n} games, {len(venues)} with a venue, "
              f"{len(gid)} stored, {len(todo)} to fill")
        if args.write:
            for x, g in todo:
                v, addr = venues[x]
                sb.patch("games", f"id=eq.{g}&venue=is.null", {"venue": v, **({"venue_address": addr} if addr else {})})
            filled_total += len(todo)
    if args.write:
        print(f"filled {filled_total} games")
        try:
            print("clubs given a home arena:", sb.rpc("learn_home_venues"))
        except Exception as exc:
            print(f"(learn_home_venues not run: {exc} - apply 0162 first)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
