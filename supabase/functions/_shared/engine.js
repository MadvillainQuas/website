/* GENERATED from epinoia/engine.js by supabase/tests/extract-shared.mjs — do not edit. */
/* ============================================================================
   EPINOIA ENGINE — the single source of statistical truth.
   Extracted verbatim from the scorer so the scorer, the finalise function
   and the public pages can never disagree about a number.

   Pure: no DOM, no globals, no storage. One input shape, one output shape.

     import { deriveGame, teamAdv, playerAdv, lineupAgg } from './engine.js';
     const d = deriveGame(game);

   `game` is the epinoia state object:
     { teams:[{name,color,players:[{id,name,num}]}, …],
       starters:[[pid…],[pid…]], events:[…],
       period, clockMs, tipWinner, arrowInit }

   Loads as an ES module or a classic script (window.EpinoiaEngine).
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

/* ---------- constants ---------- */
/* ---------- periods ----------
   FOUR TEN-MINUTE QUARTERS, OR TWO TWENTY-MINUTE HALVES, then five-minute overtimes either way.
   FIBA and NCAA women play quarters; NCAA men play halves (docs/ncaa-readiness.md). Every clock
   sum here (minutes, stints, the transition window, the game order) is cumEl, so the format is
   one argument to it. Read in this order: the game's own `format`, the league's `rules`
   (0001: periods, period_ms, ot_ms), else the log itself -- a clock above 10:00 in the first or
   second period can only be a half (no quarter ever starts above 10:00; checked on the live
   log on 2026-10-01: not one of 1.15 million events has one). Without any of them: quarters,
   which is every game the platform held before NCAA. */
const QUARTERS = Object.freeze({ periods: 4, period_ms: 600000, ot_ms: 300000 });
const HALVES   = Object.freeze({ periods: 2, period_ms: 1200000, ot_ms: 300000 });
function fmtFrom(o) {
  if (!o || typeof o !== 'object') return null;
  const n = +o.periods, ms = +o.period_ms;
  if (!(n >= 1 && n <= 8 && ms >= 60000)) return null;
  if (n === 4 && ms === 600000 && (+o.ot_ms || 300000) === 300000) return QUARTERS;
  if (n === 2 && ms === 1200000 && (+o.ot_ms || 300000) === 300000) return HALVES;
  return { periods: n, period_ms: ms, ot_ms: +o.ot_ms > 0 ? +o.ot_ms : 300000 };
}
function halvesIn(evs) {
  if (!evs) return false;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e && (+e.period || 1) <= 2 && +e.clock > 600000) return true;
  }
  return false;
}
/* formatOf(game | rules | event list): the periods a game is played in */
function formatOf(x) {
  if (!x) return QUARTERS;
  if (Array.isArray(x)) return halvesIn(x) ? HALVES : QUARTERS;
  return fmtFrom(x.format) || fmtFrom(x.rules) || fmtFrom(x) || (halvesIn(x.events) ? HALVES : QUARTERS);
}
const PLEN = (p, f) => { f = f || QUARTERS; return p <= f.periods ? f.period_ms : f.ot_ms; };
const WIN_MS = 12000;                                   // live follow-up window
/* foul kinds that, with no player named, are the bench's: they never count toward the team fouls */
const BENCH_KINDS = new Set(['tech', 'unsport', 'disq']);
const FOULNAMES = {
  personal: 'personal', shooting: 'shooting', floor: 'on-the-floor',
  offensive: 'offensive', tech: 'technical', unsport: 'unsportsmanlike',
  disq: 'disqualifying'
};

/* ---------- formatting ---------- */
/* 'q3' / 'ot1'; 'h2' where the game is played in halves */
const perName  = (p, f) => { f = f || QUARTERS; return p <= f.periods ? (f.periods === 2 ? 'h' : 'q') + p : 'ot' + (p - f.periods); };
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMin   = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
/* elapsed ms from tip to (period, clock) — the spine of every minutes calculation */
function cumEl(p, clk, f) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q, f); return s + (PLEN(p, f) - clk); }

/* ---------------------------------------------------------------------------
   ONE ORDER, AND IT IS THE GAME'S.

   The replay below is written against game time: `close(t, cum)` measures a
   stint as cum minus where it started, lastIn holds the moment a player came
   on, the possession arrow and the second-chance / points-off-turnover /
   transition windows all compare one event's clock with the one before it.

   The scorer's own array satisfies that, because "add a missed play" splices
   at insertPos(cumEl(period, clock)). But the log does not travel in that
   order. It travels by sequence number, and a retroactively added play takes
   the HIGHEST id there is. game_events is keyed by seq, snapshot() and delta()
   both order by seq, the public page sorts by id, the broadcast layer sorts by
   seq, and finalise-game reads in seq order. So a play added at 7:41 of the
   first quarter replays, everywhere except the device it was typed on, after
   the final buzzer.

   The per-player minutes survive that, because cum is read off the event's own
   period and clock rather than its position. Everything measured BETWEEN events
   does not. close(t, cum) is reached only by a substitution, so a sub replaying
   after the buzzer closes whatever stint was open with a cum from the wrong end
   of the game: measured on a real four-period log, one stint of 3:20 was clamped
   to zero by the Math.max in close() and its minutes handed to the five that
   came after it. Plus-minus went with it -- the player coming off +3, the player
   coming on -3, both reported 0 -- along with the on-court team and opponent
   totals every on/off number is built from, and the play-by-play read in entry
   order rather than game order. The box score the statistician is looking at and
   the one the league publishes stop agreeing, with nothing to say which is
   right.

   Sorted here because this function is the one funnel: every consumer and
   finalise-game go through it. Equal clocks keep the order they arrived in --
   which is what holds a run of free throws, all stamped at the same dead ball,
   in the order they were actually shot -- so the tiebreak is the incoming
   index and never the id, which would reorder exactly those. An already
   ordered log is returned untouched, so the common case costs one pass and no
   allocation. */
function inGameOrder(evs, f) {
  const n = evs.length;
  const keys = new Array(n);
  let ordered = true;
  for (let i = 0; i < n; i++) {
    const ev = evs[i];
    keys[i] = cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1, f), f);
    if (i && keys[i] < keys[i - 1]) ordered = false;
  }
  if (ordered) return evs;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => (keys[a] - keys[b]) || (a - b));
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = evs[idx[i]];
  return out;
}

/* ---------- accumulator factories ---------- */
const mkOC  = () => ({ tFGA:0,tFGM:0,t3M:0,tFTA:0,tTOV:0,tOR:0,tDR:0,tPTS:0,
                       oFGA:0,oFGM:0,o3M:0,oFTA:0,oTOV:0,oOR:0,oDR:0,oPTS:0,
                       oRimA:0,oRimM:0 });
const mkBox = () => ({ fga:0,fgm:0,f3m:0,fta:0,tov:0,or:0,dr:0,pts:0 });
const mkP   = () => ({ pts:0,p2m:0,p2a:0,p3m:0,p3a:0,ftm:0,fta:0,or:0,dr:0,ast:0,stl:0,blk:0,
                       to:0,pf:0,fd:0,pm:0,min:0,t:0,u:0,dq:false,
                       ptsAst:0,rimA:0,rimM:0,midA:0,midM:0, paint:0,fast:0,sc:0,pot:0,
                       rbTm:0,rbTmO:0,rbSf:0,rbSfO:0, oc:mkOC() });
const mkT   = () => ({ pts:0,teamRebO:0,teamRebD:0,teamTo:0,toTot:0,foulTot:0,foulsP:{},
                       paint:0,fast:0,sc:0,pot:0,bench:0,lead:0,
                       tos:{h1:0,h2:0,last2:0,ot:{}} });

/* ---------- naming helpers (bound to a game) ---------- */
function makeNamer(game) {
  const pmap = {};
  game.teams.forEach((tm, t) => tm.players.forEach(p => { pmap[p.id] = { team: t, p }; }));
  const tname = t => game.teams[t] && game.teams[t].name ? game.teams[t].name : (t ? 'team two' : 'team one');
  const pname = pid => {
    const m = pmap[pid];
    if (!m) return 'team';
    return (m.p.num !== '' && m.p.num != null ? '#' + m.p.num + ' ' : '') + m.p.name;
  };
  return { pmap, tname, pname };
}

/* ---------- descriptor tags (toggle semantics: re-adding removes) ---------- */
function activeTags(events, id) {
  const s = new Set();
  events.forEach(ev => { if (ev.t === 'tag' && ev.ref === id) { s.has(ev.tag) ? s.delete(ev.tag) : s.add(ev.tag); } });
  return s;
}

/* ---------- play-by-play line ---------- */
function pbpLine(ev, i, tags, stypes, nm) {
  const who = ev.pid ? nm.pname(ev.pid) : (ev.team != null ? nm.tname(ev.team) : '');
  const tagTxt = tg => {
    const bits = [];
    if (stypes && stypes[i]) bits.push(stypes[i]);
    if (tg && tg.size) bits.push(...tg);
    return bits.length ? ' (' + bits.join(', ') + ')' : '';
  };
  switch (ev.t) {
    case 'ft_miss': return who + ' — free throw missed';
    case 'ft_made': return who + ' — free throw made';
    case 'p2_miss': return who + ' — 2pt missed' + tagTxt(tags[i]);
    case 'p2_made': return who + ' — 2pt made' + tagTxt(tags[i]);
    case 'p3_miss': return who + ' — 3pt missed' + tagTxt(tags[i]);
    case 'p3_made': return who + ' — 3pt made' + tagTxt(tags[i]);
    case 'reb':     return who + ' — ' + (ev.off ? 'offensive' : 'defensive') + ' rebound' + (ev.pid ? '' : ' (team)');
    case 'ast':     return who + ' — assist';
    case 'stl':     return who + ' — steal';
    case 'blk':     return who + ' — block';
    case 'to':      return who + ' — turnover' + (ev.pid ? '' : ' (team)') + (stypes && stypes[i] ? ' (' + stypes[i] + ')' : '');
    case 'foul':    return who + ' — ' + (FOULNAMES[ev.kind] || 'personal') + ' foul';
    case 'timeout': return nm.tname(ev.team) + ' — timeout';
    case 'sub':
      if (ev.in == null || ev.in === '') return nm.tname(ev.team) + ' — ' + nm.pname(ev.out) + ' leaves the court, no substitute';
      if (ev.out == null || ev.out === '') return nm.tname(ev.team) + ' — ' + nm.pname(ev.in) + ' comes on';
      return nm.tname(ev.team) + ' — sub: ' + nm.pname(ev.in) + ' in, ' + nm.pname(ev.out) + ' out';
    /* A MISSED SHOT ON WHICH THE SHOOTER WAS FOULED is not a field goal attempt (FIBA and NBA
       statistics alike): the free throws are the attempt. The scorer records the shot as it happens
       and, when the foul on the shooter follows in the same play, turns it into this - so nothing
       counts it (no FGA, no miss, no rebound chance), and the play-by-play still says what happened. */
    case 'p2_fouled': return who + ' — 2pt missed, fouled' + tagTxt(tags[i]);
    case 'p3_fouled': return who + ' — 3pt missed, fouled' + tagTxt(tags[i]);
    case 'jump':    return 'held ball — alternating possession';
    case 'period_start': return '— ' + perName(ev.period, nm.fmt) + ' —';
    case 'game_end':     return '— final —';
  }
  return null;
}

/* ============================================================================
   deriveGame — replays the event log into every derived statistic.
   Everything else in the platform is a projection of this function.
   ============================================================================ */
function deriveGame(game) {
  const F = formatOf(game);
  const nm = makeNamer(game);
  nm.fmt = F;
  const period  = game.period  != null ? game.period  : 1;
  const clockMs = game.clockMs != null ? game.clockMs : PLEN(period, F);
  const events  = inGameOrder(game.events || [], F);
  const observe = typeof game.observe === 'function' ? game.observe : null;

  const d = {
    stats: {}, team: [mkT(), mkT()], score: [0, 0], perQ: [{}, {}], pbp: [],
    poss: (game.tipWinner != null ? game.tipWinner : null),
    onCourt: [[...game.starters[0]], [...game.starters[1]]],
    lineups: [[], []], format: F
  };
  let arw = (game.arrowInit != null) ? game.arrowInit : null;   // alternating-possession arrow
  const flag = { sc: [false, false], pot: [false, false] };     // live 2nd-chance / points-off-TO windows

  /* TRANSITION, WORKED OUT RATHER THAN TAGGED.

     Second chance and points-off-turnovers have always been derived — an
     offensive rebound opens one window, a turnover opens the other — while
     fast-break points alone waited for somebody to tag the shot 'transition'
     during a live game, which is the one moment nobody has a spare hand. So
     the column read 2 in a game with twenty fast breaks in it.

     A break is a shot that arrives quickly after the ball changes hands, so
     that is what is measured: the clock at the moment possession turned over
     to this side, and any score within eight seconds of it. Eight is the usual
     cut in public play-by-play work and it matches what a viewer would call a
     break — long enough for a rebound, an outlet and two dribbles, short
     enough to exclude a set offence.

     Opened by a DEFENSIVE rebound or a steal, both of which start a break.
     Not by an offensive rebound, which is a second chance in the same
     half-court, and not by a made basket, where the other side inbounds and
     nothing about it is fast. A manual 'transition' tag still counts, so a
     scorer can mark one the clock would miss. */
  const TRANSITION_MS = 8000;
  const breakAt = [null, null];       // cumulative ms when this side got the ball running
  let lastFoulKind = null;

  game.teams.forEach(tm => tm.players.forEach(p => { d.stats[p.id] = mkP(); }));
  const lastIn = {}; game.starters.forEach(a => a.forEach(pid => { lastIn[pid] = 0; }));
  const nowCum = cumEl(period, clockMs, F);

  const cur = [
    { ids: [...d.onCourt[0]].sort(), start: 0, pf: 0, pa: 0, off: mkBox(), def: mkBox() },
    { ids: [...d.onCourt[1]].sort(), start: 0, pf: 0, pa: 0, off: mkBox(), def: mkBox() }
  ];

  /* descriptor maps must be built before the replay: isRim reads them */
  const tags = {}, stypes = {}, locs = {};
  events.forEach(ev => {
    if (ev.t === 'tag') { const s = tags[ev.ref] = tags[ev.ref] || new Set();
      s.has(ev.tag) ? s.delete(ev.tag) : s.add(ev.tag); }
    else if (ev.t === 'stype') { stypes[ev.ref] = stypes[ev.ref] === ev.v ? null : ev.v; }
    else if (ev.t === 'loc')   { locs[ev.ref] = { x: ev.x, y: ev.y }; }
  });
  d.stypes = stypes; d.locs = locs;

  /* WHAT COUNTS AS A SHOT AT THE RIM.

     Location alone answered this, which throws away the surer signal: a
     statistician who picks "dunk" has told you exactly where the shot was, and
     more reliably than a thumb landing on a court drawn two inches wide. A
     layup that was tapped slightly outside the key measured as a mid-range
     attempt, and a fadeaway taken with a heel on the paint line measured as a
     shot at the rim. Both are wrong in the direction that matters, because rim
     rate and rim accuracy are read as a claim about how a team scores.

     So the TYPE decides when it is decisive, and location fills the gaps:

       layup, dunk, tip-in, putback   at the rim, wherever the tap landed
       jump shot, fadeaway, step-back not at the rim, ditto
       floater, hook, everything else no opinion — fall through to location

     Floater and hook are deliberately left to the location. Both are taken
     anywhere from two feet to fifteen, and asserting either way would be
     inventing a fact the scorer did not give. */
  const RIM_TYPE = new Set(['layup', 'dunk', 'tip-in', 'tip in', 'putback', 'alley-oop']);
  const FAR_TYPE = new Set(['jump shot', 'jumper', 'fadeaway', 'step-back', 'stepback',
                            'pull-up', 'pullup', 'catch & shoot', 'catch and shoot']);
  /* AT THE RIM IS A PLACE, AND THE COURT ALREADY DRAWS IT. The restricted area — 125 cm around
     the ring (boxscore.js COURT.RA_R), on the same chart these markers are plotted on — is what
     "at the rim" means, rather than a rectangle covering most of the key. The pipeline that
     builds the season CSVs measures it the same way (scripts/ingest/stints.py), so a game's rim
     rate on this page and in the exports are now the same number. */
  const RIM_AT = { x: 750 / 1500, y: 157.5 / 1400, w: 1500, h: 1400, r: 125 };
  const atRim = l => {
    const dx = (l.x - RIM_AT.x) * RIM_AT.w, dy = (l.y - RIM_AT.y) * RIM_AT.h;
    return Math.sqrt(dx * dx + dy * dy) <= RIM_AT.r;
  };
  /* the key itself: 4.90 m across, 5.80 m from the baseline (COURT.KEY_HALF / KEY_LEN) */
  const inPaint = l => !!l && Math.abs(l.x * RIM_AT.w - RIM_AT.x * RIM_AT.w) <= 245 && l.y * RIM_AT.h <= 580;
  const isRim = ev => {
    const ty = (stypes[ev.id] || '').toLowerCase();
    /* a tip-in or a dunk is at the rim wherever the marker landed: the ball went in from there */
    if (ty && RIM_TYPE.has(ty)) return true;
    const l = locs[ev.id];
    /* THEN THE MARKER, AND ONLY THEN THE LABEL. This used to read the other way round, on the
       argument that a statistician choosing "dunk" has told you more than a thumb on a small
       court drawing. True of a chosen label -- and most feeds do not choose. LNB's names 90 of
       95 shots "jumpshot", layups under the basket included, so "jump shot" short-circuited
       ahead of a perfectly good coordinate and a whole league's rim rate came out at three
       attempts a game with every one of them made (reported 2026-09-18). A label that is the
       same for nearly every shot is not evidence; the place the shot was taken from is. */
    if (l) return atRim(l);
    if (ty && FAR_TYPE.has(ty)) return false;
    return !!(tags[ev.id] && tags[ev.id].has('paint'));
  };

  const st = ev => d.stats[ev.pid];

  /* credit an on-court event to everyone on the floor, both sides, and the live stint */
  const ocAdd = (team, k, v) => {
    v = v || 1;
    d.onCourt[team].forEach(id => { if (d.stats[id]) d.stats[id].oc['t' + k] += v; });
    d.onCourt[1 - team].forEach(id => { if (d.stats[id]) d.stats[id].oc['o' + k] += v; });
    const bk = { FGA:'fga', FGM:'fgm', '3M':'f3m', FTA:'fta', TOV:'tov', OR:'or', DR:'dr', PTS:'pts' }[k];
    if (bk) { cur[team].off[bk] += v; cur[1 - team].def[bk] += v; }
  };

  const close = (t, cum) => {
    const c = cur[t], dur = Math.max(0, cum - c.start);
    if (dur > 0 || c.pf || c.pa) d.lineups[t].push({ ids: c.ids, dur, pf: c.pf, pa: c.pa, off: c.off, def: c.def });
  };

  const lastMade = [0, 0];   // value of the last made FG per team, for points-assisted

  const scorePts = (ev, v) => {
    d.score[ev.team] += v; d.team[ev.team].pts += v;
    const q = d.perQ[ev.team]; q[ev.period] = (q[ev.period] || 0) + v;
    if (ev.pid && st(ev)) st(ev).pts += v;
    d.onCourt[ev.team].forEach(id => { if (d.stats[id]) d.stats[id].pm += v; });
    d.onCourt[1 - ev.team].forEach(id => { if (d.stats[id]) d.stats[id].pm -= v; });
    cur[ev.team].pf += v; cur[1 - ev.team].pa += v;
    const tg = tags[ev.id];
    /* THE SCORER IS CREDITED AS WELL AS THE SIDE: a player's own paint, transition,
       second-chance and off-turnover points, by the same rules as the team's */
    const sp = ev.pid ? st(ev) : null;
    /* POINTS IN THE PAINT, FROM THE PAINT. This read one qualifier and nothing else, and a feed
       that does not send qualifiers therefore scored none: LNB's shot actions carry a marker and
       a subType and no quals at all, so a game with fifteen made shots in the key reported 0
       paint points on both sides (reported 2026-09-18). The key is a rectangle on the same chart
       the markers are plotted on -- 4.90 m wide by 5.80 m from the baseline (COURT.KEY_HALF,
       COURT.KEY_LEN) -- so where a feed gives the place, the place answers, and the qualifier
       stays as the answer for a feed that gives only that. Two-point field goals only: a free
       throw is not a paint point and a three cannot be one. */
    if (tg && tg.has('paint')) { d.team[ev.team].paint += v; if (sp) sp.paint += v; }
    else if (ev.t === 'p2_made' && inPaint(locs[ev.id])) { d.team[ev.team].paint += v; if (sp) sp.paint += v; }
    /* tagged by hand, or inside the window a change of possession opened */
    const gotItAt = breakAt[ev.team];
    const quick = gotItAt != null &&
      (cumEl(ev.period, ev.clock, F) - gotItAt) <= TRANSITION_MS;
    if ((tg && tg.has('transition')) || quick) { d.team[ev.team].fast += v; if (sp) sp.fast += v; }
    if (flag.sc[ev.team])  { d.team[ev.team].sc  += v; if (sp) sp.sc  += v; }
    if (flag.pot[ev.team]) { d.team[ev.team].pot += v; if (sp) sp.pot += v; }
    if (ev.pid && !game.starters[ev.team].includes(ev.pid)) d.team[ev.team].bench += v;
    const lead = d.score[ev.team] - d.score[1 - ev.team];
    if (lead > d.team[ev.team].lead) d.team[ev.team].lead = lead;
  };

  /* LINKED EVENTS: a rebound is the result of the miss before it. Same rule as situations.js
     reboundOutcomes(): the first rebound after a missed field goal, before any other FG / FT /
     turnover / period event. rbTm / rbTmO: rebound-resolved misses by teammates while he was on
     the floor, and how many he took off the offensive glass. rbSf / rbSfO: the same for his own. */
  let pendMiss = null;   // { pid, team, ids: shooter-side on-court ids at the miss }
  const oRim = ev => {
    if (!isRim(ev)) return;
    d.onCourt[1 - ev.team].forEach(id => { if (d.stats[id]) {
      d.stats[id].oc.oRimA++; if (ev.t === 'p2_made') d.stats[id].oc.oRimM++; } });
  };
  const missOf = ev => { pendMiss = { pid: ev.pid || null, team: ev.team, ids: [...d.onCourt[ev.team]] }; };
  const resolveMiss = ev => {
    const m = pendMiss; pendMiss = null;
    if (!m) return;
    m.ids.forEach(id => { if (!d.stats[id]) return; if (id === m.pid) d.stats[id].rbSf++; else d.stats[id].rbTm++; });
    if (ev.pid && ev.off && ev.team === m.team && d.stats[ev.pid]) {
      if (ev.pid === m.pid) d.stats[ev.pid].rbSfO++;
      else if (m.ids.includes(ev.pid)) d.stats[ev.pid].rbTmO++;
    }
  };

  events.forEach(ev => {
    const cum = cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1, F), F);

    if (ev.t === 'reb') resolveMiss(ev);
    else if (ev.t in { p2_made:1, p3_made:1, p2_miss:1, p3_miss:1, ft_made:1, ft_miss:1, to:1 } ||
             /^(period_|end_|game_)/.test(ev.t)) pendMiss = null;

    switch (ev.t) {
      case 'ft_miss': if (st(ev)) st(ev).fta++; ocAdd(ev.team, 'FTA'); break;
      case 'ft_made': if (st(ev)) { st(ev).fta++; st(ev).ftm++; }
        ocAdd(ev.team, 'FTA'); ocAdd(ev.team, 'PTS', 1); scorePts(ev, 1); break;
      case 'p2_miss': if (st(ev)) { st(ev).p2a++; if (isRim(ev)) st(ev).rimA++; else st(ev).midA++; }
        ocAdd(ev.team, 'FGA'); oRim(ev); missOf(ev); break;
      case 'p2_made': if (st(ev)) { st(ev).p2a++; st(ev).p2m++;
          if (isRim(ev)) { st(ev).rimA++; st(ev).rimM++; } else { st(ev).midA++; st(ev).midM++; } }
        ocAdd(ev.team, 'FGA'); ocAdd(ev.team, 'FGM'); ocAdd(ev.team, 'PTS', 2); oRim(ev);
        lastMade[ev.team] = 2; scorePts(ev, 2); break;
      case 'p3_miss': if (st(ev)) st(ev).p3a++; ocAdd(ev.team, 'FGA'); missOf(ev); break;
      case 'p3_made': if (st(ev)) { st(ev).p3a++; st(ev).p3m++; }
        ocAdd(ev.team, 'FGA'); ocAdd(ev.team, 'FGM'); ocAdd(ev.team, '3M'); ocAdd(ev.team, 'PTS', 3);
        lastMade[ev.team] = 3; scorePts(ev, 3); break;
      case 'reb':
        if (ev.pid && st(ev)) { ev.off ? st(ev).or++ : st(ev).dr++; }
        else { ev.off ? d.team[ev.team].teamRebO++ : d.team[ev.team].teamRebD++; }
        ocAdd(ev.team, ev.off ? 'OR' : 'DR'); break;
      case 'ast': if (st(ev)) { st(ev).ast++; st(ev).ptsAst += lastMade[ev.team] || 2; } break;
      case 'stl': if (st(ev)) st(ev).stl++; break;
      case 'blk': if (st(ev)) st(ev).blk++; break;
      case 'to':
        if (ev.pid && st(ev)) st(ev).to++; else d.team[ev.team].teamTo++;
        d.team[ev.team].toTot++; ocAdd(ev.team, 'TOV'); break;
      case 'foul': {
        const s = ev.pid ? st(ev) : null;
        if (s) {
          s.pf++;
          if (ev.kind === 'tech') s.t++;
          if (ev.kind === 'unsport') s.u++;
          /* FIBA disqualification: a DQ foul, or any two techs / unsportsmanlikes */
          if (ev.kind === 'disq' || s.t + s.u >= 2) s.dq = true;
        }
        if (ev.drawn && d.stats[ev.drawn]) d.stats[ev.drawn].fd++;
        d.team[ev.team].foulTot++;
        /* FIBA team fouls (Art. 41.1.1): a foul committed BY A PLAYER, of any kind, technicals included; overtime
           continues the last regular period (the fourth quarter, or the second half in halves: NCAA's fouls run per
           half and on into overtime). A foul on the bench - a coach's or a substitute's technical, unsportsmanlike or
           disqualifying foul, recorded against the team with nobody on court named - is not one. A team personal
           foul with no player named (the statistician did not see who) still is. */
        if (ev.pid || !BENCH_KINDS.has(ev.kind)) {
          const m = d.team[ev.team].foulsP, key = ev.period > F.periods ? F.periods : ev.period;
          m[key] = (m[key] || 0) + 1;
        }
        break;
      }
      case 'period_start': if (ev.period > 1 && arw != null) { d.poss = arw; arw = 1 - arw; } break;
      case 'jump':         if (arw != null) { d.poss = arw; arw = 1 - arw; } break;
      case 'timeout': {
        const T = d.team[ev.team].tos;
        const half = F.periods / 2;      // 2 of 4 quarters, 1 of 2 halves
        if (ev.period <= half) T.h1++;
        else if (ev.period <= F.periods) { T.h2++; if (ev.period === F.periods && ev.clock <= 120000) T.last2++; }
        else T.ot[ev.period] = (T.ot[ev.period] || 0) + 1;
        break;
      }
      case 'sub': {
        const t = ev.team;
        /* SOMEBODY SENT ON WHO IS ALREADY ON keeps the stint he is in. A change logged twice, or
           a correction restating one at a later clock, restarted his minutes at the repeat and
           lost everything since his real entry (seven SLB games in 160, up to ten minutes). */
        const hasIn = ev.in != null && ev.in !== '', hasOut = ev.out != null && ev.out !== '';
        const already = hasIn && ev.in !== ev.out && d.onCourt[t].includes(ev.in);
        if (hasOut && lastIn[ev.out] != null && d.stats[ev.out]) {
          d.stats[ev.out].min += Math.max(0, cum - lastIn[ev.out]); delete lastIn[ev.out];
        }
        /* A CHANGE WITH ONE SIDE EMPTY. A team with nobody left to send on plays short: the player
           fouled out (or injured) leaves and nobody replaces him - {out, in:null}. And a team that
           was short gets a player back - {out:null, in}. Neither is a substitution in the FIBA sense,
           and both are what happened, so the five on court is what the log says it is. */
        if (hasIn && !already) lastIn[ev.in] = cum;
        close(t, cum);
        if (hasOut) d.onCourt[t] = d.onCourt[t].filter(x => x !== ev.out);
        if (hasIn && !d.onCourt[t].includes(ev.in)) d.onCourt[t].push(ev.in);
        cur[t] = { ids: [...d.onCourt[t]].sort(), start: cum, pf: 0, pa: 0, off: mkBox(), def: mkBox() };
        break;
      }
    }

    /* possession heuristic + second-chance / points-off-turnover windows */
    switch (ev.t) {
      case 'p2_made': case 'p3_made':
        d.poss = 1 - ev.team; flag.sc[ev.team] = false; flag.pot[ev.team] = false; break;
      case 'ft_made':
        /* FIBA: unsportsmanlike / DQ free throws keep the ball with the shooting team */
        d.poss = (lastFoulKind === 'unsport' || lastFoulKind === 'disq') ? ev.team : 1 - ev.team;
        flag.sc[ev.team] = false; flag.pot[ev.team] = false; break;
      case 'ft_miss':
        d.poss = (lastFoulKind === 'unsport' || lastFoulKind === 'disq') ? ev.team : null; break;
      case 'p2_miss': case 'p3_miss': d.poss = null; break;
      case 'reb':
        d.poss = ev.team;
        if (ev.off) flag.sc[ev.team] = true;
        else {
          flag.sc = [false, false]; flag.pot = [false, false];
          breakAt[ev.team] = cumEl(ev.period, ev.clock, F);
        }
        break;
      case 'stl':
        d.poss = ev.team;
        breakAt[ev.team] = cumEl(ev.period, ev.clock, F);
        break;
      case 'to':
        d.poss = 1 - ev.team;
        flag.sc[ev.team] = false; flag.pot[ev.team] = false;
        flag.sc[1 - ev.team] = false; flag.pot[1 - ev.team] = true; break;
      case 'foul': lastFoulKind = ev.kind || 'personal'; break;
      case 'period_start':
        flag.sc = [false, false]; flag.pot = [false, false];
        breakAt[0] = breakAt[1] = null; break;
    }

    const line = pbpLine(ev, ev.id, tags, stypes, nm);
    if (line) d.pbp.push({ period: ev.period, clock: ev.clock, team: ev.team, txt: line,
                           s: [d.score[0], d.score[1]], id: ev.id });

    /* AN OBSERVER, OPTIONAL AND READ-ONLY: told of every event once the replay has applied it, with
       both fives as they now stand (d.onCourt) and the game time it happened at. Nothing here reads
       what it returns, so no number above can change. The WOWY page's event layer (lineupevents.js)
       uses it to hand each play to the two fives on the floor, with the stints' own boundaries. */
    if (observe) observe(ev, d, cum);
  });

  for (const pid in lastIn) { if (d.stats[pid]) d.stats[pid].min += Math.max(0, nowCum - lastIn[pid]); }
  close(0, nowCum); close(1, nowCum);
  d.arrow = arw;
  return d;
}

/* ============================================================================
   Team aggregates
   ============================================================================ */
function teamTotals(game, d, t) {
  const T = d.team[t];
  const P = game.teams[t].players.map(p => d.stats[p.id]);
  const s = k => P.reduce((a, x) => a + x[k], 0);
  const F = (d && d.format) || formatOf(game);
  const period  = game.period  != null ? game.period  : 1;
  const clockMs = game.clockMs != null ? game.clockMs : PLEN(period, F);
  const o = {
    pts: T.pts, fgm: s('p2m') + s('p3m'), fga: s('p2a') + s('p3a'),
    fg3m: s('p3m'), fg3a: s('p3a'), fg2m: s('p2m'), fg2a: s('p2a'),
    ftm: s('ftm'), fta: s('fta'),
    oreb: s('or') + T.teamRebO, dreb: s('dr') + T.teamRebD,
    ast: s('ast'), stl: s('stl'), blk: s('blk'), tov: T.toTot,
    rimA: s('rimA'), rimM: s('rimM'), midA: s('midA'), midM: s('midM'), ptsAst: s('ptsAst'),
    minutes: cumEl(period, clockMs, F) / 60000 * 5
  };
  o.possessions = 0.96 * (o.fga + o.tov + 0.44 * o.fta - o.oreb);
  o.tsa = o.fga + 0.44 * o.fta;
  return o;
}

function teamAdv(game, d, t) {
  const T = teamTotals(game, d, t), O = teamTotals(game, d, 1 - t);
  const dv = (a, b) => (b ? a / b : 0);
  return Object.assign(T, {
    ortg: dv(T.pts, T.possessions) * 100, drtg: dv(O.pts, O.possessions) * 100,
    ppp: dv(T.pts, T.possessions),
    efg: dv(T.fgm + 0.5 * T.fg3m, T.fga) * 100,
    ts: dv(T.pts, 2 * T.tsa) * 100,
    tovp: dv(T.tov, T.fga + 0.44 * T.fta + T.tov) * 100,
    orebp: dv(T.oreb, T.oreb + O.dreb) * 100,
    drebp: dv(T.dreb, T.dreb + O.oreb) * 100,
    ftr: dv(T.fta, T.fga) * 100, ftp: dv(T.ftm, T.fta) * 100,
    astp: dv(T.ast, T.fgm) * 100, astTo: T.tov ? T.ast / T.tov : T.ast,
    stlp: dv(T.stl, O.possessions) * 100,
    blkp: dv(T.blk, O.fga - O.fg3a) * 100,
    rimp: dv(T.rimM, T.rimA) * 100, rimr: dv(T.rimA, T.fga) * 100,
    midp: dv(T.midM, T.midA) * 100,
    p3p: dv(T.fg3m, T.fg3a) * 100, p3r: dv(T.fg3a, T.fga) * 100,
    astPtsP: dv(T.ptsAst, T.pts - T.ftm) * 100,
    tsaPer100: dv(T.tsa, T.possessions) * 100,
    // game pace (both teams' possessions averaged, per 40 min of game clock) and
    // this team's own possessions per 40, which can differ by a possession or two
    pace: dv(T.possessions + O.possessions, 2) / Math.max(1, T.minutes / 5) * 40,
    paceOwn: T.possessions / Math.max(1, T.minutes / 5) * 40
  });
}

/* ============================================================================
   Player advanced line (per-minute rate stats + on-court splits)
   ============================================================================ */
function playerAdv(game, d, t, p, TT, OT) {
  const s = d.stats[p.id], mins = s.min / 60000;
  const dv = (a, b) => (b ? a / b : 0);
  const fga = s.p2a + s.p3a, fgm = s.p2m + s.p3m;
  const gameMinutes = Math.max(1, TT.minutes / 5);
  const pPoss = fga + 0.44 * s.fta + s.to;
  const teamPoss = TT.fga + 0.44 * TT.fta + TT.tov;
  const usg = mins ? 100 * (pPoss * gameMinutes) / (mins * teamPoss || 1) : 0;
  const estTeamFgm = (mins / gameMinutes) * TT.fgm;
  const astPct = Math.max(0, estTeamFgm - fgm) > 0 ? 100 * s.ast / (estTeamFgm - fgm) : 0;
  const oppPoss = OT.fga + 0.44 * OT.fta - OT.oreb + OT.tov;
  const oc = s.oc;
  const ocPoss    = 0.96 * (oc.tFGA + oc.tTOV + 0.44 * oc.tFTA - oc.tOR);
  const ocOppPoss = 0.96 * (oc.oFGA + oc.oTOV + 0.44 * oc.oFTA - oc.oOR);
  // pace on the floor / off it (both teams' possessions per 40 — the game-pace definition);
  // off = the game's possessions and minutes less the player's; overtime is in TT.minutes
  const ocPossAvg = (ocPoss + ocOppPoss) / 2;
  const gamePossAvg = ((TT.possessions || 0) + (OT.possessions || 0)) / 2;
  const paceOn = mins > 0 ? ocPossAvg / mins * 40 : 0;
  const offMin = Math.max(0, gameMinutes - mins);
  const paceOff = offMin > 1 ? Math.max(0, gamePossAvg - ocPossAvg) / offMin * 40 : 0;
  const pacePM = (paceOn > 0 && paceOff > 0) ? paceOn - paceOff : 0;

  const r = {
    paceOn, paceOff, pacePM,
    id: p.id, num: p.num, name: p.name, min: mins, minTxt: fmtMin(s.min),
    fgm, ast: s.ast, pts: s.pts, ptsAst: s.ptsAst, tpc: s.pts + s.ptsAst,
    ppp: dv(s.pts, pPoss), usg, astPct,
    rimA: s.rimA, rimP: dv(s.rimM, s.rimA) * 100,
    midA: s.midA, midP: dv(s.midM, s.midA) * 100,
    p3a: s.p3a, p3P: dv(s.p3m, s.p3a) * 100,
    ocOrtg: dv(oc.tPTS, ocPoss) * 100,
    ocEfg: dv(oc.tFGM + 0.5 * oc.t3M, oc.tFGA) * 100,
    ocOreb: dv(oc.tOR, oc.tOR + oc.oDR) * 100,
    ocTov: dv(oc.tTOV, oc.tFGA + 0.44 * oc.tFTA + oc.tTOV) * 100,
    ocDrtg: dv(oc.oPTS, ocOppPoss) * 100,
    ocOppEfg: dv(oc.oFGM + 0.5 * oc.o3M, oc.oFGA) * 100,
    ocOppOreb: dv(oc.oOR, oc.oOR + oc.tDR) * 100,
    ocTovF: dv(oc.oTOV, oc.oFGA + 0.44 * oc.oFTA + oc.oTOV) * 100,
    ts: dv(s.pts, 2 * (fga + 0.44 * s.fta)) * 100,
    tovP: dv(s.to, fga + 0.44 * s.fta + s.to) * 100,
    stlP: mins ? 100 * (s.stl * gameMinutes) / (mins * oppPoss || 1) : 0,
    blkP: mins ? 100 * (s.blk * gameMinutes) / (mins * (OT.fga - OT.fg3a) || 1) : 0,
    ftr: dv(s.fta, fga) * 100,
    orebP: mins ? 100 * (s.or * gameMinutes) / (mins * (TT.oreb + OT.dreb) || 1) : 0,
    drebP: mins ? 100 * (s.dr * gameMinutes) / (mins * (TT.dreb + OT.oreb) || 1) : 0,
    pm: s.pm
  };
  r.au = r.usg ? r.astPct / r.usg : 0;
  r.net = r.ocOrtg - r.ocDrtg;
  return r;
}

/* ============================================================================
   Five-man lineups
   ============================================================================ */
function lineupAgg(d, t) {
  const agg = {};
  d.lineups[t].forEach(l => {
    const k = l.ids.join(',');
    const a = agg[k] = agg[k] || { ids: l.ids, dur: 0, pf: 0, pa: 0, off: mkBox(), def: mkBox() };
    a.dur += l.dur; a.pf += l.pf; a.pa += l.pa;
    for (const kk in l.off) { a.off[kk] += l.off[kk]; a.def[kk] += l.def[kk]; }
  });
  return Object.values(agg).sort((a, b) => b.dur - a.dur).map(l => {
    const o = l.off, D = l.def, dv = (a, b) => (b ? a / b : 0);
    const poss  = 0.96 * (o.fga + o.tov + 0.44 * o.fta - o.or);
    const dposs = 0.96 * (D.fga + D.tov + 0.44 * D.fta - D.or);
    l.poss = poss; l.dposs = dposs;
    l.ortg = dv(o.pts, poss) * 100;
    l.efg  = dv(o.fgm + 0.5 * o.f3m, o.fga) * 100;
    l.tovp = dv(o.tov, o.fga + 0.44 * o.fta + o.tov) * 100;
    l.orebp = dv(o.or, o.or + D.dr) * 100;
    l.ftr  = dv(o.fta, o.fga) * 100;
    l.drtg = dv(D.pts, dposs) * 100;
    l.oefg = dv(D.fgm + 0.5 * D.f3m, D.fga) * 100;
    l.tovf = dv(D.tov, D.fga + 0.44 * D.fta + D.tov) * 100;
    l.oreba = dv(D.or, D.or + o.dr) * 100;
    l.oftr = dv(D.fta, D.fga) * 100;
    l.net = l.ortg - l.drtg;
    l.pm  = l.pf - l.pa;
    return l;
  });
}

/* ---------- FIBA state helpers ---------- */
function timeoutsLeft(game, d, t) {
  const T = d.team[t].tos, period = game.period, clockMs = game.clockMs;
  /* FIBA's allowance (2 / 3 / 1). A game in halves is played to other rules (NCAA: a count per
     game, media timeouts besides), which no feed states: unknown, not a FIBA number */
  if (((d && d.format) || formatOf(game)).periods !== 4) return null;
  if (period <= 2) return Math.max(0, 2 - T.h1);
  if (period <= 4) {
    let left = 3 - T.h2;
    if (period === 4 && clockMs <= 120000) left = Math.min(left, 2 - T.last2);
    return Math.max(0, left);
  }
  return Math.max(0, 1 - (T.ot[period] || 0));
}
const teamFoulsNow = (game, d, t) => {
  const n = ((d && d.format) || formatOf(game)).periods;
  return d.team[t].foulsP[game.period > n ? n : game.period] || 0;
};

/* ---------- convenience: everything a page needs in one call ---------- */
function fullGame(game) {
  const d = deriveGame(game);
  const TA = [teamAdv(game, d, 0), teamAdv(game, d, 1)];
  const players = [0, 1].map(t =>
    game.teams[t].players.map(p => playerAdv(game, d, t, p, TA[t], TA[1 - t])));
  const lineups = [lineupAgg(d, 0), lineupAgg(d, 1)];
  return { d, teamAdv: TA, players, lineups };
}

return {
  PLEN, WIN_MS, FOULNAMES, QUARTERS, HALVES, formatOf,
  perName, fmtClock, fmtMin, cumEl,
  mkP, mkT, mkOC, mkBox,
  makeNamer, activeTags, pbpLine,
  deriveGame, teamTotals, teamAdv, playerAdv, lineupAgg,
  timeoutsLeft, teamFoulsNow, fullGame,
  VERSION: '1.0.0'
};
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaEngine;
export const { PLEN, WIN_MS, FOULNAMES, QUARTERS, HALVES, formatOf, perName, fmtClock, fmtMin, cumEl, mkP, mkT, mkOC, mkBox, makeNamer, activeTags, pbpLine, deriveGame, teamTotals, teamAdv, playerAdv, lineupAgg, timeoutsLeft, teamFoulsNow, fullGame, VERSION } = __api;
export default __api;
