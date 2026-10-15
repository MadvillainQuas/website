// 0265 (the Transfer matrix, members only in fact) on a real Postgres (PGlite; skipped with a note when it is not
// installed - PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). 0211, 0213 and 0222 are loaded first, on
// stand-ins for what they read (as ww-gate.test.mjs and access-gates.test.mjs do: 0117's access answers as test settings),
// then 0265, twice. What is held here:
//   * analytics_check: 'transfer' and 'tscale' never to a signed-out caller (memberships on or off, the section free or
//     not), to a signed-in one as the 'transferMatrix' gate says, never with a league, season or team;
//   * every other scope answers exactly as 0222 made it answer, over a grid of scopes, ids and callers;
//   * the index takes the two scopes (and still refuses one nobody named); the bucket takes gzip and stays private; the
//     section's row is seeded; anon and authenticated still cannot read the index.
//
//   node supabase/tests/transfer-gate.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };
const mig = f => readFileSync(path.join(here, '..', 'migrations', f), 'utf8').replace(/^notify .*$/mg, '');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, allowed_mime_types text[], file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create table public.platform_settings (key text primary key, value jsonb not null default 'null'::jsonb, is_public boolean not null default false,
    updated_at timestamptz not null default now(), updated_by uuid);
  create table public.audit_log (id bigserial primary key, actor uuid, action text, subject text, subject_id text, detail jsonb);
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, visibility text not null default 'public',
    access_mode text not null default 'open', analytics_access text);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, name text);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.teams (id uuid primary key default gen_random_uuid(), name text);
  create table public.games (id uuid primary key default gen_random_uuid(), status text, competition_id uuid references public.competitions,
    home_team_id uuid references public.teams, away_team_id uuid references public.teams, finalised_at timestamptz);
  -- 0117's answers, as settings: the master switch, the caller a member, a league administrator, the caller's features
  create function public.memberships_enabled() returns boolean language sql stable as $$ select coalesce(current_setting('test.memberships', true), 'on') = 'on' $$;
  create function public.access_analytics_configured(p uuid) returns text language sql stable as $$
    select coalesce((select analytics_access from leagues where id = p and analytics_access in ('free', 'members')), 'free') $$;
  create function public.can_use_analytics(p uuid) returns boolean language sql stable as $$
    select case when not public.memberships_enabled() then true
                when p is not null and public.access_analytics_configured(p) = 'free' then true
                else coalesce(current_setting('test.member', true), 'no') = 'yes' end $$;
  create function public.access_features(p uuid) returns text[] language sql stable as $$
    select string_to_array(nullif(coalesce(current_setting('test.features', true), ''), ''), ',') $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'no') = 'yes' $$;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.padmin', true), 'no') = 'yes' $$;
  create function public.can_view_league(p uuid) returns boolean language sql stable as $$
    select coalesce((select visibility = 'public' or public.is_league_admin(p) from leagues where id = p), false) $$;
  create function public.game_league_id(p_game uuid) returns uuid language sql stable as $$
    select s.league_id from public.games g join public.competitions c on c.id = g.competition_id join public.seasons s on s.id = c.season_id where g.id = p_game $$;
  grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
`);
await db.exec(mig('0211_what_wins.sql'));
await db.exec(mig('0213_analytics_mix.sql'));
await db.exec(mig('0222_access_gates.sql'));
/* analytics_signin_required reads platform_settings 'analytics_signin' (0211) */
const U1 = '00000000-0000-0000-0000-0000000000e1';
await db.exec(`insert into auth.users values ('${U1}')`);
const [lg] = (await db.query(`insert into leagues (slug, analytics_access) values ('paid', 'members') returning id`)).rows;
const [priv] = (await db.query(`insert into leagues (slug, visibility) values ('private', 'private') returning id`)).rows;
const [s1] = (await db.query(`insert into seasons (league_id, name) values ($1, '2026') returning id`, [lg.id])).rows;
const [sx] = (await db.query(`insert into seasons (league_id, name) values ($1, '2026') returning id`, [priv.id])).rows;
const [c1] = (await db.query(`insert into competitions (season_id) values ($1) returning id`, [s1.id])).rows;
const [home] = (await db.query(`insert into teams (name) values ('Home') returning id`)).rows;
const [away] = (await db.query(`insert into teams (name) values ('Away') returning id`)).rows;
const [stranger] = (await db.query(`insert into teams (name) values ('Elsewhere') returning id`)).rows;
await db.query(`insert into games (status, competition_id, home_team_id, away_team_id) values ('final', $1, $2, $3)`, [c1.id, home.id, away.id]);

const set = async o => db.exec(`set test.memberships = '${o.memberships || 'on'}'; set test.member = '${o.member || 'no'}'; set test.features = '${o.features || ''}';
  set test.admin = '${o.admin || 'no'}'; set test.padmin = '${o.padmin || 'no'}'; set test.uid = '${o.uid || ''}';`);
const signinRequired = async on => db.exec(`insert into platform_settings (key, value) values ('analytics_signin', '${on ? 'true' : 'false'}'::jsonb)
  on conflict (key) do update set value = excluded.value`);
const check = async (scope, l, s, t, o) => {
  await set(o || {});
  const arg = v => (v ? `'${v}'::uuid` : 'null::uuid');
  return (await db.query(`select public.analytics_check(${scope === null ? 'null' : `'${scope}'`}, ${arg(l)}, ${arg(s)}, ${arg(t)}) v`)).rows[0].v;
};

/* every other scope, before and after: a grid of scopes x ids x callers */
const CALLERS = [];
for (const memberships of ['on', 'off']) for (const member of ['no', 'yes']) for (const uid of ['', U1]) for (const admin of ['no', 'yes']) CALLERS.push({ memberships, member, uid, admin });
const IDS = [[null, null, null], [lg.id, null, null], [lg.id, s1.id, null], [lg.id, sx.id, null], [lg.id, s1.id, home.id], [lg.id, null, stranger.id],
  [priv.id, null, null], [priv.id, sx.id, null], [null, s1.id, null], [null, null, home.id], [lg.id, null, home.id]];
const SCOPES = ['wins', 'fo', 'club', 'pos', 'mix', 'store', 'priors', 'teaser', 'nonsense', null];
async function grid() {
  const out = [];
  for (const req of [false, true]) {
    await signinRequired(req);
    for (const sc of SCOPES) for (const [l, s, t] of IDS) for (const c of CALLERS) out.push(await check(sc, l, s, t, c));
  }
  await signinRequired(false);
  return out;
}
const before = await grid();

await db.exec(mig('0265_transfer_matrix_gate.sql'));
await db.exec(mig('0265_transfer_matrix_gate.sql'));
ok('0265 loads after 0211, 0213 and 0222, and runs twice', true);

console.log('\nevery other scope, exactly as before');
{
  const after = await grid();
  const diff = after.map((v, i) => (v === before[i] ? null : i)).filter(i => i !== null);
  ok('wins, fo, club, pos, mix and every other scope answer exactly as 0222 made them answer (' + before.length + ' cases: ok ' +
     before.filter(v => v === 'ok').length + ', members ' + before.filter(v => v === 'members').length + ', league ' + before.filter(v => v === 'league').length +
     ', scope ' + before.filter(v => v === 'scope').length + ', signin ' + before.filter(v => v === 'signin').length + ')', diff.length === 0 && new Set(before).size === 5, diff.slice(0, 5));
}

console.log('\nthe transfer matrix\'s two files');
for (const scope of ['transfer', 'tscale']) {
  const c = o => check(scope, null, null, null, o);
  ok(scope + ': signed out, never - memberships on or off', await c({}) === 'signin' && await c({ memberships: 'off' }) === 'signin' && await c({ member: 'yes' }) === 'signin');
  ok(scope + ': signed in with memberships off, open (as every section is)', await c({ uid: U1, memberships: 'off' }) === 'ok');
  ok(scope + ': memberships on, a member is let in and a fan is not', await c({ uid: U1, member: 'yes' }) === 'ok' && await c({ uid: U1 }) === 'members');
  ok(scope + ': a league\'s administrator is no member of the platform-wide file', await c({ uid: U1, admin: 'yes' }) === 'members');
  ok(scope + ': never with a league, a season or a team',
     await check(scope, lg.id, null, null, { uid: U1, member: 'yes' }) === 'scope' && await check(scope, null, s1.id, null, { uid: U1, member: 'yes' }) === 'scope' &&
     await check(scope, null, null, home.id, { uid: U1, member: 'yes' }) === 'scope');
}
{
  await db.exec(`update public.access_gates set gate = 'free' where key = 'transferMatrix'`);
  ok('the section made free in the console: every signed-in reader, still nobody signed out',
     await check('transfer', null, null, null, { uid: U1 }) === 'ok' && await check('transfer', null, null, null, {}) === 'signin');
  await db.exec(`update public.access_gates set gate = 'club_report' where key = 'transferMatrix'`);
  ok('...behind the club report: whoever holds it, not an analytics member',
     await check('tscale', null, null, null, { uid: U1, features: 'club_report' }) === 'ok' && await check('tscale', null, null, null, { uid: U1, member: 'yes', features: 'analytics' }) === 'members');
  await db.exec(`update public.access_gates set gate = 'analytics' where key = 'transferMatrix'`);
  ok('...and its own row: making What wins free opens What wins, not the transfer matrix',
     (await db.exec(`update public.access_gates set gate = 'free' where key = 'model'`), await check('wins', lg.id, null, null, { uid: U1 })) === 'ok' &&
     await check('transfer', null, null, null, { uid: U1 }) === 'members');
  await db.exec(`update public.access_gates set gate = 'analytics' where key = 'model'`);
  await signinRequired(true);
  ok('the platform\'s "analytics need a sign-in" switch asks the signed-out first, as before', await check('transfer', null, null, null, {}) === 'signin' && await check('wins', lg.id, null, null, {}) === 'signin');
  await signinRequired(false);
}

console.log('\nthe index, the bucket, the row');
{
  const def = (await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'analytics_files_scope_check'`)).rows[0];
  ok('the index takes transfer and tscale beside every scope it took', ['wins', 'fo', 'club', 'pos', 'mix', 'store', 'priors', 'teaser', 'transfer', 'tscale'].every(x => def.d.includes("'" + x + "'")), def.d);
  await db.exec(`insert into public.analytics_files (scope, league_key, season_key, team_key, is_current, path, token, layout, fv, bytes)
    values ('transfer', 'all', 'current', '', true, 'transfer/abc.bin.gz', 'abc', 2, 0, 1848981),
           ('tscale', 'all', 'current', '', true, 'tscale/def.json.gz', 'def', 1, 0, 187563)`);
  const rows = (await db.query(`select scope, league_key, season_key, team_key from public.analytics_files order by scope`)).rows;
  ok('...a row each, league "all", season "current", no team', rows.length === 2 && rows.every(r => r.league_key === 'all' && r.season_key === 'current' && r.team_key === ''), rows);
  let refused = null;
  try { await db.exec(`insert into public.analytics_files (scope, league_key, season_key, path, token, layout, fv) values ('players', 'all', 'current', 'x', 'x', 1, 0)`); } catch (e) { refused = e.message; }
  ok('...and still refuses a scope nobody named', /analytics_files_scope_check/.test(refused || ''), refused);
  const b = (await db.query(`select public, allowed_mime_types from storage.buckets where id = 'analytics'`)).rows[0];
  ok('the bucket takes gzip as well as JSON, once, and stays private', b.public === false && b.allowed_mime_types.join() === 'application/json,application/gzip', b);
  const pol = (await db.query(`select count(*)::int n from pg_policies where schemaname = 'storage' and (qual ilike '%analytics%' or with_check ilike '%analytics%')`)).rows[0].n;
  ok('...with no storage policy naming it', pol === 0);
  const g = (await db.query(`select gate from public.access_gates where key = 'transferMatrix'`)).rows;
  ok('the section\'s row, on the analytics gate', g.length === 1 && g[0].gate === 'analytics', g);
  const priv2 = (await db.query(`select has_table_privilege('anon', 'public.analytics_files', 'select') a, has_table_privilege('authenticated', 'public.analytics_files', 'select') b`)).rows[0];
  ok('anon and authenticated still cannot read the index', priv2.a === false && priv2.b === false, priv2);
  const fn = (await db.query(`select has_function_privilege('anon', 'public.analytics_check(text, uuid, uuid, uuid)', 'execute') a`)).rows[0];
  ok('...and may still ask analytics_check (with their own token)', fn.a === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
