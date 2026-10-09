'use strict';
/* ============================================================================
   MANAGER - THE SCHEDULE AND THE TABLE (core).

   roundRobin(ids, meetings): every club plays every other `meetings` times (Louie: three), a matchday at a time, everyone
   playing once a matchday (the circle method; an odd number of clubs gives one a bye a matchday), the second meeting
   the return game, later ones hosted by whoever has had fewer home games, so each club's homes come out even (within
   one or two) and spread through the season. Seeded, so the same league makes the same schedule.
   table(fixtures, ids): W, L, PF, PA, the difference, the last five, the home and away records, the head-to-head - ranked
   by wins, then the head-to-head between the tied, then the points difference, then points for.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.schedule = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* a small seeded generator (mulberry32) for shuffles */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* -> [{round, home, away}], rounds numbered from 1 */
function roundRobin(ids, meetings, seed) {
  const R = rng(seed != null ? seed : hashOf(ids.join('|')));
  const teams = ids.slice();
  /* a seeded shuffle, so a league's own order does not decide who opens at home */
  for (let i = teams.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [teams[i], teams[j]] = [teams[j], teams[i]]; }
  if (teams.length % 2) teams.push(null);
  const n = teams.length, half = n / 2, base = [];
  let arr = teams.slice();
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a == null || b == null) continue;
      /* alternate the fixed club's home and away, and every other pairing by round, so homes spread */
      games.push((i === 0 ? r % 2 === 0 : (r + i) % 2 === 0) ? [a, b] : [b, a]);
    }
    base.push(games);
    arr = [arr[0]].concat([arr[n - 1]], arr.slice(1, n - 1));
  }
  /* the second meeting is the return game; from the third on, the club with fewer home games so far hosts (an odd
     league's byes leave the circle method's homes uneven, and a third meeting would double the gap) */
  const out = [], homes = new Map(ids.map(id => [id, 0]));
  const m = Math.max(1, meetings || 1);
  for (let k = 0; k < m; k++) {
    base.forEach((games, r) => games.forEach(([h, a]) => {
      let H = h, A = a;
      if (k === 1) { H = a; A = h; }
      else if (k >= 2) { const d = homes.get(h) - homes.get(a); if (d > 0 || (d === 0 && k % 2 === 1)) { H = a; A = h; } }
      homes.set(H, homes.get(H) + 1);
      out.push({ round: k * base.length + r + 1, home: H, away: A });
    }));
  }
  return out;
}

/* THE TABLE. fixtures: [{home, away, hs, as}] (unplayed ones have no scores) */
function table(fixtures, ids) {
  const row = id => ({ id, gp: 0, w: 0, l: 0, pf: 0, pa: 0, hw: 0, hl: 0, aw: 0, al: 0, last: [], streak: '' });
  const T = new Map(ids.map(id => [id, row(id)]));
  const h2h = new Map();
  const key = (a, b) => a + '|' + b;
  fixtures.filter(f => f.hs != null && f.as != null).sort((a, b) => (a.round || 0) - (b.round || 0)).forEach(f => {
    const H = T.get(f.home) || (T.set(f.home, row(f.home)), T.get(f.home)), A = T.get(f.away) || (T.set(f.away, row(f.away)), T.get(f.away));
    const hw = f.hs > f.as;
    H.gp++; A.gp++; H.pf += f.hs; H.pa += f.as; A.pf += f.as; A.pa += f.hs;
    if (hw) { H.w++; H.hw++; A.l++; A.al++; } else { A.w++; A.aw++; H.l++; H.hl++; }
    H.last.push(hw ? 'W' : 'L'); A.last.push(hw ? 'L' : 'W');
    const kw = hw ? key(f.home, f.away) : key(f.away, f.home);
    h2h.set(kw, (h2h.get(kw) || 0) + 1);
  });
  const rows = [...T.values()].map(r => Object.assign(r, { diff: r.pf - r.pa, pct: r.gp ? r.w / r.gp : 0, last5: r.last.slice(-5),
    streak: (() => { const l = r.last; if (!l.length) return ''; let n = 1; while (n < l.length && l[l.length - 1 - n] === l[l.length - 1]) n++; return l[l.length - 1] + n; })() }));
  const winsOver = (a, b) => h2h.get(key(a, b)) || 0;
  rows.sort((a, b) => (b.w - a.w) || (a.l - b.l) || (winsOver(b.id, a.id) - winsOver(a.id, b.id)) || (b.diff - a.diff) || (b.pf - a.pf) || String(a.id).localeCompare(String(b.id)));
  rows.forEach((r, i) => { r.pos = i + 1; });
  return { rows, h2h: (a, b) => ({ w: winsOver(a, b), l: winsOver(b, a) }) };
}

return { roundRobin, table, rng, hashOf };
}));
