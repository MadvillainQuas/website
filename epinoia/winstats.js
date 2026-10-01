'use strict';
/* ============================================================================
   WHAT WINS: THE STATISTICS. Every primitive the What wins model is built from.     window.EpinoiaWinStats

   Pure maths, no I/O and no DOM. The builder (tools/build-analytics.mjs through epinoia/winmodel.js) runs the full
   fits in node; the page and the Front office re-run only the cheap parts in the browser (a ridge re-fit from the
   file's block statistics, its bootstrap, curve look-ups) and the simulator's worker loads this file first.

   THE CONVENTIONS
     * A matrix is a flat Float64Array, row-major, p x p. Arrays of rows are accepted wherever a matrix goes in.
     * Sufficient statistics ("suff") of a design [x_1..x_p] and a response y, with optional weights:
         { p, n, sw, xx (packed upper triangle, row by row), xy, yy, sy, sx }
       Blocks of them (one per ISO week of games) add and subtract exactly, so any fit of any column subset over any
       union of blocks is exact: the bootstrap, cross-validation and cluster covariance all work from the blocks.
       sx (the column sums) rides along so correlations can be centred; files may leave it out.
     * The ridge minimises  sum w (y - x b)^2 + lambda * sw * sum_k pen_k (b_k - b0_k)^2 ; pen_k is the square of the
       column's spread (0 = unpenalised, the home column), b0 an optional prior mean.
     * Long loops (the bootstrap) also come as generators (`...Steps`) that yield their progress in [0, 1], so a Web
       Worker can slice them, post {progress} and honour a cancel; `run(gen)` drives one to the end.

   The normal CDF is W. J. Cody's (as R's pnorm), its inverse Wichura's AS241: both good to ~1e-15.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinStats = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* the globals the hot loops use, held locally: a lookup on a sandboxed global object (node's vm, some embeds)
   is far slower than a local one */
const Mth = Math, isFin = isFinite;
const isNum = v => typeof v === 'number' && isFin(v);
const SQRT2PI_INV = 0.398942280401432677939946059934;

/* ------------------------------------------------------------ the normal --- */
const NA = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582, 18154.981253343561249, 0.065682337918207449113];
const NB = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205, 45507.789335026729956];
const NC = [0.39894151208813466764, 8.8831497943883759412, 93.506656132177855979, 597.27027639480026226, 2494.5375852903726711,
  6848.1904505362823326, 11602.651437647350124, 9842.7148383839780218, 1.0765576773720192317e-8];
const ND = [22.266688044328115691, 235.38790178262499861, 1519.377599407554805, 6485.558298266760755, 18615.571640885098091,
  34900.952721145977266, 38912.003286093271411, 19685.429676859990727];
const NP = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807, 0.001421619193227893466, 2.9112874951168792e-5,
  0.02307344176494017303];
const NQ = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515, 0.00378239633202758244, 7.29751555083966205e-5];
/* Phi(x): Cody's rational approximations, three ranges */
function normCdf(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const y = Mth.abs(x);
  let cum, ccum, xnum, xden, temp, xsq, del;
  if (y <= 0.67448975) {
    if (y > 1.11e-16) {
      xsq = x * x; xnum = NA[4] * xsq; xden = xsq;
      for (let i = 0; i < 3; i++) { xnum = (xnum + NA[i]) * xsq; xden = (xden + NB[i]) * xsq; }
    } else { xnum = 0; xden = 0; }
    temp = x * (xnum + NA[3]) / (xden + NB[3]);
    return 0.5 + temp;
  }
  if (y <= 5.656854248587293) {
    xnum = NC[8] * y; xden = y;
    for (let i = 0; i < 7; i++) { xnum = (xnum + NC[i]) * y; xden = (xden + ND[i]) * y; }
    temp = (xnum + NC[7]) / (xden + ND[7]);
  } else {
    xsq = 1 / (x * x); xnum = NP[5] * xsq; xden = xsq;
    for (let i = 0; i < 4; i++) { xnum = (xnum + NP[i]) * xsq; xden = (xden + NQ[i]) * xsq; }
    temp = xsq * (xnum + NP[4]) / (xden + NQ[4]);
    temp = (SQRT2PI_INV - temp) / y;
  }
  xsq = Mth.trunc(y * 16) / 16; del = (y - xsq) * (y + xsq);
  cum = Mth.exp(-xsq * xsq * 0.5) * Mth.exp(-del * 0.5) * temp;
  ccum = 1 - cum;
  return x > 0 ? ccum : cum;
}
const normPdf = x => SQRT2PI_INV * Mth.exp(-0.5 * x * x);
/* Phi^-1(p): Wichura's AS241 (PPND16) */
function normInv(p) {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const q = p - 0.5;
  let r, val;
  if (Mth.abs(q) <= 0.425) {
    r = 0.180625 - q * q;
    return q * (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r +
      45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r +
      3.387132872796366608) / (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r +
      21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  r = q < 0 ? p : 1 - p;
  r = Mth.sqrt(-Mth.log(r));
  if (r <= 5) {
    r -= 1.6;
    val = (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
      1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r +
      1.42343711074968357734) / (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r +
      0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r +
      2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    val = (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
      0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r +
      6.6579046435011037772) / (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r +
      1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r +
      0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -val : val;
}
const logit = p => Mth.log(p / (1 - p));
const expit = x => (x >= 0 ? 1 / (1 + Mth.exp(-x)) : Mth.exp(x) / (1 + Mth.exp(x)));
const log1pexp = x => (x > 35 ? x : x < -35 ? Mth.exp(x) : Mth.log1p(Mth.exp(x)));

/* ------------------------------------------------------------ randomness --- */
/* mulberry32: a 32-bit state, one uniform in [0, 1) a call */
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Mth.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Mth.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* one standard normal from two uniforms (Box-Muller, the cosine half): always two draws, so streams stay aligned */
function normal(rand) {
  const u1 = rand(), u2 = rand();
  return Mth.sqrt(-2 * Mth.log(1 - u1)) * Mth.cos(2 * Mth.PI * u2);
}
/* FNV-1a, 32 bits, of a string's UTF-16 code units */
function hash(str) {
  let h = 0x811C9DC5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Mth.imul(h, 0x01000193); }
  return h >>> 0;
}

/* ------------------------------------------------------------ linear algebra --- */
function flat(A, p) {
  if (A instanceof Float64Array) return A;
  if (Array.isArray(A) && Array.isArray(A[0])) {
    const n = p || A.length, out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = A[i][j];
    return out;
  }
  return Float64Array.from(A);
}
const dimOf = (A, p) => p || (Array.isArray(A) && Array.isArray(A[0]) ? A.length : Mth.round(Mth.sqrt(A.length)));
function cholOnce(A, p, jit) {
  const L = new Float64Array(p * p);
  for (let j = 0; j < p; j++) {
    let s = A[j * p + j] + jit;
    for (let k = 0; k < j; k++) s -= L[j * p + k] * L[j * p + k];
    if (!(s > 0) || !isFin(s)) return null;
    const d = Mth.sqrt(s);
    L[j * p + j] = d;
    for (let i = j + 1; i < p; i++) {
      let t = A[i * p + j];
      for (let k = 0; k < j; k++) t -= L[i * p + k] * L[j * p + k];
      L[i * p + j] = t / d;
    }
  }
  return L;
}
/* Cholesky A = L L'; a failed pivot retries with jitter 1e-10 * trace / p on the diagonal, x10, three times */
function chol(A, p) {
  p = dimOf(A, p); A = flat(A, p);
  let L = cholOnce(A, p, 0);
  if (L) { L.jitter = 0; return L; }
  let tr = 0;
  for (let i = 0; i < p; i++) tr += Mth.abs(A[i * p + i]);
  let jit = 1e-10 * (tr / p || 1);
  for (let k = 0; k < 3; k++, jit *= 10) {
    L = cholOnce(A, p, jit);
    if (L) { L.jitter = jit; return L; }
  }
  return null;
}
function cholSolve(L, b, p) {
  p = p || b.length;
  const y = new Float64Array(p), x = new Float64Array(p);
  for (let i = 0; i < p; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * p + k] * y[k]; y[i] = s / L[i * p + i]; }
  for (let i = p - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < p; k++) s -= L[k * p + i] * x[k]; x[i] = s / L[i * p + i]; }
  return x;
}
function invFromChol(L, p) {
  const inv = new Float64Array(p * p), e = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    e.fill(0); e[j] = 1;
    const c = cholSolve(L, e, p);
    for (let i = 0; i < p; i++) inv[i * p + j] = c[i];
  }
  for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) { const m = 0.5 * (inv[i * p + j] + inv[j * p + i]); inv[i * p + j] = m; inv[j * p + i] = m; }
  return inv;
}
function invSPD(A, p) {
  p = dimOf(A, p); A = flat(A, p);
  const L = chol(A, p);
  return L ? invFromChol(L, p) : null;
}
/* Gauss-Jordan with partial pivoting: kept as the parity reference for the Cholesky path */
function gaussJordan(A, b, p) {
  p = dimOf(A, p); A = flat(A, p);
  const M = [];
  for (let i = 0; i < p; i++) { const row = new Float64Array(p + 1); for (let j = 0; j < p; j++) row[j] = A[i * p + j]; row[p] = b[i]; M.push(row); }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Mth.abs(M[r][c]) > Mth.abs(M[piv][c])) piv = r;
    if (Mth.abs(M[piv][c]) < 1e-300) return null;
    const t = M[c]; M[c] = M[piv]; M[piv] = t;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Float64Array(p);
  for (let i = 0; i < p; i++) x[i] = M[i][p] / M[i][i];
  return x;
}
/* eigenvalues of a symmetric matrix (cyclic Jacobi) */
function eigSym(A, p) {
  p = dimOf(A, p);
  const a = Float64Array.from(flat(A, p));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) off += a[i * p + j] * a[i * p + j];
    if (off < 1e-30) break;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) {
      const aij = a[i * p + j];
      if (Mth.abs(aij) < 1e-300) continue;
      const th = (a[j * p + j] - a[i * p + i]) / (2 * aij);
      const t = (th >= 0 ? 1 : -1) / (Mth.abs(th) + Mth.sqrt(th * th + 1));
      const c = 1 / Mth.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < p; k++) {
        const aki = a[k * p + i], akj = a[k * p + j];
        a[k * p + i] = c * aki - s * akj; a[k * p + j] = s * aki + c * akj;
      }
      for (let k = 0; k < p; k++) {
        const aik = a[i * p + k], ajk = a[j * p + k];
        a[i * p + k] = c * aik - s * ajk; a[j * p + k] = s * aik + c * ajk;
      }
    }
  }
  const out = [];
  for (let i = 0; i < p; i++) out.push(a[i * p + i]);
  return out.sort((x, y) => x - y);
}

/* ------------------------------------------------------------ sufficient statistics --- */
const packedLen = p => p * (p + 1) / 2;
const pidx = (i, j, p) => (i <= j ? i * (2 * p - i + 1) / 2 + (j - i) : j * (2 * p - j + 1) / 2 + (i - j));
function zeroSuff(p) {
  return { p, n: 0, sw: 0, xx: new Float64Array(packedLen(p)), xy: new Float64Array(p), yy: 0, sy: 0, sx: new Float64Array(p) };
}
/* X: rows (arrays); a row with any non-finite value, or a non-finite y or weight, is left out */
function suff(X, y, w) {
  const p = X.length ? X[0].length : 0, S = zeroSuff(p), xx = S.xx, xy = S.xy, sx = S.sx;
  outer: for (let r = 0; r < X.length; r++) {
    const row = X[r], yr = y[r], wr = w ? w[r] : 1;
    if (!isNum(yr) || !isNum(wr)) continue;
    for (let j = 0; j < p; j++) if (!isNum(row[j])) continue outer;
    let k = 0;
    for (let i = 0; i < p; i++) {
      const xi = row[i] * wr;
      sx[i] += xi; xy[i] += xi * yr;
      for (let j = i; j < p; j++) xx[k++] += xi * row[j];
    }
    S.n++; S.sw += wr; S.yy += wr * yr * yr; S.sy += wr * yr;
  }
  return S;
}
const pOf = S => (S.p != null ? S.p : S.xy.length);
function copySuff(a) {
  const p = pOf(a);
  return { p, n: a.n, sw: a.sw, xx: Float64Array.from(a.xx), xy: Float64Array.from(a.xy), yy: a.yy, sy: a.sy,
    sx: a.sx ? Float64Array.from(a.sx) : new Float64Array(p) };
}
function addInto(t, a, sign) {
  t.n += sign * a.n; t.sw += sign * (a.sw != null ? a.sw : a.n); t.yy += sign * a.yy; t.sy += sign * a.sy;
  for (let i = 0; i < t.xx.length; i++) t.xx[i] += sign * a.xx[i];
  for (let i = 0; i < t.xy.length; i++) t.xy[i] += sign * a.xy[i];
  if (a.sx) for (let i = 0; i < t.sx.length; i++) t.sx[i] += sign * a.sx[i];
  return t;
}
const addSuff = (a, b) => addInto(copySuff(a), b, 1);
const subSuff = (a, b) => addInto(copySuff(a), b, -1);
function sumSuff(blocks) {
  if (!blocks.length) return null;
  const t = zeroSuff(pOf(blocks[0]));
  for (const b of blocks) addInto(t, b, 1);
  return t;
}
/* the statistics of a column subset (in the given order) */
function pick(S, cols) {
  const p = pOf(S), q = cols.length, out = zeroSuff(q);
  out.n = S.n; out.sw = S.sw != null ? S.sw : S.n; out.yy = S.yy; out.sy = S.sy;
  let k = 0;
  for (let a = 0; a < q; a++) {
    out.xy[a] = S.xy[cols[a]];
    if (S.sx) out.sx[a] = S.sx[cols[a]];
    for (let b = a; b < q; b++) out.xx[k++] = S.xx[pidx(cols[a], cols[b], p)];
  }
  return out;
}
/* the full p x p X'X of a packed triangle */
function full(xx, p) {
  const A = new Float64Array(p * p);
  let k = 0;
  for (let i = 0; i < p; i++) for (let j = i; j < p; j++) { A[i * p + j] = xx[k]; A[j * p + i] = xx[k]; k++; }
  return A;
}

/* ------------------------------------------------------------ ridge --- */
function ridge(S, o) {
  o = o || {};
  const p = pOf(S), lam = o.lambda || 0, pen = o.pen, prior = o.prior, sw = S.sw != null ? S.sw : S.n;
  const XtX = full(S.xx, p), A = Float64Array.from(XtX), rhs = Float64Array.from(S.xy);
  if (lam > 0) {
    for (let k = 0; k < p; k++) {
      const pk = pen ? pen[k] : 1, d = lam * sw * pk;
      A[k * p + k] += d;
      if (prior) rhs[k] += d * prior[k];
    }
  }
  const L = chol(A, p);
  if (!L) return null;
  const bf = cholSolve(L, rhs, p), Ainv = invFromChol(L, p);
  const b = Array.from(bf);
  let bxy = 0, bxxb = 0, df = 0;
  for (let i = 0; i < p; i++) {
    bxy += b[i] * S.xy[i];
    let r = 0;
    for (let j = 0; j < p; j++) { r += XtX[i * p + j] * b[j]; df += XtX[i * p + j] * Ainv[j * p + i]; }
    bxxb += b[i] * r;
  }
  const rss = Mth.max(0, S.yy - 2 * bxy + bxxb), tss = S.yy - (sw > 0 ? S.sy * S.sy / sw : 0);
  return { b, A, Ainv, rss, sigma2: rss / Mth.max(1, sw - df), df, r2: tss > 0 ? 1 - rss / tss : null, n: S.n, sw, p, jitter: L.jitter };
}
/* the squared error of a fit b on (test) statistics T */
function sse(T, b) {
  const p = b.length;
  let s = T.yy, k = 0;
  for (let i = 0; i < p; i++) {
    s -= 2 * b[i] * T.xy[i];
    for (let j = i; j < p; j++) { s += (i === j ? 1 : 2) * b[i] * b[j] * T.xx[k]; k++; }
  }
  return s;
}

/* ------------------------------------------------------------ one-dimensional search --- */
const GR = (Mth.sqrt(5) - 1) / 2;
function golden(f, lo, hi, o) {
  o = o || {};
  const tol = o.tol != null ? o.tol : 1e-6, maxIter = o.maxIter || 200;
  let a = lo, b = hi, c = b - GR * (b - a), d = a + GR * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < maxIter && Mth.abs(b - a) > tol; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - GR * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + GR * (b - a); fd = f(d); }
  }
  return fc < fd ? { x: c, fx: fc } : { x: d, fx: fd };
}
/* a root of f in [lo, hi] by bisection; null when f does not change sign there */
function bisect(f, lo, hi, o) {
  o = o || {};
  const tol = o.tol != null ? o.tol : 1e-9, maxIter = o.maxIter || 200;
  let flo = f(lo), fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (!(flo * fhi < 0)) return null;
  let mid = 0.5 * (lo + hi);
  for (let i = 0; i < maxIter; i++) {
    mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (fm === 0 || (hi - lo) / 2 < tol) return mid;
    if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return mid;
}

/* ------------------------------------------------------------ cross-validation over blocks --- */
function cvLambda(blocks, o) {
  o = o || {};
  const G = blocks.length, folds = Mth.max(2, Mth.min(o.folds || 5, G));
  const total = sumSuff(blocks), fold = [];
  for (let f = 0; f < folds; f++) fold.push(zeroSuff(pOf(total)));
  blocks.forEach((b, i) => addInto(fold[i % folds], b, 1));
  const train = fold.map(f => subSuff(total, f));
  const path = [];
  const mse = lam => {
    let e = 0, n = 0;
    for (let f = 0; f < folds; f++) {
      if (!fold[f].n) continue;
      const fit = ridge(train[f], { lambda: lam, pen: o.pen, prior: o.prior });
      if (!fit) return Infinity;
      e += sse(fold[f], fit.b); n += fold[f].sw != null ? fold[f].sw : fold[f].n;
    }
    const v = n ? e / n : Infinity;
    path.push([lam, v]);
    return v;
  };
  const lo = Mth.log(o.lo || 1e-4), hi = Mth.log(o.hi || 10);
  const g = golden(t => mse(Mth.exp(t)), lo, hi, { tol: o.tol || 0.02 });
  path.sort((a, b) => a[0] - b[0]);
  return { lambda: Mth.exp(g.x), mse: g.fx, path };
}

/* ------------------------------------------------------------ cluster (block) covariance: CR1 --- */
function clusterCov(blocks, fit) {
  const p = fit.b.length, G = blocks.length, meat = new Float64Array(p * p), s = new Float64Array(p);
  let n = 0;
  for (const B of blocks) {
    n += B.n;
    const XX = full(B.xx, p);
    for (let i = 0; i < p; i++) { let r = B.xy[i]; for (let j = 0; j < p; j++) r -= XX[i * p + j] * fit.b[j]; s[i] = r; }
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) meat[i * p + j] += s[i] * s[j];
  }
  const c = G > 1 && n > p ? (G / (G - 1)) * ((n - 1) / (n - p)) : 1;
  const Ai = fit.Ainv, T = new Float64Array(p * p), V = new Float64Array(p * p);
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) { let r = 0; for (let k = 0; k < p; k++) r += Ai[i * p + k] * meat[k * p + j]; T[i * p + j] = r; }
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) { let r = 0; for (let k = 0; k < p; k++) r += T[i * p + k] * Ai[k * p + j]; V[i * p + j] = c * r; }
  return V;
}

/* ------------------------------------------------------------ summaries --- */
function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * q, lo = Mth.floor(h), hi = Mth.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
function mean(xs) { let s = 0, n = 0; for (const x of xs) if (isNum(x)) { s += x; n++; } return n ? s / n : NaN; }
function sd(xs) {
  const v = xs.filter(isNum), n = v.length;
  if (n < 2) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / n;
  return Mth.sqrt(v.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1));
}
function pearson(xs, ys) {
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) if (isNum(xs[i]) && isNum(ys[i])) { mx += xs[i]; my += ys[i]; n++; }
  if (n < 3) return null;
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    if (!(isNum(xs[i]) && isNum(ys[i]))) continue;
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx > 0 && syy > 0 ? sxy / Mth.sqrt(sxx * syy) : null;
}

/* ------------------------------------------------------------ the bootstrap over blocks --- */
/* resample the G blocks with replacement (within strata when given: strata[i] = the block's stratum), refit from the
   summed statistics; percentile 95% */
function* blockBootstrapSteps(blocks, fitFn, o) {
  o = o || {};
  const B = o.B || 400, rand = rng(o.seed != null ? o.seed : 1), G = blocks.length;
  const est = fitFn(sumSuff(blocks));
  const draws = [];
  const groups = new Map();
  blocks.forEach((b, i) => {
    const s = o.strata ? o.strata[i] : 0;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(i);
  });
  const lists = [...groups.values()];
  const p = pOf(blocks[0]), acc = zeroSuff(p);
  const every = Mth.max(1, Mth.round(B / 40));
  for (let d = 0; d < B; d++) {
    acc.n = 0; acc.sw = 0; acc.yy = 0; acc.sy = 0; acc.xx.fill(0); acc.xy.fill(0); acc.sx.fill(0);
    for (const L of lists) for (let k = 0; k < L.length; k++) addInto(acc, blocks[L[Mth.floor(rand() * L.length)]], 1);
    const r = fitFn(acc);
    if (r && r.length) draws.push(Array.from(r));
    if (d % every === every - 1) yield (d + 1) / B;
  }
  const k = est ? est.length : draws.length ? draws[0].length : 0, lo = [], hi = [], se = [];
  for (let j = 0; j < k; j++) {
    const col = draws.map(x => x[j]).filter(isNum).sort((a, b) => a - b);
    lo.push(quantile(col, 0.025)); hi.push(quantile(col, 0.975)); se.push(sd(col));
  }
  void G;
  return { est: est ? Array.from(est) : null, draws, lo, hi, se };
}
function run(gen) { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; }
const blockBootstrap = (blocks, fitFn, o) => run(blockBootstrapSteps(blocks, fitFn, o));

/* ------------------------------------------------------------ ridge logistic (IRLS) --- */
function logistic(X, y, o) {
  o = o || {};
  const n = X.length, p = n ? X[0].length : 0, lam = o.lambda || 0, pen = o.pen, w = o.w, off = o.offset;
  const maxIter = o.maxIter || 25, tol = o.tol != null ? o.tol : 1e-8;
  let sw = 0;
  for (let i = 0; i < n; i++) sw += w ? w[i] : 1;
  const D = new Float64Array(p);
  for (let k = 0; k < p; k++) D[k] = lam * sw * (pen ? pen[k] : 1);
  let b = new Float64Array(p);
  if (o.start) for (let k = 0; k < p; k++) b[k] = o.start[k];
  const eta = new Float64Array(n);
  const pll = bb => {
    let ll = 0;
    for (let i = 0; i < n; i++) {
      let e = off ? off[i] : 0;
      for (let k = 0; k < p; k++) e += X[i][k] * bb[k];
      eta[i] = e;
      ll += (w ? w[i] : 1) * (y[i] * e - log1pexp(e));
    }
    let pn = 0;
    for (let k = 0; k < p; k++) pn += D[k] * bb[k] * bb[k];
    return { ll, pll: ll - 0.5 * pn };
  };
  let cur = pll(b), iters = 0, converged = false, H = null;
  const hess = () => {
    const Hm = new Float64Array(p * p), g = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const pi = expit(eta[i]), wi = (w ? w[i] : 1), v = wi * pi * (1 - pi), r = wi * (y[i] - pi), row = X[i];
      for (let a = 0; a < p; a++) {
        g[a] += row[a] * r;
        const ra = row[a] * v;
        for (let c = a; c < p; c++) Hm[a * p + c] += ra * row[c];
      }
    }
    for (let a = 0; a < p; a++) { g[a] -= D[a] * b[a]; Hm[a * p + a] += D[a]; for (let c = a + 1; c < p; c++) Hm[c * p + a] = Hm[a * p + c]; }
    return { Hm, g };
  };
  for (iters = 1; iters <= maxIter; iters++) {
    const { Hm, g } = hess();
    H = Hm;
    const L = chol(Hm, p);
    if (!L) break;
    const step = cholSolve(L, g, p);
    let t = 1, nb = null, nxt = null;
    for (let h = 0; h < 30; h++) {
      nb = new Float64Array(p);
      for (let k = 0; k < p; k++) nb[k] = b[k] + t * step[k];
      nxt = pll(nb);
      if (nxt.pll >= cur.pll - 1e-12 * Mth.abs(cur.pll)) break;
      t /= 2;
    }
    let mx = 0, mb = 0;
    for (let k = 0; k < p; k++) { mx = Mth.max(mx, Mth.abs(nb[k] - b[k])); mb = Mth.max(mb, Mth.abs(nb[k])); }
    const dl = nxt.pll - cur.pll;
    b = nb; cur = nxt;
    if (mx < tol * (1 + mb) || Mth.abs(dl) < tol * (1 + Mth.abs(cur.pll)) * 1e-2) { converged = true; break; }
  }
  if (iters > maxIter) iters = maxIter;
  pll(b);
  H = hess().Hm;
  const cov = invSPD(H, p);
  let maxEta = 0, resid = 0;
  for (let i = 0; i < n; i++) { maxEta = Mth.max(maxEta, Mth.abs(eta[i])); resid = Mth.max(resid, Mth.abs(y[i] - expit(eta[i]))); }
  const separated = lam === 0 && (!converged || maxEta > 25 || (n > p && resid < 1e-6));
  return { b: Array.from(b), cov, ll: cur.ll, iters, converged, separated };
}

/* ------------------------------------------------------------ collinearity --- */
function corrFromSuff(S) {
  const p = pOf(S), sw = S.sw != null ? S.sw : S.n, C = full(S.xx, p), R = new Float64Array(p * p);
  const m = new Float64Array(p);
  if (S.sx && sw > 0) for (let i = 0; i < p; i++) m[i] = S.sx[i] / sw;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) C[i * p + j] = C[i * p + j] / sw - m[i] * m[j];
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
    const d = Mth.sqrt(C[i * p + i] * C[j * p + j]);
    R[i * p + j] = d > 0 ? C[i * p + j] / d : (i === j ? 1 : 0);
  }
  return R;
}
function vif(R, p) {
  p = dimOf(R, p);
  const inv = invSPD(R, p);
  const out = [];
  for (let i = 0; i < p; i++) out.push(inv ? inv[i * p + i] : Infinity);
  return out;
}
/* sqrt(largest / smallest eigenvalue) of the correlation matrix (Belsley's condition number) */
function condNumber(R, p) {
  const e = eigSym(R, p), lo = e[0], hi = e[e.length - 1];
  return lo > 0 ? Mth.sqrt(hi / lo) : Infinity;
}

/* ------------------------------------------------------------ Shapley R^2 over groups --- */
/* v(S) = R^2(force + S) - R^2(force), every subset of the groups, by Cholesky on the Gram sub-blocks; exact */
function shapleyR2(S, groups, o) {
  o = o || {};
  const force = o.force || [], m = groups.length, N = 1 << m, v = new Float64Array(N);
  const r2 = cols => {
    if (!cols.length) { const sw = S.sw != null ? S.sw : S.n, tss = S.yy - S.sy * S.sy / sw; return tss > 0 ? 1 - S.yy / tss : 0; }
    const fit = ridge(pick(S, cols), { lambda: o.lambda || 0, pen: o.pen ? cols.map(c => o.pen[c]) : null });
    return fit && fit.r2 != null ? fit.r2 : 0;
  };
  const base = r2(force.slice());
  for (let mask = 0; mask < N; mask++) {
    const cols = force.slice();
    for (let g = 0; g < m; g++) if (mask & (1 << g)) for (const c of groups[g]) cols.push(c);
    v[mask] = mask ? r2(cols) - base : 0;
  }
  const fact = [1];
  for (let i = 1; i <= m; i++) fact[i] = fact[i - 1] * i;
  const phi = new Array(m).fill(0);
  for (let mask = 0; mask < N; mask++) {
    let s = 0;
    for (let g = 0; g < m; g++) if (mask & (1 << g)) s++;
    const wgt = fact[s] * fact[m - s - 1] / fact[m];
    for (let g = 0; g < m; g++) if (!(mask & (1 << g))) phi[g] += wgt * (v[mask | (1 << g)] - v[mask]);
  }
  return { total: v[N - 1], phi, base };
}

/* ------------------------------------------------------------ pooling across leagues --- */
function dersimonianLaird(est) {
  const e = est.filter(x => isNum(x.b) && x.v > 0), m = e.length;
  if (m < 2) return 0;
  let sw = 0, swb = 0, sw2 = 0;
  for (const x of e) { const w = 1 / x.v; sw += w; swb += w * x.b; sw2 += w * w; }
  const bbar = swb / sw;
  let Q = 0;
  for (const x of e) Q += (x.b - bbar) * (x.b - bbar) / x.v;
  const den = sw - sw2 / sw;
  return den > 0 ? Mth.max(0, (Q - (m - 1)) / den) : 0;
}
/* posterior (V^-1 + T^-1)^-1 (V^-1 b_own + T^-1 b_pool), T = diag tau2; w_k = post_kk / tau2_k (the pooled weight) */
function ebPosterior(bOwn, Vown, bPool, tau2) {
  const scalar = typeof bOwn === 'number';
  const bo = scalar ? [bOwn] : Array.from(bOwn), bp = scalar ? [bPool] : Array.from(bPool), p = bo.length;
  const t2 = typeof tau2 === 'number' ? new Array(p).fill(tau2) : Array.from(tau2);
  const V = typeof Vown === 'number' ? Float64Array.from([Vown]) : flat(Vown, p);
  let Vinv;
  if (p === 1) Vinv = Float64Array.from([V[0] > 0 && isFin(V[0]) ? 1 / V[0] : (V[0] === Infinity ? 0 : 1e300)]);
  else Vinv = invSPD(V, p);
  const P = new Float64Array(p * p), rhs = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    const ti = 1 / Mth.max(t2[i], 1e-300);
    for (let j = 0; j < p; j++) P[i * p + j] = Vinv[i * p + j] + (i === j ? ti : 0);
    let r = ti * bp[i];
    for (let j = 0; j < p; j++) r += Vinv[i * p + j] * bo[j];
    rhs[i] = r;
  }
  const Pinv = p === 1 ? Float64Array.from([1 / P[0]]) : invSPD(P, p);
  const b = [], w = [];
  for (let i = 0; i < p; i++) {
    let r = 0;
    for (let j = 0; j < p; j++) r += Pinv[i * p + j] * rhs[j];
    b.push(r);
    w.push(Mth.min(1, Pinv[i * p + i] / Mth.max(t2[i], 1e-300)));
  }
  return scalar ? { b: b[0], V: Pinv[0], w: w[0] } : { b, V: Pinv, w };
}

/* ------------------------------------------------------------ intervals and tests --- */
function wilson(k, n, z) {
  z = z || 1.959963984540054;
  if (!(n > 0)) return [0, 1];
  const p = k / n, z2 = z * z, d = 1 + z2 / n, c = (p + z2 / (2 * n)) / d, h = z * Mth.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
  return [Mth.max(0, c - h), Mth.min(1, c + h)];
}
function fisherCI(r, nEff, z) {
  z = z || 1.959963984540054;
  if (!isNum(r) || !(nEff > 3)) return [-1, 1];
  const a = Mth.atanh(Mth.max(-0.999999999, Mth.min(0.999999999, r))), h = z / Mth.sqrt(nEff - 3);
  return [Mth.tanh(a - h), Mth.tanh(a + h)];
}
function fisherP(r, nEff) {
  if (!isNum(r) || !(nEff > 3)) return 1;
  const zz = Mth.abs(Mth.atanh(Mth.max(-0.999999999, Mth.min(0.999999999, r)))) * Mth.sqrt(nEff - 3);
  return Mth.min(1, 2 * normCdf(-zz));
}
/* Benjamini-Hochberg q values (nulls stay null) */
function bh(ps) {
  const idx = [];
  ps.forEach((p, i) => { if (isNum(p)) idx.push(i); });
  const m = idx.length, q = ps.map(() => null);
  idx.sort((a, b) => ps[a] - ps[b]);
  let run = 1;
  for (let r = m - 1; r >= 0; r--) {
    const i = idx[r];
    run = Mth.min(run, ps[i] * m / (r + 1));
    q[i] = run;
  }
  return q;
}
/* ln Gamma (Lanczos), the regularised incomplete beta (continued fraction) and gamma functions */
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lnGamma(x) {
  if (x < 0.5) return Mth.log(Mth.PI / Mth.abs(Mth.sin(Mth.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = LG[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LG[i] / (x + i);
  return 0.5 * Mth.log(2 * Mth.PI) + (x + 0.5) * Mth.log(t) - t + Mth.log(a);
}
function betacf(a, b, x) {
  const FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Mth.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Mth.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Mth.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Mth.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Mth.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Mth.abs(del - 1) < 1e-15) break;
  }
  return h;
}
function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Mth.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Mth.log(x) + b * Mth.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function gammaInc(a, x) {     // regularised lower P(a, x)
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Mth.abs(del) < Mth.abs(sum) * 1e-16) break; }
    return sum * Mth.exp(-x + a * Mth.log(x) - lnGamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Mth.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Mth.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Mth.abs(del - 1) < 1e-16) break;
  }
  return 1 - Mth.exp(-x + a * Mth.log(x) - lnGamma(a)) * h;
}
function tCdf(t, df) {
  if (!isFin(df)) return normCdf(t);
  const x = df / (df + t * t), tail = 0.5 * betaInc(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}
function tInv(p, df) {
  if (!isFin(df) || df > 1e7) return normInv(p);
  const z = normInv(p);
  const r = bisect(t => tCdf(t, df) - p, z - 50, z + 50, { tol: 1e-12 });
  return r == null ? z : r;
}
const fP = (F, d1, d2) => (F > 0 ? betaInc(d2 / (d2 + d1 * F), d2 / 2, d1 / 2) : 1);   // upper tail
const chi2P = (x, k) => (x > 0 ? 1 - gammaInc(k / 2, x / 2) : 1);                  // upper tail
/* Welch: difference m1 - m2 of two means from their sample variances, 95% interval and p */
function welchCI(m1, v1, n1, m2, v2, n2, level) {
  const a = v1 / n1, b = v2 / n2, se = Mth.sqrt(a + b), d = m1 - m2;
  const df = (a + b) * (a + b) / ((n1 > 1 ? a * a / (n1 - 1) : 0) + (n2 > 1 ? b * b / (n2 - 1) : 0)) || 1;
  const tc = tInv(1 - (1 - (level || 0.95)) / 2, df), t = se > 0 ? d / se : 0;
  return { d, se, df, lo: d - tc * se, hi: d + tc * se, t, p: se > 0 ? 2 * (1 - tCdf(Mth.abs(t), df)) : 1 };
}
/* one-way ANOVA intraclass correlation, ICC(1), of groups of values */
function icc(groups) {
  const gs = groups.map(g => g.filter(isNum)).filter(g => g.length);
  const k = gs.length;
  let N = 0, tot = 0, sn2 = 0;
  for (const g of gs) { N += g.length; sn2 += g.length * g.length; for (const x of g) tot += x; }
  if (k < 2 || N <= k) return null;
  const m = tot / N;
  let ssb = 0, ssw = 0;
  for (const g of gs) {
    const mg = g.reduce((a, b) => a + b, 0) / g.length;
    ssb += g.length * (mg - m) * (mg - m);
    for (const x of g) ssw += (x - mg) * (x - mg);
  }
  const msb = ssb / (k - 1), msw = ssw / (N - k), n0 = (N - sn2 / N) / (k - 1), den = msb + (n0 - 1) * msw;
  return den > 0 ? (msb - msw) / den : null;
}
/* point-biserial r of x against a 0/1 result w (flipped when dir = -1); intervals from n_eff = n / DEFF,
   DEFF = 1 + (mean block size - 1) rho_x rho_w (ICCs within blocks, clamped to [0, 1]) */
function pointBiserial(x, w, o) {
  o = o || {};
  const dir = o.dir === -1 ? -1 : 1, xs = [], ws = [], bs = [];
  for (let i = 0; i < x.length; i++) if (isNum(x[i]) && isNum(w[i])) { xs.push(x[i]); ws.push(w[i]); if (o.blocks) bs.push(o.blocks[i]); }
  const n = xs.length, r0 = pearson(xs, ws);
  if (r0 == null) return { r: null, lo: null, hi: null, p: null, n, nEff: n, deff: 1 };
  const r = dir * r0;
  let deff = 1;
  if (o.blocks) {
    const gx = new Map(), gw = new Map();
    bs.forEach((b, i) => { if (!gx.has(b)) { gx.set(b, []); gw.set(b, []); } gx.get(b).push(xs[i]); gw.get(b).push(ws[i]); });
    const clamp = v => (v == null ? 0 : Mth.max(0, Mth.min(1, v)));
    const rx = clamp(icc([...gx.values()])), rw = clamp(icc([...gw.values()])), mbar = n / gx.size;
    deff = 1 + (mbar - 1) * rx * rw;
  }
  const nEff = n / deff, ci = fisherCI(r, nEff);
  return { r, lo: ci[0], hi: ci[1], p: fisherP(r, nEff), n, nEff, deff };
}

/* ------------------------------------------------------------ binned win shares --- */
/* equal-count bins of x (ties kept together), merged until each has minN; each [lo, hi, mean x, n, wins, p, Wilson lo,
   Wilson hi, mean margin (null without m)] */
function bins(x, w, m, o) {
  o = o || {};
  const nb = o.n || 10, minN = o.minN != null ? o.minN : 30, pts = [];
  for (let i = 0; i < x.length; i++) if (isNum(x[i]) && isNum(w[i])) pts.push([x[i], w[i], m && isNum(m[i]) ? m[i] : null]);
  pts.sort((a, b) => a[0] - b[0]);
  const N = pts.length;
  if (!N) return [];
  const cuts = [0];
  for (let k = 1; k < nb; k++) {
    let c = Mth.round(k * N / nb);
    while (c > 0 && c < N && pts[c][0] === pts[c - 1][0]) c++;
    if (c > cuts[cuts.length - 1] && c < N) cuts.push(c);
  }
  cuts.push(N);
  let groups = [];
  for (let k = 0; k + 1 < cuts.length; k++) groups.push([cuts[k], cuts[k + 1]]);
  for (;;) {
    if (groups.length < 2) break;
    let worst = -1, sz = Infinity;
    groups.forEach((g, i) => { const s = g[1] - g[0]; if (s < minN && s < sz) { sz = s; worst = i; } });
    if (worst < 0) break;
    const j = worst === groups.length - 1 ? worst - 1 : worst === 0 ? 1
      : (groups[worst - 1][1] - groups[worst - 1][0] <= groups[worst + 1][1] - groups[worst + 1][0] ? worst - 1 : worst + 1);
    const a = Mth.min(worst, j);
    groups.splice(a, 2, [groups[a][0], groups[a + 1][1]]);
  }
  return groups.map(([s, e]) => {
    let sx = 0, sw = 0, sm = 0, nm = 0;
    for (let i = s; i < e; i++) { sx += pts[i][0]; sw += pts[i][1]; if (pts[i][2] != null) { sm += pts[i][2]; nm++; } }
    const n = e - s, ci = wilson(sw, n);
    return [pts[s][0], pts[e - 1][0], sx / n, n, sw, sw / n, ci[0], ci[1], nm ? sm / nm : null];
  });
}

/* ------------------------------------------------------------ splines --- */
/* natural cubic spline basis without the constant: [x, N_1 .. N_{K-2}] (ESL 5.2.1), cubic terms scaled by the knot
   range squared so the columns are on the scale of x */
function nsBasis(x, knots) {
  const K = knots.length, out = [x];
  if (K < 3) return out;
  const last = knots[K - 1], sc = (last - knots[0]) * (last - knots[0]) || 1;
  const cube = v => (v > 0 ? v * v * v : 0);
  const dk = k => (cube(x - knots[k]) - cube(x - last)) / (last - knots[k]);
  const dK1 = dk(K - 2);
  for (let k = 0; k < K - 2; k++) out.push((dk(k) - dK1) / sc);
  return out;
}
/* logit P = a + s(x) [+ alpha h] [+ X gamma]; ridge on the non-linear columns; curve at h = 0 and X = 0 on `grid`
   points with delta-method 95% bands */
function gamLogit(o) {
  const xs = o.x, ys = o.y, n = xs.length;
  const sorted = xs.filter(isNum).slice().sort((a, b) => a - b);
  const knots = o.knots || [0.05, 0.35, 0.65, 0.95].map(q => quantile(sorted, q));
  const ns = knots.length >= 3 ? knots.length - 1 : 1;
  const X = [], Y = [], W = [];
  for (let i = 0; i < n; i++) {
    if (!isNum(xs[i]) || !isNum(ys[i])) continue;
    const row = [1].concat(nsBasis(xs[i], knots));
    if (o.h) row.push(o.h[i]);
    if (o.X) for (const v of o.X[i]) row.push(v);
    if (!row.every(isNum)) continue;
    X.push(row); Y.push(ys[i]); W.push(o.w ? o.w[i] : 1);
  }
  /* the penalty on each non-linear column is its mean square (a standardised ridge), so lambda means the same at any scale */
  const p = X.length ? X[0].length : 0, pen = new Array(p).fill(0);
  for (let k = 2; k < 1 + ns; k++) { let s2 = 0; for (const row of X) s2 += row[k] * row[k]; pen[k] = X.length ? s2 / X.length : 1; }
  const fit = logistic(X, Y, { lambda: o.lambda != null ? o.lambda : 1e-5, pen, w: o.w ? W : null });
  const at = x => {
    const g = [1].concat(nsBasis(x, knots));
    let eta = 0, v = 0;
    for (let a = 0; a < g.length; a++) { eta += g[a] * fit.b[a]; for (let c = 0; c < g.length; c++) v += g[a] * g[c] * (fit.cov ? fit.cov[a * p + c] : 0); }
    const se = Mth.sqrt(Mth.max(0, v));
    return { p: expit(eta), lo: expit(eta - 1.959963984540054 * se), hi: expit(eta + 1.959963984540054 * se), eta, se };
  };
  const gN = o.grid || 25, lo = quantile(sorted, 0.02), hi = quantile(sorted, 0.98), grid = [];
  for (let i = 0; i < gN; i++) {
    const x = gN === 1 ? lo : lo + (hi - lo) * i / (gN - 1), r = at(x);
    grid.push([x, r.p, r.lo, r.hi]);
  }
  return { knots, b: fit.b, cov: fit.cov, grid, at, n: X.length, separated: fit.separated, converged: fit.converged };
}

/* ------------------------------------------------------------ calibration --- */
function auc(p, y) {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const rank = new Float64Array(p.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k]] = r;
    i = j + 1;
  }
  let n1 = 0, sr = 0;
  for (let i = 0; i < p.length; i++) if (y[i] === 1) { n1++; sr += rank[i]; }
  const n0 = p.length - n1;
  return n1 && n0 ? (sr - n1 * (n1 + 1) / 2) / (n1 * n0) : null;
}
function calibration(p, y, o) {
  o = o || {};
  const P = [], Y = [];
  for (let i = 0; i < p.length; i++) if (isNum(p[i]) && isNum(y[i])) { P.push(Mth.min(1 - 1e-12, Mth.max(1e-12, p[i]))); Y.push(y[i] > 0.5 ? 1 : 0); }
  const n = P.length;
  if (!n) return { brier: null, logloss: null, ece: null, auc: null, slope: null, intercept: null, n: 0, bins: [] };
  let brier = 0, ll = 0;
  for (let i = 0; i < n; i++) { brier += (P[i] - Y[i]) * (P[i] - Y[i]); ll -= Y[i] ? Mth.log(P[i]) : Mth.log(1 - P[i]); }
  const idx = P.map((_, i) => i).sort((a, b) => P[a] - P[b]), nb = Mth.min(o.bins || 10, n), out = [];
  let ece = 0;
  for (let k = 0; k < nb; k++) {
    const s = Mth.round(k * n / nb), e = Mth.round((k + 1) * n / nb);
    if (e <= s) continue;
    let sp = 0, sy = 0;
    for (let i = s; i < e; i++) { sp += P[idx[i]]; sy += Y[idx[i]]; }
    out.push([sp / (e - s), sy / (e - s), e - s]);
    ece += Mth.abs(sy - sp);
  }
  const lg = logistic(P.map(v => [1, logit(v)]), Y, { maxIter: 50 });
  return { brier: brier / n, logloss: ll / n, ece: ece / n, auc: auc(P, Y), slope: lg.b[1], intercept: lg.b[0], n, bins: out };
}

/* ------------------------------------------------------------ points into wins --- */
/* pts = b * sdTeam (the net SD); wins = G (Phi(pts / sigma) - 0.5), wins30 the same over 30 games. sigma must be the
   spread around a pre-game expectation (sigma_pred); null when it is under twice sigma_acc (invariant I9) */
function valueScale(o) {
  const sdT = o.sdTeam != null && typeof o.sdTeam === 'object' ? o.sdTeam.net : o.sdTeam, sigma = o.sigma, G = o.G != null ? o.G : 30;
  if (!(sigma > 0) || !isNum(o.b) || !isNum(sdT)) return null;
  if (o.sigmaAcc > 0 && sigma < 2 * o.sigmaAcc) return null;
  const pts = o.b * sdT, e = normCdf(pts / sigma) - 0.5;
  return { pts, wins: G * e, wins30: 30 * e, winsSeason: G * e };
}
function winsOver(mus, delta, sigma) {
  let s = 0;
  for (const m of mus) if (isNum(m)) s += normCdf((m + delta) / sigma) - normCdf(m / sigma);
  return s;
}
/* one game's result split exactly: expected = alpha h + sum beta_k ex_k; parts c_k = beta_k (dx_k - ex_k);
   other = yc - expected - sum c; garbage = y - yc; so y = expected + sum c + other + garbage. With split = {k, dx, ex,
   names: [quality, making]} the part of k divides into beta_k (dx - ex) on the shot-quality measure and the rest. */
function oaxaca(o) {
  const keys = Object.keys(o.beta), parts = {};
  let expected = (o.alpha || 0) * (o.h || 0), sum = 0;
  for (const k of keys) {
    const b = o.beta[k], e = o.ex ? o.ex[k] : 0, d = o.dx ? o.dx[k] : null;
    expected += isNum(e) ? b * e : 0;
    const c = isNum(d) && isNum(e) ? b * (d - e) : 0;
    if (o.split && o.split.k === k) {
      const nm = o.split.names || ['quality', 'making'];
      const q = isNum(o.split.dx) && isNum(o.split.ex) ? b * (o.split.dx - o.split.ex) : 0;
      parts[nm[0]] = q; parts[nm[1]] = c - q;
    } else parts[k] = c;
    sum += c;
  }
  const yc = isNum(o.yc) ? o.yc : o.y;
  return { expected, parts, other: yc - expected - sum, garbage: o.y - yc };
}

/* ------------------------------------------------------------ axis ticks (chartlab's algorithm) --- */
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / Mth.max(1, n), mag = Mth.pow(10, Mth.floor(Mth.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-12) || raw;
  const out = [];
  for (let t = Mth.ceil(lo / step - 1e-9) * step, k = 0; t <= hi + step * 1e-9 && k < 200; t += step, k++) out.push(+t.toFixed(10));
  return { ticks: out, step };
}

return {
  normCdf, normPdf, normInv, logit, expit, log1pexp, rng, normal, hash,
  chol, cholSolve, invSPD, gaussJordan, eigSym, full, packedLen, pidx,
  suff, zeroSuff, copySuff, addSuff, subSuff, sumSuff, pick, sse,
  ridge, cvLambda, clusterCov, blockBootstrap, blockBootstrapSteps, run,
  logistic, corrFromSuff, vif, condNumber, shapleyR2, dersimonianLaird, ebPosterior,
  wilson, fisherCI, fisherP, bh, welchCI, icc, pointBiserial, pearson, mean, sd, quantile,
  lnGamma, betaInc, gammaInc, tCdf, tInv, fP, chi2P,
  bins, nsBasis, gamLogit, calibration, auc, valueScale, winsOver, oaxaca, golden, bisect, niceTicks
};
}));
