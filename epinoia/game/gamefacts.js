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

  /* WHAT EACH KIND OF PLAY TURNED INTO: the events tab's own numbers (situations.js), per side,
     so the report can say where the points came from and not only how many there were. Null
     when the page has not loaded the calculator; every sentence built on it is then left out. */
  let sits = null;
  const Sit = root.EpinoiaSituations;
  if (Sit && Sit.compute) {
    try { const C = Sit.compute(S); if (C && C.side) sits = [C.side[0].sits, C.side[1].sits]; } catch (_) { sits = null; }
  }

  /* ASSISTED AND UNASSISTED BASKETS, and what became of every miss: the same counting the full stats tab draws
     (situations.js side[t].assists), kept whole so the report can say how a side scored as well as how much. */
  let assists = null;
  if (Sit && Sit.compute) {
    try { const C = Sit.compute(S); if (C && C.side && C.side[0].assists && C.side[1].assists) assists = [C.side[0].assists, C.side[1].assists]; } catch (_) { assists = null; }
  }
  /* AVERAGE TIME OF POSSESSION, per side, in seconds: the full stats tab's own (shotclock.js) */
  let atop = null;
  const SC = root.EpinoiaShotClock;
  if (SC && SC.averages) {
    try { const A = SC.averages(S); if (A && A[0] != null && A[1] != null) atop = [A[0], A[1]]; } catch (_) { atop = null; }
  }

  return {
    names, score: d.score.slice(), players, byId, assists, atop,
    team: [d.team[0], d.team[1]], adv, lineups, stints,
    perQ: d.perQ, periods, events: S.events || [], sits,
    /* who started, so a 20-point night off the bench can be called that */
    starters: S.starters || [[], []],
    /* where and when: the fixture's own facts, for the dateline */
    meta: {
      venue: S.venue || (S.meta && S.meta.venue) || null,
      attendance: (S.details && S.details.attendance) || null,
      tipoff_at: (S.meta && S.meta.tipoff_at) || null,
      competition: (S.meta && S.meta.competitionName) || null,
      league: (S.meta && S.meta.leagueName) || null,
      /* the percentile scales to read this game against. Without it story.js's scout fell back
         to SLB men's for every league, so a BCB report graded BCB numbers against a higher-
         scoring league's distribution. */
      leagueSlug: S.leagueSlug || null,
      timezone: (S.meta && S.meta.leagueTimezone) || null
    },
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
