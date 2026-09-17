/* ============================================================================
   LEAGUES BY COUNTRY: THE FLAG, THE NAME AND THE ORDER HOME SHOWS THEM IN.

   epinoia/country.js is loaded as the real file (UMD, node's require) and run
   against synthetic league rows; nothing touches the network. Then HOME's
   wiring is read as text: the script order, the section id #leagues that
   /epinoia/countries/ lands on, and the leagues section's CSP manners.

     flags from either case · a globe for null, '', 'GBR', '12' · names from
     Intl, 'Not yet filed' for none, the code for a region Intl does not know ·
     groups by the name a reader sees (Germany before Great Britain's "United
     Kingdom", not by code) · 'gb' and 'GB' one group · the unfiled group last ·
     leagues by name inside a group · the input left unordered · HOME wiring

     node supabase/tests/country.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'epinoia', 'country.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const section = s => console.log('\n' + s);
const cps = s => [...s].map(ch => ch.codePointAt(0).toString(16)).join(' ');

const GLOBE = '\u{1F30D}';
const intl = (() => { try { return new Intl.DisplayNames(undefined, { type: 'region' }); } catch (_) { return null; } })();

section('flags');
ok('GB is the regional indicators G B', C.flagOf('GB') === '\u{1F1EC}\u{1F1E7}', cps(C.flagOf('GB')));
ok('lower case gives the same flag', C.flagOf('gb') === C.flagOf('GB'));
ok('surrounding spaces are trimmed', C.flagOf(' ie ') === '\u{1F1EE}\u{1F1EA}', cps(C.flagOf(' ie ')));
ok('DE', C.flagOf('DE') === '\u{1F1E9}\u{1F1EA}');
[null, undefined, '', 'G', 'GBR', '12', 'G1', {}].forEach(v =>
  ok('a globe for ' + JSON.stringify(v), C.flagOf(v) === GLOBE, cps(String(C.flagOf(v)))));

section('names');
ok('none is "Not yet filed"', C.countryName(null) === 'Not yet filed' && C.countryName('') === 'Not yet filed');
ok('not a code is "Not yet filed"', C.countryName('GBR') === 'Not yet filed');
if (intl) {
  ok('GB comes from Intl', C.countryName('GB') === intl.of('GB'), C.countryName('GB'));
  ok('lower case is the same country', C.countryName('gb') === C.countryName('GB'));
  ok('a code Intl does not know reads as the code (QQ)', C.countryName('qq') === 'QQ', C.countryName('qq'));
  ok('the reserved ZZ reads as the code, not "Unknown Region"', C.countryName('ZZ') === 'ZZ', C.countryName('ZZ'));
} else {
  ok('without Intl the code is the name', C.countryName('gb') === 'GB');
}

section('groups');
const L = (slug, name, country) => ({ id: slug, slug, name, country });
const rows = [
  L('slb-women', 'Super League Basketball Women', 'GB'),
  L('bbl-de', 'Basketball Bundesliga', 'DE'),
  L('test', 'Test League', null),
  L('bcb', 'British Championship Basketball', 'gb'),
  L('odd', 'Odd League', 'GBR'),
  L('slb-men', 'Super League Basketball Men', ' GB '),
  L('sbl', 'Super Basketball League', 'IE'),
  L('blank', 'Blank League', '')
];
const before = rows.map(r => r.slug).join(',');
const g = C.group(rows);
ok('input not reordered', rows.map(r => r.slug).join(',') === before);
ok('four groups (DE, GB, IE, unfiled)', g.length === 4, g.map(x => x.code).join(','));
const names = g.map(x => x.name);
if (intl) {
  const expect = ['DE', 'GB', 'IE'].sort((a, b) => intl.of(a).localeCompare(intl.of(b)));
  ok('named groups by the name a reader sees, not by code',
    g.slice(0, 3).map(x => x.code).join(',') === expect.join(','), g.map(x => x.code + '=' + x.name).join(' | '));
  ok('United Kingdom sorts after Ireland (by name, where GB would sort before IE by code)',
    intl.of('GB') !== 'United Kingdom' || names.indexOf('United Kingdom') > names.indexOf('Ireland'), names.join(' | '));
}
const last = g[g.length - 1];
ok('the unfiled group is last, code ""', last.code === '' && last.name === 'Not yet filed' && last.flag === GLOBE);
ok('unfiled holds null, "" and the malformed code', last.leagues.map(l => l.slug).sort().join(',') === 'blank,odd,test',
  last.leagues.map(l => l.slug).join(','));
const gb = g.find(x => x.code === 'GB');
ok('gb, GB and " GB " are one group of three', gb && gb.leagues.length === 3, gb && gb.leagues.map(l => l.slug).join(','));
ok('leagues by name inside a group', gb && gb.leagues.map(l => l.slug).join(',') === 'bcb,slb-men,slb-women',
  gb && gb.leagues.map(l => l.slug).join(','));
ok('each group carries its flag', gb && gb.flag === C.flagOf('GB'));
ok('group codes are upper case', g.every(x => x.code === '' || /^[A-Z]{2}$/.test(x.code)));

section('edges');
ok('no leagues, no groups', C.group([]).length === 0);
ok('not an array, no groups', C.group(null).length === 0 && C.group(undefined).length === 0);
ok('null rows are skipped', C.group([null, L('a', 'A', 'FR')]).length === 1);
const only = C.group([L('x', 'X', null)]);
ok('only unfiled leagues still make one group', only.length === 1 && only[0].code === '');
const tie = C.group([L('b', 'Same', 'FR'), L('a', 'Same', 'FR')]);
ok('same name ties break by slug', tie[0].leagues.map(l => l.slug).join(',') === 'a,b');

section('HOME wiring');
const html = rd('epinoia', 'home', 'index.html');
const js = rd('epinoia', 'home', 'leagues.js');
const css = rd('epinoia', 'home', 'leagues.css');
const pos = s => html.indexOf(s);
ok('section#leagues exists (the /countries/ landing anchor)', /<section[^>]*\bid="leagues"/.test(html));
ok('#homeLeagues mount inside it', pos('id="homeLeagues"') > pos('id="leagues"') && pos('id="leagues"') > 0);
ok('country.js before front.js', pos('src="../country.js') > 0 && pos('src="../country.js') < pos('src="front.js'));
ok('leagues.js after front.js', pos('src="front.js') > 0 && pos('src="leagues.js') > pos('src="front.js'));
ok('leagues.css linked', /href="leagues\.css\?v=\d+"/.test(html));
ok('leagues.js registers the leagues section', /register\('leagues'/.test(js));
ok('links to the league front page ../?l=', /base \+ '\?l=' \+ encodeURIComponent/.test(js));
ok('colours only from logo or manual', /colour_source === 'logo' \|\| l\.colour_source === 'manual'/.test(js));
ok('a failed logo falls back to the monogram by listener', /addEventListener\('error'/.test(js) && !/onerror/.test(js));
ok('no innerHTML (names are text)', !/innerHTML/.test(js));
ok('club counts from teams?select=league_id', /teams\?select=league_id/.test(js));
ok('next fixture from EpinoiaGlobalGames.nextFor', /G\.nextFor\(id\)/.test(js));
ok('leagues.css has a light-theme rule', /:root\[data-theme="light"\]/.test(css));
ok('leagues.css has a phone rule', /@media \(max-width:720px\)/.test(css));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
