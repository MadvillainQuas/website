'use strict';
/* ============================================================================
   HOW A TABLE IS SPLIT AND READ — shared by the league page and the embed.

   Three shapes of competition reach a standings table:

     table        one table, ranked by league points (every league until now)
     groups       two or more tables, each ranked on its own (ProB Nord / Süd)
     conferences  one table per conference, divisions inside a conference, and
                  TWO records per club (0144): the complete schedule and the
                  conference-only record. Ranked by the conference record,
                  because that is what a college conference seeds by.

   The ranking itself is done once, in recompute_standings, and arrives here as
   `rank` within (group, division). Nothing in this file re-ranks a
   conference table. The one exception is the OVERALL view of a conference
   league, which is a different question (who has the best record in the whole
   league?) and has no stored rank. It is ordered here, the same way
   recompute_standings orders the overall record: winning percentage, then wins,
   then the point difference, then points scored.

   Pure functions over the rows PostgREST returns, so they run the same in the
   browser and under node (supabase/tests/standings.test.mjs).
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStandings = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

function isConferences(comp) {
  return !!comp && comp.format === 'conferences';
}

/* The columns a table asks for. The conference columns exist only once 0144 is
   applied, and naming a column PostgREST does not know fails the whole read —
   so they are asked for only on a competition that is 'conferences', a format
   that cannot exist before 0144 does. Every other table asks for exactly what
   it always did. */
const BASE_COLS = 'rank,gp,w,l,pts_for,pts_against,diff,league_points,deducted_points,streak,group_name';
const CONF_COLS = 'division_name,conf_gp,conf_w,conf_l,conf_pts_for,conf_pts_against';

function columns(comp, teamCols) {
  const t = teamCols ? ',teams(' + teamCols + ')' : '';
  return (isConferences(comp) ? BASE_COLS + ',' + CONF_COLS : BASE_COLS) + t;
}

/* ".750", "1.000", ".000" — the way a college table prints a percentage. A
   club with no games has no percentage, not a percentage of nought. */
function pct(w, gp) {
  if (!gp) return '—';
  const p = w / gp;
  if (p >= 1) return '1.000';
  return p.toFixed(3).replace(/^0/, '');
}

function record(w, l) {
  return (w || 0) + '-' + (l || 0);
}

function byName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/* [{name, divisions: [{name, rows}]}] — conferences in name order, divisions in
   name order inside them, rows in their stored rank. A club with no group is
   filed under '' so it is shown rather than lost, and that group sorts last. */
function split(rows) {
  const groups = new Map();
  (rows || []).forEach(r => {
    const g = r.group_name || '';
    const d = r.division_name || '';
    if (!groups.has(g)) groups.set(g, new Map());
    const divs = groups.get(g);
    if (!divs.has(d)) divs.set(d, []);
    divs.get(d).push(r);
  });
  const rankOf = r => (r.rank == null ? Infinity : r.rank);
  return [...groups.keys()]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : byName(a, b)))
    .map(g => ({
      name: g,
      divisions: [...groups.get(g).keys()]
        .sort((a, b) => (a === '' ? -1 : b === '' ? 1 : byName(a, b)))
        .map(d => ({ name: d, rows: groups.get(g).get(d).slice().sort((x, y) => rankOf(x) - rankOf(y)) }))
    }));
}

/* The whole league on one table by the complete schedule, for a conference
   league's Overall view. Returns new row objects carrying `overall_rank`. */
function overall(rows) {
  const p = r => (r.gp ? r.w / r.gp : 0);
  const name = r => ((r.teams && r.teams.name) || '');
  const sorted = (rows || []).slice().sort((a, b) =>
    (p(b) - p(a)) || ((b.w || 0) - (a.w || 0)) || ((b.diff || 0) - (a.diff || 0)) ||
    ((b.pts_for || 0) - (a.pts_for || 0)) || byName(name(a), name(b)));
  let prev = null, rank = 0;
  return sorted.map((r, i) => {
    /* level on every key shares a place, as a printed table does */
    const key = [p(r), r.w, r.diff, r.pts_for].join('|');
    if (key !== prev) { rank = i + 1; prev = key; }
    return Object.assign({}, r, { overall_rank: rank });
  });
}

/* the heading a group gets: a conference is named as itself, a group of a
   single league is "Group X" as it always was */
function groupLabel(name, comp) {
  if (!name) return isConferences(comp) ? 'Unassigned' : '';
  return isConferences(comp) ? name : 'Group ' + name;
}

return { isConferences, columns, pct, record, split, overall, groupLabel, BASE_COLS, CONF_COLS };
}));
