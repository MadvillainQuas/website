'use strict';
/* ============================================================================
   BOX PLUS/MINUS 2.0

   Ported from the BPMCalculator in the scraper pipeline
   (scraper files/bcb_scraper.py), which implements Basketball-Reference's
   BPM 2.0 specification. Same coefficients, same structure, same order of
   operations — so a number here and a number there mean the same thing.

   The shape of it, because the coefficient tables alone do not explain it:

     BPM asks how many points per 100 possessions a player adds over a league-
     average player, from box score production alone. It is a BOX SCORE
     ESTIMATE, not a measurement — it cannot see a closeout, a rotation, or a
     screen, and it will underrate players whose value is in those things.

     Most coefficients scale with POSITION (1 through 5), because a rebound
     from a guard says something different from a rebound from a centre. Shot
     volume coefficients scale with OFFENSIVE ROLE instead, because the cost of
     a shot depends on whether you are the first option or the fifth.

     The team adjustment is what stops it drifting. Raw box score BPM across a
     roster does not add up to how good the team actually was, so the residual
     is shared out by minutes played. That is why BPM cannot be computed for
     one player in isolation — a team's worth of players goes in together.

   Position and role are ESTIMATED from production here. The Python driver
   passes 3.0 for both with a note that estimation could be added; the
   estimators were written and never wired in. They are wired in here, because
   a centre and a point guard being scored on the same curve is the largest
   avoidable error in the whole calculation. Pass fixed values to opt out.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideBPM = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ---------------------------------------------------------- coefficients ---
   Verbatim from BPM 2.0. A value that is a plain number is constant; one that
   is a pair is interpolated linearly between position (or role) 1 and 5. */
const COEF_BPM_POSITION = {
  pts_adj: 0.86, tpm: 0.389, to: -0.964, pf: -0.367,
  ast: { a: 0.58,  b: 1.034 },
  orb: { a: 0.613, b: 0.181 },
  drb: { a: 0.116, b: 0.181 },
  stl: { a: 1.369, b: 1.008 },
  blk: { a: 1.327, b: 0.703 }
};
const COEF_BPM_ROLE = {
  fga: { a: -0.56,   b: -0.78 },
  fta: { a: -0.2464, b: -0.3432 }
};
const POS_CONST_BPM = { pos: 0.159, role: 1.44, intercept: -4.99 };

const COEF_OBPM_POSITION = {
  pts_adj: 0.605, tpm: 0.477, ast: 0.476, pf: -0.439,
  to:  { a: -0.579, b: -0.882 },
  orb: { a: 0.606,  b: 0.422 },
  /* negative at the 1 on purpose: a guard's defensive rebound is, on average,
     a rebound somebody else could have had */
  drb: { a: -0.112, b: 0.103 },
  stl: { a: 0.177,  b: 0.294 },
  blk: { a: 0.725,  b: 0.097 }
};
const COEF_OBPM_ROLE = {
  fga: { a: -0.33,   b: -0.472 },
  fta: { a: -0.1452, b: -0.20768 }
};
const POS_CONST_OBPM = { pos: 0.08, role: 0.72, intercept: -2.50 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const div = (n, d) => (d > 0 ? n / d : 0);

/* interpolate between the 1 and 5 ends of a coefficient pair */
function lerp(coef, at) {
  if (typeof coef === 'number') return coef;
  if (!coef) return 0;
  const t = clamp((at - 1) / 4, 0, 1);
  return coef.a + t * (coef.b - coef.a);
}

/* -------------------------------------------------------------- per 100 ---
   Possessions are ESTIMATED from minutes and pace rather than counted,
   because a player's own possession count is not in a box score. The floor of
   half a possession keeps a one-minute appearance from dividing by nothing. */
function estimatedPossessions(minutes, teamPace) {
  return Math.max((minutes * teamPace) / 40, 0.5);
}

function per100(raw, possessions) {
  const keys = ['pts', 'tpm', 'ast', 'to', 'orb', 'drb', 'stl', 'blk', 'pf', 'fga', 'fta', 'trb'];
  if (!(possessions > 0.1)) {
    const z = {}; keys.forEach(k => { z[k] = 0; }); return z;
  }
  const f = 100 / possessions;
  const out = {};
  keys.forEach(k => { out[k] = (raw[k] || 0) * f; });
  if (raw.trb == null) out.trb = ((raw.orb || 0) + (raw.drb || 0)) * f;
  return out;
}

/* ------------------------------------------------------------- estimates --- */
function estimatePosition(p100, team100, minutes, listed) {
  const pctTrb = div(p100.trb, team100.trb);
  const pctStl = div(p100.stl, team100.stl);
  const pctPf  = div(p100.pf,  team100.pf);
  const pctAst = div(p100.ast, team100.ast);
  const pctBlk = div(p100.blk, team100.blk);

  const raw = 2.130 + 8.668 * pctTrb - 2.486 * pctStl + 0.992 * pctPf
                    - 3.536 * pctAst + 1.667 * pctBlk;

  /* Regressed towards the listed position by 50 minutes of prior. A player
     with twelve minutes on the season should not be called a centre because
     he happened to grab two rebounds. */
  const listedPos = listed == null ? 3.0 : listed;
  const w = (minutes * raw + 50 * listedPos) / (minutes + 50);
  return clamp(w, 1, 5);
}

function estimateOffensiveRole(p100, teamAvgPtsPerTSA, team100, minutes) {
  const tsa = (p100.fga || 0) + 0.44 * (p100.fta || 0);
  const thresholdEff = teamAvgPtsPerTSA - 0.33;
  const ptsPerTSA = tsa > 0 ? p100.pts / tsa : 0;

  let thresholdPts = 0;
  if (ptsPerTSA > thresholdEff) thresholdPts = p100.pts - thresholdEff * tsa;

  const pctAst = team100.ast > 0 ? div(p100.ast, team100.ast) : 0;
  const pctThr = team100.total_threshold_pts > 0
    ? div(thresholdPts, team100.total_threshold_pts) : 0;

  const raw = 6.0 - 6.642 * pctAst - 8.544 * pctThr;
  /* the prior here is 4.0 — a low-minute player is assumed to be a bit part,
     not a first option */
  const w = (minutes * raw + 50 * 4.0) / (minutes + 50);
  return clamp(w, 1, 5);
}

/* -------------------------------------------------------------- raw BPM --- */
function rawBPM(p100, teamAvgPtsPerTSA, position, role, kind) {
  const cp = kind === 'offensive' ? COEF_OBPM_POSITION : COEF_BPM_POSITION;
  const cr = kind === 'offensive' ? COEF_OBPM_ROLE : COEF_BPM_ROLE;

  const tsa = (p100.fga || 0) + 0.44 * (p100.fta || 0);
  /* Points are re-expressed against a baseline of 1.00 points per shooting
     attempt, so a player on an efficient team is not credited for the team's
     efficiency and vice versa. */
  const ptsAdj = tsa > 0 ? p100.pts + (1.0 - teamAvgPtsPerTSA) * tsa : p100.pts;

  const P = k => lerp(cp[k], position);
  const R = k => lerp(cr[k], role);

  return P('pts_adj') * ptsAdj
       + P('tpm') * (p100.tpm || 0)
       + P('ast') * (p100.ast || 0)
       + P('to')  * (p100.to  || 0)
       + P('orb') * (p100.orb || 0)
       + P('drb') * (p100.drb || 0)
       + P('stl') * (p100.stl || 0)
       + P('blk') * (p100.blk || 0)
       + P('pf')  * (p100.pf  || 0)
       + R('fga') * (p100.fga || 0)
       + R('fta') * (p100.fta || 0);
}

function positionConstant(position, role, kind) {
  const c = kind === 'offensive' ? POS_CONST_OBPM : POS_CONST_BPM;
  return c.pos * position + c.role * role + c.intercept;
}

/* --------------------------------------------------------- team adjustment ---
   The residual between what the box scores credit a roster with and how the
   team actually performed, shared out across the five on the floor.

   THE WEIGHTING IS THE TRAP, and the Python this was ported from gets it
   wrong. It weights each player by minutes / TOTAL PLAYER MINUTES, which sums
   to 1 across a roster. BPM wants each player's share of ONE POSITION's
   minutes — minutes / (total player minutes / 5) — which sums to 5, because
   five players are on the floor at once.

   With shares summing to 1 the adjustment removes only a fifth of the raw
   mean, so it never closes the gap and every BPM drifts upward. On the test
   roster below it produced +12.9, +11.6, +8.2, +8.1 and +7.0 for an ordinary
   five on a +4 team, where the whole roster should average about +1.

   Weighted correctly, the identity BPM is supposed to satisfy actually holds:
   the minute-weighted mean BPM across a roster comes to teamRating × 1.2 / 5.
   That identity is asserted in the tests, which is how the bug surfaced. */
function teamAdjustment(teamRating, weightedRawSum) {
  return (teamRating * 1.20 - weightedRawSum) / 5.0;
}

/* ================================================================ compute ===
   A WHOLE TEAM AT A TIME, because the team adjustment cannot be computed for
   one player alone.

   team: { pace, netRtg, offRtg, avgPtsPerTSA, per100:{trb,stl,pf,ast,blk,total_threshold_pts} }
   players: [{ id, minutes, listedPosition?, position?, role?,
               pts, tpm, ast, to, orb, drb, stl, blk, pf, fga, fta }]
   leagueAvgOrtg: needed for OBPM's team adjustment
   ============================================================================ */
function forTeam(team, players, leagueAvgOrtg) {
  const list = (players || []).filter(p => (p.minutes || 0) > 0);
  if (!list.length) return [];

  const teamMinutes = list.reduce((n, p) => n + (p.minutes || 0), 0);
  const pace = team.pace || 70;
  const avgPtsPerTSA = team.avgPtsPerTSA || 1.0;

  /* pass one: per-100, position, role, and the raw values the adjustment
     is computed from */
  const rows = list.map(p => {
    const poss = estimatedPossessions(p.minutes, pace);
    const p100 = per100(p, poss);
    const position = p.position != null ? p.position
      : estimatePosition(p100, team.per100 || {}, p.minutes, p.listedPosition);
    const role = p.role != null ? p.role
      : estimateOffensiveRole(p100, avgPtsPerTSA, team.per100 || {}, p.minutes);

    const raw = rawBPM(p100, avgPtsPerTSA, position, role, 'total');
    const rawO = rawBPM(p100, avgPtsPerTSA, position, role, 'offensive');
    return {
      id: p.id, minutes: p.minutes, p100, position, role,
      adjRaw:  raw  + positionConstant(position, role, 'total'),
      adjRawO: rawO + positionConstant(position, role, 'offensive'),
      /* Share of ONE POSITION's minutes, so the roster sums to 5 rather than
         to 1. That is what BPM's team adjustment expects, and getting it wrong
         is not a rounding matter — see the note above teamAdjustment. */
      posShare: teamMinutes > 0 ? p.minutes / (teamMinutes / 5) : 0,
      minShare: teamMinutes > 0 ? p.minutes / teamMinutes : 0
    };
  });

  const weighted  = rows.reduce((n, r) => n + r.posShare * r.adjRaw, 0);
  const weightedO = rows.reduce((n, r) => n + r.posShare * r.adjRawO, 0);

  const adj = teamAdjustment(team.netRtg || 0, weighted);
  const adjO = (leagueAvgOrtg == null || team.offRtg == null)
    ? 0 : teamAdjustment(team.offRtg - leagueAvgOrtg, weightedO);

  return rows.map(r => {
    const bpm = r.adjRaw + adj;
    const obpm = r.adjRawO + adjO;
    return {
      id: r.id, minutes: r.minutes,
      bpm: round1(bpm), obpm: round1(obpm), dbpm: round1(bpm - obpm),
      /* VORP, which is what BPM is usually read through: value over a
         replacement player (−2.0) in the minutes actually played. */
      vorp: round1((bpm + 2.0) * r.posShare),
      position: round1(r.position), role: round1(r.role)
    };
  });
}

const round1 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 10) / 10;

/* --------------------------------------------------------- a whole league ---
   teams: [{ id, pace, netRtg, offRtg, avgPtsPerTSA, per100, players: [...] }]
   Returns a Map of player id -> row. The league average offensive rating is
   derived here rather than asked for, because it is a property of the set. */
function forLeague(teams) {
  const withRtg = (teams || []).filter(t => t.offRtg != null);
  const leagueAvgOrtg = withRtg.length
    ? withRtg.reduce((n, t) => n + t.offRtg, 0) / withRtg.length : null;

  const out = new Map();
  (teams || []).forEach(t => {
    forTeam(t, t.players, leagueAvgOrtg).forEach(r => out.set(r.id, r));
  });
  return out;
}

/* the team-level inputs BPM needs, from a totals row and its players */
function teamInputs(totals, players) {
  const poss = totals.poss || 0;
  const p100f = poss > 0 ? 100 / poss : 0;
  const tsa = (totals.fga || 0) + 0.44 * (totals.fta || 0);
  const avgPtsPerTSA = tsa > 0 ? (totals.pts || 0) / tsa : 1.0;
  const thresholdEff = avgPtsPerTSA - 0.33;

  /* the denominator role estimation divides by: how much scoring above a
     replacement level of efficiency the whole team produced */
  let totalThreshold = 0;
  (players || []).forEach(p => {
    if (!(p.minutes > 0)) return;
    const ptsa = (p.fga || 0) + 0.44 * (p.fta || 0);
    const eff = ptsa > 0 ? (p.pts || 0) / ptsa : 0;
    if (eff > thresholdEff) totalThreshold += ((p.pts || 0) - thresholdEff * ptsa) * p100f;
  });

  return {
    avgPtsPerTSA,
    per100: {
      trb: ((totals.oreb || 0) + (totals.dreb || 0)) * p100f,
      stl: (totals.stl || 0) * p100f,
      pf:  (totals.pf  || 0) * p100f,
      ast: (totals.ast || 0) * p100f,
      blk: (totals.blk || 0) * p100f,
      total_threshold_pts: totalThreshold
    }
  };
}

return {
  forLeague, forTeam, teamInputs,
  estimatedPossessions, per100, estimatePosition, estimateOffensiveRole,
  rawBPM, positionConstant, teamAdjustment, lerp,
  COEF_BPM_POSITION, COEF_BPM_ROLE, POS_CONST_BPM
};
}));
