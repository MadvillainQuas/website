/* ============================================================================
   WHAT WINS: THE STATISTICS (epinoia/winstats.js), with no browser.

     node supabase/tests/ww-winstats.test.mjs

   What is held here (docs/what-wins-model.md §16, WP2):
     * the solvers agree: Cholesky ridge at lambda 0 = EpinoiaWinning.ols (the page's old least squares) =
       Gauss-Jordan, to 1e-9; a ridge with a prior tends to the prior as lambda grows;
     * block statistics sum to the row statistics, and a fit recovers planted coefficients within 3 SE;
     * the block bootstrap and the CR1 cluster covariance cover a planted slope 92-98% of the time over 200
       replications; Wilson covers 93-97%; Wilson(8, 10) = [0.490, 0.943];
     * the logistic fit equals the 2 x 2 table's maximum likelihood, and complete separation is flagged;
     * VIF at r = 0.96 is 12.76; Shapley R^2 sums exactly and splits a duplicated column equally;
     * DerSimonian-Laird and Benjamini-Hochberg on hand examples; the EB posterior's limits;
     * the normal CDF to 1e-12 and its inverse round trip to 1e-10; a calibrated forecast has slope 1 and ECE < 0.02;
     * valueScale turns 2 points into 1.98551 wins over 30 at sigma 12, and refuses sigma_acc (I9);
     * the Oaxaca split is exact; the spline logistic is within 0.02 of the truth; bins keep their minimum;
     * a 35,000 x 40 Gram matrix takes under a second; niceTicks is chartlab's.
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
/* the page's way in: a browser-like global, no module */
const sandbox = { console, module: undefined, performance };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['winning.js', 'winstats.js', 'chartlab.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia', f), 'utf8'), ctx, { filename: f });
const S = sandbox.EpinoiaWinStats, Win = sandbox.EpinoiaWinning, Chart = sandbox.EpinoiaChartLab;
ok('winstats.js loads as window.EpinoiaWinStats with the §14 names', !!S && ['normCdf', 'normPdf', 'normInv', 'logit', 'expit', 'rng',
  'normal', 'hash', 'chol', 'cholSolve', 'invSPD', 'gaussJordan', 'suff', 'addSuff', 'subSuff', 'pick', 'ridge', 'cvLambda',
  'clusterCov', 'blockBootstrap', 'logistic', 'corrFromSuff', 'vif', 'condNumber', 'shapleyR2', 'dersimonianLaird', 'ebPosterior',
  'wilson', 'fisherCI', 'fisherP', 'bh', 'welchCI', 'icc', 'pointBiserial', 'bins', 'quantile', 'nsBasis', 'gamLogit', 'calibration',
  'valueScale', 'winsOver', 'oaxaca', 'golden', 'bisect', 'niceTicks'].every(k => typeof S[k] === 'function'));
const SC = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'epinoia', 'winstats.js'));
ok('...and as a CommonJS module in node (the builder\'s way in)', typeof SC.ridge === 'function' && SC.normCdf(0) === 0.5);

const R = S.rng(20261001), N = () => S.normal(R);
const close = (a, b, t) => Math.abs(a - b) <= t;

console.log('\nthe normal, the random numbers, the hash');
{
  /* reference values: 0.5 erfc(-x / sqrt 2) from CPython's libm (an independent implementation) */
  const known = [[0, 0.5], [1, 0.8413447460685429], [-1, 0.15865525393145707], [1.96, 0.9750021048517795], [-3, 0.0013498980316300957],
    [0.5, 0.6914624612740131], [-0.67448975, 0.2500000000623102], [3.5, 0.9997673709209645], [-6, 9.865876450377012e-10],
    [-8, 6.220960574271819e-16], [5.7, 0.9999999940096286], [-10, 7.619853024160593e-24], [2.2, 0.9860965524865014]];
  const err = Math.max(...known.map(([x, p]) => Math.abs(S.normCdf(x) - p)));
  ok('normCdf within 1e-12 of known values across its three ranges', err < 1e-12, err);
  let rt = 0;
  for (let x = -8; x <= 4; x += 0.0037) rt = Math.max(rt, Math.abs(S.normInv(S.normCdf(x)) - x));
  let rp = 0;
  for (let p = 1e-6; p < 1; p += 0.00731) rp = Math.max(rp, Math.abs(S.normCdf(S.normInv(p)) - p));
  ok('normCdf / normInv round trip within 1e-10 (x in [-8, 4], p in (0, 1))', rt < 1e-10 && rp < 1e-10, rt + ' ' + rp);
  ok('normInv(0.975) = 1.959963984540054; the pdf at 0 is 1 / sqrt(2 pi)', close(S.normInv(0.975), 1.959963984540054, 1e-14) &&
     close(S.normPdf(0), 1 / Math.sqrt(2 * Math.PI), 1e-16));
  ok('logit and expit are inverses, expit stable far out', close(S.expit(S.logit(0.123)), 0.123, 1e-15) && S.expit(-800) === 0 && S.expit(800) === 1);
  const a = S.rng(42), b = S.rng(42), xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
  ok('mulberry32: the same seed gives the same stream, in [0, 1)', xs.join() === ys.join() && xs.every(v => v >= 0 && v < 1));
  const r1 = S.rng(1);
  ok('mulberry32(1) starts 0.6270739405881613 (the reference sequence)', close(r1(), 0.6270739405881613, 1e-16));
  let m = 0, v = 0;
  const zr = S.rng(9), Z = 40000;
  for (let i = 0; i < Z; i++) { const z = S.normal(zr); m += z; v += z * z; }
  ok('normal(): mean 0 and variance 1 over 40,000 draws', Math.abs(m / Z) < 0.02 && Math.abs(v / Z - 1) < 0.03, (m / Z).toFixed(4) + ' ' + (v / Z).toFixed(4));
  ok('FNV-1a: "" = 0x811c9dc5, "a" = 0xe40c292c, "foobar" = 0xbf9cf968', S.hash('') === 0x811c9dc5 && S.hash('a') === 0xe40c292c && S.hash('foobar') === 0xbf9cf968);
}

console.log('\nthe solvers agree');
const rowsXY = (n, beta, sdE, extra) => {
  const X = [], y = [];
  for (let i = 0; i < n; i++) {
    const row = beta.map((_, j) => (j === 0 ? 1 : N() * (1 + j / 3)));
    if (extra) extra(row, i);
    X.push(row); y.push(row.reduce((s, x, j) => s + x * beta[j], 0) + sdE * N());
  }
  return { X, y };
}
{
  const beta = [2, 1.5, -0.7, 0.3];
  const { X, y } = rowsXY(300, beta, 2);
  const fit = S.ridge(S.suff(X, y), { lambda: 0 });
  const old = Win.ols(X.map(r => r.slice(1)), y);
  const A = S.full(S.suff(X, y).xx, 4), gj = S.gaussJordan(A, S.suff(X, y).xy, 4);
  const d1 = Math.max(...fit.b.map((b, i) => Math.abs(b - old.b[i]))), d2 = Math.max(...fit.b.map((b, i) => Math.abs(b - gj[i])));
  ok('ridge at lambda 0 (Cholesky) = EpinoiaWinning.ols = Gauss-Jordan, to 1e-9', d1 < 1e-9 && d2 < 1e-9, d1.toExponential(2) + ' ' + d2.toExponential(2));
  ok('...and the same R^2 as the old fit', close(fit.r2, old.r2, 1e-9), fit.r2.toFixed(6) + ' ' + old.r2.toFixed(6));
  const inv = S.invSPD(A, 4);
  let e = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += A[i * 4 + k] * inv[k * 4 + j]; e = Math.max(e, Math.abs(s - (i === j ? 1 : 0))); }
  ok('invSPD: A A^-1 = I', e < 1e-9, e);
  const sing = S.chol([[1, 2], [2, 4]], 2);
  ok('Cholesky of a singular matrix retries with jitter (or refuses), never a NaN', sing === null || (sing.jitter > 0 && Array.from(sing).every(Number.isFinite)));
  const prior = [5, -5, 5, -5], pen = [0, 1, 1, 1], S0 = S.suff(X, y);
  const big = S.ridge(S0, { lambda: 1e9, pen: [1, 1, 1, 1], prior });
  ok('ridge with a prior: lambda -> infinity gives the prior', big.b.every((b, i) => close(b, prior[i], 1e-5)), big.b.map(b => b.toFixed(5)).join());
  const mid = S.ridge(S0, { lambda: 0.5, pen, prior: [0, 0, 0, 0] });
  ok('...and an unpenalised column (pen 0) is not pulled toward it', Math.abs(mid.b[0] - fit.b[0]) < 0.5 && Math.abs(mid.b[1]) < Math.abs(fit.b[1]));
  ok('...degrees of freedom fall from p as lambda grows', close(fit.df, 4, 1e-9) && mid.df < 4 && mid.df > 1, mid.df.toFixed(3));
}

console.log('\nblocks');
{
  const { X, y } = rowsXY(240, [1, 2, -1], 1);
  const w = y.map((_, i) => 1 + (i % 3));
  const all = S.suff(X, y, w);
  const blocks = [];
  for (let b = 0; b < 12; b++) blocks.push(S.suff(X.slice(b * 20, b * 20 + 20), y.slice(b * 20, b * 20 + 20), w.slice(b * 20, b * 20 + 20)));
  const tot = blocks.reduce((a, b) => S.addSuff(a, b));
  const dif = Math.max(...Array.from(all.xx).map((v, i) => Math.abs(v - tot.xx[i])), ...Array.from(all.xy).map((v, i) => Math.abs(v - tot.xy[i])),
    Math.abs(all.yy - tot.yy), Math.abs(all.sy - tot.sy), Math.abs(all.sw - tot.sw));
  ok('block statistics add up to the row statistics (weighted)', dif < 1e-9 && tot.n === 240, dif);
  const back = S.subSuff(tot, blocks[3]);
  const direct = S.suff(X.filter((_, i) => i < 60 || i >= 80), y.filter((_, i) => i < 60 || i >= 80), w.filter((_, i) => i < 60 || i >= 80));
  ok('...and subtract exactly (a fold\'s training set)', Math.max(...Array.from(back.xx).map((v, i) => Math.abs(v - direct.xx[i]))) < 1e-9 && back.n === 220);
  const pk = S.pick(all, [2, 0]);
  const direct2 = S.suff(X.map(r => [r[2], r[0]]), y, w);
  ok('pick: the statistics of a column subset, in the order asked', Array.from(pk.xx).every((v, i) => close(v, direct2.xx[i], 1e-9)) &&
     Array.from(pk.xy).every((v, i) => close(v, direct2.xy[i], 1e-9)));
  const cv = S.cvLambda(blocks, { pen: [0, 1, 1] });
  ok('cvLambda: a lambda in [1e-4, 10] by golden section over 5 block folds, with its path', cv.lambda >= 1e-4 && cv.lambda <= 10 &&
     cv.path.length > 5 && cv.mse <= Math.min(...cv.path.map(p => p[1])) + 1e-12, cv.lambda.toExponential(2));
}
{
  const beta = [0.3, 1.2, -0.8, 0.5];
  const { X, y } = rowsXY(2000, beta, 3);
  const fit = S.ridge(S.suff(X, y));
  const se = fit.b.map((_, i) => Math.sqrt(fit.sigma2 * fit.Ainv[i * 4 + i]));
  ok('recovery: every planted coefficient within 3 SE', fit.b.every((b, i) => Math.abs(b - beta[i]) < 3 * se[i]),
     fit.b.map((b, i) => ((b - beta[i]) / se[i]).toFixed(2)).join());
}

console.log('\nintervals that cover');
{
  /* 60 blocks of 15 games, the x and the error both shared within a block: the iid SE is too small, CR1 and the block
     bootstrap must not be */
  let covB = 0, covC = 0, covN = 0;
  const reps = 200, G = 60, m = 15, beta = [1, 2], rr = S.rng(777);
  const nz = () => S.normal(rr);
  for (let rep = 0; rep < reps; rep++) {
    const blocks = [];
    for (let g = 0; g < G; g++) {
      const ux = nz(), ue = 1.5 * nz(), X = [], y = [];
      for (let i = 0; i < m; i++) { const x = 0.7 * ux + 0.7 * nz(); X.push([1, x]); y.push(beta[0] + beta[1] * x + ue * (1 + 0.5 * x * x) * 0.6 + nz()); }
      blocks.push(S.suff(X, y));
    }
    const fit = S.ridge(S.sumSuff(blocks));
    const V = S.clusterCov(blocks, fit), se = Math.sqrt(V[3]);
    if (Math.abs(fit.b[1] - beta[1]) <= 1.959964 * se) covC++;
    const iid = Math.sqrt(fit.sigma2 * fit.Ainv[3]);
    if (Math.abs(fit.b[1] - beta[1]) <= 1.959964 * iid) covN++;
    const bs = S.blockBootstrap(blocks, s => { const f = S.ridge(s); return f ? f.b : null; }, { B: 400, seed: 1000 + rep });
    if (bs.lo[1] <= beta[1] && beta[1] <= bs.hi[1]) covB++;
  }
  ok('block bootstrap (B 400, percentile) covers the slope in [0.92, 0.98] of 200 replications', covB / reps >= 0.92 && covB / reps <= 0.98, covB / reps);
  ok('CR1 by block covers it in [0.92, 0.98]', covC / reps >= 0.92 && covC / reps <= 0.98, covC / reps);
  ok('...where the iid interval does not (it ignores the blocks)', covN / reps < covC / reps, covN / reps);
}
{
  let hit = 0, tot = 0;
  const wr = S.rng(31);
  for (const p of [0.1, 0.3, 0.5, 0.7]) for (const n of [20, 50, 200]) for (let r = 0; r < 1500; r++) {
    let k = 0;
    for (let i = 0; i < n; i++) if (wr() < p) k++;
    const [lo, hi] = S.wilson(k, n);
    if (lo <= p && p <= hi) hit++;
    tot++;
  }
  ok('Wilson covers in [0.93, 0.97] (n 20-200, p 0.1-0.7)', hit / tot >= 0.93 && hit / tot <= 0.97, (hit / tot).toFixed(4));
  const w = S.wilson(8, 10);
  ok('Wilson(8, 10) = [0.490, 0.943]', close(w[0], 0.490, 5e-4) && close(w[1], 0.943, 5e-4), w.map(v => v.toFixed(4)).join());
  ok('...an empty sample is [0, 1]', S.wilson(0, 0).join() === '0,1');
}

console.log('\nthe logistic fit');
{
  const X = [], y = [];
  for (let i = 0; i < 100; i++) { X.push([1, 0]); y.push(i < 30 ? 1 : 0); }
  for (let i = 0; i < 80; i++) { X.push([1, 1]); y.push(i < 60 ? 1 : 0); }
  const f = S.logistic(X, y);
  const b0 = Math.log(0.3 / 0.7), b1 = Math.log(0.75 / 0.25) - b0;
  ok('the 2 x 2 table: intercept logit(0.30), slope logit(0.75) - logit(0.30)', f.converged && close(f.b[0], b0, 1e-7) && close(f.b[1], b1, 1e-7) && !f.separated,
     f.b.map(v => v.toFixed(6)).join());
  const se1 = Math.sqrt(1 / 30 + 1 / 70 + 1 / 60 + 1 / 20);
  ok('...its SE of the log odds ratio is sqrt(1/a + 1/b + 1/c + 1/d)', close(Math.sqrt(f.cov[3]), se1, 1e-6), Math.sqrt(f.cov[3]).toFixed(6));
  const wf = S.logistic([[1, 0], [1, 0], [1, 1], [1, 1]], [1, 0, 1, 0], { w: [30, 70, 60, 20] });
  ok('...the same fit from weighted rows', close(wf.b[0], b0, 1e-7) && close(wf.b[1], b1, 1e-7));
  const sep = S.logistic([[1, -2], [1, -1], [1, -0.5], [1, 0.5], [1, 1], [1, 2]], [0, 0, 0, 1, 1, 1]);
  ok('complete separation is flagged', sep.separated === true);
  const pen = S.logistic([[1, -2], [1, -1], [1, -0.5], [1, 0.5], [1, 1], [1, 2]], [0, 0, 0, 1, 1, 1], { lambda: 0.1, pen: [0, 1] });
  ok('...and a ridge penalty gives it a finite answer', pen.converged && Number.isFinite(pen.b[1]) && pen.b[1] > 0 && !pen.separated, pen.b[1].toFixed(3));
  const off = S.logistic(X.map(r => [r[1]]), y, { offset: X.map(() => b0) });
  ok('an offset is held fixed (the slope alone recovers the log odds ratio)', close(off.b[0], b1, 1e-6));
}

console.log('\ncollinearity and importance');
{
  /* x2 = 0.96 x1 + 0.28 z, z orthogonal to x1, both scaled to unit SD: r = 0.96 exactly */
  const n = 2000, x1 = [], z0 = [];
  for (let i = 0; i < n; i++) { x1.push(N()); z0.push(N()); }
  const cen = a => { const m = a.reduce((s, v) => s + v, 0) / n; return a.map(v => v - m); };
  const sc = a => { const s = Math.sqrt(a.reduce((t, v) => t + v * v, 0) / n); return a.map(v => v / s); };
  const a1 = sc(cen(x1));
  let z = cen(z0);
  const pr = z.reduce((s, v, i) => s + v * a1[i], 0) / n;
  z = sc(z.map((v, i) => v - pr * a1[i]));
  const a2 = a1.map((v, i) => 0.96 * v + Math.sqrt(1 - 0.96 * 0.96) * z[i]);
  const a3 = a1.map(() => N());
  const St = S.suff(a1.map((v, i) => [v, a2[i], a3[i]]), a1.map(() => N()));
  const Rm = S.corrFromSuff(St), V = S.vif(Rm, 3);
  ok('r = 0.96 between two columns: their VIF is 12.76 (within 2%)', Math.abs(V[0] / 12.755 - 1) < 0.02 && Math.abs(V[1] / 12.755 - 1) < 0.02, V.map(v => v.toFixed(3)).join());
  ok('...the unrelated column\'s about 1, the condition number large', V[2] < 1.1 && S.condNumber(Rm, 3) > 6, S.condNumber(Rm, 3).toFixed(2));
}
{
  const n = 800, X = [], y = [];
  for (let i = 0; i < n; i++) {
    const h = i % 2 ? 1 : 0, a = N(), b = 0.5 * a + N(), c = N(), d = c;   // d duplicates c
    X.push([h, a, b, c, d]); y.push(0.4 * h + 2 * a + 1 * b + 0.8 * c + 3 * N());
  }
  const St = S.suff(X, y);
  const sh = S.shapleyR2(St, [[1], [2], [3], [4]], { force: [0] });
  const sum = sh.phi.reduce((s, v) => s + v, 0);
  ok('Shapley R^2: the shares sum to v(all) to 1e-10', Math.abs(sum - sh.total) < 1e-10, Math.abs(sum - sh.total));
  ok('...v(all) = R^2(h + all) - R^2(h)', close(sh.total, S.ridge(St).r2 - S.ridge(S.pick(St, [0])).r2, 1e-6));
  ok('...a duplicated column splits its share equally', Math.abs(sh.phi[2] - sh.phi[3]) < 1e-10 && sh.phi[2] > 0, sh.phi[2].toFixed(5) + ' ' + sh.phi[3].toFixed(5));
  const g2 = S.shapleyR2(St, [[1, 2], [3, 4]], { force: [0] });
  ok('...groups of columns work the same way', Math.abs(g2.phi[0] + g2.phi[1] - g2.total) < 1e-10 && g2.phi[0] > g2.phi[1]);
}

console.log('\npooling and multiplicity');
{
  const t = S.dersimonianLaird([{ b: 0, v: 1 }, { b: 2, v: 0.5 }, { b: 4, v: 0.25 }]);
  ok('DerSimonian-Laird on a hand example: Q = 104/7, tau^2 = 45/14', close(t, 45 / 14, 1e-12), t);
  ok('...homogeneous estimates give tau^2 = 0; one league gives 0', S.dersimonianLaird([{ b: 1, v: 1 }, { b: 2, v: 1 }, { b: 3, v: 1 }]) === 0 &&
     S.dersimonianLaird([{ b: 1, v: 1 }]) === 0);
  const far = S.ebPosterior(3, 1e12, 1, 0.5), near = S.ebPosterior(3, 1e-12, 1, 0.5), half = S.ebPosterior(3, 0.5, 1, 0.5);
  ok('EB: V -> infinity gives the pooled value (w -> 1); V -> 0 its own (w -> 0); equal variances half-way', close(far.b, 1, 1e-9) && far.w > 0.999999 &&
     close(near.b, 3, 1e-9) && near.w < 1e-9 && close(half.b, 2, 1e-12) && close(half.w, 0.5, 1e-12));
  const vec = S.ebPosterior([3, -1], [[1e12, 0], [0, 1e-12]], [1, 1], [0.5, 0.5]);
  ok('...per coefficient in the matrix form', close(vec.b[0], 1, 1e-6) && close(vec.b[1], -1, 1e-6) && vec.w[0] > 0.999 && vec.w[1] < 1e-6);
  const q = S.bh([0.01, 0.04, 0.03, 0.005]);
  ok('Benjamini-Hochberg on a hand example: [0.02, 0.04, 0.04, 0.02]', q.every((v, i) => close(v, [0.02, 0.04, 0.04, 0.02][i], 1e-12)), q.join());
  ok('...a missing p stays missing', S.bh([0.5, null, 0.01])[1] === null);
  const fc = S.fisherCI(0.3, 103);
  ok('Fisher interval of r = 0.3, n 103: tanh(atanh 0.3 -/+ 1.96 / 10)', close(fc[0], Math.tanh(Math.atanh(0.3) - 0.1959964), 1e-6) &&
     close(fc[1], Math.tanh(Math.atanh(0.3) + 0.1959964), 1e-6) && close(S.fisherP(0.3, 103), 2 * S.normCdf(-Math.atanh(0.3) * 10), 1e-12));
  const wl = S.welchCI(10, 4, 20, 8, 9, 30);
  ok('Welch: the difference, its Satterthwaite df and a t interval', close(wl.d, 2, 1e-12) && close(wl.df, 0.25 / (0.04 / 19 + 0.09 / 29), 1e-9) && wl.lo < 2 && wl.hi > 2 &&
     close(wl.hi - wl.d, S.tInv(0.975, wl.df) * wl.se, 1e-9), wl.df.toFixed(2));
  ok('t, F and chi-square tails: t(0.975, 10) = 2.228139, F(1, 10) at 4.9646 = 0.05, chi2(1) at 3.8415 = 0.05', close(S.tInv(0.975, 10), 2.228138852, 1e-8) &&
     close(S.fP(4.964602743730711, 1, 10), 0.05, 1e-9) && close(S.chi2P(3.841458820694124, 1), 0.05, 1e-9));
  const groups = [[1, 1, 1], [5, 5, 5], [9, 9, 9]];
  ok('ICC: identical within blocks is 1, no block effect about 0', close(S.icc(groups), 1, 1e-12) && Math.abs(S.icc([[1, 5, 9], [1, 5, 9], [9, 5, 1]])) < 0.6);
}
{
  /* games in weeks; x and the result both share a week effect, so n_eff < n */
  const x = [], w = [], blocks = [];
  for (let b = 0; b < 30; b++) {
    const ex = N(), ew = N();
    for (let i = 0; i < 10; i++) { const xi = ex + N(); x.push(xi); w.push(0.6 * xi + ew + N() > 0 ? 1 : 0); blocks.push(b); }
  }
  const pb = S.pointBiserial(x, w, { blocks }), plain = S.pointBiserial(x, w);
  ok('point-biserial: r and a Fisher interval; blocks with a shared effect give DEFF > 1 and a wider interval', pb.r > 0.2 && pb.deff > 1 &&
     pb.nEff < pb.n && pb.hi - pb.lo > plain.hi - plain.lo && close(plain.r, pb.r, 1e-12), pb.deff.toFixed(3));
  const flip = S.pointBiserial(x, w, { dir: -1 });
  ok('...dir -1 flips the sign (fewer is better)', close(flip.r, -plain.r, 1e-12));
}

console.log('\ncalibration, value, the split of a result');
{
  const cr = S.rng(5), p = [], y = [];
  for (let i = 0; i < 20000; i++) { const pi = 0.05 + 0.9 * cr(); p.push(pi); y.push(cr() < pi ? 1 : 0); }
  const c = S.calibration(p, y);
  ok('a calibrated synthetic forecast: slope 1 +/- 0.05, intercept about 0, ECE < 0.02', Math.abs(c.slope - 1) < 0.05 && Math.abs(c.intercept) < 0.05 && c.ece < 0.02,
     c.slope.toFixed(3) + ' ' + c.ece.toFixed(4));
  ok('...Brier, log loss, AUC sensible; 10 equal-count bins', c.brier > 0.15 && c.brier < 0.25 && c.logloss > 0.45 && c.logloss < 0.7 && c.auc > 0.7 && c.bins.length === 10 &&
     c.bins.every(b => b[2] === 2000), [c.brier, c.logloss, c.auc].map(v => v.toFixed(3)).join());
  const over = S.calibration(p.map(v => S.expit(2 * S.logit(v))), y);
  ok('...an over-confident one has slope about 0.5', Math.abs(over.slope - 0.5) < 0.05, over.slope.toFixed(3));
  ok('AUC of a perfect ranking is 1, of ties 0.5', S.calibration([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]).auc === 1 && S.auc([0.5, 0.5], [0, 1]) === 0.5);
}
{
  const v = S.valueScale({ b: 1, sdTeam: 2, sigma: 12, G: 30 });
  ok('valueScale({b: 1, sdTeam: 2, sigma: 12, G: 30}) = 2 points, 1.98551 wins', v && close(v.pts, 2, 1e-12) && close(v.wins, 1.98551, 1e-4), v && v.wins);
  ok('...null for sigma 5 with sigmaAcc 4 (points into wins need sigma_pred, I9)', S.valueScale({ b: 1, sdTeam: 2, sigma: 5, G: 30, sigmaAcc: 4 }) === null);
  ok('...sdTeam as {off, def, net} takes net; wins30 over 30 games', close(S.valueScale({ b: 0.5, sdTeam: { off: 1, def: 1, net: 4 }, sigma: 12, G: 20, sigmaAcc: 4 }).wins30,
     30 * (S.normCdf(2 / 12) - 0.5), 1e-12));
  ok('winsOver: the sum over fixtures of Phi((mu + d) / s) - Phi(mu / s)', close(S.winsOver([0, 5, -3], 2, 12),
     [0, 5, -3].reduce((s, m) => s + S.normCdf((m + 2) / 12) - S.normCdf(m / 12), 0), 1e-15));
}
{
  let worst = 0, worstQ = 0;
  for (let i = 0; i < 50; i++) {
    const beta = { c_efg: 1.1 + N() * 0.1, c_tovp: -1.1, c_orebp: 0.4, c_ftmr: 0.3 }, dx = {}, ex = {};
    for (const k in beta) { dx[k] = N() * 6; ex[k] = N() * 2; }
    const y = Math.round(N() * 14), yc = y - Math.round(N() * 3), h = i % 3 - 1;
    const o = S.oaxaca({ beta, alpha: 0.24, h, dx, ex, y, yc, split: { k: 'c_efg', dx: N() * 4, ex: N() } });
    const sum = o.expected + Object.values(o.parts).reduce((s, v) => s + v, 0) + o.other + o.garbage;
    worst = Math.max(worst, Math.abs(sum - y));
    worstQ = Math.max(worstQ, Math.abs(o.parts.quality + o.parts.making - beta.c_efg * (dx.c_efg - ex.c_efg)));
  }
  ok('Oaxaca: y = expected + parts + other + garbage, every game, to 1e-9', worst < 1e-9, worst);
  ok('...the shooting part splits into shot quality and shot-making exactly', worstQ < 1e-12);
}

console.log('\ncurves');
{
  const gr = S.rng(11), x = [], y = [], h = [];
  for (let i = 0; i < 40000; i++) { const xi = -3 + 6 * gr(), hi = i % 2; x.push(xi); h.push(hi); y.push(gr() < S.expit(2.4 * Math.tanh(xi / 2) + 0.3 * hi) ? 1 : 0); }
  const g = S.gamLogit({ x, y, h });
  const err = Math.max(...g.grid.map(([xx, p]) => Math.abs(p - S.expit(2.4 * Math.tanh(xx / 2)))));
  ok('gamLogit: the spline curve at h = 0 within 0.02 of the truth on its 25 points', g.grid.length === 25 && err < 0.02, err.toFixed(4));
  ok('...knots at the 5/35/65/95th percentiles; bands contain the curve', g.knots.length === 4 && close(g.knots[0], -2.7, 0.05) &&
     g.grid.every(([, p, lo, hi]) => lo <= p && p <= hi));
  const at = g.at(0);
  ok('...at(x) gives p and its band', at.p > 0.45 && at.p < 0.55 && at.lo < at.p && at.hi > at.p);
  ok('nsBasis: linear beyond the boundary knots (natural)', (() => {
    const k = [0, 1, 2, 3], a = S.nsBasis(5, k), b = S.nsBasis(6, k), c = S.nsBasis(7, k);
    return a.every((v, i) => close(c[i] - b[i], b[i] - v, 1e-9));
  })());
}
{
  const br = S.rng(3), x = [], w = [], m = [];
  for (let i = 0; i < 100; i++) { x.push(Math.round(br() * 40) / 2); w.push(br() < 0.5 ? 1 : 0); m.push(br() * 20 - 10); }
  const b = S.bins(x, w, m, { n: 10, minN: 30 });
  ok('bins: merged until each holds at least minN, every row counted once', b.length >= 2 && b.every(r => r[3] >= 30) && b.reduce((s, r) => s + r[3], 0) === 100,
     b.map(r => r[3]).join());
  ok('...ties never split across bins, ordered, Wilson bands, mean margins', b.every((r, i) => i === 0 || r[0] > b[i - 1][1]) && b.every(r => r[6] <= r[5] && r[5] <= r[7] && r[8] != null));
  const b2 = S.bins(Array.from({ length: 1000 }, (_, i) => i), Array.from({ length: 1000 }, (_, i) => i % 2), null);
  ok('...1,000 distinct values give 10 bins of 100 and no margin', b2.length === 10 && b2.every(r => r[3] === 100 && r[8] === null));
  ok('quantile (type 7)', S.quantile([1, 2, 3, 4], 0.5) === 2.5 && S.quantile([1, 2, 3, 4], 0) === 1 && S.quantile([1, 2, 3, 4], 1) === 4);
}

console.log('\nsearch, ticks, speed, slices');
{
  const g = S.golden(x => (x - 1.234) * (x - 1.234), -5, 5, { tol: 1e-9 });
  ok('golden section finds a minimum', close(g.x, 1.234, 1e-6));
  ok('bisect finds a root, and null without a sign change', close(S.bisect(x => x * x - 2, 0, 2), Math.SQRT2, 1e-8) && S.bisect(x => x * x + 1, -1, 1) === null);
  const cases = [[0, 1, 5], [-3.2, 17.9, 6], [0.001, 0.0093, 4], [-100, 100, 8], [52.3, 52.31, 5], [3, 3, 5], [-0.6, 0.45, 7], [0, 1300, 5]];
  ok('niceTicks = chartlab\'s, on eight ranges', cases.every(([a, b, n]) => JSON.stringify(S.niceTicks(a, b, n)) === JSON.stringify(Chart.niceTicks(a, b, n))));
}
{
  const gr = S.rng(99), X = [], y = [];
  for (let i = 0; i < 35000; i++) { const r = new Array(40); for (let j = 0; j < 40; j++) r[j] = gr() - 0.5; X.push(r); y.push(gr()); }
  const t0 = performance.now(), G = S.suff(X, y), dt = performance.now() - t0;
  ok('a 35,000 x 40 Gram matrix in under a second', dt < 1000 && G.n === 35000, dt.toFixed(0) + ' ms');
  const t1 = performance.now(), fit = S.ridge(G, { lambda: 0.01 }), dt2 = performance.now() - t1;
  ok('...and its 40-column ridge solve in under 50 ms', !!fit && dt2 < 50, dt2.toFixed(1) + ' ms');
}
{
  const { X, y } = rowsXY(400, [1, 1], 1);
  const blocks = [];
  for (let b = 0; b < 20; b++) blocks.push(S.suff(X.slice(b * 20, b * 20 + 20), y.slice(b * 20, b * 20 + 20)));
  const fit = s => S.ridge(s).b;
  const gen = S.blockBootstrapSteps(blocks, fit, { B: 200, seed: 4 });
  const prog = [];
  let r = gen.next();
  while (!r.done) { prog.push(r.value); r = gen.next(); }
  const once = S.blockBootstrap(blocks, fit, { B: 200, seed: 4 });
  ok('the bootstrap as a generator: progress rises in (0, 1], the same answer as the plain call (seeded)', prog.length >= 20 &&
     prog.every((v, i) => v > 0 && v <= 1 && (i === 0 || v > prog[i - 1])) && JSON.stringify(r.value.lo) === JSON.stringify(once.lo));
  const strat = S.blockBootstrap(blocks, fit, { B: 100, seed: 4, strata: blocks.map((_, i) => i % 2) });
  ok('...stratified resampling (within league) runs and is ordered', strat.lo[1] < strat.est[1] && strat.est[1] < strat.hi[1]);
  const V = S.clusterCov(blocks, S.ridge(S.sumSuff(blocks)));
  ok('clusterCov: a symmetric positive covariance', V[1] === V[2] && V[0] > 0 && V[3] > 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
