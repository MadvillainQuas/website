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
const PLEN = p => (p <= 4 ? 600000 : 300000);          // 10-min quarters, 5-min OT
const WIN_MS = 12000;                                   // live follow-up window
const FOULNAMES = {
  personal: 'personal', shooting: 'shooting', floor: 'on-the-floor',
  offensive: 'offensive', tech: 'technical', unsport: 'unsportsmanlike',
  disq: 'disqualifying'
};

/* ---------- formatting ---------- */
const perName  = p => (p <= 4 ? 'q' + p : 'ot' + (p - 4));
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMin   = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
/* elapsed ms from tip to (period, clock) — the spine of every minutes calculation */
function cumEl(p, clk) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); }

/* ---------- accumulator factories ---------- */
const mkOC  = () => ({ tFGA:0,tFGM:0,t3M:0,tFTA:0,tTOV:0,tOR:0,tDR:0,tPTS:0,
                       oFGA:0,oFGM:0,o3M:0,oFTA:0,oTOV:0,oOR:0,oDR:0,oPTS:0 });
const mkBox = () => ({ fga:0,fgm:0,f3m:0,fta:0,tov:0,or:0,dr:0,pts:0 });
const mkP   = () => ({ pts:0,p2m:0,p2a:0,p3m:0,p3a:0,ftm:0,fta:0,or:0,dr:0,ast:0,stl:0,blk:0,
                       to:0,pf:0,fd:0,pm:0,min:0,t:0,u:0,dq:false,
                       ptsAst:0,rimA:0,rimM:0,midA:0,midM:0, oc:mkOC() });
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
    case 'sub':     return nm.tname(ev.team) + ' — sub: ' + nm.pname(ev.in) + ' in, ' + nm.pname(ev.out) + ' out';
    case 'jump':    return 'held ball — alternating possession';
    case 'period_start': return '— ' + perName(ev.period) + ' —';
    case 'game_end':     return '— final —';
  }
  return null;
}

/* ============================================================================
   deriveGame — replays the event log into every derived statistic.
   Everything else in the platform is a projection of this function.
   ============================================================================ */
function deriveGame(game) {
  const nm = makeNamer(game);
  const period  = game.period  != null ? game.period  : 1;
  const clockMs = game.clockMs != null ? game.clockMs : PLEN(period);
  const events  = game.events || [];

  const d = {
    stats: {}, team: [mkT(), mkT()], score: [0, 0], perQ: [{}, {}], pbp: [],
    poss: (game.tipWinner != null ? game.tipWinner : null),
    onCourt: [[...game.starters[0]], [...game.starters[1]]],
    lineups: [[], []]
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
  const nowCum = cumEl(period, clockMs);

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
  const isRim = ev => {
    const ty = (stypes[ev.id] || '').toLowerCase();
    if (ty && RIM_TYPE.has(ty)) return true;
    if (ty && FAR_TYPE.has(ty)) return false;
    const l = locs[ev.id];
    return (l && l.x > 0.33 && l.x < 0.67 && l.y < 0.42) || (tags[ev.id] && tags[ev.id].has('paint'));
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
    if (tg && tg.has('paint')) d.team[ev.team].paint += v;
    /* tagged by hand, or inside the window a change of possession opened */
    const gotItAt = breakAt[ev.team];
    const quick = gotItAt != null &&
      (cumEl(ev.period, ev.clock) - gotItAt) <= TRANSITION_MS;
    if ((tg && tg.has('transition')) || quick) d.team[ev.team].fast += v;
    if (flag.sc[ev.team])  d.team[ev.team].sc  += v;
    if (flag.pot[ev.team]) d.team[ev.team].pot += v;
    if (ev.pid && !game.starters[ev.team].includes(ev.pid)) d.team[ev.team].bench += v;
    const lead = d.score[ev.team] - d.score[1 - ev.team];
    if (lead > d.team[ev.team].lead) d.team[ev.team].lead = lead;
  };

  events.forEach(ev => {
    const cum = cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1));

    switch (ev.t) {
      case 'ft_miss': if (st(ev)) st(ev).fta++; ocAdd(ev.team, 'FTA'); break;
      case 'ft_made': if (st(ev)) { st(ev).fta++; st(ev).ftm++; }
        ocAdd(ev.team, 'FTA'); ocAdd(ev.team, 'PTS', 1); scorePts(ev, 1); break;
      case 'p2_miss': if (st(ev)) { st(ev).p2a++; if (isRim(ev)) st(ev).rimA++; else st(ev).midA++; }
        ocAdd(ev.team, 'FGA'); break;
      case 'p2_made': if (st(ev)) { st(ev).p2a++; st(ev).p2m++;
          if (isRim(ev)) { st(ev).rimA++; st(ev).rimM++; } else { st(ev).midA++; st(ev).midM++; } }
        ocAdd(ev.team, 'FGA'); ocAdd(ev.team, 'FGM'); ocAdd(ev.team, 'PTS', 2);
        lastMade[ev.team] = 2; scorePts(ev, 2); break;
      case 'p3_miss': if (st(ev)) st(ev).p3a++; ocAdd(ev.team, 'FGA'); break;
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
        /* FIBA team fouls: bench technicals excluded, player techs count, OT continues Q4 */
        if (!(ev.kind === 'tech' && !ev.pid)) {
          const m = d.team[ev.team].foulsP, key = ev.period > 4 ? 4 : ev.period;
          m[key] = (m[key] || 0) + 1;
        }
        break;
      }
      case 'period_start': if (ev.period > 1 && arw != null) { d.poss = arw; arw = 1 - arw; } break;
      case 'jump':         if (arw != null) { d.poss = arw; arw = 1 - arw; } break;
      case 'timeout': {
        const T = d.team[ev.team].tos;
        if (ev.period <= 2) T.h1++;
        else if (ev.period <= 4) { T.h2++; if (ev.period === 4 && ev.clock <= 120000) T.last2++; }
        else T.ot[ev.period] = (T.ot[ev.period] || 0) + 1;
        break;
      }
      case 'sub': {
        const t = ev.team;
        if (lastIn[ev.out] != null && d.stats[ev.out]) {
          d.stats[ev.out].min += Math.max(0, cum - lastIn[ev.out]); delete lastIn[ev.out];
        }
        lastIn[ev.in] = cum;
        close(t, cum);
        d.onCourt[t] = d.onCourt[t].filter(x => x !== ev.out);
        if (!d.onCourt[t].includes(ev.in)) d.onCourt[t].push(ev.in);
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
          breakAt[ev.team] = cumEl(ev.period, ev.clock);
        }
        break;
      case 'stl':
        d.poss = ev.team;
        breakAt[ev.team] = cumEl(ev.period, ev.clock);
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
  const period  = game.period  != null ? game.period  : 1;
  const clockMs = game.clockMs != null ? game.clockMs : PLEN(period);
  const o = {
    pts: T.pts, fgm: s('p2m') + s('p3m'), fga: s('p2a') + s('p3a'),
    fg3m: s('p3m'), fg3a: s('p3a'), fg2m: s('p2m'), fg2a: s('p2a'),
    ftm: s('ftm'), fta: s('fta'),
    oreb: s('or') + T.teamRebO, dreb: s('dr') + T.teamRebD,
    ast: s('ast'), stl: s('stl'), blk: s('blk'), tov: T.toTot,
    rimA: s('rimA'), rimM: s('rimM'), midA: s('midA'), midM: s('midM'), ptsAst: s('ptsAst'),
    minutes: cumEl(period, clockMs) / 60000 * 5
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
  if (period <= 2) return Math.max(0, 2 - T.h1);
  if (period <= 4) {
    let left = 3 - T.h2;
    if (period === 4 && clockMs <= 120000) left = Math.min(left, 2 - T.last2);
    return Math.max(0, left);
  }
  return Math.max(0, 1 - (T.ot[period] || 0));
}
const teamFoulsNow = (game, d, t) => d.team[t].foulsP[game.period > 4 ? 4 : game.period] || 0;

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
  PLEN, WIN_MS, FOULNAMES,
  perName, fmtClock, fmtMin, cumEl,
  mkP, mkT, mkOC, mkBox,
  makeNamer, activeTags, pbpLine,
  deriveGame, teamTotals, teamAdv, playerAdv, lineupAgg,
  timeoutsLeft, teamFoulsNow, fullGame,
  VERSION: '1.0.0'
};
}));
