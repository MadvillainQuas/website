'use strict';
/* ============================================================================
   GLOBAL SCOUTING · IMPORTS - a scout's own files, as one table to sort and filter.
                                                                   window.EpinoiaScoutImports

   WHO. A scout or a platform administrator (0210 scout_access). Nobody else is shown the tab:
   the page asks the database once, with the reader's own token, after the page has drawn, and
   only when somebody is signed in.

   WHAT. The files the scouting extension saves, fa_results_<date>.csv: one row a player on a
   team's roster -

     country, league_tab, team, player, url, height_cm, pos, born, eb_height_cm, eb_weight_kg,
     agent, last_season, _json

   - _json holding all of it again, with the player's last-season lines (each a season, team,
   league, games and the per-game numbers: MPG PPG RPG APG SPG BPG TPG 2P% 3P%). The table is
   built from _json where it is there and from the columns where it is not, and its stat
   columns are whichever stats the files carry, so a stat the extension adds later is a column
   without a change here.

   AS THE EXTENSION WRITES THEM, TIDIED:
     a position with the birth year run into it ("G2000", Australia's rosters): a guard born 2000
     a height only on the Eurobasket profile (eb_height_cm): the height
     seasons written "25-26" and "2026": their end year (2026) says which is the latest
     two lines in the latest season (a player who moved): the one with the most games is his
       line in the table, and every line opens under his row; a season only just begun (under
       MIN_G games) gives way to the full one before it (mainLine)

   SEVERAL FILES ARE ONE TABLE. A player in two of them (the same profile link) is there once,
   from the file loaded last. Each file has a chip, to take it out.

   NOTHING LEAVES THE BROWSER. The files are read here and kept on this device (IndexedDB,
   'epinoia-scout-imports'), so they are back the next time the tab is opened, until they are
   taken out. Nothing is sent to Epinoia. The view (filters, sort) is remembered on the device
   too (localStorage), as a convenience.

   THE TABLE is table.ft, the scouting table's own look (kit/table.css): a header sorts, again
   for the other way; the player stays put while the numbers scroll; each stat is shaded by
   where it ranks among every player loaded; 100 rows at a time, "Show more" for the next.
   Filters: words in the name, team, agent, country or league; the country and the league;
   guards / forwards / centres; born, height and weight from-to; with an agent or without; this
   season's numbers only (latestOf); any stat at least or at most a value. What is shown downloads
   as a CSV.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaScoutImports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const PAGE = 100;                                   // rows drawn at a time
const MIN_G = 5;                                    // games: a season's line, and the pool a stat is ranked in
const STORE = 'epinoia-scout-imports';              // IndexedDB: the files
const VIEW_KEY = 'epinoia.scout.imports.view';      // localStorage: filters and sort
const LOW = /^(TPG|TOPG|TO|TOV|TOV%|PF|PFPG)$/i;    // a stat where less is better

/* ---------------------------------------------------------------- reading --- */
/* RFC 4180: a field in quotes may hold the delimiter, line breaks and "" for a quote; a
   byte-order mark first is dropped. The delimiter is the first line's commonest of , ; and tab
   (a file saved again by a spreadsheet in some countries uses ;). */
function delimiterOf(s) {
  const nl = s.search(/\r|\n/);
  const first = (nl < 0 ? s : s.slice(0, nl)).replace(/"[^"]*"/g, '');
  const n = c => first.split(c).length - 1;
  const best = [[',', n(',')], [';', n(';')], ['\t', n('\t')]].sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : ',';
}
function parseCsv(text) {
  const s = String(text == null ? '' : text).replace(/^﻿/, '');
  const D = delimiterOf(s).charCodeAt(0);
  const rows = [];
  let row = [], f = '', i = 0, quoted = false;
  const n = s.length;
  while (i < n) {
    if (quoted) {
      const j = s.indexOf('"', i);
      if (j < 0) { f += s.slice(i); i = n; break; }
      f += s.slice(i, j);
      if (s.charCodeAt(j + 1) === 34) { f += '"'; i = j + 2; continue; }
      quoted = false; i = j + 1; continue;
    }
    const c = s.charCodeAt(i);
    if (c === 34) { quoted = true; i++; continue; }
    if (c === D) { row.push(f); f = ''; i++; continue; }
    if (c === 10 || c === 13) {
      row.push(f); f = ''; rows.push(row); row = [];
      i += (c === 13 && s.charCodeAt(i + 1) === 10) ? 2 : 1;
      continue;
    }
    let j = i;
    while (j < n) { const d = s.charCodeAt(j); if (d === D || d === 10 || d === 13 || d === 34) break; j++; }
    f += s.slice(i, j); i = j;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

const num = v => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[%\s]/g, '').replace(/,(?=\d+$)/, '.'));
  return isFinite(x) ? x : null;
};
const yearOf = v => { const m = /(?:^|\D)(19[3-9]\d|20[0-4]\d)(?:\D|$)/.exec(String(v == null ? '' : v)); return m ? +m[1] : null; };
const httpOk = u => (/^https?:\/\/[^\s<>"]+$/i.test(String(u || '').trim()) ? String(u).trim() : null);
const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/* the season a line belongs to, as the year it ends: "25-26" 2026, "2026" 2026, "1998-99" 1999 */
function endYearOf(season) {
  const s = clean(season);
  let m = /^(\d{2}|\d{4})\s*[-/]\s*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    if (m[2].length === 4) return +m[2];
    const yy = +m[2];
    const century = m[1].length === 4 ? Math.floor(+m[1] / 100) * 100 + (yy < +m[1] % 100 ? 100 : 0) : (yy < 50 ? 2000 : 1900);
    return century + yy;
  }
  m = /^(\d{4})$/.exec(s);
  return m ? +m[1] : null;
}

/* a position as the rosters print it, and the birth year some run into it ("G2000") */
function cleanPos(pos, born) {
  let p = clean(pos).toUpperCase(), b = born || null;
  const m = /^([A-Z][A-Z/ -]*?)\s*-?\s*(19[3-9]\d|20[0-4]\d)$/.exec(p);
  if (m) { p = m[1].replace(/[\s/-]+$/, ''); if (!b) b = +m[2]; }
  if (/^\d{4}$/.test(p)) { if (!b) b = +p; p = ''; }
  return { pos: p, born: b };
}
/* what a position counts as: G (PG, SG, G), F (SF, PF, F, W), C; G/F is both */
function groupsOf(pos) {
  const g = new Set();
  String(pos || '').toUpperCase().split(/[^A-Z]+/).forEach(t => {
    if (!t) return;
    if (/^(PG|SG|G|GUARD|POINT|COMBO)$/.test(t)) g.add('G');
    else if (/^(SF|PF|F|W|WING|FORWARD)$/.test(t)) g.add('F');
    else if (/^(C|CENTER|CENTRE)$/.test(t)) g.add('C');
    else if (t === 'GF') { g.add('G'); g.add('F'); }
    else if (t === 'FC') { g.add('F'); g.add('C'); }
  });
  return ['G', 'F', 'C'].filter(x => g.has(x)).join('');
}

/* one line of the last season(s), from _json (last.rows[]) */
function lineOf(x) {
  const stats = {};
  Object.keys((x && x.stats) || {}).forEach(k => { const v = num(x.stats[k]); if (v != null) stats[clean(k).toUpperCase()] = v; });
  return { season: clean(x && x.season), end: num(x && x.endYear) || endYearOf(x && x.season),
           team: clean(x && x.team), league: clean(x && x.league), g: num(x && x.g), stats, masked: !!(x && x.masked) };
}
/* the same, from the last_season column alone: "25-26 Argentino Junin (ARG-1); 25-26 Argentino (ARG-4)" */
function linesFromText(t) {
  return clean(t).split(/\s*;\s*/).filter(Boolean).map(part => {
    const m = /^(\d{2,4}(?:\s*[-/]\s*\d{2,4})?)\s+(.*?)(?:\s*\(([^()]+)\))?$/.exec(part);
    return m ? { season: m[1], end: endYearOf(m[1]), team: clean(m[2]), league: clean(m[3]), g: null, stats: {}, masked: false }
             : { season: '', end: null, team: part, league: '', g: null, stats: {}, masked: false };
  });
}
/* HIS LINE IN THE TABLE: the latest season's, the one with the most games. A season only just begun (fewer than
   MIN_G games, the first few of next season) gives way to the one before it when that one is a real season: two
   games in September are not what a scout reads him by. Every line still opens under his row. */
function mainLine(lines) {
  const list = (lines || []).filter(Boolean);
  if (!list.length) return null;
  const most = xs => xs.reduce((b, l) => (!b || (l.g || 0) > (b.g || 0) ? l : b), null);
  const ends = [...new Set(list.map(l => l.end || 0))].sort((a, b) => b - a);
  const first = most(list.filter(l => (l.end || 0) === ends[0]));
  if (ends.length > 1 && (first.g || 0) < MIN_G) {
    const prev = most(list.filter(l => (l.end || 0) === ends[1]));
    if ((prev.g || 0) >= MIN_G) return prev;
  }
  return first;
}

const COLUMN_NAMES = ['country', 'league_tab', 'team', 'player', 'url', 'height_cm', 'pos', 'born', 'eb_height_cm', 'eb_weight_kg', 'agent', 'last_season', '_json'];
/* is this one of the extension's files? the columns it must have */
function looksLikeResults(head) {
  const h = head.map(x => clean(x).toLowerCase());
  return (h.includes('player') || h.includes('name')) && h.includes('team') && h.includes('country');
}

/* ONE FILE: its players, tidied. Throws a sentence when it is not one of the extension's files. */
function readFile(text, opts) {
  const o = opts || {};
  const now = o.year || new Date().getFullYear();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('That file is empty.');
  const head = rows[0].map(x => clean(x).toLowerCase());
  if (!looksLikeResults(head)) {
    throw new Error('That is not a file from the scouting extension: it has no player, team and country columns.');
  }
  const at = {};
  head.forEach((k, i) => { if (!(k in at)) at[k] = i; });
  const col = (r, k) => (k in at ? r[at[k]] : '');
  const players = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    let j = null;
    const raw = col(r, '_json');
    if (raw && raw.trim().charAt(0) === '{') { try { j = JSON.parse(raw); } catch (_) { j = null; } }
    const pick = (jk, ck) => { const a = j && j[jk]; return a != null && a !== '' ? a : col(r, ck); };
    const name = clean(pick('name', 'player') || col(r, 'name'));
    if (!name) { skipped++; continue; }
    const tidy = cleanPos(pick('pos', 'pos'), yearOf(j && (j.bornYear || j.born)) || yearOf(col(r, 'born')));
    const ht = num(col(r, 'height_cm')) || num(j && j.heightCm) || num(col(r, 'eb_height_cm')) || num(j && j.cm);
    const wt = num(j && j.weightKg) || num(col(r, 'eb_weight_kg'));
    const ag = j && j.agent && typeof j.agent === 'object' ? j.agent : null;
    const agent = clean((ag && ag.name) || col(r, 'agent')) || null;
    const lines = j && j.last && Array.isArray(j.last.rows) ? j.last.rows.map(lineOf) : linesFromText(col(r, 'last_season'));
    const main = mainLine(lines);
    const url = httpOk(pick('url', 'url'));
    const country = clean(pick('country', 'country')), league = clean(pick('tab', 'league_tab')), team = clean(pick('team', 'team'));
    players.push({
      id: (url || [country, team, name].join('|')).toLowerCase(),
      name, url, country, league, team,
      pos: tidy.pos, groups: groupsOf(tidy.pos), born: tidy.born, age: tidy.born ? now - tidy.born : null,
      ht: ht ? Math.round(ht) : null, htFt: clean(j && j.heightFt) || null, wt: wt ? Math.round(wt) : null,
      agent, agentUrl: httpOk(ag && ag.url),
      needsLogin: !!(j && j.needsLogin), via: (j && j.last && j.last.via) || null,
      lines, main, others: main ? lines.filter(l => l !== main && l.end === main.end).length : 0,
      file: o.file || null, order: i - 1, key: (o.file || 'file') + ':' + (i - 1)
    });
  }
  return { players, skipped };
}

/* SEVERAL FILES, ONE TABLE: a player in two files (the same profile link) is there from the file loaded last only.
   Within one file every row stays: a player on two rosters (his league's and a European cup's) is on both. */
function merge(files) {
  const by = new Map();
  let dupes = 0;
  (files || []).slice().sort((a, b) => (a.added || 0) - (b.added || 0)).forEach(f => {
    const mine = new Map();
    (f.players || []).forEach(p => { if (!mine.has(p.id)) mine.set(p.id, []); mine.get(p.id).push(p); });
    mine.forEach((list, id) => { if (by.has(id)) dupes++; by.delete(id); by.set(id, list); });
  });
  const players = [];
  by.forEach(list => list.forEach(p => players.push(p)));
  return { players, dupes };
}

/* the stats the files carry, in the order they first appear */
function statKeys(players) {
  const seen = [];
  const add = k => { if (!seen.includes(k)) seen.push(k); };
  (players || []).forEach(p => (p.lines || []).forEach(l => Object.keys(l.stats || {}).forEach(add)));
  return seen;
}
const statOf = (p, k) => (k === 'G' ? (p.main ? p.main.g : null) : (p.main && p.main.stats[k] != null ? p.main.stats[k] : null));

/* --------------------------------------------------------------- the view --- */
function blankFilter() {
  return { q: '', country: '', league: '', pos: '', bornMin: null, bornMax: null, htMin: null, htMax: null,
           wtMin: null, wtMax: null, unknown: false, agent: '', latest: false, stats: [] };
}
/* THE CURRENT SEASON of the files: the one most players' numbers are from (2026 for "25-26" and "2026"). Not
   simply the newest: a few players already have a line for next season's first games, and "this season only"
   must not mean those five. */
function latestOf(players) {
  const n = new Map();
  (players || []).forEach(p => { const e = p.main && p.main.end; if (e) n.set(e, (n.get(e) || 0) + 1); });
  let best = null, most = 0;
  n.forEach((c, e) => { if (c > most || (c === most && e > best)) { best = e; most = c; } });
  return best;
}
const hayOf = p => p.hay || (p.hay = [p.name, p.team, p.agent, p.country, p.league, p.pos, p.main && p.main.team, p.main && p.main.league]
  .filter(Boolean).join(' ').toLowerCase());

function passes(p, f, latest) {
  if (f.q) {
    const words = String(f.q).toLowerCase().split(/\s+/).filter(Boolean);
    const h = hayOf(p);
    if (!words.every(w => h.indexOf(w) >= 0)) return false;
  }
  if (f.country && p.country !== f.country) return false;
  if (f.league && p.league !== f.league) return false;
  if (f.pos && !f.pos.split('').some(g => p.groups.indexOf(g) >= 0)) return false;
  const range = (v, lo, hi) => {
    if (lo == null && hi == null) return true;
    if (v == null) return !!f.unknown;
    return (lo == null || v >= lo) && (hi == null || v <= hi);
  };
  if (!range(p.born, f.bornMin, f.bornMax) || !range(p.ht, f.htMin, f.htMax) || !range(p.wt, f.wtMin, f.wtMax)) return false;
  if (f.agent === 'yes' && !p.agent) return false;
  if (f.agent === 'no' && p.agent) return false;
  if (f.latest && !(p.main && latest && p.main.end >= latest)) return false;
  for (const s of f.stats || []) {
    if (!s || !s.k || s.v == null || s.v === '' || !isFinite(+s.v)) continue;
    const v = statOf(p, s.k);
    if (v == null) return false;
    if (s.op === '<=' ? v > +s.v : v < +s.v) return false;
  }
  return true;
}
function filter(players, f, latest) {
  const L = latest === undefined ? latestOf(players) : latest;
  return (players || []).filter(p => passes(p, f || blankFilter(), L));
}

/* A SORT: numbers as numbers, words as words; an empty value last whichever way it runs;
   level values in the order of the name */
function sort(players, col, dir) {
  const d = dir < 0 ? -1 : 1;
  const coll = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en', { sensitivity: 'base', numeric: true }) : null;
  const cmpText = (a, b) => (coll ? coll.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0));
  return (players || []).slice().sort((a, b) => {
    const x = col.val(a), y = col.val(b);
    const xe = x == null || x === '', ye = y == null || y === '';
    if (xe || ye) return xe && ye ? cmpText(a.name, b.name) : xe ? 1 : -1;
    const c = col.text ? cmpText(String(x), String(y)) : x - y;
    return c ? c * d : cmpText(a.name, b.name);
  });
}

/* where each value ranks, 0-100 (a stat where less is better, the other way round): the shade under each figure.
   Ranked among the players with MIN_G games or more, when there are 20 of them: a player's one game is not a
   season, and a one-game 80% from two would otherwise set the shade for everybody. Every row is still shaded. */
function percentiles(players, keys) {
  const out = {};
  const real = players.filter(p => (statOf(p, 'G') || 0) >= MIN_G);
  const pool = real.length >= 20 ? real : players;
  keys.forEach(k => {
    const vals = [];
    pool.forEach(p => { const v = statOf(p, k); if (v != null) vals.push(v); });
    vals.sort((a, b) => a - b);
    const n = vals.length;
    out[k] = v => {
      if (v == null || n < 5) return null;
      let lo = 0, hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
      let up = lo;
      while (up < n && vals[up] === v) up++;
      /* a value past everyone ranked (a one-game 99) is the top, not past it */
      const p = Math.max(0, Math.min(100, ((lo + up - 1) / 2) / Math.max(1, n - 1) * 100));
      return LOW.test(k) ? 100 - p : p;
    };
  });
  return out;
}
/* the shade itself: kit/table.css draws --heat as a lozenge in the cell, as fulltable.js's heatStyle chooses it */
function heatOf(p) {
  if (p == null) return '';
  if (p >= 90) return 'color-mix(in oklch,var(--good) 34%,transparent)';
  if (p >= 75) return 'color-mix(in oklch,var(--good) 20%,transparent)';
  if (p >= 60) return 'color-mix(in oklch,var(--good) 10%,transparent)';
  if (p >= 40) return '';
  if (p >= 25) return 'color-mix(in oklch,var(--amber) 12%,transparent)';
  if (p >= 10) return 'color-mix(in oklch,var(--flare) 14%,transparent)';
  return 'color-mix(in oklch,var(--flare) 24%,transparent)';
}

/* THE COLUMNS. The first two stay put (kit/table.css .c0 / .c1). w: px. text: a word column, sorted as words and
   set left. */
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const f0 = v => (v == null ? '—' : String(v));
function columns(keys) {
  const base = [
    { k: 'rank', l: '#', w: 40, val: p => p.order, fmt: (p, i) => String(i + 1), t: 'the order shown' },
    { k: 'name', l: 'PLAYER', w: 190, text: true, val: p => p.name },
    { k: 'pos', l: 'POS', w: 54, text: true, val: p => p.pos, fmt: p => p.pos || '—', t: 'position' },
    { k: 'born', l: 'BORN', w: 54, val: p => p.born, fmt: p => f0(p.born) },
    { k: 'age', l: 'AGE', w: 46, val: p => p.age, fmt: p => f0(p.age), t: 'the age they turn this year' },
    { k: 'ht', l: 'HT', w: 52, val: p => p.ht, fmt: p => f0(p.ht), t: 'height, cm' },
    { k: 'wt', l: 'WT', w: 48, val: p => p.wt, fmt: p => f0(p.wt), t: 'weight, kg' },
    { k: 'country', l: 'COUNTRY', w: 118, text: true, val: p => p.country },
    { k: 'league', l: 'LEAGUE', w: 118, text: true, val: p => p.league, t: 'the league tab the extension read' },
    { k: 'team', l: 'TEAM', w: 170, text: true, val: p => p.team },
    { k: 'agent', l: 'AGENT', w: 180, text: true, val: p => p.agent },
    { k: 'season', l: 'SEASON', w: 66, text: true, val: p => (p.main ? (p.main.end || 0) * 100 + (p.main.g || 0) : null),
      fmt: p => (p.main ? p.main.season || '—' : '—'), sortNum: true, t: 'the season the numbers are from' },
    { k: 'lteam', l: 'PLAYED FOR', w: 160, text: true, val: p => (p.main ? p.main.team : null), t: 'the team the numbers are from' },
    { k: 'lleague', l: 'COMP', w: 84, text: true, val: p => (p.main ? p.main.league : null), t: 'the competition the numbers are from' },
    { k: 'G', l: 'G', w: 42, val: p => statOf(p, 'G'), fmt: p => f0(statOf(p, 'G')), stat: true, t: 'games' }
  ];
  keys.forEach(k => base.push({ k, l: k, w: Math.max(52, 14 + k.length * 8), val: p => statOf(p, k), fmt: p => f1(statOf(p, k)),
    stat: true, heat: true, low: LOW.test(k), t: /%$/.test(k) ? 'a percentage' : LOW.test(k) ? 'per game — lower is better' : 'per game' }));
  base.forEach(c => { if (c.sortNum) c.text = false; });
  return base;
}

/* WHAT IS SHOWN, AS A CSV: the table's columns but the place, in its order, the values as they are. Words that a
   spreadsheet would run as a formula (a name read off a web page that begins = + - or @) are set down as text, with an
   apostrophe first; numbers and seasons ("25-26") are left alone. */
function toCsv(players, cols) {
  const use = cols.filter(c => c.k !== 'rank');
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const value = (c, p) => (c.k === 'season' ? (p.main ? p.main.season : '') : c.val(p));
  const lines = [use.map(c => c.l).concat(['PROFILE', 'AGENT PAGE']).map(cell).join(',')];
  players.forEach(p => lines.push(use.map(c => cell(value(c, p))).concat([cell(p.url || ''), cell(p.agentUrl || '')]).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* a file's own id: its text, hashed (the same file loaded twice is one file) */
function idOf(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'f' + h.toString(36) + '-' + s.length.toString(36);
}

/* ------------------------------------------------------------ the device --- */
/* The files, kept on this device: IndexedDB, one record a file {id, name, added, text}. Anything it cannot
   do (a private window, storage switched off) leaves the tab working for this visit only. */
function deviceStore() {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try {
      if (!root.indexedDB) throw new Error('no IndexedDB');
      const rq = root.indexedDB.open(STORE, 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('files')) rq.result.createObjectStore('files', { keyPath: 'id' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error('IndexedDB refused'));
    } catch (e) { rej(e); }
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('files', mode);
    const rq = fn(t.objectStore('files'));
    t.oncomplete = () => res(rq ? rq.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
  return {
    all: () => run('readonly', st => st.getAll()).then(x => x || []),
    put: rec => run('readwrite', st => st.put(rec)),
    del: id => run('readwrite', st => st.delete(id)),
    clear: () => run('readwrite', st => st.clear())
  };
}
function readView() {
  try { const v = JSON.parse(root.localStorage.getItem(VIEW_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
}
function saveView(v) { try { root.localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch (_) { /* a convenience only */ } }

/* ------------------------------------------------------------- the tab --- */
const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const fmtN = n => Number(n || 0).toLocaleString('en-GB');
const when = ms => { try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };

function mount(o) {
  const host = o.host;
  if (!host) return null;
  const store = o.store || deviceStore();
  const say = o.say || (() => {});
  const year = o.year || new Date().getFullYear();
  let files = [];                                    // [{ id, name, added, text, players, skipped }]
  let players = [], keys = [], cols = [], ranks = {}, latest = null, dupes = 0;
  const kept = readView() || {};
  let f = Object.assign(blankFilter(), kept.f || {});
  let sortKey = kept.sort || 'PPG', sortDir = kept.dir === 1 ? 1 : -1;
  let shown = PAGE;
  const open = new Set();                            // the rows whose lines are open (their keys)

  host.textContent = '';
  const wrap = el('div', 'ix');
  wrap.setAttribute('data-i18n-ctx', 'imports');

  /* ---- the files ---- */
  const drop = el('label', 'ix-drop');
  const pickIn = el('input'); pickIn.type = 'file'; pickIn.accept = '.csv,text/csv'; pickIn.multiple = true; pickIn.className = 'ix-file';
  pickIn.setAttribute('aria-label', 'choose files from the scouting extension');
  const dropT = el('span', 'ix-drop-t', 'Drop the extension’s files here, or choose them');
  const dropS = el('span', 'ix-drop-s', 'fa_results CSVs, as many as you like. They are read and kept on this device: nothing is sent');
  drop.append(pickIn, dropT, dropS);
  const chips = el('div', 'ix-files');
  const filesNote = el('p', 'ix-note');

  /* ---- the filters ---- */
  const bar = el('div', 'ft-bar ix-bar');
  const q = el('input', 'ep-input grow ix-q'); q.type = 'search'; q.placeholder = 'player, team, agent, league…'; q.setAttribute('aria-label', 'find a player, team, agent or league');
  const cSel = el('select', 'ep-input ft-sel ix-country'); cSel.setAttribute('aria-label', 'country');
  const lSel = el('select', 'ep-input ft-sel ix-league'); lSel.setAttribute('aria-label', 'league');
  const posBox = el('span', 'ix-pos'); posBox.setAttribute('role', 'group'); posBox.setAttribute('aria-label', 'positions');
  const POS = [['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centres']];
  const posBtns = POS.map(([g, t]) => { const b = el('button', 'ft-pill', t); b.type = 'button'; b.dataset.g = g; posBox.appendChild(b); return b; });
  const aSel = el('select', 'ep-input ft-sel ix-agent'); aSel.setAttribute('aria-label', 'agent');
  [['', 'agent or not'], ['yes', 'with an agent'], ['no', 'without an agent']].forEach(([v, t]) => { const op = el('option', null, t); op.value = v; aSel.appendChild(op); });
  bar.append(q, cSel, lSel, posBox, aSel);

  const moreF = el('button', 'ep-btn ft-btn ix-morefilters', 'more filters'); moreF.type = 'button';
  moreF.setAttribute('aria-expanded', 'false');
  bar.appendChild(moreF);
  const bar2 = el('div', 'ft-bar ix-bar ix-ranges');
  const range = (label, unit, lo, hi, min, max) => {
    const box = el('span', 'ft-field ix-range');
    const a = el('input', 'ep-input ft-num'); a.type = 'number'; a.inputMode = 'numeric'; a.min = min; a.max = max; a.placeholder = 'min';
    const b = el('input', 'ep-input ft-num'); b.type = 'number'; b.inputMode = 'numeric'; b.min = min; b.max = max; b.placeholder = 'max';
    a.setAttribute('aria-label', label + ' from'); b.setAttribute('aria-label', label + ' to');
    box.append(el('span', 'ft-count', label), a, el('span', 'ix-to', '–'), b);
    if (unit) box.appendChild(el('span', 'ft-count', unit));
    a.dataset.k = lo; b.dataset.k = hi;
    return box;
  };
  const born = range('Born', '', 'bornMin', 'bornMax', 1950, 2015);
  const ht = range('Height', 'cm', 'htMin', 'htMax', 150, 235);
  const wt = range('Weight', 'kg', 'wtMin', 'wtMax', 45, 160);
  const unkL = el('label', 'ix-check');
  const unk = el('input'); unk.type = 'checkbox';
  unkL.append(unk, el('span', null, 'keep players with no record of it'));
  const latL = el('label', 'ix-check');
  const lat = el('input'); lat.type = 'checkbox';
  const latT = el('span', null, 'this season’s numbers only');
  latL.append(lat, latT);
  bar2.append(born, ht, wt, unkL, latL);

  const bar3 = el('div', 'ft-bar ix-bar ix-stats');
  const statLines = el('span', 'ix-flines');
  const addStat = el('button', 'ep-btn ft-btn', '+ a stat filter'); addStat.type = 'button';
  bar3.append(statLines, addStat);

  const tally = el('div', 'ix-tally');
  const count = el('span', 'ft-count ix-count');
  const reset = el('button', 'ep-btn ft-btn', 'reset the filters'); reset.type = 'button';
  const dl = el('button', 'ep-btn ft-btn', 'download these as a CSV'); dl.type = 'button';
  tally.append(count, reset, dl);

  const tableHost = el('div', 'ft-wrap ix-wrap');
  const more = el('button', 'ep-btn ft-morerows', ''); more.type = 'button';
  const empty = el('div', 'pg-empty ix-empty', 'No files yet. Drop the extension’s fa_results files above, and their players are a table here to sort and filter.');

  wrap.append(drop, chips, filesNote, empty, bar, bar2, bar3, tally, tableHost, more);
  host.appendChild(wrap);
  const working = [bar, tally, tableHost];
  /* THE LESS-USED FILTERS (ranges, this season, stats) wait behind "more filters", which says how many are set; they
     are open whenever one of them is */
  let moreOpen = false;
  const extraSet = () => ['bornMin', 'bornMax', 'htMin', 'htMax', 'wtMin', 'wtMax'].filter(k => f[k] != null).length +
    (f.latest ? 1 : 0) + (f.stats || []).filter(x => x && x.v != null && x.v !== '').length;
  const drawMore = () => {
    const n = extraSet(), on = !!players.length && (moreOpen || n > 0);
    bar2.hidden = bar3.hidden = !on;
    moreF.textContent = (on ? 'fewer filters' : 'more filters') + (n ? ' (' + n + ')' : '');
    moreF.setAttribute('aria-expanded', String(on));
    moreF.disabled = on && n > 0;
    moreF.title = on && n > 0 ? 'clear these filters to fold them away' : '';
  };
  moreF.addEventListener('click', () => { moreOpen = !moreOpen; drawMore(); });

  /* ---- reading files ---- */
  const own = (list, id) => list.map(p => Object.assign(p, { file: id, key: id + ':' + p.order }));
  async function take(list) {
    const arr = Array.prototype.slice.call(list || []).filter(x => x && (/\.csv$/i.test(x.name || '') || /csv|text\/plain/i.test(x.type || '')));
    if (!arr.length) return say('Those are not CSV files: the extension saves fa_results_<date>.csv.', 'err');
    let added = 0;
    for (const file of arr) {
      let text;
      try { text = typeof file.text === 'function' ? await file.text() : await new Promise((res, rej) => { const r = new root.FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); }); }
      catch (e) { say('Could not read ' + file.name + '.', 'err'); continue; }
      let got;
      try { got = readFile(text, { year }); }
      catch (e) { say(file.name + ': ' + (e.message || e), 'err'); continue; }
      const rec = { id: idOf(text), name: file.name || 'file.csv', added: Date.now(), text };
      files = files.filter(x => x.id !== rec.id).concat([Object.assign({}, rec, got, { players: own(got.players, rec.id) })]);
      added += got.players.length;
      try { await store.put(rec); } catch (_) { filesNote.textContent = 'This browser is not keeping files (a private window?): they are here for this visit only.'; }
    }
    if (added) say(fmtN(added) + ' players read.', 'ok');
    rebuild();
  }
  pickIn.addEventListener('change', () => { take(pickIn.files); pickIn.value = ''; });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('on')));
  drop.addEventListener('drop', e => { e.preventDefault(); take(e.dataTransfer && e.dataTransfer.files); });

  function drawFiles() {
    chips.textContent = '';
    files.slice().sort((a, b) => a.added - b.added).forEach(x => {
      const c = el('span', 'ix-chip');
      const nm = el('b', null, x.name); nm.setAttribute('translate', 'no');
      c.appendChild(nm);
      c.appendChild(el('span', null, fmtN(x.players.length) + ' players · ' + when(x.added)));
      const off = el('button', 'ix-x', '×'); off.type = 'button';
      off.title = 'take ' + x.name + ' out'; off.setAttribute('aria-label', off.title);
      off.addEventListener('click', async () => {
        files = files.filter(y => y.id !== x.id);
        try { await store.del(x.id); } catch (_) { /* this visit only, then */ }
        rebuild();
      });
      c.appendChild(off);
      chips.appendChild(c);
    });
    if (files.length > 1) {
      const all = el('button', 'ep-btn ft-btn ix-clear', 'take them all out'); all.type = 'button';
      all.addEventListener('click', async () => {
        if (!root.confirm('Take every file out of this table? They are removed from this device too.')) return;
        files = [];
        try { await store.clear(); } catch (_) { /* nothing kept */ }
        rebuild();
      });
      chips.appendChild(all);
    }
    filesNote.textContent = dupes ? fmtN(dupes) + ' players were in more than one file: each is here from the file loaded last.' : '';
  }

  /* ---- the filters' controls, from the files ---- */
  function options(sel, values, allText, cur) {
    sel.textContent = '';
    const first = el('option', null, allText); first.value = ''; sel.appendChild(first);
    values.forEach(([v, n]) => { const op = el('option', null, v + ' (' + n + ')'); op.value = v; op.setAttribute('translate', 'no'); sel.appendChild(op); });
    sel.value = values.some(x => x[0] === cur) ? cur : '';
    return sel.value;
  }
  const tallyOf = (list, key) => {
    const m = new Map();
    list.forEach(p => { const v = p[key]; if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  function drawControls() {
    q.value = f.q || '';
    f.country = options(cSel, tallyOf(players, 'country'), 'every country', f.country);
    f.league = options(lSel, tallyOf(f.country ? players.filter(p => p.country === f.country) : players, 'league'), 'every league', f.league);
    posBtns.forEach(b => { const on = (f.pos || '').indexOf(b.dataset.g) >= 0; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    aSel.value = f.agent || '';
    [born, ht, wt].forEach(box => box.querySelectorAll('input').forEach(i => { i.value = f[i.dataset.k] == null ? '' : f[i.dataset.k]; }));
    unk.checked = !!f.unknown;
    lat.checked = !!f.latest;
    latT.textContent = latest ? 'this season’s numbers only (' + latest + ')' : 'this season’s numbers only';
    drawStatLines();
  }
  function drawStatLines() {
    statLines.textContent = '';
    (f.stats || []).forEach((s, i) => {
      const line = el('span', 'ft-field ix-fline');
      const k = el('select', 'ep-input ft-sel'); k.setAttribute('aria-label', 'stat');
      ['G'].concat(keys).forEach(x => { const op = el('option', null, x); op.value = x; k.appendChild(op); });
      k.value = s.k || keys[0] || 'G';
      s.k = k.value;
      const op = el('select', 'ep-input ft-sel'); op.setAttribute('aria-label', 'at least or at most');
      [['>=', 'at least'], ['<=', 'at most']].forEach(([v, t]) => { const x = el('option', null, t); x.value = v; op.appendChild(x); });
      op.value = s.op === '<=' ? '<=' : '>=';
      const v = el('input', 'ep-input ft-num'); v.type = 'number'; v.step = 'any'; v.value = s.v == null ? '' : s.v; v.setAttribute('aria-label', 'value');
      const x = el('button', 'ix-x', '×'); x.type = 'button'; x.title = 'take this filter off'; x.setAttribute('aria-label', x.title);
      k.addEventListener('change', () => { s.k = k.value; changed(); });
      op.addEventListener('change', () => { s.op = op.value; changed(); });
      v.addEventListener('input', () => { s.v = v.value === '' ? null : +v.value; changed(); });
      x.addEventListener('click', () => { f.stats.splice(i, 1); drawStatLines(); changed(); });
      line.append(k, op, v, x);
      statLines.appendChild(line);
    });
    addStat.hidden = (f.stats || []).length >= 6;
  }
  addStat.addEventListener('click', () => { f.stats = (f.stats || []).concat([{ k: keys.includes('PPG') ? 'PPG' : keys[0] || 'G', op: '>=', v: null }]); drawStatLines(); });

  let typing = 0;
  q.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { f.q = q.value.trim(); changed(); }, 160); });
  cSel.addEventListener('change', () => { f.country = cSel.value; f.league = ''; drawControls(); changed(); });
  lSel.addEventListener('change', () => { f.league = lSel.value; changed(); });
  posBtns.forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.g, cur = f.pos || '';
    f.pos = cur.indexOf(g) >= 0 ? cur.replace(g, '') : cur + g;
    drawControls(); changed();
  }));
  aSel.addEventListener('change', () => { f.agent = aSel.value; changed(); });
  [born, ht, wt].forEach(box => box.querySelectorAll('input').forEach(i => i.addEventListener('input', () => {
    f[i.dataset.k] = i.value === '' || !isFinite(+i.value) ? null : +i.value; changed();
  })));
  unk.addEventListener('change', () => { f.unknown = unk.checked; changed(); });
  lat.addEventListener('change', () => { f.latest = lat.checked; changed(); });
  reset.addEventListener('click', () => { f = blankFilter(); drawControls(); changed(); });

  /* ---- the table ---- */
  let view = [];
  function changed() { shown = PAGE; saveView({ f, sort: sortKey, dir: sortDir }); drawMore(); draw(); }
  function rebuild() {
    const m = merge(files);
    players = m.players; dupes = m.dupes;
    keys = statKeys(players);
    cols = columns(keys);
    latest = latestOf(players);
    ranks = percentiles(players, keys);
    if (players.length && !cols.some(c => c.k === sortKey)) { sortKey = keys.includes('PPG') ? 'PPG' : 'name'; sortDir = sortKey === 'name' ? 1 : -1; }
    drawFiles();
    const none = !players.length;
    empty.hidden = !none;
    drop.classList.toggle('small', !none);
    dropT.textContent = none ? 'Drop the extension’s files here, or choose them' : '+ add more files';
    working.forEach(n => { n.hidden = none; });
    more.hidden = true;
    drawMore();
    if (none) { tableHost.textContent = ''; return; }
    drawControls();
    draw();
  }
  function draw() {
    const col = cols.find(c => c.k === sortKey) || cols[1];
    view = sort(filter(players, f, latest), col, sortDir);
    count.textContent = fmtN(view.length) + ' of ' + fmtN(players.length) + ' players';
    dl.disabled = !view.length;
    tableHost.textContent = '';
    if (!view.length) {
      tableHost.appendChild(el('div', 'ft-empty', 'Nobody in the files matches all of these filters.'));
      more.hidden = true;
      return;
    }
    const t = el('table', 'ft ix-t');
    t.style.width = cols.reduce((n, c) => n + c.w, 0) + 'px';
    const thead = el('thead'), hr = el('tr');
    cols.forEach((c, i) => {
      const th = el('th', (c.k === sortKey ? 'sorted ' + (sortDir > 0 ? 'asc' : 'desc') : '') + (i < 2 ? ' stick c' + i : '') + (c.text ? ' ix-tx' : ''), c.l);
      th.style.width = c.w + 'px';
      if (c.t) th.title = c.t;
      th.tabIndex = 0;
      th.setAttribute('scope', 'col');
      if (c.k === sortKey) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
      const go = () => {
        if (sortKey === c.k) sortDir = -sortDir;
        else { sortKey = c.k; sortDir = c.text || c.k === 'rank' || c.low ? 1 : -1; }
        changed();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tb = el('tbody');
    tb.setAttribute('translate', 'no');               // names, teams, leagues, agents: data, never words to translate
    view.slice(0, shown).forEach((p, i) => {
      const tr = el('tr');
      cols.forEach((c, ci) => {
        const td = el('td', (ci < 2 ? 'stick c' + ci : '') + (c.text ? ' ix-tx' : ''));
        if (c.k === 'name') {
          const box = el('span', 'ft-name ix-name');
          const on = open.has(p.key);
          const tg = el('button', 'ix-open', on ? '▾' : '▸'); tg.type = 'button';
          tg.setAttribute('aria-expanded', String(on));
          tg.setAttribute('aria-label', (on ? 'close ' : 'open ') + p.name + '’s lines');
          tg.addEventListener('click', () => { if (open.has(p.key)) open.delete(p.key); else open.add(p.key); draw(); });
          let nm;
          if (p.url) { nm = el('a', null, p.name); nm.href = p.url; nm.target = '_blank'; nm.rel = 'noopener noreferrer'; nm.title = 'their profile, in a new tab'; }
          else nm = el('span', null, p.name);
          box.append(tg, nm);
          if (p.others) { const m = el('span', 'ix-more', '+' + p.others); m.title = 'another line this season: open the row'; box.appendChild(m); }
          td.appendChild(box);
        } else if (c.k === 'agent' && p.agent && p.agentUrl) {
          const a = el('a', 'ix-ag', p.agent); a.href = p.agentUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
          td.appendChild(a);
        } else {
          td.textContent = c.fmt ? c.fmt(p, i) : (c.val(p) == null || c.val(p) === '' ? '—' : String(c.val(p)));
          if (c.k === 'ht' && p.htFt) td.title = p.htFt;
          if (c.heat) {
            const hs = heatOf(ranks[c.k] ? ranks[c.k](c.val(p)) : null);
            if (hs) { td.classList.add('heat'); td.style.setProperty('--heat', hs); }
          }
          if (c.text && td.textContent !== '—') td.title = td.title || td.textContent;
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
      if (open.has(p.key)) tb.appendChild(detail(p));
    });
    t.append(thead, tb);
    tableHost.appendChild(t);
    const left = view.length - shown;
    more.hidden = left <= 0;
    more.textContent = 'Show more (' + fmtN(Math.min(PAGE, Math.max(0, left))) + ' of ' + fmtN(Math.max(0, left)) + ')';
  }
  more.addEventListener('click', () => { shown += PAGE; draw(); });

  /* a player's lines, opened under his row: every season and team the file has, and the links */
  function detail(p) {
    const tr = el('tr', 'ix-sub');
    const td = el('td'); td.colSpan = cols.length;
    const box = el('div', 'ix-lines');
    if (p.lines.length) {
      const t = el('table', 'ix-mini');
      const h = el('tr');
      ['SEASON', 'TEAM', 'COMP', 'G'].concat(keys).forEach(x => h.appendChild(el('th', null, x)));
      const hd = el('thead'); hd.appendChild(h); t.appendChild(hd);
      const b = el('tbody');
      b.setAttribute('translate', 'no');
      p.lines.slice().sort((a, c) => (c.end || 0) - (a.end || 0) || (c.g || 0) - (a.g || 0)).forEach(l => {
        const r = el('tr', l === p.main ? 'on' : null);
        [l.season || '—', l.team || '—', l.league || '—', f0(l.g)].concat(keys.map(k => f1(l.stats[k]))).forEach((x, i) => r.appendChild(el('td', i < 3 ? 'ix-tx' : null, x)));
        b.appendChild(r);
      });
      t.appendChild(b);
      box.appendChild(t);
    } else {
      box.appendChild(el('p', 'ix-note', p.needsLogin ? 'No numbers: the profile needs a login to show them.' : 'No numbers in the file for this player.'));
    }
    const links = el('p', 'ix-links');
    if (p.url) { const a = el('a', null, 'profile ↗'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.appendChild(a); }
    if (p.agentUrl) { const a = el('a', null, 'agent ↗'); a.href = p.agentUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.appendChild(a); }
    if (p.htFt) { const x = el('span', null, p.htFt); x.setAttribute('translate', 'no'); links.appendChild(x); }
    if (p.wt) { const x = el('span', null, p.wt + ' kg'); x.setAttribute('translate', 'no'); links.appendChild(x); }
    if (p.needsLogin && p.lines.length) links.appendChild(el('span', null, 'the profile needs a login for more'));
    box.appendChild(links);
    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  dl.addEventListener('click', () => {
    if (!view.length) return;
    const body = toCsv(view, cols);
    const url = root.URL.createObjectURL(new root.Blob([body], { type: 'text/csv;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = 'epinoia-imports-' + new Date().toISOString().slice(0, 10) + '.csv';
    root.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => root.URL.revokeObjectURL(url), 4000);
  });

  /* what this device kept from last time */
  rebuild();
  store.all().then(recs => {
    (recs || []).forEach(rec => {
      try {
        const got = readFile(rec.text, { year });
        files = files.filter(x => x.id !== rec.id).concat([Object.assign({}, rec, got, { players: own(got.players, rec.id) })]);
      } catch (_) { /* a file this version cannot read: left out */ }
    });
    rebuild();
  }, () => { filesNote.textContent = 'This browser is not keeping files (a private window?): they are here for this visit only.'; });

  return { take, files: () => files.slice(), view: () => view.slice(), filter: () => f, rebuild };
}

/* ------------------------------------------------------------ the page --- */
/* THE TAB, on global scouting: asked of the database (scout_access) once somebody is signed in. Leagues is the page
   as it was; Imports hides its sections and shows this one. #imports in the address opens on it. */
async function access() {
  const A = root.EpinoiaAccess, C = root.EPINOIA_CONFIG || {};
  let s = null;
  try { s = A && typeof A.sessionReady === 'function' ? await A.sessionReady() : (A && A.session ? A.session() : null); } catch (_) { s = null; }
  if (!s || !s.token || !C.supabaseUrl) return { scout: false };
  try {
    const r = await root.fetch(C.supabaseUrl + '/rest/v1/rpc/scout_access', {
      method: 'POST', cache: 'no-store',
      headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!r.ok) return { scout: false };
    const j = await r.json();
    return { scout: !!(j && j.scout), platform: !!(j && j.platform) };
  } catch (_) { return { scout: false }; }
}

function boot() {
  const doc = root.document;
  const tabs = doc.getElementById('scTabs'), sec = doc.getElementById('imports'), frame = doc.querySelector('.ep-frame');
  if (!tabs || !sec || !frame) return;
  let mounted = null;
  const say = (m, k) => {
    const s = doc.getElementById('ixSay');
    if (!s) return;
    s.textContent = m;
    s.className = 'ix-say' + (k ? ' ' + k : '');
  };
  const show = (which, quiet) => {
    const ix = which === 'imports';
    frame.classList.toggle('sc-ix', ix);
    sec.classList.toggle('hide', !ix);
    tabs.querySelectorAll('button[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === which)));
    if (ix && !mounted) mounted = mount({ host: doc.getElementById('ixHost'), say });
    try { root.history.replaceState(root.history.state, '', ix ? '#imports' : root.location.pathname + root.location.search); } catch (_) { /* fine */ }
    /* ON THIS PAGE (nav.js) lists the sections shown: tell it they changed */
    try { root.dispatchEvent(new root.Event('epinoia:sections')); } catch (_) { /* fine */ }
    if (!quiet) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  tabs.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-tab]') : null;
    if (b) show(b.dataset.tab === 'imports' ? 'imports' : 'leagues', true);
  });
  access().then(a => {
    if (!a.scout) return;
    tabs.hidden = false;
    if (root.location.hash === '#imports') show('imports', true);
  });
}
if (typeof root.document !== 'undefined' && root.document && typeof module === 'undefined') {
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

return { parseCsv, readFile, merge, statKeys, filter, sort, columns, percentiles, heatOf, toCsv, blankFilter, cleanPos, groupsOf,
         endYearOf, linesFromText, mainLine, idOf, latestOf, mount, access, COLUMN_NAMES, PAGE };
}));
