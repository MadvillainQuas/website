'use strict';
/* ============================================================================
   THE STAT CATALOGUE OF THE GRAPHICS TAB - the website's own columns, not a second list.

   Every picker in the Graphics tab (a star's stat lines, a table's columns, the leaders' categories, the stars of
   the month's ranking) offers the columns the site's statistics tables have, with the site's labels, its
   definitions (statinfo.js), its formatting (the column's own `fmt`) and its direction (`low`: lower is better).
   The catalogue is read from epinoia/fulltable.js's PLAYER_COLS and TEAM_COLS at the moment it is asked, so a column
   added there (or switched off there, HIDDEN_COLS) appears here (or goes) with nothing to change in this file.

   WHAT IS LEFT OUT, and why
     identity columns (#, name, team)               they name the row, they are not a stat
     the columns fulltable.js HIDDEN_COLS switches off  (total S%, PPR, PPS, on-court ORTG / DRTG): already spliced out
     the membership-locked columns                   events (ev_*, evd_*), the zone columns (z_*) and the four
                                                     analytics columns of access.js CATALOGUE. The console is an
                                                     administrator's, so `premium: true` offers them, unless the
                                                     lock flag says this league's analytics are locked (`locked`)

   THE NUMBERS come from the same engine: season.js players() / teams() over a set of games' rows (one game, a week,
   a month or a season), then attachBPM(), exactly what data.js statsForGames() does. Nothing is calculated here.

   A column is addressed by "c:" + its key ("c:ppg", "c:ts_pct"), which is what socialcard.js's modules and models
   carry; socialcard.js itself knows nothing of the catalogue, only the text and the direction each key comes with.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStatCat = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const TAB = () => root.EpinoiaTable, SEA = () => root.EpinoiaSeason, INFO = () => root.EpinoiaStatInfo;

const GROUP_LABELS = {
  basic: 'Per game', totals: 'Totals', shooting: 'Shooting', playmaking: 'Playmaking', defense: 'Defence', rebounding: 'Rebounding',
  onoff: 'On / off', vs: 'Opponent', advanced: 'Advanced', misc: 'Misc', four: 'Four factors', ratings: 'Ratings', scoring: 'Scoring types',
  z_rim: 'Zones: rim and paint', z_mid: 'Zones: mid-range', z_three: 'Zones: threes', z_cuts: 'Zones: the cuts', z_rate: 'Zones: rate',
  ev_second: 'Events: second chance', ev_transition: 'Events: transition', ev_offTo: 'Events: off turnovers', ev_ato: 'Events: after timeout',
  ev_half: 'Events: half court', ev_assist: 'Events: assisted', other: 'Other'
};
/* the locked columns, as access.js CATALOGUE names them (a test reads access.js and holds this to it) */
const PREMIUM_PREFIXES = ['ev_', 'evd_', 'z_', 'rb_'], PREMIUM_COLUMNS = ['pred_efg', 'efg_sh', 'efg_vs', 'morey'];
const isPremium = k => PREMIUM_PREFIXES.some(p => String(k).indexOf(p) === 0) || PREMIUM_COLUMNS.includes(k);

/* the catalogue: [{ id: 'c:ppg', k, label, title, group, groupLabel, low, signed, kind, premium, col }] in the site's order.
   opts.premium: offer the locked columns (the console's administrator); opts.locked: the league's analytics lock is on, so no */
function catalogue(kind, opts) {
  const o = opts || {}, T = TAB();
  if (!T) return [];
  const cols = kind === 'team' ? T.TEAM_COLS : T.PLAYER_COLS;
  const presets = ((T.PRESETS || {})[kind === 'team' ? 'team' : 'player'] || []).map(p => p[0]).filter(k => k !== '*');
  const hidden = T.HIDDEN_COLS || new Set();
  const out = [];
  cols.forEach(c => {
    const g = c.g || [];
    if (c.text || g.includes('id') || hidden.has(c.k)) return;
    const prem = isPremium(c.k);
    if (prem && (!o.premium || o.locked)) return;
    const grp = presets.find(p => g.includes(p)) || 'other';
    out.push({ id: 'c:' + c.k, k: c.k, label: c.l, title: c.t || c.l, group: grp, groupLabel: GROUP_LABELS[grp] || grp, low: !!c.low, signed: !!c.signed,
      kind: kind === 'team' ? 'team' : 'player', premium: prem, col: c });
  });
  return out;
}
/* by id ("c:ppg") */
function byId(kind, opts) { const m = new Map(); catalogue(kind, opts).forEach(c => m.set(c.id, c)); return m; }
/* the catalogue as the picker draws it: [{ group, label, cols: [...] }] in the site's order of groups */
function grouped(list) {
  const out = [];
  list.forEach(c => { let g = out.find(x => x.group === c.group); if (!g) { g = { group: c.group, label: c.groupLabel, cols: [] }; out.push(g); } g.cols.push(c); });
  return out;
}
/* the picker's search: label, longer name, key and group, case-insensitive; every word must be found */
function search(list, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter(c => { const hay = (c.label + ' ' + c.title + ' ' + c.k + ' ' + c.groupLabel).toLowerCase(); return words.every(w => hay.includes(w)); });
}
/* the site's plain-English definition of a column, when it has one (statinfo.js): { title, what, formula, read } or null */
function explain(c) {
  const I = INFO();
  try { return I && I.info ? I.info(c.k, c.kind) : null; } catch (_) { return null; }
}
/* lower is better: the column's own flag, or statinfo's for a column that flag does not carry */
function isLow(c) { const i = explain(c); return !!(c.low || (i && i.low)); }

/* a number for a column of a row, or null (a column may sort by its own key, r.__i aside) */
function value(c, row) {
  if (!c || !row) return null;
  const col = c.col || c;
  let v;
  try { v = col.sort ? col.sort(row) : row[col.k]; } catch (_) { v = null; }
  return typeof v === 'number' && isFinite(v) ? v : null;
}
/* the text the site would print for it: '—' when there is nothing to say */
function text(c, row) {
  const col = c.col || c;
  try { const t = col.fmt ? col.fmt(row, 0) : row[col.k]; return t == null ? '—' : String(t); } catch (_) { return '—'; }
}
/* the columns of the catalogue that have something to say for these rows (a column of an unread situation is a dash all down) */
function available(list, rows) {
  return list.filter(c => rows.some(r => value(c, r) != null || (c.col && c.col.text)));
}

/* ------------------------------------------------------------ the engine --- */
/* Lines of a set of games -> the site's rows, through season.js: { players, teams }. `lines`: { games, pgs, tgs, meta, teamName }
   (see socialgfx-ui.js readLines); `only`: a Set of game ids (a week, a month, one game), or null for all. */
function rowsOf(lines, only) {
  const S = SEA();
  if (!S || !lines) return { players: [], teams: [] };
  const inSet = id => !only || only.has(id);
  const games = lines.games.filter(g => inSet(g.id));
  const pgs = lines.pgs.filter(r => inSet(r.game_id)), tgs = lines.tgs.filter(r => inSet(r.game_id));
  const byGame = {}; games.forEach(g => { byGame[g.id] = g; });
  const meta = {}, teamOf = new Map();
  pgs.forEach(r => {
    const id = r.player_uuid || r.player_id, g = byGame[r.game_id];
    if (!id || !g) return;
    const tid = r.team_idx === 0 ? g.home_team_id : g.away_team_id;
    teamOf.set(id, tid);
    const adv = (r.stats && r.stats.adv) || {};
    meta[id] = { name: adv.name || (lines.meta && lines.meta[id] && lines.meta[id].name) || '', jersey: adv.num, teamName: (lines.teamName && lines.teamName(tid)) || '', teamId: tid };
  });
  const players = S.players(pgs, tgs, meta);
  players.forEach(p => { const m = meta[p.id]; if (m) { p.name = p.name || m.name; p.teamName = p.teamName || m.teamName; p.teamId = m.teamId; } });
  const teams = S.teams(tgs, byGame);
  teams.forEach(t => { t.name = t.name || (lines.teamName && lines.teamName(t.id)) || ''; });
  try { S.attachBPM(players, teams, teamOf); } catch (_) { /* BPM needs a whole league's lines: a week may not have them; the columns read a dash */ }
  return { players, teams };
}
/* one player's line in one game as a site row: every column of the catalogue for that night */
function gameRow(lines, gameId, name, teamIdx) {
  const g = lines.games.find(x => x.id === gameId);
  if (!g) return null;
  const only = new Set([gameId]);
  const pgs = lines.pgs.filter(r => r.game_id === gameId && r.team_idx === teamIdx && ((r.stats && r.stats.adv && r.stats.adv.name) || '') === name);
  if (!pgs.length) return null;
  const rows = rowsOf({ games: lines.games, pgs: pgs.concat(lines.pgs.filter(r => r.game_id === gameId && !pgs.includes(r))), tgs: lines.tgs, teamName: lines.teamName, meta: lines.meta }, only).players;
  const id = pgs[0].player_uuid || pgs[0].player_id;
  return rows.find(r => r.id === id) || null;
}

/* ---------------------------------------------------------------- ranking --- */
/* Rank rows by one column. Rows with no value, or under the games minimum, are out. `low` puts the smallest first. Ties share
   a rank (1, 2, 2, 4) and are flagged, and ties are broken for order only by games played, then name, so the same data
   always lists the same way. Returns [{ rank, tie, row, value }] (all of them: the caller takes the top of it). */
function rank(rows, c, o) {
  const opt = o || {}, low = opt.low != null ? !!opt.low : isLow(c);
  const min = +opt.minGames || 0;
  const list = rows.map(r => ({ row: r, value: value(c, r) })).filter(x => x.value != null && (x.row.gp == null || x.row.gp >= min));
  list.sort((a, b) => (low ? a.value - b.value : b.value - a.value) || (b.row.gp || 0) - (a.row.gp || 0) || String(a.row.name || '').localeCompare(String(b.row.name || '')));
  let last = null, at = 0;
  list.forEach((x, i) => { if (last === null || x.value !== last) { at = i + 1; last = x.value; } x.rank = at; });
  list.forEach(x => { x.tie = list.filter(y => y.rank === x.rank).length > 1; });
  return list;
}

return { catalogue, byId, grouped, search, explain, isLow, value, text, available, rowsOf, gameRow, rank, isPremium, GROUP_LABELS, PREMIUM_PREFIXES, PREMIUM_COLUMNS };
}));
