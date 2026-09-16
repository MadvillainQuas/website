'use strict';
/* ============================================================================
   EPINOIA RAPM — regularised adjusted plus-minus, straight from the event log.

   A plus-minus says what happened while a player was on the floor. It does not
   say whether he caused it. Play every minute beside the best passer in the
   league and your on-court rating is his rating; play every minute against the
   opposition's starters and it is theirs. RAPM answers the question plus-minus
   only appears to answer: given every five-against-five arrangement the season
   actually contained, what value explains the results best if each player is
   assigned one number for his offence and one for his defence?

   That is a regression. Each matched stint gives TWO observations — the home
   team's offensive rating against the away five, and the away team's offensive
   rating against the home five. Each observation's row carries +1 for the five
   attacking, −1 for the five defending, and a half for home advantage. Solve
   for the coefficients and you have separated the ten players who were on the
   floor from one another.

   WHY IT IS REGULARISED. Unregularised, that system is close to singular: five
   players who never appear apart cannot be told apart, and the fit happily
   hands one of them +40 and another −40 because their sum is all the data
   constrains. Ridge regression adds λ to the diagonal, which is the same thing
   as saying "assume a player is league average until the evidence says
   otherwise". A player with two possessions gets shrunk almost to zero; a
   player with two thousand barely moves. That is not a fudge to make the
   numbers look sensible — it is the honest answer, because two possessions
   genuinely tell you nothing.

   PORTED FROM index_9.html's PlayerRAPMEngine (the ORtg model, ~line 15919),
   deliberately not reinvented. The platform has one RAPM, and a second one
   that disagreed by a point and a half would be worse than none. What came
   across, line for line:

     · design matrix              index_9 ~16157–16360 — offence +1, defence −1,
                                  one home-court column at ±0.5 so venue bias
                                  stops leaking into player coefficients
     · response centring          ~16225 — the weighted league mean is removed
                                  BEFORE the solve, so ridge shrinks towards
                                  league average rather than towards zero points
     · possession weighting       ~16171 — an ORtg observation is weighted by
                                  the possessions it was computed from
     · λ = 800 by default         config.defaultLambda ~15922, times
                                  lambdaScales.ORtg = 1.0 ~15931
     · λ = 'auto'                 ~17223–17370 — five-fold, GAME-blocked,
                                  golden-section over ln λ in [50, 8000]
     · light penalty on home      ~16406 — the HCA column gets λ/100, because it
                                  is a fixed effect and not a player to shrink
     · conjugate gradient         ~16447 — with index_9's scale-relative
                                  tolerance, max(1e-10, 1e-8·‖b‖)
     · possession-weighted centring of the finished coefficients ~16505
     · minimum 20 possessions to be reported  config.minPlayerPoss ~15924

   UNITS. Points per 100 possessions, the same units as an offensive rating, so
   a player at +3.0 is worth three points a hundred possessions above a league
   average player in the same role.

   SIGN CONVENTION — the one thing worth reading twice. Defenders enter the
   design matrix with −1, so a DEFENSIVE coefficient is positive when the
   player SUPPRESSES the opponent's rating. This module exposes that raw
   coefficient as `drapm`: HIGHER IS BETTER DEFENCE, and net is simply
   orapm + drapm.

   index_9 arrives at the same place by a detour worth naming, because anybody
   comparing the two will trip over it. Its getPlayerRapmValue (~18281) maps the
   'def' column with flipSign: true and hands back −β_def, and the Full Table
   row builder then negates AGAIN (~44885, `result.rapmDef = -rapmDef.rapm`).
   Two negations, so the D-RAPM column index_9 prints is β_def — exactly the
   number below. There is no third convention hiding anywhere; there is just a
   double negative on the way to the screen.

   WHAT IT NEEDS TO MEAN ANYTHING. Roughly thirty games of one competition
   before the coefficients stop being mostly prior, and a player needs a few
   hundred possessions before his own number carries more signal than his
   teammates'. Below that the honest read is "league average", which is what
   the shrinkage will tell you anyway.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaRAPM = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* --------------------------------------------------------------- constants ---
   Copied from engine.js rather than imported: this file is loaded on its own by
   pages that do not carry the engine, and a period length is not a thing two
   modules can disagree about without somebody noticing. */
const PLEN = p => (p <= 4 ? 600000 : 300000);
const cumEl = (p, clk) => {
  let s = 0;
  for (let q = 1; q < Math.max(1, p || 1); q++) s += PLEN(q);
  return s + (PLEN(p || 1) - Math.max(0, clk || 0));
};

const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;

/* The possession estimate the whole platform uses — engine.js teamTotals,
   lineups.js, season.js. possessions.js enumerates real possessions one at a
   time and is the better instrument when a play has to be LABELLED, but here
   only the denominator matters, and a denominator that differs from the one
   every rating on the site is divided by would make RAPM disagree with the
   ratings it is supposed to explain. */
const possEst = b => 0.96 * (num(b.fga) + num(b.tov) + 0.44 * num(b.fta) - num(b.or));

const DEFAULTS = {
  lambda: 800,        // index_9 config.defaultLambda × lambdaScales.ORtg (1.0)
  minPlayerPoss: 20,  // index_9 config.minPlayerPoss
  minStintPoss: 1,    // index_9 config.minStintPoss
  folds: 5,           // index_9's K, game-blocked
  hca: true,
  maxIter: 2000
};

/* ============================================================================
   PART ONE — MATCHED STINTS

   A stint here is not the engine's stint. deriveGame closes a lineup for ONE
   side when that side substitutes, which is right for a lineup table: the five
   is the same five whatever the opposition does. RAPM needs the opposite —
   a block of game time over which BOTH fives are constant, because the whole
   method rests on knowing who the ten players were.

   So the walk below closes at every substitution on either side. Everything
   else follows deriveGame exactly: the same game-time ordering (the log
   travels by sequence number, and a retroactively entered play carries the
   highest one, so it must be re-sorted before replay or a first-quarter basket
   lands after the buzzer), the same box-score bookkeeping that ocAdd does, and
   the same starters as the opening five.
   ============================================================================ */

/* engine.js inGameOrder, same tiebreak: equal clocks keep arrival order, which
   is what holds a run of free throws in the order they were shot. */
function inGameOrder(evs) {
  const n = evs.length;
  const keys = new Array(n);
  let ordered = true;
  for (let i = 0; i < n; i++) {
    const ev = evs[i];
    keys[i] = cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1));
    if (i && keys[i] < keys[i - 1]) ordered = false;
  }
  if (ordered) return evs;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => (keys[a] - keys[b]) || (a - b));
  return idx.map(i => evs[i]);
}

const mkBox = () => ({ pts: 0, fga: 0, fgm: 0, f3m: 0, fta: 0, tov: 0, or: 0, dr: 0 });

/* what each event adds to the attacking side's box — deriveGame's ocAdd,
   flattened. Rebounds and turnovers are credited to whoever the event names,
   which for a defensive rebound is the side that was NOT attacking, so each
   event is applied to the box of ev.team and mirrored into the other side's
   defensive box by the caller. */
function applyEvent(box, ev) {
  switch (ev.t) {
    case 'ft_miss': box.fta++; break;
    case 'ft_made': box.fta++; box.pts += 1; break;
    case 'p2_miss': box.fga++; break;
    case 'p2_made': box.fga++; box.fgm++; box.pts += 2; break;
    case 'p3_miss': box.fga++; break;
    case 'p3_made': box.fga++; box.fgm++; box.f3m++; box.pts += 3; break;
    case 'reb': if (ev.off) box.or++; else box.dr++; break;
    case 'to': box.tov++; break;
    default: return false;
  }
  return true;
}

/* ---------------------------------------------------------------- stints() ---
   games: [{ id, starters: [[home five], [away five]], events: [...],
             period?, clockMs? }]

   Returns matched stints, both sides at once:
     { gameId, home: [5 ids], away: [5 ids], seconds,
       poss, dposs, pf, pa }
   where poss/pf are the HOME side's offence and dposs/pa the away side's.

   A game with no starters is ignored rather than guessed at: without the
   opening five there is no way to know who was on the floor for the first
   substitution, and inventing it would put five wrong names on every
   possession before it. */
function stints(games) {
  const out = [];
  (games || []).forEach(g => {
    if (!g || !Array.isArray(g.starters)) return;
    const s0 = g.starters[0], s1 = g.starters[1];
    if (!Array.isArray(s0) || !Array.isArray(s1) || !s0.length || !s1.length) return;

    const events = inGameOrder((g.events || []).slice());
    const onCourt = [s0.slice(), s1.slice()];
    const gameId = g.id != null ? g.id : (events[0] && events[0].gameId) || null;

    let cur = {
      start: 0,
      home: onCourt[0].slice().sort(),
      away: onCourt[1].slice().sort(),
      off: mkBox(), def: mkBox()
    };
    let lastCum = 0;

    const close = cum => {
      const dur = Math.max(0, cum - cur.start);
      const poss = possEst(cur.off), dposs = possEst(cur.def);
      /* A stint nobody attacked in is not evidence about anybody — it is a
         dead ball with a substitution on either side of it. Dropping it keeps
         it out of the league mean as well as out of the design matrix. */
      if ((poss > 0 || dposs > 0) && cur.home.length === 5 && cur.away.length === 5) {
        out.push({
          gameId,
          home: cur.home, away: cur.away,
          seconds: dur / 1000,
          poss, dposs,
          pf: cur.off.pts, pa: cur.def.pts
        });
      }
    };

    events.forEach(ev => {
      const cum = cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1));
      if (cum > lastCum) lastCum = cum;

      if (ev.t === 'sub') {
        const t = ev.team;
        if (t !== 0 && t !== 1) return;
        close(cum);
        onCourt[t] = onCourt[t].filter(x => x !== ev.out);
        if (onCourt[t].indexOf(ev.in) === -1) onCourt[t].push(ev.in);
        cur = {
          start: cum,
          home: onCourt[0].slice().sort(),
          away: onCourt[1].slice().sort(),
          off: mkBox(), def: mkBox()
        };
        return;
      }

      if (ev.team !== 0 && ev.team !== 1) return;
      /* `off` is the home side's own ledger and `def` the away side's, which is
         the same ledger read from the other end — a home defensive rebound is a
         home rebound in both readings, so one credit is all ocAdd makes too. */
      applyEvent(ev.team === 0 ? cur.off : cur.def, ev);
    });

    const endCum = (g.period != null)
      ? Math.max(lastCum, cumEl(g.period, g.clockMs != null ? g.clockMs : 0))
      : lastCum;
    close(endCum);
  });
  return out;
}

/* ============================================================================
   PART TWO — THE RIDGE SOLVE
   ============================================================================ */

/* index and possession totals. The player list is SORTED so that the same
   input always produces the same column order, and therefore the same
   coefficients down to the last bit — conjugate gradient is deterministic but
   floating-point addition is not associative, so column order is part of the
   answer. index_9 sorts for the same reason (~16141). */
function buildIndex(rows) {
  const set = new Set();
  const poss = new Map();
  const mins = new Map();
  rows.forEach(st => {
    const secs = num(st.seconds) / 60;
    st.home.forEach(p => {
      set.add(p);
      poss.set(p, (poss.get(p) || 0) + num(st.poss));
      mins.set(p, (mins.get(p) || 0) + secs);
    });
    st.away.forEach(p => {
      set.add(p);
      poss.set(p, (poss.get(p) || 0) + num(st.dposs));
      mins.set(p, (mins.get(p) || 0) + secs);
    });
  });
  const list = Array.from(set).sort();
  const toIdx = new Map();
  list.forEach((p, i) => toIdx.set(p, i));
  return { list, toIdx, count: list.length, poss, mins };
}

const CLAMP_MIN = 0, CLAMP_MAX = 200;   // index_9 statConfigs.ORtg minVal/maxVal
const clamp = v => Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, v));

/* --------------------------------------------------------- design matrix ---
   Stored as CSR (row pointer, column index, value) in typed arrays. Each
   observation has at most eleven non-zeros — five attackers, five defenders,
   one home-court column — so the dense form would be 99.9% zeros and a season
   of it would not fit in a browser tab. */
function buildMatrices(rows, idx, opts) {
  const P = idx.count;
  const useHca = opts.hca !== false;
  const numFeat = P * 2 + (useHca ? 1 : 0);
  const hcaCol = useHca ? P * 2 : -1;

  /* FIRST PASS — the weighted league mean, so the response can be centred.
     Without this, ridge would shrink a player towards an offensive rating of
     zero, which no player has ever had; centred, it shrinks him towards the
     league, which is what "no evidence" should mean. index_9 ~16225. */
  let sumY = 0, sumW = 0;
  rows.forEach(st => {
    if ((num(st.poss) + num(st.dposs)) / 2 < opts.minStintPoss) return;
    if (st.poss > 0) { sumY += st.poss * clamp(st.pf / st.poss * 100); sumW += st.poss; }
    if (st.dposs > 0) { sumY += st.dposs * clamp(st.pa / st.dposs * 100); sumW += st.dposs; }
  });
  const yMean = sumW > 0 ? sumY / sumW : 0;

  /* SECOND PASS — count, then fill. Two passes over the stints beats growing
     three arrays. */
  const keep = [];
  rows.forEach(st => {
    if ((num(st.poss) + num(st.dposs)) / 2 < opts.minStintPoss) return;
    if (!(st.poss > 0) || !(st.dposs > 0)) return;          // one-sided stint tells us nothing about the other end
    if (st.poss < 0.5 || st.dposs < 0.5) return;            // index_9's weight floor
    if (st.home.length !== 5 || st.away.length !== 5) return;
    keep.push(st);
  });

  const numObs = keep.length * 2;
  const perObs = 5 + 5 + (useHca ? 1 : 0);
  const rowPtr = new Int32Array(numObs + 1);
  const colIdx = new Int32Array(numObs * perObs);
  const vals = new Float64Array(numObs * perObs);
  const y = new Float64Array(numObs);
  const w = new Float64Array(numObs);
  const obsGame = new Array(numObs);

  let o = 0, k = 0;
  const emit = (att, def, value, weight, gameId) => {
    rowPtr[o] = k;
    for (let i = 0; i < att.length; i++) {
      const c = idx.toIdx.get(att[i]);
      if (c === undefined) continue;
      colIdx[k] = c; vals[k] = 1; k++;
    }
    for (let i = 0; i < def.length; i++) {
      const c = idx.toIdx.get(def[i]);
      if (c === undefined) continue;
      colIdx[k] = P + c; vals[k] = -1; k++;
    }
    if (useHca) { colIdx[k] = hcaCol; vals[k] = value.hca; k++; }
    y[o] = value.y; w[o] = weight; obsGame[o] = gameId;
    o++;
  };

  keep.forEach(st => {
    /* +0.5 for the home offence and −0.5 for the away offence, so the single
       coefficient reads as the whole home-minus-away gap rather than half of it */
    emit(st.home, st.away, { y: clamp(st.pf / st.poss * 100) - yMean, hca: 0.5 }, st.poss, st.gameId);
    emit(st.away, st.home, { y: clamp(st.pa / st.dposs * 100) - yMean, hca: -0.5 }, st.dposs, st.gameId);
  });
  rowPtr[numObs] = k;

  return { rowPtr, colIdx, vals, y, w, obsGame, numObs, numFeat, hcaCol, yMean, stints: keep.length };
}

/* X'WX and X'Wy, optionally restricted to the observations of one fold.
   Accumulating into caller-supplied buffers is what makes cross-validation
   affordable: the per-fold normal equations are built once, and every λ trial
   is then a subtraction and a solve rather than another pass over the data. */
function normalEq(M, XtWX, XtWy, foldOf, fold) {
  const { rowPtr, colIdx, vals, y, w, numObs, numFeat } = M;
  for (let i = 0; i < numObs; i++) {
    if (foldOf && foldOf[i] !== fold) continue;
    const a = rowPtr[i], b = rowPtr[i + 1];
    const wi = w[i], yi = y[i];
    for (let p = a; p < b; p++) {
      const cp = colIdx[p], vp = vals[p];
      XtWy[cp] += wi * vp * yi;
      const base = cp * numFeat;
      for (let q = a; q < b; q++) XtWX[base + colIdx[q]] += wi * vp * vals[q];
    }
  }
}

/* index_9's conjugate gradient, ~16447. Dense A, because the normal-equations
   matrix of a RAPM model is not sparse — every pair of players who ever shared
   a floor is a non-zero — and at a few hundred players it is a few hundred
   kilobytes either way. */
function conjugateGradient(A, b, n, maxIter, tol) {
  const x = new Float64Array(n);
  const r = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);
  for (let i = 0; i < n; i++) { r[i] = b[i]; p[i] = b[i]; }
  let rsold = 0;
  for (let i = 0; i < n; i++) rsold += r[i] * r[i];

  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      const base = i * n;
      for (let j = 0; j < n; j++) s += A[base + j] * p[j];
      Ap[i] = s;
    }
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (Math.abs(pAp) < 1e-15) break;
    const alpha = rsold / pAp;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    let rsnew = 0;
    for (let i = 0; i < n; i++) rsnew += r[i] * r[i];
    if (Math.sqrt(rsnew) < tol) break;
    const beta = rsnew / rsold;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rsold = rsnew;
  }
  return x;
}

function solve(XtWX, XtWy, numFeat, lambda, hcaCol, maxIter, scratch) {
  const A = scratch || new Float64Array(numFeat * numFeat);
  if (A !== XtWX) A.set(XtWX);
  /* λ on the diagonal, but only λ/100 on home court: shrinking a fixed effect
     towards zero would quietly hand part of the home advantage back to
     whichever players happened to play more home games. */
  for (let i = 0; i < numFeat; i++) A[i * numFeat + i] += (i === hcaCol ? lambda * 0.01 : lambda);
  let bn = 0;
  for (let i = 0; i < numFeat; i++) bn += XtWy[i] * XtWy[i];
  const tol = Math.max(1e-10, 1e-8 * Math.sqrt(bn));
  return conjugateGradient(A, XtWy, numFeat, maxIter, tol);
}

/* ------------------------------------------------------------ λ by CV ------
   index_9 ~17223. The folds are blocked by GAME and not by stint, and that is
   the whole trick: lineups repeat heavily inside one game, so splitting a game
   across the train/test boundary leaves held-out stints with near-identical
   training rows. The leakage makes weaker regularisation look better than it
   is and drags λ to the floor of the search. */
function tuneLambda(M, opts) {
  const K = Math.max(2, opts.folds | 0 || 5);
  const p = M.numFeat, numObs = M.numObs;
  if (!numObs) return opts.lambda;

  const foldOf = new Int32Array(numObs);
  const games = [];
  const seen = new Map();
  for (let i = 0; i < numObs; i++) {
    const g = M.obsGame[i] == null ? '' : String(M.obsGame[i]);
    if (!seen.has(g)) { seen.set(g, games.length); games.push(g); }
  }
  const gameFold = new Map();
  games.forEach((g, gi) => gameFold.set(g, Math.min(K - 1, Math.floor(gi * K / games.length))));
  for (let i = 0; i < numObs; i++) foldOf[i] = gameFold.get(M.obsGame[i] == null ? '' : String(M.obsGame[i]));

  const XtWXfull = new Float64Array(p * p), XtWyFull = new Float64Array(p);
  normalEq(M, XtWXfull, XtWyFull, null, 0);
  const XtWXf = [], XtWyf = [];
  for (let f = 0; f < K; f++) {
    const A = new Float64Array(p * p), b = new Float64Array(p);
    normalEq(M, A, b, foldOf, f);
    XtWXf.push(A); XtWyf.push(b);
  }

  const Abuf = new Float64Array(p * p), bbuf = new Float64Array(p);
  const cache = new Map();
  const evalCV = lambda => {
    const key = Math.round(lambda);
    if (cache.has(key)) return cache.get(key);
    let sse = 0, wsum = 0;
    for (let f = 0; f < K; f++) {
      const Xf = XtWXf[f], yf = XtWyf[f];
      for (let i = 0; i < p * p; i++) Abuf[i] = XtWXfull[i] - Xf[i];
      for (let i = 0; i < p; i++) bbuf[i] = XtWyFull[i] - yf[i];
      const beta = solve(Abuf, bbuf, p, lambda, M.hcaCol, 1500, Abuf);
      for (let i = 0; i < numObs; i++) {
        if (foldOf[i] !== f) continue;
        let pred = 0;
        for (let q = M.rowPtr[i]; q < M.rowPtr[i + 1]; q++) pred += M.vals[q] * beta[M.colIdx[q]];
        const err = M.y[i] - pred;
        sse += M.w[i] * err * err; wsum += M.w[i];
      }
    }
    const rmse = wsum > 0 ? Math.sqrt(sse / wsum) : 999;
    cache.set(key, rmse);
    return rmse;
  };

  /* golden-section over ln λ — CV error is roughly unimodal in log space, and
     searching in the log is what keeps 50 and 5000 equally reachable */
  const gr = (Math.sqrt(5) + 1) / 2;
  let a = Math.log(50), b = Math.log(8000), steps = 0;
  while (b - a > 0.04 && steps < 25) {
    const c = b - (b - a) / gr, d = a + (b - a) / gr;
    if (evalCV(Math.exp(c)) < evalCV(Math.exp(d))) b = d; else a = c;
    steps++;
  }
  return Math.round(Math.exp((a + b) / 2));
}

/* --------------------------------------------------------------- compute() ---
   stints: the output of stints(), or anything with the same shape
   opts:   { lambda: number | 'auto', minPlayerPoss, minStintPoss, folds, hca }

   Returns, sorted best net first:
     [{ id, rapm, orapm, drapm, poss, minutes }]
   all three coefficients in points per 100 possessions, all three signed so
   that higher is better — including drapm (see the header). */
function compute(rows, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  rows = (rows || []).filter(s => s && Array.isArray(s.home) && Array.isArray(s.away));
  if (!rows.length) return [];

  const idx = buildIndex(rows);
  if (!idx.count) return [];

  const M = buildMatrices(rows, idx, o);
  if (!M.numObs) return [];

  const lambda = (o.lambda === 'auto') ? tuneLambda(M, o) : num(o.lambda);

  const XtWX = new Float64Array(M.numFeat * M.numFeat);
  const XtWy = new Float64Array(M.numFeat);
  normalEq(M, XtWX, XtWy, null, 0);
  const beta = solve(XtWX, XtWy, M.numFeat, lambda, M.hcaCol, o.maxIter);

  /* POSSESSION-WEIGHTED CENTRING, index_9 ~16505. Ridge already pulls towards
     the mean, but the fitted coefficients still carry a common offset that the
     home-court column and the response centring do not fully absorb. Removing
     the possession-weighted mean makes "0.0" mean what a reader assumes it
     means: an average player at this level of playing time. */
  const P = idx.count;
  let totPoss = 0, oSum = 0, dSum = 0;
  idx.list.forEach((p, i) => {
    const pp = idx.poss.get(p) || 0;
    totPoss += pp; oSum += beta[i] * pp; dSum += beta[P + i] * pp;
  });
  const oMean = totPoss > 0 ? oSum / totPoss : 0;
  const dMean = totPoss > 0 ? dSum / totPoss : 0;

  const out = [];
  idx.list.forEach((p, i) => {
    const pp = idx.poss.get(p) || 0;
    if (pp < o.minPlayerPoss) return;
    const orapm = beta[i] - oMean;
    /* raw β_def, unnegated: the defender's column is −1, so a big positive
       coefficient is a defender who took points off the opposition */
    const drapm = beta[P + i] - dMean;
    out.push({ id: p, rapm: orapm + drapm, orapm, drapm, poss: pp, minutes: idx.mins.get(p) || 0 });
  });

  /* deterministic order: net, then id, so two equal coefficients never swap */
  out.sort((a, b) => (b.rapm - a.rapm) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  out.lambda = lambda;
  out.hca = M.hcaCol >= 0 ? beta[M.hcaCol] : null;
  out.leagueAvg = M.yMean;
  return out;
}

/* ---------------------------------------------------------------- a season ---
   WHAT A PAGE ACTUALLY HAS: a list of games and epinoia/data.js. RAPM needs both
   fives on the floor, which only the event log knows, so the log has to be read --
   a hundred-odd games of it. It is read a few games at a time and turned into
   stints as it arrives, and each chunk's events are dropped before the next is
   fetched: the stints are a few thousand small objects, where the logs they came
   from are hundreds of thousands. onProgress(done, total) is called per chunk so a
   button can say how far along it is. */
const CHUNK = 12;
async function season(D, gameIds, onProgress, opts) {
  const ids = (gameIds || []).filter(Boolean);
  if (!ids.length) return { rapm: new Map(), stints: 0, games: 0 };
  /* the starters, which the season rows do not carry */
  const starters = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const c = ids.slice(i, i + 40);
    const rows = await D.all('games?id=in.(' + c.join(',') + ')&select=id,starters');
    rows.forEach(g => { if (g.starters) starters.set(g.id, g.starters); });
  }
  const all = [];
  let done = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const c = ids.slice(i, i + CHUNK).filter(id => starters.has(id));
    if (c.length) {
      const evs = await D.events(c);
      const byGame = new Map();
      evs.forEach(e => { if (!byGame.has(e.gameId)) byGame.set(e.gameId, []); byGame.get(e.gameId).push(e); });
      const games = c.map(id => ({ id, starters: starters.get(id), events: byGame.get(id) || [] }));
      all.push(...stints(games));
    }
    done = Math.min(ids.length, i + CHUNK);
    if (onProgress) onProgress(done, ids.length);
  }
  const out = compute(all, opts);
  return { rapm: new Map(out.map(r => [r.id, r])), stints: all.length, games: ids.length, lambda: out.lambda };
}

return { stints, compute, season, tuneLambda, possEst, DEFAULTS, VERSION: '1.0.0' };
}));
