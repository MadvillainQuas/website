'use strict';
/* ============================================================================
   LINEUP MIXES (docs/what-wins-model.md A.3). window.EpinoiaWinMix

   The What wins page's lineup builder, worked out in the browser from one members' file (scope 'mix', built by
   EpinoiaWinModel.mixFile): every five a club used this season, summed over its stints (its seconds and both ends'
   box), and an anonymous index of the players with their season rates and role tags. Nothing else is read.

     decode(file)                 -> D: typed arrays, built once (a few milliseconds at the largest unit)
     meets(D, cond)               -> Uint8Array a player: 1 where he meets the condition
     filter(D, conds, o)          -> {sel, in, rest, diff, byCount, unrated}: the fives meeting EVERY condition
                                     (AND) against the rest of the same scope (o.team: one club's fives only)
     agg(D, mask)                 -> one group's minutes, possessions, ratings, four factors at both ends, each with a
                                     95% interval

   A condition: {kind: 'stat', stat, cmp: '>'|'<', x, op: 'ge'|'eq'|'le', n} ("at least / exactly / at most n of the
   five have stat above x") or {kind: 'role', role, op, n}. A player counts toward a stat condition only with
   minRate (100) minutes or more: a rate over a handful of minutes is noise, so he never meets one; an unknown or
   withheld player (index -1) never meets any. The share of the selection's possessions with such a player is
   reported (unrated) so a reader can see how much of it rests on players the rule could not judge.

   INTERVALS. A group's rating is a ratio of sums (points over possessions). Its standard error is the cluster-robust
   one, each five a cluster (the delta method: e_i = a_i - R b_i, se = sqrt(n/(n-1) sum e_i^2) / sum b_i), so the
   stints of one five, which share its players, are not counted as independent. It does not control for the
   opponents' fives (the lineup model in Building a squad says the same). A group under 200 possessions is flagged.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinMix = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const SMALL = 200;                                  // possessions under which a group is flagged (the site's lineup cell rule)
const Z = 1.959963984540054;
const isNum = v => typeof v === 'number' && isFinite(v);
/* the box's order in the file (BOX_KEYS): fga, fgm, f3m, fta, pts, tov, or, dr */
const B = { fga: 0, fgm: 1, f3m: 2, fta: 3, pts: 4, tov: 5, or: 6, dr: 7 };
const possEst = (a, k) => 0.96 * (a[k + B.fga] + a[k + B.tov] + 0.44 * a[k + B.fta] - a[k + B.or]);

/* the file as typed arrays, once */
function decode(file) {
  if (!file || !file.rows || !file.players) return null;
  const R = file.rows, P = file.players, nF = (R.t || []).length, nP = (P.t || []).length;
  const D = { file, nF, nP, stats: file.stats || [], roles: file.roles || [], teams: file.teams || [], pct: file.pct || {}, cuts: file.cuts || null,
    minRate: isNum(file.minRate) ? file.minRate : 100, trim: file.trim || null, n: file.n || {} };
  D.t = Int32Array.from(R.t);
  D.p = Int32Array.from(R.p);
  D.s = Float64Array.from(R.s);
  D.o = Float64Array.from(R.o);
  D.d = Float64Array.from(R.d);
  D.poss = new Float64Array(nF);
  D.pf = new Float64Array(nF);
  D.pa = new Float64Array(nF);
  for (let i = 0; i < nF; i++) {
    D.poss[i] = 0.5 * (possEst(D.o, 8 * i) + possEst(D.d, 8 * i));
    D.pf[i] = D.o[8 * i + B.pts];
    D.pa[i] = D.d[8 * i + B.pts];
  }
  D.pmin = Float64Array.from(P.min || []);
  D.ptag = Uint32Array.from(P.tag || []);
  D.ptm = Int32Array.from(P.t || []);
  D.pv = {};
  D.stats.forEach((k, j) => { const v = (P.v && P.v[j]) || []; const a = new Float64Array(nP); for (let i = 0; i < nP; i++) a[i] = v[i] == null ? NaN : +v[i]; D.pv[k] = a; });
  /* a five with a player no rule can judge: unknown (-1) or under minRate minutes */
  D.unrated = new Uint8Array(nF);
  for (let i = 0; i < nF; i++) for (let j = 0; j < 5; j++) { const q = D.p[5 * i + j]; if (q < 0 || !(D.pmin[q] >= D.minRate)) { D.unrated[i] = 1; break; } }
  pairs(D);                                           // every ratio's a and b a five, once (filter() only adds)
  return D;
}

/* 1 where a player meets the condition */
function meets(D, c) {
  const out = new Uint8Array(D.nP);
  if (!c) return out;
  if (c.kind === 'role') {
    const bit = D.roles.indexOf(c.role);
    if (bit < 0) return out;
    for (let i = 0; i < D.nP; i++) out[i] = (D.ptag[i] >>> bit) & 1;
    return out;
  }
  const v = D.pv[c.stat];
  if (!v || !isNum(+c.x)) return out;
  const x = +c.x, lt = c.cmp === '<';
  for (let i = 0; i < D.nP; i++) out[i] = D.pmin[i] >= D.minRate && isNum(v[i]) && (lt ? v[i] < x : v[i] > x) ? 1 : 0;
  return out;
}
/* how many of each five meet it */
function counts(D, m) {
  const out = new Uint8Array(D.nF);
  for (let i = 0; i < D.nF; i++) { let k = 0; for (let j = 0; j < 5; j++) { const q = D.p[5 * i + j]; if (q >= 0 && m[q]) k++; } out[i] = k; }
  return out;
}
const okCount = (k, c) => { const n = +c.n || 0; return c.op === 'eq' ? k === n : c.op === 'le' ? k <= n : k >= n; };

/* THE ARITHMETIC, ONE PASS. Every number of a group is a ratio of sums R = sum a / sum b (a rating, a factor). Its
   cluster-robust variance needs only five sums a ratio: sum a, sum b, sum a^2, sum ab, sum b^2 (and the count of fives):
   sum (a_i - R b_i)^2 = Saa - 2 R Sab + R^2 Sbb. decode() works out each five's a and b once (NUM, DEN below); a
   filter adds each five's into its group's accumulator, once, whatever the conditions: about 60 additions a five. */
const KEYS = ['net', 'ortg', 'drtg', 'efg', 'tovp', 'orebp', 'ftr', 'defg', 'dtovp', 'dorebp', 'dftr'];
const SCALE = 100;
function pairs(D) {
  const nK = KEYS.length, A = new Float64Array(D.nF * nK), Bv = new Float64Array(D.nF * nK);
  const o = (i, k) => D.o[8 * i + k], d = (i, k) => D.d[8 * i + k];
  for (let i = 0; i < D.nF; i++) {
    const q = i * nK, ps = D.poss[i];
    A[q] = D.pf[i] - D.pa[i]; Bv[q] = ps;
    A[q + 1] = D.pf[i]; Bv[q + 1] = ps;
    A[q + 2] = D.pa[i]; Bv[q + 2] = ps;
    /* the four factors at both ends: offence from the five's own box, defence from its opponents' */
    A[q + 3] = o(i, B.fgm) + 0.5 * o(i, B.f3m); Bv[q + 3] = o(i, B.fga);
    A[q + 4] = o(i, B.tov); Bv[q + 4] = o(i, B.fga) + 0.44 * o(i, B.fta) + o(i, B.tov);
    A[q + 5] = o(i, B.or); Bv[q + 5] = o(i, B.or) + d(i, B.dr);
    A[q + 6] = o(i, B.fta); Bv[q + 6] = o(i, B.fga);
    A[q + 7] = d(i, B.fgm) + 0.5 * d(i, B.f3m); Bv[q + 7] = d(i, B.fga);
    A[q + 8] = d(i, B.tov); Bv[q + 8] = d(i, B.fga) + 0.44 * d(i, B.fta) + d(i, B.tov);
    A[q + 9] = d(i, B.or); Bv[q + 9] = d(i, B.or) + o(i, B.dr);
    A[q + 10] = d(i, B.fta); Bv[q + 10] = d(i, B.fga);
  }
  D.A = A; D.Bv = Bv;
}
/* an accumulator: per ratio Sa, Sb, Saa, Sab, Sbb; then fives, seconds, possessions, points, unrated possessions */
const acc = () => ({ s: new Float64Array(KEYS.length * 5), fives: 0, sec: 0, poss: 0, pf: 0, pa: 0, unr: 0 });
function add(D, G, i) {
  const nK = KEYS.length, q = i * nK, S = G.s;
  for (let k = 0; k < nK; k++) {
    const a = D.A[q + k], b = D.Bv[q + k], z = 5 * k;
    if (!(b === b) || !(a === a)) continue;                  // a NaN (never in a decoded file) is left out
    S[z] += a; S[z + 1] += b; S[z + 2] += a * a; S[z + 3] += a * b; S[z + 4] += b * b;
  }
  G.fives++; G.sec += D.s[i]; G.poss += D.poss[i]; G.pf += D.pf[i]; G.pa += D.pa[i]; if (D.unrated[i]) G.unr += D.poss[i];
}
function finish(G) {
  const out = { fives: G.fives, min: G.sec / 60, poss: G.poss, pf: G.pf, pa: G.pa, small: G.poss < SMALL, unrated: G.poss > 0 ? G.unr / G.poss : 0 };
  const n = G.fives;
  KEYS.forEach((key, k) => {
    const S = G.s, z = 5 * k, Sa = S[z], Sb = S[z + 1];
    if (!(Sb > 0)) { out[key] = { v: null, se: null, lo: null, hi: null }; return; }
    const R = Sa / Sb, e2 = Math.max(0, S[z + 2] - 2 * R * S[z + 3] + R * R * S[z + 4]);
    const se = n > 1 ? Math.sqrt(n / (n - 1) * e2) / Sb : null;
    out[key] = { v: SCALE * R, se: se == null ? null : SCALE * se, lo: se == null ? null : SCALE * (R - Z * se), hi: se == null ? null : SCALE * (R + Z * se) };
  });
  return out;
}
/* one group (a mask a five) */
function agg(D, mask) {
  if (!D.A) pairs(D);
  const G = acc();
  for (let i = 0; i < D.nF; i++) if (mask[i]) add(D, G, i);
  return finish(G);
}
/* the difference of two disjoint groups (independent clusters): its estimate and interval */
const diffOf = (a, b) => {
  if (!a || !b || !isNum(a.v) || !isNum(b.v)) return { v: null, lo: null, hi: null };
  const se = isNum(a.se) && isNum(b.se) ? Math.sqrt(a.se * a.se + b.se * b.se) : null;
  const v = a.v - b.v;
  return { v, se, lo: se == null ? null : v - Z * se, hi: se == null ? null : v + Z * se };
};

/* the fives meeting every condition, against the rest of the scope (all clubs, or o.team's); one pass */
function filter(D, conds, o) {
  o = o || {};
  if (!D.A) pairs(D);
  const list = (conds || []).filter(Boolean);
  const team = o.team != null && o.team !== '' ? D.teams.indexOf(o.team) : -1;
  const cnt = list.map(c => counts(D, meets(D, c)));
  const sel = new Uint8Array(D.nF), IN = acc(), REST = acc(), BY = [0, 1, 2, 3, 4, 5].map(acc);
  for (let i = 0; i < D.nF; i++) {
    if (team >= 0 && D.t[i] !== team) continue;
    /* the others hold: the five is in this condition's count bucket (the dose), and in the group when the first holds too */
    let others = true;
    for (let j = 1; j < list.length && others; j++) others = okCount(cnt[j][i], list[j]);
    if (list.length && others) add(D, BY[cnt[0][i]], i);
    if (others && (!list.length || okCount(cnt[0][i], list[0]))) { sel[i] = 1; add(D, IN, i); } else add(D, REST, i);
  }
  const A = finish(IN), R = finish(REST), diff = {};
  KEYS.forEach(k => { diff[k] = diffOf(A[k], R[k]); });
  /* the dose: the scope's fives by how many of the five meet the FIRST condition (0..5), every other one applied */
  const byCount = list.length ? BY.map((G, k) => { const a = finish(G); return { k, fives: a.fives, poss: a.poss, min: a.min, net: a.net, small: a.small }; }) : [];
  return { sel, in: A, rest: R, diff, byCount, scope: team < 0 ? 'all' : D.teams[team] };
}

/* the presets a reader starts from: role counts, and statistic thresholds at the league's own percentiles */
function presets(D) {
  const P = D && D.pct ? D.pct : {}, out = [];
  const add = (id, label, conds) => { if (conds.every(c => c.kind === 'role' ? D.roles.indexOf(c.role) >= 0 : isNum(c.x))) out.push({ id, label, conds }); };
  add('handlers2', 'Two or more ball handlers', [{ kind: 'role', role: 'handler', op: 'ge', n: 2 }]);
  add('shooters3', 'Three or more shooters', [{ kind: 'role', role: 'shooter', op: 'ge', n: 3 }]);
  add('passers2', 'Two or more passers', [{ kind: 'role', role: 'passer', op: 'ge', n: 2 }]);
  add('nobig', 'No big', [{ kind: 'role', role: 'big', op: 'eq', n: 0 }]);
  add('protector', 'A rim protector and three shooters', [{ kind: 'role', role: 'protector', op: 'ge', n: 1 }, { kind: 'role', role: 'shooter', op: 'ge', n: 3 }]);
  add('slashers2', 'Two or more rim attackers', [{ kind: 'role', role: 'slasher', op: 'ge', n: 2 }]);
  if (P.ast_pct) add('ast', 'Two or more with AST% above the top quarter', [{ kind: 'stat', stat: 'ast_pct', cmp: '>', x: P.ast_pct[2], op: 'ge', n: 2 }]);
  if (P.orb_pct) add('orb', 'One or two with ORB% above the top quarter', [{ kind: 'stat', stat: 'orb_pct', cmp: '>', x: P.orb_pct[2], op: 'ge', n: 1 }, { kind: 'stat', stat: 'orb_pct', cmp: '>', x: P.orb_pct[2], op: 'le', n: 2 }]);
  return out;
}

return { decode, meets, counts, filter, agg, presets, SMALL, KEYS };
}));
