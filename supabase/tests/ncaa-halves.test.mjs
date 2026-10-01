// 0206 - games in two halves (NCAA men) on a REAL Postgres (PGlite), no network.
//
//   PGLITE_DIR=/path/to/node_modules/@electric-sql/pglite node supabase/tests/ncaa-halves.test.mjs
//
// 0203 is applied, then 0206 on top of it, over the slice of the schema the three functions read
// (leagues with rules, seasons, competitions, games, game_state, game_events, external_games, the
// notification audience). Then, for one game in quarters and one in halves:
//   * game_in_halves says which is which, from the rules or from the log alone;
//   * close_stuck_games closes a halves game whose SECOND half ended as FINAL (0203 alone: VOID), and a
//     quarters game stopped in the second quarter as VOID, as it always did;
//   * notif_first_half measures a half as one 20-minute period, not two ten-minute ones;
//   * notify_halftime sends the half-time notice at the end of the FIRST half of a halves game, and not at
//     the end of its second; a quarters game exactly as before.
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
  create schema auth; create table auth.users (id uuid primary key);
  create type public.game_status as enum ('scheduled','live','finalising','final','void');
  create table public.audit_log (id bigserial primary key, actor uuid references auth.users, action text not null, subject text not null,
    subject_id text, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), rules jsonb not null default '{"periods": 4, "period_ms": 600000, "ot_ms": 300000}',
    public_live boolean default true, access_mode text default 'open', visibility text default 'public');
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons, name text default 'League');
  create table public.teams (id uuid primary key default gen_random_uuid(), name text);
  create table public.players (id uuid primary key default gen_random_uuid(), first_name text, last_name text, is_minor boolean, public_consent boolean);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    home_team_id uuid references public.teams, away_team_id uuid references public.teams,
    tipoff_at timestamptz, status public.game_status not null default 'scheduled', home_score int, away_score int, period int,
    finalised_at timestamptz, stalled_since timestamptz, starters jsonb);
  create table public.game_state (game_id uuid primary key references public.games on delete cascade, period int not null default 1,
    clock_ms int not null default 600000, running boolean not null default false, score_home int not null default 0, score_away int not null default 0,
    updated_at timestamptz not null default now());
  create table public.game_events (id bigserial primary key, game_id uuid references public.games on delete cascade, seq int not null,
    t text not null, team int, pid text, period int, clock int, payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now() - interval '10 minutes', unique (game_id, seq));
  create table public.external_games (id uuid primary key default gen_random_uuid(), adapter text not null default 'x', external_id text not null default gen_random_uuid()::text,
    game_id uuid references public.games, external_status text, ingested_at timestamptz, error text, competition_code text, tipoff_at timestamptz);
  create table public.competition_teams (competition_id uuid, team_id uuid, primary key (competition_id, team_id));
  create table public.standings (competition_id uuid, team_id uuid, primary key (competition_id, team_id));
  create table public.notifications (id bigserial primary key, user_id uuid, device_id uuid, kind text, title text, body text, link text,
    league_id uuid, game_id uuid, ref text, data jsonb, urgency text, expires_at timestamptz, unique (user_id, kind, ref));
  create table public.notify_audience (sub text, user_id uuid, device_id uuid, want_results boolean, want_players boolean, want_halftime boolean,
    fav_team_ids uuid[], fav_game_ids uuid[], fav_player_ids uuid[]);
  create table public.rebuilt (competition_id uuid);
  create function public.recompute_standings(p uuid) returns void language sql as $$ insert into public.rebuilt values (p) $$;
  create function public.memberships_enabled() returns boolean language sql as $$ select false $$;
  create function public.league_invited_for(u uuid, l uuid) returns boolean language sql as $$ select true $$;
  create function public.can_view_league_for(u uuid, l uuid) returns boolean language sql as $$ select true $$;
  create function public.player_withheld(m boolean, c boolean) returns boolean language sql as $$ select false $$;
  create function public.notif_num(p jsonb, k text) returns numeric language sql as $$ select coalesce((p ->> k)::numeric, 0) $$;
  create function public.notif_statline(p jsonb) returns text language sql as $$ select (p ->> 'pts') || ' pts' $$;
  create function public.notif_statline_more(p jsonb) returns text language sql as $$ select '' $$;
  create function public.notif_statline_data(p jsonb) returns jsonb language sql as $$ select p $$;
`);
await db.exec(mig('0203_close_stuck_games.sql'));
await db.exec(mig('0206_ncaa_halves_and_scale.sql'));
ok('0203 then 0206 apply on a real Postgres (0206 runs its own self-test)', true);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

const league = async rules => (await one(`insert into leagues (rules) values ($1) returning id`, [rules])).id;
const LQ = await league({ periods: 4, period_ms: 600000, ot_ms: 300000 });
const LH = await league({ periods: 2, period_ms: 1200000, ot_ms: 300000 });
const LX = await league({ periods: 4, period_ms: 600000, ot_ms: 300000 });   // rules never updated: the log must tell
const comp = async l => {
  const s = (await one(`insert into seasons (league_id) values ($1) returning id`, [l])).id;
  return (await one(`insert into competitions (season_id) values ($1) returning id`, [s])).id;
};
const CQ = await comp(LQ), CH = await comp(LH), CX = await comp(LX);
const H = (await one(`insert into teams (name) values ('Home U') returning id`)).id;
const A = (await one(`insert into teams (name) values ('Away St.') returning id`)).id;
const P = [];
for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) P.push((await one(`insert into players (first_name, last_name) values ('P', $1) returning id`, [n])).id);

const game = async (c, hoursAgo, status, hs, as, period, clockMs, feed, events) => {
  const id = (await one(`insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score, period, starters)
                         values ($1, $2, $3, now() - make_interval(hours => $4), $5, $6, $7, $8, $9) returning id`,
                        [c, H, A, hoursAgo, status, hs, as, period, JSON.stringify([P.slice(0, 5), []])])).id;
  await q(`insert into game_state (game_id, period, clock_ms, score_home, score_away, updated_at) values ($1,$2,$3,$4,$5, now() - interval '2 minutes')`,
          [id, period, clockMs, hs, as]);
  await q(`insert into external_games (game_id, external_status) values ($1, $2)`, [id, feed]);
  let seq = 0;
  for (const [t, team, pid, per, clock, payload] of events || [])
    await q(`insert into game_events (game_id, seq, t, team, pid, period, clock, payload) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, ++seq, t, team, pid, per, clock, JSON.stringify(payload || {})]);
  return id;
};

console.log('-- which games are played in halves');
const halvesLog = [['period_start', null, null, 1, 1200000], ['p2_made', 0, P[0], 1, 1150000], ['sub', 0, null, 1, 600000, { in: P[5], out: P[4] }],
                   ['p3_made', 0, P[1], 1, 300000]];
const quartersLog = [['period_start', null, null, 1, 600000], ['p2_made', 0, P[0], 1, 550000], ['period_start', null, null, 2, 600000],
                     ['p2_made', 0, P[0], 2, 100000]];
const gq = await game(CQ, 1, 'live', 4, 0, 2, 0, 'live', quartersLog);
const gh = await game(CH, 1, 'live', 5, 0, 1, 0, 'live', halvesLog);
const gx = await game(CX, 1, 'live', 5, 0, 1, 0, 'live', halvesLog);
const inHalves = async (g, l) => (await one(`select public.game_in_halves($1, (select rules from leagues where id = $2)) h`, [g, l])).h;
ok('a quarters league, a quarters log: quarters', (await inHalves(gq, LQ)) === false);
ok('a league whose rules say two periods: halves', (await inHalves(gh, LH)) === true);
ok('a league still on the default rules, but the log starts the first period at 20:00: halves', (await inHalves(gx, LX)) === true);
ok('the halves index holds only the first ten minutes of games in halves',
   (await one(`select count(*)::int n from game_events where period <= 2 and clock > 600000`)).n === 4);

console.log('-- the first half\'s lines');
const fhRows = async g => Object.fromEntries((await q(`select player_id, stats from notif_first_half($1)`, [g])).map(r => [r.player_id, r.stats]));
const hRows = await fhRows(gx);
ok('a starter who played the whole half has 20 minutes (one 20-minute period, not two of ten)',
   +hRows[P[0]].min === 1200000, hRows[P[0]] && hRows[P[0]].min);
ok('the one subbed off at 10:00 of the half has 10, the one who came on has 10',
   +hRows[P[4]].min === 600000 && +hRows[P[5]].min === 600000, [hRows[P[4]] && hRows[P[4]].min, hRows[P[5]] && hRows[P[5]].min]);
ok('...and every point of the half is in it', +hRows[P[0]].pts === 2 && +hRows[P[1]].pts === 3);
const qRows = await fhRows(gq);
ok('a quarters game as before: two quarters, 20 minutes, both baskets', +qRows[P[0]].min === 1200000 && +qRows[P[0]].pts === 4, qRows[P[0]]);

console.log('-- the half-time notice');
await q(`insert into notify_audience (sub, user_id, want_results, want_players, want_halftime, fav_team_ids, fav_game_ids, fav_player_ids)
         values ('u1', gen_random_uuid(), true, false, true, array[$1::uuid], '{}', '{}')`, [H]);
const sent = async g => (await one(`select count(*)::int n from notifications where game_id = $1 and kind = 'halftime'`, [g])).n;
await q(`select public.notify_halftime($1)`, [gx]);
ok('a game in halves at the end of its FIRST half gets the half-time notice', (await sent(gx)) === 1);
ok('...whose data names the first period as the one at the break',
   (await one(`select data ->> 'period' p from notifications where game_id = $1`, [gx])).p === '1');
const endH = await game(CH, 1, 'live', 70, 60, 2, 0, 'live', [...halvesLog, ['period_start', null, null, 2, 1200000],
  ['p2_made', 0, P[0], 2, 500000]]);
await q(`select public.notify_halftime($1)`, [endH]);
ok('...and none at the end of its SECOND half (that is full time, or overtime)', (await sent(endH)) === 0);
await q(`select public.notify_halftime($1)`, [gq]);
ok('a quarters game at the end of its second quarter: the notice, as before', (await sent(gq)) === 1);
ok('...with period 2 in its data, as before', (await one(`select data ->> 'period' p from notifications where game_id = $1`, [gq])).p === '2');

console.log('-- a game stuck live, in halves');
const stuckH = await game(CH, 30, 'live', 71, 64, 2, 0, 'live', [['period_start', null, null, 1, 1200000], ['period_start', null, null, 2, 1200000]]);
const stuckQ = await game(CQ, 30, 'live', 40, 38, 2, 0, 'live', [['period_start', null, null, 1, 600000], ['period_start', null, null, 2, 600000]]);
const stuckHalf = await game(CH, 30, 'live', 40, 38, 1, 0, 'live', [['period_start', null, null, 1, 1200000]]);
const res = Object.fromEntries((await q(`select * from close_stuck_games(24, $1)`, [[stuckH, stuckQ, stuckHalf]])).map(r => [r.game_id, r]));
ok('a game in halves whose second half ended (71-64) is FINAL on its score', res[stuckH] && res[stuckH].verdict === 'final', res[stuckH]);
ok('a quarters game stopped at the end of its second quarter is still VOID', res[stuckQ] && res[stuckQ].verdict === 'void', res[stuckQ]);
ok('a game in halves stopped at half-time is VOID', res[stuckHalf] && res[stuckHalf].verdict === 'void', res[stuckHalf]);

console.log('-- the indexes');
const idx = (await q(`select indexname from pg_indexes where schemaname = 'public'`)).map(r => r.indexname);
for (const n of ['games_competition_tipoff', 'external_games_open_code_tipoff', 'competition_teams_team', 'standings_team', 'game_events_halves'])
  ok(n + ' exists', idx.includes(n), idx);
await db.exec(mig('0206_ncaa_halves_and_scale.sql'));
ok('0206 applies twice (every statement idempotent)', true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
