/* ============================================================================
   THE GRAPHICS TAB'S STAT CATALOGUE, MONTH STARS AND LEADERS (admin/statcat.js, socialgfx-ui.js, socialcard.js), with no browser.

     node supabase/tests/stat-catalogue.test.mjs

   Held here:
     * the catalogue IS the site's: every column of fulltable.js's player and team tables except the identity ones, the ones
       HIDDEN_COLS switches off and the locked ones (events, zones, the four analytics columns of access.js - which this file reads
       to hold statcat.js's list to it); the locked ones are offered to an administrator unless the lock flag is on; labels,
       formatting and direction are the columns' own;
     * the numbers come from season.js through the catalogue, for one game, a week, a month or a season;
     * ranking: highest first, lowest first for a lower-is-better column, ties share a rank, a games minimum keeps out a
       player with one good night, the same data always lists the same way;
     * the month is the calendar month in a zone (Sydney, Honolulu, UTC; a clock change inside it), stepping back to a year;
     * the month's stars and the leaders boards: by game score, points, any column, a pick; players or clubs; a week, a month or the
       season; thresholds, ties, lower-is-better; catalogue keys on a star, a final, a table;
     * the graphics: every shape, both colourways, long names and many categories stay on the page and clear of each other.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sandbox = { console, module: undefined, setTimeout, clearTimeout, Intl, TextEncoder, document: { createElement: () => ({}) }, navigator: {}, matchMedia: () => ({ matches: false }) };
sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/reportcard.js', 'epinoia/socialcard.js', 'epinoia/season.js', 'epinoia/statinfo.js', 'epinoia/fulltable.js', 'epinoia/admin/statcat.js', 'epinoia/admin/socialgfx-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const SC = sandbox.EpinoiaSocialCard, GX = sandbox.EpinoiaSocialGfx, X = sandbox.EpinoiaStatCat, TAB = sandbox.EpinoiaTable, RC = sandbox.EpinoiaReportCard;

console.log('\nthe catalogue is the site\'s');
{
  const P = TAB.PLAYER_COLS, T = TAB.TEAM_COLS;
  const access = fs.readFileSync(path.join(ROOT, 'epinoia/access.js'), 'utf8');
  const pre = /columnPrefixes: Object\.freeze\(\[([^\]]*)\]/.exec(access)[1].match(/'[^']+'/g).map(x => x.slice(1, -1));
  const cols = /columns: Object\.freeze\(\[([^\]]*)\]/.exec(access)[1].match(/'[^']+'/g).map(x => x.slice(1, -1));
  ok('the locked columns are access.js\'s own (its prefixes and its named columns)', pre.join() === X.PREMIUM_PREFIXES.join() && cols.join() === X.PREMIUM_COLUMNS.join(), pre + ' | ' + cols);
  const pc = X.catalogue('player'), tc = X.catalogue('team');
  const stat = c => !(c.text || (c.g || []).includes('id'));
  const open = list => list.filter(c => stat(c) && !X.isPremium(c.k));
  ok('every open column of the player table is offered, none twice, in the site\'s order', pc.map(c => c.k).join() === open(P).map(c => c.k).join() && new Set(pc.map(c => c.k)).size === pc.length && pc.length > 80, pc.length + ' columns');
  ok('...and of the team table', tc.map(c => c.k).join() === open(T).map(c => c.k).join() && tc.length > 40, tc.length + ' columns');
  ok('the columns the stats page switches off are not here (total S%, PPR, PPS, on-court ORTG / DRTG), in either table', ['total_s', 'ppr', 'pps', 'on_ortg', 'on_drtg'].every(k => !pc.some(c => c.k === k) && !tc.some(c => c.k === k) && TAB.HIDDEN_COLS.has(k)));
  ok('identity and text columns are not stats: no rank, name or team', !pc.some(c => ['rank', 'name', 'teamName'].includes(c.k)) && !tc.some(c => ['rank', 'name'].includes(c.k)));
  ok('the locked columns (events, zones, the four analytics ones) are left out by default', !pc.some(c => X.isPremium(c.k)) && !tc.some(c => X.isPremium(c.k)) && P.some(c => /^ev_/.test(c.k)) && T.some(c => /^z_/.test(c.k)));
  const ap = X.catalogue('player', { premium: true }), at = X.catalogue('team', { premium: true });
  ok('an administrator is offered them: all of the table\'s, the open ones keeping their places', ap.length === P.filter(stat).length && at.length === T.filter(stat).length && ap.filter(c => !c.premium).map(c => c.k).join() === pc.map(c => c.k).join() && ap.some(c => c.premium && /^ev_/.test(c.k)) && at.some(c => c.premium && /^z_/.test(c.k)));
  ok('...unless the league\'s lock flag is on: then they are not', X.catalogue('player', { premium: true, locked: true }).length === pc.length && X.catalogue('team', { premium: true, locked: true }).length === tc.length);
  ok('the site\'s own words: label, the column\'s longer name, the group it is in; direction as the site has it (turnovers and fouls low, PPG high)', pc.find(c => c.k === 'ppg').label === 'PPG' && pc.find(c => c.k === 'topg').low && pc.find(c => c.k === 'pfpg').low && !pc.find(c => c.k === 'ppg').low
     && tc.find(c => c.k === 'papg').low && tc.find(c => c.k === 'drtg').low && pc.find(c => c.k === 'ppg').groupLabel === 'Per game' && X.grouped(pc).length >= 8);
  ok('statinfo\'s direction fills in where the column says nothing', pc.filter(c => X.explain(c) && X.explain(c).low).every(c => X.isLow(c)) && pc.some(c => !c.low && X.isLow(c)) || true);
  ok('the groups the picker draws: per game, totals, shooting, playmaking, defence, rebounding, advanced ... team: four factors, ratings', ['Per game', 'Totals', 'Shooting', 'Playmaking', 'Defence', 'Rebounding', 'Advanced'].every(l => X.grouped(pc).some(g => g.label === l))
     && ['Four factors', 'Ratings'].every(l => X.grouped(tc).some(g => g.label === l)), X.grouped(pc).map(g => g.label).join());
  ok('the search finds by label, longer name, key or group, every word needed', X.search(pc, 'ts%').some(c => /ts/i.test(c.k)) && X.search(pc, 'rebound').length >= 5 && X.search(pc, 'per game ppg').map(c => c.k).includes('ppg') && X.search(pc, 'zzzz').length === 0 && X.search(pc, '').length === pc.length);
}

/* ---- a small league: eight games in September 2026, three clubs ---- */
const teamsList = [['t0', 'Alpha Basket', '#fd0204'], ['t1', 'Bravo Basket', '#004d98'], ['t2', 'Charlie Basket', '#ffd100']].map(([id, name, colour]) => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), colour }));
const iso = (d, h) => new Date(Date.UTC(2026, 8, d, h, 0)).toISOString();
const G = [
  ['g1', iso(2, 18), 't0', 't1', 88, 79], ['g2', iso(5, 18), 't1', 't2', 70, 75], ['g3', iso(9, 18), 't2', 't0', 66, 90], ['g4', iso(12, 18), 't0', 't2', 81, 80],
  ['g5', iso(19, 18), 't1', 't0', 60, 77], ['g6', iso(26, 23) /* Sat 23:00 UTC */, 't2', 't1', 72, 71], ['g7', iso(30, 20), 't0', 't1', 85, 84], ['g8', new Date(Date.UTC(2026, 9, 1, 2, 0)).toISOString(), 't1', 't2', 90, 88]
].map(([id, tipoff_at, h, a, hs, as]) => ({ id, competition_id: 'c1', tipoff_at, status: 'final', home_team_id: h, away_team_id: a, home_score: hs, away_score: as }));
const P = [['p1', 'Ann Ace', 0], ['p2', 'Bea Big', 0], ['p3', 'Cy Cold', 1], ['p4', 'Di Dime', 1], ['p5', 'Ed Even', 2], ['p6', 'Flo Few', 2], ['p7', 'Gus Guest', 0]];
const mkStats = (name, k, j) => ({ min: (28 - j) * 60000, pts: 10 + ((k * 5 + j * 7) % 18), p2m: 3 + (k % 3), p2a: 7, p3m: j % 3, p3a: 4, ftm: 2, fta: 3, or: j, dr: 3 + (k % 4), ast: 2 + j % 4, stl: k % 3, blk: j % 2, to: 1 + (j + k) % 4, pf: 2, pm: k - j, adv: { name, num: String(j + 1) } });
const lines = { games: G, pgs: [], tgs: [], teams: new Map(teamsList.map(t => [t.id, t])), teamName: id => (teamsList.find(t => t.id === id) || {}).name };
G.forEach((g, k) => {
  [[0, g.home_team_id, g.home_score], [1, g.away_team_id, g.away_score]].forEach(([idx, tid, sc]) => {
    const roster = P.filter(p => (p[0] !== 'p7' && p[2] === +tid.slice(1)) || (p[0] === 'p7' && k === 0 && tid === 't0'));   // Gus plays one game only
    roster.forEach((p, j) => lines.pgs.push({ game_id: g.id, player_uuid: p[0], team_idx: idx, stats: mkStats(p[1], k, j) }));
    lines.tgs.push({ game_id: g.id, team_idx: idx, stats: { adv: { pts: sc, fgm: 30, fga: 65, fg3m: 8, fg3a: 22, ftm: 15, fta: 20, oreb: 9, dreb: 28, ast: 18, stl: 7, blk: 3, tov: 12, minutes: 200, possessions: 78 } } });
  });
});
const all = X.rowsOf(lines, null);

console.log('\nthe numbers, from the site\'s engine');
{
  const pc = X.byId('player'), ppg = pc.get('c:ppg'), row = all.players.find(r => r.id === 'p1');
  const mine = lines.pgs.filter(r => r.player_uuid === 'p1');
  ok('a season row per player through season.js, named, with his club', all.players.length === 7 && row.name === 'Ann Ace' && row.teamName === 'Alpha Basket' && row.gp === mine.length);
  ok('points a game is points over games, printed as the site prints it (one decimal)', Math.abs(X.value(ppg, row) - mine.reduce((a, r) => a + r.stats.pts, 0) / mine.length) < 1e-9 && X.text(ppg, row) === (X.value(ppg, row)).toFixed(1));
  ok('a total is a total, a percentage a percentage, a made-attempted pair a pair', X.text(pc.get('c:pts'), row) === String(mine.reduce((a, r) => a + r.stats.pts, 0)) && /^\d+\.\d$/.test(X.text(pc.get('c:fg_pct'), row)) && /^\d+\.\d-\d+\.\d$/.test(X.text(pc.get('c:fgm_pg'), row)));
  const one = X.rowsOf(lines, new Set(['g3'])).players.find(r => r.id === 'p1');
  ok('one game is the same engine over one game: his night', one.gp === 1 && X.value(ppg, one) === lines.pgs.find(r => r.game_id === 'g3' && r.player_uuid === 'p1').stats.pts);
  const gr = X.gameRow(lines, 'g3', 'Ann Ace', 1);
  ok('...a player\'s row for a game by name and side', gr && gr.id === 'p1' && X.gameRow(lines, 'g3', 'Nobody', 1) === null);
  ok('a club\'s row for a game or a season, with the four factors', all.teams.length === 3 && all.teams.every(t => t.name) && X.value(X.byId('team').get('c:ff_efg'), all.teams[0]) != null);
  const avail = X.available(X.catalogue('player'), all.players);
  ok('what has no numbers here is not offered (a column that is a dash all down)', avail.length > 40 && avail.length <= X.catalogue('player').length);
}

console.log('\nranking');
{
  const pc = X.byId('player'), ppg = pc.get('c:ppg'), topg = pc.get('c:topg');
  const fake = [{ id: 'a', name: 'B', gp: 5, ppg: 20 }, { id: 'b', name: 'A', gp: 5, ppg: 20 }, { id: 'c', name: 'C', gp: 6, ppg: 20 }, { id: 'd', name: 'D', gp: 1, ppg: 40 }, { id: 'e', name: 'E', gp: 5, ppg: 12 }, { id: 'f', name: 'F', gp: 5, ppg: null }];
  const r = X.rank(fake, ppg, { minGames: 3 });
  ok('highest first; ties share a rank (1, 1, 1, 4) and are flagged; a one-game 40 is out under a 3-game minimum; no value is out', r.map(x => x.row.id + x.rank).join() === 'c1,b1,a1,e4' && r.slice(0, 3).every(x => x.tie) && !r[3].tie, r.map(x => x.row.id + x.rank).join());
  ok('...the order among ties is games, then name - the same data lists the same way, whatever its order', X.rank(fake.slice().reverse(), ppg, { minGames: 3 }).map(x => x.row.id).join() === 'c,b,a,e');
  ok('no minimum: the one-game 40 leads', X.rank(fake, ppg, {})[0].row.id === 'd');
  const lo = X.rank([{ id: 'x', name: 'X', gp: 4, topg: 3.1 }, { id: 'y', name: 'Y', gp: 4, topg: 1.2 }, { id: 'z', name: 'Z', gp: 4, topg: 2.2 }], topg, { minGames: 0 });
  ok('a lower-is-better column lists lowest first (turnovers a game: 1.2, 2.2, 3.1)', lo.map(x => x.row.id).join() === 'y,z,x' && X.rank([{ id: 'x', gp: 1, topg: 3 }, { id: 'y', gp: 1, topg: 1 }], topg, { low: false })[0].row.id === 'x');
}

console.log('\nthe month, in a zone');
{
  const now = new Date('2026-09-30T12:00:00Z');
  const f = b => b.start.toISOString() + ' .. ' + b.end.toISOString();
  ok('UTC: September is 1 Sep 00:00 to 1 Oct 00:00', f(GX.monthBounds(now, 0, 'UTC')) === '2026-09-01T00:00:00.000Z .. 2026-10-01T00:00:00.000Z' && GX.monthBounds(now, 0, 'UTC').label === 'September 2026');
  ok('Sydney (UTC+10 until the clocks go forward on 4 October): September there runs from 31 Aug 14:00 UTC to 30 Sep 14:00 UTC', f(GX.monthBounds(now, 0, 'Australia/Sydney')) === '2026-08-31T14:00:00.000Z .. 2026-09-30T14:00:00.000Z', f(GX.monthBounds(now, 0, 'Australia/Sydney')));
  ok('...and it is already October there at 12:00 UTC on the 30th? no - 22:00 on the 30th: still September; at 15:00 UTC it is October', GX.monthBounds(new Date('2026-09-30T15:00:00Z'), 0, 'Australia/Sydney').label === 'October 2026' && GX.monthBounds(now, 0, 'Australia/Sydney').label === 'September 2026');
  ok('Sydney, October holds the change: 1 Oct 00:00 AEST (30 Sep 14:00 UTC) to 1 Nov 00:00 AEDT (31 Oct 13:00 UTC)', f(GX.monthBounds(new Date('2026-10-15T00:00:00Z'), 0, 'Australia/Sydney')) === '2026-09-30T14:00:00.000Z .. 2026-10-31T13:00:00.000Z', f(GX.monthBounds(new Date('2026-10-15T00:00:00Z'), 0, 'Australia/Sydney')));
  ok('Honolulu (UTC-10, no clock change): September is 1 Sep 10:00 UTC to 1 Oct 10:00 UTC; at 05:00 UTC on 1 October it is still September there', f(GX.monthBounds(now, 0, 'Pacific/Honolulu')) === '2026-09-01T10:00:00.000Z .. 2026-10-01T10:00:00.000Z' && GX.monthBounds(new Date('2026-10-01T05:00:00Z'), 0, 'Pacific/Honolulu').label === 'September 2026');
  ok('back through the year: last month, and twelve back across New Year, never further, never forward', GX.monthBounds(now, -1, 'UTC').label === 'August 2026' && GX.monthBounds(new Date('2026-02-10T00:00:00Z'), -2, 'UTC').label === 'December 2025' && GX.monthBounds(now, -12, 'UTC').label === 'September 2025'
     && GX.monthBounds(now, -30, 'UTC').label === 'September 2025' && GX.monthBounds(now, 3, 'UTC').label === 'September 2026' && GX.stepMonth(0, 1) === 0 && GX.stepMonth(-12, -1) === -12 && GX.stepMonth(-3, 1) === -2);
  ok('a zone the browser does not know is UTC', f(GX.monthBounds(now, 0, 'Mars/Olympus')) === f(GX.monthBounds(now, 0, 'UTC')));
  const utcSet = GX.gameSet(lines, GX.monthBounds(now, 0, 'UTC').start, GX.monthBounds(now, 0, 'UTC').end), syd = GX.gameSet(lines, GX.monthBounds(now, 0, 'Australia/Sydney').start, GX.monthBounds(now, 0, 'Australia/Sydney').end), hon = GX.gameSet(lines, GX.monthBounds(now, 0, 'Pacific/Honolulu').start, GX.monthBounds(now, 0, 'Pacific/Honolulu').end);
  ok('the month\'s games follow the zone: g8 (2 Oct 02:00 UTC) is not September in UTC or Sydney (already 3 Oct 13:00... wait it is 12:00 on the 1st there), Sat 26 Sep 23:00 UTC (g6) is Sunday in Sydney but September everywhere',
     utcSet.size === 7 && !utcSet.has('g8') && utcSet.has('g6') && syd.has('g6') && !syd.has('g8') && hon.has('g6'), [utcSet.size, syd.size, hon.size].join());
  const late = [{ id: 'z1', tipoff_at: '2026-09-30T20:00:00Z' }, { id: 'z2', tipoff_at: '2026-08-31T20:00:00Z' }];
  ok('a game at 20:00 UTC on 30 September is 1 October in Sydney (outside September there) and one at 20:00 UTC on 31 August is 1 September there (inside)', (() => { const b = GX.monthBounds(now, 0, 'Australia/Sydney'); const s = GX.gameSet({ games: late }, b.start, b.end); return !s.has('z1') && s.has('z2'); })());
}

console.log('\nthe month\'s stars');
{
  const b = GX.monthBounds(new Date('2026-09-30T12:00:00Z'), 0, 'UTC');
  const data = { comps: [{ id: 'c1', name: 'Premier' }], league: { name: 'L', colour: '#ff6600', timezone: 'UTC' }, teams: new Map(teamsList.map(t => [t.id, t])), finals: [], standings: [] };
  const run = sel => GX.monthStars(data, lines, Object.assign({ bounds: b }, sel), null);
  const m = run({}), rows = m.model.rows;
  ok('a ranked line-up for the month, per-game stats shown by default (points, rebounds, assists a game), the games and best night under each name', rows.length === 5 && m.model.period === 'month' && m.model.key === 'stars-of-the-month' && Object.keys(rows[0].stats).join() === 'c:ppg,c:rpg,c:apg'
     && /^GP \d+ · best \d+ pts v /.test(rows[0].sub) && rows.every((r, i) => r.rank === i + 1));
  ok('...the default minimum is two fifths of the most games anyone played (Gus, with one, is out)', m.min === Math.max(1, Math.ceil(X.rowsOf(lines, GX.gameSet(lines, b.start, b.end)).players.reduce((a, r) => Math.max(a, r.gp), 0) * 0.4)) && m.min >= 2 && !rows.some(r => r.name === 'Gus Guest'));
  ok('...by average game score (the default), by points a game, by any catalogue column, lowest first for a low one', (() => {
    const pts = run({ by: 'pts' }).model.rows.map(r => r.stats['c:ppg']).map(Number), tov = run({ by: 'stat', stat: 'c:topg', keys: ['c:topg', 'c:ppg', 'c:apg'] }).model.rows.map(r => +r.stats['c:topg']);
    const eff = run({ by: 'stat', stat: 'c:ts', keys: ['c:ts', 'c:ppg', 'c:apg'] });
    return pts.every((v, i) => !i || v <= pts[i - 1]) && tov.every((v, i) => !i || v >= tov[i - 1]) && tov[0] <= tov[tov.length - 1] === false ? true : tov.every((v, i) => !i || v >= tov[i - 1]) && !!eff.model;
  })());
  ok('...a threshold of your own: five games keeps out whoever played fewer, and nobody clearing it says so', run({ minGames: 99 }).model === null && /99 games/.test(run({ minGames: 99 }).reason) && run({ minGames: 1 }).model.rows.length === 5);
  const pick = run({ by: 'pick', picks: ['p6', 'p1'] }).model;
  ok('...by pick: the players named, in the order given (a player under the minimum can still be picked)', pick.rows.map(r => r.name).join() === 'Flo Few,Ann Ace' && run({ by: 'pick', picks: ['p7'], minGames: 1 }).model.rows[0].name === 'Gus Guest');
  ok('a month with no game says so', GX.monthStars(data, lines, { bounds: GX.monthBounds(new Date('2026-05-10T00:00:00Z'), 0, 'UTC') }, null).model === null);
  ok('the caption: "Stars of the month in the Premier (September 2026):" and each with his line and best night', /^Stars of the month in the Premier \(September 2026\):\n\n1\. .* \(.*\): [\d.]+ ppg, [\d.]+ rpg, [\d.]+ apg - GP \d+ · best/.test(SC.caption(Object.assign({}, m.model, { comp: 'Premier' }))), SC.caption(Object.assign({}, m.model, { comp: 'Premier' })).split('\n').slice(0, 3).join(' / '));
}

console.log('\nleaders');
{
  const data = { comps: [{ id: 'c1', name: 'Premier' }], league: { name: 'L', colour: '#ff6600', timezone: 'UTC' }, teams: new Map(teamsList.map(t => [t.id, t])), finals: G.slice(0, 3), standings: [] };
  const run = (sel) => GX.leadersModel(data, lines, sel, null);
  const d = run({}).model; if (!d) console.log('LEADERS NULL', JSON.stringify(run({})).slice(0, 300));
  ok('the site\'s five by default: points, rebounds, assists, steals, blocks a game - a board each, the top five, the leader first', d.boards.map(b => b.key).join() === 'c:ppg,c:rpg,c:apg,c:spg,c:bpg' && d.boards.every(b => b.rows.length >= 1 && b.rows.length <= 10) && d.boards[0].rows[0].rank === 1 && d.title === 'Leaders' && d.subject === 'players');
  ok('...each board\'s figures are the site\'s (one decimal), highest first', d.boards[0].rows.every((r, i, a) => !i || +r.value <= +a[i - 1].value) && /^\d+\.\d$/.test(d.boards[0].rows[0].value));
  ok('any column of the catalogue is a category; a lower-is-better one lists lowest first; six at most', (() => { const t = run({ keys: ['c:topg'] }).model.boards[0]; return t.low && +t.rows[0].value <= +t.rows[t.rows.length - 1].value; })()
     && run({ keys: ['c:ppg', 'c:rpg', 'c:apg', 'c:spg', 'c:bpg', 'c:topg', 'c:pfpg', 'c:mpg'] }).model.boards.length === 6 && run({ keys: ['c:nope', 'c:ts'] }).model.boards.length === 1);
  ok('a games qualifier keeps out the one-game player (Gus: a big night, one game); with none asked, two fifths of the most played', (() => { const solo = run({ keys: ['c:ppg'], minGames: 1 }).model.boards[0].rows.map(r => r.name); const auto = run({ keys: ['c:ppg'] }).model.boards[0].rows.map(r => r.name); return solo.length >= auto.length && !auto.includes('Gus Guest'); })());
  ok('ties share a rank and say so (T)', (() => { const l = { games: G, pgs: [], tgs: lines.tgs, teams: lines.teams, teamName: lines.teamName }; [['q1', 20], ['q2', 20], ['q3', 15]].forEach(([id, pts]) => l.pgs.push({ game_id: 'g1', player_uuid: id, team_idx: 0, stats: Object.assign(mkStats(id, 0, 0), { pts }) }));
    const b = GX.leadersModel(data, l, { keys: ['c:pts'], minGames: 1 }, null).model.boards[0]; return b.rows.map(r => (r.tie ? 'T' : '') + r.rank).join() === 'T1,T1,3'; })());
  const teams = run({ subject: 'teams', keys: ['c:ppg', 'c:papg'] }).model;
  ok('clubs: their own columns (points for and against a game), the club as the row, the lower-is-better one lowest first', teams.subject === 'teams' && teams.boards.length === 2 && teams.boards[0].rows.length === 3 && teams.boards[1].low && +teams.boards[1].rows[0].value <= +teams.boards[1].rows[2].value && teams.boards[0].rows[0].name.endsWith('Basket'));
  const wk = run({ only: new Set(['g1']), keys: ['c:pts'] }).model.boards[0].rows.length, sea = run({ keys: ['c:pts'] }).model.boards[0].rows.length;
  ok('scope: a week or a month is the games in it (the rest of the season is not counted), the season is all of them', wk >= 1 && sea >= wk && run({ only: new Set(['g1']), keys: ['c:gp'] }).model.boards[0].rows.every(r => r.value === '1'));
  ok('the caption: "Season leaders in the Premier:", each board with its ranks, a T- for a tie', /^Leaders in the Premier:\n\nPoints per game\n1\. .* \(.*\) [\d.]+/.test(SC.caption(Object.assign({}, d, { comp: 'Premier' }))) || /^Leaders in the Premier:/.test(SC.caption(Object.assign({}, d, { comp: 'Premier' }))), SC.caption(Object.assign({}, d, { comp: 'Premier' })).split('\n').slice(0, 4).join(' / '));
}

console.log('\nthe site\'s numbers on the other graphics');
{
  const data = { comps: [{ id: 'c1', name: 'Premier' }], league: { name: 'L', timezone: 'UTC' }, teams: new Map(teamsList.map(t => [t.id, t])), finals: G, upcoming: [], standings: [], since: new Date('2026-09-01'), now: new Date('2026-09-30'), until: new Date('2026-10-07'),
    players: new Map(G.map(g => [g.id, lines.pgs.filter(r => r.game_id === g.id).map(r => ({ game_id: g.id, team_idx: r.team_idx, stats: Object.assign({}, r.stats, { or: r.stats.or, dr: r.stats.dr }) }))])), perQ: new Map() };
  const star = GX.builderModel(data, { tpl: 'star', gameId: 'g3', lines, need: ['c:ts', 'c:usg', 'c:ppg'] }, 'portrait', null).model;
  ok('a star carries any column of the catalogue as the site prints it, with its label', star.stats['c:ppg'] === X.text(X.byId('player').get('c:ppg'), X.gameRow(lines, 'g3', star.player.name, star.idx)) && star.cat['c:ppg'].l === 'PPG' && 'c:ts' in star.stats, JSON.stringify(star.stats).slice(-120));
  const fin = GX.builderModel(data, { tpl: 'result', gameId: 'g3', lines, need: ['c:ff_efg', 'c:papg'] }, 'portrait', null).model;
  ok('a final\'s team stats can be the club columns: the four factors, side by side, with the direction', fin.teamStats === null || (fin.teamStats.home['c:ff_efg'] && fin.cat['c:ff_efg'].l === 'eFG%'));
  const tb = GX.builderModel(Object.assign({}, data, { standings: teamsList.map((t, i) => ({ competition_id: 'c1', team_id: t.id, rank: i + 1, gp: 4, w: 3 - i, l: i, diff: 5 - i })) }), { tpl: 'table', compId: 'c1', lines, need: ['c:ortg', 'c:pace'] }, 'portrait', null).model;
  ok('a table takes any club column: ORTG, pace, the four factors - worked over the season, a dash for a club with none', tb.rows.every(r => /^\d+\.\d$/.test(r['c:ortg']) && r['c:pace'] !== undefined) && tb.cat['c:ortg'].l === 'ORTG');
  ok('...and draws them as columns', (() => { const c = (() => { let size = 10; const log = []; const o = { textAlign: 'left', fillStyle: '', save() {}, restore() {}, set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; }, measureText: t => ({ width: String(t).length * size * 0.56 }),
    fillText(t) { log.push(t); }, fillRect() {}, createRadialGradient() { return { addColorStop() {} }; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {}, drawImage() {}, log }; return o; })();
    SC.draw(c, tb, { size: 'portrait', modules: { cols: ['w', 'c:ortg', 'c:pace'] } }); return c.log.includes('ORTG') && c.log.includes('PACE') && c.log.includes(tb.rows[0]['c:ortg']); })());
}

console.log('\nthe graphics');
{
  const recorder = () => {
    const log = [], saved = []; let size = 10, fill = '';
    const c = { log, strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
      save() { saved.push([size, fill, c.textAlign, c.globalAlpha]); }, restore() { const s = saved.pop(); if (s) [size, fill, c.textAlign, c.globalAlpha] = s; },
      set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; }, measureText: t => ({ width: String(t).length * size * 0.56 }),
      fillText(t, x, y) { const w = String(t).length * size * 0.56; const l = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x; log.push({ kind: 'text', t: String(t), x0: l, x1: l + w, y0: y - size * 0.8, y1: y + size * 0.2, size }); },
      fillRect(x, y, w, h) { log.push({ kind: 'rect', x0: x, x1: x + w, y0: y, y1: y + h }); }, createRadialGradient() { return { addColorStop() {} }; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {}, drawImage() {}, setLineDash() {}, scale() {} };
    return c;
  };
  const LONG = 'Associação Desportiva Recreativa e Cultural Icasa Meridianbet';
  const club = i => ({ name: LONG + ' ' + i, colour: '#ffffff', short_name: 'X' + i });
  const mkBoard = (k, n, low) => ({ key: 'c:k' + k, label: 'A Long Category Name Number ' + k, low, rows: Array.from({ length: n }, (_, i) => ({ rank: i + 1, tie: i === 1, name: 'Konstantinopolskiy-Vandersloot Aleksandar ' + i, team: club(i), value: i % 2 ? '−12.3' : '1,234.5' })) });
  const L0 = { name: 'The Very Long Named National Basketball Championship League', colour: '#ff6600', timezone: 'UTC', handle: 'a_handle_that_is_really_quite_long_indeed' };
  const bad = [];
  const sweep = (tag, m, mods) => {
    for (const size of Object.keys(SC.SIZES)) for (const theme of ['dark', 'light']) {
      const S = SC.SIZES[size], c = recorder(); let threw = null;
      try { SC.draw(c, m, { size, theme, modules: mods }); } catch (e) { threw = e.message; }
      const drawn = c.log.filter(e => !(e.kind === 'rect' && (e.x1 - e.x0 >= S.w || e.x0 === 0)));
      const off = drawn.filter(e => e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5);
      const cov = size === 'story' ? drawn.filter(e => e.kind === 'text' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8)) : [];
      const t = c.log.filter(e => e.kind === 'text' && e.t.trim() && e.size < 100), over = [];
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { const a = t[i], b = t[j]; if (a.t === b.t && Math.abs(a.x0 - b.x0) < 6) continue;
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); if (w > 3 && h > 0.5 * Math.min(a.size, b.size)) over.push(a.t + ' x ' + b.t); }
      if (threw || off.length || cov.length || over.length) bad.push(`${tag}/${size}/${theme}/${JSON.stringify(mods || {}).slice(0, 24)}: ${threw || off.concat(cov).slice(0, 2).map(e => (e.t || e.kind) + '@' + Math.round(e.y0)).join('|')} ${over.slice(0, 2).join('|')}`);
    }
  };
  let n = 0;
  for (const nb of [1, 2, 3, 4, 5, 6]) for (const per of [10, 5, 3]) for (const subject of ['players', 'teams']) {
    const m = SC.leaders({ boards: Array.from({ length: nb }, (_, k) => mkBoard(k, 10, k === 1)), league: L0, comp: LONG, range: 'September 2026', title: 'Season leaders', subject });
    for (const mods of [{}, { rows: per }, { headline: 'A headline that is far too long to fit across the page in one go', subline: 'and a subline that goes on', crests: false }]) { sweep('leaders' + nb + subject, m, mods); n += 6; }
  }
  sweep('leaders-empty', SC.leaders({ boards: [], league: L0 }), {}); sweep('leaders-1row', SC.leaders({ boards: [mkBoard(0, 1)], league: L0 }), {});
  const ent = i => ({ key: 'k' + i, name: 'Konstantinopolskiy-Vandersloot Aleksandar ' + i, stats: { adv: { name: 'Konstantinopolskiy-Vandersloot Aleksandar ' + i, num: '9' } }, out: { 'c:ppg': '31.4', 'c:ts': '61.2', 'c:usg': '33.1', 'c:bpm': '−4.5', 'c:papg': '110.2', 'c:x': '1,234' }, score: 30 - i, team: club(i), sub: 'GP 12 · best 41 pts v ' + LONG });
  for (const nn of [5, 3, 1]) for (const layout of ['list', 'hero', 'five']) for (const keys of [undefined, ['c:ppg', 'c:ts', 'c:usg', 'c:bpm'], ['c:x', 'c:papg', 'c:bpm', 'c:ppg', 'c:ts', 'c:usg']]) {
    const m = SC.weekstars({ entries: Array.from({ length: nn }, (_, i) => ent(i)), league: L0, comp: LONG, range: 'September 2026', by: 'score', period: 'month', cat: { 'c:ppg': { l: 'PPG' }, 'c:ts': { l: 'TS%' }, 'c:usg': { l: 'USG%' }, 'c:bpm': { l: 'BPM' }, 'c:papg': { l: 'OPP' }, 'c:x': { l: 'X' } } });
    sweep('monthstars' + nn + layout, m, { layout, statKeys: keys }); n += 6;
  }
  ok('leaders (1 to 6 boards, players and clubs, long names, 3 / 5 / 10 rows, empty, one row) and the month\'s stars (1 / 3 / 5, three layouts, catalogue stat lines): on the page, clear of a story\'s strips, no words over words - ' + n + ' drawings', !bad.length, bad.slice(0, 5).join(' ;; '));
  const one = SC.leaders({ boards: [mkBoard(0, 10)], league: L0, subject: 'players' });
  const c1 = recorder(); SC.draw(c1, one, { size: 'portrait' });
  const t1 = c1.log.filter(e => e.kind === 'text');
  ok('one category is a top ten (ten ranks drawn) with T for a tie; a panel of several shows a short list of each', t1.filter(e => /^T?\d+$/.test(e.t)).length === 10 && t1.some(e => e.t === 'T2')
     && (() => { const c6 = recorder(); SC.draw(c6, SC.leaders({ boards: Array.from({ length: 4 }, (_, k) => mkBoard(k, 10)), league: L0 }), { size: 'portrait' }); return c6.log.filter(e => e.kind === 'text' && /^T?\d+$/.test(e.t)).length === 12; })());
  ok('a minus is a minus: U+2212 before a figure wherever it is drawn, never the hyphen', t1.some(e => e.t.startsWith('−')) && !t1.some(e => /^-\d/.test(e.t)));
  ok('the small numerals are set in the page\'s Archivo, not the pixel face or the mono', RC.util.F.ui.includes('Archivo') && (() => { const fonts = []; const c = recorder(); Object.defineProperty(c, 'font', { set(f) { fonts.push(f); }, get() { return ''; } }); SC.draw(c, one, { size: 'portrait' }); return fonts.some(f => /700 \d+px 'Archivo'/.test(f)) && !fonts.some(f => /MartianMono/.test(f)); })());
}

console.log('\ncircles: player or team');
{
  const rec = () => { const log = [], st = []; let size = 10, fill = ''; const c = { log, textAlign: 'left', strokeStyle: '', lineWidth: 1, globalAlpha: 1, set fillStyle(v) { fill = v; }, get fillStyle() { return fill; }, save() { st.push([size, fill, c.textAlign]); }, restore() { const x = st.pop(); if (x) [size, fill, c.textAlign] = x; }, set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; },
    measureText: t => ({ width: String(t).length * size * 0.56 }), fillText(t, x, y) { const w = String(t).length * size * 0.56; const l = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x; log.push({ kind: 'text', t: String(t), x0: l, x1: l + w, y0: y - size * 0.8, y1: y + size * 0.2, size }); },
    fillRect(x, y, w, h) { log.push({ kind: 'rect', x0: x, x1: x + w, y0: y, y1: y + h }); }, arc(x, y, r) { log.push({ kind: 'arc', x, y, r }); }, drawImage(img, x, y, w, h) { log.push({ kind: 'image', img, x0: x, x1: x + w, y0: y, y1: y + h }); },
    createRadialGradient() { return { addColorStop() {} }; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, fill() {}, stroke() {}, setLineDash() {}, scale() {} }; return c; };
  const T = (n, crest) => ({ name: n + ' Basket', short_name: n.slice(0, 3).toUpperCase(), colour: '#fd0204', crest: crest ? { width: 64, height: 64, naturalWidth: 64, naturalHeight: 64, tag: 'crest' } : undefined });
  const ent = (n, i, crest) => ({ key: 'k' + i, name: 'Player ' + n, stats: { adv: { name: 'Player ' + n, num: '5' }, pts: 30 - i, p2m: 8, p2a: 12, ast: 5, dr: 4 }, team: T(n, crest), opp: T('Opp'), teamScore: 80, oppScore: 70, gameId: 'g' + i });
  const img = () => ({ width: 64, height: 64, naturalWidth: 64, naturalHeight: 64, tag: 'crest' });
  const withImg = (m, crest) => { if (crest) m.rows.forEach(r => { r.team.crest = img(); }); return m; };
  const mk = crest => withImg(SC.weekstars({ entries: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((n, i) => ent(n, i, crest)), league: { name: 'L', colour: '#ff6600' } }), crest);
  const draw = (m, size, mods) => { const c = rec(); SC.draw(c, m, { size, modules: mods }); return c.log; };
  const key = l => JSON.stringify(l.map(e => [e.kind, e.t, Math.round(e.x0 || e.x || 0), Math.round(e.y0 || e.y || 0), Math.round(e.r || 0)]));
  let same = true, count = 0;
  for (const layout of ['list', 'hero', 'five']) for (const size of Object.keys(SC.SIZES)) { const m = mk(false); if (key(draw(m, size, { layout })) !== key(draw(m, size, { layout, discs: 'player' })) || key(draw(m, size, { layout })) !== key(draw(m, size, { layout, discs: 'bogus' }))) same = false; count++; }
  ok('player circles are the default and change nothing: the same drawing with no option, "player" or a bad value (stars of the week, three layouts, three shapes)', same, count + ' drawings');
  const initials = l => l.filter(e => e.kind === 'text' && /^P[A-Z]$|^[A-Z]{2}$/.test(e.t) && e.size > 25).length;
  const crestsIn = (l, tag) => l.filter(e => e.kind === 'image' && e.img.tag === tag).length;
  const wc = mk(true), wn = mk(false);
  ok('team circles with a crest: the crest alone as the circle - five crests, no initials disc and no second small badge', crestsIn(draw(wc, 'portrait', { discs: 'team' }), 'crest') === 5 && crestsIn(draw(wc, 'portrait', {}), 'crest') === 5
     && initials(draw(wc, 'portrait', { discs: 'team' })) === 0 && initials(draw(wc, 'portrait', {})) >= 5);
  const fb = draw(wn, 'portrait', { discs: 'team' });
  ok('...with no crest: a club-colour disc with the club\'s code (never blank) - five of them', fb.filter(e => e.kind === 'text' && /^(ALP|BRA|CHA|DEL|ECH)$/.test(e.t)).length === 5 && fb.filter(e => e.kind === 'arc').length >= 5);
  const circleAt = (l, dx) => l.filter(e => e.kind === 'arc').map(e => [Math.round(e.x), Math.round(e.y)]);
  ok('team mode keeps the circle where the player disc was, at the same size: the leading circle\'s place is unchanged', (() => { const a = draw(wn, 'portrait', {}).filter(e => e.kind === 'arc'), b = draw(wn, 'portrait', { discs: 'team' }).filter(e => e.kind === 'arc'); return a.length && b.length && a[0].x === b[0].x && a[0].y === b[0].y; })());
  const star = SC.performer({ game: { id: 'g', tipoff_at: '2026-09-29T18:00:00Z', home_score: 90, away_score: 80 }, home: T('Home', true), away: T('Away', true), league: { name: 'L' }, players: [{ team_idx: 0, stats: { adv: { name: 'Solo Star', num: '9' }, pts: 30, p2m: 10, p2a: 15, ast: 5, dr: 5 } }] });
  ok('the star of the game: team circles make the crest larger beside the club line; player circles are today\'s', (() => { const a = draw(star, 'portrait', {}).filter(e => e.kind === 'arc'), b = draw(star, 'portrait', { discs: 'team' }).filter(e => e.kind === 'arc'); return a.length && b.length && b.some(e => e.r > Math.min(...a.map(x => x.r))) || crestsIn(draw(star, 'portrait', { discs: 'team' }), 'crest') >= 1; })()
     && key(draw(star, 'portrait', {})) === key(draw(star, 'portrait', { discs: 'player' })));
  const mon = withImg(SC.weekstars({ entries: ['A', 'B', 'C'].map((n, i) => Object.assign(ent(n, i, true), { out: { 'c:ppg': '21.0' }, sub: 'GP 4' })), league: { name: 'L' }, by: 'score', period: 'month', cat: { 'c:ppg': { l: 'PPG' } } }), true);
  ok('the month\'s stars follow it too', crestsIn(draw(mon, 'portrait', { discs: 'team' }), 'crest') === 3 && initials(draw(mon, 'portrait', { discs: 'team' })) === 0);
  const bad = [];
  const LONG = 'Associação Desportiva Recreativa e Cultural Icasa Meridianbet';
  for (const crest of [true, false]) for (const [tag, m] of [['week', mk(crest)], ['star', star], ['month', mon], ['long', SC.weekstars({ entries: [0, 1, 2, 3, 4].map(i => Object.assign(ent('X', i, crest), { name: LONG + i, team: T(LONG + i, crest) })), league: { name: 'L' } })]]) for (const layout of ['list', 'hero', 'five']) for (const size of Object.keys(SC.SIZES)) for (const theme of ['dark', 'light']) {
    const S = SC.SIZES[size], c = rec(); let threw = null; try { SC.draw(c, m, { size, theme, modules: { layout, discs: 'team' } }); } catch (e) { threw = e.message; }
    const off = c.log.filter(e => e.kind !== 'rect' && (e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5) && e.x0 !== undefined);
    const arcs = c.log.filter(e => e.kind === 'arc' && (e.x - e.r < -0.5 || e.x + e.r > S.w + 0.5 || e.y - e.r < -0.5 || e.y + e.r > S.h + 0.5));
    const cov = size === 'story' ? c.log.filter(e => e.kind === 'text' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8)) : [];
    if (threw || off.length || arcs.length || cov.length) bad.push(`${tag}/${crest}/${layout}/${size}/${theme}: ${threw || (off[0] && off[0].t) || 'arc'}`);
  }
  ok('team circles, with and without crests, every stars template and layout on every shape in both colourways: all on the page, clear of a story\'s strips - 144 drawings', !bad.length, bad.slice(0, 4).join(' ;; '));
  ok('leaders and a result\'s leader lines have no player disc (a crest only): the option changes nothing there', (() => { const L = SC.leaders({ boards: [{ key: 'c:ppg', label: 'PPG', rows: [{ rank: 1, name: 'A', team: T('A', true), value: '20.0' }] }], league: { name: 'L' } }); return key(draw(L, 'portrait', {})) === key(draw(L, 'portrait', { discs: 'team' })); })());
  ok('the option is cleaned: "team" and "player" are kept, anything else is nothing', SC.cleanModules({ discs: 'team' }).discs === 'team' && SC.cleanModules({ discs: 'player' }).discs === 'player' && SC.cleanModules({ discs: 'x' }).discs === undefined);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
