'use strict';
/* ============================================================================
   THE PLAYERS THEY COULD BE MATCHED UP ONTO (Louie, 2026-10-16): "potential match-up reports that show all of the potential
   match-ups for that player (gauged off of the opponents they're facing in the next week plus smart matching to
   position/one position up)". Pure: the mailer (scripts/report_mailer.mjs) runs it, and the tests on their own rows.

   WHERE A PLAYER PLAYS is the profile's own POSITION BREAKDOWN CALCULATED: the seconds they spent at PG, SG, SF, PF and C in
   every game of the season, every competition (the games' position files, snapshots/pos/<game>.json - p/player.js
   paintPosBreakdown reads the same). Its average spot, PG 1 to C 5: Dan Hadley at 75% SG and 24% SF is 2.25, a shooting
   guard. (A first version placed players by the season line's calculated position, ranked; Louie, 2026-10-16: "Why has it
   sent Torin and Andre Gayle when Dan's listed at SG? It should be sending more guards".)

   A POSITION is the spot rounded: PG, SG, SF, PF, C. THE SAME POSITION is theirs - and for a guard, either guard spot: a
   point guard and a shooting guard guard each other (Louie, 2026-10-16: for Dan Hadley, SG, "more guards like Walton and
   Jordan Jefferson" - Walton's minutes are all at the point). ONE POSITION UP is the next one above (a guard's: SF): the bigger
   player they can be switched onto, or asked to guard. Per club: its rotation players (MIN_MPG minutes a game over MIN_GP
   games) at the same position first, then one up, each by minutes; at most PER_TEAM, the last place kept for one up when the
   club has anyone there. A club with none gives its rotation
   player nearest above them, so no opponent goes without a match-up.

   spotOf(sec[5]) -> the average spot, or null with no minutes
   matchups({ me: { spot }, players: [{ id, team, spot, mpg, gp }], teams: [team id], perTeam, minMpg, minGp })
     -> { ok, why, me: { spot, pos }, byTeam: Map(team -> [{ id, spot, pos, rel: 'same'|'up'|'near', mpg }]) }
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMatchup = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const PER_TEAM = 5, MIN_MPG = 10, MIN_GP = 2;
const SPOTS = ['PG', 'SG', 'SF', 'PF', 'C'];

const isNum = x => typeof x === 'number' && isFinite(x);
/* the average spot of seconds at PG..C */
function spotOf(sec) {
  if (!Array.isArray(sec)) return null;
  let t = 0, w = 0;
  for (let k = 0; k < 5; k++) { const x = +sec[k] || 0; if (x > 0) { t += x; w += (k + 1) * x; } }
  return t > 0 ? Math.round(1000 * w / t) / 1000 : null;
}
/* a spot as a position, 1 (PG) to 5 (C), and as its letters: 2.25 is 2, SG */
const idxOf = spot => (isNum(spot) ? Math.min(5, Math.max(1, Math.round(spot))) : null);
const posOf = spot => (isNum(spot) ? SPOTS[idxOf(spot) - 1] : null);
/* how a player stands to them: the same position (a guard: either guard spot), one position up, or neither */
function relOf(mine, theirs) {
  const a = idxOf(mine), b = idxOf(theirs);
  if (a == null || b == null) return null;
  if (a <= 2 ? b <= 2 : b === a) return 'same';
  return b === (a <= 2 ? 3 : a + 1) ? 'up' : null;
}

function matchups(o) {
  const perTeam = o.perTeam || PER_TEAM, minMpg = o.minMpg == null ? MIN_MPG : o.minMpg, minGp = o.minGp == null ? MIN_GP : o.minGp;
  const byTeam = new Map();
  (o.teams || []).forEach(t => byTeam.set(t, []));
  const me = o.me || {};
  if (!isNum(me.spot)) return { ok: false, why: 'their position is not known yet (no minutes on the floor this season)', me: null, byTeam };
  const rot = (o.players || []).filter(r => r && r.id != null && isNum(r.spot) && (r.gp || 0) >= minGp && (r.mpg || 0) >= minMpg && r.id !== me.id);
  (o.teams || []).forEach(t => {
    const pool = rot.filter(r => r.team === t).map(r => {
      const d = r.spot - me.spot;
      return { id: r.id, spot: r.spot, pos: posOf(r.spot), mpg: Math.round(r.mpg * 10) / 10, d, rel: relOf(me.spot, r.spot) };
    });
    /* the same position first, by minutes; and while there is anyone one position up, the last place is theirs (a guard's
       club with five guards in its rotation still shows the forward they would be switched onto) */
    const same = pool.filter(x => x.rel === 'same').sort((a, b) => b.mpg - a.mpg);
    const up = pool.filter(x => x.rel === 'up').sort((a, b) => b.mpg - a.mpg);
    const keep = Math.min(same.length, up.length ? perTeam - 1 : perTeam);
    let got = same.slice(0, keep).concat(up.slice(0, perTeam - keep));
    if (!got.length && pool.length) {
      /* nobody in the window: the one nearest above them (else the nearest at all) */
      const above = pool.filter(x => x.d >= 0).sort((a, b) => a.d - b.d);
      got = [Object.assign((above.length ? above : pool.slice().sort((a, b) => Math.abs(a.d) - Math.abs(b.d)))[0], { rel: 'near' })];
    }
    byTeam.set(t, got.map(x => ({ id: x.id, spot: x.spot, pos: x.pos, rel: x.rel, mpg: x.mpg })));
  });
  return { ok: true, why: null, me: { spot: me.spot, pos: posOf(me.spot) }, byTeam };
}

/* in the site's words: they/their, never he/his (it covers women's leagues too) */
const REL = { same: 'same position', up: 'one position up', near: 'nearest position up' };

return { matchups, spotOf, posOf, idxOf, relOf, PER_TEAM, MIN_MPG, MIN_GP, SPOTS, REL };
}));
