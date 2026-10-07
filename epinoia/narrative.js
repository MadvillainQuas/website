'use strict';
/* ============================================================================
   THE LEAGUE NEWSDESK — window.EpinoiaNarrative.

   A league's season, read every hour and written up the way a desk that followed it would: the storylines that are
   running (the race, the runs, the players on a tear, the upsets, the records, the clubs whose numbers say something
   their record does not), each with why it matters, the numbers, the counterpoint and what comes next; a briefing for
   the day; and, for creators, a whole coverage plan - the big picture, the slate ahead with an angle for every game, the
   games worth a recap, the players and clubs to feature, the data notes and a week's calendar.

   WHERE IT GETS ITS JUDGEMENT. Three engines already on the site, read together:
     the match reports    story.js / report.js, through each game's recap (its headline, standfirst, shape, moments)
     What Wins            the league's own model (winmodel.js explainOf: what one point of each factor is worth here),
                          used to value every game's facets and every club's identity
     the season           results, the table, every player's game lines, the season lines and their BPM

   HOW A STORYLINE LIVES (the threading rules). Each storyline has a stable id (a run is 'run:<club>'). A run that was
   there last hour and is longer now is the same storyline, DEVELOPING, version up, with a note of what changed; one that
   is no longer there is RESOLVED (and says how it ended) and kept for three days; a new one is NEW. A storyline only
   opens on enough evidence (a run of three, a hot spell of four games, a race inside two games) and every one carries
   the games it rests on. Nothing older than the season it is in is ever claimed: "the most this season", never "ever".

   WHAT IT NEVER DOES: invent a quote, a reason or a figure. Every number is computed here from the inputs, every
   sentence is a template with its slots filled from them, and a sentence with a slot it could not fill is dropped.

     EpinoiaNarrative.build(input) -> { v, built, league, season, stories, briefing, coverage, stats }
     input: { now, league: {id, slug, name, timezone}, season: {id, name}, comp: {id, name, qualifiers},
              table: {comp, rows}, teams: {id: {name, short_name, slug}} | Map,
              games:    finished games [{id, home_team_id, away_team_id, home_score, away_score, tipoff_at, attendance}],
              fixtures: games to come  [{id, home_team_id, away_team_id, tipoff_at}],
              lines:    player game lines [{game_id, team_idx, pid, min, pts, reb, ast, stl, blk, p3m}],
              teamLines: team game lines [{game_id, team_idx, adv: {efg, tovp, orebp, ftr, possessions, fga, fgm, fg3a,
                         fg3m, fta, ftm, oreb, dreb, tov}}],
              players:  season lines [{id, gp, mpg, ppg, rpg, apg, bpm, ts}], names: {pid: {name, teamId, slug}},
              recaps:   {gameId: {headline, standfirst, arc, decisive: {key, label, pts}, moment, expect}} (expect: the
                         season's numbers before the tip, home side's margin),
              model:    {b, home, n}, tallies: {gameId: {home, away}}, previous: the last build,
              comps:    the season's competitions [{id, kind}] (league | playoff | cup | trophy | friendly): records, runs
                         and the table are the league competitions'; a playoff competition's games are series,
              rest:     every regular-season game still to play, the whole season [{h, a, at}] (or remaining: {teamId: n}
                         and lastRegularAt), for how far through the season the league is and who can still catch whom,
              lastLine: {n} - how many clubs last season's play-offs took (said as that, never as this season's rule),
              lastTotal: last season's games a club (with rest: the whole schedule is known when the totals agree),
              released: [{team_id, player_id}] - the players a club has said have gone (player_releases),
              ties:     the bracket's knockout ties [{competition_id, label, home_team_id, away_team_id, winner_team_id,
                         legs, decider: 'wins' | 'aggregate'}] (bracket_ties) }
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNarrative = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ------------------------------------------------------------------ words --- */
const num = v => (v == null || v === '' || isNaN(v) ? null : +v);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = n => { const v = Math.round(+n); return v >= 0 && v <= 12 ? WORDS[v] : String(v); };
const ORDW = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const place = n => { const v = Math.round(+n); if (v >= 1 && v <= 10) return ORDW[v]; const t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
const ordShort = n => { const v = Math.round(+n), t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
const plural = (n, a, b) => spell(n) + ' ' + (Math.round(+n) === 1 ? a : (b || a + 's'));
const one = v => (Math.round(v * 10) / 10).toFixed(1);
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + one(Math.abs(v));
const half = x => { const w = Math.floor(x), h = x - w >= 0.5; return (w ? String(w) : h ? '' : '0') + (h ? '½' : ''); };
/* games behind, in words: "half a game", "a game and a half", "two and a half games", "13½ games" */
const gamesWord = n => {
  const v = Math.round(+n * 2) / 2, w = Math.floor(v), h = v - w === 0.5;
  if (v === 0.5) return 'half a game';
  if (v === 1) return 'one game';
  if (v === 1.5) return 'a game and a half';
  if (w <= 12) return spell(w) + (h ? ' and a half' : '') + ' games';
  return half(v) + ' games';
};
/* a facet's label takes a plural verb when it is plural ("the shots that fell were", "turnovers were", "the glass was") */
const plLabel = s => /^(the shots|turnovers|free throws|threes|the threes)\b/i.test(String(s || ''));
const wasWere = s => (plLabel(s) ? 'were' : 'was');
const list = xs => { const a = xs.filter(Boolean); return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
const cap = s => String(s || '').replace(/^\s*([a-z])/, (m, c) => m.replace(c, c.toUpperCase()));
const possOf = n => String(n) + (/s$/i.test(String(n)) ? '’' : '’s');
const rec = (w, l) => w + '–' + l;
const time = t => { const x = Date.parse(t); return isFinite(x) ? x : null; };
const HOUR = 3600000, DAY = 86400000;
/* a sentence with an empty slot is never printed (the same rule as the match reports) */
const LEAK = /\b(?:undefined|NaN|Infinity|null)\b|\[object |\{\{|\}\}|\[\[|\]\]/;
const clean = s => (s && !LEAK.test(s) ? s : null);

function dayWords(iso, tz, o) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const opts = Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, o || {});
  try { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz || undefined }, opts)).format(d); }
  catch (_) { return new Intl.DateTimeFormat('en-GB', opts).format(d); }
}

/* ------------------------------------------------------------ the season --- */
function teamsMap(t) {
  if (t instanceof Map) return t;
  const m = new Map();
  Object.keys(t || {}).forEach(k => m.set(k, t[k]));
  return m;
}

/* every club's season from the results: its games in order, record, runs, splits, close games, scoring */
function clubs(games) {
  const by = new Map();
  const add = (id, x) => { if (!id) return; if (!by.has(id)) by.set(id, []); by.get(id).push(x); };
  games.forEach(g => {
    const hs = num(g.home_score), as = num(g.away_score), at = time(g.tipoff_at);
    if (hs == null || as == null || at == null) return;
    add(g.home_team_id, { id: g.id, at, home: true, for: hs, against: as, won: hs > as, tied: hs === as, opp: g.away_team_id });
    add(g.away_team_id, { id: g.id, at, home: false, for: as, against: hs, won: as > hs, tied: hs === as, opp: g.home_team_id });
  });
  const out = new Map();
  by.forEach((xs, id) => {
    xs.sort((a, b) => a.at - b.at);
    const res = xs.filter(x => !x.tied);
    const last = res[res.length - 1];
    let n = 0;
    for (let i = res.length - 1; i >= 0 && last && res[i].won === last.won; i--) n++;
    /* the longest run of the season so far, of either kind */
    let best = { won: true, n: 0 }, cur = null;
    res.forEach(x => { if (cur && cur.won === x.won) cur.n++; else cur = { won: x.won, n: 1, from: x.at }; if (cur.won && cur.n > best.n) best = Object.assign({}, cur); });
    const w = res.filter(x => x.won).length, l = res.length - w;
    const pf = xs.reduce((s, x) => s + x.for, 0), pa = xs.reduce((s, x) => s + x.against, 0);
    const close = res.filter(x => Math.abs(x.for - x.against) <= 5);
    out.set(id, {
      id, games: xs, gp: res.length, w, l, pf, pa, ppg: xs.length ? pf / xs.length : null, papg: xs.length ? pa / xs.length : null,
      diff: xs.length ? (pf - pa) / xs.length : null,
      streak: last ? { won: last.won, n, from: res[res.length - n] ? res[res.length - n].at : null, games: res.slice(-n).map(x => x.id) } : null,
      bestWinRun: best,
      last5: res.slice(-5).map(x => (x.won ? 'W' : 'L')),
      last10w: res.slice(-10).filter(x => x.won).length, last10n: Math.min(10, res.length),
      home: { w: res.filter(x => x.home && x.won).length, l: res.filter(x => x.home && !x.won).length },
      away: { w: res.filter(x => !x.home && x.won).length, l: res.filter(x => !x.home && !x.won).length },
      close: { w: close.filter(x => x.won).length, l: close.filter(x => !x.won).length },
      /* the Pythagorean expectation, exponent 14: the record their points for and against say they "should" have */
      pyth: pf + pa > 0 ? Math.pow(pf, 14) / (Math.pow(pf, 14) + Math.pow(pa, 14)) : null,
      lastAt: xs.length ? xs[xs.length - 1].at : null
    });
  });
  return out;
}

/* the table as the league page reads it (win percentage, then the stored rank), per group; else from the results */
function standings(table, C) {
  const rows = table && Array.isArray(table.rows) && table.rows.length ? table.rows.filter(r => r && r.team_id) : null;
  const src = rows || [...C.values()].map(c => ({ team_id: c.id, gp: c.gp, w: c.w, l: c.l, group_name: null, rank: null }));
  const groups = new Map();
  src.forEach(r => { const g = r.group_name || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  const out = new Map();
  groups.forEach((rs, g) => {
    const n = (v, d) => (v == null || isNaN(v) ? d : +v);
    const ord = rs.slice().sort((a, b) => {
      const ga = n(a.gp, 0), gb = n(b.gp, 0);
      if (!ga !== !gb) return ga ? -1 : 1;
      if (ga && gb) { const d = n(b.w, 0) * ga - n(a.w, 0) * gb; if (d) return d; }
      return n(a.rank, 1e9) - n(b.rank, 1e9);
    }).map((r, i) => Object.assign({}, r, { pos: i + 1, w: n(r.w, 0), l: n(r.l, 0), gp: n(r.gp, 0) }));
    out.set(g, ord);
  });
  return out;
}
const gb = (a, b) => ((a.w - b.w) + (b.l - a.l)) / 2;

/* ------------------------------------------------ the facets of every game --- */
/* What each of the four factors was worth in each game, in points of its margin, from each side's own end: b x the
   difference where the league's model gives b (points of margin for one percentage point), else the fixed weights a
   point per 100 possessions. A club's identity is what separates its wins from its losses. */
const FIX = { efg: 2.0, tovp: -1.4, orebp: 0.7, ftr: 0.4 };
const FACET = { efg: 'shooting', tovp: 'the turnover battle', orebp: 'the offensive glass', ftr: 'getting to the line' };
function facets(teamLines, games, model) {
  const pair = new Map();
  (teamLines || []).forEach(r => { if (!r || !r.adv) return; if (!pair.has(r.game_id)) pair.set(r.game_id, {}); pair.get(r.game_id)[r.team_idx] = r.adv; });
  const gameBy = new Map(games.map(g => [g.id, g]));
  const B = model && model.b && ['efg', 'tovp', 'orebp', 'ftr'].every(k => num(model.b[k]) != null) ? model.b : null;
  const out = new Map();                       // game id -> { home: {k: pts}, decisive: {k, side, pts} }
  pair.forEach((p, gid) => {
    const g = gameBy.get(gid);
    if (!g || !p[0] || !p[1]) return;
    const poss = ((num(p[0].possessions) || 0) + (num(p[1].possessions) || 0)) / 2 || 70;
    const v = {};
    for (const k of ['efg', 'tovp', 'orebp', 'ftr']) {
      const a = num(p[0][k]), b = num(p[1][k]);
      if (a == null || b == null) return;
      v[k] = (B ? +B[k] : FIX[k] * poss / 100) * (a - b);     // home's view
    }
    const margin = num(g.home_score) - num(g.away_score);
    const w = margin > 0 ? 1 : margin < 0 ? -1 : 0;
    const top = Object.keys(v).sort((x, y) => w * v[y] - w * v[x])[0];
    out.set(gid, { home: v, decisive: w ? { k: top, pts: w * v[top] } : null, margin });
  });
  return out;
}
/* per club: what the facets were in its wins and in its losses, from its own end */
function identities(F, C) {
  const out = new Map();
  C.forEach((c, id) => {
    const sum = { win: { n: 0 }, loss: { n: 0 } };
    c.games.forEach(x => {
      const f = F.get(x.id);
      if (!f || x.tied) return;
      const s = x.won ? sum.win : sum.loss;
      s.n++;
      Object.keys(f.home).forEach(k => { s[k] = (s[k] || 0) + (x.home ? f.home[k] : -f.home[k]); });
    });
    if (sum.win.n < 2 || sum.loss.n < 2) return;
    const ks = ['efg', 'tovp', 'orebp', 'ftr'];
    const gap = ks.map(k => ({ k, win: sum.win[k] / sum.win.n, loss: sum.loss[k] / sum.loss.n })).map(x => Object.assign(x, { gap: x.win - x.loss }))
      .sort((a, b) => b.gap - a.gap);
    out.set(id, { top: gap[0], all: gap, wins: sum.win.n, losses: sum.loss.n });
  });
  return out;
}
/* the league's lens: what one standard deviation of each factor between clubs is worth a game, here */
function lens(model, teamRows) {
  const B = model && model.b ? model.b : null;
  const rows = (teamRows || []).filter(t => num(t.gp) >= 3);
  if (rows.length < 4) return null;
  const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1)); };
  const KEYS = { efg: ['ff_efg', 'dff_efg'], tovp: ['ff_tov', 'dff_tov'], orebp: ['ff_oreb', 'dff_oreb'], ftr: ['ff_ftr', 'dff_ftr'] };
  const pace = rows.map(t => num(t.pace)).filter(v => v != null);
  const poss = pace.length ? pace.reduce((a, b) => a + b, 0) / pace.length : 70;
  const out = [];
  Object.keys(KEYS).forEach(k => {
    const xs = rows.map(t => (num(t[KEYS[k][0]]) != null && num(t[KEYS[k][1]]) != null ? t[KEYS[k][0]] - t[KEYS[k][1]] : null)).filter(v => v != null);
    if (xs.length < 4) return;
    const b = B && num(B[k]) != null ? Math.abs(+B[k]) : Math.abs(FIX[k]) * poss / 100;
    out.push({ k, label: FACET[k], sd: sd(xs), pts: b * sd(xs) });
  });
  out.sort((a, b) => b.pts - a.pts);
  return { rows: out, model: !!B, n: model && model.n ? model.n : null, home: model && num(model.home) != null ? +model.home : null };
}

/* ------------------------------------------------------------- the players --- */
function playerSeason(lines, games) {
  const when = new Map(games.map(g => [g.id, time(g.tipoff_at)]));
  const side = new Map(games.map(g => [g.id, [g.home_team_id, g.away_team_id]]));
  const by = new Map();
  (lines || []).forEach(r => {
    if (!r || !r.pid || !(num(r.min) > 0)) return;
    const at = when.get(r.game_id);
    if (at == null) return;
    if (!by.has(r.pid)) by.set(r.pid, []);
    by.get(r.pid).push({ game: r.game_id, at, team: (side.get(r.game_id) || [])[r.team_idx] || null, min: num(r.min) / 60000,
      pts: num(r.pts) || 0, reb: num(r.reb) || 0, ast: num(r.ast) || 0, stl: num(r.stl) || 0, blk: num(r.blk) || 0, p3m: num(r.p3m) || 0 });
  });
  const out = new Map();
  by.forEach((xs, pid) => {
    xs.sort((a, b) => a.at - b.at);
    const n = xs.length, tot = k => xs.reduce((s, x) => s + x[k], 0);
    let run20 = 0;
    for (let i = n - 1; i >= 0 && xs[i].pts >= 20; i--) run20++;
    let runD = 0;
    for (let i = n - 1; i >= 0 && xs[i].pts >= 10 && xs[i].reb >= 10; i--) runD++;
    const last5 = xs.slice(-5), avg = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : null);
    const high = k => xs.reduce((b, x) => (!b || x[k] > b[k] ? x : b), null);
    out.set(pid, { pid, gp: n, team: xs[n - 1].team, lastAt: xs[n - 1].at, pts: tot('pts'), reb: tot('reb'), ast: tot('ast'),
      ppg: tot('pts') / n, rpg: tot('reb') / n, apg: tot('ast') / n, mpg: tot('min') / n,
      last5ppg: avg(last5, 'pts'), last5rpg: avg(last5, 'reb'), last5apg: avg(last5, 'ast'), prev5ppg: n > 5 ? avg(xs.slice(0, -5), 'pts') : null,
      run20, runDD: runD, high: { pts: high('pts'), reb: high('reb'), ast: high('ast'), p3m: high('p3m') }, games: xs });
  });
  return out;
}

/* ------------------------------------------------------------- expectation --- */
const logit = p => Math.log(p / (1 - p)), expit = x => 1 / (1 + Math.exp(-x));
const clampP = p => Math.min(0.97, Math.max(0.03, p));
function profiles(teamLines, games) {
  const gameBy = new Map(games.map(g => [g.id, g]));
  const pair = new Map();
  (teamLines || []).forEach(r => { if (!r || !r.adv) return; if (!pair.has(r.game_id)) pair.set(r.game_id, {}); pair.get(r.game_id)[r.team_idx] = r.adv; });
  const acc = new Map(), lg = { fgm: 0, fga: 0, fg3m: 0, fta: 0, tov: 0, oreb: 0, oppDreb: 0 };
  const blank = () => ({ n: 0, o: { fgm: 0, fga: 0, fg3m: 0, fta: 0, tov: 0, oreb: 0, oppDreb: 0 }, d: { fgm: 0, fga: 0, fg3m: 0, fta: 0, tov: 0, oreb: 0, oppDreb: 0 } });
  pair.forEach((p, gid) => {
    const g = gameBy.get(gid);
    if (!g || !p[0] || !p[1]) return;
    [0, 1].forEach(s => {
      const me = p[s], th = p[1 - s], id = s === 0 ? g.home_team_id : g.away_team_id;
      if ([me.fga, me.fta, me.tov, me.oreb, th.dreb].some(v => num(v) == null)) return;
      if (!acc.has(id)) acc.set(id, blank());
      const A = acc.get(id);
      A.n++;
      ['fgm', 'fga', 'fg3m', 'fta', 'tov', 'oreb'].forEach(k => { A.o[k] += num(me[k]) || 0; A.d[k] += num(th[k]) || 0; lg[k] += num(me[k]) || 0; });
      A.o.oppDreb += num(th.dreb) || 0; A.d.oppDreb += num(me.dreb) || 0; lg.oppDreb += num(th.dreb) || 0;
    });
  });
  const rates = x => ({ efg: x.fga ? (x.fgm + 0.5 * x.fg3m) / x.fga : null, tovp: x.fga + 0.44 * x.fta + x.tov ? x.tov / (x.fga + 0.44 * x.fta + x.tov) : null,
    orebp: x.oreb + x.oppDreb ? x.oreb / (x.oreb + x.oppDreb) : null, ftr: x.fga ? x.fta / x.fga : null });
  const teams = new Map();
  acc.forEach((A, id) => teams.set(id, { n: A.n, off: rates(A.o), def: rates(A.d) }));
  return { teams, league: rates(lg) };
}
/* the season's four factors, blended the model's way (a proportion's logit: offence + the other's defence - the league),
   weighed by the model's coefficients: the expected margin, home side's view, and each factor's part of it */
function expect(P, home, away, model) {
  if (!P) return null;
  const A = P.teams.get(home), B = P.teams.get(away), mu = P.league;
  if (!A || !B || A.n < 3 || B.n < 3) return null;
  const W = model && model.b ? model.b : null;
  const parts = {};
  let m = 0;
  for (const k of ['efg', 'tovp', 'orebp', 'ftr']) {
    const vals = [A.off[k], B.def[k], B.off[k], A.def[k], mu[k]];
    if (vals.some(v => v == null || !isFinite(v))) return null;
    const sh = (v, n) => (n * v + 4 * mu[k]) / (n + 4);
    const xa = expit(logit(clampP(sh(A.off[k], A.n))) + logit(clampP(sh(B.def[k], B.n))) - logit(clampP(mu[k])));
    const xb = expit(logit(clampP(sh(B.off[k], B.n))) + logit(clampP(sh(A.def[k], A.n))) - logit(clampP(mu[k])));
    const b = W && num(W[k]) != null ? +W[k] : FIX[k] * 0.72;
    parts[k] = { a: 100 * xa, b: 100 * xb, pts: b * 100 * (xa - xb) };
    m += parts[k].pts;
  }
  if (model && num(model.home) != null) m += +model.home;
  return { margin: m, parts, model: !!W };
}

/* ============================================================== the build === */
function build(input) {
  const o = input || {};
  const nowMs = o.now instanceof Date ? o.now.getTime() : time(o.now) || Date.now();
  const tz = o.league && o.league.timezone || null;
  const T = teamsMap(o.teams);
  const name = id => { const t = T.get(id); return t ? String(t.name || t.short_name || 'A club') : 'A club'; };
  const short = id => { const t = T.get(id); return t ? String(t.short_name || t.name || '') : ''; };
  const games = (o.games || []).filter(g => g && num(g.home_score) != null && num(g.away_score) != null && time(g.tipoff_at) != null)
    .sort((a, b) => time(a.tipoff_at) - time(b.tipoff_at));
  const fixtures = (o.fixtures || []).filter(g => g && time(g.tipoff_at) != null && time(g.tipoff_at) >= nowMs - 3 * HOUR)
    .sort((a, b) => time(a.tipoff_at) - time(b.tipoff_at));
  /* THE COMPETITIONS. A record, a run, the table and the luck are the regular season's (the league competitions: the
     table the league page shows counts nothing else); a play-off competition's games are series; a cup, a trophy or a
     friendly is neither. Without the competitions every game is the regular season's, as before. */
  const kindOf = new Map((o.comps || []).filter(c => c && c.id).map(c => [c.id, String(c.kind || 'league')]));
  const isRegular = g => !kindOf.size || !g.competition_id || !kindOf.has(g.competition_id) || kindOf.get(g.competition_id) === 'league';
  const isPost = g => !!g.competition_id && kindOf.get(g.competition_id) === 'playoff';
  const regular = games.filter(isRegular), post = games.filter(isPost);
  /* a game to come between two clubs already in a play-off series, within ten days of their last play-off game, is the
     next game of that series: several feeds file a fixture under the league until it has been played */
  const pk = g => [g.home_team_id, g.away_team_id].sort().join('|');
  const lastPost = new Map();
  post.forEach(g => { const k = pk(g), t = time(g.tipoff_at); if (!lastPost.has(k) || t > lastPost.get(k)) lastPost.set(k, t); });
  const seriesLike = g => { const t0 = lastPost.get(pk(g)), t = time(g.tipoff_at); return t0 != null && t != null && t > t0 && t - t0 <= 10 * DAY; };
  const isPostFix = g => isPost(g) || (isRegular(g) && seriesLike(g));
  const regFix = fixtures.filter(g => !isPostFix(g) && isRegular(g)), postFix = fixtures.filter(isPostFix);
  const C = clubs(regular);
  /* every competition, for who has played lately and who has not (a player missing a play-off game is missing) */
  const CA = post.length || regular.length !== games.length ? clubs(games) : C;
  const S = standings(o.table, C);
  const posOf = new Map();
  S.forEach((rows, g) => rows.forEach(r => posOf.set(r.team_id, Object.assign({ group: g || null, of: rows.length }, r))));
  const F = facets(o.teamLines, games, o.model);
  const ID = identities(F, C);
  /* the clubs' four factors at both ends, from their game lines: the lens's spread when no season lines were given */
  const P = profiles(o.teamLines, games);
  const LENS = lens(o.model, o.seasonTeams || [...P.teams.values()].filter(t => t.n >= 3).map(t => ({ gp: t.n,
    ff_efg: 100 * t.off.efg, dff_efg: 100 * t.def.efg, ff_tov: 100 * t.off.tovp, dff_tov: 100 * t.def.tovp,
    ff_oreb: 100 * t.off.orebp, dff_oreb: 100 * t.def.orebp, ff_ftr: 100 * t.off.ftr, dff_ftr: 100 * t.def.ftr })));
  const PL = playerSeason(o.lines, games);
  const gone = new Set((o.released || []).filter(r => r && r.team_id && r.player_id).map(r => r.team_id + '|' + r.player_id));
  /* the rest of what the site publishes about the league (the builder's readExtras): significance, highlights, the
     fans' vote, the schedule so far, ages */
  const SIG = o.significance || {}, VID = o.highlights || {}, SOSIN = o.sos || null, BIO = o.bio || {};
  /* THE SCHEDULE SO FAR (sos.js, the Table page's own engine): every club with four games ranked by how hard its
     opponents have been (their average adjusted net rating) and by its own margins adjusted for them */
  const sosRows = SOSIN ? [...C.values()].filter(c => c.gp >= 4 && SOSIN[c.id] && isFinite(SOSIN[c.id].sosNet) && isFinite(SOSIN[c.id].adjNet))
    .map(c => Object.assign({ id: c.id, c }, SOSIN[c.id])) : [];
  const byHard = sosRows.slice().sort((a, b) => b.sosNet - a.sosNet);
  const easyRank = id => { const i = byHard.findIndex(r => r.id === id); return i < 0 ? null : byHard.length - i; };   // 1 = the easiest
  const byAdj = sosRows.slice().sort((a, b) => b.adjNet - a.adjNet);
  /* "Yes, but nobody has had an easier schedule so far": for a record built against the weakest opponents */
  const easyCounter = id => {
    const k = sosRows.length >= 6 ? easyRank(id) : null;
    if (!k || k > Math.max(1, Math.floor(sosRows.length / 4))) return null;
    return k === 1 ? 'Yes, but nobody has had an easier schedule so far.' : 'Yes, but only ' + plural(k - 1, 'club') + ' ' + (k === 2 ? 'has' : 'have') + ' had an easier schedule so far.';
  };
  const ageOf = pid => (BIO[pid] && num(BIO[pid].age) > 0 ? +BIO[pid].age : null);
  const names = o.names || {};
  const pname = pid => { const n = names[pid]; return n && n.name ? String(n.name) : null; };
  const maxGp = [...C.values()].reduce((m, c) => Math.max(m, c.gp), 0);
  const qualifiers = o.comp && num(o.comp.qualifiers) ? +o.comp.qualifiers : null;
  const recaps = o.recaps || {};
  const tallies = o.tallies || {};
  /* THE SEASON'S SHAPE: how far through it the league is, from the regular-season games each club still has to play
     (the builder counts them over the whole season). Trusted only when every club's total agrees and the schedule runs
     well past the next three weeks (a feed that loads a fortnight at a time would make a long season look short), or
     when the regular season is over: the play-offs have begun and none of it is left to play. */
  /* the builder gives every regular-season game still to play ({h, a, at}); a game that is really a series game (above)
     is not the regular season's. An older caller gives the counts. */
  let lastRegularAt = o.lastRegularAt || null;
  const REM = (() => {
    if (Array.isArray(o.rest)) {
      const m = {};
      lastRegularAt = null;
      o.rest.forEach(x => {
        if (!x || seriesLike({ home_team_id: x.h, away_team_id: x.a, tipoff_at: x.at })) return;
        [x.h, x.a].forEach(id => { if (id) m[id] = (m[id] || 0) + 1; });
        if (x.at && (!lastRegularAt || time(x.at) > time(lastRegularAt))) lastRegularAt = x.at;
      });
      return m;
    }
    return o.remaining && typeof o.remaining === 'object' ? o.remaining : null;
  })();
  const regularOver = (post.length > 0 || postFix.length > 0) && regFix.length === 0 && maxGp >= 3 &&
    (!REM || [...C.keys()].every(id => !(num(REM[id]) > 0)));
  const shape = (() => {
    if (!REM || C.size < 4) return regularOver ? { over: true, trusted: true, total: maxGp, left: 0, phase: 1 } : null;
    const tot = [...C.values()].map(c => c.gp + (num(REM[c.id]) || 0));
    const avg = tot.reduce((a, b) => a + b, 0) / tot.length;
    const left = Math.max(0, Math.round(avg - [...C.values()].reduce((s, c) => s + c.gp, 0) / C.size));
    /* the whole schedule is known when it runs well past the next three weeks, or when this season's total is last
       season's games a club, or a whole number of round robins (a feed that loads two weeks at a time makes neither) */
    const far = time(lastRegularAt) != null && time(lastRegularAt) > nowMs + 45 * DAY;
    const clubsN = S.size === 1 ? [...S.values()][0].length : C.size;
    const robin = clubsN >= 4 && [1, 2, 3, 4].some(k => Math.abs(avg - k * (clubsN - 1)) <= 1);
    const asLast = num(o.lastTotal) > 0 && Math.abs(avg - o.lastTotal) <= 2;
    const trusted = regularOver || (Math.max(...tot) - Math.min(...tot) <= 2 && avg >= 6 && (far || robin || asLast));
    return { over: regularOver, trusted, total: Math.round(avg), left, phase: avg ? 1 - left / avg : null };
  })();
  const remOf = id => (REM ? num(REM[id]) || 0 : 0);
  const nextOf = id => fixtures.find(g => g.home_team_id === id || g.away_team_id === id) || null;
  const nextInfo = id => {
    const g = nextOf(id);
    if (!g) return null;
    const home = g.home_team_id === id;
    return { g, home, opp: home ? g.away_team_id : g.home_team_id, day: dayWords(g.tipoff_at, tz) };
  };
  /* "Fuerza Regia visit on Thursday 8 October" / "away at Sendai 89ers on Friday 9 October": after "Next:" */
  const nextText = id => { const x = nextInfo(id); return x && x.day ? (x.home ? name(x.opp) + ' visit on ' + x.day : 'away at ' + name(x.opp) + ' on ' + x.day) : null; };
  /* the same as the end of a sentence: "It goes on the line when Toyama Grouses visit on Friday 9 October." /
     "It goes on the line away at Sendai 89ers on Friday 9 October." */
  const whenNext = id => { const x = nextInfo(id); return x && x.day ? (x.home ? 'when ' + name(x.opp) + ' visit on ' + x.day : 'away at ' + name(x.opp) + ' on ' + x.day) : null; };
  /* the opponent first: "Shiga Lakes, who visit on Saturday 10 October" / "Shinshu Brave Warriors, at home on Saturday" */
  const nextToTry = id => { const x = nextInfo(id); return x && x.day ? name(x.opp) + (x.home ? ', who visit on ' : ', at home on ') + x.day : null; };
  /* where a club stood at a moment, by the records then (win percentage, then wins): "from ninth to fourth" */
  const placeAt = (id, ms) => {
    if (S.size !== 1 || ms == null) return null;
    const r0 = new Map();
    regular.forEach(g => {
      const t = time(g.tipoff_at), hs = +g.home_score, as = +g.away_score;
      if (t >= ms || hs === as) return;
      [[g.home_team_id, hs > as], [g.away_team_id, as > hs]].forEach(([tid, won]) => { const r = r0.get(tid) || { w: 0, l: 0 }; if (won) r.w++; else r.l++; r0.set(tid, r); });
    });
    const me = r0.get(id);
    if (!me || me.w + me.l < 2) return null;
    const pct = r => r.w / Math.max(1, r.w + r.l);
    let pos = 1;
    r0.forEach((r, tid) => { if (tid !== id && (pct(r) > pct(me) || (pct(r) === pct(me) && r.w > me.w))) pos++; });
    return pos;
  };
  const gameLink = id => ({ label: 'the game', href: 'game/?g=' + id });
  /* a game's highlights on the site's own watch page, when it has them (league_videos) */
  const videoLink = id => (VID && VID[id] ? { label: 'the highlights', href: 'watch/?g=' + id } : null);
  const teamLink = id => { const t = T.get(id); return t && t.slug ? { label: name(id), href: 't/?t=' + encodeURIComponent(t.slug) } : null; };
  const playerLink = pid => (/^[0-9a-f-]{36}$/i.test(String(pid)) ? { label: pname(pid) || 'the player', href: 'p/?p=' + pid } : null);

  const out = [];
  /* a storyline: everything a reader or a creator needs, and what the ranking reads */
  const story = s => {
    const st = Object.assign({ teams: [], players: [], games: [], numbers: [], angles: [], links: [], body: [] }, s);
    ['head', 'dek', 'why', 'counter', 'next'].forEach(k => { if (st[k] != null) st[k] = clean(st[k]); });
    if (st.head) st.head = cap(st.head);
    /* a counterpoint is kept without its "Yes, but": the page and the copy say that */
    if (st.counter) st.counter = cap(String(st.counter).replace(/^yes, but\s*/i, ''));
    st.body = st.body.map(clean).filter(Boolean);
    st.numbers = st.numbers.filter(n => n && n.value != null && !LEAK.test(String(n.value)) && !LEAK.test(String(n.label)));
    if (!st.head) return;
    out.push(st);
  };

  /* ---- THE RACE AT THE TOP, per group ------------------------------------------------------------------- */
  S.forEach((rows, g) => {
    const played = rows.filter(r => r.gp > 0);
    if (played.length < 3 || maxGp < 3) return;
    const lead = played[0], second = played[1];
    const grp = g ? (/\s/.test(g) ? g : 'Group ' + g) : null;
    const where = grp ? ' in ' + grp : '';
    const gap = gb(lead, second);
    const lc = C.get(lead.team_id);
    /* THE REGULAR SEASON IS OVER: who finished where, said once while the play-offs run */
    if (shape && shape.over) {
      story({ id: 'final:' + (g || 'top'), kind: 'final', kicker: 'The regular season', head: name(lead.team_id) + ' finish top' + where + ' at ' + rec(lead.w, lead.l),
        dek: gap > 0 ? cap(gamesWord(gap)) + ' clear of ' + name(second.team_id) + '.' : 'Level with ' + name(second.team_id) + ' on the record; the table puts them first.',
        why: 'The regular season set the seeds; from here it is series.',
        numbers: played.slice(0, 4).map(r => ({ label: ordShort(r.pos), value: name(r.team_id) + ' ' + rec(r.w, r.l) })),
        teams: [lead.team_id, second.team_id], tracks: { metric: 'final', value: lead.team_id }, importance: 4.5, magnitude: 0.6, stakes: 0.5,
        lastAt: lc ? lc.lastAt : null, evergreen: true, angles: ['the regular season in review: the table, the turning points, the best players'],
        links: [teamLink(lead.team_id)].filter(Boolean) });
      return;
    }
    const bunch = played.filter(r => gb(lead, r) <= 1.5);
    /* half the table within a game and a half of the top is a table that has not formed: said as that, and ranked low */
    const unformed = bunch.length > Math.max(3, Math.ceil(played.length / 2));
    const early = shape && shape.trusted && shape.phase != null ? shape.phase < 0.2 : maxGp <= 6;
    const runIn = !!(shape && shape.trusted && shape.phase != null && shape.phase >= 0.75 && shape.left > 0);
    const meet = unformed ? [] : regFix.filter(f => bunch.some(r => r.team_id === f.home_team_id) && bunch.some(r => r.team_id === f.away_team_id));
    /* the best side by the margins: early on, the points say more than the places */
    const best = [...C.values()].filter(c => c.gp >= 3 && played.some(r => r.team_id === c.id)).sort((a, b) => b.diff - a.diff)[0] || null;
    /* who can still catch the leader (a club that can reach the leader's wins as they stand); only on a whole schedule */
    const chasers = shape && shape.trusted && REM ? played.filter(r => r !== lead && r.w + remOf(r.team_id) >= lead.w) : null;
    const clinched = runIn && chasers && !chasers.length;
    const head = clinched ? name(lead.team_id) + ' cannot be caught' + where
      : unformed ? 'Nobody has broken away yet' + where
      : bunch.length >= 3 ? (bunch.length > 12 ? 'A crowded top' + where + ': ' + bunch.length + ' clubs within ' : plural(bunch.length, 'club') + ' within ') +
          (gb(lead, bunch[bunch.length - 1]) <= 1 ? 'a game' : 'a game and a half') + (bunch.length > 12 ? ' of first' : ' of the top' + where)
      : gap === 0 ? name(lead.team_id) + ' and ' + name(second.team_id) + ' level at the top' + where
      : name(lead.team_id) + ' ' + (gap >= 3 ? 'pull clear' : 'lead') + where + ', ' + gamesWord(gap) + ' ahead';
    const stage = shape && shape.trusted && shape.total >= 6 ? cap(spell(maxGp)) + ' games into a ' + shape.total + '-game season' : null;
    const why = clinched ? 'Nobody else can reach their ' + spell(lead.w) + ' wins now, with ' + plural(shape.left, 'game') + ' left.'
      : runIn && chasers ? 'With ' + plural(shape.left, 'game') + ' left, ' + (chasers.length === 1 ? 'only ' + name(chasers[0].team_id) + ' can still catch them.' : spell(chasers.length) + ' clubs can still catch them.')
      : early ? (stage || 'It is early: ' + plural(maxGp, 'game') + ' in') + ', the table is a first draft' +
          (best && best.diff > 0 ? '; by the margins, ' + name(best.id) + (best.id === lead.team_id ? ' are the best side as well, at ' : ' have been the best side so far, at ') + signed(best.diff) + ' a game.' : '.')
      : unformed ? 'Half the league is within a game and a half of first: one week can turn the table over.'
      : gap <= 1 ? 'One result can change who is top.' : gap >= 3 ? 'The season’s first real separation.' : 'A cushion, but not one a bad week cannot erase.';
    story({
      id: 'race:' + (g || 'top'), kind: 'race', kicker: 'The race', head,
      dek: name(lead.team_id) + ' are ' + rec(lead.w, lead.l) + (gap > 0 ? ', ' + gamesWord(gap) + ' clear of ' + name(second.team_id) : ', level with ' + name(second.team_id) + ' on the record') + '.',
      why,
      numbers: [{ label: 'leader', value: name(lead.team_id) + ' ' + rec(lead.w, lead.l) }, { label: 'next', value: name(second.team_id) + ' ' + rec(second.w, second.l) },
        { label: 'clubs within a game and a half', value: String(bunch.length) },
        lc && lc.last5.length ? { label: 'leader’s last five', value: lc.last5.join(' ') } : null,
        shape && shape.trusted && !shape.over ? { label: 'games left', value: String(shape.left) } : null],
      counter: lc && lc.pyth != null && lc.gp >= 5 && lc.pyth * lc.gp < lc.w - 1.5 ? 'Yes, but their points for and against suggest about ' + spell(Math.round(lc.pyth * lc.gp)) + ' wins, not ' + spell(lc.w) + ': the record is running ahead of the play.' : null,
      next: meet.length ? 'The contenders meet on ' + dayWords(meet[0].tipoff_at, tz) + ': ' + name(meet[0].home_team_id) + ' v ' + name(meet[0].away_team_id) + '.'
        : nextText(lead.team_id) ? 'Next for ' + name(lead.team_id) + ': ' + nextText(lead.team_id) + '.' : null,
      teams: bunch.map(r => r.team_id).slice(0, 4), games: meet.map(f => f.id).slice(0, 3),
      tracks: { metric: 'gap', value: gap },
      importance: (unformed ? 3 : clinched ? 9.5 : 9) * (early && !unformed ? 0.65 : 1), magnitude: unformed ? 0.2 : Math.min(1, bunch.length / 5 + (gap >= 3 ? 0.4 : 0) + (runIn ? 0.3 : 0)), stakes: unformed ? 0.4 : 1,
      lastAt: lc ? lc.lastAt : null, angles: ['the race, in a table and a paragraph', 'a preview of the next meeting between the contenders', runIn ? 'the run-in: every contender’s remaining games, side by side' : 'a weekly "state of the race" column'],
      links: [teamLink(lead.team_id), teamLink(second.team_id)].filter(Boolean)
    });
  });

  /* ---- THE LINE: the last place that goes through, per group, and who is pressing; then who is through and who is
     out of it. The competition's own number where it has one; else, for a single table, last season's play-offs - said
     as that ("last season's play-offs took the top eight"), never as this season's rule. --------------------------- */
  const lastLine = !qualifiers && S.size === 1 && o.lastLine && num(o.lastLine.n) > 0 ? +o.lastLine.n : null;
  const lineN = qualifiers || lastLine;
  if (lineN && !(shape && shape.over) && maxGp >= 4) S.forEach((rows0, g) => {
    const rows = rows0.filter(r => r.gp > 0);
    if (rows.length <= lineN) return;
    const grp = g ? (/\s/.test(g) ? g : 'Group ' + g) : null;
    const where = grp ? ' in ' + grp : '';
    const rule = qualifiers ? 'Only the top ' + spell(lineN) + where + ' go through' : 'Last season’s play-offs took the top ' + spell(lineN);
    const inn = rows[lineN - 1], outt = rows[lineN], gap = gb(inn, outt);
    const near = rows.filter((r, i) => i >= lineN && gb(inn, r) <= 1.5);
    if (gap <= 2) {
      story({
        id: 'line' + (g ? ':' + g : ''), kind: 'line', kicker: 'The line',
        head: 'The fight for ' + place(lineN) + where + ': ' + name(inn.team_id) + ' hold it, ' + name(outt.team_id) + ' ' + (gap ? gamesWord(gap) + ' behind' : 'level'),
        dek: cap(plural(near.length + 1, 'club')) + ' within a game and a half of ' + place(lineN) + '.',
        why: rule + (qualifiers ? ', and the line moves every week.' : '; if this season’s are the same, the line moves every week.'),
        numbers: [{ label: place(lineN), value: name(inn.team_id) + ' ' + rec(inn.w, inn.l) }].concat(near.slice(0, 3).map(r => ({ label: ordShort(r.pos), value: name(r.team_id) + ' ' + rec(r.w, r.l) })))
          .concat(shape && shape.trusted ? [{ label: 'games left', value: String(shape.left) }] : []),
        next: nextText(outt.team_id) ? 'Next for ' + name(outt.team_id) + ': ' + nextText(outt.team_id) + '.' : null,
        teams: [inn.team_id, outt.team_id].concat(near.map(r => r.team_id)).slice(0, 5),
        tracks: { metric: 'gap', value: gap }, importance: 7.5, magnitude: Math.min(1, near.length / 3), stakes: 0.9,
        lastAt: Math.max(...[inn, outt].map(r => (C.get(r.team_id) || {}).lastAt || 0)),
        angles: ['who is in, who is out, and the schedule each has left', 'a "games that decide it" list from the fixtures']
      });
    }
    /* THROUGH AND OUT OF IT, on the whole schedule only. Through: fewer than lineN other clubs can still reach this
       club's wins as they stand (a tie counts against it). Out: lineN clubs already have more wins than it can reach. */
    if (!(shape && shape.trusted && REM) || shape.phase < 0.5) return;
    rows.forEach((r, i) => {
      const reach = r.w + remOf(r.team_id);
      const threats = rows.filter(x => x !== r && x.w + remOf(x.team_id) >= r.w).length;
      const above = rows.filter(x => x !== r && x.w > reach).length;
      const c = C.get(r.team_id);
      if (i < lineN && threats < lineN) story({ id: 'through:' + r.team_id, kind: 'through', kicker: 'Place secured',
        head: name(r.team_id) + ' are sure of a top-' + spell(lineN) + ' finish' + where,
        dek: rec(r.w, r.l) + ', ' + ordShort(r.pos) + ', with ' + plural(remOf(r.team_id), 'game') + ' left.',
        why: rule + (qualifiers ? '.' : '; whatever this season’s format, nobody can push them out of the top ' + spell(lineN) + ' now.'),
        teams: [r.team_id], tracks: { metric: 'through', value: r.team_id }, importance: 6, magnitude: 0.6, stakes: 0.8, lastAt: c ? c.lastAt : null,
        angles: ['what they are playing for now: the seeding'], links: [teamLink(r.team_id)].filter(Boolean) });
      else if (i >= lineN && above >= lineN) story({ id: 'out:' + r.team_id, kind: 'out', kicker: 'Out of it',
        head: name(r.team_id) + ' can no longer finish in the top ' + spell(lineN) + where,
        dek: rec(r.w, r.l) + ', ' + ordShort(r.pos) + (remOf(r.team_id) ? '; even ' + plural(remOf(r.team_id), 'more win') + ' would leave them short.' : '; their regular season is over.'),
        why: rule + '.', teams: [r.team_id], tracks: { metric: 'out', value: r.team_id }, importance: 4, magnitude: 0.4, stakes: 0.4, lastAt: c ? c.lastAt : null,
        angles: ['what the rest of the season is for: the young players, next season'], links: [teamLink(r.team_id)].filter(Boolean) });
    });
  });

  /* ---- RUNS: every winning run of three and more, and every losing run of four (the regular season's; once it is
     over, the play-offs are the story) ------------------------------------------------------------------------------ */
  const over = !!(shape && shape.over);
  /* the facet that changed most in a run: each facet's worth a game in the run against before it (What Wins) */
  const runShift = (c, ids) => {
    const inRun = new Set(ids), sum = { a: {}, b: {}, na: 0, nb: 0 };
    c.games.forEach(x => {
      const f = F.get(x.id);
      if (!f) return;
      const s = inRun.has(x.id) ? 'a' : 'b';
      sum['n' + s]++;
      Object.keys(f.home).forEach(k => { sum[s][k] = (sum[s][k] || 0) + (x.home ? f.home[k] : -f.home[k]); });
    });
    if (sum.na < 3 || sum.nb < 3) return null;
    const d = Object.keys(sum.a).map(k => ({ k, run: sum.a[k] / sum.na, before: (sum.b[k] || 0) / sum.nb })).map(x => Object.assign(x, { d: x.run - x.before }))
      .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))[0];
    return d && Math.abs(d.d) >= 2.5 ? d : null;
  };
  C.forEach((c, id) => {
    const s = c.streak;
    if (!s || c.gp < 3 || over) return;
    const pos = posOf.get(id);
    const margins = s.games.map(gid => { const x = c.games.find(y => y.id === gid); return x ? x.for - x.against : 0; });
    const before = pos ? placeAt(id, s.from) : null;
    const shift = runShift(c, s.games);
    /* not a run that is simply the whole season so far: an unbeaten start is its own storyline, from four games */
    if (s.won && s.n >= 3 && c.l > 0) {
      const beaten = s.games.map(gid => { const x = c.games.find(y => y.id === gid); return x ? x.opp : null; }).filter(Boolean);
      const above = beaten.filter(oid => { const p = posOf.get(oid); return p && pos && p.pos < pos.pos; }).length;
      const record = c.bestWinRun && c.bestWinRun.n === s.n && s.n >= 5;
      const longest = ![...C.values()].some(x => x.id !== id && x.streak && x.streak.won && x.streak.n >= s.n);
      /* why it matters, from the run's own facts: the climb, the league's longest, the margins, else what it changes */
      const why = before && pos && before - pos.pos >= 3 ? 'It has taken them from ' + place(before) + ' to ' + place(pos.pos) + '.'
        : longest && s.n >= 4 ? 'Nobody else in the league has a winning run this long going.'
        : margins.every(m => m >= 10) ? 'All ' + spell(s.n) + ' by ten points or more.'
        : s.n >= 6 ? 'Nobody else in the league has strung this many together.' : 'A run like this changes where a season is heading.';
      story({
        id: 'run:' + id, kind: 'run', kicker: 'On a run', head: name(id) + ' have won ' + spell(s.n) + ' in a row',
        dek: (pos ? 'Up to ' + place(pos.pos) + ' at ' + rec(c.w, c.l) + '. ' : '') + 'The run started ' + dayWords(new Date(s.from).toISOString(), tz, { weekday: undefined }) + '.',
        why,
        numbers: [{ label: 'run', value: 'W' + s.n }, { label: 'record', value: rec(c.w, c.l) }, pos ? { label: 'place', value: ordShort(pos.pos) } : null,
          { label: 'margin in the run', value: signed(margins.reduce((a, b) => a + b, 0) / s.n) },
          shift ? { label: FACET[shift.k] + ', a game', value: signed(shift.run) + ' in the run, ' + signed(shift.before) + ' before' } : null],
        counter: above === 0 && s.n >= 3 && pos ? 'Yes, but none of the ' + spell(s.n) + ' came against a side above them in the table.' : easyCounter(id),
        next: whenNext(id) ? 'It goes on the line ' + whenNext(id) + '.' : null,
        body: [record ? 'It is already their longest run of the season.' : null,
          shift ? 'What changed: ' + FACET[shift.k] + ', worth ' + signed(shift.run) + ' points a game to them in the run against ' + signed(shift.before) + ' before it.' : null],
        teams: [id], games: s.games, tracks: { metric: 'run', value: s.n }, importance: 6 + Math.min(3, s.n / 2), magnitude: Math.min(1, s.n / 8),
        stakes: pos ? Math.max(0.3, 1 - (pos.pos - 1) / Math.max(1, pos.of)) : 0.5, lastAt: c.lastAt,
        angles: ['how the run was built, game by game', shift ? 'what changed: ' + FACET[shift.k] + ', before the run and during it' : 'what changed: the numbers before and during it'],
        links: [teamLink(id)].filter(Boolean)
      });
    } else if (!s.won && s.n >= 4) {
      const worst = ![...C.values()].some(x => x.id !== id && x.streak && !x.streak.won && x.streak.n >= s.n);
      const why = before && pos && pos.pos - before >= 3 ? 'It has dropped them from ' + place(before) + ' to ' + place(pos.pos) + '.'
        : worst && s.n >= 5 ? 'The longest losing run in the league right now.'
        : margins.every(m => m <= -10) ? 'All ' + spell(s.n) + ' by ten points or more.'
        : 'Every defeat now costs ground that is hard to win back.';
      story({
        id: 'skid:' + id, kind: 'skid', kicker: 'The slide', head: name(id) + ' have lost ' + spell(s.n) + ' straight',
        dek: (pos ? cap(place(pos.pos)) + ' at ' + rec(c.w, c.l) + '. ' : '') + 'The last win was ' + spell(s.n) + ' games ago.',
        why,
        numbers: [{ label: 'run', value: 'L' + s.n }, { label: 'record', value: rec(c.w, c.l) }, { label: 'average margin', value: signed(c.diff || 0) },
          shift ? { label: FACET[shift.k] + ', a game', value: signed(shift.run) + ' in the run, ' + signed(shift.before) + ' before' } : null],
        counter: c.close.l >= 2 && s.n >= 4 ? 'Yes, but ' + spell(c.close.l) + ' of their defeats this season were by five or fewer: the margins are small.' : null,
        next: nextText(id) ? 'The next chance: ' + nextText(id) + '.' : null,
        body: [shift ? 'What changed: ' + FACET[shift.k] + ', worth ' + signed(shift.run) + ' points a game to them in the run against ' + signed(shift.before) + ' before it.' : null],
        teams: [id], games: s.games, tracks: { metric: 'skid', value: s.n }, importance: 5 + Math.min(2, s.n / 3), magnitude: Math.min(1, s.n / 8), stakes: 0.5, lastAt: c.lastAt,
        angles: [shift ? 'what has gone wrong: ' + FACET[shift.k] + ', in the numbers' : 'what has gone wrong, in the numbers', 'the one fixture that could end it'], links: [teamLink(id)].filter(Boolean)
      });
    }
  });

  /* ---- THE UNBEATEN AND THE WINLESS ------------------------------------------------------------------------ */
  const unbeaten = over ? [] : [...C.values()].filter(x => x.gp >= 4 && x.l === 0);
  C.forEach((c, id) => {
    if (over) return;
    const res = c.games.filter(x => !x.tied);
    const closest = res.length ? Math.min(...res.map(x => Math.abs(x.for - x.against))) : null;
    if (c.gp >= 4 && c.l === 0) story({ id: 'perfect:' + id, kind: 'perfect', kicker: 'Unbeaten', head: name(id) + ' are still perfect at ' + rec(c.w, 0),
      dek: 'Average margin ' + signed(c.diff || 0) + (c.away.w >= 2 ? '; ' + rec(c.away.w, 0) + ' on the road' : '') + '.',
      why: (unbeaten.length === 1 ? 'The last unbeaten side in the league' : 'One of ' + spell(unbeaten.length) + ' sides still unbeaten') +
        (closest != null ? (closest >= 8 ? ', and nobody has got closer than ' + spell(closest) + ' points.' : '; their closest win was by ' + spell(closest) + '.') : '.'),
      teams: [id], games: c.games.slice(-3).map(x => x.id), counter: easyCounter(id),
      next: nextToTry(id) ? 'Next to try: ' + nextToTry(id) + '.' : null, tracks: { metric: 'w', value: c.w }, importance: 8, magnitude: Math.min(1, c.w / 10), stakes: 1, lastAt: c.lastAt,
      angles: ['what makes them so hard to beat', 'the fixture most likely to end it'], links: [teamLink(id)].filter(Boolean) });
    if (c.gp >= 4 && c.w === 0) story({ id: 'winless:' + id, kind: 'winless', kicker: 'Still waiting', head: name(id) + ' are still looking for a first win, ' + rec(0, c.l),
      dek: 'Their closest defeat was by ' + spell(Math.min(...c.games.map(x => x.against - x.for))) + '.', teams: [id], games: c.games.slice(-3).map(x => x.id),
      next: nextText(id) ? 'The next chance: ' + nextText(id) + '.' : null, tracks: { metric: 'l', value: c.l }, importance: 4.5, magnitude: Math.min(1, c.l / 10), stakes: 0.4, lastAt: c.lastAt,
      angles: ['where the first win could come from'], links: [teamLink(id)].filter(Boolean) });
  });

  /* ---- THE NUMBERS AND THE TABLE: a record their points do not support, and close games ---------------------- */
  C.forEach((c, id) => {
    if (c.gp < 6 || c.pyth == null) return;
    const exp = c.pyth * c.gp, luck = c.w - exp;
    if (Math.abs(luck) < 1.8) return;
    const lucky = luck > 0;
    story({
      id: 'luck:' + id, kind: 'luck', kicker: lucky ? 'Living on the edge' : 'Better than the record', head: lucky
        ? name(id) + ' are winning more than their points say they should'
        : name(id) + (c.w / Math.max(1, c.gp) >= 0.6 ? ' are even better than ' : ' are better than ') + rec(c.w, c.l),
      dek: 'Points for and against say about ' + spell(Math.round(exp)) + ' wins from ' + spell(c.gp) + ' games; they have ' + spell(c.w) + '.',
      /* the reason, from their own numbers: a side outscoring people should win more; a side barely outscored and losing
         the close ones has lost the wins at the end of games; a lucky one has been winning the close ones */
      why: lucky ? (c.diff < 0 ? 'They have been outscored by ' + one(-c.diff) + ' a game and still win; records built on close finishes tend to drift back towards the points.'
          : 'Records built on close finishes tend to drift back towards the points.')
        : c.diff > 0 ? 'They outscore opponents by ' + one(c.diff) + ' a game, and a side that does that usually gets the wins in the end.'
        : c.close.l >= 3 ? 'They have been outscored by only ' + one(-c.diff) + ' a game; ' + rec(c.close.w, c.close.l) + ' in games decided by five or fewer is where the wins went.'
        : 'They have been outscored by only ' + one(-c.diff) + ' a game, which is the record of a side nearer the middle.',
      numbers: [{ label: 'record', value: rec(c.w, c.l) }, { label: 'expected wins', value: one(exp) }, { label: 'points for, a game', value: one(c.ppg) }, { label: 'against', value: one(c.papg) },
        { label: 'in games decided by five or fewer', value: rec(c.close.w, c.close.l) }],
      counter: lucky ? 'Yes, but closing out tight games is a skill too: they are ' + rec(c.close.w, c.close.l) + ' in them.'
        : c.diff <= 0 ? 'Yes, but they have still been outscored over the season: better than the record is not the same as good.' : null,
      next: nextText(id) ? 'Next: ' + nextText(id) + '.' : null, teams: [id], tracks: { metric: 'luck', value: Math.round(luck * 2) / 2 },
      importance: 5.5, magnitude: Math.min(1, Math.abs(luck) / 4), stakes: 0.6, lastAt: c.lastAt, under: true,
      angles: ['a data piece: the record against the points', 'what the close games have in common'], links: [teamLink(id)].filter(Boolean)
    });
  });

  /* ---- WHAT WINS FOR THEM: the facet that separates a club's wins from its losses (What Wins, per game), measured
     against the league's usual split. Shooting separates every club's good nights from its bad ones, so "X win and lose
     on shooting" is true of everybody and news about nobody: a club is a story when one facet swings its results by
     well over what it does for the typical club here. ------------------------------------------------------------ */
  const usual = {};
  ['efg', 'tovp', 'orebp', 'ftr'].forEach(k => {
    const xs = [...ID.values()].map(x => (x.all.find(f => f.k === k) || {}).gap).filter(v => v != null && isFinite(v));
    usual[k] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  });
  const usualTop = Object.keys(usual).sort((a, b) => usual[b] - usual[a])[0];
  const DISTINCT = new Map();
  ID.forEach((x, id) => {
    const c = C.get(id);
    if (!c || c.gp < 6) return;
    const top = x.all.map(f => Object.assign({}, f, { excess: f.gap - (usual[f.k] || 0) })).sort((a, b) => b.excess - a.excess)[0];
    if (!top || top.excess < 3 || top.gap < 4) return;
    DISTINCT.set(id, top);
    const same = top.k === usualTop;
    story({
      id: 'identity:' + id, kind: 'identity', kicker: 'What wins for them',
      head: same ? name(id) + ' live and die by ' + FACET[top.k] + ', even for this league' : name(id) + ' win and lose on ' + FACET[top.k],
      dek: 'In their wins ' + FACET[top.k] + ' has been worth ' + signed(top.win) + ' points a game to them; in their defeats, ' + signed(top.loss) + '.',
      why: same ? 'Every club here rises and falls with ' + FACET[top.k] + '; for ' + name(id) + ' the swing between wins and defeats is ' + one(top.gap) + ' points a game, against ' + one(usual[top.k]) + ' for a typical club.'
        : 'Most clubs here rise and fall with ' + FACET[usualTop] + '; ' + possOf(name(id)) + ' results turn on ' + FACET[top.k] + ', a swing of ' + one(top.gap) + ' points a game between their wins and their defeats, against ' + one(usual[top.k]) + ' for a typical club.',
      numbers: x.all.map(f => ({ label: FACET[f.k], value: signed(f.win) + ' / ' + signed(f.loss), note: 'in wins / in defeats' })),
      next: whenNext(id) ? 'Watch it next ' + whenNext(id) + '.' : null, teams: [id], tracks: { metric: 'facet', value: top.k },
      importance: same ? 4.5 : 5.5, magnitude: Math.min(1, top.excess / 8), stakes: 0.5, lastAt: c.lastAt, evergreen: true,
      angles: ['a data piece: the one number to watch in their games', 'a coach’s-eye preview built on it'], links: [teamLink(id)].filter(Boolean)
    });
  });

  /* ---- THE PLAYERS: on a tear, a run of 20-point nights, the season's best nights, a milestone in reach ------ */
  const recent = nowMs - 10 * DAY;
  /* the league's scorers in order (a real sample: half the most games played), for "the league's top scorer" */
  const scorers = [...PL.values()].filter(p => p.gp >= Math.max(3, Math.ceil(maxGp / 2)) && pname(p.pid)).sort((a, b) => b.ppg - a.ppg);
  /* a club's points in a game, from its own end (every competition) */
  const clubPts = (team, gid) => { const c = CA.get(team); const x = c ? c.games.find(y => y.id === gid) : null; return x ? x.for : null; };
  PL.forEach((p, pid) => {
    const nm = pname(pid);
    if (!nm || p.gp < 4) return;
    const club = p.team ? name(p.team) : null;
    const cl = club ? ' for ' + club : '';
    if (p.run20 >= 3) {
      const all = p.run20 === p.gp;
      const run = p.games.slice(-p.run20);
      const runPts = run.reduce((s, x) => s + x.pts, 0), runAvg = runPts / run.length;
      const teamPts = run.map(x => (p.team ? clubPts(p.team, x.game) : null));
      const share = teamPts.every(v => v > 0) ? runPts / teamPts.reduce((a, b) => a + b, 0) : null;
      const top = scorers[0] && scorers[0].pid === pid;
      /* why it matters, from the run's own numbers: the league's top scorer, a club leaning on one player, else the form */
      const why = top ? 'The league’s top scorer, at ' + one(p.ppg) + ' a game, and nobody has found an answer yet.'
        : share != null && share >= 0.28 ? 'Over the run, ' + nm + ' has scored ' + Math.round(100 * share) + '% of ' + possOf(club) + ' points.'
        : 'Nobody guards a scorer in this kind of form with one player.';
      story({ id: 'scoring:' + pid, kind: 'scoring', kicker: 'On a tear',
        head: nm + ' has scored 20 or more in ' + (all ? 'all ' + spell(p.gp) + ' games this season' : spell(p.run20) + ' straight games'),
        dek: all ? one(p.ppg) + ' points a game' + cl + ', with a high of ' + p.high.pts.pts + '.'
          : one(runAvg) + ' points a game over the run' + cl + ', against ' + one(p.ppg) + ' for the season.',
        why,
        numbers: [{ label: 'run', value: String(p.run20) }, all ? null : { label: 'in the run', value: one(runAvg) + ' ppg' }, { label: 'season', value: one(p.ppg) + ' ppg' },
          { label: 'season high', value: String(p.high.pts.pts) }, share != null ? { label: 'share of the club’s points in the run', value: Math.round(100 * share) + '%' } : null],
        next: p.team && whenNext(p.team) ? 'The run goes on the line ' + whenNext(p.team) + '.' : null,
        teams: p.team ? [p.team] : [], players: [pid], games: run.map(x => x.game), tracks: { metric: 'run20', value: p.run20 },
        importance: 6 + Math.min(2, p.run20 / 3), magnitude: Math.min(1, p.run20 / 8), stakes: 0.6, lastAt: p.lastAt,
        angles: ['a player feature', 'a shot chart and a clip from each of the games'], links: [playerLink(pid), teamLink(p.team)].filter(Boolean) });
    } else if (p.gp >= 8 && p.last5ppg != null && p.prev5ppg != null && p.last5ppg - p.prev5ppg >= 6 && p.last5ppg >= 14 && p.lastAt >= recent) {
      const mins = xs => xs.reduce((s, x) => s + x.min, 0) / Math.max(1, xs.length);
      const m5 = mins(p.games.slice(-5)), m0 = mins(p.games.slice(0, -5));
      story({ id: 'form:' + pid, kind: 'form', kicker: 'In form', head: nm + ' is scoring ' + one(p.last5ppg) + ' a game over the last five' + cl,
        dek: 'Up from ' + one(p.prev5ppg) + ' before that.',
        /* minutes or more from the same minutes: the two reasons a scoring jump has, and the box can tell them apart */
        why: m5 - m0 >= 4 ? 'The minutes explain most of it: up from ' + one(m0) + ' to ' + one(m5) + ' a game.'
          : 'Much the same minutes (' + one(m5) + ' a game against ' + one(m0) + '), many more points: the shots are falling, or the role has changed.',
        numbers: [{ label: 'last five', value: one(p.last5ppg) + ' ppg' }, { label: 'before', value: one(p.prev5ppg) + ' ppg' }, { label: 'minutes', value: one(m5) + ' (was ' + one(m0) + ')' }],
        teams: p.team ? [p.team] : [], players: [pid], games: p.games.slice(-5).map(x => x.game), tracks: { metric: 'last5', value: Math.round(p.last5ppg) },
        importance: 5, magnitude: Math.min(1, (p.last5ppg - p.prev5ppg) / 12), stakes: 0.5, lastAt: p.lastAt, under: true,
        angles: [m5 - m0 >= 4 ? 'what changed: the minutes, and why the coach is giving them' : 'what changed: the role and the shots'], links: [playerLink(pid)].filter(Boolean) });
    }
    /* A MILESTONE IN REACH, only when it means something: a big round number (500 and up) or the first player in the
       league to reach it this season. 300 points at fifteen a game is everybody's December, not news. */
    const next = Math.floor(p.pts / 100) * 100 + 100, need = next - p.pts;
    const firstTo = ![...PL.values()].some(q => q !== p && q.pts >= next);
    if (p.pts >= 180 && (next >= 500 || firstTo) && need <= Math.max(8, Math.round(p.ppg * 0.9)) && p.team && nextOf(p.team)) {
      story({ id: 'milestone:' + pid + ':' + next, kind: 'milestone', kicker: 'Milestone watch', head: nm + ' is ' + spell(need) + ' points from ' + next + ' this season',
        dek: (firstTo ? 'Nobody in the league has reached ' + next + ' yet. ' : '') + one(p.ppg) + ' a game' + cl + '; ' + plural(p.gp, 'game') + ' so far.',
        next: 'It could come ' + whenNext(p.team) + '.',
        teams: [p.team], players: [pid], tracks: { metric: 'need', value: need }, importance: firstTo ? 4 : 3.5, magnitude: Math.min(1, next / 1000), stakes: 0.3, lastAt: p.lastAt,
        angles: ['a social post ready for the night it happens'], links: [playerLink(pid)].filter(Boolean) });
    }
  });

  /* ---- WHO IS MISSING: a rotation player (twenty minutes a game over three or more) who has not played in the club's
     last two games or more. Said as what the box scores show - not playing - never as a reason nobody has given. ---- */
  PL.forEach((p, pid) => {
    const nm = pname(pid);
    if (!nm || p.gp < 3 || p.mpg < 20 || !p.team) return;
    /* a player the club has said has gone is not "not playing": they have left (player_releases) */
    if (gone.has(p.team + '|' + pid)) return;
    const c = CA.get(p.team);
    if (!c) return;
    /* news while it is fresh: two to four games missed (by five, the club has moved on and so has the story) */
    const after = c.games.filter(x => x.at > p.lastAt);
    if (after.length < 2 || after.length > 4) return;
    const res = after.filter(x => !x.tied);
    const w = res.filter(x => x.won).length;
    story({ id: 'absence:' + pid, kind: 'absence', kicker: 'Not playing', head: nm + ' has not played in ' + possOf(name(p.team)) + ' last ' + spell(after.length) + ' games',
      dek: 'Before that: ' + one(p.mpg) + ' minutes and ' + one(p.ppg) + ' points a game. ' + name(p.team) + ' are ' + rec(w, res.length - w) + ' without them.',
      why: 'A player taking this many minutes is a big part of how a side plays; how they cope without them is the story.',
      numbers: [{ label: 'games missed', value: String(after.length) }, { label: 'minutes before', value: one(p.mpg) }, { label: 'points before', value: one(p.ppg) },
        { label: 'record without', value: rec(w, res.length - w) }],
      counter: null, next: nextText(p.team) ? 'Next: ' + nextText(p.team) + '.' : null,
      teams: [p.team], players: [pid], games: after.map(x => x.id), tracks: { metric: 'missed', value: after.length },
      importance: 4.5 + Math.min(1.5, p.mpg / 20), magnitude: Math.min(1, after.length / 4), stakes: 0.5, lastAt: c.lastAt,
      angles: ['how the rotation has changed without them'], links: [playerLink(pid), teamLink(p.team)].filter(Boolean) });
  });

  /* ---- THE BEST PLAYER BY THE NUMBERS, AND THE ONE NOBODY TALKS ABOUT (the season lines' box plus-minus) ------- */
  /* a real sample: half the games and twenty minutes a night (a few games of a bench role give BPMs of +20) */
  const lines0 = (o.players || []).filter(r => r && r.id && num(r.bpm) != null && num(r.gp) >= Math.max(4, Math.ceil(maxGp * 0.5)) && num(r.mpg) >= 20 && pname(r.id));
  if (lines0.length >= 8) {
    const byBpm = lines0.slice().sort((a, b) => b.bpm - a.bpm), byPts = lines0.slice().sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
    const top = byBpm[0], club = PL.get(top.id) ? PL.get(top.id).team : null;
    story({ id: 'bpm:' + top.id, kind: 'bpm', kicker: 'The best player, by the numbers', head: pname(top.id) + ' leads the league in box plus-minus',
      dek: signed(top.bpm) + ' BPM on ' + one(top.ppg) + ' points, ' + one(top.rpg) + ' rebounds and ' + one(top.apg) + ' assists a game' + (club ? ' for ' + name(club) : '') + '.',
      why: 'Box plus-minus counts everything in the box score against what a player’s minutes are worth; it is the closest thing the box has to a player’s value.',
      numbers: [{ label: 'BPM', value: signed(top.bpm) }, { label: 'points', value: one(top.ppg) }, { label: 'minutes', value: one(top.mpg) },
        byBpm[1] ? { label: 'next best', value: pname(byBpm[1].id) + ' ' + signed(byBpm[1].bpm) } : null],
      teams: club ? [club] : [], players: [top.id], tracks: { metric: 'bpm', value: top.id }, importance: 5, magnitude: Math.min(1, top.bpm / 12), stakes: 0.5,
      lastAt: PL.get(top.id) ? PL.get(top.id).lastAt : nowMs - DAY, evergreen: true,
      angles: ['a player profile built on the whole line, not the points', 'a "most valuable so far" ranking'], links: [playerLink(top.id)].filter(Boolean) });
    /* in the top five by BPM and outside the top fifteen scorers: the quiet one */
    const quiet = byBpm.slice(0, 5).find(r => byPts.indexOf(r) >= 15 && r.id !== top.id);
    if (quiet) {
      const qc = PL.get(quiet.id) ? PL.get(quiet.id).team : null;
      story({ id: 'quiet:' + quiet.id, kind: 'quiet', kicker: 'Under the radar', head: pname(quiet.id) + ' is one of the league’s best players on ' + one(quiet.ppg) + ' points a game',
        dek: signed(quiet.bpm) + ' BPM, ' + ordShort(byBpm.indexOf(quiet) + 1) + ' in the league, ' + ordShort(byPts.indexOf(quiet) + 1) + ' in scoring' + (qc ? ', for ' + name(qc) : '') + '.',
        why: 'Points get noticed; the rest of a good night rarely does.',
        numbers: [{ label: 'BPM', value: signed(quiet.bpm) }, { label: 'points', value: one(quiet.ppg) }, { label: 'rebounds', value: one(quiet.rpg) }, { label: 'assists', value: one(quiet.apg) }],
        teams: qc ? [qc] : [], players: [quiet.id], tracks: { metric: 'quiet', value: quiet.id }, importance: 4.5, magnitude: 0.6, stakes: 0.4,
        lastAt: PL.get(quiet.id) ? PL.get(quiet.id).lastAt : nowMs - DAY, evergreen: true, under: true,
        angles: ['a feature: what they do that the scoring column misses'], links: [playerLink(quiet.id)].filter(Boolean) });
    }
  }

  /* ---- THE FOOT OF THE TABLE ------------------------------------------------------------------------------- */
  if (S.size === 1 && maxGp >= 6 && !over) {
    const rows = [...S.values()][0].filter(r => r.gp > 0);
    if (rows.length >= 6) {
      const last = rows[rows.length - 1], above = rows[rows.length - 2], gap = gb(above, last);
      const cl = C.get(last.team_id);
      story({ id: 'foot', kind: 'foot', kicker: 'The foot of the table', head: name(last.team_id) + ' are bottom at ' + rec(last.w, last.l) + (gap > 0 ? ', ' + gamesWord(gap) + ' behind ' + name(above.team_id) : ', level with ' + name(above.team_id)),
        dek: cl && cl.last5.length ? 'Their last five: ' + cl.last5.join(' ') + '.' : null,
        next: nextText(last.team_id) ? 'Next: ' + nextText(last.team_id) + '.' : null, teams: [last.team_id, above.team_id],
        tracks: { metric: 'gap', value: gap }, importance: 4, magnitude: Math.min(1, gap / 3 + 0.2), stakes: 0.5, lastAt: cl ? cl.lastAt : null,
        angles: ['where the points could come from: the fixtures ahead'], links: [teamLink(last.team_id)].filter(Boolean) });
    }
  }

  /* ---- THE SEASON'S BEST NIGHTS: the single-game highs, and whether they were set this week ------------------ */
  /* one storyline for the week's new season bests (points, rebounds, assists, threes), led by the biggest; a best that
     several players share is said as shared */
  const highs = [['pts', 'points'], ['reb', 'rebounds'], ['ast', 'assists'], ['p3m', 'threes']].map(([k, w]) => {
    let best = null, shared = 0;
    PL.forEach((p, pid) => { const h = p.high[k]; if (!h) return; if (!best || h[k] > best.x[k]) { best = { pid, x: h, p }; shared = 1; } else if (h[k] === best.x[k]) shared++; });
    return best && pname(best.pid) && best.x[k] > 0 ? { k, w, best, shared } : null;
  }).filter(Boolean);
  const fresh = highs.filter(h => h.best.x.at >= nowMs - 7 * DAY && maxGp >= 2);
  if (fresh.length) {
    const lead = fresh[0], x = lead.best.x, nm = pname(lead.best.pid);
    const v = x[lead.k];
    story({ id: 'bests', kind: 'best', kicker: 'Season bests', head: nm + '’s ' + spell(v) + ' ' + lead.w + (lead.shared > 1 ? ' equal the most in a game this season' : ' are the most in a game this season'),
      dek: x.team ? 'For ' + name(x.team) + ', ' + dayWords(new Date(x.at).toISOString(), tz) + '.' : null,
      why: 'Every other night this season is measured against these now.',
      numbers: fresh.map(h => ({ label: h.w, value: h.best.x[h.k] + ' — ' + pname(h.best.pid) + (h.shared > 1 ? ' (shared)' : '') })),
      teams: [...new Set(fresh.map(h => h.best.x.team).filter(Boolean))], players: fresh.map(h => h.best.pid), games: fresh.map(h => h.best.x.game),
      tracks: { metric: 'bests', value: fresh.map(h => h.k + h.best.x[h.k]).join(',') }, importance: 5, magnitude: 0.5 + 0.1 * fresh.length, stakes: 0.35,
      lastAt: Math.max(...fresh.map(h => h.best.x.at)),
      angles: ['the night, in the play-by-play', 'a graphic of each line'], links: [playerLink(lead.best.pid), gameLink(x.game)].filter(Boolean) });
  }

  /* ---- THE GAME OF THE WEEK: the recap the match report engine rated most worth reading -------------------- */
  const ARC_WORDS = { heist: 'stolen in the last five minutes', collapse: 'a big lead thrown away', comeback: 'a comeback', overtime: 'it went to overtime',
    seesaw: 'the lead changed hands again and again', heldOn: 'a lead nearly given away', tight: 'decided by a single score' };
  /* the same score the coverage plan ranks the week's recaps by, so the game of the week is the plan's first recap */
  const gw = games.filter(g => time(g.tipoff_at) >= nowMs - 7 * DAY && recaps[g.id] && recaps[g.id].headline)
    .map(g => ({ g, r: recaps[g.id], s: recapScore(g, recaps[g.id], posOf, SIG[g.id]) })).sort((a, b) => b.s - a.s || time(b.g.tipoff_at) - time(a.g.tipoff_at))[0];
  if (gw && gw.s >= 2.5) {
    story({ id: 'gotw:' + gw.g.id, kind: 'gotw', kicker: 'Game of the week', head: gw.r.headline, dek: gw.r.standfirst || null,
      why: [ARC_WORDS[gw.r.arc] ? cap(ARC_WORDS[gw.r.arc]) + '.' : null,
        gw.r.moment ? gw.r.moment.name + (gw.r.moment.kind === 'gameWinner' ? ' won it at the death.' : ' put them ahead for good late on.') : null].filter(Boolean).join(' ') || null,
      numbers: (gw.r.decisive ? [{ label: 'what decided it', value: gw.r.decisive.label + ', about ' + Math.round(gw.r.decisive.pts) + ' points' }] : [])
        .concat(SIG[gw.g.id] && SIG[gw.g.id].reasons.length ? [{ label: 'what made it stand out', value: SIG[gw.g.id].reasons.join('; ') }] : []),
      teams: [gw.g.home_team_id, gw.g.away_team_id], games: [gw.g.id], tracks: { metric: 'game', value: gw.g.id }, importance: 6, magnitude: Math.min(1, gw.s / 6), stakes: 0.5,
      lastAt: time(gw.g.tipoff_at), angles: ['the recap, rewritten as a feature with the moments in it', VID[gw.g.id] ? 'the highlights, cut around the finish' : 'a clip of the finish'],
      links: [gameLink(gw.g.id), videoLink(gw.g.id)].filter(Boolean) });
  }

  const winnerOf = g => (+g.home_score > +g.away_score ? g.home_team_id : g.away_team_id);
  const loserOf = g => (winnerOf(g) === g.home_team_id ? g.away_team_id : g.home_team_id);
  const scoreOf = g => Math.max(+g.home_score, +g.away_score) + '–' + Math.min(+g.home_score, +g.away_score);
  const weekday = iso => dayWords(iso, tz, { day: undefined, month: undefined });
  /* the run a club was on going into a game (its regular-season results before it): "ended their run of five" */
  const runBefore = (id, g) => {
    const c = C.get(id);
    if (!c) return null;
    const xs = c.games.filter(x => x.at < time(g.tipoff_at) && !x.tied);
    if (!xs.length) return null;
    const won = xs[xs.length - 1].won;
    let n = 0;
    for (let i = xs.length - 1; i >= 0 && xs[i].won === won; i--) n++;
    return { won, n };
  };

  /* ---- THE SAME TWO, TWICE IN A FEW DAYS (a weekend series, as several leagues play them): one storyline, a sweep
     or a split - not two upsets and a game of the week about the same pair ------------------------------------ */
  const paired = new Set();
  const lastWeek = regular.filter(g => time(g.tipoff_at) >= nowMs - 7 * DAY && +g.home_score !== +g.away_score);
  const pairKey = g => [g.home_team_id, g.away_team_id].sort().join('|');
  lastWeek.forEach((g1, i) => {
    if (paired.has(g1.id)) return;
    const g2 = lastWeek.slice(i + 1).find(h => !paired.has(h.id) && pairKey(h) === pairKey(g1) && time(h.tipoff_at) - time(g1.tipoff_at) <= 3 * DAY);
    if (!g2) return;
    paired.add(g1.id); paired.add(g2.id);
    const r1 = recaps[g1.id] || null, r2 = recaps[g2.id] || null;
    const w1 = winnerOf(g1), w2 = winnerOf(g2);
    const ids = [g1.home_team_id, g1.away_team_id];
    if (w1 === w2) {
      const w = w1, l = loserOf(g1), pw = posOf.get(w), pl = posOf.get(l);
      const below = pw && pl && pw.pos > pl.pos ? pw.pos - pl.pos : 0;
      story({ id: 'sweep:' + g2.id, kind: 'sweep', kicker: 'The sweep', head: name(w) + ' sweep ' + name(l),
        dek: 'Wins of ' + scoreOf(g1) + ' on ' + weekday(g1.tipoff_at) + ' and ' + scoreOf(g2) + ' on ' + weekday(g2.tipoff_at) + '.' +
          (pw && pl ? ' ' + name(w) + ' are ' + place(pw.pos) + ', ' + name(l) + ' ' + place(pl.pos) + '.' : ''),
        why: below >= 3 ? 'Two wins over a side ' + spell(below) + ' places above them in the table.'
          : 'Two games against the same side in a few days test the adjustments, and only one side made them.',
        numbers: [{ label: 'the two games', value: scoreOf(g1) + ', ' + scoreOf(g2) }].concat(r2 && r2.decisive ? [{ label: 'what decided the second', value: r2.decisive.label + ', about ' + Math.round(r2.decisive.pts) + ' points' }] : []),
        next: nextText(l) ? 'Next for ' + name(l) + ': ' + nextText(l) + '.' : null,
        teams: [w, l], games: [g1.id, g2.id], tracks: { metric: 'pair', value: g2.id }, importance: 5 + Math.min(2, below / 3), magnitude: Math.min(1, 0.4 + below / 10), stakes: 0.6,
        lastAt: time(g2.tipoff_at), angles: ['the two games as one story: what the losers changed, and why it did not work'], links: [gameLink(g1.id), gameLink(g2.id)] });
    } else {
      /* a split is news when the second game turned the first round, or either had a finish */
      const m1 = Math.abs(g1.home_score - g1.away_score), m2 = Math.abs(g2.home_score - g2.away_score);
      const finish = [r1, r2].find(r => r && r.moment && r.moment.kind === 'gameWinner');
      if (m1 + m2 < 15 && !finish) return;
      story({ id: 'split:' + g2.id, kind: 'split', kicker: 'The split', head: name(ids[0]) + ' and ' + name(ids[1]) + ' split their two games',
        dek: name(w1) + ' won ' + scoreOf(g1) + ' on ' + weekday(g1.tipoff_at) + '; ' + name(w2) + ' answered ' + scoreOf(g2) + ' on ' + weekday(g2.tipoff_at) + '.',
        why: finish ? finish.moment.name + ' won one of them at the death.' : name(w2) + ' turned a ' + spell(m1) + '-point defeat into a ' + spell(m2) + '-point win.',
        numbers: [{ label: 'the two games', value: scoreOf(g1) + ', ' + scoreOf(g2) }],
        teams: ids, games: [g1.id, g2.id], tracks: { metric: 'pair', value: g2.id }, importance: 4.5, magnitude: Math.min(1, (m1 + m2) / 30), stakes: 0.5,
        lastAt: time(g2.tipoff_at), angles: ['what changed between the two games'], links: [gameLink(g1.id), gameLink(g2.id)] });
    }
  });

  /* ---- THE UPSETS: by the season's numbers before the tip (the match report's own reading of the game in its season),
     else, once both sides have six games, by four places in the table ---------------------------------------- */
  regular.filter(g => time(g.tipoff_at) >= nowMs - 7 * DAY && !paired.has(g.id) && +g.home_score !== +g.away_score).forEach(g => {
    const w = winnerOf(g), l = loserOf(g);
    const pw = posOf.get(w), pl = posOf.get(l), r = recaps[g.id] || null;
    const gap = pw && pl ? pw.pos - pl.pos : 0;
    const cw = C.get(w), cl = C.get(l);
    if (!cw || !cl || cw.gp < 4 || cl.gp < 4) return;
    /* the winner's expected margin before the tip (the recap carries the home side's) */
    const exW = r && num(r.expect) != null ? (w === g.home_team_id ? +r.expect : -r.expect) : null;
    const byNumbers = exW != null && exW <= -3;
    const byTable = exW == null && gap >= 4 && Math.min(cw.gp, cl.gp) >= 6;
    if (!byNumbers && !byTable) return;
    const ended = runBefore(l, g);
    const why = ended && ended.won && ended.n >= 3 ? 'It ended ' + possOf(name(l)) + ' run of ' + spell(ended.n) + ' straight wins.'
      : byNumbers && exW <= -8 ? 'The season’s numbers made ' + name(l) + ' clear favourites, by about ' + spell(Math.round(-exW)) + ' points.'
      : gap >= 6 ? cap(spell(gap)) + ' places separate them in the table.'
      : 'Results like this are where tables get rearranged.';
    story({ id: 'upset:' + g.id, kind: 'upset', kicker: 'Upset', head: r && r.headline ? r.headline
        : name(w) + (pw ? ', ' + ordShort(pw.pos) + ',' : '') + ' beat ' + name(l) + (pl ? ', ' + ordShort(pl.pos) + ',' : '') + ' ' + scoreOf(g),
      dek: (pw && pl ? name(w) + ' (' + ordShort(pw.pos) + ') beat ' + name(l) + ' (' + ordShort(pl.pos) + ').' : name(w) + ' beat ' + name(l) + ' ' + scoreOf(g) + '.') +
        (byNumbers ? ' The season’s numbers had ' + name(l) + ' by about ' + spell(Math.round(-exW)) + ' before the tip.' : '') +
        (r && r.decisive ? ' ' + cap(r.decisive.label) + ' ' + wasWere(r.decisive.label) + ' worth about ' + Math.round(r.decisive.pts) + ' points to them.' : ''),
      why, teams: [w, l], games: [g.id], tracks: { metric: 'game', value: g.id },
      importance: 6 + Math.min(2, byNumbers ? -exW / 5 : gap / 4), magnitude: Math.min(1, byNumbers ? -exW / 10 : gap / 8), stakes: 0.7, lastAt: time(g.tipoff_at),
      angles: ['the recap', 'what the winners did that nobody expected'], links: [gameLink(g.id)] });
  });

  /* ---- THE PLAY-OFFS: every series, from the play-off competition's games and fixtures. Who leads, where the next game
     is, the seeds, the regular-season meetings and the facet the matchup turns on. A series is "through" only when the
     winner has a later play-off game against somebody else: the format's length is never assumed. ----------------- */
  const SERIES = new Map();
  if (post.length || postFix.length) {
    post.concat(postFix).forEach(g => { const k = pairKey(g); if (!SERIES.has(k)) SERIES.set(k, { key: k, ids: k.split('|'), games: [], next: null }); });
    post.forEach(g => SERIES.get(pairKey(g)).games.push(g));
    postFix.forEach(g => { const s = SERIES.get(pairKey(g)); if (!s.next || time(g.tipoff_at) < time(s.next.tipoff_at)) s.next = g; });
    const laterElse = (id, k, after) => post.concat(postFix).some(g => (g.home_team_id === id || g.away_team_id === id) && pairKey(g) !== k && time(g.tipoff_at) > after);
    /* THE BRACKET, where the league keeps one (bracket_ties): a tie's legs and decider. 'wins' with legs N is a best of N
       (first to ceil(N/2)); 'aggregate' is two legs on points, and then wins mean nothing: a 1-1 tie is decided by the
       aggregate. A pair with no tie in a competition whose ties are aggregate is read as one too. */
    const TIES = new Map(), aggComps = new Set();
    (o.ties || []).forEach(t => {
      if (!t || !t.home_team_id || !t.away_team_id) return;
      TIES.set([t.home_team_id, t.away_team_id].sort().join('|'), t);
      if (t.decider === 'aggregate' && t.competition_id) aggComps.add(t.competition_id);
    });
    const compName = new Map((o.comps || []).filter(c => c && c.id).map(c => [c.id, c.name || null]));
    /* the seeds mean something only when the regular season came first (a qualifying round before it has none) */
    const lastReg = regular.length ? time(regular[regular.length - 1].tipoff_at) : null;
    const aggregateTie = (s, tie, comp) => {
      const [a, b] = s.ids, agg = { [a]: 0, [b]: 0 };
      s.games.forEach(g => { agg[g.home_team_id] = (agg[g.home_team_id] || 0) + (+g.home_score); agg[g.away_team_id] = (agg[g.away_team_id] || 0) + (+g.away_score); });
      const legs = tie && +tie.legs > 0 ? +tie.legs : 2;
      const n = s.games.length, last = n ? s.games[n - 1] : null;
      const label = (tie && tie.label) || (comp && compName.get(comp)) || null;
      const winner = tie && tie.winner_team_id ? tie.winner_team_id : n >= legs ? (agg[a] > agg[b] ? a : agg[b] > agg[a] ? b : null) : null;
      const legWord = i => (legs === 2 ? (i === 0 ? 'first leg' : 'second leg') : 'leg ' + (i + 1));
      const legLine = s.games.map((g, i) => (i ? legWord(i) : cap(legWord(i))) + ': ' + name(g.home_team_id) + ' ' + g.home_score + '–' + g.away_score + ' ' + name(g.away_team_id)).join('; ');
      let head, why, next = null;
      s.hi = a; s.lo = b; s.n = n; s.agg = agg; s.through = null; s.label = label;
      if (winner && n) {
        const loser = winner === a ? b : a, d = agg[winner] - agg[loser];
        const lostLeg = s.games.find(g => +g.home_score !== +g.away_score && winnerOf(g) === loser);
        head = name(winner) + ' go through on aggregate, ' + agg[winner] + '–' + agg[loser];
        why = d <= 3 ? 'Decided by ' + plural(d, 'point') + ' over ' + spell(n) + ' legs.'
          : lostLeg ? name(loser) + ' won the ' + legWord(s.games.indexOf(lostLeg)) + ' by ' + spell(Math.abs(lostLeg.home_score - lostLeg.away_score)) + ' and still went out.'
          : name(winner) + ' won ' + (n === 2 ? 'both legs' : 'every leg') + '.';
        s.status = name(winner) + ' through on aggregate against ' + name(loser) + ', ' + agg[winner] + '–' + agg[loser];
        s.through = winner;
      } else if (n) {
        const lead = agg[a] > agg[b] ? a : agg[b] > agg[a] ? b : null, d = Math.abs(agg[a] - agg[b]);
        head = lead ? name(lead) + ' take a ' + spell(d) + '-point lead into the ' + legWord(n) + ' against ' + name(lead === a ? b : a)
          : name(a) + ' and ' + name(b) + ' are level after the ' + legWord(n - 1);
        why = 'Decided on aggregate: a lead of ' + plural(d, 'point') + ' is ' + (d >= 15 ? 'close to decisive' : d >= 8 ? 'a cushion, not a certainty' : 'next to nothing') + ' with a leg to play.';
        next = s.next ? cap(legWord(n)) + ': ' + dayWords(s.next.tipoff_at, tz) + ', with ' + name(s.next.home_team_id) + ' at home.' : null;
        s.status = lead ? name(lead) + ' lead ' + name(lead === a ? b : a) + ' by ' + d + ' on aggregate' : name(a) + ' and ' + name(b) + ' level on aggregate';
      } else {
        head = name(s.next.home_team_id) + ' v ' + name(s.next.away_team_id) + ': the ' + legWord(0) + ' is on ' + (dayWords(s.next.tipoff_at, tz) || 'its way');
        why = 'Two legs, decided on aggregate.';
        s.status = name(a) + ' v ' + name(b) + ' to start';
      }
      story({ id: 'series:' + s.key, kind: 'series', kicker: label || 'The knockout', head, dek: n ? legLine + '.' : null, why, next,
        numbers: n ? [(() => { const x = s.through || (agg[b] > agg[a] ? b : a), y = x === a ? b : a; return { label: 'aggregate', value: name(x) + ' ' + agg[x] + '–' + agg[y] + ' ' + name(y) }; })()] : [],
        teams: [a, b], games: s.games.map(g => g.id).concat(s.next ? [s.next.id] : []), tracks: { metric: 'tie', value: agg[a] + '-' + agg[b] },
        importance: winner ? 6 : 8.5, magnitude: Math.min(1, 0.5 + 0.15 * n), stakes: 1, lastAt: last ? time(last.tipoff_at) : nowMs - 12 * HOUR,
        angles: winner ? ['how the tie was won, leg by leg'] : ['a preview of the next leg: what the side behind has to change'],
        links: [last ? gameLink(last.id) : null, last ? videoLink(last.id) : null, s.next ? gameLink(s.next.id) : null].filter(Boolean) });
    };
    SERIES.forEach(s => {
      const [a, b] = s.ids, pa = posOf.get(a), pb = posOf.get(b);
      const first = s.games[0] || s.next, comp = first ? first.competition_id : null, tie = TIES.get(s.key) || null;
      if ((tie && tie.decider === 'aggregate') || (!tie && comp && aggComps.has(comp))) { aggregateTie(s, tie, comp); return; }
      const wins = { [a]: 0, [b]: 0 };
      s.games.forEach(g => { if (+g.home_score !== +g.away_score) wins[winnerOf(g)]++; });
      /* the higher seed first, by the regular season's table */
      const hi = pa && pb ? (pa.pos <= pb.pos ? a : b) : a, lo = hi === a ? b : a;
      const seedsOk = !!(lastReg != null && first && time(first.tipoff_at) >= lastReg - DAY && pa && pb && pa.gp >= 3 && pb.gp >= 3);
      const ph = seedsOk ? posOf.get(hi) : null, pl0 = seedsOk ? posOf.get(lo) : null;
      const n = s.games.length, last = n ? s.games[n - 1] : null;
      /* a best of N from the bracket: first to ceil(N/2); else through only on a later play-off game against somebody else */
      const need = tie && tie.decider === 'wins' && +tie.legs > 1 ? Math.ceil(+tie.legs / 2) : null;
      const through = need && (wins[hi] >= need || wins[lo] >= need) ? (wins[hi] >= need ? hi : lo)
        : last ? (laterElse(hi, s.key, time(last.tipoff_at)) ? hi : laterElse(lo, s.key, time(last.tipoff_at)) ? lo : null) : null;
      const leader = wins[hi] > wins[lo] ? hi : wins[lo] > wins[hi] ? lo : null;
      const trail = leader ? (leader === hi ? lo : hi) : null;
      const tally = leader ? Math.max(wins[hi], wins[lo]) + '–' + Math.min(wins[hi], wins[lo]) : wins[hi] + '–' + wins[lo];
      s.hi = hi; s.lo = lo; s.wins = wins; s.n = n; s.leader = leader; s.through = through;
      s.status = through ? name(through) + ' through against ' + name(through === hi ? lo : hi) + ', ' + Math.max(wins[hi], wins[lo]) + '–' + Math.min(wins[hi], wins[lo])
        : !n ? name(hi) + ' v ' + name(lo) + ' to start'
        : leader ? name(leader) + ' lead ' + name(trail) + ' ' + tally : name(hi) + ' and ' + name(lo) + ' level at ' + tally;
      const head = through ? name(through) + ' are through, ' + Math.max(wins[hi], wins[lo]) + '–' + Math.min(wins[hi], wins[lo]) + ' against ' + name(through === hi ? lo : hi)
        : !n ? name(hi) + ' v ' + name(lo) + ': the series starts ' + (dayWords(s.next.tipoff_at, tz) || 'soon')
        : leader && n === 1 ? name(leader) + ' take Game 1 against ' + name(trail)
        : leader ? name(leader) + ' lead ' + name(trail) + ' ' + tally : name(hi) + ' and ' + name(lo) + ' are level at ' + tally;
      const wl = last ? winnerOf(last) : null;
      const seeds = ph && pl0 ? name(hi) + ' finished ' + place(ph.pos) + ' in the regular season, ' + name(lo) + ' ' + place(pl0.pos) + '.' : null;
      /* the regular-season meetings, and the facet the season's numbers say the matchup turns on */
      const met = regular.filter(g => pairKey(g) === s.key && +g.home_score !== +g.away_score);
      const metHi = met.filter(g => winnerOf(g) === hi).length;
      const venue = s.next || last;
      const ex = venue ? expect(P, venue.home_team_id, venue.away_team_id, o.model) : null;
      let turn = null;
      if (ex) { const k = Object.keys(ex.parts).sort((x, y) => Math.abs(ex.parts[y].pts) - Math.abs(ex.parts[x].pts))[0]; if (Math.abs(ex.parts[k].pts) >= 1) turn = { k, side: ex.parts[k].pts > 0 ? venue.home_team_id : venue.away_team_id, pts: Math.abs(ex.parts[k].pts) }; }
      const lowLeads = leader === lo && ph && pl0 && pl0.pos - ph.pos >= 2;
      const lastM = last ? Math.abs(last.home_score - last.away_score) : null;
      const brink = need && leader && !through && wins[leader] === need - 1;
      const why = brink ? name(leader) + ' are one win from going through, in a best of ' + spell(+tie.legs) + '.'
        : lowLeads ? 'The lower seed has the lead: ' + name(hi) + ' finished ' + spell(pl0.pos - ph.pos) + ' places above them.'
        : lastM != null && lastM <= 3 ? 'Game ' + n + ' was decided by ' + plural(lastM, 'point') + '.'
        : met.length ? (metHi === met.length ? name(hi) + ' won ' + (met.length === 2 ? 'both' : 'all ' + spell(met.length)) + ' of their regular-season meetings.'
          : metHi === 0 ? name(lo) + ' won ' + (met.length === 2 ? 'both' : 'all ' + spell(met.length)) + ' of their regular-season meetings.'
          : 'They split their regular-season meetings ' + Math.max(metHi, met.length - metHi) + '–' + Math.min(metHi, met.length - metHi) + '.')
        : 'In the play-offs every game moves the series.';
      story({ id: 'series:' + s.key, kind: 'series', kicker: through ? 'Into the next round' : 'The play-offs', head,
        dek: [last ? 'Game ' + n + ': ' + name(wl) + ' won ' + scoreOf(last) + (wl === last.home_team_id ? ' at home' : ' on the road') + '.' : null, seeds].filter(Boolean).join(' ') || null,
        why,
        numbers: [n ? { label: 'series', value: name(hi) + ' ' + wins[hi] + '–' + wins[lo] + ' ' + name(lo) } : null,
          ph && pl0 ? { label: 'seeds', value: ordShort(ph.pos) + ' v ' + ordShort(pl0.pos) } : null,
          met.length ? { label: 'regular season', value: name(hi) + ' ' + metHi + '–' + (met.length - metHi) } : null,
          turn ? { label: 'the numbers say it turns on', value: FACET[turn.k] + ' (' + name(turn.side) + ', about ' + one(turn.pts) + ' points)' } : null],
        next: s.next && !through ? 'Game ' + (n + 1) + ' is on ' + dayWords(s.next.tipoff_at, tz) + ', with ' + name(s.next.home_team_id) + ' at home.' : null,
        teams: [hi, lo], games: s.games.map(g => g.id).concat(s.next ? [s.next.id] : []), tracks: { metric: 'series', value: wins[hi] + '-' + wins[lo] },
        importance: through ? 7 : 9 + (lowLeads ? 1 : 0), magnitude: Math.min(1, 0.45 + 0.12 * n + (lowLeads ? 0.2 : 0)), stakes: 1,
        lastAt: last ? time(last.tipoff_at) : nowMs - 12 * HOUR,
        angles: through ? ['how the series was won, game by game'] : ['a series preview: the regular-season meetings and the facet it turns on', 'a game-by-game series tracker', 'the matchup to watch on each side'],
        links: [last ? gameLink(last.id) : null, last ? videoLink(last.id) : null, s.next ? gameLink(s.next.id) : null].filter(Boolean) });
    });
  }

  /* ---- THE SCHEDULE SO FAR (sos.js): a winning record against the hardest opponents anyone has had, and the best
     side by margins adjusted for whom they have played, when that is not the side on top of the table ------------ */
  if (!over && byHard.length >= 6) {
    const h = byHard[0], hc = h.c, adjRank = byAdj.indexOf(h) + 1;
    if (hc.w > hc.l) story({ id: 'schedule:' + h.id, kind: 'schedule', kicker: 'The schedule',
      head: possOf(name(h.id)) + ' ' + rec(hc.w, hc.l) + ' has come against the hardest schedule in the league',
      dek: 'Their opponents so far average ' + signed(h.sosNet) + ' points per 100 possessions, adjusted; the easiest schedule has been ' + possOf(name(byHard[byHard.length - 1].id)) + ' (' + signed(byHard[byHard.length - 1].sosNet) + ').',
      why: adjRank <= 3 ? 'Against the schedule they have played, their margins rank ' + place(adjRank) + ' in the league: the record undersells them.'
        : 'A record against the league’s best is worth more than the same record against its worst.',
      numbers: [{ label: 'record', value: rec(hc.w, hc.l) }, { label: 'opponents, adjusted net', value: signed(h.sosNet) }, { label: 'their adjusted net', value: signed(h.adjNet) + ' (' + ordShort(adjRank) + ')' }],
      next: nextText(h.id) ? 'Next: ' + nextText(h.id) + '.' : null, teams: [h.id], tracks: { metric: 'schedule', value: h.id },
      importance: 4.5, magnitude: 0.5, stakes: 0.5, lastAt: hc.lastAt, evergreen: true, under: true,
      angles: ['a data piece: the records that the schedule explains', 'the run of fixtures ahead, by strength'], links: [teamLink(h.id)].filter(Boolean) });
    const top = byAdj[0], tl = S.size === 1 ? ([...S.values()][0].filter(r => r.gp > 0)[0] || null) : null;
    const tpos = posOf.get(top.id);
    if (tl && top.id !== tl.team_id && top.c.gp >= 6 && tpos && tpos.pos >= 2) story({ id: 'adjusted:' + top.id, kind: 'adjusted', kicker: 'By the adjusted numbers',
      head: 'By the margins, adjusted for the schedule, ' + name(top.id) + ' are the best side in the league',
      dek: signed(top.adjNet) + ' points per 100 possessions against the opponents they have had; they are ' + place(tpos.pos) + ' in the table at ' + rec(top.c.w, top.c.l) + '.',
      why: 'The table counts wins; adjusted margins count how well a side has played against whom, and they are the better guide to what comes next.',
      numbers: [{ label: 'adjusted net', value: signed(top.adjNet) }, { label: 'place', value: ordShort(tpos.pos) }, { label: 'leaders, adjusted net', value: name(tl.team_id) + ' ' + signed((SOSIN[tl.team_id] || {}).adjNet || 0) }],
      counter: 'Yes, but the table is what decides the season, and ' + name(tl.team_id) + ' are top of it.',
      next: nextText(top.id) ? 'Next: ' + nextText(top.id) + '.' : null, teams: [top.id, tl.team_id], tracks: { metric: 'adjusted', value: top.id },
      importance: 5.5, magnitude: Math.min(1, 0.4 + (top.adjNet - (SOSIN[tl.team_id] || {}).adjNet || 0) / 10), stakes: 0.6, lastAt: top.c.lastAt, evergreen: true, under: true,
      angles: ['a power ranking built on adjusted margins, beside the table'], links: [teamLink(top.id)].filter(Boolean) });
  }

  /* ---- THE SEASON'S TEAM RECORDS, when the week set one: the biggest win, the most points, the most threes -------- */
  if (maxGp >= 3) {
    const tl3 = new Map();
    (o.teamLines || []).forEach(t => { if (t && t.adv && num(t.adv.fg3m) != null) tl3.set(t.game_id + '|' + t.team_idx, +t.adv.fg3m); });
    const best = (val, label, fmt) => {
      let b = null;
      regular.forEach(g => [0, 1].forEach(s => { const v = val(g, s); if (v != null && (!b || v > b.v)) b = { v, g, s }; }));
      return b ? Object.assign(b, { label, fmt }) : null;
    };
    const side = (g, s) => (s === 0 ? g.home_team_id : g.away_team_id);
    const recs = [
      best((g, s) => (s === 0 ? +g.home_score - +g.away_score : +g.away_score - +g.home_score) || null, 'the biggest win', b => possOf(name(side(b.g, b.s))) + ' ' + b.v + '-point win over ' + name(side(b.g, 1 - b.s))),
      best((g, s) => (s === 0 ? +g.home_score : +g.away_score), 'the most points', b => possOf(name(side(b.g, b.s))) + ' ' + b.v + ' points against ' + name(side(b.g, 1 - b.s))),
      tl3.size ? best((g, s) => (tl3.has(g.id + '|' + s) ? tl3.get(g.id + '|' + s) : null), 'the most threes', b => possOf(name(side(b.g, b.s))) + ' ' + b.v + ' threes against ' + name(side(b.g, 1 - b.s))) : null
    ].filter(b => b && b.v > 0 && time(b.g.tipoff_at) >= nowMs - 7 * DAY);
    if (recs.length) {
      const lead = recs[0];
      story({ id: 'teambest', kind: 'teambest', kicker: 'Team records', head: lead.fmt(lead) + ' ' + (lead.label === 'the biggest win' ? 'is the biggest of the season' : 'are ' + lead.label + ' in a game this season'),
        dek: dayWords(lead.g.tipoff_at, tz) ? cap(dayWords(lead.g.tipoff_at, tz)) + '.' : null,
        why: 'Every other night this season is measured against it now.',
        numbers: recs.map(b => ({ label: b.label, value: b.fmt(b) })), teams: [...new Set(recs.map(b => side(b.g, b.s)))], games: recs.map(b => b.g.id),
        tracks: { metric: 'teambest', value: recs.map(b => b.label + b.v).join(',') }, importance: 4.5, magnitude: 0.5, stakes: 0.35, lastAt: time(lead.g.tipoff_at),
        angles: ['the night, in the numbers'], links: [gameLink(lead.g.id)] });
    }
  }

  /* ---- ONE FOR THE FUTURE: the best player aged 21 or under, by box plus-minus (ages: player_bio) -------------- */
  {
    const young = (o.players || []).filter(r => r && r.id && pname(r.id) && num(r.bpm) != null && num(r.gp) >= Math.max(4, Math.ceil(maxGp * 0.5)) && num(r.mpg) >= 15 &&
      ageOf(r.id) != null && ageOf(r.id) <= 21).sort((a, b) => b.bpm - a.bpm);
    const y = young[0];
    if (y && y.bpm > 0) {
      const yc = PL.get(y.id) ? PL.get(y.id).team : null;
      story({ id: 'youth:' + y.id, kind: 'youth', kicker: 'One for the future', head: pname(y.id) + ', ' + ageOf(y.id) + ', is the best young player in the league by the numbers',
        dek: signed(y.bpm) + ' BPM on ' + one(y.ppg) + ' points, ' + one(y.rpg) + ' rebounds and ' + one(y.apg) + ' assists in ' + one(y.mpg) + ' minutes a game' + (yc ? ' for ' + name(yc) : '') + '.',
        why: young.length > 1 ? 'Nobody else aged 21 or under with a real role comes close: ' + pname(young[1].id) + ' is next, at ' + signed(young[1].bpm) + '.' : 'Nobody else aged 21 or under has a role like it.',
        numbers: [{ label: 'age', value: String(ageOf(y.id)) }, { label: 'BPM', value: signed(y.bpm) }, { label: 'minutes', value: one(y.mpg) }],
        teams: yc ? [yc] : [], players: [y.id], tracks: { metric: 'youth', value: y.id }, importance: 4, magnitude: 0.5, stakes: 0.3,
        lastAt: PL.get(y.id) ? PL.get(y.id).lastAt : nowMs - DAY, evergreen: true, under: true,
        angles: ['a feature on the player and the minutes the club is giving them'], links: [playerLink(y.id)].filter(Boolean) });
    }
  }

  /* ---- THE FANS' VOTE (fanvote_winners): the week's pick, from a real number of ballots, beside the numbers' pick -- */
  const FV = o.fanvote;
  if (FV && FV.player && FV.player.name && FV.ballots >= 25 && time(FV.endsAt) != null && nowMs - time(FV.endsAt) <= 9 * DAY) {
    const p = FV.player, line = p.line || {};
    const rival = (FV.others || []).find(x => x.line && num(x.line.bpm) != null && num(line.bpm) != null && x.line.bpm > line.bpm + 1);
    story({ id: 'fans:' + FV.week, kind: 'fans', kicker: 'The fans’ vote', head: 'The fans’ player of the week: ' + p.name,
      dek: p.share + '% of the vote from ' + FV.ballots + ' ballots' + (num(line.ppg) != null ? '; ' + one(line.ppg) + ' points a game that week' : '') + '.',
      why: rival ? 'The numbers had another week in mind: ' + rival.name + '’s BPM was ' + signed(rival.line.bpm) + ', against ' + signed(line.bpm) + '.' : 'The numbers agree: the best box plus-minus of the three the fans liked most.',
      numbers: [{ label: 'share', value: p.share + '%' }, { label: 'ballots', value: String(FV.ballots) }, num(line.bpm) != null ? { label: 'BPM', value: signed(line.bpm) } : null],
      teams: p.team ? [p.team] : [], players: p.id ? [p.id] : [], tracks: { metric: 'fans', value: FV.week }, importance: 4.5, magnitude: 0.5, stakes: 0.3, lastAt: time(FV.endsAt),
      angles: ['the fans’ pick against the numbers’ pick, side by side'], links: [playerLink(p.id)].filter(Boolean) });
  }

  /* ---- THE LEAGUE'S LENS: what wins here (What Wins), as a standing data story ------------------------------- */
  if (LENS && LENS.rows.length >= 3) {
    const a = LENS.rows[0], b = LENS.rows[1];
    story({ id: 'lens', kind: 'lens', kicker: 'What wins here', head: cap(a.label) + ' decides more games in this league than anything else',
      dek: 'One standard step better than the average club at ' + a.label + ' is worth about ' + one(a.pts) + ' points a game here; at ' + b.label + ', ' + one(b.pts) + '.',
      why: 'It is the lens to read every result and every preview through.',
      numbers: LENS.rows.map(r => ({ label: r.label, value: one(r.pts) + ' pts', note: 'a game, for one standard step' })).concat(LENS.home != null ? [{ label: 'home court', value: one(LENS.home) + ' pts' }] : []),
      tracks: { metric: 'lens', value: a.k }, importance: 4, magnitude: 0.5, stakes: 0.3, lastAt: nowMs - 2 * DAY, evergreen: true,
      angles: ['an explainer for new readers', 'a recurring "the number that matters" box'] });
  }

  /* ============================================================== threading === */
  const prev = new Map(((o.previous && o.previous.stories) || []).map(s => [s.id, s]));
  const builtIso = new Date(nowMs).toISOString();
  const seen = new Set();
  out.forEach(s => {
    const p = prev.get(s.id);
    seen.add(s.id);
    if (!p || p.status === 'expired') { s.status = 'new'; s.version = 1; s.first = builtIso; s.updated = builtIso; s.change = null; return; }
    const changed = JSON.stringify(p.tracks) !== JSON.stringify(s.tracks);
    s.first = p.first || builtIso;
    s.version = (p.version || 1) + (changed ? 1 : 0);
    s.updated = changed ? builtIso : (p.updated || builtIso);
    s.change = changed ? changeNote(s, p) : p.change || null;
    s.status = changed ? 'developing' : (p.status === 'new' && nowMs - time(s.first) > 2 * DAY ? 'developing' : (p.status === 'resolved' ? 'developing' : p.status));
  });
  /* what was running and is not any more: resolved, said how, kept three days */
  prev.forEach((p, id) => {
    if (seen.has(id) || p.status === 'expired') return;
    const since = p.status === 'resolved' ? time(p.resolved) || nowMs : nowMs;
    if (nowMs - since > 3 * DAY) return;
    const r = Object.assign({}, p, { status: 'resolved', resolved: p.status === 'resolved' ? p.resolved : builtIso, updated: p.status === 'resolved' ? p.updated : builtIso });
    if (p.status !== 'resolved') r.change = endNote(p, C, name, tz) || 'No longer running.';
    out.push(r);
  });

  /* ============================================================ the ranking === */
  /* newsworthiness: importance x size x what is at stake, fading with the hours since its last evidence, a little more
     for a new storyline and less for a resolved one; then no club in more than two of the top six */
  out.forEach(s => {
    const h = Math.max(0, (nowMs - (s.lastAt || time(s.updated) || nowMs)) / HOUR);
    const fade = s.evergreen ? 0.55 : Math.pow(1 + h / 36, -0.9);
    const stat = s.status === 'new' ? 1.15 : s.status === 'resolved' ? 0.55 : 1;
    s.score = Math.round(100 * (s.importance || 3) * (0.5 + (s.magnitude || 0)) * (0.6 + 0.4 * (s.stakes || 0)) * fade * stat) / 100;
  });
  out.sort((a, b) => b.score - a.score);
  /* A DESK, NOT A DUMP: a few of each kind and two dozen in all (a late season can open forty upsets and runs). What is
     cut is the least newsworthy of its kind; a resolved storyline counts against nothing. */
  const PER_KIND = { upset: 3, run: 4, skid: 3, scoring: 3, form: 3, milestone: 2, identity: 2, luck: 2, perfect: 3, winless: 2, race: 4, absence: 3,
    line: 4, through: 3, out: 2, sweep: 2, split: 2, series: 12, final: 2 };
  const kinds = new Map();
  const kept = out.filter(s => {
    if (s.status === 'resolved') return true;
    const n = (kinds.get(s.kind) || 0) + 1;
    kinds.set(s.kind, n);
    return n <= (PER_KIND[s.kind] || 2);
  });
  out.length = 0;
  /* the second of a kind ranks a little lower than its score, the third lower again: a page of four "what wins for them"
     cards in a row reads as a list, not a desk */
  const nth = new Map();
  /* the play-offs are every series at once: a second series is not "another of the same" the way a second run is */
  kept.forEach(s => { const k = (nth.get(s.kind) || 0); nth.set(s.kind, k + 1); s.order = s.score * Math.pow(s.kind === 'series' ? 0.97 : 0.82, k); });
  kept.sort((a, b) => b.order - a.order);
  kept.filter(s => s.status !== 'resolved').slice(0, 24).concat(kept.filter(s => s.status === 'resolved').slice(0, 6)).forEach(s => { delete s.order; out.push(s); });
  const used = new Map(), ranked = [], later = [];
  out.forEach(s => {
    const over = (s.teams || []).some(t => (used.get(t) || 0) >= 2);
    if (ranked.length < 6 && over) { later.push(s); return; }
    ranked.push(s);
    if (ranked.length <= 6) (s.teams || []).forEach(t => used.set(t, (used.get(t) || 0) + 1));
  });
  const stories = ranked.concat(later).map((s, i) => Object.assign(s, { rank: i + 1 }));

  /* ============================================================ what has been written === */
  /* THE SITE'S OWN COVERAGE OF EACH STORYLINE: the match reports filed for the games it rests on, and the last
     fortnight's pieces from creators, outlets and channels that name its players, or its clubs (two of them, for a
     storyline about more than two). A storyline nobody has written about is a gap in the coverage plan. Names are
     compared without accents or case, as whole words. */
  const NEWS = o.news || null;
  let written = null;
  if (NEWS) {
    const fold = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRe = n => { const f = fold(n).trim(); return f.length >= 4 ? new RegExp('(^|[^a-z0-9])' + reEsc(f) + '($|[^a-z0-9])') : null; };
    const pieces = (NEWS.pieces || []).filter(p => p && p.title && time(p.at) >= nowMs - 14 * DAY).map(p => Object.assign({}, p, { text: fold(p.title + ' ' + (p.summary || '')), stories: [] }));
    const clubRe = new Map(), playerRe = new Map();
    const reOfClub = id => {
      if (!clubRe.has(id)) { const t = T.get(id); clubRe.set(id, [t && t.name, t && t.short_name && String(t.short_name).length >= 5 ? t.short_name : null].filter(Boolean).map(nameRe).filter(Boolean)); }
      return clubRe.get(id);
    };
    const reOfPlayer = id => { if (!playerRe.has(id)) { const n = pname(id); playerRe.set(id, n ? [nameRe(n)].filter(Boolean) : []); } return playerRe.get(id); };
    /* a player's storyline is covered by a piece that names the player; a game's by one that names both clubs; a club's
       by one that names it; the race or the line by one that names two of its clubs */
    const PLAYER_KINDS = new Set(['bpm', 'quiet', 'scoring', 'form', 'milestone', 'absence', 'youth', 'fans', 'best']);
    const GAME_KINDS = new Set(['upset', 'gotw', 'sweep', 'split', 'series', 'teambest']);
    stories.forEach(s => {
      const hits = [];
      const nT = (s.teams || []).length;
      const need = PLAYER_KINDS.has(s.kind) ? Infinity : GAME_KINDS.has(s.kind) ? Math.min(2, nT) : nT > 2 ? 2 : 1;
      pieces.forEach(p => {
        const byPlayer = (s.players || []).some(id => reOfPlayer(id).some(re => re.test(p.text)));
        const clubs = (s.teams || []).filter(id => reOfClub(id).some(re => re.test(p.text))).length;
        const byClub = nT > 0 && clubs >= need;
        if (!byPlayer && !byClub) return;
        hits.push({ p, byPlayer });
        if (s.status !== 'resolved') p.stories.push(s.id);
      });
      hits.sort((a, b) => (b.byPlayer ? 1 : 0) - (a.byPlayer ? 1 : 0) || time(b.p.at) - time(a.p.at));
      const reps = (s.games || []).map(id => (NEWS.reports && NEWS.reports[id] ? Object.assign({ kind: 'report' }, NEWS.reports[id]) : null)).filter(Boolean)
        .sort((a, b) => time(b.at) - time(a.at));
      s.pieces = hits.slice(0, 2).map(h => ({ kind: h.p.kind, title: h.p.title, href: h.p.href, at: h.p.at }))
        .concat(reps.slice(0, 1).map(r => ({ kind: 'report', title: r.title, href: r.href, at: r.at })));
      s.written = hits.length;
    });
    written = pieces.sort((a, b) => time(b.at) - time(a.at)).slice(0, 10).map(p => ({ kind: p.kind, title: p.title, href: p.href, at: p.at, stories: p.stories.slice(0, 3) }));
  }
  /* the copy a creator takes away: the headline, the line under it, the why, the numbers, the counterpoint and what's next */
  stories.forEach(s => {
    s.copy = [s.head, s.dek, s.why ? 'Why it matters: ' + s.why : null, s.numbers.length ? 'By the numbers: ' + s.numbers.map(n => n.label + ' ' + n.value).join('; ') : null,
      s.counter ? 'Yes, but: ' + s.counter : null, s.next ? 'What’s next: ' + s.next : null].filter(Boolean).join('\n');
  });

  const ctxObj = { nowMs, tz, C, S, posOf, name, short, fixtures, games, regular, recaps, tallies, P, model: o.model, LENS, PL, pname, ID, DISTINCT, F, maxGp, qualifiers, nextText,
    shape, SERIES, isPost: isPostFix, pairKey, SIG, VID, NEWS, written };
  /* the clubs the file names, so a page can draw a slate or a link without asking for them */
  const clubsOut = {};
  new Set(games.concat(fixtures).flatMap(g => [g.home_team_id, g.away_team_id])).forEach(id => {
    const t = T.get(id);
    if (t) clubsOut[id] = { name: String(t.name || ''), short: t.short_name || null, slug: t.slug || null };
  });
  return {
    v: 1, engine: VERSION, built: builtIso, clubs: clubsOut,
    league: o.league ? { id: o.league.id, slug: o.league.slug, name: o.league.name } : null,
    season: o.season ? { id: o.season.id, name: o.season.name } : null,
    stories: stories.filter(s => s.status !== 'expired'),
    briefing: briefing(stories, ctxObj),
    coverage: coverage(stories, ctxObj),
    stats: { games: games.length, fixtures: fixtures.length, clubs: C.size, players: PL.size, recaps: Object.keys(recaps).length, model: !!(o.model && o.model.b) }
  };
}

/* HOW MUCH A GAME IS WORTH A RECAP: its shape (the match report's arc), how close it finished, an upset by the table,
   and a moment at the end */
function recapScore(g, r, posOf, sig) {
  const m = Math.abs(g.home_score - g.away_score);
  const w = +g.home_score > +g.away_score ? g.home_team_id : g.away_team_id, l = w === g.home_team_id ? g.away_team_id : g.home_team_id;
  const pw = posOf.get(w), pl = posOf.get(l);
  const upset = pw && pl && (pw.gp || 0) >= 3 && (pl.gp || 0) >= 3 ? Math.max(0, pw.pos - pl.pos) : 0;
  const arc = r && r.arc ? ({ heist: 3, collapse: 3, comeback: 2.5, overtime: 2.5, seesaw: 1.5, heldOn: 1.5, tight: 1.5, pulledAway: 1, wire: 0.5, rout: 0.5 }[r.arc] || 0) : 0;
  /* the site's own measure of the game (game_significance: a 50-point night, first against second, a final...) */
  const sg = sig && sig.points > 0 ? Math.min(4, sig.points / 20) : 0;
  return arc + (m <= 3 ? 2 : m <= 6 ? 1 : 0) + Math.min(3, upset / 2) + (r && r.moment ? (r.moment.kind === 'gameWinner' ? 2.5 : 1.5) : 0) + sg;
}

/* what changed, in a few words */
function changeNote(s, p) {
  const a = p.tracks && p.tracks.value, b = s.tracks && s.tracks.value;
  switch (s.kind) {
    case 'run': return 'Now ' + spell(b) + ' straight (was ' + spell(a) + ').';
    case 'skid': return 'Now ' + spell(b) + ' defeats in a row.';
    case 'scoring': return 'Now ' + spell(b) + ' straight 20-point games.';
    case 'race': return 'The gap at the top is now ' + gamesWord(b) + '.';
    case 'line': return 'The gap at the line is now ' + gamesWord(b) + '.';
    case 'perfect': return 'Now ' + rec(b, 0) + '.';
    case 'milestone': return 'Now ' + spell(b) + ' points away.';
    case 'series': return (s.tracks && s.tracks.metric === 'tie' ? 'On aggregate, now ' : 'The series is now ') + String(b).replace('-', '–') + '.';
    default: return 'Updated with the latest games.';
  }
}
/* how a running storyline ended, from the results */
function endNote(p, C, name, tz) {
  const id = (p.teams || [])[0];
  const c = id ? C.get(id) : null;
  if (!c || !c.games.length) return null;
  const last = c.games[c.games.length - 1];
  const sc = Math.max(last.for, last.against) + '–' + Math.min(last.for, last.against);
  if (p.kind === 'run' && !last.won) return 'Ended at ' + spell(p.tracks.value) + ' by ' + name(last.opp) + ', ' + sc + '.';
  if (p.kind === 'skid' && last.won) return 'Ended with a win over ' + name(last.opp) + ', ' + sc + '.';
  if (p.kind === 'perfect' && !last.won) return name(last.opp) + ' ended it, ' + sc + '.';
  if (p.kind === 'winless' && last.won) return 'The first win came against ' + name(last.opp) + ', ' + sc + '.';
  return null;
}

/* ============================================================ the briefing === */
/* THE DAY IN THE LEAGUE, with an end: the one big story, the results since yesterday, the games to watch, a milestone or
   two in reach - and nothing else, so it can be read in a minute. */
function briefing(stories, X) {
  const lead = stories.find(s => s.status !== 'resolved') || null;
  const since = X.nowMs - 36 * HOUR;
  const results = X.games.filter(g => time(g.tipoff_at) >= since).slice().reverse().slice(0, 8).map(g => {
    const r = X.recaps[g.id];
    const hs = +g.home_score, as = +g.away_score, w = hs > as ? g.home_team_id : g.away_team_id, l = hs > as ? g.away_team_id : g.home_team_id;
    return { game: g.id, line: r && r.headline ? r.headline : X.name(w) + ' beat ' + X.name(l) + ' ' + Math.max(hs, as) + '–' + Math.min(hs, as),
             sub: r && r.standfirst ? r.standfirst : null };
  });
  const watch = slate(X, 3 * DAY).slice(0, 4).map(s => ({ game: s.game, line: s.title, sub: s.angle }));
  const ms = stories.filter(s => s.kind === 'milestone').slice(0, 2).map(s => ({ line: s.head, sub: s.next }));
  const lines = [lead ? 'The story: ' + lead.head + '.' : null]
    .concat(results.length ? ['Results: ' + results.map(r => r.line).join('; ') + '.'] : [])
    .concat(watch.length ? ['To watch: ' + watch.map(w => w.line).join('; ') + '.'] : [])
    .concat(ms.length ? ['Milestones: ' + ms.map(m => m.line).join('; ') + '.'] : []).filter(Boolean);
  return { lead: lead ? lead.id : null, results, watch, milestones: ms, lines, end: 'That is the day in ' + 'the league.' };
}

/* ============================================================== the slate === */
/* THE GAMES AHEAD, ranked by what is at stake, each with the angle a preview should take: where the two stand, the form,
   the meetings, what the season's numbers expect and the one facet the matchup turns on, the fans' picks, a player to
   watch on each side. */
function slate(X, horizon) {
  const until = X.nowMs + (horizon || 7 * DAY);
  return X.fixtures.filter(g => time(g.tipoff_at) <= until).map(g => {
    const a = g.home_team_id, b = g.away_team_id, pa = X.posOf.get(a), pb = X.posOf.get(b), ca = X.C.get(a), cb = X.C.get(b);
    const of = pa ? pa.of : 0;
    const topish = (pa ? 1 - (pa.pos - 1) / Math.max(1, of) : 0.4) + (pb ? 1 - (pb.pos - 1) / Math.max(1, of) : 0.4);
    const close = pa && pb ? Math.max(0, 1 - Math.abs(pa.pos - pb.pos) / 6) : 0.3;
    const ex = expect(X.P, a, b, X.model);
    const tight = ex ? Math.max(0, 1 - Math.abs(ex.margin) / 12) : 0.4;
    const stakes = Math.round(100 * (topish * 0.5 + close * 0.3 + tight * 0.2)) / 100;
    /* the meetings this season */
    const met = X.games.filter(m => (m.home_team_id === a && m.away_team_id === b) || (m.home_team_id === b && m.away_team_id === a));
    const winsA = met.filter(m => (m.home_team_id === a ? +m.home_score > +m.away_score : +m.away_score > +m.home_score)).length;
    /* the facet the season's numbers say it turns on */
    let turn = null;
    if (ex) {
      const k = Object.keys(ex.parts).sort((x, y) => Math.abs(ex.parts[y].pts) - Math.abs(ex.parts[x].pts))[0];
      const p = ex.parts[k];
      if (Math.abs(p.pts) >= 1) turn = { k, label: FACET[k], side: p.pts > 0 ? a : b, pts: Math.abs(p.pts) };
    }
    const watchP = side => {
      let best = null;
      X.PL.forEach((p, pid) => { if (p.team === side && p.gp >= 3 && X.pname(pid) && (!best || (p.last5ppg || 0) > (best.p.last5ppg || 0))) best = { pid, p }; });
      const k = Math.min(5, best ? best.p.gp : 0);
      return best ? { pid: best.pid, name: X.pname(best.pid), line: one(best.p.last5ppg) + ' ppg ' + (k >= 5 ? 'over the last five' : 'so far') } : null;
    };
    const t = X.tallies[g.id];
    const fans = t && (+t.home + +t.away) >= 10 ? { home: Math.round(100 * t.home / (+t.home + +t.away)), n: +t.home + +t.away } : null;
    const title = X.name(a) + ' v ' + X.name(b);
    const bits = [];
    /* a play-off game is a game in a series: its number and the series first, and it outranks the regular season */
    const ser = X.isPost && X.isPost(g) && X.SERIES ? X.SERIES.get(X.pairKey(g)) : null;
    if (ser) bits.push('Game ' + (ser.n + 1) + (ser.n ? ': ' + ser.status : ' of the series'));
    if (pa && pb && Math.min(pa.gp || 0, pb.gp || 0) >= 3) bits.push(ordShort(pa.pos) + ' against ' + ordShort(pb.pos));
    if (turn) bits.push('the numbers say it turns on ' + turn.label);
    if (met.length && !ser) bits.push(met.length === 1 ? 'a rematch' : 'meeting ' + spell(met.length + 1) + ' this season');
    const angle = cap(bits.join('; ')) || null;
    /* a series game outranks the regular season; among series games, the regular measure still orders them */
    const stakes0 = ser ? Math.round(100 * (1.2 + 0.5 * stakes)) / 100 : stakes;
    return {
      game: g.id, at: g.tipoff_at, day: dayWords(g.tipoff_at, X.tz), title, angle, stakes: stakes0, series: ser ? { game: ser.n + 1, status: ser.n ? ser.status : null } : null,
      home: { id: a, rank: pa ? pa.pos : null, rec: ca ? rec(ca.w, ca.l) : null, form: ca ? ca.last5.join('') : '', streak: ca && ca.streak ? (ca.streak.won ? 'W' : 'L') + ca.streak.n : null, watch: watchP(a) },
      away: { id: b, rank: pb ? pb.pos : null, rec: cb ? rec(cb.w, cb.l) : null, form: cb ? cb.last5.join('') : '', streak: cb && cb.streak ? (cb.streak.won ? 'W' : 'L') + cb.streak.n : null, watch: watchP(b) },
      expect: ex ? { margin: Math.round(ex.margin * 10) / 10, favourite: ex.margin >= 0 ? a : b, model: ex.model } : null,
      turn, meetings: met.length ? { played: met.length, winsHome: winsA, winsAway: met.length - winsA } : null, fans,
      plan: ser ? ['a series preview the day before', 'a live thread', 'the recap, and where the series stands']
        : stakes0 >= 1.1 ? ['a full preview the day before', 'a live thread', 'the recap and the numbers that decided it']
        : stakes0 >= 0.8 ? ['a short preview', 'the recap'] : ['the recap if it surprises']
    };
  }).sort((x, y) => y.stakes - x.stakes || time(x.at) - time(y.at));
}

/* ============================================================ the coverage === */
/* THE COVERAGE PLAN, for the creator hub: how a desk that followed this league would cover the next week, in full. */
function coverage(stories, X) {
  const live = stories.filter(s => s.status !== 'resolved');
  /* THE BIG PICTURE: the state of the league in a few paragraphs */
  const big = [];
  /* THE PLAY-OFFS first, when they are on: every series in a line */
  if (X.SERIES && X.SERIES.size) {
    const seedOf = s => { const p = X.posOf.get(s.hi); return p ? p.pos : 99; };
    const ss = [...X.SERIES.values()].filter(s => s.status).sort((a, b) => seedOf(a) - seedOf(b));
    /* the bracket's own name for the round when every tie shares one ("Qualifiers"), else the play-offs */
    const labs = [...new Set(ss.map(s => s.label || null))];
    if (ss.length) big.push((labs.length === 1 && labs[0] ? labs[0] : 'The play-offs') + ': ' + ss.map(s => s.status).join('; ') + '.');
  }
  const groups = [...X.S.entries()];
  const sh = X.shape;
  if (groups.length && X.maxGp >= 3) {
    if (sh && sh.trusted && !sh.over && sh.total >= 6) big.push(cap(spell(X.maxGp)) + ' games into a ' + sh.total + '-game regular season, with ' + plural(sh.left, 'game') + ' left for most clubs.');
    groups.slice(0, 3).forEach(([g, rows]) => {
      const pl = rows.filter(r => r.gp > 0);
      if (pl.length < 3) return;
      const a = pl[0], b = pl[1], gap = gb(a, b);
      const where = g ? (/\s/.test(g) ? ' In ' + g + ', ' : ' In Group ' + g + ', ') : '';
      if (sh && sh.over) {
        big.push(cap((where ? where.trim() + ' ' : '') + X.name(a.team_id) + ' finished the regular season top at ' + rec(a.w, a.l) + (gap > 0 ? ', ' + gamesWord(gap) + ' clear of ' + X.name(b.team_id) : ', level with ' + X.name(b.team_id)) + '.'));
        return;
      }
      /* the same measure as the race storyline: a game and a half */
      big.push(cap((where ? where.trim() + ' ' : '') + X.name(a.team_id) + ' lead at ' + rec(a.w, a.l) + (gap > 0 ? ', ' + gamesWord(gap) + ' clear of ' + X.name(b.team_id) : ', level with ' + X.name(b.team_id)) +
        '. ' + (() => { const n = pl.filter(r => gb(a, r) <= 1.5).length - 1;
          return n <= 0 ? 'Nobody else is within a game and a half of them.' : 'There ' + (n === 1 ? 'is one club' : 'are ' + plural(n, 'club')) + ' within a game and a half of them.'; })()));
    });
  }
  const homeW = X.games.filter(g => +g.home_score > +g.away_score).length;
  if (X.games.length >= 10) {
    const pts = X.games.reduce((s, g) => s + (+g.home_score) + (+g.away_score), 0) / X.games.length;
    const closeN = X.games.filter(g => Math.abs(g.home_score - g.away_score) <= 5).length;
    big.push('Across ' + X.games.length + ' games, home sides have won ' + Math.round(100 * homeW / X.games.length) + '% and games average ' + one(pts) +
      ' points between the two sides; ' + Math.round(100 * closeN / X.games.length) + '% have been decided by five or fewer.');
  }
  if (X.LENS && X.LENS.rows.length >= 2) {
    big.push('What wins here, in points a game for being one standard step better than the average club: ' +
      list(X.LENS.rows.slice(0, 4).map(r => r.label + ' ' + one(r.pts))) + '.' + (X.LENS.model ? ' Weighed by this league’s own model of what wins.' : ''));
  }
  /* how often each facet was the one that decided a game */
  const dec = {};
  let nDec = 0;
  X.F.forEach(f => { if (f.decisive && f.decisive.pts >= 2) { dec[f.decisive.k] = (dec[f.decisive.k] || 0) + 1; nDec++; } });
  if (nDec >= 10) {
    const ks = Object.keys(dec).sort((a, b) => dec[b] - dec[a]);
    big.push('Game by game, ' + FACET[ks[0]] + ' has been the deciding facet ' + Math.round(100 * dec[ks[0]] / nDec) + '% of the time' +
      (ks[1] ? ', ' + FACET[ks[1]] + ' ' + Math.round(100 * dec[ks[1]] / nDec) + '%' : '') + '.');
  }

  /* THE SLATE: the next seven days */
  const sl = slate(X, 7 * DAY).slice(0, 12);

  /* RECAPS WORTH WRITING: the week's games, ranked by what made them stand out */
  const recaps = X.games.filter(g => time(g.tipoff_at) >= X.nowMs - 7 * DAY).map(g => {
    const r = X.recaps[g.id] || null;
    const w = +g.home_score > +g.away_score ? g.home_team_id : g.away_team_id, l = w === g.home_team_id ? g.away_team_id : g.home_team_id;
    const score = recapScore(g, r, X.posOf, X.SIG[g.id]);
    return { game: g.id, at: g.tipoff_at, score: Math.round(score * 10) / 10, headline: r && r.headline ? r.headline : X.name(w) + ' beat ' + X.name(l) + ' ' + Math.max(+g.home_score, +g.away_score) + '–' + Math.min(+g.home_score, +g.away_score),
             standfirst: r && r.standfirst || null, angle: r && r.decisive ? cap(r.decisive.label) + ' decided it, about ' + Math.round(r.decisive.pts) + ' points' : null, arc: r && r.arc || null,
             reasons: X.SIG[g.id] && X.SIG[g.id].reasons.length ? X.SIG[g.id].reasons : null, video: !!(X.VID && X.VID[g.id]),
             report: X.NEWS && X.NEWS.reports && X.NEWS.reports[g.id] ? X.NEWS.reports[g.id].href : null };
  }).sort((a, b) => b.score - a.score || time(b.at) - time(a.at)).slice(0, 8);

  /* PLAYERS TO FEATURE */
  const players = [];
  stories.filter(s => ['scoring', 'form', 'best', 'milestone'].indexOf(s.kind) >= 0 && s.status !== 'resolved').forEach(s => players.push({ story: s.id, pid: (s.players || [])[0], head: s.head, dek: s.dek, angle: (s.angles || [])[0] || null }));

  /* CLUBS TO FEATURE: identity, the record against the points, the run they are on, what is next */
  const teams = [];
  X.C.forEach((c, id) => {
    if (c.gp < 3) return;
    const idn = X.ID.get(id), pos = X.posOf.get(id), dx = X.DISTINCT ? X.DISTINCT.get(id) : null;
    teams.push({ id, name: X.name(id), rank: pos ? pos.pos : null, rec: rec(c.w, c.l), form: c.last5.join(''),
      identity: dx ? cap(FACET[dx.k]) + ' swings their results more than it does for most clubs here'
        : idn && idn.top && idn.top.gap >= 3 ? cap(FACET[idn.top.k]) + ' separates their wins from their defeats' : null,
      luck: c.pyth != null && c.gp >= 6 ? Math.round((c.w - c.pyth * c.gp) * 10) / 10 : null,
      close: rec(c.close.w, c.close.l), next: X.nextText(id), stories: live.filter(s => (s.teams || []).indexOf(id) >= 0).map(s => s.id) });
  });
  teams.sort((a, b) => (b.stories.length - a.stories.length) || ((a.rank || 99) - (b.rank || 99)));

  /* DATA NOTES */
  const notes = [];
  const close = [...X.C.values()].filter(c => c.close.w + c.close.l >= 3).sort((a, b) => (b.close.w / (b.close.w + b.close.l)) - (a.close.w / (a.close.w + a.close.l)));
  if (close.length >= 3) notes.push({ head: 'Best in close games', line: X.name(close[0].id) + ' are ' + rec(close[0].close.w, close[0].close.l) + ' in games decided by five or fewer; ' + X.name(close[close.length - 1].id) + ' ' + rec(close[close.length - 1].close.w, close[close.length - 1].close.l) + '.' });
  const fort = [...X.C.values()].filter(c => c.home.w + c.home.l >= 3 && c.home.l === 0).sort((a, b) => b.home.w - a.home.w)[0];
  if (fort) notes.push({ head: 'The fortress', line: X.name(fort.id) + ' are ' + rec(fort.home.w, 0) + ' at home.' });
  const road = [...X.C.values()].filter(c => c.away.w + c.away.l >= 3).sort((a, b) => (b.away.w / (b.away.w + b.away.l)) - (a.away.w / (a.away.w + a.away.l)))[0];
  if (road && road.away.w >= 2) notes.push({ head: 'Best on the road', line: X.name(road.id) + ' are ' + rec(road.away.w, road.away.l) + ' away from home.' });
  const att = X.games.filter(g => num(g.attendance) > 0).sort((a, b) => b.attendance - a.attendance)[0];
  if (att) notes.push({ head: 'The biggest crowd', line: att.attendance + ' at ' + X.name(att.home_team_id) + ' v ' + X.name(att.away_team_id) + ', ' + dayWords(att.tipoff_at, X.tz) + '.' });
  const hi = X.games.slice().sort((a, b) => (Math.max(+b.home_score, +b.away_score)) - (Math.max(+a.home_score, +a.away_score)))[0];
  if (hi && X.games.length >= 5) notes.push({ head: 'The highest score', line: Math.max(+hi.home_score, +hi.away_score) + ' points, by ' + X.name(+hi.home_score > +hi.away_score ? hi.home_team_id : hi.away_team_id) + ' against ' + X.name(+hi.home_score > +hi.away_score ? hi.away_team_id : hi.home_team_id) + '.' });
  if (X.LENS && X.LENS.home != null) notes.push({ head: 'Home court', line: 'Worth about ' + one(X.LENS.home) + ' points a game here, beyond the four factors.' });
  /* THE FANS' RECORD: how often the side most fans picked won, over the finished games with a real number of picks */
  const picked = X.games.filter(g => X.tallies[g.id] && (+X.tallies[g.id].home + +X.tallies[g.id].away) >= 10 && +g.home_score !== +g.away_score);
  if (picked.length >= 8) {
    const right = picked.filter(g => { const t = X.tallies[g.id]; return (+t.home >= +t.away) === (+g.home_score > +g.away_score); }).length;
    notes.push({ head: 'The fans’ record', line: 'The side most fans picked has won ' + right + ' of the last ' + picked.length + ' games with ten or more picks (' + Math.round(100 * right / picked.length) + '%).' });
  }

  /* THE CALENDAR: what to publish, day by day, for the next week */
  const days = new Map();
  const keyOf = iso => dayWords(iso, X.tz, { weekday: 'long', day: 'numeric', month: 'long' }) || iso.slice(0, 10);
  const put = (iso, item) => { const k = keyOf(iso); if (!days.has(k)) days.set(k, { day: k, at: iso, items: [] }); days.get(k).items.push(item); };
  sl.filter(s => s.stakes >= 0.8).slice(0, 6).forEach(s => {
    const before = new Date(time(s.at) - DAY).toISOString();
    if (time(before) > X.nowMs) put(before, { kind: 'preview', what: 'Preview: ' + s.title + (s.angle ? ' — ' + s.angle.charAt(0).toLowerCase() + s.angle.slice(1) : ''), game: s.game });
    put(s.at, { kind: 'recap', what: 'Recap after the game: ' + s.title + '.', game: s.game });
  });
  const firstDay = new Date(X.nowMs + DAY).toISOString();
  const topStory = live[0];
  if (topStory) put(firstDay, { kind: 'feature', what: 'Feature: ' + topStory.head + '.', story: topStory.id });
  const data = live.find(s => s.kind === 'identity' || s.kind === 'luck' || s.kind === 'lens');
  if (data) put(new Date(X.nowMs + 3 * DAY).toISOString(), { kind: 'data', what: 'Data piece: ' + data.head + '.', story: data.id });
  const roundUp = new Date(X.nowMs + 6 * DAY).toISOString();
  put(roundUp, { kind: 'roundup', what: X.SERIES && X.SERIES.size ? 'The week in the play-offs: every series, where it stands, and what decided each game.'
    : 'The week in the league: the results, the table, and the storylines that moved.' });
  const calendar = [...days.values()].sort((a, b) => time(a.at) - time(b.at)).slice(0, 8);

  return {
    bigPicture: big.map(clean).filter(Boolean),
    storylines: live.slice(0, 10).map(s => s.id),
    underRadar: stories.filter(s => s.under && s.status !== 'resolved').slice(0, 3).map(s => s.id),
    slate: sl, recaps, players: players.slice(0, 8), teams: teams.slice(0, 10), notes, calendar,
    /* what has been written in the last fortnight, and the storylines nobody has written about yet (with the news read) */
    written: X.written || null,
    gaps: X.written ? live.slice(0, 12).filter(s => !s.written).map(s => s.id) : null
  };
}

/* THE ENGINE'S VERSION: raised when what it writes changes, so every league's file is rebuilt on the next run (the
   builder treats a file from an older engine as due) */
const VERSION = 3;
return { build, VERSION, __x: { clubs, standings, facets, identities, lens, playerSeason, profiles, expect, slate, briefing, coverage, changeNote, endNote } };
}));
