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

console.log('\nheliocentrism: the busiest player\'s share of the club\'s used possessions');
ok('a player\'s used possessions: FGA + 0.44 x FTA + TOV', () => assert.ok(near(SL.usedPoss({ fga: 10, fta: 5, tov: 2 }), 14.2)));
{
  const P = [
    { id: 'p1', t: 'A', fga: 100, fta: 50, tov: 20 },     // 142
    { id: 'p2', t: 'A', fga: 50, fta: 0, tov: 10 },       // 60
    { id: 'p3', t: 'A', fga: 40, fta: 0, tov: 0 },        // 40
    { id: 'p4', t: 'A', fga: 0, fta: 0, tov: 0 },         // used nothing: not a user
    { id: 'q1', t: 'B', fga: 30, fta: 0, tov: 0 },        // a club under forty used possessions has no reading
    { id: 'e1', t: 'E', fga: 50, fta: 0, tov: 0 }, { id: 'e2', t: 'E', fga: 50, fta: 0, tov: 0 },
    { id: 'e3', t: 'E', fga: 50, fta: 0, tov: 0 }, { id: 'e4', t: 'E', fga: 50, fta: 0, tov: 0 },
    { id: 'z', t: null, fga: 500, fta: 0, tov: 0 }        // no club: left out
  ];
  const H = SL.helio(P, p => p.t);
  const a = H.get('A');
  const s = [142, 60, 40].map(u => u / 242);
  ok('the share is the busiest player\'s, and he is named', () => { assert.ok(near(a.share, 100 * 142 / 242)); assert.equal(a.top, 'p1'); assert.equal(a.n, 3); });
  ok('the equal users are 1 / the sum of the squared shares', () => assert.ok(near(a.users, 1 / s.reduce((t, x) => t + x * x, 0))));
  ok('four players sharing it evenly: 25%, spread like 4 equal users', () => { assert.ok(near(H.get('E').share, 25)); assert.ok(near(H.get('E').users, 4)); });
  ok('a club under ' + SL.MIN_USED + ' used possessions, and a player with no club, are left out', () => { assert.equal(H.has('B'), false); assert.equal(H.has(null), false); });
}

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

console.log('\nthe average possession, own and opponents\'');
{
  const logs = [
    { side: 0, events: [{ team: 0, dur: 10 }, { team: 1, dur: 20 }, { team: 0, dur: null }, { team: 0, dur: 14 }] },
    { side: 1, events: [{ team: 1, dur: 12 }, { team: 0, dur: 18 }] },
    { side: 0, events: 'boom' }
  ];
  const compute = ({ events }) => { if (!Array.isArray(events)) throw new Error('bad log'); return { possessions: events }; };
  const x = SL.possTime(logs, compute);
  ok('own: the club\'s timed possessions averaged, whichever side it was (12 s)', () => assert.ok(near(x.own, 12)));
  ok('opponents: theirs (19 s); an untimed possession is left out of both', () => { assert.ok(near(x.opp, 19)); assert.equal(x.nOwn, 3); assert.equal(x.nOpp, 2); });
  ok('a log that cannot be read is skipped, not fatal', () => assert.equal(x.games, 2));
  ok('no logs: nothing', () => { const y = SL.possTime([], compute); assert.equal(y.own, null); assert.equal(y.opp, null); });
}

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
ok('prepare puts PPP, MOREY% and heliocentrism on the club rows', () => {
  const S = { teams: [{ id: 'A', ortg: 112.34, fga: 100, rim_share: 30, mid_share: 20, p3_share: 50 }, { id: 'B', ortg: null }],
              players: [{ id: 'p1', fga: 60, fta: 0, tov: 0, _teamId: 'A' }, { id: 'p2', fga: 20, fta: 0, tov: 0 }],
              teamOfPlayer: new Map([['p2', 'A'], ['p1', 'B']]) };
  SL.prepare(S);
  const A = S.teams[0];
  assert.equal(A.ppp, 1.123); assert.equal(A.morey, 80);
  assert.equal(A.helio, 75); assert.equal(A.helio_top, 'p1');           // the row's own club wins over the map
  assert.equal(S.teams[1].ppp, null); assert.equal(S.teams[1].helio, null);
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
  set textContent(t) { this.children = []; this._t = String(t); }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(''); }
}
globalThis.document = { createElement: t => new El(t), createTextNode: t => ({ textContent: String(t), parentNode: null }) };
const walk = (n, f, out = []) => { if (n.tagName && f(n)) out.push(n); (n.children || []).forEach(c => walk(c, f, out)); return out; };
const byClass = (n, c) => walk(n, x => x.classList && x.classList.contains(c));

console.log('\nthe card');
await aok('three ratings on one row, then tempo, efficiency and distribution; the rows that need a read of their own fill in', async () => {
  const S = { teams: [
    { id: 'A', ortg: 118, drtg: 101, net: 17, pace: 74, ts: 58, ft_pct: 76, ast_pct: 61, fga: 100, rim_share: 34, mid_share: 20, p3_share: 46 },
    { id: 'B', ortg: 108, drtg: 104, net: 4, pace: 70, ts: 55, ft_pct: 70, ast_pct: 55, fga: 100, rim_share: 30, mid_share: 30, p3_share: 40 },
    { id: 'C', ortg: 101, drtg: 110, net: -9, pace: 68, ts: 52, ft_pct: 72, ast_pct: 50, fga: 100, rim_share: 25, mid_share: 35, p3_share: 40 },
    { id: 'D', ortg: 99, drtg: 111, net: -12, pace: 72, ts: 51, ft_pct: 68, ast_pct: 58, fga: 100, rim_share: 28, mid_share: 32, p3_share: 40 }],
    players: [{ id: 'p1', _teamId: 'A', fga: 300, fta: 50, tov: 30 }, { id: 'p2', _teamId: 'A', fga: 100, fta: 0, tov: 10 }], games: [] };
  const host = new El('div');
  const bound = [];
  let giveBench, givePoss;
  const bench = new Promise(r => { giveBench = r; });
  const poss = new Promise(r => { givePoss = r; });
  SL.render(host, { S, mine: S.teams[0], bind: (n, d) => bound.push(d.k), club: { poss_time: poss }, bench, nameOf: async id => (id === 'p1' ? 'Ann Example' : null) });
  const tiles = byClass(host, 'csr-t');
  assert.deepEqual(tiles.map(t => t.dataset.k), ['ortg', 'drtg', 'net']);
  assert.equal(byClass(tiles[0], 'csr-v')[0].textContent, '118.0');
  assert.equal(byClass(tiles[2], 'csr-v')[0].textContent, '+17.0');
  /* the best defence's mark is at the right end of its strip: better is always to the right */
  const mark = walk(byClass(tiles[1], 'cs-strip')[0], x => x.tagName === 'B')[0];
  assert.equal(mark.style.left, '97.00%');
  const groups = walk(host, x => x.tagName === 'TBODY');
  assert.deepEqual(groups.map(g => g.dataset.g), ['tempo', 'efficiency', 'distribution']);
  assert.deepEqual(groups.map(g => walk(g, x => x.className === 'r').map(r => r.dataset.k)),
    [['pace', 'poss_time'], ['ppp', 'ts', 'ft_pct', 'morey'], ['ast_pct', 'helio', 'bench_min_pct']]);
  const row = k => walk(host, x => x.className === 'r' && x.dataset.k === k)[0];
  assert.equal(byClass(row('ppp'), 'v')[0].textContent, '1.18');
  assert.equal(byClass(row('morey'), 'v')[0].textContent, '80.0');
  assert.equal(byClass(row('bench_min_pct'), 'v')[0].textContent, '…', 'the bench waits for its read');
  assert.equal(byClass(row('poss_time'), 'v')[0].textContent, '…', 'the possession waits for the logs');
  assert.ok(bound.includes('ortg') && bound.includes('helio') && !bound.includes('bench_min_pct') && !bound.includes('poss_time'));
  giveBench(new Map([['A', { pct: 32.14, games: 5 }], ['B', { pct: 20, games: 5 }], ['C', { pct: 40, games: 4 }]]));
  givePoss({ v: 14.2, note: new El('div') });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(byClass(row('bench_min_pct'), 'v')[0].textContent, '32.1');
  assert.match(row('bench_min_pct').textContent, /over 5 games with the starters on record/);
  assert.equal(byClass(row('poss_time'), 'v')[0].textContent, '14.2 s');
  assert.match(row('helio').textContent, /Ann Example · spread like \d\.\d equal users/);
  assert.ok(bound.includes('bench_min_pct'), 'once it is in, the bench opens its league chart too');
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
    for (const k of ['poss_time', 'ppp', 'morey', 'helio', 'bench_min_pct']) assert.ok(SI.info(k, 'team'), k);
    assert.deepEqual(SL.KEYS, ['ortg', 'drtg', 'net', 'pace', 'poss_time', 'ppp', 'ts', 'ft_pct', 'morey', 'ast_pct', 'helio', 'bench_min_pct']);
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
                     '<script src="../p/sos-chip.js?v=' + V + '" defer></script>', '<script src="../shotclock.js?v=' + V + '" defer></script>'])
      assert.ok(at(s) > 0 && at(s) < team, s);
  });
  ok('its stylesheets are in the head, after the cards\', and legibility.css is still the last', () => {
    const head = at('</head>'), cards = at('href="../kit/cards.css?v=' + V + '"');
    for (const s of ['href="../kit/clubstats.css?v=' + V + '"', 'href="../kit/soschip.css?v=' + V + '"']) assert.ok(at(s) > cards && at(s) < head, s);
    const links = [...h.slice(0, head).matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(x => x[1]);
    assert.equal(links[links.length - 1], '../kit/legibility.css');
  });
  const ts = tj.slice(tj.indexOf('async function teamStats'), tj.indexOf('/* ------------------------------------------------------------- shot zones --- */'));
  ok('the season line card draws EpinoiaSeasonLine, with the club\'s possession and the bench read', () => {
    const line = ts.slice(ts.indexOf("card('line', 'season line'"), ts.indexOf("card('zones'"));
    assert.match(line, /SL\.render\(box, \{/); assert.match(line, /poss_time: ACCESS\.locked \?/); assert.match(line, /bench: benchMinutes\(S, team\)/);
  });
  ok('the ELO and the schedule are painted beside the heading, over the same games', () => assert.match(ts, /EpinoiaSosChip\.paintClub\(th, \{ games: mine \? S\.games : null, teamId: team\.id \}\)/));
  ok('the bench read asks for the starters and the minutes only', () =>
    assert.ok(tj.includes('select=id,home_team_id,away_team_id,starters`') && tj.includes('select=game_id,player_uuid,player_id,team_idx,min:stats->min`')));
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
