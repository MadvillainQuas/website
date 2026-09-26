'use strict';
/* ============================================================================
   GAME PERCENTILES — how good one game's number is, read against real games.

   A PRESET, NOT A QUERY. tools/build-gamepct.mjs replays a season of real
   games through the site's own engine, box score and situations code and
   writes the scales to epinoia/gamepct-data.js. Nothing here asks the database
   anything, so a box score colours itself the moment it draws.

   The same three rules apply when the preset is built and when a number is
   read against it, so a game is always compared like with like:

     GATED. A number with nothing behind it has no percentile. A TS% on no
     shots, an on-court rating over three possessions, a free-throw percentage
     with no free throws: none of them is coloured.

     PULLED TOWARDS THE LEAGUE ON A SMALL SAMPLE. A rate is shrunk towards the
     league's average by its own volume, (n·x + k·μ) / (n + k). One-for-one from
     three is not a great night; eight-for-ten is. k is set per stat, near a
     typical game's volume for a player and far below it for a team, so a
     full team game is barely moved and a garbage-time line mostly is.

     WEIGHTED TO SEASON AVERAGES. The scale is 60% the spread of season
     averages and 40% the spread of single games, quantile by quantile. Single
     games alone are so noisy that a 70% TS night would read as merely good;
     season averages alone are so tight that an ordinary off night would read
     as the worst in the league. The blend keeps what a single game can
     realistically do while anchoring good and bad to what is good and bad
     over a season.

   A COUNT (points in the paint, biggest lead) has no sample size to shrink by.
   A finished game is read per forty minutes (so overtime does not flatter
   it); a game still going is read as its count so far plus a league-average
   rest of the game.

   Directions: 1 more is better, -1 less is better, 0 neither. Usage, pace and
   possessions are 0: they get a percentile but no colour, because a high one
   is a style rather than a success. A lower-is-better stat reports the
   percentile of GOODNESS (a 9% turnover rate is the 85th, not the 15th), as
   every percentile on the statistics pages does.

   Loaded on the game page as a global (EpinoiaGamePct), after
   gamepct-data.js; a module in node, where the build and the tests read it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGamePct = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

let data = null;
function DATA() {
  if (data) return data;
  if (root.EpinoiaGamePctData) data = root.EpinoiaGamePctData;
  else if (typeof require === 'function') { try { data = require('./gamepct-data.js'); } catch (_) { data = null; } }
  return data;
}

/* the percentiles each scale is stored at */
const GRID = [1, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97, 99];
const SEASON_WEIGHT = 0.6;

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const gameMin = T => Math.max(1, ((T && T.minutes) || 0) / 5);   // teamAdv's minutes are five players' worth

/* ---------------------------------------------------------------- stats ---
   Each stat: d (direction), x (the value, as the page shows it), n (its
   volume), k (the shrink), min (the least volume that gets a percentile).
   count: a count, read per forty minutes as described above; 'max' is a
   running maximum (a biggest lead), read as it stands.

   TEAM   ctx { T, O, c }       T, O: boxscore.js teamAdv rows for this side and
                                the other; c: derive()'s team line (paint, fast …)
   PLAYER ctx { a, x, TT, OT }  a: playerAdv row; x: derive()'s stats line;
                                TT, OT: the two teamAdv rows
   SIT    ctx { s }             a situations.js bucket for a side; its keys are
                                'situation.stat' (second.ppp, half.efg …)
   PSIT   ctx { s }             the same bucket for one player
   ZONE   ctx { z }             { a, m }: attempts and makes from rim, mid or three
   --------------------------------------------------------------------------- */
const TEAM = {
  ortg:        { d: 1,  x: c => c.T.ortg,        n: c => c.T.possessions, k: 10, min: 8 },
  drtg:        { d: -1, x: c => c.T.drtg,        n: c => c.O.possessions, k: 10, min: 8 },
  ppp:         { d: 1,  x: c => c.T.ppp,         n: c => c.T.possessions, k: 10, min: 8 },
  efg:         { d: 1,  x: c => c.T.efg,         n: c => c.T.fga, k: 10, min: 5 },
  ts:          { d: 1,  x: c => c.T.ts,          n: c => c.T.tsa, k: 10, min: 5 },
  tovp:        { d: -1, x: c => c.T.tovp,        n: c => c.T.fga + 0.44 * c.T.fta + c.T.tov, k: 10, min: 5 },
  orebp:       { d: 1,  x: c => c.T.orebp,       n: c => c.T.oreb + c.O.dreb, k: 8, min: 4 },
  drebp:       { d: 1,  x: c => c.T.drebp,       n: c => c.T.dreb + c.O.oreb, k: 8, min: 4 },
  ftr:         { d: 1,  x: c => c.T.ftr,         n: c => c.T.fga, k: 12, min: 5 },
  ftp:         { d: 1,  x: c => c.T.ftp,         n: c => c.T.fta, k: 6, min: 2 },
  astp:        { d: 1,  x: c => c.T.astp,        n: c => c.T.fgm, k: 6, min: 3 },
  astTo:       { d: 1,  x: c => c.T.astTo,       n: c => c.T.ast + c.T.tov, k: 10, min: 4 },
  stlp:        { d: 1,  x: c => c.T.stlp,        n: c => c.O.possessions, k: 12, min: 8 },
  blkp:        { d: 1,  x: c => c.T.blkp,        n: c => c.O.fga - c.O.fg3a, k: 10, min: 4 },
  rimp:        { d: 1,  x: c => c.T.rimp,        n: c => c.T.rimA, k: 5, min: 2 },
  rimr:        { d: 1,  x: c => c.T.rimr,        n: c => c.T.fga, k: 10, min: 5 },
  midp:        { d: 1,  x: c => c.T.midp,        n: c => c.T.midA, k: 5, min: 2 },
  p3p:         { d: 1,  x: c => c.T.p3p,         n: c => c.T.fg3a, k: 6, min: 2 },
  p3r:         { d: 1,  x: c => c.T.p3r,         n: c => c.T.fga, k: 10, min: 5 },
  astPtsP:     { d: 1,  x: c => c.T.astPtsP,     n: c => c.T.pts - c.T.ftm, k: 15, min: 6 },
  tsaPer100:   { d: 1,  x: c => c.T.tsaPer100,   n: c => c.T.possessions, k: 10, min: 8 },
  tsa:         { d: 0,  x: c => c.T.tsa,         n: c => gameMin(c.T), count: true },
  possessions: { d: 0,  x: c => c.T.possessions, n: c => gameMin(c.T), count: true },
  paceOwn:     { d: 0,  x: c => c.T.paceOwn,     n: c => gameMin(c.T), k: 6, min: 4 },
  paint:       { d: 1,  x: c => c.c && c.c.paint, n: c => gameMin(c.T), count: true },
  fast:        { d: 1,  x: c => c.c && c.c.fast,  n: c => gameMin(c.T), count: true },
  sc:          { d: 1,  x: c => c.c && c.c.sc,    n: c => gameMin(c.T), count: true },
  pot:         { d: 1,  x: c => c.c && c.c.pot,   n: c => gameMin(c.T), count: true },
  bench:       { d: 1,  x: c => c.c && c.c.bench, n: c => gameMin(c.T), count: true },
  lead:        { d: 1,  x: c => c.c && c.c.lead,  n: c => gameMin(c.T), count: 'max' }
};

const fga = x => (x.p2a || 0) + (x.p3a || 0);
const tsa = x => fga(x) + 0.44 * (x.fta || 0);
const used = x => tsa(x) + (x.to || 0);
/* the share of the game's rebounds, possessions and twos a player was on the floor for */
const onShare = (c, total) => (c.a.min || 0) * total / gameMin(c.TT);
const ocPoss = oc => 0.96 * (oc.tFGA + oc.tTOV + 0.44 * oc.tFTA - oc.tOR);
const ocOppPoss = oc => 0.96 * (oc.oFGA + oc.oTOV + 0.44 * oc.oFTA - oc.oOR);
const PLAYER = {
  ts:        { d: 1,  x: c => c.a.ts,     n: c => tsa(c.x), k: 8, min: 2 },
  ppp:       { d: 1,  x: c => c.a.ppp,    n: c => used(c.x), k: 8, min: 2 },
  usg:       { d: 0,  x: c => c.a.usg,    n: c => c.a.min, k: 8, min: 4 },
  ftr:       { d: 1,  x: c => c.a.ftr,    n: c => fga(c.x), k: 8, min: 3 },
  rimP:      { d: 1,  x: c => c.a.rimP,   n: c => c.x.rimA || 0, k: 4, min: 2 },
  midP:      { d: 1,  x: c => c.a.midP,   n: c => c.x.midA || 0, k: 4, min: 2 },
  p3P:       { d: 1,  x: c => c.a.p3P,    n: c => c.x.p3a || 0, k: 4, min: 2 },
  tpc:       { d: 1,  x: c => c.a.tpc,    n: c => gameMin(c.TT), count: true },
  astPct:    { d: 1,  x: c => c.a.astPct, n: c => Math.max(0, onShare(c, c.TT.fgm) - ((c.x.p2m || 0) + (c.x.p3m || 0))), k: 6, min: 3 },
  tovP:      { d: -1, x: c => c.a.tovP,   n: c => used(c.x), k: 8, min: 2 },
  orebP:     { d: 1,  x: c => c.a.orebP,  n: c => onShare(c, c.TT.oreb + c.OT.dreb), k: 8, min: 4 },
  drebP:     { d: 1,  x: c => c.a.drebP,  n: c => onShare(c, c.TT.dreb + c.OT.oreb), k: 8, min: 4 },
  stlP:      { d: 1,  x: c => c.a.stlP,   n: c => onShare(c, c.OT.fga + 0.44 * c.OT.fta - c.OT.oreb + c.OT.tov), k: 30, min: 10 },
  blkP:      { d: 1,  x: c => c.a.blkP,   n: c => onShare(c, c.OT.fga - c.OT.fg3a), k: 20, min: 6 },
  au:        { d: 1,  x: c => c.a.au,     n: c => c.a.min, k: 12, min: 6 },
  pacePM:    { d: 0,  x: c => c.a.pacePM, n: c => Math.min(c.a.min, gameMin(c.TT) - c.a.min), k: 8, min: 6 },
  ocOrtg:    { d: 1,  x: c => c.a.ocOrtg,    n: c => ocPoss(c.x.oc), k: 25, min: 12 },
  ocDrtg:    { d: -1, x: c => c.a.ocDrtg,    n: c => ocOppPoss(c.x.oc), k: 25, min: 12 },
  net:       { d: 1,  x: c => c.a.net,       n: c => (ocPoss(c.x.oc) + ocOppPoss(c.x.oc)) / 2, k: 25, min: 12 },
  ocEfg:     { d: 1,  x: c => c.a.ocEfg,     n: c => c.x.oc.tFGA, k: 15, min: 8 },
  ocOreb:    { d: 1,  x: c => c.a.ocOreb,    n: c => c.x.oc.tOR + c.x.oc.oDR, k: 8, min: 5 },
  ocTov:     { d: -1, x: c => c.a.ocTov,     n: c => c.x.oc.tFGA + 0.44 * c.x.oc.tFTA + c.x.oc.tTOV, k: 15, min: 10 },
  ocOppEfg:  { d: -1, x: c => c.a.ocOppEfg,  n: c => c.x.oc.oFGA, k: 15, min: 8 },
  ocOppOreb: { d: -1, x: c => c.a.ocOppOreb, n: c => c.x.oc.oOR + c.x.oc.tDR, k: 8, min: 5 },
  ocTovF:    { d: 1,  x: c => c.a.ocTovF,    n: c => c.x.oc.oFGA + 0.44 * c.x.oc.oFTA + c.x.oc.oTOV, k: 15, min: 10 }
};

/* situations: points per chance, eFG% and turnover rate in each of situations.js's buckets
   (percentages as the page prints them, 0-100), for a side and for a player's eFG% */
const SITS = ['all', 'second', 'transition', 'offTo', 'ato', 'half'];
const SIT = {}, PSIT = {};
SITS.forEach(s => {
  const big = s === 'all' || s === 'half';
  SIT[s + '.ppp'] = { d: 1,  x: c => c.s.ppp,                                n: c => c.s.chances, k: big ? 12 : 6, min: 2 };
  SIT[s + '.efg'] = { d: 1,  x: c => (c.s.efg == null ? null : 100 * c.s.efg), n: c => c.s.fga, k: big ? 12 : 6, min: 3 };
  SIT[s + '.tov'] = { d: -1, x: c => (c.s.tovPct == null ? null : 100 * c.s.tovPct), n: c => c.s.chances, k: big ? 12 : 8, min: 2 };
  PSIT[s + '.efg'] = { d: 1, x: c => (c.s.efg == null ? null : 100 * c.s.efg), n: c => c.s.fga, k: 6, min: 3 };
});
/* HOW OFTEN A SIDE GETS THIS KIND OF CHANCE AT ALL, not just what it did with the ones it got --
   a share of every chance the side had (ctx.all is 'all's own bucket, alongside ctx.s for the
   situation itself). Second-chance, transition and off-turnover chances are the opportunistic
   ones a good team creates more of, so more is better; half-court is what is left over once
   those are accounted for, so less of it reads the same way round. After-timeout chances are a
   count of timeouts called, not a skill, so it is left out; 'all' is trivially always 100%. */
const FREQ_DIR = { second: 1, transition: 1, offTo: 1, half: -1 };
Object.keys(FREQ_DIR).forEach(s => {
  SIT[s + '.freq'] = { d: FREQ_DIR[s],
    x: c => (c.all && c.all.chances ? 100 * c.s.chances / c.all.chances : null),
    n: c => (c.all ? c.all.chances : 0), k: 10, min: 5 };
});
/* a zone's field-goal percentage in a situation, for a side and for a player:
   'team.transition.rim', 'player.all.three'; 'all' as the zone is every field goal */
const ZONE = {};
['team', 'player'].forEach(w => SITS.forEach(s => ['rim', 'mid', 'three', 'all'].forEach(z => {
  ZONE[w + '.' + s + '.' + z] = { d: 1, x: c => (c.z.a ? 100 * c.z.m / c.z.a : null), n: c => c.z.a, k: w === 'team' ? 6 : 4, min: 3 };
})));

const SCOPES = { team: TEAM, player: PLAYER, sit: SIT, psit: PSIT, zone: ZONE };

/* ------------------------------------------------------------------ read --- */
/* the value and volume a context gives a stat, or null where it is gated out */
function sample(scope, key, ctx) {
  const st = SCOPES[scope] && SCOPES[scope][key];
  if (!st) return null;
  let x, n;
  try { x = num(st.x(ctx)); n = num(st.n(ctx)); } catch (_) { return null; }
  if (x == null || n == null) return null;
  if (!st.count && !(n >= st.min)) return null;
  if (st.count && !(n > 0)) return null;
  return { x, n };
}

/* the number a sample is read as: shrunk towards the league's average, or a count put on a
   forty-minute footing. mu is the league's average (per game, for a count). */
function adjusted(st, x, n, mu) {
  if (st.count === 'max') return x;
  if (st.count) return n >= 40 ? x * 40 / n : x + mu * (40 - n) / 40;
  return (n * x + st.k * mu) / (n + st.k);
}

/* where v falls on a scale stored at GRID: linear between the stored points, a plateau (a
   count many games share) read at its middle, and never quite 0 or 100 off either end */
function percentileOf(q, v) {
  if (!q || !q.length || v == null) return null;
  if (v < q[0]) return 0.5;
  if (v > q[q.length - 1]) return 99.5;
  let lo = -1, hi = -1;
  for (let i = 0; i < q.length; i++) {
    if (q[i] <= v) lo = i;
    if (hi < 0 && q[i] >= v) hi = i;
  }
  if (lo < 0) return GRID[0];
  if (hi < 0) return GRID[GRID.length - 1];
  if (q[lo] === v || q[hi] === v) {
    let a = hi, b = lo;                          /* the run of stored points equal to v */
    while (a > 0 && q[a - 1] === v) a--;
    while (b < q.length - 1 && q[b + 1] === v) b++;
    return (GRID[a] + GRID[b]) / 2;
  }
  return GRID[lo] + (GRID[hi] - GRID[lo]) * (v - q[lo]) / (q[hi] - q[lo]);
}

/* the preset a league reads: its own where the build had its games, otherwise the default */
function leagueKey(slug) {
  const D = DATA();
  if (!D) return null;
  const s = String(slug || '').toLowerCase();
  return (D.alias && D.alias[s]) || (D.leagues && D.leagues[s] ? s : D.fallback);
}
/* the scale a league reads, and whether it is another league's: a league with no games in the
   build reads the default's, and says so wherever the percentile is named */
function scaleOf(slug) {
  const D = DATA(), lk = leagueKey(slug);
  if (!lk) return null;
  const s = String(slug || '').toLowerCase();
  return { league: lk, borrowed: !((D.alias && D.alias[s]) || (D.leagues && D.leagues[s])) };
}

/* THE READING. rate('player', 'ts', ctx, { league, flip }) -> null, or
     { p: the raw percentile, g: its goodness (p, or 100 - p for less-is-better),
       d: the direction, band: 0-6 (null for a neutral stat), league: the preset used }
   flip turns the direction round, for a number shown from the other side (the events tab's
   defence view is the other team's offence). */
function rate(scope, key, ctx, opts) {
  const o = opts || {};
  const st = SCOPES[scope] && SCOPES[scope][key];
  const D = DATA();
  const lk = leagueKey(o.league);
  const L = D && lk && D.leagues[lk];
  const ref = L && L[scope] && L[scope][key];
  if (!st || !ref) return null;
  const s = sample(scope, key, ctx);
  if (!s) return null;
  let p = percentileOf(ref.q, adjusted(st, s.x, s.n, ref.mu));
  if (p == null) return null;
  /* A BIG NIGHT NEEDS A REAL SAMPLE. Shrinking already pulls three-for-three most of the way
     back, but a perfect small sample can still out-rank a very good full one; below the stat's
     own k it cannot reach either outer band, whatever it shot. */
  const small = !st.count && s.n < st.k;
  if (small) p = Math.min(89, Math.max(11, p));
  const d = o.flip ? -st.d : st.d;
  const g = d < 0 ? 100 - p : p;
  return { p, g, d, band: d ? band(g) : null, league: lk, borrowed: scaleOf(o.league).borrowed, small, n: s.n };
}

/* THE LEAGUE AVERAGE of a stat on a league's scale (the mu a small sample is pulled towards), or null
   when the preset has none for it. Full stats reads it for the points each factor added or lost. */
function mean(scope, key, slug) {
  const D = DATA(), lk = leagueKey(slug);
  const ref = D && lk && D.leagues[lk] && D.leagues[lk][scope] && D.leagues[lk][scope][key];
  return ref && isFinite(ref.mu) ? ref.mu : null;
}

/* the statistics pages' seven bands (fulltable.js heatStyle), 6 the best */
function band(g) {
  if (g == null) return null;
  return g >= 90 ? 6 : g >= 75 ? 5 : g >= 60 ? 4 : g >= 40 ? 3 : g >= 25 ? 2 : g >= 10 ? 1 : 0;
}

/* --------------------------------------------------------------- present --- */
const ord = n => {
  const r = Math.round(n), t = r % 100;
  return r + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] || 'th');
};
/* the words beside a percentile: which games it was read against */
function against(r) {
  const D = DATA();
  const L = D && r && D.leagues[r.league];
  return L ? L.label + (r.borrowed ? BORROWED : '') : 'real games';
}
const BORROWED = ' (borrowed: no scale of this league\'s own yet)';
/* ' gp gp-b5' for an element's class list, '' for nothing to colour */
const cls = r => (r && r.band != null ? ' gp gp-b' + r.band : '');
/* "71st percentile" (for a neutral stat, "71st percentile, neither good nor bad") */
function words(r) {
  if (!r) return '';
  return ord(r.d ? r.g : r.p) + ' percentile' + (r.d ? '' : ' (a style, not a score)') + ' against ' + against(r);
}
/* the small percentile figure a tile or a card shows under its number */
const pcHTML = r => (r ? '<i class="gp-pc' + (r.band != null ? ' gp-b' + r.band : '') + '">' + Math.round(r.d ? r.g : r.p) + '</i>' : '');

return { rate, sample, adjusted, percentileOf, leagueKey, scaleOf, mean, band, ord, cls, words, pcHTML, against,
         GRID, SEASON_WEIGHT, SCOPES, TEAM, PLAYER, SIT, PSIT, ZONE, SITS,
         _setData: v => { data = v; } };
}));
