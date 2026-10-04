'use strict';
/* ============================================================================
   SYNERGY - a player's Synergy play-type export, read for the reports.

   The file is the scraper's CSV (synergy_playtypes_<Player>_accumulated.csv): one row per node of Synergy's
   play-type tree, for each side of the ball -
     Player, Player ID, Seasons scraped, Side (offense / defense), Play Type, Sub 1 .. Sub 4, POSS, PTS, PPP,
     FG MADE, FG ATT, EFG%, TO%, 2 FG MADE, 2 FG ATT, 3 FG MADE, 3FG ATT, FTA/FGA, ...
   A row with no Sub is the play type's total; each Sub level splits its parent ("Isolation > Top > Drives Left >
   To Basket > Make 2 Pts"). The older exports' "Sub Category 1..6" / "Play Type (Sub ..)" columns read the same,
   and a file with no Side column is one side (offense unless told).

   What the reports take from it:
   - DRIVES, left / right / straight (and all of them together, drives.all - the baseline a side is read against): every row that
     ends in "Drives Left" (and so on), under any play type - a
     spot-up closeout attacked, an isolation, a pick-and-pop - counted once. An isolation's drives are split by
     where he started (Top / Left / Right) and summed again under "Isolation - Overall": the total is taken from
     the Overall row, the shot types from the split (only it has them). For each direction: possessions (and their
     share of all his possessions and of his drives), PPP, eFG%, TO%, and the shots - TO BASKET (the rim), the
     DRIBBLE JUMPER's twos (mid-range) and threes: made, attempted, and each kind's share of the attempts.
   - DEFENCE: ATTACKED FACE-UP eFG% - what his man shot isolating him or driving at him (every defensive isolation,
     and every drive outside one, which an isolation's own drives already are inside); POST-D eFG% - what his man
     shot posting him up.
   Nothing is guessed: a figure with no attempts (or no possessions) is null, and the report leaves it blank. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSynergy = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ------------------------------------------------------------------ the file --- */
/* RFC 4180: quoted fields (with commas, doubled quotes and line breaks in them), CRLF or LF, a byte-order mark */
function parseCSV(text) {
  const s = String(text == null ? '' : text).replace(/^﻿/, '');
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') out.push(row); }
  if (!out.length) return [];
  const head = out[0].map(h => h.trim());
  return out.slice(1).map(r => { const o = {}; head.forEach((h, i) => { if (!(h in o)) o[h] = (r[i] == null ? '' : r[i]).trim(); }); return o; });
}

const num = v => {
  if (v == null) return 0;
  const t = String(v).trim().replace('%', '');
  if (!t || t === '-' || /^n\/?a$/i.test(t)) return 0;
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
};
/* the first of these columns the file has (the newer export carries a second, empty set in another case: POSS / Poss) */
const pick = (o, names) => { for (const n of names) if (Object.prototype.hasOwnProperty.call(o, n)) return o[n]; return ''; };
const SUBS = [1, 2, 3, 4, 5, 6].map(i => ['Sub ' + i, 'Sub Category ' + i, i === 1 ? 'Play Type (Sub)' : 'Play Type (Sub ' + i + ')']);
const NONE = v => !v || v === 'N/A' || v === '-';

/* one row: who, which side, where in the tree, and the counts (turnovers and free throws are given as rates) */
function rowOf(o, side0) {
  const path = [String(pick(o, ['Play Type'])).trim()];
  for (const names of SUBS) { const v = String(pick(o, names)).trim(); if (NONE(v)) break; path.push(v); }
  const sd = String(pick(o, ['Side'])).trim().toLowerCase();
  const poss = num(pick(o, ['POSS', 'Poss'])), fga = num(pick(o, ['FG ATT', 'FG Att']));
  return {
    player: String(pick(o, ['Player', 'Player Name'])).trim(), playerId: String(pick(o, ['Player ID'])).trim(),
    seasons: String(pick(o, ['Seasons scraped', 'Season'])).trim(),
    side: /^def/.test(sd) ? 'defense' : /^off/.test(sd) ? 'offense' : (side0 || 'offense'),
    path, poss, pts: num(pick(o, ['PTS', 'Pts'])), fgm: num(pick(o, ['FG MADE', 'FG Made'])), fga,
    fg2m: num(pick(o, ['2 FG MADE', '2 FG Made'])), fg2a: num(pick(o, ['2 FG ATT', '2 FG Att'])),
    fg3m: num(pick(o, ['3 FG MADE', '3 FG Made'])), fg3a: num(pick(o, ['3FG ATT', '3 FG ATT', '3FG Att'])),
    to: Math.round(num(pick(o, ['TO%'])) * poss / 100), fta: Math.round(num(pick(o, ['FTA/FGA'])) * fga)
  };
}

/* every player in a file: { key, name, id, seasons: [...], rows } (a file is usually one player; a merged one, more) */
function read(text, side0) {
  const by = new Map();
  parseCSV(text).forEach(o => {
    const r = rowOf(o, side0);
    if (!r.path[0]) return;
    const key = r.playerId || normName(r.player) || '?';
    if (!by.has(key)) by.set(key, { key, name: r.player, id: r.playerId, seasons: seasonsOf(r.seasons), seasonsText: r.seasons, rows: [] });
    by.get(key).rows.push(r);
  });
  return [...by.values()];
}

/* "2026-2027 Leicester - International + 2025-2026 Baylor - College Men" -> [{ season: '2026-27', team: 'Leicester', level: 'International' }, ...] */
function seasonsOf(s) {
  return String(s || '').split(/\s\+\s/).map(x => x.trim()).filter(Boolean).map(x => {
    const m = x.match(/^(\d{4})-(\d{2})(\d{2})\s+(.*)$/);
    if (!m) return { season: '', team: x, level: '' };
    const rest = m[4], cut = rest.lastIndexOf(' - ');
    return { season: m[1] + '-' + m[3], team: cut > 0 ? rest.slice(0, cut) : rest, level: cut > 0 ? rest.slice(cut + 3) : '' };
  });
}
/* "2022-23 to 2026-27", or the one season */
function span(seasons) {
  const s = (seasons || []).map(x => x.season).filter(Boolean).sort();
  return !s.length ? '' : s.length === 1 ? s[0] : s[0] + ' to ' + s[s.length - 1];
}

/* a name as a person would match it: no accents, no dots or hyphens, initials run together ("J.J. White" = "JJ White") */
function normName(s) {
  let t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
  return t;
}

/* ---------------------------------------------------------------- the tree --- */
const DRIVE = /^drives? (left|right|straight)$/i;
const DIRS = ['left', 'right', 'straight'];
const last = r => r.path[r.path.length - 1];
const dirOf = r => { const m = last(r).match(DRIVE); return m ? m[1].toLowerCase() : null; };
const overall = r => r.path.slice(1, -1).some(p => / - overall$/i.test(p));
const sameStart = (a, b) => a.length < b.length && a.every((x, i) => x === b[i]);
const zero = () => ({ poss: 0, pts: 0, fgm: 0, fga: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, to: 0, fta: 0 });
const add = (t, r) => { ['poss', 'pts', 'fgm', 'fga', 'fg2m', 'fg2a', 'fg3m', 'fg3a', 'to', 'fta'].forEach(k => { t[k] += r[k]; }); return t; };
const sum = rows => rows.reduce(add, zero());
const pct = (a, b) => (b > 0 ? 100 * a / b : null);

/* a play type's total: its own row, or else its "<type> - Overall" row */
function total(rows, side, type) {
  const own = rows.find(r => r.side === side && r.path.length === 1 && r.path[0] === type);
  if (own) return own;
  return rows.find(r => r.side === side && r.path.length === 2 && r.path[0] === type && / - overall$/i.test(r.path[1])) || null;
}
const children = (rows, r) => rows.filter(c => c.side === r.side && c.path.length === r.path.length + 1 && sameStart(r.path, c.path));

/* each play type's drives in one direction, once: { totals: [rows], shots: [rows] } */
function driveRows(rows, side, dir) {
  const cand = rows.filter(r => r.side === side && dirOf(r) === dir);
  const out = { totals: [], shots: [] };
  [...new Set(cand.map(r => r.path[0]))].forEach(type => {
    const mine = cand.filter(r => r.path[0] === type);
    const ov = mine.filter(overall), split = mine.filter(r => !overall(r));
    const top = list => list.filter(r => !list.some(q => q !== r && sameStart(q.path, r.path)));      // never a drive inside a drive
    out.totals.push(...top(ov.length ? ov : split));
    out.shots.push(...top(split.length ? split : ov));
  });
  return out;
}

/* the shots of a set of drive rows: TO BASKET is the rim, the DRIBBLE JUMPER's twos are mid-range and its threes threes */
function shotsOf(rows, driveSet) {
  const s = { rim: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, three: { m: 0, a: 0 } };
  driveSet.forEach(d => children(rows, d).forEach(c => {
    const k = last(c).toLowerCase();
    if (k === 'to basket') { s.rim.m += c.fgm; s.rim.a += c.fga; }
    else if (k === 'dribble jumper') { s.mid.m += c.fg2m; s.mid.a += c.fg2a; s.three.m += c.fg3m; s.three.a += c.fg3a; }
  }));
  return s;
}

/* one direction's figures; `all` is his possessions on that side (for the share of them) */
function lineOf(t, shots, all, drives) {
  const att = shots.rim.a + shots.mid.a + shots.three.a;
  return {
    poss: t.poss, pts: t.pts, fgm: t.fgm, fga: t.fga, fg3m: t.fg3m, fg3a: t.fg3a, to: t.to,
    ppp: t.poss > 0 ? t.pts / t.poss : null,
    efg: pct(t.fgm + 0.5 * t.fg3m, t.fga),
    toPct: pct(t.to, t.poss),
    pctPoss: pct(t.poss, all),          // of all his possessions (Synergy's %Time)
    share: pct(t.poss, drives),         // of his drives
    shots, att,
    rimFg: pct(shots.rim.m, shots.rim.a), midFg: pct(shots.mid.m, shots.mid.a), threeFg: pct(shots.three.m, shots.three.a),
    rimAtt: pct(shots.rim.a, att), midAtt: pct(shots.mid.a, att), threeAtt: pct(shots.three.a, att)
  };
}

/* which shot a direction leans on, for the colour of its PPP: the rim or the dribble jumper, by how much (0 level, 1 all
   of one), and of the jumpers how many were threes (0 all mid-range, 1 all threes); null with no shots */
function lean(line) {
  if (!line || !line.att) return null;
  const rim = line.shots.rim.a, jump = line.shots.mid.a + line.shots.three.a;
  return { kind: rim >= jump ? 'rim' : 'jumper', by: Math.abs(rim - jump) / (rim + jump), threes: jump > 0 ? line.shots.three.a / jump : null };
}

const efgOf = t => ({ poss: t.poss, fgm: t.fgm, fga: t.fga, fg3m: t.fg3m, pts: t.pts, efg: pct(t.fgm + 0.5 * t.fg3m, t.fga), ppp: t.poss > 0 ? t.pts / t.poss : null });

/* ------------------------------------------------------------- the profile --- */
/* everything the reports use, for one player's rows */
function profile(player) {
  const rows = player.rows || [];
  const sideTotal = side => sum(rows.filter(r => r.side === side && r.path.length === 1));
  const off = sideTotal('offense'), def = sideTotal('defense');

  const drives = {}, dsets = {};
  DIRS.forEach(dir => { dsets[dir] = driveRows(rows, 'offense', dir); });
  const allDrives = DIRS.reduce((a, d) => a + sum(dsets[d].totals).poss, 0);
  DIRS.forEach(dir => { drives[dir] = lineOf(sum(dsets[dir].totals), shotsOf(rows, dsets[dir].shots), off.poss, allDrives); });
  /* EVERY DIRECTION TOGETHER (left, right and straight): the baseline each side is read against */
  const allShots = { rim: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, three: { m: 0, a: 0 } };
  DIRS.forEach(d => ['rim', 'mid', 'three'].forEach(k => { allShots[k].m += drives[d].shots[k].m; allShots[k].a += drives[d].shots[k].a; }));
  drives.all = lineOf(DIRS.map(d => sum(dsets[d].totals)).reduce(add, zero()), allShots, off.poss, allDrives);

  /* defence: every isolation, and every drive outside one */
  const iso = total(rows, 'defense', 'Isolation'), post = total(rows, 'defense', 'Post-Up');
  const outside = DIRS.flatMap(dir => driveRows(rows, 'defense', dir).totals).filter(r => r.path[0] !== 'Isolation');
  const faceUp = sum((iso ? [iso] : []).concat(outside));

  return {
    name: player.name || '', id: player.id || '', seasons: player.seasons || [], span: span(player.seasons),
    hasOffense: off.poss > 0, hasDefense: def.poss > 0,
    offense: { poss: off.poss, ppp: off.poss > 0 ? off.pts / off.poss : null, drives, drivePoss: allDrives },
    defense: {
      poss: def.poss,
      faceUp: faceUp.fga > 0 ? efgOf(faceUp) : null,
      post: post && post.fga > 0 ? efgOf(post) : null
    }
  };
}

/* WHO IN A LIST A FILE'S NAME IS: the same name (normName), or else the only one with his surname and first initial
   ("JJ White" is Jaylon White when he is the only J. White there) - { person, how: 'name' | 'initial' }, or null */
function matchPlayer(name, people) {
  const n = normName(name), list = people || [];
  const same = list.filter(p => normName(p.name) === n);
  if (same.length === 1) return { person: same[0], how: 'name' };
  if (same.length > 1) return null;
  const parts = n.split(' '), last = parts[parts.length - 1], first = parts[0] || '';
  if (!last || parts.length < 2) return null;
  const like = list.filter(p => { const q = normName(p.name).split(' '); return q.length > 1 && q[q.length - 1] === last && (q[0] || '')[0] === first[0]; });
  return like.length === 1 ? { person: like[0], how: 'initial' } : null;
}

/* the convenience: a file's text to one player's profile (the one named, or the only one) */
function fromText(text, name) {
  const ps = read(text);
  const p = name ? ps.find(x => normName(x.name) === normName(name)) : ps.length === 1 ? ps[0] : null;
  return p ? profile(p) : null;
}

/* a profile kept in the database: the numbers only, small and versioned (rows are not kept) */
const VERSION = 1;
const pack = p => (p ? Object.assign({ v: VERSION }, p) : null);
const ok = p => !!(p && p.v === VERSION && p.offense && p.defense);

return { VERSION, parseCSV, read, profile, fromText, normName, matchPlayer, seasonsOf, span, lean, pack, ok, DIRS };
}));
