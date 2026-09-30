// 0200: THE LANGUAGE OF A NEWS SOURCE, on a real Postgres (PGlite; skipped with a note when it is not installed -
// PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). 0194 and 0195 (the sources) first, on the stand-ins
// creators.test.mjs uses; 0200 on top. What is held here:
//   * the column on news_sources and creator_outlets, checked (a lower-case code or NULL), and the sources 0195 seeded get theirs
//   * news_source_languages() is open to a signed-out reader, and carries ONLY sources that are on and in a league the reader may
//     see, and outlets that are active and shown, each with the slug the feed's row keys it by; a source with no language is not listed
//   * the feed's own functions are untouched (news_feed / news_feed_mine keep their columns), and the tables stay closed
//   * re-running the migration changes nothing
//
//   node supabase/tests/news-languages.test.mjs
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
await db.exec(mig('0195_news_sources.sql'));
const before = (await q(`select count(*)::int as n from news_sources`))[0].n;
await db.exec(mig('0200_news_languages.sql'));
await db.exec(`grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;`);

const lang = async slug => (await q(`select language from news_sources where slug = $1`, [slug]))[0].language;
console.log('\nthe column and the backfill');
ok('0195 seeded sources, and each got its language', before >= 25 && await lang('gigantes') === 'es' && await lang('eurohoops') === 'en' && await lang('b-league') === 'ja' && await lang('pianetabasket') === 'it' && await lang('basketnews-lt') === 'lt' && await lang('eurohoops-gr') === 'el');
ok('...every seeded source has one', (await q(`select count(*)::int as n from news_sources where language is null`))[0].n === 0);
{
  const { createRequire } = await import('node:module');
  const FR = createRequire(import.meta.url)(path.join(here, '..', '..', 'epinoia', 'feedrank.js'));
  const rows = await q(`select slug, language from news_sources`);
  ok('feedrank.js\'s SOURCE_LANG (the map used until 0200 is applied) says what the migration says, for every seeded source',
     rows.length === Object.keys(FR.SOURCE_LANG).length && rows.every(r => FR.SOURCE_LANG[r.slug] === r.language), rows.filter(r => FR.SOURCE_LANG[r.slug] !== r.language));
}
ok('a language must be a lower-case code: "ES", "spanish" and "" are refused; NULL is fine',
   /news_sources_language_ck/.test(await fails(() => q(`update news_sources set language = 'ES' where slug = 'gigantes'`)) || '') &&
   /news_sources_language_ck/.test(await fails(() => q(`update news_sources set language = 'spanish' where slug = 'gigantes'`)) || '') &&
   /news_sources_language_ck/.test(await fails(() => q(`update news_sources set language = '' where slug = 'gigantes'`)) || '') &&
   (await fails(() => q(`update news_sources set language = null where slug = 'gigantes'`))) === null);
await q(`update news_sources set language = 'es' where slug = 'gigantes'`);

const [kbl] = await q(`insert into leagues (slug, name) values ('kbl', 'KBL') returning id`);
const [priv] = await q(`insert into leagues (slug, name) values ('priv', 'Private') returning id`);
await q(`update leagues set creators_enabled = true`);
const [{ id: o1 }] = await q(`insert into creator_outlets (league_id, slug, name) values ($1, 'hoops-pod', 'Hoops Pod') returning id`, [kbl.id]);
const [{ id: o2 }] = await q(`insert into creator_outlets (league_id, slug, name) values ($1, 'quiet-pod', 'Quiet Pod') returning id`, [kbl.id]);
await q(`update creator_outlets set language = 'ko' where id = $1`, [o1]);
ok('an outlet takes a language too, and the same check', /creator_outlets_language_ck/.test(await fails(() => q(`update creator_outlets set language = 'KO' where id = $1`, [o1])) || ''));
await as('');
await q(`insert into news_sources (league_id, slug, name, site_url, feed_url, language) values ($1, 'private-wire', 'Private Wire', 'https://pw.example', 'https://pw.example/feed', 'fr')`, [priv.id]);
await q(`insert into news_sources (slug, name, site_url, feed_url) values ('undescribed', 'Undescribed', 'https://u.example', 'https://u.example/feed')`);

console.log('\nthe list every page asks for');
let list = (await q(`select * from public.news_source_languages()`, [], 'anon'));
const has = (k, s, l) => list.some(x => x.kind === k && x.slug === s && x.language === l);
ok('a signed-out reader gets the sources by slug and the outlet by slug AND its league', has('source', 'gigantes', 'es') && has('source', 'eurohoops', 'en') && has('outlet', 'hoops-pod', 'ko') && list.find(x => x.kind === 'outlet').league_slug === 'kbl', list.slice(0, 3));
ok('a source with no language, and an outlet with none, are not listed', !list.some(x => x.slug === 'undescribed' || x.slug === 'quiet-pod'));
ok('a league\'s own source is listed while the league is visible', has('source', 'private-wire', 'fr'));
await q(`insert into test_hidden values ($1)`, [priv.id]);
list = await q(`select * from public.news_source_languages()`, [], 'anon');
ok('...and not when the reader may not see the league', !list.some(x => x.slug === 'private-wire'));
await q(`delete from test_hidden`);
await q(`update news_sources set enabled = false where slug = 'gigantes'`);
await q(`update creator_outlets set status = 'suspended' where id = $1`, [o1]);
list = await q(`select * from public.news_source_languages()`, [], 'anon');
ok('a source that is off and an outlet that is suspended are not listed', !list.some(x => x.slug === 'gigantes' || x.slug === 'hoops-pod'));
ok('the list is executable by anon and signed-in readers, and the tables stay closed',
   (await q(`select count(*)::int as n from public.news_source_languages()`, [], 'authenticated'))[0].n > 0 &&
   /permission denied/.test(await fails(() => q(`select language from news_sources`, [], 'anon')) || ''));

console.log('\nthe feed is untouched, and the migration re-runs');
const cols = async f => (await q(`select pg_get_function_result(p.oid) as r from pg_proc p where p.proname = $1`, [f]))[0].r;
ok('news_feed and news_feed_mine keep their columns (no lang added: the page joins the publishers\' languages itself)', !/\blang\b/.test(await cols('news_feed')) && !/\blang\b/.test(await cols('news_feed_mine')));
await db.exec(mig('0200_news_languages.sql'));
ok('running 0200 again changes nothing', (await q(`select count(*)::int as n from news_sources where language is not null`))[0].n >= before);
await q(`update news_sources set language = 'ca' where slug = 'solobasket'`);
await db.exec(mig('0200_news_languages.sql'));
ok('an administrator\'s choice survives a re-run', await lang('solobasket') === 'ca');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
