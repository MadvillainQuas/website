// THE PLAYER'S WEEKLY REPORT (Louie, 2026-10-16): a player report that fills its pages, with CONNECTIONS, GAMES PLAYED DURING
// THE WEEK and position-oriented INSIGHTS before the legend; and an address that is emailed it every Monday morning (0272).
//   * gamefull.js: the match report's full stats table, shared - a stored game line made a row (the three figures the stored
//     line lacks worked out from its counts), a game's bar ranges and average, a player's rows from several games each read
//     against its own game;
//   * report-playerpages.js passLinks: every assist paired with its basket (game/connections.js's rule), kept with where the
//     shot was and what kind it was; who he sets up, who sets him up;
//   * scoutinsights.js develop: what is working and what to work on, for his position, from every section's facts; the
//     evidence with each note; small samples say nothing; they/their, never he/his (the site covers women's leagues);
//   * scripts/report_mailer.mjs: which week is due when (Monday from 8 am, the Tuesday a catch-up), the week's bounds across
//     a clock change, the email, and a whole round against a stand-in database and Resend: sent and logged once, a week not
//     played skipped, a game still being played waited for on the Monday only, send now;
//   * 0272 (PGlite): a platform administrator's alone, one row an address and a player, one log row a week;
//   * the console: the reports manager's Players tab (reports-manager.js), send now of the games ticked (0273), and
//     the report and the email of those games (p/?rpgames=, the mailer's chosenGames).
//
//   TZ=UTC node supabase/tests/player-report-weekly.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
/* a PDF's bookmark titles (raster.js pdfUni: UTF-16 with its byte-order mark, in hex), read back */
const pdfTitles = txt => [...txt.matchAll(/\/Title <FEFF([0-9A-Fa-f]*)>/g)].map(m => { let t = ''; for (let i = 0; i < m[1].length; i += 4) t += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16)); return t; });
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };

/* ======================================================================== gamefull.js === */
console.log('the match report\'s full stats table, shared (gamefull.js)');
const GF = require(path.join(ROOT, 'epinoia', 'gamefull.js'));
globalThis.EpinoiaGameFull = GF;
const BOX = require(path.join(ROOT, 'epinoia', 'boxscore.js'));
{
  const st = { p2a: 6, p2m: 3, p3a: 4, p3m: 2, adv: { pts: 12, min: 20, minTxt: '20:00', usg: 22.5 }, oc: { tFTA: 10, tFGA: 40, oFTA: 6, oFGA: 50 } };
  const r = GF.fromStored(st);
  ok('a stored line made a row: eFG% and the two on-court free-throw rates from its counts, the rest as stored',
     Math.abs(r.efg - 60) < 1e-9 && Math.abs(r.ocFtr - 25) < 1e-9 && Math.abs(r.ocOppFtr - 12) < 1e-9 && r.usg === 22.5 && r.fgm === 5, r);
  ok('...and a figure already there is kept', GF.fromStored({ adv: { efg: 41 } }).efg === 41);
  const cx = GF.gameContext([{ ortg: 110, efg: 50, orebp: 30, tovp: 12, ftr: 20 }, { ortg: 100, efg: 46, orebp: 26, tovp: 16, ftr: 30 }],
    [{ min: 30, ts: 60, usg: 20 }, { min: 10, ts: 40, usg: 30 }, { min: 0, ts: 99, usg: 99 }], BOX.ADV_GROUPS);
  ok('a game\'s average of the four factors and its bar ranges across those who played (a player who did not, not counted)',
     cx.gameAvg.ortg === 105 && cx.gameAvg.ftr === 25 && cx.ranges.ts.max === 60 && cx.ranges.usg.max === 30 && cx.ranges.ts.min === 0, cx);
  const rows = [Object.assign({ __g: { opp: 'A' } }, r), Object.assign({ __g: { opp: 'B' } }, GF.fromStored({ p2a: 2, p2m: 1, adv: { pts: 2, min: 5, minTxt: '5:00' } }))];
  const seen = [];
  const html = GF.table({ groups: BOX.ADV_GROUPS, keep: ['scoring', 'usage'], rows, head: 'Game',
    ctxOf: x => { seen.push(x.__g.opp); return Object.assign({}, cx, { rate: () => ({ g: 80, d: 1 }) }); },
    nameCell: x => '<b>' + x.__g.opp + '</b>' });
  ok('a row a game, each read against its own game\'s context, under the match report\'s bands and labels',
     (html.match(/<tr><td class="fs-n">/g) || []).length === 2 && JSON.stringify(seen) === '["A","B"]' && /class="fs-g g-scoring"/.test(html) && /PTS<br>CREATED/.test(html) && /<th class="fs-n" rowspan="2">Game<\/th>/.test(html));
  ok('...shaded by percentile where the column has one, no totals row unless asked', /data-b="4"/.test(html) && !/fs-tot/.test(html));
  const A = read('epinoia', 'game', 'analysis.js');
  ok('the game analysis draws its FULL STATS through it (its team totals row kept), and loads it',
     /return GF\(\)\.table\(\{ groups: c\.groups, keep, rows: c\.rows, ctxOf: \(\) => cx, head: 'Player',/.test(A) && /totals: \{ label: 'Team totals', values: T2, ctx: cx \}/.test(A)
     && /GF\(\)\.PARTS\.flatMap/.test(A) && !/function fig\(/.test(A) && /gamefull\.js\?v=\d+" defer><\/script>\s*<script src="analysis\.js/.test(read('epinoia', 'game', 'index.html'))
     && /gamefull\.js\?v=\d+" defer><\/script>\s*<script src="\.\.\/report-playerpages\.js/.test(read('epinoia', 'p', 'index.html')));
}

/* ======================================================================== CONNECTIONS === */
console.log('\nconnections: every assist paired with its basket (report-playerpages.js passLinks)');
globalThis.EpinoiaSituations = require(path.join(ROOT, 'epinoia', 'situations.js'));
const RPm = require(path.join(ROOT, 'epinoia', 'report-playerpages.js'));
{
  const ME = 'p-me', A = 'p-a', B = 'p-b', OPP = 'p-o';
  let seq = 0;
  const ev = (t, team, pid, extra) => Object.assign({ t, team, pid, period: 1, clock: 600000 - (++seq) * 1000, id: seq, seq, gameId: 'g1' }, extra || {});
  const shot = (t, team, pid, x, y, type) => { const e = ev(t, team, pid); const out = [e, ev('loc', team, null, { ref: e.id, x, y })]; if (type) out.push(ev('stype', team, null, { ref: e.id, v: type })); return out; };
  const evs = [].concat(
    shot('p2_made', 0, A, 0.5, 0.1, 'layup'), [ev('ast', 0, ME)],           // he finds A at the rim
    shot('p3_made', 0, B, 0.1, 0.05, null), [ev('ast', 0, ME)],             // ...B in the corner
    shot('p3_made', 0, A, 0.5, 0.75, 'jump shot'), [ev('ast', 0, ME)],      // ...A above the break
    shot('p2_made', 1, OPP, 0.5, 0.1, 'dunk'), [ev('ast', 0, ME)],          // an assist of his after the other side scored: no basket of his side's
    shot('p2_made', 0, ME, 0.6, 0.2, 'floater'), [ev('ast', 0, A)],         // A finds him
    shot('p2_made', 0, ME, 0.5, 0.12, 'layup'), [ev('ast', 0, ME)]);        // his own basket and his own "assist": nothing
  const L = RPm.passLinks([{ id: 'g1', events: evs }, { id: 'g2', events: [ev('p2_made', 0, 'x')] }], [ME]);
  ok('his three assists paired with their baskets; one after the other side scored is no pair; his own basket is not his assist',
     L.out.length === 3 && L.out.every(l => l.from === ME) && L.into.length === 1 && L.into[0].from === A && L.games === 1, L);
  const atRim = L.out.find(l => l.to === A && !l.three);
  ok('each kept with its shot: the points, the zone, the type and where it was', atRim && atRim.pts === 2 && atRim.zone === 'rim' && atRim.type === 'layup' && atRim.x === 0.5 && atRim.y === 0.1, atRim);
  const M = RPm.byMate(L.out, 'to');
  ok('who he sets up, most first: A twice (a layup and a three, 5 points), B once', M[0].id === A && M[0].n === 2 && M[0].pts === 5 && M[0].threes === 1 && M[0].rim === 1 && M[0].types.layup === 1 && M[1].id === B, M);
  const PP = read('epinoia', 'report-playerpages.js');
  ok('the section: a court of where his passes were finished, a colour for each teammate he finds most, and who sets him up',
     /key: 'conn', title: 'Connections', page: 'CONNECTIONS', on: true, pack: 'flow'/.test(PP) && />They set up<span>/.test(PP) && />Who sets them up<span>/.test(PP)
     && /const PAL = \['#0b7a4b', '#e0702b', '#3d6fd8', '#a2449b', '#c79a14'\];/.test(PP));
  ok('...over the competition\'s games (ctx.fieldGames), else the club\'s last 40 (ctx.floor)', /let games = ctx\.fieldGames \? await ctx\.fieldGames\(\)\.catch\(\(\) => null\) : null;/.test(PP) && /src = 'the club’s last ' \+ games\.length \+ ' games';/.test(PP));
}

/* ======================================================================== THE WEEK === */
console.log('\ngames played during the week (report-playerpages.js, p/player.js loadWeekGames)');
{
  const PP = read('epinoia', 'report-playerpages.js'), PJ = read('epinoia', 'p', 'player.js');
  ok('the section: a court of his shots for each game, then the match report\'s three FULL STATS tables, a row a game, each against its own game',
     /key: 'wkg', title: 'Games played during the week', page: 'GAMES PLAYED DURING THE WEEK', on: true, pack: 'flow'/.test(PP)
     && /GF\.PARTS\.forEach\(\(\[what, keep, note\]\) => \{/.test(PP) && /ctxOf: r => r\.__g\.cx, nameCell, head: 'Game', cls: 'rp-wkfs'/.test(PP));
  ok('...a week of one game drawn side by side (the court and the game\'s tiles), never a card half the page wide', /const wide = gl\.length === 1;/.test(PP) && /'<div class="rp-wk-c wide">/.test(PP));
  ok('the week: ?rpweek= (the email\'s Monday), else his latest game\'s, Monday to Sunday in his league\'s time zone; every profile of his',
     /const asked = new URLSearchParams\(location\.search\)\.get\('rpweek'\);/.test(PJ) && /if \(!monday\) monday = chosen\.length \? days\[0\] : mondayOf\(days\[days\.length - 1\]\);/.test(PJ)
     && /const tz = lgs\.timezone \|\| 'UTC';/.test(PJ) && /leagues\(id,slug,name,logo_path,colour_a,gender,timezone\)/.test(PJ)
     && /weekGames: \(\) => RP_WEEK \|\| \(RP_WEEK = loadWeekGames\(pl, team, rpGet\('lvrPids', 60000\)\)/.test(PJ));
  ok('?rpgames= (a player\'s send now of the games chosen, 0273): those games alone, whatever their week, from their first day to their last, a game once',
     /const chosen = \(new URLSearchParams\(location\.search\)\.get\('rpgames'\) \|\| ''\)\.split\(','\)\.filter\(id => \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(id\)\)\.slice\(0, 12\);/.test(PJ)
     && /\(chosen\.length \? `&game_id=in\.\(\$\{chosen\.join\(','\)\}\)&games\.status=eq\.final`/.test(PJ) && /const sunday = chosen\.length \? days\[days\.length - 1\] : ymdAdd\(monday, 6\);/.test(PJ)
     && /return \{ monday, sunday, tz, games, picked: chosen\.length > 0 \};/.test(PJ));
  ok('...the section named for them: SELECTED GAMES, its own legend entry, one day said once; the insights say "These games"',
     /wkg\.page = picked \? 'SELECTED GAMES' : 'GAMES PLAYED DURING THE WEEK';/.test(PP) && /title\(picked \? 'Selected games' : 'Games played during the week'/.test(PP)
     && /if \(picked\) R\.legendExtra\.push\(\['SELECTED GAMES'/.test(PP) && /if \(a === b\) return DAYS/.test(PP) && /F\.week && F\.week\.picked \? 'These games' : 'This week'/.test(PP));
  ok('...only games he played (minutes) and that are final', /const playedIn = st => !!st && \(\+st\.min > 0 \|\| \(st\.adv && \+st\.adv\.min > 0\)\);/.test(PJ) && /r\.games && r\.games\.status === 'final' && playedIn\(r\.stats\)/.test(PJ));
}

/* ======================================================================== INSIGHTS === */
console.log('\nactionable insights, for his position (scoutinsights.js develop)');
const SI = require(path.join(ROOT, 'epinoia', 'scoutinsights.js'));
{
  const pct = m => k => (k in m ? m[k] : null);
  const guard = { id: 'g', gp: 20, mpg: 30, fga: 200, fta: 60, p3a: 80, rimA: 60, ev_transition_rimA: 20, ev_half_rimA: 40,
    ev_transition_rim_pct: 41.2, hc_ast_pct: 9.5, usg: 26, tov_pct: 21, p3_pct: 28, ft_pct: 82, ts: 61, handle_pg: 2.1, badpass_pg: 0.6, stl_pct: 3.1, dreb_pct: 12 };
  const D = SI.develop({ name: 'Ann Ace', main: { mine: guard, group: 'guard', who: 'guards', n: 60,
    pct: pct({ ev_transition_rim_pct: 8, hc_ast_pct: 12, usg: 80, tov_pct: 10, p3_pct: 15, ts: 90, stl_pct: 85, dreb_pct: 60, ft_pct: 70 }) },
    lvr: { all: { L: { fga: 40, efg: 0.58 }, R: { fga: 35, efg: 0.41 } } },
    conn: { total: 30, threes: 3, rim: 12, mates: [{ name: 'Bo Cee', n: 16 }] } });
  const work = D.work.map(x => x.head), keep = D.keep.map(x => x.head), all = JSON.stringify(D);
  ok('a guard\'s work-ons: finishing in transition and creating for others in the half court (the two Louie named), with the evidence',
     work.includes('Finishing in transition') && work.includes('Creating for others') && /41\.2% at the rim on the break \(8th percentile among guards\)/.test(all) && /Half-court AST% is low for a guard: 9\.5%/.test(all), D.work);
  ok('...each with the work, in the scout\'s words (the pocket pass, the skip, a jump stop)', D.work.every(x => x.act) && /pocket pass/.test(all) && /jump stop/.test(all));
  ok('...the turnovers read by their kind: on the dribble, so the handle', /Most are on the dribble: tighten the handle/.test(all));
  ok('...and what the other sections found: the side of the floor (left v right), one teammate taking most of the passes (connections)',
     /58\.0% eFG from the left side of the floor, 41\.0% from the right/.test(all) && /Defences will push them to their right/.test(all), D.work);
  ok('...at most five work-ons and four strengths, the strongest first', D.work.length <= 5 && D.keep.length <= 4 && keep.includes('Efficient scorer') && keep.includes('Event creator'), [work, keep]);
  ok('...the touch at the line said with the three (82% FT: "it will come")', /The touch says it will come \(82\.0% at the line\)/.test(all) || !work.includes('The three'));
  ok('they/their, never he/his/him: the site covers women\'s leagues', !/\b(he|his|him|He|His)\b/.test(D.work.map(x => x.text + ' ' + x.act).join(' ') + D.keep.map(x => x.text).join(' ') + D.intro), all.slice(0, 400));
  const big = { id: 'b', gp: 20, mpg: 25, rimA: 80, ev_half_rimA: 50, ev_half_rim_pct: 48, dreb_pct: 14, blk_pct: 1.2, pf_pg: 4.1, oreb_pct: 4 };
  const DB = SI.develop({ name: 'Cy Dee', main: { mine: big, group: 'big', who: 'bigs', n: 40, pct: pct({ ev_half_rim_pct: 10, dreb_pct: 15, blk_pct: 12, pf_pg: 9, oreb_pct: 20 }) } });
  const bw = DB.work.map(x => x.head), ball = JSON.stringify(DB);
  ok('a big\'s are a big\'s: finishing through length, the defensive glass, contests at the rim, fouls', bw.includes('Finishing in the half court') && bw.includes('Defensive rebounding') && bw.includes('Contests at the rim') && /Finish through length/.test(ball) && /hit, hold/.test(ball), DB.work);
  const pop = SI.develop({ name: 'Cy Dee', main: { mine: big, group: 'big', who: 'bigs', n: 40, pct: pct({ oreb_pct: 20, p3_a100: 85 }) } });
  ok('...but no offensive glass asked of a big who spaces the floor (top 30% of bigs for threes): no line another measure contradicts',
     bw.includes('Offensive rebounding') && !pop.work.some(x => x.head === 'Offensive rebounding'), pop.work);
  const early = SI.develop({ name: 'Ed Eff', main: { mine: { id: 'e', gp: 2, mpg: 18, dreb_pct: 0, stl_pct: 0, fga: 12, ts: 120 }, group: 'guard', who: 'guards', n: 60, pct: pct({ dreb_pct: 1, stl_pct: 1, ts: 99 }) } });
  ok('two games say nothing about rebounds, steals or shooting: no note on them, and the intro says it is early', !early.work.length && !early.keep.length && /Early in the season \(2 games\)/.test(early.intro), early);
  const wk = SI.develop({ name: 'Ann Ace', main: { mine: guard, group: 'guard', who: 'guards', n: 60, pct: pct({}) },
    week: { games: [{ raw: { pts: 24, p2a: 10, p2m: 6, p3a: 6, p3m: 3, fta: 4, ast: 5, to: 2 }, home: true, opp: 'BOU', res: 'W', us: 85, them: 79, shots: [] },
                    { raw: { pts: 6, p2a: 8, p2m: 2, p3a: 4, p3m: 0, fta: 2, ast: 3, to: 3 }, home: false, opp: 'LIM', res: 'L', us: 70, them: 88, shots: [] }] } });
  ok('this week: the line over its games against the season, and the best game', wk.week[0].head === '2 games' && /15\.0 points a game on .*% TS \(their season: 61\.0%\)/.test(wk.week[0].text) &&
     wk.week.some(x => x.head === 'Best game' && /against BOU \(W 85–79\)/.test(x.text)), wk.week);
  const PP = read('epinoia', 'report-playerpages.js');
  ok('the section is the last before the legend, and reads what every section published (R.facts)', /return \[cover, main, shots, lvr, conn, floor, wkg, week, ins, legend\];/.test(PP)
     && /R\.facts\.main = \{ mine, group, who: RkI\.who/.test(PP) && /R\.facts\.lvr = \{ all, un \};/.test(PP) && /R\.facts\.conn = \{ total: out,/.test(PP) && /R\.facts\.week = \{ monday: W\.monday/.test(PP));
}

/* ======================================================================== THE MAILER === */
console.log('\nthe weekly email (scripts/report_mailer.mjs, 0272)');
process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.RESEND_API_KEY = 're_test';
delete process.env.DRY;
const M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'report_mailer.mjs')).href);
{
  const due = (iso, tz) => M.playerWeekDue(tz || 'Europe/London', new Date(iso));
  ok('Monday from 8 am at the address\'s time: the week just played', JSON.stringify(due('2026-10-19T07:00:00Z')) === '{"week":"2026-10-12","catchUp":false}', due('2026-10-19T07:00:00Z'));
  ok('...not before 8 (06:59 BST)', due('2026-10-19T05:59:00Z') === null);
  ok('...Tuesday catches up the same week; Wednesday is nothing', JSON.stringify(due('2026-10-20T15:00:00Z')) === '{"week":"2026-10-12","catchUp":true}' && due('2026-10-21T15:00:00Z') === null);
  ok('...at the address\'s own time: Monday 8 am in Sydney is Sunday night in London', JSON.stringify(due('2026-10-18T21:30:00Z', 'Australia/Sydney')) === '{"week":"2026-10-12","catchUp":false}', due('2026-10-18T21:30:00Z', 'Australia/Sydney'));
  const B = M.weekBounds('Europe/London', '2026-10-19');
  ok('the week\'s bounds at the address\'s time, across the clocks going back (25 Oct)', B.from.toISOString() === '2026-10-18T23:00:00.000Z' && B.to.toISOString() === '2026-10-26T00:00:00.000Z', [B.from, B.to]);
  ok('the week said as a reader says it', M.weekSpan('2026-10-12') === '12–18 October 2026' && M.weekSpan('2026-09-28') === '28 September – 4 October 2026' && M.weekSpan('2025-12-29') === '29 December 2025 – 4 January 2026');
  const line = M.playerLine({ team_idx: 1, stats: { pts: 18, or: 1, dr: 4, ast: 6, adv: { minTxt: '31:10' } }, games: { tipoff_at: '2026-10-15T19:00:00Z', home_score: 70, away_score: 81, home: { name: 'Leeds' }, away: { name: 'Ours' } } });
  ok('a game of theirs their way round: away, a win 81-70 at Leeds, their line', line.home === false && line.res === 'W' && line.us === 81 && line.opp === 'Leeds' && line.reb === 5 && line.min === '31:10', line);
  const E = M.playerEmail({ sub: { name: 'Sam' }, name: 'Sam Smith', team: { name: 'Ours', colour: '#123456', leagues: { name: 'SLB' } }, week: '2026-10-12', games: [line], tz: 'Europe/London' });
  ok('the email: "Sam Smith: your week, 12–18 October 2026", the game listed, what the report holds, and how to stop it',
     E.subject === 'Sam Smith: your week, 12–18 October 2026' && /Hi Sam,/.test(E.html) && /at <b>Leeds<\/b>/.test(E.html) && /W 81–70/.test(E.html) && /Actionable insights/.test(E.html)
     && /a weekly player report was set up for this address/.test(E.html) && !/your club’s reports were set up/.test(E.html), E.subject);
  ok('the clubs\' emails keep their own footer', /your club’s reports were set up for this address/.test(M.layout({ colour: '#123456', kicker: 'k', title: 't', greeting: 'Hi', blocks: [], files: [] })));

  /* A WHOLE ROUND against a stand-in database and Resend */
  const SUB = { id: 's1', email: 'sam@example.com', name: 'Sam', player_id: 'pl1', tz: 'Europe/London', active: true, send_now_at: null,
    players: { id: 'pl1', first_name: 'Sam', last_name: 'Smith', slug: 'ours-sam-smith' } };
  const world = o => ({ log: [], games: [], open: [], sent: [], posted: [], patched: [], ...o });
  let W = world();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url), body = opt.body ? JSON.parse(opt.body) : null;
    const res = (x, st) => ({ ok: (st || 200) < 400, status: st || 200, text: async () => JSON.stringify(x), json: async () => x });
    if (u.startsWith('https://api.resend.com/')) { W.sent.push(body); return res({ id: 'm' + W.sent.length }); }
    const p = u.replace('https://db.example/rest/v1/', '');
    if (p.startsWith('report_mail_players?active=eq.true')) return res([Object.assign({}, SUB, W.sub || {})]);
    if (p.startsWith('rpc/linked_players')) return res({ players: [] });
    if (p.startsWith('roster_entries?')) return res([{ teams: { id: 't1', name: 'Ours', colour: '#123456', leagues: { name: 'SLB', timezone: 'Europe/London' } } }]);
    if (p.startsWith('report_mail_player_log?sub_id=')) return res(W.log.filter(l => p.includes('week=eq.' + l.week)));
    if (p.startsWith('report_mail_player_log?on_conflict')) { W.posted.push(body); W.log.push(body); return res(null, 201); }
    if (p.startsWith('report_mail_players?id=eq.')) { W.patched.push(body); return res(null, 204); }
    if (p.startsWith('player_game_stats?')) {
      const q = new URLSearchParams(p.split('?')[1]);
      const lo = Date.parse(decodeURIComponent((q.getAll('games.tipoff_at').find(x => x.startsWith('gte.')) || 'gte.1970').slice(4)));
      const hi = Date.parse(decodeURIComponent((q.getAll('games.tipoff_at').find(x => x.startsWith('lt.')) || 'lt.2999').slice(3)));
      const gin = q.get('game_id'), gids = gin ? gin.replace(/^in\.\(|\)$/g, '').split(',') : null;
      if (gids) W.askedGames = gids;
      return res(W.games.filter(r => (!gids || gids.includes(r.game_id)) && Date.parse(r.games.tipoff_at) >= lo && Date.parse(r.games.tipoff_at) < hi));
    }
    if (p.startsWith('games?or=')) return res(W.open);
    return res([]);
  };
  const pdfs = [];
  M.hooks.pdf = (p, name) => { pdfs.push(p); return { filename: name + '.pdf', content: Buffer.from('%PDF-1.4').toString('base64') }; };
  const game = (iso, min) => ({ game_id: 'g' + iso, team_idx: 0, player_uuid: 'pl1', stats: { pts: 12, or: 1, dr: 3, ast: 4, min: min == null ? 25 : min, adv: { min: min == null ? 25 : min, minTxt: '25:00' } },
    games: { id: 'g' + iso, tipoff_at: iso, status: 'final', home_score: 80, away_score: 75, home: { name: 'Ours' }, away: { name: 'Bristol' } } });
  const MON = new Date('2026-10-19T08:30:00Z'), TUE = new Date('2026-10-20T09:00:00Z'), THU = new Date('2026-10-22T12:00:00Z');

  W = world({ games: [game('2026-10-15T19:00:00Z'), game('2026-10-17T18:00:00Z'), game('2026-10-17T20:00:00Z', 0)] });
  let r = await M.playerRound(MON);
  ok('Monday 9:30 in London: the week of 12 October sent - one email, the report drawn for that week, logged once, the address told',
     W.sent.length === 1 && W.sent[0].to[0] === 'sam@example.com' && /your week, 12–18 October 2026/.test(W.sent[0].subject) && W.sent[0].attachments.length === 1
     && /\/epinoia\/p\/\?p=ours-sam-smith&tab=report&rpweek=2026-10-12$/.test(pdfs[pdfs.length - 1]) && W.posted.length === 1 && W.posted[0].week === '2026-10-12'
     && /Sent the week of 12–18 October 2026 \(2 games\)/.test(W.patched[0].last_detail) && !('send_now_at' in W.patched[0]) && r.failed === 0, [W.sent.map(s => s.subject), W.posted, W.patched]);
  ok('...the game they did not play (no minutes) is not in it', (W.sent[0].html.match(/Bristol/g) || []).length === 2);
  r = await M.playerRound(new Date('2026-10-19T09:30:00Z'));
  ok('...and the next run that Monday sends nothing more (the log)', W.sent.length === 1 && W.posted.length === 1);

  W = world({ games: [game('2026-10-08T19:00:00Z')] });
  await M.playerRound(MON);
  ok('a week they did not play: nothing sent, nothing logged (a game finalised late could still bring it on the Tuesday)', !W.sent.length && !W.posted.length && !W.patched.length);

  W = world({ games: [game('2026-10-15T19:00:00Z')], open: [{ id: 'g9', tipoff_at: '2026-10-19T06:00:00Z', status: 'live' }] });
  await M.playerRound(MON);
  ok('a game of the club\'s still being played that Monday: waited for', !W.sent.length && !W.posted.length);
  await M.playerRound(TUE);
  ok('...on the Tuesday it is not: the week goes, caught up', W.sent.length === 1 && W.posted.length === 1 && W.posted[0].week === '2026-10-12');

  W = world({ games: [game('2026-10-15T19:00:00Z')], sub: { send_now_at: '2026-10-22T11:58:00Z' } });
  await M.playerRound(THU);
  ok('send now, on a Thursday: the week of their latest game at once, and the request cleared', W.sent.length === 1 && /rpweek=2026-10-12/.test(pdfs[pdfs.length - 1]) &&
     W.patched.length === 1 && W.patched[0].send_now_at === null && /asked for/.test(W.patched[0].last_detail), W.patched);
  W = world({ games: [], sub: { send_now_at: '2026-10-22T11:58:00Z' } });
  await M.playerRound(THU);
  ok('...with no game in 200 days: nothing sent, and the console told why', !W.sent.length && W.patched[0].send_now_at === null && /no game of theirs in the last 200 days/.test(W.patched[0].last_detail), W.patched);

  ok('...a row read before 0273 (no send_now_games on it): the request cleared without naming the column', !('send_now_games' in W.patched[0]));

  /* SEND NOW OF THE GAMES CHOSEN (0273; Louie, 2026-10-16) */
  const U = n => 'aaaaaaaa-0000-4000-8000-00000000000' + n;
  const gu = (n, iso, min) => { const r = game(iso, min); r.game_id = U(n); r.games.id = U(n); return r; };
  const GU = () => [gu(1, '2026-10-01T19:00:00Z'), gu(2, '2026-10-15T19:00:00Z'), gu(3, '2026-10-17T18:00:00Z'), gu(4, '2026-10-17T20:00:00Z', 0)];
  W = world({ games: GU(), sub: { send_now_at: '2026-10-22T11:58:00Z', send_now_games: [U(3), U(1), 'not-a-game', U(4), U(3)] } });
  await M.playerRound(THU);
  ok('two games of two weeks chosen: one email, the report drawn of those games (in the order played), not of a week',
     W.sent.length === 1 && new RegExp('&tab=report&rpgames=' + U(1) + ',' + U(3) + '$').test(pdfs[pdfs.length - 1]) && W.askedGames.join() === [U(3), U(1), U(4)].join(), [pdfs[pdfs.length - 1], W.askedGames]);
  ok('...the email: "Sam Smith: your player report, 1–17 October 2026", the games listed, the section named for them',
     W.sent[0].subject === 'Sam Smith: your player report, 1–17 October 2026' && /with these two games/.test(W.sent[0].html) && /Selected games<\/b>/.test(W.sent[0].html) &&
     !/Games played during the week/.test(W.sent[0].html) && (W.sent[0].html.match(/Bristol/g) || []).length === 2, W.sent[0].subject);
  ok('...the request cleared with its games, and the console told what went (the one they did not play said)', W.patched.length === 1 && W.patched[0].send_now_at === null && W.patched[0].send_now_games === null &&
     /^Sent 2 chosen games \(1–17 October 2026\); one chosen was not a final they played in$/.test(W.patched[0].last_detail), W.patched);
  ok('...games of two weeks are no week: nothing logged, so each Monday email goes as it would', !W.posted.length);
  W = world({ games: GU(), sub: { send_now_at: '2026-10-22T11:58:00Z', send_now_games: [U(2), U(3)] } });
  await M.playerRound(THU);
  ok('every game of one week chosen: that week logged, so its Monday does not send the same report again', W.sent.length === 1 && W.posted.length === 1 && W.posted[0].week === '2026-10-12' && /chosen/.test(W.posted[0].detail), W.posted);
  W = world({ games: GU().concat([gu(5, '2026-10-13T19:00:00Z')]), sub: { send_now_at: '2026-10-22T11:58:00Z', send_now_games: [U(3)] } });
  await M.playerRound(THU);
  ok('...a part of a week chosen: sent, and the week not logged (its Monday email still has all of it)', W.sent.length === 1 && !W.posted.length &&
     W.sent[0].subject === 'Sam Smith: your player report, 17 October 2026' && /with this game/.test(W.sent[0].html), [W.sent.map(x => x.subject), W.posted]);
  W = world({ games: GU(), sub: { send_now_at: '2026-10-22T11:58:00Z', send_now_games: [U(4), U(8)] } });
  await M.playerRound(THU);
  ok('...none of them a game they played: nothing sent, the request cleared and the console told why', !W.sent.length && W.patched[0].send_now_at === null &&
     /none of the 2 game\(s\) chosen is a final they played in/.test(W.patched[0].last_detail), W.patched);
  ok('...at most twelve read, as 0273 allows', M.MAX_PICKED === 12 && /\.slice\(0, MAX_PICKED\)/.test(read('scripts', 'report_mailer.mjs')));

  W = world({ games: [game('2026-10-15T19:00:00Z')] });
  await M.playerRound(new Date('2026-10-19T06:30:00Z'));
  await M.playerRound(THU);
  ok('nothing at 7:30 on the Monday, nothing on the Thursday unasked', !W.sent.length);

  /* POTENTIAL MATCH-UPS (0274; Louie, 2026-10-16) - stand-ins for the clubs' position files (where each player has played
     this season) and the browser (the opponents' truncated pages) */
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const pos = (sec, s, gp) => ({ sec, s, gp });
  /* ours: Sam at 75% SG, 25% SF (a shooting guard, 2.25); Bristol (tb): a PG and an SG (both the same position for a guard),
     an SF (one up), a PF (two up: not), an SG who barely plays; Leeds (tl): a centre only */
  const CLUBS = {
    t1: new Map([['pl1', pos([0, 4500, 1500, 0, 0], 6000, 4)]]),
    tb: new Map([['b-pg', pos([6400, 0, 0, 0, 0], 6400, 4)], ['b-sg', pos([0, 6000, 0, 0, 0], 6000, 4)], ['b-sf', pos([0, 0, 5000, 0, 0], 5000, 4)],
                 ['b-pf', pos([0, 0, 0, 7000, 0], 7000, 4)], ['b-dnp', pos([0, 600, 0, 0, 0], 600, 4)]]),
    tl: new Map([['l-c', pos([0, 0, 0, 0, 6000], 6000, 4)]])
  };
  M.hooks.positions = teamId => CLUBS[teamId] || new Map();
  const pageCalls = [], indexPlans = [];
  M.hooks.index = (plan, meta) => { indexPlans.push({ plan, meta }); return { b64: JPEG, w: 10, h: 14, links: plan.flatMap(c => c.players.map(pl => ({ x: 0, y: 0, w: 0.5, h: 0.05, page: pl.page }))) }; };
  M.hooks.pages = slug => { pageCalls.push(slug); return { title: slug, outline: [{ title: 'Shot chart', page: 2 }],
    pages: [{ b64: JPEG, w: 10, h: 14, links: [{ x: 0, y: 0, w: 0.1, h: 0.1, page: 2 }] }, { b64: JPEG, w: 10, h: 14, links: [] }] }; };
  const UP = [{ id: U(7), tipoff_at: '2026-10-21T19:00:00Z', status: 'scheduled', home_team_id: 't1', away_team_id: 'tb', home: { name: 'Ours' }, away: { name: 'Bristol' } },
              { id: U(8), tipoff_at: '2026-10-25T17:00:00Z', status: 'scheduled', home_team_id: 'tl', away_team_id: 't1', home: { name: 'Leeds' }, away: { name: 'Ours' } }];
  const PEOPLE = [['b-sg', 'Bea', 'Same'], ['b-sf', 'Ben', 'Up'], ['l-c', 'Lee', 'Centre'], ['b-pg', 'Bo', 'Guard'], ['b-pf', 'Pat', 'Forward']].map(([id, f, l]) => ({ id, first_name: f, last_name: l, slug: 'x-' + id }));
  const fetch2 = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url), pth = u.replace('https://db.example/rest/v1/', '');
    const res = x => ({ ok: true, status: 200, text: async () => JSON.stringify(x), json: async () => x });
    if (pth.startsWith('games?or=') && pth.includes('status=in.(scheduled,live)')) { W.upAsked = (W.upAsked || 0) + 1; return res(W.up || []); }
    if (pth.startsWith('games?id=in.')) { const ids = pth.match(/id=in\.\(([^)]*)\)/)[1].split(','); return res((W.up || []).filter(g => ids.includes(g.id))); }
    if (pth.startsWith('players?id=in.')) { const ids = pth.match(/id=in\.\(([^)]*)\)/)[1].split(','); return res(PEOPLE.filter(x => ids.includes(x.id))); }
    return fetch2(url, opt);
  };
  W = world({ games: [game('2026-10-15T19:00:00Z')], up: UP, sub: { send_matchups: true } });
  await M.playerRound(MON);
  const mu = W.sent[0] && W.sent[0].attachments[1];
  ok('match-ups ticked: the Monday email carries a second PDF, of the week now beginning\'s opponents', W.sent.length === 1 && W.sent[0].attachments.length === 2 &&
     /^epinoia-matchups-sam-smith-2026-10-19\.pdf$/.test(mu && mu.filename) && /^%PDF/.test(Buffer.from(mu.content, 'base64').toString('latin1')), W.sent[0] && W.sent[0].attachments.map(a => a.filename));
  ok('...Bristol: their position first - a guard\'s is either guard spot, the PG and the SG by minutes - then the SF one up; not the PF two up, not the guard who barely plays',
     pageCalls.slice(0, 3).join() === 'x-b-pg,x-b-sg,x-b-sf' && !pageCalls.includes('x-b-pf'), pageCalls);
  ok('...Leeds has only a centre: their rotation player nearest above, so no opponent goes without one', pageCalls[3] === 'x-l-c' && pageCalls.length === 4, pageCalls);
  const pdfTxt = Buffer.from(mu.content, 'base64').toString('latin1');
  const IX = indexPlans[0];
  ok('...an index first, just of the players: each club, its players, their position and the page each starts on (after the index: 2, 4, 6, 8)',
     IX && IX.plan.map(c => c.head.replace(/ \(.*$/, '') + ':' + c.players.map(x => x.name + '/' + x.pos + '@' + x.page).join('+')).join('|') === 'v Bristol:Bo Guard/PG@2+Bea Same/SG@4+Ben Up/SF@6|at Leeds:Lee Centre/C@8' &&
     IX.meta.name === 'Sam Smith' && IX.meta.pos === 'SG' && IX.meta.team === 'Ours', IX && IX.plan);
  ok('...the index the first page and the first bookmark, its rows links to the players\' pages', pdfTitles(pdfTxt)[0] === 'Index' &&
     (pdfTxt.match(/\/Subtype \/Link/g) || []).length >= 4 + 4, pdfTitles(pdfTxt));
  ok('...one PDF of them all: nine pages (the index and four players), bookmarked by club, then player, then each one\'s own sections',
     (pdfTxt.match(/\/Type \/Page\b/g) || []).length === 9 && pdfTitles(pdfTxt).some(t => /^v Bristol/.test(t)) && pdfTitles(pdfTxt).some(t => /^at Leeds/.test(t)) &&
     pdfTitles(pdfTxt).includes('Bea Same · SG, same position') && pdfTitles(pdfTxt).includes('Shot chart'), pdfTitles(pdfTxt));
  ok('...the email names them: their position, what that is to Sam, minutes a game; and Sam\'s own', /Potential match-ups<\/b>, in the second PDF \(they play SG\)/.test(W.sent[0].html) &&
     /Bo Guard <span[^>]*>\(PG, same position, 26\.7 min a game\)/.test(W.sent[0].html) && /Ben Up <span[^>]*>\(SF, one position up/.test(W.sent[0].html), W.sent[0].html.slice(0, 200));
  ok('...and the console is told', /and the match-ups \(4 players\)/.test(W.patched[0].last_detail) && /match-ups/.test(W.posted[0].detail), [W.patched, W.posted]);
  W = world({ games: [game('2026-10-15T19:00:00Z')], up: UP });
  pageCalls.length = 0;
  await M.playerRound(MON);
  ok('match-ups not ticked: the email as before, nothing more drawn or asked', W.sent.length === 1 && W.sent[0].attachments.length === 1 && !pageCalls.length && !W.upAsked);
  W = world({ games: [game('2026-10-08T19:00:00Z')], up: UP, sub: { send_matchups: true } });
  await M.playerRound(MON);
  ok('a week they did not play, match-ups ticked: the match-ups go alone, and the week is logged', W.sent.length === 1 && W.sent[0].attachments.length === 1 &&
     /^Sam Smith: potential match-ups, 21–25 October 2026$/.test(W.sent[0].subject) && W.posted.length === 1 && /match-ups only/.test(W.posted[0].detail), [W.sent.map(x => x.subject), W.posted]);
  W = world({ games: [], up: UP, sub: { send_now_at: '2026-10-22T11:58:00Z', send_now_report: false, send_now_matchups: [U(8)] } });
  pageCalls.length = 0;
  await M.playerRound(THU);
  ok('send now with the match-ups alone (send_now_report false): Leeds\' only, and the request cleared with its match-ups',
     W.sent.length === 1 && pageCalls.join() === 'x-l-c' && W.patched[0].send_now_at === null && W.patched[0].send_now_matchups === null && W.patched[0].send_now_report === null, [pageCalls, W.patched]);
  W = world({ games: GU(), up: UP, sub: { send_now_at: '2026-10-22T11:58:00Z', send_now_games: [U(2)], send_now_matchups: [U(7)] } });
  await M.playerRound(THU);
  ok('send now with games and match-ups: the report of the games, and the match-ups of the games to come ticked', W.sent.length === 1 && W.sent[0].attachments.length === 2 && /and the match-ups/.test(W.patched[0].last_detail));
  globalThis.fetch = realFetch;
  M.hooks.pdf = M.hooks.positions = M.hooks.pages = M.hooks.index = null;

  const MJ = read('scripts', 'report_mailer.mjs');
  ok('main() runs the players\' round after the clubs, and a database before 0272 only skips it', /try \{ const PR = await playerRound\(\); failed \+= PR\.failed; players = PR\.n; \} catch \(e\) \{ console\.warn\('player reports skipped:'/.test(MJ));
  ok('...with the address\'s ONLY filter, and every profile of the player\'s (linked_players)', /if \(env\.ONLY && s\.email !== env\.ONLY\) continue;[\s\S]{0,900}?try \{ failed \+= \(await onePlayer\(s, now\)\)/.test(MJ) && /rest\('rpc\/linked_players'/.test(MJ));
}

/* ======================================================================== potential match-ups (0274) === */
{
  const require2 = (await import('node:module')).createRequire(import.meta.url);
  const MU = require2('../../epinoia/matchup.js');
  ok('where a player plays: the average spot of their seconds at PG..C - 75% SG and 24% SF is a shooting guard (Dan Hadley\'s breakdown)',
     Math.abs(MU.spotOf([0, 75, 24, 0, 0]) - 2.242) < 0.001 && MU.posOf(MU.spotOf([0, 75, 24, 0, 0])) === 'SG' && MU.spotOf([0, 0, 0, 0, 0]) === null && MU.posOf(4.6) === 'C');
  const R_ = (a, b) => MU.relOf(a, b);
  ok('the same position: theirs, and for a guard either guard spot (a PG and an SG guard each other)',
     R_(2, 1) === 'same' && R_(1, 2) === 'same' && R_(2, 2) === 'same' && R_(3, 3) === 'same' && R_(5, 5) === 'same' && R_(3, 2) === null);
  ok('...one position up: the next above (a guard\'s is SF); two up, or down, is neither; a centre has none up',
     R_(2, 3) === 'up' && R_(1, 3) === 'up' && R_(3, 4) === 'up' && R_(4, 5) === 'up' && R_(2, 4) === null && R_(4, 3) === null && R_(5, 4) === null);
  const P = (id, team, spot, mpg, gp) => ({ id, team, spot, mpg, gp: gp == null ? 5 : gp });
  const players = [P('g1', 'A', 1, 30), P('g2', 'A', 2.1, 29), P('g3', 'A', 1.3, 28), P('g4', 'A', 1.9, 27), P('g5', 'A', 2.2, 26), P('f1', 'A', 3, 20), P('p1', 'A', 4, 35),
    P('g6', 'A', 2, 8), P('g7', 'A', 2, 25, 1), P('c1', 'C', 5, 30), P('c2', 'C', 4.4, 20)];
  const R = MU.matchups({ me: { spot: 2.24 }, players, teams: ['A', 'B', 'C'] });
  const A = R.byTeam.get('A').map(x => x.id + ':' + x.rel);
  ok('a club of five guards and a forward: four guards by minutes, and the last place for the forward one position up',
     A.join() === 'g1:same,g2:same,g3:same,g4:same,f1:up' && R.me.pos === 'SG', A);
  ok('...not under ten minutes a game, nor a single game, nor two positions up', !A.some(x => /^(g6|g7|p1):/.test(x)));
  ok('...a club with nobody at either gives their rotation player nearest above (the PF before the centre)', R.byTeam.get('C').map(x => x.id + ':' + x.rel).join() === 'c2:near', R.byTeam.get('C'));
  ok('...a club with no position files gives none', R.byTeam.get('B').length === 0);
  ok('no position for them (no minutes on the floor): no match-ups, and why', !MU.matchups({ me: { spot: null }, players, teams: ['A'] }).ok &&
     /position is not known/.test(MU.matchups({ me: {}, players, teams: ['A'] }).why));
  ok('a guards\' club with nobody one position up: all five places guards', MU.matchups({ me: { spot: 2 }, players: players.filter(x => x.id !== 'f1'), teams: ['A'] }).byTeam.get('A').length === 5);

  const M2 = await import('../../scripts/report_mailer.mjs');
  const games = [{ id: 'g1', tipoff_at: '2026-10-21T19:00:00Z', home_team_id: 'us', away_team_id: 'A', home: { name: 'Us' }, away: { name: 'Alpha' } },
                 { id: 'g2', tipoff_at: '2026-10-23T19:00:00Z', home_team_id: 'B', away_team_id: 'us', home: { name: 'Beta' }, away: { name: 'Us' } },
                 { id: 'g3', tipoff_at: '2026-10-25T19:00:00Z', home_team_id: 'us', away_team_id: 'A', home: { name: 'Us' }, away: { name: 'Alpha' } },
                 { id: 'g4', tipoff_at: '2026-10-25T19:00:00Z', home_team_id: 'B', away_team_id: 'C', home: { name: 'Beta' }, away: { name: 'Gamma' } }];
  const O = M2.opponentsIn('us', games);
  ok('the opponents of the games ahead: in the order they come, a club once, only games of his club', O.map(o => (o.home ? 'v ' : 'at ') + o.name).join() === 'v Alpha,at Beta', O);
  const J = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const pg = links => ({ b64: J, w: 10, h: 14, links });
  const bytes = M2.stitchPages([{ head: 'v Alpha', kids: [{ title: 'A One', got: { outline: [{ title: 'Connections', page: 2 }], pages: [pg([{ x: 0, y: 0, w: .1, h: .1, page: 2 }]), pg([])] } },
                                                        { title: 'A Two', got: { outline: [], pages: [pg([{ x: 0, y: 0, w: .1, h: .1, page: 1 }])] } }] },
                                { head: 'at Beta', kids: [] }], 'T');
  const txt = Buffer.from(bytes).toString('latin1');
  const pageObjs = [...txt.matchAll(/(\d+) 0 obj\n<< \/Type \/Page\b/g)].map(m => +m[1]);
  ok('one PDF: every player\'s pages in turn, a club with none left out of the bookmarks', pageObjs.length === 3 && pdfTitles(txt).join('|') === 'v Alpha|A One|Connections|A Two', pdfTitles(txt));
  ok('...each page\'s links moved to where its report\'s pages now are (A Two\'s page 1 is the third)', new RegExp('/Dest \\[' + pageObjs[2] + ' 0 R').test(txt) && new RegExp('/Dest \\[' + pageObjs[1] + ' 0 R').test(txt), pageObjs);
  ok('nothing drawn: no PDF', M2.stitchPages([{ head: 'x', kids: [] }], 'T') === null && M2.stitchPages([{ head: 'x', kids: [] }], 'T', pg([])) === null);
  /* THE INDEX (Louie, 2026-10-16: "an auto index (just for players) at the start of the pdf") */
  const parts = [{ head: 'v Alpha', kids: [{ name: 'A One', rel: 'same', mpg: 20, got: { pages: [pg([]), pg([]), pg([])] } }, { name: 'A Two', rel: 'up', mpg: 15, got: { pages: [pg([])] } }] },
                 { head: 'at Beta', kids: [{ name: 'B Gone', rel: 'same', mpg: 12, got: null }] }, { head: 'v Gamma', kids: [{ name: 'G One', rel: 'near', mpg: 30, got: { pages: [pg([]), pg([])] } }] }];
  const plan = M2.matchupPlan(parts, 1);
  ok('the index\'s pages: each player where their pages begin after it (2, 5, 6), a club none of whose players was drawn left out',
     plan.map(c => c.head + ':' + c.players.map(x => x.page).join(',')).join('|') === 'v Alpha:2,5|v Gamma:6', plan);
  const front = { b64: J, w: 10, h: 14, links: plan.flatMap(c => c.players.map(x => ({ x: 0, y: 0, w: .5, h: .05, page: x.page }))) };
  const withIx = Buffer.from(M2.stitchPages(parts, 'T', front)).toString('latin1');
  const objs = [...withIx.matchAll(/(\d+) 0 obj\n<< \/Type \/Page\b/g)].map(m => +m[1]);
  ok('...the index the first of the PDF\'s pages, each row a link to the page its player begins on', objs.length === 7 && pdfTitles(withIx)[0] === 'Index' &&
     [2, 5, 6].every(n => new RegExp('/Dest \\[' + objs[n - 1] + ' 0 R').test(withIx)), objs);
  const IH = M2.indexHTML(plan, { name: 'Dan Hadley', team: 'Loughborough Riders', colour: '#123456', span: '17–24 October 2026' });
  ok('...drawn in the report\'s type: every player a row naming what they are to them, minutes and page, each row a link',
     (IH.match(/data-goto="/g) || []).length === 3 && /data-goto="5"><b>A Two<\/b><span class="rel">one position up · 15 min a game/.test(IH) && /Dan Hadley · Loughborough Riders · 17–24 October 2026/.test(IH) &&
     !/\b(he|his|him)\b/.test(IH.replace(/<[^>]*>/g, ' ')), IH.slice(0, 300));
  const blocks = M2.matchupBlocks([{ head: 'v Alpha (Tue 21 Oct)', who: [{ name: 'A One', rel: 'same', mpg: 24.5 }, { name: 'A Two', rel: 'up', mpg: 18 }] }, { head: 'at Beta (Thu 23 Oct)', who: [], none: 'no player of theirs has this season’s numbers to match on' }]).join('');
  ok('the email\'s lines: each club, its players and what they are to him, and a club with none said why', /v Alpha \(Tue 21 Oct\)<\/b>: A One <span[^>]*>\(same position, 24\.5 min a game\)<\/span>, A Two <span[^>]*>\(one position up/.test(blocks) && /at Beta[^]*no player of theirs/.test(blocks), blocks);
  ok('...and none at all when nobody was drawn', M2.matchupBlocks([{ head: 'x', who: [] }]).length === 0);
  ok('the truncated report: the title page, the shot chart, left v right and connections', M2.MATCHUP_MODS === 'cover,shots,lvr,conn' && M2.MATCHUP_MAX === 15);

  const RJS = read('epinoia', 'report.js'), PPJ = read('epinoia', 'report-playerpages.js'), PLJ = read('epinoia', 'p', 'player.js'), RAS = read('epinoia', 'raster.js');
  ok('report.js: ?rpmods= draws those pages alone, and keeps nothing of it as the reader\'s choice', /get\('rpmods'\)/.test(RJS) && /if \(onlyMods\.length\) o\.modules\.forEach\(m => \{ conf\.on\[m\.key\] = onlyMods\.indexOf\(m\.key\) >= 0; \}\);/.test(RJS) &&
     /on: state\.onlyMods \? \(store\.get\(key, \{\}\)\.on \|\| \{\}\) : conf\.on/.test(RJS));
  ok('...the bot\'s pages handed over as JPEGs with their links (raster.js pagesOf, the same drawing as the PDF)', /if \(root\.EPINOIA_RP_BOT\) root\.__rpPages = async/.test(RJS) && /async function pagesOf\(nodes, opt\)/.test(RAS) && /return pdfFromJpegs\(await pagesOf\(nodes, o\)/.test(RAS));
  const MJ2 = read('scripts', 'report_mailer.mjs');
  ok('where they play is read from the clubs\' position files of the season, every competition (snapshots/pos), not the player page',
     /storage\/v1\/object\/public\/snapshots\/pos\//.test(MJ2) && /export async function clubPositions\(teamId\)/.test(MJ2) && !/rpfield/.test(PLJ));
  ok('...and each opponent drawn over their whole season (?rpscope=all)', /&tab=report&rpscope=all&rpmods=' \+ MATCHUP_MODS/.test(MJ2));
  ok('ACTIONABLE INSIGHTS without the highlighted coaching line (Louie, 2026-10-16)', !/rp-in-do/.test(PPJ) && /const li = x => '<li><b>' \+ esc\(x\.head\) \+ '<\/b> ' \+ esc\(x\.text\) \+ '<\/li>';/.test(PPJ) && !/rp-in-do/.test(read('epinoia', 'kit', 'report.css')));
  const MIG = read('supabase', 'migrations', '0274_player_matchup_reports.sql');
  ok('0274: the match-ups tick, send now\'s games to come (at most eight) and the match-ups alone', /add column if not exists send_matchups boolean not null default false/.test(MIG) &&
     /send_now_matchups uuid\[\]\s*\n\s*check \(send_now_matchups is null or cardinality\(send_now_matchups\) between 1 and 8\)/.test(MIG) && /add column if not exists send_now_report boolean/.test(MIG));
}

/* ======================================================================== 0272 === */
console.log('\nthe database (0272)');
{
  const M72 = read('supabase', 'migrations', '0272_player_report_mail.sql');
  let PGlite;
  try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
  catch { console.log('  SKIP  the database part: @electric-sql/pglite is not installed'); PGlite = null; }
  if (PGlite) {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.players (id uuid primary key);
      create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.padmin', true), 'no') = 'yes' $$;
      grant usage on schema public to anon, authenticated, service_role;
    `);
    let applied = true;
    try { await db.exec(M72); await db.exec(M72); } catch (e) { applied = e.message; }
    ok('0272 applies, twice', applied === true, applied);
    const P1 = '00000000-0000-0000-0000-0000000000d1', ADMIN = '00000000-0000-0000-0000-0000000000a1';
    await db.exec(`insert into public.players values ('${P1}')`);
    const as = async (sql, o = {}) => {
      await db.exec(`reset role; set test.uid = '${ADMIN}'; set test.padmin = '${o.padmin || 'no'}'; set role ${o.role || 'authenticated'};`);
      try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
    };
    const err = async (sql, o) => { try { await as(sql, o); return null; } catch (e) { return e.message; } };
    ok('a platform administrator adds an address for a player', (await as(`insert into public.report_mail_players (email, player_id, name, tz) values ('sam@example.com', '${P1}', 'Sam', 'Europe/London') returning id`, { padmin: 'yes' })).length === 1);
    ok('...once (one row an address and a player)', /duplicate key|unique/i.test(await err(`insert into public.report_mail_players (email, player_id) values ('sam@example.com', '${P1}')`, { padmin: 'yes' }) || ''));
    ok('...and a mistyped address is refused', /check/i.test(await err(`insert into public.report_mail_players (email, player_id) values ('not-an-email', '${P1}')`, { padmin: 'yes' }) || ''));
    ok('anybody else sees none and adds none', (await as(`select * from public.report_mail_players`)).length === 0 &&
       /row-level security|violates/i.test(await err(`insert into public.report_mail_players (email, player_id) values ('x@example.com', '${P1}')`) || ''));
    const sid = (await as(`select id from public.report_mail_players`, { padmin: 'yes' }))[0].id;
    await as(`insert into public.report_mail_player_log (sub_id, week) values ('${sid}', '2026-10-12')`, { role: 'service_role' });
    ok('the mailer (service role) logs a week once', /duplicate key|unique/i.test(await err(`insert into public.report_mail_player_log (sub_id, week) values ('${sid}', '2026-10-12')`, { role: 'service_role' }) || ''));
    ok('...an administrator reads the log, nobody else writes it', (await as(`select * from public.report_mail_player_log`, { padmin: 'yes' })).length === 1 &&
       /permission denied|row-level security/i.test(await err(`insert into public.report_mail_player_log (sub_id, week) values ('${sid}', '2026-10-19')`, { padmin: 'yes' }) || ''));
    /* 0273: the games chosen for a send now */
    let a73 = true;
    try { const M73 = read('supabase', 'migrations', '0273_player_report_games.sql'); await db.exec(M73); await db.exec(M73); } catch (e) { a73 = e.message; }
    ok('0273 applies, twice', a73 === true, a73);
    const ids = n => "array[" + Array.from({ length: n }, (_, i) => "'00000000-0000-0000-0000-" + String(i + 1).padStart(12, '0') + "'::uuid").join(',') + "]";
    ok('...an administrator writes the games chosen with send now, one to twelve; thirteen, or none, is refused',
       (await as(`update public.report_mail_players set send_now_at = now(), send_now_games = ${ids(3)} returning cardinality(send_now_games) n`, { padmin: 'yes' }))[0].n === 3 &&
       /check/i.test(await err(`update public.report_mail_players set send_now_games = ${ids(13)}`, { padmin: 'yes' }) || '') &&
       /check/i.test(await err(`update public.report_mail_players set send_now_games = '{}'::uuid[]`, { padmin: 'yes' }) || ''));
    ok('...and nobody else can', (await as(`update public.report_mail_players set send_now_games = null returning id`)).length === 0);
    ok('a player deleted takes his addresses and their log with him', (await (async () => { await db.exec(`delete from public.players where id = '${P1}'`); return (await db.query('select count(*)::int n from public.report_mail_player_log')).rows[0].n; })()) === 0);
  }
}

/* ======================================================================== THE CONSOLE === */
console.log('\nthe console: the reports manager\'s Players tab (admin/platform/reports-manager.js)');
{
  const PJ = read('epinoia', 'admin', 'platform', 'platform.js'), PH = read('epinoia', 'admin', 'platform', 'index.html'), RJ = read('epinoia', 'admin', 'platform', 'reports-manager.js');
  ok('the manager\'s tabs (Louie, 2026-10-16: "two tabs in report manager (teams and players)"): Teams, Players, and the Synergy files; the console opens it on Teams or on Players',
     /\[\['addr', 'Teams'\], \['pl', 'Players'\], \['syn', 'Synergy files'\]\]/.test(RJ) && /\[\['#mailManage', 'addr'\], \['#mailManagePl', 'pl'\]\]/.test(PJ) && PH.includes('id="mailManagePl"') &&
     /if \(which === 'addr' \|\| which === 'pl' \|\| which === 'syn'\) tab = which;/.test(RJ));
  ok('...the players\' section has left the Reports tab: none of it on the page or in platform.js, the tab reads the clubs\' alone', !/id="pmail/.test(PH) && !/loadPlayerMail|PMAIL/.test(PJ) && /reports: loadMail \};/.test(PJ));
  /* the Reports tab (2026-10-16): the clubs' section in its pane, none left in Accounts, and nothing of it read at the start */
  const paneOf = id => { const m = new RegExp('<div class="pane" id="pane-' + id + '">([\\s\\S]*?)\\n    </div>\\n').exec(PH); return m ? m[1] : ''; };
  const rp = paneOf('reports'), ac = paneOf('acct');
  ok('the Reports tab, after Accounts: the clubs\' reports and the manager\'s two buttons in it, none left in Accounts, read when it opens',
     /data-p="acct" role="tab">Accounts<\/button>\n\s*<button class="ep-tab" data-p="reports" role="tab">Reports<\/button>/.test(PH) &&
     ['mailManage', 'mailManagePl', 'mailForm', 'mailList'].every(id => rp.includes('id="' + id + '"')) && ac.includes('id="acctList"') && !/id="p?mail/.test(ac) &&
     !/Promise\.all\(\[loadOverview\(\)[^\n]*loadMail/.test(PJ), [rp.length, ac.length]);
  ok('the Players tab: a player found by name in the site\'s search, the address, a first name, the time zone (their league\'s when picked); added once an address and a player',
     /sb\.rpc\('site_search', \{ p_q: q, p_limit: 12 \}\)/.test(RJ) && /select\('teams\(leagues\(timezone\)\)'\)\.eq\('player_id', pk\.id\)/.test(RJ) &&
     /const row = Object\.assign\(\{ email: e, player_id: who\.id,/.test(RJ) && /from\('report_mail_players'\)\.upsert\(row, \{ onConflict: 'email,player_id' \}\)/.test(RJ));
  ok('...each with what the mailer last did, send now, pause and remove; read again while a send now waits; a database before 0272 says so',
     /btn\(x\.send_now_at \? 'queued' : 'send now', 'mini', \(\) => sendPlayerNow\(x, pname, now\)\)/.test(RJ) && /update\(\{ active: !x\.active \}\)/.test(RJ) && /from\('report_mail_players'\)\.delete\(\)\.eq\('id', x\.id\)/.test(RJ) &&
     /pTimer = setTimeout\(\(\) => \{ if \(dlg && dlg\.open && tab === 'pl' && !document\.hidden\) draw\(\); \}, 30000\);/.test(RJ) && /Players’ weekly reports arrive with migration 0272/.test(RJ));
  ok('send now asks which games (platform.js askPick, handed to the manager) and writes them (0273); before 0273 it asks before sending the week',
     /pickWeek, askPick, weekOf, ownDueFor, weekWords, trial: TRIAL \}, which\)/.test(PJ) && /if \(pick && pick\.games\.length\) upd\.send_now_games = pick\.games;/.test(RJ) && /\.update\(upd\)\.eq\('id', x\.id\)/.test(RJ) &&
     /Choosing the games needs migration 0273, which is not applied yet\. Send the week of their latest game instead\?/.test(RJ));
}

if (fail) { console.log(`\n${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\nplayer weekly report: ${pass} passed - the shared full table, connections, the week, the insights, the Monday email, 0272, the console`);
