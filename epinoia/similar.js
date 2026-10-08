'use strict';
/* ============================================================================
   SIMILAR PLAYERS - what is compared, how it is scored, and how a file is read back.
   Shared by tools/build-similar.mjs (which works out every player's neighbours once) and by the player page
   (p/similar-ui.js, which only reads the small file the builder wrote for the player).

   WHAT A PLAYER-SEASON IS COMPARED ON (FEATURES), in three groups the page shows as three rows of its own:

     STYLE        how the player plays: usage, assists per usage, where the shots come from (rim / mid-range / three, as a
                  share of the attempts) and how much of each was assisted, how much of the scoring was assisted,
                  half-court and transition shares of the attempts, free-throw rate, and the share of the minutes at
                  each position (the floor position the lineups give the player, depth.js floorPos).
     EFFICIENCY   how well: true shooting, rim / mid / three-point / free-throw accuracy, turnover rate, assist-to-turnover.
     REB / DEF    offensive and defensive rebound rate, steal and block rate, fouls per 30, the team's rating and its
                  opponents' effective field-goal percentage with the player on the floor against off it.

   THE SHOT ZONES (the twelve of the shot chart) are not in the season line, only in the shot logs, so the style group
   compares the three distances; a zone feature is one more entry in FEATURES, built from the logs by the builder.

   HOW A NUMBER BECOMES A MATCH
     1. A rate over few attempts is pulled toward the pool's average in proportion to how little it rests on
        (shrink): 3 of 4 at the rim is not a 75% finisher. Every feature names what it rests on and how many of it
        counts as a full sample (`n`, `k`).
     2. Each feature is put in standard deviations of the pool (z, clipped at +-3), so a point of usage and a point of
        free-throw accuracy weigh by how unusual they are, not by their units.
     3. Two players' distance in a group is the weighted root-mean-square gap of the z-scores they BOTH have (a league
        without play-by-play has no assisted shares: those features simply sit out for that pair, and a group that
        shares under half of its weight is not scored). The overall distance weighs the groups (GROUP_WEIGHT).
     4. A distance becomes a percentage by exp(-(D / tau)^2): tau is set by the builder from the pool's own spread
        (calibrate), so strangers read as low and a near-twin as high whatever the pool's size.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSimilar = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const VERSION = 1;                       // the file layout AND the feature list: a file of another version is not read
const MIN_GP = 4, MIN_MIN = 50;          // the page's rule: four games or fifty minutes
const CLIP = 3;
const NEIGHBOURS = 12;                   // a file's list

/* n: what the feature rests on (a key of the line, or of what rowOf adds); k: how much of it is a full sample.
   mul: the file stores round(value * mul) as a whole number. w: weight inside its group. */
const FEATURES = [
  /* ---- STYLE ---- */
  { k: 'usg',            g: 's', sub: 'role',            label: 'Usage%',                w: 1.0, dp: 1, mul: 10,  n: 'min',  K: 60 },
  { k: 'au',             g: 's', sub: 'role',            label: 'Assists per usage',     w: 0.9, dp: 2, mul: 100, n: 'min',  K: 60 },
  { k: 'rim_rate',       g: 's', sub: 'shot locations',  label: 'Attempts at the rim',   w: 1.2, dp: 1, mul: 10,  n: 'fga',  K: 40, unit: '% of FGA' },
  { k: 'mid_rate',       g: 's', sub: 'shot locations',  label: 'Attempts mid-range',    w: 1.0, dp: 1, mul: 10,  n: 'fga',  K: 40, unit: '% of FGA' },
  { k: 'p3_rate',        g: 's', sub: 'shot locations',  label: 'Attempts from three',   w: 1.2, dp: 1, mul: 10,  n: 'fga',  K: 40, unit: '% of FGA' },
  { k: 'ftr',            g: 's', sub: 'shot locations',  label: 'Free-throw rate',       w: 0.6, dp: 1, mul: 10,  n: 'fga',  K: 40 },
  { k: 'ev_rim_astp',    g: 's', sub: 'assisted',        label: 'Rim makes assisted',    w: 0.6, dp: 1, mul: 10,  n: 'rimM', K: 12, premium: true },
  { k: 'ev_mid_astp',    g: 's', sub: 'assisted',        label: 'Mid-range makes assisted', w: 0.4, dp: 1, mul: 10, n: 'midM', K: 10, premium: true },
  { k: 'ev_p3_astp',     g: 's', sub: 'assisted',        label: 'Threes assisted',       w: 0.6, dp: 1, mul: 10,  n: 'p3m',  K: 10, premium: true },
  { k: 'ev_ast_pts_sh',  g: 's', sub: 'assisted',        label: 'Points assisted',       w: 0.9, dp: 1, mul: 10,  n: 'fgm',  K: 20, premium: true },
  { k: 'ev_half_fga_sh', g: 's', sub: 'situations',      label: 'Half-court attempts',   w: 0.5, dp: 1, mul: 10,  n: 'fga',  K: 40, premium: true },
  { k: 'ev_transition_fga_sh', g: 's', sub: 'situations', label: 'Transition attempts',  w: 0.5, dp: 1, mul: 10,  n: 'fga',  K: 40, premium: true },
  { k: 'pos_pg',         g: 's', sub: 'positions',       label: 'Minutes at PG',         w: 0.7, dp: 0, mul: 1,   n: 'min',  K: 30, unit: '% of minutes' },
  { k: 'pos_sg',         g: 's', sub: 'positions',       label: 'Minutes at SG',         w: 0.7, dp: 0, mul: 1,   n: 'min',  K: 30, unit: '% of minutes' },
  { k: 'pos_sf',         g: 's', sub: 'positions',       label: 'Minutes at SF',         w: 0.7, dp: 0, mul: 1,   n: 'min',  K: 30, unit: '% of minutes' },
  { k: 'pos_pf',         g: 's', sub: 'positions',       label: 'Minutes at PF',         w: 0.7, dp: 0, mul: 1,   n: 'min',  K: 30, unit: '% of minutes' },
  { k: 'pos_c',          g: 's', sub: 'positions',       label: 'Minutes at C',          w: 0.7, dp: 0, mul: 1,   n: 'min',  K: 30, unit: '% of minutes' },
  /* ---- EFFICIENCY ---- */
  { k: 'ts',             g: 'e', sub: 'scoring',         label: 'TS%',                   w: 1.2, dp: 1, mul: 10,  n: 'tsa',  K: 60 },
  { k: 'rim_pct',        g: 'e', sub: 'scoring',         label: 'Rim FG%',               w: 0.8, dp: 1, mul: 10,  n: 'rimA', K: 25 },
  { k: 'mid_pct',        g: 'e', sub: 'scoring',         label: 'Mid-range FG%',         w: 0.5, dp: 1, mul: 10,  n: 'midA', K: 25 },
  { k: 'p3_pct',         g: 'e', sub: 'scoring',         label: '3P%',                   w: 0.8, dp: 1, mul: 10,  n: 'p3a',  K: 40 },
  { k: 'ft_pct',         g: 'e', sub: 'scoring',         label: 'FT%',                   w: 0.6, dp: 1, mul: 10,  n: 'fta',  K: 25 },
  { k: 'tov_pct',        g: 'e', sub: 'ball security',   label: 'Turnover%',             w: 0.8, dp: 1, mul: 10,  n: 'min',  K: 100 },
  { k: 'ast_to',         g: 'e', sub: 'ball security',   label: 'Assist to turnover',    w: 0.6, dp: 2, mul: 100, n: 'tov',  K: 15 },
  /* ---- REBOUNDING AND DEFENCE ---- */
  { k: 'oreb_pct',       g: 'd', sub: 'rebounding',      label: 'OREB%',                 w: 1.0, dp: 1, mul: 10,  n: 'min',  K: 80 },
  { k: 'dreb_pct',       g: 'd', sub: 'rebounding',      label: 'DREB%',                 w: 1.0, dp: 1, mul: 10,  n: 'min',  K: 80 },
  { k: 'stl_pct',        g: 'd', sub: 'defence',         label: 'Steal%',                w: 0.8, dp: 1, mul: 10,  n: 'min',  K: 100 },
  { k: 'blk_pct',        g: 'd', sub: 'defence',         label: 'Block%',                w: 0.8, dp: 1, mul: 10,  n: 'min',  K: 100 },
  { k: 'pf30',           g: 'd', sub: 'defence',         label: 'Fouls per 30',          w: 0.5, dp: 1, mul: 10,  n: 'min',  K: 100 },
  { k: 'diff_drtg',      g: 'd', sub: 'on / off',        label: 'Defensive rating +/-',  w: 0.4, dp: 1, mul: 10,  n: 'on_poss', K: 500, signed: true },
  { k: 'diff_vs_efg',    g: 'd', sub: 'on / off',        label: 'Opponent eFG% +/-',     w: 0.4, dp: 1, mul: 10,  n: 'on_poss', K: 500, signed: true }
];
const IDX = {}; FEATURES.forEach((f, i) => { IDX[f.k] = i; });

const GROUPS = [
  { key: 's', label: 'Style', short: 'Style' },
  { key: 'e', label: 'Efficiency', short: 'Eff' },
  { key: 'd', label: 'Rebounding & defence', short: 'Reb / def' }
];
const GROUP_WEIGHT = { s: 0.45, e: 0.30, d: 0.25 };
const GROUP_FEATURES = {}; GROUPS.forEach(g => { GROUP_FEATURES[g.key] = FEATURES.map((f, i) => (f.g === g.key ? i : -1)).filter(i => i >= 0); });
const GROUP_TOTAL = {}; GROUPS.forEach(g => { GROUP_TOTAL[g.key] = GROUP_FEATURES[g.key].reduce((a, i) => a + FEATURES[i].w, 0); });
const GROUP_NEED = 0.4;                  // the share of a group's weight two players must have in common for it to be scored

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* may this line be compared? four games, or fifty minutes */
function eligible(row) {
  return !!row && ((num(row.gp) || 0) >= MIN_GP || (num(row.min) || 0) >= MIN_MIN);
}

/* what a feature rests on, from a season line */
function restsOn(row, key) {
  if (key === 'tsa') { const a = num(row.fga), b = num(row.fta); return a == null && b == null ? null : (a || 0) + 0.44 * (b || 0); }
  return num(row[key]);
}

/* the pool's averages and spreads of every (shrunk) feature, and each line as a row of z-scores.
   rows: season lines (with pos_* added where the position files had the player). Returns
   { stats: [{ mean, sd, raw }], z: [Float32Array], raw: [number|null][] } in the rows' order. */
function prepare(rows) {
  const nF = FEATURES.length;
  /* the raw mean of each feature over the pool (volume-weighted would favour the busiest; the plain mean is the prior) */
  const raw = FEATURES.map(() => ({ s: 0, n: 0 }));
  rows.forEach(r => FEATURES.forEach((f, i) => { const v = num(r[f.k]); if (v != null) { raw[i].s += v; raw[i].n++; } }));
  const prior = raw.map(a => (a.n ? a.s / a.n : 0));
  const shrunk = rows.map(r => FEATURES.map((f, i) => {
    const v = num(r[f.k]); if (v == null) return null;
    const n = restsOn(r, f.n);
    if (n == null) return v;
    return (v * n + prior[i] * f.K) / (n + f.K);
  }));
  const stats = FEATURES.map((f, i) => {
    let s = 0, n = 0, q = 0;
    shrunk.forEach(a => { const v = a[i]; if (v != null) { s += v; q += v * v; n++; } });
    const mean = n ? s / n : 0, sd = n > 1 ? Math.sqrt(Math.max(0, q / n - mean * mean)) : 0;
    return { mean, sd, n };
  });
  const z = shrunk.map(a => {
    const out = new Float32Array(nF);
    for (let i = 0; i < nF; i++) {
      const v = a[i], st = stats[i];
      out[i] = v == null || !(st.sd > 1e-9) ? NaN : Math.max(-CLIP, Math.min(CLIP, (v - st.mean) / st.sd));
    }
    return out;
  });
  return { stats, z, rows };
}

/* the distance between two lines' z-rows: { d, g: { s, e, d } } (null where not scored), d null when nothing is */
function distance(za, zb) {
  const g = {}; let num_ = 0, den = 0;
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const key = GROUPS[gi].key, list = GROUP_FEATURES[key];
    let w = 0, s = 0;
    for (let j = 0; j < list.length; j++) {
      const i = list[j], a = za[i], b = zb[i];
      if (a !== a || b !== b) continue;                 // NaN: one of them has no such number
      const fw = FEATURES[i].w, x = a - b;
      w += fw; s += fw * x * x;
    }
    if (w >= GROUP_NEED * GROUP_TOTAL[key]) {
      const D = Math.sqrt(s / w);
      g[key] = D; num_ += GROUP_WEIGHT[key] * D * D; den += GROUP_WEIGHT[key];
    } else g[key] = null;
  }
  return { d: den >= 0.55 ? Math.sqrt(num_ / den) : null, g };
}

/* tau for the overall distance and for each group: a fraction of the median distance between strangers, so the scale
   follows the pool (a sample of pairs; deterministic) */
const TAU_OF_MEDIAN = 1.0;
function calibrate(prep, pairs) {
  const n = prep.z.length, want = pairs || 40000;
  const all = [], per = { s: [], e: [], d: [] };
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let t = 0; t < want && n > 1; t++) {
    const a = Math.floor(rnd() * n); let b = Math.floor(rnd() * n); if (a === b) continue;
    const r = distance(prep.z[a], prep.z[b]);
    if (r.d != null) all.push(r.d);
    GROUPS.forEach(gr => { if (r.g[gr.key] != null) per[gr.key].push(r.g[gr.key]); });
  }
  const med = a => { if (!a.length) return 1; a.sort((x, y) => x - y); return a[a.length >> 1]; };
  return { all: med(all) * TAU_OF_MEDIAN, s: med(per.s) * TAU_OF_MEDIAN, e: med(per.e) * TAU_OF_MEDIAN, d: med(per.d) * TAU_OF_MEDIAN };
}
/* a distance as a whole-number percentage, 0-99 (100 is only ever the same line) */
function percent(d, tau) {
  if (d == null || !(tau > 0)) return null;
  return Math.max(0, Math.min(99, Math.round(100 * Math.exp(-((d / tau) * (d / tau))))));
}

/* a name as one person is named across feeds, for telling "the same person in another competition" from a twin */
function nameKey(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(w => !/^(jr|sr|ii|iii|iv)$/.test(w)).join(' ');
}

/* the pool's `count` nearest lines to line `i`, nearest first: [{ j, d, g }] */
function nearest(prep, i, count, skip) {
  const out = [];
  const za = prep.z[i];
  for (let j = 0; j < prep.z.length; j++) {
    if (j === i || (skip && skip(j))) continue;
    const r = distance(za, prep.z[j]);
    if (r.d == null) continue;
    if (out.length < count || r.d < out[out.length - 1].d) {
      out.push({ j, d: r.d, g: r.g });
      out.sort((x, y) => x.d - y.d);
      if (out.length > count) out.pop();
    }
  }
  return out;
}

/* ---- the file a page reads ---------------------------------------------- */
/* the values of a line as the file keeps them: a whole number each (null where there is none) */
function pack(row) { return FEATURES.map(f => { const v = num(row[f.k]); return v == null ? null : Math.round(v * f.mul); }); }
function unpackValue(i, x) { return x == null ? null : x / FEATURES[i].mul; }
/* a value as a page prints it */
function show(i, v) {
  if (v == null) return '—';
  const f = FEATURES[i], s = Number(v).toFixed(f.dp);
  return (f.signed && v > 0 ? '+' : '') + s;
}
/* where the builder puts a competition's file, and where a page reads it */
const filePath = (competitionId, playerId) => 'similar/v' + VERSION + '/' + competitionId + '/' + playerId + '.json';
/* is this a file this layout can read */
function fileOk(j) {
  return !!j && j.v === VERSION && Array.isArray(j.n) && j.me && Array.isArray(j.me.vals) && j.me.vals.length === FEATURES.length;
}

return { VERSION, MIN_GP, MIN_MIN, NEIGHBOURS, FEATURES, IDX, GROUPS, GROUP_WEIGHT, GROUP_FEATURES, eligible, prepare, distance,
         calibrate, percent, nameKey, nearest, pack, unpackValue, show, filePath, fileOk };
}));
