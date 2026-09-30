// 0201: OFFICIAL PARTNERS, on a real Postgres (PGlite; skipped with a note when it is not installed -
// PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). 0194 (the news sources, the creator outlets,
// creators_shown) is loaded first on the stand-ins creators.test.mjs uses; 0201 on top. What is held here:
//   * only a platform administrator can name a partner or stop: a league's administrator, an outlet's owner and a
//     fan are refused, and so is a signed-out caller; anon cannot even execute it
//   * a news source and a creator outlet, both; anything else is refused; an unknown id is refused
//   * official_partners() carries ONLY sources that are on and outlets that are active (and shown), each with the
//     slug the card's key is made of - an outlet with its league's slug, because an outlet's slug is only unique
//     in its league; it is open to a signed-out reader and to nobody it should not be
//   * a switch is audit-logged; the tables stay closed
//   * the console's list (official_partners_admin) is the platform administrator's alone
//
//   node supabase/tests/official-partners.test.mjs
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
const m51 = mig('0051_news_and_writers.sql');
const fnOf = name => { const i = m51.indexOf('create or replace function public.' + name + '('); const j = m51.indexOf('end; $$;', i); return m51.slice(i, j + 'end; $$;'.length); };

const ADMIN = '11111111-1111-1111-1111-111111111111', OWNER = '22222222-2222-2222-2222-222222222222',
      FAN = '44444444-4444-4444-4444-444444444444', PLAT = '55555555-5555-5555-5555-555555555555';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.profiles (id uuid primary key, display_name text);
  create table public.audit_log (actor uuid, action text, subject text, subject_id text, detail jsonb, at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, colour_a text, logo_path text);
  create table public.test_hidden (league_id uuid);
  create function public.is_platform_admin() returns boolean language sql stable as $$ select auth.uid() = '${PLAT}'::uuid $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$ select auth.uid() = '${ADMIN}'::uuid or public.is_platform_admin() $$;
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  create table public.news_articles (id uuid primary key default gen_random_uuid(), league_id uuid, slug text, title text,
    standfirst text default '', cover_path text, status text, published_at timestamptz, author_name text default '');
  create function public.can_view_league_for(u uuid, p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  create function public.notify_valid_tz(t text) returns text language sql immutable as $$ select t $$;
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid);
  create table public.fan_prefs (user_id uuid primary key, theme text, colour text,
    fav_team_ids uuid[] not null default '{}', fav_player_ids uuid[] not null default '{}', fav_game_ids uuid[] not null default '{}',
    fav_league_ids uuid[] not null default '{}', notify_inapp boolean default true, notify_email boolean default false, notify_push boolean default false,
    want_results boolean default true, want_players boolean default true, want_fixtures boolean default true, want_announcements boolean default true,
    want_fixture_2d boolean default true, want_fixture_2h boolean default true, want_lineups boolean default true, want_player_games boolean default true,
    want_halftime boolean default true, want_fanvote boolean default true, want_favourites boolean default true, time_zone text, updated_at timestamptz);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, device_id uuid, kind text not null,
    title text not null, body text not null default '', link text, league_id uuid, game_id uuid, ref text not null, data jsonb not null default '{}',
    urgency text not null default 'normal', expires_at timestamptz, created_at timestamptz default now(), read_at timestamptz, pushed_at timestamptz,
    unique (user_id, kind, ref),
    constraint notifications_kind_check check (kind in ('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy', 'test')));
  ${fnOf('clean_news_spans')}
  ${fnOf('clean_news_body')}
`);
const q = async (sql, params, role) => {
  if (role) await db.exec('set role ' + role);
  try { return (await db.query(sql, params)).rows; } finally { if (role) await db.exec('reset role'); }
};
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

await db.exec(mig('0194_creators.sql'));
await db.exec(mig('0201_official_partners.sql'));
await db.exec(`grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;`);

const [kbl] = await q(`insert into leagues (slug, name) values ('kbl', 'KBL') returning id`);
const [nbl] = await q(`insert into leagues (slug, name) values ('nbl', 'NBL') returning id`);
const [priv] = await q(`insert into leagues (slug, name) values ('priv', 'A Private League') returning id`);
await q(`update leagues set creators_enabled = true`);
await q(`insert into auth.users values ($1, 'admin@kbl.com'), ($2, 'owner@pod.com'), ($3, 'fan@x.com'), ($4, 'plat@epinoia.com')`, [ADMIN, OWNER, FAN, PLAT]);
await as(ADMIN);
const [{ id: o1 }] = await q(`select public.create_creator_outlet($1, 'Hoops Pod', 'owner@pod.com') as id`, [kbl.id]);
const [{ id: o2 }] = await q(`select public.create_creator_outlet($1, 'Hoops Pod', 'owner@pod.com') as id`, [nbl.id]);      // the same slug, another league
await as(PLAT);
const [{ id: s1 }] = await q(`select public.add_news_source(null, 'Eurohoops', 'https://eh.example', 'https://eh.example/feed') as id`);
const [{ id: s2 }] = await q(`select public.add_news_source(null, 'BasketNews', 'https://bn.example', 'https://bn.example/feed') as id`);
const [{ id: s3 }] = await q(`select public.add_news_source($1, 'Private Wire', 'https://pw.example', 'https://pw.example/feed') as id`, [priv.id]);

console.log('\nthe column, and nothing named yet');
ok('a source and an outlet are not partners to begin with', (await q(`select count(*)::int as n from news_sources where official_partner`))[0].n === 0 &&
   (await q(`select count(*)::int as n from creator_outlets where official_partner`))[0].n === 0);
await as('');
ok('...and the list is empty, for a signed-out reader too', JSON.stringify((await q(`select public.official_partners() as j`, [], 'anon'))[0].j) === '[]');

console.log('\nwho may name one');
const refuse = async (uid, sql, params, role) => { await as(uid); return /platform administrator/.test(await fails(() => q(sql, params, role)) || ''); };
ok('a fan, a league\'s administrator and an outlet\'s owner are refused',
   await refuse(FAN, `select public.set_official_partner('source', $1, true)`, [s1], 'authenticated') &&
   await refuse(ADMIN, `select public.set_official_partner('source', $1, true)`, [s1], 'authenticated') &&
   await refuse(OWNER, `select public.set_official_partner('outlet', $1, true)`, [o1], 'authenticated'));
ok('...a signed-out call reaches the function only through anon, which is not granted it',
   /permission denied/.test(await fails(() => q(`select public.set_official_partner('source', $1, true)`, [s1], 'anon')) || ''));
await as('');
ok('...and with no signed-in user at all the function itself refuses', /platform administrator/.test(await fails(() => q(`select public.set_official_partner('source', $1, true)`, [s1])) || ''));
ok('...nothing changed', (await q(`select count(*)::int as n from news_sources where official_partner`))[0].n === 0);
ok('...and the console\'s list is theirs alone',
   await refuse(ADMIN, `select * from public.official_partners_admin()`, [], 'authenticated') && await refuse(FAN, `select * from public.official_partners_admin()`, [], 'authenticated'));

console.log('\nthe platform names them');
await as(PLAT);
ok('a platform administrator names a source and an outlet',
   (await q(`select public.set_official_partner('source', $1, true) as v`, [s1], 'authenticated'))[0].v === true &&
   (await q(`select public.set_official_partner('outlet', $1, true) as v`, [o1], 'authenticated'))[0].v === true);
ok('...anything else is refused, and an id that is nobody\'s',
   /news source or a creator outlet/.test(await fails(() => q(`select public.set_official_partner('league', $1, true)`, [kbl.id], 'authenticated')) || '') &&
   /no such source/.test(await fails(() => q(`select public.set_official_partner('source', $1, true)`, ['99999999-9999-9999-9999-999999999999'], 'authenticated')) || ''));
const audit = await q(`select action, subject, detail from audit_log where action = 'set_official_partner' order by at, subject_id`);
ok('...each is in the audit log', audit.length === 2 && audit.some(a => a.subject === 'news_source' && a.detail.on === true) && audit.some(a => a.subject === 'creator_outlet'), audit);

console.log('\nthe list every page asks for');
await as('');
let list = (await q(`select public.official_partners() as j`, [], 'anon'))[0].j;
ok('a signed-out reader gets both, a source by its slug and an outlet by its slug AND its league\'s (an outlet\'s slug is unique only there)',
   list.length === 2 && list.some(x => x.kind === 'source' && x.slug === 'eurohoops' && x.league === undefined) &&
   list.some(x => x.kind === 'outlet' && x.slug === 'hoops-pod' && x.league === 'kbl'), list);
await as(PLAT);
await q(`select public.set_official_partner('outlet', $1, true)`, [o2], 'authenticated');
await q(`select public.set_official_partner('source', $1, true)`, [s3], 'authenticated');
await q(`select public.set_official_partner('source', $1, true)`, [s2], 'authenticated');
await as('');
list = (await q(`select public.official_partners() as j`, [], 'anon'))[0].j;
ok('the same outlet slug in two leagues is two entries',
   list.filter(x => x.kind === 'outlet').map(x => x.league).sort().join() === 'kbl,nbl', list);
ok('a league\'s own source is listed while that league is visible', list.some(x => x.slug === 'private-wire') && list.length === 5, list);
await q(`insert into test_hidden values ($1)`, [priv.id]);
list = (await q(`select public.official_partners() as j`, [], 'anon'))[0].j;
ok('...and not when the reader may not see the league', !list.some(x => x.slug === 'private-wire') && list.length === 4, list);
await q(`delete from test_hidden`);
await as(PLAT);
await q(`update news_sources set enabled = false where id = $1`, [s2]);
await q(`select public.set_creator_outlet_status($1, 'suspended')`, [o2]);
await as('');
list = (await q(`select public.official_partners() as j`, [], 'anon'))[0].j;
ok('a source that is switched off, and an outlet that is suspended, drop out of the list (partner or not)',
   !list.some(x => x.slug === 'basketnews') && !list.some(x => x.kind === 'outlet' && x.league === 'nbl'), list);
await as(PLAT);
await q(`update leagues set creators_enabled = false where id = $1`, [kbl.id]);
await as('');
list = (await q(`select public.official_partners() as j`, [], 'anon'))[0].j;
ok('an outlet in a league that has switched creators off is not listed either',
   !list.some(x => x.kind === 'outlet'), list);
await as(PLAT);
await q(`update leagues set creators_enabled = true where id = $1`, [kbl.id]);
await q(`select public.set_official_partner('source', $1, false)`, [s1], 'authenticated');
await as('');
list = (await q(`select public.official_partners() as j`, [], 'anon'))[0].j;
ok('stopping is as easy: the source leaves the list, the outlet stays',
   !list.some(x => x.slug === 'eurohoops') && list.some(x => x.kind === 'outlet' && x.league === 'kbl'), list);

console.log('\nthe console\'s list');
await as(PLAT);
const adm = await q(`select * from public.official_partners_admin()`, [], 'authenticated');
ok('every source and every outlet, in every league, with the flag and whether it shows at all',
   adm.length === 5 && adm.find(r => r.slug === 'basketnews').showing === false && adm.find(r => r.slug === 'basketnews').official_partner === true &&
   adm.find(r => r.kind === 'outlet' && r.league_slug === 'nbl').showing === false && adm.find(r => r.slug === 'eurohoops').official_partner === false, adm.map(r => r.kind + ':' + r.slug));

console.log('\nthe tables stay closed');
ok('the API roles cannot read the flag from the tables',
   /permission denied/.test(await fails(() => q(`select official_partner from news_sources`, [], 'anon')) || '') &&
   /permission denied/.test(await fails(() => q(`select official_partner from creator_outlets`, [], 'authenticated')) || ''));
ok('...nor change it', /permission denied/.test(await fails(() => q(`update news_sources set official_partner = true`, [], 'authenticated')) || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
