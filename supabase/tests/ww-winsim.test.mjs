/* ============================================================================
   WHAT WINS: THE SIMULATOR (epinoia/winsim.js and its worker), with no browser.

     node supabase/tests/ww-winsim.test.mjs

   What is held here (docs/what-wins-model.md §8, §16 WP2):
     * a game is deterministic in its seed; its tallies are feature-line (LAYOUT) names;
     * points per possession equal the Markov chain's expectation within 3 Monte Carlo SE; every miss won back at
       a 50% make is two chances a possession; possessions follow kappa_N T / (d_A + d_B);
     * the venue is symmetric (A at home + B at home from the other side = 1); identical sides are a coin;
       a better eFG raises the odds and more turnovers lower them, paired (z > 3); common random numbers cut the
       variance of a what-if by more than five times; more possessions help the favourite; nothing ends level;
     * edits move the natural number exactly (eFG in points, the 3PA rate, seconds); needed() lands within 0.01;
       the loss Shapley is exact; the season is a Poisson-binomial;
     * calibrate() recovers a planted home court and form noise;
     * 10,000 games in under 400 ms; the worker answers the §8.5 protocol (progress, result, cancel, errors) and loads
       its scripts with its own ?v=.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  -> ' + extra : ''}`);
};
const read = f => fs.readFileSync(path.join(ROOT, 'epinoia', f), 'utf8');
const sandbox = { console, module: undefined, performance, setTimeout };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['winstats.js', 'winsim.js']) vm.runInContext(read(f), ctx, { filename: f });
const S = sandbox.EpinoiaWinStats, Sim = sandbox.EpinoiaWinSim;
ok('winsim.js loads as window.EpinoiaWinSim with the §14 names', !!Sim && ['profile', 'matchup', 'game', 'simulate', 'applyEdits', 'counterfactual',
  'needed', 'shapley', 'season', 'calibrate', 'synth'].every(k => typeof Sim[k] === 'function') && Array.isArray(Sim.RATES) && Sim.RATES.length === 16 &&
  Sim.RATES.every(k => Sim.K_PRIOR[k] > 0));
const close = (a, b, t) => Math.abs(a - b) <= t;
const syn = Sim.synth({ teams: 10, games: 90, seed: 4 });
const L = syn.league, T = syn.profiles;
const quiet = Object.assign({}, L, { tau: 0, dTr: 0, hca: 0, sigmaN: 0, fouling: false });

console.log('\none game');
{
  const M = Sim.matchup(T[0], T[1], L, { home: 1 });
  const g1 = Sim.game(M, S.rng(5), S.rng(6)), g2 = Sim.game(M, S.rng(5), S.rng(6)), g3 = Sim.game(M, S.rng(7), S.rng(6));
  ok('the same seeds play the same game; another seed another', JSON.stringify(g1) === JSON.stringify(g2) && JSON.stringify(g1) !== JSON.stringify(g3));
  const r1 = Sim.simulate(M, { n: 500, seed: 9 }), r2 = Sim.simulate(M, { n: 500, seed: 9 });
  ok('simulate is deterministic in its seed', JSON.stringify(r1) === JSON.stringify(r2));
  const want = 'pts fga fgm fg3a fg3m fta ftm oreb dreb tov rim_a rim_m mid_a mid_m poss chances to_live trips_shooting trips_bonus and1 reb_off_ch reb_def_ch tr_ch tr_pts timed_s timed_n'.split(' ');
  ok('a game\'s tallies carry the §14 LAYOUT names', want.every(k => typeof g1.tally[0][k] === 'number' && typeof g1.tally[1][k] === 'number'));
  let layout = null;
  try { layout = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'epinoia', 'features.js')).LAYOUT; } catch (e) { layout = null; }
  if (layout) ok('...every tally key is a name in EpinoiaFeatures.LAYOUT', Object.keys(g1.tally[0]).every(k => layout.some(l => l.k === k)));
  const t = g1.tally[0];
  ok('...and they add up: points = 2 FGM + FG3M + FTM; makes within attempts; rim + mid + 3 = FGA', t.pts === 2 * t.fgm + t.fg3m + t.ftm &&
     t.fgm <= t.fga && t.rim_a + t.mid_a + t.fg3a === t.fga && t.rim_m + t.mid_m + t.fg3m === t.fgm && g1.pts[0] === t.pts + (g1.pts[0] - t.pts) && t.to_live <= t.tov);
  ok('...the other side\'s defensive boards are this side\'s chances lost on the glass', g1.tally[1].dreb === t.reb_def_ch && t.oreb === t.reb_off_ch);
}

console.log('\nthe chain against its expectation');
{
  const M = Sim.matchup(T[2], T[3], quiet, { home: 0 });
  const mk = Sim.markov(M, 0), n = 6000, ppg = [];
  let pts = 0, poss = 0, ch = 0;
  for (let i = 0; i < n; i++) {
    const g = Sim.game(M, S.rng(1000 + i), S.rng(9000 + i));
    pts += g.tally[0].pts; poss += g.tally[0].poss; ch += g.tally[0].chances;
    ppg.push([g.tally[0].pts, g.tally[0].poss]);
  }
  const ppp = pts / poss, mp = poss / n;
  const se = Math.sqrt(ppg.reduce((s, [a, b]) => s + (a - ppp * b) * (a - ppp * b), 0) / (n - 1)) / (mp * Math.sqrt(n));
  ok('points per possession = the Markov expectation within 3 MC SE', Math.abs(ppp - mk.ppp) < 3 * se, ppp.toFixed(4) + ' vs ' + mk.ppp.toFixed(4) + ' (SE ' + se.toFixed(4) + ')');
  ok('...chances per possession too', Math.abs(ch / poss - mk.chances) < 0.01, (ch / poss).toFixed(4) + ' vs ' + mk.chances.toFixed(4));
  const r = { d: 15, tov: 0, live: 0.5, sfoul: 0, bonus: 0, mixRim: 0.3, mixMid: 0.3, mix3: 0.4, pRim: 0.5, pMid: 0.5, p3: 0.5, p2: 0.5, and1: 0, ft: 0.7, orb: 1, tr: 0 };
  const M2 = Sim.matchFrom(r, r, quiet), mk2 = Sim.markov(M2, 0);
  const s2 = Sim.simulate(M2, { n: 2000, seed: 3, tally: true });
  const cpp = s2.tally[0].chances / s2.tally[0].poss;
  ok('every miss won back at a 50% make: two chances a possession (1.969 with the six-chance cap)', close(mk2.chances, 1.96875, 1e-4) && close(cpp, 1.96875, 0.02),
     cpp.toFixed(4));
}
{
  const out = [];
  for (const kappa of [0.9, 1.1]) {
    const Lk = Object.assign({}, quiet, { kappaN: kappa });
    const M = Sim.matchup(T[4], T[5], Lk, { home: 1 });
    const want = kappa * Lk.T / (M.r[0].d + M.r[1].d), r = Sim.simulate(M, { n: 2000, seed: 2 });
    out.push([want, (r.poss[0] + r.poss[1]) / 2]);
  }
  ok('possessions = kappa_N T / (d_A + d_B) (rounded; the away side\'s coin and overtime within 0.6)', out.every(([w, s]) => Math.abs(s - w) < 0.6) &&
     out[1][1] / out[0][1] > 1.2,
     out.map(([w, s]) => w.toFixed(2) + '/' + s.toFixed(2)).join(' '));
}

console.log('\nthe odds');
{
  const n = 20000;
  const a = Sim.simulate(Sim.matchup(T[0], T[1], L, { home: 1 }), { n, seed: 11 }), b = Sim.simulate(Sim.matchup(T[1], T[0], L, { home: -1 }), { n, seed: 12 });
  const se = Math.sqrt(a.se * a.se + b.se * b.se);
  ok('P(A, B, A at home) + P(B, A, B away) = 1 within 2 SE', Math.abs(a.pWin + b.pWin - 1) < 2 * se, (a.pWin + b.pWin).toFixed(4));
  const same = Sim.simulate(Sim.matchup(T[6], T[6], L, { home: 0 }), { n, seed: 13 });
  ok('identical sides at a neutral venue: 0.5', Math.abs(same.pWin - 0.5) < 2.5 * same.se && Math.abs(same.mean) < 0.3, same.pWin.toFixed(4));
  const home = Sim.simulate(Sim.matchup(T[6], T[6], L, { home: 1 }), { n, seed: 13 });
  ok('...and the home side of two identical ones wins more (hca ' + L.hca + ')', home.pWin > same.pWin + 3 * same.se, home.pWin.toFixed(4));
  ok('nothing ends level (overtime, then a coin)', a.hist.every(([m]) => m !== 0) && same.hist.every(([m]) => m !== 0));
  ok('a margin histogram and quantiles come back', a.hist.reduce((s, h) => s + h[1], 0) === n && a.q05 < a.q50 && a.q50 < a.q95);
}
{
  const M = Sim.matchup(T[0], T[1], L, { home: 0 });
  const up = Sim.counterfactual(M, [{ side: 'A', end: 'off', key: 'efg', delta: 2 }], { n: 4000, seed: 5 });
  const down = Sim.counterfactual(M, [{ side: 'A', end: 'off', key: 'tovp', delta: 3 }], { n: 4000, seed: 5 });
  ok('+2 eFG points on offence raises the odds (paired z > 3)', up.dWin / up.se > 3 && up.dMargin > 0, (up.dWin / up.se).toFixed(1));
  ok('+3 TOV% lowers them (paired z > 3)', -down.dWin / down.se > 3 && down.dMargin < 0, (-down.dWin / down.se).toFixed(1));
  const def = Sim.counterfactual(M, [{ side: 'A', end: 'def', key: 'efg', delta: -2 }], { n: 4000, seed: 5 });
  ok('...and holding the opponent 2 eFG points lower helps too', def.dWin > 3 * def.se);
  /* CRN: the same games in both arms against an alternative arm on other seeds */
  const Ma = Sim.editMatch(M, [{ side: 'A', end: 'off', key: 'efg', delta: 2 }]);
  const base = Sim.simulate(M, { n: 3000, seed: 21, margins: true }).margins, crn = Sim.simulate(Ma, { n: 3000, seed: 21, margins: true }).margins;
  const ind = Sim.simulate(Ma, { n: 3000, seed: 22, margins: true }).margins;
  const vr = (x, y) => { let s = 0, s2 = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d; s2 += d * d; } const m = s / x.length; return s2 / x.length - m * m; };
  const ratio = vr(crn, base) / vr(ind, base);
  ok('common random numbers: a what-if\'s variance under 20% of independent arms', ratio < 0.2, ratio.toFixed(3));
}
{
  const out = [];
  for (const kappa of [0.6, 1.4]) out.push(Sim.simulate(Sim.matchup(T[0], T[1], Object.assign({}, L, { kappaN: kappa }), { home: 0 }), { n: 20000, seed: 31 }));
  const fav = out[1].pWin > 0.5;
  ok('the favourite\'s win share rises with the number of possessions', fav ? out[1].pWin > out[0].pWin + 0.01 : out[1].pWin < out[0].pWin - 0.01,
     out.map(r => r.pWin.toFixed(3)).join(' -> '));
}
{
  const M = Sim.matchup(T[0], T[1], L, { home: 1 });
  const t0 = performance.now();
  const r = Sim.simulate(M, { n: 10000, seed: 77 });
  const dt = performance.now() - t0;
  ok('10,000 games in under 400 ms', dt < 400 && r.n === 10000, dt.toFixed(0) + ' ms');
}

console.log('\nwhat-ifs in natural units');
{
  const P = T[7], z = true;
  const nat = Sim.natural(P.off, z);
  const e1 = Sim.applyEdits(P, [{ end: 'off', key: 'efg', delta: 3 }], L), n1 = Sim.natural(e1.off, z);
  ok('efg +3: one logit shift on the makes moves the mix-weighted eFG by exactly 3 points', close(n1.efg - nat.efg, 3, 1e-8) &&
     n1.p3r === nat.p3r, (n1.efg - nat.efg).toFixed(10));
  const e2 = Sim.applyEdits(P, [{ end: 'def', key: 'p3r', delta: 5 }], L), n2 = Sim.natural(e2.def, z), d0 = Sim.natural(P.def, z);
  ok('p3r +5 on defence: the three share up 5 points, rim and mid rescaled to fill the rest', close(n2.p3r - d0.p3r, 5, 1e-9) &&
     close(e2.def.mixRim / e2.def.mixMid, P.def.mixRim / P.def.mixMid, 1e-12) && close(e2.def.mixRim + e2.def.mixMid + e2.def.mix3, 1, 1e-12));
  const e3 = Sim.applyEdits(P, [{ end: 'off', key: 'secs', delta: -2 }, { end: 'off', key: 'tovp', delta: 2 }, { end: 'off', key: 'ftr', delta: 4 }, { end: 'off', key: 'orebp', delta: 3 }], L);
  const n3 = Sim.natural(e3.off, z);
  ok('secs, tovp, ftr and orebp move by their deltas in the model\'s own box numbers', close(n3.secs - nat.secs, -2, 1e-9) && close(n3.orebp - nat.orebp, 3, 1e-9) &&
     close(n3.ftr - nat.ftr, 4, 1e-6) && Math.abs(n3.tovp - nat.tovp - 2) < 0.5, [n3.secs - nat.secs, n3.tovp - nat.tovp, n3.ftr - nat.ftr].map(v => v.toFixed(3)).join());
  ok('the profile itself is left as it was', JSON.stringify(Sim.natural(P.off, z)) === JSON.stringify(nat));
}
{
  const M = Sim.matchup(T[0], T[1], L, { home: 1 });
  const nd = Sim.needed(M, 'efg', { side: 'A', end: 'off', target: 0.6, n: 3000, seed: 8 });
  const check = Sim.simulate(Sim.editMatch(M, [{ side: 'A', end: 'off', key: 'efg', delta: nd.delta }]), { n: 3000, seed: 8 });
  ok('needed: the eFG that brings P(win) to 0.6, within 0.01 (same games)', nd.reached && Math.abs(check.pWin - 0.6) <= 0.01 && Math.abs(nd.p - 0.6) <= 0.01,
     nd.value.toFixed(2) + ' (from ' + nd.base.toFixed(2) + ') p ' + nd.p.toFixed(4));
  const p0 = Sim.simulate(M, { n: 3000, seed: 8 }).pWin, goal = Math.min(0.95, p0 + 0.1);
  const hold = Sim.needed(M, 'efg', { side: 'A', end: 'def', target: goal, n: 3000, seed: 8 });
  const bSide = Sim.needed(M, 'efg', { side: 'B', end: 'off', target: 0.4, n: 2000, seed: 8 });
  ok('...on defence too ("hold them under x eFG%": below what it allows now), and for side B', hold.reached && Math.abs(hold.p - goal) <= 0.01 && hold.value < hold.base &&
     bSide.reached && Math.abs(bSide.p - 0.4) <= 0.01 && bSide.value > bSide.base, hold.value.toFixed(2) + ' < ' + hold.base.toFixed(2) + '; B ' + bSide.value.toFixed(2));
  const far = Sim.needed(M, 'secs', { side: 'A', end: 'off', target: 0.99, n: 1000, seed: 8 });
  ok('...an unreachable target says so and returns the nearest end', far.reached === false && far.p < 0.99);
}
{
  const exp = Sim.matchup(T[0], T[1], L, { home: 1 });
  const played = Sim.matchFrom(
    Object.assign({}, exp.r[0], { p3: exp.r[0].p3 - 0.08, tov: exp.r[0].tov + 0.04, orb: exp.r[0].orb - 0.05 }),
    Object.assign({}, exp.r[1], { p3: exp.r[1].p3 + 0.05, ft: exp.r[1].ft - 0.1 }), L, { home: 1 });
  const sh = Sim.shapley(exp, played, null, { n: 1000, seed: 3 });
  const sum = Object.values(sh.phi).reduce((s, v) => s + v, 0);
  ok('loss Shapley: six groups, sum = v(all) - v(none) exactly', Object.keys(sh.phi).length === 6 && Math.abs(sum - (sh.full - sh.base)) < 1e-9, Math.abs(sum - (sh.full - sh.base)));
  ok('...the worse shooting and turnovers cost points, an untouched group about nothing', sh.phi.shooting < 0 && sh.phi.turnovers < 0 && Math.abs(sh.phi.tempo) < 1.5,
     Object.entries(sh.phi).map(([k, v]) => k + ' ' + v.toFixed(2)).join(', '));
}
{
  const fx = [{ opp: T[1], home: 1 }, { opp: T[2], home: -1 }, { opp: T[3], home: 1 }];
  const se = Sim.season(T[0], fx, L, { n: 1500, seed: 4, done: 5 });
  ok('season: exact Poisson-binomial over the fixtures to come, played wins fixed', close(se.dist.reduce((s, v) => s + v, 0), 1, 1e-12) && se.dist.length === 4 &&
     close(se.mean, 5 + se.ps.reduce((s, v) => s + v, 0), 1e-12) && se.p10 <= se.p50 && se.p50 <= se.p90 && se.p10 >= 5 && se.p90 <= 8);
  const nm = Sim.season(T[0], fx, L, { sigma: 12, mu: [6, 0, -6], done: 0 });
  ok('...or from Phi(mu / sigma_pred) when the margin model is given', close(nm.ps[0], S.normCdf(0.5), 1e-12) && close(nm.ps[1], 0.5, 1e-12));
}
{
  const own = { timed_s: 1500, timed_n: 100, to_n: 14, chances: 115, to_live: 8, trips_shooting: 9, trips_bonus: 5, rim_a: 30, mid_a: 25, fg3a: 30, fga: 85,
    rim_m: 18, mid_m: 10, fg3m: 11, fgm: 39, and1: 3, ftm: 18, fta: 25, reb_off_ch: 12, reb_def_ch: 30, tr_ch: 14, gain_dreb: 30 };
  const opp = { to_live: 6 };
  const inp = Sim.endInput(own, opp), raw = Sim.ratesOf(inp);
  ok('endInput maps feature counts to the §8.1 rates (boards per missed shot)', close(raw.d, 15, 1e-12) && close(raw.tov, 14 / 115, 1e-12) && close(raw.p2, 28 / 55, 1e-12) &&
     close(raw.orb, 12 / 46, 1e-12) && close(raw.tr, 14 / 36, 1e-12) && close(raw.mix3, 30 / 85, 1e-12));
  const ftc = Object.assign({}, own, { ft_trips: 15, q: 64 | 4 });
  const fi = Sim.endInput(ftc, opp), nonTo = 115 - 14;
  ok('...free throws conserved: shooting trips per non-turnover chance, every other free throw a two-shot trip', close(fi.sfoul.x / fi.sfoul.n, 9 / nonTo, 1e-12) &&
     close((2 + 0.05) * fi.sfoul.x + 2 * fi.bonus.x + 3, 25, 1e-9) && close(fi.orb.n, 46 + 0.12 * 15 * (1 - 18 / 25), 1e-9));
  /* 113 chances = 14 turnovers + (15 trips - and-ones) + 85 FGA: 1 and-one */
  const nk = Sim.endInput(Object.assign({}, ftc, { q: 4, trips_shooting: 0, trips_bonus: 14, and1: 0, chances: 113 }), opp);
  ok('...without the FOULKIND bit: the and-ones from the chance accounting, the other trips split by the league share', close(nk.and1.x, 1, 1e-12) &&
     close(nk.sfoul.x, 14 * 0.625, 1e-9) && close(2.05 * nk.sfoul.x + 2 * nk.bonus.x + 1, 25, 1e-9));
  const nk2 = Sim.endInput(Object.assign({}, ftc, { q: 4, trips_shooting: 0, trips_bonus: 14, and1: 0, chances: NaN }), opp);
  ok('...and without the accounting, 0.05 and-ones a make, the rate left to the league', Number.isNaN(nk2.and1.x) && close(nk2.sfoul.x, (15 - 0.05 * 39) * 0.625, 1e-9));
  const pf = Sim.profile({ off: inp, def: {}, games: 1 }, L);
  ok('profile shrinks (x + k mu) / (n + k): d with k 20 possessions, p3 with k 150 threes; an empty end is the league', close(pf.off.d, (1500 + 20 * L.rates.d) / 120, 1e-12) &&
     close(pf.off.p3, (11 + 150 * L.rates.p3) / 180, 1e-12) && close(pf.def.pRim, L.rates.pRim, 1e-12) && close(pf.off.mixRim + pf.off.mixMid + pf.off.mix3, 1, 1e-12));
}

{
  /* the score effect: pulled toward the expected path, the spread narrows and the favourite's margin stays */
  const M0 = Sim.matchup(T[0], T[1], Object.assign({}, L, { lead: 0, tau: 0 }), { home: 0 }), M1 = Sim.matchup(T[0], T[1], Object.assign({}, L, { lead: 0.12, tau: 0 }), { home: 0 });
  const a = Sim.simulate(M0, { n: 12000, seed: 4 }), b = Sim.simulate(M1, { n: 12000, seed: 4 });
  ok('the score effect (lead 0.12) narrows the margin\'s spread by over 10% and keeps its mean (within 0.6)', b.sd < 0.9 * a.sd && Math.abs(b.mean - a.mean) < 0.6,
     a.sd.toFixed(2) + ' -> ' + b.sd.toFixed(2) + ', mean ' + a.mean.toFixed(2) + ' -> ' + b.mean.toFixed(2));
}

console.log('\ncalibration');
{
  const big = Sim.synth({ teams: 12, games: 500, seed: 21, hca: 0.08, tau: 0.2, kappaN: 1.05, sigmaN: 2, spread: 1 });
  const t0 = performance.now();
  const cal = Sim.calibrate(big.games, Object.assign({}, big.league, { hca: 0, tau: 0, kappaN: 1, sigmaN: 0, dTr: 0 }),
    { seed: 3, fitN: 500, fitSims: 50, evalSims: 400 });
  const dt = performance.now() - t0;
  ok('calibrate recovers the planted home court (0.08)', Math.abs(cal.hca - 0.08) < 0.04, cal.hca.toFixed(3));
  ok('...and the planted form noise tau (0.20)', Math.abs(cal.tau - 0.2) < 0.07, cal.tau.toFixed(3));
  ok('...kappa_N within 3%, the transition bonus found', Math.abs(cal.kappaN / 1.05 - 1) < 0.03 && Math.abs(cal.dTr - 0.3) < 0.2, cal.kappaN.toFixed(3) + ' ' + cal.dTr.toFixed(3));
  const rp = cal.report;
  ok('...validated out of sample: the later 60% of the games, each fold fitted only on earlier games', rp.heldOut === true && rp.nEval === 300 &&
     rp.folds.length === 3 && rp.folds.every((f, k) => f.nFit === 200 + 100 * k && f.nTest === 100) && rp.inSample && Number.isFinite(rp.inSample.brier),
     JSON.stringify(rp.folds.map(f => [f.nFit, f.nTest])));
  ok('...validated: n, Brier, slope near 1, the box checks within reach', rp.brier < 0.25 && rp.slope > 0.7 && rp.slope < 1.4 &&
     Math.abs(rp.checks.ortg.sim - rp.checks.ortg.obs) < 2 && Math.abs(rp.checks.pace.sim - rp.checks.pace.obs) < 1.5,
     'brier ' + rp.brier.toFixed(3) + ' slope ' + rp.slope.toFixed(2) + ' ortg ' + rp.checks.ortg.obs.toFixed(1) + '/' + rp.checks.ortg.sim.toFixed(1) + ' (' + (dt / 1000).toFixed(1) + ' s)');
  ok('...and gated as §8.3 says (n >= 60 and the slope in [0.85, 1.15])', rp.calibrated === (rp.nEval >= 60 && rp.slope >= 0.85 && rp.slope <= 1.15));
  ok('...too tight a simulator gets form noise, not the score effect', cal.lead === 0);
}
{
  /* rolling origin: a fold's parameters never see its own games or later ones. The later games are given an absurd
     possession count; the folds' kappa_N stay near the truth while the all-games fit (for what comes next) moves */
  const lg = Sim.synth({ teams: 10, games: 150, seed: 31, kappaN: 1, sigmaN: 1, spread: 1 });
  const games = lg.games.map((g, i) => Object.assign({}, g, { t: 1000 + i, tally: null }, i >= 60 ? { poss: 3 * g.poss } : {}));
  const cal = Sim.calibrate(games.slice().reverse(), Object.assign({}, lg.league, { kappaN: 1, sigmaN: 0 }),
    { seed: 2, fitSims: 30, evalSims: 40, fitSpread: false, fitHca: false });
  const fk = cal.report.folds;
  ok('rolling origin: no fold is fitted on its own or later games (time order from t, whatever the input order)', fk.length === 3 && fk[0].nFit === 60 &&
     Math.abs(fk[0].kappaN - 1) < 0.1 && fk[1].kappaN > fk[0].kappaN && cal.kappaN > 1.8 && cal.report.nEval === 90,
     fk.map(f => f.nFit + ':' + f.kappaN.toFixed(2)).join(' ') + ' all ' + cal.kappaN.toFixed(2));
  /* the gate scores the Forecast and Elo on the same held-out games when the games carry their pre-game P(win) */
  const withP = games.map(g => Object.assign({}, g, { pF: 0.5, pE: 0.5, poss: g.poss }));
  const c2 = Sim.calibrate(withP, Object.assign({}, lg.league), { seed: 2, fitSims: 20, evalSims: 30, fitSpread: false, fitHca: false, folds: 1, holdFrom: 0.7 });
  ok('...the gate\'s Forecast and Elo Briers come from the same held-out games (0.25 for a coin)', c2.report.compare && c2.report.compare.forecast === 0.25 && c2.report.compare.elo === 0.25 &&
     c2.report.nEval === 45, JSON.stringify(c2.report.compare));
}
{
  /* R2S-3: the feed's bonus trips already hold the late-game fouls, and end-game fouling adds a trip on each fouled
     possession. Profiles measured from the games' own tallies (as the builder's are, from the feed) double count them
     with fouling on; calibrate's trip offset takes them back out, and a FT rate more than a point off fails the gate */
  const lg = Sim.synth({ teams: 10, games: 200, seed: 51, tau: 0.1, spread: 0.8, fouling: true });
  const sumT = (acc, t) => { for (const k of Sim.TALLY) acc[k] = (acc[k] || 0) + (t[k] || 0); };
  const own = lg.profiles.map(() => ({})), opp = lg.profiles.map(() => ({})), all = {};
  lg.games.forEach(g => { sumT(own[g.a], g.tally[0]); sumT(opp[g.a], g.tally[1]); sumT(own[g.b], g.tally[1]); sumT(opp[g.b], g.tally[0]); sumT(all, g.tally[0]); sumT(all, g.tally[1]); });
  const rates = Sim.ratesOf(Sim.endInput(all, all, { foulKinds: true }));
  const prof = lg.profiles.map((_, t) => Sim.profile({ off: Sim.endInput(own[t], opp[t], { foulKinds: true }), def: Sim.endInput(opp[t], own[t], { foulKinds: true }), games: 40 }, { rates }));
  const games = lg.games.map(g => Object.assign({}, g, { A: prof[g.a], B: prof[g.b] }));
  const L = Object.assign({}, lg.league, { rates, hca: 0, tau: 0, lead: 0, dTr: 0, kappaN: 1, sigmaN: 0 });
  const opt = { seed: 3, fitN: 200, fitSims: 40, evalSims: 80, fitSpread: false };
  const on = Sim.calibrate(games, L, opt), off = Sim.calibrate(games, L, Object.assign({ fitBonus: false }, opt));
  const gap = c => c.report.checks.ftr.sim - c.report.checks.ftr.obs;
  ok('end-game fouling without the trip offset shoots too many free throws (the double count), and the gate says so',
     off.fouling && gap(off) > 1.5 && off.report.ftrOk === false && !off.report.calibrated, 'FTA/FGA +' + gap(off).toFixed(2));
  ok('...the trip offset takes the late-game trips back out of the trip rates: held-out FT rate within a point',
     on.fouling && on.tripOff < -0.05 && Math.abs(gap(on)) <= 1 && on.report.ftrOk === true, 'tripOff ' + on.tripOff.toFixed(3) + ', FTA/FGA ' + gap(on).toFixed(2));
  const M0 = Sim.matchup(prof[0], prof[1], L), M1 = Sim.matchup(prof[0], prof[1], Object.assign({}, L, { tripOff: on.tripOff }));
  ok('...and matchup applies it to the foul trips only', M1.r[0].bonus < M0.r[0].bonus && M1.r[0].sfoul < M0.r[0].sfoul && M1.r[0].p3 === M0.r[0].p3 && M1.r[0].tov === M0.r[0].tov && M1.L.tripOff === on.tripOff);
}
{
  /* Platt scaling (R2S-1): fitted only with the gate's 60 held-out games, and with no intercept: the held-out games are
     all in the home side's view, so an intercept would carry the home court onto whichever side the reader picks as A */
  const runP = G => {
    const lg = Sim.synth({ teams: 10, games: G, seed: 41, tau: 0.5, kappaN: 1, sigmaN: 1, spread: 0.6 });
    return Sim.calibrate(lg.games, Object.assign({}, lg.league, { tau: 0, lead: 0 }), { seed: 4, fitSims: 20, evalSims: 60, fitSpread: false, fitHca: false });
  };
  const c90 = runP(150), c57 = runP(95);
  ok('Platt: a simulator too sure of itself (form noise held at 0) with 90 held-out games gets a map with no intercept',
     c90.report.nEval === 90 && !!c90.platt && c90.platt.a === 0 && c90.platt.b > 0 && c90.platt.b < 1, JSON.stringify(c90.platt) + ' n ' + c90.report.nEval);
  ok('...and none below the gate\'s 60 held-out games, whatever the slope', c57.report.nEval < 60 && c57.platt === null && !c57.report.calibrated,
     JSON.stringify(c57.platt) + ' n ' + c57.report.nEval);
  const sy = Sim.synth({ teams: 4, games: 8, seed: 2, spread: 1.5 }), A = sy.profiles;
  const pAB = Sim.simulate(Sim.matchup(A[0], A[1], sy.league, { platt: c90.platt }), { n: 3000, seed: 1 }).pWin;
  const pBA = Sim.simulate(Sim.matchup(A[1], A[0], sy.league, { platt: c90.platt }), { n: 3000, seed: 2 }).pWin;
  ok('...so on a neutral court P(A beats B) + P(B beats A) stays near 1 through the map', Math.abs(pAB + pBA - 1) < 0.05, (pAB + pBA).toFixed(3));
}
{
  const tight = Sim.synth({ teams: 12, games: 400, seed: 8, hca: 0.06, tau: 0, lead: 0.12, spread: 1 });
  const cal = Sim.calibrate(tight.games, Object.assign({}, tight.league, { hca: 0, tau: 0, lead: 0, dTr: 0 }), { seed: 5, fitN: 400, fitSims: 50, evalSims: 60 });
  ok('calibrate recovers a planted score effect (lead 0.12) with no form noise', Math.abs(cal.lead - 0.12) < 0.05 && cal.tau === 0, cal.lead.toFixed(3));
}

console.log('\nthe worker');
{
  const src = read('winsim.worker.js');
  ok('the worker loads winstats.js and winsim.js with its own ?v= (§8.5)', /importScripts\('winstats\.js\?v=' \+ v, 'winsim\.js\?v=' \+ v\)/.test(src));
  const posted = [], loaded = [];
  const wsb = {
    console, performance, setTimeout, module: undefined,
    location: { href: 'https://example.test/epinoia/winsim.worker.js?v=571', search: '?v=571' },
    postMessage: m => posted.push(JSON.parse(JSON.stringify(m))),
    importScripts: (...urls) => urls.forEach(u => { loaded.push(u); vm.runInContext(read(u.replace(/\?.*$/, '')), wctx, { filename: u }); })
  };
  wsb.self = wsb; wsb.globalThis = wsb;
  const wctx = vm.createContext(wsb);
  vm.runInContext(src, wctx, { filename: 'winsim.worker.js' });
  ok('...here ?v=571 for both', loaded.join() === 'winstats.js?v=571,winsim.js?v=571', loaded.join());
  const until = (pred, ms = 20000) => new Promise((res, rej) => { const t0 = Date.now(); const tick = () => pred() ? res() : Date.now() - t0 > ms ? rej(new Error('timeout')) : setTimeout(tick, 5); tick(); });
  const M = Sim.matchup(T[0], T[1], L, { home: 1 });
  wsb.onmessage({ data: { id: 1, op: 'simulate', args: [JSON.parse(JSON.stringify(M)), { n: 12000, seed: 77 }] } });
  await until(() => posted.some(m => m.id === 1 && 'ok' in m));
  const res = posted.find(m => m.id === 1 && 'ok' in m), prog = posted.filter(m => m.id === 1 && 'progress' in m).map(m => m.progress);
  const direct = Sim.simulate(M, { n: 12000, seed: 77 });
  ok('simulate: {id, progress} while it works, then {id, ok: true, result} equal to the direct call', res.ok && prog.length >= 2 &&
     prog.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= prog[i - 1])) && close(res.result.pWin, direct.pWin, 1e-12) && res.result.n === 12000, prog.length + ' progress messages');
  wsb.onmessage({ data: { id: 2, op: 'shapley', args: { Mexp: M, Mplayed: M, n: 3000, seed: 1 } } });
  wsb.onmessage({ data: { id: 2, op: 'cancel' } });
  await until(() => posted.some(m => m.id === 2 && 'ok' in m));
  const can = posted.find(m => m.id === 2 && 'ok' in m);
  ok('cancel: {op: cancel, id} stops a long job with {ok: false, error: cancelled}', can.ok === false && can.error === 'cancelled');
  wsb.onmessage({ data: { id: 3, op: 'nonsense', args: [] } });
  ok('an unknown op answers {ok: false, error}', posted.some(m => m.id === 3 && m.ok === false && /unknown op/.test(m.error)));
  /* refit from block statistics: the file's blocks, a column subset, the unit's lambda and scale */
  const rr = S.rng(5), blocks = [];
  for (let b = 0; b < 16; b++) {
    const X = [], y = [];
    for (let i = 0; i < 12; i++) { const h = i % 2, a = S.normal(rr), c = S.normal(rr), d = S.normal(rr); X.push([h, a, c, d]); y.push(0.5 * h + 1.5 * a - c + 2 * S.normal(rr)); }
    const s = S.suff(X, y);
    blocks.push({ n: s.n, sw: s.sw, xx: Array.from(s.xx), xy: Array.from(s.xy), yy: s.yy, sy: s.sy });
  }
  const file = { keys: ['h', 'efg', 'tovp', 'orebp'], scale: [0, 1, 1, 1], lambda: 0.01, list: blocks };
  wsb.onmessage({ data: { id: 4, op: 'refit', args: { blocks: file, cols: ['h', 'efg', 'tovp'], lambda: 0.01, scale: file.scale } } });
  await until(() => posted.some(m => m.id === 4 && 'ok' in m));
  const rf = posted.find(m => m.id === 4 && 'ok' in m);
  const ref = S.ridge(S.pick(S.sumSuff(blocks.map(b => Object.assign({}, b, { xx: Float64Array.from(b.xx), xy: Float64Array.from(b.xy) }))), [0, 1, 2]), { lambda: 0.01, pen: [0, 1, 1] });
  ok('refit: {blocks, cols, lambda, scale} -> {b, lo, hi} (B 200), b = the ridge on the summed blocks', rf.ok && rf.result.b.length === 3 &&
     rf.result.b.every((v, i) => close(v, ref.b[i], 1e-9)) && rf.result.lo.every((v, i) => v < rf.result.b[i] && rf.result.b[i] < rf.result.hi[i]) &&
     rf.result.keys.join() === 'h,efg,tovp');
  const t0 = performance.now();
  S.run(Sim.refitSteps({ blocks: file, cols: [0, 1, 2, 3] }));
  const dt = performance.now() - t0;
  ok('...a re-fit with its bootstrap in under 250 ms', dt < 250, dt.toFixed(0) + ' ms');
  let ticks = 0;
  const p = Sim.drive(Sim.steps('simulate', { M, n: 4000, seed: 1 }), { slice: 5, onProgress: () => ticks++ });
  const r = await p;
  ok('drive(): the same slices on the main thread (no Worker), progress after each', r.n === 4000 && ticks >= 2, ticks + ' slices');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
