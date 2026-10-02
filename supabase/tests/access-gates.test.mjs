// 0222 (what is behind the wall, editable) and 0223 (free trials), on a real Postgres (PGlite; skipped with a note when
// it is not installed - PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). Both migrations are loaded on
// the minimum schema they read, the access functions stubbed to the answers 0117 gives. What is held here:
//   * every section a row, seeded with today's gates; access_wall() is everything a page reads, signed out;
//   * a platform administrator alone moves a section or words its teaser, only for a seeded section, audited;
//   * the database's own gates follow the rows: the events splits (game_analytics_ok) and What wins (analytics_check);
//     free opens to everyone, a report opens to whoever holds it, the league's administrators always, memberships off
//     opens everything;
//   * a new member's free trial: three months by default, a plan's own length or none, none for whoever has held a
//     plan from the same seller in the same league, trials off at 0; the offers a page reads; who may set a plan's;
//   * both migrations run twice.
//
//   node supabase/tests/access-gates.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw !== undefined ? '  (saw ' + JSON.stringify(saw) + ')' : '')); } };
const m22 = readFileSync(path.join(here, '..', 'migrations', '0222_access_gates.sql'), 'utf8');
const m23 = readFileSync(path.join(here, '..', 'migrations', '0223_free_trials.sql'), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.leagues (id uuid primary key, mode text default 'members');
  create table public.seasons (id uuid primary key, league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key, season_id uuid references public.seasons);
  create table public.games (id uuid primary key, competition_id uuid references public.competitions, home_team_id uuid, away_team_id uuid);
  create table public.platform_settings (key text primary key, value jsonb not null default 'null'::jsonb, is_public boolean not null default false,
    updated_at timestamptz not null default now(), updated_by uuid);
  create table public.audit_log (id bigserial primary key, actor uuid, action text, subject text, subject_id text, detail jsonb);
  create table public.access_plans (id uuid primary key, league_id uuid, name text default 'Plan', blurb text, features text[] default '{analytics}',
    price_pennies int default 499, currency text default 'gbp', "interval" text default 'month', stripe_price_id text default 'price_x',
    seller text default 'platform', active boolean default true, sort int default 0);
  create table public.access_subscriptions (id bigserial primary key, user_id uuid, plan_id uuid, status text default 'canceled');
  -- 0117's answers: a master switch, the analytics as a league's mode or the member's, the caller's features
  create function public.memberships_enabled() returns boolean language sql stable as $$ select coalesce(current_setting('test.memberships', true), 'on') = 'on' $$;
  create function public.can_use_analytics(p_league uuid) returns boolean language sql stable as $$
    select case when p_league is not null and (select mode from public.leagues where id = p_league) = 'free' then true
                else coalesce(current_setting('test.member', true), 'no') = 'yes' end $$;
  create function public.access_features(p_league uuid) returns text[] language sql stable as $$
    select string_to_array(nullif(coalesce(current_setting('test.features', true), ''), ''), ',') $$;
  create function public.is_league_admin(p_league uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'no') = 'yes' $$;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.padmin', true), 'no') = 'yes' $$;
  create function public.can_view_league(p_league uuid) returns boolean language sql stable as $$ select true $$;
  create function public.analytics_signin_required() returns boolean language sql stable as $$ select false $$;
  create function public.game_league_id(p_game uuid) returns uuid language sql stable as $$
    select s.league_id from public.games g join public.competitions c on c.id = g.competition_id join public.seasons s on s.id = c.season_id where g.id = p_game $$;
  grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
  grant all on all tables in schema public to service_role;
`);
await db.exec(m22); await db.exec(m23);
await db.exec(m22); await db.exec(m23);
ok('0222 and 0223 each run twice', true);

const L1 = '00000000-0000-0000-0000-0000000000a1', L2 = '00000000-0000-0000-0000-0000000000a2', G1 = '00000000-0000-0000-0000-0000000000b1';
const U1 = '00000000-0000-0000-0000-0000000000e1', U2 = '00000000-0000-0000-0000-0000000000e2';
const P_PLAT = '00000000-0000-0000-0000-0000000000f1', P_L1 = '00000000-0000-0000-0000-0000000000f2', P_L1B = '00000000-0000-0000-0000-0000000000f3', P_L2 = '00000000-0000-0000-0000-0000000000f4';
await db.exec(`
  insert into auth.users values ('${U1}'), ('${U2}');
  insert into public.leagues values ('${L1}', 'members'), ('${L2}', 'members');
  insert into public.seasons values ('00000000-0000-0000-0000-0000000000c1', '${L1}');
  insert into public.competitions values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1');
  insert into public.games (id, competition_id) values ('${G1}', '00000000-0000-0000-0000-0000000000d1');
  insert into public.access_plans (id, league_id, seller, features) values ('${P_PLAT}', null, 'platform', '{analytics}'),
    ('${P_L1}', '${L1}', 'league', '{league}'), ('${P_L1B}', '${L1}', 'league', '{league,analytics}'), ('${P_L2}', '${L2}', 'league', '{league}');
`);
const q = async (sql, o = {}) => {
  await db.exec(`set test.memberships = '${o.memberships || 'on'}'; set test.member = '${o.member || 'no'}'; set test.features = '${o.features || ''}';
    set test.admin = '${o.admin || 'no'}'; set test.padmin = '${o.padmin || 'no'}'; set test.uid = '${o.uid || ''}';`);
  return (await db.query(sql)).rows;
};
const err = async (sql, o) => { try { await q(sql, o); return null; } catch (e) { return e.message; } };

console.log('\nthe rows and what a page reads');
{
  const rows = await q(`select key, gate from public.access_gates order by key`);
  ok('every lock access.js knows is a row, with today\'s gate', rows.length === 16 &&
     rows.every(r => (r.key === 'clubReport' ? r.gate === 'club_report' : r.key === 'playerReport' ? r.gate === 'player_report' : r.gate === 'analytics')), rows);
  const w = (await q(`select public.access_wall() w`))[0].w;
  ok('access_wall(): the gates, the shared words (none set), the trial length', Array.isArray(w.gates) && w.gates.length === 16 && JSON.stringify(w.copy) === '{}' && w.trial_months === 3, w);
  ok('...and a section nobody seeded keeps the default it always had', (await q(`select public.gate_of('nothing') g`))[0].g === 'analytics' && (await q(`select public.gate_of('clubReport') g`))[0].g === 'club_report');
}

console.log('\nwho may move a section');
{
  ok('not a fan', /platform administrators only/.test(await err(`select public.platform_set_gate('events', 'free')`)));
  ok('not a section nobody seeded (a typo makes nothing)', /no such section/.test(await err(`select public.platform_set_gate('evnets', 'free')`, { padmin: 'yes' })));
  ok('not a gate that does not exist', /free, analytics, club_report or player_report/.test(await err(`select public.platform_set_gate('events', 'gold')`, { padmin: 'yes' })));
  await q(`select public.platform_set_gate('shotZones', 'free', '  Shot zones for all  ', array['  one ', '', 'two'])`, { padmin: 'yes', uid: U1 });
  const r = (await q(`select gate, title, lines, updated_by from public.access_gates where key = 'shotZones'`))[0];
  ok('a platform administrator does: the gate, the title trimmed, blank lines dropped, who did it', r.gate === 'free' && r.title === 'Shot zones for all' &&
     JSON.stringify(r.lines) === '["one","two"]' && r.updated_by === U1, r);
  const a = await q(`select action, subject_id, detail from public.audit_log where action = 'access_gate'`);
  ok('...audited', a.length === 1 && a[0].subject_id === 'shotZones' && a[0].detail.gate === 'free', a);
  await q(`select public.platform_set_gate('shotZones', 'analytics', '', null)`, { padmin: 'yes' });
  const r2 = (await q(`select gate, title, lines from public.access_gates where key = 'shotZones'`))[0];
  ok('a blank title and no lines put the page\'s own words back', r2.gate === 'analytics' && r2.title === null && r2.lines === null, r2);
}

console.log('\nthe database\'s own gates follow the rows');
{
  const evOk = async o => (await q(`select public.game_analytics_ok('${G1}') v`, o))[0].v;
  const wins = async o => (await q(`select public.analytics_check('wins', '${L1}', null, null) v`, o))[0].v;
  ok('memberships off: the events splits and What wins are open', await evOk({ memberships: 'off' }) === true && await wins({ memberships: 'off' }) === 'ok');
  ok('on, analytics gate: a fan is refused, a member and the league\'s administrators are not',
     await evOk({}) === false && await evOk({ member: 'yes' }) === true && await evOk({ admin: 'yes' }) === true &&
     await wins({}) === 'members' && await wins({ member: 'yes' }) === 'ok');
  await q(`select public.platform_set_gate('events', 'free')`, { padmin: 'yes' });
  ok('events made free: the splits open to everyone, What wins does not (its own row)', await evOk({}) === true && await wins({}) === 'members');
  await q(`select public.platform_set_gate('model', 'club_report')`, { padmin: 'yes' });
  const wc = await wins({ features: 'club_report' }), wm = await wins({ member: 'yes' });
  ok('the model behind the club report: open to whoever holds it, not to an analytics member', wc === 'ok' && wm === 'members', [wc, wm]);
  ok('...and gate_open says the same', (await q(`select public.gate_open('model', '${L1}') v`, { features: 'club_report' }))[0].v === true &&
     (await q(`select public.gate_open('model', '${L1}') v`, { features: 'analytics' }))[0].v === false);
  await q(`select public.platform_set_gate('events', 'analytics')`, { padmin: 'yes' }); await q(`select public.platform_set_gate('model', 'analytics')`, { padmin: 'yes' });
}

console.log('\nfree trials');
{
  const tf = async (u, p) => (await q(`select public.trial_months_for(${u ? `'${u}'` : 'null'}, '${p}') v`))[0].v;
  ok('three months by default, for a new member and for the signed-out', await tf(U1, P_PLAT) === 3 && await tf(null, P_L1) === 3);
  await db.exec(`insert into public.access_subscriptions (user_id, plan_id) values ('${U1}', '${P_L1}')`);
  ok('none for whoever has held a plan from the same seller in the same league, whatever became of it', await tf(U1, P_L1) === 0 && await tf(U1, P_L1B) === 0);
  ok('...but a trial with another seller, or another league', await tf(U1, P_PLAT) === 3 && await tf(U1, P_L2) === 3);
  ok('a plan nobody sells offers none', (await db.exec(`update public.access_plans set active = false where id = '${P_L2}'`), await tf(U2, P_L2)) === 0);
  await db.exec(`update public.access_plans set active = true where id = '${P_L2}'`);
  ok('a fan may not set a plan\'s trial', /only a platform administrator/.test(await err(`select public.set_plan_trial('${P_PLAT}', 1)`)));
  ok('a league administrator may set the league\'s own plan\'s', (await q(`select public.set_plan_trial('${P_L2}', 1) v`, { admin: 'yes' }))[0].v === 'saved' && await tf(U2, P_L2) === 1);
  ok('...but not Epinoia\'s', /only a platform administrator/.test(await err(`select public.set_plan_trial('${P_PLAT}', 0)`, { admin: 'yes' })));
  await q(`select public.set_plan_trial('${P_PLAT}', 0)`, { padmin: 'yes' });
  ok('a plan with no trial of its own (0) offers none; null puts the platform\'s back',
     await tf(U2, P_PLAT) === 0 && (await q(`select public.set_plan_trial('${P_PLAT}', null)`, { padmin: 'yes' }), await tf(U2, P_PLAT)) === 3);
  ok('more than a year is refused', /0 to 12 months/.test(await err(`select public.set_plan_trial('${P_PLAT}', 13)`, { padmin: 'yes' })));
  const offers = (await q(`select public.my_trial_offers('${L1}') v`, { uid: U1 }))[0].v;
  ok('my_trial_offers: the caller\'s answer for every plan on sale in the league and Epinoia\'s', offers[P_PLAT] === 3 && offers[P_L1] === 0 && offers[P_L1B] === 0 && !(P_L2 in offers), offers);
  const pub = (await q(`select public.access_plans_public('${L2}') v`))[0].v;
  ok('the public plan list carries each plan\'s trial', pub.find(p => p.id === P_L2).trial_months === 1 && pub.find(p => p.id === P_PLAT).trial_months === 3, pub);
  await db.exec(`update public.platform_settings set value = '0'::jsonb where key = 'trial_months'`);
  ok('trials off (0): none offered, none promoted', await tf(U2, P_PLAT) === 0 && (await q(`select public.access_wall() w`))[0].w.trial_months === 0);
  await db.exec(`update public.platform_settings set value = '"three"'::jsonb where key = 'trial_months'`);
  ok('a setting that is not a number reads as none', await tf(U2, P_PLAT) === 0);
  await db.exec(`update public.platform_settings set value = '" 2 "'::jsonb where key = 'trial_months'`);
  ok('...one written as text, as a settings box saves it, is read', await tf(U2, P_PLAT) === 2);
  await db.exec(`update public.platform_settings set value = '40'::jsonb where key = 'trial_months'`);
  ok('...and never more than a year', await tf(U2, P_PLAT) === 12);
  await db.exec(`update public.platform_settings set value = '3'::jsonb where key = 'trial_months'`);
  const all = (await q(`select public.plan_trials() v`, { padmin: 'yes' }))[0].v, mine = (await q(`select public.plan_trials() v`, { admin: 'yes' }))[0].v;
  ok('plan_trials: every plan\'s own setting for a platform administrator, null where it takes the platform\'s',
     Object.keys(all).length === 4 && all[P_L2] === 1 && all[P_PLAT] === null, all);
  ok('...a league\'s own plans for its administrators, nothing for a fan', !(P_PLAT in mine) && P_L2 in mine &&
     JSON.stringify((await q(`select public.plan_trials() v`))[0].v) === '{}', mine);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
