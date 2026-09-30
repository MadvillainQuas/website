'use strict';
/* ============================================================================
   WOWY LOGIC — the pure half of the WOWY / lineups page (no DOM, tested in node).

   window.EpinoiaWowyLogic

   The stint engine (lineups.js) makes the numbers. This file decides what to DO with them:

     COLS         every stat a lineup or an on/off split can honestly show, once: its key in the engine's
                  line, its label, its group, which way is better and how it is written. The column picker,
                  the heat, the export card and the deltas all read this one list.
     scale        a stat's spread across the league's own units (or the team's, until the league has loaded),
                  and where a value sits in it: a percentile, so a lineup's colour says "better than 90% of
                  the league's fives", not "over a number somebody picked".
     tone         that position as a signed step, DIRECTION-AWARE: for a stat where lower is better the
                  sign is turned round, so green always means good for the team.
     reliability  a unit that played too few minutes or possessions is 'thin' (or 'tiny'), with thresholds
                  the reader can change. Never hidden, only greyed and labelled.
     pickColumns  the column picker's rules (a cap, a phone's smaller default, grouped, searchable)
     gate         what a non-member's preview keeps (access.js CATALOGUE.wowyPreviewMax decides the players)
     state        the page's view as an address (?v=&sz=&a=&b=...) and back

   Nothing here invents a number. A stat the stint boxes cannot give (3P%, assists, steals, blocks, shot zones,
   the opponent's strength) is not in COLS at all.
   ============================================================================ */
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module === 'object' ? (function () { try { return require('./lineups.js'); } catch (_) { return null; } })() : null, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWowyLogic = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (nodeLineups, root) {

const L = () => nodeLineups || (root && root.EpinoiaLineups) || null;

/* --------------------------------------------------------------- columns ---
   dir: +1 higher is better for the team, -1 lower is better, 0 is a style rather than a quality (pace) or a
   sample size. fmt: 'n1' one decimal, 'n0' whole, 'sg' signed one decimal, 'pm' signed whole. */
const GROUPS = [
  ['sample', 'Sample'], ['rating', 'Ratings'], ['ours', 'Our four factors'], ['theirs', 'Their four factors'],
  ['shoot', 'Shooting'], ['board', 'Boards and turnovers']
];
const COLS = [
  { key: 'mins',  label: 'MIN',      name: 'Minutes',                  group: 'sample', dir: 0, fmt: 'n1', heat: 'seq' },
  { key: 'poss',  label: 'POSS',     name: 'Possessions',              group: 'sample', dir: 0, fmt: 'n1', heat: 'seq' },
  { key: 'stints',label: 'STINTS',   name: 'Stints',                   group: 'sample', dir: 0, fmt: 'n0', heat: 'seq' },
  { key: 'pm',    label: '+/-',      name: 'Plus-minus (points)',      group: 'sample', dir: 1, fmt: 'pm' },
  { key: 'pf',    label: 'PF',       name: 'Points for',               group: 'sample', dir: 0, fmt: 'n0' },
  { key: 'pa',    label: 'PA',       name: 'Points against',           group: 'sample', dir: 0, fmt: 'n0' },

  { key: 'net',   label: 'NET',      name: 'Net rating per 100',       group: 'rating', dir: 1,  fmt: 'sg' },
  { key: 'ortg',  label: 'ORTG',     name: 'Offensive rating per 100', group: 'rating', dir: 1,  fmt: 'n1' },
  { key: 'drtg',  label: 'DRTG',     name: 'Defensive rating per 100', group: 'rating', dir: -1, fmt: 'n1' },
  { key: 'pace',  label: 'PACE',     name: 'Possessions per 48',       group: 'rating', dir: 0,  fmt: 'n1' },

  { key: 'efg',   label: 'eFG%',     name: 'Effective FG%',            group: 'ours', dir: 1,  fmt: 'n1' },
  { key: 'tov',   label: 'TOV%',     name: 'Turnover %',               group: 'ours', dir: -1, fmt: 'n1' },
  { key: 'oreb',  label: 'OREB%',    name: 'Offensive rebound %',      group: 'ours', dir: 1,  fmt: 'n1' },
  { key: 'ftr',   label: 'FTr',      name: 'Free-throw rate',          group: 'ours', dir: 1,  fmt: 'n1' },

  { key: 'defg',  label: 'OPP eFG%', name: 'Opponent eFG%',            group: 'theirs', dir: -1, fmt: 'n1' },
  { key: 'dtov',  label: 'OPP TOV%', name: 'Opponent turnover %',      group: 'theirs', dir: 1,  fmt: 'n1' },
  { key: 'doreb', label: 'OPP OREB%',name: 'Opponent offensive reb %', group: 'theirs', dir: -1, fmt: 'n1' },
  { key: 'dftr',  label: 'OPP FTr',  name: 'Opponent free-throw rate', group: 'theirs', dir: -1, fmt: 'n1' },

  { key: 'ts',    label: 'TS%',      name: 'True shooting %',          group: 'shoot', dir: 1,  fmt: 'n1' },
  { key: 'fgp',   label: 'FG%',      name: 'Field-goal %',             group: 'shoot', dir: 1,  fmt: 'n1' },
  { key: 'tpm',   label: '3PM/100',  name: 'Threes made per 100',      group: 'shoot', dir: 1,  fmt: 'n1' },
  { key: 'dts',   label: 'OPP TS%',  name: 'Opponent true shooting %', group: 'shoot', dir: -1, fmt: 'n1' },
  { key: 'dfgp',  label: 'OPP FG%',  name: 'Opponent field-goal %',    group: 'shoot', dir: -1, fmt: 'n1' },
  { key: 'dtpm',  label: 'OPP 3PM/100', name: 'Opponent threes per 100', group: 'shoot', dir: -1, fmt: 'n1' },

  { key: 'drb',   label: 'DREB%',    name: 'Defensive rebound %',      group: 'board', dir: 1,  fmt: 'n1' },
  { key: 'tovr',  label: 'TOV/100',  name: 'Turnovers per 100',        group: 'board', dir: -1, fmt: 'n1' },
  { key: 'dtovr', label: 'FORCED/100', name: 'Turnovers forced per 100', group: 'board', dir: 1, fmt: 'n1' },
  { key: 'ptsf',  label: 'PTS/100',  name: 'Points scored per 100',    group: 'board', dir: 1,  fmt: 'n1' }
];
const BY_KEY = {}; COLS.forEach(c => { BY_KEY[c.key] = c; });
const col = k => BY_KEY[k] || null;

/* what a five's row shows before the reader chooses: more on a wide screen, the essentials on a phone */
const DEFAULT_COLS = {
  wide:  ['mins', 'poss', 'net', 'ortg', 'drtg', 'pace', 'efg', 'tov', 'oreb', 'ftr', 'defg', 'dtov'],
  mid:   ['mins', 'poss', 'net', 'ortg', 'drtg', 'pace', 'efg', 'tov'],
  phone: ['mins', 'net', 'ortg', 'drtg']
};
const MAX_COLS = { wide: 14, mid: 9, phone: 6 };
/* the width class of the space the table has: a phone (or a narrow column beside the rail), a middling one, a wide one.
   Pure, so the page and the tests agree on the cut-offs. `kind` may also be a boolean (true = phone). */
const sizeKind = w => (w < 520 ? 'phone' : w < 900 ? 'mid' : 'wide');
const kindOf = k => (k === true ? 'phone' : k === false || k == null ? 'wide' : (DEFAULT_COLS[k] ? k : 'wide'));

const isNum = v => typeof v === 'number' && isFinite(v);
function fmt(k, v) {
  const c = typeof k === 'string' ? col(k) : k;
  if (!isNum(v)) return '—';
  const f = c ? c.fmt : 'n1';
  if (f === 'sg') return (v > 0 ? '+' : '') + v.toFixed(1);
  if (f === 'pm') return (v > 0 ? '+' : '') + Math.round(v);
  if (f === 'n0') return String(Math.round(v));
  return v.toFixed(1);
}

/* ---------------------------------------------------------------- scale ---
   A distribution of one stat over the reference units: sorted values, mean and standard deviation. Values are
   whatever the units' lines say; a unit without a value (null) is left out. */
function scaleOf(values) {
  const v = (values || []).filter(isNum).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0, sorted: v, mean: 0, sd: 0, min: 0, max: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  return { n, sorted: v, mean, sd, min: v[0], max: v[n - 1] };
}

/* the share of the reference at or below the value, ties split: 0..1 (null when there is nothing to compare to) */
function percentile(sc, x) {
  if (!sc || !sc.n || !isNum(x)) return null;
  const a = sc.sorted;
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  const below = lo;
  hi = a.length;
  let eq = 0;
  for (let i = below; i < hi && a[i] === x; i++) eq++;
  return (below + eq / 2) / sc.n;
}

/* z, or null when the spread is nil */
function zscore(sc, x) {
  if (!sc || !sc.n || !sc.sd || !isNum(x)) return null;
  return (x - sc.mean) / sc.sd;
}

/* THE TONE OF A VALUE: -1 (worst end for the team) to +1 (best end), 0 at the middle, from where it ranks. A stat
   where lower is better (dir -1) is turned round, so a low turnover rate is green. dir 0 has no good end: null.
   Fewer than four units in the reference is not a spread, so no tone. */
function tone(sc, x, dir) {
  if (!dir || !sc || sc.n < 4) return null;
  const p = percentile(sc, x);
  if (p == null) return null;
  const t = (p - 0.5) * 2;
  return Math.round((dir > 0 ? t : -t) * 1000) / 1000;
}

/* five bands like the box score's lineups tab (h1 worst .. h5 best) */
function band(t) {
  if (t == null) return 0;
  return 1 + Math.min(4, Math.floor(((t + 1) / 2) * 5));
}

/* the tint of a tone as CSS: a mix of the good or the bad colour, stronger the further from the middle. The
   strongest cell is 40% of the colour, so text stays readable on both themes. */
function tint(t) {
  if (t == null) return '';
  const a = Math.round(Math.min(1, Math.abs(t)) * 40);
  if (a < 3) return '';
  return 'color-mix(in srgb,var(' + (t > 0 ? '--good' : '--bad') + ') ' + a + '%,transparent)';
}

/* the sample itself as a single-hue heat: minutes against the biggest in the list (0..1) */
function seqShare(v, max) { return isNum(v) && max > 0 ? Math.max(0, Math.min(1, v / max)) : 0; }

/* the reference for one stat: the units of that size across the league, only those that played enough to
   mean something; the team's own units stand in until the league is in */
function referenceScales(units, cols, thr) {
  const out = {};
  const ok = (units || []).filter(u => reliability(u, thr) === 'ok');
  const pool = ok.length >= 8 ? ok : (units || []).filter(u => reliability(u, thr) !== 'tiny');
  (cols || COLS.map(c => c.key)).forEach(k => {
    const c = col(k);
    if (!c || !c.dir) return;
    out[k] = scaleOf(pool.map(u => u[k]));
  });
  return out;
}

/* ------------------------------------------------------------ reliability ---
   'ok' when the unit has both the minutes and the possessions asked for; 'thin' when it has at least half of
   each; 'tiny' below that. A unit with no line is 'tiny'. The reader moves the two thresholds. */
const DEFAULT_THR = { minMinutes: 10, minPoss: 20 };
function reliability(u, thr) {
  const t = Object.assign({}, DEFAULT_THR, thr || {});
  if (!u || !isNum(u.mins) || !isNum(u.poss)) return 'tiny';
  if (u.mins >= t.minMinutes && u.poss >= t.minPoss) return 'ok';
  if (u.mins >= t.minMinutes / 2 && u.poss >= t.minPoss / 2) return 'thin';
  return 'tiny';
}
function normThr(minMinutes, minPoss) {
  const m = parseFloat(minMinutes), p = parseFloat(minPoss);
  return { minMinutes: isFinite(m) && m >= 0 ? Math.min(m, 2000) : DEFAULT_THR.minMinutes,
           minPoss: isFinite(p) && p >= 0 ? Math.min(p, 4000) : DEFAULT_THR.minPoss };
}

/* --------------------------------------------------------- column picker --- */
function limits(kind) { const k = kindOf(kind); return { max: MAX_COLS[k], def: DEFAULT_COLS[k].slice() }; }

/* the columns a view shows: the saved choice with unknown keys dropped and the cap applied, or the default.
   Order is the catalogue's, not the click order, so a table's columns always read in the same sequence. */
function pickColumns(saved, phone) {
  const lim = limits(phone);
  let keys = Array.isArray(saved) ? saved.filter(k => BY_KEY[k]) : [];
  keys = [...new Set(keys)];
  if (!keys.length) keys = lim.def;
  keys = COLS.map(c => c.key).filter(k => keys.indexOf(k) !== -1);
  return keys.slice(0, lim.max);
}
/* toggling one: returns the new list, refusing to go over the cap or to leave none */
function toggleColumn(cur, key, phone) {
  const lim = limits(phone);
  const has = cur.indexOf(key) !== -1;
  if (!BY_KEY[key]) return cur.slice();
  if (has) return cur.length > 1 ? cur.filter(k => k !== key) : cur.slice();
  if (cur.length >= lim.max) return cur.slice();
  return pickColumns(cur.concat(key), phone);
}
/* the picker's list: grouped, filtered by a search over label, name and group */
function searchColumns(q) {
  const s = String(q || '').trim().toLowerCase();
  return GROUPS.map(([g, title]) => ({
    group: g, title,
    cols: COLS.filter(c => c.group === g && (!s || (c.label + ' ' + c.name + ' ' + title).toLowerCase().indexOf(s) !== -1))
  })).filter(g => g.cols.length);
}

/* --------------------------------------------------------------- sorting --- */
function sortRows(rows, key, dir, thr, gateSample) {
  const c = col(key);
  const sign = dir === 'asc' ? 1 : -1;
  let r = rows.slice();
  if (gateSample) r = r.filter(u => reliability(u, thr) === 'ok');
  r.sort((a, b) => {
    const x = a[key], y = b[key];
    if (!isNum(x) && !isNum(y)) return 0;
    if (!isNum(x)) return 1;
    if (!isNum(y)) return -1;
    return (x - y) * sign || (b.mins - a.mins);
  });
  return r;
}

/* ------------------------------------------------------ filters on units --- */
function filterUnits(units, o) {
  const inc = (o && o.inc) || [], exc = (o && o.exc) || [];
  const mm = (o && o.minMinutes) || 0, mp = (o && o.minPoss) || 0;
  return units.filter(u => {
    for (let i = 0; i < inc.length; i++) if (u.ids.indexOf(inc[i]) === -1) return false;
    for (let i = 0; i < exc.length; i++) if (u.ids.indexOf(exc[i]) !== -1) return false;
    return u.mins >= mm && u.poss >= mp;
  });
}

/* ------------------------------------------------------- pair buckets ----
   Two players, four buckets: both, only A, only B, neither. The line of each is the engine's, and each carries
   which of the two was on the floor (for the ring) and the delta from the team's whole line. */
function pairBuckets(stints, aId, bId) {
  const w = L().wowy(stints, aId, bId);
  const base = L().filter(stints, []);
  const mk = (k, line, a, b) => ({ key: k, line, a, b, base });
  return [mk('both', w.both, true, true), mk('aOnly', w.aOnly, true, false),
          mk('bOnly', w.bOnly, false, true), mk('neither', w.neither, false, false)];
}

/* every teammate of one player: the team with both, with him and not the mate, with the mate and not him, and
   the swing. `minTogether` is the minutes both must have shared to be listed. */
function partners(stints, pid, minTogether) {
  const mates = new Set();
  (stints || []).forEach(st => {
    const ids = st.player_ids || [];
    if (ids.indexOf(pid) === -1) return;
    ids.forEach(id => { if (id !== pid) mates.add(id); });
  });
  const floor = minTogether == null ? 0 : minTogether;
  const out = [];
  mates.forEach(id => {
    const w = L().wowy(stints, pid, id);
    if (w.both.mins < floor) return;
    out.push({ id, both: w.both, subjOnly: w.aOnly, mateOnly: w.bOnly, neither: w.neither,
      swing: (isNum(w.both.net) && isNum(w.aOnly.net)) ? Math.round((w.both.net - w.aOnly.net) * 10) / 10 : null });
  });
  return out.sort((a, b) => (b.swing == null ? -1e9 : b.swing) - (a.swing == null ? -1e9 : a.swing));
}

/* every column's ON, OFF and delta for a split (on/off of a player, or a unit against the rest). `delta` is
   on minus off; `good` is the delta turned by the stat's direction: positive is good for the team. */
function splitRows(on, off, keys) {
  return (keys || COLS.map(c => c.key)).map(k => {
    const c = col(k);
    const a = on ? on[k] : null, b = off ? off[k] : null;
    const d = isNum(a) && isNum(b) ? Math.round((a - b) * 10) / 10 : null;
    return { key: k, col: c, on: a, off: b, delta: d, good: d == null || !c || !c.dir ? null : d * c.dir };
  });
}

/* a unit against the team's minutes WITHOUT it: the stints whose five do not contain all of the unit */
function unitVsRest(stints, ids) {
  const on = L().blank(), off = L().blank();
  (stints || []).forEach(st => {
    const have = st.player_ids || [];
    const all = ids.every(id => have.indexOf(id) !== -1);
    L().add(all ? on : off, st);
  });
  return { on: L().finish(on, 'unit'), off: L().finish(off, 'rest') };
}

/* what the LINEUP BUILDER shows for the players chosen: the units that contain all of them (for five, that
   is the exact unit). For five with no stints it falls back to the fours inside it with the most minutes, and
   says so through `mode`. */
function build(stints, ids) {
  const pick = (ids || []).slice(0, 5);
  if (!pick.length) return { mode: 'none', line: null, ids: pick, near: [] };
  const line = L().filter(stints, pick, 'unit');
  if (line.stints > 0) return { mode: pick.length === 5 ? 'exact' : 'containing', line, ids: pick, near: [] };
  if (pick.length === 5) {
    const near = [];
    pick.forEach((_, i) => {
      const four = pick.filter((__, j) => j !== i);
      const l4 = L().filter(stints, four, 'four');
      if (l4.stints > 0) near.push(Object.assign(l4, { ids: four, without: pick[i] }));
    });
    near.sort((a, b) => b.mins - a.mins);
    return { mode: near.length ? 'nearest' : 'never', line: null, ids: pick, near };
  }
  return { mode: 'never', line: null, ids: pick, near: [] };
}

/* the most common starting five: games carry `starters` as [homeIds, awayIds] */
function startingFive(games, teamId) {
  const by = new Map();
  (games || []).forEach(g => {
    if (!Array.isArray(g.starters)) return;
    const side = g.home_team_id === teamId ? 0 : g.away_team_id === teamId ? 1 : -1;
    const five = side >= 0 ? g.starters[side] : null;
    if (!Array.isArray(five) || five.length < 5) return;
    const ids = five.slice().sort();
    const k = ids.join(',');
    const v = by.get(k) || { ids, games: 0 };
    v.games++; by.set(k, v);
  });
  const all = [...by.values()].sort((a, b) => b.games - a.games);
  return all[0] || null;
}

/* ------------------------------------------------------------- the gate ---
   What a non-member's preview keeps. `max` is CATALOGUE.wowyPreviewMax (players). The rules follow the page
   the preview always was: on/off and the rotation stay open; whatever needs two players or more at once (the
   pair, the builder, the combinations, the sized units) shows what one player can, and a teaser. */
function gate(preview, max) {
  const m = Math.max(1, max | 0 || 1);
  if (!preview) return { preview: false, players: 5, rows: Infinity, sizes: [2, 3, 4, 5], pair: true, builder: true, export: true, matrixMax: 5 };
  return { preview: true, players: m, rows: 5, sizes: [5], pair: m >= 2, builder: m >= 5, export: true, matrixMax: m };
}

/* -------------------------------------------------------- the address ---- */
const VIEWS = ['overview', 'lineups', 'onoff', 'pair', 'build'];
const DEFAULT_STATE = { v: 'overview', t: '', sz: 5, sort: 'mins', dir: 'desc', best: '', p: '', a: '', b: '', u: [], inc: [], exc: [], mm: DEFAULT_THR.minMinutes, mp: DEFAULT_THR.minPoss };
const ID = /^[A-Za-z0-9:_-]{1,64}$/;
const ids = s => String(s || '').split(',').filter(x => ID.test(x)).slice(0, 5);

function decodeState(search) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const s = Object.assign({}, DEFAULT_STATE, { u: [], inc: [], exc: [] });
  const v = q.get('v'); if (VIEWS.indexOf(v) !== -1) s.v = v;
  s.t = (q.get('t') || '').slice(0, 80);
  const sz = parseInt(q.get('sz'), 10); if (sz >= 2 && sz <= 5) s.sz = sz;
  const so = q.get('sort'); if (BY_KEY[so]) s.sort = so;
  if (q.get('dir') === 'asc') s.dir = 'asc';
  const be = q.get('best'); if (be === 'best' || be === 'worst') s.best = be;
  ['p', 'a', 'b'].forEach(k => { const x = q.get(k); if (x && ID.test(x)) s[k] = x; });
  s.u = ids(q.get('u')); s.inc = ids(q.get('inc')); s.exc = ids(q.get('exc'));
  const t = normThr(q.get('mm'), q.get('mp')); s.mm = q.get('mm') == null ? DEFAULT_THR.minMinutes : t.minMinutes; s.mp = q.get('mp') == null ? DEFAULT_THR.minPoss : t.minPoss;
  return s;
}

/* only what differs from the default is written, so a plain page keeps a plain address. Keys that are not this
   page's (l, s, c) are kept from `base`. */
function encodeState(state, base) {
  const q = new URLSearchParams(String(base || '').replace(/^\?/, ''));
  ['v', 't', 'sz', 'sort', 'dir', 'best', 'p', 'a', 'b', 'u', 'inc', 'exc', 'mm', 'mp'].forEach(k => q.delete(k));
  const s = Object.assign({}, DEFAULT_STATE, state || {});
  if (s.v !== DEFAULT_STATE.v) q.set('v', s.v);
  if (s.t) q.set('t', s.t);
  if (s.sz !== DEFAULT_STATE.sz) q.set('sz', String(s.sz));
  if (s.sort !== DEFAULT_STATE.sort) q.set('sort', s.sort);
  if (s.dir !== DEFAULT_STATE.dir) q.set('dir', s.dir);
  if (s.best) q.set('best', s.best);
  ['p', 'a', 'b'].forEach(k => { if (s[k]) q.set(k, s[k]); });
  ['u', 'inc', 'exc'].forEach(k => { if (s[k] && s[k].length) q.set(k, s[k].join(',')); });
  if (s.mm !== DEFAULT_THR.minMinutes) q.set('mm', String(s.mm));
  if (s.mp !== DEFAULT_THR.minPoss) q.set('mp', String(s.mp));
  const out = q.toString();
  return out ? '?' + out : '';
}

/* three-state click on a player in the filter: nothing -> with him -> without him -> nothing */
function cycleFilter(inc, exc, id) {
  const i = inc.indexOf(id), x = exc.indexOf(id);
  if (i === -1 && x === -1) return { inc: inc.concat(id).slice(-5), exc };
  if (i !== -1) return { inc: inc.filter(k => k !== id), exc: exc.concat(id).slice(-5) };
  return { inc, exc: exc.filter(k => k !== id) };
}

/* every player's team-on and team-off line in one list, for the league's spread of on/off swings */
function playerSplits(stints, minMinutes) {
  const ids = new Set();
  (stints || []).forEach(st => (st.player_ids || []).forEach(id => ids.add(id)));
  const out = [];
  ids.forEach(id => {
    const oo = L().onOff(stints, id);
    if (oo.on.mins >= (minMinutes || 0)) out.push({ id, on: oo.on, off: oo.off, diff: oo.diff });
  });
  return out;
}

/* the name a circle carries: initials from a full name, as the site does elsewhere */
function initialsOf(name) {
  const w = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}
function surname(name) {
  const w = String(name || '').trim().split(/\s+/);
  const suf = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  if (w.length > 1 && suf.test(w[w.length - 1])) w.pop();
  return w[w.length - 1] || '?';
}

return { COLS, GROUPS, col, fmt, DEFAULT_COLS, MAX_COLS, sizeKind, DEFAULT_THR, VIEWS, DEFAULT_STATE,
  scaleOf, percentile, zscore, tone, band, tint, seqShare, referenceScales,
  reliability, normThr, limits, kindOf, playerSplits, pickColumns, toggleColumn, searchColumns, sortRows, filterUnits,
  pairBuckets, partners, splitRows, unitVsRest, build, startingFive, gate,
  decodeState, encodeState, cycleFilter, initialsOf, surname };
}));
