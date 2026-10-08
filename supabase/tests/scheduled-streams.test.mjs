/* ============================================================================
   SCHEDULED STREAMS (0256, Louie 2026-10-08), on every migration (PGlite):
     * a channel's "LIVE" video published ahead of its game is a SCHEDULED stream, not a full game: scheduled_streams
       lists the game (the next 14 days; 30 at most), games_watchable answers 'scheduled' for it;
     * a game with no stream, one too far ahead, one already played, one in a league the reader cannot see: not listed;
     * at tip-off the same video is the game's LIVE stream (live_streams), and its kind on the pill is 'live';
     * the game's followers are told once it goes live ('live', ref <game>:live), with a link into the stream; nobody else;
       notify_tick runs it;
     * the reads are open to a signed-out reader, the notice is not anyone's to send.
     node supabase/tests/scheduled-streams.test.mjs   (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0256_scheduled_streams.sql');
console.log('the migration');
ok('the notice kinds keep every earlier one and add live',
   /check \(kind in \('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy', 'test',\s+'news', 'creator', 'live'\)\)/.test(mig));
ok('notify_tick keeps every step of 0155 and adds the live one',
   ['notify_audience_refresh()', 'notify_fixture_windows()', 'notify_lineups()', 'notify_halftime()', 'notify_stream_live()', "'live', v_live"].every(s => mig.includes(s)));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0256 among them', !failed || failed.length === 0, failed);
  const as = async (uid, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try { return (await db.query(sql, p)).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
  };
  const tryAs = async (...a) => { try { return await as(...a); } catch (e) { return { error: e.message }; } };

  /* SLB: four clubs; a private league with its own two */
  const league = async (slug, vis) => (await one(`insert into public.leagues (slug, name, visibility, public_live) values ($1, $1, $2, true) returning id`, [slug, vis || 'public'])).id;
  const comp = async L => (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                                      insert into public.competitions (season_id, name) select id, 'Championship' from s returning id`, [L])).id;
  const team = async (L, slug, name) => (await one(`insert into public.teams (league_id, slug, name, short_name) values ($1, $2, $3, upper(left($2, 3))) returning id`, [L, slug, name])).id;
  const L = await league('slb'), C = await comp(L);
  const SHE = await team(L, 'sheffield', 'B. Braun Sheffield Sharks'), LEI = await team(L, 'leicester', 'Leicester Riders');
  const NEW = await team(L, 'newcastle', 'Newcastle Eagles'), BRI = await team(L, 'bristol', 'Bristol Flyers');
  const P = await league('hidden', 'private'), CP = await comp(P);
  const PH = await team(P, 'ph', 'Private Home'), PA = await team(P, 'pa', 'Private Away');
  const game = async (c, h, a, status, at) => (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at)
      values ($1, $2, $3, $4, now() + $5::interval) returning id`, [c, h, a, status, at])).id;
  const SOON = await game(C, SHE, LEI, 'scheduled', '3 days');          // the channel's stream, out ahead
  const BARE = await game(C, NEW, BRI, 'scheduled', '2 days');          // no stream
  const FAR = await game(C, LEI, NEW, 'scheduled', '20 days');          // a stream, beyond 14 days
  const OWN = await game(C, BRI, SHE, 'scheduled', '1 day');            // its own video (game_videos, vetted by hand)
  const LIVE = await game(C, NEW, SHE, 'live', '-10 minutes');          // a stream now
  const DONE = await game(C, LEI, BRI, 'final', '-2 days');             // played, its full game kept
  const PRIV = await game(CP, PH, PA, 'scheduled', '2 days');           // a stream, in a league the reader cannot see
  const S = (await one(`insert into public.news_sources (league_id, slug, name, site_url, feed_url, kind, platform, video_mode)
      values ($1, 'slb-yt', 'SLB', 'https://www.youtube.com/', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCslb', 'creator', 'youtube', 'seeking') returning id`, [L])).id;
  const SP = (await one(`insert into public.news_sources (league_id, slug, name, site_url, feed_url, kind, platform, video_mode)
      values ($1, 'p-yt', 'P', 'https://www.youtube.com/', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCp', 'creator', 'youtube', 'seeking') returning id`, [P])).id;
  const item = async (src, vid, title, g) => q(`insert into public.news_items (source_id, guid, url, title, published_at, video_id, video_kind, game_id, matched_at)
      values ($1, $2, 'https://www.youtube.com/watch?v=' || $2, $3, now() - interval '2 hours', $2, 'full', $4, now())`, [src, vid, title, g]);
  await item(S, 'slbSOON0001', 'LIVE SLB CHAMPIONSHIP ACTION: B. Braun Sheffield Sharks vs Leicester Riders', SOON);
  await item(S, 'slbFAR00001', 'LIVE SLB: Leicester Riders vs Newcastle Eagles', FAR);
  await item(S, 'slbLIVE0001', 'LIVE SLB: Newcastle Eagles vs B. Braun Sheffield Sharks', LIVE);
  await item(S, 'slbDONE0001', 'LIVE SLB: Leicester Riders vs Bristol Flyers', DONE);
  await item(SP, 'privPRIV001', 'LIVE: Private Home vs Private Away', PRIV);
  const ADMIN = (await one(`insert into auth.users (email) values ('admin@example.invalid') returning id`)).id;
  await q(`insert into public.game_videos (game_id, provider, url, video_ref, label, is_primary, is_live, created_by)
      values ($1, 'youtube', 'https://www.youtube.com/watch?v=ownOWN00001', 'ownOWN00001', 'Live stream', true, true, $2)`, [OWN, ADMIN]);

  console.log('\nSCHEDULED: the games still to come with a stream to be played here');
  const sched = await as(null, `select public.scheduled_streams() as j`);
  const ids = (sched[0].j || []).map(g => g.id);
  ok('a channel\'s "LIVE" video on a game still to come is a scheduled stream', ids.includes(SOON), ids);
  ok('...as is a game\'s own vetted stream', ids.includes(OWN), ids);
  ok('...soonest first', ids.indexOf(OWN) < ids.indexOf(SOON), ids);
  ok('not a game with no stream, a game played or live, a private league\'s', ![BARE, DONE, LIVE, PRIV].some(x => ids.includes(x)), ids);
  ok('not a game beyond the next 14 days...', !ids.includes(FAR), ids);
  const wide = (await as(null, `select public.scheduled_streams(30) as j`))[0].j.map(g => g.id);
  ok('...which a longer window takes (at most 30 days)', wide.includes(FAR), wide);
  const g0 = sched[0].j.find(g => g.id === SOON);
  ok('each with its game (clubs, league, tip-off, status) and the video to be played',
     g0 && g0.status === 'scheduled' && g0.home && g0.home.name === 'B. Braun Sheffield Sharks' && g0.league && g0.league.slug === 'slb'
     && g0.video && g0.video.ref === 'slbSOON0001' && g0.video.from === 'channel' && g0.tipoff_at && g0.league_id === L, g0);

  console.log('\nthe WATCH pill (games_watchable)');
  const kinds = Object.fromEntries((await as(null, `select game, kind from public.games_watchable($1::uuid[])`, [[SOON, OWN, BARE, LIVE, DONE, PRIV]])).map(r => [r.game, r.kind]));
  ok('a game still to come with a stream: scheduled (it was answered "full")', kinds[SOON] === 'scheduled' && kinds[OWN] === 'scheduled', kinds);
  ok('a game streaming now: live, from its channel\'s video too', kinds[LIVE] === 'live', kinds);
  ok('a game played: its full game, as before', kinds[DONE] === 'full', kinds);
  ok('nothing for a game with no video, nor a private league\'s', !kinds[BARE] && !kinds[PRIV], kinds);

  console.log('\nat tip-off: LIVE');
  const live = (await as(null, `select public.live_streams() as j`))[0].j;
  const lv = (live || []).find(g => g.id === LIVE);
  ok('a stream known only from the channel\'s feed now plays in LIVE', lv && lv.video && lv.video.ref === 'slbLIVE0001', live);

  console.log('\nthe notice');
  const FAN = (await one(`insert into auth.users (email) values ('fan@example.invalid') returning id`)).id;
  const OTHER = (await one(`insert into auth.users (email) values ('other@example.invalid') returning id`)).id;
  await q(`insert into public.fan_prefs (user_id, fav_game_ids) values ($1, array[$2]::uuid[]) on conflict (user_id) do update set fav_game_ids = excluded.fav_game_ids`, [FAN, LIVE]);
  await q(`insert into public.fan_prefs (user_id, fav_game_ids) values ($1, array[$2]::uuid[]) on conflict (user_id) do update set fav_game_ids = excluded.fav_game_ids`, [OTHER, BARE]);
  await q(`select public.notify_audience_refresh()`);
  const sent = (await one(`select public.notify_stream_live() as n`)).n;
  const rows = await q(`select user_id, kind, title, link, ref, urgency from public.notifications where kind = 'live'`);
  ok('the game\'s follower is told it is live, once, with a link into the stream',
     sent === 1 && rows.length === 1 && rows[0].user_id === FAN && rows[0].ref === LIVE + ':live'
     && rows[0].link === 'home/?view=video&play=' + LIVE && /^Live now: /.test(rows[0].title) && rows[0].urgency === 'high', rows);
  ok('...and not again on the next tick', (await one(`select public.notify_stream_live() as n`)).n === 0
     && (await q(`select 1 from public.notifications where kind = 'live'`)).length === 1);
  ok('nobody following another game is told', !rows.some(r => r.user_id === OTHER));
  const tick = (await one(`select public.notify_tick() as r`)).r;
  ok('notify_tick runs the step and counts it', tick && 'live' in tick && !(tick.errors || []).some(e => e.step === 'live'), tick);

  console.log('\nwho may');
  ok('a signed-out reader reads the scheduled streams', !(await tryAs(null, `select public.scheduled_streams()`)).error);
  const nope = await tryAs(FAN, `select public.notify_stream_live()`);
  ok('nobody but the service sends the notices', !!nope.error, nope);
  const raw = await tryAs(null, `select public.game_stream_video($1)`, [PRIV]);
  ok('the stream helper is not a reader\'s (it skips the game rules the reads apply)', !!raw.error, raw);
}

console.log('\nthe pages');
{
  const media = rd('epinoia', 'media.js'), hub = rd('epinoia', 'home', 'videohub.js'), W = rd('epinoia', 'watch.js');
  ok('a stream still to come is no video: every list of videos leaves it out (media.js uniq)',
     /function upcoming\(r\) \{\s*return !!\(r && r\.video_kind === 'full' && r\.game && r\.game\.status === 'scheduled'\);/.test(media)
     && /if \(!k \|\| upcoming\(r\)\) return;/.test(media) && /uniq, upcoming, prioritise/.test(media));
  /* the rule itself, run: media.js loads its upcoming() out of the source */
  const upcoming = new Function('return ' + /function upcoming\(r\) \{[\s\S]*?\n  \}/.exec(media)[0])();
  ok('...the channel\'s "LIVE" video on an unplayed game is upcoming; the same video once played, highlights, a pre-game press conference are not',
     upcoming({ video_kind: 'full', game: { status: 'scheduled' } }) && !upcoming({ video_kind: 'full', game: { status: 'final' } })
     && !upcoming({ video_kind: 'highlights', game: { status: 'final' } }) && !upcoming({ video_kind: 'press', game: { status: 'scheduled' } })
     && !upcoming({ video_kind: 'full' }));
  ok('the VIDEO view: SCHEDULED, a row that opens at the foot of LIVE (there with nothing live), read from scheduled_streams',
     /const sched = el\('details', 'vh-sched'\);/.test(hub) && /live\.append\(lh, gamesRow, theatre, sched\);/.test(hub)
     && /rpc\('scheduled_streams', \{ p_days: 14 \}\)/.test(hub) && /readLive\(true\), loadVideos\(\), readSched\(\)/.test(hub));
  ok('...before 0256, the channels\' streams already in the feed', /rpc\('video_full_games', \{ p_limit: 60 \}\)[\s\S]{0,200}M\.upcoming\(r\)/.test(hub));
  ok('...a card a league, the followed first then the soonest, each game with NOTIFY ME (the game\'s follow bell)',
     /schedFol\.has\(b\.id\)\) - Number\(schedFol\.has\(a\.id\)\)\)\s*\|\| \(\(Date\.parse\(a\.games\[0\]\.tipoff_at\)/.test(hub)
     && /F\.bell\('game', g\.id, \{ label: tr\('Notify me'\)/.test(hub));
  ok('...and a game asked for that is still to come (?play=, #scheduled) opens it there, not as a video', /\} else if \(showSched\(want\)\) \{/.test(hub)
     && /location\.hash === '#scheduled'/.test(hub));
  ok('the WATCH pill: a game still to come with a stream is "scheduled", its card says it is fed live here at tip-off, with NOTIFY ME',
     /scheduled: 'to be streamed live on EPINOIΛ from tip-off'/.test(W) && /Scheduled to be fed live on the website at tip-off/.test(W)
     && /F\.bell\('game', id, \{ label: 'Notify me'/.test(W) && /if \(o\.status === 'scheduled'\) \{ if \(kind !== 'full' && kind !== 'scheduled'\) return; kind = 'scheduled'; \}/.test(W));
  ok('...a league\'s own card on such a game leads with the same row, never "Full game · watch here"',
     /if \(!j\.live && gj && gj\.status === 'scheduled'\) \{\s*bd\.insertAdjacentHTML\('afterbegin', schedRowHTML\(id, gj\.tipoff_at\)\);/.test(W));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
