'use strict';
/* ============================================================================
   WHAT WINS: THE MODEL BUILDER'S ARITHMETIC (docs/what-wins-model.md §6-§9, §14, A.1, A.2).   window.EpinoiaWinModel

   Pure: no I/O. tools/build-analytics.mjs reads the database and the bucket and hands this file a unit's private
   store; this file sums it into every number the What wins page and the Front office draw, and hands back plain
   JSON files. The Edge Function analytics-file runs the same file (supabase/functions/_shared/winmodel.js, generated)
   for RECALCULATE: update(store, delta) adds the few games finalised since the last build.

   THE THREE LENSES, NEVER MIXED (§0.2)
     Explain   same-game differences against the margin: core4c (competitive four factors), the shot model, the
               extended set with the path model, the scan and the curves. Accounting, not levers.
     Forecast  season-to-date profiles, Elo and the schedule, validated on games the model had not seen (rolling
               origin from the fourth ISO week), against home-only, Elo, net rating and Pythagorean baselines.
     Simulate  EpinoiaWinSim, its league parameters fitted on all games but VALIDATED rolling origin: the later games
               are simulated with parameters fitted only on the games before them, and those held-out predictions
               decide whether it may speak in absolute probabilities ("calibrated") or only in relative ones
               ("experimental"). The in-sample score is reported apart and never gated.

   THE STORE (§6.2) holds the unit's compact lines: per game its two 108-count feature rows, its quality bits, its
   player lines (18 numbers) and its lineup stints (11 numbers), plus the context the files need (clubs, rosters,
   heights, ages, the withheld players, venues, fixtures, the pooled priors) and `carry`: the intervals and the
   simulator calibration of the last FULL build. Every sufficient statistic (block X'X / X'y, team season sums, rate
   sums, slot minutes, bin sums) is summed from those lines in O(n p): a few milliseconds at a thousand games.

   FULL AND UPDATE (A.2). buildUnit(input, {mode: 'full'}) fits everything, bootstraps every interval (B = 400, 200
   for builder-only fits) and calibrates the simulator. mode 'update' runs exactly the same point-estimate code on the
   same lines, skips the draws and the calibration and takes those from `carry` (ci_at says when they were made). So
   update(store, delta) equals a full build of the union in every point estimate (ww-winmodel checks 1e-9).

   DETERMINISM. Every draw is seeded from FNV(token); games, players and stints are kept in one canonical order, so
   the same lines give byte-identical files and an incremental store equals one built from nothing.

   PRIVACY (I6). No player names anywhere; per-player rows leave out withheld players; a club file holds only that
   club's games; no file holds a per-game feature vector; every block covers at least eight games.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------------ the modules it reads --- */
/* globals on a page and in Deno (imported first, for their side effect), modules in node; asked for when used */
const dep = (g, file) => root[g] || (typeof require === 'function' ? (() => { try { return require(file); } catch (_) { return null; } })() : null);
const FT = () => dep('EpinoiaFeatures', './features.js');
const WS = () => dep('EpinoiaWinStats', './winstats.js');
const SIM = () => dep('EpinoiaWinSim', './winsim.js');
const BPMm = () => dep('EpinoiaBPM', './bpm.js');
const DEPTH = () => dep('EpinoiaDepth', './t/depth.js');
const WINNING = () => dep('EpinoiaWinning', './winning.js');

/* STORE_V 2 (A.3): the player lines and the stints carry byte sidecars (zones and unassisted makes; each stint's box at
   both ends). A store of version 1 still decodes (the new columns read unknown), but the builder rebuilds it from
   nothing and RECALCULATE leaves it to the builder (update() answers stale).
   STORE_V 3 (2026-10-07): the player lines' sidecar also carries a3, a2 (the threes and twos a player ASSISTED, from the
   feature row's st.u[3], st.u[4]); a v2 store decodes with them unknown, and is rebuilt as v1 was */
const FILE_V = 1, CODE_V = 3, STORE_V = 3;
/* the simulator calibration's own version, carried in store.carry.sim: 2 = the trip offset, the FT-rate gate and the
   intercept-free Platt map (R2S-1, R2S-3); a carried calibration of another version is fitted again */
const SIMCAL_V = 2;
/* raw bytes a file may take (§6.6); fo is 150 KB above 800 games */
/* mix (A.3): the lineup mixes' fives, raw bytes; about a quarter of it gzipped (well under 100 KB a league-season) */
const BUDGET = Object.freeze({ teaser: 40000, wins: 300000, winsPool: 400000, fo: 100000, foBig: 150000, foBase: 60000, foPerClub: 450, club: 25000, pos: 6000, mix: 360000 });
const BIG_GAMES = 800;
/* §12: the GM's measures (t/depth.js MEASURES) the model can value, and the factor and end each reads */
const KEYMAP = Object.freeze({
  ff_efg: ['c_efg', 'off'], dff_efg: ['c_efg', 'def'], ff_tov: ['c_tovp', 'off'], dff_tov: ['c_tovp', 'def'],
  ff_oreb: ['c_orebp', 'off'], dff_oreb: ['c_orebp', 'def'], ff_ftr: ['c_ftr', 'off'], dff_ftr: ['c_ftr', 'def'],
  p3_pct: ['p3p', 'off'], ft_pct: ['ftp', 'off'], rim_pct: ['rimp', 'off']
});
/* the four factors (A.3): the free-throw factor is the ATTEMPT rate, FTA / FGA (how often a side gets to the line),
   as the GM's measures (t/depth.js ff_ftr) and the simulator's ftr edit read it; FT% is a measure of its own */
const CORE = ['c_efg', 'c_tovp', 'c_orebp', 'c_ftr'];
const FULL4 = ['efg', 'tovp', 'orebp', 'ftr'];
const CHECK4 = FULL4;                                       // §16 live acceptance: the full-game four factors
const SHOT = ['rimr', 'midr', 'rimp', 'midp', 'p3p', 'tovp', 'orebp', 'ftr', 'ftp'];
const STYLE = ['top_avg', 'early_share', 'tr_freq', 'sc_freq', 'ast_share', 'p3r', 'rimr', 'live_share', 'foul100', 'trips100',
  'usg_hhi', 'top5_min_share'];
/* the extended model's Shapley groups (§7.6) */
const EXT_GROUPS = [['shooting', ['c_efg', 'p3r', 'rimr']], ['turnovers', ['c_tovp', 'live_share']], ['boards', ['c_orebp']],
  ['free throws', ['c_ftr', 'trips100']], ['tempo and possession', ['top_avg', 'early_share']], ['transition', ['tr_freq', 'sc_freq']],
  ['ball movement and usage', ['ast_share', 'usg_hhi', 'top5_min_share']], ['fouling', ['foul100']]];
const OLIVER = Object.freeze({ c_efg: 40, c_tovp: 25, c_orebp: 20, c_ftr: 15 });
/* the Front office's levers beyond core4c (§12 block 2) and the model each is valued from */
/* FT% (ftp) here, not the attempt rate: that is the core four's own free-throw factor now (A.3) */
const LEVERS = ['rimr', 'p3r', 'rimp', 'p3p', 'tr_freq', 'top_avg', 'live_share', 'ftp'];
const PROP = { c_efg: 1, c_tovp: 1, c_orebp: 1 };          // proportions (in %): blended on the logit scale (§7.8)
const GROUPS3 = ['G', 'F', 'C'];
const P1_STATS = ['ts', 'usg_share', 'ast_share', 'reb_share', 'stocks40', 'tov_share', 'p3a_rate'];
const SHARE_STATS = ['usg_share', 'ast_share', 'reb_share', 'tov_share'];
const SQUAD_KEYS = ['rot_n', 'top5_share', 'star_pts_share', 'usg_hhi', 'pos_entropy', 'shooters', 'handlers', 'protectors',
  'height_w', 'age_w', 'bench_share', 'depth_bpm', 'talent', 'continuity', 'starter_stability', 'availability',
  /* A.3: the new roles in the rotation (players with 10 minutes a game or more) */
  'passers', 'slashers', 'crashers', 'glass', 'disruptors'];
/* A.3: each role's count key in the squad features and its tag */
const ROLE_SQUAD = { shooter: 'shooters', handler: 'handlers', passer: 'passers', slasher: 'slashers', crasher: 'crashers', glass: 'glass', protector: 'protectors', disruptor: 'disruptors' };
const ELO_K = 20, ELO_0 = 1500;                             // sos.js's K_FACTOR and INITIAL_ELO, and its margin multiplier
const MIN = { own: 20, shown: 200, bin: 30, hard: 50, team: 8, test: 3, gate: 60, faint: 200, squad: 50, p2f: 200 };

/* ------------------------------------------------------------------ small things --- */
const isNum = v => typeof v === 'number' && isFinite(v);
const nn = v => (isNum(v) ? v : null);
const sum = a => { let s = 0; for (const v of a) if (isNum(v)) s += v; return s; };
const meanOf = a => { let s = 0, n = 0; for (const v of a) if (isNum(v)) { s += v; n++; } return n ? s / n : NaN; };
const sdOf = a => {
  const v = a.filter(isNum), n = v.length;
  if (n < 2) return NaN;
  const m = v.reduce((x, y) => x + y, 0) / n;
  return Math.sqrt(v.reduce((x, y) => x + (y - m) * (y - m), 0) / (n - 1));
};
const median = a => { const v = a.filter(isNum).sort((x, y) => x - y); return v.length ? WS().quantile(v, 0.5) : NaN; };
const qtl = (a, q) => { const v = a.filter(isNum).sort((x, y) => x - y); return v.length ? WS().quantile(v, q) : NaN; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sig4 = v => (isNum(v) ? (v === 0 ? 0 : +v.toPrecision(4)) : null);
const r1 = v => (isNum(v) ? Math.round(v * 10) / 10 : null);
const r2d = v => (isNum(v) ? Math.round(v * 100) / 100 : null);
const ci = (v, lo, hi) => ({ v: nn(v), lo: nn(lo), hi: nn(hi) });
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fnv = s => WS().hash(String(s));
const DAY = 86400000;

/* the ISO week (Monday start) of a time: 'YYYY-Www' */
function isoWeek(ms) {
  const d = new Date(ms), day = (d.getUTCDay() + 6) % 7;
  const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const y = th.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((th - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return y + '-W' + (w < 10 ? '0' : '') + w;
}

/* ------------------------------------------------------------------ base64 of typed arrays (little-endian) --- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64enc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const t = (a << 16) | (b << 8) | c;
    s += B64[(t >> 18) & 63] + B64[(t >> 12) & 63] + (i + 1 < bytes.length ? B64[(t >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[t & 63] : '=');
  }
  return s;
}
const B64I = (() => { const m = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i; return m; })();
function b64dec(s) {
  s = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor(s.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64I[s.charCodeAt(i)], b = B64I[s.charCodeAt(i + 1)], c = i + 2 < s.length ? B64I[s.charCodeAt(i + 2)] : 0, d = i + 3 < s.length ? B64I[s.charCodeAt(i + 3)] : 0;
    const t = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (t >> 16) & 255;
    if (o < out.length && i + 2 < s.length) out[o++] = (t >> 8) & 255;
    if (o < out.length && i + 3 < s.length) out[o++] = t & 255;
  }
  return out.subarray(0, o);
}
function f32enc(vals) {
  const dv = new DataView(new ArrayBuffer(vals.length * 4));
  for (let i = 0; i < vals.length; i++) dv.setFloat32(i * 4, isNum(vals[i]) ? vals[i] : NaN, true);
  return b64enc(new Uint8Array(dv.buffer));
}
function f32dec(s) {
  const by = b64dec(s), dv = new DataView(by.buffer, by.byteOffset, by.byteLength), n = by.byteLength >> 2, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}
function i32enc(vals) {
  const dv = new DataView(new ArrayBuffer(vals.length * 4));
  for (let i = 0; i < vals.length; i++) dv.setInt32(i * 4, vals[i] | 0, true);
  return b64enc(new Uint8Array(dv.buffer));
}
function i32dec(s) {
  const by = b64dec(s), dv = new DataView(by.buffer, by.byteOffset, by.byteLength), n = by.byteLength >> 2, out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt32(i * 4, true);
  return out;
}

/* ------------------------------------------------------------------ rows as columns (data.js pack's layout) --- */
function packRows(rows) {
  if (!Array.isArray(rows)) return rows;
  const k = [], at = new Map();
  const has = (r, n) => Object.prototype.hasOwnProperty.call(r, n) && r[n] !== undefined;
  rows.forEach(r => Object.keys(r).forEach(n => { if (has(r, n) && !at.has(n)) { at.set(n, k.length); k.push(n); } }));
  const x = {};
  const v = rows.map((r, i) => k.map((n, j) => { if (has(r, n)) return r[n]; (x[i] = x[i] || []).push(j); return null; }));
  return { k, v, x };
}
function unpackRows(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  const k = p.k || [], x = p.x || {};
  return (p.v || []).map((vals, i) => {
    const r = {}, skip = x[i] ? new Set(x[i]) : null;
    for (let j = 0; j < k.length; j++) if (!skip || !skip.has(j)) r[k[j]] = vals[j];
    return r;
  });
}

/* ================================================================== THE STORE (§6.2) ===
   { v, fv, league, season, wm: {at, id}, n,
     games: pack([{id, d: 'YYYY-MM-DD', t: tip-off ms, c: comp index, k: 'l'|'c'|'p', h, a, hs, as, v: venue | '', s0, s1, fa}]),
     comps: [ids], F: base64 Float32Array(n x 2 x 108), Q: base64 Int32Array(n x 2),
     pgs: {players: [ids], rows: base64 Float32Array(m x 18), x: base64 Uint8Array(m x 6)},
     stints: {rows: base64 Float32Array(s x 11), box: base64 Uint8Array(s x 16)}, ctx, carry, ci_at }
   pgs row: gameIdx, side, playerIdx, min (minutes), pts, fga, fgm, fg3a, fg3m, fta, ftm, or, dr, ast, stl, blk, to, pf.
   stint row: gameIdx, side, p0..p4 (player indexes, -1 unknown), poss, pf, pa, dur (s). fa = the game's finalised_at,
   kept so a re-finalised game can be told apart and the watermark rebuilt.
   v2 sidecars (A.3), one byte a count, 255 = not known: pgs x = rimA, rimM, midA, midM (the engine's zones; unknown on a
   side without the ZONES bit), unFgm, unPts (unassisted makes and their points, from the feature row's st.u), a3, a2 (v3: the
   threes and twos he assisted, st.u[3], st.u[4]); stint box =
   the five's own fga, fgm, f3m, fta, pts, tov, or, dr, then the opponents' the same (lineup_stints' off and def). */
const PGS_COLS = ['g', 'side', 'p', 'min', 'pts', 'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm', 'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf'];
const PGX_COLS = ['rimA', 'rimM', 'midA', 'midM', 'unFgm', 'unPts', 'a3', 'a2'];
const PGX_V2 = 6;                                          // a v2 store's sidecar: the first six
const BOX_KEYS = ['fga', 'fgm', 'f3m', 'fta', 'pts', 'tov', 'or', 'dr'];
const STB_COLS = BOX_KEYS.map(k => 'o' + k).concat(BOX_KEYS.map(k => 'd' + k));
const U8_NA = 255;
const u8 = v => (isNum(v) && v >= 0 && v < U8_NA ? Math.round(v) : U8_NA);
const fromU8 = b => (b === U8_NA ? NaN : b);
function u8enc(vals) { const a = new Uint8Array(vals.length); for (let i = 0; i < vals.length; i++) a[i] = u8(vals[i]); return b64enc(a); }
function u8dec(s) { return s ? b64dec(s) : new Uint8Array(0); }
const STINT_COLS = ['g', 'side', 'p0', 'p1', 'p2', 'p3', 'p4', 'poss', 'pf', 'pa', 'dur'];
const KIND = { league: 'l', cup: 'c', playoff: 'p', playoffs: 'p', tournament: 'c' };
const STINT_GAMES = 3000;

function emptyStore(league, season) {
  return { v: STORE_V, fv: (FT() && FT().FV) || 1, league: league || null, season: season || null,
    wm: { at: '1970-01-01T00:00:00Z', id: '00000000-0000-0000-0000-000000000000' }, n: 0,
    games: packRows([]), comps: [], F: '', Q: '', pgs: { players: [], rows: '' }, stints: { rows: '' }, ctx: null, carry: null, ci_at: null };
}

/* the store as working arrays: {games: [{..., F: [Float64Array x2], q: [q0, q1]}], players, pgs: [...], stints: [...]} */
function decodeStore(store) {
  const s = store || emptyStore();
  const N = (FT() && FT().N) || 108;
  const games = unpackRows(s.games);
  const F = s.F ? f32dec(s.F) : new Float64Array(0), Q = s.Q ? i32dec(s.Q) : new Int32Array(0);
  games.forEach((g, i) => {
    g.F = [F.subarray((2 * i) * N, (2 * i + 1) * N), F.subarray((2 * i + 1) * N, (2 * i + 2) * N)];
    g.q = [Q[2 * i] | 0, Q[2 * i + 1] | 0];
  });
  const players = (s.pgs && s.pgs.players) || [];
  const pr = s.pgs && s.pgs.rows ? f32dec(s.pgs.rows) : new Float64Array(0), pgs = [];
  const px = u8dec(s.pgs && s.pgs.x), nP = Math.floor(pr.length / PGS_COLS.length);
  const xw = nP > 0 && px.length === nP * PGX_COLS.length ? PGX_COLS.length : nP > 0 && px.length === nP * PGX_V2 ? PGX_V2 : 0, hasX = xw > 0;
  for (let i = 0, r = 0; i + PGS_COLS.length <= pr.length; i += PGS_COLS.length, r++) {
    const o = {};
    PGS_COLS.forEach((k, j) => { o[k] = pr[i + j]; });
    o.g |= 0; o.side |= 0; o.p |= 0;
    PGX_COLS.forEach((k, j) => { o[k] = hasX && j < xw ? fromU8(px[r * xw + j]) : NaN; });
    pgs.push(o);
  }
  const sr = s.stints && s.stints.rows ? f32dec(s.stints.rows) : new Float64Array(0), stints = [];
  const sb = u8dec(s.stints && s.stints.box), nS = Math.floor(sr.length / STINT_COLS.length), hasB = sb.length === nS * STB_COLS.length;
  for (let i = 0, r = 0; i + STINT_COLS.length <= sr.length; i += STINT_COLS.length, r++) {
    const o = { g: sr[i] | 0, side: sr[i + 1] | 0, p: [sr[i + 2] | 0, sr[i + 3] | 0, sr[i + 4] | 0, sr[i + 5] | 0, sr[i + 6] | 0],
      poss: sr[i + 7], pf: sr[i + 8], pa: sr[i + 9], dur: sr[i + 10] };
    o.box = hasB ? Array.from(sb.subarray(r * STB_COLS.length, (r + 1) * STB_COLS.length), fromU8) : null;
    stints.push(o);
  }
  return { games, players, pgs, stints, comps: s.comps || [] };
}

/* working arrays back into a store, in the canonical order: games by (tip-off, id), players by id, player lines by
   (game, side, player id), stints by (game, side, players, duration). The same lines give the same bytes. */
function encodeStore(base, W) {
  const N = (FT() && FT().N) || 108;
  const order = W.games.map((g, i) => i).sort((a, b) => (W.games[a].t - W.games[b].t) || byId(W.games[a].id, W.games[b].id));
  const remap = new Int32Array(W.games.length).fill(-1);
  order.forEach((o, i) => { remap[o] = i; });
  const games = order.map(i => W.games[i]);
  const used = new Set();
  W.pgs.forEach(r => { if (remap[r.g] >= 0) used.add(W.players[r.p]); });
  W.stints.forEach(r => { if (remap[r.g] >= Math.max(0, games.length - STINT_GAMES)) r.p.forEach(p => { if (p >= 0) used.add(W.players[p]); }); });
  const players = Array.from(used).filter(Boolean).sort(byId), pAt = new Map(players.map((p, i) => [p, i]));
  const pidx = p => (p >= 0 && W.players[p] != null && pAt.has(W.players[p]) ? pAt.get(W.players[p]) : -1);
  const comps = Array.from(new Set(games.map(g => g.cid).filter(Boolean).concat((W.comps || []).filter(Boolean)))).sort(byId);
  const cAt = new Map(comps.map((c, i) => [c, i]));
  const F = new Float64Array(games.length * 2 * N), Q = new Int32Array(games.length * 2);
  games.forEach((g, i) => {
    for (let s = 0; s < 2; s++) { F.set(g.F[s].length === N ? g.F[s] : Float64Array.from({ length: N }, (_, j) => g.F[s][j]), (2 * i + s) * N); Q[2 * i + s] = g.q[s] | 0; }
  });
  const pg = W.pgs.filter(r => remap[r.g] >= 0 && pidx(r.p) >= 0).map(r => Object.assign({}, r, { g: remap[r.g], p: pidx(r.p) }))
    .sort((a, b) => (a.g - b.g) || (a.side - b.side) || (a.p - b.p));
  const pgFlat = [], pgX = [];
  pg.forEach(r => { PGS_COLS.forEach(k => pgFlat.push(r[k])); PGX_COLS.forEach(k => pgX.push(r[k])); });
  /* stints: every game up to STINT_GAMES, else the latest STINT_GAMES (§6.2) */
  const stintFrom = Math.max(0, games.length - STINT_GAMES);
  const boxKey = r => (r.box ? r.box.map(v => (isNum(v) ? v : U8_NA)).join(',') : '');
  const st = W.stints.filter(r => remap[r.g] >= stintFrom).map(r => ({ g: remap[r.g], side: r.side, p: r.p.map(pidx), poss: r.poss, pf: r.pf, pa: r.pa, dur: r.dur, box: r.box || null }))
    .sort((a, b) => (a.g - b.g) || (a.side - b.side) || byId(a.p.join(','), b.p.join(',')) || (a.dur - b.dur) || (a.pf - b.pf) || (a.pa - b.pa) || byId(boxKey(a), boxKey(b)));
  const stFlat = [], stBox = [];
  st.forEach(r => { stFlat.push(r.g, r.side, r.p[0], r.p[1], r.p[2], r.p[3], r.p[4], r.poss, r.pf, r.pa, r.dur); STB_COLS.forEach((k, j) => stBox.push(r.box ? r.box[j] : NaN)); });
  const rows = games.map(g => ({ id: g.id, d: g.d, t: g.t, c: g.cid != null && cAt.has(g.cid) ? cAt.get(g.cid) : -1, k: g.k || 'l', h: g.h, a: g.a,
    hs: g.hs, as: g.as, v: g.v || '', s0: g.s0 >>> 0, s1: g.s1 >>> 0, fa: g.fa || '' }));
  /* the watermark: the newest (finalised_at, id) the store has seen, never moved back */
  let wm = (base && base.wm) || emptyStore().wm;
  games.forEach(g => { if (g.fa && (g.fa > wm.at || (g.fa === wm.at && g.id > wm.id))) wm = { at: g.fa, id: g.id }; });
  if (W.wm && (W.wm.at > wm.at || (W.wm.at === wm.at && W.wm.id > wm.id))) wm = W.wm;
  return Object.assign({}, base || emptyStore(), {
    v: STORE_V, fv: (base && base.fv) || (FT() && FT().FV) || 1, wm: { at: wm.at, id: wm.id }, n: games.length,
    games: packRows(rows), comps, F: f32enc(F), Q: i32enc(Q),
    pgs: { players, rows: f32enc(pgFlat), x: u8enc(pgX) }, stints: { rows: f32enc(stFlat), box: u8enc(stBox) }
  });
}
/* the decoded games carry their competition id as cid */
function decodeFull(store) {
  const W = decodeStore(store);
  W.games.forEach(g => { g.cid = g.c >= 0 ? W.comps[g.c] : null; });
  return W;
}

/* time of a value the database gives as a string */
const ms = s => { const t = Date.parse(s); return isFinite(t) ? t : 0; };
const ymd = t => new Date(t).toISOString().slice(0, 10);
const startersHash = list => (Array.isArray(list) && list.length ? fnv(list.slice().map(String).sort().join(',')) : 0);
const possEst = b => (b ? 0.96 * ((+b.fga || 0) + (+b.tov || 0) + 0.44 * (+b.fta || 0) - (+b.or || 0)) : NaN);

/* Add a delta to a store (pure: a new store comes back). rows: game_features rows {game_id, team_idx, f, q, st?,
   finalised_at}; games: games rows (§6.3: id, status, competition_id, home_team_id, away_team_id, home_score, away_score,
   tipoff_at, venue_id, starters; not final -> dropped); pgs: player_game_stats lines (min in ms); stints:
   lineup_stints rows {game_id, team_idx, player_ids, dur (ms), pf, pa, off, def}. A game that comes back (re-finalised)
   replaces everything the store held for it. opts.kinds: {competition id: 'league'|'cup'|'playoff'}. */
function storeAdd(store, rows, games, pgs, stints, opts) {
  opts = opts || {};
  const F = FT(), N = F.N;
  const W = decodeFull(store || emptyStore());
  const gRow = new Map((games || []).filter(g => g && g.id).map(g => [g.id, g]));
  const byGame = new Map();
  (rows || []).forEach(r => {
    if (!r || !r.game_id || (r.team_idx !== 0 && r.team_idx !== 1)) return;
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, [null, null]);
    byGame.get(r.game_id)[r.team_idx] = r;
  });
  /* the watermark moves over every row seen, kept or not */
  let wm = W.wm || (store && store.wm) || emptyStore().wm;
  (rows || []).forEach(r => { if (r && r.finalised_at && (r.finalised_at > wm.at || (r.finalised_at === wm.at && r.game_id > wm.id))) wm = { at: r.finalised_at, id: r.game_id }; });
  const replace = new Set(byGame.keys());
  /* the games the delta names leave first, with their lines */
  const keep = W.games.map((g, i) => (replace.has(g.id) ? -1 : i));
  const at = new Int32Array(W.games.length).fill(-1);
  const kept = [];
  keep.forEach(i => { if (i >= 0) { at[i] = kept.length; kept.push(W.games[i]); } });
  const pgsK = W.pgs.filter(r => at[r.g] >= 0).map(r => Object.assign({}, r, { g: at[r.g] }));
  const stK = W.stints.filter(r => at[r.g] >= 0).map(r => Object.assign({}, r, { g: at[r.g] }));
  const players = W.players.slice(), pAt = new Map(players.map((p, i) => [p, i]));
  const pIndex = id => { if (id == null || id === '') return -1; const k = String(id); if (!pAt.has(k)) { pAt.set(k, players.length); players.push(k); } return pAt.get(k); };
  const pgBy = new Map(), stBy = new Map();
  (pgs || []).forEach(r => { if (r && r.game_id) { if (!pgBy.has(r.game_id)) pgBy.set(r.game_id, []); pgBy.get(r.game_id).push(r); } });
  (stints || []).forEach(r => { if (r && r.game_id) { if (!stBy.has(r.game_id)) stBy.set(r.game_id, []); stBy.get(r.game_id).push(r); } });
  const kinds = opts.kinds || {};
  const ids = Array.from(byGame.keys()).sort(byId);
  for (const id of ids) {
    const pair = byGame.get(id), g = gRow.get(id);
    if (!pair[0] || !pair[1] || !g || g.status !== 'final') continue;
    if (!Array.isArray(pair[0].f) || !Array.isArray(pair[1].f)) continue;
    if (pair[0].fv != null && +pair[0].fv !== +(store && store.fv || F.FV)) continue;
    const gi = kept.length, t = ms(g.tipoff_at) || ms(pair[0].finalised_at);
    kept.push({ id, d: ymd(t), t, cid: g.competition_id || null, k: KIND[kinds[g.competition_id]] || 'l', h: g.home_team_id, a: g.away_team_id,
      hs: +g.home_score, as: +g.away_score, v: g.venue_id || '', s0: startersHash(g.starters && g.starters[0]), s1: startersHash(g.starters && g.starters[1]),
      fa: pair[0].finalised_at > pair[1].finalised_at ? pair[0].finalised_at : pair[1].finalised_at,
      F: [F.fromRow(pair[0]), F.fromRow(pair[1])], q: [pair[0].q | 0, pair[1].q | 0] });
    /* A.3 sidecars: the zones where the side's feed has them (the ZONES bit), the unassisted makes where its feature row
       carries them (st.u, keyed by player) and every one of its makers is one of the side's player lines */
    const pls = pgBy.get(id) || [];
    const uOf = [0, 1].map(side => {
      const r = pair[side], u = r.u != null ? r.u : (r.st && r.st.u != null ? r.st.u : null);
      if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
      const ids = new Set(pls.filter(x => (x.team_idx === 1 ? 1 : 0) === side).map(x => String(x.player_uuid || x.player_id)));
      return Object.keys(u).every(k => ids.has(k)) ? u : null;
    });
    const zonesOk = [0, 1].map(side => !!(pair[side].q & F.QBITS.ZONES));
    pls.forEach(r => {
      const pid = r.player_uuid || r.player_id, side = r.team_idx === 1 ? 1 : 0;
      if (!pid) return;
      const v = k => (isNum(+r[k]) ? +r[k] : 0), z = k => (zonesOk[side] && r[k] != null && isNum(+r[k]) ? +r[k] : NaN);
      const u = uOf[side], uu = u ? (u[String(pid)] || [0, 0]) : null;
      /* the assists he gave by the basket they made: known where the side's row carries them (written from 2026-10-07) */
      const giv = u && Object.keys(u).some(k => Array.isArray(u[k]) && u[k].length >= 5);
      pgsK.push({ g: gi, side, p: pIndex(pid), min: v('min') / 60000, pts: v('pts'), fga: v('p2a') + v('p3a'), fgm: v('p2m') + v('p3m'),
        fg3a: v('p3a'), fg3m: v('p3m'), fta: v('fta'), ftm: v('ftm'), or: v('or'), dr: v('dr'), ast: v('ast'), stl: v('stl'), blk: v('blk'),
        to: v('to'), pf: v('pf'), rimA: z('rimA'), rimM: z('rimM'), midA: z('midA'), midM: z('midM'),
        unFgm: uu ? +uu[0] || 0 : NaN, unPts: uu ? +uu[1] || 0 : NaN,
        a3: giv ? +(uu[3] || 0) : NaN, a2: giv ? +(uu[4] || 0) : NaN });
    });
    /* A.1: each side's lineup_stints rows, else (no rows, or rows whose seconds fall short of the game's length: a
       read that was cut off) the feature row's own compact stints */
    const sl = stBy.get(id) || [], Imin = F.INDEX.minutes;
    const secsOf = side => sl.filter(r => (r.team_idx === 1 ? 1 : 0) === side).reduce((t, r) => t + (+r.dur || 0) / 1000, 0);
    const fullSide = side => {
      const want = 60 * (+pair[side].f[Imin]), got = secsOf(side);
      return !(isNum(want) && want > 0) || Math.abs(got - want) <= Math.max(60, 0.05 * want);
    };
    const own = [0, 1].map(side => !!(pair[side].st && Array.isArray(pair[side].st.p) && Array.isArray(pair[side].st.s) && pair[side].st.s.length));
    const useRows = [0, 1].map(side => sl.some(r => (r.team_idx === 1 ? 1 : 0) === side) && (fullSide(side) || !own[side]));
    if (useRows[0] || useRows[1]) {
      sl.forEach(r => {
        if (!useRows[r.team_idx === 1 ? 1 : 0]) return;
        const side = r.team_idx === 1 ? 1 : 0, p = (r.player_ids || []).slice(0, 5).map(pIndex);
        while (p.length < 5) p.push(-1);
        const poss = 0.5 * (possEst(r.off) + possEst(r.def));
        /* the five's box at both ends (A.3: the lineup mixes' four factors), a count a byte */
        const bx = (r.off && typeof r.off === 'object' && r.def && typeof r.def === 'object') ? BOX_KEYS.map(k => +r.off[k]).concat(BOX_KEYS.map(k => +r.def[k])).map(x => (isNum(x) ? x : NaN)) : null;
        stK.push({ g: gi, side, p, poss: isNum(poss) ? poss : NaN, pf: isNum(+r.pf) ? +r.pf : NaN, pa: isNum(+r.pa) ? +r.pa : NaN, dur: (+r.dur || 0) / 1000, box: bx });
      });
    }
    {
      /* the feature row's own compact stints (seconds, five indexes into its players) for a side without usable rows */
      [0, 1].forEach(side => {
        if (useRows[side]) return;
        const st = pair[side].st;
        if (!st || !Array.isArray(st.p) || !Array.isArray(st.s)) return;
        st.s.forEach(row => {
          const p = row.slice(1, 6).map(i => (st.p[i] != null ? pIndex(st.p[i]) : -1));
          while (p.length < 5) p.push(-1);
          stK.push({ g: gi, side, p, poss: NaN, pf: NaN, pa: NaN, dur: +row[0] || 0 });
        });
      });
    }
  }
  return encodeStore(Object.assign({}, store || emptyStore()), { games: kept, players, pgs: pgsK, stints: stK, comps: W.comps, wm });
}
/* the games of a delta whose lineup_stints are missing or fall short of the game's length on a side (more than 5%, or
   a minute): the ones whose feature rows' own stints (st) the reader fetches, so the default read can leave st out */
function stintGaps(rows, stints) {
  const Imin = FT().INDEX.minutes, secs = new Map(), want = new Map();
  (stints || []).forEach(r => { if (!r || !r.game_id) return; const k = r.game_id + ':' + (r.team_idx === 1 ? 1 : 0); secs.set(k, (secs.get(k) || 0) + (+r.dur || 0) / 1000); });
  (rows || []).forEach(r => { if (!r || !r.game_id || !Array.isArray(r.f)) return; want.set(r.game_id + ':' + (r.team_idx === 1 ? 1 : 0), 60 * (+r.f[Imin] || 0)); });
  const out = new Set();
  want.forEach((w, k) => { const got = secs.get(k) || 0; if (!got || (w > 0 && Math.abs(got - w) > Math.max(60, 0.05 * w))) out.add(k.split(':')[0]); });
  return Array.from(out).sort(byId);
}
/* the store without some games */
function storeDrop(store, ids) {
  const drop = new Set(ids || []);
  const W = decodeFull(store);
  const at = new Int32Array(W.games.length).fill(-1), games = [];
  W.games.forEach((g, i) => { if (!drop.has(g.id)) { at[i] = games.length; games.push(g); } });
  return encodeStore(store, { games, players: W.players, comps: W.comps, wm: store.wm,
    pgs: W.pgs.filter(r => at[r.g] >= 0).map(r => Object.assign({}, r, { g: at[r.g] })),
    stints: W.stints.filter(r => at[r.g] >= 0).map(r => Object.assign({}, r, { g: at[r.g] })) });
}

/* ================================================================== PEOPLE (§7.12-§7.15, A.1) === */
/* a roster's typed position -> the site's code (pg sg sf pf c g f gf fc), case and punctuation tolerant; '' unknown */
const LISTED_CODE = {
  PG: 'pg', POINT_GUARD: 'pg', POINT: 'pg', SG: 'sg', SHOOTING_GUARD: 'sg', SF: 'sf', SMALL_FORWARD: 'sf', PF: 'pf', POWER_FORWARD: 'pf',
  C: 'c', CENTER: 'c', CENTRE: 'c', G: 'g', GUARD: 'g', GD: 'g', F: 'f', FORWARD: 'f', FD: 'f',
  'F/G': 'gf', 'G/F': 'gf', GF: 'gf', FG: 'gf', 'PG/SG': 'g', 'SG/PG': 'g', 'SG/SF': 'gf', 'SF/SG': 'gf', 'SF/PF': 'f', 'PF/SF': 'f',
  'C/F': 'fc', 'F/C': 'fc', 'C/PF': 'fc', 'PF/C': 'fc', FC: 'fc', CF: 'fc'
};
function normListed(s) {
  const k = String(s == null ? '' : s).trim().toUpperCase().replace(/[\s\-_.]+/g, '_').replace(/_*[/\\|]_*/g, '/').replace(/^_+|_+$/g, '');
  return LISTED_CODE[k] || '';
}
/* season.js's scale (LISTED_POS): 1 point guard ... 5 centre */
const LISTED_VAL = { pg: 1, g: 1.5, sg: 2, gf: 2.5, sf: 3, f: 3.5, pf: 4, fc: 4.5, c: 5,
  /* season.js LISTED_POS's words, so the fallback reads a typed position exactly as depth.js does */
  'point guard': 1, guard: 1.5, 'shooting guard': 2, 'g/f': 2.5, wing: 3, 'small forward': 3, forward: 3.5, 'power forward': 4, 'f/c': 4.5,
  centre: 5, center: 5, big: 5 };
const listedValue = s => { const c = normListed(s) || String(s == null ? '' : s).trim().toLowerCase(); return LISTED_VAL[c] != null ? LISTED_VAL[c] : null; };
const heightValue = h => (isNum(+h) && +h > 0 ? clamp(1 + (+h - 183) / 6.5, 1, 5) : null);
/* THE ONE DEFINITION (§7.12): t/depth.js positionOf, the Front office's blend. Where depth.js is not loaded (the Edge
   Function) the same three witnesses with the same weights, which ww-winmodel checks against it. */
function positionOf(p, season) {
  const D = DEPTH();
  if (D && D.positionOf) return D.positionOf({ position: normListed(p.position) || p.position, height: p.height }, season);
  const listed = listedValue(p.position);
  const calc = season && isNum(season.bpm_pos) ? season.bpm_pos : null;
  const tall = heightValue(p.height), min = (season && +season.min) || 0;
  let w = 0, v = 0;
  if (calc != null) { const wc = 1.5 * min / (min + 150); v += wc * calc; w += wc; }
  if (listed != null) { v += listed; w += 1; }
  if (tall != null) { v += 0.8 * tall; w += 0.8; }
  return w > 0 ? v / w : 3;
}

/* A.1 SLOT MINUTES. Every stint's five ranked by their season position estimate (1.0 point guard ... 5.0 centre):
   the lowest plays slot 1, the next slot 2, ... slot 5; the stint's seconds go to each player's slot. Ties: the
   estimate at full precision, then (two estimates clamped to the same 1.0 or 5.0) the unclamped estimate `raw`, then
   season minutes (more first to the lower slot), then the player id. A player with
   no estimate is ranked after those with one, by his listed position, then his height. A stint with fewer than five
   known players is skipped and counted.
     stints     [{ids: [5 player ids], s: seconds}] or the compact {p: [ids], s: [[seconds, i1..i5], ...]}
     estimates  Map | {id: number | {pos, raw?, min, listed, height}}
   -> {min: Map id -> [m1..m5] (minutes), skipped, stints, seconds} */
function slotMinutes(stints, estimates, opts) {
  void opts;
  let list = stints || [];
  if (list && !Array.isArray(list) && Array.isArray(list.p) && Array.isArray(list.s)) {
    const P = list.p;
    list = list.s.map(r => ({ ids: r.slice(1, 6).map(i => (P[i] != null ? P[i] : null)), s: +r[0] || 0 }));
  }
  const get = id => {
    const e = estimates ? (estimates.get ? estimates.get(id) : estimates[id]) : null;
    return e == null ? {} : typeof e === 'number' ? { pos: e } : e;
  };
  const key = new Map();
  const keyOf = id => {
    if (key.has(id)) return key.get(id);
    const e = get(id), has = isNum(e.pos);
    const lv = listedValue(e.listed), hv = heightValue(e.height);
    const k = { has: has ? 0 : 1, v: has ? e.pos : (lv != null ? lv : Infinity), r: has && isNum(e.raw) ? e.raw : 0, h: has ? 0 : (hv != null ? hv : Infinity), min: isNum(e.min) ? e.min : 0, id: String(id) };
    key.set(id, k);
    return k;
  };
  const cmp = (a, b) => {
    const x = keyOf(a), y = keyOf(b);
    return (x.has - y.has) || (x.v - y.v || 0) || (x.r - y.r || 0) || (x.h - y.h || 0) || (y.min - x.min) || byId(x.id, y.id);
  };
  const out = new Map();
  let skipped = 0, used = 0, seconds = 0;
  for (const st of list) {
    const ids = (st && (st.ids || st.p)) || [];
    const known = ids.filter(x => x != null && x !== '' && x !== -1);
    if (known.length < 5 || new Set(known).size < 5) { skipped++; continue; }
    const s = +st.s || +st.dur || 0;
    if (!(s > 0)) { skipped++; continue; }
    const five = known.slice(0, 5).sort(cmp);
    five.forEach((id, slot) => {
      if (!out.has(id)) out.set(id, [0, 0, 0, 0, 0]);
      out.get(id)[slot] += s / 60;
    });
    used++; seconds += s;
  }
  return { min: out, skipped, stints: used, seconds };
}

/* §7.12 groups. players [{id, v (positionOf), min, slots?: [5 minutes]}] -> Map id -> 'G'|'F'|'C'.
   With slot minutes (A.1): G = slots 1-2, F = 3-4, C = 5, whichever holds most of his minutes. Without: the 40/40/20
   cut of the unit's minutes (players with 60 minutes or more, sorted by value), and every other player by his value
   against the cuts. */
function groupsFor(players) {
  const out = new Map(), rest = [];
  (players || []).forEach(p => {
    const s = p && p.slots;
    if (s && sum(s) > 0) { const g = [s[0] + s[1], s[2] + s[3], s[4]]; out.set(p.id, GROUPS3[g.indexOf(Math.max(g[0], g[1], g[2]))]); }
    else if (p) rest.push(p);
  });
  const big = rest.filter(p => (+p.min || 0) >= 60 && isNum(p.v)).sort((a, b) => (a.v - b.v) || byId(String(a.id), String(b.id)));
  const tot = sum(big.map(p => +p.min));
  let cum = 0, cutG = -Infinity, cutF = -Infinity;
  big.forEach(p => {
    const mid = (cum + p.min / 2) / (tot || 1);
    cum += p.min;
    const g = mid < 0.4 ? 'G' : mid < 0.8 ? 'F' : 'C';
    out.set(p.id, g);
    if (g === 'G') cutG = Math.max(cutG, p.v);
    if (g !== 'C') cutF = Math.max(cutF, p.v);
  });
  rest.forEach(p => {
    if (out.has(p.id)) return;
    const v = isNum(p.v) ? p.v : 3;
    out.set(p.id, big.length ? (v <= cutG ? 'G' : v <= cutF ? 'F' : 'C') : (v < 2.5 ? 'G' : v < 4 ? 'F' : 'C'));
  });
  return out;
}

/* §7.13 / §7.15 roles, rule-based, A.3's set. Every cut is a percentile WITHIN the league-season, over its regular
   players (200 minutes or more); a player is placed against that distribution by its empirical CDF (pct), so a
   player with fewer minutes is judged against the regulars. A tag needs 100 minutes (the big tag: none; the
   protector: 60, as before).
     shooter    3PA ≥ 40, 3PA rate ≥ P60, 3P% shrunk toward the league ((3PM + 150 μ) / (3PA + 150)) ≥ P50
     handler    a BALL HANDLER (Louie, 2026-10-07: assists and usage, and the unassisted share of his points): 0.35
                pct(AST%) + 0.25 pct(USG%) + 0.40 pct(UPP, the share of his own field-goal points that were
                unassisted) ≥ 0.70, the weights renormalised over the parts a player has (UPP needs the feature rows'
                st.u; where a league has none, AST% and USG% alone)
     passer     A/U (AST% ÷ USG%, assist-to-usage) ≥ P75 and AST% ≥ P50: pass-first
     slasher    RIM PRESSURE: ½ (pct(rim rate) + pct(FT rate)) ≥ 0.75 and FGA ≥ 40; a league whose feeds have no shot
                locations: pct(FT rate) ≥ 0.80 alone (cuts.slasher.zones says which)
     crasher    ORB% ≥ P75 (offensive rebounder)
     glass      DRB% ≥ P75 (defensive rebounder)
     protector  BLK% ≥ P75 and height z ≥ 0.5, or group C without a height (60 minutes)
     disruptor  STL% ≥ P75 (a turnover generator)
     big        group C
     creator    USG% ≥ P80, 200 minutes
   players: season rows {id, min, fga, fg3a, fg3m, ast_pct, blk_pct, usg, hz, group, ups, upp, au, rimr, ftr, orb_pct,
   drb_pct, stl_pct} -> Map id -> [tags], with .cuts: the league-season's cut values (the page says how a tag is
   earned here). unit: {p3: the unit's 3P%, zones: true when the shot locations are there} */
const ROLE_KEYS = ['shooter', 'handler', 'passer', 'slasher', 'crasher', 'glass', 'protector', 'disruptor', 'big', 'creator'];
const ROLE_MIN = 100, ROLE_REG = 200;
const HANDLER_W = { ast_pct: 0.35, usg: 0.25, upp: 0.40 }, HANDLER_CUT = 0.70;
function roles(players, unit) {
  const list = players || [];
  const q = (a, p) => qtl(a, p);
  const reg = list.filter(p => (+p.min || 0) >= ROLE_REG);
  const mu3 = unit && isNum(unit.p3) ? unit.p3 : (sum(list.map(p => p.fg3m)) / (sum(list.map(p => p.fg3a)) || 1));
  const sh3 = p => ((+p.fg3m || 0) + 150 * mu3) / ((+p.fg3a || 0) + 150);
  const p3r = p => ((+p.fga || 0) > 0 ? (+p.fg3a || 0) / p.fga : 0);
  const sorted = k => reg.map(p => p[k]).filter(isNum).sort((a, b) => a - b);
  /* the empirical CDF of a statistic over the regulars: the share below, half the share equal */
  const ecdf = k => { const v = sorted(k); return x => { if (!isNum(x) || !v.length) return null; let lo = 0, eq = 0; for (const y of v) { if (y < x) lo++; else if (y === x) eq++; } return (lo + 0.5 * eq) / v.length; }; };
  const pc = {}; ['ast_pct', 'ups', 'upp', 'usg', 'rimr', 'ftr'].forEach(k => { pc[k] = ecdf(k); });
  const zones = unit && unit.zones != null ? !!unit.zones : sorted('rimr').length >= Math.max(5, 0.5 * reg.length);
  const cutRate = q(reg.map(p3r), 0.6), cutSh = q(reg.map(sh3), 0.5);
  const cutAst = q(reg.map(p => p.ast_pct), 0.75), cutBlk = q(reg.map(p => p.blk_pct), 0.75), cutUsg = q(reg.map(p => p.usg), 0.8);
  const cutAu = q(reg.map(p => p.au), 0.75), cutAst50 = q(reg.map(p => p.ast_pct), 0.5);
  const cutOrb = q(reg.map(p => p.orb_pct), 0.75), cutDrb = q(reg.map(p => p.drb_pct), 0.75), cutStl = q(reg.map(p => p.stl_pct), 0.75);
  const hasUps = sorted('ups').length >= Math.max(5, 0.5 * reg.length), hasUpp = sorted('upp').length >= Math.max(5, 0.5 * reg.length);
  const handlerScore = p => {
    let s = 0, w = 0;
    Object.keys(HANDLER_W).forEach(k => { if (k === 'upp' && !hasUpp) return; const v = pc[k](p[k]); if (v != null) { s += HANDLER_W[k] * v; w += HANDLER_W[k]; } });
    return w >= 0.5 ? s / w : null;
  };
  const slashScore = p => {
    const f = pc.ftr(p.ftr);
    if (f == null || (+p.fga || 0) < 40) return null;
    if (!zones) return f;
    const r = pc.rimr(p.rimr);
    return r == null ? null : (r + f) / 2;
  };
  const out = new Map();
  list.forEach(p => {
    const r = [], enough = (+p.min || 0) >= 60, tag = (+p.min || 0) >= ROLE_MIN;
    const ge = (v, c) => isNum(v) && isNum(c) && v >= c;
    if ((+p.fg3a || 0) >= 40 && p3r(p) >= cutRate && sh3(p) >= cutSh) r.push('shooter');
    const hs = handlerScore(p);
    if (tag && hs != null && hs >= HANDLER_CUT) r.push('handler');
    if (tag && ge(p.au, cutAu) && ge(p.ast_pct, cutAst50)) r.push('passer');
    const ss = slashScore(p);
    if (tag && ss != null && ss >= (zones ? 0.75 : 0.8)) r.push('slasher');
    if (tag && ge(p.orb_pct, cutOrb)) r.push('crasher');
    if (tag && ge(p.drb_pct, cutDrb)) r.push('glass');
    if (enough && ((isNum(p.blk_pct) && p.blk_pct >= cutBlk && isNum(p.hz) && p.hz >= 0.5) || (p.group === 'C' && !isNum(p.hz)))) r.push('protector');
    if (tag && ge(p.stl_pct, cutStl)) r.push('disruptor');
    if (p.group === 'C') r.push('big');
    if ((+p.min || 0) >= ROLE_REG && isNum(p.usg) && p.usg >= cutUsg) r.push('creator');
    out.set(p.id, r);
  });
  /* the cuts as they fall in this league-season, for the page's "how a player earns this tag here" */
  out.cuts = { n: reg.length, shooter: { p3r: 100 * cutRate, p3p: 100 * cutSh }, handler: { cut: HANDLER_CUT, w: Object.assign({}, HANDLER_W), ups: hasUps, upp: hasUpp,
    ast50: q(reg.map(p => p.ast_pct), 0.5), usg50: q(reg.map(p => p.usg), 0.5), ups50: hasUps ? q(reg.map(p => p.ups), 0.5) : null, upp50: hasUpp ? q(reg.map(p => p.upp), 0.5) : null },
    passer: { au: cutAu, ast: cutAst50 }, slasher: { zones, rimr: zones ? q(reg.map(p => p.rimr), 0.75) : null, ftr: q(reg.map(p => p.ftr), zones ? 0.75 : 0.8) },
    crasher: { orb: cutOrb }, glass: { drb: cutDrb }, protector: { blk: cutBlk }, disruptor: { stl: cutStl }, creator: { usg: cutUsg } };
  return out;
}

/* ISO weeks of tip-off, a week under 8 games merged into the next (the last into the one before): a block index a
   game (input order). games: [{t}] */
function blocksOf(games) {
  const list = games || [];
  const wk = list.map(g => isoWeek(+g.t || 0));
  const keys = Array.from(new Set(wk)).sort();
  const count = new Map();
  wk.forEach(w => count.set(w, (count.get(w) || 0) + 1));
  const groups = [];
  let cur = [], n = 0;
  keys.forEach(k => { cur.push(k); n += count.get(k); if (n >= 8) { groups.push(cur); cur = []; n = 0; } });
  if (cur.length) { if (groups.length) groups[groups.length - 1].push(...cur); else groups.push(cur); }
  const of = new Map();
  groups.forEach((g, i) => g.forEach(k => of.set(k, i)));
  return wk.map(w => of.get(w));
}

/* ------------------------------------------------------------------ the unit, prepared once --- */
const fac = () => { const F = FT(); if (!fac.m || fac.f !== F) { fac.f = F; fac.m = new Map(F.FACTORS.map(x => [x.k, x])); } return fac.m; };
const dirOf = k => { const x = fac().get(k); return x ? x.dir : 0; };

/* the unit's working object: games in tip-off order with their lines, home view, decided, neutral sites, blocks,
   both sides' factor values, the home-minus-away differences, the clubs and their games */
function prepare(input, opts) {
  opts = opts || {};
  const F = FT(), I = F.INDEX;
  const store = input.store && typeof input.store.F === 'string' ? input.store : (input.store || emptyStore());
  const W = input.decoded || decodeFull(store);
  const ctx = Object.assign({}, store.ctx || {}, input.ctxOverride || {});
  const teamsCtx = new Map(((input.teams || ctx.teams) || []).map(t => [t.id, t]));
  const games = W.games;                                     // already in (tip-off, id) order
  const n = games.length;
  /* the home team's own venue: home_venue_id, else its modal venue over 3 or more home games */
  const modal = new Map();
  games.forEach(g => { if (g.v) { const m = modal.get(g.h) || new Map(); m.set(g.v, (m.get(g.v) || 0) + 1); modal.set(g.h, m); } });
  const homeVenue = id => {
    const t = teamsCtx.get(id);
    if (t && (t.home_venue_id || t.venue)) return t.home_venue_id || t.venue;
    const hv = input.homeVenues || ctx.homeVenues;
    if (hv && hv[id]) return hv[id];
    const m = modal.get(id);
    if (!m) return null;
    let best = null, bn = 0;
    Array.from(m.keys()).sort(byId).forEach(v => { if (m.get(v) > bn) { best = v; bn = m.get(v); } });
    return bn >= 3 ? best : null;
  };
  const h = games.map(g => { const hv = homeVenue(g.h); return g.v && hv && g.v !== hv ? 0 : 1; });
  const y = games.map(g => g.hs - g.as);
  const dv = games.map(g => [F.derive(g.F[0], g.F[1], g.q[0], g.q[1]), F.derive(g.F[1], g.F[0], g.q[1], g.q[0])]);
  const yc = dv.map(p => nn(p[0].c_margin));
  const w = y.map(v => (v > 0 ? 1 : v < 0 ? 0 : null));
  const blocks = blocksOf(games);
  const dx = {};
  F.FACTORS.forEach(x => {
    if (!x.fn || x.side === 'game') return;
    dx[x.k] = dv.map(p => (isNum(p[0][x.k]) && isNum(p[1][x.k]) ? p[0][x.k] - p[1][x.k] : NaN));
  });
  /* the clubs: their games (index, side) in order */
  const teams = new Map();
  const team = id => { if (!teams.has(id)) { const c = teamsCtx.get(id) || {}; teams.set(id, { id, name: c.name || '', short: c.short_name || c.short || '', colour: c.colour || '', logo: c.logo_path || c.logo || null, gl: [] }); } return teams.get(id); };
  games.forEach((g, i) => { team(g.h).gl.push([i, 0]); team(g.a).gl.push([i, 1]); });
  const teamIds = Array.from(teams.keys()).sort(byId);
  const bitShare = bit => (n ? games.filter(g => (g.q[0] & bit) && (g.q[1] & bit)).length / n : 0);
  const Q = F.QBITS;
  const quality = { zones: bitShare(Q.ZONES), timed: bitShare(Q.TIMED), sit: bitShare(Q.SIT), stype: bitShare(Q.STYPE), foulkind: bitShare(Q.FOULKIND), stl: bitShare(Q.STL) };
  return { input, store, ctx, W, games, n, h, y, yc, w, dv, dx, blocks, teams, teamIds, quality, I,
    seed: opts.seed != null ? opts.seed >>> 0 : fnv(input.token || store.n + '@' + (store.wm && store.wm.at)),
    league: input.league || ctx.league || null, season: input.season || ctx.season || null };
}

/* one club's season pairs (own = its rows, opp = its opponents'), optionally only games before a time */
function pairsOf(X, tid, before) {
  const T = X.teams.get(tid), out = [];
  if (!T) return out;
  for (const [i, s] of T.gl) {
    const g = X.games[i];
    if (before != null && !(g.t < before)) continue;
    out.push({ own: g.F[s], opp: g.F[1 - s], qOwn: g.q[s], qOpp: g.q[1 - s], i, s });
  }
  return out;
}
const swap = pairs => pairs.map(p => ({ own: p.opp, opp: p.own, qOwn: p.qOpp, qOpp: p.qOwn }));

/* A.3: a player's season rates from his totals and the context he played in (every one a ratio of season sums; null
   where the denominator is 0 or the data are not there). The filterable statistics of the lineup mixes, the per-position
   statistics and the role rules all read these, under these keys (PLAYER_STATS) */
const PLAYER_STATS = ['ast_pct', 'usg', 'ts', 'efg', 'orb_pct', 'drb_pct', 'stl_pct', 'blk_pct', 'tov_pct', 'p3r', 'p3p', 'rimr', 'midr', 'ftr', 'una', 'ups', 'au',
  'un_pg', 'unp_pg', 'upp', 'rim40', 'p3a40', 'fga40', 'ast40', 'a3s', 'ftp', 'rimp', 'midp'];
/* 2026-10-07 (Louie: self-created points, shot volume and balance, a guard's rim pressure, the passes that make threes):
     un_pg    unassisted makes a game (the games his side's row carried the pairing)
     unp_pg   unassisted points a game: the points he scores off his own creation
     upp      the share of his own field-goal points that were unassisted
     rim40    shots at the rim per 40 minutes (the minutes his side's feed placed shots)
     p3a40    threes per 40, fga40 field-goal attempts per 40: volume, where p3r / rimr / midr are the balance
     ast40    assists per 40
     a3s      of his assists, the share that made a three (from 2026-10-07's rows)
   and the shooting percentages the position view lacked (Louie: the percentage stats, not FG%, 2P% or TRB%): ftp FT%,
   rimp FG% at the rim, midp mid-range FG% */
function rates(p) {
  const r = (num, den, k) => (den > 0 && isNum(num) ? (k || 100) * num / den : null);
  const sh = p.gameMin > 0 && p.min > 0 ? p.gameMin / p.min : 0;     // the game's minutes over his (5 × his share of the floor)
  p.ts = r(p.pts, 2 * (p.fga + 0.44 * p.fta));
  p.efg = r(p.fgm + 0.5 * p.fg3m, p.fga);
  p.orb_pct = sh > 0 ? r(p.or * sh, p.tmOR + p.oppDR) : null;
  p.drb_pct = sh > 0 ? r(p.dr * sh, p.tmDR + p.oppOR) : null;
  p.stl_pct = sh > 0 ? r(p.stl * sh, p.oppPoss) : null;
  p.tov_pct = r(p.to, p.fga + 0.44 * p.fta + p.to);
  p.p3r = r(p.fg3a, p.fga);
  p.p3p = r(p.fg3m, p.fg3a);
  p.ftr = r(p.fta, p.fga);
  p.rimr = r(p.rimA, p.fgaZ);
  p.midr = r(p.midA, p.fgaZ);
  p.una = r(p.unFgm, p.fgmU);
  p.ups = p.gameMinU > 0 && p.minU > 0 ? r(p.unPts * p.gameMinU / p.minU, p.tmUnPts) : null;
  p.au = isNum(p.ast_pct) && isNum(p.usg) && p.usg > 0 ? p.ast_pct / p.usg : null;
  p.un_pg = p.gpU > 0 ? p.unFgm / p.gpU : null;
  p.unp_pg = p.gpU > 0 ? p.unPts / p.gpU : null;
  p.upp = r(p.unPts, p.ptsFgU);
  p.rim40 = r(p.rimA, p.minZ, 40);
  p.p3a40 = r(p.fg3a, p.min, 40);
  p.fga40 = r(p.fga, p.min, 40);
  p.ast40 = r(p.ast, p.min, 40);
  p.a3s = p.a3 + p.a2 >= 5 ? 100 * p.a3 / (p.a3 + p.a2) : null;
  p.ftp = r(p.ftm, p.fta);
  p.rimp = r(p.rimM, p.rimA);
  p.midp = r(p.midM, p.midA);
  return p;
}

/* the players: season totals per (player, club) from the player lines, the context they played in (for AST%, BLK%,
   USG%), BPM (bpm.js forLeague, the whole league at once) and the season position estimate at full precision
   (bpm.js estimatePosition with the listed position as its prior, as A.1 ranks by) */
function playerRows(X, before) {
  const F = FT(), I = F.INDEX, W = X.W, ctx = X.ctx;
  const rost = new Map();
  ((X.input.rosters || ctx.rosters) || []).forEach(r => {
    const pid = r.player_id || (r.players && r.players.id) || r.id;
    if (!pid) return;
    const was = rost.get(pid) || {};
    rost.set(pid, { position: was.position || r.position || '', height: was.height || r.height_cm || (r.players && r.players.height_cm) || null });
  });
  const bios = (X.input.bios || ctx.bios) || {};
  const rows = new Map();
  /* A.3: each game-side's unassisted points (its lines' sum, where the side's lines carry them), the denominator of a
     player's unassisted points share */
  const unSide = new Map();
  for (const r of W.pgs) { if (!(r.min > 0) || !isNum(r.unPts)) continue; const k = r.g * 2 + r.side; unSide.set(k, (unSide.get(k) || 0) + r.unPts); }
  for (const r of W.pgs) {
    const g = X.games[r.g];
    if (!g || (before != null && !(g.t < before))) continue;
    const tid = r.side ? g.a : g.h, pid = W.players[r.p];
    if (!pid) continue;
    const key = tid + '|' + pid;
    let o = rows.get(key);
    if (!o) {
      const ro = rost.get(pid) || {}, bio = bios[pid] || {};
      o = { key, id: pid, team: tid, gp: 0, games: new Set(), min: 0, pts: 0, fga: 0, fgm: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, or: 0, dr: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0,
        gameMin: 0, tmFGM: 0, tmFGA: 0, tmFTA: 0, tmTOV: 0, oppFG2A: 0, tmReb: 0, tmOR: 0, tmDR: 0, oppOR: 0, oppDR: 0, oppPoss: 0,
        rimA: 0, rimM: 0, midA: 0, midM: 0, fgaZ: 0, unFgm: 0, unPts: 0, fgmU: 0, minU: 0, gameMinU: 0, tmUnPts: 0,
        minZ: 0, gpU: 0, ptsFgU: 0, a3: 0, a2: 0, astA: 0,
        position: ro.position || '', height: ro.height || bio.height_cm || null, age: isNum(bio.age) ? bio.age : (isNum(bio.birth_year) && isNum(X.refYear) ? X.refYear - bio.birth_year : null) };
      rows.set(key, o);
    }
    if (r.min > 0) { o.gp++; o.games.add(r.g); }
    for (const k of ['min', 'pts', 'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm', 'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf']) o[k] += isNum(r[k]) ? r[k] : 0;
    if (r.min > 0) {
      const own = g.F[r.side], opp = g.F[1 - r.side], v = (a, k) => (isNum(a[I[k]]) ? a[I[k]] : 0);
      o.gameMin += v(own, 'minutes'); o.tmFGM += v(own, 'fgm'); o.tmFGA += v(own, 'fga'); o.tmFTA += v(own, 'fta'); o.tmTOV += v(own, 'tov');
      o.oppFG2A += v(opp, 'fga') - v(opp, 'fg3a'); o.tmReb += v(own, 'oreb') + v(own, 'dreb');
      o.tmOR += v(own, 'oreb'); o.tmDR += v(own, 'dreb'); o.oppOR += v(opp, 'oreb'); o.oppDR += v(opp, 'dreb'); o.oppPoss += v(opp, 'poss_est');
      /* the zone counts where the side's feed has them, the unassisted makes where its row carried them (A.3) */
      if (isNum(r.rimA) && isNum(r.midA)) { o.rimA += r.rimA; o.rimM += isNum(r.rimM) ? r.rimM : 0; o.midA += r.midA; o.midM += isNum(r.midM) ? r.midM : 0; o.fgaZ += isNum(r.fga) ? r.fga : 0; o.minZ += r.min; }
      if (isNum(r.unFgm) && isNum(r.unPts)) { o.unFgm += r.unFgm; o.unPts += r.unPts; o.fgmU += isNum(r.fgm) ? r.fgm : 0; o.minU += r.min; o.gameMinU += v(own, 'minutes'); o.tmUnPts += unSide.get(r.g * 2 + r.side) || 0;
        o.gpU++; o.ptsFgU += (isNum(r.fgm) ? 2 * r.fgm : 0) + (isNum(r.fg3m) ? r.fg3m : 0); }
      if (isNum(r.a3) && isNum(r.a2)) { o.a3 += r.a3; o.a2 += r.a2; o.astA += isNum(r.ast) ? r.ast : 0; }
    }
  }
  const list = Array.from(rows.values()).sort((a, b) => byId(a.key, b.key));
  list.forEach(p => {
    const share = p.gameMin > 0 && p.min > 0 ? p.min / p.gameMin : 0;
    p.ast_pct = share > 0 && share * p.tmFGM - p.fgm > 0 ? 100 * p.ast / (share * p.tmFGM - p.fgm) : null;
    p.blk_pct = p.min > 0 && p.oppFG2A > 0 ? 100 * p.blk * p.gameMin / (p.min * p.oppFG2A) : null;
    const tu = p.tmFGA + 0.44 * p.tmFTA + p.tmTOV;
    p.usg = p.min > 0 && tu > 0 ? 100 * (p.fga + 0.44 * p.fta + p.to) * p.gameMin / (p.min * tu) : null;
    p.mpg = p.gp ? p.min / p.gp : 0;
    p.listed = normListed(p.position);
    rates(p);
  });
  /* BPM, the whole league at once (bpm.js), each club's totals from its own feature rows */
  const B = BPMm();
  if (B && list.length) {
    const byTeam = new Map();
    list.forEach(p => { if (p.min > 0) { if (!byTeam.has(p.team)) byTeam.set(p.team, []); byTeam.get(p.team).push(p); } });
    const teamsIn = Array.from(byTeam.keys()).sort(byId).map(tid => {
      const pairs = pairsOf(X, tid, before), s = k => sum(pairs.map(pp => pp.own[I[k]])), so = k => sum(pairs.map(pp => pp.opp[I[k]]));
      const poss = s('poss_est'), mins = s('minutes');
      const squad = byTeam.get(tid).map(p => ({ id: p.key, minutes: p.min, pts: p.pts, tpm: p.fg3m, ast: p.ast, to: p.to, orb: p.or, drb: p.dr,
        stl: p.stl, blk: p.blk, pf: p.pf, fga: p.fga, fta: p.fta }));
      const totals = { pts: s('pts'), fga: s('fga'), fta: s('fta'), oreb: s('oreb'), dreb: s('dreb'), ast: s('ast'), stl: s('stl'), blk: s('blk'), pf: s('fouls'), poss };
      const t = Object.assign({ id: tid, pace: mins > 0 ? 40 * poss / mins : 70, netRtg: poss > 0 ? 100 * (s('pts') - so('pts')) / poss : 0,
        offRtg: poss > 0 ? 100 * s('pts') / poss : null, players: squad }, B.teamInputs(totals, squad));
      t._listed = new Map(byTeam.get(tid).map(p => [p.key, listedValue(p.position)]));
      return t;
    });
    let out = new Map();
    try { out = B.forLeague(teamsIn); } catch (_) { out = new Map(); }
    teamsIn.forEach(t => {
      t.players.forEach(sp => {
        const p = rows.get(sp.id), r = out.get(sp.id);
        if (!p) return;
        p.bpm = r ? r.bpm : null; p.bpm_pos = r ? r.position : null;
        /* the box BPM before bpm.js's team adjustment (which builds the club's own net rating into every player): every
           team-season BPM figure that is set against the clubs' results uses it (R2S-2) */
        p.bpmRaw = r && isNum(r.bpmRaw) ? r.bpmRaw : null;
        try {
          const p100 = B.per100(sp, B.estimatedPossessions(sp.minutes, t.pace || 70));
          const lv = t._listed.get(sp.id);
          p.pos = B.estimatePosition(p100, t.per100 || {}, sp.minutes, lv == null ? null : lv);
          /* the same estimate before its clamp to [1, 5]: A.1's tie-break for two players who both clamp to 1 or 5 */
          const raw = B.estimatePosition(p100, t.per100 || {}, sp.minutes, lv == null ? null : lv, { raw: true });
          p.posRaw = isNum(raw) ? raw : p.pos;
        } catch (_) { p.pos = null; p.posRaw = null; }
      });
    });
  }
  return list;
}

/* ================================================================== FITS FROM BLOCK STATISTICS (§7.0-§7.3) === */
/* the rows of a difference model: [h columns..., Δx_k...] against y (the competitive margin 'yc' or the final 'y');
   a game with any column missing is left out. hcols: per-game h vectors (the pooled fit's α per league) */
function design(X, cols, o) {
  o = o || {};
  const yv = o.y === 'y' ? X.y : X.yc, rows = [], ys = [], gi = [], blk = [];
  for (let i = 0; i < X.n; i++) {
    if (o.only && !o.only(i)) continue;
    const yi = yv[i];
    if (!isNum(yi)) continue;
    const r = o.hcols ? o.hcols(i).slice() : [X.h[i]];
    let okRow = true;
    for (const k of cols) { const v = (X.dx[k] || [])[i]; if (!isNum(v)) { okRow = false; break; } r.push(v); }
    if (!okRow) continue;
    rows.push(r); ys.push(yi); gi.push(i); blk.push(X.blocks[i]);
  }
  return { rows, y: ys, gi, blk, cols, nh: o.hcols ? o.hcols(0).length : 1 };
}
/* per-block sufficient statistics, blocks with fewer than eight rows merged into the next (the last backwards) */
function blockSuffs(D, minN) {
  const W = WS(), by = new Map();
  D.rows.forEach((r, i) => { const b = D.blk[i]; if (!by.has(b)) by.set(b, { r: [], y: [] }); const x = by.get(b); x.r.push(r); x.y.push(D.y[i]); });
  const keys = Array.from(by.keys()).sort((a, b) => a - b);
  const groups = [];
  let cur = { r: [], y: [], k: [] };
  keys.forEach(k => { const x = by.get(k); cur.r.push(...x.r); cur.y.push(...x.y); cur.k.push(k); if (cur.r.length >= (minN || 8)) { groups.push(cur); cur = { r: [], y: [], k: [] }; } });
  if (cur.r.length) { if (groups.length) { const L = groups[groups.length - 1]; L.r.push(...cur.r); L.y.push(...cur.y); L.k.push(...cur.k); } else groups.push(cur); }
  return groups.map(g => Object.assign(W.suff(g.r, g.y), { keys: g.k }));
}
const rms = (S, k) => { const sw = S.sw != null ? S.sw : S.n; return sw > 0 ? Math.sqrt(S.xx[WS().pidx(k, k, S.p)] / sw) : 1; };
/* penalty multipliers: the square of each column's spread; the h columns unpenalised */
const penOf = (S, nh) => Array.from({ length: S.p }, (_, k) => (k < nh ? 0 : Math.pow(rms(S, k) || 1, 2)));
/* the regression of one column on others, out of one augmented statistic (every variable a column) */
function regSuff(S, xcols, ycol) {
  const W = WS(), out = W.pick(S, xcols), p = S.p;
  out.xy = Float64Array.from(xcols.map(c => S.xx[W.pidx(c, ycol, p)]));
  out.yy = S.xx[W.pidx(ycol, ycol, p)]; out.sy = S.sx ? S.sx[ycol] : 0;
  return out;
}
/* The covariance EB and the CIs without draws use: CR1 by block (§7.3), or, with fewer blocks than max(10, 2p), the
   model-based σ² A⁻¹ X'X A⁻¹. CR1's meat is a sum of G outer products, rank G at most: with three blocks and five
   coefficients some directions get no variance at all, and EB would then trust a 30-game league completely. */
function covOf(blocks, fit, S) {
  const W = WS(), p = fit.b.length;
  if (blocks.length >= Math.max(10, 2 * p)) return W.clusterCov(blocks, fit);
  const XX = W.full(S.xx, p), A = fit.Ainv, T = new Float64Array(p * p), V = new Float64Array(p * p), s2 = fit.sigma2;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) { let r = 0; for (let k = 0; k < p; k++) r += A[i * p + k] * XX[k * p + j]; T[i * p + j] = r; }
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) { let r = 0; for (let k = 0; k < p; k++) r += T[i * p + k] * A[k * p + j]; V[i * p + j] = s2 * r; }
  return V;
}
/* out-of-fold R² over 5 block folds at lambda */
function r2cv(blocks, lambda, pen) {
  const W = WS(), tot = W.sumSuff(blocks), folds = Math.min(5, blocks.length);
  if (folds < 2) return null;
  const fold = Array.from({ length: folds }, () => W.zeroSuff(tot.p));
  blocks.forEach((b, i) => { const f = fold[i % folds]; const t = W.addSuff(f, b); Object.assign(f, t); });
  let e = 0;
  for (const f of fold) {
    const fit = W.ridge(W.subSuff(tot, f), { lambda, pen });
    if (!fit) return null;
    e += W.sse(f, fit.b);
  }
  const tss = tot.yy - tot.sy * tot.sy / (tot.sw || tot.n);
  return tss > 0 ? 1 - e / tss : null;
}
/* the draws of a full build, or the intervals they left (update): one place decides which */
/* cols: what each position of the draws' arrays is (column names), for a fit whose column set the data decide (VIF
   pruning, the 80% coverage cut, the travel term): the carry records it, and an update whose columns have moved
   since the full build gets no interval (null) rather than another coefficient's at the same position */
function boot(X, key, fn, cols) {
  const sig = cols ? cols.map(String).join('|') : null;
  if (X.mode === 'update') {
    const c = X.carryIn && X.carryIn[key];
    if (!c) return null;
    if ((c.cols || null) !== sig) { if (X.warnings && !X.staleCi) X.warnings.push('the column set moved since the last full build: some intervals are left out until the next one'); X.staleCi = true; return null; }
    return c;
  }
  const r = fn();
  if (r && X.carryOut) {
    const keep = {};
    ['lo', 'hi', 'se', 'v'].forEach(k => { if (r[k] != null) keep[k] = Array.isArray(r[k]) ? r[k].map(sig4) : sig4(r[k]); });
    if (sig) keep.cols = sig;
    X.carryOut[key] = keep;
  }
  return r;
}
const seedOf = (X, key) => (X.seed ^ fnv(key)) >>> 0;
/* a spread across clubs that is real: an SD below 1e-6 of the values' size is floating-point noise around a constant
   (A.1's slot minutes make every club's G/F/C minute shares 0.4 / 0.4 / 0.2 by construction), and is 0, so a constant
   feature gets z 0 and leaves the fits instead of being blown up into a pattern */
const sdReal = vals => { const v = (vals || []).filter(isNum); if (v.length < 2) return 0; const m = meanOf(v), s = sdOf(v); return isNum(s) && s > 1e-6 * Math.max(1, Math.abs(m)) ? s : 0; };
const pctl = (draws, j) => { const c = draws.map(d => d[j]).filter(isNum).sort((a, b) => a - b); return c.length ? [WS().quantile(c, 0.025), WS().quantile(c, 0.975), sdOf(c)] : [null, null, null]; };

/* ------------------------------------------------------------------ club seasons --- */
/* each club's season factors: offence (own rows), defence (opponents' rows), games */
function teamFactors(X) {
  const F = FT(), out = new Map();
  X.teamIds.forEach(tid => {
    const pairs = pairsOf(X, tid);
    out.set(tid, { off: F.seasonFactors(pairs), def: F.seasonFactors(swap(pairs)), n: pairs.length });
  });
  return out;
}
/* the spread over club seasons (8 games or more) of a factor at each end and of their difference */
function sdTeamOf(X, k) {
  const vals = [];
  X.teamIds.forEach(tid => {
    const t = X.tf.get(tid);
    if (!t || t.n < MIN.team) return;
    const o = t.off[k] && t.off[k].v, d = t.def[k] && t.def[k].v;
    vals.push([o, d, isNum(o) && isNum(d) ? o - d : NaN]);
  });
  return { off: nn(sdOf(vals.map(v => v[0]))), def: nn(sdOf(vals.map(v => v[1]))), net: nn(sdOf(vals.map(v => v[2]))), n: vals.length };
}
function teamPctl(X, k, q) {
  const o = [], d = [];
  X.teamIds.forEach(tid => { const t = X.tf.get(tid); if (!t || t.n < MIN.team) return; if (t.off[k]) o.push(t.off[k].v); if (t.def[k]) d.push(t.def[k].v); });
  return { off: nn(qtl(o, q)), def: nn(qtl(d, q)) };
}

/* ================================================================== EXPLAIN MODELS (§7.2-§7.6) === */
/* drop the higher-VIF member of the most correlated pair until every VIF is 10 or less; `keep` are never dropped */
function pruneVif(S, cols, nh, keep) {
  const W = WS();
  let use = cols.slice();
  for (let guard = 0; guard < cols.length; guard++) {
    if (use.length < 2) break;
    const idx = use.map(k => nh + cols.indexOf(k));
    const R = W.corrFromSuff(W.pick(S, idx)), p = idx.length, v = W.vif(R, p);
    if (!(Math.max(...v) > 10)) break;
    let bi = -1, bj = -1, best = -1;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) { const a = Math.abs(R[i * p + j]); if (a > best) { best = a; bi = i; bj = j; } }
    let drop = v[bi] >= v[bj] ? bi : bj;
    if (keep && keep.includes(use[drop])) drop = drop === bi ? bj : bi;
    if (keep && keep.includes(use[drop])) break;
    use = use.filter((_, i) => i !== drop);
  }
  return use;
}

/* One difference model, fitted and reported (§9 Model). o: {name, cols, y, priors (EB), lambda, B, valueOf, hcols} */
function fitModel(X, o) {
  const W = WS(), D = design(X, o.cols, { y: o.y, hcols: o.hcols, only: o.only });
  const nh = D.nh, p = nh + o.cols.length;
  if (D.rows.length < Math.max(MIN.own, p + 5)) return null;
  const blocks = blockSuffs(D), S = W.sumSuff(blocks), pen = penOf(S, nh);
  let lambda = o.lambda != null ? o.lambda : null;
  if (lambda == null) lambda = blocks.length >= 3 ? W.cvLambda(blocks, { pen }).lambda : 1e-4;
  const fit = W.ridge(S, { lambda, pen });
  if (!fit) return null;
  const V = covOf(blocks, fit, S);
  const sigma = Math.sqrt(fit.rss / Math.max(1, S.n - p));
  const fitFn = T => { const r = W.ridge(T, { lambda, pen }); return r ? r.b : null; };
  const strata = X.strataOf ? blocks.map(b => X.strataOf(b.keys[0])) : undefined;
  /* EB toward the pooled coefficients (§7.4): every column the prior has, h included */
  const pr = o.priors && o.priors.beta, keysAll = (nh === 1 ? ['h'] : Array.from({ length: nh }, (_, i) => 'h' + i)).concat(o.cols);
  const bs = o.noBoot ? null : boot(X, 'model:' + o.name, () => { const r = W.blockBootstrap(blocks, fitFn, { B: o.B || X.B, seed: seedOf(X, 'model:' + o.name), strata }); return { lo: r.lo, hi: r.hi, se: r.se }; }, keysAll);
  /* §7.3: the cluster-robust (CR1) and the block-bootstrap SEs should agree; a disagreement over 30% on any coefficient
     is said in the job summary (only where V is CR1: with too few blocks it is the model-based fallback) */
  let seCheck = null;
  if (bs && X.mode !== 'update' && blocks.length >= Math.max(10, 2 * p)) {
    let worst = 0, worstK = null;
    keysAll.forEach((k, j) => { const a = Math.sqrt(Math.max(0, V[j * p + j])), b = bs.se && bs.se[j]; if (isNum(b) && b > 0 && a > 0) { const d = Math.abs(a / b - 1); if (d > worst) { worst = d; worstK = k; } } });
    seCheck = { worst: nn(worst), k: worstK };
    if (worst > 0.3 && X.warnings) X.warnings.push(o.name + ': the CR1 and block-bootstrap SEs disagree by ' + Math.round(100 * worst) + '% on ' + worstK + ' (over 30%, §7.3)');
  }
  let post = null;
  if (pr && keysAll.every(k => isNum(pr[k])) && o.priors.tau2 && keysAll.every(k => isNum(o.priors.tau2[k]))) {
    const bp = keysAll.map(k => pr[k]), t2 = keysAll.map(k => Math.max(1e-12, o.priors.tau2[k]));
    try { post = W.ebPosterior(fit.b, V, bp, t2); } catch (_) { post = null; }
  }
  /* collinearity of the difference columns */
  const idx = o.cols.map((_, i) => nh + i);
  let vif = o.cols.map(() => null), cond = null;
  if (idx.length >= 2) {
    const R = W.corrFromSuff(W.pick(S, idx));
    vif = W.vif(R, idx.length); cond = W.condNumber(R, idx.length);
  } else if (idx.length === 1) vif = [1];
  const shown = j => (post ? post.b[j] : fit.b[j]);
  const shownCI = j => {
    if (post) { const s = Math.sqrt(Math.max(0, post.V[j * p + j])); return [post.b[j] - 1.959963984540054 * s, post.b[j] + 1.959963984540054 * s, s]; }
    return bs ? [bs.lo[j], bs.hi[j], bs.se[j]] : [null, null, Math.sqrt(Math.max(0, V[j * p + j]))];
  };
  const coef = o.cols.map((k, c) => {
    const j = nh + c, b = shown(j), [lo, hi, se] = shownCI(j);
    const sdT = sdTeamOf(X, k);
    const own = post && S.n >= MIN.shown ? ci(fit.b[j], bs ? bs.lo[j] : null, bs ? bs.hi[j] : null) : null;
    const val = v => (o.valueOf ? o.valueOf(v, sdT, sigma) : null);
    const vb = val(b), vlo = val(lo), vhi = val(hi);
    const lohi = (a, z) => (a && z ? [Math.min(a.v, z.v), Math.max(a.v, z.v)] : [null, null]);
    const pick = f => { const a = vlo && { v: vlo[f] }, z = vhi && { v: vhi[f] }; const [l, h] = lohi(a, z); return ci(vb ? vb[f] : null, l, h); };
    return { k, b, lo: nn(lo), hi: nn(hi), se: nn(se), own, w: post ? nn(post.w[j]) : 0, vif: nn(vif[c]), sdTeam: { off: sdT.off, def: sdT.def, net: sdT.net },
      pts: pick('pts'), wins30: pick('wins30'), winsSeason: pick('winsSeason'), bOwn: fit.b[j] };
  });
  /* the home court: the h coefficient; with one h column a league (the pooled fit), the games-weighted mean of the
     leagues' alphas, its interval from the same weights (w' V w) */
  let hb, hci;
  if (nh > 1 && X.hLeague) {
    const w = new Array(nh).fill(0);
    D.gi.forEach(i => { const j = X.hLeague(i); if (j >= 0 && j < nh) w[j]++; });
    const tw = sum(w) || 1;
    for (let j = 0; j < nh; j++) w[j] /= tw;
    const Vh = post ? post.V : V;
    let v = 0;
    hb = 0;
    for (let a = 0; a < nh; a++) { hb += w[a] * shown(a); for (let b = 0; b < nh; b++) v += w[a] * w[b] * Vh[a * p + b]; }
    const se = Math.sqrt(Math.max(0, v));
    hci = [hb - 1.959963984540054 * se, hb + 1.959963984540054 * se, se];
  } else { hb = shown(0); hci = shownCI(0); }
  /* Shapley R² shares, in points of the margin's variance (Σ φ = 100 v(all)) */
  const groups = o.cols.map((_, c) => [nh + c]), force = Array.from({ length: nh }, (_, i) => i);
  const shapOf = T => { const r = W.shapleyR2(T, groups, { force, lambda, pen }); return r.phi.map(v => 100 * v); };
  const phi = shapOf(S);
  const sbs = o.noBoot ? null : boot(X, 'shares:' + o.name, () => { const r = W.blockBootstrap(blocks, shapOf, { B: Math.min(200, o.B || X.B), seed: seedOf(X, 'shares:' + o.name), strata }); return { lo: r.lo, hi: r.hi }; }, o.cols);
  const shares = o.cols.map((k, c) => ({ k, phi: phi[c], lo: sbs ? nn(sbs.lo[c]) : null, hi: sbs ? nn(sbs.hi[c]) : null }));
  /* the old reading: |b| x sd of the difference, as shares */
  const spread = o.cols.map((k, c) => Math.abs(fit.b[nh + c]) * Math.sqrt(Math.max(0, (S.xx[W.pidx(nh + c, nh + c, p)] - S.sx[nh + c] * S.sx[nh + c] / S.sw) / S.sw)));
  const st = sum(spread) || 1, legacy = {};
  o.cols.forEach((k, c) => { legacy[k] = 100 * spread[c] / st; });
  return {
    model: { set: o.cols.slice(), n: S.n, lambda, r2: nn(fit.r2), r2cv: nn(r2cv(blocks, lambda, pen)), sigma, home: ci(hb, hci[0], hci[1]), coef, shares, seCheck,
      oliver: o.oliver ? Object.assign({}, o.oliver) : null, legacy },
    fit, post, S, blocks, D, pen, lambda, V, cond, sigma, nh
  };
}

/* the extended model (core4c + the style set) and the path model (§7.6, §7.7) over the same rows */
function extendedAndPath(X, core, styleKept, lambdaCore) {
  const W = WS();
  if (!styleKept.length) return { extended: null, path: [] };
  const cols = CORE.concat(styleKept), D = design(X, cols, { y: 'yc' });
  if (D.rows.length < Math.max(MIN.own, cols.length + 10)) return { extended: null, path: [] };
  const blocks = blockSuffs(D), S = W.sumSuff(blocks), p = 1 + cols.length, pen = penOf(S, 1);
  const lambda = blocks.length >= 3 ? W.cvLambda(blocks, { pen }).lambda : (lambdaCore || 1e-4);
  const all = Array.from({ length: p }, (_, i) => i), coreIdx = [0, 1, 2, 3, 4];
  const r2Of = (T, idx, lam) => { const r = W.ridge(W.pick(T, idx), { lambda: lam, pen: idx.map(i => pen[i]) }); return r ? r.r2 : NaN; };
  const add = T => [r2Of(T, all, lambda) - r2Of(T, coreIdx, lambda)];
  const r2 = r2Of(S, all, lambda), addR2 = add(S)[0];
  const ab = boot(X, 'ext:add', () => { const r = W.blockBootstrap(blocks, add, { B: X.B, seed: seedOf(X, 'ext:add') }); return { lo: r.lo, hi: r.hi }; });
  /* the nested F test (least squares) */
  const ols = idx => W.ridge(W.pick(S, idx), { lambda: 0 });
  const fr = ols(coreIdx), ff = ols(all), q = p - coreIdx.length, df2 = S.n - p;
  const Fst = fr && ff && df2 > 0 && ff.rss > 0 ? ((fr.rss - ff.rss) / q) / (ff.rss / df2) : null;
  /* Shapley over the groups of §7.6 */
  const gIdx = [];
  const gNames = [];
  EXT_GROUPS.forEach(([g, ks]) => { const ix = ks.map(k => 1 + cols.indexOf(k)).filter(i => i >= 1); if (ix.length) { gIdx.push(ix); gNames.push(g); } });
  const shap = T => W.shapleyR2(T, gIdx, { force: [0], lambda, pen }).phi.map(v => 100 * v);
  const phi = shap(S);
  const gb = boot(X, 'ext:groups', () => { const r = W.blockBootstrap(blocks, shap, { B: Math.min(200, X.B), seed: seedOf(X, 'ext:groups') }); return { lo: r.lo, hi: r.hi }; }, gNames.map((g, i) => g + ':' + gIdx[i].map(j => cols[j - 1]).join('+')));
  const extended = { r2: nn(r2), addR2: ci(addR2, ab && ab.lo[0], ab && ab.hi[0]), F: nn(Fst), p: Fst != null ? nn(W.fP(Fst, q, df2)) : null,
    groups: gNames.map((g, i) => ({ g, phi: phi[i], lo: gb ? nn(gb.lo[i]) : null, hi: gb ? nn(gb.hi[i]) : null })), set: cols.slice() };
  /* PATH: stage A, each competitive factor on h and the style set; stage B, the margin on h, the four and the style */
  const sIdx = styleKept.map((_, j) => 5 + j), mIdx = [1, 2, 3, 4];
  const pathVec = T => {
    const a = mIdx.map(m => { const r = W.ridge(regSuff(T, [0].concat(sIdx), m), { lambda: 0 }); return r ? r.b.slice(1) : sIdx.map(() => NaN); });
    const B = W.ridge(T, { lambda: 0 });
    if (!B) return null;
    const bf = mIdx.map(m => B.b[m]), c = sIdx.map(s => B.b[s]);
    const out = [];
    styleKept.forEach((_, j) => {
      const via = mIdx.map((_, f) => bf[f] * a[f][j]), ind = sum(via);
      out.push(c[j], ind, c[j] + ind, ...via);
    });
    return out;
  };
  const pv = pathVec(S);
  const pb = boot(X, 'path', () => { const r = W.blockBootstrap(blocks, pathVec, { B: Math.min(200, X.B), seed: seedOf(X, 'path') }); return { lo: r.lo, hi: r.hi }; }, styleKept);
  const path = pv ? styleKept.map((k, j) => {
    const o = j * 7, L = i => (pb ? nn(pb.lo[o + i]) : null), H = i => (pb ? nn(pb.hi[o + i]) : null);
    return { k, direct: ci(pv[o], L(0), H(0)), indirect: ci(pv[o + 1], L(1), H(1)), total: ci(pv[o + 2], L(2), H(2)),
      via: CORE.map((f, m) => ({ f, v: pv[o + 3 + m] })) };
  }) : [];
  return { extended, path };
}

/* ================================================================== FORECAST (§7.8) === */
/* A running season sum of some factors, exactly as features.js seasonFactors sums them (masks, means, per game) */
function makeAcc(keys) {
  const F = FT(), N = F.N, M = fac();
  const means = F.LAYOUT.filter(x => x.agg === 'mean').map(x => x.i);
  const fs = keys.map(k => M.get(k)).filter(x => x && x.fn);
  const st = fs.map(() => ({ so: new Float64Array(N), sx: new Float64Array(N), n: 0 }));
  const okBits = (f, a, b) => (f.need ? ((a | 0) & f.need) === f.need && ((b | 0) & f.need) === f.need : true);
  return {
    add(own, opp, qo, qx) {
      fs.forEach((f, j) => {
        if (!okBits(f, qo, qx)) return;
        for (const i of f.uses.own) if (!isFinite(own[i])) return;
        for (const i of f.uses.opp) if (!isFinite(opp[i])) return;
        const s = st[j];
        s.n++;
        for (const i of f.uses.own) s.so[i] += own[i];
        for (const i of f.uses.opp) s.sx[i] += opp[i];
      });
    },
    get(k) {
      const j = fs.findIndex(f => f.k === k);
      if (j < 0) return { v: null, n: 0 };
      const s = st[j], f = fs[j];
      if (!s.n) return { v: null, n: 0 };
      const so = Float64Array.from(s.so), sx = Float64Array.from(s.sx);
      means.forEach(i => { so[i] /= s.n; sx[i] /= s.n; });
      let v = f.fn(so, sx);
      if (v != null && f.pg) v /= s.n;
      return { v: v == null || !isFinite(v) ? null : v, n: s.n };
    }
  };
}
/* the league's make rates (the unit's totals) for shot quality: rim, mid, 2, 3, FT */
function makeRates(X) {
  const I = X.I, Q = FT().QBITS;
  let ra = 0, rm = 0, ma = 0, mm = 0, a2 = 0, m2 = 0, a3 = 0, m3 = 0, fa = 0, fm = 0;
  X.games.forEach(g => [0, 1].forEach(s => {
    const f = g.F[s], v = k => (isNum(f[I[k]]) ? f[I[k]] : 0);
    if ((g.q[s] & Q.ZONES) && isNum(f[I.rim_a])) { ra += v('rim_a'); rm += v('rim_m'); ma += v('mid_a'); mm += v('mid_m'); }
    a2 += v('fga') - v('fg3a'); m2 += v('fgm') - v('fg3m'); a3 += v('fg3a'); m3 += v('fg3m'); fa += v('fta'); fm += v('ftm');
  }));
  return { rim: ra ? rm / ra : NaN, mid: ma ? mm / ma : NaN, p2: a2 ? m2 / a2 : NaN, p3: a3 ? m3 / a3 : NaN, ft: fa ? fm / fa : NaN };
}
/* one side's expected eFG% from its shot mix at the league's make rates, and its expected points (§7.11);
   two zones without the ZONES bit. Returns [numerator (made-equivalents), fga, xpts] */
function shotQuality(X, g, s, R) {
  const I = X.I, f = g.F[s], v = k => (isNum(f[I[k]]) ? f[I[k]] : NaN);
  const zones = (g.q[s] & FT().QBITS.ZONES) && isNum(v('rim_a')) && isNum(R.rim) && isNum(R.mid);
  const fga = v('fga'), a3 = v('fg3a'), fta = v('fta');
  if (!isNum(fga) || !(fga > 0) || !isNum(a3)) return [NaN, NaN, NaN];
  const twos = zones ? v('rim_a') * R.rim + v('mid_a') * R.mid : (fga - a3) * R.p2;
  return [twos + 1.5 * a3 * R.p3, fga, 2 * twos + 3 * a3 * R.p3 + (isNum(fta) ? fta * R.ft : 0)];
}
const hav = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
};

/* Elo through the season (K 20, 1500, sos.js's margin multiplier), the home term on the game's expectation */
function eloPass(X, H) {
  const R = new Map(), pre = [];
  let ll = 0, n = 0;
  X.games.forEach((g, i) => {
    const eh = R.has(g.h) ? R.get(g.h) : ELO_0, ea = R.has(g.a) ? R.get(g.a) : ELO_0;
    const d = eh - ea + H * X.h[i], p = 1 / (1 + Math.pow(10, -d / 400));
    pre.push([eh, ea, p]);
    const yv = X.y[i], act = yv > 0 ? 1 : yv < 0 ? 0 : 0.5;
    if (yv !== 0) { ll -= act ? Math.log(Math.max(1e-12, p)) : Math.log(Math.max(1e-12, 1 - p)); n++; }
    const mult = Math.log(Math.abs(yv) + 1) * (2.2 / ((Math.abs(eh - ea) * 0.001) + 2.2));
    const ch = ELO_K * mult * (act - p);
    R.set(g.h, eh + ch); R.set(g.a, ea - ch);
  });
  return { ll: n ? ll / n : Infinity, pre, final: R };
}

/* Pre-game everything, for every game: shrunk season-to-date profiles (both ends of the four competitive factors and
   shot quality), the expected differentials, Elo, rest, back-to-backs, travel, pace, net rating, Pythagorean */
function pregame(X) {
  const F = FT(), I = X.I, R = makeRates(X);
  X.rates = R;
  const keys = CORE.concat(['pace3q']);
  /* the league means and the shrinkage k = σ²_within / τ²_between per factor (whole unit, clamped [2, 30]) */
  const all = [];
  X.games.forEach(g => { all.push({ own: g.F[0], opp: g.F[1], qOwn: g.q[0], qOpp: g.q[1] }, { own: g.F[1], opp: g.F[0], qOwn: g.q[1], qOpp: g.q[0] }); });
  const lg = F.seasonFactors(all);
  const mu = {}, kk = {};
  keys.forEach(k => { mu[k] = lg[k] ? lg[k].v : null; });
  const sq = X.games.map((g, i) => [0, 1].map(s => shotQuality(X, g, s, R)));
  const xe = sq.map(p => p.map(v => (isNum(v[0]) && v[1] > 0 ? 100 * v[0] / v[1] : NaN)));
  mu.xefg = (() => { let a = 0, b = 0; sq.forEach(p => p.forEach(v => { if (isNum(v[0])) { a += v[0]; b += v[1]; } })); return b ? 100 * a / b : null; })();
  const within = (k, end) => {
    const per = new Map();
    X.games.forEach((g, i) => [0, 1].forEach(s => {
      const tid = s ? g.a : g.h, src = end === 'off' ? s : 1 - s;
      const v = k === 'xefg' ? xe[i][src] : X.dv[i][src][k];
      if (!isNum(v)) return;
      if (!per.has(tid)) per.set(tid, []);
      per.get(tid).push(v);
    }));
    const groups = Array.from(per.values()).filter(a => a.length >= 2);
    if (groups.length < 3) return 10;
    let ssw = 0, N = 0;
    const means = groups.map(a => { const m = a.reduce((x, y) => x + y, 0) / a.length; a.forEach(v => { ssw += (v - m) * (v - m); }); N += a.length; return m; });
    const s2w = ssw / Math.max(1, N - groups.length), inv = meanOf(groups.map(a => 1 / a.length));
    const t2 = Math.pow(sdOf(means), 2) - s2w * inv;
    return t2 > 0 ? clamp(s2w / t2, 2, 30) : 30;
  };
  CORE.concat(['xefg', 'pace3q']).forEach(k => { kk[k] = { off: within(k, 'off'), def: within(k, 'def') }; });
  X.mu = mu; X.kShrink = kk;
  X.sq = sq; X.xe = xe;
  /* Elo: the home term chosen on 0, 10, ..., 150 by log loss */
  let best = null;
  for (let H = 0; H <= 150; H += 10) { const r = eloPass(X, H); if (!best || r.ll < best.ll - 1e-12) best = Object.assign({ H }, r); }
  X.elo = best;
  X.pre = X.games.map((g, i) => ({ n: [0, 0], ex: {}, x: {}, elo: [best.pre[i][0], best.pre[i][1]], pElo: best.pre[i][2] }));
  pregameProfiles(X);
  return X.pre;
}
/* the walk: each game sees the clubs' sums as they stood before its tip-off (two games at the same tip-off never
   see each other) */
function pregameProfiles(X) {
  const keys = CORE.concat(['pace3q']), I = X.I, kk = X.kShrink, mu = X.mu;
  const st = new Map();
  const S = tid => { if (!st.has(tid)) st.set(tid, { off: makeAcc(keys), def: makeAcc(keys), n: 0, xo: [0, 0], xd: [0, 0], pf: 0, pa: 0, poss: 0, last: null, lastV: null }); return st.get(tid); };
  const shrink = (v, n, k, m) => (isNum(v) && isNum(m) ? (n * v + k * m) / (n + k) : m);
  const prof = (T, k, end) => { const a = end === 'off' ? T.off.get(k) : T.def.get(k); return shrink(a.v, a.n, kk[k] ? kk[k][end] : 10, mu[k]); };
  const xprof = (T, end) => { const v = end === 'off' ? T.xo : T.xd; return shrink(v[1] > 0 ? 100 * v[0] / v[1] : null, T.n, kk.xefg[end], mu.xefg); };
  const W = WS();
  const blend = (k, off, def) => {
    if (!isNum(off) || !isNum(def) || !isNum(mu[k])) return NaN;
    if (PROP[k] || k === 'xefg') { const c = v => clamp(v / 100, 1e-4, 1 - 1e-4); return 100 * W.expit(W.logit(c(off)) + W.logit(c(def)) - W.logit(c(mu[k]))); }
    return off + def - mu[k];
  };
  const venues = (X.input.venues || X.ctx.venues) || {};
  const coord = v => { const c = venues[v]; return c && isNum(+c[0]) && isNum(+c[1]) ? [+c[0], +c[1]] : null; };
  let j = 0, withKm = 0;
  X.games.forEach((g, i) => {
    while (j < i && X.games[j].t < g.t) {
      const gj = X.games[j];
      [0, 1].forEach(s => {
        const T = S(s ? gj.a : gj.h), own = gj.F[s], opp = gj.F[1 - s];
        T.off.add(own, opp, gj.q[s], gj.q[1 - s]); T.def.add(opp, own, gj.q[1 - s], gj.q[s]);
        T.n++;
        const so = X.sq[j][s], sd = X.sq[j][1 - s];
        if (isNum(so[0])) { T.xo[0] += so[0]; T.xo[1] += so[1]; }
        if (isNum(sd[0])) { T.xd[0] += sd[0]; T.xd[1] += sd[1]; }
        const pts = s ? gj.as : gj.hs, pa = s ? gj.hs : gj.as, pe = own[I.poss_est];
        if (isNum(pts) && isNum(pa) && isNum(pe)) { T.pf += pts; T.pa += pa; T.poss += pe; }
        T.last = gj.t; T.lastV = gj.v || T.lastV;
      });
      j++;
    }
    const Th = S(g.h), Ta = S(g.a), o = X.pre[i];
    o.n = [Th.n, Ta.n];
    CORE.forEach(k => {
      const hO = prof(Th, k, 'off'), hD = prof(Th, k, 'def'), aO = prof(Ta, k, 'off'), aD = prof(Ta, k, 'def');
      o.x[k] = { h: [hO, hD], a: [aO, aD] };
      o.ex[k] = blend(k, hO, aD) - blend(k, aO, hD);
    });
    o.ex.xefg = blend('xefg', xprof(Th, 'off'), xprof(Ta, 'def')) - blend('xefg', xprof(Ta, 'off'), xprof(Th, 'def'));
    o.pace = [prof(Th, 'pace3q', 'off'), prof(Ta, 'pace3q', 'off')];
    o.net = [Th.poss > 0 ? 100 * (Th.pf - Th.pa) / Th.poss : 0, Ta.poss > 0 ? 100 * (Ta.pf - Ta.pa) / Ta.poss : 0];
    const py = T => (T.pf + T.pa > 0 ? 1 / (1 + Math.pow(T.pa / Math.max(1e-9, T.pf), 14)) : 0.5);
    o.pyth = [py(Th), py(Ta)];
    const rest = T => (T.last == null ? 7 : Math.min(7, (g.t - T.last) / DAY));
    o.rest = [rest(Th), rest(Ta)];
    o.b2b = [o.rest[0] < 1.5 ? 1 : 0, o.rest[1] < 1.5 ? 1 : 0];
    const here = coord(g.v), km = T => { const c0 = T.lastV ? coord(T.lastV) : null; return here && c0 ? hav(c0, here) : (T.lastV == null && here ? 0 : NaN); };
    o.km = [km(Th), km(Ta)];
    if (isNum(o.km[0]) && isNum(o.km[1])) withKm++;
  });
  X.kmOk = X.n > 0 && withKm / X.n >= 0.7;
  X.teamState = st;
}

const FC_COLS = ['h', 'e_c_efg', 'e_c_tovp', 'e_c_orebp', 'e_c_ftr', 'elo', 'rest', 'b2b', 'km'];
function fcRow(X, i, withKm) {
  const o = X.pre[i];
  const r = [X.h[i], o.ex.c_efg, o.ex.c_tovp, o.ex.c_orebp, o.ex.c_ftr, (o.elo[0] - o.elo[1]) / 100, o.rest[0] - o.rest[1], o.b2b[0] - o.b2b[1]];
  if (withKm) r.push(isNum(o.km[0]) && isNum(o.km[1]) ? (o.km[0] - o.km[1]) / 1000 : 0);
  return r;
}

/* The Forecast model, its rolling-origin test, the baselines and the gate. Leaves X.fc for the rest of the build. */
function forecast(X, priors) {
  const W = WS();
  const withKm = X.kmOk, cols = FC_COLS.slice(0, withKm ? 9 : 8), p = cols.length;
  const elig = [];
  for (let i = 0; i < X.n; i++) if (X.pre[i].n[0] >= 1 && X.pre[i].n[1] >= 1 && isNum(X.y[i])) elig.push(i);
  const rowsAll = elig.map(i => fcRow(X, i, withKm)), yAll = elig.map(i => X.y[i]);
  const okRows = rowsAll.map(r => r.every(isNum));
  const D = { rows: rowsAll.filter((_, j) => okRows[j]), y: yAll.filter((_, j) => okRows[j]), gi: elig.filter((_, j) => okRows[j]) };
  D.blk = D.gi.map(i => X.blocks[i]);
  const prior = priors && priors.forecast && cols.every(k => isNum(priors.forecast[k])) && D.rows.length < MIN.shown ? cols.map(k => priors.forecast[k]) : null;
  let lambda = 1e-3, blocks = [], S = null, pen = null, fit = null;
  if (D.rows.length >= p + 5) {
    blocks = blockSuffs(D); S = W.sumSuff(blocks); pen = penOf(S, 1);
    lambda = blocks.length >= 3 ? W.cvLambda(blocks, { pen, prior }).lambda : 1e-2;
    fit = W.ridge(S, { lambda, pen, prior });
  }
  /* the Elo-only margin model: y on h and the Elo difference */
  const eloRow = i => [X.h[i], (X.pre[i].elo[0] - X.pre[i].elo[1]) / 100];
  /* ROLLING ORIGIN from the unit's fourth ISO week: train on earlier weeks, predict the week */
  const weeks = Array.from(new Set(X.games.map(g => isoWeek(g.t)))).sort();
  const wkOf = X.games.map(g => weeks.indexOf(isoWeek(g.t)));
  let test = [];
  for (let i = 0; i < X.n; i++) if (wkOf[i] >= 3 && X.pre[i].n[0] >= MIN.test && X.pre[i].n[1] >= MIN.test && isNum(X.y[i]) && X.y[i] !== 0) test.push(i);
  if (test.length > 4000) {
    const r = W.rng(seedOf(X, 'fc:sample')), idx = test.slice();
    for (let a = idx.length - 1; a > 0; a--) { const b = Math.floor(r() * (a + 1)); const t = idx[a]; idx[a] = idx[b]; idx[b] = t; }
    test = idx.slice(0, 1500).sort((a, b) => a - b);
  }
  const testSet = new Set(test);
  const preds = [];
  let trF = null, trE = null, homeW = 0, homeN = 0;
  const rowIdx = new Map(D.gi.map((g, j) => [g, j]));
  /* trained: the games in the training sums so far (the test reads it: none is in or after the week it predicts) */
  const trained = [], trace = [];
  for (let wk = 0; wk < weeks.length; wk++) {
    const inWk = [];
    for (let i = 0; i < X.n; i++) if (wkOf[i] === wk) inWk.push(i);
    if (wk >= 3 && trF && trF.n >= p + 5) {
      if (X.wantTrace) trace.push({ week: weeks[wk], tested: inWk.filter(i => testSet.has(i)), trained: trained.slice() });
      const fF = W.ridge(trF, { lambda, pen: penOf(trF, 1), prior });
      const fE = W.ridge(trE, { lambda: 0 });
      inWk.forEach(i => {
        if (!testSet.has(i) || !fF || !fE) return;
        const r = fcRow(X, i, withKm);
        if (!r.every(isNum)) return;
        const yf = r.reduce((a, v, k) => a + v * fF.b[k], 0), er = eloRow(i), ye = er[0] * fE.b[0] + er[1] * fE.b[1];
        preds.push({ i, yf, ye, ph: X.h[i] ? (homeN ? homeW / homeN : 0.5) : 0.5 });
      });
    }
    /* the week joins the training sums */
    inWk.forEach(i => {
      if (rowIdx.has(i)) {
        trained.push(i);
        const j = rowIdx.get(i), s1 = W.suff([D.rows[j]], [D.y[j]]);
        trF = trF ? W.addSuff(trF, s1) : s1;
        const s2 = W.suff([eloRow(i)], [X.y[i]]);
        trE = trE ? W.addSuff(trE, s2) : s2;
      }
      if (X.h[i] === 1 && X.y[i] !== 0) { homeN++; if (X.y[i] > 0) homeW++; }
    });
  }
  const nEval = preds.length;
  const sF = Math.sqrt(meanOf(preds.map(q => (X.y[q.i] - q.yf) ** 2))), sE = Math.sqrt(meanOf(preds.map(q => (X.y[q.i] - q.ye) ** 2)));
  const yw = preds.map(q => (X.y[q.i] > 0 ? 1 : 0));
  const pF = preds.map(q => W.normCdf(q.yf / (sF || 12)));
  const pE = preds.map(q => X.pre[q.i].pElo);
  const pH = preds.map(q => q.ph);
  const pN = preds.map(q => 1 / (1 + Math.pow(10, -(X.pre[q.i].net[0] - X.pre[q.i].net[1]) / 10)));
  const pP = preds.map(q => { const a = X.pre[q.i].pyth[0], b = X.pre[q.i].pyth[1], d = a + b - 2 * a * b; return d > 0 ? clamp((a - a * b) / d, 1e-4, 1 - 1e-4) : 0.5; });
  const cal = ps => (nEval ? W.calibration(ps, yw) : W.calibration([], []));
  const metrics = cal(pF), base = { home: cal(pH), elo: cal(pE), net: cal(pN), pyth: cal(pP) };
  const live = nEval >= MIN.gate && isNum(metrics.brier) && metrics.brier < base.home.brier && metrics.brier <= base.elo.brier + 0.002;
  /* σ_pred: the out-of-fold spread around the live model's expectation (Forecast, else Elo); few test games: the
     pooled value, else the Elo model in sample. Shrunk on the log scale with weight n / (n + 200). */
  let sigma = live ? sF : sE, src = live ? 'forecast' : 'elo';
  if (!(nEval >= 30) || !isNum(sigma)) {
    const all = []; for (let i = 0; i < X.n; i++) if (isNum(X.y[i])) all.push(i);
    const fe = all.length > 5 ? W.ridge(W.suff(all.map(eloRow), all.map(i => X.y[i])), { lambda: 0 }) : null;
    sigma = fe ? Math.sqrt(fe.rss / Math.max(1, all.length - 2)) : NaN;
    src = 'elo';
  }
  const pooledSigma = priors && isNum(priors.sigmaPred) ? priors.sigmaPred : null;
  if (pooledSigma && isNum(sigma)) { const wgt = nEval / (nEval + 200); sigma = Math.exp(wgt * Math.log(sigma) + (1 - wgt) * Math.log(pooledSigma)); }
  else if (!isNum(sigma) && pooledSigma) sigma = pooledSigma;
  if (!isNum(sigma)) sigma = 12;
  /* the whole unit's model: coefficients with their block bootstrap, and the logistic cross-check */
  let coef = [], logitAgree = false;
  if (fit) {
    const fitFn = T => { const r = W.ridge(T, { lambda, pen: penOf(T, 1), prior }); return r ? r.b : null; };
    const bs = boot(X, 'forecast', () => { const r = W.blockBootstrap(blocks, fitFn, { B: Math.min(200, X.B), seed: seedOf(X, 'forecast') }); return { lo: r.lo, hi: r.hi }; }, cols);
    coef = cols.map((k, j) => ({ k, b: fit.b[j], lo: bs ? nn(bs.lo[j]) : null, hi: bs ? nn(bs.hi[j]) : null }));
    const yw2 = D.y.map(v => (v > 0 ? 1 : 0)), keep = D.y.map(v => v !== 0);
    const lg = W.logistic(D.rows.filter((_, j) => keep[j]), yw2.filter((_, j) => keep[j]), { lambda, pen });
    logitAgree = !!(lg && lg.converged && bs && coef.slice(1).every((c, j) => {
      const s = lg.b[j + 1] * sigma / 1.702;
      return isNum(c.lo) && isNum(c.hi) && s >= c.lo && s <= c.hi;
    }));
  }
  X.fc = { live, sigma, src, lambda, fit, cols, preds, pF, pE, sF, sE, nEval, withKm, prior };
  if (X.wantTrace) X.trace = { weeks: trace, pre: X.pre.map(o => o.n.slice()) };
  return { live, n: D.rows.length, nEval, sigma, coef, metrics, baselines: base, logitAgree, eloHca: best0(X), sim: null, transfer: null };
}
const best0 = X => (X.elo ? X.elo.H : 0);

/* ================================================================== THE SCAN AND THE CURVES (§7.1, §7.9) === */
/* the curves' smoothing: gamLogit's standardised penalty at 1e-5 lets the two inner spline columns cancel into a flat
   middle on a few hundred games; 0.01 gives smooth, monotone curves with the same ends (checked on synthetic leagues) */
const CURVE_LAMBDA = 0.01;
const diffKeys = () => FT().FACTORS.filter(x => x.fn && x.diff && !x.builder && x.side !== 'game').map(x => x.k);
function scan(X) {
  const W = WS(), M = fac(), out = [];
  diffKeys().forEach(k => {
    const x = X.dx[k];
    if (!x) return;
    const idx = [];
    for (let i = 0; i < X.n; i++) if (isNum(x[i]) && X.w[i] != null) idx.push(i);
    if (idx.length < MIN.own) return;
    const dir = dirOf(k) === -1 ? -1 : 1;
    const pb = W.pointBiserial(idx.map(i => x[i]), idx.map(i => X.w[i]), { dir, blocks: idx.map(i => X.blocks[i]) });
    if (pb.r == null) return;
    const dec = idx.filter(i => x[i] !== 0);
    const won = dec.filter(i => ((x[i] > 0) === (dir > 0)) === (X.w[i] === 1)).length;
    const wl = W.wilson(won, dec.length);
    const wv = idx.map(i => X.dv[i][X.w[i] ? 0 : 1][k]), lv = idx.map(i => X.dv[i][X.w[i] ? 1 : 0][k]);
    out.push({ k, n: pb.n, r: pb.r, lo: pb.lo, hi: pb.hi, p: pb.p, q: null, wonIt: dec.length ? won / dec.length : null, wonLo: dec.length ? wl[0] : null,
      wonHi: dec.length ? wl[1] : null, decided: dec.length, winMean: nn(meanOf(wv)), loseMean: nn(meanOf(lv)), vif: null, score: !!M.get(k).score });
  });
  const q = W.bh(out.map(r => r.p));
  out.forEach((r, i) => { r.q = q[i]; });
  return out;
}
/* the nice number (1, 2, 2.5, 5 x 10^n) nearest a value */
function niceNear(v) {
  if (!(v > 0)) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  let best = null;
  for (const m of [1, 2, 2.5, 5, 10]) { const c = m * mag; if (best == null || Math.abs(c - v) < Math.abs(best - v)) best = c; }
  return +best.toPrecision(6);
}
/* where a fitted curve crosses p inside the data (P2-P98), null when it does not; of several crossings, the one
   nearest `near` (default 0) */
function crossAt(g, p, near) {
  const xs = g.grid.map(r => r[0]);
  if (xs.length < 2) return null;
  const f = x => g.at(x).p - p, lo = xs[0], hi = xs[xs.length - 1], K = 48, at = near != null ? near : 0;
  let best = null;
  let x0 = lo, f0 = f(lo);
  for (let k = 1; k <= K; k++) {
    const x1 = lo + (hi - lo) * k / K, f1 = f(x1);
    if (f0 === 0 || f0 * f1 < 0) {
      const r = f0 === 0 ? x0 : WS().bisect(f, x0, x1, { tol: 1e-7 });
      if (r != null && (best == null || Math.abs(r - at) < Math.abs(best - at))) best = r;
    }
    x0 = x1; f0 = f1;
  }
  if (best == null && f0 === 0) best = hi;
  return best;
}
function curves(X, adjSet) {
  const W = WS(), out = {};
  diffKeys().forEach(k => {
    const x = X.dx[k];
    if (!x) return;
    const idx = [];
    for (let i = 0; i < X.n; i++) if (isNum(x[i]) && X.w[i] != null) idx.push(i);
    if (idx.length < 2 * MIN.bin) return;
    const xs = idx.map(i => x[i]), ws = idx.map(i => X.w[i]), hs = idx.map(i => X.h[i]), ms_ = idx.map(i => X.y[i]);
    if (!(sdOf(xs) > 0)) return;
    const binsK = W.bins(xs, ws, ms_, { n: 10, minN: MIN.bin });
    /* the curve is fitted on every game from both sides at half weight: logit P = s(Δx) + α h has no intercept of
       its own (a neutral site flips every sign), and the mirror pins gamLogit's at zero while α stays identified */
    const sym = (a, b, c, extra) => ({ x: a.concat(a.map(v => -v)), y: b.concat(b.map(v => 1 - v)), h: c.concat(c.map(v => -v)),
      w: new Array(2 * a.length).fill(0.5), X: extra ? extra.concat(extra.map(r => r.map(v => -v))) : undefined, lambda: CURVE_LAMBDA });
    let g;
    try { g = W.gamLogit(sym(xs, ws, hs)); } catch (_) { return; }
    if (!g || !g.b || g.b.some(v => !isNum(v)) || g.grid.some(r => !r.every(isNum))) return;
    let adj = null;
    if (adjSet.includes(k)) {
      const others = CORE.filter(c => c !== k);
      const ok = idx.map(i => others.every(c => isNum(X.dx[c][i])));
      const ii = idx.filter((_, j) => ok[j]);
      if (ii.length >= 2 * MIN.bin) {
        try {
          const ga = W.gamLogit(sym(ii.map(i => x[i]), ii.map(i => X.w[i]), ii.map(i => X.h[i]), ii.map(i => others.map(c => X.dx[c][i]))));
          if (ga && ga.b.every(isNum)) adj = ga.grid;
        } catch (_) { adj = null; }
      }
    }
    /* x50 and x75: block bootstrap for the core four and the leading style factors, the delta method elsewhere */
    const x50 = crossAt(g, 0.5), x75 = crossAt(g, 0.75);
    let i50 = [null, null], i75 = [null, null];
    if (adjSet.includes(k)) {
      const bl = new Map();
      idx.forEach((i, j) => { const b = X.blocks[i]; if (!bl.has(b)) bl.set(b, []); bl.get(b).push(j); });
      const lists = Array.from(bl.keys()).sort((a, b) => a - b).map(b => bl.get(b));
      const bs = boot(X, 'cross:' + k, () => {
        const r = W.rng(seedOf(X, 'cross:' + k)), d50 = [], d75 = [], B = Math.min(200, X.B);
        for (let d = 0; d < B; d++) {
          const pick = [];
          for (let j = 0; j < lists.length; j++) pick.push(...lists[Math.floor(r() * lists.length)]);
          try {
            const gb = W.gamLogit(Object.assign(sym(pick.map(j => xs[j]), pick.map(j => ws[j]), pick.map(j => hs[j])), { knots: g.knots, grid: 9 }));
            if (x50 != null) { const v = crossAt(gb, 0.5, x50); if (v != null) d50.push([v]); }
            if (x75 != null) { const v = crossAt(gb, 0.75, x75); if (v != null) d75.push([v]); }
          } catch (_) { /* a draw that does not fit is skipped */ }
        }
        const a = pctl(d50, 0), b = pctl(d75, 0);
        return { lo: [a[0], b[0]], hi: [a[1], b[1]] };
      });
      if (bs) { i50 = [bs.lo[0], bs.hi[0]]; i75 = [bs.lo[1], bs.hi[1]]; }
    } else {
      const dm = v => {
        if (v == null) return [null, null];
        const e = 1e-4 * (Math.abs(v) + 1), d = (g.at(v + e).eta - g.at(v - e).eta) / (2 * e), se = g.at(v).se;
        if (!(Math.abs(d) > 1e-12)) return [null, null];
        const h = 1.959963984540054 * se / Math.abs(d);
        return [v - h, v + h];
      };
      i50 = dm(x50); i75 = dm(x75);
    }
    /* quartiles of the difference, with the share won */
    const sorted = xs.slice().sort((a, b) => a - b), cuts = [0.25, 0.5, 0.75].map(q => W.quantile(sorted, q));
    const quart = [0, 1, 2, 3].map(qi => {
      const lo = qi ? cuts[qi - 1] : sorted[0], hi = qi < 3 ? cuts[qi] : sorted[sorted.length - 1];
      const sel = xs.map((v, j) => j).filter(j => (qi === 0 ? xs[j] <= hi : qi === 3 ? xs[j] > lo : xs[j] > lo && xs[j] <= hi));
      const won = sum(sel.map(j => ws[j])), wl = W.wilson(won, sel.length);
      return { lo, hi, n: sel.length, p: sel.length ? won / sel.length : null, plo: wl[0], phi: wl[1] };
    });
    /* the histogram on nice edges over P1-P99 */
    const p1 = W.quantile(sorted, 0.01), p99 = W.quantile(sorted, 0.99), tk = W.niceTicks(p1, p99, 12).ticks;
    const edges = tk.length >= 2 ? tk : [p1, p99];
    const hist = [];
    for (let e = 0; e + 1 < edges.length; e++) hist.push([edges[e], edges[e + 1], xs.filter(v => v >= edges[e] && (e + 2 === edges.length ? v <= edges[e + 1] : v < edges[e + 1])).length]);
    /* the hard number: sides ahead by t or more (in the better direction) */
    const dir = dirOf(k) === -1 ? -1 : 1, t = niceNear(W.quantile(xs.map(Math.abs).sort((a, b) => a - b), 0.75));
    let hard = null;
    if (t) {
      const sel = xs.map((v, j) => j).filter(j => Math.abs(xs[j]) >= t);
      if (sel.length >= MIN.hard) {
        const won = sel.filter(j => ((xs[j] > 0) === (dir > 0)) === (ws[j] === 1)).length, wl = W.wilson(won, sel.length);
        hard = { t, n: sel.length, p: won / sel.length, lo: wl[0], hi: wl[1] };
      }
    }
    out[k] = { bins: binsK, raw: g.grid, adj, x50: x50 == null ? null : ci(x50, i50[0], i50[1]), x75: x75 == null ? null : ci(x75, i75[0], i75[1]),
      quart, hist, hard, _n: idx.length };
  });
  return out;
}

/* ================================================================== PACE AND TIME OF POSSESSION (§7.10) === */
/* probit P(y) = Φ(a + b z) by Fisher scoring -> {a, b, ll} */
function probit(z, y) {
  const W = WS();
  let a = 0, b = 0, ll = -Infinity;
  for (let it = 0; it < 40; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0, L = 0;
    for (let i = 0; i < z.length; i++) {
      const e = a + b * z[i], P = clamp(W.normCdf(e), 1e-12, 1 - 1e-12), d = W.normPdf(e);
      L += y[i] ? Math.log(P) : Math.log(1 - P);
      const s = (y[i] - P) * d / (P * (1 - P)), wgt = d * d / (P * (1 - P));
      g0 += s; g1 += s * z[i]; h00 += wgt; h01 += wgt * z[i]; h11 += wgt * z[i] * z[i];
    }
    ll = L;
    const det = h00 * h11 - h01 * h01;
    if (!(Math.abs(det) > 1e-14)) break;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  let L = 0;
  for (let i = 0; i < z.length; i++) { const P = clamp(W.normCdf(a + b * z[i]), 1e-12, 1 - 1e-12); L += y[i] ? Math.log(P) : Math.log(1 - P); }
  return { a, b, ll: isNum(L) ? L : ll };
}
function tempo(X) {
  const W = WS(), F = FT(), I = X.I;
  /* 1. the clubs' tempo: mean pace3q, its z within the unit, win% and net rating */
  const teams = [];
  X.teamIds.forEach(tid => {
    const t = X.tf.get(tid), T = X.teams.get(tid);
    if (!t || !T) return;
    let w = 0, l = 0, pf = 0, pa = 0, poss = 0;
    T.gl.forEach(([i, s]) => {
      const g = X.games[i], m = s ? g.as - g.hs : g.hs - g.as;
      if (m > 0) w++; else if (m < 0) l++;
      const own = g.F[s];
      if (isNum(own[I.poss_est])) { pf += s ? g.as : g.hs; pa += s ? g.hs : g.as; poss += own[I.poss_est]; }
    });
    const pace = t.off.pace3q && t.off.pace3q.v;
    teams.push({ id: tid, name: T.name, pace3q: nn(pace), z: null, winPct: w + l ? w / (w + l) : null, net: poss ? 100 * (pf - pa) / poss : null, gp: T.gl.length, w, l });
  });
  const ok = teams.filter(t => isNum(t.pace3q) && t.gp >= MIN.team);
  const m = meanOf(ok.map(t => t.pace3q)), s = sdOf(ok.map(t => t.pace3q));
  teams.forEach(t => { t.z = isNum(t.pace3q) && s > 0 ? (t.pace3q - m) / s : null; });
  const nz = meanOf(ok.map(t => t.net)), nsd = sdOf(ok.map(t => t.net));
  let bins = [], curve = [], curveAdj = [];
  if (ok.length >= 5) {
    const srt = ok.slice().sort((a, b) => (a.z - b.z) || byId(a.id, b.id)), k = 5;
    for (let b = 0; b < k; b++) {
      const part = srt.slice(Math.round(b * srt.length / k), Math.round((b + 1) * srt.length / k));
      if (!part.length) continue;
      const n = sum(part.map(t => t.w + t.l)), wins = sum(part.map(t => t.w)), wl = W.wilson(wins, n);
      bins.push([part[0].z, part[part.length - 1].z, meanOf(part.map(t => t.z)), n, wins, n ? wins / n : null, wl[0], wl[1], meanOf(part.map(t => t.net))]);
    }
    const zOf = new Map(ok.map(t => [t.id, t])), xs = [], ys = [], hs = [], adj = [];
    X.games.forEach((g, i) => {
      if (X.w[i] == null) return;
      [0, 1].forEach(sd => {
        const t = zOf.get(sd ? g.a : g.h);
        if (!t) return;
        xs.push(t.z); ys.push(sd ? 1 - X.w[i] : X.w[i]); hs.push(sd ? -X.h[i] : X.h[i]); adj.push([nsd > 0 ? (t.net - nz) / nsd : 0]);
      });
    });
    try { curve = W.gamLogit({ x: xs, y: ys, h: hs, lambda: CURVE_LAMBDA }).grid; } catch (_) { curve = []; }
    try { curveAdj = W.gamLogit({ x: xs, y: ys, h: hs, X: adj, lambda: CURVE_LAMBDA }).grid; } catch (_) { curveAdj = []; }
  }
  /* 2. √N: does a longer game help the favourite? on the rolling-origin games */
  let sqrtN = null;
  const P = (X.fc && X.fc.preds) || [];
  const lgPace = X.mu && X.mu.pace3q;
  if (P.length >= MIN.gate && isNum(lgPace)) {
    const rows = P.map(q => {
      const o = X.pre[q.i], mu = X.fc.live ? q.yf : q.ye, reg = X.games[q.i].F[0][I.reg_min];
      const Nh = isNum(o.pace[0]) && isNum(o.pace[1]) ? o.pace[0] * o.pace[1] / lgPace * ((isNum(reg) ? reg : 40) / 40) : NaN;
      return { i: q.i, mu, Nh, fav: (mu >= 0) === (X.y[q.i] > 0) ? 1 : 0 };
    }).filter(r => isNum(r.mu) && isNum(r.Nh));
    if (rows.length >= MIN.gate) {
      const Nbar = meanOf(rows.map(r => r.Nh));
      rows.forEach(r => { r.rho = r.Nh / Nbar; });
      const fitG = (rs, gam) => probit(rs.map(r => Math.abs(r.mu) * Math.pow(r.rho, gam)), rs.map(r => r.fav));
      const best = rs => { const gs = W.golden(gm => -fitG(rs, gm).ll, -1, 2, { tol: 1e-4 }); return { gamma: gs.x, fit: fitG(rs, gs.x) }; };
      const B0 = best(rows), f0 = fitG(rows, 0);
      const lr = 2 * (B0.fit.ll - f0.ll), lrP = W.chi2P(Math.max(0, lr), 1);
      const bl = new Map();
      rows.forEach((r, j) => { const b = X.blocks[r.i]; if (!bl.has(b)) bl.set(b, []); bl.get(b).push(j); });
      const lists = Array.from(bl.keys()).sort((a, b) => a - b).map(b => bl.get(b));
      const gb = boot(X, 'sqrtN', () => {
        const r = W.rng(seedOf(X, 'sqrtN')), d = [];
        for (let k = 0; k < Math.min(200, X.B); k++) {
          const pick = [];
          for (let j = 0; j < lists.length; j++) pick.push(...lists[Math.floor(r() * lists.length)].map(x => rows[x]));
          d.push([best(pick).gamma]);
        }
        const q = pctl(d, 0);
        return { lo: [q[0]], hi: [q[1]] };
      });
      const srt = rows.slice().sort((a, b) => a.rho - b.rho), terc = [];
      for (let t = 0; t < 3; t++) {
        const part = srt.slice(Math.round(t * srt.length / 3), Math.round((t + 1) * srt.length / 3));
        const won = sum(part.map(r => r.fav)), wl = W.wilson(won, part.length);
        const fit = meanOf(part.map(r => W.normCdf(B0.fit.a + B0.fit.b * Math.abs(r.mu) * Math.pow(r.rho, B0.gamma))));
        const fit0 = meanOf(part.map(r => W.normCdf(f0.a + f0.b * Math.abs(r.mu))));
        terc.push({ rho: meanOf(part.map(r => r.rho)), n: part.length, p: part.length ? won / part.length : null, lo: wl[0], hi: wl[1], fit, fit0 });
      }
      sqrtN = { gamma: ci(B0.gamma, gb && gb.lo[0], gb && gb.hi[0]), a: B0.fit.a, b: B0.fit.b, lrP, n: rows.length, terciles: terc };
    }
  }
  /* 3. tempo control: who set the pace, where the two sides' paces were 2 or more apart (descriptive) */
  let control = null;
  if (P.length) {
    const rows = [];
    P.forEach((q, j) => {
      const o = X.pre[q.i], ph = o.pace[0], pa = o.pace[1], g = X.games[q.i];
      const realised = X.dv[q.i][0].pace3q;
      if (!isNum(ph) || !isNum(pa) || Math.abs(ph - pa) < 2 || !isNum(realised) || X.y[q.i] === 0) return;
      const tc = clamp((realised - pa) / (ph - pa), -1, 2), homeDict = tc > 0.5 ? 1 : 0;
      const pPre = X.fc.live ? X.fc.pF[j] : X.fc.pE[j];
      rows.push({ homeDict, won: X.y[q.i] > 0 ? 1 : 0, pPre: clamp(pPre, 1e-4, 1 - 1e-4) });
      void g;
    });
    if (rows.length >= 30) {
      const dWon = sum(rows.map(r => (r.homeDict ? r.won : 1 - r.won))), wl = W.wilson(dWon, rows.length);
      const lg = W.logistic(rows.map(r => [1, r.homeDict]), rows.map(r => r.won), { offset: rows.map(r => W.logit(r.pPre)) });
      const b = lg.b[1], se = lg.cov ? Math.sqrt(Math.max(0, lg.cov[3])) : NaN;
      control = { n: rows.length, p: dWon / rows.length, lo: wl[0], hi: wl[1],
        or: ci(Math.exp(b), isNum(se) ? Math.exp(b - 1.959963984540054 * se) : null, isNum(se) ? Math.exp(b + 1.959963984540054 * se) : null) };
    }
  }
  /* 4. points per first chance by shot-clock window (≤ 8 s, 8-16 s, > 16 s), ratio of sums, block bootstrap */
  let windows = null;
  const TB = F.QBITS.TIMED, per = new Map();
  X.games.forEach((g, i) => [0, 1].forEach(sd => {
    if (!(g.q[sd] & TB)) return;
    const f = g.F[sd], v = ['fc_e_pts', 'fc_e_n', 'fc_m_pts', 'fc_m_n', 'fc_l_pts', 'fc_l_n'].map(k => f[I[k]]);
    if (!v.every(isNum)) return;
    const b = X.blocks[i];
    if (!per.has(b)) per.set(b, [0, 0, 0, 0, 0, 0]);
    const a = per.get(b);
    v.forEach((x, j) => { a[j] += x; });
  }));
  if (per.size) {
    const list = Array.from(per.keys()).sort((a, b) => a - b).map(b => per.get(b));
    const ratio = arr => { const t = [0, 0, 0, 0, 0, 0]; arr.forEach(a => a.forEach((x, j) => { t[j] += x; })); return [t[1] ? t[0] / t[1] : NaN, t[3] ? t[2] / t[3] : NaN, t[5] ? t[4] / t[5] : NaN]; };
    const est = ratio(list);
    const wb = boot(X, 'windows', () => {
      const r = W.rng(seedOf(X, 'windows')), d = [];
      for (let k = 0; k < X.B; k++) { const pick = []; for (let j = 0; j < list.length; j++) pick.push(list[Math.floor(r() * list.length)]); d.push(ratio(pick)); }
      return { lo: [0, 1, 2].map(j => pctl(d, j)[0]), hi: [0, 1, 2].map(j => pctl(d, j)[1]) };
    });
    const c = j => ci(est[j], wb && wb.lo[j], wb && wb.hi[j]);
    windows = { e: c(0), m: c(1), l: c(2) };
  }
  return { teams: teams.map(t => ({ id: t.id, name: t.name, pace3q: t.pace3q, z: t.z, winPct: t.winPct, net: t.net, gp: t.gp })), bins, curve, curveAdj, sqrtN, control, windows };
}

/* ================================================================== POSITIONS, LINEUPS, SQUADS (§7.12-§7.15, A.1) === */
/* the unit's players: season rows, position values, A.1 slot minutes per club, G/F/C shares, roles */
function people(X) {
  const rows = playerRows(X);
  const byKey = new Map(rows.map(p => [p.key, p]));
  rows.forEach(p => { p.v = positionOf({ position: p.position, height: p.height }, { bpm_pos: p.bpm_pos, min: p.min }); });
  /* A.1: every stint of a club ranked by its players' season estimates */
  const W = X.W, slots = new Map();
  const byTeam = new Map();
  W.stints.forEach(st => {
    const g = X.games[st.g];
    if (!g) return;
    const tid = st.side ? g.a : g.h;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid).push({ ids: st.p.map(i => (i >= 0 ? W.players[i] : null)), s: st.dur });
  });
  Array.from(byTeam.keys()).sort(byId).forEach(tid => {
    const est = new Map();
    rows.forEach(p => { if (p.team === tid) est.set(p.id, { pos: isNum(p.pos) ? p.pos : null, raw: isNum(p.posRaw) ? p.posRaw : null, min: p.min, listed: p.position, height: p.height }); });
    slots.set(tid, slotMinutes(byTeam.get(tid), est));
  });
  const slotOf = p => { const s = slots.get(p.team); const m = s && s.min.get(p.id); return m && sum(m) > 0 ? m : null; };
  const gm = groupsFor(rows.map(p => ({ id: p.key, v: p.v, min: p.min, slots: slotOf(p) })));
  const shares = new Map();
  rows.forEach(p => {
    const s = slotOf(p);
    if (s) { const t = sum(s); shares.set(p.key, [(s[0] + s[1]) / t, (s[2] + s[3]) / t, s[4] / t]); }
    else { const g = gm.get(p.key) || 'F'; shares.set(p.key, GROUPS3.map(x => (x === g ? 1 : 0))); }
    p.group = gm.get(p.key) || 'F';
    p.slots = s;
  });
  /* height z within the unit (players who played) */
  const hs = rows.filter(p => p.min > 0 && isNum(+p.height) && +p.height > 0).map(p => +p.height);
  const hm = meanOf(hs), hsd = sdOf(hs);
  rows.forEach(p => { p.hz = isNum(+p.height) && +p.height > 0 && hsd > 0 ? (+p.height - hm) / hsd : null; });
  /* the roles, each league-season's players against their own league-season (the pooled unit holds many: one call a
     league, its own cuts) */
  const roleIn = list => roles(list.map(p => ({ id: p.key, min: p.min, fga: p.fga, fg3a: p.fg3a, fg3m: p.fg3m, ast_pct: p.ast_pct, blk_pct: p.blk_pct, usg: p.usg, hz: p.hz, group: p.group,
    ups: p.ups, au: p.au, rimr: p.rimr, ftr: p.ftr, orb_pct: p.orb_pct, drb_pct: p.drb_pct, stl_pct: p.stl_pct })), { p3: X.rates && X.rates.p3, zones: X.quality.zones >= 0.5 });
  if (X.leagueOfTeam) {
    const by = new Map();
    rows.forEach(p => { const l = X.leagueOfTeam.get(p.team) || ''; if (!by.has(l)) by.set(l, []); by.get(l).push(p); });
    Array.from(by.keys()).sort(byId).forEach(l => { const rl = roleIn(by.get(l)); by.get(l).forEach(p => { p.roles = rl.get(p.key) || []; }); });
    X.roleCuts = null;
  } else {
    const rl = roleIn(rows);
    rows.forEach(p => { p.roles = rl.get(p.key) || []; });
    X.roleCuts = rl.cuts;
  }
  const played = rows.filter(p => p.min > 0);
  const coverage = { listed: played.length ? played.filter(p => p.listed).length / played.length : 0,
    height: played.length ? played.filter(p => isNum(+p.height) && +p.height > 0).length / played.length : 0,
    bpmOnly: played.length ? played.filter(p => !p.listed && !(isNum(+p.height) && +p.height > 0)).length / played.length : 0 };
  X.people = { rows, byKey, slots, shares, coverage, withheld: new Set(((X.input.withheld && Array.from(X.input.withheld)) || X.ctx.withheld || []).map(String)) };
  return X.people;
}

/* per game and side: each group's sums of the player lines, weighted by the players' G/F/C shares */
function groupLines(X) {
  const W = X.W, P = X.people, out = X.games.map(() => [null, null]);
  W.pgs.forEach(r => {
    const g = X.games[r.g];
    if (!g || !(r.min > 0)) return;
    const tid = r.side ? g.a : g.h, sh = P.shares.get(tid + '|' + W.players[r.p]);
    if (!sh) return;
    if (!out[r.g][r.side]) out[r.g][r.side] = GROUPS3.map(() => ({ pts: 0, fga: 0, fta: 0, tov: 0, ast: 0, reb: 0, stl: 0, blk: 0, fg3a: 0, min: 0, bpmMin: 0, bpmW: 0 }));
    const G = out[r.g][r.side];
    sh.forEach((s, k) => {
      if (!(s > 0)) return;
      const a = G[k];
      a.pts += s * r.pts; a.fga += s * r.fga; a.fta += s * r.fta; a.tov += s * r.to; a.ast += s * r.ast; a.reb += s * (r.or + r.dr);
      a.stl += s * r.stl; a.blk += s * r.blk; a.fg3a += s * r.fg3a; a.min += s * r.min;
    });
  });
  return out;
}
function groupStats(a, team) {
  const r = (x, y, k) => (y > 0 ? (k || 1) * x / y : NaN);
  return { ts: r(a.pts, 2 * (a.fga + 0.44 * a.fta), 100), usg_share: r(a.fga + 0.44 * a.fta + a.tov, team.fga + 0.44 * team.fta + team.tov),
    ast_share: r(a.ast, team.ast), reb_share: r(a.reb, team.reb), stocks40: r(40 * (a.stl + a.blk), a.min), tov_share: r(a.tov, team.tov), p3a_rate: r(a.fg3a, a.fga, 100) };
}
function teamLine(X, f) {
  const I = X.I, v = k => (isNum(f[I[k]]) ? f[I[k]] : 0);
  return { fga: v('fga'), fta: v('fta'), tov: v('tov'), ast: v('ast'), reb: v('oreb') + v('dreb') };
}
/* a hand-built difference model: rows [h, x...] against y, its blocks, CV lambda, fit and bootstrap */
function handModel(X, key, D, o) {
  const W = WS();
  o = o || {};
  if (D.rows.length < (o.min || MIN.own)) return null;
  const blocks = o.blocks || blockSuffs(D), S = W.sumSuff(blocks), pen = penOf(S, o.nh != null ? o.nh : 1);
  const lambda = o.lambda != null ? o.lambda : blocks.length >= 3 ? W.cvLambda(blocks, { pen }).lambda : 1e-2;
  const fit = W.ridge(S, { lambda, pen });
  if (!fit) return null;
  const tr = o.transform || (b => b);
  const fitFn = T => { const r = W.ridge(T, { lambda, pen }); return r ? tr(r.b) : null; };
  const bs = boot(X, key, () => { const r = W.blockBootstrap(blocks, fitFn, { B: o.B || X.B, seed: seedOf(X, key) }); return { lo: r.lo, hi: r.hi, se: r.se }; }, o.cols);
  return { fit, b: tr(fit.b), bs, S, blocks, lambda, pen };
}

/* §7.12 P1 positional accounting, P2 what winners get, P2f the slot forecast */
function positions(X) {
  const W = WS(), P = X.people;
  const GL = groupLines(X);
  X.GL = GL;
  /* P1: per team-game and group the seven stats; home minus away (21 columns + h) on the margin */
  const cellKeys = [];
  GROUPS3.forEach(g => P1_STATS.forEach(s => cellKeys.push([g, s])));
  const per = X.games.map((g, i) => [0, 1].map(s => {
    const G = GL[i][s];
    if (!G) return null;
    const team = teamLine(X, g.F[s]);
    return G.map(a => groupStats(a, team));
  }));
  const cellMean = cellKeys.map(([g, s]) => meanOf(per.flatMap(p => p.map(x => (x ? x[GROUPS3.indexOf(g)][s] : NaN)))));
  const D = { rows: [], y: [], gi: [], blk: [] };
  X.games.forEach((g, i) => {
    const a = per[i][0], b = per[i][1];
    if (!a || !b || !isNum(X.y[i])) return;
    const r = [X.h[i]];
    cellKeys.forEach(([gg, s], c) => {
      const k = GROUPS3.indexOf(gg), va = isNum(a[k][s]) ? a[k][s] : cellMean[c], vb = isNum(b[k][s]) ? b[k][s] : cellMean[c];
      r.push(va - vb);
    });
    if (!r.every(isNum)) return;
    D.rows.push(r); D.y.push(X.y[i]); D.gi.push(i); D.blk.push(X.blocks[i]);
  });
  let p1 = [];
  /* each cell's spread over club seasons (ratio of sums) */
  const seasonCells = new Map();
  X.teamIds.forEach(tid => {
    const T = X.teams.get(tid);
    if (!T || T.gl.length < MIN.team) return;
    const acc = GROUPS3.map(() => ({ pts: 0, fga: 0, fta: 0, tov: 0, ast: 0, reb: 0, stl: 0, blk: 0, fg3a: 0, min: 0 })), team = { fga: 0, fta: 0, tov: 0, ast: 0, reb: 0 };
    T.gl.forEach(([i, s]) => {
      const G = GL[i][s];
      if (!G) return;
      G.forEach((a, k) => Object.keys(acc[k]).forEach(f => { acc[k][f] += a[f]; }));
      const tl = teamLine(X, X.games[i].F[s]);
      Object.keys(team).forEach(f => { team[f] += tl[f]; });
    });
    seasonCells.set(tid, { acc, team, stats: acc.map(a => groupStats(a, team)) });
  });
  X.seasonCells = seasonCells;
  /* the share stats (usage, assists, boards, turnovers) add up to the team's whole across G, F and C, so their three
     differences sum to zero and only contrasts are identified: each is reported as b_g minus the mean of the three
     ("this group's share against an even spread"), in the fit and in every bootstrap draw alike */
  const shareIdx = SHARE_STATS.map(st => GROUPS3.map(g => 1 + cellKeys.findIndex(([gg, ss]) => gg === g && ss === st)));
  const contrast = b => { const o = Array.from(b); shareIdx.forEach(ix => { const m = (o[ix[0]] + o[ix[1]] + o[ix[2]]) / 3; ix.forEach(i => { o[i] -= m; }); }); return o; };
  const hm = handModel(X, 'p1', D, { transform: contrast, cols: ['h'].concat(cellKeys.map(([g, st]) => g + ':' + st)) });
  if (hm) {
    const sdCell = cellKeys.map(([g, s]) => sdOf(Array.from(seasonCells.values()).map(c => c.stats[GROUPS3.indexOf(g)][s])));
    const ps = cellKeys.map((_, c) => {
      const se = hm.bs && isNum(hm.bs.se[c + 1]) ? hm.bs.se[c + 1] : null;
      return se > 0 ? 2 * W.normCdf(-Math.abs(hm.b[c + 1] / se)) : null;
    });
    const q = W.bh(ps);
    p1 = cellKeys.map(([g, s], c) => {
      const sd = isNum(sdCell[c]) ? sdCell[c] : 0, b = hm.b[c + 1] * sd;
      const lo = hm.bs ? hm.bs.lo[c + 1] * sd : null, hi = hm.bs ? hm.bs.hi[c + 1] * sd : null;
      return { g, stat: s, b, lo: nn(lo), hi: nn(hi), star: isNum(lo) && isNum(hi) && (lo > 0 || hi < 0) && q[c] != null && q[c] < 0.05 };
    });
  }
  /* P2: the clubs' group lines; the top quarter by net, the league, the bottom quarter. Their BPM is the box BPM before
     the team adjustment (p.bpmRaw): with it, the top quarter by net would lead on BPM by construction */
  const net = tid => { const t = X.tempoTeams && X.tempoTeams.get(tid); return t ? t.net : null; };
  const teamG = [];
  seasonCells.forEach((c, tid) => {
    const T = X.teams.get(tid), mins = sum(c.acc.map(a => a.min));
    const bpm = GROUPS3.map((g, k) => {
      let s = 0, w = 0;
      P.rows.forEach(p => { if (p.team === tid && isNum(p.bpmRaw) && p.min > 0) { const sh = P.shares.get(p.key)[k] * p.min; s += sh * p.bpmRaw; w += sh; } });
      return w > 0 ? s / w : NaN;
    });
    teamG.push({ id: tid, net: net(tid), gp: T.gl.length, g: GROUPS3.map((g, k) => Object.assign({ bpm: bpm[k], min_share: mins > 0 ? c.acc[k].min / mins : NaN }, c.stats[k])) });
  });
  /* a stat constant across clubs in every group (min_share under slot minutes) says nothing about winners: left out */
  const P2_STATS = ['bpm'].concat(P1_STATS, ['min_share']).filter(st => GROUPS3.some((g, k) => sdReal(teamG.map(t => t.g[k][st])) > 0));
  X.p2Stats = P2_STATS;
  const ranked = teamG.filter(t => isNum(t.net)).sort((a, b) => (b.net - a.net) || byId(a.id, b.id));
  const nq = Math.max(1, Math.ceil(ranked.length / 4));
  const pz = X.priors && X.priors.p2z;
  const p2 = [];
  if (ranked.length >= 2) {
    const rb = boot(X, 'p2', () => {
      const r = W.rng(seedOf(X, 'p2')), draws = [];
      for (let d = 0; d < 1000; d++) {
        const pick = [];
        for (let j = 0; j < ranked.length; j++) pick.push(ranked[Math.floor(r() * ranked.length)]);
        pick.sort((a, b) => b.net - a.net);
        const top = pick.slice(0, nq), row = [];
        GROUPS3.forEach((g, k) => P2_STATS.forEach(s => row.push(median(top.map(t => t.g[k][s])))));
        draws.push(row);
      }
      const n = GROUPS3.length * P2_STATS.length;
      return { lo: Array.from({ length: n }, (_, j) => pctl(draws, j)[0]), hi: Array.from({ length: n }, (_, j) => pctl(draws, j)[1]) };
    }, GROUPS3.flatMap(g => P2_STATS.map(st => g + ':' + st)));
    let j = 0;
    GROUPS3.forEach((g, k) => P2_STATS.forEach(s => {
      const vals = ranked.map(t => t.g[k][s]);
      let top = median(ranked.slice(0, nq).map(t => t.g[k][s])), topLo = rb ? rb.lo[j] : null, topHi = rb ? rb.hi[j] : null;
      if (ranked.length < 8 && pz && pz[g] && isNum(pz[g][s])) {
        const m = meanOf(vals), sd = sdReal(vals);
        if (isNum(m) && sd > 0) { top = m + pz[g][s] * sd; topLo = null; topHi = null; }
      }
      p2.push({ g, stat: s, top: nn(top), topLo: nn(topLo), topHi: nn(topHi), mid: nn(median(vals)), bottom: nn(median(ranked.slice(-nq).map(t => t.g[k][s]))) });
      j++;
    }));
  }
  X.teamG = new Map(teamG.map(t => [t.id, t]));
  /* P2f: at each ISO week start, season-to-date minutes-weighted box BPM (before the team adjustment, on the slot
     targets' scale) by group; y on h and the three differences */
  let p2f = null;
  if (X.n >= MIN.p2f) {
    const weeks = Array.from(new Set(X.games.map(g => isoWeek(g.t)))).sort();
    const startOf = new Map();
    X.games.forEach(g => { const w = isoWeek(g.t); if (!startOf.has(w) || g.t < startOf.get(w)) startOf.set(w, g.t); });
    const D2 = { rows: [], y: [], gi: [], blk: [] };
    weeks.forEach((wk, wi) => {
      if (wi === 0) return;
      const t0 = startOf.get(wk), pr = playerRows(X, t0);
      const gb = new Map();
      pr.forEach(p => {
        const sh = P.shares.get(p.key);
        if (!sh || !isNum(p.bpmRaw) || !(p.min > 0)) return;
        if (!gb.has(p.team)) gb.set(p.team, [[0, 0], [0, 0], [0, 0]]);
        const a = gb.get(p.team);
        sh.forEach((s, k) => { a[k][0] += s * p.min * p.bpmRaw; a[k][1] += s * p.min; });
      });
      X.games.forEach((g, i) => {
        if (isoWeek(g.t) !== wk || !isNum(X.y[i])) return;
        const A = gb.get(g.h), B = gb.get(g.a);
        if (!A || !B) return;
        const r = [X.h[i]];
        for (let k = 0; k < 3; k++) r.push((A[k][1] > 0 ? A[k][0] / A[k][1] : 0) - (B[k][1] > 0 ? B[k][0] / B[k][1] : 0));
        D2.rows.push(r); D2.y.push(X.y[i]); D2.gi.push(i); D2.blk.push(X.blocks[i]);
      });
    });
    const m2 = handModel(X, 'p2f', D2);
    if (m2) p2f = GROUPS3.map((g, k) => ({ g, b: m2.fit.b[k + 1], lo: m2.bs ? nn(m2.bs.lo[k + 1]) : null, hi: m2.bs ? nn(m2.bs.hi[k + 1]) : null }));
  }
  return { coverage: P.coverage, p1, p2, p2f };
}

/* §7.13 P3: lineup stints, net per 100 against the five's make-up, demeaned within team-game */
const LU_COLS = ['shooters', 'bigs0', 'bigs2', 'hand0', 'hand2', 'prot', 'hz', 'bpm', 'shooters_x_prot', 'hand_x_shooters'];
function compOf(X, tid, ids) {
  const P = X.people;
  let sh = 0, bg = 0, hd = 0, pr = 0, hz = 0, bp = 0;
  const gm = X.groupMeans;
  ids.forEach(id => {
    const p = P.byKey.get(tid + '|' + id);
    const roles_ = p ? p.roles : [];
    if (roles_.includes('shooter')) sh++;
    if (p && p.group === 'C') bg++;
    if (roles_.includes('handler')) hd++;
    if (roles_.includes('protector')) pr++;
    const g = p ? p.group : 'F';
    hz += p && isNum(p.hz) ? p.hz : (gm && isNum(gm.hz[g]) ? gm.hz[g] : 0);
    bp += p && isNum(p.bpm) ? p.bpm : (gm && isNum(gm.bpm[g]) ? gm.bpm[g] : 0);
  });
  return { sh, bg, hd, pr, hz: hz / 5, bpm: bp / 5 };
}
const luRow = c => [c.sh, c.bg === 0 ? 1 : 0, c.bg >= 2 ? 1 : 0, c.hd === 0 ? 1 : 0, c.hd >= 2 ? 1 : 0, c.pr >= 1 ? 1 : 0, c.hz, c.bpm, c.sh * (c.pr >= 1 ? 1 : 0), c.hd * c.sh];
const bigClass = n => (n === 0 ? '0' : n === 1 ? '1' : '2+');
function lineups(X) {
  const W = WS(), P = X.people, St = X.W.stints;
  const gm = { hz: {}, bpm: {} };
  GROUPS3.forEach(g => { const r = P.rows.filter(p => p.group === g && p.min > 0); gm.hz[g] = meanOf(r.map(p => p.hz)); gm.bpm[g] = meanOf(r.map(p => p.bpm)); });
  X.groupMeans = gm;
  X.bpmMean = meanOf(P.rows.filter(p => p.min > 0).map(p => p.bpm));
  const raw = [];
  St.forEach(st => {
    const g = X.games[st.g];
    if (!g || !(st.poss >= 1) || !isNum(st.pf) || !isNum(st.pa) || st.p.some(i => i < 0)) return;
    const tid = st.side ? g.a : g.h, ids = st.p.map(i => X.W.players[i]);
    const c = compOf(X, tid, ids);
    raw.push({ key: st.g * 2 + st.side, g: st.g, tid, ids, c, x: luRow(c), y: 100 * (st.pf - st.pa) / st.poss, w: st.poss, net: st.pf - st.pa, poss: st.poss });
  });
  X.luRaw = raw;
  if (raw.length < 40) return null;
  /* within team-game demeaning (possession-weighted) */
  const grp = new Map();
  raw.forEach(r => { if (!grp.has(r.key)) grp.set(r.key, []); grp.get(r.key).push(r); });
  const byGame = new Map();
  grp.forEach(list => {
    const sw = sum(list.map(r => r.w)), mx = LU_COLS.map((_, j) => sum(list.map(r => r.w * r.x[j])) / sw), my = sum(list.map(r => r.w * r.y)) / sw;
    list.forEach(r => {
      const xr = r.x.map((v, j) => v - mx[j]), yr = r.y - my;
      if (!byGame.has(r.g)) byGame.set(r.g, { r: [], y: [], w: [] });
      const b = byGame.get(r.g);
      b.r.push(xr); b.y.push(yr); b.w.push(r.w);
    });
  });
  const blocks = Array.from(byGame.keys()).sort((a, b) => a - b).map(k => { const b = byGame.get(k); return W.suff(b.r, b.y, b.w); });
  const S = W.sumSuff(blocks), pen = Array.from({ length: S.p }, (_, k) => Math.pow(rms(S, k) || 1, 2));
  const lambda = blocks.length >= 5 ? W.cvLambda(blocks, { pen }).lambda : 1e-2;
  const fit = W.ridge(S, { lambda, pen });
  if (!fit) return null;
  const ref = luRow({ sh: 2, bg: 1, hd: 1, pr: 1, hz: 0, bpm: 0 });
  const cells = [];
  for (let s = 0; s <= 5; s++) for (const b of ['0', '1', '2+']) { const nb = b === '2+' ? 2 : +b; if (s + nb <= 5) cells.push([s, b, nb]); }
  const vec = bb => cells.map(([s, , nb]) => { const x = luRow({ sh: s, bg: nb, hd: 1, pr: 1, hz: 0, bpm: 0 }); return x.reduce((a, v, j) => a + bb[j] * (v - ref[j]), 0); });
  const est = vec(fit.b);
  const draws = boot(X, 'lineup', () => {
    const r = W.blockBootstrap(blocks, T => { const q = W.ridge(T, { lambda, pen }); return q ? q.b.concat(vec(q.b)) : null; }, { B: Math.min(200, X.B), seed: seedOf(X, 'lineup') });
    return { lo: r.lo, hi: r.hi };
  });
  const p = LU_COLS.length;
  const grid = cells.map(([s, b], j) => ({ s, b, net: est[j], lo: draws ? nn(draws.lo[p + j]) : null, hi: draws ? nn(draws.hi[p + j]) : null,
    poss: sum(raw.filter(r => Math.min(5, r.c.sh) === s && bigClass(r.c.bg) === b).map(r => r.poss)) }));
  /* BALL HANDLERS ON THE FLOOR (Louie, 2026-10-07), beside the bigs: the same fit's expectation for 0, 1 and 2+ handlers
     with each number of shooters (one big, one protector), against the reference five, and the possessions played so */
  const hcells = [];
  for (let s = 0; s <= 5; s++) for (const h of ['0', '1', '2+']) { const nh = h === '2+' ? 2 : +h; if (s + nh <= 5) hcells.push([s, h, nh]); }
  const hvec = bb => hcells.map(([s, , nh]) => { const x = luRow({ sh: s, bg: 1, hd: nh, pr: 1, hz: 0, bpm: 0 }); return x.reduce((a, v, j) => a + bb[j] * (v - ref[j]), 0); });
  const hest = hvec(fit.b);
  const hdraws = boot(X, 'lineup:handlers', () => {
    const r = W.blockBootstrap(blocks, T => { const q = W.ridge(T, { lambda, pen }); return q ? hvec(q.b) : null; }, { B: Math.min(200, X.B), seed: seedOf(X, 'lineup:handlers') });
    return { lo: r.lo, hi: r.hi };
  });
  const gridH = hcells.map(([s, h], j) => ({ s, h, net: hest[j], lo: hdraws ? nn(hdraws.lo[j]) : null, hi: hdraws ? nn(hdraws.hi[j]) : null,
    poss: sum(raw.filter(r => Math.min(5, r.c.sh) === s && bigClass(r.c.hd) === h).map(r => r.poss)) }));
  const terms = LU_COLS.map((k, j) => ({ k, b: fit.b[j], lo: draws ? nn(draws.lo[j]) : null, hi: draws ? nn(draws.hi[j]) : null }));
  X.lu = { b: fit.b, ref };
  return { grid, gridH, terms, n: raw.length, poss: sum(raw.map(r => r.poss)) };
}

/* §7.14 squad construction: each club season's features */
function squadFeatures(X) {
  const P = X.people, I = X.I, out = new Map();
  const prev = (X.input.prevPlayers || X.ctx.prev) || null;
  X.teamIds.forEach(tid => {
    const T = X.teams.get(tid), rs = P.rows.filter(p => p.team === tid && p.min > 0);
    if (!T || !rs.length) return;
    const games = T.gl.length, mins = sum(rs.map(p => p.min)), byMin = rs.slice().sort((a, b) => (b.min - a.min) || byId(a.id, b.id));
    const rot = rs.filter(p => p.gp > 0 && p.min / p.gp >= 10);
    const u = rs.map(p => p.fga + 0.44 * p.fta + p.to), U = sum(u);
    const gmin = GROUPS3.map((_, k) => sum(rs.map(p => P.shares.get(p.key)[k] * p.min)) / (mins || 1));
    const ent = -sum(gmin.map(m => (m > 0 ? m * Math.log(m) : 0))) / Math.log(3);
    const hCov = sum(rs.filter(p => isNum(p.hz)).map(p => p.min)) / (mins || 1);
    const aCov = sum(rs.filter(p => isNum(p.age)).map(p => p.min)) / (mins || 1);
    const wmean = (f, ok) => { const a = rs.filter(ok); const w = sum(a.map(p => p.min)); return w > 0 ? sum(a.map(p => p.min * f(p))) / w : null; };
    const pts = rs.map(p => p.pts), tp = sum(pts);
    const ssm = T.gl.map(([i, s]) => X.games[i].F[s][I.starters_min_share]).filter(isNum);
    const fives = new Map();
    T.gl.forEach(([i, s]) => { const h = s ? X.games[i].s1 : X.games[i].s0; if (h) fives.set(h, (fives.get(h) || 0) + 1); });
    const modal = fives.size ? Math.max(...fives.values()) : 0, withStart = sum(Array.from(fives.values()));
    const top8 = byMin.slice(0, 8);
    const prevSet = prev && prev[tid] ? new Set(prev[tid]) : null;
    out.set(tid, {
      rot_n: rot.length,
      top5_share: mins ? sum(byMin.slice(0, 5).map(p => p.min)) / mins : null,
      star_pts_share: tp > 0 ? Math.max(...pts) / tp : null,
      usg_hhi: U > 0 ? 100 * sum(u.map(x => (x / U) * (x / U))) : null,
      pos_entropy: ent,
      shooters: rot.filter(p => p.roles.includes('shooter')).length,
      handlers: rot.filter(p => p.roles.includes('handler')).length,
      protectors: rot.filter(p => p.roles.includes('protector')).length,
      passers: rot.filter(p => p.roles.includes('passer')).length,
      slashers: rot.filter(p => p.roles.includes('slasher')).length,
      crashers: rot.filter(p => p.roles.includes('crasher')).length,
      glass: rot.filter(p => p.roles.includes('glass')).length,
      disruptors: rot.filter(p => p.roles.includes('disruptor')).length,
      /* each role's share of the club's minutes (A.3: the squad's role analysis reads it) */
      _roleMin: Object.fromEntries(Object.keys(ROLE_SQUAD).map(r => [r, mins ? sum(rs.filter(p => p.roles.includes(r)).map(p => p.min)) / mins : null])),
      height_w: hCov > 0.5 ? wmean(p => p.hz, p => isNum(p.hz)) : null,
      age_w: aCov > 0.5 ? wmean(p => p.age, p => isNum(p.age)) : null,
      bench_share: ssm.length ? 1 - meanOf(ssm) : (mins ? 1 - sum(byMin.slice(0, 5).map(p => p.min)) / mins : null),
      depth_bpm: nn(meanOf(byMin.filter(p => p.gp > 0 && p.min / p.gp >= 10).slice(5, 9).map(p => p.bpmRaw))),
      talent: wmean(p => p.bpmRaw, p => isNum(p.bpmRaw)),
      continuity: prevSet ? sum(rs.filter(p => prevSet.has(p.id)).map(p => p.min)) / (mins || 1) : null,
      starter_stability: withStart ? modal / withStart : null,
      availability: top8.length ? 1 - sum(top8.map(p => Math.max(0, games - p.gp))) / (top8.length * games || 1) : null,
      _cov: { height: hCov, age: aCov }, _games: games
    });
  });
  return out;
}
/* the club seasons' rows for a squad fit: unit z of each feature, the outcome centred within the unit */
function squadRows(X, feats) {
  const ok = X.teamIds.filter(tid => feats.has(tid) && feats.get(tid)._games >= MIN.team);
  /* unit centring: z and the outcome's mean within each league-season (the pooled unit holds several) */
  const unitOf = t => (X.leagueOfTeam ? X.leagueOfTeam.get(t) || '' : X.unitKey || '');
  const tt = X.tempoTeams;
  const yRaw = new Map(ok.map(t => { const r = tt.get(t), n = r ? r.gp : 0; return [t, r && isNum(r.net) ? r.net * n / (n + 10) : NaN]; }));
  const units = new Map();
  ok.forEach(t => { const u = unitOf(t); if (!units.has(u)) units.set(u, []); units.get(u).push(t); });
  const zOf = new Map(), yOf = new Map();
  units.forEach(ts => {
    const st = SQUAD_KEYS.map(k => { const v = ts.map(t => feats.get(t)[k]); return [meanOf(v), sdReal(v)]; });
    const yc = meanOf(ts.map(t => yRaw.get(t)));
    ts.forEach(t => {
      zOf.set(t, SQUAD_KEYS.map((k, j) => { const x = feats.get(t)[k], [m, s] = st[j]; return isNum(x) && s > 0 ? (x - m) / s : 0; }));
      yOf.set(t, yRaw.get(t) - yc);
    });
  });
  return ok.map(t => ({ id: t, unit: unitOf(t), x: zOf.get(t), y: yOf.get(t) })).filter(r => isNum(r.y));
}
/* the squad model over club-season rows (one league, or every league pooled with unit centring) */
function squadFit(X, rows, key) {
  const W = WS();
  if (rows.length < 6) return null;
  const pace = (X.mu && X.mu.pace3q) || 72;
  const fitSet = (cols, bkey) => {
    const blocks = rows.map(r => W.suff([cols.map(c => r.x[c])], [r.y]));
    const S = W.sumSuff(blocks), pen = cols.map(() => 1);
    const lambda = blocks.length >= 10 ? W.cvLambda(blocks, { pen, lo: 1e-3, hi: 10 }).lambda : 1;
    const fit = W.ridge(S, { lambda, pen });
    if (!fit) return null;
    const bs = boot(X, bkey, () => { const r = W.blockBootstrap(blocks, T => { const q = W.ridge(T, { lambda, pen }); return q ? q.b : null; }, { B: 1000, seed: seedOf(X, bkey) }); return { lo: r.lo, hi: r.hi, se: r.se }; }, cols.map(c => SQUAD_KEYS[c]));
    return { fit, bs, cols, lambda, blocks };
  };
  const tal = SQUAD_KEYS.indexOf('talent');
  /* a feature constant across the club seasons (z 0 everywhere: pos_entropy under slot minutes) is not fitted */
  const varies = j => rows.some(r => r.x[j] !== 0);
  const rawCols = SQUAD_KEYS.map((_, j) => j).filter(j => j !== tal && varies(j)), adjCols = SQUAD_KEYS.map((_, j) => j).filter(varies);
  const A = fitSet(rawCols, key + ':raw'), B = fitSet(adjCols, key + ':adj');
  if (!A) return null;
  const sigma = X.fc ? X.fc.sigma : 12;
  const ev = (m, j) => {
    const b = m.fit.b[j], se = m.bs && isNum(m.bs.se[j]) ? m.bs.se[j] : null;
    return { b, lo: m.bs ? nn(m.bs.lo[j]) : null, hi: m.bs ? nn(m.bs.hi[j]) : null, se, p: se > 0 ? 2 * W.normCdf(-Math.abs(b / se)) : null };
  };
  const listOf = m => {
    const e = m.cols.map((_, j) => ev(m, j)), q = W.bh(e.map(x => x.p));
    return m.cols.map((c, j) => {
      const x = e[j], h90 = x.se ? 1.6448536269514722 * x.se : null;
      const strong = isNum(x.lo) && isNum(x.hi) && (x.lo > 0 || x.hi < 0) && q[j] != null && q[j] < 0.05;
      const some = h90 != null && Math.abs(x.b) > h90;
      const ptsG = x.b * pace / 100;
      return { k: SQUAD_KEYS[c], b: x.b, lo: x.lo, hi: x.hi, wins30: 30 * (W.normCdf(ptsG / sigma) - 0.5), evidence: strong ? 'strong' : some ? 'some' : 'none', _h: isNum(x.lo) && isNum(x.hi) ? (x.hi - x.lo) / 2 : Infinity };
    });
  };
  const coef = listOf(A), adj = B ? listOf(B).filter(c => c.k !== 'talent') : [];
  const power = rows.length < MIN.squad || coef.every(c => c._h > Math.abs(c.b)) ? 'low' : 'ok';
  coef.forEach(c => delete c._h); adj.forEach(c => { delete c._h; delete c.wins30; });
  /* partial dependence on usage concentration and position spread: a natural spline in each, the rest linear */
  const pd = {};
  ['usg_hhi', 'pos_entropy'].forEach(k => {
    const j = SQUAD_KEYS.indexOf(k), xs = rows.map(r => r.x[j]).sort((a, b) => a - b);
    if (xs.length < 10 || !(xs[xs.length - 1] > xs[0])) return;
    const knots = [0.1, 0.5, 0.9].map(q => W.quantile(xs, q));
    if (!(knots[2] > knots[0])) return;
    const others = rawCols.filter(c => c !== j);
    const rowX = r => W.nsBasis(r.x[j], knots).concat(others.map(c => r.x[c]));
    const blocks = rows.map(r => W.suff([rowX(r)], [r.y]));
    const S = W.sumSuff(blocks), pen = S.xy.map(() => 1);
    const lam = 1;
    const fit = W.ridge(S, { lambda: lam, pen });
    if (!fit) return;
    const grid = [];
    for (let g = 0; g < 9; g++) grid.push(W.quantile(xs, 0.05 + 0.9 * g / 8));
    const curve = b => grid.map(x => W.nsBasis(x, knots).reduce((a, v, i) => a + v * b[i], 0));
    const est = curve(fit.b);
    const bs = boot(X, key + ':pd:' + k, () => { const r = W.blockBootstrap(blocks, T => { const q = W.ridge(T, { lambda: lam, pen }); return q ? curve(q.b) : null; }, { B: 200, seed: seedOf(X, key + ':pd:' + k) }); return { lo: r.lo, hi: r.hi }; });
    pd[k] = grid.map((x, i) => [x, est[i], bs ? bs.lo[i] : null, bs ? bs.hi[i] : null]);
  });
  return { n: rows.length, power, coef, adj, pd };
}
function squad(X, feats) {
  const pooled = X.priors && X.priors.squad;
  const own = pooled ? null : squadFit(X, squadRows(X, feats), 'squad');
  const base = pooled || own;
  if (!base) return null;
  /* the winners' band: P25-P75 of this unit's top-quarter clubs */
  const tt = X.tempoTeams;
  const ok = X.teamIds.filter(t => feats.has(t) && feats.get(t)._games >= MIN.team && tt.get(t) && isNum(tt.get(t).net))
    .sort((a, b) => (tt.get(b).net - tt.get(a).net) || byId(a, b));
  const top = ok.slice(0, Math.max(1, Math.ceil(ok.length / 4)));
  const bands = {};
  SQUAD_KEYS.forEach(k => {
    const v = top.map(t => feats.get(t)[k]).filter(isNum);
    if (v.length && sdReal(ok.map(t => feats.get(t)[k])) > 0) bands[k] = { p25: qtl(v, 0.25), p50: qtl(v, 0.5), p75: qtl(v, 0.75) };
  });
  return { n: base.n, power: base.power, coef: base.coef, adj: base.adj, bands, pd: base.pd || {} };
}

/* ================================================================== A.3: ROLES AND WINNING, POSITIONS IN DEPTH === */
/* the club seasons a team-season analysis reads (8 games or more, a net rating), their outcome shrunk by games
   (net × n / (n + 10), as the squad model) and the league-season (unit) each belongs to */
function seasonRows(X, feats) {
  const tt = X.tempoTeams || new Map();
  const unitOf = t => (X.leagueOfTeam ? X.leagueOfTeam.get(t) || '' : X.unitKey || '');
  return X.teamIds.filter(t => (!feats || (feats.has(t) && feats.get(t)._games >= MIN.team)) && tt.get(t) && isNum(tt.get(t).net) && X.teams.get(t).gl.length >= MIN.team)
    .map(t => { const r = tt.get(t), n = r.gp; return { id: t, unit: unitOf(t), net: r.net * n / (n + 10), win: n ? r.w / n : null, gp: n }; });
}
/* x and y centred within their unit, then pooled: the within-league association (the pooled file holds many leagues) */
function centred(rows, xOf, yOf) {
  const by = new Map();
  rows.forEach(r => { const x = xOf(r), y = yOf(r); if (!isNum(x) || !isNum(y)) return; if (!by.has(r.unit)) by.set(r.unit, []); by.get(r.unit).push([x, y]); });
  const xs = [], ys = [];
  let units = 0;
  by.forEach(list => { if (list.length < 3) return; units++; const mx = meanOf(list.map(v => v[0])), my = meanOf(list.map(v => v[1])); list.forEach(v => { xs.push(v[0] - mx); ys.push(v[1] - my); }); });
  return { xs, ys, units };
}
/* r with a Fisher interval (n less the units' means), and the outcome per one SD of x with the same interval */
function corrCI(xs, ys, units) {
  const W = WS(), n = xs.length, nEff = n - Math.max(0, units - 1);
  if (n < 6 || nEff < 5) return null;
  const r = W.pearson(xs, ys);
  if (!isNum(r)) return null;
  const ci = W.fisherCI(r, nEff), sdy = sdOf(ys);
  return { n, r, lo: ci[0], hi: ci[1], p: W.fisherP(r, nEff), sdy, b: r * sdy, blo: ci[0] * sdy, bhi: ci[1] * sdy };
}

/* ROLES AND WINNING (A.3). For each role (ROLE_SQUAD):
   (1) the club seasons: the share of the club's minutes its tagged players played (and how many were in the rotation),
       against net per 100: r with its Fisher interval and the slope, net per 100 for ten points more of the minutes,
       with a club-season bootstrap (B = 1000), centred within each league-season;
   (2) the lineups: net per 100 possessions for each tagged player more on the floor, the five's mean BPM held, within
       team-game (possession weights, demeaned as the lineup model), bootstrap by game (B = 200); and the possessions
       played with 0, 1 and 2 or more of them.
   Evidence: 'strong' when a 95% interval leaves out 0 after the false-discovery check across the roles, 'some' when
   the 90% one does, else 'none'; under 30 club seasons the analysis says it is underpowered. */
function roleAnalysis(X, feats) {
  const W = WS(), P = X.people;
  if (!P || !feats) return null;
  const rows = seasonRows(X, feats);
  const list = [];
  const keys = Object.keys(ROLE_SQUAD);
  /* (1) the club seasons */
  const club = keys.map(role => {
    const C = centred(rows, r => { const v = feats.get(r.id)._roleMin[role]; return isNum(v) ? 100 * v : NaN; }, r => r.net);
    const cc = corrCI(C.xs, C.ys, C.units);
    const sxx = sum(C.xs.map(x => x * x)), slope = sxx > 0 ? 10 * sum(C.xs.map((x, i) => x * C.ys[i])) / sxx : null;
    return { C, cc, slope };
  });
  const cb = boot(X, 'roles:club', () => {
    const r = W.rng(seedOf(X, 'roles:club')), d = [];
    for (let b = 0; b < 1000; b++) {
      d.push(club.map(o => {
        const n = o.C.xs.length;
        if (n < 6) return NaN;
        let sxy = 0, sxx = 0;
        for (let j = 0; j < n; j++) { const k = Math.floor(r() * n); sxy += o.C.xs[k] * o.C.ys[k]; sxx += o.C.xs[k] * o.C.xs[k]; }
        return sxx > 0 ? 10 * sxy / sxx : NaN;
      }));
    }
    return { lo: keys.map((_, j) => pctl(d, j)[0]), hi: keys.map((_, j) => pctl(d, j)[1]), se: keys.map((_, j) => pctl(d, j)[2]) };
  }, keys);
  /* (2) the lineups: each stint's count of tagged players and its five's mean BPM, demeaned within team-game */
  const raw = X.luRaw || [];
  const lu = keys.map(() => null);
  if (raw.length >= 40) {
    const counts = raw.map(r => keys.map(role => r.ids.reduce((a, id) => { const p = P.byKey.get(r.tid + '|' + id); return a + (p && p.roles.includes(role) ? 1 : 0); }, 0)));
    keys.forEach((role, j) => {
      const grp = new Map();
      raw.forEach((r, i) => { if (!grp.has(r.key)) grp.set(r.key, []); grp.get(r.key).push([r, counts[i][j]]); });
      const byGame = new Map();
      grp.forEach(L => {
        const sw = sum(L.map(([r]) => r.w)), mx = sum(L.map(([r, c]) => r.w * c)) / sw, mb = sum(L.map(([r]) => r.w * r.c.bpm)) / sw, my = sum(L.map(([r]) => r.w * r.y)) / sw;
        L.forEach(([r, c]) => { if (!byGame.has(r.g)) byGame.set(r.g, { r: [], y: [], w: [] }); const b = byGame.get(r.g); b.r.push([c - mx, r.c.bpm - mb]); b.y.push(r.y - my); b.w.push(r.w); });
      });
      const blocks = Array.from(byGame.keys()).sort((a, b) => a - b).map(k => { const b = byGame.get(k); return W.suff(b.r, b.y, b.w); });
      const S = W.sumSuff(blocks), pen = [Math.pow(rms(S, 0) || 1, 2), Math.pow(rms(S, 1) || 1, 2)];
      const fit = W.ridge(S, { lambda: 1e-4, pen });
      if (!fit || !(S.xx[0] > 0)) return;
      const bs = boot(X, 'roles:lu:' + role, () => { const q = W.blockBootstrap(blocks, T => { const f = W.ridge(T, { lambda: 1e-4, pen }); return f ? [f.b[0]] : null; }, { B: Math.min(200, X.B), seed: seedOf(X, 'roles:lu:' + role) }); return { lo: q.lo, hi: q.hi, se: q.se }; }, ['count', 'bpm']);
      const poss = [0, 0, 0];
      raw.forEach((r, i) => { poss[Math.min(2, counts[i][j])] += r.poss; });
      lu[j] = { b: fit.b[0], lo: bs ? nn(bs.lo[0]) : null, hi: bs ? nn(bs.hi[0]) : null, se: bs ? nn(bs.se[0]) : null, poss };
    });
  }
  /* evidence across the roles (both parts' p-values together in one false-discovery set) */
  const pOf = (b, se) => (isNum(b) && se > 0 ? 2 * W.normCdf(-Math.abs(b / se)) : null);
  const ps = keys.map((_, j) => pOf(club[j].slope, cb && cb.se ? cb.se[j] : null)).concat(lu.map(l => (l ? pOf(l.b, l.se) : null)));
  const q = W.bh(ps);
  const grade = (b, lo, hi, se, qq) => (isNum(lo) && isNum(hi) && (lo > 0 || hi < 0) && qq != null && qq < 0.05 ? 'strong' : se > 0 && Math.abs(b) > 1.6448536269514722 * se ? 'some' : 'none');
  keys.forEach((role, j) => {
    const o = club[j], cnt = rows.map(r => feats.get(r.id)[ROLE_SQUAD[role]]).filter(isNum), msh = rows.map(r => feats.get(r.id)._roleMin[role]).filter(isNum);
    const lo = cb ? nn(cb.lo[j]) : null, hi = cb ? nn(cb.hi[j]) : null, se = cb && cb.se ? cb.se[j] : null, L = lu[j];
    list.push({ k: role, n: o.C.xs.length, count: nn(meanOf(cnt)), minShare: nn(meanOf(msh)),
      r: o.cc ? o.cc.r : null, rlo: o.cc ? o.cc.lo : null, rhi: o.cc ? o.cc.hi : null,
      b: nn(o.slope), lo, hi, evidence: grade(o.slope, lo, hi, se, q[j]),
      lu: L ? { b: L.b, lo: L.lo, hi: L.hi, poss: L.poss, evidence: grade(L.b, L.lo, L.hi, L.se, q[keys.length + j]) } : null });
  });
  const tagged = {};
  ROLE_KEYS.forEach(k => { tagged[k] = P.rows.filter(p => p.min > 0 && p.roles.includes(k)).length; });
  return { n: rows.length, power: rows.length < 30 ? 'low' : 'ok', players: P.rows.filter(p => p.min >= ROLE_MIN).length, tagged, cuts: X.roleCuts || null, list };
}

/* BY POSITION IN DEPTH (A.3): for each club season and each position group (G, F, C by the A.1 slot shares) and each
   of the five slots (minutes at the slot), the minutes-weighted mean of every player's season rate (PLAYER_STATS less
   A/U); across the club seasons its median, spread (SD, P25-P75) and its association with net per 100 and with the
   share of games won (r with a Fisher interval, centred within each league-season; ★ after the false-discovery
   check). A group's stat needs 60% of its minutes from players with the rate. */
/* 2026-10-07 (Louie: every percentage statistic, and BPM and VORP), in families: shooting, the shot mix, volume, creation,
   the glass, defence, ball security, impact. BPM a group's is its players' minutes-weighted BPM; VORP a group's is the SUM
   of its players' VORP each in the share of his minutes he played there (VORP_SUM): value over a replacement player is
   a total, not a rate */
const POS_STATS = ['ts', 'efg', 'p3p', 'ftp', 'rimp', 'midp',
  'p3r', 'rimr', 'midr', 'ftr',
  'fga40', 'p3a40', 'rim40',
  'usg', 'ast_pct', 'ast40', 'a3s', 'una', 'ups', 'upp', 'un_pg', 'unp_pg',
  'orb_pct', 'drb_pct',
  'stl_pct', 'blk_pct',
  'tov_pct',
  'bpm', 'vorp'];
const VORP_SUM = new Set(['vorp']);
/* AGAINST THE LEAGUE, AND WHAT IT IS WORTH (Louie, 2026-10-07). Each cell also carries the league's mean (avg), the
   top and bottom quarter of the club seasons by net (top, bot) and the winners' gap to the mean (dTop = top - avg, the
   +/- a winner's position group runs at); and what one SD more of it at that position is worth in wins over 30 games
   (w30, with its interval: 30 (Phi(b pace / 100 / sigma_pred) - 1/2), b the net per 100 for one SD). groups[g].lever
   names the stat whose SD moves wins most at that position (the position's differentiator). X.posVal keeps every
   club's group lines for its own file (clubFile posv): the Front office reads where the club sits against the league
   at each position, and what the gap costs. */
const POS_GROUPS = ['G', 'F', 'C', '1', '2', '3', '4', '5'];
function posStats(X, feats) {
  const W = WS(), P = X.people;
  if (!P) return null;
  const rows = seasonRows(X, feats);
  if (rows.length < 6) return null;
  const weightOf = (p, g) => {
    const k = GROUPS3.indexOf(g);
    if (k >= 0) { const sh = P.shares.get(p.key); return sh ? sh[k] * p.min : 0; }
    return p.slots ? p.slots[+g - 1] : 0;
  };
  const byTeam = new Map();
  P.rows.forEach(p => { if (p.min > 0) { if (!byTeam.has(p.team)) byTeam.set(p.team, []); byTeam.get(p.team).push(p); } });
  /* VORP, in its published form: (BPM + 2) × his share of the club's minutes × the club's games against the league's
     season (its median games a club, X.G or the clubs' own), so a club season of any length is on one scale */
  const Gs = isNum(X.G) && X.G > 0 ? X.G : median(X.teamIds.map(t => X.teams.get(t).gl.length));
  P.rows.forEach(p => {
    const T = X.teams.get(p.team), tg = T ? T.gl.length : 0, gl = p.gp > 0 ? p.gameMin / p.gp : 0;
    p.vorp = isNum(p.bpm) && p.min > 0 && tg > 0 && gl > 0 && Gs > 0 ? (p.bpm + 2) * (p.min / (tg * gl)) * (tg / Gs) : null;
  });
  /* value[team][group][stat] */
  const val = new Map();
  rows.forEach(r => {
    const ps = byTeam.get(r.id) || [], v = {};
    POS_GROUPS.forEach(g => {
      v[g] = {};
      const tot = sum(ps.map(p => weightOf(p, g)));
      POS_STATS.forEach(k => {
        let s = 0, w = 0;
        ps.forEach(p => { const x = p[k], wt = weightOf(p, g); if (isNum(x) && wt > 0) { s += VORP_SUM.has(k) ? x * wt / p.min : wt * x; w += wt; } });
        v[g][k] = tot > 0 && w >= 0.6 * tot ? (VORP_SUM.has(k) ? s : s / w) : null;
      });
    });
    val.set(r.id, v);
  });
  const cells = [];
  /* the club seasons in quarters by net: the winners' and the strugglers' lines */
  const byNet = rows.slice().sort((a, b) => (b.net - a.net) || byId(a.id, b.id)), qn = Math.max(1, Math.floor(rows.length / 4));
  const topIds = new Set(byNet.slice(0, qn).map(r => r.id)), botIds = new Set(byNet.slice(-qn).map(r => r.id));
  const pace = (X.mu && X.mu.pace3q) || 72, sigma = X.fc && isNum(X.fc.sigma) ? X.fc.sigma : 12;
  const w30 = b => (isNum(b) ? 30 * (W.normCdf(b * pace / 100 / sigma) - 0.5) : null);
  POS_GROUPS.forEach(g => POS_STATS.forEach(k => {
    const xs = rows.map(r => val.get(r.id)[g][k]).filter(isNum).sort((a, b) => a - b);
    if (xs.length < 6) return;
    const cn = corrCI(...(C => [C.xs, C.ys, C.units])(centred(rows, r => val.get(r.id)[g][k], r => r.net)));
    const cw = corrCI(...(C => [C.xs, C.ys, C.units])(centred(rows, r => val.get(r.id)[g][k], r => r.win)));
    const avg = meanOf(xs), of = set => meanOf(rows.filter(r => set.has(r.id)).map(r => val.get(r.id)[g][k]).filter(isNum));
    const top = of(topIds), bot = of(botIds);
    cells.push({ g, k, n: xs.length, med: W.quantile(xs, 0.5), p25: W.quantile(xs, 0.25), p75: W.quantile(xs, 0.75), sd: nn(sdOf(xs)),
      avg: nn(avg), top: nn(top), bot: nn(bot), dTop: isNum(top) && isNum(avg) ? nn(top - avg) : null,
      r: cn ? cn.r : null, lo: cn ? cn.lo : null, hi: cn ? cn.hi : null, b: cn ? cn.b : null, blo: cn ? cn.blo : null, bhi: cn ? cn.bhi : null, _p: cn ? cn.p : null,
      w30: cn ? nn(w30(cn.b)) : null, w30lo: cn ? nn(w30(cn.blo)) : null, w30hi: cn ? nn(w30(cn.bhi)) : null,
      rw: cw ? cw.r : null, rwlo: cw ? cw.lo : null, rwhi: cw ? cw.hi : null });
  }));
  const q = W.bh(cells.map(c => c._p));
  cells.forEach((c, i) => { c.star = isNum(c.lo) && isNum(c.hi) && (c.lo > 0 || c.hi < 0) && q[i] != null && q[i] < 0.05; delete c._p; });
  /* each position's differentiator: the stat whose one SD moves wins most there (starred first, then by size) */
  const groups = {};
  POS_GROUPS.forEach(g => {
    const list = cells.filter(c => c.g === g && isNum(c.w30)).sort((a, b) => ((b.star ? 1 : 0) - (a.star ? 1 : 0)) || (Math.abs(b.w30) - Math.abs(a.w30)) || byId(a.k, b.k));
    groups[g] = list.length ? { lever: list[0].k, w30: list[0].w30, star: !!list[0].star, spread: nn(meanOf(list.slice(0, 5).map(c => Math.abs(c.w30)))) } : null;
  });
  X.posVal = { val, cells, pace, sigma };
  return { n: rows.length, stats: POS_STATS.slice(), groups: POS_GROUPS.slice(), cells, levers: groups, quarters: qn };
}

/* THE CLUB'S CREATION AND HOW WELL IT WORKS (Louie, 2026-10-07). Its creators are its ball handlers and its high-usage
   players (roles handler or creator); for each club season: their share of the club's plays (FGA + 0.44 FTA + TOV), their
   true shooting (TS%) and their points a play (PPP = points / plays), all from the season totals of the players so
   tagged. Across the club seasons each has the league's mean, SD, the winners' (top quarter by net) and strugglers'
   lines, its association with net (r within league, the slope for one SD) and that slope in wins over 30 games, as the
   position cells (posStats). X.creationVal keeps every club's own for its file. */
const CREATION_STATS = ['share', 'ts', 'ppp', 'hand_ts', 'hand_ppp'];
function creation(X, feats) {
  const W = WS(), P = X.people;
  if (!P) return null;
  const rows = seasonRows(X, feats);
  if (rows.length < 6) return null;
  const byTeam = new Map();
  P.rows.forEach(p => { if (p.min > 0) { if (!byTeam.has(p.team)) byTeam.set(p.team, []); byTeam.get(p.team).push(p); } });
  const plays = p => (+p.fga || 0) + 0.44 * (+p.fta || 0) + (+p.to || 0), tsa = p => (+p.fga || 0) + 0.44 * (+p.fta || 0);
  const val = new Map();
  rows.forEach(r => {
    const ps = byTeam.get(r.id) || [], all = sum(ps.map(plays));
    const cr = ps.filter(p => (p.roles || []).some(k => k === 'handler' || k === 'creator')), hd = ps.filter(p => (p.roles || []).includes('handler'));
    const ofs = L => { const pl = sum(L.map(plays)), ta = sum(L.map(tsa)), pt = sum(L.map(p => +p.pts || 0));
      return { ts: ta > 0 ? 100 * pt / (2 * ta) : null, ppp: pl > 0 ? pt / pl : null, plays: pl }; };
    const c = ofs(cr), h = ofs(hd);
    val.set(r.id, { share: all > 0 && cr.length ? 100 * c.plays / all : (all > 0 ? 0 : null), ts: c.plays >= 50 ? c.ts : null, ppp: c.plays >= 50 ? c.ppp : null,
      hand_ts: h.plays >= 50 ? h.ts : null, hand_ppp: h.plays >= 50 ? h.ppp : null, n: cr.length, nh: hd.length, plays: c.plays });
  });
  const byNet = rows.slice().sort((a, b) => (b.net - a.net) || byId(a.id, b.id)), qn = Math.max(1, Math.floor(rows.length / 4));
  const topIds = new Set(byNet.slice(0, qn).map(r => r.id)), botIds = new Set(byNet.slice(-qn).map(r => r.id));
  const pace = (X.mu && X.mu.pace3q) || 72, sigma = X.fc && isNum(X.fc.sigma) ? X.fc.sigma : 12;
  const w30 = b => (isNum(b) ? 30 * (W.normCdf(b * pace / 100 / sigma) - 0.5) : null);
  const stats = {};
  CREATION_STATS.forEach(k => {
    const xs = rows.map(r => val.get(r.id)[k]).filter(isNum);
    if (xs.length < 6) return;
    const of = set => meanOf(rows.filter(r => set.has(r.id)).map(r => val.get(r.id)[k]).filter(isNum));
    const cn = corrCI(...(C => [C.xs, C.ys, C.units])(centred(rows, r => val.get(r.id)[k], r => r.net)));
    stats[k] = { n: xs.length, avg: nn(meanOf(xs)), sd: nn(sdOf(xs)), top: nn(of(topIds)), bot: nn(of(botIds)),
      r: cn ? cn.r : null, lo: cn ? cn.lo : null, hi: cn ? cn.hi : null, b: cn ? cn.b : null, w30: cn ? nn(w30(cn.b)) : null, w30lo: cn ? nn(w30(cn.blo)) : null, w30hi: cn ? nn(w30(cn.bhi)) : null };
  });
  X.creationVal = { val, stats, pace, sigma };
  return { n: rows.length, stats, keys: CREATION_STATS.slice(), creators: nn(meanOf(rows.map(r => val.get(r.id).n))), handlers: nn(meanOf(rows.map(r => val.get(r.id).nh))) };
}
/* a club's creation line for its file: each CREATION_STATS value, its z against the league's clubs and its worth in wins */
function creationOf(X, tid) {
  const W = WS(), CV = X.creationVal, v = CV && CV.val.get(tid);
  if (!v) return null;
  const out = { n: v.n, nh: v.nh, plays: r2n(v.plays) };
  CREATION_STATS.forEach(k => {
    const st = CV.stats[k], x = v[k];
    if (!isNum(x)) { out[k] = null; return; }
    const z = st && st.sd > 0 ? (x - st.avg) / st.sd : null;
    out[k] = [r2n(x), r2n(z), isNum(z) && st && isNum(st.b) ? r2n(30 * (W.normCdf(z * st.b * CV.pace / 100 / CV.sigma) - 0.5)) : null];
  });
  return out;
}

/* ================================================================== A.3: THE LINEUP MIXES FILE (scope 'mix') === */
/* What the page's lineup builder filters, in the browser, with no other read: every five a club used (its stints
   summed over the season), its minutes and both ends' box, and an anonymous index of the players with their season
   rates and role tags. Columnar and integer where it can be:
     {w, scope: 'mix', league, season, token, built, n: {games, stints, fives, players},
      stats: MIX_STATS, roles: ROLE_KEYS, cuts, pct: {stat: [P25, P50, P75, P90] over the regulars}, minRate: 100,
      teams: [club ids],
      players: {t: [club index], min: [minutes], tag: [role bitmask, bit i = roles[i]], v: [[value per player] per stat]},
      rows: {t: [club index], p: [5 player indexes a five, -1 unknown], s: [seconds], o: [8 a five], d: [8 a five]},
      box: BOX_KEYS, trim: {minPoss, fives, poss} | null}
   o and d: the five's own and its opponents' fga, fgm, f3m, fta, pts, tov, or, dr, summed over its stints with a known
   box (a stint without one, a feature row's own, is left out and counted in n.stints only). No names, no ids of
   players; a withheld player (I6) is index -1, as an unknown one is. Over the budget, the fives with the fewest
   possessions go first and trim says how many and their share of the possessions. */
const MIX_STATS = ['ast_pct', 'usg', 'ups', 'au', 'ts', 'p3r', 'p3p', 'rimr', 'ftr', 'una', 'orb_pct', 'drb_pct', 'stl_pct', 'blk_pct', 'tov_pct'];
const MIX_MIN = 100;
function mixFile(X, o) {
  o = o || {};
  const P = X.people, Wd = X.W;
  if (!P || !Wd || !Wd.stints || !Wd.stints.length) return null;
  const teams = X.teamIds.slice(), tAt = new Map(teams.map((t, i) => [t, i]));
  const pl = P.rows.filter(p => p.min > 0 && !P.withheld.has(String(p.id))).slice().sort((a, b) => byId(a.team, b.team) || byId(a.key, b.key));
  const pAt = new Map(pl.map((p, i) => [p.key, i]));
  const rd = (v, k) => (isNum(v) ? (k === 'au' ? r2d(v) : r1(v)) : null);
  const players = { t: pl.map(p => tAt.get(p.team)), min: pl.map(p => Math.round(p.min)), tag: pl.map(p => ROLE_KEYS.reduce((m, k, i) => m | (p.roles.includes(k) ? 1 << i : 0), 0)),
    v: MIX_STATS.map(k => pl.map(p => rd(p[k], k))) };
  const reg = pl.filter(p => p.min >= ROLE_REG);
  const pct = {};
  MIX_STATS.forEach(k => { const v = reg.map(p => p[k]).filter(isNum).sort((a, b) => a - b); pct[k] = v.length >= 5 ? [0.25, 0.5, 0.75, 0.9].map(q => rd(WS().quantile(v, q), k)) : null; });
  /* the fives: stints summed by (club, the five's player indexes sorted) */
  const fives = new Map();
  let stints = 0;
  Wd.stints.forEach(st => {
    const g = X.games[st.g];
    if (!g) return;
    stints++;
    if (!st.box || st.box.some(v => !isNum(v)) || !(st.dur > 0)) return;
    const tid = st.side ? g.a : g.h, idx = st.p.map(i => (i >= 0 ? pAt.get(tid + '|' + Wd.players[i]) : undefined)).map(i => (i == null ? -1 : i)).sort((a, b) => a - b);
    const key = tid + ':' + idx.join(',');
    let f = fives.get(key);
    if (!f) { f = { t: tAt.get(tid), p: idx, s: 0, box: new Array(16).fill(0) }; fives.set(key, f); }
    f.s += st.dur;
    for (let j = 0; j < 16; j++) f.box[j] += st.box[j];
  });
  const possOf = f => 0.5 * (possEst({ fga: f.box[0], tov: f.box[5], fta: f.box[3], or: f.box[6] }) + possEst({ fga: f.box[8], tov: f.box[13], fta: f.box[11], or: f.box[14] }));
  let list = Array.from(fives.values()).sort((a, b) => (a.t - b.t) || byId(a.p.join(','), b.p.join(',')));
  const enc = L => ({ t: L.map(f => f.t), p: L.flatMap(f => f.p), s: L.map(f => Math.round(f.s)), o: L.flatMap(f => f.box.slice(0, 8)), d: L.flatMap(f => f.box.slice(8)) });
  const file = { w: FILE_V, scope: 'mix', league: X.league ? { id: X.league.id, slug: X.league.slug || '', name: X.league.name || '' } : null, season: X.season ? { id: X.season.id, name: X.season.name || '' } : null,
    token: o.token || '', built: o.now || '', n: { games: X.n, stints, fives: list.length, players: pl.length }, stats: MIX_STATS.slice(), roles: ROLE_KEYS.slice(), cuts: X.roleCuts || null,
    pct, minRate: MIX_MIN, teams, players, box: BOX_KEYS.slice(), rows: enc(list), trim: null };
  /* the budget: the fives with the fewest possessions leave first, in tenths of the list, until it fits */
  const lim = budgetOf('mix', file, o);
  if (bytesOf(file) > lim) {
    const all = list.map(f => [possOf(f), f]).sort((a, b) => (a[0] - b[0]) || (a[1].t - b[1].t) || byId(a[1].p.join(','), b[1].p.join(',')));
    const totalPoss = sum(all.map(x => x[0]));
    let cut = 0, minPoss = 0;
    while (bytesOf(file) > lim && cut < all.length - 1) {
      cut = Math.min(all.length - 1, cut + Math.max(1, Math.ceil(all.length / 20)));
      minPoss = all[cut][0];
      const keep = new Set(all.slice(cut).map(x => x[1]));
      list = list.filter(f => keep.has(f));
      file.rows = enc(list);
      file.trim = { minPoss: r1(minPoss), fives: cut, poss: totalPoss > 0 ? sum(all.slice(0, cut).map(x => x[0])) / totalPoss : 0 };
    }
    file.n.fives = list.length;
  }
  return file;
}

/* ================================================================== CAUSES OF A RESULT (§7.11) === */
const PART_KEYS = ['quality', 'making', 'tovp', 'orebp', 'ftr', 'other', 'garbage'];
/* every game split exactly (home view): y = expected + quality + making + tovp + orebp + ftr + other + garbage (ftr: the
   free-throw attempt part; files built before A.3 call it ftmr, and the readers take either) */
function causes(X, core) {
  const W = WS(), I = X.I;
  const beta = {}, coef = core.model.coef;
  CORE.forEach(k => { const c = coef.find(x => x.k === k); beta[k] = c ? c.b : 0; });
  /* α: the unit's, or in the pooled fit each game's own league's (one h column a league) */
  const alpha0 = core.model.home.v || 0, hb = core.post ? core.post.b : core.fit.b;
  const alphaOf = i => (core.nh > 1 && X.hLeague ? hb[X.hLeague(i)] : alpha0);
  X.games.forEach((g, i) => {
    const alpha = alphaOf(i);
    const o = X.pre[i], dx = {}, ex = {};
    CORE.forEach(k => { const d = X.dx[k][i], e = o.ex[k]; ex[k] = isNum(e) ? e : 0; dx[k] = isNum(d) ? d : ex[k]; });
    const dq = isNum(X.xe[i][0]) && isNum(X.xe[i][1]) ? X.xe[i][0] - X.xe[i][1] : NaN, eq = isNum(o.ex.xefg) ? o.ex.xefg : 0;
    const yc = isNum(X.yc[i]) ? X.yc[i] : X.y[i];
    const r = W.oaxaca({ beta, alpha, h: X.h[i], dx, ex, y: X.y[i], yc, split: { k: 'c_efg', dx: isNum(dq) ? dq : eq, ex: eq, names: ['quality', 'making'] } });
    const parts = { quality: r.parts.quality, making: r.parts.making, tovp: r.parts.c_tovp, orebp: r.parts.c_orebp, ftr: r.parts.c_ftr, other: r.other, garbage: r.garbage };
    const sq = X.sq[i], luck = isNum(sq[0][2]) && isNum(sq[1][2]) ? (g.F[0][I.pts] - sq[0][2]) - (g.F[1][I.pts] - sq[1][2]) : null;
    /* the factors' fitted margin, for the club's factor-expected wins */
    let fitM = alpha * X.h[i];
    CORE.forEach(k => { fitM += beta[k] * dx[k]; });
    o.cause = { expected: r.expected, parts, luck, fitM };
  });
  /* the league's average loss: each decided game from the loser's side, mean parts with a bootstrap over games */
  const rows = [];
  X.games.forEach((g, i) => { if (X.y[i] === 0) return; const s = X.y[i] < 0 ? 1 : -1, c = X.pre[i].cause; rows.push([s * c.expected].concat(PART_KEYS.map(k => s * c.parts[k]))); });
  const keys = ['expected'].concat(PART_KEYS);
  const est = keys.map((_, j) => meanOf(rows.map(r => r[j])));
  const bs = boot(X, 'losses', () => {
    const r = W.rng(seedOf(X, 'losses')), d = [];
    for (let b = 0; b < X.B && rows.length; b++) { const m = new Array(keys.length).fill(0); for (let j = 0; j < rows.length; j++) { const row = rows[Math.floor(r() * rows.length)]; row.forEach((v, q) => { m[q] += v; }); } d.push(m.map(v => v / rows.length)); }
    return { lo: keys.map((_, j) => pctl(d, j)[0]), hi: keys.map((_, j) => pctl(d, j)[1]) };
  });
  const luck = X.games.map((g, i) => X.pre[i].cause.luck);
  return { parts: keys.map((k, j) => ({ k, pts: est[j], lo: bs ? nn(bs.lo[j]) : null, hi: bs ? nn(bs.hi[j]) : null })), luckSd: nn(sdOf(luck)), n: rows.length };
}

/* ================================================================== THE SIMULATOR (§8.1, §8.3) === */
/* a feature row as named counts (LAYOUT keys), with its quality bits */
function named(X, f, q) { const o = { q }; FT().LAYOUT.forEach(x => { o[x.k] = f[x.i]; }); return o; }
const addIn = (acc, inp) => { for (const k in inp) { const v = inp[k]; if (!v || !isNum(v.x) || !isNum(v.n)) continue; if (!acc[k]) acc[k] = { x: 0, n: 0 }; acc[k].x += v.x; acc[k].n += v.n; } return acc; };
function simInputs(X) {
  const S = SIM(), Q = FT().QBITS;
  /* the shooting share of trips where foul kinds are known (else the pooled one) for a league without them */
  let ts = 0, tb = 0;
  X.games.forEach(g => [0, 1].forEach(s => { if (g.q[s] & Q.FOULKIND) { const f = g.F[s]; if (isNum(f[X.I.trips_shooting]) && isNum(f[X.I.trips_bonus])) { ts += f[X.I.trips_shooting]; tb += f[X.I.trips_bonus]; } } }));
  const split = ts + tb > 0 ? ts / (ts + tb) : (X.priors && isNum(X.priors.split) ? X.priors.split : undefined);
  X.split = split;
  X.ein = X.games.map(g => [0, 1].map(s => S.endInput(named(X, g.F[s], g.q[s]), named(X, g.F[1 - s], g.q[1 - s]), { foulKinds: !!(g.q[s] & Q.FOULKIND), split })));
  const all = {};
  X.ein.forEach(p => p.forEach(e => addIn(all, e)));
  X.lgRates = S.ratesOf(all);
  /* a rate the unit cannot give (no zones, no timing) is the reference league's */
  S.RATES.forEach(k => { if (!isNum(X.lgRates[k])) X.lgRates[k] = S.LG[k]; });
}
/* a club's profile from the games before t (all games when t is null) */
function profileOf(X, tid, before) {
  const S = SIM(), T = X.teams.get(tid), off = {}, def = {};
  let n = 0;
  if (T) T.gl.forEach(([i, s]) => { if (before != null && !(X.games[i].t < before)) return; addIn(off, X.ein[i][s]); addIn(def, X.ein[i][1 - s]); n++; });
  return S.profile({ off, def, games: n }, { rates: X.lgRates });
}
function simulator(X, opts) {
  const S = SIM(), I = X.I, Q = FT().QBITS;
  const zones = X.quality.zones >= 0.8;
  const regs = X.games.map(g => g.F[0][I.reg_min]).filter(isNum);
  const T = (regs.length ? median(regs) : 40) * 60;
  const Lbase = { rates: X.lgRates, T, Tot: 300, zones, ft3: 0.05, fouling: true };
  let cal = null;
  /* opts.simReuse (the builder, between weekly full runs): the last full build's calibration is carried while the unit
     has grown by less than that share since it was fitted (it is most of a big unit's build: PERF2-5); one fitted by an
     older calibrate (no v) is fitted again */
  const cs = X.carrySim;
  const reuse = opts.simReuse != null && cs && cs.v === SIMCAL_V && isNum(cs.nGames) && cs.nGames > 0 && X.n >= cs.nGames && X.n <= cs.nGames * (1 + +opts.simReuse);
  if (X.mode === 'update') cal = cs || null;
  else if (reuse) { cal = cs; X.simReused = true; }
  else if (opts.sim !== false && X.fc && X.fc.preds.length >= 20) {
    const tally = (g, s) => {
      const f = g.F[s], q = g.q[s];
      if (!((q & Q.SIT) && (q & Q.TIMED))) return null;
      const o = {};
      S.TALLY.forEach(k => { o[k] = isNum(f[I[k]]) ? f[I[k]] : 0; });
      o.to_n = isNum(f[I.to_n]) ? f[I.to_n] : o.tov;
      return o;
    };
    const games = X.fc.preds.map((p, j) => {
      const g = X.games[p.i];
      const ta = tally(g, 0), tb = tally(g, 1);
      return { A: profileOf(X, g.h, g.t), B: profileOf(X, g.a, g.t), home: X.h[p.i] ? 1 : 0, y: X.y[p.i], t: g.t, pF: X.fc.pF[j], pE: X.fc.pE[j],
        poss: 0.5 * ((g.F[0][I.poss] || 0) + (g.F[1][I.poss] || 0)), tally: ta && tb ? [ta, tb] : null,
        ot: isNum(g.F[0][I.ot_periods]) ? g.F[0][I.ot_periods] : 0, T: isNum(g.F[0][I.reg_min]) ? g.F[0][I.reg_min] * 60 : T };
    });
    const so = opts.simOpts || {};
    try {
      /* §8.3: 1,000 simulations a test game in units up to 2,000 games, else a 1,500-game sample at 400 */
      const big = X.n > 2000 ? { evalN: 1500, evalSims: 400 } : { evalSims: opts.simN || 1000 };
      const r = S.calibrate(games, Lbase, Object.assign({ seed: seedOf(X, 'sim'), compare: { forecast: X.predictive.metrics.brier, elo: X.predictive.baselines.elo.brier } }, big, so));
      const rep = r.report || {};
      cal = { v: SIMCAL_V, nGames: X.n, hca: r.hca, tau: r.tau, kappaN: r.kappaN, sigmaN: r.sigmaN, muOff: r.muOff, dTr: r.dTr, lead: r.lead, fouling: r.fouling, tripOff: r.tripOff || 0, platt: r.platt,
        report: { calibrated: !!rep.calibrated, ftrOk: rep.ftrOk !== false, heldOut: !!rep.heldOut, brier: rep.brier, logloss: rep.logloss, slope: rep.slope, intercept: rep.intercept, ece: rep.ece, auc: rep.auc, nEval: rep.nEval, checks: rep.checks,
          inSample: rep.inSample ? { brier: rep.inSample.brier, slope: rep.inSample.slope, checks: rep.inSample.checks } : null } };
      const fc = rep.checks && rep.checks.ftr;
      if (fc && isNum(fc.obs) && isNum(fc.sim) && Math.abs(fc.sim - fc.obs) > 1) (X.warnings || []).push('simulator free throws a shot off by ' + (fc.sim - fc.obs).toFixed(1) + ' (held out): not calibrated');
    } catch (e) { (X.warnings || []).push('simulator calibration failed: ' + String(e && e.message || e).slice(0, 120)); cal = null; }
  }
  X.simCal = cal;
  const L = Object.assign({}, Lbase, cal ? { kappaN: cal.kappaN, sigmaN: cal.sigmaN, hca: cal.hca, tau: cal.tau, muOff: cal.muOff, dTr: cal.dTr, lead: cal.lead, fouling: cal.fouling, tripOff: cal.tripOff || 0 }
    : { kappaN: 1, sigmaN: 0, hca: 0, tau: 0, muOff: 0, dTr: 0, lead: 0, tripOff: 0 });
  return { L, cal };
}

/* ================================================================== THE CLUBS' TABLE === */
function clubTable(X) {
  const I = X.I, out = new Map();
  X.teamIds.forEach(tid => {
    const T = X.teams.get(tid);
    let w = 0, l = 0, pf = 0, pa = 0, poss = 0, oposs = 0, pf3 = 0;
    T.gl.forEach(([i, s]) => {
      const g = X.games[i], m = s ? g.as - g.hs : g.hs - g.as;
      if (m > 0) w++; else if (m < 0) l++;
      const own = g.F[s], opp = g.F[1 - s];
      if (isNum(own[I.poss_est]) && isNum(opp[I.poss_est])) { pf += s ? g.as : g.hs; pa += s ? g.hs : g.as; poss += own[I.poss_est]; oposs += opp[I.poss_est]; }
      void pf3;
    });
    const ortg = poss ? 100 * pf / poss : null, drtg = oposs ? 100 * pa / oposs : null;
    const pyth = pf + pa > 0 ? 1 / (1 + Math.pow(pa / Math.max(1e-9, pf), 14)) : null;
    const t = X.tf.get(tid);
    out.set(tid, { id: tid, gp: T.gl.length, w, l, ortg, drtg, net: isNum(ortg) && isNum(drtg) ? ortg - drtg : null, pace3q: t && t.off.pace3q ? t.off.pace3q.v : null, pyth,
      elo: X.elo && X.elo.final.has(tid) ? X.elo.final.get(tid) : ELO_0 });
  });
  return out;
}

/* ================================================================== FILES (§9) === */
/* numbers to 4 significant figures, NaN and Infinity to null, internal keys (_x) and undefined left out */
function pack(file) {
  const walk = v => {
    if (v == null) return null;
    if (typeof v === 'number') return sig4(v);
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (v instanceof Map) { const o = {}; Array.from(v.keys()).sort().forEach(k => { o[k] = walk(v.get(k)); }); return o; }
    if (ArrayBuffer.isView(v)) return Array.from(v, sig4);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') {
      const o = {};
      Object.keys(v).forEach(k => { if (k[0] === '_' || v[k] === undefined || typeof v[k] === 'function') return; o[k] = walk(v[k]); });
      return o;
    }
    return null;
  };
  return walk(file);
}
/* a file as it was written, with any data.js-packed rows ({k, v, x}) back as rows */
function unpack(obj) {
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (Array.isArray(v.k) && Array.isArray(v.v) && Object.keys(v).every(k => k === 'k' || k === 'v' || k === 'x')) return unpackRows(v).map(walk);
      const o = {};
      Object.keys(v).forEach(k => { o[k] = walk(v[k]); });
      return o;
    }
    return v;
  };
  return walk(typeof obj === 'string' ? JSON.parse(obj) : obj);
}
const bytesOf = f => { const s = JSON.stringify(f); let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3; } return n; };
function budgetOf(scope, file, o) {
  /* o.budget: {scope: bytes}, a smaller budget for a test (never a larger one) */
  if (o && o.budget && isNum(o.budget[scope])) return Math.min(o.budget[scope], budgetOf(scope, file, Object.assign({}, o, { budget: null })));
  if (scope === 'teaser') return BUDGET.teaser;
  if (scope === 'wins') return file && file.league == null ? BUDGET.winsPool : BUDGET.wins;
  if (scope === 'fo') {
    /* plus a club's compact row (its simulator profile, record and core four) for every club past ~200: a league of
       hundreds of clubs (NCAA) needs each one's profile to simulate any fixture, so its file grows with them */
    const base = (o && o.games > BIG_GAMES) || (file && file.n && file.n.games > BIG_GAMES) ? BUDGET.foBig : BUDGET.fo;
    const clubs = file && Array.isArray(file.teams) ? file.teams.length : 0;
    return Math.max(base, BUDGET.foBase + BUDGET.foPerClub * clubs);
  }
  if (scope === 'club') return BUDGET.club;
  if (scope === 'pos') return BUDGET.pos;
  if (scope === 'mix') return BUDGET.mix;
  return Infinity;
}
/* §6.6: over budget, drop the adjusted curves, thin curves to 15 points, merge blocks to fortnights, drop the curves
   of factors with q >= 0.05; still more than 25% over: null (the unit fails and the previous file stays) */
function thin(grid, n) { if (!grid || grid.length <= n) return grid; const out = []; for (let i = 0; i < n; i++) out.push(grid[Math.round(i * (grid.length - 1) / (n - 1))]); return out; }
function fitBudget(scope, file, warnings, o) {
  let f = pack(file), b = bytesOf(f);
  const lim = budgetOf(scope, file, o);
  if (b <= lim) return f;
  const steps = [];
  if (scope === 'wins') {
    steps.push(x => { Object.values(x.curves || {}).forEach(c => { c.adj = null; }); });
    steps.push(x => { Object.values(x.curves || {}).forEach(c => { c.raw = thin(c.raw, 15); }); if (x.tempo) { x.tempo.curve = thin(x.tempo.curve, 15); x.tempo.curveAdj = thin(x.tempo.curveAdj, 15); } });
    steps.push(x => { if (x.blocks && x.blocks.list) { const L = x.blocks.list, out = []; for (let i = 0; i < L.length; i += 2) out.push(i + 1 < L.length ? sumBlock(L[i], L[i + 1]) : sumBlock(out.pop() || zeroBlock(L[i]), L[i])); x.blocks.list = out.filter(Boolean); } });
    steps.push(x => { const q = new Map((x.scan || []).map(s => [s.k, s.q])); Object.keys(x.curves || {}).forEach(k => { if (!(q.get(k) < 0.05)) delete x.curves[k]; }); });
  } else if (scope === 'club') {
    steps.push(x => { x.lineups = (x.lineups || []).slice(0, 5); });
    /* the realised rates of the last five defeats only (the loss Shapley replays those) */
    steps.push(x => { const losses = (x.games || []).filter(g => g.m < 0 && x.realised && x.realised[g.g]).slice(-5).map(g => g.g), keep = new Set(losses);
      Object.keys(x.realised || {}).forEach(k => { if (!keep.has(k)) delete x.realised[k]; }); });
    steps.push(x => { if (x.pos) x.pos.slots = []; });
    /* parts to one decimal, `other` still the remainder: m = xm + Σ parts holds as written */
    steps.push(x => (x.games || []).forEach(g => {
      const r = v => (isNum(v) ? Math.round(v * 10) / 10 : v);
      g.xm = r(g.xm); g.luck = r(g.luck);
      Object.keys(g.parts).forEach(k => { if (k !== 'other') g.parts[k] = r(g.parts[k]); });
      g.parts.other = Math.round((g.m - g.xm - Object.keys(g.parts).filter(k => k !== 'other').reduce((a, k) => a + g.parts[k], 0)) * 100) / 100;
    }));
    /* the positional lines (2026-10-07) only where the gap is worth a tenth of a win or more: the Front office reads none
       under a fifth */
    steps.push(x => { if (x.posv) ['G', 'F', 'C'].forEach(g => { if (Array.isArray(x.posv[g])) x.posv[g] = x.posv[g].map(e => (e && isNum(e[2]) && Math.abs(e[2]) >= 0.1 ? e : null)); }); });
  } else if (scope === 'fo') {
    steps.push(x => { Object.values(x.pos || {}).forEach(p => { p.slots = []; }); });
    steps.push(x => { if (x.squad) x.squad.pd = {}; });
    /* a big league (hundreds of clubs): the embedded positions go (each club's pos file has them), then the clubs'
       season values beyond the core four */
    steps.push(x => { x.pos = {}; });
    steps.push(x => (x.teams || []).forEach(t => { Object.keys(t.f || {}).forEach(k => { if (!CORE.includes(k)) delete t.f[k]; }); }));
    /* NCAA-size (hundreds of clubs): each club's simulator profile compact, an array a end in RATES order at three
       significant figures (EpinoiaWinSim reads either form), the four factors' season values to three figures */
    steps.push(x => {
      const R = SIM().RATES, s3 = v => (isNum(v) ? +v.toPrecision(3) : null);
      (x.teams || []).forEach(t => {
        if (t.prof && t.prof.off && !Array.isArray(t.prof.off)) t.prof = { off: R.map(k => s3(t.prof.off[k])), def: R.map(k => s3(t.prof.def[k])), n: t.prof.n };
        Object.values(t.f || {}).forEach(v => { v.off = s3(v.off); v.def = s3(v.def); });
        ['net', 'ortg', 'drtg', 'pace3q', 'pyth'].forEach(k => { t[k] = s3(t[k]); });
        if (t.logo == null) delete t.logo;
      });
    });
  }
  for (const s of steps) {
    s(f);
    b = bytesOf(f);
    if (b <= lim) { (warnings || []).push(scope + ' trimmed to its budget (' + b + ' bytes)'); return f; }
  }
  if (b <= lim * 1.25) { (warnings || []).push(scope + ' over its budget by ' + Math.round(100 * (b / lim - 1)) + '% (kept)'); return f; }
  (warnings || []).push(scope + ' is ' + b + ' bytes, more than 25% over its budget of ' + lim + ': not written');
  return null;
}
const zeroBlock = a => ({ n: 0, sw: 0, xx: a.xx.map(() => 0), xy: a.xy.map(() => 0), yy: 0, sy: 0 });
const sumBlock = (a, b) => (a && b ? { n: a.n + b.n, sw: a.sw + b.sw, xx: a.xx.map((v, i) => v + b.xx[i]), xy: a.xy.map((v, i) => v + b.xy[i]), yy: a.yy + b.yy, sy: a.sy + b.sy } : a || b);

const LONG_OK = new Set(['label', 'name', 'def', 'slug', 'id', 'ids', 'g', 'opp', 'team', 'token', 'built', 'ci_at', 'top', 'keys', 'league', 'season', 'set', 'stats', 'k', 'f', 'logo', 'colour', 'short']);
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* the problems with a file (empty when valid): its shape, its budget, no per-game feature vector (no key `f` holding
   numbers, no array of 108), no long free text, the pooled file's blocks and leagues, the teaser's keys, a club file's
   games. o: {open: Set of league ids, games: Set of the club's game ids, withheld: Set} */
function validate(file, scope, o) {
  o = o || {};
  const P = [];
  if (!file || typeof file !== 'object') return ['not an object'];
  if (file.w !== FILE_V) P.push('w is not ' + FILE_V);
  if (scope !== 'pos' && file.scope !== scope) P.push('scope is ' + file.scope + ', not ' + scope);
  const b = bytesOf(file), lim = budgetOf(scope, file, o);
  if (b > lim * 1.25) P.push('over budget: ' + b + ' bytes (budget ' + lim + ')');
  const walk = (v, path, key) => {
    if (Array.isArray(v)) {
      /* (a mix file's columns are its own: a list of 108 players or fives is no feature vector) */
      if (scope !== 'mix' && v.length === 108 && v.every(x => x == null || typeof x === 'number')) P.push('a 108-number array at ' + path);
      v.forEach((x, i) => walk(x, path + '[' + i + ']', key));
      return;
    }
    if (v && typeof v === 'object') {
      Object.keys(v).forEach(k => {
        if (k === 'f' && (Array.isArray(v[k]) || ArrayBuffer.isView(v[k]))) P.push('a key f holding a vector at ' + path);
        walk(v[k], path + '.' + k, k);
      });
      return;
    }
    if (typeof v === 'string' && v.length > 40 && !LONG_OK.has(key) && !UUIDISH.test(v)) P.push('a string over 40 characters at ' + path);
  };
  walk(file, scope, '');
  const need = { wins: ['quality', 'meta', 'homeWin', 'sigma', 'scan', 'models', 'predictive', 'curves', 'tempo', 'losses'],
    fo: ['lg', 'sim', 'value', 'teams'], club: ['team', 'record', 'games', 'losses', 'realised', 'players'], teaser: ['ranked', 'leagues'], pos: ['team', 'season', 'players', 'slots'],
    mix: ['stats', 'roles', 'teams', 'players', 'rows'] }[scope] || [];
  need.forEach(k => { if (!(k in file)) P.push('missing ' + k); });
  if (scope !== 'teaser' && scope !== 'pos' && scope !== 'mix') ['fv', 'code', 'token', 'built', 'n', 'lens'].forEach(k => { if (!(k in file)) P.push('missing ' + k); });
  if (scope === 'mix') {
    /* the mix file's columns line up: five players, 8 counts an end, a club and seconds a five; a club a player; no
       player id at all (anonymous indexes only) */
    const R = file.rows || {}, n = (R.t || []).length, np = ((file.players && file.players.t) || []).length;
    if ((R.p || []).length !== 5 * n || (R.o || []).length !== 8 * n || (R.d || []).length !== 8 * n || (R.s || []).length !== n) P.push('mix rows do not line up');
    if ((R.p || []).some(i => i !== -1 && !(i >= 0 && i < np))) P.push('mix rows name a player outside the index');
    if (((file.players && file.players.v) || []).length !== (file.stats || []).length) P.push('mix players lack a stat');
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(file.players || {}))) P.push('mix players carry an id');
  }
  if (scope === 'wins') {
    if (file.blocks && file.blocks.list) file.blocks.list.forEach((bl, i) => { if (!(bl.n >= 8)) P.push('block ' + i + ' covers ' + bl.n + ' games'); });
    if (file.league == null) {
      if (file.blocks) P.push('the pooled file carries blocks');
      if (o.open && Array.isArray(file.leagues)) file.leagues.forEach(l => { if (!o.open.has(l.id)) P.push('league ' + l.slug + ' is not open'); });
      if (o.open && file.tempo && Array.isArray(file.tempo.teams) && o.openTeams) file.tempo.teams.forEach(t => { if (!o.openTeams.has(t.id)) P.push('club ' + t.id + ' is not in an open league'); });
    }
  }
  if (scope === 'teaser') {
    const pub = new Set(FT().PUBLIC_KEYS);
    (file.ranked || []).forEach(r => { if (!pub.has(r.k)) P.push('teaser key ' + r.k + ' is not public'); });
    ((file.factors && file.factors.shares) || []).forEach(r => { if (!pub.has(r.k)) P.push('teaser key ' + r.k + ' is not public'); });
    (file.leagues || []).forEach(l => { if (l.top && !pub.has(l.top.k)) P.push('teaser key ' + l.top.k + ' is not public'); });
  }
  if (scope === 'club') {
    const tid = file.team && file.team.id;
    (file.games || []).forEach(g => { if (g.opp === tid) P.push('a game against itself'); if (o.games && !o.games.has(g.g)) P.push('game ' + g.g + ' is not the club\'s'); });
  }
  if (o.withheld && o.withheld.size) {
    const ids = [];
    (Array.isArray(file.players) ? file.players : []).forEach(p => ids.push(p.id));     // (a mix file's players are anonymous columns)
    ((file.pos && file.pos.players) || []).forEach(p => ids.push(p.id));
    Object.values(file.pos || {}).forEach(pf => { if (pf && Array.isArray(pf.players)) pf.players.forEach(p => ids.push(p.id)); });
    ids.forEach(id => { if (o.withheld.has(id)) P.push('withheld player ' + id); });
  }
  return P;
}

/* ------------------------------------------------------------------ the unit's files --- */
function header(X, scope, o) {
  const L = X.league, S = X.season;
  return { w: FILE_V, fv: (FT() && FT().FV) || 1, code: CODE_V, scope,
    league: L ? { id: L.id, slug: L.slug || '', name: L.name || '' } : null, season: S ? { id: S.id, name: S.name || '' } : null,
    token: o.token, built: o.now, ci_at: o.ciAt || null,
    n: { games: X.n, decided: X.y.filter(v => v !== 0).length, teams: X.teamIds.length },
    lens: { explain: true, forecast: !!(X.fc && X.fc.live), simulate: !!(X.simCal && X.simCal.report && X.simCal.report.calibrated) } };
}
function metaOf(keys) {
  const M = fac(), out = {};
  Array.from(new Set(keys)).sort().forEach(k => { const x = M.get(k); if (x) out[k] = { label: x.label, grp: x.grp, unit: x.unit, dir: x.dir, score: !!x.score, def: x.def }; });
  return out;
}
function posFile(X, tid) {
  const P = X.people, s = P.slots.get(tid), T = X.teams.get(tid);
  if (!s || !T) return null;
  const est = new Map(P.rows.filter(p => p.team === tid).map(p => [p.id, p]));
  const list = Array.from(s.min.keys()).filter(id => !P.withheld.has(String(id))).map(id => {
    const m = s.min.get(id), p = est.get(id);
    return { id, pos: p && isNum(p.pos) ? r2d(p.pos) : null, min: m.map(r1), _t: sum(m) };
  }).sort((a, b) => (b._t - a._t) || byId(a.id, b.id));
  const slots = [0, 1, 2, 3, 4].map(k => ({ slot: k + 1, top: list.filter(p => p.min[k] > 0).sort((a, b) => (b.min[k] - a.min[k]) || byId(a.id, b.id)).slice(0, 3).map(p => p.id) }));
  const tot = sum(Array.from(s.min.values()).map(m => sum(m)));
  return { w: FILE_V, team: tid, season: X.season ? X.season.id : null, games: T.gl.length, min: r1(tot), players: list.map(p => ({ id: p.id, pos: p.pos, min: p.min })), slots };
}

/* ================================================================== buildUnit === */
/* input: UnitInput {league, season, store, teams?, rosters?, bios?, withheld?, venues?, homeVenues?, scheduled?, open?, prevPlayers?}
   (anything left out is read from store.ctx). opts: {priors, seed, B = 400, simN = 1000, now, token, mode: 'full'|'update',
   carry, sim (false: no calibration), simOpts, simReuse (a share: the carried calibration is used while the unit has
   grown by less than it since that calibration; the builder between weekly full runs)}.
   -> {wins, fo, clubs: Map team -> club file, pos: Map team -> pos file, carry, warnings, accept, ms} (files packed) */
function buildUnit(input, opts) {
  opts = opts || {};
  const W = WS();
  const t0 = Date.now();
  const store = input.store || emptyStore();
  const token = opts.token || input.token || (store.n + '@' + (store.wm && store.wm.at));
  const X = prepare(Object.assign({}, input, { token }), { seed: opts.seed != null ? opts.seed : fnv(token) });
  const now = opts.now || new Date().toISOString();
  X.mode = opts.mode === 'update' ? 'update' : 'full';
  X.B = opts.B || 400;
  X.wantTrace = !!opts.trace;
  const carry = opts.carry || store.carry || null;
  X.carryIn = carry && carry.ci ? carry.ci : {};
  X.carrySim = carry && carry.sim ? carry.sim : null;
  X.carryOut = X.mode === 'full' ? {} : null;
  X.priors = opts.priors || (store.ctx && store.ctx.priors) || null;
  X.warnings = [];
  X.refYear = new Date(now).getUTCFullYear();
  X.unitKey = (X.league && X.league.id) || '';
  const ciAt = X.mode === 'full' ? now : (carry && carry.at) || store.ci_at || null;
  const out = { wins: null, fo: null, clubs: new Map(), pos: new Map(), mix: null, carry: null, warnings: X.warnings, accept: null, n: X.n, ms: 0 };
  if (X.n < MIN.own) { X.warnings.push('fewer than ' + MIN.own + ' finished games: no league files (pages use the pooled file)'); return out; }
  const parts = assemble(X, opts);
  if (!parts) { X.warnings.push('the competitive four factors could not be fitted'); return out; }
  const hdr = scope => header(X, scope, { token, now, ciAt });
  const wins = Object.assign(hdr('wins'), parts.wins);
  const fo = Object.assign(hdr('fo'), parts.fo);
  /* opts.raw: the files unrounded and untrimmed (the tests compare a full build and an update to 1e-9) */
  const fin = (scope, f) => (opts.raw ? f : fitBudget(scope, f, X.warnings, { budget: opts.budget }));
  out.wins = fin('wins', wins);
  out.fo = fin('fo', fo);
  parts.clubs.forEach((c, tid) => { const f = fin('club', Object.assign(hdr('club'), c)); if (f) out.clubs.set(tid, f); });
  parts.pos.forEach((p, tid) => { out.pos.set(tid, opts.raw ? p : pack(p)); });
  /* A.3: the lineup mixes' file (league files only); integers and rounded rates already, so never packed (4 significant
     figures would move a five's seconds) */
  out.mix = mixFile(X, { token, now, budget: opts.budget });
  out.carry = X.mode === 'full' ? { at: now, ci: X.carryOut, sim: X.simCal ? pack(X.simCal) : null } : carry;
  out.accept = parts.accept;
  out.ms = Date.now() - t0;
  out.timing = X.timing;
  if (opts.trace) out.trace = Object.assign({}, X.trace, { games: X.games.map(g => ({ id: g.id, t: g.t, h: g.h, a: g.a })) });
  void W;
  return out;
}

/* everything a unit's files hold, from the prepared unit (also run on the pooled unit by buildPool) */
function assemble(X, opts) {
  const W = WS(), F = FT();
  const tm = X.timing = {};
  let tl = Date.now();
  const tick = k => { const n = Date.now(); tm[k] = n - tl; tl = n; };
  X.tf = teamFactors(X);
  pregame(X);
  tick('profiles');
  X.predictive = forecast(X, X.priors);
  tick('forecast');
  X.clubs = clubTable(X);
  X.tempoTeams = X.clubs;
  const sigmaPred = X.fc.sigma;
  const G = median(X.teamIds.map(t => X.teams.get(t).gl.length));
  X.G = G;
  const valueOf = (b, sdT, sigmaAcc) => (isNum(b) ? W.valueScale({ b, sdTeam: sdT.net, sigma: sigmaPred, G, sigmaAcc }) : null);
  /* the Explain models */
  const pri = X.priors && X.priors.core ? X.priors.core : null;
  const core = fitModel(X, { name: 'core4c', cols: CORE, y: 'yc', priors: pri, lambda: X.priors && isNum(X.priors.lambda) ? X.priors.lambda : null, oliver: OLIVER, valueOf, hcols: X.hcols });
  if (!core) return null;
  X.sigmaAcc = core.sigma;
  const full = fitModel(X, { name: 'full', cols: FULL4, y: 'y', lambda: 0, B: 0, noBoot: true, hcols: X.hcols });
  const check = fitModel(X, { name: 'check4', cols: CHECK4, y: 'y', lambda: 0, noBoot: true, hcols: X.hcols });
  /* the shot model where zones cover 80% of games */
  let shot = null;
  if (X.quality.zones >= 0.8) {
    const D = design(X, SHOT, { y: 'y', hcols: X.hcols });
    if (D.rows.length >= MIN.own + SHOT.length) {
      const S = W.sumSuff(blockSuffs(D));
      const cols = pruneVif(S, SHOT, D.nh, []);
      shot = fitModel(X, { name: 'shot', cols, y: 'y', valueOf, hcols: X.hcols });
    }
  }
  /* the style set: kept where its bits cover 80% of games, then pruned to VIF 10 beside the core four */
  const cover = k => { const x = X.dx[k]; if (!x) return 0; let c = 0; for (let i = 0; i < X.n; i++) if (isNum(x[i])) c++; return X.n ? c / X.n : 0; };
  let styleKept = STYLE.filter(k => cover(k) >= 0.8);
  if (styleKept.length) {
    const D = design(X, CORE.concat(styleKept), { y: 'yc' });
    if (D.rows.length > CORE.length + styleKept.length + 10) {
      const S = W.sumSuff(blockSuffs(D));
      styleKept = pruneVif(S, CORE.concat(styleKept), 1, CORE).filter(k => !CORE.includes(k));
    } else styleKept = [];
  }
  tick('explain');
  const ep = X.hcols ? { extended: null, path: [] } : extendedAndPath(X, core, styleKept, core.lambda);
  tick('path');
  const scanR = scan(X);
  /* VIFs from the models a factor sits in */
  const vifOf = new Map();
  core.model.coef.forEach(c => vifOf.set(c.k, c.vif));
  if (shot) shot.model.coef.forEach(c => { if (!vifOf.has(c.k)) vifOf.set(c.k, c.vif); });
  scanR.forEach(r => { r.vif = vifOf.has(r.k) ? nn(vifOf.get(r.k)) : null; });
  /* curves: adjusted for the core four and the five leading style factors */
  const styleRank = scanR.filter(r => styleKept.includes(r.k)).sort((a, b) => (Math.abs(b.r) - Math.abs(a.r)) || byId(a.k, b.k)).slice(0, 5).map(r => r.k);
  const adjSet = CORE.concat(styleRank);
  const curvesR = curves(X, adjSet);
  tick('curves');
  const tempoR = tempo(X);
  tick('tempo');
  people(X);
  tick('people');
  const positionsR = positions(X);
  tick('positions');
  const lineupR = lineups(X);
  tick('lineup');
  const feats = squadFeatures(X);
  X.feats = feats;
  const squadR = squad(X, feats);
  /* A.3: the roles against winning, and each position group's statistics in depth */
  const rolesR = roleAnalysis(X, feats);
  positionsR.stats = posStats(X, feats);
  const creationR = creation(X, feats);
  tick('squad');
  const lossesR = causes(X, core);
  tick('causes');
  simInputs(X);
  const simR = simulator(X, opts);
  tick('simulator');
  const cal = simR.cal;
  /* the report's Brier, slope and checks are the held-out (rolling-origin) ones; inSample is the same games scored with
     the parameters fitted on all of them, shown apart and never gated */
  X.predictive.sim = cal && cal.report ? { calibrated: !!cal.report.calibrated, heldOut: !!cal.report.heldOut, brier: cal.report.brier, slope: cal.report.slope, nEval: cal.report.nEval,
    checks: cal.report.checks || {}, inSample: cal.report.inSample || null } : null;
  /* home court */
  let hw = 0, hn = 0;
  X.games.forEach((g, i) => { if (X.h[i] === 1 && X.y[i] !== 0) { hn++; if (X.y[i] > 0) hw++; } });
  const hwi = W.wilson(hw, hn);
  /* the whole home edge: the home side's mean margin at home venues, its interval a block bootstrap (weeks). α in
     core4c is only what is left of it beyond the four factors (most of the edge flows through them) */
  const hmRows = [], hmBy = new Map();
  X.games.forEach((g, i) => { if (X.h[i] === 1 && isNum(X.y[i])) { hmRows.push(X.y[i]); const b = X.blocks[i]; if (!hmBy.has(b)) hmBy.set(b, []); hmBy.get(b).push(X.y[i]); } });
  const hmb = hmRows.length >= MIN.own ? boot(X, 'homeMargin', () => {
    const r = W.rng(seedOf(X, 'homeMargin')), lists = Array.from(hmBy.keys()).sort((a, b) => a - b).map(b => hmBy.get(b)), d = [];
    for (let k = 0; k < X.B && lists.length; k++) { let t = 0, n = 0; for (let j = 0; j < lists.length; j++) { const L = lists[Math.floor(r() * lists.length)]; for (let q = 0; q < L.length; q++) { t += L[q]; n++; } } d.push([n ? t / n : NaN]); }
    const q = pctl(d, 0);
    return { lo: [q[0]], hi: [q[1]] };
  }) : null;
  const homeMargin = hmRows.length ? { v: meanOf(hmRows), lo: hmb ? nn(hmb.lo[0]) : null, hi: hmb ? nn(hmb.hi[0]) : null, n: hmRows.length } : null;
  const metaKeys = scanR.map(r => r.k).concat(Object.keys(curvesR), CORE, FULL4, SHOT, STYLE, LEVERS, ['pace3q', 'c_margin']);
  /* the file blocks: h, the core four and the kept style set, on the competitive margin (league files only) */
  let blocks = null;
  if (!X.hcols) {
    const bc = CORE.concat(styleKept), D = design(X, bc, { y: 'yc' });
    if (D.rows.length >= MIN.own) {
      const list = blockSuffs(D), S = W.sumSuff(list), lam = ep.extended ? null : core.lambda;
      blocks = { keys: ['h'].concat(bc), scale: Array.from({ length: S.p }, (_, k) => (k === 0 ? 1 : rms(S, k))), lambda: lam != null ? lam : (list.length >= 3 ? W.cvLambda(list, { pen: penOf(S, 1) }).lambda : core.lambda),
        list: list.filter(b => b.n >= 8).map(b => ({ n: b.n, sw: b.sw, xx: Array.from(b.xx), xy: Array.from(b.xy), yy: b.yy, sy: b.sy })) };
    }
  }
  const wins = {
    quality: Object.assign({}, X.quality, { listed: X.people.coverage.listed, heights: X.people.coverage.height,
      ok: { zones: X.quality.zones >= 0.8, timed: X.quality.timed >= 0.8, tovTypes: X.quality.stype >= 0.8, foulKinds: X.quality.foulkind >= 0.8 } }),
    meta: metaOf(metaKeys),
    homeWin: { p: hn ? hw / hn : null, lo: hwi[0], hi: hwi[1], n: hn }, homeMargin,
    sigma: { acc: X.sigmaAcc, pred: sigmaPred, src: X.fc.src }, G,
    scan: scanR.map(r => { const o = Object.assign({}, r); delete o.p; return o; }),
    models: { core4c: stripModel(core.model), fullR2: full ? full.model.r2 : null, shot: shot ? stripModel(shot.model) : null, extended: ep.extended ? Object.assign({}, ep.extended, { set: undefined }) : null },
    path: ep.path, predictive: X.predictive, curves: curvesR, tempo: tempoR, positions: positionsR, lineup: lineupR, squad: squadR, roles: rolesR, creation: creationR, losses: lossesR,
    blocks, leagues: null
  };
  /* the Front office file */
  const lgF = F.seasonFactors(X.games.flatMap(g => [{ own: g.F[0], opp: g.F[1], qOwn: g.q[0], qOpp: g.q[1] }, { own: g.F[1], opp: g.F[0], qOwn: g.q[1], qOpp: g.q[0] }]));
  X.lgF = lgF;
  const value = {};
  const addValue = (k, b, lo, hi, model) => {
    const x = fac().get(k);
    if (!x || !isNum(b)) return;
    value[k] = { b, lo: nn(lo), hi: nn(hi), model, dir: x.dir, unit: x.unit, sdTeam: (({ off, def, net }) => ({ off, def, net }))(sdTeamOf(X, k)),
      lg: lgF[k] ? nn(lgF[k].v) : null, p25: teamPctl(X, k, 0.25), p50: teamPctl(X, k, 0.5), p75: teamPctl(X, k, 0.75) };
  };
  core.model.coef.forEach(c => addValue(c.k, c.b, c.lo, c.hi, 'core4c'));
  LEVERS.forEach(k => {
    const sc = shot && shot.model.coef.find(c => c.k === k);
    if (sc) { addValue(k, sc.b, sc.lo, sc.hi, 'shot'); return; }
    const pp = (ep.path || []).find(p => p.k === k);
    /* time of possession is valued by its DIRECT effect only (§7.10.4): its path through the factors runs largely
       through offensive rebounds, which its own clock contains (a possession's second chances), so the total would
       sell a definitional channel as a lever */
    if (pp && k === 'top_avg') { if (pp.direct && isNum(pp.direct.v)) addValue(k, pp.direct.v, pp.direct.lo, pp.direct.hi, 'path:direct'); }
    else if (pp) addValue(k, pp.total.v, pp.total.lo, pp.total.hi, 'path');
  });
  if (X.pooled) return { wins, fo: null, clubs: new Map(), pos: new Map(), accept: acceptOf(X, core, full, check, wins), core };
  const S = SIM();
  const profs = new Map(X.teamIds.map(t => [t, profileOf(X, t, null)]));
  const teamsF = X.teamIds.map(tid => {
    const T = X.teams.get(tid), c = X.clubs.get(tid), tf = X.tf.get(tid), pr = profs.get(tid), f = {};
    Object.keys(value).forEach(k => { f[k] = { off: tf.off[k] ? nn(tf.off[k].v) : null, def: tf.def[k] ? nn(tf.def[k].v) : null }; });
    return { id: tid, name: T.name, short: T.short, colour: T.colour, logo: T.logo, gp: c.gp, w: c.w, l: c.l, net: c.net, ortg: c.ortg, drtg: c.drtg,
      pace3q: c.pace3q, pyth: c.pyth, elo: c.elo, prof: { off: pr.off, def: pr.def, n: pr.n }, f };
  });
  void S;
  const L = simR.L;
  const homeEdge = X.fc.fit ? X.fc.fit.b[0] : core.model.home.v;
  const posMap = new Map();
  X.teamIds.forEach(tid => { const p = posFile(X, tid); if (p) posMap.set(tid, p); });
  const fo = {
    lg: { rates: L.rates, T: L.T, Tot: L.Tot, kappaN: L.kappaN, sigmaN: L.sigmaN, hca: L.hca, tau: L.tau, muOff: L.muOff, dTr: L.dTr, lead: L.lead, tripOff: L.tripOff || 0, ft3: L.ft3,
      fouling: L.fouling !== false, zones: !!L.zones, G, homeEdge: nn(homeEdge) },
    sim: { calibrated: !!(cal && cal.report && cal.report.calibrated), platt: cal ? cal.platt || null : null, brier: cal && cal.report ? nn(cal.report.brier) : null, slope: cal && cal.report ? nn(cal.report.slope) : null },
    sigmaPred, predLive: !!X.fc.live, value, teams: teamsF,
    slots: positionsR.p1.length || positionsR.p2.length ? { stats: X.p2Stats || ['bpm'].concat(P1_STATS), p1: positionsR.p1, targets: positionsR.p2, forecast: positionsR.p2f } : null,
    squad: squadR, lineup: lineupR, pos: Object.fromEntries(Array.from(posMap.entries())),
    /* A.3: how a role is earned in this league-season (the Front office's squad block names its players' roles) */
    roles: rolesR ? { cuts: rolesR.cuts, tagged: rolesR.tagged } : null,
    /* 2026-10-07: each position group's league line on every POS_STATS stat, [mean, SD, the winners' (top quarter by net)
       mean, wins over 30 games for one SD more, ★] (posLgOf); a club's own sits in its club file's posv */
    posLg: posLgOf(X),
    /* 2026-10-07: the creators' (ball handlers and high-usage players) share of the plays and their efficiency, the league's */
    creation: creationR ? creationR.stats : null
  };
  const clubs = new Map();
  X.teamIds.forEach(tid => { const c = clubFile(X, tid, value, positionsR, posMap.get(tid)); if (c) clubs.set(tid, c); });
  tick('files');
  return { wins, fo, clubs, pos: posMap, accept: acceptOf(X, core, full, check, wins), core };
}
/* the §16 live acceptance numbers, for the job summary */
function acceptOf(X, core, full, check, wins) {
  const cal = X.simCal;
  const shareEfg = (() => { const sh = core.model.shares, t = sum(sh.map(s => s.phi)); const e = sh.find(s => s.k === 'c_efg'); return e && t ? 100 * e.phi / t : null; })();
  const nh = X.hcols ? X.hcols(0).length : 1;
  return { n: X.n, r2full: full ? full.model.r2 : null,
    check4: check ? Object.fromEntries(CHECK4.map(k => [k, check.fit.b[nh + CHECK4.indexOf(k)]]).concat([['r2', check.model.r2], ['home', nh === 1 ? check.fit.b[0] : null]])) : null,
    efgShare: shareEfg, efgLegacy: core.model.legacy ? core.model.legacy.c_efg : null, efgPhi: (core.model.shares.find(s => s.k === 'c_efg') || {}).phi, homeWin: wins.homeWin.p, sigmaAcc: X.sigmaAcc, sigmaPred: X.fc.sigma,
    brier: X.predictive.metrics.brier, brierHome: X.predictive.baselines.home.brier, brierElo: X.predictive.baselines.elo.brier, logloss: X.predictive.metrics.logloss,
    slope: X.predictive.metrics.slope, nEval: X.predictive.nEval, live: X.predictive.live,
    sim: cal && cal.report ? { calibrated: !!cal.report.calibrated, brier: cal.report.brier, logloss: cal.report.logloss, slope: cal.report.slope, checks: cal.report.checks } : null };
}
const stripModel = m => Object.assign({}, m, { coef: m.coef.map(c => { const o = Object.assign({}, c); delete o.bOwn; return o; }) });

/* THE GAME REPORT'S WEIGHTS (Louie, 2026-10-07: the match reports explain a result by what wins in its league). From a
   league-season's wins file, its Explain model (core4c: margin = alpha h + Σ b Δ(competitive eFG%, TOV%, OREB%, FTA/FGA),
   each b in points of margin for one percentage point of difference between the sides): {v, league, season, built, n,
   home, b: {efg, tovp, orebp, ftr}, lo, hi, sigma}. Four numbers a league and no club's: the builder publishes it beside
   the teaser (snapshots/whatwins-explain/<league>.json) for the game page and the finalise function, which read it
   without a member's token. null without all four */
function explainOf(wins, o) {
  o = o || {};
  const m = wins && wins.models && wins.models.core4c;
  if (!m || !Array.isArray(m.coef)) return null;
  const b = {}, lo = {}, hi = {};
  CORE.forEach(k => { const c = m.coef.find(x => x.k === k); if (c && isNum(c.b)) { const kk = k.replace(/^c_/, ''); b[kk] = Math.round(1e4 * c.b) / 1e4; lo[kk] = isNum(c.lo) ? Math.round(1e4 * c.lo) / 1e4 : null; hi[kk] = isNum(c.hi) ? Math.round(1e4 * c.hi) / 1e4 : null; } });
  if (Object.keys(b).length < CORE.length) return null;
  return { v: 1, league: o.league || null, season: o.season || null, built: o.now || null, n: wins.n && isNum(wins.n.games) ? wins.n.games : null,
    home: m.home && isNum(m.home.v) ? r2d(m.home.v) : null, b, lo, hi, sigma: wins.sigma && isNum(wins.sigma.acc) ? r2d(wins.sigma.acc) : null };
}

/* a club's positional lines (clubFile posv) and the league's (fo posLg): arrays aligned with POS_STATS, two decimals */
const r2n = v => (isNum(v) ? Math.round(100 * v) / 100 : null);
function posvOf(X, tid) {
  const W = WS(), PV = X.posVal, mine = PV && PV.val.get(tid);
  if (!mine) return null;
  const out = { stats: POS_STATS.slice() };
  GROUPS3.forEach(g => {
    out[g] = POS_STATS.map(k => {
      const v = mine[g] ? mine[g][k] : null, cell = PV.cells.find(c => c.g === g && c.k === k);
      if (!cell || !isNum(v)) return null;
      const z = cell.sd > 0 ? (v - cell.avg) / cell.sd : null;
      const w = isNum(z) && isNum(cell.b) ? 30 * (W.normCdf(z * cell.b * PV.pace / 100 / PV.sigma) - 0.5) : null;
      return [r2n(v), r2n(z), r2n(w)];
    });
  });
  return out;
}
function posLgOf(X) {
  const PV = X.posVal;
  if (!PV) return null;
  const out = { stats: POS_STATS.slice() };
  GROUPS3.forEach(g => {
    out[g] = POS_STATS.map(k => { const c = PV.cells.find(x => x.g === g && x.k === k); return c ? [r2n(c.avg), r2n(c.sd), r2n(c.top), r2n(c.w30), c.star ? 1 : 0] : null; });
  });
  return out;
}

/* one club's file: its games split, its losses, its realised rates, its squad, slots, lineups and players */
function clubFile(X, tid, value, positionsR, pos) {
  const W = WS(), S = SIM(), T = X.teams.get(tid), P = X.people;
  if (!T || !T.gl.length) return null;
  const games = [], losses = [];
  let factorW = 0;
  const realised = {};
  T.gl.forEach(([i, s]) => {
    const g = X.games[i], c = X.pre[i].cause, sg = s ? -1 : 1, opp = s ? g.h : g.a;
    /* two decimals, `other` the remainder: m = xm + Σ parts holds in the file as written, not only before rounding */
    const parts = {}, m = sg * X.y[i], xm = r2d(sg * c.expected);
    PART_KEYS.forEach(k => { parts[k] = r2d(sg * c.parts[k]); });
    parts.other = r2d(m - xm - sum(PART_KEYS.filter(k => k !== 'other').map(k => parts[k])));
    const row = { g: g.id, d: g.d, opp, h: X.h[i] ? (s ? -1 : 1) : 0, m, mc: isNum(X.yc[i]) ? sg * X.yc[i] : m, xm, parts, luck: isNum(c.luck) ? r2d(sg * c.luck) : null };
    games.push(row);
    if (row.m < 0) losses.push([row.xm].concat(PART_KEYS.map(k => parts[k])));
    factorW += W.normCdf(sg * c.fitM / (X.sigmaAcc || 4));
  });
  /* the realised rates of the club's last ten defeats: what the loss Shapley (§8.4) replays */
  const rr = e => { const v = S.ratesOf(e); S.RATES.forEach(k => { if (!isNum(v[k])) v[k] = X.lgRates[k]; }); return v; };
  T.gl.filter(([i, s]) => (s ? -1 : 1) * X.y[i] < 0).slice(-10).forEach(([i, s]) => { realised[X.games[i].id] = { own: rr(X.ein[i][s]), opp: rr(X.ein[i][1 - s]) }; });
  const keys = ['expected'].concat(PART_KEYS);
  const est = keys.map((_, j) => meanOf(losses.map(r => r[j])));
  const bs = boot(X, 'club:' + tid + ':losses', () => {
    const r = W.rng(seedOf(X, 'club:' + tid)), d = [];
    for (let b = 0; b < X.B && losses.length; b++) { const m = new Array(keys.length).fill(0); for (let j = 0; j < losses.length; j++) { const row = losses[Math.floor(r() * losses.length)]; row.forEach((v, q) => { m[q] += v; }); } d.push(m.map(v => v / losses.length)); }
    return { lo: keys.map((_, j) => pctl(d, j)[0]), hi: keys.map((_, j) => pctl(d, j)[1]) };
  });
  const c = X.clubs.get(tid);
  const feats = X.feats.get(tid) || null, squadOut = {};
  SQUAD_KEYS.forEach(k => { squadOut[k] = feats ? nn(feats[k]) : null; });
  /* slots: the club's group lines against the league and the winners' targets; sd is the team-season spread the z
     uses, so the Front office values a gap in SDs exactly instead of working it back out of z */
  const tg = X.teamG && X.teamG.get(tid), slots = {};
  GROUPS3.forEach((g, k) => {
    slots[g] = {};
    (X.p2Stats || ['bpm'].concat(P1_STATS)).forEach(st => {
      const all = Array.from(X.teamG.values()).map(t => t.g[k][st]);
      const v = tg ? tg.g[k][st] : null, m = meanOf(all), sd = sdReal(all);
      const tgt = (positionsR.p2 || []).find(x => x.g === g && x.stat === st);
      slots[g][st] = { v: nn(v), z: isNum(v) && sd > 0 ? (v - m) / sd : null, target: tgt ? tgt.top : null, sd: sd > 0 ? sd : null };
    });
  });
  /* posv (2026-10-07): the club's line at each position group (G, F, C) on every POS_STATS stat (posv.stats), as
     [value, z against the league's clubs, wins over 30 games the gap is worth by that stat's association with net there
     (the cell's b)], null where the club has no line; the league's side of it (mean, SD, the winners' line, ★) is the fo
     file's posLg, once. The Front office reads its positional gaps from it, not the four factors alone */
  const posv = posvOf(X, tid);
  /* the club's ten most used fives, with their real net and the model's value of their make-up */
  const fives = new Map();
  (X.luRaw || []).filter(r => r.tid === tid).forEach(r => {
    const k = r.ids.slice().sort().join(',');
    if (!fives.has(k)) fives.set(k, { ids: r.ids.slice().sort(), c: r.c, poss: 0, net: 0 });
    const f = fives.get(k); f.poss += r.poss; f.net += r.net;
  });
  const lu = X.lu;
  const lineupsOut = Array.from(fives.values()).filter(f => !f.ids.some(id => P.withheld.has(String(id))))
    .sort((a, b) => (b.poss - a.poss) || byId(a.ids.join(), b.ids.join())).slice(0, 10).map(f => {
      const x = luRow(f.c), xr = lu ? lu.ref : null;
      const pred = lu ? x.reduce((a, v, j) => a + lu.b[j] * (v - (j === 7 ? (X.bpmMean || 0) : xr[j])), 0) : null;
      return { ids: f.ids, s: f.c.sh, b: bigClass(f.c.bg), poss: f.poss, net: f.poss ? 100 * f.net / f.poss : null, pred };
    });
  const players = P.rows.filter(p => p.team === tid && p.min > 0 && !P.withheld.has(String(p.id))).sort((a, b) => (b.min - a.min) || byId(a.id, b.id))
    .map(p => ({ id: p.id, g: p.group, v: p.v, min: p.min, bpm: nn(p.bpmRaw), roles: p.roles }));
  return {
    team: { id: tid, name: T.name },
    record: { w: c.w, l: c.l, pythW: isNum(c.pyth) ? c.pyth * c.gp : null, factorW },
    games,
    losses: { n: losses.length, mean: keys.map((k, j) => ({ k, pts: nn(est[j]), lo: bs ? nn(bs.lo[j]) : null, hi: bs ? nn(bs.hi[j]) : null })) },
    realised, squad: squadOut, squadCoverage: { height: feats ? nn(feats._cov.height) : null, age: feats ? nn(feats._cov.age) : null },
    slots, posv, creation: creationOf(X, tid), lineups: lineupsOut, players, pos: pos || null
  };
}

/* ================================================================== THE POOLED UNIT AND THE PRIORS (§7.4) === */
/* several units' stores as one decoded unit; games tagged with their league */
function mergeInputs(inputs) {
  const games = [], pgs = [], stints = [], players = [], pAt = new Map(), comps = [];
  const ctx = { teams: [], rosters: [], bios: {}, withheld: [], venues: {}, homeVenues: {}, prev: {} };
  const leagues = [];
  (inputs || []).forEach(inp => {
    const st = inp.store, W = decodeFull(st), c = Object.assign({}, st.ctx || {}, inp);
    const L = inp.league || c.league || { id: st.league };
    leagues.push(L);
    const off = games.length;
    W.games.forEach(g => { g.league = L.id; games.push(g); });
    const map = W.players.map(id => { if (!pAt.has(id)) { pAt.set(id, players.length); players.push(id); } return pAt.get(id); });
    W.pgs.forEach(r => pgs.push(Object.assign({}, r, { g: r.g + off, p: map[r.p] })));
    W.stints.forEach(r => stints.push(Object.assign({}, r, { g: r.g + off, p: r.p.map(i => (i >= 0 ? map[i] : -1)) })));
    (c.teams || []).forEach(t => ctx.teams.push(t));
    (c.rosters || []).forEach(t => ctx.rosters.push(t));
    Object.assign(ctx.bios, c.bios || {}); Object.assign(ctx.venues, c.venues || {}); Object.assign(ctx.homeVenues, c.homeVenues || {}); Object.assign(ctx.prev, c.prev || {});
    (c.withheld ? Array.from(c.withheld) : []).forEach(x => ctx.withheld.push(x));
    comps.push(...W.comps);
  });
  /* tip-off order across leagues */
  const order = games.map((g, i) => i).sort((a, b) => (games[a].t - games[b].t) || byId(games[a].id, games[b].id));
  const at = new Int32Array(games.length);
  order.forEach((o, i) => { at[o] = i; });
  return { W: { games: order.map(i => games[i]), players, comps, pgs: pgs.map(r => Object.assign(r, { g: at[r.g] })), stints: stints.map(r => Object.assign(r, { g: at[r.g] })) }, ctx, leagues };
}
/* buildPool(inputs: every league's newest season, open: Set of league ids, opts) -> {wins, priors, warnings, accept} */
function buildPool(inputs, open, opts) {
  opts = opts || {};
  const W = WS();
  const openSet = open instanceof Set ? open : new Set(open || []);
  const M = mergeInputs(inputs);
  const now = opts.now || new Date().toISOString();
  const token = opts.token || poolToken(inputs.map(i => i.token || (i.store.n + '@' + (i.store.wm && i.store.wm.at))), openSet);
  const input = { store: { ctx: M.ctx, n: M.W.games.length, wm: null }, decoded: M.W, league: null, season: null, teams: M.ctx.teams };
  const X = prepareDecoded(input, M.W, { seed: opts.seed != null ? opts.seed : fnv(token) });
  X.mode = 'full'; X.B = opts.B || 400; X.carryIn = {}; X.carryOut = {}; X.priors = null; X.warnings = []; X.refYear = new Date(now).getUTCFullYear();
  X.pooled = true;
  /* α per league, blocks within leagues */
  const lids = Array.from(new Set(X.games.map(g => g.league))).sort(byId), lAt = new Map(lids.map((l, i) => [l, i]));
  const leagueOf = X.games.map(g => g.league);
  X.hcols = i => { const v = new Array(lids.length).fill(0); v[lAt.get(leagueOf[i])] = X.h[i]; return v; };
  X.hLeague = i => lAt.get(leagueOf[i]);
  const blk = new Array(X.n);
  let base = 0;
  lids.forEach(l => {
    const idx = []; X.games.forEach((g, i) => { if (g.league === l) idx.push(i); });
    const b = blocksOf(idx.map(i => X.games[i]));
    idx.forEach((i, j) => { blk[i] = base + b[j]; });
    base += (b.length ? Math.max(...b) + 1 : 0);
  });
  X.blocks = blk;
  const blockLeague = new Map();
  X.games.forEach((g, i) => blockLeague.set(blk[i], g.league));
  X.strataOf = b => lAt.get(blockLeague.get(b)) || 0;
  X.leagueOfTeam = new Map();
  X.games.forEach(g => { X.leagueOfTeam.set(g.h, g.league); X.leagueOfTeam.set(g.a, g.league); });
  const parts = assemble(X, Object.assign({}, opts, { sim: false }));
  if (!parts) return { wins: null, priors: null, warnings: X.warnings.concat(['the pooled core model could not be fitted']), accept: null };
  const core = parts.core, lambda = core.lambda, p = lids.length + CORE.length;
  const nOf = l => X.games.filter(g => g.league === l).length;
  const alphaPool = sum(lids.map((l, j) => core.fit.b[j] * nOf(l))) / (X.n || 1);
  const bPool = { h: alphaPool };
  CORE.forEach((k, c) => { bPool[k] = core.fit.b[lids.length + c]; });
  /* each league alone at the pooled lambda */
  const own = new Map();
  lids.forEach(l => {
    if (nOf(l) < MIN.own) return;
    const D = design(X, CORE, { y: 'yc', only: i => leagueOf[i] === l });
    if (D.rows.length < MIN.own) return;
    const blocks = blockSuffs(D), S = W.sumSuff(blocks), pen = penOf(S, 1), fit = W.ridge(S, { lambda, pen });
    if (!fit) return;
    own.set(l, { b: fit.b, V: covOf(blocks, fit, S), n: S.n });
  });
  const keys = ['h'].concat(CORE), tau2 = {};
  keys.forEach((k, j) => {
    const est = Array.from(own.values()).filter(o => o.n >= 50).map(o => ({ b: o.b[j], v: o.V[j * 5 + j] }));
    /* DerSimonian-Laird over leagues of 50 games or more; fewer than 4 of them: (0.25 β_pool)². DL at 0 (the leagues
       differ by no more than their noise) means full pooling: a floor of (0.01 β_pool)² only keeps the algebra finite */
    tau2[k] = est.length >= 4 ? W.dersimonianLaird(est) : Math.pow(0.25 * bPool[k], 2);
    const floor = Math.max(Math.pow(0.01 * bPool[k], 2), 1e-8);
    if (!(tau2[k] > floor)) tau2[k] = est.length >= 4 ? floor : Math.max(Math.pow(0.25 * bPool[k], 2), floor);
  });
  /* the league table: open leagues only (I5) */
  const meta = new Map((inputs || []).map(inp => { const L = inp.league || (inp.store.ctx && inp.store.ctx.league) || { id: inp.store.league }; return [L.id, L]; }));
  const leagues = [];
  lids.filter(l => openSet.has(l)).forEach(l => {
    const L = meta.get(l) || { id: l }, o = own.get(l), n = nOf(l);
    let post = null;
    if (o) { try { post = W.ebPosterior(o.b, o.V, keys.map(k => bPool[k]), keys.map(k => tau2[k])); } catch (_) { post = null; } }
    const seOf = (V, j) => Math.sqrt(Math.max(0, V[j * 5 + j]));
    const top = scanTop(X, i => leagueOf[i] === l);
    leagues.push({ id: l, slug: L.slug || '', name: L.name || '', n,
      home: o ? ci(o.b[0], o.b[0] - 1.96 * seOf(o.V, 0), o.b[0] + 1.96 * seOf(o.V, 0)) : ci(core.fit.b[lAt.get(l)], null, null), top,
      coef: CORE.map((k, c) => {
        const j = c + 1;
        const ownCI = o && n >= MIN.own ? ci(o.b[j], o.b[j] - 1.96 * seOf(o.V, j), o.b[j] + 1.96 * seOf(o.V, j)) : null;
        const eb = post ? ci(post.b[j], post.b[j] - 1.96 * Math.sqrt(Math.max(0, post.V[j * 5 + j])), post.b[j] + 1.96 * Math.sqrt(Math.max(0, post.V[j * 5 + j]))) : ci(bPool[k], null, null);
        return { k, own: ownCI, eb, w: post ? post.w[j] : 1 };
      }) });
  });
  /* league-out transfer: each league with 50 games or more predicted from a fit on the others */
  const transfer = [];
  const withKm = X.fc.withKm;
  lids.filter(l => openSet.has(l) && nOf(l) >= 50).forEach(l => {
    const tr = [], ty = [], te = [];
    for (let i = 0; i < X.n; i++) {
      if (!isNum(X.y[i]) || !(X.pre[i].n[0] >= 1 && X.pre[i].n[1] >= 1)) continue;
      const r = fcRow(X, i, withKm);
      if (!r.every(isNum)) continue;
      if (leagueOf[i] === l) { if (X.pre[i].n[0] >= MIN.test && X.pre[i].n[1] >= MIN.test && X.y[i] !== 0) te.push([r, X.y[i]]); }
      else { tr.push(r); ty.push(X.y[i]); }
    }
    if (tr.length < 30 || !te.length) return;
    const S = W.suff(tr, ty), fit = W.ridge(S, { lambda: X.fc.lambda, pen: penOf(S, 1) });
    if (!fit) return;
    const sig = Math.sqrt(fit.rss / Math.max(1, S.n - fit.b.length));
    const ps = te.map(([r]) => W.normCdf(r.reduce((a, v, k) => a + v * fit.b[k], 0) / sig)), ys = te.map(([, y]) => (y > 0 ? 1 : 0));
    transfer.push({ id: l, n: te.length, brier: W.calibration(ps, ys).brier });
  });
  const wins = Object.assign(header(X, 'wins', { token, now, ciAt: now }), parts.wins);
  wins.league = null; wins.season = null; wins.blocks = null; wins.leagues = leagues;
  wins.predictive.transfer = transfer;
  /* clubs of open leagues only in the tempo table (I5) */
  if (wins.tempo && Array.isArray(wins.tempo.teams)) wins.tempo.teams = wins.tempo.teams.filter(t => openSet.has(X.leagueOfTeam.get(t.id)));
  /* the priors every league file is shrunk toward */
  const p2z = {};
  if (X.teamG) {
    GROUPS3.forEach((g, k) => {
      p2z[g] = {};
      ['bpm'].concat(P1_STATS, ['min_share']).forEach(st => {
        const zs = [];
        lids.forEach(l => {
          const ts = Array.from(X.teamG.values()).filter(t => X.leagueOfTeam.get(t.id) === l && isNum(t.net));
          const vals = ts.map(t => t.g[k][st]), m = meanOf(vals), sd = sdReal(vals);
          if (!(sd > 0) || ts.length < 4) return;
          ts.sort((a, b) => b.net - a.net).slice(0, Math.max(1, Math.ceil(ts.length / 4))).forEach(t => { if (isNum(t.g[k][st])) zs.push((t.g[k][st] - m) / sd); });
        });
        p2z[g][st] = zs.length ? meanOf(zs) : null;
      });
    });
  }
  const forecastB = X.fc.fit ? Object.fromEntries(X.fc.cols.map((k, j) => [k, X.fc.fit.b[j]])) : null;
  const priors = pack({ v: 1, built: now, token, lambda, core: { beta: bPool, tau2 }, sigmaPred: X.fc.sigma, forecast: forecastB, split: X.split,
    squad: wins.squad ? { n: wins.squad.n, power: wins.squad.power, coef: wins.squad.coef, adj: wins.squad.adj, pd: wins.squad.pd } : null, p2z, n: X.n, leagues: lids.length });
  return { wins: fitBudget('wins', wins, X.warnings), priors, warnings: X.warnings, accept: parts.accept };
}
/* the leading factors (by |r| with winning) over some of the games */
function scanTop(X, only) {
  const W = WS(), out = [];
  diffKeys().forEach(k => {
    const x = X.dx[k];
    if (!x || fac().get(k).score) return;
    const xs = [], ws = [];
    for (let i = 0; i < X.n; i++) if (only(i) && isNum(x[i]) && X.w[i] != null) { xs.push(x[i]); ws.push(X.w[i]); }
    if (xs.length < MIN.own) return;
    const r = W.pearson(xs, ws);
    if (r != null) out.push([k, (dirOf(k) === -1 ? -1 : 1) * r]);
  });
  return out.sort((a, b) => (b[1] - a[1]) || byId(a[0], b[0])).slice(0, 3).map(x => x[0]);
}
/* the pooled token (§6.1): the games and the newest line, an FNV of the units' tokens and of the open set */
function poolToken(tokens, open) {
  const ts = (tokens || []).slice().sort();
  const n = sum(ts.map(t => parseInt(t, 10) || 0)), at = ts.map(t => String(t).split('@')[1] || '').sort().pop() || '';
  return n + '@' + at + '@u' + (fnv(ts.join('|')) >>> 0).toString(16) + '@o' + (fnv(Array.from(open || []).sort().join(',')) >>> 0).toString(16);
}
/* prepare() over an already decoded (merged) unit */
function prepareDecoded(input, W, opts) {
  const fake = { F: '', ctx: input.store.ctx, n: W.games.length, wm: { at: '', id: '' } };
  const X = prepare(Object.assign({}, input, { store: fake }), opts);
  return X;
}

/* ================================================================== THE TEASER (public, box score only) === */
const TEASER_MAP = { efg: 'efg', tovp: 'tovp', orebp: 'orebp', ftr: 'ftr', ts: 'ts', p3p: 'p3p', rimp: 'rimp', ftp: 'ftp', p3r: 'p3r', rimr: 'rimr',
  astp: 'astp', stlp: 'stlp', blkp: 'blkp', paint: 'paint', fast: 'fast', sc: 'second', pot: 'offto', bench: 'bench' };
/* buildTeaser(inputs, open, opts) -> Teaser: EpinoiaWinning's analysis on the PUBLIC_KEYS values of the open leagues'
   games, every share in [0, 1] */
function buildTeaser(inputs, open, opts) {
  opts = opts || {};
  const Fm = FT(), Wn = WINNING();
  const openSet = open instanceof Set ? open : new Set(open || []);
  const games = [], tgs = [];
  (inputs || []).forEach(inp => {
    const L = inp.league || (inp.store.ctx && inp.store.ctx.league) || { id: inp.store.league };
    if (!openSet.has(L.id)) return;
    decodeFull(inp.store).games.forEach(g => {
      games.push({ id: g.id, home_score: g.hs, away_score: g.as, league: { id: L.id, slug: L.slug || '', name: L.name || '' } });
      [0, 1].forEach(s => {
        const d = Fm.derive(g.F[s], g.F[1 - s], g.q[s], g.q[1 - s]), row = { game_id: g.id, team_idx: s };
        Object.keys(TEASER_MAP).forEach(m => { const v = d[TEASER_MAP[m]]; row[m] = isNum(v) ? v : null; });
        tgs.push(row);
      });
    });
  });
  const list = Wn.rows(games, tgs), a = Wn.analyse(list), M = fac();
  const lab = k => (M.get(TEASER_MAP[k]) || {}).label || k;
  const share = v => (isNum(v) ? v / 100 : null);
  const out = { w: FILE_V, scope: 'teaser', token: opts.token || '', built: opts.now || new Date().toISOString(), n: a.n, homeWin: share(a.homeWin),
    ranked: a.ranked.map(m => ({ k: TEASER_MAP[m.k], label: lab(m.k), r: m.r, winRate: share(m.winRate) })),
    factors: a.factors ? { r2: a.factors.r2, home: a.factors.home, shares: a.factors.weights.map(x => ({ k: TEASER_MAP[x.k], share: x.share / 100, oliver: x.oliver / 100 })) } : null,
    leagues: Wn.byLeague(list, MIN.own).map(l => ({ slug: l.league.slug, name: l.league.name, n: l.n,
      top: l.top ? { k: TEASER_MAP[l.top.k], label: lab(l.top.k), r: l.top.r, winRate: share(l.top.winRate) } : null, homeWin: share(l.homeWin) })) };
  return pack(out);
}

/* ================================================================== update (A.2, RECALCULATE) === */
/* update(store, delta = {rows, games, pgs, stints}, opts = {now, league, season}) -> {store, files: {wins, fo, club, pos}, token}.
   The delta joins the store; every point estimate is worked out again on the union exactly as a full build would;
   intervals and the simulator's calibration are those of the last full build (ci_at). */
/* opts: {now, raw, withheld: [player ids] (the database's minors without consent, read by the caller for every player
   the unit names: added to the store's context, so a player who debuts in the delta, or a consent withdrawn since the
   last full build, is left out of every file)}. -> {store, files, token, changed: [team ids in the delta's games]} */
function update(store, delta, opts) {
  opts = opts || {};
  const d = delta || {};
  /* a store of an older layout is the builder's to rebuild from nothing: folding a delta into it would leave its older
     games without the newer columns for good (A.3). The caller queues the unit instead */
  if (store && store.v != null && +store.v !== STORE_V) return { store: null, files: {}, token: null, changed: [], stale: true };
  const next = storeAdd(store, d.rows || [], d.games || [], d.pgs || [], d.stints || [], { kinds: (store && store.ctx && store.ctx.kinds) || {} });
  next.carry = store && store.carry ? store.carry : null;
  next.ci_at = store && store.ci_at ? store.ci_at : null;
  if (Array.isArray(opts.withheld) && opts.withheld.length) {
    const ctx = Object.assign({}, next.ctx || {});
    ctx.withheld = Array.from(new Set((ctx.withheld || []).concat(opts.withheld.map(String)))).sort();
    next.ctx = ctx;
  }
  const changed = Array.from(new Set((d.games || []).flatMap(g => [g && g.home_team_id, g && g.away_team_id]).filter(Boolean))).sort();
  const token = next.n + '@' + (next.wm && next.wm.at);
  const files = {};
  if (next.n >= MIN.own) {
    const r = buildUnit(inputFromStore(next), { mode: 'update', now: opts.now, token, priors: next.ctx && next.ctx.priors, carry: next.carry, raw: !!opts.raw });
    if (r.wins) files.wins = r.wins;
    if (r.fo) files.fo = r.fo;
    if (r.clubs.size) files.club = Object.fromEntries(r.clubs.entries());
    if (r.pos.size) files.pos = Object.fromEntries(r.pos.entries());
    if (r.mix) files.mix = r.mix;
  }
  return { store: next, files, token, changed };
}
/* a UnitInput from a store and the context it carries */
function inputFromStore(store) {
  const c = (store && store.ctx) || {};
  return { league: c.league || (store.league ? { id: store.league } : null), season: c.season || (store.season ? { id: store.season } : null), store,
    teams: c.teams || [], rosters: c.rosters || [], bios: c.bios || {}, withheld: new Set(c.withheld || []), venues: c.venues || {}, homeVenues: c.homeVenues || {},
    scheduled: c.scheduled || [], open: !!c.open, prevPlayers: c.prev || null };
}

/* ================================================================== synthUnit (tests and the sample files) === */
/* A league with planted truth, as the builder would hand it over: a store of feature lines, player lines and stints,
   and its context. Truth: the competitive margin is alpha h + Σ beta_k Δx_k + ε; transition frequency raises eFG
   (an indirect effect through the shooting factor); every extra shooter in a five adds `shooter` points per 100. */
function synthUnit(o) {
  o = o || {};
  const W = WS(), Fm = FT(), I = Fm.INDEX, N = Fm.N, Q = Fm.QBITS;
  const seed = o.seed != null ? o.seed : 1, nT = o.teams || 12, nG = o.games || 132, zones = o.zones !== false;
  const rand = W.rng(seed), nz = () => W.normal(rand), un = () => rand();
  const truth = Object.assign({ alpha: 2.5, beta: { c_efg: 1.6, c_tovp: -1.2, c_orebp: 0.45, c_ftr: 0.3 }, sigma: 4, trEfg: 30, shooter: 4 }, o.truth || {});
  const hex = (tag, n) => { let s = ''; let k = 0; while (s.length < n) { s += (fnv(seed + ':' + tag + ':' + k++) >>> 0).toString(16).padStart(8, '0'); } return s.slice(0, n); };
  const uuid = tag => hex(tag, 8) + '-' + hex(tag + 'b', 4) + '-4' + hex(tag + 'c', 3) + '-a' + hex(tag + 'd', 3) + '-' + hex(tag + 'e', 12);
  const league = o.league || { id: uuid('league'), slug: 'synth-' + seed, name: 'Synthetic League ' + seed };
  const season = o.season || { id: uuid('season'), name: '2026-27' };
  const comp = uuid('comp');
  const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
  const teams = [], players = [], rosters = [], bios = {}, venues = {}, withheld = [];
  for (let t = 0; t < nT; t++) {
    const id = uuid('team' + t), v = uuid('venue' + t);
    venues[v] = [50 + 2 * un(), 5 + 3 * un()];
    teams.push({ id, name: 'Synth Club ' + (t + 1), short_name: 'SC' + (t + 1), colour: '#' + hex('col' + t, 6), logo_path: null, home_venue_id: v,
      lat: { efg: 2.5 * nz(), tov: 1.8 * nz(), orb: 3.5 * nz(), ftm: 3 * nz(), tr: 0.04 * nz(), pace: 2 * nz() },
      dl: { efg: 2.5 * nz(), tov: 1.8 * nz(), orb: 3.5 * nz(), ftm: 3 * nz() }, venue: v, roster: [] });
    for (let k = 0; k < 12; k++) {
      const slot = k < 10 ? k % 5 : 2 + (k % 3), pid = uuid('p' + t + ':' + k);
      const shooter = slot <= 2 && un() < 0.55;
      const pl = { id: pid, team: id, slot, starter: k < 5, deep: k >= 10, shooter, p3: shooter ? 0.38 + 0.03 * nz() : 0.3 + 0.03 * nz() };
      players.push(pl); teams[t].roster.push(pl);
      const h = 183 + slot * 6.5 + 3 * nz();
      rosters.push({ team_id: id, player_id: pid, position: un() < 0.7 ? SLOTS[slot] : null, height_cm: un() < 0.85 ? Math.round(h) : null });
      bios[pid] = { age: Math.round(22 + 5 * un()), birth_year: 2026 - Math.round(22 + 5 * un()), height_cm: Math.round(h) };
      if (k === 11 && t % 4 === 0) withheld.push(pid);
    }
  }
  /* the schedule: circle-method rounds, two a week, home and away alternating; 4% at a neutral site */
  const ids = teams.map((_, i) => i);
  if (ids.length % 2) ids.push(-1);
  const rounds = [];
  for (let r = 0; r < 2 * (ids.length - 1); r++) {
    const pr = [];
    for (let k = 0; k < ids.length / 2; k++) { const a = ids[k], b = ids[ids.length - 1 - k]; if (a >= 0 && b >= 0) pr.push(r % 2 ? [b, a] : [a, b]); }
    rounds.push(pr);
    ids.splice(1, 0, ids.pop());
  }
  const start = Date.UTC(2026, 8, 7, 18, 0, 0);
  const sched = [];
  for (let r = 0; sched.length < nG; r++) {
    const pr = rounds[r % rounds.length];
    pr.forEach((p, k) => { if (sched.length < nG) sched.push({ h: p[0], a: p[1], t: start + Math.floor(r / 2) * 7 * DAY + (r % 2) * 3 * DAY + k * 3600000 }); });
  }
  const rows = [], gamesRows = [], pgs = [], stints = [];
  const lgPace = 72;
  sched.forEach((s, gi) => {
    const gid = uuid('game' + gi), A = teams[s.h], B = teams[s.a];
    const neutral = un() < 0.04, venue = neutral ? uuid('neutral' + gi) : A.venue;
    const side = (T, O) => {
      const poss = Math.round(lgPace + (T.lat.pace + O.lat.pace) / 2 + 3 * nz());
      const tr = clamp(0.16 + T.lat.tr + 0.03 * nz(), 0.03, 0.4);
      const efg = (50 + T.lat.efg - O.dl.efg + truth.trEfg * (tr - 0.16) + 4 * nz()) / 100;
      const tovp = clamp((14 + T.lat.tov - O.dl.tov + 2.5 * nz()) / 100, 0.05, 0.3);
      const orb = clamp((28 + T.lat.orb - O.dl.orb + 5 * nz()) / 100, 0.08, 0.6);
      /* the planted free-throw factor is the attempt rate (FTA / FGA); the share made is drawn apart, out of the truth */
      const ftr = clamp((27 + 1.3 * (T.lat.ftm - O.dl.ftm) + 6 * nz()) / 100, 0.08, 0.7);
      const ftp = clamp(0.73 + 0.06 * nz(), 0.45, 0.95);
      return { poss, tr, efg, tovp, orb, ftr, ftp };
    };
    const sa = side(A, B), sb = side(B, A);
    const build = (sd, T) => {
      const f = {};
      const fga = Math.round(sd.poss * 0.88), fg3a = Math.round(fga * clamp(0.38 + 0.04 * nz(), 0.15, 0.6));
      const fg3m = clamp(Math.round(fg3a * (0.34 + 0.05 * nz())), 0, fg3a);
      const fgm = clamp(Math.round(sd.efg * fga - 0.5 * fg3m), fg3m, fga);
      const two = fga - fg3a, rim_a = Math.round(two * 0.55), mid_a = two - rim_a, m2 = fgm - fg3m;
      const rim_m = clamp(Math.round(m2 * (rim_a * 0.62) / (rim_a * 0.62 + mid_a * 0.4 || 1)), 0, rim_a), mid_m = clamp(m2 - rim_m, 0, mid_a);
      const fta = Math.round(sd.ftr * fga), ftm = clamp(Math.round(sd.ftp * fta), 0, fta);
      const tov = Math.round(sd.tovp * (fga + 0.44 * fta) / (1 - sd.tovp));
      const miss = fga - fgm, oreb = clamp(Math.round(sd.orb * miss), 0, miss);
      Object.assign(f, { fga, fgm, fg3a, fg3m, fta, ftm, tov, oreb, rim_a, rim_m, mid_a, mid_m, miss });
      f.pts = 2 * (fgm - fg3m) + 3 * fg3m + ftm;
      return f;
    };
    const ca = build(sa, A), cb = build(sb, B);
    const fill = (c, o2, sd, other) => {
      const f = new Float64Array(N).fill(NaN), set = (k, v) => { f[I[k]] = v; };
      const chances = sd.poss + c.oreb, ftTrips = Math.round(c.fta / 2), and1 = Math.round(0.1 * ftTrips), trS = Math.round(0.5 * ftTrips);
      Object.entries({ pts: c.pts, fga: c.fga, fgm: c.fgm, fg3a: c.fg3a, fg3m: c.fg3m, fta: c.fta, ftm: c.ftm, oreb: c.oreb, dreb: o2.miss - o2.oreb, tov: c.tov,
        ast: Math.round(0.6 * c.fgm), stl: Math.round(0.5 * o2.tov), blk: Math.round(0.08 * (o2.fga - o2.fg3a)),
        rim_a: zones ? c.rim_a : NaN, rim_m: zones ? c.rim_m : NaN, mid_a: zones ? c.mid_a : NaN, mid_m: zones ? c.mid_m : NaN,
        poss_est: 0.96 * (c.fga + c.tov + 0.44 * c.fta - c.oreb), minutes: 40, pts_paint: 2 * c.rim_m, pts_fast: Math.round(1.2 * sd.tr * chances),
        pts_second: Math.round(1.1 * c.oreb), pts_offto: Math.round(1.1 * 0.5 * o2.tov), pts_bench: Math.round(0.3 * c.pts), fouls: Math.round(18 + 3 * nz()),
        timeouts: 5, max_lead: 8, poss: sd.poss, chances, poss_3q: Math.round(0.75 * sd.poss), reg_min: 40, gain_dreb: o2.miss - o2.oreb,
        timed_n: sd.poss, timed_s: sd.poss * (2400 / (sd.poss + other.poss)) * (1 + 0.03 * nz()), fc_n: sd.poss,
        fc_e_n: Math.round(0.25 * sd.poss), fc_e_pts: Math.round(0.25 * sd.poss * 1.2), fc_m_n: Math.round(0.45 * sd.poss), fc_m_pts: Math.round(0.45 * sd.poss),
        fc_l_n: Math.round(0.3 * sd.poss), fc_l_pts: Math.round(0.3 * sd.poss * 0.85), reb_off_ch: c.oreb, reb_def_ch: c.miss - c.oreb,
        sit_ch: chances, tr_ch: Math.round(sd.tr * chances), tr_pts: Math.round(1.2 * sd.tr * chances), sc_ch: c.oreb, sc_pts: Math.round(1.1 * c.oreb),
        offto_ch: Math.round(0.5 * o2.tov), offto_pts: Math.round(0.55 * o2.tov), ato_n: 4, ato_pts: 4,
        fgm_ast: Math.round(0.6 * c.fgm), fgm_unast: c.fgm - Math.round(0.6 * c.fgm), fg3m_ast: Math.round(0.8 * c.fg3m),
        to_n: c.tov, to_live: Math.round(0.5 * c.tov), to_typed: c.tov, to_badpass: Math.round(0.4 * c.tov), to_handle: Math.round(0.3 * c.tov), to_offfoul: Math.round(0.1 * c.tov),
        fouls_shooting: 9, fouls_offensive: 1, techs: 0, ft_trips: ftTrips, and1, trips_shooting: trS, trips_bonus: Math.max(0, ftTrips - and1 - trS), fta_bonus: 2 * Math.max(0, ftTrips - and1 - trS),
        lead_changes: 6, ties: 4, lead_ms: 1200000, max_deficit: 7, best_run: 9, runs8: 1, pts_h1: Math.round(0.49 * c.pts), pts_h2: c.pts - Math.round(0.49 * c.pts), pts_ot: 0, ot_periods: 0,
        cl_poss: 5, cl_pts: 5, cl_tov: 1, cl_fga: 4, cl_efgm: 2, cl_fta: 2,
        g_poss: 0, c_pts: c.pts, c_fga: c.fga, c_efgm: c.fgm + 0.5 * c.fg3m, c_fta: c.fta, c_ftm: c.ftm, c_tov: c.tov, c_reb_off: c.oreb, c_reb_def: c.miss - c.oreb,
        players_used: 10, rot_n: 9, top5_min_share: 0.68, starters_min_share: 0.66, usg_hhi: 12 + nz(), top_usg_share: 0.22, fives_used: 14, top_five_share: 0.3, starters_net: 0,
        events: 450, zoned_2pa: zones ? c.fga - c.fg3a : 0, sit_rim_a: zones ? c.rim_a : NaN
      }).forEach(([k, v]) => set(k, v));
      return f;
    };
    const fa = fill(ca, cb, sa, sb), fb = fill(cb, ca, sb, sa);
    const qa = zones ? 1023 : (1023 & ~(Q.MARK | Q.TYPE | Q.ZONES));
    /* the planted margin */
    const da = Fm.derive(fa, fb, qa, qa), db = Fm.derive(fb, fa, qa, qa);
    const h = neutral ? 0 : 1;
    let yc = truth.alpha * h + truth.sigma * nz();
    CORE.forEach(k => { yc += truth.beta[k] * (da[k] - db[k]); });
    const ycR = Math.round(yc), base = Math.round((ca.pts + cb.pts) / 2);
    const cpa = base + Math.ceil(ycR / 2), cpb = cpa - ycR;
    let gA = 0, gB = 0;
    if (un() < 0.15) { gA = Math.round(3 * nz()); gB = Math.round(3 * nz()); }
    let hs = cpa + gA, as = cpb + gB;
    if (hs === as) { if (un() < 0.5) { hs++; gA++; } else { as++; gB++; } }
    fa[I.c_pts] = cpa; fb[I.c_pts] = cpb; fa[I.pts] = hs; fb[I.pts] = as;
    fa[I.g_poss] = gA || gB ? 3 : 0; fb[I.g_poss] = fa[I.g_poss];
    fa[I.starters_net] = ycR / 2; fb[I.starters_net] = -ycR / 2;
    const fin = new Date(s.t + 2.5 * 3600000).toISOString();
    const r4 = a => Array.from(a, sig4);
    rows.push({ game_id: gid, team_idx: 0, fv: Fm.FV, f: r4(fa), q: qa, finalised_at: fin }, { game_id: gid, team_idx: 1, fv: Fm.FV, f: r4(fb), q: qa, finalised_at: fin });
    gamesRows.push({ id: gid, status: 'final', competition_id: comp, home_team_id: A.id, away_team_id: B.id, home_score: hs, away_score: as,
      tipoff_at: new Date(s.t).toISOString(), venue_id: venue, starters: [A.roster.slice(0, 5).map(p => p.id), B.roster.slice(0, 5).map(p => p.id)] });
    /* player lines: the team's counts shared by minutes, shooters taking the threes, bigs the boards */
    const uRow = [{}, {}];
    [[A, ca, 0, cb], [B, cb, 1, ca]].forEach(([T, c, ti, oc]) => {
      const mins = T.roster.map(p => (p.deep ? (un() < 0.3 ? 3 : 0) : p.starter ? 30 + 3 * nz() : 15 + 3 * nz()));
      const tot = sum(mins), scale = 200 / tot;
      const wsum = (wf) => { const ws = T.roster.map((p, j) => mins[j] * wf(p)); const t = sum(ws) || 1; return ws.map(v => v / t); };
      const w3 = wsum(p => (p.shooter ? 3 : p.slot <= 2 ? 1 : 0.15)), wb = wsum(p => 0.5 + p.slot), wg = wsum(p => 5 - p.slot), w2 = wsum(() => 1), wbk = wsum(p => (p.slot >= 3 ? 3 : 0.3));
      T.roster.forEach((p, j) => {
        if (!(mins[j] > 0)) return;
        const fg3a = c.fg3a * w3[j], fg3m = fg3a * (p.shooter ? 0.4 : 0.28), p2a = (c.fga - c.fg3a) * w2[j], p2m = p2a * ((c.fgm - c.fg3m) / Math.max(1, c.fga - c.fg3a));
        /* A.3: zone counts (bigs nearer the rim) where the league has zones, and the unassisted makes (guards create
           more of their own); the makers' unassisted counts ride on the feature row as st.u does */
        const rimA = zones ? p2a * (0.3 + 0.1 * p.slot) : null, rimM = zones ? Math.min(p2m, rimA * 0.62) : null;
        const un = (p2m + fg3m) * (0.6 - 0.09 * p.slot);
        pgs.push({ game_id: gid, team_idx: ti, player_uuid: p.id, player_id: p.id, min: mins[j] * scale * 60000, pts: 2 * p2m + 3 * fg3m + c.ftm * w2[j],
          p2a, p2m, p3a: fg3a, p3m: fg3m, fta: c.fta * w2[j], ftm: c.ftm * w2[j], or: c.oreb * wb[j], dr: (oc.miss - oc.oreb) * wb[j], ast: 0.6 * c.fgm * wg[j],
          stl: 0.5 * oc.tov * wg[j], blk: 0.08 * (oc.fga - oc.fg3a) * wbk[j], to: c.tov * w2[j], pf: 2 + nz() * 0.5,
          rimA, rimM, midA: zones ? p2a - rimA : null, midM: zones ? p2m - rimM : null });
        /* 2026-10-07: and the threes and twos each one assisted (guards most, and most of theirs to shooters' threes), no draw
           of its own so the league's other numbers are as they were */
        const give3 = Math.round(Math.max(0, 5 - p.slot) * (p.slot <= 2 ? 0.7 : 0.25)), give2 = Math.round(Math.max(0, 5 - p.slot) * 0.6 + (p.slot >= 4 ? 0.5 : 0));
        if (p2m + fg3m > 0) uRow[ti][p.id] = [Math.round(un), Math.round(2 * un * p2m / (p2m + fg3m) + 3 * un * fg3m / (p2m + fg3m)), Math.round(p2m + fg3m - un), give3, give2];
        else if (give3 + give2 > 0) uRow[ti][p.id] = [0, 0, 0, give3, give2];
      });
    });
    rows[rows.length - 2].u = uRow[0]; rows[rows.length - 1].u = uRow[1];
    /* stints: ten fives a side, the bench mixed in; net per 100 carries the planted shooter effect */
    [[A, sa, 0, ycR], [B, sb, 1, -ycR]].forEach(([T, sd, ti, mg]) => {
      let left = 2400;
      for (let k = 0; k < 10 && left > 0; k++) {
        const dur = k === 9 ? left : Math.min(left, Math.round(180 + 120 * un()));
        left -= dur;
        const five = [0, 1, 2, 3, 4].map(sl => { const c = T.roster.filter(p => p.slot === sl && !p.deep); return k < 2 ? c[0] : c[un() < 0.4 ? 1 : 0] || c[0]; });
        if (k >= 2 && un() < 0.3) { const sl = Math.floor(un() * 5); five[sl] = T.roster[[0, 1, 2].includes(sl) ? 10 + (sl % 2) : 4 + 5]; }
        const uniq = Array.from(new Set(five.map(p => p.id)));
        if (uniq.length < 5) continue;
        const poss = sd.poss * dur / 2400, nSh = five.filter(p => p.shooter).length;
        const net = 100 * mg / sd.poss + truth.shooter * (nSh - 2) + 12 * nz();
        const diff = net * poss / 100;
        /* both ends' box (A.3), shaped so the possessions it gives stay poss: fga + tov + 0.44 fta - or = poss / 0.96 */
        const box = pts => { const tov = 0.14 * poss, fta = 0.22 * poss, or = 0.1 * poss, fga = poss / 0.96 - tov - 0.44 * fta + or;
          return { fga, fgm: 0.45 * fga, f3m: 0.12 * fga, fta, pts, tov, or, dr: 0.3 * poss }; };
        stints.push({ game_id: gid, team_idx: ti, player_ids: uniq, dur: dur * 1000, pf: poss * 1.05 + diff / 2, pa: poss * 1.05 - diff / 2,
          off: box(poss * 1.05 + diff / 2), def: box(poss * 1.05 - diff / 2) });
      }
    });
  });
  const st0 = emptyStore(league.id, season.id);
  const store = storeAdd(st0, rows, gamesRows, pgs, stints, { kinds: { [comp]: 'league' } });
  const last = sched.length ? sched[sched.length - 1].t : start;
  const scheduled = [0, 1, 2].map(k => ({ id: uuid('fx' + k), h: teams[k % nT].id, a: teams[(k + 1) % nT].id, t: new Date(last + (k + 2) * DAY).toISOString() }));
  store.ctx = { league, season, current: true, open: true, teams: teams.map(t => ({ id: t.id, name: t.name, short_name: t.short_name, colour: t.colour, logo_path: null, home_venue_id: t.home_venue_id })),
    rosters, bios, withheld: withheld.slice().sort(), venues, homeVenues: {}, scheduled, prev: null, priors: null, kinds: { [comp]: 'league' } };
  const truthShooters = new Set(players.filter(p => p.shooter).map(p => p.id));
  /* raw: the database rows the store was built from (a mocked Supabase serves them in ww-build) */
  return Object.assign(inputFromStore(store), { token: store.n + '@' + store.wm.at, truth: Object.assign({}, truth, { shooters: truthShooters }),
    raw: { rows, games: gamesRows, pgs, stints, comp, teams, rosters, bios, venues, withheld, scheduled } });
}

return { FILE_V, CODE_V, STORE_V, BUDGET, KEYMAP, MIN, CORE, ROLE_KEYS, MIX_STATS, PLAYER_STATS, POS_STATS, CREATION_STATS, BOX_KEYS, explainOf, normListed, positionOf, groupsFor, roles, blocksOf, slotMinutes, isoWeek,
         emptyStore, storeAdd, storeDrop, stintGaps, decodeStore, inputFromStore, buildUnit, buildPool, buildTeaser, update, validate, pack, unpack, synthUnit,
         poolToken, bytesOf, budgetOf, _sdReal: sdReal, _centred: centred, _corrCI: corrCI };
}));
