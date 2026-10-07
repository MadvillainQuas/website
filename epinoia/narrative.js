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
              recaps:   {gameId: {headline, standfirst, arc, decisive: {key, label, pts}, moment}},
              model:    {b, home, n}, tallies: {gameId: {home, away}}, previous: the last build }
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
const gamesWord = n => (n === 1 ? 'one game' : half(n) + ' games');
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
  const C = clubs(games);
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
  const names = o.names || {};
  const pname = pid => { const n = names[pid]; return n && n.name ? String(n.name) : null; };
  const maxGp = [...C.values()].reduce((m, c) => Math.max(m, c.gp), 0);
  const qualifiers = o.comp && num(o.comp.qualifiers) ? +o.comp.qualifiers : null;
  const recaps = o.recaps || {};
  const tallies = o.tallies || {};
  const nextOf = id => fixtures.find(g => g.home_team_id === id || g.away_team_id === id) || null;
  const nextText = id => {
    const g = nextOf(id);
    if (!g) return null;
    const home = g.home_team_id === id, opp = home ? g.away_team_id : g.home_team_id, d = dayWords(g.tipoff_at, tz);
    return d ? (home ? name(opp) + ' visit on ' + d : 'away at ' + name(opp) + ' on ' + d) : null;
  };
  const gameLink = id => ({ label: 'the game', href: 'game/?g=' + id });
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
    const bunch = played.filter(r => gb(lead, r) <= 1.5);
    const grp = g ? (/\s/.test(g) ? g : 'Group ' + g) : null;
    const where = grp ? ' in ' + grp : '';
    const gap = gb(lead, second);
    const meet = fixtures.filter(f => bunch.some(r => r.team_id === f.home_team_id) && bunch.some(r => r.team_id === f.away_team_id));
    const lc = C.get(lead.team_id);
    const head = bunch.length >= 3 ? plural(bunch.length, 'club') + ' within ' + (gb(lead, bunch[bunch.length - 1]) <= 1 ? 'a game' : 'a game and a half') + ' of the top' + where
      : gap === 0 ? name(lead.team_id) + ' and ' + name(second.team_id) + ' level at the top' + where
      : name(lead.team_id) + ' ' + (gap >= 3 ? 'pull clear' : 'lead') + where + ', ' + gamesWord(gap) + ' ahead';
    story({
      id: 'race:' + (g || 'top'), kind: 'race', kicker: 'The race', head,
      dek: name(lead.team_id) + ' are ' + rec(lead.w, lead.l) + (gap > 0 ? ', ' + gamesWord(gap) + ' clear of ' + name(second.team_id) : ', level with ' + name(second.team_id) + ' on the record') + '.',
      why: gap <= 1 ? 'Nobody has the top spot to themselves for long: one result moves it.' : gap >= 3 ? 'A gap this size at this stage is the season’s first real separation.' : 'The leaders have a cushion, but not one a bad week cannot erase.',
      numbers: [{ label: 'leader', value: name(lead.team_id) + ' ' + rec(lead.w, lead.l) }, { label: 'next', value: name(second.team_id) + ' ' + rec(second.w, second.l) },
        { label: 'clubs within a game', value: String(played.filter(r => gb(lead, r) <= 1).length) },
        lc && lc.last5.length ? { label: 'leader’s last five', value: lc.last5.join(' ') } : null],
      counter: lc && lc.pyth != null && lc.gp >= 5 && lc.pyth * lc.gp < lc.w - 1.5 ? 'Yes, but their points for and against suggest about ' + spell(Math.round(lc.pyth * lc.gp)) + ' wins, not ' + spell(lc.w) + ': the record is running ahead of the play.' : null,
      next: meet.length ? 'The contenders meet on ' + dayWords(meet[0].tipoff_at, tz) + ': ' + name(meet[0].home_team_id) + ' v ' + name(meet[0].away_team_id) + '.'
        : nextText(lead.team_id) ? 'Next for ' + name(lead.team_id) + ': ' + nextText(lead.team_id) + '.' : null,
      teams: bunch.map(r => r.team_id).slice(0, 4), games: meet.map(f => f.id).slice(0, 3),
      tracks: { metric: 'gap', value: gap }, importance: 9, magnitude: Math.min(1, bunch.length / 5 + (gap >= 3 ? 0.4 : 0)), stakes: 1,
      lastAt: lc ? lc.lastAt : null, angles: ['the race, in a table and a paragraph', 'a preview of the next meeting between the contenders', 'a weekly "state of the race" column'],
      links: [teamLink(lead.team_id), teamLink(second.team_id)].filter(Boolean)
    });
  });

  /* ---- THE LINE: the last place in, and who is pressing ------------------------------------------------- */
  if (qualifiers && S.size === 1 && maxGp >= 4) {
    const rows = [...S.values()][0].filter(r => r.gp > 0);
    if (rows.length > qualifiers) {
      const inn = rows[qualifiers - 1], outt = rows[qualifiers], gap = gb(inn, outt);
      const near = rows.filter((r, i) => i >= qualifiers && gb(inn, r) <= 1.5);
      if (gap <= 2) {
        story({
          id: 'line', kind: 'line', kicker: 'The line', head: 'The fight for ' + place(qualifiers) + ': ' + name(inn.team_id) + ' hold it, ' + name(outt.team_id) + ' ' + (gap ? gamesWord(gap) + ' behind' : 'level'),
          dek: plural(near.length + 1, 'club') + ' within a game and a half of the last place that goes through.',
          why: 'Only the top ' + spell(qualifiers) + ' go through, and the line moves every week.',
          numbers: [{ label: place(qualifiers), value: name(inn.team_id) + ' ' + rec(inn.w, inn.l) }].concat(near.slice(0, 3).map(r => ({ label: ordShort(r.pos), value: name(r.team_id) + ' ' + rec(r.w, r.l) }))),
          next: nextText(outt.team_id) ? 'Next for ' + name(outt.team_id) + ': ' + nextText(outt.team_id) + '.' : null,
          teams: [inn.team_id, outt.team_id].concat(near.map(r => r.team_id)).slice(0, 5),
          tracks: { metric: 'gap', value: gap }, importance: 7.5, magnitude: Math.min(1, near.length / 3), stakes: 0.9,
          lastAt: Math.max(...[inn, outt].map(r => (C.get(r.team_id) || {}).lastAt || 0)),
          angles: ['who is in, who is out, and the schedule each has left', 'a "games that decide it" list from the fixtures']
        });
      }
    }
  }

  /* ---- RUNS: every winning run of three and more, and every losing run of four ----------------------- */
  C.forEach((c, id) => {
    const s = c.streak;
    if (!s || c.gp < 3) return;
    const pos = posOf.get(id);
    /* not a run that is simply the whole season so far: an unbeaten start is its own storyline, from four games */
    if (s.won && s.n >= 3 && c.l > 0) {
      const beaten = s.games.map(gid => { const x = c.games.find(y => y.id === gid); return x ? x.opp : null; }).filter(Boolean);
      const above = beaten.filter(oid => { const p = posOf.get(oid); return p && pos && p.pos < pos.pos; }).length;
      const record = c.bestWinRun && c.bestWinRun.n === s.n && s.n >= 5;
      story({
        id: 'run:' + id, kind: 'run', kicker: 'On a run', head: name(id) + ' have won ' + spell(s.n) + ' in a row',
        dek: (pos ? 'Up to ' + place(pos.pos) + ' at ' + rec(c.w, c.l) + '. ' : '') + 'The run started ' + dayWords(new Date(s.from).toISOString(), tz, { weekday: undefined }) + '.',
        why: s.n >= 6 ? 'Nobody else in the league has strung this many together.' : 'A run like this changes where a season is heading.',
        numbers: [{ label: 'run', value: 'W' + s.n }, { label: 'record', value: rec(c.w, c.l) }, pos ? { label: 'place', value: ordShort(pos.pos) } : null,
          { label: 'margin in the run', value: signed(s.games.reduce((sum, gid) => { const x = c.games.find(y => y.id === gid); return sum + (x ? x.for - x.against : 0); }, 0) / s.n) }],
        counter: above === 0 && s.n >= 3 && pos ? 'Yes, but none of the ' + spell(s.n) + ' came against a side above them in the table.' : null,
        next: nextText(id) ? 'It goes on the line when ' + nextText(id) + '.' : null,
        body: [record ? 'It is already their longest run of the season.' : null],
        teams: [id], games: s.games, tracks: { metric: 'run', value: s.n }, importance: 6 + Math.min(3, s.n / 2), magnitude: Math.min(1, s.n / 8),
        stakes: pos ? Math.max(0.3, 1 - (pos.pos - 1) / Math.max(1, pos.of)) : 0.5, lastAt: c.lastAt,
        angles: ['how the run was built, game by game', 'what changed: the numbers before and during it'], links: [teamLink(id)].filter(Boolean)
      });
    } else if (!s.won && s.n >= 4) {
      story({
        id: 'skid:' + id, kind: 'skid', kicker: 'The slide', head: name(id) + ' have lost ' + spell(s.n) + ' straight',
        dek: (pos ? place(pos.pos).charAt(0).toUpperCase() + place(pos.pos).slice(1) + ' at ' + rec(c.w, c.l) + '. ' : '') + 'The last win was ' + spell(s.n) + ' games ago.',
        why: 'Every defeat now costs ground that is hard to win back.',
        numbers: [{ label: 'run', value: 'L' + s.n }, { label: 'record', value: rec(c.w, c.l) }, { label: 'average margin', value: signed(c.diff || 0) }],
        counter: c.close.l >= 2 && s.n >= 4 ? 'Yes, but ' + spell(c.close.l) + ' of their defeats this season were by five or fewer: the margins are small.' : null,
        next: nextText(id) ? 'The next chance: ' + nextText(id) + '.' : null,
        teams: [id], games: s.games, tracks: { metric: 'skid', value: s.n }, importance: 5 + Math.min(2, s.n / 3), magnitude: Math.min(1, s.n / 8), stakes: 0.5, lastAt: c.lastAt,
        angles: ['what has gone wrong, in the numbers', 'the one fixture that could end it'], links: [teamLink(id)].filter(Boolean)
      });
    }
  });

  /* ---- THE UNBEATEN AND THE WINLESS ------------------------------------------------------------------------ */
  C.forEach((c, id) => {
    if (c.gp >= 4 && c.l === 0) story({ id: 'perfect:' + id, kind: 'perfect', kicker: 'Unbeaten', head: name(id) + ' are still perfect at ' + rec(c.w, 0),
      dek: 'Average margin ' + signed(c.diff || 0) + '.', why: 'Every week the question is who stops them.', teams: [id], games: c.games.slice(-3).map(x => x.id),
      next: nextText(id) ? 'Next to try: ' + nextText(id) + '.' : null, tracks: { metric: 'w', value: c.w }, importance: 8, magnitude: Math.min(1, c.w / 10), stakes: 1, lastAt: c.lastAt,
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
        : name(id) + ' are better than ' + rec(c.w, c.l),
      dek: 'Points for and against say about ' + spell(Math.round(exp)) + ' wins from ' + spell(c.gp) + ' games; they have ' + spell(c.w) + '.',
      why: lucky ? 'Records built on close finishes tend to drift back towards the points.' : 'A side that outscores people like this usually gets the wins in the end.',
      numbers: [{ label: 'record', value: rec(c.w, c.l) }, { label: 'expected wins', value: one(exp) }, { label: 'points for, a game', value: one(c.ppg) }, { label: 'against', value: one(c.papg) },
        { label: 'in games decided by five or fewer', value: rec(c.close.w, c.close.l) }],
      counter: lucky ? 'Yes, but closing out tight games is a skill too: they are ' + rec(c.close.w, c.close.l) + ' in them.' : null,
      next: nextText(id) ? 'Next: ' + nextText(id) + '.' : null, teams: [id], tracks: { metric: 'luck', value: Math.round(luck * 2) / 2 },
      importance: 5.5, magnitude: Math.min(1, Math.abs(luck) / 4), stakes: 0.6, lastAt: c.lastAt, under: true,
      angles: ['a data piece: the record against the points', 'what the close games have in common'], links: [teamLink(id)].filter(Boolean)
    });
  });

  /* ---- WHAT WINS FOR THEM: the facet that separates a club's wins from its losses (What Wins, per game) ------ */
  ID.forEach((x, id) => {
    const c = C.get(id);
    if (!c || c.gp < 6 || !x.top || x.top.gap < 4) return;
    story({
      id: 'identity:' + id, kind: 'identity', kicker: 'What wins for them', head: name(id) + ' win and lose on ' + FACET[x.top.k],
      dek: 'In their wins ' + FACET[x.top.k] + ' has been worth ' + signed(x.top.win) + ' points a game to them; in their defeats, ' + signed(x.top.loss) + '.',
      why: 'It is the single thing that most separates their good nights from their bad ones' + (o.model && o.model.b ? ', weighed by what wins in this league.' : '.'),
      numbers: x.all.map(f => ({ label: FACET[f.k], value: signed(f.win) + ' / ' + signed(f.loss), note: 'in wins / in defeats' })),
      next: nextText(id) ? 'Watch it next when ' + nextText(id) + '.' : null, teams: [id], tracks: { metric: 'facet', value: x.top.k },
      importance: 5, magnitude: Math.min(1, x.top.gap / 12), stakes: 0.5, lastAt: c.lastAt, evergreen: true,
      angles: ['a data piece: the one number to watch in their games', 'a coach’s-eye preview built on it'], links: [teamLink(id)].filter(Boolean)
    });
  });

  /* ---- THE PLAYERS: on a tear, a run of 20-point nights, the season's best nights, a milestone in reach ------ */
  const recent = nowMs - 10 * DAY;
  PL.forEach((p, pid) => {
    const nm = pname(pid);
    if (!nm || p.gp < 4) return;
    const club = p.team ? name(p.team) : null;
    const cl = club ? ' for ' + club : '';
    if (p.run20 >= 3) {
      story({ id: 'scoring:' + pid, kind: 'scoring', kicker: 'On a tear', head: nm + ' has scored 20 or more in ' + spell(p.run20) + ' straight games',
        dek: one(p.last5ppg) + ' points a game over the last five' + cl + ', against ' + one(p.ppg) + ' for the season.',
        why: 'Nobody guards a scorer in this kind of form with one player.',
        numbers: [{ label: 'run', value: String(p.run20) }, { label: 'last five', value: one(p.last5ppg) + ' ppg' }, { label: 'season', value: one(p.ppg) + ' ppg' }, { label: 'season high', value: String(p.high.pts.pts) }],
        next: p.team && nextText(p.team) ? 'The run goes on the line when ' + nextText(p.team) + '.' : null,
        teams: p.team ? [p.team] : [], players: [pid], games: p.games.slice(-p.run20).map(x => x.game), tracks: { metric: 'run20', value: p.run20 },
        importance: 6 + Math.min(2, p.run20 / 3), magnitude: Math.min(1, p.run20 / 8), stakes: 0.6, lastAt: p.lastAt,
        angles: ['a player feature', 'a shot chart and a clip from each of the games'], links: [playerLink(pid), teamLink(p.team)].filter(Boolean) });
    } else if (p.gp >= 8 && p.last5ppg != null && p.prev5ppg != null && p.last5ppg - p.prev5ppg >= 6 && p.last5ppg >= 14 && p.lastAt >= recent) {
      story({ id: 'form:' + pid, kind: 'form', kicker: 'In form', head: nm + ' is scoring ' + one(p.last5ppg) + ' a game over the last five' + cl,
        dek: 'Up from ' + one(p.prev5ppg) + ' before that.', why: 'A jump like this is a role changing or a player clicking, and both are worth a look.',
        numbers: [{ label: 'last five', value: one(p.last5ppg) + ' ppg' }, { label: 'before', value: one(p.prev5ppg) + ' ppg' }, { label: 'minutes', value: one(p.mpg) }],
        teams: p.team ? [p.team] : [], players: [pid], games: p.games.slice(-5).map(x => x.game), tracks: { metric: 'last5', value: Math.round(p.last5ppg) },
        importance: 5, magnitude: Math.min(1, (p.last5ppg - p.prev5ppg) / 12), stakes: 0.5, lastAt: p.lastAt, under: true,
        angles: ['what changed: minutes, role, shot diet'], links: [playerLink(pid)].filter(Boolean) });
    }
    /* a milestone in reach: the season's points within reach of the next hundred, from 200 up */
    const next = Math.floor(p.pts / 100) * 100 + 100, need = next - p.pts;
    if (p.pts >= 180 && need <= Math.max(8, Math.round(p.ppg * 0.9)) && p.team && nextOf(p.team)) {
      story({ id: 'milestone:' + pid + ':' + next, kind: 'milestone', kicker: 'Milestone watch', head: nm + ' is ' + spell(need) + ' points from ' + next + ' this season',
        dek: one(p.ppg) + ' a game' + cl + '; ' + plural(p.gp, 'game') + ' so far.', next: 'It could come when ' + nextText(p.team) + '.',
        teams: [p.team], players: [pid], tracks: { metric: 'need', value: need }, importance: 3.5, magnitude: Math.min(1, next / 1000), stakes: 0.3, lastAt: p.lastAt,
        angles: ['a social post ready for the night it happens'], links: [playerLink(pid)].filter(Boolean) });
    }
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
  if (S.size === 1 && maxGp >= 6) {
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
    .map(g => ({ g, r: recaps[g.id], s: recapScore(g, recaps[g.id], posOf) })).sort((a, b) => b.s - a.s || time(b.g.tipoff_at) - time(a.g.tipoff_at))[0];
  if (gw && gw.s >= 2.5) {
    story({ id: 'gotw:' + gw.g.id, kind: 'gotw', kicker: 'Game of the week', head: gw.r.headline, dek: gw.r.standfirst || null,
      why: [ARC_WORDS[gw.r.arc] ? cap(ARC_WORDS[gw.r.arc]) + '.' : null,
        gw.r.moment ? gw.r.moment.name + (gw.r.moment.kind === 'gameWinner' ? ' won it at the death.' : ' put them ahead for good late on.') : null].filter(Boolean).join(' ') || null,
      numbers: gw.r.decisive ? [{ label: 'what decided it', value: gw.r.decisive.label + ', about ' + Math.round(gw.r.decisive.pts) + ' points' }] : [],
      teams: [gw.g.home_team_id, gw.g.away_team_id], games: [gw.g.id], tracks: { metric: 'game', value: gw.g.id }, importance: 6, magnitude: Math.min(1, gw.s / 6), stakes: 0.5,
      lastAt: time(gw.g.tipoff_at), angles: ['the recap, rewritten as a feature with the moments in it', 'a clip of the finish'], links: [gameLink(gw.g.id)] });
  }

  /* ---- THE UPSETS AND THE GAMES OF THE WEEK, from the match reports' recaps ---------------------------------- */
  games.filter(g => time(g.tipoff_at) >= nowMs - 7 * DAY).forEach(g => {
    const hs = +g.home_score, as = +g.away_score, w = hs > as ? g.home_team_id : g.away_team_id, l = hs > as ? g.away_team_id : g.home_team_id;
    const pw = posOf.get(w), pl = posOf.get(l), r = recaps[g.id] || null;
    const gap = pw && pl ? pw.pos - pl.pos : 0;
    const cw = C.get(w), cl = C.get(l);
    if (gap >= 4 && cw && cl && cw.gp >= 4 && cl.gp >= 4) {
      story({ id: 'upset:' + g.id, kind: 'upset', kicker: 'Upset', head: r && r.headline ? r.headline : name(w) + ' beat ' + name(l) + ' ' + Math.max(hs, as) + '–' + Math.min(hs, as),
        dek: name(w) + ' (' + ordShort(pw.pos) + ') beat ' + name(l) + ' (' + ordShort(pl.pos) + ').' + (r && r.decisive ? ' ' + cap(r.decisive.label) + ' was worth about ' + Math.round(r.decisive.pts) + ' points to them.' : ''),
        why: 'Results like this are where tables get rearranged.', teams: [w, l], games: [g.id], tracks: { metric: 'game', value: g.id },
        importance: 6 + Math.min(2, gap / 4), magnitude: Math.min(1, gap / 8), stakes: 0.7, lastAt: time(g.tipoff_at),
        angles: ['the recap', 'what the winners did that nobody expected'], links: [gameLink(g.id)] });
    }
  });

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
  const used = new Map(), ranked = [], later = [];
  out.forEach(s => {
    const over = (s.teams || []).some(t => (used.get(t) || 0) >= 2);
    if (ranked.length < 6 && over) { later.push(s); return; }
    ranked.push(s);
    if (ranked.length <= 6) (s.teams || []).forEach(t => used.set(t, (used.get(t) || 0) + 1));
  });
  const stories = ranked.concat(later).map((s, i) => Object.assign(s, { rank: i + 1 }));
  /* the copy a creator takes away: the headline, the line under it, the why, the numbers, the counterpoint and what's next */
  stories.forEach(s => {
    s.copy = [s.head, s.dek, s.why ? 'Why it matters: ' + s.why : null, s.numbers.length ? 'By the numbers: ' + s.numbers.map(n => n.label + ' ' + n.value).join('; ') : null,
      s.counter ? 'Yes, but: ' + s.counter : null, s.next ? 'What’s next: ' + s.next : null].filter(Boolean).join('\n');
  });

  const ctxObj = { nowMs, tz, C, S, posOf, name, short, fixtures, games, recaps, tallies, P, model: o.model, LENS, PL, pname, ID, F, maxGp, qualifiers, nextText };
  /* the clubs the file names, so a page can draw a slate or a link without asking for them */
  const clubsOut = {};
  new Set(games.concat(fixtures).flatMap(g => [g.home_team_id, g.away_team_id])).forEach(id => {
    const t = T.get(id);
    if (t) clubsOut[id] = { name: String(t.name || ''), short: t.short_name || null, slug: t.slug || null };
  });
  return {
    v: 1, built: builtIso, clubs: clubsOut,
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
function recapScore(g, r, posOf) {
  const m = Math.abs(g.home_score - g.away_score);
  const w = +g.home_score > +g.away_score ? g.home_team_id : g.away_team_id, l = w === g.home_team_id ? g.away_team_id : g.home_team_id;
  const pw = posOf.get(w), pl = posOf.get(l);
  const upset = pw && pl && (pw.gp || 0) >= 3 && (pl.gp || 0) >= 3 ? Math.max(0, pw.pos - pl.pos) : 0;
  const arc = r && r.arc ? ({ heist: 3, collapse: 3, comeback: 2.5, overtime: 2.5, seesaw: 1.5, heldOn: 1.5, tight: 1.5, pulledAway: 1, wire: 0.5, rout: 0.5 }[r.arc] || 0) : 0;
  return arc + (m <= 3 ? 2 : m <= 6 ? 1 : 0) + Math.min(3, upset / 2) + (r && r.moment ? (r.moment.kind === 'gameWinner' ? 2.5 : 1.5) : 0);
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
    if (pa && pb && Math.min(pa.gp || 0, pb.gp || 0) >= 3) bits.push(ordShort(pa.pos) + ' against ' + ordShort(pb.pos));
    if (turn) bits.push('the numbers say it turns on ' + turn.label);
    if (met.length) bits.push(met.length === 1 ? 'a rematch' : 'meeting ' + spell(met.length + 1) + ' this season');
    const angle = cap(bits.join('; ')) || null;
    return {
      game: g.id, at: g.tipoff_at, day: dayWords(g.tipoff_at, X.tz), title, angle, stakes,
      home: { id: a, rank: pa ? pa.pos : null, rec: ca ? rec(ca.w, ca.l) : null, form: ca ? ca.last5.join('') : '', streak: ca && ca.streak ? (ca.streak.won ? 'W' : 'L') + ca.streak.n : null, watch: watchP(a) },
      away: { id: b, rank: pb ? pb.pos : null, rec: cb ? rec(cb.w, cb.l) : null, form: cb ? cb.last5.join('') : '', streak: cb && cb.streak ? (cb.streak.won ? 'W' : 'L') + cb.streak.n : null, watch: watchP(b) },
      expect: ex ? { margin: Math.round(ex.margin * 10) / 10, favourite: ex.margin >= 0 ? a : b, model: ex.model } : null,
      turn, meetings: met.length ? { played: met.length, winsHome: winsA, winsAway: met.length - winsA } : null, fans,
      plan: stakes >= 1.1 ? ['a full preview the day before', 'a live thread', 'the recap and the numbers that decided it']
        : stakes >= 0.8 ? ['a short preview', 'the recap'] : ['the recap if it surprises']
    };
  }).sort((x, y) => y.stakes - x.stakes || time(x.at) - time(y.at));
}

/* ============================================================ the coverage === */
/* THE COVERAGE PLAN, for the creator hub: how a desk that followed this league would cover the next week, in full. */
function coverage(stories, X) {
  const live = stories.filter(s => s.status !== 'resolved');
  /* THE BIG PICTURE: the state of the league in a few paragraphs */
  const big = [];
  const groups = [...X.S.entries()];
  if (groups.length && X.maxGp >= 3) {
    groups.slice(0, 3).forEach(([g, rows]) => {
      const pl = rows.filter(r => r.gp > 0);
      if (pl.length < 3) return;
      const a = pl[0], b = pl[1], gap = gb(a, b);
      const where = g ? (/\s/.test(g) ? ' In ' + g + ', ' : ' In Group ' + g + ', ') : '';
      big.push(cap((where ? where.trim() + ' ' : '') + X.name(a.team_id) + ' lead at ' + rec(a.w, a.l) + (gap > 0 ? ', ' + gamesWord(gap) + ' clear of ' + X.name(b.team_id) : ', level with ' + X.name(b.team_id)) +
        '. ' + (() => { const n = pl.filter(r => gb(a, r) <= 2).length - 1;
          return n <= 0 ? 'Nobody else is within two games of them.' : 'There ' + (n === 1 ? 'is one club' : 'are ' + plural(n, 'club')) + ' within two games of them.'; })()));
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
    const score = recapScore(g, r, X.posOf);
    return { game: g.id, at: g.tipoff_at, score: Math.round(score * 10) / 10, headline: r && r.headline ? r.headline : X.name(w) + ' beat ' + X.name(l) + ' ' + Math.max(+g.home_score, +g.away_score) + '–' + Math.min(+g.home_score, +g.away_score),
             standfirst: r && r.standfirst || null, angle: r && r.decisive ? cap(r.decisive.label) + ' decided it, about ' + Math.round(r.decisive.pts) + ' points' : null, arc: r && r.arc || null };
  }).sort((a, b) => b.score - a.score || time(b.at) - time(a.at)).slice(0, 8);

  /* PLAYERS TO FEATURE */
  const players = [];
  stories.filter(s => ['scoring', 'form', 'best', 'milestone'].indexOf(s.kind) >= 0 && s.status !== 'resolved').forEach(s => players.push({ story: s.id, pid: (s.players || [])[0], head: s.head, dek: s.dek, angle: (s.angles || [])[0] || null }));

  /* CLUBS TO FEATURE: identity, the record against the points, the run they are on, what is next */
  const teams = [];
  X.C.forEach((c, id) => {
    if (c.gp < 3) return;
    const idn = X.ID.get(id), pos = X.posOf.get(id);
    teams.push({ id, name: X.name(id), rank: pos ? pos.pos : null, rec: rec(c.w, c.l), form: c.last5.join(''),
      identity: idn && idn.top && idn.top.gap >= 3 ? cap(FACET[idn.top.k]) + ' separates their wins from their defeats' : null,
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
  put(roundUp, { kind: 'roundup', what: 'The week in the league: the results, the table, and the storylines that moved.' });
  const calendar = [...days.values()].sort((a, b) => time(a.at) - time(b.at)).slice(0, 8);

  return {
    bigPicture: big.map(clean).filter(Boolean),
    storylines: live.slice(0, 10).map(s => s.id),
    underRadar: stories.filter(s => s.under && s.status !== 'resolved').slice(0, 3).map(s => s.id),
    slate: sl, recaps, players: players.slice(0, 8), teams: teams.slice(0, 10), notes, calendar
  };
}

return { build, __x: { clubs, standings, facets, identities, lens, playerSeason, profiles, expect, slate, briefing, coverage, changeNote, endNote } };
}));
