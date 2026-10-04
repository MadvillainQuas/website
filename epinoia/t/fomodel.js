'use strict';
/* ============================================================================
   THE FRONT OFFICE'S WIN MODEL (team page, F3; docs/what-wins-model.md §12, addendum A.1/A.2).

   What wins in this league, and what it means for this club, from two members-only files the builder writes:
   the league-season's `fo` file (every club's season profile, the value of each factor, the simulator's league
   parameters, the slot targets, the squad and lineup models, the slot minutes) and the club's own `club` file (its
   games split into expected margin and parts, its losses, its squad shape, its slot lines and its lineups). Both
   arrive through EpinoiaWinFile; this script reads nothing else but what team.js hands it (the fixtures to come,
   the season rows and the names on the roster). No game's events, box scores or feature lines.

   THE BLOCKS (collapsible, each with its summary line first)
     verdict    the record, Pythagorean and factor-expected wins, luck, the projected wins (p10-p50-p90) and one
                sentence: the biggest cost in wins per 30 games
     where      the four factors at both ends, the contributions summing to the factor-expected margin (the check
                printed), then the levers with their median, winners' P75, contribution and wins per 30
     needs      the moves to the league's P75 ranked by wins over the remaining fixtures (§7.5, or the simulator's
                counterfactual when it is calibrated), with the depth chart's NEED sentence
     slots      guards, wings and bigs against what winners get (P2) valued by P1, the two largest gaps, P2f, and a
                button per position that opens the league view (team.js wires the depth chart's handler here too)
     squad      the squad's shape against winners' bands (evidence-graded), the lineup grid and the club's fives
     losses     the last ten defeats as waterfalls (exact parts), the mean over every loss, a simulator check per loss
     next       what it takes to beat an opponent (the next fixture first): P(win) ± error, the margins, and the
                values needed on six rates for 50% and 60%
     whatIf     six dials on one end -> Δ win% (next and an average opponent) and Δ projected wins, 250 ms debounce,
                common random numbers, the state in ?wi=; a roster what-if where the slot forecast exists

   LENSES: the ledger EXPLAINS; projections FORECAST (Elo expectations unless the Forecast model is live); the
   simulator is a MODEL, "experimental" unless the builder calibrated it, in which case only its differences are used
   and they are converted to wins with the margin model (σ_pred, never σ_acc).

   STATUS AND RECALCULATE (A.2): the same status line as What wins ("Model of N games · built 2 h ago · 12 new games
   since"), a RECALCULATE button live only when games are pending, and the same staged CEEFAX bar: checking, updating
   the model (server), downloading, re-simulating (the Worker's own progress), drawing; Cancel stops the client's steps.

   STRUCTURE: view() and the html builders are pure (strings, every value escaped), so node tests draw every block
   from the fixtures; mount() puts them on the page, binds the charts (vizkit.js) and runs the Worker.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFoModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* this script's own ?v=, read while it runs, for the Worker's URL (a deploy never mixes versions) */
const SELF_V = (() => {
  try {
    const d = root.document; if (!d) return '';
    const s = d.currentScript || [...d.scripts].find(x => /\/fomodel\.js/.test(x.src));
    const m = /[?&]v=([^&#]+)/.exec((s && s.src) || '');
    return m ? m[1] : '';
  } catch (_) { return ''; }
})();

/* ------------------------------------------------------------------ constants --- */
/* §12: the GM's measures (t/depth.js MEASURES) the model can value, and the factor and end each reads. The same
   object as EpinoiaWinModel.KEYMAP (ww-fomodel checks it). */
const KEYMAP = Object.freeze({
  ff_efg: ['c_efg', 'off'], dff_efg: ['c_efg', 'def'], ff_tov: ['c_tovp', 'off'], dff_tov: ['c_tovp', 'def'],
  ff_oreb: ['c_orebp', 'off'], dff_oreb: ['c_orebp', 'def'], ff_ftr: ['c_ftr', 'off'], dff_ftr: ['c_ftr', 'def'],
  p3_pct: ['p3p', 'off'], ft_pct: ['ftp', 'off'], rim_pct: ['rimp', 'off']
});
/* the four factors (A.3: free throws by ATTEMPT rate, FTA / FGA) and the levers beyond them (FT% now one of them). A file
   built before A.3 values c_ftmr: coreOf reads the file's own four */
const CORE = ['c_efg', 'c_tovp', 'c_orebp', 'c_ftr'];
const LEVERS = ['rimr', 'p3r', 'rimp', 'p3p', 'tr_freq', 'top_avg', 'live_share', 'ftp'];
const coreOf = fo => { const v = (fo && fo.value) || {}, ks = Object.keys(v).filter(k => v[k] && v[k].model === 'core4c'); return ks.length === 4 ? CORE.filter(k => ks.includes(k)).concat(ks.filter(k => !CORE.includes(k))) : CORE; };
const LABEL = {
  c_efg: 'Shooting (eFG%)', c_tovp: 'Turnovers (TOV%)', c_orebp: 'Offensive boards (OREB%)', c_ftr: 'Getting to the line (FTA/FGA)', c_ftmr: 'Free throws made per shot',
  rimr: 'Shots at the rim', p3r: '3PA rate', rimp: 'Finishing at the rim', p3p: 'Three-point %', tr_freq: 'Transition chances',
  top_avg: 'Seconds per possession', live_share: 'Live-ball turnovers', ftr: 'FT attempt rate (FTA/FGA)', ftp: 'Free-throw %'
};
const END = { off: 'offence', def: 'defence' };
/* the depth chart's NEED sentence for a factor and end: its MEASURES key through KEYMAP, else a sentence of its own */
const MEASURE_OF = (() => { const o = {}; Object.keys(KEYMAP).forEach(m => { o[KEYMAP[m].join(':')] = m; }); return o; })();
const NEED_X = {
  'rimr:off': 'a driver or a roller who gets the ball to the rim', 'rimr:def': 'a rim protector who keeps opponents away from the basket',
  'p3r:off': 'shooters who take the three', 'p3r:def': 'perimeter defenders who run shooters off the line',
  'tr_freq:off': 'a ball-pusher who runs after misses and steals', 'tr_freq:def': 'transition defence: getting back after every miss',
  'top_avg:off': 'patience: an organiser who works the half court', 'top_avg:def': 'a defence that makes opponents work the whole clock',
  'live_share:off': 'a secure ball-handler: an organiser who does not give it away', 'live_share:def': 'active hands - defenders who pressure the ball and jump passing lanes',
  'ftr:off': 'a driver who draws fouls', 'ftr:def': 'disciplined defenders who stay down and keep their hands off',
  'rimp:def': 'a rim protector', 'p3p:def': 'length on the perimeter', 'c_ftmr:off': 'a driver who draws fouls',
  'ftp:off': 'a reliable free-throw shooter for the line'
};
/* the simulator's edits for a factor (§8.4), and the factor each dial is valued by in the margin model */
const SIM_KEY = { c_efg: 'efg', c_tovp: 'tovp', c_orebp: 'orebp', c_ftr: 'ftr', ftr: 'ftr', p3r: 'p3r', top_avg: 'secs' };
const DIALS = [
  { key: 'efg', label: 'eFG%', min: -5, max: 5, step: 0.5, unit: 'pp', f: 'c_efg' },
  { key: 'tovp', label: 'TOV%', min: -4, max: 4, step: 0.5, unit: 'pp', f: 'c_tovp' },
  { key: 'orebp', label: 'OREB%', min: -8, max: 8, step: 1, unit: 'pp', f: 'c_orebp' },
  { key: 'ftr', label: 'FT attempt rate (FTA/FGA)', min: -10, max: 10, step: 1, unit: 'pp', f: 'c_ftr' },
  { key: 'p3r', label: '3PA rate', min: -10, max: 10, step: 1, unit: 'pp', f: 'p3r' },
  { key: 'secs', label: 'Seconds per possession', min: -3, max: 3, step: 0.5, unit: 's', f: 'top_avg' }
];
const GROUP = { G: 'Guards', F: 'Wings', C: 'Bigs' };
const SLOT_KEYS = ['PG', 'SG', 'SF', 'PF', 'C'];
const SHARE_STATS = ['usg_share', 'ast_share', 'reb_share', 'tov_share', 'min_share'];
const P1_LABEL = { bpm: 'Minutes-weighted BPM', ts: 'True shooting', usg_share: 'Usage share', ast_share: 'Assist share', reb_share: 'Rebound share',
  stocks40: 'Steals + blocks per 40', tov_share: 'Turnover share', p3a_rate: '3PA rate', min_share: 'Share of minutes' };
const SQUAD_LABEL = { rot_n: 'Rotation size', top5_share: 'Top five’s minutes', star_pts_share: 'Star’s share of points', usg_hhi: 'Usage concentration',
  pos_entropy: 'Positional balance', shooters: 'Shooters in the rotation', handlers: 'Ball handlers in the rotation', protectors: 'Rim protectors',
  passers: 'Passers in the rotation', slashers: 'Rim pressure in the rotation', crashers: 'Offensive rebounders in the rotation', glass: 'Defensive rebounders in the rotation',
  disruptors: 'Turnover generators in the rotation',
  bench_share: 'Bench minutes', depth_bpm: 'Depth (players 6-9)', talent: 'Talent (BPM)', continuity: 'Continuity', starter_stability: 'Starting five kept',
  availability: 'Availability', height_w: 'Height', age_w: 'Age' };
/* A.3: the roles (EpinoiaWinModel ROLE_KEYS), what each is called, and how one is earned (the What wins page has the
   league-season's cut values) */
const ROLES = ['handler', 'passer', 'shooter', 'slasher', 'crasher', 'glass', 'protector', 'disruptor', 'big'];
const ROLE_LABEL = { shooter: 'Shooters', handler: 'Ball handlers', passer: 'Passers', slasher: 'Rim pressure', crasher: 'Offensive rebounders', glass: 'Defensive rebounders',
  protector: 'Rim protectors', disruptor: 'Turnover generators', big: 'Bigs', creator: 'Creators' };
const ROLE_HOW = {
  handler: 'AST%, unassisted points share and usage percentiles, weighted 45 / 30 / 25, at 0.70 or more',
  passer: 'A/U (AST% ÷ USG%) in the top quarter, AST% at least the median',
  shooter: '40 threes or more, 3PA rate in the top 40%, 3P% (shrunk) at least the median',
  slasher: 'rim rate and FT attempt rate percentiles averaging 0.75 or more',
  crasher: 'ORB% in the top quarter', glass: 'DRB% in the top quarter',
  protector: 'BLK% in the top quarter and taller than average', disruptor: 'STL% in the top quarter', big: 'most minutes at centre'
};
const PART_LABEL = { expected: 'expected', quality: 'shot quality', making: 'shot-making', tovp: 'turnovers', orebp: 'boards', ftr: 'free throws', ftmr: 'free throws',
  other: 'other', garbage: 'garbage time' };
const PARTS = ['quality', 'making', 'tovp', 'orebp', 'ftr', 'other', 'garbage'];
/* a defeat's part: the free-throw part is ftr (ftmr in a file built before A.3) */
const partOf = (parts, k) => (parts ? (parts[k] != null ? parts[k] : k === 'ftr' ? parts.ftmr : undefined) : undefined);
const SIM_GROUP = { shooting: 'shooting', mix: 'shot mix', turnovers: 'turnovers', boards: 'boards', ft: 'free throws', tempo: 'tempo' };
const LENS = { explain: 'Explains', forecast: 'Forecasts', model: 'Model', elo: 'Elo' };
const STAGES = ['check', 'update', 'download', 'sim', 'draw'];
const STAGE_LABEL = { check: 'checking', update: 'updating', download: 'downloading', sim: 're-simulating', draw: 'drawing' };
const BLOCKS = ['verdict', 'ledger', 'needs', 'slots', 'squad', 'losses', 'next', 'whatIf'];
const BLOCK_TITLE = { verdict: 'The verdict', ledger: 'Where the wins are', needs: 'What the club needs', slots: 'By position',
  squad: 'Squad shape', losses: 'Why we lose', next: 'What it takes to win', whatIf: 'What if' };
const MSG = {
  none: 'The model needs 20 finished games in this league', layout: 'The model is being rebuilt; back within the hour',
  network: 'The model could not be reached just now', scope: 'This file cannot be asked for', members: 'Members’ analysis.',
  league: 'This league’s analysis is not open to you', signin: 'Members’ analysis. Sign in to see it.',
  unbuilt: 'The full model switches on once it has been built'
};
const rateMsg = s => 'Too many requests: try again in ' + Math.max(1, Math.ceil((s || 60) / 60)) + ' minutes';

/* ------------------------------------------------------------------ helpers --- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const MINUS = s => s.replace(/^-/, '−');
const f1 = v => (isNum(v) ? MINUS((Math.round(v * 10) / 10).toFixed(1)).replace(/^−0\.0$/, '0.0') : '–');
const f2 = v => (isNum(v) ? MINUS(v.toFixed(2)).replace(/^−0\.00$/, '0.00') : '–');
const sg = (v, d) => { if (!isNum(v)) return '–'; const s = v.toFixed(d == null ? 1 : d); return /^-?0\.?0*$/.test(s) ? s.replace('-', '') : (v > 0 ? '+' : '') + MINUS(s); };
const pc = v => (isNum(v) ? Math.round(v * 100) + '' : '–');
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
/* a label inside a sentence: its first letter lowered unless it starts an acronym (3PA, eFG%, TOV%) */
const low = s => (/^[A-Z][a-z]/.test(String(s || '')) ? String(s).charAt(0).toLowerCase() + String(s).slice(1) : String(s || ''));
const WS = () => root.EpinoiaWinStats || null;
const SIM = () => root.EpinoiaWinSim || null;
const VK = () => root.EpinoiaVizKit || null;
/* the normal CDF and its inverse: winstats.js's when it is loaded, else a close stand-in (the node tests load both) */
function Phi(x) {
  const W = WS(); if (W && W.normCdf) return W.normCdf(x);
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function PhiInv(p) {
  const W = WS(); if (W && W.normInv) return W.normInv(p);
  p = Math.min(1 - 1e-12, Math.max(1e-12, p));
  let lo = -9, hi = 9;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/* a share of 0..1 kept as a share; everything else as written; per cent units get no sign of their own */
const unitFmt = (unit, v) => (!isNum(v) ? '–' : unit === 'share' ? f1(100 * v) + '%' : unit === 's' ? f1(v) + ' s' : unit === '%' ? f1(v) + '%' : f2(v));
const chip = (lens, extra) => '<span class="fm-chip" data-lens="' + lens + '">' + esc(LENS[lens] || lens) + '</span>' + (extra ? ' <span class="fm-chipx">' + esc(extra) + '</span>' : '');
const nTag = n => (isNum(n) ? ' <span class="fm-n" translate="no">n = ' + n + '</span>' : '');
const empty = msg => '<div class="fm-empty"><p>' + esc(msg) + '</p></div>';
const slot = (id) => '<div class="fm-chart" data-chart="' + esc(id) + '"></div>';
const tw = inner => '<div class="ep-tw fm-tw">' + inner + '</div>';

/* ------------------------------------------------------------------ the club in the file --- */
const teamOf = (fo, id) => (fo && Array.isArray(fo.teams) ? fo.teams.find(t => String(t.id) === String(id)) : null) || null;
const sigmaOf = fo => (fo && isNum(fo.sigmaPred) && fo.sigmaPred > 0 ? fo.sigmaPred : 12);
const wins30 = (pts, sigma) => (isNum(pts) ? 30 * (Phi(pts / sigma) - 0.5) : null);
/* a factor's contribution at one end in points of margin a game: b(x_off − μ) and −b(x_def − μ) (§7.5), with the
   interval from the ends of b's */
function contribution(fo, t, k, end) {
  const v = fo && fo.value && fo.value[k], f = t && t.f && t.f[k];
  if (!v || !f || !isNum(v.b) || !isNum(v.lg)) return null;
  const x = f[end];
  if (!isNum(x)) return null;
  const d = x - v.lg, sgn = end === 'def' ? -1 : 1;
  const pts = sgn * v.b * d;
  const a = isNum(v.lo) ? sgn * v.lo * d : pts, b = isNum(v.hi) ? sgn * v.hi * d : pts;
  return { pts, lo: Math.min(a, b), hi: Math.max(a, b), x, d };
}
/* the league's P75 in the better direction at one end: higher is better on offence when b > 0, on defence when b < 0 */
function targetOf(v, end) {
  if (!v || !isNum(v.b) || !v.p75 || !v.p25) return null;
  const up = end === 'off' ? v.b > 0 : v.b < 0;
  const t = up ? v.p75[end] : v.p25[end];
  return isNum(t) ? { v: t, up } : null;
}

/* THE LEDGER (block 2): core4c at both ends, contributions summing to the factor-expected margin, then the levers */
function ledger(fo, teamId) {
  const t = teamOf(fo, teamId), sigma = sigmaOf(fo);
  if (!t || !fo.value) return null;
  const row = (k, end) => {
    const v = fo.value[k], c = contribution(fo, t, k, end);
    if (!v || !c) return null;
    const tg = targetOf(v, end), w = wins30(c.pts, sigma);
    return { k, end, label: LABEL[k] || k, unit: v.unit, model: v.model, dir: v.dir, x: c.x, lg: v.lg, p50: v.p50 ? v.p50[end] : null,
             target: tg ? tg.v : null, up: tg ? tg.up : null, pts: c.pts, lo: c.lo, hi: c.hi, wins30: w, wlo: wins30(c.lo, sigma), whi: wins30(c.hi, sigma),
             sure: c.lo > 0 || c.hi < 0 };
  };
  const core = [];
  coreOf(fo).forEach(k => ['off', 'def'].forEach(end => { const r = row(k, end); if (r) core.push(r); }));
  const levers = [];
  LEVERS.forEach(k => ['off', 'def'].forEach(end => { const r = row(k, end); if (r) levers.push(r); }));
  const sum = core.reduce((a, r) => a + r.pts, 0);
  /* the same margin worked out the other way: Σ b (x_off − x_def), the league means cancelling */
  let expected = 0, used = 0;
  coreOf(fo).forEach(k => { const v = fo.value[k], f = t.f && t.f[k]; if (v && f && isNum(v.b) && isNum(f.off) && isNum(f.def)) { expected += v.b * (f.off - f.def); used++; } });
  return { core, levers, sum, expected: used ? expected : null, sigma, wins30: wins30(sum, sigma), team: t };
}
/* the club's actual competitive margin a game, from its club file (the check beside the factor-expected one) */
function actualMargin(club) {
  const g = club && Array.isArray(club.games) ? club.games.filter(x => isNum(x.mc)) : [];
  return g.length ? { v: g.reduce((a, x) => a + x.mc, 0) / g.length, n: g.length } : null;
}

/* expected margins of the fixtures to come (club view): Elo with the league's home edge (§7.8: the Front office
   uses Elo expectations when the Forecast model is not live; the fo file carries no Forecast coefficients) */
function fixtureMus(fo, teamId, fixtures) {
  const t = teamOf(fo, teamId), sigma = sigmaOf(fo), edge = (fo && fo.lg && isNum(fo.lg.homeEdge)) ? fo.lg.homeEdge : 0;
  return (fixtures || []).map(fx => {
    const home = String(fx.home_team_id) === String(teamId), opp = home ? fx.away_team_id : fx.home_team_id;
    const o = teamOf(fo, opp), h = home ? 1 : -1;
    const pElo = t && o && isNum(t.elo) && isNum(o.elo) ? 1 / (1 + Math.pow(10, -(t.elo - o.elo) / 400)) : 0.5;
    const mu = sigma * PhiInv(pElo) + h * edge;
    return { id: fx.id, opp: opp ? String(opp) : '', oppName: o ? (o.short || o.name) : '', known: !!o, h, at: fx.tipoff_at || '', mu, p: Phi(mu / sigma) };
  }).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
/* the number of wins a margin shift δ adds over the fixtures, or over a season of G against an average side */
function winsFrom(delta, mus, sigma, G) {
  if (!isNum(delta)) return null;
  if (mus && mus.length) return mus.reduce((a, f) => a + Phi((f.mu + delta) / sigma) - Phi(f.mu / sigma), 0);
  return (G || 30) * (Phi(delta / sigma) - 0.5);
}

/* NEEDS (block 3): each factor and end moved to the league's P75 alone, ranked by the wins it adds */
function needs(fo, teamId, o) {
  o = o || {};
  const t = teamOf(fo, teamId), sigma = sigmaOf(fo), G = fo && fo.lg && isNum(fo.lg.G) ? fo.lg.G : 30;
  if (!t || !fo.value) return [];
  const mus = o.mus || fixtureMus(fo, teamId, o.fixtures);
  const D = root.EpinoiaDepth, NEED = (D && D.NEED) || {};
  const out = [];
  coreOf(fo).concat(LEVERS).forEach(k => ['off', 'def'].forEach(end => {
    const v = fo.value[k], f = t.f && t.f[k];
    if (!v || !f || !isNum(f[end]) || !isNum(v.b)) return;
    if (isNum(v.lo) && isNum(v.hi) && v.lo < 0 && v.hi > 0) return;      // b not distinguishable from 0: not a need
    const tg = targetOf(v, end);
    if (!tg) return;
    const sgn = end === 'def' ? -1 : 1, gap = tg.v - f[end];
    const delta = sgn * v.b * gap;
    if (!(delta > 1e-9)) return;
    const dlo = isNum(v.lo) ? sgn * v.lo * gap : delta, dhi = isNum(v.hi) ? sgn * v.hi * gap : delta;
    let w = winsFrom(delta, mus, sigma, G), wlo = winsFrom(Math.min(dlo, dhi), mus, sigma, G), whi = winsFrom(Math.max(dlo, dhi), mus, sigma, G);
    let se = (whi - wlo) / 3.92, src = 'margin';
    const key = k + ':' + end, sim = o.sim && o.sim[key];
    if (sim && isNum(sim.dWin)) {
      const games = mus.length || G;
      w = sim.dWin * games; se = isNum(sim.se) ? sim.se * games : se; wlo = w - 1.96 * se; whi = w + 1.96 * se; src = 'sim';
    }
    const mkey = MEASURE_OF[key];
    out.push({ k, end, key, label: LABEL[k] || k, unit: v.unit, x: f[end], target: tg.v, up: tg.up, delta, wins: w, lo: wlo, hi: whi, se, src,
               games: mus.length, perSeason: !mus.length, G, need: (mkey && NEED[mkey]) || NEED_X[key] || '', simKey: SIM_KEY[k] || null });
  }));
  out.sort((a, b) => (b.wins - a.wins) || a.key.localeCompare(b.key));
  return out.slice(0, o.all ? out.length : 5);
}

/* THE GM'S VIEW, VALUED (depth.gm o.model): each GM measure the model can value, as wins per 30 games from where the
   club stands against the league's mean (§7.5), through KEYMAP */
function gmModel(fo, teamId) {
  const t = teamOf(fo, teamId), sigma = sigmaOf(fo), wins = {};
  if (!t) return { wins };
  Object.keys(KEYMAP).forEach(m => {
    const [k, end] = KEYMAP[m], c = contribution(fo, t, k, end);
    if (c) wins[m] = wins30(c.pts, sigma);
  });
  return { wins };
}

/* the season's end: wins so far plus the exact distribution over the fixtures to come (Poisson-binomial) */
function projection(done, mus) {
  let dist = [1];
  (mus || []).forEach(f => {
    const p = f.p, nd = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) { nd[k] += dist[k] * (1 - p); nd[k + 1] += dist[k] * p; }
    dist = nd;
  });
  const q = t => { let c = 0; for (let k = 0; k < dist.length; k++) { c += dist[k]; if (c >= t - 1e-12) return done + k; } return done + dist.length - 1; };
  return { mean: done + (mus || []).reduce((a, f) => a + f.p, 0), p10: q(0.1), p50: q(0.5), p90: q(0.9), dist, done, left: (mus || []).length };
}

/* ------------------------------------------------------------------ the view --- */
/* o = {fo, club, team: {id, name}, seasonRows?, chart?, fixtures?, names?: Map id -> name, reason?, retryAfter?, sim?, ans?}
   -> {ok, reason, message, verdict, ledger, needs, slots, squad, losses, next, whatIf, charts} */
function view(o) {
  o = o || {};
  const fo = o.fo || null, club = o.club || null, team = o.team || {}, id = String(team.id || (club && club.team && club.team.id) || '');
  if (!fo || o.reason) {
    const reason = o.reason || 'none';
    return { ok: false, reason, message: reason === 'rate' ? rateMsg(o.retryAfter) : MSG[reason] || MSG.network, charts: {} };
  }
  const names = o.names instanceof Map ? o.names : new Map(Object.entries(o.names || {}));
  const nameOf = pid => names.get(String(pid)) || '';
  const t = teamOf(fo, id), sigma = sigmaOf(fo);
  const mus = fixtureMus(fo, id, o.fixtures);
  const charts = {};
  const L = ledger(fo, id);
  const N = needs(fo, id, { mus, sim: o.sim });
  if (L) L.actual = actualMargin(club);

  /* (1) the verdict */
  const rec = (club && club.record) || (t ? { w: t.w, l: t.l } : null);
  const proj = rec && isNum(rec.w) ? projection(rec.w, mus) : null;
  const all = L ? L.core.concat(L.levers) : [];
  const worst = all.filter(r => r.sure && r.pts < 0).sort((a, b) => a.wins30 - b.wins30)[0] || null;
  const verdict = rec ? {
    w: rec.w, l: rec.l, pythW: rec.pythW, factorW: rec.factorW, luck: isNum(rec.factorW) ? rec.w - rec.factorW : null,
    proj, cost: worst ? { k: worst.k, end: worst.end, label: worst.label, wins: worst.wins30, lo: Math.min(worst.wlo, worst.whi), hi: Math.max(worst.wlo, worst.whi) } : null,
    forecast: !!fo.predLive
  } : null;
  if (proj && proj.left) {
    charts.proj = { kind: 'histogram', data: proj.dist.map((p, k) => [proj.done + k, Math.round(1000 * p) / 10]).filter(x => x[1] > 0), o: { x: { label: 'wins at the end of the season' }, y: { label: 'chance (%)' } },
      label: 'Projected wins at the end of the season' };
  }

  /* (2) the ledger */
  if (L && L.core.length) {
    charts.core = { kind: 'bars', data: L.core.map(r => ({ id: r.key || (r.k + ':' + r.end), label: r.label + ' · ' + END[r.end], v: r.pts, lo: r.lo, hi: r.hi, dir: 1 })),
      o: { x: { label: 'points of margin a game' } }, label: 'The four factors at both ends, in points of margin a game' };
  }

  /* (3) needs */
  if (N.length) charts.needs = { kind: 'bars', data: N.map(n => ({ id: n.key, label: n.label + ' · ' + END[n.end], v: n.wins, lo: n.lo, hi: n.hi, dir: 1 })),
    o: { x: { label: 'wins' } }, label: 'Wins from reaching the league’s P75' };

  /* (4) slots */
  const slots = slotsView(fo, club);
  if (slots && slots.rows.length) charts.slots = { kind: 'bars', data: slots.rows.filter(r => isNum(r.pts)).map(r => ({ id: r.g + ':' + r.stat, label: GROUP[r.g] + ' · ' + (P1_LABEL[r.stat] || r.stat), v: r.pts, dir: 1 })),
    o: { x: { label: 'points of margin a game' } }, label: 'Each group against what winners get, in points' };

  /* (5) squad */
  const squad = squadView(fo, club, nameOf);
  if (squad && squad.grid) charts.grid = { kind: 'heatmap', data: squad.grid, o: { label: 'net per 100 against the reference five' }, label: 'Shooters and bigs on the floor: net per 100 possessions' };

  /* (6) losses */
  const losses = lossesView(fo, club);
  if (losses && losses.mean.length) charts.lossMean = { kind: 'bars', data: losses.mean.map(p => ({ id: p.k, label: PART_LABEL[p.k] || p.k, v: p.pts, lo: p.lo, hi: p.hi, dir: 1 })),
    o: { x: { label: 'points a loss' } }, label: 'The average loss, part by part' };
  if (losses) losses.list.forEach((g, i) => {
    charts['loss' + i] = { kind: 'waterfall', data: { start: { label: 'expected', v: g.xm }, parts: PARTS.map(k => ({ k, label: PART_LABEL[k], v: partOf(g.parts, k) })), total: { label: 'result' } },
      o: { y: { label: 'points' } }, label: 'A loss, part by part' };
  });

  /* (7) next, (8) what if: the controls; the numbers come from the Worker in mount() */
  const opps = (fo.teams || []).filter(x => String(x.id) !== id).map(x => ({ id: String(x.id), name: x.short || x.name }));
  const nextFx = mus.find(f => f.known) || null;
  const next = t ? { opps, opp: (o.pick && o.pick.opp) || (nextFx ? nextFx.opp : (opps[0] && opps[0].id) || ''), home: o.pick && o.pick.home != null ? o.pick.home : (nextFx ? nextFx.h : 1),
    fixture: nextFx, calibrated: !!(fo.sim && fo.sim.calibrated) } : null;
  if (next) {
    const fx = mus.find(f => f.opp === next.opp);
    const o2 = teamOf(fo, next.opp), edge = fo.lg && isNum(fo.lg.homeEdge) ? fo.lg.homeEdge : 0;
    const pElo = t && o2 && isNum(t.elo) && isNum(o2.elo) ? 1 / (1 + Math.pow(10, -(t.elo - o2.elo) / 400)) : 0.5;
    next.mu = fx && fx.h === next.home ? fx.mu : sigma * PhiInv(pElo) + next.home * edge;
    next.p = Phi(next.mu / sigma);
  }
  const whatIf = t ? { dials: DIALS, end: (o.wi && o.wi.end) || 'off', vals: (o.wi && o.wi.vals) || {}, roster: rosterOptions(fo, club, nameOf) } : null;

  return { ok: true, fo, club, team: { id, name: team.name || (club && club.team && club.team.name) || (t && t.name) || '' }, t, sigma, mus,
    verdict, ledger: L, needs: N, slots, squad, losses, next, whatIf, charts, names, nameOf,
    lens: { forecast: !!fo.predLive, calibrated: !!(fo.sim && fo.sim.calibrated) }, n: fo.n || null };
}

/* (4) THE SLOTS: the club's group lines against the winners' targets (P2), each gap valued by P1 (points per +1 team-SD).
   A cell's SD is the file's when it carries one, else worked out from its z against the league median. */
function slotsView(fo, club) {
  const S = club && club.slots, F = fo && fo.slots;
  if (!S || !F) return null;
  const p1 = new Map((F.p1 || []).map(r => [r.g + ':' + r.stat, r]));
  const tg = new Map((F.targets || []).map(r => [r.g + ':' + r.stat, r]));
  const rows = [];
  ['G', 'F', 'C'].forEach(g => {
    const cells = S[g] || {};
    Object.keys(cells).forEach(stat => {
      const c = cells[stat], t = tg.get(g + ':' + stat), b = p1.get(g + ':' + stat);
      if (!c || !isNum(c.v)) return;
      const target = isNum(c.target) ? c.target : t ? t.top : null;
      let sd = isNum(c.sd) && c.sd > 0 ? c.sd : null;
      if (!sd && t && isNum(t.mid) && isNum(c.z) && Math.abs(c.z) >= 0.2) sd = Math.abs((c.v - t.mid) / c.z) || null;
      /* the gap in team-SDs, held within ±3 (the targets are medians and the SD may be worked out from z) */
      const gapSd = sd && isNum(target) ? Math.max(-3, Math.min(3, (target - c.v) / sd)) : null;
      /* the value of closing it: P1's points per team-SD. The share statistics are left unvalued: their three groups add up
         to the team's whole, so P1 identifies only contrasts and one group's gap alone has no price */
      const pts = b && isNum(b.b) && isNum(gapSd) && SHARE_STATS.indexOf(stat) < 0 ? b.b * gapSd : null;
      rows.push({ g, stat, v: c.v, z: c.z, target, mid: t ? t.mid : null, top: t ? t.top : null, sd, pts: isNum(pts) ? pts : null, b: b ? b.b : null, star: !!(b && b.star) });
    });
  });
  const gaps = rows.filter(r => isNum(r.pts) && r.pts > 0 && r.stat !== 'min_share').sort((a, b) => b.pts - a.pts).slice(0, 2);
  const forecast = (F.forecast || []).map(r => {
    const c = S[r.g] && S[r.g].bpm;
    return { g: r.g, b: r.b, lo: r.lo, hi: r.hi, v: c ? c.v : null, target: c ? c.target : null, pts: c && isNum(c.v) && isNum(c.target) ? r.b * (c.target - c.v) : null };
  });
  return { rows, gaps, forecast: forecast.length ? forecast : null };
}

/* (5) THE SQUAD: shape against the winners' bands, evidence-graded; the lineup grid and the club's fives */
function squadView(fo, club, nameOf) {
  const Q = fo && fo.squad, cs = club && club.squad;
  const rows = [];
  if (Q && cs) {
    const coef = new Map((Q.coef || []).map(c => [c.k, c]));
    Object.keys(cs).forEach(k => {
      const v = cs[k], band = Q.bands && Q.bands[k], c = coef.get(k);
      if (!isNum(v) || !band) return;
      const where = v < band.p25 ? 'below' : v > band.p75 ? 'above' : 'within';
      rows.push({ k, label: SQUAD_LABEL[k] || k, v, p25: band.p25, p50: band.p50, p75: band.p75, where, b: c ? c.b : null, lo: c ? c.lo : null, hi: c ? c.hi : null,
        wins30: c ? c.wins30 : null, evidence: c ? c.evidence : 'none' });
    });
  }
  let grid = null;
  const LU = fo && fo.lineup;
  if (LU && Array.isArray(LU.grid) && LU.grid.length) {
    const ss = [...new Set(LU.grid.map(c => c.s))].sort((a, b) => a - b), bs = ['0', '1', '2+'];
    const at = (s, b) => LU.grid.find(c => c.s === s && c.b === b);
    grid = { rows: ss.map(s => s + (s === 1 ? ' shooter' : ' shooters')), cols: bs.map(b => b + (b === '1' ? ' big' : ' bigs')), mode: 'div',
      cells: ss.map(s => bs.map(b => { const c = at(s, b); return c ? { v: c.net, lo: c.lo, hi: c.hi, hatch: c.poss < 200 } : null; })) };
  }
  const fives = club && Array.isArray(club.lineups) ? club.lineups.slice(0, 5).map(l => ({ names: (l.ids || []).map(nameOf).filter(Boolean), s: l.s, b: l.b, poss: l.poss, net: l.net, pred: l.pred })) : [];
  /* A.3: the club's players by role (its rotation first: the file lists them by minutes), named here, never in a file */
  const pl = club && Array.isArray(club.players) ? club.players : [];
  const roles = ROLES.map(k => ({ k, label: ROLE_LABEL[k], how: ROLE_HOW[k], names: pl.filter(p => (p.roles || []).includes(k)).map(p => nameOf(p.id)).filter(Boolean) })).filter(r => pl.length);
  if (!rows.length && !grid && !fives.length && !roles.length) return null;
  return { rows, n: Q ? Q.n : null, power: Q ? Q.power : null, grid, fives, roles, terms: LU ? LU.terms || [] : [] };
}

/* (6) THE LOSSES: exact parts (m = xm + Σ parts), the last ten, the mean over every loss with its interval */
function lossesView(fo, club) {
  if (!club || !Array.isArray(club.games)) return null;
  const opp = id => { const t = teamOf(fo, id); return t ? (t.short || t.name) : ''; };
  const list = club.games.filter(g => isNum(g.m) && g.m < 0).sort((a, b) => String(b.d).localeCompare(String(a.d))).slice(0, 10)
    .map(g => ({ g: g.g, d: g.d, opp: g.opp, oppName: opp(g.opp), h: g.h, m: g.m, mc: g.mc, xm: g.xm, parts: Object.assign({}, g.parts), luck: g.luck,
      total: (isNum(g.xm) ? g.xm : 0) + PARTS.reduce((a, k) => a + (isNum(partOf(g.parts, k)) ? partOf(g.parts, k) : 0), 0), sim: !!(club.realised && club.realised[g.g]) }));
  const mean = ((club.losses && club.losses.mean) || []).filter(p => isNum(p.pts));
  const lose = mean.filter(p => p.k !== 'expected' && isNum(p.hi) && p.hi < 0).map(p => PART_LABEL[p.k] || p.k);
  return { n: club.losses ? club.losses.n : list.length, list, mean, lose };
}

/* the roster what-if (§12 block 8): where the slot forecast exists, remove a player or add a median shooter at a slot */
function rosterOptions(fo, club, nameOf) {
  if (!fo || !fo.slots || !fo.slots.forecast || !club || !Array.isArray(club.players)) return null;
  const players = club.players.filter(p => isNum(p.bpm) && isNum(p.min) && p.min > 0).map(p => ({ id: String(p.id), g: p.g, name: nameOf(p.id), bpm: p.bpm, min: p.min }));
  return { players, groups: ['G', 'F', 'C'] };
}
/* Δ group BPM from a roster move, × θ_g (P2f) -> Δ margin a game (approximate): a removed player's minutes go to the
   rest of his group in proportion; an added median shooter takes `take` of the group's minutes at the league median BPM */
function rosterWhatIf(fo, club, move) {
  const F = fo && fo.slots && fo.slots.forecast, P = club && club.players;
  if (!F || !P || !move) return null;
  const g = move.g || (P.find(p => String(p.id) === String(move.remove)) || {}).g;
  const th = F.find(r => r.g === g);
  if (!th) return null;
  const grp = P.filter(p => p.g === g && isNum(p.bpm) && isNum(p.min) && p.min > 0);
  const M = grp.reduce((a, p) => a + p.min, 0);
  if (!(M > 0)) return null;
  const old = grp.reduce((a, p) => a + p.bpm * p.min, 0) / M;
  let now;
  if (move.remove) {
    const rest = grp.filter(p => String(p.id) !== String(move.remove)), R = rest.reduce((a, p) => a + p.min, 0);
    if (!(R > 0)) return null;
    now = rest.reduce((a, p) => a + p.bpm * p.min, 0) / R;
  } else {
    const tgt = (fo.slots.targets || []).find(r => r.g === g && r.stat === 'bpm');
    const med = tgt && isNum(tgt.mid) ? tgt.mid : 0, take = isNum(move.take) ? move.take : 0.2;
    now = (1 - take) * old + take * med;
  }
  const dBpm = now - old, dm = th.b * dBpm;
  return { g, dBpm, dMargin: dm, lo: Math.min(th.lo * dBpm, th.hi * dBpm), hi: Math.max(th.lo * dBpm, th.hi * dBpm) };
}

/* ------------------------------------------------------------------ the html --- */
const H = {};
const sec = (b, sum, body, open) => '<details class="fm-b" data-b="' + b + '"' + (open ? ' open' : '') + '><summary><span class="fm-bt">' + esc(BLOCK_TITLE[b]) + '</span>' +
  (sum ? '<span class="fm-bs">' + sum + '</span>' : '') + '</summary><div class="fm-bb">' + body + '</div></details>';
const winsTxt = (w) => (isNum(w) ? (Math.abs(w) < 0.05 ? '0.0' : sg(w, 1)) : '–');

H.verdict = vm => {
  const V = vm.verdict;
  if (!V) return empty('The club has no finished games in the model yet.');
  const P = V.proj;
  const line = 'Record ' + V.w + '-' + V.l + ' · Pythagorean ' + f1(V.pythW) + ' · from its factors ' + f1(V.factorW) + ' wins';
  let html = '<p class="fm-big">' + esc(line) + '</p>';
  html += '<p class="fm-p">' + esc(isNum(V.luck) ? 'Luck: ' + sg(V.luck, 1) + ' wins against what its factors earned' : 'Luck: not measured') + '</p>';
  if (P && P.left) {
    html += '<p class="fm-p">' + esc('Projected wins ' + P.p10 + ' – ' + P.p50 + ' – ' + P.p90 + ' (p10 – p50 – p90) with ' + P.left + (P.left === 1 ? ' game to play' : ' games to play')) +
      ' ' + chip(V.forecast ? 'forecast' : 'elo') + '</p>' + slot('proj');
  } else if (P) html += '<p class="fm-p">' + esc('No fixtures left to play this season') + '</p>';
  html += '<p class="fm-say">' + esc(V.cost ? 'Your biggest cost is ' + low(V.cost.label) + ' on ' + END[V.cost.end] + ': about ' + f1(-V.cost.wins) +
    ' wins (' + f1(-V.cost.hi) + '–' + f1(-V.cost.lo) + ') over 30 games' : 'No single factor costs this club wins beyond the noise') + '</p>';
  html += '<p class="fm-lens">' + chip('explain') + ' ' + chip(V.forecast ? 'forecast' : 'elo', V.forecast ? '' : 'season numbers do not forecast better than Elo here') + '</p>';
  return html;
};
const ledgerRow = r => '<tr><th scope="row">' + esc(r.label) + '</th><td>' + esc(END[r.end]) + '</td><td translate="no">' + esc(unitFmt(r.unit, r.x)) + '</td><td translate="no">' +
  esc(unitFmt(r.unit, r.p50)) + '</td><td translate="no">' + esc(unitFmt(r.unit, r.target)) + '</td><td translate="no" class="' + (r.pts >= 0 ? 'fm-good' : 'fm-bad') + '">' +
  (r.pts >= 0 ? '▲ ' : '▼ ') + esc(sg(r.pts, 2)) + '</td><td translate="no">' + esc(winsTxt(r.wins30)) + '</td><td translate="no">' + esc(sg(r.wlo, 1) + ' to ' + sg(r.whi, 1)) + '</td></tr>';
const LEDGER_HEAD = '<thead><tr><th scope="col">factor</th><th scope="col">end</th><th scope="col">club</th><th scope="col">median</th><th scope="col">winners’ P75</th>' +
  '<th scope="col">points a game</th><th scope="col">wins per 30</th><th scope="col">95% range</th></tr></thead>';
H.ledger = vm => {
  const L = vm.ledger;
  if (!L || !L.core.length) return empty('The club’s factors are not in this file yet.');
  let html = slot('core');
  html += tw('<table class="fm-t">' + LEDGER_HEAD + '<tbody>' + L.core.map(ledgerRow).join('') + '</tbody></table>');
  html += '<p class="fm-check">' + esc('The contributions add up to ' + sg(L.sum, 2) + ' points a game, the factor-expected margin (check: ' + sg(L.expected, 2) + ')') +
    ' ' + chip('explain') + '</p>';
  if (L.actual) html += '<p class="fm-p">' + esc('Its actual competitive margin: ' + sg(L.actual.v, 2) + ' points a game') + nTag(L.actual.n) + '</p>';
  if (L.levers.length) {
    html += '<h4 class="fm-h4">' + esc('The levers') + '</h4><p class="fm-p fm-mute">' + esc('Valued one at a time; they work through the four factors, so they are not added to them') + '</p>';
    html += tw('<table class="fm-t">' + LEDGER_HEAD + '<tbody>' + L.levers.map(ledgerRow).join('') + '</tbody></table>');
  }
  return html;
};
H.needs = vm => {
  const N = vm.needs;
  if (!N || !N.length) return empty('Every factor the model can value is at the league’s P75 or better, or too uncertain to rank');
  const per = N[0].perSeason ? 'over a season of ' + N[0].G + ' games against an average side' : 'over the ' + N[0].games + (N[0].games === 1 ? ' game to play' : ' games to play');
  let html = '<p class="fm-p">' + esc('Ranked by the wins each adds ' + per + ', reaching the league’s P75 alone') + ' ' +
    chip(N.some(n => n.src === 'sim') ? 'model' : (vm.lens.forecast ? 'forecast' : 'elo')) + '</p>' + slot('needs');
  html += '<ol class="fm-needs">' + N.map(n => '<li><b>' + esc(n.label + ' on ' + END[n.end]) + '</b> <span class="fm-p">' +
    esc('from ' + unitFmt(n.unit, n.x) + ' to ' + unitFmt(n.unit, n.target)) + '</span> <span class="fm-w">' +
    esc('worth ' + winsTxt(n.wins) + ' wins (± ' + (isNum(n.se) && n.se < 0.1 ? f2(n.se) : f1(n.se)) + ')') + '</span>' + (n.need ? '<span class="fm-need">' + esc(cap(n.need)) + '</span>' : '') + '</li>').join('') + '</ol>';
  return html;
};
H.slots = vm => {
  const S = vm.slots;
  const btns = '<div class="fm-slotb">' + SLOT_KEYS.map(k => '<button type="button" class="ep-btn mini" data-slot="' + k + '">' + k + '</button>').join('') +
    '<span class="fm-p fm-mute">' + esc('press a position for its league view') + '</span></div>';
  if (!S || !S.rows.length) return empty('The slot targets need the positions model: not built for this league yet') + btns;
  let html = '';
  if (S.gaps.length) html += '<p class="fm-say">' + esc('The two largest gaps: ' + S.gaps.map(r => GROUP[r.g].toLowerCase() + ' ' + low(P1_LABEL[r.stat] || r.stat) + ' (' + sg(r.pts, 1) + ' points)').join(' and ')) + '</p>';
  html += slot('slots');
  html += tw('<table class="fm-t"><thead><tr><th scope="col">group</th><th scope="col">statistic</th><th scope="col">club</th><th scope="col">winners</th><th scope="col">league</th>' +
    '<th scope="col">points from reaching winners</th></tr></thead><tbody>' + S.rows.map(r => '<tr><th scope="row">' + esc(GROUP[r.g]) + '</th><td>' + esc(P1_LABEL[r.stat] || r.stat) +
      (r.star ? ' ★' : '') + '</td><td translate="no">' + esc(f2(r.v)) + '</td><td translate="no">' + esc(f2(r.top)) + '</td><td translate="no">' + esc(f2(r.mid)) +
      '</td><td translate="no">' + esc(isNum(r.pts) ? sg(r.pts, 2) : '–') + '</td></tr>').join('') + '</tbody></table>');
  if (S.forecast) html += '<p class="fm-p">' + esc('One point of BPM is worth, in points of margin: ' + S.forecast.map(r => GROUP[r.g].toLowerCase() + ' ' + f2(r.b) + ' (' + f2(r.lo) + '–' + f2(r.hi) + ')').join(', ')) +
    ' ' + chip('forecast') + '</p>';
  return html + btns;
};
H.squad = vm => {
  const Q = vm.squad;
  if (!Q) return empty('The squad model needs more team-seasons in this league');
  let html = '';
  if (Q.rows.length) {
    html += '<p class="fm-p">' + esc(Q.power === 'low' ? 'Few team-seasons: the evidence is weak, and said so' : 'Against the band of the league’s top-quarter clubs (P25-P75)') + nTag(Q.n) + '</p>';
    html += tw('<table class="fm-t"><thead><tr><th scope="col">measure</th><th scope="col">club</th><th scope="col">winners’ band</th><th scope="col">where</th><th scope="col">evidence</th></tr></thead><tbody>' +
      Q.rows.map(r => '<tr><th scope="row">' + esc(r.label) + '</th><td translate="no">' + esc(f2(r.v)) + '</td><td translate="no">' + esc(f2(r.p25) + '–' + f2(r.p75)) + '</td><td>' +
        esc(r.where) + '</td><td><span class="fm-ev" data-ev="' + esc(r.evidence) + '">' + esc(r.evidence) + '</span></td></tr>').join('') + '</tbody></table>');
  }
  if (Q.roles && Q.roles.length) html += '<h4 class="fm-h4">' + esc('Roles in the squad') + '</h4>' + tw('<table class="fm-t"><thead><tr><th scope="col">role</th><th scope="col">players</th><th scope="col">how it is earned</th></tr></thead><tbody>' +
    Q.roles.map(r => '<tr><th scope="row">' + esc(r.label) + '</th><td translate="no" class="fm-five">' + esc(r.names.join(', ') || '–') + '</td><td>' + esc(r.how) + '</td></tr>').join('') + '</tbody></table>') +
    '<p class="fm-p fm-mute">' + esc('Each cut is a percentile within this league-season; What wins shows the values and how each role goes with winning') + '</p>';
  if (Q.grid) html += '<h4 class="fm-h4">' + esc('Shooters and bigs on the floor') + '</h4>' + slot('grid');
  if (Q.fives.length) html += '<h4 class="fm-h4">' + esc('The club’s most used fives') + '</h4>' + tw('<table class="fm-t"><thead><tr><th scope="col">five</th><th scope="col">shooters</th><th scope="col">bigs</th>' +
    '<th scope="col">possessions</th><th scope="col">net per 100</th><th scope="col">model</th></tr></thead><tbody>' + Q.fives.map(f => '<tr><td translate="no" class="fm-five">' + esc(f.names.join(', ') || '–') +
      '</td><td translate="no">' + esc(f.s) + '</td><td translate="no">' + esc(f.b) + '</td><td translate="no">' + esc(Math.round(f.poss)) + '</td><td translate="no">' + esc(sg(f.net, 1)) +
      '</td><td translate="no">' + esc(sg(f.pred, 1)) + '</td></tr>').join('') + '</tbody></table>');
  return html + '<p class="fm-p fm-mute">' + esc('The opposing five is not controlled') + '</p>';
};
H.losses = vm => {
  const X = vm.losses;
  if (!X || !X.list.length) return empty('No defeats to read yet');
  let html = '<p class="fm-say">' + esc(X.lose.length ? 'You lose when ' + X.lose.join(' and ') + ' go against you' : 'No part of the losses stands out beyond the noise') + nTag(X.n) + '</p>';
  if (X.mean.length) html += slot('lossMean');
  html += '<div class="fm-losses">' + X.list.map((g, i) => '<details class="fm-loss" data-i="' + i + '"><summary><span translate="no">' + esc(g.d) + '</span> ' +
    '<span translate="no">' + esc(g.oppName) + '</span> <span>' + esc(g.h === 1 ? 'home' : g.h === -1 ? 'away' : 'neutral') + '</span> <b translate="no">' + esc(sg(g.m, 0)) + '</b></summary>' +
    slot('loss' + i) + (g.sim ? '<p><button type="button" class="ep-btn mini" data-act="shapley" data-i="' + i + '">' + esc('simulator check') + '</button></p><div class="fm-shap" data-shap="' + i + '"></div>' : '') +
    '</details>').join('') + '</div>';
  return html + '<p class="fm-p fm-mute">' + esc('Each defeat: what was expected, then each part, adding up to the result exactly') + ' ' + chip('explain') + '</p>';
};
H.next = vm => {
  const X = vm.next;
  if (!X) return empty('The club is not in this file');
  const opt = X.opps.map(o => '<option value="' + esc(o.id) + '"' + (o.id === X.opp ? ' selected' : '') + ' translate="no">' + esc(o.name) + '</option>').join('');
  const venue = [[1, 'home'], [-1, 'away'], [0, 'neutral']].map(([v, t]) => '<button type="button" data-act="venue" data-v="' + v + '" aria-pressed="' + (v === X.home) + '">' + esc(t) + '</button>').join('');
  return '<div class="fm-ctl"><label class="fm-lab">' + esc('opponent') + ' <select class="ep-input" data-act="opp">' + opt + '</select></label>' +
    '<div class="pg-seg fm-seg" role="group" aria-label="' + esc('venue') + '">' + venue + '</div></div>' +
    '<p class="fm-p" data-out="nextP">' + esc('Chance of winning from the margin model: ' + pc(X.p) + '%') + ' ' + chip(vm.lens.forecast ? 'forecast' : 'elo') + '</p>' +
    '<div class="fm-chart" data-live="meter"></div><div class="fm-chart" data-live="hist"></div>' +
    '<p class="fm-p">' + chip('model', X.calibrated ? '' : 'experimental: relative differences only') + '</p>' +
    '<div class="fm-ctl"><div class="pg-seg fm-seg" role="group" aria-label="' + esc('end') + '"><button type="button" data-act="nend" data-v="off" aria-pressed="true">' + esc('our offence') + '</button>' +
    '<button type="button" data-act="nend" data-v="def" aria-pressed="false">' + esc('their offence') + '</button></div>' +
    '<button type="button" class="ep-btn" data-act="needed">' + esc('work out what it takes') + '</button></div><div class="fm-needed" data-out="needed" aria-live="polite"></div>';
};
H.whatIf = vm => {
  const X = vm.whatIf;
  if (!X) return empty('The club is not in this file');
  const ends = [['off', 'our offence'], ['def', 'our defence']].map(([v, t]) => '<button type="button" data-act="wend" data-v="' + v + '" aria-pressed="' + (v === X.end) + '">' + esc(t) + '</button>').join('');
  let html = '<div class="fm-ctl"><div class="pg-seg fm-seg" role="group" aria-label="' + esc('end') + '">' + ends + '</div>' +
    '<button type="button" class="ep-btn mini" data-act="wreset">' + esc('reset') + '</button></div><div class="fm-dials">' + X.dials.map(d => {
    const v = isNum(X.vals[d.key]) ? X.vals[d.key] : 0;
    return '<label class="fm-dial"><span class="fm-dl">' + esc(d.label) + '</span><input type="range" data-dial="' + d.key + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v +
      '" aria-label="' + esc(d.label) + '"><output translate="no" data-dv="' + d.key + '">' + esc(sg(v, 1) + ' ' + d.unit) + '</output></label>';
  }).join('') + '</div><div class="fm-wi" data-out="whatif" aria-live="polite"><p class="fm-p fm-mute">' + esc('Move a dial to see the change') + '</p></div>';
  if (X.roster && X.roster.players.length) {
    html += '<h4 class="fm-h4">' + esc('A roster what-if') + '</h4><div class="fm-ctl"><label class="fm-lab">' + esc('remove') + ' <select class="ep-input" data-act="rremove"><option value="">' +
      esc('nobody') + '</option>' + X.roster.players.map(p => '<option value="' + esc(p.id) + '" translate="no">' + esc(p.name || p.g + ' ' + p.id.slice(0, 4)) + '</option>').join('') + '</select></label>' +
      '<label class="fm-lab">' + esc('add a median shooter at') + ' <select class="ep-input" data-act="radd"><option value="">' + esc('nowhere') + '</option>' +
      X.roster.groups.map(g => '<option value="' + g + '">' + esc(GROUP[g].toLowerCase()) + '</option>').join('') + '</select></label></div><div class="fm-wi" data-out="roster" aria-live="polite"></div>';
  }
  return html + '<p class="fm-p fm-mute">' + esc('The simulator moves one rate with the others fixed') + ' ' + chip('model', vm.lens.calibrated ? '' : 'experimental: relative differences only') + '</p>';
};
/* the whole panel: the status line and its bar, then the blocks */
function panel(vm, o) {
  o = o || {};
  if (!vm || !vm.ok) {
    if (vm && ['members', 'league'].indexOf(vm.reason) >= 0) return '<div class="fm" data-fm><div class="fm-lock" data-memlock="5"></div></div>';
    if (vm && (vm.reason === 'signin' || vm.reason === 'jwt')) return '<div class="fm" data-fm><div class="fm-empty"><p>' + esc('Members’ analysis.') + ' <a href="' + esc(o.signin || '../signin/') + '">' + esc('Sign in') + '</a> ' + esc('to see it.') + '</p></div></div>';
    return '<div class="fm" data-fm>' + empty(vm ? vm.message : MSG.network) + '</div>';
  }
  const V = vm.verdict, N = vm.needs, X = vm.losses;
  const sums = {
    verdict: V ? esc(V.w + '-' + V.l + (V.proj && V.proj.left ? ' · projected ' + V.proj.p50 + ' wins' : '')) : '',
    ledger: vm.ledger ? esc('factor-expected margin ' + sg(vm.ledger.sum, 1) + ' a game') : '',
    needs: N && N.length ? esc(N[0].label + ' on ' + END[N[0].end] + ': ' + winsTxt(N[0].wins) + ' wins') : '',
    slots: vm.slots && vm.slots.gaps.length ? esc(GROUP[vm.slots.gaps[0].g] + ': ' + low(P1_LABEL[vm.slots.gaps[0].stat] || vm.slots.gaps[0].stat)) : '',
    squad: vm.squad && vm.squad.fives.length ? esc(vm.squad.fives.length + ' fives') : '',
    losses: X ? esc(X.n + (X.n === 1 ? ' loss' : ' losses')) : '',
    next: vm.next && vm.next.fixture ? esc('next: ' + vm.next.fixture.oppName) : '',
    whatIf: ''
  };
  const status = '<div class="fm-status"><p class="fm-line" data-fm-line aria-live="polite"></p><div class="fm-acts">' +
    '<button type="button" class="ep-btn fm-recalc" data-act="recalc" disabled>' + esc('Recalculate') + '</button>' +
    '<button type="button" class="ep-btn fm-cancel hide" data-act="cancel">' + esc('Cancel') + '</button></div>' +
    '<div class="fm-prog hide" data-fm-prog role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><ol class="fm-stages">' +
    STAGES.map(s => '<li data-st="' + s + '">' + esc(STAGE_LABEL[s]) + '</li>').join('') + '</ol><div class="fm-blocks" aria-hidden="true">' + '<i></i>'.repeat(24) + '</div>' +
    '<p class="fm-progl" data-fm-progl aria-live="polite"></p></div><p class="fm-msg hide" data-fm-msg role="status" aria-live="polite"></p></div>';
  const open = { verdict: true, ledger: true, needs: true };
  return '<div class="fm" data-fm>' + status + BLOCKS.map(b => sec(b, sums[b], H[b](vm), open[b])).join('') +
    '<p class="fm-foot">' + esc('Accounting is identity, not levers; the simulator is a model’s answer, never proof of cause') + '</p></div>';
}

/* ------------------------------------------------------------------ the status line (A.2) --- */
const ago = (iso, now) => {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const m = Math.max(0, Math.round(((now || Date.now()) - t) / 60000));
  if (m < 2) return 'built just now';
  if (m < 60) return 'built ' + m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 48) return 'built ' + h + ' h ago';
  return 'built ' + Math.round(h / 24) + ' days ago';
};
function statusLine(ans, F, o) {
  o = o || {};
  if (!F) return { line: '', canRecalc: false, upToDate: false };
  const n = F.n && F.n.games, parts = [];
  if (isNum(n)) parts.push('Model of ' + n + ' games');
  const b = ago((ans && ans.built) || F.built, o.now);
  if (b) parts.push(b);
  const pend = ans && isNum(ans.pending) ? ans.pending : null;
  if (pend > 0) parts.push(pend + (pend === 1 ? ' new game since' : ' new games since'));
  else if (pend === 0) parts.push('up to date');
  return { line: parts.join(' · '), canRecalc: !!(F.league && pend > 0), upToDate: pend === 0 };
}

/* ------------------------------------------------------------------ ?wi= --- */
/* the state is ASCII (keys and numbers), so btoa / atob carry it as they are */
const b64u = s => root.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => root.atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
function encodeWi(wi) {
  const vals = {};
  DIALS.forEach(d => { const v = wi && wi.vals && wi.vals[d.key]; if (isNum(v) && v) vals[d.key] = v; });
  return Object.keys(vals).length ? b64u(JSON.stringify({ e: wi.end === 'def' ? 'def' : 'off', v: vals })) : '';
}
function decodeWi(s) {
  if (!s) return null;
  try {
    const o = JSON.parse(unb64u(s)), vals = {};
    DIALS.forEach(d => { const v = o && o.v && +o.v[d.key]; if (isNum(v)) vals[d.key] = Math.max(d.min, Math.min(d.max, v)); });
    return { end: o && o.e === 'def' ? 'def' : 'off', vals };
  } catch (_) { return null; }
}

/* ------------------------------------------------------------------ the Worker --- */
/* new Worker('../winsim.worker.js?v=' + this script's ?v=); no Worker: the same call on the main thread, n / 5, in idle slices */
function makeWorker(v) {
  const ver = v != null ? v : SELF_V;
  let w = null, seq = 0;
  const jobs = new Map();
  function worker() {
    if (w === false) return null;
    if (!w) {
      try {
        w = new root.Worker('../winsim.worker.js?v=' + ver);
        w.onmessage = e => { const m = e.data || {}, j = jobs.get(m.id); if (!j) return; if (m.progress != null) { if (j.onProgress) j.onProgress(m.progress); return; }
          jobs.delete(m.id); if (m.ok) j.resolve(m.result); else j.reject(new Error(m.error || 'failed')); };
        w.onerror = () => { const all = [...jobs.values()]; jobs.clear(); w = false; all.forEach(j => j.fallback()); };
      } catch (_) { w = false; return null; }
    }
    return w;
  }
  function local(op, args, o) {
    const S = SIM(); if (!S) return Promise.reject(new Error('no simulator'));
    const a = Object.assign({}, args);
    if (a.n) a.n = Math.max(200, Math.round(a.n / 5));
    const idle = fn => (root.requestIdleCallback ? root.requestIdleCallback(fn, { timeout: 60 }) : root.setTimeout(fn, 0));
    return S.drive(S.steps(op, a), { slice: 12, onProgress: o.onProgress, cancelled: () => !!(o.signal && o.signal.aborted), defer: idle });
  }
  function run(op, args, o) {
    o = o || {};
    const ww = typeof root.Worker === 'function' ? worker() : null;
    if (!ww) return local(op, args, o);
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const j = { resolve, reject, onProgress: o.onProgress, fallback: () => local(op, args, o).then(resolve, reject) };
      jobs.set(id, j);
      if (o.signal) o.signal.addEventListener('abort', () => { if (jobs.has(id)) { ww.postMessage({ id, op: 'cancel' }); jobs.delete(id); reject(new Error('cancelled')); } }, { once: true });
      ww.postMessage({ id, op, args });
    });
  }
  return { run, terminate() { if (w) { try { w.terminate(); } catch (_) { /* gone */ } } w = false; } };
}

/* ------------------------------------------------------------------ mount --- */
/* host: #wmodel; vm: view(input); opts = {input (view()'s input, kept for redraws), worker ({run}), link (player -> href),
   onSlot (button, slot), refresh ({signal, onProgress}) -> Promise<{ok, fo, club, ans, refreshed, queued, joined, refreshReason} | {ok: false, reason}>,
   ans (the fo file's answer, for the status line), signin (href)} -> {destroy, redraw} */
function mount(host, vm, opts) {
  opts = opts || {};
  const doc = host.ownerDocument;
  let binds = [], destroyed = false, input = Object.assign({}, opts.input || {}), ans = opts.ans || null;
  const wiQ = (() => { try { return decodeWi(new URLSearchParams(root.location.search).get('wi')); } catch (_) { return null; } })();
  if (wiQ && !input.wi) input.wi = wiQ;
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => host.querySelector(s);
  let simAbort = null, wiAbort = null, wiT = 0, recalcAbort = null;
  /* RECALCULATE held off after a refusal or a no-op answer (rate, recent, queued) until its retry time has passed */
  let holdUntil = 0, holdT = 0;
  const hold = sec => { holdUntil = Math.max(holdUntil, Date.now() + 1000 * Math.max(1, sec || 0)); };
  const state = { nend: 'off' };

  function bindCharts() {
    binds.forEach(b => b.destroy()); binds = [];
    const K = VK(); if (!K) return;
    host.querySelectorAll('[data-chart]').forEach(el => {
      const spec = vm.charts[el.getAttribute('data-chart')];
      if (!spec || !K[spec.kind]) return;
      if (el.closest('details') && !el.closest('details').open) return;      // drawn when its block opens
      binds.push(K.bind(el, o => K[spec.kind](spec.data, Object.assign({}, spec.o, { W: o.W, id: 'fm' + el.getAttribute('data-chart') })), { label: spec.label }));
    });
  }
  function placeholders() {
    host.querySelectorAll('[data-memlock]').forEach(ph => {
      const M = root.EpinoiaMemLock, node = M && M.placeholder ? M.placeholder({ rows: +ph.getAttribute('data-memlock') || 5, what: 'What wins model', key: 'model', leagueSlug: opts.leagueSlug }) : null;
      if (node) ph.replaceWith(node); else ph.innerHTML = empty(MSG.members);
    });
  }
  function draw() {
    if (destroyed) return;
    host.innerHTML = panel(vm, { signin: opts.signin });
    placeholders();
    if (!vm.ok) return;
    bindCharts();
    status();
    const nx = host.querySelector('details[data-b="next"]');
    if (nx && nx.open) simulateNext();
  }
  /* ---- the status line, RECALCULATE and its bar ---- */
  function status() {
    const line = $('[data-fm-line]'), btn = $('[data-act="recalc"]');
    if (!line || !btn) return;
    const s = statusLine(ans, vm.fo);
    line.textContent = s.line;
    const wait = holdUntil - Date.now();
    btn.disabled = !s.canRecalc || !opts.refresh || !!recalcAbort || wait > 0;
    root.clearTimeout(holdT);
    if (wait > 0 && !destroyed) holdT = root.setTimeout(status, Math.min(wait + 50, 2147483647));
    btn.textContent = s.upToDate ? 'Up to date' : 'Recalculate';
  }
  function stage(name, frac, text) {
    const prog = $('[data-fm-prog]'); if (!prog) return;
    const i = STAGES.indexOf(name);
    const pct = Math.round(100 * Math.min(1, (Math.max(0, i) + Math.max(0, Math.min(1, frac || 0))) / STAGES.length));
    prog.setAttribute('aria-valuenow', String(pct));
    prog.setAttribute('aria-valuetext', text || '');
    const all = i === STAGES.length - 1 && frac >= 1;
    prog.querySelectorAll('li').forEach((li, k) => { li.classList.toggle('on', k === i && !all); li.classList.toggle('done', k < i || all); });
    prog.querySelectorAll('.fm-blocks i').forEach((b, k) => b.classList.toggle('on', k < Math.round(24 * pct / 100)));
    if (text != null) $('[data-fm-progl]').textContent = text;
  }
  function say(msg) { const m = $('[data-fm-msg]'); if (!m) return; m.textContent = msg || ''; m.classList.toggle('hide', !msg); }
  async function recalc() {
    if (!opts.refresh || recalcAbort) return;
    const ab = recalcAbort = new root.AbortController();
    $('[data-fm-prog]').classList.remove('hide'); $('[data-act="cancel"]').classList.remove('hide'); $('[data-act="recalc"]').disabled = true; say('');
    stage('check', 0, 'Checking what has changed');
    let a;
    const before = vm.fo && vm.fo.n ? vm.fo.n.games : 0;
    try {
      a = await opts.refresh({ signal: ab.signal, onProgress: p => {
        if (p.stage === 'update') stage('update', 0.3, 'Updating the model on the server');
        if (p.stage === 'download') stage('download', p.total ? p.loaded / p.total : 0.5, 'Downloading the new file' + (p.loaded ? ' (' + Math.round(p.loaded / 1024) + ' KB)' : ''));
      } });
    } catch (_) { a = { ok: false, reason: 'network' }; }
    if (!a || !a.ok) {
      if (a && a.reason === 'rate') hold(a.retryAfter || 60);
      finish();
      const r = a ? a.reason : 'network';
      if (r === 'aborted') return say('Cancelled: anything the server had started still finishes, and is reused next time');
      if (r === 'rate') return say(rateMsg(a.retryAfter));
      if (r === 'signin' || r === 'jwt') return say('Sign in to recalculate');
      if (r === 'members') return say('Recalculating is for members');
      return say(MSG[r] || MSG.network);
    }
    /* nothing was updated (queued for the scheduled build, too many games, or updated moments ago): the bar stops at
       the server's step and says why; no re-simulating, no "Done"; the button waits out the retry time */
    if (a.queued || a.refreshReason === 'recent' || a.refreshReason === 'cap') {
      hold(a.retryAfter || (a.refreshReason === 'recent' ? 600 : 120));
      const p = $('[data-fm-prog]'); if (p) p.classList.add('hide');
      finish();
      return say(a.refreshReason === 'cap' ? 'Too many new games for a quick update: a full rebuild is scheduled'
        : a.refreshReason === 'recent' ? 'Updated a few minutes ago: try again shortly' : 'The update is queued: the next scheduled build picks these games up first');
    }
    ans = a.ans || a;
    input = Object.assign({}, input, { fo: a.fo || input.fo, club: a.club || input.club });
    stage('sim', 0, 'Re-simulating');
    vm = view(input);
    const nextOpen = !!(host.querySelector('details[data-b="next"]') || {}).open;
    try {
      if (vm.next && vm.t) await runNextSim({ signal: ab.signal, onProgress: p => stage('sim', p, 'Re-simulating: ' + Math.round(100 * p) + '%') }, true);
    } catch (e) { if (ab.signal.aborted) { finish(); return say('Cancelled: anything the server had started still finishes, and is reused next time'); } }
    stage('draw', 0.5, 'Drawing');
    const keep = recalcAbort; recalcAbort = null;
    draw();
    if (nextOpen) { const d = host.querySelector('details[data-b="next"]'); if (d) d.open = true; }
    recalcAbort = keep;
    $('[data-fm-prog]').classList.remove('hide');
    stage('draw', 1, 'Done');
    finish();
    const added = (vm.fo && vm.fo.n ? vm.fo.n.games : 0) - before;
    if (a.joined) say('Joined an update already running' + (added > 0 ? ': ' + added + ' new games added' : ''));
    else if (a.refreshed) say(added > 0 ? 'Recalculated with ' + added + ' new games' : 'Recalculated');
    else say('Up to date');
  }
  function finish() {
    recalcAbort = null;
    const c = $('[data-act="cancel"]'); if (c) c.classList.add('hide');
    root.setTimeout(() => { const p = $('[data-fm-prog]'); if (!recalcAbort && p) p.classList.add('hide'); }, reduced() ? 0 : 1200);
    status();
  }

  /* ---- (7) the next opponent: the simulator in the Worker ---- */
  const S = SIM, wk = () => opts.worker;
  const avgSide = fo => ({ off: Object.assign({}, fo.lg.rates), def: Object.assign({}, fo.lg.rates), n: 0 });
  function matchFor(oppId, home) {
    const Sm = S(), fo = vm.fo, me = vm.t, op = oppId === '_avg' ? avgSide(fo) : (teamOf(fo, oppId) || {}).prof;
    if (!Sm || !me || !me.prof || !op) return null;
    return Sm.matchup(me.prof, op, fo.lg, { home, platt: fo.sim && fo.sim.calibrated ? fo.sim.platt : null });
  }
  let lastNext = null;
  async function runNextSim(o, quiet) {
    const X = vm.next; if (!X || !wk()) return null;
    const M = matchFor(X.opp, X.home); if (!M) return null;
    const r = await wk().run('simulate', { M, n: 5000, seed: 1 }, o);
    lastNext = r;
    if (!quiet) drawNext(r);
    return r;
  }
  function drawNext(r) {
    const X = vm.next, K = VK(); if (!X || !r) return;
    const meterEl = host.querySelector('[data-live="meter"]'), histEl = host.querySelector('[data-live="hist"]');
    const me = vm.t, op = teamOf(vm.fo, X.opp);
    /* calibrated: the simulator's own chance; experimental: the margin model's, the simulator shown beside it */
    const p = X.calibrated ? r.pWin : X.p, se = X.calibrated ? r.se : null;
    const out = host.querySelector('[data-out="nextP"]');
    if (out) out.textContent = X.calibrated ? 'Chance of winning: ' + pc(p) + '% (the simulator alone: ' + pc(r.pRaw) + '%)' : 'Chance of winning from the margin model: ' + pc(X.p) + '% (the simulator alone: ' + pc(r.pWin) + '%)';
    if (K && meterEl) binds.push(K.bind(meterEl, o => K.meter({ p, se, a: me ? (me.short || me.name) : 'A', b: op ? (op.short || op.name) : 'B', label: 'chance of winning' }, { W: o.W, id: 'fmmeter' }), { label: 'Chance of winning' }));
    if (K && histEl && r.hist) binds.push(K.bind(histEl, o => K.histogram(r.hist, { W: o.W, id: 'fmhist', mark: 0, x: { label: 'final margin (simulated)' }, y: { label: 'games' } }), { label: 'Simulated final margins' }));
  }
  async function simulateNext() {
    if (simAbort) simAbort.abort();
    const ab = simAbort = new root.AbortController();
    try { await runNextSim({ signal: ab.signal }); } catch (_) { /* cancelled or no simulator */ }
  }
  /* the values needed on six rates for 50% and 60% (our offence, or their offence against us) */
  async function needed() {
    const X = vm.next, out = host.querySelector('[data-out="needed"]'); if (!X || !out) return;
    const fo = vm.fo, sigma = vm.sigma, mu = X.mu;
    const Sm = S(), M = matchFor(X.opp, X.home);
    if (!Sm || !M) { out.textContent = 'The simulator is not loaded'; return; }
    out.textContent = 'Working it out…';
    const end = state.nend, me = vm.t.prof, cur = Sm.natural(end === 'off' ? me.off : me.def, M.zones), R = Sm.RANGE || {};
    const lines = [];
    for (const d of DIALS) {
      const per = [];
      for (const target of [0.5, 0.6]) {
        let v = null;
        if (X.calibrated && wk()) {
          try { const r = await wk().run('needed', { M, key: d.key, side: 'A', end, target, n: 3000 }); if (r && r.reached) v = r.value; } catch (_) { v = null; }
        } else v = neededByMargin(fo, d, end, cur[d.key], sigma * PhiInv(target) - mu, R[d.key]);
        per.push(v);
      }
      lines.push({ d, cur: cur[d.key], v50: per[0], v60: per[1] });
    }
    out.innerHTML = '<ul class="fm-list">' + lines.map(l => '<li>' + esc(neededText(l, end)) + '</li>').join('') + '</ul>' +
      '<p class="fm-p fm-mute">' + esc(X.calibrated ? 'From the simulator, one rate at a time' : 'From the margin model, one rate at a time') + '</p>';
  }
  /* ---- (8) what if ---- */
  function readDials() {
    const vals = {};
    host.querySelectorAll('[data-dial]').forEach(i => { const v = +i.value; if (v) vals[i.getAttribute('data-dial')] = v; });
    return vals;
  }
  function queueWhatIf() { root.clearTimeout(wiT); wiT = root.setTimeout(whatIf, 250); }
  async function whatIf() {
    const X = vm.whatIf, out = host.querySelector('[data-out="whatif"]'); if (!X || !out) return;
    const vals = readDials(), end = X.end;
    X.vals = vals;
    try { const u = new URL(root.location.href), e = encodeWi({ end, vals }); if (e) u.searchParams.set('wi', e); else u.searchParams.delete('wi'); root.history.replaceState(null, '', u); } catch (_) { /* address unchanged */ }
    const edits = DIALS.filter(d => vals[d.key]).map(d => ({ side: 'A', end, key: d.key, delta: vals[d.key] }));
    if (!edits.length) { out.innerHTML = '<p class="fm-p fm-mute">' + esc('Move a dial to see the change') + '</p>'; return; }
    if (wiAbort) wiAbort.abort();
    const ab = wiAbort = new root.AbortController();
    out.innerHTML = '<p class="fm-p fm-mute">' + esc('Simulating…') + '</p>';
    try {
      const X7 = vm.next, Mn = X7 ? matchFor(X7.opp, X7.home) : null, Ma = matchFor('_avg', 0);
      const rn = Mn ? await wk().run('counterfactual', { M: Mn, edits, n: 4000, seed: 1, split: false }, { signal: ab.signal }) : null;
      const ra = Ma ? await wk().run('counterfactual', { M: Ma, edits, n: 4000, seed: 1 }, { signal: ab.signal }) : null;
      if (ab.signal.aborted) return;
      out.innerHTML = whatIfHTML(vm, rn, ra);
    } catch (e) { if (!ab.signal.aborted) out.innerHTML = '<p class="fm-p">' + esc('The simulator could not run just now') + '</p>'; }
  }
  function rosterMove() {
    const out = host.querySelector('[data-out="roster"]'); if (!out) return;
    const rm = (host.querySelector('[data-act="rremove"]') || {}).value || '', ad = (host.querySelector('[data-act="radd"]') || {}).value || '';
    if (!rm && !ad) { out.textContent = ''; return; }
    const r = rosterWhatIf(vm.fo, vm.club, rm ? { remove: rm } : { g: ad, take: 0.2 });
    if (!r) { out.textContent = 'Not enough to work it out'; return; }
    const w = winsFrom(r.dMargin, vm.mus, vm.sigma, vm.fo.lg && vm.fo.lg.G);
    out.innerHTML = '<p class="fm-p">' + esc(GROUP[r.g] + ': ' + sg(r.dBpm, 2) + ' BPM, about ' + sg(r.dMargin, 2) + ' points a game (' + sg(r.lo, 2) + ' to ' + sg(r.hi, 2) + '), ' +
      winsTxt(w) + ' projected wins (approximate)') + '</p>';
  }
  /* ---- (6) the simulator check of a loss ---- */
  async function lossShapley(i) {
    const g = vm.losses && vm.losses.list[i], out = host.querySelector('[data-shap="' + i + '"]'), Sm = S();
    if (!g || !out || !Sm || !wk()) return;
    const re = vm.club.realised && vm.club.realised[g.g], op = teamOf(vm.fo, g.opp);
    if (!re || !op || !vm.t) { out.textContent = 'Not enough to work it out'; return; }
    out.textContent = 'Simulating…';
    try {
      const Mexp = Sm.matchup(vm.t.prof, op.prof, vm.fo.lg, { home: g.h || 0 }), Mplayed = Sm.matchFrom(re.own, re.opp, vm.fo.lg, { home: g.h || 0 });
      const r = await wk().run('shapley', { Mexp, Mplayed, groups: null, n: 1000, seed: 1 });
      const K = VK(), rows = Object.keys(r.phi).map(k => ({ id: k, label: SIM_GROUP[k] || k, v: r.phi[k], dir: 1 }));
      out.innerHTML = '<p class="fm-p">' + esc('Simulator check: expected ' + sg(r.base, 1) + ', at the game’s own rates ' + sg(r.full, 1)) + '</p><div class="fm-chart"></div>';
      if (K) binds.push(K.bind(out.querySelector('.fm-chart'), o => K.bars(rows, { W: o.W, id: 'fmshap' + i, x: { label: 'points of margin' } }), { label: 'Simulator check of a loss' }));
    } catch (_) { out.textContent = 'The simulator could not run just now'; }
  }

  /* ---- one handler for every control ---- */
  const onClick = e => {
    const b = e.target.closest && e.target.closest('[data-act],[data-slot]');
    if (!b || !host.contains(b)) return;
    if (b.hasAttribute('data-slot')) return;                     // team.js's position handler takes it
    const act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    if (b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    if (act === 'recalc') recalc();
    else if (act === 'cancel') { if (recalcAbort) recalcAbort.abort(); }
    else if (act === 'venue') { vm.next.home = +v; refreshNextP(); b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); simulateNext(); }
    else if (act === 'nend') { state.nend = v; b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }
    else if (act === 'needed') needed();
    else if (act === 'wend') { vm.whatIf.end = v; b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); queueWhatIf(); }
    else if (act === 'wreset') { host.querySelectorAll('[data-dial]').forEach(i => { i.value = 0; setDv(i); }); queueWhatIf(); }
    else if (act === 'shapley') lossShapley(+b.getAttribute('data-i'));
  };
  function refreshNextP() {
    const X = vm.next, fo = vm.fo, o2 = teamOf(fo, X.opp), edge = fo.lg && isNum(fo.lg.homeEdge) ? fo.lg.homeEdge : 0;
    const fx = vm.mus.find(f => f.opp === X.opp && f.h === X.home);
    const pElo = vm.t && o2 && isNum(vm.t.elo) && isNum(o2.elo) ? 1 / (1 + Math.pow(10, -(vm.t.elo - o2.elo) / 400)) : 0.5;
    X.mu = fx ? fx.mu : vm.sigma * PhiInv(pElo) + X.home * edge;
    X.p = Phi(X.mu / vm.sigma);
  }
  const setDv = i => { const d = DIALS.find(x => x.key === i.getAttribute('data-dial')), o = host.querySelector('[data-dv="' + d.key + '"]'); if (o) o.textContent = sg(+i.value, 1) + ' ' + d.unit; };
  const onInput = e => {
    const t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-dial')) { setDv(t); queueWhatIf(); }
  };
  const onChange = e => {
    const t = e.target, act = t.getAttribute && t.getAttribute('data-act');
    if (act === 'opp') { vm.next.opp = t.value; refreshNextP(); simulateNext(); }
    else if (act === 'rremove' || act === 'radd') {
      if (act === 'rremove' && t.value) { const o = host.querySelector('[data-act="radd"]'); if (o) o.value = ''; }
      if (act === 'radd' && t.value) { const o = host.querySelector('[data-act="rremove"]'); if (o) o.value = ''; }
      rosterMove();
    }
  };
  const onToggle = e => {
    const d = e.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open) return;
    const K = VK();
    d.querySelectorAll(':scope > .fm-bb [data-chart], :scope > [data-chart]').forEach(el => {
      if (el.querySelector('svg') || !K) return;
      const spec = vm.charts[el.getAttribute('data-chart')];
      if (!spec || !K[spec.kind]) return;
      const inner = el.closest('details');
      if (inner !== d && !inner.open) return;
      binds.push(K.bind(el, o => K[spec.kind](spec.data, Object.assign({}, spec.o, { W: o.W, id: 'fm' + el.getAttribute('data-chart') })), { label: spec.label }));
    });
    if (d.getAttribute('data-b') === 'next' && !lastNext) simulateNext();
    else if (d.getAttribute('data-b') === 'next' && lastNext && !host.querySelector('[data-live="meter"] svg')) drawNext(lastNext);
    if (d.getAttribute('data-b') === 'whatIf' && Object.keys(readDials()).length) queueWhatIf();
  };
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('toggle', onToggle, true);
  if (input.wi) { vm.whatIf && Object.assign(vm.whatIf, { end: input.wi.end, vals: input.wi.vals }); }
  draw();
  if (input.wi && vm.ok) { const d = host.querySelector('details[data-b="whatIf"]'); if (d) d.open = true; }
  return {
    redraw: draw,
    get vm() { return vm; },
    destroy() {
      destroyed = true;
      root.clearTimeout(holdT);
      [simAbort, wiAbort, recalcAbort].forEach(a => { if (a) a.abort(); });
      binds.forEach(b => b.destroy());
      host.removeEventListener('click', onClick); host.removeEventListener('input', onInput); host.removeEventListener('change', onChange); host.removeEventListener('toggle', onToggle, true);
    }
  };
}
/* the margin model's answer (an experimental simulator): the margin still needed, turned into the rate by the factor's
   value b; null where b is not distinguishable from 0 or the move is beyond the simulator's range for that rate */
function neededByMargin(fo, d, end, cur, need, range) {
  const fv = fo && fo.value && fo.value[d.f];
  if (!fv || !isNum(fv.b) || !fv.b || !isNum(cur) || !isNum(need)) return null;
  if (isNum(fv.lo) && isNum(fv.hi) && fv.lo < 0 && fv.hi > 0) return null;
  const delta = (end === 'off' ? 1 : -1) * need / fv.b;
  if (range && (delta < range[0] || delta > range[1])) return null;
  return cur + delta;
}
/* "Hold them under 49.1 eFG% (your defence allows 52.3)" / "Reach 55.2 eFG% (now 53.1)", for 50% and 60% */
function neededText(l, end) {
  const d = l.d, show = v => (isNum(v) ? f1(v) : 'out of reach');
  if (!isNum(l.v50) && !isNum(l.v60)) return d.label + ': out of reach within the league’s range';
  if (end === 'def') return 'Hold them to ' + d.label + ' ' + show(l.v50) + ' for 50%, ' + show(l.v60) + ' for 60% (your defence allows ' + show(l.cur) + ')';
  return d.label + ' ' + show(l.v50) + ' for 50%, ' + show(l.v60) + ' for 60% (now ' + show(l.cur) + ')';
}
/* the what-if's answer: Δ win% against the next opponent and an average one; Δ projected wins over the fixtures. An
   experimental simulator's Δ margin goes through the margin model; a calibrated one's Δ win is used as it is. */
function whatIfHTML(vm, rn, ra) {
  const cal = vm.lens.calibrated, sigma = vm.sigma, X = vm.next;
  const dP = (r, mu) => (!r ? null : cal ? r.dWin : Phi((mu + r.dMargin) / sigma) - Phi(mu / sigma));
  const pn = rn && X ? dP(rn, X.mu) : null, pa = ra ? dP(ra, 0) : null;
  const dm = ra ? ra.dMargin : rn ? rn.dMargin : null;
  const w = isNum(dm) ? winsFrom(dm, vm.mus, sigma, vm.fo.lg && vm.fo.lg.G) : null;
  const lines = [];
  if (isNum(pn)) lines.push('Against ' + ((teamOf(vm.fo, X.opp) || {}).short || 'the next opponent') + ': ' + sg(100 * pn, 1) + ' points of win chance');
  if (isNum(pa)) lines.push('Against an average side: ' + sg(100 * pa, 1) + ' points of win chance (margin ' + sg(ra.dMargin, 2) + ' ± ' + f2(1.96 * (ra.seMargin || 0)) + ')');
  if (isNum(w)) lines.push('Projected wins: ' + sg(w, 1) + (vm.mus.length ? ' over the games to play' : ' over a season'));
  return '<ul class="fm-list">' + lines.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>';
}

return { KEYMAP, CORE, LEVERS, DIALS, BLOCKS, STAGES, LABEL, MSG, view, ledger, needs, gmModel, mount, statusLine, makeWorker, encodeWi, decodeWi,
  fixtureMus, projection, rosterWhatIf, neededByMargin, contribution, targetOf, panel, neededText, whatIfHTML,
  html: { verdict: H.verdict, ledger: H.ledger, needs: H.needs, slots: H.slots, squad: H.squad, losses: H.losses, next: H.next, whatIf: H.whatIf } };
}));
