// 0234 (where a visit came from) on a real Postgres: PGlite, skipped with a note when it is not installed (PGLITE_DIR=<its folder>).
// 0173 + 0233 are applied for real, then 0234, over stand-ins for the tables the report names. The rules: only a visit's first view is a
// landing, the engine is worked out from the referring host alone, tags are short slugs or dropped, and the report is for platform
// administrators only and names the page by league, club or player.
//
//   node supabase/tests/analytics-sources-db.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d) : '')); } };

await db.exec(`
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), '') = '1' $$;
create table public.leagues (id uuid primary key, name text not null, slug text not null);
create table public.teams (id uuid primary key, slug text not null, name text not null);
create table public.players (id uuid primary key, first_name text not null, last_name text not null default '');
`);
const first = mig('0173_site_analytics.sql'); // the table and analytics_track only: the rest of 0173 self-tests against the real schema
await db.exec(first.slice(0, first.indexOf('create or replace function public.analytics_build')));
for (const f of ['0233_analytics_player.sql', '0234_analytics_sources.sql']) {
  try { await db.exec(mig(f)); ok('applies: ' + f, true); } catch (e) { ok('applies: ' + f, false, String(e.message).slice(0, 300)); process.exit(1); }
}
const PID = '0e7c9b0a-1f0e-4a5e-9d1d-3b5c1a2f4e66';
await db.exec(`insert into leagues values ('00000000-0000-4000-8000-000000000001', 'Super League Basketball Men', 'slb-men');
insert into teams values ('00000000-0000-4000-8000-000000000002', 'bristol-flyers', 'Bristol Flyers');
insert into players values ('${PID}', 'Michael', 'Smith');`);

const track = (sess, ref, events) => db.query(`select public.analytics_track($1, false, 'desktop', 'en', 'web', $2, $3::jsonb)`, [sess, ref, JSON.stringify(events)]);
const sess = i => 'a'.repeat(31) + i;
await track(sess(1), 'www.google.com', [{ kind: 'view', page: 'p', player: PID, landing: true }, { kind: 'view', page: 'stats' }]);
await track(sess(2), 'google.co.jp', [{ kind: 'view', page: 'l', league: 'slb-men', landing: true }]);
await track(sess(3), 'bing.com', [{ kind: 'view', page: 't', team: 'bristol-flyers', landing: true }]);
await track(sess(4), 'news.example.org', [{ kind: 'view', page: 'splash', landing: true, utm_source: 'Newsletter', utm_medium: 'email', utm_campaign: 'oct 2026!' }]);
await track(sess(5), null, [{ kind: 'view', page: 'splash', landing: true, utm_source: 'x'.repeat(60) }]);
await track(sess(6), 'google.com', [{ kind: 'view', page: 'splash' }]);
const rows = (await db.query(`select page, engine, landing, utm_source, utm_medium, utm_campaign, ref from site_events order by id`)).rows;
const by = (k, f) => rows.find(f);
ok('only the first view of a visit is a landing', rows.filter(r => r.landing).length === 5, rows);
ok('a Google page, in any country, is google', rows.filter(r => r.engine === 'google').length === 2);
ok('Bing is bing, another site is no engine', by('b', r => r.ref === 'bing.com').engine === 'bing' && by('n', r => r.ref === 'news.example.org').engine === null);
ok('a visit that did not land has no engine even with a referrer', rows.find(r => r.page === 'splash' && r.ref === 'google.com').engine === null);
const tag = by('t', r => r.utm_source === 'newsletter');
ok('tags are lower case slugs; one that is not a slug is dropped', tag && tag.utm_medium === 'email' && tag.utm_campaign === null, tag);
ok('an over-long tag is dropped, not cut', rows.find(r => r.page === 'splash' && r.ref === null).utm_source === null);

await db.exec(`set test.admin = ''`);
let denied = false;
try { await db.query(`select public.analytics_sources_report(30)`); } catch (e) { denied = /administrators only/.test(e.message); }
ok('a visitor cannot read the report', denied);
await db.exec(`set test.admin = '1'`);
const r = (await db.query(`select public.analytics_sources_report(30) as r`)).rows[0].r;
ok('totals: 5 landings: 3 from search (2 Google), 1 tagged, 1 direct', r.totals.landings === 5 && r.totals.search === 3 && r.totals.google === 2 && r.totals.campaign === 1 && r.totals.direct === 1 && r.totals.site === 0, r.totals);
ok('totals add up to the landings', r.totals.search + r.totals.campaign + r.totals.site + r.totals.direct === r.totals.landings, r.totals);
ok('engines are ranked', r.engines[0].engine === 'google' && r.engines[0].landings === 2, r.engines);
const names = Object.fromEntries(r.pages.map(p => [p.kind, p.name]));
ok('the pages arrived on are named: the league, the club and the player', names.league === 'Super League Basketball Men' && names.club === 'Bristol Flyers' && names.player === 'Michael Smith', r.pages);
ok('the campaign is listed', r.campaigns.length === 1 && r.campaigns[0].source === 'newsletter' && r.campaigns[0].medium === 'email', r.campaigns);
ok('other sites that sent visitors are listed, search engines are not', r.referrers.length === 1 && r.referrers[0].host === 'news.example.org', r.referrers);
for (const fn of ['analytics_sources_build(int)', 'search_engine_of(text)']) {
  const x = (await db.query(`select has_function_privilege('anon', 'public.${fn}', 'execute') a, has_function_privilege('authenticated', 'public.${fn}', 'execute') b`)).rows[0];
  ok('not callable by visitors or accounts: ' + fn, !x.a && !x.b, x);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
