"""Team colours, read from the crest.

A club's crest already says what colour the club is. This module opens the logo, counts the
colours of its opaque pixels, and picks the two strongest brand colours:

  * pixels are quantised to 16 levels a channel and the bins ranked by count; bins within a
    short colour distance of a bigger bin fold into it, so a soft gradient across one red does
    not split that red into three losers;
  * the PRIMARY is the most-seen CHROMATIC bin (saturated, neither near-black nor near-white),
    weighted a little by saturation so a small vivid mark beats a large slab of grey; a crest
    with no chromatic colour at all (black-and-white marks exist) takes its most-seen tone;
  * the SECONDARY is the next strong bin that is genuinely a different colour -- a different
    hue, or a different lightness for the achromatic ones -- with a chromatic one preferred.
    White and black qualify only when nothing chromatic is left: a red-and-white crest is
    red and white, but that white is not much of an identity on a dark page.

Writes teams.colour, teams.colour_2 and colour_source='logo'. Never touches a team whose
colour_source is 'manual': an admin who picked a colour meant it.

    python scripts/ingest/team_colours.py                 # every team with a crest (not manual)
    python scripts/ingest/team_colours.py --team slug     # one team
    python scripts/ingest/team_colours.py --dry-run       # report only
    python scripts/ingest/team_colours.py --force         # re-read teams already coloured from the logo

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or --worker-config for %APPDATA%\\epinoia\\worker.json).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys

import requests

DEFAULT = '#93f2bf'
MIN_SHARE = 0.03          # a colour under 3 % of the opaque pixels is an outline, not a brand colour
MERGE_DIST = 0.13         # bins closer than this (unit RGB cube) are the same colour


# ------------------------------------------------------------------ the picking ---
def _hsl(rgb):
    r, g, b = rgb
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2.0
    d = mx - mn
    s = 0.0 if d < 1e-6 else d / (1.0 - abs(2 * l - 1.0) + 1e-9)
    if d < 1e-6:
        h = 0.0
    elif mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60.0, min(1.0, s), l


def _dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def _hex(rgb):
    return '#%02x%02x%02x' % tuple(int(round(max(0.0, min(1.0, c)) * 255)) for c in rgb)


def palette(data: bytes) -> dict:
    """{'primary': '#rrggbb', 'secondary': '#rrggbb' | None, 'bins': [...]} from image bytes."""
    from PIL import Image
    import numpy as np
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    im.thumbnail((96, 96))
    arr = np.asarray(im).reshape(-1, 4).astype(np.float64) / 255.0
    px = arr[arr[:, 3] >= 0.8][:, :3]
    if len(px) < 20:
        return {'primary': None, 'secondary': None, 'bins': []}
    # a photo-style JPEG has no alpha: its white ground is not a colour of the crest
    if (px.min(axis=1) > 0.92).mean() > 0.35:
        px = px[px.min(axis=1) <= 0.92]
    total = len(px)
    q = np.floor(px * 15.999).astype(np.int32)
    keys = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    uniq, inv, counts = np.unique(keys, return_inverse=True, return_counts=True)
    sums = np.zeros((len(uniq), 3))
    np.add.at(sums, inv, px)
    bins = [{'rgb': tuple(sums[i] / counts[i]), 'n': int(counts[i])} for i in range(len(uniq))]
    bins.sort(key=lambda b: -b['n'])
    # fold near-identical bins into the bigger one -- measured against the bigger bin's SEED
    # colour, not its running mean, so a chain of neighbours cannot drift a navy into a black
    merged = []
    for b in bins:
        for m in merged:
            if _dist(m['seed'], b['rgb']) < MERGE_DIST:
                w = m['n'] + b['n']
                m['rgb'] = tuple((m['rgb'][k] * m['n'] + b['rgb'][k] * b['n']) / w for k in range(3))
                m['n'] = w
                break
        else:
            merged.append(dict(b, seed=b['rgb']))
    for m in merged:
        h, s, l = _hsl(m['rgb'])
        # chromatic: a colour, not a tone -- pale tints (l > .80) and near-blacks are tones
        m.update(h=h, s=s, l=l, share=m['n'] / total,
                 chromatic=(s >= 0.25 and 0.12 <= l <= 0.80),
                 hex=_hex(m['rgb']))
    merged = [m for m in merged if m['share'] >= MIN_SHARE] or merged[:2]
    # a colour's weight: its share, lifted by saturation; a tone's weight is its share alone,
    # so a big black beats a small pink for the second slot but a small red beats a big grey
    rank = lambda m: m['share'] * (0.6 + (m['s'] if m['chromatic'] else 0.0))   # noqa: E731
    chroma = sorted([m for m in merged if m['chromatic']], key=rank, reverse=True)
    primary = chroma[0] if chroma else max(merged, key=rank)

    def different(m):
        if m is primary:
            return False
        if m['chromatic'] and primary['chromatic']:
            dh = abs(m['h'] - primary['h']); dh = min(dh, 360 - dh)
            return dh >= 35 or abs(m['l'] - primary['l']) >= 0.30
        return abs(m['l'] - primary['l']) >= 0.30 or _dist(m['rgb'], primary['rgb']) >= 0.35
    # THE HIERARCHY: a colour that is present outranks black, white and grey in BOTH slots. A
    # crest is drawn in its colours on a ground of black or white; the ground is never the
    # identity, however much of the picture it covers. So the second slot goes to the strongest
    # DIFFERENT colour if there is one at all (orange-and-green Plymouth, not orange-and-black),
    # and only a crest with no second colour takes its dominant tone.
    others = [m for m in merged if different(m)]
    chroma_others = [m for m in others if m['chromatic']]
    second = max(chroma_others, key=rank) if chroma_others else (max(others, key=rank) if others else None)
    return {'primary': primary['hex'], 'secondary': second['hex'] if second else None,
            'bins': [{'hex': m['hex'], 'share': round(m['share'], 3), 'chromatic': m['chromatic']} for m in merged[:8]]}


# ------------------------------------------------------------------ the writing ---
def logo_url(path: str | None, supabase_url: str) -> str | None:
    """The same resolution as epinoia/config.js epinoiaLogoUrl: an https URL as is, a storage
    path through the media-public bucket, an early worker's JSON blob unwrapped."""
    if not path:
        return None
    p = str(path).strip()
    if p.startswith('{'):
        try:
            p = (json.loads(p) or {}).get('url') or ''
        except Exception:
            return None
    if not p:
        return None
    if p.lower().startswith('https://'):
        return p
    if p.lower().startswith('http://'):
        return None
    return supabase_url.rstrip('/') + '/storage/v1/object/public/media-public/' + '/'.join(
        requests.utils.quote(seg, safe='') for seg in p.split('/'))


def colour_team(sb, team: dict, dry: bool = False, log=print) -> dict | None:
    """Read one team's crest and write its colours. `sb` is run_ingest's Supabase helper (patch)."""
    url = logo_url(team.get('logo_path'), sb.url)
    if not url:
        return None
    try:
        r = requests.get(url, timeout=20, headers={'User-Agent': 'epinoia-ingest/1.0'})
        r.raise_for_status()
        pal = palette(r.content)
    except Exception as exc:
        log(f"   (colours: {team.get('slug')}: {exc})")
        return None
    if not pal['primary']:
        return None
    body = {'colour': pal['primary'], 'colour_2': pal['secondary'], 'colour_source': 'logo'}
    log(f"   {team.get('slug', team.get('id')):28s} {pal['primary']}  {pal['secondary'] or '—':8s}  "
        + ' '.join(f"{b['hex']}:{b['share']:.0%}" for b in pal['bins'][:4]))
    if not dry:
        sb.patch('teams', f"id=eq.{team['id']}", body)
    return body


def sweep(sb, force: bool = False, team: str | None = None, dry: bool = False, log=print) -> int:
    """Colour every team with a crest whose colour was not chosen by hand. Without --force a team
    already coloured from its logo is skipped (the crest has not changed); the ingest calls this
    with force=False after a crest sync, so a new crest -> colour_source back to 'default' -> read.
    Leagues get the same pass (sweep_leagues); the count returned is the teams'."""
    q = 'select=id,slug,logo_path,colour,colour_2,colour_source&logo_path=not.is.null&colour_source=neq.manual'
    if team:
        q += f"&slug=eq.{team}"
    elif not force:
        q += '&colour_source=eq.default'
    rows = sb.select('teams', q)
    n = 0
    for t in rows:
        if colour_team(sb, t, dry=dry, log=log):
            n += 1
    if not team:
        k = sweep_leagues(sb, force=force, dry=dry, log=log)
        if k:
            log(f"   {k} league(s) coloured from their logo")
    return n


# ------------------------------------------------------------------ leagues (0122) ---
GROUND = (0x04, 0x10, 0x0b)


def _derived(hex_: str) -> str:
    """teamcolour.js derived(): the second colour of a logo that had only one -- the same hue,
    clearly lighter or darker. leagues.colour_b cannot be empty, as teams.colour_2 can."""
    rgb = [int(hex_[i:i + 2], 16) for i in (1, 3, 5)]

    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    lum = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
    target, t = (GROUND, 0.55) if lum > 0.3 else ((255, 255, 255), 0.45)
    return '#%02x%02x%02x' % tuple(int(round(max(0, min(255, c + (g - c) * t)))) for c, g in zip(rgb, target))


def colour_league(sb, league: dict, dry: bool = False, log=print) -> dict | None:
    """Read one league's logo and write its colours. An SVG is left to the league admin console,
    which reads it in the browser on upload: Pillow cannot open a vector."""
    url = logo_url(league.get('logo_path'), sb.url)
    if not url:
        return None
    if url.lower().split('?')[0].endswith('.svg'):
        return None
    try:
        r = requests.get(url, timeout=20, headers={'User-Agent': 'epinoia-ingest/1.0'})
        r.raise_for_status()
        if 'svg' in (r.headers.get('content-type') or ''):
            return None
        pal = palette(r.content)
    except Exception as exc:
        log(f"   (league colours: {league.get('slug')}: {exc})")
        return None
    if not pal['primary']:
        return None
    body = {'colour_a': pal['primary'], 'colour_b': pal['secondary'] or _derived(pal['primary']),
            'colour_source': 'logo'}
    log(f"   league {league.get('slug', league.get('id')):21s} {body['colour_a']}  {body['colour_b']}")
    if not dry:
        sb.patch('leagues', f"id=eq.{league['id']}", body)
    return body


def sweep_leagues(sb, force: bool = False, league: str | None = None, dry: bool = False, log=print) -> int:
    """Colour every league with a logo whose colours were not chosen by hand -- by default only
    the ones nobody has read yet (colour_source 'default'). A database without 0122 has no
    colour_source column: the select fails and this reads nothing."""
    q = 'select=id,slug,logo_path,colour_a,colour_b,colour_source&logo_path=not.is.null&colour_source=neq.manual'
    if league:
        q += f"&slug=eq.{league}"
    elif not force:
        q += '&colour_source=eq.default'
    try:
        rows = sb.select('leagues', q)
    except Exception as exc:
        log(f"   (league colours: {str(exc)[:120]})")
        return 0
    return sum(1 for lg in rows if colour_league(sb, lg, dry=dry, log=log))


class _Sb:
    """A stand-alone client for the CLI (run_ingest brings its own)."""
    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

    def select(self, table, query):
        r = requests.get(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, timeout=30)
        r.raise_for_status(); return r.json()

    def patch(self, table, query, body):
        r = requests.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self.h, json=body, timeout=30)
        r.raise_for_status(); return r.json() if r.text else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--team', help='one team, by slug')
    ap.add_argument('--league', help='one league, by slug (its logo)')
    ap.add_argument('--force', action='store_true', help='re-read teams already coloured from the logo')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--worker-config', action='store_true', help=r'take the URL and key from %APPDATA%\epinoia\worker.json')
    ap.add_argument('--file', help='just print the palette of a local image')
    a = ap.parse_args()
    if a.file:
        print(json.dumps(palette(open(a.file, 'rb').read()), indent=1)); return 0
    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if a.worker_config:
        cfg = json.load(open(os.path.join(os.environ['APPDATA'], 'epinoia', 'worker.json')))
        url, key = cfg['supabase_url'], cfg['service_key']
    if not (url and key):
        print('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); return 2
    if a.league:
        k = sweep_leagues(_Sb(url, key), force=True, league=a.league, dry=a.dry_run)
        print(f"{k} league(s) {'would be ' if a.dry_run else ''}coloured")
        return 0
    n = sweep(_Sb(url, key), force=a.force or bool(a.team), team=a.team, dry=a.dry_run)
    print(f"{n} team(s) {'would be ' if a.dry_run else ''}coloured")
    return 0


if __name__ == '__main__':
    sys.exit(main())
