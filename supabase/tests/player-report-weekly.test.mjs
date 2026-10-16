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
//   * the console: the form and the list (platform.js loadPlayerMail).
//
//   TZ=UTC node supabase/tests/player-report-weekly.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
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
     /const asked = new URLSearchParams\(location\.search\)\.get\('rpweek'\);/.test(PJ) && /if \(!monday\) monday = mondayOf\(rows\.map\(r => r\.__day\)\.sort\(\)\.pop\(\)\);/.test(PJ)
     && /const tz = lgs\.timezone \|\| 'UTC';/.test(PJ) && /leagues\(id,slug,name,logo_path,colour_a,gender,timezone\)/.test(PJ)
     && /weekGames: \(\) => RP_WEEK \|\| \(RP_WEEK = loadWeekGames\(pl, team, rpGet\('lvrPids', 60000\)\)/.test(PJ));
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
      return res(W.games.filter(r => Date.parse(r.games.tipoff_at) >= lo && Date.parse(r.games.tipoff_at) < hi));
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

  W = world({ games: [game('2026-10-15T19:00:00Z')] });
  await M.playerRound(new Date('2026-10-19T06:30:00Z'));
  await M.playerRound(THU);
  ok('nothing at 7:30 on the Monday, nothing on the Thursday unasked', !W.sent.length);
  globalThis.fetch = realFetch;
  M.hooks.pdf = null;

  const MJ = read('scripts', 'report_mailer.mjs');
  ok('main() runs the players\' round after the clubs, and a database before 0272 only skips it', /try \{ const PR = await playerRound\(\); failed \+= PR\.failed; players = PR\.n; \} catch \(e\) \{ console\.warn\('player reports skipped:'/.test(MJ));
  ok('...with the address\'s ONLY filter, and every profile of the player\'s (linked_players)', /if \(env\.ONLY && s\.email !== env\.ONLY\) continue;\s*try \{ failed \+= \(await onePlayer\(s, now\)\)/.test(MJ) && /rest\('rpc\/linked_players'/.test(MJ));
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
    ok('a player deleted takes his addresses and their log with him', (await (async () => { await db.exec(`delete from public.players where id = '${P1}'`); return (await db.query('select count(*)::int n from public.report_mail_player_log')).rows[0].n; })()) === 0);
  }
}

/* ======================================================================== THE CONSOLE === */
console.log('\nthe console (admin/platform)');
{
  const PJ = read('epinoia', 'admin', 'platform', 'platform.js'), PH = read('epinoia', 'admin', 'platform', 'index.html');
  ok('the form: a player found by name, the address, a first name, the time zone; and the list', ['pmailPlayer', 'pmailPlayers', 'pmailEmail', 'pmailName', 'pmailTz', 'pmailGo', 'pmailList'].every(id => PH.includes('id="' + id + '"')));
  ok('...the player from the site\'s search, their league\'s clock set when picked', /sb\.rpc\('site_search', \{ p_q: q, p_limit: 12 \}\)/.test(PJ) && /select\('teams\(leagues\(timezone\)\)'\)\.eq\('player_id', got\.id\)/.test(PJ));
  ok('...added once an address and a player; send now, pause and remove on each; read when the Reports tab opens',
     /from\('report_mail_players'\)\.upsert\(\{ email, player_id: p\.id,/.test(PJ) && /\{ onConflict: 'email,player_id' \}/.test(PJ) && /update\(\{ send_now_at: new Date\(\)\.toISOString\(\) \}\)/.test(PJ)
     && /reports: \(\) => Promise\.all\(\[loadMail\(\), loadPlayerMail\(\)\]\) \};/.test(PJ));
  /* the Reports tab (2026-10-16): both sections in its pane, none left in Accounts, and nothing of them read at the start */
  const paneOf = id => { const m = new RegExp('<div class="pane" id="pane-' + id + '">([\\s\\S]*?)\\n    </div>\\n').exec(PH); return m ? m[1] : ''; };
  const rp = paneOf('reports'), ac = paneOf('acct');
  ok('the reports have a tab of their own, after Accounts: the clubs\' and the players\' sections in it, and none left in Accounts',
     /data-p="acct" role="tab">Accounts<\/button>\n\s*<button class="ep-tab" data-p="reports" role="tab">Reports<\/button>/.test(PH) &&
     ['mailManage', 'mailForm', 'mailList', 'pmailForm', 'pmailList'].every(id => rp.includes('id="' + id + '"')) &&
     ac.includes('id="acctList"') && !/id="p?mail/.test(ac), [rp.length, ac.length]);
  ok('...read when it opens, not at the console\'s start', !/Promise\.all\(\[loadOverview\(\)[^\n]*loadMail/.test(PJ));
  ok('...and a database before 0272 says so', /Players’ weekly reports arrive with migration 0272/.test(PJ));
}

if (fail) { console.log(`\n${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\nplayer weekly report: ${pass} passed - the shared full table, connections, the week, the insights, the Monday email, 0272, the console`);
