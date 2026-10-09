'use strict';
/* ============================================================================
   MANAGER - THE 1-20 ATTRIBUTES (core). FOR THE EYE ONLY (Louie, 2026-10-09: "the FM style attributes are for visuals for
   players, not the actual underlying mechanisms"): the simulator never reads them, it runs the What wins model on the
   players' own rates (engine.js).

   Each attribute is a weighted blend of percentiles among a population (his league's players with 150 minutes or more),
   shrunk toward the middle for a small sample (minutes / (minutes + 250)), set on 1-20, and - for the skills, never for
   usage, which is a role - moved by the league's level (its value range against the platform's median league: up to 3
   points either way), so 15 in a strong league is more than 15 in a weak one. A part a line does not have (no
   play-by-play splits) is left out and the rest re-weighted.
     USG%              usage
     Rim attack        rim attempts per 100 (0.4), unassisted share of rim makes (0.2), rim FG% (0.4)
     Mid attack        the same at the mid-range
     3PT shooting      threes per 100 (0.35), unassisted share of made threes (0.15), 3P% (0.5)
     Passing           AST/USG (0.8), TOV% (0.2, the fewer the better)
     Handling pressure AST% over TOV% (0.8), the unassisted share of his points (0.2)
     Motor             STL% (0.5) and ORB% (0.5)
     Rim protection    BLK% (0.6) and rim points saved per 100 with him on (0.4)
     Hands             STL%
     Off. boards       ORB%
     Def. boards       DRB% (0.75) and the opponents' ORB% with him on minus off (0.25, the lower the better)
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.ratings = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const isNum = v => typeof v === 'number' && isFinite(v);
const num = v => (v == null || v === '' ? null : (isFinite(+v) ? +v : null));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* the parts each attribute is made of: [field (or a function of the line), weight (negative: lower is better)] */
const un = k => r => { const a = num(r[k]); return isNum(a) ? 100 - a : null; };
const ratio = (a, b) => r => { const x = num(r[a]), y = num(r[b]); return isNum(x) && isNum(y) && y > 0 ? x / y : null; };
function rimSave(r) {
  const von = num(r.def_rim_vol_on), voff = num(r.def_rim_vol_off), fon = num(r.def_rim_fg_on), foff = num(r.def_rim_fg_off);
  return [von, voff, fon, foff].every(isNum) ? 2 * (voff * foff - von * fon) / 100 : null;
}
const ATTRS = [
  { k: 'usg', label: 'USG%', skill: false, parts: [['usg', 1]] },
  { k: 'rim', label: 'Rim attack', skill: true, parts: [['rim_a100', 0.4], [un('ev_rim_astp'), 0.2], ['rim_pct', 0.4]] },
  { k: 'mid', label: 'Mid attack', skill: true, parts: [['mid_a100', 0.4], [un('ev_mid_astp'), 0.2], ['mid_pct', 0.4]] },
  { k: 'three', label: '3PT shooting', skill: true, parts: [['p3_a100', 0.35], [un('ev_p3_astp'), 0.15], ['p3_pct', 0.5]] },
  { k: 'pass', label: 'Passing', skill: true, parts: [['au', 0.8], ['tov_pct', -0.2]] },
  { k: 'handle', label: 'Handling pressure', skill: true, parts: [[ratio('ast_pct', 'tov_pct'), 0.8], ['ev_unast_pts_sh', 0.2]] },
  { k: 'motor', label: 'Motor', skill: true, parts: [['stl_pct', 0.5], ['oreb_pct', 0.5]] },
  { k: 'rimp', label: 'Rim protection', skill: true, parts: [['blk_pct', 0.6], [rimSave, 0.4]] },
  { k: 'hands', label: 'Hands', skill: true, parts: [['stl_pct', 1]] },
  { k: 'oreb', label: 'Off. boards', skill: true, parts: [['oreb_pct', 1]] },
  { k: 'dreb', label: 'Def. boards', skill: true, parts: [['dreb_pct', 0.75], ['diff_vs_oreb', -0.25]] }
];
const POP_MIN = 150, SHRINK = 250, TIER_MAX = 3;
const valOf = (r, f) => (typeof f === 'function' ? f(r) : num(r[f]));

/* a population's sorted values for each part (its players with POP_MIN minutes), made once per league */
function population(rows) {
  const pop = rows.filter(r => (num(r.min) || 0) >= POP_MIN);
  const cols = new Map();
  ATTRS.forEach(a => a.parts.forEach(([f]) => {
    if (cols.has(f)) return;
    cols.set(f, pop.map(r => valOf(r, f)).filter(isNum).sort((x, y) => x - y));
  }));
  return { cols, n: pop.length };
}
function pctIn(sorted, v) {
  if (!sorted || sorted.length < 5 || !isNum(v)) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return clamp((lo + 0.5 * (eq - lo)) / sorted.length, 0, 1);
}
/* the league's level, from its value range against the median league's (both midpoints): -1 .. 1 */
function tierOf(range, median) {
  const mid = r => (r && isNum(+r.min) && isNum(+r.max) ? (+r.min + +r.max) / 2 : null);
  const a = mid(range), b = mid(median);
  return isNum(a) && isNum(b) && a > 0 && b > 0 ? clamp(Math.log10(a / b) / 1, -1, 1) : 0;
}
/* one player's attributes: {usg: 14, rim: 9, ...} (null where nothing could be read) */
function rate(r, pop, tier) {
  const out = {}, min = num(r.min) || 0, w = min / (min + SHRINK);
  ATTRS.forEach(a => {
    let s = 0, W = 0;
    a.parts.forEach(([f, wt]) => {
      const p = pctIn(pop.cols.get(f), valOf(r, f));
      if (!isNum(p)) return;
      s += Math.abs(wt) * (wt < 0 ? 1 - p : p); W += Math.abs(wt);
    });
    if (!(W > 0)) { out[a.k] = null; return; }
    const sc = 0.5 + (s / W - 0.5) * w;
    let v = 1 + 19 * sc;
    if (a.skill && isNum(tier)) v += TIER_MAX * tier;
    out[a.k] = Math.round(clamp(v, 1, 20));
  });
  return out;
}
/* a league's players rated: Map id -> attributes */
function rateLeague(rows, range, median) {
  const pop = population(rows), tier = tierOf(range, median), out = new Map();
  rows.forEach(r => out.set(String(r.id), rate(r, pop, tier)));
  return out;
}
/* the colour band of an attribute, as the game prints it: 1-5 low, 6-10, 11-15, 16-20 high */
const band = v => (!isNum(v) ? '' : v >= 16 ? 'a4' : v >= 11 ? 'a3' : v >= 6 ? 'a2' : 'a1');

return { ATTRS, population, rate, rateLeague, tierOf, band, rimSave, POP_MIN };
}));
