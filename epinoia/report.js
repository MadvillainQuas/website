'use strict';
/* ============================================================================
   THE REPORT (2026-10-02, in place of the weekly report): a player's or a club's analysis as A4 pages, laid out on the
   screen exactly as they print. Each page is a 210 x 297 mm sheet (794 x 1123 CSS px at 96 dpi); the preview IS the
   document, so what is downloaded is what was read.

   MODULES. A report is a cover, then the modules the reader ticks, in order, then a legend of every statistic that
   appeared. A module is { key, title, on, build(ctx, opt, R) -> [block] }: it hands over blocks (DOM nodes) and the
   engine lays them onto pages. Each module starts a page of its own; a block that does not fit what is left of a page
   goes to the next one (the module's title carried as "continued"); a block taller than a whole page is drawn smaller
   to fit, never cut. report-playerpages.js and report-teampages.js hold the modules; the pages hand them their data (ctx).

   THE COVER. The aesthetic's own: the site's green-black, the club's colour as a glow, the name in the score face, the
   crest in the centre, the title and subtitle the reader typed, and the position breakdown (a player's minutes at each
   spot, or a club's most-used five) on a half court.

   STATISTICS. One catalogue (STATS) of everything a report can print for a player, with the derived ones a season row
   does not carry (the share of his assists that were threes, fouls a game, bad-pass and dribble turnovers). A stat is
   drawn with its value, its percentile in the field it is ranked in (green 75+, light green 50+, amber 25+, red below;
   a style - transition's share of points - in one neutral tone), its bar and the field's average. TEMPLATES are the
   stats a page prints in named groups: the defaults by position (guard, wing, big), and the reader's own, saved in this
   browser.

   OUT. Download PDF (every page as one A4 document), images (one PNG per page, a ZIP of them when there are several)
   and print (the browser's own, which can also save a PDF with its text kept as text). The first two draw each page
   to a canvas through raster.js.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReport = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const PAGE = { w: 794, h: 1123 };
const doc = () => root.document;
function el(t, c, x) { const n = doc().createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
function frag(html) { const d = doc().createElement('div'); d.innerHTML = html; return d; }
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => v != null && v !== '' && isFinite(+v);
function ordinal(n) {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}
const store = {
  get(k, d) { try { const v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* this page only */ } }
};

/* ---------------------------------------------------------------- the stats --- */
/* l: the label printed; dp: decimals; signed: a +; low: smaller is better; style: no good end (one neutral tone);
   rank false: printed without a percentile (a figure the field does not carry). Keys are the season rows' own
   (season.js), plus the derived ones below. */
const STATS = {
  gp: { l: 'GP', dp: 0, rank: false }, mpg: { l: 'MIN / G', dp: 1 }, ppg: { l: 'PTS / G', dp: 1 }, rpg: { l: 'REB / G', dp: 1 },
  apg: { l: 'AST / G', dp: 1 }, spg: { l: 'STL / G', dp: 1 }, bpg: { l: 'BLK / G', dp: 1 },
  vorp: { l: 'VORP', dp: 1, signed: true }, bpm: { l: 'BPM', dp: 1, signed: true }, obpm: { l: 'OBPM', dp: 1, signed: true },
  dbpm: { l: 'DBPM', dp: 1, signed: true },
  rapm: { l: 'RAPM', dp: 1, signed: true, rapm: true }, orapm: { l: 'ORAPM', dp: 1, signed: true, rapm: true },
  drapm: { l: 'DRAPM', dp: 1, signed: true, rapm: true },
  usg: { l: 'USG%', dp: 1, style: true }, ts: { l: 'TS%', dp: 1 }, efg: { l: 'eFG%', dp: 1 }, ftr: { l: 'FTr', dp: 1 },
  ft_pct: { l: 'FT%', dp: 1 }, fg_pct: { l: 'FG%', dp: 1 },
  au: { l: 'A/U', dp: 2 }, ast_to: { l: 'AST / TO', dp: 2 }, ast_pct: { l: 'AST%', dp: 1 }, hc_ast_pct: { l: 'HALF-COURT AST%', dp: 1 },
  ast3_sh: { l: "% OF ASSISTS THAT ARE 3'S", dp: 1, style: true }, ast2_sh: { l: "% OF ASSISTS THAT ARE 2'S", dp: 1, style: true },
  tov_pct: { l: 'TO%', dp: 1, low: true },
  rim_a100: { l: 'RIM VOL / 100', dp: 1, style: true }, rim_pct: { l: 'RIM%', dp: 1 }, ev_rim_astp: { l: 'RIM ASSISTED%', dp: 1, style: true },
  mid_a100: { l: 'MID VOL / 100', dp: 1, style: true }, mid_pct: { l: 'MID%', dp: 1 }, ev_mid_astp: { l: 'MID ASSISTED%', dp: 1, style: true },
  p3_a100: { l: '3PT VOL / 100', dp: 1, style: true }, p3_pct: { l: '3PT%', dp: 1 }, ev_p3_astp: { l: '3PT ASSISTED%', dp: 1, style: true },
  ev_transition_pts_sh: { l: 'TRANSITION %PTS', dp: 1, style: true },
  ev_half_efg: { l: 'HALF-COURT eFG%', dp: 1 }, ev_half_tov_pct: { l: 'HALF-COURT TO%', dp: 1, low: true },
  ev_half_ppp: { l: 'HALF-COURT PTS / CHANCE', dp: 2 }, ev_transition_ppp: { l: 'TRANSITION PTS / CHANCE', dp: 2 },
  stl_pct: { l: 'STL%', dp: 1 }, blk_pct: { l: 'BLK%', dp: 1 }, oreb_pct: { l: 'ORB%', dp: 1 }, dreb_pct: { l: 'DRB%', dp: 1 },
  trb_pct: { l: 'TRB%', dp: 1 },
  diff_efg: { l: 'TEAM eFG% ±', dp: 1, signed: true }, diff_tov: { l: 'TEAM TO% ±', dp: 1, signed: true, low: true },
  diff_oreb: { l: 'TEAM ORB ±', dp: 1, signed: true }, diff_vs_efg: { l: 'DEF TEAM eFG% ±', dp: 1, signed: true, low: true },
  diff_vs_oreb: { l: 'DEF ORB ±', dp: 1, signed: true, low: true }, diff_net: { l: 'NET ±', dp: 1, signed: true },
  def_rim_fg_pm: { l: 'DEF RIM FG% ±', dp: 1, signed: true, low: true }, def_rim_vol_pm: { l: 'DEF RIM VOL ±', dp: 1, signed: true, low: true },
  pf_pg: { l: 'FOULS CONCEDED / G', dp: 1, low: true }, pf30: { l: 'FOULS / 30', dp: 1, low: true },
  badpass_pg: { l: 'BAD PASS TO / G', dp: 1, low: true, rank: false, feed: true }, handle_pg: { l: 'DRIBBLE TO / G', dp: 1, low: true, rank: false, feed: true }
};

/* what each one means, for the legend: statinfo.js has most of them; these are the ones it does not */
const DEFS = {
  gp: ['Games played', 'Games in which he played a minute.'],
  orapm: ['Offensive RAPM', 'Regularised adjusted plus-minus, offence: points per 100 possessions he adds to his team’s offence once every teammate and opponent on the floor is accounted for (ridge regression over every stint of the league’s season).'],
  drapm: ['Defensive RAPM', 'The same regression’s defensive coefficient: points per 100 possessions he takes off the opponent’s offence. Higher is better.'],
  rapm: ['RAPM', 'Offensive plus defensive RAPM.'],
  hc_ast_pct: ['Half-court assist %', 'Of his teammates’ baskets in the half court while he was on the floor (not a second chance, a fast break or off a turnover), the share he assisted: how much of the set offence he creates. Worked out from every game’s play-by-play in the competition; blank under 20 such baskets.'],
  ast3_sh: ['Assists that were threes', 'Of the baskets he assisted, the share that were three-pointers (points off his assists minus two per assist).'],
  ast2_sh: ['Assists that were twos', 'Of the baskets he assisted, the share that were two-pointers.'],
  pf_pg: ['Fouls conceded a game', 'Personal fouls he commits per game. Fewer is better.'],
  badpass_pg: ['Bad-pass turnovers a game', 'Turnovers the feed typed as a bad pass, per game; only leagues whose feed types its turnovers have them.'],
  handle_pg: ['Dribble turnovers a game', 'Turnovers the feed typed as a ball-handling error (travelling, a lost dribble, a carry), per game.'],
  ev_transition_pts_sh: ['Transition share of points', 'The share of his points scored in transition: within eight seconds of a defensive rebound or a steal, or tagged a fast break.'],
  ev_half_efg: ['Half-court eFG%', 'Effective field-goal percentage on chances that were not a second chance, a fast break, off a turnover or after a timeout.'],
  ev_half_tov_pct: ['Half-court turnover %', 'Turnovers per half-court chance. Lower is better.'],
  ev_half_ppp: ['Half-court points per chance', 'Points scored per half-court chance (a trip that ends in a shot, a turnover or free throws).'],
  ev_transition_ppp: ['Transition points per chance', 'Points scored per transition chance.'],
  rim_a100: ['Rim volume', 'Shots at the rim per 100 of his team’s possessions while he is on the floor.'],
  mid_a100: ['Mid-range volume', 'Mid-range shots per 100 of his team’s possessions while he is on the floor.'],
  p3_a100: ['Three-point volume', 'Three-point attempts per 100 of his team’s possessions while he is on the floor.'],
  ev_rim_astp: ['Rim assisted %', 'Of his makes at the rim, the share that came off a pass.'],
  ev_mid_astp: ['Mid-range assisted %', 'Of his mid-range makes, the share that came off a pass.'],
  ev_p3_astp: ['Three-point assisted %', 'Of his made threes, the share that came off a pass.'],
  diff_efg: ['Team eFG% on/off', 'His team’s effective field-goal percentage with him on the floor minus with him off it.'],
  diff_tov: ['Team turnover % on/off', 'His team’s turnover percentage with him on minus off. Lower is better.'],
  diff_oreb: ['Team offensive rebounding on/off', 'His team’s offensive rebound percentage with him on minus off.'],
  diff_vs_efg: ['Defensive team eFG% on/off', 'The opponents’ effective field-goal percentage with him on the floor minus with him off it. Lower (negative) is better.'],
  diff_vs_oreb: ['Defensive offensive rebounding on/off', 'The opponents’ offensive rebound percentage with him on minus off. Lower is better.']
};
function defOf(k, kind) {
  if (DEFS[k]) return { title: DEFS[k][0], what: DEFS[k][1], formula: '' };
  const I = root.EpinoiaStatInfo, i = I && I.info ? I.info(k, kind) : null;
  if (i) return { title: i.title, what: i.what, formula: i.formula || '' };
  const s = STATS[k];
  return s ? { title: s.l, what: '', formula: '' } : null;
}

/* THE DERIVED ONES, on any season row (a player's or every row of the field): his assists' split from points off them
   (engine.js credits an assist 2 or 3 points, the basket it made), fouls a game from the season's total */
function derive(r) {
  if (!r || r.__rp) return r;
  r.__rp = true;
  const a = +r.ast, pa = +r.ptsAst;
  if (a > 0 && isNum(r.ptsAst)) {
    const a3 = Math.max(0, Math.min(a, pa - 2 * a));
    r.ast3_sh = Math.round(1000 * a3 / a) / 10;
    r.ast2_sh = Math.round(1000 * (a - a3) / a) / 10;
  }
  if (r.pf_pg == null) {
    if (isNum(r.pf) && +r.gp > 0) r.pf_pg = Math.round(10 * r.pf / r.gp) / 10;
    else if (isNum(r.pf30) && isNum(r.mpg)) r.pf_pg = Math.round(r.pf30 * r.mpg / 3) / 10;
  }
  /* half-court turnover %: a player's row has the half court's turnovers, shots and free throws but not the rate */
  if (r.ev_half_tov_pct == null && isNum(r.ev_half_tov) && isNum(r.ev_half_fga)) {
    const ch = +r.ev_half_fga + 0.44 * (+r.ev_half_fta || 0) + +r.ev_half_tov;
    if (ch > 0) r.ev_half_tov_pct = Math.round(1000 * r.ev_half_tov / ch) / 10;
  }
  if (r.spg == null && isNum(r.stl) && +r.gp > 0) r.spg = Math.round(10 * r.stl / r.gp) / 10;
  if (r.bpg == null && isNum(r.blk) && +r.gp > 0) r.bpg = Math.round(10 * r.blk / r.gp) / 10;
  return r;
}

/* the turnover types a feed records (a 'stype' event naming the play it describes): bad passes and ball-handling,
   per player, over the logs given ({gameId: [events]}) -> Map(pid -> {bad, handle, games}) */
const RX_PASS = /pass/i, RX_HANDLE = /travel|dribbl|carr|palm|handl|double/i;
function turnoverTypes(byG) {
  const out = new Map();
  Object.keys(byG || {}).forEach(gid => {
    const evs = byG[gid] || [];
    const typed = new Map();
    evs.forEach(e => {
      if (e.t !== 'stype') return;
      const p = e.payload || {}, v = e.v != null ? e.v : p.v, ref = e.ref != null ? e.ref : p.ref;
      if (v) typed.set(String(ref), String(v));
    });
    const seen = new Set();
    evs.forEach(e => {
      if (!e.pid) return;
      seen.add(e.pid);
      if (e.t !== 'to') return;
      const ty = typed.get(String(e.id != null ? e.id : e.seq)) || typed.get(String(e.seq)) || e.kind || (e.payload && (e.payload.sub || e.payload.kind)) || '';
      if (!ty) return;
      const o = out.get(e.pid) || { bad: 0, handle: 0, typed: 0, games: 0 };
      o.typed++;
      if (RX_PASS.test(ty)) o.bad++; else if (RX_HANDLE.test(ty)) o.handle++;
      out.set(e.pid, o);
    });
    seen.forEach(pid => { const o = out.get(pid); if (o) o.games++; });
  });
  return out;
}

/* HALF-COURT ASSIST %, for every player of a set of games (2026-10-02): of his teammates' baskets in the half court
   while he was on the floor, the share he assisted. The half court is the club report's (situations.js stamps: not a
   second chance, not off a turnover, not in transition); an assist belongs to the last made basket of its own side
   (situations.js's pairing); who was on the floor comes from each game's frozen starters and its substitutions
   (withstats.js's replay). A game whose feed logs no assist at all says nothing and is left out.
   games: [{ starters: [[ids], [ids]], events }] -> Map(pid -> { a: his assists on those baskets, m: those baskets }) */
const HC_MIN = 20;
function hcAssists(games) {
  const SI = root.EpinoiaSituations, out = new Map();
  if (!SI || !SI.inGameOrder || !SI.stamps) return out;
  const at = pid => { let o = out.get(pid); if (!o) out.set(pid, o = { a: 0, m: 0 }); return o; };
  (games || []).forEach(g => {
    const st = g && g.starters;
    if (!Array.isArray(st) || !Array.isArray(st[0]) || !Array.isArray(st[1]) || !st[0].length || !st[1].length) return;
    const evs = (g.events || []).filter(Boolean);
    if (!evs.some(e => e.t === 'ast')) return;
    let all, stamp;
    try {
      all = SI.inGameOrder(evs);
      stamp = SI.stamps(all.filter(e => !/^(loc|stype|tag|tags)$/.test(e.t)), (SI.describe ? SI.describe(all) : { tags: {} }).tags);
    } catch (_) { return; }
    const plays = all.filter(e => !/^(loc|stype|tag|tags)$/.test(e.t));
    const by = new Map();
    let last = null;
    plays.forEach(e => {
      if ((e.t === 'p2_made' || e.t === 'p3_made') && e.pid) last = e;
      else if (e.t === 'ast') { if (e.pid && last && last.team === e.team) by.set(last, e.pid); last = null; }
    });
    const on = [new Set(st[0]), new Set(st[1])];
    plays.forEach(e => {
      if (e.t === 'sub') { const s = on[e.team]; if (s) { if (e.out) s.delete(e.out); if (e.in) s.add(e.in); } return; }
      if (!(e.t === 'p2_made' || e.t === 'p3_made') || !(e.team === 0 || e.team === 1)) return;
      const sp = stamp.get(e);
      if (!sp || sp.second || sp.offTo || sp.transition) return;
      const who = by.get(e);
      on[e.team].forEach(pid => { if (pid !== e.pid) { const o = at(pid); o.m++; if (who === pid) o.a++; } });
      /* the passer was on the floor whatever the log's substitutions say */
      if (who && who !== e.pid && !on[e.team].has(who)) { const o = at(who); o.m++; o.a++; }
    });
  });
  return out;
}
/* the rate on a row, from hcAssists' tally: blank under HC_MIN baskets */
function hcAstOf(t) { return t && t.m >= HC_MIN ? Math.round(1000 * t.a / t.m) / 10 : null; }

/* ---------------------------------------------------------------- templates --- */
/* THE DEFAULTS BY POSITION (Louie, 2026-10-02). MAIN STATS, the player's page; PLAYERS, the club report's card rows. */
const TPL = {
  main: {
    guard: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
            ['SCORING', ['usg', 'ts', 'efg', 'ftr', 'ft_pct']],
            ['PLAYMAKING', ['au', 'hc_ast_pct', 'ast3_sh', 'ast2_sh', 'tov_pct']],
            ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'mid_a100', 'mid_pct', 'p3_a100', 'p3_pct', 'ev_p3_astp']],
            ['SITUATIONS', ['ev_transition_pts_sh', 'ev_half_efg', 'ev_half_tov_pct']],
            ['DEFENCE & GLASS', ['stl_pct', 'dreb_pct']],
            ['ON / OFF', ['diff_efg', 'diff_tov']]],
    wing: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
           ['SCORING', ['usg', 'ts', 'efg', 'ftr']],
           ['PLAYMAKING', ['au', 'tov_pct']],
           ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'p3_a100', 'p3_pct']],
           ['SITUATIONS', ['ev_transition_pts_sh', 'ev_half_efg']],
           ['DEFENCE & GLASS', ['stl_pct', 'blk_pct', 'oreb_pct', 'dreb_pct']],
           ['ON / OFF', ['diff_vs_efg']]],
    big: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
          ['SCORING', ['usg', 'ts', 'ft_pct', 'ftr']],
          ['PLAYMAKING', ['au', 'tov_pct']],
          ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'p3_a100', 'p3_pct']],
          ['RIM PROTECTION', ['def_rim_fg_pm', 'def_rim_vol_pm']],
          ['GLASS & DEFENCE', ['oreb_pct', 'dreb_pct', 'blk_pct', 'pf_pg']],
          ['ON / OFF', ['diff_oreb', 'diff_vs_oreb']]]
  },
  players: {
    guard: [['IMPACT', ['orapm', 'drapm', 'bpm']],
            ['SCORING', ['usg', 'ts', 'ftr']],
            ['PLAYMAKING', ['au', 'ast3_sh', 'ast2_sh', 'diff_efg']],
            ['HALF COURT', ['ev_half_efg', 'ev_half_tov_pct', 'badpass_pg', 'handle_pg', 'ev_transition_pts_sh']],
            ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'mid_pct', 'mid_a100', 'p3_a100', 'p3_pct', 'ev_p3_astp']],
            ['DEFENCE', ['stl_pct', 'dreb_pct']]],
    wing: [['IMPACT', ['orapm', 'drapm', 'bpm']],
           ['SCORING', ['usg', 'ts', 'ftr', 'au', 'tov_pct']],
           ['HALF COURT', ['ev_half_efg', 'ev_transition_pts_sh']],
           ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'mid_pct', 'mid_a100', 'p3_a100', 'p3_pct', 'ev_p3_astp']],
           ['DEFENCE & GLASS', ['stl_pct', 'blk_pct', 'dreb_pct', 'oreb_pct', 'diff_vs_efg']]],
    big: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
          ['SCORING', ['usg', 'ts', 'ft_pct', 'ftr', 'au', 'tov_pct']],
          ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'p3_a100', 'p3_pct']],
          ['RIM PROTECTION', ['def_rim_fg_pm', 'def_rim_vol_pm']],
          ['GLASS', ['oreb_pct', 'dreb_pct', 'blk_pct', 'pf_pg', 'diff_oreb', 'diff_vs_oreb']]]
  }
};
const POS_NAME = { guard: 'Guard', wing: 'Wing', big: 'Big' };
const TPL_KEY = 'epinoia_report_templates';
function userTemplates(set) { return (store.get(TPL_KEY, {})[set]) || {}; }
function saveTemplate(set, name, groups) {
  const all = store.get(TPL_KEY, {});
  all[set] = all[set] || {};
  if (groups) all[set][name] = groups; else delete all[set][name];
  store.set(TPL_KEY, all);
}
/* the template a page prints: the reader's choice for this set ('auto' = by his position), as [[title, keys]] */
function templateOf(set, choice, pos) {
  if (choice && choice !== 'auto') {
    if (/^pos:/.test(choice)) return TPL[set][choice.slice(4)] || TPL[set].guard;
    const u = userTemplates(set)[choice];
    if (u) return u;
  }
  return TPL[set][pos || 'guard'] || TPL[set].guard;
}

/* a position group from five shares (PG..C, any scale): where his minutes' average spot falls */
function posGroup(pct, listed) {
  if (Array.isArray(pct)) {
    const t = pct.reduce((a, b) => a + (+b || 0), 0);
    if (t > 0) {
      const at = pct.reduce((a, v, k) => a + (k + 1) * (+v || 0), 0) / t;
      return at <= 2.4 ? 'guard' : at <= 3.6 ? 'wing' : 'big';
    }
  }
  const p = String(listed || '').toUpperCase();
  if (/C|CENT|PF|POWER|^F$|BIG/.test(p)) return /SF|SMALL|WING|G\/F/.test(p) ? 'wing' : 'big';
  if (/SF|SMALL|WING|G\/F|F/.test(p)) return 'wing';
  return 'guard';
}

/* a club's colour as ink on white paper: mixed towards black until it reads at 4.5:1 (WCAG's line for small text) */
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#08603f';
  const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = x => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const x = c.map(v => Math.round(v * (1 - t)));
    if (1.05 / (L(x) + 0.05) >= 4.5) return '#' + x.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  return '#0d1f17';
}

/* ---------------------------------------------------------------- ranking --- */
/* percentiles of every key over the field (season.js percentiles, the profile's own), the field's average, and the
   band a percentile is coloured by */
function ranker(field, keys) {
  const SE = root.EpinoiaSeason;
  const low = keys.filter(k => STATS[k] && STATS[k].low);
  const fl = (field || []).map(derive);
  let ranks = new Map();
  try { if (SE && SE.percentiles && fl.length >= 3) ranks = SE.percentiles(fl, keys, low); } catch (_) { ranks = new Map(); }
  const avg = new Map();
  keys.forEach(k => {
    const vs = fl.map(r => r[k]).filter(isNum).map(Number);
    avg.set(k, vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
  });
  return { pct: (k, id) => { const m = ranks.get(k); const v = m ? m.get(id) : null; return v == null ? null : Math.round(v); },
           avg: k => avg.get(k), n: fl.length };
}
const band = (p, style) => (p == null ? 0 : style ? 9 : p >= 75 ? 4 : p >= 50 ? 3 : p >= 25 ? 2 : 1);

/* POSITION-ADJUSTED, ALWAYS (2026-10-02). A player in a report is ranked among the players of his own position in the
   competition, never the whole of it: a centre's rebounding among the bigs, a point guard's assists among the guards.
   The pools are the site's own (season.js positionGroups, the profile's "adjust for position": the third of the
   competition that plays most like guards, the wings, the third that plays most like bigs). The player himself goes in
   the pool of the group his report is drawn for (his minutes at each position, the cover's breakdown), so the cover,
   the template and the pool always agree. A pool of fewer than POS_MIN players ranks him against everybody instead,
   and the page says so. */
const POS_MIN = 12;
const POS_OF = { G: 'guard', F: 'wing', C: 'big' };
const POS_PLURAL = { guard: 'guards', wing: 'wings', big: 'bigs' };
function posPools(field) {
  const SE = root.EpinoiaSeason, out = new Map();
  if (SE && SE.positionGroups) SE.positionGroups(field || []).forEach((g, id) => out.set(id, POS_OF[g] || null));
  return out;
}
/* a ranker over one position's pool, the player `id` put in it: R.group (null when it fell back on everybody), R.who */
function posRanker(field, keys, group, id, pools) {
  const P = pools || posPools(field);
  const pool = group ? (field || []).filter(r => (id != null && r.id === id) || P.get(r.id) === group) : [];
  const ok = pool.length >= POS_MIN;
  const R = ranker(ok ? pool : field, keys);
  R.group = ok ? group : null;
  R.who = ok ? (POS_PLURAL[group] || 'players') : 'players';
  return R;
}
function fmtStat(k, v) {
  const s = STATS[k] || { dp: 1 };
  if (!isNum(v)) return '—';
  const t = (+v).toFixed(s.dp == null ? 1 : s.dp);
  return s.signed && +v > 0 ? '+' + t : t;
}

/* ---------------------------------------------------------------- drawing --- */
/* a figure only some feeds can give (the turnover's type): 'n/a' where this league's does not */
const FEED_NA = 'this league\u2019s play-by-play does not say what kind of turnover each one was';
/* ONE STATISTIC: label, value, percentile bar, ordinal, the field's average. A figure no other club carries (ref on its
   STATS entry: another key of the same row, or a number) is drawn against that instead: the bar grows from the middle,
   green to the right where it is better than the club's own figure, red to the left where it is worse, and the gap is
   printed where the percentile would be */
function refOf(s, row) { return s.ref == null ? null : typeof s.ref === 'number' ? s.ref : row ? row[s.ref] : null; }
function bandVs(v, ref, scale, low) {
  if (!isNum(v) || !isNum(ref)) return 0;
  const g = (low ? -1 : 1) * (+v - +ref), sc = scale || 3;
  return g >= sc ? 4 : g >= 0 ? 3 : g > -sc ? 2 : 1;
}
function statRowHTML(k, row, R, opt) {
  const s = STATS[k] || { l: k.toUpperCase() };
  const v = row ? row[k] : null;
  const rv = refOf(s, row);
  const lab = (opt && typeof opt.label === 'function' && opt.label(k)) || s.l;     // a shorter name where the group says the rest
  const head = '<span class="rp-st-l" title="' + esc(s.l) + '">' + esc(lab) + '</span><span class="rp-st-v">' + (s.feed && !isNum(v) ? '<small title="' + esc(FEED_NA) + '">n/a</small>' : fmtStat(k, v)) + '</span>';
  const c = opt && opt.compact ? ' data-c="1"' : '';
  if (s.rank === false && isNum(rv) && isNum(v)) {
    const d = +v - +rv, g = s.low ? -d : d, sc = s.sc || 3;
    const b = bandVs(v, rv, sc, s.low);
    const w = Math.max(3, Math.min(50, 50 * Math.abs(g) / (3 * sc)));
    const t = (+Math.abs(d)).toFixed(s.dp == null ? 1 : s.dp);
    return '<div class="rp-st" data-b="' + b + '"' + c + '>' + head +
      '<span class="rp-st-bar dv"><i style="' + (g >= 0 ? 'left:50%' : 'left:' + (50 - w).toFixed(1) + '%') + ';width:' + w.toFixed(1) + '%"></i></span>' +
      '<span class="rp-st-p">' + (d > 0 ? '+' : d < 0 ? '\u2212' : '\u00b1') + t + '</span>' +
      '<span class="rp-st-a">' + esc(s.refL || 'club') + ' ' + fmtStat(typeof s.ref === 'string' && STATS[s.ref] ? s.ref : k, rv) + '</span></div>';
  }
  const p = s.rank === false ? null : R.pct(k, row && row.id);
  const b = band(p, s.style);
  const a = s.rank === false ? null : R.avg(k);         // a figure only this side has: no field to average
  const w = p == null ? 0 : Math.max(3, p);
  const pl = p != null && opt && opt.place ? opt.place(k) : null;      // a club's place ('3rd/18') where a percentile would be
  return '<div class="rp-st" data-b="' + b + '"' + c + (pl ? ' data-r="1"' : '') + '>' + head +
    '<span class="rp-st-bar"><i style="width:' + w + '%"></i></span>' +
    '<span class="rp-st-p">' + (pl || (p == null ? '\u2014' : ordinal(p))) + '</span>' +
    '<span class="rp-st-a">' + (a == null ? '' : 'avg ' + fmtStat(k, a)) + '</span></div>';
}
/* GROUPS IN TWO COLUMNS, explicitly (the PDF's renderer does not lay out CSS columns): the groups in reading order, cut
   where the two columns come out most nearly the same height; weight(item) is an item's height in any unit */
function colsHTML(items, html, weight) {
  const w = items.map(weight), tot = w.reduce((a, b) => a + b, 0);
  let best = 0, bestGap = Infinity, run = 0;
  for (let i = 0; i <= items.length; i++) {
    const gap = Math.abs(tot - 2 * run);
    if (gap < bestGap) { bestGap = gap; best = i; }
    if (i < items.length) run += w[i];
  }
  return '<div class="rp-cols"><div>' + items.slice(0, best).map(html).join('') + '</div><div>' + items.slice(best).map(html).join('') + '</div></div>';
}
/* a cell of the PLAYERS card: label over value, the cell tinted by the percentile */
function statCellHTML(k, row, R) {
  const s = STATS[k] || { l: k.toUpperCase() };
  const p = s.rank === false ? null : R.pct(k, row && row.id);
  const v = row ? row[k] : null;
  return '<div class="rp-cell" data-b="' + band(p, s.style) + '"><span class="rp-cell-l">' + esc(s.l) + '</span>' +
    '<b class="rp-cell-v">' + (s.feed && !isNum(v) ? '<small title="' + esc(FEED_NA) + '">n/a</small>' : fmtStat(k, v)) + '</b>' +
    '<span class="rp-cell-p">' + (p == null ? '' : ordinal(p)) + '</span></div>';
}

/* THE HALF COURT WITH THE FIVE SPOTS (the profile's position breakdown, p/player.js): each disc coloured by its share,
   the main one ringed. pct: five numbers summing to about 100; labels: the names to print under each spot (a club's
   five), or none */
const SPOTS = [[0.50, 0.84], [0.19, 0.62], [0.81, 0.62], [0.29, 0.31], [0.71, 0.22]];
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
function posCourtHTML(pct, opt) {
  const o = opt || {};
  const B = root.EpinoiaBox;
  const court = B && B.courtSVG ? B.courtSVG(null, { plain: true }) : '';
  const p = (pct || []).map(v => +v || 0);
  const top = p.length ? p.indexOf(Math.max(...p)) : -1;
  const bandOf = v => (v < 0.5 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4);
  const spots = SLOTS.map((s, k) => {
    const v = p[k] || 0, name = o.names && o.names[k];
    return '<span class="rp-spot b' + (o.names ? 4 : bandOf(v)) + (k === top && !o.names ? ' top' : '') + '" style="left:' + (SPOTS[k][0] * 100) + '%;top:' + (SPOTS[k][1] * 100) + '%">' +
      '<b>' + s + '</b>' + (o.names ? '' : '<i>' + Math.round(v) + '%</i>') +
      (name ? '<em>' + esc(name) + '</em>' : '') + '</span>';
  }).join('');
  return '<div class="rp-court' + (o.cls ? ' ' + o.cls : '') + '">' + court + '<div class="rp-spots">' + spots + '</div></div>';
}
const POS_KEY = '<div class="rp-poskey"><span><i class="b4"></i>over half</span><span><i class="b3"></i>25–50%</span>' +
  '<span><i class="b2"></i>10–25%</span><span><i class="b1"></i>under 10%</span><span><i class="b0"></i>never</span></div>';

/* ---------------------------------------------------------------- shots --- */
/* THE SHOT ZONES IN TWO COLUMNS (shotchart.js zoneRows): every zone on the left, the larger cuts on the right; FG% and
   eFG% on pills in the court's colours (blue under the zone's break-even, orange over, grey within two points), the
   share of shots as a bar, a zone of fewer than three attempts hatched */
function zoneColumnsHTML(shots, games) {
  const SC = root.EpinoiaShotChart;
  if (!SC || !SC.zoneRows) return '';
  const Z = SC.zoneRows(shots || [], games || 0);
  const f1 = v => (isNum(v) ? (+v).toFixed(1) : '—');
  const pill = (v, be, att) => {
    if (!att) return '<td><span class="rp-zp nil">—</span></td>';
    const b = att < 3 || !isNum(be) || !SC.bandAt ? 'few' : (x => (x === 0 ? 'b0' : x > 0 ? 'bp' + x : 'bm' + (-x)))(SC.bandAt(v, be));
    return '<td><span class="rp-zp ' + b + '">' + f1(v) + '</span></td>';
  };
  const max = Math.max(1, ...Z.groups.map(r => +r.share || 0));
  const row = r => '<tr' + (r.att ? '' : ' class="none"') + '><td class="l">' + esc(r.label) + '</td><td>' + r.made + '/' + r.att + '</td>' +
    '<td class="rp-zs"><span>' + (isNum(r.share) ? f1(r.share) + '%' : '—') + '</span><i style="width:' + (isNum(r.share) ? Math.max(2, 100 * r.share / max).toFixed(1) : 0) + '%"></i></td>' +
    pill(r.fg, r.be, r.att) + pill(r.efg, r.beE, r.att) + '</tr>';
  const tbl = (rows, cap) => '<table class="rp-tbl rp-zt"><thead><tr><th class="l">' + cap + '</th><th>made/att</th><th>% of shots</th><th>FG%</th><th>eFG%</th></tr></thead><tbody>' +
    rows.map(row).join('') + '</tbody></table>';
  return '<div class="rp-two">' + '<div>' + tbl(Z.groups, 'every zone') + '</div><div>' + tbl(Z.big, 'the larger cuts') + '</div></div>' +
    '<p class="rp-zkey"><span class="rp-zp bm3">below</span><span class="rp-zp bm1"></span><span class="rp-zp b0">break-even</span><span class="rp-zp bp1"></span><span class="rp-zp bp3">above</span>' +
    '<span class="rp-zp few">fewer than 3 attempts</span><span>break-even: paint 58% · mid-range 40% · three 35% (eFG% 52.5)</span></p>';
}

/* THE BOX SCORE'S SITUATION CARD OVER A SEASON (game/events.js: the court with every shot, made filled and missed a
   ring, the shot types, rim / mid / three, who scored), summed over the games given. situations.js is run on each
   game's log; games: [{ events, teams, side, pid }] (pid: one player's shots and line alone) -> { half, transition } */
const SIT_KEYS = ['half', 'transition'];
function sitSeason(games) {
  const SI = root.EpinoiaSituations;
  const out = {};
  SIT_KEYS.forEach(k => { out[k] = { games: 0, chances: 0, pts: 0, fga: 0, fgm: 0, p3m: 0, fta: 0, ftm: 0, tov: 0, shots: [], types: new Map(),
    zones: { rim: { a: 0, m: 0 }, mid: { a: 0, m: 0 }, three: { a: 0, m: 0 } }, scorers: new Map() }; });
  if (!SI || !SI.compute) return out;
  (games || []).forEach(g => {
    let C;
    try { C = SI.compute({ teams: g.teams || [{}, {}], events: g.events || [] }); } catch (_) { return; }
    const D = C && C.side && C.side[g.side];
    if (!D || !D.sits) return;
    SIT_KEYS.forEach(k => {
      const s = D.sits[k], A = out[k];
      if (!s) return;
      A.games++;
      const mine = g.pid ? (s.players && s.players[g.pid]) || null : s;
      if (g.pid && !mine) return;
      const shots = (s.shots || []).filter(x => !g.pid || x.pid === g.pid);
      A.pts += mine.pts || 0; A.fga += mine.fga || 0; A.fgm += mine.fgm || 0; A.p3m += mine.p3m || 0;
      A.fta += mine.fta || 0; A.ftm += mine.ftm || 0; A.tov += mine.tov || 0;
      if (!g.pid) A.chances += s.chances || 0;
      shots.forEach(x => {
        A.shots.push(x);
        const key = (x.three ? 'three' : 'two') + '|' + (x.type || '');
        const T = A.types.get(key) || { three: x.three, type: x.type || '', a: 0, m: 0 };
        T.a++; if (x.made) T.m++; A.types.set(key, T);
        const z = A.zones[x.zone] || null; if (z) { z.a++; if (x.made) z.m++; }
      });
      if (!g.pid) Object.keys(s.players || {}).forEach(pid => {
        const p = s.players[pid], cur = A.scorers.get(pid) || { pid, pts: 0, fgm: 0, fga: 0 };
        cur.pts += p.pts || 0; cur.fgm += p.fgm || 0; cur.fga += p.fga || 0; A.scorers.set(pid, cur);
      });
    });
  });
  SIT_KEYS.forEach(k => {
    const A = out[k];
    A.efg = A.fga ? (A.fgm + 0.5 * A.p3m) / A.fga : null;
    A.ppp = A.chances ? A.pts / A.chances : null;
    A.tovPct = A.chances ? A.tov / A.chances : null;
    A.types = [...A.types.values()].sort((x, y) => (y.a - x.a) || (y.m - x.m));
    A.scorers = [...A.scorers.values()].filter(x => x.pts > 0).sort((x, y) => y.pts - x.pts).slice(0, 5);
  });
  return out;
}
const SIT_NAME = { half: ['Half court', 'chances that were not a second chance, a break, off a turnover or after a timeout'],
                   transition: ['Transition', 'tagged a fast break, or within eight seconds of a defensive rebound or a steal'] };
function sitCardHTML(A, o) {
  const opt = o || {};
  const Box = root.EpinoiaBox, SC = root.EpinoiaShotChart;
  const nm = SIT_NAME[opt.key] || [opt.key, ''];
  const pc = v => (v == null ? '–' : Math.round(100 * v) + '%');
  const located = A.shots.filter(x => x.x != null && x.y != null);
  let court = '<div class="rp-empty">No shot locations were recorded.</div>';
  if (Box && Box.courtSVG && located.length) {
    const C = Box.COURT;
    /* the zones under the dots, tinted against each zone's break-even */
    let tint = '';
    if (SC && SC.zonePaths && SC.zones && SC.bandAt) {
      const P = SC.zonePaths(), Zs = SC.zones(located);
      tint = Object.keys(P).map(k => {
        const z = Zs[k];
        if (!z || z.att < 3) return '';
        const b = SC.bandAt(z.pct, (SC.ANCHOR || { paint: 58, mid: 40, three: 35 })[z.kind]);
        const col = b > 0 ? '239,138,75' : b < 0 ? '91,141,239' : '160,170,165';
        return '<path d="' + P[k] + '" fill="rgba(' + col + ',' + (0.07 + 0.07 * Math.abs(b)).toFixed(2) + ')"/>';
      }).join('');
    }
    const dots = located.slice().sort((a, b) => a.made - b.made).map(x => {
      const p = Box.snapToValue ? Box.snapToValue(x.x, x.y, x.three) : x;
      const cx = (p.x * C.W).toFixed(0), cy = (p.y * C.H).toFixed(0);
      return x.made ? '<circle class="rp-dot m" cx="' + cx + '" cy="' + cy + '" r="30"/>' : '<circle class="rp-dot x" cx="' + cx + '" cy="' + cy + '" r="24"/>';
    }).join('');
    const svg = Box.courtSVG(null, { plain: true });
    court = svg.replace(/(<svg[^>]*>)/, '$1' + tint).replace('</svg>', dots + '</svg>');
  }
  const top = A.types.slice(0, 7), rest = A.types.slice(7);
  if (rest.length) top.push({ other: true, a: rest.reduce((n, T) => n + T.a, 0), m: rest.reduce((n, T) => n + T.m, 0) });
  const mx = Math.max(1, ...top.map(T => T.a));
  const lab = T => (T.other ? 'Everything else' : T.three ? (T.type && T.type !== 'jump shot' ? T.type + ' three' : 'Three') : (T.type || 'Two, type not recorded'));
  const types = top.length ? '<ul class="rp-types">' + top.map(T => '<li><span>' + esc(lab(T).charAt(0).toUpperCase() + lab(T).slice(1)) + '</span>' +
    '<span class="rp-tb"><i class="a" style="width:' + (100 * T.a / mx).toFixed(1) + '%"></i><i class="m" style="width:' + (100 * T.m / mx).toFixed(1) + '%"></i></span><b>' + T.m + '/' + T.a + '</b></li>').join('') + '</ul>'
    : '<p class="rp-note">No field goals.</p>';
  const zones = '<div class="rp-sz">' + [['rim', 'Rim'], ['mid', 'Mid-range'], ['three', 'Three']].map(([k, l]) => { const z = A.zones[k]; const p = z.a ? z.m / z.a : null;
    return '<span><small>' + l + '</small><b>' + z.m + '/' + z.a + '</b><em>' + (p == null ? '–' : Math.round(100 * p) + '%') + '</em><i style="width:' + (p == null ? 0 : 100 * p).toFixed(0) + '%"></i></span>'; }).join('') + '</div>';
  /* the zones, each with its makes and its FG% against the zone's break-even */
  let zl = '';
  if (SC && SC.zones && located.length) {
    const Zs = SC.zones(located), AN = SC.ANCHOR || { paint: 58, mid: 40, three: 35 };
    const rows = Object.values(Zs).filter(z => z.att).sort((x, y) => y.att - x.att).slice(0, 8);
    const cls = z => { if (z.att < 3 || !SC.bandAt) return 'few'; const b = SC.bandAt(z.pct, AN[z.kind]); return b === 0 ? 'b0' : b > 0 ? 'bp' + b : 'bm' + (-b); };
    const side = z => (/l$/.test(z.k) ? ' (left)' : /r$/.test(z.k) && z.k !== 'tm' ? ' (right)' : '');
    if (rows.length) zl = '<h5>Shot zones</h5><ul class="rp-zl">' + rows.map(z => '<li><span>' + esc(z.label + side(z)) + '</span><b>' + z.made + '/' + z.att + '</b>' +
      '<span class="rp-zp ' + cls(z) + '">' + Math.round(z.pct) + '%</span></li>').join('') + '</ul>';
  }
  const names = opt.names || {};
  const sc = A.scorers.length && !opt.player ? '<h5>Who scored</h5><ol class="rp-scorers">' + A.scorers.map(x => '<li><span>' + esc(names[x.pid] || 'Player') + '</span>' +
    '<span class="rp-tb"><i class="m" style="width:' + (100 * x.pts / A.scorers[0].pts).toFixed(1) + '%"></i></span><b>' + x.pts + '</b><small>' + x.fgm + '/' + x.fga + ' FG</small></li>').join('') + '</ol>' : '';
  const figs = '<span><b>' + A.pts + '</b>pts</span>' + (A.ppp != null ? '<span><b>' + A.ppp.toFixed(2) + '</b>per chance</span>' : '') +
    '<span><b>' + (A.efg == null ? '–' : Math.round(100 * A.efg) + '%') + '</b>eFG</span><span><b>' + A.ftm + '/' + A.fta + '</b>FT</span>' +
    (A.tovPct != null ? '<span><b>' + pc(A.tovPct) + '</b>TO</span>' : '<span><b>' + A.tov + '</b>TO</span>');
  return '<div class="rp-sit' + (opt.compact ? ' cp' : '') + '" style="--s:' + (opt.colour || '#08603f') + '"><div class="rp-sit-h"><h4><i></i>' + esc(nm[0]) + (opt.who ? ' <small>' + esc(opt.who) + '</small>' : '') + '</h4>' +
    '<p class="rp-sit-f">' + figs + '</p></div>' +
    '<div class="rp-sit-g"><div class="rp-sit-c">' + (located.length ? '<div class="rp-court">' + court + '</div>' : court) +
      '<p class="rp-sit-k"><span><i class="m"></i>made</span><span><i class="x"></i>missed</span><span>' + located.length + ' of ' + A.fga + ' shots located · zones tinted against break-even</span></p></div>' +
      '<div class="rp-sit-s"><h5>Shot types</h5>' + types + zones + zl + sc + '</div></div></div>';
}

/* a section title inside a page, and a block: everything a module returns is one of these */
function block(html, cls) { const b = el('div', 'rp-blk' + (cls ? ' ' + cls : '')); if (typeof html === 'string') b.innerHTML = html; else if (html) b.appendChild(html); return b; }
const title = (t, note) => '<div class="rp-h"><h3>' + esc(t) + '</h3>' + (note ? '<span>' + esc(note) + '</span>' : '') + '</div>';

/* ---------------------------------------------------------------- the pages --- */
function today() {
  const d = new Date();
  return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear();
}
function crestHTML(c, cls) {
  if (c.crest) return '<span class="' + cls + ' img"><img src="' + esc(c.crest) + '" alt="" crossorigin="anonymous"></span>';
  const mono = String(c.monogram || c.club || c.name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return '<span class="' + cls + '"><b>' + esc(mono || '?') + '</b></span>';
}
function newPage(c, label, cont) {
  const pg = el('div', 'rp-pg');
  pg.style.setProperty('--rp-a', c.accent || '#08603f');
  pg.innerHTML = '<div class="rp-top">' + crestHTML(c, 'rp-top-c') +
    '<div class="rp-top-n"><b>' + esc(c.name) + '</b><span>' + esc(c.line || '') + '</span></div>' +
    '<div class="rp-top-m">' + esc(label) + (cont ? '<i> · continued</i>' : '') + '</div></div>' +
    '<div class="rp-body"></div>' +
    '<div class="rp-foot"><span class="epinoia-mark">EPINOIA</span><span>' + esc(c.title || 'Report') + ' · ' + esc(c.generated) + '</span><span class="rp-no"></span></div>';
  return pg;
}

/* THE FRONT PAGE (2026-10-02, a printed report's): the subject on the site's deep green with the club's colour in a
   band of stripes, the crest on a white disc, the title, the name and the subtitle; a band of the club's colour; then on
   paper, the position breakdown beside the report's details and its contents with the page each section starts on */
function coverPage(c, art) {
  const pg = el('div', 'rp-pg rp-cover');
  pg.style.setProperty('--rp-a', c.colour || '#93f2bf');
  pg.style.setProperty('--rp-ink-a', c.accent || '#08603f');
  const n = String(c.name || '').length;
  const facts = (c.facts || []).filter(f => f && f[1] != null && f[1] !== '')
    .map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
  pg.innerHTML =
    '<div class="rp-cv-hero"><div class="rp-cv-stripes"></div>' +
      '<div class="rp-cv-top"><span class="epinoia-mark">EPINOIA</span><span>' + esc(c.kicker || (c.kind === 'team' ? 'Club report' : 'Player report')) + ' · confidential</span></div>' +
      '<div class="rp-cv-mid">' + crestHTML(c, 'rp-cv-crest') +
        '<div class="rp-cv-title"><i></i><span>' + esc(c.title || 'Scouting report') + '</span><i></i></div>' +
        '<h1 class="rp-cv-name" style="font-size:' + (n <= 16 ? 50 : n <= 22 ? 42 : n <= 30 ? 34 : 28) + 'px">' + esc(c.name) + '</h1>' +
        '<div class="rp-cv-sub">' + esc(c.subtitle || '') + '</div></div></div>' +
    '<div class="rp-cv-band"></div>' +
    '<div class="rp-cv-low"><div class="rp-cv-art">' + (art || '') + '</div>' +
      '<div class="rp-cv-side"><h4>Report details</h4><dl class="rp-cv-facts">' + facts +
        '<div><dt>Prepared</dt><dd>' + esc(c.generated) + '</dd></div></dl>' +
        '<h4>Contents</h4><ol class="rp-cv-toc"></ol></div></div>' +
    '<div class="rp-cv-foot"><span>' + esc(c.line || '') + '</span><span>prepared with <b class="epinoia-mark">EPINOIA</b></span></div>';
  return pg;
}

/* LAY BLOCKS ONTO PAGES. Each is added to the page being filled; one that makes the page's body overflow moves to a
   new page (continued), and one that overflows a page on its own is drawn smaller until it fits. PACKED (opt.pack):
   a module starts in what is left of the page before when its first block fits there - under a rule, the page's head
   then naming both - so a short section never leaves half a sheet blank. Returns the page the module starts on. */
function setLabels(pg, labels, cont) {
  pg.dataset.labels = JSON.stringify(labels);
  const m = pg.querySelector('.rp-top-m');
  if (m) m.innerHTML = labels.map(esc).join(' <b>\u00b7</b> ') + (cont ? '<i> \u00b7 continued</i>' : '');
}
function layout(host, c, label, blocks, opt) {
  let pg = null, body = null, count = 0, start = null;
  const open = cont => { pg = newPage(c, label, cont); pg.dataset.labels = JSON.stringify([label]); host.appendChild(pg); body = pg.querySelector('.rp-body'); count = 0; };
  const over = () => body.scrollHeight > body.clientHeight + 1;
  const list = (blocks || []).filter(Boolean);
  const prev = opt && opt.pack ? host.lastElementChild : null;
  /* a module packs into the space the one before left only when the whole of it fits there: a section is never
     split between a page it shares and one of its own */
  if (prev && prev.classList.contains('rp-pg') && !prev.classList.contains('rp-cover') && list.length && !list.some(b => b.classList && b.classList.contains('rp-break'))) {
    pg = prev; body = pg.querySelector('.rp-body');
    list[0].classList.add('rp-join');
    list.forEach(b => body.appendChild(b));
    if (over()) { list.forEach(b => b.remove()); list[0].classList.remove('rp-join'); pg = null; }
    else {
      list.length = 0; count = body.children.length; start = pg;
      let labels = []; try { labels = JSON.parse(pg.dataset.labels || '[]'); } catch (_) { labels = []; }
      if (labels.indexOf(label) < 0) labels.push(label);
      setLabels(pg, labels, /continued/.test(pg.querySelector('.rp-top-m') ? pg.querySelector('.rp-top-m').textContent : ''));
    }
  }
  if (!pg) open(false);
  start = start || pg;
  list.forEach(b => {
    if (b.classList && b.classList.contains('rp-break')) { if (count) open(true); return; }
    body.appendChild(b);
    count++;
    if (!over()) return;
    if (count > 1) { b.remove(); open(true); body.appendChild(b); count = 1; }
    if (over()) {
      /* too tall for a whole page: smaller, to fit */
      const room = body.clientHeight - 2, need = b.offsetHeight || 1;
      const z = Math.max(0.45, Math.min(1, room / need));
      b.style.zoom = z.toFixed(3);
      if (over()) b.style.zoom = Math.max(0.4, z * room / Math.max(1, body.scrollHeight)).toFixed(3);
    }
  });
  return start;
}

/* THE LEGEND: every statistic the report printed, defined, and how to read the colours */
function legendBlocks(keys, extra, kind) {
  const out = [];
  out.push(block('<div class="rp-lg-key">' +
    '<div><i data-b="4"></i><span><b>75th percentile and up</b> among the players (or clubs) the stat is ranked in</span></div>' +
    '<div><i data-b="3"></i><span><b>50th\u201375th</b></span></div><div><i data-b="2"></i><span><b>25th\u201350th</b></span></div><div><i data-b="1"></i><span><b>below the 25th</b></span></div>' +
    '<div><i data-b="9"></i><span><b>a style</b>: more is neither better nor worse, so it is ranked by most and drawn in one tone</span></div>' +
    '<div><i data-b="0"></i><span><b>not ranked</b>: too few to rank, or a figure the field does not carry</span></div></div>' +
    '<p class="rp-lg-p">A percentile says where the figure sits among the others in the same competition and season: the 80th is better than eight in ten. ' +
    (kind === 'team' ? 'A club is ranked among the clubs; a player always among the players of his own position (guards, wings or bigs: the site’s position groups, worked out from how each player is used), never the whole competition. '
      : 'A player is always ranked among the players of his own position (guards, wings or bigs: the site’s position groups, worked out from how each player is used), never the whole competition, and the average shown is theirs. ') +
    'Where smaller is better (turnovers, fouls, what an opponent did with him on the floor) the order is turned round, so a high percentile is always good. ' +
    '± is with him (or the unit) on the floor minus off it. All rates are worked out from the season’s totals, never averaged from games.</p>'));
  const seen = new Set(), rows = [];
  keys.forEach(k => {
    if (seen.has(k)) return; seen.add(k);
    const d = defOf(k, kind);
    if (!d) return;
    const s = STATS[k];
    rows.push('<div class="rp-lg-row"><b>' + esc(s ? s.l : k) + '</b><span><em>' + esc(d.title) + '.</em> ' + esc(d.what || '') +
      (d.formula ? ' <code>' + esc(d.formula) + '</code>' : '') + '</span></div>');
  });
  (extra || []).forEach(([t, d]) => rows.push('<div class="rp-lg-row"><b>' + esc(t) + '</b><span>' + esc(d) + '</span></div>'));
  for (let i = 0; i < rows.length; i += 12) out.push(block('<div class="rp-lg">' + rows.slice(i, i + 12).join('') + '</div>'));
  return out;
}

/* ---------------------------------------------------------------- RAPM --- */
/* RAPM, ON REQUEST, ONCE FOR A SEASON OF GAMES. Never worked out by itself: where it has not been, the panel says so in
   a flag and offers the button (every stint of the league's season is read, a few games at a time, rapm.js). What is
   worked out is kept in this browser under the games' fingerprint, so the next report of the same league and season -
   another player, the club - has it at once; one more game played is a new fingerprint and a new request.
   holder: { key, map, running }; o: { ids: async () => [game ids], run: (ids, onProgress) -> Promise<Map(id ->
   {orapm, drapm, rapm})>, scope: () => 'the league and season, in words' } */
const RAPM_STORE = 'epinoia_report_rapm';
function rapmKey(ids) {
  const t = (ids || []).slice().sort().join(',');
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (ids || []).length + '-' + (h >>> 0).toString(36);
}
function rapmLoad(key) {
  const e = store.get(RAPM_STORE, {})[key];
  return e && Array.isArray(e.m) ? { at: e.at, map: new Map(e.m.map(([id, o, d]) => [id, { orapm: o, drapm: d, rapm: isNum(o) && isNum(d) ? Math.round(10 * (o + d)) / 10 : null }])) } : null;
}
function rapmSave(key, map) {
  const all = store.get(RAPM_STORE, {});
  const r1 = v => (isNum(v) ? Math.round(10 * v) / 10 : null);
  all[key] = { at: Date.now(), m: [...map].map(([id, v]) => [id, r1(v.orapm), r1(v.drapm)]) };
  Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0)).slice(6).forEach(k => { delete all[k]; });   // the six newest
  store.set(RAPM_STORE, all);
}
function rapmControl(host, state, holder, o) {
  const row = el('div', 'rp-rapm');
  const b = el('button', 'ep-btn mini pri', 'Calculate RAPM'); b.type = 'button';
  const say = el('span', null, '');
  row.append(el('span', 'rp-k', 'RAPM'), b, say);
  host.appendChild(row);
  const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]; };
  const scope = () => { try { return (o.scope && o.scope()) || 'this league and season'; } catch (_) { return 'this league and season'; } };
  const flag = on => { row.classList.toggle('rp-flag', on); };
  /* look for one already worked out for these games (no reading); calc: work it out now */
  async function check(calc) {
    if (holder.running) return;
    let ids;
    try { ids = (await o.ids()) || []; } catch (_) { ids = []; }
    if (!ids.length) { flag(true); b.hidden = true; say.textContent = 'ORAPM and DRAPM need the league\u2019s games: there are none in this scope yet.'; return; }
    const key = rapmKey(ids);
    if (!calc) {
      if (holder.key === key && holder.map) return;
      const kept = rapmLoad(key);
      if (kept) {
        Object.assign(holder, { key, map: kept.map });
        flag(false); b.textContent = 'Calculate again';
        say.textContent = 'calculated for ' + scope() + ' (' + ids.length + ' games, ' + kept.map.size + ' players, ' + when(kept.at) + ')';
        state.rebuild(); return;
      }
      holder.key = key; holder.map = null;
      flag(true); b.textContent = 'Calculate RAPM';
      say.textContent = 'not calculated for ' + scope() + ': ORAPM and DRAPM stay blank until it is (it reads all ' + ids.length + ' games of the league\u2019s season)';
      return;
    }
    holder.running = true; b.disabled = true;
    try {
      const map = await o.run(ids, (d, n) => { say.textContent = 'calculating RAPM for ' + scope() + ': reading the league\u2019s games, ' + d + ' of ' + n + '\u2026'; });
      Object.assign(holder, { key, map });
      rapmSave(key, map);
      flag(false); b.textContent = 'Calculate again';
      say.textContent = 'calculated for ' + scope() + ' (' + ids.length + ' games, ' + map.size + ' players)';
      state.rebuild();
    } catch (e) { flag(true); say.textContent = 'RAPM could not be calculated: ' + (e.message || e); }
    holder.running = false; b.disabled = false;
  }
  b.onclick = () => check(true);
  holder.check = check;
  state.onBuilt = (state.onBuilt || []).concat(() => { check(false); });   // the scope may have changed
  check(false);
}
/* a row's RAPM from the holder, when it is for these games */
function rapmOn(holder, field) {
  if (!holder || !holder.map) return false;
  field.forEach(r => { const v = holder.map.get(r.id); if (v) { r.orapm = v.orapm; r.drapm = v.drapm; r.rapm = v.rapm; } });
  return true;
}

/* ---------------------------------------------------------------- mounting --- */
/* o: { tabs, panel, kind 'player'|'team', modules: [{key, title, on, build, options?}], cover: async (c, R) -> {art},
        context: () => {name, club, line, crest, colour, accent, kicker}, ctx, label }
   The tab takes its own clicks first (capture), so a page that rewires its other tabs' onclick (the video tab does)
   cannot take this one away; any other tab pressed hides the report. */
const ST = { open: false, pane: null };
function mount(o) {
  const tabs = doc().querySelector(o.tabs), panel = doc().querySelector(o.panel);
  if (!tabs || !panel) return null;
  const btn = el('button', 'ep-tab', o.label || 'Report');
  btn.type = 'button'; btn.dataset.p = 'report'; btn.setAttribute('role', 'tab');
  tabs.appendChild(btn);
  tabs.style.display = '';
  panel.style.display = 'none';
  const state = { built: false, running: 0, o, panel };
  /* MEMBERSHIP (o.lock: { key, league, leagueSlug, what, lines }): a report sold on its own (access.js CATALOGUE.locks,
     clubReport / playerReport). Locked, the tab still opens - on blurred rows and the membership card instead of the
     report - and wears the lock; the answer is asked again whenever the viewer's access changes (a sign-in, a join) */
  const AX = () => root.EpinoiaAccess;
  const isLocked = () => !!(o.lock && AX() && typeof AX().featureLocked === 'function' && AX().featureLocked(o.lock.key, o.lock.league));
  const markTab = () => {
    const l = isLocked();
    btn.classList.toggle('rp-tab-locked', l);
    if (l) btn.title = (o.lock.what || 'The report') + ': for members'; else btn.removeAttribute('title');
  };
  const lockedPanel = () => {
    panel.textContent = '';
    const wrap = el('div', 'rp rp-locked');
    const M = root.EpinoiaMemLock;
    const ph = M && typeof M.placeholder === 'function' ? M.placeholder({ what: o.lock.what || 'The report', rows: 8 }) : null;
    if (ph) wrap.appendChild(ph);
    const t = el('div', 'rp-lockcard');
    t.innerHTML = AX() && typeof AX().teaserHTML === 'function'
      ? AX().teaserHTML({ leagueSlug: o.lock.leagueSlug, title: (o.lock.what || 'The report') + ' is for members', lines: o.lock.lines || [] }) : '';
    wrap.appendChild(t);
    panel.appendChild(wrap);
    state.lockedShown = true;
  };
  const show = on => {
    ST.open = on;
    const body = doc().body;
    body.classList.toggle('rptab', on);
    if (on) { body.classList.remove('vtab', 'wktab', 'fotab'); ['#videosec', '#weeklysec', '#fosec'].forEach(s => { const n = doc().querySelector(s); if (n) n.style.display = 'none'; }); }
    panel.style.display = on ? '' : 'none';
    tabs.querySelectorAll('.ep-tab').forEach(b => { const me = b === btn; b.classList.toggle('on', me ? on : (on ? false : b.classList.contains('on'))); b.setAttribute('aria-selected', String(me && on)); });
    if (!on) {
      if (!tabs.querySelector('.ep-tab.on')) { const prof = tabs.querySelector('.ep-tab[data-p="profile"]'); if (prof) prof.classList.add('on'); }
      return;
    }
    if (isLocked()) { lockedPanel(); return; }
    if (state.lockedShown) { state.lockedShown = false; panel.textContent = ''; state.built = false; }
    if (!state.built) { state.built = true; ui(state); }
    else if (state.dirty && state.rebuild) { state.dirty = false; state.rebuild(); }
    try { root.scrollTo({ top: tabs.getBoundingClientRect().top + root.scrollY - 12, behavior: 'smooth' }); } catch (_) { /* fine */ }
  };
  tabs.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('.ep-tab') : null;
    if (!b) return;
    if (b === btn) { e.preventDefault(); e.stopPropagation(); show(true); return; }
    if (ST.open) show(false);
  }, true);
  if (/^(report|weekly)$/.test(new URLSearchParams(root.location.search).get('tab') || '')) setTimeout(() => show(true), 0);
  if (o.lock) {
    markTab();
    if (AX() && typeof AX().onChange === 'function') AX().onChange(() => { markTab(); if (ST.open) show(true); });
  }
  /* the page's scope changed (another season or competition): built again now if it is open, else when it is next */
  const refresh = () => { if (!state.built) return; if (ST.open && state.rebuild) state.rebuild(); else state.dirty = true; };
  return { show, refresh };
}

/* THE PANEL: the controls (what goes in, the title, the template, RAPM, the downloads) above the pages */
function ui(state) {
  const o = state.o, panel = state.panel;
  const key = 'epinoia_report_' + o.kind;
  const saved = store.get(key, {});
  const conf = state.conf = {
    on: Object.assign({}, ...o.modules.map(m => ({ [m.key]: m.on !== false })), saved.on || {}),
    title: saved.title || (o.kind === 'team' ? 'Scouting report' : 'Scouting report'),
    subtitle: null, tpl: saved.tpl || {}
  };
  panel.innerHTML = '';
  const wrap = el('div', 'rp');
  const bar = el('div', 'rp-bar');
  wrap.appendChild(bar);
  /* the title and subtitle */
  const f1 = el('label', 'rp-f'); f1.append(el('span', null, 'title'));
  const tIn = el('input'); tIn.type = 'text'; tIn.value = conf.title; tIn.maxLength = 80; f1.appendChild(tIn);
  const f2 = el('label', 'rp-f'); f2.append(el('span', null, 'subtitle'));
  const sIn = el('input'); sIn.type = 'text'; sIn.maxLength = 120; sIn.placeholder = 'the season, the competition'; f2.appendChild(sIn);
  const fields = el('div', 'rp-fields'); fields.append(f1, f2);
  bar.appendChild(fields);
  /* the modules */
  const mods = el('div', 'rp-mods');
  mods.appendChild(el('span', 'rp-k', 'pages'));
  o.modules.forEach(m => {
    const lab = el('label', 'rp-mod');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!conf.on[m.key]; cb.disabled = !!m.fixed;
    cb.onchange = () => { conf.on[m.key] = cb.checked; persist(); rebuild(); };
    lab.append(cb, el('span', null, m.title));
    mods.appendChild(lab);
  });
  bar.appendChild(mods);
  /* the extras a module offers (the template pickers, RAPM) */
  const extras = el('div', 'rp-extras');
  bar.appendChild(extras);
  /* the downloads */
  const outs = el('div', 'rp-outs');
  const status = el('span', 'rp-status');
  const mk = (t, cls, fn) => { const b = el('button', 'ep-btn ' + cls, t); b.type = 'button'; b.onclick = fn; outs.appendChild(b); return b; };
  const bPdf = mk('Download PDF', 'pri', () => download('pdf'));
  const bImg = mk('Download images', '', () => download('png'));
  mk('Print', '', () => printPages(pages));
  outs.appendChild(status);
  bar.appendChild(outs);
  const pages = el('div', 'rp-pages');
  wrap.appendChild(pages);
  panel.appendChild(wrap);
  state.pages = pages;
  const persist = () => store.set(key, { on: conf.on, title: conf.title, tpl: conf.tpl });
  let tm = null;
  tIn.oninput = () => { conf.title = tIn.value; persist(); clearTimeout(tm); tm = setTimeout(rebuild, 350); };
  sIn.oninput = () => { conf.subtitle = sIn.value; clearTimeout(tm); tm = setTimeout(rebuild, 350); };
  const say = t => { status.textContent = t || ''; };
  state.say = say;
  state.persist = persist;
  state.extras = extras;
  state.sIn = sIn;

  /* scale the sheets to the column: the page stays 794 px wide inside, so what is measured is what prints */
  const fit = () => {
    const w = pages.clientWidth || PAGE.w;
    const z = Math.min(1, (w - 2) / PAGE.w);
    pages.style.setProperty('--rp-z', z.toFixed(4));
  };
  if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(fit).observe(pages);
  fit();

  async function download(kind) {
    const X = root.EpinoiaRaster;
    const sheets = [...pages.querySelectorAll('.rp-pg')];
    if (!X || !sheets.length) { say('nothing to download yet'); return; }
    bPdf.disabled = bImg.disabled = true;
    const z = pages.style.getPropertyValue('--rp-z');
    pages.style.setProperty('--rp-z', '1');            // drawn at its own size, whatever the column shows
    try {
      const name = (state.c && state.c.file) || 'report';
      if (kind === 'pdf') await X.savePdf(sheets, name, { w: PAGE.w, h: PAGE.h, title: (state.c && state.c.docTitle) || 'Report', onProgress: (i, n) => say('drawing page ' + i + ' of ' + n + '…') });
      else await X.saveImages(sheets, name, { w: PAGE.w, h: PAGE.h, onProgress: (i, n) => say('drawing page ' + i + ' of ' + n + '…') });
      say('saved');
      setTimeout(() => say(''), 4000);
    } catch (e) {
      say('could not draw it here: use Print and save as PDF');
      if (root.console) root.console.warn('[report save]', e);
    }
    pages.style.setProperty('--rp-z', z || '1');
    fit();
    bPdf.disabled = bImg.disabled = false;
  }

  async function rebuild() {
    const run = ++state.running;
    say('building…');
    try {
      const pagesNew = el('div', 'rp-stage');
      pages.textContent = '';
      pages.appendChild(pagesNew);
      const R = { legend: [], legendExtra: [], conf, state, run, stale: () => run !== state.running };
      const toc = [];
      const c = Object.assign({ generated: today() }, await o.context());
      c.title = conf.title || 'Scouting report';
      c.subtitle = conf.subtitle != null && conf.subtitle !== '' ? conf.subtitle : (c.subtitle || '');
      if (!sIn.value && !sIn.placeholder.startsWith(c.subtitle)) sIn.placeholder = c.subtitle || sIn.placeholder;
      c.docTitle = c.title + ' — ' + c.name;
      c.file = 'epinoia-report-' + String(c.name || 'report').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
      state.c = c;
      for (const m of o.modules) {
        if (R.stale()) return;
        if (!conf.on[m.key]) continue;
        if (m.key === 'cover') {
          say('drawing the cover…');
          const art = m.build ? await m.build(c, R).catch(e => { warn(e); return ''; }) : '';
          if (R.stale()) return;
          pagesNew.appendChild(coverPage(c, art));
          continue;
        }
        if (m.key === 'legend') continue;
        say('building ' + m.title.toLowerCase() + '…');
        let blocks;
        try { blocks = await m.build(c, R); } catch (e) { warn(e); blocks = [block('<div class="rp-empty">' + esc(m.title) + ' could not be built: ' + esc(e.message || e) + '</div>')]; }
        if (R.stale()) return;
        if (!blocks || !blocks.length) continue;
        /* a module starts a page of its own unless it says it may follow on (pack: true, the combinations after the
           depth chart): a new section half-way down a page read as clutter (Louie, 2026-10-02) */
        const at = layout(pagesNew, c, m.page || m.title, blocks, { pack: m.pack === true });
        toc.push([m.page || m.title, [...pagesNew.querySelectorAll('.rp-pg')].indexOf(at) + 1]);
      }
      const lg = o.modules.find(m => m.key === 'legend');
      if (lg && conf.on.legend && (R.legend.length || R.legendExtra.length)) {
        toc.push(['LEGEND', pagesNew.querySelectorAll('.rp-pg').length + 1]);
        layout(pagesNew, c, 'LEGEND', legendBlocks(R.legend, R.legendExtra, o.kind));
      }
      const tocEl = pagesNew.querySelector('.rp-cv-toc');
      if (tocEl) tocEl.innerHTML = toc.map(([t, n]) => '<li><span>' + esc(t.charAt(0) + t.slice(1).toLowerCase()) + '</span><i></i><b>' + n + '</b></li>').join('');
      const all = pagesNew.querySelectorAll('.rp-pg');
      all.forEach((p, i) => { const n = p.querySelector('.rp-no'); if (n) n.textContent = (i + 1) + ' / ' + all.length; });
      say(all.length + (all.length === 1 ? ' page' : ' pages'));
      (state.onBuilt || []).forEach(f => { try { f(); } catch (_) { /* a label */ } });
    } catch (e) {
      warn(e);
      say('the report could not be built: ' + (e.message || e));
    }
  }
  state.rebuild = rebuild;
  /* the modules' own controls, drawn once */
  o.modules.forEach(m => { if (m.controls) { try { m.controls(extras, state); } catch (e) { warn(e); } } });
  rebuild();
}
const warn = e => { if (root.console) root.console.warn('[report]', e); };

/* PRINT: the pages alone, copied into a container the print sheet shows by itself (kit/report.css), one a sheet;
   the browser's own dialog, which can save a PDF with its text kept as text */
function printPages(pages) {
  const d = doc();
  let box = d.getElementById('rp-print');
  if (box) box.remove();
  box = el('div'); box.id = 'rp-print';
  pages.querySelectorAll('.rp-pg').forEach(p => box.appendChild(p.cloneNode(true)));
  d.body.appendChild(box);
  d.body.classList.add('rpprint');
  const done = () => { d.body.classList.remove('rpprint'); box.remove(); root.removeEventListener('afterprint', done); };
  root.addEventListener('afterprint', done);
  try { root.print(); } catch (_) { done(); }
  setTimeout(() => { if (!root.matchMedia || !root.matchMedia('print').matches) done(); }, 1500);
}

/* ---------------------------------------------------------------- template editor --- */
/* THE STATS A PAGE PRINTS, chosen by the reader: a picker (by position, or a saved template) and an editor that opens
   under it - each group a title and its stats, a stat added from the catalogue or taken out, a group added, the whole
   saved under a name. o: { set: 'main'|'players', label, pos: () => 'guard'|..., onChange } */
function templateControl(host, state, o) {
  const conf = state.conf;
  const box = el('div', 'rp-tpl');
  const lab = el('span', 'rp-k', o.label || 'stats');
  const sel = el('select');
  const edit = el('button', 'ep-btn mini', 'edit stats'); edit.type = 'button';
  box.append(lab, sel, edit);
  const ed = el('div', 'rp-ed'); ed.hidden = true;
  host.append(box, ed);
  const fill = () => {
    const cur = conf.tpl[o.set] || 'auto';
    sel.innerHTML = '';
    const add = (v, t) => { const op = el('option', null, t); op.value = v; if (v === cur) op.selected = true; sel.appendChild(op); };
    add('auto', 'by position (' + (POS_NAME[o.pos()] || 'guard').toLowerCase() + ')');
    Object.keys(POS_NAME).forEach(p => add('pos:' + p, POS_NAME[p] + ' defaults'));
    Object.keys(userTemplates(o.set)).forEach(n => add(n, n));
  };
  fill();
  state.onBuilt = (state.onBuilt || []).concat(fill);     // the position is known once a page has been built
  sel.onchange = () => { conf.tpl[o.set] = sel.value; state.persist(); if (!ed.hidden) drawEd(); state.rebuild(); };
  edit.onclick = () => { ed.hidden = !ed.hidden; edit.textContent = ed.hidden ? 'edit stats' : 'close editor'; if (!ed.hidden) drawEd(); };
  let work = null;
  function drawEd() {
    work = JSON.parse(JSON.stringify(templateOf(o.set, conf.tpl[o.set], o.pos())));
    paint();
  }
  function paint() {
    ed.textContent = '';
    const opts = Object.keys(STATS).filter(k => STATS[k].l && k !== 'gp');
    work.forEach((g, gi) => {
      const row = el('div', 'rp-ed-g');
      const t = el('input'); t.type = 'text'; t.value = g[0]; t.oninput = () => { g[0] = t.value; };
      const chips = el('div', 'rp-ed-chips');
      g[1].forEach((k, ki) => {
        const ch = el('span', 'rp-ed-chip', (STATS[k] || { l: k }).l);
        const up = el('button', null, '←'); up.type = 'button'; up.title = 'earlier';
        up.onclick = () => { if (ki > 0) { g[1].splice(ki - 1, 0, g[1].splice(ki, 1)[0]); paint(); } };
        const x = el('button', null, '×'); x.type = 'button'; x.title = 'take out';
        x.onclick = () => { g[1].splice(ki, 1); paint(); };
        ch.prepend(up); ch.appendChild(x); chips.appendChild(ch);
      });
      const addSel = el('select');
      addSel.appendChild(el('option', null, '+ add a stat'));
      opts.filter(k => g[1].indexOf(k) < 0).forEach(k => { const op = el('option', null, STATS[k].l); op.value = k; addSel.appendChild(op); });
      addSel.onchange = () => { if (STATS[addSel.value]) { g[1].push(addSel.value); paint(); } };
      const rm = el('button', 'ep-btn mini', 'remove group'); rm.type = 'button';
      rm.onclick = () => { work.splice(gi, 1); paint(); };
      row.append(t, chips, addSel, rm);
      ed.appendChild(row);
    });
    const foot = el('div', 'rp-ed-foot');
    const addG = el('button', 'ep-btn mini', '+ add a group'); addG.type = 'button';
    addG.onclick = () => { work.push(['NEW GROUP', []]); paint(); };
    const name = el('input'); name.type = 'text'; name.placeholder = 'template name';
    const cur = conf.tpl[o.set];
    if (cur && cur !== 'auto' && !/^pos:/.test(cur)) name.value = cur;
    const save = el('button', 'ep-btn mini pri', 'save template'); save.type = 'button';
    save.onclick = () => {
      const n = name.value.trim() || 'My template';
      saveTemplate(o.set, n, work.filter(g => g[1].length));
      conf.tpl[o.set] = n; state.persist(); fill(); state.rebuild();
    };
    const apply = el('button', 'ep-btn mini', 'apply without saving'); apply.type = 'button';
    apply.onclick = () => { state.temp = state.temp || {}; state.temp[o.set] = work.filter(g => g[1].length); state.rebuild(); };
    const del = el('button', 'ep-btn mini', 'delete template'); del.type = 'button';
    del.onclick = () => { const n = conf.tpl[o.set]; if (n && n !== 'auto' && !/^pos:/.test(n)) { saveTemplate(o.set, n, null); conf.tpl[o.set] = 'auto'; state.persist(); fill(); drawEd(); state.rebuild(); } };
    foot.append(addG, name, save, apply, del);
    ed.appendChild(foot);
  }
}
/* the groups a page prints now: an unsaved edit first, else the chosen template */
function groupsFor(state, set, pos) {
  if (state.temp && state.temp[set]) return state.temp[set];
  return templateOf(set, state.conf.tpl[set], pos);
}

return { mount, inkOn, colsHTML, rapmControl, rapmOn, rapmKey, bandVs, refOf, zoneColumnsHTML, sitSeason, sitCardHTML, STATS, DEFS, TPL, derive, ranker, statRowHTML, statCellHTML, posCourtHTML, POS_KEY, block, title, frag, el, esc,
         fmtStat, ordinal, band, posGroup, templateControl, groupsFor, templateOf, turnoverTypes, hcAssists, hcAstOf, HC_MIN, posPools, posRanker, POS_PLURAL, layout, legendBlocks, PAGE, SLOTS, isNum };
}));
