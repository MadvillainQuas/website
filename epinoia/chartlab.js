'use strict';
/* ============================================================================
   CHART LAB (epinoia/chartlab.js, styled by kit/chartlab.css)

   A scatter-graph builder for a league's season statistics. Players or teams; any numeric statistic the
   statistics tables show on either axis; a second, linked chart or an overlay of two statistics as z-scores;
   values as they are, as a difference from the league average, as a z-score or as a percentile; a search box
   that pins players and clubs; names that never pile up; zoom and pan; a table twin of the plot; a link that
   carries the whole chart; text you can rewrite; and an image export (PNG, SVG, clipboard) at fixed sizes.

     EpinoiaChartLab.mount({ host, D, league, season, S, keep, prepare, leagueId, leagueSlug, url })
        S         the season read (data.js season()): { players, teams, teamOfPlayer } - player rows carry their names
                  (playerMeta) and teams theirs (teamMeta); either is fetched here when missing
        keep      fn(teamId) -> bool, the page's conference filter (scopebar.js)
        prepare   async fn(keys) -> void: called when a chosen statistic needs a read the page has not made yet
                  (a club's shot-zone columns); the rows are then derived again
        url       false to leave the address bar alone (default: the chart is kept in ?cl=)
     EpinoiaChartLab.<pure functions>   everything below "PURE" is exported for the node tests

   THE COLUMNS ARE THE TABLES' OWN: EpinoiaTable.PLAYER_COLS / TEAM_COLS (fulltable.js) give the labels, groups,
   decimals, direction (low = lower is better) and sign. A column the membership locks (EpinoiaAccess.isPremiumColumn
   while analytics are locked) is listed with the shared .mem-lock treatment and cannot be chosen.

   ONE RENDERER, THREE PLACES: the chart on the page, the chart in the image preview and the exported file are the same
   function (buildChart) given a size, a theme and a font scale, so an export is exactly what is on screen, laid out
   afresh for the size asked for. Every piece of text is set with textContent, never innerHTML.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaChartLab = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ============================================================================================ PURE === */
const isNum = v => typeof v === 'number' && isFinite(v);
const numOrNull = v => (v == null || v === '' || !isFinite(Number(v))) ? null : Number(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* the five ways a value can be read; one per axis */
const MODES = [
  ['a', 'ABS', 'the value as it is'],
  ['d', 'Δ AVG', 'the value minus the league average'],
  ['p', '% AVG', 'the % difference from the league average'],
  ['z', 'Z', 'z-score: standard deviations from the league average (higher is better)'],
  ['r', 'PCTILE', 'percentile among the players shown (higher is better)']
];
const MODE_CODES = MODES.map(m => m[0]);

/* ------------------------------------------------------------------ value transforms --- */
/* values: numbers or null/NaN/Infinity for "no value". Returns { out, mean, sd, n } with out aligned to values (null where
   there was no value or the mode cannot say). Averages and spreads are over the finite values. `low` = lower is better:
   z-scores and percentiles are turned round so that a higher number is always the better one, as the site's percentiles
   are; the difference modes keep the statistic's own sign (a difference in turnovers is a difference in turnovers). */
function transformValues(values, mode, low) {
  const n0 = values.length, out = new Array(n0).fill(null);
  const fin = [];
  for (let i = 0; i < n0; i++) if (isNum(values[i])) fin.push(values[i]);
  const n = fin.length;
  if (!n) return { out, mean: null, sd: null, n: 0 };
  let sum = 0; for (let i = 0; i < n; i++) sum += fin[i];
  const mean = sum / n;
  let ss = 0; for (let i = 0; i < n; i++) ss += (fin[i] - mean) * (fin[i] - mean);
  const sd = Math.sqrt(ss / n);
  const m = MODE_CODES.indexOf(mode) < 0 ? 'a' : mode;
  if (m === 'a') { for (let i = 0; i < n0; i++) if (isNum(values[i])) out[i] = values[i]; }
  else if (m === 'd') { for (let i = 0; i < n0; i++) if (isNum(values[i])) out[i] = values[i] - mean; }
  else if (m === 'p') {
    if (Math.abs(mean) > 1e-9) for (let i = 0; i < n0; i++) if (isNum(values[i])) out[i] = 100 * (values[i] - mean) / Math.abs(mean);
  } else if (m === 'z') {
    for (let i = 0; i < n0; i++) if (isNum(values[i])) out[i] = sd > 0 ? (low ? -1 : 1) * (values[i] - mean) / sd : 0;
  } else if (m === 'r') {
    if (n >= 3) {
      const sorted = fin.slice().sort((a, b) => a - b);
      for (let i = 0; i < n0; i++) {
        if (!isNum(values[i])) continue;
        /* how many are strictly below: the site's percentile (season.js percentiles), a binary search */
        let lo = 0, hi = n;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid] < values[i]) lo = mid + 1; else hi = mid; }
        const p = 100 * lo / (n - 1);
        out[i] = clamp(low ? 100 - p : p, 0, 100);
      }
    }
  }
  return { out, mean, sd, n };
}

/* where one value sits among the values: rank 1 is the best (the lowest when low), of n, and the percentile (higher is better) */
function rankOf(values, v, low) {
  if (!isNum(v)) return null;
  let better = 0, below = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const w = values[i];
    if (!isNum(w)) continue;
    n++;
    if (low ? w < v : w > v) better++;
    if (w < v) below++;
  }
  if (!n) return null;
  let pct = n > 1 ? 100 * below / (n - 1) : null;
  if (pct != null && low) pct = 100 - pct;
  return { rank: better + 1, n, pct: pct == null ? null : clamp(pct, 0, 100) };
}

/* least squares of ys on xs over the pairs that are both numbers: { n, slope, intercept, r, r2 }, or null when it cannot be drawn
   (fewer than three pairs, or no spread in x). r is null when y does not vary. */
function regress(xs, ys) {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < xs.length; i++) if (isNum(xs[i]) && isNum(ys[i])) { n++; sx += xs[i]; sy += ys[i]; }
  if (n < 3) return null;
  const mx = sx / n, my = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    if (!isNum(xs[i]) || !isNum(ys[i])) continue;
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (!(sxx > 1e-12)) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  const r = syy > 1e-12 ? clamp(sxy / Math.sqrt(sxx * syy), -1, 1) : null;
  return { n, slope, intercept, r, r2: r == null ? null : r * r };
}

/* ------------------------------------------------------------------ text: safe, capped --- */
/* every string a person can type into the chart (titles, captions, a point's label) goes through here: control characters,
   zero-width and bidi-override characters and lone surrogates out (they would break an SVG file or spoof a name), runs of
   white space folded to one space, capped at `max` characters (code points). It is only ever SET with textContent. */
function sanitizeText(s, max) {
  let t = String(s == null ? '' : s);
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFFE\uFFFF]/g, '');
  t = t.replace(/[\s\u00A0]+/g, ' ').trim();
  const cps = Array.from(t).filter(c => { const k = c.charCodeAt(0); return c.length > 1 || k < 0xD800 || k > 0xDFFF; });
  if (max > 0 && cps.length > max) return cps.slice(0, max).join('').trim();
  return cps.join('');
}
/* what each editable text may hold: t = the chart's text keys; a/b prefix = chart A / chart B */
const TEXT_CAPS = { ti: 90, su: 170, fo: 190, ax: 60, ay: 60, alg: 130, aq0: 34, aq1: 34, aq2: 34, aq3: 34,
  bx: 60, by: 60, blg: 130, bq0: 34, bq1: 34, bq2: 34, bq3: 34 };
const TEXT_KEYS = Object.keys(TEXT_CAPS);
const LABEL_CAP = 28, LABEL_MAX = 40, PIN_MAX = 30, HL_MAX = 8;

/* ------------------------------------------------------------------ the chart's state and its URL --- */
const ENT_DEFAULTS = { p: { x: 'ppg', y: 'ts' }, t: { x: 'pace', y: 'net' } };
const newAxes = ent => ({ x: ENT_DEFAULTS[ent === 't' ? 't' : 'p'].x, y: ENT_DEFAULTS[ent === 't' ? 't' : 'p'].y,
  xm: 'a', ym: 'a', y2: '', xl: 0, yl: 0 });
function defaultState(ent) {
  ent = ent === 't' ? 't' : 'p';
  return { ent, a: newAxes(ent), b: null, sz: '', co: 'c', nm: 's', qd: 1, qc: 0, tr: 0, tb: 0, cr: 1,
    pin: [], hl: [], gp: null, mn: 0, ps: '', tx: {}, lb: {} };
}
const KEYRE = /^[A-Za-z0-9_]{1,48}$/;
const okKey = k => typeof k === 'string' && KEYRE.test(k);
function cleanAxes(a, ent) {
  const d = newAxes(ent);
  if (!a || typeof a !== 'object') return d;
  const o = Object.assign({}, d);
  if (okKey(a.x)) o.x = a.x;
  if (okKey(a.y)) o.y = a.y;
  if (MODE_CODES.indexOf(a.xm) >= 0) o.xm = a.xm;
  if (MODE_CODES.indexOf(a.ym) >= 0) o.ym = a.ym;
  if (okKey(a.y2)) o.y2 = a.y2;
  o.xl = a.xl ? 1 : 0; o.yl = a.yl ? 1 : 0;
  return o;
}
const uniqIds = (list, max) => {
  const out = [], seen = new Set();
  (Array.isArray(list) ? list : []).forEach(v => {
    const s = typeof v === 'string' ? v.slice(0, 80) : (typeof v === 'number' ? String(v) : '');
    if (s && !seen.has(s) && out.length < max) { seen.add(s); out.push(s); }
  });
  return out;
};
/* anything -> a whole, valid state. Unknown fields are dropped, out-of-range ones fall back to the default. */
function sanitizeState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ent = r.ent === 't' ? 't' : 'p';
  const s = defaultState(ent);
  s.a = cleanAxes(r.a, ent);
  s.b = r.b ? cleanAxes(r.b, ent) : null;
  if (s.b && !r.b.x && !r.b.y) s.b = null;
  s.sz = okKey(r.sz) ? r.sz : '';
  s.co = ['c', 'p', 'n'].indexOf(r.co) >= 0 ? r.co : 'c';
  s.nm = ['s', 'a', 'n'].indexOf(r.nm) >= 0 ? r.nm : 's';
  ['qd', 'qc', 'tr', 'tb'].forEach(k => { if (r[k] !== undefined) s[k] = r[k] ? 1 : 0; });
  s.cr = r.cr === 0 || r.cr === false ? 0 : 1;
  s.pin = uniqIds(r.pin, PIN_MAX);
  s.hl = uniqIds(r.hl, HL_MAX);
  s.gp = isNum(r.gp) ? clamp(Math.round(r.gp), 0, 999) : null;
  s.mn = isNum(r.mn) ? clamp(Math.round(r.mn), 0, 99999) : 0;
  s.ps = ['G', 'F', 'C'].indexOf(r.ps) >= 0 && ent === 'p' ? r.ps : '';
  if (r.tx && typeof r.tx === 'object') TEXT_KEYS.forEach(k => {
    if (typeof r.tx[k] === 'string') { const t = sanitizeText(r.tx[k], TEXT_CAPS[k]); if (t) s.tx[k] = t; }
  });
  if (r.lb && typeof r.lb === 'object') {
    let n = 0;
    Object.keys(r.lb).forEach(id => {
      if (n >= LABEL_MAX || id.length > 80 || typeof r.lb[id] !== 'string') return;
      const t = sanitizeText(r.lb[id], LABEL_CAP);
      if (t) { s.lb[id] = t; n++; }
    });
  }
  return s;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* only what differs from the defaults, so a plain chart is a short link */
function compactState(state) {
  const s = sanitizeState(state), d = defaultState(s.ent), o = { v: 1 };
  if (s.ent !== 'p') o.e = s.ent;
  const ax = (a, base) => { const c = {}; Object.keys(base).forEach(k => { if (a[k] !== base[k]) c[k] = a[k]; }); return c; };
  const ca = ax(s.a, d.a); if (Object.keys(ca).length) o.a = ca;
  if (s.b) { o.b = ax(s.b, newAxes(s.ent)); o.b.x = s.b.x; o.b.y = s.b.y; }
  ['sz', 'co', 'nm', 'qd', 'qc', 'tr', 'tb', 'cr', 'gp', 'mn', 'ps'].forEach(k => { if (!same(s[k], d[k])) o[k] = s[k]; });
  if (s.pin.length) o.pin = s.pin;
  if (s.hl.length) o.hl = s.hl;
  if (Object.keys(s.tx).length) o.tx = s.tx;
  if (Object.keys(s.lb).length) o.lb = s.lb;
  return o;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toB64u(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | ((c || 0) >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}
function fromB64u(s) {
  const clean = String(s).replace(/[^A-Za-z0-9\-_]/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map(j => (i + j < clean.length ? B64.indexOf(clean[i + j]) : -1));
    bytes.push((v[0] << 2) | (v[1] >> 4));
    if (v[2] >= 0) bytes.push(((v[1] & 15) << 4) | (v[2] >> 2));
    if (v[3] >= 0) bytes.push(((v[2] & 3) << 6) | v[3]);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
const URL_MAX = 8000;
/* state -> the value of ?cl=  (URL-safe characters only, so no chat app or address bar re-encodes it) */
function encodeState(state) { return '1.' + toB64u(JSON.stringify(compactState(state))); }
/* the value of ?cl= -> a whole valid state, or null when it is not one of ours */
function decodeState(str) {
  try {
    const s = String(str == null ? '' : str);
    if (!s || s.length > URL_MAX || s.slice(0, 2) !== '1.') return null;
    const o = JSON.parse(fromB64u(s.slice(2)));
    if (!o || typeof o !== 'object') return null;
    return sanitizeState({ ent: o.e, a: o.a, b: o.b ? Object.assign({}, o.b) : null, sz: o.sz, co: o.co, nm: o.nm, qd: o.qd, qc: o.qc,
      tr: o.tr, tb: o.tb, cr: o.cr, pin: o.pin, hl: o.hl, gp: o.gp, mn: o.mn, ps: o.ps, tx: o.tx, lb: o.lb });
  } catch (_) { return null; }
}
/* the state as it must be for the URL of a page: the query string with ?cl= set (or removed for a plain default chart) */
function withQuery(search, state, plain) {
  const q = new URLSearchParams(search || '');
  const v = plain ? '' : encodeState(state);
  if (v) q.set('cl', v); else q.delete('cl');
  const s = q.toString();
  return s ? '?' + s : '';
}
function readQuery(search) {
  try { return decodeState(new URLSearchParams(search || '').get('cl')); } catch (_) { return null; }
}

/* ------------------------------------------------------------------ search --- */
const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase().replace(/[^a-z0-9\u0370-\u03FF\u0400-\u04FF ]+/g, ' ').replace(/\s+/g, ' ').trim();
/* entities: [{ id, name, clubName, clubShort }]. Best first: a name that starts with the query, a word that does, any
   part of the name, then the club. Every word of the query must match somewhere. Diacritics and case do not matter. */
function matchEntities(list, query, limit) {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(' ');
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const n = e._n || (e._n = fold(e.name)), c = e._c || (e._c = fold((e.clubName || '') + ' ' + (e.clubShort || '')));
    let score = 0, ok = true;
    for (let w = 0; w < words.length; w++) {
      const t = words[w];
      let s;
      if (n.startsWith(t)) s = w === 0 ? 100 : 80;
      else if (n.indexOf(' ' + t) >= 0) s = 70;
      else if (n.indexOf(t) >= 0) s = 50;
      else if (c.indexOf(t) >= 0) s = 20;
      else { ok = false; break; }
      score += s;
    }
    if (ok) out.push({ e, score });
  }
  out.sort((a, b) => b.score - a.score || String(a.e.name).localeCompare(String(b.e.name)));
  return out.slice(0, limit || 8).map(x => x.e);
}

/* ------------------------------------------------------------------ columns: the tables' own --- */
const CONTEXT_KEYS = ['gp', 'mpg', 'ev_gp'];
const SKIP_KEYS = new Set(['rank', 'name', 'teamName', 'rapm', 'orapm', 'drapm', 'ev_gp']);
const PAIR_NAMES = { fgm_pg: 'FG made / G', p3m_pg: '3P made / G', ftm_pg: 'FT made / G', fgm: 'FG made', p3m: '3P made', ftm: 'FT made' };
/* plain names for the statistics statinfo.js has no entry for, so an axis says "Turnovers per game" and not "TOPG" */
const LONG = { gp: 'Games played', orpg: 'Offensive rebounds per game', drpg: 'Defensive rebounds per game', spg: 'Steals per game', bpg: 'Blocks per game',
  topg: 'Turnovers per game', pfpg: 'Fouls per game', min: 'Minutes played', pts: 'Points', reb: 'Rebounds', oreb: 'Offensive rebounds', dreb: 'Defensive rebounds',
  ast: 'Assists', stl: 'Steals', blk: 'Blocks', tov: 'Turnovers', pf: 'Fouls', fouls: 'Fouls', fd: 'Fouls drawn', ptsAst: 'Points from assists', paint: 'Points in the paint',
  fast: 'Fast-break points', sc: 'Second-chance points', second_chance: 'Second-chance points', pot: 'Points off turnovers', pts_off_to: 'Points off turnovers', bench: 'Bench points',
  fg_pct: 'Field goal %', p2_pct: '2-point %', p3_acc: '3-point %', rim_apg: 'Rim attempts per game', mid_apg: 'Mid-range attempts per game', p3_apg: '3-point attempts per game',
  rim_rate: 'Share of shots at the rim', mid_rate: 'Share of shots from mid-range', p3_rate: 'Share of shots from three', ptsAst_pg: 'Points from assists per game',
  sc_pg: 'Second-chance points per game', second_pg: 'Second-chance points per game', pot_pg: 'Points off turnovers per game', ppp: 'Points per possession', pts75: 'Points per 75 possessions',
  poss: 'Possessions per game', poss_pg: 'Possessions per game', diff_pace: 'Pace, on minus off', pm: 'Plus/minus (season total)', vs_efg: 'Opponent eFG% while on the floor',
  vs_tov: 'Opponent TOV% while on the floor', vs_oreb: 'Opponent OREB% while on the floor', vs_ftr: 'Opponent FTr while on the floor', fga_pg: 'Field goal attempts per game',
  p3a_pg: '3-point attempts per game', fta_pg: 'Free throw attempts per game', fga: 'Field goal attempts', p3a: '3-point attempts', fta: 'Free throw attempts',
  fgm_pg: 'Field goals made per game', p3m_pg: '3-pointers made per game', ftm_pg: 'Free throws made per game', fgm: 'Field goals made', p3m: '3-pointers made', ftm: 'Free throws made',
  pred_efg: 'Expected eFG% from the shot diet', efg_sh: 'eFG% on located shots', efg_vs: 'eFG% above expected', morey: 'Shots at the rim or from three (%)',
  rim_share: 'Share of shots at the rim', mid_share: 'Share of shots from mid-range', p3_share: 'Share of shots from three' };
/* numbers a table shows only as a made-attempted pair, or not at all, that are worth a chart: attempts */
const EXTRA_COLS = {
  player: [
    { k: 'fga_pg', l: 'FGA/G', t: 'field goal attempts per game', g: ['shooting'] },
    { k: 'p3a_pg', l: '3PA/G', t: 'three-point attempts per game', g: ['shooting'] },
    { k: 'fta_pg', l: 'FTA/G', t: 'free throw attempts per game', g: ['shooting'] },
    { k: 'fga', l: 'FGA', t: 'field goal attempts', g: ['totals'] },
    { k: 'p3a', l: '3PA', t: 'three-point attempts', g: ['totals'] },
    { k: 'fta', l: 'FTA', t: 'free throw attempts', g: ['totals'] }
  ],
  team: [
    { k: 'fga_pg', l: 'FGA/G', t: 'field goal attempts per game', g: ['shooting'] },
    { k: 'p3a_pg', l: '3PA/G', t: 'three-point attempts per game', g: ['shooting'] },
    { k: 'fta_pg', l: 'FTA/G', t: 'free throw attempts per game', g: ['shooting'] },
    { k: 'ftm_pg', l: 'FT made / G', t: 'free throws made per game', g: ['shooting'] },
    { k: 'fga', l: 'FGA', t: 'field goal attempts', g: ['totals'] },
    { k: 'p3a', l: '3PA', t: 'three-point attempts', g: ['totals'] },
    { k: 'fta', l: 'FTA', t: 'free throw attempts', g: ['totals'] }
  ]
};
/* the statistics a chart needs that fulltable.js derives inside a table (its derive()): per-game forms of a club's totals, and
   the zone-weighted expectation once the zone read is on the row. Same arithmetic; a row is copied, never changed. */
const ZONE_EFG = { rim: 66, paint: 43, mid: 41, c3: 58.5, ab3: 54 };
function deriveRow(kind, r) {
  const o = Object.assign({}, r);
  if (kind !== 'team') { o.poss_pg = isNum(o.poss) ? o.poss / (o.gp || 1) : null; return o; }
  const gp = o.gp || 1, pg = v => isNum(v) ? v / gp : null;
  o.poss_pg = pg(o.poss); o.fgm_pg = pg(o.fgm); o.fga_pg = pg(o.fga); o.p3m_pg = pg(o.p3m); o.p3a_pg = pg(o.p3a);
  o.ftm_pg = pg(o.ftm); o.fta_pg = pg(o.fta);
  o.paint_pg = pg(o.paint); o.fast_pg = pg(o.fast); o.second_pg = pg(o.second_chance); o.pot_pg = pg(o.pts_off_to); o.bench_pg = pg(o.bench);
  const za = k => +o['z_' + k + '_att'] || 0, tot = za('all');
  if (tot > 0) {
    const exp = za('rim') * ZONE_EFG.rim + za('paint') * ZONE_EFG.paint + za('mid') * ZONE_EFG.mid + za('c3') * ZONE_EFG.c3 + (za('w3') + za('t3')) * ZONE_EFG.ab3;
    o.pred_efg = exp / tot; o.morey = 100 * (za('rim') + za('three')) / tot;
    const zm = k => +o['z_' + k + '_madeG'] || 0, made = zm('all') * gp, made3 = zm('three') * gp;
    o.efg_sh = 100 * (made + 0.5 * made3) / tot; o.efg_vs = o.efg_sh - o.pred_efg;
  } else { o.pred_efg = null; o.morey = null; o.efg_sh = null; o.efg_vs = null; }
  return o;
}
const needsZones = k => /^z_/.test(k) || k === 'pred_efg' || k === 'efg_sh' || k === 'efg_vs' || k === 'morey';

/* decimals a column prints, read off its own formatter over a few rows: "58.2" 1, "12" 0, "+3.9" 1, "6.2-11.4" 1 */
function dpOf(col, get, rows) {
  for (let i = 0; i < rows.length && i < 60; i++) {
    const v = get(rows[i]);
    if (!isNum(v)) continue;
    let s = '';
    try { s = String(col.fmt ? col.fmt(rows[i], i) : ''); } catch (_) { s = ''; }
    const m = /-?\+?\d+(?:\.(\d+))?/.exec(s);
    if (m) return m[1] ? m[1].length : 0;
  }
  return 1;
}
/* cols: EpinoiaTable.PLAYER_COLS or TEAM_COLS; presets: EpinoiaTable.PRESETS[kind] = [[key, label]]; rows: the rows the
   catalogue is for (decimals and "has any data"); info: EpinoiaStatInfo.info-like fn(key) -> {title}|null.
   Returns { list, byKey, groups: [{ key, label, items }] } - a column in the group its author put it in first (not 'per game'
   when it has another), the groups in the tables' own order, GP and MPG in a group of their own. */
function buildCatalogue(kind, cols, presets, rows, info, opts) {
  opts = opts || {};
  const all = (cols || []).concat((EXTRA_COLS[kind === 'team' ? 'team' : 'player'] || []).filter(x => !(cols || []).some(c => c.k === x.k)));
  const order = (presets || []).map(p => p[0]).filter(k => k !== '*');
  const labels = {}; (presets || []).forEach(p => { labels[p[0]] = p[1]; });
  labels.context = 'games & minutes';
  const derived = (rows || []).map(r => deriveRow(kind, r));
  const list = [];
  all.forEach(c => {
    if (!c || !c.k || SKIP_KEYS.has(c.k) || c.text || (c.g || []).indexOf('id') >= 0) return;
    if (c.k.indexOf('bio_') === 0) return;
    const get = c.sort ? (r => numOrNull(c.sort(r))) : (r => numOrNull(r[c.k]));
    const groups = (c.g || []).filter(g => order.indexOf(g) >= 0);
    const context = CONTEXT_KEYS.indexOf(c.k) >= 0;
    let primary = context ? 'context' : (groups.filter(g => g !== 'basic')[0] || groups[0] || null);
    if (!primary) return;
    let n = 0;
    for (let i = 0; i < derived.length; i++) if (isNum(get(derived[i]))) n++;
    const zones = kind === 'team' && needsZones(c.k);
    if (zones && !opts.zones) return;                            // the page cannot read the shot zones: not offered
    if (!zones && rows && rows.length && n < Math.min(3, rows.length)) return;      // no data for this competition: not offered
    let t = c.t || '';
    t = t.replace('made-attempted', 'made');
    const inf = info ? info(c.k) : null;
    list.push({ k: c.k, label: PAIR_NAMES[c.k] || c.l, t, long: (inf && inf.title) || LONG[c.k] || '', g: primary, groups: context ? ['context'] : groups,
      low: !!c.low, signed: !!c.signed, dp: dpOf(c, get, derived), get, zones, n });
  });
  /* a label two columns share ('eFG%' in the four factors and in the shot chart) says which group it is in */
  const seen = {};
  list.forEach(c => { seen[c.label] = (seen[c.label] || 0) + 1; });
  list.forEach(c => {
    c.name = seen[c.label] > 1 ? c.label + ' · ' + (labels[c.g] || c.g) : c.label;
    c.hint = c.long && c.long !== c.name ? c.long : c.t;
    if (c.t && /^[A-Z]/.test(c.t) && c.t.indexOf(':') > 0) { c.name = c.t.replace(/^([^:]+): (.*)$/, (m, a, b) => a + ' · ' + b); c.hint = ''; }   // events: "Second chance: points per game"
    c.title = c.long || c.name;
  });
  const gorder = ['context'].concat(order);
  const groups = [];
  gorder.forEach(g => {
    const items = list.filter(c => c.g === g);
    if (items.length) groups.push({ key: g, label: labels[g] || g, items });
  });
  const byKey = new Map(list.map(c => [c.k, c]));
  return { list, byKey, groups, kind };
}
/* a column the membership locks: while analytics are locked and access.js calls the column premium */
function columnState(key, ctx) {
  return ctx && ctx.locked && typeof ctx.isPremium === 'function' && ctx.isPremium(key) ? 'locked' : 'open';
}
/* a group is locked as a whole when every column in it is (the events and zone groups); the columns that are locked one by one
   inside an open group are marked on their own */
function groupState(group, ctx) {
  const items = group.items.filter(c => CONTEXT_KEYS.indexOf(c.k) < 0);
  return items.length && items.every(c => columnState(c.k, ctx) === 'locked') ? 'locked' : 'open';
}
/* a statistic that may be chosen: it exists in the catalogue and is not locked; otherwise the fallback */
function usableKey(cat, key, ctx, fallback) {
  const c = key && cat.byKey.get(key);
  if (c && columnState(key, ctx) === 'open') return key;
  return fallback;
}
/* the statistics a state names that the catalogue cannot give (missing or locked) are put back to the entity's defaults */
function fitState(state, cat, ctx) {
  const s = sanitizeState(state), d = defaultState(s.ent);
  const fb = (k, def) => cat.byKey.has(def) && columnState(def, ctx) === 'open' ? def : (cat.list.find(c => columnState(c.k, ctx) === 'open') || { k: def }).k;
  const fixAxes = a => {
    if (!a) return a;
    a.x = usableKey(cat, a.x, ctx, fb('x', d.a.x));
    a.y = usableKey(cat, a.y, ctx, fb('y', d.a.y));
    if (a.y === a.x) a.y = usableKey(cat, d.a.y, ctx, a.y);
    a.y2 = a.y2 ? usableKey(cat, a.y2, ctx, '') : '';
    return a;
  };
  fixAxes(s.a); fixAxes(s.b);
  s.sz = s.sz ? usableKey(cat, s.sz, ctx, '') : '';
  return s;
}

/* ------------------------------------------------------------------ presets --- */
const PRESET_DEFS = [
  { id: 'score-eff', label: 'Scoring vs efficiency', ent: 'p', a: { x: 'ppg', y: 'ts' } },
  { id: 'usage-ts', label: 'Usage vs TS%', ent: 'p', a: { x: 'usg', y: 'ts' } },
  { id: 'ast-to', label: 'Assists vs turnovers', ent: 'p', a: { x: 'apg', y: 'topg' } },
  { id: 'ast-tov-pct', label: 'Playmaking: AST% vs TOV%', ent: 'p', a: { x: 'ast_pct', y: 'tov_pct' } },
  { id: 'three', label: 'Three-point volume vs accuracy', ent: 'p', a: { x: 'p3a_pg', y: 'p3_pct' } },
  { id: 'rim-prot', label: 'Rim protection: BLK% vs DREB%', ent: 'p', a: { x: 'blk_pct', y: 'dreb_pct' } },
  { id: 'min-bpm', label: 'Minutes vs impact (BPM)', ent: 'p', a: { x: 'mpg', y: 'bpm' } },
  { id: 'two-way', label: 'Two-way: OBPM vs DBPM', ent: 'p', a: { x: 'obpm', y: 'dbpm' } },
  { id: 'ftr', label: 'Free throws: rate vs accuracy', ent: 'p', a: { x: 'ftr', y: 'ft_pct' } },
  { id: 'p-dual', label: 'Two charts: scoring and playmaking', ent: 'p', a: { x: 'ppg', y: 'ts' }, b: { x: 'apg', y: 'topg' } },
  { id: 'p-overlay', label: 'Overlay: TS% and AST% against usage (z-scores)', ent: 'p', a: { x: 'usg', y: 'ts', y2: 'ast_pct', ym: 'z' } },
  { id: 'pace-net', label: 'Pace vs net rating', ent: 't', a: { x: 'pace', y: 'net' } },
  { id: 'off-def', label: 'Offence vs defence (ratings)', ent: 't', a: { x: 'ortg', y: 'drtg' } },
  { id: 'pf-pa', label: 'Points for vs against', ent: 't', a: { x: 'ppg', y: 'papg' } },
  { id: 'four-off', label: 'Four factors: eFG% vs TOV%', ent: 't', a: { x: 'ff_efg', y: 'ff_tov' } },
  { id: 'four-def', label: 'Defence: opponent eFG% vs TOV%', ent: 't', a: { x: 'dff_efg', y: 'dff_tov' } },
  { id: 'glass', label: 'The glass: OREB% vs opponent OREB%', ent: 't', a: { x: 'ff_oreb', y: 'dff_oreb' } },
  { id: 'three-t', label: 'Threes: volume vs accuracy', ent: 't', a: { x: 'p3a_pg', y: 'p3_pct' } },
  { id: 'ball', label: 'Ball movement: assists vs turnovers', ent: 't', a: { x: 'apg', y: 'topg' } },
  { id: 't-dual', label: 'Two charts: pace/net and offence/defence', ent: 't', a: { x: 'pace', y: 'net' }, b: { x: 'ortg', y: 'drtg' } },
  { id: 't-overlay', label: 'Overlay: offence and defence against pace (z-scores)', ent: 't', a: { x: 'pace', y: 'ortg', y2: 'drtg', ym: 'z' } }
];
const presetKeys = p => [p.a.x, p.a.y, p.a.y2, p.b && p.b.x, p.b && p.b.y].filter(Boolean);
/* the presets whose statistics all exist (and are not locked) for this entity */
function presetsFor(ent, cat, ctx) {
  return PRESET_DEFS.filter(p => p.ent === ent && presetKeys(p).every(k => cat.byKey.has(k) && columnState(k, ctx) === 'open'));
}
function presetState(p, base) {
  const s = sanitizeState(Object.assign({}, base || defaultState(p.ent), { ent: p.ent }));
  s.a = cleanAxes(p.a, p.ent);
  s.b = p.b ? cleanAxes(p.b, p.ent) : null;
  s.tx = {};
  return s;
}
function matchPreset(state, list) {
  for (const p of list) {
    const a = state.a, pa = p.a;
    if (a.x !== pa.x || a.y !== pa.y || (a.y2 || '') !== (pa.y2 || '') || (a.xm || 'a') !== (pa.xm || 'a') || (a.ym || 'a') !== (pa.ym || 'a')) continue;
    if (!!state.b !== !!p.b) continue;
    if (p.b && (state.b.x !== p.b.x || state.b.y !== p.b.y)) continue;
    return p.id;
  }
  return '';
}

/* ------------------------------------------------------------------ one chart's numbers --- */
/* pool: [{ id, get(key) -> number|null }]; ch: one chart's axes { x, y, xm, ym, y2, xl, yl }; cat: the catalogue.
   Every axis is read over the whole pool (the average, the spread and the percentiles are the pool's), then the points are the
   rows with both a number for x and one for y (and for y2 in an overlay, whose two y's are z-scores by definition).
   A log axis keeps only positive values and says how many it dropped. */
function computeChart(pool, cat, ch, opts) {
  opts = opts || {};
  const colOf = k => cat.byKey.get(k) || { k, label: k, name: k, title: k, low: false, signed: false, dp: 1, get: () => null };
  const overlay = !!ch.y2;
  const cx = colOf(ch.x), cy = colOf(ch.y), cy2 = overlay ? colOf(ch.y2) : null;
  const ym = overlay ? 'z' : ch.ym, xm = ch.xm;
  const raw = c => pool.map(e => e.get(c.k));
  const rx = raw(cx), ry = raw(cy), ry2 = overlay ? raw(cy2) : null;
  const xlog = !!ch.xl && xm === 'a', ylog = !!ch.yl && ym === 'a' && !overlay;
  const tx = transformValues(rx, xm, cx.low), ty = transformValues(ry, ym, cy.low), ty2 = overlay ? transformValues(ry2, 'z', cy2.low) : null;
  const pts = [];
  let noValue = 0, logDropped = 0;
  for (let i = 0; i < pool.length; i++) {
    const x = tx.out[i], y = ty.out[i], y2 = overlay ? ty2.out[i] : null;
    if (x == null || y == null || (overlay && y2 == null)) { noValue++; continue; }
    if ((xlog && x <= 0) || (ylog && y <= 0)) { logDropped++; continue; }
    pts.push({ i, e: pool[i], x, y, y2, rx: rx[i], ry: ry[i], ry2: overlay ? ry2[i] : null });
  }
  const trend = [];
  const tr = (ys, k) => {
    const xs = pts.map(p => xlog ? Math.log10(p.x) : p.x), yv = pts.map(p => ylog ? Math.log10(p[k]) : p[k]);
    const g = regress(xs, yv); if (g) g.xlog = xlog, g.ylog = ylog; return g;
  };
  if (opts.trend) { trend.push(tr(null, 'y')); if (overlay) trend.push(tr(null, 'y2')); }
  return { cx, cy, cy2, xm, ym, overlay, xlog, ylog, pts, noValue, logDropped, tx, ty, ty2, rawX: rx, rawY: ry, rawY2: ry2, n: pool.length,
    trend: trend.filter(Boolean) };
}

/* ------------------------------------------------------------------ axes: ranges and ticks --- */
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-12) || raw;
  const out = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step, k = 0; t <= hi + step * 1e-9 && k < 200; t += step, k++) out.push(+t.toFixed(10));
  return { ticks: out, step };
}
function logTicks(lo, hi) {
  const out = [];
  if (!(lo > 0) || !(hi > lo)) return { ticks: out, step: 0 };
  const e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) [1, 2, 5].forEach(m => { const v = m * Math.pow(10, e); if (v >= lo * 0.9999 && v <= hi * 1.0001) out.push(+v.toPrecision(6)); });
  return { ticks: out, step: 0 };
}
/* the range an axis shows: the data with room round it; delta / z / % modes always take in the origin (the average),
   percentiles are 0-100; a log axis pads in log space. */
function axisRange(values, mode, log) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!isFinite(lo)) return mode === 'r' ? [0, 100] : [0, 1];
  if (mode === 'r') return [-4, 104];
  if (log) { lo = Math.max(lo, 1e-9); if (hi <= lo) hi = lo * 2; const a = Math.log10(lo), b = Math.log10(hi), p = (b - a) * 0.06; return [Math.pow(10, a - p), Math.pow(10, b + p)]; }
  if (mode === 'd' || mode === 'p' || mode === 'z') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { lo -= 1; hi += 1; }
  const p = (hi - lo) * 0.06;
  return [lo - p, hi + p];
}
/* how many decimals a tick label needs at this step */
function tickDp(step, dp) {
  if (!(step > 0)) return dp;
  if (step >= 1 && Math.abs(step - Math.round(step)) < 1e-9) return 0;
  return clamp(Math.ceil(-Math.log10(step) - 1e-9), 0, 4);
}
/* a value printed for a mode: absolute in the statistic's own decimals, differences signed, z to two places, percentiles whole */
function fmtMode(v, mode, dp, signed) {
  if (!isNum(v)) return '—';
  if (mode === 'z') return (v > 0 ? '+' : '') + v.toFixed(2);
  if (mode === 'r') return Math.round(v) + '';
  if (mode === 'p') return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  if (mode === 'd') return (v > 0 ? '+' : '') + v.toFixed(dp);
  return (signed && v > 0 ? '+' : '') + v.toFixed(dp);
}
const ord = n => { const v = Math.round(n), t = v % 100, s = ['th', 'st', 'nd', 'rd']; return v + (s[(t - 20) % 10] || s[t] || s[0]); };
/* a size scale: 0..1 by value between the 5th and 95th percentile of the values, so one giant does not make everybody else a dot */
function sizeScale(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return () => 0.5;
  const q = f => v[clamp(Math.round(f * (v.length - 1)), 0, v.length - 1)];
  const lo = q(0.05), hi = q(0.95);
  if (!(hi > lo)) return () => 0.5;
  return x => isNum(x) ? clamp((x - lo) / (hi - lo), 0, 1) : 0.5;
}

/* ------------------------------------------------------------------ colour --- */
function parseHex(c) {
  if (typeof c !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const toHex = rgb => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const relLum = rgb => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(rgb[0]) + .7152 * f(rgb[1]) + .0722 * f(rgb[2]); };
const contrast = (a, b) => { const x = relLum(a) + .05, y = relLum(b) + .05; return x > y ? x / y : y / x; };
/* a club's colour as a MARK on this ground: a colour too close to the ground (a black kit on a black page) is moved towards the
   opposite end until it stands off it by 2.6:1; a colour that already does is left exactly as it is */
function markColour(colour, ground, min) {
  const c = parseHex(colour), g = parseHex(ground);
  if (!c) return null;
  if (!g) return toHex(c);
  min = min || 2.6;
  if (contrast(c, g) >= min) return toHex(c);
  const to = relLum(g) < 0.4 ? [255, 255, 255] : [0, 0, 0];
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const m = c.map((v, i) => v + (to[i] - v) * t);
    if (contrast(m, g) >= min) return toHex(m);
  }
  return toHex(to);
}
/* white or near-black text for a fill */
const inkOn = fill => { const c = parseHex(fill); return c && relLum(c) > 0.42 ? '#0b0b0b' : '#ffffff'; };

/* ------------------------------------------------------------------ labels --- */
const ovl = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/* the built-in placer, the same greedy search as statpop.js placeLabels, used when that file is not on the page */
function basicPlaceLabels(points, opts) {
  const W = opts.width, H = opts.height, gap = opts.gap == null ? 3 : opts.gap, max = opts.max == null ? Infinity : opts.max;
  const markers = points.map(p => ({ x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r }));
  const placed = [], out = [];
  let others = 0;
  for (const p of points) {
    if (!p.must && others >= max) continue;
    let done = null;
    for (const d of [gap, gap + 10, gap + 22]) {
      const o = p.r + d;
      const cand = [['r', p.x + o, p.y - p.h / 2], ['l', p.x - o - p.w, p.y - p.h / 2], ['t', p.x - p.w / 2, p.y - o - p.h], ['b', p.x - p.w / 2, p.y + o],
        ['tr', p.x + o * 0.7, p.y - o * 0.7 - p.h], ['br', p.x + o * 0.7, p.y + o * 0.7], ['tl', p.x - o * 0.7 - p.w, p.y - o * 0.7 - p.h], ['bl', p.x - o * 0.7 - p.w, p.y + o * 0.7]];
      for (const [side, x, y] of cand) {
        const box = { x, y, w: p.w, h: p.h };
        if (x < 0 || y < 0 || x + p.w > W || y + p.h > H) continue;
        if (placed.some(b => ovl(box, b)) || markers.some(m => ovl(box, m))) continue;
        done = { id: p.id, box, side }; break;
      }
      if (done) break;
    }
    if (done) { placed.push(done.box); out.push(done); if (!p.must) others++; }
  }
  return out;
}
/* items: [{ id, x, y, r, w, h, must }] in priority order. Places the labels with statpop.js's placeLabels when it is there,
   then checks the answer: a label that overlaps another, covers a labelled marker or leaves the chart is dropped, so
   whatever the placer does the result never overlaps. Returns [{ id, box, side, anchor }] where anchor is the SVG
   text-anchor the text must use for that side: 'r' and its diagonals start at the box, 'l' ones end at it, 't' and 'b' centre. */
function anchorFor(side) { return side === 'l' || side === 'tl' || side === 'bl' ? 'end' : (side === 't' || side === 'b' ? 'middle' : 'start'); }
function placeNames(items, opts, placer) {
  const fn = placer || (root.EpinoiaStatPop && root.EpinoiaStatPop.placeLabels) || basicPlaceLabels;
  const raw = fn(items, opts) || [];
  const byId = new Map(items.map(i => [i.id, i]));
  const markers = items.map(p => ({ x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r }));
  const kept = [];
  raw.forEach(o => {
    const it = byId.get(o.id), b = o.box;
    if (!it || !b) return;
    if (b.x < 0 || b.y < 0 || b.x + b.w > opts.width || b.y + b.h > opts.height) return;
    if (kept.some(k => ovl(k.box, b)) || markers.some(m => ovl(m, b))) return;
    kept.push({ id: o.id, box: b, side: o.side, anchor: anchorFor(o.side) });
  });
  return kept;
}
/* the arrow keys: the nearest point in the direction, inside a cone of about 70 degrees, else the nearest in the half-plane */
function neighbourInDirection(pts, cur, dir) {
  let best = null, bs = Infinity, fb = null, fs = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p === cur) continue;
    const dx = p.px - cur.px, dy = p.py - cur.py;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (along <= 0.5) continue;
    const perp = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
    const d2 = along * along + perp * perp;
    if (d2 < fs) { fs = d2; fb = p; }
    if (perp <= 2.7 * along) { const s = along * along + 4 * perp * perp; if (s < bs) { bs = s; best = p; } }
  }
  return best || fb;
}

/* ------------------------------------------------------------------ wrapping and the export's geometry --- */
/* greedy word wrap into at most maxLines lines no wider than maxW by `measure`; a word wider than the line is cut; the last line
   ends in an ellipsis when text was left over */
function wrapLines(text, maxW, measure, maxLines) {
  const words = String(text || '').split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  const push = s => lines.push(s);
  for (let w of words) {
    while (measure(w) > maxW && w.length > 1) {
      let k = w.length - 1; while (k > 1 && measure(w.slice(0, k)) > maxW) k--;
      if (cur) { push(cur); cur = ''; }
      push(w.slice(0, k)); w = w.slice(k);
    }
    const t = cur ? cur + ' ' + w : w;
    if (measure(t) <= maxW || !cur) cur = t; else { push(cur); cur = w; }
  }
  if (cur) push(cur);
  if (maxLines > 0 && lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last.length > 1 && measure(last + '…') > maxW) last = last.slice(0, -1);
    keep[maxLines - 1] = last + '…';
    return keep;
  }
  return lines;
}
const EXPORT_SIZES = { shown: null, '1200x675': [1200, 675], '1080x1080': [1080, 1080], '1080x1350': [1080, 1350] };
const EXPORT_SIZE_LABELS = { shown: 'as shown', '1200x675': '1200 × 675', '1080x1080': '1080 × 1080', '1080x1350': '1080 × 1350' };
/* The geometry of an exported image, without touching a DOM.
     o.size      'shown' | '1200x675' | '1080x1080' | '1080x1350'
     o.shown     { w, chartH: [h, ...], side }  what the page is drawing now (used when size is 'shown')
     o.charts    1 | 2
     o.titleLines, o.subLines, o.footLines   how many lines the wrapped texts take (0 when there is none)
     o.credit    a credit line at the foot
   Returns { w, h, unit, pad, title: {x, y, w, lh, size}, sub, foot, credit, charts: [{x, y, w, h}], side } with every rectangle inside
   the canvas and none overlapping another. */
function exportLayout(o) {
  const fixed = EXPORT_SIZES[o.size];
  const n = o.charts === 2 ? 2 : 1;
  const W = fixed ? fixed[0] : Math.max(320, Math.round(o.shown && o.shown.w || 640));
  const u = fixed ? W / 1200 : clamp(W / 1100, 0.6, 1);
  const pad = Math.round(28 * u), gap = Math.round(14 * u);
  const tSize = 24 * u, tLh = Math.round(30 * u), sSize = 13 * u, sLh = Math.round(19 * u), fSize = 11.5 * u, fLh = Math.round(16 * u), cSize = 9.5 * u;
  const tl = o.titleLines || 0, sl = o.subLines || 0, fl = o.footLines || 0;
  const headH = pad + tl * tLh + (sl ? Math.round(4 * u) + sl * sLh : 0) + (tl || sl ? gap : 0);
  const creditH = o.credit ? Math.round(26 * u) : 0;
  const footH = (fl ? fl * fLh + Math.round(10 * u) : 0) + (o.credit ? creditH : Math.round(pad * 0.55));
  const fixedTop = headH, fixedBot = footH;
  let H, side = false;
  const rects = [];
  if (fixed) {
    H = fixed[1];
    const availH = Math.max(80, H - fixedTop - fixedBot), availW = W - 2 * pad;
    if (n === 1) rects.push({ x: pad, y: fixedTop, w: availW, h: availH });
    else {
      side = W / H >= 1.25;
      if (side) { const w = Math.floor((availW - gap) / 2); rects.push({ x: pad, y: fixedTop, w, h: availH }, { x: pad + w + gap, y: fixedTop, w: availW - w - gap, h: availH }); }
      else { const h = Math.floor((availH - gap) / 2); rects.push({ x: pad, y: fixedTop, w: availW, h }, { x: pad, y: fixedTop + h + gap, w: availW, h: availH - h - gap }); }
    }
  } else {
    const sh = o.shown || {}, hs = (sh.chartH && sh.chartH.length ? sh.chartH : [380]).map(v => Math.max(160, Math.round(v)));
    const availW = W - 2 * pad;
    side = n === 2 && !!sh.side;
    if (n === 1) { rects.push({ x: pad, y: fixedTop, w: availW, h: hs[0] }); H = fixedTop + hs[0] + fixedBot; }
    else if (side) { const w = Math.floor((availW - gap) / 2), h = Math.max(hs[0], hs[1]); rects.push({ x: pad, y: fixedTop, w, h }, { x: pad + w + gap, y: fixedTop, w: availW - w - gap, h }); H = fixedTop + h + fixedBot; }
    else { rects.push({ x: pad, y: fixedTop, w: availW, h: hs[0] }, { x: pad, y: fixedTop + hs[0] + gap, w: availW, h: hs[1] }); H = fixedTop + hs[0] + gap + hs[1] + fixedBot; }
  }
  const lastChartBottom = Math.max.apply(null, rects.map(r => r.y + r.h));
  return {
    w: W, h: H, unit: u, pad, side,
    title: { x: pad, y: pad, w: W - 2 * pad, lh: tLh, size: tSize, lines: tl },
    sub: { x: pad, y: pad + tl * tLh + Math.round(4 * u), w: W - 2 * pad, lh: sLh, size: sSize, lines: sl },
    foot: { x: pad, y: lastChartBottom + Math.round(6 * u), w: W - 2 * pad, lh: fLh, size: fSize, lines: fl },
    credit: { x: 0, y: H - creditH, w: W, size: cSize, on: !!o.credit, h: creditH },
    charts: rects
  };
}
const exportPixels = (layout, scale) => [Math.round(layout.w * scale), Math.round(layout.h * scale)];
const slug = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function exportFileName(league, season, title, ext) {
  const a = [slug(league), slug(season), slug(title)].filter(Boolean).join('-').slice(0, 90);
  return (a || 'chart') + '.' + ext;
}

/* ============================================================================================ DRAW === */
const NS = 'http://www.w3.org/2000/svg';
const FONT = { ui: "Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", micro: "Silkscreen, ui-monospace, Menlo, monospace", data: "MartianMono, ui-monospace, Menlo, monospace" };
/* the two grounds, as tokens.css has them, and the three chart colours validated on each (dataviz palette slots 1-3) */
const THEMES = {
  dark: { name: 'dark', dark: true, ground: '#04100b', panel: '#0a1a13', ink: '#e6fff1', ink2: 'rgba(230,255,241,.94)', ink3: 'rgba(230,255,241,.84)',
    rule: 'rgba(147,242,191,.20)', rule2: 'rgba(147,242,191,.44)', amber: '#ffd166', good: '#63ffa0', lume: '#93f2bf',
    s1: '#3987e5', s2: '#d95926', s3: '#199e70', tt: '#050706', ttInk: '#3ff0ff', ttHi: '#ffe44d' },
  light: { name: 'light', dark: false, ground: '#f3faf6', panel: '#ffffff', ink: '#0d1f17', ink2: 'rgba(13,31,23,.95)', ink3: 'rgba(13,31,23,.86)',
    rule: 'rgba(13,31,23,.2)', rule2: 'rgba(13,31,23,.4)', amber: '#714a03', good: '#0a6d43', lume: '#08603f',
    s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', tt: '#050706', ttInk: '#3ff0ff', ttHi: '#ffe44d' }
};
/* the page's own colours (a league's accent, the reader's theme), read from the tokens */
function pageTheme(el) {
  try {
    const cs = getComputedStyle(el || document.body), v = n => (cs.getPropertyValue(n) || '').trim();
    const ground = v('--ground') || THEMES.dark.ground;
    const g = parseHex(ground);
    const base = g && relLum(g) > 0.4 ? THEMES.light : THEMES.dark;
    return Object.assign({}, base, { name: 'page', ground, panel: v('--panel') || base.panel, ink: v('--ink') || base.ink, ink2: v('--ink-2') || base.ink2,
      ink3: v('--ink-3') || base.ink3, rule: v('--rule') || base.rule, rule2: v('--rule-2') || base.rule2, amber: v('--amber') || base.amber,
      good: v('--good') || base.good, lume: v('--lume') || base.lume, dark: !(g && relLum(g) > 0.4) });
  } catch (_) { return Object.assign({ dark: true }, THEMES.dark); }
}

/* text width in the chart's own fonts, by a canvas; a rough guess where there is no canvas (node) */
let _ctx = null;
function measureFn(fontSize, family, weight) {
  const font = (weight || 400) + ' ' + fontSize + 'px ' + family;
  try {
    if (!_ctx && typeof document !== 'undefined') _ctx = document.createElement('canvas').getContext('2d');
    if (_ctx) return s => { _ctx.font = font; return _ctx.measureText(s).width; };
  } catch (_) { /* below */ }
  return s => String(s).length * fontSize * 0.58;
}

const num1 = v => +(+v).toFixed(1);
function S(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}
const initialsOf = n => {
  const p = String(n || '?').trim().split(/\s+/);
  return ((p.length > 1 ? p[0].charAt(0) + p[p.length - 1].charAt(0) : p[0].slice(0, 2)) || '?').toUpperCase();
};
function shortName(n, max) {
  n = String(n || '').trim();
  if (!n) return '';
  const p = n.split(/\s+/);
  const s = p.length > 1 ? p[0].charAt(0) + '. ' + p.slice(1).join(' ') : n;
  return s.length > (max || 15) ? s.slice(0, (max || 15) - 1) + '…' : s;
}
const surname = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : p[0] || ''; };

/* The name a point is labelled with: the reader's own text when there is one; otherwise "L. Nelson" in the smart view,
   "Nelson" when every point is named, and a club's own name (its short code when every club is named on a narrow chart). */
function labelText(ent, kind, names, overrides) {
  const o = overrides && overrides[ent.id];
  if (o) return o;
  if (kind === 'team') { const nm = String(ent.name || ''); return nm.length <= (names === 'a' ? 12 : 18) ? nm : (ent.short && ent.short.length <= 5 ? ent.short : shortName(nm, 18)); }
  if (names === 'a') { const sn = surname(ent.name); return sn.length > 14 ? sn.slice(0, 13) + '…' : sn; }
  return shortName(ent.name, 15);
}

/* The quadrant a chart calls good: both statistics on their better side. 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
function goodQuadrant(cx, cy, xm, ym) {
  const xLow = (xm === 'z' || xm === 'r') ? false : !!cx.low, yLow = (ym === 'z' || ym === 'r') ? false : !!cy.low;
  return (yLow ? 2 : 0) + (xLow ? 0 : 1);
}
/* the words for an axis, by mode */
function axisTitleText(col, mode) {
  const t = col.title || col.name || col.label;
  if (mode === 'd') return t + ' − league avg';
  if (mode === 'p') return t + ': % vs league avg';
  if (mode === 'z') return t + ': z-score' + (col.low ? ' (flipped: lower is better)' : '');
  if (mode === 'r') return t + ': percentile' + (col.low ? ' (flipped: lower is better)' : '');
  return t;
}

/* ------------------------------------------------------------------------- one chart --- */
/* cfg: {
     W, H, fs, theme, uid,
     data      computeChart() result
     kind      'player' | 'team'
     co        'c' club | 'p' position | 'n' none
     size      { get(pt) -> 0..1, label } | null
     names     's' | 'a' | 'n'
     qd, qc, trend            lines at the averages, captions, trend line(s)
     hi        Set of entity ids that are highlighted; must: Set of ids that are pinned (labelled first)
     view      { x: [lo,hi] | null, y: [lo,hi] | null }
     texts     { ax, ay, ay2, aq: [4], lg }  the texts to print (already resolved: an override or the automatic one)
     labels    { id: text } the reader's own point labels
     crest     fn(ent) -> url | null   (the export gives data URIs, the page gives the site's crest url)
     editable  put data-edit attributes on the texts
     legendNote  extra text at the foot of the legend
   }
   Returns { g, hits: [{id, ser, px, py, r, hi}], plot: {x0,x1,y0,y1}, X(v), Y(v), xr, yr, labelled, hidden, legendH } */
function buildChart(cfg) {
  const { W, H, theme: T, data: D } = cfg;
  const fs = cfg.fs || 1, uid = cfg.uid || 'c';
  const g = S('g', { 'data-chart': uid });
  const tk = 10 * fs, small = 8.5 * fs;
  const mData = measureFn(tk, FONT.data, 400), mLab = measureFn(10.5 * fs, FONT.ui, 700), mMic = measureFn(10.5 * fs, FONT.ui, 700), mLeg = measureFn(10 * fs, FONT.ui, 600);
  const pts = D.pts, n = pts.length;
  const hi = cfg.hi || new Set(), pinned = cfg.must || new Set();
  const ovl2 = D.overlay;

  /* ---- ranges, then ticks, then the margins the tick labels need ---- */
  const view = cfg.view || {};
  const xVals = pts.map(p => p.x), yVals = pts.map(p => p.y).concat(ovl2 ? pts.map(p => p.y2) : []);
  const auto = { x: axisRange(xVals, D.xm, D.xlog), y: axisRange(yVals, D.overlay ? 'z' : D.ym, D.ylog) };
  let xr = view.x || auto.x, yr = view.y || auto.y;
  const xTicksN = clamp(Math.floor(W / (78 * fs)), 3, 9), yTicksN = clamp(Math.floor(H / (50 * fs)), 3, 8);
  const tks = (r, mode, log, cnt) => mode === 'r' && !(view.x || view.y) ? { ticks: [0, 25, 50, 75, 100], step: 25 } : (log ? logTicks(r[0], r[1]) : niceTicks(r[0], r[1], cnt));
  let xt = tks(xr, D.xm, D.xlog, xTicksN), yt = tks(yr, D.overlay ? 'z' : D.ym, D.ylog, yTicksN);
  const xDp = D.cx.dp, yDp = D.cy.dp;
  const fmtTick = (v, step, mode, dp, log) => {
    if (log) return v >= 1000 ? (v / 1000) + 'k' : String(+v.toPrecision(3));
    const d = mode === 'z' ? Math.max(1, tickDp(step, 1)) : tickDp(step, mode === 'r' ? 0 : dp);
    const s = Math.abs(v) < 1e-9 ? (0).toFixed(d) : v.toFixed(d);
    return (mode === 'p' ? (v > 0 ? '+' : '') + s + '%' : ((mode === 'd' || mode === 'z') && v > 0 ? '+' + s : s));
  };
  const yTickStr = yt.ticks.map(v => fmtTick(v, yt.step, D.overlay ? 'z' : D.ym, yDp, D.ylog));
  const xTickStr = xt.ticks.map(v => fmtTick(v, xt.step, D.xm, xDp, D.xlog));
  const maxYW = Math.max(12, ...yTickStr.map(s => mData(s)));

  /* ---- the legend rows (drawn at the top) decide the top margin ---- */
  const legend = legendItems(cfg, D);
  const lRows = layoutLegend(legend, W - 16 * fs - (cfg.zoomSpace || 0), mLeg, 10 * fs, 18 * fs);
  const legendH = lRows.length ? lRows.length * 15 * fs + 4 * fs : 0;
  const capOn = !!(cfg.texts && cfg.texts.lg);
  const capLines = capOn ? wrapLines(cfg.texts.lg, W - 20 * fs - (cfg.zoomSpace || 0), measureFn(9.5 * fs, FONT.ui, 500), 3) : [];
  const capH = capLines.length ? capLines.length * 12.5 * fs + 2 * fs : 0;
  const m = { l: Math.round(maxYW + 30 * fs), r: Math.round(14 * fs), t: Math.round(8 * fs + legendH + capH), b: Math.round(48 * fs) };
  const x0 = m.l, x1 = W - m.r, y0 = m.t, y1 = H - m.b;
  const pw = Math.max(40, x1 - x0), ph = Math.max(40, y1 - y0);
  const lin = (v, a, b, p0, p1) => p0 + (v - a) / (b - a) * (p1 - p0);
  const X = v => D.xlog ? lin(Math.log10(v), Math.log10(xr[0]), Math.log10(xr[1]), x0, x0 + pw) : lin(v, xr[0], xr[1], x0, x0 + pw);
  const Y = v => D.ylog ? lin(Math.log10(v), Math.log10(yr[0]), Math.log10(yr[1]), y0 + ph, y0) : lin(v, yr[0], yr[1], y0 + ph, y0);
  const clipId = uid + '-clip';
  const defs = S('defs'); g.appendChild(defs);
  defs.appendChild(S('clipPath', { id: clipId }, null)).appendChild(S('rect', { x: x0, y: y0 - 1, width: pw, height: ph + 2 }));

  /* ---- legend and caption ---- */
  const ed = (attrs, key) => { if (cfg.editable && key) { attrs['data-edit'] = key; attrs.class = ((attrs.class || '') + ' cl-ed').trim(); } return attrs; };
  {
    const lg = S('g', { class: 'cl-legend' }); g.appendChild(lg);
    lRows.forEach((row, ri) => row.forEach(it => {
      const cy = 8 * fs + ri * 15 * fs + 4 * fs;
      if (it.type === 'dot') lg.appendChild(S('circle', { cx: num1(it.x + 4 * fs), cy, r: 4 * fs, fill: it.colour }));
      else if (it.type === 'diamond') { const r = 4.6 * fs, cx = it.x + 4 * fs; lg.appendChild(S('path', { d: 'M' + num1(cx - r) + ' ' + cy + 'L' + num1(cx) + ' ' + num1(cy - r) + 'L' + num1(cx + r) + ' ' + cy + 'L' + num1(cx) + ' ' + num1(cy + r) + 'Z', fill: it.colour })); }
      else if (it.type === 'line') lg.appendChild(S('line', { x1: it.x, x2: it.x + 14 * fs, y1: cy, y2: cy, stroke: it.colour, 'stroke-width': 1.6 }));
      else if (it.type === 'size') { lg.appendChild(S('circle', { cx: it.x + 3 * fs, cy, r: 2.2 * fs, fill: 'none', stroke: T.ink3, 'stroke-width': 1.2 })); lg.appendChild(S('circle', { cx: it.x + 11 * fs, cy, r: 4.4 * fs, fill: 'none', stroke: T.ink3, 'stroke-width': 1.2 })); }
      else if (it.type === 'ring') { lg.appendChild(S('circle', { cx: it.x + 5 * fs, cy, r: 4.6 * fs, fill: 'none', stroke: T.ink, 'stroke-width': 1.6 })); }
      if (it.text) lg.appendChild(S('text', { x: num1(it.x + it.iw), y: cy + 3.5 * fs, fill: it.muted ? T.ink3 : T.ink2, 'font-size': 10 * fs, 'font-family': FONT.ui, 'font-weight': 600 }, it.text));
    }));
    if (capLines.length) {
      const y = 8 * fs + legendH + 2 * fs;
      const t = S('text', ed({ x: 10 * fs, y: y + 9 * fs, fill: T.ink3, 'font-size': 9.5 * fs, 'font-family': FONT.ui, 'font-weight': 500 }, 'lg'));
      capLines.forEach((ln, i) => t.appendChild(S('tspan', { x: 10 * fs, dy: i ? 12.5 * fs : 0 }, ln)));
      g.appendChild(t);
    }
  }

  /* ---- grid, axes, ticks (only inside the frame; the clip keeps a zoomed chart honest) ---- */
  const grid = S('g', { class: 'cl-grid' }); g.appendChild(grid);
  xt.ticks.forEach((v, i) => {
    const x = num1(X(v));
    if (x < x0 - 0.5 || x > x0 + pw + 0.5) return;
    grid.appendChild(S('line', { x1: x, x2: x, y1: y0, y2: y0 + ph, stroke: T.rule, 'stroke-width': 1 }));
    grid.appendChild(S('text', { x, y: y0 + ph + 5 * fs + tk, 'text-anchor': 'middle', fill: T.ink3, 'font-size': tk, 'font-family': FONT.data }, xTickStr[i]));
  });
  yt.ticks.forEach((v, i) => {
    const y = num1(Y(v));
    if (y < y0 - 0.5 || y > y0 + ph + 0.5) return;
    grid.appendChild(S('line', { x1: x0, x2: x0 + pw, y1: y, y2: y, stroke: T.rule, 'stroke-width': 1 }));
    grid.appendChild(S('text', { x: x0 - 5 * fs, y: y + tk * 0.36, 'text-anchor': 'end', fill: T.ink3, 'font-size': tk, 'font-family': FONT.data }, yTickStr[i]));
  });
  g.appendChild(S('line', { x1: x0, x2: x0 + pw, y1: y0 + ph, y2: y0 + ph, stroke: T.rule2, 'stroke-width': 1 }));
  g.appendChild(S('line', { x1: x0, x2: x0, y1: y0, y2: y0 + ph, stroke: T.rule2, 'stroke-width': 1 }));

  /* ---- quadrants: the tint on the both-better quarter, the lines through the averages, the captions ---- */
  const cl = S('g', { 'clip-path': 'url(#' + clipId + ')' }); g.appendChild(cl);
  const xMid = D.xm === 'a' ? D.tx.mean : (D.xm === 'r' ? 50 : 0);
  const yMidSrc = D.overlay ? 0 : (D.ym === 'a' ? D.ty.mean : (D.ym === 'r' ? 50 : 0));
  const okMid = isNum(xMid) && isNum(yMidSrc) && (!D.xlog || xMid > 0) && (!D.ylog || yMidSrc > 0);
  const mx = okMid ? X(xMid) : null, my = okMid ? Y(yMidSrc) : null;
  const inX = mx != null && mx > x0 && mx < x0 + pw, inY = my != null && my > y0 && my < y0 + ph;
  if (cfg.qc && okMid) {
    const q = goodQuadrant(D.cx, D.cy, D.xm, D.overlay ? 'z' : D.ym);
    const qx0 = clamp(mx, x0, x0 + pw), qy0 = clamp(my, y0, y0 + ph);
    const rx = (q & 1) ? qx0 : x0, rw = (q & 1) ? x0 + pw - qx0 : qx0 - x0, ry = (q & 2) ? qy0 : y0, rh = (q & 2) ? y0 + ph - qy0 : qy0 - y0;
    if (rw > 0 && rh > 0) cl.appendChild(S('rect', { x: num1(rx), y: num1(ry), width: num1(rw), height: num1(rh), fill: T.good, opacity: 0.07 }));
  }
  if (cfg.qd && okMid) {
    if (inX) cl.appendChild(S('line', { x1: num1(mx), x2: num1(mx), y1: y0, y2: y0 + ph, stroke: T.amber, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
    if (inY) cl.appendChild(S('line', { x1: x0, x2: x0 + pw, y1: num1(my), y2: num1(my), stroke: T.amber, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
    if (inX) cl.appendChild(S('text', { x: num1(mx + 4), y: y0 + 9 * fs, fill: T.ink2, 'font-size': small, 'font-family': FONT.micro }, midLabel(D, 'x', xMid)));
    if (inY) cl.appendChild(S('text', { x: x1 - 3, y: num1(my - 4), 'text-anchor': 'end', fill: T.ink2, 'font-size': small, 'font-family': FONT.micro }, midLabel(D, 'y', yMidSrc)));
  }

  /* ---- the trend line(s) ---- */
  if (cfg.trend && D.trend.length) {
    D.trend.forEach((tr, k) => {
      const col = D.overlay ? (k ? T.s2 : T.s1) : T.ink2;
      const steps = D.xlog || D.ylog ? 28 : 2, d = [];
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const xv = D.xlog ? Math.pow(10, Math.log10(xr[0]) + f * (Math.log10(xr[1]) - Math.log10(xr[0]))) : xr[0] + f * (xr[1] - xr[0]);
        const yv = tr.slope * (D.xlog ? Math.log10(xv) : xv) + tr.intercept;
        const yy = D.ylog ? Math.pow(10, yv) : yv;
        if (!isNum(yy) || (D.ylog && yy <= 0)) continue;
        d.push((d.length ? 'L' : 'M') + num1(X(xv)) + ' ' + num1(Y(yy)));
      }
      if (d.length > 1) cl.appendChild(S('path', { d: d.join(''), fill: 'none', stroke: col, 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.9, 'stroke-dasharray': k ? '7 4' : null }));
    });
  }

  /* ---- the dots: one path per colour, every circle its own size; the rest dim when something is highlighted ---- */
  const dimOn = hi.size > 0;
  const baseR = (n <= 40 ? 5 : n <= 150 ? 4.3 : n <= 400 ? 3.6 : 3.1) * fs;
  const rOf = p => cfg.size ? (2.4 + 6.4 * Math.sqrt(cfg.size.get(p))) * fs * (n > 300 ? 0.75 : 1) : baseR;
  const colourOf = (p, ser) => {
    if (ovl2) return ser ? T.s2 : T.s1;
    const e = p.e;
    if (cfg.co === 'c') return markColour(e.colour, T.ground) || T.ink3;
    if (cfg.co === 'p') return e.pos === 'G' ? T.s1 : e.pos === 'F' ? T.s2 : e.pos === 'C' ? T.s3 : T.ink3;
    return T.ink3;
  };
  const circ = (x, y, r) => 'M' + num1(x - r) + ' ' + num1(y) + 'a' + num1(r) + ' ' + num1(r) + ' 0 1 0 ' + num1(2 * r) + ' 0a' + num1(r) + ' ' + num1(r) + ' 0 1 0 ' + num1(-2 * r) + ' 0Z';
  const dia = (x, y, r) => { r *= 1.15; return 'M' + num1(x - r) + ' ' + num1(y) + 'L' + num1(x) + ' ' + num1(y - r) + 'L' + num1(x + r) + ' ' + num1(y) + 'L' + num1(x) + ' ' + num1(y + r) + 'Z'; };
  const paths = new Map(), hits = [];
  const inPlot = (px, py) => px >= x0 - 1 && px <= x0 + pw + 1 && py >= y0 - 1 && py <= y0 + ph + 1;
  const placedPts = [];
  pts.forEach(p => {
    const sers = ovl2 ? [0, 1] : [0];
    sers.forEach(ser => {
      const yv = ser ? p.y2 : p.y;
      if ((D.xlog && p.x <= 0) || (D.ylog && yv <= 0)) return;
      const px = X(p.x), py = Y(yv);
      if (!isFinite(px) || !isFinite(py)) return;
      const isHi = hi.has(p.e.id);
      const r = rOf(p);
      const rec = { id: p.e.id, ser, px, py, r: isHi ? 11 * fs : r, hi: isHi, p, inside: inPlot(px, py) };
      hits.push(rec);
      if (!rec.inside) return;
      if (isHi) { placedPts.push(rec); if (!ovl2 || !ser) return; }
      const col = colourOf(p, ser);
      const key = col + '|' + ser;
      let e = paths.get(key);
      if (!e) { e = { col, ser, d: [] }; paths.set(key, e); }
      e.d.push(ser ? dia(px, py, r) : circ(px, py, r));
    });
  });
  const ring = n <= 80;
  const dots = S('g', { 'clip-path': 'url(#' + clipId + ')', class: 'cl-dots', opacity: dimOn ? (T.dark ? 0.4 : 0.28) : null }); g.appendChild(dots);
  paths.forEach(e => dots.appendChild(S('path', { d: e.d.join(''), fill: e.col, 'fill-opacity': n > 250 ? 0.66 : 0.92, stroke: ring ? T.ground : null, 'stroke-width': ring ? 1.6 : null })));

  /* ---- highlighted entities: coloured discs with initials, or the club's crest ---- */
  const discs = S('g', { class: 'cl-discs', 'clip-path': 'url(#' + clipId + ')' }); g.appendChild(discs);
  const nHi = placedPts.filter(r => !r.ser).length;
  const R = (nHi > 10 ? 8.5 : 11) * fs;
  const byId = new Map();
  placedPts.forEach(rec => { if (!rec.ser) byId.set(rec.id, rec); rec.r = R; });
  hits.forEach(h => { if (h.hi) h.r = R; });
  let k = 0;
  placedPts.forEach(rec => {
    const e = rec.p.e, col = markColour(e.colour, T.ground) || T.lume, url = cfg.crest ? cfg.crest(e) : null;
    const gg = S('g', { transform: 'translate(' + num1(rec.px) + ' ' + num1(rec.py) + ')', 'data-id': e.id });
    if (ovl2) {
      /* both of his dots are joined, so the pair reads as one player */
      const other = pts.find(q => q.e.id === e.id);
      if (other) discs.appendChild(S('line', { x1: num1(X(other.x)), x2: num1(X(other.x)), y1: num1(Y(other.y)), y2: num1(Y(other.y2)), stroke: T.ink3, 'stroke-width': 1, opacity: 0.8 }));
    }
    if (rec.ser) return;
    gg.appendChild(S('circle', { r: R + 1.2, fill: T.ground }));
    gg.appendChild(S('circle', { r: R, fill: col }));
    gg.appendChild(S('text', { y: R * 0.33, 'text-anchor': 'middle', fill: inkOn(col), 'font-size': Math.round(R * 0.82 * 10) / 10, 'font-weight': 800, 'font-family': FONT.ui }, initialsOf(cfg.kind === 'team' ? (e.short || e.name) : e.name)));
    if (url) {
      const cid = uid + '-c' + (k++);
      gg.appendChild(S('circle', { r: R - 1, fill: '#fff', 'data-crest': 1 }));
      const cp = S('clipPath', { id: cid }); cp.appendChild(S('circle', { r: R - 1.6 })); defs.appendChild(cp);
      const im = S('image', { href: url, x: -R + 1.6, y: -R + 1.6, width: 2 * R - 3.2, height: 2 * R - 3.2, 'clip-path': 'url(#' + cid + ')', preserveAspectRatio: 'xMidYMid meet', 'data-crest': 1 });
      gg.appendChild(im);
    }
    gg.appendChild(S('circle', { r: R, fill: 'none', stroke: T.ink, 'stroke-width': 1.5 }));
    discs.appendChild(gg);
  });

  /* ---- names ---- */
  const labelled = [];
  let hiddenLabels = 0, wanted = 0;
  if (cfg.names !== 'n' && n) {
    const ordered = labelOrder(cfg, D, hits.filter(h => h.inside && !h.ser), { x0, y0, pw, ph });
    /* a chart this size holds a couple of hundred names at most: the placer is offered that many, the rest are counted as left out */
    const cap = cfg.names === 'a' ? clamp(Math.round(pw * ph / 320), 60, 320) : ordered.length;
    const list = ordered.slice(0, cap), tooMany = ordered.length - list.length;
    const items = [];
    list.forEach(rec => {
      const txt = labelText(rec.p.e, cfg.kind, cfg.names, cfg.labels);
      if (!txt) return;
      const w = Math.ceil(mLab(txt) + 6 * fs), h = Math.round(14.5 * fs);
      items.push({ id: rec.id, x: rec.px - x0, y: rec.py - y0, r: (rec.hi ? R : rec.r) + 1, w, h, must: pinned.has(rec.id), text: txt, rec });
    });
    wanted = items.length + tooMany;
    /* the average lines' own words and the quadrant captions are kept clear: each is offered to the placer as a row of small
       fixed markers, which no label may cover */
    const mSm = measureFn(small, FONT.micro, 400), mCap = measureFn(9.5 * fs, FONT.ui, 700), keepOut = [];
    const box = (x, y, w, hh) => keepOut.push({ x, y, w: w + 4, h: hh });
    if (cfg.qd && okMid) {
      if (inX) box(mx + 4 - x0, 9 * fs - small, mSm(midLabel(D, 'x', xMid)), small + 3);
      if (inY) { const w = mSm(midLabel(D, 'y', yMidSrc)); box(pw - 3 - w, my - 4 - y0 - small, w, small + 3); }
    }
    if (cfg.qc && okMid) {
      const qs = quadrantTexts(D, cfg.texts);
      [0, 1, 2, 3].forEach(i => {
        const w = Math.min(mCap(qs[i]) + qs[i].length * fs * 0.2, pw * 0.46), yb = i < 2 ? 21 * fs : ph - 7 * fs;
        box(i % 2 ? pw - 6 - w : 6, yb - 9.5 * fs, w, 9.5 * fs + 3);
      });
    }
    keepOut.forEach((k, ki) => {
      const cnt = Math.max(1, Math.ceil(k.w / Math.max(6, k.h)));
      for (let j = 0; j < cnt; j++) items.push({ id: '~k' + ki + '-' + j, x: k.x + (j + 0.5) * k.w / cnt, y: k.y + k.h / 2, r: k.h / 2 + 1, w: 0, h: 0, must: true, text: '', keep: true });
    });
    const max = cfg.names === 'a' ? Infinity : clamp(Math.round(pw * ph / 21000), 3, 16);
    const out = placeNames(items, { width: pw, height: ph, gap: 3, max }, cfg.placer).filter(o => o.id.charAt(0) !== '~');
    const byItem = new Map(items.map(i => [i.id, i]));
    const lg = S('g', { class: 'cl-labels', 'clip-path': 'url(#' + clipId + ')' }); g.appendChild(lg);
    out.forEach(o => {
      const it = byItem.get(o.id), b = o.box;
      const tx = o.anchor === 'end' ? b.x + b.w - 3 * fs : o.anchor === 'middle' ? b.x + b.w / 2 : b.x + 3 * fs;
      const t = S('text', ed({ x: num1(x0 + tx), y: num1(y0 + b.y + b.h * 0.76), 'text-anchor': o.anchor, fill: pinned.has(o.id) || hi.has(o.id) ? T.ink : T.ink2, 'font-size': 10.5 * fs,
        'font-weight': 700, 'font-family': FONT.ui, stroke: T.ground, 'stroke-width': 3 * fs, 'stroke-linejoin': 'round', 'paint-order': 'stroke', 'data-id': o.id }, cfg.editable ? 'lb' : null), it.text);
      lg.appendChild(t);
      labelled.push({ id: o.id, x: x0 + b.x, y: y0 + b.y, w: b.w, h: b.h, text: it.text });
    });
    hiddenLabels = wanted - out.length;
    if (cfg.names === 'a' && hiddenLabels > 0) g.appendChild(S('text', { x: x0, y: H - 6 * fs, fill: T.ink3, 'font-size': 9.5 * fs, 'font-family': FONT.ui, 'font-weight': 600 }, out.length + ' of ' + wanted + ' names shown · ' + hiddenLabels + ' left out where they would overlap'));
  }

  /* ---- axis titles, arrows, corner captions ---- */
  const T_ = cfg.texts || {};
  const xTitle = T_.ax || axisTitleText(D.cx, D.xm);
  const yTitle = T_.ay || axisTitleText(D.cy, D.ym);
  const fit = (s, maxW, m) => { const l = wrapLines(s, maxW, m, 1); return l.length ? l[0] : ''; };
  g.appendChild(S('text', ed({ x: num1(x0 + pw / 2), y: H - 20 * fs, 'text-anchor': 'middle', fill: T.ink2, 'font-size': 10.5 * fs, 'font-family': FONT.ui, 'font-weight': 700, 'letter-spacing': '0.03em' }, 'x'), fit(xTitle, pw * 0.72, mMic)));
  const yLabel = D.overlay ? (T_.ay || D.cy.title + ' & ' + D.cy2.title + ': z-scores') : yTitle;
  g.appendChild(S('text', ed({ transform: 'translate(' + num1(11 * fs) + ' ' + num1(y0 + ph / 2) + ') rotate(-90)', 'text-anchor': 'middle', fill: T.ink2, 'font-size': 10.5 * fs, 'font-family': FONT.ui, 'font-weight': 700, 'letter-spacing': '0.03em' }, 'y'), fit(yLabel, Math.max(50, ph - 2 * (measureFn(small, FONT.micro, 400)('better') + 18 * fs)), mMic)));
  {
    /* the direction that is better, in words and an arrow: at the foot of X, up the side of Y (both turned round for a
       lower-is-better statistic; z-scores and percentiles are already turned, so their arrows always point up and right) */
    const eff = (mode, col) => (mode === 'z' || mode === 'r') ? false : !!col.low;
    const xLowE = eff(D.xm, D.cx), yLowE = D.overlay ? false : eff(D.ym, D.cy);
    const wB = measureFn(small, FONT.micro, 400)('better');
    const tri = (x, y, dir) => S('path', { d: dir > 0 ? 'M0 -3.4L5.4 0L0 3.4Z' : 'M0 -3.4L-5.4 0L0 3.4Z', fill: T.good, transform: 'translate(' + num1(x) + ' ' + num1(y) + ') scale(' + fs + ')' });
    const bx = S('g', { class: 'cl-better' });
    const gx = S('g', { transform: 'translate(' + num1(x0 + pw) + ' ' + num1(H - 6 * fs) + ')' });
    gx.appendChild(S('text', { x: xLowE ? 0 : -9 * fs, y: 0, 'text-anchor': 'end', fill: T.ink3, 'font-size': small, 'font-family': FONT.micro }, 'better'));
    gx.appendChild(tri(xLowE ? -wB - 6 * fs : -4.5 * fs, -small * 0.36, xLowE ? -1 : 1));
    bx.appendChild(gx);
    const y0r = yLowE ? y0 + ph - 9 * fs : y0 + wB + 9 * fs;
    const gy = S('g', { transform: 'translate(' + num1(9.5 * fs) + ' ' + num1(y0r) + ') rotate(-90)' });
    gy.appendChild(S('text', { x: 0, y: 0, 'text-anchor': 'start', fill: T.ink3, 'font-size': small, 'font-family': FONT.micro }, 'better'));
    gy.appendChild(tri(yLowE ? -4.5 * fs : wB + 4.5 * fs, -small * 0.36, yLowE ? -1 : 1));
    bx.appendChild(gy);
    g.appendChild(bx);
  }
  if (cfg.qc && okMid) {
    const qs = quadrantTexts(D, cfg.texts);
    const cap = (i, x, y, anchor) => g.appendChild(S('text', ed({ x: num1(x), y: num1(y), 'text-anchor': anchor, fill: T.ink3, 'font-size': 9.5 * fs, 'font-family': FONT.ui, 'font-weight': 700, 'letter-spacing': '0.02em' }, 'q' + i), fit(qs[i], pw * 0.46, measureFn(9.5 * fs, FONT.ui, 700))));
    cap(0, x0 + 6, y0 + 13 * fs + 8 * fs, 'start'); cap(1, x0 + pw - 6, y0 + 13 * fs + 8 * fs, 'end');
    cap(2, x0 + 6, y0 + ph - 7 * fs, 'start'); cap(3, x0 + pw - 6, y0 + ph - 7 * fs, 'end');
  }
  return { g, hits, plot: { x0, y0, x1: x0 + pw, y1: y0 + ph, w: pw, h: ph }, X, Y, xr, yr, auto, xt, yt, labelled, hiddenLabels, wanted, legend, margins: m, R, clipId };
}
const midLabel = (D, ax, v) => {
  const mode = ax === 'x' ? D.xm : (D.overlay ? 'z' : D.ym), c = ax === 'x' ? D.cx : D.cy;
  if (mode === 'r') return '50th';
  if (mode === 'a') return 'avg ' + fmtMode(v, 'a', c.dp, c.signed);
  return '0 = avg';
};
/* the four corner captions: an override, or "low PPG · high TS%" (the statistics' own short labels) */
function quadrantTexts(D, texts) {
  const xl = D.cx.label, yl = D.overlay ? 'both' : D.cy.label;
  const auto = i => {
    const right = (i & 1) === 1, top = i < 2;
    if (D.overlay) return (right ? 'high ' : 'low ') + xl + ' · ' + (top ? 'above' : 'below') + ' avg';
    return (right ? 'high ' : 'low ') + xl + ' · ' + (top ? 'high ' : 'low ') + yl;
  };
  return [0, 1, 2, 3].map(i => (texts && texts['aq' + i]) || auto(i));
}
/* what the legend says: series, colour, size, trend, highlights, the count */
function legendItems(cfg, D) {
  const T = cfg.theme, out = [];
  if (D.overlay) {
    out.push({ type: 'dot', colour: T.s1, text: D.cy.label + ' (z)' + (D.cy.low ? ', flipped' : '') }, { type: 'diamond', colour: T.s2, text: D.cy2.label + ' (z)' + (D.cy2.low ? ', flipped' : '') });
  } else if (cfg.co === 'p') {
    out.push({ type: 'dot', colour: T.s1, text: 'guards' }, { type: 'dot', colour: T.s2, text: 'wings' }, { type: 'dot', colour: T.s3, text: 'bigs' });
  } else if (cfg.co === 'c') out.push({ type: 'none', text: 'colour = club', muted: true });
  if (cfg.size) out.push({ type: 'size', text: 'size = ' + cfg.size.label });
  if (cfg.trend && D.trend.length) D.trend.forEach((tr, i) => out.push({ type: 'line', colour: D.overlay ? (i ? T.s2 : T.s1) : T.ink2,
    text: 'trend' + (tr.r == null ? '' : ' r = ' + tr.r.toFixed(2)) + ' (n ' + tr.n + ')' }));
  if (cfg.hi && cfg.hi.size) out.push({ type: 'ring', text: 'highlighted' });
  const notes = [];
  notes.push(D.pts.length + ' plotted');
  if (D.noValue) notes.push(D.noValue + ' without a value');
  if (D.logDropped) notes.push(D.logDropped + ' not above 0 (log)');
  out.push({ type: 'none', text: notes.join(' · '), muted: true, right: true });
  return out;
}
/* flows the items into rows no wider than `maxW`; `right` items sit at the end of the last row */
function layoutLegend(items, maxW, measure, iconW, gap) {
  const rows = [[]];
  let x = 8, r = 0;
  const seq = items.filter(i => !i.right).concat(items.filter(i => i.right));
  seq.forEach(it => {
    const hasIcon = it.type !== 'none';
    const iw = hasIcon ? (it.type === 'line' ? 18 : it.type === 'size' ? 22 : 13) * (iconW / 10) : 0;
    const w = iw + (it.text ? measure(it.text) : 0);
    if (x + w > maxW && rows[r].length) { rows.push([]); r++; x = 8; }
    rows[r].push(Object.assign({}, it, { x, iw, w }));
    x += w + gap;
  });
  return rows.filter(row => row.length);
}
/* the order labels are offered in: pinned first, then the highlighted club's, then the extremes and the outliers (smart),
   or the most isolated first (every name, so a crowd gives way to the lone points) */
function labelOrder(cfg, D, recs, plot) {
  const hi = cfg.hi || new Set(), must = cfg.must || new Set();
  const first = recs.filter(r => must.has(r.id)), second = recs.filter(r => hi.has(r.id) && !must.has(r.id));
  const rest = recs.filter(r => !hi.has(r.id));
  const uniq = [];
  const seen = new Set();
  const add = r => { if (r && !seen.has(r.id)) { seen.add(r.id); uniq.push(r); } };
  first.forEach(add); second.forEach(add);
  if (cfg.names === 'a') {
    /* the most isolated points first (a crowd gives way to the lone points): crowding is counted in 16px cells, so it costs one pass */
    const cell = r => Math.floor(r.px / 16) + ',' + Math.floor(r.py / 16), cnt = new Map();
    rest.forEach(r => { const k = cell(r); cnt.set(k, (cnt.get(k) || 0) + 1); });
    const crowd = r => { const cx = Math.floor(r.px / 16), cy = Math.floor(r.py / 16); let c = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) c += cnt.get((cx + i) + ',' + (cy + j)) || 0; return c; };
    const score = new Map(rest.map(r => [r.id, crowd(r)]));
    rest.slice().sort((a, b) => (score.get(a.id) - score.get(b.id)) || (b.p.x + b.p.y - a.p.x - a.p.y)).forEach(add);
    return uniq;
  }
  if (!rest.length) return uniq;
  const bestBy = (get, dir) => rest.reduce((b, r) => (b == null || dir * (get(r) - get(b)) > 0 ? r : b), null);
  const xs = D.cx.low && D.xm !== 'z' && D.xm !== 'r' ? -1 : 1, ys = D.cy.low && D.ym !== 'z' && D.ym !== 'r' ? -1 : 1;
  const mean = (a, f) => a.reduce((s, r) => s + f(r), 0) / a.length;
  const mxv = mean(rest, r => r.p.x), myv = mean(rest, r => r.p.y);
  const sdx = Math.sqrt(mean(rest, r => (r.p.x - mxv) * (r.p.x - mxv))) || 1, sdy = Math.sqrt(mean(rest, r => (r.p.y - myv) * (r.p.y - myv))) || 1;
  const zx = r => (r.p.x - mxv) / sdx, zy = r => (r.p.y - myv) / sdy;
  add(bestBy(r => xs * zx(r) + ys * zy(r), 1));
  add(bestBy(r => ys * zy(r), 1)); add(bestBy(r => xs * zx(r), 1));
  add(bestBy(r => ys * zy(r), -1)); add(bestBy(r => xs * zx(r), -1));
  add(bestBy(r => xs * zx(r) + ys * zy(r), -1));
  rest.slice().sort((a, b) => (zx(b) * zx(b) + zy(b) * zy(b)) - (zx(a) * zx(a) + zy(a) * zy(a))).slice(0, 14).forEach(add);
  return uniq;
}

/* ========================================================================================= EXPORT === */
const b64 = buf => {
  const a = new Uint8Array(buf); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
};
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
/* the site's four faces as @font-face rules with the files inlined, so an exported SVG or PNG looks the same anywhere */
let _fonts = null;
function fontCSS() {
  if (_fonts) return _fonts;
  _fonts = (async () => {
    let base = '../kit/fonts/';
    try {
      const l = [...document.querySelectorAll('link[rel="stylesheet"]')].map(x => x.href).find(h => /\/kit\/[^/?]+\.css/.test(h));
      if (l) base = l.replace(/[^/]*$/, '') + 'fonts/';
    } catch (_) { /* the default */ }
    const faces = [['Silkscreen', 'silkscreen.woff2', '400'], ['Archivo', 'archivo.woff2', '100 900'], ['MartianMono', 'martian.woff2', '100 800'], ['Jersey25', 'jersey25.woff2', '400']];
    const parts = await Promise.all(faces.map(async f => {
      try {
        const r = await withTimeout(fetch(new URL(f[1], base).href), 6000);
        if (!r || !r.ok) return '';
        return '@font-face{font-family:\'' + f[0] + '\';src:url(data:font/woff2;base64,' + b64(await r.arrayBuffer()) + ') format(\'woff2\');font-weight:' + f[2] + ';font-style:normal}';
      } catch (_) { return ''; }
    }));
    return parts.join('\n');
  })();
  return _fonts;
}
/* a crest as a data URI, where the browser lets us have it: a fetch (the site's own storage answers with CORS), else the
   image drawn to a canvas (the canvas stays clean only if the host sent CORS headers). null when neither works. */
const _crests = new Map();
function crestData(url) {
  if (_crests.has(url)) return _crests.get(url);
  const viaFetch = async () => {
    try {
      const r = await fetch(url, { mode: 'cors' });
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
    } catch (_) { return null; }
  };
  const viaImage = () => new Promise(res => {
    try {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { try { const c = document.createElement('canvas'); c.width = 96; c.height = 96; const x = c.getContext('2d');
        const k = Math.min(96 / im.naturalWidth, 96 / im.naturalHeight) || 1, w = im.naturalWidth * k, h = im.naturalHeight * k;
        x.drawImage(im, (96 - w) / 2, (96 - h) / 2, w, h); res(c.toDataURL('image/png')); } catch (_) { res(null); } };
      im.onerror = () => res(null);
      im.src = url;
    } catch (_) { res(null); }
  });
  const p = (async () => (await withTimeout(viaFetch(), 4000)) || (await withTimeout(viaImage(), 4000)))();
  _crests.set(url, p);
  return p;
}
const longDate = () => { try { return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };

/* Builds the exported picture as an SVG element. o: {
     size, theme: 'page'|'light'|'dark', transparent, credit,
     texts: { title, sub, foot, credit },
     charts: [ (rect, fs, theme, crestFn) => buildChart config ],
     shown: { w, chartH: [], side },
     pageEl, crest: fn(entity) -> data URI | null, fonts: css string
   }  Returns { svg, w, h, layout, crests: { used, missing } } */
function composeExport(o) {
  const theme = o.theme === 'light' ? THEMES.light : o.theme === 'dark' ? THEMES.dark : pageTheme(o.pageEl);
  const n = o.charts.length;
  const base = exportLayout({ size: o.size, shown: o.shown, charts: n, credit: false });
  const u = base.unit, W = base.w;
  const mT = measureFn(24 * u, "Jersey25, " + FONT.ui, 400), mS = measureFn(13 * u, FONT.ui, 500), mF = measureFn(11.5 * u, FONT.ui, 500);
  const inner = W - 2 * base.pad;
  const tl = wrapLines(o.texts.title || '', inner, mT, 3), sl = wrapLines(o.texts.sub || '', inner, mS, 3), fl = wrapLines(o.texts.foot || '', inner, mF, 3);
  const L = exportLayout({ size: o.size, shown: o.shown, charts: n, titleLines: tl.length, subLines: sl.length, footLines: fl.length, credit: !!o.credit });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS); svg.setAttribute('width', L.w); svg.setAttribute('height', L.h); svg.setAttribute('viewBox', '0 0 ' + L.w + ' ' + L.h);
  svg.appendChild(S('style', null, (o.fonts || '') + '\ntext{font-kerning:normal}'));
  if (!o.transparent) svg.appendChild(S('rect', { x: 0, y: 0, width: L.w, height: L.h, fill: theme.ground }));
  if (!o.transparent) svg.appendChild(S('rect', { x: 0, y: 0, width: L.w, height: Math.max(3, Math.round(4 * u)), fill: theme.lume }));
  const txt = (lines, box, attrs) => {
    if (!lines.length) return;
    const t = S('text', Object.assign({ x: box.x, y: box.y + box.size * 1.0, 'font-size': box.size }, attrs));
    lines.forEach((ln, i) => t.appendChild(S('tspan', { x: box.x, dy: i ? box.lh : 0 }, ln)));
    svg.appendChild(t);
  };
  txt(tl, Object.assign({}, L.title, { y: L.title.y + L.title.lh * 0.12 }), { fill: theme.ink, 'font-family': "Jersey25, " + FONT.ui, 'font-weight': 400, 'letter-spacing': '0.02em' });
  txt(sl, Object.assign({}, L.sub, { y: L.sub.y + L.sub.lh * 0.1 }), { fill: theme.ink2, 'font-family': FONT.ui, 'font-weight': 500 });
  const crestUsed = new Set(), crestMissing = new Set();
  const fs = clamp(u * 1.1, 0.9, 1.4);
  L.charts.forEach((r, i) => {
    const cfg = o.charts[i](r, fs, theme, e => { const d = o.crest ? o.crest(e) : null; if (d) crestUsed.add(e.id); else if (o.wantCrest && o.wantCrest(e)) crestMissing.add(e.id); return d; });
    const built = buildChart(cfg);
    const gg = S('g', { transform: 'translate(' + r.x + ' ' + r.y + ')' });
    if (!o.transparent) gg.appendChild(S('rect', { x: 0.5, y: 0.5, width: r.w - 1, height: r.h - 1, fill: 'none', stroke: theme.rule2, 'stroke-width': 1 }));
    gg.appendChild(built.g);
    svg.appendChild(gg);
  });
  txt(fl, L.foot, { fill: theme.ink3, 'font-family': FONT.ui, 'font-weight': 500 });
  if (L.credit.on) {
    const cy = L.h - L.credit.h;
    svg.appendChild(S('rect', { x: 0, y: cy, width: L.w, height: L.credit.h, fill: '#050706' }));
    const chipW = Math.round(66 * u), chipH = Math.round(L.credit.h * 0.62), chipY = cy + (L.credit.h - chipH) / 2;
    const defs = S('defs'), lgid = 'cl-brand';
    const lgr = S('linearGradient', { id: lgid, x1: 0, x2: 1, y1: 0, y2: 0 }); lgr.appendChild(S('stop', { offset: 0, 'stop-color': '#93f2bf' })); lgr.appendChild(S('stop', { offset: 1, 'stop-color': '#8ff5ff' })); defs.appendChild(lgr); svg.appendChild(defs);
    svg.appendChild(S('rect', { x: L.pad, y: chipY, width: chipW, height: chipH, fill: 'url(#' + lgid + ')' }));
    svg.appendChild(S('text', { x: L.pad + chipW / 2, y: chipY + chipH * 0.72, 'text-anchor': 'middle', fill: '#04100b', 'font-size': Math.round(9.5 * u * 10) / 10, 'font-family': FONT.micro, 'letter-spacing': '0.06em' }, 'EPINOIΛ'));
    svg.appendChild(S('text', { x: L.pad + chipW + 10 * u, y: chipY + chipH * 0.72, fill: '#3ff0ff', 'font-size': Math.round(9.5 * u * 10) / 10, 'font-family': FONT.micro, 'letter-spacing': '0.06em' }, String(o.texts.credit || '').toUpperCase()));
  }
  return { svg, w: L.w, h: L.h, layout: L, crests: { used: crestUsed.size, missing: crestMissing.size } };
}
const serialize = svg => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
/* an SVG string -> a PNG blob at `scale` times its size. The SVG carries its fonts and its crests as data URIs, so nothing
   in it can taint the canvas; if the browser refuses anyway the caller is told and draws without crests. */
async function svgToPng(svgStr, w, h, scale) {
  const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    await new Promise(r => setTimeout(r, 60));                           // embedded faces settle, then it is drawn once more
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => { try { c.toBlob(b => (b ? res(b) : rej(new Error('the browser would not encode the image'))), 'image/png'); } catch (e) { rej(e); } });
  } finally { URL.revokeObjectURL(url); }
}
function download(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/* ============================================================================================== UI === */
function h(tag, props, kids) {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
const inPage = n => (typeof n.isConnected === 'boolean' ? n.isConnected : document.contains(n));
let CURRENT = null;
/* what the last chart on this page held, so a change of season or scope (the page draws the pane again) keeps the reader's chart
   even inside the moment before the address has caught up */
let LAST = null;

/* The rows of a season as chart entities: name, club (where he played), colours, crest, position group. The page's own
   read is used as it is; names and clubs are asked for here only when the rows carry none. */
async function prepareEntities(opts, D) {
  const S_ = opts.S || {};
  const players = (S_.players || []).slice(), teams = (S_.teams || []).slice();
  let pm = null, tm = null;
  if (players.length && players.some(p => !p.name) && D && D.playerMeta) pm = await D.playerMeta(players.map(p => p.id)).catch(() => null);
  if ((players.length || teams.length) && teams.some(t => !t.name) && D && D.teamMeta && opts.league) tm = await D.teamMeta(opts.league.id).catch(() => null);
  const teamRows = teams.map(t => (tm && tm[t.id] ? Object.assign({}, t, tm[t.id]) : t));
  const teamById = new Map(teamRows.map(t => [t.id, t]));
  const keep = typeof opts.keep === 'function' ? opts.keep : () => true;
  const posMap = root.EpinoiaSeason && root.EpinoiaSeason.positionGroups ? root.EpinoiaSeason.positionGroups(players) : new Map();
  const tOf = S_.teamOfPlayer;
  const clubOf = p => (tOf && (tOf.get ? tOf.get(p.id) : tOf[p.id])) || p._teamId || p.teamId || null;
  const clubs = new Map();
  const pl = [];
  players.forEach(p0 => {
    const p = pm && pm[p0.id] ? Object.assign({}, p0, pm[p0.id]) : p0;
    const cid = clubOf(p);
    if (!keep(cid)) return;
    const c = cid && teamById.get(cid);
    const club = { id: cid || '', name: (c && c.name) || p.teamFull || p.teamName || '', short: (c && c.teamShort) || p.teamShort || '', colour: (c && c.colour) || p.colour || null, logo: (c && c.logo) || p.teamLogo || null };
    if (cid && !clubs.has(cid)) clubs.set(cid, club);
    pl.push({ id: p.id, name: p.name || 'Player', short: initialsOf(p.name), clubId: cid || '', clubName: club.name, clubShort: club.short, colour: club.colour, logo: club.logo,
      pos: posMap.get ? (posMap.get(p.id) || null) : null, slug: p.slug || null, row: p });
  });
  const tl = [];
  teamRows.forEach(t => {
    if (!keep(t.id)) return;
    tl.push({ id: t.id, name: t.name || 'Team', short: t.teamShort || initialsOf(t.name), clubId: t.id, clubName: t.name || '', clubShort: t.teamShort || '', colour: t.colour || null, logo: t.logo || null, pos: null, slug: t.slug || null, row: t });
  });
  return { player: { list: pl, clubs: [...clubs.values()].filter(c => pl.some(e => e.clubId === c.id)).sort((a, b) => a.name.localeCompare(b.name)) }, team: { list: tl, clubs: [] } };
}

function mount(opts) {
  return mountAsync(opts);
}

async function mountAsync(opts) {
  if (CURRENT) { try { CURRENT.destroy(); } catch (_) { /* gone */ } CURRENT = null; }
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return null;
  host.textContent = '';
  host.classList.add('cl-host');
  const wrap = h('div', { class: 'cl' });
  host.appendChild(wrap);
  wrap.appendChild(h('div', { class: 'cl-empty', text: 'Loading the chart lab…' }));
  const D = opts.D || root.EpinoiaData;
  const TB = root.EpinoiaTable;
  if (!TB || !TB.PLAYER_COLS) { wrap.textContent = ''; wrap.appendChild(h('div', { class: 'cl-empty', text: 'The statistics tables could not be loaded.' })); return null; }
  let E;
  try { E = await prepareEntities(opts, D); }
  catch (e) { wrap.textContent = ''; wrap.appendChild(h('div', { class: 'cl-empty', text: 'Could not load: ' + e.message })); return null; }
  if (!inPage(wrap)) return null;
  if (!E.player.list.length && !E.team.list.length) {
    wrap.textContent = '';
    wrap.appendChild(h('div', { class: 'cl-empty', text: 'No statistics for that selection yet — these fill in as games are finalised.' }));
    return null;
  }

  const A = root.EpinoiaAccess, MLock = root.EpinoiaMemLock;
  const accessCtx = () => ({ locked: !!(A && typeof A.analyticsOk === 'function' && !A.analyticsOk(opts.leagueId)),
    isPremium: k => !!(A && typeof A.isPremiumColumn === 'function' && A.isPremiumColumn(k)) });
  let ctx = accessCtx();
  /* ---- the catalogues, from the tables' own columns ---- */
  const SI = root.EpinoiaStatInfo;
  const cats = {};
  const buildCats = () => {
    ['player', 'team'].forEach(kind => {
      const list = E[kind].list;
      list.forEach(e => { e.row = deriveRow(kind, e.row); });
      cats[kind] = buildCatalogue(kind, kind === 'team' ? TB.TEAM_COLS : TB.PLAYER_COLS, TB.PRESETS[kind], list.map(e => e.row), SI && SI.info ? k => SI.info(k, kind) : null, { zones: typeof opts.prepare === 'function' || accessCtx().locked });
      list.forEach(e => { e.get = k => { const c = cats[kind].byKey.get(k); return c ? c.get(e.row) : null; }; });
    });
  };
  buildCats();
  const rawTeams = (opts.S && opts.S.teams) || [];       // the page's rows, read again once the shot zones are on them
  const catOf = st => cats[st === 't' || st === 'team' ? 'team' : 'player'];
  const kindOf = () => (state.ent === 't' ? 'team' : 'player');

  /* ---- state: the address's ?cl= (a shared link), else what this page held last, else the defaults ---- */
  const initial = opts.state || (LAST && LAST.league === opts.leagueId ? LAST.state : null) || (opts.url === false ? null : readQuery(location.search));
  let state = initial ? sanitizeState(initial) : defaultState(E.player.list.length ? 'p' : 't');
  if (state.ent === 'p' && !E.player.list.length) state = defaultState('t');
  if (state.ent === 't' && !E.team.list.length) state = defaultState('p');
  state = fitState(state, catOf(state.ent), ctx);
  let views = [{}, {}];                        // zoom, per chart: { x: [lo, hi], y: [lo, hi] }
  let charts = [];                             // computeChart results
  let pending = null;                          // a read the chosen statistics wait for
  let dead = false;

  const entOf = () => E[kindOf()];
  const byId = () => { const e = entOf(); return e._by || (e._by = new Map(e.list.map(x => [x.id, x]))); };
  const maxGp = () => Math.max(1, ...entOf().list.map(e => e.row.gp || 0));
  const autoGp = () => (kindOf() === 'team' ? 1 : clamp(Math.round(maxGp() * 0.25), 1, 20));
  const effGp = () => (state.gp == null ? autoGp() : state.gp);
  const pool = () => {
    const g = effGp();
    return entOf().list.filter(e => (e.row.gp || 0) >= g && (state.ent === 't' || !state.mn || (e.row.min || 0) >= state.mn) && (!state.ps || e.pos === state.ps));
  };
  const league = opts.league || {}, season = opts.season || {};
  const scopeName = () => [league.name, season.name].filter(Boolean).join(' ');

  /* ---- what is on the page ---- */
  wrap.textContent = '';
  const live = h('div', { class: 'cl-live', role: 'status', 'aria-live': 'polite' });
  const head = h('div', { class: 'cl-head' });
  const hint = h('p', { class: 'cl-hint', text: 'Pick any two statistics · find and pin players, or click a dot · read values against the league average · click a chart, then scroll to zoom' });
  const find = h('div', { class: 'cl-find cl-pophost' });
  const optsRow = h('div', { class: 'cl-opts cl-pophost' });
  const strip = h('div', { class: 'cl-strip' });
  const panelText = h('section', { class: 'cl-panel cl-text', hidden: true, 'aria-label': 'Chart text' });
  const panelExport = h('section', { class: 'cl-panel cl-export', hidden: true, 'aria-label': 'Export the chart as an image' });
  const titles = h('div', { class: 'cl-titles' });
  const grid = h('div', { class: 'cl-charts' });
  const foot = h('div', { class: 'cl-foot' });
  const tableBox = h('div', { class: 'cl-tablebox', hidden: true });
  const busy = h('p', { class: 'cl-busy', role: 'status', hidden: true, text: 'Reading every shot of the season for the shot-zone statistics\u2026 the chart fills in when it is done.' });
  wrap.append(live, head, find, strip, titles, busy, grid, foot, panelText, panelExport, optsRow, tableBox, hint);
  const ui = { text: false, export: false, tip: null, edit: null, textDirty: 0 };
  const say = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };
  let toastT = 0;
  const toast = msg => { say(msg); const t = strip.querySelector('.cl-toast'); if (t) { t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); } };

  /* ---------------------------------------------------------------- state changes --- */
  let urlT = 0;
  const syncUrl = () => {
    LAST = { league: opts.leagueId, state: JSON.parse(JSON.stringify(state)) };
    if (opts.url === false) return;
    clearTimeout(urlT);
    urlT = setTimeout(() => {
      try {
        const plain = same(compactState(state), { v: 1 });
        history.replaceState(history.state, '', location.pathname + withQuery(location.search, state, plain) + location.hash);
      } catch (_) { /* a sandboxed frame */ }
    }, 250);
  };
  const shareUrl = () => location.origin + location.pathname + withQuery(location.search, state, false) + location.hash;
  /* change, then draw what the change touches: 'all' the controls and the charts, 'charts' the charts alone, 'none' */
  let rafAll = 0;
  let keepFocus = null;
  const change = (mut, what) => {
    const ae = document.activeElement;
    if (ae && ae !== document.body && wrap.contains(ae) && ae.getAttribute && ae.getAttribute('data-fk')) keepFocus = ae.getAttribute('data-fk');
    mut(state);
    state = fitState(state, catOf(state.ent), ctx);
    syncUrl();
    if (what === 'none') return;
    if (what === 'charts') { drawCharts(); return; }
    if (rafAll) return;
    rafAll = requestAnimationFrame(() => { rafAll = 0; if (!dead) refresh(); });
  };
  const needKeys = () => [state.a, state.b].filter(Boolean).reduce((a, c) => a.concat([c.x, c.y, c.y2]), []).concat(state.sz).filter(Boolean);
  const ensureData = async () => {
    if (state.ent !== 't' || typeof opts.prepare !== 'function') return;
    const need = needKeys().filter(needsZones);
    if (!need.length || pending === 'done') return;
    if (pending) return pending;
    busy.hidden = false;
    pending = (async () => {
      try { await opts.prepare(need); } catch (_) { /* the columns stay empty */ }
      busy.hidden = true;
      const tm = new Map(rawTeams.map(t => [t.id, t]));
      E.team.list.forEach(e => { const r0 = tm.get(e.id); if (r0) e.row = deriveRow('team', Object.assign({}, e.row, r0)); });
      pending = 'done';
      if (!dead) { drawCharts(); renderTable(); }
    })();
    return pending;
  };

  /* ---------------------------------------------------------------- pickers --- */
  const pickers = {};
  let openPick = null;
  const closePicker = (focusBack) => {
    if (!openPick) return;
    const p = openPick; openPick = null;
    p.pk.el.hidden = true;
    p.anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', p.onDoc, true);
    if (focusBack && p.anchor.focus) p.anchor.focus();
  };
  function buildPicker(kind) {
    const cat = cats[kind];
    const undo = [];
    const el = h('div', { class: 'cl-pop', role: 'dialog', 'aria-label': 'Choose a statistic', hidden: true });
    const q = h('input', { class: 'cl-pop-q ep-input', type: 'search', placeholder: 'search statistics…', 'aria-label': 'Search statistics', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div', { class: 'cl-pop-list', role: 'listbox' });
    const empty = h('div', { class: 'cl-pop-none', text: 'No statistic matches.', hidden: true });
    el.append(q, list, empty);
    const items = new Map();
    const noneBtn = h('button', { type: 'button', class: 'cl-opt none', role: 'option', 'data-k': '' }, [h('span', { class: 'n', text: 'none' }), h('span', { class: 't', text: 'no size encoding: every dot the same' })]);
    list.appendChild(noneBtn);
    const groupsEl = [];
    cat.groups.forEach(g => {
      const gl = groupState(g, ctx) === 'locked';
      const box = h('div', { class: 'cl-grp' + (gl ? ' locked' : ''), 'data-g': g.key });
      box.appendChild(h('div', { class: 'cl-grp-h' }, [g.label, gl ? h('span', { class: 'cl-lockmark', text: ' · members' }) : null]));
      g.items.forEach(c => {
        const locked = columnState(c.k, ctx) === 'locked';
        const b = h('button', { type: 'button', class: 'cl-opt' + (locked ? ' locked' : ''), role: 'option', 'data-k': c.k, 'aria-disabled': locked ? 'true' : null, tabindex: '-1' },
          [h('span', { class: 'n', text: c.name }), h('span', { class: 't', text: c.hint || '' }), c.low ? h('span', { class: 'lo', text: 'lower is better', title: 'lower is better' }) : null]);
        b._hay = fold([c.name, c.label, c.long, c.t, c.k, g.label].concat(c.groups.map(x => (TB.PRESETS[kind].find(p => p[0] === x) || [0, x])[1])).join(' '));
        b._c = c;
        items.set(c.k, b);
        box.appendChild(b);
      });
      if (gl && MLock) undo.push(MLock.lock(box, { what: g.label + ' (events)', leagueSlug: opts.leagueSlug }));
      else g.items.forEach(c => { if (columnState(c.k, ctx) === 'locked' && MLock) undo.push(MLock.lock(items.get(c.k), { what: c.name, leagueSlug: opts.leagueSlug })); });
      list.appendChild(box); groupsEl.push(box);
    });
    const pk = { el, q, items, list, noneBtn, kind, current: '', allowNone: false, onPick: null, undo,
      filter(text) {
        const t = fold(text), words = t ? t.split(' ') : [];
        let shown = 0;
        items.forEach(b => { const on = !words.length || words.every(w => b._hay.indexOf(w) >= 0); b.hidden = !on; if (on) shown++; });
        groupsEl.forEach(bx => { bx.hidden = !bx.querySelector('.cl-opt:not([hidden])'); });
        noneBtn.hidden = !pk.allowNone || !!words.length;
        empty.hidden = shown > 0;
      },
      mark() {
        items.forEach((b, k) => b.setAttribute('aria-selected', k === pk.current ? 'true' : 'false'));
        noneBtn.setAttribute('aria-selected', pk.current === '' ? 'true' : 'false');
      },
      visible() { return [...list.querySelectorAll('.cl-opt:not([hidden])')].filter(b => !b.closest('[hidden]')); }
    };
    list.addEventListener('click', ev => {
      const b = ev.target.closest('.cl-opt');
      if (!b || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('locked')) return;
      const k = b.getAttribute('data-k');
      const cb = pk.onPick; closePicker(true);
      if (cb) cb(k);
    });
    q.addEventListener('input', () => pk.filter(q.value));
    el.addEventListener('keydown', ev => {
      const vis = pk.visible().filter(b => !b.classList.contains('locked'));
      const at = vis.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePicker(true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); (vis[at + 1] || vis[0] || q).focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (at <= 0) q.focus(); else vis[at - 1].focus(); }
      else if (ev.key === 'Tab') { closePicker(false); }
      else if (ev.key.length === 1 && document.activeElement !== q && !ev.ctrlKey && !ev.metaKey) { q.focus(); }
    });
    return pk;
  }
  const pickerFor = kind => pickers[kind] || (pickers[kind] = buildPicker(kind));
  /* cfg: { anchor, current, allowNone, onPick(key) } - the picker opens under the control, inside its .cl-pophost */
  function showPicker(cfg) {
    if (openPick && openPick.anchor === cfg.anchor) { closePicker(true); return; }
    closePicker(false);
    const pk = pickerFor(kindOf());
    const hostEl = cfg.anchor.closest('.cl-pophost') || wrap;
    pk.current = cfg.current || ''; pk.allowNone = !!cfg.allowNone; pk.onPick = cfg.onPick;
    pk.q.value = ''; pk.filter(''); pk.mark();
    hostEl.appendChild(pk.el);
    pk.el.hidden = false;
    cfg.anchor.setAttribute('aria-expanded', 'true');
    /* placed under the control: offsets inside the host, so the site's zoom on <body> cannot skew it */
    const top = cfg.anchor.offsetTop + cfg.anchor.offsetHeight + 2;
    pk.el.style.top = top + 'px';
    const cur = pk.items.get(pk.current);
    if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest' }); } catch (_) { /* fine */ } }
    const onDoc = ev => { if (!pk.el.contains(ev.target) && !cfg.anchor.contains(ev.target)) closePicker(false); };
    document.addEventListener('pointerdown', onDoc, true);
    openPick = { pk, anchor: cfg.anchor, onDoc };
    setTimeout(() => { try { pk.q.focus({ preventScroll: true }); } catch (_) { /* gone */ } }, 0);
  }
  const rebuildPickers = () => {
    closePicker(false);
    Object.keys(pickers).forEach(k => { pickers[k].undo.forEach(u => { try { u(); } catch (_) { /* gone */ } }); pickers[k].el.remove(); delete pickers[k]; });
  };

  /* ---------------------------------------------------------------- the head: entity, presets, reset --- */
  const modeSel = (val, onchange, label, fk) => {
    const s = h('select', { class: 'cl-mode ep-input', 'aria-label': label, 'data-fk': fk });
    MODES.forEach(m => s.appendChild(h('option', { value: m[0], text: m[1], title: m[2] })));
    s.value = val; s.addEventListener('change', () => onchange(s.value));
    return s;
  };
  const key = (text, o) => {
    const b = h('button', Object.assign({ type: 'button', class: 'cl-key' + (o && o.on ? ' on' : ''), 'data-fk': (o && o.fk) || text }, o && o.attrs), text);
    if (o && o.on != null) b.setAttribute('aria-pressed', o.on ? 'true' : 'false');
    if (o && o.title) b.title = o.title;
    if (o && o.click) b.addEventListener('click', o.click);
    if (o && o.disabled) { b.disabled = true; }
    return b;
  };
  function renderHead() {
    head.textContent = '';
    const cs = catOf(state.ent);
    const presets = presetsFor(state.ent, cs, ctx);
    const ps = h('select', { class: 'cl-preset ep-input', 'aria-label': 'Preset charts', 'data-fk': 'preset' });
    ps.appendChild(h('option', { value: '', text: 'Presets…' }));
    presets.forEach(p => ps.appendChild(h('option', { value: p.id, text: p.label })));
    const cur = matchPreset(state, presets);
    if (cur) ps.value = cur;
    ps.addEventListener('change', () => {
      const p = presets.find(x => x.id === ps.value);
      if (!p) return;
      views = [{}, {}];
      change(s => { const n = presetState(p, s); Object.keys(n).forEach(k => { s[k] = n[k]; }); s.pin = n.pin; }, 'all');
    });
    head.append(
      h('span', { class: 'cl-brand', text: 'CHARTS' }),
      h('div', { class: 'cl-keys', role: 'group', 'aria-label': 'Chart players or teams' }, [
        key('PLAYERS', { on: state.ent === 'p', click: () => setEntity('p'), disabled: !E.player.list.length }),
        key('TEAMS', { on: state.ent === 't', click: () => setEntity('t'), disabled: !E.team.list.length })
      ]),
      ps,
      key('RESET ALL', { title: 'Back to the starting chart', click: () => { views = [{}, {}]; state = fitState(defaultState('p'), catOf('p'), ctx); if (state.ent === 'p' && !E.player.list.length) state = fitState(defaultState('t'), catOf('t'), ctx); syncUrl(); refresh(); say('Chart reset'); } })
    );
  }
  function setEntity(e) {
    if (state.ent === e) return;
    views = [{}, {}];
    change(s => {
      const d = defaultState(e);
      s.ent = e; s.a = d.a; s.b = s.b ? cleanAxes({ x: e === 't' ? 'ortg' : 'apg', y: e === 't' ? 'drtg' : 'topg' }, e) : null; s.sz = ''; s.ps = ''; s.co = e === 't' ? 'c' : s.co; s.mn = 0; s.gp = null; s.hl = [];
    }, 'all');
  }

  /* ---------------------------------------------------------------- search and pins --- */
  let sr = { items: [], active: -1, open: false };
  const searchInput = h('input', { class: 'cl-q ep-input', type: 'search', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': 'cl-results', placeholder: 'find a player…', autocomplete: 'off', spellcheck: 'false' });
  const results = h('div', { class: 'cl-results', id: 'cl-results', role: 'listbox', hidden: true });
  const chips = h('div', { class: 'cl-chips', role: 'group', 'aria-label': 'Highlighted' });
  const teamSel = h('select', { class: 'cl-teamsel ep-input', 'aria-label': 'Highlight a whole team' });
  const findRow = h('div', { class: 'cl-findrow' }, [h('div', { class: 'cl-searchbox' }, [searchInput, results]), teamSel]);
  find.append(findRow, chips);
  const pinSet = () => { const by = byId(); return new Set(state.pin.filter(id => by.has(id))); };
  const hiSet = () => {
    const s = pinSet();
    if (state.ent === 'p' && state.hl.length) { const hl = new Set(state.hl); entOfPool().forEach(e => { if (hl.has(e.clubId)) s.add(e.id); }); }
    return s;
  };
  const entOfPool = () => (poolCache && poolCache.key === poolKey() ? poolCache.list : (poolCache = { key: poolKey(), list: pool() }).list);
  let poolCache = null;
  const poolKey = () => [state.ent, effGp(), state.mn, state.ps, pending].join('|');
  const pin = (id, on) => change(s => { const i = s.pin.indexOf(id); if (on === false || (on == null && i >= 0)) { if (i >= 0) s.pin.splice(i, 1); } else if (i < 0 && s.pin.length < PIN_MAX) s.pin.push(id); }, 'all');
  const hlTeam = (id, on) => change(s => { const i = s.hl.indexOf(id); if (on === false || (on == null && i >= 0)) { if (i >= 0) s.hl.splice(i, 1); } else if (i < 0 && s.hl.length < HL_MAX) s.hl.push(id); }, 'all');
  function renderResults() {
    results.textContent = '';
    const on = sr.items.length > 0 && document.activeElement === searchInput;
    results.hidden = !on; searchInput.setAttribute('aria-expanded', on ? 'true' : 'false');
    sr.items.forEach((it, i) => {
      const o = h('div', { class: 'cl-res' + (i === sr.active ? ' on' : ''), role: 'option', id: 'cl-res-' + i, 'aria-selected': i === sr.active ? 'true' : 'false', 'data-i': i }, [
        h('i', { class: 'cl-dot', style: 'background:' + (safeColour(it.colour) || 'var(--ink-3)') }),
        h('b', { text: it.kind === 'team' ? it.name : it.name }),
        h('span', { class: 'cl-res-s', text: it.kind === 'team' ? 'highlight the whole team (' + it.count + ' players)' : (it.clubName || '') })]);
      results.appendChild(o);
    });
    if (sr.active >= 0) searchInput.setAttribute('aria-activedescendant', 'cl-res-' + sr.active); else searchInput.removeAttribute('aria-activedescendant');
  }
  const safeColour = c => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim())) ? c.trim() : null;
  function search() {
    const q = searchInput.value;
    const e = entOf();
    const list = matchEntities(e.list, q, 7).map(x => Object.assign({ kind: state.ent === 't' ? 'team' : 'player' }, x));
    if (state.ent === 'p') {
      const cm = matchEntities(e.clubs.map(c => ({ id: c.id, name: c.name, clubName: '', clubShort: c.short, colour: c.colour })), q, 2);
      cm.forEach(c => list.unshift({ kind: 'club', id: c.id, name: c.name, colour: c.colour, count: e.list.filter(p => p.clubId === c.id).length }));
    }
    sr.items = q.trim() ? list.slice(0, 8).map(x => (x.kind === 'club' ? Object.assign({}, x, { kind: 'team' }) : x)).map(x => Object.assign(x, { isClub: x.count != null })) : [];
    sr.active = sr.items.length ? 0 : -1;
    renderResults();
    /* the option under the arrow keys is lit on the chart before it is chosen */
    previewHover();
  }
  const previewHover = () => { const it = sr.items[sr.active]; if (it && !it.isClub) setHover(it.id, -2); else if (hover.src === -2) setHover(null, -1); };
  function choose(i) {
    const it = sr.items[i];
    if (!it) return;
    if (it.isClub) hlTeam(it.id, true); else pin(it.id, true);
    searchInput.value = ''; sr = { items: [], active: -1 }; renderResults(); if (hover.src === -2) setHover(null, -1);
    say((it.name || '') + ' highlighted');
  }
  searchInput.addEventListener('input', search);
  searchInput.addEventListener('focus', () => { if (searchInput.value) search(); });
  searchInput.addEventListener('blur', () => setTimeout(() => { sr.items = []; renderResults(); if (hover.src === -2) setHover(null, -1); }, 150));
  searchInput.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (sr.items.length) { sr.active = (sr.active + 1) % sr.items.length; renderResults(); previewHover(); } }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (sr.items.length) { sr.active = (sr.active - 1 + sr.items.length) % sr.items.length; renderResults(); previewHover(); } }
    else if (ev.key === 'Enter') { ev.preventDefault(); choose(Math.max(0, sr.active)); }
    else if (ev.key === 'Escape') { searchInput.value = ''; sr = { items: [], active: -1 }; renderResults(); if (hover.src === -2) setHover(null, -1); }
  });
  results.addEventListener('pointerdown', ev => { const o = ev.target.closest('.cl-res'); if (o) { ev.preventDefault(); choose(+o.getAttribute('data-i')); } });
  teamSel.addEventListener('change', () => { const v = teamSel.value; teamSel.value = ''; if (v) hlTeam(v, true); });
  function renderFind() {
    searchInput.placeholder = state.ent === 't' ? 'find a team…' : 'find a player or a team…';
    teamSel.hidden = state.ent !== 'p';
    teamSel.textContent = '';
    teamSel.appendChild(h('option', { value: '', text: 'Highlight a team…' }));
    E.player.clubs.forEach(c => teamSel.appendChild(h('option', { value: c.id, text: c.name, disabled: state.hl.indexOf(c.id) >= 0 })));
    chips.textContent = '';
    const by = byId(), inPool = new Set(entOfPool().map(e => e.id));
    const mk = (label, colour, onX, title, dim, focusId) => {
      const c = h('span', { class: 'cl-chip' + (dim ? ' off' : ''), style: '--c:' + (safeColour(colour) || 'var(--ink-3)'), title: title || null });
      const b = h('button', { type: 'button', class: 'cl-chip-b', 'aria-label': (focusId ? 'Show ' : 'Team ') + label + (dim ? ' (not plotted)' : '') }, [h('i', { class: 'cl-dot' }), label]);
      const x = h('button', { type: 'button', class: 'cl-chip-x', 'aria-label': 'Remove ' + label, text: '×' });
      x.addEventListener('click', ev => { ev.stopPropagation(); onX(); });
      b.addEventListener('focus', () => { if (focusId) setHover(focusId, -1); });
      b.addEventListener('blur', () => setHover(null, -1));
      b.addEventListener('pointerenter', () => { if (focusId) setHover(focusId, -1); });
      b.addEventListener('pointerleave', () => setHover(null, -1));
      b.addEventListener('keydown', ev => {
        const bs = [...chips.querySelectorAll('.cl-chip-b')], i = bs.indexOf(b);
        if (ev.key === 'ArrowRight' && bs[i + 1]) { ev.preventDefault(); bs[i + 1].focus(); }
        else if (ev.key === 'ArrowLeft' && bs[i - 1]) { ev.preventDefault(); bs[i - 1].focus(); }
        else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); onX(); }
        else if (ev.key === 'ArrowDown' && focusId) { ev.preventDefault(); focusCursor(focusId); }
        else if (ev.key === 'Enter' && focusId) { ev.preventDefault(); focusCursor(focusId); }
      });
      c.append(b, x);
      return c;
    };
    state.pin.filter(id => by.has(id)).forEach(id => { const e = by.get(id); chips.appendChild(mk(e.name, e.colour, () => pin(id, false), e.clubName || '', !inPool.has(id), id)); });
    if (state.ent === 'p') state.hl.forEach(id => { const c = E.player.clubs.find(x => x.id === id); if (c) chips.appendChild(mk(c.short || c.name, c.colour, () => hlTeam(id, false), 'every player of ' + c.name, false, null)); });
    chips.hidden = !chips.children.length;
  }

  /* ---------------------------------------------------------------- options row --- */
  const pickBtn = (cur, cat, onclick, label, fk) => {
    const c = cur && cat.byKey.get(cur);
    return h('button', { type: 'button', class: 'cl-pick', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: label || 'Choose a statistic', 'data-fk': fk, onclick }, [
      h('span', { class: 'cl-pick-t', text: c ? c.name : (cur ? cur : 'none') }), h('span', { class: 'cl-caret', text: '▾', 'aria-hidden': 'true' })]);
  };
  function labelled(text, control, cls) { return h('label', { class: 'cl-f ' + (cls || '') }, [h('span', { class: 'cl-fl', text }), control]); }
  function renderOpts() {
    optsRow.textContent = '';
    const cs = catOf(state.ent);
    const colSel = h('select', { class: 'ep-input cl-sel', 'aria-label': 'Colour by', 'data-fk': 'colour' });
    [['c', 'club'], ['p', 'position group'], ['n', 'none']].forEach(o => colSel.appendChild(h('option', { value: o[0], text: o[1], disabled: o[0] === 'p' && state.ent === 't' })));
    colSel.value = state.ent === 't' && state.co === 'p' ? 'c' : state.co;
    colSel.addEventListener('change', () => change(s => { s.co = colSel.value; }, 'charts'));
    const names = h('div', { class: 'cl-seg', role: 'group', 'aria-label': 'Names on the chart' }, [['s', 'SMART', 'the extremes, the highlighted and their neighbours, never crowded'], ['a', 'ALL', 'every point named; where names would overlap some are left out, and the chart says how many'], ['n', 'NONE', 'no names; hover or tap a point']]
      .map(o => key(o[1], { fk: 'names:' + o[0], on: state.nm === o[0], title: o[2], click: () => change(s => { s.nm = o[0]; }, 'all') })));
    const sizeBtn = pickBtn(state.sz, cs, ev => showPicker({ anchor: ev.currentTarget, current: state.sz, allowNone: true, onPick: k => change(s => { s.sz = k; }, 'all') }), 'Size the dots by a third statistic', 'size');
    const gp = h('input', { class: 'ep-input cl-num', type: 'number', min: '0', max: '999', inputmode: 'numeric', placeholder: 'auto ' + autoGp(), 'aria-label': 'Minimum games played', 'data-fk': 'gp', value: state.gp == null ? '' : String(state.gp) });
    gp.addEventListener('change', () => change(s => { const v = parseInt(gp.value, 10); s.gp = isFinite(v) ? clamp(v, 0, 999) : null; }, 'all'));
    const mn = h('input', { class: 'ep-input cl-num', type: 'number', min: '0', max: '99999', inputmode: 'numeric', placeholder: '0', 'aria-label': 'Minimum minutes played', 'data-fk': 'mn', value: state.mn ? String(state.mn) : '' });
    mn.addEventListener('change', () => change(s => { s.mn = clamp(parseInt(mn.value, 10) || 0, 0, 99999); }, 'all'));
    const pos = h('select', { class: 'ep-input cl-sel', 'aria-label': 'Position group', 'data-fk': 'pos' });
    pos.appendChild(h('option', { value: '', text: 'every position' }));
    ((root.EpinoiaSeason && root.EpinoiaSeason.POS_GROUPS) || [['G', 'guards'], ['F', 'wings'], ['C', 'bigs']]).forEach(g => pos.appendChild(h('option', { value: g[0], text: g[1] })));
    pos.value = state.ps; pos.addEventListener('change', () => change(s => { s.ps = pos.value; }, 'all'));
    const vals = h('div', { class: 'cl-seg', role: 'group', 'aria-label': 'Read every axis as' }, MODES.map(m => {
      const axes = [state.a, state.b].filter(Boolean);
      const on = axes.every(a => a.xm === m[0] && (a.y2 ? true : a.ym === m[0]));
      return key(m[1], { fk: 'values:' + m[0], on, title: m[2], click: () => change(s => { [s.a, s.b].filter(Boolean).forEach(a => { a.xm = m[0]; a.ym = m[0]; if (m[0] !== 'a') { a.xl = 0; a.yl = 0; } }); }, 'all') });
    }));
    [
      h('div', { class: 'cl-sech', text: 'OPTIONS' }),
      labelled('values', vals, 'wide'),
      labelled('names', names),
      labelled('colour', colSel),
      labelled('size by', sizeBtn, 'cl-pophost-f'),
      labelled('min games', gp, 'num'),
      state.ent === 'p' ? labelled('min minutes', mn, 'num') : null,
      state.ent === 'p' ? labelled('position', pos) : null
    ].filter(Boolean).forEach(n => optsRow.appendChild(n));
  }
  function renderStrip() {
    strip.textContent = '';
    const dual = !!state.b;
    strip.append(
      key('LINES', { on: !!state.qd, title: 'lines through the league averages (the origin in delta and z modes)', click: () => change(s => { s.qd = s.qd ? 0 : 1; }, 'all') }),
      key('QUADRANTS', { on: !!state.qc, title: 'name the four quarters and tint the one where both are better', click: () => change(s => { s.qc = s.qc ? 0 : 1; }, 'all') }),
      key('TREND', { on: !!state.tr, title: 'least-squares trend line with r', click: () => change(s => { s.tr = s.tr ? 0 : 1; }, 'all') }),
      key('DUAL', { on: dual, title: 'a second chart, linked to the first: the same players are lit in both', click: toggleDual }),
      key('TABLE', { on: !!state.tb, title: 'the plotted rows as a sortable table', click: () => change(s => { s.tb = s.tb ? 0 : 1; }, 'all') }),
      key('TEXT', { on: ui.text, title: 'edit the title, the axis titles, captions and labels', click: () => { ui.text = !ui.text; if (ui.text) ui.export = false; renderPanels(); renderStrip(); } }),
      key('EXPORT', { on: ui.export, title: 'save the chart as a PNG or SVG, or copy it', click: () => { ui.export = !ui.export; if (ui.export) ui.text = false; renderPanels(); renderStrip(); if (ui.export) schedulePreview(); } }),
      key('COPY LINK', { title: 'copy a link to this exact chart', click: copyLink }),
      h('span', { class: 'cl-toast', role: 'status', hidden: true })
    );
  }
  function toggleDual() {
    views = [{}, {}];
    change(s => { s.b = s.b ? null : cleanAxes({ x: s.ent === 't' ? 'ortg' : 'apg', y: s.ent === 't' ? 'drtg' : 'topg' }, s.ent); }, 'all');
  }
  async function copyLink() {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch (_) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;left:-9999px', 'aria-hidden': 'true' }); ta.value = url; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove(); toast(ok ? 'Link copied' : 'Copy this link: ' + url);
    }
  }

  /* ---------------------------------------------------------------- the words on the chart --- */
  const cnt = () => entOfPool().length;
  const noun = n => (state.ent === 't' ? (n === 1 ? 'team' : 'teams') : (n === 1 ? 'player' : 'players'));
  const modeWords = { d: 'differences from the league average', p: '% differences from the league average', z: 'z-scores', r: 'percentiles' };
  const chartTitle = D => (D.overlay ? D.cy.title + ' and ' + D.cy2.title : D.cy.title) + ' vs ' + D.cx.title;
  function autoTexts() {
    if (!charts.length) return { ti: '', su: '', fo: '' };
    const parts = charts.map(chartTitle);
    let ti = parts.length > 1 ? parts.join(' · ') : parts[0];
    if (scopeName()) ti += ' – ' + scopeName();
    const modes = [...new Set(charts.reduce((a, D) => a.concat([D.xm, D.overlay ? 'z' : D.ym]), []).filter(m => m !== 'a'))];
    const su = [cnt() + ' ' + noun(cnt()),
      effGp() > 1 ? effGp() + '+ games' : '', state.mn ? state.mn + '+ minutes' : '',
      state.ps ? ({ G: 'guards', F: 'wings', C: 'bigs' }[state.ps]) : '',
      modes.length ? 'values as ' + modes.map(m => modeWords[m]).join(' and ') : ''].filter(Boolean).join(' · ');
    return { ti, su, fo: '' };
  }
  const legendCaption = D => {
    if (D.overlay) return 'Both Y statistics are z-scores on one shared scale (0 = the league average, higher = better). This is one axis, not a dual axis.';
    const one = (ax, m) => m === 'd' ? ax + ': each value minus the league average of those shown.' : m === 'p' ? ax + ': each value as a % above or below the league average.'
      : m === 'z' ? ax + ': standard deviations from the league average, turned so that higher is better.' : m === 'r' ? ax + ': percentile among those shown, higher is better.' : '';
    const x = one('X', D.xm), y = one('Y', D.ym);
    if (D.xm === D.ym && x) return one('Both axes', D.xm);
    return [x, y].filter(Boolean).join(' ');
  };
  const textOf = k => state.tx[k] || autoTexts()[k] || '';
  const creditText = () => [league.name, season.name, longDate()].filter(Boolean).join(' · ');
  /* one chart's configuration for buildChart, for the page (on screen) or for an export at another size */
  function cfgFor(ci, o) {
    const D = charts[ci], pf = ci ? 'b' : 'a', tx = {};
    tx.x = state.tx[pf + 'x'] || ''; tx.y = state.tx[pf + 'y'] || ''; tx.lg = state.tx[pf + 'lg'] || legendCaption(D);
    for (let i = 0; i < 4; i++) tx['q' + i] = state.tx[pf + 'q' + i] || '';
    /* buildChart reads the corner captions as aq0..3 */
    const texts = { ax: tx.x, ay: tx.y, lg: tx.lg, aq0: tx.q0, aq1: tx.q1, aq2: tx.q2, aq3: tx.q3 };
    const cs = catOf(state.ent), sc = state.sz && cs.byKey.get(state.sz);
    let size = null;
    if (sc) { const f = sizeScale(D.pts.map(p => sc.get(p.e.row))); size = { get: p => f(sc.get(p.e.row)), label: sc.label }; }
    return { W: o.W, H: o.H, fs: o.fs, theme: o.theme, uid: 'cl' + ci + (o.uid || ''), data: D, kind: kindOf(), co: state.co === 'p' && state.ent === 't' ? 'c' : state.co, size,
      names: state.nm, qd: state.qd, qc: state.qc, trend: state.tr, hi: hiSet(), must: pinSet(), view: o.view || {}, texts, labels: state.lb, crest: o.crest, editable: !!o.editable, zoomSpace: o.zoomSpace || 0 };
  }
  const logoUrl = e => {
    if (!e || !e.logo) return null;
    if (typeof root.epinoiaLogoUrl === 'function') { try { return root.epinoiaLogoUrl(e.logo, 64); } catch (_) { return null; } }
    return /^https:\/\//i.test(e.logo) ? e.logo : null;
  };

  /* ---------------------------------------------------------------- the chart cards --- */
  const cards = [];
  let theme = pageTheme(wrap);
  const cardLabel = ci => (state.b ? (ci ? 'chart B' : 'chart A') : 'chart');
  function setAxis(ci, slot, k) {
    views[ci] = {};
    change(s => { const a = ci ? s.b : s.a; a[slot] = k; if (slot === 'y' && a.y2 === k) a.y2 = ''; }, 'all');
  }
  function setMode(ci, ax, m) {
    views[ci] = {};
    change(s => { const a = ci ? s.b : s.a; a[ax + 'm'] = m; if (m !== 'a') a[ax + 'l'] = 0; }, 'all');
  }
  function defaultY2(a, cs) {
    const c = (state.ent === 't' ? ['drtg', 'ortg', 'net', 'ppg'] : ['ast_pct', 'usg', 'tov_pct', 'rpg']).find(k => cs.byKey.has(k) && k !== a.x && k !== a.y && columnState(k, ctx) === 'open');
    return c || '';
  }
  function makeCard(ci) {
    const ch = ci ? state.b : state.a, cs = catOf(state.ent), two = !!state.b;
    const axes = h('div', { class: 'cl-axes cl-pophost' });
    const grp = (lab, slot, extra) => {
      const btn = pickBtn(ch[slot], cs, ev => showPicker({ anchor: ev.currentTarget, current: ch[slot], onPick: k => setAxis(ci, slot, k) }), 'Choose the ' + lab + ' statistic', 'pick:' + ci + ':' + slot);
      return h('div', { class: 'cl-ax' }, [h('span', { class: 'cl-axl', text: lab }), btn].concat(extra || []));
    };
    const overlay = !!ch.y2;
    const yMode = overlay ? h('span', { class: 'cl-mode-fixed', text: 'Z', title: 'in an overlay both Y statistics are z-scores' })
      : modeSel(ch.ym, m => setMode(ci, 'y', m), 'How ' + cardLabel(ci) + ' reads Y', 'mode:' + ci + ':y');
    const yG = grp('Y', 'y', [yMode]);
    const y2G = overlay ? grp('Y2', 'y2', []) : null;
    const xG = grp('X', 'x', [modeSel(ch.xm, m => setMode(ci, 'x', m), 'How ' + cardLabel(ci) + ' reads X', 'mode:' + ci + ':x')]);
    const logOk = (ax) => ch[ax + 'm'] === 'a' && !(ax === 'y' && overlay);
    const keys = h('div', { class: 'cl-axkeys' }, [
      key('SWAP', { fk: 'c' + ci + ':swap', title: 'swap X and Y', disabled: overlay, click: () => { views[ci] = {}; change(s => { const a = ci ? s.b : s.a; [a.x, a.y] = [a.y, a.x]; [a.xm, a.ym] = [a.ym, a.xm]; [a.xl, a.yl] = [a.yl, a.xl]; }, 'all'); } }),
      key('OVERLAY', { fk: 'c' + ci + ':overlay', on: overlay, title: 'two Y statistics against one X, both as z-scores on one shared scale (never a dual axis)',
        click: () => { views[ci] = {}; change(s => { const a = ci ? s.b : s.a; if (a.y2) a.y2 = ''; else { a.y2 = defaultY2(a, cs); if (a.y2) a.ym = 'z'; } }, 'all'); } }),
      key('LOG X', { fk: 'c' + ci + ':logx', on: !!ch.xl, title: logOk('x') ? 'logarithmic X axis' : 'log needs the plain values (ABS)', disabled: !logOk('x'), click: () => { views[ci] = {}; change(s => { const a = ci ? s.b : s.a; a.xl = a.xl ? 0 : 1; }, 'all'); } }),
      key('LOG Y', { fk: 'c' + ci + ':logy', on: !!ch.yl, title: logOk('y') ? 'logarithmic Y axis' : 'log needs the plain values (ABS)', disabled: !logOk('y'), click: () => { views[ci] = {}; change(s => { const a = ci ? s.b : s.a; a.yl = a.yl ? 0 : 1; }, 'all'); } })
    ]);
    [h('span', { class: 'cl-badge', text: two ? (ci ? 'B' : 'A') : 'AXES' }), yG, y2G, xG, keys].filter(Boolean).forEach(n => axes.appendChild(n));
    const svgHost = h('div', { class: 'cl-svghost' });
    const tip = h('div', { class: 'cl-tip', hidden: true, role: 'tooltip' });
    const zoom = h('div', { class: 'cl-zoom' }, [
      h('button', { type: 'button', class: 'cl-zbtn', 'aria-label': 'Zoom in', text: '+', onclick: () => zoomBy(ci, 1.5) }),
      h('button', { type: 'button', class: 'cl-zbtn', 'aria-label': 'Zoom out', text: '−', onclick: () => zoomBy(ci, 1 / 1.5) }),
      h('button', { type: 'button', class: 'cl-zbtn wide', 'aria-label': 'Reset the view', text: 'RESET VIEW', onclick: () => { views[ci] = {}; drawChart(ci); } })
    ]);
    const plot = h('div', { class: 'cl-plot', tabindex: '0', role: 'group', 'aria-label': 'Scatter chart. Arrow keys move between points, Enter pins the point, T opens the table view, plus and minus zoom.' }, [svgHost, tip, zoom]);
    const el = h('section', { class: 'cl-card', 'data-c': ci }, [axes, plot]);
    const card = { ci, el, axes, plot, svgHost, tip, zoom, built: null, svg: null, hov: null, W: 0, H: 0 };
    wirePlot(card);
    return card;
  }
  function buildCards() {
    closePicker(false);
    grid.textContent = ''; cards.length = 0;
    const n = state.b ? 2 : 1;
    for (let i = 0; i < n; i++) { const c = makeCard(i); cards.push(c); grid.appendChild(c.el); }
    if (n === 1) views[1] = {};
    layoutSide();
  }
  let side = false;
  function layoutSide() {
    side = !!state.b && wrap.clientWidth >= 640;
    grid.classList.toggle('dual', !!state.b); grid.classList.toggle('side', side);
  }

  /* ---- drawing ---- */
  let hover = { id: null, src: -1 }, cursor = null, sticky = null;
  function recompute() {
    poolCache = null;
    const pl = entOfPool(), cs = catOf(state.ent);
    charts = [state.a].concat(state.b ? [state.b] : []).map(ch => computeChart(pl, cs, ch, { trend: !!state.tr }));
  }
  function drawCharts() {
    if (dead) return;
    recompute();
    layoutSide();
    renderTitles();
    cards.forEach((c, i) => drawChart(i));
    if (ui.text) refreshTextLabels();
    renderTable();
    if (ui.export) schedulePreview();
    ensureData();
  }
  const rafDraw = [0, 0];
  const scheduleDraw = ci => { if (rafDraw[ci]) return; rafDraw[ci] = requestAnimationFrame(() => { rafDraw[ci] = 0; drawChart(ci); }); };
  let interacting = false, interT = 0;
  function drawChart(ci) {
    const c = cards[ci];
    if (!c || !charts[ci] || !inPage(c.plot)) return;
    const W = Math.floor(c.plot.clientWidth);
    if (W < 120) return;
    const H = Math.round(W < 500 ? clamp(W * 0.95, 300, 420) : clamp(W * 0.74, 300, 470));
    theme = pageTheme(wrap);
    const cfg = cfgFor(ci, { W, H, fs: 1, theme, crest: logoUrl, editable: true, view: views[ci], zoomSpace: 62 });
    if (interacting && cfg.names === 'a' && charts[ci].pts.length > 250) cfg.names = 'n';
    const built = buildChart(cfg);
    const svg = S('svg', { class: 'cl-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': chartTitle(charts[ci]) + '. ' + charts[ci].pts.length + ' points.' });
    svg.appendChild(built.g);
    const hov = S('g', { class: 'cl-hov', 'pointer-events': 'none' });
    svg.appendChild(hov);
    c.svgHost.textContent = '';
    c.svgHost.appendChild(svg);
    c.built = built; c.svg = svg; c.hov = hov; c.W = W; c.H = H;
    /* a crest that will not load falls back to the club's own address, then to the initials underneath it */
    svg.addEventListener('error', ev => {
      const t = ev.target;
      if (!t || !t.tagName || t.tagName.toLowerCase() !== 'image') return;
      const g = t.parentNode, e = byId().get(g && g.getAttribute('data-id'));
      const alt = e && e.logo && /^https:\/\//i.test(e.logo) ? e.logo : null;
      if (alt && t.getAttribute('href') !== alt && !t.__alt) { t.__alt = 1; t.setAttribute('href', alt); return; }
      g && g.querySelectorAll('[data-crest]').forEach(n => n.remove());
    }, true);
    c.zoom.classList.toggle('zoomed', !!(views[ci].x || views[ci].y));
    paintHover();
    paintCursor();
    const hid = built.hiddenLabels;
    c.plot.setAttribute('data-hidden', hid || '0');
    if (state.nm === 'a') c.built.note = hid ? hid + ' of ' + built.wanted + ' names left out where they would overlap' : '';
    renderFootNote();
  }
  function renderFootNote() {
    const el = foot.querySelector('.cl-names-note');
    if (!el) return;
    const bits = cards.map((c, i) => c.built && c.built.note ? (cards.length > 1 ? (i ? 'B: ' : 'A: ') : '') + c.built.note : '').filter(Boolean);
    el.textContent = bits.join(' · ');
    el.hidden = !bits.length;
  }

  /* ---- hover, the linked highlight, the tooltip ---- */
  function hitsOf(ci, id) { const c = cards[ci]; return c && c.built ? c.built.hits.filter(x => x.id === id && x.inside) : []; }
  function paintHover() {
    cards.forEach((c, ci) => {
      if (!c.hov) return;
      c.hov.textContent = '';
      if (!hover.id) return;
      const recs = hitsOf(ci, hover.id);
      recs.forEach(r => c.hov.appendChild(S('circle', { cx: num1(r.px), cy: num1(r.py), r: num1(r.r + 3.5), fill: 'none', stroke: theme.amber, 'stroke-width': 2.4 })));
      /* the other chart names the entity next to its ring, so the eye finds it there */
      if (ci !== hover.src && recs[0]) {
        const e = byId().get(hover.id), r = recs[0], txt = labelText(e, kindOf(), 's', state.lb);
        const right = r.px < c.W * 0.62;
        c.hov.appendChild(S('text', { x: num1(r.px + (right ? 1 : -1) * (r.r + 7)), y: num1(r.py + 3.5), 'text-anchor': right ? 'start' : 'end', fill: theme.ink, 'font-size': 11, 'font-weight': 800,
          'font-family': FONT.ui, stroke: theme.ground, 'stroke-width': 3.2, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, txt));
      }
    });
  }
  function setHover(id, src, rec) {
    if (hover.id === id && hover.src === src && !rec) return;
    hover = { id, src };
    paintHover();
    cards.forEach((c, ci) => { if (ci !== src || !id) hideTip(ci); });
    if (id && src >= 0 && rec) showTip(src, rec, false);
    if (!id) cards.forEach((c, ci) => { if (!sticky || sticky.ci !== ci) hideTip(ci); });
  }
  /* a tip a finger opened stays until it is put away (another tap, PIN, Esc); only `force` closes it */
  function hideTip(ci, force) { const c = cards[ci]; if (!c || (!force && sticky && sticky.ci === ci)) return; c.tip.hidden = true; }
  function rankLine(rawVals, v, col) {
    const r = rankOf(rawVals, v, col.low);
    if (!r) return '';
    return '#' + r.rank + ' of ' + r.n + (r.pct != null ? ' · ' + ord(r.pct) + ' pct' : '');
  }
  function showTip(ci, rec, stickyOn) {
    const c = cards[ci], D = charts[ci];
    if (!c || !D) return;
    const p = rec.p, e = p.e, tip = c.tip;
    tip.textContent = '';
    const row = (lab, col, mode, val, raw, all) => {
      const line = h('div', { class: 'cl-tr' });
      [h('span', { class: 'cl-tk', text: lab }),
        h('b', { class: 'cl-tv', text: fmtMode(val, mode, col.dp, col.signed) + (mode === 'a' ? '' : ' ') }),
        mode === 'a' ? h('span') : h('span', { class: 'cl-tw', text: '(' + fmtMode(raw, 'a', col.dp, col.signed) + ')' }),
        h('span', { class: 'cl-tr2', text: rankLine(all, raw, col) })].forEach(n => line.appendChild(n));
      return line;
    };
    tip.append(h('b', { class: 'cl-tn' }, [h('i', { class: 'cl-dot', style: 'background:' + (safeColour(e.colour) || 'var(--ink-3)') }), e.name]));
    if (state.ent === 'p' && e.clubName) tip.appendChild(h('span', { class: 'cl-tc', text: e.clubName + (e.pos ? ' · ' + ({ G: 'guard', F: 'wing', C: 'big' }[e.pos]) : '') }));
    tip.appendChild(row(D.cx.label, D.cx, D.xm, p.x, p.rx, D.rawX));
    tip.appendChild(row(D.cy.label, D.cy, D.overlay ? 'z' : D.ym, p.y, p.ry, D.rawY));
    if (D.overlay) tip.appendChild(row(D.cy2.label, D.cy2, 'z', p.y2, p.ry2, D.rawY2));
    const cs = catOf(state.ent), sc = state.sz && cs.byKey.get(state.sz);
    if (sc) tip.appendChild(h('div', { class: 'cl-tr' }, [h('span', { class: 'cl-tk', text: sc.label + ' (size)' }), h('b', { class: 'cl-tv', text: fmtMode(sc.get(e.row), 'a', sc.dp, sc.signed) })]));
    if (stickyOn) {
      const pinned = state.pin.indexOf(e.id) >= 0;
      tip.appendChild(h('button', { type: 'button', class: 'cl-tpin', text: pinned ? 'UNPIN' : 'PIN', onclick: () => { sticky = null; hideTip(ci, true); pin(e.id); } }));
      tip.classList.add('sticky');
    } else { tip.classList.remove('sticky'); if (sticky && sticky.ci === ci) sticky = null; }
    tip.hidden = false;
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    const left = clamp(rec.px - w / 2, 4, Math.max(4, c.W - w - 4));
    const above = rec.py - hh - (rec.r + 8), below = rec.py + rec.r + 10, room = c.H - hh - 4;
    /* over the point if it fits, else under it, else pinned inside the chart's edge */
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(above >= 4 ? above : below <= room ? below : clamp(above, 4, Math.max(4, room))) + 'px';
  }
  function announce(ci, rec) {
    const D = charts[ci], p = rec.p;
    say(p.e.name + (p.e.clubName && state.ent === 'p' ? ', ' + p.e.clubName : '') + '. ' + D.cx.label + ' ' + fmtMode(p.x, D.xm, D.cx.dp, D.cx.signed) + ', ' + D.cy.label + ' ' + fmtMode(p.y, D.overlay ? 'z' : D.ym, D.cy.dp, D.cy.signed) + '.');
  }
  /* pointer position -> chart units, whatever the page's zoom does to the client rectangle */
  const local = (c, ev) => { const b = c.svg.getBoundingClientRect(); return { x: (ev.clientX - b.left) * c.W / b.width, y: (ev.clientY - b.top) * c.H / b.height }; };
  function nearest(ci, ev) {
    const c = cards[ci];
    if (!c || !c.built) return null;
    const q = local(c, ev);
    let best = null, bd = 16;
    const hs = c.built.hits;
    for (let i = 0; i < hs.length; i++) {
      const r = hs[i];
      if (!r.inside) continue;
      const dx = r.px - q.x, dy = r.py - q.y, d = Math.sqrt(dx * dx + dy * dy) - r.r;
      if (d < bd || (d === bd && r.hi)) { bd = d; best = r; }
    }
    return best;
  }
  function paintCursor() {
    cards.forEach((c, ci) => {
      const old = c.hov && c.hov.querySelector('.cl-cur'); if (old) old.remove();
      if (!cursor || cursor.ci !== ci || !c.built || !c.hov) return;
      const r = hitsOf(ci, cursor.id)[0];
      if (!r) return;
      c.hov.appendChild(S('circle', { class: 'cl-cur', cx: num1(r.px), cy: num1(r.py), r: num1(r.r + 6), fill: 'none', stroke: theme.ink, 'stroke-width': 1.6, 'stroke-dasharray': '3 3' }));
    });
  }
  function moveCursor(ci, dir) {
    const c = cards[ci];
    if (!c || !c.built) return;
    const pts = c.built.hits.filter(r => r.inside && !r.ser);
    if (!pts.length) return;
    let cur = cursor && cursor.ci === ci ? pts.find(r => r.id === cursor.id) : null;
    if (!cur) {
      const hi = pts.filter(r => r.hi);
      cur = hi[0] || pts.reduce((b, r) => (!b || Math.abs(r.px - c.W / 2) + Math.abs(r.py - c.H / 2) < Math.abs(b.px - c.W / 2) + Math.abs(b.py - c.H / 2) ? r : b), null);
    } else cur = neighbourInDirection(pts, cur, dir) || cur;
    cursor = { ci, id: cur.id };
    setHover(cur.id, ci, cur);
    paintCursor(); announce(ci, cur);
  }
  function focusCursor(id) {
    const c = cards[0];
    if (!c) return;
    const r = hitsOf(0, id)[0];
    if (c.plot.scrollIntoView) { try { c.plot.scrollIntoView({ block: 'nearest' }); } catch (_) { /* fine */ } }
    c.plot.focus({ preventScroll: true });
    if (!r) { say('That one is not plotted with the present filters.'); return; }
    cursor = { ci: 0, id }; setHover(id, 0, r); paintCursor(); announce(0, r);
  }

  /* ---- zoom and pan ---- */
  function curRanges(ci) { const b = cards[ci].built; return { x: b.xr, y: b.yr, auto: b.auto }; }
  function zoomBy(ci, k, fx, fy) {
    const c = cards[ci]; if (!c || !c.built) return;
    const D = charts[ci], b = c.built, r = curRanges(ci);
    const ax = (lo, hi, f, log, autoR) => {
      const a = log ? Math.log10(lo) : lo, z = log ? Math.log10(hi) : hi, foc = a + f * (z - a);
      let n0 = foc - (foc - a) / k, n1 = foc + (z - foc) / k;
      const A0 = log ? Math.log10(autoR[0]) : autoR[0], A1 = log ? Math.log10(autoR[1]) : autoR[1];
      if (n1 - n0 >= (A1 - A0) * 0.999) return null;
      if (n1 - n0 < (A1 - A0) * 0.004) { const m = (n0 + n1) / 2, hw = (A1 - A0) * 0.002; n0 = m - hw; n1 = m + hw; }
      return log ? [Math.pow(10, n0), Math.pow(10, n1)] : [n0, n1];
    };
    fx = fx == null ? 0.5 : fx; fy = fy == null ? 0.5 : fy;
    const nx = ax(r.x[0], r.x[1], fx, D.xlog, b.auto.x), ny = ax(r.y[0], r.y[1], 1 - fy, D.ylog, b.auto.y);
    views[ci] = (nx || ny) ? { x: nx || b.auto.x, y: ny || b.auto.y } : {};
    if (views[ci].x && !nx) views[ci].x = null;
    if (views[ci].y && !ny) views[ci].y = null;
    interacting = true; clearTimeout(interT); interT = setTimeout(() => { interacting = false; scheduleDraw(ci); }, 160);
    scheduleDraw(ci);
  }
  function panBy(ci, dx, dy, base) {
    const c = cards[ci], D = charts[ci], b = c.built, p = b.plot;
    const sh = (lo, hi, d, len, log) => { const a = log ? Math.log10(lo) : lo, z = log ? Math.log10(hi) : hi, s = d / len * (z - a); return log ? [Math.pow(10, a - s), Math.pow(10, z - s)] : [a - s, z - s]; };
    const x = sh(base.x[0], base.x[1], dx, p.w, D.xlog), y = sh(base.y[0], base.y[1], -dy, p.h, D.ylog);
    views[ci] = { x, y };
    interacting = true; clearTimeout(interT); interT = setTimeout(() => { interacting = false; scheduleDraw(ci); }, 160);
    scheduleDraw(ci);
  }

  /* ---- one plot's events ---- */
  let drag = null;
  function wirePlot(card) {
    const ci = card.ci, plot = card.plot;
    plot.addEventListener('pointerdown', ev => {
      if (ev.target.closest('.cl-zoom, .cl-edit, .cl-tpin')) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      drag = { ci, x: ev.clientX, y: ev.clientY, moved: false, type: ev.pointerType, base: card.built ? { x: card.built.xr.slice(), y: card.built.yr.slice() } : null, id: ev.pointerId, target: ev.target };
    });
    plot.addEventListener('pointermove', ev => {
      if (drag && drag.ci === ci && drag.type === 'mouse' && ev.buttons & 1) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; try { plot.setPointerCapture(ev.pointerId); } catch (_) { /* fine */ } plot.classList.add('panning'); setHover(null, -1); }
        if (drag.moved && drag.base) {
          const b = card.svg.getBoundingClientRect();
          panBy(ci, dx * card.W / b.width, dy * card.H / b.height, drag.base);
        }
        return;
      }
      if (ev.pointerType === 'mouse') { const r = nearest(ci, ev); if (r) setHover(r.id, ci, r); else setHover(null, -1); plot.style.cursor = r ? 'pointer' : ''; }
    });
    plot.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse' && !(drag && drag.moved)) setHover(null, -1); });
    plot.addEventListener('pointerup', ev => {
      const d = drag; drag = null; plot.classList.remove('panning');
      try { plot.releasePointerCapture(ev.pointerId); } catch (_) { /* fine */ }
      if (!d || d.ci !== ci || d.moved) return;
      if (ev.target.closest && ev.target.closest('.cl-zoom, .cl-edit, .cl-tpin')) return;
      const ed = d.target.closest && d.target.closest('[data-edit]');
      if (ed) { beginEdit(ci, ed); return; }
      const r = nearest(ci, ev);
      if (!r) { sticky = null; hideTip(ci, true); return; }
      if (ev.pointerType === 'mouse') { pin(r.id); say(byId().get(r.id).name + (state.pin.indexOf(r.id) >= 0 ? ' highlighted' : ' no longer highlighted')); }
      else { sticky = { ci, id: r.id }; setHover(r.id, ci, null); showTip(ci, r, true); }
    });
    plot.addEventListener('pointercancel', () => { drag = null; plot.classList.remove('panning'); });
    plot.addEventListener('wheel', ev => {
      if (!(ev.ctrlKey || ev.metaKey || document.activeElement === plot)) return;
      ev.preventDefault();
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY, q = local(card, ev), p = card.built.plot;
      zoomBy(ci, Math.pow(1.0018, -dy), clamp((q.x - p.x0) / p.w, 0, 1), clamp((q.y - p.y0) / p.h, 0, 1));
    }, { passive: false });
    plot.addEventListener('dblclick', ev => { if (ev.target.closest('[data-edit]')) return; const q = local(card, ev), p = card.built.plot; zoomBy(ci, 2, clamp((q.x - p.x0) / p.w, 0, 1), clamp((q.y - p.y0) / p.h, 0, 1)); });
    plot.addEventListener('keydown', ev => {
      if (ev.target !== plot) return;
      const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[ev.key]) { ev.preventDefault(); moveCursor(ci, dirs[ev.key]); }
      else if ((ev.key === 'Enter' || ev.key === ' ') && cursor && cursor.ci === ci) { ev.preventDefault(); pin(cursor.id); }
      else if (ev.key === 'Escape') { cursor = null; sticky = null; cards.forEach((c, i) => hideTip(i, true)); setHover(null, -1); paintCursor(); }
      else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomBy(ci, 1.5); }
      else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); zoomBy(ci, 1 / 1.5); }
      else if (ev.key === '0') { views[ci] = {}; drawChart(ci); }
      else if (ev.key === 't' || ev.key === 'T') { change(s => { s.tb = s.tb ? 0 : 1; }, 'all'); }
    });
    plot.addEventListener('blur', () => { if (cursor && cursor.ci === ci) { cursor = null; paintCursor(); } });
  }

  /* ---------------------------------------------------------------- editing the text, on the chart --- */
  function closeEdit(commit) {
    const ed = ui.edit; if (!ed) return;
    ui.edit = null;
    if (commit) ed.done(sanitizeText(ed.input.value, ed.cap)); else if (ed.cancel) ed.cancel();
    ed.input.remove();
  }
  function beginEdit(ci, target) {
    closeEdit(true);
    const c = cards[ci], rel = target.getAttribute('data-edit'), id = target.getAttribute('data-id');
    let cap, current, done;
    if (rel === 'lb') { cap = LABEL_CAP; current = target.textContent; done = v => change(s => { if (v && v !== labelText(byId().get(id), kindOf(), s.nm, null)) s.lb[id] = v; else delete s.lb[id]; }, 'charts'); }
    else {
      const k = (ci ? 'b' : 'a') + rel;
      cap = TEXT_CAPS[k] || 60; current = target.textContent;
      done = v => change(s => { if (v) s.tx[k] = v; else delete s.tx[k]; }, 'charts');
    }
    const pr = c.plot.getBoundingClientRect(), tr = target.getBoundingClientRect(), z = pr.width / c.plot.clientWidth || 1;
    const input = h('input', { class: 'cl-edit ep-input', type: 'text', maxlength: String(cap), 'aria-label': 'Edit text', value: current });
    const vertical = rel === 'y';
    const w = vertical ? Math.min(260, c.W - 20) : clamp(tr.width / z + 60, 150, c.W - 16);
    const left = vertical ? 8 : clamp((tr.left - pr.left) / z - 8, 4, c.W - w - 4);
    const top = vertical ? clamp((tr.top + tr.height / 2 - pr.top) / z - 14, 4, c.H - 34) : clamp((tr.top - pr.top) / z - 6, 2, c.H - 32);
    input.style.cssText = 'left:' + Math.round(left) + 'px;top:' + Math.round(top) + 'px;width:' + Math.round(w) + 'px';
    c.plot.appendChild(input);
    ui.edit = { input, cap, done };
    input.focus(); input.select();
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); closeEdit(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeEdit(false); } });
    input.addEventListener('blur', () => { if (ui.edit && ui.edit.input === input) closeEdit(true); });
  }
  /* the title, subtitle and footnote are edited where they stand */
  function editHere(el, k, auto, cap) {
    closeEdit(true);
    const input = h('input', { class: 'cl-edit-in ep-input', type: 'text', maxlength: String(cap), 'aria-label': 'Edit text', value: state.tx[k] || auto || '' });
    el.replaceWith(input);
    const restore = () => { if (input.isConnected) input.replaceWith(el); };
    ui.edit = { input, cap, done: v => { change(s => { if (v && v !== auto) s.tx[k] = v; else delete s.tx[k]; }, 'all'); }, cancel: restore };
    input.focus(); input.select();
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); closeEdit(true); } else if (ev.key === 'Escape') { ev.preventDefault(); closeEdit(false); } });
    input.addEventListener('blur', () => { if (ui.edit && ui.edit.input === input) closeEdit(true); });
  }
  function renderTitles() {
    if (ui.edit && titles.contains(ui.edit.input)) return;
    titles.textContent = '';
    const A_ = autoTexts();
    const t = h('h3', { class: 'cl-t' + (state.tx.ti ? ' custom' : ''), tabindex: '0', role: 'button', title: 'Click to edit the title', text: textOf('ti') });
    const s = h('p', { class: 'cl-s' + (state.tx.su ? ' custom' : ''), tabindex: '0', role: 'button', title: 'Click to edit the subtitle', text: textOf('su') });
    const act = (el, k, auto, cap) => { el.addEventListener('click', () => editHere(el, k, auto, cap)); el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); editHere(el, k, auto, cap); } }); };
    act(t, 'ti', A_.ti, TEXT_CAPS.ti); act(s, 'su', A_.su, TEXT_CAPS.su);
    titles.append(t, s);
  }
  function renderFoot() {
    foot.textContent = '';
    const fo = h('p', { class: 'cl-fo' + (state.tx.fo ? ' custom' : ''), tabindex: '0', role: 'button', title: 'Click to add or edit a footnote', text: state.tx.fo || 'Add a footnote or a source line' });
    const act = () => editHere(fo, 'fo', '', TEXT_CAPS.fo);
    fo.addEventListener('click', act); fo.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(); } });
    const nm = h('p', { class: 'cl-names-note', hidden: true, role: 'note' });
    foot.append(fo, nm);
    if (state.cr) foot.appendChild(h('div', { class: 'cl-credit' }, [h('span', { class: 'cl-chip-wm', text: 'EPINOIΛ' }), h('span', { class: 'cl-credit-t', text: creditText() })]));
    renderFootNote();
  }

  /* ---------------------------------------------------------------- the text panel --- */
  function renderPanels() {
    panelText.hidden = !ui.text; panelExport.hidden = !ui.export;
    if (ui.text) renderTextPanel();
    if (ui.export) renderExportPanel();
  }
  let labelListEl = null;
  function refreshTextLabels() {
    if (!labelListEl || !inPage(labelListEl)) return;
    labelListEl.textContent = '';
    const seen = new Set();
    cards.forEach((c, ci) => {
      if (!c.built) return;
      c.built.labelled.forEach(l => {
        if (seen.has(l.id)) return; seen.add(l.id);
        const inp = h('input', { class: 'ep-input cl-lab-in', type: 'text', maxlength: String(LABEL_CAP), value: l.text, 'aria-label': 'Label for ' + (byId().get(l.id) || {}).name });
        inp.addEventListener('change', () => { const v = sanitizeText(inp.value, LABEL_CAP), e = byId().get(l.id); change(s => { if (v && v !== labelText(e, kindOf(), s.nm, null)) s.lb[l.id] = v; else delete s.lb[l.id]; }, 'charts'); });
        labelListEl.appendChild(h('label', { class: 'cl-lab-row' }, [h('span', { class: 'cl-lab-n', text: (byId().get(l.id) || {}).name || l.id }), inp]));
      });
    });
    if (!seen.size) labelListEl.appendChild(h('span', { class: 'cl-chips-none', text: 'No names are drawn at the moment.' }));
  }
  function renderTextPanel() {
    const p = panelText; p.textContent = '';
    const A_ = autoTexts();
    const field = (label, k, auto, cap) => {
      let t; /* one timer per box: a quick edit in the next box must not cancel this one */
      const inp = h('input', { class: 'ep-input cl-tf', type: 'text', maxlength: String(cap), value: state.tx[k] || '', placeholder: auto || '(none)', 'aria-label': label });
      inp.addEventListener('input', () => { const v = sanitizeText(inp.value, cap); clearTimeout(t); t = setTimeout(() => change(s => { if (v) s.tx[k] = v; else delete s.tx[k]; }, 'charts'), 160); });
      return h('label', { class: 'cl-tfr' }, [h('span', { class: 'cl-fl', text: label }), inp]);
    };
    p.appendChild(h('div', { class: 'cl-panel-h' }, [h('b', { text: 'TEXT' }), h('span', { text: 'Leave a box empty for the automatic text. You can also click any text on the chart to edit it (Enter keeps, Esc cancels).' })]));
    const g1 = h('div', { class: 'cl-tgrid' }, [field('Title', 'ti', A_.ti, TEXT_CAPS.ti), field('Subtitle', 'su', A_.su, TEXT_CAPS.su), field('Footnote / source', 'fo', '', TEXT_CAPS.fo)]);
    p.appendChild(g1);
    [0, 1].slice(0, state.b ? 2 : 1).forEach(ci => {
      const pf = ci ? 'b' : 'a', D = charts[ci];
      if (!D) return;
      const qs = quadrantTexts(D, {});
      p.appendChild(h('div', { class: 'cl-tsub', text: state.b ? (ci ? 'Chart B' : 'Chart A') : 'Chart' }));
      p.appendChild(h('div', { class: 'cl-tgrid' }, [
        field('X axis title', pf + 'x', axisTitleText(D.cx, D.xm), 60),
        field('Y axis title', pf + 'y', D.overlay ? D.cy.title + ' & ' + D.cy2.title + ': z-scores' : axisTitleText(D.cy, D.ym), 60),
        field('Legend caption', pf + 'lg', legendCaption(D), 130),
        field('Quadrant: top left', pf + 'q0', qs[0], 34), field('Quadrant: top right', pf + 'q1', qs[1], 34),
        field('Quadrant: bottom left', pf + 'q2', qs[2], 34), field('Quadrant: bottom right', pf + 'q3', qs[3], 34)
      ]));
    });
    p.appendChild(h('div', { class: 'cl-tsub', text: 'Point labels' }));
    labelListEl = h('div', { class: 'cl-lab-list' });
    p.appendChild(labelListEl);
    refreshTextLabels();
    const cr = h('input', { type: 'checkbox', id: 'cl-cr', checked: state.cr ? true : null });
    cr.addEventListener('change', () => change(s => { s.cr = cr.checked ? 1 : 0; }, 'all'));
    p.appendChild(h('div', { class: 'cl-panel-f' }, [
      h('label', { class: 'cl-check', for: 'cl-cr' }, [cr, ' Show the Epinoia credit line (name, league, season, date)']),
      key('RESET TEXT', { title: 'Put every title, caption and label back to the automatic text', click: () => { change(s => { s.tx = {}; s.lb = {}; }, 'all'); renderPanels(); } })
    ]));
  }

  /* ---------------------------------------------------------------- the table twin --- */
  let tsort = { col: 'name', dir: 1 }, tshown = 100;
  function renderTable() {
    tableBox.hidden = !state.tb;
    if (!state.tb) return;
    tableBox.textContent = '';
    const cols = [{ k: 'name', l: state.ent === 't' ? 'Team' : 'Player' }];
    charts.forEach((D, ci) => {
      const pf = state.b ? (ci ? 'B ' : 'A ') : '';
      cols.push({ k: 'x' + ci, l: pf + D.cx.label + (D.xm === 'a' ? '' : ' (' + MODES.find(m => m[0] === D.xm)[1] + ')'), ci, ax: 'x' });
      cols.push({ k: 'y' + ci, l: pf + D.cy.label + ((D.overlay ? 'z' : D.ym) === 'a' ? '' : ' (' + MODES.find(m => m[0] === (D.overlay ? 'z' : D.ym))[1] + ')'), ci, ax: 'y' });
      if (D.overlay) cols.push({ k: 'w' + ci, l: pf + D.cy2.label + ' (Z)', ci, ax: 'w' });
    });
    if (state.ent === 'p') cols.push({ k: 'club', l: 'Team' });
    const ids = new Set();
    charts.forEach(D => D.pts.forEach(p => ids.add(p.e.id)));
    const maps = charts.map(D => new Map(D.pts.map(p => [p.e.id, p])));
    const rows = [...ids].map(id => ({ e: byId().get(id), id }));
    const val = (r, c) => {
      if (c.k === 'name') return r.e.name; if (c.k === 'club') return r.e.clubName || '';
      const p = maps[c.ci].get(r.id); if (!p) return null;
      return c.ax === 'x' ? p.x : c.ax === 'y' ? p.y : p.y2;
    };
    const sc = cols.find(c => c.k === tsort.col) || cols[0];
    rows.sort((a, b) => {
      const x = val(a, sc), y = val(b, sc);
      if (x == null || y == null) return x == null && y == null ? 0 : (x == null ? 1 : -1);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * tsort.dir;
    });
    const tbl = h('table', { class: 'cl-table' });
    tbl.appendChild(h('caption', { text: 'The plotted rows: ' + rows.length + ' ' + noun(rows.length) + '. Sort by any column.' }));
    const trh = h('tr');
    cols.forEach(c => {
      const th = h('th', { scope: 'col', 'aria-sort': tsort.col === c.k ? (tsort.dir > 0 ? 'ascending' : 'descending') : 'none', class: tsort.col === c.k ? 'sorted' : '' });
      th.appendChild(h('button', { type: 'button', text: c.l, onclick: () => { tsort = { col: c.k, dir: tsort.col === c.k ? -tsort.dir : (c.k === 'name' || c.k === 'club' ? 1 : -1) }; tshown = 100; renderTable(); } }));
      trh.appendChild(th);
    });
    tbl.appendChild(h('thead', null, trh));
    const tb = h('tbody');
    const hi = hiSet();
    rows.slice(0, tshown).forEach(r => {
      const tr = h('tr', { class: hi.has(r.id) ? 'hl' : '' });
      cols.forEach(c => {
        if (c.k === 'name') {
          const href = state.ent === 'p' ? (opts.playerHref ? opts.playerHref(r.e) : '../p/?p=' + encodeURIComponent(r.id)) : (r.e.slug ? (opts.teamHref ? opts.teamHref(r.e) : '../t/?t=' + encodeURIComponent(r.e.slug)) : null);
          tr.appendChild(h('th', { scope: 'row' }, href ? h('a', { href, text: r.e.name }) : r.e.name));
        } else if (c.k === 'club') tr.appendChild(h('td', { text: r.e.clubName || '' }));
        else {
          const p = maps[c.ci].get(r.id), D = charts[c.ci];
          if (!p) { tr.appendChild(h('td', { class: 'num', text: '—' })); return; }
          const col = c.ax === 'x' ? D.cx : c.ax === 'y' ? D.cy : D.cy2, mode = c.ax === 'x' ? D.xm : (D.overlay ? 'z' : D.ym);
          const v = c.ax === 'x' ? p.x : c.ax === 'y' ? p.y : p.y2, raw = c.ax === 'x' ? p.rx : c.ax === 'y' ? p.ry : p.ry2;
          tr.appendChild(h('td', { class: 'num', text: fmtMode(v, mode, col.dp, col.signed) + (mode === 'a' ? '' : ' (' + fmtMode(raw, 'a', col.dp, col.signed) + ')') }));
        }
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    const scroller = h('div', { class: 'cl-tscroll', tabindex: '0', role: 'region', 'aria-label': 'Plotted rows' }, tbl);
    tableBox.appendChild(scroller);
    if (rows.length > tshown) tableBox.appendChild(h('button', { type: 'button', class: 'cl-key more', text: 'SHOW ' + Math.min(100, rows.length - tshown) + ' MORE', onclick: () => { tshown += 100; renderTable(); } }));
  }

  /* ---------------------------------------------------------------- export --- */
  const xo = { size: '1200x675', scale: 2, transparent: false, theme: 'page', preview: null, busy: 0 };
  let exStatus = null, exPreview = null, exNote = null, previewT = 0, previewUrl = null, previewSeq = 0;
  async function buildExport(noCrest) {
    const fonts = await fontCSS();
    const urls = new Map();
    if (!noCrest) [...hiSet()].map(id => byId().get(id)).filter(Boolean).forEach(e => { const u = logoUrl(e); if (u) urls.set(e.id, u); });
    const data = new Map();
    await Promise.all([...new Set(urls.values())].map(async u => { data.set(u, await crestData(u)); }));
    const gridW = Math.round(grid.clientWidth || wrap.clientWidth || 640);
    const shown = { w: side ? gridW : gridW + 56, chartH: cards.map(c => c.H || 380), side };
    return composeExport({
      size: xo.size, theme: xo.theme, transparent: xo.transparent, credit: !!state.cr, fonts, pageEl: wrap, shown,
      texts: { title: textOf('ti'), sub: textOf('su'), foot: state.tx.fo || '', credit: creditText() },
      charts: charts.map((D, ci) => (rect, fs, thm, crestFn) => cfgFor(ci, { W: rect.w, H: rect.h, fs, theme: thm, crest: crestFn, view: views[ci], uid: 'x' })),
      crest: e => { const u = urls.get(e.id); return u ? data.get(u) || null : null; }, wantCrest: e => !noCrest && urls.has(e.id)
    });
  }
  function noteFor(res, retried) {
    if (retried) return 'The browser would not draw the crests into the picture, so clubs are shown as coloured discs with initials.';
    if (res.crests.missing) return res.crests.missing + (res.crests.missing === 1 ? ' crest' : ' crests') + ' could not be embedded (the crest’s host does not allow it): ' + (res.crests.missing === 1 ? 'that club is' : 'those clubs are') + ' drawn as coloured discs with initials.';
    return '';
  }
  function schedulePreview() {
    clearTimeout(previewT);
    previewT = setTimeout(async () => {
      if (dead || !ui.export || !exPreview || !inPage(exPreview)) return;
      const seq = ++previewSeq;
      try {
        const res = await buildExport();
        if (seq !== previewSeq || dead || !inPage(exPreview)) return;
        const url = URL.createObjectURL(new Blob([serialize(res.svg)], { type: 'image/svg+xml;charset=utf-8' }));
        exPreview.onload = () => { if (previewUrl && previewUrl !== url) URL.revokeObjectURL(previewUrl); previewUrl = url; };
        exPreview.src = url;
        exPreview.width = res.w; exPreview.height = res.h;
        exPreview.setAttribute('data-w', res.w); exPreview.setAttribute('data-h', res.h);
        const dims = Math.round(res.w * xo.scale) + ' × ' + Math.round(res.h * xo.scale) + ' px';
        exStatus.textContent = 'PNG at ' + dims + ' · ' + res.w + ' × ' + res.h + ' in the SVG';
        exNote.textContent = noteFor(res, false); exNote.hidden = !exNote.textContent;
      } catch (e) { if (exStatus) exStatus.textContent = 'The preview could not be built: ' + e.message; }
    }, 220);
  }
  async function doExport(kind) {
    exStatus.textContent = 'Building the image…';
    const busy = ++xo.busy;
    try {
      let res = await buildExport(false), retried = false;
      const name = ext => exportFileName(league.name, season.name, textOf('ti'), ext);
      if (kind === 'svg') {
        download(new Blob([serialize(res.svg)], { type: 'image/svg+xml;charset=utf-8' }), name('svg'));
        exStatus.textContent = 'SVG saved (' + res.w + ' × ' + res.h + ')'; exNote.textContent = noteFor(res, false); exNote.hidden = !exNote.textContent;
        return;
      }
      let blob;
      try { blob = await svgToPng(serialize(res.svg), res.w, res.h, xo.scale); }
      catch (_) { res = await buildExport(true); retried = true; blob = await svgToPng(serialize(res.svg), res.w, res.h, xo.scale); }
      exNote.textContent = noteFor(res, retried); exNote.hidden = !exNote.textContent;
      if (kind === 'png') {
        download(blob, name('png'));
        exStatus.textContent = 'PNG saved (' + Math.round(res.w * xo.scale) + ' × ' + Math.round(res.h * xo.scale) + ' px)';
      } else {
        if (!(navigator.clipboard && navigator.clipboard.write && root.ClipboardItem)) { exStatus.textContent = 'This browser cannot copy images: use the PNG button.'; return; }
        await navigator.clipboard.write([new root.ClipboardItem({ 'image/png': blob })]);
        exStatus.textContent = 'Image copied to the clipboard.';
      }
    } catch (e) { if (busy === xo.busy) exStatus.textContent = 'The image could not be made: ' + e.message; }
  }
  function renderExportPanel() {
    const p = panelExport; p.textContent = '';
    const grp = (label, opts2, cur, onPick) => h('div', { class: 'cl-xg' }, [h('span', { class: 'cl-fl', text: label }),
      h('div', { class: 'cl-seg', role: 'group', 'aria-label': label }, opts2.map(o => key(o[1], { on: cur === o[0], title: o[2], click: () => { onPick(o[0]); renderExportPanel(); schedulePreview(); } })))]);
    p.appendChild(h('div', { class: 'cl-panel-h' }, [h('b', { text: 'EXPORT' }), h('span', { text: 'What you see, laid out again for the size you pick: highlighted points, edited text and all. The preview below is the file.' })]));
    p.appendChild(h('div', { class: 'cl-xrow' }, [
      grp('size', Object.keys(EXPORT_SIZES).map(k => [k, EXPORT_SIZE_LABELS[k].toUpperCase()]), xo.size, v => { xo.size = v; }),
      grp('png scale', [[1, '1X'], [2, '2X'], [3, '3X']], xo.scale, v => { xo.scale = v; }),
      grp('background', [[false, 'SOLID'], [true, 'TRANSPARENT']], xo.transparent, v => { xo.transparent = v; }),
      grp('theme', [['page', 'AS THE PAGE'], ['light', 'LIGHT'], ['dark', 'DARK']], xo.theme, v => { xo.theme = v; })
    ]));
    exPreview = h('img', { class: 'cl-prev', alt: 'Preview of the exported image', decoding: 'async' });
    exStatus = h('p', { class: 'cl-xs', role: 'status', text: 'Building the preview…' });
    exNote = h('p', { class: 'cl-xn', hidden: true });
    p.appendChild(h('div', { class: 'cl-prevbox' }, exPreview));
    p.appendChild(exStatus); p.appendChild(exNote);
    p.appendChild(h('div', { class: 'cl-panel-f' }, [
      key('DOWNLOAD PNG', { attrs: { 'data-x': 'png' }, click: () => doExport('png') }),
      key('DOWNLOAD SVG', { attrs: { 'data-x': 'svg' }, click: () => doExport('svg') }),
      key('COPY IMAGE', { attrs: { 'data-x': 'copy' }, title: 'copy the picture to the clipboard', click: () => doExport('copy') })
    ]));
  }

  /* ---------------------------------------------------------------- the whole page --- */
  function refresh() {
    if (dead) return;
    ctx = accessCtx();
    renderHead(); renderFind(); renderOpts(); renderStrip(); renderPanels();
    buildCards(); renderFoot();
    drawCharts();
    /* the controls are drawn again after a change: the one the reader was on gets the focus back, so the keyboard keeps its place */
    if (keepFocus) {
      const fk = keepFocus; keepFocus = null;
      const n = [...wrap.querySelectorAll('[data-fk]')].find(x => x.getAttribute('data-fk') === fk);
      if (n && !n.disabled) { try { n.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
    }
  }
  refresh();

  /* the page around it moves: a resize, the reader's theme, the fonts arriving, a membership answer */
  let lastW = 0, ro = null, rafRz = 0;
  const onResize = () => {
    if (rafRz) return;
    rafRz = requestAnimationFrame(() => { rafRz = 0; if (dead) return; const w = wrap.clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; drawCharts(); } });
  };
  lastW = wrap.clientWidth;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(onResize); ro.observe(wrap); } else window.addEventListener('resize', onResize);
  let mo = null;
  if (typeof MutationObserver === 'function') { mo = new MutationObserver(() => { if (!dead) drawCharts(); }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead) drawCharts(); });
  let offAccess = null;
  if (A && typeof A.onChange === 'function') {
    try {
      offAccess = A.onChange(() => {
        if (dead) return;
        const was = JSON.stringify([ctx.locked]);
        ctx = accessCtx();
        if (JSON.stringify([ctx.locked]) === was) return;
        state = fitState(state, catOf(state.ent), ctx);
        rebuildPickers(); refresh();
      });
    } catch (_) { offAccess = null; }
  }
  const handle = {
    getState: () => JSON.parse(JSON.stringify(state)),
    setState(s) { state = fitState(sanitizeState(s), catOf(sanitizeState(s).ent), ctx); views = [{}, {}]; syncUrl(); refresh(); },
    redraw: drawCharts,
    destroy() {
      dead = true;
      clearTimeout(urlT); clearTimeout(previewT); clearTimeout(interT); clearTimeout(toastT);
      closePicker(false); closeEdit(false);
      rebuildPickers();
      if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
      if (mo) mo.disconnect();
      if (typeof offAccess === 'function') { try { offAccess(); } catch (_) { /* gone */ } }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    /* for the tests of the page: what the last draw put on the chart */
    _debug: () => ({ state, charts, cards: cards.map(c => ({ hits: c.built && c.built.hits, labelled: c.built && c.built.labelled, plot: c.built && c.built.plot })), cats })
  };
  CURRENT = handle;
  return handle;
}

return {
  mount, current: () => CURRENT, MODES, TEXT_CAPS, TEXT_KEYS, EXPORT_SIZES, PRESET_DEFS, THEMES,
  transformValues, rankOf, regress, sanitizeText, defaultState, sanitizeState, compactState, encodeState, decodeState, withQuery, readQuery,
  matchEntities, fold, buildCatalogue, columnState, groupState, usableKey, fitState, presetsFor, presetState, matchPreset,
  computeChart, deriveRow, needsZones, niceTicks, logTicks, axisRange, tickDp, fmtMode, sizeScale, markColour, inkOn, parseHex, contrast,
  placeNames, basicPlaceLabels, anchorFor, neighbourInDirection, wrapLines, exportLayout, exportPixels, exportFileName, labelText, quadrantTexts,
  axisTitleText, goodQuadrant, toB64u, fromB64u
};
}));
