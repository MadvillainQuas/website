'use strict';
/* ============================================================================
   COURTSIDE SEASON — the statistics intermediary.

   Modelled on the scraper pipeline in "scraper files": raw per-game records go
   in, canonical aggregated stat lines come out, and every page reads those
   rather than doing its own arithmetic. There the stage is
   export_player_stats() writing player_stats_enhanced.csv; here it is this
   module, fed by player_game_stats and team_game_stats — which already hold
   the scorer's own per-game box, advanced block and on-court context.

   Two rules it exists to enforce.

   RATES COME FROM SUMMED COMPONENTS, NEVER FROM AVERAGED RATES. A player who
   shoots 1-for-1 in one game and 4-for-12 in the next has shot 5-for-13, not
   (100% + 33%) / 2. Averaging per-game rates is the single most common way a
   season table ends up quietly wrong, and it flatters low-minute players most.

   MINUTE-WEIGHTED DENOMINATORS ARE ACCUMULATED PER GAME. Usage, assist rate,
   steal rate and the rebound rates all divide by an opportunity that depends
   on how long the player was on the floor in THAT game against THAT opponent.
   Summing the numerator and dividing by a season-wide denominator is wrong;
   the per-game share is accumulated instead, exactly as the scraper does.

   The on-court block (oc) carries the team's and the opponent's totals while
   the player was on the floor. Subtracting it from the team's totals over the
   same games gives the off-court side, which is what makes a true on/off
   differential possible rather than a raw plus/minus.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideSeason = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const dv  = (a, b) => (b ? a / b : null);          // null, not 0 — "no data" is not "zero"
const pct = (a, b) => { const r = dv(a, b); return r == null ? null : r * 100; };
const r1  = v => (v == null ? null : Math.round(v * 10) / 10);
const r2  = v => (v == null ? null : Math.round(v * 100) / 100);

/* possessions, the same estimate the scorer uses */
const POSS = (fga, fta, tov, oreb) => 0.96 * (num(fga) + num(tov) + 0.44 * num(fta) - num(oreb));

/* ---------------------------------------------------------------- helpers ---
   A team_game_stats row's `stats` holds the scorer's team block, with the full
   box under `adv` (teamAdv output). This normalises the two shapes into one. */
function teamLine(stats) {
  const a = (stats && stats.adv) || {};
  return {
    pts:  num(a.pts  != null ? a.pts  : stats && stats.pts),
    fgm:  num(a.fgm),  fga: num(a.fga),
    fg3m: num(a.fg3m), fg3a: num(a.fg3a),
    ftm:  num(a.ftm),  fta: num(a.fta),
    oreb: num(a.oreb), dreb: num(a.dreb),
    ast:  num(a.ast),  stl: num(a.stl), blk: num(a.blk),
    tov:  num(a.tov  != null ? a.tov : stats && stats.toTot),
    minutes: num(a.minutes),
    possessions: num(a.possessions),
    /* shot zones: the scorer records a location for every attempt, so a team's
       diet of rim / mid / three is available rather than inferred */
    rimA: num(a.rimA), rimM: num(a.rimM),
    midA: num(a.midA), midM: num(a.midM),
    paint: num(stats && stats.paint), fast: num(stats && stats.fast),
    sc: num(stats && stats.sc), pot: num(stats && stats.pot),
    bench: num(stats && stats.bench), fouls: num(stats && stats.foulTot)
  };
}

/* ------------------------------------------------------------- players ------
   pgs   player_game_stats rows: {game_id, player_uuid|player_id, team_idx, stats}
   tgs   team_game_stats rows:   {game_id, team_idx, stats}
   meta  optional {playerId -> {name, jersey, teamName, ...}}                  */
function players(pgs, tgs, meta) {
  /* index the team lines so a player-game can reach its own team and the
     opponent it actually faced, which the rate denominators need */
  const teamsBy = new Map();
  (tgs || []).forEach(r => {
    if (!teamsBy.has(r.game_id)) teamsBy.set(r.game_id, {});
    teamsBy.get(r.game_id)[r.team_idx] = teamLine(r.stats);
  });

  const acc = new Map();

  (pgs || []).forEach(row => {
    const id = row.player_uuid || row.player_id;
    if (!id) return;
    const s = row.stats || {};
    const mins = num(s.min) / 60000;
    if (!acc.has(id)) acc.set(id, blankPlayer(id));
    const A = acc.get(id);

    const sides = teamsBy.get(row.game_id) || {};
    const TT = sides[row.team_idx];
    const OT = sides[1 - row.team_idx];

    /* A game only counts if the player was actually on the floor. A DNP would
       otherwise drag every per-game average down and inflate nothing. */
    if (mins > 0) A.gp += 1;
    A.min += mins;

    A.pts += num(s.pts);
    A.p2m += num(s.p2m); A.p2a += num(s.p2a);
    A.p3m += num(s.p3m); A.p3a += num(s.p3a);
    A.ftm += num(s.ftm); A.fta += num(s.fta);
    A.oreb += num(s.or); A.dreb += num(s.dr);
    A.ast += num(s.ast); A.stl += num(s.stl); A.blk += num(s.blk);
    A.tov += num(s.to);  A.pf  += num(s.pf);  A.fd += num(s.fd);
    A.pm  += num(s.pm);
    A.ptsAst += num(s.ptsAst);
    A.rimA += num(s.rimA); A.rimM += num(s.rimM);
    A.midA += num(s.midA); A.midM += num(s.midM);
    if (s.dq) A.dq += 1;

    /* on-court context — every field is a count, so it sums */
    const oc = s.oc || {};
    ['tFGA','tFGM','t3M','tFTA','tTOV','tOR','tDR','tPTS',
     'oFGA','oFGM','o3M','oFTA','oTOV','oOR','oDR','oPTS']
      .forEach(k => { A.oc[k] += num(oc[k]); });

    /* minute-weighted opportunity shares, accumulated per game.
       share = the fraction of the team's floor time this player was on for. */
    if (TT && OT && mins > 0) {
      const teamMin5 = Math.max(1, TT.minutes / 5);
      const share = mins / teamMin5;

      const teamPoss = TT.fga + 0.44 * TT.fta + TT.tov;
      const oppPoss  = OT.fga + 0.44 * OT.fta - OT.oreb + OT.tov;

      A.den.teamPoss   += share * teamPoss;
      A.den.teamFgm    += share * TT.fgm;
      A.den.oppPoss    += share * oppPoss;
      A.den.oppFga2    += share * (OT.fga - OT.fg3a);
      A.den.orebChance += share * (TT.oreb + OT.dreb);
      A.den.drebChance += share * (TT.dreb + OT.oreb);

      /* the team's whole-game totals over the games this player appeared in;
         subtracting the on-court block gives the off-court side */
      A.teamAll.pts += TT.pts; A.teamAll.fga += TT.fga; A.teamAll.fgm += TT.fgm;
      A.teamAll.fg3m += TT.fg3m; A.teamAll.fta += TT.fta; A.teamAll.tov += TT.tov;
      A.teamAll.oreb += TT.oreb; A.teamAll.dreb += TT.dreb;
      A.oppAll.pts += OT.pts; A.oppAll.fga += OT.fga; A.oppAll.fgm += OT.fgm;
      A.oppAll.fg3m += OT.fg3m; A.oppAll.fta += OT.fta; A.oppAll.tov += OT.tov;
      A.oppAll.oreb += OT.oreb; A.oppAll.dreb += OT.dreb;
    }
  });

  return [...acc.values()].map(A => finishPlayer(A, meta && meta[A.id]));
}

function blankPlayer(id) {
  return { id, gp: 0, min: 0, pts: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fd: 0, pm: 0,
    ptsAst: 0, rimA: 0, rimM: 0, midA: 0, midM: 0, dq: 0,
    oc: { tFGA:0,tFGM:0,t3M:0,tFTA:0,tTOV:0,tOR:0,tDR:0,tPTS:0,
          oFGA:0,oFGM:0,o3M:0,oFTA:0,oTOV:0,oOR:0,oDR:0,oPTS:0 },
    den: { teamPoss:0, teamFgm:0, oppPoss:0, oppFga2:0, orebChance:0, drebChance:0 },
    teamAll: { pts:0,fga:0,fgm:0,fg3m:0,fta:0,tov:0,oreb:0,dreb:0 },
    oppAll:  { pts:0,fga:0,fgm:0,fg3m:0,fta:0,tov:0,oreb:0,dreb:0 } };
}

function finishPlayer(A, m) {
  const fgm = A.p2m + A.p3m, fga = A.p2a + A.p3a;
  const reb = A.oreb + A.dreb;
  const g = A.gp || 1;
  const pPoss = fga + 0.44 * A.fta + A.tov;
  const tsa = fga + 0.44 * A.fta;

  /* --- on / off ------------------------------------------------------------ */
  const oc = A.oc;
  const onPoss    = POSS(oc.tFGA, oc.tFTA, oc.tTOV, oc.tOR);
  const onOppPoss = POSS(oc.oFGA, oc.oFTA, oc.oTOV, oc.oOR);
  const onOrtg = pct(oc.tPTS, onPoss), onDrtg = pct(oc.oPTS, onOppPoss);

  /* off-court is the team's total minus what happened while he was on it */
  const off = {
    fga: A.teamAll.fga - oc.tFGA, fgm: A.teamAll.fgm - oc.tFGM,
    fg3m: A.teamAll.fg3m - oc.t3M, fta: A.teamAll.fta - oc.tFTA,
    tov: A.teamAll.tov - oc.tTOV, oreb: A.teamAll.oreb - oc.tOR,
    dreb: A.teamAll.dreb - oc.tDR, pts: A.teamAll.pts - oc.tPTS
  };
  const offOpp = {
    fga: A.oppAll.fga - oc.oFGA, fgm: A.oppAll.fgm - oc.oFGM,
    fg3m: A.oppAll.fg3m - oc.o3M, fta: A.oppAll.fta - oc.oFTA,
    tov: A.oppAll.tov - oc.oTOV, oreb: A.oppAll.oreb - oc.oOR,
    dreb: A.oppAll.dreb - oc.oDR, pts: A.oppAll.pts - oc.oPTS
  };
  const offPoss    = POSS(off.fga, off.fta, off.tov, off.oreb);
  const offOppPoss = POSS(offOpp.fga, offOpp.fta, offOpp.tov, offOpp.oreb);
  const offOrtg = offPoss > 4 ? pct(off.pts, offPoss) : null;   // a handful of
  const offDrtg = offOppPoss > 4 ? pct(offOpp.pts, offOppPoss) : null; // possessions is noise, not a split
  const onNet  = (onOrtg  != null && onDrtg  != null) ? onOrtg  - onDrtg  : null;
  const offNet = (offOrtg != null && offDrtg != null) ? offOrtg - offDrtg : null;

  const out = {
    id: A.id,
    gp: A.gp, dq: A.dq,

    /* ---- totals ---- */
    min: r1(A.min), pts: A.pts, reb, oreb: A.oreb, dreb: A.dreb,
    ast: A.ast, stl: A.stl, blk: A.blk, tov: A.tov, pf: A.pf, fd: A.fd, pm: A.pm,
    fgm, fga, p2m: A.p2m, p2a: A.p2a, p3m: A.p3m, p3a: A.p3a, ftm: A.ftm, fta: A.fta,
    rimA: A.rimA, rimM: A.rimM, midA: A.midA, midM: A.midM, ptsAst: A.ptsAst,

    /* ---- per game: the default view ---- */
    mpg: r1(A.min / g), ppg: r1(A.pts / g), rpg: r1(reb / g), apg: r1(A.ast / g),
    spg: r1(A.stl / g), bpg: r1(A.blk / g), topg: r1(A.tov / g), pfpg: r1(A.pf / g),
    orpg: r1(A.oreb / g), drpg: r1(A.dreb / g), fdpg: r1(A.fd / g),

    /* Per-game makes and attempts. A season total of "192-440" tells you
       almost nothing about a player without dividing by games in your head;
       "6.2-11.4" is the shape of a night's work. */
    fgm_pg: r1(fgm / g), fga_pg: r1(fga / g),
    p3m_pg: r1(A.p3m / g), p3a_pg: r1(A.p3a / g),
    ftm_pg: r1(A.ftm / g), fta_pg: r1(A.fta / g),

    /* ---- shooting ---- */
    fg_pct: r1(pct(fgm, fga)), p2_pct: r1(pct(A.p2m, A.p2a)), p3_pct: r1(pct(A.p3m, A.p3a)),
    ft_pct: r1(pct(A.ftm, A.fta)),
    efg: r1(pct(fgm + 0.5 * A.p3m, fga)),
    ts:  r1(pct(A.pts, 2 * tsa)),
    rim_pct: r1(pct(A.rimM, A.rimA)), mid_pct: r1(pct(A.midM, A.midA)),
    /* attempts per game beside each accuracy: a percentage without a volume
       is unreadable — 60% at the rim means one thing on eight attempts a night
       and nothing at all on one */
    rim_apg: r1(A.rimA / g), mid_apg: r1(A.midA / g), p3_apg: r1(A.p3a / g),
    ft_apg:  r1(A.fta / g),
    rim_rate: r1(pct(A.rimA, fga)), mid_rate: r1(pct(A.midA, fga)),
    p3_rate:  r1(pct(A.p3a, fga)),
    ftr: r1(pct(A.fta, fga)),

    /* ---- rates, from accumulated per-game opportunity ---- */
    usg:    r1(pct(pPoss, A.den.teamPoss)),
    ast_pct: r1(pct(A.ast, Math.max(0, A.den.teamFgm - fgm))),
    tov_pct: r1(pct(A.tov, pPoss)),
    stl_pct: r1(pct(A.stl, A.den.oppPoss)),
    blk_pct: r1(pct(A.blk, A.den.oppFga2)),
    oreb_pct: r1(pct(A.oreb, A.den.orebChance)),
    dreb_pct: r1(pct(A.dreb, A.den.drebChance)),
    trb_pct:  r1(pct(reb, A.den.orebChance + A.den.drebChance)),
    ast_to: r2(dv(A.ast, A.tov)),
    ppp: r2(dv(A.pts, pPoss)),

    /* per 75 possessions — offered, never defaulted */
    pts75: r1(dv(A.pts, pPoss) == null ? null : A.pts / Math.max(1, pPoss) * 75),
    poss: r1(pPoss),

    /* ---- on court ----
       The defensive half is carried alongside the offensive one everywhere it
       is offered. An on/off that shows only what a team scores with a player
       says half of what happened, and the half it omits is usually why the
       number is what it is. */
    on_ortg: r1(onOrtg), on_drtg: r1(onDrtg), on_net: r1(onNet),
    on_efg: r1(pct(oc.tFGM + 0.5 * oc.t3M, oc.tFGA)),
    on_tov: r1(pct(oc.tTOV, oc.tFGA + 0.44 * oc.tFTA + oc.tTOV)),
    on_oreb: r1(pct(oc.tOR, oc.tOR + oc.oDR)),
    on_ftr: r1(pct(oc.tFTA, oc.tFGA)),

    /* ---- what the opponent did while he was on: the scraper's _VS family ---- */
    vs_efg:  r1(pct(oc.oFGM + 0.5 * oc.o3M, oc.oFGA)),
    vs_tov:  r1(pct(oc.oTOV, oc.oFGA + 0.44 * oc.oFTA + oc.oTOV)),
    vs_oreb: r1(pct(oc.oOR, oc.oOR + oc.tDR)),
    vs_ftr:  r1(pct(oc.oFTA, oc.oFGA)),

    /* ---- off court, and the differential ---- */
    off_ortg: r1(offOrtg), off_drtg: r1(offDrtg), off_net: r1(offNet),
    diff_net:  r1(onNet != null && offNet != null ? onNet - offNet : null),
    diff_ortg: r1(onOrtg != null && offOrtg != null ? onOrtg - offOrtg : null),
    diff_drtg: r1(onDrtg != null && offDrtg != null ? onDrtg - offDrtg : null)
  };
  out.au = out.usg ? r2(out.ast_pct / out.usg) : null;   // assist-to-usage
  return Object.assign(out, m || {});
}

/* --------------------------------------------------------------- teams ------ */
function teams(tgs, gamesById) {
  const acc = new Map();

  (tgs || []).forEach(row => {
    const g = (gamesById && gamesById[row.game_id]) || null;
    const teamId = g ? (row.team_idx === 0 ? g.home_team_id : g.away_team_id) : null;
    if (!teamId) return;
    if (!acc.has(teamId)) acc.set(teamId, blankTeam(teamId));
    const A = acc.get(teamId);
    const T = teamLine(row.stats);

    A.gp += 1;
    ['pts','fgm','fga','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','tov',
     'paint','fast','sc','pot','bench','fouls','minutes','possessions',
     'rimA','rimM','midA','midM']
      .forEach(k => { A[k] += num(T[k]); });

    A.for += g.home_score != null
      ? (row.team_idx === 0 ? num(g.home_score) : num(g.away_score)) : num(T.pts);
    A.against += g.home_score != null
      ? (row.team_idx === 0 ? num(g.away_score) : num(g.home_score)) : 0;
    if (A.for > A.against) { /* running totals, not per game — W/L comes from standings */ }

    /* the opponent's line in the same game is what makes the defensive four
       factors possible: a defence is only describable relative to what it faced */
    A.opp.push(row.game_id + ':' + (1 - row.team_idx));
  });

  /* second pass for opponent aggregates */
  const byGameSide = new Map();
  (tgs || []).forEach(r => byGameSide.set(r.game_id + ':' + r.team_idx, teamLine(r.stats)));

  acc.forEach(A => {
    A.oppAgg = A.opp.reduce((o, key) => {
      const T = byGameSide.get(key);
      if (!T) return o;
      ['pts','fgm','fga','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','tov','possessions']
        .forEach(k => { o[k] += num(T[k]); });
      return o;
    }, { pts:0,fgm:0,fga:0,fg3m:0,fg3a:0,ftm:0,fta:0,oreb:0,dreb:0,ast:0,stl:0,blk:0,tov:0,possessions:0 });
  });

  return [...acc.values()].map(finishTeam);
}

function blankTeam(id) {
  return { id, gp:0, pts:0, fgm:0, fga:0, fg3m:0, fg3a:0, ftm:0, fta:0,
    oreb:0, dreb:0, ast:0, stl:0, blk:0, tov:0, paint:0, fast:0, sc:0, pot:0,
    bench:0, fouls:0, minutes:0, possessions:0, rimA:0, rimM:0, midA:0, midM:0,
    for:0, against:0, opp:[], oppAgg:null };
}

function finishTeam(A) {
  const g = A.gp || 1;
  const O = A.oppAgg || {};
  const reb = A.oreb + A.dreb;
  const poss = A.possessions || POSS(A.fga, A.fta, A.tov, A.oreb);
  const oppPoss = O.possessions || POSS(O.fga, O.fta, O.tov, O.oreb);

  return {
    id: A.id, gp: A.gp,
    /* per game — the default */
    ppg: r1(A.for / g), papg: r1(A.against / g), diff: A.for - A.against,
    diffpg: r1((A.for - A.against) / g),
    rpg: r1(reb / g), apg: r1(A.ast / g), spg: r1(A.stl / g), bpg: r1(A.blk / g),
    topg: r1(A.tov / g), pfpg: r1(A.fouls / g),

    /* totals */
    pts: A.pts, pts_for: A.for, pts_against: A.against,
    reb, oreb: A.oreb, dreb: A.dreb, ast: A.ast, stl: A.stl, blk: A.blk,
    tov: A.tov, fouls: A.fouls,
    fgm: A.fgm, fga: A.fga, p3m: A.fg3m, p3a: A.fg3a, ftm: A.ftm, fta: A.fta,
    paint: A.paint, fast: A.fast, second_chance: A.sc, pts_off_to: A.pot, bench: A.bench,

    /* ---- shot diet: attempts per game and accuracy, by zone.
       Volume and efficiency together, because either alone misleads — a team
       shooting 60% at the rim on three attempts a night is not a rim team. */
    rim_apg: r1(A.rimA / g), rim_pct: r1(pct(A.rimM, A.rimA)),
    mid_apg: r1(A.midA / g), mid_pct: r1(pct(A.midM, A.midA)),
    p3_apg:  r1(A.fg3a / g), p3_acc:  r1(pct(A.fg3m, A.fg3a)),
    rim_share: r1(pct(A.rimA, A.fga)), mid_share: r1(pct(A.midA, A.fga)),
    p3_share:  r1(pct(A.fg3a, A.fga)),

    /* shooting */
    fg_pct: r1(pct(A.fgm, A.fga)), p3_pct: r1(pct(A.fg3m, A.fg3a)),
    ft_pct: r1(pct(A.ftm, A.fta)),
    efg: r1(pct(A.fgm + 0.5 * A.fg3m, A.fga)),
    ts:  r1(pct(A.pts, 2 * (A.fga + 0.44 * A.fta))),

    /* ---- the four factors, both ends. These are the team default alongside
       the counting stats: they are the four things that decide a basketball
       game, and they are readable without any grounding in advanced stats. */
    ff_efg:  r1(pct(A.fgm + 0.5 * A.fg3m, A.fga)),
    ff_tov:  r1(pct(A.tov, A.fga + 0.44 * A.fta + A.tov)),
    ff_oreb: r1(pct(A.oreb, A.oreb + num(O.dreb))),
    ff_ftr:  r1(pct(A.fta, A.fga)),
    dff_efg:  r1(pct(num(O.fgm) + 0.5 * num(O.fg3m), num(O.fga))),
    dff_tov:  r1(pct(num(O.tov), num(O.fga) + 0.44 * num(O.fta) + num(O.tov))),
    dff_oreb: r1(pct(num(O.oreb), num(O.oreb) + A.dreb)),
    dff_ftr:  r1(pct(num(O.fta), num(O.fga))),

    /* ratings */
    ortg: r1(pct(A.pts, poss)), drtg: r1(pct(num(O.pts), oppPoss)),
    net:  r1((pct(A.pts, poss) || 0) - (pct(num(O.pts), oppPoss) || 0)),
    pace: r1(A.minutes ? ((poss + oppPoss) / 2) / Math.max(1, A.minutes / 5) * 40 : null),
    poss: r1(poss),
    ast_to: r2(dv(A.ast, A.tov)),
    ast_pct: r1(pct(A.ast, A.fgm))
  };
}

/* ------------------------------------------------------------ percentiles ---
   index_9 colours a full table by percentile rank within the population on
   screen. Computed here rather than in the view so every page ranks the same
   way, and so a column that is better when LOW (turnovers, opponent rating)
   ranks correctly rather than backwards. */
function percentiles(rows, keys, lowerIsBetter) {
  const low = new Set(lowerIsBetter || []);
  const out = new Map();
  keys.forEach(k => {
    const vals = rows.map(r => r[k]).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
    if (vals.length < 3) return;                       // a rank over two players says nothing
    const table = new Map();
    rows.forEach(r => {
      const v = r[k];
      if (v == null || !isFinite(v)) return;
      let below = 0;
      for (let i = 0; i < vals.length; i++) if (vals[i] < v) below++; else break;
      let p = 100 * below / (vals.length - 1 || 1);
      if (low.has(k)) p = 100 - p;
      table.set(r.id, Math.max(0, Math.min(100, p)));
    });
    out.set(k, table);
  });
  return out;
}

/* ============================================================================
   BPM, attached to rows that already exist.

   It is a separate pass rather than part of players() because BPM cannot be
   computed one player at a time: the team adjustment needs a whole roster, and
   the league average offensive rating needs every team. Folding it into the
   per-player loop would mean either computing it wrong or computing the league
   twice.
   ============================================================================ */
function attachBPM(playerRows, teamRows, teamOfPlayer) {
  const B = (typeof window !== 'undefined' && window.CourtsideBPM) ||
            (typeof globalThis !== 'undefined' && globalThis.CourtsideBPM);
  if (!B || !playerRows || !playerRows.length || !teamRows || !teamRows.length) {
    return playerRows || [];
  }

  /* Player rows do not carry a team — a player's side is a property of each
     GAME, not of the season row — so the caller supplies the mapping it
     already has from the per-game rows. */
  const teamOf = id => (teamOfPlayer && (teamOfPlayer.get ? teamOfPlayer.get(id) : teamOfPlayer[id])) || null;
  const byTeam = new Map();
  playerRows.forEach(p => {
    const tid = teamOf(p.id);
    if (!tid) return;
    p._teamId = tid;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid).push(p);
  });
  if (!byTeam.size) return playerRows;

  const teams = teamRows.filter(t => byTeam.has(t.id)).map(t => {
    const squad = byTeam.get(t.id).map(p => ({
      id: p.id, minutes: p.min || 0,
      pts: p.pts || 0, tpm: p.p3m || 0, ast: p.ast || 0, to: p.tov || 0,
      orb: p.oreb || 0, drb: p.dreb || 0, stl: p.stl || 0, blk: p.blk || 0,
      pf: p.pf || 0, fga: p.fga || 0, fta: p.fta || 0
    }));
    const totals = {
      pts: t.pts, fga: t.fga, fta: t.fta, oreb: t.oreb, dreb: t.dreb,
      ast: t.ast, stl: t.stl, blk: t.blk, pf: t.fouls, poss: t.poss
    };
    return Object.assign(
      { id: t.id, pace: t.pace || 70, netRtg: t.net || 0, offRtg: t.ortg, players: squad },
      B.teamInputs(totals, squad));
  });

  const out = B.forLeague(teams);
  playerRows.forEach(p => {
    const r = out.get(p.id);
    if (!r) return;
    p.bpm = r.bpm; p.obpm = r.obpm; p.dbpm = r.dbpm; p.vorp = r.vorp;
    p.bpm_pos = r.position; p.bpm_role = r.role;
  });
  return playerRows;
}

return { players, teams, percentiles, teamLine, attachBPM, POSS };
}));
