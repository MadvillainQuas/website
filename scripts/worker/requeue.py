#!/usr/bin/env python3
"""requeue.py — read games again, and replace what the reader stored for them last time.

A game's plays are placed in its footage from the clock readings around them (epinoia/video.js).
Between two readings the placement is interpolated and good; past the last one in either
direction it is PROJECTED, and a projection is only as good as its rate. So the stretch of a
period played before the reader first locked on is the one part of a game where every play is a
guess -- and reading a game again, with a reader that has since been improved, replaces the
guesses with readings. Nothing else has to be undone: the worker overwrites game_videos.clock_track
for the game it reads, so a new reading IS the replacement.

    python requeue.py --worker-config --dry-run            # the games whose period tops are unread
    python requeue.py --worker-config                      # queue them
    python requeue.py --worker-config --all                # every game with a video
    python requeue.py --worker-config --all --except 6df0308f    # ...beside that one
    python requeue.py --worker-config --game <uuid>        # just this one
    python requeue.py --worker-config --all --miss 60      # only tops unread by over a minute

WHAT IT GUARANTEES. The queue ends up holding exactly one job for each game it chose and none
for a game named with --except. It never stacks a second job on a game already waiting, it
clears out jobs a dead worker left marked 'running', and it leaves a genuinely running read
alone. So it is safe to run twice, or while the worker is working.

The worker has to be running to pick these up (scripts/worker/ai_worker.bat), or press
"Start worker" in the dashboard, which also has this same list behind "Re-read games…".

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config for %%APPDATA%%\\epinoia\\worker.json).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import ai_worker as W                     # for the held-back list, kept in the worker's config
except Exception:                             # standalone, with only the two env vars
    W = None

MISS_MS = 20000          # a period top unread by more than this is worth reading again
PENDING = ('queued', 'claimed', 'running')
STALE_MIN = 30           # a claimed job whose worker has not spoken in this long is dead


class _Sb:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def select(self, table: str, query: str):
        r = requests.get(f'{self.url}/rest/v1/{table}?{query}', headers=self.h, timeout=120)
        r.raise_for_status(); return r.json()

    def insert(self, table: str, row: dict):
        h = {**self.h, 'Prefer': 'return=minimal'}
        r = requests.post(f'{self.url}/rest/v1/{table}', headers=h, json=row, timeout=60)
        r.raise_for_status()

    def patch(self, table: str, query: str, row: dict):
        r = requests.patch(f'{self.url}/rest/v1/{table}?{query}', headers=self.h, json=row, timeout=60)
        r.raise_for_status()


def unread_tops(track: dict) -> dict:
    """{period: ms of that period played before the first reading it holds}."""
    out, top = {}, {}
    for s in ((track or {}).get('samples') or []):
        p, ms = s.get('period'), s.get('clock_ms')
        if p is None or ms is None:
            continue
        if p not in top or ms > top[p]:
            top[p] = ms
    for p, v in top.items():
        out[p] = max(0, (600000 if p <= 4 else 300000) - v)
    return out


def _stale(job) -> bool:
    if job['status'] == 'queued':
        return False
    hb = job.get('heartbeat_at') or job.get('claimed_at')
    if not hb:
        return True
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(hb.replace('Z', '+00:00'))).total_seconds()
    except Exception:
        return True
    return age > STALE_MIN * 60


def main() -> int:
    ap = argparse.ArgumentParser(description='read games again and replace what was stored for them')
    ap.add_argument('--game', help='one game id (or the first 8 characters of one)')
    ap.add_argument('--all', action='store_true',
                    help='every game with a video, not only the ones whose period tops are unread')
    ap.add_argument('--except', dest='excl', action='append', default=[], metavar='ID',
                    help='hold this game back: cancel anything pending for it and stop the '
                         'worker offering it again by itself; repeatable')
    ap.add_argument('--release', action='append', default=[], metavar='ID',
                    help='stop holding a game back, so it can be read again; repeatable')
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

    # THE HELD-BACK LIST, FIRST. Cancelling a job is not the same as saying no: the worker's
    # hourly sweep offers back every game an older worker read, so a cancel alone lasts an hour.
    # --except writes the game into the worker's never_read list as well, and that is what sticks.
    held = list(W.load_config(W.CONFIG_PATH).get('never_read') or []) if W else []
    if (a.excl or a.release) and not W:
        print('cannot hold a game back from here: the worker config is not readable'); return 2
    for g in a.release:
        if not a.dry_run:
            held = W.set_held(g, False)
        print(f'  release {g[:8]}  the worker may offer it again')
    for g in a.excl:
        if not a.dry_run:
            held = W.set_held(g, True)
        elif not any(g.startswith(x) or x.startswith(g) for x in held):
            held = held + [g]
        print(f'  hold    {g[:8]}  the worker will not offer it again')

    q = 'select=game_id,url,clock_track&is_primary=is.true'
    if a.game:
        q += f'&game_id=like.{a.game}*'
    videos = [v for v in sb.select('game_videos', q) if v.get('url')]
    if not videos:
        print('no game with a video matched'); return 1
    jobs = sb.select('video_jobs', 'select=id,game_id,status,heartbeat_at,claimed_at,requested_at'
                                   '&order=requested_at.desc&limit=1000')
    pending = {}
    for j in jobs:
        if j['status'] in PENDING:
            pending.setdefault(j['game_id'], []).append(j)

    chosen, left, cancels = [], [], []
    for v in videos:
        gid = v['game_id']
        tops = unread_tops(v.get('clock_track') or {})
        worst = max(tops.values()) if tops else None
        detail = ', '.join(f'Q{p} {ms/1000:.0f}s' for p, ms in sorted(tops.items()) if ms > a.miss * 1000)
        state = detail or ('never read' if worst is None else 'read to the top of every period')

        if any(gid.startswith(x) for x in held if x):
            cancels += [(j, 'held back') for j in pending.get(gid, [])]
            left.append((gid, state, 'held back')); continue
        if not (a.all or a.game or worst is None or worst > a.miss * 1000):
            left.append((gid, state, 'nothing to replace')); continue

        alive = []
        for j in pending.get(gid, []):
            if _stale(j):
                cancels.append((j, f'no worker has touched it in {STALE_MIN} min'))
            else:
                alive.append(j)
        for j in alive[1:]:
            cancels.append((j, 'a second job on the same game'))
        if alive:
            left.append((gid, state, f'already {alive[0]["status"]}')); continue
        chosen.append((v, state))

    for gid, state, why in left:
        print(f'  -       {gid[:8]}  {state:44s} {why}')
    for j, why in cancels:
        print(f'  cancel  {j["game_id"][:8]}  {j["status"]:44s} {why}')
    for v, state in chosen:
        print(f'  READ    {v["game_id"][:8]}  {state}')

    print(f'\n{len(chosen)} game(s) to read again, {len(cancels)} job(s) cancelled, '
          f'{len(left)} left alone{"   (dry run)" if a.dry_run else ""}')
    if a.dry_run:
        return 0

    for j, _ in cancels:
        if j['status'] == 'queued' or _stale(j):
            sb.patch('video_jobs', f'id=eq.{j["id"]}',
                     {'status': 'cancelled', 'finished_at': datetime.now(timezone.utc).isoformat()})
        else:
            sb.patch('video_jobs', f'id=eq.{j["id"]}', {'cancel_requested': True})
    for v, _ in chosen:
        sb.insert('video_jobs', {'game_id': v['game_id'], 'video_url': v['url'], 'kind': 'clock_track',
                                 'mode_requested': 'auto', 'requested_via': 'worker'})

    after = sb.select('video_jobs', 'select=game_id&status=eq.queued&limit=1000')
    print(f'the queue now holds {len(after)} job(s) over {len({x["game_id"] for x in after})} game(s)')
    if chosen:
        print('the worker has to be running to pick them up: scripts/worker/ai_worker.bat')
    return 0


if __name__ == '__main__':
    sys.exit(main())
