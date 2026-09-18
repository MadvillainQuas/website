#!/usr/bin/env python3
"""
repair_numeric_short_names.py — a one-off repair for teams.short_name.

feedplatform.py's team() used to fall back a club's short_name to whatever "code" its own
source uses to key it, at the moment the club is first created. For most feeds that code is a
real letter abbreviation ("KOM"), but the Slovak SBL's schedule (fiba_site_schedule.py) carries
no such thing -- its crest URLs carry only the club's own numeric id on that site
(Competitor/699079/…) -- so eleven clubs were created with short_name literally "699079" and so
on. That fallback is fixed (feedplatform.py, 2026-09-18), so no NEW club can be poisoned this
way; short_name is only ever set at creation, though, so the clubs already created stay wrong
until this runs once.

Finds every team whose short_name is nothing but digits and sets it to the team's own name
(latinised the same way feedplatform.py would, truncated to 12 chars, the same limit it writes
to on creation) -- never a colour_source-style "already fixed, skip" column to check, so
--dry-run is how you see what it would do before it does it.

    python scripts/ingest/repair_numeric_short_names.py                # every affected team
    python scripts/ingest/repair_numeric_short_names.py --dry-run      # report only, write nothing
    python scripts/ingest/repair_numeric_short_names.py --league slug  # one league only

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config for %APPDATA%\\epinoia\\worker.json).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import names  # noqa: E402

NUMERIC = re.compile(r'^\d+$')


class _Sb:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def select(self, table: str, query: str):
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30)
        r.raise_for_status(); return r.json()

    def patch(self, table: str, query: str, body: dict):
        r = requests.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, json=body, timeout=30)
        r.raise_for_status(); return r.json() if r.text else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--league', help='league slug: only that league\'s teams')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--worker-config', action='store_true', help=r'take the URL and key from %APPDATA%\epinoia\worker.json')
    a = ap.parse_args()

    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if a.worker_config:
        cfg = json.load(open(os.path.join(os.environ['APPDATA'], 'epinoia', 'worker.json')))
        url, key = cfg['supabase_url'], cfg['service_key']
    if not (url and key):
        print('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); return 2
    sb = _Sb(url, key)

    q = 'select=id,slug,name,short_name,league_id'
    if a.league:
        lg = sb.select('leagues', f"slug=eq.{a.league}&select=id")
        if not lg:
            print(f"no league '{a.league}'"); return 1
        q += f"&league_id=eq.{lg[0]['id']}"
    teams = [t for t in sb.select('teams', q) if NUMERIC.match(t.get('short_name') or '')]
    if not teams:
        print('nothing to repair'); return 0
    for t in teams:
        nice = names.team_name(t.get('name') or '') or t.get('name') or ''
        sn = nice[:12]
        print(f"   {t['slug']:28s} {t['short_name']!r:10s} -> {sn!r}")
        if not a.dry_run:
            sb.patch('teams', f"id=eq.{t['id']}", {'short_name': sn})
    print(f"{len(teams)} team(s) {'would be ' if a.dry_run else ''}repaired")
    return 0


if __name__ == '__main__':
    sys.exit(main())
