/* ============================================================================
   A GENIUS LEAGUE'S SEASON, BEFORE ITS FIRST GAME.

   Super League Basketball (men: client SLB, women: client WBBL) is the first
   league fed from a client that hosts nothing else, and it breaks four quiet
   assumptions the worker made from BCB:

     * its phases carry no league word ('Championship 26-27', 'Betty Codona Cup
       2026-27') and the men's name the season short, so the season's
       competitions were never picked and the bare page was polled instead -
       which on 17 Sep 2026 was still LAST season's Championship
     * a competition page lists only the current round (4 of 173 fixtures)
       unless roundNumber=-1 is asked for
     * its hosted schedule gives no club codes, so crests never arrived and a
       slug stood in for the code; the live-stats PREVIEW page of an upcoming
       game has them (scripts/ingest/sync_clubs.py)
     * clubs repeat across leagues: London Lions field a men's and a women's
       side under the same code (LON) and the same name, and Oaklands Wolves
       play in BCB and SLB Women. teams.slug is unique platform-wide, and a
       player's feed key "<code>:<slot>" was looked up platform-wide - so the
       second club could not be made, and a women's game could land on a men's
       player.

     node supabase/tests/clubs.test.mjs
   ============================================================================ */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) + ' , wanted ' + JSON.stringify(want));

const HARNESS = String.raw`
import sys, json, types
try:
    import requests
except ImportError:
    sys.modules['requests'] = types.ModuleType('requests')   # a bare CI python; nothing here fetches
sys.path.insert(0, sys.argv[1])
import run_ingest as RI
import sync_clubs as S
import feedplatform as FP
F = sys.argv[2]
read = lambda n: open(F + '/' + n, encoding='utf-8').read()
out = {}

# ---- seasons in phase names
names = ['BCB 2026-2027', 'BCB Trophy 2027', 'BCB Trophy 2025-2026', 'Hoopsfix Pro Am 2026',
         'British Championship Basketball 2025-2026', 'Championship 26-27', 'Championship 2025-26',
         'Cup 2024-25', 'Betty Codona Cup 2026-27', 'WBBL Championship 2018-19', 'All-Stars 2024']
out['season'] = {n: RI.season_match(n, '2026-27') for n in names}

# ---- whole-season URLs
out['urls'] = [RI.whole_season_url(u) for u in [
    'https://hosted.wh.geniussports.com/SLB/en/competition/49597/schedule',
    'https://hosted.wh.geniussports.com/SLB/en/competition/49597/schedule?phaseName=Regular%20season&',
    'https://hosted.wh.geniussports.com/SLB/en/competition/49597/schedule?poolNumber=-1&roundNumber=-1&']]

# ---- expansion, with the competition pickers as Genius served them on 17 Sep 2026
PICKERS = {
  'SLB': [('49597', 'Championship 26-27'), ('39625', 'Championship 2024-25'), ('41897', 'Championship 2025-26'),
          ('49599', 'Cup 26-27'), ('47714', 'Cup 2025-26'), ('48758', 'Play-offs 2025-26'), ('42212', 'Trophy 2025-26')],
  'WBBL': [('38098', 'All-Stars 2024'), ('49543', 'Betty Codona Cup 2026-27'), ('41771', 'Betty Codona Trophy 2025-26'),
           ('41751', 'Championship 2025-26'), ('49542', 'Championship 2026-27'), ('48730', 'Play-offs 2025-26')],
  'HBBC': [('49733', 'BCB 2026-2027'), ('48841', 'BCB Exhibition Games 2025-2026'), ('49735', 'BCB Exhibition Games 2026-2027'),
           ('42431', 'BCB Trophy 2025-2026'), ('49734', 'BCB Trophy 2027'), ('47295', 'British Championship Basketball 2025-2026'),
           ('49062', 'Hoopsfix Pro Am 2026'), ('49069', 'Hoopsfix Pro Am Women 2026')],
  'OLD': [('41897', 'Championship 2025-26')],
}
class Adapter:
    last_competitions = []
    def discover(self, url, config):
        client = url.split('/')[3]
        self.last_competitions = [{'id': i, 'name': n, 'url': f'https://hosted.wh.geniussports.com/{client}/en/competition/{i}/schedule'}
                                  for i, n in PICKERS[client]]
        return iter(())
RI.get_adapter = lambda name: Adapter()
RI.season_name_for = lambda now=None: '2026-27'
def src(code, client, **ac):
    return {'code': code, 'label': code, 'adapter': 'fiba_livestats', 'schedule_url': f'https://hosted.wh.geniussports.com/{client}/en/schedule',
            'adapter_config': dict(ac, code=code)}
exp = RI.expand_competition_sources([
    src('SLB', 'SLB', client_is_league=True), src('SLBW', 'WBBL', client_is_league=True),
    {**src('BCB', 'HBBC'), 'league_name': 'British Championship Basketball'},
    src('STALE', 'OLD', client_is_league=True), src('NOFLAG', 'SLB')])
out['expanded'] = [[s['code'], s.get('competition_label'), s.get('competition_kind'), s['schedule_url'].split('/en/')[1]] for s in exp]

# ---- the hosted schedule and the preview page
fx = S.fixture_teams(read('slb-schedule.html'))
out['fixtures'] = fx
pv = S.parse_preview(read('slb-preview.html'))
out['preview'] = pv
out['preview_of_played'] = S.parse_preview('<span id ="aj_1_shortName"></span><span id ="aj_2_shortName"></span>')
names_ = {r[s]['team_id']: r[s]['name'] for r in fx.values() for s in ('home', 'away')}
asked = []
def fetch(url):
    asked.append(url)
    return read('slb-preview.html') if '/2882425/' in url else ''
out['idents'] = {t: (v['code'], v['name']) for t, v in S.club_idents(fx, names_, 'SLB', fetch=fetch).items()}
out['asked'] = asked
swapped = read('slb-preview.html').replace('Bristol Flyers<span>', 'London Lions<span>')
out['idents_swapped'] = S.club_idents(fx, names_, 'SLB', fetch=lambda u: swapped if '/2882425/' in u else '')

# ---- the platform, over a fake database
class SB:
    def __init__(self, tables): self.t, self.patches = tables, []
    def select(self, table, q):
        rows = self.t.get(table, [])
        if table == 'teams' and 'slug=eq.' in q:
            s = q.split('slug=eq.')[1].split('&')[0]; return [r for r in rows if r['slug'] == s]
        if table == 'teams' and 'external_ids->>fiba_livestats=eq.' in q:
            lid = q.split('league_id=eq.')[1].split('&')[0]; c = q.split('fiba_livestats=eq.')[1].split('&')[0]
            return [r for r in rows if r['league_id'] == lid and r['external_ids'].get('fiba_livestats') == c]
        if table == 'teams' and 'league_id=eq.' in q:
            lid = q.split('league_id=eq.')[1].split('&')[0]; return [r for r in rows if r['league_id'] == lid]
        if table == 'teams' and 'id=eq.' in q:
            i = q.split('id=eq.')[1].split('&')[0]; return [r for r in rows if r['id'] == i]
        if table == 'leagues':
            i = q.split('id=eq.')[1].split('&')[0]; return [r for r in rows if r['id'] == i]
        if table == 'players':
            c = q.split('fiba_livestats=eq.')[1].split('&')[0]; return [r for r in rows if r['external_ids'].get('fiba_livestats') == c]
        if table == 'roster_entries' and 'player_id=in.' in q:
            ids = q.split('player_id=in.(')[1].split(')')[0].split(',')
            team = {r['id']: r for r in self.t['teams']}
            return [{**e, 'teams': {'league_id': team[e['team_id']]['league_id']}} for e in rows if e['player_id'] in ids]
        return []
    def patch(self, table, q, body): self.patches.append([table, q, body])

teams = [{'id': 'men-lon', 'league_id': 'L-men', 'slug': 'london-lions', 'name': 'London Lions', 'aliases': [], 'external_ids': {'fiba_livestats': 'LON'}, 'logo_path': None},
         {'id': 'bcb-oak', 'league_id': 'L-bcb', 'slug': 'oaklands-wolves', 'name': 'Oaklands Wolves', 'aliases': [], 'external_ids': {'fiba_livestats': 'OAK'}, 'logo_path': None},
         {'id': 'w-bri', 'league_id': 'L-w', 'slug': 'bristol', 'name': 'Bristol Flyers', 'aliases': [], 'external_ids': {'fiba_livestats': 'BRI', 'other': 'x'}, 'logo_path': None},
         {'id': 'w-lon', 'league_id': 'L-w', 'slug': 'london-lions-slb-women', 'name': 'London Lions', 'aliases': [], 'external_ids': {'fiba_livestats': 'LON'}, 'logo_path': None}]
db = SB({'teams': teams, 'leagues': [{'id': 'L-w', 'slug': 'slb-women'}]})
P = FP.Platform(db, auto_create=False, log=lambda m: None)
out['slug_free'] = P.free_team_slug('L-w', 'newcastle-eagles')
out['slug_taken'] = P.free_team_slug('L-w', 'oaklands-wolves')
db.t['teams'].append({'id': 'x', 'league_id': 'L-w', 'slug': 'oaklands-wolves-slb-women', 'name': 'x', 'external_ids': {}})
out['slug_taken_twice'] = P.free_team_slug('L-w', 'oaklands-wolves')
db.t['teams'].pop()

# a fixture with no code finds the club by name and leaves its real code alone; a real code is written beside other keys
P.team('L-w', {'name': 'Bristol Flyers', 'code': ''})
out['patch_without_code'] = list(db.patches)
db.t['teams'][2]['external_ids'] = {'fiba_livestats': 'bristol-flyers', 'other': 'x'}
P2 = FP.Platform(db, auto_create=False, log=lambda m: None)
P2.team('L-w', {'name': 'Bristol Flyers', 'code': 'BRI'})
out['patch_with_code'] = db.patches[-1] if db.patches else None

# LON:4 is two people: a men's Lion and a women's Lion
db.t['players'] = [{'id': 'p-men', 'slug': 'a', 'first_name': 'Men', 'last_name': 'Lion', 'external_ids': {'fiba_livestats': 'LON:4'}},
                   {'id': 'p-w', 'slug': 'b', 'first_name': 'Women', 'last_name': 'Lion', 'external_ids': {'fiba_livestats': 'LON:4'}},
                   {'id': 'p-moved', 'slug': 'c', 'first_name': 'Moved', 'last_name': 'Club', 'external_ids': {'fiba_livestats': 'OAK:9'}}]
db.t['roster_entries'] = [{'player_id': 'p-men', 'team_id': 'men-lon'}, {'player_id': 'p-w', 'team_id': 'w-lon'},
                          {'player_id': 'p-moved', 'team_id': 'bcb-oak'}]
P3 = FP.Platform(db, auto_create=False, log=lambda m: None)
out['key_women'] = (P3.by_feed_key(teams[3], 'LON:4') or {}).get('id')
out['key_men'] = (P3.by_feed_key(teams[0], 'LON:4') or {}).get('id')
db.t['teams'].append({'id': 'w-oak', 'league_id': 'L-w', 'slug': 'oaklands-wolves-slb-women', 'name': 'Oaklands Wolves', 'external_ids': {'fiba_livestats': 'OAK'}})
out['key_other_league'] = P3.by_feed_key(db.t['teams'][-1], 'OAK:9')
sys.stdout.write('@@' + json.dumps(out))
`;

let got = null;
for (const exe of ['python3', 'python']) {
  const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'ingest'), path.join(ROOT, 'supabase', 'tests', 'fixtures', 'clubs')],
                      { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  if (r.status === 0 && r.stdout.includes('@@')) { got = JSON.parse(r.stdout.split('@@').pop()); break; }
  if (r.stderr && /Traceback/.test(r.stderr)) { ok('the ingest modules run', false, r.stderr.slice(-1500)); break; }
}
if (!got) { if (!fail) ok('a python to run the ingest modules with', false); }
else {
  console.log('\n-- which phase names are this season (2026-27)');
  eq('BCB keeps its league, trophy and one-year Pro Am, and drops last season', [
    got.season['BCB 2026-2027'], got.season['BCB Trophy 2027'], got.season['Hoopsfix Pro Am 2026'],
    got.season['BCB Trophy 2025-2026'], got.season['British Championship Basketball 2025-2026']], [true, true, true, false, false]);
  eq('SLB\'s short season names count, in both directions', [
    got.season['Championship 26-27'], got.season['Championship 2025-26'], got.season['Cup 2024-25']], [true, false, false]);
  eq('SLB Women: this season in, an old WBBL year and an all-star game out', [
    got.season['Betty Codona Cup 2026-27'], got.season['WBBL Championship 2018-19'], got.season['All-Stars 2024']], [true, false, false]);

  console.log('\n-- the whole season, not the current round');
  eq('roundNumber=-1 is added once, however the URL ends', got.urls, [
    'https://hosted.wh.geniussports.com/SLB/en/competition/49597/schedule?roundNumber=-1&',
    'https://hosted.wh.geniussports.com/SLB/en/competition/49597/schedule?phaseName=Regular%20season&roundNumber=-1&',
    'https://hosted.wh.geniussports.com/SLB/en/competition/49597/schedule?poolNumber=-1&roundNumber=-1&']);

  console.log('\n-- one source per competition of the season');
  const by = (code) => got.expanded.filter(e => e[0] === code).map(e => e.slice(1));
  eq('SLB: the Championship and the Cup of 26-27, whole-season pages', by('SLB'), [
    ['Championship 26-27', 'league', 'competition/49597/schedule?roundNumber=-1&'],
    ['Cup 26-27', 'cup', 'competition/49599/schedule?roundNumber=-1&']]);
  eq('SLB Women: the Betty Codona Cup and the Championship, no all-star game', by('SLBW'), [
    ['Betty Codona Cup 2026-27', 'cup', 'competition/49543/schedule?roundNumber=-1&'],
    ['Championship 2026-27', 'league', 'competition/49542/schedule?roundNumber=-1&']]);
  eq('BCB is picked exactly as before (only its URLs gain roundNumber)', by('BCB'), [
    ['BCB 2026-2027', 'league', 'competition/49733/schedule?roundNumber=-1&'],
    ['BCB Trophy 2027', 'trophy', 'competition/49734/schedule?roundNumber=-1&']]);
  eq('a whole-client league with nothing this season is skipped, never polled from its bare page', by('STALE'), []);
  eq('...while without the flag the old fallback to the bare page stands', by('NOFLAG'), [[null, null, 'schedule']]);

  console.log('\n-- clubs from the preview page');
  eq('the hosted schedule gives each fixture\'s clubs by hosted team id', got.fixtures['2882425'],
     { status: 'scheduled', home: { team_id: '178237', name: 'Bristol Flyers' }, away: { team_id: '178242', name: 'London Lions' } });
  eq('the preview page gives both feed codes, home first', [got.preview['1'].code, got.preview['2'].code, got.preview['1'].name, got.preview['2'].name],
     ['BRI', 'LON', 'Bristol Flyers', 'London Lions']);
  ok('...with their crests', /^https:\/\/images\.statsengine\.playbyplay\.api\.geniussports\.com\/.+T1\.png$/.test(got.preview['1'].logo || '') &&
     got.preview['1'].logo !== got.preview['2'].logo, JSON.stringify(got.preview));
  eq('...and the competition it belongs to', got.preview.competition, 'Championship 26-27');
  eq('a played game\'s page (codes filled in by script) gives nothing', got.preview_of_played, null);
  eq('each club is keyed by its code', got.idents, { '178237': ['BRI', 'Bristol Flyers'], '178242': ['LON', 'London Lions'] });
  ok('...reading the live-stats page of each upcoming game until every club is known',
     got.asked.length === 2 && got.asked[0] === 'https://fibalivestats.dcd.shared.geniussports.com/u/SLB/2882425/', JSON.stringify(got.asked));
  eq('a preview whose names disagree with the schedule is not trusted', got.idents_swapped, {});

  console.log('\n-- clubs and players that share names and codes across leagues');
  eq('a free slug is used as it is', got.slug_free, 'newcastle-eagles');
  eq('a slug another league\'s club holds gets the league\'s slug', got.slug_taken, 'oaklands-wolves-slb-women');
  eq('...and a number if that is taken too', got.slug_taken_twice, 'oaklands-wolves-slb-women-2');
  eq('a fixture with no code never overwrites a club\'s real code', got.patch_without_code, []);
  eq('a real code replaces a stand-in, keeping the club\'s other ids', got.patch_with_code,
     ['teams', 'id=eq.w-bri', { external_ids: { fiba_livestats: 'BRI', other: 'x' } }]);
  eq('LON:4 in a women\'s game is the women\'s Lion', got.key_women, 'p-w');
  eq('...and in a men\'s game the men\'s', got.key_men, 'p-men');
  eq('a key held only by a player in another league is nobody here', got.key_other_league, null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
