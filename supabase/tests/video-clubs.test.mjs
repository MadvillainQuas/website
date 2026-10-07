/* ============================================================================
   A CHANNEL'S OWN NAMES FOR CLUBS, FOR THE VIDEO MATCHER (0240, 2026-10-07), on every migration (PGlite).

     * the names are the channel's administrators' (its league's; a platform channel's, the platform's): a stranger,
       a fan and another league's administrator can neither read nor write them, and readers never see the table;
     * a name for a club, a name for no club; the same name again (any case, any spacing) replaces it;
     * the console's read: the names with their clubs and leagues, and the channel's newest videos with the game each
       is on, whether by hand, the clubs the matcher found in it and where it stopped;
     * the clubs a name can be given to: the channel's leagues', or any club by two letters of its name;
     * a change sends the channel's unmatched videos back to the matcher; rematch sends back the matched ones too,
       never one linked by hand;
     * a video's game carries each club's second colour.

     node supabase/tests/video-clubs.test.mjs        (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0240_video_club_names.sql');
console.log('the migration');
ok('the table is closed to readers; its writes are granted to signed-in users (each checked inside)',
   /revoke all on public\.news_video_clubs from anon, authenticated;/.test(mig)
   && /grant execute on function public\.set_news_video_club\(uuid, text, uuid\) to authenticated;/.test(mig)
   && !/to anon/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0240 among them', !failed || failed.length === 0, failed);
  const as = async (uid, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try { return (await db.query(sql, p)).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
  };
  const tryAs = async (...a) => { try { return await as(...a); } catch (e) { return { error: e.message }; } };

  /* SLB with four clubs and a game; another league with its own club; a league channel and a platform channel */
  const L = (await one(`insert into public.leagues (slug, name) values ('slb', 'Super League Basketball') returning id`)).id;
  const L2 = (await one(`insert into public.leagues (slug, name) values ('nbl', 'NBL') returning id`)).id;
  const C = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                        insert into public.competitions (season_id, name) select id, 'Championship' from s returning id`, [L])).id;
  const team = async (lg, slug, name, short, c1, c2) => (await one(`insert into public.teams (league_id, slug, name, short_name, colour, colour_2)
      values ($1, $2, $3, $4, $5, $6) returning id`, [lg, slug, name, short, c1 || '#888888', c2 || null])).id;
  const BRI = await team(L, 'bristol', 'Bristol Flyers', 'BRI', '#eb3583', '#071728');
  const MAN = await team(L, 'manchester', 'Manchester Basketball', 'MAN', '#ee3b3b', '#4271b7');
  await team(L, 'leicester', 'Leicester Riders', 'LEI');
  const OTH = await team(L2, 'flyers-nbl', 'Perth Flyers', 'PER');
  const G = (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at, home_score, away_score)
      values ($1, $2, $3, 'final', now() - interval '1 day', 76, 58) returning id`, [C, BRI, MAN])).id;
  const src = async (lg, slug) => (await one(`insert into public.news_sources (league_id, slug, name, site_url, feed_url, kind, platform, video_mode)
      values ($1, $2, $2, 'https://www.youtube.com/', 'https://www.youtube.com/feeds/videos.xml?channel_id=UC' || md5($2), 'creator', 'youtube', 'highlights') returning id`, [lg, slug])).id;
  const S = await src(L, 'slb-yt'), SG = await src(null, 'global-yt');
  const item = async (s, guid, title, g, locked, matched, ago) => (await one(`insert into public.news_items (source_id, guid, url, title, published_at, video_id, video_kind, game_id, game_locked, matched_at)
      values ($1, $2, 'https://www.youtube.com/watch?v=' || $2, $3, now() - $7::interval, $2, 'highlights', $4, $5, $6) returning id`,
      [s, guid, title, g, locked, matched, ago || '2 hours'])).id;
  const I1 = await item(S, 'aaaaaaaaaa1', 'HIGHLIGHTS: Flyers vs MAN', null, false, new Date().toISOString());
  const I2 = await item(S, 'aaaaaaaaaa2', 'HIGHLIGHTS: Bristol Flyers vs Manchester Basketball', G, false, new Date().toISOString());
  const I3 = await item(S, 'aaaaaaaaaa3', 'Linked by hand', G, true, new Date().toISOString());
  const I4 = await item(S, 'aaaaaaaaaa4', 'Old', G, false, new Date().toISOString(), '30 days');
  await q(`update public.news_items set match_clubs = array[$2]::uuid[], match_note = 'one_club' where id = $1`, [I1, BRI]);

  const user = async email => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const FAN = await user('fan@example.invalid'), LA = await user('la@example.invalid'), LA2 = await user('la2@example.invalid'), PA = await user('pa@example.invalid');
  const mem = async (u, role, type, id) => q(`insert into public.memberships (user_id, role, scope_type, scope_id) values ($1, $2, $3, $4)`, [u, role, type, id])
    .catch(e => console.log('  (memberships: ' + e.message + ')'));
  await mem(LA, 'league_admin', 'league', L);
  await mem(LA2, 'league_admin', 'league', L2);
  await mem(PA, 'platform_admin', 'platform', null);

  console.log('\nwho may');
  ok('a stranger cannot read or write a channel\'s names', (await tryAs(null, `select public.news_video_clubs($1)`, [S])).error
     && (await tryAs(null, `select public.set_news_video_club($1, 'Flyers', $2)`, [S, BRI])).error);
  ok('...nor a fan, nor another league\'s administrator', /not allowed/.test((await tryAs(FAN, `select public.set_news_video_club($1, 'Flyers', $2)`, [S, BRI])).error || '')
     && /not allowed/.test((await tryAs(LA2, `select public.news_video_clubs($1)`, [S])).error || ''));
  ok('...nor a league\'s administrator a platform channel\'s', /not allowed/.test((await tryAs(LA, `select public.set_news_video_club($1, 'Flyers', $2)`, [SG, BRI])).error || ''));
  ok('readers never see the table', (await tryAs(LA, `select * from public.news_video_clubs`)).error && (await tryAs(null, `select * from public.news_video_clubs`)).error);

  console.log('\nthe names');
  const r1 = await tryAs(LA, `select public.set_news_video_club($1, '  Flyers ', $2) as id`, [S, BRI]);
  ok('the league\'s administrator names a club for the channel', r1[0] && r1[0].id, r1);
  ok('...which sends its unmatched video back to the matcher (and leaves the matched ones)',
     (await one(`select matched_at from public.news_items where id = $1`, [I1])).matched_at === null
     && (await one(`select matched_at from public.news_items where id = $1`, [I2])).matched_at !== null);
  await as(LA, `select public.set_news_video_club($1, 'MAN', $2)`, [S, MAN]);
  await as(LA, `select public.set_news_video_club($1, 'flyers', $2)`, [S, OTH]);
  let rows = await q(`select phrase, team_id from public.news_video_clubs where source_id = $1 order by phrase`, [S]);
  ok('the same name again (any case, any spacing) replaces it', rows.length === 2 && rows.find(x => x.phrase === 'flyers').team_id === OTH, rows);
  await as(LA, `select public.set_news_video_club($1, 'flyers', $2)`, [S, BRI]);
  ok('a name for no club', (await tryAs(LA, `select public.set_news_video_club($1, 'Leicester Arena', null)`, [S]))[0] !== undefined
     && (await one(`select team_id from public.news_video_clubs where phrase = 'Leicester Arena'`)).team_id === null);
  ok('a name is 2 to 60 characters', /2 to 60/.test((await tryAs(LA, `select public.set_news_video_club($1, 'x', $2)`, [S, BRI])).error || ''));
  ok('the platform\'s administrator names them on a platform channel', !(await tryAs(PA, `select public.set_news_video_club($1, 'Flyers', $2)`, [SG, BRI])).error);

  console.log('\nthe console\'s read');
  const v = (await as(LA, `select public.news_video_clubs($1) as v`, [S]))[0].v;
  ok('the names with their clubs and leagues, in order', v.rules.map(x => x.phrase).join('|') === 'flyers|Leicester Arena|MAN'
     && v.rules[0].team === 'Bristol Flyers' && v.rules[0].league === 'Super League Basketball' && v.rules[1].team === null, v.rules);
  const rec = v.recent.find(x => x.id === I1), rec2 = v.recent.find(x => x.id === I2), rec3 = v.recent.find(x => x.id === I3);
  ok('the newest videos: what the matcher found in each and where it stopped', rec && rec.match_note === 'one_club' && rec.clubs.join() === 'Bristol Flyers', rec);
  ok('...the game each is on, and whether that was by hand', rec2 && rec2.game && rec2.game.home === 'Bristol Flyers' && rec2.game.away === 'Manchester Basketball'
     && rec3 && rec3.game_locked === true, [rec2, rec3]);
  let t = await as(LA, `select * from public.news_video_club_teams($1)`, [S]);
  ok('the clubs to choose from: the channel\'s league\'s', t.map(x => x.name).sort().join() === 'Bristol Flyers,Leicester Riders,Manchester Basketball', t);
  t = await as(LA, `select * from public.news_video_club_teams($1, 'flyers')`, [S]);
  ok('...or any club by two letters of its name, the channel\'s league first', t.map(x => x.name).join() === 'Bristol Flyers,Perth Flyers' && t[1].league === 'NBL', t);
  ok('...a % typed is a percent sign, not everything', (await as(LA, `select * from public.news_video_club_teams($1, '%%')`, [S])).length === 0);
  ok('...nobody else\'s to list', (await tryAs(FAN, `select * from public.news_video_club_teams($1)`, [S])).length === 0);

  console.log('\nback to the matcher');
  const id = (await one(`select id from public.news_video_clubs where phrase = 'MAN'`)).id;
  await q(`update public.news_items set matched_at = now() where id = $1`, [I1]);
  ok('a name taken away sends the unmatched videos back too', (await as(LA, `select public.delete_news_video_club($1) as d`, [id]))[0].d === true
     && (await one(`select matched_at from public.news_items where id = $1`, [I1])).matched_at === null);
  ok('...and is the channel\'s administrators\' alone to take away', /not allowed/.test((await tryAs(FAN, `select public.delete_news_video_club($1)`,
     [(await one(`select id from public.news_video_clubs where phrase = 'flyers'`)).id])).error || ''));
  const n = (await as(LA, `select public.rematch_news_videos($1) as n`, [S]))[0].n;
  const after = await q(`select id, game_id, game_locked from public.news_items where source_id = $1`, [S]);
  ok('rematch: every video of its ten days goes back, matched or not', n === 2 && after.find(x => x.id === I2).game_id === null, { n, after });
  ok('...never one linked by hand, nor one older than the matcher looks', after.find(x => x.id === I3).game_id === G && after.find(x => x.id === I4).game_id === G, after);

  console.log('\na video on a game keeps its kind');
  const KV = await item(S, 'aaaaaaaaaa9', 'Valencia vs Joventut', G, false, new Date().toISOString());
  await q(`update public.news_items set video_kind = 'highlights' where id = $1`, [KV]);
  await q(`insert into public.news_items (source_id, guid, url, title, published_at, video_id, video_kind)
           values ($1, 'aaaaaaaaaa9', 'https://www.youtube.com/watch?v=aaaaaaaaaa9', 'Valencia vs Joventut', now(), 'aaaaaaaaaa9', 'video')
           on conflict (source_id, guid) do update set title = excluded.title, video_kind = excluded.video_kind`, [S]);
  ok("a channel's next read (its upsert, the kind from the title again) leaves a matched video's kind as the matcher set it",
     (await one(`select video_kind from public.news_items where id = $1`, [KV])).video_kind === 'highlights');
  await q(`update public.news_items set game_id = null, video_kind = 'video' where id = $1`, [KV]);
  ok('...a video taken off its game takes a new kind as before', (await one(`select video_kind from public.news_items where id = $1`, [KV])).video_kind === 'video');
  await q(`update public.news_items set game_id = $2, video_kind = 'full' where id = $1`, [KV, G]);
  ok('...and the matcher putting it on a game sets its kind', (await one(`select video_kind from public.news_items where id = $1`, [KV])).video_kind === 'full');

  console.log('\na video\'s game');
  const gj = (await one(`select public.video_game_json($1) as j`, [G])).j;
  ok('carries each club\'s second colour', gj.home.colour_2 === '#071728' && gj.away.colour_2 === '#4271b7', gj);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
