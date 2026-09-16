/* ============================================================================
   RAPM — the stint builder and the ridge solve (epinoia/rapm.js).

   Three things are checked, and only the first is about basketball.

     1  A hand-built game whose result has one obvious cause. Ada Stone is on
        the floor for every run and off it for the one collapse, with her
        teammates rotating around her, so she is the only player the log can be
        explaining. The regression has to find her, put her offence and defence
        on the right side of zero, and put the opposition on the other.

     2  Shrinkage. Two players with the SAME raw margin, one measured over 500
        possessions and one over 2. If the smaller sample ever outranks the
        larger the regularisation is not doing its job, and RAPM would be a
        noise amplifier with a Greek letter in it.

     3  The stint builder agreeing with the engine. Same walk, same order, same
        possession estimate: summed stint points must reconstruct the final
        score exactly, and summed possessions must land on the engine's team
        estimate. Two possession counts that drift apart is two answers to the
        same question.

   Plus determinism, because a rating that changes between two runs of the same
   input is not a rating.

     node supabase/tests/rapm.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const RAPM = require(path.join(ROOT, 'epinoia', 'rapm.js'));
const Eng = require(path.join(ROOT, 'epinoia', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ==========================================================================
   1. THE HAND LOG

   Leeds (home, h1–h8) against Hull (away, a1–a5, who never substitute so that
   every away coefficient is pinned by the same evidence).

   Ada Stone is h1. The shape of the game:

     stint 1  h1 h2 h3 h4 h5   Leeds 8, Hull 2
     stint 2  h1 h3 h4 h5 h6   Leeds 8, Hull 2      (h2 off, h6 on)
     stint 3  h1 h4 h5 h6 h7   Leeds 8, Hull 2      (h3 off, h7 on)
     stint 4  h4 h5 h6 h7 h8   Leeds 2, Hull 10     (h1 OFF, h8 on)
     stint 5  h1 h4 h5 h6 h7   Leeds 8, Hull 2      (h8 off, h1 back)

   Her four teammates in the good stints keep changing; the only constant is
   her. h4–h7 are on the floor for the collapse as well as the runs, so the fit
   cannot hand them her credit.
   ========================================================================== */
const player = (t, i) => ({ id: (t ? 'a' : 'h') + i, name: (t ? 'Away ' : 'Home ') + i, num: String(i) });
const G = {
  teams: [
    { name: 'Leeds Force', players: [1, 2, 3, 4, 5, 6, 7, 8].map(i => player(0, i)) },
    { name: 'Hull Pirates', players: [1, 2, 3, 4, 5].map(i => player(1, i)) }
  ],
  starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
  period: 1, clockMs: 0,
  events: []
};
let seq = 0;
const ev = (t, team, pid, clock, extra) => {
  const s = ++seq;
  G.events.push(Object.assign({ id: s, seq: s, gameId: 'g1', t, team, pid, period: 1, clock }, extra || {}));
  return s;
};

/* one scoring exchange: the home side makes four two-pointers and the away
   side misses four and makes one, which is 8–2 over eight home possessions */
let clk = 600000;
const tick = () => (clk -= 4000);
function run(homePts, awayPts, homeOn, awayOn) {
  for (let i = 0; i < homePts / 2; i++) { ev('p2_made', 0, homeOn[i % 5], tick()); ev('reb', 1, awayOn[i % 5], tick(), { off: false }); }
  for (let i = 0; i < awayPts / 2; i++) { ev('p2_made', 1, awayOn[i % 5], tick()); ev('reb', 0, homeOn[i % 5], tick(), { off: false }); }
  /* balance the possession counts: each side also misses three and loses the
     ball once, so both ends have the same denominator and the margin is the
     only thing that differs */
  for (let i = 0; i < 3; i++) { ev('p2_miss', 0, homeOn[i % 5], tick()); ev('reb', 1, awayOn[i % 5], tick(), { off: false }); }
  for (let i = 0; i < 3; i++) { ev('p2_miss', 1, awayOn[i % 5], tick()); ev('reb', 0, homeOn[i % 5], tick(), { off: false }); }
  ev('to', 0, homeOn[0], tick());
  ev('to', 1, awayOn[0], tick());
}
const sub = (team, out, inn) => ev('sub', team, null, tick(), { out, in: inn });

const AW = ['a1', 'a2', 'a3', 'a4', 'a5'];
ev('period_start', null, null, 600000);
run(8, 2, ['h1', 'h2', 'h3', 'h4', 'h5'], AW);
sub(0, 'h2', 'h6');
run(8, 2, ['h1', 'h3', 'h4', 'h5', 'h6'], AW);
sub(0, 'h3', 'h7');
run(8, 2, ['h1', 'h4', 'h5', 'h6', 'h7'], AW);
sub(0, 'h1', 'h8');
run(2, 10, ['h4', 'h5', 'h6', 'h7', 'h8'], AW);
sub(0, 'h8', 'h1');
run(8, 2, ['h1', 'h4', 'h5', 'h6', 'h7'], AW);
G.clockMs = clk;

const game = { id: 'g1', starters: G.starters, events: G.events, period: 1, clockMs: clk };
const S = RAPM.stints([game]);
const d = Eng.deriveGame(G);

console.log('\n-- stint builder --');
ok('five substitutions produce five matched stints', S.length === 5, 'got ' + S.length);
ok('every stint has five players a side', S.every(s => s.home.length === 5 && s.away.length === 5),
   JSON.stringify(S.map(s => s.home.length + 'v' + s.away.length)));
ok('the fives are the ones the log put on the floor',
   S[0].home.join() === 'h1,h2,h3,h4,h5' && S[1].home.join() === 'h1,h3,h4,h5,h6' &&
   S[3].home.join() === 'h4,h5,h6,h7,h8' && S[4].home.join() === 'h1,h4,h5,h6,h7',
   S.map(s => s.home.join()).join(' | '));
ok('no away substitution, so the away five never changes',
   S.every(s => s.away.join() === 'a1,a2,a3,a4,a5'));

const sumPf = S.reduce((a, s) => a + s.pf, 0), sumPa = S.reduce((a, s) => a + s.pa, 0);
ok('summed stint points equal the final score',
   sumPf === d.score[0] && sumPa === d.score[1],
   sumPf + '-' + sumPa + ' vs ' + d.score[0] + '-' + d.score[1]);

const TA = [Eng.teamAdv(G, d, 0), Eng.teamAdv(G, d, 1)];
const sumPoss = S.reduce((a, s) => a + s.poss, 0), sumD = S.reduce((a, s) => a + s.dposs, 0);
ok('summed possessions are within 1% of the engine team estimate (home)',
   near(sumPoss, TA[0].possessions, TA[0].possessions * 0.01), sumPoss + ' vs ' + TA[0].possessions);
ok('summed possessions are within 1% of the engine team estimate (away)',
   near(sumD, TA[1].possessions, TA[1].possessions * 0.01), sumD + ' vs ' + TA[1].possessions);
ok('stint seconds add up to the game clock played',
   near(S.reduce((a, s) => a + s.seconds, 0), Eng.cumEl(1, clk) / 1000, 0.001));
ok('a game with no starters is ignored', RAPM.stints([{ id: 'x', events: G.events }]).length === 0);
ok('stints carry the game id', S.every(s => s.gameId === 'g1'));

console.log('\n-- the obvious best player --');
/* λ is dialled down from the 800 default for a ONE game sample: 800 is chosen
   for a season, and against sixty possessions it would shrink every player to
   a rounding error. Ordering is what is asserted here, not magnitude. */
const R = RAPM.compute(S, { lambda: 20, minPlayerPoss: 0 });
const by = {};
R.forEach(r => { by[r.id] = r; });

ok('every player in the log gets a coefficient', R.length === 13, 'got ' + R.length);
ok('Ada Stone (h1) is the best net player', R[0].id === 'h1',
   R.slice(0, 3).map(r => r.id + '=' + r.rapm.toFixed(2)).join(', '));
ok('she beats every teammate who shared the good stints',
   ['h4', 'h5', 'h6', 'h7'].every(k => by.h1.rapm > by[k].rapm),
   ['h4', 'h5', 'h6', 'h7'].map(k => k + '=' + by[k].rapm.toFixed(2)).join(', '));
ok('h8, on the floor only for the collapse, is the worst net player',
   R[R.length - 1].id === 'h8', R[R.length - 1].id);

ok('her offence is positive — her side scored while she played', by.h1.orapm > 0, by.h1.orapm.toFixed(3));
ok('HIGHER DRAPM IS BETTER DEFENCE: hers is positive, the opposition scored less',
   by.h1.drapm > 0, by.h1.drapm.toFixed(3));
ok('net is exactly offence plus defence', near(by.h1.rapm, by.h1.orapm + by.h1.drapm, 1e-12));
ok('the away five, who conceded all game, have negative defensive coefficients',
   AW.every(k => by[k].drapm < 0), AW.map(k => k + '=' + by[k].drapm.toFixed(2)).join(', '));
ok('the away five, held to 18 points, have negative offensive coefficients',
   AW.every(k => by[k].orapm < 0), AW.map(k => k + '=' + by[k].orapm.toFixed(2)).join(', '));
ok('coefficients are points per 100 possessions, not a fraction',
   Math.abs(by.h1.rapm) > 1 && Math.abs(by.h1.rapm) < 200, by.h1.rapm.toFixed(3));
ok('possessions and minutes come back with each player',
   by.h1.poss > 0 && by.h1.minutes > 0 && near(by.h1.minutes, (S[0].seconds + S[1].seconds + S[2].seconds + S[4].seconds) / 60, 1e-9));
ok('a home-court coefficient is estimated', typeof R.hca === 'number');
ok('the league average response is reported', R.leagueAvg > 0 && R.leagueAvg < 200, String(R.leagueAvg));

console.log('\n-- ridge shrinks towards the league --');
/* A synthetic league, hand-balanced so the ONLY difference between BIG and
   TINY is how much of them there is. Both play beside the same four teammates,
   against the same opponents, and their side scores at exactly 120 per 100
   while they are on. BIG does it over 500 possessions; TINY over 2. */
const syn = [];
const A4 = ['a1', 'a2', 'a3', 'a4'], OPP = ['b1', 'b2', 'b3', 'b4', 'b5'];
const st = (home, poss, pf, dposs, pa, gid) => ({ gameId: gid, home: home.slice().sort(), away: OPP.slice(), seconds: 120, poss, dposs, pf, pa });
/* 40 neutral stints at 100–100, so the league average is 100 and everybody
   else has nothing to explain */
for (let i = 0; i < 40; i++) syn.push(st(['a1', 'a2', 'a3', 'a4', 'a5'], 10, 10, 10, 10, 'n' + (i % 8)));
/* BIG: 50 stints of 10 possessions at 120 */
for (let i = 0; i < 50; i++) syn.push(st(A4.concat(['BIG']), 10, 12, 10, 10, 'x' + (i % 8)));
/* TINY: one stint of 2 possessions, also at 120 */
syn.push(st(A4.concat(['TINY']), 2, 2.4, 2, 2, 'x0'));

const RS = RAPM.compute(syn, { lambda: 800, minPlayerPoss: 0 });
const s = {};
RS.forEach(r => { s[r.id] = r; });
ok('BIG has 500 offensive possessions and TINY has 2',
   near(s.BIG.poss, 500, 1e-9) && near(s.TINY.poss, 2, 1e-9), s.BIG.poss + ' / ' + s.TINY.poss);
ok('the 2-possession player cannot outrank the 500-possession one at the same raw margin',
   s.BIG.orapm > s.TINY.orapm, 'BIG=' + s.BIG.orapm.toFixed(3) + ' TINY=' + s.TINY.orapm.toFixed(3));
ok('the 2-possession player is shrunk essentially to the league average',
   Math.abs(s.TINY.orapm) < 0.5, s.TINY.orapm.toFixed(4));
ok('the shrunken coefficient still points the right way, it is just small',
   s.TINY.orapm > 0 && s.TINY.orapm < s.BIG.orapm / 5, s.TINY.orapm.toFixed(4));
ok('even the well-sampled player is pulled below his raw +20',
   s.BIG.orapm > 0 && s.BIG.orapm < 20, s.BIG.orapm.toFixed(3));
ok('a stronger lambda shrinks harder',
   RAPM.compute(syn, { lambda: 8000, minPlayerPoss: 0 }).find(r => r.id === 'BIG').orapm < s.BIG.orapm);
ok('the minimum-possession filter keeps a two-possession player out by default',
   !RAPM.compute(syn, { lambda: 800 }).some(r => r.id === 'TINY'));

console.log('\n-- lambda by cross-validation --');
const auto = RAPM.compute(syn, { lambda: 'auto', minPlayerPoss: 0 });
ok('auto lambda lands inside the search range', auto.lambda >= 50 && auto.lambda <= 8000, String(auto.lambda));
ok('auto lambda is deterministic', RAPM.compute(syn, { lambda: 'auto', minPlayerPoss: 0 }).lambda === auto.lambda);

console.log('\n-- determinism --');
const r1 = RAPM.compute(S, { lambda: 20, minPlayerPoss: 0 });
const r2 = RAPM.compute(RAPM.stints([game]), { lambda: 20, minPlayerPoss: 0 });
ok('the same input twice gives byte-identical numbers',
   JSON.stringify(r1) === JSON.stringify(r2));
ok('the order of the output is stable',
   r1.map(r => r.id).join() === r2.map(r => r.id).join());
ok('no NaN or Infinity anywhere in the output',
   r1.every(r => [r.rapm, r.orapm, r.drapm, r.poss, r.minutes].every(v => typeof v === 'number' && isFinite(v))));
ok('an empty input is an empty result, not a crash',
   RAPM.compute([]).length === 0 && RAPM.stints([]).length === 0 && RAPM.stints(null).length === 0);

console.log('\n-- cost --');
/* A season's worth: 200 games of 25 stints, 240 players. This is the number
   the caller has to plan around, so it is measured rather than asserted from
   memory — the assertion is only that it is nowhere near a stalled tab. */
const season = [];
for (let g = 0; g < 200; g++) {
  for (let k = 0; k < 25; k++) {
    const base = (g % 20) * 12;
    const pick = n => 'p' + (base + ((k * 3 + n) % 12));
    const opp = n => 'p' + (((g + 7) % 20) * 12 + ((k * 5 + n) % 12));
    season.push({
      gameId: 'g' + g, seconds: 96,
      home: [0, 1, 2, 3, 4].map(pick).sort(), away: [0, 1, 2, 3, 4].map(opp).sort(),
      poss: 9, dposs: 9, pf: 9 + (g % 5), pa: 9 + (k % 5)
    });
  }
}
const t0 = Date.now();
const big = RAPM.compute(season, { lambda: 800 });
const ms = Date.now() - t0;
console.log('  ....  ' + season.length + ' stints, ' + big.length + ' players, ' + ms + 'ms');
ok('a 200-game season solves in a few seconds', ms < 5000, ms + 'ms');
ok('the season solve produces finite coefficients for everyone',
   big.length === 240 && big.every(r => isFinite(r.rapm)), 'players=' + big.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
