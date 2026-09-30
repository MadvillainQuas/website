// 0203 - a game still 'live' long after it could have been played is closed, on a REAL Postgres (PGlite), no network.
//
//   node supabase/tests/close-stuck-games.test.mjs
//
// The four games of 26-30 Sep 2026 are rebuilt as rows: the fourth quarter over (Oaklands 118-50), a
// fourth quarter nearly over and decided (Vellaznimi 68-83 at 0:35), one the feed stopped in the first
// quarter (Liverpool 7-8 at 7:15), one the feed called final that finalise-game refused (Slavia 96-80).
// PGlite is not part of the site; without it this says so and passes. PGLITE_DIR points at a scratch install.
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
  create table public.competitions (id uuid primary key default gen_random_uuid());
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    tipoff_at timestamptz, status public.game_status not null default 'scheduled', home_score int, away_score int, period int,
    finalised_at timestamptz, stalled_since timestamptz);
  create table public.game_state (game_id uuid primary key references public.games on delete cascade, period int not null default 1,
    clock_ms int not null default 600000, score_home int not null default 0, score_away int not null default 0);
  create table public.external_games (id uuid primary key default gen_random_uuid(), adapter text not null default 'x', external_id text not null default gen_random_uuid()::text,
    game_id uuid references public.games, external_status text, ingested_at timestamptz, error text);
  create table public.rebuilt (competition_id uuid);
  create function public.recompute_standings(p uuid) returns void language sql as $$ insert into public.rebuilt values (p) $$;
`);
await db.exec(mig('0203_close_stuck_games.sql'));

const q = async (sql, params) => (await db.query(sql, params)).rows;
const C1 = (await q(`insert into competitions default values returning id`))[0].id;
const C2 = (await q(`insert into competitions default values returning id`))[0].id;
const game = async (comp, hoursAgo, status, hs, as, period, clockMs, feed) => {
  const id = (await q(`insert into games (competition_id, tipoff_at, status, home_score, away_score, period)
                       values ($1, now() - make_interval(hours => $2), $3, $4, $5, $6) returning id`, [comp, hoursAgo, status, hs, as, period]))[0].id;
  await q(`insert into game_state (game_id, period, clock_ms, score_home, score_away) values ($1,$2,$3,$4,$5)`, [id, period, clockMs, hs, as]);
  await q(`insert into external_games (game_id, external_status) values ($1, $2)`, [id, feed]);
  return id;
};
const row = async id => (await q(`select g.status::text status, g.home_score, g.away_score, g.finalised_at is not null fin, g.stalled_since, e.external_status, e.error
                                   from games g left join external_games e on e.game_id = g.id where g.id = $1`, [id]))[0];

const oak = await game(C1, 24 * 340, 'live', 118, 50, 4, 0, 'final');          // end of Q4, feed final, finalise refused
const kos = await game(C2, 72, 'live', 68, 83, 4, 35000, 'live');              // Q4 0:35, 15 points down: decided
const liv = await game(C2, 96, 'live', 7, 8, 1, 435000, 'live');               // Q1 7:15
const sla = await game(C1, 120, 'live', 96, 80, 4, 300000, 'final');           // feed final, clock 5:00 left, lead 16 > 3*25? no: 3*ceil(300/12)=75 -> the feed's word decides
const fresh = await game(C1, 3, 'live', 40, 38, 2, 120000, 'live');            // a game being played now
const late = await game(C1, 10, 'live', 60, 60, 4, 0, 'live');                 // level at 0:00 ten hours after tip: nobody knows
const done = await game(C1, 500, 'final', 90, 80, 4, 0, 'final');              // finished long ago
await q(`update games set stalled_since = now() where id = $1`, [kos]);

console.log('-- a dry run only reports');
const dry = await q(`select * from close_stuck_games(6, null, true)`);
ok('it lists the five stuck games and not the fresh or finished ones', dry.length === 5 && !dry.some(r => [fresh, done].includes(r.game_id)), dry.map(r => r.verdict));
ok('...and changes nothing', (await row(kos)).status === 'live' && (await q(`select count(*)::int n from audit_log`))[0].n === 0);

console.log('-- the verdicts');
const res = Object.fromEntries((await q(`select * from close_stuck_games(6)`)).map(r => [r.game_id, r]));
ok('Oaklands (Q4 over, 118-50): final on its score', res[oak].verdict === 'final' && (await row(oak)).status === 'final' && (await row(oak)).home_score === 118, res[oak]);
ok('Vellaznimi (Q4 0:35, 68-83): decided, final', res[kos].verdict === 'final' && (await row(kos)).status === 'final' && (await row(kos)).away_score === 83, res[kos]);
ok('...its finalised_at is set and the stall flag cleared', (await row(kos)).fin === true && (await row(kos)).stalled_since === null);
ok('Slavia (the feed said final): final', res[sla].verdict === 'final' && (await row(sla)).status === 'final', res[sla]);
ok('Liverpool (stopped in Q1 at 7-8): void, not a made-up result', res[liv].verdict === 'void' && (await row(liv)).status === 'void', res[liv]);
ok('level at 0:00 ten hours on: void', res[late].verdict === 'void' && (await row(late)).status === 'void', res[late]);
ok('a game being played now is left alone', (await row(fresh)).status === 'live');
ok('a finished game is left alone', (await row(done)).status === 'final' && res[done] === undefined);

console.log('-- the feed row is closed with the reason, so no lane writes the game back to live');
const e = await row(liv);
ok('external_status final, reason in error', e.external_status === 'final' && /^reconciled \(void\)/.test(e.error), e);
ok('an audit row per game', (await q(`select count(*)::int n from audit_log where action = 'close_stuck_game'`))[0].n === 5);
ok('standings rebuilt once for each competition touched', (await q(`select count(*)::int n from rebuilt`))[0].n === 2 && (await q(`select count(distinct competition_id)::int n from rebuilt`))[0].n === 2);

console.log('-- idempotent, and it can be asked about single games');
ok('a second run finds nothing', (await q(`select * from close_stuck_games(6)`)).length === 0);
const again = await game(C1, 30, 'live', 50, 40, 4, 0, 'live'), other = await game(C1, 30, 'live', 50, 40, 4, 0, 'live');
const one = await q(`select * from close_stuck_games(6, array[$1]::uuid[])`, [again]);
ok('with ids it closes those and only those', one.length === 1 && (await row(again)).status === 'final' && (await row(other)).status === 'live');
ok('the hourly job asks for 24 h: a game 20 h on is left to the ingest', (await q(`select count(*)::int n from close_stuck_games(24, array[$1]::uuid[], true)`, [await game(C1, 20, 'live', 1, 0, 4, 0, 'live')]))[0].n === 0);

console.log('-- only the service role may call it');
const acl = (await q(`select has_function_privilege('anon', 'public.close_stuck_games(numeric, uuid[], boolean)', 'execute') a,
                             has_function_privilege('authenticated', 'public.close_stuck_games(numeric, uuid[], boolean)', 'execute') u,
                             has_function_privilege('service_role', 'public.close_stuck_games(numeric, uuid[], boolean)', 'execute') s`))[0];
ok('anon and signed-in users cannot; the service role can', !acl.a && !acl.u && acl.s, acl);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
