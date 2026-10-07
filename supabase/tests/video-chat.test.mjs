/* ============================================================================
   HIGHLIGHTS, THE VIDEO FEED AND THE LIVE CHAT (0237, 2026-10-07), on every migration (PGlite).

     * a channel's mode (highlights | seeking | off) is its league's administrators' or the platform's to set;
       the console sees each channel's mode and how many of its videos are on a game;
     * a league's Video tab: its games' highlights (never an 'off' channel's, never another league's, never a
       private league's for a reader who cannot see it), and with no kind every video about the league;
     * a game's videos; HOME's video feed in news_feed's columns plus the video's, split highlights / the rest,
       carrying the game's league; a fan's own by the leagues, clubs and sources they follow;
     * a video put on a game by hand is locked there;
     * the chat: the gate (signed in, a username, 18 or over, a public open league with its chat on that is not a
       youth league, a game that is on, the word list, no links, the slow-down, the mute) and the store are the
       edge function's alone; a shown message goes out on chat:<game> without a user id, a blocked one nowhere;
       readers read the shown ones; three reports, the author or an admin take one down, and the room is told;
     * no read returns a user id, and the tables are closed to readers.

     node supabase/tests/video-chat.test.mjs        (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0237_video_highlights_chat.sql');
console.log('the migration');
ok('the chat\'s writes are granted to the service role only',
   /grant execute on function public\.chat_gate\(uuid, uuid, text, boolean\) to service_role;/.test(mig)
   && /grant execute on function public\.chat_store\(uuid, uuid, text, text, text, text, text, text, text\) to service_role;/.test(mig)
   && /revoke all on public\.game_chat from anon, authenticated;/.test(mig));
ok('the room is a public broadcast topic, chat:<game>, as 0157\'s frames are', /'chat:' \|\| new\.game_id, false\)/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  ok('every migration applies, 0237 among them', !failed || failed.length === 0, failed);
  const as = async (uid, role, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify(uid ? { sub: uid, role: role || 'authenticated' } : { role: role || 'anon' })]);
    await db.exec(`set role ${role || (uid ? 'authenticated' : 'anon')}`);
    try { return (await db.query(sql, p)).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
  };
  const tryAs = async (...a) => { try { return await as(...a); } catch (e) { return { error: e.message }; } };

  /* the world: Liga Endesa (public), a private league, a youth league; two clubs, three games, four channels */
  const one = async (s, p) => (await q(s, p))[0];
  const L = (await one(`insert into public.leagues (slug, name) values ('acb', 'Liga Endesa') returning id`)).id;
  const LP = (await one(`insert into public.leagues (slug, name, visibility) values ('priv', 'Private', 'private') returning id`)).id;
  const LY = (await one(`insert into public.leagues (slug, name, go_photos) values ('u18', 'Junior League', false) returning id`)).id;
  const C = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                        insert into public.competitions (season_id, name) select id, 'Liga Endesa' from s returning id`, [L])).id;
  const CP = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                         insert into public.competitions (season_id, name) select id, 'Priv' from s returning id`, [LP])).id;
  const CY = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
                         insert into public.competitions (season_id, name) select id, 'U18' from s returning id`, [LY])).id;
  const team = async (lg, slug, name) => (await one(`insert into public.teams (league_id, slug, name) values ($1, $2, $3) returning id`, [lg, slug, name])).id;
  const RM = await team(L, 'real-madrid', 'Real Madrid'), FCB = await team(L, 'barcelona', 'FC Barcelona');
  const PA = await team(LP, 'pa', 'Priv A'), PB = await team(LP, 'pb', 'Priv B');
  const YA = await team(LY, 'ya', 'Youth A'), YB = await team(LY, 'yb', 'Youth B');
  const game = async (c, h, a, status, ago) => (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at, home_score, away_score)
      values ($1, $2, $3, $4, now() - $5::interval, 88, 80) returning id`, [c, h, a, status, ago])).id;
  const GF = await game(C, RM, FCB, 'final', '1 day');
  const GL = await game(C, FCB, RM, 'live', '1 hour');
  const GP = await game(CP, PA, PB, 'live', '1 hour');
  const GY = await game(CY, YA, YB, 'live', '1 hour');
  await q(`update public.leagues set public_live = true`);
  const src = async (lg, slug, mode) => (await one(`insert into public.news_sources (league_id, slug, name, site_url, feed_url, kind, platform, video_mode)
      values ($1, $2, $2, 'https://www.youtube.com/', 'https://www.youtube.com/feeds/videos.xml?channel_id=UC' || md5($2), 'creator', 'youtube', $3) returning id`, [lg, slug, mode])).id;
  const SH = await src(L, 'acb-tv', 'highlights'), SG = await src(null, 'global', 'highlights'), SO = await src(L, 'off-ch', 'off'), SP = await src(LP, 'priv-ch', 'highlights');
  const item = async (s, guid, title, vid, kind, g, leagues, ago) => (await one(`insert into public.news_items (source_id, guid, url, title, published_at, video_id, video_kind, game_id, league_ids)
      values ($1, $2, 'https://www.youtube.com/watch?v=' || $4, $3, now() - $8::interval, $4, $5, $6, $7) returning id`,
      [s, guid, title, vid, kind, g, leagues || [], ago || '1 hour'])).id;
  await item(SH, 'g1', 'Highlights RM v BAR', 'abcdefghijk', 'highlights', GF, null, '20 hours');
  const IV = await item(SG, 'g2', 'Interview', 'bbcdefghijk', 'video', null, [L], '2 hours');
  await item(SO, 'g3', 'Off highlights', 'cbcdefghijk', 'highlights', GF, [L]);
  await item(SP, 'g4', 'Private highlights', 'dbcdefghijk', 'highlights', GP);
  await q(`insert into public.news_items (source_id, guid, url, title, published_at) values ($1, 'a1', 'https://x.example/a', 'An article', now())`, [SG]);

  const user = async email => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const FAN = await user('fan@example.invalid'), NEW = await user('new@example.invalid'), ADM = await user('admin@example.invalid');
  const R1 = await user('r1@example.invalid'), R2 = await user('r2@example.invalid'), R3 = await user('r3@example.invalid');
  await q(`insert into public.usernames (user_id, username) values ($1, 'hoopfan'), ($2, 'boss')`, [FAN, ADM]);
  await q(`insert into public.go_settings (user_id, public, adult_confirmed_at) values ($1, true, now())`, [FAN]);
  await q(`insert into public.fan_profiles (user_id, avatar_url) values ($1, 'https://x.example/a.png')`, [FAN]).catch(e => console.log('  (fan_profiles: ' + e.message + ')'));
  await q(`insert into public.memberships (user_id, role, scope_type) values ($1, 'platform_admin', 'platform')`, [ADM]).catch(e => console.log('  (memberships: ' + e.message + ')'));
  await q(`insert into public.fan_prefs (user_id, fav_team_ids) values ($1, array[$2]::uuid[])`, [FAN, FCB]);

  console.log('\nthe reads');
  let r = await as(null, null, `select * from public.league_videos($1, 'highlights')`, [L]);
  ok("a league's highlights: its game's, not the 'off' channel's", r.length === 1 && r[0].video_id === 'abcdefghijk' && r[0].game && r[0].game.home.name === 'Real Madrid', r);
  r = await as(null, null, `select * from public.league_videos($1)`, [L]);
  ok('every video about the league: also the one only tagged with it', r.map(x => x.video_id).sort().join() === 'abcdefghijk,bbcdefghijk', r.map(x => x.video_id));
  r = await as(null, null, `select * from public.league_videos($1)`, [LP]);
  ok("a private league's videos are not a stranger's to see", r.length === 0, r);
  r = await as(null, null, `select * from public.game_highlights($1)`, [GF]);
  ok("a game's videos", r.length === 1 && r[0].video_kind === 'highlights', r);
  r = await as(null, null, `select * from public.video_feed(null, null)`);
  ok('the video feed: videos only, no off channel, no private league', r.map(x => x.video_id).sort().join() === 'abcdefghijk,bbcdefghijk', r.map(x => x.video_id));
  const hl = r.find(x => x.video_id === 'abcdefghijk');
  ok("...in news_feed's columns, a matched video carrying its game and its game's league", hl && hl.kind === 'channel' && hl.piece_kind === 'youtube'
     && hl.league_slug === 'acb' && hl.leagues.some(l => l.slug === 'acb') && hl.game && hl.game.league.slug === 'acb', hl);
  ok("'highlights' and 'video' split it", (await as(null, null, `select video_id from public.video_feed(null, 'highlights')`)).length === 1
     && (await as(null, null, `select video_id from public.video_feed(null, 'video')`)).map(x => x.video_id).join() === 'bbcdefghijk');
  r = await as(FAN, null, `select * from public.video_feed_mine(null)`);
  ok("a fan's own: the highlights of a club they follow", r.some(x => x.video_id === 'abcdefghijk'), r.map(x => x.video_id));
  ok('...signed out: refused', !!(await tryAs(null, null, `select * from public.video_feed_mine(null)`)).error);

  console.log('\nthe channel\'s switch');
  ok('a fan cannot change a channel', /not allowed/.test((await tryAs(FAN, null, `select public.set_news_video_mode($1, 'seeking')`, [SH])).error || ''));
  r = await tryAs(ADM, null, `select public.set_news_video_mode($1, 'seeking') v`, [SH]);
  ok('the platform admin can', r[0] && r[0].v === true && (await one(`select video_mode from public.news_sources where id = $1`, [SH])).video_mode === 'seeking', r);
  r = await tryAs(ADM, null, `select * from public.news_video_modes(array[$1]::uuid[])`, [SH]);
  ok('the console sees the mode and the counts', r.length === 1 && r[0].videos === 1 && r[0].matched === 1, r);
  await tryAs(ADM, null, `select public.set_news_item_game($1, $2)`, [IV, GL]);
  const it = await one(`select game_id, game_locked, video_kind from public.news_items where id = $1`, [IV]);
  ok('a video put on a game by hand is locked there, and is its highlights', it.game_locked && it.game_id === GL && it.video_kind === 'highlights', it);

  console.log('\nthe chat');
  const gate = async (u, g, b, adult) => (await as(null, 'service_role', `select public.chat_gate($1, $2, $3, $4) v`, [u, g, b, !!adult]))[0].v;
  ok('the gate is the edge function\'s alone', /permission denied/.test((await tryAs(FAN, null, `select public.chat_gate($1, $2, 'hi', false)`, [FAN, GL])).error || ''));
  ok('signed out: no', (await gate(null, GL, 'hi')).reason === 'signed_out');
  ok('no username: no', (await gate(NEW, GL, 'hi')).reason === 'username');
  await q(`insert into public.usernames (user_id, username) values ($1, 'newbie')`, [NEW]);
  ok('18 or over not yet confirmed: asked', (await gate(NEW, GL, 'hi')).reason === 'adult');
  r = await gate(NEW, GL, 'hi', true);
  ok('...ticked: through, recorded, and no picture for a fan who is not public', r.ok && r.avatar == null
     && !!(await one(`select adult_confirmed_at from public.go_settings where user_id = $1`, [NEW])).adult_confirmed_at, r);
  r = await gate(FAN, GL, '  great   block!  ');
  ok('a public fan: through, the text tidied, their picture, the game for the moderator', r.ok && r.body === 'great block!' && r.home === 'FC Barcelona' && r.league === 'Liga Endesa', r);
  ok('a private league, a youth league: closed', (await gate(FAN, GP, 'hi')).reason === 'closed' && (await gate(FAN, GY, 'hi')).reason === 'closed');
  ok('a game that ended a day ago: not now', (await gate(FAN, GF, 'hi')).reason === 'not_now');
  ok('no links, not even a bare domain', (await gate(FAN, GL, 'see www.example.com')).reason === 'link' && (await gate(FAN, GL, 'cheap at stuff.net')).reason === 'link');
  ok('280 characters at most', (await gate(FAN, GL, 'x'.repeat(281))).reason === 'long');
  await q(`update public.leagues set chat_enabled = false where id = $1`, [L]);
  ok('a league with its chat off: closed', (await gate(FAN, GL, 'hi')).reason === 'closed');
  await q(`update public.leagues set chat_enabled = true where id = $1`, [L]);

  const store = async (u, b, st) => (await as(null, 'service_role', `select public.chat_store($1, $2, $3, 'hoopfan', null, $4, 'ok', null, 'm') v`, [u, GL, b, st]))[0].v;
  const before = (await one(`select count(*)::int n from realtime.messages`)).n;
  const M1 = await store(FAN, 'great block!', 'shown');
  let sent = await q(`select * from realtime.messages order by id offset $1`, [before]);
  ok('a shown message goes out on chat:<game> as msg, public, with no user id', sent.length === 1 && sent[0].topic === 'chat:' + GL && sent[0].event === 'msg'
     && sent[0].private === false && !JSON.stringify(sent[0].payload).includes(FAN), sent);
  ok('one message every four seconds', (await gate(FAN, GL, 'again')).reason === 'slow');
  await q(`update public.game_chat set created_at = now() - interval '1 minute'`);
  await store(FAN, 'nasty', 'blocked');
  ok('a blocked message goes nowhere', (await one(`select count(*)::int n from realtime.messages`)).n === before + 1);
  r = await as(null, null, `select * from public.game_chat_read($1)`, [GL]);
  ok('readers read the shown message, with no user id', r.length === 1 && r[0].body === 'great block!' && r[0].mine === false && !('user_id' in r[0]), r);
  ok('...its author reads it as theirs', (await as(FAN, null, `select * from public.game_chat_read($1)`, [GL]))[0].mine === true);
  for (let i = 0; i < 2; i++) { await q(`update public.game_chat set created_at = now() - interval '1 minute'`); await store(FAN, 'nasty ' + i, 'blocked'); }
  await q(`update public.game_chat set created_at = now() - interval '1 minute'`);
  ok('three blocked in ten minutes: muted', (await gate(FAN, GL, 'sorry')).reason === 'muted');
  r = (await as(FAN, null, `select public.chat_my_status($1) v`, [GL]))[0].v;
  ok("the reader's standing", r.signed_in && r.username === 'hoopfan' && r.adult && r.open && r.on && !r.admin, r);
  ok('nobody reports their own', (await as(FAN, null, `select public.report_chat($1) v`, [M1]))[0].v === false);
  for (const u of [R1, R2]) await as(u, null, `select public.report_chat($1)`, [M1]);
  ok('two reports: still shown', (await one(`select status from public.game_chat where id = $1`, [M1])).status === 'shown');
  await as(R3, null, `select public.report_chat($1)`, [M1]);
  ok('the third takes it down, and the room is told', (await one(`select status from public.game_chat where id = $1`, [M1])).status === 'hidden'
     && (await q(`select 1 from realtime.messages where event = 'hide' and topic = $1`, ['chat:' + GL])).length === 1);
  await q(`update public.game_chat set created_at = now() - interval '1 hour'`);
  const M2 = await store(FAN, 'hello again', 'shown');
  ok('another fan cannot take a message down', /not allowed/.test((await tryAs(R1, null, `select public.hide_chat($1)`, [M2])).error || ''));
  ok('its author can', (await as(FAN, null, `select public.hide_chat($1) v`, [M2]))[0].v === true);

  console.log('\nclosed');
  ok('the chat tables are closed to readers', /permission denied/.test((await tryAs(FAN, null, `select * from public.game_chat`)).error || '')
     && /permission denied/.test((await tryAs(FAN, null, `select * from public.game_chat_reports`)).error || ''));
  const res = await q(`select p.proname, pg_get_function_result(p.oid) r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname in ('league_videos','game_highlights','video_feed','video_feed_mine','game_chat_read')`);
  ok('no read returns a user id', res.length === 5 && res.every(x => !/user_id/.test(x.r)), res);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
