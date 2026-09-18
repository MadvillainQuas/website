#!/usr/bin/env python3
"""
repair_bleague_at_ac.py — un-merge Alvark Tokyo and Altiri Chiba.

Both clubs' schedule-card abbreviations carry a Latin prefix over their kanji name -- "A東京"
(Alvark Tokyo) and "A千葉" (Altiri Chiba) -- and names.club_core()'s OLD tokenizer treated every
kanji character as separator noise, collapsing both names to the single token {"a"}. same_club()
then called them the same club wearing a different sponsor: the automated ingest merged Altiri
Chiba's fixtures onto Alvark Tokyo's row (found + club_core fixed 2026-09-18; see names.py and
names_test.py's "a kanji club name is not punctuation" section for the fix itself).

The damage from BEFORE that fix is still in the database: one team row, slug "at", carrying
Alvark Tokyo's original slug, Altiri Chiba's crest code (external_ids.fiba_livestats overwritten
to "ac" by the merge), and a name that a later run's CJK self-heal then renamed to "Altiri Chiba"
(having found that row by the now-wrong "ac" code). 117 games -- both clubs' whole slate -- point
at this one row.

This script:
  1. re-discovers the B1 schedule to learn, for every ScheduleKey, which side is really which code
     (the discovery pass itself has already been verified pairing-clean -- see bleague_test.py and
     the 2026-09-18 commit -- this repair does not re-derive that, it reads it once more here);
  2. restores the "at" row to Alvark Tokyo (name, external_ids.fiba_livestats, aliases);
  3. creates (or reuses) a proper "Altiri Chiba" row under code "ac";
  4. repoints every affected game's home_team_id / away_team_id to whichever of the two rows its
     own discovered code actually names.

Idempotent: a second run finds nothing left to repair (the "at" row's external_ids.fiba_livestats
is back to "at", so the query at the top of run() returns no games).

    python scripts/ingest/repair_bleague_at_ac.py --dry-run
    python scripts/ingest/repair_bleague_at_ac.py --worker-config

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config for %APPDATA%\\epinoia\\worker.json).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapters import get_adapter  # noqa: E402

LEAGUE_SLUG = "b-league-premier"
MERGED_SLUG = "at"          # the corrupted row's slug (Alvark Tokyo's original)
ALVARK_CODE = "at"
ALTIRI_CODE = "ac"
ALTIRI_NAME = "Altiri Chiba"
ALVARK_NAME = "Alvark Tokyo"


class _Sb:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def select(self, table: str, query: str):
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30)
        r.raise_for_status(); return r.json()

    def select_all(self, table: str, query: str, page: int = 1000):
        """select(), paginated past PostgREST's default 1000-row cap -- external_games alone
        holds well over that for bleague (two divisions, a season each), and an un-paginated read
        silently truncated at row 1000 the first time this ran, leaving 43 of 117 games unresolved
        for no reason the printed output explained."""
        out, offset = [], 0
        while True:
            h = {**self.h, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + page - 1}'}
            r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=h, timeout=30)
            r.raise_for_status()
            rows = r.json()
            out.extend(rows)
            if len(rows) < page:
                return out
            offset += page

    def patch(self, table: str, query: str, body: dict):
        r = requests.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, json=body, timeout=30)
        r.raise_for_status(); return r.json() if r.text else None

    def insert(self, table: str, body: dict):
        h = {**self.h, 'Prefer': 'return=representation'}
        r = requests.post(f"{self.url}/rest/v1/{table}", headers=h, json=body, timeout=30)
        r.raise_for_status(); return r.json()

    def free_slug(self, base: str) -> str:
        if not self.select('teams', f"slug=eq.{base}&select=id"):
            return base
        i = 2
        while self.select('teams', f"slug=eq.{base}-{i}&select=id"):
            i += 1
        return f"{base}-{i}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--worker-config', action='store_true', help=r'take the URL and key from %%APPDATA%%\epinoia\worker.json')
    a = ap.parse_args()

    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if a.worker_config:
        cfg = json.load(open(os.path.join(os.environ['APPDATA'], 'epinoia', 'worker.json')))
        url, key = cfg['supabase_url'], cfg['service_key']
    if not (url and key):
        print('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); return 2
    sb = _Sb(url, key)

    lg = sb.select('leagues', f"slug=eq.{LEAGUE_SLUG}&select=id")
    if not lg:
        print(f"no league '{LEAGUE_SLUG}' -- nothing to repair"); return 0
    league_id = lg[0]['id']

    merged = sb.select('teams', f"league_id=eq.{league_id}&slug=eq.{MERGED_SLUG}&select=id,name,external_ids,aliases")
    if not merged:
        print("no merged row found -- already repaired, or nothing to repair"); return 0
    merged = merged[0]
    if (merged.get('external_ids') or {}).get('fiba_livestats') != ALTIRI_CODE:
        print(f"'{MERGED_SLUG}' is not carrying '{ALTIRI_CODE}' -- already repaired, or a different problem"); return 0

    affected = sb.select('games', f"or=(home_team_id.eq.{merged['id']},away_team_id.eq.{merged['id']})&select=id,home_team_id,away_team_id")
    print(f"{len(affected)} game(s) reference the merged row")

    # order=id: Range pagination is only correct over a STABLE order -- without one, PostgREST is
    # free to return rows in a different order per request, and a row can fall through the gap
    # between two pages (which is exactly what left one game unresolved the first time this ran).
    ext_rows = sb.select_all('external_games', "adapter=eq.bleague&game_id=not.is.null&order=id&select=external_id,game_id,home_name,away_name")
    ext = {r['external_id']: r['game_id'] for r in ext_rows if r.get('game_id')}
    by_game_id = {v: k for k, v in ext.items()}
    # the FALLBACK for a fixture too far ahead for one discovery pass to reach (rare -- one out
    # of 117 games, a January fixture past this run's page window): external_games already
    # carries the names this same repair's EN_NAME resolved when the row was first written, so
    # the club is nameable without needing today's discovery to reach that same page again.
    names_by_id = {r['game_id']: (r.get('home_name') or '', r.get('away_name') or '') for r in ext_rows if r.get('game_id')}

    print("re-discovering the schedule to learn each game's real code...")
    adapter = get_adapter('bleague')
    games = list(adapter.discover('https://www.bleague.jp/schedule/?data_format=json&mon=all&tab=1',
                                   {'code': 'BLJ', 'tab': '1', 'events': ('2', '3')}))
    by_ext = {g.external_id: g for g in games}

    if not a.dry_run:
        sb.patch('teams', f"id=eq.{merged['id']}",
                 {'name': ALVARK_NAME, 'external_ids': {**(merged.get('external_ids') or {}), 'fiba_livestats': ALVARK_CODE},
                  'aliases': ['A東京']})
    print(f"  {MERGED_SLUG}: restored to {ALVARK_NAME!r} / code {ALVARK_CODE!r}")

    altiri = sb.select('teams', f"league_id=eq.{league_id}&external_ids->>fiba_livestats=eq.{ALTIRI_CODE}&select=id")
    if altiri and altiri[0]['id'] != merged['id']:
        altiri_id = altiri[0]['id']
        print(f"  {ALTIRI_NAME}: row already exists ({altiri_id})")
    else:
        slug = sb.free_slug('altiri-chiba')
        if a.dry_run:
            altiri_id = 'DRY-RUN-NEW-ID'
        else:
            row = sb.insert('teams', {'league_id': league_id, 'slug': slug, 'name': ALTIRI_NAME,
                                       'short_name': ALTIRI_NAME, 'external_ids': {'fiba_livestats': ALTIRI_CODE},
                                       'aliases': ['A千葉']})
            altiri_id = row[0]['id']
        print(f"  {ALTIRI_NAME}: created ({altiri_id}, slug {slug if not a.dry_run else '(dry run)'})")

    n_fixed = n_unresolved = 0
    for g in affected:
        gid = g['id']
        xid = by_game_id.get(gid)
        sg = by_ext.get(xid) if xid else None
        home_code = away_code = None
        if sg:
            home_code = (sg.extra.get('home_code') or '').lower()
            away_code = (sg.extra.get('away_code') or '').lower()
        else:
            hn, an = names_by_id.get(gid, ('', ''))
            home_code = ALTIRI_CODE if hn == ALTIRI_NAME else (ALVARK_CODE if hn == ALVARK_NAME else None)
            away_code = ALTIRI_CODE if an == ALTIRI_NAME else (ALVARK_CODE if an == ALVARK_NAME else None)
            if home_code or away_code:
                print(f"  (game {gid}: resolved from external_games' own recorded names, not today's discovery)")
        if not (home_code or away_code):
            n_unresolved += 1
            print(f"  ? game {gid}: no matching schedule entry (external id {xid}) -- left alone")
            continue
        patch = {}
        if g['home_team_id'] == merged['id'] and home_code == ALTIRI_CODE:
            patch['home_team_id'] = altiri_id
        if g['away_team_id'] == merged['id'] and away_code == ALTIRI_CODE:
            patch['away_team_id'] = altiri_id
        if patch:
            n_fixed += 1
            if not a.dry_run:
                sb.patch('games', f"id=eq.{gid}", patch)
    print(f"{n_fixed} game(s) {'would be ' if a.dry_run else ''}repointed to {ALTIRI_NAME}, "
          f"{len(affected) - n_fixed - n_unresolved} correctly stayed {ALVARK_NAME}, {n_unresolved} unresolved")
    return 0


if __name__ == '__main__':
    sys.exit(main())
