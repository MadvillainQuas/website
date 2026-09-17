/* ============================================================================
   A LEAGUE'S LOGO, AND THE COLOURS IT GIVES THE LEAGUE (0122).

   The chain has four links in three languages, and each one failing is quiet:

     0122_league_logo_colours.sql   a published or approved league logo becomes
                                    leagues.logo_path (approve_media never set it,
                                    so the sidebar never showed one); colours read
                                    from a logo reset when the logo changes; a read
                                    never replaces colours an admin picked
     admin/appearance-ui.js         upload -> publish at once -> read the logo's two
                                    colours in the browser -> set_league_colours
     teamcolour.js league()         the league's pages paint --league-* and
                                    body.league-themed only for colours somebody
                                    vouched for, or read the logo for the visit
     scripts/ingest/team_colours.py the worker reads what the console did not, with
                                    the same second-colour rule as the browser

     node supabase/tests/league-colours.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) + ' , wanted ' + JSON.stringify(want));

/* ---------------------------------------------------------------- the migration --- */
console.log('\n-- 0122: the logo is the league\'s, and its colours follow it');
const sql = read('supabase', 'migrations', '0122_league_logo_colours.sql')
  .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const fn = name => {
  const m = new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\nend; \\$\\$;').exec(sql);
  return m ? m[0] : '';
};
const approve = fn('approve_media'), remove = fn('remove_media'),
      publish = fn('publish_league_logo'), setc = fn('set_league_colours');
ok('approve_media makes an approved league logo the league\'s logo',
   /elsif m\.owner_type = 'league' and m\.kind = 'logo' then\s+update leagues set logo_path = m\.storage_path/.test(approve));
ok('...and keeps the under-18 consent check it always had',
   /pl\.is_minor and not pl\.photo_consent/.test(approve));
ok('remove_media clears the league\'s pointer as well as a club\'s',
   /p_owner_type = 'league' and \(p_kind is null or p_kind = 'logo'\) then\s+update leagues set logo_path = null/.test(remove));
ok('publish_league_logo publishes league logos only, for the league\'s admins',
   /m\.owner_type <> 'league' or m\.kind <> 'logo'/.test(publish) &&
   /public\.is_platform_admin\(\) or public\.is_league_admin\(m\.owner_id\)/.test(publish) &&
   /update leagues set logo_path = m\.storage_path where id = m\.owner_id/.test(publish));
ok('...and hands back the replaced files for the caller to delete',
   /'orphans', to_jsonb\(orphans\)/.test(publish));
ok('set_league_colours is for the league\'s admins and only takes hex',
   /public\.is_league_admin\(p_league\)/.test(setc) && /public\.is_css_colour\(p_colour_a\)/.test(setc));
ok('...and a read of the logo never replaces colours somebody picked unless asked',
   /p_source = 'logo' and l\.colour_source = 'manual' and not coalesce\(p_force, false\)[\s\S]{0,40}return 'kept'/.test(setc));
ok('a new logo sends colours read from the old one back to default',
   /new\.colour_source = 'logo'\s+and coalesce\(new\.logo_path, ''\) is distinct from coalesce\(old\.logo_path, ''\)[\s\S]{0,40}new\.colour_source := 'default'/.test(sql) &&
   /before update of logo_path on public\.leagues/.test(sql));
ok('only default, logo and manual are colour sources', /check \(colour_source in \('default', 'logo', 'manual'\)\)/.test(sql));
ok('the new functions are not callable signed out',
   /revoke all on function public\.publish_league_logo\(uuid\) from public, anon/.test(sql) &&
   /revoke all on function public\.set_league_colours\(uuid, text, text, text, boolean\) from public, anon/.test(sql));

/* ------------------------------------------------------------ teamcolour.js league() --- */
console.log('\n-- the league\'s pages paint themselves');
function page(opts = {}) {
  const vars = {}, classes = new Set(), images = [];
  const ctx = {
    console,
    document: {
      documentElement: { style: { setProperty: (k, v) => { vars[k] = v; } },
                         getAttribute: k => (k === 'data-theme' ? (opts.light ? 'light' : null) : null) },
      body: { classList: { add: c => classes.add(c), contains: c => classes.has(c) } },
      querySelector: () => null,
      createElement: () => ({ getContext: () => null })
    },
    Image: function () { images.push(this); Object.defineProperty(this, 'src', {
      set: v => { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); }, get: () => this._src }); },
    setTimeout
  };
  ctx.window = ctx;
  ctx.epinoiaLogoUrl = p => 'https://cdn.test/media-public/' + p;
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'teamcolour.js'), ctx);
  return { TC: ctx.EpinoiaTeamColour, vars, classes, images };
}

{
  const p = page();
  const r = await p.TC.league({ colour_source: 'logo', colour_a: '#c8102e', colour_b: '#ffffff' });
  ok('colours read from the logo paint at once', r === true && p.classes.has('league-themed'));
  ok('...as the six league variables', ['--league-a', '--league-b', '--league-a-ink', '--league-b-ink', '--league-on-a', '--league-on-b']
     .every(k => /^#[0-9a-f]{6}$/.test(p.vars[k] || '')), JSON.stringify(p.vars));
  eq('...and the kit\'s accent becomes the league\'s ink', p.vars['--lume'], p.vars['--league-a-ink']);
  ok('...which reads on the dark ground', p.TC.contrast(p.vars['--league-a-ink'], '#04100b') >= 4.5, p.vars['--league-a-ink']);
}
{
  const p = page({ light: true });
  await p.TC.league({ colour_source: 'manual', colour_a: '#ffd700', colour_b: '#000080' });
  ok('on the light theme a gold league\'s ink is darkened until it reads', p.TC.contrast(p.vars['--league-a-ink'], '#f3faf6') >= 4.5, p.vars['--league-a-ink']);
}
{
  const p = page();
  await p.TC.league({ colour_source: 'manual', colour_a: '#123456', colour_b: '#abcdef' }, { keepAccent: true });
  ok('a league that picked its own accent keeps it', p.classes.has('league-themed') && !('--lume' in p.vars));
}
{
  const p = page();
  const r = await p.TC.league({ colour_source: 'manual', colour_a: '#93f2bf', colour_b: '#8ff5ff' });
  ok('the platform\'s mint is not a league colour: nothing is themed', r === false && !p.classes.has('league-themed'));
}
{
  const p = page();
  const r = await p.TC.league({ colour_source: 'default', colour_a: '#c8102e', colour_b: '#ffffff', logo_path: null });
  ok('colours nobody vouched for, and no logo to read, theme nothing', r === false && !p.classes.has('league-themed'));
}
{
  const p = page();
  const r = await p.TC.league({ colour_source: 'default', colour_a: '#93f2bf', logo_path: 'league/abc/logo-1.svg' });
  ok('a logo not read yet is read for the visit', p.images.length === 1 && p.images[0]._src === 'https://cdn.test/media-public/league/abc/logo-1.svg', JSON.stringify(p.images.map(i => i._src)));
  ok('...and a logo that cannot be read leaves the page as it was', r === false && !p.classes.has('league-themed'));
}
{
  const p = page();
  await p.TC.league({ colour_source: 'manual', colour_a: '#123456', colour_b: '#abcdef', logo_path: 'league/abc/logo-1.png' });
  ok('picked colours are used without reading the logo', p.images.length === 0 && p.classes.has('league-themed'));
}

/* ------------------------------------------------------------------- the pages --- */
console.log('\n-- where the theme is applied');
const home = read('epinoia', 'home.js'), league = read('epinoia', 'l', 'league.js');
const hub = read('epinoia', 'l', 'index.html'), front = read('epinoia', 'index.html');
const navcss = read('epinoia', 'kit', 'nav.css'), kit = read('epinoia', 'kit', 'epinoia-kit.css');
ok('the front page reads the whole league row, so a database without 0122 still finds the league',
   /leagues\?slug=eq\.' \+ encodeURIComponent\(WANT\) \+ '&select=\*&limit=1'/.test(home));
ok('the front page themes itself before the chosen slots, keeping a chosen accent',
   /EpinoiaTeamColour\.league\(LEAGUE, \{ keepAccent: !!\(LEAGUE\.theme && LEAGUE\.theme\.accent\) \}\);\s+\}\s+applyTheme\(LEAGUE\.theme\)/.test(home));
ok('the league hub themes itself too', /EpinoiaTeamColour\.league\(league,/.test(league));
ok('...and loads the colour module before its own script',
   hub.indexOf('teamcolour.js') > 0 && hub.indexOf('teamcolour.js') < hub.indexOf('league.js?'));
ok('the league logo joins the NAME\'s row, never the hero, so the fixture strip keeps its full width',
   /<div class="hero-head"><div class="wordmark/.test(front) && /\.hero-head\.has-logo\{display:flex/.test(front) &&
   !/\.hero\.has-logo/.test(front));
ok('...sized in the name\'s own units, and above the name on a phone',
   /\.lg-logo\{height:1\.72em/.test(front) && /@media \(max-width:560px\)\{\s*\.hero-head\.has-logo\{flex-direction:column/.test(front));
ok('a logo on a white square loses only the white joined to its edge, and only when its corners are white',
   /img\.crossOrigin = 'anonymous'/.test(home) && /corners\.every\(pale\)/.test(home) &&
   /addEventListener\('load', \(\) => dropFlatGround\(img\), \{ once: true \}\)/.test(home));
ok('match news cards carry no second-colour stripe down their edges',
   !/mt-half::before/.test(read('epinoia', 'kit', 'news.css')));
ok('both pages trim their heading in the league\'s colours',
   /body\.league-themed \.hero::after/.test(front) && /body\.league-themed \.ep-board::after/.test(hub));
ok('the rail wears them only under body.league-themed', /body\.league-themed \.ep-nav::after\{/.test(navcss) &&
   /body\.league-themed \.ep-nav a\.item\.on/.test(navcss));
ok('...on ::after, never the drawer\'s grab handle (::before)', !/body\.league-themed \.ep-nav[^{]*::before/.test(navcss));
ok('the kit turns the selected tab into the league\'s colour on both themes',
   /:root\[data-theme="light"\] body\.league-themed \.ep-tab\.on\{ background:var\(--league-a\); color:var\(--league-on-a\) \}/.test(kit));

/* ------------------------------------------------------------ the admin console --- */
console.log('\n-- the league admin console');
const app = read('epinoia', 'admin', 'appearance-ui.js'), adminHtml = read('epinoia', 'admin', 'index.html');
ok('an upload goes to the public bucket and is published at once',
   /bucket: 'media-public' \}\);[\s\S]{0,200}rpc\('publish_league_logo', \{ p_media: up\.id \}\)/.test(app));
ok('...then its colours are read and saved, never over hand-picked ones',
   /await readLogoColours\(up\.storage_path, false\)/.test(app) &&
   /rpc\('set_league_colours', \{[\s\S]{0,120}p_source: 'logo', p_force: !!force \}\)/.test(app));
ok('a database without 0122 still takes a logo, through the approval queue',
   /missingFn\(probe\.error\)[\s\S]{0,300}kind: 'logo' \}\);/.test(app));
ok('colours can be picked, re-read from the logo, or cleared',
   /saveColours\('manual', lcA\.value, lcB\.value\)/.test(app) && /readLogoColours\(lgRowData\.logo_path, true\)/.test(app) &&
   /saveColours\('default', null, null\)/.test(app));
ok('the console loads the colour module', adminHtml.indexOf('teamcolour.js') > 0 &&
   adminHtml.indexOf('teamcolour.js') < adminHtml.indexOf('appearance-ui.js'));

/* ------------------------------------------------------------------ the worker --- */
console.log('\n-- the ingest reads what the console did not');
const HARNESS = String.raw`
import sys, json, types
try:
    import requests
except ImportError:
    m = types.ModuleType('requests'); m.utils = types.SimpleNamespace(quote=lambda s, safe='': s); sys.modules['requests'] = m
sys.path.insert(0, sys.argv[1])
import team_colours as T
out = {'derived': {h: T._derived(h) for h in ['#c8102e', '#ffd700', '#000080', '#ffffff', '#04100b']}}
class SB:
    url = 'https://x.supabase.co'
    def __init__(self, rows=None, boom=False): self.rows, self.boom, self.patched = rows or [], boom, []
    def select(self, table, q):
        if self.boom: raise RuntimeError('400 column leagues.colour_source does not exist')
        out.setdefault('queries', []).append([table, q]); return self.rows
    def patch(self, table, q, body): self.patched.append([table, q, body])
logs = []
out['no_column'] = T.sweep_leagues(SB(boom=True), log=logs.append)
out['no_column_log'] = logs[-1] if logs else ''
sb = SB(rows=[{'id': 'L1', 'slug': 'slb-women', 'logo_path': 'league/L1/logo-a.svg', 'colour_source': 'default'}])
out['svg'] = T.sweep_leagues(sb, log=logs.append)
out['svg_patched'] = sb.patched
sys.stdout.write('@@' + json.dumps(out))
`;
let got = null;
for (const exe of ['python3', 'python']) {
  const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'ingest')],
                      { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  if (r.status === 0 && r.stdout.includes('@@')) { got = JSON.parse(r.stdout.split('@@').pop()); break; }
  if (r.stderr && /Traceback/.test(r.stderr)) { ok('team_colours.py runs', false, r.stderr.slice(-800)); break; }
}
if (got) {
  const p = page();
  const js = Object.fromEntries(Object.keys(got.derived).map(h => [h, p.TC.derived(h)]));
  eq('the worker and the browser derive the same second colour', got.derived, js);
  ok('a database without 0122 reads no league, and says why', got.no_column === 0 && /league colours/.test(got.no_column_log), got.no_column_log);
  eq('the worker only reads logos nobody has, and never a picked one', (got.queries || [])[0],
     ['leagues', 'select=id,slug,logo_path,colour_a,colour_b,colour_source&logo_path=not.is.null&colour_source=neq.manual&colour_source=eq.default']);
  ok('an SVG logo is left to the browser, which can read it', got.svg === 0 && got.svg_patched.length === 0);
} else if (!fail) ok('a python to run team_colours.py with', false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
