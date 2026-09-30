// 0190: the events splits (`sit`) live in a members' table the DATABASE gates.
// On a real Postgres (PGlite; skipped with a note when it is not installed - PGLITE_DIR=<its folder> or
// `npm i --no-save @electric-sql/pglite`). Loads 0190 on the minimum schema it reads, with the access
// functions stubbed to the answers 0117 gives (a master switch, a members-only analytics league).
//
//   node supabase/tests/premium-sit.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw !== undefined ? '  (saw ' + JSON.stringify(saw) + ')' : '')); } };
const mig = readFileSync(path.join(here, '..', 'migrations', '0190_premium_sit_gate.sql'), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'anon') $$;
  create table public.leagues (id uuid primary key, name text, mode text default 'members');   -- analytics mode: members | free
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions, status text default 'final');
  create table public.player_game_stats (game_id uuid not null references public.games on delete cascade, player_id text not null, team_idx int not null, stats jsonb not null, primary key (game_id, player_id));
  create table public.team_game_stats (game_id uuid not null references public.games on delete cascade, team_idx int not null, stats jsonb not null, primary key (game_id, team_idx));
  -- the access functions, stubbed to 0117's answers
  create table public.platform_settings (key text primary key, value jsonb not null default 'null'::jsonb);
  create table public.snapshots (key text primary key, data jsonb);
  create function public.memberships_enabled() returns boolean language sql stable as $$ select coalesce(current_setting('test.memberships', true), 'off') = 'on' $$;
  create function public.can_use_analytics(p_league uuid) returns boolean language sql stable as $$
    select case when (select mode from public.leagues where id = p_league) = 'free' then true
                else coalesce(current_setting('test.member', true), 'no') = 'yes' end $$;
  create function public.is_league_admin(p_league uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'no') = 'yes' $$;
  create function public.can_read_game_rows(p_game uuid) returns boolean language sql stable as $$ select exists (select 1 from public.games where id = p_game and status = 'final') $$;
  grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
  grant select on public.games, public.leagues, public.seasons, public.competitions to anon, authenticated;
  grant all on all tables in schema public to service_role;
`);
await db.exec(mig);

const L1 = '00000000-0000-0000-0000-0000000000a1';   // a members-only analytics league
const L2 = '00000000-0000-0000-0000-0000000000a2';   // a league whose analytics are free
const G1 = '00000000-0000-0000-0000-0000000000b1', G2 = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`
  insert into public.leagues values ('${L1}', 'Members', 'members'), ('${L2}', 'Free', 'free');
  insert into public.seasons (id, league_id) values ('00000000-0000-0000-0000-0000000000c1', '${L1}'), ('00000000-0000-0000-0000-0000000000c2', '${L2}');
  insert into public.competitions (id, season_id) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2');
  insert into public.games (id, competition_id) values ('${G1}', '00000000-0000-0000-0000-0000000000d1'), ('${G2}', '00000000-0000-0000-0000-0000000000d2');
`);
const q = async (sql, opts = {}) => {
  await db.exec(`set test.memberships = '${opts.memberships || 'off'}'; set test.member = '${opts.member || 'no'}'; set test.admin = '${opts.admin || 'no'}'; set test.role = '${opts.role || 'anon'}'; ${opts.role === 'service_role' ? 'set role service_role;' : opts.asRole ? 'set role ' + opts.asRole + ';' : ''}`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};

console.log('\nthe trigger files a written `sit` in the members\' table and takes it out of `stats`');
await db.exec(`
  insert into public.player_game_stats values ('${G1}', 'p1', 0, '{"pts": 10, "sit": {"v":1,"second":[2,1]}}');
  insert into public.team_game_stats values ('${G1}', 0, '{"pts": 80, "sit": {"v":1,"all":[80]}}');
  insert into public.player_game_stats values ('${G2}', 'p9', 1, '{"pts": 4, "sit": {"v":1,"half":[4]}}');
`);
ok('a player row no longer carries sit', (await q(`select stats ? 'sit' as has from public.player_game_stats where player_id = 'p1'`, { role: 'service_role' }))[0].has === false);
ok('...and its other keys are untouched', (await q(`select stats->>'pts' as pts from public.player_game_stats where player_id = 'p1'`, { role: 'service_role' }))[0].pts === '10');
ok('a team row no longer carries sit', (await q(`select stats ? 'sit' as has from public.team_game_stats where game_id = '${G1}'`, { role: 'service_role' }))[0].has === false);
ok('the lines are in the table (1 team + 2 players)', (await q(`select count(*)::int as n from public.game_sit_lines`, { role: 'service_role' }))[0].n === 3);
await db.exec(`update public.player_game_stats set stats = '{"pts": 12, "sit": {"v":1,"second":[9,9]}}' where player_id = 'p1'`);
ok('a rewrite updates the line', (await q(`select sit->'second'->>0 as v from public.game_sit_lines where player_id = 'p1'`, { role: 'service_role' }))[0].v === '9');
await db.exec(`update public.player_game_stats set stats = '{"pts": 13}' where player_id = 'p1'`);
ok('a write with no sit leaves the line alone', (await q(`select count(*)::int as n from public.game_sit_lines where player_id = 'p1'`, { role: 'service_role' }))[0].n === 1);

console.log('\nwho can read the lines');
ok('memberships OFF: a signed-out reader reads every line (nothing is locked yet)', (await q(`select count(*)::int as n from public.game_sit_lines`, { asRole: 'anon' }))[0].n === 3);
ok('memberships ON, no membership: a signed-out reader reads none of the members\' league', (await q(`select count(*)::int as n from public.game_sit_lines where game_id = '${G1}'`, { memberships: 'on', asRole: 'anon' }))[0].n === 0);
ok('memberships ON: a league whose analytics are free is still open', (await q(`select count(*)::int as n from public.game_sit_lines where game_id = '${G2}'`, { memberships: 'on', asRole: 'anon' }))[0].n === 1);
ok('memberships ON + a member: the lines come back', (await q(`select count(*)::int as n from public.game_sit_lines where game_id = '${G1}'`, { memberships: 'on', member: 'yes', asRole: 'authenticated' }))[0].n === 2);
ok('memberships ON + a league administrator: the lines come back', (await q(`select count(*)::int as n from public.game_sit_lines where game_id = '${G1}'`, { memberships: 'on', admin: 'yes', asRole: 'authenticated' }))[0].n === 2);
ok('the service role always reads them', (await q(`select count(*)::int as n from public.game_sit_lines`, { memberships: 'on', role: 'service_role' }))[0].n === 3);
await db.exec(`update public.games set status = 'scheduled' where id = '${G2}'`);
ok('a game that is not readable at all has no readable lines either', (await q(`select count(*)::int as n from public.game_sit_lines where game_id = '${G2}'`, { asRole: 'anon' }))[0].n === 0);
await db.exec(`update public.games set status = 'final' where id = '${G2}'`);

console.log('\nno writes from outside');
let denied = false; try { await q(`insert into public.game_sit_lines values ('${G1}', 'p', 0, 'x', '{}')`, { asRole: 'anon' }); } catch (e) { denied = true; }
ok('a signed-out caller cannot write a line', denied);
denied = false; try { await q(`select public.premium_sit_move(10)`, { asRole: 'anon' }); } catch (e) { denied = true; }
ok('nor run the mover', denied);
denied = false; try { await q(`select public.premium_sit_remaining()`, { asRole: 'authenticated' }); } catch (e) { denied = true; }
ok('nor read how many are left', denied);

console.log('\nthe mover takes rows written before the trigger existed, in batches');
await db.exec(`
  alter table public.player_game_stats disable trigger pgs_sit_split;
  alter table public.team_game_stats disable trigger tgs_sit_split;
  insert into public.player_game_stats select '${G1}', 'old' || i, 0, jsonb_build_object('pts', i, 'sit', jsonb_build_object('v', 1, 'all', jsonb_build_array(i))) from generate_series(1, 25) i;
  insert into public.team_game_stats values ('${G2}', 0, '{"pts": 70, "sit": {"v":1,"all":[70]}}');
  alter table public.player_game_stats enable trigger pgs_sit_split;
  alter table public.team_game_stats enable trigger tgs_sit_split;
`);
ok('26 rows still carry an open sit', (await q(`select public.premium_sit_remaining() as n`, { role: 'service_role' }))[0].n === 26);
let moved = 0, rounds = 0;
while (rounds < 10) { const n = (await q(`select public.premium_sit_move(10) as n`, { role: 'service_role' }))[0].n; if (!n) break; moved += n; rounds++; }
ok('moved in batches of 10 (26 rows: 3 rounds)', moved === 26 && rounds === 3, { moved, rounds });
ok('nothing is left open', (await q(`select public.premium_sit_remaining() as n`, { role: 'service_role' }))[0].n === 0);
ok('the moved lines are all in the table (3 + 26 = 29 lines... plus the trigger ones)', (await q(`select count(*)::int as n from public.game_sit_lines`, { role: 'service_role' }))[0].n === 29, (await q(`select count(*)::int as n from public.game_sit_lines`, { role: 'service_role' }))[0].n);
ok('a moved row kept its other stats', (await q(`select stats->>'pts' as pts from public.player_game_stats where player_id = 'old7'`, { role: 'service_role' }))[0].pts === '7');
ok('and the moved line has the value', (await q(`select sit->'all'->>0 as v from public.game_sit_lines where player_id = 'old7'`, { role: 'service_role' }))[0].v === '7');

console.log('\nthe public season snapshots built while it was free are dropped when the switch changes');
await db.exec(`insert into public.platform_settings values ('memberships_enabled', 'false'::jsonb); insert into public.snapshots values ('season:abc', '{}'), ('stars_global', '{}');`);
await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'memberships_enabled'`);
ok('flipping memberships_enabled drops the season snapshots', (await q(`select count(*)::int as n from public.snapshots where key like 'season:%'`, { role: 'service_role' }))[0].n === 0);
ok('...and leaves the rest', (await q(`select count(*)::int as n from public.snapshots where key = 'stars_global'`, { role: 'service_role' }))[0].n === 1);
await db.exec(`insert into public.snapshots values ('season:def', '{}'); update public.platform_settings set value = 'true'::jsonb where key = 'memberships_enabled'`);
ok('a write that changes nothing drops nothing', (await q(`select count(*)::int as n from public.snapshots where key = 'season:def'`, { role: 'service_role' }))[0].n === 1);
ok('the manual purge works for the service role only', (await q(`select public.premium_snapshots_purge() as n`, { role: 'service_role' }))[0].n === 1);
denied = false; try { await q(`select public.premium_snapshots_purge()`, { asRole: 'authenticated' }); } catch (e) { denied = true; }
ok('and not for a signed-in visitor', denied);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
