/* GENERATED from epinoia/season.js by supabase/tests/extract-shared.mjs — do not edit. */
'use strict';
/* ============================================================================
   EPINOIA SEASON — the statistics intermediary.

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
  else root.EpinoiaSeason = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const dv  = (a, b) => (b ? a / b : null);          // null, not 0 — "no data" is not "zero"
const pct = (a, b) => { const r = dv(a, b); return r == null ? null : r * 100; };
const r1  = v => (v == null ? null : Math.round(v * 10) / 10);
const r2  = v => (v == null ? null : Math.round(v * 100) / 100);

/* possessions, the same estimate the scorer uses */
const POSS = (fga, fta, tov, oreb) => 0.96 * (num(fga) + num(tov) + 0.44 * num(fta) - num(oreb));

/* ============================================================================
   THE EVENTS SPLITS — second chances, transition, off turnovers, after
   timeouts, half court, and assisted against unassisted baskets, over a season.

   finalise-game (and the situations backfill) leaves one compact line under
   `stats.sit` on every stats row: each situation a fixed-order array of counts,
   in epinoia/situations.js's FIELDS order for a side and AFIELDS order for the
   assisted and unassisted makes. SIT_FIELDS and SIT_AFIELDS below are those two
   lists, copied rather than required -- this file is copied into the Edge
   runtime on its own and must load without situations.js -- and
   supabase/tests/sitstats.test.mjs holds the copies equal to the originals.
   The counts are read BY NAME through those lists, never by a bare index.

   COVERAGE IS THE SIDE'S LINE, NOT THE PLAYER'S. Only games finalised with the
   splits (or backfilled) carry them, so every season has a mix. A team's ev_gp
   is its games whose own side line is there; a player's is the games he played
   (minutes > 0) whose side line is there. The player's own line cannot decide
   it: a player who did nothing recordable gets no line at all, and his quiet
   night is still a game. Counts are summed over covered games only -- on every
   covered row, the way the box score's own sums run on every row, so a
   season's "all shots" points are the box score's points over the same games --
   and per game is divided by ev_gp, never by gp. Uncovered games would
   otherwise read as nights of zero second-chance points.

   NO COVERAGE IS NOT ZERO. With ev_gp 0 every ev_ key is null, so a season from
   before the splits existed shows dashes and takes no percentile rank, rather
   than ranking as a league of zeros. Rates are 0-100 from the summed counts, as
   everywhere in this file; points per chance and per basket keep two places.

   A side's line also carries chances (possessions, for after-timeout sets:
   the question asked of a set is what the whole trip produced) and the
   free-throw assists. A team's DEFENCE is the same key set with evd_ in place
   of ev_, built from the OPPONENT's line in the same games -- a defence is only
   describable by what was done against it -- with evd_gp as its coverage.

   The accumulator is one flat typed array per row -- six situations of
   thirteen counts, two groups of five, the free-throw assists -- and the output
   key names are built once, here, not per row: a season page runs this over
   every row of a competition, and a player page up to nine times.
   ============================================================================ */
const SIT_FIELDS  = ['pts', 'fgm', 'fga', 'p3m', 'p3a', 'rimM', 'rimA', 'midM', 'midA', 'ftm', 'fta', 'tov', 'ch'];
const SIT_AFIELDS = ['fgm', 'pts', 'p3m', 'rimM', 'midM'];
const SIT_KEYS    = ['all', 'second', 'transition', 'offTo', 'ato', 'half'];
const SIT_GROUPS  = ['ast', 'unast'];
const SIT_NF = SIT_FIELDS.length, SIT_NA = SIT_AFIELDS.length;
const SIT_A0 = SIT_KEYS.length * SIT_NF;                      // where the assisted groups start
const SIT_LEN = SIT_A0 + SIT_GROUPS.length * SIT_NA + 1;      // + the free-throw assists, last
const SIT_ZERO = new Float64Array(SIT_LEN);                   // what an uncovered row reads
const FI = {}; SIT_FIELDS.forEach((f, i) => { FI[f] = i; });
const AI = {}; SIT_AFIELDS.forEach((f, i) => { AI[f] = i; });

const isSit = x => !!(x && x.v === 1);
const blankSit = () => ({ gp: 0, n: new Float64Array(SIT_LEN) });

function addSit(n, sit) {
  for (let k = 0; k < SIT_KEYS.length; k++) {
    const v = sit[SIT_KEYS[k]];
    if (!Array.isArray(v)) continue;                           // a player's missing situation is zeros
    const o = k * SIT_NF, len = Math.min(v.length, SIT_NF);
    for (let j = 0; j < len; j++) n[o + j] += num(v[j]);
  }
  for (let g = 0; g < SIT_GROUPS.length; g++) {
    const v = sit[SIT_GROUPS[g]];
    if (!Array.isArray(v)) continue;
    const o = SIT_A0 + g * SIT_NA, len = Math.min(v.length, SIT_NA);
    for (let j = 0; j < len; j++) n[o + j] += num(v[j]);
  }
  n[SIT_LEN - 1] += num(sit.ftAst);
}

/* the output names, once per prefix */
const SIT_K_OUT = ['pts', 'ppg', 'pts_sh', 'fgm', 'fga', 'fgm_pg', 'fga_pg', 'fga_sh', 'fg_pct', 'efg',
  'rimM', 'rimA', 'rim_apg', 'rim_pct', 'rim_sh', 'midM', 'midA', 'mid_apg', 'mid_pct', 'mid_sh',
  'p3m', 'p3a', 'p3_apg', 'p3_pct', 'p3_sh', 'ftm', 'fta', 'fta_pg', 'ft_pct', 'tov', 'tov_pg',
  'ch', 'ch_pg', 'ppp', 'freq', 'tov_pct'];
const SIT_G_OUT = ['fgm', 'pts', 'p3m', 'rimM', 'midM', 'fgm_pg', 'pts_pg', 'ppb', 'rim_sh', 'mid_sh', 'p3_sh'];
function sitNames(pre) {
  const named = (base, list) => { const o = {}; list.forEach(s => { o[s] = base + s; }); return o; };
  return {
    gp: pre + 'gp',
    K: SIT_KEYS.map(k => named(pre + k + '_', SIT_K_OUT)),
    G: SIT_GROUPS.map(g => named(pre + g + '_', SIT_G_OUT)),
    ast_sh: pre + 'ast_sh', rim_astp: pre + 'rim_astp', mid_astp: pre + 'mid_astp', p3_astp: pre + 'p3_astp',
    ast_pts_sh: pre + 'ast_pts_sh', unast_pts_sh: pre + 'unast_pts_sh',
    ftast: pre + 'ftast', ftast_pg: pre + 'ftast_pg'
  };
}
const SIT_EV = sitNames('ev_'), SIT_EVD = sitNames('evd_');

/* with no coverage, a total, a per-game value and a rate are all null */
const sitTot  = (v, gp) => (gp > 0 ? v : null);
const sitPg   = (v, gp) => (gp > 0 ? r1(v / gp) : null);
const sitRate = (a, b, gp) => (gp > 0 ? r1(pct(a, b)) : null);

/* writes one prefix's keys onto a finished row; `side` adds what only a side's
   line carries (chances, points per chance, the free-throw assists) */
function sitOut(out, N, S, side) {
  const gp = S ? S.gp : 0, n = S ? S.n : SIT_ZERO;
  out[N.gp] = gp;
  const allPts = n[FI.pts], allFga = n[FI.fga], allCh = n[FI.ch];
  for (let k = 0; k < SIT_KEYS.length; k++) {
    const o = k * SIT_NF, M = N.K[k];
    const pts = n[o + FI.pts], fgm = n[o + FI.fgm], fga = n[o + FI.fga];
    const p3m = n[o + FI.p3m], p3a = n[o + FI.p3a];
    const rimM = n[o + FI.rimM], rimA = n[o + FI.rimA], midM = n[o + FI.midM], midA = n[o + FI.midA];
    const ftm = n[o + FI.ftm], fta = n[o + FI.fta], tov = n[o + FI.tov];
    out[M.pts] = sitTot(pts, gp); out[M.ppg] = sitPg(pts, gp); out[M.pts_sh] = sitRate(pts, allPts, gp);
    out[M.fgm] = sitTot(fgm, gp); out[M.fga] = sitTot(fga, gp);
    out[M.fgm_pg] = sitPg(fgm, gp); out[M.fga_pg] = sitPg(fga, gp); out[M.fga_sh] = sitRate(fga, allFga, gp);
    out[M.fg_pct] = sitRate(fgm, fga, gp); out[M.efg] = sitRate(fgm + 0.5 * p3m, fga, gp);
    out[M.rimM] = sitTot(rimM, gp); out[M.rimA] = sitTot(rimA, gp); out[M.rim_apg] = sitPg(rimA, gp);
    out[M.rim_pct] = sitRate(rimM, rimA, gp); out[M.rim_sh] = sitRate(rimA, fga, gp);
    out[M.midM] = sitTot(midM, gp); out[M.midA] = sitTot(midA, gp); out[M.mid_apg] = sitPg(midA, gp);
    out[M.mid_pct] = sitRate(midM, midA, gp); out[M.mid_sh] = sitRate(midA, fga, gp);
    out[M.p3m] = sitTot(p3m, gp); out[M.p3a] = sitTot(p3a, gp); out[M.p3_apg] = sitPg(p3a, gp);
    out[M.p3_pct] = sitRate(p3m, p3a, gp); out[M.p3_sh] = sitRate(p3a, fga, gp);
    out[M.ftm] = sitTot(ftm, gp); out[M.fta] = sitTot(fta, gp); out[M.fta_pg] = sitPg(fta, gp);
    out[M.ft_pct] = sitRate(ftm, fta, gp);
    out[M.tov] = sitTot(tov, gp); out[M.tov_pg] = sitPg(tov, gp);
    if (side) {
      const ch = n[o + FI.ch];
      out[M.ch] = sitTot(ch, gp); out[M.ch_pg] = sitPg(ch, gp);
      out[M.ppp] = gp > 0 ? r2(dv(pts, ch)) : null;
      out[M.freq] = sitRate(ch, allCh, gp); out[M.tov_pct] = sitRate(tov, ch, gp);
    }
  }
  /* assisted and unassisted: makes only, so shares of baskets and points per
     basket, never an "assisted eFG%" -- a miss cannot be assisted */
  for (let g = 0; g < SIT_GROUPS.length; g++) {
    const o = SIT_A0 + g * SIT_NA, M = N.G[g];
    const fgm = n[o + AI.fgm], pts = n[o + AI.pts];
    out[M.fgm] = sitTot(fgm, gp); out[M.pts] = sitTot(pts, gp); out[M.p3m] = sitTot(n[o + AI.p3m], gp);
    out[M.rimM] = sitTot(n[o + AI.rimM], gp); out[M.midM] = sitTot(n[o + AI.midM], gp);
    out[M.fgm_pg] = sitPg(fgm, gp); out[M.pts_pg] = sitPg(pts, gp);
    out[M.ppb] = gp > 0 ? r2(dv(pts, fgm)) : null;
    out[M.rim_sh] = sitRate(n[o + AI.rimM], fgm, gp);
    out[M.mid_sh] = sitRate(n[o + AI.midM], fgm, gp);
    out[M.p3_sh]  = sitRate(n[o + AI.p3m], fgm, gp);
  }
  /* how much of each zone's makes came off a pass, over the zone's makes */
  const a = SIT_A0, u = SIT_A0 + SIT_NA;
  out[N.ast_sh]   = sitRate(n[a + AI.fgm],  n[a + AI.fgm]  + n[u + AI.fgm],  gp);
  out[N.rim_astp] = sitRate(n[a + AI.rimM], n[a + AI.rimM] + n[u + AI.rimM], gp);
  out[N.mid_astp] = sitRate(n[a + AI.midM], n[a + AI.midM] + n[u + AI.midM], gp);
  out[N.p3_astp]  = sitRate(n[a + AI.p3m],  n[a + AI.p3m]  + n[u + AI.p3m],  gp);
  /* AND HOW MUCH OF THE SCORING CAME OFF A PASS: points from assisted baskets over
     every point scored, free throws included -- "assisted %" as it is usually read.
     Only a make can be assisted, so it is a share of what went in, never of what was
     attempted, and the two shares do not reach 100 because free throws are in the
     denominator and in neither group. */
  out[N.ast_pts_sh]   = sitRate(n[a + AI.pts], allPts, gp);
  out[N.unast_pts_sh] = sitRate(n[u + AI.pts], allPts, gp);
  if (side) {
    out[N.ftast] = sitTot(n[SIT_LEN - 1], gp); out[N.ftast_pg] = sitPg(n[SIT_LEN - 1], gp);
  }
  return out;
}

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
    bench: num(stats && stats.bench), fouls: num(stats && stats.foulTot),
    /* the events splits, passed through untouched: not a count, so no numeric
       key list reads it; players() and teams() check its version themselves */
    sit: (stats && stats.sit) || null
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
    A.paint += num(s.paint); A.fast += num(s.fast); A.sc += num(s.sc); A.pot += num(s.pot);
    if (s.dq) A.dq += 1;

    /* on-court context — every field is a count, so it sums */
    const oc = s.oc || {};
    ['tFGA','tFGM','t3M','tFTA','tTOV','tOR','tDR','tPTS',
     'oFGA','oFGM','o3M','oFTA','oTOV','oOR','oDR','oPTS']
      .forEach(k => { A.oc[k] += num(oc[k]); });

    /* the events splits: a game counts when his SIDE's line is there, whether
       or not he has one of his own (see the block at the top) */
    if (TT && isSit(TT.sit)) {
      const E = A.ev || (A.ev = blankSit());
      if (mins > 0) E.gp += 1;
      if (isSit(s.sit)) addSit(E.n, s.sit);
    }

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
      A.teamAll.oreb += TT.oreb; A.teamAll.dreb += TT.dreb; A.teamAll.min += teamMin5;
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
    ptsAst: 0, rimA: 0, rimM: 0, midA: 0, midM: 0, dq: 0, paint: 0, fast: 0, sc: 0, pot: 0,
    oc: { tFGA:0,tFGM:0,t3M:0,tFTA:0,tTOV:0,tOR:0,tDR:0,tPTS:0,
          oFGA:0,oFGM:0,o3M:0,oFTA:0,oTOV:0,oOR:0,oDR:0,oPTS:0 },
    den: { teamPoss:0, teamFgm:0, oppPoss:0, oppFga2:0, orebChance:0, drebChance:0 },
    teamAll: { pts:0,fga:0,fgm:0,fg3m:0,fta:0,tov:0,oreb:0,dreb:0, min:0 },
    oppAll:  { pts:0,fga:0,fgm:0,fg3m:0,fta:0,tov:0,oreb:0,dreb:0 },
    ev: null };                                  // the events splits, made on the first covered game
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
    paint: A.paint, fast: A.fast, sc: A.sc, pot: A.pot,
    /* per game: the points he assisted, everything he had a hand in, and the miscellany */
    ptsAst_pg: r1(A.ptsAst / g), contrib_pg: r1((A.pts + A.ptsAst) / g),
    paint_pg: r1(A.paint / g), fast_pg: r1(A.fast / g), sc_pg: r1(A.sc / g), pot_pg: r1(A.pot / g),
    /* RealGM's advanced trio: the three percentages summed, Hollinger's pure point rating
       (without the league-pace factor, which a single league has no use for), points per shot */
    total_s: r1((pct(fgm, fga) || 0) + (pct(A.p3m, A.p3a) || 0) + (pct(A.ftm, A.fta) || 0)),
    ppr: r1(A.min > 0 ? 100 * ((2 / 3) * A.ast - A.tov) / A.min : null),
    pps: r2(dv(A.pts, fga)),

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
    diff_drtg: r1(onDrtg != null && offDrtg != null ? onDrtg - offDrtg : null),
    /* pace with him on the floor and off it: both sides' possessions per 40 minutes */
    on_pace: r1(A.min > 0 ? ((onPoss + onOppPoss) / 2) / (A.min / 40) : null),
    off_pace: r1((A.teamAll.min - A.min) > 2 ? ((offPoss + offOppPoss) / 2) / ((A.teamAll.min - A.min) / 40) : null),

    /* ---- THE ON/OFF STATS AS WHAT THEY MEAN: how much better the team is in each
       when he is on. Each is on-court minus off-court, in percentage points; a
       negative TOV% or opponent-eFG% differential is the good direction and the
       tables say so with their "lower is better" flag. Off-court shares need a
       real sample (the same handful-of-possessions guard as the ratings). ---- */
    off_efg:  r1(offPoss > 4 ? pct(off.fgm + 0.5 * off.fg3m, off.fga) : null),
    off_tov:  r1(offPoss > 4 ? pct(off.tov, off.fga + 0.44 * off.fta + off.tov) : null),
    off_oreb: r1(offPoss > 4 ? pct(off.oreb, off.oreb + offOpp.dreb) : null),
    off_ftr:  r1(offPoss > 4 ? pct(off.fta, off.fga) : null),
    vs_off_efg:  r1(offOppPoss > 4 ? pct(offOpp.fgm + 0.5 * offOpp.fg3m, offOpp.fga) : null),
    vs_off_tov:  r1(offOppPoss > 4 ? pct(offOpp.tov, offOpp.fga + 0.44 * offOpp.fta + offOpp.tov) : null),
    vs_off_oreb: r1(offOppPoss > 4 ? pct(offOpp.oreb, offOpp.oreb + off.dreb) : null),
    vs_off_ftr:  r1(offOppPoss > 4 ? pct(offOpp.fta, offOpp.fga) : null)
  };
  const dif = (a, b) => (out[a] != null && out[b] != null ? r1(out[a] - out[b]) : null);
  out.diff_pace = dif('on_pace', 'off_pace');
  out.diff_efg  = dif('on_efg', 'off_efg');
  out.diff_tov  = dif('on_tov', 'off_tov');
  out.diff_oreb = dif('on_oreb', 'off_oreb');
  out.diff_ftr  = dif('on_ftr', 'off_ftr');
  out.diff_vs_efg  = dif('vs_efg', 'vs_off_efg');
  out.diff_vs_tov  = dif('vs_tov', 'vs_off_tov');
  out.diff_vs_oreb = dif('vs_oreb', 'vs_off_oreb');
  out.diff_vs_ftr  = dif('vs_ftr', 'vs_off_ftr');
  out.au = out.usg ? r2(out.ast_pct / out.usg) : null;   // assist-to-usage
  sitOut(out, SIT_EV, A.ev, false);
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

    /* the events splits this side produced: its offence */
    if (isSit(T.sit)) {
      const E = A.ev || (A.ev = blankSit());
      E.gp += 1;
      addSit(E.n, T.sit);
    }

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
      /* and the splits the opponent produced against it: its defence */
      if (isSit(T.sit)) {
        const E = A.evd || (A.evd = blankSit());
        E.gp += 1;
        addSit(E.n, T.sit);
      }
      return o;
    }, { pts:0,fgm:0,fga:0,fg3m:0,fg3a:0,ftm:0,fta:0,oreb:0,dreb:0,ast:0,stl:0,blk:0,tov:0,possessions:0 });
  });

  return [...acc.values()].map(finishTeam);
}

function blankTeam(id) {
  return { id, gp:0, pts:0, fgm:0, fga:0, fg3m:0, fg3a:0, ftm:0, fta:0,
    oreb:0, dreb:0, ast:0, stl:0, blk:0, tov:0, paint:0, fast:0, sc:0, pot:0,
    bench:0, fouls:0, minutes:0, possessions:0, rimA:0, rimM:0, midA:0, midM:0,
    for:0, against:0, opp:[], oppAgg:null, ev:null, evd:null };
}

function finishTeam(A) {
  const g = A.gp || 1;
  const O = A.oppAgg || {};
  const reb = A.oreb + A.dreb;
  const poss = A.possessions || POSS(A.fga, A.fta, A.tov, A.oreb);
  const oppPoss = O.possessions || POSS(O.fga, O.fta, O.tov, O.oreb);

  const out = {
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
  /* the events splits, both ends: what it made of each situation, and what
     opponents made of the same situations against it */
  sitOut(out, SIT_EV, A.ev, true);
  sitOut(out, SIT_EVD, A.evd, true);
  return out;
}

/* ------------------------------------------------------------ percentiles ---
   index_9 colours a full table by percentile rank within the population on
   screen. Computed here rather than in the view so every page ranks the same
   way, and so a column that is better when LOW (turnovers, opponent rating)
   ranks correctly rather than backwards. */
/* ---------------------------------------------------------------- position ---
   WHAT POSITION A PLAYER ACTUALLY PLAYED, for ranking him against his own kind.

   Two sources, and neither alone is enough. The LISTED position is what the club
   typed into the roster, which is right about the shape of the player and says
   nothing about the season he had; on this platform it is also often absent, and
   never finer than G / F / C. The BPM POSITION is worked out from what he did --
   rebounds, assists, blocks, steals and fouls as a share of his team's -- which
   is the better witness to how he was used, and is already regressed towards the
   middle by fifty minutes of prior so twelve minutes cannot make a centre of
   anybody (bpm.js estimatePosition).

   So the calculation leads and the listing corrects it: three parts estimate to
   one part listed, and the listing is skipped entirely when there is none. The
   number runs 1 (point guard) to 5 (centre), and the three groups below are the
   ones this data can actually support -- with a couple of hundred players in a
   competition, five buckets would rank a man against six others. */
const LISTED_POS = { pg: 1, 'point guard': 1, g: 1.5, guard: 1.5, sg: 2, 'shooting guard': 2,
  gf: 2.5, 'g/f': 2.5, wing: 3, sf: 3, 'small forward': 3, f: 3.5, forward: 3.5,
  fc: 4.5, 'f/c': 4.5, pf: 4, 'power forward': 4, c: 5, centre: 5, center: 5, big: 5 };
const POS_GROUPS = [['G', 'guards', 2.5], ['F', 'wings', 4], ['C', 'bigs', Infinity]];

function positionValue(row) {
  if (!row) return null;
  const calc = (typeof row.bpm_pos === 'number' && isFinite(row.bpm_pos)) ? row.bpm_pos : null;
  const listed = LISTED_POS[String(row.position || '').trim().toLowerCase()];
  if (calc == null) return listed == null ? null : listed;
  return listed == null ? calc : 0.75 * calc + 0.25 * listed;
}
/* the group a row belongs to, or null when there is nothing to go on */
function positionGroup(row) {
  const v = positionValue(row);
  if (v == null) return null;
  return (POS_GROUPS.find(g => v < g[2]) || POS_GROUPS[POS_GROUPS.length - 1])[0];
}
const positionLabel = g => { const f = POS_GROUPS.find(x => x[0] === g); return f ? f[1] : ''; };

/* THE GROUPS ARE CUT WHERE THE COMPETITION ACTUALLY SPLITS, not at 2.5 and 4 on the
   nominal scale. The calculated position is regressed towards the middle by fifty
   minutes of prior, so a real league's values bunch: this one runs from 2.25 at the
   tenth percentile to 3.7 at the ninetieth, and fixed cuts put five players in six
   of nobody and everybody else in one bucket -- which is not a position adjustment,
   it is the same pool with a different name. Thirds of the field keep the pools even
   and the meaning intact: the third of the competition that plays most like guards,
   the third that plays most like bigs, and the wings between them. Ties break by the
   id so the cut is the same on every redraw. */
function positionGroups(rows) {
  const out = new Map();
  const rank = (rows || []).map(r => ({ id: r.id, v: positionValue(r) })).filter(x => x.id != null && x.v != null);
  if (rank.length < 3) return out;
  rank.sort((a, b) => (a.v - b.v) || String(a.id).localeCompare(String(b.id)));
  const n = rank.length, cut1 = Math.floor(n / 3), cut2 = Math.floor(2 * n / 3);
  rank.forEach((x, i) => { out.set(x.id, i < cut1 ? 'G' : i < cut2 ? 'F' : 'C'); });
  return out;
}

/* `groupOf` ranks a row only against the rows it shares a group with -- the
   position adjustment. A group of fewer than three is left unranked, exactly as a
   whole table of fewer than three is: a percentile over two players says nothing. */
function percentiles(rows, keys, lowerIsBetter, groupOf) {
  const low = new Set(lowerIsBetter || []);
  const out = new Map();
  const pools = new Map();                              // group key -> rows
  rows.forEach(r => {
    const g = groupOf ? groupOf(r) : '';
    if (g == null) return;                              // no group, no rank
    if (!pools.has(g)) pools.set(g, []);
    pools.get(g).push(r);
  });
  keys.forEach(k => {
    const table = new Map();
    pools.forEach(pool => {
      const vals = pool.map(r => r[k]).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
      if (vals.length < 3) return;                     // a rank over two players says nothing
      pool.forEach(r => {
        const v = r[k];
        if (v == null || !isFinite(v)) return;
        /* HOW MANY VALUES ARE STRICTLY BELOW, by binary search over the sorted list.
           This was a walk from the bottom that stopped at the first value not below,
           which is the same count -- the list is sorted, so everything before that
           point is below and nothing after it is -- but it made each key cost n
           squared, and a table of every league runs to thousands of rows redrawn on
           a phone. The lower bound gives the identical number in log n. */
        let lo = 0, hi = vals.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (vals[mid] < v) lo = mid + 1; else hi = mid;
        }
        const below = lo;
        let p = 100 * below / (vals.length - 1 || 1);
        if (low.has(k)) p = 100 - p;
        table.set(r.id, Math.max(0, Math.min(100, p)));
      });
    });
    if (table.size) out.set(k, table);
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
  const B = (typeof window !== 'undefined' && window.EpinoiaBPM) ||
            (typeof globalThis !== 'undefined' && globalThis.EpinoiaBPM);
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

return { players, teams, percentiles, teamLine, attachBPM, POSS, SIT_FIELDS, SIT_AFIELDS,
         positionValue, positionGroup, positionGroups, positionLabel, POS_GROUPS };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaSeason;
export const { players, teams, percentiles, teamLine, attachBPM, POSS, SIT_FIELDS, SIT_AFIELDS, positionValue, positionGroup, positionGroups, positionLabel, POS_GROUPS } = __api;
export default __api;
