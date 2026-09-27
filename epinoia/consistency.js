'use strict';
/* ============================================================================
   3PT CONSISTENCY - how steady a shooter is from three, from one number.

   Computed for ONE player, when his profile is opened, from the game log the page has already read (never for the
   whole league, which is the point: it costs nothing until somebody looks). Not a percentile: there is no league
   to rank him in, only his own season.

   THE SEASON IS COUNTED AND RECALCULATED AFTER EVERY GAME. Take the games in the order they were played and, after
   each one, work out the two things a shooter is judged on from what he has done SO FAR:
     - accuracy: makes / attempts, cumulative
     - volume:   attempts per 100 of his team's possessions while he was on the floor, cumulative
   Then look at how far those two running figures wandered from where the season ended. A shooter who was 38% after
   game 4 and 38% after game 20 has been the same shooter all year; one who was 52% then 31% has not. The same for
   how often he shoots. Two numbers, each turned into a 0-1 steadiness (1 = never moved), and their geometric mean
   is the score out of 100:

        accuracy steadiness = 1 / (1 + mean |running % - final %| / PCT_SCALE)          PCT_SCALE = 3 points
        volume steadiness   = 1 / (1 + mean |running vol - final vol| / final vol / VOL_SCALE)   VOL_SCALE = 0.2

   The first two games are left out of the walk (one game says nothing about a season), and so is any game before he
   had taken a three. A game with no possessions on record (no on-court block) counts for accuracy but not volume.
   Under MIN_GAMES games or MIN_ATT attempts there is nothing to be consistent about, and the answer says so.

   It measures STEADINESS, NOT QUALITY: a 25% shooter who is 25% every night scores high. The card shows his
   percentage and volume beside it for that reason.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaConsistency = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const MIN_GAMES = 5, MIN_ATT = 25, SKIP = 2;
const PCT_SCALE = 3, VOL_SCALE = 0.2;

const num = v => (v == null || !isFinite(v) ? 0 : Number(v));

/* games: [{ t, a, m, poss }] - one per game he played, in any order.
   a = 3PA, m = 3PM, poss = his team's possessions while he was on the floor (null when unknown) */
function threePt(games) {
  const g = (games || []).map(x => ({ t: +x.t || 0, a: num(x.a), m: num(x.m), poss: x.poss == null || !isFinite(x.poss) || x.poss <= 0 ? null : Number(x.poss) }))
    .sort((p, q) => p.t - q.t);
  const att = g.reduce((s, x) => s + x.a, 0);
  if (g.length < MIN_GAMES || att < MIN_ATT) {
    return { ok: false, games: g.length, att, why: 'needs ' + MIN_GAMES + ' games and ' + MIN_ATT + ' threes attempted (has ' + g.length + ' and ' + att + ')' };
  }
  const made = g.reduce((s, x) => s + x.m, 0);
  const withPoss = g.filter(x => x.poss != null);
  const possAll = withPoss.reduce((s, x) => s + x.poss, 0);
  const pct = 100 * made / att;
  const vol = possAll > 0 ? 100 * withPoss.reduce((s, x) => s + x.a, 0) / possAll : null;

  /* the running figures, after each game */
  let cA = 0, cM = 0, vA = 0, vP = 0;
  const curve = [], volCurve = [];
  g.forEach(x => {
    cA += x.a; cM += x.m;
    if (x.poss != null) { vA += x.a; vP += x.poss; }
    curve.push(cA > 0 ? 100 * cM / cA : null);
    volCurve.push(vP > 0 ? 100 * vA / vP : null);
  });
  let dP = 0, nP = 0, dV = 0, nV = 0;
  for (let k = SKIP; k < g.length; k++) {
    if (curve[k] != null) { dP += Math.abs(curve[k] - pct); nP++; }
    if (volCurve[k] != null && vol) { dV += Math.abs(volCurve[k] - vol) / Math.max(vol, 1); nV++; }
  }
  if (!nP) return { ok: false, games: g.length, att, why: 'no game after the second had a three taken' };
  const sP = 1 / (1 + (dP / nP) / PCT_SCALE);
  const sV = nV ? 1 / (1 + (dV / nV) / VOL_SCALE) : null;
  const score = Math.round(100 * (sV == null ? sP : Math.sqrt(sP * sV)));
  return {
    ok: true, score, label: label(score), games: g.length, att, made, pct, vol,
    accuracy: Math.round(100 * sP), volume: sV == null ? null : Math.round(100 * sV),
    curve: curve.map(v => (v == null ? null : Math.round(v * 10) / 10))
  };
}

const label = s => (s >= 75 ? 'very steady' : s >= 55 ? 'steady' : s >= 35 ? 'variable' : 'streaky');

/* rows: the profile's player_game_stats rows ({ stats, games: { tipoff_at, competition_id, status } }).
   scopeIds: the competitions the profile is showing (null = all). poss: EpinoiaSeason.POSS. */
function fromLog(rows, scopeIds, poss) {
  const keep = scopeIds && scopeIds.length ? new Set(scopeIds) : null;
  const games = (rows || []).filter(r => r && r.games && r.games.status === 'final' && (!keep || keep.has(r.games.competition_id)))
    .map(r => {
      const s = r.stats || {};
      if (!(num(s.min) > 0)) return null;
      const oc = s.oc || {};
      const p = poss && num(oc.tFGA) > 0 ? poss(oc.tFGA, oc.tFTA, oc.tTOV, oc.tOR) : null;
      return { t: Date.parse(r.games.tipoff_at) || 0, a: s.p3a, m: s.p3m, poss: p };
    }).filter(Boolean);
  return threePt(games);
}

return { threePt, fromLog, label, MIN_GAMES, MIN_ATT, PCT_SCALE, VOL_SCALE };
}));
