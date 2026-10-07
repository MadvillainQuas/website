'use strict';
/* ============================================================================
   /epinoia/winning/ — WHAT WINS (docs/what-wins-model.md §11, addendum A.2).

   ONE FILE DRAWS THE PAGE. The analysis is built on the server from every finished game's feature line and arrives
   as one versioned file through EpinoiaWinFile (winfile.js): the league-season's `wins` file, the pooled one for
   every league, and the Front office `fo` file only when the simulator is opened. This script reads nothing else
   but the public leagues and seasons rows (for the pickers and the league's colours): never a game's events, box
   scores, lineups or feature lines. Nothing is kept in localStorage; the loader caches per user in sessionStorage,
   and the old page's localStorage copy (epinoia_winning_v1) is removed here too.

   BEFORE THE FIRST BUILD (I1, transition): when no members' file comes AND the public teaser cannot be had (none,
   network, layout), the public part falls back to the page's previous reading, the public box scores in the browser
   (boxpreview.js, loaded only then): the short answer, the measures and the leagues are drawn from it exactly as from
   the teaser, for the picked league. Once the teaser exists that file is never loaded and nothing more is read. The
   members' sections then say the full model switches on once it has been built.

   NOT ENTITLED (signed out where sign-in is required, or not a member where memberships are on): the public
   box-score preview (the teaser) draws the short answer and the measures; every members' section keeps its title and
   shows the membership placeholder (or a sign-in link). #method is always public.

   THE STATUS LINE AND RECALCULATE (A.2): "Model of N games · built 2 h ago · 12 new games since". RECALCULATE is on
   only when games are pending; it asks the function to fold them in (refresh), with a staged CEEFAX-style bar:
   checking, updating the model, downloading, re-simulating (the Worker's own progress), drawing. Cancel stops the
   client's steps; an update the server had started still finishes and is reused next time.

   STRUCTURE: views[id](ctx) are pure (HTML strings and chart specs, every value escaped) so node tests can draw each
   section from the fixtures; mount() puts them on the page and binds the charts (vizkit.js). In node this file
   exports {views, cards, statusLine, ...} and never touches a document.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinPage = api;
  if (root.document && root.document.getElementById && root.document.getElementById('ww')) api.boot();
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const LEGACY = 'epinoia_winning_v1';
const SECTIONS = ['answer', 'value', 'factors', 'curves', 'tempo', 'positions', 'squad', 'mixes', 'sim', 'losses', 'leagues', 'model', 'method'];
const MEMBER = ['value', 'factors', 'curves', 'tempo', 'positions', 'squad', 'mixes', 'sim', 'losses', 'leagues', 'model'];
/* the four factors (A.3: free throws by ATTEMPT rate, FTA / FGA). A file built before A.3 carries c_ftmr: coreOf reads the
   file's own four, so an older file still draws whole */
const CORE = ['c_efg', 'c_tovp', 'c_orebp', 'c_ftr'];
const coreOf = W => { const c = W && W.models && W.models.core4c && W.models.core4c.coef; return c && c.length === 4 ? c.map(x => x.k) : CORE; };
/* a defeat's parts: the free-throw part is ftr (ftmr before A.3) */
const partOf = (parts, k) => (parts ? (parts[k] != null ? parts[k] : k === 'ftr' ? parts.ftmr : undefined) : undefined);
const LENS = { explain: 'Explains', forecast: 'Forecasts', model: 'Model', preview: 'Box-score preview' };
const P1_LABEL = { ts: 'True shooting', usg_share: 'Usage share', ast_share: 'Assist share', reb_share: 'Rebound share', stocks40: 'Steals + blocks per 40',
  tov_share: 'Turnover share', p3a_rate: '3PA rate', bpm: 'Minutes-weighted BPM', min_share: 'Share of minutes' };
/* the forecast model's terms (§7.8): an expected difference e_<factor>, and the rating and schedule terms */
const FC_LABEL = { h: 'Home court', elo: 'Elo difference', rest: 'Rest days', b2b: 'Back-to-back', km: 'Travel distance' };
/* the lineup model's terms (§7.13), under either spelling */
const TERM_LABEL = { shooters: 'Shooters', bigs0: 'No big', 'bigs 0': 'No big', bigs2: 'Two or more bigs', 'bigs 2+': 'Two or more bigs', hand0: 'No handler',
  'handlers 0': 'No handler', hand2: 'Two or more handlers', 'handlers 2+': 'Two or more handlers', prot: 'A rim protector', protector: 'A rim protector',
  hz: 'Height', 'height z': 'Height', bpm: 'Talent (BPM)', BPM: 'Talent (BPM)', shooters_x_prot: 'Shooters × protector', 'shooters × protector': 'Shooters × protector',
  hand_x_shooters: 'Handlers × shooters', 'handlers × shooters': 'Handlers × shooters' };
const SQUAD_LABEL = { rot_n: 'Rotation size', top5_share: 'Top five’s minutes', star_pts_share: 'Star’s share of points', usg_hhi: 'Usage concentration',
  pos_entropy: 'Positional balance', shooters: 'Shooters in the rotation', handlers: 'Ball handlers in the rotation', protectors: 'Rim protectors', bench_share: 'Bench minutes',
  passers: 'Passers in the rotation', slashers: 'Rim pressure in the rotation', crashers: 'Offensive rebounders in the rotation', glass: 'Defensive rebounders in the rotation',
  disruptors: 'Turnover generators in the rotation',
  depth_bpm: 'Depth (players 6-9)', talent: 'Talent (BPM)', continuity: 'Continuity', starter_stability: 'Starting five kept', availability: 'Availability',
  height_w: 'Height', age_w: 'Age' };
const GROUP = { G: 'Guards', F: 'Wings', C: 'Bigs' };
/* A.3: the players' season rates (By position, Lineup mixes): a label and a plain definition each */
const PSTAT = {
  ast_pct: ['AST%', 'Assist percentage: the share of his teammates’ baskets he assisted while on the floor. AST ÷ (his share of the floor × team FGM − his FGM)'],
  usg: ['USG%', 'Usage: the share of the team’s plays he ended with a shot, a trip to the line or a turnover while on the floor. (FGA + 0.44 × FTA + TOV) ÷ the team’s, on the floor'],
  ups: ['Unassisted points share', 'The share of the team’s unassisted field-goal points he scored while on the floor, as usage is worked out: 20% is an even fifth'],
  au: ['A/U (assist-to-usage)', 'Assist percentage divided by usage: how much he makes for others for each play he ends himself. Above 1 is pass-first'],
  ts: ['TS%', 'True shooting: points ÷ (2 × (FGA + 0.44 × FTA)), twos, threes and free throws together'],
  efg: ['eFG%', 'Effective field-goal %: (FGM + 0.5 × 3PM) ÷ FGA'],
  p3r: ['3PA rate', 'The share of his field-goal attempts that are threes: 3PA ÷ FGA'],
  p3p: ['3P%', 'Three-point %: 3PM ÷ 3PA'],
  rimr: ['Rim rate', 'The share of his field-goal attempts at the rim (within 125 cm), where the feed has shot locations'],
  midr: ['Mid-range rate', 'The share of his field-goal attempts that are twos away from the rim'],
  ftr: ['FT attempt rate (FTA/FGA)', 'Free-throw attempts per 100 field-goal attempts: how often he gets to the line'],
  una: ['Unassisted share', 'The share of his made field goals that no one assisted: self-created baskets (putbacks count)'],
  orb_pct: ['ORB%', 'Offensive rebound percentage: the share of his team’s misses he rebounded while on the floor'],
  drb_pct: ['DRB%', 'Defensive rebound percentage: the share of the opponents’ misses he rebounded while on the floor'],
  stl_pct: ['STL%', 'Steal percentage: steals per 100 opponent possessions while on the floor'],
  blk_pct: ['BLK%', 'Block percentage: blocks per 100 of the opponents’ two-point attempts while on the floor'],
  tov_pct: ['TOV%', 'Turnover percentage: turnovers per 100 of his plays, TOV ÷ (FGA + 0.44 × FTA + TOV)'],
  /* 2026-10-07: self-creation, shot volume and balance, and the passes that make threes */
  un_pg: ['Unassisted FGM a game', 'Made field goals no one assisted, a game: the baskets he makes for himself'],
  unp_pg: ['Self-created points a game', 'Points from unassisted field goals, a game: the scoring he creates for himself'],
  upp: ['Self-created share of points', 'The share of his own field-goal points that were unassisted: how much of his scoring he makes himself'],
  rim40: ['Rim attempts per 40', 'Shots at the rim per 40 minutes on the floor: rim pressure as volume (a guard who gets to the basket), where the feed has shot locations'],
  p3a40: ['3PA per 40', 'Three-point attempts per 40 minutes on the floor: three-point volume'],
  fga40: ['FGA per 40', 'Field-goal attempts per 40 minutes on the floor: shot volume'],
  ast40: ['Assists per 40', 'Assists per 40 minutes on the floor'],
  ftp: ['FT%', 'Free-throw %: FTM ÷ FTA'],
  rimp: ['Rim FG%', 'Field-goal % on shots at the rim (within 125 cm), where the feed has shot locations'],
  midp: ['Mid-range FG%', 'Field-goal % on twos away from the rim, where the feed has shot locations'],
  bpm: ['BPM', 'Box Plus/Minus: points per 100 possessions a player adds over a league-average player, from the box score; the group’s is its players’ BPM weighted by their minutes there'],
  vorp: ['VORP', 'Value over replacement player: (BPM + 2) × his share of the club’s minutes, over the league’s season; the group’s is the sum of its players’ VORP for the minutes they played there'],
  a3s: ['Assists to threes', 'Of his assists, the share that set up a three rather than a two: a passer who finds shooters against one who feeds the paint (games from 7 October 2026)']
};
const pstatLabel = k => (PSTAT[k] ? PSTAT[k][0] : k);
const SLOT = { 1: 'Slot 1 (point guard)', 2: 'Slot 2 (shooting guard)', 3: 'Slot 3 (small forward)', 4: 'Slot 4 (power forward)', 5: 'Slot 5 (centre)' };
const groupLabel = g => GROUP[g] || SLOT[g] || g;
/* A.3: the roles, what each is called and how a player earns it (the league-season's cut values come from the file) */
const ROLE = { shooter: 'Shooters', handler: 'Ball handlers', passer: 'Passers', slasher: 'Rim pressure', crasher: 'Offensive rebounders', glass: 'Defensive rebounders',
  protector: 'Rim protectors', disruptor: 'Turnover generators', big: 'Bigs', creator: 'Creators' };
const ROLE_ONE = { shooter: 'shooter', handler: 'ball handler', passer: 'passer', slasher: 'rim attacker', crasher: 'offensive rebounder', glass: 'defensive rebounder',
  protector: 'rim protector', disruptor: 'turnover generator', big: 'big', creator: 'creator' };
const ROLE_RULE = {
  shooter: 'At least 40 three-point attempts, a 3PA rate in the top 40% and a 3P% at or above the median once shrunk toward the league',
  handler: 'A ball-handling score of 0.70 or more: 35% his AST% percentile, 25% his usage percentile, 40% the percentile of the share of his own points that were unassisted (he creates for others and for himself)',
  passer: 'A/U (AST% ÷ USG%) in the top quarter and an AST% at or above the median',
  slasher: 'His rim rate and FT attempt rate percentiles average 0.75 or more, on 40 field-goal attempts or more',
  crasher: 'An ORB% in the top quarter',
  glass: 'A DRB% in the top quarter',
  protector: 'A BLK% in the top quarter and taller than average, or a centre with no height listed',
  disruptor: 'A STL% in the top quarter',
  big: 'Most of his minutes in slot 5, the centre',
  creator: 'A usage in the top fifth, on 200 minutes or more'
};
/* the cut values as they fall in this league-season, short and in the stats' own abbreviations (numbers, never words) */
function roleHere(cuts, k) {
  const c = cuts && cuts[k], f = v => (isNum(v) ? (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)) : '–');
  if (!c) return '';
  switch (k) {
    case 'shooter': return '3PA rate ≥ ' + f(c.p3r) + ' · 3P% ≥ ' + f(c.p3p);
    case 'handler': return 'AST% P50 ' + f(c.ast50) + ' · USG% P50 ' + f(c.usg50) + (c.upp ? ' · self-created P50 ' + f(c.upp50) : c.ups ? ' · UPS P50 ' + f(c.ups50) : ' · no assist data');
    case 'passer': return 'A/U ≥ ' + f(c.au) + ' · AST% ≥ ' + f(c.ast);
    case 'slasher': return (c.zones ? 'rim rate P75 ' + f(c.rimr) + ' · ' : '') + 'FTA/FGA ' + (c.zones ? 'P75 ' : '≥ ') + f(c.ftr);
    case 'crasher': return 'ORB% ≥ ' + f(c.orb);
    case 'glass': return 'DRB% ≥ ' + f(c.drb);
    case 'protector': return 'BLK% ≥ ' + f(c.blk);
    case 'disruptor': return 'STL% ≥ ' + f(c.stl);
    case 'creator': return 'USG% ≥ ' + f(c.usg);
    default: return '';
  }
}
const P1_STATS = ['ts', 'usg_share', 'ast_share', 'reb_share', 'stocks40', 'tov_share', 'p3a_rate'];
const PART_LABEL = { expected: 'expected', quality: 'shot quality', making: 'shot-making', efg: 'shooting', c_efg: 'shooting', tovp: 'turnovers', c_tovp: 'turnovers',
  orebp: 'boards', c_orebp: 'boards', ftr: 'free throws', c_ftr: 'free throws', ftmr: 'free throws', c_ftmr: 'free throws', other: 'other', garbage: 'garbage time' };
/* the six simulator dials (§12 what-if ranges), on a side's offence */
const DIALS = [
  { key: 'efg', label: 'eFG%', min: -5, max: 5, step: 0.5, unit: 'pp' },
  { key: 'tovp', label: 'TOV%', min: -4, max: 4, step: 0.5, unit: 'pp' },
  { key: 'orebp', label: 'OREB%', min: -8, max: 8, step: 1, unit: 'pp' },
  { key: 'ftr', label: 'FT attempt rate (FTA/FGA)', min: -10, max: 10, step: 1, unit: 'pp' },
  { key: 'p3r', label: '3PA rate', min: -10, max: 10, step: 1, unit: 'pp' },
  { key: 'secs', label: 'Seconds per possession', min: -3, max: 3, step: 0.5, unit: 's' }
];

/* ------------------------------------------------------------------ helpers --- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const MINUS = s => s.replace(/^-/, '−');                                          // a true minus sign in words
const f1 = v => (isNum(v) ? MINUS((Math.round(v * 10) / 10).toFixed(1)).replace(/^−0\.0$/, '0.0') : '–');
/* two decimals under 10, one above: a share (0.43) and a percentage (55.4) side by side in one table */
const f2s = v => (isNum(v) ? (Math.abs(v) < 10 ? f2(v) : f1(v)) : '–');
const f2 = v => (isNum(v) ? MINUS(v.toFixed(2)).replace(/^−0\.00$/, '0.00') : '–');
const sg = (v, d) => (isNum(v) ? (v > 0 ? '+' : '') + MINUS(v.toFixed(d == null ? 1 : d)) : '–');
const pc = v => (isNum(v) ? Math.round(v * 100) + '' : '–');                      // a share as a whole per cent, no sign
const rng = (lo, hi, fmt) => (isNum(lo) && isNum(hi) ? fmt(lo) + '–' + fmt(hi) : '');
const label = (W, k) => (W && W.meta && W.meta[k] && W.meta[k].label) || P1_LABEL[k] || SQUAD_LABEL[k] || k;
const fcLabel = (W, k) => FC_LABEL[k] || (/^e_/.test(k) ? label(W, k.slice(2)) + ' (expected)' : label(W, k));
/* Shapley shares come as per cents (the builder) or as fractions; this is the factor to a fraction of the margin */
const shareScale = sh => ((sh || []).reduce((t, x) => t + (isNum(x.phi) ? x.phi : 0), 0) > 1.5 ? 0.01 : 1);
const defOf = (W, k) => (W && W.meta && W.meta[k] && W.meta[k].def) || '';
const dirOf = (W, k) => (W && W.meta && W.meta[k] ? W.meta[k].dir : 1);
const chip = (lens, n, extra) => '<span class="ww-chip" data-lens="' + lens + '">' + esc(LENS[lens] || lens) + '</span>' +
  (isNum(n) ? ' <span class="ww-n" translate="no">n = ' + n + '</span>' : '') + (extra ? ' <span class="ww-chipx">' + esc(extra) + '</span>' : '');
const empty = msg => '<div class="pg-empty"><p>' + esc(msg) + '</p></div>';
const seg = (act, items, on, aria) => '<div class="pg-seg" role="group" aria-label="' + esc(aria) + '">' +
  items.map(([v, t]) => '<button type="button" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + (v === on) + '">' + esc(t) + '</button>').join('') + '</div>';
const sel = (act, items, on, aria, names) => '<select class="ep-input" data-act="' + act + '" aria-label="' + esc(aria) + '">' +
  items.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === on ? ' selected' : '') + (names && v ? ' translate="no"' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
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
const chartSlot = (spec, list) => { list.push(spec); return '<div class="ww-chart" data-chart="' + (list.length - 1) + '"></div>'; };
const locked = rows => ({ state: 'locked', html: '<div class="ww-lock" data-memlock="' + (rows || 5) + '"></div>', charts: [] });

/* the Platt map the simulator's P(win) goes through: only a calibrated simulator's (§8.3), as the Front office does;
   an uncalibrated one is experimental and shown raw */
const simPlatt = fo => (fo && fo.sim && fo.sim.calibrated && fo.sim.platt) || null;

/* ------------------------------------------------------------------ the status line (A.2) --- */
/* {line, canRecalc, upToDate} from a file answer: "Model of N games · built 2 h ago · 12 new games since" */
function statusLine(ans, W, o) {
  o = o || {};
  if (!W) return { line: '', canRecalc: false, upToDate: false };
  const n = W.n && W.n.games, parts = [];
  if (isNum(n)) parts.push('Model of ' + n + ' games');
  const b = ago((ans && ans.built) || W.built, o.now);
  if (b) parts.push(b);
  const pend = ans && isNum(ans.pending) ? ans.pending : null;
  if (pend > 0) parts.push(pend + (pend === 1 ? ' new game since' : ' new games since'));
  else if (pend === 0) parts.push('up to date');
  return { line: parts.join(' · '), canRecalc: !!(W.league && pend > 0), upToDate: pend === 0 };
}

/* ------------------------------------------------------------------ the pace finding --- */
/* γ (§7.9) is fitted on [-1, 2] (the golden search's range). Three findings and a fourth that is none:
   lo > 0  more possessions help the favourite;  hi < 0  longer games help the underdog;
   an interval narrow (< 1 wide) around 0, away from the range's ends: pace does not change who wins;
   anything else (wide, or at an end of the range, which is where an unidentified γ lands): the games cannot yet tell. */
const GAMMA_LO = -1, GAMMA_HI = 2;
function paceText(g) {
  const G = g && g.gamma;
  if (!G || !isNum(G.lo) || !isNum(G.hi)) return null;
  const atEnd = v => isNum(v) && (v <= GAMMA_LO + 0.02 || v >= GAMMA_HI - 0.02);
  const iv = ' (' + f2(G.lo) + '–' + f2(G.hi) + ')';
  if (G.lo > 0) return 'More possessions help the favourite: γ = ' + f2(G.v) + iv;
  if (G.hi < 0) return 'Longer games help the underdog here: γ = ' + f2(G.v) + iv;
  if (G.hi - G.lo < 1 && !atEnd(G.v) && !atEnd(G.lo) && !atEnd(G.hi) && !g.bound) return 'The pace of a game does not change who wins here, once quality is counted: γ = ' + f2(G.v) + iv;
  return 'These games cannot yet tell whether pace changes who wins: γ could be anywhere from ' + f2(G.lo) + ' to ' + f2(G.hi);
}

/* ------------------------------------------------------------------ the cards (§11) --- */
/* ≤ 6, fixed templates, interval-backed only; each with its lens chip */
function cards(W) {
  const out = [];
  if (!W || !W.models || !W.models.core4c) return out;
  const C = W.models.core4c, n = W.n && W.n.games;
  const sh = (C.shares || []).find(s => s.k === 'c_efg'), ss = shareScale(C.shares);
  if (sh && isNum(sh.phi) && isNum(sh.lo) && isNum(sh.hi)) out.push({ lens: 'explain', n, text: 'Shooting decides ' + pc(ss * sh.phi) + '% of the margin here (' + pc(ss * sh.lo) + '–' + pc(ss * sh.hi) + ')' });
  /* the best hard number on a measure that is not itself part of the score (a points lead "wins" every game), has a
     better side (dir 0, a count like players used, says nothing about winning) and is told from noise (its interval
     leaves out 50%); none qualifying, no card (UI2-1) */
  const hard = Object.keys(W.curves || {}).filter(k => { const m = W.meta && W.meta[k]; return !(m && m.score) && !(m && m.dir === 0); })
    .map(k => ({ k, h: W.curves[k].hard })).filter(x => x.h && x.h.n >= 50 && isNum(x.h.lo) && isNum(x.h.hi) && (x.h.lo > 0.5 || x.h.hi < 0.5))
    .sort((a, b) => Math.abs(b.h.p - 0.5) - Math.abs(a.h.p - 0.5))[0];
  if (hard) out.push({ lens: 'explain', n: hard.h.n, k: hard.k, text: 'Sides ahead by ' + hard.h.t + ' or more on ' + label(W, hard.k) + ' won ' + pc(hard.h.p) + '% (' + pc(hard.h.lo) + '–' + pc(hard.h.hi) + ') of ' + hard.h.n + ' games' });
  const g = W.tempo && W.tempo.sqrtN, pt = paceText(g);
  if (pt) out.push({ lens: 'forecast', n: g.n, text: pt });
  /* home court: the whole edge (the home side's mean margin, block-bootstrapped), never α alone, which is what is left
     of it once the four factors are counted (most of the edge flows through them); α is named as that when it is all
     the file has */
  const HM = W.homeMargin;
  if (HM && isNum(HM.v) && isNum(HM.lo) && isNum(HM.hi) && W.homeWin && isNum(W.homeWin.p)) out.push({ lens: 'explain', n: HM.n, text: 'Home court is worth ' + f1(HM.v) + ' points (' + f1(HM.lo) + '–' + f1(HM.hi) + ') and ' + pc(W.homeWin.p) + '% of games' });
  else if (C.home && isNum(C.home.v) && isNum(C.home.lo)) out.push({ lens: 'explain', n, text: 'Home court beyond the four factors is worth ' + f1(C.home.v) + ' points (' + f1(C.home.lo) + '–' + f1(C.home.hi) + ')' });
  const best = (C.coef || []).filter(c => c.wins30 && isNum(c.wins30.v) && isNum(c.wins30.lo)).sort((a, b) => Math.abs(b.wins30.v) - Math.abs(a.wins30.v))[0];
  if (best) out.push({ lens: 'explain', n, k: best.k, text: 'One team-SD better at ' + label(W, best.k) + ' is worth ' + f1(Math.abs(best.wins30.v)) + ' wins per 30 games (' +
    f1(Math.min(Math.abs(best.wins30.lo), Math.abs(best.wins30.hi))) + '–' + f1(Math.max(Math.abs(best.wins30.lo), Math.abs(best.wins30.hi))) + ')' });
  /* time of possession: the DIRECT effect is the headline (§7.10.4). Its path through the factors is partly true by
     definition (a possession's clock runs through its own second chances), so it is never the card */
  const top = (W.path || []).find(p => p.k === 'top_avg');
  if (top && top.direct && isNum(top.direct.v) && isNum(top.direct.lo) && isNum(top.direct.hi)) {
    const d = top.direct, iv = ' (' + sg(d.lo, 2) + ' to ' + sg(d.hi, 2) + ')';
    out.push({ lens: 'explain', n, text: d.lo > 0 || d.hi < 0
      ? 'One second more a possession is worth ' + sg(d.v, 2) + ' points of margin directly' + iv + ', beyond the four factors'
      : 'Time of possession has no clear direct effect here once the four factors are counted' + iv });
  }
  return out.slice(0, 6);
}
const cardHTML = c => '<article class="ww-card"' + (c.k ? ' data-k="' + esc(c.k) + '"' : '') + '><p class="ww-ctext">' + esc(c.text) + '</p><p class="ww-cmeta">' + chip(c.lens, c.n) + '</p></article>';

/* ------------------------------------------------------------------ a measure, explained (A.3) --- */
/* how to read a measure: which end is better, and what its gap is, in plain words from its direction and unit */
const UNIT_WORDS = { '%': 'in percentage points', share: 'as a share from 0 to 1', pts: 'in points', s: 'in seconds', 'per 100': 'per 100 possessions', n: 'as a count', poss: 'in possessions', index: 'as an index', pp: 'in percentage points', min: 'in minutes' };
function readOf(W, k) {
  const m = (W && W.meta && W.meta[k]) || {};
  const dirW = m.score ? 'Part of the score: it counts points, so it goes with winning by construction' : m.dir === 1 ? 'Higher is better' : m.dir === -1 ? 'Lower is better' : 'A style: neither end is better in itself';
  return dirW + '. The gap is this side’s value less the other side’s in the same game, ' + (UNIT_WORDS[m.unit] || 'in its own unit');
}
const defBox = (W, k) => '<div class="ww-def"><p class="ww-defh"><b>' + esc(label(W, k)) + '</b></p><p>' + esc(defOf(W, k) || 'No definition is recorded for this measure') + '</p><p class="ww-mute">' + esc(readOf(W, k)) + '</p></div>';
/* the slider's range: the fitted curve's own x range (never beyond the games), in about 200 steps of a nice size */
function gapRange(c) {
  const xs = (c && c.raw ? c.raw : []).map(p => p[0]).filter(isNum);
  if (xs.length < 2) return null;
  const lo0 = Math.min(...xs), hi0 = Math.max(...xs), span = hi0 - lo0;
  if (!(span > 0)) return null;
  const raw = span / 200, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(m => m * mag).find(v => v >= raw) || raw;
  const dp = Math.max(0, -Math.floor(Math.log10(step)));
  const rd = v => +(Math.round(v / step) * step).toFixed(dp);
  const lo = rd(Math.ceil(lo0 / step) * step), hi = rd(Math.floor(hi0 / step) * step);
  const start = rd(c.x75 && isNum(c.x75.v) && c.x75.v >= lo && c.x75.v <= hi ? c.x75.v : Math.min(hi, Math.max(lo, 0)));
  return { lo, hi, step, dp, start };
}
/* the curve at a gap: the fitted chance, its band and (where the file has it) the curve holding the other factors level,
   by straight lines between the curve's points; the share of games with a gap at least this big either way */
function gapAt(c, x) {
  const lin = (pts, j) => {
    const P = (pts || []).filter(p => isNum(p[0]) && isNum(p[j]));
    if (!P.length || !isNum(x)) return null;
    if (x <= P[0][0]) return P[0][j];
    for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const a = P[i - 1], b = P[i], t = (x - a[0]) / ((b[0] - a[0]) || 1); return a[j] + t * (b[j] - a[j]); }
    return P[P.length - 1][j];
  };
  const p = lin(c.raw, 1);
  if (!isNum(p)) return null;
  let big = 0, all = 0;
  (c.hist || []).forEach(h => { const n = h.length >= 3 ? h[2] : h[1], lo = h[0], hi = h.length >= 3 ? h[1] : h[0]; if (!isNum(n)) return; all += n; const mid = (lo + hi) / 2; if (Math.abs(mid) >= Math.abs(x)) big += n; });
  return { x, p, lo: lin(c.raw, 2), hi: lin(c.raw, 3), adj: c.adj ? lin(c.adj, 1) : null, share: all > 0 ? big / all : null };
}
/* the readout, a sentence a span (each translates whole): the chance, the level-headed one, how often such a gap happens */
function gapText(W, k, c, a) {
  if (!a) return [];
  const xs = (a.x > 0 ? '+' : '') + MINUS(String(a.x)), out = [];
  out.push('At a gap of ' + xs + ' in ' + label(W, k) + ', the fitted chance of winning is ' + pc(a.p) + '%' + (isNum(a.lo) && isNum(a.hi) ? ' (95% range ' + pc(a.lo) + '–' + pc(a.hi) + '%)' : ''));
  if (isNum(a.adj)) out.push((coreOf(W).indexOf(k) >= 0 ? 'With the other three factors held level: ' : 'With the four factors held level: ') + pc(a.adj) + '%');
  if (isNum(a.share) && a.x !== 0) out.push('About ' + pc(a.share) + '% of games had a gap this big or bigger, either way');
  return out;
}
const gapHTML = lines => lines.map(t => '<span>' + esc(t) + '</span>').join(' ');

/* ------------------------------------------------------------------ by position, in depth (A.3) --- */
/* each group's minutes-weighted statistic against winning: the heatmap of r (groups × statistics), the chosen group's
   forest (net per 100 for one club-season SD more, with its interval) and the table (typical value, spread, r with net
   rating and with the share of games won). Small samples said, never hidden */
function posStatsHTML(W, st, charts) {
  const S = W.positions && W.positions.stats;
  if (!S || !S.cells || !S.cells.length) return '';
  const set = st.posSet === 'slot' ? 'slot' : 'grp', out = st.posOut === 'win' ? 'win' : 'net';
  const groups = (set === 'slot' ? ['1', '2', '3', '4', '5'] : ['G', 'F', 'C']).filter(g => S.cells.some(c => c.g === g));
  if (!groups.length) return '';
  const stats = (S.stats || []).filter(k => S.cells.some(c => c.k === k && groups.indexOf(c.g) >= 0));
  const cell = (g, k) => S.cells.find(c => c.g === g && c.k === k);
  const rOf = c => (out === 'win' ? { v: c.rw, lo: c.rwlo, hi: c.rwhi } : { v: c.r, lo: c.lo, hi: c.hi });
  let html = '<h3 class="ww-h3">Each group’s own numbers against the league, and against winning</h3><p class="ww-lead">' + chip('explain', S.n) + ' <span class="ww-legend">' +
    esc('club seasons; each group’s statistic is its players’ season rates weighted by their minutes in it, set against the club’s results within its league') + '</span>' +
    (S.n < 20 ? ' <span class="ww-chipx">few club seasons: the ranges are wide</span>' : '') + '</p>';
  html += '<div class="pg-row ww-ctl">' + seg('posSet', [['grp', 'Guards, wings and bigs'], ['slot', 'The five slots']], set, 'Positions') + seg('posOut', [['net', 'Net rating'], ['win', 'Share of games won']], out, 'Against') + '</div>';
  /* the statistics down the side, the groups across: sixteen columns would not read */
  html += chartSlot({ kind: 'heatmap', label: 'Each group’s statistics against winning', data: { rows: stats.map(pstatLabel), cols: groups.map(g => (set === 'slot' ? 'Slot ' + g : GROUP[g])), mode: 'div',
    cells: stats.map(k => groups.map(g => { const c = cell(g, k); if (!c) return null; const r = rOf(c); return isNum(r.v) ? { v: r.v, lo: r.lo, hi: r.hi, label: f2(r.v) + (c.star && out === 'net' ? '★' : ''),
      detail: 'typical ' + f2s(c.med) + ' (' + f2s(c.p25) + '–' + f2s(c.p75) + '), ' + c.n + ' club seasons' } : null; })) },
    o: { dp: 2, title: 'Group statistics against winning', desc: 'Correlation (r) of each group’s minutes-weighted statistic with ' + (out === 'win' ? 'the share of games won' : 'net rating') + ', within league; ★ where the range leaves out 0 after the false-discovery check' } }, charts);
  const g = groups.indexOf(st.posS) >= 0 ? st.posS : groups[0];
  html += '<div class="pg-row ww-ctl">' + seg('posS', groups.map(x => [x, set === 'slot' ? 'Slot ' + x : GROUP[x]]), g, 'Group') + '</div>';
  /* EACH POSITION'S DIFFERENTIATOR (2026-10-07): the stat whose one SD moves wins most at each group shown */
  const lev = S.levers || {};
  const levs = groups.filter(x => lev[x] && isNum(lev[x].w30));
  if (levs.length) html += '<div class="ww-levers">' + levs.map(x => { const L = lev[x]; return '<div class="ww-lever"><span>' + esc(set === 'slot' ? 'Slot ' + x : GROUP[x]) + '</span><b>' + esc(pstatLabel(L.lever)) + (L.star ? ' ★' : '') + '</b><em translate="no">' +
    (L.w30 > 0 ? '+' : '') + f1(L.w30) + ' wins / 30 games for one SD more</em></div>'; }).join('') + '</div><p class="ww-note">Each position’s differentiator: the statistic whose one-SD difference at that position goes with the most wins over 30 games here (★ where the range leaves out 0 after the false-discovery check).</p>';
  const rows = stats.map(k => cell(g, k)).filter(c => c && isNum(c.b)).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  /* +/- AGAINST THE LEAGUE: the winners' (top quarter by net) line at this position against the league's mean, and the
     wins over 30 games one SD more of each is worth here, the biggest first */
  const wrows = stats.map(k => cell(g, k)).filter(c => c && isNum(c.w30)).sort((a, b) => Math.abs(b.w30) - Math.abs(a.w30));
  if (wrows.length) html += chartSlot({ kind: 'forest', label: 'Wins over 30 games for one SD more, ' + groupLabel(g).toLowerCase(), data: wrows.map(c => ({ id: 'w:' + c.k, label: pstatLabel(c.k), v: c.w30, lo: c.w30lo, hi: c.w30hi,
    muted: !(isNum(c.lo) && isNum(c.hi) && (c.lo > 0 || c.hi < 0)), badge: c.star ? 'strong evidence' : '',
    detail: 'league ' + f2s(c.avg) + ', winners ' + f2s(c.top) + ' (' + (isNum(c.dTop) && c.dTop > 0 ? '+' : '') + f2s(c.dTop) + '); one SD is ' + f2s(c.sd) })),
    o: { x: { label: 'wins over 30 games for one club-season SD more' }, title: 'Each statistic’s worth in wins, by position', desc: 'Wins over 30 games that go with one standard deviation more of each statistic at this position, with 95% ranges, the biggest first' } }, charts);
  if (rows.length) html += chartSlot({ kind: 'forest', label: 'What one SD more in each statistic goes with, for ' + groupLabel(g).toLowerCase(), data: rows.map(c => ({ id: c.k, label: pstatLabel(c.k), v: c.b, lo: c.blo, hi: c.bhi,
    muted: !(isNum(c.lo) && isNum(c.hi) && (c.lo > 0 || c.hi < 0)), badge: c.star ? 'strong evidence' : '', detail: 'r = ' + f2(c.r) + ' (' + rng(c.lo, c.hi, f2) + '); one SD is ' + f2s(c.sd) })),
    o: { x: { label: 'net per 100 for one club-season SD more' }, title: 'Group statistics in points', desc: 'Net rating per 100 possessions that goes with one standard deviation more of each statistic, with 95% ranges, sorted by strength' } }, charts);
  const pm = v => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + f2s(Math.abs(v)) : '–');
  const tone = c => (!isNum(c.dTop) || !isNum(c.r) ? '' : (c.dTop > 0) === (c.r > 0) ? ' class="ww-up"' : ' class="ww-dn"');
  html += '<div class="ep-tw"><table class="ww-tbl ww-pos"><thead><tr><th scope="col">' + esc(groupLabel(g)) + '</th><th scope="col">League average</th><th scope="col">Winners</th><th scope="col">Winners +/-</th>' +
    '<th scope="col">Wins / 30 for one SD</th><th scope="col">Middle half</th><th scope="col">SD</th><th scope="col">r with net rating</th><th scope="col">r with games won</th><th scope="col">Club seasons</th></tr></thead><tbody>' +
    stats.map(k => { const c = cell(g, k); if (!c) return ''; return '<tr><th scope="row">' + esc(pstatLabel(k)) + '</th><td translate="no">' + f2s(isNum(c.avg) ? c.avg : c.med) + '</td><td translate="no">' + f2s(c.top) +
      '</td><td translate="no"' + tone(c) + '>' + pm(c.dTop) + '</td><td translate="no">' + (isNum(c.w30) ? (c.w30 > 0 ? '+' : '') + f1(c.w30) + (c.star ? ' ★' : '') : '–') + '</td><td translate="no">' + rng(c.p25, c.p75, f2s) +
      '</td><td translate="no">' + f2s(c.sd) + '</td><td translate="no">' + f2(c.r) + (c.star ? ' ★' : '') + ' <small>' + rng(c.lo, c.hi, f2) + '</small></td><td translate="no">' + f2(c.rw) + ' <small>' + rng(c.rwlo, c.rwhi, f2) +
      '</small></td><td translate="no">' + c.n + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    '<p class="ww-note">Every figure is this position’s own: its players’ season rates weighted by their minutes there, so a guard is set against guards. Winners are the top quarter of club seasons by net rating; +/- is their line against the league’s average, green where it leans the way that goes with winning. Wins / 30 is what one SD more of the statistic at this position goes with, over 30 games.</p>';
  html += '<details class="ww-details ww-gloss"><summary>What each statistic means</summary><dl class="ww-dl">' + stats.map(k => '<dt>' + esc(pstatLabel(k)) + '</dt><dd>' + esc(PSTAT[k] ? PSTAT[k][1] : '') + '</dd>').join('') + '</dl></details>';
  html += '<p class="ww-note">A correlation across club seasons is not a cause: better clubs differ in many ways at once. Where a statistic needs shot locations or assist data the feeds lack, its group is left out.</p>';
  return html;
}

/* ------------------------------------------------------------------ creation and how well it works (2026-10-07) --- */
/* the club's creators (its ball handlers and high-usage players): how much of the offence they carry and how efficiently,
   against the league's clubs and against winning (winmodel.js creation) */
const CREATION_LABEL = { share: 'Creators’ share of the plays', ts: 'Creators’ TS%', ppp: 'Creators’ points a play', hand_ts: 'Ball handlers’ TS%', hand_ppp: 'Ball handlers’ points a play' };
function creationHTML(W, charts) {
  const C = W.creation;
  if (!C || !C.stats || !Object.keys(C.stats).length) return '';
  const keys = (C.keys || Object.keys(C.stats)).filter(k => C.stats[k]);
  const fmt = (k, v) => (k === 'ppp' || k === 'hand_ppp' ? f2(v) : f1(v));
  let html = '<h3 class="ww-h3">Creation and how well it works</h3><p class="ww-lead">' + chip('explain', C.n) + ' <span class="ww-legend">' +
    esc('club seasons; the creators are the ball handlers and the high-usage players, ' + f1(C.creators) + ' in a squad on average') + '</span></p>';
  const fr = keys.map(k => Object.assign({ k }, C.stats[k])).filter(s => isNum(s.w30));
  if (fr.length) html += chartSlot({ kind: 'forest', label: 'Creation against winning', data: fr.map(s => ({ id: 'cr:' + s.k, label: CREATION_LABEL[s.k] || s.k, v: s.w30, lo: s.w30lo, hi: s.w30hi,
    muted: !(isNum(s.lo) && isNum(s.hi) && (s.lo > 0 || s.hi < 0)), detail: 'league ' + fmt(s.k, s.avg) + ', winners ' + fmt(s.k, s.top) + '; one SD is ' + fmt(s.k, s.sd) })),
    o: { x: { label: 'wins over 30 games for one club-season SD more' }, title: 'Creation against winning', desc: 'Wins over 30 games that go with one standard deviation more of the creators’ share of the plays and of their efficiency, with 95% ranges' } }, charts);
  html += '<div class="ep-tw"><table class="ww-tbl ww-pos"><thead><tr><th scope="col">Creation</th><th scope="col">League average</th><th scope="col">Winners</th><th scope="col">Winners +/-</th><th scope="col">Wins / 30 for one SD</th><th scope="col">r with net rating</th></tr></thead><tbody>' +
    keys.map(k => { const s = C.stats[k], d = isNum(s.top) && isNum(s.avg) ? s.top - s.avg : null;
      return '<tr><th scope="row">' + esc(CREATION_LABEL[k] || k) + '</th><td translate="no">' + fmt(k, s.avg) + '</td><td translate="no">' + fmt(k, s.top) + '</td><td translate="no"' +
        (isNum(d) && isNum(s.r) ? ((d > 0) === (s.r > 0) ? ' class="ww-up"' : ' class="ww-dn"') : '') + '>' + (isNum(d) ? (d > 0 ? '+' : '') + fmt(k, d) : '–') + '</td><td translate="no">' +
        (isNum(s.w30) ? (s.w30 > 0 ? '+' : '') + f1(s.w30) : '–') + '</td><td translate="no">' + f2(s.r) + ' <small>' + rng(s.lo, s.hi, f2) + '</small></td></tr>'; }).join('') + '</tbody></table></div>';
  html += '<p class="ww-note">Points a play: the creators’ points divided by the plays they end (FGA + 0.44 × FTA + TOV); TS% is their true shooting. A club that leans on its creators needs them efficient: high usage at a low points a play costs possessions.</p>';
  return html;
}

/* ------------------------------------------------------------------ roles and winning (A.3) --- */
function rolesHTML(W, charts) {
  const R = W.roles;
  if (!R || !R.list || !R.list.length) return '';
  const list = R.list.filter(l => isNum(l.b) || (l.lu && isNum(l.lu.b)));
  let html = '<h3 class="ww-h3">Roles in the rotation</h3><p class="ww-lead">' + chip('explain', R.n) + ' <span class="ww-legend">' + esc('club seasons') + '</span>' +
    (R.power === 'low' ? ' <span class="ww-chipx">low power: few club seasons</span>' : '') + '</p>';
  const lu = list.filter(l => l.lu && isNum(l.lu.b));
  if (lu.length) html += '<p class="ww-note">On the floor: each player of the role more in a five, the five’s talent held, within the same club and game</p>' + chartSlot({ kind: 'forest', label: 'Each role on the floor', data: lu.map(l => ({ id: 'lu:' + l.k, label: ROLE[l.k] || l.k, v: l.lu.b, lo: l.lu.lo, hi: l.lu.hi, muted: l.lu.evidence === 'none',
    badge: l.lu.evidence === 'strong' ? 'strong evidence' : l.lu.evidence === 'some' ? 'some evidence' : '', detail: Math.round(l.lu.poss[0]) + ' possessions with none, ' + Math.round(l.lu.poss[1]) + ' with one, ' + Math.round(l.lu.poss[2]) + ' with two or more' })),
    o: { x: { label: 'net per 100 for each one more on the floor' }, title: 'Each role on the floor', desc: 'Lineups: net rating per 100 possessions for each player of the role more in the five, the five’s talent held, within the same club and game, with 95% ranges' } }, charts);
  const cl = list.filter(l => isNum(l.b));
  if (cl.length) html += '<p class="ww-note">Across club seasons: ten points more of the club’s minutes played by the role</p>' + chartSlot({ kind: 'forest', label: 'Each role’s share of the minutes', data: cl.map(l => ({ id: 'club:' + l.k, label: ROLE[l.k] || l.k, v: l.b, lo: l.lo, hi: l.hi, muted: l.evidence === 'none',
    badge: l.evidence === 'strong' ? 'strong evidence' : l.evidence === 'some' ? 'some evidence' : '', detail: 'r = ' + f2(l.r) + ' (' + rng(l.rlo, l.rhi, f2) + '); ' + f1(l.count) + ' in a rotation on average' })),
    o: { x: { label: 'net per 100 for ten points more of the minutes' }, title: 'Each role’s share of the minutes', desc: 'Club seasons: net rating per 100 possessions for ten points more of the club’s minutes played by the role, within league, with 95% ranges' } }, charts);
  if (!list.some(l => l.evidence === 'strong' || (l.lu && l.lu.evidence === 'strong'))) html += '<p class="ww-note">No role has strong evidence here, so none is called a winner’s trait.</p>';
  html += '<p class="ww-note">The lineup ranges count each game as a unit; the opposing five is not controlled for. A club-season association is not a cause: talent goes with roles.</p>';
  const tagged = R.tagged || {};
  html += '<details class="ww-details ww-roles"><summary>How a player earns each tag here</summary><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Role</th><th scope="col">The rule</th><th scope="col">Here</th><th scope="col">Players</th></tr></thead><tbody>' +
    Object.keys(ROLE).map(k => '<tr><th scope="row">' + esc(ROLE[k]) + '</th><td>' + esc(ROLE_RULE[k]) + '</td><td translate="no">' + esc(roleHere(R.cuts, k)) + '</td><td translate="no">' + (isNum(tagged[k]) ? tagged[k] : '–') + '</td></tr>').join('') +
    '</tbody></table></div><p class="ww-note">Every cut is a percentile within this league-season, among its players with 200 minutes or more; a tag needs 100 minutes. In the pooled file each league is cut on its own.</p></details>';
  return html;
}

/* ------------------------------------------------------------------ lineup mixes: the state (A.3) --- */
/* a select with an id (focus survives a redraw) and data-j (which condition) */
const sel2 = (id, act, j, items, on, aria, names) => '<select class="ep-input" id="' + id + '" data-act="' + act + '" data-j="' + j + '" aria-label="' + esc(aria) + '">' +
  items.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(v) === String(on) ? ' selected' : '') + (names ? ' translate="no"' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
/* the builder's state, filled with defaults the file can answer: two ball handlers or more, and (second) three
   shooters or more; a statistic's default threshold is the league's top quarter */
function mixState(st, D) {
  const M = st.mix = st.mix || {};
  const role0 = D.roles.indexOf('handler') >= 0 ? 'handler' : D.roles[0];
  const stat0 = D.stats.find(k => D.pct[k]) || D.stats[0];
  const norm = (c, dflt) => {
    c = Object.assign({}, dflt, c || {});
    if (['ge', 'eq', 'le'].indexOf(c.op) < 0) c.op = 'ge';
    c.n = Math.max(0, Math.min(5, Math.round(+c.n || 0)));
    if (c.kind === 'stat') { if (!D.pct[c.stat]) c.stat = stat0; if (c.cmp !== '<') c.cmp = '>'; if (!isNum(+c.x) || c.x === '') c.x = D.pct[c.stat] ? D.pct[c.stat][2] : 0; c.x = +c.x; }
    else { c.kind = 'role'; if (D.roles.indexOf(c.role) < 0) c.role = role0; }
    return c;
  };
  M.c = [norm((M.c || [])[0], { kind: 'role', role: role0, op: 'ge', n: 2 }), norm((M.c || [])[1], { kind: 'role', role: D.roles.indexOf('shooter') >= 0 ? 'shooter' : role0, op: 'ge', n: 3 })];
  return M;
}

/* ------------------------------------------------------------------ the views --- */
/* ctx = {W, ans, fo, foState, club, clubState, teaser, entitled, reason, pooledFallback, st: page state} -> {state, html, charts} */
const views = {
  answer(ctx) {
    const W = ctx.W;
    if (W) {
      const cs = cards(W);
      let html = '';
      if (ctx.pooledFallback) html += empty(ctx.fallbackWhy === 'none' ? 'This league’s model has not been built yet: showing every league pooled' : 'Fewer than 20 finished games here yet: showing every league pooled');
      html += cs.length ? '<div class="ww-cardgrid">' + cs.map(cardHTML).join('') + '</div>' : empty('The short answer appears once the model has its first full build here');
      return { state: 'ok', html, charts: [] };
    }
    if (ctx.teaser) {
      const T = root.EpinoiaWinning;
      const words = T && T.fromTeaser ? T.insights(T.fromTeaser(ctx.teaser)) : [];
      return { state: 'preview', html: '<div class="ww-cardgrid">' + words.slice(0, 5).map(t => cardHTML({ lens: 'preview', n: ctx.teaser.n, text: t })).join('') + '</div>' + ctx.gateNote, charts: [] };
    }
    return { state: 'empty', html: ctx.message ? empty(ctx.message) : '', charts: [] };
  },

  value(ctx) {
    const W = ctx.W, st = ctx.st;
    if (!W) return locked(6);
    const C = W.models.core4c, charts = [];
    let html = '<div class="pg-row ww-ctl">' + seg('lens', [['explain', 'Explains'], ['forecast', 'Forecasts']], st.lens, 'Lens') +
      (st.lens === 'explain' ? seg('unit', [['pts', 'Points'], ['wins', 'Wins per 30'], ['unit', 'Per unit']], st.unit, 'Units') : '') + '</div>';
    if (st.lens === 'forecast') {
      const P = W.predictive;
      html += '<p class="ww-lead">' + chip('forecast', P && P.nEval) + '</p>';
      if (!P || !P.live) html += empty('Season numbers do not forecast better than Elo here');
      if (P && P.coef && P.coef.length) {
        html += chartSlot({ kind: 'forest', label: 'Forecast coefficients', data: P.coef.map(c => ({ id: c.k, label: fcLabel(W, c.k), v: c.b, lo: c.lo, hi: c.hi, muted: !P.live })),
          o: { x: { label: 'points of margin per unit of the expected difference' }, title: 'What the forecast leans on', desc: 'Coefficients of the forecast model, with 95% ranges' } }, charts);
      }
      return { state: 'ok', html, charts };
    }
    const unit = st.unit;
    const val = c => unit === 'wins' ? c.wins30 : unit === 'unit' ? { v: c.b, lo: c.lo, hi: c.hi } : c.pts;
    const sd = c => (c.sdTeam && c.sdTeam.net) || 1;
    const rows = C.coef.map(c => {
      const v = val(c) || {};
      const own = c.own && isNum(c.own.v) ? (unit === 'unit' ? c.own : unit === 'pts' ? { v: c.own.v * sd(c), lo: c.own.lo * sd(c), hi: c.own.hi * sd(c) } : null) : null;
      return { id: c.k, label: label(W, c.k), v: isNum(v.v) ? (unit === 'unit' ? v.v : Math.abs(v.v)) : null,
        lo: isNum(v.lo) ? (unit === 'unit' ? v.lo : Math.min(Math.abs(v.lo), Math.abs(v.hi))) : null, hi: isNum(v.hi) ? (unit === 'unit' ? v.hi : Math.max(Math.abs(v.lo), Math.abs(v.hi))) : null,
        shrunk: c.w > 0, own: own && unit !== 'unit' ? { v: Math.abs(own.v), lo: Math.min(Math.abs(own.lo), Math.abs(own.hi)), hi: Math.max(Math.abs(own.lo), Math.abs(own.hi)) } : own,
        badge: isNum(c.vif) && c.vif > 5 ? 'VIF ' + f1(c.vif) : '', cls: isNum(c.vif) && c.vif > 10 ? 'ww-vifred' : '',
        detail: defOf(W, c.k) + (c.w > 0 ? ' · ' + pc(c.w) + '% from every league' : '') };
    }).filter(r => isNum(r.v));
    const xl = unit === 'wins' ? 'wins per 30 games for one team-SD better' : unit === 'unit' ? 'points of margin per unit (pp)' : 'points of margin per game for one team-SD better';
    html += '<p class="ww-lead">' + chip('explain', C.n) + ' <span class="ww-legend"><i class="ww-k-solid"></i>this league <i class="ww-k-hollow"></i>leaning on every league <i class="ww-k-ghost"></i>its own data alone</span></p>';
    html += chartSlot({ kind: 'forest', pick: 'curves', label: 'What each factor is worth', data: rows,
      o: { x: { label: xl }, title: 'What each factor is worth', desc: 'Each of the four factors: points or wins for one step better, with 95% ranges' } }, charts);
    if (W.sigma && isNum(W.sigma.pred)) html += '<p class="ww-note">' + esc('Points become wins through the spread of results around a pre-game expectation (σ = ' + f1(W.sigma.pred) + ' points), never through the much smaller spread the factors leave over (' + f1(W.sigma.acc) + ')') + '</p>';
    if (C.shares && C.shares.length) {
      const olv = C.oliver || {}, ss = shareScale(C.shares);
      html += '<h3 class="ww-h3">Shares of the margin</h3>';
      html += chartSlot({ kind: 'stackShare', label: 'Shares of the margin', data: [
        /* shares of the whole margin (the card's numbers), the part the four factors leave unexplained drawn grey */
        { label: 'Measured here', total: 100, rest: 'not explained', parts: C.shares.map(s => ({ k: s.k, label: label(W, s.k), v: 100 * ss * s.phi, lo: isNum(s.lo) ? 100 * ss * s.lo : null, hi: isNum(s.hi) ? 100 * ss * s.hi : null })) },
        { label: 'Dean Oliver', parts: coreOf(W).map(k => ({ k, label: label(W, k), v: olv[k] != null ? olv[k] : { c_efg: 0.4, c_tovp: 0.25, c_orebp: 0.2, c_ftr: 0.15, c_ftmr: 0.15 }[k] })) }],
        o: { title: 'Shares of the margin', desc: 'Exact Shapley shares of the margin’s variance (the grey rest is what the four factors leave unexplained), against Dean Oliver’s 40 / 25 / 20 / 15' } }, charts);
      if (C.legacy) { const ls = coreOf(W).reduce((t, k) => t + (isNum(C.legacy[k]) ? C.legacy[k] : 0), 0) > 1.5 ? 0.01 : 1;
        html += '<details class="ww-details"><summary>The old |b| × spread shares</summary><p>' + coreOf(W).map(k => esc(label(W, k)) + ' <span class="ww-num" translate="no">' + pc(ls * C.legacy[k]) + '%</span>').join('<br>') + '</p></details>'; }
      html += '<p class="ww-note">' + esc('The four factors explain ' + pc(C.r2) + '% of the competitive margin (' + pc(C.r2cv) + '% out of sample); on the full-game margin, ' + pc(W.models.fullR2) + '%') + '</p>';
    }
    /* pick the factors yourself: a re-fit from the file's weekly blocks, in the Worker */
    if (W.blocks && W.blocks.keys && W.blocks.list && W.blocks.list.length) {
      const picks = st.picks || coreOf(W).slice();
      html += '<h3 class="ww-h3">Pick the factors yourself</h3><div class="ww-picks" role="group" aria-label="Factors in the re-fit">' +
        W.blocks.keys.filter(k => k !== 'h').map(k => '<label class="ww-check"><input type="checkbox" data-act="pick" value="' + esc(k) + '"' + (picks.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(label(W, k)) + '</label>').join('') +
        '</div><div class="pg-row"><button type="button" class="ep-btn" data-act="refit">Re-fit</button></div>';
      if (st.refit && st.refit.state === 'running') html += '<p class="ww-note" aria-live="polite">Re-fitting with 200 bootstrap draws…</p>';
      if (st.refit && st.refit.state === 'done' && st.refit.result) {
        const r = st.refit.result;
        html += chartSlot({ kind: 'forest', label: 'Your re-fit', data: r.keys.map((k, i) => ({ id: k, label: k === 'h' ? 'Home court' : label(W, k), v: r.b[i], lo: r.lo[i], hi: r.hi[i] })),
          o: { x: { label: 'points of margin per unit' }, title: 'Your re-fit', desc: 'Ridge re-fit on the chosen factors, block bootstrap 95% ranges' } }, charts);
      }
      if (st.refit && st.refit.state === 'error') html += empty('The re-fit could not run here: ' + st.refit.error);
    } else html += '<p class="ww-note">Re-fitting with factors of your choice needs a league’s own file.</p>';
    return { state: 'ok', html, charts };
  },

  factors(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) {
      if (ctx.teaser && ctx.teaser.ranked && ctx.teaser.ranked.length) {
        const T = ctx.teaser;
        return { state: 'preview', html: '<p class="ww-lead">' + chip('preview', T.n) + '</p>' + chartSlot({ kind: 'bars', label: 'Box-score measures and winning', data: T.ranked.map(m => ({ id: m.k, label: m.label, v: m.r })),
          o: { x: { label: 'correlation with winning (r)' }, title: 'Box-score measures and winning', desc: 'The public preview: each box-score measure’s correlation with winning' } }, charts) + ctx.gateNote, charts };
      }
      return locked(8);
    }
    const scan = (W.scan || []).slice();
    if (!scan.length) return { state: 'empty', html: empty('The measures appear once the league has 20 finished games'), charts };
    let html = '<div class="pg-row ww-ctl">' + seg('fview', [['bars', 'Bars'], ['table', 'Table']], st.fview, 'View') + '</div>';
    html += '<p class="ww-lead">' + chip('explain', W.n.games) + ' <span class="ww-legend"><i class="ww-k-bar ww-k-good"></i>better side <i class="ww-k-bar ww-k-bad"></i>worse side <i class="ww-k-bar ww-k-style"></i>a style measure, no better side <i class="ww-k-bar ww-k-noise"></i>not distinguishable from noise (q ≥ 0.05)</span></p>';
    const key = st.sortKey, dir = st.sortDir;
    const val = s => key === 'k' ? label(W, s.k) : key === 'won' ? s.wonIt : key === 'q' ? s.q : Math.abs(s.r);
    scan.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    if (st.fview === 'bars') {
      html += chartSlot({ kind: 'bars', pick: 'curves', label: 'Every measure against winning', data: scan.map(s => ({ id: s.k, label: label(W, s.k), v: s.r, lo: s.lo, hi: s.hi, dir: dirOf(W, s.k) === 0 ? 0 : 1,
        muted: !(s.q < 0.05), badge: s.score ? 'part of the score' : '', detail: defOf(W, s.k) + ' · won it, won the game ' + pc(s.wonIt) + '% of ' + s.decided })),
        o: { x: { label: 'correlation with winning (r), better side up' }, title: 'Every measure against winning', desc: 'Point-biserial correlation of each measure’s difference with winning, with 95% ranges' } }, charts);
    } else {
      const th = (k, t) => '<th scope="col"><button type="button" data-act="sort" data-v="' + k + '" aria-sort="' + (key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + esc(t) + '</button></th>';
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr>' + th('k', 'Measure') + th('r', 'r with winning') + th('q', 'q') + th('won', 'Won it, won') +
        '<th scope="col">Winners</th><th scope="col">Losers</th><th scope="col">VIF</th></tr></thead><tbody>' +
        scan.map(s => '<tr' + (s.q < 0.05 ? '' : ' class="ww-grey"') + '><th scope="row">' + esc(label(W, s.k)) + (s.score ? ' <span class="ww-badge">part of the score</span>' : '') + '</th>' +
          '<td translate="no">' + f2(s.r) + ' <small>' + rng(s.lo, s.hi, f2) + '</small></td><td translate="no">' + (isNum(s.q) ? s.q < 0.001 ? '&lt;0.001' : s.q.toFixed(3) : '–') + '</td>' +
          '<td translate="no">' + pc(s.wonIt) + '% <small>' + rng(s.wonLo, s.wonHi, pc) + '</small></td><td translate="no">' + f1(s.winMean) + '</td><td translate="no">' + f1(s.loseMean) + '</td>' +
          '<td translate="no" class="' + (s.vif > 10 ? 'ww-red' : s.vif > 5 ? 'ww-amber' : '') + '">' + (isNum(s.vif) ? f1(s.vif) : '–') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    return { state: 'ok', html, charts };
  },

  curves(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const keys = Object.keys(W.curves || {});
    if (!keys.length) return { state: 'empty', html: empty('The curves appear once a factor has 60 games with both sides measured'), charts };
    const k = keys.indexOf(st.k) >= 0 ? st.k : keys[0], c = W.curves[k];
    let html = '<div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Factor</span>' + sel('k', keys.map(x => [x, label(W, x)]), k, 'Factor') + '</label></div>';
    /* A.3: what the measure is, how it is worked out and how to read its gap, under the picker */
    html += defBox(W, k);
    html += '<p class="ww-lead">' + chip('explain', c.bins.reduce((s, b) => s + (b[3] || 0), 0)) + '</p>';
    if (c.hard) html += '<p class="ww-hard">Sides ahead by ' + esc(c.hard.t) + ' or more on ' + esc(label(W, k)) + ' won ' + pc(c.hard.p) + '% (' + pc(c.hard.lo) + '–' + pc(c.hard.hi) + ') of ' + c.hard.n + ' games</p>';
    /* MOVE THE GAP (A.3): a slider and a number over the curve's own range; the chart's mark and the readout follow
       live (the page moves the mark without drawing the section again) */
    const G = gapRange(c), gx = isNum(st.gap) && G && st.gapK === k ? Math.min(G.hi, Math.max(G.lo, st.gap)) : (G ? G.start : null);
    const at = G ? gapAt(c, gx) : null;
    html += chartSlot({ kind: 'binnedCurve', live: 'gap', label: 'Chance of winning across the gap in ' + label(W, k), data: { bins: c.bins, raw: c.raw, adj: c.adj, x50: c.x50, x75: c.x75, mark: at },
      o: { x: { label: label(W, k) + ' difference (this side less the other)' }, title: 'Chance of winning by ' + label(W, k) + ' gap', desc: 'Win share in bins with Wilson ranges, the fitted curve with its band, and the break-even points' } }, charts);
    if (G) {
      html += '<div class="ww-gap" role="group" aria-labelledby="wwGapH"><p class="ww-flab" id="wwGapH">Move the gap</p>' +
        '<div class="ww-gaprow"><input type="range" id="wwGap" data-act="gap" min="' + G.lo + '" max="' + G.hi + '" step="' + G.step + '" value="' + gx + '" aria-describedby="wwGapOut" aria-label="' + esc(label(W, k) + ' gap') + '">' +
        '<input type="number" class="ep-input ww-gapn" id="wwGapN" data-act="gapn" min="' + G.lo + '" max="' + G.hi + '" step="' + G.step + '" value="' + gx + '" aria-label="' + esc(label(W, k) + ' gap, as a number') + '" translate="no"></div>' +
        '<p class="ww-gapout" id="wwGapOut" aria-live="polite">' + gapHTML(gapText(W, k, c, at)) + '</p></div>';
    }
    const marks = [];
    if (c.x50 && isNum(c.x50.v)) marks.push('Break-even at ' + f1(c.x50.v) + ' (' + rng(c.x50.lo, c.x50.hi, f1) + ')');
    if (c.x75 && isNum(c.x75.v)) marks.push((marks.length ? 'three' : 'Three') + ' wins in four at ' + f1(c.x75.v) + ' (' + rng(c.x75.lo, c.x75.hi, f1) + ')');
    if (marks.length) html += '<p class="ww-note">' + marks.map(m => '<span>' + esc(m) + '</span>').join('; ') + '</p>';
    if (c.adj) html += '<p class="ww-note">The dashed line holds the other three factors level.</p>';
    if (c.hist && c.hist.length) html += '<h3 class="ww-h3">How often each gap happens</h3>' + chartSlot({ kind: 'histogram', label: 'Games by ' + label(W, k) + ' gap', data: c.hist,
      o: { x: { label: label(W, k) + ' difference' }, countLabel: 'games', mark: 0, title: 'Games by gap', desc: 'How many games had each difference' } }, charts);
    if (c.quart && c.quart.length) html += '<h3 class="ww-h3">By quarter of the gap</h3>' + chartSlot({ kind: 'bars', label: 'Win share by quarter of the gap', data: c.quart.map((q, i) => ({ id: 'q' + i,
      label: f1(q.lo) + ' to ' + f1(q.hi), v: 100 * (q.p - 0.5), lo: 100 * (q.plo - 0.5), hi: 100 * (q.phi - 0.5), detail: q.n + ' games' })),
      o: { x: { label: 'won, points of share above or below half', fmt: v => (v > 0 ? '+' : '') + Math.round(v) }, title: 'Win share by quarter', desc: 'Each quarter of the gap: share of games won, minus 50' } }, charts);
    /* every measure the picker lists, defined (A.3) */
    html += '<details class="ww-details ww-gloss"><summary>What each measure means</summary><dl class="ww-dl">' +
      keys.map(x => '<dt>' + esc(label(W, x)) + '</dt><dd>' + esc(defOf(W, x) || '–') + '<br><span class="ww-mute">' + esc(readOf(W, x)) + '</span></dd>').join('') + '</dl></details>';
    return { state: 'ok', html, charts };
  },

  tempo(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const T = W.tempo;
    if (!T) return { state: 'empty', html: empty('Pace and possession appear once the games have timed possessions'), charts };
    let html = '<p class="ww-lead">' + chip('explain', (T.teams || []).length) + ' <span class="ww-legend">Pace is the same for both sides of a game, so it never enters a difference model.</span></p>';
    if (T.teams && T.teams.length) {
      html += '<h3 class="ww-h3">Team pace and winning</h3>' + chartSlot({ kind: 'scatter', brush: true, label: 'Team pace against winning', data: T.teams.map(t => ({ id: t.id, x: t.pace3q, y: 100 * t.winPct,
        label: t.name, detail: t.gp + ' games, net ' + sg(t.net) + ' per 100', cls: (st.brushed && st.brushed.indexOf(t.id) < 0) ? 'vz-s1f vz-dim' : 'vz-s1f' })),
        o: { x: { label: 'possessions per 40 (first three quarters)' }, y: { label: 'won %', fmt: v => Math.round(v) + '%' }, brush: true, title: 'Team pace and winning', desc: 'Each team-season’s pace against its share of wins; drag to pick teams' } }, charts);
      html += '<p class="ww-note ww-brushed" aria-live="polite">' + (st.brushed && st.brushed.length ? esc('Picked: ' + T.teams.filter(t => st.brushed.indexOf(t.id) >= 0).map(t => t.name).join(', ')) : 'Drag across the chart to pick teams.') + '</p>';
    }
    /* a heading and a key: the solid curve is what happened, the dashed one holds net rating level, which is where the pace
       effect shows once quality is counted (UI2-2) */
    if (T.bins && T.bins.length) html += '<h3 class="ww-h3">Winning by team pace</h3><p class="ww-lead"><span class="ww-legend"><i class="ww-k-line"></i>observed' +
      (T.curveAdj ? ' <i class="ww-k-line ww-k-dash"></i>with net rating held level' : '') + '</span></p>' + chartSlot({ kind: 'binnedCurve', label: 'Winning by team tempo', data: { bins: T.bins, raw: T.curve, adj: T.curveAdj },
      o: { x: { label: 'team pace, z within the league' }, title: 'Winning by team tempo', desc: 'Win share by fifth of team tempo; the dashed line holds net rating level' } }, charts);
    const g = T.sqrtN;
    if (g) {
      html += '<h3 class="ww-h3">Do more possessions help the favourite?</h3>' + chip('forecast', g.n);
      const pt = paceText(g);
      if (pt) html += '<p class="ww-hard">' + esc(pt) + '</p>';
      html += chartSlot({ kind: 'line', label: 'The favourite’s chance by expected possessions', data: [
        { k: 'obs', label: 'observed', pts: g.terciles.map(t => [t.rho, 100 * t.p, 100 * t.lo, 100 * t.hi]) },
        { k: 'fit', label: 'fitted', dash: true, pts: g.terciles.map(t => [t.rho, 100 * t.fit]) }],
        o: { x: { label: 'expected possessions against the league’s' }, y: { label: 'favourite won %', fmt: v => Math.round(v) + '%' }, title: 'Favourite’s win share by expected possessions', desc: 'Terciles of pre-game expected possessions' } }, charts);
      html += '<p class="ww-note">' + esc('A likelihood-ratio test of no effect gives p = ' + f2(g.lrP) + '; the structural value is 0.5') + '</p><p class="ww-note">Expected possessions come from each side’s pace before the game, never the pace it ended with.</p>';
    }
    if (T.control) html += '<h3 class="ww-h3">Who sets the tempo</h3><p class="ww-note">' + chip('explain', T.control.n, 'descriptive') + '</p><p class="ww-hard">Where the two paces differ, the side whose pace the game took won ' +
      pc(T.control.p) + '% (' + pc(T.control.lo) + '–' + pc(T.control.hi) + ') of ' + T.control.n + ' games; odds ratio ' + f2(T.control.or.v) + ' (' + f2(T.control.or.lo) + '–' + f2(T.control.or.hi) + ')</p>';
    const top = (W.path || []).filter(p => ['top_avg', 'early_share', 'top_share'].indexOf(p.k) >= 0);
    if (top.length) {
      /* one small forest a measure, each on its own unit (seconds, or ten points of a share), so a per-second effect is
         never flattened against a per-share one */
      const per = k => (k === 'top_avg' ? { f: 1, x: 'points of margin per second' } : { f: 0.1, x: 'points of margin per 10 points of share' });
      const sc = (c, f) => (c && isNum(c.v) ? { v: c.v * f, lo: isNum(c.lo) ? c.lo * f : null, hi: isNum(c.hi) ? c.hi * f : null } : null);
      html += '<h3 class="ww-h3">Time of possession: direct and through the four factors</h3>' + chartSlot({ kind: 'smallMultiples', label: 'Time of possession, direct and indirect',
        data: top.map(p => { const u = per(p.k), d = sc(p.direct, u.f), i = sc(p.indirect, u.f), t = sc(p.total, u.f);
          return { title: label(W, p.k), kind: 'forest', data: [d && Object.assign({ id: p.k + ':d', label: 'direct' }, d), i && Object.assign({ id: p.k + ':i', label: 'via factors', shrunk: true }, i),
            t && Object.assign({ id: p.k + ':t', label: 'total' }, t)].filter(Boolean), o: { x: { label: u.x } } }; }),
        o: { panelH: 200, cols: 1, title: 'Time of possession effects', desc: 'Direct effect, the part through the four factors, and the total, each measure on its own unit, with 95% ranges' } }, charts);
      html += '<p class="ww-note">The direct effect is the headline: short possessions are partly transition and offensive rebounds, which the factors already count, so the path through offensive rebounds is partly true by definition.</p>';
    }
    if (T.windows) html += '<h3 class="ww-h3">Points per chance by shot clock</h3>' + chartSlot({ kind: 'bars', label: 'Points per first chance by time used', data: [
      { id: 'e', label: 'within 8 s', v: T.windows.e.v, lo: T.windows.e.lo, hi: T.windows.e.hi, cls: 'vz-s1f' },
      { id: 'm', label: '8 to 16 s', v: T.windows.m.v, lo: T.windows.m.lo, hi: T.windows.m.hi, cls: 'vz-s1f' },
      { id: 'l', label: 'over 16 s', v: T.windows.l.v, lo: T.windows.l.lo, hi: T.windows.l.hi, cls: 'vz-s1f' }],
      o: { x: { label: 'points per chance', lo: 0, hi: 1.4 }, title: 'Points per chance by shot clock', desc: 'League points per first chance by time used, with 95% ranges' } }, charts);
    return { state: 'ok', html, charts };
  },

  positions(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const P = W.positions;
    if (!P) return { state: 'empty', html: empty('Positions appear once rosters list positions or heights for most of the minutes'), charts };
    let html = '<p class="ww-lead">' + chip('explain', W.n.games) + ' <span class="ww-legend">' + esc('Positions are estimated: ' + pc(P.coverage.listed) + '% listed, ' + pc(P.coverage.height) + '% by height, ' + pc(P.coverage.bpmOnly) + '% from the box score alone') + '</span></p>';
    const stats = [...new Set(P.p1.map(r => r.stat))];
    if (P.p1.length) {
      html += '<h3 class="ww-h3">What each group’s numbers are worth</h3>' + chartSlot({ kind: 'heatmap', label: 'Points per team-SD by group and statistic', data: { rows: ['G', 'F', 'C'].map(g => GROUP[g]), cols: stats.map(s => P1_LABEL[s] || s), mode: 'div',
        cells: ['G', 'F', 'C'].map(g => stats.map(s => { const r = P.p1.find(x => x.g === g && x.stat === s); return r ? { v: r.b, lo: r.lo, hi: r.hi, label: f1(r.b) + (r.star ? '★' : ''), detail: r.star ? 'range excludes 0 after the false-discovery check' : '' } : null; })) },
        o: { dp: 1, title: 'Points per team-SD by group', desc: 'Positional accounting: points of margin per team-SD better in each group’s statistic; ★ where the range excludes 0' } }, charts);
    }
    if (P.p2.length) {
      const g = ['G', 'F', 'C'].indexOf(st.posG) >= 0 ? st.posG : 'G';
      html += '<h3 class="ww-h3">What winners get from each group</h3><div class="pg-row ww-ctl">' + seg('posG', [['G', 'Guards'], ['F', 'Wings'], ['C', 'Bigs']], g, 'Group') + '</div>';
      /* the seven statistics on one scale: per cent above or below the league's median. BPM and the minutes share sit
         near 0 or are shares of a whole, so they are in the table only (a per cent of a median near 0 says nothing) */
      const rel = (v, m) => (isNum(v) && isNum(m) && Math.abs(m) > 1e-9 ? 100 * (v / m - 1) : null);
      const rows = P.p2.filter(r => r.g === g), seven = rows.filter(r => P1_STATS.indexOf(r.stat) >= 0 && isNum(rel(r.top, r.mid)));
      if (seven.length) html += chartSlot({ kind: 'dumbbell', label: 'What winners get from ' + GROUP[g].toLowerCase(), data: seven.map(r => ({ id: r.stat, label: P1_LABEL[r.stat] || r.stat,
        pts: [{ k: 'top', label: 'top quarter', v: rel(r.top, r.mid), lo: rel(r.topLo, r.mid), hi: rel(r.topHi, r.mid), cls: GROUPCLS[g] }, { k: 'mid', label: 'league', v: 0, cls: 'vz-neuf' },
              { k: 'bottom', label: 'bottom quarter', v: rel(r.bottom, r.mid), cls: 'vz-neuf', hollow: true }] })),
        o: { x: { label: '% above or below the league’s median', fmt: v => (v > 0 ? '+' : '') + Math.round(v) + '%' }, title: 'What winners get', desc: 'Median of the top quarter by net rating and of the bottom quarter, against the league' } }, charts);
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">' + esc(GROUP[g]) + '</th><th scope="col">Top quarter</th><th scope="col">League</th><th scope="col">Bottom quarter</th></tr></thead><tbody>' +
        rows.map(r => '<tr><th scope="row">' + esc(P1_LABEL[r.stat] || r.stat) + '</th><td translate="no">' + f2s(r.top) + (isNum(r.topLo) ? ' <small>' + rng(r.topLo, r.topHi, f2s) + '</small>' : '') +
          '</td><td translate="no">' + f2s(r.mid) + '</td><td translate="no">' + f2s(r.bottom) + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (P.p2f && P.p2f.length) html += '<h3 class="ww-h3">Does a better group forecast wins?</h3>' + chip('forecast', W.n.games) + chartSlot({ kind: 'forest', label: 'Forecast value of each group’s talent', data: P.p2f.map(r => ({ id: r.g, label: GROUP[r.g], v: r.b, lo: r.lo, hi: r.hi, cls: GROUPCLS[r.g] })),
      o: { x: { label: 'points of margin per point of minutes-weighted BPM' }, title: 'Slot forecast', desc: 'Season-to-date BPM by group as a forecast of the margin' } }, charts);
    html += posStatsHTML(W, st, charts);
    return { state: 'ok', html, charts };
  },

  squad(ctx) {
    const W = ctx.W, charts = [];
    if (!W) return locked(6);
    const L = W.lineup, Q = W.squad;
    if (!L && !Q && !(W.roles && W.roles.list && W.roles.list.length)) return { state: 'empty', html: empty('Squad shapes appear once lineups and rosters cover enough games'), charts };
    let html = '';
    if (L && L.grid && L.grid.length) {
      html += '<h3 class="ww-h3">Shooters and bigs on the floor</h3><p class="ww-lead">' + chip('explain', L.n) + ' <span class="ww-legend">net per 100 possessions against two shooters, one big, one handler and one protector; hatched under 200 possessions</span></p>';
      html += chartSlot({ kind: 'heatmap', label: 'Lineup net rating by shooters and bigs', data: { rows: [0, 1, 2, 3, 4, 5].map(s => s + (s === 1 ? ' shooter' : ' shooters')), cols: ['0 bigs', '1 big', '2+ bigs'], mode: 'div',
        cells: [0, 1, 2, 3, 4, 5].map(s => ['0', '1', '2+'].map(b => { const c = L.grid.find(x => x.s === s && x.b === b); return c ? { v: c.net, lo: c.lo, hi: c.hi, hatch: c.poss < 200, label: sg(c.net), detail: c.poss + ' possessions' } : null; })) },
        o: { dp: 1, transpose: false, title: 'Lineup mixes', desc: 'Net per 100 possessions by shooters on the floor and bigs, against the reference five' } }, charts);
      html += '<p class="ww-note">The opposing five is not controlled for.</p>';
      /* BALL HANDLERS ON THE FLOOR (2026-10-07): the same lineup model by handlers (assists, usage and self-created points) */
      if (L.gridH && L.gridH.length) {
        html += '<h3 class="ww-h3">Shooters and ball handlers on the floor</h3><p class="ww-lead">' + chip('explain', L.n) + ' <span class="ww-legend">net per 100 possessions against two shooters and one handler (one big, one protector); hatched under 200 possessions</span></p>';
        html += chartSlot({ kind: 'heatmap', label: 'Lineup net rating by shooters and ball handlers', data: { rows: [0, 1, 2, 3, 4, 5].map(s => s + (s === 1 ? ' shooter' : ' shooters')), cols: ['0 handlers', '1 handler', '2+ handlers'], mode: 'div',
          cells: [0, 1, 2, 3, 4, 5].map(s => ['0', '1', '2+'].map(h => { const c = L.gridH.find(x => x.s === s && x.h === h); return c ? { v: c.net, lo: c.lo, hi: c.hi, hatch: c.poss < 200, label: sg(c.net), detail: Math.round(c.poss) + ' possessions' } : null; })) },
          o: { dp: 1, transpose: false, title: 'Ball handlers and shooters', desc: 'Net per 100 possessions by shooters on the floor and ball handlers, against the reference five' } }, charts);
        html += '<p class="ww-note">A ball handler creates for others and for himself: his assist percentage, his usage and the share of his own points that were unassisted (Roles below says how the tag is earned here).</p>';
      }
      if (L.terms && L.terms.length) html += chartSlot({ kind: 'forest', label: 'Lineup terms', data: L.terms.map(t => ({ id: t.k, label: TERM_LABEL[t.k] || t.k, v: t.b, lo: t.lo, hi: t.hi })),
        o: { x: { label: 'net per 100 possessions' }, title: 'Lineup terms', desc: 'Each term of the lineup model' } }, charts);
    }
    if (Q && Q.coef && Q.coef.length) {
      html += '<h3 class="ww-h3">Squad shape</h3><p class="ww-lead">' + chip('explain', Q.n) + (Q.power === 'low' ? ' <span class="ww-chipx">low power: few team-seasons</span>' : '') + '</p>';
      html += chartSlot({ kind: 'forest', label: 'Squad shape and net rating', data: Q.coef.map(c => ({ id: c.k, label: SQUAD_LABEL[c.k] || c.k, v: c.b, lo: c.lo, hi: c.hi, muted: c.evidence === 'none',
        badge: c.evidence === 'strong' ? 'strong evidence' : c.evidence === 'some' ? 'some evidence' : '' })),
        o: { x: { label: 'net per 100 for one SD more' }, title: 'Squad shape', desc: 'Team-season squad features against net rating, with evidence grades' } }, charts);
      if (!Q.coef.some(c => c.evidence === 'strong')) html += '<p class="ww-note">No squad feature has strong evidence here, so none is called a winner’s trait.</p>';
      const bands = Q.bands || {}, bk = Object.keys(bands);
      if (bk.length) html += '<details class="ww-details"><summary>Winners’ bands (middle half of the top quarter)</summary><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Feature</th><th scope="col">P25</th><th scope="col">P50</th><th scope="col">P75</th></tr></thead><tbody>' +
        bk.map(k => '<tr><th scope="row">' + esc(SQUAD_LABEL[k] || k) + '</th><td translate="no">' + f2(bands[k].p25) + '</td><td translate="no">' + f2(bands[k].p50) + '</td><td translate="no">' + f2(bands[k].p75) + '</td></tr>').join('') + '</tbody></table></div></details>';
      const pd = Q.pd || {};
      if (Object.keys(pd).length) html += chartSlot({ kind: 'smallMultiples', label: 'Partial dependence', data: Object.keys(pd).map(k => ({ title: SQUAD_LABEL[k] || k, kind: 'line', data: [{ k, label: '', pts: pd[k] }], o: { y: { label: 'net' }, ref: 0 } })),
        o: { panelH: 170, title: 'Partial dependence', desc: 'Net per 100 across each feature, the others held' } }, charts);
    }
    html += creationHTML(W, charts);
    html += rolesHTML(W, charts);
    return { state: 'ok', html, charts };
  },

  /* LINEUP MIXES (A.3): the reader's own conditions over every five the league's clubs used, worked out here from the
     mix file (loaded when this section comes near), against the rest of the same clubs' fives */
  mixes(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    if (!W.league) return { state: 'empty', html: empty(ctx.pooledFallback ? 'The lineup builder needs this league’s own model' : 'Pick a league to build its lineup mixes'), charts };
    if (ctx.mixState === 'idle' || ctx.mixState === 'loading') return { state: 'loading', html: '<div class="pg-row"><button type="button" class="ep-btn pri" data-act="loadmix"' + (ctx.mixState === 'loading' ? ' disabled' : '') + '>' +
      (ctx.mixState === 'loading' ? 'Loading the lineups…' : 'Open the lineup builder') + '</button></div>', charts };
    const X = root.EpinoiaWinMix, D = ctx.mix;
    if (ctx.mixState !== 'ok' || !D || !X) return { state: 'empty', html: empty(ctx.mixMessage || 'The lineup builder’s file is built with the next model run'), charts };
    const M = mixState(st, D), teams = ((W.tempo && W.tempo.teams) || []).filter(t => D.teams.indexOf(t.id) >= 0);
    const presets = X.presets(D);
    let html = '<p class="ww-lead">' + chip('explain', D.n.fives, 'fives') + ' <span class="ww-legend">' + esc('Every five a club used this season, its stints added up; a player counts toward a statistic with 100 minutes or more') + '</span></p>';
    html += '<div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Start from</span>' + sel('mixpreset', [['', 'Your own conditions']].concat(presets.map(p => [p.id, p.label])), M.preset || '', 'Start from') + '</label>' +
      '<label class="ww-field"><span class="ww-flab">Clubs</span>' + sel('mixteam', [['', 'Every club']].concat(teams.map(t => [t.id, t.name]).sort((a, b) => (a[1] < b[1] ? -1 : 1))), M.team || '', 'Clubs', true) + '</label></div>';
    const cond = (c, j) => {
      const id = x => 'wwMx' + x + j;
      const stat = c.kind === 'stat', pct = stat ? (D.pct[c.stat] || null) : null;
      return '<fieldset class="ww-cond"><legend>' + (j ? 'And' : 'Fives with') + '</legend><div class="ww-condrow">' +
        sel2(id('op'), 'mixop', j, [['ge', 'at least'], ['eq', 'exactly'], ['le', 'at most']], c.op, 'How many') +
        sel2(id('n'), 'mixn', j, [0, 1, 2, 3, 4, 5].map(n => [String(n), String(n)]), String(c.n), 'Players', true) +
        sel2(id('kind'), 'mixkind', j, [['role', 'players who are'], ['stat', 'players whose']], c.kind, 'Kind') +
        (stat ? sel2(id('stat'), 'mixstat', j, D.stats.filter(k => D.pct[k]).map(k => [k, pstatLabel(k)]), c.stat, 'Statistic') +
          sel2(id('cmp'), 'mixcmp', j, [['>', 'is above'], ['<', 'is below']], c.cmp, 'Above or below') +
          '<input type="number" class="ep-input ww-mixx" id="' + id('x') + '" data-act="mixx" data-j="' + j + '" step="' + (c.stat === 'au' ? '0.05' : '0.5') + '" value="' + esc(c.x) + '" aria-label="' + esc('Threshold for ' + pstatLabel(c.stat)) + '" translate="no">'
          : sel2(id('role'), 'mixrole', j, D.roles.filter(r => ROLE_ONE[r]).map(r => [r, ROLE_ONE[r] + 's']), c.role, 'Role')) +
        '</div>' + (pct ? '<p class="ww-note ww-mute" translate="no">' + esc(pstatLabel(c.stat) + ': P25 ' + pct[0] + ' · P50 ' + pct[1] + ' · P75 ' + pct[2] + ' · P90 ' + pct[3]) + '</p>' : '') + '</fieldset>';
    };
    html += '<div class="ww-conds">' + cond(M.c[0], 0) + (M.two ? cond(M.c[1], 1) : '') + '</div>';
    html += '<div class="pg-row ww-ctl"><label class="ww-check"><input type="checkbox" data-act="mixtwo"' + (M.two ? ' checked' : '') + '> ' + esc('Add a second condition') + '</label></div>';
    /* the arithmetic: under a millisecond at the largest league (winmix.js, one pass) */
    const conds = M.two ? M.c : [M.c[0]];
    const r = X.filter(D, conds, { team: M.team || '' });
    const A = r.in, R = r.rest, scopePoss = A.poss + R.poss;
    html += '<div class="ww-mixr" aria-live="polite">';
    html += '<p class="ww-hard">' + esc(A.fives + ' fives, ' + Math.round(A.min) + ' minutes, ' + Math.round(A.poss) + ' possessions: ' + pc(scopePoss > 0 ? A.poss / scopePoss : 0) + '% of the possessions in view') + '</p>';
    if (!A.fives) html += empty('No five meets these conditions: loosen one');
    else {
      if (A.small) html += '<p class="ww-note ww-warn">' + esc('Under 200 possessions: a small sample, read the ranges') + '</p>';
      if (A.unrated > 0.1) html += '<p class="ww-note">' + esc(pc(A.unrated) + '% of these possessions had a player the rule could not judge (under 100 minutes, or withheld)') + '</p>';
      const MEAS = [['net', 'Net rating', 1], ['ortg', 'Offensive rating', 1], ['drtg', 'Defensive rating', -1], ['efg', 'eFG%', 1], ['tovp', 'TOV%', -1], ['orebp', 'OREB%', 1], ['ftr', 'FT attempt rate (FTA/FGA)', 1],
        ['defg', 'Opponents’ eFG%', -1], ['dtovp', 'Opponents’ TOV%', 1], ['dorebp', 'Opponents’ OREB%', -1], ['dftr', 'Opponents’ FT attempt rate (FTA/FGA)', -1]];
      const cellv = o => (o && isNum(o.v) ? f1(o.v) + (isNum(o.lo) ? ' <small>' + rng(o.lo, o.hi, f1) + '</small>' : '') : '–');
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Per 100 possessions or %</th><th scope="col">These fives</th><th scope="col">The rest</th><th scope="col">Difference</th></tr></thead><tbody>' +
        MEAS.map(([k, t]) => '<tr><th scope="row">' + esc(t) + '</th><td translate="no">' + cellv(A[k]) + '</td><td translate="no">' + cellv(R[k]) + '</td><td translate="no">' + (r.diff[k] && isNum(r.diff[k].v) ? sg(r.diff[k].v) + ' <small>' + rng(r.diff[k].lo, r.diff[k].hi, f1) + '</small>' : '–') + '</td></tr>').join('') +
        '</tbody></table></div>';
      html += chartSlot({ kind: 'forest', label: 'These fives against the rest', data: MEAS.filter(([k]) => r.diff[k] && isNum(r.diff[k].v)).map(([k, t, dir]) => ({ id: 'mx:' + k, label: t, v: r.diff[k].v, lo: r.diff[k].lo, hi: r.diff[k].hi, muted: !(r.diff[k].lo > 0 || r.diff[k].hi < 0),
        detail: dir > 0 ? 'higher is better' : 'lower is better' })),
        o: { x: { label: 'these fives less the rest' }, title: 'These fives against the rest', desc: 'Each rating and factor of the fives meeting the conditions less the rest’s, with 95% ranges (each five a cluster)' } }, charts);
      /* a count with a handful of possessions (−60 on three) would set the axis for the rest: under 50 it is left out, and said */
      const dose = r.byCount.filter(b => b.poss >= 50 && b.net && isNum(b.net.v)), thin = r.byCount.filter(b => b.poss > 0 && b.poss < 50);
      if (dose.length > 1) html += '<h3 class="ww-h3">By how many of the five meet the first condition</h3>' + chartSlot({ kind: 'bars', label: 'Net rating by how many meet the first condition', data: dose.map(b => ({ id: 'n' + b.k, label: b.k + ' of 5',
        v: b.net.v, lo: b.net.lo, hi: b.net.hi, dir: 1, muted: b.small, detail: Math.round(b.poss) + ' possessions' + (b.small ? ', a small sample' : '') })),
        o: { x: { label: 'net per 100 possessions' }, title: 'Net rating by count', desc: 'Net rating per 100 possessions of the fives with 0 to 5 players meeting the first condition (the second one applied), with 95% ranges; faint under 200 possessions' } }, charts) +
        (thin.length ? '<p class="ww-note">' + esc('Left out of the chart, under 50 possessions: ' + thin.map(b => b.k + ' of 5').join(', ')) + '</p>' : '');
    }
    html += '</div>';
    if (D.trim) html += '<p class="ww-note">' + esc('To keep the file small, the ' + D.trim.fives + ' fives with the fewest possessions (under ' + f1(D.trim.minPoss) + ' each, ' + pc(D.trim.poss) + '% of all possessions) are left out') + '</p>';
    html += '<p class="ww-note">Each five is a cluster for the ranges; the opposing five is not controlled for, and a five that played together is not a random draw. Read a difference as what happened, not what would.</p>';
    return { state: 'ok', html, charts };
  },

  sim(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    /* the pooled file stands in for a league's own: say why there is no simulator, never "pick a league" */
    if (!W.league && ctx.pooledFallback) return { state: 'empty', html: empty(ctx.fallbackWhy === 'none' ? 'This league’s simulator is built with its model: back within the hour' : 'The simulator needs 20 finished games in this league'), charts };
    if (!W.league) return { state: 'empty', html: empty('Pick a league to simulate its games'), charts };
    if (ctx.foState === 'idle' || ctx.foState === 'loading') return { state: 'loading', html: '<div class="pg-row"><button type="button" class="ep-btn pri" data-act="loadsim"' + (ctx.foState === 'loading' ? ' disabled' : '') + '>' +
      (ctx.foState === 'loading' ? 'Loading the simulator…' : 'Open the simulator') + '</button></div>', charts };
    if (ctx.foState !== 'ok' || !ctx.fo) return { state: 'empty', html: empty(ctx.foMessage || 'The simulator needs this league’s Front office file, built with the model'), charts };
    const fo = ctx.fo, teams = fo.teams || [];
    if (teams.length < 2) return { state: 'empty', html: empty('The simulator needs two sides with games'), charts };
    const t1 = teams.some(t => t.id === st.t1) ? st.t1 : teams[0].id, t2 = teams.some(t => t.id === st.t2 && t.id !== t1) ? st.t2 : teams.find(t => t.id !== t1).id;
    const opts = teams.map(t => [t.id, t.name]);
    let html = '<p class="ww-lead">' + chip('model', null, fo.sim && fo.sim.calibrated ? 'calibrated' : 'experimental: compare the changes, not the odds') + '</p>';
    html += '<div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Side A</span>' + sel('t1', opts, t1, 'Side A', true) + '</label>' +
      '<label class="ww-field"><span class="ww-flab">Side B</span>' + sel('t2', opts, t2, 'Side B', true) + '</label></div>';
    html += '<div class="pg-row ww-ctl">' + seg('venue', [['1', 'A at home'], ['0', 'Neutral'], ['-1', 'B at home']], String(st.venue), 'Venue') + '</div>';
    const name = id => (teams.find(t => t.id === id) || {}).name || '';
    html += '<div class="ww-dials">' + ['A', 'B'].map(side => '<fieldset class="ww-dialset"><legend translate="no">' + esc(side === 'A' ? name(t1) : name(t2)) + '</legend>' +
      DIALS.map(d => { const v = (st.dials[side] || {})[d.key] || 0; const id = 'wwd' + side + d.key;
        return '<label class="ww-dial" for="' + id + '"><span class="ww-dlab">' + esc(d.label) + '</span><input type="range" id="' + id + '" data-act="dial" data-side="' + side + '" data-key="' + d.key +
          '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '"><output translate="no">' + sg(v, d.step < 1 ? 1 : 0) + ' ' + d.unit + '</output></label>'; }).join('') + '</fieldset>').join('') + '</div>';
    html += '<div class="pg-row"><button type="button" class="ep-btn" data-act="dialreset">Reset the dials</button></div>';
    /* the result in its own part: a simulation redraws only this, never the controls (a slider being dragged, a
       select with focus) */
    const r = views.simResult(ctx);
    r.charts.forEach(c => charts.push(c));
    html += '<div class="ww-simr" data-part="simR">' + r.html.replace(/data-chart="(\d+)"/g, (m, i) => 'data-chart="' + (charts.length - r.charts.length + +i) + '"') + '</div>';
    return { state: 'ok', html, charts };
  },

  /* the simulator's result alone (meter, margins, what moves the odds), for #sim's result part */
  simResult(ctx) {
    const st = ctx.st, charts = [], fo = ctx.fo, teams = (fo && fo.teams) || [];
    if (teams.length < 2) return { state: 'empty', html: '', charts };
    const t1 = teams.some(t => t.id === st.t1) ? st.t1 : teams[0].id, t2 = teams.some(t => t.id === st.t2 && t.id !== t1) ? st.t2 : teams.find(t => t.id !== t1).id;
    const name = id => (teams.find(t => t.id === id) || {}).name || '';
    let html = '';
    const R = st.simResult;
    if (st.simState === 'running') html += '<p class="ww-note" aria-live="polite">Simulating…</p>';
    if (R && R.key === simKey(st, t1, t2)) {
      html += chartSlot({ kind: 'meter', label: 'Chance of winning', data: { p: R.pWin, se: R.se, a: name(t1), b: name(t2) }, o: { title: 'Chance of winning', desc: 'Simulated chance of each side winning, with its error' } }, charts);
      html += '<p class="ww-note">' + esc(R.n + ' games simulated; expected margin ' + sg(R.mean) + ' (' + sg(R.q05, 0) + ' to ' + sg(R.q95, 0) + ' in nine games of ten)') + '</p>';
      if (R.hist && R.hist.length) html += chartSlot({ kind: 'histogram', label: 'Simulated margins', data: R.hist, o: { x: { label: 'margin for ' + name(t1) }, split: 0, countLabel: 'games', title: 'Simulated margins', desc: 'How often each margin came up' } }, charts);
      if (R.tornado && R.tornado.length) html += '<h3 class="ww-h3">What moves the odds</h3>' + chartSlot({ kind: 'tornado', label: 'Each dial at its ends', data: { base: R.pWin, rows: R.tornado },
        o: { title: 'What moves the odds', desc: 'Side A’s chance with each of its dials at either end, the rest as set' } }, charts);
    }
    if (st.simState === 'error') html += empty('The simulation could not run here: ' + (st.simError || 'unknown'));
    return { state: 'ok', html, charts };
  },

  losses(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const L = W.losses;
    if (!L || !L.parts || !L.parts.length) return { state: 'empty', html: empty('Defeats are split once the model has its first full build here'), charts };
    const ex = L.parts.find(p => p.k === 'expected');
    let html = '<p class="ww-lead">' + chip('explain', L.n) + '</p><h3 class="ww-h3">The average defeat</h3>';
    html += chartSlot({ kind: 'waterfall', label: 'The average defeat, part by part', data: { start: { label: 'expected', v: ex ? ex.pts : 0 }, parts: L.parts.filter(p => p.k !== 'expected').map(p => ({ k: p.k, label: PART_LABEL[p.k] || label(W, p.k), v: p.pts, lo: p.lo, hi: p.hi })),
      total: { label: 'average defeat' } }, o: { y: { label: 'points' }, title: 'The average defeat', desc: 'Expected margin, then each part, adding up to the average losing margin' } }, charts);
    /* luckSd is the spread of (points − expected points), net of the opponent's: shot-making against shot quality with
       free throws in. It overlaps the shot-making part; it is not a remainder beyond the parts (that is 'other') */
    if (isNum(L.luckSd)) html += '<p class="ww-note">' + esc('Shot-making against shot quality (both sides, free throws included) varies by about ' + f1(L.luckSd) + ' points a game') + '</p><p class="ww-note">It overlaps the shot-making part, so it is shown beside the parts, never added to them.</p>';
    const teams = (W.tempo && W.tempo.teams) || [];
    if (W.league && teams.length) {
      html += '<h3 class="ww-h3">A club’s defeats</h3><div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Club</span>' + sel('club', [['', 'Pick a club']].concat(teams.map(t => [t.id, t.name]).sort((a, b) => (a[1] < b[1] ? -1 : 1))), st.club || '', 'Club', true) + '</label></div>';
      const C = ctx.club;
      if (st.club && ctx.clubState === 'loading') html += '<p class="ww-note" aria-live="polite">Loading the club’s file…</p>';
      if (st.club && ctx.clubState === 'refused') html += '<div class="ww-lock" data-memlock="4"></div>';
      if (st.club && ctx.clubState === 'none') html += empty('This club’s file is built with the next model run');
      if (st.club && C && ctx.clubState === 'ok') {
        const lost = (C.games || []).filter(g => g.m < 0);
        const xm = lost.length ? lost.reduce((s, g) => s + g.xm, 0) / lost.length : 0;
        html += '<p class="ww-lead">' + chip('explain', C.losses.n) + ' <span class="ww-legend" translate="no">' + esc(C.team.name) + ': ' + C.record.w + '–' + C.record.l + '</span></p>';
        html += chartSlot({ kind: 'waterfall', label: C.team.name + '’s average defeat', data: { start: { label: 'expected', v: xm }, parts: C.losses.mean.map(p => ({ k: p.k, label: PART_LABEL[p.k] || p.k, v: p.pts, lo: p.lo, hi: p.hi })),
          total: { label: 'average defeat' } }, o: { y: { label: 'points' }, title: 'A club’s average defeat', desc: 'The club’s defeats, part by part' } }, charts);
        const why = C.losses.mean.filter(p => p.k !== 'other' && p.k !== 'garbage' && isNum(p.hi) && p.hi < 0);
        if (why.length) html += '<p class="ww-hard">' + esc('You lose when ' + why.map(p => PART_LABEL[p.k] || p.k).join(' and ') + ' go against you') + '</p>';
        const last = lost.slice(-10).reverse();
        if (last.length) html += '<h3 class="ww-h3">The last ten defeats</h3>' + chartSlot({ kind: 'smallMultiples', label: 'The last ten defeats', data: last.map(g => ({ title: g.d + ' · ' + sg(g.m, 0),
          kind: 'waterfall', data: { start: { label: 'expected', v: g.xm }, parts: ['quality', 'making', 'tovp', 'orebp', 'ftr', 'other', 'garbage'].map(k => ({ k, label: PART_LABEL[k], v: partOf(g.parts, k) })), total: { label: 'margin' } } })),
          o: { panelH: 190, title: 'The last ten defeats', desc: 'Each defeat split into its parts' } }, charts);
      }
    }
    return { state: 'ok', html, charts };
  },

  leagues(ctx) {
    const W = ctx.W, charts = [];
    if (!W) {
      const T = ctx.teaser;
      if (T && T.leagues && T.leagues.length) return { state: 'preview', html: '<p class="ww-lead">' + chip('preview', T.n) + '</p><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">League</th><th scope="col">Games</th><th scope="col">What wins there</th><th scope="col">Won it, won</th><th scope="col">Home wins</th></tr></thead><tbody>' +
        T.leagues.map(l => '<tr><th scope="row"><a href="?l=' + encodeURIComponent(l.slug) + '" data-act="league" data-v="' + esc(l.slug) + '" translate="no">' + esc(l.name) + '</a></th><td translate="no">' + l.n + '</td><td>' + esc(l.top ? l.top.label : '–') + '</td><td translate="no">' +
          (l.top ? pc(l.top.winRate) + '%' : '–') + '</td><td translate="no">' + pc(l.homeWin) + '%</td></tr>').join('') + '</tbody></table></div>' + ctx.gateNote, charts };
      return locked(5);
    }
    if (W.leagues && W.leagues.length) {
      const lg = W.leagues, pool = Object.fromEntries((W.models.core4c.coef || []).map(c => [c.k, c.b]));
      let html = '<p class="ww-lead">' + chip('explain', W.n.games) + ' <span class="ww-legend"><i class="ww-k-bar ww-k-s1"></i>weighs more than in the pool <i class="ww-k-bar ww-k-s2"></i>weighs less; a weight, not better or worse; hatched where it leans mostly on the pool (over 60%)</span></p>';
      /* a factor's weight: how many points of margin a unit of it is worth. More or less weight than the pool is not
         better or worse, so the colour is a neutral pair (s1 / s2), on the size of the weight */
      html += chartSlot({ kind: 'heatmap', label: 'Leagues against the pooled answer', data: { rows: lg.map(l => l.name), cols: coreOf(W).map(k => label(W, k)), mode: 'rel',
        cells: lg.map(l => coreOf(W).map(k => { const c = l.coef.find(x => x.k === k); if (!c || !c.eb || !isNum(pool[k])) return null; const rel = (Math.abs(c.eb.v) - Math.abs(pool[k])) / (Math.abs(pool[k]) || 1);
          return { v: rel, hatch: c.w > 0.6, label: f2(c.eb.v), lo: c.eb.lo, hi: c.eb.hi, detail: pc(c.w) + '% from the pool' + (c.own ? ' · own ' + f2(c.own.v) : '') }; })) },
        o: { dp: 2, title: 'Leagues against the pooled answer', desc: 'Each league’s shrunk coefficient; colour is how much more or less the factor weighs than in the pool' } }, charts);
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">League</th><th scope="col">Games</th><th scope="col">Home court beyond the factors</th><th scope="col">Strongest measures</th></tr></thead><tbody>' +
        lg.map(l => '<tr><th scope="row"><a href="?l=' + encodeURIComponent(l.slug) + '" data-act="league" data-v="' + esc(l.slug) + '" translate="no">' + esc(l.name) + '</a></th><td translate="no">' + l.n + '</td><td translate="no">' + sg(l.home.v) + ' <small>' + rng(l.home.lo, l.home.hi, f1) + '</small></td><td>' +
          esc((l.top || []).map(k => label(W, k)).join(', ')) + '</td></tr>').join('') + '</tbody></table></div>';
      return { state: 'ok', html, charts };
    }
    const C = W.models.core4c;
    if (!C.coef.some(c => c.own)) return { state: 'ok', html: '<p class="ww-lead">' + chip('explain', C.n) + '</p>' + empty('Under 200 games this league leans on every league’s answer; its own estimate is shown from 200'), charts };
    let html = '<p class="ww-lead">' + chip('explain', C.n) + ' <span class="ww-legend"><i class="ww-k-hollow"></i>leaning on every league <i class="ww-k-ghost"></i>its own data alone</span></p>';
    html += chartSlot({ kind: 'forest', label: 'This league’s own answer against the shrunk one', data: C.coef.map(c => ({ id: c.k, label: label(W, c.k), v: c.b, lo: c.lo, hi: c.hi, shrunk: true, own: c.own, badge: pc(c.w) + '% pooled' })),
      o: { x: { label: 'points of margin per unit' }, title: 'Own against shrunk', desc: 'The league’s own coefficients beside the ones shrunk toward every league' } }, charts);
    return { state: 'ok', html, charts };
  },

  model(ctx) {
    const W = ctx.W, charts = [];
    if (!W) return locked(5);
    const P = W.predictive;
    let html = '';
    if (P && P.metrics) {
      html += '<p class="ww-lead">' + chip('forecast', P.nEval) + '</p>';
      html += '<p class="ww-hard">' + esc(P.live ? 'The season’s numbers forecast better than home court and Elo here' : 'Season numbers do not forecast better than Elo here') + '</p>';
      const B = P.baselines || {};
      html += chartSlot({ kind: 'reliability', label: 'Forecasts against results', data: { series: [{ k: 'model', label: 'season numbers', bins: P.metrics.bins }].concat(B.elo ? [{ k: 'elo', label: 'Elo', bins: B.elo.bins }] : [], B.home ? [{ k: 'home', label: 'home only', bins: B.home.bins }] : []) },
        o: { title: 'Forecasts against results', desc: 'Forecast chance against the share actually won, by tenth of the forecasts' } }, charts);
      const row = (t, c) => c ? '<tr><th scope="row">' + esc(t) + '</th><td translate="no">' + (isNum(c.brier) ? c.brier.toFixed(3) : '–') + '</td><td translate="no">' + (isNum(c.logloss) ? c.logloss.toFixed(3) : '–') + '</td><td translate="no">' +
        (isNum(c.ece) ? c.ece.toFixed(3) : '–') + '</td><td translate="no">' + (isNum(c.auc) ? c.auc.toFixed(3) : '–') + '</td><td translate="no">' + f2(c.slope) + '</td></tr>' : '';
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Forecast</th><th scope="col">Brier</th><th scope="col">Log loss</th><th scope="col">ECE</th><th scope="col">AUC</th><th scope="col">Slope</th></tr></thead><tbody>' +
        row('Season numbers', P.metrics) + row('Home only', B.home) + row('Elo', B.elo) + row('Net rating', B.net) + row('Pythagorean', B.pyth) + (P.sim ? row('Simulator', P.sim) : '') + '</tbody></table></div>';
      html += '<p class="ww-note">Lower Brier and log loss are better; a slope of 1 means the forecasts are as confident as they should be.</p>';
    }
    if (P && P.sim && P.sim.checks) {
      const ck = P.sim.checks, names = { pace: 'Pace', ortg: 'Offensive rating', efg: 'eFG%', tovp: 'TOV%', orebp: 'OREB%', ftr: 'FT attempt rate (FTA/FGA)', marginSd: 'Margin spread', close5: 'Decided by 5 or fewer', ot: 'Overtime', home: 'Home win share' };
      const share = k => k === 'close5' || k === 'ot' || k === 'home';
      html += '<h3 class="ww-h3">The simulator against the games</h3><p class="ww-lead">' + chip('model', null, P.sim.calibrated ? 'calibrated' : 'experimental') + '</p><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Check</th><th scope="col">Observed</th><th scope="col">Simulated</th></tr></thead><tbody>' +
        Object.keys(ck).map(k => '<tr><th scope="row">' + esc(names[k] || k) + '</th><td translate="no">' + (share(k) ? pc(ck[k].obs) + '%' : f1(ck[k].obs)) + '</td><td translate="no">' + (share(k) ? pc(ck[k].sim) + '%' : f1(ck[k].sim)) + '</td></tr>').join('') + '</tbody></table></div>';
      /* the checks and the gate are out of sample (rolling origin); the in-sample score is only shown beside them */
      if (P.sim.heldOut) html += '<p class="ww-note">Each game is simulated with the league’s parameters fitted only on the games played before it, as the forecasts are.</p>';
      if (P.sim.inSample && isNum(P.sim.inSample.brier)) html += '<p class="ww-note">' + esc('Fitted on the same games it scores, the simulator’s Brier would be ' + P.sim.inSample.brier.toFixed(3) + ': shown for comparison, never used for the gate') + '</p>';
    }
    if (P && P.transfer && P.transfer.length) {
      const nm = id => ((W.leagues || []).find(l => l.id === id) || {}).name || id.slice(0, 8);
      html += '<h3 class="ww-h3">Carrying the answer to another league</h3>' + chartSlot({ kind: 'bars', label: 'Brier score of each league predicted from the others', data: P.transfer.map(t => ({ id: t.id, label: nm(t.id), v: t.brier, dir: -1, cls: 'vz-s1f', detail: t.n + ' games' })),
        o: { x: { label: 'Brier score (lower is better)', lo: 0, hi: 0.3 }, title: 'League-out transfer', desc: 'Each league predicted from a fit on the others' } }, charts);
    }
    const Q = W.quality;
    if (Q) {
      const flags = [['zones', 'Shot locations'], ['timed', 'Timed possessions'], ['sit', 'Situations'], ['stype', 'Turnover types'], ['foulkind', 'Foul kinds'], ['stl', 'Steals logged'], ['listed', 'Listed positions'], ['heights', 'Heights']];
      html += '<h3 class="ww-h3">What the feeds carry</h3><ul class="ww-flags">' + flags.filter(([k]) => isNum(Q[k])).map(([k, t]) => '<li class="' + (Q[k] >= 0.8 ? 'ww-ok' : Q[k] >= 0.5 ? 'ww-part' : 'ww-no') + '"><span class="ww-flagv" translate="no">' +
        pc(Q[k]) + '%</span> ' + esc(t) + '</li>').join('') + '</ul><p class="ww-note">Share of games with each; a measure that needs one is left out of a game without it.</p>';
    }
    return { state: html ? 'ok' : 'empty', html: html || empty('The checks appear after the first full build'), charts };
  }
};
const GROUPCLS = { G: 'vz-s1f', F: 'vz-s2f', C: 'vz-s3f' };
const simKey = (st, t1, t2) => [t1, t2, st.venue, JSON.stringify(st.dials)].join('|');

/* ============================================================================================ THE BROWSER === */
function boot() {
  const doc = root.document, $ = id => doc.getElementById(id);
  const D = () => root.EpinoiaData, WF = () => root.EpinoiaWinFile, V = () => root.EpinoiaVizKit, Sim = () => root.EpinoiaWinSim;
  try { root.localStorage.removeItem(LEGACY); } catch (_) { /* storage blocked: nothing kept there either */ }

  /* the Worker, built from this script's own ?v= so a deploy never mixes versions */
  const myV = (() => { const s = doc.currentScript || [...doc.scripts].find(x => /winning\/page\.js/.test(x.src)); const m = /[?&]v=([^&#]+)/.exec((s && s.src) || ''); return m ? m[1] : ''; })();
  const Work = (() => {
    let w = null, seq = 0;
    const jobs = new Map();
    function worker() {
      if (w === false) return null;
      if (!w) {
        try {
          w = new root.Worker('../winsim.worker.js?v=' + myV);
          w.onmessage = e => { const m = e.data || {}, j = jobs.get(m.id); if (!j) return; if (m.progress != null) { if (j.onProgress) j.onProgress(m.progress); return; }
            jobs.delete(m.id); if (m.ok) j.resolve(m.result); else j.reject(new Error(m.error || 'failed')); };
          w.onerror = () => { const all = [...jobs.values()]; jobs.clear(); w = false; all.forEach(j => j.fallback()); };
        } catch (_) { w = false; return null; }
      }
      return w;
    }
    /* no Worker: the same call on the main thread, n / 5, in idle slices */
    function local(op, args, o) {
      const a = Object.assign({}, args);
      if (a.n) a.n = Math.max(200, Math.round(a.n / 5));
      if (a.B) a.B = Math.max(40, Math.round(a.B / 5));
      const idle = fn => (root.requestIdleCallback ? root.requestIdleCallback(fn, { timeout: 60 }) : root.setTimeout(fn, 0));
      return Sim().drive(Sim().steps(op, a), { slice: 12, onProgress: o.onProgress, cancelled: () => !!(o.signal && o.signal.aborted), defer: idle });
    }
    function run(op, args, o) {
      o = o || {};
      const ww = worker();
      if (!ww) return local(op, args, o);
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const j = { resolve, reject, onProgress: o.onProgress, fallback: () => local(op, args, o).then(resolve, reject) };
        jobs.set(id, j);
        if (o.signal) o.signal.addEventListener('abort', () => { if (jobs.has(id)) { ww.postMessage({ id, op: 'cancel' }); jobs.delete(id); reject(new Error('cancelled')); } }, { once: true });
        ww.postMessage({ id, op, args });
      });
    }
    return { run };
  })();

  /* ---- the page's state, and the address ---- */
  const q = new URLSearchParams(root.location.search);
  const st = { lens: q.get('lens') === 'forecast' ? 'forecast' : 'explain', unit: 'pts', k: q.get('k') || '', t1: q.get('t1') || '', t2: q.get('t2') || '', venue: 1,
    dials: { A: {}, B: {} }, picks: null, fview: 'bars', sortKey: 'r', sortDir: -1, posG: 'G', club: '', brushed: null, refit: null, simState: 'idle', simResult: null,
    posSet: 'grp', posOut: 'net', posS: '', gap: null, gapK: '', mix: null };
  const ctx = { W: null, ans: null, fo: null, foState: 'idle', club: null, clubState: 'idle', mix: null, mixState: 'idle', mixMessage: '', teaser: null, reason: null, pooledFallback: false, message: '', gateNote: '', st };
  let leagues = [], league = null, seasons = [], seasonId = q.get('s') || '';
  const want = q.get('l') || '';
  const binds = new Map();
  const address = () => {
    const u = new URL(root.location.href), p = u.searchParams;
    const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
    set('l', league ? league.slug : ''); set('s', seasonId); set('lens', st.lens === 'forecast' ? 'forecast' : ''); set('k', st.k); set('t1', st.t1); set('t2', st.t2);
    root.history.replaceState(null, '', u);
  };

  /* ---- drawing a section ---- */
  /* the control that had focus, as a selector for the same control after a redraw (its id, or its data-act with
     data-v / data-side / data-key), so a keyboard user's place survives a section being drawn again */
  const cssEsc = v => (root.CSS && root.CSS.escape ? root.CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
  function focusKey(el, host) {
    if (!el || !host || el === host || !host.contains(el)) return null;
    if (el.id) return '#' + cssEsc(el.id);
    const a = el.getAttribute && el.getAttribute('data-act');
    if (!a) return null;
    let q = '[data-act="' + cssEsc(a) + '"]';
    ['data-v', 'data-side', 'data-key'].forEach(k => { const v = el.getAttribute(k); if (v != null) q += '[' + k + '="' + cssEsc(v) + '"]'; });
    return q;
  }
  const PARTS = { sim: ['simR'] };
  function render(host, out, key) {
    const fk = focusKey(doc.activeElement, host);
    host.innerHTML = out.html;
    host.removeAttribute('aria-busy');
    if (fk) { const el = host.querySelector(fk); if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } } }
    bindCharts(host, out, key);
  }
  function mount(id) {
    const host = id === 'answer' ? $('wwCards') : $(id + 'B');
    if (!host || !views[id]) return;
    dirty.delete(id);
    [id].concat(PARTS[id] || []).forEach(k => { (binds.get(k) || []).forEach(b => b.destroy()); binds.set(k, []); });
    let out;
    try { out = views[id](ctx); } catch (e) { out = { state: 'empty', html: '<div class="pg-empty"><p>This part could not be drawn.</p></div>', charts: [] }; if (root.console) root.console.warn('[winning]', id, e); }
    render(host, out, id);
  }
  /* #sim's result part alone: the controls (a slider mid-drag, a select) are never replaced by a simulation */
  function mountSimResult() {
    const part = $('simB') && $('simB').querySelector('[data-part="simR"]');
    if (!part) { mount('sim'); return; }
    (binds.get('simR') || []).forEach(b => b.destroy()); binds.set('simR', []);
    let out;
    try { out = views.simResult(ctx); } catch (e) { out = { state: 'empty', html: '<div class="pg-empty"><p>This part could not be drawn.</p></div>', charts: [] }; }
    render(part, out, 'simR');
  }
  function bindCharts(host, out, id) {
    host.querySelectorAll('[data-memlock]').forEach(ph => {
      const rows = +ph.getAttribute('data-memlock') || 5;
      /* a refusal that is not about entitlement (rate, layout, network, none) is said plainly, never as a membership pitch */
      if (!ctx.lockedNow && ctx.reason && ['members', 'signin', 'league'].indexOf(ctx.reason) < 0) { ph.innerHTML = '<div class="pg-empty"><p></p></div>'; ph.querySelector('p').textContent = ctx.message || MSG.network; return; }
      if (ctx.reason === 'signin') { ph.innerHTML = '<div class="pg-empty"><p>Members’ analysis. <a href="' + esc(signinHref()) + '">Sign in</a> to see it.</p></div>'; return; }
      const M = root.EpinoiaMemLock, node = M && M.placeholder ? M.placeholder({ rows, what: 'What wins model', key: 'model', leagueSlug: league ? league.slug : undefined }) : null;
      if (node) ph.replaceWith(node); else ph.innerHTML = '<div class="pg-empty"><p>Members’ analysis.</p></div>';
    });
    const VK = V();
    host.querySelectorAll('[data-chart]').forEach(slot => {
      const spec = out.charts[+slot.getAttribute('data-chart')];
      if (!spec || !VK || !VK[spec.kind]) return;
      const pt = slot.closest('[data-part]'), bk = pt && host.contains(pt) && pt !== host ? pt.getAttribute('data-part') : id;
      if (!binds.has(bk)) binds.set(bk, []);
      const opts = { label: spec.label };
      if (spec.pick === 'curves') opts.onPick = h => { if (ctx.W && ctx.W.curves && ctx.W.curves[h.id]) { st.k = h.id; address(); mount('curves'); const s = $('curves'); if (s) s.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } };
      if (spec.kind === 'scatter' && spec.brush) opts.onBrush = ids => { st.brushed = ids && ids.length ? ids : null; mount(id); };
      const b = VK.bind(slot, o => VK[spec.kind](spec.data, Object.assign({}, spec.o, { W: o.W, id: bk + slot.getAttribute('data-chart') })), opts);
      binds.get(bk).push(b);
      /* a chart a control moves without drawing its section again (A.3: the curve's mark under "move the gap") */
      if (spec.live) live.set(spec.live, { spec, bind: b });
    });
  }
  /* drawing every section at once is one long task (23 charts, a forced layout each): the first two now, the rest as
     they come near the viewport, and any still waiting in idle time one at a time */
  const dirty = new Set();
  const live = new Map();
  let lazyObs = null;
  const idle = fn => (root.requestIdleCallback ? root.requestIdleCallback(fn, { timeout: 1500 }) : root.setTimeout(fn, 60));
  function drainIdle() { idle(() => { const next = SECTIONS.find(s => dirty.has(s)); if (!next) return; mount(next); drainIdle(); }); }
  function drawAll() {
    const ids = SECTIONS.filter(s => s !== 'method');
    ids.forEach(s => dirty.add(s));
    ids.slice(0, 2).forEach(mount);
    if (!root.IntersectionObserver) { ids.forEach(s => { if (dirty.has(s)) mount(s); }); return; }
    if (lazyObs) lazyObs.disconnect();
    lazyObs = new root.IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && dirty.has(e.target.id)) mount(e.target.id); }), { rootMargin: '600px 0px' });
    ids.slice(2).forEach(s => { const el = $(s); if (el) lazyObs.observe(el); });
    drainIdle();
  }
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const signinHref = () => { const A = root.EpinoiaAccess; try { return A && A.signinHref ? A.signinHref(root.location.pathname + root.location.search) : '../signin/'; } catch (_) { return '../signin/'; } };

  /* ---- the status line, the banner, #method's date ---- */
  function status() {
    const s = statusLine(ctx.ans, ctx.W), line = $('wwLine'), btn = $('wwRecalc');
    line.textContent = ctx.W ? s.line : (ctx.teaser ? 'Box-score preview of ' + ctx.teaser.n + ' games' : ctx.message || '');
    /* held off after a refusal or a no-op answer (rate, recent, queued) until its retry time has passed */
    const wait = holdUntil - Date.now();
    btn.disabled = !s.canRecalc || wait > 0;
    root.clearTimeout(holdT);
    if (wait > 0) holdT = root.setTimeout(status, Math.min(wait + 50, 2147483647));
    btn.classList.toggle('hide', !ctx.W || !ctx.W.league);
    btn.textContent = s.upToDate ? 'Up to date' : 'Recalculate';
    const ban = $('wwBanner'), built = Date.parse((ctx.ans && ctx.ans.built) || (ctx.W && ctx.W.built) || '');
    const stale = ctx.W && isFinite(built) && Date.now() - built > 48 * 3600e3 && ctx.ans && ctx.ans.pending > 0;
    ban.classList.toggle('hide', !stale);
    if (stale) ban.textContent = 'This model was built ' + new Date(built).toISOString().slice(0, 16).replace('T', ' ') + ' UTC; newer games have finished since';
    const asof = $('wwAsof'), F = ctx.W || ctx.teaser;
    if (F && F.box) asof.textContent = 'Read from the public box scores; the full model switches on once it has been built';
    else if (F) asof.textContent = 'Model ' + F.token + ' · built ' + String(F.built || '').slice(0, 16).replace('T', ' ') + ' UTC';
  }

  /* ---- reading a file ---- */
  const MSG = { layout: 'The model is being rebuilt; back within the hour', network: 'The model could not be reached just now', scope: 'This file cannot be asked for',
    league: 'This league’s analysis is not open to you', unbuilt: 'The full model switches on once it has been built' };
  const rateMsg = s => 'Too many requests: try again in ' + Math.max(1, Math.ceil((s || 60) / 60)) + ' minutes';
  /* the box-score preview (boxpreview.js), loaded at this script's own ?v= the first time it is needed */
  let boxLoad = null;
  const userKey = () => { try { const A = root.EpinoiaAccess, s = A && typeof A.session === 'function' ? A.session() : null; return s && s.token ? String(s.userId || 'user') : 'anon'; } catch (_) { return 'anon'; } };
  function loadBox() {
    if (root.EpinoiaWinBox) return Promise.resolve(true);
    if (!boxLoad) boxLoad = new Promise(res => { const s = doc.createElement('script'); s.src = 'boxpreview.js' + (myV ? '?v=' + myV : ''); s.onload = () => res(!!root.EpinoiaWinBox); s.onerror = () => { boxLoad = null; res(false); }; doc.head.appendChild(s); });
    return boxLoad;
  }
  async function boxPreview() {
    const T = root.EpinoiaWinning;
    if (!T || !T.SELECT || !D() || !(await loadBox())) return null;
    const line = $('wwLine');
    try {
      line.textContent = 'Reading the box scores…';
      const rows = await root.EpinoiaWinBox.read(D(), T, { user: userKey(), onProgress: p => { line.textContent = 'Reading the box scores: ' + Math.round(100 * p) + '%'; } });
      return root.EpinoiaWinBox.preview(T, rows, league ? league.slug : '');
    } catch (e) { if (root.console) root.console.warn('[winning] box scores', e); return null; }
  }
  let loadSeq = 0;
  async function load(force) {
    const seq = ++loadSeq;
    ctx.gateNote = '';
    ctx.W = null; ctx.ans = null; ctx.fo = null; ctx.foState = 'idle'; ctx.club = null; ctx.clubState = 'idle'; ctx.teaser = null; ctx.reason = null; ctx.lockedNow = false; ctx.pooledFallback = false; ctx.fallbackWhy = ''; ctx.message = '';
    ctx.mix = null; ctx.mixState = 'idle'; ctx.mixMessage = '';
    st.simResult = null; st.refit = null;
    $('wwCards').setAttribute('aria-busy', 'true');
    $('wwLine').textContent = 'Loading the model…';
    const A = root.EpinoiaAccess, M = root.EpinoiaMemLock;
    try { if (A && A.load) await A.load(league ? { leagueId: league.id } : {}); } catch (_) { /* fails open */ }
    /* the first drawing only (the database decides on the request): the catalogue's 'model' lock, or, before
       access.js lists it, the analytics entitlement it rides on; both fail open */
    const lid = league ? league.id : undefined;
    let lockedNow = !!(M && M.locked && M.locked('model', lid));
    try { if (!lockedNow && A && A.CATALOGUE && A.CATALOGUE.locks && !A.CATALOGUE.locks.model && A.analyticsOk) lockedNow = A.analyticsOk(lid) === false; } catch (_) { /* fails open */ }
    ctx.lockedNow = lockedNow;
    let ans = null;
    if (!lockedNow) {
      ans = await WF().get(league ? { scope: 'wins', league: league.id, season: seasonId || undefined } : { scope: 'wins' }, { force: !!force });
      if (!ans.ok && ans.reason === 'none' && league) {
        ctx.pooledFallback = true; ctx.fallbackWhy = 'none';
        ans = await WF().get({ scope: 'wins' });
      } else if (ans.ok && league && ans.data && ans.data.n && ans.data.n.games < 20) {
        ctx.pooledFallback = true; ctx.fallbackWhy = 'few';
        ans = await WF().get({ scope: 'wins' });
      }
    }
    if (seq !== loadSeq) return;                                                   // a newer league or season asked meanwhile
    if (ans && ans.ok) { ctx.ans = ans; ctx.W = ans.data; }
    else {
      ctx.reason = ans ? ans.reason : 'members';
      const gated = lockedNow || ['members', 'signin', 'jwt', 'league'].indexOf(ctx.reason) >= 0;
      if (ctx.reason === 'jwt') ctx.reason = 'signin';
      /* the public part: the teaser; until the builder has published one (none, network, layout), the box-score
         preview the page drew before the model (boxpreview.js, loaded only then) */
      const t = await WF().get({ scope: 'teaser' });
      if (seq !== loadSeq) return;
      if (t.ok) ctx.teaser = t.data;
      else if (t.reason !== 'aborted') { ctx.teaser = await boxPreview(); if (seq !== loadSeq) return; }
      /* nothing built yet (the function or the public index says none): said plainly, never "could not be reached" */
      const unbuilt = ctx.reason === 'none' || (!t.ok && t.reason === 'none');
      if (unbuilt && !gated) ctx.reason = 'none';
      if (ctx.reason === 'rate') ctx.message = rateMsg(ans.retryAfter);
      else if (ctx.reason === 'none') ctx.message = MSG.unbuilt;
      else ctx.message = MSG[ctx.reason] || '';
      if (gated) {
        ctx.gateNote = '<p class="ww-gate">' + (ctx.reason === 'signin' ? 'The full model is for signed-in readers: ' : 'The full model is for members: ') + '<a href="' +
          esc(ctx.reason === 'signin' ? signinHref() : ((A && A.joinHref) ? A.joinHref({ leagueSlug: league ? league.slug : undefined }) : '../join/')) + '">' + (ctx.reason === 'signin' ? 'sign in' : 'become a member') + '</a></p>';
      } else if (ctx.teaser && ctx.message) ctx.gateNote = '<p class="ww-gate">' + esc(ctx.message) + '</p>';
    }
    if (ctx.W && st.k === '' && ctx.W.curves) st.k = Object.keys(ctx.W.curves)[0] || '';
    status();
    drawAll();
    observeSim();
    observeMix();
  }

  /* ---- the lineup mixes: the mix file when #mixes comes near (A.3), never on load ---- */
  let mixObs = null;
  function observeMix() {
    if (mixObs) mixObs.disconnect();
    if (!ctx.W || !ctx.W.league || ctx.mixState !== 'idle' || !root.IntersectionObserver) return;
    mixObs = new root.IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { mixObs.disconnect(); loadMix(); } }, { rootMargin: '200px' });
    mixObs.observe($('mixes'));
  }
  async function loadMix() {
    if (!ctx.W || !ctx.W.league || ctx.mixState === 'loading' || ctx.mixState === 'ok') return;
    ctx.mixState = 'loading'; mount('mixes');
    const want = ctx.W;
    const a = await WF().get({ scope: 'mix', league: want.league.id, season: want.season ? want.season.id : undefined });
    if (ctx.W !== want) return;                                                  // another league or season meanwhile
    const X = root.EpinoiaWinMix;
    if (a.ok && X) { try { ctx.mix = X.decode(a.data); ctx.mixState = ctx.mix ? 'ok' : 'error'; } catch (_) { ctx.mixState = 'error'; } }
    else ctx.mixState = 'error';
    if (ctx.mixState !== 'ok') ctx.mixMessage = a.reason === 'rate' ? rateMsg(a.retryAfter) : (a.ok || a.reason === 'none' || a.reason === 'scope') ? 'The lineup builder’s file is built with the next model run' : MSG[a.reason] || 'The lineups could not be loaded';
    mount('mixes');
  }
  let mixT = 0;
  const queueMix = ms => { root.clearTimeout(mixT); mixT = root.setTimeout(() => mount('mixes'), ms || 0); };

  /* ---- move the gap (A.3): the curve's mark and the readout follow the slider, the section is not drawn again ---- */
  let gapRaf = 0;
  function moveGap(x, from) {
    const W = ctx.W, k = W && W.curves && W.curves[st.k] ? st.k : (W && W.curves ? Object.keys(W.curves)[0] : null);
    if (!k || !isNum(x)) return;
    const c = W.curves[k], G = gapRange(c);
    if (!G) return;
    const v = Math.min(G.hi, Math.max(G.lo, x));
    st.gap = v; st.gapK = k;
    const rg = $('wwGap'), nb = $('wwGapN');
    if (rg && from !== 'gap') rg.value = String(v);
    if (nb && from !== 'gapn') nb.value = String(v);
    const at = gapAt(c, v);
    root.cancelAnimationFrame && root.cancelAnimationFrame(gapRaf);
    const paint = () => {
      const L = live.get('gap');
      if (L) { L.spec.data.mark = at; try { L.bind.redraw(); } catch (_) { /* redrawn with the section */ } }
      const out = $('wwGapOut');
      if (out) { out.textContent = ''; gapText(W, k, c, at).forEach((t, i) => { if (i) out.appendChild(doc.createTextNode(' ')); const sp = doc.createElement('span'); sp.textContent = t; out.appendChild(sp); }); }
    };
    if (root.requestAnimationFrame) gapRaf = root.requestAnimationFrame(paint); else paint();
  }

  /* ---- the simulator: the fo file when #sim opens ---- */
  let simObs = null;
  function observeSim() {
    if (simObs) simObs.disconnect();
    if (!ctx.W || !ctx.W.league || ctx.foState !== 'idle') return;
    if (!root.IntersectionObserver) return;
    simObs = new root.IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { simObs.disconnect(); loadFo(); } }, { rootMargin: '200px' });
    simObs.observe($('sim'));
  }
  async function loadFo() {
    if (!ctx.W || !ctx.W.league || ctx.foState === 'loading' || ctx.foState === 'ok') return;
    ctx.foState = 'loading'; mount('sim');
    const a = await WF().get({ scope: 'fo', league: ctx.W.league.id, season: ctx.W.season ? ctx.W.season.id : undefined });
    if (a.ok) { ctx.fo = a.data; ctx.foState = 'ok'; }
    else { ctx.foState = 'error'; ctx.foMessage = a.reason === 'rate' ? rateMsg(a.retryAfter) : a.reason === 'none' ? 'The simulator’s file is built with the next model run' : MSG[a.reason] || 'The simulator could not be loaded'; }
    mount('sim');
    if (ctx.foState === 'ok') simulate();
  }
  let simAbort = null, simT = 0;
  function simulate() {
    const fo = ctx.fo; if (!fo) return;
    const S = Sim(), teams = fo.teams;
    const t1 = teams.some(t => t.id === st.t1) ? st.t1 : teams[0].id, t2 = teams.some(t => t.id === st.t2 && t.id !== t1) ? st.t2 : teams.find(t => t.id !== t1).id;
    const A = teams.find(t => t.id === t1), B = teams.find(t => t.id === t2);
    const L = fo.lg, platt = simPlatt(fo);
    const edits = side => DIALS.map(d => ({ end: 'off', key: d.key, delta: (st.dials[side] || {})[d.key] || 0 })).filter(e => e.delta);
    const pa = S.applyEdits(A.prof, edits('A'), L), pb = S.applyEdits(B.prof, edits('B'), L);
    const M = S.matchup(pa, pb, L, { home: +st.venue, platt });
    if (simAbort) simAbort.abort();
    const ab = simAbort = new root.AbortController();
    st.simState = 'running'; mountSimResult();
    const key = simKey(st, t1, t2);
    Work.run('simulate', { M, n: 5000, seed: 1 }, { signal: ab.signal }).then(async r => {
      if (ab.signal.aborted) return;
      const tor = [];
      for (const d of DIALS) {
        const cur = (st.dials.A || {})[d.key] || 0;
        const at = async v => { const e = edits('A').filter(x => x.key !== d.key).concat(v ? [{ end: 'off', key: d.key, delta: v }] : []);
          const m2 = S.matchup(S.applyEdits(A.prof, e, L), pb, L, { home: +st.venue, platt }); return (await Work.run('simulate', { M: m2, n: 1500, seed: 1 }, { signal: ab.signal })).pWin; };
        const lo = await at(d.min), hi = await at(d.max);
        if (ab.signal.aborted) return;
        tor.push({ id: d.key, label: d.label, lo: Math.min(lo, hi), hi: Math.max(lo, hi), loLabel: (lo <= hi ? sg(d.min, 0) : sg(d.max, 0)) + ' ' + d.unit, hiLabel: (lo <= hi ? sg(d.max, 0) : sg(d.min, 0)) + ' ' + d.unit });
        void cur;
      }
      st.simResult = Object.assign({ key, tornado: tor }, r);
      st.simState = 'done'; mountSimResult();
    }).catch(e => { if (ab.signal.aborted) return; st.simState = 'error'; st.simError = String(e && e.message || e); mountSimResult(); });
  }

  /* ---- the re-fit (Worker) ---- */
  function refit() {
    const W = ctx.W; if (!W || !W.blocks) return;
    const picks = (st.picks || coreOf(W).slice()).filter(k => W.blocks.keys.indexOf(k) >= 0);
    const cols = ['h'].concat(picks);
    const scale = W.blocks.scale.slice(); scale[W.blocks.keys.indexOf('h')] = 0;        // home court unpenalised
    st.refit = { state: 'running' }; mount('value');
    return Work.run('refit', { blocks: W.blocks.list, keys: W.blocks.keys, cols, lambda: W.blocks.lambda, scale, B: 200, seed: 1 })
      .then(r => { st.refit = { state: 'done', result: { keys: cols, b: r.b, lo: r.lo, hi: r.hi } }; mount('value'); })
      .catch(e => { st.refit = { state: 'error', error: String(e && e.message || e) }; mount('value'); });
  }

  /* ---- RECALCULATE (A.2): the staged bar ---- */
  let holdUntil = 0, holdT = 0;
  const hold = sec => { holdUntil = Math.max(holdUntil, Date.now() + 1000 * Math.max(1, sec || 0)); };
  const STAGES = ['check', 'update', 'download', 'sim', 'draw'];
  const blocks = $('wwBlocks');
  for (let i = 0; i < 24; i++) blocks.appendChild(doc.createElement('i'));
  let recalcAbort = null;
  function stage(name, frac, text) {
    const prog = $('wwProg'), i = STAGES.indexOf(name);
    const pct = Math.round(100 * Math.min(1, (Math.max(0, i) + Math.max(0, Math.min(1, frac || 0))) / STAGES.length));
    prog.setAttribute('aria-valuenow', String(pct));
    prog.setAttribute('aria-valuetext', text || '');
    const all = i === STAGES.length - 1 && frac >= 1;
    $('wwStages').querySelectorAll('li').forEach((li, k) => { li.classList.toggle('on', k === i && !all); li.classList.toggle('done', k < i || all); });
    blocks.querySelectorAll('i').forEach((b, k) => b.classList.toggle('on', k < Math.round(24 * pct / 100)));
    if (text != null) $('wwProgL').textContent = text;
  }
  function say(msg) { const m = $('wwMsg'); m.textContent = msg || ''; m.classList.toggle('hide', !msg); }
  async function recalc() {
    const W = ctx.W; if (!W || !W.league) return;
    const ab = recalcAbort = new root.AbortController();
    $('wwProg').classList.remove('hide'); $('wwCancel').classList.remove('hide'); $('wwRecalc').disabled = true; say('');
    stage('check', 0, 'Checking what has changed');
    let a;
    try {
      a = await WF().refresh({ league: W.league.id, season: seasonId || undefined }, { signal: ab.signal, onProgress: p => {
        if (p.stage === 'update') stage('update', 0.3, 'Updating the model on the server');
        if (p.stage === 'download') stage('download', p.total ? p.loaded / p.total : 0.5, 'Downloading the new file' + (p.loaded ? ' (' + Math.round(p.loaded / 1024) + ' KB)' : ''));
      } });
    } catch (_) { a = { ok: false, reason: 'network' }; }
    if (!a.ok) {
      if (a.reason === 'rate') hold(a.retryAfter || 60);
      finish();
      if (a.reason === 'aborted') return say('Cancelled: anything the server had started still finishes, and is reused next time');
      if (a.reason === 'rate') return say(rateMsg(a.retryAfter));
      if (a.reason === 'signin' || a.reason === 'jwt') return say('Sign in to recalculate');
      if (a.reason === 'members') return say('Recalculating is for members');
      return say(MSG[a.reason] || 'The model could not be reached just now');
    }
    const before = W.n.games;
    /* nothing was updated (queued for the scheduled build, too many games, or updated moments ago): the bar stops at
       the server's step and says why; no download, no re-simulating, no "Done"; the button waits out the retry time */
    if (a.queued || a.refreshReason === 'recent' || a.refreshReason === 'cap') {
      if (a.data && a.token !== (ctx.ans && ctx.ans.token)) { ctx.ans = a; ctx.W = a.data; }
      else if (ctx.ans) ctx.ans = Object.assign({}, ctx.ans, { pending: a.pending != null ? a.pending : ctx.ans.pending });
      hold(a.retryAfter || (a.refreshReason === 'recent' ? 600 : 120));
      $('wwProg').classList.add('hide');
      finish();
      return say(a.refreshReason === 'cap' ? 'Too many new games for a quick update: a full rebuild is scheduled'
        : a.refreshReason === 'recent' ? 'Updated a few minutes ago: try again shortly' : 'The update is queued: the next scheduled build picks these games up first');
    }
    ctx.ans = a; ctx.W = a.data;
    stage('sim', 0, 'Re-simulating');
    if (ctx.W.blocks && ctx.W.blocks.list && ctx.W.blocks.list.length) {
      try {
        const picks = (st.picks || coreOf(ctx.W).slice()).filter(k => ctx.W.blocks.keys.indexOf(k) >= 0), cols = ['h'].concat(picks);
        const scale = ctx.W.blocks.scale.slice(); scale[ctx.W.blocks.keys.indexOf('h')] = 0;
        const r = await Work.run('refit', { blocks: ctx.W.blocks.list, keys: ctx.W.blocks.keys, cols, lambda: ctx.W.blocks.lambda, scale, B: 200, seed: 1 },
          { signal: ab.signal, onProgress: p => stage('sim', p, 'Re-simulating: ' + Math.round(100 * p) + '%') });
        st.refit = { state: 'done', result: { keys: cols, b: r.b, lo: r.lo, hi: r.hi } };
      } catch (e) { if (ab.signal.aborted) { finish(); return say('Cancelled: anything the server had started still finishes, and is reused next time'); } }
    }
    stage('draw', 0.5, 'Drawing');
    ctx.fo = null; ctx.foState = 'idle'; st.simResult = null;
    ctx.mix = null; ctx.mixState = 'idle';
    status(); drawAll(); observeSim(); observeMix();
    stage('draw', 1, 'Done');
    finish();
    const added = ctx.W.n.games - before;
    if (a.joined) say('Joined an update already running' + (added > 0 ? ': ' + added + ' new games added' : ''));
    else if (a.refreshed) say(added > 0 ? 'Recalculated with ' + added + ' new games' : 'Recalculated');
    else say('Up to date');
  }
  function finish() {
    recalcAbort = null;
    $('wwCancel').classList.add('hide');
    root.setTimeout(() => { if (!recalcAbort) $('wwProg').classList.add('hide'); }, reduced() ? 0 : 1200);
    status();
  }
  $('wwRecalc').addEventListener('click', recalc);
  $('wwCancel').addEventListener('click', () => { if (recalcAbort) recalcAbort.abort(); });

  /* ---- one handler for every control the views draw ---- */
  const frame = $('ww');
  frame.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    const sec = b.closest('.sec'), sid = sec ? sec.id : '';
    if (act === 'league') { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); pickLeague(v); root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
    if (act === 'lens') { st.lens = v; address(); }
    else if (act === 'unit') st.unit = v;
    else if (act === 'fview') st.fview = v;
    else if (act === 'sort') { if (st.sortKey === v) st.sortDir = -st.sortDir; else { st.sortKey = v; st.sortDir = v === 'k' ? 1 : -1; } }
    else if (act === 'posG') st.posG = v;
    else if (act === 'posSet') { st.posSet = v; st.posS = ''; }
    else if (act === 'posOut') st.posOut = v;
    else if (act === 'posS') st.posS = v;
    else if (act === 'loadmix') { loadMix(); return; }
    else if (act === 'venue') { st.venue = +v; mount(sid); queueSim(); return; }
    else if (act === 'refit') { refit(); return; }
    else if (act === 'loadsim') { loadFo(); return; }
    else if (act === 'dialreset') { st.dials = { A: {}, B: {} }; mount(sid); queueSim(); return; }
    else return;
    mount(sid);
    const again = $(sid) && $(sid).querySelector('[data-act="' + act + '"][data-v="' + v + '"]');
    if (again) again.focus();
  });
  frame.addEventListener('change', e => {
    const t = e.target, act = t.getAttribute && t.getAttribute('data-act');
    if (!act) return;
    const sid = t.closest('.sec').id;
    if (act === 'k') { st.k = t.value; address(); mount('curves'); }
    else if (act === 'pick') { st.picks = [...$('value').querySelectorAll('input[data-act="pick"]:checked')].map(x => x.value); }
    else if (act === 't1' || act === 't2') { st[act] = t.value; address(); mount(sid); queueSim(); }
    else if (act === 'club') { st.club = t.value; loadClub(); }
    else if (act === 'gapn') moveGap(parseFloat(t.value), 'gapn');
    else if (/^mix/.test(act)) mixChange(t, act);
  });
  /* a lineup-mix control: the state, then the section (a typed threshold waits a moment) */
  function mixChange(t, act) {
    const M = st.mix || {}, j = +t.getAttribute('data-j') || 0, c = (M.c && M.c[j]) || {};
    if (act === 'mixpreset') {
      const p = ctx.mix && root.EpinoiaWinMix ? root.EpinoiaWinMix.presets(ctx.mix).find(x => x.id === t.value) : null;
      M.preset = t.value;
      if (p) { M.c = p.conds.map(x => Object.assign({}, x)).concat(p.conds.length < 2 ? [M.c && M.c[1]] : []); M.two = p.conds.length > 1; }
    } else if (act === 'mixteam') M.team = t.value;
    else if (act === 'mixtwo') M.two = !!t.checked;
    else {
      M.preset = '';
      if (act === 'mixop') c.op = t.value;
      else if (act === 'mixn') c.n = +t.value;
      else if (act === 'mixkind') { c.kind = t.value; if (c.kind === 'stat') c.x = ''; }
      else if (act === 'mixrole') c.role = t.value;
      else if (act === 'mixstat') { c.stat = t.value; c.x = ''; }
      else if (act === 'mixcmp') c.cmp = t.value;
      else if (act === 'mixx') { if (!isNum(parseFloat(t.value))) return; c.x = parseFloat(t.value); }
      M.c = M.c || []; M.c[j] = c;
    }
    st.mix = M;
    queueMix(act === 'mixx' ? 250 : 0);
  }
  frame.addEventListener('input', e => {
    const t = e.target;
    const ia = t.getAttribute && t.getAttribute('data-act');
    if (ia === 'gap' || ia === 'gapn') { moveGap(parseFloat(t.value), ia); return; }
    if (ia === 'mixx') { mixChange(t, ia); return; }
    if (!t.getAttribute || t.getAttribute('data-act') !== 'dial') return;
    const side = t.getAttribute('data-side'), key = t.getAttribute('data-key'), d = DIALS.find(x => x.key === key);
    st.dials[side] = Object.assign({}, st.dials[side], { [key]: +t.value });
    const out = t.parentNode.querySelector('output'); if (out) out.textContent = sg(+t.value, d.step < 1 ? 1 : 0) + ' ' + d.unit;
    queueSim();
  });
  function queueSim() { root.clearTimeout(simT); simT = root.setTimeout(simulate, 250); }
  async function loadClub() {
    if (!st.club || !ctx.W || !ctx.W.league) { ctx.club = null; ctx.clubState = 'idle'; mount('losses'); return; }
    ctx.clubState = 'loading'; mount('losses');
    const a = await WF().get({ scope: 'club', league: ctx.W.league.id, season: ctx.W.season ? ctx.W.season.id : undefined, team: st.club });
    if (a.ok) { ctx.club = a.data; ctx.clubState = 'ok'; } else { ctx.club = null; ctx.clubState = a.reason === 'none' ? 'none' : ['members', 'signin', 'league', 'jwt'].indexOf(a.reason) >= 0 ? 'refused' : 'none'; }
    mount('losses');
  }

  /* ---- the league and season pickers ---- */
  const pickL = $('wwLeague'), pickS = $('wwSeason');
  async function pickLeague(slug) {
    league = leagues.find(l => l.slug === slug) || null;
    seasonId = '';
    pickL.value = league ? league.slug : '';
    await setLeague();
    address();
    load();
  }
  async function setLeague() {
    const kick = $('wwKick');
    kick.textContent = '';
    if (!league) { kick.textContent = 'Every league'; pickS.disabled = true; pickS.innerHTML = '<option value="">Current</option>'; try { root.EpinoiaTeamColour && root.EpinoiaTeamColour.clearLeague && root.EpinoiaTeamColour.clearLeague(); } catch (_) { /* fine */ } return; }
    const a = doc.createElement('a'); a.href = '../?l=' + encodeURIComponent(league.slug); a.textContent = league.name; a.setAttribute('translate', 'no'); kick.appendChild(a);
    try {
      const row = (await D().get('leagues?slug=eq.' + encodeURIComponent(league.slug) + '&select=*'))[0];
      if (row && root.EpinoiaTeamColour) root.EpinoiaTeamColour.league(row, { keepAccent: !!(row.theme && row.theme.accent) });
    } catch (_) { /* the platform's colours stay */ }
    try { seasons = (await D().get('seasons?league_id=eq.' + league.id + '&select=id,name,starts_on')).sort((x, y) => String(y.starts_on).localeCompare(String(x.starts_on))); } catch (_) { seasons = []; }
    pickS.innerHTML = '';
    const cur = doc.createElement('option'); cur.value = ''; cur.textContent = 'Current'; pickS.appendChild(cur);
    seasons.forEach(s => { const o = doc.createElement('option'); o.value = s.id; o.textContent = s.name; o.setAttribute('translate', 'no'); pickS.appendChild(o); });
    pickS.disabled = !seasons.length;
    pickS.value = seasons.some(s => s.id === seasonId) ? seasonId : '';
  }
  pickL.addEventListener('change', () => pickLeague(pickL.value));
  pickS.addEventListener('change', () => { seasonId = pickS.value; address(); load(); });
  $('wwCards').addEventListener('click', e => {
    const c = e.target.closest && e.target.closest('.ww-card[data-k]');
    if (!c || !ctx.W || !ctx.W.curves || !ctx.W.curves[c.getAttribute('data-k')]) return;
    st.k = c.getAttribute('data-k'); address(); mount('curves');
    $('curves').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  });

  /* the chart kit translates a label whole before cutting it (vizkit's tr): charts drawn before the language pack
     arrived are drawn again once it has */
  try {
    const I = root.EpinoiaI18n;
    if (I && I.lang && I.lang !== 'en' && typeof I.whenReady === 'function') I.whenReady(() => binds.forEach(list => list.forEach(b => { try { b.redraw(); } catch (_) { /* a section redrawn since */ } })));
  } catch (_) { /* English */ }

  (async function start() {
    if (!WF() || !D() || !V()) { $('wwLine').textContent = 'The page could not be loaded.'; return; }
    try { leagues = await D().get('leagues?select=id,slug,name&order=name'); } catch (_) { leagues = []; }
    leagues.forEach(l => { const o = doc.createElement('option'); o.value = l.slug; o.textContent = l.name; o.setAttribute('translate', 'no'); pickL.appendChild(o); });
    league = leagues.find(l => l.slug === want) || null;
    pickL.value = league ? league.slug : '';
    await setLeague();
    if (seasonId && !seasons.some(s => s.id === seasonId)) seasonId = '';
    load();
  })();
}

return { views, cards, statusLine, boot, simPlatt, SECTIONS, MEMBER, DIALS, LEGACY, _ago: ago, gapAt, gapRange, gapText, mixState };
}));
