/* Engine smoke test — runs in CI, no browser, no database.
   Guards the arithmetic that every other number on the platform is built on. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../functions/_shared/engine.js', import.meta.url), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const team = (name, t) => ({
  name, color: '#93f2bf',
  players: Array.from({ length: 8 }, (_, i) => ({ id: `p${t}_${i}`, name: `${name} ${i}`, num: String(i + 4) }))
});
const game = {
  teams: [team('home', 0), team('away', 1)],
  starters: [[0,1,2,3,4].map(i => `p0_${i}`), [0,1,2,3,4].map(i => `p1_${i}`)],
  period: 1, clockMs: 600000, tipWinner: 0, arrowInit: 1, events: []
};
let seq = 0;
const add = o => { game.events.push({ id: ++seq, seq, period: game.period, clock: game.clockMs, ...o }); return seq; };

add({ t: 'period_start' });

// a made three, assisted
const three = add({ t: 'p3_made', team: 0, pid: 'p0_0' });
add({ t: 'ast', team: 0, pid: 'p0_1' });

// a miss inside the key, blocked, offensive rebound, put-back
const miss = add({ t: 'p2_miss', team: 1, pid: 'p1_2' });
add({ t: 'loc', ref: miss, x: 0.5, y: 0.2 });
add({ t: 'blk', team: 0, pid: 'p0_3' });
add({ t: 'reb', team: 1, pid: 'p1_4', off: true });
const put = add({ t: 'p2_made', team: 1, pid: 'p1_4' });
add({ t: 'tag', ref: put, tag: 'paint' });

// shooting foul, two free throws, one made
add({ t: 'foul', team: 0, pid: 'p0_2', kind: 'shooting', drawn: 'p1_0' });
add({ t: 'ft_made', team: 1, pid: 'p1_0' });
add({ t: 'ft_miss', team: 1, pid: 'p1_0' });
add({ t: 'reb', team: 0, pid: null, off: false });     // team defensive rebound

// turnover + steal
add({ t: 'to', team: 0, pid: 'p0_1' });
add({ t: 'stl', team: 1, pid: 'p1_3' });

game.clockMs = 480000;   // two minutes gone
const d = E.deriveGame(game);

// ---- scoring ----
assert.equal(d.score[0], 3, 'home should have the three');
assert.equal(d.score[1], 3, 'away: put-back + one free throw');
assert.equal(d.stats['p0_0'].p3m, 1);
assert.equal(d.stats['p0_1'].ast, 1);
assert.equal(d.stats['p0_1'].ptsAst, 3, 'assist credited with the value of the made shot');

// ---- rebounding / rim classification ----
assert.equal(d.stats['p1_4'].or, 1, 'offensive rebound');
assert.equal(d.team[0].teamRebD, 1, 'team defensive rebound');
assert.equal(d.stats['p1_2'].rimA, 1, 'a located shot in the key counts as a rim attempt');
assert.equal(d.stats['p1_4'].rimM, 1, 'a paint-tagged make counts at the rim');

// ---- fouls ----
assert.equal(d.stats['p0_2'].pf, 1);
assert.equal(d.stats['p1_0'].fd, 1, 'foul drawn credited to the shooter');
assert.equal(d.team[0].foulsP[1], 1, 'team foul recorded in this period');

// ---- second chance / points off turnovers ----
assert.equal(d.team[1].sc, 2, 'the put-back is second-chance points');
assert.equal(d.stats['p1_3'].stl, 1);

// ---- plus/minus is zero-sum across the two fives ----
const pmHome = game.teams[0].players.reduce((a, p) => a + d.stats[p.id].pm, 0);
const pmAway = game.teams[1].players.reduce((a, p) => a + d.stats[p.id].pm, 0);
assert.equal(pmHome + pmAway, 0, 'plus/minus must net to zero');

// ---- minutes: five players x elapsed time, per side ----
const mins = t => game.teams[t].players.reduce((a, p) => a + d.stats[p.id].min, 0) / 60000;
assert.equal(Math.round(mins(0)), 10, 'five players x two minutes');
assert.equal(Math.round(mins(1)), 10);

// ---- advanced ----
const A = E.teamAdv(game, d, 0), B = E.teamAdv(game, d, 1);
assert.ok(A.possessions > 0 && B.possessions > 0);
assert.ok(Number.isFinite(A.ortg) && Number.isFinite(B.ortg));
const pa = E.playerAdv(game, d, 0, game.teams[0].players[0], A, B);
assert.ok(pa.ts > 0, 'true shooting computed');
assert.equal(pa.net, pa.ocOrtg - pa.ocDrtg);

// ---- lineups ----
const lu = E.lineupAgg(d, 0);
assert.ok(lu.length >= 1 && lu[0].ids.length === 5);

// ---- an empty game must not throw ----
const empty = E.deriveGame({ ...game, events: [] });
assert.equal(empty.score[0], 0);

// ---- determinism ----
assert.equal(JSON.stringify(E.deriveGame(game).score), JSON.stringify(d.score));

console.log('engine smoke: all assertions passed (version ' + E.VERSION + ')');
