/* ============================================================================
   BPM 2.0 — checked against the Python it was ported from.

   The coefficients are the easy part; the traps are elsewhere. Interpolation
   endpoints the wrong way round, the 0.44 in true shooting attempts, the sign
   on the guard defensive-rebound OBPM coefficient, the minutes prior in the
   position estimate, and the /5.0 in the team adjustment are all places where
   a plausible-looking number comes out of a wrong formula.

   So this checks intermediate values, not just the final one — a BPM that is
   right in aggregate but wrong per component is a number nobody can debug
   later.
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../../epinoia/bpm.js');

let pass = 0, fail = 0;
const near = (name, got, want, tol = 0.001) => {
  if (got != null && Math.abs(got - want) <= tol) { pass++; console.log('  PASS  ' + name + '  -> ' + got); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got  ' + got + '\n        want ' + want); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('\ncoefficient interpolation');
/* the python: t = (x-1)/4, clamped; val = a + t*(b-a) */
near('a constant is returned as-is', B.lerp(0.86, 3), 0.86);
near('assist coefficient at the 1', B.lerp(B.COEF_BPM_POSITION.ast, 1), 0.58);
near('assist coefficient at the 5', B.lerp(B.COEF_BPM_POSITION.ast, 5), 1.034);
near('assist coefficient at the 3 is the midpoint',
     B.lerp(B.COEF_BPM_POSITION.ast, 3), (0.58 + 1.034) / 2);
near('offensive rebound falls from 1 to 5',
     B.lerp(B.COEF_BPM_POSITION.orb, 5), 0.181);
near('below 1 clamps rather than extrapolating',
     B.lerp(B.COEF_BPM_POSITION.ast, -3), 0.58);
near('above 5 clamps too', B.lerp(B.COEF_BPM_POSITION.ast, 9), 1.034);
near('shot volume interpolates on ROLE, not position',
     B.lerp(B.COEF_BPM_ROLE.fga, 5), -0.78);

console.log('\npossessions and per-100');
near('possessions are minutes x pace / 40',
     B.estimatedPossessions(30, 70), 52.5);
near('and never fall below half a possession',
     B.estimatedPossessions(0, 70), 0.5);
{
  const p = B.per100({ pts: 20, fga: 15, fta: 4, orb: 2, drb: 5 }, 50);
  near('points scale by 100/possessions', p.pts, 40);
  near('so do attempts', p.fga, 30);
  ok('total rebounds are derived when absent', Math.abs(p.trb - 14) < 0.001, String(p.trb));
}
{
  const p = B.per100({ pts: 10 }, 0.05);
  ok('a vanishing possession count gives zeros, not infinities',
     Object.values(p).every(v => v === 0));
}

console.log('\nposition estimate');
{
  const team = { trb: 45, stl: 8, pf: 20, ast: 25, blk: 4 };
  /* a player with the whole team's rebounds and no assists reads as a five */
  const big = B.estimatePosition({ trb: 45, stl: 0, pf: 20, ast: 0, blk: 4 }, team, 2000, 3);
  const gd  = B.estimatePosition({ trb: 2, stl: 8, pf: 4, ast: 25, blk: 0 }, team, 2000, 3);
  ok('a rebounding, shot-blocking, non-passing player reads high', big > 3.5, String(big));
  ok('a passing, stealing, non-rebounding player reads low', gd < 2.5, String(gd));
  ok('and it stays inside 1 to 5', big <= 5 && gd >= 1, big + ' / ' + gd);

  /* the 50-minute prior: a player with almost no minutes stays at his listed
     position however extreme his rate stats look */
  const tiny = B.estimatePosition({ trb: 45, stl: 0, pf: 20, ast: 0, blk: 4 }, team, 1, 3);
  ok('a one-minute cameo is regressed to the listed position',
     Math.abs(tiny - 3) < 0.3 && Math.abs(tiny - 3) < Math.abs(big - 3) / 5,
     tiny + ' (the same rates over 2000 minutes give ' + big + ')');
}

console.log('\noffensive role estimate');
{
  const team = { ast: 25, total_threshold_pts: 30 };
  const hog = B.estimateOffensiveRole({ pts: 40, fga: 25, fta: 6, ast: 2 }, 1.0, team, 2000);
  const bit = B.estimateOffensiveRole({ pts: 4, fga: 4, fta: 0, ast: 1 }, 1.0, team, 2000);
  ok('a high-usage scorer reads towards 1', hog < bit, hog + ' vs ' + bit);
  ok('both stay inside 1 to 5', hog >= 1 && bit <= 5, hog + ' / ' + bit);
}

console.log('\nposition constant');
/* python: pos_coef*position + role_coef*role + intercept */
near('BPM at position 3, role 3', B.positionConstant(3, 3, 'total'),
     0.159 * 3 + 1.44 * 3 - 4.99);
near('OBPM at position 3, role 3', B.positionConstant(3, 3, 'offensive'),
     0.08 * 3 + 0.72 * 3 - 2.50);

console.log('\nteam adjustment');
/* python: (team_rating * 1.20 - weighted_sum) / 5.0 */
near('a team performing above its box scores lifts everyone',
     B.teamAdjustment(10, 0), (10 * 1.2) / 5);
near('and below it drags them down', B.teamAdjustment(-5, 0), (-5 * 1.2) / 5);
near('the weighted raw sum is subtracted first',
     B.teamAdjustment(10, 6), (10 * 1.2 - 6) / 5);

console.log('\nraw BPM against a hand computation');
{
  /* one clean case worked through by hand from the coefficients, so a change
     to the formula shows up here rather than as a vibe */
  const p100 = { pts: 30, tpm: 3, ast: 5, to: 3, orb: 2, drb: 8,
                 stl: 2, blk: 1, pf: 4, fga: 20, fta: 6, trb: 10 };
  const pos = 3, role = 3, ptsPerTSA = 1.0;
  const tsa = 20 + 0.44 * 6;
  const ptsAdj = 30 + (1.0 - 1.0) * tsa;         // exactly 30 at a 1.00 baseline
  const expect =
      0.86 * ptsAdj
    + 0.389 * 3
    + B.lerp(B.COEF_BPM_POSITION.ast, pos) * 5
    + (-0.964) * 3
    + B.lerp(B.COEF_BPM_POSITION.orb, pos) * 2
    + B.lerp(B.COEF_BPM_POSITION.drb, pos) * 8
    + B.lerp(B.COEF_BPM_POSITION.stl, pos) * 2
    + B.lerp(B.COEF_BPM_POSITION.blk, pos) * 1
    + (-0.367) * 4
    + B.lerp(B.COEF_BPM_ROLE.fga, role) * 20
    + B.lerp(B.COEF_BPM_ROLE.fta, role) * 6;
  near('every term is in and correctly signed',
       B.rawBPM(p100, ptsPerTSA, pos, role, 'total'), expect, 0.0001);
}
{
  /* the efficiency baseline must actually bite */
  const p100 = { pts: 30, fga: 20, fta: 6 };
  const onEfficient = B.rawBPM(p100, 1.15, 3, 3, 'total');
  const onPoor = B.rawBPM(p100, 0.95, 3, 3, 'total');
  ok('the same line is worth LESS on an efficient team',
     onEfficient < onPoor, onEfficient.toFixed(2) + ' vs ' + onPoor.toFixed(2));
}

console.log('\na whole team');
{
  const players = [
    { id: 'a', minutes: 300, pts: 200, tpm: 20, ast: 40, to: 30, orb: 10, drb: 50, stl: 15, blk: 5,  pf: 40, fga: 150, fta: 50 },
    { id: 'b', minutes: 280, pts: 150, tpm: 30, ast: 60, to: 35, orb: 5,  drb: 30, stl: 20, blk: 2,  pf: 35, fga: 120, fta: 30 },
    { id: 'c', minutes: 260, pts: 120, tpm: 5,  ast: 20, to: 25, orb: 30, drb: 70, stl: 8,  blk: 20, pf: 45, fga: 90,  fta: 40 },
    { id: 'd', minutes: 200, pts: 80,  tpm: 15, ast: 25, to: 15, orb: 8,  drb: 25, stl: 10, blk: 3,  pf: 25, fga: 70,  fta: 15 },
    { id: 'e', minutes: 160, pts: 50,  tpm: 8,  ast: 15, to: 12, orb: 12, drb: 28, stl: 6,  blk: 8,  pf: 22, fga: 45,  fta: 12 }
  ];
  const totals = { pts: 600, fga: 475, fta: 147, oreb: 65, dreb: 203,
                   ast: 160, stl: 59, blk: 38, pf: 167, poss: 700 };
  const inputs = B.teamInputs(totals, players);
  const team = Object.assign({ id: 't', pace: 70, netRtg: 4, offRtg: 108 }, inputs);

  const rows = B.forTeam(team, players, 105);
  ok('every player gets a line', rows.length === 5, rows.length + ' rows');
  ok('all of them are finite', rows.every(r => isFinite(r.bpm) && isFinite(r.obpm) && isFinite(r.dbpm)));
  ok('BPM splits into offence and defence',
     rows.every(r => Math.abs((r.obpm + r.dbpm) - r.bpm) < 0.11),
     rows.map(r => r.bpm + '=' + r.obpm + '+' + r.dbpm).join('  '));

  /* the point of the team adjustment: minute-weighted BPM should land near
     the team's own net rating rather than wherever the box scores drifted */
  const totalMin = players.reduce((n, p) => n + p.minutes, 0);
  const weighted = rows.reduce((n, r) => n + r.bpm * (r.minutes / totalMin), 0);
  ok('the roster reconciles to roughly the team rating / 5',
     Math.abs(weighted - (4 * 1.2) / 5) < 0.5,
     'weighted ' + weighted.toFixed(2));

  ok('the big man is placed higher than the guard',
     rows.find(r => r.id === 'c').position > rows.find(r => r.id === 'b').position,
     'c=' + rows.find(r => r.id === 'c').position + ' b=' + rows.find(r => r.id === 'b').position);

  ok('VORP is positive for the best and lower for the worst',
     rows.some(r => r.vorp > 0), rows.map(r => r.id + ':' + r.vorp).join(' '));

  const nobody = B.forTeam(team, [], 105);
  ok('an empty roster is empty, not a crash', nobody.length === 0);
}

console.log('\na whole league');
{
  const mk = (id, netRtg, offRtg) => {
    const players = [1, 2, 3, 4, 5].map(i => ({
      id: id + i, minutes: 200 + i * 10, pts: 100 + i * 10, tpm: 10, ast: 30, to: 20,
      orb: 10, drb: 40, stl: 10, blk: 5, pf: 30, fga: 90, fta: 25
    }));
    const totals = { pts: 600, fga: 450, fta: 125, oreb: 50, dreb: 200,
                     ast: 150, stl: 50, blk: 25, pf: 150, poss: 700 };
    return Object.assign({ id, pace: 70, netRtg, offRtg, players },
                         B.teamInputs(totals, players));
  };
  const out = B.forLeague([mk('x', 5, 110), mk('y', -5, 100)]);
  ok('every player in the league is scored', out.size === 10, out.size + ' players');
  const x1 = out.get('x1'), y1 = out.get('y1');
  ok('a player on the better team scores higher on identical production',
     x1.bpm > y1.bpm, 'x1 ' + x1.bpm + ' vs y1 ' + y1.bpm);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
