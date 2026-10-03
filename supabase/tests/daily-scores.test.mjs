/* ============================================================================
   THE DAILY SCORES GRAPHIC, AND THE NIGHT'S PICKS (epinoia/socialcard.js, admin/socialgfx-ui.js, admin/graphics-ui.js), with no browser.

     node supabase/tests/daily-scores.test.mjs

   What is held here:
     * THE DAY: every final of one game day (the league's own calendar day, not the browser's), oldest first, each with its
       score and each side's leader; a busy day cut into even pages; the tip-off times in the clock chosen while the day stays the
       league's; the words to post it with;
     * ITS DRAWING on every shape: all of it on the page, none of it where a story is covered, a three-figure score never
       touching a club's name; leaders drawn when the rows are tall enough and said to be left out when they are not;
     * ITS READING: the days a league played on (one narrow read), one day read on its own (its window is the league's midnight to
       midnight), the weekly list's daily graphics for the days the window holds whole, and the builder's subject;
     * THE NIGHT'S PICKS are ranked by BPM and nothing else: a player of the game, a side's leader and the stars of the week must
       have played eighteen minutes (waived where nobody on a side did), and BPM is printed on each of them;
     * THE PLAYER OF THE GAME'S STRIP, left to right under points, rebounds and assists: BPM, USG%, TS%, STOCKS%, ON-OFF NET,
       ON-OFF ORTG, ON-OFF DRTG - the site's own numbers for the night (season.js), a number the game cannot give left out.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' && extra != null ? '  -> ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 700) : ''}`);
};

const sandbox = { console, module: undefined, setTimeout, clearTimeout, Intl, TextEncoder };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/bpm.js', 'epinoia/reportcard.js', 'epinoia/season.js', 'epinoia/socialcard.js', 'epinoia/admin/socialgfx-ui.js', 'epinoia/admin/graphics-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const SC = sandbox.EpinoiaSocialCard, GX = sandbox.EpinoiaSocialGfx, UI = sandbox.EpinoiaGraphicsUI, SE = sandbox.EpinoiaSeason;

/* a 2D context that records where every word and shape lands */
function recorder() {
  const log = [], saved = [];
  let size = 10, fill = '';
  const c = {
    log, strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1,
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
    save() { saved.push([size, fill, c.textAlign, c.globalAlpha]); },
    restore() { const s = saved.pop(); if (s) { [size, fill, c.textAlign, c.globalAlpha] = s; } },
    set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; },
    measureText(t) { return { width: String(t).length * size * 0.56 }; },
    fillText(t, x, y) {
      const w = String(t).length * size * 0.56;
      const left = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x;
      log.push({ kind: 'text', t: String(t), x0: left, x1: left + w, y0: y - size * 0.8, y1: y + size * 0.2, size });
    },
    fillRect(x, y, w, h) { log.push({ kind: 'rect', x0: x, x1: x + w, y0: y, y1: y + h, fill }); },
    createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {},
    setLineDash() {}, scale() {}, drawImage() {}
  };
  return c;
}
const draw = (m, size, modules) => { const c = recorder(); const out = SC.draw(c, m, { size, modules: modules || {} }); return { log: c.log, words: c.log.filter(e => e.kind === 'text'), out }; };

const league = { name: 'LNB Pro A', slug: 'lnb', colour: '#ff6600', colour2: '#1e3a8a', timezone: 'Europe/Paris', handle: 'lnb' };
const T = Array.from({ length: 14 }, (_, i) => ({ name: ['Paris', 'Lyon', 'Nancy', 'Dijon', 'Pau', 'Nantes', 'Rouen', 'Bourg', 'Limoges', 'Chalon', 'Monaco', 'Cholet', 'Roanne', 'Le Mans'][i] + ' Basket', short_name: 'T' + i, colour: ['#fd0204', '#004d98', '#ffd100'][i % 3] }));
const MIN = 60000;

/* ---------------------------------------------------------------- the night's picks --- */
console.log('\nthe night\'s picks: BPM and nothing else, from eighteen minutes');
const mate = { pts: 8, p2m: 3, p2a: 6, p3m: 0, p3a: 2, fta: 2, ftm: 2, or: 1, dr: 3, ast: 2, stl: 1, to: 1, pf: 2, min: 25 * MIN };
const line = (idx, name, s) => ({ team_idx: idx, stats: Object.assign({ adv: { name, num: '7' } }, s) });
/* the home side wins: a bench player who did a great deal in eight minutes, a starter who did well in thirty, three ordinary teammates;
   the visitors are ordinary with one good night in twenty-four minutes */
const sprint = { pts: 12, p2m: 6, p2a: 6, p3m: 0, p3a: 0, fta: 0, ftm: 0, or: 3, dr: 3, ast: 3, stl: 3, blk: 2, to: 0, pf: 0, min: 8 * MIN };
const starter = { pts: 22, p2m: 8, p2a: 12, p3m: 2, p3a: 5, fta: 4, ftm: 4, or: 2, dr: 7, ast: 6, stl: 2, blk: 1, to: 2, pf: 2, min: 30 * MIN };
const good = { pts: 20, p2m: 7, p2a: 11, p3m: 1, p3a: 3, fta: 3, ftm: 3, or: 1, dr: 5, ast: 4, stl: 2, blk: 0, to: 2, pf: 2, min: 24 * MIN };
const pl = [line(0, 'Sam Sprint', sprint), line(0, 'Stan Starter', starter), ...['Ann', 'Bo', 'Cy'].map(n => line(0, n + ' Mate', mate)),
  line(1, 'Gus Good', good), ...['Di', 'Ed', 'Flo', 'Gil'].map(n => line(1, n + ' Mate', mate))];
const bp = SC.gameBPMs(pl);
const best = rows => rows.slice().sort((a, b) => bp.get(b) - bp.get(a))[0];
ok('the set-up: the eight-minute player has the best BPM of his side (the trap a minimum is for)', best(pl.slice(0, 5)) === pl[0] && bp.get(pl[0]) > bp.get(pl[1]), [...bp.values()].map(v => v.toFixed(1)).join());
const g1 = { id: 'g1', tipoff_at: '2026-10-02T17:30:00Z', venue: 'Hall A', home_score: 84, away_score: 79 };
const potg = SC.performer({ game: g1, home: T[0], away: T[1], players: pl, league });
ok('the player of the game is not a player of eight minutes, however good his BPM: the best of those who played eighteen', potg.player.name === 'Stan Starter' && potg.stats.min >= 18, potg.player.name + ' ' + potg.stats.min);
ok('...and his BPM is the one printed, the best of the eligible', potg.bpm === Math.round(bp.get(pl[1]) * 10) / 10 && potg.stats.bpm === SC.bpmText(bp.get(pl[1])));
const res = SC.result({ game: g1, home: T[0], away: T[1], players: pl, league });
ok('a side\'s leader is picked the same way, and says the BPM he was picked on', res.top.home.name === 'Stan Starter' && /^22 PTS · 9 REB · 6 AST · [+-]\d+\.\d BPM$/.test(res.top.home.line) && res.top.home.line.endsWith(SC.bpmText(bp.get(pl[1])) + ' BPM'), res.top.home.line);
const slow = pl.map(p => ({ team_idx: p.team_idx, stats: Object.assign({}, p.stats, { min: Math.min(p.stats.min, 15 * MIN) }) }));
const bpSlow = SC.gameBPMs(slow);
const potgSlow = SC.performer({ game: g1, home: T[0], away: T[1], players: slow, league });
ok('where nobody on the winning side played eighteen minutes the minimum is waived: the best BPM of them, never nobody', potgSlow && slow.slice(0, 5).every(p => p.stats.min < 18 * MIN)
   && potgSlow.stats.bpm === SC.bpmText(Math.max(...slow.slice(0, 5).map(p => bpSlow.get(p)))), potgSlow && potgSlow.player.name);
ok('a line that carries no minutes is not judged by them (a month\'s)', SC.played({ pts: 3 }) === true && SC.played({ min: 17 * MIN }) === false && SC.played({ min: 18 * MIN }) === true && SC.NIGHT_MIN_MS === 18 * MIN);
const noBpm = SC.performer({ game: g1, home: T[0], away: T[1], players: pl.slice(0, 5), league });
ok('...with one side\'s lines only there is no BPM to rank by: the points lead, and no BPM is claimed', noBpm.bpm === null && noBpm.player.name === 'Stan Starter' && noBpm.stats.bpm === '—');

const TS = T.slice(0, 3);
const ent = (name, ti, s, bpm, k) => ({ key: 'g' + k + ':0:' + name, stats: Object.assign({ adv: { name, num: '7' } }, s), bpm, team: TS[ti], opp: TS[(ti + 1) % 3], teamScore: 80, oppScore: 70, gameId: 'g' + k });
const E = [ent('Ann Ace', 0, { pts: 30, min: 30 * MIN }, 14.2, 1), ent('Bea Big', 1, { pts: 28, min: 33 * MIN }, 11.5, 2), ent('Sam Sprint', 2, { pts: 12, min: 8 * MIN }, 97.6, 3),
  ent('Cy Cold', 2, { pts: 33, min: 36 * MIN }, -2.1, 4), ent('Di Dime', 0, { pts: 12, min: 28 * MIN }, 9.8, 5), ent('Ed Even', 1, { pts: 20, min: 26 * MIN }, 8.9, 6), ent('Flo Few', 2, { pts: 6, min: 17 * MIN }, 30.0, 7)];
const W = SC.weekstars({ entries: E, league, comp: 'Pro A', range: '26 Sep–3 Oct 2026' });
ok('the stars of the week, ranked by BPM: those under eighteen minutes (+97.6 in eight, +30 in seventeen) are not in the running', W.rows.map(r => r.name).join() === 'Ann Ace,Bea Big,Di Dime,Ed Even,Cy Cold', W.rows.map(r => r.name + ':' + r.bpm).join());
ok('...in BPM order and no other (Cy Cold\'s 33 points are last), and the card says so', W.rows.every((r, i) => !i || r.bpm <= W.rows[i - 1].bpm) && W.rankedBy === 'BPM' && W.by === 'bpm');
ok('...by points they are by points, and say so; by a pick, nobody\'s ranking is claimed', SC.weekstars({ entries: E, league, by: 'pts' }).rankedBy === 'points' && SC.weekstars({ entries: E, league, by: 'pts' }).rows[0].name === 'Cy Cold'
   && SC.weekstars({ entries: E, league, by: 'pick', picks: [E[0].key] }).rankedBy === '');
const noB = E.map(e => Object.assign({}, e, { bpm: null }));
ok('...where no night has a BPM they go by points, and say points', SC.weekstars({ entries: noB, league }).rankedBy === 'points' && SC.weekstars({ entries: noB, league }).rows[0].name === 'Cy Cold');
ok('...a month\'s stars name what they were ranked by (the stat\'s label)', SC.weekstars({ entries: E.map(e => Object.assign({}, e, { score: e.bpm, stats: { adv: e.stats.adv } })), league, by: 'score', period: 'month', rankLabel: 'BPM' }).rankedBy === 'BPM');

console.log('\nBPM is on the cards');
{
  const cap = SC.caption(W);
  ok('the stars of the week: BPM among the stat lines by default, the ranking in the subline and the words', SC.caption(W).includes(', ranked by BPM:') && / bpm vs /.test(cap), cap.split('\n').slice(0, 3).join(' / '));
  const d = draw(W, 'portrait');
  ok('...drawn: "ranked by BPM" under the title, and each star\'s BPM on his line', d.words.some(e => /ranked by BPM/.test(e.t)) && d.words.filter(e => / BPM$/.test(e.t) || /BPM/.test(e.t)).length >= 5, d.words.filter(e => /BPM/.test(e.t)).map(e => e.t).slice(0, 4));
  const f = draw(res, 'portrait');
  ok('a final: each side\'s leader carries his BPM', f.words.filter(e => / BPM$/.test(e.t)).length === 2, f.words.filter(e => /BPM/.test(e.t)).map(e => e.t));
  ok('...and the words say it too', /Stan Starter \(Paris Basket\): 22 pts, 9 reb, 6 ast, [+-]\d+\.\d bpm/.test(SC.caption(res)), SC.caption(res).split('\n').slice(0, 4).join(' / '));
}

console.log('\nthe player of the game\'s strip');
/* a game with its on-court blocks and both clubs' lines, so the site's own engine has what it works from */
const oc = { tFGA: 40, tFGM: 18, t3M: 5, tFTA: 12, tTOV: 7, tOR: 6, tDR: 20, tPTS: 52, oFGA: 38, oFGM: 15, o3M: 4, oFTA: 10, oTOV: 9, oOR: 5, oDR: 22, oPTS: 40 };
const adv = [{ pts: 84, fgm: 31, fga: 66, fg3m: 8, fg3a: 22, ftm: 14, fta: 19, oreb: 9, dreb: 27, ast: 18, stl: 8, blk: 3, tov: 11, minutes: 200 },
  { pts: 79, fgm: 29, fga: 64, fg3m: 7, fg3a: 21, ftm: 14, fta: 17, oreb: 8, dreb: 25, ast: 15, stl: 6, blk: 2, tov: 13, minutes: 200 }];
const withOc = pl.map((p, i) => (i === 1 ? { team_idx: 0, stats: Object.assign({}, p.stats, { oc }) } : p));
const strip = SC.performer({ game: g1, home: T[0], away: T[1], players: withOc, teamAdv: adv, league });
const engine = SE.players(withOc.map((p, i) => ({ game_id: 'g', player_id: 'p' + i, team_idx: p.team_idx, stats: p.stats })), [0, 1].map(i => ({ game_id: 'g', team_idx: i, stats: { adv: adv[i] } }))).find(r => r.id === 'p1');
const f1 = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const sg = v => (v == null ? '—' : (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1));
ok('the numbers are the site\'s own for the night (season.js): usage, true shooting, steals + blocks (STL% + BLK%), on-off net, offence and defence',
   strip.stats.usg === f1(engine.usg) && strip.stats.ts === f1(engine.ts) && strip.stats.stocks === f1(engine.stl_pct + engine.blk_pct) && strip.stats.onnet === sg(engine.diff_net)
   && strip.stats.onortg === sg(engine.diff_ortg) && strip.stats.ondrtg === sg(engine.diff_drtg) && engine.usg != null && engine.diff_net != null, JSON.stringify(strip.stats).slice(0, 400));
const tsa = 12 + 0.44 * 4;
ok('...true shooting is points over twice the shooting possessions, worked by hand', Math.abs(+strip.stats.ts - Math.round(1000 * 22 / (2 * (12 + 5 + 0.44 * 4))) / 10) < 0.15, strip.stats.ts + ' v ' + (100 * 22 / (2 * (17 + 0.44 * 4))).toFixed(1));
const order = ['BPM', 'USG%', 'TS%', 'STOCKS%', 'ON-OFF NET', 'ON-OFF ORTG', 'ON-OFF DRTG'];
for (const size of ['portrait', 'square', 'story']) {
  const d = draw(strip, size), S = SC.SIZES[size];
  const labs = order.map(l => d.words.find(e => e.t === l));
  ok(`${size}: under POINTS, REBOUNDS and ASSISTS, left to right: ${order.join(', ')}`, labs.every(Boolean) && labs.every((e, i) => !i || e.x0 > labs[i - 1].x0) && labs[0].y0 > d.words.find(e => e.t === 'POINTS').y1
     && ['POINTS', 'REBOUNDS', 'ASSISTS'].every(t => d.words.some(e => e.t === t)), labs.map(e => e && e.t + '@' + Math.round(e.x0)).join(' '));
  const off = d.log.filter(e => (e.kind === 'text') && (e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5 || (size === 'story' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8))));
  ok(`${size}: all of it on the page (the seven labels fit their cells)`, !off.length && labs.every(e => e && e.size >= 9), off.map(e => e.t));
}
const values = draw(strip, 'portrait').words.map(e => e.t);
ok('...each with its figure: the BPM he was picked on first, then the five others', [strip.stats.bpm, strip.stats.usg, strip.stats.ts, strip.stats.stocks, strip.stats.onnet, strip.stats.onortg, strip.stats.ondrtg]
   .every(v => values.includes(v.replace(/^-(?=[\d.])/, '−'))), values.slice(0, 40));
const bare = SC.performer({ game: g1, home: T[0], away: T[1], players: pl, league });
const bd = draw(bare, 'portrait');
ok('a game with no on-court record or club lines: the cells it cannot fill are left out, not dashed', bd.words.some(e => e.t === 'BPM') && bd.words.some(e => e.t === 'TS%') && !bd.words.some(e => e.t === 'ON-OFF NET')
   && !bd.words.some(e => e.t === 'USG%') && !bd.words.some(e => e.t === '—'), bd.words.map(e => e.t).filter(t => /%|ON-OFF|BPM/.test(t)));
ok('chosen stat lines still win: the first three big, the rest in the strip (ten at most)', (() => {
  const d = draw(strip, 'portrait', { statKeys: ['pts', 'reb', 'ast', 'usg', 'ts'] });
  return d.words.some(e => e.t === 'USG%') && d.words.some(e => e.t === 'TS%') && !d.words.some(e => e.t === 'BPM');
})() && SC.cleanModules({ statKeys: ['pts', 'reb', 'ast', 'bpm', 'usg', 'ts', 'stocks', 'onnet', 'onortg', 'ondrtg', 'fg'] }).statKeys.length === 10);
ok('the builder\'s own stat list knows them, its default is the strip, and the stars of the week do not offer what they have no line of', UI.STAT_DEFAULT.join() === 'pts,reb,ast,bpm,usg,ts,stocks,onnet,onortg,ondrtg'
   && ['usg', 'ts', 'stocks', 'onnet', 'onortg', 'ondrtg'].every(k => UI.STAT_ORDER.includes(k) && SC.STAT_DEFS[k]) && UI.WEEK_DEFAULT.join() === 'pts,reb,ast,bpm' && UI.MONTH_DEFAULT.includes('c:bpm') && UI.LEAD_ORDER.includes('bpm'));

/* ------------------------------------------------------------------ the day, model --- */
console.log('\nthe day\'s scores');
const mk = (id, iso, h, a, hs, as, extra) => Object.assign({ id, tipoff_at: iso, venue: 'Hall ' + id, home: T[h], away: T[a], home_score: hs, away_score: as }, extra || {});
const players2 = idx => pl.map(p => ({ team_idx: p.team_idx, stats: p.stats }));
const day3 = [mk('g3', '2026-10-02T19:30:00Z', 4, 5, 101, 90, { players: players2() }), mk('g1', '2026-10-02T16:00:00Z', 0, 1, 84, 79, { players: players2(), perQ: [{ 1: 20, 2: 22, 3: 21, 4: 21 }, { 1: 18, 2: 20, 3: 19, 4: 22 }] }),
  mk('g2', '2026-10-02T18:00:00Z', 2, 3, 70, 75, { players: [] })];
const dm = SC.day({ games: day3, league, comp: 'LNB Pro A', date: 'Fri 2 Oct 2026', dayKey: '2026-10-02' }, 'portrait');
ok('a day: one graphic, its games oldest first, each with its score and its tip-off in the league\'s zone (16:00Z is 18:00 in Paris)', dm.length === 1 && dm[0].kind === 'day'
   && dm[0].rows.map(r => r.gameId).join() === 'g1,g2,g3' && dm[0].rows[0].time === '18:00' && dm[0].rows[2].time === '21:30' && dm[0].rows[0].home.score === 84 && dm[0].rows[0].quarters === '20-18  22-20  21-19  21-22', dm[0].rows.map(r => r.time).join());
ok('...named for the day (the file), saying the day (the heading), and the tag SCORES', dm[0].key === 'scores-2026-10-02' && SC.filename(dm[0], 'story') === 'lnb-scores-2026-10-02-story.png' && dm[0].date === 'Fri 2 Oct 2026');
ok('...each side\'s leader the night\'s best BPM from eighteen minutes, a game with no player lines has none', dm[0].rows[0].top.home.name === 'Stan Starter' && dm[0].rows[0].top.away.name === 'Gus Good' && dm[0].rows[1].top.home === null && dm[0].rows[1].top.away === null);
const busy = Array.from({ length: 12 }, (_, i) => mk('b' + i, '2026-10-02T' + String(10 + i).padStart(2, '0') + ':00:00Z', i % 14, (i + 5) % 14, 80 + i, 78));
ok('a busy day is cut into even pages, as many as the shape holds a page of: twelve games are 6 and 6 on a portrait, 12 on none of the others', SC.day({ games: busy, league }, 'portrait').map(m => m.rows.length).join() === '6,6'
   && SC.day({ games: busy, league }, 'square').map(m => m.rows.length).join() === '6,6' && SC.day({ games: busy, league }, 'story').map(m => m.rows.length).join() === '6,6');
ok('...each page numbered, its file too', (() => { const p = SC.day({ games: busy, league, dayKey: '2026-10-02' }, 'portrait'); return p[1].page === 2 && p[1].pages === 2 && p[1].key === 'scores-2026-10-02-2'; })());
ok('no game: one empty page that says so', SC.day({ games: [], league }, 'portrait').length === 1 && draw(SC.day({ games: [], league }, 'portrait')[0], 'portrait').words.some(e => e.t === 'No finished games on this day.'));

console.log('\nthe day\'s clock');
{
  const m = dm[0];
  const paris = draw(m, 'portrait', { rowExtras: ['time'] }).words.map(e => e.t).join('|');
  const tokyo = draw(m, 'portrait', { rowExtras: ['time'], zone: 'Asia/Tokyo' }).words.map(e => e.t).join('|');
  ok('the tip-off times move with the clock chosen (16:00Z: 18:00 in Paris, 01:00 the next morning in Tokyo)', /18:00/.test(paris) && /01:00/.test(tokyo) && !/18:00/.test(tokyo));
  ok('...and the game day stays the league\'s: the heading still says Fri 2 Oct 2026', /FRI 2 OCT 2026/.test(draw(m, 'portrait', { zone: 'Asia/Tokyo' }).words.map(e => e.t).join('|')));
  ok('...the zone is named when times are shown in another one, and not when they are not shown', /times in UTC\+9/.test(draw(m, 'portrait', { rowExtras: ['time'], zone: 'Asia/Tokyo' }).words.map(e => e.t).join('|'))
     && !/times in/.test(draw(m, 'portrait', { zone: 'Asia/Tokyo' }).words.map(e => e.t).join('|')));
}

console.log('\nthe day, drawn');
for (const size of ['square', 'portrait', 'story']) {
  const S = SC.SIZES[size];
  for (const n of [1, 3, 5, 9, 12]) {
    const games = Array.from({ length: n }, (_, i) => mk('d' + i, '2026-10-02T' + String(10 + i).padStart(2, '0') + ':00:00Z', i % 14, (i + 7) % 14, 100 + i * 3, 99, { players: players2(), perQ: [{ 1: 20, 2: 22, 3: 21, 4: 21 }, { 1: 18, 2: 20, 3: 19, 4: 22 }] }));
    const m = SC.day({ games, league, comp: 'LNB Pro A', date: 'Fri 2 Oct 2026', dayKey: '2026-10-02' }, size);
    let threw = null, d = null;
    try { d = draw(m[0], size, { rowExtras: ['time', 'venue', 'quarters'] }); } catch (e) { threw = e.message; }
    const off = d ? d.log.filter(e => (e.kind === 'text' || e.kind === 'rect') && !(e.kind === 'rect' && (e.x1 - e.x0 >= S.w || e.x0 === 0)) && (e.x0 < -0.5 || e.x1 > S.w + 0.5 || e.y0 < -0.5 || e.y1 > S.h + 0.5 || (size === 'story' && e.kind === 'text' && (e.y0 < S.top - 8 || e.y1 > S.h - S.bottom + 8)))) : [];
    ok(`${size}, ${n} game${n === 1 ? '' : 's'} (page 1 holds ${m[0].rows.length}): drawn, all on the page${size === 'story' ? ', none where Instagram covers it' : ''}`, !threw && !off.length, threw || off.slice(0, 3).map(e => (e.t || e.kind) + '@' + Math.round(e.y0)));
    if (d) {
      const names = d.words.filter(e => /Basket$|^T\d+$|^Hall/.test(e.t) === false && /^[A-Z][a-z]+ Basket$/.test(e.t));
      const scoreW = d.words.filter(e => /^\d{2,3}$/.test(e.t) && e.size >= 40);
      const clash = [];
      d.words.filter(e => /^[A-Z][a-z]+( [A-Za-z]+)? (Basket|…)?/.test(e.t) && e.size >= 20 && e.size <= 36 && /Basket/.test(e.t)).forEach(nm => scoreW.forEach(sc => { if (Math.abs(nm.y0 - sc.y0) < 30 && nm.x1 > sc.x0 - 2 && nm.x0 < sc.x1 + 2) clash.push(nm.t + ' v ' + sc.t); }));
      ok(`${size}, ${n}: a club's name never touches a score (three figures from the ninety-ninth)`, !clash.length, clash.slice(0, 3));
      const small = d.words.filter(e => /Basket/.test(e.t) && e.size < 20);
      ok(`${size}, ${n}: names are set at 20px or more, scores at 44px or more`, !small.length && scoreW.every(e => e.size >= 44), small.slice(0, 2).map(e => e.t + e.size));
    }
  }
}
{
  const games = n => Array.from({ length: n }, (_, i) => mk('d' + i, '2026-10-02T' + String(10 + i).padStart(2, '0') + ':00:00Z', i % 14, (i + 7) % 14, 80 + i, 78, { players: players2() }));
  const lead = (m, size, mods) => { const d = draw(m, size, mods); return { names: d.words.filter(e => e.t === 'Stan Starter' || e.t === 'Gus Good').length, bpms: d.words.filter(e => / BPM$/.test(e.t)).length, dropped: d.out.dropped }; };
  const few = SC.day({ games: games(3), league, comp: 'LNB Pro A', date: 'Fri 2 Oct 2026' }, 'portrait')[0], many = SC.day({ games: games(9), league }, 'portrait')[0];
  const a = lead(few, 'portrait'), b = lead(many, 'portrait');
  ok('three games on a portrait: each side\'s leader under its club, with the BPM he was picked on', a.names === 6 && a.bpms === 6 && !a.dropped.length, a);
  ok('nine games: scores only, the rows too short for leaders - and it says what it left out', b.names === 0 && b.bpms === 0 && b.dropped.includes('each side\'s leaders'), b);
  ok('...asked for fewer rows (a module), the room comes back and so do the leaders', lead(many, 'portrait', { rows: 4 }).names === 8);
  ok('...a taller shape has the room for more of them (seven on a story), a shorter one for fewer (four on a square)', lead(SC.day({ games: games(7), league }, 'story')[0], 'story').names === 14
     && lead(SC.day({ games: games(4), league }, 'square')[0], 'square').names === 8 && lead(SC.day({ games: games(5), league }, 'square')[0], 'square').names === 0);
  ok('...the leaders can be turned off (and then nothing is said to be left out), and their stat lines chosen', lead(few, 'portrait', { leaders: false }).names === 0 && !lead(many, 'portrait', { leaders: false }).dropped.length
     && draw(few, 'portrait', { leaderKeys: ['pts', 'stl'] }).words.some(e => /^22 PTS · 2 STL$/.test(e.t)));
  const cap = SC.caption(few), capOff = SC.caption(few, { leaders: false });
  ok('the words: the day and the competition, every game\'s score, each side\'s leader, the league\'s tag; the leaders gone with their module', cap.split('\n')[0] === 'Scores in the LNB Pro A · Fri 2 Oct 2026' && capOff.split('\n').filter(l => /^\S.* \d+–\d+ /.test(l)).length === 3, cap.split('\n')[0]);
  ok('...a game a line, its leaders under it', /Paris Basket 80–78 Bourg Basket\n {2}Stan Starter \(Paris Basket\) 22 pts, 9 reb, 6 ast, [+-]\d+\.\d bpm \| Gus Good \(Bourg Basket\)/.test(cap) && !/Stan Starter/.test(capOff) && /#LNBProA #basketball$/.test(cap), cap.split('\n').slice(0, 5).join(' / '));
  ok('...a page of a busy day says which', /\(1\/2\)/.test(SC.caption(SC.day({ games: busy, league }, 'portrait')[0])) && /\(2\/2\)/.test(SC.caption(SC.day({ games: busy, league }, 'portrait')[1])));
}

/* ----------------------------------------------------------------- the day, read --- */
console.log('\nthe game days');
{
  ok('a game day is the league\'s calendar day: late on a Friday in UTC is Saturday in Sydney, and Friday in Paris', GX.dayKeyOf('2026-10-02T23:30:00Z', 'Australia/Sydney') === '2026-10-03' && GX.dayKeyOf('2026-10-02T23:30:00Z', 'Europe/Paris') === '2026-10-03'
     && GX.dayKeyOf('2026-10-02T21:30:00Z', 'Europe/Paris') === '2026-10-02' && GX.dayKeyOf('2026-10-02T21:30:00Z', 'America/New_York') === '2026-10-02');
  const w = GX.dayWindow('2026-10-05', 'Australia/Sydney'), p = GX.dayWindow('2026-10-25', 'Europe/Paris');
  ok('its window is the zone\'s midnight to midnight (Sydney is UTC+11 once its clocks have gone forward, on the 4th), a day the clocks go back is 25 hours', w.start.toISOString() === '2026-10-04T13:00:00.000Z' && w.end.toISOString() === '2026-10-05T13:00:00.000Z'
     && (p.end - p.start) === 25 * 3600000, [w.start.toISOString(), (p.end - p.start) / 3600000].join());
  ok('...the day named for the page', GX.dayKeyLabel('2026-10-02') === 'Fri 2 Oct 2026' && GX.dayKeyLabel('2026-12-31') === 'Thu 31 Dec 2026');
  const rows = [['c1', '2026-10-02T16:00:00Z'], ['c1', '2026-10-02T18:00:00Z'], ['c2', '2026-10-02T19:00:00Z'], ['c1', '2026-09-30T18:00:00Z'], ['c2', '2026-10-03T22:30:00Z']].map(([competition_id, tipoff_at]) => ({ competition_id, tipoff_at }));
  ok('the days with a final on, newest first, each with its games counted (the late game on the 3rd is the 4th in Paris)', GX.gameDays(rows, 'Europe/Paris').map(d => d.day + ':' + d.n).join() === '2026-10-04:1,2026-10-02:3,2026-09-30:1');
  ok('...one competition\'s days only, when one is chosen ("all" and nothing are every one)', GX.gameDays(rows, 'Europe/Paris', 'c2').map(d => d.day + ':' + d.n).join() === '2026-10-04:1,2026-10-02:1'
     && GX.gameDays(rows, 'Europe/Paris', 'all').length === 3 && GX.gameDays(rows, 'Europe/Paris', '').length === 3);
}
{
  const queries = [];
  const G = [mk('x1', '2026-10-02T16:00:00Z', 0, 1, 84, 79), mk('x2', '2026-10-02T18:00:00Z', 2, 3, 70, 75), mk('x3', '2026-10-03T16:00:00Z', 4, 5, 60, 61), mk('x4', '2026-10-02T20:00:00Z', 6, 7, 0, 0, { status: 'scheduled' })]
    .map(g => ({ id: g.id, competition_id: 'c1', tipoff_at: g.tipoff_at, venue: g.venue, status: g.status || 'final', home_score: g.home_score, away_score: g.away_score, home_team_id: 't' + T.indexOf(g.home), away_team_id: 't' + T.indexOf(g.away) }));
  const clubs = T.map((t, i) => Object.assign({ id: 't' + i }, t));
  const client = () => {
    const q = table => {
      const b = { table, f: {}, sel: '', select(s) { b.sel = s; return b; }, eq(k, v) { b.f['eq:' + k] = v; return b; }, in(k, v) { b.f[k] = v; return b; }, range(a, z) { b.f.range = [a, z]; return b; },
        gte(k, v) { b.f.gte = v; return b; }, lt(k, v) { b.f.lt = v; return b; }, order() { return b; }, limit() { return b; },
        run() {
          queries.push({ table, sel: b.sel, f: b.f });
          if (table === 'games') return { data: G.filter(g => (b.f.gte === undefined || g.tipoff_at >= b.f.gte) && (b.f.lt === undefined || g.tipoff_at < b.f.lt) && (!b.f['eq:status'] || g.status === b.f['eq:status'])) };
          if (table === 'teams') return { data: clubs };
          return { data: [] };
        },
        maybeSingle() { return Promise.resolve(b.run()); }, then(res, rej) { return Promise.resolve(b.run()).then(res, rej); } };
      return b;
    };
    return { from: q, rpc: async () => { queries.push({ rpc: true }); return { data: [] }; } };
  };
  const sb = client();
  const comps = [{ id: 'c1', name: 'Pro A', kind: 'league' }];
  const days = await GX.readDays(sb, comps);
  ok('the game days are read from the finished games\' tip-off and competition and nothing else', days.rows.length === 3 && days.rows.every(r => r.tipoff_at && r.competition_id) && !days.truncated
     && queries.find(x => x.table === 'games').sel === 'competition_id,tipoff_at' && queries.find(x => x.table === 'games').f['eq:status'] === 'final', queries.find(x => x.table === 'games'));
  queries.length = 0;
  const lg = { id: 'L', name: 'LNB Pro A', slug: 'lnb', timezone: 'Europe/Paris', colour: '#ff6600', handle: 'lnb' };
  const dd = await GX.readDay(sb, lg, comps, '2026-10-02', new Date('2026-10-04T12:00:00Z'));
  const gq = queries.find(x => x.table === 'games');
  ok('one game day read on its own: the league\'s midnight to midnight (Paris is UTC+2: 22:00Z to 22:00Z), its finals only, no week ahead', gq.f.gte === '2026-10-01T22:00:00.000Z' && gq.f.lt === '2026-10-02T22:00:00.000Z'
     && dd.finals.map(g => g.id).sort().join() === 'x1,x2' && dd.upcoming.length === 0, [gq.f.gte, gq.f.lt, dd.finals.map(g => g.id)]);
  ok('...no table read, and the league row it was handed not read again (nor its handle)', !queries.some(x => x.table === 'standings' || x.table === 'leagues' || x.rpc) && dd.league === lg && dd.standings.length === 0);
  ok('...its clubs, quarter scores, club lines (the on-court numbers\' denominators) and players read as a week\'s are', queries.some(x => x.table === 'teams') && queries.find(x => x.table === 'team_game_stats').sel.includes('adv:stats->adv')
     && queries.find(x => x.table === 'player_game_stats').sel.includes('oc:stats->oc'), queries.filter(x => /game_stats/.test(x.table)).map(x => x.sel.slice(0, 80)));
  /* a busy day (college basketball plays seventy games on one) is read thirty games' players at a time: a request is cut at a thousand rows */
  {
    const many = Array.from({ length: 70 }, (_, i) => ({ id: 'm' + i, competition_id: 'c1', tipoff_at: '2026-10-02T' + String(8 + (i % 14)).padStart(2, '0') + ':00:00Z', venue: '', status: 'final', home_score: 80, away_score: 70, home_team_id: 't0', away_team_id: 't1' }));
    const sb2 = (() => { const qs = [];
      const q = table => { const b = { f: {}, select() { return b; }, eq() { return b; }, in(k, v) { b.f[k] = v; return b; }, gte() { return b; }, lt() { return b; }, order() { return b; }, limit() { return b; },
        run() { qs.push({ table, n: b.f.game_id && b.f.game_id.length }); return { data: table === 'games' ? many : table === 'teams' ? clubs : [] }; }, then(res, rej) { return Promise.resolve(b.run()).then(res, rej); } }; return b; };
      return { from: q, qs }; })();
    const big = await GX.readDay(sb2, lg, comps, '2026-10-02', new Date('2026-10-04T12:00:00Z'));
    const pq = sb2.qs.filter(x => x.table === 'player_game_stats').map(x => x.n);
    ok('a busy day: seventy games, read thirty games\' players at a time (30, 30, 10), none cut at the thousand-row cap', big.finals.length === 70 && pq.join() === '30,30,10', pq);
  }
  const last = await GX.readDay(sb, lg, comps, '2026-10-03', new Date('2026-10-03T20:00:00Z'));
  ok('a day not over is read up to now: the games still to come are not finals', last.finals.map(g => g.id).join() === 'x3');

  /* the weekly list: a graphic for every game day the window holds whole, newest first */
  const data = Object.assign({}, dd, { comps, finals: G.filter(g => g.status === 'final'), since: new Date('2026-09-26T12:00:00Z'), until: new Date('2026-10-03T12:00:00Z'), now: new Date('2026-10-03T12:00:00Z'), offset: 0 });
  data.teams = new Map(clubs.map(t => [t.id, t])); data.players = new Map(); data.perQ = new Map(); data.teamAdv = new Map();
  const list = GX.items(data, 'portrait', null).filter(x => x.model.kind === 'day');
  ok('the weekly list: a graphic for each whole game day of the week - the day cut by the window\'s edge (the 3rd ends after it) is left to the builder', list.length === 1 && list[0].title === 'Daily scores · Fri 2 Oct' && list[0].type === 'daily' && list[0].group === 'week'
     && list[0].model.rows.map(r => r.gameId).join() === 'x1,x2', list.map(x => x.title));
  const wide = GX.items(Object.assign({}, data, { until: new Date('2026-10-04T22:00:00Z'), now: new Date('2026-10-04T12:00:00Z') }), 'portrait', null).filter(x => x.model.kind === 'day');
  ok('...a window that holds both: newest first, and a day of two pages says which (' + wide.map(x => x.title).join(' | ') + ')', wide.map(x => x.title).join() === 'Daily scores · Sat 3 Oct,Daily scores · Fri 2 Oct');
  ok('...one competition\'s view has its own days (a day with none of its games is not offered)', GX.items(GX.scope(data, 'nope'), 'portrait', null).filter(x => x.model.kind === 'day').length === 0);
  ok('...the kind is counted and filtered: Daily scores comes after the results, before the stars', GX.counts(GX.items(data, 'portrait', null)).map(c => c.id).join().startsWith('all,results,daily') && GX.filterBy(GX.items(data, 'portrait', null), 'daily').length === 1
     && GX.TYPES.map(t => t.id).join() === 'results,daily,stars,table,ahead,roundup,leaders');

  /* the builder's subject */
  const b = o => GX.builderModel(data, Object.assign({ tpl: 'day' }, o), 'portrait', null);
  ok('the builder: a day with its own read draws; without it, it says it is reading; with no day, there is nothing', b({ dayKey: '2026-10-02', dayData: dd }).model.kind === 'day' && b({ dayKey: '2026-10-02', dayData: dd }).model.rows.length === 2
     && b({ dayKey: '2026-10-02' }).needsDay === true && b({ dayKey: '2026-10-02' }).model === null && b({ dayKey: '' }).model === null && /no game/i.test(b({ dayKey: '' }).reason));
  ok('...a day with no game says so, and the page asked for is kept within the pages there are', /No game finished/.test(b({ dayKey: '2026-10-01', dayData: Object.assign({}, dd, { finals: [] }) }).reason)
     && b({ dayKey: '2026-10-02', dayData: dd, page: 9 }).page === 0);
}

/* ------------------------------------------------------------------- the builder --- */
console.log('\nthe builder');
{
  ok('Daily scores is a template, with its own modules', UI.TEMPLATES.some(t => t.id === 'day' && t.label === 'Daily scores') && UI.HAS.day.includes('day') && UI.HAS.day.includes('leaders') && UI.HAS.day.includes('dayextras')
     && Object.keys(UI.HAS).every(k => UI.TEMPLATES.some(t => t.id === k)));
  const base = UI.defaultBuilder();
  ok('...an untouched builder of it is no modules at all, as every template\'s is', Object.keys(UI.modulesOf(Object.assign({}, base, { tpl: 'day' }))).length === 0 && base.day === '');
  const m = UI.modulesOf(Object.assign({}, base, { tpl: 'day', mods: Object.assign({}, base.mods, { dayExtras: ['time', 'venue'], weekExtras: ['elo'], leaderKeys: ['pts', 'c:ppg', 'bpm'], leaders: false, rows: '4' }) }));
  ok('...its extras are its own (a results row\'s are not carried over), its leader lines the graphic\'s own stats only, rows and leaders as ticked', m.rowExtras.join() === 'time,venue' && m.leaderKeys.join() === 'pts,bpm' && m.leaders === false && m.rows === 4, m);
  const store = (() => { const mm = new Map(); return { getItem: k => (mm.has(k) ? mm.get(k) : null), setItem: (k, v) => { mm.set(k, String(v)); } }; })();
  const b2 = UI.loadBuilder('L1', store); b2.tpl = 'day'; b2.day = '2026-10-02'; b2.mods.dayExtras = ['time']; UI.saveBuilder('L1', b2, store);
  const b3 = UI.loadBuilder('L1', store);
  ok('...remembered per league (the template and its extras), the game day not: a new visit opens on the newest', b3.tpl === 'day' && b3.mods.dayExtras.join() === 'time' && b3.day === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
