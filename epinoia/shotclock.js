'use strict';
/* ============================================================================
   SHOT CLOCK — how long a side had the ball before a chance ended, and what the
   chances that ended at that point of the clock produced.

   The question it answers is a coach's: "how do we do in early offence that is
   not a break?" -- keep the chances that ended 8 to 16 seconds after the ball
   changed hands, and read their four factors and their shots. One calculator,
   read by the game page's SHOT CLOCK tab, the average time of possession in its
   full stats, and the team profile's season section.

   THE CLOCK STARTS WHEN THE BALL CHANGES HANDS, not at the first action. It is
   the other side's made basket, last free throw, turnover or the steal of it;
   or this side's own defensive rebound; or the start of the period for the
   first possession of one. epinoia/possessions.js records that moment on every
   possession (gainPeriod / gainClock) by the same rules that decide who has the
   ball at all -- there is one answer to "whose ball, since when".

   ONLY FIRST CHANCES GO IN A WINDOW. An offensive rebound resets the shot
   clock, so what a putback did says nothing about sixteen seconds of set
   offence. A chance opened by an offensive rebound is a second chance and is
   counted apart; it never lands in a window. A first chance's OWN miss being
   won back by the offence is still that chance's business: it is exactly what
   the window's offensive rebound rate measures.

   THE CHANCES ARE THE EVENTS TAB'S CHANCES. possessions.js decides where one
   ends, situations.js's rule decides which action belongs to which (an and-one's
   free throw is the basket's), and a chance with no action in it -- the clock
   running out -- is not counted, exactly as the events tab counts them.

   Durations are game-clock seconds. Outside the last two minutes the clock runs
   while a made basket is inbounded, so a possession's time includes its inbound,
   as every public possession-length measure does.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaShotClock = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* possessions.js and situations.js: globals on a page, modules in node */
const Poss = () => root.EpinoiaPossessions ||
  (typeof require === 'function' ? require('./possessions.js') : null);
const Sit = () => root.EpinoiaSituations ||
  (typeof require === 'function' ? require('./situations.js') : null);

/* the top of the slider. A possession that ran past 24 s (a kicked ball, a foul that
   kept the ball) is still a late-clock possession, so it counts in the last second */
const MAX = 24;
/* TWO FULL SHOT CLOCKS IS A GAP IN THE LOG, NOT A POSSESSION. A reset can carry one past
   24 s, and two can carry it past 30; nothing carries it past 48 except an event the feed
   never sent -- a turnover, a missed shot, a rebound -- which leaves the next thing that
   side did looking like the end of a minute on the ball. Real feeds do this (one of the
   test games has 77 s with no event in it at all), so a chance or possession longer than
   this is left untimed: counted everywhere else, in no window, and out of the average. */
const LONGEST = 48;
const timedSecs = (from, to) => { const s = secs(from, to); return s <= LONGEST ? s : null; };

const DESCRIPTOR = { loc: 1, tag: 1, stype: 1 };
const FG = { p2_made: 2, p3_made: 3, p2_miss: 0, p3_miss: 0 };
const FT = { ft_made: 1, ft_miss: 0 };
const isAction = ev => (ev.t in FG || ev.t in FT || ev.t === 'to') && (ev.team === 0 || ev.team === 1);
const seqOf = ev => (ev.seq != null ? ev.seq : ev.id);
/* a shot's location is a 'loc' event pointing at it by id (situations.js, shotchart.js) */
const locKey = ev => (ev.id != null ? ev.id : ev.seq);
const secs = (fromClock, toClock) => Math.max(0, (fromClock - toClock) / 1000);

/* ---------------------------------------------------------------- compute --- */
function compute(S) {
  const P = Poss(), X = Sit();
  const empty = { chances: [], possessions: [], ok: false };
  if (!P || !X || !S || !Array.isArray(S.events)) return empty;

  const all = X.inGameOrder(S.events.filter(Boolean));
  const locs = {};
  all.forEach(ev => { if (ev.t === 'loc' && ev.ref != null) locs[ev.ref] = { x: +ev.x, y: +ev.y }; });
  const plays = all.filter(ev => !DESCRIPTOR[ev.t]);
  const E = P.enumerate({ events: plays });

  /* situations.js's rule: an action belongs to the latest chance of its own side
     that began at or before it -- which is also where an and-one's free throw lands */
  const at = new Map();
  plays.forEach((ev, i) => { const k = seqOf(ev); if (!at.has(k)) at.set(k, i); });
  const rows = E.chances.map(c => ({ c, start: at.has(c.startEventId) ? at.get(c.startEventId) : -1, acts: [] }));
  const bySide = [rows.filter(x => x.c.team === 0), rows.filter(x => x.c.team === 1)];
  const ptr = [-1, -1];
  plays.forEach((ev, i) => {
    if (!isAction(ev)) return;
    const list = bySide[ev.team];
    while (ptr[ev.team] + 1 < list.length && list[ptr[ev.team] + 1].start <= i) ptr[ev.team]++;
    const x = ptr[ev.team] >= 0 ? list[ptr[ev.team]] : null;
    if (x) x.acts.push(ev);
  });

  const possOf = {};
  E.possessions.forEach(p => { possOf[p.index] = p; });

  /* WHO WON A CHANCE'S MISS. A new chance inside the same possession can only have
     been opened by an offensive rebound; a possession that hands the ball over by a
     'dreb' ended on a defensive one. A make, a turnover or a made last free throw
     had no rebound to win, and is in neither count. */
  const sibs = {};
  E.chances.forEach(c => { (sibs[c.possession] = sibs[c.possession] || []).push(c); });
  const rebOf = {};
  E.chances.forEach(c => {
    const s = sibs[c.possession];
    if (s.indexOf(c) + 1 < s.length) { rebOf[c.index] = 'off'; return; }
    const next = possOf[c.possession + 1];
    if (next && next.team !== c.team && next.gainedBy === 'dreb') rebOf[c.index] = 'def';
  });

  const chances = [];
  rows.forEach(x => {
    if (!x.acts.length) return;                  // the clock running out: not a chance
    const c = x.c, p = possOf[c.possession];
    if (!p) return;
    const last = x.acts[x.acts.length - 1];
    /* a first chance runs from the change of possession; a second one from the
       offensive rebound that reset it */
    const gP = c.secondChance ? c.period : p.gainPeriod;
    const gC = c.secondChance ? c.startClock : p.gainClock;
    const timed = gP === last.period && typeof gC === 'number' && typeof last.clock === 'number';
    const r = {
      team: c.team, second: !!c.secondChance, possession: c.possession, index: c.index,
      gainedBy: c.secondChance ? 'oreb' : p.gainedBy,
      period: last.period, clock: last.clock, dur: timed ? timedSecs(gC, last.clock) : null,
      pts: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, tov: 0,
      reb: rebOf[c.index] || null, shots: []
    };
    x.acts.forEach(ev => {
      if (ev.t in FG) {
        const made = FG[ev.t] > 0, three = ev.t[1] === '3';
        r.fga++; if (three) r.p3a++;
        if (made) { r.fgm++; r.pts += FG[ev.t]; if (three) r.p3m++; }
        const l = locs[locKey(ev)];
        r.shots.push({ x: l ? l.x : null, y: l ? l.y : null, made, three,
                       pid: ev.pid || null, period: ev.period, clock: ev.clock, dur: r.dur });
      } else if (ev.t in FT) {
        r.fta++;
        if (FT[ev.t]) { r.ftm++; r.pts++; }
      } else if (ev.t === 'to') r.tov++;
    });
    chances.push(r);
  });

  /* A POSSESSION'S LENGTH, second chances and all: from the change of possession to
     its last action. An offensive rebound does not end a possession, so it does not
     restart this one -- that is the difference from a chance's own clock. */
  const byPoss = {};
  chances.forEach(r => { (byPoss[r.possession] = byPoss[r.possession] || []).push(r); });
  const possessions = [];
  E.possessions.forEach(p => {
    const mine = byPoss[p.index];
    if (!mine || !mine.length) return;
    const last = mine[mine.length - 1];
    const timed = p.gainPeriod === last.period && typeof p.gainClock === 'number' && typeof last.clock === 'number';
    possessions.push({ team: p.team, index: p.index, gainedBy: p.gainedBy, chances: mine.length,
                       pts: mine.reduce((n, r) => n + r.pts, 0),
                       dur: timed ? timedSecs(p.gainClock, last.clock) : null });
  });

  return { chances, possessions, ok: true };
}

/* the same log asked twice (a live page redraws on every play) is answered once */
let memo = { ref: null, len: -1, out: null };
function forGame(S) {
  const len = S && S.events ? S.events.length : 0;
  if (memo.ref !== (S && S.events) || memo.len !== len) memo = { ref: S && S.events, len, out: compute(S) };
  return memo.out;
}

/* ---------------------------------------------------------------- windows --- */
/* Inclusive at both ends, and the top of the slider has no ceiling: "8 to 16" keeps a
   chance that ended at exactly 16 s, and "17 to 24" keeps the 27-second one too. */
function inWindow(r, lo, hi) {
  if (!r || r.second || r.dur == null) return false;
  return r.dur >= lo && (hi >= MAX || r.dur <= hi);
}

/* first chances per whole second, the last bar holding everything from 24 s on */
function histogram(list) {
  const h = new Array(MAX + 1).fill(0);
  (list || []).forEach(r => { if (!r.second && r.dur != null) h[Math.min(MAX, Math.floor(r.dur))]++; });
  return h;
}

/* THE FOUR FACTORS OF A SET OF CHANCES, and what sits around them.
     ppp       points per chance
     efg       (FGM + ½·3PM) / FGA
     tovPct    turnovers per chance -- exact here, since every chance ends one way
     orebPct   of the misses somebody rebounded, the share the offence won back
     ftr       FTA / FGA, the box score's free throw rate */
function summary(list) {
  const s = { n: 0, pts: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, tov: 0,
              off: 0, def: 0, dur: 0, timed: 0, shots: [] };
  (list || []).forEach(r => {
    s.n++; s.pts += r.pts; s.fga += r.fga; s.fgm += r.fgm; s.p3a += r.p3a; s.p3m += r.p3m;
    s.fta += r.fta; s.ftm += r.ftm; s.tov += r.tov;
    if (r.reb === 'off') s.off++; else if (r.reb === 'def') s.def++;
    if (r.dur != null) { s.dur += r.dur; s.timed++; }
    r.shots.forEach(x => s.shots.push(x));
  });
  s.ppp = s.n ? s.pts / s.n : null;
  s.efg = s.fga ? (s.fgm + 0.5 * s.p3m) / s.fga : null;
  s.tovPct = s.n ? s.tov / s.n : null;
  s.orebPct = (s.off + s.def) ? s.off / (s.off + s.def) : null;
  s.ftr = s.fga ? s.fta / s.fga : null;
  s.avgDur = s.timed ? s.dur / s.timed : null;
  return s;
}

/* AVERAGE TIME OF POSSESSION for each side of one game, in seconds (null where no
   possession of that side could be timed). The full stats print it under pace. */
function averages(S) {
  const R = forGame(S);
  if (!R || !R.ok) return null;
  return [0, 1].map(t => {
    const d = R.possessions.filter(p => p.team === t && p.dur != null);
    return d.length ? d.reduce((n, p) => n + p.dur, 0) / d.length : null;
  });
}

return { compute, forGame, inWindow, histogram, summary, averages, MAX, LONGEST };
}));
