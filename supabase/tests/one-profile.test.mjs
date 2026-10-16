// A LINKED PLAYER IS ONE PROFILE (Louie, 2026-10-16: "I don't want multiple profiles, I want everything all on one profile
// (if a player is linked, merge their pages)"):
//   * linkswitch.js homeProfile: the row every one of his rows' pages becomes, the same whichever is asked for;
//   * follow.js: one bell for the one profile -- lit by a follow of any of his rows, saving this id alone;
//   * p/player.js: his other rows open his home row (unless &own=1), ALL across linked rows, the floor across his linked clubs;
//   * 0280 (PGlite, skipped when it is not installed): a followed player's linked rows reach the notifications, and a page
//     can ask which rows a followed player has.
//
//   node supabase/tests/one-profile.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const rd = (...p) => readFileSync(path.join(here, '..', '..', ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* ---------------------------------------------------------------- his home row --- */
console.log('-- the home row');
const require = createRequire(import.meta.url);
const K = require(path.join(here, '..', '..', 'epinoia', 'linkswitch.js'));
const card = (id, spells) => ({ id, slug: id + '-slug', name: 'Thomas Kennedy', spells: spells.map(([league_slug, season, team]) => ({ league_slug, season, team: team || 'London Lions', league: league_slug })) });
const SLB = card('b-slb', [['slb-men', '2026-27']]), EC = card('a-ec', [['eurocup', '2026-27']]);
ok('his domestic league\'s row, not the European cup\'s, at the same season (whichever id sorts first)', K.homeProfile({ players: [EC, SLB] }) === 'b-slb' && K.homeProfile({ players: [SLB, EC] }) === 'b-slb');
const OLD = card('c-old', [['bcb', '2024-25'], ['bcb', '2025-26']]), NEW = card('d-new', [['slb-men', '2026-27']]);
ok('the row with his newest season, before the one with more seasons behind it', K.homeProfile({ players: [OLD, NEW] }) === 'd-new');
const A = card('x2', [['lkl', '2026-27'], ['lkl', '2025-26']]), B = card('x1', [['lkl', '2026-27']]);
ok('then the row with the most behind it', K.homeProfile({ players: [B, A] }) === 'x2');
const C1 = card('z9', [['nbl', '2026-27']]), C2 = card('z1', [['nbl1-men', '2026-27']]);
ok('then the lowest id: every row names the same one, whatever order they come in', K.homeProfile({ players: [C1, C2] }) === 'z1' && K.homeProfile({ players: [C2, C1] }) === 'z1');
ok('a player linked to nothing has none (his page is his own)', K.homeProfile(null) === null && K.homeProfile({ players: [SLB] }) === null);
ok('the cross-border competitions are told apart from domestic leagues', ['euroleague', 'eurocup', 'basketball-champions-league', 'fiba-europe-cup'].every(K.crossBorder) &&
   !['slb-men', 'bbl', 'nbl', 'liga-endesa', 'lkl'].some(K.crossBorder));

/* ---------------------------------------------------------------- the player page --- */
console.log('-- the player page');
{
  const PJ = rd('epinoia', 'p', 'player.js');
  ok('another of his rows opens his home row, keeping the season and tab asked for, unless &own=1; &via=1 stops a circle',
     /if \(!own && !qBoot\.get\('via'\) && LK && LK\.homeProfile\)/.test(PJ) && /qBoot\.set\('p', card\.slug \|\| home\); qBoot\.set\('via', '1'\);/.test(PJ) &&
     /location\.replace\(location\.pathname \+ '\?' \+ qBoot\.toString\(\) \+ location\.hash\)/.test(PJ));
  ok('...his link group asked beside his photo and club, not after them', /LK && LK\.loadPlayer \? LK\.loadPlayer\(pl\.id\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)\n    \]\);/.test(PJ));
  ok('the "other profiles" button only on a row opened as itself', /LK\.paintPlayer\(pl, lk, \{ sub: \$\('#sub'\), own \}\)/.test(PJ));
  ok('ALL across linked rows: his rows in the field made one line, summed before any rate', /if \(kind === 'all' && pids\.size > 1\) \{/.test(PJ) &&
     /field = field\.filter\(r => !pids\.has\(r\.id\) && r\.id !== pl\.id\)\.concat\(one\);/.test(PJ) && /function jointSeasonLine\(plId, cs\)/.test(PJ));
  ok('the follow bell carries his other rows', /bell\('player', pl\.id, \{ cls: 'big', label: 'follow', also: \(alsoIds \|\| \[\]\)\.filter\(x => x && x !== pl\.id\) \}\)/.test(PJ));
  ok('"on the floor with" reads his linked clubs\' games, counted as this club\'s, in copies', /FLOOR_ALIAS\.set\(x\.tid, team\.id\)/.test(PJ) && /let gs = gsRaw\.map\(g => aliasCopy\(g, FLOOR_ALIAS\)\);/.test(PJ) &&
     /stRaw\.forEach\(x => \{ const l = CLUB_STINTS\.get\(x\.game_id\)/.test(PJ) && /pid = FLOOR_ALIAS\.get\(pid\) \|\| pid;/.test(PJ));
  /* aliasCopy itself */
  const start = PJ.indexOf('function aliasCopy(o, map) {'), end = PJ.indexOf('\n}\n', start) + 2;
  const aliasCopy = new Function(PJ.slice(start, end) + '\nreturn aliasCopy;')();
  const map = new Map([['ec-pid', 'slb-pid'], ['ec-team', 'slb-team']]);
  const ev = { pid: 'ec-pid', on: ['ec-pid', 'mate'], team: 0, gameId: 'g1', x: { by: 'ec-pid' } };
  const cp = aliasCopy(ev, map);
  ok('aliasCopy: every id of his other row (in arrays and inside objects too) becomes this one, and the original is untouched',
     cp.pid === 'slb-pid' && cp.on.join() === 'slb-pid,mate' && cp.x.by === 'slb-pid' && cp.team === 0 && cp.gameId === 'g1' && ev.pid === 'ec-pid' && ev.on[0] === 'ec-pid', cp);
  ok('...nothing to alias, the same object back', aliasCopy(ev, new Map()) === ev);
}

/* ---------------------------------------------------------------- the follow bell --- */
console.log('-- one follow');
{
  const writes = [];
  let stored = { fav_player_ids: ['other-row', 'someone-else'] };
  const bells = [];
  const mkEl = tag => {
    const n = { tag, dataset: {}, attrs: {}, children: [], _cls: new Set(), handlers: {}, title: '',
      classList: { add: c => n._cls.add(c), remove: c => n._cls.delete(c), toggle: (c, on) => (on ? n._cls.add(c) : n._cls.delete(c)), contains: c => n._cls.has(c) },
      setAttribute(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.handlers[t] = f; },
      querySelector: () => null, set innerHTML(v) { n._html = v; }, get className() { return [...n._cls].join(' '); }, set className(v) { n._cls = new Set(String(v).split(/\s+/).filter(Boolean)); } };
    if (tag === 'button') bells.push(n);
    return n;
  };
  const sandbox = {
    window: { EPINOIA_CONFIG: { supabaseUrl: 'https://abcd.supabase.co', supabaseAnonKey: 'anon' } },
    localStorage: { getItem: k => (k === 'sb-abcd-auth-token' ? JSON.stringify({ access_token: 't', expires_at: Date.now() / 1000 + 3600 }) : null) },
    document: { createElement: mkEl, querySelector: () => null,
      querySelectorAll: sel => bells.filter(b => sel.includes('"' + b.dataset.kind + '"') && sel.includes('"' + b.dataset.id + '"')) },
    fetch: async (url, o) => {
      if (/fan_prefs\?select=/.test(url)) return { ok: true, json: async () => [Object.assign({}, stored)] };
      if (/set_fan_prefs/.test(url)) { const b = JSON.parse(o.body).p; writes.push(b); Object.assign(stored, b); return { ok: true, json: async () => ({}) }; }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    console, Date, JSON, Promise, Set, Map, setTimeout, String, Number, Array, Object
  };
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'follow.js'), sandbox);
  const F = sandbox.window.EpinoiaFollow;
  const bell = F.bell('player', 'home-row', { also: ['other-row'] });
  await F.load(); await new Promise(r => setTimeout(r, 5));
  ok('a fan who followed his other row sees the bell lit on his one profile', bell.classList.contains('on') && bell.dataset.also === 'other-row');
  let r = await F.toggle('player', 'home-row', null, { also: ['other-row'], want: true, quiet: true });
  ok('...asked to follow, this id is saved and the other row dropped: the same person is never in the list twice',
     r.ok && r.on && writes.length === 1 && writes[0].fav_player_ids.slice().sort().join() === 'home-row,someone-else', writes);
  r = await F.toggle('player', 'home-row', null, { also: ['other-row'], quiet: true });
  ok('...a tap on a lit bell unfollows him, every row of him', r.ok && !r.on && writes[1].fav_player_ids.join() === 'someone-else' && !bell.classList.contains('on'), writes[1]);
  r = await F.toggle('player', 'home-row', null, { also: ['other-row'], quiet: true });
  ok('...and a tap again follows him by this id alone', r.ok && r.on && writes[2].fav_player_ids.slice().sort().join() === 'home-row,someone-else' && bell.classList.contains('on'), writes[2]);
  const plain = await F.toggle('player', 'lone', null, { quiet: true });
  ok('a player with no linked rows follows as before', plain.ok && plain.on && writes[3].fav_player_ids.includes('lone'));
}

/* ---------------------------------------------------------------- 0280 --- */
console.log('-- 0280: what a follow brings');
let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.players (id uuid primary key);
    create table public.player_groups (id uuid primary key default gen_random_uuid());
    create table public.player_group_members (player_id uuid primary key references public.players, group_id uuid not null references public.player_groups,
      linked_at timestamptz not null default now());
    create table public.notify_audience_rows (user_id uuid, device_id uuid, sub text, fav_team_ids uuid[], fav_player_ids uuid[], fav_game_ids uuid[],
      want_results boolean, want_players boolean, want_fixtures boolean, want_announcements boolean, want_fixture_2d boolean, want_fixture_2h boolean,
      want_lineups boolean, want_player_games boolean, want_halftime boolean, fav_league_ids uuid[], time_zone text);
    grant select on all tables in schema public to anon, authenticated;
  `);
  const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  await db.exec(`insert into players values ('${U(1)}'), ('${U(2)}'), ('${U(3)}'), ('${U(4)}');
    insert into player_groups (id) values ('${U(90)}');
    insert into player_group_members (player_id, group_id, linked_at) values ('${U(1)}', '${U(90)}', '2026-10-01'), ('${U(2)}', '${U(90)}', '2026-10-02');
    insert into notify_audience_rows (sub, fav_player_ids, fav_team_ids) values ('fan', array['${U(1)}', '${U(3)}']::uuid[], '{}'), ('nobody', '{}', '{}'), ('other', array['${U(4)}']::uuid[], '{}');`);
  await db.exec(readFileSync(path.join(here, '..', 'migrations', '0280_linked_player_one_profile.sql'), 'utf8'));
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const aud = Object.fromEntries((await q(`select sub, fav_player_ids from notify_audience`)).map(r => [r.sub, (r.fav_player_ids || []).slice().sort()]));
  ok('a fan who follows one row of a linked player hears about every row of him, and the rest of their list is as it was',
     aud.fan.join() === [U(1), U(2), U(3)].join() && aud.nobody.length === 0 && aud.other.join() === U(4), aud);
  const cols = (await q(`select column_name from information_schema.columns where table_name = 'notify_audience' order by ordinal_position`)).map(r => r.column_name).join();
  ok('the view keeps 0155\'s columns in 0155\'s order (every fan-out reads it unchanged)', cols === 'user_id,device_id,sub,fav_team_ids,fav_player_ids,fav_game_ids,want_results,want_players,want_fixtures,want_announcements,want_fixture_2d,want_fixture_2h,want_lineups,want_player_games,want_halftime,fav_league_ids,time_zone', cols);
  const m = (await q(`select linked_player_ids(array['${U(2)}', '${U(4)}']::uuid[]) j`))[0].j;
  ok('a page asks which rows a followed player has: his rows, oldest link first; a player linked to nothing is left out',
     Object.keys(m).length === 1 && m[U(2)].join() === [U(1), U(2)].join(), m);
  const priv = (await q(`select has_function_privilege('anon', 'public.link_player_ids(uuid[])', 'execute') a, has_function_privilege('anon', 'public.linked_player_ids(uuid[])', 'execute') b`))[0];
  ok('the widening is the database\'s own; the page\'s question is open to everyone', priv.a === false && priv.b === true, priv);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
