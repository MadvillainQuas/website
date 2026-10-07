/* ============================================================================
   PREDICTIONS AND WHERE TO WATCH (0239, predict.js, watch.js, the leaderboards).

     * the database: a pick needs a signed-in fan and an open game (scheduled, before tip-off); a pick can be changed
       and taken back; the tally is everyone's split and the caller's own pick; the board ranks by right picks then
       hit rate, shows a username or a fixed tag (never an id), and a league's board is that league's picks only;
       the table and the helpers are nobody's to read from a browser;
     * the pages: the fixture card carries the pill and the strip on the pages that load them; the pill's press never
       becomes the card's; the strip's sides are its only buttons; the game page puts the pill on its head and the
       pill and the strip on its preview; both leaderboards pages are built to the page standard and in the menus;
       the watch data is the spreadsheet's, made by tools/build-watch.py.

     node supabase/tests/predictions.test.mjs     (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { allMigrations } from './pg-all-migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '\n          ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 900))); } };

/* ------------------------------------------------------------------ the migration --- */
const mig = read('supabase', 'migrations', '0239_predictions.sql');
console.log('the migration');
ok('the table is closed to browsers (RLS on, everything revoked)', /alter table public\.game_predictions enable row level security;/.test(mig)
   && /revoke all on public\.game_predictions from public, anon, authenticated;/.test(mig));
ok('a pick is for a signed-in fan only', /revoke all on function public\.predict_game\(uuid, text\) from public, anon;\s*grant execute on function public\.predict_game\(uuid, text\) to authenticated;/.test(mig));
ok('the helpers are nobody\'s', ['prediction_open\\(uuid\\)', 'prediction_split\\(uuid\\)', 'prediction_numbers\\(uuid, timestamptz\\)', 'prediction_name\\(uuid\\)']
   .every(f => new RegExp('revoke all on function public\\.' + f + ' from public, anon, authenticated;').test(mig)));
ok('the board, the tally and the leagues are for everyone', ['prediction_board\\(uuid, timestamptz, integer\\)', 'prediction_tally\\(uuid\\[\\]\\)', 'prediction_leagues\\(\\)']
   .every(f => new RegExp('grant execute on function public\\.' + f + ' to anon, authenticated;').test(mig)));
ok('a private league\'s board is its members\' (league_visible), a game the caller may not see is not tallied (game_visible)',
   /p_league is null or public\.league_visible\(p_league\)/.test(mig) && /where public\.game_visible\(g\.id\)/.test(mig));

/* ------------------------------------------------------------------ the database --- */
const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0239 among them', !failed || failed.length === 0, failed);
  const as = async (uid, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try { return await q(sql, p); } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); }
  };
  const mk = async e => (await one(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [e])).id;
  const L1 = (await one(`insert into leagues (slug, name) values ('pr-one', 'Pick League') returning id`)).id;
  const L2 = (await one(`insert into leagues (slug, name) values ('pr-two', 'Other League') returning id`)).id;
  const comp = async L => {
    const s = (await one(`insert into seasons (league_id, name) values ($1, 'S') returning id`, [L])).id;
    return (await one(`insert into competitions (season_id, name) values ($1, 'C') returning id`, [s])).id;
  };
  const C1 = await comp(L1), C2 = await comp(L2);
  const team = async (L, n) => (await one(`insert into teams (league_id, slug, name) values ($1, $2, $2) returning id`, [L, n])).id;
  const [h1, a1, h2, a2] = [await team(L1, 'pr-h1'), await team(L1, 'pr-a1'), await team(L2, 'pr-h2'), await team(L2, 'pr-a2')];
  const game = async (C, h, a, when) => (await one(`insert into games (competition_id, home_team_id, away_team_id, tipoff_at) values ($1, $2, $3, now() + $4::interval) returning id`, [C, h, a, when])).id;
  const gA = await game(C1, h1, a1, '2 days'), gB = await game(C1, h1, a1, '3 days'), gC = await game(C2, h2, a2, '1 day');
  const gPast = await game(C1, h1, a1, '-1 hour');
  const ann = await mk('ann@example.invalid'), bob = await mk('bob@example.invalid'), cat = await mk('cat@example.invalid');
  await q(`insert into usernames (user_id, username) values ($1, 'annie')`, [ann]).catch(() => null);
  const pick = (u, g, k) => as(u, `select public.predict_game($1, $2) r`, [g, k]).then(r => (r.error ? r : r[0].r));

  console.log('picking');
  ok('signed out, a pick is refused (no grant)', /permission denied/.test((await as(null, `select public.predict_game($1, 'home')`, [gA])).error || ''));
  const r1 = await pick(ann, gA, 'home');
  ok('a fan picks, and the split comes back with their pick', r1.ok === true && +r1.home === 1 && +r1.away === 0 && r1.mine === 'home' && r1.open === true, r1);
  ok('they change it', (await pick(ann, gA, 'away')).mine === 'away');
  await pick(bob, gA, 'home'); await pick(cat, gA, 'home');
  const r2 = await pick(ann, gA, null);
  ok('they take it back (null)', r2.ok && r2.mine === null && +r2.home === 2 && +r2.away === 0, r2);
  await pick(ann, gA, 'away');
  ok('a nonsense side is refused', (await pick(ann, gA, 'draw')).reason === 'bad_pick');
  ok('a game past its tip-off is closed', (await pick(ann, gPast, 'home')).reason === 'locked');
  await q(`update games set status = 'live' where id = $1`, [gB]);
  ok('a game that has gone live is closed', (await pick(ann, gB, 'home')).reason === 'locked');
  await q(`update games set status = 'scheduled' where id = $1`, [gB]);
  ok('the league is filed with the pick', (await one(`select league_id from game_predictions where game_id = $1 and user_id = $2`, [gA, ann])).league_id === L1);

  console.log('the tally');
  const t = await as(null, `select * from public.prediction_tally($1::uuid[])`, [[gA, gB, gC]]);
  const tA = Array.isArray(t) && t.find(x => x.game_id === gA);
  ok('signed out: everyone\'s split, no pick of their own, every game asked for (zeros too)', Array.isArray(t) && t.length === 3 && +tA.home === 2 && +tA.away === 1 && tA.mine === null && tA.open === true, t);
  const tm = await as(ann, `select * from public.prediction_tally($1::uuid[])`, [[gA]]);
  ok('signed in: their own pick too', tm[0] && tm[0].mine === 'away', tm);
  ok('a browser cannot read the picks themselves', !!(await as(ann, `select * from public.game_predictions`)).error);
  ok('...nor the helpers', !!(await as(ann, `select * from public.prediction_numbers(null, null)`)).error && !!(await as(null, `select public.prediction_name($1)`, [ann])).error);

  console.log('the board');
  await pick(bob, gB, 'home'); await pick(cat, gB, 'away'); await pick(ann, gB, 'away');
  await pick(bob, gC, 'away');
  /* gA: home wins (bob, cat right; ann wrong). gB: away wins (cat, ann right; bob wrong). gC still to play. */
  await q(`update games set status = 'final', home_score = 80, away_score = 70 where id = $1`, [gA]);
  await q(`update games set status = 'final', home_score = 60, away_score = 75 where id = $1`, [gB]);
  const b = await as(bob, `select * from public.prediction_board(null, null, 100)`);
  ok('everyone who has picked is on it', Array.isArray(b) && b.length === 3, b);
  const byName = n => b.find(r => r.name === n);
  const catRow = b.find(r => !r.named && +r.correct === 2);
  ok('ranked by right picks: two right goes first', catRow && +catRow.rank === 1 && +catRow.decided === 2 && Number(catRow.pct) === 100, b);
  ok('a fan with a username shows by it', !!byName('annie') && byName('annie').named === true && +byName('annie').correct === 1);
  ok('one without shows by a fixed tag, never their id', b.filter(r => !r.named).every(r => /^fan-[0-9a-f]{5}$/.test(r.name) && !r.name.includes(bob.slice(0, 5))), b.map(r => r.name));
  const bobRow = b.find(r => r.me);
  ok('the caller\'s own row is marked, with what is still to play', bobRow && +bobRow.correct === 1 && +bobRow.pending === 1, bobRow);
  ok('level on right picks: ties share a rank', +bobRow.rank === +byName('annie').rank, b);
  const b2 = await as(null, `select * from public.prediction_board($1, null, 100)`, [L2]);
  ok('a league\'s board is its own games only', b2.length === 1 && +b2[0].pending === 1 && +b2[0].decided === 0, b2);
  const mine = (await as(ann, `select public.prediction_mine(null, null) m`))[0].m;
  ok('prediction_mine: the caller\'s line', mine && mine.name === 'annie' && +mine.correct === 1 && +mine.decided === 2, mine);
  ok('...and nothing for the signed out (no grant)', !!(await as(null, `select public.prediction_mine(null, null)`)).error);
  const lg = await as(null, `select * from public.prediction_leagues()`);
  ok('the leagues with picks, most fans first', lg.length === 2 && lg[0].league_slug === 'pr-one' && +lg[0].fans === 3, lg);
  console.log('celebrations (0243)');
  const uw = await as(ann, `select * from public.prediction_unseen_wins()`);
  ok('a fan\'s right picks not yet celebrated: annie called the second game, not the first', Array.isArray(uw) && uw.length === 1 && uw[0].game_id === gB && uw[0].pick === 'away' && uw[0].home_name === 'pr-h1', uw);
  ok('...a signed-out browser has none to ask for', !!(await as(null, `select * from public.prediction_unseen_wins()`)).error);
  const mk1 = (await as(ann, `select public.prediction_mark_celebrated($1::uuid[]) n`, [[gB]]))[0].n;
  ok('marking them shown marks the caller\'s own, once', mk1 === 1 && (await as(ann, `select * from public.prediction_unseen_wins()`)).length === 0
     && (await as(ann, `select public.prediction_mark_celebrated($1::uuid[]) n`, [[gB]]))[0].n === 0);
  const cw = await as(cat, `select * from public.prediction_unseen_wins()`);
  ok('...and nobody else\'s: cat still has both of hers', Array.isArray(cw) && cw.length === 2, cw);

  console.log('their faces');
  ok('no face for a fan whose page is not public (an under-18\'s never appears)', b.every(r => r.face === null), b.map(r => r.face));
  await q(`insert into go_settings (user_id, public, adult_confirmed_at) values ($1, true, now())`, [ann]);
  await q(`insert into fan_profiles (user_id, avatar_url, colour, club_id) values ($1, 'https://example.invalid/a.png', '#ff8800', $2)`, [ann, h1]);
  ok('a fan may choose their photo circle, only one of the three', (await as(ann, `select public.set_fan_circle('club') r`))[0].r.ok === true
     && (await as(ann, `select public.set_fan_circle('selfie') r`))[0].r.reason === 'shape'
     && (await as(ann, `select public.my_fan_circle() c`))[0].c === 'club');
  ok('...signed out, not at all', !!(await as(null, `select public.set_fan_circle('club')`)).error);
  const fb = await as(null, `select * from public.prediction_board(null, null, 100)`);
  const af = (fb.find(r => r.name === 'annie') || {}).face;
  ok('a public fan\'s face: picture, colour, circle, the club they support, their username for the link',
     af && af.avatar === 'https://example.invalid/a.png' && af.colour === '#ff8800' && af.circle === 'club' && af.club && af.club.name === 'pr-h1' && af.u === 'annie' && af.shown === true, af);
  ok('...and still nobody else\'s', fb.filter(r => r.name !== 'annie').every(r => r.face === null));
  const bm = (await as(bob, `select public.prediction_mine(null, null) m`))[0].m;
  ok('a fan sees their own face on their own line, public or not (shown: false)', bm && bm.face && bm.face.shown === false && +bm.correct === 1, bm);
  ok('the face is nobody\'s to ask for directly', !!(await as(null, `select public.prediction_face($1)`, [ann])).error);

  console.log('moderation');
  const boss = await mk('boss@example.invalid');
  await q(`insert into memberships (user_id, role, scope_type) values ($1, 'platform_admin', 'platform')`, [boss]);
  ok('only a platform administrator moderates', (await as(cat, `select public.moderate_fan('annie', 'picture', 'x') r`))[0].r.reason === 'not_admin'
     && !!(await as(null, `select public.moderate_fan('annie', 'picture', 'x')`)).error);
  const m1 = (await as(boss, `select public.moderate_fan('Annie', 'picture', 'Offensive') r`))[0].r;
  const ap = await one(`select avatar_url, circle, colour from fan_profiles where user_id = $1`, [ann]);
  ok('rejecting the picture takes it down (the circle back to automatic only if it was the picture), and counts a warning',
     m1.ok && m1.warnings === 1 && ap.avatar_url === null && ap.circle === 'club' && ap.colour === '#ff8800', [m1, ap]);
  const note = await one(`select title, body, link from notifications where user_id = $1 and kind = 'message' order by created_at desc limit 1`, [ann]);
  ok('...and the fan is warned in their bell, with the reason and the count', note && /removed your picture/.test(note.title) && /Offensive/.test(note.body) && /warning 1/.test(note.body), note);
  const removed = await one(`select removed from fan_moderation where user_id = $1`, [ann]);
  ok('what was taken down is kept for the record', removed.removed.avatar_url === 'https://example.invalid/a.png');
  await q(`update fan_profiles set name = 'Bad Name', bio = 'bad line', avatar_url = 'https://example.invalid/b.png' where user_id = $1`, [ann]);
  const m2 = (await as(boss, `select public.moderate_fan('annie', 'profile', 'Spam', false) r`))[0].r;
  const ap2 = await one(`select avatar_url, name, bio from fan_profiles where user_id = $1`, [ann]);
  ok('resetting the page clears the picture, the name and the line; no warning when asked not to',
     m2.ok && m2.warnings === 1 && ap2.avatar_url === null && ap2.name === '' && ap2.bio === '', [m2, ap2]);
  ok('the warnings so far, for the moderator only', (await as(boss, `select public.fan_moderation_count('annie') n`))[0].n === 1
     && (await as(cat, `select public.fan_moderation_count('annie') n`))[0].n === null);

  const wk = await as(null, `select * from public.prediction_board(null, now() + interval '2 days', 100)`);
  ok('since a date: only games from then (the second game, which all three picked)', Array.isArray(wk) && wk.length === 3 && wk.every(r => +r.decided === 1 && +r.pending === 0), wk);
}

/* --------------------------------------------------------------------- the pages --- */
console.log('\nthe pages');
const gg = read('epinoia', 'globalgames.js');
ok('the card puts the watch pill in its middle column, when watch.js is on the page', /root\.EpinoiaWatch && lgw && lgw\.slug \? root\.EpinoiaWatch\.pill\(lgw\.slug\)/.test(gg) && /body\.className \+= ' has-watch'/.test(gg));
ok('...and the prediction strip under itself, when predict.js is', /root\.EpinoiaPredict\.strip\(g, \{ codes:/.test(gg) && /a\.classList\.add\('has-pred'\)/.test(gg));
const fxc = read('epinoia', 'kit', 'fxc.css');
ok('the strip hangs from the card, which keeps room under itself for it', /\.fxc\.has-pred\{overflow:visible;margin-bottom:\d+px\}/.test(fxc) && /\.fxc>\.fxc-pred\{position:absolute;top:100%/.test(fxc));
const W = read('epinoia', 'watch.js');
ok('the pill\'s press is stopped on the way down, before the card (a link) can take it', /document\.addEventListener\('click', e => \{\s*const b = e\.target\.closest && e\.target\.closest\('\.ep-watch'\);\s*if \(b\) \{\s*e\.preventDefault\(\); e\.stopPropagation\(\);/.test(W) && /\}, true\);/.test(W));
ok('the card it opens lives on <body> (never inside a card) and is placed allowing for the kit\'s zoom', /document\.body\.appendChild\(pop\)/.test(W) && /getComputedStyle\(document\.body\)\.zoom/.test(W));
ok('its links open in a new tab, with no opener', /target="_blank" rel="noopener noreferrer"/.test(W));
const P = read('epinoia', 'predict.js');
ok('every press on the strip stops there: only its sides act', /async function onClick\(e\) \{\s*e\.preventDefault\(\); e\.stopPropagation\(\);/.test(P));
ok('one request for a page of cards', /rpc\('prediction_tally', \{ p_games: ids \}\)/.test(P) && /slice\(0, 200\)/.test(P));
ok('signed out, a tap asks to sign in and the pick waits for the return', /askSignin\(s, id, k\)/.test(P) && /sessionStorage\.setItem\(PENDING/.test(P));

/* watch.js loads in node: the data is the sheet's */
const ctx = { window: {}, globalThis: {} };
vm.runInNewContext(W.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
const WA = ctx.window.EpinoiaWatch;
ok('watch.js loads, with the spreadsheet\'s leagues', WA && Object.keys(WA.DATA).length >= 25, WA && Object.keys(WA.DATA).length);
ok('...each with how to watch and its links', WA && Object.values(WA.DATA).every(d => d.n && ['free', 'paid', 'info'].includes(d.k) && d.a && Array.isArray(d.l) && d.l.every(l => /^https:\/\//.test(l[1]))));
ok('...the EuroCup on EuroLeague TV, SLB on DAZN', WA && WA.of('eurocup').l[0][0] === 'EuroLeague TV' && WA.of('slb-men').l[0][0] === 'DAZN' && WA.of('nope') === null);
ok('the data is made by tools/build-watch.py, between its markers', /WATCH-DATA:BEGIN/.test(W) && /WATCH-DATA:END/.test(W) && /WATCH-DATA:BEGIN/.test(read('tools', 'build-watch.py')));

const game = read('epinoia', 'game', 'game.js');
ok('the game page: the pill on the head (put back on every redraw)', /window\.EpinoiaWatch && S\.leagueSlug && !mid\.querySelector\('\.ep-watch'\)/.test(game));
ok('...and the pill and the strip on the preview', /querySelector\('\.pv-watch-slot'\)/.test(game) && /window\.EpinoiaPredict\.strip\(\{/.test(game) && /pv-pred-slot/.test(read('epinoia', 'game', 'preview.js')));
for (const p of ['home/index.html', 'games/index.html', 'profile/index.html', 'game/index.html']) {
  const h = read('epinoia', ...p.split('/'));
  ok(p + ' loads watch.js and predict.js, with their sheets', /watch\.js\?v=/.test(h) && /predict\.js\?v=/.test(h) && /kit\/watch\.css/.test(h) && /kit\/predict\.css/.test(h));
}
const nav = read('epinoia', 'nav.js');
ok('the league rail has LEADERBOARDS', /\{ href: 'leaderboards\/', ic: '[^']+', tx: 'leaderboards', lg: true, key: 'leaderboards'/.test(nav));
ok('EPINOIA GO has it in its rail and on its bar', /platformRow\('[^']+', 'leaderboards', 'go\/leaderboards\/'/.test(nav) && /key: 'boards',[^\n]*href: 'go\/leaderboards\/'/.test(nav));
for (const p of ['leaderboards/index.html', 'go/leaderboards/index.html']) {
  const h = read('epinoia', ...p.split('/'));
  ok(p + ' is built to the page standard and draws the board', /data-std/.test(h) && /leaderboards\/boards\.js\?v=|"boards\.js\?v=/.test(h) && /id="lbBoard"/.test(h));
}

const bj = read('epinoia', 'leaderboards', 'boards.js');
ok('a platform administrator gets the flag on a public fan\'s circle, and the card rejects and warns',
   /rpc\('is_platform_admin', \{\}\)/.test(bj) && /admin && r\.face && r\.face\.u && r\.face\.shown \? modWrap/.test(bj) && /rpc\('moderate_fan', \{ p_username: f\.u, p_what: what/.test(bj));
/* THE GAME AT A GLANCE (2026-10-07): the middle of the strip opens the preview's numbers, condensed */
const GK = read('epinoia', 'gamepeek.js');
ok('the strip\'s middle opens the game at a glance where gamepeek.js is loaded', /if \(!o\.big && root\.EpinoiaPeek && g\.competition_id\) root\.EpinoiaPeek\.attach\(mid, g\)/.test(P));
ok('...hover with a mouse, a tap pinning it; its press never reaches the strip or the card', /\(hover:hover\) and \(pointer:fine\)/.test(GK) && /e\.preventDefault\(\); e\.stopPropagation\(\);\s*if \(owner === el && pinned\) close\(\); else open\(el, g, true\);/.test(GK));
ok('...the whole season the fixture belongs to, every competition of it, read once', /competitions\?season_id=eq\./.test(GK) && /D\(\)\.season\(ids\.length \? ids : \[compId\], \{ rows: false, trim: true \}\)/.test(GK) && /seasonOf\.set\(compId, p\)/.test(GK));
ok('...the four factors, the ratings and two leading players a club; never off the foot of the screen', /\['eFG%', 'ff_efg'\]/.test(GK) && /\['ORTG', 'ortg'\]/.test(GK) && /\.slice\(0, 2\)/.test(GK) && /Math\.max\(8, vh - 8 - h\)/.test(GK));
for (const p of ['home/index.html', 'games/index.html']) {
  const h = read('epinoia', ...p.split('/'));
  ok(p + ' loads gamepeek.js before predict.js, with its sheet, and season.js for the season', /gamepeek\.js\?v=\d+" defer><\/script>\s*<script src="\.\.\/predict\.js/.test(h) && /kit\/gamepeek\.css/.test(h) && /season\.js\?v=/.test(h));
}
/* YOU CALLED IT (0243): confetti for a right pick, on any page, for a signed-in fan */
const CEL = read('epinoia', 'celebrate.js');
ok('nav.js loads celebrate.js beside itself, only for a signed-in fan', /\(function loadCelebrate\(\) \{\s*try \{\s*if \(!storedSession\(\)/.test(nav) && /replace\(\/nav\\\.js\(\?=\[\?#\]\|\$\)\/, 'celebrate\.js'\)/.test(nav));
ok('it asks when the page opens and every minute and a half while it is in view, and marks what it showed', /const EVERY_MS = 90 \* 1000;/.test(CEL) && /document\.hidden/.test(CEL) && /rpc\('prediction_mark_celebrated', \{ p_games: wins\.map\(w => w\.game_id\) \}\)/.test(CEL));
ok('the confetti and the banner hang off <html> (the kit zooms <body>); reduced motion: no confetti', /document\.documentElement\.appendChild\(cv\)/.test(CEL) && /prefers-reduced-motion: reduce/.test(CEL));
ok('before 0243 (404) it stops asking', /if \(r\.status === 404\) \{ stopped = true; return null; \}/.test(CEL));
/* LEAGUE PAGES (2026-10-07): every fixture row gets the pill and a row's own who-wins bar; the strip becomes HOME's cards */
const rowsOn = [['home.js', 'index.html'], ['fixtures/fixtures.js', 'fixtures/index.html'], ['l/league.js', 'l/index.html']];
for (const [js, html] of rowsOn) {
  const J = read('epinoia', ...js.split('/')), H = read('epinoia', ...html.split('/'));
  ok(js + ': the watch pill under the time or score, and the who-wins bar along the row', /classList\.add\('fx-watch'\)/.test(J) && /EpinoiaPredict\.strip\([^)]*\{ row: true/.test(J));
  ok(html + ' loads watch.js, gamepeek.js and predict.js, with their sheets', ['watch.js', 'gamepeek.js', 'predict.js'].every(f => H.includes(f + '?v=')) && ['watch.css', 'predict.css', 'gamepeek.css'].every(f => H.includes(f + '?v=')));
}
ok('a row\'s bar is the row\'s own: no plate, its ink, the clubs\' colours', /o\.row \? ' row-pred'/.test(P) && /\(o\.big \|\| o\.row\) && hc/.test(P) && /\.ep-pred\.row-pred\{--pl:var\(--panel\);--pi:var\(--ink\)/.test(read('epinoia', 'kit', 'predict.css')));
/* THE EMBEDDED STRIP (2026-10-07): WATCH and PICK on each card, each a panel over its own card - it is a frame on other sites */
const ST = read('epinoia', 'embed', 'strip', 'strip.js');
ok('the strip\'s cards carry WATCH and PICK under the "v" or the score', /mid\.appendChild\(actsFor\(g\)\)/.test(ST) && /chip\('watch', '▶ watch'/.test(ST) && /chip\('pick', 'pick'/.test(ST));
ok('...each opens a panel over its own card, never outside the frame, and never the game behind it', /cardEl\.appendChild\(pop\)/.test(ST) && /e\.preventDefault\(\); e\.stopPropagation\(\);/.test(ST) && /\.ep-card \.ec-pop\{ position:absolute; inset:0;/.test(read('epinoia', 'kit', 'embed.css')));
ok('...the drift waits while one is open; the split read once a render', /!POP\.open && \(Date\.now\(\) - lastTouch > IDLE_MS\)/.test(ST) && /askTally\(gs\.map\(g => g\.id\)\)/.test(ST));
ok('...without a session (another site keeps the frame\'s storage apart) the pick is offered on EPINOIA, in a new tab', /pick on EPINOIΛ ↗/.test(ST) && /a\.target = '_blank'; a\.rel = 'noopener';/.test(ST));
ok('the embed page loads watch.js for its data; league and club pages keep the frame', /watch\.js\?v=/.test(read('epinoia', 'embed', 'strip', 'index.html')) && /strip\.src = 'embed\/strip\/\?n=24&l='/.test(read('epinoia', 'home.js')) && /frame\.src = src;/.test(read('epinoia', 't', 'team.js')));ok('YOUR HUB has YOUR PAGE: to fan/?u= once the username is known', /mk\('', '[^']+', 'your page', root \+ 'profile\/'\)/.test(nav) && /yourPage\.href = root \+ 'fan\/\?u='/.test(nav));
const ed = read('epinoia', 'me', 'fanprofile.js');
ok('the page editor offers the photo circle and saves it', /'Photo circle'/.test(ed) && /sb\.rpc\('set_fan_circle', \{ p: circle \}\)/.test(ed) && /On the leaderboards/.test(ed));
const fcs = read('epinoia', 'facecircle.js');
const fctx = { window: { epinoiaLogoUrl: p => 'https://x.invalid/' + p }, globalThis: {} };
vm.runInNewContext(fcs.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), fctx);
const FA = fctx.window.EpinoiaFace;
ok('the circle: the picture, else the crest, else the initials; a choice that cannot be drawn falls back',
   FA.mode({ avatar: 'https://a.invalid/x.png' }) === 'picture' && FA.mode({ club: { logo: 'c.png' } }) === 'club' && FA.mode(null) === 'initials'
   && FA.mode({ circle: 'picture', club: { logo: 'c.png' } }) === 'club' && FA.mode({ circle: 'initials', avatar: 'https://a.invalid/x.png' }) === 'initials');
ok('...ringed in the fan\'s colour, else their club\'s, else one made from their name (the same every time)',
   FA.tint({ colour: '#123456' }, 'x') === '#123456' && FA.tint({ club: { colour: '#abcdef' } }, 'x') === '#abcdef' && FA.tint(null, 'annie') === FA.tint(null, 'annie'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
