'use strict';
/* ============================================================================
   VS UNITS — a player's per-75 box score, and his own numbers against the
   other side's starters and against its bench.         window.EpinoiaVsUnits

   PER 75 (index_9's "per 75 lineup possessions"): a count times 75 over the
   possessions his team had while he was on the floor (season.js on_poss, the
   same possessions every per-100 rate there divides by). A player who plays
   twelve minutes and one who plays thirty-six are read at the same rate, and
   nobody is flattered by his team's pace, which per game and per minute both
   are. Under 20 possessions it is noise and left null, as the per-100s are.

   AGAINST THE STARTERS AND THE BENCH (index_9's player VS Starters, and the
   club page's split): his minutes are cut wherever either five changes, and
   each stretch is filed by who the other side had on.
     AGAINST THE STARTERS: 4+ of its regular starters (players with N starts
       or more for their club in the scope; the club card's N, 10 by default)
       or 4+ of that game's starting five;
     AGAINST THE BENCH: every other minute.
   ALL is the two together, so they always add up to it.

   NOTHING HERE IS A NEW DEFINITION. The replay is engine.deriveGame itself:
   his box, and both sides' boxes while he was on (the on-court block every
   on/off figure is built from), are the engine's own, read at each change of
   five through its read-only observer. Each part becomes a season line through
   season.js: one synthetic game with his box in it, and the two sides' boxes
   while he was on as its team lines, so every rate is the season line's own
   formula over the minutes it covers. Per-game figures are his rate a minute
   times his minutes a game (a split is slices of games, and a per-game average
   of its own would divide by a number that does not exist).

   The page replays only the games it has already read for "on the floor
   with", so the split reads nothing of its own except the scope's starters
   (one small read, for who the regular starters are) and the engine, and
   only when it is asked for.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVsUnits = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const r1 = v => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);

/* ---------------------------------------------------------------- per 75 --- */
const P75 = Object.freeze([['pts', 'pts_p75'], ['fgm', 'fgm_p75'], ['fga', 'fga_p75'], ['p3m', 'p3m_p75'], ['p3a', 'p3a_p75'],
  ['ftm', 'ftm_p75'], ['fta', 'fta_p75'], ['oreb', 'oreb_p75'], ['dreb', 'dreb_p75'], ['reb', 'reb_p75'],
  ['ast', 'ast_p75'], ['stl', 'stl_p75'], ['blk', 'blk_p75'], ['tov', 'tov_p75'], ['pf', 'pf_p75']]);
const MIN_POSS = 20;
/* a season line's per-75 figures, put on the line itself (so the popup's chart and the percentiles read them
   like any other key). Idempotent. */
function per75(row) {
  if (!row) return row;
  const p = row.on_poss;
  const ok = typeof p === 'number' && isFinite(p) && p >= MIN_POSS;
  P75.forEach(([t, k]) => { row[k] = ok && typeof row[t] === 'number' && isFinite(row[t]) ? r1(75 * row[t] / p) : null; });
  return row;
}

/* ------------------------------------------------------- who is a starter --- */
/* every game's starters in the scope -> Map(club id -> Set of the players with `min` starts or more for it).
   The club page's own count (t/seasonline.js regularStarters), which a test holds this to. */
function regularStarters(games, min) {
  const count = new Map();
  (games || []).forEach(g => {
    if (!g || !Array.isArray(g.starters)) return;
    [g.home_team_id, g.away_team_id].forEach((t, i) => {
      const five = g.starters[i];
      if (!t || !Array.isArray(five)) return;
      let c = count.get(t);
      if (!c) { c = new Map(); count.set(t, c); }
      new Set(five.filter(Boolean)).forEach(p => c.set(p, (c.get(p) || 0) + 1));
    });
  });
  const out = new Map();
  count.forEach((c, t) => out.set(t, new Set([...c].filter(([, n]) => n >= min).map(([p]) => p))));
  return out;
}
/* the other side's five, read the club page's way: 'start' with 4+ of that game's starting five (a whole five against
   a whole five, as lineupevents.js counts it) or 4+ of its regular starters on; 'bench' every other minute */
function unitOf(five, gameFive, regular) {
  const f = (five || []).filter(Boolean);
  const nGame = f.length === 5 && Array.isArray(gameFive) && gameFive.length >= 5
    ? f.reduce((n, p) => n + (gameFive.indexOf(p) !== -1 ? 1 : 0), 0) : 0;
  const nReg = regular && regular.size ? f.reduce((n, p) => n + (regular.has(p) ? 1 : 0), 0) : 0;
  return nGame >= 4 || nReg >= 4 ? 'start' : 'bench';
}

/* ---------------------------------------------------------------- replay --- */
const DESC = { loc: 1, tag: 1, stype: 1 };
/* a numeric copy of his engine box, the on-court block with it */
function snap(s) {
  const o = { oc: {} };
  if (!s) return o;
  for (const k in s) if (k !== 'oc' && typeof s[k] === 'number') o[k] = s[k];
  for (const k in (s.oc || {})) o.oc[k] = num(s.oc[k]);
  return o;
}
function blankAcc() { return { min: 0, box: { oc: {} }, t3a: 0, o3a: 0, games: new Set() }; }
/* what happened between two copies of his box goes to acc; minutes are not taken from it (the engine credits a stint's
   minutes when he leaves the floor), they are the stretch's own length */
function addDelta(acc, now, then) {
  for (const k in now) if (k !== 'oc' && k !== 'min') acc.box[k] = num(acc.box[k]) + now[k] - num(then[k]);
  for (const k in now.oc) acc.box.oc[k] = num(acc.box.oc[k]) + now.oc[k] - num(then.oc[k]);
}
function merge(dst, src) {
  dst.min += src.min; dst.t3a += src.t3a; dst.o3a += src.o3a;
  for (const k in src.box) if (k !== 'oc') dst.box[k] = num(dst.box[k]) + num(src.box[k]);
  for (const k in src.box.oc) dst.box.oc[k] = num(dst.box.oc[k]) + num(src.box.oc[k]);
  src.games.forEach(g => dst.games.add(g));
  return dst;
}
const fiveKey = (a, b) => a.slice().sort().join(',') + '|' + b.slice().sort().join(',');

/* ONE GAME. g: { id, starters: [[ids], [ids]], events (data.js events()), period, home_team_id, away_team_id };
   opt: { regular: Map (regularStarters), Engine } -> { ok, id, side, start, bench } or { ok: false, why } */
function gameSplit(g, pid, opt) {
  const E = (opt && opt.Engine) || root.EpinoiaEngine;
  const fail = why => ({ ok: false, why, id: g && g.id });
  if (!E || typeof E.deriveGame !== 'function') return fail('engine');
  const st = g && g.starters;
  if (!Array.isArray(st) || !Array.isArray(st[0]) || !Array.isArray(st[1]) || !st[0].length || !st[1].length) return fail('starters');
  const evs = ((g && g.events) || []).filter(Boolean);
  let side = st[0].indexOf(pid) !== -1 ? 0 : st[1].indexOf(pid) !== -1 ? 1 : null;
  if (side == null) {
    const e = evs.find(x => (x.t === 'sub' && x.in === pid) || x.pid === pid);
    side = e && (e.team === 0 || e.team === 1) ? e.team : null;
  }
  if (side == null) return fail('absent');
  const o = 1 - side;
  const oppTeam = o === 0 ? g.home_team_id : g.away_team_id;
  const reg = opt && opt.regular && oppTeam ? (opt.regular.get(oppTeam) || null) : null;
  const out = { ok: true, id: g.id, side, start: blankAcc(), bench: blankAcc() };

  const seg = (mine, theirs, at) => ({ on: mine.indexOf(pid) !== -1, unit: unitOf(theirs, st[o], reg), start: num(at),
    key: fiveKey(mine, theirs), t3a: 0, o3a: 0 });
  let cur = seg(st[side], st[o], 0), last = snap(null);
  const close = (box, at) => {
    const now = snap(box);
    if (cur.on) {
      const acc = out[cur.unit], len = Math.max(0, num(at) - cur.start);
      acc.min += len; acc.t3a += cur.t3a; acc.o3a += cur.o3a;
      addDelta(acc, now, last);
      if (len > 0) acc.games.add(g.id);
    }
    last = now;                                   // anything while he sat (a bench technical) is nobody's split
  };
  const observe = (ev, d, cum) => {
    if (ev.t === 'sub') {
      const k = fiveKey(d.onCourt[side], d.onCourt[o]);
      if (k !== cur.key) { close(d.stats[pid], cum); cur = seg(d.onCourt[side], d.onCourt[o], cum); }
      return;
    }
    if (DESC[ev.t] || !cur.on) return;
    /* the engine's on-court block has no three-point attempts; the team lines need them (spacing, opponents' twos) */
    if (ev.t === 'p3_made' || ev.t === 'p3_miss') { if (ev.team === side) cur.t3a++; else if (ev.team === o) cur.o3a++; }
  };

  const lastPeriod = evs.reduce((m, e) => Math.max(m, num(e.period)), 0) || num(g.period) || 4;
  const period = Math.max(lastPeriod, num(g.period));
  const me = [{ id: pid }];
  let d;
  try {
    d = E.deriveGame({ teams: side === 0 ? [{ players: me }, { players: [] }] : [{ players: [] }, { players: me }],
                       starters: [st[0].slice(), st[1].slice()], events: evs, period, clockMs: 0, observe });
  } catch (e) { return fail('replay'); }
  close(d.stats[pid], E.cumEl(period, 0, d.format));
  return out;
}

/* every game -> { read, games, start, bench, all } (all = start + bench; games: those he was on the floor in) */
function split(games, pid, opt) {
  const res = { read: 0, games: 0, start: blankAcc(), bench: blankAcc(), all: blankAcc(), skipped: {} };
  (games || []).forEach(g => {
    const r = gameSplit(g, pid, opt);
    if (!r.ok) { res.skipped[r.why] = (res.skipped[r.why] || 0) + 1; return; }
    res.read++;
    merge(res.start, r.start); merge(res.bench, r.bench);
    merge(res.all, r.start); merge(res.all, r.bench);
  });
  res.games = res.all.games.size;
  return res;
}

/* --------------------------------------------------------- as a season line --- */
/* the per-game figures of a season line: his rate a minute times his minutes a game, for a part */
const PER_GAME = Object.freeze(['ppg', 'rpg', 'apg', 'spg', 'bpg', 'topg', 'pfpg', 'orpg', 'drpg', 'fdpg',
  'fgm_pg', 'fga_pg', 'p3m_pg', 'p3a_pg', 'ftm_pg', 'fta_pg', 'ptsAst_pg', 'contrib_pg', 'paint_pg', 'fast_pg', 'sc_pg', 'pot_pg',
  'rim_apg', 'mid_apg', 'p3_apg', 'ft_apg']);
/* what a part has no way to say: on/off (a part is all "on"), box plus/minus (a whole squad's season), the events splits
   (the situations lines are per game), the rim defence (it needs his minutes off) */
const NOT_SPLIT = /^(diff_|off_|vs_off_|ev_|evd_|def_rim_)|^(bpm|obpm|dbpm|vorp|bpm_pos|bpm_role|on_net|off_net|diff_pace|off_pace)$/;
const splitable = k => !NOT_SPLIT.test(String(k));

/* one part (start, bench or all) as a season line, by season.js itself. base: { min (ms), games } of ALL, for the
   per-game figures and minutes a game. null for a part he never played in. */
function lineOf(acc, base, Season) {
  const S = Season || root.EpinoiaSeason;
  if (!S || !acc || !(acc.min > 0)) return null;
  const mins = acc.min / 60000, b = acc.box, oc = b.oc || {};
  const stats = { dq: false };
  for (const k in b) if (k !== 'oc' && k !== 'dq') stats[k] = b[k];
  stats.min = acc.min;
  stats.oc = Object.assign({}, oc);
  const side = (p, a3) => ({ adv: { pts: num(oc[p + 'PTS']), fgm: num(oc[p + 'FGM']), fga: num(oc[p + 'FGA']), fg3m: num(oc[p + '3M']),
    fg3a: num(a3), fta: num(oc[p + 'FTA']), oreb: num(oc[p + 'OR']), dreb: num(oc[p + 'DR']), tov: num(oc[p + 'TOV']), minutes: 5 * mins } });
  const rows = S.finishPlayers(S.addPlayers(new Map(), [{ game_id: 'vs', player_id: 'vs', team_idx: 0, stats }],
    [{ game_id: 'vs', team_idx: 0, stats: side('t', acc.t3a) }, { game_id: 'vs', team_idx: 1, stats: side('o', acc.o3a) }]));
  const L = rows && rows[0];
  if (!L) return null;
  const g = base && base.games > 0 ? base.games : null;
  const mpg = g ? base.min / 60000 / g : null;
  PER_GAME.forEach(k => { if (L[k] != null) L[k] = mpg != null ? r1(L[k] / mins * mpg) : null; });
  L.mpg = g ? r1(mins / g) : null;
  L.gp = acc.games.size;
  L.min = r1(mins);
  return per75(L);
}

/* the three lines of a split() result */
function lines(sp, Season) {
  const base = { min: sp.all.min, games: sp.games };
  return { all: lineOf(sp.all, base, Season), start: lineOf(sp.start, base, Season), bench: lineOf(sp.bench, base, Season) };
}

/* --------------------------------------------------------------- ranking --- */
/* where v would sit among vals (ascending): season.js percentiles()'s own count of the values strictly below, for a
   value that need not be one of them */
function placeIn(vals, v, low) {
  if (v == null || !isFinite(v) || !vals || vals.length < 3) return null;
  let lo = 0, hi = vals.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (vals[mid] < v) lo = mid + 1; else hi = mid; }
  let p = 100 * lo / (vals.length - 1 || 1);
  if (low) p = 100 - p;
  return Math.max(0, Math.min(100, p));
}
function sortedOf(rows, key) {
  return (rows || []).map(r => r && r[key]).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
}

/* ------------------------------------------------------------ the engine --- */
/* loaded on the first ask, from beside this file and with its ?v= stamp, so a profile nobody splits never fetches it */
const SELF = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
let engineP = null;
function loadEngine() {
  if (root.EpinoiaEngine) return Promise.resolve(root.EpinoiaEngine);
  if (typeof document === 'undefined' || !SELF) return Promise.resolve(null);
  if (engineP) return engineP;
  engineP = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = SELF.replace(/vsunits\.js(\?.*)?$/, 'engine.js$1');
    s.onload = () => resolve(root.EpinoiaEngine || null);
    s.onerror = () => { engineP = null; resolve(null); };
    (document.head || document.documentElement).appendChild(s);
  });
  return engineP;
}

return { P75, MIN_POSS, per75, regularStarters, unitOf, gameSplit, split, lineOf, lines, PER_GAME, splitable,
         placeIn, sortedOf, loadEngine };
}));
