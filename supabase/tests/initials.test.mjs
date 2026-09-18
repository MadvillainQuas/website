/* ============================================================================
   A CLUB'S INITIALS (epinoia/initials.js, migration 0129, the club portal).

     1. the letters: unique in a league, readable, and the same whatever order the clubs arrive in
     2. the three real leagues on the platform, as they were on 2026-09-17: no league repeats a code
     3. the browser side: one fetch for every league a page shows, asked again without the column
        before 0129, remembered for the session, and written into the cards that asked
     4. wired in: the fixture card, HOME and the games page, fxc.css on a phone, the portal field,
        and the migration's shape

     node supabase/tests/initials.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), 'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

const I = require(path.join(ROOT, 'epinoia', 'initials.js'));
const codes = (teams) => { const m = I.assign(teams); return Object.fromEntries(teams.map(t => [t.name, m.get(t.id)])); };
let n = 0;
const club = (name, extra) => Object.assign({ id: 'id-' + (++n), name }, extra || {});

/* ------------------------------------------------------------------ 1 --- */
console.log('\n-- the letters');
eq('two words: the first three letters', codes([club('Nottingham Hoods')]), { 'Nottingham Hoods': 'NOT' });
eq('three words: the first letter of each', codes([club('Milton Keynes Breakers')]), { 'Milton Keynes Breakers': 'MKB' });
eq('words that name the kind of club are not the club ("Manchester Basketball")', codes([club('Manchester Basketball')]), { 'Manchester Basketball': 'MAN' });
eq('an age group is not a word of the name', codes([club('Leeds Force U18')]), { 'Leeds Force U18': 'LEE' });
eq('accents fold ("Élan Óbuda")', I.words('Élan Óbuda'), ['ELAN', 'OBUDA']);
eq('two clubs that make the same code: neither gets it', codes([club('London Lions'), club('London Cavaliers')]),
   { 'London Lions': 'LLI', 'London Cavaliers': 'LCA' });
eq('three London clubs: all three step past LON', codes([club('London Lions'), club('London Cavaliers'), club('London City Royals')]),
   { 'London Lions': 'LLI', 'London Cavaliers': 'LCA', 'London City Royals': 'LCR' });
eq('a code a club carries (a short name that reads as the name) keeps it; the other club makes one around it',
   codes([club('London Lions', { short_name: 'LON' }), club('London Cavaliers', { short_name: 'Cavaliers' })]),
   { 'London Lions': 'LON', 'London Cavaliers': 'LCA' });
eq('a feed\'s code that reads as the name counts (external_ids)', codes([club('Leicester Riders', { external_ids: { fiba_livestats: 'LEI' } })]),
   { 'Leicester Riders': 'LEI' });
ok('...one that does not read as the name is ignored: NHB (Nottingham Hoods), CBR (Birmingham Rockets)',
   !I.readsAs('NHB', { name: 'Nottingham Hoods' }) && !I.readsAs('CBR', { name: 'Birmingham Rockets' }) &&
   I.readsAs('MKB', { name: 'Milton Keynes Breakers' }) && I.readsAs('CMA', { name: 'Cardiff Met Archers' }));
eq('...so those clubs make theirs from the name', codes([club('Nottingham Hoods', { external_ids: { fiba_livestats: 'NHB' } }), club('Birmingham Rockets', { short_name: 'CBR' })]),
   { 'Nottingham Hoods': 'NOT', 'Birmingham Rockets': 'BIR' });
eq('the club\'s own choice wins, and nobody else is given it', codes([club('Nottingham Hoods', { initials: 'HOO' }), club('Hoops Oldham', {})]),
   { 'Nottingham Hoods': 'HOO', 'Hoops Oldham': 'HOL' });
eq('a choice outside 2-4 capitals or digits is ignored', codes([club('Nottingham Hoods', { initials: 'nottingham' })]), { 'Nottingham Hoods': 'NOT' });
{
  const many = Array.from({ length: 30 }, (_, i) => club('Al ' + 'X'.repeat(i + 1)));
  const m = I.assign(many);
  const vs = [...m.values()];
  ok('thirty near-identical names: every one gets a code, all different', vs.length === 30 && new Set(vs).size === 30 && vs.every(v => /^[A-Z0-9]{2,4}$/.test(v)), vs.join(' '));
}
{
  const league = [club('London Lions'), club('London Cavaliers'), club('Leicester Riders'), club('Leeds Force'), club('Newcastle Eagles'), club('Newcastle Knights')];
  const a = I.assign(league), b = I.assign(league.slice().reverse());
  ok('the answer does not depend on the order the clubs arrive in', league.every(t => a.get(t.id) === b.get(t.id)), JSON.stringify([...a]));
  const before = I.assign(league);
  const after = I.assign(league.concat(club('Sheffield Sharks')));
  ok('a new club that collides with nobody changes nobody else\'s code', league.every(t => before.get(t.id) === after.get(t.id)));
}
eq('no name at all: no code, and nothing throws', [...I.assign([{ id: 'x' }]).entries()].length <= 1, true);

/* ------------------------------------------------------------------ 2 --- */
console.log('\n-- the platform\'s leagues (a snapshot of teams, 2026-09-17)');
{
  const snap = JSON.parse(rd('supabase', 'tests', 'fixtures', 'initials-teams.json'));
  const by = {};
  snap.forEach(t => (by[t.league_id] = by[t.league_id] || []).push(t));
  Object.entries(by).forEach(([lg, ts]) => {
    const m = I.assign(ts);
    const vs = ts.map(t => m.get(t.id));
    ok('league ' + lg.slice(0, 8) + ': ' + ts.length + ' clubs, ' + ts.length + ' different codes', new Set(vs).size === ts.length && vs.every(Boolean), vs.join(' '));
  });
  const bcb = by['3d9ab0f1-83bb-4f11-9e7c-f310968e7f37'];
  const m = I.assign(bcb);
  const name = nm => m.get(bcb.find(t => t.name === nm).id);
  eq('British Championship: readable codes, not the feed\'s basketball B', [name('Nottingham Hoods'), name('Birmingham Rockets'), name('Reading Rockets'), name('Milton Keynes Breakers'), name('London Cavaliers')],
     ['NOT', 'BIR', 'REA', 'MKB', 'LON']);
  const slb = by['3f4858ce-a146-4acc-aa36-53af617d3fdb'];
  const s = I.assign(slb);
  eq('Super League: its own codes (LEI, LON, NEW, CHE)', ['Leicester Riders', 'London Lions', 'Newcastle Eagles', 'Cheshire Phoenix'].map(nm => s.get(slb.find(t => t.name === nm).id)),
     ['LEI', 'LON', 'NEW', 'CHE']);
}

/* ------------------------------------------------------------------ 3 --- */
console.log('\n-- the browser side');
class Store { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
{
  delete require.cache[require.resolve(path.join(ROOT, 'epinoia', 'initials.js'))];
  const J = require(path.join(ROOT, 'epinoia', 'initials.js'));
  const LG = '3d9ab0f1-83bb-4f11-9e7c-f310968e7f37', LG2 = '3f4858ce-a146-4acc-aa36-53af617d3fdb';
  const calls = [];
  const rows = [
    { id: 'a1', league_id: LG, name: 'London Cavaliers', short_name: 'Cavaliers', external_ids: {} },
    { id: 'a2', league_id: LG, name: 'Nottingham Hoods', short_name: 'Hoods', external_ids: {} },
    { id: 'b1', league_id: LG2, name: 'London Lions', short_name: 'LON', external_ids: {} }
  ];
  const fetch = async (url) => {
    calls.push(url);
    if (/initials/.test(url)) return { ok: false, status: 400, json: async () => ({ message: 'column teams.initials does not exist' }) };
    return { ok: true, status: 200, json: async () => rows };
  };
  const store = new Store();
  await J.load([LG, LG2, 'not-a-uuid'], { fetch, store, config: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' } });
  ok('one request for every league at once, and before 0129 one more without the column', calls.length === 2 &&
     /select=id,league_id,name,short_name,initials,external_ids&league_id=in\.\(3d9ab0f1-83bb-4f11-9e7c-f310968e7f37,3f4858ce-a146-4acc-aa36-53af617d3fdb\)$/.test(calls[0]) &&
     !/initials/.test(calls[1]), calls.join('\n'));
  eq('each league worked out on its own: LON in one league does not bar LON in the other', [J.code('a1'), J.code({ id: 'a2' }), J.code('b1')], ['LON', 'NOT', 'LON']);
  ok('remembered for the session', /"a1":"LON"/.test(store.getItem('epinoia_initials_v1') || ''));
  await J.load([LG], { fetch, store, config: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' } });
  ok('a league already loaded is not asked for again', calls.length === 2);
  eq('an unknown club: no code', J.code('zzz'), '');

  /* fill: the nodes that asked */
  const node = id => ({ attrs: { 'data-initials-team': id }, textContent: 'Cavaliers', cls: new Set(),
    getAttribute(k) { return this.attrs[k]; }, classList: { add(c) { node.last = c; } } });
  const n1 = node('a1'), n2 = node('nope');
  const scope = { querySelectorAll: sel => (sel === '[data-initials-team]' ? [n1, n2] : []) };
  eq('fill writes the code into the cards that asked, and leaves the rest', [J.fill(scope), n1.textContent, n2.textContent], [1, 'LON', 'Cavaliers']);
}
{
  delete require.cache[require.resolve(path.join(ROOT, 'epinoia', 'initials.js'))];
  const J = require(path.join(ROOT, 'epinoia', 'initials.js'));
  const store = new Store();
  store.setItem('epinoia_initials_v1', JSON.stringify({ at: Date.now(), leagues: { '3d9ab0f1-83bb-4f11-9e7c-f310968e7f37': { a1: 'LCA' } } }));
  let asked = 0;
  await J.load(['3d9ab0f1-83bb-4f11-9e7c-f310968e7f37'], { fetch: async () => { asked++; return { ok: true, json: async () => [] }; }, store,
    config: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' } });
  ok('a fresh stored answer is used without a request', asked === 0 && J.code('a1') === 'LCA');
}
{
  delete require.cache[require.resolve(path.join(ROOT, 'epinoia', 'initials.js'))];
  const J = require(path.join(ROOT, 'epinoia', 'initials.js'));
  let threw = false;
  try { await J.load(['3d9ab0f1-83bb-4f11-9e7c-f310968e7f37'], { fetch: async () => ({ ok: false, status: 500 }), store: new Store(), config: { supabaseUrl: 'https://x', supabaseAnonKey: 'k' } }); }
  catch (_) { threw = true; }
  ok('a failed request leaves no codes and throws nothing', !threw && J.code('a1') === '');
}

/* ------------------------------------------------------------------ 4 --- */
console.log('\n-- wired in');
{
  const gg = rd('epinoia', 'globalgames.js');
  ok('the fixture card marks its short name with the club id, asks for the league, and uses a code once known',
     /short\.setAttribute\('data-initials-team', team\.id\)/.test(gg) && /I\.want\(lg\.id\)/.test(gg) && /\(I && team && I\.code\(team\)\) \|\| shortName\(team, name\)/.test(gg));
  ok('...and keeps the full name as the name\'s title', /nm\.title = name;/.test(gg));
  for (const page of [['home', 'index.html'], ['games', 'index.html'], ['app', 'index.html']]) {
    const html = rd('epinoia', ...page);
    ok(page[0] + '/ loads initials.js' + (page[0] === 'app' ? ' before app.js' : ' before globalgames.js'),
       /<script src="\.\.\/initials\.js\?v=\d+" defer><\/script>/.test(html) &&
       html.indexOf('initials.js') < html.indexOf(page[0] === 'app' ? 'app.js?v' : 'globalgames.js'));
  }
  const fxc = rd('epinoia', 'kit', 'fxc.css');
  /* THE LETTERS ARE THE DEFAULT NOW. The card puts the two clubs side by side, so half a card
     is all a name has and the letters are what fits; the full name comes back on a card wide
     enough for two of them. That is a property of the CARD's width, not the phone's, so it is
     a container query — which is why this is no longer a max-width rule about the rail. */
  ok('fxc.css: the club\'s letters are what a card shows until it is wide enough for the names',
     /\.fxc-nm \.full\{display:none\}\s*\.fxc-nm \.short\{display:inline\}/.test(fxc) &&
     /@container \(min-width:\d+px\)\{\s*\.fxc-nm \.full\{display:inline\}\s*\.fxc-nm \.short\{display:none\}/.test(fxc));
  const app = rd('epinoia', 'app', 'app.js'), appHtml = rd('epinoia', 'app', 'index.html');
  ok('the club portal has the field, its save and its help', /id="clubInitials"/.test(appHtml) && /id="initialsSave"/.test(appHtml) && /id="initialsHelp"/.test(appHtml));
  ok('...saved through set_team_initials, clearing this browser\'s remembered codes', /sb\.rpc\('set_team_initials', \{ p_team: team\.id, p_initials: input\.value \}\)/.test(app) &&
     /sessionStorage\.removeItem\('epinoia_initials_v1'\)/.test(app));
  ok('...mounted with the crest when a club is opened', /mountCrest\(\);\s*mountInitials\(\);/.test(app));
  ok('...and it says plainly when the database is not updated yet', /needs a database update first/.test(app));
  const mig = rd('supabase', 'migrations', '0129_team_initials.sql');
  ok('0129: a nullable initials column, 2-4 capitals or digits, unique per league for chosen codes',
     /add column if not exists initials text/.test(mig) && /initials ~ '\^\[A-Z0-9\]\{2,4\}\$'/.test(mig) &&
     /create unique index if not exists teams_league_initials_key\s+on public\.teams \(league_id, initials\) where initials is not null/.test(mig));
  ok('0129: set_team_initials checks who is asking the way set_team_colour does, signed in only',
     /may_manage_media\('team', p_team\)/.test(mig) && /revoke all on function public\.set_team_initials\(uuid, text\) from public, anon/.test(mig) &&
     /grant execute on function public\.set_team_initials\(uuid, text\) to authenticated/.test(mig));
  ok('0129: its self-test rolls its clubs back', /0129 self-test rollback/.test(mig) && /exception when sqlstate 'P0004' then null/.test(mig));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
