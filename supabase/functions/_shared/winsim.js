/* GENERATED from epinoia/winsim.js by supabase/tests/extract-shared.mjs — do not edit. */
'use strict';
/* ============================================================================
   WHAT WINS: THE GAME SIMULATOR. A possession-level Markov chain of a basketball game.     window.EpinoiaWinSim

   The Simulate lens (MODEL). A side is a set of rates at each end of the floor (§8.1 of docs/what-wins-model.md),
   shrunk toward the league; two sides meet through a log5 blend with the home court on the logit scale; a game is a
   number of possessions set by both sides' seconds per possession, and each possession is up to six chances:
   transition, turnover (live or dead), a bonus trip, a shooting foul, a shot from a zone, its make, the rebound and
   the and-one. Pure: no I/O, no DOM. The builder calibrates it in node (calibrate), the page and the Front office run
   it in a Web Worker (epinoia/winsim.worker.js) with the same file.

   COMMON RANDOM NUMBERS. Game i draws from rng(seed ^ (i * 0x9E3779B9)): its game-level draws first (two seeds, both
   sides' form, the possessions' noise, two coins: always eight uniforms), then possession k of the game draws from its
   own stream seeded from those (eight uniforms a chance, always eight, whatever the chance did) and its free throws
   from a second stream seeded from rng(seed ^ i ^ 0x85EBCA6B). So two arms of a what-if with the same seed play the
   same games possession for possession, and a change in one possession does not reshuffle the rest of the game.

   THE RATES (per end; offence from a side's own rows, defence from its opponents')
     d      seconds per possession            tov    turnovers per chance          live   live share of turnovers
     sfoul  shooting-foul trips per chance    bonus  bonus trips per chance
     mixRim, mixMid, mix3  the shot mix       pRim, pMid, p3, p2  make rates      and1   and-ones per make
     ft     free-throw %                      orb    chances won back              tr     transition chances per chance
                                                                                         after a defensive board or steal
   Without zones the two-zone form (p2, mix3) is used.

   CHECKED ON REAL LINES (CEBL 2026, 108 games; ORLEN Basket Liga 2025-26, 275 games; feature lines from the public
   logs through epinoia/features.js), which is what set four details §8 leaves open:
     * trips are per chance that did not end in a turnover, every free throw that is not a shooting trip's or an
       and-one counts as a two-shot trip, and a shooting foul is a three-shot trip with probability ft3 (0.05), not
       the three-point share of the mix: so the simulator's free throws a game are the feed's;
     * orb is per missed shot (a miss with no rebound logged was not won back);
     * the transition bonus dTr is split around the side's transition share of chances (half-court - dTr s,
       transition + dTr (1 - s)), so it separates the two without moving the side's average;
     * real margins spread less than independent possessions let them (0.8 of the chain's SD): the score effect
       `lead` pulls each side toward the game's expected path, and calibrate() fits it when the simulator is too loose
       (tau when it is too tight). With them: pace and ortg within 0.5, margin SD ratio 0.98-1.03, home win share
       exact (in-sample profiles).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinSim = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* the globals the hot loops use, held locally: a lookup on a sandboxed global object (node's vm, some embeds)
   is far slower than a local one */
const Mth = Math, isFin = isFinite;
let WSc = null;
const WS = () => WSc || (WSc = root.EpinoiaWinStats || (typeof require === 'function' ? require('./winstats.js') : null));
const isNum = v => typeof v === 'number' && isFin(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cp = p => clamp(p, 1e-6, 1 - 1e-6);
const logit = p => Mth.log(cp(p) / (1 - cp(p)));
const expit = x => (x >= 0 ? 1 / (1 + Mth.exp(-x)) : Mth.exp(x) / (1 + Mth.exp(x)));

const RATES = ['d', 'tov', 'live', 'sfoul', 'bonus', 'mixRim', 'mixMid', 'mix3', 'pRim', 'pMid', 'p3', 'p2', 'and1', 'ft', 'orb', 'tr'];
const K_PRIOR = { d: 20, tov: 150, live: 40, sfoul: 150, bonus: 150, mixRim: 100, mixMid: 100, mix3: 100, pRim: 80, pMid: 80,
  p3: 150, p2: 150, and1: 100, ft: 60, orb: 100, tr: 150 };
/* the groups of the loss Shapley (§8.4) */
const GROUPS = { shooting: ['pRim', 'pMid', 'p3', 'p2', 'and1'], mix: ['mixRim', 'mixMid', 'mix3'], turnovers: ['tov', 'live'],
  boards: ['orb'], ft: ['sfoul', 'bonus', 'ft'], tempo: ['d', 'tr'] };
/* the edits of a what-if, in natural units */
const EDITS = ['efg', 'tovp', 'orebp', 'ftr', 'p3r', 'secs'];
const RANGE = { efg: [-15, 15], tovp: [-10, 10], orebp: [-15, 15], ftr: [-20, 20], p3r: [-20, 20], secs: [-5, 5] };
/* a league that looks like a FIBA league: the default for a missing rate and for synth */
const LG = { d: 16.7, tov: 0.14, live: 0.55, sfoul: 0.075, bonus: 0.045, mixRim: 0.3, mixMid: 0.3, mix3: 0.4, pRim: 0.6,
  pMid: 0.4, p3: 0.34, p2: 0.5, and1: 0.05, ft: 0.72, orb: 0.28, tr: 0.18 };

/* ------------------------------------------------------------ rates from counts --- */
/* The share of shooting-foul trips that are on a three (three free throws). A shooting foul in the simulator is a
   three-shot trip with this probability, not with the three-point share of the shot mix: fouls come at the rim, and
   the feeds checked give 0-6% (CEBL 2026: 1.94 free throws a shooting trip). */
const FT3 = 0.05;
/* One end's {rate: {x, n}} from summed feature-line counts (LAYOUT names): own = the side's rows, opp = its
   opponents'. o: {foulKinds, split, and1, ft3}.
   FREE THROWS ARE CONSERVED: shooting trips are sfoul; every other free throw that is not an and-one (bonus trips,
   technicals, flagrants, fouls with no kind) is counted as two-shot trips without a shot (bonus), so the simulator's
   free throws a chance match the feed's.
   Without foul kinds (the FOULKIND bit off: a feed that logs every foul as 'personal' still counts trips_shooting and
   and1 as 0, §8.1 "without FOULKIND: the league's split of ft_trips") the trips less the and-ones (found from the
   chance accounting) are split by o.split, the shooting share (default 0.625).
   TRIPS are per chance that did not end in a turnover: the chance tests the turnover first (§8.2), so that is the
   rate that gives the feed's trips a game.
   BOARDS: orb is per missed shot, (fga - fgm) plus 0.12 of the missed last free throws (the simulator wins those back
   at 0.12 orb); a miss the log gives no rebound to is a miss the offence did not win back. */
function endInput(own, opp, o) {
  const g = k => (own && isNum(own[k]) ? own[k] : NaN), go = k => (opp && isNum(opp[k]) ? opp[k] : NaN);
  const to = isNum(g('to_n')) ? g('to_n') : g('tov');
  const e = (x, n) => ({ x, n });
  const ft3 = o && isNum(o.ft3) ? o.ft3 : FT3;
  /* foul kinds known: o.foulKinds, else the rows' FOULKIND bit (64) when they carry q, else the counts themselves */
  const fk = o && o.foulKinds != null ? !!o.foulKinds : isNum(own && own.q) ? !!(own.q & 64) : isNum(g('trips_shooting')) && isNum(g('trips_bonus'));
  let ts = g('trips_shooting'), tb = g('trips_bonus'), a1 = g('and1');
  if (!fk) {
    /* a chance ends in a turnover, a trip that is not an and-one, or a shot: so the and-ones are what the accounting
       leaves over (turnovers + trips + FGA - chances), else o.and1 (or the reference's 0.05) a make */
    const share = o && isNum(o.split) ? o.split : LG.sfoul / (LG.sfoul + LG.bonus);
    const acct = to + g('ft_trips') + g('fga') - g('chances');
    const a1e = isNum(acct) ? clamp(acct, 0, g('ft_trips')) : (o && isNum(o.and1) ? o.and1 : LG.and1) * g('fgm');
    const rest = Mth.max(0, g('ft_trips') - a1e);
    ts = rest * share; a1 = isNum(acct) ? a1e : NaN;
    tb = isNum(g('fta')) ? Mth.max(0, (g('fta') - a1e - (2 + ft3) * ts) / 2) : rest * (1 - share);
  } else if (isNum(ts) && isNum(g('fta'))) {
    tb = Mth.max(0, (g('fta') - (isNum(a1) ? a1 : 0) - (2 + ft3) * ts) / 2);
  }
  const ftp = g('fta') > 0 ? g('ftm') / g('fta') : NaN;
  const ftMiss = isNum(g('ft_trips')) && isNum(ftp) ? g('ft_trips') * (1 - ftp) : 0;
  const miss = g('fga') - g('fgm');
  const nOrb = isNum(miss) ? miss + 0.12 * ftMiss : g('reb_off_ch') + g('reb_def_ch');
  return {
    d: e(g('timed_s'), g('timed_n')), tov: e(to, g('chances')), live: e(g('to_live'), to),
    sfoul: e(ts, g('chances') - to), bonus: e(tb, g('chances') - to),
    mixRim: e(g('rim_a'), g('fga')), mixMid: e(g('mid_a'), g('fga')), mix3: e(g('fg3a'), g('fga')),
    pRim: e(g('rim_m'), g('rim_a')), pMid: e(g('mid_m'), g('mid_a')), p3: e(g('fg3m'), g('fg3a')),
    p2: e(g('fgm') - g('fg3m'), g('fga') - g('fg3a')), and1: e(a1, g('fgm')), ft: e(g('ftm'), g('fta')),
    orb: e(g('reb_off_ch'), nOrb), tr: e(g('tr_ch'), g('gain_dreb') + go('to_live'))
  };
}
/* the raw ratios of an end's counts (a league's rates from its totals: ratesOf(endInput(all, all))) */
function ratesOf(input) {
  const r = {};
  for (const k of RATES) {
    const v = input[k];
    r[k] = v && typeof v === 'object' ? (isNum(v.x) && v.n > 0 ? v.x / v.n : NaN) : isNum(v) ? v : NaN;
  }
  if (isNum(r.tr)) r.tr = Mth.min(0.95, r.tr);
  return r;
}
function normMix(r) {
  const s = r.mixRim + r.mixMid + r.mix3;
  if (isNum(s) && s > 0) { r.mixRim /= s; r.mixMid /= s; r.mix3 /= s; }
  return r;
}
function shrinkEnd(e, mu) {
  const r = {};
  for (const k of RATES) {
    const v = e ? e[k] : null, m = mu && isNum(mu[k]) ? mu[k] : LG[k], kp = K_PRIOR[k];
    if (isNum(v)) { r[k] = v; continue; }
    const ok = v && isNum(v.x) && v.n > 0;
    r[k] = ok ? (v.x + kp * m) / (v.n + kp) : m;
  }
  r.tr = Mth.min(0.95, r.tr);
  return normMix(r);
}
/* a side: each rate shrunk (x + k mu) / (n + k) toward the league (lg = the league object with .rates, or the rates) */
function profile(input, lg) {
  const mu = lg && lg.rates ? lg.rates : lg;
  return { off: shrinkEnd(input && input.off, mu), def: shrinkEnd(input && input.def, mu), n: (input && input.games) || 0 };
}

/* ------------------------------------------------------------ the matchup --- */
const LDEF = { T: 2400, Tot: 300, kappaN: 1, sigmaN: 0, hca: 0, tau: 0, muOff: 0, dTr: 0, lead: 0, ft3: FT3, fouling: true };
function lcore(L) {
  const o = {};
  for (const k in LDEF) o[k] = L && L[k] != null ? L[k] : LDEF[k];
  return o;
}
const zonesOf = (L, mu) => !(L && L.zones === false) && isNum(mu.mixRim) && isNum(mu.mixMid) && isNum(mu.pRim) && isNum(mu.pMid);
/* side a's offence against side b's defence: log5 on the logit scale, the home court (hs = +1 / -1 / 0) on the makes
   (+) and the turnovers (-), the league make offset; the shot mix by log-ratios against threes; d = d_off d_def / d_lg */
function blendEnd(off, def, mu, L, hs, zones) {
  const hca = (L && L.hca) || 0, muOff = (L && L.muOff) || 0, r = {};
  const b = (k, shift) => {
    const a = off[k], d = def ? def[k] : NaN, m = mu[k];
    const base = isNum(d) && isNum(m) ? logit(a) + logit(d) - logit(m) : logit(a);
    return cp(expit(base + (shift || 0)));
  };
  r.tov = b('tov', -hs * hca);
  r.live = b('live'); r.sfoul = b('sfoul'); r.bonus = b('bonus'); r.and1 = b('and1'); r.orb = b('orb'); r.tr = Mth.min(0.95, b('tr'));
  r.ft = cp(off.ft);
  for (const k of ['pRim', 'pMid', 'p3', 'p2']) r[k] = b(k, hs * hca + muOff);
  const lr = (k, ref) => Mth.log(off[k] / off[ref]) + (def && isNum(def[k]) ? Mth.log(def[k] / def[ref]) - Mth.log(mu[k] / mu[ref]) : 0);
  if (zones) {
    const er = Mth.exp(lr('mixRim', 'mix3')), em = Mth.exp(lr('mixMid', 'mix3')), s = 1 + er + em;
    r.mix3 = 1 / s; r.mixRim = er / s; r.mixMid = em / s;
  } else {
    const two = k => 1 - k.mix3;
    const l2 = Mth.log(two(off) / off.mix3) + (def && isNum(def.mix3) ? Mth.log(two(def) / def.mix3) - Mth.log(two(mu) / mu.mix3) : 0);
    r.mix3 = 1 / (1 + Mth.exp(l2));
    const rim = isNum(off.mixRim) && isNum(off.mixMid) && off.mixRim + off.mixMid > 0 ? off.mixRim / (off.mixRim + off.mixMid) : 0.5;
    r.mixRim = (1 - r.mix3) * rim; r.mixMid = (1 - r.mix3) * (1 - rim);
  }
  r.d = def && isNum(def.d) && isNum(mu.d) ? off.d * def.d / mu.d : off.d;
  return r;
}
/* a profile's rates may come compact (a big league's fo file: each end an array in RATES order): read either way */
const rateObj = r => (Array.isArray(r) ? RATES.reduce((o, k, i) => { o[k] = r[i]; return o; }, {}) : r);
const profObj = P => (P && (Array.isArray(P.off) || Array.isArray(P.def)) ? { off: rateObj(P.off), def: rateObj(P.def), n: P.n } : P);
function matchup(A, B, L, o) {
  A = profObj(A); B = profObj(B);
  const home = o && o.home != null ? o.home : 0, mu = Object.assign({}, LG, (L && L.rates) || {}), zones = zonesOf(L, mu);
  return {
    v: 1, home, zones, L: lcore(L), lg: L || null, A, B,
    r: [blendEnd(A.off, B.def, mu, L, home, zones), blendEnd(B.off, A.def, mu, L, -home, zones)],
    platt: (o && o.platt) || (L && L.platt) || null
  };
}
/* a match from two sides' effective rates as they are (realised rates of a played game): no blend, no home court */
function matchFrom(ra, rb, L, o) {
  const mu = Object.assign({}, LG, (L && L.rates) || {});
  return { v: 1, home: o && o.home != null ? o.home : 0, zones: zonesOf(L, mu), L: lcore(L), lg: L || null, A: null, B: null,
    r: [Object.assign({}, ra), Object.assign({}, rb)], platt: (o && o.platt) || null };
}

/* ------------------------------------------------------------ one game --- */
const TALLY = ['pts', 'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm', 'oreb', 'dreb', 'tov', 'rim_a', 'rim_m', 'mid_a', 'mid_m',
  'poss', 'chances', 'to_live', 'trips_shooting', 'trips_bonus', 'and1', 'reb_off_ch', 'reb_def_ch', 'tr_ch', 'tr_pts',
  'timed_s', 'timed_n', 'gain_dreb'];
const NT = TALLY.length;
const [T_PTS, T_FGA, T_FGM, T_FG3A, T_FG3M, T_FTA, T_FTM, T_OREB, T_DREB, T_TOV, T_RIMA, T_RIMM, T_MIDA, T_MIDM, T_POSS, T_CH,
  T_LIVE, T_TRS, T_TRB, T_AND1, T_RBO, T_RBD, T_TRCH, T_TRPTS, T_TS, T_TN, T_GD] = TALLY.map((_, i) => i);
const NP = 18;   // prepared values a side
function prep(M) {
  const P = new Float64Array(2 * NP + 1);
  for (let s = 0; s < 2; s++) {
    const r = M.r[s], o = s * NP;
    P[o] = logit(r.tov); P[o + 1] = r.live; P[o + 2] = r.bonus; P[o + 3] = r.bonus + r.sfoul;
    if (M.zones) { P[o + 4] = r.mixRim; P[o + 5] = r.mixRim + r.mixMid; } else { P[o + 4] = 1 - r.mix3; P[o + 5] = 1 - r.mix3; }
    P[o + 6] = r.mix3; P[o + 7] = logit(r.pRim); P[o + 8] = logit(r.pMid); P[o + 9] = logit(r.p3); P[o + 10] = logit(r.p2);
    P[o + 11] = r.and1; P[o + 12] = r.ft; P[o + 13] = r.orb; P[o + 14] = 0.12 * r.orb; P[o + 15] = r.tr; P[o + 16] = r.d;
  }
  /* the transition share of a side's chances: its transition rate x the share of its possessions that start from the
     other side's defensive board or live turnover, over its chances a possession (all from the Markov chain); the
     transition bonus is split around it so it moves transition against half-court, not the side's average */
  const mk = [markov(M, 0), markov(M, 1)];
  for (let s = 0; s < 2; s++) P[s * NP + 17] = clamp(M.r[s].tr * (mk[1 - s].dreb + mk[1 - s].live) / mk[s].chances, 0, 0.95);
  /* the expected regulation margin (A - B) the score effect pulls toward: possessions x the Markov points a possession */
  if (M.L && M.L.lead) P[2 * NP] = M.L.kappaN * M.L.T / (P[16] + P[NP + 16]) * (mk[0].ppp - mk[1].ppp);
  return P;
}
function fmix(h) {
  h ^= h >>> 16; h = Mth.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Mth.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return h | 0;
}
function gaussian(rand) { const u1 = rand(), u2 = rand(); return Mth.sqrt(-2 * Mth.log(1 - u1)) * Mth.cos(2 * Mth.PI * u2); }
const RES = new Float64Array(5);   // pts A, pts B, poss A, poss B, overtimes
const GP = new Float64Array(18);   // per game: per side [tov, rim, mid, 3, 2, rim T, mid T, 3 T, 2 T]
const GL = new Float64Array(18);   // ...the same on the logit scale (for the score effect)
/* the engine: P from prep, zones, Lc the core league numbers, two uniform sources, tl = tallies (2 x NT) or null */
function core(P, zones, home, Lc, rand, randFt, fouling, tl) {
  const base = (rand() * 4294967296) | 0, baseFt = (randFt() * 4294967296) | 0;
  const tau = Lc.tau || 0, e0 = tau * gaussian(rand), e1 = tau * gaussian(rand), eta = (Lc.sigmaN || 0) * gaussian(rand);
  const coinN = rand(), coinOT = rand(), dTr = Lc.dTr || 0, lead = Lc.lead || 0, ft3 = Lc.ft3 != null ? Lc.ft3 : FT3;
  for (let s = 0; s < 2; s++) {
    const o = s * NP, g = s * 9, e = s ? e1 : e0;
    GP[g] = expit(P[o] - e);
    const sTr = P[o + 17];
    for (let z = 0; z < 4; z++) {
      GL[g + 1 + z] = P[o + 7 + z] + e - dTr * sTr; GL[g + 5 + z] = P[o + 7 + z] + e + dTr * (1 - sTr);
      GP[g + 1 + z] = expit(GL[g + 1 + z]); GP[g + 5 + z] = expit(GL[g + 5 + z]);
    }
  }
  const score = [0, 0], np = [0, 0];
  let k = 0, cs = 0, fs = 0, lastMiss = false, frac = 0;
  const u = () => {
    cs = (cs + 0x6D2B79F5) | 0;
    let t = Mth.imul(cs ^ (cs >>> 15), 1 | cs);
    t = (t + Mth.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fu = () => {
    fs = (fs + 0x6D2B79F5) | 0;
    let t = Mth.imul(fs ^ (fs >>> 15), 1 | fs);
    t = (t + Mth.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const trip = (off, n) => {
    const pft = P[off * NP + 12];
    let made = 0;
    for (let i = 0; i < n; i++) { lastMiss = !(fu() < pft); if (!lastMiss) made++; }
    if (tl) { tl[off * NT + T_FTA] += n; tl[off * NT + T_FTM] += made; }
    return made;
  };
  /* one possession: returns how the other side's next possession starts (0 dead ball, 1 defensive rebound, 2 steal) */
  const possession = (off, st, dur, fouled) => {
    const def = off ^ 1, o = off * NP, g = off * 9, tb = off * NT, td = def * NT;
    cs = fmix(base ^ Mth.imul(k + 1, 0x9E3779B9)); fs = fmix(baseFt ^ Mth.imul(k + 1, 0x85EBCA6B)); k++; np[off]++;
    if (tl) { tl[tb + T_POSS]++; tl[tb + T_TS] += dur; tl[tb + T_TN]++; if (st === 1) tl[tb + T_GD]++; }
    let pts = 0, next = 0, ended = false;
    /* the score effect: a side running ahead of the game's expected path (the pre-game expected margin x the share of
       regulation played) makes a little less, a side behind it a little more: lead per 10 points of the gap, capped
       at 20. Real margins spread less than independent possessions would let them (CEBL and ORLEN 2026: a margin SD
       about 0.8 of the independent chain's); pulling toward the expected path, not toward a tie, narrows the spread
       without moving the favourite's expected margin. */
    let sft = 0;
    if (lead) {
      const gap = score[off] - score[def] - (off ? -1 : 1) * P[2 * NP] * frac;
      sft = -lead * (gap > 20 ? 20 : gap < -20 ? -20 : gap) / 10;
    }
    for (let c = 0; c < 6; c++) {
      const u1 = u(), u2 = u(), u3 = u(), u4 = u(), u5 = u(), u6 = u(), u7 = u(), u8 = u();
      if (tl) tl[tb + T_CH]++;
      let cpts = 0, cont = false;
      const trans = !fouled && c === 0 && st !== 0 && u1 < P[o + 15];
      if (fouled && c === 0) {                                     // end-game foul: two free throws
        if (tl) tl[tb + T_TRB]++;
        cpts = trip(off, 2);
        if (lastMiss) { if (u7 < P[o + 14]) { cont = true; if (tl) { tl[tb + T_OREB]++; tl[tb + T_RBO]++; } } else { next = 1; if (tl) { tl[td + T_DREB]++; tl[tb + T_RBD]++; } } }
      } else if (u2 < GP[g]) {                                     // turnover
        if (tl) tl[tb + T_TOV]++;
        if (u3 < P[o + 1]) { next = 2; if (tl) tl[tb + T_LIVE]++; } else next = 0;
      } else if (u4 < P[o + 3]) {                                  // a trip: bonus, or a shooting foul (3 on a three)
        const bonus = u4 < P[o + 2], nft = bonus ? 2 : (u5 < ft3 ? 3 : 2);
        if (tl) tl[tb + (bonus ? T_TRB : T_TRS)]++;
        cpts = trip(off, nft);
        if (lastMiss) { if (u7 < P[o + 14]) { cont = true; if (tl) { tl[tb + T_OREB]++; tl[tb + T_RBO]++; } } else { next = 1; if (tl) { tl[td + T_DREB]++; tl[tb + T_RBD]++; } } }
        else next = 0;
      } else {                                                     // a shot
        let z;
        if (u5 < P[o + 4]) z = zones ? 0 : 3; else if (u5 < P[o + 5]) z = 1; else z = 2;
        const zi = g + (trans ? 5 : 1) + z, pm = sft ? expit(GL[zi] + sft) : GP[zi], three = z === 2, val = three ? 3 : 2;
        if (tl) { tl[tb + T_FGA]++; if (three) tl[tb + T_FG3A]++; else if (z === 0) tl[tb + T_RIMA]++; else if (z === 1) tl[tb + T_MIDA]++; }
        if (u6 < pm) {
          cpts = val;
          if (tl) { tl[tb + T_FGM]++; if (three) tl[tb + T_FG3M]++; else if (z === 0) tl[tb + T_RIMM]++; else if (z === 1) tl[tb + T_MIDM]++; }
          next = 0;
          if (u8 < P[o + 11]) {
            if (tl) tl[tb + T_AND1]++;
            cpts += trip(off, 1);
            if (lastMiss) { if (u7 < P[o + 14]) { cont = true; if (tl) { tl[tb + T_OREB]++; tl[tb + T_RBO]++; } } else { next = 1; if (tl) { tl[td + T_DREB]++; tl[tb + T_RBD]++; } } }
          }
        } else if (u7 < P[o + 13]) { cont = true; if (tl) { tl[tb + T_OREB]++; tl[tb + T_RBO]++; } }
        else { next = 1; if (tl) { tl[td + T_DREB]++; tl[tb + T_RBD]++; } }
      }
      if (trans && tl) { tl[tb + T_TRCH]++; tl[tb + T_TRPTS] += cpts; }
      pts += cpts;
      if (!cont) { ended = true; break; }
    }
    if (!ended) next = 0;
    score[off] += pts;
    if (tl) tl[tb + T_PTS] += pts;
    return next;
  };
  const period = (Tsec, n0, n1, first, reg) => {
    const d0 = P[16], d1 = P[NP + 16], s = Tsec / (n0 * d0 + n1 * d1), eps = 1e-9 * Tsec;
    let left = Tsec, off = first, st = 0;
    while (left > eps) {
      frac = reg ? (Tsec - left) / Tsec : 1;
      const lead = score[off] - score[off ^ 1];
      const fouled = fouling && left <= 120 && lead >= 3 && lead <= 8;
      const dur = fouled ? 3 : P[off * NP + 16] * s;
      st = possession(off, st, dur, fouled);
      left -= dur; off ^= 1;
    }
  };
  const d0 = P[16], d1 = P[NP + 16];
  const N = Mth.max(1, Mth.round(Lc.kappaN * Lc.T / (d0 + d1) + eta));
  /* the home side has the first possession (the away side gets N or N - 1); at a neutral venue a coin decides */
  const first = home === 1 ? 0 : home === -1 ? 1 : ((coinN * 4096) % 1 < 0.5 ? 0 : 1), nn = [N, N];
  nn[first ^ 1] = Mth.max(0, N - (coinN < 0.5 ? 1 : 0));
  period(Lc.T, nn[0], nn[1], first, true);
  let ot = 0;
  while (score[0] === score[1] && ot < 6) {
    ot++;
    const No = Mth.max(1, Mth.round(Lc.kappaN * Lc.Tot / (d0 + d1)));
    period(Lc.Tot, No, No, (coinOT < 0.5 ? 0 : 1) ^ (ot & 1), false);
  }
  if (score[0] === score[1]) score[((coinOT * 1024) % 1) < 0.5 ? 0 : 1] += 1;
  RES[0] = score[0]; RES[1] = score[1]; RES[2] = np[0]; RES[3] = np[1]; RES[4] = ot;
  return RES;
}
function game(M, rand, randFt, o) {
  const tl = new Float64Array(2 * NT), fouling = o && o.fouling != null ? !!o.fouling : M.L.fouling !== false;
  core(prep(M), M.zones, M.home, M.L, rand, randFt, fouling, tl);
  const tally = [{}, {}];
  for (let s = 0; s < 2; s++) TALLY.forEach((key, i) => { tally[s][key] = tl[s * NT + i]; });
  return { pts: [RES[0], RES[1]], poss: [tally[0].poss, tally[1].poss], ot: RES[4], tally };
}

/* ------------------------------------------------------------ many games --- */
const rngOf = seed => WS().rng(seed >>> 0);
const gameRngs = (seed, i) => [rngOf(seed ^ Mth.imul(i, 0x9E3779B9)), rngOf(seed ^ i ^ 0x85EBCA6B)];
const platted = (p, pl) => (pl ? expit(pl.a + pl.b * logit(clamp(p, 1e-4, 1 - 1e-4))) : p);
/* the inner loop: games i0..i1-1 of a seed into an accumulator */
function playInto(acc, P, M, seed, i0, i1, fouling, home) {
  const tl = acc.wantTally ? acc.tl : null;
  for (let i = i0; i < i1; i++) {
    const [r, rf] = gameRngs(seed, i);
    core(P, M.zones, home, M.L, r, rf, fouling, tl);
    const m = RES[0] - RES[1];
    acc.m[acc.k] = m; acc.k++;
    if (m > 0) acc.w++;
    acc.ptsA += RES[0]; acc.ptsB += RES[1]; acc.possA += RES[2]; acc.possB += RES[3];
    if (RES[4] > 0) acc.ot++;
    if (Mth.abs(m) <= 5) acc.close++;
  }
}
function newAcc(n, tally) { return { m: new Float64Array(n), k: 0, w: 0, ptsA: 0, ptsB: 0, possA: 0, possB: 0, ot: 0, close: 0, tl: new Float64Array(2 * NT), wantTally: !!tally }; }
function summarise(acc, M, o) {
  const n = acc.k, pRaw = n ? acc.w / n : NaN, pWin = platted(pRaw, M.platt);
  const ms = Array.from(acc.m.subarray(0, n)).sort((a, b) => a - b), Q = WS().quantile;
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { s += ms[i]; s2 += ms[i] * ms[i]; }
  const mean = s / n, sd = Mth.sqrt(Mth.max(0, (s2 - n * mean * mean) / Mth.max(1, n - 1)));
  const hist = new Map();
  for (const m of ms) { const c = clamp(m, -60, 60); hist.set(c, (hist.get(c) || 0) + 1); }
  const tl = acc.tl, out = {
    pWin, pRaw, se: Mth.sqrt(Mth.max(pRaw * (1 - pRaw), 0.25 / n) / n), mean, sd, q05: Q(ms, 0.05), q50: Q(ms, 0.5), q95: Q(ms, 0.95),
    hist: [...hist.entries()].sort((a, b) => a[0] - b[0]), pts: [acc.ptsA / n, acc.ptsB / n],
    poss: [acc.possA / n, acc.possB / n], n, close5: acc.close / n, otRate: acc.ot / n
  };
  if (o && o.tally) out.tally = [0, 1].map(s0 => { const t = {}; TALLY.forEach((key, i) => { t[key] = tl[s0 * NT + i]; }); return t; });
  if (o && o.margins) out.margins = acc.m.subarray(0, n);
  return out;
}
const CHUNK = 250;
function* simulateSteps(M, o) {
  o = o || {};
  const n = o.n || 5000, seed = o.seed != null ? o.seed : 1, fouling = o.fouling != null ? !!o.fouling : M.L.fouling !== false;
  const P = prep(M), acc = newAcc(n, o.tally);
  for (let i = 0; i < n; i += CHUNK) {
    playInto(acc, P, M, seed, i, Mth.min(n, i + CHUNK), fouling, M.home);
    if (i + CHUNK < n) yield (i + CHUNK) / n;
  }
  return summarise(acc, M, o);
}
function run(gen) { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; }
const simulate = (M, o) => run(simulateSteps(M, o));
/* map an inner generator's progress into [a, a + w] and return its value */
function* sub(it, a, w) {
  let r = it.next();
  while (!r.done) { yield a + w * r.value; r = it.next(); }
  return r.value;
}

/* ------------------------------------------------------------ natural units and edits --- */
function mixSum(r, zones) { return zones ? r.mixRim + r.mixMid + r.mix3 : 1; }
function makeEfg(r, zones) {
  const s = mixSum(r, zones);
  return zones ? (r.mixRim * r.pRim + r.mixMid * r.pMid + 1.5 * r.mix3 * r.p3) / s : (1 - r.mix3) * r.p2 + 1.5 * r.mix3 * r.p3;
}
function makeRate(r, zones) {
  const s = mixSum(r, zones);
  return zones ? (r.mixRim * r.pRim + r.mixMid * r.pMid + r.mix3 * r.p3) / s : (1 - r.mix3) * r.p2 + r.mix3 * r.p3;
}
/* the model-implied box numbers of one end's rates */
function natural(r, zones) {
  r = rateObj(r);
  zones = zones !== false;
  const sh = Mth.max(0, 1 - r.bonus - r.sfoul), non = 1 - r.tov, fga = non * sh;
  const fta = non * (2 * r.bonus + r.sfoul * (2 + FT3) + sh * makeRate(r, zones) * r.and1);
  return { efg: 100 * makeEfg(r, zones), tovp: 100 * r.tov / (r.tov + fga + 0.44 * fta), orebp: 100 * r.orb,
    ftr: fga > 0 ? 100 * fta / fga : NaN, p3r: 100 * r.mix3 / mixSum(r, zones), secs: r.d };
}
function editRates(r, key, delta, zones) {
  const W = WS(), out = Object.assign({}, r), nat = natural(r, zones);
  if (!delta) return out;
  if (key === 'efg') {
    const target = clamp(nat.efg + delta, 1, 149), ks = ['pRim', 'pMid', 'p3', 'p2'];
    const at = s => { const t = Object.assign({}, r); ks.forEach(k => { t[k] = cp(expit(logit(r[k]) + s)); }); return t; };
    const s = W.bisect(x => 100 * makeEfg(at(x), zones) - target, -8, 8, { tol: 1e-12 });
    return Object.assign(out, at(s == null ? (delta > 0 ? 8 : -8) : s));
  }
  if (key === 'tovp') {
    const target = clamp(nat.tovp + delta, 0.05, 95), hi = 0.95 / Mth.max(r.tov, 1e-6);
    const k = W.bisect(x => natural(Object.assign({}, r, { tov: r.tov * x }), zones).tovp - target, 0, hi, { tol: 1e-12 });
    out.tov = cp(r.tov * (k == null ? (delta > 0 ? hi : 0) : k));
    return out;
  }
  if (key === 'orebp') { out.orb = clamp(r.orb + delta / 100, 0.001, 0.95); return out; }
  if (key === 'ftr') {
    const target = clamp(nat.ftr + delta, 0.1, 400), hi = 0.9 / Mth.max(r.bonus + r.sfoul, 1e-6);
    const f = x => natural(Object.assign({}, r, { bonus: r.bonus * x, sfoul: r.sfoul * x }), zones).ftr - target;
    const k = W.bisect(f, 0, hi, { tol: 1e-12 }), kk = k == null ? (delta > 0 ? hi : 0) : k;
    out.bonus = cp(r.bonus * kk); out.sfoul = cp(r.sfoul * kk);
    return out;
  }
  if (key === 'p3r') {
    const s = mixSum(r, zones), m3 = r.mix3 / s, n3 = clamp(m3 + delta / 100, 0.01, 0.95), f = (1 - n3) / Mth.max(1e-9, 1 - m3);
    out.mix3 = n3; out.mixRim = r.mixRim / s * f; out.mixMid = r.mixMid / s * f;
    return out;
  }
  if (key === 'secs') { out.d = Mth.max(4, r.d + delta); return out; }
  throw new Error('unknown edit ' + key);
}
/* a side's profile with edits in natural units on one end: [{end: 'off'|'def', key, delta}] */
function applyEdits(P, edits, L) {
  P = profObj(P);
  const mu = Object.assign({}, LG, (L && L.rates) || {}), zones = zonesOf(L, mu);
  const out = { off: Object.assign({}, P.off), def: Object.assign({}, P.def), n: P.n };
  for (const e of edits || []) out[e.end === 'def' ? 'def' : 'off'] = editRates(out[e.end === 'def' ? 'def' : 'off'], e.key, e.delta, zones);
  return out;
}
/* the same edits on a match: through the profiles when it has them, else on the effective rates (side s's offence is
   r[s], its defence what the other side gets, r[1 - s]) */
function editMatch(M, edits, home) {
  const h = home != null ? home : M.home;
  if (M.A && M.B && M.lg) {
    let A = M.A, B = M.B;
    for (const e of edits || []) {
      const s = e.side === 'B' || e.side === 1 ? 1 : 0, one = [{ end: e.end, key: e.key, delta: e.delta }];
      if (s) B = applyEdits(B, one, M.lg); else A = applyEdits(A, one, M.lg);
    }
    return matchup(A, B, M.lg, { home: h, platt: M.platt });
  }
  const N = { v: 1, home: M.home, zones: M.zones, L: M.L, lg: M.lg, A: null, B: null, r: [Object.assign({}, M.r[0]), Object.assign({}, M.r[1])], platt: M.platt };
  for (const e of edits || []) {
    const s = e.side === 'B' || e.side === 1 ? 1 : 0, idx = e.end === 'def' ? 1 - s : s;
    N.r[idx] = editRates(N.r[idx], e.key, e.delta, M.zones);
  }
  return N;
}

/* ------------------------------------------------------------ what-ifs --- */
/* two arms, the same seeds (CRN), half the games at A's home and half away when split (needs profiles) */
function* counterfactualSteps(M, edits, o) {
  o = o || {};
  const n = o.n || 4000, seed = o.seed != null ? o.seed : 1, split = o.split !== false && !!(M.A && M.B && M.lg);
  const fouling = M.L.fouling !== false;
  const venues = split ? [1, -1] : [M.home];
  const per = Mth.ceil(n / venues.length);
  const wb = [], wa = [], mb = [], ma = [];
  let done = 0;
  for (const h of venues) {
    const Mb = split ? matchup(M.A, M.B, M.lg, { home: h, platt: M.platt }) : M, Ma = editMatch(M, edits, split ? h : null);
    for (const [arm, w, m] of [[Mb, wb, mb], [Ma, wa, ma]]) {
      const P = prep(arm);
      for (let i = 0; i < per; i += CHUNK) {
        const acc = newAcc(Mth.min(per, i + CHUNK) - i, false);
        playInto(acc, P, arm, seed, i, Mth.min(per, i + CHUNK), fouling, arm.home);
        for (let j = 0; j < acc.k; j++) { w.push(acc.m[j] > 0 ? 1 : 0); m.push(acc.m[j]); }
        done += acc.k;
        yield done / (2 * per * venues.length);
      }
    }
  }
  const N = wb.length;
  let sb = 0, sa = 0, sd = 0, sd2 = 0, smd = 0, smd2 = 0;
  for (let i = 0; i < N; i++) {
    sb += wb[i]; sa += wa[i];
    const d = wa[i] - wb[i], dm = ma[i] - mb[i];
    sd += d; sd2 += d * d; smd += dm; smd2 += dm * dm;
  }
  const md = sd / N, vd = Mth.max(0, sd2 / N - md * md) * N / Mth.max(1, N - 1);
  const mmd = smd / N, vmd = Mth.max(0, smd2 / N - mmd * mmd) * N / Mth.max(1, N - 1);
  const base = platted(sb / N, M.platt), alt = platted(sa / N, M.platt);
  return { base, alt, dWin: alt - base, dWinRaw: md, se: Mth.sqrt(vd / N), dMargin: mmd, seMargin: Mth.sqrt(vmd / N), n: N };
}
const counterfactual = (M, edits, o) => run(counterfactualSteps(M, edits, o));

/* the value of one rate (natural units) that brings the side's P(win) to target, by bisection on the edit within the
   league's range (opts.bounds in natural units, or opts.range as deltas), tolerance 0.005, at most 14 steps */
function* neededSteps(M, key, o) {
  o = o || {};
  const side = o.side === 'B' || o.side === 1 ? 1 : 0, end = o.end === 'def' ? 'def' : 'off', target = o.target != null ? o.target : 0.5;
  const n = o.n || 3000, seed = o.seed != null ? o.seed : 1, tol = o.tol || 0.005, steps = o.maxSteps || 14;
  const rIdx = end === 'off' ? side : 1 - side;
  const cur = M.A && M.B ? (side ? M.B : M.A)[end] : M.r[rIdx];
  const nat0 = natural(cur, M.zones)[key];
  let lo = (o.range || RANGE[key])[0], hi = (o.range || RANGE[key])[1];
  if (o.bounds) { lo = o.bounds[0] - nat0; hi = o.bounds[1] - nat0; }
  let evals = 0;
  const f = function* (delta) {
    const Me = editMatch(M, [{ side, end, key, delta }]);
    const r = yield* sub(simulateSteps(Me, { n, seed }), Mth.min(0.99, evals / (steps + 2)), 1 / (steps + 2));
    evals++;
    const p = side ? 1 - r.pWin : r.pWin;
    return { p, Me };
  };
  const at = function* (delta) { const r = yield* f(delta); return { delta, p: r.p, Me: r.Me }; };
  let a = yield* at(lo), b = yield* at(hi);
  const valueOf = x => { const Me = x.Me, r = Me.A && Me.B ? (side ? Me.B : Me.A)[end] : Me.r[rIdx]; return natural(r, M.zones)[key]; };
  const pack = (x, reached) => ({ value: valueOf(x), delta: x.delta, p: x.p, reached, base: nat0, evals });
  if (Mth.abs(a.p - target) <= tol) return pack(a, true);
  if (Mth.abs(b.p - target) <= tol) return pack(b, true);
  if ((a.p - target) * (b.p - target) > 0) return pack(Mth.abs(a.p - target) < Mth.abs(b.p - target) ? a : b, false);
  let best = Mth.abs(a.p - target) < Mth.abs(b.p - target) ? a : b;
  for (let i = 0; i < steps; i++) {
    const m = yield* at(0.5 * (a.delta + b.delta));
    if (Mth.abs(m.p - target) < Mth.abs(best.p - target)) best = m;
    if (Mth.abs(m.p - target) <= tol) return pack(m, true);
    if ((m.p - target) * (a.p - target) < 0) b = m; else a = m;
  }
  return pack(best, Mth.abs(best.p - target) <= tol);
}
const needed = (M, key, o) => run(neededSteps(M, key, o));

/* exact Shapley over groups of rates: v(S) = mean margin (side A) with S's groups at the played match's rates (both
   sides), the rest at the expected match's; every coalition plays the same games (CRN) */
function groupMap(groups) {
  if (!groups) return GROUPS;
  if (Array.isArray(groups)) { const o = {}; groups.forEach(g => { o[g] = GROUPS[g]; if (!o[g]) throw new Error('unknown group ' + g); }); return o; }
  return groups;
}
function* shapleySteps(Mexp, Mplayed, groups, o) {
  o = o || {};
  const G = groupMap(groups), names = Object.keys(G), m = names.length, N = 1 << m, n = o.n || 1000, seed = o.seed != null ? o.seed : 1;
  const v = new Float64Array(N), fouling = Mexp.L.fouling !== false;
  for (let mask = 0; mask < N; mask++) {
    const r = [Object.assign({}, Mexp.r[0]), Object.assign({}, Mexp.r[1])];
    names.forEach((g, i) => { if (mask & (1 << i)) for (const k of G[g]) { r[0][k] = Mplayed.r[0][k]; r[1][k] = Mplayed.r[1][k]; } });
    const Mm = { v: 1, home: Mexp.home, zones: Mexp.zones, L: Mexp.L, r, platt: null };
    const acc = newAcc(n, false);
    playInto(acc, prep(Mm), Mm, seed, 0, n, fouling, Mexp.home);
    let s = 0;
    for (let i = 0; i < n; i++) s += acc.m[i];
    v[mask] = s / n;
    yield (mask + 1) / N;
  }
  const fact = [1];
  for (let i = 1; i <= m; i++) fact[i] = fact[i - 1] * i;
  const phi = {};
  names.forEach(g => { phi[g] = 0; });
  for (let mask = 0; mask < N; mask++) {
    let s = 0;
    for (let g = 0; g < m; g++) if (mask & (1 << g)) s++;
    const w = fact[s] * fact[m - s - 1] / fact[m];
    for (let g = 0; g < m; g++) if (!(mask & (1 << g))) phi[names[g]] += w * (v[mask | (1 << g)] - v[mask]);
  }
  return { phi, base: v[0], full: v[N - 1], groups: names };
}
const shapley = (Mexp, Mplayed, groups, o) => run(shapleySteps(Mexp, Mplayed, groups, o));

/* the season to come: each remaining fixture's P(win) from the simulator, or Phi(mu / sigma) when sigma and an expected
   margin are given; played results fixed (done = wins so far); the total's exact distribution (Poisson-binomial) */
function* seasonSteps(own, fixtures, L, o) {
  o = o || {};
  const n = o.n || 2000, seed = o.seed != null ? o.seed : 1, done = o.done || 0, W = WS(), ps = [];
  for (let f = 0; f < fixtures.length; f++) {
    const fx = fixtures[f], mu = fx.mu != null ? fx.mu : Array.isArray(o.mu) ? o.mu[f] : null;
    if (o.sigma > 0 && isNum(mu)) ps.push(W.normCdf(mu / o.sigma));
    else {
      const r = yield* sub(simulateSteps(matchup(own, fx.opp, L, { home: fx.home || 0, platt: o.platt }), { n, seed: (seed + f) >>> 0 }),
        f / fixtures.length, 1 / fixtures.length);
      ps.push(r.pWin);
    }
    yield (f + 1) / fixtures.length;
  }
  let dist = [1];
  for (const p of ps) {
    const nd = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) { nd[k] += dist[k] * (1 - p); nd[k + 1] += dist[k] * p; }
    dist = nd;
  }
  const q = t => { let c = 0; for (let k = 0; k < dist.length; k++) { c += dist[k]; if (c >= t - 1e-12) return done + k; } return done + dist.length - 1; };
  const mean = done + ps.reduce((a, b) => a + b, 0);
  return { mean, p10: q(0.1), p50: q(0.5), p90: q(0.9), dist, ps, done };
}
const season = (own, fixtures, L, o) => run(seasonSteps(own, fixtures, L, o));

/* ------------------------------------------------------------ calibration (builder) --- */
const tallySum = (t, k) => (t ? (isNum(t[0][k]) ? t[0][k] : 0) + (isNum(t[1][k]) ? t[1][k] : 0) : 0);
function boxChecks(T, games, T40) {
  const g = k => T[k] || 0;
  const tov = isNum(T.to_n) && T.to_n > 0 ? T.to_n : g('tov');
  return {
    pace: games ? g('poss') / (2 * games) * T40 : NaN, ortg: g('poss') ? 100 * g('pts') / g('poss') : NaN,
    efg: g('fga') ? 100 * (g('fgm') + 0.5 * g('fg3m')) / g('fga') : NaN, tovp: 100 * tov / (g('fga') + 0.44 * g('fta') + tov),
    orebp: 100 * g('oreb') / (g('oreb') + g('dreb')), ftr: g('fga') ? 100 * g('fta') / g('fga') : NaN
  };
}
function addTally(into, t) { for (const k of TALLY) into[k] = (into[k] || 0) + tallySum(t, k); if (t) into.to_n = (into.to_n || 0) + tallySum(t, 'to_n'); }
/* games: [{A, B (profiles), home (A's venue), y (A's margin), t? (when it was played), poss? (mean possessions a side),
   tally? ([A, B] in LAYOUT names), ot?, T?}]. Fits, in this order: kappaN and sigmaN (possessions), dTr (transition minus
   half-court points per chance), muOff (points per possession within 0.3%), the home court (home win share), the spread
   of margins around their expectation (tau when the simulator is too tight, the score effect `lead` when it is too
   loose: one of the two is zero), fouling (kept unless it worsens the possessions of games decided by 8 or fewer),
   kappaN once more.
   THE VALIDATION IS OUT OF SAMPLE (rolling origin, like the Forecast): the games are put in time order (t, else the
   order given), the later 1 - holdFrom of them (0.6) are cut into `folds` (3) blocks, and each block is simulated with
   parameters fitted ONLY on the games played before its first game. The report (Brier, slope, the checks, the gate)
   is those held-out predictions'; Platt scaling is fitted on them too. The parameters returned are fitted on every
   game (for what comes next), and report.inSample holds what they score on the same held-out games: fitted on the
   games they score, so it is shown apart and never gated. A unit too small for a fold (fewer than 20 earlier games)
   has no held-out games, and is never calibrated.
   opts: seed, fitN (300), fitSims (200; 0.6 of it for the fold fits), evalSims (1000, or 400 above 2,000 games),
   evalN (1500 above 2,000), folds (3), holdFrom (0.4), compare {forecast, elo} (Briers for the gate, used when the
   games do not carry their own pre-game pF / pE: then the gate scores those on the same held-out games), fitSpread /
   fitHca / fitMuOff / fitDTr (false to hold one).
   Returns {hca, tau, kappaN, sigmaN, muOff, dTr, lead, fouling, platt, report}. */
function* calibrateSteps(games, L, o) {
  o = o || {};
  const W = WS(), seed = o.seed != null ? o.seed : 1;
  const all0 = games.filter(g => g && g.A && g.B && isNum(g.y));
  /* time order: t when given, else the order given (stable) */
  const ordd = all0.map((g, i) => ({ g, t: isNum(g.t) ? g.t : i, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  const all = ordd.map(x => x.g), tOf = ordd.map(x => x.t);
  const pr = W.rng(seed ^ 0x51ED270B);
  const sample = (arr, k) => {
    if (arr.length <= k) return arr.slice();
    const idx = arr.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Mth.floor(pr() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    return idx.slice(0, k).sort((a, b) => a - b).map(i => arr[i]);
  };
  const fitN = o.fitN || 300, fitSims = o.fitSims || 200, foldSims = Mth.max(20, Mth.round(0.6 * fitSims));
  const big = all.length > 2000;
  const evalSims = o.evalSims || (big ? 400 : 1000), inSims = Mth.min(evalSims, 400);
  const Lc = Object.assign({}, LDEF, L || {});
  const possObs = g => (isNum(g.poss) ? g.poss : g.tally ? tallySum(g.tally, 'poss') / 2 : NaN);
  const Tof = g => g.T || Lc.T;
  const mk = (g, par) => matchup(g.A, g.B, Object.assign({}, Lc, par, { T: Tof(g) }), { home: g.home || 0 });
  const par0 = { kappaN: Lc.kappaN || 1, sigmaN: Lc.sigmaN || 0, hca: Lc.hca || 0, tau: Lc.tau || 0, muOff: Lc.muOff || 0, dTr: Lc.dTr || 0, lead: Lc.lead || 0,
    fouling: Lc.fouling !== false };
  /* the rolling origins: fold k simulates games [a, b) with parameters fitted on the games played before game a */
  const nF = Mth.max(0, o.folds != null ? o.folds : 3), from = clamp(o.holdFrom != null ? o.holdFrom : 0.4, 0.1, 0.9);
  const folds = [];
  if (nF > 0) {
    const start = Mth.floor(all.length * from), span = all.length - start;
    for (let k = 0; k < nF; k++) {
      const a = start + Mth.floor(span * k / nF), b = start + Mth.floor(span * (k + 1) / nF);
      if (b <= a) continue;
      let f = a; while (f > 0 && tOf[f - 1] >= tOf[a]) f--;      // strictly before the fold's first game
      if (f >= 20) folds.push({ fit: all.slice(0, f), test: all.slice(a, b) });
    }
  }
  /* progress: a fit is about 24 passes, an evaluation 2 */
  const TOTAL = 24 * (folds.length + 1) + 2 * (folds.length + 1);
  const prog = { n: 0 };
  /* one pass over `list` with the parameters q: per game mean and variance of the margin, P(win), possessions, points,
     transition and half-court points per chance */
  const pass = function* (q, list, sims) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i], M = mk(g, q);
      out.push(run(simulateSteps(M, { n: sims, seed: (seed + 7919 * i) >>> 0, tally: true, fouling: q.fouling })));
      yield Mth.min(0.99, (prog.n + (i + 1) / list.length) / TOTAL);   // every game: a slice is never long
    }
    prog.n++;
    return out;
  };
  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  /* the fit on the sample S (simulations a game: sims) */
  const fitOn = function* (S, sims) {
    const par = Object.assign({}, par0), p0 = prog.n;
    const P = (q, set) => pass(q, set || S, sims);
    const has = S.filter(g => isNum(possObs(g)));
    /* 1. possessions */
    if (has.length) {
      const base = has.map(g => { const M = mk(g, par); return Tof(g) / (M.r[0].d + M.r[1].d); });
      const obs = has.map(possObs);
      par.kappaN = obs.reduce((a, b) => a + b, 0) / base.reduce((a, b) => a + b, 0);
      const res = obs.map((v, i) => v - par.kappaN * base[i]), mr = mean(res);
      par.sigmaN = Mth.sqrt(Mth.max(0, mean(res.map(v => (v - mr) * (v - mr))) - 1 / 12 - 1 / 16));
      const sim = yield* P(par, has);
      const sp = mean(sim.map(r => (r.poss[0] + r.poss[1]) / 2)), op = mean(obs);
      if (sp > 0) par.kappaN *= op / sp;
    }
    /* a secant search on one parameter for f(results) = 0, f increasing in it: the passes share their seeds (CRN) */
    const secant = function* (key, f, step, lo, hi, tol, maxIt, set) {
      const at = function* (x) { return f(yield* P(Object.assign({}, par, { [key]: x }), set)); };
      let a = par[key], fa = yield* at(a);
      if (Mth.abs(fa) <= tol) return a;
      let b = clamp(a + (fa > 0 ? -step : step), lo, hi), fb = yield* at(b);
      for (let it = 0; it < maxIt && Mth.abs(fb) > tol && fb !== fa; it++) {
        const c = clamp(b - fb * (b - a) / (fb - fa), lo, hi);
        a = b; fa = fb; b = c;
        fb = yield* at(b);
      }
      return Mth.abs(fb) <= Mth.abs(fa) ? b : a;
    };
    const withT = S.filter(g => g.tally), tot = {};
    withT.forEach(g => addTally(tot, g.tally));
    /* 2. transition: transition minus half-court points per chance (first: it moves the points per possession) */
    const diffTr = t => t.tr_pts / t.tr_ch - (t.pts - t.tr_pts) / (t.chances - t.tr_ch);
    const canTr = withT.length && o.fitDTr !== false && tot.tr_ch > 0 && tot.chances > tot.tr_ch;
    const fitTr = function* (maxIt) {
      if (!canTr) return;
      const obsD = diffTr(tot);
      par.dTr = yield* secant('dTr', rs => { const t = {}; rs.forEach(r => addTally(t, r.tally)); return diffTr(t) - obsD; }, 0.2, -1, 2, 0.01, maxIt, withT);
    };
    /* 3. the league make offset: points per possession within 0.3% */
    const canMu = withT.length && o.fitMuOff !== false && tot.poss > 0;
    const fitMu = function* (maxIt) {
      if (!canMu) return;
      const obsPpp = tot.pts / tot.poss;
      const pppOf = rs => { let p = 0, n = 0; rs.forEach(r => { p += r.tally[0].pts + r.tally[1].pts; n += r.tally[0].poss + r.tally[1].poss; }); return p / n; };
      par.muOff = yield* secant('muOff', rs => pppOf(rs) - obsPpp, 0.05, -1, 1, 0.003 * obsPpp, maxIt, withT);
    };
    yield* fitTr(2);
    yield* fitMu(4);
    yield* fitTr(1);
    yield* fitMu(2);
    /* 4. the spread of margins around their expectation: form noise tau when the simulator is too tight, the score
       effect (lead) when it is too loose; one of the two is zero */
    const gap = rs => mean(rs.map(r => r.sd * r.sd)) - mean(rs.map((r, i) => (S[i].y - r.mean) * (S[i].y - r.mean)));
    const fitSpread = function* () {
      if (o.fitSpread === false) return;
      const base = Object.assign({}, par, { tau: 0, lead: 0 });
      const g0 = gap(yield* P(base));
      if (g0 < 0) {
        par.lead = 0;
        par.tau = yield* secant('tau', rs => gap(rs), 0.2, 0, 1.2, 1, 4);
      } else {
        par.tau = 0;
        par.lead = yield* secant('lead', rs => -gap(rs), 0.15, 0, 1.5, 1, 4);
      }
    };
    /* 5. the home court: the home side's share of wins */
    const homeG = S.filter(g => g.home === 1 || g.home === -1);
    const obsHome = homeG.length ? mean(homeG.map(g => ((g.home === 1) === (g.y > 0) ? 1 : 0))) : null;
    const fitHca = function* (maxIt) {
      if (!homeG.length || o.fitHca === false) return;
      par.hca = yield* secant('hca', rs => mean(rs.map((r, i) => (homeG[i].home === 1 ? r.pRaw : 1 - r.pRaw))) - obsHome, 0.05, -0.6, 0.6, 0.003, maxIt, homeG);
    };
    yield* fitHca(3);
    yield* fitSpread();
    yield* fitHca(2);
    yield* fitMu(1);
    /* 6. end-game fouling: kept unless it worsens the possessions of games decided by 8 or fewer */
    const close = S.filter(g => Mth.abs(g.y) <= 8 && isNum(possObs(g)));
    if (close.length >= 10) {
      const err = rs => mean(rs.map((r, i) => Mth.abs((r.poss[0] + r.poss[1]) / 2 - possObs(close[i]))));
      const on = err(yield* P(Object.assign({}, par, { fouling: true }), close));
      const off = err(yield* P(Object.assign({}, par, { fouling: false }), close));
      const was = par.fouling;
      par.fouling = !(off < on);
      if (par.fouling !== was) yield* fitMu(2);
    }
    /* 6b. possessions once more, now that fouling, the score effect and the rest are settled */
    if (has.length) {
      const sim = yield* P(par, has);
      const sp = mean(sim.map(r => (r.poss[0] + r.poss[1]) / 2)), op = mean(has.map(possObs));
      if (sp > 0) par.kappaN *= op / sp;
    }
    prog.n = Mth.max(prog.n, p0 + 24);
    return par;
  };
  /* simulate `set` with the parameters q: the per-game P(win) and the sums the checks need */
  const evalOn = function* (set, q, sims, acc, salt) {
    for (let i = 0; i < set.length; i++) {
      const g = set[i];
      const r = run(simulateSteps(mk(g, q), { n: sims, seed: ((seed ^ 0xA5A5A5A5) + 104729 * (i + salt)) >>> 0, tally: true, fouling: q.fouling }));
      /* (wins + 0.5) / (sims + 1): a game simulated as never (or always) won is not a certainty, and its logit stays finite */
      acc.ps.push((r.pRaw * r.n + 0.5) / (r.n + 1)); acc.ys.push(g.y > 0 ? 1 : 0); acc.games.push(g);
      acc.simMs.push(r.mean); acc.simVar += r.sd * r.sd;
      acc.simClose += r.close5; acc.simOt += r.otRate;
      if (g.home === 1 || g.home === -1) acc.simHome += g.home === 1 ? r.pRaw : 1 - r.pRaw;
      if (g.tally) { addTally(acc.obsT, g.tally); const t = {}; TALLY.forEach(k => { t[k] = (r.tally[0][k] + r.tally[1][k]) / sims; }); for (const k in t) acc.simT[k] = (acc.simT[k] || 0) + t[k]; }
      yield Mth.min(0.99, (prog.n + 2 * (i + 1) / set.length) / TOTAL);
    }
    prog.n += 2;
    return acc;
  };
  const newAcc = () => ({ ps: [], ys: [], games: [], obsT: {}, simT: {}, simMs: [], simClose: 0, simOt: 0, simHome: 0, simVar: 0 });
  const T40 = 2400 / Lc.T;
  const checksOf = acc => {
    const set = acc.games, n = set.length, ys2 = set.map(g => g.y), my = mean(ys2), mm = mean(acc.simMs);
    const obsSd = Mth.sqrt(mean(ys2.map(y => (y - my) * (y - my)))), simSd = Mth.sqrt(acc.simVar / n + mean(acc.simMs.map(m => (m - mm) * (m - mm))));
    const withTally = set.filter(g => g.tally).length;
    const ob = withTally ? boxChecks(acc.obsT, withTally, T40) : null, sb = withTally ? boxChecks(acc.simT, withTally, T40) : null;
    const checks = {};
    if (ob) for (const k in ob) checks[k] = { obs: ob[k], sim: sb[k] };
    checks.marginSd = { obs: obsSd, sim: simSd };
    checks.close5 = { obs: mean(ys2.map(y => (Mth.abs(y) <= 5 ? 1 : 0))), sim: acc.simClose / n };
    if (set.some(g => isNum(g.ot))) checks.ot = { obs: mean(set.map(g => (g.ot > 0 ? 1 : 0))), sim: acc.simOt / n };
    const hg = set.filter(g => g.home === 1 || g.home === -1);
    if (hg.length) checks.home = { obs: mean(hg.map(g => ((g.home === 1) === (g.y > 0) ? 1 : 0))), sim: acc.simHome / hg.length };
    return checks;
  };
  /* 7. the held-out validation: each fold simulated with parameters fitted before it */
  const capTest = big ? Mth.max(1, Mth.round((o.evalN || 1500) / Mth.max(1, folds.length))) : Infinity;
  const held = newAcc(), foldPars = [];
  for (let k = 0; k < folds.length; k++) {
    const F = folds[k];
    const pk = yield* fitOn(sample(F.fit, fitN), foldSims);
    foldPars.push({ nFit: F.fit.length, nTest: F.test.length, hca: pk.hca, tau: pk.tau, lead: pk.lead, kappaN: pk.kappaN });
    yield* evalOn(F.test.length > capTest ? sample(F.test, capTest) : F.test, pk, evalSims, held, 100000 * (k + 1));
  }
  /* 8. the parameters for what comes next: fitted on every game */
  const S = sample(all, fitN);
  const par = yield* fitOn(S, fitSims);
  /* 9. what those parameters score on the same held-out games (in sample: shown apart, never gated) */
  const ins = held.games.length ? yield* evalOn(held.games, par, inSims, newAcc(), 0) : null;
  const n = held.ps.length;
  const cal = n ? W.calibration(held.ps, held.ys) : { brier: NaN, logloss: NaN, slope: NaN, intercept: NaN, ece: NaN, auc: NaN };
  let platt = null;
  if (isNum(cal.slope) && (cal.slope < 0.9 || cal.slope > 1.1) && n >= 30) {
    const lg = W.logistic(held.ps.map(p => [1, logit(clamp(p, 1e-4, 1 - 1e-4))]), held.ys, { maxIter: 50 });
    if (lg.converged && !lg.separated) platt = { a: lg.b[0], b: lg.b[1] };
  }
  const checks = n ? checksOf(held) : {};
  let inSample = null;
  if (ins) { const ci = W.calibration(ins.ps, ins.ys); inSample = { brier: ci.brier, slope: ci.slope, sims: inSims, checks: checksOf(ins) }; }
  /* the gate compares like with like: when the games carry the Forecast's and Elo's own pre-game P(win) (pF, pE), their
     Briers on the same held-out games; else opts.compare */
  const brierOf = key => { let s = 0, m = 0; held.games.forEach((g, i) => { if (isNum(g[key])) { s += (g[key] - held.ys[i]) * (g[key] - held.ys[i]); m++; } }); return m === n && n ? s / m : null; };
  const same = { forecast: brierOf('pF'), elo: brierOf('pE') };
  const cmp = same.forecast != null || same.elo != null ? same : o.compare;
  const slopeOk = isNum(cal.slope) && cal.slope >= 0.85 && cal.slope <= 1.15;
  const brierOk = !cmp || !(isNum(cmp.forecast) || isNum(cmp.elo)) || cal.brier <= Mth.min(isNum(cmp.forecast) ? cmp.forecast : Infinity, isNum(cmp.elo) ? cmp.elo : Infinity) + 0.003;
  const calibrated = n >= 60 && slopeOk && brierOk;
  return {
    hca: par.hca, tau: par.tau, kappaN: par.kappaN, sigmaN: par.sigmaN, muOff: par.muOff, dTr: par.dTr, lead: par.lead, fouling: par.fouling, platt,
    report: Object.assign({ nEval: n, nFit: S.length, sims: evalSims, calibrated, heldOut: true, folds: foldPars, checks, inSample, compare: cmp || null }, cal)
  };
}
const calibrate = (games, L, o) => run(calibrateSteps(games, L, o));

/* ------------------------------------------------------------ a synthetic league --- */
function synth(o) {
  o = o || {};
  const W = WS(), nT = o.teams || 12, nG = o.games || 132, seed = o.seed != null ? o.seed : 1, rand = W.rng(seed), sp = o.spread != null ? o.spread : 0.6;
  const L = { rates: Object.assign({}, LG, o.rates || {}), T: o.T || 2400, Tot: 300, kappaN: o.kappaN || 1, sigmaN: o.sigmaN != null ? o.sigmaN : 2,
    hca: o.hca != null ? o.hca : 0.05, tau: o.tau != null ? o.tau : 0.1, muOff: 0, dTr: o.dTr != null ? o.dTr : 0.3, lead: o.lead || 0, fouling: o.fouling !== false,
    zones: o.zones !== false, G: 0 };
  const nz = () => W.normal(rand);
  const jitter = (r, s) => {
    const t = Object.assign({}, r);
    for (const k of ['pRim', 'pMid', 'p3', 'p2']) t[k] = cp(expit(logit(r[k]) + 0.12 * s * nz()));
    for (const k of ['tov', 'live', 'sfoul', 'bonus', 'and1', 'orb', 'tr']) t[k] = cp(expit(logit(r[k]) + 0.15 * s * nz()));
    t.ft = cp(expit(logit(r.ft) + 0.1 * s * nz()));
    t.d = r.d * Mth.exp(0.05 * s * nz());
    const er = Mth.exp(Mth.log(r.mixRim / r.mix3) + 0.2 * s * nz()), em = Mth.exp(Mth.log(r.mixMid / r.mix3) + 0.2 * s * nz()), q = 1 + er + em;
    t.mix3 = 1 / q; t.mixRim = er / q; t.mixMid = em / q;
    return t;
  };
  const profiles = [];
  for (let t = 0; t < nT; t++) profiles.push({ id: 't' + t, off: jitter(L.rates, sp), def: jitter(L.rates, sp), n: 1e9 });
  const pairs = [];
  for (let a = 0; a < nT; a++) for (let b = 0; b < nT; b++) if (a !== b) pairs.push([a, b]);
  for (let i = pairs.length - 1; i > 0; i--) { const j = Mth.floor(rand() * (i + 1)); const t = pairs[i]; pairs[i] = pairs[j]; pairs[j] = t; }
  const games = [], gs = (seed * 2654435761) >>> 0;
  for (let i = 0; i < nG; i++) {
    const [a, b] = pairs[i % pairs.length], M = matchup(profiles[a], profiles[b], L, { home: 1 });
    const [r, rf] = gameRngs(gs, i), res = game(M, r, rf);
    games.push({ i, a, b, A: profiles[a], B: profiles[b], home: 1, y: res.pts[0] - res.pts[1], pts: res.pts,
      poss: (res.poss[0] + res.poss[1]) / 2, ot: res.ot, tally: res.tally, T: L.T });
  }
  L.G = Mth.round(2 * nG / nT);
  return { league: L, profiles, games, truth: { hca: L.hca, tau: L.tau, kappaN: L.kappaN, sigmaN: L.sigmaN, dTr: L.dTr, lead: L.lead } };
}

/* ------------------------------------------------------------ the Markov expectation (a check) --- */
/* expected points and chances per possession of side s, without form, transition bonus or end-game fouling */
function markov(M, s) {
  const r = M.r[s], z = M.zones, mix = z ? [r.mixRim, r.mixMid, r.mix3] : [1 - r.mix3, 0, r.mix3];
  const pz = z ? [r.pRim, r.pMid, r.p3] : [r.p2, r.p2, r.p3], val = [2, 2, 3];
  const non = 1 - r.tov, b = r.bonus, sf = r.sfoul, sh = 1 - b - sf, ft = r.ft, ob = r.orb, o12 = 0.12 * ob;
  const ms = mix[0] + mix[1] + mix[2];
  let pts = 0, cont = 0, dreb = 0;
  pts += b * 2 * ft; cont += b * (1 - ft) * o12;
  dreb += (b + sf) * (1 - ft) * (1 - o12);
  const f3 = M.L && M.L.ft3 != null ? M.L.ft3 : FT3;
  pts += sf * (f3 * 3 * ft + (1 - f3) * 2 * ft); cont += sf * (1 - ft) * o12;
  for (let i = 0; i < 3; i++) {
    const w = mix[i] / ms, p = pz[i];
    pts += sh * w * p * (val[i] + r.and1 * ft);
    cont += sh * w * (p * r.and1 * (1 - ft) * o12 + (1 - p) * ob);
    dreb += sh * w * (p * r.and1 * (1 - ft) * (1 - o12) + (1 - p) * (1 - ob));
  }
  pts *= non; cont *= non; dreb *= non;
  let E = 0, C = 0;
  for (let c = 6; c >= 1; c--) { E = pts + cont * E; C = 1 + cont * C; }
  /* how its possessions end: the other side starts from a defensive board, or from a live turnover */
  const reach = (1 - Mth.pow(cont, 6)) / (1 - cont || 1);
  return { ppp: E, chances: C, dreb: dreb * reach, live: r.tov * r.live * reach };
}

/* ------------------------------------------------------------ slices: the worker's and the idle main thread's --- */
function refitSteps(a) {
  const W = WS(), list = Array.isArray(a.blocks) ? a.blocks : a.blocks.list, keys = a.keys || (a.blocks && a.blocks.keys) || null;
  const p = list[0].xy.length, cols = (a.cols || Array.from({ length: p }, (_, i) => i)).map(c => (typeof c === 'string' ? keys.indexOf(c) : c));
  if (cols.some(c => !(c >= 0 && c < p))) throw new Error('unknown column');
  const scale = a.scale || (a.blocks && a.blocks.scale) || null;
  const pen = cols.map(c => (scale ? scale[c] * scale[c] : 1));
  const lam = a.lambda != null ? a.lambda : (a.blocks && a.blocks.lambda) || 0;
  const picked = list.map(b => W.pick(b, cols));
  const fit = S => { const r = W.ridge(S, { lambda: lam, pen }); return r ? r.b : null; };
  return (function* () {
    const bs = yield* W.blockBootstrapSteps(picked, fit, { B: a.B || 200, seed: a.seed != null ? a.seed : 1 });
    const out = { b: bs.est, lo: bs.lo, hi: bs.hi, se: bs.se, cols, keys: keys ? cols.map(c => keys[c]) : null };
    if (a.draws) out.draws = bs.draws;
    return out;
  }());
}
const OPS = {
  simulate: [simulateSteps, a => [a.M, a]],
  counterfactual: [counterfactualSteps, a => [a.M, a.edits, a]],
  needed: [neededSteps, a => [a.M, a.key, a]],
  shapley: [shapleySteps, a => [a.Mexp, a.Mplayed, a.groups, a]],
  season: [seasonSteps, a => [a.own, a.fixtures, a.L, a]],
  calibrate: [calibrateSteps, a => [a.games, a.L, a]],
  refit: [refitSteps, a => [a]],
  bootstrap: [a => refitSteps(Object.assign({}, a, { draws: a.draws !== false })), a => [a]]
};
/* the generator of an op: args positional (an array) or named (an object) */
function steps(op, args) {
  const e = OPS[op];
  if (!e) throw new Error('unknown op ' + op);
  return e[0].apply(null, Array.isArray(args) ? args : e[1](args || {}));
}
/* run a generator in slices of `slice` ms, reporting progress after each and stopping when cancelled() */
function drive(gen, o) {
  o = o || {};
  const slice = o.slice || 40, now = o.now || (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
  const defer = o.defer || (fn => setTimeout(fn, 0));
  return new Promise((resolve, reject) => {
    const step = () => {
      if (o.cancelled && o.cancelled()) { reject(new Error('cancelled')); return; }
      const t0 = now();
      let r, last = 0;
      try {
        do { r = gen.next(); if (!r.done) last = r.value; } while (!r.done && now() - t0 < slice);
      } catch (e) { reject(e); return; }
      if (r.done) { if (o.onProgress) o.onProgress(1); resolve(r.value); return; }
      if (o.onProgress) o.onProgress(last);
      defer(step);
    };
    defer(step);
  });
}

return {
  RATES, K_PRIOR, GROUPS, EDITS, RANGE, LG, TALLY,
  endInput, ratesOf, profile, profObj, matchup, matchFrom, game, simulate, applyEdits, editMatch, natural,
  counterfactual, needed, shapley, season, calibrate, synth, markov,
  simulateSteps, counterfactualSteps, neededSteps, shapleySteps, seasonSteps, calibrateSteps, refitSteps,
  steps, drive, run
};
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaWinSim;
export const { RATES, K_PRIOR, GROUPS, EDITS, RANGE, LG, TALLY, endInput, ratesOf, profile, profObj, matchup, matchFrom, game, simulate, applyEdits, editMatch, natural, counterfactual, needed, shapley, season, calibrate, synth, markov, simulateSteps, counterfactualSteps, neededSteps, shapleySteps, seasonSteps, calibrateSteps, refitSteps, steps, drive, run } = __api;
export default __api;
