'use strict';
/* ============================================================================
   SITUATIONS — what second chances, breaks, turnovers and timeouts turned into.

   One calculator, four readers: the game page's EVENTS tab, finalise-game
   (which stores a compact copy on every player and team stats row), the
   backfill that puts the same copy on games finalised before it existed, and
   through those stored rows the season tables and both profiles.

     second chance   the engine's window: opened by the side's own offensive
                     rebound, shut by its basket, a made free throw, its
                     turnover, a defensive rebound or a new period
     transition      the engine's rule: tagged 'transition', or within eight
                     seconds of a defensive rebound or a steal
     off turnovers   the engine's window: opened by the other side's turnover
     after timeout   the first play after a timeout, to the end of that
                     possession (so a putback off the set counts)
     half court      a chance that was none of the four

   THE FIRST THREE ARE THE BOX SCORE'S NUMBERS TO THE POINT. Each shot, free
   throw and turnover is stamped with the window state deriveGame holds at that
   moment, by a walk that copies deriveGame's own flag rules rather than a second
   opinion of what a second chance is. supabase/tests/events.test.mjs holds that
   equal on real games, for the side AND for every player (the engine credits
   the scorer too). The consequence worth knowing: the engine shuts a window on
   the FIRST made free throw of a trip, so the second free throw is not in it.

   A CHANCE is epinoia/possessions.js's: a trip down the floor that ends in a
   shot, a turnover or a trip to the line; an offensive rebound starts a new one.
   Points per chance divides a situation's points by the chances whose first
   action (shot, free throw or turnover) was in it. After-timeout plays are
   counted per possession, because the question asked of them is what the set
   produced, second chances included.

   A PLAYER'S LINE follows the same rules as the side's: every action that goes
   into a situation's bucket goes into its player's bucket too, so a player's
   second-chance points are the engine's own sc for that player. Shots without a
   player (an unmatched feed number) count for the side only.

   ASSISTED OR NOT is a property of a MADE basket. A miss cannot be assisted, so
   there is no "assisted eFG%": what is kept is where each side's assisted and
   unassisted baskets came from, beside the attempts from each zone, which is
   the context an efficiency number needs.

   REBOUNDS OFF EACH ZONE'S MISSES: every missed field goal is followed by the first rebound that comes before
   anything else happens to the ball, and the zone it was shot from keeps whose it was -- the shooter's own
   offensive rebound, or the other side's defensive one. Every side's zone cells carry them (o and d beside a and m),
   in each situation, and reboundZones() gives them for a whole log, which is what a season's profile adds up.

   Needs epinoia/possessions.js loaded first (a global in the browser and in the
   Edge Function, a module in node). Without it every chance-based number comes
   out zero, so compute() reports that rather than guessing.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSituations = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* possessions.js: a global on a page and in Deno, a module in node */
const Poss = () => root.EpinoiaPossessions ||
  (typeof require === 'function' ? require('./possessions.js') : null);

const PLEN = p => (p <= 4 ? 600000 : 300000);
/* engine.js's cumEl, unguarded like it: a play with no clock compares as NaN there too */
function cumEl(p, clk) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); }
/* engine.js's inGameOrder: by game time, ties in log order */
function inGameOrder(evs) {
  const keyed = evs.map((ev, i) => ({ ev, i, k: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1)) }));
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return keyed.map(x => x.ev);
}

const DESCRIPTOR = { loc: 1, tag: 1, stype: 1 };
const FG = { p2_made: 2, p3_made: 3, p2_miss: 0, p3_miss: 0 };
const FT = { ft_made: 1, ft_miss: 0 };
const TRANSITION_MS = 8000;          // engine.js TRANSITION_MS

/* engine.js isRim: the shot TYPE decides when it is decisive, location fills the gaps */
const RIM_TYPE = new Set(['layup', 'dunk', 'tip-in', 'tip in', 'putback', 'alley-oop']);
const FAR_TYPE = new Set(['jump shot', 'jumper', 'fadeaway', 'step-back', 'stepback',
                          'pull-up', 'pullup', 'catch & shoot', 'catch and shoot']);

/* the situations, in the order every reader shows them */
const KEYS = ['all', 'second', 'transition', 'offTo', 'ato', 'half'];
const STAMPED = ['second', 'transition', 'offTo'];

/* ---------------------------------------------------------------------------
   THE STORED LINE. A situation is kept as a fixed-order array of counts, not an
   object, because it rides on every player and team stats row and the season
   pages pull every row of a competition: twelve numbers in an array are a
   quarter of the bytes of the same twelve with their names. The order is this
   list and nothing else; epinoia/season.js reads it by the same list (a test
   holds the two equal). `ch` (chances; possessions for after-timeout) is kept
   for a side only. Rates are never stored: they are worked out from the summed
   counts, per the rule at the top of season.js.
   --------------------------------------------------------------------------- */
const FIELDS = ['pts', 'fgm', 'fga', 'p3m', 'p3a', 'rimM', 'rimA', 'midM', 'midA', 'ftm', 'fta', 'tov', 'ch'];
const AFIELDS = ['fgm', 'pts', 'p3m', 'rimM', 'midM'];
const VERSION = 1;

/* ---------------------------------------------------------------- compute --- */
/* a zone's shooting, and what became of its misses: o = the side's own offensive rebounds off them, d = the
   other side's defensive rebounds off them; what is left of a zone's misses (a foul and free throws, a turnover,
   the period ending, a feed that logged no rebound) is neither */
const zoneCell = () => ({ a: 0, m: 0, o: 0, d: 0 });
function bucket() {
  return { chances: 0, pts: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, tov: 0,
           zones: { rim: zoneCell(), mid: zoneCell(), three: zoneCell() },
           types: {}, scorers: {}, shots: [], players: {} };
}
function pbucket() {
  return { pts: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, tov: 0,
           zones: { rim: { a: 0, m: 0 }, mid: { a: 0, m: 0 }, three: { a: 0, m: 0 } } };
}
const agroup = () => ({ fgm: 0, pts: 0, p3m: 0, zones: { rim: 0, mid: 0, three: 0 } });

/* the descriptors, read exactly as deriveGame reads them (a repeated tag or type toggles), and the zone
   rule built on them: the shot type decides when it is decisive, the location fills the gaps */
function describe(all) {
  const tags = {}, stypes = {}, locs = {};
  all.forEach(ev => {
    if (ev.t === 'tag') { const s = tags[ev.ref] = tags[ev.ref] || new Set(); s.has(ev.tag) ? s.delete(ev.tag) : s.add(ev.tag); }
    else if (ev.t === 'stype') { stypes[ev.ref] = stypes[ev.ref] === ev.v ? null : ev.v; }
    else if (ev.t === 'loc') { locs[ev.ref] = { x: ev.x, y: ev.y }; }
  });
  const zoneOf = ev => {
    if (ev.t[1] === '3') return 'three';
    const ty = (stypes[ev.id] || '').toLowerCase();
    if (ty && RIM_TYPE.has(ty)) return 'rim';
    if (ty && FAR_TYPE.has(ty)) return 'mid';
    const l = locs[ev.id];
    return ((l && l.x > 0.33 && l.x < 0.67 && l.y < 0.42) || (tags[ev.id] && tags[ev.id].has('paint'))) ? 'rim' : 'mid';
  };
  return { tags, stypes, locs, zoneOf };
}

/* WHAT BECAME OF EACH MISSED FIELD GOAL: the first rebound after it, before anything else happens to the
   ball -- another shot, a free throw, a turnover, the period ending. 'off' when the shooter's own side got it,
   'def' when the other side did (team rebounds count: a rebound is a rebound); a miss with no rebound in
   between (a foul and free throws, a feed that logged none) is 'none'. A rebound of a missed FREE throw is
   not any zone's: the free throw is not a field goal. plays: descriptors already left out, in game order. */
const BALL_DEAD = /^(period_|end_|game_)/;
function reboundOutcomes(plays) {
  const out = new Map();
  plays.forEach((ev, i) => {
    if (!(ev.t === 'p2_miss' || ev.t === 'p3_miss') || !(ev.team === 0 || ev.team === 1)) return;
    let r = 'none';
    for (let j = i + 1; j < plays.length; j++) {
      const n = plays[j];
      if (n.t === 'reb') { r = n.team === ev.team ? 'off' : (n.team === 0 || n.team === 1) ? 'def' : 'none'; break; }
      if (n.t in FG || n.t in FT || n.t === 'to' || BALL_DEAD.test(n.t)) break;
    }
    out.set(ev, r);
  });
  return out;
}

/* Every side's shooting by zone with the rebounds off its misses, from one game's event log (the log as the page
   loads it: descriptors point at their shot by id). For a season, add the games up. [side 0, side 1], each
   { rim, mid, three } of { a, m, o, d } -- o: the side's own offensive rebounds off its misses in that zone, d: the
   other side's defensive rebounds off them. */
function reboundZones(events) {
  const all = inGameOrder(events || []);
  const { zoneOf } = describe(all);
  const plays = all.filter(ev => ev && !DESCRIPTOR[ev.t]);
  const rebOf = reboundOutcomes(plays);
  const out = [0, 1].map(() => ({ rim: zoneCell(), mid: zoneCell(), three: zoneCell() }));
  plays.forEach(ev => {
    if (!(ev.t in FG) || !(ev.team === 0 || ev.team === 1)) return;
    const q = out[ev.team][zoneOf(ev)];
    q.a++;
    if (FG[ev.t] > 0) { q.m++; return; }
    const r = rebOf.get(ev);
    if (r === 'off') q.o++; else if (r === 'def') q.d++;
  });
  return out;
}

function compute(S) {
  const teams = (S && S.teams) || [{}, {}];
  const names = {};
  teams.forEach(tm => ((tm && tm.players) || []).forEach(p => {
    names[p.id] = p.name || (p.num != null && p.num !== '' ? '#' + p.num : '#?');
  }));
  const all = inGameOrder((S && S.events) || []);
  const { tags, stypes, locs, zoneOf } = describe(all);

  const plays = all.filter(ev => ev && !DESCRIPTOR[ev.t]);
  const rebOf = reboundOutcomes(plays);
  const isAction = ev => (ev.t in FG || ev.t in FT || ev.t === 'to') && (ev.team === 0 || ev.team === 1);

  /* ---- the engine's windows, stamped on every action ----
     deriveGame scores a play BEFORE it updates the windows (its first switch,
     then its second), so the stamp is taken first and the rules applied after,
     line for line, including the assignments it makes without a guard. */
  const flag = { sc: [false, false], pot: [false, false] };
  const breakAt = [null, null];
  const stamp = new Map();
  plays.forEach(ev => {
    if (isAction(ev)) {
      const tg = tags[ev.id];
      const quick = breakAt[ev.team] != null && (cumEl(ev.period, ev.clock) - breakAt[ev.team]) <= TRANSITION_MS;
      stamp.set(ev, { second: flag.sc[ev.team], offTo: flag.pot[ev.team], transition: !!((tg && tg.has('transition')) || quick) });
    }
    switch (ev.t) {
      case 'p2_made': case 'p3_made': case 'ft_made':
        flag.sc[ev.team] = false; flag.pot[ev.team] = false; break;
      case 'reb':
        if (ev.off) flag.sc[ev.team] = true;
        else { flag.sc = [false, false]; flag.pot = [false, false]; breakAt[ev.team] = cumEl(ev.period, ev.clock); }
        break;
      case 'stl': breakAt[ev.team] = cumEl(ev.period, ev.clock); break;
      case 'to':
        flag.sc[ev.team] = false; flag.pot[ev.team] = false;
        flag.sc[1 - ev.team] = false; flag.pot[1 - ev.team] = true; break;
      case 'period_start':
        flag.sc = [false, false]; flag.pot = [false, false]; breakAt[0] = breakAt[1] = null; break;
    }
  });

  /* ---- chances, and which one each action belongs to ----
     possessions.js names a chance by its first event. An action belongs to the
     latest chance of its own side that began at or before it, which is also
     where an and-one's free throw lands (the chance is closed on the basket). */
  const P = Poss();
  const E = P ? P.enumerate({ events: plays }) : { chances: [], possessions: [] };
  const at = new Map();
  plays.forEach((ev, i) => { const k = ev.seq != null ? ev.seq : ev.id; if (!at.has(k)) at.set(k, i); });
  const chances = E.chances.map(c => ({ c, start: at.has(c.startEventId) ? at.get(c.startEventId) : -1, acts: [] }));
  const bySide = [chances.filter(x => x.c.team === 0), chances.filter(x => x.c.team === 1)];
  const ptr = [-1, -1];
  const actions = [];
  plays.forEach((ev, i) => {
    if (!isAction(ev)) return;
    const list = bySide[ev.team];
    while (ptr[ev.team] + 1 < list.length && list[ptr[ev.team] + 1].start <= i) ptr[ev.team]++;
    const ch = ptr[ev.team] >= 0 ? list[ptr[ev.team]] : null;
    const a = { ev, i, ch, stamp: stamp.get(ev) };
    if (ch) ch.acts.push(a);
    actions.push(a);
  });
  const live = chances.filter(x => x.acts.length);          // a chance with no action in it is the clock running out

  /* ---- after a timeout ----
     The play a timeout sets up is the chance of the first action after it --
     unless that chance was already under way before the timeout (a timeout
     between free throws), in which case, if the trip ended in a basket, it is
     the inbound that follows. Nothing carries across a new period. */
  const ato = new Map();                                     // chance -> { calledBy, timeout }
  const nextLive = ch => { const k = live.indexOf(ch); return k >= 0 && k + 1 < live.length ? live[k + 1] : null; };
  plays.forEach((ev, i) => {
    if (ev.t !== 'timeout') return;
    const first = actions.find(a => a.i > i);
    if (!first || !first.ch) return;
    if (plays.slice(i + 1, first.i).some(x => x.t === 'period_start')) return;
    let ch = first.ch;
    if (ch.acts[0].i < i) {
      const last = ch.acts[ch.acts.length - 1].ev;
      if (!(last.t === 'p2_made' || last.t === 'p3_made' || last.t === 'ft_made')) return;
      ch = nextLive(ch);
      if (!ch || ch.acts[0].ev.period !== ev.period) return;
    }
    if (!ato.has(ch)) ato.set(ch, { calledBy: ev.team === ch.c.team ? 'own' : ev.team == null ? 'official' : 'opp', timeout: ev });
  });

  /* ---- adding an action to a bucket, and to its player's ---- */
  const add = (b, a) => {
    const ev = a.ev;
    const pl = ev.pid ? (b.players[ev.pid] = b.players[ev.pid] || pbucket()) : null;
    if (ev.t in FG) {
      const made = FG[ev.t] > 0, three = ev.t[1] === '3', z = zoneOf(ev);
      b.fga++; b.zones[z].a++;
      if (three) b.p3a++;
      if (made) { b.fgm++; b.zones[z].m++; b.pts += FG[ev.t]; if (three) b.p3m++; }
      else { const r = rebOf.get(ev); if (r === 'off') b.zones[z].o++; else if (r === 'def') b.zones[z].d++; }
      if (pl) {
        pl.fga++; pl.zones[z].a++;
        if (three) pl.p3a++;
        if (made) { pl.fgm++; pl.zones[z].m++; pl.pts += FG[ev.t]; if (three) pl.p3m++; }
      }
      const ty = stypes[ev.id] || '';
      const key = (three ? 'three' : 'two') + '|' + ty;
      const T = b.types[key] = b.types[key] || { three, type: ty, a: 0, m: 0 };
      T.a++; if (made) T.m++;
      const l = locs[ev.id];
      b.shots.push({ id: ev.seq != null ? ev.seq : ev.id, x: l ? l.x : null, y: l ? l.y : null, made, three, zone: z,
                     type: ty, pid: ev.pid || null, period: ev.period, clock: ev.clock });
      if (ev.pid) { const s = b.scorers[ev.pid] = b.scorers[ev.pid] || { pid: ev.pid, pts: 0, fgm: 0, fga: 0 }; s.fga++; if (made) { s.fgm++; s.pts += FG[ev.t]; } }
    } else if (ev.t in FT) {
      b.fta++;
      if (pl) pl.fta++;
      if (FT[ev.t]) {
        b.ftm++; b.pts++;
        if (pl) { pl.ftm++; pl.pts++; }
        if (ev.pid) { const s = b.scorers[ev.pid] = b.scorers[ev.pid] || { pid: ev.pid, pts: 0, fgm: 0, fga: 0 }; s.pts++; }
      }
    } else if (ev.t === 'to') { b.tov++; if (pl) pl.tov++; }
  };

  const side = [0, 1].map(t => {
    const B = { all: bucket(), second: bucket(), transition: bucket(), offTo: bucket(), ato: bucket(), half: bucket() };
    const mine = live.filter(x => x.c.team === t);

    /* the whole possession from an after-timeout chance on */
    const atoChances = new Set();
    const atoPlays = [];
    mine.forEach(x => {
      if (!ato.has(x) || atoChances.has(x)) return;      // a second timeout inside one set is still one set
      const run = mine.filter(y => y.c.possession === x.c.possession && y.c.index >= x.c.index);
      run.forEach(y => atoChances.add(y));
      const acts = run.reduce((m, y) => m.concat(y.acts), []);
      const lastAct = acts[acts.length - 1].ev;
      const pts = acts.reduce((n, a) => n + (a.ev.t in FG ? FG[a.ev.t] : a.ev.t in FT ? FT[a.ev.t] : 0), 0);
      const first = acts[0].ev;
      atoPlays.push({ seq: first.seq != null ? first.seq : first.id, seqs: acts.map(a => (a.ev.seq != null ? a.ev.seq : a.ev.id)),
                      period: first.period, clock: first.clock,
                      calledBy: ato.get(x).calledBy, pts, chances: run.length,
                      how: howEnded(lastAct, stypes, names), made: pts > 0 });
      B.ato.chances++;
      acts.forEach(a => add(B.ato, a));
    });

    mine.forEach(x => {
      B.all.chances++;
      x.acts.forEach(a => add(B.all, a));
      const s0 = x.acts[0].stamp;
      STAMPED.forEach(k => { if (s0[k]) B[k].chances++; });
      if (!s0.second && !s0.transition && !s0.offTo && !atoChances.has(x)) {
        B.half.chances++;
        x.acts.forEach(a => add(B.half, a));
      }
    });
    /* the box score's three, by the play's own stamp */
    actions.forEach(a => {
      if (a.ev.team !== t) return;
      STAMPED.forEach(k => { if (a.stamp[k]) add(B[k], a); });
    });

    const total = B.all.pts;
    const sits = {};
    Object.keys(B).forEach(k => { sits[k] = finish(B[k], total, names); });
    return { sits, ato: atoPlays, assists: null, players: {} };
  });

  /* ---- assisted and unassisted: connections.js's pairing ----
     An assist belongs to the last made field goal, if it was the same side's;
     either way that basket is spent. */
  const assisted = new Set();
  const ftAssists = [0, 0];
  let last = null;
  plays.forEach(ev => {
    if ((ev.t === 'p2_made' || ev.t === 'p3_made') && ev.pid) last = ev;
    else if (ev.t === 'ast') {
      if (ev.pid && last && last.team === ev.team) assisted.add(last);
      else if (ev.team === 0 || ev.team === 1) ftAssists[ev.team]++;   // FIBA credits a pass that drew free throws
      last = null;
    }
  });
  const pAssist = [{}, {}];                                  // pid -> { ast, unast } per side
  [0, 1].forEach(t => {
    const A = { ast: agroup(), unast: agroup() };
    const by = {};
    plays.forEach(ev => {
      if (ev.team !== t || !(ev.t === 'p2_made' || ev.t === 'p3_made')) return;
      const isA = assisted.has(ev), v = FG[ev.t], z = zoneOf(ev);
      const g = isA ? A.ast : A.unast;
      g.fgm++; g.pts += v; g.zones[z]++; if (v === 3) g.p3m++;
      if (!ev.pid) return;
      const pa = pAssist[t][ev.pid] = pAssist[t][ev.pid] || { ast: agroup(), unast: agroup() };
      const pg = isA ? pa.ast : pa.unast;
      pg.fgm++; pg.pts += v; pg.zones[z]++; if (v === 3) pg.p3m++;
      const p = by[ev.pid] = by[ev.pid] || { pid: ev.pid, name: names[ev.pid] || '#?', fgm: 0, unFgm: 0, unPts: 0, un3: 0 };
      p.fgm++;
      if (!isA) { p.unFgm++; p.unPts += v; if (v === 3) p.un3++; }
    });
    A.ftAssists = ftAssists[t];
    A.leaders = Object.values(by).filter(p => p.unFgm > 0)
      .sort((a, b) => (b.unFgm - a.unFgm) || (b.unPts - a.unPts)).slice(0, 5);
    /* each zone's attempts beside how its makes were made: the context an
       efficiency number needs, since an assisted miss does not exist */
    const Z = side[t].sits.all.zones;
    A.zones = {};
    ['rim', 'mid', 'three'].forEach(z => { A.zones[z] = { a: Z[z].a, m: Z[z].m, ast: A.ast.zones[z], unast: A.unast.zones[z] }; });
    side[t].assists = A;
  });

  /* ---- every player's own line, one object per player ----
     Pivoted out of the side's buckets, so a player's numbers are by construction
     the ones that went into the side's. A player who did nothing in a situation
     has a zero line there rather than a missing one. */
  [0, 1].forEach(t => {
    const ids = new Set();
    KEYS.forEach(k => Object.keys(side[t].sits[k].players).forEach(pid => ids.add(pid)));
    Object.keys(pAssist[t]).forEach(pid => ids.add(pid));
    ((teams[t] && teams[t].players) || []).forEach(p => { if (ids.has(p.id)) ids.delete(p.id), ids.add(p.id); });
    const out = {};
    ids.forEach(pid => {
      const sits = {};
      KEYS.forEach(k => { sits[k] = finishPlayer(side[t].sits[k].players[pid] || pbucket()); });
      const pa = pAssist[t][pid] || { ast: agroup(), unast: agroup() };
      out[pid] = { pid, name: names[pid] || '#?', sits, ast: pa.ast, unast: pa.unast };
    });
    side[t].players = out;
  });

  return { side, names: [0, 1].map(t => (teams[t] && teams[t].name) || (t ? 'Away' : 'Home')), possessions: !!P };
}

function finish(b, total, names) {
  const types = Object.values(b.types).sort((x, y) => (y.a - x.a) || (y.m - x.m));
  return {
    chances: b.chances, pts: b.pts, fga: b.fga, fgm: b.fgm, p3a: b.p3a, p3m: b.p3m, fta: b.fta, ftm: b.ftm, tov: b.tov,
    ppp: b.chances ? b.pts / b.chances : null,
    efg: b.fga ? (b.fgm + 0.5 * b.p3m) / b.fga : null,
    tovPct: b.chances ? b.tov / b.chances : null,
    share: total ? b.pts / total : 0,
    zones: b.zones, types, shots: b.shots,
    players: b.players,
    scorers: Object.values(b.scorers).filter(s => s.pts > 0).map(s => Object.assign({ name: names[s.pid] || '#?' }, s))
      .sort((x, y) => (y.pts - x.pts) || (y.fgm - x.fgm)).slice(0, 5)
  };
}
function finishPlayer(p) {
  return Object.assign({}, p, { efg: p.fga ? (p.fgm + 0.5 * p.p3m) / p.fga : null });
}

/* game flow's surname: the last word, a suffix skipped */
const surname = name => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w[w.length - 1]) && w.length > 1 ? w[w.length - 2] : w[w.length - 1];
};
function howEnded(ev, stypes, names) {
  const who = ev.pid && names[ev.pid] ? ' · ' + surname(names[ev.pid]) : '';
  if (ev.t === 'to') return 'turnover' + who;
  if (ev.t in FT) return (FT[ev.t] ? 'free throws' : 'missed free throw') + who;
  const three = ev.t[1] === '3', ty = stypes[ev.id];
  const shot = three ? (ty && ty !== 'jump shot' ? ty + ' three' : 'three') : (ty || 'two');
  return (FG[ev.t] ? '' : 'missed ') + shot + who;
}

/* ------------------------------------------------------------ the store --- */
const line = (b, withCh) => {
  const v = [b.pts, b.fgm, b.fga, b.p3m, b.p3a, b.zones.rim.m, b.zones.rim.a, b.zones.mid.m, b.zones.mid.a, b.ftm, b.fta, b.tov];
  if (withCh) v.push(b.chances);
  return v;
};
const aline = g => [g.fgm, g.pts, g.p3m, g.zones.rim, g.zones.mid];
const zero = v => v.every(x => !x);

/* What finalise-game and the backfill write: { teams: [sit, sit], players: {pid: sit} }.
   A side's line is always complete. A player's omits situations he did nothing in
   (a missing situation reads as zeros), and a player who did nothing at all gets
   no line: epinoia/season.js counts a player's games from the SIDE's line, so an
   empty night still counts as a game. */
function toStored(C) {
  const out = { teams: [], players: {} };
  [0, 1].forEach(t => {
    const D = C.side[t];
    const T = { v: VERSION };
    KEYS.forEach(k => { T[k] = line(D.sits[k], true); });
    T.ast = aline(D.assists.ast); T.unast = aline(D.assists.unast); T.ftAst = D.assists.ftAssists;
    out.teams.push(T);
    Object.keys(D.players).forEach(pid => {
      const p = D.players[pid];
      const L = { v: VERSION };
      let any = false;
      KEYS.forEach(k => { const v = line(p.sits[k], false); if (!zero(v)) { L[k] = v; any = true; } });
      const a = aline(p.ast), u = aline(p.unast);
      if (!zero(a)) { L.ast = a; any = true; }
      if (!zero(u)) { L.unast = u; any = true; }
      if (any) out.players[pid] = L;
    });
  });
  return out;
}

return { compute, toStored, finish, howEnded, surname, reboundZones, reboundOutcomes, KEYS, STAMPED, FIELDS, AFIELDS, VERSION, cumEl, inGameOrder };
}));
