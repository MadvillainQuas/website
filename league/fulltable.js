'use strict';
/* ============================================================================
   COURTSIDE FULL TABLE

   A port of index_9's full table onto Courtside's own data: preset column sets,
   per-column toggles, sortable sticky header, search, minimum games, CSV, and
   the percentile heat map that makes a wide table readable at a glance.

   PROGRESSIVE DISCLOSURE IS THE POINT. The table opens on per-game counting
   stats — the columns someone who has never read an advanced box score already
   understands — and on the team side adds the four factors, because those four
   numbers decide basketball games and need no grounding to read. Everything
   else is one press away and nothing is hidden, but nobody is met with forty
   columns of rate statistics on arrival.

   Fed by league/season.js, which does all the arithmetic. Nothing here computes
   a statistic; this decides what to show and how to rank it.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideTable = api;
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

/* ------------------------------------------------------------- catalogue ---
   g      the groups this column belongs to (a preset is a set of groups)
   low    lower is better — the heat map must rank it in reverse
   heat   include in the percentile heat map (identity columns must not be)   */
const P = [
  { k:'jersey', l:'#',      g:['id'], fmt:r=>r.jersey||'', sort:r=>+r.jersey||999 },
  { k:'name',   l:'PLAYER', g:['id'], fmt:r=>r.name, text:true },
  { k:'teamName', l:'TEAM', g:['id'], fmt:r=>r.teamName||'', text:true },
  { k:'gp',  l:'GP',  g:['basic','totals','shooting','playmaking','defense','rebounding','onoff','vs','advanced'], fmt:r=>f0(r.gp) },

  /* per game — the default view */
  { k:'mpg',  l:'MPG',  g:['basic'], fmt:r=>f1(r.mpg),  heat:1 },
  { k:'ppg',  l:'PPG',  g:['basic'], fmt:r=>f1(r.ppg),  heat:1, lead:1 },
  { k:'rpg',  l:'RPG',  g:['basic'], fmt:r=>f1(r.rpg),  heat:1 },
  { k:'apg',  l:'APG',  g:['basic'], fmt:r=>f1(r.apg),  heat:1 },
  { k:'spg',  l:'SPG',  g:['basic'], fmt:r=>f1(r.spg),  heat:1 },
  { k:'bpg',  l:'BPG',  g:['basic'], fmt:r=>f1(r.bpg),  heat:1 },
  { k:'topg', l:'TOPG', g:['basic'], fmt:r=>f1(r.topg), heat:1, low:1 },
  { k:'pfpg', l:'PFPG', g:['basic'], fmt:r=>f1(r.pfpg), heat:1, low:1 },

  /* totals */
  { k:'min',  l:'MIN',  g:['totals'], fmt:r=>f1(r.min),  heat:1 },
  { k:'pts',  l:'PTS',  g:['totals'], fmt:r=>f0(r.pts),  heat:1, lead:1 },
  { k:'reb',  l:'REB',  g:['totals','rebounding'], fmt:r=>f0(r.reb), heat:1 },
  { k:'oreb', l:'OREB', g:['totals','rebounding'], fmt:r=>f0(r.oreb), heat:1 },
  { k:'dreb', l:'DREB', g:['totals','rebounding','defense'], fmt:r=>f0(r.dreb), heat:1 },
  { k:'ast',  l:'AST',  g:['totals','playmaking'], fmt:r=>f0(r.ast), heat:1 },
  { k:'stl',  l:'STL',  g:['totals','defense'], fmt:r=>f0(r.stl), heat:1 },
  { k:'blk',  l:'BLK',  g:['totals','defense'], fmt:r=>f0(r.blk), heat:1 },
  { k:'tov',  l:'TO',   g:['totals','playmaking'], fmt:r=>f0(r.tov), heat:1, low:1 },
  { k:'pf',   l:'PF',   g:['totals','defense'], fmt:r=>f0(r.pf), heat:1, low:1 },
  { k:'fd',   l:'FD',   g:['totals'], fmt:r=>f0(r.fd), heat:1 },

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
  { k:'bpm',  l:'BPM',  g:['advanced'], fmt:r=>sgn1(r.bpm),  heat:1, w:58 },
  { k:'obpm', l:'OBPM', g:['advanced'], fmt:r=>sgn1(r.obpm), heat:1, w:60 },
  { k:'dbpm', l:'DBPM', g:['advanced'], fmt:r=>sgn1(r.dbpm), heat:1, w:60 },
  { k:'vorp', l:'VORP', g:['advanced'], fmt:r=>f1(r.vorp),   heat:1, w:58 },
  { k:'efg',    l:'eFG%', g:['shooting','advanced'], fmt:r=>f1(r.efg), heat:1 },
  { k:'ts',     l:'TS%',  g:['shooting','advanced'], fmt:r=>f1(r.ts),  heat:1 },
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
  { k:'ftr',      l:'FTr',   g:['shooting','advanced'], fmt:r=>f1(r.ftr), heat:1 },

  /* playmaking */
  { k:'ast_pct', l:'AST%',    g:['playmaking','advanced'], fmt:r=>f1(r.ast_pct), heat:1 },
  { k:'tov_pct', l:'TOV%',    g:['playmaking','advanced'], fmt:r=>f1(r.tov_pct), heat:1, low:1 },
  { k:'ast_to',  l:'A/TO',    g:['playmaking'], fmt:r=>f2(r.ast_to), heat:1 },
  { k:'au',      l:'AST/USG', g:['playmaking'], fmt:r=>f2(r.au), heat:1 },
  { k:'ptsAst',  l:'PTS AST', g:['playmaking'], fmt:r=>f0(r.ptsAst), heat:1 },

  /* defence + rebounding rates */
  { k:'stl_pct',  l:'STL%',  g:['defense','advanced'], fmt:r=>f1(r.stl_pct), heat:1 },
  { k:'blk_pct',  l:'BLK%',  g:['defense','advanced'], fmt:r=>f1(r.blk_pct), heat:1 },
  { k:'oreb_pct', l:'OREB%', g:['rebounding','advanced'], fmt:r=>f1(r.oreb_pct), heat:1 },
  { k:'dreb_pct', l:'DREB%', g:['rebounding','defense','advanced'], fmt:r=>f1(r.dreb_pct), heat:1 },
  { k:'trb_pct',  l:'TRB%',  g:['rebounding'], fmt:r=>f1(r.trb_pct), heat:1 },

  /* usage and efficiency */
  { k:'usg',   l:'USG%', g:['advanced'], fmt:r=>f1(r.usg), heat:1 },
  { k:'ppp',   l:'PPP',  g:['advanced'], fmt:r=>f2(r.ppp), heat:1 },
  { k:'pts75', l:'PTS/75', g:['advanced'], fmt:r=>f1(r.pts75), heat:1 },
  { k:'poss',  l:'POSS', g:['advanced'], fmt:r=>f1(r.poss) },

  /* on / off — the differential is the headline, so it leads the group */
  { k:'diff_net', l:'ON-OFF', g:['onoff'], fmt:r=>sgn(r.diff_net), heat:1, lead:1, signed:1 },
  { k:'on_net',   l:'ON NET', g:['onoff'], fmt:r=>sgn(r.on_net),   heat:1, signed:1 },
  { k:'on_ortg',  l:'ON ORTG', g:['onoff'], fmt:r=>f1(r.on_ortg), heat:1 },
  { k:'on_drtg',  l:'ON DRTG', g:['onoff'], fmt:r=>f1(r.on_drtg), heat:1, low:1 },
  { k:'off_net',  l:'OFF NET', g:['onoff'], fmt:r=>sgn(r.off_net), heat:1, signed:1 },
  { k:'off_ortg', l:'OFF ORTG', g:['onoff'], fmt:r=>f1(r.off_ortg), heat:1 },
  { k:'off_drtg', l:'OFF DRTG', g:['onoff'], fmt:r=>f1(r.off_drtg), heat:1, low:1 },
  { k:'pm',       l:'+/-',   g:['basic','onoff'], fmt:r=>sgn0(r.pm), heat:1, signed:1 },
  { k:'on_efg',   l:'ON eFG%',  g:['onoff'], fmt:r=>f1(r.on_efg), heat:1 },
  { k:'on_oreb',  l:'ON OREB%', g:['onoff'], fmt:r=>f1(r.on_oreb), heat:1 },
  { k:'on_tov',   l:'ON TOV%',  g:['onoff'], fmt:r=>f1(r.on_tov), heat:1, low:1 },

  /* what the opponent managed while he was on the floor */
  /* The defensive side is in the on/off group too, not only in "opponent".
     An on/off that shows what a team scores with a player and not what it
     concedes tells half the story, and the missing half is usually the reason
     the number looks the way it does. */
  { k:'vs_efg',  l:'OPP eFG%',  g:['onoff','vs','defense'], fmt:r=>f1(r.vs_efg),  heat:1, low:1 },
  { k:'vs_tov',  l:'OPP TOV%',  g:['onoff','vs','defense'], fmt:r=>f1(r.vs_tov),  heat:1 },
  { k:'vs_oreb', l:'OPP OREB%', g:['onoff','vs','defense'], fmt:r=>f1(r.vs_oreb), heat:1, low:1 },
  { k:'vs_ftr',  l:'OPP FTr',   g:['onoff','vs'], fmt:r=>f1(r.vs_ftr), heat:1, low:1 }
];

const T = [
  { k:'rank', l:'#',    g:['id'], fmt:(r,i)=>String(i+1), sort:r=>r.__i },
  { k:'name', l:'TEAM', g:['id'], fmt:r=>r.name, text:true },
  { k:'gp',   l:'GP',   g:['basic','four','shooting','scoring','ratings','totals','defense'], fmt:r=>f0(r.gp) },

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
  { k:'poss', l:'POSS', g:['ratings'], fmt:r=>f1(r.poss) },

  { k:'fgm',    l:'FG',   g:['shooting','totals'], fmt:r=>pair(r.fgm,r.fga), sort:r=>r.fgm },
  { k:'fg_pct', l:'FG%',  g:['shooting'], fmt:r=>f1(r.fg_pct), heat:1 },
  { k:'p3m',    l:'3PT',  g:['shooting','totals'], fmt:r=>pair(r.p3m,r.p3a), sort:r=>r.p3m },
  { k:'p3_pct', l:'3P%',  g:['shooting'], fmt:r=>f1(r.p3_pct), heat:1 },
  { k:'ft_pct', l:'FT%',  g:['shooting'], fmt:r=>f1(r.ft_pct), heat:1 },
  { k:'ts',     l:'TS%',  g:['shooting'], fmt:r=>f1(r.ts), heat:1 },

  /* shot diet by zone: attempts per game beside the accuracy from there.
     Either number alone misleads — 60% at the rim on three attempts a night
     is not a rim team, and 30 attempts at 38% is not a bad shooting night. */
  { k:'rim_apg', l:'RIM/G',  g:['scoring','shooting'], fmt:r=>f1(r.rim_apg), heat:1 },
  { k:'rim_pct', l:'RIM%',   g:['scoring','shooting'], fmt:r=>f1(r.rim_pct), heat:1 },
  { k:'mid_apg', l:'MID/G',  g:['scoring','shooting'], fmt:r=>f1(r.mid_apg), heat:1 },
  { k:'mid_pct', l:'MID%',   g:['scoring','shooting'], fmt:r=>f1(r.mid_pct), heat:1 },
  { k:'p3_apg',  l:'3PA/G',  g:['scoring','shooting'], fmt:r=>f1(r.p3_apg),  heat:1 },
  { k:'p3_acc',  l:'3P%',    g:['scoring'], fmt:r=>f1(r.p3_acc), heat:1 },
  { k:'rim_share', l:'RIM SHARE', g:['scoring'], fmt:r=>f1(r.rim_share), heat:1 },
  { k:'mid_share', l:'MID SHARE', g:['scoring'], fmt:r=>f1(r.mid_share), heat:1 },
  { k:'p3_share',  l:'3P SHARE',  g:['scoring'], fmt:r=>f1(r.p3_share),  heat:1 },

  { k:'paint',         l:'PAINT', g:['scoring'], fmt:r=>f0(r.paint), heat:1 },
  { k:'fast',          l:'FAST',  g:['scoring'], fmt:r=>f0(r.fast),  heat:1 },
  { k:'second_chance', l:'2ND',   g:['scoring'], fmt:r=>f0(r.second_chance), heat:1 },
  { k:'pts_off_to',    l:'PoT',   g:['scoring'], fmt:r=>f0(r.pts_off_to), heat:1 },
  { k:'bench',         l:'BENCH', g:['scoring'], fmt:r=>f0(r.bench), heat:1 },

  { k:'reb',  l:'REB',  g:['totals'], fmt:r=>f0(r.reb), heat:1 },
  { k:'oreb', l:'OREB', g:['totals'], fmt:r=>f0(r.oreb), heat:1 },
  { k:'dreb', l:'DREB', g:['totals'], fmt:r=>f0(r.dreb), heat:1 },
  { k:'ast',  l:'AST',  g:['totals'], fmt:r=>f0(r.ast), heat:1 },
  { k:'stl',  l:'STL',  g:['totals'], fmt:r=>f0(r.stl), heat:1 },
  { k:'blk',  l:'BLK',  g:['totals'], fmt:r=>f0(r.blk), heat:1 },
  { k:'tov',  l:'TO',   g:['totals'], fmt:r=>f0(r.tov), heat:1, low:1 },
  { k:'fouls',l:'PF',   g:['totals','defense'], fmt:r=>f0(r.fouls), heat:1, low:1 },
  { k:'ast_to',  l:'A/TO', g:['basic','totals'], fmt:r=>f2(r.ast_to), heat:1 },
  { k:'ast_pct', l:'AST%', g:['totals'], fmt:r=>f1(r.ast_pct), heat:1 }
];

/* presets: the first is the default, and is deliberately the beginner's view */
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

  let preset = opts.preset || presets[0][0];
  let sortKey = opts.sortKey || (isTeam ? 'ppg' : 'ppg');
  let sortDir = -1;
  let search = '';
  let minGames = opts.minGames != null ? opts.minGames : 0;
  let heat = opts.heat !== false;
  let extra = new Set();          // columns added by hand on top of the preset
  let removed = new Set();        // and ones taken away

  const idCols = CAT.filter(c => c.g.includes('id'));
  const inPreset = c => preset === '*' ? !c.g.includes('id') : c.g.includes(preset);
  const visible = () => idCols.concat(
    CAT.filter(c => !c.g.includes('id') &&
                    ((inPreset(c) && !removed.has(c.k)) || extra.has(c.k))));

  host.textContent = '';

  /* ---- row 1: search, filters, switches ---- */
  const bar = el('div', 'ft-bar');
  const q = el('input', 'cs-input grow');
  q.type = 'search';
  q.placeholder = isTeam ? 'find a team…' : 'find a player or team…';
  q.addEventListener('input', () => { search = q.value.trim().toLowerCase(); draw(); });
  bar.appendChild(q);

  if (!isTeam && opts.showMinGames !== false) {
    const mg = el('input', 'cs-input');
    mg.type = 'number'; mg.min = '0'; mg.value = String(minGames);
    mg.style.width = '78px'; mg.title = 'minimum games played';
    mg.addEventListener('input', () => { minGames = parseInt(mg.value, 10) || 0; draw(); });
    bar.append(el('span', 'ft-count', 'min gp'), mg);
  }

  const heatBtn = el('button', 'cs-btn' + (heat ? ' pri' : ''), 'heat map');
  heatBtn.type = 'button'; heatBtn.style.cssText = 'font-size:9px;padding:8px 12px';
  heatBtn.title = 'shade each column by percentile within the table';
  heatBtn.addEventListener('click', () => {
    heat = !heat; heatBtn.classList.toggle('pri', heat); draw();
  });
  bar.appendChild(heatBtn);

  const colsBtn = el('button', 'cs-btn', 'columns');
  colsBtn.type = 'button'; colsBtn.style.cssText = 'font-size:9px;padding:8px 12px';
  colsBtn.addEventListener('click', () => { drawer.hidden = !drawer.hidden; });
  bar.appendChild(colsBtn);

  const csv = el('button', 'cs-btn', 'csv');
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

  const sortVal = (c, r) => (c.sort ? c.sort(r) : r[c.k]);

  function view() {
    let v = rows.filter(r => (r.gp || 0) >= minGames);
    if (search) v = v.filter(r =>
      ((r.name || '') + ' ' + (r.teamName || '')).toLowerCase().includes(search));
    const c = CAT.find(x => x.k === sortKey) || CAT[3];
    v.sort((a, b) => {
      const x = sortVal(c, a), y = sortVal(c, b);
      if (c.text) return String(x || '').localeCompare(String(y || '')) * (sortDir === -1 ? 1 : -1);
      const xa = x == null ? -Infinity : x, ya = y == null ? -Infinity : y;
      return (ya - xa) * (sortDir === -1 ? 1 : -1);
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

  function addGrip(th, col, table) {
    const grip = document.createElement('span');
    grip.className = 'ft-grip';
    grip.setAttribute('aria-hidden', 'true');
    let startX = 0, startW = 0, active = false;

    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      active = true;
      startX = e.clientX;
      startW = th.getBoundingClientRect().width;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('on');
    });
    grip.addEventListener('pointermove', e => {
      if (!active) return;
      const w = Math.max(34, Math.round(startW + (e.clientX - startX)));
      th.style.width = w + 'px';
      held[col.k] = w;
      /* the table's own width must follow, or the last column absorbs the
         change and every other column shifts under the cursor */
      const total = [...table.tHead.rows[0].cells]
        .reduce((n, c2) => n + c2.getBoundingClientRect().width, 0);
      table.style.width = Math.round(total) + 'px';
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
    if (heat && window.CourtsideSeason) {
      const keys = cols.filter(c => c.heat).map(c => c.k);
      const low  = cols.filter(c => c.heat && c.low).map(c => c.k);
      ranks = window.CourtsideSeason.percentiles(v, keys, low);
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
      th.title = c.l + (c.low ? ' — lower is better' : '');
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
          if (r.colour || r.teamColour) {
            const crest = el('span', 'ft-crest', (r.teamShort || '').slice(0, 3));
            crest.style.background = r.colour || r.teamColour;
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
    a.href = url; a.download = (opts.filename || 'courtside') + '.csv';
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
