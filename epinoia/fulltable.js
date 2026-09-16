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
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTable = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

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
     with no way of telling twelfth from thirtieth; the jersey now rides beside the
     name, where a squad number belongs. Clicking this column puts the table back in
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
   because the ranking is already reversed for lower-is-better columns. */
function heatStyle(p) {
  if (p == null) return '';
  if (p >= 90) return 'background:color-mix(in oklch,var(--lume) 34%,transparent);color:var(--ink)';
  if (p >= 75) return 'background:color-mix(in oklch,var(--lume) 20%,transparent)';
  if (p >= 60) return 'background:color-mix(in oklch,var(--lume) 10%,transparent)';
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
  let rows = (opts.rows || []).map((r, i) => Object.assign({ __i: i }, r));
  /* PER GAME OUTSIDE THE TOTALS VIEW. A season row carries totals; every column except the
     totals preset reads a per-game form of them, derived here so the heat map and the sort
     rank the per-game numbers rather than the totals behind them. */
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

  let preset = opts.preset || presets[0][0];
  let sortKey = opts.sortKey || (isTeam ? 'ppg' : 'ppg');
  let sortDir = -1;
  let search = '';
  let minGames = opts.minGames != null ? opts.minGames : 0;
  let minMinutes = 0;                     // the low-minutes cut, off until asked for
  let teamPick = '';                      // one club, or every club
  let posPick = '';                       // guards / wings / bigs, or every position
  let byPos = false;                      // rank each column within the player's position
  let heat = opts.heat !== false;
  let extra = new Set();          // columns added by hand on top of the preset
  let removed = new Set();        // and ones taken away

  const SE = () => (typeof window !== 'undefined' ? window.EpinoiaSeason : null);
  /* the groups are cut over the whole table once, not per row (season.js positionGroups) */
  let posMap = null;
  const posGroups = () => {
    const S = SE();
    if (!posMap && S && S.positionGroups) posMap = S.positionGroups(rows);
    return posMap;
  };
  const groupOf = r => { const m = posGroups(); return m ? (m.get(r.id) || null) : null; };

  const idCols = CAT.filter(c => c.g.includes('id'));
  const inPreset = c => preset === '*' ? !c.g.includes('id') : c.g.includes(preset);
  const visible = () => idCols.concat(
    CAT.filter(c => !c.g.includes('id') &&
                    ((inPreset(c) && !removed.has(c.k)) || extra.has(c.k)))
       .map((c, i) => [c, i])
       .sort((a, b) => ((a[0].ord && a[0].ord[preset] != null ? a[0].ord[preset] : 1000 + a[1]) -
                        (b[0].ord && b[0].ord[preset] != null ? b[0].ord[preset] : 1000 + b[1])))
       .map(x => x[0]));

  host.textContent = '';

  /* ---- row 1: search, filters, switches ---- */
  const bar = el('div', 'ft-bar');
  const q = el('input', 'ep-input grow');
  q.type = 'search';
  q.placeholder = isTeam ? 'find a team…' : 'find a player or team…';
  q.addEventListener('input', () => { search = q.value.trim().toLowerCase(); draw(); });
  bar.appendChild(q);

  if (!isTeam && opts.showMinGames !== false) {
    const mg = el('input', 'ep-input');
    mg.type = 'number'; mg.min = '0'; mg.value = String(minGames);
    mg.style.width = '78px'; mg.title = 'minimum games played';
    mg.addEventListener('input', () => { minGames = parseInt(mg.value, 10) || 0; draw(); });
    bar.append(el('span', 'ft-count', 'min gp'), mg);

    /* THE LOW-MINUTES CUT. A season table's noise is almost all in the players who
       barely played: a 2-for-2 night is a 100% shooter until somebody is asked to
       have played. Thirty minutes is the usual first cut, and it is a switch rather
       than a box to type in because that is the question people actually ask. */
    const MIN_CUT = 30;
    const cut = el('button', 'ep-btn', MIN_CUT + '+ min');
    cut.type = 'button'; cut.style.cssText = 'font-size:9px;padding:8px 12px';
    cut.title = 'hide players with fewer than ' + MIN_CUT + ' minutes on the season';
    cut.addEventListener('click', () => {
      minMinutes = minMinutes ? 0 : MIN_CUT;
      cut.classList.toggle('pri', !!minMinutes); draw();
    });
    bar.appendChild(cut);

    /* one club, or one position group, out of whoever is in the table */
    const teamSel = el('select', 'ep-input');
    teamSel.style.cssText = 'font-size:10px;max-width:160px';
    teamSel.title = 'show one club';
    const teamNames = [...new Set(rows.map(r => r.teamName).filter(Boolean))].sort();
    [['', 'every club']].concat(teamNames.map(t => [t, t])).forEach(([v, l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; teamSel.appendChild(o);
    });
    teamSel.addEventListener('change', () => { teamPick = teamSel.value; draw(); });
    if (teamNames.length > 1) bar.appendChild(teamSel);

    const posSel = el('select', 'ep-input');
    posSel.style.cssText = 'font-size:10px;max-width:140px';
    posSel.title = 'show one position group, by the calculated position corrected with the listed one';
    const posOpts = [['', 'every position']].concat((SE() && SE().POS_GROUPS ? SE().POS_GROUPS : []).map(g => [g[0], g[1]]));
    posOpts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; posSel.appendChild(o); });
    posSel.addEventListener('change', () => { posPick = posSel.value; draw(); });
    if (posOpts.length > 1) bar.appendChild(posSel);
  }

  const heatBtn = el('button', 'ep-btn' + (heat ? ' pri' : ''), 'heat map');
  heatBtn.type = 'button'; heatBtn.style.cssText = 'font-size:9px;padding:8px 12px';
  heatBtn.title = 'shade each column by percentile within the table';
  heatBtn.addEventListener('click', () => {
    heat = !heat; heatBtn.classList.toggle('pri', heat); draw();
  });
  bar.appendChild(heatBtn);

  /* ADJUSTED FOR POSITION: the same percentiles, taken within the player's own
     position group rather than the whole competition, so a centre's assist rate is
     read against centres. The colouring is the only thing that changes -- every
     number in the table is what it was. */
  if (!isTeam) {
    const posBtn = el('button', 'ep-btn' + (byPos ? ' pri' : ''), 'adjust for position');
    posBtn.type = 'button'; posBtn.style.cssText = 'font-size:9px;padding:8px 12px';
    posBtn.title = 'shade each column against the player’s own position group';
    posBtn.addEventListener('click', () => {
      byPos = !byPos; posBtn.classList.toggle('pri', byPos); draw();
    });
    bar.appendChild(posBtn);
  }

  /* CALC RAPM. The page hands over a function that reads the season's logs and comes
     back with a coefficient per player; this only asks for it, says how far along it is,
     and puts the numbers on the rows. Pressed twice, it recomputes rather than refusing:
     a scope may have changed under it. */
  if (!isTeam && typeof opts.rapm === 'function') {
    const rb = el('button', 'ep-btn', 'calc RAPM');
    rb.type = 'button'; rb.style.cssText = 'font-size:9px;padding:8px 12px';
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
    bar.appendChild(rb);
  }

  const colsBtn = el('button', 'ep-btn', 'columns');
  colsBtn.type = 'button'; colsBtn.style.cssText = 'font-size:9px;padding:8px 12px';
  colsBtn.addEventListener('click', () => { drawer.hidden = !drawer.hidden; });
  bar.appendChild(colsBtn);

  const csv = el('button', 'ep-btn', 'csv');
  csv.type = 'button'; csv.style.cssText = 'font-size:9px;padding:8px 12px';
  csv.addEventListener('click', exportCsv);
  bar.appendChild(csv);

  const count = el('span', 'ft-count'); count.style.marginLeft = 'auto';
  bar.appendChild(count);
  host.appendChild(bar);

  /* ---- row 2: presets ---- */
  const pills = el('div', 'ft-pills');
  presets.forEach(([key, label]) => {
    const b = el('button', 'ft-pill' + (key === preset ? ' on' : ''), label);
    b.type = 'button'; b.dataset.g = key;
    b.addEventListener('click', () => {
      preset = key; extra.clear(); removed.clear();
      pills.querySelectorAll('.ft-pill').forEach(p => p.classList.toggle('on', p.dataset.g === key));
      drawDrawer(); draw();
    });
    pills.appendChild(b);
  });
  host.appendChild(pills);

  /* ---- row 3: every column, toggleable ---- */
  const drawer = el('div', 'ft-cols'); drawer.hidden = true;
  const grid = el('div', 'ft-colgrid'); drawer.appendChild(grid);
  host.appendChild(drawer);

  function drawDrawer() {
    grid.textContent = '';
    const shown = new Set(visible().map(c => c.k));
    CAT.filter(c => !c.g.includes('id')).forEach(c => {
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

  const wrap = el('div', 'ft-wrap');
  host.appendChild(wrap);
  /* the sweep catches this too, on its next pass; wiring it here as well means
     the first touch after a render does not depend on that pass having run */
  if (window.epinoiaDragScroll) window.epinoiaDragScroll(wrap);

  const sortVal = (c, r) => (c.sort ? c.sort(r) : r[c.k]);

  function view() {
    let v = rows.filter(r => (r.gp || 0) >= minGames);
    if (minMinutes) v = v.filter(r => (r.min || 0) >= minMinutes);
    if (teamPick) v = v.filter(r => r.teamName === teamPick);
    if (posPick) v = v.filter(r => groupOf(r) === posPick);
    if (search) v = v.filter(r =>
      ((r.name || '') + ' ' + (r.teamName || '')).toLowerCase().includes(search));
    const c = CAT.find(x => x.k === sortKey) || CAT[3];
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
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d');
  function measure(cols, rows) {
    const cs = getComputedStyle(document.body);
    const dataFont = '11.5px ' + (cs.getPropertyValue('--f-data') || 'monospace');
    const headFont = '8px ' + (cs.getPropertyValue('--f-micro') || 'monospace');
    const PAD = 18;                 // 8px each side plus a hair of breathing room
    const MIN = 44, MAX = 96;
    const out = {};
    /* a sample is enough — measuring 400 rows to find the widest costs more
       than the pixel or two of accuracy it buys */
    const sample = rows.length > 60 ? rows.slice(0, 60) : rows;
    cols.forEach((c, i) => {
      if (i < 2) { out[c.k] = i === 0 ? 36 : 170; return; }
      ctx2d.font = headFont;
      let w = ctx2d.measureText(c.l).width;
      ctx2d.font = dataFont;
      sample.forEach((r, idx) => {
        const txt = String(c.fmt(r, idx));
        const m = ctx2d.measureText(txt).width;
        if (m > w) w = m;
      });
      out[c.k] = Math.max(MIN, Math.min(MAX, Math.ceil(w) + PAD));
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

  function draw() {
    const cols = visible();
    const v = view();
    count.textContent = v.length + (isTeam ? (v.length === 1 ? ' team' : ' teams')
                                           : (v.length === 1 ? ' player' : ' players'));
    wrap.textContent = '';
    if (!v.length) {
      wrap.appendChild(el('div', 'ft-empty', rows.length
        ? 'Nothing matches that filter.'
        : 'No statistics yet — these fill in as games are finalised.'));
      return;
    }

    /* percentiles are computed over the rows on screen, so a filtered table
       ranks within what you are actually looking at — same as index_9 */
    let ranks = new Map();
    if (heat && window.EpinoiaSeason) {
      const keys = cols.filter(c => c.heat).map(c => c.k);
      const low  = cols.filter(c => c.heat && c.low).map(c => c.k);
      ranks = window.EpinoiaSeason.percentiles(v, keys, low, byPos ? groupOf : null);
    }

    const t = el('table', 'ft');
    /* Declare the table's own width as the sum of its columns.

       With table-layout:fixed and width:max-content the browser still has to
       reconcile a computed table width against the declared column widths, and
       it hands the surplus to a single column — which is exactly how PPG ended
       up 124px wide against 52px everywhere else. Summing the columns and
       stating the total leaves nothing to reconcile. */
    const W0 = 36, W1 = 170;
    const widths = measure(cols, v);
    /* a width the reader set by hand wins over the measured one */
    Object.keys(held).forEach(k => { if (widths[k] != null) widths[k] = held[k]; });
    const totalW = W0 + W1 + cols.slice(2).reduce((n, c) => n + widths[c.k], 0);
    t.style.width = totalW + 'px';

    const thead = el('thead'), hr = el('tr');
    cols.forEach((c, i) => {
      const th = el('th', (c.k === sortKey ? 'sorted ' : '') + (i < 2 ? 'stick c' + i : ''), c.l);
      /* Width is set on the header only; the table is fixed-layout, so the
         column follows. Without this a long header like "OPP OREB%" or a wide
         cell like "192-440" stretched its column and squeezed every other one,
         which is what threw PPG and DIFF out of proportion. */
      if (i >= 2) th.style.width = widths[c.k] + 'px';
      th.title = (c.t ? c.l + ' — ' + c.t : c.l) + (c.low ? ' — lower is better' : '');
      /* a grip on the trailing edge, so a column can be widened by hand when
         the measured width is not what this particular reader wants */
      if (i >= 1) addGrip(th, c, t);
      th.addEventListener('click', () => {
        if (sortKey === c.k) sortDir = -sortDir;
        else { sortKey = c.k; sortDir = c.text ? 1 : -1; }
        draw();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr); t.appendChild(thead);

    const tb = el('tbody');
    v.forEach((r, idx) => {
      const tr = el('tr');
      cols.forEach((c, i) => {
        const td = el('td', i < 2 ? 'stick c' + i : '');
        if (c.k === 'name') {
          const cell = el('div', 'ft-name');
          if (!isTeam && r.jersey) cell.appendChild(el('span', 'ft-jersey', r.jersey));
          if (r.colour || r.teamColour || r.logo || r.teamLogo) {
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
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t);
  }

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
  return {
    redraw: draw,
    setRows(next) { rows = (next || []).map((r, i) => Object.assign({ __i: i }, r)); draw(); }
  };
}

return { render, PLAYER_COLS: P, TEAM_COLS: T, PRESETS, heatStyle };
}));
