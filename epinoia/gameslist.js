'use strict';
/* ============================================================================
   GAMES LIST — which games a league's front page (and the platform hub) shows,
   and how they are asked for.

   The list used to be ONE read: every game of the league, newest first,
   capped at 400, and the page sorted the week out of whatever came back. A
   league with more than 400 fixtures (B.LEAGUE Premier has 780: every club
   plays sixty) got its 400 NEWEST -- next January to May -- so the games being
   played this week and every result fell outside the window before the page
   saw them. "This week" showed 21 January, "Results" said nothing had been
   played, and the header counted "400 upcoming" (reported 2026-09-24).

   The embedded strip solved this long ago by asking for what it wants rather
   than for everything: live games on their own, the soonest fixtures
   ascending, the latest results descending. This is that, for the front page.

     LIVE       every game being played, always
     RESULTS    finished games, latest first
     FIXTURES   scheduled games, soonest first, from six hours ago (a game that
                tipped late or is not flagged live yet is still the next thing
                on the page, not a vanished one)

   and the default "this week" view is the week either side of now, so its two
   reads are bounded in time as well as in number -- which also makes their
   exact counts (Content-Range) the honest numbers for the header line.

   Pure: no DOM, no network. home.js does the reading; this decides WHAT to ask
   and WHAT to show, so both can be run against a season's worth of games.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGamesList = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const HOUR = 3600000;
const WEEK = 7 * 24 * HOUR;
/* the strip's own allowance (epinoia/embed/strip/strip.js): a fixture whose tip-off has passed
   but which is not yet flagged live, or one that ran long, is still current for this long */
const GRACE = 6 * HOUR;
const CAP_WEEK = 15;        // rows on the default view -- the splash answers "what just happened
const CAP_LIST = 60;        // and what is next"; the fixtures page is for the season
const RECENT_SLOTS = 4;     // of the fifteen, held back for the latest results

/* A GAME BEING WRITTEN UP IS A FINISHED GAME (finalise-game holds 'finalising' while it rebuilds
   the tables, and a list that reads that as neither live nor final draws a played game as an
   upcoming fixture) */
const DONE = st => st === 'final' || st === 'finalising';
const at = g => new Date(g.tipoff_at || 0).getTime();
const stamp = ms => encodeURIComponent(new Date(ms).toISOString());
const DONE_Q = '&status=in.(final,finalising)';

/* THE READS, as the query text that follows `games?select=…`. `scope` is the caller's own
   filter (the league's competitions, or one of them) and goes on the end of every read. */
function queries(view, now, scope) {
  scope = scope || '';
  const week = view === 'week';
  const q = { live: '&status=eq.live&order=tipoff_at.asc&limit=50' + scope };
  if (view !== 'upcoming') {
    /* no upper bound on the week: a finalised game dated AHEAD (a mis-dated fixture) sorts first
       and rides at the end of the page instead of vanishing -- see `odd` in pick() */
    q.done = DONE_Q + (week ? '&tipoff_at=gte.' + stamp(now - WEEK) : '') +
             '&order=tipoff_at.desc&limit=' + (week ? CAP_WEEK : CAP_LIST) + scope;
  }
  if (view !== 'results') {
    q.next = '&status=eq.scheduled&tipoff_at=gte.' + stamp(now - GRACE) +
             (week ? '&tipoff_at=lte.' + stamp(now + WEEK) : '') +
             '&order=tipoff_at.asc&limit=' + (week ? CAP_WEEK : CAP_LIST) + scope;
  }
  return q;
}

/* WHAT LIES BEYOND AN EMPTY WEEK: the next game after it, one row, asked for only when the week
   itself has nothing to show -- "nothing this week" is an answer, "the next game is on the 2nd"
   is a better one */
function after(now, scope) {
  return '&status=eq.scheduled&tipoff_at=gt.' + stamp(now + WEEK) + '&order=tipoff_at.asc&limit=1' + (scope || '');
}

/* THE ROWS A VIEW SHOWS, from whatever the reads brought back.

   THE NEXT GAME FIRST -- the club pages' own rule (epinoia/t/team.js): anything LIVE, then what
   is still to come soonest-first, then the results latest-first, so the first row is always the
   nearest game and the rest fan out from it in both directions. Results keep a few of the fifteen
   (RECENT_SLOTS) because fixtures alone would fill them on any league with a season ahead, and the
   default view would stop answering "what just happened"; a league with few fixtures left does
   not waste the rest of its rows -- whatever the fixtures do not use falls back to the results.

   `totals` is what the database says each read HAD in it (Content-Range), which is the honest
   number when the read was capped: { done, next }. Without it the counts are what arrived. */
function pick(rows, view, now, totals) {
  const T = totals || {};
  const seen = new Set();
  rows = (rows || []).filter(g => g && !seen.has(g.id) && seen.add(g.id));

  const weekAgo = now - WEEK;
  const live = rows.filter(g => g.status === 'live');
  const done = rows.filter(g => DONE(g.status));
  /* both ends matter: without the upper bound a finalised game dated in the future counts as
     played this week */
  const recent = done.filter(g => at(g) >= weekAgo && at(g) <= now).sort((a, b) => at(b) - at(a));
  const odd = done.filter(g => at(g) > now).sort((a, b) => at(a) - at(b));
  const coming = rows.filter(g => g.status === 'scheduled' && at(g) >= now - GRACE).sort((a, b) => at(a) - at(b));
  const soon = coming.filter(g => at(g) <= now + WEEK);

  const cap = view === 'week' ? CAP_WEEK : CAP_LIST;
  let rest;
  if (view === 'results') {
    rest = done.slice().sort((a, b) => at(b) - at(a));
  } else if (view === 'upcoming') {
    rest = coming;
  } else {
    const room = Math.max(0, cap - live.length);
    const reserved = Math.min(recent.length, RECENT_SLOTS);
    const keepSoon = Math.min(soon.length, Math.max(0, room - reserved));
    const keepRecent = Math.min(recent.length, Math.max(0, room - keepSoon));
    rest = soon.slice(0, keepSoon).concat(recent.slice(0, keepRecent), odd);
  }
  const shown = live.concat(rest).slice(0, cap);

  const n = {
    live: live.length,
    odd: odd.length,
    /* the week's own counts: the exact ones when the read was bounded to the week */
    recent: view === 'week' && T.done != null ? Math.max(0, T.done - odd.length) : recent.length,
    soon: view === 'week' && T.next != null ? T.next : soon.length,
    results: view === 'results' && T.done != null ? T.done : done.length,
    upcoming: view === 'upcoming' && T.next != null ? T.next : coming.length
  };
  return Object.assign({ shown, view }, n, { note: note(view, n) });
}

/* the line beside the heading, built from pieces the translation packs already carry */
function note(view, n) {
  if (n.live) return n.live + ' live now';
  if (view === 'results') return n.results + (n.results === 1 ? ' result' : ' results');
  if (view === 'upcoming') return n.upcoming + ' upcoming';
  const bits = [];
  if (n.recent) bits.push(n.recent + (n.recent === 1 ? ' result' : ' results'));
  if (n.soon) bits.push(n.soon + ' upcoming');
  if (n.odd) bits.push(n.odd + ' dated ahead');
  return bits.join(' · ');
}

return { queries, after, pick, note, DONE, WEEK, GRACE, CAP_WEEK, CAP_LIST, RECENT_SLOTS };
}));
