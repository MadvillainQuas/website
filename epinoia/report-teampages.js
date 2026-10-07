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
     CLUTCH           (clutch.js: the last four minutes of the fourth and overtime, within five) every player's free throws
                      with a career figure entered by hand (0238), the clutch ratings, the players' clutch usage and true
                      shooting as a chart, the clutch shot card and the fives with the most clutch time
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
/* A UNIT'S RATING (starters, bench, against either) is drawn as every other row is: a bar from the left, how far along the league's range it
   sits, and its place. The field is the league's clubs' own season ratings of that kind (net, offence, defence): a unit is placed among
   them as if it were a club, which is the mark the tiles above are judged by. Worked out in main's build (splitFor). */
const SPLIT = (l, ref, low) => ({ l, dp: 1, signed: ref === 'net', low: !!low });
const TEAM_STATS = {
  ff_efg: { l: 'eFG%', dp: 1 }, ff_tov: { l: 'TOV%', dp: 1, low: true }, ff_oreb: { l: 'OREB%', dp: 1 }, ff_ftr: { l: 'FTr', dp: 1 },
  dff_efg: { l: 'OPP eFG%', dp: 1, low: true }, dff_tov: { l: 'OPP TOV%', dp: 1 }, dff_oreb: { l: 'OPP OREB%', dp: 1, low: true }, dff_ftr: { l: 'OPP FTr', dp: 1, low: true },
  ortg: { l: 'ORTG', dp: 1 }, drtg: { l: 'DRTG', dp: 1, low: true }, net: { l: 'NET', dp: 1, signed: true }, pace: { l: 'PACE', dp: 1, style: true },
  ft_pct: { l: 'FT%', dp: 1 }, ts: { l: 'TS%', dp: 1 }, opp_ts: { l: 'OPP TS%', dp: 1, low: true },
  tm_ppp: { l: 'PTS / POSSESSION', dp: 2 }, tm_oppp: { l: 'OPP PTS / POSSESSION', dp: 2, low: true }, ast_sh_all: { l: 'AST% (ALL BASKETS)', dp: 1, style: true },
  tsa_for: { l: 'TSA A GAME', dp: 1 }, tsa_vs: { l: 'TSA ALLOWED A GAME', dp: 1, low: true }, tsa_gap: { l: 'TRUE SHOTS GAP', dp: 1, signed: true },
  ev_half_pts_sh: { l: 'HALF-COURT %PTS', dp: 1, style: true }, evd_half_pts_sh: { l: 'DEF HALF-COURT %PTS', dp: 1, style: true },
  /* the CLUB's half-court AST% has a key of its own: hc_ast_pct is the player's (his share of teammates' half-court baskets he
     assisted, ranked among his position on the squad's cards), and one key for both blanked the players' ranking. Ranked among
     the clubs as a style, like AST% of all baskets (2026-10-07: it was drawn as the gap to that, from the middle) */
  tm_hc_ast_pct: { l: 'HALF-COURT AST%', dp: 1, style: true },
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
  ['rim_astp', 'RIM ASSISTED%', 'rim baskets made off a pass', 1, 'lo', 'style'],
  ['rim_ptsh', 'RIM SHARE OF PAINT POINTS', 'paint points scored right at the rim', 1, 'hi', 'lo'],
  ['paint_att100', 'PAINT / 100', 'the rest of the paint (not at the rim)', 1, 'style', 'style'],
  ['paint_fg', 'PAINT FG%', 'how many of them go in', 1, 'hi', 'lo'],
  ['paint_astp', 'PAINT ASSISTED%', 'paint baskets made off a pass', 1, 'lo', 'style'],
  ['mid_att100', 'MID / 100', 'two-point jumpers outside the paint', 1, 'style', 'style'],
  ['mid_fg', 'MID FG%', 'how many of them go in', 1, 'hi', 'lo'],
  ['mid_astp', 'MID ASSISTED%', 'mid-range baskets made off a pass', 1, 'lo', 'style'],
  ['three_att100', '3PT / 100', 'threes, per 100 possessions', 1, 'style', 'lo'],
  ['three_fg', '3PT%', 'how many of them go in', 1, 'hi', 'lo'],
  ['three_astp', '3PT ASSISTED%', 'threes made off a pass', 1, 'lo', 'style'],
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
  tm_hc_ast_pct: ['Half-court assist %', 'Of the club’s half-court baskets, the share that were assisted (the play-by-play of every game in the scope), ranked among the clubs as a style: a deeper bar is more of its half-court scoring made off a pass.'],
  ev_half_tov_pct: ['Half-court turnover %', 'Turnovers per half-court chance. Lower is better.'],
  evd_half_tov_pct: ['Opponents’ half-court turnover %', 'Turnovers the club forces per half-court chance. Higher is better.'],
  ev_half_efg: ['Half-court eFG%', 'Effective field-goal percentage in the half court.'], evd_half_efg: ['Opponents’ half-court eFG%', 'Lower is better.'],
  ev_half_ppp: ['Half-court points per chance', 'Points per half-court chance (a trip ending in a shot, a turnover or free throws).'],
  evd_half_ppp: ['Opponents’ half-court points per chance', 'Lower is better.'],
  ev_transition_pts_sh: ['Transition share of points', 'The share of the club’s points scored in transition.'],
  tr_def_delta: ['Transition points given up against the opponents’ own average', 'Transition points a game opponents scored against the club, minus what the same opponents average in transition over the season. Below zero, the club gives up fewer than those opponents usually score.'],
  ev_transition_ppp: ['Transition points per chance', 'Points per transition chance.'], evd_transition_ppp: ['Opponents’ transition points per chance', 'Lower is better.'],
  vs_start_net: ['Against the starters', 'Net, offensive and defensive rating in the minutes the other side had four or more of its regular starters on (a regular starter: ten starts or more in the scope, or that game’s starters). The bar is where that rating would sit among the league’s clubs (net, offence or defence over the season): the fuller and the greener, the better.'],
  vs_bench_net: ['Against the bench', 'The same ratings in every other minute, placed among the league’s clubs.'],
  own_start_net: ['Our starters', 'Net, offensive and defensive rating in the minutes the club had four or more of its own regular starters on (the five who started most when fewer than five have ten starts), placed among the league’s clubs.'],
  own_bench_net: ['Our bench', 'The same ratings in every other minute of the club’s, placed among the league’s clubs.'],
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
/* THE PLACE IS AMONG THIS SEASON'S CLUBS (Louie, 2026-10-07): an earlier season's rows (report.js priorRows, __prior) deepen the
   field the bars and colours are ranked in, but "4th of 10" counts the clubs of the season shown */
function rankOf(teams, k, id, low) {
  const vals = teams.filter(t => !t.__prior && t[k] != null && t[k] !== '' && isFinite(+t[k]));
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

  /* every chance of the club's games timed once (shotclock.js): the club's own and its opponents' */
  let clockP = null;
  const clockChances = () => clockP || (clockP = (async () => {
    const SCk = root.EpinoiaShotClock, L = await ctx.logs();
    const own = [], opp = [];
    if (SCk) L.gs.forEach(g => { const Rr = SCk.compute({ events: L.byG[g.id] || [] }); (Rr.chances || []).forEach(r => (r.team === L.sideOf[g.id] ? own : opp).push(r)); });
    return { L, own, opp, SCk };
  })().catch(e => { clockP = null; throw e; }));

  /* HOW POSITIONS ARE WORKED OUT (depth.js, bpm.js): said in the depth chart and the most-used five, which are built from it */
  const POS_KEY = [
    ['THE ESTIMATE', 'Each player gets a position from 1 (point guard) to 5 (centre) from how they play in the box score: their rebounds, assists, steals, blocks and threes, the way Basketball-Reference’s BPM does it. It is blended with the position their club lists for them and their height until they have played enough.'],
    ['THE FIVE ON THE FLOOR', 'Every group of five is lined up from the smallest to the biggest, and its players are credited PG, SG, SF, PF and C in that order for the time they play together. A player’s minutes at each position are what those credits add up to.'],
    ['SO A PLAYER CAN HAVE SEVERAL', 'Someone who plays big in one lineup and small in another is credited in each. A chart like this one is the record of who has actually filled each spot.'],
    ['IT CAN BE OFF', 'It is an estimate from numbers, not a coach’s label: a small centre or a big guard can be put a spot away from where the club thinks of them.']];
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
        '<p class="rp-note">Each spot names the player with the most minutes there this season (the depth chart’s first choice). A player who leads two positions is named once, at the one they play most; the other spot takes the next player in its depth chart. Positions are an estimate: each player is placed from 1 (point guard) to 5 (centre) by how they play in the box score (BPM’s method), blended with their listed position and height, and each five on the floor is lined up smallest to biggest, so a spot can be off by one.</p>';
    }
  };

  /* ---------------- MAIN STATS ---------------- */
  /* one game's half-court baskets at each end, and how many were assisted: [{ m, a }, { m, a }] (null without the modules) */
  function hcGame(evs) {
    const SI = root.EpinoiaSituations;
    if (!SI || !SI.stamps || !SI.assistedShots || !SI.inGameOrder || !evs || !evs.length) return null;
    const all = SI.inGameOrder(evs);
    const desc = SI.describe ? SI.describe(all) : { tags: {} };
    const plays = all.filter(e => e && !/^(loc|stype|tag|tags)$/.test(e.t));
    const st = SI.stamps(plays, desc.tags);
    const A = SI.assistedShots(plays).assisted;
    const out = [{ m: 0, a: 0 }, { m: 0, a: 0 }];
    plays.forEach(e => {
      if (!(e.team === 0 || e.team === 1) || !(e.t === 'p2_made' || e.t === 'p3_made')) return;
      const s = st.get(e);
      if (!s || s.second || s.offTo || s.transition) return;
      out[e.team].m++; if (A.has(e)) out[e.team].a++;
    });
    return out;
  }
  async function halfCourtAst(flip) {
    const L = await ctx.logs();
    let made = 0, ast = 0;
    L.gs.forEach(g => {
      let r = null;
      try { r = hcGame(L.byG[g.id] || []); } catch (_) { r = null; }
      if (!r) return;
      const side = flip ? 1 - L.sideOf[g.id] : L.sideOf[g.id];
      made += r[side].m; ast += r[side].a;
    });
    return made ? Math.round(1000 * ast / made) / 10 : null;
  }
  /* EVERY CLUB'S HALF-COURT AST% (Louie, 2026-10-07: a bar among the clubs like the rest, not the gap to its own assisted share):
     the scope's games with their logs (ctx.fieldGames, read once and shared with the players' cards), each side's baskets summed
     onto its club. A club with fewer than HC_TEAM_MIN half-court baskets is left blank */
  const HC_TEAM_MIN = 20;
  async function hcTeams(games) {
    const G = ctx.fieldGames ? await ctx.fieldGames().catch(() => null) : null;
    if (!G || !G.length) return null;
    const sideIds = new Map((games || []).map(g => [g.id, [g.home_team_id, g.away_team_id]]));
    const out = new Map();
    G.forEach(g => {
      const ids = sideIds.get(g.id);
      if (!ids) return;
      let r = null;
      try { r = hcGame(g.events || []); } catch (_) { r = null; }
      if (!r) return;
      [0, 1].forEach(i => { if (!ids[i]) return; const o = out.get(ids[i]) || { m: 0, a: 0 }; o.m += r[i].m; o.a += r[i].a; out.set(ids[i], o); });
    });
    return out;
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
      let teams = S.teams.map(r => Object.assign({}, r));
      const me = teams.find(r => r.id === mine.id);
      deriveTeams(teams, S.games);
      /* A SINGLE GAME (c.vs, game/analysis.js): both clubs on the same footing, the same figures for each, its own of
         the game, ranked and coloured as that club's against the competition's clubs over the season (not one club's
         offence against what it allowed: in one game what one allowed is the other's own) */
      const them = c.vs ? teams.find(r => r.id === c.vs.bid) || null : null;
      try { me.tm_hc_ast_pct = await halfCourtAst(); if (them) them.tm_hc_ast_pct = await halfCourtAst(true); } catch (_) { /* without it */ }
      /* every other club's over the scope's games (a single game's two clubs keep this game's own), so the club's is ranked
         among them; the club's own is taken from the same games where it has enough there */
      try {
        const HT = await hcTeams(S.games);
        if (HT) teams.forEach(r => {
          if (r === them) return;
          const t = HT.get(r.id), v = t && t.m >= HC_TEAM_MIN ? Math.round(1000 * t.a / t.m) / 10 : null;
          if (r === me) { if (!c.vs && v != null) r.tm_hc_ast_pct = v; } else r.tm_hc_ast_pct = v;
        });
      } catch (e) { if (root.console) root.console.warn('[report half-court AST%]', e); }
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
      /* THE FIELD IS EVERY SEASON OF THE LEAGUE the page has data for (report.js loadPrior): each club's season is one entry, the
         seasons shown among them, so "4th of 38" rests on more than ten clubs. A figure an earlier season's rows do not carry
         (the shot zones, the half-court assists) is ranked among the season shown alone. */
      const priorTeams = E.priorRows(T.prior, P => P.teams, (rows, P) => deriveTeams(rows, P.games));
      if (priorTeams.length) { teams = teams.concat(priorTeams); R.pooled = 'The bars and colours rank every figure against all ' + ((T.prior || []).length + 1) + ' seasons of the league with data (each club’s season is one entry, ' + teams.length + ' in all), for a deeper field; a place such as “4th of 10” counts only this season’s clubs. A stat an earlier season did not record is ranked within the season shown.'; }
      /* THE LEAGUE'S MARKS for the three ratings: the clubs' own season net, offensive and defensive ratings, among which a starting five or a
         bench is placed (splitFor): its percentile among every season's (smaller is better for defence), its place among this season's */
      const LGR = {}, LGRnow = {};
      ['net', 'ortg', 'drtg'].forEach(k => { LGR[k] = teams.map(r => +r[k]).filter(x => isFinite(x)); LGRnow[k] = teams.filter(r => !r.__prior).map(r => +r[k]).filter(x => isFinite(x)); });
      const SPB = {};
      ['vs_start', 'vs_bench', 'own_start', 'own_bench'].forEach(pre => { SPB[pre + '_net'] = 'net'; SPB[pre + '_ortg'] = 'ortg'; SPB[pre + '_drtg'] = 'drtg'; });
      const splitFor = (k, row) => {
        const b = SPB[k], arr = b ? LGR[b] : null, v = row ? +row[k] : NaN;
        if (!arr || arr.length < 3 || !isFinite(v)) return null;
        const low = b === 'drtg', worse = arr.filter(x => (low ? x > v : x < v)).length, tie = arr.filter(x => x === v).length;
        const now = LGRnow[b] || [], better = now.filter(x => (low ? x < v : x > v)).length;
        return { pct: Math.round(100 * (worse + tie / 2) / arr.length), place: Math.min(better + 1, Math.max(1, now.length)), n: now.length, avg: arr.reduce((a, c) => a + c, 0) / arr.length };
      };
      /* the field named in the titles: this season's clubs, and where earlier seasons deepen it, how many entries the bars use */
      const N = teams.filter(r => !r.__prior).length;
      const POOL = priorTeams.length ? ' clubs this season, bars and colours across ' + ((T.prior || []).length + 1) + ' seasons' : ' clubs in the league';
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
      const out = [block(title('Four factors', them ? 'the same figures for both clubs, this game · each coloured by its place among the ' + N + POOL + ' over the season'
        : [c.scope, 'own and allowed · the chip is the place among the ' + N + POOL + ''].filter(Boolean).join(' · ')) + ffHTML + tileHTML + E.keyHTML('Reading the chips', [
        ['THE CHIP · THE BAR', 'A place such as “4th of 10” is the club’s rank in the field named above (' + N + POOL + '), where first is the best end of the stat: green the top quarter, red the bottom. A blue-to-purple bar is a style, ranked by most: deeper = more of it, neither good nor bad.']], 'one'))];
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
      const Rk0 = E.ranker(teams, keys);
      const rowOfId = id => (me && me.id === id ? me : them && them.id === id ? them : null);
      /* a unit's rating is placed among the league's clubs; every other key is ranked as before */
      const Rk = { n: Rk0.n,
        pct: (k, id) => { if (!SPB[k]) return Rk0.pct(k, id); const u = splitFor(k, rowOfId(id)); return u ? u.pct : null; },
        avg: k => { if (!SPB[k]) return Rk0.avg(k); const u = splitFor(k, me); return u ? u.avg : null; } };
      const placeOf = row => k => { if (SPB[k]) { const u = splitFor(k, row); return u ? E.ordinal(u.place) + '/' + u.n : null; }
        const s = E.STATS[k] || {}; const r = rankOf(teams, k, row.id, s.low); return r ? E.ordinal(r.r) + '/' + r.n : null; };
      R.legend.push(...keys);
      /* a group's parts each read from a row: the part's own (a single game's two clubs), the group's, or the club's */
      const groupHTML = ([t, parts, row]) => '<div class="rp-g rp-gx"><h4>' + esc(t) + '</h4>' +
        parts.map(([side, ks, prow]) => { const r = prow || row || me;
          return '<div class="rp-gs ' + side + '"><span class="rp-gs-t">' + esc(/STARTERS/.test(t) && SIDE_RT[side] ? SIDE_RT[side] : SIDE[side]) + '</span>' +
            ks.map(k => E.statRowHTML(k, r, Rk, { place: row ? null : placeOf(r), label: k2 => SHORT[k2] })).join('') + '</div>'; }).join('') + '</div>';
      /* two blocks: the club's own season, then the starters and the bench (a page of their own when the first fills one) */
      /* explicit columns (the PDF's renderer does not lay out CSS columns): the half court beside efficiency and
         transition, which balance it; against the other side's starters and bench beside the club's own */
      const cols = (l, r, lx) => '<div class="rp-cols"><div>' + l.map(groupHTML).join('') + (lx || '') + '</div><div>' + r.map(groupHTML).join('') + '</div></div>';
      /* THE GAP UNDER THE HALF COURT: how long the club's possessions run, at each end (shotclock.js, every first chance of the
         scope's games with a timed start). No other club's is timed, so it is not ranked: it says which way it leans. */
      let tempoHTML = '';
      if (!them) {
        try {
          const K = await clockChances();
          const firsts = l => l.filter(r => !r.second && r.dur != null);
          const so = K.SCk && K.SCk.summary ? K.SCk.summary(firsts(K.own)) : null, sd = K.SCk && K.SCk.summary ? K.SCk.summary(firsts(K.opp)) : null;
          const ov = so && E.isNum(so.avgDur) ? +so.avgDur : null, dv = sd && E.isNum(sd.avgDur) ? +sd.avgDur : null;
          if (ov != null || dv != null) {
            const row = (lab, v, note) => '<div class="rp-st" data-b="9"><span class="rp-st-l">' + lab + '</span><span class="rp-st-v">' + (v == null ? '—' : v.toFixed(1) + '<small>s</small>') + '</span>' +
              '<span class="rp-st-bar"><i style="width:' + (v == null ? 0 : Math.max(3, Math.min(100, v / 24 * 100))).toFixed(1) + '%"></i></span><span class="rp-st-p"></span><span class="rp-st-a">' + note + '</span></div>';
            tempoHTML = '<div class="rp-g rp-gx"><h4>TEMPO <span>average time of possession</span></h4>' +
              '<div class="rp-gs o"><span class="rp-gs-t">Seconds a possession lasts</span>' + row('OFFENCE', ov, 'own') + row('DEFENCE', dv, 'opponents') + '</div></div>';
            R.legendExtra.push(['TEMPO', 'How long a possession of the club’s runs (offence) and how long the opponents’ run against it (defence), averaged over every possession whose start could be timed from the play-by-play. Second chances after an offensive rebound are left out.']);
          }
        } catch (e) { if (root.console) root.console.warn('[report tempo]', e); }
      }
      out.push(block(title(them ? 'Game line' : 'Season line', them ? 'the same figures for both clubs · the bar and its colour: each club’s place among the ' + N + POOL + ' over the season (green the top quarter, red the bottom)'
        : 'the bar and its colour: the club’s place among the ' + N + POOL + ' (green the top quarter, red the bottom)') +
        cols([groups[1]], [groups[0], groups[2]], tempoHTML) + E.keyHTML('Reading the season line', [
          ['PTS v OPP AVERAGE', 'The transition points the club gives up a game, minus what those same opponents usually score in transition against everyone else. It takes the opposition out of the number: below zero means the club defends the break better than the others do.'],
          ['AST%', 'The share of the club’s half-court baskets that were assisted, ranked among the clubs: a style (blue to purple), deeper where more of its half-court scoring comes off a pass against a set defence.']], 'one')));
      /* a single game: each club's starters and its bench, side by side, each against that club over the game */
      const sb = (name, row) => [(name + ' starters & bench').toUpperCase(), [['n', ['own_start_net', 'own_bench_net']], ['o', ['own_start_ortg', 'own_bench_ortg']], ['d', ['own_start_drtg', 'own_bench_drtg']]], row];
      out.push(block(title('Starters and bench', 'ratings per 100 possessions · each placed among the league’s ' + N + POOL + ' as a club’s own rating is (green the top quarter, red the bottom)') +
        (them ? cols([sb(c.vs.as, me)], [sb(c.vs.bs, them)]) : cols([groups[3]], [groups[4]])) + E.keyHTML('Reading starters and bench', [
          ['REGULAR STARTERS', 'A regular starter is a player with ten starts or more in the scope (the five who started most when fewer than five have). “Starters” is every minute four or more of them were on the floor; “bench” is every other minute.'],
          ['THE BAR', 'Like every other bar: where the unit’s rating would rank among the league’s clubs for that rating, green the top quarter, red the bottom. The figure to its right is the league’s average.']], 'one')));
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
        out.push(block(title('Shot distribution', (them ? 'where each club’s shots came from and how they went in · its place among the ' + N + POOL + '' : 'where the shots come from and how they go in, at both ends · the club’s place among the ' + N + POOL + '') + ' (blue to purple: a style, deeper the more of it)') +
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
          out.push(block(title('Rebounds analysis', (them ? 'what became of every shot each club took, by zone' : 'what became of every shot attempt, by zone, at both ends') + ' \u00b7 the colour is the club\u2019s place among the ' + N + POOL + '') +
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
          out.push(block(title('True shots gap', 'true shooting attempts (TSA) a game, the club’s and its opponents’ · the colour and the chip: the club’s place among the ' + N + POOL + '') +
            V.trueShots(TS, { bands: { own: bandOf('tsa_for'), vs: bandOf('tsa_vs'), gap: bandOf('tsa_gap') }, ranks: { own: placeOf('tsa_for'), vs: placeOf('tsa_vs'), gap: placeOf('tsa_gap') } }) +
            E.keyHTML('Why true shot attempts matter', [
              ['TSA', 'True shooting attempts: shots taken plus 0.44 of each free throw attempt. It counts the scoring chances a team actually used, free throws included.'],
              ['THE GAP', 'The club’s TSA a game minus its opponents’. A positive gap means it gets more chances than it gives.'],
              ['WHY IT MATTERS', 'Shooting well wins games, but so does shooting MORE: every extra chance comes from forcing turnovers, winning offensive rebounds or drawing fouls.'],
              ['HOW TO USE IT', 'A big negative gap means the club is giving the ball away or being out-rebounded: attack that, and it has to shoot unusually well to win.']]), 'rp-tsa'));
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
        '<table class="rp-tbl rp-zt rp-zz"><colgroup><col class="z">' + '<col>'.repeat(6) + '<col class="be"></colgroup><thead>' +
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
      /* the field to rank in: this season's players and the league's other seasons' (report.js loadPrior), each season one more entry */
      const poolField = field.concat(E.priorRows(T.prior, P => P.players));
      if (poolField.length > field.length) R.pooled = 'Every figure is ranked against all ' + ((T.prior || []).length + 1) + ' seasons of the league with data (each player’s season is one entry), among players of their own position, not only the season shown. A stat an earlier season did not record is ranked within the season shown.';
      const pools = E.posPools(poolField), byGroup = {};
      const rankerOf = (r, grp) => (pools.get(r.id) === grp
        ? (byGroup[grp] || (byGroup[grp] = E.posRanker(poolField, [...allKeys], grp, null, pools)))
        : E.posRanker(poolField, [...allKeys], grp, r.id, pools));
      /* the legend: every stat the cards print - an optional one (Synergy) only where a player has it */
      R.legend.push(...[...allKeys].filter(k => !(E.STATS[k] && E.STATS[k].optional) || squad.some(r => (E.hasStat ? E.hasStat(k, r) : E.isNum(r[k])))));
      const SL = ['PG', 'SG', 'SF', 'PF', 'C'];
      const needR = !rapmOk && [...allKeys].some(k => E.STATS[k] && E.STATS[k].rapm);
      const head = title('The squad', squad.length + ' players · most minutes first · each stat tinted by its percentile among the players of their own position in ' + (c.scope || 'the competition') + ' (guards, wings, bigs)') +
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
        const chart = (prof && E.driveChartHTML ? E.driveChartHTML(prof, { compact: true }) : '') || (E.shotMixHTML ? E.shotMixHTML(r) : '');
        const mz = E.miniZonesHTML ? E.miniZonesHTML(shotsBy.get(String(r.id)) || []) : '';
        out.push(block((i === 0 ? head : '') + '<div class="rp-pcard"><div class="rp-pid">' + ph + '<div class="rp-pname">' + (m.jersey ? '#' + esc(m.jersey) + ' ' : '') + esc(nm) + '</div>' +
          '<div class="rp-pmeta">' + esc(grp) + ' · ' + (r.gp || 0) + ' gp · ' + f1(r.mpg) + ' mpg · ' + f1(r.ppg) + ' ppg</div>' +
          '<div class="rp-pvs">vs ' + (Rk.nNow || Rk.n) + ' ' + esc(Rk.who) + (Rk.nNow && Rk.nNow < Rk.n ? ' this season' : '') + '</div>' +
          '<div class="rp-ppos">' + chips + '</div>' + chart + '</div>' +
          '<div class="rp-pgroups">' + (mz ? '<div class="rp-pside">' + mz + '</div>' : '') + groups + '</div></div>'));
      });
      out.push(E.keyBox('Reading a player card', [
        ['THE TILES', 'Each tile is the number and their percentile among the players of their own position in the field named above. Green is the top quarter, red the bottom; blue-to-purple tiles are styles, deeper = more of it.'],
        ['ASSIST TO USAGE RATIO', 'Their assist rate against their usage: how much they create for others per possession they use themselves.'],
        ['VOL / 100', 'Shots from that zone per 100 of the team’s possessions while they are on the floor: where they shoot, not how well, so it is not inflated by minutes or pace.'],
        ['ASSISTED%', 'The share of their baskets in a zone that came off a pass. Coloured the other way round: a low share (green) means they create their own shots there.'],
        ['HALF-COURT FIGURES', 'Leave out fast breaks, second chances and shots off turnovers: how they do against a set defence.'],
        ['SHOT MIX', 'Where there is no Synergy file: bar length is how often they shoot from the rim, mid-range or three, the solid part how often it goes in.'],
        ['± (ON/OFF)', 'The team’s figure with them on the floor minus with them off it. Noisy for a player with few minutes.'],
        ['THE CORNER COURT', 'Orange: they shoot better than break-even from that zone. Blue: worse. Grey: too few shots.']]));
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
      if (out.length) out.splice(1, 0, E.keyBox('How a player is put at a position', POS_KEY));
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
        const { L, own, opp } = await clockChances();
        if (SCk && L.gs.length && V) {
          const W = [['0–7 s', 0, 8], ['8–16 s', 8, 17], ['17–24 s', 17, 1e9]];
          const firsts = list => list.filter(r => !r.second && r.dur != null);
          const rowsOf = list => { const first = firsts(list); return W.map(([l, a, b]) => { const sub = first.filter(r => r.dur >= a && r.dur < b); return { label: l, n: sub.length, all: first.length, s: SCk.summary(sub), out: V.outcomesOf(sub) }; }); };
          /* THE CLUB'S OWN CHANCES ONLY (2026-10-06): the opponents' are the next page, Shot clock · defence */
          out.push(block(title('Shot clock', 'every first chance of the last ' + L.gs.length + ' games by how long it ran · each coloured against the club’s average') +
            V.shotClock(rowsOf(own), null, SCk.summary(firsts(own)), null) +
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

  /* ---------------- CLUTCH ---------------- */
  /* CLUTCH (Louie, 2026-10-07): clutch time worked out from the play-by-play by one rule (clutch.js: the last four minutes of
     the fourth quarter and overtime, within five points), and the page in four parts, top to bottom:
       FREE THROWS      every player's free-throw % this season as a bar, their clutch free throws as a dot and a CAREER figure
                        as a diamond: a number from outside the platform (college, other leagues) entered by hand above the
                        pages and kept in player_career_ft (0238), so the PRIME REPORT and the emailed copy draw it too
       RATINGS          the club's clutch offence, defence and net, each against its own over every minute; its clutch record
       USAGE AND TS%    each player's share of the plays in clutch time against how well they scored them, as a chart
       SHOTS AND FIVES  the clutch shot card (the half-court and transition pages' card, report.js sitCardHTML), and the fives
                        that played the most clutch time with their net rating */
  const CFT = { local: new Map(), cache: new Map(), unkept: new Set() };
  async function cftClient() {
    try {
      if (typeof root.epinoiaMaybeSignedIn === 'function' && !root.epinoiaMaybeSignedIn()) return null;
      if (typeof root.epinoiaClientReady === 'function') return await root.epinoiaClientReady();
      return typeof root.epinoiaClient === 'function' ? root.epinoiaClient() : null;
    } catch (_) { return null; }
  }
  /* the career figures of these players: entered on this page first, then kept ones (readable by anyone, so the mailer's copy
     reads them as the page does). stored: the kept ones only, read again (the PRIME REPORT's check) */
  async function careerFt(ids, stored) {
    const out = new Map(), need = [];
    (ids || []).forEach(id => {
      const k = String(id);
      if (!stored && CFT.local.has(k)) { const v = CFT.local.get(k); if (v) out.set(k, v); }
      else if (!stored && CFT.cache.has(k)) { const v = CFT.cache.get(k); if (v) out.set(k, v); }
      else need.push(k);
    });
    if (!need.length) return out;
    const D = root.EpinoiaData, q = 'player_career_ft?player_id=in.(' + need.join(',') + ')&select=player_id,ft_pct,ftm,fta,note';
    let rows = null;
    /* a read that fails (the table not there yet, offline) leaves the figures entered on this page standing; only the
       PRIME REPORT's check (stored) needs to hear of it */
    try {
      if (D && D.all) rows = await D.all(q);
      else {
        const CFG = root.EPINOIA_CONFIG;
        if (!CFG || !root.fetch) return out;
        const r = await root.fetch(CFG.supabaseUrl + '/rest/v1/' + q, { headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        rows = await r.json();
      }
    } catch (e) { if (stored) throw e; return out; }
    need.forEach(k => CFT.cache.set(k, null));
    (rows || []).forEach(r => {
      if (!E.isNum(r.ft_pct)) return;
      const v = { pct: +r.ft_pct, ftm: E.isNum(r.ftm) ? +r.ftm : null, fta: E.isNum(r.fta) ? +r.fta : null, note: r.note || '' };
      CFT.cache.set(String(r.player_id), v);
      out.set(String(r.player_id), v);
    });
    return out;
  }
  /* the squad of the scope, with their names */
  async function squadOf() {
    const T = await season();
    if (!T || !T.S || !T.mine) return null;
    const sq = T.S.players.filter(r => r.teamId === T.mine.id && +r.gp > 0);
    const meta = await ctx.meta(sq.map(r => r.id)).catch(() => ({}));
    const nm = r => (meta[r.id] && meta[r.id].name) || r.name || 'Player';
    return { T, sq, meta, nm };
  }
  /* a number as somebody types it on any page: '82.5', '82,5' (a Spanish page shows a decimal comma), '' for nothing */
  const typed = s => { const t = String(s == null ? '' : s).trim().replace(',', '.'); return t === '' ? null : isFinite(+t) ? +t : NaN; };
  /* THE BEST GUESS AT A FREE-THROW SHOOTER: this season's makes and attempts, with the career figure added in as so many more
     attempts at its percentage (its own attempts where they were entered, 100 where only the percentage was, capped at 300 so a
     long career does not bury this season). With no career figure it is this season's own */
  const CAREER_W = 100, CAREER_CAP = 300;
  function ftGuess(ftm, fta, car) {
    if (!car || !E.isNum(car.pct)) return fta > 0 ? 100 * ftm / fta : null;
    const w = Math.min(CAREER_CAP, E.isNum(car.fta) && car.fta > 0 ? car.fta : CAREER_W);
    return 100 * (ftm + w * car.pct / 100) / (fta + w);
  }

  const clutch = {
    key: 'clutch', title: 'Clutch', page: 'CLUTCH', on: true,
    controls(host, state) {
      const row = E.el('div', 'rp-rapm rp-syn rp-cft');
      const btn = E.el('button', 'ep-btn mini', 'Career FT%'); btn.type = 'button';
      btn.title = 'Enter a player’s free-throw % over their career: drawn beside this season’s on the Clutch page';
      const say = E.el('span', null, 'each player’s career free-throw % (college, other leagues), drawn beside this season’s on the Clutch page');
      const box = E.el('div', 'rp-syn-box'); box.hidden = true;
      row.append(E.el('span', 'rp-k', 'Clutch'), btn, say);
      host.append(row, box);
      const close = () => { box.hidden = true; box.textContent = ''; };
      /* PRIME REPORT: the career figures READ BACK from player_career_ft, where the emailed reports find them */
      (state.primers = state.primers || []).push(async () => {
        const Q = await squadOf().catch(() => null);
        if (!Q || !Q.sq.length) return null;
        const ids = Q.sq.map(r => String(r.id));
        let kept;
        try { kept = await careerFt(ids, true); } catch (_) { return { ok: !ids.some(k => CFT.unkept.has(k)), text: 'the career free-throw figures could not be read back' }; }
        const only = ids.filter(k => CFT.unkept.has(k) && CFT.local.get(k)).length;
        return { ok: !only, text: (kept.size ? 'career FT% kept for ' + kept.size + ' of ' + ids.length + ' players' : 'no career FT% kept for these players') +
          (only ? '; ' + only + ' on this page only, not kept' : '') };
      });
      btn.onclick = async () => {
        if (!box.hidden) { close(); return; }
        say.textContent = 'reading…';
        const Q = await squadOf().catch(() => null);
        if (!Q || !Q.sq.length) { say.textContent = 'no players in this scope yet'; return; }
        let have = new Map();
        try { have = await careerFt(Q.sq.map(r => r.id)); } catch (_) { /* none kept yet */ }
        close(); box.hidden = false;
        box.appendChild(E.el('p', 'rp-syn-t', 'Each player’s career free-throw %. Made and attempted are optional: where they are given, the career counts for that many attempts against this season’s; where not, for 100. Empty the % to take one away.'));
        const inp = (ph, v, w) => { const x = E.el('input', 'ep-input'); x.type = 'text'; x.inputMode = 'decimal'; x.placeholder = ph; x.value = v == null ? '' : String(v); if (w) x.size = w; return x; };
        const lines = Q.sq.slice().sort((a, b) => Q.nm(a).localeCompare(Q.nm(b))).map(r => {
          const k = String(r.id), v = have.get(k) || null;
          const line = E.el('div', 'rp-syn-row rp-cft-row');
          const nm = E.el('span', 'rp-syn-n', Q.nm(r));
          const now = E.el('small', null, 'this season ' + (+r.fta > 0 ? (100 * r.ftm / r.fta).toFixed(1) + '% (' + r.ftm + '/' + r.fta + ')' : 'no free throws'));
          const pct = inp('career %', v && v.pct, 6), made = inp('made', v && v.ftm, 5), att = inp('att.', v && v.fta, 5);
          const note = inp('where from (NCAA, 3 seasons)', v && v.note); note.maxLength = 80;
          const err = E.el('small', 'rp-cft-err');
          line.append(nm, now, pct, made, att, note, err);
          box.appendChild(line);
          return { k, v, pct, made, att, note, err };
        });
        const go = E.el('button', 'ep-btn mini pri', 'Save'); go.type = 'button';
        const no = E.el('button', 'ep-btn mini', 'Cancel'); no.type = 'button';
        const act = E.el('div', 'rp-syn-act'); act.append(go, no);
        box.appendChild(act);
        say.textContent = Q.sq.length + ' players: enter what you have below';
        no.onclick = () => { close(); say.textContent = ''; };
        go.onclick = async () => {
          /* read and check every line first: nothing is kept while one of them is wrong */
          let bad = 0;
          const todo = [];
          lines.forEach(L0 => {
            L0.err.textContent = '';
            let p = typed(L0.pct.value), m = typed(L0.made.value), a = typed(L0.att.value);
            const note = L0.note.value.trim().slice(0, 80);
            if (p == null && E.isNum(m) && E.isNum(a) && a > 0) p = Math.round(1000 * m / a) / 10;    // made / attempted alone
            const why = [Number.isNaN(p) || (p != null && (p < 0 || p > 100)) ? 'a % is 0 to 100' : '',
              Number.isNaN(m) || Number.isNaN(a) || (m != null && (m < 0 || m % 1)) || (a != null && (a < 0 || a % 1)) ? 'made and attempted are whole numbers' : '',
              E.isNum(m) && E.isNum(a) && m > a ? 'more made than attempted' : ''].filter(Boolean).join('; ');
            if (why) { L0.err.textContent = why; bad++; return; }
            const val = p == null ? null : { pct: Math.round(10 * p) / 10, ftm: m, fta: a, note };
            const was = L0.v;
            const same = (!val && !was) || (val && was && val.pct === was.pct && val.ftm === was.ftm && val.fta === was.fta && (val.note || '') === (was.note || ''));
            if (!same) todo.push({ k: L0.k, val });
          });
          if (bad) { say.textContent = bad + (bad === 1 ? ' line needs' : ' lines need') + ' putting right'; return; }
          if (!todo.length) { close(); say.textContent = 'nothing changed'; return; }
          go.disabled = no.disabled = true;
          const c = await cftClient();
          let kept = 0, here = 0;
          for (const { k, val } of todo) {
            CFT.local.set(k, val);
            let ok = false;
            if (c && c.rpc) {
              try {
                const { error } = await c.rpc('set_career_ft', { p_player: k, p_pct: val ? val.pct : null, p_made: val ? val.ftm : null, p_att: val ? val.fta : null, p_note: val ? val.note || null : null });
                ok = !error;
              } catch (_) { ok = false; }
            }
            if (ok) { kept++; CFT.cache.set(k, val); CFT.unkept.delete(k); } else { here++; CFT.unkept.add(k); }
          }
          close();
          say.textContent = [kept ? kept + ' kept for every report' : '', here ? here + ' on this page only (only a platform administrator can keep a career FT%)' : ''].filter(Boolean).join(' · ');
          state.rebuild();
        };
      };
    },
    async build(c, R) {
      const CL = root.EpinoiaClutch;
      const L = await ctx.logs().catch(() => null);
      if (!CL || !L || !L.gs || !L.gs.length) return [block('<div class="rp-empty">No play-by-play for this club yet.</div>')];
      const Q = await squadOf().catch(() => null);
      const me = Q && Q.T.mine ? Q.T.mine : {};
      const S = CL.season(L.gs.filter(g => Array.isArray(g.starters)).map(g => ({
        game: { id: g.id, starters: g.starters, period: g.period, events: L.byG[g.id] || [] }, side: L.sideOf[g.id] })));
      const out = [];
      const pct = (m, a) => (a > 0 ? 100 * m / a : null);
      const mins = sec => Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
      const ids = [...new Set([...(Q ? Q.sq.map(r => String(r.id)) : []), ...Object.keys(S.players)])];
      const meta = Object.assign({}, Q ? Q.meta : {});
      const missing = ids.filter(id => !meta[id]);
      if (missing.length) { try { Object.assign(meta, await ctx.meta(missing)); } catch (_) { /* unnamed */ } }
      const name = id => (meta[id] && meta[id].name) || ((Q && Q.sq.find(r => String(r.id) === String(id))) || {}).name || 'Player';
      const short = id => surname(name(id));

      /* ---- FREE THROWS: the foul line, most foulable first ---- */
      try {
        if (Q && Q.sq.length) {
          let car = new Map();
          try { car = await careerFt(Q.sq.map(r => r.id)); } catch (_) { /* before 0238, or offline */ }
          const lg = Q.T.S.players.reduce((a, r) => { a.m += +r.ftm || 0; a.a += +r.fta || 0; return a; }, { m: 0, a: 0 });
          const lgPct = pct(lg.m, lg.a);
          const rows = Q.sq.map(r => {
            const k = String(r.id), cp = S.players[k] || null, cv = car.get(k) || null;
            return { k, ftm: +r.ftm || 0, fta: +r.fta || 0, season: pct(+r.ftm || 0, +r.fta || 0), cm: cp ? cp.ftm : 0, ca: cp ? cp.fta : 0,
                     car: cv, guess: ftGuess(+r.ftm || 0, +r.fta || 0, cv), mpg: +r.mpg || 0 };
          }).filter(x => x.fta > 0 || x.car);
          /* the players who have been to the line ten times, or have a career figure, by their best guess, lowest first; the
             rest underneath, by their attempts: too few to read */
          const sure = x => (x.fta >= 10 || x.car ? 1 : 0);
          rows.sort((a, b) => (sure(b) - sure(a)) || (sure(a) ? (a.guess - b.guess) : (b.fta - a.fta)));
          if (rows.length) {
            /* the track from 40% (lower where a shooter of ten attempts or more is under it) to 100% */
            const low = Math.min(...rows.filter(x => x.fta >= 10 && E.isNum(x.season)).map(x => x.season).concat(rows.filter(x => x.car).map(x => x.car.pct)), 40);
            const LO = Math.max(0, Math.floor(low / 10) * 10), HI = 100, at = v => Math.max(0, Math.min(100, 100 * (v - LO) / (HI - LO)));
            const marks = []; for (let t = LO; t <= HI; t += 10) marks.push(t);
            const ticks = marks.slice(1, -1).map(t => '<i class="t" style="left:' + at(t).toFixed(1) + '%"></i>').join('') +
              (E.isNum(lgPct) ? '<i class="lg" style="left:' + at(lgPct).toFixed(1) + '%"></i>' : '');
            const axis = '<div class="rp-ft-r rp-ft-ax"><span></span><div class="rp-ft-tr">' + marks.map(t => '<em style="left:' + at(t).toFixed(1) + '%">' + t + '</em>').join('') + '</div><span></span><span></span><span></span></div>';
            const line = x => {
              const b = E.isNum(x.season) && x.fta >= 10 ? E.bandVs(x.season, lgPct, 5, false) : 0;
              const few = !sure(x);
              const dot = x.ca > 0 ? '<i class="c" style="left:' + at(100 * x.cm / x.ca).toFixed(1) + '%" title="clutch"></i>' : '';
              const dia = x.car ? '<i class="k" style="left:' + at(x.car.pct).toFixed(1) + '%"></i>' : '';
              return '<div class="rp-ft-r' + (few ? ' few' : '') + '" data-b="' + b + '"><span class="n">' + esc(short(x.k)) + '</span>' +
                '<div class="rp-ft-tr">' + ticks + (E.isNum(x.season) ? '<b style="width:' + at(x.season).toFixed(1) + '%"></b>' : '') + dot + dia + '</div>' +
                '<span class="v"><b>' + (E.isNum(x.season) ? f1(x.season) : '—') + '</b><small>' + x.ftm + '/' + x.fta + '</small></span>' +
                '<span class="v cl">' + (x.ca ? '<b>' + x.cm + '/' + x.ca + '</b>' : '<b class="nil">—</b>') + '</span>' +
                '<span class="v ca">' + (x.car ? '<b>' + f1(x.car.pct) + '</b>' + (E.isNum(x.car.fta) ? '<small>' + (E.isNum(x.car.ftm) ? x.car.ftm + '/' : '') + x.car.fta + '</small>' : '') : '<b class="nil">—</b>') + '</span></div>';
            };
            const head = '<div class="rp-ft-r rp-ft-h"><span>player</span><span>FT% this season (bar) · clutch (dot) · career (diamond)</span><span>season</span><span>clutch</span><span>career</span></div>';
            out.push(block(title('Free throws', 'who to send to the line: lowest best guess first · ' + (E.isNum(lgPct) ? 'the line is the league’s ' + f1(lgPct) + '%' : 'this season')) +
              '<div class="rp-ft">' + head + rows.map(line).join('') + axis + '</div>' +
              '<p class="rp-note">Each bar is the player’s free-throw % this season, coloured against the league’s (green above, red below; grey under ten attempts). The dot is their clutch free throws, the diamond their career % where one has been entered. The order is the best guess at each shooter: this season’s free throws with the career figure added in as so many more attempts at its percentage, lowest first. Under ten attempts and no career figure, the player is at the foot, too few to read.</p>'));
            R.legendExtra.push(['FREE THROWS', 'This season’s free-throw % (the bar, coloured against the league’s average, the line), the clutch free throws (the dot) and a career % entered by hand (the diamond: college or other leagues). The order is the best guess at each shooter, lowest first: this season’s makes and attempts with the career figure counted as its own attempts (or 100 where only the % was entered).']);
          }
        }
      } catch (e) { if (root.console) root.console.warn('[report clutch FT]', e); }

      if (!S.games) {
        out.push(block(title('Clutch time', 'the last four minutes of the fourth quarter and overtime, within five points') +
          '<div class="rp-empty">None of the club’s last ' + L.gs.length + ' games with a play-by-play was within five points in the last four minutes.</div>'));
        return out;
      }

      /* ---- RATINGS: the club's clutch offence, defence and net against its own over every minute ---- */
      const Rt = CL.ratings(S.own, S.opp), sh = CL.shooting(S.own), shO = CL.shooting(S.opp);
      try {
        const tile = (l, v, ref, low, w, signed) => '<div class="rp-tile" data-b="' + (E.isNum(v) && E.isNum(ref) ? E.bandVs(v, ref, signed ? 6 : 5, low) : 0) + '"><b>' + (signed ? sg1(v) : f1(v)) + '</b><span>' + l + '</span><em>' + w + '</em></div>';
        const tov = Rt.poss > 0 ? 100 * S.own.tov / Rt.poss : null, tovD = Rt.poss > 0 ? 100 * S.opp.tov / Rt.poss : null;
        /* the scope named, so a season's total is never read as this month's (the clutch minutes add up over every game read) */
        out.push(block(title('Clutch ratings', (c.scope ? c.scope + ' · ' : '') + S.games + ' of the last ' + S.of + ' games had clutch time · ' + Math.round(S.dur / 60) + ' minutes in all (' + (S.dur / 60 / S.games).toFixed(1) + ' a game) · ' + Math.round(Rt.poss) + ' possessions a side') +
          '<div class="rp-tiles rp-tiles-b" style="--n:4">' +
            tile('CLUTCH ORTG', Rt.ortg, me.ortg, false, 'all minutes ' + f1(me.ortg)) +
            tile('CLUTCH DRTG', Rt.drtg, me.drtg, true, 'all minutes ' + f1(me.drtg)) +
            tile('CLUTCH NET', Rt.net, me.net, false, 'all minutes ' + sg1(me.net), true) +
            '<div class="rp-tile" data-b="9"><b>' + S.wins + '–' + S.losses + '</b><span>CLUTCH RECORD</span><em>' + (S.own.pts - S.opp.pts > 0 ? '+' : '') + (S.own.pts - S.opp.pts) + ' points in clutch time</em></div>' +
          '</div>' +
          '<table class="rp-tbl rp-cl-ff"><thead><tr><th class="l">in clutch time</th><th>PTS</th><th>eFG%</th><th>TS%</th><th>TOV / 100</th><th>OREB</th><th>FT</th><th>FT RATE</th></tr></thead><tbody>' +
            '<tr><td class="l">' + esc(c.name) + '</td><td>' + S.own.pts + '</td><td>' + f1(sh.efg) + '</td><td>' + f1(sh.ts) + '</td><td>' + f1(tov) + '</td><td>' + S.own.or + '</td><td>' + S.own.ftm + '/' + S.own.fta + '</td><td>' + f1(S.own.fga ? 100 * S.own.fta / S.own.fga : null) + '</td></tr>' +
            '<tr><td class="l">Opponents</td><td>' + S.opp.pts + '</td><td>' + f1(shO.efg) + '</td><td>' + f1(shO.ts) + '</td><td>' + f1(tovD) + '</td><td>' + S.opp.or + '</td><td>' + S.opp.ftm + '/' + S.opp.fta + '</td><td>' + f1(S.opp.fga ? 100 * S.opp.fta / S.opp.fga : null) + '</td></tr>' +
          '</tbody></table>' +
          '<p class="rp-note">Clutch time is worked out from the play-by-play: the last four minutes of the fourth quarter and all of overtime, while the score is within five points going into each play. Each tile is coloured against the club’s own rating over every minute: green better, red worse. Possessions are estimated (FGA − OREB + TOV + 0.44 FTA); a few clutch minutes make a small sample.</p>'));
      } catch (e) { if (root.console) root.console.warn('[report clutch ratings]', e); }

      /* ---- USAGE AND TRUE SHOOTING: who takes the plays, and how well ---- */
      try {
        const ps = Object.keys(S.players).map(k => { const p = S.players[k]; return { k, p, sec: p.sec, usg: CL.usage(p), ts: CL.shooting(p).ts, tsa: p.fga + 0.44 * p.fta }; })
          .filter(x => x.sec >= 60 || x.p.mine > 0).sort((a, b) => b.sec - a.sec);
        if (ps.length) {
          const W = 380, Hh = 250, P = { l: 34, r: 12, t: 12, b: 28 };
          const sc = ps.filter(x => E.isNum(x.usg) && E.isNum(x.ts) && x.tsa >= 2);
          const xMax = Math.max(40, Math.ceil(Math.max(0, ...sc.map(x => x.usg)) / 10) * 10);
          const tsv = sc.map(x => x.ts), yLo = Math.min(20, Math.floor(Math.min(100, ...tsv) / 10) * 10), yHi = Math.max(80, Math.ceil(Math.max(0, ...tsv) / 10) * 10);
          const X = v => P.l + (W - P.l - P.r) * Math.min(1, Math.max(0, v / xMax)), Y = v => P.t + (Hh - P.t - P.b) * (1 - (Math.min(yHi, Math.max(yLo, v)) - yLo) / (yHi - yLo));
          const maxSec = Math.max(1, ...sc.map(x => x.sec));
          let svg = '<svg class="rp-cl-sc" viewBox="0 0 ' + W + ' ' + Hh + '" xmlns="http://www.w3.org/2000/svg">';
          for (let v = 0; v <= xMax; v += 10) svg += '<line class="g" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + P.t + '" y2="' + (Hh - P.b) + '"/><text class="ax" x="' + X(v) + '" y="' + (Hh - P.b + 11) + '" text-anchor="middle">' + v + '</text>';
          for (let v = yLo; v <= yHi; v += 10) svg += '<line class="g" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (P.l - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + v + '</text>';
          /* the club's clutch TS% across, and a fair share of the plays (one in five) down */
          /* EVERY NAME WHERE IT CAN BE READ: the dots first, then each label in the first of eight places round its dot that
             touches no dot and no label already put down (the biggest dots' labels first), inside the plot */
          const boxes = [], hit = b => boxes.some(q => !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3]));
          const inside = b => b[0] >= P.l && b[2] <= W - P.r && b[1] >= P.t && b[3] <= Hh - P.b;
          const label = (txt, x, y, cls, opts) => {
            const w = 4.3 * txt.length + 2, h = 8;
            const tries = opts || [['start', 0, 0]];
            for (const [anc, dx, dy] of tries) {
              const x0 = anc === 'start' ? x + dx : anc === 'end' ? x + dx - w : x + dx - w / 2, b = [x0, y + dy - h + 2, x0 + w, y + dy + 2];
              if (!hit(b) && inside(b)) { boxes.push(b); return '<text class="' + cls + '" x="' + (x + dx).toFixed(1) + '" y="' + (y + dy).toFixed(1) + '" text-anchor="' + anc + '">' + esc(txt) + '</text>'; }
            }
            return '';
          };
          if (E.isNum(sh.ts)) svg += '<line class="ref" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(sh.ts) + '" y2="' + Y(sh.ts) + '"/>';
          svg += '<line class="ref" x1="' + X(20) + '" x2="' + X(20) + '" y1="' + P.t + '" y2="' + (Hh - P.b) + '"/>';
          svg += '<text class="at" x="' + ((P.l + W - P.r) / 2) + '" y="' + (Hh - 3) + '" text-anchor="middle">CLUTCH USAGE %</text><text class="at" transform="translate(9 ' + ((P.t + Hh - P.b) / 2) + ') rotate(-90)" text-anchor="middle">CLUTCH TS %</text>';
          const dots = sc.slice().sort((a, b) => b.sec - a.sec).map(x => ({ x, cx: X(x.usg), cy: Y(x.ts), r: 4 + 9 * Math.sqrt(x.sec / maxSec) }));
          dots.forEach(d => { boxes.push([d.cx - d.r, d.cy - d.r, d.cx + d.r, d.cy + d.r]); });
          svg += dots.map(d => '<circle class="pt ' + (!E.isNum(sh.ts) || d.x.ts >= sh.ts ? 'up' : 'dn') + '" cx="' + d.cx.toFixed(1) + '" cy="' + d.cy.toFixed(1) + '" r="' + d.r.toFixed(1) + '"/>').join('');
          /* the reference lines' words go down before the names, at the ends of their lines */
          if (E.isNum(sh.ts)) svg += label('club ' + f1(sh.ts), W - P.r - 2, Y(sh.ts), 'rl', [['end', 0, -3], ['end', 0, 9]]);
          svg += label('one in five', X(20), P.t, 'rl', [['start', 3, 8], ['end', -3, 8], ['start', 3, Hh - P.b - P.t - 3], ['end', -3, Hh - P.b - P.t - 3]]);
          dots.forEach(d => {
            const r = d.r, g = 2, far = r + g + 8;
            svg += label(short(d.x.k), d.cx, d.cy, 'pl', [['start', r + g, 3], ['end', -r - g, 3], ['middle', 0, -r - g], ['middle', 0, r + g + 7],
              ['start', r * 0.7 + g, -r * 0.7 - 1], ['start', r * 0.7 + g, r * 0.7 + 7], ['end', -r * 0.7 - g, -r * 0.7 - 1], ['end', -r * 0.7 - g, r * 0.7 + 7],
              ['start', far, -10], ['start', far, 14], ['end', -far, -10], ['end', -far, 14], ['middle', 0, -far - 4], ['middle', 0, far + 10]]);
          });
          svg += '</svg>';
          const trs = ps.map(x => {
            const p = x.p, bU = E.isNum(x.usg) ? (x.usg >= 25 ? 9 : 0) : 0;
            return '<tr><td class="l">' + esc(short(x.k)) + '</td><td>' + mins(x.sec) + '</td><td>' + p.pts + '</td><td>' + p.fgm + '/' + p.fga + '</td><td>' + p.ftm + '/' + p.fta + '</td>' +
              '<td data-b="' + bU + '">' + f1(x.usg) + '</td><td data-b="' + (E.isNum(x.ts) && x.tsa >= 2 && E.isNum(sh.ts) ? E.bandVs(x.ts, sh.ts, 8, false) : 0) + '">' + f1(x.ts) + '</td></tr>';
          }).join('');
          out.push(block(title('Clutch usage and true shooting', 'who takes the plays in clutch time, and how well they score them · the dot’s size is their clutch minutes') +
            '<div class="rp-cl-two"><div>' + (sc.length ? svg : '<div class="rp-empty">Too few clutch shots to chart.</div>') + '</div>' +
            '<div><table class="rp-tbl rp-cl-pl"><thead><tr><th class="l">player</th><th>min</th><th>pts</th><th>FG</th><th>FT</th><th>USG%</th><th>TS%</th></tr></thead><tbody>' + trs + '</tbody></table></div></div>' +
            '<p class="rp-note">Usage: the share of the club’s plays (a shot, 0.44 of a free throw, a turnover) a player ended while on the floor in clutch time; one in five is a fair share. True shooting: points against shots, free throws included. Green above the club’s clutch TS%, red below; blue for a usage of 25% or more. The chart leaves out a player with fewer than two shots.</p>'));
          R.legendExtra.push(['CLUTCH TIME', 'The last four minutes of the fourth quarter (of the second half, in halves) and all of overtime, while the score is within five points going into the play: worked out from the play-by-play of every game.'],
            ['CLUTCH USG%', 'The share of the club’s plays a player ended (field goal attempts + 0.44 × free throw attempts + turnovers) while on the floor in clutch time.'],
            ['CLUTCH TS%', 'Points ÷ (2 × (field goal attempts + 0.44 × free throw attempts)) in clutch time.']);
        }
      } catch (e) { if (root.console) root.console.warn('[report clutch usage]', e); }

      /* ---- THE CLUTCH SHOT CARD: the half-court page's card, drawn from clutch time's shots ---- */
      try {
        const SI = root.EpinoiaSituations;
        if (SI && SI.compute && E.sitCardHTML) {
          const A = { pts: S.own.pts, fga: S.own.fga, fgm: S.own.fgm, p3m: S.own.p3m, fta: S.own.fta, ftm: S.own.ftm, tov: S.own.tov, astd: 0, shots: [],
            types: new Map(), zones: { rim: { a: 0, m: 0, x: 0 }, mid: { a: 0, m: 0, x: 0 }, three: { a: 0, m: 0, x: 0 } } };
          L.gs.forEach(g => {
            const seqs = S.seqs.get(g.id);
            if (!seqs || !seqs.size) return;
            let C;
            try { C = SI.compute({ teams: (g.roster_snapshot && g.roster_snapshot.teams) || [{}, {}], events: L.byG[g.id] || [] }); } catch (_) { return; }
            const D = C && C.side && C.side[L.sideOf[g.id]];
            ((D && D.sits && D.sits.all && D.sits.all.shots) || []).forEach(x => {
              if (!seqs.has(x.id)) return;
              A.shots.push(x);
              const key = (x.three ? 'three' : 'two') + '|' + (x.type || '');
              const T0 = A.types.get(key) || { three: x.three, type: x.type || '', a: 0, m: 0 };
              T0.a++; if (x.made) T0.m++; A.types.set(key, T0);
              const z = A.zones[x.zone] || null; if (z) { z.a++; if (x.made) z.m++; }
              if (x.made && x.ast) { A.astd++; if (z) z.x++; }
            });
          });
          A.efg = A.fga ? (A.fgm + 0.5 * A.p3m) / A.fga : null;
          A.ppp = Rt.poss > 0 ? A.pts / Rt.poss : null;
          A.tovPct = Rt.poss > 0 ? A.tov / Rt.poss : null;
          A.astPct = A.fgm ? A.astd / A.fgm : null;
          A.types = [...A.types.values()].sort((x, y) => (y.a - x.a) || (y.m - x.m));
          A.scorers = Object.keys(S.players).map(k => ({ pid: k, pts: S.players[k].pts, fgm: S.players[k].fgm, fga: S.players[k].fga })).filter(x => x.pts > 0).sort((x, y) => y.pts - x.pts).slice(0, 5);
          const names = {}; A.scorers.forEach(x => { names[x.pid] = name(x.pid); });
          out.push(block(title('Clutch shots', 'every shot of clutch time, as the half-court and transition cards draw theirs · per chance: per possession') +
            E.sitCardHTML(A, { key: 'clutch', colour: c.accent || '#08603f', who: c.name + ' offence', names })));
        }
      } catch (e) { if (root.console) root.console.warn('[report clutch shots]', e); }

      /* ---- THE FIVES: the ones that played the most clutch time, with their net rating ---- */
      try {
        let floor = 120;
        const pick = () => Object.values(S.fives).filter(f => f.ids.length === 5 && f.sec >= floor).sort((a, b) => b.sec - a.sec);
        let fv = pick();
        while (fv.length < 4 && floor > 30) { floor = Math.floor(floor / 2); fv = pick(); }
        fv = fv.slice(0, 8);
        if (fv.length) {
          const td = (v, ref, low, scl, sgn) => '<td' + (sgn ? ' class="rp-netc"' : '') + ' data-b="' + (E.isNum(v) && E.isNum(ref) ? E.bandVs(v, ref, scl, low) : 0) + '">' + (sgn ? sg1(v) : f1(v)) + '</td>';
          const trs = fv.map(f => {
            const r = CL.ratings(f.own, f.opp), pm = f.own.pts - f.opp.pts;
            return '<tr><td class="l names">' + f.ids.map(id => esc(short(id))).join(', ') + '</td><td>' + mins(f.sec) + '</td><td>' + Math.round(r.poss) + '</td>' +
              '<td class="' + (pm > 0 ? 'pos' : pm < 0 ? 'neg' : '') + '">' + (pm > 0 ? '+' : '') + pm + '</td>' +
              td(r.ortg, Rt.ortg, false, 10) + td(r.drtg, Rt.drtg, true, 10) + td(r.net, Rt.net, false, 12, true) + '</tr>';
          }).join('');
          out.push(block(title('The clutch fives', 'the ' + fv.length + ' fives with the most clutch time together (' + mins(floor) + '+) · coloured against the club’s clutch ratings') +
            '<table class="rp-tbl rp-cmb rp-cl-lu"><thead><tr><th class="l">five</th><th>min</th><th>poss</th><th>+/−</th><th>ORTG</th><th>DRTG</th><th>NET</th></tr></thead><tbody>' + trs + '</tbody></table>' +
            '<p class="rp-note">Ratings per 100 possessions (estimated) in the clutch time each five played together; a handful of possessions swings them a long way, so read the minutes and the margin beside them.</p>'));
        }
      } catch (e) { if (root.console) root.console.warn('[report clutch fives]', e); }
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
  return [cover, main, shots, players, depth, combos, clutch, week, legend];
}

return { modules, TEAM_STATS };
}));
