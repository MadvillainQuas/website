'use strict';
/* ============================================================================
   THE BRIEF — everything one finished game knows about itself, in the one
   shape the fact engine reads.

   story.js deliberately takes a flat object rather than the scorer's derived
   state, so it can be tested against invented games and never has to know how
   the engine represents a substitution. This is the adapter between the two,
   and it is the only file that has to change if the engine's internals move.

   It pulls from three places, all of them already on the page:

     derive()        the replayed game — box, quarters, lineups, stints
     teamAdv()       the four factors and ratings, per side
     roster snapshot who was playing, so an id can become a name

   Nothing is fetched. A finished game's page has already replayed the entire
   event log to draw its box score; the report is written from that same replay
   rather than from a second read of the database, which is what guarantees the
   prose and the table underneath it cannot disagree.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGameFacts = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* Build the brief from the page's own globals. `B` is EpinoiaBox (the scorer's
   renderers, lifted); `S` is the replayed state; `d` is derive(). */
function brief(S, d, B) {
  const names = [S.teams[0].name, S.teams[1].name];

  /* every player, flattened, with their side and their derived line */
  const players = [], byId = {};
  S.teams.forEach((tm, t) => {
    (tm.players || []).forEach(p => {
      const s = d.stats[p.id] || {};
      const row = Object.assign({}, s, {
        id: p.id, name: p.name, num: p.num, team: t,
        ts: advTS(s)
      });
      players.push(row);
      byId[p.id] = row;
    });
  });

  /* the four factors and ratings, per side, from the same calculator the
     advanced tab prints */
  const adv = [B.teamAdv(d, 0), B.teamAdv(d, 1)];

  /* aggregated groups (who was out there together, and what it was worth) and
     the individual unbroken stints (which is where a decisive spell lives) */
  const lineups = [B.lineupAgg(d, 0), B.lineupAgg(d, 1)];
  const stints  = [d.lineups[0] || [], d.lineups[1] || []];

  let periods = 1;
  (S.events || []).forEach(e => { if (e.period > periods) periods = e.period; });

  return {
    names, score: d.score.slice(), players, byId,
    team: [d.team[0], d.team[1]], adv, lineups, stints,
    perQ: d.perQ, periods, events: S.events || [],
    /* set by game.js once the season aggregates land; the fact engine
       simply omits its season sentences when it is absent */
    season: S.season || null
  };
}

/* True shooting from the derived line. The engine carries it per player on the
   advanced tab but not on the plain box row, and the report wants it for the
   efficiency sentences. */
function advTS(s) {
  const fga = (s.p2a || 0) + (s.p3a || 0), fta = s.fta || 0;
  const den = 2 * (fga + 0.44 * fta);
  if (!den) return null;
  return (s.pts || 0) / den * 100;
}

return { brief, advTS };
}));
