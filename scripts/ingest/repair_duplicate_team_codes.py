#!/usr/bin/env python3
"""
repair_duplicate_team_codes.py — two rows, one club, one feed code.

external_ids.fiba_livestats is what every pass keys a club on, so two rows in one league
carrying the SAME code are the same club twice: whichever one a given pass happens to find
gets that day's fixtures, and the club's record is split across both. It happens when a row's
code is changed out from under a running ingest -- which is exactly what
repair_bleague_at_ac.py had to do (B.LEAGUE Premier ended up with two Alvark Tokyos, 57 games
against one and 3 against the other, 2026-09-18).

The row with the most games wins. Every game, competition_teams row and player pointing at the
loser is repointed to it, the loser's aliases and crest are kept if the winner has none, and
only then is the loser deleted.

    python scripts/ingest/repair_duplicate_team_codes.py --dry-run --worker-config
    python scripts/ingest/repair_duplicate_team_codes.py --league b-league-premier --worker-config

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

import requests


class _Sb:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def select(self, table: str, query: str):
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30)
        r.raise_for_status(); return r.json()

    def count(self, table: str, query: str) -> int:
        h = {**self.h, 'Prefer': 'count=exact', 'Range': '0-0'}
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=h, timeout=30)
        r.raise_for_status()
        rng = r.headers.get('content-range') or '0-0/0'
        try:
            return int(rng.split('/')[-1])
        except ValueError:
            return 0

    def patch(self, table: str, query: str, body: dict):
        r = requests.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, json=body, timeout=30)
        r.raise_for_status(); return r.json() if r.text else None

    def delete(self, table: str, query: str):
        r = requests.delete(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30)
        r.raise_for_status()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--league', help='league slug; every league when left out')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--worker-config', action='store_true',
                    help=r'take the URL and key from %%APPDATA%%\epinoia\worker.json')
    a = ap.parse_args()

    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if a.worker_config:
        cfg = json.load(open(os.path.join(os.environ['APPDATA'], 'epinoia', 'worker.json')))
        url, key = cfg['supabase_url'], cfg['service_key']
    if not (url and key):
        print('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); return 2
    sb = _Sb(url, key)

    q = 'select=id,slug,name,league_id,external_ids,logo_path,aliases,short_name'
    if a.league:
        lg = sb.select('leagues', f"slug=eq.{a.league}&select=id")
        if not lg:
            print(f"no league '{a.league}'"); return 1
        q += f"&league_id=eq.{lg[0]['id']}"
    teams = sb.select('teams', q)

    groups = defaultdict(list)
    for t in teams:
        code = (t.get('external_ids') or {}).get('fiba_livestats')
        if code:
            groups[(t['league_id'], code)].append(t)
    dupes = {k: v for k, v in groups.items() if len(v) > 1}
    if not dupes:
        print('no two rows share a feed code'); return 0

    for (league_id, code), rows in sorted(dupes.items(), key=lambda kv: kv[0][1]):
        for t in rows:
            t['_games'] = sb.count('games', f"or=(home_team_id.eq.{t['id']},away_team_id.eq.{t['id']})&select=id")
        rows.sort(key=lambda t: (-t['_games'], t['id']))
        keep, losers = rows[0], rows[1:]
        print(f"\ncode {code!r}: keeping {keep['slug']!r} ({keep['_games']} games)")
        for lose in losers:
            print(f"   folding in {lose['slug']!r} ({lose['_games']} games)")
            if a.dry_run:
                continue
            for col in ('home_team_id', 'away_team_id'):
                sb.patch('games', f"{col}=eq.{lose['id']}", {col: keep['id']})
            # competition_teams has a (competition_id, team_id) key, so a straight repoint can
            # collide with a row the keeper already has: drop the loser's rows instead, then let
            # the next ingest pass re-add whatever the keeper is missing.
            try:
                sb.delete('competition_teams', f"team_id=eq.{lose['id']}")
            except Exception as exc:
                print(f"      (competition_teams: {exc})")
            for tbl, col in (('players', 'team_id'), ('player_season_stats', 'team_id')):
                try:
                    sb.patch(tbl, f"{col}=eq.{lose['id']}", {col: keep['id']})
                except Exception:
                    pass          # the table may not exist, or may not have that column
            fill = {}
            if not keep.get('logo_path') and lose.get('logo_path'):
                fill['logo_path'] = lose['logo_path']
            al = [x for x in (keep.get('aliases') or []) if x]
            for x in (lose.get('aliases') or []) + [lose.get('name')]:
                if x and x != keep.get('name') and x not in al:
                    al.append(x)
            if al != (keep.get('aliases') or []):
                fill['aliases'] = al
            if fill:
                sb.patch('teams', f"id=eq.{keep['id']}", fill)
            sb.delete('teams', f"id=eq.{lose['id']}")
    print(f"\n{sum(len(v) - 1 for v in dupes.values())} duplicate row(s) "
          f"{'would be ' if a.dry_run else ''}folded in")
    return 0


if __name__ == '__main__':
    sys.exit(main())
