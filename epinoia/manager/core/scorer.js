'use strict';
/* ============================================================================
   MANAGER - A SIMULATED GAME IN THE SCORER'S OWN SHAPE (core: no site, no DOM).

   Louie, 2026-10-09: the Manager's box scores need "similar visuals/elements and same functionality as the epinoia
   equivalents" - the full stats' cards, the play-by-play's linked plays and faces, the modern box score's court. The
   way to have exactly those is to BE a game EPINOIA can read: this turns a game's play-by-play (core/engine.js pbp, kept
   by core/season.js) into the scorer's state - { teams: [{name, color, players: [{id, name, num}]}], starters, events }
   in epinoia/engine.js's event log - and the game page draws it with the code that draws every real game
   (game/game.js manager mode).

     toScorer(S, r, o)    the reader's game of round r -> the scorer's state (null when it is not kept)
                          o: {names: id -> {name, num}, clubs: [{name, short, colour, logo_url}] (home, away), G,
                              format, seed, competition}

   THE LOG: each period started ('period_start'); every shot a 'p2_made' .. 'p3_miss' with its place on the half court
   ('loc', drawn inside its zone, seeded: the rim within the restricted area, the mid-range between it and the arc, a
   three beyond the arc or in a corner) and its type ('stype': a layup or a dunk at the rim, a jump shot elsewhere); an
   assist after the make it set up, a block after the miss it made; the boards; a turnover and the steal of a live one;
   a foul (shooting or personal, and who drew it) before its free throws; the substitutions where the fives change; the
   end. A man who is only a reserve (a club with fewer than five fit men) is named so.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.scorer = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const M = () => root.Mgr || {};
const SEA = () => M().season || (typeof require === 'function' ? require('./season.js') : null);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* THE HALF COURT as boxscore.js draws it: 1500 x 1400 cm, the ring at (750, 157.5), the arc 675 cm (90 cm from each
   sideline in the corners, to 299 cm up the floor), the restricted area 125 cm */
const W = 1500, H = 1400, RX = 750, RY = 157.5;
function spot(z, R) {
  const at = (d, a) => ({ x: (RX + d * Math.cos(a)) / W, y: Math.max(20, Math.min(H - 20, RY + d * Math.sin(a))) / H });
  if (z === 0) return at(25 + 90 * Math.sqrt(R()), 0.15 + (Math.PI - 0.3) * R());
  if (z === 1 || z === 3) return at(160 + 470 * R(), 0.12 + (Math.PI - 0.24) * R());
  if (R() < 0.22) { const side = R() < 0.5 ? -1 : 1; return { x: (RX + side * (670 + 50 * R())) / W, y: (40 + 240 * R()) / H }; }
  return at(700 + 110 * R(), 0.42 + (Math.PI - 0.84) * R());
}
/* a period's clock (ms left) at a game second: quarters of the game's length, then overtimes */
function clockAt(t, G, ot) {
  const T = G * 60, q = T / 4;
  if (t < T - 1e-6) { const p = Math.floor(t / q) + 1; return { period: p, clock: Math.max(0, Math.round((p * q - t) * 1000)) }; }
  const o = Math.min(Math.max(0, Math.floor((t - T) / ot)), 20);
  return { period: 5 + o, clock: Math.max(0, Math.round((T + (o + 1) * ot - t) * 1000)) };
}

function toScorer(S, r, o) {
  o = o || {};
  const P = S.pbp && S.pbp[r], f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
  if (!P || !f || !f.res) return null;
  const G = o.G || 40, OT = 300, ev = SEA().decodeEvents(S, P.e), lineups = P.l || [];
  const R = rng(o.seed != null ? o.seed : hashOf((S.seed || 0) + ':pbp:' + r));
  const people = S.people, names = o.names || {};
  /* a reserve has no id the site knows: one of its own, never a real player's */
  const pidOf = id => (id == null ? null : /^fill:/.test(String(id)) ? 'ffffffff-ffff-4fff-8fff-' + String(hashOf(id)).padStart(12, '0').slice(-12) : String(id));
  const seen = [new Set(), new Set()];
  lineups.forEach(x => [0, 1].forEach(s => x[2 + s].forEach(i => seen[s].add(people[i]))));
  (S.box[r] || []).forEach((side, s) => side.forEach(l => seen[s].add(people[l[0]])));
  const clubs = o.clubs || [{}, {}];
  const teams = [0, 1].map(s => ({
    name: clubs[s].name || (s ? 'Away' : 'Home'), color: clubs[s].colour || (s ? '#8ff5ff' : '#93f2bf'),
    players: [...seen[s]].filter(Boolean).map(id => {
      const nm = names[id] || {};
      return { id: pidOf(id), name: /^fill:/.test(String(id)) ? 'Reserve' : (nm.name || 'Player'), num: nm.num != null ? String(nm.num) : '' };
    })
  }));
  const starters = [0, 1].map(s => (lineups[0] ? lineups[0][2 + s].map(i => pidOf(people[i])) : teams[s].players.slice(0, 5).map(p => p.id)));
  const out = [];
  let seq = 0;
  const push = (t, e) => { const c = clockAt(t, G, OT); out.push(Object.assign({ id: ++seq, period: c.period, clock: c.clock, _t: t }, e)); return seq; };
  /* the substitutions, where the fives change: at the possession the game changed them at (each possession names its
     fives, l), between the last one's board and this one's first play; a game kept before possessions named them
     changes at the rotation's own minutes */
  const change = (from, to, t) => [0, 1].forEach(s => {
    const a = lineups[from][2 + s].map(x => people[x]), b = lineups[to][2 + s].map(x => people[x]);
    const outs = a.filter(x => !b.includes(x)), ins = b.filter(x => !a.includes(x));
    outs.forEach((x, k) => push(t, { t: 'sub', team: s, out: pidOf(x), in: pidOf(ins[k]) }));
  });
  const named = ev.some(e => e.k === 'P' && e.l != null && lineups[e.l]);
  let five = 0;
  const subs = [];
  if (!named) for (let i = 1; i < lineups.length; i++) subs.push({ t: lineups[i][0] * 60, from: i - 1, to: i });
  let si = 0;
  const flushSubs = t => { while (si < subs.length && subs[si].t <= t + 1e-6) { const x = subs[si++]; change(x.from, x.to, Math.max(0, x.t - 0.001)); } };
  let lastMade = null;
  ev.forEach(e => {
    const t = e.t;
    if (e.k !== 'Q') flushSubs(t);
    if (named && e.k === 'P' && e.l != null && lineups[e.l] && e.l !== five) { change(five, e.l, t); five = e.l; }
    switch (e.k) {
      case 'Q': {
        const c = e.p === 0 ? 0 : G * 60 + (e.p - 1) * OT;
        /* the four quarters' starts (the play-by-play tells only the game's and each overtime's) */
        if (e.p === 0) for (let q = 0; q < 4; q++) { const tq = q * G * 15; out.push({ id: ++seq, t: 'period_start', period: q + 1, clock: G * 15 * 1000, _t: tq - 0.002 }); }
        else push(c, { t: 'period_start' });
        break;
      }
      case 'S': {
        const made = !!e.m, three = e.z === 2, id = push(t, { t: (three ? 'p3_' : 'p2_') + (made ? 'made' : 'miss'), team: e.s, pid: pidOf(e.p) });
        const l = spot(e.z, R);
        push(t, { t: 'loc', ref: id, x: +l.x.toFixed(4), y: +l.y.toFixed(4) });
        push(t, { t: 'stype', ref: id, v: e.z === 0 ? (R() < 0.22 ? 'dunk' : 'layup') : 'jump shot' });
        if (made && e.a) push(t, { t: 'ast', team: e.s, pid: pidOf(e.a) });
        if (!made && e.b) push(t, { t: 'blk', team: 1 - e.s, pid: pidOf(e.b) });
        if (made) lastMade = e.p;
        break;
      }
      case 'F': {
        push(t, { t: 'foul', team: 1 - e.s, pid: e.f ? pidOf(e.f) : null, kind: e.kind === 1 || e.kind === 2 ? 'shooting' : 'personal', drawn: pidOf(e.p) });
        /* the makes and misses of a trip in a seeded order */
        const shots = [];
        for (let i = 0; i < e.n; i++) shots.push(i < e.m);
        for (let i = shots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [shots[i], shots[j]] = [shots[j], shots[i]]; }
        shots.forEach(mk => push(t, { t: mk ? 'ft_made' : 'ft_miss', team: e.s, pid: pidOf(e.p) }));
        break;
      }
      case 'T':
        push(t, { t: 'to', team: e.s, pid: pidOf(e.p) });
        if (e.live && e.st) push(t, { t: 'stl', team: 1 - e.s, pid: pidOf(e.st) });
        break;
      case 'O': case 'D':
        push(t, { t: 'reb', team: e.s, pid: pidOf(e.p), off: e.k === 'O' });
        break;
      case 'f':
        push(t, { t: 'foul', team: e.s, pid: e.p ? pidOf(e.p) : null, kind: 'personal' });
        break;
      case 'X':
        push(t, { t: 'ft_made', team: e.s, pid: pidOf(lastMade || e.p) });
        break;
      default: break;
    }
  });
  flushSubs(Infinity);
  const end = out.length ? out.reduce((a, x) => Math.max(a, x._t), 0) : G * 60;
  push(Math.max(end, G * 60 - 0.001), { t: 'game_end' });
  /* the game's order (engine.js replays by period and clock; equal clocks keep this order) */
  out.sort((a, b) => a._t - b._t || a.id - b.id);
  out.forEach(x => { delete x._t; });
  const ot = f.res[2] || 0;
  return {
    teams, starters, events: out, period: 4 + ot, clockMs: 0, phase: 'final', status: 'final',
    format: o.format || (G === 40 ? null : { periods: 4, period_ms: G * 15 * 1000, ot_ms: OT * 1000 }),
    competition: o.competition || 'Manager', leagueSlug: null, leagueId: null, venue: o.venue || null, video: null, clips: [],
    details: { venue: o.venue || null, address: null, capacity: null, attendance: null, officials: {} },
    meta: { tipoff_at: o.tipoff || null, status: 'final', venue: o.venue || null, home_score: f.res[0], away_score: f.res[1],
      home: { name: teams[0].name, short_name: clubs[0].short || teams[0].name, colour: teams[0].color, logo_url: clubs[0].logo_url || null, logo_path: clubs[0].logo_path || null },
      away: { name: teams[1].name, short_name: clubs[1].short || teams[1].name, colour: teams[1].color, logo_url: clubs[1].logo_url || null, logo_path: clubs[1].logo_path || null },
      homeTeamId: null, awayTeamId: null, competitionId: null, manager: true }
  };
}

return { toScorer, spot, clockAt };
}));
