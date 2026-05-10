#!/usr/bin/env python3
"""
gamevis_schedule_scraper.py — pre-scrape FIBA schedules for the website's
GameVis wrapper.

Lives in the website repo so GitHub Actions can run it on a cron without
needing the separate scraper folder. Self-contained: no imports from
sibling scraper projects.

Pipeline:
  1. Read   config/gamevis-competitions.json
  2. For each competition, render every schedule URL with headless Chrome
     and extract FIBA matchIds from the rendered DOM. SLB and most other
     league sites are SPAs — server-side rendering is the only way.
  3. For each matchId, fetch
        https://fibalivestats.dcd.shared.geniussports.com/data/<id>/data.json
     directly (no CORS server-side).
  4. Write data/gamevis/<CODE>/index.json — a slim list of games + metadata
     that the wrapper reads on demand for instant load with zero
     client-side proxy spend.

Politeness: sleeps between requests, retries with backoff, sets a real
User-Agent. Designed to be safe to run every 30 minutes.

Usage:
    python scripts/gamevis_schedule_scraper.py                # all comps
    python scripts/gamevis_schedule_scraper.py --competition SLB
    python scripts/gamevis_schedule_scraper.py --headed       # visible browser
"""

import os
import re
import sys
import json
import time
import glob
import argparse
import requests
from pathlib import Path
from datetime import datetime, timezone

# ─── config ─────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent.resolve()
REPO_ROOT    = SCRIPT_DIR.parent
COMP_CONFIG  = REPO_ROOT / "config" / "gamevis-competitions.json"
DATA_GAMEVIS = REPO_ROOT / "data" / "gamevis"

FIBA_BASE     = "https://fibalivestats.dcd.shared.geniussports.com"
GAME_DATA_URL = FIBA_BASE + "/data/{game_id}/data.json"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 "
      "ProphesyGameVisScraper/1.0")

# Politeness — minimum gap between any two outbound HTTP requests.
MIN_REQUEST_GAP_S = 0.30
_last_request_at = 0.0

# Schedule HTML game-ID extraction patterns (mirrors the wrapper's JS).
GAME_ID_PATTERNS = [
    re.compile(r'extfix_(\d{5,10})'),
    re.compile(r'/match/(\d{5,10})/'),
    re.compile(r'/u/[A-Z]+/(\d{5,10})/'),
    re.compile(r'matchId["\']?\s*[:=]\s*["\']?(\d{5,10})'),
    re.compile(r'fibalivestats\.dcd\.shared\.geniussports\.com/data/(\d{5,10})'),
    re.compile(r'/data/(\d{6,10})/data\.json'),
]

# How long the SPA needs to render before we scrape its DOM.
SCHEDULE_RENDER_DELAY_S = 6


def _polite_sleep():
    """Sleep just enough that we honour MIN_REQUEST_GAP_S."""
    global _last_request_at
    now = time.time()
    gap = (_last_request_at + MIN_REQUEST_GAP_S) - now
    if gap > 0:
        time.sleep(gap)
    _last_request_at = time.time()


# ─── browser bootstrap ──────────────────────────────────────────────────
def _find_chrome_binary():
    candidates = [
        os.environ.get("CHROME_BINARY"),
        "/usr/bin/google-chrome",                                          # Ubuntu (GH Actions)
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%USERPROFILE%\.cache\puppeteer\chrome\win64-*\chrome-win64\chrome.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if not c:
            continue
        if "*" in c:
            matches = sorted(glob.glob(c), reverse=True)
            if matches:
                return matches[0]
        elif os.path.exists(c):
            return c
    return None


def _make_driver(headless=True):
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1600,1100")
    opts.add_argument(f"user-agent={UA}")
    binary = _find_chrome_binary()
    if binary:
        opts.binary_location = binary
        if "msedge" in binary.lower():
            from selenium.webdriver.edge.options import Options as EdgeOptions
            eopts = EdgeOptions()
            for arg in opts.arguments:
                eopts.add_argument(arg)
            eopts.binary_location = binary
            return webdriver.Edge(options=eopts)
    return webdriver.Chrome(options=opts)


def discover_game_ids(schedule_urls, headless=True):
    """Render each schedule URL with headless Chrome, scrape matchIds from
    the rendered DOM. Returns a sorted, de-duped list of string IDs."""
    print(f"  ⚙  spinning up headless Chrome…")
    driver = _make_driver(headless=headless)
    all_ids = set()
    try:
        for url in schedule_urls:
            print(f"  → {url}")
            try:
                driver.get(url)
                time.sleep(SCHEDULE_RENDER_DELAY_S)
                html = driver.page_source
                ids = set()
                for pat in GAME_ID_PATTERNS:
                    ids.update(pat.findall(html))
                # Also peek inside iframes — SLB embeds WonderHub in one.
                try:
                    for frame in driver.find_elements("tag name", "iframe"):
                        try:
                            driver.switch_to.frame(frame)
                            time.sleep(2)
                            inner = driver.page_source
                            for pat in GAME_ID_PATTERNS:
                                ids.update(pat.findall(inner))
                        finally:
                            driver.switch_to.default_content()
                except Exception:
                    pass
                print(f"     found {len(ids)} game IDs")
                all_ids.update(ids)
            except Exception as e:
                print(f"     ! ERROR: {e}")
    finally:
        try:
            driver.quit()
        except Exception:
            pass
    return sorted(all_ids, key=lambda x: int(x))


# ─── data.json fetcher ──────────────────────────────────────────────────
def fetch_game_data(game_id, max_retries=3, retry_delay=2):
    """Fetch a single game's data.json. Returns dict or None."""
    url = GAME_DATA_URL.format(game_id=game_id)
    for attempt in range(1, max_retries + 1):
        _polite_sleep()
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            if r.ok:
                return r.json()
            if r.status_code == 404:
                return None
            print(f"     [warn] HTTP {r.status_code} game {game_id} (attempt {attempt}/{max_retries})")
        except (requests.RequestException, ValueError) as e:
            print(f"     [warn] {type(e).__name__}: {e} (attempt {attempt}/{max_retries})")
        if attempt < max_retries:
            time.sleep(retry_delay * attempt)
    return None


def json_to_meta(game_id, data, league_code="SLB"):
    """Slim per-game record matching the wrapper's expectations."""
    if not data or not isinstance(data, dict) or not data.get("tm"):
        return None
    t1 = data["tm"].get("1", {}) or {}
    t2 = data["tm"].get("2", {}) or {}
    return {
        "gameId":    str(game_id),
        "homeTeam":  t1.get("name") or t1.get("shortName") or "Home",
        "awayTeam":  t2.get("name") or t2.get("shortName") or "Away",
        "homeScore": t1.get("score") or 0,
        "awayScore": t2.get("score") or 0,
        "gameDate":  data.get("matchDate") or data.get("date") or "",
        "bsUrl":     f"{FIBA_BASE}/u/{league_code}/{game_id}/bs.html",
        "pbpUrl":    f"{FIBA_BASE}/u/{league_code}/{game_id}/pbp.html",
    }


# ─── core ───────────────────────────────────────────────────────────────
def load_competitions():
    if not COMP_CONFIG.exists():
        print(f"[fatal] {COMP_CONFIG} not found")
        return []
    with COMP_CONFIG.open(encoding="utf-8") as f:
        return json.load(f).get("competitions", [])


def scrape_competition(comp, headless=True):
    code  = (comp.get("code") or "").strip().upper()
    label = comp.get("label", code)
    schedule_urls = [u for u in comp.get("scheduleUrls", []) if u]

    print(f"\n[{code}] {label}")
    print(f"  schedule URLs: {len(schedule_urls)}")
    if not schedule_urls:
        print("  ! none configured — skipping")
        return False

    ids = discover_game_ids(schedule_urls, headless=headless)
    print(f"  → {len(ids)} unique game IDs")
    if not ids:
        print("  ! discovery returned zero IDs — schedule pages may have moved")
        return False

    print(f"  fetching {len(ids)} data.json files…")
    out_dir = DATA_GAMEVIS / code
    out_dir.mkdir(parents=True, exist_ok=True)
    games = []
    failed = 0

    for i, gid in enumerate(ids, 1):
        try:
            data = fetch_game_data(gid)
            if not data:
                failed += 1
                continue
            meta = json_to_meta(gid, data, league_code=code)
            if not meta:
                failed += 1
                continue
            games.append(meta)
            if i % 20 == 0 or i == len(ids):
                print(f"    [{i:3d}/{len(ids)}] OK · {meta['homeTeam']} vs {meta['awayTeam']} "
                      f"({meta['homeScore']}-{meta['awayScore']})")
        except Exception as e:
            failed += 1
            print(f"    [{i:3d}/{len(ids)}] {gid}: ERROR {e}")

    print(f"  → {len(games)} games fetched ({failed} failed)")
    if not games:
        return False

    # Sort newest first
    games.sort(key=lambda g: (g.get("gameDate", ""), int(g["gameId"])), reverse=True)

    payload = {
        "_comment": (f"Pre-scraped GameVis schedule for {label}. "
                     "Auto-generated by scripts/gamevis_schedule_scraper.py via the "
                     "GameVis schedule pre-scrape GitHub Action. The wrapper "
                     "(gamevis.html) reads this for instant load with no client-side CORS spend."),
        "code":         code,
        "label":        label,
        "scrapedAt":    datetime.now(timezone.utc).isoformat(),
        "scheduleUrls": schedule_urls,
        "games":        games,
    }
    index_path = out_dir / "index.json"
    with index_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"  ✓ wrote {index_path.relative_to(REPO_ROOT)} ({len(games)} games)")
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--competition", help="Only scrape this code (e.g. SLB)")
    p.add_argument("--headed", action="store_true", help="Visible browser (debug)")
    args = p.parse_args()

    DATA_GAMEVIS.mkdir(parents=True, exist_ok=True)
    comps = load_competitions()
    if not comps:
        print("No competitions in config/gamevis-competitions.json")
        return 1

    if args.competition:
        target = args.competition.strip().upper()
        comps = [c for c in comps if (c.get("code") or "").strip().upper() == target]
        if not comps:
            print(f"No competition '{target}' in config")
            return 1

    print(f"\nScraping {len(comps)} competition(s)…")
    succeeded = []
    for comp in comps:
        if scrape_competition(comp, headless=not args.headed):
            succeeded.append(comp["code"].strip().upper())

    print(f"\nDone — {len(succeeded)}/{len(comps)} competition(s) scraped: "
          f"{', '.join(succeeded) if succeeded else '(none)'}")
    return 0 if succeeded else 1


if __name__ == "__main__":
    sys.exit(main())
