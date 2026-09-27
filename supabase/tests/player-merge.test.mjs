// 0183: merging two profiles of one person (platform_player_merge_preview / platform_player_merge), on a real Postgres (PGlite; skipped with a
// note when it is not installed - PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). The migration is loaded on the minimum
// schema it reads, including the append-only event log's own trigger, so what is held here is the interesting part: that a merge moves
// everything that named the merged-away profile, that the event log stays append-only for everybody else, and that every case which would
// be a mistake (one person cannot play both sides of a game) is refused.
//
//   node supabase/tests/player-merge.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;
  create function public.link_require_admin() returns void language plpgsql stable as $$
  begin if not public.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if; end $$;
  create table public.audit_log (id bigserial primary key, actor uuid, action text, subject text, subject_id text, detail jsonb, created_at timestamptz default now());
  create table public.players (id uuid primary key default gen_random_uuid(), slug text unique, first_name text not null, last_name text default '', birth_year int,
    is_minor boolean default false, photo_media_id uuid, photo_url text, height_cm int, weight_kg int, wingspan_cm int, previous_club text,
    aliases text[] not null default '{}', external_ids jsonb not null default '{}');
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid, status text not null default 'final', roster_snapshot jsonb, starters jsonb);
  create table public.player_game_stats (game_id uuid references public.games, player_id text, player_uuid uuid references public.players on delete set null, stats jsonb default '{}',
    primary key (game_id, player_id));
  create table public.game_events (id bigserial primary key, game_id uuid references public.games, seq int, t text, pid text, payload jsonb default '{}', unique (game_id, seq));
  create function public.forbid_event_mutation() returns trigger language plpgsql as $$ begin raise exception 'game_events is append-only (attempted %)', tg_op; end; $$;
  create trigger game_events_no_update before update on public.game_events for each row execute function public.forbid_event_mutation();
  create trigger game_events_no_delete before delete on public.game_events for each row execute function public.forbid_event_mutation();
  create table public.teams (id uuid primary key default gen_random_uuid(), name text);
  create table public.seasons (id uuid primary key default gen_random_uuid());
  create table public.roster_entries (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, player_id uuid not null references public.players on delete cascade,
    season_id uuid references public.seasons, jersey text, position text, active boolean default true);
  create table public.player_previous_clubs (id uuid primary key default gen_random_uuid(), player_id uuid not null references public.players on delete cascade, club_name text);
  create table public.player_suspensions (id uuid primary key default gen_random_uuid(), player_id uuid not null references public.players on delete cascade);
  create table public.season_awards (competition_id uuid, code text, player_id uuid references public.players on delete cascade, primary key (competition_id, code));
  create table public.season_award_overrides (competition_id uuid, code text, player_id uuid references public.players on delete cascade);
  create table public.membership_eligibility (id uuid primary key default gen_random_uuid(), source_id text, player_id uuid not null references public.players on delete cascade, unique (source_id, player_id));
  create table public.player_releases (team_id uuid, player_id uuid not null references public.players on delete cascade, primary key (team_id, player_id));
  create table public.toty_candidates (ballot_id uuid, player_id uuid not null references public.players on delete cascade, primary key (ballot_id, player_id));
  create table public.toty_results (ballot_id uuid, player_id uuid not null references public.players on delete cascade, primary key (ballot_id, player_id));
  create table public.toty_votes (ballot_id uuid, voter_key text, player_id uuid not null references public.players on delete cascade, unique (ballot_id, voter_key, player_id));
  create table public.media (id uuid primary key default gen_random_uuid(), owner_type text, owner_id uuid, storage_path text);
  create table public.player_groups (id uuid primary key default gen_random_uuid(), name text);
  create table public.player_group_members (player_id uuid primary key references public.players on delete cascade, group_id uuid not null references public.player_groups on delete cascade);
  create table public.fan_prefs (user_id uuid primary key default gen_random_uuid(), fav_player_ids uuid[] not null default '{}');
  create table public.fanvote_candidates (round_id uuid, kind text, subject_id uuid, primary key (round_id, kind, subject_id));
  create table public.highlight_jobs (id uuid primary key default gen_random_uuid(), player_id text);
  create table public.snapshots (key text primary key, competition_id uuid, token text);
`);
await db.exec(mig('0183_player_merge.sql'));

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const asAdmin = on => db.exec(`select set_config('test.admin', '${on ? 'on' : 'off'}', false); select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

/* ------------------------------------------------------------------------------------------------------ the data --- */
const KEEP = 'aaaaaaaa-0000-0000-0000-000000000001', OTHER = 'bbbbbbbb-0000-0000-0000-000000000002', THIRD = 'cccccccc-0000-0000-0000-000000000003', MATE = 'dddddddd-0000-0000-0000-000000000004';
const G1 = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002', G3 = '10000000-0000-0000-0000-000000000003', GLIVE = '10000000-0000-0000-0000-0000000000f1';
const C1 = '20000000-0000-0000-0000-000000000001', T1 = '30000000-0000-0000-0000-000000000001', S1 = '40000000-0000-0000-0000-000000000001';
const BALLOT = '50000000-0000-0000-0000-000000000001', ROUND = '60000000-0000-0000-0000-000000000001', GRP = '70000000-0000-0000-0000-000000000001';

async function seed() {
  await db.exec(`truncate public.players, public.games, public.teams, public.seasons, public.player_groups, public.fan_prefs, public.snapshots, public.audit_log, public.player_merges,
                 public.media, public.highlight_jobs, public.fanvote_candidates restart identity cascade`);
  await q(`insert into public.players (id, slug, first_name, last_name, birth_year, aliases, external_ids, photo_url) values
    ($1, 'max-mackinnon', 'Max', 'Mackinnon', null, '{"Maxi"}', '{"fiba_livestats":"BRI:7"}', null),
    ($2, 'm-mackinnon', 'M.', 'Mackinnon', 1998, '{}', '{"fiba_livestats":"NBL:23","other":"x"}', 'http://p/1.jpg'),
    ($3, 'mate', 'Team', 'Mate', null, '{}', '{}', null),
    ($4, 'sam-third', 'Sam', 'Third', null, '{}', '{}', null)`, [KEEP, OTHER, MATE, THIRD]);
  await q(`insert into public.games (id, competition_id, status, roster_snapshot, starters) values
    ($1, $5, 'final', jsonb_build_object('teams', jsonb_build_array(jsonb_build_object('players', jsonb_build_array(jsonb_build_object('id', $6::text, 'name', 'M. Mackinnon'), jsonb_build_object('id', $7::text, 'name', 'Team Mate'))))), jsonb_build_array(jsonb_build_array($6::text, $7::text), jsonb_build_array()) ),
    ($2, $5, 'final', jsonb_build_object('teams', jsonb_build_array(jsonb_build_object('players', jsonb_build_array(jsonb_build_object('id', $8::text, 'name', 'Max Mackinnon'))))), jsonb_build_array(jsonb_build_array($8::text), jsonb_build_array())),
    ($3, $5, 'final', null, null),
    ($4, $5, 'live', null, null)`, [G1, G2, G3, GLIVE, C1, OTHER, MATE, KEEP]);
  await q(`insert into public.player_game_stats (game_id, player_id, player_uuid) values ($1, 'P1', $3), ($2, 'P9', $4), ($1, 'P2', $5)`, [G1, G2, OTHER, KEEP, MATE]);
  await q(`insert into public.game_events (game_id, seq, t, pid, payload) values
    ($1, 1, 'p2_made', $3, '{}'), ($1, 2, 'sub', null, jsonb_build_object('in', $3::text, 'out', $5::text)), ($1, 3, 'foul', $5, jsonb_build_object('drawn', '0:P1')),
    ($2, 1, 'p3_made', $4, '{}')`, [G1, G2, OTHER, KEEP, MATE]);
  await q(`insert into public.teams (id, name) values ($1, 'Bullets')`, [T1]);
  await q(`insert into public.seasons (id) values ($1)`, [S1]);
  await q(`insert into public.roster_entries (team_id, player_id, season_id, jersey, active) values ($1, $2, $4, '7', true), ($1, $3, $4, '7', true), ($1, $2, null, '9', true)`, [T1, OTHER, KEEP, S1]);
  await q(`insert into public.season_awards (competition_id, code, player_id) values ($1, 'mvp', $2)`, [C1, OTHER]);
  await q(`insert into public.toty_candidates values ($1, $2), ($1, $3)`, [BALLOT, OTHER, KEEP]);
  await q(`insert into public.toty_votes values ($1, 'v1', $2), ($1, 'v1', $3), ($1, 'v2', $2)`, [BALLOT, OTHER, KEEP]);
  await q(`insert into public.media (owner_type, owner_id, storage_path) values ('player', $1, 'player/o/a.webp'), ('team', $1, 'team/x.webp')`, [OTHER]);
  await q(`insert into public.player_groups (id, name) values ($1, 'Mackinnon')`, [GRP]);
  await q(`insert into public.player_group_members values ($1, $3), ($2, $3)`, [OTHER, THIRD, GRP]);
  await q(`insert into public.fan_prefs (fav_player_ids) values (array[$1::uuid, $2::uuid]), (array[$1::uuid]), (array[$3::uuid])`, [OTHER, KEEP, MATE]);
  await q(`insert into public.fanvote_candidates values ($1, 'player', $2), ($1, 'player', $3), ($1, 'team', $2)`, [ROUND, OTHER, KEEP]);
  await q(`insert into public.highlight_jobs (player_id) values ($1), ($2)`, [OTHER, MATE]);
  await q(`insert into public.snapshots values ('stars_global', null, 't'), ('season:c1', $1, 't'), ('season:other', '99999999-0000-0000-0000-000000000009', 't')`, [C1]);
}
await asAdmin(true);
await seed();

console.log('-- the preview');
const pv = (await one(`select public.platform_player_merge_preview($1, $2) r`, [KEEP, OTHER])).r;
ok('it names both profiles and what would move', pv.keep.name === 'Max Mackinnon' && pv.other.name === 'M. Mackinnon' && pv.counts.games === 1 && pv.counts.events === 2 && pv.counts.rosters === 2 && pv.counts.photos === 1 && pv.counts.followers === 2, pv);
ok('...with nothing in the way here, and it writes nothing', pv.blockers.length === 0 && (await one(`select count(*)::int n from public.players`)).n === 4);
ok('it says when the birth years differ, but this pair has one missing so they do not', pv.birth_years_differ === false);

console.log('\n-- the merge');
const r = (await one(`select public.platform_player_merge($1, $2) r`, [KEEP, OTHER])).r;
ok('it says what it moved', r.kept === KEEP && r.merged === OTHER && r.games === 1 && r.events === 2 && r.followers === 2, r);
ok('the merged-away profile is gone', (await q(`select 1 from public.players where id = $1`, [OTHER])).length === 0);
ok('his games are the survivor\'s now', (await one(`select count(*)::int n from public.player_game_stats where player_uuid = $1`, [KEEP])).n === 2);
const ev = await q(`select seq, pid, payload from public.game_events where game_id = $1 order by seq`, [G1]);
ok('the event log names the survivor: his plays are his, and a substitution\'s payload too', ev[0].pid === KEEP && ev[1].payload.in === KEEP && ev[1].payload.out === MATE, ev);
ok('...and nobody else\'s play was touched', ev[2].pid === MATE && ev[2].payload.drawn === '0:P1');
ok('the game snapshots and starters name the survivor', JSON.stringify((await one(`select roster_snapshot, starters from public.games where id = $1`, [G1]))).includes(KEEP)
   && !JSON.stringify(await q(`select roster_snapshot::text a, starters::text b from public.games`)).includes(OTHER));
ok('the roster: a season he had under both profiles is one entry, the rest moved',
   (await one(`select count(*)::int n from public.roster_entries where player_id = $1`, [KEEP])).n === 2 && (await one(`select count(*)::int n from public.roster_entries where player_id = $1`, [OTHER])).n === 0);
ok('awards, photos (only the player\'s own), highlight jobs moved',
   (await one(`select count(*)::int n from public.season_awards where player_id = $1`, [KEEP])).n === 1
   && (await one(`select count(*)::int n from public.media where owner_type = 'player' and owner_id = $1`, [KEEP])).n === 1
   && (await one(`select count(*)::int n from public.media where owner_type = 'team' and owner_id = $1`, [OTHER])).n === 1
   && (await one(`select count(*)::int n from public.highlight_jobs where player_id = $1`, [KEEP])).n === 1);
ok('a vote or a nomination both had is not counted twice', (await one(`select count(*)::int n from public.toty_candidates where player_id = $1`, [KEEP])).n === 1
   && (await one(`select count(*)::int n from public.toty_votes where player_id = $1`, [KEEP])).n === 2);
ok('followers: the fans who followed either now follow one, once', JSON.stringify((await q(`select fav_player_ids from public.fan_prefs order by array_length(fav_player_ids,1) desc, fav_player_ids::text`)).map(x => x.fav_player_ids.length)) === '[1,1,1]'
   && (await q(`select 1 from public.fan_prefs where $1 = any (fav_player_ids)`, [OTHER])).length === 0);
ok('fan-vote candidates: the player\'s, once; a team\'s with the same id left alone', (await one(`select count(*)::int n from public.fanvote_candidates where kind = 'player' and subject_id = $1`, [KEEP])).n === 1
   && (await one(`select count(*)::int n from public.fanvote_candidates where kind = 'team'`)).n === 1);
ok('his link group goes with him to the survivor (who had none of his own)',
   JSON.stringify((await q(`select player_id from public.player_group_members where group_id = $1 order by player_id`, [GRP])).map(x => x.player_id)) === JSON.stringify([KEEP, THIRD]));
const kp = await one(`select * from public.players where id = $1`, [KEEP]);
ok('the survivor: blanks filled from the other (birth year, photo), his own name kept', kp.first_name === 'Max' && kp.birth_year === 1998 && kp.photo_url === 'http://p/1.jpg');
ok('...the other\'s name is an alias, his own name is not, and the old aliases stay', kp.aliases.includes('M. Mackinnon') && kp.aliases.includes('Maxi') && !kp.aliases.includes('Max Mackinnon'), kp.aliases);
ok('...both feed identities are kept, so the ingest still finds him by the other\'s and does not make the duplicate again',
   kp.external_ids.fiba_livestats === 'BRI:7' && kp.external_ids.other === 'x' && JSON.stringify(kp.external_ids.also) === '["NBL:23"]', kp.external_ids);
const m = await one(`select * from public.player_merges where old_id = $1`, [OTHER]);
ok('the old address is remembered: its id and slug lead to the survivor', m.into_id === KEEP && m.old_slug === 'm-mackinnon' && m.old_name === 'M. Mackinnon' && m.detail.row.first_name === 'M.', m);
ok('...and the whole deleted row is kept for recovery by hand', m.detail.row.external_ids.fiba_livestats === 'NBL:23');
ok('the merge is in the audit log', (await one(`select count(*)::int n from public.audit_log where action = 'player_merge' and subject_id = $1`, [KEEP])).n === 1);
ok('the published season snapshots for his competitions, and the stars, are dropped so they are rebuilt; others are left',
   JSON.stringify((await q(`select key from public.snapshots order by key`)).map(x => x.key)) === '["season:other"]');

console.log('\n-- the event log is append-only for everybody else');
ok('the switch does not outlast the merge', (await one(`select coalesce(current_setting('epinoia.player_merge', true), '') v`)).v !== 'on');
ok('a play cannot be rewritten', /append-only/.test(await fails(() => db.query(`update public.game_events set t = 'x' where game_id = $1`, [G1]))));
ok('...a pid alone cannot be changed outside a merge', /append-only/.test(await fails(() => db.query(`update public.game_events set pid = $2 where game_id = $1 and seq = 1`, [G1, MATE]))));
ok('...a play cannot be deleted', /append-only/.test(await fails(() => db.query(`delete from public.game_events where game_id = $1`, [G1]))));
ok('...and even with the switch on, only pid and payload may change (not the clock, not the kind of play)', await (async () => {
  await db.exec(`select set_config('epinoia.player_merge', 'on', false)`);
  const e = await fails(() => db.query(`update public.game_events set t = 'x' where game_id = $1 and seq = 1`, [G1]));
  await db.exec(`select set_config('epinoia.player_merge', 'off', false)`);
  return /append-only/.test(e || '');
})());

console.log('\n-- both in one link group');
await seed();
await q(`delete from public.player_group_members`);
await q(`insert into public.player_group_members values ($1, $3), ($2, $3)`, [OTHER, KEEP, GRP]);
await db.query(`select public.platform_player_merge($1, $2)`, [KEEP, OTHER]);
ok('a link group left with one member is not a link any more, and goes',
   (await q(`select 1 from public.player_groups where id = $1`, [GRP])).length === 0 && (await q(`select 1 from public.player_group_members`)).length === 0);

console.log('\n-- what it refuses');
await seed();
await q(`insert into public.player_game_stats (game_id, player_id, player_uuid) values ($1, 'P5', $2), ($1, 'P6', $3)`, [G3, KEEP, OTHER]);
let e = await fails(() => db.query(`select public.platform_player_merge($1, $2)`, [KEEP, OTHER]));
ok('two profiles that played in the same game are two people: refused, and nothing moved', /same game/.test(e || '') && (await one(`select count(*)::int n from public.player_game_stats where player_uuid = $1`, [OTHER])).n === 2, e);
ok('...the preview says so too', (await one(`select public.platform_player_merge_preview($1, $2) r`, [KEEP, OTHER])).r.blockers.some(b => /same game/.test(b)));
await seed();
await q(`insert into public.player_game_stats (game_id, player_id, player_uuid) values ($1, 'P5', $2)`, [GLIVE, OTHER]);
e = await fails(() => db.query(`select public.platform_player_merge($1, $2)`, [KEEP, OTHER]));
ok('a game that is not finished stops it', /not finished/.test(e || ''), e);
await seed();
await q(`update public.games set roster_snapshot = jsonb_build_object('id', $2::text), status = 'scheduled' where id = $1`, [G3, OTHER]);
e = await fails(() => db.query(`select public.platform_player_merge($1, $2)`, [KEEP, OTHER]));
ok('...and so does a game not yet played whose squad names one of them', /not been played/.test(e || ''), e);
await seed();
ok('the same profile twice is not a merge', /two different profiles/.test(await fails(() => db.query(`select public.platform_player_merge($1, $1)`, [KEEP])) || ''));
ok('a profile that is not there is not a merge', /not found/.test(await fails(() => db.query(`select public.platform_player_merge($1, $2)`, [KEEP, '99999999-9999-9999-9999-999999999999'])) || ''));
await asAdmin(false);
ok('anybody who is not a platform administrator is refused, the preview as well',
   /administrators only/.test(await fails(() => db.query(`select public.platform_player_merge($1, $2)`, [KEEP, OTHER])) || '')
   && /administrators only/.test(await fails(() => db.query(`select public.platform_player_merge_preview($1, $2)`, [KEEP, OTHER])) || ''));
ok('...and nothing has been touched', (await one(`select count(*)::int n from public.players`)).n === 4);

console.log('\n-- the migration\'s own text');
const sql = mig('0183_player_merge.sql');
ok('it can be applied twice (create or replace; the table and policy are guarded)', await (async () => { await asAdmin(true); return !(await fails(() => db.exec(sql))); })());
ok('the functions are for signed-in administrators only, never anon', /revoke all on function[^;]*from public, anon;/.test(sql) && /grant execute on function[^;]*to authenticated, service_role;/.test(sql));
ok('the redirect table is public to read and to nobody to write', /create policy player_merges_read on public\.player_merges for select to anon, authenticated using \(true\)/.test(sql) && /grant select on public\.player_merges to anon, authenticated;/.test(sql));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
