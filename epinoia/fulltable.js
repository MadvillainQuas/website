'use strict';
/* ============================================================================
   EPINOIA FULL TABLE

   A port of index_9's full table onto Epinoia's own data: preset column sets,
   per-column toggles, sortable sticky header, search, minimum games, CSV, and
   the percentile heat map that makes a wide table readable at a glance.

   PROGRESSIVE DISCLOSURE IS THE POINT. The table opens on per-game counting
   stats — the columns someone who has never read an advanced box score already
   understands — and on the team side adds the four factors, because those four
   numbers decide basketball games and need no grounding to read. Everything
   else is one press away and nothing is hidden, but nobody is met with forty
   columns of rate statistics on arrival.

   Fed by epinoia/season.js, which does all the arithmetic. Nothing here computes
   a statistic; this decides what to show and how to rank it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTable = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
/* a plus/minus is meaningless without its sign: "3.9" and "-3.9" are
   opposite verdicts and must not look alike at a glance */
const sgn1 = v => (v == null || !isFinite(v)) ? '—'
  : (v > 0 ? '+' : '') + Number(v).toFixed(1);
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const f2 = v => (v == null ? '—' : Number(v).toFixed(2));
const f0 = v => (v == null ? '—' : String(v));
const sgn = v => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1));
const sgn0 = v => (v == null ? '—' : (v > 0 ? '+' : '') + v);
const pair = (m, a) => (m == null ? '—' : m + '-' + a);
const pg   = (m, a) => (m == null ? '—' : Number(m).toFixed(1) + '-' + Number(a).toFixed(1));
/* The events columns' own formatters. A split is null twice over -- a season with no games
   carrying the splits, and a rate over no attempts -- so anything that is not a finite number
   prints as a dash rather than as NaN. */
const e0  = v => (v == null || !isFinite(v) ? '—' : String(v));
const e1  = v => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(1));
const e2  = v => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(2));
const epg = (m, a) => (m == null || a == null || !isFinite(m) || !isFinite(a) ? '—'
  : Number(m).toFixed(1) + '-' + Number(a).toFixed(1));

/* the events presets, one per situation plus assisted against unassisted (columns further down) */
const EV_SITS = [['second', 'second chance', 'Second chance'], ['transition', 'transition', 'Transition'],
                 ['offTo', 'off turnovers', 'Off turnovers'], ['ato', 'after timeout', 'After timeout'],
                 ['half', 'half court', 'Half court']];
const EV_GROUPS = EV_SITS.map(([s]) => 'ev_' + s).concat('ev_assist');

/* ------------------------------------------------------------- catalogue ---
   g      the groups this column belongs to (a preset is a set of groups)
   low    lower is better — the heat map must rank it in reverse
   heat   include in the percentile heat map (identity columns must not be)
   t      a longer name for the header's hover title and the column drawer, where a
          short label alone is ambiguous (every events preset has its own PTS/G)   */
const P = [
  /* THE FIRST COLUMN COUNTS THE TABLE AS IT IS SORTED, the way the team table's
     already does: sort by rebounds and the leading rebounder is 1. It used to hold
     the jersey, which never moved however the table was sorted and left a reader
     with no way of telling twelfth from thirtieth. The jersey is not shown in a stats
     table at all (2026-09-17): a squad number says nothing about a season's numbers,
     and the roster is where it belongs. Clicking this column puts the table back in
     the order it arrived in. */
  { k:'rank', l:'#', g:['id'], fmt:(r, i) => i + 1, sort:r=>r.__i },
  { k:'name',   l:'PLAYER', g:['id'], fmt:r=>r.name, text:true },
  { k:'teamName', l:'TEAM', g:['id'], fmt:r=>r.teamName||'', text:true },
  { k:'gp',  l:'GP',  g:['basic','totals','shooting','playmaking','defense','rebounding','onoff','vs','advanced','misc'].concat(EV_GROUPS), fmt:r=>f0(r.gp), ord:{advanced:0} },

  /* per game — the default view */
  { k:'mpg',  l:'MPG',  g:['basic'], fmt:r=>f1(r.mpg),  heat:1 },
  { k:'ppg',  l:'PPG',  g:['basic'], fmt:r=>f1(r.ppg),  heat:1, lead:1 },
  { k:'rpg',  l:'RPG',  g:['basic','rebounding'], fmt:r=>f1(r.rpg),  heat:1 },
  { k:'orpg', l:'ORPG', g:['rebounding'], fmt:r=>f1(r.orpg), heat:1 },
  { k:'drpg', l:'DRPG', g:['rebounding','defense'], fmt:r=>f1(r.drpg), heat:1 },
  { k:'apg',  l:'APG',  g:['basic','playmaking'], fmt:r=>f1(r.apg),  heat:1 },
  { k:'spg',  l:'SPG',  g:['basic','defense'], fmt:r=>f1(r.spg),  heat:1 },
  { k:'bpg',  l:'BPG',  g:['basic','defense'], fmt:r=>f1(r.bpg),  heat:1 },
  { k:'topg', l:'TOPG', g:['basic','playmaking'], fmt:r=>f1(r.topg), heat:1, low:1 },
  { k:'pfpg', l:'PFPG', g:['basic','defense'], fmt:r=>f1(r.pfpg), heat:1, low:1 },

  /* totals */
  { k:'min',  l:'MIN',  g:['totals'], fmt:r=>f1(r.min),  heat:1 },
  { k:'pts',  l:'PTS',  g:['totals'], fmt:r=>f0(r.pts),  heat:1, lead:1 },
  { k:'reb',  l:'REB',  g:['totals'], fmt:r=>f0(r.reb), heat:1 },
  { k:'oreb', l:'OREB', g:['totals'], fmt:r=>f0(r.oreb), heat:1 },
  { k:'dreb', l:'DREB', g:['totals'], fmt:r=>f0(r.dreb), heat:1 },
  { k:'ast',  l:'AST',  g:['totals'], fmt:r=>f0(r.ast), heat:1 },
  { k:'stl',  l:'STL',  g:['totals'], fmt:r=>f0(r.stl), heat:1 },
  { k:'blk',  l:'BLK',  g:['totals'], fmt:r=>f0(r.blk), heat:1 },
  { k:'tov',  l:'TO',   g:['totals'], fmt:r=>f0(r.tov), heat:1, low:1 },
  { k:'pf',   l:'PF',   g:['totals'], fmt:r=>f0(r.pf), heat:1, low:1 },
  { k:'fd',   l:'FD',   g:['totals'], fmt:r=>f0(r.fd), heat:1 },
  { k:'ptsAst', l:'PTS AST', g:['totals'], fmt:r=>f0(r.ptsAst), heat:1 },
  { k:'paint', l:'PAINT', g:['totals'], fmt:r=>f0(r.paint), heat:1 },
  { k:'fast',  l:'TRANS', g:['totals'], fmt:r=>f0(r.fast), heat:1 },
  { k:'sc',    l:'2ND',   g:['totals'], fmt:r=>f0(r.sc), heat:1 },
  { k:'pot',   l:'PoT',   g:['totals'], fmt:r=>f0(r.pot), heat:1 },

  /* shooting */
  /* per game, made-attempted: "6.2-11.4" is the shape of a night's work,
     where a season total of "192-440" needs dividing in your head first */
  { k:'fgm_pg', l:'FG',   g:['basic','shooting'], fmt:r=>pg(r.fgm_pg,r.fga_pg), sort:r=>r.fgm_pg, w:62 },
  { k:'fg_pct', l:'FG%',  g:['basic','shooting'], fmt:r=>f1(r.fg_pct), heat:1 },
  { k:'p2_pct', l:'2P%',  g:['shooting'], fmt:r=>f1(r.p2_pct), heat:1 },
  { k:'p3m_pg', l:'3PT',  g:['basic','shooting'], fmt:r=>pg(r.p3m_pg,r.p3a_pg), sort:r=>r.p3m_pg, w:62 },
  { k:'p3_pct', l:'3P%',  g:['basic','shooting'], fmt:r=>f1(r.p3_pct), heat:1 },
  { k:'ftm_pg', l:'FT',   g:['basic','shooting'], fmt:r=>pg(r.ftm_pg,r.fta_pg), sort:r=>r.ftm_pg, w:62 },
  { k:'ft_pct', l:'FT%',  g:['basic','shooting'], fmt:r=>f1(r.ft_pct), heat:1 },
  { k:'fgm',    l:'FG TOT',  g:['totals'], fmt:r=>pair(r.fgm,r.fga), sort:r=>r.fgm, w:70 },
  { k:'p3m',    l:'3PT TOT', g:['totals'], fmt:r=>pair(r.p3m,r.p3a), sort:r=>r.p3m, w:70 },
  { k:'ftm',    l:'FT TOT',  g:['totals'], fmt:r=>pair(r.ftm,r.fta), sort:r=>r.ftm, w:70 },
  /* BPM 2.0: points per 100 possessions over a league-average player, from the
     box score. An estimate, not a measurement — it cannot see a closeout — but
     it is the single number that comes closest to "how good was this player",
     which is why it leads the advanced group. */
  { k:'bpm',  l:'BPM',  g:['advanced'], fmt:r=>sgn1(r.bpm),  heat:1, w:58, ord:{advanced:16} },
  { k:'obpm', l:'OBPM', g:['advanced'], fmt:r=>sgn1(r.obpm), heat:1, w:60, ord:{advanced:17} },
  { k:'dbpm', l:'DBPM', g:['advanced'], fmt:r=>sgn1(r.dbpm), heat:1, w:60, ord:{advanced:18} },
  { k:'vorp', l:'VORP', g:['advanced'], fmt:r=>f1(r.vorp),   heat:1, w:58, ord:{advanced:19} },
  { k:'efg',    l:'eFG%', g:['shooting','advanced'], fmt:r=>f1(r.efg), heat:1, ord:{advanced:2} },
  { k:'ts',     l:'TS%',  g:['shooting','advanced'], fmt:r=>f1(r.ts),  heat:1, ord:{advanced:1} },
  /* Each zone's accuracy with the volume it rests on, in that order — the same
     pairing the team table uses and the player profile's bars show. 60% at the
     rim means one thing on eight attempts a night and nothing at all on one,
     and a column of percentages with no volume beside it invites exactly that
     mistake. */
  { k:'rim_pct',  l:'RIM%',   g:['shooting'], fmt:r=>f1(r.rim_pct), heat:1 },
  { k:'rim_apg',  l:'RIMA/G', g:['shooting'], fmt:r=>f1(r.rim_apg), heat:1, w:64 },
  { k:'mid_pct',  l:'MID%',   g:['shooting'], fmt:r=>f1(r.mid_pct), heat:1 },
  { k:'mid_apg',  l:'MIDA/G', g:['shooting'], fmt:r=>f1(r.mid_apg), heat:1, w:64 },
  { k:'rim_rate', l:'RIM/FGA', g:['shooting'], fmt:r=>f1(r.rim_rate), heat:1 },
  { k:'mid_rate', l:'MID/FGA', g:['shooting'], fmt:r=>f1(r.mid_rate), heat:1 },
  { k:'p3_rate',  l:'3PA/FGA', g:['shooting'], fmt:r=>f1(r.p3_rate),  heat:1 },
  { k:'ftr',      l:'FTr',   g:['shooting','advanced'], fmt:r=>f1(r.ftr), heat:1, ord:{advanced:20} },

  /* playmaking */
  { k:'ast_pct', l:'AST%',    g:['playmaking','advanced'], fmt:r=>f1(r.ast_pct), heat:1, ord:{advanced:6} },
  { k:'tov_pct', l:'TOV%',    g:['playmaking','advanced'], fmt:r=>f1(r.tov_pct), heat:1, low:1, ord:{advanced:7} },
  { k:'ast_to',  l:'A/TO',    g:['playmaking'], fmt:r=>f2(r.ast_to), heat:1 },
  { k:'au',      l:'AST/USG', g:['playmaking'], fmt:r=>f2(r.au), heat:1 },
  { k:'ptsAst_pg',  l:'PTS AST/G', g:['playmaking'], fmt:r=>f1(r.ptsAst_pg), heat:1, w:70 },
  { k:'contrib_pg', l:'PTS CONTRIB/G', g:['playmaking'], fmt:r=>f1(r.contrib_pg), heat:1, w:86 },
  /* the miscellany: where a player's points come from, per game */
  { k:'paint_pg', l:'PAINT/G', g:['misc'], fmt:r=>f1(r.paint_pg), heat:1 },
  { k:'fast_pg',  l:'TRANS/G', g:['misc'], fmt:r=>f1(r.fast_pg),  heat:1 },
  { k:'sc_pg',    l:'2ND/G',   g:['misc'], fmt:r=>f1(r.sc_pg),    heat:1 },
  { k:'pot_pg',   l:'PoT/G',   g:['misc'], fmt:r=>f1(r.pot_pg),   heat:1 },

  /* defence + rebounding rates */
  { k:'stl_pct',  l:'STL%',  g:['defense','advanced'], fmt:r=>f1(r.stl_pct), heat:1, ord:{advanced:8} },
  { k:'blk_pct',  l:'BLK%',  g:['defense','advanced'], fmt:r=>f1(r.blk_pct), heat:1, ord:{advanced:9} },
  { k:'oreb_pct', l:'OREB%', g:['rebounding','advanced'], fmt:r=>f1(r.oreb_pct), heat:1, ord:{advanced:3} },
  { k:'dreb_pct', l:'DREB%', g:['rebounding','defense','advanced'], fmt:r=>f1(r.dreb_pct), heat:1, ord:{advanced:4} },
  { k:'trb_pct',  l:'TRB%',  g:['rebounding','advanced'], fmt:r=>f1(r.trb_pct), heat:1, ord:{advanced:5} },
  /* the rebounding on/off: the team's share with him on against off, both ends */

  /* usage and efficiency */
  { k:'usg',   l:'USG%', g:['advanced'], fmt:r=>f1(r.usg), heat:1, ord:{advanced:10} },
  { k:'total_s', l:'TOTAL S%', g:['advanced'], fmt:r=>f1(r.total_s), heat:1, ord:{advanced:11}, w:72 },
  { k:'ppr',   l:'PPR',  g:['advanced'], fmt:r=>f1(r.ppr), heat:1, ord:{advanced:12} },
  { k:'pps',   l:'PPS',  g:['advanced'], fmt:r=>f2(r.pps), heat:1, ord:{advanced:13} },
  { k:'on_ortg', l:'ORTG', g:['advanced'], fmt:r=>f1(r.on_ortg), heat:1, ord:{advanced:14} },
  { k:'on_drtg', l:'DRTG', g:['advanced'], fmt:r=>f1(r.on_drtg), heat:1, low:1, ord:{advanced:15} },
  { k:'ppp',   l:'PPP',  g:['advanced'], fmt:r=>f2(r.ppp), heat:1, ord:{advanced:21} },
  { k:'pts75', l:'PTS/75', g:['advanced'], fmt:r=>f1(r.pts75), heat:1, ord:{advanced:22} },
  { k:'poss',  l:'POSS/G', g:['advanced'], fmt:r=>f1(r.poss_pg), sort:r=>r.poss_pg, ord:{advanced:23} },

  /* on / off — the differential is the headline, so it leads the group */
  /* ON / OFF AS DIFFERENTIALS. Every column here is on-court minus off-court:
     how much better (or worse) the team is in that stat with him out there. A
     bare "ON eFG% 54.1" told a reader nothing without the off number beside it;
     "+4.2" is the claim itself. The raw on and off values stay on the row for
     anything that wants them, they just are not columns any more. */
  /* RAPM, FAR LEFT OF BOTH GROUPS AND EMPTY UNTIL ASKED FOR. It is the one number here
     that cannot be added up from a box score -- it is a regression over every stint of the
     competition -- so it is computed on the press of a button, and reads as dashes until
     then. DRAPM is the raw coefficient: a defender's column is -1, so HIGHER IS BETTER. */
  { k:'rapm',  l:'RAPM',  g:['onoff','advanced'], fmt:r=>sgn1(r.rapm),  heat:1, lead:1, ord:{onoff:-3, advanced:-3},
    t:'regularized adjusted plus-minus, points per 100 possessions — press calc RAPM' },
  { k:'orapm', l:'ORAPM', g:['onoff','advanced'], fmt:r=>sgn1(r.orapm), heat:1, ord:{onoff:-2, advanced:-2},
    t:'the offensive half of RAPM' },
  { k:'drapm', l:'DRAPM', g:['onoff','advanced'], fmt:r=>sgn1(r.drapm), heat:1, ord:{onoff:-1, advanced:-1},
    t:'the defensive half of RAPM — higher is better defence' },
  { k:'diff_net',  l:'NET ±',   g:['onoff'], fmt:r=>sgn(r.diff_net),  heat:1, lead:1, signed:1 },
  { k:'diff_ortg', l:'ORTG ±',  g:['onoff'], fmt:r=>sgn(r.diff_ortg), heat:1, signed:1 },
  { k:'diff_drtg', l:'DRTG ±',  g:['onoff'], fmt:r=>sgn(r.diff_drtg), heat:1, signed:1, low:1 },
  { k:'diff_pace', l:'PACE ±',  g:['onoff'], fmt:r=>sgn(r.diff_pace), heat:1, signed:1 },
  { k:'pm',        l:'+/-',     g:['basic','onoff'], fmt:r=>sgn0(r.pm), heat:1, signed:1 },
  { k:'diff_efg',  l:'eFG% ±',  g:['onoff'], fmt:r=>sgn(r.diff_efg),  heat:1, signed:1 },
  { k:'diff_oreb',    l:'OREB% ±',     g:['onoff','rebounding'], fmt:r=>sgn(r.diff_oreb), heat:1, signed:1 },
  { k:'diff_tov',  l:'TOV% ±',  g:['onoff'], fmt:r=>sgn(r.diff_tov),  heat:1, signed:1, low:1 },
  { k:'diff_ftr',  l:'FTr ±',   g:['onoff'], fmt:r=>sgn(r.diff_ftr),  heat:1, signed:1 },
  { k:'diff_vs_efg',  l:'OPP eFG% ±',  g:['onoff'], fmt:r=>sgn(r.diff_vs_efg),  heat:1, signed:1, low:1 },
  { k:'diff_vs_tov',  l:'OPP TOV% ±',  g:['onoff'], fmt:r=>sgn(r.diff_vs_tov),  heat:1, signed:1 },
  { k:'diff_vs_oreb', l:'OPP OREB% ±', g:['onoff','rebounding'], fmt:r=>sgn(r.diff_vs_oreb), heat:1, signed:1, low:1 },
  { k:'diff_vs_ftr',  l:'OPP FTr ±',   g:['onoff'], fmt:r=>sgn(r.diff_vs_ftr),  heat:1, signed:1, low:1 },

  /* what the opponent managed while he was on the floor */
  /* The defensive side is in the on/off group too, not only in "opponent".
     An on/off that shows what a team scores with a player and not what it
     concedes tells half the story, and the missing half is usually the reason
     the number looks the way it does. */
  { k:'vs_efg',  l:'OPP eFG%',  g:['vs','defense'], fmt:r=>f1(r.vs_efg),  heat:1, low:1 },
  { k:'vs_tov',  l:'OPP TOV%',  g:['vs','defense'], fmt:r=>f1(r.vs_tov),  heat:1 },
  { k:'vs_oreb', l:'OPP OREB%', g:['vs','defense'], fmt:r=>f1(r.vs_oreb), heat:1, low:1 },
  { k:'vs_ftr',  l:'OPP FTr',   g:['vs'], fmt:r=>f1(r.vs_ftr), heat:1, low:1 }
];

const T = [
  { k:'rank', l:'#',    g:['id'], fmt:(r,i)=>String(i+1), sort:r=>r.__i },
  { k:'name', l:'TEAM', g:['id'], fmt:r=>r.name, text:true },
  { k:'gp',   l:'GP',   g:['basic','four','shooting','scoring','ratings','totals','defense','z_rim','z_mid','z_three','z_cuts','z_rate'].concat(EV_GROUPS), fmt:r=>f0(r.gp) },

  { k:'ppg',    l:'PPG',  g:['basic'], fmt:r=>f1(r.ppg),  heat:1, lead:1 },
  { k:'papg',   l:'OPP',  g:['basic'], fmt:r=>f1(r.papg), heat:1, low:1 },
  { k:'diffpg', l:'DIFF', g:['basic'], fmt:r=>sgn(r.diffpg), heat:1, signed:1, lead:1 },
  { k:'rpg',    l:'RPG',  g:['basic'], fmt:r=>f1(r.rpg),  heat:1 },
  { k:'apg',    l:'APG',  g:['basic'], fmt:r=>f1(r.apg),  heat:1 },
  { k:'spg',    l:'SPG',  g:['basic'], fmt:r=>f1(r.spg),  heat:1 },
  { k:'bpg',    l:'BPG',  g:['basic'], fmt:r=>f1(r.bpg),  heat:1 },
  { k:'topg',   l:'TOPG', g:['basic'], fmt:r=>f1(r.topg), heat:1, low:1 },

  /* the four factors, offence — in the default view, because they are the
     four things that decide a game and read fine without any background */
  { k:'ff_efg',  l:'eFG%',  g:['basic','four'], fmt:r=>f1(r.ff_efg),  heat:1 },
  { k:'ff_tov',  l:'TOV%',  g:['basic','four'], fmt:r=>f1(r.ff_tov),  heat:1, low:1 },
  { k:'ff_oreb', l:'OREB%', g:['basic','four'], fmt:r=>f1(r.ff_oreb), heat:1 },
  { k:'ff_ftr',  l:'FTr',   g:['basic','four'], fmt:r=>f1(r.ff_ftr),  heat:1 },
  /* and the same four conceded */
  { k:'dff_efg',  l:'OPP eFG%',  g:['four','defense'], fmt:r=>f1(r.dff_efg),  heat:1, low:1 },
  { k:'dff_tov',  l:'OPP TOV%',  g:['four','defense'], fmt:r=>f1(r.dff_tov),  heat:1 },
  { k:'dff_oreb', l:'OPP OREB%', g:['four','defense'], fmt:r=>f1(r.dff_oreb), heat:1, low:1 },
  { k:'dff_ftr',  l:'OPP FTr',   g:['four','defense'], fmt:r=>f1(r.dff_ftr),  heat:1, low:1 },

  { k:'ortg', l:'ORTG', g:['ratings'], fmt:r=>f1(r.ortg), heat:1, lead:1 },
  { k:'drtg', l:'DRTG', g:['ratings'], fmt:r=>f1(r.drtg), heat:1, low:1 },
  { k:'net',  l:'NET',  g:['ratings'], fmt:r=>sgn(r.net), heat:1, signed:1, lead:1 },
  { k:'pace', l:'PACE', g:['ratings'], fmt:r=>f1(r.pace), heat:1 },
  { k:'poss_pg', l:'POSS/G', g:['ratings'], fmt:r=>f1(r.poss_pg), heat:1 },

  { k:'fgm_pg', l:'FG/G', g:['shooting'], fmt:r=>pair(r.fgm_pg,r.fga_pg), sort:r=>r.fgm_pg },
  { k:'fgm',    l:'FG',   g:['totals'], fmt:r=>pair(r.fgm,r.fga), sort:r=>r.fgm },
  { k:'fg_pct', l:'FG%',  g:['shooting'], fmt:r=>f1(r.fg_pct), heat:1 },
  { k:'p3m_pg', l:'3PT/G', g:['shooting'], fmt:r=>pair(r.p3m_pg,r.p3a_pg), sort:r=>r.p3m_pg },
  { k:'p3m',    l:'3PT',  g:['totals'], fmt:r=>pair(r.p3m,r.p3a), sort:r=>r.p3m },
  { k:'p3_pct', l:'3P%',  g:['shooting'], fmt:r=>f1(r.p3_pct), heat:1 },
  { k:'ft_pct', l:'FT%',  g:['shooting'], fmt:r=>f1(r.ft_pct), heat:1 },
  { k:'ts',     l:'TS%',  g:['shooting'], fmt:r=>f1(r.ts), heat:1 },
  /* the shot diet's expected return beside what it actually returned, and the gap: shot-making */
  { k:'pred_efg', l:'EXP eFG%', g:['shooting'], fmt:r=>f1(r.pred_efg), heat:1 },
  { k:'efg_sh',   l:'eFG%',     g:['shooting'], fmt:r=>f1(r.efg_sh),   heat:1 },
  { k:'efg_vs',   l:'eFG vs EXP', g:['shooting'], fmt:r=>sgn(r.efg_vs), heat:1, signed:1 },

  /* shot diet by zone: attempts per game beside the accuracy from there.
     Either number alone misleads — 60% at the rim on three attempts a night
     is not a rim team, and 30 attempts at 38% is not a bad shooting night. */
  { k:'rim_apg', l:'RIM/G',  g:['scoring','shooting'], fmt:r=>f1(r.rim_apg), heat:1 },
  { k:'rim_pct', l:'RIM%',   g:['scoring','shooting'], fmt:r=>f1(r.rim_pct), heat:1 },
  { k:'mid_apg', l:'MID/G',  g:['scoring','shooting'], fmt:r=>f1(r.mid_apg), heat:1 },
  { k:'mid_pct', l:'MID%',   g:['scoring','shooting'], fmt:r=>f1(r.mid_pct), heat:1 },
  { k:'p3_apg',  l:'3PA/G',  g:['scoring','shooting'], fmt:r=>f1(r.p3_apg),  heat:1 },
  { k:'p3_acc',  l:'3P%',    g:['scoring'], fmt:r=>f1(r.p3_acc), heat:1 },
  /* WHAT THE SHOT DIET SHOULD BE WORTH. Predicted eFG% weights each zone's attempts by the
     accuracy the zone usually yields, so it reads the QUALITY OF THE SHOTS a side takes with the
     shot-making taken out; against the real eFG% it says whether a team is making or missing
     what it should. Moreyball% is the share of attempts at the rim (the restricted area, not
     the whole paint) or from three -- the two shots worth taking. Both need the zone read
     (attachZoneStats), which the league table runs before it draws. */
  { k:'morey',    l:'MOREY%',    g:['scoring'], fmt:r=>f1(r.morey),    heat:1 },
  { k:'rim_share', l:'RIM SHARE', g:['scoring'], fmt:r=>f1(r.rim_share), heat:1 },
  { k:'mid_share', l:'MID SHARE', g:['scoring'], fmt:r=>f1(r.mid_share), heat:1 },
  { k:'p3_share',  l:'3P SHARE',  g:['scoring'], fmt:r=>f1(r.p3_share),  heat:1 },

  { k:'paint_pg',      l:'PAINT/G', g:['scoring'], fmt:r=>f1(r.paint_pg), heat:1 },
  { k:'fast_pg',       l:'FAST/G',  g:['scoring'], fmt:r=>f1(r.fast_pg),  heat:1 },
  { k:'second_pg',     l:'2ND/G',   g:['scoring'], fmt:r=>f1(r.second_pg), heat:1 },
  { k:'pot_pg',        l:'PoT/G',   g:['scoring'], fmt:r=>f1(r.pot_pg), heat:1 },
  { k:'bench_pg',      l:'BENCH/G', g:['scoring'], fmt:r=>f1(r.bench_pg), heat:1 },
  { k:'paint',         l:'PAINT', g:['totals'], fmt:r=>f0(r.paint), heat:1 },
  { k:'fast',          l:'FAST',  g:['totals'], fmt:r=>f0(r.fast),  heat:1 },
  { k:'second_chance', l:'2ND',   g:['totals'], fmt:r=>f0(r.second_chance), heat:1 },
  { k:'pts_off_to',    l:'PoT',   g:['totals'], fmt:r=>f0(r.pts_off_to), heat:1 },
  { k:'bench',         l:'BENCH', g:['totals'], fmt:r=>f0(r.bench), heat:1 },

  { k:'reb',  l:'REB',  g:['totals'], fmt:r=>f0(r.reb), heat:1 },
  { k:'oreb', l:'OREB', g:['totals'], fmt:r=>f0(r.oreb), heat:1 },
  { k:'dreb', l:'DREB', g:['totals'], fmt:r=>f0(r.dreb), heat:1 },
  { k:'ast',  l:'AST',  g:['totals'], fmt:r=>f0(r.ast), heat:1 },
  { k:'stl',  l:'STL',  g:['totals'], fmt:r=>f0(r.stl), heat:1 },
  { k:'blk',  l:'BLK',  g:['totals'], fmt:r=>f0(r.blk), heat:1 },
  { k:'tov',  l:'TO',   g:['totals'], fmt:r=>f0(r.tov), heat:1, low:1 },
  { k:'fouls',l:'PF',   g:['totals','defense'], fmt:r=>f0(r.fouls), heat:1, low:1 },
  { k:'ast_to',  l:'A/TO', g:['basic','totals'], fmt:r=>f2(r.ast_to), heat:1 },
  { k:'ast_pct', l:'AST%', g:['shooting'], fmt:r=>f1(r.ast_pct), heat:1 }
];
/* SHOT ZONES: every zone of the chart (shotchart.js) and the larger cuts, five measures each
   -- share of shots, attempts per 100 possessions, attempts and makes per game, eFG%. The rows
   carry them under z_<zone>_<measure> once the page has run attachZoneStats; a table drawn
   without that shows dashes. The key list is duplicated from shotchart.js on purpose: this
   file must not depend on that one being loaded first. */
/* THE USUAL RETURN FROM EACH AREA, as eFG%, from the published league-wide shooting splits
   (NBA seasons 2021-22 to 2023-24, per NBA.com's shot dashboard and Cleaning the Glass's
   accuracy-by-zone tables; the same bands appear in FIBA-level analyses): restricted area
   about 66% (a two, so eFG = FG%), the rest of the paint about 43%, mid-range about 41%,
   corner threes about 39% made (58.5% eFG), threes above the break about 36% made (54% eFG).
   They are benchmarks, not this league's own averages -- that is the point: they let a
   shot diet be judged against what those shots usually return anywhere. */
const ZONE_EFG = { rim: 66, paint: 43, mid: 41, c3: 58.5, ab3: 54 };
const ZONE_KEYS = [['rim', 'RIM', 'z_rim'], ['paint', 'PAINT', 'z_rim'],
                   ['base', 'BASE MID', 'z_mid'], ['wingm', 'WING MID', 'z_mid'], ['topm', 'TOP MID', 'z_mid'],
                   ['c3', 'CORNER 3', 'z_three'], ['w3', 'WING 3', 'z_three'], ['t3', 'TOP 3', 'z_three'],
                   ['left', 'LEFT', 'z_cuts'], ['centre', 'CENTRE', 'z_cuts'], ['right', 'RIGHT', 'z_cuts'], ['atrim', 'RIM+PAINT', 'z_cuts'], ['jump', 'JUMP', 'z_cuts'],
                   ['mid', 'ALL MID', 'z_cuts'], ['three', 'ALL 3', 'z_cuts'], ['all', 'ALL', 'z_cuts']];
/* five views rather than one wall of eighty columns: the paint, the mid-range, the threes, the
   larger cuts, and one that lines up rate per 100 possessions with eFG% for every area */
ZONE_KEYS.forEach(([z, l, cat]) => {
  T.push({ k:'z_' + z + '_share',  l:l + ' %SH',  g:[cat], fmt:r=>f1(r['z_' + z + '_share']),  heat:1 });
  T.push({ k:'z_' + z + '_att100', l:l + ' /100', g:[cat, 'z_rate'], fmt:r=>f1(r['z_' + z + '_att100']), heat:1 });
  T.push({ k:'z_' + z + '_attG',   l:l + ' A/G',  g:[cat], fmt:r=>f1(r['z_' + z + '_attG']),   heat:1 });
  T.push({ k:'z_' + z + '_madeG',  l:l + ' M/G',  g:[cat], fmt:r=>f1(r['z_' + z + '_madeG']),  heat:1 });
  T.push({ k:'z_' + z + '_efg',    l:l + ' eFG',  g:[cat, 'z_rate'], fmt:r=>f1(r['z_' + z + '_efg']),    heat:1 });
});

/* THE EVENTS SPLITS: second chance, transition, off turnovers, after timeout, half court, and
   assisted against unassisted baskets, from season.js's ev_ keys (and, for a team, evd_: what
   opponents did in the same situations against it). Every situation asks the same questions, so
   its columns are generated, one list for both kinds: volume and share of the scoring, eFG%, the
   rim / mid / three diet with the accuracy from each, free throws and turnovers. A team adds its
   chances, how often it got into the situation and what each chance was worth, and the other end
   in OPP columns ranked lower-is-better.

   Opponent chances are only a thing to keep down where the situation is one a defence gives
   away -- offensive rebounds, breaks, turnovers. Making a side play in the half court is the
   point of defending, and after-timeout sets happen to both sides, so neither is ranked in
   reverse there.

   GP AND EV GP BOTH SHOW. The min-games filter reads gp, but every per-game number in these
   presets is over ev_gp, the games that carry the splits; until every game of a season has been
   finalised with them (or backfilled) the two differ, and a reader comparing a 20-game box score
   with 14 games of splits needs to see that rather than be left to guess. */
function evColumns(CAT, team) {
  CAT.push({ k:'ev_gp', l:'EV GP', g:EV_GROUPS, fmt:r=>e0(r.ev_gp),
             t:'games with the events splits (the per-game values in this preset are over these)' });
  EV_SITS.forEach(([s, , name]) => {
    const g = ['ev_' + s], p = 'ev_' + s + '_', d = 'evd_' + s + '_';
    const chances = s === 'ato' ? 'possessions' : 'chances';
    const conceded = s === 'second' || s === 'transition' || s === 'offTo';
    const col = (k, l, t, x) => CAT.push(Object.assign({ k, l, g, t: name + ': ' + t, fmt:r=>e1(r[k]), heat:1 }, x));
    if (team) {
      col(p + 'ch_pg', 'CH/G', chances + ' per game');
      col(p + 'freq',  'FREQ', s === 'ato' ? 'sets per 100 chances' : 'share of all chances');
    }
    col(p + 'ppg',    'PTS/G', 'points per game', { lead:1 });
    col(p + 'pts_sh', '%PTS',  'share of all points');
    if (team) col(p + 'ppp', 'PPP', 'points per ' + (s === 'ato' ? 'possession' : 'chance'), { fmt:r=>e2(r[p + 'ppp']) });
    col(p + 'fgm_pg', 'FG/G', 'field goals made-attempted per game',
        { fmt:r=>epg(r[p + 'fgm_pg'], r[p + 'fga_pg']), sort:r=>r[p + 'fgm_pg'], heat:0 });
    col(p + 'efg',     'eFG%',    'effective field goal %');
    col(p + 'rim_apg', 'RIM A/G', 'rim attempts per game');
    col(p + 'rim_pct', 'RIM%',    'FG% at the rim');
    col(p + 'rim_sh',  'RIM SH',  'share of attempts at the rim');
    col(p + 'mid_apg', 'MID A/G', 'mid-range attempts per game');
    col(p + 'mid_pct', 'MID%',    'FG% from mid-range');
    col(p + 'mid_sh',  'MID SH',  'share of attempts from mid-range');
    col(p + 'p3_apg',  '3PA/G',   'three-point attempts per game');
    col(p + 'p3_pct',  '3P%',     'three-point %');
    col(p + 'p3_sh',   '3 SH',    'share of attempts from three');
    col(p + 'fta_pg',  'FTA/G',   'free throw attempts per game');
    col(p + 'tov_pg',  'TOV/G',   'turnovers per game', { low:1 });
    if (team) {
      col(p + 'tov_pct', 'TOV%',     'turnovers per 100 ' + chances, { low:1 });
      col(d + 'ch_pg',   'OPP CH/G', 'opponent ' + chances + ' per game', conceded ? { low:1 } : {});
      col(d + 'ppg',     'OPP PTS',  'opponent points per game', { low:1 });
      col(d + 'ppp',     'OPP PPP',  'opponent points per ' + (s === 'ato' ? 'possession' : 'chance'),
          { fmt:r=>e2(r[d + 'ppp']), low:1 });
      col(d + 'efg',     'OPP eFG',  'opponent effective field goal %', { low:1 });
    }
  });

  /* Assisted or not is a property of a MADE basket, so there is no assisted eFG%: what sits
     beside the assisted share of each zone's makes is that zone's accuracy over all its
     attempts, and each group is read by points per basket and where its baskets came from. */
  const g = ['ev_assist'];
  const col = (k, l, t, x) => CAT.push(Object.assign({ k, l, g, t, fmt:r=>e1(r[k]), heat:1 }, x));
  /* A PLAYER'S ASSISTED SHARE RANKS THE OTHER WAY UP: a basket somebody else created is
     the easier one, so the least assisted scoring is the rarer skill and takes the top of
     the scale. A CLUB's is left as it is -- there the same number is ball movement. */
  const selfMade = team ? {} : { low: 1 };
  col('ev_ast_fgm_pg',   'AST FG/G', 'assisted baskets per game');
  col('ev_unast_fgm_pg', 'UN FG/G',  'unassisted baskets per game');
  col('ev_ast_sh',       '%AST',     'share of baskets that were assisted', selfMade);
  col('ev_ast_pts_sh',   '%PTS AST', 'share of the points scored that came off an assisted basket', selfMade);
  col('ev_ast_ppb',      'PPB AST',  'points per assisted basket', { fmt:r=>e2(r.ev_ast_ppb) });
  col('ev_unast_ppb',    'PPB UN',   'points per unassisted basket', { fmt:r=>e2(r.ev_unast_ppb) });
  col('ev_all_efg',      'eFG%',     'effective field goal %, every shot');
  col('ev_all_rim_pct',  'RIM%',     'FG% at the rim, every shot');
  col('ev_rim_astp',     'RIM %AST', 'share of rim makes that were assisted', selfMade);
  col('ev_all_mid_pct',  'MID%',     'FG% from mid-range, every shot');
  col('ev_mid_astp',     'MID %AST', 'share of mid-range makes that were assisted', selfMade);
  col('ev_all_p3_pct',   '3P%',      'three-point %, every shot');
  col('ev_p3_astp',      '3 %AST',   'share of made threes that were assisted', selfMade);
  col('ev_ast_rim_sh',   'A RIM SH', 'assisted baskets: share at the rim');
  col('ev_ast_mid_sh',   'A MID SH', 'assisted baskets: share from mid-range');
  col('ev_ast_p3_sh',    'A 3 SH',   'assisted baskets: share from three');
  col('ev_unast_rim_sh', 'U RIM SH', 'unassisted baskets: share at the rim');
  col('ev_unast_mid_sh', 'U MID SH', 'unassisted baskets: share from mid-range');
  col('ev_unast_p3_sh',  'U 3 SH',   'unassisted baskets: share from three');
  if (team) {
    col('ev_ftast_pg', 'FT AST/G', 'assists on passes that drew free throws, per game');
    col('evd_ast_sh',  'OPP %AST', 'share of opponent baskets that were assisted', { low:1 });
  }
}
evColumns(P, false);
evColumns(T, true);

/* presets: the first is the default, and is deliberately the beginner's view */
const EV_PRESETS = EV_SITS.map(([s, label]) => ['ev_' + s, 'events · ' + label]).concat([['ev_assist', 'events · assisted']]);
const PRESETS = {
  player: [
    ['basic',      'per game'],
    ['totals',     'totals'],
    ['shooting',   'shooting'],
    ['playmaking', 'playmaking'],
    ['defense',    'defence'],
    ['rebounding', 'rebounding'],
    ['onoff',      'on / off'],
    ['vs',         'opponent'],
    ['advanced',   'advanced'],
    ['misc',       'misc'],
    ...EV_PRESETS,
    ['*',          'everything']
  ],
  team: [
    ['basic',    'per game + four factors'],
    ['four',     'four factors'],
    ['ratings',  'ratings'],
    ['shooting', 'shooting'],
    ['scoring',  'scoring types'],
    ['defense',  'defence'],
    ['totals',   'totals'],
    ['z_rim',    'zones: rim + paint'],
    ['z_mid',    'zones: mid-range'],
    ['z_three',  'zones: threes'],
    ['z_cuts',   'zones: the cuts'],
    ['z_rate',   'zones: rate / 100 + eFG%'],
    ...EV_PRESETS,
    ['*',        'everything']
  ]
};

/* index_9's percentile scale, in the kit's neons. Green is good at both ends
   because the ranking is already reversed for lower-is-better columns.
   GREEN IS --good, NOT --lume. On a league's pages and a club's, --lume is that
   league's or club's own colour, so a side that plays in red had its best numbers
   painted red, a shade away from the flare its worst ones get. */
function heatStyle(p) {
  if (p == null) return '';
  if (p >= 90) return 'background:color-mix(in oklch,var(--good) 34%,transparent);color:var(--ink)';
  if (p >= 75) return 'background:color-mix(in oklch,var(--good) 20%,transparent)';
  if (p >= 60) return 'background:color-mix(in oklch,var(--good) 10%,transparent)';
  if (p >= 40) return '';
  if (p >= 25) return 'background:color-mix(in oklch,var(--amber) 12%,transparent)';
  if (p >= 10) return 'background:color-mix(in oklch,var(--flare) 14%,transparent)';
  return 'background:color-mix(in oklch,var(--flare) 24%,transparent)';
}

/* ------------------------------------------------------------ mobile drag --- */
/* The hand-written horizontal drag that used to live here now lives in
   xscroll.js, because it was needed by every wide table on the platform and
   reachable by this one. The leaders board, the WOWY grids, the lineup tables
   and the fixture lists all build their own .ft-wrap and none of them could
   see this function — which is why the exact bug it fixes kept being reported
   against them after it was fixed here. xscroll.js sweeps for them all,
   including this wrap, and re-sweeps after a render. */

/* ------------------------------------------------------------- phone mode ---
   ONE BREAKPOINT FOR EVERYTHING A PHONE CHANGES. The bottom tab bar arrives at 820px
   (kit/nav.css), and the table used to switch to its phone form at 640px: between the
   two -- a landscape phone, a foldable's inner screen -- the tab bar was on while the
   table was a 74vh box scrolling inside the page, the vertical-swipe trap the phone
   form exists to remove. kit/table.css and xscroll.js use the same number for this
   table's boxes (the host carries .ft-host); the hand-built tables and the kit's
   scrollers still switch at 640px, so their 641-820px behaviour is what it was.

   THE GRIPS ARE A MOUSE CONTROL. A 9px strip down a header's edge is not a target a
   thumb can mean to hit, and on a phone they escaped the table altogether and ran down
   the page's right edge, swallowing vertical swipes. So none are made for a coarse
   pointer or at phone width. */
const PHONE_MQ = '(max-width:820px)';
const media = q => (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
  ? window.matchMedia(q) : null;
const isPhone  = () => { const m = media(PHONE_MQ); return !!(m && m.matches); };
const isCoarse = () => { const m = media('(pointer:coarse)'); return !!(m && m.matches); };
/* the pinned # and name columns, the same numbers kit/table.css gives them */
const W0 = 36, W1_WIDE = 170, W1_PHONE = 132;
/* a pause in the typing, not every key: each draw sorts and ranks the whole table */
const SEARCH_WAIT = 150;
/* the pinned rank column when it carries a pick button: a 44px target, not 36 */
const W0_PICK = 44;

/* ------------------------------------------------------------ stat filters ---
   THE MULTI-STAT PREFILTER (opts.filters, global scouting). A line is a stat, >= or <=,
   and a number read either as the stat's own value or as its percentile.

   A RATE IS NOTHING WITHOUT ITS VOLUME. 100% from three on one attempt is the top of every
   3P% list, so a filtered rate brings its volume with it: the player must have at least
   max(the floor below, a quarter of the population's median volume) -- sitpanel.js's rule --
   and the count says what that minimum came to. The percentile of a floored rate is taken
   over the players who clear the floor, for the same reason.

   Percentiles are the table's own (EpinoiaSeason.percentiles), so "80th percentile" always
   means good: a lower-is-better column is already ranked the other way up. */
const RATE_VOL = { fg_pct: 'fga_pg', p2_pct: 'fga_pg', efg: 'fga_pg', ts: 'fga_pg', p3_pct: 'p3a_pg',
                   ft_pct: 'fta_pg', rim_pct: 'rim_apg', mid_pct: 'mid_apg', ast_to: 'apg' };
const VOL_MIN  = { fga_pg: 2, p3a_pg: 1, fta_pg: 1, rim_apg: 1, mid_apg: 1, apg: 1 };
/* volumes a filter needs that no column shows on its own (the FG / 3PT / FT pairs carry them) */
const FILTER_EXTRA = [
  { k: 'fga_pg', l: 'FGA/G', t: 'field goal attempts per game' },
  { k: 'p3a_pg', l: '3PA/G', t: 'three-point attempts per game' },
  { k: 'fta_pg', l: 'FTA/G', t: 'free throw attempts per game' }
];
/* quick sets: a name, what it asks for, and its lines [stat, op, mode, number] */
const QUICK_SETS = [
  ['shooters',       '3P% in the top fifth, on 3 threes a game',       [['p3_pct', 'ge', 'pct', 80], ['p3a_pg', 'ge', 'val', 3]]],
  ['rim protectors', 'BLK% in the top sixth, holding the defensive glass', [['blk_pct', 'ge', 'pct', 85], ['dreb_pct', 'ge', 'pct', 50]]],
  ['playmakers',     'AST% in the top fifth without giving it away',   [['ast_pct', 'ge', 'pct', 80], ['tov_pct', 'ge', 'pct', 40]]],
  ['scorers',        'PPG in the top fifth at an average TS% or better', [['ppg', 'ge', 'pct', 80], ['ts', 'ge', 'pct', 50]]],
  ['rebounders',     'TRB% in the top fifth',                           [['trb_pct', 'ge', 'pct', 80]]],
  ['two-way',        'OBPM and DBPM both in the top third',             [['obpm', 'ge', 'pct', 67], ['dbpm', 'ge', 'pct', 67]]]
];
/* a regression that needs its players to share a floor: nothing on a cross-league table */
const RAPM_KEYS = new Set(['rapm', 'orapm', 'drapm']);
const fin = v => v != null && typeof v === 'number' && isFinite(v);

/* ------------------------------------------------------- following access ---
   THE ACCESS STATE CAN CHANGE UNDER A DRAWN TABLE: an answer arriving after access.js's own
   time limit, or a sign-in or sign-out in another tab. Every table on the page follows it
   through ONE subscription held here, never one per render.

   One per render leaked. Pages re-render into a fresh host on every scope change, and a
   listener only found out its host had gone when the next access event arrived -- which,
   for somebody flicking between competitions on an open league, is never. Each render kept
   its whole table (rows, closures, the detached DOM) alive behind a listener nobody would
   call again. Now a table is let go once another render owns its host or its host has left
   the document, checked on every render and on every access event, and the subscription
   itself is handed back once there is no table left to follow it. */
const following = new Set();      // { host, relock, seen }
let accessSub = null;             // { off } while subscribed; off is null if the module gave none back

const inPage = n => (typeof n.isConnected === 'boolean' ? n.isConnected
  : !!(n.ownerDocument && n.ownerDocument.contains(n)));

function sweepTables() {
  following.forEach(t => {
    if (t.host.__ftTable !== t) { following.delete(t); return; }   // re-rendered: the newer table owns the host
    /* A HOST NOT YET IN THE PAGE IS KEPT: a caller may draw into a node and attach it
       afterwards. One that has been in the page and left it is gone for good. */
    if (inPage(t.host)) t.seen = true;
    else if (t.seen) following.delete(t);
  });
  if (!following.size && accessSub && typeof accessSub.off === 'function') {
    try { accessSub.off(); } catch (_) { /* already gone */ }
    accessSub = null;
  }
}

function followAccess(host, relock) {
  const A = typeof window !== 'undefined' ? window.EpinoiaAccess : null;
  if (!A || typeof A.onChange !== 'function') return;     // no module: the table as drawn, as before
  const t = { host, relock, seen: false };
  host.__ftTable = t;
  following.add(t);
  sweepTables();
  if (accessSub) return;
  try {
    const off = A.onChange(() => {
      sweepTables();
      /* each table on its own: one that throws must not leave the rest drawn under the old answer */
      [...following].forEach(x => { try { x.relock(); } catch (e) { console.warn('[fulltable] access', e); } });
    });
    /* kept even without a way to let go, so a module that hands back nothing is still
       subscribed to once rather than once per render */
    accessSub = { off: typeof off === 'function' ? off : null };
  } catch (_) { accessSub = null; }
}

/* ---------------------------------------------------- following the breakpoint ---
   CROSSING THE PHONE BREAKPOINT REDRAWS: a phone turned to landscape, or a window dragged
   narrow, changes which header a table uses. ONE media listener for every table, for the
   reason one access subscription is (above): a listener per render into a fresh host --
   the league page's boards, on every scope change -- held its whole table alive on any
   screen that never crossed the breakpoint to find out the table had gone. A table is let
   go once another render owns its host or it has left the document, checked on every
   render and every crossing, and the listener is handed back once no table is left. */
const atWidth = new Set();        // { host, wrap, redraw, seen }
let widthSub = null;              // { mq, fn } while listening

function sweepWidths() {
  atWidth.forEach(t => {
    if (t.host.__ftWrap !== t.wrap) { atWidth.delete(t); return; }   // re-rendered
    if (inPage(t.wrap)) t.seen = true;
    else if (t.seen) atWidth.delete(t);
  });
  if (!atWidth.size && widthSub) {
    const { mq, fn } = widthSub;
    try {
      if (mq.removeEventListener) mq.removeEventListener('change', fn);
      else if (mq.removeListener) mq.removeListener(fn);
    } catch (_) { /* already gone */ }
    widthSub = null;
  }
}

function followWidth(host, wrap, redraw) {
  const mq = media(PHONE_MQ);
  if (!mq) return;
  atWidth.add({ host, wrap, redraw, seen: false });
  sweepWidths();
  if (widthSub) return;
  const fn = () => {
    sweepWidths();
    [...atWidth].forEach(t => { try { t.redraw(); } catch (e) { console.warn('[fulltable] width', e); } });
  };
  if (mq.addEventListener) mq.addEventListener('change', fn);
  else if (mq.addListener) mq.addListener(fn);
  else return;
  widthSub = { mq, fn };
}

/* ------------------------------------------------------------- component --- */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return null;

  const isTeam = opts.kind === 'team';
  /* The name column is not always a name. On a career table every row is the
     same person and the column carries the season instead, so a header reading
     PLAYER above a list of years is simply wrong. Relabelling is a caller's
     choice rather than a guess made here. */
  const CAT = (isTeam ? T : P).map(c =>
    (c.k === 'name' && opts.nameLabel) ? Object.assign({}, c, { l: opts.nameLabel }) : c);
  const presets = PRESETS[isTeam ? 'team' : 'player'];
  let rows = prep(opts.rows);
  /* every row set the table is handed goes through here, the first and each setRows */
  function prep(list) {
    const out = (list || []).map((r, i) => Object.assign({ __i: i }, r));
    derive(out);
    return out;
  }
  /* PER GAME OUTSIDE THE TOTALS VIEW. A season row carries totals; every column except the
     totals preset reads a per-game form of them, derived here so the heat map and the sort
     rank the per-game numbers rather than the totals behind them. */
  function derive(rows) {
  if (!isTeam) rows.forEach(r => { r.poss_pg = (r.poss == null || !isFinite(r.poss)) ? null : r.poss / (r.gp || 1); });
  if (isTeam) rows.forEach(r => {
    const gp = r.gp || 1;
    const pg = v => (v == null || !isFinite(v)) ? null : v / gp;
    r.poss_pg = pg(r.poss); r.fgm_pg = pg(r.fgm); r.fga_pg = pg(r.fga); r.p3m_pg = pg(r.p3m); r.p3a_pg = pg(r.p3a);
    r.paint_pg = pg(r.paint); r.fast_pg = pg(r.fast); r.second_pg = pg(r.second_chance); r.pot_pg = pg(r.pts_off_to); r.bench_pg = pg(r.bench);
    /* the zone-weighted expectation and the Moreyball share, from the zone read when present */
    const za = k => +r['z_' + k + '_att'] || 0;
    const tot = za('all');
    if (tot > 0) {
      const exp = za('rim') * ZONE_EFG.rim + za('paint') * ZONE_EFG.paint + za('mid') * ZONE_EFG.mid +
                  za('c3') * ZONE_EFG.c3 + (za('w3') + za('t3')) * ZONE_EFG.ab3;
      r.pred_efg = exp / tot;
      r.morey = 100 * (za('rim') + za('three')) / tot;
      /* eFG% over the same located shots, so the comparison is like for like */
      const zm = k => +r['z_' + k + '_madeG'] || 0, gp2 = r.gp || 1;
      const made = (zm('all')) * gp2, made3 = (zm('three')) * gp2;
      r.efg_sh = 100 * (made + 0.5 * made3) / tot;
      r.efg_vs = r.efg_sh - r.pred_efg;
    } else { r.pred_efg = null; r.morey = null; r.efg_sh = null; r.efg_vs = null; }
  });
  }

  /* ---- the cross-league options (global scouting) ----
     ALL OF THEM OPT-IN. A page that passes none of leagueColumn, leagueSelect, rankWithinLeague,
     locked, filters, selectable, noRapm, searchLeagues or state gets the table it always had.

     LEAGUES keys the team select by team id rather than by short name: SLB men and SLB women
     share six short names (LEI, LON, MAN...), and a select of names would put both Leicester
     sides behind one option. */
  const LEAGUES = !isTeam && !!(opts.leagueColumn || opts.leagueSelect);
  const S0 = opts.state && typeof opts.state === 'object' ? opts.state : {};
  const SELECT = !!(opts.selectable && !isTeam);
  const PICK_MAX = SELECT ? Math.max(1, Math.floor(opts.selectable.max) || 5) : 0;
  const FILTERS = !!opts.filters;
  const w0 = SELECT ? W0_PICK : W0;

  let preset = opts.preset || presets[0][0];
  if (S0.preset && presets.some(p => p[0] === S0.preset)) preset = S0.preset;
  let sortKey = opts.sortKey || (isTeam ? 'ppg' : 'ppg');
  let sortDir = -1;
  if (typeof S0.sort === 'string' && S0.sort) sortKey = S0.sort;
  if (S0.dir === 1 || S0.dir === -1) sortDir = S0.dir;
  let search = typeof S0.search === 'string' ? S0.search.trim().toLowerCase() : '';
  let minGames = opts.minGames != null ? opts.minGames : 0;
  let minMinutes = 0;                     // the low-minutes cut, off until asked for
  let teamPick = S0.team != null ? String(S0.team) : '';   // one club, or every club
  let leaguePick = S0.league != null ? String(S0.league) : '';   // one league, or every league
  let posPick = '';                       // guards / wings / bigs, or every position
  let byPos = false;                      // rank each column within the player's position
  /* RANK WITHIN LEAGUE: percentiles and position groups taken per league, on by default on a
     table with a league column. A +3 BPM means "above this league's average", so ranking it
     against another league's players compares two different zeroes. */
  const WITHIN_TOGGLE = !isTeam && !!(opts.leagueColumn || opts.rankWithinLeague != null);
  let withinLeague = WITHIN_TOGGLE && (S0.withinLeague != null ? !!S0.withinLeague
    : opts.rankWithinLeague != null ? !!opts.rankWithinLeague : !!opts.leagueColumn);
  const within0 = opts.rankWithinLeague != null ? !!opts.rankWithinLeague : !!opts.leagueColumn;
  /* QUALIFIED: rows that say whether their player has played enough (global.js marks them)
     get a switch, on by default. Rows that do not say get nothing. */
  const hasQualified = list => !isTeam && list.some(r => typeof r.qualified === 'boolean');
  let qualRows = hasQualified(rows);
  let qualOn = S0.qualified != null ? !!S0.qualified : true;
  let filters = [];                       // [{ k, op:'ge'|'le', mode:'val'|'pct', x }]
  const picked = new Map();               // id -> row, in the order picked
  let heat = opts.heat !== false;
  let extra = new Set();          // columns added by hand on top of the preset
  let removed = new Set();        // and ones taken away
  const minGames0 = minGames, heat0 = heat;

  /* ROWS IN PAGES, WHEN A PAGE ASKS FOR IT. Building every row of a 225-player table
     is most of what a redraw costs, and on a phone nobody reads row 180 without having
     searched for it. opts.pageSize draws that many and offers the next lot below the
     table; a caller that does not pass it gets every row, as before. The heat map and
     the sort still read the whole filtered table, so a colour or a rank never changes
     as more rows are shown. */
  const PAGE = opts.pageSize > 0 ? Math.floor(opts.pageSize) : Infinity;
  let shown = PAGE;
  if (PAGE !== Infinity && S0.page > 1) shown = PAGE * Math.floor(S0.page);

  const SE =() => (typeof window !== 'undefined' ? window.EpinoiaSeason : null);

  /* MEMBERS' ANALYTICS (docs/memberships.md §1, §6). The events splits and the zone columns
     are sold; a viewer without them keeps the rest of the table exactly as it was, with those
     columns gone from the table, the column drawer, "everything" and the CSV, and a preset
     made of nothing else marked locked -- pressing it says what it is rather than opening an
     empty view. The numbers are still on the rows (the browser computes them from free data,
     §3): what is withheld is the presentation.

     IT FAILS OPEN. No access.js on the page, no answer yet, or an error all read as unlocked,
     so a table on a page that never loads the module is the table it always was. `locked` is
     read again whenever the module says the state changed (sign-in, sign-out, a late answer). */
  const ACC = () => (typeof window !== 'undefined' ? window.EpinoiaAccess : null);
  /* A PAGE OVER SEVERAL LEAGUES DECIDES FOR ITSELF (opts.locked, a function of a column key).
     One league's answer cannot speak for a table mixing leagues, and hiding only the locked
     leagues' cells would still print their order through a sort or a filter, so the page
     says which columns are locked on it and they are gone for every row. */
  const OWN_LOCK = typeof opts.locked === 'function';
  const pageLocks = k => { try { return !!opts.locked(k); } catch (_) { return false; } };
  const isLocked = () => { if (OWN_LOCK) return CAT.some(c => pageLocks(c.k)); const A = ACC();
    return !!(A && typeof A.analyticsOk === 'function' && !A.analyticsOk(opts.leagueId)); };
  /* what is locked, as one string, so a change of WHICH columns (not only whether any) redraws */
  const lockSig = () => OWN_LOCK ? CAT.filter(c => pageLocks(c.k)).map(c => c.k).join(',') : (isLocked() ? '*' : '');
  let locked = isLocked();
  let lockKey = lockSig();
  const premium = k => { if (!locked) return false; if (OWN_LOCK) return pageLocks(k); const A = ACC();
    return !!(A && typeof A.isPremiumColumn === 'function' && A.isPremiumColumn(k)); };
  /* not drawn, not filtered on, not compared: a locked column, or RAPM where the page has none */
  const absent = k => premium(k) || (!!opts.noRapm && RAPM_KEYS.has(k));
  /* A PRESET IS LOCKED when the catalogue names it, or when every column it would show is
     premium. The context columns (GP) do not count: GP rides in almost every preset, the
     events and zone ones included, and one free GP column would otherwise keep a wholly
     premium view "open" on a table of games played. "everything" is never locked -- it only
     loses columns. */
  const presetLocked = key => {
    if (!locked || key === '*') return false;
    const A = ACC(), C = A && A.CATALOGUE;
    /* the catalogue's list is the memberships' own lock; a page's own rule is read column by column */
    if (!OWN_LOCK && C && Array.isArray(C.presets) && C.presets.indexOf(key) !== -1) return true;
    const context = C && Array.isArray(C.contextColumns) ? C.contextColumns : ['gp'];
    const cols = CAT.filter(c => c.g.includes(key) && !c.g.includes('id') && context.indexOf(c.k) === -1);
    return cols.length > 0 && cols.every(c => premium(c.k));
  };
  if (presetLocked(preset)) preset = presets[0][0];

  /* the groups are cut over the whole table once, not per row (season.js positionGroups) --
     or once per league when ranking within league, since a third of one league's players
     are its guards whatever the other leagues look like */
  let posMap = null;
  const byLeague = list => {
    const m = new Map();
    list.forEach(r => { const k = r.leagueId == null ? '' : String(r.leagueId);
      if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  };
  const posGroups = () => {
    const S = SE();
    if (!posMap && S && S.positionGroups) {
      if (withinLeague) {
        posMap = new Map();
        byLeague(rows).forEach(list => S.positionGroups(list).forEach((g, id) => posMap.set(id, g)));
      } else posMap = S.positionGroups(rows);
    }
    return posMap;
  };
  const groupOf = r => { const m = posGroups(); return m ? (m.get(r.id) || null) : null; };
  /* the pools a percentile is taken over: the whole table, a position, a league, or both */
  const rankGroup = () => {
    if (withinLeague && byPos) return r => { const p = groupOf(r); return p == null ? null : String(r.leagueId) + ':' + p; };
    if (withinLeague) return r => String(r.leagueId == null ? '' : r.leagueId);
    return byPos ? groupOf : null;
  };

  /* THE LEAGUE COLUMN sits after GP in every preset, and is not in the column drawer:
     on a table over several leagues a row without its league is not readable */
  const LEAGUE_COL = opts.leagueColumn && !isTeam ? { k: 'leagueShort', l: 'LEAGUE', g: ['league'], text: true,
    fmt: r => r.leagueShort || r.leagueName || '', sort: r => r.leagueShort || r.leagueName || '',
    t: 'the league these numbers come from' } : null;
  const colOf = k => CAT.find(x => x.k === k) || (LEAGUE_COL && k === LEAGUE_COL.k ? LEAGUE_COL : null);

  const idCols = CAT.filter(c => c.g.includes('id'));
  const inPreset = c => preset === '*' ? !c.g.includes('id') : c.g.includes(preset);
  const visible = () => {
    const out = idCols.concat(
      CAT.filter(c => !c.g.includes('id') && !absent(c.k) &&
                      ((inPreset(c) && !removed.has(c.k)) || extra.has(c.k)))
         .map((c, i) => [c, i])
         .sort((a, b) => ((a[0].ord && a[0].ord[preset] != null ? a[0].ord[preset] : 1000 + a[1]) -
                          (b[0].ord && b[0].ord[preset] != null ? b[0].ord[preset] : 1000 + b[1])))
         .map(x => x[0]));
    if (LEAGUE_COL) {
      const gp = out.findIndex(c => c.k === 'gp');
      out.splice(gp > -1 ? gp + 1 : idCols.length, 0, LEAGUE_COL);
    }
    return out;
  };

  /* ---- the stat filters' catalogue and arithmetic (RATE_VOL, above render) ---- */
  const extraCols = isTeam ? [] : FILTER_EXTRA;
  const fcol = k => CAT.find(x => x.k === k && x.heat) || extraCols.find(x => x.k === k) || null;
  const filterStats = () => CAT.filter(c => c.heat && !c.g.includes('id') && !absent(c.k))
    .concat(extraCols.filter(c => !CAT.some(x => x.k === c.k)));
  const cleanLine = f => {
    if (!f || typeof f !== 'object' || !fcol(f.k) || absent(f.k)) return null;
    const x = f.x === '' || f.x == null ? null : Number(f.x);
    return { k: f.k, op: f.op === 'le' ? 'le' : 'ge', mode: f.mode === 'pct' ? 'pct' : 'val', x: fin(x) ? x : null };
  };
  const liveLines = () => filters.filter(f => f.x != null && fcol(f.k) && !absent(f.k));
  if (FILTERS && Array.isArray(S0.filters)) filters = S0.filters.map(cleanLine).filter(Boolean);
  const quickSets = () => (FILTERS && opts.filters && Array.isArray(opts.filters.quick) ? opts.filters.quick
    : (isTeam ? [] : QUICK_SETS)).filter(q => q[2].every(l => fcol(l[0]) && !absent(l[0])));

  /* a quarter of the population's median volume, never below the stat's own floor, rounded
     UP to the tenth the count prints, so the number a reader sees is the number applied */
  function volFloor(pop, vk) {
    const vols = pop.map(r => r[vk]).filter(v => fin(v) && v > 0).sort((a, b) => a - b);
    const med = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
    return Math.max(VOL_MIN[vk] || 0, Math.ceil(0.25 * med * 10 - 1e-9) / 10);
  }
  let lastPop = null, lastFloors = [];   // what the last view() filtered over, and the minimums it applied

  host.textContent = '';
  /* THE FULL TABLE'S PHONE FORM STARTS AT 820px, and kit/table.css and xscroll.js find
     this table's boxes by this class; every hand-built table keeps the 640px switch */
  host.classList.add('ft-host');

  /* ---- row 1: search, filters, switches ---- */
  /* ON A PHONE THE SECONDARY CONTROLS FOLD BEHIND ONE BUTTON. Six wrapped rows of
     switches and a nine-row wall of presets put the first row of the table 899px down a
     780px screen. Everything but the search sits in .ft-more, and the stylesheet decides:
     above the phone breakpoint .ft-more is display:contents, so its children are the
     bar's own flex items and the desktop bar is the row it always was; below it, a block
     the 'filters' button opens. Sizes live in kit/table.css as classes, not inline, so
     the phone rules can reach them. */
  const bar = el('div', 'ft-bar');
  const q = el('input', 'ep-input grow');
  q.type = 'search';
  q.placeholder = isTeam ? 'find a team…' : 'find a player or team…';
  if (opts.searchLeagues) q.placeholder = 'find a player, team or league…';
  if (search) q.value = S0.search.trim();
  let qTimer = null;
  q.addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { search = q.value.trim().toLowerCase(); shown = PAGE; draw(); emit(); }, SEARCH_WAIT);
  });
  bar.appendChild(q);

  const filtersBtn = el('button', 'ep-btn ft-btn ft-filters', 'filters');
  filtersBtn.type = 'button'; filtersBtn.setAttribute('aria-expanded', 'false');
  const more = el('div', 'ft-more');
  filtersBtn.addEventListener('click', () => {
    const open = more.classList.toggle('open');
    filtersBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  bar.append(filtersBtn, more);
  /* the button says how many filters are doing something, so a folded one is not forgotten */
  const paintFilters = () => {
    const lines = FILTERS ? liveLines().length : 0;
    const n = (minGames !== minGames0 ? 1 : 0) + (minMinutes ? 1 : 0) + (teamPick ? 1 : 0) +
              (posPick ? 1 : 0) + (byPos ? 1 : 0) + (heat !== heat0 ? 1 : 0) +
              (leaguePick ? 1 : 0) + (withinLeague !== within0 ? 1 : 0) + (qualRows && !qualOn ? 1 : 0) + lines;
    filtersBtn.textContent = n ? 'filters · ' + n : 'filters';
    filtersBtn.classList.toggle('pri', n > 0);
    if (statBtn) {
      statBtn.textContent = lines ? 'stat filters · ' + lines : 'stat filters';
      statBtn.classList.toggle('pri', lines > 0);
    }
  };
  let statBtn = null;                     // the stat filters' button, when the page has them
  /* THE STATE A PAGE KEEPS IN ITS URL (opts.onState), handed over after every change of it */
  const emit = () => {
    if (typeof opts.onState !== 'function') return;
    try { opts.onState(getState()); } catch (e) { console.warn('[fulltable] state', e); }
  };

  let qualBtn = null, leagueSel = null, teamSel = null, teamAnchor = null;
  if (!isTeam && opts.showMinGames !== false) {
    const mg = el('input', 'ep-input ft-num');
    mg.type = 'number'; mg.min = '0'; mg.value = String(minGames);
    mg.inputMode = 'numeric'; mg.title = 'minimum games played';
    mg.addEventListener('input', () => { minGames = parseInt(mg.value, 10) || 0; shown = PAGE; draw(); });
    /* the label and its box are one item, so a wrapping bar cannot put them on different rows */
    const field = el('label', 'ft-field');
    field.append(el('span', 'ft-count', 'min gp'), mg);
    more.appendChild(field);

    /* THE LOW-MINUTES CUT. A season table's noise is almost all in the players who
       barely played: a 2-for-2 night is a 100% shooter until somebody is asked to
       have played. Thirty minutes is the usual first cut, and it is a switch rather
       than a box to type in because that is the question people actually ask. */
    const MIN_CUT = 30;
    const cut = el('button', 'ep-btn ft-btn', MIN_CUT + '+ min');
    cut.type = 'button';
    cut.title = 'hide players with fewer than ' + MIN_CUT + ' minutes on the season';
    cut.addEventListener('click', () => {
      minMinutes = minMinutes ? 0 : MIN_CUT;
      cut.classList.toggle('pri', !!minMinutes); shown = PAGE; draw();
    });
    more.appendChild(cut);

    /* QUALIFIED PLAYERS ONLY, on by default where the rows say who qualifies: enough of the
       team's games and minutes that a per-game number is a season's rather than a night's */
    if (qualRows || LEAGUES) {
      qualBtn = el('button', 'ep-btn ft-btn ft-qual' + (qualOn ? ' pri' : ''), 'qualified');
      qualBtn.type = 'button';
      qualBtn.title = 'only players with a third of their team’s games and five minutes a team game (30 at least)';
      qualBtn.hidden = !qualRows;
      qualBtn.addEventListener('click', () => {
        qualOn = !qualOn; qualBtn.classList.toggle('pri', qualOn); shown = PAGE; draw(); emit();
      });
      more.appendChild(qualBtn);
    }

    /* one league, when the table spans several */
    if (opts.leagueSelect) {
      leagueSel = el('select', 'ep-input ft-sel ft-leaguesel');
      leagueSel.title = 'show one league';
      leagueSel.addEventListener('change', () => {
        leaguePick = leagueSel.value; fillTeams(true); shown = PAGE; draw(); emit();
      });
      more.appendChild(leagueSel);
    }

    /* one club, or one position group, out of whoever is in the table */
    teamSel = el('select', 'ep-input ft-sel');
    teamSel.title = 'show one club';
    teamSel.addEventListener('change', () => { teamPick = teamSel.value; shown = PAGE; draw(); emit(); });

    const posSel = el('select', 'ep-input ft-sel ft-possel');
    posSel.title = 'show one position group, by the calculated position corrected with the listed one';
    const posOpts = [['', 'every position']].concat((SE() && SE().POS_GROUPS ? SE().POS_GROUPS : []).map(g => [g[0], g[1]]));
    posOpts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; posSel.appendChild(o); });
    posSel.addEventListener('change', () => { posPick = posSel.value; shown = PAGE; draw(); });
    teamAnchor = posSel;
    fillLeagues(); fillTeams();
    if (posOpts.length > 1) more.appendChild(posSel);
  }

  /* THE LEAGUE AND CLUB LISTS ARE REBUILT whenever rows arrive (setRows), so a league that
     lands after the first draw is in them. The club select is only put in the bar once there
     are two clubs to choose between, as it always was. */
  function fillSelect(sel, list, value) {
    sel.textContent = '';
    list.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
    sel.value = value;
  }
  function fillLeagues() {
    if (!leagueSel) return;
    const m = new Map();
    rows.forEach(r => { if (r.leagueId == null) return; const k = String(r.leagueId);
      if (!m.has(k)) m.set(k, r.leagueShort || r.leagueName || k); });
    /* A PICK NOT IN THE ROWS IS KEPT: restored from a URL, its league may simply not have
       arrived yet. It filters to nothing until it does, and the select says so. */
    if (leaguePick && !m.has(leaguePick)) m.set(leaguePick, 'loading…');
    fillSelect(leagueSel, [['', 'every league']].concat([...m].sort((a, b) => a[1].localeCompare(b[1]))), leaguePick);
  }
  function fillTeams(dropUnknown) {
    if (!teamSel) return;
    let list;
    if (!LEAGUES) list = [...new Set(rows.map(r => r.teamName).filter(Boolean))].sort().map(t => [t, t]);
    else {
      /* keyed by team id and labelled "LEI · SLB W"; one league's clubs once a league is chosen */
      const m = new Map();
      rows.forEach(r => {
        if (r.teamId == null || (leaguePick && String(r.leagueId) !== leaguePick)) return;
        const k = String(r.teamId);
        if (!m.has(k)) m.set(k, (r.teamName || 'club') + (r.leagueShort ? ' · ' + r.leagueShort : ''));
      });
      list = [...m].sort((a, b) => a[1].localeCompare(b[1]));
    }
    /* a club from another league goes when a league is chosen; one not arrived yet is kept */
    if (teamPick && !list.some(x => x[0] === teamPick)) {
      if (dropUnknown) teamPick = ''; else list.push([teamPick, 'loading…']);
    }
    fillSelect(teamSel, [['', 'every club']].concat(list), teamPick);
    if (list.length > 1 && teamSel.parentNode !== more) {
      if (teamAnchor && teamAnchor.parentNode === more) more.insertBefore(teamSel, teamAnchor);
      else more.appendChild(teamSel);
    }
  }

  const heatBtn = el('button', 'ep-btn ft-btn' + (heat ? ' pri' : ''), 'heat map');
  heatBtn.type = 'button';
  heatBtn.title = 'shade each column by percentile within the table';
  heatBtn.addEventListener('click', () => {
    heat = !heat; heatBtn.classList.toggle('pri', heat); draw();
  });
  more.appendChild(heatBtn);

  /* ADJUSTED FOR POSITION: the same percentiles, taken within the player's own
     position group rather than the whole competition, so a centre's assist rate is
     read against centres. The colouring is the only thing that changes -- every
     number in the table is what it was. */
  if (!isTeam) {
    const posBtn = el('button', 'ep-btn ft-btn' + (byPos ? ' pri' : ''), 'adjust for position');
    posBtn.type = 'button';
    posBtn.title = 'shade each column against the player’s own position group';
    posBtn.addEventListener('click', () => {
      byPos = !byPos; posBtn.classList.toggle('pri', byPos); draw();
    });
    more.appendChild(posBtn);
  }

  /* RANK WITHIN LEAGUE (above render's state): the colouring, the position groups and every
     percentile a stat filter reads, taken per league. Only on a table that spans leagues. */
  if (WITHIN_TOGGLE) {
    const wb = el('button', 'ep-btn ft-btn ft-within' + (withinLeague ? ' pri' : ''), 'rank within league');
    wb.type = 'button';
    wb.title = 'percentiles against the player’s own league rather than every league in the table';
    wb.setAttribute('aria-pressed', withinLeague ? 'true' : 'false');
    wb.addEventListener('click', () => {
      withinLeague = !withinLeague; posMap = null;
      wb.classList.toggle('pri', withinLeague); wb.setAttribute('aria-pressed', withinLeague ? 'true' : 'false');
      shown = PAGE; draw(); emit();
    });
    more.appendChild(wb);
  }

  /* CALC RAPM. The page hands over a function that reads the season's logs and comes
     back with a coefficient per player; this only asks for it, says how far along it is,
     and puts the numbers on the rows. Pressed twice, it recomputes rather than refusing:
     a scope may have changed under it. */
  if (!isTeam && typeof opts.rapm === 'function' && !opts.noRapm) {
    const rb = el('button', 'ep-btn ft-btn', 'calc RAPM');
    rb.type = 'button';
    rb.title = 'read every stint of the competition and regress it: RAPM, ORAPM and DRAPM';
    rb.addEventListener('click', async () => {
      if (rb.disabled) return;
      rb.disabled = true; rb.classList.remove('pri');
      const say = t => { rb.textContent = t; };
      say('reading…');
      try {
        const res = await opts.rapm((done, total) => say('reading ' + done + '/' + total));
        const map = res && res.rapm ? res.rapm : res;
        let hit = 0;
        rows.forEach(r => {
          const v = map && map.get ? map.get(r.id) : null;
          if (!v) { r.rapm = r.orapm = r.drapm = null; return; }
          r.rapm = v.rapm; r.orapm = v.orapm; r.drapm = v.drapm; hit++;
        });
        say('calc RAPM'); rb.classList.toggle('pri', hit > 0);
        rb.title = hit + ' players from ' + ((res && res.stints) || 0) + ' stints' +
          (res && res.lambda ? ', lambda ' + Math.round(res.lambda) : '');
        draw();
      } catch (e) {
        console.warn('[rapm]', e);
        say('calc RAPM'); rb.title = 'could not be computed: ' + (e && e.message ? e.message : e);
      } finally { rb.disabled = false; }
    });
    more.appendChild(rb);
  }

  const colsBtn = el('button', 'ep-btn ft-btn', 'columns');
  colsBtn.type = 'button';
  colsBtn.addEventListener('click', () => { drawer.hidden = !drawer.hidden; });
  more.appendChild(colsBtn);

  /* THE STAT FILTERS' DRAWER lives inside .ft-more, so on a phone it opens inside the
     'filters' disclosure with everything else that narrows the table, and above the phone
     breakpoint it is a full-width row of the bar (kit/table.css .ft-filt). */
  const filt = FILTERS ? el('div', 'ft-filt') : null;
  let fTimer = null;
  const applyFilters = () => { shown = PAGE; draw(); emit(); };
  if (FILTERS) {
    statBtn = el('button', 'ep-btn ft-btn ft-statbtn', 'stat filters');
    statBtn.type = 'button';
    statBtn.setAttribute('aria-expanded', 'false');
    statBtn.title = 'keep only players over or under a number, or a percentile, in several stats at once';
    filt.hidden = true;
    statBtn.addEventListener('click', () => {
      filt.hidden = !filt.hidden;
      statBtn.setAttribute('aria-expanded', filt.hidden ? 'false' : 'true');
      if (!filt.hidden) drawFilters();
    });
    more.append(statBtn, filt);
  }
  function drawFilters() {
    if (!filt) return;
    filt.textContent = '';
    const stats = filterStats();
    const quick = quickSets();
    if (quick.length) {
      const qrow = el('div', 'ft-fquick');
      qrow.appendChild(el('span', 'ft-count', 'quick'));
      quick.forEach(([name, what, lines]) => {
        const b = el('button', 'ft-col ft-fset', name);
        b.type = 'button'; b.title = what;
        b.addEventListener('click', () => {
          filters = lines.map(([k, op, mode, x]) => ({ k, op, mode, x }));
          drawFilters(); applyFilters();
        });
        qrow.appendChild(b);
      });
      if (filters.length) {
        const clr = el('button', 'ft-col ft-fclear', 'clear');
        clr.type = 'button';
        clr.addEventListener('click', () => { filters = []; drawFilters(); applyFilters(); });
        qrow.appendChild(clr);
      }
      filt.appendChild(qrow);
    }
    const list = el('div', 'ft-flines');
    filters.forEach((f, i) => list.appendChild(filterLine(f, i, stats)));
    filt.appendChild(list);
    const add = el('button', 'ep-btn ft-btn ft-fadd', '+ add a filter');
    add.type = 'button';
    add.addEventListener('click', () => {
      const first = stats.find(c => !filters.some(f => f.k === c.k)) || stats[0];
      if (!first) return;
      filters.push({ k: first.k, op: 'ge', mode: 'pct', x: null });
      drawFilters();
    });
    filt.appendChild(add);
    const note = el('div', 'ft-count ft-fnote');
    filt.appendChild(note);
    paintFloors();
  }
  function filterLine(f, i, stats) {
    const line = el('div', 'ft-fline');
    const sel = el('select', 'ep-input ft-fstat');
    sel.setAttribute('aria-label', 'stat');
    stats.forEach(c => { const o = document.createElement('option');
      o.value = c.k; o.textContent = c.t ? c.l + ' — ' + c.t : c.l; sel.appendChild(o); });
    sel.value = f.k;
    sel.addEventListener('change', () => { f.k = sel.value; if (f.x != null) applyFilters(); else paintFilters(); });
    const op = el('button', 'ep-btn ft-btn ft-fop', f.op === 'le' ? '≤' : '≥');
    op.type = 'button';
    op.setAttribute('aria-label', f.op === 'le' ? 'at most' : 'at least');
    op.addEventListener('click', () => {
      f.op = f.op === 'le' ? 'ge' : 'le';
      op.textContent = f.op === 'le' ? '≤' : '≥';
      op.setAttribute('aria-label', f.op === 'le' ? 'at most' : 'at least');
      if (f.x != null) applyFilters();
    });
    const val = el('input', 'ep-input ft-fval');
    val.type = 'text'; val.inputMode = 'decimal';
    val.setAttribute('aria-label', 'number');
    val.placeholder = f.mode === 'pct' ? '0-100' : 'value';
    val.value = f.x == null ? '' : String(f.x);
    const takeVal = () => {
      const s = String(val.value || '').trim().replace(',', '.');
      const x = s === '' ? null : Number(s);
      f.x = fin(x) ? x : null;
    };
    val.addEventListener('input', () => {
      clearTimeout(fTimer);
      fTimer = setTimeout(() => { takeVal(); applyFilters(); }, SEARCH_WAIT);
    });
    val.addEventListener('change', () => { clearTimeout(fTimer); takeVal(); applyFilters(); });
    const mode = el('button', 'ep-btn ft-btn ft-fmode', f.mode === 'pct' ? 'pctl' : 'value');
    mode.type = 'button';
    mode.title = 'the stat’s own value, or its percentile in the table';
    mode.addEventListener('click', () => {
      f.mode = f.mode === 'pct' ? 'val' : 'pct';
      mode.textContent = f.mode === 'pct' ? 'pctl' : 'value';
      val.placeholder = f.mode === 'pct' ? '0-100' : 'value';
      if (f.x != null) applyFilters();
    });
    const x = el('button', 'ep-btn ft-btn ft-fx', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'remove this filter');
    x.addEventListener('click', () => {
      const had = f.x != null;
      filters = filters.filter(g => g !== f);
      drawFilters();
      if (had) applyFilters(); else paintFilters();
    });
    line.append(sel, op, val, mode, x);
    return line;
  }
  /* the volume minimums the last view applied, said once in the drawer and once in the count */
  const floorText = () => lastFloors.map(fl => 'min ' + fl.label + ' ' + fl.x.toFixed(1) + ' for ' + fl.rates.join(', ')).join(' · ');
  function paintFloors() {
    const note = filt && filt.querySelector('div.ft-fnote');
    if (note) note.textContent = floorText();
  }

  const csv = el('button', 'ep-btn ft-btn', 'csv');
  csv.type = 'button';
  csv.addEventListener('click', exportCsv);
  more.appendChild(csv);

  const count = el('span', 'ft-count ft-tally');
  bar.appendChild(count);
  host.appendChild(bar);

  /* ---- row 2: presets ---- */
  const pills = el('div', 'ft-pills');
  /* a padlock drawn rather than typed: no emoji font to depend on, and it takes the pill's
     own colour in either theme */
  const lockMark = () => {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    [['class', 'ft-lock'], ['viewBox', '0 0 10 12'], ['width', '8'], ['height', '10'], ['aria-hidden', 'true']]
      .forEach(([k, v]) => s.setAttribute(k, v));   /* placed by .ft-lock in kit/table.css */
    const arc = document.createElementNS(NS, 'path');
    [['d', 'M2.7 5.2V3.6a2.3 2.3 0 0 1 4.6 0v1.6'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.4']]
      .forEach(([k, v]) => arc.setAttribute(k, v));
    const body = document.createElementNS(NS, 'rect');
    [['x', '1'], ['y', '5.2'], ['width', '8'], ['height', '6.3'], ['rx', '1'], ['fill', 'currentColor']]
      .forEach(([k, v]) => body.setAttribute(k, v));
    s.append(arc, body);
    return s;
  };
  /* THE TEASER SITS DIRECTLY ABOVE THE TABLE, made when a locked preset is pressed and taken
     away again by any other preset. Never left in the page hidden: a stylesheet that gives
     the teaser a display of its own would override [hidden] and show it to everybody. */
  let teaserEl = null;
  const hideTeaser = () => { if (teaserEl) { teaserEl.remove(); teaserEl = null; } };
  const showTeaser = (key, label) => {
    const A = ACC();
    if (!A || typeof A.teaserHTML !== 'function') return;
    if (!teaserEl) { teaserEl = el('div', 'ft-teaser'); host.insertBefore(teaserEl, head); }
    teaserEl.innerHTML = A.teaserHTML({
      leagueSlug: opts.leagueSlug, title: label,
      lines: [/^z_/.test(key)
        ? 'Every club’s shot profile zone by zone — share of shots, attempts per 100 possessions, makes and eFG% — ranked across the league.'
        : 'Second chances, transition, points off turnovers, after-timeout sets, the half court and assisted baskets, for every ' + (isTeam ? 'club at both ends.' : 'player.')]
    });
  };
  function drawPills() {
    pills.textContent = '';
    presets.forEach(([key, label]) => {
      const shut = presetLocked(key);
      const b = el('button', 'ft-pill' + (key === preset ? ' on' : '') + (shut ? ' locked' : ''), label);
      b.type = 'button'; b.dataset.g = key;
      if (shut) { b.appendChild(lockMark()); b.title = label + ' — part of Epinoia analytics'; }
      b.addEventListener('click', () => {
        if (presetLocked(key)) { showTeaser(key, label); return; }
        hideTeaser();
        preset = key; extra.clear(); removed.clear();
        pills.querySelectorAll('.ft-pill').forEach(p => p.classList.toggle('on', p.dataset.g === key));
        drawDrawer(); draw(); revealPill(); emit();
      });
      pills.appendChild(b);
    });
    revealPill();
  }
  /* ON A PHONE THE PRESETS ARE ONE ROW THAT PANS (kit/table.css), so the chosen one is
     brought into the row when it has been left off either end of it */
  function revealPill() {
    if (!isPhone()) return;
    const on = pills.querySelector('.ft-pill.on');
    if (!on) return;
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < pills.scrollLeft || r > pills.scrollLeft + pills.clientWidth) pills.scrollLeft = Math.max(0, l - 12);
  }
  drawPills();
  host.appendChild(pills);
  if (typeof window !== 'undefined' && window.epinoiaDragScroll) window.epinoiaDragScroll(pills);

  /* ---- row 3: every column, toggleable ---- */
  const drawer = el('div', 'ft-cols'); drawer.hidden = true;
  const grid = el('div', 'ft-colgrid'); drawer.appendChild(grid);
  host.appendChild(drawer);

  function drawDrawer() {
    grid.textContent = '';
    const shown = new Set(visible().map(c => c.k));
    CAT.filter(c => !c.g.includes('id') && !absent(c.k)).forEach(c => {
      const on = shown.has(c.k);
      const b = el('button', 'ft-col' + (on ? ' on' : ''), c.l);
      b.type = 'button';
      if (c.t) b.title = c.t;
      b.addEventListener('click', () => {
        if (shown.has(c.k)) { extra.delete(c.k); removed.add(c.k); }
        else { removed.delete(c.k); extra.add(c.k); }
        drawDrawer(); draw();
      });
      grid.appendChild(b);
    });
  }
  drawDrawer();

  /* THE PHONE'S STICKY HEADER. On a phone .ft-wrap is overflow:hidden (the axis trap,
     kit/table.css), which makes it the sticky container for its own header -- and it
     never scrolls vertically, so the column names left with the first twenty rows. The
     header row is drawn instead into a table of its own in .ft-head, a strip BEFORE the
     wrap whose ancestors all let it stick to the top of the page, and the strip is kept
     at the wrap's scrollLeft: by xscroll.js on every pan (the __ftMirror pair) and by a
     scroll listener as a backstop. Above the breakpoint the strip is empty and hidden and
     the header is the table's own, sticky as before. */
  const head = el('div', 'ft-head');
  const wrap = el('div', 'ft-wrap');
  host.appendChild(head);
  host.appendChild(wrap);
  wrap.__ftMirror = head; head.__ftMirror = wrap;
  const syncHead = () => { if (head.scrollLeft !== wrap.scrollLeft) head.scrollLeft = wrap.scrollLeft; };
  wrap.addEventListener('scroll', syncHead, { passive: true });
  /* the sweep catches this too, on its next pass; wiring it here as well means
     the first touch after a render does not depend on that pass having run */
  if (window.epinoiaDragScroll) { window.epinoiaDragScroll(wrap); window.epinoiaDragScroll(head); }

  /* the next page of rows, under the table rather than inside its scroller */
  const moreRows = el('button', 'ep-btn ft-btn ft-morerows');
  moreRows.type = 'button'; moreRows.hidden = true;
  host.appendChild(moreRows);

  /* ---- the compare tray (opts.selectable) ----
     A PICK BUTTON IN THE RANK CELL, not a checkbox column: a new column would move the pinned
     name's left edge and every width sum. The tray sticks to the bottom of the screen above the
     tab bar and the gesture area (kit/table.css .ft-tray), lists the picks numbered in the
     order the compare chart draws them, and hands them over with the stats on screen. */
  const tray = SELECT ? el('div', 'ft-tray') : null;
  if (SELECT) {
    host.classList.add('ft-selectable');
    tray.hidden = true;
    tray.setAttribute('role', 'region');
    tray.setAttribute('aria-label', 'players to compare');
    host.appendChild(tray);
  }
  let trayNote = '';
  /* THE BAR'S REAL HEIGHT, NOT A GUESS. The phone bar is 58px with a league's tab bar in it,
     but on a page with no league (global scouting) nav.js draws the country row instead, which
     measured 69.25px: a tray offset by 58px sat 11px under it, over the Compare button. So the
     bar is measured (.ep-nav, border box, which already holds the home-indicator inset) into
     --ep-nav-h, and the tray's own height into --ft-tray-h with body.ft-tray-open while it
     shows, so the notification bell can be lifted clear of it (kit/table.css). Only a
     selectable table does this; nav.js mounts after this script, so it is looked for when the
     tray first paints. */
  let barWatch = null;
  function watchBars() {
    const de = document.documentElement, body = document.body;
    if (!de || !de.style || !body) return;
    const nav = document.querySelector('.ep-nav');
    /* rounded UP: offsetHeight rounds 69.25 down to 69 and leaves a sliver under the bar */
    const hOf = n => Math.ceil(n.getBoundingClientRect ? n.getBoundingClientRect().height : n.offsetHeight || 0);
    const setH = () => {
      if (nav && hOf(nav)) de.style.setProperty('--ep-nav-h', hOf(nav) + 'px');
      /* MEASURED, NOT ASSUMED, because a tabbed page can hide the tray without touching it:
         the league page's table lives in a pane, and switching to the team tab takes the tray
         off the screen with it. Its height is then 0, which the observer below reports, so the
         notification bell drops back rather than staying lifted over nothing. */
      const up = !!(tray && !tray.hidden && hOf(tray));
      if (up) de.style.setProperty('--ft-tray-h', hOf(tray) + 'px');
      if (tray && body.classList) body.classList.toggle('ft-tray-open', up);
    };
    setH();
    if (barWatch || !nav || typeof ResizeObserver !== 'function') return;
    barWatch = new ResizeObserver(setH);
    barWatch.observe(nav);
    barWatch.observe(tray);
  }
  if (SELECT) { try { watchBars(); } catch (_) { /* measured again when the tray paints */ } }
  const statKeys = () => visible().filter(c => c.heat && !absent(c.k)).map(c => c.k);
  function paintPick(b, on, r) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (on ? 'take ' : 'pick ') + (r.name || 'player') + (on ? ' out of the comparison' : ' to compare'));
    const tr = b.parentNode && b.parentNode.parentNode;
    if (tr && tr.classList) tr.classList.toggle('picked', on);
  }
  function togglePick(r) {
    const id = String(r.id);           // picks are keyed as the button's data-id is: a string
    if (picked.has(id)) { picked.delete(id); trayNote = ''; }
    else if (picked.size >= PICK_MAX) { trayNote = PICK_MAX + ' players at most — take one out first'; }
    else { picked.set(id, r); trayNote = ''; }
    repaintPicks(); paintTray();
  }
  function repaintPicks() {
    if (!last) return;
    last.tb.querySelectorAll('button.ft-pick').forEach(b => {
      const r = picked.get(b.dataset.id);
      paintPick(b, !!r, r || { name: b.dataset.name });
    });
  }
  function paintTray() {
    if (!tray) return;
    tray.textContent = '';
    tray.hidden = picked.size === 0 && !trayNote;
    const list = el('div', 'ft-traylist');
    [...picked.values()].forEach((r, i) => {
      const chip = el('span', 'ft-chip');
      chip.dataset.n = String(i + 1);
      chip.append(el('b', 'ft-chipn', String(i + 1)),
                  el('span', 'ft-chipname', (r.name || 'player') + (r.leagueShort ? ' · ' + r.leagueShort : '')));
      const x = el('button', 'ft-chipx', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'take ' + (r.name || 'player') + ' out');
      x.addEventListener('click', () => { picked.delete(String(r.id)); trayNote = ''; repaintPicks(); paintTray(); });
      chip.appendChild(x);
      list.appendChild(chip);
    });
    tray.appendChild(list);
    if (trayNote) tray.appendChild(el('span', 'ft-count ft-traynote', trayNote));
    const acts = el('div', 'ft-trayacts');
    const clr = el('button', 'ep-btn ft-btn ft-trayclear', 'clear');
    clr.type = 'button';
    clr.addEventListener('click', () => { picked.clear(); trayNote = ''; repaintPicks(); paintTray(); });
    const go = el('button', 'ep-btn ft-btn pri ft-compare', picked.size > 1 ? 'compare ' + picked.size : 'pick 2 to compare');
    go.type = 'button';
    go.disabled = picked.size < 2;
    go.addEventListener('click', () => {
      if (picked.size < 2) return;
      if (typeof opts.onCompare === 'function') { opts.onCompare(getSelected(), statKeys()); return; }
      openCompare();
    });
    acts.append(clr, go);
    tray.appendChild(acts);
    if (document.body && document.body.classList) document.body.classList.toggle('ft-tray-open', !tray.hidden);
    try { watchBars(); } catch (_) { /* the CSS fallback offsets stand */ }
  }
  function getSelected() { return [...picked.values()]; }

  /* percentiles for the given stats (the visible preset's by default), over the population
     and the current grouping, ranked as the heat colours and the stat filters rank them
     (a floored rate among the players who clear its floor).
     A PICK THE LEAGUE, CLUB OR POSITION SELECT HAS SINCE LEFT OUT is ranked over the table
     before those selects instead: dropped into the picked league's pool he would be alone in
     his own league's group (under three players, no rank, every bar 'no data'), or ranked
     against a league he never played in. A player being compared always has a rank.
     A FUNCTION, NOT ONLY AN API METHOD: the table's own comparison (openCompare) needs it too. */
  function getRanksFor(keys) {
    const ks = (Array.isArray(keys) ? keys : statKeys()).filter(k => !absent(k));
    const floors = FILTERS && liveLines().length ? (view(), lastFloors) : null;
    const keep = new Set(picked.keys());
    const pop = population();
    const ids = new Set(pop.map(r => String(r.id)));
    const out = ranksOver(pop, ks, floors, keep);
    const outside = [...picked.values()].filter(r => !ids.has(String(r.id)));
    if (!outside.length) return out;
    const base = basePopulation();
    const bids = new Set(base.map(r => String(r.id)));
    outside.forEach(r => { if (!bids.has(String(r.id))) base.push(r); });
    ranksOver(base, ks, floors, keep).forEach((m, k) => {
      let into = out.get(k);
      if (!into) { into = new Map(); out.set(k, into); }
      outside.forEach(r => { if (m.has(r.id)) into.set(r.id, m.get(r.id)); });
    });
    return out;
  }

  /* THE COMPARISON EVERY SELECTABLE TABLE GETS (compare.js). A page that asks for the tray
     and nothing else gets the chart: the picks, the stats on screen, the percentiles this
     table has already ranked, and each of the table's own categories as a dropdown holding
     every other stat in it. A page whose percentiles mean something particular passes its own
     onCompare instead — the global scouting page does, because its ranks are per league.
     EVERY USABLE COLUMN IS RANKED, not only the ones on screen: a stat chosen from a dropdown
     must arrive with its percentile, or the bar it draws would read as "no data". */
  function openCompare() {
    const C = root.EpinoiaCompare;
    if (!C || typeof C.fromTable !== 'function' || typeof C.open !== 'function' || isTeam) return;
    const keys = statKeys();
    const rankable = CAT.filter(c => c.heat && !absent(c.k)).map(c => c.k);
    let ranks = null;
    try { ranks = getRanksFor(rankable); } catch (_) { ranks = null; }
    C.open(C.fromTable({
      picks: getSelected(), statKeys: keys, cols: CAT, ranks, groups: presets,
      locked: k => absent(k), max: PICK_MAX,
      note: 'Percentiles among the players this table covers, before its stat filters and search.'
    }));
  }

  const sortVal = (c, r) => (c.sort ? c.sort(r) : r[c.k]);

  /* THE POPULATION: every filter that decides who is in the table, before the stat filters
     and the search. Heat and every percentile a stat filter reads are ranked over it. */
  /* who counts at all (games, minutes, qualified), before any league, club or position is picked */
  function basePopulation() {
    let v = rows.filter(r => (r.gp || 0) >= minGames);
    if (minMinutes) v = v.filter(r => (r.min || 0) >= minMinutes);
    if (qualRows && qualOn) v = v.filter(r => r.qualified !== false);
    return v;
  }
  function population() {
    let v = basePopulation();
    if (leaguePick) v = v.filter(r => String(r.leagueId) === leaguePick);
    if (teamPick) v = v.filter(r => LEAGUES ? String(r.teamId) === teamPick : r.teamName === teamPick);
    if (posPick) v = v.filter(r => groupOf(r) === posPick);
    return v;
  }

  /* percentiles over the population for the given keys; a rate with a volume floor is ranked
     only among the players who clear it. `keep` (ids) stay in a floored pool whatever their
     volume: a player being compared is ranked, not dropped, under a floor he misses */
  function ranksOver(pop, keys, floors, keep) {
    const S = SE();
    const out = new Map();
    if (!S || !keys.length) return out;
    const grp = rankGroup();
    keys.forEach(k => {
      const c = fcol(k) || colOf(k);
      const fl = floors && RATE_VOL[k] ? floors.find(x => x.vol === RATE_VOL[k]) : null;
      const pool = fl ? pop.filter(r => (fin(r[fl.vol]) && r[fl.vol] >= fl.x) || (keep && keep.has(String(r.id)))) : pop;
      const m = S.percentiles(pool, [k], c && c.low ? [k] : [], grp).get(k);
      if (m) out.set(k, m);
    });
    return out;
  }

  function view() {
    const pop = population();
    let v = pop;
    lastPop = pop; lastFloors = [];
    const lines = FILTERS ? liveLines() : [];
    if (lines.length) {
      /* the volume floors first, one per volume however many of its rates are filtered */
      const floors = [];
      lines.forEach(f => {
        const vk = RATE_VOL[f.k];
        if (!vk || isTeam) return;
        let fl = floors.find(x => x.vol === vk);
        if (!fl) { fl = { vol: vk, label: (extraCols.find(c => c.k === vk) || colOf(vk) || { l: vk }).l, x: volFloor(pop, vk), rates: [] }; floors.push(fl); }
        const lab = (fcol(f.k) || { l: f.k }).l;
        if (fl.rates.indexOf(lab) === -1) fl.rates.push(lab);
      });
      lastFloors = floors;
      const pctKeys = [...new Set(lines.filter(f => f.mode === 'pct').map(f => f.k))];
      const pct = ranksOver(pop, pctKeys, floors);
      floors.forEach(fl => { v = v.filter(r => fin(r[fl.vol]) && r[fl.vol] >= fl.x); });
      lines.forEach(f => {
        v = v.filter(r => {
          const x = f.mode === 'pct' ? (pct.get(f.k) || new Map()).get(r.id) : r[f.k];
          if (!fin(x)) return false;
          return f.op === 'le' ? x <= f.x : x >= f.x;
        });
      });
    }
    if (search) v = v.filter(r =>
      ((r.name || '') + ' ' + (r.teamName || '') +
       (opts.searchLeagues ? ' ' + (r.leagueName || '') + ' ' + (r.leagueShort || '') : '')).toLowerCase().includes(search));
    if (v === pop) v = v.slice();
    /* a locked column is not a sort either: ordering by it would print its ranking.
       A player table falls back to GP by key, not by place in the catalogue, so a column put
       in front of it cannot quietly become the fallback. The team table's fourth column has
       always been PPG (T has no TEAM column), and stays its fallback. */
    const c = (!absent(sortKey) && colOf(sortKey)) || (isTeam ? CAT[3] : CAT.find(x => x.k === 'gp')) || CAT[3];
    v.sort((a, b) => {
      const x = sortVal(c, a), y = sortVal(c, b);
      if (c.text) return String(x || '').localeCompare(String(y || '')) * (sortDir === -1 ? 1 : -1);
      /* A PLAYER WITH NO NUMBER SINKS, WHICHEVER WAY THE COLUMN IS SORTED. Sorting a
         dash as minus infinity put every player who has not taken a three at the top
         of "worst 3P%", which is not what anyone means by sorting a column: an empty
         cell is not a low value, it is an absent one. */
      const xn = x == null || !isFinite(x), yn = y == null || !isFinite(y);
      if (xn || yn) return xn && yn ? 0 : (xn ? 1 : -1);
      return (y - x) * (sortDir === -1 ? 1 : -1);
    });
    return v;
  }

  /* Width each column to its own widest value rather than to a single flat
     number. A canvas measures the glyphs at the exact font the cells use, so a
     column of "1.7" is narrow and one of "112.5" or "7.3-14.7" gets the room
     it needs — without any column being wide enough to skew the table.

     The header is measured too: "OPP OREB%" is wider than anything under it,
     and a clipped heading is worse than a slightly wide column. */
  let fontWait = null;          // the one redraw waiting on the table's fonts
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d');
  function measure(cols, rows, phone) {
    const cs = getComputedStyle(document.body);
    const dataFont = '11.5px ' + (cs.getPropertyValue('--f-data') || 'monospace');
    /* the phone header is set larger (kit/table.css), so it is measured at that size */
    const headFont = (phone ? '9.5px ' : '8px ') + (cs.getPropertyValue('--f-micro') || 'monospace');
    /* NOT BEFORE THE FONT IS IN. A canvas asked to measure a web font that has not loaded
       measures the fallback instead, and Martian Mono is a quarter wider than a system
       monospace: measured live, "23.6" came out 44px wide and rendered at 47, so every
       decimal column was an ellipsis. One redraw once the face arrives. */
    const F = typeof document !== 'undefined' ? document.fonts : null;
    if (!fontWait && F && typeof F.check === 'function' && typeof F.load === 'function') {
      try {
        if (!F.check(dataFont) || !F.check(headFont)) {
          fontWait = Promise.all([F.load(dataFont), F.load(headFont)])
            .then(() => { if (host.__ftWrap === wrap) draw(); }, () => {});
        }
      } catch (_) { /* measure with what there is */ }
    }
    const PAD = 18;                 // 8px each side plus a hair of breathing room
    const MIN = 44, MAX = 96;
    /* A PHONE HEADING IS MEASURED WITH ITS LETTER-SPACING (.1em of 9.5px, kit/table.css)
       and may take a wider column than a figure may: at 9.5px "PTS CONTRIB/G" is past
       96px, and capped there it ran under the next heading, which painted over it. The
       desktop sizes are what they were. */
    const HEAD_MAX = phone ? 120 : MAX, TRACK = phone ? 0.95 : 0;
    const out = {};
    /* a sample is enough — measuring 400 rows to find the widest costs more
       than the pixel or two of accuracy it buys */
    const sample = rows.length > 60 ? rows.slice(0, 60) : rows;
    cols.forEach((c, i) => {
      if (i < 2) { out[c.k] = i === 0 ? w0 : (phone ? W1_PHONE : W1_WIDE); return; }
      ctx2d.font = headFont;
      const hw = ctx2d.measureText(c.l).width + String(c.l).length * TRACK;
      let w = 0;
      ctx2d.font = dataFont;
      sample.forEach((r, idx) => {
        const txt = String(c.fmt(r, idx));
        const m = ctx2d.measureText(txt).width;
        if (m > w) w = m;
      });
      out[c.k] = Math.max(MIN, Math.min(MAX, Math.ceil(w) + PAD), Math.min(HEAD_MAX, Math.ceil(hw) + PAD));
    });
    return out;
  }

  /* ------------------------------------------------------------ resizing ---
     Drag the right edge of any header to set that column's width.

     The automatic width fits the widest value, which is right nearly always
     and wrong exactly when a reader wants to see a long name in full or squeeze
     a column out of the way. A grip costs one element per header and makes the
     table theirs.

     The grip swallows the click so resizing never also re-sorts — sharing an
     edge between "drag me" and "click me" is how a table becomes infuriating.

     Widths are remembered per table for the session, so switching preset and
     coming back does not undo the adjustment. */
  const held = {};

  /* A COLUMN CANNOT BE NARROWER THAN THIS OR WIDER THAN THAT. The floor keeps a
     column grabbable after it has been squeezed; the ceiling is what stops one
     slip of the hand turning a table into a horizontal scroll of one column. */
  const MIN_W = 34, MAX_W = 460;

  function addGrip(th, col, table) {
    const grip = document.createElement('span');
    grip.className = 'ft-grip';
    grip.setAttribute('aria-hidden', 'true');
    let startX = 0, startW = 0, startTableW = 0, active = false;

    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      active = true;
      startX = e.clientX;
      /* THE DECLARED WIDTH, NOT THE MEASURED ONE, and this is the whole fix.
         Under table-layout:fixed the browser reconciles the declared column
         widths against the table's own width, so what a cell MEASURES is not
         what it was told to be. The old handler re-summed those measurements
         on every pointermove and assigned the total back to the table — so each
         frame's reconciliation fed the next one, and at 60-120 events a second
         a two-pixel drag became several hundred pixels before the hand moved.
         It read as "I hold it and it instantly goes massively wide", which is
         exactly what a feedback loop looks like from the outside.

         Nothing is measured inside the drag now. One snapshot on the way in,
         one arithmetic delta per move. */
      startW = held[col.k] != null ? held[col.k]
             : Math.round(parseFloat(th.style.width) ||
                          th.getBoundingClientRect().width);
      startTableW = Math.round(parseFloat(table.style.width) ||
                               table.getBoundingClientRect().width);
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('on');
    });

    grip.addEventListener('pointermove', e => {
      if (!active) return;
      /* WRITTEN STRAIGHT OUT, not deferred to a frame.

         The instinct is to coalesce this into requestAnimationFrame, and it is
         the wrong instinct here: what makes a resize handler expensive is
         READING geometry between writes, because each read forces the layout
         the last write invalidated. There is no read left in this function —
         two style writes per move only invalidate, and the browser lays out
         once before it paints whatever the final value was. Chrome also
         coalesces pointermove to about one per frame already.

         And deferring had a cost. rAF does not run on a page that is not
         compositing — a hidden tab, a collapsed pane — so a drag begun and
         finished while hidden would apply nothing at all, the pointerup having
         cancelled the frame that never came. */
      const w = Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - startX)));
      th.style.width = Math.round(w) + 'px';
      held[col.k] = Math.round(w);
      /* The table grows or shrinks by exactly what the column did, so no other
         column moves under the cursor and nothing is re-measured. */
      table.style.width = Math.round(startTableW + (w - startW)) + 'px';
    });

    const stop = e => {
      if (!active) return;
      active = false;
      try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
      grip.classList.remove('on');
    };
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
    /* never let the grip's click reach the header's sort handler */
    grip.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
    grip.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation();
      delete held[col.k];            // back to the measured width
      draw();
    });
    th.appendChild(grip);
  }

  const hasCrest = r => !!(r.colour || r.teamColour || r.logo || r.teamLogo);

  function rowEl(r, idx, cols, ranks) {
    const tr = el('tr');
    cols.forEach((c, i) => {
      const td = el('td', i < 2 ? 'stick c' + i : '');
      if (c.k === 'name') {
        const cell = el('div', 'ft-name');
        if (hasCrest(r)) {
          const meta = { short_name: r.teamShort || (isTeam ? r.name : ''), name: isTeam ? r.name : (r.teamFull || ''),
                         colour: r.colour || r.teamColour, logo_path: r.logo || r.teamLogo || null };
          let crest;
          if (window.epinoiaCrest) crest = window.epinoiaCrest(meta, { cls: 'ft-crest' });
          else { crest = el('span', 'ft-crest', (r.teamShort || '').slice(0, 3)); crest.style.background = meta.colour; }
          cell.appendChild(crest);
        }
        const href = isTeam ? (opts.teamHref && opts.teamHref(r))
                            : (opts.playerHref && opts.playerHref(r));
        if (href) { const a = el('a', null, r.name); a.href = href; cell.appendChild(a); }
        else cell.appendChild(el('span', null, r.name));
        td.appendChild(cell);
      } else if (SELECT && c.k === 'rank') {
        /* the rank stays the button's text: a pick is a press on the row's own number */
        const b = el('button', 'ft-pick', c.fmt(r, idx));
        b.type = 'button'; b.dataset.id = String(r.id); b.dataset.name = r.name || '';
        td.appendChild(b); tr.appendChild(td);
        paintPick(b, picked.has(String(r.id)), r);
        b.addEventListener('click', e => { if (e && e.stopPropagation) e.stopPropagation(); togglePick(r); });
        return;
      } else {
        td.textContent = c.fmt(r, idx);
        if (c.lead) td.classList.add('lead');
        if (heat && c.heat) {
          const p = (ranks.get(c.k) || new Map()).get(r.id);
          if (p != null) td.style.cssText = heatStyle(p);
        }
        if (c.signed && !heat) {
          const n = r[c.k];
          if (n > 0) td.classList.add('pos'); else if (n < 0) td.classList.add('neg');
        }
      }
      tr.appendChild(td);
    });
    return tr;
  }

  /* what the last draw put on screen, so "show more" can add rows without redrawing */
  let last = null;              // { all, cols, ranks, tb }

  const noun = n => isTeam ? (n === 1 ? ' team' : ' teams') : (n === 1 ? ' player' : ' players');
  function paintCount(all) {
    const on = Math.min(shown, all.length);
    const floors = floorText();
    count.textContent = (on < all.length ? on + ' of ' + all.length : String(all.length)) + noun(all.length) +
      (floors ? ' · ' + floors : '');
    count.classList.toggle('ft-floored', !!floors);
    paintFloors();
  }
  function paintMore(all) {
    const rest = all.length - Math.min(shown, all.length);
    moreRows.hidden = !(rest > 0);
    if (rest > 0) moreRows.textContent = 'show ' + Math.min(PAGE, rest) + ' more';
  }
  function appendRows(from, to) {
    const frag = document.createDocumentFragment();
    for (let idx = from; idx < to; idx++) frag.appendChild(rowEl(last.all[idx], idx, last.cols, last.ranks));
    last.tb.appendChild(frag);
  }
  moreRows.addEventListener('click', () => {
    if (!last) return;
    const from = Math.min(shown, last.all.length);
    shown += PAGE;
    appendRows(from, Math.min(shown, last.all.length));
    paintCount(last.all); paintMore(last.all); emit();
  });

  /* AFTER A SORT ON A PHONE, THE SORTED COLUMN IS BROUGHT ON SCREEN. Only a few columns
     fit beside the pinned name, so a tap on a header that has half-scrolled away sorted
     a column the reader could no longer see. */
  function revealSorted() {
    const th = head.querySelector('th.sorted');
    /* the pinned # and name are always on screen: nothing to reveal, and measuring one
       would pan a reader who had scrolled right back towards the start */
    if (!th || th.classList.contains('stick')) return;
    const pinned = w0 + W1_PHONE;
    const l = th.offsetLeft, r = l + th.offsetWidth;
    if (l >= wrap.scrollLeft + pinned && r <= wrap.scrollLeft + wrap.clientWidth) return;
    wrap.scrollLeft = Math.max(0, l - pinned - 8);
    head.scrollLeft = wrap.scrollLeft;
  }

  function draw() {
    paintFilters();
    const phone = isPhone();
    let cols = visible();
    /* A PHONE DROPS THE TEAM COLUMN when the name cell already carries the club's crest:
       it repeated the crest in 99px of a 360px screen. EVERY row's, not any row's: a club
       with no colour or logo draws no crest, and its players would show no club at all.
       The CSV keeps it (visible()). */
    if (phone && rows.length && rows.every(hasCrest)) cols = cols.filter(c => c.k !== 'teamName');
    const all = view();
    const v = all.length > shown ? all.slice(0, shown) : all;
    paintCount(all);
    const keepX = phone ? wrap.scrollLeft : 0;
    wrap.textContent = ''; head.textContent = '';
    last = null; paintMore([]);
    if (!all.length) {
      wrap.appendChild(el('div', 'ft-empty', rows.length
        ? 'Nothing matches that filter.'
        : 'No statistics yet — these fill in as games are finalised.'));
      return;
    }

    /* percentiles are computed over the rows the filters leave, so a filtered table
       ranks within what you are actually looking at — same as index_9. Over ALL of
       them, not the page on screen: a row's colour must not change when more are shown. */
    /* WITH STAT FILTERS ON, over the population they were applied to instead: a hand-picked
       group of 80th-percentile shooters ranked among themselves would be painted average. */
    let ranks = new Map();
    if (heat && window.EpinoiaSeason) {
      const keys = cols.filter(c => c.heat).map(c => c.k);
      const low  = cols.filter(c => c.heat && c.low).map(c => c.k);
      const pool = FILTERS && liveLines().length && lastPop ? lastPop : all;
      ranks = window.EpinoiaSeason.percentiles(pool, keys, low, rankGroup());
      /* A RATE UNDER A VOLUME FLOOR IS COLOURED AS THE FILTER RANKED IT: among the players who
         clear the floor, not beside 1-for-1 shooters. Otherwise a player kept by "3P% >= 80th"
         could be painted 65th in the very column he was filtered on. */
      if (FILTERS && lastFloors.length && lastPop) {
        const floored = keys.filter(k => RATE_VOL[k] && lastFloors.some(fl => fl.vol === RATE_VOL[k]));
        if (floored.length) ranksOver(lastPop, floored, lastFloors).forEach((m, k) => ranks.set(k, m));
      }
    }

    const t = el('table', 'ft');
    /* Declare the table's own width as the sum of its columns.

       With table-layout:fixed and width:max-content the browser still has to
       reconcile a computed table width against the declared column widths, and
       it hands the surplus to a single column — which is exactly how PPG ended
       up 124px wide against 52px everywhere else. Summing the columns and
       stating the total leaves nothing to reconcile. The name column is the
       width kit/table.css gives it at this size, or the phone table was declared
       38px wider than its columns and the surplus spread over every one. */
    const W1 = phone ? W1_PHONE : W1_WIDE;
    /* measured over the whole filtered table, not the page on screen: rows added by
       'show more' reuse these widths, and a wider value further down must fit too */
    const widths = measure(cols, all, phone);
    /* a width the reader set by hand wins over the measured one */
    Object.keys(held).forEach(k => { if (widths[k] != null) widths[k] = held[k]; });
    const totalW = w0 + W1 + cols.slice(2).reduce((n, c) => n + widths[c.k], 0);
    t.style.width = totalW + 'px';
    const grips = !phone && !isCoarse();

    const thead = el('thead'), hr = el('tr');
    cols.forEach((c, i) => {
      const th = el('th', (c.k === sortKey ? 'sorted ' : '') + (i < 2 ? 'stick c' + i : ''), c.l);
      /* Width is set on the header only; the table is fixed-layout, so the
         column follows. Without this a long header like "OPP OREB%" or a wide
         cell like "192-440" stretched its column and squeezed every other one,
         which is what threw PPG and DIFF out of proportion. */
      if (i >= 2) th.style.width = widths[c.k] + 'px';
      else if (phone) th.style.width = (i === 0 ? w0 : W1) + 'px';
      th.title = (c.t ? c.l + ' — ' + c.t : c.l) + (c.low ? ' — lower is better' : '');
      /* a grip on the trailing edge, so a column can be widened by hand when
         the measured width is not what this particular reader wants */
      if (i >= 1 && grips) addGrip(th, c, t);
      th.addEventListener('click', () => {
        if (sortKey === c.k) sortDir = -sortDir;
        else { sortKey = c.k; sortDir = c.text ? 1 : -1; }
        shown = PAGE;
        draw();
        if (isPhone()) revealSorted();
        emit();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    if (phone) {
      /* two tables, one set of columns: the header strip's and the body's widths come
         from the same colgroup, since the body no longer has a header row to take them from */
      const colgroup = () => {
        const g = el('colgroup');
        cols.forEach((c, i) => { const col = el('col');
          col.style.width = (i === 0 ? w0 : i === 1 ? W1 : widths[c.k]) + 'px'; g.appendChild(col); });
        return g;
      };
      const ht = el('table', 'ft');
      ht.style.width = totalW + 'px';
      ht.dataset.xscrolled = '1';            // never boxed by xscroll.js's sweep
      ht.append(colgroup(), thead);
      head.appendChild(ht);
      t.appendChild(colgroup());
    } else t.appendChild(thead);

    const tb = el('tbody');
    t.appendChild(tb); wrap.appendChild(t);
    last = { all, cols, ranks, tb };
    appendRows(0, v.length);
    paintMore(all);
    /* a filter or a preset on a phone keeps the reader where they were sideways */
    if (phone) { wrap.scrollLeft = keepX; head.scrollLeft = wrap.scrollLeft; }
  }

  /* CROSSING THE BREAKPOINT REDRAWS (followWidth, above render): one listener for every table */
  host.__ftWrap = wrap;
  followWidth(host, wrap, () => { draw(); revealPill(); });

  function exportCsv() {
    const cols = visible(), v = view();
    const esc = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const body = [cols.map(c => esc(c.l)).join(',')]
      .concat(v.map((r, i) => cols.map(c => esc(c.k === 'name' ? r.name : c.fmt(r, i))).join(',')))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = (opts.filename || 'epinoia') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  draw();

  /* THE ACCESS STATE CAN CHANGE UNDER A DRAWN TABLE (followAccess, above render). Only a real
     change redraws: an open league's table never notices an answer arriving. */
  /* A PAGE'S OWN LOCK (opts.locked) is compared column by column, so a league arriving that
     locks one more column redraws as surely as a sign-out does. A stat filter on a column that
     has become locked goes with it: filtering by it would print its ranking. */
  function relock() {
    const now = isLocked(), sig = lockSig();
    if (now === locked && sig === lockKey) return false;
    locked = now; lockKey = sig;
    const was = preset, nf = filters.length;
    if (presetLocked(preset)) { preset = presets[0][0]; extra.clear(); removed.clear(); }
    filters = filters.filter(f => !absent(f.k));
    hideTeaser(); drawPills(); drawDrawer();
    if (filt && !filt.hidden) drawFilters();
    /* the lock took the preset or a filter away: a page keeping the state in its URL must hear
       it, or a reload restores the view the table no longer shows */
    if (preset !== was || filters.length !== nf) emit();
    return true;
  }
  followAccess(host, () => { if (relock()) draw(); });

  function getState() {
    return {
      sort: sortKey, dir: sortDir, preset,
      search: String(q.value || '').trim(),
      filters: filters.filter(f => f.x != null).map(f => ({ k: f.k, op: f.op, mode: f.mode, x: f.x })),
      league: leaguePick, team: teamPick, withinLeague,
      page: PAGE === Infinity ? 1 : Math.max(1, Math.ceil(shown / PAGE)),
      qualified: qualOn
    };
  }

  return {
    redraw: draw,
    /* ROWS THAT ARRIVE IN PARTS (global scouting draws each league as it lands). Everything
       derived from the rows is derived again -- per-game forms, position groups, the league and
       club lists, the lock -- while the sort, the filters, the picks and the rows shown stay. */
    setRows(next) {
      rows = prep(next);
      posMap = null;
      qualRows = hasQualified(rows);
      if (qualBtn) qualBtn.hidden = !qualRows;
      const byId = new Map(rows.map(r => [String(r.id), r]));
      [...picked.keys()].forEach(id => { if (byId.has(id)) picked.set(id, byId.get(id)); else picked.delete(id); });
      fillLeagues(); fillTeams();
      relock();
      draw();
      if (SELECT) paintTray();
    },
    getView: () => view(),
    getPool: () => population(),
    /* percentiles for the given stats, over the table's own population (see getRanksFor) */
    getRanks: getRanksFor,
    getSelected,
    getState
  };
}

return { render, PLAYER_COLS: P, TEAM_COLS: T, PRESETS, heatStyle, PHONE_MQ };
}));
