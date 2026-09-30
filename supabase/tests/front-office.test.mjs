// 0193: the front office in the rail's hub - grant_front_office / revoke_front_office / front_office_grants_for /
// my_front_offices - on a real Postgres (PGlite; skipped with a note when it is not installed). The migration is
// loaded on stand-ins for what it calls: auth.uid() and auth.users, the memberships table, is_team_manager (0001's
// rule) and can_use_analytics (0117's answer, set per league by the test). What is held here:
//   * only the club's officials may give its front office away, take it back, or see who has it;
//   * a grant is an email address, stored folded, given once however often it is asked for;
//   * the hub lists the clubs a person is attached to - by a team role or by a grant to their address - a role
//     winning over a grant, and says whether their membership opens each; revoked is gone; signed out is nothing;
//   * the table is closed to everyone but the functions, and the functions to the signed-out.
//
//   node supabase/tests/front-office.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

const OFFICIAL = '11111111-1111-1111-1111-111111111111', SCOUT = '22222222-2222-2222-2222-222222222222',
      FAN = '33333333-3333-3333-3333-333333333333', COACH = '44444444-4444-4444-4444-444444444444';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text);
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, slug text unique, name text not null,
    short_name text not null default '', colour text not null default '#93f2bf', logo_path text);
  create table public.memberships (user_id uuid, role text, scope_type text, scope_id uuid);
  create function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$
    select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'league_admin' and m.scope_type = 'league' and m.scope_id = p) $$;
  create function public.is_team_manager(p_team uuid) returns boolean language sql stable security definer as $$
    select public.is_platform_admin()
        or exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'team_manager' and m.scope_type = 'team' and m.scope_id = p_team)
        or exists (select 1 from teams t where t.id = p_team and t.league_id is not null and public.is_league_admin(t.league_id)) $$;
  create table public.test_members (league_id uuid, user_id uuid);
  create function public.can_use_analytics(p_league uuid) returns boolean language sql stable as $$
    select not exists (select 1 from test_members where league_id = p_league)
        or exists (select 1 from test_members where league_id = p_league and user_id = auth.uid()) $$;
`);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

const [lg] = await q(`insert into leagues (slug, name) values ('el', 'EuroLeague') returning id`);
const [lg2] = await q(`insert into leagues (slug, name) values ('free', 'A Free League') returning id`);
const [paris] = await q(`insert into teams (league_id, slug, name, short_name, colour) values ($1, 'paris', 'Paris Basketball', 'PRS', '#fd0204') returning id`, [lg.id]);
const [other] = await q(`insert into teams (league_id, slug, name) values ($1, 'other', 'Another Club') returning id`, [lg2.id]);
await q(`insert into auth.users (id, email) values ($1, 'official@paris.fr'), ($2, 'Scout@Example.com'), ($3, 'fan@example.com'), ($4, 'coach@other.com')`, [OFFICIAL, SCOUT, FAN, COACH]);
await q(`insert into memberships values ($1, 'team_manager', 'team', $2), ($3, 'statistician', 'team', $4)`, [OFFICIAL, paris.id, COACH, other.id]);
await db.exec(mig('0193_front_office.sql'));

console.log('\nwho may give it');
await as(FAN);
ok('a fan cannot give a club\'s front office away', /officials/.test(await fails(() => q(`select public.grant_front_office($1, 'x@y.z')`, [paris.id])) || ''));
ok('...nor see who has it', /officials/.test(await fails(() => q(`select * from public.front_office_grants_for($1)`, [paris.id])) || ''));
await as('');
ok('...nor can anybody signed out', /officials/.test(await fails(() => q(`select public.grant_front_office($1, 'x@y.z')`, [paris.id])) || ''));
await as(OFFICIAL);
ok('the club\'s own official is told an address is not one', /not an email/.test(await fails(() => q(`select public.grant_front_office($1, 'not an address')`, [paris.id])) || ''));
const [g1] = await q(`select public.grant_front_office($1, '  Scout@Example.com ', 'video analyst') as id`, [paris.id]);
const [g2] = await q(`select public.grant_front_office($1, 'scout@example.com') as id`, [paris.id]);
ok('an official gives it by address, folded, and once however often asked', g1.id && g1.id === g2.id);
const list = await q(`select * from public.front_office_grants_for($1)`, [paris.id]);
ok('...and sees who has it', list.length === 1 && list[0].email === 'scout@example.com' && list[0].note === 'video analyst', list);
ok('an official of one club cannot give another\'s', /officials/.test(await fails(() => q(`select public.grant_front_office($1, 'x@y.z')`, [other.id])) || ''));

console.log('\nthe hub');
await as(SCOUT);
let hub = await q(`select * from public.my_front_offices()`);
ok('the scout (signed in as Scout@Example.com) has Paris\'s front office, by a grant', hub.length === 1 && hub[0].slug === 'paris' && hub[0].via === 'grant'
   && hub[0].league_slug === 'el' && hub[0].colour === '#fd0204', hub);
ok('...open while the league\'s analytics are free to all', hub[0].members_ok === true);
await q(`insert into test_members values ($1, $2)`, [lg.id, OFFICIAL]);
hub = await q(`select * from public.my_front_offices()`);
ok('...and shut once the league\'s analytics are for members and the scout is not one', hub.length === 1 && hub[0].members_ok === false);
await q(`insert into test_members values ($1, $2)`, [lg.id, SCOUT]);
ok('...open again when the scout becomes a member', (await q(`select members_ok from public.my_front_offices()`))[0].members_ok === true);
await as(OFFICIAL);
hub = await q(`select * from public.my_front_offices()`);
ok('the official has it by his role', hub.length === 1 && hub[0].via === 'role' && hub[0].members_ok === true, hub);
await q(`select public.grant_front_office($1, 'official@paris.fr')`, [paris.id]);
hub = await q(`select * from public.my_front_offices()`);
ok('...a role wins over a grant for the same club, listed once', hub.length === 1 && hub[0].via === 'role', hub);
await as(COACH);
ok('a team-scoped statistician is attached to his club too', (await q(`select slug, via from public.my_front_offices()`)).map(r => r.slug + ':' + r.via).join() === 'other:role');
await as(FAN);
ok('a fan attached to nothing has no front office', (await q(`select * from public.my_front_offices()`)).length === 0);
await as('');
ok('signed out: nothing', (await q(`select * from public.my_front_offices()`)).length === 0);

console.log('\ntaking it back');
await as(OFFICIAL);
const [n] = await q(`select public.revoke_front_office($1, 'SCOUT@example.com') as n`, [paris.id]);
ok('an official takes it back (the address folded here too)', n.n === 1);
ok('...it leaves the list of who has it', (await q(`select * from public.front_office_grants_for($1)`, [paris.id])).every(r => r.email !== 'scout@example.com'));
await as(SCOUT);
ok('...and the scout\'s hub, at once', (await q(`select * from public.my_front_offices()`)).length === 0);
ok('...while the record stays', (await q(`select count(*)::int as c from front_office_grants where email = 'scout@example.com' and revoked_at is not null`))[0].c === 1);
await as(OFFICIAL);
const [again] = await q(`select public.grant_front_office($1, 'scout@example.com') as id`, [paris.id]);
ok('given again after a revoke: a new grant, the old one kept', again.id && again.id !== g1.id);

console.log('\nwho may touch what');
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;
ok('the signed-out may call none of the four', !(await priv('anon', 'public.my_front_offices()')) && !(await priv('anon', 'public.grant_front_office(uuid, text, text)'))
   && !(await priv('anon', 'public.revoke_front_office(uuid, text)')) && !(await priv('anon', 'public.front_office_grants_for(uuid)')));
ok('...a signed-in account may call all four (each checks who it is)', await priv('authenticated', 'public.my_front_offices()') && await priv('authenticated', 'public.grant_front_office(uuid, text, text)'));
ok('the table is shut to both: through the functions only', !(await q(`select has_table_privilege('authenticated', 'public.front_office_grants', 'select') as ok`))[0].ok
   && !(await q(`select has_table_privilege('anon', 'public.front_office_grants', 'select') as ok`))[0].ok);
ok('...and row-level security is on', (await q(`select relrowsecurity from pg_class where relname = 'front_office_grants'`))[0].relrowsecurity === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
