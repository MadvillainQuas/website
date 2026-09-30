/* ============================================================================
   A BACKFILL IS NOT NEWS (0191), on a real Postgres (PGlite).

   finalise-game files a match report for every game it closes and alerts every follower of
   both clubs. Loading a league's past season finalises every game it has played, so each one
   became an article on the news page and an "FT" alert. game_report_target and
   notify_game_final now say no for a game finalised more than 36 hours after it tipped off -
   except that a game which already has its report keeps being given one, so a correction
   still rewrites it.

     npm i --no-save @electric-sql/pglite
     node supabase/tests/backfill-news.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0191_backfill_is_not_news.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const db = new PGlite();
await db.exec(`
  create role authenticated; create role service_role; create role anon;
  create table public.leagues (id uuid primary key, name text, auto_reports boolean default true,
                               access_mode text, visibility text);
  create table public.seasons (id uuid primary key, league_id uuid);
  create table public.competitions (id uuid primary key, season_id uuid, name text);
  create table public.teams (id uuid primary key, name text, short_name text);
  create table public.games (id uuid primary key, competition_id uuid, home_team_id uuid, away_team_id uuid,
                             tipoff_at timestamptz, status text, home_score int, away_score int);
  create table public.news_articles (id serial primary key, league_id uuid, slug text, game_id uuid);
  create table public.notifications (user_id uuid, device_id text, kind text, title text, body text, link text,
                                     league_id uuid, game_id uuid, ref text, data jsonb, urgency text, expires_at timestamptz);
  create table public.notify_audience (user_id uuid, device_id text, want_results boolean, fav_team_ids uuid[],
                                       fav_game_ids uuid[], fav_player_ids uuid[], want_players boolean);
  create table public.players (id uuid primary key, first_name text, last_name text, is_minor boolean, public_consent boolean);
  create table public.player_game_stats (game_id uuid, player_id text, stats jsonb);
  create function public.player_withheld(m boolean, c boolean) returns boolean language sql as 'select false';
  create function public.notif_statline(s jsonb) returns text language sql as 'select ''''::text';
  create function public.notif_statline_more(s jsonb) returns text language sql as 'select ''''::text';
  create function public.notif_num(s jsonb, k text) returns numeric language sql as 'select 0::numeric';
  create function public.game_league(p uuid) returns uuid language sql as
    'select s.league_id from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id where g.id = p';
  create function public.memberships_enabled() returns boolean language sql as 'select false';
  create function public.notif_top_scorers(p uuid, t int, n int) returns text language sql as 'select null::text';
  create function public.league_invited_for(u uuid, l uuid) returns boolean language sql as 'select true';
  create function public.can_view_league_for(u uuid, l uuid) returns boolean language sql as 'select true';
  insert into leagues values ('00000000-0000-0000-0000-00000000000a', 'NBL D1', true, 'open', 'public');
  insert into seasons values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
  insert into competitions values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b', 'League');
  insert into teams values ('00000000-0000-0000-0000-0000000000a1', 'Home', null), ('00000000-0000-0000-0000-0000000000a2', 'Away', null);
`);
await db.exec(SQL);

const G = { fresh: '00000000-0000-0000-0000-000000000001', old: '00000000-0000-0000-0000-000000000002',
            oldWithReport: '00000000-0000-0000-0000-000000000003', undated: '00000000-0000-0000-0000-000000000004' };
await db.query(`insert into games values
  ($1, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', now() - interval '3 hours', 'final', 80, 70),
  ($2, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', now() - interval '200 days', 'final', 118, 50),
  ($3, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', now() - interval '5 days', 'final', 60, 59),
  ($4, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', null, 'final', 1, 0)`,
  [G.fresh, G.old, G.oldWithReport, G.undated]);
await db.query(`insert into news_articles (league_id, slug, game_id) values ('00000000-0000-0000-0000-00000000000a', 'report-3', $1)`, [G.oldWithReport]);
await db.exec(`insert into notify_audience values (null, 'dev1', true, array['00000000-0000-0000-0000-0000000000a1'::uuid], '{}', '{}', false)`);

const report = async id => (await db.query('select auto_reports from public.game_report_target($1)', [id])).rows[0]?.auto_reports;
console.log('the match report');
ok('a game finalised at the final whistle gets its report', await report(G.fresh) === true);
ok('a game from last season, finalised by a backfill, gets none', await report(G.old) === false);
ok('an old game that already has its report keeps it (a correction rewrites it)', await report(G.oldWithReport) === true);
ok('a game with no tip-off time is not held back', await report(G.undated) === true);
await db.query('update leagues set auto_reports = false');
ok('a league with reports switched off still gets none', await report(G.fresh) === false);

console.log('\nthe followers');
const notify = async id => (await db.query('select public.notify_game_final($1) n', [id])).rows[0].n;
ok('the final whistle tells the club\'s followers', await notify(G.fresh) >= 1);
ok('a backfilled game tells nobody', await notify(G.old) === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
