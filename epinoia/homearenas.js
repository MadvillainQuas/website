'use strict';
/* ============================================================================
   HOME ARENAS - which arenas a club plays its home games at, and how much.

   A club has ONE home arena on record (teams.home_venue_id), but some play at
   two or three: a small hall for league games and the big one for the derby, a
   club that moved mid-season, a cup tie at the regional arena. The team profile
   shows the recorded one large and the others smaller, with their game counts;
   the platform console's "Home arena of" lists the clubs that use an arena at
   all, the recorded ones first.

   ONE RULE, HERE, for both places, so they can never disagree about what counts:
   an arena is a SECONDARY home arena of a club when it hosted at least MIN_GAMES
   of the club's home games and at least MIN_SHARE of the home games that name an
   arena at all. One neutral-venue cup tie is not a second home; a hall used for
   one game in ten is.

   Counted from the games themselves (games.venue_id), never stored, so a corrected
   game or a newly named arena is reflected the moment the page is read.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaHomeArenas = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const MIN_GAMES = 2;
const MIN_SHARE = 0.1;
const MAX_OTHERS = 4;

/* does n home games at one arena, out of `total` that name an arena, make it a home? */
function qualifies(n, total) {
  return n >= MIN_GAMES && total > 0 && n / total >= MIN_SHARE;
}

function tally(ids) {
  const m = new Map();
  (ids || []).forEach(id => { if (id) m.set(id, (m.get(id) || 0) + 1); });
  return m;
}

const byCountThenId = (a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/* A CLUB'S ARENAS. `venueIds` is the venue_id of each of its home games that names one;
   `primaryId` the recorded home arena (or nothing: then the busiest is the main one).
   -> { primary, primaryN, total, others: [{ id, n }] } with the others busiest first. */
function split(venueIds, primaryId) {
  const counts = tally(venueIds);
  let total = 0;
  counts.forEach(n => { total += n; });
  let primary = primaryId || null;
  if (!primary) {
    const top = [...counts].sort(byCountThenId)[0];
    primary = top ? top[0] : null;
  }
  const others = [...counts]
    .filter(([id, n]) => id !== primary && qualifies(n, total))
    .sort(byCountThenId).slice(0, MAX_OTHERS)
    .map(([id, n]) => ({ id, n }));
  return { primary, primaryN: counts.get(primary) || 0, total, others };
}

/* THE OTHER WAY ROUND, for the console: the clubs that use one arena as a secondary home.
   `teamIdsAtVenue` is the home_team_id of each game played at the arena; `totals` maps a club to
   how many of its home games name an arena at all; `recorded` are the clubs whose home arena it
   already is (listed on their own). -> [{ id, n, total }] busiest first. */
function clubsUsing(teamIdsAtVenue, totals, recorded) {
  const skip = new Set(recorded || []);
  return [...tally(teamIdsAtVenue)]
    .filter(([id, n]) => !skip.has(id) && qualifies(n, (totals && totals[id]) || 0))
    .sort(byCountThenId)
    .map(([id, n]) => ({ id, n, total: totals[id] }));
}

return { MIN_GAMES, MIN_SHARE, MAX_OTHERS, qualifies, split, clubsUsing };
}));
