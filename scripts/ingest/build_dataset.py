#!/usr/bin/env python3
"""
build_dataset.py — regenerate a league's 13-CSV dataset (the folder index_9
auto-loads) the same way "Scrape Now.bat" does, but served from the feed
archive so games we already have are never re-fetched from the league site.

It runs the scraper project's own entry point in-process
(scrape-now.py --competition CODE [--no-upload]) after patching
fiba_api_parser.fetch_data_json to read data/feed/<CODE>/games/<id>.json
first (network only for ids the feed has not archived). scrape-now.py then
does everything it always did: discovery, the LINEUPDATASCRAPE pipeline, the
13 CSVs, and the GitHub upload into the website's data/ folder. Afterwards
this script points data/latest.json at the newest data_*_<CODE> folder so
index_9 follows it on next load.

    python scripts/ingest/build_dataset.py --source SLB             # scrape-now + upload
    python scripts/ingest/build_dataset.py --source SLB --no-upload # local only

Needs the scraper folder (SCRAPER_DIR env, default C:\\Users\\Admin\\Documents\\scraper files)
and headless Chrome for schedule discovery. Politeness is the pipeline's.
"""
from __future__ import annotations

import argparse
import json
import os
import runpy
import sys
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parents[2]
FEED_DIR = REPO_ROOT / "data" / "feed"
LATEST = REPO_ROOT / "data" / "latest.json"
SCRAPER_DIR = os.environ.get("SCRAPER_DIR", r"C:\Users\Admin\Documents\scraper files")


def newest_dataset(code: str) -> str | None:
    cands = []
    for root in (REPO_ROOT / "data", Path.home() / "scraped_data", Path(SCRAPER_DIR) / "data"):
        if root.exists():
            cands += [p for p in root.glob(f"data_*_{code}") if p.is_dir()]
    if not cands:
        return None
    return sorted(cands, key=lambda p: p.name)[-1].name


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="competition code (e.g. SLB)")
    ap.add_argument("--no-upload", action="store_true", help="pass --no-upload to scrape-now.py")
    args = ap.parse_args()
    code = args.source.upper()

    if not os.path.isdir(SCRAPER_DIR):
        raise SystemExit(f"scraper folder not found: {SCRAPER_DIR} (set SCRAPER_DIR)")
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import fiba_api_parser as fap  # noqa: E402

    archive = FEED_DIR / code / "games"
    _network = fap.fetch_data_json
    hits = {"archive": 0, "network": 0}

    def fetch_archive_first(match_id, session=None, timeout=30, max_retries=3):
        p = archive / f"{match_id}.json"
        if p.exists():
            try:
                hits["archive"] += 1
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
        hits["network"] += 1
        return _network(match_id, session=session, timeout=timeout, max_retries=max_retries)

    fap.fetch_data_json = fetch_archive_first
    print(f"-> scrape-now --competition {code} with data.json served from {archive}")
    before = newest_dataset(code)
    os.chdir(SCRAPER_DIR)
    sys.argv = ["scrape-now.py", "--competition", code] + (["--no-upload"] if args.no_upload else [])
    try:
        runpy.run_path(os.path.join(SCRAPER_DIR, "scrape-now.py"), run_name="__main__")
    except SystemExit as exc:
        if exc.code not in (0, None):
            print(f"   scrape-now exited with {exc.code}")
    print(f"   data.json served from archive {hits['archive']}x, network {hits['network']}x")

    after = newest_dataset(code)
    if after and after != before:
        latest = {}
        if LATEST.exists():
            try:
                latest = json.loads(LATEST.read_text(encoding="utf-8"))
            except Exception:
                latest = {}
        latest[code] = after
        latest["_updated"] = datetime.now(timezone.utc).isoformat()
        LATEST.write_text(json.dumps(latest, indent=1), encoding="utf-8")
        print(f"   data/latest.json -> {code}: {after}")
        if not args.no_upload:
            try:
                sn = sys.modules.get("scrape-now") or runpy.run_path(os.path.join(SCRAPER_DIR, "scrape-now.py"), run_name="scrape_now_lib")
                up = sn.get("github_upload_file") if isinstance(sn, dict) else getattr(sn, "github_upload_file", None)
                if up:
                    up("data/latest.json", str(LATEST), message=f"latest.json: {code} -> {after}")
                    print("   latest.json uploaded")
            except Exception as exc:
                print(f"   (latest.json upload skipped: {exc}) — commit data/latest.json by hand")
    else:
        print("   no new dataset folder detected; latest.json unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
