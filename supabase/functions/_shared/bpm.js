/* GENERATED from epinoia/bpm.js by supabase/tests/extract-shared.mjs — do not edit. */
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
  else root.EpinoiaBPM = api;
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
/* opts.raw: the regressed estimate before the clamp to [1, 5] (A.1's slot ranking separates two players who both
   clamp to 1.0 or 5.0 by it); the default answer is unchanged */
function estimatePosition(p100, team100, minutes, listed, opts) {
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
  return opts && opts.raw ? w : clamp(w, 1, 5);
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
      /* the box score's own BPM, BEFORE the team adjustment: the adjustment
         puts the team's net rating into every player (the roster's mean is
         1.2 x net / 5 exactly), so a team-season figure built from `bpm` and
         set against the team's results explains the results with themselves.
         What wins (winmodel.js) uses this one wherever it does that. */
      bpmRaw: round1(r.adjRaw),
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

/* ------------------------------------------------------------- one game ---
   A GAME'S BPM FROM ITS BOX SCORE ALONE (2026-10-02): the player profile's game log and the social graphics' player of
   the game, stars and leaders, which have every player's line of a game but not its play-by-play. The box score page
   (game/game.js gameBPM) asks the same forTeam with the engine's team ratings; here the ratings come from the lines:
   each side's possessions 0.96 x (FGA + TOV + 0.44 FTA - OREB), its offensive rating per 100 of them and the other
   side's as its defensive rating, the game's pace per 40 minutes, and the two offences' average as the league's.
   lines: [{ id, side: 0 | 1, stats }] in the box score's own keys (min in ms, pts, p2m/p2a, p3m/p3a, ftm/fta, or, dr,
   ast, stl, blk, to, pf). -> Map id -> { bpm, obpm, dbpm }; nothing for a side without a line, or a player without
   a minute. A game with one side's lines only has no team ratings to adjust to, so nothing at all. */
function gameFromBox(lines) {
  /* the box score's own estimate: game() with neither the clubs' lines nor a season (kept for its callers; the pages ask game()) */
  return game({ lines });
}

/* ====================================================== one game, as BBRef ===
   A GAME'S BPM AS BASKETBALL-REFERENCE ADAPTS BPM 2.0 TO ONE GAME (2026-10-04; basketball-reference.com/about/bpm2.html,
   "game-level BPM"): the regression and its adjustments run on the game's box score, but
     - POSITION AND OFFENSIVE ROLE ARE THE SEASON'S, not one game's (a game is too few minutes to estimate them from);
     - THE TEAM'S RATING FOR THE GAME is not its margin alone. Each side's quality is first estimated from the players who
       actually played - each one's season BPM, regressed to the mean for few minutes, weighted by his share of the game's
       possessions - and the two estimates averaged; then each side gets half the game's efficiency margin either way,
       with the leading side credited 0.35 points per 100 possessions for every point of average lead (a side in the lead
       plays about that much worse). BBRef's example: both sides' players at +10, a +12 margin with a +5 average lead:
       +10 + 12/2 + 0.35/2 x 5 = +16.9 and +10 - 6 - 0.875 = +3.1;
     - A SEASON BPM FROM FEW MINUTES IS REGRESSED to -4.75 + 0.175 x minutes / (games + 4), weighted (450 - minutes) / 3
       (none past 450 minutes), against the season BPM weighted by its minutes. That estimate is BBRef's for a whole NBA
       season; for a season a few games old, or a league of fewer games, its LEVEL is set by the competition itself (calib:
       moved so the minute-weighted mean of every player's estimate is the competition's minute-weighted mean season BPM).
       Unmoved, two games into a season it put every player near -3, both sides' ratings 13 points low and every BPM 3 low;
       moved, it still says what a player of those minutes is worth, in this competition.
   Every page that prints one game's BPM asks this - the box score page's circles and the modern box (game/), the player's
   game log (p/player.js), the graphics' player of the game, stars and leaders (socialcard.js gameBPMs) - so a player's
   BPM for a game is the same number wherever it is printed.

   g: { lines: [{ id, side: 0 | 1, stats }]   both sides' box lines (min in ms, pts, p2m/p2a, p3m/p3a, ftm/fta, or, dr,
                                              ast, stl, blk, to, pf)
        clubs: [home, away] | null             the clubs' own lines for the game (engine.js teamAdv; team_game_stats.adv):
                                              pace, ortg, drtg and avgLead (the side's average lead, in points); without
                                              them each side's possessions, ratings and pace come from the lines and the
                                              lead correction is left out
        season: Map | { id: row } | null       the competition's season rows (season.js: bpm, min, gp, bpm_pos, bpm_role) }
   Without a season row a player's position and role are estimated from the game, and his season BPM is the regression's
   alone; without any season at all the team rating is the game's own margin (the box score estimate before 2026-10-04).
   -> Map id -> { bpm, obpm, dbpm }; nothing for a player without a minute, nor for a game with one side's lines only. */
const LEAD_PER_POINT = 0.35;
const estBase = row => { const min = row && row.min > 0 ? +row.min : 0, gp = row && row.gp > 0 ? +row.gp : 0; return -4.75 + 0.175 * (min / (gp + 4)); };
/* the competition's level for the estimate: its minute-weighted mean season BPM less the mean of the estimates (once a season) */
const CALIB = new WeakMap();
function calibration(season) {
  if (!season || typeof season !== 'object') return 0;
  if (CALIB.has(season)) return CALIB.get(season);
  let w = 0, b = 0, e = 0;
  (season.forEach ? [...season.values()] : Object.values(season)).forEach(r => {
    if (!r || !(r.min > 0) || r.bpm == null || !isFinite(r.bpm)) return;
    w += +r.min; b += r.min * r.bpm; e += r.min * estBase(r);
  });
  const c = w > 0 ? (b - e) / w : 0;
  CALIB.set(season, c);
  return c;
}
function regressedSeasonBPM(row, calib) {
  const min = row && row.min > 0 ? +row.min : 0;
  const est = estBase(row) + (+calib || 0);
  const w = Math.max(0, (450 - min) / 3);
  const b = row && row.bpm != null && isFinite(row.bpm) ? +row.bpm : est;
  return (min + w) > 0 ? (min * b + w * est) / (min + w) : est;
}
function game(g) {
  const out = new Map();
  const n = v => (v == null || isNaN(v) ? 0 : +v);
  const lines = (g && g.lines) || [];
  const seasonOf = id => { const S = g && g.season; return !S ? null : S.get ? S.get(id) || null : S[id] || null; };
  const sides = [0, 1].map(t => lines.filter(l => l && l.stats && +l.side === t).map(l => {
    const s = l.stats;
    const p = { id: l.id, minutes: n(s.min) / 60000, pts: n(s.pts), tpm: n(s.p3m), ast: n(s.ast), to: n(s.to), orb: n(s.or), drb: n(s.dr),
                stl: n(s.stl), blk: n(s.blk), pf: n(s.pf), fga: n(s.p2a) + n(s.p3a), fgm: n(s.p2m) + n(s.p3m), fta: n(s.fta) };
    const r = seasonOf(l.id);
    if (r && r.bpm_pos != null && isFinite(r.bpm_pos)) p.position = +r.bpm_pos;
    if (r && r.bpm_role != null && isFinite(r.bpm_role)) p.role = +r.bpm_role;
    return p;
  }).filter(p => p.minutes > 0));
  if (!sides[0].length || !sides[1].length) return out;
  const T = sides.map(ps => {
    const x = { pts: 0, fga: 0, fta: 0, oreb: 0, dreb: 0, tov: 0, stl: 0, pf: 0, ast: 0, blk: 0, min: 0 };
    ps.forEach(p => { x.pts += p.pts; x.fga += p.fga; x.fta += p.fta; x.oreb += p.orb; x.dreb += p.drb; x.tov += p.to;
                      x.stl += p.stl; x.pf += p.pf; x.ast += p.ast; x.blk += p.blk; x.min += p.minutes; });
    x.poss = Math.max(1, 0.96 * (x.fga + x.tov + 0.44 * x.fta - x.oreb));
    return x;
  });
  const gameMin = Math.max(1, Math.max(T[0].min, T[1].min) / 5);
  const clubs = g && g.clubs && g.clubs[0] && g.clubs[1] && n(g.clubs[0].pace) > 0 && n(g.clubs[1].pace) > 0 ? g.clubs : null;
  /* the club's own line counts the team turnovers and rebounds a player's line leaves out: its pace is the side's possessions */
  if (clubs) [0, 1].forEach(t => { T[t].poss = Math.max(1, n(clubs[t].pace) * gameMin / 40); });
  const ortg = [0, 1].map(t => (clubs && n(clubs[t].ortg) > 0 ? n(clubs[t].ortg) : 100 * T[t].pts / T[t].poss));
  const drtg = [0, 1].map(t => (clubs && n(clubs[t].drtg) > 0 ? n(clubs[t].drtg) : ortg[1 - t]));
  const pace = [0, 1].map(t => (clubs ? n(clubs[t].pace) : (T[0].poss + T[1].poss) / 2 / gameMin * 40));
  const leagueAvg = (ortg[0] + ortg[1]) / 2;
  const margin = [0, 1].map(t => ortg[t] - drtg[t]);
  /* THE TEAM RATING FOR THE GAME: the players who played, by their season BPMs, then half the margin each way */
  const S = g && g.season, hasSeason = !!S && (S.size > 0 || (!S.get && Object.keys(S).length > 0));
  let rating = margin;
  if (hasSeason) {
    const calib = calibration(S);
    const est = sides.map(ps => {
      const tm = ps.reduce((a, p) => a + p.minutes, 0);
      return tm > 0 ? ps.reduce((a, p) => a + regressedSeasonBPM(seasonOf(p.id), calib) * p.minutes / (tm / 5), 0) : 0;
    });
    const avgEst = (est[0] + est[1]) / 2;
    const lead = clubs && clubs[0].avgLead != null && isFinite(clubs[0].avgLead) ? n(clubs[0].avgLead) : 0;
    const adjMargin = (margin[0] - margin[1]) / 2 + LEAD_PER_POINT * lead;       // home's, per 100, lead-corrected
    rating = [avgEst + adjMargin / 2, avgEst - adjMargin / 2];
  }
  [0, 1].forEach(t => {
    const inputs = teamInputs(T[t], sides[t]);
    const team = { pace: pace[t], netRtg: rating[t], offRtg: ortg[t], avgPtsPerTSA: inputs.avgPtsPerTSA, per100: inputs.per100 };
    forTeam(team, sides[t], leagueAvg).forEach(r => { if (r.bpm != null) out.set(r.id, { bpm: r.bpm, obpm: r.obpm, dbpm: r.dbpm }); });
  });
  return out;
}

return {
  forLeague, forTeam, teamInputs, gameFromBox, game, regressedSeasonBPM, calibration, LEAD_PER_POINT,
  estimatedPossessions, per100, estimatePosition, estimateOffensiveRole,
  rawBPM, positionConstant, teamAdjustment, lerp,
  COEF_BPM_POSITION, COEF_BPM_ROLE, POS_CONST_BPM
};
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaBPM;
export const { forLeague, forTeam, teamInputs, estimatedPossessions, per100, estimatePosition, estimateOffensiveRole, rawBPM, positionConstant, teamAdjustment, lerp } = __api;
export default __api;
