'use strict';
/* ============================================================================
   THE CLUB'S REPORT (report.js on the club page, t/team.js reportTab): its modules.

     cover            the club's name and crest, the title and subtitle, its most-used five on a half court (one player a
                      spot: a player who leads two positions keeps the one he plays most, teamviz.js fiveOf)
     MAIN STATS       the four factors in a row (each end's rank among the clubs); the ratings; the season line
                      (efficiency at both ends, half court and transition at both ends, against the other side's
                      starters and bench, the club's own starters and bench - those last drawn against the club's own
                      ratings, as no other club has them); the SHOT DISTRIBUTION at both ends (rim, paint, mid-range,
                      three, corner three: volume, accuracy, assisted), each ranked among the clubs; REBOUNDS ANALYSIS;
                      TRUE SHOTS GAP (true shooting attempts, TSA, a game for the club and against it, the gap, where it comes from)
     SHOT CHART       offence and defence on the zones court, side by side, then one table of both ends zone by zone
                      in the court's colours, the half-court and transition cards at both ends, then the EVENTS as
                      cards (teamviz.js): points a chance at both ends, each with its word among the league's clubs
     PLAYERS          a card row a player: photo, name, his minutes at each position, and the stats of his position's
                      template (guard, wing, big), each tinted by his percentile in the competition. RAPM on request
                      (a flag says when it has not been calculated for the league and season)
     DEPTH CHART      each position's minutes as one bar split between its players, the rotations with the average
                      margin at each minute, and the most-used fives as cards two rows deep (teamviz.js lineupCards)
     COMBINATIONS     the five best and five worst trios, and the shot clock: early, middle and late at both ends, then
                      the same three windows for the defence alone, with how each chance ended
     LEGEND           every statistic printed, defined
   A module starts in the space the one before left, when its first block fits there (report.js layout, packed).

   ctx (from t/team.js): season() -> {S, mine, scopeComps, kind}, logs() -> {gs, byG, sideOf}, clubLogs(scopedSet),
   starters(compIds), depth(all) -> {c}, zones(S) (every club's shot zones at both ends), rebounds(S, mine) -> html,
   meta(ids), stints(gs) -> full stints, rapm(ids, fn).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReportTeam = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* the club's season line, as report.js's catalogue reads it (added once). ref: a figure no other club has, drawn against
   the club's own (vs_* and own_* against its ratings over every minute; the half court's assisted share against all its
   baskets'); sc: the step, in the stat's units, from better to much better */
const SPLIT = (l, ref, low) => ({ l, dp: 1, signed: ref === 'net', low: !!low, rank: false, ref, refL: 'club', sc: 4 });
const TEAM_STATS = {
  ff_efg: { l: 'eFG%', dp: 1 }, ff_tov: { l: 'TOV%', dp: 1, low: true }, ff_oreb: { l: 'OREB%', dp: 1 }, ff_ftr: { l: 'FTr', dp: 1 },
  dff_efg: { l: 'OPP eFG%', dp: 1, low: true }, dff_tov: { l: 'OPP TOV%', dp: 1 }, dff_oreb: { l: 'OPP OREB%', dp: 1, low: true }, dff_ftr: { l: 'OPP FTr', dp: 1, low: true },
  ortg: { l: 'ORTG', dp: 1 }, drtg: { l: 'DRTG', dp: 1, low: true }, net: { l: 'NET', dp: 1, signed: true }, pace: { l: 'PACE', dp: 1, style: true },
  ft_pct: { l: 'FT%', dp: 1 }, ts: { l: 'TS%', dp: 1 }, opp_ts: { l: 'OPP TS%', dp: 1, low: true },
  tm_ppp: { l: 'PTS / POSSESSION', dp: 2 }, tm_oppp: { l: 'OPP PTS / POSSESSION', dp: 2, low: true }, ast_sh_all: { l: 'AST% (ALL BASKETS)', dp: 1, style: true },
  tsa_for: { l: 'TSA A GAME', dp: 1 }, tsa_vs: { l: 'TSA ALLOWED A GAME', dp: 1, low: true }, tsa_gap: { l: 'TRUE SHOTS GAP', dp: 1, signed: true },
  ev_half_pts_sh: { l: 'HALF-COURT %PTS', dp: 1, style: true }, evd_half_pts_sh: { l: 'DEF HALF-COURT %PTS', dp: 1, style: true },
  /* the CLUB's half-court AST% has a key of its own: hc_ast_pct is the player's (his share of teammates' half-court baskets he
     assisted, ranked among his position on the squad's cards), and one key for both blanked the players' ranking */
  tm_hc_ast_pct: { l: 'HALF-COURT AST%', dp: 1, rank: false, ref: 'ast_sh_all', refL: 'all', sc: 5 },
  evd_half_tov_pct: { l: 'DEF HALF-COURT TO%', dp: 1 }, evd_half_efg: { l: 'DEF HALF-COURT eFG%', dp: 1, low: true },
  evd_half_ppp: { l: 'DEF HALF-COURT PTS / CHANCE', dp: 2, low: true },
  tr_def_delta: { l: 'TRANSITION PTS GIVEN v OPP AVG', dp: 1, signed: true, low: true },
  evd_transition_ppp: { l: 'DEF TRANSITION PTS / CHANCE', dp: 2, low: true },
  vs_start_net: SPLIT('VS STARTERS NET', 'net'), vs_start_ortg: SPLIT('VS STARTERS ORTG', 'ortg'), vs_start_drtg: SPLIT('VS STARTERS DRTG', 'drtg', true),
  vs_bench_net: SPLIT('VS BENCH NET', 'net'), vs_bench_ortg: SPLIT('VS BENCH ORTG', 'ortg'), vs_bench_drtg: SPLIT('VS BENCH DRTG', 'drtg', true),
  own_start_net: SPLIT('OUR STARTERS NET', 'net'), own_start_ortg: SPLIT('OUR STARTERS ORTG', 'ortg'), own_start_drtg: SPLIT('OUR STARTERS DRTG', 'drtg', true),
  own_bench_net: SPLIT('OUR BENCH NET', 'net'), own_bench_ortg: SPLIT('OUR BENCH ORTG', 'ortg'), own_bench_drtg: SPLIT('OUR BENCH DRTG', 'drtg', true)
};
/* THE SHOT DISTRIBUTION (Louie, 2026-10-02), both ends, from every located shot of every club (shotchart.js
   attachZoneStats: z_ the club's own shots, zd_ the shots taken against it). [cut, label, the coach's words, decimals,
   the offence's good end, the defence's]: 'hi' more is better, 'lo' less is, 'style' neither */
const SD = [
  ['rim_att100', 'RIM / 100', 'shots at the rim, per 100 possessions', 1, 'hi', 'lo'],
  ['rim_fg', 'RIM FG%', 'how many of them go in', 1, 'hi', 'lo'],
  ['rim_astp', 'RIM ASSISTED%', 'rim baskets made off a pass', 1, 'style', 'style'],
  ['rim_ptsh', 'RIM SHARE OF PAINT POINTS', 'paint points scored right at the rim', 1, 'hi', 'lo'],
  ['paint_att100', 'PAINT / 100', 'the rest of the paint (not at the rim)', 1, 'style', 'style'],
  ['paint_fg', 'PAINT FG%', 'how many of them go in', 1, 'hi', 'lo'],
  ['paint_astp', 'PAINT ASSISTED%', 'paint baskets made off a pass', 1, 'style', 'style'],
  ['mid_att100', 'MID / 100', 'two-point jumpers outside the paint', 1, 'style', 'style'],
  ['mid_fg', 'MID FG%', 'how many of them go in', 1, 'hi', 'lo'],
  ['mid_astp', 'MID ASSISTED%', 'mid-range baskets made off a pass', 1, 'style', 'style'],
  ['three_att100', '3PT / 100', 'threes, per 100 possessions', 1, 'style', 'lo'],
  ['three_fg', '3PT%', 'how many of them go in', 1, 'hi', 'lo'],
  ['three_astp', '3PT ASSISTED%', 'threes made off a pass', 1, 'style', 'style'],
  ['c3_att100', 'CORNER 3 / 100', 'the shortest three, per 100 possessions', 1, 'hi', 'lo']
];
SD.forEach(([k, l, , dp, o, d]) => {
  TEAM_STATS['z_' + k] = { l, dp, low: o === 'lo', style: o === 'style' };
  TEAM_STATS['zd_' + k] = { l: 'OPP ' + l, dp, low: d === 'lo', style: d === 'style' };
});
const TEAM_DEFS = {
  opp_ts: ['Opponents’ true shooting %', 'How efficiently opponents score against the club, twos, threes and free throws together (from the play-by-play). Lower is better.'],
  tsa_for: ['True shooting attempts (TSA) a game', 'Field goal attempts plus .44 of the free throw attempts, a game, from the play-by-play: every shot the club takes, a trip to the line counting as the .44 of a shot it is worth.'],
  tsa_vs: ['True shooting attempts allowed a game', 'The same count for the opponents against the club. Fewer is better.'],
  tsa_gap: ['True shots gap', 'The club’s TSA a game less its opponents’: how many more shots it gets than it gives. It is the club’s turnover, offensive rebound and possession differences added up, because TSA = possessions + offensive rebounds − turnovers.'],
  tm_ppp: ['Points per possession', 'Points scored per possession (the offensive rating over 100).'],
  tm_oppp: ['Opponents’ points per possession', 'Points allowed per possession. Lower is better.'],
  z_rim_att100: ['Rim volume', 'Shots at the rim per 100 possessions (located shots), the club’s own and (OPP) its opponents’ against it.'],
  z_rim_fg: ['Rim FG%', 'The share of shots at the rim that go in.'],
  z_rim_astp: ['Rim assisted %', 'Of the baskets at the rim, the share made off a pass.'],
  z_rim_ptsh: ['Rim share of paint points', 'Of the points scored in the paint, the share scored right at the rim rather than further out in the key.'],
  z_paint_att100: ['Paint volume', 'Shots in the paint away from the rim, per 100 possessions.'],
  z_paint_fg: ['Paint FG%', 'The share of those that go in.'], z_paint_astp: ['Paint assisted %', 'Of the paint baskets away from the rim, the share made off a pass.'],
  z_mid_att100: ['Mid-range volume', 'Two-point jump shots outside the paint, per 100 possessions.'],
  z_mid_fg: ['Mid-range FG%', 'The share of those that go in.'], z_mid_astp: ['Mid-range assisted %', 'Of the mid-range baskets, the share made off a pass.'],
  z_three_att100: ['Three-point volume', 'Threes per 100 possessions.'], z_three_fg: ['Three-point %', 'The share of threes that go in.'],
  z_three_astp: ['Three-point assisted %', 'Of the made threes, the share made off a pass.'],
  z_c3_att100: ['Corner three volume', 'Threes from the corners (the shortest three) per 100 possessions.'],
  ast_sh_all: ['Assisted share of baskets', 'Of all the club’s baskets, the share made off a pass.'],
  ortg: ['Offensive rating', 'Points scored per 100 possessions.'], drtg: ['Defensive rating', 'Points allowed per 100 possessions. Lower is better.'],
  net: ['Net rating', 'Offensive rating minus defensive rating.'], pace: ['Pace', 'Possessions per 40 minutes, both sides averaged.'],
  ev_half_pts_sh: ['Half-court share of points', 'The share of the club’s points scored in the half court (not a second chance, a fast break, off a turnover or after a timeout).'],
  evd_half_pts_sh: ['Opponents’ half-court share of points', 'The same share for what opponents scored against the club.'],
  tm_hc_ast_pct: ['Half-court assist %', 'Of the club’s half-court baskets, the share that were assisted (its play-by-play), drawn against the assisted share of all its baskets.'],
  ev_half_tov_pct: ['Half-court turnover %', 'Turnovers per half-court chance. Lower is better.'],
  evd_half_tov_pct: ['Opponents’ half-court turnover %', 'Turnovers the club forces per half-court chance. Higher is better.'],
  ev_half_efg: ['Half-court eFG%', 'Effective field-goal percentage in the half court.'], evd_half_efg: ['Opponents’ half-court eFG%', 'Lower is better.'],
  ev_half_ppp: ['Half-court points per chance', 'Points per half-court chance (a trip ending in a shot, a turnover or free throws).'],
  evd_half_ppp: ['Opponents’ half-court points per chance', 'Lower is better.'],
  ev_transition_pts_sh: ['Transition share of points', 'The share of the club’s points scored in transition.'],
  tr_def_delta: ['Transition points given up against the opponents’ own average', 'Transition points a game opponents scored against the club, minus what the same opponents average in transition over the season. Below zero, the club gives up fewer than those opponents usually score.'],
  ev_transition_ppp: ['Transition points per chance', 'Points per transition chance.'], evd_transition_ppp: ['Opponents’ transition points per chance', 'Lower is better.'],
  vs_start_net: ['Against the starters', 'Net, offensive and defensive rating in the minutes the other side had four or more of its regular starters on (a regular starter: ten starts or more in the scope, or that game’s starters). The bar is drawn against the club’s own rating over every minute: green to the right is better than that, red to the left worse.'],
  vs_bench_net: ['Against the bench', 'The same ratings in every other minute, drawn against the club’s own.'],
  own_start_net: ['Our starters', 'Net, offensive and defensive rating in the minutes the club had four or more of its own regular starters on (the five who started most when fewer than five have ten starts), against the club’s own.'],
  own_bench_net: ['Our bench', 'The same ratings in every other minute of the club’s, against the club’s own.'],
  vs_start_ortg: ['Against the starters: offence', 'Points scored per 100 possessions against the other side’s starters.'],
  vs_start_drtg: ['Against the starters: defence', 'Points allowed per 100 possessions against the other side’s starters. Lower is better.'],
  vs_bench_ortg: ['Against the bench: offence', 'Points scored per 100 possessions against the other side’s bench.'],
  vs_bench_drtg: ['Against the bench: defence', 'Points allowed per 100 possessions against the other side’s bench. Lower is better.'],
  own_start_ortg: ['Our starters: offence', 'Points scored per 100 possessions with four or more of the club’s starters on.'],
  own_start_drtg: ['Our starters: defence', 'Points allowed per 100 possessions with four or more of the club’s starters on. Lower is better.'],
  own_bench_ortg: ['Our bench: offence', 'Points scored per 100 possessions in the club’s other minutes.'],
  own_bench_drtg: ['Our bench: defence', 'Points allowed per 100 possessions in the club’s other minutes. Lower is better.']
};
/* a club's place among the clubs on one key: '3rd of 18' (style: by most) */
function rankOf(teams, k, id, low) {
  const vals = teams.filter(t => t[k] != null && t[k] !== '' && isFinite(+t[k]));
  const me = vals.find(t => t.id === id);
  if (!me || vals.length < 3) return null;
  return { r: vals.filter(t => (low ? +t[k] < +me[k] : +t[k] > +me[k])).length + 1, n: vals.length };
}

function modules(ctx) {
  const E = root.EpinoiaA4 || root.EpinoiaReport, V = root.EpinoiaTeamViz;
  const { block, title, esc } = E;
  Object.keys(TEAM_STATS).forEach(k => { E.STATS[k] = TEAM_STATS[k]; });
  Object.keys(TEAM_DEFS).forEach(k => { E.DEFS[k] = TEAM_DEFS[k]; });
  const RAPM = { key: null, map: null, running: false };
  const f1 = v => (E.isNum(v) ? (+v).toFixed(1) : '—');
  const sg1 = v => (E.isNum(v) ? (+v > 0 ? '+' : '') + (+v).toFixed(1) : '—');
  const nameOf = (meta, id) => (meta && meta[id] && meta[id].name) || 'Player';
  const surname = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : (p[0] || ''); };
  const rk = (r, n) => (r ? E.ordinal(r.r) + ' of ' + r.n : '');

  /* the club's season once: the season object, its row, its scope's games and its lineups' records */
  let seasonP = null;
  const season = () => seasonP || (seasonP = Promise.resolve(ctx.season()).catch(e => { seasonP = null; throw e; }));
  let stintP = null;
  const stints = () => stintP || (stintP = (async () => {
    const L = await ctx.logs();
    const st = await ctx.stints(L.gs);
    const ids = [...new Set(st.flatMap(s => s.player_ids || []))];
    const meta = ids.length ? await ctx.meta(ids).catch(() => ({})) : {};
    return { st, meta, L };
  })().catch(e => { stintP = null; throw e; }));

  /* ---------------- the cover ---------------- */
  const cover = {
    key: 'cover', title: 'Cover', on: true,
    async build(c) {
      let names = null, games = 0;
      try {
        /* every player with minutes at each position, so a spot has a next player to go to when one leads two */
        const d = await ctx.depth(true);
        if (d && d.c && d.c.slots) { names = V.fiveOf(d.c.slots).map(p => (p ? surname(p.name) : '')); games = d.c.games || 0; }
      } catch (_) { /* no lineups */ }
      try {
        const T = await season();
        const m = T && T.mine;
        if (m) {
          const rec = E.isNum(m.w) && E.isNum(m.l) ? m.w + '–' + m.l : '';
          c.facts = [['Club', c.name], ['Competition', c.scope], ['Record', rec], ['Games', m.gp ? m.gp + ' played' : ''],
            ['Net rating', E.isNum(m.net) ? sg1(m.net) + ' (ORTG ' + f1(m.ortg) + ', DRTG ' + f1(m.drtg) + ')' : ''],
            ['Pace', E.isNum(m.pace) ? f1(m.pace) + ' possessions a game' : '']];
        }
      } catch (_) { c.facts = [['Club', c.name], ['Competition', c.scope]]; }
      if (!names) return '<h4>The most-used five</h4><div class="rp-empty">No lineups on record yet.</div>';
      return '<h4>The most-used five<span>most minutes at each position' + (games ? ' · ' + games + ' games' : '') + '</span></h4>' +
        E.posCourtHTML([20, 20, 20, 20, 20], { names }) +
        '<p class="rp-note">Each spot names the player with the most minutes there this season (the depth chart’s first choice). A player who leads two positions is named once, at the one he plays most; the other spot takes the next player in its depth chart.</p>';
    }
  };

  /* ---------------- MAIN STATS ---------------- */
  async function halfCourtAst(flip) {
    const SI = root.EpinoiaSituations;
    if (!SI || !SI.stamps || !SI.assistedShots || !SI.inGameOrder) return null;
    const L = await ctx.logs();
    let made = 0, ast = 0;
    L.gs.forEach(g => {
      const evs = L.byG[g.id] || [];
      if (!evs.length) return;
      const all = SI.inGameOrder(evs);
      const desc = SI.describe ? SI.describe(all) : { tags: {} };
      const plays = all.filter(e => e && !/^(loc|stype|tag|tags)$/.test(e.t));
      const st = SI.stamps(plays, desc.tags);
      const A = SI.assistedShots(plays).assisted;
      const side = flip ? 1 - L.sideOf[g.id] : L.sideOf[g.id];
      plays.forEach(e => {
        if (e.team !== side || !(e.t === 'p2_made' || e.t === 'p3_made')) return;
        const s = st.get(e);
        if (!s || s.second || s.offTo || s.transition) return;
        made++; if (A.has(e)) ast++;
      });
    });
    return made ? Math.round(1000 * ast / made) / 10 : null;
  }
  /* the ratings of a list of lineup records (lineupevents.js) */
  const LE = () => root.EpinoiaLineupEvents;
  function ratingsOf(recs) {
    const X = LE();
    if (!X || !recs || !recs.length) return null;
    const l = X.line(X.sum(recs));
    return l && l.mins > 0 ? l : null;
  }
  /* EVERY CLUB'S: opponents' true shooting (their play-by-play), points a possession at both ends, the assisted share of
     all baskets, and transition points given up against what those opponents usually score */
  function deriveTeams(teams, games) {
    const tr = new Map(teams.map(r => [r.id, r.ev_transition_ppg]));
    teams.forEach(r => {
      const pts = +r.evd_all_pts, fga = +r.evd_all_fga, fta = +r.evd_all_fta || 0;
      if (fga > 0) r.opp_ts = Math.round(1000 * pts / (2 * (fga + 0.44 * fta))) / 10;
      const V0 = root.EpinoiaTeamViz;
      if (V0 && V0.tsaOf) { const t = V0.tsaOf(r); r.tsa_for = t.own; r.tsa_vs = t.vs; r.tsa_gap = t.gap; }
      if (E.isNum(r.ortg)) r.tm_ppp = Math.round(r.ortg) / 100;
      if (E.isNum(r.drtg)) r.tm_oppp = Math.round(r.drtg) / 100;
      const a = +r.ev_ast_fgm, u = +r.ev_unast_fgm;
      if (a + u > 0) r.ast_sh_all = Math.round(1000 * a / (a + u)) / 10;
      const opp = (games || []).filter(g => g.home_team_id === r.id || g.away_team_id === r.id)
        .map(g => tr.get(g.home_team_id === r.id ? g.away_team_id : g.home_team_id)).filter(E.isNum).map(Number);
      if (opp.length && E.isNum(r.evd_transition_ppg)) r.tr_def_delta = Math.round(10 * (r.evd_transition_ppg - opp.reduce((x, y) => x + y, 0) / opp.length)) / 10;
    });
  }
  const main = {
    key: 'main', title: 'Main stats', page: 'MAIN STATS', on: true,
    async build(c, R) {
      const T = await season();
      if (!T || !T.mine) return [block('<div class="rp-empty">No team statistics for this club in this scope yet.</div>')];
      const { S, mine } = T;
      try { if (ctx.zones) await ctx.zones(S); } catch (_) { /* the shot distribution without its zones */ }
      const teams = S.teams.map(r => Object.assign({}, r));
      const me = teams.find(r => r.id === mine.id);
      deriveTeams(teams, S.games);
      /* A SINGLE GAME (c.vs, game/analysis.js): both clubs on the same footing, the same figures for each, its own of
         the game, ranked and coloured as that club's against the competition's clubs over the season (not one club's
         offence against what it allowed: in one game what one allowed is the other's own) */
      const them = c.vs ? teams.find(r => r.id === c.vs.bid) || null : null;
      try { me.tm_hc_ast_pct = await halfCourtAst(); if (them) them.tm_hc_ast_pct = await halfCourtAst(true); } catch (_) { /* without it */ }
      /* against the other side's starters and bench, and the club's own: its play-by-play records */
      try {
        const scoped = new Set((S.games || []).map(g => g.id));
        const logs = await ctx.clubLogs(scoped);
        if (logs && logs.recs) {
          const SL = root.EpinoiaSeasonLine;
          const games = (await ctx.starters(T.scopeComps)) || [];
          const reg = SL ? SL.regularStarters(games, 10) : new Map();
          const sp = SL ? SL.splitRecs(logs.recs, LE(), { mode: 'regular', regular: reg }) : null;
          const put = (pre, l, row) => { if (!l) return; row = row || me; row[pre + '_net'] = Math.round(10 * l.net) / 10; row[pre + '_ortg'] = Math.round(10 * l.ortg) / 10; row[pre + '_drtg'] = Math.round(10 * l.drtg) / 10; };
          if (sp) { put('vs_start', ratingsOf(sp.start)); put('vs_bench', ratingsOf(sp.bench)); }
          /* the club's own: its regular starters, or the five who started most when fewer than five have ten starts */
          const ownSplit = (row, recs) => {
            const count = new Map();
            games.forEach(g => { if (!Array.isArray(g.starters)) return; const i = g.home_team_id === row.id ? 0 : g.away_team_id === row.id ? 1 : -1; if (i < 0) return;
              (g.starters[i] || []).filter(Boolean).forEach(p => count.set(p, (count.get(p) || 0) + 1)); });
            let own = new Set([...count].filter(([, n]) => n >= 10).map(([p]) => p));
            if (own.size < 5) own = new Set([...count].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p));
            const st = [], bn = [];
            recs.forEach(r => ((r.ids || []).filter(p => own.has(p)).length >= 4 ? st : bn).push(r));
            put('own_start', ratingsOf(st), row); put('own_bench', ratingsOf(bn), row);
          };
          ownSplit(me, logs.recs);
          /* a single game (c.vs): the other club's starters and bench too, from its own side of the same log */
          if (them && ctx.otherLogs) {
            const ol = await ctx.otherLogs();
            if (ol && ol.recs) ownSplit(them, ol.recs);
          }
        }
      } catch (e) { if (root.console) root.console.warn('[report starters]', e); }
      const N = teams.length;
      const ff = [['Shooting', 'eFG%', 'ff_efg', 'dff_efg', false], ['Turnovers', 'TOV%', 'ff_tov', 'dff_tov', true],
                  ['Rebounding', 'OREB%', 'ff_oreb', 'dff_oreb', false], ['Free throws', 'FTr', 'ff_ftr', 'dff_ftr', false]];
      const Rf = E.ranker(teams, ff.flatMap(x => [x[2], x[3]]).concat(['ortg', 'drtg', 'net', 'pace']));
      const chip = (k, row) => { row = row || me; const p = Rf.pct(k, row.id), s = E.STATS[k] || {}; const r = rankOf(teams, k, row.id, s.low);
        return r ? '<span class="rp-rk" data-b="' + E.band(p, s.style) + '">' + rk(r) + '</span>' : ''; };
      R.legend.push('ff_efg', 'ff_tov', 'ff_oreb', 'ff_ftr');
      /* a pair of boxes: the club's own and what it allowed, or in a single game each club's own */
      const ffs = (k, row, lab, fmt) => { const s = E.STATS[k] || {};
        return '<div class="rp-ffs" data-b="' + E.band(Rf.pct(k, row.id), s.style) + '"><b>' + (fmt || f1)(row[k]) + '</b><span>' + esc(lab) + '</span>' + chip(k, row) + '</div>'; };
      const ffHTML = '<div class="rp-ff">' + ff.map(([l, u, o, d]) => '<div class="rp-ffc"><h4>' + l + ' · ' + u + '</h4><div class="rp-ffp">' +
        (them ? ffs(o, me, c.vs.as) + ffs(o, them, c.vs.bs) : ffs(o, me, 'own') + ffs(d, me, 'allowed')) + '</div></div>').join('') + '</div>';
      const tiles = [['ORTG', 'ortg', 'points scored per 100'], ['DRTG', 'drtg', 'points allowed per 100'], ['NET', 'net', 'the difference'], ['PACE', 'pace', 'possessions a game']];
      /* a single game's second row: both offences and the margin in one card, ball movement, and each club's average
         time of possession (shotclock.js through ctx.atop: no other club has one for this game, so it is not ranked,
         only called the quicker or the slower) */
      let atop = null;
      try { atop = them && ctx.atop ? await ctx.atop() : null; } catch (_) { atop = null; }
      const topBox = (v, other, lab) => '<div class="rp-ffs" data-b="9"><b>' + (E.isNum(v) ? (+v).toFixed(1) + '<small>s</small>' : '\u2014') + '</b><span>' + esc(lab) + '</span>' +
        (E.isNum(v) && E.isNum(other) && Math.abs(v - other) >= 0.05 ? '<span class="rp-rk" data-b="9">' + (v < other ? 'quicker' : 'slower') + '</span>' : '') + '</div>';
      const tileHTML = them
        ? '<div class="rp-ff" style="margin-top:10px">' +
            '<div class="rp-ffc rp-ff2"><h4>Scoring and margin · ORTG · NET</h4><div class="rp-ffp rp-ffp3">' + ffs('ortg', me, c.vs.as) + ffs('ortg', them, c.vs.bs) +
              ffs('net', me, c.vs.as + ' margin', sg1) + '</div></div>' +
            '<div class="rp-ffc"><h4>Ball movement · AST%</h4><div class="rp-ffp">' + ffs('ast_sh_all', me, c.vs.as) + ffs('ast_sh_all', them, c.vs.bs) + '</div></div>' +
            (atop && (E.isNum(atop[0]) || E.isNum(atop[1]))
              ? '<div class="rp-ffc"><h4>Avg possession · secs</h4><div class="rp-ffp">' + topBox(atop[0], atop[1], c.vs.as) + topBox(atop[1], atop[0], c.vs.bs) + '</div></div>'
              : '<div class="rp-ffc"><h4>Tempo · PACE</h4><div class="rp-ffp">' + ffs('pace', me, c.vs.as) + ffs('pace', them, c.vs.bs) + '</div></div>') + '</div>'
        : '<div class="rp-tiles rp-tiles-b" style="--n:4;margin-top:10px">' + tiles.map(([l, k, w]) => {
          const s = E.STATS[k] || {}, b = E.band(Rf.pct(k, me.id), s.style);
          return '<div class="rp-tile" data-b="' + b + '"><b>' + (k === 'net' ? sg1(me[k]) : f1(me[k])) + '</b><span>' + l + '</span><em>' + w + '</em>' + chip(k) + '</div>'; }).join('') + '</div>';
      const out = [block(title('Four factors', them ? 'the same figures for both clubs, this game · each coloured by its place among the competition’s ' + N + ' clubs over the season'
        : [c.scope, 'own and allowed · the chip is the place among ' + N].filter(Boolean).join(' · ')) + ffHTML + tileHTML)];
      /* each group split in two (Louie, 2026-10-02): what the club does with the ball, then what it allows; the
         starters and bench groups lead with their net ratings */
      const both = ks => [['o', ks, me], ['d', ks, them]];
      const groups = them ? [
        ['EFFICIENCY', both(['ts', 'ft_pct', 'tm_ppp'])],
        ['HALF COURT', both(['ev_half_pts_sh', 'tm_hc_ast_pct', 'ev_half_tov_pct', 'ev_half_efg', 'ev_half_ppp'])],
        ['TRANSITION', both(['ev_transition_pts_sh', 'ev_transition_ppp'])]
      ] : [
        ['EFFICIENCY', [['o', ['ts', 'ft_pct', 'tm_ppp']], ['d', ['opp_ts', 'tm_oppp']]]],
        ['HALF COURT', [['o', ['ev_half_pts_sh', 'tm_hc_ast_pct', 'ev_half_tov_pct', 'ev_half_efg', 'ev_half_ppp']], ['d', ['evd_half_pts_sh', 'evd_half_tov_pct', 'evd_half_efg', 'evd_half_ppp']]]],
        ['TRANSITION', [['o', ['ev_transition_pts_sh', 'ev_transition_ppp']], ['d', ['tr_def_delta', 'evd_transition_ppp']]]],
        ['AGAINST STARTERS & BENCH', [['n', ['vs_start_net', 'vs_bench_net']], ['o', ['vs_start_ortg', 'vs_bench_ortg']], ['d', ['vs_start_drtg', 'vs_bench_drtg']]]],
        ['OUR STARTERS & BENCH', [['n', ['own_start_net', 'own_bench_net']], ['o', ['own_start_ortg', 'own_bench_ortg']], ['d', ['own_start_drtg', 'own_bench_drtg']]]]
      ];
      /* a single game: each part is a club, by name */
      const SIDE = them ? { o: c.vs.a, d: c.vs.b, n: 'Net rating' } : { o: 'Offence', d: 'Defence', n: 'Net rating' };
      /* inside a group and a half the group's own words are not repeated: "HALF COURT / Defence / TO%" */
      const SHORT = {
        ft_pct: 'FT%', tm_ppp: 'PTS / POSSESSION', opp_ts: 'TS% ALLOWED', tm_oppp: 'PTS / POSSESSION',
        ev_half_pts_sh: '%PTS', tm_hc_ast_pct: 'AST%', ev_half_tov_pct: 'TO%', ev_half_efg: 'eFG%', ev_half_ppp: 'PTS / CHANCE',
        evd_half_pts_sh: '%PTS', evd_half_tov_pct: 'TO% FORCED', evd_half_efg: 'eFG%', evd_half_ppp: 'PTS / CHANCE',
        ev_transition_pts_sh: '%PTS', ev_transition_ppp: 'PTS / CHANCE', tr_def_delta: 'PTS v OPP AVERAGE', evd_transition_ppp: 'PTS / CHANCE',
        vs_start_net: 'VS STARTERS', vs_bench_net: 'VS BENCH', vs_start_ortg: 'VS STARTERS', vs_bench_ortg: 'VS BENCH',
        vs_start_drtg: 'VS STARTERS', vs_bench_drtg: 'VS BENCH',
        own_start_net: 'STARTERS', own_bench_net: 'BENCH', own_start_ortg: 'STARTERS', own_bench_ortg: 'BENCH',
        own_start_drtg: 'STARTERS', own_bench_drtg: 'BENCH'
      };
      const SIDE_RT = { o: 'Offence · ORTG', d: 'Defence · DRTG' };
      const keys = [...new Set(groups.flatMap(g => g[1].flatMap(x => x[1])))];
      const Rk = E.ranker(teams, keys);
      const placeOf = row => k => { const s = E.STATS[k] || {}; const r = rankOf(teams, k, row.id, s.low); return r ? E.ordinal(r.r) + '/' + r.n : null; };
      R.legend.push(...keys);
      /* a group's parts each read from a row: the part's own (a single game's two clubs), the group's, or the club's */
      const groupHTML = ([t, parts, row]) => '<div class="rp-g rp-gx"><h4>' + esc(t) + '</h4>' +
        parts.map(([side, ks, prow]) => { const r = prow || row || me;
          return '<div class="rp-gs ' + side + '"><span class="rp-gs-t">' + esc(/STARTERS/.test(t) && SIDE_RT[side] ? SIDE_RT[side] : SIDE[side]) + '</span>' +
            ks.map(k => E.statRowHTML(k, r, Rk, { place: row ? null : placeOf(r), label: k2 => SHORT[k2] })).join('') + '</div>'; }).join('') + '</div>';
      /* two blocks: the club's own season, then the starters and the bench (a page of their own when the first fills one) */
      /* explicit columns (the PDF's renderer does not lay out CSS columns): the half court beside efficiency and
         transition, which balance it; against the other side's starters and bench beside the club's own */
      const cols = (l, r) => '<div class="rp-cols"><div>' + l.map(groupHTML).join('') + '</div><div>' + r.map(groupHTML).join('') + '</div></div>';
      out.push(block(title(them ? 'Game line' : 'Season line', them ? 'the same figures for both clubs · the bar and its colour: each club’s place among the competition’s ' + N + ' over the season (green the top quarter, red the bottom)'
        : 'the bar and its colour: the club’s place among ' + N + ' (green the top quarter, red the bottom)') +
        cols([groups[1]], [groups[0], groups[2]])));
      /* a single game: each club's starters and its bench, side by side, each against that club over the game */
      const sb = (name, row) => [(name + ' starters & bench').toUpperCase(), [['n', ['own_start_net', 'own_bench_net']], ['o', ['own_start_ortg', 'own_bench_ortg']], ['d', ['own_start_drtg', 'own_bench_drtg']]], row];
      out.push(block(title('Starters and bench', 'ratings per 100 possessions · the bar from the middle: better (green, right) or worse (red, left) than ' + (c.vs ? 'the club over the whole game' : 'the club over every minute')) +
        (them ? cols([sb(c.vs.as, me)], [sb(c.vs.bs, them)]) : cols([groups[3]], [groups[4]]))));
      /* THE SHOT DISTRIBUTION at both ends, each ranked among the clubs */
      if (SD.some(([k]) => E.isNum(me['z_' + k]) || E.isNum(me['zd_' + k]))) {
        const sk = SD.flatMap(([k]) => ['z_' + k, 'zd_' + k]);
        const Rs = E.ranker(teams, sk);
        R.legend.push(...SD.map(([k]) => 'z_' + k));
        const cell = (k, row) => { row = row || me;
          const s = E.STATS[k] || {}, v = row[k], p = Rs.pct(k, row.id), b = E.band(p, s.style), r = rankOf(teams, k, row.id, s.low);
          return '<td><div class="rp-sdc" data-b="' + (E.isNum(v) ? b : 0) + '"><b>' + E.fmtStat(k, v) + '</b><span class="rp-sdb"><i style="width:' + (p == null ? 0 : Math.max(3, p)) + '%"></i></span>' +
            '<em>' + (r ? (s.style ? E.ordinal(r.r) + ' most' : E.ordinal(r.r) + ' of ' + r.n) : '') + '</em></div></td>';
        };
        out.push(block(title('Shot distribution', (them ? 'where each club’s shots came from and how they went in · its place among the competition’s ' + N : 'where the shots come from and how they go in, at both ends · the club’s place among ' + N) + ' (blue: a style, ranked by most)') +
          '<table class="rp-tbl rp-sd"><thead><tr><th class="l">shots</th><th class="o">' + esc(c.name) + ' shooting</th><th class="d">' + (c.vs ? esc(c.vs.b) + ' shooting' : 'opponents shooting against ' + esc(c.name)) + '</th></tr></thead><tbody>' +
          SD.map(([k, l, w], i) => '<tr' + (i && /_att100$/.test(k) ? ' class="grp"' : '') + '><td class="l"><b>' + esc(l) + '</b><small>' + esc(w) + '</small></td>' + cell('z_' + k) + (them ? cell('z_' + k, them) : cell('zd_' + k)) + '</tr>').join('') +
          '</tbody></table>'));
      }
      try {
        /* both ends side by side, in the report's own dress (the club page's table is a page wide for each end) */
        if (ctx.rebounds) await ctx.rebounds(S, mine);
        const srcOf = row => S.teams.find(t => t.id === row.id) || {};
        const src = srcOf(me);
        if (src.rb_ready && (!them || srcOf(them).rb_ready)) {
          const field = S.teams;
          const ZS = [['rim', 'At the rim'], ['mid', 'Mid-range'], ['three', 'Threes'], ['all', 'Every shot']];
          const FEW = 10;
          const pc = v => (E.isNum(v) ? (+v).toFixed(1) + '%' : '\u2014');
          const end = (own, row) => {
            row = row || me;
            const src = srcOf(row);
            const bd = (k, low, few) => (few ? 0 : V.bandP(V.pctIn(field, k, row.id, low)));
            const g = (z, f) => +src['rb_' + z + '_' + (own ? '' : 'g') + f] || 0;
            const rows = ZS.map(([z, label]) => {
              const a = g(z, 'a'), m = g(z, 'm'), o = g(z, 'o'), d = g(z, 'd'), n = Math.max(0, a - m - o - d);
              const w = x => (a ? (100 * x / a).toFixed(2) : 0);
              const seg = (x, cls, t) => (x > 0 ? '<i class="' + cls + '" style="width:' + w(x) + '%" title="' + t + '"></i>' : '');
              const rk = 'rb_' + z + '_' + (own ? 'orb' : 'drb'), fk = 'rb_' + z + '_' + (own ? 'fg' : 'gfg');
              const few = o + d < FEW, r = few ? null : rankOf(field, rk, row.id, false);
              const fb = bd(fk, !own, a < FEW), rb = bd(rk, false, few);
              return '<tr' + (z === 'all' ? ' class="tot"' : '') + '><th>' + label + '</th><td class="at">' + a + '</td>' +
                '<td class="bar"><span class="rp-rb-bar">' + seg(m, 'm', 'made') + seg(o, 'o', own ? 'own offensive rebound' : 'their offensive rebound') +
                  seg(d, 'd', own ? 'their defensive rebound' : 'own defensive rebound') + seg(n, 'n', 'no rebound') + '</span></td>' +
                '<td class="v" data-b="' + fb + '">' + (a ? pc(100 * m / a) : '\u2014') + '</td>' +
                '<td class="v" data-b="' + rb + '">' + pc(src[rk]) + (r ? '<small>' + E.ordinal(r.r) + '</small>' : '') + '</td></tr>';
            }).join('');
            const key = '<p class="rp-rb-key"><span><i class="m"></i>made</span><span><i class="o"></i>' + (own ? 'own' : 'their') + ' off. rebound</span>' +
              '<span><i class="d"></i>' + (own ? 'their' : 'own') + ' def. rebound</span><span><i class="n"></i>no rebound</span></p>';
            return '<div class="rp-rb ' + (own ? 'own' : 'opp') + (row !== me ? ' b' : '') + '"><h4>' + (own ? esc(row === me ? c.name : c.vs.b) + ' shooting' : 'Opponents shooting against ' + esc(c.name)) + '</h4>' + key +
              '<table><thead><tr><th>zone</th><th class="at">att</th><th>outcome</th><th>fg%</th><th>' + (own ? 'orb%' : 'drb%') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
          };
          out.push(block(title('Rebounds analysis', (them ? 'what became of every shot each club took, by zone' : 'what became of every shot attempt, by zone, at both ends') + ' \u00b7 the colour is the club\u2019s place among ' + N) +
            E.colsHTML(them ? [end(true, me), end(true, them)] : [end(true), end(false)], h => h, () => 1) +
            '<p class="rp-note">The first rebound after each miss counts, team rebounds too; a miss followed by free throws, a turnover or the end of a period has none. ' +
            'ORB% and DRB% are of the misses somebody rebounded, as the four factors count them; the small figure is the club\u2019s place, once it has ten rebounded misses.</p>', 'rp-reb'));
        }
      } catch (e) { if (root.console) root.console.warn('[report rebounds]', e); }
      /* TRUE SHOTS, under the rebounds (2026-10-03): the club's true shot attempts a game and its opponents', the gap
         between them, and what the gap is made of (a club's page only: a single game has its own two clubs' lines) */
      try {
        const srcRow = S.teams.find(t => t.id === me.id) || {};
        const TS = them ? null : V.trueShotsOf(me, srcRow);
        if (TS) {
          const ks = ['tsa_for', 'tsa_vs', 'tsa_gap'], Rt = E.ranker(teams, ks);
          const bandOf = k => E.band(Rt.pct(k, me.id), (E.STATS[k] || {}).style);
          const placeOf = k => rk(rankOf(teams, k, me.id, (E.STATS[k] || {}).low));
          R.legend.push(...ks);
          out.push(block(title('True shots gap', 'true shooting attempts (TSA) a game, the club’s and its opponents’ · the colour and the chip: the club’s place among ' + N) +
            V.trueShots(TS, { bands: { own: bandOf('tsa_for'), vs: bandOf('tsa_vs'), gap: bandOf('tsa_gap') }, ranks: { own: placeOf('tsa_for'), vs: placeOf('tsa_vs'), gap: placeOf('tsa_gap') } }) +
            '', 'rp-tsa'));
        }
      } catch (e) { if (root.console) root.console.warn('[report true shots]', e); }
      R.legendExtra.push(['FOUR FACTORS', 'Shooting (eFG%), turnovers (per 100 possessions), offensive rebounding (share of own misses rebounded) and free-throw rate: the four things that decide a game, at both ends. Each box is coloured by the club’s place among the clubs.'],
        ['SHOT DISTRIBUTION', 'Every located shot at both ends cut into the rim, the rest of the paint, mid-range and three (the corners on their own line): how many per 100 possessions, how many go in, how many came off a pass.'],
        ['REBOUNDS ANALYSIS', 'Every shot attempt in a zone went in, was rebounded by the shooter’s side, by the other side, or had no rebound; ORB% and DRB% are of the misses somebody rebounded.']);
      return out;
    }
  };

  /* ---------------- SHOT CHART ---------------- */
  const shots = {
    key: 'shots', title: 'Shot chart', page: 'SHOT CHART', on: true,
    async build(c, R) {
      const SC = root.EpinoiaShotChart;
      const L = await ctx.logs();
      if (!SC || !L || !L.gs.length) return [block('<div class="rp-empty">No finalised games yet.</div>')];
      const fetchEvents = async () => Object.values(L.byG);
      const ids = L.gs.map(g => g.id);
      const off = await SC.gather({ fetchEvents, gameIds: ids, playerId: null, sideOf: id => L.sideOf[id] });
      const def = await SC.gather({ fetchEvents, gameIds: ids, playerId: null, sideOf: id => 1 - L.sideOf[id] });
      if (!off.length && !def.length) return [block('<div class="rp-empty">No located shots for this club yet.</div>')];
      const court = (sh, view, colour) => {
        const h = E.el('div');
        SC.renderZones({ host: h, shots: sh, colour, minAttempts: 5, games: L.gs.length, zones: true, table: false, view, controls: false });
        return h.innerHTML;
      };
      const colour = c.accent || '#08603f';
      const head = (t, sh) => { const m = sh.filter(s => s.made).length; return '<div class="rp-cap">' + t + '<span>' + m + '/' + sh.length + (sh.length ? ' · ' + Math.round(100 * m / sh.length) + '%' : '') + '</span></div>'; };
      const out = [];
      const poss = n => esc(n) + (/s$/i.test(n) ? '’' : '’s');     // Illawarra Hawks’, Adelaide 36ers’
      out.push(block(title(c.vs ? 'Both teams’ shots by zone' : 'Offence and defence by zone', (c.vs ? 'this game' : 'the last ' + L.gs.length + ' games') + ' · each zone tinted against its break-even') +
        '<div class="rp-two"><div>' + head(c.vs ? poss(c.vs.a) + ' shots' : 'Offence', off) + court(off, 'zones', colour) + '</div><div>' + head(c.vs ? poss(c.vs.b) + ' shots' : 'Defence (opponents’ shots)', def) + court(def, 'zones', (c.vs && c.vs.bcol) || '#5d6b64') + '</div></div>'));
      /* both ends, zone by zone, in one table. Cut into parts as every table of zones is (shotchart.js parts: a heading for each kind
         of shot, then for each way of cutting the larger cuts), the two clubs' figures side by side under a heading of their own
         (a club's name once, not on every column), in fixed columns: it is the page's width, whatever the names are */
      const zr = sh => SC.zoneRows(sh, L.gs.length);
      const zo = zr(off), zd = zr(def);
      const byKey = rows => new Map(rows.map(r => [r.k || r.label, r]));
      const mo = byKey(zo.groups.concat(zo.big)), md = byKey(zd.groups.concat(zd.big));
      /* FG% against the zone's break-even: green above it for the offence, under it for the defence */
      const cell = (r, def) => {
        if (!r || !r.att) return '<td>\u2014</td><td>\u2014</td><td>\u2014</td>';
        const d = E.isNum(r.fg) && E.isNum(r.be) ? (def ? r.be - r.fg : r.fg - r.be) : null;
        const b = d == null || r.att < 5 ? 0 : d >= 6 ? 4 : d >= 0 ? 3 : d >= -6 ? 2 : 1;
        return '<td>' + r.made + '/' + r.att + '</td><td>' + (E.isNum(r.share) ? f1(r.share) + '%' : '\u2014') + '</td><td data-b="' + b + '">' + f1(r.fg) + '</td>';
      };
      const cellD = r => cell(r, !c.vs);
      const nameA = c.vs ? esc(c.vs.as || c.vs.a) : 'offence', nameB = c.vs ? esc(c.vs.bs || c.vs.b) : 'defence';
      const zrow = (a, b, k) => {
        const any = a || b;
        return '<tr' + (any.kind ? ' data-k="' + any.kind + '"' : '') + '><td class="l">' + esc(any.label || k) + '</td>' + cell(a) + cellD(b) + '<td>' + (E.isNum(any.be) ? f1(any.be) : '\u2014') + '</td></tr>';
      };
      const zbody = [['every zone', 'groups', zo.groups], ['the larger cuts', 'big', zo.big]].map(([cap, which, list]) =>
        '<tr class="rp-zg"><td colspan="8">' + cap + '</td></tr>' +
        SC.parts(list, which).map(p => (p.title ? '<tr class="rp-zk"' + (p.kind ? ' data-k="' + p.kind + '"' : '') + '><td colspan="8"><i></i>' + esc(p.title) + '</td></tr>' : '') +
          p.rows.map(r => zrow(mo.get(r.k || r.label), md.get(r.k || r.label), r.k || r.label)).join('')).join('')).join('');
      out.push(block(title(c.vs ? 'Both teams, zone by zone' : 'Both ends, zone by zone', c.vs ? 'FG% green where it beat the zone’s break-even, red where it fell short' : 'FG% green where it beats the zone’s break-even (offence) or holds opponents under it (defence)') +
        '<table class="rp-tbl rp-zt rp-zz"><colgroup><col class="z"><col span="6"><col class="be"></colgroup><thead>' +
        '<tr><th class="l" rowspan="2">zone</th><th colspan="3" class="rp-zh-a">' + nameA + '</th><th colspan="3" class="rp-zh-b">' + nameB + '</th><th rowspan="2">break-even</th></tr>' +
        '<tr><th>made/att</th><th>% of shots</th><th>FG%</th><th>made/att</th><th>% of shots</th><th>FG%</th></tr></thead><tbody>' + zbody + '</tbody></table>'));
      /* the box score's half-court and transition cards over the season, at both ends (situations.js on every log) */
      try {
        if (root.EpinoiaSituations) {
          const run = def => E.sitSeason(L.gs.map(g => ({ events: L.byG[g.id] || [], teams: (g.roster_snapshot && g.roster_snapshot.teams) || null,
            side: def ? 1 - L.sideOf[g.id] : L.sideOf[g.id] })));
          const O = run(false), Dd = run(true);
          const pids = [...new Set([O, Dd].flatMap(x => x.half.scorers.concat(x.transition.scorers)).map(x => x.pid))];
          const names = {};
          try { const meta = await ctx.meta(pids); pids.forEach(id => { if (meta[id] && meta[id].name) names[id] = meta[id].name; }); } catch (_) { /* unnamed */ }
          out.push(block(title('Half court', c.vs ? 'set offence against set defence, both teams, this game' : 'the box score’s half-court card over the last ' + L.gs.length + ' games, both ends') +
            E.sitCardHTML(O.half, { key: 'half', colour, who: c.name + ' offence', names })));
          out.push(block(E.sitCardHTML(Dd.half, { key: 'half', colour: (c.vs && c.vs.bcol) || '#5d6b64', who: c.vs ? c.vs.b + ' offence' : 'opponents against ' + c.name, names })));
          out.push(block(title('Transition', 'fast breaks, and within eight seconds of a defensive rebound or a steal') +
            E.sitCardHTML(O.transition, { key: 'transition', colour: c.vs ? colour : '#b4572e', who: c.name + ' offence', names, compact: true })));
          out.push(block(E.sitCardHTML(Dd.transition, { key: 'transition', colour: (c.vs && c.vs.bcol) || '#5d6b64', who: c.vs ? c.vs.b + ' offence' : 'opponents against ' + c.name, names, compact: true })));
        }
      } catch (e) { if (root.console) root.console.warn('[report situations]', e); }
      /* the events: what the club made of each situation, and what opponents made of the same, each on its colour */
      try {
        const T = await season();
        if (T && T.mine && V) {
          const other = c.vs ? T.S.teams.find(r => r.id === c.vs.bid) : null;
          out.push(block(title('Events', (other ? 'what each kind of possession was worth to each club · coloured by its place among ' : 'what each kind of possession is worth, at both ends · coloured by the club’s place among ') + T.S.teams.length + ' clubs') +
            V.events(T.mine, T.S.teams, { name: c.name, opp: c.vs && c.vs.b, other }), 'rp-ev'));
          R.legendExtra.push(['EVENTS', 'Half court: a set offence against a set defence. Transition: a fast break, or a shot within eight seconds of a defensive rebound or a steal. Second chances: after an offensive rebound. Off turnovers: after the other side gave the ball away. After timeouts: the play drawn up in a timeout. Points a chance is what one such trip is worth; the word beside it is the club’s place among the clubs (strength: the top quarter; weakness: the bottom).']);
        }
      } catch (_) { /* without it */ }
      R.legendExtra.push(['ZONES', 'The court cut into twelve areas, each tinted against its own break-even (paint 58%, mid-range 40%, three 35%): orange above, blue below, grey within two points; hatched where there are too few attempts to rate.'],
        ['BREAK-EVEN', 'The percentage a zone’s shots must go in at to be worth the league’s average possession.']);
      return out;
    }
  };

  /* ---------------- PLAYERS ---------------- */
  const HC = { key: null, map: null };                       // the competition's half-court assists, once per set of games
  const players = {
    key: 'players', title: 'Players', page: 'PLAYERS', on: true, pack: false,
    controls(host, state) {
      E.templateControl(host, state, { set: 'players', label: 'players page', pos: () => 'guard' });
      /* the squad's Synergy files: each matched to a player of the club by his name */
      if (E.synergyControl) E.synergyControl(host, state, { players: async () => {
        const T = await season();
        if (!T || !T.S) return [];
        const sq = T.S.players.filter(r => r.teamId === T.mine.id);
        const meta = await ctx.meta(sq.map(r => r.id)).catch(() => ({}));
        return sq.map(r => ({ id: r.id, name: (meta[r.id] && meta[r.id].name) || r.name || '' }));
      } });
      if (ctx.rapm) E.rapmControl(host, state, RAPM, {
        ids: async () => { const T = await season(); return T && T.S ? (T.S.games || []).map(g => g.id).filter(Boolean) : []; },
        run: (ids, fn) => ctx.rapm(ids, fn),
        scope: () => (state.c && state.c.scope) || 'this league and season'
      });
    },
    async build(c, R) {
      const T = await season();
      if (!T || !T.S) return [block('<div class="rp-empty">No player statistics for this club in this scope yet.</div>')];
      const field = T.S.players.map(r => Object.assign({}, r));
      const rapmOk = RAPM.map && RAPM.key === E.rapmKey((T.S.games || []).map(g => g.id).filter(Boolean)) && E.rapmOn(RAPM, field);
      field.forEach(E.derive);
      const squad = field.filter(r => r.teamId === T.mine.id && +r.gp > 0).sort((a, b) => (+b.mpg || 0) * (+b.gp || 0) - (+a.mpg || 0) * (+a.gp || 0));
      if (!squad.length) return [block('<div class="rp-empty">No player has played for the club in this scope yet.</div>')];
      /* his minutes at each position (the depth chart's, every player), his turnover types (the club's logs) */
      const posMin = new Map();
      try {
        const d = await ctx.depth(true);
        ((d && d.c && d.c.slots) || []).forEach((s, k) => s.players.forEach(p => { const m = posMin.get(String(p.id)) || [0, 0, 0, 0, 0]; m[k] += p.min; posMin.set(String(p.id), m); }));
      } catch (_) { /* without them */ }
      try {
        const L = await ctx.logs();
        const tt = E.turnoverTypes(L.byG);
        squad.forEach(r => { const t = tt.get(r.id); if (t && t.typed) { r.badpass_pg = Math.round(10 * t.bad / Math.max(1, +r.gp)) / 10; r.handle_pg = Math.round(10 * t.handle / Math.max(1, +r.gp)) / 10; } });
      } catch (_) { /* without them */ }
      const meta = await ctx.meta(squad.map(r => r.id)).catch(() => ({}));
      /* SYNERGY (report.js synergyOf): his drives left and right, and what his man shot at him, where he has a file */
      const syn = E.synergyOf ? await E.synergyOf(squad.map(r => r.id)).catch(() => new Map()) : new Map();
      squad.forEach(r => { if (E.synergyOnRow) E.synergyOnRow(r, syn.get(String(r.id))); });
      /* each player's own shots over the club's games, for the small zone chart in his card's corner */
      const shotsBy = new Map();
      try {
        const SC = root.EpinoiaShotChart, L = await ctx.logs();
        if (SC && SC.gather && L && L.gs && L.gs.length) {
          const sh = await SC.gather({ fetchEvents: async () => Object.values(L.byG), gameIds: L.gs.map(g => g.id), playerId: null, sideOf: id => L.sideOf[id] });
          sh.forEach(x => { const k = String(x.pid); if (!shotsBy.has(k)) shotsBy.set(k, []); shotsBy.get(k).push(x); });
        }
      } catch (_) { /* without the corner charts */ }
      const allKeys = new Set();
      const sets = {};
      ['guard', 'wing', 'big'].forEach(g => { sets[g] = E.groupsFor(R.state, 'players', g); sets[g].forEach(x => x[1].forEach(k => allKeys.add(k))); });
      /* half-court (and transition) AST%: every game of the competition replayed once (report.js hcAssists), for every player of
         the field, so a guard's is ranked among the guards as every other cell is */
      if ((allKeys.has('hc_ast_pct') || allKeys.has('tr_ast_pct')) && ctx.fieldGames && E.hcAssists) {
        try {
          const G = await ctx.fieldGames();
          if (G && G.length) {
            const k = G.map(g => g.id).sort().join(',');
            if (HC.key !== k) { HC.key = k; HC.map = E.hcAssists(G); }
            field.forEach(r => { const t = HC.map.get(r.id); r.hc_ast_pct = E.hcAstOf(t); r.tr_ast_pct = E.trAstOf ? E.trAstOf(t) : null; });
          }
        } catch (e) { if (root.console) root.console.warn('[report half-court AST%]', e); }
      }
      /* each player among the players of his position (report.js posRanker): one pool a group, and his own where the
         site's position groups put him elsewhere than his minutes do */
      const pools = E.posPools(field), byGroup = {};
      const rankerOf = (r, grp) => (pools.get(r.id) === grp
        ? (byGroup[grp] || (byGroup[grp] = E.posRanker(field, [...allKeys], grp, null, pools)))
        : E.posRanker(field, [...allKeys], grp, r.id, pools));
      /* the legend: every stat the cards print - an optional one (Synergy) only where a player has it */
      R.legend.push(...[...allKeys].filter(k => !(E.STATS[k] && E.STATS[k].optional) || squad.some(r => (E.hasStat ? E.hasStat(k, r) : E.isNum(r[k])))));
      const SL = ['PG', 'SG', 'SF', 'PF', 'C'];
      const needR = !rapmOk && [...allKeys].some(k => E.STATS[k] && E.STATS[k].rapm);
      const head = title('The squad', squad.length + ' players · most minutes first · each stat tinted by its percentile among the players of his own position in ' + (c.scope || 'the competition') + ' (guards, wings, bigs)') +
        (needR ? '<p class="rp-flagnote">ORAPM and DRAPM are not calculated for this league and season: they show blank (Calculate RAPM, above the pages).</p>' : '');
      const out = [];
      squad.forEach((r, i) => {
        const m = meta[r.id] || {};
        const pm = posMin.get(String(r.id));
        const tot = pm ? pm.reduce((a, b) => a + b, 0) : 0;
        const pct = tot > 0 ? pm.map(v => 100 * v / tot) : null;
        const grp = E.posGroup(pct, m.position);
        const Rk = rankerOf(r, grp);
        const top = pct ? pct.indexOf(Math.max(...pct)) : -1;
        const chips = pct ? pct.map((v, k) => v >= 1 ? '<span' + (k === top ? ' class="top"' : '') + '>' + SL[k] + ' ' + Math.round(v) + '%</span>' : '').join('') : (m.position ? '<span>' + esc(m.position) + '</span>' : '');
        const ph = m.photo_url ? '<span class="rp-ph"><img src="' + esc(m.photo_url) + '" alt="" crossorigin="anonymous" data-fb="' + esc(m.jersey ? m.jersey : (m.name || r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2)) + '"></span>'
          : '<span class="rp-ph"><b>' + esc((m.jersey ? m.jersey : (m.name || r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2))) + '</b></span>';
        const nm = m.name || r.name || 'Player';
        const prof = syn.get(String(r.id)) || null;
        /* his Synergy drives are in the shot profile's own runs (DRIVE L / R at the rim, mid-range, three: report.js synergyOnRow),
           and what his man shot at him in his defence group; a player with no file has neither */
        const groups = (E.groupsOn ? E.groupsOn(sets[grp], r) : sets[grp]).map(([t, ks]) => '<div class="rp-pg2"><h5>' + esc(t) + '</h5><div class="rp-cells">' + E.groupCellsHTML(ks, r, Rk) + '</div></div>').join('');
        const chart = prof && E.driveChartHTML ? E.driveChartHTML(prof, { compact: true }) : '';
        const mz = E.miniZonesHTML ? E.miniZonesHTML(shotsBy.get(String(r.id)) || []) : '';
        out.push(block((i === 0 ? head : '') + '<div class="rp-pcard"><div class="rp-pid">' + ph + '<div class="rp-pname">' + (m.jersey ? '#' + esc(m.jersey) + ' ' : '') + esc(nm) + '</div>' +
          '<div class="rp-pmeta">' + esc(grp) + ' · ' + (r.gp || 0) + ' gp · ' + f1(r.mpg) + ' mpg · ' + f1(r.ppg) + ' ppg</div>' +
          '<div class="rp-pvs">vs ' + Rk.n + ' ' + esc(Rk.who) + '</div>' +
          '<div class="rp-ppos">' + chips + '</div>' + chart + '</div>' +
          '<div class="rp-pgroups">' + (mz ? '<div class="rp-pside">' + mz + '</div>' : '') + groups + '</div></div>'));
      });
      return out;
    }
  };

  /* ---------------- DEPTH CHART ---------------- */
  /* the most-used fives as cards (teamviz.js), from the club's play-by-play records (lineupevents.js: the four factors at
     both ends, assisted baskets, where the shots came from), each number against the club's own over all its minutes */
  async function lineupBlock(c, n) {
    const T = await season();
    const X = LE();
    if (!T || !T.S || !X || !V) return null;
    const logs = await ctx.clubLogs(new Set((T.S.games || []).map(g => g.id)));
    if (!logs || !logs.recs || !logs.recs.length) return null;
    const base = X.line(X.sum(logs.recs));
    let floor = 10;
    const pick = () => X.units(logs.recs, 5).map(u => ({ ids: u.ids, line: X.line(u.acc) })).filter(u => u.line.mins >= floor).sort((a, b) => b.line.mins - a.line.mins);
    let units = pick();
    while (units.length < n && floor > 2) { floor = Math.floor(floor / 2); units = pick(); }
    units = units.slice(0, n);
    if (!units.length) return null;
    const meta = await ctx.meta([...new Set(units.flatMap(u => u.ids))]).catch(() => ({}));
    const names = {}; Object.keys(meta || {}).forEach(id => { names[id] = meta[id].name; });
    return { units, floor, html: V.lineupCards(units, base, { names }) };
  }
  const depth = {
    key: 'depth', title: 'Depth chart & lineups', page: 'DEPTH CHART', on: true,
    async build(c, R) {
      const X = root.EpinoiaDepth, Ro = root.EpinoiaRotation;
      const out = [];
      try {
        const d = await ctx.depth(false);
        if (d && d.c && V) out.push(block(title('Depth chart', 'each position’s minutes, split between the players who played there (darkest: the first choice)') +
          V.depthBars(d.c, { colour: c.accent }) +
          '<p class="rp-note">' + esc('Every five on the floor is ranked point guard to centre by the players’ positions, so a player who moves between positions is in each row; the striped end is everyone under 5%.') + '</p>'));
        else if (d && d.c && X && X.shareHTML) out.push(block(title('Depth chart', 'each player’s share of the minutes at each position') + '<div class="rp-dc">' + X.shareHTML(d.c, {}) + '</div>'));
      } catch (_) { /* without it */ }
      try {
        const L = await ctx.logs();
        if (Ro && L.gs.length) {
          const games = L.gs.filter(g => g.roster_snapshot && g.roster_snapshot.teams && Array.isArray(g.starters)).map(g => ({
            side: L.sideOf[g.id],
            model: Ro.compute({ status: 'final', period: g.period || 4, clockMs: 0, teams: g.roster_snapshot.teams, starters: g.starters, events: L.byG[g.id] || [] })
          }));
          if (games.length) {
            const M = Ro.season(games, c.name);
            try { const meta = await ctx.meta(M.teams[0].rows.map(r => r.pid).filter(Boolean)); M.teams[0].rows.forEach(r => { const mm = meta[r.pid]; if (mm && mm.name && mm.name !== 'Player') r.name = mm.name; }); } catch (_) { /* the snapshot's names */ }
            out.push(block(title('Rotations', games.length + ' games, regulation only · the average margin at each minute beneath') + '<div class="rp-rot">' +
              Ro.html(M, { colours: [c.accent || '#08603f', '#8a9a92'], marginLabel: 'average margin at each minute · above the line ' + c.name + ' ahead' }) + '</div>'));
          }
        }
      } catch (e) { if (root.console) root.console.warn('[report rotations]', e); }
      try {
        const LB = await lineupBlock(c, 6);
        if (LB) {
          /* a card a block, so the cards fill what the rotations left and run on to the next page whole */
          const d = E.frag(LB.html), cards = [...d.querySelectorAll('.tv-lu')], keyEl = d.querySelector('.tv-key');
          cards.forEach((cd, i) => out.push(block((i === 0 ? title('The most-used lineups', 'the ' + LB.units.length + ' fives with the most minutes together (' + LB.floor + '+) · every number coloured against the club over all its minutes') : '') +
            '<div class="tv tv-lus">' + cd.outerHTML + '</div>' + (i === cards.length - 1 && keyEl ? '<div class="tv">' + keyEl.outerHTML + '</div>' : ''))));
          R.legendExtra.push(['LINEUP CARDS', 'Each five’s offence (points per 100 possessions and the four factors), its defence (the four factors allowed) and how it plays (the share of its baskets made off a pass; rim, mid-range and three-point attempts per 100 possessions; three-point %). Each tile is coloured against the club over all its minutes: green better, red worse; blue a style. The small figure is the gap to the club.']);
        }
      } catch (e) { if (root.console) root.console.warn('[report lineups]', e); }
      R.legendExtra.push(['DEPTH CHART', 'Every five on the floor ranked point guard to centre by the players’ positions; each player’s share of the minutes at each position.'],
        ['ROTATIONS', 'Each player’s share of every minute across the club’s games, with the club’s average margin at each minute beneath.']);
      return out.length ? out : [block('<div class="rp-empty">No lineups for this club yet.</div>')];
    }
  };

  /* ---------------- COMBINATIONS & SHOT CLOCK ---------------- */
  const combos = {
    key: 'combos', title: 'Combinations & shot clock', page: 'COMBINATIONS', on: true, pack: true,
    async build(c, R) {
      const Ln = root.EpinoiaLineups, SCk = root.EpinoiaShotClock;
      const out = [];
      const T = await season().catch(() => null);
      const me = T && T.mine ? T.mine : {};
      try {
        const { st, meta } = await stints();
        let floor = 20, trios = Ln.sized(st, 3, floor).filter(t => E.isNum(t.net));
        while (trios.length < 10 && floor > 3) { floor = Math.floor(floor / 2); trios = Ln.sized(st, 3, floor).filter(t => E.isNum(t.net)); }
        if (trios.length) {
          trios.sort((a, b) => b.net - a.net);
          const best = trios.slice(0, 5), worst = trios.slice(-5).reverse().filter(t => best.indexOf(t) < 0);
          const td = (v, ref, low, sc) => '<td data-b="' + E.bandVs(v, ref, sc, low) + '">' + f1(v) + '</td>';
          const tbl = (rows, cap, cls) => '<div><div class="rp-cap ' + cls + '">' + cap + '</div><table class="rp-tbl rp-cmb"><thead><tr><th class="l">trio</th><th>min</th><th>ORTG</th><th>DRTG</th><th>NET</th></tr></thead><tbody>' +
            rows.map(t => '<tr><td class="l names">' + t.ids.map(id => esc(surname(nameOf(meta, id)))).join(', ') + '</td><td>' + Math.round(t.mins) + '</td>' +
              td(t.ortg, me.ortg, false, 5) + td(t.drtg, me.drtg, true, 5) + '<td class="rp-netc" data-b="' + E.bandVs(t.net, me.net, 6, false) + '">' + sg1(t.net) + '</td></tr>').join('') + '</tbody></table></div>';
          out.push(block(title('Combinations', 'trios with ' + floor + '+ minutes together, by net rating · coloured against the club’s own ratings') +
            '<div class="rp-two">' + tbl(best, 'The best five', 'good') + tbl(worst, 'The worst five', 'bad') + '</div>'));
        }
      } catch (e) { if (root.console) root.console.warn('[report combos]', e); }
      try {
        const L = await ctx.logs();
        if (SCk && L.gs.length && V) {
          const own = [], opp = [];
          L.gs.forEach(g => { const Rr = SCk.compute({ events: L.byG[g.id] || [] }); (Rr.chances || []).forEach(r => (r.team === L.sideOf[g.id] ? own : opp).push(r)); });
          const W = [['0–7 s', 0, 8], ['8–16 s', 8, 17], ['17–24 s', 17, 1e9]];
          const firsts = list => list.filter(r => !r.second && r.dur != null);
          const rowsOf = list => { const first = firsts(list); return W.map(([l, a, b]) => { const sub = first.filter(r => r.dur >= a && r.dur < b); return { label: l, n: sub.length, all: first.length, s: SCk.summary(sub), out: V.outcomesOf(sub) }; }); };
          out.push(block(title('Shot clock', 'every first chance of the last ' + L.gs.length + ' games by how long it ran · each coloured against the club’s (or its opponents’) average') +
            V.shotClock(rowsOf(own), rowsOf(opp), SCk.summary(firsts(own)), SCk.summary(firsts(opp))) +
            '<p class="rp-note">Points a possession, and its share of the possessions as the bar; the chips are its shooting (eFG), turnovers (TO), offensive rebounds (OREB) and free-throw rate (FTr). Second chances after an offensive rebound are left out, so each is how the first look ended.</p>'));
          /* THE SAME FROM THE DEFENCE'S SIDE (2026-10-03), underneath: the opponents' first chances against the club */
          out.push(block(title('Shot clock · defence', 'the same first chances from the other end: what the opponents did against the club by how long their possession ran · each coloured against the club’s defence over every possession') +
            V.shotClockDef(rowsOf(opp), SCk.summary(firsts(opp))) +
            '<p class="rp-note">Points a possession the opponents scored, and their share of the possessions as the bar; the chips are their shooting (eFG), the turnovers the defence forced (TO), the share of their misses it rebounded (DREB) and their free-throw rate (FTr), green where it is better for the club. Underneath, every first chance by how it ended: a basket, free throws alone, a miss they won back, a turnover or a stop.</p>'));
          R.legendExtra.push(['SHOT CLOCK', 'Possessions grouped by how long they ran: early offence (0–7 seconds), the middle of the clock (8–16) and late (17–24).'],
            ['SHOT CLOCK · DEFENCE', 'The opponents’ possessions against the club, grouped the same way, and how each first chance ended: a basket, free throws alone, a miss they won back, a turnover or a stop.'],
            ['PPP', 'Points per possession.']);
        }
      } catch (e) { if (root.console) root.console.warn('[report shot clock]', e); }
      return out.length ? out : [block('<div class="rp-empty">No play-by-play for this club yet.</div>')];
    }
  };

  const week = {
    key: 'week', title: 'Last 7 days', page: 'LAST 7 DAYS', on: false,
    async build() {
      const W = root.EpinoiaWeekly;
      if (!W || !ctx.week) return [];
      const rep = await ctx.week();
      return [block(W.render(rep, { window: 'the last seven days', saveable: false }))];
    }
  };
  const legend = { key: 'legend', title: 'Legend', on: true };
  return [cover, main, shots, players, depth, combos, week, legend];
}

return { modules, TEAM_STATS };
}));
