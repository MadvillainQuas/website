// 0208 - the stuck-game clean-up does not close a game that is being played, on a REAL Postgres (PGlite).
//
//   node supabase/tests/scorer-stuck.test.mjs
//
// 0203 closes a game still live long after its tip-off; 0206 taught it halves; 0208 stops it closing a game that
// is still moving, and an app-scored game before a day of silence. The trap this guards against in particular:
// game_state.updated_at is rewritten by the ingest on every pass of a feed that says live, so it cannot be the
// signal for a fed game - a feed frozen at Q1 7:15 must still be closed even though its state row is a minute old.
// PGlite is not part of the site; without it this says so and passes (as close-stuck-games.test.mjs does).
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
  create schema auth; create table auth.users (id uuid primary key);
  create type public.game_status as enum ('scheduled','live','finalising','final','void');
  create table public.audit_log (id bigserial primary key, actor uuid references auth.users, action text not null, subject text not null,
    subject_id text, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), rules jsonb not null default '{}'::jsonb);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    tipoff_at timestamptz, status public.game_status not null default 'scheduled', home_score int, away_score int, period int,
    finalised_at timestamptz, stalled_since timestamptz);
  create table public.game_state (game_id uuid primary key references public.games on delete cascade, period int not null default 1,
    clock_ms int not null default 600000, score_home int not null default 0, score_away int not null default 0,
    updated_at timestamptz not null default now());
  create table public.game_events (id bigserial primary key, game_id uuid not null references public.games on delete cascade,
    seq int not null, t text not null, period int, clock int, created_at timestamptz not null default now(), unique (game_id, seq));
  create table public.external_games (id uuid primary key default gen_random_uuid(), adapter text not null default 'x', external_id text not null default gen_random_uuid()::text,
    game_id uuid references public.games, external_status text, ingested_at timestamptz, error text);
  create table public.rebuilt (competition_id uuid);
  create function public.recompute_standings(p uuid) returns void language sql as $$ insert into public.rebuilt values (p) $$;
`);
/* 0203, then 0206's halves question and its restatement, then 0208 - the order production applies them in */
await db.exec(mig('0203_close_stuck_games.sql'));
{
  const m6 = mig('0206_ncaa_halves_and_scale.sql');
  const a = m6.indexOf('create or replace function public.game_in_halves(');
  const b = m6.indexOf('grant execute on function public.game_in_halves(uuid, jsonb) to service_role;') +
            'grant execute on function public.game_in_halves(uuid, jsonb) to service_role;'.length;
  await db.exec(m6.slice(a, b));
}
const m8 = mig('0208_scorer_reliability.sql');
await db.exec(m8);
await db.exec(m8);                     // re-runnable
ok('0208 applies, and applies twice', true);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const L4 = (await q(`insert into leagues (rules) values ('{}') returning id`))[0].id;
const L2 = (await q(`insert into leagues (rules) values ('{"periods": 2}') returning id`))[0].id;
const comp = async L => {
  const season = (await q(`insert into seasons (league_id) values ($1) returning id`, [L]))[0].id;
  return (await q(`insert into competitions (season_id) values ($1) returning id`, [season]))[0].id;
};
const C4 = await comp(L4), C2 = await comp(L2);

/* a game: hours since tip-off; its state row and when it was written; its newest play; a feed row or not */
const game = async ({ comp: c = C4, hoursAgo, period = 4, clockMs = 0, hs = 70, as = 60, stateAgo, playAgo, feed }) => {
  const id = (await q(`insert into games (competition_id, tipoff_at, status, home_score, away_score, period)
                       values ($1, now() - make_interval(hours => $2), 'live', $3, $4, $5) returning id`, [c, hoursAgo, hs, as, period]))[0].id;
  if (stateAgo != null) {
    await q(`insert into game_state (game_id, period, clock_ms, score_home, score_away, updated_at)
             values ($1,$2,$3,$4,$5, now() - make_interval(mins => $6))`, [id, period, clockMs, hs, as, stateAgo]);
  }
  if (playAgo != null) {
    await q(`insert into game_events (game_id, seq, t, period, clock, created_at)
             values ($1, 1, 'p2_made', $2, $3, now() - make_interval(mins => $4))`, [id, period, clockMs, playAgo]);
  }
  if (feed) await q(`insert into external_games (game_id, external_status) values ($1, $2)`, [id, feed]);
  return id;
};
const status = async id => (await q(`select status::text s from games where id = $1`, [id]))[0].s;

const fedFrozen = await game({ hoursAgo: 30, stateAgo: 1, playAgo: 3 * 1440, feed: 'live' });        // the ingest touched state a minute ago
const fedMoving = await game({ hoursAgo: 30, stateAgo: 1, playAgo: 10, feed: 'live' });              // a play ten minutes ago
const fedHalves = await game({ comp: C2, hoursAgo: 30, period: 2, stateAgo: 1, playAgo: 3 * 1440, feed: 'live' });
const appLive   = await game({ hoursAgo: 30, stateAgo: 20, playAgo: 120 });                         // the scorer's heartbeat, 20 min ago
const appQuiet  = await game({ hoursAgo: 30, stateAgo: 23 * 60, playAgo: 23 * 60 + 30 });             // silent 23 h
const appSilent = await game({ hoursAgo: 30, stateAgo: 25 * 60, playAgo: 26 * 60 });                  // silent 25 h
const appBare   = await game({ hoursAgo: 30, period: 1, clockMs: 400000 });                           // nothing at all
const appYoung  = await game({ hoursAgo: 7, stateAgo: 6 * 60 + 30, playAgo: 6 * 60 + 40 });            // the ingest's 6 h call

console.log('-- a dry run lists what 0208 would close');
const dry = (await q(`select * from close_stuck_games(24, null, true)`)).map(r => r.game_id);
ok('the frozen feed is listed although its state row is a minute old (the ingest rewrites it every pass)', dry.includes(fedFrozen), dry.length);
ok('a feed with a play ten minutes ago is not', !dry.includes(fedMoving));
ok('an app-scored game with a live heartbeat is not', !dry.includes(appLive));
ok('an app-scored game silent for 23 h is not', !dry.includes(appQuiet));
ok('one silent for 25 h is', dry.includes(appSilent));
ok('one with nothing at all, 30 h after its tip-off, is', dry.includes(appBare));

console.log('-- closing');
const res = Object.fromEntries((await q(`select * from close_stuck_games(24)`)).map(r => [r.game_id, r]));
ok('the frozen feed: final on its score, as 0203 meant', res[fedFrozen] && res[fedFrozen].verdict === 'final' && await status(fedFrozen) === 'final', res[fedFrozen]);
ok('...and 0206\'s halves still count: a second half over is a result', res[fedHalves] && res[fedHalves].verdict === 'final', res[fedHalves]);
ok('the app-scored game silent 25 h: closed', await status(appSilent) === 'final');
ok('the bare one: void (stopped in the first period), not a made-up result', res[appBare] && res[appBare].verdict === 'void' && await status(appBare) === 'void', res[appBare]);
for (const [name, id] of [['the moving feed', fedMoving], ['the live heartbeat', appLive], ['the quiet day', appQuiet]]) {
  ok(name + ' is still live', await status(id) === 'live');
}
ok('the ingest\'s own call (6 h cap, by id) leaves an app-scored game 7 h after tip-off alone',
   (await q(`select * from close_stuck_games(6, array[$1]::uuid[])`, [appYoung])).length === 0 && await status(appYoung) === 'live');

console.log('-- once the moving game stops');
await q(`update game_events set created_at = now() - interval '45 minutes' where game_id = $1`, [fedMoving]);
ok('a feed quiet for 45 minutes, 30 h after its tip-off, is closed', (await q(`select * from close_stuck_games(24, array[$1]::uuid[])`, [fedMoving])).length === 1 &&
   await status(fedMoving) === 'final');

console.log('-- still only the service role');
const acl = (await q(`select has_function_privilege('anon', 'public.close_stuck_games(numeric, uuid[], boolean)', 'execute') a,
                             has_function_privilege('authenticated', 'public.close_stuck_games(numeric, uuid[], boolean)', 'execute') u,
                             has_function_privilege('service_role', 'public.close_stuck_games(numeric, uuid[], boolean)', 'execute') s`))[0];
ok('anon and signed-in users cannot; the service role can', !acl.a && !acl.u && acl.s, acl);
ok('the Python twin is named in the migration', /scripts\/ingest\/stuck\.py \(keep_open\)/.test(m8));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
