/* THE CLUB PAGE'S TEAM STATISTICS: the season line (epinoia/t/seasonline.js), the club's ELO beside its schedule
   (epinoia/p/sos-chip.js strength), the zones' ORB% and DRB% and the page's wiring.
     node supabase/tests/seasonline.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const SL = require(path.join(ROOT, 'epinoia', 't', 'seasonline.js'));
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); pass++; console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + e.message); } };
const aok = async (n, f) => { try { await f(); pass++; console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + e.message); } };
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

console.log('\nbench minutes: from each game\'s starters and the players\' minutes');
{
  const five = t => [1, 2, 3, 4, 5].map(i => t + i);
  const M = m => m * 60000;
  const games = [
    { id: 'g1', home_team_id: 'A', away_team_id: 'B', starters: [five('a'), five('b')] },
    { id: 'g2', home_team_id: 'B', away_team_id: 'A', starters: [five('b'), []] },        // A's starters never recorded
    { id: 'g3', home_team_id: 'A', away_team_id: 'C', starters: [five('x'), five('c')] }  // A's starters in ids its lines do not use
  ];
  const lines = [];
  five('a').forEach(p => lines.push({ game_id: 'g1', pid: p, team_idx: 0, min: M(32) }));
  lines.push({ game_id: 'g1', pid: 'a6', team_idx: 0, min: M(25) }, { game_id: 'g1', pid: 'a7', team_idx: 0, min: M(15) });
  lines.push({ game_id: 'g1', pid: 'a8', team_idx: 0, min: 0 });                           // did not play
  five('b').forEach(p => lines.push({ game_id: 'g1', pid: p, team_idx: 1, min: M(36) }));
  lines.push({ game_id: 'g1', pid: 'b6', team_idx: 1, min: M(20) });
  five('b').forEach(p => lines.push({ game_id: 'g2', pid: p, team_idx: 0, min: M(30) }));
  lines.push({ game_id: 'g2', pid: 'b6', team_idx: 0, min: M(50) });
  five('a').forEach(p => lines.push({ game_id: 'g2', pid: p, team_idx: 1, min: M(40) }));
  five('a').forEach(p => lines.push({ game_id: 'g3', pid: p, team_idx: 0, min: M(40) }));
  five('c').forEach(p => lines.push({ game_id: 'g3', pid: p, team_idx: 1, min: M(40) }));
  const B = SL.bench(games, lines);
  ok('A: 40 of its 200 minutes off the bench in the one game it can be read in (20%)', () => {
    const a = B.get('A'); assert.equal(a.games, 1); assert.ok(near(a.pct, 20)); assert.ok(near(a.bench, 40)); assert.ok(near(a.all, 200));
  });
  ok('B: 20 of 200, then 50 of 200: 17.5% over two games', () => { const b = B.get('B'); assert.equal(b.games, 2); assert.ok(near(b.pct, 17.5)); });
  ok('C: its starters played every minute (0%)', () => assert.ok(near(B.get('C').pct, 0)));
  ok('a side with no starters on record, or starters its lines never name, is left out, not counted all bench',
     () => assert.equal(B.get('A').games, 1));
  ok('nothing to read is an empty map', () => { assert.equal(SL.bench(null, null).size, 0); assert.equal(SL.bench(games, []).size, 0); });
}

console.log('\nthe club\'s play-by-play, summed the way the WOWY page sums it (lineupevents.js), split two ways');
const LE = require(path.join(ROOT, 'epinoia', 'lineupevents.js'));
/* a record is one stretch of a game from the club's side: its box, the other side's, the other side's five (oids) and
   club (oteam), how many of that game's starters it held (ost), and the possessions each side timed (scN, scS) */
const rec = (ost, oids, mins, own, opp, sc, osc) => {
  const o = Object.assign(LE.blankX(), own, { scN: sc[0], scS: sc[1], u: own.u || {} });
  const d = Object.assign(LE.blankX(), opp, { scN: osc[0], scS: osc[1] });
  return { g: 'g1', ids: ['a', 'b', 'c', 'd', 'e'], oids, oteam: 'OPP', dur: mins * 60000, own: o, opp: d, ost, ev: true };
};
const R = [
  rec(5, ['q', 'v', 'w', 'x', 'y'], 10, { pts: 22, fga: 18, fgm: 9, p3m: 2, fta: 4, tov: 2, or: 3, dr: 8 }, { pts: 20, fga: 17, fgm: 8, p3m: 2, fta: 4, tov: 3, or: 2, dr: 7 }, [20, 300], [20, 280]),
  rec(1, ['a1', 'a2', 'a3', 'b5', 'v'], 8, { pts: 20, fga: 14, fgm: 8, p3m: 3, fta: 2, tov: 1, or: 1, dr: 6 }, { pts: 10, fga: 15, fgm: 4, p3m: 1, fta: 0, tov: 2, or: 2, dr: 5 }, [16, 208], [16, 240]),
  rec(3, ['v', 'w', 'x', 'y', 'z'], 6, { pts: 10, fga: 10, fgm: 4, p3m: 1, fta: 2, tov: 1, or: 1, dr: 4 }, { pts: 12, fga: 10, fgm: 5, p3m: 1, fta: 2, tov: 1, or: 1, dr: 4 }, [12, 180], [12, 168])
];
/* the other side's season: v, w and x started all three of its games, y, q and r two each */
const SEASON = [
  { id: 'h1', home_team_id: 'OPP', away_team_id: 'X', starters: [['v', 'w', 'x', 'y', 'q'], ['x1', 'x2', 'x3', 'x4', 'x5']] },
  { id: 'h2', home_team_id: 'Y', away_team_id: 'OPP', starters: [['y1', 'y2', 'y3', 'y4', 'y5'], ['v', 'w', 'x', 'y', 'r']] },
  { id: 'h3', home_team_id: 'OPP', away_team_id: 'Z', starters: [['v', 'w', 'x', 'q', 'r'], ['z1', 'z2', 'z3', 'z4', 'z5']] },
  { id: 'h4', home_team_id: 'OPP', away_team_id: 'Z', starters: null }
];
const line = rs => LE.line(LE.sum(rs));
ok('regular starters: N games started or more for the club, a name in a five counted once', () => {
  assert.deepEqual([...SL.regularStarters(SEASON, 3).get('OPP')].sort(), ['v', 'w', 'x']);
  assert.deepEqual([...SL.regularStarters(SEASON, 2).get('OPP')].sort(), ['q', 'r', 'v', 'w', 'x', 'y']);
  assert.equal(SL.regularStarters(SEASON, 2).get('X').size, 0);
  assert.equal(SL.regularStarters([{ home_team_id: 'A', away_team_id: 'B', starters: [['p', 'p', 'q'], []] }], 2).get('A').size, 0);
  assert.equal(SL.mostStarts(SEASON), 3); assert.equal(SL.mostStarts([]), 0);
});
ok('the default is index_9\'s: regular starters, 10 games started', () => assert.deepEqual({ ...SL.SPLIT_DEFAULT }, { mode: 'regular', min: 10 }));
const basic = SL.logSummary(R, 2, LE, { mode: 'basic' });
ok('basic: all five of that game\'s starters against the starters, two or fewer against the bench (three or four is neither)', () => {
  assert.equal(basic.games, 2);
  assert.deepEqual(basic.all, line(R)); assert.deepEqual(basic.start, line([R[0]])); assert.deepEqual(basic.bench, line([R[1]]));
});
ok('regular with nobody at N starts: 4+ of that game\'s five against the starters, every other minute against the bench', () => {
  const x = SL.logSummary(R, 2, LE);
  assert.deepEqual(x.start, line([R[0]])); assert.deepEqual(x.bench, line([R[1], R[2]]));
});
ok('regular at 2 starts: a five with 4 of the club\'s regular starters is against the starters, whoever started that game', () => {
  const x = SL.logSummary(R, 2, LE, { regular: SL.regularStarters(SEASON, 2) });
  assert.deepEqual(x.start, line([R[0], R[2]])); assert.deepEqual(x.bench, line([R[1]]));
});
ok('regular at 3 starts: three regular starters on is not enough', () => {
  const x = SL.logSummary(R, 2, LE, { regular: SL.regularStarters(SEASON, 3) });
  assert.deepEqual(x.start, line([R[0]])); assert.deepEqual(x.bench, line([R[1], R[2]]));
});
ok('every minute is in one split or the other under the regular rule', () => {
  const sp = SL.splitRecs(R, LE, { regular: SL.regularStarters(SEASON, 2) });
  assert.equal(sp.start.length + sp.bench.length, R.length);
});
ok('the possession: own from the line (688 s over 48), the opponents\' from theirs (688 over 48)', () => {
  assert.ok(near(basic.all.sclock, Math.round(10 * 688 / 48) / 10)); assert.ok(near(basic.oppClock, 688 / 48));
});
ok('nothing to sum is nothing', () => { assert.equal(SL.logSummary([], 0, LE), null); assert.equal(SL.logSummary(R, 1, null), null); });

console.log('\nMOREY%, the rank and the band');
ok('MOREY% is the rim and the three shares when the box score splits the twos', () => assert.equal(SL.morey({ fga: 100, rim_share: 30, mid_share: 20, p3_share: 50 }), 80));
ok('...and nothing where it does not (no zones), or nothing was shot', () => {
  assert.equal(SL.morey({ fga: 100, rim_share: 0, mid_share: 0, p3_share: 40 }), null);
  assert.equal(SL.morey({ fga: 0, rim_share: 30, mid_share: 20, p3_share: 50 }), null);
  assert.equal(SL.morey({ fga: 100, rim_share: null, mid_share: 20, p3_share: 50 }), null);
});
{
  const rows = [{ id: 'a', v: 10 }, { id: 'b', v: 20 }, { id: 'c', v: 30 }, { id: 'd', v: null }];
  const g = r => r.v;
  ok('place: higher is better, the top club is 1st at the 100th percentile, the average and the range', () => {
    const P = SL.place(rows, g, 'c', 1);
    assert.equal(P.rank, 1); assert.equal(P.n, 3); assert.equal(P.pct, 100); assert.equal(P.avg, 20); assert.equal(P.lo, 10); assert.equal(P.hi, 30);
  });
  ok('place: lower is better turns it round', () => { const P = SL.place(rows, g, 'c', -1); assert.equal(P.rank, 3); assert.equal(P.pct, 0); });
  ok('place: a style is ranked by most', () => { const P = SL.place(rows, g, 'b', 0); assert.equal(P.rank, 2); assert.equal(P.pct, 50); });
  ok('place: a tie splits the percentile, and a club with no value has no place', () => {
    const P = SL.place([{ id: 'x', v: 5 }, { id: 'y', v: 5 }, { id: 'z', v: 1 }], g, 'x', 1);
    assert.equal(P.rank, 1); assert.equal(P.pct, 75);
    assert.equal(SL.place(rows, g, 'd', 1), null);
  });
  ok('band: five from the percentile, none without one', () => assert.deepEqual([0, 19.9, 20, 59.9, 60, 99.9, 100, null].map(SL.band), [1, 1, 2, 3, 4, 5, 5, 0]));
}
ok('prepare puts PPP and MOREY% on the club rows', () => {
  const S = { teams: [{ id: 'A', ortg: 112.34, fga: 100, rim_share: 30, mid_share: 20, p3_share: 50 }, { id: 'B', ortg: null }] };
  SL.prepare(S);
  assert.equal(S.teams[0].ppp, 1.123); assert.equal(S.teams[0].morey, 80);
  assert.equal(S.teams[1].ppp, null); assert.equal(S.teams[1].morey, null);
});

/* ---- the drawing, on a small stand-in for the document ---- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.className = ''; this.dataset = {};
    this._t = ''; this.attrs = {};
    const self = this;
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.classList = { add(c) { self.className = (self.className + ' ' + c).trim(); }, contains: c => self.className.split(/\s+/).includes(c) };
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
  replaceWith(n) { const p = this.parentNode, i = p.children.indexOf(this); if (n.parentNode) n.parentNode.removeChild(n); p.children[i] = n; n.parentNode = p; this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this._on = this._on || {})[t] = (this._on[t] || []).concat(fn); }
  click() { if (!this.disabled) ((this._on || {}).click || []).forEach(fn => fn({ target: this })); }
  set textContent(t) { this.children = []; this._t = String(t); }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(''); }
}
globalThis.document = { createElement: t => new El(t), createTextNode: t => ({ textContent: String(t), parentNode: null }) };
const kept = new Map();
globalThis.localStorage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)) };
const walk = (n, f, out = []) => { if (n.tagName && f(n)) out.push(n); (n.children || []).forEach(c => walk(c, f, out)); return out; };
const byClass = (n, c) => walk(n, x => x.classList && x.classList.contains(c));

console.log('\nthe card');
const TEAMS = () => [
  { id: 'A', ortg: 118, drtg: 101, net: 17, pace: 74, ts: 58, ft_pct: 76, ast_pct: 61, fga: 100, rim_share: 34, mid_share: 20, p3_share: 46 },
  { id: 'B', ortg: 108, drtg: 104, net: 4, pace: 70, ts: 55, ft_pct: 70, ast_pct: 55, fga: 100, rim_share: 30, mid_share: 30, p3_share: 40 },
  { id: 'C', ortg: 101, drtg: 110, net: -9, pace: 68, ts: 52, ft_pct: 72, ast_pct: 50, fga: 100, rim_share: 25, mid_share: 35, p3_share: 40 },
  { id: 'D', ortg: 99, drtg: 111, net: -12, pace: 72, ts: 51, ft_pct: 68, ast_pct: 58, fga: 100, rim_share: 28, mid_share: 32, p3_share: 40 }];
const tick = () => new Promise(r => setTimeout(r, 10));
const signed = v => (v > 0 ? '+' : '') + v.toFixed(1);
await aok('three ratings on one row, then four groups; the rows that need a read of their own fill in when it answers', async () => {
  kept.clear();
  const S = { teams: TEAMS(), games: [] };
  const host = new El('div');
  const bound = [];
  let giveBench, giveLogs, giveStarters;
  const bench = new Promise(r => { giveBench = r; });
  const logs = new Promise(r => { giveLogs = r; });
  const starters = new Promise(r => { giveStarters = r; });
  SL.render(host, { S, mine: S.teams[0], LE, bind: (n, d) => bound.push(d.k), logs, starters, bench, nameOf: async id => (id === 'p1' ? 'Ann Example' : null) });
  const tiles = byClass(host, 'csr-t');
  assert.deepEqual(tiles.map(t => t.dataset.k), ['ortg', 'drtg', 'net']);
  assert.equal(byClass(tiles[0], 'csr-v')[0].textContent, '118.0');
  assert.equal(byClass(tiles[2], 'csr-v')[0].textContent, '+17.0');
  /* the best defence's mark is at the right end of its strip: better is always to the right */
  const mark = walk(byClass(tiles[1], 'cs-strip')[0], x => x.tagName === 'B')[0];
  assert.equal(mark.style.left, '97.00%');
  const groups = walk(host, x => x.tagName === 'TBODY');
  assert.deepEqual(groups.map(g => g.dataset.g), ['tempo', 'efficiency', 'distribution', 'matchups']);
  assert.deepEqual(groups.map(g => walk(g, x => x.className === 'r').map(r => r.dataset.k)),
    [['pace', 'poss_time'], ['ppp', 'ts', 'ft_pct', 'morey'], ['ast_pct', 'helio', 'bench_min_pct'], ['vs_start', 'vs_bench']]);
  const row = k => walk(host, x => x.className === 'r' && x.dataset.k === k)[0];
  const val = k => byClass(row(k), 'v')[0];
  assert.equal(val('ppp').textContent, '1.18');
  assert.equal(val('morey').textContent, '80.0');
  assert.equal(val('bench_min_pct').textContent, '…', 'the bench waits for its read');
  for (const k of ['poss_time', 'helio', 'vs_start', 'vs_bench']) assert.equal(val(k).textContent, '…', k + ' waits for the play-by-play');
  assert.ok(bound.includes('ortg') && bound.includes('ast_pct') && !bound.includes('bench_min_pct') && !bound.includes('helio'));
  giveBench(new Map([['A', { pct: 32.14, games: 5 }], ['B', { pct: 20, games: 5 }], ['C', { pct: 40, games: 4 }]]));
  giveLogs({ recs: R, games: 2 });
  await tick();
  assert.equal(val('bench_min_pct').textContent, '32.1');
  assert.match(row('bench_min_pct').textContent, /over 5 games with the starters on record/);
  assert.ok(bound.includes('bench_min_pct'), 'once it is in, the bench opens its league chart too');
  assert.equal(val('poss_time').textContent, '14.3 s');
  assert.match(row('poss_time').textContent, /offence 14\.3 s.*defence 14\.3 s.*over 2 games of the club’s own logs/);
  assert.equal(val('vs_start').textContent, '…', 'the regular split waits for the starters too');
  giveStarters(SEASON);
  await tick();
  const exp = SL.logSummary(R, 2, LE, { regular: SL.regularStarters(SEASON, 10) });
  assert.equal(val('vs_start').textContent, signed(exp.start.net));
  assert.equal(val('vs_bench').textContent, signed(exp.bench.net));
  assert.match(row('vs_start').textContent, /4\+ of its regular starters on, or 4\+ of that game’s starting five/);
  assert.match(row('vs_bench').textContent, /every other minute/);
  assert.match(host.textContent, /Nobody in the scope has started 10 games yet \(the most is 3\)/);
});
await aok('the split: basic and back, the games that make a regular starter, kept in this browser', async () => {
  kept.clear();
  const S = { teams: TEAMS(), games: [] };
  const host = new El('div');
  SL.render(host, { S, mine: S.teams[0], LE, logs: Promise.resolve({ recs: R, games: 2 }), starters: Promise.resolve(SEASON) });
  await tick();
  const row = k => walk(host, x => x.className === 'r' && x.dataset.k === k)[0];
  const val = k => byClass(row(k), 'v')[0].textContent;
  const button = sel => walk(host, x => x.tagName === 'BUTTON' && sel(x))[0];
  const stepper = () => byClass(host, 'cst-step-v')[0];
  const want = opt => { const x = SL.logSummary(R, 2, LE, opt); return [signed(x.start.net), signed(x.bench.net)]; };
  assert.deepEqual([val('vs_start'), val('vs_bench')], want({ regular: SL.regularStarters(SEASON, 10) }));
  assert.equal(stepper().textContent, '10+');
  button(x => x.dataset.mode === 'basic').click();
  assert.deepEqual([val('vs_start'), val('vs_bench')], want({ mode: 'basic' }));
  assert.match(row('vs_start').textContent, /all five of its starters on/);
  assert.equal(byClass(host, 'cst-step').length, 0, 'basic has no games-started setting');
  assert.deepEqual(JSON.parse(kept.get('epinoia_vs_starters')), { mode: 'basic', min: 10 });
  button(x => x.dataset.mode === 'regular').click();
  for (let i = 0; i < 8; i++) button(x => x.dataset.step === '-1').click();
  assert.equal(stepper().textContent, '2+');
  assert.deepEqual([val('vs_start'), val('vs_bench')], want({ regular: SL.regularStarters(SEASON, 2) }));
  assert.ok(!/Nobody in the scope/.test(host.textContent), 'with players at 2 starts there is nothing to warn of');
  button(x => x.dataset.step === '-1').click();
  assert.equal(stepper().textContent, '1+');
  assert.ok(button(x => x.dataset.step === '-1').disabled, 'one game started is the least');
  assert.deepEqual(JSON.parse(kept.get('epinoia_vs_starters')), { mode: 'regular', min: 1 });
  /* the next card read in this browser opens as it was left */
  const again = new El('div');
  SL.render(again, { S: { teams: TEAMS(), games: [] }, mine: TEAMS()[0], LE, logs: Promise.resolve({ recs: R, games: 2 }), starters: Promise.resolve(SEASON) });
  await tick();
  assert.equal(byClass(again, 'cst-step-v')[0].textContent, '1+');
  kept.set('epinoia_vs_starters', '{"mode":"sideways","min":"x"}');
  assert.deepEqual(SL.loadSplit(), { mode: 'regular', min: 10 }, 'anything else kept is the default');
});
await aok('a reader without the play-by-play is told why, and the rest of the card stands', async () => {
  const S = { teams: [{ id: 'A', ortg: 100, drtg: 100, net: 0 }, { id: 'B', ortg: 90, drtg: 95, net: -5 }], games: [] };
  const host = new El('div');
  SL.render(host, { S, mine: S.teams[0], LE, logs: Promise.resolve({ why: 'for members, with the play-by-play' }), starters: null });
  await tick();
  const row = k => walk(host, x => x.className === 'r' && x.dataset.k === k)[0];
  for (const k of ['poss_time', 'helio', 'vs_start', 'vs_bench']) {
    assert.equal(byClass(row(k), 'v')[0].textContent, '—'); assert.match(row(k).textContent, /for members, with the play-by-play/);
  }
});

console.log('\nthe club\'s ELO beside its schedule (p/sos-chip.js)');
{
  globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
  const SOS = require(path.join(ROOT, 'epinoia', 'sos.js'));
  const Chip = require(path.join(ROOT, 'epinoia', 'p', 'sos-chip.js'));
  const T = ['a', 'b', 'c', 'd'], games = []; let i = 0;
  for (let r = 0; r < 3; r++) for (const x of T) for (const y of T) if (x < y)
    games.push({ id: i, home_team_id: x, away_team_id: y, home_score: 80 + i, away_score: 75 + (i * 3) % 11, tipoff_at: new Date(2026, 0, 1 + i++).toISOString() });
  const m = SOS.eloRatings(games);
  const s = T.map(t => Chip.strength(games, t, SOS));
  ok('rank 1 is the highest ELO, and it is the strongest band', () => {
    const best = [...m.entries()].sort((p, q) => q[1].elo - p[1].elo)[0][0];
    const top = s[T.indexOf(best)];
    assert.equal(top.rank, 1); assert.equal(top.band.key, 'elite'); assert.equal(top.line, '1st of 4'); assert.equal(top.seg, 4);
    assert.equal(s.find(x => x.rank === 4).band.key, 'weakest');
    assert.match(top.tip, /^ELO \d+: elite, 1st of 4 \(avg 1500\)/); assert.ok(top.more.includes('1500 is an average team'));
  });
  ok('the bands: stronger is greener, the other way from the schedule\'s', () => {
    assert.match(Chip.strengthBand(90).colour, /good/); assert.match(Chip.strengthBand(5).colour, /flare/);
    assert.match(Chip.band(90).colour, /flare/);
  });
  ok('no ELO under 3 games, for a club with no games, or with nothing to read', () => {
    assert.equal(Chip.strength(games.slice(0, 2), 'a', SOS), null);
    assert.equal(Chip.strength(games, 'zzz', SOS), null);
    assert.equal(Chip.strength(null, 'a', SOS), null);
  });
}

console.log('\nORB% and DRB% by zone: of the misses somebody rebounded');
{
  globalThis.EpinoiaSituations = require(path.join(ROOT, 'epinoia', 'situations.js'));
  const SC = require(path.join(ROOT, 'epinoia', 'shotchart.js'));
  const z = (a, m, o, d) => ({ a, m, o, d });
  const R = { off: { rim: z(10, 6, 2, 1), mid: z(5, 1, 1, 3), three: z(8, 2, 1, 4) }, def: { rim: z(9, 5, 1, 3), mid: z(4, 2, 0, 0), three: z(6, 1, 2, 2) } };
  const rim = SC.rebRow(R, 'rim'), mid = SC.rebRow(R, 'mid'), all = SC.rebRow(R, 'all');
  ok('rim: 2 of its 3 rebounded misses back (66.7%); 3 of the 4 against it taken (75%)', () => { assert.ok(near(rim.orb, 200 / 3)); assert.ok(near(rim.drb, 75)); });
  ok('...per attempt as before beside it (20% of the attempts)', () => assert.ok(near(rim.orp, 20)));
  ok('a zone with no rebounded miss against it has no DRB%', () => assert.equal(mid.drb, null));
  ok('every shot: 4 of 12 (33.3%) and 5 of 8 (62.5%)', () => { assert.ok(near(all.orb, 100 / 3)); assert.ok(near(all.drb, 62.5)); });
  const src = rd('epinoia', 'shotchart.js');
  ok('the season rows carry them as rb_<zone>_orb / _drb', () => assert.match(src, /tm\['rb_' \+ z \+ '_orb'\] = r\.orb; tm\['rb_' \+ z \+ '_drb'\] = r\.drb;/));
}

console.log('\nthe team table\'s defence + rebounding');
{
  const ft = rd('epinoia', 'fulltable.js');
  for (const k of ['rb_rim_orb', 'rb_mid_orb', 'rb_three_orb', 'rb_rim_drb', 'rb_mid_drb', 'rb_three_drb'])
    ok(k + ' is a defence + rebounding column', () => assert.ok(new RegExp("\\{ k:'" + k + "',\\s+l:'[^']+',\\s+g:\\['defense'\\]").test(ft), k));
  ok('the tab is called defence + rebounding', () => assert.ok(/\['defense',\s+'defence \+ rebounding'\]/.test(ft)));
  ok('the league page loads the rebound rule before the zone read, or the columns are dashes', () => {
    const lh = rd('epinoia', 'l', 'index.html'), at = s => lh.indexOf(s);
    assert.ok(at('src="../possessions.js?v=') > 0 && at('src="../situations.js?v=') > at('src="../possessions.js?v=') &&
              at('src="../shotchart.js?v=') > at('src="../situations.js?v='));
  });
  const SI = require(path.join(ROOT, 'epinoia', 'statinfo.js'));
  ok('every one explained, as the share of the rebounded misses', () => {
    for (const k of ['rb_rim_orb', 'rb_mid_orb', 'rb_three_orb', 'rb_rim_drb', 'rb_mid_drb', 'rb_three_drb']) assert.match(SI.info(k).formula, /\(own (OREB|DREB) \+ opponents’ (DREB|OREB)\)/);
  });
  ok('the season line\'s new rows are explained, and listed for the club page', () => {
    for (const k of ['poss_time', 'ppp', 'morey', 'helio', 'bench_min_pct', 'vs_start', 'vs_bench']) assert.ok(SI.info(k, 'team'), k);
    assert.deepEqual(SL.KEYS, ['ortg', 'drtg', 'net', 'pace', 'poss_time', 'ppp', 'ts', 'ft_pct', 'morey', 'ast_pct', 'helio', 'bench_min_pct', 'vs_start', 'vs_bench']);
    assert.deepEqual(SI.TEAM_KEYS.slice(0, SL.KEYS.length), SL.KEYS);
  });
}

console.log('\nthe page');
{
  const V = rd('epinoia', 'version.txt').trim();
  const h = rd('epinoia', 't', 'index.html'), tj = rd('epinoia', 't', 'team.js');
  const at = s => h.indexOf(s);
  ok('the season line, the ratings and the chips are loaded before team.js', () => {
    const team = at('<script src="team.js?v=' + V + '" defer></script>');
    for (const s of ['<script src="seasonline.js?v=' + V + '" defer></script>', '<script src="../sos.js?v=' + V + '" defer></script>',
                     '<script src="../p/sos-chip.js?v=' + V + '" defer></script>', '<script src="../shotclock.js?v=' + V + '" defer></script>',
                     '<script src="../engine.js?v=' + V + '" defer></script>', '<script src="../lineupevents.js?v=' + V + '" defer></script>'])
      assert.ok(at(s) > 0 && at(s) < team, s);
  });
  ok('its stylesheets are in the head, after the cards\', and legibility.css is still the last', () => {
    const head = at('</head>'), cards = at('href="../kit/cards.css?v=' + V + '"');
    for (const s of ['href="../kit/clubstats.css?v=' + V + '"', 'href="../kit/soschip.css?v=' + V + '"']) assert.ok(at(s) > cards && at(s) < head, s);
    const links = [...h.slice(0, head).matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(x => x[1]);
    assert.equal(links[links.length - 1], '../kit/legibility.css');
  });
  const ts = tj.slice(tj.indexOf('async function teamStats'), tj.indexOf('/* ------------------------------------------------------------- shot zones --- */'));
  ok('the season line card draws EpinoiaSeasonLine, with the club\'s play-by-play (members only) and the bench read', () => {
    const line = ts.slice(ts.indexOf("card('line', 'season line'"), ts.indexOf("card('zones'"));
    assert.match(line, /SL\.render\(box, \{/); assert.match(line, /logs: sectionLocked\('events'\) \?/); assert.match(line, /bench: benchMinutes\(S, team\)/);
  });
  ok('the club\'s logs are read through lineupevents.js, a game at a time, each game kept for the page\'s life', () => {
    assert.match(tj, /async function clubLogs\(team, scoped\)/);
    assert.match(tj, /LE\.gameSegments\(\{ id: g\.id, starters: g\.starters, events: byG\[g\.id\] \|\| \[\], period: g\.period \}\)/);
    assert.match(tj, /LE\.recordsOf\(G, side\)\.forEach\(r => \{ r\.oteam = oteam; recs\.push\(r\); \}\)/); assert.match(tj, /segCache\.set\(g\.id, G\)/);
    assert.match(tj, /starters: sectionLocked\('splits'\) \? null : scopeStarters\(scopeComps\)/);
    assert.ok(tj.includes('games?competition_id=in.(${key})&status=eq.final&select=id,home_team_id,away_team_id,starters'));
  });
  ok('the ELO and the schedule are painted beside the heading, over the same games', () => assert.match(ts, /EpinoiaSosChip\.paintClub\(th, \{ games: mine \? S\.games : null, teamId: team\.id \}\)/));
  ok('the bench read asks for the starters and the minutes only', () =>
    assert.ok(tj.includes('select=id,home_team_id,away_team_id,starters`') && tj.includes('select=game_id,player_uuid,player_id,team_idx,min:stats->min`')));
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
