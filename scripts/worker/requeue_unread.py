#!/usr/bin/env python3
"""
requeue_unread.py — put a game back in the reader's queue when the reading missed
the top of a period.

WHY THE TOP OF A PERIOD MATTERS MORE THAN THE REST. Plays are placed in the footage from
the clock readings around them (epinoia/video.js). Between two readings the placement is
interpolated and good; past the last reading in either direction it is PROJECTED, and a
projection is only as good as its rate. So the stretch of a period that was played before
the reader first locked on is the one part of a game where every play is a guess.

Measured 2026-09-18 on e3d1193e (Loughborough Riders v Hemel Storm): the reader's first
first-quarter reading was at 7:12, so 2 minutes 48 of that quarter were never read, and a
play 48 seconds of clock before the first run landed 27 seconds late even after the
projection was taught the period's real rate. The reading is the fix, not the arithmetic.

WHAT IT LOOKS AT. For every game with a primary video, the largest clock value read in each
period. A period is "unread at the top" by (period length - that value). Games whose job is
still queued or running are left alone: they are about to be read anyway.

    python scripts/worker/requeue_unread.py --dry-run --worker-config
    python scripts/worker/requeue_unread.py --worker-config           # queue them
    python scripts/worker/requeue_unread.py --worker-config --game <uuid>
    python scripts/worker/requeue_unread.py --worker-config --miss 60 # only worse than 60s

The worker has to be running to pick these up (scripts/worker/ai_worker.bat).

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config for %APPDATA%\\epinoia\\worker.json).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import requests

MISS_MS = 20000          # a period top unread by more than this is worth reading again
BUSY = ('queued', 'claimed', 'running')


class _Sb:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def select(self, table: str, query: str):
        r = requests.get(f'{self.url}/rest/v1/{table}?{query}', headers=self.h, timeout=60)
        r.raise_for_status(); return r.json()

    def insert(self, table: str, row: dict):
        h = {**self.h, 'Prefer': 'return=representation'}
        r = requests.post(f'{self.url}/rest/v1/{table}', headers=h, json=row, timeout=60)
        r.raise_for_status(); return r.json()


def unread_tops(track: dict) -> dict:
    """{period: ms of that period played before the first reading}"""
    out = {}
    if not track:
        return out
    byp = {}
    for s in (track.get('samples') or []):
        if s.get('period') is None or s.get('clock_ms') is None:
            continue
        p = s['period']
        if p not in byp or s['clock_ms'] > byp[p]:
            byp[p] = s['clock_ms']
    for p, top in byp.items():
        full = 600000 if p <= 4 else 300000
        out[p] = max(0, full - top)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--game', help='one game id')
    ap.add_argument('--miss', type=float, default=MISS_MS / 1000.0,
                    help='seconds of an unread period top that make a game worth reading again')
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

    q = 'select=game_id,url,is_primary,clock_track&is_primary=is.true'
    if a.game:
        q += f'&game_id=eq.{a.game}'
    videos = sb.select('game_videos', q)
    jobs = sb.select('video_jobs', 'select=game_id,status,requested_at&order=requested_at.desc&limit=500')
    latest = {}
    for j in jobs:
        latest.setdefault(j['game_id'], j['status'])

    queued = skipped = 0
    for v in videos:
        gid = v['game_id']
        state = latest.get(gid, 'never queued')
        tops = unread_tops(v.get('clock_track') or {})
        worst = max(tops.values()) if tops else None
        detail = ', '.join(f'Q{p} {ms/1000:.0f}s' for p, ms in sorted(tops.items()) if ms > a.miss * 1000)

        if state in BUSY:
            print(f'  {gid[:8]}  {state} already — left alone')
            skipped += 1
            continue
        # never read at all, or read but missing the top of a period
        needs = (worst is None) or (worst > a.miss * 1000) or not (v.get('clock_track') or {}).get('samples')
        if not needs:
            print(f'  {gid[:8]}  read to the top of every period — left alone')
            skipped += 1
            continue
        print(f'  {gid[:8]}  {state}, unread: {detail or "no readings at all"}  -> queue')
        queued += 1
        if not a.dry_run:
            sb.insert('video_jobs', {'game_id': gid, 'video_url': v['url'], 'kind': 'clock_track',
                                     'mode_requested': 'auto', 'requested_via': 'worker'})

    print(f'\n{queued} game(s) {"would be " if a.dry_run else ""}queued, {skipped} left alone')
    if queued and not a.dry_run:
        print('the worker has to be running to pick them up: scripts/worker/ai_worker.bat')
    return 0


if __name__ == '__main__':
    sys.exit(main())
