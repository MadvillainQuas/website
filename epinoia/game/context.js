'use strict';
/* ============================================================================
   THE GAME IN ITS SEASON — what a finished game MEANT, worked out from what the season already holds.

   story.js mines one game's event log, which knows everything about forty minutes and nothing about the
   weeks around them. A reader of a match report wants both: "they won 88-80" is the game; "a fifth straight
   win, and it takes them top" is why anybody should care. This file is the second half. It is pure (node
   tests it, and the league narrative builder runs it), and it reads only what the page has already fetched:

     games     the season's finished games [{ id, home_team_id, away_team_id, home_score, away_score, tipoff_at,
               attendance?, competition_id? }] (data.js statsForGames hands them back)
     pgs       the per-game player rows [{ game_id, player_uuid|player_id, team_idx, stats: { pts, min, or, dr, ast,
               stl, blk, p3m, ... } }], when the page kept them
     tgs       the per-game team rows [{ game_id, team_idx, stats: { adv: { fgm, fga, fg3m, fta, tov, oreb, dreb } } }]
     table     tablepos.js's { comp, rows } (the standings after this game, as the league page shows them)
     fixtures  the clubs' games still to come [{ id, home_team_id, away_team_id, tipoff_at }]
     tally     the fans' picks for this game { home, away } (predict.js, prediction_tally)
     records   records.js's { player: [...], team: [...] } (records_board: the season's single-game bests)
     bios      { [player id]: { age, height_cm } } where the register has them (player_bio)
     model     the league's What Wins weights (winmodel.js explainOf: b, home)

   NOTHING IS GUESSED. Every field is null when what it needs is not there, and story.js then says nothing about
   it. A claim that needs an order (a streak, a season high, "before this game") is worked out from games that
   tipped off BEFORE this one, so a re-read the next morning, with later games on the page, says the same thing.

     EpinoiaContext.build({ gameId, tipoff, home, away, score, games, pgs, tgs, table, fixtures, tally, records,
                            bios, model, competitionId }) -> ctx (game.js puts it on S.ctx; gamefacts.js on the brief)
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaContext = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const num = v => (v == null || v === '' || isNaN(v) ? null : +v);
const DAY = 86400000;
const time = t => { const x = Date.parse(t); return isFinite(x) ? x : null; };
const pidOf = r => r && (r.player_uuid || r.player_id) || null;

/* ------------------------------------------------------------------ results --- */
/* a finished game from one club's side: won, its score, the other's, the opponent */
function sideOf(g, id) {
  if (!g || g.home_score == null || g.away_score == null) return null;
  const home = g.home_team_id === id;
  if (!home && g.away_team_id !== id) return null;
  const f = +(home ? g.home_score : g.away_score), a = +(home ? g.away_score : g.home_score);
  return { id: g.id, at: time(g.tipoff_at), home, for: f, against: a, won: f > a, tied: f === a,
           opp: home ? g.away_team_id : g.home_team_id, attendance: num(g.attendance) };
}

/* the run a list of results ends on, newest last: { won, n } */
function streakOf(list) {
  const xs = list.filter(x => !x.tied);
  if (!xs.length) return null;
  const last = xs[xs.length - 1];
  let n = 0;
  for (let i = xs.length - 1; i >= 0 && xs[i].won === last.won; i--) n++;
  return { won: last.won, n };
}

/* one club's season up to (and not including) the game, and with it */
function clubLine(games, id, me, at) {
  const mine = games.map(g => sideOf(g, id)).filter(Boolean).filter(x => x.id !== me.id && x.at != null && at != null && x.at < at)
    .sort((a, b) => a.at - b.at);
  const w = mine.filter(x => x.won).length, l = mine.filter(x => !x.won && !x.tied).length;
  const after = mine.concat([me]);
  const prev = mine.length ? mine[mine.length - 1] : null;
  const homeGames = mine.filter(x => x.home);
  return {
    id,
    before: { gp: mine.length, w, l, streak: streakOf(mine), last5: mine.slice(-5).map(x => (x.won ? 'W' : 'L')).join(''),
              ppg: mine.length ? mine.reduce((s, x) => s + x.for, 0) / mine.length : null,
              papg: mine.length ? mine.reduce((s, x) => s + x.against, 0) / mine.length : null,
              homeW: homeGames.filter(x => x.won).length, homeL: homeGames.filter(x => !x.won && !x.tied).length,
              highFor: mine.length ? Math.max(...mine.map(x => x.for)) : null,
              lowAgainst: mine.length ? Math.min(...mine.map(x => x.against)) : null,
              bestCrowd: mine.filter(x => x.home && x.attendance > 0).reduce((m, x) => Math.max(m, x.attendance), 0) || null,
              homeCrowds: mine.filter(x => x.home && x.attendance > 0).length },
    after: { gp: after.length, w: w + (me.won ? 1 : 0), l: l + (!me.won && !me.tied ? 1 : 0), streak: streakOf(after) },
    /* the days since this club last played: under a day and a half is a back-to-back */
    rest: prev && at != null ? (at - prev.at) / DAY : null,
    results: mine
  };
}

/* ------------------------------------------------------------------- table --- */
/* the order a table is read in (tablepos.js / standings.js byWinPct): winning percentage, then the stored rank */
function ordered(rows) {
  const n = (v, d) => (v == null || v === '' || isNaN(v) ? d : +v);
  return rows.slice().sort((a, b) => {
    const ga = n(a.gp, 0), gb = n(b.gp, 0);
    if (!ga !== !gb) return ga ? -1 : 1;
    if (ga && gb) { const d = n(b.w, 0) * ga - n(a.w, 0) * gb; if (d) return d; }
    return n(a.rank, 1e9) - n(b.rank, 1e9);
  }).map((r, i) => Object.assign({}, r, { pos: i + 1 }));
}
const gb = (a, b) => ((a.w - b.w) + (b.l - a.l)) / 2;

/* where each club stands after the game, and where it stood before it: the rows as the league page has them, with
   this game's result taken back off the two clubs to find the order before (only for a game IN that table) */
function standing(table, ids, result, inTable) {
  if (!table || !Array.isArray(table.rows) || !table.rows.length) return null;
  const rows = table.rows.filter(r => r && r.team_id);
  const group = id => { const r = rows.find(x => x.team_id === id); return r ? (r.group_name || '') : null; };
  const out = ids.map((id, t) => {
    const g = group(id);
    if (g == null) return null;
    const mine = rows.filter(r => (r.group_name || '') === g);
    if (!mine.some(r => (r.gp || 0) > 0)) return null;
    const now = ordered(mine);
    const me = now.find(r => r.team_id === id);
    const top = now[0];
    const res = { group: g || null, of: now.length, rank: me.pos, w: num(me.w), l: num(me.l), gp: num(me.gp),
                  leader: top.team_id === id, gbTop: top.team_id === id ? 0 : gb(top, me),
                  next: now[me.pos] ? { id: now[me.pos].team_id, gb: gb(me, now[me.pos]) } : null,
                  above: me.pos > 1 ? { id: now[me.pos - 2].team_id, gb: gb(now[me.pos - 2], me) } : null,
                  before: null };
    if (inTable && result) {
      /* the same rows with this game taken back off both clubs */
      const back = mine.map(r => {
        const s = ids.indexOf(r.team_id);
        if (s < 0) return r;
        const won = result[s] > result[1 - s];
        return Object.assign({}, r, { gp: (r.gp || 0) - 1, w: (r.w || 0) - (won ? 1 : 0), l: (r.l || 0) - (won ? 0 : 1) });
      });
      if (back.every(r => (r.gp || 0) >= 0 && (r.w || 0) >= 0 && (r.l || 0) >= 0)) {
        const was = ordered(back).find(r => r.team_id === id);
        const top0 = ordered(back)[0];
        res.before = { rank: was && back.some(r => (r.gp || 0) > 0) ? was.pos : null, leader: !!(was && top0 && top0.team_id === id && (was.gp || 0) > 0) };
      }
    }
    return res;
  });
  return out;
}

/* ------------------------------------------------------------- the players --- */
/* each player's season before this game, from the per-game rows, and his line in it */
function playerLines(pgs, games, me, at) {
  if (!Array.isArray(pgs) || !pgs.length) return null;
  const when = new Map((games || []).map(g => [g.id, time(g.tipoff_at)]));
  const by = new Map();
  pgs.forEach(r => {
    const id = pidOf(r), s = r && r.stats;
    if (!id || !s) return;
    const t = when.get(r.game_id);
    if (r.game_id !== me && (t == null || at == null || t >= at)) return;     // a later game (or one not in the list) says nothing about this one
    if (!by.has(id)) by.set(id, []);
    by.get(id).push({ game: r.game_id, at: t, side: r.team_idx, pts: num(s.pts) || 0, min: num(s.min) || 0,
      reb: (num(s.or) || 0) + (num(s.dr) || 0), ast: num(s.ast) || 0, stl: num(s.stl) || 0, blk: num(s.blk) || 0, p3m: num(s.p3m) || 0 });
  });
  const out = {};
  by.forEach((rows, id) => {
    const before = rows.filter(x => x.game !== me && x.min > 0).sort((a, b) => a.at - b.at);
    const now = rows.find(x => x.game === me) || null;
    const hi = k => (before.length ? Math.max(...before.map(x => x[k])) : null);
    /* how many of his side's games in a row he has gone 20 and more, counting this one */
    let run20 = 0;
    if (now && now.pts >= 20) { run20 = 1; for (let i = before.length - 1; i >= 0 && before[i].pts >= 20; i--) run20++; }
    let runD = 0;                                           // double figures in a row, this one counted
    if (now && now.pts >= 10) { runD = 1; for (let i = before.length - 1; i >= 0 && before[i].pts >= 10; i--) runD++; }
    const tot = before.reduce((s, x) => s + x.pts, 0);
    out[id] = { gp: before.length, ppg: before.length ? tot / before.length : null,
                rpg: before.length ? before.reduce((s, x) => s + x.reb, 0) / before.length : null,
                apg: before.length ? before.reduce((s, x) => s + x.ast, 0) / before.length : null,
                high: { pts: hi('pts'), reb: hi('reb'), ast: hi('ast'), p3m: hi('p3m'), stl: hi('stl'), blk: hi('blk') },
                last3: before.slice(-3).map(x => x.pts), run20, runD, totalBefore: tot,
                lastAt: before.length ? before[before.length - 1].at : null };
  });
  return out;
}

/* a player who had been missing: his side played N games without him before this one (and he had played earlier) */
function returns(pgs, games, me, at, sides, ids) {
  if (!Array.isArray(pgs) || !pgs.length) return {};
  const when = new Map((games || []).map(g => [g.id, time(g.tipoff_at)]));
  const out = {};
  [0, 1].forEach(t => {
    const id = ids[t];
    const teamGames = (games || []).filter(g => (g.home_team_id === id || g.away_team_id === id) && g.id !== me &&
      when.get(g.id) != null && at != null && when.get(g.id) < at).sort((a, b) => when.get(a.id) - when.get(b.id));
    if (teamGames.length < 3) return;
    const played = new Map(), mins = new Map();
    pgs.forEach(r => {
      if (!r || !r.stats || !(num(r.stats.min) > 0)) return;
      const g = teamGames.find(x => x.id === r.game_id);
      if (!g) return;
      const side = g.home_team_id === id ? 0 : 1;
      if (r.team_idx !== side) return;
      const p = pidOf(r);
      if (!played.has(p)) played.set(p, new Set());
      played.get(p).add(r.game_id);
      mins.set(p, (mins.get(p) || 0) + num(r.stats.min));
    });
    /* missed the last two or more of his side's games, having been a rotation player (15 minutes a game) when he played */
    (sides[t] || []).forEach(p => {
      const set = played.get(p);
      if (!set || !set.size) return;
      let missed = 0;
      for (let i = teamGames.length - 1; i >= 0 && !set.has(teamGames[i].id); i--) missed++;
      if (missed >= 2 && (mins.get(p) || 0) / set.size >= 15 * 60000) out[p] = { missed, played: set.size };
    });
  });
  return out;
}

/* ---------------------------------------------------------- the expectation --- */
/* WHAT THE SEASON SAID BEFORE THE TIP (docs/what-wins-model.md §7.8): each club's four factors at both ends from its
   earlier games, blended the way the model blends them (a proportion's logit: offence + the other side's defence - the
   league), and weighed by the league's own coefficients. The model's own forecast also reads Elo and the schedule; this
   is its four-factor half, and it is said as "what the season's numbers said", never as a probability. */
const logit = p => Math.log(p / (1 - p));
const expit = x => 1 / (1 + Math.exp(-x));
const clampP = p => Math.min(0.97, Math.max(0.03, p));
function profiles(tgs, games, me, at) {
  if (!Array.isArray(tgs) || !tgs.length) return null;
  const when = new Map((games || []).map(g => [g.id, g]));
  const sum = new Map();
  const blank = () => ({ n: 0, o: { fgm: 0, fga: 0, fg3m: 0, fta: 0, tov: 0, oreb: 0, dreb: 0 }, d: { fgm: 0, fga: 0, fg3m: 0, fta: 0, tov: 0, oreb: 0, dreb: 0 } });
  const byGame = new Map();
  tgs.forEach(r => { if (!byGame.has(r.game_id)) byGame.set(r.game_id, {}); byGame.get(r.game_id)[r.team_idx] = r; });
  const line = st => { const a = (st && st.adv) || {}; return { fgm: num(a.fgm), fga: num(a.fga), fg3m: num(a.fg3m), fta: num(a.fta),
    tov: num(a.tov != null ? a.tov : st && st.toTot), oreb: num(a.oreb), dreb: num(a.dreb) }; };
  byGame.forEach((pair, gid) => {
    const g = when.get(gid);
    if (!g || gid === me || !pair[0] || !pair[1]) return;
    const t = time(g.tipoff_at);
    if (t == null || at == null || t >= at) return;
    [0, 1].forEach(s => {
      const id = s === 0 ? g.home_team_id : g.away_team_id;
      const mine = line(pair[s].stats), theirs = line(pair[1 - s].stats);
      if ([mine.fga, mine.fta, mine.tov, mine.oreb, mine.dreb, theirs.fga, theirs.oreb, theirs.dreb].some(v => v == null)) return;
      if (!sum.has(id)) sum.set(id, blank());
      const A = sum.get(id);
      A.n++;
      Object.keys(A.o).forEach(k => { A.o[k] += mine[k] || 0; A.d[k] += theirs[k] || 0; });
      /* the offensive rebound rate needs the other side's defensive boards, and the defence's needs our own */
      A.o.oppDreb = (A.o.oppDreb || 0) + (theirs.dreb || 0);
      A.d.oppDreb = (A.d.oppDreb || 0) + (mine.dreb || 0);
    });
  });
  const rates = x => ({
    efg: x.fga ? (x.fgm + 0.5 * x.fg3m) / x.fga : null,
    tovp: (x.fga + 0.44 * x.fta + x.tov) ? x.tov / (x.fga + 0.44 * x.fta + x.tov) : null,
    orebp: (x.oreb + (x.oppDreb || 0)) ? x.oreb / (x.oreb + (x.oppDreb || 0)) : null,
    ftr: x.fga ? x.fta / x.fga : null
  });
  const out = new Map();
  const lg = { o: { fgm: 0, fga: 0, fg3m: 0, fta: 0, tov: 0, oreb: 0, dreb: 0, oppDreb: 0 } };
  sum.forEach((A, id) => {
    out.set(id, { n: A.n, off: rates(A.o), def: rates(A.d) });
    Object.keys(lg.o).forEach(k => { lg.o[k] += A.o[k] || 0; });
  });
  return { teams: out, league: rates(lg.o) };
}
function expectation(P, ids, model, home) {
  if (!P) return null;
  const A = P.teams.get(ids[0]), B = P.teams.get(ids[1]), mu = P.league;
  if (!A || !B || A.n < 3 || B.n < 3) return null;
  const parts = {};
  let total = 0;
  const W = model && model.b ? model.b : null;
  for (const k of ['efg', 'tovp', 'orebp', 'ftr']) {
    const ao = A.off[k], bd = B.def[k], bo = B.off[k], ad = A.def[k], m = mu[k];
    if ([ao, bd, bo, ad, m].some(v => v == null || !isFinite(v))) return null;
    /* shrunk toward the league by a few games' worth, as the model's profiles are */
    const sh = (v, n) => (n * v + 4 * m) / (n + 4);
    const xa = expit(logit(clampP(sh(ao, A.n))) + logit(clampP(sh(bd, B.n))) - logit(clampP(m)));
    const xb = expit(logit(clampP(sh(bo, B.n))) + logit(clampP(sh(ad, A.n))) - logit(clampP(m)));
    const d = 100 * (xa - xb);                                         // percentage points, home minus away
    /* without the league's weights, the fixed points-per-100 weights of story.js PA_W over a typical game's 72 possessions */
    const FIX = { efg: 2.0, tovp: -1.4, orebp: 0.7, ftr: 0.4 };
    const b = W && num(W[k]) != null ? +W[k] : FIX[k] * 0.72;
    parts[k] = { home: 100 * xa, away: 100 * xb, pts: b * d };
    total += b * d;
  }
  const alpha = model && num(model.home) != null ? +model.home : null;
  if (home !== false && alpha != null) total += alpha;
  return { margin: total, parts, model: !!W, alpha: home !== false ? alpha : null, n: [A.n, B.n] };
}

/* ------------------------------------------------------------------ build --- */
function build(o) {
  const x = o || {};
  const ids = [x.home || null, x.away || null];
  if (!ids[0] || !ids[1]) return null;
  const games = (Array.isArray(x.games) ? x.games : []).filter(g => g && g.home_score != null && g.away_score != null);
  const at = time(x.tipoff);
  const score = Array.isArray(x.score) ? x.score.map(Number) : null;
  if (!score || !isFinite(score[0]) || !isFinite(score[1])) return null;
  const me = id => { const home = id === ids[0]; const f = home ? score[0] : score[1], a = home ? score[1] : score[0];
    return { id: x.gameId, at, home, for: f, against: a, won: f > a, tied: f === a, opp: home ? ids[1] : ids[0] }; };

  const sides = ids.map(id => clubLine(games, id, me(id), at));
  /* the meetings before this one, this season */
  const meetings = games.filter(g => g.id !== x.gameId && time(g.tipoff_at) != null && at != null && time(g.tipoff_at) < at &&
    ((g.home_team_id === ids[0] && g.away_team_id === ids[1]) || (g.home_team_id === ids[1] && g.away_team_id === ids[0])))
    .sort((a, b) => time(a.tipoff_at) - time(b.tipoff_at))
    .map(g => { const s = sideOf(g, ids[0]); return { id: g.id, at: s.at, score: [s.for, s.against], won: s.won ? 0 : s.tied ? null : 1, home0: s.home }; });
  const h2h = meetings.length ? { meetings, wins: [meetings.filter(m => m.won === 0).length, meetings.filter(m => m.won === 1).length],
    last: meetings[meetings.length - 1] } : null;

  /* the next game each club has */
  const next = ids.map(id => {
    const list = (x.fixtures || []).filter(g => g && (g.home_team_id === id || g.away_team_id === id) && g.id !== x.gameId &&
      time(g.tipoff_at) != null && (at == null || time(g.tipoff_at) > at)).sort((a, b) => time(a.tipoff_at) - time(b.tipoff_at));
    const g = list[0];
    return g ? { id: g.id, at: g.tipoff_at, home: g.home_team_id === id, opp: g.home_team_id === id ? g.away_team_id : g.home_team_id,
                 rematch: (g.home_team_id === ids[0] || g.away_team_id === ids[0]) && (g.home_team_id === ids[1] || g.away_team_id === ids[1]) } : null;
  });

  const inTable = !!(x.table && x.table.comp && x.competitionId && x.table.comp.id === x.competitionId);
  const table = standing(x.table, ids, score, inTable);

  const players = playerLines(x.pgs, games, x.gameId, at);
  /* who played in this game, per side: the caller's, else this game's own rows */
  const roster = x.roster || [0, 1].map(t => (Array.isArray(x.pgs) ? x.pgs : [])
    .filter(r => r && r.game_id === x.gameId && r.team_idx === t && r.stats && num(r.stats.min) > 0).map(pidOf).filter(Boolean));
  const back = returns(x.pgs, games, x.gameId, at, roster, ids);

  /* the league's single-game bests, where THIS game set or matched one (records_board answers after the game) */
  const recs = { player: [], team: [] };
  /* records.js's load() shape ({ cat: { k }, meta, holder }) or the board itself as records_board answers it
     ({ cat: 'pts', name, pid }): the game page reads the board without loading records.js */
  const R = x.records;
  const catOf = r => (r && r.cat && typeof r.cat === 'object' ? r.cat.k : r && r.cat) || null;
  if (R) {
    (R.player || []).forEach(r => { if (r && r.game && r.game.id === x.gameId && catOf(r)) recs.player.push({ k: catOf(r), v: num(r.v), shared: num(r.shared) || 1, name: (r.meta && r.meta.name) || r.name || null, side: r.side, pid: r.pid || (r.holder && r.holder.pid) || null }); });
    (R.team || []).forEach(r => { if (r && r.game && r.game.id === x.gameId && catOf(r)) recs.team.push({ k: catOf(r), v: num(r.v), shared: num(r.shared) || 1, side: r.side }); });
  }

  const tally = x.tally && (num(x.tally.home) || 0) + (num(x.tally.away) || 0) > 0
    ? { home: num(x.tally.home) || 0, away: num(x.tally.away) || 0, n: (num(x.tally.home) || 0) + (num(x.tally.away) || 0) } : null;

  const P = profiles(x.tgs, games, x.gameId, at);
  const expect = expectation(P, ids, x.model || null, x.neutral ? false : true);

  /* names for the clubs this file mentions that are not the two playing: the next opponents */
  const nameOf = id => {
    const N = x.teamNames;
    if (!N || !id) return null;
    const v = N instanceof Map ? N.get(id) : N[id];
    return v ? String(v.name || v) : null;
  };
  next.forEach(n => { if (n) n.oppName = nameOf(n.opp); });

  return { v: 1, ids, sides, h2h, next, table, players, back, records: recs, tally, expect, rates: x.rates || rates(x.tgs, x.gameId),
           bios: x.bios || null, crowd: num(x.attendance), inTable };
}

/* the same rates from a season's team lines (season.js finishTeam: totals, and the zones as attempts a game and a
   percentage), for a caller that has the season file rather than every game's team line */
function ratesFromTeams(teams) {
  if (!Array.isArray(teams) || !teams.length) return null;
  const s = { rimA: 0, rimM: 0, midA: 0, midM: 0, fga: 0, fgm: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, gp: 0 };
  teams.forEach(t => {
    const gp = num(t.gp) || 0;
    if (!gp) return;
    s.gp += gp;
    s.fga += num(t.fga) || 0; s.fgm += num(t.fgm) || 0; s.fg3a += num(t.p3a) || 0; s.fg3m += num(t.p3m) || 0;
    s.fta += num(t.fta) || 0; s.ftm += num(t.ftm) || 0;
    const ra = (num(t.rim_apg) || 0) * gp, ma = (num(t.mid_apg) || 0) * gp;
    s.rimA += ra; s.rimM += ra * (num(t.rim_pct) || 0) / 100; s.midA += ma; s.midM += ma * (num(t.mid_pct) || 0) / 100;
  });
  if (s.gp < 40 || !s.fga || !s.fg3a) return null;               // twenty games' worth of team lines
  const twoA = s.fga - s.fg3a;
  return { rim: s.rimA >= 200 ? s.rimM / s.rimA : null, mid: s.midA >= 200 ? s.midM / s.midA : null,
           two: twoA > 0 ? (s.fgm - s.fg3m) / twoA : null, three: s.fg3m / s.fg3a, ft: s.fta ? s.ftm / s.fta : null,
           efg: (s.fgm + 0.5 * s.fg3m) / s.fga, games: Math.round(s.gp / 2) };
}

/* ============================================================================
   BEFORE A GAME: the same season, read for a fixture (game/preview.js). Each club's record, form and run, the days of
   rest, the meetings so far, where both stand, what the season's four factors expect (the league's model weighing them),
   and each player's season and last five, with a milestone in reach.

     EpinoiaContext.preview({ home, away, tipoff, games, pgs, tgs, table, model, competitionId, neutral })
   ============================================================================ */
function preview(o) {
  const x = o || {};
  const ids = [x.home || null, x.away || null];
  if (!ids[0] || !ids[1]) return null;
  const at = time(x.tipoff) || Date.now();
  const games = (Array.isArray(x.games) ? x.games : []).filter(g => g && g.home_score != null && g.away_score != null && time(g.tipoff_at) != null && time(g.tipoff_at) < at);
  /* a club's season so far, with a dummy "this game" that clubLine never counts */
  const sides = ids.map(id => {
    const L = clubLine(games, id, { id: '__next', at, home: id === ids[0], for: 0, against: 0, won: false, tied: true }, at);
    return { id, gp: L.before.gp, w: L.before.w, l: L.before.l, streak: L.before.streak, last5: L.before.last5,
             ppg: L.before.ppg, papg: L.before.papg, home: { w: L.before.homeW, l: L.before.homeL }, rest: L.rest,
             lastAt: L.results.length ? L.results[L.results.length - 1].at : null };
  });
  const meetings = games.filter(g => (g.home_team_id === ids[0] && g.away_team_id === ids[1]) || (g.home_team_id === ids[1] && g.away_team_id === ids[0]))
    .sort((a, b) => time(a.tipoff_at) - time(b.tipoff_at))
    .map(g => { const s = sideOf(g, ids[0]); return { id: g.id, at: s.at, score: [s.for, s.against], won: s.won ? 0 : s.tied ? null : 1 }; });
  const table = standing(x.table, ids, null, false);
  const P = profiles(x.tgs, games, '__next', at + 1);
  const expect = expectation(P, ids, x.model || null, x.neutral ? false : true);
  /* the players: each one's season and last five before the game, from the per-game rows */
  const PL = playerLines(x.pgs, games, '__next', at) || {};
  const sideOfPlayer = {};
  (Array.isArray(x.pgs) ? x.pgs : []).forEach(r => {
    const g = games.find(y => y.id === r.game_id);
    if (!g || !r) return;
    const team = r.team_idx === 0 ? g.home_team_id : g.away_team_id;
    const pid = pidOf(r);
    if (pid) sideOfPlayer[pid] = team;               // the last game read wins: where he plays now
  });
  const players = [[], []];
  Object.keys(PL).forEach(pid => {
    const t = ids.indexOf(sideOfPlayer[pid]);
    if (t < 0) return;
    const p = PL[pid];
    if (!p.gp) return;
    players[t].push({ id: pid, gp: p.gp, ppg: p.ppg, rpg: p.rpg, apg: p.apg, last3: p.last3, high: p.high.pts, total: p.totalBefore,
      run20: (() => { let n = 0; const xs = (x.pgs || []).filter(r => pidOf(r) === pid && games.some(g => g.id === r.game_id) && num(r.stats && r.stats.min) > 0)
        .map(r => ({ at: time((games.find(g => g.id === r.game_id) || {}).tipoff_at), pts: num(r.stats.pts) || 0 })).sort((a, b) => a.at - b.at);
        for (let i = xs.length - 1; i >= 0 && xs[i].pts >= 20; i--) n++; return n; })() });
  });
  players.forEach(list => list.sort((a, b) => (b.ppg || 0) - (a.ppg || 0)));
  return { v: 1, ids, sides, meetings, table, expect, players, rates: x.rates || rates(x.tgs, '__next') };
}

/* THE LEAGUE'S MAKE RATES, pooled over the season's team lines (this game left out): what a shot at the rim, from
   mid-range, from three and at the line usually gives in this league. story.js weighs a side's shot diet by them to
   split its shooting into the shots it got and the shots that fell. Null under 20 games, or without the zones. */
function rates(tgs, me) {
  if (!Array.isArray(tgs) || !tgs.length) return null;
  const s = { rimA: 0, rimM: 0, midA: 0, midM: 0, fga: 0, fgm: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0 };
  const games = new Set();
  tgs.forEach(r => {
    if (!r || r.game_id === me) return;
    const a = r.stats && r.stats.adv;
    if (!a || !(num(a.fga) > 0)) return;
    games.add(r.game_id);
    Object.keys(s).forEach(k => { s[k] += num(a[k]) || 0; });
  });
  if (games.size < 20 || !s.fga || !s.fg3a) return null;
  const twoA = s.fga - s.fg3a;
  return { rim: s.rimA >= 200 ? s.rimM / s.rimA : null, mid: s.midA >= 200 ? s.midM / s.midA : null,
           two: twoA > 0 ? (s.fgm - s.fg3m) / twoA : null, three: s.fg3m / s.fg3a, ft: s.fta ? s.ftm / s.fta : null,
           efg: (s.fgm + 0.5 * s.fg3m) / s.fga, games: games.size };
}

return { build, preview, rates, ratesFromTeams, __x: { clubLine, streakOf, standing, playerLines, returns, profiles, expectation, ordered } };
}));
