'use strict';
/* ============================================================================
   MANAGER - THE SEASON (core: no site, no DOM, no database).

   ONE MANAGER LEAGUE, PLAYED ON THE REAL CALENDAR (Louie, 2026-10-09: "it's probably better to use an IRL schedule for
   now rather than a 'continue' mechanic"; "Just make it 1/2 games per week as a simple baseline"): the user's club and
   the real league's clubs play each other `meetings` times (three), a round on each of the week's match days (one a
   week: Saturday; two: Wednesday and Saturday), from the first match day after the squad is confirmed - by the reader's
   own browser, only this league (Louie: "it has to be processed only client-side with only that player's chosen league
   being simmed"). The same round played twice gives the same games (each game's seed is the league's seed, the round
   and the two clubs).
   ANY TIME ON ITS DAY (Louie, 2026-10-14: "can the user choose to play the game anytime on that day (i.e. scheduled for
   a wednesday, but the user can choose to play any time on that wednesday instead of being specifically at Xpm"): a
   match day is the reader's own day (its local midnight to midnight). On it the reader plays their game when they
   like - live (core/match.js, views/match.js), or straight to the result; the round's other games are played with it.
   A day over with the game not played, the assistant plays it (the whole round at once); a round without the reader's
   club is played when its day begins.
   ANY TIME IN ITS WEEK (Louie, 2026-10-15: "play the two weekly games whenever they want, but has to be within the week
   (otherwise auto simmed)"): the window is now the round's week, Monday to Sunday by the reader's clock - both of a
   week's games, in their order, whenever the reader likes; a week over with a game unplayed, the assistant plays it.

     create(o)            {clubs: ['me', ...], start: 'YYYY-MM-DD', perWeek, meetings, seed} -> a state
     due(S, now, me)      the rounds to play now, nobody choosing: their day over (or, without the reader's club, begun)
     matchday(S, now, me) the reader's game to play now (its week under way): {r, f, opens, closes} or null
     play(S, round, ctx)  play a round's games (ctx.skip(f): one left for the reader): ctx.team(i) -> the engine's team
     record(S, f, g, me)  a game's result into the season (play does it; a live game's end does it)
     table(S)             the standings;  leaders(S, k)  the league's leaders;  next(S, i)  a club's next game
   The state is plain JSON (it is what the database keeps): clubs by index, players by index in S.people, a game's
   result [hs, as, ot] on its fixture, every player's season totals in S.stats, the user's games' box scores in S.box.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.season = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const M = () => root.Mgr || {};
const ENG = () => (M().engine) || (typeof require === 'function' ? require('./engine.js') : null);
const SCH = () => (M().schedule) || (typeof require === 'function' ? require('./schedule.js') : null);
const V = 1;
const TIP_UTC = 19;                         // a round's games are played from 19:00 UTC on its day
const DAYS = { 1: [6], 2: [3, 6] };         // match days a week: Saturday; Wednesday and Saturday (0 = Sunday)
/* a player's season line in S.stats: the box score's counts, in this order */
const LINE = ['gp', 'min', 'pts', 'fgm', 'fga', 'p3m', 'p3a', 'ftm', 'fta', 'rimM', 'rimA', 'midM', 'midA', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf'];
const isNum = v => typeof v === 'number' && isFinite(v);
const ymd = d => d.toISOString().slice(0, 10);
const dayOf = s => new Date(s + 'T00:00:00Z');

/* the match days from the day after `start`: perWeek a week, n of them */
function matchDays(start, perWeek, n) {
  const days = DAYS[perWeek] || DAYS[2], out = [];
  const d = dayOf(start);
  d.setUTCDate(d.getUTCDate() + 1);
  while (out.length < n) {
    if (days.includes(d.getUTCDay())) out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function create(o) {
  const clubs = (o.clubs || []).map(String);
  if (clubs.length < 2) throw new Error('a league needs two clubs');
  const seed = o.seed != null ? o.seed >>> 0 : SCH().hashOf(clubs.join('|') + '|' + o.start);
  const meetings = Math.max(1, Math.min(4, o.meetings || 3)), perWeek = o.perWeek === 1 ? 1 : 2;
  const rr = SCH().roundRobin(clubs.map((_, i) => i), meetings, seed);
  const rounds = rr.reduce((a, f) => Math.max(a, f.round), 0);
  const dates = matchDays(o.start, perWeek, rounds);
  return {
    v: V, seed, start: o.start, perWeek, meetings, clubs, people: [], stats: {}, box: {}, pbp: {}, tstats: clubs.map(() => null),
    fixtures: rr.map(f => ({ r: f.round, d: dates[f.round - 1], h: f.home, a: f.away })), played: 0
  };
}
/* A MATCH DAY: the reader's own day (their browser's midnight to midnight) */
function dayStart(dateStr) { const [y, m, d] = String(dateStr).split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0); }
function dayEnd(dateStr) { const x = dayStart(dateStr); x.setDate(x.getDate() + 1); return x; }
/* ITS WEEK (Louie, 2026-10-15: "Can the user please have the option to play the two weekly games whenever they want, but
   has to be within the week (otherwise auto simmed)?"): the reader's week, Monday's midnight to the next Monday's, that a
   round's day falls in - the reader plays their game in it when they like, the week's games in their order */
function weekStart(dateStr) { const x = dayStart(dateStr); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekEnd(dateStr) { const x = weekStart(dateStr); x.setDate(x.getDate() + 7); return x; }
/* when a round is played with nobody choosing: its week over (the assistant plays the reader's game) */
function dueAt(dateStr) { return weekEnd(dateStr); }
const tOf = now => (now != null ? new Date(now) : new Date()).getTime();
const mineIn = (S, r, me) => S.fixtures.find(f => f.r === r && (f.h === me || f.a === me)) || null;
/* MAY THE SEASON STILL BE DRAWN AGAIN (a club of the real league added or dropped)? Only before its first match day: no
   result yet and the first day not begun. It was redrawn whenever nothing had been played, from the day it was
   redrawn, so a round whose time had come but which this browser had not played yet (the page opened after it)
   vanished from the season (reported 2026-10-14: a Saturday game skipped). Redrawn, it keeps its own start date. */
function redrawable(S, now) {
  if (!S || !Array.isArray(S.fixtures) || S.fixtures.some(f => f.res != null)) return false;
  const first = S.fixtures.reduce((a, f) => (a == null || f.d < a ? f.d : a), null);
  return first == null || tOf(now) < dayStart(first).getTime();
}
/* THE ROUNDS TO PLAY NOW, nobody choosing: any game unplayed in a round of the reader's whose week is over; a round
   without the reader's club (me; null: none) once its day has begun - never ahead of a round before it still waiting for
   the reader (the rounds are played in their order) */
function due(S, now, me) {
  const t = tOf(now), out = [], m = me == null ? 0 : me;
  const rounds = [...new Set(S.fixtures.filter(f => f.res == null).map(f => f.r))].sort((a, b) => a - b);
  for (const r of rounds) {
    const fs = roundOf(S, r), d = fs[0].d, mine = mineIn(S, r, m);
    if (mine ? weekEnd(d).getTime() <= t : dayStart(d).getTime() <= t) out.push(r);
    else break;
  }
  return out;
}
/* THE READER'S GAME TO PLAY: their first unplayed one, while its week is under way */
function matchday(S, now, me) {
  const t = tOf(now), m = me == null ? 0 : me;
  const f = S.fixtures.filter(x => x.res == null && (x.h === m || x.a === m)).sort((a, b) => a.r - b.r)[0];
  if (!f) return null;
  const opens = weekStart(f.d).getTime(), closes = weekEnd(f.d).getTime();
  return opens <= t && t < closes ? { r: f.r, f, opens, closes } : null;
}
function roundOf(S, r) { return S.fixtures.filter(f => f.r === r); }
/* a person's index in S.people (the state keeps ids once) */
function pid(S, id) {
  let i = S.people.indexOf(String(id));
  if (i < 0) { S.people.push(String(id)); i = S.people.length - 1; }
  return i;
}
function addLine(into, b) {
  const L = into || LINE.map(() => 0);
  L[0] += b.min > 0 ? 1 : 0;
  for (let k = 1; k < LINE.length; k++) L[k] += +(b[LINE[k]] || 0);
  L[1] = Math.round(L[1] * 10) / 10;
  return L;
}
/* PLAY A ROUND. ctx: {X: {L, ref, G}, team(i) -> {id, segs, cards, identity?, form?, ins?}, me: the user's club index,
   skip(f): a game left out (the reader's, to be played live), engine: 'stretch' for engine.play (the possession engine,
   core/match.js, otherwise - the one the live game plays)} */
const MATCH = () => (M().match) || (typeof require === 'function' ? require('./match.js') : null);
function playOne(E, H, A, X, seed, how) {
  const MT = how === 'stretch' ? null : MATCH();
  return MT ? MT.play(H, A, X, { seed, home: 1 }) : E.play(H, A, Object.assign({}, X, { seed, home: 1 }));
}
function gameSeed(S, r, f) { return SCH().hashOf(S.seed + ':' + r + ':' + f.h + ':' + f.a); }
function play(S, r, ctx) {
  const E = ENG(), out = [];
  roundOf(S, r).forEach(f => {
    if (f.res != null) return;
    if (ctx.skip && ctx.skip(f)) return;
    /* EVERY GAME OF A ROUND ON ITS OWN (2026-10-14: "make sure all games on the fixture list today can be played"): a club
       that cannot be put together, or a game the engine stops on, leaves that one game to the next visit and never the
       round's others */
    let H, A, g;
    try {
      H = ctx.team(f.h); A = ctx.team(f.a);
      if (!H || !A || !H.segs || !H.segs.length || !A.segs || !A.segs.length) { f.res = null; out.push({ f, error: 'no team' }); return; }
      g = playOne(E, H, A, ctx.X, gameSeed(S, r, f), ctx.engine);
    } catch (e) { f.res = null; out.push({ f, error: String(e && e.message || e) }); return; }
    record(S, f, g, ctx.me);
    out.push({ f, g });
  });
  S.played = S.fixtures.filter(f => f.res != null).reduce((a, f) => Math.max(a, f.r), 0);
  return out;
}
/* A GAME'S RESULT INTO THE SEASON: its score on its fixture, every man's line into his season, the clubs' totals with the
   opponents' side, and the reader's games kept whole (the box with plus-minus, the play-by-play, the lineups) */
function record(S, f, g, me) {
  const r = f.r;
  {
    f.res = [g.pts[0], g.pts[1], g.ot || 0];
    /* every man's line into his season; the clubs' totals; the user's games kept whole */
    [0, 1].forEach(s => {
      const club = s ? f.a : f.h;
      g.box[s].forEach(b => { const i = pid(S, b.id); S.stats[i] = addLine(S.stats[i], b); });
      const T = S.tstats[club] || { gp: 0, pts: 0, opp: 0, poss: 0, fga: 0, fgm: 0, p3a: 0, p3m: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, tov: 0, ast: 0, stl: 0, blk: 0 };
      const t = g.tally[s], o = g.tally[1 - s];
      T.gp++; T.pts += g.pts[s]; T.opp += g.pts[1 - s]; T.poss += g.poss[s];
      T.fga += t.fga; T.fgm += t.fgm; T.p3a += t.fg3a; T.p3m += t.fg3m; T.fta += t.fta; T.ftm += t.ftm; T.oreb += t.oreb; T.dreb += t.dreb; T.tov += t.tov;
      T.ast += g.box[s].reduce((a, b) => a + b.ast, 0); T.stl += o.to_live; T.blk += g.box[s].reduce((a, b) => a + b.blk, 0);
      /* the opponents' side of it, for a man's rates (his share of the boards there were, of the possessions he defended) */
      T.ofga = (T.ofga || 0) + o.fga; T.ofg3a = (T.ofg3a || 0) + o.fg3a; T.ofgm = (T.ofgm || 0) + o.fgm; T.ofg3m = (T.ofg3m || 0) + o.fg3m; T.ofta = (T.ofta || 0) + o.fta;
      T.ooreb = (T.ooreb || 0) + o.oreb; T.odreb = (T.odreb || 0) + o.dreb; T.otov = (T.otov || 0) + o.tov; T.oposs = (T.oposs || 0) + g.poss[1 - s];
      S.tstats[club] = T;
    });
    /* the user's games kept whole: the box (with plus-minus, last), the play-by-play and the lineups on the clock */
    if (me != null && (f.h === me || f.a === me)) {
      S.box[r] = [0, 1].map(s => g.box[s].map(b => [pid(S, b.id)].concat(LINE.slice(1).map(k => (k === 'min' ? b.min : +(b[k] || 0))), [+(b.pm || 0)])));
      if (g.events) {
        S.pbp = S.pbp || {};
        S.pbp[r] = { e: encodeEvents(S, g.events), l: (g.lineups || []).map(x => [Math.round(x.t0 * 100) / 100, Math.round(x.t1 * 100) / 100, x.h.map(id => pid(S, id)), x.a.map(id => pid(S, id))]) };
      }
    }
  }
  S.played = S.fixtures.filter(x => x.res != null).reduce((a, x) => Math.max(a, x.r), 0);
  return f;
}
/* THE PLAY-BY-PLAY, KEPT SMALL: an event a token - its second (base 36), its kind, then its numbers, a man by his place
   in S.people - about four kilobytes a game */
/* (core/match.js, 2026-10-14, added at the end so the games kept before read as they did: U a substitution - out, in;
   Y a timeout; q a quarter's start after the first; a turnover's `of`, an offensive foul) */
const EVK = ['Q', 'P', 'S', 'F', 'T', 'O', 'D', 'X', 'f', 'U', 'Y', 'q'];
const FIELDS = { Q: ['p'], P: ['s', 'st', 'f', 'l'], S: ['s', 'z', 'm', 'tr', '@p', '@a', '@b'], F: ['s', 'kind', 'n', 'm', '@p', '@f'], T: ['s', 'live', '@p', '@st', 'of'],
  O: ['s', '@p'], D: ['s', '@p'], X: ['s'], f: ['s', '@p'], U: ['s', '@out', '@in'], Y: ['s'], q: ['p'] };
function encodeEvents(S, events) {
  return events.filter(e => EVK.includes(e.k)).map(e => {
    const f = FIELDS[e.k] || [];
    return [Math.max(0, Math.round(e.t || 0)).toString(36), EVK.indexOf(e.k)].concat(f.map(k => {
      if (k[0] === '@') { const id = e[k.slice(1)]; return id == null ? '' : pid(S, id).toString(36); }
      const v = e[k]; return v == null ? '' : (+v).toString(36);
    })).join(',');
  }).join(';');
}
function decodeEvents(S, str) {
  if (!str) return [];
  return str.split(';').map(tok => {
    const x = tok.split(','), k = EVK[+x[1]], e = { k, t: parseInt(x[0], 36) };
    (FIELDS[k] || []).forEach((f, i) => {
      const v = x[i + 2];
      if (f[0] === '@') e[f.slice(1)] = v === '' || v == null ? null : S.people[parseInt(v, 36)];
      else e[f] = v === '' || v == null ? null : parseInt(v, 36);
    });
    return e;
  });
}

/* THE STANDINGS: schedule.table on the played games (the clubs by index) */
function table(S) {
  const T = SCH().table(S.fixtures.filter(f => f.res != null).map(f => ({ round: f.r, home: f.h, away: f.a, hs: f.res[0], as: f.res[1] })), S.clubs.map((_, i) => i));
  return T;
}
/* a club's next unplayed game, and its played ones (newest first) */
function next(S, i) { return S.fixtures.filter(f => f.res == null && (f.h === i || f.a === i)).sort((a, b) => a.r - b.r)[0] || null; }
function results(S, i) { return S.fixtures.filter(f => f.res != null && (f.h === i || f.a === i)).sort((a, b) => b.r - a.r); }
/* a player's season line as an object (per game and totals) */
function lineOf(S, id) {
  const i = S.people.indexOf(String(id)), L = i >= 0 ? S.stats[i] : null;
  if (!L) return null;
  const o = {};
  LINE.forEach((k, j) => { o[k] = L[j]; });
  return o;
}
/* the league's leaders at a counting stat a game (players with half the most games played) */
function leaders(S, k, n) {
  const j = LINE.indexOf(k), top = Object.values(S.stats).reduce((a, L) => Math.max(a, L[0]), 0);
  return Object.entries(S.stats).filter(([, L]) => L[0] >= Math.max(1, top / 2)).map(([i, L]) => ({ id: S.people[+i], gp: L[0], v: L[j] / Math.max(1, L[0]) }))
    .sort((a, b) => b.v - a.v).slice(0, n || 10);
}
/* the summary a leaderboard keeps: wins, losses, points for and against, the table position */
function summary(S, me) {
  const T = table(S), row = T.rows.find(x => x.id === me) || null;
  return row ? { w: row.w, l: row.l, pf: row.pf, pa: row.pa, pos: row.pos, gp: row.gp, of: S.clubs.length, rounds: S.fixtures.reduce((a, f) => Math.max(a, f.r), 0), played: S.played }
    : { w: 0, l: 0, pf: 0, pa: 0, pos: null, gp: 0, of: S.clubs.length, rounds: S.fixtures.reduce((a, f) => Math.max(a, f.r), 0), played: S.played };
}

return { create, due, dueAt, dayStart, dayEnd, weekStart, weekEnd, matchday, redrawable, play, record, gameSeed, table, next, results, lineOf, leaders, summary, matchDays, roundOf, encodeEvents, decodeEvents, LINE, TIP_UTC, DAYS, V };
}));
