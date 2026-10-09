'use strict';
/* ============================================================================
   MANAGER - PLAYER VALUES (core: no site, no DOM, no database; the standalone game takes this file as it is).

   Louie, 2026-10-09: "a value system assigned to players ... based on a simple index-like rating weighting points above
   most and also valuing minutes played, and weighting bigs slightly higher, weighting athletic bigs w/ block rates the
   most", a typical value RANGE per league (set in the platform's league editor), each player placed in his league's
   range by his index and able to go slightly above or below it, and a boost for the clubs in continental and secondary
   competitions (EuroLeague, EuroCup, Basketball Champions League, FIBA Europe Cup, ABA League).

   THE INDEX (a season line in season.js's player shape):
       base   = PPG + 0.35 RPG + 0.45 APG + 0.6 SPG + 0.6 BPG - 0.5 TOPG          points weigh the most
       × mins   0.6 + 0.4 min(1, MPG / 30)                                         minutes played valued
       × avail  0.7 + 0.3 min(1, GP / the league's games a club)                   and games played
       × big    1 + 0.06 bigness                (bigness: box-score position 3 -> 5 as 0 -> 1)
       × athl   1 + 0.10 bigness × his BLK% between the league bigs' median and their 90th percentile
   THE VALUE: his index's percentile p among his league's players (with 40 minutes or more) sets him in the league's
   range on a convex curve (a market pays stars), value = min + (max - min) p^CURVE (3: tested on real leagues, a squad of
   twelve average wages cannot buy five stars - the top five cost about 145% of it - so depth and stars are a choice and
   no one way of spending it wins; at 2 the stars came cheap), then the league's best go up to 12% over
   the top (the index past the 95th percentile, scaled to the league's highest) and its weakest down to 12% under the
   bottom; a club in a continental competition adds that competition's boost (the largest of its).
   THE WAGE: a season's wage is WAGE_RATE of the value. THE BUDGET: the selected league's average wage x 12 roster spots.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.value = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const isNum = v => typeof v === 'number' && isFinite(v);
const num = v => (v == null || v === '' ? null : (isFinite(+v) ? +v : null));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function quant(a, q) { const x = a.filter(isNum).sort((p, r) => p - r); if (!x.length) return null; const i = (x.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return x[lo] + (x[hi] - x[lo]) * (i - lo); }

/* a league with no range of its own yet: a modest professional league's */
const DEFAULT_RANGE = { min: 25000, max: 450000 };
const WAGE_RATE = 0.16;
const ROSTER = 12;
const MIN_POP = 40;          // minutes for a player to count in his league's percentiles
const OVER = 0.12;           // how far over the top (and under the bottom) a league's outliers go
const CURVE = 3;             // the market's convexity: value = min + (max - min) p^CURVE

/* bigness from the box-score position (1-5): a wing is 0, a centre 1 */
const bigness = r => clamp(((num(r.bpm_pos) != null ? num(r.bpm_pos) : 3) - 3) / 2, 0, 1);
const pg = (r, k) => { const g = num(r.gp) || 0; return g > 0 ? (num(r[k]) || 0) / g : 0; };

/* THE INDEX. ctx: {games: the league's games a club, blk50, blk90: the league bigs' BLK% median and 90th percentile} */
function indexOf(r, ctx) {
  ctx = ctx || {};
  const gp = num(r.gp) || 0, min = num(r.min) || 0;
  if (!(gp > 0) || !(min > 0)) return 0;
  const base = pg(r, 'pts') + 0.35 * pg(r, 'reb') + 0.45 * pg(r, 'ast') + 0.6 * pg(r, 'stl') + 0.6 * pg(r, 'blk') - 0.5 * pg(r, 'tov');
  const mpg = min / gp, G = num(ctx.games) > 0 ? ctx.games : gp;
  const mins = 0.6 + 0.4 * Math.min(1, mpg / 30), avail = 0.7 + 0.3 * Math.min(1, gp / G);
  const b = bigness(r), blk = num(r.blk_pct);
  const athl = isNum(blk) && isNum(ctx.blk50) && isNum(ctx.blk90) && ctx.blk90 > ctx.blk50 ? clamp((blk - ctx.blk50) / (ctx.blk90 - ctx.blk50), 0, 1) : 0;
  return Math.max(0, base) * mins * avail * (1 + 0.06 * b) * (1 + 0.10 * b * athl);
}

/* a league's context for the index: its games a club and its bigs' block rates */
function leagueContext(rows) {
  const ok = rows.filter(r => (num(r.min) || 0) >= MIN_POP);
  const bigs = ok.filter(r => bigness(r) >= 0.5).map(r => num(r.blk_pct)).filter(isNum);
  return { games: Math.max(1, ...rows.map(r => num(r.gp) || 0)), blk50: quant(bigs, 0.5), blk90: quant(bigs, 0.9) };
}

/* THE VALUES OF ONE LEAGUE. rows: its players' season lines; range: {min, max} (DEFAULT_RANGE when it has none);
   boostOf(row) -> the boost (0.15 = 15%) of the largest continental competition his club plays, or 0.
   -> Map id -> {idx, pct, value, wage, boost} */
function priceLeague(rows, range, boostOf) {
  const R = range && isNum(+range.min) && isNum(+range.max) && +range.max > +range.min ? { min: +range.min, max: +range.max } : DEFAULT_RANGE;
  const ctx = leagueContext(rows);
  const all = rows.map(r => ({ r, idx: indexOf(r, ctx) }));
  const pop = all.filter(x => (num(x.r.min) || 0) >= MIN_POP).map(x => x.idx).sort((a, b) => a - b);
  const p5 = quant(pop, 0.05), p95 = quant(pop, 0.95), lo = pop.length ? pop[0] : 0, hi = pop.length ? pop[pop.length - 1] : 0;
  const pctOf = v => { if (!pop.length) return 0.5; let below = 0, eq = 0; for (const x of pop) { if (x < v) below++; else if (x === v) eq++; } return clamp((below + 0.5 * eq) / pop.length, 0, 1); };
  const out = new Map();
  all.forEach(({ r, idx }) => {
    const p = pctOf(idx);
    let value = R.min + (R.max - R.min) * Math.pow(p, CURVE);
    /* the outliers: over the top, under the bottom */
    if (isNum(p95) && idx > p95 && hi > p95) value *= 1 + OVER * clamp((idx - p95) / (hi - p95), 0, 1);
    if (isNum(p5) && idx < p5 && p5 > lo) value *= 1 - OVER * clamp((p5 - idx) / (p5 - lo), 0, 1);
    const boost = typeof boostOf === 'function' ? Math.max(0, num(boostOf(r)) || 0) : 0;
    value *= 1 + boost;
    value = roundMoney(value);
    out.set(String(r.id), { idx, pct: p, value, wage: roundMoney(value * WAGE_RATE), boost });
  });
  return out;
}
/* money as a market prints it: two significant figures (450,000; 1,200,000; 37,000) */
function roundMoney(v) {
  if (!(v > 0)) return 0;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  return Math.round(v / mag) * mag;
}
/* the budget for a squad in a league: its players' average wage (those with MIN_POP minutes) x ROSTER */
function budgetOf(priced, rows) {
  const ws = rows.filter(r => (num(r.min) || 0) >= MIN_POP).map(r => (priced.get(String(r.id)) || {}).wage).filter(isNum);
  return ws.length ? roundMoney(ROSTER * ws.reduce((a, v) => a + v, 0) / ws.length) : 0;
}
/* "€1.2M", "€450K" */
function money(v, cur) {
  const c = cur || '€';
  if (!isNum(v)) return '–';
  if (v >= 1e6) return c + (Math.round(v / 1e5) / 10).toString().replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return c + Math.round(v / 1e3) + 'K';
  return c + Math.round(v);
}

return { indexOf, leagueContext, priceLeague, budgetOf, roundMoney, money, bigness, DEFAULT_RANGE, WAGE_RATE, ROSTER, MIN_POP, OVER, CURVE };
}));
