'use strict';
/* ============================================================================
   COURTSIDE WITH-STATS — a player's own numbers, filtered by who was beside him.

   The team WOWY answers "how does the team do with these players on". This
   answers the other half, which is what index_9's player profile shows and the
   more interesting question about an individual: WHAT DOES THIS PLAYER DO when
   he shares the floor with that one. Does he shoot more next to a creator? Does
   his turnover rate rise against a second ball-handler? A team net rating
   cannot say.

   It is derived by replaying the event log rather than read from a table,
   because nothing stores it. lineup_stints holds the TEAM's box per five;
   nobody's individual box is broken down by teammate anywhere. The log has
   every event with its player, and every substitution with who came in and who
   went out — so walking it forward while tracking the five on the floor gives
   each event the context it happened in, and everything else is arithmetic.

   Minutes shared come from the stint durations rather than from the events,
   because an event log tells you what happened and not how long it took.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideWith = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const dv = (a, b) => (b ? a / b : null);
const pct = (a, b) => { const r = dv(a, b); return r == null ? null : r * 100; };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
const r2 = v => (v == null ? null : Math.round(v * 100) / 100);

/* every event that belongs to a player's own box score */
const SCORING = {
  p2_made: { fgm: 1, fga: 1, pts: 2 },
  p2_miss: { fga: 1 },
  p3_made: { fgm: 1, fga: 1, p3m: 1, p3a: 1, pts: 3 },
  p3_miss: { fga: 1, p3a: 1 },
  ft_made: { ftm: 1, fta: 1, pts: 1 },
  ft_miss: { fta: 1 },
  ast: { ast: 1 },
  stl: { stl: 1 },
  blk: { blk: 1 },
  to:  { tov: 1 },
  foul: { pf: 1 }
};

const blankBox = () => ({
  pts: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0,
  oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, events: 0
});

/* ------------------------------------------------------------------ replay ---
   games: [{ events, starters, teams }]
   Returns a flat list of {pid, team, on:Set-like array, box-delta} records. */
function index(games) {
  const recs = [];

  (games || []).forEach(g => {
    const events = (g.events || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0));
    /* the five on the floor per side, seeded from the game's frozen starters */
    const on = [
      new Set((g.starters && g.starters[0]) || []),
      new Set((g.starters && g.starters[1]) || [])
    ];

    events.forEach(e => {
      if (e.t === 'sub') {
        const side = on[e.team];
        if (!side) return;
        if (e.out) side.delete(e.out);
        if (e.in) side.add(e.in);
        return;
      }

      /* a rebound carries its own flag rather than a distinct type */
      let delta = SCORING[e.t];
      if (e.t === 'reb') delta = e.off ? { oreb: 1 } : { dreb: 1 };
      if (!delta || !e.pid) return;

      const side = on[e.team];
      if (!side) return;
      recs.push({ pid: e.pid, team: e.team, on: [...side], delta });
    });
  });

  return recs;
}

/* --------------------------------------------------------------- filtering ---
   A player's own box over the events that happened while every `withIds`
   player was on the floor and no `withoutIds` player was.

   The player himself must also have been on the floor, which he was by
   definition — he produced the event. */
function forPlayer(recs, playerId, withIds, withoutIds) {
  const need = (withIds || []).filter(id => id !== playerId);
  const banned = (withoutIds || []).filter(id => id !== playerId);
  const box = blankBox();

  (recs || []).forEach(r => {
    if (r.pid !== playerId) return;
    for (let i = 0; i < need.length; i++) if (r.on.indexOf(need[i]) === -1) return;
    for (let i = 0; i < banned.length; i++) if (r.on.indexOf(banned[i]) !== -1) return;
    Object.keys(r.delta).forEach(k => { box[k] += r.delta[k]; });
    box.events += 1;
  });
  return box;
}

/* turn a box plus the minutes it was accumulated over into a readable line */
function line(box, minutes) {
  const per36 = v => (minutes > 0 ? r1(v * 36 / minutes) : null);
  const tsa = box.fga + 0.44 * box.fta;
  return {
    mins: r1(minutes),
    pts: box.pts, fgm: box.fgm, fga: box.fga,
    p3m: box.p3m, p3a: box.p3a, ftm: box.ftm, fta: box.fta,
    reb: box.oreb + box.dreb, oreb: box.oreb, dreb: box.dreb,
    ast: box.ast, stl: box.stl, blk: box.blk, tov: box.tov, pf: box.pf,

    /* Per 36 rather than per game: these are slices of games, not whole ones,
       so a per-game average would divide by a number that does not exist.
       Minutes are the honest denominator for a split. */
    pts36: per36(box.pts), reb36: per36(box.oreb + box.dreb),
    ast36: per36(box.ast), tov36: per36(box.tov),
    fga36: per36(box.fga), p3a36: per36(box.p3a),

    fg_pct: r1(pct(box.fgm, box.fga)),
    p3_pct: r1(pct(box.p3m, box.p3a)),
    ft_pct: r1(pct(box.ftm, box.fta)),
    efg: r1(pct(box.fgm + 0.5 * box.p3m, box.fga)),
    ts:  r1(pct(box.pts, 2 * tsa)),
    ast_to: r2(dv(box.ast, box.tov))
  };
}

/* shared minutes, taken from the stints because the log has no durations */
function sharedMinutes(stints, ids, withoutIds) {
  const need = ids || [], banned = withoutIds || [];
  let ms = 0;
  (stints || []).forEach(st => {
    const on = st.player_ids || [];
    for (let i = 0; i < need.length; i++) if (on.indexOf(need[i]) === -1) return;
    for (let i = 0; i < banned.length; i++) if (on.indexOf(banned[i]) !== -1) return;
    ms += (st.stats && st.stats.dur) || 0;
  });
  return ms / 60000;
}

/* the whole comparison in one call: the player with these teammates, without
   them, and overall — which is the shape the panel renders */
function split(recs, stints, playerId, mateIds) {
  const mates = (mateIds || []).filter(id => id !== playerId);
  const all = line(forPlayer(recs, playerId, [], []),
                   sharedMinutes(stints, [playerId], []));
  if (!mates.length) return { all, withMates: null, without: null, mates };

  const withMates = line(forPlayer(recs, playerId, mates, []),
                         sharedMinutes(stints, [playerId].concat(mates), []));
  /* "without" means without ANY of them, which is the honest opposite of
     "with all of them" — anything else double-counts the middle ground */
  const without = line(forPlayer(recs, playerId, [], mates),
                       sharedMinutes(stints, [playerId], mates));
  return { all, withMates, without, mates };
}

return { index, forPlayer, line, split, sharedMinutes, blankBox };
}));
