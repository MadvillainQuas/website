'use strict';
/* ============================================================================
   MANAGER - THE MATCH, POSSESSION BY POSSESSION (core: no site, no DOM, no database).          window.Mgr.match

   Louie, 2026-10-14: "I want this model of basketball to perfectly sim live basketball akin to Football Manager (using
   the what wins model and other research to help inform), to where it can support live, in real time games where the
   user can change team instructions, make subs etc. to change the game - fully simming basketball based on player
   capabilities and lineup synergy". And "Use football manager engine design/philosophy".

   ONE ENGINE FOR EVERY GAME. A game is played a possession at a time by the ten men on the floor at that moment: each
   five's rates are engine.js sideOf's (the What wins model, man by man: his usage on the skill curve, his shot mix and
   makes at the volume his instructions ask of him, the five's spacing, passing, creation, run habit, rim protection),
   the two fives meet through winsim's matchup (the log5 blend, the home court), and the possession is the What wins
   chain (a turnover live or dead, a foul trip, a shot from a zone and its make, the rebound and the and-one, transition
   off a defensive board or a steal) - played man by man: who has the ball by his share of the plays, his own turnovers,
   his own shot from his own mix at his own make rate (moved by the defence, the home court, the clock, his legs), the
   assist by his teammates' passing, the board by the rebounders, the steal and the block by the defenders. What winsim
   adds to a game is kept: the score effect toward the expected path (lead), a game's form either side (tau), its pace
   (sigmaN), end-game fouling, overtimes.

   WHAT FM ADDS, AND THE GAME NOW HAS (core of the live play):
     * CONDITION: each man's energy falls while he plays (faster with more of the ball, for a man not used to big
       minutes, with a running and gambling game) and comes back on the bench and at the breaks; under 70% it costs his
       makes, his turnovers and his defence;
     * FOULS: five (six in a 48-minute game) and he is out; a coach sits a man in foul trouble;
     * THE BENCH: a coach (the assistant, or the other club's) follows the rotation planned before the game - the
       reader's lineups and minutes, a real club's own starters and minutes - and changes it for fouls, legs and a
       blow-out, at dead balls; the reader can sub, change the team's instructions and each man's, call timeouts;
     * EVERY CHANGE IS THE GAME'S FROM THEN ON: a change goes into the log at the possession it took effect, and the same
       seed and the same log play the same game (each possession draws from its own stream).

     create(H, A, X, o)   a game: teams {id, segs (the rotation plan), cards, identity, form, ins, bench?}, X {L, ref, G},
                          o {seed, home: 1 | -1 | 0, auto: [bool, bool]}
     step(M)              one possession (and the dead-ball business before it: subs, timeouts) -> false when over
     runTo(M, sec)        to the game clock's second; finish(M) to the end
     act(M, side, a)      the reader's change: {type: 'sub', out, in} | {type: 'tac', tac} | {type: 'ins', ins} |
                          {type: 'auto', on} | {type: 'timeout'}
     result(M)            {pts, ot, poss, tally, box, events, lineups}: what season.js keeps (engine.play's shape)
     snapshot(M) / restore(snap, H, A, X)    a game in progress kept as JSON, and taken up again
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.match = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const Mg = () => root.Mgr || {};
const ENG = () => Mg().engine || (typeof require === 'function' ? require('./engine.js') : null);
const SIM = () => (ENG() && ENG().sim ? ENG().sim() : null) || root.EpinoiaWinSim || (typeof require === 'function' ? require('../../winsim.js') : null);
const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cp = p => clamp(p, 1e-4, 1 - 1e-4);
const logit = p => Math.log(cp(p) / (1 - cp(p)));
const expit = x => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const ZN = ['rim', 'mid', 'three'];

/* ------------------------------------------------------------------ the numbers --- */
/* CONDITION (energy 0-100). A man on the floor loses DRAIN a minute at the league's average load (a fifth of the plays,
   his usual minutes), more with more of the ball and for a man not used to big minutes, more in a running, gambling,
   crashing game; on the bench he gets REST a minute back, and the breaks give some back. Under LOW it costs his makes
   (PEN on the logit at none left), his turnovers, and what he takes away at the other end. Set so that a starter on his
   usual stints rarely drops under it, and a man left out for forty minutes is spent by the fourth quarter. */
const ENERGY = { drain: 2.0, rest: 4.5, quarter: 6, half: 15, ot: 4, timeout: 3, low: 70, pen: 0.30 };
/* FIBA's timeouts: two in the first half, three in the second, one an overtime */
const TIMEOUTS = { first: 2, second: 3, ot: 1 };
/* the coach's foul-trouble rule: sit a man with this many fouls in this quarter (a 40-minute game; one more in a 48) */
const TROUBLE = [2, 3, 4, 99];
/* THE WHISTLE. A dead-ball turnover is an offensive foul OFF_FOUL of the time (a charge, an illegal screen: a foul on the
   man with the ball, a team foul, no free throws). The fouls without free throws at the other end - before the bonus,
   on the ball, off it - are what is left of the league's own fouls a team-game (its players' fouls a minute: ref.five
   pf40) once the free-throw trips, the and-ones, the offensive fouls and the late fouling are counted (whistle): checked
   on real seasons' fouls and foul-outs a team-game (tools/manager-validate.mjs). Without the league's, F_RATE. */
const OFF_FOUL = 0.2, F_RATE = 0.085;
/* FOUL TROUBLE: a man one foul from the limit, and two from it, draws this share of what his own rate would (he defends
   with care), so the foul-outs a team-game are the real seasons' (0.45 ORLEN, 0.39 Primera FEB, 0.28 NBL D1 in 2025-26) */
const CARE = [0.6, 0.85];
/* the possessions' length against the matchup's seconds a possession (the buzzer's cut, checked on four real seasons) */
const DUR_K = 1.02;
/* a seeded generator (mulberry32), and a possession's own stream */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fmix(h) { h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16; return h >>> 0; }
function hashOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function gaussian(R) { const u1 = R(), u2 = R(); return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2); }
const pickBy = (R, list, w) => {
  let tot = 0;
  for (const x of list) tot += Math.max(0, w(x) || 0);
  if (!(tot > 0)) return list.length ? list[Math.floor(R() * list.length)] : null;
  let r = R() * tot;
  for (const x of list) { r -= Math.max(0, w(x) || 0); if (r < 0) return x; }
  return list[list.length - 1];
};

/* ------------------------------------------------------------------ the teams --- */
/* a five's rates, cached by the five, its tactics and the team's instructions (engine.sideOf, then the club's identity) */
function sidesOf(T, X) {
  const E = ENG(), cache = new Map();
  /* roles: the five's roles at its positions (the reader's club: rolesAt), none for a real club (its men's own games) */
  return function sideFor(ids, tac, roles) {
    const tacN = E.normTac(tac || null), R = Array.isArray(roles) ? roles : null;
    const key = ids.join('|') + '#' + E.tacKey(tacN) + '#' + E.insKey(T.ins) + '#' + (R ? R.map(r => r || '').join(',') : '-');
    if (cache.has(key)) return cache.get(key);
    const five = ids.map((id, k) => ({ card: T.cards.get(String(id)), k, role: R ? (R[k] || null) : undefined })).filter(x => x.card);
    if (five.length !== 5) throw new Error('a five is missing a player: ' + ids.join(','));
    const side = E.sideOf(five, { mu: X.L.rates, ref: X.ref, tac: tacN, G: X.G || 40, zones: X.L.zones, dTr: X.L.dTr || 0, form: T.form || null, ins: T.ins || null });
    side.off0 = side.off; side.def0 = side.def;
    if (T.identity && T.identity.length) { const P = E.applyIdentity(side, T.identity, X.L); side.off = P.off; side.def = P.def; }
    side.key = key;
    cache.set(key, side);
    return side;
  };
}
/* the plan's five (and its tactics) at a minute of the game; overtime is the closers' */
function planAt(segs, min, G) {
  const t = Math.min(min, G - 1e-6);
  return segs.find(s => s.t0 <= t + 1e-9 && t < s.t1) || segs[segs.length - 1];
}
/* THE ROLES OF THE FIVE ON THE FLOOR (the reader's club; a real club has none: null): at each place, the role the reader
   gave him there in the game (act 'role'), else the plan's role for him at that place now, else the one his lineups give
   him at that place, else the place's default (null) */
function rolesAt(sd, min, G) {
  const segs = sd.T.segs || [];
  if (!segs.some(s => Array.isArray(s.roles))) return null;
  const plan = planAt(segs, min, G);
  return sd.floor.map((id, k) => {
    const ov = sd.roleOv ? sd.roleOv[id + '@' + k] : undefined;
    if (ov !== undefined) return ov || null;
    if (plan && String(plan.ids[k]) === id && plan.roles) return plan.roles[k] || null;
    const s = segs.find(x => x.roles && String(x.ids[k]) === id);
    return s ? s.roles[k] || null : null;
  });
}
/* everybody the side may play: the plan's men, and a bench it names (the reader's whole squad) */
function rosterOf(T) {
  const ids = new Set();
  (T.segs || []).forEach(s => s.ids.forEach(id => ids.add(String(id))));
  (T.bench || []).forEach(id => { if (T.cards.has(String(id))) ids.add(String(id)); });
  return [...ids];
}

/* ------------------------------------------------------------------ a game --- */
function create(H, A, X, o) {
  o = o || {};
  const E = ENG(), S = SIM(), L = X.L, G = X.G || Math.round((L.T || 2400) / 60), T = G * 60, Tot = L.Tot || 300;
  const home = o.home != null ? o.home : 1, seed = (o.seed != null ? o.seed : hashOf(H.id + '|' + A.id)) >>> 0;
  const R0 = rng(seed ^ 0x51ED27);
  const side = (Tm, s) => {
    const plan = planAt(Tm.segs, 0, G);
    const roster = rosterOf(Tm);
    return {
      s, id: Tm.id, T: Tm, sideFor: sidesOf(Tm, X), roster, floor: plan.ids.map(String), tac: null,
      pf: Object.fromEntries(roster.map(id => [id, 0])), en: Object.fromEntries(roster.map(id => [id, 100])), sec: Object.fromEntries(roster.map(id => [id, 0])),
      tf: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], to: TIMEOUTS.first, auto: o.auto ? o.auto[s] !== false : true, hold: -1, runFor: 0, runAg: 0, pend: []
    };
  };
  const M = {
    v: 1, seed, home, G, T, Tot, X, L, limit: G >= 48 ? 6 : 5,
    sides: [side(H, 0), side(A, 1)],
    g: { score: [0, 0], per: 0, left: T / 4, t: 0, k: 0, off: home === 1 ? 0 : home === -1 ? 1 : (R0() < 0.5 ? 0 : 1), first: 0, start: 0, over: false, ot: 0, fresh: true, fouled: [null, null] },
    noise: { e: [0, 0], pace: 1 },
    events: [], lineups: [], lineup: -1, log: [], box: [{}, {}], tally: [tally0(), tally0()], poss: [0, 0], lastMade: [null, null]
  };
  M.g.first = M.g.off;
  /* the game's own form either side and its pace (winsim core: tau, sigmaN), and the expected regulation margin the score
     effect pulls toward (the planned rotations' rates, put together by their minutes: winsim prep) */
  const tau = L.tau || 0;
  M.noise.e = [tau * gaussian(R0), tau * gaussian(R0)];
  try {
    const exp = expected(M);
    M.exp = exp.margin;
    const N0 = Math.max(20, exp.n), eta = (L.sigmaN || 0) * gaussian(R0);
    M.noise.pace = clamp(N0 / Math.max(10, N0 + eta), 0.85, 1.15);
  } catch (_) { M.exp = 0; M.noise.pace = 1; }
  M.fRate = whistle(M);
  lineupMark(M);
  push(M, { k: 'Q', p: 0 }, 0);
  return M;
}
/* the fouls without free throws a possession: the league's fouls a team-game less what the rest of the game gives (its
   rates: trips a chance, turnovers and the live ones, the and-one a make; chances 1.12 a possession, a make 0.47 of the
   shots, the late fouling 0.8 a team-game), over its possessions */
function whistle(M) {
  const L = M.L, r = L.rates || {}, ref = M.X.ref, pf40 = ref && ref.five ? ref.five.pf40 : null;
  if (!isNum(pf40) || pf40 <= 0 || !isNum(r.d) || r.d <= 0) return F_RATE;
  const n = (L.kappaN || 1) * M.T / (2 * r.d), ch = 1.12 * n, tov = isNum(r.tov) ? r.tov : 0.14, trip = (r.sfoul || 0) + (r.bonus || 0);
  const trips = trip * (1 - tov) * ch, makes = (1 - tov) * (1 - trip) * 0.47 * ch, and1 = (isNum(r.and1) ? r.and1 : 0.03) * makes;
  const offF = OFF_FOUL * tov * (1 - (isNum(r.live) ? r.live : 0.55)) * ch;
  return clamp((pf40 * M.G / 40 - trips - and1 - offF - 0.8) / n, 0.02, 0.22);
}
const tally0 = () => ({ pts: 0, fga: 0, fgm: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, tov: 0, to_live: 0, rim_a: 0, rim_m: 0, mid_a: 0, mid_m: 0, poss: 0, chances: 0, tr_ch: 0, tr_pts: 0, ast: 0, stl: 0, blk: 0, pf: 0 });
/* the regulation margin the planned rotations expect, and the possessions a side: as winsim prep does */
function expected(M) {
  const E = ENG(), S = SIM(), X = M.X, L = M.L, G = M.G;
  const [H, A] = M.sides;
  const st = E.overlay(H.T.segs, A.T.segs).map(o2 => {
    const sh = H.sideFor(o2.a.ids.map(String), o2.a.tac || null, o2.a.roles || null), sa = A.sideFor(o2.b.ids.map(String), o2.b.tac || null, o2.b.roles || null);
    const mm = S.matchup({ off: sh.off, def: sh.def, n: 0 }, { off: sa.off, def: sa.def, n: 0 }, L, { home: M.home });
    return { w: (o2.t1 - o2.t0) / G, rH: E.interact(mm.r[0], sh, sa), rA: E.interact(mm.r[1], sa, sh) };
  });
  const rH = E.mixRates(st.map(x => ({ w: x.w, r: x.rH, o: x.rA }))), rA = E.mixRates(st.map(x => ({ w: x.w, r: x.rA, o: x.rH })));
  const Mt = S.matchFrom(rH, rA, L, { home: M.home });
  const mk0 = S.markov(Mt, 0), mk1 = S.markov(Mt, 1), n = (L.kappaN || 1) * M.T / (rH.d + rA.d);
  return { margin: n * (mk0.ppp - mk1.ppp), n };
}

/* ------------------------------------------------------------------ the record --- */
/* an event at a second of its period (whole seconds, never past its period's last: the play-by-play's clock, scorer.js) */
function bounds(M) { const p = M.g.per; return p < 4 ? [p * M.T / 4, (p + 1) * M.T / 4] : [M.T + (p - 4) * M.Tot, M.T + (p - 3) * M.Tot]; }
function push(M, e, t) { const [b0, b1] = bounds(M); e.t = Math.max(b0, Math.min(b1 - 1, Math.round(t))); M.events.push(e); return e; }
function lineOf(M, s, id) {
  const B = M.box[s];
  if (!B[id]) B[id] = { id, min: 0, pts: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, rimM: 0, rimA: 0, midM: 0, midA: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 };
  return B[id];
}
/* the fives on the floor now: a new stretch whenever either changes (the box score's substitutions, scorer.js) */
function lineupMark(M) {
  const cur = M.lineups[M.lineup], h = M.sides[0].floor.slice(), a = M.sides[1].floor.slice(), now = M.g.t / 60;
  if (cur && cur.h.join('|') === h.join('|') && cur.a.join('|') === a.join('|')) return;
  if (cur) cur.t1 = now;
  M.lineups.push({ t0: now, t1: now, h, a });
  M.lineup = M.lineups.length - 1;
}

/* ------------------------------------------------------------------ the bench --- */
/* a man's fit at a position (his minutes there, his position near it) and his legs, for a coach choosing who goes in */
function benchScore(M, sd, id, k) {
  const c = sd.T.cards.get(id); if (!c) return -Infinity;
  const share = Array.isArray(c.share) ? (c.share[k] || 0) : 0, d = Math.abs((c.pos || 3) - (k + 1));
  const legs = (sd.en[id] || 0) / 100, mpg = clamp((c.mpg || 10) / 30, 0, 1.3);
  const trouble = sd.pf[id] >= troubleAt(M) ? 1 : 0;
  return 2 * share - 0.6 * Math.max(0, d - 0.6) + 1.2 * legs + 0.8 * mpg - 2 * trouble;
}
const troubleAt = M => (M.g.per < 3 ? TROUBLE[M.g.per] + (M.limit - 5) : M.limit);
/* who may come on: not on the floor, not fouled out */
const available = (M, sd) => sd.roster.filter(id => !sd.floor.includes(id) && sd.pf[id] < M.limit && sd.T.cards.has(id));
function swap(M, sd, outId, inId, why) {
  const k = sd.floor.indexOf(outId);
  if (k < 0 || sd.floor.includes(inId)) return false;
  sd.floor[k] = inId;
  push(M, { k: 'U', s: sd.s, out: outId, in: inId, why: why || '' }, M.g.t);
  return true;
}
/* THE COACH'S SUBSTITUTIONS at a dead ball (or when a man has fouled out): the plan's five, changed for fouls, legs and a
   blow-out. The reader's own side, when the assistant is off or has been overruled this quarter, changes only what it
   must (a man fouled out). */
function coach(M, sd, forced) {
  const G = M.G, min = M.g.t / 60;
  /* 1. fouled out: he must go - for the best fit with legs at his place */
  sd.floor.slice().forEach((id, k) => {
    if (sd.pf[id] < M.limit) return;
    const av = available(M, sd);
    if (!av.length) return;
    const best = av.slice().sort((a, b) => benchScore(M, sd, b, k) - benchScore(M, sd, a, k))[0];
    swap(M, sd, id, best, 'fouled out');
  });
  if (forced || !sd.auto || sd.hold >= M.g.k) return;
  /* 2. THE FIVE HE WANTS NOW: the plan's five at this minute (a blow-out late: the bench plays it out), each place's man
     swapped for the best fit with legs when he is fouled out, in foul trouble (not late in a close game) or out of
     legs; then the difference subbed, every man at the plan's place */
  const plan = planAt(sd.T.segs, min, G), margin = M.g.score[sd.s] - M.g.score[sd.s ^ 1];
  const blowout = M.g.per === 3 && ((M.g.left <= 300 && Math.abs(margin) >= 20) || (M.g.left <= 480 && Math.abs(margin) >= 28));
  const late = M.g.per >= 3 && M.g.left <= 240 && Math.abs(margin) <= 10;
  const bad = x => !sd.T.cards.has(x) || sd.pf[x] >= M.limit || (sd.pf[x] >= troubleAt(M) && !late) || (sd.en[x] || 0) < 38;
  let want = plan.ids.map(String);
  if (blowout) {
    const starters = new Set(planAt(sd.T.segs, 0, G).ids.map(String));
    const deep = sd.roster.filter(x => !starters.has(x) && !bad(x));
    want = want.map((id, k) => {
      if (!starters.has(id)) return id;
      const c = deep.filter(x => !want.includes(x)).sort((a, b) => benchScore(M, sd, b, k) - benchScore(M, sd, a, k))[0];
      if (c) deep.splice(deep.indexOf(c), 1);
      return c || id;
    });
  }
  const used = new Set();
  const five = want.map((id, k) => {
    if (!bad(id) && !used.has(id)) { used.add(id); return id; }
    const cands = sd.roster.filter(x => !used.has(x) && !want.includes(x) && !bad(x) && sd.T.cards.has(x));
    /* the man on the floor at this place, if he is fine, before anybody from the bench */
    const cur = sd.floor[k];
    if (cur && !bad(cur) && !used.has(cur) && !want.includes(cur)) { used.add(cur); return cur; }
    const best = cands.sort((a, b) => benchScore(M, sd, b, k) - benchScore(M, sd, a, k))[0];
    const pick = best || id;
    used.add(pick);
    return pick;
  });
  const outs = sd.floor.filter(x => !five.includes(x)), ins = five.filter(x => !sd.floor.includes(x));
  if (!outs.length && five.join('|') === sd.floor.join('|')) return;
  outs.forEach((x, i) => {
    const why = sd.pf[x] >= M.limit ? 'fouled out' : (sd.en[x] || 0) < 38 ? 'tired' : sd.pf[x] >= troubleAt(M) ? 'foul trouble' : blowout ? 'the game is decided' : '';
    push(M, { k: 'U', s: sd.s, out: x, in: ins[i], why }, M.g.t);
  });
  sd.floor = five;
}
/* a coach's timeout: the other side on a run of 8 unanswered, with one to spare (not in the last two minutes: those are
   for the end of the game) */
function coachTimeout(M, sd) {
  if (sd.to <= 0 || (M.g.per >= 3 && M.g.left <= 120)) return false;
  if (sd.runAg >= 8) { timeout(M, sd, 'stops the run'); return true; }
  return false;
}
function timeout(M, sd, why) {
  if (sd.to <= 0) return false;
  sd.to--; sd.runAg = 0; sd.runFor = 0; M.sides[sd.s ^ 1].runAg = 0; M.sides[sd.s ^ 1].runFor = 0;
  [0, 1].forEach(s => M.sides[s].floor.forEach(id => { M.sides[s].en[id] = Math.min(100, (M.sides[s].en[id] || 0) + ENERGY.timeout); }));
  push(M, { k: 'Y', s: sd.s, why: why || '' }, M.g.t);
  return true;
}

/* ------------------------------------------------------------------ the reader's changes --- */
/* a change from the reader, at the next possession: kept in the log (the game replays from its seed and the log) */
function act(M, s, a) {
  if (!a || M.g.over) return false;
  const sd = M.sides[s];
  const entry = Object.assign({ at: M.g.k, s }, JSON.parse(JSON.stringify(a)));
  let ok = true;
  if (a.type === 'sub') {
    /* at the next dead ball (or now, between quarters): queued */
    sd.pend.push({ out: String(a.out), in: String(a.in) });
  } else if (a.type === 'unsub') sd.pend = sd.pend.filter(p => !(p.out === String(a.out) && p.in === String(a.in)));
  else if (a.type === 'tac') sd.tac = a.tac ? Object.assign({}, a.tac) : null;
  else if (a.type === 'ins') sd.T = Object.assign({}, sd.T, { ins: insMap(a.ins) }), sd.sideFor = sidesOf(sd.T, M.X);
  /* a man's role at a place, for the rest of the game (null: the place's default) */
  else if (a.type === 'role' && a.id != null && a.k >= 0 && a.k <= 4) { sd.roleOv = Object.assign({}, sd.roleOv); sd.roleOv[String(a.id) + '@' + a.k] = a.role || null; }
  else if (a.type === 'auto') sd.auto = !!a.on;
  else if (a.type === 'timeout') sd.wantTO = true;
  else ok = false;
  if (ok) M.log.push(entry);
  return ok;
}
/* instructions as kept in the log ({id: {u, k: [..]}}) -> engine's Map */
function insMap(o) {
  if (o instanceof Map) return o;
  const m = new Map();
  Object.keys(o || {}).forEach(id => { const x = o[id]; if (x && (x.u || (x.k && x.k.length))) m.set(String(id), { u: x.u || 0, k: new Set(x.k || []) }); });
  return m;
}
const insObj = m => { const o = {}; if (m) m.forEach((x, id) => { o[id] = { u: x.u || 0, k: [...x.k] }; }); return o; };
/* the dead-ball business: the reader's queued subs and timeout, the coaches' subs and timeouts, then the lineup */
function deadBall(M, dead) {
  M.sides.forEach(sd => {
    /* the reader's timeout stops the game before the next possession is played (step returns without one), so what they
       change in it is in that possession */
    if (dead && sd.wantTO) { sd.wantTO = false; if (timeout(M, sd, 'called by the coach')) M.g.halt = true; }
    if (dead && sd.pend.length) {
      sd.pend.splice(0).forEach(p => { if (sd.floor.includes(p.out) && !sd.floor.includes(p.in) && sd.pf[p.in] < M.limit && sd.T.cards.has(p.in)) swap(M, sd, p.out, p.in, 'coach'); });
      /* the reader's five stands until the next quarter, unless something forces a change */
      sd.hold = Infinity;
    }
  });
  M.sides.forEach(sd => { coach(M, sd, !dead); if (dead && sd.auto && sd.hold < M.g.k) coachTimeout(M, sd); });
  lineupMark(M);
}

/* ------------------------------------------------------------------ a possession --- */
/* the rates of the offence's five against the defence's, five-level (winsim matchup, scheme interaction) and man by man */
function ratesFor(M, off) {
  const E = ENG(), S = SIM(), O = M.sides[off], D = M.sides[off ^ 1], min = M.g.t / 60;
  const tacO = O.tac || planAt(O.T.segs, min, M.G).tac || null, tacD = D.tac || planAt(D.T.segs, min, M.G).tac || null;
  const sO = O.sideFor(O.floor, tacO, rolesAt(O, min, M.G)), sD = D.sideFor(D.floor, tacD, rolesAt(D, min, M.G));
  M._mc = M._mc || new Map();
  const hs = off === 0 ? M.home : -M.home, key = sO.key + '>' + sD.key + '@' + hs;
  let mm = M._mc.get(key);
  if (!mm) {
    const r = S.matchup({ off: sO.off, def: sO.def, n: 0 }, { off: sD.off, def: sD.def, n: 0 }, M.L, { home: hs }).r[0];
    const ri = E.interact(r, sO, sD);
    /* the transition share of this side's chances (winsim prep), for the transition bonus's split */
    let sTr = 0.15;
    try { const Mt = S.matchFrom(ri, ri, M.L, { home: 0 }), mk = S.markov(Mt, 0); sTr = clamp(ri.tr * (mk.dreb + mk.live) / Math.max(0.5, mk.chances), 0, 0.95); } catch (_) { /* the default */ }
    mm = { r: ri, sO, sD, sTr };
    if (M._mc.size > 400) M._mc.clear();
    M._mc.set(key, mm);
  }
  return mm;
}
/* each man of the offence, his rates against this defence now: his own against his five's (before its club's identity),
   on the five's blended rate - so the five's rates are the matchup's and his differences are his own - and his legs */
function menOf(M, mm, off) {
  const O = M.sides[off], D = M.sides[off ^ 1], r = mm.r, o0 = mm.sO.off0;
  const defPen = D.floor.reduce((a, id) => a + pen(D.en[id]), 0) / 5;
  const mix0 = z => (z === 'rim' ? o0.mixRim : z === 'mid' ? o0.mixMid : o0.mix3), mixR = z => (z === 'rim' ? r.mixRim : z === 'mid' ? r.mixMid : r.mix3);
  const pz0 = z => (z === 'rim' ? o0.pRim : z === 'mid' ? o0.pMid : o0.p3), pzR = z => (z === 'rim' ? r.pRim : z === 'mid' ? r.pMid : r.p3);
  return mm.sO.men.map(m => {
    const pn = pen(O.en[m.id]);
    const mix = {}; let ms = 0;
    ZN.forEach(z => { mix[z] = Math.max(1e-6, m.m[z] * mixR(z) / Math.max(1e-6, mix0(z))); ms += mix[z]; });
    ZN.forEach(z => { mix[z] /= ms; });
    const p = {}; ZN.forEach(z => { p[z] = logit(pzR(z)) + logit(m.p[z]) - logit(pz0(z)) - pn + 0.6 * defPen; });
    const ratio = (a, b) => (b > 1e-9 ? a / b : 1);
    let sf = r.sfoul * ratio(m.sfoul != null ? m.sfoul : m.trip * 0.6, o0.sfoul), bo = r.bonus * ratio(m.bonus != null ? m.bonus : m.trip * 0.4, o0.bonus);
    if (sf + bo > 0.6) { const q = 0.6 / (sf + bo); sf *= q; bo *= q; }
    return { id: m.id, k: m.k, s: m.s, tovL: logit(r.tov) + logit(m.tov) - logit(o0.tov) + 0.8 * pn, sf, bo, mix, pL: p, ft: m.ft,
      and1: clamp(r.and1 * ratio(m.and1 != null ? m.and1 : r.and1, o0.and1), 0, 0.3), orb: m.orb * (1 - 0.5 * pn), ast: m.ast * (1 - 0.3 * pn), un: m.un, tr: m.tr || 0.15, hw: m.hw || 0 };
  });
}
const pen = e => (isNum(e) && e < ENERGY.low ? ENERGY.pen * (ENERGY.low - e) / ENERGY.low : 0);
/* the defenders, their weights for a steal, a block, a board, a foul (and their legs) */
const defOf = (M, mm, def) => mm.sD.men.map(m => ({ id: m.id, stl: m.stl * (1 - 0.5 * pen(M.sides[def].en[m.id])), blk: m.blk * (1 - 0.5 * pen(M.sides[def].en[m.id])), drb: m.drb * (1 - 0.4 * pen(M.sides[def].en[m.id])), pf: m.pf }));

/* ONE POSSESSION. Returns false when the game is over. */
function step(M) {
  const g = M.g;
  if (g.over) return false;
  /* the period starts: the breaks' rest, the timeouts of a new half, the jump or the arrow */
  if (g.fresh) {
    g.fresh = false;
    deadBall(M, true);
  } else deadBall(M, g.start === 0);
  /* a timeout the reader called: the game stops here (the next call plays the possession, the ball still dead) */
  if (g.halt) { g.halt = false; return !g.over; }
  const off = g.off, def = off ^ 1, O = M.sides[off], D = M.sides[def];
  const S = SIM(), L = M.L;
  const mm = ratesFor(M, off), men = menOf(M, mm, off), dmen = defOf(M, mm, def), r = mm.r;
  const R = rng(fmix(M.seed ^ Math.imul(g.k + 1, 0x9E3779B9))), RT = rng(fmix(M.seed ^ 0x2545F491 ^ Math.imul(g.k + 1, 0x85EBCA6B)));
  /* end-game fouling: the side behind by 3 to 8 in the last two minutes of the fourth quarter (or an overtime) fouls */
  const lead = g.score[off] - g.score[def], last = g.per >= 3;
  const fouled = L.fouling !== false && last && g.left <= 120 && lead >= 3 && lead <= 8;
  /* the score effect: a side ahead of the game's expected path (its expected margin times the share of regulation
     played) makes a little less, a side behind it a little more (winsim core: lead, per 10 points, capped at 20) */
  const frac = g.per >= 4 ? 1 : clamp(g.t / M.T, 0, 1);
  const gap = g.score[off] - g.score[def] - (off ? -1 : 1) * (M.exp || 0) * frac;
  const sft = L.lead ? -L.lead * clamp(gap, -20, 20) / 10 : 0;
  const e = M.noise.e[off];
  const dTr = L.dTr || 0, sTr = mm.sTr, ft3 = L.ft3 != null ? L.ft3 : 0.05;
  const t0 = g.t, chances = [];
  let pts = 0, next = 0, trans = false, prevReb = null, cont = true;
  const T1 = M.tally[off], T2 = M.tally[def];
  T1.poss++; M.poss[off]++;
  const P = push(M, { k: 'P', s: off, st: g.start, f: fouled ? 1 : 0, l: M.lineup }, t0);
  const foulBy = () => {
    const ok = dmen.filter(m => D.pf[m.id] < M.limit);
    /* a man one or two fouls from the limit defends with care (CARE): the five's fouls go more to the others */
    const m = pickBy(R, ok.length ? ok : dmen, x => x.pf * (D.pf[x.id] >= M.limit - 1 ? CARE[0] : D.pf[x.id] >= M.limit - 2 ? CARE[1] : 1));
    if (!m) return null;
    D.pf[m.id]++; lineOf(M, def, m.id).pf++; T2.pf++;
    D.tf[Math.min(9, g.per)]++;
    return m.id;
  };
  const scored = n => {
    if (!n) return;
    g.score[off] += n; pts += n;
    O.floor.forEach(id => { lineOf(M, off, id).pm += n; }); D.floor.forEach(id => { lineOf(M, def, id).pm -= n; });
  };
  /* free throws at his own rate; whether the last one missed (its board: winsim's 0.12 of the offensive rate) */
  let lastMiss = false;
  const trip = (m, n) => { let made = 0; for (let i = 0; i < n; i++) { lastMiss = !(R() < m.ft); if (!lastMiss) made++; } T1.fta += n; T1.ftm += made; const B = lineOf(M, off, m.id); B.fta += n; B.ftm += made; B.pts += made; T1.pts += made; return made; };
  const ftBoard = ch => {
    if (R() < 0.12 * r.orb) { const rb = pickBy(R, men, x => x.orb); rebound(M, off, rb.id, true); ch.ev.push({ k: 'O', s: off, p: rb.id }); prevReb = rb.id; return true; }
    const rb = pickBy(R, dmen, x => x.drb); rebound(M, def, rb.id, false); ch.ev.push({ k: 'D', s: def, p: rb.id }); return false;
  };
  for (let c = 0; c < 6 && cont; c++) {
    cont = false;
    T1.chances++;
    const ch = { kind: '', ev: [] };
    chances.push(ch);
    const tr = !fouled && c === 0 && g.start !== 0 && R() < r.tr;
    if (tr) { trans = true; T1.tr_ch++; }
    /* the man with the ball: by his share of the plays; in transition the runners; after an offensive board the
       rebounder, often (a put-back) */
    const meanTr = men.reduce((a, m) => a + m.s * m.tr, 0) || 1;
    const m = pickBy(R, men, x => x.s * (tr ? clamp(x.tr / meanTr, 0.2, 4) : 1) * (prevReb && x.id === prevReb ? 3 : 1));
    if (fouled && c === 0) {
      /* the end-game foul: two free throws to a ball handler (the best shooter at the line) */
      const shooter = pickBy(R, men, x => x.ft * x.ft * (0.4 + x.s));
      const f = foulBy();
      const made = trip(shooter, 2);
      ch.ev.push({ k: 'F', s: off, kind: 3, n: 2, m: made, p: shooter.id, f });
      scored(made);
      if (lastMiss) { if (ftBoard(ch)) cont = true; else next = 1; } else next = 0;
      continue;
    }
    /* a turnover: his own rate, against this defence, his legs and the game's form */
    const pTov = expit(m.tovL - e);
    if (R() < pTov) {
      T1.tov++; lineOf(M, off, m.id).tov++;
      const live = R() < r.live;
      let st = null, of = 0;
      if (live) { T1.to_live++; const sl = pickBy(R, dmen, x => x.stl); if (sl) { lineOf(M, def, sl.id).stl++; st = sl.id; T2.stl++; } }
      /* a dead ball: an offensive foul, sometimes - his foul, his team's */
      else if (R() < OFF_FOUL && O.pf[m.id] < M.limit) { of = 1; O.pf[m.id]++; lineOf(M, off, m.id).pf++; T1.pf++; O.tf[Math.min(9, g.per)]++; }
      ch.ev.push({ k: 'T', s: off, live: live ? 1 : 0, p: m.id, st, of: of || null });
      next = live ? 2 : 0;
      break;
    }
    /* a trip to the line: a foul in the bonus, or a shooting foul (a three on a three, ft3 of them) */
    const u4 = R();
    if (u4 < m.sf + m.bo) {
      const bonus = u4 < m.bo, n = bonus ? 2 : (R() < ft3 ? 3 : 2);
      const f = foulBy();
      const made = trip(m, n);
      ch.ev.push({ k: 'F', s: off, kind: bonus ? 0 : 1, n, m: made, p: m.id, f });
      scored(made);
      if (lastMiss) { if (ftBoard(ch)) cont = true; else next = 1; } else next = 0;
      continue;
    }
    /* a shot from his own mix; made at his own rate, the transition bonus split around the side's transition share */
    const u5 = R();
    const zi = u5 < m.mix.rim ? 0 : u5 < m.mix.rim + m.mix.mid ? 1 : 2, z = ZN[zi];
    const pl = m.pL[z] + e + sft + (tr ? dTr * (1 - sTr) : -dTr * sTr);
    const made = R() < expit(pl), three = zi === 2, val = three ? 3 : 2;
    const B = lineOf(M, off, m.id);
    T1.fga++; B.fga++;
    if (three) { T1.fg3a++; B.p3a++; } else if (zi === 0) { T1.rim_a++; B.rimA++; } else { T1.mid_a++; B.midA++; }
    if (made) {
      T1.fgm++; B.fgm++; B.pts += val; T1.pts += val;
      if (three) { T1.fg3m++; B.p3m++; } else if (zi === 0) { T1.rim_m++; B.rimM++; } else { T1.mid_m++; B.midM++; }
      /* the assist: by his own assisted share at that zone, to a teammate by his passing */
      let a = null;
      if (R() < 1 - (m.un[z] != null ? m.un[z] : 0.4)) { const a1 = pickBy(R, men.filter(x => x !== m), x => x.ast); if (a1) { lineOf(M, off, a1.id).ast++; a = a1.id; T1.ast++; } }
      ch.ev.push({ k: 'S', s: off, z: zi, m: 1, tr: tr ? 1 : 0, p: m.id, a, b: null, pb: prevReb === m.id ? 1 : 0 });
      scored(val);
      if (tr) T1.tr_pts += val;
      M.lastMade[off] = m.id;
      /* the and-one */
      if (R() < m.and1) {
        const f = foulBy();
        const a1 = trip(m, 1);
        ch.ev.push({ k: 'F', s: off, kind: 2, n: 1, m: a1, p: m.id, f });
        scored(a1);
        if (lastMiss) { if (ftBoard(ch)) cont = true; else next = 1; continue; }
      }
      next = 0;
      continue;
    }
    /* a miss: blocked (a two, by the defence's shot blockers), then the board */
    let b = null;
    if (zi !== 2) {
      const blk5 = dmen.reduce((x, d) => x + d.blk, 0) / 100;
      if (R() < Math.min(0.45, blk5 / Math.max(0.25, 1 - expit(pl)))) { const bl = pickBy(R, dmen, d => d.blk); if (bl) { lineOf(M, def, bl.id).blk++; b = bl.id; T2.blk++; } }
    }
    ch.ev.push({ k: 'S', s: off, z: zi, m: 0, tr: tr ? 1 : 0, p: m.id, a: null, b, pb: prevReb === m.id ? 1 : 0 });
    if (R() < r.orb) { const rb = pickBy(R, men, x => x.orb); rebound(M, off, rb.id, true); ch.ev.push({ k: 'O', s: off, p: rb.id }); prevReb = rb.id; cont = true; }
    else { const rb = pickBy(R, dmen, x => x.drb); rebound(M, def, rb.id, false); ch.ev.push({ k: 'D', s: def, p: rb.id }); next = 1; }
  }
  /* THE CLOCK OF THE POSSESSION (engine.js clockOf, one possession at a time): a break 2-6 s to its first shot, a
     put-back 2-5 s after its board, a set play's last chance late in its possession; its length the five's pace (d, the
     matchup's: both fives) on the game's pace, a set play's share of the time the breaks save */
  /* DUR_K: the last possession of each quarter is cut short by the buzzer (winsim fits its possessions to the period), so
     possessions are drawn a little longer to keep the count the league's */
  const dEff = DUR_K * r.d / (L.kappaN || 1) * M.noise.pace;
  /* a possession that might have been a break (it started from a board or a steal) and was not takes the time the
     breaks save, so the side's possessions last d on average whatever its transition rate (winsim's possessions do): a
     break lasts TR_DUR on average */
  const TR_DUR = 6.2, pTr = g.start !== 0 && !fouled ? clamp(r.tr, 0, 0.9) : 0;
  const hcMean = pTr > 0 ? Math.max(0.5 * dEff, (dEff - pTr * TR_DUR) / (1 - pTr)) : dEff;
  let dur, times = [];
  const n = chances.length;
  if (fouled) { dur = 3; let tt = t0 + Math.min(1.5, 0.8 + RT()); chances.forEach(() => { times.push(tt); tt += 1.5; }); }
  else if (trans) {
    let tt = t0 + 2 + 4 * RT();
    chances.forEach((_, j) => { if (j) tt += 2 + 3 * RT(); times.push(tt); });
    dur = times[times.length - 1] - t0 + 1 + RT();
  } else {
    dur = hcMean * (0.62 + 0.76 * RT());
    const end = t0 + dur, lastT = end - 0.6 - 0.8 * RT(), gaps = [];
    for (let j = 1; j < n; j++) gaps.push(2 + 3 * RT());
    const span = gaps.reduce((a, x) => a + x, 0), avail = Math.max(0, lastT - (t0 + 1.5)), f = span > avail ? avail / span : 1;
    let tt = lastT - span * f;
    times.push(tt);
    gaps.forEach(x => { tt += x * f; times.push(tt); });
  }
  /* the period's last possession: what is left of it */
  if (dur >= g.left - 0.05) {
    const left = Math.max(0.5, g.left), f = left / Math.max(0.5, dur);
    times = times.map(x => t0 + (x - t0) * Math.min(1, f));
    dur = left;
  }
  /* the possession's events, on its clock: each chance's at its second, a board just after the miss it follows; a foul
     that gives no free throws (before the bonus, on the ball, off it: a few a game, by the defence) before the first */
  const list = [];
  chances.forEach((ch, j) => ch.ev.forEach(ev => {
    const at = ev.k === 'O' || ev.k === 'D' ? Math.min(times[j] + 0.8, t0 + dur - 0.05) : times[j];
    list.push({ ev, at: Math.min(at, t0 + dur - 0.05) });
  }));
  if (!fouled && R() < M.fRate) { const f = foulBy(); if (f) list.push({ ev: { k: 'f', s: def, p: f }, at: t0 + Math.max(0.3, ((times[0] != null ? times[0] : t0 + dur) - t0) * (0.25 + 0.5 * RT())) }); }
  list.map((x, i) => [x, i]).sort((a, b) => (a[0].at - b[0].at) || (a[1] - b[1])).forEach(([x]) => push(M, x.ev, x.at));
  /* the run, for the coaches' timeouts */
  if (pts > 0) { O.runFor += pts; O.runAg = 0; D.runAg += pts; D.runFor = 0; }
  /* the clock moves; the legs of the men on the floor go, the bench's come back */
  const secs = dur;
  [0, 1].forEach(s => {
    const sd = M.sides[s];
    sd.roster.forEach(id => {
      if (sd.floor.includes(id)) {
        sd.sec[id] = (sd.sec[id] || 0) + secs;
        lineOf(M, s, id).min += secs / 60;
        sd.en[id] = Math.max(0, (sd.en[id] || 0) - drainOf(M, sd, id) * secs / 60);
      } else sd.en[id] = Math.min(100, (sd.en[id] || 0) + ENERGY.rest * secs / 60);
    });
  });
  g.t = t0 + dur; g.left -= dur; g.k++;
  P.d = Math.round(dur * 10) / 10;
  g.off = def; g.start = next;
  /* the period ends */
  if (g.left <= 0.05) endPeriod(M);
  return !g.over;
}
/* a board, to the box */
function rebound(M, s, id, offensive) {
  const B = lineOf(M, s, id);
  if (offensive) { B.oreb++; M.tally[s].oreb++; } else { B.dreb++; M.tally[s].dreb++; }
  B.reb++;
}
/* his legs' drain a minute: the league's average at a fifth of the plays and his usual minutes; more of the ball, a man
   not used to big minutes, and a running, gambling, crashing game cost more */
function drainOf(M, sd, id) {
  const c = sd.T.cards.get(id) || {}, five = sd._lastFive;
  const share = five && five.has(id) ? five.get(id) : 0.2;
  const cond = clamp(Math.sqrt(30 / Math.max(8, c.mpg || 20)), 0.75, 1.5);
  const tac = sd.tac || planAt(sd.T.segs, M.g.t / 60, M.G).tac || {};
  const ins = sd.T.ins && sd.T.ins.get(id), busy = ins && ins.k ? ['push', 'gam', 'crash', 'rima', 'hedge', 'agg'].filter(k => ins.k.has(k)).length : 0;
  const intensity = 1 + 0.12 * (+tac.leak || 0) + 0.10 * (+tac.gamble || 0) + 0.06 * (+tac.crash || 0) + 0.06 * busy;
  return ENERGY.drain * (0.75 + 1.25 * share) * cond * intensity;
}
function endPeriod(M) {
  const g = M.g;
  g.left = 0;
  const tied = g.score[0] === g.score[1];
  if (g.per < 3 || (g.per >= 3 && tied && g.ot < 6)) {
    /* the next period: the rest of the break, the half's timeouts, the arrow (FIBA: alternating, from the jump) */
    const half = g.per === 1, ot = g.per >= 3;
    const rest = half ? ENERGY.half : ot ? ENERGY.ot : ENERGY.quarter;
    M.sides.forEach(sd => { sd.roster.forEach(id => { sd.en[id] = Math.min(100, (sd.en[id] || 0) + rest); }); sd.hold = -1; });
    if (half) M.sides.forEach(sd => { sd.to = TIMEOUTS.second; });
    if (ot) M.sides.forEach(sd => { sd.to = TIMEOUTS.ot; });
    g.per++;
    if (g.per >= 4) { g.ot = g.per - 3; g.left = M.Tot; push(M, { k: 'Q', p: g.ot }, g.t); g.off = (g.first ^ (g.ot & 1)); }
    else { g.left = M.T / 4; g.off = g.first ^ (g.per % 2); push(M, { k: 'q', p: g.per }, g.t); }
    g.start = 0; g.fresh = true;
    return;
  }
  if (tied) { const w = (M.seed & 1) ? 0 : 1; g.score[w] += 1; M.tally[w].pts += 1; push(M, { k: 'X', s: w }, g.t); }
  g.over = true;
  const cur = M.lineups[M.lineup]; if (cur) cur.t1 = g.t / 60;
}

/* ------------------------------------------------------------------ to a time, to the end --- */
function runTo(M, sec) { let n = 0; while (!M.g.over && M.g.t < sec && n < 2000) { step(M); n++; } return M; }
function finish(M) { let n = 0; while (!M.g.over && n < 4000) { step(M); n++; } return M; }
/* the share of the plays each man on the floor had at his last possession (his legs' drain) */
function refreshShares(M) {
  M.sides.forEach(sd => {
    try {
      const min = M.g.t / 60, side = sd.sideFor(sd.floor, sd.tac || planAt(sd.T.segs, min, M.G).tac || null, rolesAt(sd, min, M.G));
      sd._lastFive = new Map(side.men.map(m => [String(m.id), m.s]));
    } catch (_) { sd._lastFive = null; }
  });
}

/* ------------------------------------------------------------------ the result --- */
function result(M) {
  const box = [0, 1].map(s => Object.values(M.box[s]).map(b => Object.assign({}, b, { min: Math.round(b.min * 10) / 10 })));
  /* every man of the rotation has a line (a man who never played: a line of zeros, as engine.play gives) */
  [0, 1].forEach(s => M.sides[s].roster.forEach(id => { if (!M.box[s][id]) box[s].push(Object.assign({}, lineOf(M, s, id))); }));
  const tally = M.tally.map(t => Object.assign({}, t, { fg3a: t.fg3a, fg3m: t.fg3m }));
  return { pts: M.g.score.slice(), ot: M.g.ot, poss: M.poss.slice(), tally, box, events: M.events.slice(), lineups: M.lineups.map(x => ({ t0: x.t0, t1: x.t1, h: x.h.slice(), a: x.a.slice() })) };
}
/* the whole game, now: what season.js plays for a game nobody is watching */
function play(H, A, X, o) {
  const M = create(H, A, X, o);
  const wrapStep = () => { refreshShares(M); return step(M); };
  let n = 0;
  while (!M.g.over && n < 4000) { wrapStep(); n++; }
  return result(M);
}

/* ------------------------------------------------------------------ a game kept --- */
/* what a game in progress keeps (JSON): everything but the teams' cards and the rate caches, which come back from the
   teams handed to restore - so a game interrupted goes on with the same men, its past exactly as it was */
function snapshot(M) {
  const sides = M.sides.map(sd => ({ id: sd.id, floor: sd.floor.slice(), tac: sd.tac, pf: sd.pf, en: sd.en, sec: sd.sec, tf: sd.tf, to: sd.to, auto: sd.auto, hold: sd.hold === Infinity ? 1e9 : sd.hold,
    runFor: sd.runFor, runAg: sd.runAg, pend: sd.pend, wantTO: !!sd.wantTO, ins: insObj(sd.T.ins), roster: sd.roster, roleOv: sd.roleOv || null }));
  return { v: 1, seed: M.seed, home: M.home, G: M.G, g: M.g, noise: M.noise, exp: M.exp, events: M.events, lineups: M.lineups, lineup: M.lineup, log: M.log, box: M.box, tally: M.tally, poss: M.poss, lastMade: M.lastMade, sides };
}
function restore(snap, H, A, X) {
  const M = create(H, A, X, { seed: snap.seed, home: snap.home });
  const J = x => JSON.parse(JSON.stringify(x));
  Object.assign(M, { g: J(snap.g), noise: J(snap.noise), exp: snap.exp, events: J(snap.events), lineups: J(snap.lineups), lineup: snap.lineup, log: J(snap.log), box: J(snap.box), tally: J(snap.tally),
    poss: snap.poss.slice(), lastMade: snap.lastMade.slice() });
  snap.sides.forEach((x, s) => {
    const sd = M.sides[s];
    if (x.ins) { sd.T = Object.assign({}, sd.T, { ins: insMap(x.ins) }); sd.sideFor = sidesOf(sd.T, X); }
    const roster = new Set(sd.roster.concat(x.roster || []));
    sd.roster = [...roster].filter(id => sd.T.cards.has(id));
    Object.assign(sd, { floor: x.floor.filter(id => sd.T.cards.has(id)), tac: x.tac, pf: Object.assign({}, sd.pf, x.pf), en: Object.assign({}, sd.en, x.en), sec: Object.assign({}, sd.sec, x.sec), tf: x.tf.slice(), to: x.to,
      auto: x.auto, hold: x.hold >= 1e9 ? Infinity : x.hold, runFor: x.runFor, runAg: x.runAg, pend: (x.pend || []).slice(), wantTO: !!x.wantTO, roleOv: x.roleOv ? Object.assign({}, x.roleOv) : null });
    /* a man of the five no longer to hand (a league file that changed): the coach fills the place */
    while (sd.floor.length < 5) { const av = available(M, sd); if (!av.length) break; sd.floor.push(av[0]); }
  });
  return M;
}

/* the step a live game takes (the shares of the plays refreshed for the legs first) */
function liveStep(M) { refreshShares(M); return step(M); }
function liveRunTo(M, sec) { let n = 0; while (!M.g.over && M.g.t < sec && n < 2000) { liveStep(M); n++; } return M; }
function liveFinish(M) { let n = 0; while (!M.g.over && n < 4000) { liveStep(M); n++; } return M; }

return { create, step: liveStep, runTo: liveRunTo, finish: liveFinish, act, result, play, snapshot, restore, insMap, insObj, planAt, rolesAt, pen, ENERGY, TIMEOUTS, TROUBLE, rng, hashOf, available };
}));
