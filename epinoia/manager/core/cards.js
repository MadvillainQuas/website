'use strict';
/* ============================================================================
   MANAGER - THE PLAYER CARD (core: no site, no DOM, no database).

   What the simulator knows about a player: his season line (season.js's player shape) turned into how he differs from
   the league he earned it in - so the same card can be played in another league (a player drafted from abroad) and
   always reads its own league's environment (its pace, its three-point line, its referees) out of the numbers.

     refOf(rows)                   a league's reference: its players' totals, its shot mix and make rates, and the
                                   average line at each position (1-5)
     cardOf(row, ref, o)           one player's card; o: {share: minutes at PG..C, shift: the league-strength shift, ...}
     shiftOf(fromRange, toRange)   the strength shift between two leagues' value ranges (-1 .. 1)

   EVERY RATE IS SHRUNK TOWARD WHAT HIS POSITION DOES, by its sample: a make rate by its attempts (the rim by 25, the
   mid-range by 40, the three by 120 - threes take the longest to mean anything), a share by his plays, a rebounding,
   steal or block rate by his minutes (400). A player with 60 minutes is mostly his position's average; a starter is
   mostly himself.

   ON/OFF, LIGHTLY (Louie, 2026-10-09: "If there's a gap in stats - slightly weigh in on-off stats for them (i.e.
   rebounding on-off to see if they actually help the team in rebounding or are a negative etc.)"). His own rates come
   first; the team's numbers with him on against off (the opponents' offensive rebounding, their eFG%, the turnovers they
   make, our own eFG%, turnovers and offensive glass) are added with a small weight that grows with the possessions he
   has been on the floor for (ONOFF_MAX x poss / (poss + 1500)), and with more of it where his own line has a gap (no
   shot zones, no rim on/off). Under a few hundred possessions it is next to nothing.

   WHO HE FACED (Louie: "for things like weighing in vs. bench/starters stats etc., make sure to not factor it in too
   greatly if it's low minutes"): a starter's line was earned against starters, a bench man's against benches. The card
   takes his share of minutes against starters (squad.js startersShare) against the league's average share, and moves
   his makes by OPP_LOGIT for the whole difference - times his own reliability, so a low-minute line moves very little.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.cards = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const isNum = v => typeof v === 'number' && isFinite(v);
const num = v => (v == null || v === '' ? null : (isFinite(+v) ? +v : null));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cp = p => clamp(p, 1e-4, 1 - 1e-4);
const logit = p => Math.log(cp(p) / (1 - cp(p)));
const n0 = v => num(v) || 0;

/* the prior weights: attempts, plays or minutes worth of the position's average */
const K = { tov: 40, fta: 40, mix: 30, rim: 25, mid: 40, three: 120, two: 60, ft: 30, un: 12, rate: 400, usg: 150, pf: 300, pace: 600, tr: 25, hc: 60, trSh: 40, fast: 400 };
const POP_MIN = 40;               // minutes for a line to count in its league's reference
const ONOFF_K = 1500, ONOFF_MAX = 0.35;
const RIM_K = 80;                 // opponent rim attempts (each side of the on/off) before the rim on/off counts fully
/* WHO HE FACED: the share of his minutes against the other side's starters (squad.js startersShare, 40-minute game) */
const startersShare = (mpg, L) => 0.1 + 0.65 * Math.min(1, Math.max(0, mpg) / (0.85 * (L || 40)));
const OPP_LOGIT = 0.105;          // 0.05 points a play for the whole share (squad.js OPPOSITION.ppp) on the make logit
const PRIOR_DROP = { three: 0.07, rim: 0.06, mid: 0.04 };

/* his position, 1 (point) to 5 (centre): the minutes at each position where we have them, else the box-score position */
function posOf(r, share) {
  if (Array.isArray(share)) {
    const t = share.reduce((a, v) => a + (n0(v) > 0 ? +v : 0), 0);
    if (t > 0) return share.reduce((a, v, k) => a + (n0(v) > 0 ? +v : 0) * (k + 1), 0) / t;
  }
  const p = num(r && r.bpm_pos);
  return isNum(p) ? clamp(p, 1, 5) : 3;
}
/* minutes at PG..C as shares: given, else from the box-score position (2.3 is 70% shooting guard, 30% small forward) */
function shareOf(r, share) {
  if (Array.isArray(share)) {
    const t = share.reduce((a, v) => a + (n0(v) > 0 ? +v : 0), 0);
    if (t > 0) return [0, 1, 2, 3, 4].map(k => (n0(share[k]) > 0 ? +share[k] / t : 0));
  }
  const x = posOf(r) - 1, lo = Math.floor(x), hi = Math.min(4, lo + 1), f = x - lo, s = [0, 0, 0, 0, 0];
  s[lo] += 1 - f; if (hi !== lo) s[hi] += f; else s[lo] = 1;
  return s;
}
/* the events splits count where they cover at least half his games and five of them (squad.js evOf) */
const evOk = r => { const gp = n0(r.gp), eg = n0(r.ev_gp); return gp > 0 && eg >= 5 && eg / gp >= 0.5; };
const playsOf = (fga, fta, tov) => fga + 0.44 * fta + tov;

/* ------------------------------------------------------------------ the league --- */
const POS_RATES = ['oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct', 'ast_pct', 'usg'];
function refOf(rows) {
  const pop = (rows || []).filter(r => n0(r.min) >= POP_MIN);
  const S = { min: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, tov: 0, rimA: 0, rimM: 0, midA: 0, midM: 0, pf: 0, fast: 0, ast: 0, pts: 0,
    trPts: 0, trPlays: 0, hcPts: 0, hcPlays: 0, evPlays: 0, unRim: 0, mRim: 0, unMid: 0, mMid: 0, un3: 0, m3: 0, paceW: 0, pace: 0, ss: 0,
    rimVol: 0, rimVolW: 0 };
  const byPos = [1, 2, 3, 4, 5].map(() => ({ w: 0, s: {} }));
  pop.forEach(r => {
    const m = n0(r.min);
    ['fga', 'fgm', 'p3a', 'p3m', 'fta', 'ftm', 'tov', 'rimA', 'rimM', 'midA', 'midM', 'pf', 'fast', 'ast', 'pts'].forEach(k => { S[k] += n0(r[k]); });
    S.min += m;
    if (isNum(num(r.on_pace))) { S.pace += num(r.on_pace) * m; S.paceW += m; }
    S.ss += startersShare(n0(r.gp) > 0 ? m / r.gp : 0) * m;
    if (isNum(num(r.def_rim_vol_on)) && isNum(num(r.def_rim_vol_off))) { S.rimVol += (num(r.def_rim_vol_on) + num(r.def_rim_vol_off)) / 2 * m; S.rimVolW += m; }
    if (evOk(r)) {
      const tp = playsOf(n0(r.ev_transition_fga), n0(r.ev_transition_fta), n0(r.ev_transition_tov)), hp = playsOf(n0(r.ev_half_fga), n0(r.ev_half_fta), n0(r.ev_half_tov));
      S.trPts += n0(r.ev_transition_pts); S.trPlays += tp; S.hcPts += n0(r.ev_half_pts); S.hcPlays += hp;
      S.evPlays += playsOf(n0(r.ev_all_fga), n0(r.ev_all_fta), n0(r.ev_all_tov));
      const un = (k, made) => { const a = num(r['ev_' + k + '_astp']); if (isNum(a) && made > 0) return [made * (1 - a / 100), made]; return [0, 0]; };
      const a = un('rim', n0(r.rimM)), b = un('mid', n0(r.midM)), c = un('p3', n0(r.p3m));
      S.unRim += a[0]; S.mRim += a[1]; S.unMid += b[0]; S.mMid += b[1]; S.un3 += c[0]; S.m3 += c[1];
    }
    const k = clamp(Math.round(posOf(r)), 1, 5) - 1, P = byPos[k];
    P.w += m;
    POS_RATES.forEach(st => { const v = num(r[st]); if (isNum(v)) { P.s[st] = (P.s[st] || 0) + v * m; P.s[st + '_w'] = (P.s[st + '_w'] || 0) + m; } });
    P.s.pf = (P.s.pf || 0) + n0(r.pf); P.s.min = (P.s.min || 0) + m;
    P.s.p3a = (P.s.p3a || 0) + n0(r.p3a); P.s.fga = (P.s.fga || 0) + n0(r.fga); P.s.rimA = (P.s.rimA || 0) + n0(r.rimA);
  });
  const plays = playsOf(S.fga, S.fta, S.tov);
  const two = S.fga - S.p3a, zoned = S.rimA + S.midA;
  /* shot zones count when most of the league's twos have one (a feed with no shot locations has none) */
  const zones = two > 0 && zoned >= 0.6 * two;
  const rim2 = zoned > 0 ? S.rimA / zoned : 0.5;
  const div = (a, b, d) => (b > 0 ? a / b : d);
  const ref = {
    n: pop.length, min: S.min, zones, rim2,
    tovPlay: clamp(div(S.tov, plays, 0.14), 0.04, 0.4), ftaPlay: clamp(div(S.fta, plays, 0.25), 0.02, 0.8),
    ft: clamp(div(S.ftm, S.fta, 0.72), 0.4, 0.95), p3: clamp(div(S.p3m, S.p3a, 0.34), 0.15, 0.5), p2: clamp(div(S.fgm - S.p3m, two, 0.5), 0.3, 0.7),
    rim: clamp(div(S.rimM, S.rimA, 0.6), 0.35, 0.85), mid: clamp(div(S.midM, S.midA, 0.4), 0.2, 0.6),
    mix: (() => { const t3 = div(S.p3a, S.fga, 0.4); return { rim: (1 - t3) * rim2, mid: (1 - t3) * (1 - rim2), three: t3 }; })(),
    pf40: 40 * div(S.pf, S.min, 0.1), fast40: 40 * div(S.fast, S.min, 0.08), astShare: clamp(div(S.ast, S.fgm, 0.58), 0.3, 0.8),
    ppp: div(S.pts, plays, 1.0),
    pace: div(S.pace, S.paceW, 72), startersShare: div(S.ss, S.min, 0.55),
    rimVol: div(S.rimVol, S.rimVolW, 25),
    trPpp: div(S.trPts, S.trPlays, 1.12), hcPpp: div(S.hcPts, S.hcPlays, 0.92), trShare: div(S.trPlays, S.evPlays, 0.16), hasEv: S.evPlays > 0,
    un: { rim: div(S.unRim, S.mRim, 0.35), mid: div(S.unMid, S.mMid, 0.55), three: div(S.un3, S.m3, 0.12) },
    byPos: byPos.map(P => {
      const o = {};
      POS_RATES.forEach(st => { o[st] = P.s[st + '_w'] > 0 ? P.s[st] / P.s[st + '_w'] : null; });
      o.pf40 = P.s.min > 0 ? 40 * P.s.pf / P.s.min : null;
      o.p3sh = P.s.fga > 0 ? P.s.p3a / P.s.fga : null;
      o.rimsh = P.s.fga > 0 ? P.s.rimA / P.s.fga : null;
      return o;
    })
  };
  /* a position nobody played at (a small league, a feed with no positions): its neighbours' average, then the league's */
  const overall = st => { const xs = ref.byPos.map(p => p[st]).filter(isNum); return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null; };
  const FALLBACK = { oreb_pct: 6, dreb_pct: 15, stl_pct: 1.6, blk_pct: 1.5, ast_pct: 14, usg: 20, pf40: 3.5, p3sh: 0.38, rimsh: 0.3 };
  ref.byPos.forEach((p, k) => Object.keys(FALLBACK).forEach(st => {
    if (isNum(p[st])) return;
    const nb = [ref.byPos[k - 1], ref.byPos[k + 1]].filter(Boolean).map(q => q[st]).filter(isNum);
    p[st] = nb.length ? nb.reduce((a, v) => a + v, 0) / nb.length : (isNum(overall(st)) ? overall(st) : FALLBACK[st]);
  }));
  /* THE LEAGUE'S FIVE: one average player at each position, summed (the squad model's team aggregates) */
  ref.five = {};
  ['oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct', 'ast_pct', 'pf40'].forEach(st => { ref.five[st] = ref.byPos.reduce((a, p) => a + p[st], 0); });
  return ref;
}
/* the average at a continuous position (2.4 is 60% of the two's and 40% of the three's) */
function atPos(ref, pos, st) {
  const x = clamp(pos, 1, 5) - 1, lo = Math.floor(x), hi = Math.min(4, lo + 1), f = x - lo;
  const a = ref.byPos[lo][st], b = ref.byPos[hi][st];
  return isNum(a) && isNum(b) ? a + (b - a) * f : (isNum(a) ? a : b);
}

/* ------------------------------------------------------------------ one player --- */
/* the league-strength shift from two value ranges: log10 of the ratio of their midpoints (a league whose players are
   worth ten times another's is one step stronger), from the league he played in to the one he plays in now */
function shiftOf(from, to) {
  const mid = r => (r && isNum(+r.min) && isNum(+r.max) ? (+r.min + +r.max) / 2 : null);
  const a = mid(from), b = mid(to);
  return isNum(a) && isNum(b) && a > 0 && b > 0 ? clamp(Math.log10(a / b), -1, 1) : 0;
}
/* A STRONGER LEAGUE'S PLAYER IN A WEAKER ONE (shift > 0) makes more, turns it over less, takes on a little more of the
   offence and wins a little more of the ball; the other way round, less. An estimate per step of strength (a tenfold
   value ratio), said so: */
const SHIFT = { make: 0.12, tov: -0.10, usg: 1.5, rates: 0.08 };

function cardOf(r, ref, o) {
  o = o || {};
  const min = n0(r && r.min), gp = n0(r && r.gp);
  if (!r || !(min > 0) || !ref) return null;
  const fga = n0(r.fga), fgm = n0(r.fgm), p3a = n0(r.p3a), p3m = n0(r.p3m), fta = n0(r.fta), ftm = n0(r.ftm), tov = n0(r.tov);
  const rimA = n0(r.rimA), rimM = n0(r.rimM), midA = n0(r.midA), midM = n0(r.midM);
  const plays = playsOf(fga, fta, tov), mpg = gp > 0 ? min / gp : 0;
  const share = shareOf(r, o.share), pos = posOf(r, o.share);
  const shift = isNum(o.shift) ? clamp(o.shift, -1, 1) : 0;
  const shr = (x, n, p0, k) => (x + k * p0) / (n + k);
  const relPlay = plays / (plays + 60), relMin = min / (min + K.rate);
  /* THE OFFENCE, against his league */
  const tovP = shr(tov, plays, ref.tovPlay, K.tov);
  const ftaP = shr(fta, plays, ref.ftaPlay, K.fta);
  const zoned = ref.zones && rimA + midA > 0;
  /* the shot mix: the twos with no zone shared out as his own classified twos are (else as the league's) */
  const two = Math.max(0, fga - p3a), other = Math.max(0, two - rimA - midA), r2 = rimA + midA > 0 ? rimA / (rimA + midA) : ref.rim2;
  const rimAll = zoned ? rimA + other * r2 : two * ref.rim2, midAll = zoned ? midA + other * (1 - r2) : two * (1 - ref.rim2);
  const posRim = isNum(atPos(ref, pos, 'rimsh')) && ref.zones ? atPos(ref, pos, 'rimsh') : ref.mix.rim, posThree = atPos(ref, pos, 'p3sh');
  const prior3 = isNum(posThree) ? posThree : ref.mix.three, priorRim = Math.min(1 - prior3, posRim), priorMid = Math.max(0.01, 1 - prior3 - priorRim);
  let mix = { rim: shr(rimAll, fga, priorRim, K.mix), mid: shr(midAll, fga, priorMid, K.mix), three: shr(p3a, fga, prior3, K.mix) };
  { const t = mix.rim + mix.mid + mix.three; mix = { rim: mix.rim / t, mid: mix.mid / t, three: mix.three / t }; }
  /* THE PRIORS FALL WITH THE VOLUME: a man who rarely shoots threes (or rarely gets to the rim) is not a league-average
     shooter (or finisher) who happens not to - the ones who can, do. His prior sits below the league's by up to PRIOR_DROP
     as his share of those shots falls below the league's */
  const relSh = (a, lg) => (fga > 0 && lg > 0 ? clamp(a / fga / lg, 0, 1) : 0);
  const p3Prior = ref.p3 - PRIOR_DROP.three * (1 - relSh(p3a, ref.mix.three));
  const rimPrior = ref.rim - PRIOR_DROP.rim * (1 - relSh(rimAll, ref.mix.rim)), midPrior = ref.mid - PRIOR_DROP.mid * (1 - relSh(midAll, ref.mix.mid));
  const dRim = zoned ? logit(shr(rimM, rimA, rimPrior, K.rim)) - logit(ref.rim) : null;
  const dMid = zoned ? logit(shr(midM, midA, midPrior, K.mid)) - logit(ref.mid) : null;
  const d2 = logit(shr(fgm - p3m, two, ref.p2, K.two)) - logit(ref.p2);
  const d3 = logit(shr(p3m, p3a, p3Prior, K.three)) - logit(ref.p3);
  const dFt = logit(shr(ftm, fta, ref.ft, K.ft)) - logit(ref.ft);
  const ev = evOk(r);
  /* HOW HE GETS HIS SHOTS: the share of his makes at each zone that came off no pass (his own creation), shrunk toward
     the league's by his makes there - the less a volume change will cost him (engine.js) */
  const unOf = (k, made, lg) => { const a = num(r['ev_' + k + '_astp']); const m = ev && isNum(a) ? made : 0; return clamp(shr(m * (1 - (isNum(a) ? a : 0) / 100), m, lg, K.un), 0, 1); };
  const un = { rim: unOf('rim', rimM, ref.un.rim), mid: unOf('mid', midM, ref.un.mid), three: unOf('p3', p3m, ref.un.three) };
  /* the creator: the unassisted share of his points where the play-by-play covers him, else how far his usage stands
     above a role player's (squad.js creatorOf) */
  const usgRaw = num(r.usg), usg = clamp(shr(isNum(usgRaw) ? usgRaw * min : 0, isNum(usgRaw) ? min : 0, atPos(ref, pos, 'usg') || 20, K.usg) + SHIFT.usg * shift, 5, 45);
  const unPts = ev ? num(r.ev_unast_pts_sh) : null;
  const creator = clamp(isNum(unPts) ? unPts / 100 : (usg - 12) / 18, 0, 1);
  /* THE RATES SUMMED OVER THE FIVE: his, shrunk toward his position's by his minutes, moved by the league shift */
  const rate = st => { const v = num(r[st]), p = atPos(ref, pos, st); return (isNum(v) ? (v * min + p * K.rate) / (min + K.rate) : p) * (1 + SHIFT.rates * shift); };
  const pfPrior = atPos(ref, pos, 'pf40') / 40;
  const pf40 = 40 * (n0(r.pf) + K.pf * pfPrior) / (min + K.pf);
  /* the rim with him on against off (season.js def_rim_*): rim points saved per 100, and rim attempts kept away, each
     counted fully only with RIM_K opponent rim attempts on both sides */
  const aOn = n0(r.def_rim_a_on), aOff = n0(r.def_rim_a_off), wRim = Math.min(aOn, aOff) / (Math.min(aOn, aOff) + RIM_K);
  const von = num(r.def_rim_vol_on), voff = num(r.def_rim_vol_off), fon = num(r.def_rim_fg_on), foff = num(r.def_rim_fg_off);
  const rimSave = [von, voff, fon, foff].every(isNum) ? wRim * 2 * (voff * foff - von * fon) / 100 : 0;
  const rimDeter = isNum(von) && isNum(voff) ? wRim * (voff - von) : 0;
  /* THE ON/OFF, LIGHTLY: the weight grows with his possessions on the floor; where his own line has a gap it counts double */
  const onPoss = n0(r.on_poss), wo = ONOFF_MAX * onPoss / (onPoss + ONOFF_K);
  const oo = k => { const v = num(r[k]); return isNum(v) ? clamp(v, -25, 25) * wo : 0; };
  const gapShot = zoned ? 1 : 2, gapRim = wRim > 0.3 ? 1 : 2;
  const onoff = { efg: oo('diff_efg') * gapShot, tov: oo('diff_tov'), oreb: oo('diff_oreb'), vsEfg: oo('diff_vs_efg') * gapRim, vsTov: oo('diff_vs_tov'),
    vsOreb: oo('diff_vs_oreb'), vsFtr: oo('diff_vs_ftr') };
  /* the pace with him on, toward the league's by his minutes */
  const paceRaw = num(r.on_pace), pace = (isNum(paceRaw) ? (paceRaw * min + ref.pace * K.pace) / (min + K.pace) : ref.pace) / ref.pace;
  /* TRANSITION AND THE HALF COURT (Louie, 2026-10-09: transition "taking into account each player's transition metrics,
     same thing with half-court"; "If you encourage transition with a team whose players don't play often in transition
     I want there to be a penalty"): his points a play in each, shrunk toward the league's, and the share of his plays
     that come in transition (how used to running he is); without the play-by-play, his fast-break points per 40 against
     the league's stand in for the share */
  let tr;
  if (ev && ref.hasEv) {
    const tp = playsOf(n0(r.ev_transition_fga), n0(r.ev_transition_fta), n0(r.ev_transition_tov)), hp = playsOf(n0(r.ev_half_fga), n0(r.ev_half_fta), n0(r.ev_half_tov));
    const ap = playsOf(n0(r.ev_all_fga), n0(r.ev_all_fta), n0(r.ev_all_tov));
    tr = { ppp: shr(n0(r.ev_transition_pts), tp, ref.trPpp, K.tr), hcPpp: shr(n0(r.ev_half_pts), hp, ref.hcPpp, K.hc), share: shr(tp, ap, ref.trShare, K.trSh), ev: true };
  } else {
    const f40 = 40 * (n0(r.fast) + K.fast * ref.fast40 / 40) / (min + K.fast);
    tr = { ppp: ref.trPpp, hcPpp: ref.hcPpp, share: clamp(ref.trShare * (ref.fast40 > 0 ? f40 / ref.fast40 : 1), 0.02, 0.5), ev: false };
  }
  /* WHO HE FACED: starters' lines a little up, benches' a little down, as much as his line can be trusted */
  const ss = startersShare(mpg, o.gameMin || 40), opp = OPP_LOGIT * (ss - ref.startersShare) * relPlay;
  const make = SHIFT.make * shift + opp;
  return {
    id: String(r.id), min, gp, mpg, pos, share, shift, zoned, rel: { play: relPlay, min: relMin, onoff: wo, rim: wRim },
    usg, creator, un, mix,
    /* against his league: his shot mix (1 = the league's share at that zone) and his make rates (1 = the league's) */
    mixRel: { rim: mix.rim / Math.max(1e-3, ref.mix.rim), mid: mix.mid / Math.max(1e-3, ref.mix.mid), three: mix.three / Math.max(1e-3, ref.mix.three) },
    p3Rel: shr(p3m, p3a, p3Prior, K.three) / ref.p3,
    rimRel: zoned ? shr(rimM, rimA, rimPrior, K.rim) / ref.rim : shr(fgm - p3m, two, ref.p2, K.two) / ref.p2,
    off: { dTov: logit(tovP) - logit(ref.tovPlay) + SHIFT.tov * shift, rFta: ftaP / ref.ftaPlay, dRim: isNum(dRim) ? dRim + make : null, dMid: isNum(dMid) ? dMid + make : null,
      d2: d2 + make, d3: d3 + make, dFt, ast: rate('ast_pct'), orb: rate('oreb_pct'), pace, tr },
    def: { drb: rate('dreb_pct'), stl: rate('stl_pct'), blk: rate('blk_pct'), pf40, rimSave, rimDeter },
    onoff, opp, vorp: num(r.vorp), bpm: num(r.bpm)
  };
}

/* A REPLACEMENT-LEVEL MAN at position k (0..4): a club with fewer than five fit men (its best drafted away, a thin
   roster early in a season) fills the gap with the kind of player any club could sign - his position's average a little
   under (makes 0.15 logit down, rates 85%, usage 15), so a gap costs it and never breaks the game */
function fillerCard(ref, k, id) {
  const P = ref.byPos[clamp(k, 0, 4)], down = -0.15;
  return { id: String(id), min: 300, gp: 20, mpg: 8, pos: k + 1, share: [0, 1, 2, 3, 4].map(j => (j === k ? 1 : 0)), shift: 0, zoned: !!ref.zones, filler: true,
    rel: { play: 0.5, min: 0.4, onoff: 0, rim: 0 }, usg: 15, creator: 0.2, un: { rim: ref.un.rim, mid: ref.un.mid, three: ref.un.three }, mix: ref.mix,
    mixRel: { rim: 1, mid: 1, three: 1 }, p3Rel: 0.92, rimRel: 0.95,
    off: { dTov: 0.1, rFta: 0.9, dRim: down, dMid: down, d2: down, d3: down, dFt: 0, ast: 0.85 * P.ast_pct, orb: 0.85 * P.oreb_pct, pace: 1,
      tr: { ppp: ref.trPpp - 0.05, hcPpp: ref.hcPpp - 0.05, share: ref.trShare } },
    def: { drb: 0.85 * P.dreb_pct, stl: 0.85 * P.stl_pct, blk: 0.85 * P.blk_pct, pf40: 1.1 * P.pf40, rimSave: 0, rimDeter: 0 },
    onoff: { efg: 0, tov: 0, oreb: 0, vsEfg: 0, vsTov: 0, vsOreb: 0, vsFtr: 0 }, opp: 0, vorp: null, bpm: null };
}

/* THE LEAGUE'S AVERAGE MAN at position k: what an average five is made of (the tactics' "against an average club") */
function averageCard(ref, k, id) {
  const P = ref.byPos[clamp(k, 0, 4)];
  return { id: String(id), min: 1000, gp: 30, mpg: 30, pos: k + 1, share: [0, 1, 2, 3, 4].map(j => (j === k ? 1 : 0)), shift: 0, zoned: !!ref.zones, average: true,
    rel: { play: 0.9, min: 0.7, onoff: 0, rim: 0 }, usg: 20, creator: 0.35, un: { rim: ref.un.rim, mid: ref.un.mid, three: ref.un.three }, mix: ref.mix,
    mixRel: { rim: 1, mid: 1, three: 1 }, p3Rel: 1, rimRel: 1,
    off: { dTov: 0, rFta: 1, dRim: 0, dMid: 0, d2: 0, d3: 0, dFt: 0, ast: P.ast_pct, orb: P.oreb_pct, pace: 1, tr: { ppp: ref.trPpp, hcPpp: ref.hcPpp, share: ref.trShare } },
    def: { drb: P.dreb_pct, stl: P.stl_pct, blk: P.blk_pct, pf40: P.pf40, rimSave: 0, rimDeter: 0 },
    onoff: { efg: 0, tov: 0, oreb: 0, vsEfg: 0, vsTov: 0, vsOreb: 0, vsFtr: 0 }, opp: 0, vorp: null, bpm: null };
}

/* ------------------------------------------------------------------ form --- */
/* FORM, THE FANTASY PART (Louie, 2026-10-09: "I want it to be fantasy like - in that players' stats are manipulated by
   their IRL performances"): his real games in the days before a round (player_game_stats lines: min in ms, pts, p2m/a,
   p3m/a, ftm/a, or, dr, ast, stl, blk, to, pf) against his season, as a z-score of game score per minute - the
   difference over its noise (FORM_SD a minute over a 30-minute night, less over more minutes), times the window's
   minutes over minutes + FORM_K (a five-minute cameo says little), capped at 2 either way. No games, no form. */
const FORM_SD = 0.2, FORM_K = 30;
const gmscGame = s => n0(s.pts) + 0.4 * (n0(s.p2m) + n0(s.p3m)) - 0.7 * (n0(s.p2a) + n0(s.p3a)) - 0.4 * (n0(s.fta) - n0(s.ftm)) + 0.7 * n0(s.or) + 0.3 * n0(s.dr)
  + n0(s.stl) + 0.7 * n0(s.ast) + 0.7 * n0(s.blk) - 0.4 * n0(s.pf) - n0(s.to);
function formOf(r, games) {
  const min = n0(r && r.min);
  if (!(min > 0) || !Array.isArray(games) || !games.length) return 0;
  const season = (n0(r.pts) + 0.4 * n0(r.fgm) - 0.7 * n0(r.fga) - 0.4 * (n0(r.fta) - n0(r.ftm)) + 0.7 * n0(r.oreb) + 0.3 * n0(r.dreb) + n0(r.stl)
    + 0.7 * n0(r.ast) + 0.7 * n0(r.blk) - 0.4 * n0(r.pf) - n0(r.tov)) / min;
  let m = 0, g = 0;
  games.forEach(s => { const mm = n0(s && s.min) / 60000; if (mm > 0) { m += mm; g += gmscGame(s); } });
  if (m < 5) return 0;
  return clamp((g / m - season) / (FORM_SD * Math.sqrt(30 / m)) * m / (m + FORM_K), -2, 2);
}

/* ------------------------------------------------------------------ the listed position --- */
/* THE POSITION THE SITE LISTS HIM AT (Louie, 2026-10-09: "some of the positions are off from what they're listed as on
   the main site"). A listing that names one position (PG, SG, SF, PF, C) is his position. A broader one (G, F, G/F, F/C)
   is narrowed by the minutes he plays at each position (the position files), or by his season line's estimate. Without
   a listing, those alone decide.
     listedSlot(listed, share)  his position, 0 (PG) .. 4 (C)
     listedShare(line, listed)  his minutes at each position when there are no position files: the listing and the
                                season line's estimate, as the site places him (season.js positionValue: three parts the
                                estimate, one the listing); a listing that names a position keeps him within half a
                                position of it, so most of his minutes are there */
/* the positions a listing allows, [first, last] of PG..C: one position, a broad one (G, F), or two together - "G/F" (or
   "F/G") is where a guard and a forward meet (SG-SF), "C/F" a big forward or a centre (PF-C), "PG/SG" both */
const PART = { pg: [0, 0], 'point guard': [0, 0], sg: [1, 1], 'shooting guard': [1, 1], sf: [2, 2], 'small forward': [2, 2], pf: [3, 3], 'power forward': [3, 3],
  c: [4, 4], centre: [4, 4], center: [4, 4], g: [0, 1], guard: [0, 1], f: [2, 3], forward: [2, 3], wing: [1, 2], big: [3, 4], gf: [1, 2], fc: [3, 4] };
function spanOf(listed) {
  const parts = String(listed || '').trim().toLowerCase().split(/\s*(?:\/|-|,|&|\band\b)\s*/).filter(Boolean);
  if (!parts.length || parts.some(p => !PART[p])) return null;
  const spans = parts.map(p => PART[p]).sort((a, b) => a[0] - b[0]);
  if (spans.length === 2 && spans[0][1] + 1 === spans[1][0]) return [spans[0][1], spans[1][0]];
  return [Math.min(...spans.map(s => s[0])), Math.max(...spans.map(s => s[1]))];
}
function listedSlot(listed, share) {
  const sp = spanOf(listed), s = Array.isArray(share) ? share : [0, 0, 1, 0, 0];
  const ks = sp ? Array.from({ length: sp[1] - sp[0] + 1 }, (_, i) => sp[0] + i) : [0, 1, 2, 3, 4];
  return ks.reduce((b, j) => (n0(s[j]) > n0(s[b]) ? j : b), ks[0]);
}
function listedShare(r, listed) {
  const sp = spanOf(listed), l = sp ? (sp[0] + sp[1]) / 2 + 1 : null, calc = num(r && r.bpm_pos);
  let v = calc != null ? (l != null ? 0.75 * calc + 0.25 * l : calc) : l;
  if (v == null) return null;
  if (sp) v = sp[0] === sp[1] ? clamp(v, sp[0] + 0.55, sp[0] + 1.45) : clamp(v, sp[0] + 1, sp[1] + 1);
  const x = clamp(v - 1, 0, 4), lo = Math.floor(x), hi = Math.min(4, lo + 1), f = x - lo, s = [0, 0, 0, 0, 0];
  s[lo] += 1 - f; if (hi !== lo) s[hi] += f;
  return s;
}

return { refOf, cardOf, shiftOf, posOf, shareOf, atPos, startersShare, evOk, formOf, fillerCard, averageCard, listedSlot, listedShare,
  K, SHIFT, OPP_LOGIT, ONOFF_MAX, ONOFF_K, POP_MIN, PRIOR_DROP, FORM_SD, FORM_K };
}));
