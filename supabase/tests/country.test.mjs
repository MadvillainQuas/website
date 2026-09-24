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

section('regions (a user-assigned code, named and drawn by us)');
ok('XB is the Balkans, whatever Intl says', C.countryName('XB') === 'Balkans' && C.countryName(' xb ') === 'Balkans');
ok('XB is a map, not the letters X B', C.flagOf('XB') === '\u{1F5FA}\uFE0F', cps(C.flagOf('XB')));
ok('XB has its outline drawn', C.flagSrc('xb') === 'brand/flags/xb.svg');
ok('every region is in the drawn list', Object.keys(C.REGIONS).every(c => C.HAVE_FLAG.indexOf(c) >= 0));
ok('every region code is ISO user-assigned (XA-XZ)', Object.keys(C.REGIONS).every(c => /^X[A-Z]$/.test(c)));
ok('every drawn flag has its file', C.HAVE_FLAG.every(c => {
  try { return rd('epinoia', 'brand', 'flags', c.toLowerCase() + '.svg').startsWith('<svg'); } catch (_) { return false; }
}), C.HAVE_FLAG.join(','));
const copies = { 'nav.js': rd('epinoia', 'nav.js'), 'countries.js': rd('epinoia', 'countries', 'countries.js'),
  'appearance-ui.js': rd('epinoia', 'admin', 'appearance-ui.js') };
Object.keys(copies).forEach(f => ok(f + ' names XB the Balkans too', /XB: \{ name: 'Balkans'/.test(copies[f])));
ok('nav.js draws the XB outline', /HAVE_FLAG = \[[^\]]*'XB'/.test(copies['nav.js']));
ok('Balkans is translated (ja, es)', /'Balkans': /.test(rd('epinoia', 'i18n', 'ja.js')) && /'Balkans': /.test(rd('epinoia', 'i18n', 'es.js')));
ok('a region sorts among countries by its name',
  C.group([L0('a', 'A', 'XB'), L0('b', 'B', 'AU'), L0('c', 'C', 'CA')]).map(x => x.code).join(',') === 'AU,XB,CA');

section('groups');
function L0(slug, name, country) { return { id: slug, slug, name, country }; }
const L = L0;
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

section('a league in two countries (0160)');
ok('BE+NL is a country value, either case, spaces trimmed', C.norm(' be + nl ') === 'BE+NL' && C.norm('BE+NL') === 'BE+NL');
ok('...up to four, and one bad part makes it none', C.norm('FR+DE+IT+ES') === 'FR+DE+IT+ES' && C.norm('FR+DE+IT+ES+PT') === ''
   && C.norm('BE+') === '' && C.norm('BE+NLD') === '' && C.norm('BENL') === '');
ok('one code is exactly what it was', C.norm('gb') === 'GB' && C.codes('GB').join() === 'GB');
if (intl) {
  ok('the name is each country\'s, joined: Belgium + Netherlands',
    C.countryName('BE+NL') === intl.of('BE') + ' + ' + intl.of('NL'), C.countryName('BE+NL'));
}
const bp = C.parts('BE+NL');
ok('parts(): each country with its own flag and drawn picture, in the order given',
  bp.length === 2 && bp[0].code === 'BE' && bp[1].code === 'NL' && bp[0].flag === C.flagOf('BE')
  && bp[0].src === 'brand/flags/be.svg' && bp[1].src === 'brand/flags/nl.svg', bp);
ok('parts() of one country is one entry, of none is none', C.parts('GB').length === 1 && C.parts('').length === 0 && C.parts('GBR').length === 0);
ok('the emoji of two countries is both flags', C.flagOf('BE+NL') === C.flagOf('BE') + ' ' + C.flagOf('NL'));
ok('flagSrc() is for one country (a caller draws each part itself)', C.flagSrc('BE+NL') === '' && C.flagSrc('NL') === 'brand/flags/nl.svg');
const g2 = C.group([L('bnxt', 'BNXT League', 'BE+NL'), L('x', 'Belgian League', 'BE'), L('y', 'Dutch League', 'nl + be')]);
ok('BE+NL is a group of its own - one entry, not the league under two countries twice',
  g2.length === 3 && g2.some(x => x.code === 'BE+NL' && x.leagues.length === 1) && g2.some(x => x.code === 'BE'), g2.map(x => x.code));
ok('...and the order it was given is kept (NL+BE is not BE+NL)', g2.some(x => x.code === 'NL+BE'));
ok('every drawn flag is on disk', C.HAVE_FLAG.every(c => { try { rd('epinoia', 'brand', 'flags', c.toLowerCase() + '.svg'); return true; } catch (_) { return false; } }),
  C.HAVE_FLAG);
const nav = rd('epinoia', 'nav.js');
const navFlags = (/const HAVE_FLAG = \[([^\]]*)\]/.exec(nav) || [])[1] || '';
ok('the rail draws the same flags as country.js (it keeps its own list)',
  JSON.stringify(navFlags.match(/[A-Z]{2}/g)) === JSON.stringify(C.HAVE_FLAG), navFlags);
ok('the rail shows each flag beside its own name (countryLabel)', /function countryLabel\(code\)/.test(nav)
  && /row\.append\(\.\.\.countryLabel\(code\)\)/.test(nav) && /cname\.append\(\.\.\.countryLabel\(code\)\)/.test(nav));
ok('HOME does the same with country.js parts()', /C\.parts\(grp\.code\)/.test(rd('epinoia', 'home', 'leagues.js')));
const mig = rd('supabase', 'migrations', '0160_leagues_in_two_countries.sql');
ok('0160 lets the database hold it, and files the BNXT League under both',
  /country ~ '\^\[A-Z\]\{2\}\(\\\+\[A-Z\]\{2\}\)\{0,3\}\$'/.test(mig) && /set country = 'BE\+NL' where slug = 'bnxt-league'/.test(mig));
ok('...and a two-country league keeps its first country\'s clock for the fans\' vote', /split_part\(upper\(btrim/.test(mig));

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
