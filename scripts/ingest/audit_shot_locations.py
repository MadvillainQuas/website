#!/usr/bin/env python3
"""audit_shot_locations.py — does every adapter's log carry WHERE the shot was taken from?

Rim, mid-range and three are places, not labels. The page and the season exports both measure
"at the rim" as the restricted area around the ring, which needs a coordinate on every shot;
without one a league falls back to the shot's subType, and a feed whose statisticians type
"jumpshot" for nearly everything (LNB names 90 of 95 that way, layups included) then reports a
rim rate of three attempts a game. So the question worth asking of each adapter is not "does it
have a shot chart" but "what share of its shots arrive with a marker".

Reads what is already stored -- no source is fetched -- and reports, per competition:

    shots     the p2/p3 events in the log
    located   how many of them have a loc satellite
    at rim    of those, how many fall inside the restricted area (125 cm of the ring)
    types     the subTypes the feed actually distinguishes, which is what a shot with no
              marker has to fall back on

    python scripts/ingest/audit_shot_locations.py --worker-config
    python scripts/ingest/audit_shot_locations.py --worker-config --code LNBE2 --games 5

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import Counter

import requests

# the chart the markers are plotted on: half of 28 x 15 m in centimetres, ring at (750, 157.5)
CHART_W, CHART_H, RIM_X, RIM_Y, RA_R = 1500.0, 1400.0, 750.0, 157.5, 125.0


def at_rim(x, y) -> bool:
    dx = (float(x) - RIM_X / CHART_W) * CHART_W
    dy = (float(y) - RIM_Y / CHART_H) * CHART_H
    return math.hypot(dx, dy) <= RA_R


def main() -> int:
    ap = argparse.ArgumentParser(description='what share of each league\'s shots arrive with a marker')
    ap.add_argument('--code', help='one competition code (LNBE2, CBFFE, ACB, ...)')
    ap.add_argument('--games', type=int, default=3, help='games to sample per competition')
    ap.add_argument('--worker-config', action='store_true',
                    help=r'take the URL and key from %%APPDATA%%\epinoia\worker.json')
    a = ap.parse_args()

    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if a.worker_config:
        cfg = json.load(open(os.path.join(os.environ['APPDATA'], 'epinoia', 'worker.json')))
        url, key = cfg['supabase_url'], cfg['service_key']
    if not (url and key):
        print('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); return 2
    base, hdr = url.rstrip('/') + '/rest/v1/', {'apikey': key, 'Authorization': f'Bearer {key}'}

    def get(q):
        r = requests.get(base + q, headers=hdr, timeout=120)
        r.raise_for_status(); return r.json()

    # played games only: a fixture that has not tipped off has no log to measure
    q = ('external_games?select=adapter,competition_code,game_id,tipoff_at'
         '&game_id=not.is.null&external_status=eq.final&order=tipoff_at.desc&limit=3000')
    if a.code:
        q += f'&competition_code=eq.{a.code}'
    rows = get(q)
    by_comp: dict = {}
    for r in rows:
        by_comp.setdefault((r['adapter'], r['competition_code']), []).append(r['game_id'])

    print(f'{"adapter":<20}{"code":<10}{"games":>6}{"shots":>8}{"located":>10}{"at rim":>9}   shot types the feed distinguishes')
    print('-' * 116)
    worst = []
    for (adapter, code), gids in sorted(by_comp.items()):
        shots = located = rim = 0
        types: Counter = Counter()
        seen = 0
        for gid in gids[:a.games]:
            ev = get(f'game_events?select=t,payload&game_id=eq.{gid}&limit=4000')
            if not ev:
                continue
            seen += 1
            refs = {e['payload']['ref']: e['payload'] for e in ev
                    if e['t'] == 'loc' and isinstance(e.get('payload'), dict) and 'ref' in e['payload']}
            for e in ev:
                if e['t'] in ('p2_made', 'p2_miss', 'p3_made', 'p3_miss'):
                    shots += 1
                if e['t'] == 'stype' and isinstance(e.get('payload'), dict):
                    types[e['payload'].get('v')] += 1
            for l in refs.values():
                located += 1
                if at_rim(l.get('x', 9), l.get('y', 9)):
                    rim += 1
        if not shots:
            continue
        pct = 100.0 * located / shots
        shot_types = ', '.join(f'{k} {v}' for k, v in types.most_common(4) if k)
        print(f'{adapter:<20}{code:<10}{seen:>6}{shots:>8}{located:>7} {pct:>3.0f}%{rim:>9}   {shot_types[:52]}')
        if pct < 80:
            worst.append((code, pct, shot_types))

    print()
    if worst:
        print('LEAGUES WHOSE SHOTS MOSTLY ARRIVE WITHOUT A MARKER -- their rim split rests on the')
        print('subType alone, so it is only as good as the names in the column on the right:')
        for code, pct, ty in worst:
            print(f'  {code}: {pct:.0f}% located · {ty or "no shot types at all"}')
    else:
        print('every league sampled locates its shots')
    return 0


if __name__ == '__main__':
    sys.exit(main())
