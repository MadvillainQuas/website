// 0263 - a league followed live on demand (NCAA D2) on a REAL Postgres (PGlite), no network.
//
//   PGLITE_DIR=/path/to/node_modules/@electric-sql/pglite node supabase/tests/live-on-demand.test.mjs
//
// Over the slice of the schema the functions read (leagues with rules, seasons, competitions, games, external_games):
//   * watch_game marks a live game of an on-demand league watched - or one due within half an hour - and nothing else;
//     a renewal within 30 s writes nothing;
//   * live_frames_wanted says no for an on-demand league's unwatched games (no frames, no "status" announcements),
//     yes once somebody watches, and is unchanged for every other league.
// PGlite is not part of the site; without it this says so and passes.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create type public.game_status as enum ('scheduled','live','finalising','final','void');
  create table public.leagues (id uuid primary key default gen_random_uuid(), rules jsonb not null default '{}',
    public_live boolean default true, access_mode text default 'open', visibility text default 'public');
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    tipoff_at timestamptz, status public.game_status not null default 'scheduled');
  create table public.external_games (id uuid primary key default gen_random_uuid(), game_id uuid references public.games);
  create function public.memberships_enabled() returns boolean language sql as $$ select false $$;
`);
await db.exec(mig('0263_live_on_demand.sql'));
ok('0263 applies on a real Postgres', true);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const league = async rules => (await one(`insert into leagues (rules) values ($1) returning id`, [rules])).id;
const game = async (lg, status, tipIn = '-1 hour') => {
  const s = (await one(`insert into seasons (league_id) values ($1) returning id`, [lg])).id;
  const c = (await one(`insert into competitions (season_id) values ($1) returning id`, [s])).id;
  const g = (await one(`insert into games (competition_id, status, tipoff_at) values ($1, $2, now() + $3::interval) returning id`, [c, status, tipIn])).id;
  await q(`insert into external_games (game_id) values ($1)`, [g]);
  return g;
};
const LD = await league({ periods: 2, live: 'on_demand' });
const LO = await league({ periods: 4 });
const wanted = async g => (await one(`select public.live_frames_wanted($1) as w`, [g])).w;
const watch = async g => (await one(`select public.watch_game($1) as w`, [g])).w;

console.log('\nan on-demand league (NCAA D2)');
const d1 = await game(LD, 'live');
ok('its league is on demand, an ordinary one is not', (await one(`select public.live_on_demand($1) as x`, [d1])).x === true
   && (await one(`select public.live_on_demand($1) as x`, [await game(LO, 'live')])).x === false);
ok('a live game nobody watches: no frames, no announcements', await wanted(d1) === false);
ok('watch_game: watched', await watch(d1) === true);
ok('...and now its frames go out, as any league\'s', await wanted(d1) === true);
const until1 = (await one(`select until from game_watch where game_id = $1`, [d1])).until;
await watch(d1);
const until2 = (await one(`select until from game_watch where game_id = $1`, [d1])).until;
ok('a renewal within 30 s writes nothing', +until1 === +until2);
await q(`update game_watch set until = now() - interval '1 second' where game_id = $1`, [d1]);
ok('once the watch lapses (the page closed), quiet again', await wanted(d1) === false);
ok('a game due within half an hour can be watched', await watch(await game(LD, 'scheduled', '20 minutes')) === true);
ok('...one due in two hours cannot', await watch(await game(LD, 'scheduled', '2 hours')) === false);
const fin = await game(LD, 'final');
ok('a finished game cannot be watched (it is read in full anyway)', await watch(fin) === false);
ok('...and its final status is broadcast only to a watcher - unwatched, nothing', await wanted(fin) === false);

console.log('\nevery other league, as before');
const o1 = await game(LO, 'live');
ok('a live game: frames, watched or not', await wanted(o1) === true);
ok('watch_game says no and writes nothing', await watch(o1) === false
   && (await one(`select count(*)::int as n from game_watch where game_id = $1`, [o1])).n === 0);
ok('a final game: frames', await wanted(await game(LO, 'final')) === true);
ok('a game with no feed: none, as 0157', await wanted((await one(`insert into games (competition_id, status) select competition_id, 'live' from games where id = $1 returning id`, [o1])).id) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
