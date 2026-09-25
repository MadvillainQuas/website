'use strict';
/* ============================================================================
   ROTATIONS — who was on the floor, minute by minute.

   A row per player and a cell per minute of the game, shaded by how much of
   that minute he was on the floor; both sides, with the score margin running
   between them so a run can be read against the five who were out there for
   it. The game page draws one game on its GAME FLOW tab; the team profile
   draws a season, each cell the share of that minute across the club's games.

   THE MINUTES ARE THE ENGINE'S. Who is on the floor follows engine.js's own
   accounting to the letter: the starters from the tip, a player's stretch
   closed by the substitution that takes him off, a second "in" for somebody
   already on restarting his stretch (the engine drops the time before it, so
   this does too), and everybody still on closed at the end of the game. A
   player's bar therefore adds up to his minutes in the box score -- which the
   test holds on real games -- and the chart cannot quietly disagree with the
   table beside it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaRotation = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const PLEN = p => (p <= 4 ? 600000 : 300000);
const MIN = 60000;
function cumEl(p, clk) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); }
/* engine.js's inGameOrder: by game time, ties in log order */
function inGameOrder(evs) {
  const keyed = evs.map((ev, i) => ({ ev, i, k: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1)) }));
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return keyed.map(x => x.ev);
}
const periodLabel = n => (n <= 4 ? 'Q' + n : 'OT' + (n - 4));
const PTS = { p2_made: 2, p3_made: 3, ft_made: 1 };

/* the minutes a set of stretches covers, one share (0-1) per minute of the game */
function cellsOf(stretches, nMin) {
  const c = new Array(nMin).fill(0);
  stretches.forEach(([a, b]) => {
    for (let m = Math.max(0, Math.floor(a / MIN)); m < Math.min(nMin, Math.ceil(b / MIN)); m++) {
      const lo = Math.max(a, m * MIN), hi = Math.min(b, (m + 1) * MIN);
      if (hi > lo) c[m] += (hi - lo) / MIN;
    }
  });
  return c.map(v => Math.min(1, v));
}

/* ---------------------------------------------------------------- a game --- */
function compute(S) {
  const events = inGameOrder(((S && S.events) || []).filter(Boolean));
  const seen = events.reduce((m, e) => Math.max(m, e.period || 1), 1);
  const nP = Math.max(4, (S && S.period) || 1, seen);
  const periods = [];
  let at = 0;
  for (let p = 1; p <= nP; p++) { periods.push({ n: p, label: periodLabel(p), from: at / MIN, to: (at + PLEN(p)) / MIN }); at += PLEN(p); }
  const length = at, nMin = Math.ceil(length / MIN);

  /* A finished game closes where the engine closes it: at the game's own period and clock,
     which for a final is the end of its last period (overtime included). One still being
     played closes at its latest play, not at the end of the period it is in -- the page loads
     a live game with the clock at zero, and every player on the floor would otherwise be
     drawn out to the buzzer. */
  const last = events.reduce((m, e) => (e.clock != null ? Math.max(m, cumEl(e.period || 1, e.clock)) : m), 0);
  const now = S && S.status === 'final'
    ? Math.min(length, cumEl((S.period || nP), S.clockMs || 0))
    : Math.min(length, Math.max(last, (S && S.clockMs) ? cumEl(S.period || 1, S.clockMs) : 0));

  const stretches = {};
  const push = (pid, a, b) => { if (b > a) (stretches[pid] = stretches[pid] || []).push([a, b]); };
  const lastIn = {};
  ((S && S.starters) || [[], []]).forEach(a => (a || []).forEach(pid => { lastIn[pid] = 0; }));
  events.forEach(ev => {
    if (ev.t !== 'sub') return;
    const cum = cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1));
    if (lastIn[ev.out] != null) { push(ev.out, lastIn[ev.out], cum); delete lastIn[ev.out]; }
    lastIn[ev.in] = cum;
  });
  Object.keys(lastIn).forEach(pid => push(pid, lastIn[pid], now));

  const starters = new Set([].concat(((S && S.starters) || [[], []])[0] || [], ((S && S.starters) || [[], []])[1] || []));
  const teams = [0, 1].map(t => {
    const tm = (S && S.teams && S.teams[t]) || {};
    const rows = (tm.players || []).map(p => {
      const st = stretches[p.id] || [];
      const ms = st.reduce((n, [a, b]) => n + (b - a), 0);
      /* spans: the stretches themselves, [from, to] in game ms -- the modern box score's popup lists them */
      return { pid: p.id, name: p.name || '', num: p.num, starter: starters.has(p.id), ms, cells: cellsOf(st, nMin), dnp: ms <= 0, spans: st.slice() };
    });
    rows.sort((a, b) => (a.dnp - b.dnp) || (b.ms - a.ms) || (String(a.num).localeCompare(String(b.num), undefined, { numeric: true })));
    return { name: tm.name || (t ? 'Away' : 'Home'), rows };
  });

  /* the margin, home minus away, as a step after every point scored */
  const s = [0, 0];
  const margin = [[0, 0]];
  events.forEach(ev => {
    const v = PTS[ev.t];
    if (!v || (ev.team !== 0 && ev.team !== 1) || ev.clock == null) return;
    s[ev.team] += v;
    margin.push([cumEl(ev.period || 1, ev.clock) / MIN, s[0] - s[1]]);
  });

  return { minutes: nMin, periods, now: now / MIN, teams, margin, score: s };
}

/* -------------------------------------------------------------- a season ---
   games: [{ model: compute(S), side: 0 | 1 }] for one club. Each cell is the share
   of that minute the player was on the floor ACROSS THE CLUB'S GAMES -- a game he
   missed counts as none of it, which is what a rotation looks like from the bench.
   Regulation only: overtime is too rare to average. The margin is the club's own,
   the mean at the end of each minute. */
function season(games, name) {
  const list = (games || []).filter(g => g && g.model);
  const n = list.length, nMin = 40;
  const by = {};
  list.forEach(({ model, side }) => {
    (model.teams[side].rows || []).forEach(r => {
      if (!r.ms) return;
      const x = by[r.pid] = by[r.pid] || { pid: r.pid, name: r.name, num: r.num, ms: 0, gp: 0, starts: 0, cells: new Array(nMin).fill(0) };
      x.ms += r.ms; x.gp++; if (r.starter) x.starts++;
      for (let m = 0; m < nMin; m++) x.cells[m] += r.cells[m] || 0;
    });
  });
  const rows = Object.values(by).map(x => Object.assign(x, { cells: x.cells.map(v => (n ? v / n : 0)), dnp: false }))
    .sort((a, b) => b.ms - a.ms);
  const periods = [1, 2, 3, 4].map(p => ({ n: p, label: periodLabel(p), from: (p - 1) * 10, to: p * 10 }));
  /* the club's margin at the end of each minute, averaged over its games */
  const at = (pts, m) => { let v = 0; for (const [x, y] of pts) { if (x <= m) v = y; else break; } return v; };
  const margin = [];
  for (let m = 0; m <= nMin; m++) {
    const vals = list.map(({ model, side }) => (side ? -1 : 1) * at(model.margin, m));
    margin.push([m, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0]);
  }
  return { minutes: nMin, periods, now: nMin, teams: [{ name: name || '', rows }], margin, games: n, season: true };
}

/* ---------------------------------------------------------------- render --- */
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* a colour to paint with: a club's hex, or one of the page's own custom properties (the game
   flow tab passes the theme-inked --vis-t0 / --vis-t1). Nothing else goes into a style. */
const hex = v => {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  return /^var\(--[a-z0-9-]+(\s*,\s*var\(--[a-z0-9-]+\))?\)$/i.test(s) ? s : null;
};
const clockOf = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
let uid = 0;

function linesHTML(model) {
  return '<span class="rot-lines" aria-hidden="true">' + model.periods.slice(1).map(p =>
    '<i style="left:' + (100 * p.from / model.minutes).toFixed(3) + '%"></i>').join('') + '</span>';
}

function teamHTML(model, t, colour, opts) {
  const T = model.teams[t];
  const rows = T.rows.map(r => {
    const sub = model.season
      ? (r.ms / Math.max(1, model.games) / MIN).toFixed(1) + ' mpg · ' + r.gp + ' gp'
      : (r.dnp ? '' : clockOf(r.ms));
    const label = '<span class="rot-nm" title="' + esc(r.name + (r.num != null && r.num !== '' ? ' #' + r.num : '')) + '">' +
      '<b>' + esc(r.name) + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>';
    if (r.dnp) return '<div class="rot-row dnp">' + label + '<span class="rot-cells"><em>DNP</em></span></div>';
    const cells = r.cells.map((v, m) => {
      const tip = (model.season ? 'minute ' + (m + 1) + ': on the floor ' + Math.round(100 * v) + '% of the time across ' + model.games + ' games'
                                : 'minute ' + (m + 1) + ': ' + Math.round(60 * v) + ' s on the floor');
      return v > 0.001 ? '<i style="opacity:' + Math.max(0.12, v).toFixed(2) + '" title="' + esc(tip) + '"></i>' : '<i class="off"></i>';
    }).join('');
    return '<div class="rot-row">' + label + '<span class="rot-cells">' + cells + linesHTML(model) + '</span></div>';
  }).join('');
  const axis = '<div class="rot-row rot-axis"><span class="rot-nm"></span><span class="rot-ax">' + model.periods.map(p =>
    '<span style="left:' + (100 * (p.from + p.to) / 2 / model.minutes).toFixed(2) + '%">' + p.label + '</span>').join('') + '</span></div>';
  return '<div class="rot-team" style="--rot-c:' + (hex(colour) || 'var(--lume)') + '">' +
    '<div class="rot-h"><i></i><b>' + esc(T.name) + '</b>' + (opts.teamNote ? '<small>' + esc(opts.teamNote) + '</small>' : '') + '</div>' +
    rows + axis + '</div>';
}

/* the margin between the two grids: a step line, the lead coloured by whoever has it */
function marginHTML(model, colours, opts) {
  const pts = model.margin || [];
  if (pts.length < 2) return '';
  const N = model.minutes;
  const peak = Math.max(5, ...pts.map(p => Math.abs(p[1])));
  const top = Math.ceil(peak / 5) * 5;
  const H = 60, y = v => (H / 2 - (v / top) * (H / 2)).toFixed(2);
  const end = Math.min(N, model.now != null ? model.now : N);
  let d = 'M0 ' + y(0);
  let prev = 0;
  pts.forEach(([x, v]) => { d += ' L' + x.toFixed(3) + ' ' + y(prev) + ' L' + x.toFixed(3) + ' ' + y(v); prev = v; });
  if (model.season) { d = 'M0 ' + y(pts[0][1]); pts.forEach(([x, v]) => { d += ' L' + x.toFixed(3) + ' ' + y(v); }); }
  else d += ' L' + end.toFixed(3) + ' ' + y(prev);
  const area = d + ' L' + (model.season ? pts[pts.length - 1][0] : end).toFixed(3) + ' ' + y(0) + ' L0 ' + y(0) + ' Z';
  const id = 'rotm' + (++uid);
  const c0 = hex(colours[0]) || 'var(--lume)', c1 = hex(colours[1]) || 'var(--ink-3)';
  const grid = model.periods.slice(1).map(p => '<line x1="' + p.from + '" x2="' + p.from + '" y1="0" y2="' + H + '" class="rot-mq"/>').join('');
  const svg = '<svg class="rot-svg" viewBox="0 0 ' + N + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(opts.marginLabel || 'score margin') + '">' +
    '<defs><clipPath id="' + id + 'u"><rect x="0" y="0" width="' + N + '" height="' + (H / 2) + '"/></clipPath>' +
    '<clipPath id="' + id + 'd"><rect x="0" y="' + (H / 2) + '" width="' + N + '" height="' + (H / 2) + '"/></clipPath></defs>' +
    grid + '<line x1="0" x2="' + N + '" y1="' + (H / 2) + '" y2="' + (H / 2) + '" class="rot-m0"/>' +
    '<path d="' + area + '" fill="' + c0 + '" fill-opacity=".22" clip-path="url(#' + id + 'u)"/>' +
    '<path d="' + area + '" fill="' + c1 + '" fill-opacity=".22" clip-path="url(#' + id + 'd)"/>' +
    '<path d="' + d + '" class="rot-mline" fill="none"/></svg>';
  const scale = '<span class="rot-nm rot-scale"><small>+' + top + '</small><small>0</small><small>−' + top + '</small></span>';
  return '<div class="rot-margin"><div class="rot-mh">' + esc(opts.marginLabel || 'score margin') + '</div>' +
    '<div class="rot-row rot-mrow">' + scale + '<span class="rot-mplot">' + svg + '</span></div></div>';
}

/* opts: { colours: [c0, c1], marginLabel, teamNotes: [n0, n1], margin }. A season model has one
   side, so it draws its grid and its margin; a game draws home, the margin, then away.
   margin: false leaves the margin out -- the game flow tab already has a whole chart of it a
   card above, and a second copy squeezed between the rotations only repeated it smaller. */
function html(model, opts) {
  const o = opts || {};
  const colours = o.colours || [];
  if (!model || !model.teams || !model.teams.length) return '';
  const legend = '<div class="rot-legend"><span>0%</span><i></i><span>100%</span><small>' +
    esc(model.season ? 'share of each minute on the floor, across the season' : 'share of each minute on the floor') + '</small></div>';
  const notes = o.teamNotes || [];
  const margin = o.margin === false ? '' : marginHTML(model, colours, o);
  const body = model.teams.length === 1
    ? teamHTML(model, 0, colours[0], { teamNote: notes[0] }) + margin
    : teamHTML(model, 0, colours[0], { teamNote: notes[0] }) + margin + teamHTML(model, 1, colours[1], { teamNote: notes[1] });
  return '<div class="rot" style="--rot-n:' + model.minutes + '">' + body + legend + '</div>';
}

return { compute, season, html, cellsOf, cumEl };
}));
