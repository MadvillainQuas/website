// 0174 - a game that names no arena is played at its home club's - on a REAL Postgres (PGlite), no network.
//
//   node supabase/tests/assumed-venue.test.mjs
//
// PGlite is a devDependency-free npm package; when it is not installed this test says so and passes (it
// is not part of the site, and CI installs it for this one step). The schema is the minimum 0162 and 0174
// need (games, teams, competitions/seasons/leagues for the country lookup, the roles), then the two
// migrations exactly as they are on disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

let PGlite;
// PGLITE_DIR lets a machine with the package in a scratch folder run it without adding it to the repo
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function public.is_platform_admin() returns boolean language sql as $$ select false $$;
  create table public.leagues (id uuid primary key default gen_random_uuid(), country text);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.teams (id uuid primary key default gen_random_uuid(), name text);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    home_team_id uuid references public.teams, away_team_id uuid references public.teams, venue text, status text default 'scheduled');
  insert into public.leagues (id, country) values ('00000000-0000-0000-0000-00000000000a', 'ES');
  insert into public.seasons (id, league_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a');
  insert into public.competitions (id, season_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1');
`);
await db.exec(mig('0162_venues.sql'));
await db.exec(mig('0174_assumed_home_venue.sql'));

const C = '00000000-0000-0000-0000-0000000000c1';
const q = async (sql, params) => (await db.query(sql, params)).rows;
const team = async name => (await q(`insert into teams (name) values ($1) returning id`, [name]))[0].id;
const arena = async (name, note = null, checked = false) => (await q(
  `insert into venues (name, pin_source, pin_note, checked_at, lat, lng) values ($1, 'google', $2, ${checked ? 'now()' : 'null'}, 1, 1) returning id`, [name, note]))[0].id;
const game = async (home, venue = null) => (await q(`insert into games (competition_id, home_team_id, venue) values ($1, $2, $3) returning id`, [C, home, venue]))[0].id;
const g = async id => (await q(`select venue, venue_id, venue_assumed from games where id = $1`, [id]))[0];
const aliasCount = async () => Number((await q(`select count(*) n from venue_aliases`))[0].n);

console.log('-- a game written with no venue takes its home club\'s arena');
const madrid = await team('Real Madrid'), betis = await team('Betis');
const wiz = await arena('WiZink Center');
await q(`update teams set home_venue_id = $1 where id = $2`, [wiz, madrid]);
const a1 = await game(madrid);
ok('a new game with no venue: arena name, link and the flag', JSON.stringify(await g(a1)) === JSON.stringify({ venue: 'WiZink Center', venue_id: wiz, venue_assumed: true }), await g(a1));
const a2 = await game(madrid, 'TBD');
ok('a placeholder ("TBD") counts as not named', (await g(a2)).venue === 'WiZink Center' && (await g(a2)).venue_assumed, await g(a2));
const a3 = await game(betis);
ok('a home club with no arena: nothing invented', JSON.stringify(await g(a3)) === JSON.stringify({ venue: null, venue_id: null, venue_assumed: false }), await g(a3));

console.log('-- a venue somebody named is never overwritten, and replaces an assumed one');
const n1 = await game(madrid, 'Palacio Vistalegre');
ok('a named venue keeps its name, gets its own arena, is not assumed', (await g(n1)).venue === 'Palacio Vistalegre' && !(await g(n1)).venue_assumed && (await g(n1)).venue_id !== wiz, await g(n1));
const before = await aliasCount();
await q(`update games set venue = 'Palacio Vistalegre' where id = $1`, [a1]);
ok('the feed later names one: it replaces the assumption and clears the flag', (await g(a1)).venue === 'Palacio Vistalegre' && !(await g(a1)).venue_assumed, await g(a1));
ok('...and that named arena is the same row the other game linked (no duplicate arena)', (await g(a1)).venue_id === (await g(n1)).venue_id);
await q(`update games set status = 'live' where id = $1`, [n1]);
ok('an update that does not touch the venue leaves it alone', (await g(n1)).venue === 'Palacio Vistalegre');

console.log('-- filling what exists: a club given an arena, and one taken away');
const b1 = await game(betis), b2 = await game(betis, 'Pabellón X');
const vil = await arena('Estadio Olímpico');
await q(`update teams set home_venue_id = $1 where id = $2`, [vil, betis]);
ok('giving Betis an arena fills its game that named none', (await g(b1)).venue === 'Estadio Olímpico' && (await g(b1)).venue_assumed, await g(b1));
ok('...and leaves the one that named an arena alone', (await g(b2)).venue === 'Pabellón X' && !(await g(b2)).venue_assumed, await g(b2));
const other = await arena('Otro Pabellón');
await q(`update teams set home_venue_id = $1 where id = $2`, [other, betis]);
ok('changing the club\'s arena moves its ASSUMED games with it', (await g(b1)).venue === 'Otro Pabellón' && (await g(b1)).venue_id === other, await g(b1));
ok('...but not the named one', (await g(b2)).venue === 'Pabellón X');
await q(`update teams set home_venue_id = null where id = $1`, [betis]);
ok('taking the arena away lets go of the assumed games', JSON.stringify(await g(b1)) === JSON.stringify({ venue: null, venue_id: null, venue_assumed: false }), await g(b1));
ok('...and still not the named one', (await g(b2)).venue === 'Pabellón X');

console.log('-- a doubtful arena is not assumed until a person has looked');
const lil = await team('Lille'), doubt = await arena('Halle Trannoy', 'two candidates');
const d1 = await game(lil);
await q(`update teams set home_venue_id = $1 where id = $2`, [doubt, lil]);
ok('a pin with a note: the game stays unnamed', (await g(d1)).venue === null && !(await g(d1)).venue_assumed, await g(d1));
const d2 = await game(lil);
ok('...and a new game too', (await g(d2)).venue === null, await g(d2));
await q(`update venues set checked_at = now() where id = $1`, [doubt]);
ok('checked by a person: both take it', (await g(d1)).venue === 'Halle Trannoy' && (await g(d2)).venue_assumed, [await g(d1), await g(d2)]);
await q(`update venues set name = 'Halle Trannoy (Lille)' where id = $1`, [doubt]);
ok('the arena renamed: its assumed games follow the name', (await g(d1)).venue === 'Halle Trannoy (Lille)', await g(d1));

console.log('-- the home club corrected on a fixture');
const alba = await team('Alba'), albaA = await arena('Uber Arena');
await q(`update teams set home_venue_id = $1 where id = $2`, [albaA, alba]);
const h1 = await game(madrid);
ok('starts at Madrid\'s arena', (await g(h1)).venue_assumed && (await g(h1)).venue_id === (await q(`select home_venue_id v from teams where id = $1`, [madrid]))[0].v, await g(h1));
await q(`update games set home_team_id = $1 where id = $2`, [alba, h1]);
ok('the home club changed: it follows Alba\'s arena', (await g(h1)).venue === 'Uber Arena' && (await g(h1)).venue_assumed, await g(h1));

console.log('-- learning a club\'s arena ignores assumed games');
const tiny = await team('Tiny');
for (let i = 0; i < 4; i++) await game(tiny, 'Sala A');
await q(`select learn_home_venues()`);
const learnt = (await q(`select v.name from teams t join venues v on v.id = t.home_venue_id where t.id = $1`, [tiny]))[0];
ok('four games that named Sala A teach it', learnt && learnt.name === 'Sala A', learnt);
const only = await team('Only Assumed'), onlyA = await arena('Sala Asumida');
for (let i = 0; i < 4; i++) await game(only);                       // no arena yet: four games name none
await q(`update teams set home_venue_id = $1 where id = $2`, [onlyA, only]);   // ...now all four are assumed
ok('four assumed games', Number((await q(`select count(*) n from games where home_team_id = $1 and venue_assumed`, [only]))[0].n) === 4);
await q(`update teams set home_venue_id = null where id = $1`, [only]);        // the arena goes; the games let go
await q(`select learn_home_venues()`);
ok('a club whose games were only ever ASSUMED is not handed an arena by them',
   (await q(`select home_venue_id v from teams where id = $1`, [only]))[0].v === null);
const noticed = Number((await q(`select count(*) n from venues`))[0].n);
await q(`select assume_home_venues()`);
ok('assuming makes no arena of its own (the arena count is unchanged)', Number((await q(`select count(*) n from venues`))[0].n) === noticed);

console.log('-- who may call what');
const priv = async (role, fn) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p;
ok('no browser role can call assume_home_venues', !(await priv('anon', 'public.assume_home_venues(uuid)')) && !(await priv('authenticated', 'public.assume_home_venues(uuid)')));
ok('the service role can', await priv('service_role', 'public.assume_home_venues(uuid)'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
