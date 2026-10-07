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

  console.log('\nevery game streaming now (0242 live_streams)');
  {
    const live = async (home, away, status, ago) => (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at, home_score, away_score)
        values ($1, $2, $3, $4, now() - $5::interval, 40, 38) returning id`, [C, home, away, status, ago])).id;
    const L1 = await live(BRI, MAN, 'live', '1 hour');
    const L2 = await live(MAN, BRI, 'live', '30 minutes');                 // live, but nothing to watch
    const L3 = await live(BRI, MAN, 'final', '2 hours');                   // over
    const L4 = await live(MAN, BRI, 'live', '20 minutes');                 // live, its feed stalled
    await q(`update public.games set stalled_since = now() where id = $1`, [L4]);
    /* put on the games by the league's administrator: vetted (0247) */
    for (const g of [L1, L3, L4]) {
      await q(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary, is_live, created_by) values ($1, 'youtube', 'https://www.youtube.com/watch?v=cccccccccc1', 'cccccccccc1', true, true, $2)`, [g, LA]);
    }
    await q(`update public.leagues set public_live = true where id = $1`, [L]);
    /* a private league's live game with a stream, for the last check */
    const LP = (await one(`insert into public.leagues (slug, name, visibility, public_live) values ('priv-l', 'Private', 'private', true) returning id`)).id;
    const CP = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                           insert into public.competitions (season_id, name) select id, 'P' from s returning id`, [LP])).id;
    const PA1 = (await one(`insert into public.teams (league_id, slug, name) values ($1, 'pa1', 'Priv One') returning id`, [LP])).id;
    const PB1 = (await one(`insert into public.teams (league_id, slug, name) values ($1, 'pb1', 'Priv Two') returning id`, [LP])).id;
    const LPG = (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at) values ($1, $2, $3, 'live', now() - interval '1 hour') returning id`, [CP, PA1, PB1])).id;
    await q(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary, is_live) values ($1, 'youtube', 'https://www.youtube.com/watch?v=dddddddddd1', 'dddddddddd1', true, true)`, [LPG]);
    const r = (await as(null, `select public.live_streams() as j`))[0].j;
    ok('a stranger sees the live game with a stream: its clubs, its score, its video, whether its chat is open',
       Array.isArray(r) && r.length === 1 && r[0].id === L1 && r[0].home.name === 'Bristol Flyers' && r[0].home_score === 40
       && r[0].video && r[0].video.ref === 'cccccccccc1' && r[0].video.live === true && typeof r[0].chat === 'boolean', r);
    ok('...never a live game with nothing to watch, a game that is over, or one whose feed has stalled', !r.some(x => [L2, L3, L4].includes(x.id)));
    ok("...and nothing of a league the reader may not see (a private league's live stream)", !r.some(x => x.id === LPG), r.map(x => x.id));
  }

  console.log('\nFULL GAMES and the leagues\' strip (0244)');
  {
    /* KV is a channel's full game on G (above); L3 a finished game with its own stream; one more finished game streamed,
       whose stream is the channel's video too (listed once, as the channel's) */
    await q(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary) values ($1, 'youtube', '', 'aaaaaaaaaa9', true)`, [G]);
    const full = await as(null, `select * from public.video_full_games(null, null, 30)`);
    ok('FULL GAMES: a channel\'s full games and the finished games\' own streams, all of them full',
       full.some(r => r.id === KV) && full.some(r => r.video_id === 'cccccccccc1') && full.every(r => r.video_kind === 'full'), full.map(r => [r.video_id, r.video_kind]));
    const st = full.find(r => r.video_id === 'cccccccccc1');
    ok('...a game\'s own stream as a video of the feed: its clubs for a title, its league, its box score, its address',
       st && st.title === 'Bristol Flyers v Manchester Basketball' && st.league_slug === 'slb' && st.source_name === 'Super League Basketball'
       && st.game && st.game.id && /youtube\.com\/watch\?v=cccccccccc1$/.test(st.url), st);
    ok('...a stream that is a channel\'s video too is listed once, as the channel\'s', full.filter(r => r.video_id === 'aaaaaaaaaa9').length === 1
       && full.find(r => r.video_id === 'aaaaaaaaaa9').id === KV);
    ok('...a live game\'s stream is not a full game yet (LIVE has it)', !full.some(r => r.video_id === 'cccccccccc1' && r.game && r.game.status === 'live'));
    ok('...one league\'s alone', (await as(null, `select * from public.video_full_games($1, null, 30)`, [L2])).length === 0
       && (await as(null, `select * from public.video_full_games($1, null, 30)`, [L])).length === full.length);
    /* a private league's finished game with a stream: nobody outside it sees it */
    const LQ = (await one(`insert into public.leagues (slug, name, visibility) values ('priv-q', 'Private Q', 'private') returning id`)).id;
    const CQ = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                           insert into public.competitions (season_id, name) select id, 'Q' from s returning id`, [LQ])).id;
    const QA = (await one(`insert into public.teams (league_id, slug, name) values ($1, 'qa1', 'Q One') returning id`, [LQ])).id;
    const QB = (await one(`insert into public.teams (league_id, slug, name) values ($1, 'qb1', 'Q Two') returning id`, [LQ])).id;
    const QG = (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at) values ($1, $2, $3, 'final', now() - interval '3 hours') returning id`, [CQ, QA, QB])).id;
    await q(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary) values ($1, 'youtube', '', 'ffffffffff1', true)`, [QG]);
    ok("...never a private league's game", !(await as(null, `select * from public.video_full_games(null, null, 60)`)).some(r => r.video_id === 'ffffffffff1'));
    const vids = await as(null, `select * from public.video_feed(null, 'video', null, 60)`);
    const hl = await as(null, `select * from public.video_feed(null, 'highlights', null, 60)`);
    ok("video_feed: VIDEOS is what is neither highlights nor a full game; HIGHLIGHTS the highlights",
       !vids.some(r => r.video_kind === 'full' || r.video_kind === 'highlights') && hl.length > 0 && hl.every(r => r.video_kind === 'highlights'),
       { vids: vids.map(r => r.video_kind), hl: hl.map(r => r.video_kind) });
    ok("...and FULL the full games", (await as(null, `select * from public.video_feed(null, 'full', null, 60)`)).every(r => r.video_kind === 'full'));
    const lf = await as(null, `select * from public.video_leagues('full')`), lh = await as(null, `select * from public.video_leagues('highlights')`);
    ok("the leagues' strip on FULL GAMES: the league, its full games counted once each (its channel's and its games' streams)",
       lf.length === 1 && lf[0].slug === 'slb' && lf[0].videos === full.length && lf[0].name === 'Super League Basketball', { lf, n: full.length });
    ok('...on HIGHLIGHTS, the leagues with highlights', lh.some(x => x.slug === 'slb') && !lh.some(x => x.slug === 'priv-q'), lh);

    /* PRESS CONFERENCES (0244): a kind of their own, on their game, last in its list */
    /* read as a press conference, then put on its game by the matcher (a matched video keeps its kind: 0241) */
    const PR = await item(S, 'pppppppppp1', 'Post-game press conference | Bristol Flyers', null, false, new Date().toISOString());
    await q(`update public.news_items set video_kind = 'press' where id = $1`, [PR]);
    await q(`update public.news_items set game_id = $2 where id = $1`, [PR, G]);
    ok('a video may be a press conference now (the check takes it)', (await one(`select video_kind from public.news_items where id = $1`, [PR])).video_kind === 'press');
    const pf = await as(null, `select * from public.video_feed(null, 'press', null, 60)`);
    ok('PRESS CONFERENCES: the press conferences alone; VIDEOS has none of them', pf.length === 1 && pf[0].id === PR
       && !(await as(null, `select * from public.video_feed(null, 'video', null, 60)`)).some(r => r.id === PR), pf.map(r => r.id));
    ok("...and the leagues' strip on it", (await as(null, `select * from public.video_leagues('press')`)).some(x => x.slug === 'slb'));
    const gh = await as(null, `select * from public.game_highlights($1)`, [G]);
    const order = gh.map(r => r.video_kind), rank = { highlights: 0, full: 1, press: 2, video: 3 };
    ok("the game page's list: the game's highlights, then its whole game, then its press conferences",
       gh.some(r => r.id === PR) && order.every((k, i) => i === 0 || rank[order[i - 1]] <= rank[k]) && order[order.length - 1] === 'press', order);

    /* WATCH HERE (game_watch); the live section's games found again by their stream */
    const L3 = (await one(`select g.id from public.games g join public.game_videos v on v.game_id = g.id where v.video_ref = 'cccccccccc1' and g.status = 'final' limit 1`)).id;
    const L1 = (await one(`select g.id from public.games g join public.game_videos v on v.game_id = g.id where v.video_ref = 'cccccccccc1' and g.status = 'live' and g.stalled_since is null limit 1`)).id;
    const w1 = (await as(null, `select public.game_watch($1) as j`, [G]))[0].j;
    ok("WATCH HERE: a finished game's best video - its whole game, the channel's copy first - with its game",
       w1 && w1.live === false && w1.video && w1.video.kind === 'full' && w1.video.video_id === 'aaaaaaaaaa9' && w1.video.id === KV
       && w1.game_json && w1.game_json.home && w1.game_json.home.name === 'Bristol Flyers', w1);
    const w3 = (await as(null, `select public.game_watch($1) as j`, [L3]))[0].j;
    ok('...a finished game with only its own stream: that stream, as a full game, titled with its clubs',
       w3 && w3.video && w3.video.kind === 'full' && w3.video.video_id === 'cccccccccc1' && w3.video.title === 'Bristol Flyers v Manchester Basketball', w3);
    const wl = (await as(null, `select public.game_watch($1) as j`, [L1]))[0].j;
    ok('...a game streaming now: live, its stream', wl && wl.live === true && wl.video && wl.video.kind === 'live', wl);
    const wh = (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at) values ($1, $2, $3, 'final', now() - interval '5 hours') returning id`, [C, MAN, BRI])).id;
    await item(S, 'hhhhhhhhhh1', 'HIGHLIGHTS: Manchester vs Bristol', wh, false, new Date().toISOString());
    const w4 = (await as(null, `select public.game_watch($1) as j`, [wh]))[0].j;
    ok('...a game with highlights alone: its highlights', w4 && w4.video && w4.video.kind === 'highlights' && w4.video.video_id === 'hhhhhhhhhh1', w4);
    const none = (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at) values ($1, $2, $3, 'final', now() - interval '6 hours') returning id`, [C, MAN, BRI])).id;
    const w5 = (await as(null, `select public.game_watch($1) as j`, [none]))[0].j;
    ok('...a game with nothing to watch: no video, not live', w5 && w5.video === null && w5.live === false, w5);
    ok("...and a private league's game is nobody else's to ask about", (await as(null, `select public.game_watch($1) as j`, [QG]))[0].j === null);
  }

  console.log('\na league\'s own channel, its videos on its games (0245)');
  {
    const tgt = async (lg, ref) => (await one(`insert into public.league_stream_targets (league_id, label, platform, server, stream_key, channel_ref)
        values ($1, 'Main channel', 'youtube', 'rtmps://a.rtmps.youtube.com:443/live2', 'secret-key-1234', $2) returning id`, [lg, ref])).id;
    const T1 = await tgt(L, 'UCaaaaaaaaaaaaaaaaaaaaaa'), TNO = await tgt(L, '');
    let r = await as(LA, `select * from public.stream_target_videos($1)`, [L]);
    ok("the console's read: each YouTube destination, its videos not read yet", r.length === 2 && r.every(x => x.video_mode === 'none'), r);
    ok('...nobody else\'s to read or switch', (await tryAs(FAN, `select * from public.stream_target_videos($1)`, [L])).length === 0
       && /cannot change/.test((await tryAs(LA2, `select public.set_stream_target_videos($1, 'seeking')`, [T1])).error || '')
       && (await tryAs(null, `select public.set_stream_target_videos($1, 'seeking')`, [T1])).error);
    ok('...a destination with no channel id cannot be switched on', /channel id/.test((await tryAs(LA, `select public.set_stream_target_videos($1, 'highlights')`, [TNO])).error || ''));
    const on = (await as(LA, `select public.set_stream_target_videos($1, 'seeking') as j`, [T1]))[0].j;
    const s1 = await one(`select * from public.news_sources where id = $1`, [on.source]);
    ok("FULL GAMES (event seeking): the channel becomes one of the league's channels, read as any other",
       on.mode === 'seeking' && s1 && s1.league_id === L && s1.video_mode === 'seeking' && s1.enabled && s1.platform === 'youtube'
       && s1.feed_url === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCaaaaaaaaaaaaaaaaaaaaaa' && on.slug === s1.slug, { on, s1 });
    r = await as(LA, `select * from public.stream_target_videos($1)`, [L]);
    ok('...and the console says so', r.find(x => x.id === T1).video_mode === 'seeking' && r.find(x => x.id === T1).source_slug === s1.slug, r);
    const hi = (await as(LA, `select public.set_stream_target_videos($1, 'highlights') as j`, [T1]))[0].j;
    ok('HIGHLIGHTS: the same source, its videos highlights now (no second source)', hi.source === on.source
       && (await one(`select video_mode from public.news_sources where id = $1`, [on.source])).video_mode === 'highlights'
       && (await one(`select count(*)::int as n from public.news_sources where feed_url like '%UCaaaaaaaaaaaaaaaaaaaaaa%'`)).n === 1);
    await as(LA, `select public.set_stream_target_videos($1, 'none')`, [T1]);
    ok('OFF: the source is switched off (kept for the record)', (await one(`select enabled from public.news_sources where id = $1`, [on.source])).enabled === false
       && (await as(LA, `select * from public.stream_target_videos($1)`, [L])).find(x => x.id === T1).video_mode === 'none');
    await as(LA, `select public.set_stream_target_videos($1, 'highlights')`, [T1]);
    ok('...and on again, the same source', (await one(`select enabled from public.news_sources where id = $1`, [on.source])).enabled === true);
    /* a channel the league reads already under Creators & news sources: that one, not a second */
    const OWN = (await one(`insert into public.news_sources (league_id, slug, name, site_url, feed_url, kind, platform, video_mode)
        values ($1, 'slb-own', 'SLB on YouTube', 'https://www.youtube.com/@slb', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCbbbbbbbbbbbbbbbbbbbbbb', 'creator', 'youtube', 'off') returning id`, [L])).id;
    const T2 = await tgt(L, 'UCbbbbbbbbbbbbbbbbbbbbbb');
    const re = (await as(LA, `select public.set_stream_target_videos($1, 'seeking') as j`, [T2]))[0].j;
    ok("a channel the league reads already is used, its mode set (not a second source)", re.source === OWN
       && (await one(`select video_mode from public.news_sources where id = $1`, [OWN])).video_mode === 'seeking');
    ok('the platform\'s administrator may switch it too', !(await tryAs(PA, `select public.set_stream_target_videos($1, 'highlights')`, [T2])).error);
    ok('a mode that is none of the three is refused', /none, highlights or seeking/.test((await tryAs(LA, `select public.set_stream_target_videos($1, 'all')`, [T2])).error || ''));
  }

  console.log('\na video\'s game');
  const gj = (await one(`select public.video_game_json($1) as j`, [G])).j;
  ok('carries each club\'s second colour', gj.home.colour_2 === '#071728' && gj.away.colour_2 === '#4271b7', gj);

  console.log('\na source\'s title filter (0246)');
  {
    const tp = async (t, i, e) => (await one(`select public.news_title_passes($1, $2::text[], $3::text[]) as p`, [t, i, e])).p;
    ok('KEEP ONLY one of, NEVER any of, as words, whatever the case and the accents',
       await tp('Résumé | Paris - Monaco | Betclic ÉLITE (J3)', ['Betclic Elite'], []) === true && await tp('Ligue 1 : PSG - OM', ['Betclic Elite'], []) === false
       && await tp('Betclic ELITE Espoirs : Paris - Monaco', ['betclic elite'], ['Espoirs']) === false && await tp('Anything at all', [], []) === true
       && await tp('Visit elitebasket.fr', ['elite'], []) === false && await tp('Pro B | Rouen - Fos', [], ['Pro B']) === false);
    const SF = await src(L, 'dazn-france');
    const it2 = async (guid, title, locked) => (await one(`insert into public.news_items (source_id, guid, url, title, published_at, video_id, video_kind, game_locked, game_id)
        values ($1, $2, 'https://www.youtube.com/watch?v=' || $2, $3, now(), $2, 'video', $4, case when $4 then $5::uuid end) returning id`, [SF, guid, title, locked, G])).id;
    const K1 = await it2('dddddddddd1', 'Résumé | Paris - Monaco | Betclic ÉLITE (J3)', false);
    const K2 = await it2('dddddddddd2', 'Ligue 1 : PSG - OM', false);
    const K3 = await it2('dddddddddd3', 'Top 14 : Toulouse - La Rochelle', true);
    ok('nobody but the channel\'s administrators may set it', /not allowed/.test((await tryAs(FAN, `select public.set_news_source_filter($1, array['x1'], null)`, [SF])).error || '')
       && /not allowed/.test((await tryAs(LA2, `select public.set_news_source_filter($1, array['x1'], null)`, [SF])).error || '')
       && /not allowed/.test((await tryAs(LA, `select public.set_news_source_filter($1, array['x1'], null)`, [SG])).error || ''));
    const r = (await as(LA, `select public.set_news_source_filter($1, array['Betclic Elite', ' betclic élite ', ''], array['Espoirs']) as j`, [SF]))[0].j;
    const left = (await q(`select id from public.news_items where source_id = $1`, [SF])).map(x => x.id);
    ok('set: each list tidied (a phrase once, whatever its case and accents); the posts already read that fail it taken off, one put on a game by hand kept',
       JSON.stringify(r.include) === JSON.stringify(['Betclic Elite']) && JSON.stringify(r.exclude) === JSON.stringify(['Espoirs']) && r.removed === 1
       && left.includes(K1) && !left.includes(K2) && left.includes(K3), { r, left });
    const f = await as(LA, `select * from public.news_source_filters($1)`, [[SF, S]]);
    ok("the console's read: the source's filter", f.find(x => x.id === SF).title_include.join() === 'Betclic Elite' && f.find(x => x.id === S).title_include.length === 0, f);
    ok('a phrase is 2 to 60 characters, twenty at most a list', /2 to 60/.test((await tryAs(LA, `select public.set_news_source_filter($1, array['x'], null)`, [SF])).error || '')
       && /twenty/.test((await tryAs(LA, `select public.set_news_source_filter($1, (select array_agg('word ' || g) from generate_series(1, 21) g), null)`, [SF])).error || ''));
    await as(LA, `select public.set_news_source_filter($1, null, null)`, [SF]);
    ok('...and emptied, every post again', (await one(`select cardinality(title_include) as n from public.news_sources where id = $1`, [SF])).n === 0);
  }

  console.log('\nonly vetted streams (0247)');
  {
    /* the league here has a registered stream destination, so its live games are listed with the league's own channel;
       what vetting decides is whether the game's own video is carried: the video ids LIVE carries */
    const lv = async () => ((await as(null, `select public.live_streams() as j`))[0].j || []).filter(x => x.video).map(x => x.id);
    const game = async ago => (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at, home_score, away_score)
        values ($1, $2, $3, 'live', now() - $4::interval, 10, 12) returning id`, [C, MAN, BRI, ago])).id;
    const V1 = await game('15 minutes');
    const gv = (await one(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary, is_live)
        values ($1, 'youtube', 'https://www.youtube.com/watch?v=rrrrrrrrrr1', 'rrrrrrrrrr1', true, true) returning id`, [V1])).id;
    ok("a stream nobody vetted (the ingest found it on a stranger's channel): its video not on LIVE (the league's own channel is)",
       !(await lv()).includes(V1) && ((await as(null, `select public.live_streams() as j`))[0].j || []).some(x => x.id === V1 && !x.video && x.channel));
    await q(`update public.game_videos set channel_ref = 'UCzzzzzzzzzzzzzzzzzzzzzz' where id = $1`, [gv]);
    ok("...on a channel the league has not registered: still not", !(await lv()).includes(V1));
    await q(`update public.game_videos set channel_ref = 'UCaaaaaaaaaaaaaaaaaaaaaa' where id = $1`, [gv]);
    ok("...on the league's stream destination's channel: on LIVE", (await lv()).includes(V1));
    const chans = (await one(`select public.vetted_channels($1) as c`, [L])).c;
    ok("the league's registered channels: its stream destinations and its YouTube sources (switched on)",
       chans.includes('UCaaaaaaaaaaaaaaaaaaaaaa') && chans.includes('UCbbbbbbbbbbbbbbbbbbbbbb'), chans);
    await q(`insert into public.schedule_sources (league_id, label, adapter, schedule_url, adapter_config) values ($1, 'feed', 'fiba_livestats', 'https://example.invalid/', '{"youtube_channel": "UCcccccccccccccccccccccc"}'::jsonb)`, [L])
      .catch(e => console.log('  (schedule_sources: ' + e.message + ')'));
    ok("...and the ingest's own channel for the league", (await one(`select public.vetted_channels($1) as c`, [L])).c.includes('UCcccccccccccccccccccccc'));
    const V2 = await game('10 minutes');
    await q(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary, is_live) values ($1, 'youtube', 'https://www.youtube.com/watch?v=aaaaaaaaaa2', 'aaaaaaaaaa2', true, true)`, [V2]);
    ok("a registered source's video the matcher put on the game: vetted", (await lv()).includes(V2));
    const V3 = await game('5 minutes');
    await q(`insert into public.game_videos (game_id, provider, url, video_ref, is_primary, is_live) values ($1, 'twitch', 'https://www.twitch.tv/x', 'x', true, true)`, [V3]);
    ok("a stream with no channel and no person: not vetted", !(await lv()).includes(V3));
    await q(`update public.game_videos set created_by = $2 where game_id = $1`, [V3, LA]);
    ok("...put there by a person: vetted", (await lv()).includes(V3));
    ok("the league's channel lists are the ingest's alone (no reader may list them)", (await tryAs(null, `select public.vetted_channels($1)`, [L])).error
       && (await tryAs(FAN, `select public.vetted_channels_for_game($1)`, [V1])).error);
    const lm = (await as(null, `select public.league_media($1) as j`, [L]))[0].j;
    const lmV = g => (lm.live || []).find(x => x.id === g);
    await q(`update public.game_videos set channel_ref = null where id = $1`, [gv]);
    const lm2 = (await as(null, `select public.league_media($1) as j`, [L]))[0].j;
    /* A CLUB'S VIDEOS (0248 team_videos) */
    const tv = async (team, k) => await as(null, `select * from public.team_videos($1, $2, null, 60)`, [team, k]);
    /* an interview naming the club, on no game (the matcher found the club in its title) */
    const NM = await item(S, 'nnnnnnnnnn1', 'Bristol Flyers: the coach on the season ahead', null, false, new Date().toISOString());
    await q(`update public.news_items set match_clubs = array[$2]::uuid[], video_kind = 'video' where id = $1`, [NM, BRI]);
    const bri = await tv(BRI, null);
    ok("a club's videos: those on its games (any kind), and a video naming it on no game (match_clubs)",
       bri.some(r => r.id === KV) && bri.some(r => r.video_kind === 'press') && bri.some(r => r.id === NM) && bri.every(r => r.video_id), bri.map(r => [r.video_id, r.video_kind]));
    ok("...its finished games' vetted streams among its FULL GAMES, listed once", (await tv(BRI, 'full')).some(r => r.video_id === 'cccccccccc1')
       && (await tv(BRI, 'full')).filter(r => r.video_id === 'aaaaaaaaaa9').length === 1 && (await tv(BRI, 'full')).every(r => r.video_kind === 'full'));
    ok("...each button its own kind (PRESS CONFERENCES the press conferences)", (await tv(BRI, 'press')).every(r => r.video_kind === 'press') && (await tv(BRI, 'press')).length >= 1
       && (await tv(BRI, 'highlights')).every(r => r.video_kind === 'highlights'));
    ok("...another club's are not its own", !(await tv(OTH, null)).some(r => r.id === KV || r.id === NM));
    ok("...newest first", bri.every((r, i) => i === 0 || new Date(bri[i - 1].published_at) >= new Date(r.published_at)));
    /* THE FEED IS NEWS (0251): the videos are the video section's */
    const NS = (await one(`insert into public.news_sources (league_id, slug, name, site_url, feed_url, kind, platform)
        values ($1, 'slb-news', 'SLB News', 'https://example.invalid/', 'https://example.invalid/feed', 'publisher', 'website') returning id`, [L])).id;
    const STORY = (await one(`insert into public.news_items (source_id, guid, url, title, published_at)
        values ($1, 'story-1', 'https://example.invalid/story-1', 'Flyers sign a new guard', now()) returning id`, [NS])).id;
    const YTLINK = (await one(`insert into public.news_items (source_id, guid, url, title, published_at)
        values ($1, 'story-2', 'https://youtu.be/abcdefghijk', 'Watch: the signing', now()) returning id`, [NS])).id;
    const nf = await as(null, `select * from public.news_feed($1, null, 60)`, [L]);
    ok("the news feed: the stories, no YouTube video (with a video id, from a YouTube channel, or at a YouTube address)",
       nf.some(r => r.id === STORY) && !nf.some(r => r.id === YTLINK || r.id === KV || r.id === I2 || r.url.includes('youtube.com')), nf.map(r => r.title));
    ok("...the videos are still the video section's", (await as(null, `select * from public.video_feed(null, null, null, 60)`)).some(r => r.id === KV));
    ok("the league's Live tab: a vetted stream carried, an unvetted one not (the game listed with no video)",
       lmV(V1) && lmV(V1).video && (lm2.live || []).find(x => x.id === V1) && !(lm2.live || []).find(x => x.id === V1).video, { lm: lmV(V1) });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
