"""bio_sync.py - fill players' height, weight and (secret) date of birth from a league's own feed or club pages.

    python scripts/ingest/bio_sync.py                          # every league that has a reader
    python scripts/ingest/bio_sync.py --league euroleague      # one league, by slug
    python scripts/ingest/bio_sync.py --dry-run                # read, match and print; write nothing
    python scripts/ingest/bio_sync.py --dry-run --limit 20     # stop after twenty would-be writes
    python scripts/ingest/bio_sync.py --stash-only             # read no feed: give the kept rows to the players made since

A feed row that matches nobody on the site yet (a roster read before the season's first game, a signing who has not played) is kept in
player_bio_pending (0186) and offered again on every later pass, so a league read too early is not a wasted read.
Only blanks are filled, adults' dates go to a column the browser cannot read, under-18s get a birth year only: the rules are in bio.py.
Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (or --worker-config to read %APPDATA%\\epinoia\\worker.json) - even for --dry-run, because
matching is against the players already on the site. Runs weekly from .github/workflows/bio.yml.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from itertools import chain
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bio  # noqa: E402
import bio_sources  # noqa: E402
import run_ingest as RI  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--league", action="append", help="a league slug (repeatable); default every league with a reader")
    ap.add_argument("--dry-run", action="store_true", help="print what would be written, write nothing")
    ap.add_argument("--limit", type=int, default=0, help="stop a league after this many writes")
    ap.add_argument("--verbose", action="store_true", help="also print every feed row that matched nobody")
    ap.add_argument("--stash-only", action="store_true", help="read no feed: offer the rows kept for players not on the site yet to the players made since")
    ap.add_argument("--no-stash", action="store_true", help="neither keep nor offer rows for players not on the site yet")
    ap.add_argument("--worker-config", action="store_true", help=r"take SUPABASE_URL / SUPABASE_SERVICE_KEY from %%APPDATA%%\epinoia\worker.json")
    args = ap.parse_args()
    if args.worker_config:
        try:
            cfg = json.load(open(os.path.join(os.environ["APPDATA"], "epinoia", "worker.json")))
            os.environ.setdefault("SUPABASE_URL", cfg["supabase_url"])
            os.environ.setdefault("SUPABASE_SERVICE_KEY", cfg["service_key"])
        except Exception as exc:
            print(f"--worker-config: {exc}")
            return 2
    bio.VERBOSE = args.verbose
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
        return 2
    sb = RI.Supabase(url, key)
    has_dob = bio.probe_dob(sb)
    print("players.birth_date: " + ("there (adults' dates are kept, secret)" if has_dob else "NOT there yet (0184 unapplied): birth years only"))
    if args.stash_only:
        slugs = args.league or bio.Stash.leagues(sb)
        print(f"stash only: {len(slugs)} league(s) with players waiting")
    else:
        # a league whose site refuses a GitHub runner is left out of a scheduled run (it is run by hand from home)
        slugs = args.league or [s for s in bio_sources.READERS if not (os.environ.get("GITHUB_ACTIONS") and s in bio_sources.HOME_ONLY)]
        unknown = [s for s in slugs if s not in bio_sources.READERS]
        if unknown:
            print("no reader for: " + ", ".join(unknown) + "  (have: " + ", ".join(bio_sources.READERS) + ")")
            return 2
    failed = 0
    for slug in slugs:
        print(f"== {slug}")
        try:
            try:
                players = bio.load_players(sb, slug, has_dob)
                print(f"   {len(players)} players on the site")
            except bio.NoLeague:
                players = []                                # no game yet, so no league: its roster is still worth keeping
                print("   not on the site yet (no game ingested): every row is kept for later")
            stash = None if args.no_stash else bio.Stash.load(sb, slug, dry=args.dry_run)
            if stash is None and not args.no_stash:
                print("   player_bio_pending is not there (0186 unapplied): rows for players not on the site yet are not kept")
            if args.stash_only:
                records = stash.records() if stash else []
            else:
                try:
                    teams = bio.load_teams(sb, slug) if slug in bio_sources.NEEDS_TEAMS else None
                except bio.NoLeague:
                    teams = []
                feed = bio_sources.READERS[slug](players=players, teams=teams)
                records = chain(feed, stash.records()) if stash else feed          # the feed's own rows first: they are the fresher
            st = bio.sync(sb, players, records, dry=args.dry_run, has_dob=has_dob, limit=args.limit, stash=stash)
            if stash:
                st.update(stash.flush())
            print("   " + ", ".join(f"{k} {v}" for k, v in st.items()) + ("  (dry run: nothing written)" if args.dry_run else ""))
        except Exception as exc:                            # one league's feed being down is not the others'
            failed += 1
            print(f"   FAILED: {exc}")
    return 1 if slugs and failed == len(slugs) else 0


if __name__ == "__main__":
    sys.exit(main())
