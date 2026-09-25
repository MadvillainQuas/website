// 0176: every analytics list is capped, and the live-now report says what visitors are doing without saying who.
// On a real Postgres (PGlite; skipped with a note when it is not installed - PGLITE_DIR=<its folder> or
// `npm i --no-save @electric-sql/pglite`). Loads 0173 then 0176 on the minimum schema they read.
//
//   node supabase/tests/analytics-live.test.mjs
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
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, public_live boolean);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, name text);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons, name text);
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, slug text, name text, short_name text);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    home_team_id uuid references public.teams, away_team_id uuid references public.teams, tipoff_at timestamptz, status text);
`);
// 0173 up to its own self-test (which switches roles in ways this harness does not need to repeat)
const m173 = mig('0173_site_analytics.sql');
await db.exec(m173.slice(0, m173.indexOf('-- SELF-TEST')));
await db.exec(mig('0176_analytics_live.sql'));

const q = async (sql, p) => (await db.query(sql, p)).rows;
const tok = n => 'zzlive' + String(n).padStart(2, '0') + 'abcdefghijklmnop';       // 16+ chars, as the tracker makes them
const ev = (session, kind, page, extra = {}) => q(
  `insert into site_events (kind, page, league, team, game, tab, session, signed_in, device, lang, app, at)
   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() - make_interval(secs => $12))`,
  [kind, page, extra.league || null, extra.team || null, extra.game || null, extra.tab || null, session, !!extra.signed_in,
   extra.device || 'phone', extra.lang || 'en', extra.app || 'web', extra.ago ?? 5]);

const lg = (await q(`insert into leagues (slug, name, public_live) values ('zz-live', 'Live League', true) returning id`))[0].id;
const se = (await q(`insert into seasons (league_id, name) values ($1, '26') returning id`, [lg]))[0].id;
const cp = (await q(`insert into competitions (season_id, name) values ($1, 'L') returning id`, [se]))[0].id;
const th = (await q(`insert into teams (league_id, slug, name, short_name) values ($1, 'zz-home', 'Home Club', 'HOM') returning id`, [lg]))[0].id;
const ta = (await q(`insert into teams (league_id, slug, name, short_name) values ($1, 'zz-away', 'Away Club', 'AWY') returning id`, [lg]))[0].id;
const gm = (await q(`insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status) values ($1, $2, $3, now(), 'live') returning id`, [cp, th, ta]))[0].id;

console.log('-- what visitors are doing now');
await ev(tok(1), 'view', 'game', { game: gm, device: 'desktop', lang: 'en', ago: 120 });
await ev(tok(1), 'tab', 'game', { game: gm, tab: 'shotclock', device: 'desktop', ago: 30 });          // on the box score's shot clock tab
await ev(tok(2), 'view', 'l', { league: 'zz-live', device: 'phone', lang: 'ja', app: 'android', signed_in: true, ago: 40 });
await ev(tok(3), 'view', 'go', { device: 'tablet', ago: 10 });
await ev(tok(4), 'view', 't', { team: 'zz-home', ago: 60 });
await ev(tok(5), 'view', 'game', { game: gm, ago: 1200 });                                              // 20 minutes ago: not now
await ev(tok(6), 'tab', 'game', { game: gm, tab: 'box', ago: 20 });                                     // a tab click with no view of its own
let r = (await q(`select public.analytics_live_build(300) r`))[0].r;
ok('four tabs are on the site now (the 20-minute-old one and the view-less one are not)', r.sessions === 4, r.sessions);
ok('one of them is signed in', r.signed_in === 1, r.signed_in);
ok('six tabs were active in the last half hour (the 20-minute-old one and the view-less one included)', r.last_30m === 6, r.last_30m);
ok('the game being watched, with its clubs, league and how many are on it', r.games.length === 1 && r.games[0].home === 'Home Club' && r.games[0].away === 'Away Club'
   && r.games[0].league === 'Live League' && r.games[0].sessions === 1 && r.games[0].status === 'live', r.games);
ok('the box-score tab a visitor is on', r.tabs.length === 1 && r.tabs[0].tab === 'shotclock', r.tabs);
ok('where they are: the pages, counted', r.where.some(x => x.page === 'game' && x.sessions === 1) && r.where.some(x => x.page === 'go'), r.where);
ok('the league is credited for its own page, its club and its game', r.leagues[0].name === 'Live League' && r.leagues[0].sessions === 3, r.leagues);
ok('devices, apps and languages by tab', r.devices.length === 3 && r.apps.some(x => x.k === 'android') && r.langs.some(x => x.k === 'ja'), [r.devices, r.apps, r.langs]);
const v = r.visitors.find(x => x.page === 'game');
ok('a visitor line says what that tab is doing: the game, the tab, for how long, how long idle',
   v && v.home === 'Home Club' && v.tab === 'shotclock' && v.on_page_s >= 119 && v.idle_s >= 29 && v.idle_s < 60 && v.device === 'desktop', v);
ok('visitors come most recently active first', r.visitors[0].page === 'go' && r.visitors.length === 4, r.visitors.map(x => x.page));
ok('the feed lists what just happened, newest first', r.feed.length >= 6 && r.feed[0].ago_s <= r.feed[r.feed.length - 1].ago_s, r.feed.length);
ok('the last half hour by minute: thirty buckets, minute 0 last', r.per_minute.length === 30 && r.per_minute[29].ago_min === 0 && r.per_minute.reduce((a, m) => a + Number(m.views), 0) >= 5, r.per_minute.length);

console.log('-- anonymous: nothing in the answer can be followed or tied to a person');
const text = JSON.stringify(r);
ok('no session token appears anywhere in the answer', !/zzlive\d\d/.test(text), text.match(/zzlive\d\d/));
ok('no field named session, account, email, ip or agent', !/"(session|user|account|email|ip|agent|id_?token)"/i.test(text), text.match(/"(session|user|account|email|ip|agent)"/i));
ok('two visitors on the same page are two separate lines with no key between them', (() => {
  return Object.keys(r.visitors[0]).sort().join() === ['app', 'club', 'device', 'away', 'home', 'idle_s', 'lang', 'league', 'on_page_s', 'page', 'signed_in', 'status', 'tab'].sort().join();
})(), Object.keys(r.visitors[0]));

console.log('-- the window and who may ask');
ok('a wider window finds the 20-minute-old tab', (await q(`select public.analytics_live_build(1800) r`))[0].r.sessions === 5);
ok('the window is held between one and thirty minutes', (await q(`select public.analytics_live_build(1) r`))[0].r.window_s === 60 && (await q(`select public.analytics_live_build(999999) r`))[0].r.window_s === 1800 && (await q(`select public.analytics_live_build(null) r`))[0].r.window_s === 300);
ok('a platform administrator gets the answer through analytics_live', (await q(`select public.analytics_live(300) r`))[0].r.sessions === 4);
await db.exec(`select set_config('test.admin', 'off', false)`);
let refused = false;
try { await q(`select public.analytics_live(300)`); } catch (e) { refused = /platform administrators only/.test(String(e.message)); }
ok('anyone else is refused', refused);
await db.exec(`select set_config('test.admin', 'on', false)`);
const priv = async (role, fn) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p;
ok('no browser role reaches the builder; only a signed-in caller reaches the door (which then checks)',
   !(await priv('anon', 'public.analytics_live_build(integer)')) && !(await priv('authenticated', 'public.analytics_live_build(integer)'))
   && !(await priv('anon', 'public.analytics_live(integer)')) && (await priv('authenticated', 'public.analytics_live(integer)')));

console.log('-- every list in the report is capped');
await q(`delete from site_events`);
// 150 distinct pages, 150 games, 150 clubs, 60 referrers: the report must stop each at its limit
for (let i = 0; i < 150; i++) {
  const s = tok(100 + i);
  await q(`insert into site_events (kind, page, session, at) values ('view', $1, $2, now())`, ['p' + i, s]);
  const g = (await q(`insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status) values ($1, $2, $3, now(), 'final') returning id`, [cp, th, ta]))[0].id;
  await q(`insert into site_events (kind, page, game, session, at) values ('view', 'game', $1, $2, now())`, [g, s]);
  const t = (await q(`insert into teams (league_id, slug, name, short_name) values ($1, $2, $3, 'X') returning id`, [lg, 'zz-club-' + i, 'Club ' + i]))[0].id;
  await q(`insert into site_events (kind, page, team, session, at) values ('view', 't', $1, $2, now())`, ['zz-club-' + i, s]);
  if (i < 60) await q(`insert into site_events (kind, page, session, ref, at) values ('view', 'home', $1, $2, now())`, [s, 'site' + i + '.example.com']);
}
r = (await q(`select public.analytics_build(1) r`))[0].r;
ok('games: at most 100 rows (it was 20, so nothing useful was lost)', r.games.length === 100, r.games.length);
ok('clubs: at most 100', r.teams.length === 100, r.teams.length);
ok('pages: at most 100 (it had no limit at all)', r.pages.length === 100, r.pages.length);
ok('referrers: at most 50', r.referrers.length === 50, r.referrers.length);
ok('the headline totals are exact: 150 pages + 150 games + 150 clubs + 60 home views, from 150 tabs', r.totals.views === 510 && r.totals.sessions === 150, r.totals);
ok('the busiest rows are the ones kept (ordered)', Number(r.pages[0].views) >= Number(r.pages[99].views), [r.pages[0], r.pages[99]]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
