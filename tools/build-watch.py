"""Where to watch: the streaming spreadsheet -> the data block in epinoia/watch.js.

    python tools/build-watch.py ["D:\\Download\\European Basketball Leagues Streaming.xlsx"]

The sheet has one row per league: League, Country, Tier, Availability, Website (several links in one cell,
separated by spaces). Each row is matched to an EPINOIA league slug by SLUGS below; a row with no slug (a
league EPINOIA does not carry yet) is listed at the end and left out. Rewrites only what sits between
/* WATCH-DATA:BEGIN */ and /* WATCH-DATA:END */ in epinoia/watch.js. Run, then stamp-assets --bump.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'epinoia' / 'watch.js'
DEFAULT = r'D:\Download\European Basketball Leagues Streaming.xlsx'

# (sheet league name, sheet country) -> EPINOIA league slug(s)
SLUGS = {
    ('EuroLeague', 'Europe'): ['euroleague'],
    ('BKT EuroCup', 'Europe'): ['eurocup'],
    ('Liga ACB', 'Spain'): ['liga-endesa'],
    ('Lega Basket Serie A', 'Italy'): ['lega-basket-serie-a'],
    ('Betclic Élite', 'France'): ['lnb-elite'],
    ('LNB Pro B', 'France'): ['lnb-elite-2'],
    ('easycredit BBL', 'Germany'): ['bbl'],
    ('Pro A', 'Germany'): ['proa'],
    ('Pro B', 'Germany'): ['prob'],
    ('AdmiralBet ABA League', 'Subregional'): ['aba-league'],
    ('NLB ABA League 2', 'Subregional'): ['aba-league-2'],
    ('Betsafe-LKL', 'Lithuania'): ['lkl'],
    ('betFirst BNXT League', 'Belgium/Netherlands'): ['bnxt-league'],
    ('Orlen Basket Liga', 'Poland'): ['orlen-basket-liga'],
    ('National Basketball League', 'Czech Republic'): ['czech-nbl'],
    ('Latvian-Estonian Basketball League', 'Latvia/Estonia'): ['estonian-latvian-basketball-league'],
    ('Basketligaen', 'Denmark'): ['basketligaen'],
    ('Sesame NBL Bulgaria', 'Bulgaria'): ['nbl-bulgaria'],
    ('Korisliiga', 'Finland'): ['korisliiga'],
    ('LEB Oro', 'Spain'): ['primera-feb'],
    ('LEB Plata', 'Spain'): ['segunda-feb'],
    ('Svenska Basketligan', 'Sweden'): ['basketligan'],
    ('ProCredit Superliga', 'Kosovo'): ['kosovo-superliga'],
    ('Super League Basketball', 'United Kingdom'): ['slb-men'],
    ('National Basketball League', 'United Kingdom'): ['nbl-d1'],
    ('SB League', 'Switzerland'): ['sb-league'],
    ('Slovenská Basketbalová Liga', 'Slovakia'): ['slovak-sbl'],
    ('Elite League', 'Greece'): ['greek-elite-league'],
}

# a link's name, by its host (www. dropped); anything else shows its host
HOSTS = {
    'tv.euroleague.net': 'EuroLeague TV', 'dazn.com': 'DAZN', 'lbatv.com': 'LBA TV', 'lequipe.fr': "L'Équipe",
    'dynmedia.com': 'Dyn', 'polsatboxgo.pl': 'Polsat Box Go', 'tvcom.cz': 'TVCOM', 'm4sport.hu': 'M4 Sport',
    'lnk.lt': 'LNK', 'bnxt.tv': 'BNXT TV', 'ruutu.fi': 'Ruutu', 'sblplay.se': 'SBL Play', 'canalfeb.tv': 'Canal FEB',
    'fpbtv.pt': 'FPB TV', 'acb.com': 'ACB: where to watch, by country', 'sporteurope.tv': 'Sport Europe TV',
    'sportdeutschland.tv': 'Sportdeutschland.TV', 'basketligaen.dk': 'Jysk Fynske Medier',
    'lnppass.legapallacanestro.com': 'LNP Pass', 'lnb.tv': 'LNB TV', 'arenacloudtv.com': 'Arena Cloud TV',
    'basketballaustria.tv': 'Basketball Austria TV', 'cbftv.net': 'CBF TV', 'play.tv2.no': 'TV 2 Play',
    'tipos.sk': 'TIPOS TV', 'luxembourg.basketball': 'Luxembourg Basketball', 'estlatbl.com': 'Game centre',
    'vtb-league.com': 'VTB League',
}


def link_label(url):
    u = urlparse(url)
    host = (u.netloc or '').lower()
    host = host[4:] if host.startswith('www.') else host
    if host.endswith('youtube.com'):
        m = re.match(r'^/(?:@|c/|user/)([^/]+)', u.path)
        if m:
            return 'YouTube · ' + m.group(1)
        if 'playlist' in u.path:
            return 'YouTube playlist'
        return 'YouTube channel'
    for h, name in HOSTS.items():
        if host == h or host.endswith('.' + h):
            return name
    return host


def kind(avail):
    a = avail.lower()
    if a.startswith('free'):
        return 'free'
    if a.startswith('subscription'):
        return 'paid'
    return 'info'


def tidy(text):
    t = re.sub(r'\s+', ' ', str(text or '')).strip().rstrip(',').strip()
    t = t.replace('neccesary', 'necessary')
    return t


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    ws = openpyxl.load_workbook(src).active
    head = None
    data, missing = {}, []
    for row in ws.iter_rows():
        vals = {c.column_letter: c.value for c in row if c.value not in (None, '')}
        if not vals:
            continue
        if head is None:
            head = {str(v).strip(): k for k, v in vals.items()}
            continue
        name = tidy(vals.get(head['League']))
        country = tidy(vals.get(head['Country']))
        avail = tidy(vals.get(head['Availability']))
        site = str(vals.get(head['Website']) or '')
        slugs = SLUGS.get((name, country))
        if not slugs:
            missing.append(name + ' (' + country + ')')
            continue
        links = []
        for url in re.findall(r'(?:https?://)?[\w.-]+\.[a-z]{2,}(?:/[^\s()]*)?', site):
            if not url.startswith('http'):
                url = 'https://' + url
            links.append([link_label(url), url])
        for slug in slugs:
            data[slug] = {'n': name, 'k': kind(avail), 'a': avail, 'l': links}
    block = '{\n' + ',\n'.join(json.dumps(k, ensure_ascii=False) + ': ' + json.dumps(v, ensure_ascii=False)
                               for k, v in sorted(data.items())) + '\n}'
    js = TARGET.read_text(encoding='utf-8')
    a, b = '/* WATCH-DATA:BEGIN */', '/* WATCH-DATA:END */'
    i, j = js.index(a) + len(a), js.index(b)
    TARGET.write_text(js[:i] + '\n' + block + '\n' + js[j:], encoding='utf-8', newline='\n')
    print('watch.js: %d leagues' % len(data))
    if missing:
        print('not on EPINOIA (left out): ' + '; '.join(missing))


if __name__ == '__main__':
    main()
