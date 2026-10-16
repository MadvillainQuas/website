'use strict';
/* ============================================================================
   THE MATCH REPORT'S FULL STATS TABLE, SHARED (2026-10-16). game/analysis.js prints it for both teams of a game (its FULL
   STATS pages); the player report (report-playerpages.js, GAMES PLAYED DURING THE WEEK; Louie: "the match report pdfs full
   table segments - but only for that player and with their rows stacked ... organised by the games that were played")
   prints one player's line from each game of a week, a row a game, under the same column groups, labels, shading and bars.

     COL, GRP, PARTS      the printed column labels, the group bands' names, and the three parts a game's table is cut into
     table(o)             the <table class="ga-fs">: o.groups (boxscore.js ADV_GROUPS), o.keep (the groups to draw),
                          o.rows, o.ctxOf(r) -> { TT, OT, gameAvg, ranges, rate(col, r) } (a game's own, so rows from
                          different games each read against their own), o.nameCell(r) (the row's first cell, inside its
                          <td>), o.head (the first column's heading), o.totals { label, values } or none
     fromStored(st, ts)   a player's stored game line (player_game_stats.stats: its adv, the counts beside it) -> a row with
                          every column the table draws, the three the stored line lacks (eFG%, the two on-court FT rates)
                          worked out from its counts
     gameContext(...)     a game's TT/OT, average and bar ranges from its stored lines, as the game page's own tab has them
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGameFull = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* the printed labels: the standard abbreviations, broken where a column is too narrow for one line */
const COL = {
  fgm: ['FGM'], ast: ['AST'], pts: ['PTS'], ptsAst: ['AST', 'PTS'], tpc: ['PTS', 'CREATED'], ppp: ['PTS /', 'POSS'], ts: ['TS%'],
  usg: ['USG%'], au: ['AST /', 'USG'], min: ['MIN'],
  rimA: ['RIM', 'FGA'], rimP: ['RIM', 'FG%'], midA: ['MID', 'FGA'], midP: ['MID', 'FG%'], p3a: ['3PA'], p3P: ['3P%'], efg: ['eFG%'],
  astPct: ['AST%'], tovP: ['TOV%'], stlP: ['STL%'], blkP: ['BLK%'], ftr: ['FT', 'RATE'], orebP: ['OREB%'], drebP: ['DREB%'],
  ocOrtg: ['ORTG'], ocEfg: ['eFG%'], ocOreb: ['OREB%'], ocTov: ['TOV%'], ocFtr: ['FT', 'RATE'], pacePM: ['PACE', '±'],
  ocDrtg: ['DRTG'], ocOppEfg: ['OPP', 'eFG%'], ocOppOreb: ['OPP', 'OREB%'], ocTovF: ['TOV', 'FORCED'], ocOppFtr: ['OPP FT', 'RATE'], net: ['NET', 'RTG']
};
const GRP = { scoring: 'Scoring', usage: 'Usage', shotdist: 'Shot selection', individual: 'Individual rates',
  offcourt: 'Team offence · player on court', defcourt: 'Team defence · player on court' };
const PARTS = [
  ['Scoring and usage', ['scoring', 'usage'], 'points, shooting efficiency and share of the offence',
    [['FGM', 'field goals made'], ['AST', 'assists'], ['PTS', 'points'], ['AST PTS', 'points scored from the player’s assists'],
     ['PTS CREATED', 'own points plus points assisted'], ['PTS / POSS', 'points for each possession the player used'],
     ['TS%', 'true shooting: efficiency counting threes and free throws'], ['USG%', 'share of the team’s possessions the player finished while on court'],
     ['AST / USG', 'assists for each possession used (a passer reads high)'], ['MIN', 'minutes played']]],
  ['Shot selection and individual rates', ['shotdist', 'individual'], 'where each player shot from, and their share of the plays at both ends',
    [['RIM / MID FGA, 3PA', 'shots at the rim, from mid-range and from three'], ['RIM / MID FG%, 3P%', 'the share of them made'],
     ['eFG%', 'field-goal percentage with a three worth one and a half twos'], ['AST%', 'share of team-mates’ baskets assisted while on court'],
     ['TOV%', 'possessions used that ended in a turnover (lower is better)'], ['STL% / BLK%', 'opponent possessions stolen, opponent shots blocked'],
     ['FT RATE', 'free throws attempted per 100 field-goal attempts'], ['OREB% / DREB%', 'share of available rebounds taken at each end']]],
  ['On the floor at both ends', ['offcourt', 'defcourt'], 'the team with each player on court, against its whole game',
    [['ORTG / DRTG', 'points scored / allowed per 100 possessions (lower DRTG is better)'], ['eFG%', 'the team’s shooting'],
     ['OREB%', 'the team’s offensive rebounding'], ['TOV%', 'the team’s turnovers (lower is better)'], ['FT RATE', 'free throws drawn'],
     ['PACE ±', 'faster (+) or slower (−) with the player on court'], ['OPP eFG% / OREB% / FT RATE', 'the opponent’s shooting, rebounding and free throws (lower is better)'],
     ['TOV FORCED', 'opponent turnovers forced'], ['NET RTG', 'points per 100 scored minus allowed with the player on court'],
     ['ALL FIGURES', 'the difference from the team’s whole game: green better, red worse']]]
];
/* a percentile (gamepct.js: g its goodness, d its direction) in the report's four bands, 9 a style */
const bandOf = R => (!R ? 0 : !R.d ? 9 : R.g >= 75 ? 4 : R.g >= 50 ? 3 : R.g >= 25 ? 2 : 1);
const signed = (v, dp) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp || 0);

/* one figure's cell: the value, its percentile's band, and a bar for its size (beside its game's other players), its
   difference from its game's average, or its count of shots */
function fig(cx, col, v, r, R, tot) {
  let txt, bar = '', cls = '';
  if (!isFinite(v)) return '<td class="fs-v"><b>–</b></td>';
  const avg = (cx && cx.gameAvg) || {};
  if (col.pill) { txt = signed(v, col.dec != null ? col.dec : 0); cls = v > 0 ? ' pos' : v < 0 ? ' neg' : ''; }
  else if (col.diff) {
    const dff = v - (avg[col.diff] || 0), eff = col.inv ? -dff : dff, w = Math.max(0, Math.min(50, Math.abs(eff) / 15 * 50));
    txt = (dff > 0 ? '+' : dff < 0 ? '−' : '') + Math.abs(dff).toFixed(0);
    cls = Math.abs(dff) < 0.5 ? '' : eff > 0 ? ' pos' : ' neg';
    if (!tot) bar = '<span class="fs-d"><i class="' + (eff >= 0 ? 'p' : 'n') + '" style="' + (eff >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(0) + '%"></i></span>';
  } else if (col.shot) { txt = String(v); if (!tot) bar = '<span class="fs-b"><i style="width:' + Math.max(3, Math.min(100, v / 10 * 100)).toFixed(0) + '%"></i></span>'; }
  else {
    txt = col.f(v, r);
    if (col.bar && !tot) {
      const rg = cx && cx.ranges && cx.ranges[col.k];
      let w = !rg || rg.max === rg.min ? 0 : Math.max(0, Math.min(100, (v - rg.min) / (rg.max - rg.min) * 100));
      if (col.invbar) w = 100 - w;
      bar = '<span class="fs-b"><i style="width:' + Math.max(3, w).toFixed(0) + '%"></i></span>';
    }
  }
  const b = tot ? 0 : bandOf(R);
  return '<td class="fs-v' + cls + '"' + (b ? ' data-b="' + b + '"' : '') + '><b>' + esc(txt) + '</b>' + bar + '</td>';
}

function table(o) {
  const groups = o.groups.filter(g => o.keep.indexOf(g.key) >= 0);
  const head = '<colgroup><col class="fs-cn">' + groups.map(g => g.cols.map(() => '<col>').join('')).join('') + '</colgroup>' +
    '<thead><tr class="fs-gr"><th class="fs-n" rowspan="2">' + esc(o.head || 'Player') + '</th>' + groups.map(g => '<th class="fs-g g-' + g.key + '" colspan="' + g.cols.length + '">' + esc(GRP[g.key] || g.label) + '</th>').join('') + '</tr>' +
    '<tr class="fs-lr">' + groups.map(g => g.cols.map((col, i) => '<th class="g-' + g.key + (i === 0 ? ' fs-first' : '') + '">' + (COL[col.k] || [col.l.toUpperCase()]).map(esc).join('<br>') + '</th>').join('')).join('') + '</tr></thead>';
  const rows = o.rows.map(r => {
    const cx = o.ctxOf(r) || {};
    return '<tr' + (o.rowAttr ? o.rowAttr(r) : '') + '><td class="fs-n">' + o.nameCell(r) + '</td>' +
      groups.map(g => g.cols.map((col, i) => {
        const R = col.gp && cx.rate ? cx.rate(col, r) : null;
        return fig(cx, col, r[col.k], r, R).replace('<td class="fs-v', '<td class="fs-v g-' + g.key + (i === 0 ? ' fs-first' : ''));
      }).join('')).join('') + '</tr>';
  }).join('');
  const T = o.totals;
  const tot = T ? '<tr class="fs-tot"><td class="fs-n"><span class="fs-who"><b>' + esc(T.label) + '</b></span></td>' + groups.map(g => g.cols.map((col, i) => {
    const v = T.values[col.k];
    return (v == null ? '<td class="fs-v"><b>–</b></td>' : fig(T.ctx || null, col, v, T.values, null, true)).replace('<td class="fs-v', '<td class="fs-v g-' + g.key + (i === 0 ? ' fs-first' : ''));
  }).join('')).join('') + '</tr>' : '';
  return '<table class="ga-fs' + (o.cls ? ' ' + o.cls : '') + '">' + head + '<tbody>' + rows + tot + '</tbody></table>';
}

const dv = (a, b) => (b ? a / b : 0);
/* a player's stored game line -> the table's row: adv as finalise-game stored it, and eFG% and the two on-court free-throw
   rates from the counts beside it (engine.js playerAdv does not store them; boxscore.js works them out the same way) */
function fromStored(st) {
  const s = st || {}, a = Object.assign({}, s.adv || {});
  const fga = (+s.p2a || 0) + (+s.p3a || 0), fgm = (+s.p2m || 0) + (+s.p3m || 0);
  if (a.efg == null) a.efg = dv(fgm + 0.5 * (+s.p3m || 0), fga) * 100;
  const oc = s.oc || {};
  if (a.ocFtr == null) a.ocFtr = dv(+oc.tFTA || 0, +oc.tFGA || 0) * 100;
  if (a.ocOppFtr == null) a.ocOppFtr = dv(+oc.oFTA || 0, +oc.oFGA || 0) * 100;
  if (a.fgm == null) a.fgm = fgm;
  return a;
}
/* a game's context from its stored lines: both teams' adv (team_game_stats), the game's average of the four factors, and the
   bar ranges across every player of the game who played (boxscore.js, the tab's own) */
function gameContext(teamAdv, playerRows, groups) {
  const TA = [teamAdv[0] || {}, teamAdv[1] || {}];
  const gameAvg = { ortg: (+TA[0].ortg + +TA[1].ortg) / 2, efg: (+TA[0].efg + +TA[1].efg) / 2,
    orebp: (+TA[0].orebp + +TA[1].orebp) / 2, tovp: (+TA[0].tovp + +TA[1].tovp) / 2, ftr: (+TA[0].ftr + +TA[1].ftr) / 2 };
  const all = (playerRows || []).filter(r => r && +r.min > 0);
  const ranges = {};
  (groups || []).forEach(g => g.cols.forEach(c => {
    if (c.bar) { const vs = all.map(r => +r[c.k]).filter(v => isFinite(v)); ranges[c.k] = { min: Math.min(...vs, 0), max: Math.max(...vs, 0) }; }
  }));
  return { TA, gameAvg, ranges };
}

return { COL, GRP, PARTS, bandOf, signed, table, fig, fromStored, gameContext, esc };
}));
