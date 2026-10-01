// WHAT WINS 2 — THE GATE (migration 0209_what_wins.sql; docs/what-wins-model.md §5, §10, A.2) on a real Postgres
// (PGlite; skipped with a note when it is not installed). The migration is loaded on stand-ins for what it calls, as
// front-office.test.mjs does: auth.uid(), storage.buckets / storage.objects, platform_settings, the leagues chain, and
// 0117's memberships_enabled / can_use_analytics / can_view_league / is_league_admin / access_analytics_configured,
// each answering from a test table. What is held here:
//   * game_features, analytics_files, analytics_issue_log (and analytics_refresh) are shut to anon and authenticated,
//     with RLS on and no policy; the bucket is private and no storage policy names it (I2, I3);
//   * analytics_check answers ok / members / league / scope / signin exactly as §5 says, with 'pos' checked as 'club';
//   * analytics_take lets 60 signed-in and 20 signed-out calls an hour through, refuses the next with retry_after > 0,
//     and the day's limit too; prune deletes what is older than its days;
//   * game_features_missing lists the final games without two rows of the layout; analytics_open_leagues the open set;
//   * RECALCULATE: one refresh per unit per ten minutes (a second press is told to join), a per-subject limit, `due`;
//   * the file has no RAISE with a % placeholder.
//
//   node supabase/tests/ww-gate.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const MIG = readdirSync(path.join(here, '..', 'migrations')).find(f => /^\d{4}_what_wins\.sql$/.test(f));
const sql = readFileSync(path.join(here, '..', 'migrations', MIG), 'utf8');

const ADMIN = '11111111-1111-1111-1111-111111111111', MEMBER = '22222222-2222-2222-2222-222222222222', FAN = '33333333-3333-3333-3333-333333333333';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, allowed_mime_types text[], file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create policy crests_read on storage.objects for select using (bucket_id = 'crests');
  create table public.platform_settings (key text primary key, value jsonb);
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, visibility text not null default 'public',
    access_mode text not null default 'open', analytics_access text);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, name text);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.teams (id uuid primary key default gen_random_uuid(), name text);
  create table public.games (id uuid primary key default gen_random_uuid(), status text, competition_id uuid references public.competitions,
    home_team_id uuid references public.teams, away_team_id uuid references public.teams, finalised_at timestamptz);
  create table public.test_switch (on_ boolean);
  insert into public.test_switch values (false);
  create table public.test_members (league_id uuid, user_id uuid);
  create table public.test_admins (league_id uuid, user_id uuid);
  create function public.memberships_enabled() returns boolean language sql stable as $$ select coalesce((select on_ from test_switch limit 1), false) $$;
  create function public.access_analytics_configured(p uuid) returns text language sql stable as $$
    select coalesce((select analytics_access from leagues where id = p and analytics_access in ('free', 'members')), 'free') $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$
    select exists (select 1 from test_admins where league_id = p and user_id = auth.uid()) $$;
  create function public.can_use_analytics(p uuid) returns boolean language sql stable as $$
    select case when not public.memberships_enabled() then true
                when p is null then exists (select 1 from test_members where league_id is null and user_id = auth.uid())
                when public.access_analytics_configured(p) = 'free' then true
                else exists (select 1 from test_members where league_id = p and user_id = auth.uid()) end $$;
  create function public.can_view_league(p uuid) returns boolean language sql stable as $$
    select coalesce((select visibility = 'public' or public.is_league_admin(p) from leagues where id = p), false) $$;
`);
const q = async (s, params) => (await db.query(s, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const one = async (s, params) => (await q(s, params))[0];

const [lg] = await q(`insert into leagues (slug) values ('open') returning id`);
const [priv] = await q(`insert into leagues (slug, visibility) values ('private', 'private') returning id`);
const [paid] = await q(`insert into leagues (slug, access_mode, analytics_access) values ('paid', 'members', 'members') returning id`);
const [s1] = await q(`insert into seasons (league_id, name) values ($1, '2026') returning id`, [lg.id]);
const [sPaid] = await q(`insert into seasons (league_id, name) values ($1, '2026') returning id`, [paid.id]);
const [sPriv] = await q(`insert into seasons (league_id, name) values ($1, '2026') returning id`, [priv.id]);
const [c1] = await q(`insert into competitions (season_id) values ($1) returning id`, [s1.id]);
const [cPaid] = await q(`insert into competitions (season_id) values ($1) returning id`, [sPaid.id]);
const [home] = await q(`insert into teams (name) values ('Home') returning id`);
const [away] = await q(`insert into teams (name) values ('Away') returning id`);
const [stranger] = await q(`insert into teams (name) values ('Elsewhere') returning id`);
const games = [];
for (let k = 0; k < 3; k++) games.push((await one(`insert into games (status, competition_id, home_team_id, away_team_id, finalised_at)
  values ('final', $1, $2, $3, now() - make_interval(hours => $4)) returning id`, [c1.id, home.id, away.id, 10 - k])).id);
const [live] = await q(`insert into games (status, competition_id, home_team_id, away_team_id) values ('live', $1, $2, $3) returning id`, [c1.id, home.id, away.id]);
await q(`insert into games (status, competition_id, home_team_id, away_team_id, finalised_at) values ('final', $1, $2, $3, now()) returning id`, [cPaid.id, home.id, stranger.id]);

await db.exec(sql);
ok('the migration loads on a fresh Postgres (' + MIG + ')', true);

console.log('\nshut tables, a private bucket');
const priv_ = async (role, tbl, p) => (await one(`select has_table_privilege('${role}', '${tbl}', '${p}') as ok`)).ok;
for (const t of ['public.game_features', 'public.analytics_files', 'public.analytics_issue_log', 'public.analytics_refresh']) {
  ok(t + ': anon and authenticated can neither read nor write it', !(await priv_('anon', t, 'select')) && !(await priv_('authenticated', t, 'select')) &&
     !(await priv_('anon', t, 'insert')) && !(await priv_('authenticated', t, 'update')));
  ok('...the service role can', await priv_('service_role', t, 'select') && await priv_('service_role', t, 'insert'));
  const name = t.split('.')[1];
  ok('...RLS is on and no policy opens it', (await one(`select relrowsecurity from pg_class where relname = $1`, [name])).relrowsecurity === true &&
     (await one(`select count(*)::int as n from pg_policies where tablename = $1`, [name])).n === 0);
}
ok('the issue log\'s sequence is the service role\'s only', (await one(`select has_sequence_privilege('service_role', 'public.analytics_issue_log_id_seq', 'usage') as a,
   has_sequence_privilege('anon', 'public.analytics_issue_log_id_seq', 'usage') as b`)).a === true &&
   (await one(`select has_sequence_privilege('authenticated', 'public.analytics_issue_log_id_seq', 'usage') as b`)).b === false);
const bucket = await one(`select * from storage.buckets where id = 'analytics'`);
ok('the analytics bucket exists, private, JSON only, 100 MB', bucket && bucket.public === false && bucket.allowed_mime_types.join() === 'application/json' && +bucket.file_size_limit === 104857600, bucket);
await db.exec(`update storage.buckets set public = true where id = 'analytics'`);
await db.exec(sql);
ok('...and running the migration again puts it back to private', (await one(`select public from storage.buckets where id = 'analytics'`)).public === false);
ok('no storage policy names the analytics bucket', (await one(`select count(*)::int as n from pg_policies where schemaname = 'storage'
   and (coalesce(qual, '') ilike '%analytics%' or coalesce(with_check, '') ilike '%analytics%' or policyname ilike '%analytics%')`)).n === 0);
ok('the feature line carries the stints column (A.1)', (await one(`select count(*)::int as n from information_schema.columns where table_name = 'game_features' and column_name = 'st'`)).n === 1);

console.log('\nwho may call what');
const fx = async (role, fn) => (await one(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok;
ok('analytics_check: the signed-out and the signed-in (it runs with the caller\'s token)',
   await fx('anon', 'public.analytics_check(text, uuid, uuid, uuid)') && await fx('authenticated', 'public.analytics_check(text, uuid, uuid, uuid)'));
ok('analytics_signin_required: anybody', await fx('anon', 'public.analytics_signin_required()'));
for (const f of ['public.analytics_take(text, boolean, text, text)', 'public.analytics_issue_prune(integer)', 'public.analytics_open_leagues()',
                 'public.game_features_missing(integer, integer)', 'public.analytics_refresh_take(text, uuid, uuid)', 'public.analytics_refresh_done(uuid, uuid, text)'])
  ok(f.replace(/\(.*/, '') + ': the service role only', !(await fx('anon', f)) && !(await fx('authenticated', f)) && await fx('service_role', f));

console.log('\nanalytics_check');
const check = async (scope, league, season, team) => (await one(`select public.analytics_check($1, $2, $3, $4) as r`, [scope, league, season, team])).r;
await as('');
ok('memberships off: anybody gets a league\'s wins and fo', await check('wins', lg.id, s1.id, null) === 'ok' && await check('fo', lg.id, null, null) === 'ok');
ok('...and the pooled wins file', await check('wins', null, null, null) === 'ok');
ok('the pooled file is wins only, with no season or team', await check('fo', null, null, null) === 'scope' && await check('wins', null, s1.id, null) === 'scope'
   && await check('wins', null, null, home.id) === 'scope');
ok('an unknown scope is refused', await check('store', lg.id, null, null) === 'scope' && await check(null, lg.id, null, null) === 'scope');
ok('a club file needs a team, one that played in the league', await check('club', lg.id, s1.id, null) === 'scope' &&
   await check('club', lg.id, s1.id, stranger.id) === 'league' && await check('club', lg.id, s1.id, home.id) === 'ok');
ok('...and a pos file (A.1) is checked as a club file', await check('pos', lg.id, s1.id, away.id) === 'ok' && await check('pos', lg.id, s1.id, null) === 'scope'
   && await check('pos', lg.id, null, stranger.id) === 'league');
ok('a season of another league is refused', await check('wins', lg.id, sPaid.id, null) === 'league');
ok('a private league is refused to somebody who cannot see it', await check('wins', priv.id, sPriv.id, null) === 'league');
await q(`insert into test_admins values ($1, $2)`, [priv.id, ADMIN]);
await as(ADMIN);
ok('...and answered for its administrator', await check('wins', priv.id, sPriv.id, null) === 'ok');
await db.exec(`update test_switch set on_ = true`);
await as(FAN);
ok('memberships on: a members-only league\'s model is refused to a fan', await check('wins', paid.id, sPaid.id, null) === 'members');
ok('...a free league\'s is not', await check('wins', lg.id, s1.id, null) === 'ok');
await q(`insert into test_members values ($1, $2)`, [paid.id, MEMBER]);
await as(MEMBER);
ok('...a member of the league gets it', await check('fo', paid.id, sPaid.id, null) === 'ok');
await q(`insert into test_admins values ($1, $2)`, [paid.id, ADMIN]);
await as(ADMIN);
ok('...and so does its administrator', await check('wins', paid.id, null, null) === 'ok');
await as(FAN);
ok('the pooled file needs the platform analytics plan once memberships are on', await check('wins', null, null, null) === 'members');
await q(`insert into test_members values (null, $1)`, [FAN]);
ok('...and is answered once the fan has it', await check('wins', null, null, null) === 'ok');
await db.exec(`update test_switch set on_ = false`);
await q(`insert into platform_settings values ('analytics_signin', 'true'::jsonb)`);
await as('');
ok('analytics_signin = true: the signed-out are asked to sign in, even while memberships are off', await check('wins', lg.id, s1.id, null) === 'signin');
await as(FAN);
ok('...and the signed-in are answered', await check('wins', lg.id, s1.id, null) === 'ok');
await q(`update platform_settings set value = 'false'::jsonb where key = 'analytics_signin'`);
await as('');
ok('...and false is the same as unset', await check('wins', lg.id, s1.id, null) === 'ok');

console.log('\nthe rate limit');
const take = async (subject, signed) => (await one(`select public.analytics_take($1, $2, 'wins', 'x') as r`, [subject, signed])).r;
let r, allowed = 0;
for (let k = 0; k < 60; k++) { r = await take('u:' + MEMBER, true); if (r.ok) allowed++; }
ok('60 signed-in calls in an hour go through', allowed === 60 && r.used_hour === 60 && r.limit_hour === 60, r);
r = await take('u:' + MEMBER, true);
ok('...the 61st is refused, with retry_after > 0', r.ok === false && r.retry_after > 0 && r.retry_after <= 3600 && r.used_hour === 60, r);
allowed = 0;
for (let k = 0; k < 20; k++) { r = await take('ip:abc', false); if (r.ok) allowed++; }
r = await take('ip:abc', false);
ok('20 signed-out calls go through, the 21st is refused with retry_after > 0', allowed === 20 && r.ok === false && r.retry_after > 0 && r.limit_hour === 20, r);
ok('...a refused call is not logged', (await one(`select count(*)::int as n from analytics_issue_log where subject = 'ip:abc'`)).n === 20);
ok('...and another subject is untouched', (await take('ip:other', false)).ok === true);
await q(`insert into analytics_issue_log (subject, scope, at) select 'ip:day', 'wins', now() - interval '3 hours' from generate_series(1, 100)`);
r = await take('ip:day', false);
ok('100 signed-out calls in a day (none this hour) is the day\'s limit, retry_after under a day', r.ok === false && r.used_hour === 0 && r.used_day === 100 && r.retry_after > 3600 && r.retry_after <= 86400, r);

console.log('\npruning');
await q(`insert into analytics_issue_log (subject, scope, at) select 'ip:old', 'wins', now() - interval '40 days' from generate_series(1, 7)`);
const before = (await one(`select count(*)::int as n from analytics_issue_log`)).n;
ok('analytics_issue_prune(30) deletes the seven rows older than 30 days and nothing else', (await one(`select public.analytics_issue_prune(30) as n`)).n === 7 &&
   (await one(`select count(*)::int as n from analytics_issue_log`)).n === before - 7);
ok('...and a silly argument is floored at one day', (await one(`select public.analytics_issue_prune(-5) as n`)).n === 0);

console.log('\nthe backfill\'s list and the open set');
let miss = (await q(`select public.game_features_missing(1, 500) as id`)).map(x => x.id);
ok('every final game in a competition without its two rows is listed, oldest final first; not the live one', miss.length === 4 && miss[0] === games[0] && !miss.includes(live.id), miss);
await q(`insert into game_features (game_id, team_idx, fv, f, q, league_id, season_id, competition_id, finalised_at)
  select $1, t, 1, array[1,2,3]::real[], 0, $2, $3, $4, now() from generate_series(0, 1) t`, [games[0], lg.id, s1.id, c1.id]);
await q(`insert into game_features (game_id, team_idx, fv, f, q, league_id, season_id, competition_id, finalised_at) values ($1, 0, 1, '{1}', 0, $2, $3, $4, now())`,
  [games[1], lg.id, s1.id, c1.id]);
miss = (await q(`select public.game_features_missing(1, 500) as id`)).map(x => x.id);
ok('...a game with both rows leaves the list; one with one row stays', !miss.includes(games[0]) && miss.includes(games[1]) && miss.length === 3, miss);
ok('...a new layout (fv 2) lists every game again', (await q(`select public.game_features_missing(2, 500) as id`)).length === 4);
ok('...and the limit is honoured', (await q(`select public.game_features_missing(1, 1) as id`)).length === 1);
const open = (await q(`select public.analytics_open_leagues() as id`)).map(x => x.id);
ok('the open set: public, open and free; not the private league, not the members-only one', open.includes(lg.id) && !open.includes(priv.id) && !open.includes(paid.id), open);
ok('deleting a game takes its feature rows with it', await (async () => { await q(`delete from games where id = $1`, [games[0]]);
  return (await one(`select count(*)::int as n from game_features where game_id = $1`, [games[0]])).n === 0; })());

console.log('\nRECALCULATE (A.2)');
const rtake = async subject => (await one(`select public.analytics_refresh_take($1, $2, $3) as r`, [subject, lg.id, s1.id])).r;
r = await rtake('u:' + MEMBER);
ok('the first press starts the unit\'s refresh', r.ok === true, r);
r = await rtake('u:' + FAN);
ok('a second press while it runs is told to join it', r.ok === false && r.state === 'running', r);
await q(`select public.analytics_refresh_done($1, $2, 'done')`, [lg.id, s1.id]);
r = await rtake('u:' + FAN);
ok('once done, nobody refreshes the unit again for ten minutes (retry_after)', r.ok === false && r.state === 'recent' && r.retry_after > 0 && r.retry_after <= 600, r);
await q(`update analytics_refresh set started_at = now() - interval '11 minutes'`);
ok('...after ten minutes it may run again', (await rtake('u:' + FAN)).ok === true);
await q(`select public.analytics_refresh_done($1, $2, 'queued')`, [lg.id, s1.id]);
ok('a refresh left for the scheduled build marks the unit due', (await one(`select due, status from analytics_refresh`)).due === true);
await q(`insert into analytics_issue_log (subject, scope, at) select 'u:busy', 'refresh', now() - interval '5 minutes' from generate_series(1, 6)`);
await q(`update analytics_refresh set started_at = now() - interval '11 minutes'`);
r = await rtake('u:busy');
ok('a subject with six refreshes this hour is refused with retry_after', r.ok === false && r.state === 'rate' && r.retry_after > 0, r);
ok('refreshes do not use up the file allowance (analytics_take counts files only)', (await take('u:busy', true)).used_hour === 1);
await q(`update analytics_refresh set started_at = now() - interval '11 minutes', finished_at = null`);
ok('a refresh that died without saying so is taken over after its ten minutes', (await rtake('u:' + MEMBER)).ok === true);

console.log('\nthe file itself');
const raises = [...sql.matchAll(/\braise\b[^;]*;/gi)].map(m => m[0]);
ok('no RAISE with a % placeholder (no RAISE at all)', !raises.some(x => /%/.test(x)), raises);
ok('every function is security definer with search_path = public', [...sql.matchAll(/create or replace function[\s\S]*?\$\$/gi)].every(m => /security definer set search_path = public/.test(m[0])));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
