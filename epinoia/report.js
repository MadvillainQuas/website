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
  /* the A4 engine under a name of its own too: the game page already has an EpinoiaReport (game/report.js, the match report) */
  if (typeof root === 'object' && root) root.EpinoiaA4 = api;
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
  usg: { l: 'USG%', dp: 1, style: true }, ev_half_usg: { l: 'HALF-COURT USG%', dp: 1, style: true }, ts: { l: 'TS%', dp: 1 }, efg: { l: 'eFG%', dp: 1 }, ftr: { l: 'FTr', dp: 1 },
  ft_pct: { l: 'FT%', dp: 1 }, fg_pct: { l: 'FG%', dp: 1 },
  au: { l: 'ASSIST TO USAGE RATIO', dp: 2 }, ast_to: { l: 'AST / TO', dp: 2 }, ast_pct: { l: 'AST%', dp: 1 }, hc_ast_pct: { l: 'HALF-COURT AST%', dp: 1 },
  tr_ast_pct: { l: 'TRANSITION AST%', dp: 1 },
  ast3_sh: { l: "% OF ASSISTS THAT ARE 3'S", dp: 1, style: true }, ast2_sh: { l: "% OF ASSISTS THAT ARE 2'S", dp: 1, style: true },
  tov_pct: { l: 'TO%', dp: 1, low: true },
  rim_a100: { l: 'RIM VOL / 100', dp: 1, style: true }, rim_pct: { l: 'RIM%', dp: 1 }, ev_rim_astp: { l: 'RIM ASSISTED%', dp: 1, low: true },
  mid_a100: { l: 'MID VOL / 100', dp: 1, style: true }, mid_pct: { l: 'MID%', dp: 1 }, ev_mid_astp: { l: 'MID ASSISTED%', dp: 1, low: true },
  p3_a100: { l: '3PT VOL / 100', dp: 1, style: true }, p3_pct: { l: '3PT%', dp: 1 }, ev_p3_astp: { l: '3PT ASSISTED%', dp: 1, low: true },
  ev_transition_pts_sh: { l: 'TRANSITION %PTS', dp: 1, style: true },
  ev_transition_rim_a100: { l: 'TRANSITION RIM VOL / 100', dp: 1, style: true }, ev_transition_rim_pct: { l: 'TRANSITION RIM%', dp: 1 },
  rim_half_sh: { l: '% OF RIM ATT IN HALF COURT', dp: 1, style: true }, ev_half_rim_pct: { l: 'HALF-COURT RIM%', dp: 1 },
  ev_half_efg: { l: 'HALF-COURT eFG%', dp: 1 }, ev_half_tov_pct: { l: 'HALF-COURT TO%', dp: 1, low: true },
  ev_half_ppp: { l: 'HALF-COURT PTS / CHANCE', dp: 2 }, ev_transition_ppp: { l: 'TRANSITION PTS / CHANCE', dp: 2 },
  stl_pct: { l: 'STL%', dp: 1 }, blk_pct: { l: 'BLK%', dp: 1 }, oreb_pct: { l: 'ORB%', dp: 1 }, dreb_pct: { l: 'DRB%', dp: 1 },
  trb_pct: { l: 'TRB%', dp: 1 },
  diff_efg: { l: 'TEAM eFG% ±', dp: 1, signed: true }, diff_tov: { l: 'TEAM TO% ±', dp: 1, signed: true, low: true },
  diff_oreb: { l: 'TEAM ORB ±', dp: 1, signed: true }, diff_vs_efg: { l: 'DEF TEAM eFG% ±', dp: 1, signed: true, low: true },
  diff_vs_oreb: { l: 'DEF ORB ±', dp: 1, signed: true, low: true }, diff_net: { l: 'NET ±', dp: 1, signed: true },
  def_rim_fg_pm: { l: 'DEF RIM FG% ±', dp: 1, signed: true, low: true }, def_rim_vol_pm: { l: 'DEF RIM VOL ±', dp: 1, signed: true, low: true },
  pf_pg: { l: 'FOULS CONCEDED / G', dp: 1, low: true }, pf30: { l: 'FOULS / 30', dp: 1, low: true },
  /* SYNERGY (2026-10-04): a player's own file (synergy.js), so no field to rank in - each is drawn against the break-even
     eFG% instead; optional: a player with no file has no such row or cell at all */
  syn_fu_efg: { l: 'ATTACKED FACE-UP eFG%', dp: 1, low: true, rank: false, optional: true, ref: 52.5, refL: 'vs', sc: 5 },
  syn_post_efg: { l: 'POST-D eFG%', dp: 1, low: true, rank: false, optional: true, ref: 52.5, refL: 'vs', sc: 5 },
  syn_screen_efg: { l: 'SCREEN D eFG%', dp: 1, low: true, rank: false, optional: true, ref: 52.5, refL: 'vs', sc: 5 },
  /* HIS SYNERGY DRIVES, a category of their own (DRIVES L/R): each kind's FG% going left and going right, each tinted against his
     drives in ALL directions (left, right and straight together: the same file, the same seasons - never this season's own RIM%,
     MID% or 3PT%, the Synergy file being several seasons; the kind's break-even only where he has no such shot at all) - and the
     share of each side's drive shots of the kind. No words of comparison: the colour says it. */
  drv_rim_fg: { l: 'DRIVE L/R RIM FG%', dp: 1, rank: false, optional: true, pair: ['drv_l_rim_fg', 'drv_r_rim_fg'], ref: 'drv_all_rim_fg', refBE: 58, sc: 5 },
  drv_rim_att: { l: 'DRIVE L/R RIM ATT%', dp: 0, rank: false, optional: true, pair: ['drv_l_rim_att', 'drv_r_rim_att'] },
  drv_mid_fg: { l: 'DRIVE L/R MID FG%', dp: 1, rank: false, optional: true, pair: ['drv_l_mid_fg', 'drv_r_mid_fg'], ref: 'drv_all_mid_fg', refBE: 40, sc: 5 },
  drv_mid_att: { l: 'DRIVE L/R MID ATT%', dp: 0, rank: false, optional: true, pair: ['drv_l_mid_att', 'drv_r_mid_att'] },
  drv_3_fg: { l: 'DRIVE L/R 3FG%', dp: 1, rank: false, optional: true, pair: ['drv_l_3_fg', 'drv_r_3_fg'], ref: 'drv_all_3_fg', refBE: 35, sc: 5 },
  drv_3_att: { l: 'DRIVE L/R 3 ATT%', dp: 0, rank: false, optional: true, pair: ['drv_l_3_att', 'drv_r_3_att'] },
  badpass_pg: { l: 'BAD PASS TO / G', dp: 1, low: true, rank: false, feed: true }, handle_pg: { l: 'DRIBBLE TO / G', dp: 1, low: true, rank: false, feed: true }
};

/* what each one means, for the legend: statinfo.js has most of them; these are the ones it does not */
const DEFS = {
  gp: ['Games played', 'Games in which they played a minute.'],
  orapm: ['Offensive RAPM', 'Regularised adjusted plus-minus, offence: points per 100 possessions they add to their team’s offence once every teammate and opponent on the floor is accounted for (ridge regression over every stint of the league’s season).'],
  drapm: ['Defensive RAPM', 'The same regression’s defensive coefficient: points per 100 possessions they take off the opponent’s offence. Higher is better.'],
  rapm: ['RAPM', 'Offensive plus defensive RAPM.'],
  hc_ast_pct: ['Half-court assist %', 'Of their teammates’ baskets in the half court while they were on the floor (not a second chance, a fast break or off a turnover), the share they assisted: how much of the set offence they create. Worked out from every game’s play-by-play in the competition; blank under 10 such baskets.'],
  tr_ast_pct: ['Transition assist %', 'Of their teammates’ baskets in transition while they were on the floor (a fast break, or within eight seconds of a defensive rebound or a steal), the share they assisted.'],
  ast3_sh: ['Assists that were threes', 'Of the baskets they assisted, the share that were three-pointers (points off their assists minus two per assist).'],
  ast2_sh: ['Assists that were twos', 'Of the baskets they assisted, the share that were two-pointers.'],
  pf_pg: ['Fouls conceded a game', 'Personal fouls they commit per game. Fewer is better.'],
  syn_fu_efg: ['Attacked face-up eFG% (Synergy)', 'What the player guarding them shot (effective field-goal %) when they were attacked face-up: every defensive isolation, and every drive at them (left, right or straight) outside one, from their Synergy file. Lower is better; drawn against the break-even 52.5%.'],
  drv_rim_fg: ['Drive left / right, rim FG% (Synergy)', 'Their field-goal percentage at the rim (to the basket) on drives going left, then right, from their Synergy file; each tinted against their rim FG% on drives in all directions (green above it, red below).'],
  drv_rim_att: ['Drive left / right, rim attempts % (Synergy)', 'Of their shots on drives going left, then right, the share at the rim.'],
  drv_mid_fg: ['Drive left / right, mid-range FG% (Synergy)', 'Their field-goal percentage on pull-up twos (dribble jumpers short of the arc) going left, then right; each tinted against their pull-up two FG% on drives in all directions.'],
  drv_mid_att: ['Drive left / right, mid-range attempts % (Synergy)', 'Of their shots on drives going left, then right, the share that were pull-up twos.'],
  drv_3_fg: ['Drive left / right, 3FG% (Synergy)', 'Their three-point percentage on pull-up threes going left, then right; each tinted against their pull-up three FG% on drives in all directions.'],
  drv_3_att: ['Drive left / right, three attempts % (Synergy)', 'Of their shots on drives going left, then right, the share that were pull-up threes.'],
  syn_post_efg: ['Post-D eFG% (Synergy)', 'What the player guarding them shot (effective field-goal %) posting them up: every defensive post-up in their Synergy file. Lower is better; drawn against the break-even 52.5%.'],
  syn_screen_efg: ['Screen D eFG% (Synergy)', 'What the ball handler shot (effective field-goal %) coming off a screen against them: every defensive pick-and-roll ball-handler play in their Synergy file. Lower is better; drawn against a league-typical 52.5%.'],
  badpass_pg: ['Bad-pass turnovers a game', 'Turnovers the feed typed as a bad pass, per game; only leagues whose feed types its turnovers have them.'],
  handle_pg: ['Dribble turnovers a game', 'Turnovers the feed typed as a ball-handling error (travelling, a lost dribble, a carry), per game.'],
  ev_transition_pts_sh: ['Transition share of points', 'The share of their points scored in transition: within eight seconds of a defensive rebound or a steal, or tagged a fast break.'],
  ev_half_usg: ['Half-court usage', 'Of their team’s half-court chances while they were on the floor (not a second chance, a fast break, off a turnover or after a timeout), the share they ended themselves: a shot, a trip to the line or a turnover, counted as USG% counts them. Blank under 10 such chances.'],
  ev_transition_rim_a100: ['Transition rim volume', 'Shots at the rim in transition (a fast break, or within eight seconds of a defensive rebound or a steal) per 100 of their team’s possessions while they are on the floor.'],
  ev_transition_rim_pct: ['Transition rim %', 'Field-goal percentage on their shots at the rim in transition.'],
  rim_half_sh: ['Rim attempts in the half court', 'Of their shots at the rim, the share taken in the half court (not a second chance, a fast break, off a turnover or after a timeout): how much of their work at the rim comes against a set defence.'],
  ev_half_rim_pct: ['Half-court rim %', 'Field-goal percentage on their shots at the rim in the half court.'],
  ev_half_efg: ['Half-court eFG%', 'Effective field-goal percentage on chances that were not a second chance, a fast break, off a turnover or after a timeout.'],
  ev_half_tov_pct: ['Half-court turnover %', 'Turnovers per half-court chance. Lower is better.'],
  ev_half_ppp: ['Half-court points per chance', 'Points scored per half-court chance (a trip that ends in a shot, a turnover or free throws).'],
  ev_transition_ppp: ['Transition points per chance', 'Points scored per transition chance.'],
  rim_a100: ['Rim volume', 'Shots at the rim per 100 of their team’s possessions while they are on the floor.'],
  mid_a100: ['Mid-range volume', 'Mid-range shots per 100 of their team’s possessions while they are on the floor.'],
  p3_a100: ['Three-point volume', 'Three-point attempts per 100 of their team’s possessions while they are on the floor.'],
  ev_rim_astp: ['Rim assisted %', 'Of their makes at the rim, the share that came off a pass.'],
  ev_mid_astp: ['Mid-range assisted %', 'Of their mid-range makes, the share that came off a pass.'],
  ev_p3_astp: ['Three-point assisted %', 'Of their made threes, the share that came off a pass.'],
  diff_efg: ['Team eFG% on/off', 'Their team’s effective field-goal percentage with them on the floor minus with them off it.'],
  diff_tov: ['Team turnover % on/off', 'Their team’s turnover percentage with them on minus off. Lower is better.'],
  diff_oreb: ['Team offensive rebounding on/off', 'Their team’s offensive rebound percentage with them on minus off.'],
  diff_vs_efg: ['Defensive team eFG% on/off', 'The opponents’ effective field-goal percentage with them on the floor minus with them off it. Lower (negative) is better.'],
  diff_vs_oreb: ['Defensive offensive rebounding on/off', 'The opponents’ offensive rebound percentage with them on minus off. Lower is better.']
};
function defOf(k, kind) {
  const s = STATS[k] || null;
  /* the reason to look at it: ours, else statinfo's reading; failing both, what the colours say for this kind of figure */
  const I = root.EpinoiaStatInfo, i = I && I.info ? I.info(k, kind) : null;
  const own = WHY[k], why = own || (i && i.read) || '', whyL = own ? 'Why look' : 'How to read it';
  if (DEFS[k]) return { title: DEFS[k][0], what: DEFS[k][1], formula: '', why, whyL };
  if (i) return { title: i.title, what: i.what, formula: i.formula || '', why, whyL };
  return s ? { title: s.l, what: '', formula: '', why, whyL } : null;
}

/* WHY YOU WOULD LOOK AT IT (the legend's third line): a coach's reason in a short sentence, for the figures statinfo.js does not carry
   and where its own reading is not the one a report wants. Keyed by stat key; a figure with none falls back on statinfo's "read". */
const WHY = {
  rapm: 'The closest single number to “does the team do better with them on the floor”, once teammates and opponents are allowed for.',
  orapm: 'Separates what they add on offence from what they give back on defence.',
  drapm: 'Defence is hard to see in a box score; this is the best public attempt to measure it.',
  hc_ast_pct: 'Passing in a set offence is a skill; fast-break assists are partly luck and pace.',
  ast3_sh: 'A passer whose assists are threes is stretching the floor; one whose assists are twos is feeding the paint.',
  ast2_sh: 'The other side of the same split: how often their passes create a two.',
  rim_half_sh: 'Does their rim scoring come in the half court (against a set defence) or only in transition?',
  ev_rim_astp: 'Coloured the other way round: a LOW share (they create their own rim shots) is green, a high one (they need a pass) is red.',
  ev_mid_astp: 'Coloured the other way round: a low share (they make their own mid-range shots) is green, a high one (they need a pass) is red.',
  ev_p3_astp: 'Coloured the other way round: a low share (threes they create off the dribble) is green, a high one (spot-up threes) is red.',
  diff_efg: 'Does the team shoot better with them on the floor?',
  diff_tov: 'Does the team turn the ball over less with them on the floor?',
  diff_oreb: 'Does the team win more of its own misses with them on the floor?',
  diff_vs_efg: 'Do opponents shoot worse with them on the floor?',
  diff_vs_oreb: 'Do opponents win fewer of their misses with them on the floor?',
  syn_fu_efg: 'How well they defend when a player attacks them one-on-one.',
  syn_post_efg: 'How well they defend the post.',
  syn_screen_efg: 'How well they guard the ball handler in the pick-and-roll.',
  drv_rim_fg: 'Tells you which hand they finish with, so you know which way to send them.',
  drv_rim_att: 'Shows which direction they prefer to drive.',
  drv_mid_fg: 'Shows which side their pull-up is better from.',
  drv_mid_att: 'Shows how often they stop and shoots on a drive, each way.',
  drv_3_fg: 'Shows which side their pull-up three is better from.',
  drv_3_att: 'Shows how often they pull up from three on a drive, each way.',
  tsa_for: 'More shooting attempts than the other side is the simplest way to win: the possessions are worth more.',
  tsa_vs: 'The same count for the opponents: how many chances the defence lets them have.',
  tsa_gap: 'The club’s edge in chances: a positive gap means it gets more shots than it gives.',
  z_rim_astp: 'Coloured the other way round: a LOW share (green) means the club creates its own rim shots; a high one means it needs a pass.',
  z_rim_ptsh: 'How much of the paint scoring is right at the basket rather than floaters and short shots.',
  tr_def_delta: 'Transition defence judged fairly: it compares what opponents scored against the club with what they score against everyone else.',
  vs_start_net: 'How the club does against the other side’s best players.',
  vs_bench_net: 'How the club does when the other side’s bench is on: where leads are built.',
  own_start_net: 'How the club does with its best players on the floor.',
  own_bench_net: 'How much the club gives back (or gains) when the bench plays.',
  au: 'Shows whether a player makes teammates better (a high ratio) or mostly uses possessions themselves (a low one).'
};

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
  /* THE RIM, BY SITUATION (the events lines, ev_): his shots at the rim in transition per 100 of his team's possessions
     while he is on the floor (season.js on_poss, with its own guard: under 20 possessions it is noise), and the share of
     all his rim attempts that came in the half court */
  if (r.ev_transition_rim_a100 == null && isNum(r.ev_transition_rimA) && isNum(r.on_poss) && +r.on_poss >= 20) {
    r.ev_transition_rim_a100 = Math.round(1000 * r.ev_transition_rimA / r.on_poss) / 10;
  }
  if (r.rim_half_sh == null && isNum(r.ev_half_rimA) && isNum(r.ev_all_rimA) && +r.ev_all_rimA > 0) {
    r.rim_half_sh = Math.round(1000 * r.ev_half_rimA / r.ev_all_rimA) / 10;
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
/* Ten, not twenty (2026-10-03): the figure showed a dash for most of a competition's players through its first weeks,
   a rotation guard two games in having fifteen such baskets. Ten is the line the site draws elsewhere (rebound-linked
   ORB%: ten resolved misses). */
const HC_MIN = 10;
function hcAssists(games) {
  const SI = root.EpinoiaSituations, out = new Map();
  if (!SI || !SI.inGameOrder || !SI.stamps) return out;
  const at = pid => { let o = out.get(pid); if (!o) out.set(pid, o = { a: 0, m: 0, ta: 0, tm: 0 }); return o; };
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
      if (!sp) return;
      /* the half court (no second chance, no break, not off a turnover) in a and m; transition in ta and tm */
      const half = !sp.second && !sp.offTo && !sp.transition, tr = !!sp.transition;
      if (!half && !tr) return;
      const M = half ? 'm' : 'tm', A = half ? 'a' : 'ta';
      const who = by.get(e);
      on[e.team].forEach(pid => { if (pid !== e.pid) { const o = at(pid); o[M]++; if (who === pid) o[A]++; } });
      /* the passer was on the floor whatever the log's substitutions say */
      if (who && who !== e.pid && !on[e.team].has(who)) { const o = at(who); o[M]++; o[A]++; }
    });
  });
  return out;
}
/* the rate on a row, from hcAssists' tally: blank under HC_MIN baskets */
function hcAstOf(t) { return t && t.m >= HC_MIN ? Math.round(1000 * t.a / t.m) / 10 : null; }
/* the same in transition */
function trAstOf(t) { return t && t.tm >= HC_MIN ? Math.round(1000 * t.ta / t.tm) / 10 : null; }

/* ---------------------------------------------------------------- templates --- */
/* THE DEFAULTS BY POSITION (Louie, 2026-10-02). MAIN STATS, the player's page; PLAYERS, the club report's card rows. */
const TPL = {
  main: {
    guard: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
            ['SCORING', ['usg', 'ev_half_usg', 'ts', 'efg', 'ftr', 'ft_pct']],
            ['PLAYMAKING', ['au', 'hc_ast_pct', 'ast3_sh', 'ast2_sh', 'tov_pct']],
            ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'rim_half_sh', 'ev_half_rim_pct', 'mid_a100', 'mid_pct', 'p3_a100', 'p3_pct', 'ev_p3_astp']],
            ['DRIVES L/R · SYNERGY', ['drv_rim_fg', 'drv_rim_att', 'drv_mid_fg', 'drv_mid_att', 'drv_3_fg', 'drv_3_att']],
            ['SITUATIONS', ['ev_transition_pts_sh', 'tr_ast_pct', 'ev_transition_rim_a100', 'ev_transition_rim_pct', 'ev_half_efg', 'ev_half_tov_pct']],
            ['DEFENCE & GLASS', ['stl_pct', 'dreb_pct', 'syn_fu_efg', 'syn_post_efg', 'syn_screen_efg']],
            ['ON / OFF', ['diff_efg', 'diff_tov']]],
    wing: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
           ['SCORING', ['usg', 'ev_half_usg', 'ts', 'efg', 'ftr']],
           ['PLAYMAKING', ['au', 'tov_pct']],
           ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'rim_half_sh', 'ev_half_rim_pct', 'p3_a100', 'p3_pct']],
            ['DRIVES L/R · SYNERGY', ['drv_rim_fg', 'drv_rim_att', 'drv_mid_fg', 'drv_mid_att', 'drv_3_fg', 'drv_3_att']],
           ['SITUATIONS', ['ev_transition_pts_sh', 'tr_ast_pct', 'ev_transition_rim_a100', 'ev_transition_rim_pct', 'ev_half_efg']],
           ['DEFENCE & GLASS', ['stl_pct', 'blk_pct', 'oreb_pct', 'dreb_pct', 'syn_fu_efg', 'syn_post_efg', 'syn_screen_efg']],
           ['ON / OFF', ['diff_vs_efg']]],
    big: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
          ['SCORING', ['usg', 'ev_half_usg', 'ts', 'ft_pct', 'ftr']],
          ['PLAYMAKING', ['au', 'tov_pct']],
          ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'rim_half_sh', 'ev_half_rim_pct', 'p3_a100', 'p3_pct']],
            ['DRIVES L/R · SYNERGY', ['drv_rim_fg', 'drv_rim_att', 'drv_mid_fg', 'drv_mid_att', 'drv_3_fg', 'drv_3_att']],
          ['SITUATIONS', ['ev_transition_rim_a100', 'ev_transition_rim_pct']],
          ['RIM PROTECTION', ['def_rim_fg_pm', 'def_rim_vol_pm', 'syn_post_efg', 'syn_fu_efg', 'syn_screen_efg']],
          ['GLASS & DEFENCE', ['oreb_pct', 'dreb_pct', 'blk_pct', 'pf_pg']],
          ['ON / OFF', ['diff_oreb', 'diff_vs_oreb']]]
  },
  players: {
    guard: [['IMPACT', ['orapm', 'drapm', 'bpm']],
            ['SCORING', ['usg', 'ev_half_usg', 'ts', 'ftr']],
            ['PLAYMAKING', ['au', 'ast3_sh', 'ast2_sh', 'diff_efg']],
            ['HALF COURT', ['ev_half_efg', 'hc_ast_pct', 'ev_half_tov_pct', 'badpass_pg', 'handle_pg', 'ev_transition_pts_sh']],
            ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'rim_half_sh', 'ev_half_rim_pct', 'mid_pct', 'mid_a100', 'p3_a100', 'p3_pct', 'ev_p3_astp']],
            ['DRIVES L/R · SYNERGY', ['drv_rim_fg', 'drv_rim_att', 'drv_mid_fg', 'drv_mid_att', 'drv_3_fg', 'drv_3_att']],
            ['DEFENCE', ['stl_pct', 'dreb_pct', 'syn_fu_efg', 'syn_post_efg', 'syn_screen_efg']]],
    wing: [['IMPACT', ['orapm', 'drapm', 'bpm']],
           ['SCORING', ['usg', 'ev_half_usg', 'ts', 'ftr', 'au', 'tov_pct']],
           ['HALF COURT', ['ev_half_efg', 'ev_transition_pts_sh']],
           ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'rim_half_sh', 'ev_half_rim_pct', 'mid_pct', 'mid_a100', 'p3_a100', 'p3_pct', 'ev_p3_astp']],
            ['DRIVES L/R · SYNERGY', ['drv_rim_fg', 'drv_rim_att', 'drv_mid_fg', 'drv_mid_att', 'drv_3_fg', 'drv_3_att']],
           ['DEFENCE & GLASS', ['stl_pct', 'blk_pct', 'dreb_pct', 'oreb_pct', 'diff_vs_efg', 'syn_fu_efg', 'syn_post_efg', 'syn_screen_efg']]],
    big: [['IMPACT', ['vorp', 'obpm', 'orapm', 'drapm']],
          ['SCORING', ['usg', 'ev_half_usg', 'ts', 'ft_pct', 'ftr', 'au', 'tov_pct']],
          ['SHOT PROFILE', ['rim_a100', 'rim_pct', 'ev_rim_astp', 'rim_half_sh', 'ev_half_rim_pct', 'p3_a100', 'p3_pct']],
            ['DRIVES L/R · SYNERGY', ['drv_rim_fg', 'drv_rim_att', 'drv_mid_fg', 'drv_mid_att', 'drv_3_fg', 'drv_3_att']],
          ['RIM PROTECTION', ['def_rim_fg_pm', 'def_rim_vol_pm', 'syn_post_efg', 'syn_fu_efg', 'syn_screen_efg']],
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
  /* n: the whole field; nNow: the season shown's part of it (an earlier season's rows, priorRows __prior, deepen the
     percentiles but a count printed as "among 40 guards" is this season's) */
  return { pct: (k, id) => { const m = ranks.get(k); const v = m ? m.get(id) : null; return v == null ? null : Math.round(v); },
           avg: k => avg.get(k), n: fl.length, nNow: fl.filter(r => !r.__prior).length };
}
/* a style (shot volume, usage, the share of assists that are threes) has no good end: it is drawn in blue-to-purple, DEEPER the
   higher it is among the others (bands 5 to 8, quarter by quarter; 9 is the one neutral tone kept for what has no field) */
const band = (p, style) => (p == null ? 0 : style ? (p >= 75 ? 8 : p >= 50 ? 7 : p >= 25 ? 6 : 5) : p >= 75 ? 4 : p >= 50 ? 3 : p >= 25 ? 2 : 1);

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
function refOf(s, row) {
  if (s.ref == null) return null;
  if (typeof s.ref === 'number') return s.ref;
  const v = row ? row[s.ref] : null;
  return isNum(v) ? v : isNum(s.refBE) ? s.refBE : null;
}
/* what the reference is called: his own figure's name, or 'break-even' where it fell back to that */
function refName(s, row) { return typeof s.ref === 'string' && !(row && isNum(row[s.ref])) && isNum(s.refBE) ? 'break-even' : (s.refL || 'club'); }
function bandVs(v, ref, scale, low) {
  if (!isNum(v) || !isNum(ref)) return 0;
  const g = (low ? -1 : 1) * (+v - +ref), sc = scale || 3;
  return g >= sc ? 4 : g >= 0 ? 3 : g > -sc ? 2 : 1;
}
function statRowHTML(k, row, R, opt) {
  const s = STATS[k] || { l: k.toUpperCase() };
  if (s.pair) {
    const rv = refOf(s, row), zA = opt && opt.z ? ' data-z="' + opt.z + '"' : '';
    return '<div class="rp-st rp-st2" data-b="0"' + zA + '><span class="rp-st-l" data-lg="' + esc(k) + '" title="' + esc(s.l) + '">' + esc(s.l) + '</span><span class="rp-st-v">' + pairHTML(k, row) + '</span>' +
      '<span class="rp-st-bar"></span><span class="rp-st-p"></span><span class="rp-st-a">' + esc(pairN(k, row)) + '</span></div>';
  }
  const v = row ? row[k] : null;
  const rv = refOf(s, row);
  const lab = (opt && typeof opt.label === 'function' && opt.label(k)) || s.l;     // a shorter name where the group says the rest
  const zA = opt && opt.z ? ' data-z="' + opt.z + '"' : '';                         // the kind of shot it is about (groupRowsHTML)
  const head = '<span class="rp-st-l" data-lg="' + esc(k) + '" title="' + esc(s.l) + '">' + esc(lab) + '</span><span class="rp-st-v">' + (s.feed && !isNum(v) ? '<small title="' + esc(FEED_NA) + '">n/a</small>' : fmtStat(k, v)) + '</span>';
  const c = opt && opt.compact ? ' data-c="1"' : '';
  if (s.rank === false && isNum(rv) && isNum(v)) {
    const d = +v - +rv, g = s.low ? -d : d, sc = s.sc || 3;
    const b = bandVs(v, rv, sc, s.low);
    const w = Math.max(3, Math.min(50, 50 * Math.abs(g) / (3 * sc)));
    const t = (+Math.abs(d)).toFixed(s.dp == null ? 1 : s.dp);
    return '<div class="rp-st" data-b="' + b + '"' + c + zA + '>' + head +
      '<span class="rp-st-bar dv"><i style="' + (g >= 0 ? 'left:50%' : 'left:' + (50 - w).toFixed(1) + '%') + ';width:' + w.toFixed(1) + '%"></i></span>' +
      '<span class="rp-st-p">' + (d > 0 ? '+' : d < 0 ? '\u2212' : '\u00b1') + t + '</span>' +
      '<span class="rp-st-a">' + esc(refName(s, row)) + ' ' + fmtStat(typeof s.ref === 'string' && STATS[s.ref] ? s.ref : k, rv) + '</span></div>';
  }
  const p = s.rank === false ? null : R.pct(k, row && row.id);
  const b = band(p, s.style);
  const a = s.rank === false ? null : R.avg(k);         // a figure only this side has: no field to average
  const w = p == null ? 0 : Math.max(3, p);
  const pl = p != null && opt && opt.place ? opt.place(k) : null;      // a club's place ('3rd/18') where a percentile would be
  return '<div class="rp-st" data-b="' + b + '"' + c + (pl ? ' data-r="1"' : '') + zA + '>' + head +
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
/* WHICH SIDE IS BETTER, at a glance: the better of two numbers green, the worse red, neither when they are within eps (or
   either side has too few to say); low: smaller is better. -> [left's, right's] as 'up' / 'dn' / '' */
function sideTone(a, b, low, eps) {
  if (!isNum(a) || !isNum(b) || Math.abs(+a - +b) < (eps || 0)) return ['', ''];
  const leftBetter = low ? +a < +b : +a > +b;
  return leftBetter ? ['up', 'dn'] : ['dn', 'up'];
}
/* A PAIR (DRIVE L/R ...): both sides in one cell or row, left then right; each on a tint against the reference (his drives in
   all directions), and the better side's number green, the worse red (an FG% on fewer than three attempts says nothing) */
/* the sample under a pair, left then right: the attempts behind each FG%, or each side's drive shots behind the shares */
function pairN(k, row) {
  const s = STATS[k];
  if (!row || !s || !s.pair) return '';
  const fg = /_fg$/.test(s.pair[0]);
  const n = s.pair.map((x, i) => row[fg ? x.replace(/_fg$/, '_n') : 'drv_' + (i ? 'r' : 'l') + '_shots']);
  return n.some(isNum) ? n.map(v => (isNum(v) ? v : 0)).join(' \u00b7 ') + (fg ? ' att' : ' shots') : '';
}
function pairHTML(k, row) {
  const s = STATS[k], rv = refOf(s, row);
  const n = x => (row ? row[x.replace(/_fg$/, '_n')] : null);
  const tone = s.ref != null && s.pair.every(x => !/_fg$/.test(x) || (isNum(n(x)) && n(x) >= 3)) ? sideTone(row && row[s.pair[0]], row && row[s.pair[1]], s.low, 3) : ['', ''];
  return s.pair.map((x, i) => {
    const v = row ? row[x] : null;
    const b = isNum(v) && isNum(rv) ? bandVs(v, rv, s.sc || 3, s.low) : 0;
    return '<i data-b="' + b + '"' + (tone[i] ? ' class="' + tone[i] + '"' : '') + '><small>' + (i ? 'R' : 'L') + '</small>' + (isNum(v) ? (+v).toFixed(s.dp == null ? 1 : s.dp) : '\u2014') + '</i>';
  }).join('');
}
function statCellHTML(k, row, R, opt) {
  const s = STATS[k] || { l: k.toUpperCase() };
  if (s.pair) {
    const rv = refOf(s, row);
    return '<div class="rp-cell rp-cell2" data-b="0"' + (opt && opt.z ? ' data-z="' + opt.z + '"' : '') + '><span class="rp-cell-l" data-lg="' + esc(k) + '">' + esc(s.l) + '</span>' +
      '<b class="rp-cell-v">' + pairHTML(k, row) + '</b><span class="rp-cell-p">' + esc(pairN(k, row)) + '</span></div>';
  }
  const p = s.rank === false ? null : R.pct(k, row && row.id);
  const v = row ? row[k] : null;
  const rv = refOf(s, row);
  const b = p == null && s.rank === false && isNum(rv) && isNum(v) ? bandVs(v, rv, s.sc || 3, s.low) : band(p, s.style);
  return '<div class="rp-cell' + (opt && opt.first ? ' zn' : '') + '" data-b="' + b + '"' + (opt && opt.z ? ' data-z="' + opt.z + '"' : '') + '><span class="rp-cell-l" data-lg="' + esc(k) + '">' + esc(s.l) + '</span>' +
    '<b class="rp-cell-v">' + (s.feed && !isNum(v) ? '<small title="' + esc(FEED_NA) + '">n/a</small>' : fmtStat(k, v)) + '</b>' +
    '<span class="rp-cell-p">' + (p == null ? (s.rank === false && isNum(rv) && isNum(v) ? (+v - +rv > 0 ? '+' : +v - +rv < 0 ? '\u2212' : '\u00b1') + Math.abs(+v - +rv).toFixed(1) + ' v ' + fmtStat(typeof s.ref === 'string' && STATS[s.ref] ? s.ref : k, rv) : '') : ordinal(p)) + '</span></div>';
}

/* THE SHOT PROFILE IN ITS PARTS (2026-10-03). The stats of a group that are about one kind of shot - at the rim, mid-range,
   from three - are drawn in a part for each, in the order the group lists them: a small heading with the kind's colour, and
   the rows (or, on a player's card, the cells) on a bar of that colour, so ten rows read as three. A group about one kind of
   shot, or none (SITUATIONS, RIM PROTECTION), is drawn as it always was, and so is a reader's own template. */
const SHOT_KIND = { rim_a100: 'rim', rim_pct: 'rim', ev_rim_astp: 'rim', rim_half_sh: 'rim', ev_half_rim_pct: 'rim',
  mid_a100: 'mid', mid_pct: 'mid', ev_mid_astp: 'mid', p3_a100: 'three', p3_pct: 'three', ev_p3_astp: 'three' };
const SHOT_KIND_NAME = { rim: 'at the rim', mid: 'mid-range', three: 'three-point' };
/* the kinds of a group's stats in order, one entry a run: ['rim', 'mid', 'three'], or null when the group is not about several */
function shotRuns(ks) {
  const runs = [];
  (ks || []).forEach(k => { const z = SHOT_KIND[k] || null; if (z && runs[runs.length - 1] !== z) runs.push(z); else if (!z) runs.push(null); });
  return new Set(runs.filter(Boolean)).size > 1 ? runs : null;
}
/* a stat marked optional (a Synergy figure) is left out where the row has no value for it: no file, no row */
function hasStat(k, row) { const s = STATS[k]; if (!row) return false; return s && s.pair ? s.pair.some(x => isNum(row[x])) : isNum(row[k]); }
const present = (ks, row) => (ks || []).filter(k => !(STATS[k] && STATS[k].optional) || hasStat(k, row));
/* a template's groups as a row draws them: a group all of whose stats are optional and absent is not drawn at all */
const groupsOn = (groups, row) => (groups || []).filter(g => present(g[1], row).length);
function groupRowsHTML(ks0, row, R, opt) {
  const ks = present(ks0, row);
  const split = !!shotRuns(ks);
  let cur = null;
  return (ks || []).map(k => {
    const z = split ? SHOT_KIND[k] || null : null;
    const head = z && z !== cur ? '<div class="rp-zh" data-z="' + z + '"><i></i>' + SHOT_KIND_NAME[z] + '</div>' : '';
    cur = z;
    return head + statRowHTML(k, row, R, Object.assign({}, opt, { z }));
  }).join('');
}
/* ON A PLAYER'S CARD (2026-10-04) a group about several kinds of shot is set out in RUNS: each kind's cells in a box of their own
   with its name over them - RIM, MID-RANGE, THREE - on a bar of its colour, so the three read apart at a glance */
const RUN_NAME = { rim: 'Rim', mid: 'Mid-range', three: 'Three' };
function groupCellsHTML(ks0, row, R) {
  const ks = present(ks0, row);
  const split = !!shotRuns(ks);
  if (!split) return ks.map(k => statCellHTML(k, row, R, {})).join('');
  const runs = [];
  ks.forEach(k => { const z = SHOT_KIND[k] || null, last = runs[runs.length - 1]; if (last && last.z === z) last.ks.push(k); else runs.push({ z, ks: [k] }); });
  return runs.map(u => u.z
    ? '<div class="rp-run" data-z="' + u.z + '"><em>' + RUN_NAME[u.z] + '</em><div class="rp-run-c">' + u.ks.map(k => statCellHTML(k, row, R, { z: u.z })).join('') + '</div></div>'
    : u.ks.map(k => statCellHTML(k, row, R, {})).join('')).join('');
}
/* a group's height in rows, for cutting the page's two columns evenly: a row each, the group's title, and a heading a part */
function groupWeight(ks) { const runs = shotRuns(ks); return (ks || []).length + 1.6 + (runs ? 0.9 * runs.filter(Boolean).length : 0); }

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
  const row = r => '<tr' + (r.att ? '' : ' class="none"') + (r.kind ? ' data-k="' + r.kind + '"' : '') + '><td class="l">' + esc(r.label) + '</td><td>' + r.made + '/' + r.att + '</td>' +
    '<td class="rp-zs"><span>' + (isNum(r.share) ? f1(r.share) + '%' : '—') + '</span><i style="width:' + (isNum(r.share) ? Math.max(2, 100 * r.share / max).toFixed(1) : 0) + '%"></i></td>' +
    pill(r.fg, r.be, r.att) + pill(r.efg, r.beE, r.att) + '</tr>';
  /* a heading over each part (shotchart.js parts): the kind of shot's swatch and name, its rows on a bar of the same colour */
  const body = (rows, which) => (SC.parts ? SC.parts(rows, which) : [{ kind: null, title: null, rows }]).map(p =>
    (p.title ? '<tr class="rp-zk"' + (p.kind ? ' data-k="' + p.kind + '"' : '') + '><td colspan="5"><i></i>' + esc(p.title) + '</td></tr>' : '') + p.rows.map(row).join('')).join('');
  const tbl = (rows, cap, which) => '<table class="rp-tbl rp-zt"><thead><tr><th class="l">' + cap + '</th><th>made/att</th><th>% of shots</th><th>FG%</th><th>eFG%</th></tr></thead><tbody>' +
    body(rows, which) + '</tbody></table>';
  return '<div class="rp-two">' + '<div>' + tbl(Z.groups, 'every zone', 'groups') + '</div><div>' + tbl(Z.big, 'the larger cuts', 'big') + '</div></div>' +
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
  SIT_KEYS.forEach(k => { out[k] = { games: 0, chances: 0, pts: 0, fga: 0, fgm: 0, p3m: 0, fta: 0, ftm: 0, tov: 0, astd: 0, shots: [], types: new Map(),
    zones: { rim: { a: 0, m: 0, x: 0 }, mid: { a: 0, m: 0, x: 0 }, three: { a: 0, m: 0, x: 0 } }, scorers: new Map() }; });
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
        /* an assisted basket (situations.js marks each made shot): the card's AST% and each kind's */
        if (x.made && x.ast) { A.astd++; if (z) z.x++; }
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
    A.astPct = A.fgm ? A.astd / A.fgm : null;
    A.types = [...A.types.values()].sort((x, y) => (y.a - x.a) || (y.m - x.m));
    A.scorers = [...A.scorers.values()].filter(x => x.pts > 0).sort((x, y) => y.pts - x.pts).slice(0, 5);
  });
  return out;
}
const SIT_NAME = { half: ['Half court', 'chances that were not a second chance, a break, off a turnover or after a timeout'],
                   transition: ['Transition', 'tagged a fast break, or within eight seconds of a defensive rebound or a steal'],
                   /* the club report's CLUTCH page (report-teampages.js clutch, clutch.js): the card drawn from clutch time's shots */
                   clutch: ['Clutch', 'the last four minutes of the fourth quarter and overtime, within five points'] };
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
      '<p class="rp-sit-k"><span><i class="m"></i>made</span><span><i class="x"></i>missed</span><span>' + located.length + ' of ' + A.fga + ' shots located · zones tinted against break-even</span></p>' +
      sitAstHTML(A, opt) + '</div>' +
      '<div class="rp-sit-s"><h5>Shot types</h5>' + types + zones + zl + sc + '</div></div></div>';
}

/* AST% IN THE GAP UNDER THE COURT (2026-10-04): the share of the situation's made baskets that were assisted (situations.js
   pairs each assist with the basket it made), big, then the same for each kind of shot - at the rim, mid-range, threes - as a
   bar. On a player's card it is the share of HIS baskets that were assisted, and says so. Nothing when nothing was made. */
function sitAstHTML(A, opt) {
  if (!A || !A.fgm || A.astPct == null) return '';
  const who = opt && opt.player ? 'their' : 'its';
  const kinds = [['rim', 'Rim'], ['mid', 'Mid-range'], ['three', 'Three']].map(([k, l]) => {
    const z = A.zones[k] || { m: 0, x: 0 }, p = z.m ? z.x / z.m : null;
    return '<li><span>' + l + '</span><i><em style="width:' + (p == null ? 0 : (100 * p).toFixed(1)) + '%"></em></i><b>' + (p == null ? '–' : Math.round(100 * p) + '%') + '</b><small>' + (z.x || 0) + '/' + (z.m || 0) + '</small></li>';
  }).join('');
  return '<div class="rp-sit-a"><div class="rp-sit-a1"><b>' + Math.round(100 * A.astPct) + '%</b><span>' + (opt && opt.player ? 'Assisted' : 'AST%') + '</span></div>' +
    '<div class="rp-sit-a2"><p>' + A.astd + ' of ' + who + ' ' + A.fgm + ' baskets were assisted</p><ul>' + kinds + '</ul></div></div>';
}

/* A CREST OR A PHOTO THAT DID NOT LOAD (2026-10-03). Another site's logo sends no CORS header, which the pictures need to be
   drawn into the PDF, or the link is dead: the page then carried a broken-picture icon where the crest should be (a KBL
   game's analysis did). An image with a data-fb is put right once the pages are built, and when it fails later: its
   monogram or initials, as the page draws a club or a player with no picture; an empty fallback just takes it out. */
function stand(scope) {
  const fix = img => {
    const fb = img.getAttribute('data-fb'), box = img.parentNode;
    if (fb == null || !box) return;
    if (!fb) { img.remove(); return; }
    if (box.classList) box.classList.remove('img');
    box.textContent = '';
    box.appendChild(el('b', null, fb));
  };
  /* decode() answers for a picture that failed, and one still loading, alike; a vector logo with no size of its own has no
     naturalWidth and has not failed */
  scope.querySelectorAll('img[data-fb]').forEach(img => {
    if (typeof img.decode === 'function') img.decode().catch(() => fix(img));
    else if (img.complete) { if (!img.naturalWidth) fix(img); }
    else img.addEventListener('error', () => fix(img), { once: true });
  });
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
  /* a game's two clubs (game/analysis.js c.crests): both crests, "vs" between them */
  if (Array.isArray(c.crests) && c.crests.length === 2)
    return '<span class="' + cls + '-pair">' + crestHTML(c.crests[0], cls) + '<i class="rp-vs">vs</i>' + crestHTML(c.crests[1], cls) + '</span>';
  const mono = String(c.monogram || c.club || c.name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  /* data-fb: what stands in for it if it does not load (stand, below) */
  if (c.crest) return '<span class="' + cls + ' img"><img src="' + esc(c.crest) + '" alt="" crossorigin="anonymous" data-fb="' + esc(mono || '?') + '"></span>';
  return '<span class="' + cls + '"><b>' + esc(mono || '?') + '</b></span>';
}
function newPage(c, label, cont) {
  const pg = el('div', 'rp-pg');
  pg.style.setProperty('--rp-a', c.accent || '#08603f');
  if (c.accentB) pg.style.setProperty('--rp-b', c.accentB);     // a game's other club (game/analysis.js)
  pg.innerHTML = '<div class="rp-top">' + crestHTML(c, 'rp-top-c') +
    '<div class="rp-top-n"><b>' + esc(c.head || c.name) + '</b><span>' + esc(c.line || '') + '</span></div>' +
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
        '<div class="rp-cv-sub">' + esc(c.subtitle || '') + '</div><p class="rp-cv-how" hidden></p></div></div>' +
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
    /* a little smaller rather than a page of its own and a gap where it was: down to 88% where that makes it fit */
    if (count > 1 && !b.style.zoom) {
      const need = b.offsetHeight || 1, z = (need - (body.scrollHeight - body.clientHeight) - 3) / need;
      if (z >= 0.88) { b.style.zoom = z.toFixed(3); if (!over()) return; b.style.zoom = ''; }
      /* or every block of the page a little smaller together (down to 92%), which saves a page holding one small block */
      const kids = [...body.children];
      if (kids.every(k => !k.style.zoom)) {
        const tall = kids.reduce((s, k) => s + (k.offsetHeight || 0), 0) || 1;
        let zz = (tall - (body.scrollHeight - body.clientHeight) - 3) / tall;
        for (let i = 0; i < 2 && zz >= 0.92; i++) {
          kids.forEach(k => { k.style.zoom = zz.toFixed(3); });
          if (!over()) return;
          zz *= (body.clientHeight - 2) / Math.max(1, body.scrollHeight);
        }
        kids.forEach(k => { k.style.zoom = ''; });
      }
    }
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

/* EVERY STAT IS A LINK TO ITS LEGEND ENTRY (Louie, 2026-10-07). A label drawn from a stat key carries it (data-lg, statRowHTML,
   statCellHTML, the modules' own boxes and tiles); a label printed as plain words - a table's head, a card's name, a section's
   title - is matched by its words to a legend row's (its label, the stat's other names, or an entry such as FOUR FACTORS); and a
   column head that matches nothing, in a section the legend explains as a whole (FULL STATS, LINEUP CARDS), goes to that entry.
   Each one is given data-goto (the legend row's page, raster.js makes it a link in the PDF) and data-goto-y (how far down that
   page the row starts, so the link lands on the entry, not the top of the page); on the screen a click scrolls to the row and
   lights it. The legend's own pages, the cover, and anything that is already a link are left alone. */
const lgNorm = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const LG_PICK = 'th, h3, h4, [data-lg], .rp-st-l, .rp-cell-l, .rp-tile > span:first-of-type, .rp-ffs > span:first-of-type, td.l > b, ' +
  '[class$="-k"], [class$="-t"], [class$="-h"], [class$="-n"]';
/* the names a table prints for a stat the legend calls something else (normalised text -> stat key) */
const LG_ALIAS = { 'FT RATE': 'ftr', 'FTA RATE': 'ftr', 'EFG': 'efg', 'TS': 'ts', 'TOV%': 'tov_pct', 'TO%': 'tov_pct', 'USAGE': 'usg', 'USG': 'usg',
  'OFF RATING': 'ortg', 'DEF RATING': 'drtg', 'NET RATING': 'net', 'OFF RTG': 'ortg', 'DEF RTG': 'drtg', 'NET RTG': 'net', 'ORTG': 'ortg', 'DRTG': 'drtg', 'NET': 'net',
  'PACE': 'pace', 'OREB%': 'oreb_pct', 'DREB%': 'dreb_pct', 'AST%': 'ast_pct', 'STL%': 'stl_pct', 'BLK%': 'blk_pct' };
function linkLegend(stage) {
  const pgs = [...stage.querySelectorAll('.rp-pg')];
  const rows = [...stage.querySelectorAll('.rp-lg-row[data-lgk]')];
  if (!rows.length) return 0;
  const byKey = new Map(), byText = new Map();
  rows.forEach(r => {
    const pg = r.closest('.rp-pg'), n = pgs.indexOf(pg) + 1;
    if (n < 1) return;
    const P = pg.getBoundingClientRect(), b = r.getBoundingClientRect();
    const at = { row: r, page: n, y: P.height > 0 ? Math.max(0, (b.top - P.top - 6) / P.height) : 0 };
    const k = r.getAttribute('data-lgk');
    if (!byKey.has(k)) byKey.set(k, at);
    const label = r.querySelector('b');
    const names = [label && label.textContent];
    if (!/^x:/.test(k) && STATS[k]) names.push(STATS[k].l, STATS[k].short, STATS[k].label);
    names.filter(Boolean).forEach(t => { const u = lgNorm(t); if (u && !byText.has(u)) byText.set(u, at); });
  });
  const legendPages = new Set(rows.map(r => r.closest('.rp-pg')));
  let n = 0;
  pgs.forEach((pg, i) => {
    if (i === 0 && pg.querySelector('.rp-cv-toc')) return;                  // the cover: its contents are links already
    if (legendPages.has(pg)) return;
    pg.querySelectorAll(LG_PICK).forEach(e => {
      if (e.hasAttribute('data-goto') || e.closest('[data-goto]') || e.querySelector('[data-goto]')) return;
      const key = e.getAttribute('data-lg');
      const text = lgNorm(e.textContent);
      if (!key && (!text || text.length > 40)) return;
      let at = key ? byKey.get(key) : null;
      if (!at && text) at = byText.get(text) || byText.get(text.replace(/\s*[·:(].*$/, '')) || (LG_ALIAS[text] && byKey.get(LG_ALIAS[text])) || null;
      /* a column head (or a card's key) the legend has no row for, in a section it explains as a whole: the entry named by the
         section's heading (ZONES, LINEUP CARDS, CLUTCH TIME ...), else by its part of the report (FULL STATS) */
      if (!at && (e.tagName === 'TH' || /-k$/.test(e.className || ''))) {
        const blk = e.closest('.rp-blk'), h = blk && blk.querySelector('.rp-h h3');
        const head = h ? lgNorm(h.textContent) : '';
        if (head) at = byText.get(head) || [...byText.entries()].find(([t, v]) => /^X:/.test(lgNorm(v.row.getAttribute('data-lgk'))) && t.length > 3 && (head.includes(t) || t.includes(head)))?.[1] || null;
        if (!at) { const mod = e.closest('[data-mod]'); at = mod ? byText.get(lgNorm(mod.getAttribute('data-mod'))) || null : null; }
      }
      if (!at) return;
      e.setAttribute('data-goto', String(at.page));
      e.setAttribute('data-goto-y', at.y.toFixed(4));
      e.setAttribute('data-lgto', at.row.getAttribute('data-lgk'));
      if (!e.title) e.title = 'What this is: the legend, page ' + at.page;
      n++;
    });
  });
  return n;
}

/* THE LEGEND: every statistic the report printed, defined, and how to read the colours */
function legendBlocks(keys, extra, kind, pooled) {
  const out = [];
  out.push(block('<div class="rp-lg-key">' +
    '<div><i data-b="4"></i><span><b>75th percentile and up</b> among the players (or clubs) the stat is ranked in</span></div>' +
    '<div><i data-b="3"></i><span><b>50th\u201375th</b></span></div><div><i data-b="2"></i><span><b>25th\u201350th</b></span></div><div><i data-b="1"></i><span><b>below the 25th</b></span></div>' +
    '<div><i data-b="5"></i><i data-b="6"></i><i data-b="7"></i><i data-b="8"></i><span><b>a style</b>: more is neither better nor worse, so it is ranked by most and drawn in blue to purple, deeper the more of it</span></div>' +
    '<div><i data-b="0"></i><span><b>not ranked</b>: too few to rank, or a figure the field does not carry</span></div></div>' +
    '<p class="rp-lg-p">A percentile says where the figure sits among the others in the same competition and season: the 80th is better than eight in ten. ' +
    (kind === 'team' ? 'A club is ranked among the clubs; a player always among the players of their own position (guards, wings or bigs: the site’s position groups, worked out from how each player is used), never the whole competition. '
      : 'A player is always ranked among the players of their own position (guards, wings or bigs: the site’s position groups, worked out from how each player is used), never the whole competition, and the average shown is theirs. ') +
    (pooled ? esc(pooled) + ' ' : '') +
    'Where smaller is better (turnovers, fouls, what an opponent did with them on the floor, and the share of a player’s or club’s shots that were ASSISTED: a shot you make for yourself is the harder one) the order is turned round, so a high percentile is always good. ' +
    '± is with them (or the unit) on the floor minus off it. All rates are worked out from the season’s totals, never averaged from games. ' +
    'Every stat named in this report links here: click its name, in the PDF or on the screen, to come to its entry below.</p>'));
  const seen = new Set(), rows = [];
  keys.forEach(k => {
    if (seen.has(k)) return; seen.add(k);
    const d = defOf(k, kind);
    if (!d) return;
    const s = STATS[k];
    rows.push('<div class="rp-lg-row" data-lgk="' + esc(k) + '"><b>' + esc(s ? s.l : k) + '</b><span><em>' + esc(d.title) + '.</em> ' + esc(d.what || '') +
      (d.why ? ' <i class="rp-lg-why"><u>' + d.whyL + ':</u> ' + esc(d.why) + '</i>' : '') +
      (d.formula ? ' <code>' + esc(d.formula) + '</code>' : '') + '</span></div>');
  });
  (extra || []).forEach(([t, d, w]) => rows.push('<div class="rp-lg-row" data-lgk="x:' + esc(lgNorm(t)) + '"><b>' + esc(t) + '</b><span>' + esc(d) + (w ? ' <i class="rp-lg-why"><u>Why look:</u> ' + esc(w) + '</i>' : '') + '</span></div>'));
  for (let i = 0; i < rows.length; i += 10) out.push(block('<div class="rp-lg">' + rows.slice(i, i + 10).join('') + '</div>'));
  return out;
}

/* ---------------------------------------------------------------- SYNERGY --- */
/* A PLAYER'S SYNERGY FILE IN HIS REPORTS (2026-10-04; synergy.js reads the scraper's CSV, 0228 synergy_profiles keeps the numbers).
   Where a profile comes from, first found first: one added on this page (SYN.local), one the mailer handed the page
   (EPINOIA_SYNERGY: { player id: profile }, read with its own key), then the database - which answers a platform administrator
   only (Synergy's data is licensed), so the SDK is not even loaded for a reader who is not signed in. What a report draws
   from it: the drives left and right (driveChartHTML), each side's shots (driveTableHTML, directionMixHTML) and the two
   defensive figures (syn_fu_efg, syn_post_efg). */
const SYN = { local: new Map(), cache: new Map() };
async function synClient() {
  try {
    if (typeof root.epinoiaMaybeSignedIn === 'function' && !root.epinoiaMaybeSignedIn()) return null;
    if (typeof root.epinoiaClientReady === 'function') return await root.epinoiaClientReady();
    return typeof root.epinoiaClient === 'function' ? root.epinoiaClient() : null;
  } catch (_) { return null; }
}
const synOk = p => { const S = root.EpinoiaSynergy; return !!p && (!S || S.ok(p)); };
async function synergyOf(ids) {
  const out = new Map(), given = root.EPINOIA_SYNERGY || null, need = [];
  (ids || []).forEach(id => {
    const k = String(id), p = SYN.local.get(k) || (given && given[k]) || null;
    if (synOk(p)) out.set(k, p);
    else if (SYN.cache.has(k)) { if (SYN.cache.get(k)) out.set(k, SYN.cache.get(k)); }
    else need.push(k);
  });
  if (need.length && !root.EPINOIA_RP_BOT) {
    const c = await synClient();
    if (c && c.from) {
      try {
        const { data, error } = await c.from('synergy_profiles').select('player_id,profile').in('player_id', need);
        if (!error) {
          need.forEach(k => SYN.cache.set(k, null));
          (data || []).forEach(r => { if (synOk(r.profile)) { SYN.cache.set(String(r.player_id), r.profile); out.set(String(r.player_id), r.profile); } });
        }
      } catch (_) { /* without it */ }
    }
  }
  return out;
}
/* kept for this page at once; in the database too when the reader may (a platform administrator): true when it was */
async function synergySave(pid, prof, meta) {
  const k = String(pid);
  SYN.local.set(k, prof); SYN.cache.set(k, prof);
  const c = await synClient();
  if (!c || !c.from) return false;
  try {
    const { error } = await c.from('synergy_profiles').upsert(Object.assign({ player_id: k, profile: prof, uploaded_at: new Date().toISOString() }, meta || {}), { onConflict: 'player_id' });
    return !error;
  } catch (_) { return false; }
}
/* a row's Synergy figures, for the templates' stats */
function synergyOnRow(row, prof) {
  if (!row || !synOk(prof)) return;
  const d = prof.defense || {};
  if (d.faceUp && isNum(d.faceUp.efg)) row.syn_fu_efg = Math.round(10 * d.faceUp.efg) / 10;
  if (d.post && isNum(d.post.efg)) row.syn_post_efg = Math.round(10 * d.post.efg) / 10;
  /* a profile saved before 2026-10-06 has no screen figure: the cell simply stays away until the file is uploaded again */
  if (d.screen && isNum(d.screen.efg)) row.syn_screen_efg = Math.round(10 * d.screen.efg) / 10;
  const dv = prof.offense && prof.offense.drives, r1 = v => (isNum(v) ? Math.round(10 * v) / 10 : null);
  /* the baseline: his drives in all directions (a profile kept before it carried them: left, right and straight added up) */
  const all = dv && (dv.all || (() => {
    const sh = { rim: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, three: { m: 0, a: 0 } };
    ['left', 'right', 'straight'].forEach(d => { const ln = dv[d]; if (ln && ln.shots) ['rim', 'mid', 'three'].forEach(k => { sh[k].m += ln.shots[k].m; sh[k].a += ln.shots[k].a; }); });
    const pc = (m, a) => (a > 0 ? 100 * m / a : null);
    return { shots: sh, rimFg: pc(sh.rim.m, sh.rim.a), midFg: pc(sh.mid.m, sh.mid.a), threeFg: pc(sh.three.m, sh.three.a) };
  })());
  if (all) [['rim', 'rim'], ['mid', 'mid'], ['3', 'three']].forEach(([k, z]) => { if (all.shots[z].a > 0) row['drv_all_' + k + '_fg'] = r1(all[z + 'Fg']); });
  [['l', dv && dv.left], ['r', dv && dv.right]].forEach(([sd, ln]) => {
    if (!ln || !ln.att) return;
    row['drv_' + sd + '_shots'] = ln.att;
    [['rim', 'rim'], ['mid', 'mid'], ['3', 'three']].forEach(([k, z]) => {
      if (ln.shots[z].a > 0) { row['drv_' + sd + '_' + k + '_fg'] = r1(ln[z + 'Fg']); row['drv_' + sd + '_' + k + '_n'] = ln.shots[z].a; }
      row['drv_' + sd + '_' + k + '_att'] = r1(ln[z + 'Att']);
    });
  });
}
/* ADD SYNERGY, on the report's own panel: one or several of the scraper's CSV files. Each player in them is matched to one of
   the report's players (o.players() -> [{ id, name }]) - by his name, or by surname and initial where that is the only one -
   and the MATCH IS SHOWN TO BE CHECKED AND CHANGED BY HAND before anything is kept: a list of the report's players beside
   each file's name, the automatic match chosen (or nothing, when there was none), any of them changeable, or left out.
   Then kept (synergySave) and the report built again. */
function synergyControl(host, state, o) {
  const S = root.EpinoiaSynergy;
  if (!S) return;
  const row = el('div', 'rp-rapm rp-syn');
  const lab = el('label', 'ep-btn mini');
  lab.appendChild(doc().createTextNode('Add Synergy CSVs'));
  lab.title = 'One or several of the scraper\u2019s CSV files at once (any number), each with one player or more';
  const inp = el('input'); inp.type = 'file'; inp.accept = '.csv,text/csv'; inp.multiple = true; inp.hidden = true;
  lab.appendChild(inp);
  const say = el('span', null, 'Synergy play-type files, as many as you like: each player\u2019s drives left and right, and what the player guarding them shot at them');
  const box = el('div', 'rp-syn-box'); box.hidden = true;
  row.append(el('span', 'rp-k', 'Synergy'), lab, say);
  host.append(row, box);
  const close = () => { box.hidden = true; box.textContent = ''; };
  /* PRIME REPORT: the report's players' Synergy files READ BACK from synergy_profiles, where the emailed reports find them */
  (state.primers = state.primers || []).push(async () => {
    let people = [];
    try { people = (await o.players()) || []; } catch (_) { people = []; }
    const ids = people.map(q => String(q.id));
    if (!ids.length) return null;
    const one = ids.length === 1 ? people[0].name || 'this player' : '';
    const words = k => (one ? (k ? 'Synergy kept for ' + one : 'no Synergy file kept for ' + one) : (k ? 'Synergy kept for ' + k + ' of ' + ids.length + ' players' : 'no Synergy files kept for these players'));
    if (root.EPINOIA_RP_BOT) return { ok: true, text: words(ids.filter(id => root.EPINOIA_SYNERGY && root.EPINOIA_SYNERGY[id]).length) };
    const here = ids.filter(id => SYN.local.has(id));
    const c = await synClient();
    if (!c || !c.from) return { ok: !here.length, text: here.length ? here.length + ' Synergy file' + (here.length === 1 ? '' : 's') + ' on this page only: a platform administrator\u2019s sign-in keeps them' : 'Synergy files are read by platform administrators only' };
    try {
      const { data, error } = await c.from('synergy_profiles').select('player_id').in('player_id', ids);
      if (error) return { ok: false, text: 'the Synergy files could not be read back (' + (error.message || error) + ')' };
      const kept = new Set((data || []).map(r => String(r.player_id))), only = here.filter(id => !kept.has(id)).length;
      return { ok: !only, text: words(kept.size) + (only ? '; ' + only + ' on this page only, not kept' : '') };
    } catch (e) { return { ok: false, text: 'the Synergy files could not be read back' }; }
  });
  inp.onchange = async () => {
    const files = [...(inp.files || [])]; inp.value = '';
    if (!files.length) return;
    say.textContent = 'reading\u2026';
    let people = [];
    try { people = (await o.players()) || []; } catch (_) { people = []; }
    const found = [];
    for (const f of files) {
      let list = [];
      try { list = S.read(await f.text()); } catch (_) { list = []; }
      list.forEach(p => found.push({ p, file: f.name }));
    }
    if (!found.length) { say.textContent = 'no Synergy rows in ' + (files.length === 1 ? 'that file' : 'those files'); return; }
    close(); box.hidden = false;
    box.appendChild(el('p', 'rp-syn-t', 'Match each file to its player: chosen by name where it could be - check it, and change any by hand.'));
    const picks = found.map(x => {
      const hit = (S.matchPlayer && S.matchPlayer(x.p.name, people)) || (o.single && people.length === 1 ? { person: people[0], how: 'only' } : null);
      const line = el('div', 'rp-syn-row');
      const nm = el('span', 'rp-syn-n', x.p.name + (x.p.seasons && x.p.seasons.length ? ' \u00b7 ' + S.span(x.p.seasons) : ''));
      nm.title = x.file;
      const sel = el('select', 'ep-input');
      const opt = (v, t) => { const op = el('option', null, t); op.value = v; sel.appendChild(op); };
      opt('', '\u2014 leave this file out \u2014');
      people.forEach(q => opt(String(q.id), q.name));
      sel.value = hit ? String(hit.person.id) : '';
      const how = el('small', null, hit ? ({ name: 'same name', initial: 'same surname and initial: check it', only: 'this report\u2019s player: check it' }[hit.how] || '') : 'no match by name: pick them');
      sel.onchange = () => { how.textContent = sel.value ? 'chosen by hand' : 'left out'; };
      line.append(nm, el('span', 'rp-syn-to', '\u2192'), sel, how);
      box.appendChild(line);
      return { x, sel };
    });
    const go = el('button', 'ep-btn mini pri', 'Use these'); go.type = 'button';
    const no = el('button', 'ep-btn mini', 'Cancel'); no.type = 'button';
    const act = el('div', 'rp-syn-act'); act.append(go, no);
    box.appendChild(act);
    say.textContent = found.length + (found.length === 1 ? ' player' : ' players') + ' in ' + (files.length === 1 ? 'the file' : files.length + ' files') + ': match below';
    no.onclick = () => { close(); say.textContent = ''; };
    go.onclick = async () => {
      go.disabled = no.disabled = true;
      let stored = 0, here = 0, out = 0;
      for (const { x, sel } of picks) {
        if (!sel.value) { out++; continue; }
        const ok = await synergySave(sel.value, S.pack(S.profile(x.p)), { source_name: x.p.name || null, source_id: x.p.id || null,
          seasons: (x.p.seasonsText || '').slice(0, 600) || null, file_name: String(x.file).slice(0, 200) });
        if (ok) stored++; else here++;
      }
      close();
      say.textContent = [stored ? stored + ' added and kept for every report' : '', here ? here + ' added to this page (only a platform administrator can keep Synergy files)' : '',
        out ? out + ' left out' : ''].filter(Boolean).join(' \u00b7 ') || 'nothing added';
      if (stored || here) state.rebuild();
    };
  };
}

/* the colour of a side's PPP: the shot it leans on - at the rim (red) or the pull-up jumper (blue: light for mid-range, dark
   for threes) - and how far it leans (from grey, level, to the full colour, all one kind) */
const SYN_RGB = { rim: [200, 66, 46], mid: [110, 150, 230], three: [24, 52, 150], level: [170, 178, 174] };
function leanColour(line) {
  const S = root.EpinoiaSynergy, L = S && S.lean ? S.lean(line) : null;
  const mx = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  if (!L) return 'rgb(' + SYN_RGB.level.join(',') + ')';
  const base = L.kind === 'rim' ? SYN_RGB.rim : mx(SYN_RGB.mid, SYN_RGB.three, L.threes == null ? 0.5 : L.threes);
  return 'rgb(' + mx(SYN_RGB.level, base, 0.3 + 0.7 * L.by).join(',') + ')';
}
const leanWords = line => {
  const S = root.EpinoiaSynergy, L = S && S.lean ? S.lean(line) : null;
  if (!L) return '';
  const pc = v => Math.round(100 * v) + '%';
  return L.kind === 'rim' ? 'mostly at the rim' : 'mostly pull-ups (' + pc(L.threes || 0) + ' threes)';
};
/* THE DRIVES, LEFT AGAINST RIGHT (2026-10-04): four measures, one a row, the left drive growing leftwards from the middle and the
   right one rightwards along a track that is the measure's whole scale, so every row reads on the same picture - PPP 0 to 2,
   the share of his possessions 0 to 20% (more when needed), eFG% 30 to 60%, TO% 0 to 30%. PPP leads: the thickest bar, in the
   colour of the shot that side leans on (leanColour), with a mark at 1.0; eFG% has a mark at the break-even 52.5. The value
   stands at the outer end of each track. opt.compact: a player's card's corner */
function driveChartHTML(prof, opt) {
  const o = opt || {}, dv = prof && prof.offense && prof.offense.drives;
  if (!dv || !dv.left || !dv.right || !(dv.left.poss + dv.right.poss)) return '';
  const Lt = dv.left, Rt = dv.right, All = dv.all || null;   // the marks: his drives in all directions
  const pmax = Math.max(20, Math.ceil(Math.max(Lt.pctPoss || 0, Rt.pctPoss || 0) / 5) * 5);
  const rows = [
    { k: 'ppp', l: 'PPP', lo: 0, hi: 2, f: v => v.toFixed(2), main: true, eps: 0.05 },
    { k: 'pctPoss', l: '% POSS', lo: 0, hi: pmax, f: v => v.toFixed(1) + '%', nomark: true },
    { k: 'efg', l: 'eFG%', lo: 30, hi: 60, f: v => v.toFixed(1), eps: 2 },
    { k: 'toPct', l: 'TO%', lo: 0, hi: 30, f: v => v.toFixed(1), low: true, eps: 2 }
  ];
  const at = (v, r) => Math.max(0, Math.min(100, 100 * (v - r.lo) / (r.hi - r.lo)));
  const side = (ln, r, left) => {
    const v = ln[r.k], w = isNum(v) ? Math.max(3, at(+v, r)) : 0;
    /* the better side's number green, the worse red (a tendency, the share of possessions, is neither) */
    const tone = r.eps == null ? '' : sideTone(Lt[r.k], Rt[r.k], r.low, r.eps)[left ? 0 : 1];
    const fill = r.main ? leanColour(ln) : '';
    const bar = '<span class="tr"><i style="width:' + w.toFixed(1) + '%' + (fill ? ';background:' + fill : '') + '"></i>' +
      (All && !r.nomark && isNum(All[r.k]) ? '<u style="' + (left ? 'right' : 'left') + ':' + at(+All[r.k], r).toFixed(1) + '%"></u>' : '') + '</span>';
    const val = '<b' + (tone ? ' class="' + tone + '"' : '') + '>' + (isNum(v) ? r.f(+v) : '\u2014') + '</b>';
    return '<span class="sd ' + (left ? 'l' : 'r') + '">' + (left ? val + bar : bar + val) + '</span>';
  };
  const body = rows.map(r => '<div class="rp-drv-r' + (r.main ? ' main' : '') + '">' + side(Lt, r, true) + '<span class="lb">' + r.l + '</span>' + side(Rt, r, false) + '</div>').join('');
  const cnt = ln => (ln.poss || 0) + (o.compact ? '' : ' poss') + (isNum(ln.share) ? ' \u00b7 ' + Math.round(ln.share) + '%' : '');
  const head = '<div class="rp-drv-h"><span><b>\u25c0 ' + (o.compact ? 'Left' : 'Drives left') + '</b><small>' + cnt(Lt) + '</small></span>' +
    '<span class="r"><b>' + (o.compact ? 'Right' : 'Drives right') + ' \u25b6</b><small>' + cnt(Rt) + '</small></span></div>';
  const sw = c => '<i style="background:rgb(' + SYN_RGB[c].join(',') + ')"></i>';
  const key = o.compact ? '<p class="rp-drv-k">PPP colour: ' + sw('rim') + 'rim ' + sw('mid') + 'mid ' + sw('three') + '3</p>'
    : '<p class="rp-drv-k">PPP in the colour of the shot each side leans on: ' + sw('rim') + 'at the rim, ' + sw('mid') + 'pull-up mid-range, ' + sw('three') + 'pull-up threes - the stronger the colour, the more one-sided. The dashed marks: their drives in all directions (PPP ' + (All && isNum(All.ppp) ? All.ppp.toFixed(2) : '\u2014') + ', eFG% ' + (All && isNum(All.efg) ? All.efg.toFixed(1) : '\u2014') + ', TO% ' + (All && isNum(All.toPct) ? All.toPct.toFixed(1) : '\u2014') + '). Left ' + leanWords(Lt) + '; right ' + leanWords(Rt) + '.</p>';
  return '<div class="rp-drv' + (o.compact ? ' cp' : '') + '">' + head + '<div class="rp-drv-b">' + body + '</div>' + key + '</div>';
}
/* EACH SIDE'S SHOTS ON THE DRIVE: FG% and share of the attempts at the rim, mid-range and from three, left and right; the FG%
   tinted against the kind's break-even (rim 58, mid-range 40, three 35), as the zone tables are */
function driveTableHTML(prof, opt) {
  const o = opt || {}, dv = prof && prof.offense && prof.offense.drives;
  if (!dv || !dv.left || !dv.right || !(dv.left.att + dv.right.att)) return '';
  const SC = root.EpinoiaShotChart, AN = (SC && SC.ANCHOR) || { paint: 58, mid: 40, three: 35 };
  const BE = { rim: AN.paint, mid: AN.mid, three: AN.three };
  const f = v => (isNum(v) ? (+v).toFixed(o.compact ? 0 : 1) : '—');
  const fg = (ln, k) => { const v = ln[k + 'Fg'], a = ln.shots[k].a; return '<td data-b="' + (a >= 3 && isNum(v) ? bandVs(v, BE[k], 6, false) : 0) + '">' + f(v) + '</td>'; };
  const at = (ln, k) => '<td class="a">' + (isNum(ln[k + 'Att']) && ln.att ? Math.round(ln[k + 'Att']) + '%' : '—') + '</td>';
  const tr = (l, ln) => '<tr><th>' + (o.compact ? l : l === 'L' ? 'Left' : 'Right') + '</th>' + ['rim', 'mid', 'three'].map(k => fg(ln, k) + at(ln, k)).join('') + '</tr>';
  return '<table class="rp-dt' + (o.compact ? ' cp' : '') + '"><thead><tr><th>' + (o.compact ? 'drives' : 'Synergy drives') + '</th><th colspan="2" data-k="rim">rim</th><th colspan="2" data-k="mid">mid</th><th colspan="2" data-k="three">3pt</th></tr>' +
    '<tr><th></th><th>FG%</th><th>att%</th><th>FG%</th><th>att%</th><th>FG%</th><th>att%</th></tr></thead><tbody>' + tr('L', dv.left) + tr('R', dv.right) + '</tbody></table>';
}
/* WHERE EACH SIDE'S DRIVES END: the share of the attempts at the rim, pull-up mid-range and pull-up threes, left and right */
function directionMixHTML(prof) {
  const dv = prof && prof.offense && prof.offense.drives;
  if (!dv || !dv.left || !dv.right || !(dv.left.att + dv.right.att)) return '';
  const seg = (ln, k, c) => { const v = ln[k + 'Att']; return isNum(v) && v > 0 ? '<i style="flex:0 0 ' + v.toFixed(1) + '%;background:rgb(' + SYN_RGB[c].join(',') + ')">' + (v >= 12 ? Math.round(v) + '%' : '') + '</i>' : ''; };
  const bar = (l, ln) => '<div class="rp-dmx-r"><span>' + l + '<small>' + ln.att + ' shots</small></span><div class="rp-dmx-b">' + (ln.att ? seg(ln, 'rim', 'rim') + seg(ln, 'mid', 'mid') + seg(ln, 'three', 'three') : '') + '</div></div>';
  return '<div class="rp-dmx">' + bar('Left', dv.left) + bar('Right', dv.right) +
    '<p class="rp-drv-k"><i style="background:rgb(' + SYN_RGB.rim.join(',') + ')"></i>at the rim <i style="background:rgb(' + SYN_RGB.mid.join(',') + ')"></i>pull-up mid-range <i style="background:rgb(' + SYN_RGB.three.join(',') + ')"></i>pull-up threes · % of the shots on each side’s drives</p></div>';
}
/* the Synergy file a report draws from, in words */
function synergySource(prof, short) {
  if (!prof) return '';
  if (short) return 'Synergy' + (prof.span ? ' ' + prof.span : '') + ((prof.seasons || []).length > 1 ? ' \u00b7 ' + prof.seasons.length + ' seasons' : '');
  const n = (prof.seasons || []).length;
  return 'Synergy' + (prof.span ? ', ' + prof.span : '') + (n > 1 ? ' (' + n + ' seasons' + ([...new Set(prof.seasons.map(x => x.team).filter(Boolean))].length > 1 ? ', ' + [...new Set(prof.seasons.map(x => x.team).filter(Boolean))].join(', ') : '') + ')' : '');
}

/* A SMALL ZONE CHART: the half court, each zone tinted against its break-even (orange above, blue below, grey within two points;
   pale where it has fewer than three attempts), nothing else - a player's card's corner */
/* A PLAYER'S SHOT MIX, for the corner of his card where a Synergy file would draw his drives (2026-10-04): rim, mid-range and three,
   one bar each. The bar's LENGTH is how often he shoots from there (his share of his shots, the longest bar full width); the SOLID
   part of it is how well he shoots there (his FG%), so a long, mostly solid bar is a place he lives and scores. Worked from the
   season row (volumes per 100 of his team's possessions on the floor, and the percentages), so it is there for every player. */
function shotMixHTML(r) {
  if (!r) return '';
  const Z = [['RIM', 'rim_a100', 'rim_pct'], ['MID', 'mid_a100', 'mid_pct'], ['3PT', 'p3_a100', 'p3_pct']];
  const vol = Z.map(([, a]) => (isNum(r[a]) ? Math.max(0, +r[a]) : 0)), tot = vol.reduce((x, y) => x + y, 0);
  if (!(tot > 0)) return '';
  const top = Math.max.apply(null, vol);
  const rows = Z.map(([l, , pc], i) => {
    const sh = 100 * vol[i] / tot, pv = isNum(r[pc]) ? Math.max(0, Math.min(100, +r[pc])) : null;
    return '<div class="rp-mx-r"><span>' + l + '</span><div class="rp-mx-t"><div style="width:' + Math.max(4, 100 * vol[i] / top).toFixed(1) + '%"><i style="width:' + (pv == null ? 0 : pv).toFixed(1) + '%"></i></div></div>' +
      '<b>' + Math.round(sh) + '%<small>' + (pv == null || !vol[i] ? '—' : Math.round(pv) + '%') + '</small></b></div>';
  }).join('');
  return '<div class="rp-mx"><h6>SHOT MIX</h6>' + rows + '<p>bar: how often they shoot there · solid: how often it goes in</p></div>';
}

/* A KEY IN A GAP OF A PAGE (2026-10-04): a short boxed explanation of the harder figures on it, for the reader who does not live in
   these numbers (a coach). items: [[term, plain-English meaning]]. A block of its own, so it lands in whatever room the page has,
   or opens the next page when it has none. */
/* THE LEAGUE'S OTHER SEASONS, for ranking (2026-10-04): a figure is ranked against EVERY season of the league the page has data
   for - each club's (or player's) season one more entry in the field - not only the season shown, so a ranking rests on more
   than ten clubs. api: the page's REST reader; the newest `max` seasons other than the one shown (excludeIds: its competitions),
   of the same kind (league, cup ... or 'all'). -> [{ name, S }] with S as data.js season() gives it (teams, players, games). */
const PRIOR = new Map();
function loadPrior(api, leagueId, excludeIds, kind, max) {
  const SB = root.EpinoiaSeasonBar, D = root.EpinoiaData;
  if (!SB || !SB.load || !D || !D.season || !api || !leagueId) return Promise.resolve([]);
  const ex = new Set(excludeIds || []), key = [leagueId, [...ex].sort().join(','), kind || 'all', max || 4].join('|');
  if (PRIOR.has(key)) return PRIOR.get(key);
  const p = (async () => {
    const o = await SB.load(api, leagueId), out = [];
    for (const sn of (o.list || [])) {
      const comps = sn.comps || [];
      if (comps.some(c => ex.has(c.id))) continue;                       // the season shown
      const ids = comps.filter(c => !kind || kind === 'all' || (c.kind || 'league') === kind).map(c => c.id);
      if (!ids.length) continue;
      try { const S = await D.season(ids, { rows: false, trim: true }); if (S && ((S.teams || []).length || (S.players || []).length)) out.push({ name: sn.name, S }); } catch (_) { /* that season is left out */ }
      if (out.length >= (max || 4)) break;
    }
    return out;
  })().catch(() => []);
  PRIOR.set(key, p);
  return p;
}
/* those seasons' rows as entries of a field: ids made their own (a club or player of the season shown is not the same entry in an
   earlier one), `derive` run on each (a team's, by the page) */
function priorRows(prior, pick, derive) {
  const out = [];
  (prior || []).forEach((P, i) => {
    const rows = (pick(P.S) || []).map(r => Object.assign({}, r));
    if (derive) { try { derive(rows, P.S); } catch (_) { /* its rows as they are */ } }
    rows.forEach(r => { r.id = r.id + '@' + i; r.__prior = true; out.push(r); });
  });
  return out;
}

function keyHTML(heading, items, cls) {
  return '<div class="rp-kb' + (cls ? ' ' + cls : '') + '"><h5>' + esc(heading) + '</h5><dl>' +
    items.map(([t, d]) => '<div><dt>' + esc(t) + '</dt><dd>' + esc(d) + '</dd></div>').join('') + '</dl></div>';
}
const keyBox = (heading, items, cls) => block(keyHTML(heading, items, cls));

function miniZonesHTML(shots) {
  const Box = root.EpinoiaBox, SC = root.EpinoiaShotChart;
  const located = (shots || []).filter(x => x && x.x != null && x.y != null);
  if (!Box || !Box.courtSVG || !SC || !SC.zonePaths || !SC.zones || !SC.bandAt) return '';
  /* every player has his court: one with no located shot (a feed that does not place them, or none taken) is an empty one, said so */
  if (!located.length) return '<div class="rp-mz"><div class="rp-mz-c">' + Box.courtSVG(null, { plain: true }) + '</div><p>no located shots</p></div>';
  const P = SC.zonePaths(), Zs = SC.zones(located), AN = SC.ANCHOR || { paint: 58, mid: 40, three: 35 };
  const fill = Object.keys(P).map(k => {
    const z = Zs[k];
    if (!z || !z.att) return '';
    if (z.att < 3) return '<path d="' + P[k] + '" fill="rgba(160,170,165,.16)"/>';
    const b = SC.bandAt(z.pct, AN[z.kind]);
    const col = b > 0 ? '239,138,75' : b < 0 ? '91,141,239' : '160,170,165';
    return '<path d="' + P[k] + '" fill="rgba(' + col + ',' + (0.3 + 0.17 * Math.abs(b)).toFixed(2) + ')"/>';
  }).join('');
  const m = located.filter(x => x.made).length;
  const svg = Box.courtSVG(null, { plain: true }).replace(/(<svg[^>]*>)/, '$1' + fill);
  return '<div class="rp-mz"><div class="rp-mz-c">' + svg + '</div><p>' + m + '/' + located.length + ' · ' + Math.round(100 * m / located.length) + '%</p></div>';
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
/* RAPM KEPT IN THE DATABASE TOO (0228 report_rapm, 2026-10-04): worked out once for a set of games, it is there for every
   report of that league and season, in any browser and in the mailer's. Read by anyone; written by a platform administrator
   (the button, or PRIME REPORT) - a write anyone else attempts is refused by the database and changes nothing here - and by
   the mailer with its own key: the copy it worked out is left on the page for it (__rpRapm). */
const r1 = v => (isNum(v) ? Math.round(10 * v) / 10 : null);
const mapOf = m => new Map(m.map(([id, o, d]) => [id, { orapm: o, drapm: d, rapm: isNum(o) && isNum(d) ? Math.round(10 * (o + d)) / 10 : null }]));
async function rapmRemote(key) {
  const D = root.EpinoiaData;
  if (!D || typeof D.all !== 'function') return null;
  try {
    const rows = await D.all('report_rapm?key=eq.' + encodeURIComponent(key) + '&select=m,computed_at&limit=1');
    const e = rows && rows[0];
    return e && Array.isArray(e.m) ? { at: Date.parse(e.computed_at) || Date.now(), map: mapOf(e.m) } : null;
  } catch (_) { return null; }
}
async function rapmKeep(key, map, games) {
  const m = [...map].map(([id, v]) => [id, r1(v.orapm), r1(v.drapm)]);
  root.__rpRapm = { key, games, m };
  const c = typeof root.epinoiaClient === 'function' ? root.epinoiaClient() : null;
  if (!c || !c.from) return false;
  try { const { error } = await c.from('report_rapm').upsert({ key, games, m, computed_at: new Date().toISOString() }, { onConflict: 'key' }); return !error; }
  catch (_) { return false; }
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
  const done = (key, map, n, at) => {
    Object.assign(holder, { key, map, n });
    flag(false); b.textContent = 'Calculate again';
    say.textContent = 'calculated for ' + scope() + ' (' + n + ' games, ' + map.size + ' players' + (at ? ', ' + when(at) : '') + ')';
  };
  /* look for one already worked out for these games - in this browser, then in the database - with no reading of games;
     calc: work it out now. quiet: the caller builds the pages itself (PRIME REPORT), so this does not */
  async function check(calc, quiet) {
    if (holder.running) return holder.running;
    let ids;
    try { ids = (await o.ids()) || []; } catch (_) { ids = []; }
    holder.none = !ids.length;
    if (!ids.length) { flag(true); b.hidden = true; say.textContent = 'ORAPM and DRAPM need the league\u2019s games: there are none in this scope yet.'; return; }
    const key = rapmKey(ids);
    if (!calc) {
      if (holder.key === key && holder.map) return;
      const kept = rapmLoad(key) || await rapmRemote(key);
      if (kept) {
        if (!rapmLoad(key)) rapmSave(key, kept.map);
        done(key, kept.map, ids.length, kept.at);
        if (!quiet) state.rebuild();
        return;
      }
      holder.key = key; holder.map = null;
      flag(true); b.textContent = 'Calculate RAPM';
      say.textContent = 'not calculated for ' + scope() + ': ORAPM and DRAPM stay blank until it is (it reads all ' + ids.length + ' games of the league\u2019s season)';
      return;
    }
    b.disabled = true;
    holder.running = (async () => {
      try {
        const map = await o.run(ids, (d, n) => { say.textContent = 'calculating RAPM for ' + scope() + ': reading the league\u2019s games, ' + d + ' of ' + n + '\u2026'; });
        rapmSave(key, map);
        await rapmKeep(key, map, ids.length);
        done(key, map, ids.length);
        if (!quiet) state.rebuild();
      } catch (e) { flag(true); say.textContent = 'RAPM could not be calculated: ' + (e.message || e); }
    })();
    await holder.running;
    holder.running = null; b.disabled = false;
  }
  b.onclick = () => check(true);
  holder.check = check;
  state.onBuilt = (state.onBuilt || []).concat(() => { check(false); });   // the scope may have changed
  /* PRIME REPORT: what is kept anywhere, else worked out now; then READ BACK from report_rapm, where the emailed reports find it
     (a copy kept only in this browser, from before 0228, is put there) */
  (state.primers = state.primers || []).push(async () => {
    await check(false, true);
    if (!holder.map && !holder.none) await check(true, true);
    if (holder.none) return { ok: true, text: 'no RAPM: no games in ' + scope() + ' yet' };
    if (!holder.map) return { ok: false, text: 'RAPM could not be worked out' };
    let there = await rapmRemote(holder.key);
    if (!there && await rapmKeep(holder.key, holder.map, holder.n || 0)) there = await rapmRemote(holder.key);
    return there ? { ok: true, text: 'RAPM kept for every report of ' + scope() + ' (' + (holder.n || '?') + ' games, ' + holder.map.size + ' players)' }
                 : { ok: false, text: 'RAPM worked out on this page only, not kept for the emailed reports (a platform administrator\u2019s sign-in keeps it)' };
  });
  if (!state.priming) check(false);
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
  /* the mailer's headless browser (scripts/report_mailer.mjs) sets EPINOIA_RP_BOT before the page's own scripts run: the
     reports it emails were bought by the member they are sent to */
  const isLocked = () => !root.EPINOIA_RP_BOT && !!(o.lock && AX() && typeof AX().featureLocked === 'function' && AX().featureLocked(o.lock.key, o.lock.league));
  const markTab = () => {
    const l = isLocked();
    btn.classList.toggle('rp-tab-locked', l);
    const why = l && AX() && typeof AX().lockReason === 'function' ? AX().lockReason(o.lock.key, o.lock.league) : null;
    if (l) btn.title = (o.lock.what || 'The report') + (why === 'signin' ? ': sign in to see it' : ': for members'); else btn.removeAttribute('title');
  };
  const lockedPanel = () => {
    panel.textContent = '';
    const wrap = el('div', 'rp rp-locked');
    const M = root.EpinoiaMemLock;
    const ph = M && typeof M.placeholder === 'function' ? M.placeholder({ what: o.lock.what || 'The report', rows: 8, key: o.lock.key }) : null;
    if (ph) wrap.appendChild(ph);
    const t = el('div', 'rp-lockcard');
    t.innerHTML = AX() && typeof AX().teaserHTML === 'function'
      ? AX().teaserHTML({ leagueSlug: o.lock.leagueSlug, peek: o.lock.key, title: (o.lock.what || 'The report') + ' is for members', lines: o.lock.lines || [] }) : '';
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
  const key = o.store || ('epinoia_report_' + o.kind);
  const saved = store.get(key, {});
  const conf = state.conf = {
    on: Object.assign({}, ...o.modules.map(m => ({ [m.key]: m.on !== false })), saved.on || {}),
    title: saved.title || o.title || 'Scouting report',
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
  /* THE COMPETITIONS (Louie, 2026-10-07): a club or a player linked to the same squad in another competition of the season
     (0178: London Lions in SLB and in the EuroCup) can have the report's own lines over all of them. The page offers the
     choices (o.scopes: [{ k, label }], 'home' first) and is told the one chosen (o.setScope) before a build; shown only when
     there is more than one. Kept with the other settings, and ?rpscope= in the address asks for one (the mailer). A build
     waits for the choice to be known, so the first one is already the reader's. */
  conf.scope = 'home';
  state.scopeReady = null;
  if (typeof o.scopes === 'function' && typeof o.setScope === 'function') {
    const want = (() => { try { return new URLSearchParams(root.location.search).get('rpscope'); } catch (_) { return null; } })() || saved.scope || 'home';
    const sc = el('label', 'rp-f rp-scope');
    sc.hidden = true;
    sc.append(el('span', null, 'competitions'));
    const sel = el('select');
    sc.appendChild(sel);
    bar.insertBefore(sc, mods);
    state.scopeReady = Promise.resolve().then(() => o.scopes()).catch(() => null).then(list => {
      list = Array.isArray(list) ? list : [];
      if (list.length > 1) {
        list.forEach(s => { const op = el('option', null, s.label); op.value = s.k; sel.appendChild(op); });
        conf.scope = list.some(s => s.k === want) ? want : 'home';
        sel.value = conf.scope;
        sc.hidden = false;
      }
      o.setScope(conf.scope);
    });
    sel.onchange = () => { conf.scope = sel.value; o.setScope(conf.scope); persist(); rebuild(); };
  }
  /* the extras a module offers (the template pickers, RAPM) */
  const extras = el('div', 'rp-extras');
  bar.appendChild(extras);
  /* the downloads */
  const outs = el('div', 'rp-outs');
  const status = el('span', 'rp-status');
  const mk = (t, cls, fn) => { const b = el('button', 'ep-btn ' + cls, t); b.type = 'button'; b.onclick = fn; outs.appendChild(b); return b; };
  /* PRIME REPORT (2026-10-04): the report made ready in one click - RAPM read where it was already worked out or worked out now
     and kept for every report of the league and season, the Synergy files read, every page built - and the PDF stored for
     sending (0229, storeForSending), not downloaded: Download PDF is there for a copy */
  const bPrime = mk('PRIME REPORT', 'prime', () => prime(true));
  bPrime.title = 'Make the report ready for sending in one go: RAPM worked out (or read where it already was) and kept for every report of this league and season, Synergy read, every page built, then the PDF stored for the next email that carries it (deleted once emailed)';
  const bPdf = mk('Download PDF', 'pri', () => download('pdf'));
  const bImg = mk('Download images', '', () => download('png'));
  mk('Print', '', () => printPages(pages));
  outs.appendChild(status);
  bar.appendChild(outs);
  /* WHAT PRIME REPORT DID, read back where it is kept (primedSay) */
  const primedBox = el('div', 'rp-primed');
  primedBox.hidden = true;
  primedBox.setAttribute('role', 'status');
  bar.appendChild(primedBox);
  const pages = el('div', 'rp-pages');
  wrap.appendChild(pages);
  panel.appendChild(wrap);
  state.pages = pages;
  const persist = () => store.set(key, { on: conf.on, title: conf.title, tpl: conf.tpl, scope: conf.scope });
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
    if (!X || !sheets.length) { say('nothing to download yet'); return false; }
    let done = false;
    bPdf.disabled = bImg.disabled = true;
    const z = pages.style.getPropertyValue('--rp-z');
    pages.style.setProperty('--rp-z', '1');            // drawn at its own size, whatever the column shows
    try {
      const name = (state.c && state.c.file) || 'report';
      /* the mailer's copy (EPINOIA_RP_BOT) at email weight: twice the page's size (about 190 dpi on A4) and a lighter
         JPEG, a third of the bytes, so a week's reports go in one email */
      const bot = !!root.EPINOIA_RP_BOT;
      if (kind === 'pdf') await X.savePdf(sheets, name, { w: PAGE.w, h: PAGE.h, scale: bot ? 2 : 3, quality: bot ? 0.84 : 0.9, title: (state.c && state.c.docTitle) || 'Report', outline: state.outline || null, onProgress: (i, n) => say('drawing page ' + i + ' of ' + n + '…') });
      else await X.saveImages(sheets, name, { w: PAGE.w, h: PAGE.h, onProgress: (i, n) => say('drawing page ' + i + ' of ' + n + '…') });
      say('saved');
      setTimeout(() => say(''), 4000);
      done = true;
    } catch (e) {
      say('could not draw it here: use Print and save as PDF');
      if (root.console) root.console.warn('[report save]', e);
    }
    pages.style.setProperty('--rp-z', z || '1');
    fit();
    bPdf.disabled = bImg.disabled = false;
    return done;
  }

  /* every build is kept as state.current; one that a newer build overtakes stops where it is (R.stale), so whoever needs the
     WHOLE report (PRIME) waits until the newest build has finished: state.lastDone === state.running */
  function rebuild() {
    root.__rpBuilding = (root.__rpBuilding || 0) + 1;            // the mailer waits for none in flight before it takes the PDF
    const p = rebuildRun();
    p.finally(() => { root.__rpBuilding = Math.max(0, (root.__rpBuilding || 1) - 1); }).catch(() => null);
    return (state.current = p);
  }
  async function rebuildRun() {
    const run = ++state.running;
    say('building…');
    try {
      if (state.scopeReady) await state.scopeReady;                // the competitions chosen, before anything is read
      if (run !== state.running) return;
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
        /* each block knows its section: the PDF's bookmarks put a section's headings under it */
        blocks.forEach(b => { if (b && b.setAttribute) b.setAttribute('data-mod', m.page || m.title); });
        /* a module starts a page of its own unless it says it may follow on (pack: true, the combinations after the
           depth chart): a new section half-way down a page read as clutter (Louie, 2026-10-02) */
        const at = layout(pagesNew, c, m.page || m.title, blocks, { pack: m.pack === true });
        toc.push([m.page || m.title, [...pagesNew.querySelectorAll('.rp-pg')].indexOf(at) + 1]);
      }
      const lg = o.modules.find(m => m.key === 'legend');
      /* every stat a page printed by its key has its entry, whichever module drew it (linkLegend links it there) */
      if (lg && conf.on.legend) R.legend.push(...[...pagesNew.querySelectorAll('[data-lg]')].map(e => e.getAttribute('data-lg')).filter(Boolean));
      if (lg && conf.on.legend && (R.legend.length || R.legendExtra.length)) {
        toc.push(['LEGEND', pagesNew.querySelectorAll('.rp-pg').length + 1]);
        layout(pagesNew, c, 'LEGEND', legendBlocks(R.legend, R.legendExtra, o.kind, R.pooled));
        R.lgLinks = linkLegend(pagesNew);
      }
      const tocEl = pagesNew.querySelector('.rp-cv-toc');
      const cap = t => t.charAt(0) + t.slice(1).toLowerCase();
      /* THE CONTENTS ARE LINKS (2026-10-07): each line goes to its page (data-goto: on the screen a scroll, in the PDF a link,
         raster.js), and every page's number goes back to the contents */
      if (tocEl) tocEl.innerHTML = toc.map(([t, n]) => '<li data-goto="' + n + '" title="Go to page ' + n + '"><span>' + esc(cap(t)) + '</span><i></i><b>' + n + '</b></li>').join('');
      /* HOW TO GET ROUND IT, on the cover under the contents (Louie, 2026-10-07): said only when the stats do link to a legend */
      const how = pagesNew.querySelector('.rp-cv-how');
      if (how && R.lgLinks) {
        how.innerHTML = '<b>How to use this report</b><span>Click any stat’s name to read what it means in the legend · click a line of the ' +
          'contents to go to that section · a page’s number brings you back here</span>';
        how.hidden = false;
      } else if (how) how.remove();
      const all = pagesNew.querySelectorAll('.rp-pg');
      all.forEach((p, i) => { const n = p.querySelector('.rp-no'); if (n) { n.textContent = (i + 1) + ' / ' + all.length; if (tocEl && i > 0) { n.setAttribute('data-goto', '1'); n.title = 'Back to the contents'; } } });
      /* THE BOOKMARKS (raster.js outline): every section at its first page, and the headings in it at theirs */
      const heads = [];
      all.forEach((p, i) => p.querySelectorAll('.rp-blk[data-mod]').forEach(b => {
        const h = b.querySelector('.rp-h h3'), pn = b.querySelector('.rp-pname');      // a heading; a player's card, by his name
        if (h && h.textContent.trim()) heads.push({ mod: b.getAttribute('data-mod'), title: h.textContent.trim(), page: i + 1 });
        if (pn && pn.textContent.trim()) heads.push({ mod: b.getAttribute('data-mod'), title: pn.textContent.trim(), page: i + 1 });
      }));
      state.outline = (tocEl ? [{ title: 'Cover and contents', page: 1 }] : []).concat(toc.map(([t, n]) => ({
        title: cap(t), page: n,
        kids: heads.filter((x, k) => x.mod === t && !heads.slice(0, k).some(y => y.mod === t && y.title === x.title)).map(x => ({ title: x.title, page: x.page }))
      })));
      pagesNew.addEventListener('click', e => {
        const g = e.target && e.target.closest ? e.target.closest('[data-goto]') : null;
        /* a stat's name: to its legend row itself, lit for a moment (linkLegend) */
        const lk = g && g.getAttribute('data-lgto');
        const row = lk ? [...pagesNew.querySelectorAll('.rp-lg-row[data-lgk]')].find(r => r.getAttribute('data-lgk') === lk) : null;
        if (row && row.scrollIntoView) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.remove('rp-lg-hit'); void row.offsetWidth; row.classList.add('rp-lg-hit');
          setTimeout(() => row.classList.remove('rp-lg-hit'), 2400);
          return;
        }
        const to = g ? pagesNew.querySelectorAll('.rp-pg')[+g.getAttribute('data-goto') - 1] : null;
        if (to && to.scrollIntoView) to.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      say(all.length + (all.length === 1 ? ' page' : ' pages'));
      stand(pagesNew);
      (state.onBuilt || []).forEach(f => { try { f(); } catch (_) { /* a label */ } });
      /* the mailer waits for this before it asks for the PDF */
      state.lastDone = run;
      root.__rpBuilt = (root.__rpBuilt || 0) + 1;
    } catch (e) {
      warn(e);
      say('the report could not be built: ' + (e.message || e));
    }
  }
  state.rebuild = rebuild;
  const PRIME_CAP_MS = 240000;
  /* PRIME REPORT KEEPS THE PDF FOR SENDING (0229) in place of downloading it: drawn at email weight (as the mailer draws its own),
     kept in the private 'primed' bucket with its row in primed_reports - then READ BACK - where the mailer takes it in place of
     drawing one (while no game of the club has been finalised since) and deletes it once it has been emailed. o.kind and o.id
     say whose report it is; a platform administrator's sign-in keeps it. */
  async function storeForSending() {
    const X = root.EpinoiaRaster, sheets = [...pages.querySelectorAll('.rp-pg')];
    if (!X || !X.pdfBytes || !sheets.length || !o.id) return { ok: false, text: 'nothing could be stored for sending' };
    const c = await synClient();
    if (!c || !c.storage || !c.from) return { ok: false, text: 'not stored for sending: a platform administrator\u2019s sign-in is needed' };
    const z = pages.style.getPropertyValue('--rp-z');
    pages.style.setProperty('--rp-z', '1');
    try {
      const bytes = await X.pdfBytes(sheets, { w: PAGE.w, h: PAGE.h, scale: 2, quality: 0.84, title: (state.c && state.c.docTitle) || 'Report', outline: state.outline || null,
        onProgress: (i, n) => say('drawing page ' + i + ' of ' + n + ' for sending\u2026') });
      const path = o.kind + '/' + o.id + '.pdf';
      say('storing it for sending\u2026');
      const up = await c.storage.from('primed').upload(path, new root.Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' });
      if (up && up.error) return { ok: false, text: 'not stored for sending (' + (up.error.message || up.error) + ')' };
      const row = { kind: o.kind, ref_id: o.id, path, title: (state.c && state.c.name) || null, bytes: bytes.length, primed_at: new Date().toISOString() };
      const w = await c.from('primed_reports').upsert(row, { onConflict: 'kind,ref_id' });
      if (w.error) return { ok: false, text: 'not stored for sending (' + (w.error.message || w.error) + ')' };
      const back = await c.from('primed_reports').select('bytes,primed_at').eq('kind', o.kind).eq('ref_id', o.id).limit(1);
      const got = back && !back.error && back.data && back.data[0];
      say('');
      return got ? { ok: true, text: 'stored for sending (' + (got.bytes / 1e6).toFixed(1) + ' MB): the next email carrying this report sends this file, and it is deleted once emailed' }
                 : { ok: false, text: 'stored, but it could not be read back: prime it again' };
    } catch (e) {
      return { ok: false, text: 'not stored for sending (' + (e.message || e) + ')' };
    } finally { pages.style.setProperty('--rp-z', z || '1'); fit(); }
  }
  /* each step says what it did ({ ok, text }); green when all is ready for the emailed reports, amber with what is not */
  function primedSay(results) {
    const good = results.every(r => r.ok), t = new Date(), two = n => String(n).padStart(2, '0');
    primedBox.className = 'rp-primed ' + (good ? 'ok' : 'gap');
    primedBox.textContent = '';
    primedBox.append(el('b', null, (good ? '\u2713 Primed' : '\u26a0 Primed, with gaps') + ' at ' + two(t.getHours()) + ':' + two(t.getMinutes())),
      el('span', null, results.map(r => r.text).join(' \u00b7 ') + (good ? '. The emailed reports are drawn with the same.' : '.')));
    primedBox.hidden = false;
  }
  async function prime(dl) {
    if (state.primed === 'running') return;
    state.primed = 'running'; bPrime.disabled = true; root.__rpBusy = (root.__rpBusy || 0) + 1;
    primedBox.hidden = true;
    try {
      say('priming: RAPM, Synergy and every page\u2026');
      const results = [];
      const primers = (async () => { for (const f of state.primers || []) {
        try { const r = await f(); if (r && r.text) results.push(r); } catch (e) { warn(e); results.push({ ok: false, text: 'a step failed: ' + (e.message || e) }); } } })();
      /* the mailer's copy never waits on it for ever: past PRIME_CAP_MS it is drawn with what is there (RAPM blank) */
      await (root.EPINOIA_RP_BOT ? Promise.race([primers, new Promise(r => setTimeout(r, PRIME_CAP_MS))]) : primers);
      /* THE FINISHED REPORT, not a half one: the page hands its data over as it arrives and each piece asks for a rebuild,
         which stops the one before it part-way (2026-10-04: player reports stored as their cover alone). Wait for the newest. */
      await rebuild();
      for (let i = 0; i < 40 && state.lastDone !== state.running; i++) await (state.current || Promise.resolve()).catch(() => null);
      const n = pages.querySelectorAll('.rp-pg').length;
      /* a player report is never one page (the cover alone means its data did not arrive): said, and not stored for sending */
      const thin = o.kind === 'player' && n < 2;
      results.push({ ok: n > 0 && !thin, text: n ? n + (n === 1 ? ' page' : ' pages') + ' built' + (thin ? ' — the cover alone: their numbers had not loaded, so it was NOT stored; prime it again' : '') : 'no pages were built' });
      if (dl && !thin && n > 0) results.push(await storeForSending());
      primedSay(results);
    } finally { state.primed = 'done'; state.priming = false; bPrime.disabled = false; root.__rpBusy = Math.max(0, (root.__rpBusy || 1) - 1); }
  }
  state.prime = prime;
  /* the modules' own controls, drawn once; primed on opening when asked (?prime=1: the reports manager's PRIME REPORT, which
     stores it for sending too; EPINOIA_RP_PRIME: the mailer, which takes the PDF itself) */
  const q = new URLSearchParams(root.location.search);
  const primeNow = q.get('prime') === '1' || !!root.EPINOIA_RP_PRIME;
  state.priming = primeNow;
  o.modules.forEach(m => { if (m.controls) { try { m.controls(extras, state); } catch (e) { warn(e); } } });
  if (primeNow) prime(q.get('prime') === '1' && !root.EPINOIA_RP_BOT); else rebuild();
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

return { mount, WHY, shotMixHTML, keyBox, keyHTML, loadPrior, priorRows, inkOn, colsHTML, rapmControl, rapmOn, rapmKey, bandVs, refOf, zoneColumnsHTML, sitSeason, sitCardHTML, STATS, DEFS, TPL, derive, ranker, statRowHTML, statCellHTML, stand, groupRowsHTML, groupCellsHTML, groupWeight, shotRuns, SHOT_KIND, posCourtHTML, POS_KEY, block, title, frag, el, esc,
         fmtStat, ordinal, band, posGroup, templateControl, groupsFor, templateOf, turnoverTypes, hcAssists, hcAstOf, trAstOf, HC_MIN, synergyOf, synergySave, synergyOnRow, hasStat, groupsOn, sideTone, synergyControl, synergySource, driveChartHTML, driveTableHTML, directionMixHTML, miniZonesHTML, leanColour, posPools, posRanker, POS_PLURAL, layout, legendBlocks, PAGE, SLOTS, isNum };
}));
