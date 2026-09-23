'use strict';
/* ============================================================================
   STRENGTH OF SCHEDULE — index_9's "Strength of Schedule Analysis V2.1", on a
   league's Table page.

   compute() below is index_9.html's SOS tab (search "STRENGTH OF SCHEDULE
   ANALYSIS V2.1") step for step: the same KenPom-style adjusted ratings, the
   same four factors (raw, schedule-adjusted, z-scored, points added), the same
   ELO, Pythagorean, Log5 and expected-wins methods and the same filters.
   supabase/tests/sos.test.mjs runs index_9's own code beside it on one league
   and requires every number to agree, so the two cannot drift apart quietly.

   Only three things are EPINOIA's own, and all three are about the input:
     * the games: every finalised game in scope, each side's line from
       team_game_stats (EpinoiaSeason.teamLine), the official score as its
       points, possessions counted the way every other page counts them;
     * dates: the tip-off's calendar day in the reader's timezone, compared as
       text, so a date range selects the same games wherever it is read;
     * the projected record: each pair of clubs meets as often as the league's
       own fixture list says, where index_9 assumed four meetings (the SLB's
       schedule, and nobody else's). Four stays the fallback.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSOS = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const ITERATIONS = 10;
const REGRESSION_FACTOR = 0.8;           // regress toward the mean to avoid overfitting
/* Squared Statistics (2017) regression: eFG% 46.3%, TOV% 35.1%, OREB% 11.9%, FT rate 6.8% */
const EMPIRICAL_WEIGHTS = { efg: 0.463, tovPct: 0.351, orebPct: 0.119, ftRate: 0.068 };
/* points per 100 possessions for each 1% of a factor */
const POINTS_PER_PCT = { efg: 2.0, tovPct: 1.4, orebPct: 0.7, ftRate: 0.4 };
const K_FACTOR = 20;
const INITIAL_ELO = 1500;
const PYTH_EXP = 14;                     // Basketball-Reference
const DEFAULT_MEETINGS = 4;

/* ------------------------------------------------------------- the engine ---
   games: [{ gameId, date: 'YYYY-MM-DD', ts, teams: [a, b],
             data: { a: line, b: line } }]
   line:  { pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, tov, poss }
   opts:  { filter: 'all'|'dateRange'|'lastN'|'gameRange', dateStart, dateEnd,
            lastN, gameStart, gameEnd, meetings }
   Rows are keyed by whatever identifies a team in `teams` (a team id here, a
   team name in index_9); the view maps a key to a club. */
function compute(games, opts) {
  const o = opts || {};
  const GAMES_PER_MATCHUP = o.meetings > 0 ? o.meetings : DEFAULT_MEETINGS;

  // STEP 0: every complete game, in the order it was played
  const allGames = [];
  (games || []).forEach(g => {
    if (!g || !g.teams || g.teams.length !== 2 || !g.data) return;
    if (!g.data[g.teams[0]] || !g.data[g.teams[1]]) return;
    allGames.push(g);
  });
  allGames.sort((a, b) => {
    if (a.ts != null && b.ts != null) return a.ts - b.ts;
    if (!a.date || !b.date) return 0;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  const allDates = allGames.filter(g => g.date).map(g => g.date);
  const minDate = allDates.length > 0 ? allDates[0] : '';
  const maxDate = allDates.length > 0 ? allDates[allDates.length - 1] : '';
  const totalGames = allGames.length;

  // STEP 1: the filter
  let filteredGames = [...allGames];
  let filterDescription = 'All games';
  if (o.filter === 'dateRange' && o.dateStart && o.dateEnd) {
    filteredGames = allGames.filter(g => g.date && g.date >= o.dateStart && g.date <= o.dateEnd);
    filterDescription = 'Date range: ' + o.dateStart + ' to ' + o.dateEnd;
  } else if (o.filter === 'lastN' && o.lastN > 0) {
    /* the last N games overall, as index_9 takes them */
    filteredGames = allGames.slice(-o.lastN);
    filterDescription = 'Last ' + o.lastN + ' games';
  } else if (o.filter === 'gameRange' && o.gameStart > 0 && o.gameEnd >= o.gameStart) {
    const startIdx = Math.max(0, o.gameStart - 1);
    const endIdx = Math.min(totalGames, o.gameEnd);
    filteredGames = allGames.slice(startIdx, endIdx);
    filterDescription = 'Games ' + o.gameStart + ' to ' + o.gameEnd;
  }

  // STEP 2: team totals over the filtered games only
  const blank = () => ({
    games: 0, wins: 0, losses: 0,
    pts: 0, ptsA: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0,
    ftm: 0, fta: 0, oreb: 0, dreb: 0, tov: 0, poss: 0,
    fgmA: 0, fgaA: 0, fg3mA: 0, fg3aA: 0, ftmA: 0, ftaA: 0,
    orebA: 0, drebA: 0, tovA: 0, possA: 0,
    opponents: [], gameData: []
  });
  const addGame = (t, d1, d2, oppName) => {
    t.games++;
    t.pts += d1.pts; t.ptsA += d2.pts;
    t.fgm += d1.fgm; t.fga += d1.fga; t.fg3m += d1.fg3m; t.fg3a += d1.fg3a;
    t.ftm += d1.ftm; t.fta += d1.fta; t.oreb += d1.oreb; t.dreb += d1.dreb;
    t.tov += d1.tov; t.poss += d1.poss;
    t.fgmA += d2.fgm; t.fgaA += d2.fga; t.fg3mA += d2.fg3m; t.fg3aA += d2.fg3a;
    t.ftmA += d2.ftm; t.ftaA += d2.fta; t.orebA += d2.oreb; t.drebA += d2.dreb;
    t.tovA += d2.tov; t.possA += d2.poss;
    t.opponents.push(oppName);
    t.gameData.push({ opp: oppName, ptsFor: d1.pts, ptsAg: d2.pts, possFor: d1.poss, possAg: d2.poss });
    if (d1.pts > d2.pts) t.wins++; else t.losses++;
  };
  const teamStats = new Map();
  const processedGames = [];
  filteredGames.forEach(game => {
    const [team1, team2] = game.teams;
    const d1 = game.data[team1];
    const d2 = game.data[team2];
    if (!teamStats.has(team1)) teamStats.set(team1, blank());
    if (!teamStats.has(team2)) teamStats.set(team2, blank());
    addGame(teamStats.get(team1), d1, d2, team2);
    addGame(teamStats.get(team2), d2, d1, team1);
    processedGames.push({ gameId: game.gameId, team1, team2, pts1: d1.pts, pts2: d2.pts,
                          poss1: d1.poss, poss2: d2.poss, date: game.date, ts: game.ts });
  });

  // STEP 3: league averages from the filtered games
  let lgPoss = 0, lgFgm = 0, lgFga = 0, lgFg3m = 0, lgFg3a = 0;
  let lgFtm = 0, lgFta = 0, lgOreb = 0, lgDreb = 0, lgTov = 0, lgPts = 0;
  teamStats.forEach(t => {
    lgPoss += t.poss; lgFgm += t.fgm; lgFga += t.fga; lgFg3m += t.fg3m; lgFg3a += t.fg3a;
    lgFtm += t.ftm; lgFta += t.fta; lgOreb += t.oreb; lgDreb += t.dreb; lgTov += t.tov; lgPts += t.pts;
  });
  const leagueAvg = {
    efg: lgFga > 0 ? ((lgFgm + 0.5 * lgFg3m) / lgFga) * 100 : 50,
    ftRate: lgFga > 0 ? (lgFta / lgFga) * 100 : 25,
    tovPct: (lgFga + 0.44 * lgFta + lgTov) > 0 ? (lgTov / (lgFga + 0.44 * lgFta + lgTov)) * 100 : 14,
    orebPct: (lgOreb + lgDreb) > 0 ? (lgOreb / (lgOreb + lgDreb)) * 100 : 25,
    ortg: lgPoss > 0 ? (lgPts / lgPoss) * 100 : 100,
    ppg: teamStats.size > 0 ? lgPts / (teamStats.size * (processedGames.length / teamStats.size)) : 80
  };

  // STEP 4: raw efficiency
  const teamRawRatings = new Map();
  teamStats.forEach((t, name) => {
    if (t.games === 0) return;
    const ortg = t.poss > 0 ? (t.pts / t.poss) * 100 : leagueAvg.ortg;
    const drtg = t.possA > 0 ? (t.ptsA / t.possA) * 100 : leagueAvg.ortg;
    teamRawRatings.set(name, { ortg, drtg, netRtg: ortg - drtg });
  });

  // STEP 4.5: ratings over EVERY game in scope, for the schedule measures (the filter never applies)
  const teamStatsAll = new Map();
  allGames.forEach(game => {
    const [team1, team2] = game.teams;
    const d1 = game.data[team1];
    const d2 = game.data[team2];
    [{ name: team1, own: d1, opp: d2, oppName: team2 }, { name: team2, own: d2, opp: d1, oppName: team1 }]
      .forEach(({ name, own, opp, oppName }) => {
        if (!teamStatsAll.has(name)) teamStatsAll.set(name, { pts: 0, ptsA: 0, poss: 0, possA: 0, opponents: [] });
        const t = teamStatsAll.get(name);
        t.pts += own.pts; t.ptsA += opp.pts;
        t.poss += own.poss || (own.fga - own.oreb + own.tov + 0.44 * own.fta);
        t.possA += opp.poss || (opp.fga - opp.oreb + opp.tov + 0.44 * opp.fta);
        t.opponents.push(oppName);
      });
  });
  const teamRawRatingsAll = new Map();
  teamStatsAll.forEach((t, name) => {
    const ortg = t.poss > 0 ? (t.pts / t.poss) * 100 : 100;
    const drtg = t.possA > 0 ? (t.ptsA / t.possA) * 100 : 100;
    teamRawRatingsAll.set(name, { ortg, drtg, netRtg: ortg - drtg });
  });
  let adjORtgAll = new Map();
  let adjDRtgAll = new Map();
  teamRawRatingsAll.forEach((r, name) => { adjORtgAll.set(name, r.ortg); adjDRtgAll.set(name, r.drtg); });
  for (let iter = 0; iter < 10; iter++) {
    const newAdjO = new Map();
    const newAdjD = new Map();
    teamStatsAll.forEach((t, name) => {
      if (t.opponents.length === 0) return;
      let sumOppD = 0, sumOppO = 0;
      t.opponents.forEach(opp => {
        sumOppD += adjDRtgAll.get(opp) || 100;
        sumOppO += adjORtgAll.get(opp) || 100;
      });
      const avgOppD = sumOppD / t.opponents.length;
      const avgOppO = sumOppO / t.opponents.length;
      const raw = teamRawRatingsAll.get(name);
      newAdjO.set(name, raw.ortg + (100 - avgOppD) * 0.8);
      newAdjD.set(name, raw.drtg + (100 - avgOppO) * 0.8);
    });
    adjORtgAll = newAdjO;
    adjDRtgAll = newAdjD;
  }

  // STEP 5: KenPom-style iterative adjustment over the filtered games (additive, per the 2014 update)
  let adjORtg = new Map();
  let adjDRtg = new Map();
  teamRawRatings.forEach((r, name) => { adjORtg.set(name, r.ortg); adjDRtg.set(name, r.drtg); });
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const newAdjORtg = new Map();
    const newAdjDRtg = new Map();
    teamStats.forEach((t, name) => {
      if (t.games === 0) return;
      let sumOppAdjD = 0, sumOppAdjO = 0;
      t.opponents.forEach(opp => {
        sumOppAdjD += adjDRtg.get(opp) || leagueAvg.ortg;
        sumOppAdjO += adjORtg.get(opp) || leagueAvg.ortg;
      });
      const avgOppAdjD = sumOppAdjD / t.opponents.length;
      const avgOppAdjO = sumOppAdjO / t.opponents.length;
      const raw = teamRawRatings.get(name);
      newAdjORtg.set(name, raw.ortg + (leagueAvg.ortg - avgOppAdjD) * REGRESSION_FACTOR);
      newAdjDRtg.set(name, raw.drtg + (leagueAvg.ortg - avgOppAdjO) * REGRESSION_FACTOR);
    });
    adjORtg = newAdjORtg;
    adjDRtg = newAdjDRtg;
  }

  // STEP 6: the four factors, both ends
  const teamFourFactors = new Map();
  teamStats.forEach((t, name) => {
    if (t.games === 0) return;
    const offEfg = t.fga > 0 ? ((t.fgm + 0.5 * t.fg3m) / t.fga) * 100 : 0;
    const offFtRate = t.fga > 0 ? (t.fta / t.fga) * 100 : 0;
    const offTovPct = (t.fga + 0.44 * t.fta + t.tov) > 0 ? (t.tov / (t.fga + 0.44 * t.fta + t.tov)) * 100 : 0;
    const offOrebPct = (t.oreb + t.drebA) > 0 ? (t.oreb / (t.oreb + t.drebA)) * 100 : 0;
    const defEfg = t.fgaA > 0 ? ((t.fgmA + 0.5 * t.fg3mA) / t.fgaA) * 100 : 0;
    const defFtRate = t.fgaA > 0 ? (t.ftaA / t.fgaA) * 100 : 0;
    const defTovPct = (t.fgaA + 0.44 * t.ftaA + t.tovA) > 0 ? (t.tovA / (t.fgaA + 0.44 * t.ftaA + t.tovA)) * 100 : 0;
    const defOrebPct = (t.orebA + t.dreb) > 0 ? (t.orebA / (t.orebA + t.dreb)) * 100 : 0;
    teamFourFactors.set(name, { offEfg, offFtRate, offTovPct, offOrebPct, defEfg, defFtRate, defTovPct, defOrebPct });
  });

  // STEP 6b: the same iterative adjustment, one factor at a time. A team's offensive factor
  // is adjusted by its opponents' matching defensive factor, and vice versa.
  const adjFF = new Map();
  teamFourFactors.forEach((ff, name) => { adjFF.set(name, { ...ff }); });
  const ffAdjKeys = [
    { key: 'offEfg', oppKey: 'defEfg', lgAvgVal: leagueAvg.efg },
    { key: 'offTovPct', oppKey: 'defTovPct', lgAvgVal: leagueAvg.tovPct },
    { key: 'offOrebPct', oppKey: 'defOrebPct', lgAvgVal: leagueAvg.orebPct },
    { key: 'offFtRate', oppKey: 'defFtRate', lgAvgVal: leagueAvg.ftRate },
    { key: 'defEfg', oppKey: 'offEfg', lgAvgVal: leagueAvg.efg },
    { key: 'defTovPct', oppKey: 'offTovPct', lgAvgVal: leagueAvg.tovPct },
    { key: 'defOrebPct', oppKey: 'offOrebPct', lgAvgVal: leagueAvg.orebPct },
    { key: 'defFtRate', oppKey: 'offFtRate', lgAvgVal: leagueAvg.ftRate }
  ];
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const newAdjFF = new Map();
    teamStats.forEach((t, name) => {
      if (t.games === 0) return;
      const rawFF = teamFourFactors.get(name);
      if (!rawFF) return;
      const newFF = {};
      ffAdjKeys.forEach(({ key, oppKey, lgAvgVal }) => {
        let sumOppAdj = 0;
        let oppCount = 0;
        t.opponents.forEach(opp => {
          const oppAdj = adjFF.get(opp);
          if (oppAdj) { sumOppAdj += oppAdj[oppKey]; oppCount++; }
          else { sumOppAdj += lgAvgVal; oppCount++; }
        });
        const avgOppAdj = oppCount > 0 ? sumOppAdj / oppCount : lgAvgVal;
        newFF[key] = rawFF[key] + (lgAvgVal - avgOppAdj) * REGRESSION_FACTOR;
      });
      newAdjFF.set(name, newFF);
    });
    newAdjFF.forEach((ff, name) => adjFF.set(name, ff));
  }

  // STEP 7: z-scores of the four factors across the league
  const calcMean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const calcStd = arr => {
    if (arr.length < 2) return 1;
    const mean = calcMean(arr);
    return Math.sqrt(arr.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / (arr.length - 1)) || 1;
  };
  const ffArrays = { offEfg: [], offFtRate: [], offTovPct: [], offOrebPct: [],
                     defEfg: [], defFtRate: [], defTovPct: [], defOrebPct: [] };
  teamFourFactors.forEach(ff => { Object.keys(ffArrays).forEach(k => ffArrays[k].push(ff[k])); });
  const ffMean = {}, ffStd = {};
  Object.keys(ffArrays).forEach(k => { ffMean[k] = calcMean(ffArrays[k]); ffStd[k] = calcStd(ffArrays[k]); });

  // STEP 8: ELO with a margin-of-victory multiplier (FiveThirtyEight style), game by game in order
  const teamElo = new Map();
  teamStats.forEach((_, name) => teamElo.set(name, INITIAL_ELO));
  const sortedGames = [...processedGames].sort((a, b) => {
    if (a.ts != null && b.ts != null) return a.ts - b.ts;
    if (!a.date || !b.date) return 0;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  sortedGames.forEach(game => {
    const elo1 = teamElo.get(game.team1) || INITIAL_ELO;
    const elo2 = teamElo.get(game.team2) || INITIAL_ELO;
    const exp1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
    const actual1 = game.pts1 > game.pts2 ? 1 : 0;
    const mov = Math.abs(game.pts1 - game.pts2);
    const eloDiff = Math.abs(elo1 - elo2);
    const movMultiplier = Math.log(mov + 1) * (2.2 / ((eloDiff * 0.001) + 2.2));
    const change = K_FACTOR * movMultiplier * (actual1 - exp1);
    teamElo.set(game.team1, elo1 + change);
    teamElo.set(game.team2, elo2 - change);
  });

  // STEPS 9-10: Pythagorean expectation, Log5, and the two win-probability curves
  const log5 = (pA, pB) => {
    if (pA + pB - 2 * pA * pB === 0) return 0.5;
    return (pA - pA * pB) / (pA + pB - 2 * pA * pB);
  };
  const eloToWinProb = (eloA, eloB) => 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  const netRtgToWinProb = (netRtgA, netRtgB) => 1 / (1 + Math.pow(10, -(netRtgA - netRtgB) / 10));

  // STEP 11: the team rows
  const tempRatings = new Map();
  teamStats.forEach((t, name) => {
    if (t.games === 0) return;
    const raw = teamRawRatings.get(name);
    const adjO = adjORtg.get(name) || raw.ortg;
    const adjD = adjDRtg.get(name) || raw.drtg;
    const elo = teamElo.get(name) || INITIAL_ELO;
    tempRatings.set(name, { adjO, adjD, adjNet: adjO - adjD, elo, games: t.games, wins: t.wins });
  });

  /* the league for the projected record: every club seen in scope, whatever the filter */
  const allUniqueTeams = [...new Set([...allGames.flatMap(g => g.teams)])];
  const nAllTeams = allUniqueTeams.length;
  const FULL_SEASON_LENGTH = (nAllTeams - 1) * GAMES_PER_MATCHUP;

  const teamRatings = [];
  teamStats.forEach((t, name) => {
    if (t.games === 0) return;
    const ff = teamFourFactors.get(name);
    const raw = teamRawRatings.get(name);
    const adjO = adjORtg.get(name) || raw.ortg;
    const adjD = adjDRtg.get(name) || raw.drtg;
    const adjNet = adjO - adjD;
    const elo = teamElo.get(name) || INITIAL_ELO;

    // z-scores, signed so that positive is always good
    const zOffEfg = (ff.offEfg - ffMean.offEfg) / ffStd.offEfg;
    const zOffFtRate = (ff.offFtRate - ffMean.offFtRate) / ffStd.offFtRate;
    const zOffTovPct = -(ff.offTovPct - ffMean.offTovPct) / ffStd.offTovPct;
    const zOffOrebPct = (ff.offOrebPct - ffMean.offOrebPct) / ffStd.offOrebPct;
    const zDefEfg = -(ff.defEfg - ffMean.defEfg) / ffStd.defEfg;
    const zDefFtRate = -(ff.defFtRate - ffMean.defFtRate) / ffStd.defFtRate;
    const zDefTovPct = (ff.defTovPct - ffMean.defTovPct) / ffStd.defTovPct;
    const zDefOrebPct = -(ff.defOrebPct - ffMean.defOrebPct) / ffStd.defOrebPct;
    const offFFScore = zOffEfg * EMPIRICAL_WEIGHTS.efg + zOffTovPct * EMPIRICAL_WEIGHTS.tovPct +
                       zOffOrebPct * EMPIRICAL_WEIGHTS.orebPct + zOffFtRate * EMPIRICAL_WEIGHTS.ftRate;
    const defFFScore = zDefEfg * EMPIRICAL_WEIGHTS.efg + zDefTovPct * EMPIRICAL_WEIGHTS.tovPct +
                       zDefOrebPct * EMPIRICAL_WEIGHTS.orebPct + zDefFtRate * EMPIRICAL_WEIGHTS.ftRate;

    // the scoring battle (eFG% + FT rate) and the possession battle (TOV% + OREB%), both ends
    const scoringPA = (ff.offEfg - leagueAvg.efg) * POINTS_PER_PCT.efg +
                      (ff.offFtRate - leagueAvg.ftRate) * POINTS_PER_PCT.ftRate +
                      (leagueAvg.efg - ff.defEfg) * POINTS_PER_PCT.efg +
                      (leagueAvg.ftRate - ff.defFtRate) * POINTS_PER_PCT.ftRate;
    const possPA = (leagueAvg.tovPct - ff.offTovPct) * POINTS_PER_PCT.tovPct +
                   (ff.offOrebPct - leagueAvg.orebPct) * POINTS_PER_PCT.orebPct +
                   (ff.defTovPct - leagueAvg.tovPct) * POINTS_PER_PCT.tovPct +
                   (leagueAvg.orebPct - ff.defOrebPct) * POINTS_PER_PCT.orebPct;

    const pf14 = Math.pow(t.pts, PYTH_EXP);
    const pa14 = Math.pow(t.ptsA, PYTH_EXP);
    const pythWinPct = pf14 / (pf14 + pa14);
    const pythExpWins = pythWinPct * t.games;
    const eloWinPctVsAvg = 1 / (1 + Math.pow(10, (INITIAL_ELO - elo) / 400));

    // expected wins against the opponents actually faced
    let eloExpWinsSchedule = 0, log5ExpWinsSchedule = 0, netRtgExpWinsSchedule = 0;
    t.gameData.forEach(game => {
      const oppRating = tempRatings.get(game.opp);
      if (!oppRating) return;
      eloExpWinsSchedule += eloToWinProb(elo, oppRating.elo);
      log5ExpWinsSchedule += log5(pythWinPct, oppRating.wins / oppRating.games);
      netRtgExpWinsSchedule += netRtgToWinProb(adjNet, oppRating.adjNet);
    });
    const eloExpWinsVsAvg = eloWinPctVsAvg * t.games;

    const projPtsFor = adjO * (t.poss / t.games) / 100;
    const projPtsAg = adjD * (t.possA / t.games) / 100;
    const adjPf14 = Math.pow(projPtsFor, PYTH_EXP);
    const adjPa14 = Math.pow(projPtsAg, PYTH_EXP);
    const adjPythWinPct = (adjPf14 + adjPa14) > 0 ? adjPf14 / (adjPf14 + adjPa14) : 0.5;
    const adjExpWins = adjPythWinPct * t.games;

    // the schedule: opponents' adjusted net rating and ELO, over every game in scope
    let sosSum = 0;
    const tAll = teamStatsAll.get(name);
    if (tAll) {
      tAll.opponents.forEach(opp => { sosSum += (adjORtgAll.get(opp) || 100) - (adjDRtgAll.get(opp) || 100); });
    }
    const sosNetRtg = tAll && tAll.opponents.length > 0 ? sosSum / tAll.opponents.length : 0;
    let sosEloSum = 0;
    if (tAll) tAll.opponents.forEach(opp => sosEloSum += teamElo.get(opp) || INITIAL_ELO);
    const sosElo = tAll && tAll.opponents.length > 0 ? sosEloSum / tAll.opponents.length : INITIAL_ELO;

    const luck = t.wins - eloExpWinsSchedule;
    const pythLuck = t.wins - pythExpWins;

    // projected record over a full round-robin, by ELO and by adjusted net rating
    let projectedWinsRoundRobin = 0;
    allUniqueTeams.forEach(oppName => {
      if (oppName === name) return;
      const oppElo = teamElo.get(oppName) || INITIAL_ELO;
      projectedWinsRoundRobin += eloToWinProb(elo, oppElo) * GAMES_PER_MATCHUP;
    });
    const projectedWins = Math.round(projectedWinsRoundRobin);
    const projectedLosses = FULL_SEASON_LENGTH - projectedWins;
    let pythProjWinsRoundRobin = 0;
    allUniqueTeams.forEach(oppName => {
      if (oppName === name) return;
      const oppData = tempRatings.get(oppName);
      const oppAdjNet = oppData ? (oppData.adjO - oppData.adjD) : 0;
      pythProjWinsRoundRobin += netRtgToWinProb(adjNet, oppAdjNet) * GAMES_PER_MATCHUP;
    });
    const pythProjWins = Math.round(pythProjWinsRoundRobin);
    const pythProjLosses = FULL_SEASON_LENGTH - pythProjWins;

    const adj = adjFF.get(name);
    teamRatings.push({
      key: name, games: t.games, wins: t.wins, losses: t.losses,
      pts: t.pts, ptsA: t.ptsA, poss: t.poss, possA: t.possA,
      rawOrtg: raw.ortg, rawDrtg: raw.drtg, rawNet: raw.netRtg,
      adjOrtg: adjO, adjDrtg: adjD, adjNet,
      elo, sosElo, sosNetRtg,
      ...ff,
      adjOffEfg: (adj && adj.offEfg) || ff.offEfg,
      adjOffTovPct: (adj && adj.offTovPct) || ff.offTovPct,
      adjOffOrebPct: (adj && adj.offOrebPct) || ff.offOrebPct,
      adjOffFtRate: (adj && adj.offFtRate) || ff.offFtRate,
      adjDefEfg: (adj && adj.defEfg) || ff.defEfg,
      adjDefTovPct: (adj && adj.defTovPct) || ff.defTovPct,
      adjDefOrebPct: (adj && adj.defOrebPct) || ff.defOrebPct,
      adjDefFtRate: (adj && adj.defFtRate) || ff.defFtRate,
      zOffEfg, zOffFtRate, zOffTovPct, zOffOrebPct, offFFScore,
      zDefEfg, zDefFtRate, zDefTovPct, zDefOrebPct, defFFScore,
      scoringPA, possPA, totalPA: scoringPA + possPA,
      /* the offensive points added, factor by factor (index_9 works these out in its table) */
      offEfgPA: (ff.offEfg - leagueAvg.efg) * POINTS_PER_PCT.efg,
      offTovPA: (leagueAvg.tovPct - ff.offTovPct) * POINTS_PER_PCT.tovPct,
      offOrebPA: (ff.offOrebPct - leagueAvg.orebPct) * POINTS_PER_PCT.orebPct,
      offFtrPA: (ff.offFtRate - leagueAvg.ftRate) * POINTS_PER_PCT.ftRate,
      pythWinPct, pythExpWins,
      eloWinPct: eloWinPctVsAvg,
      eloExpWins: eloExpWinsVsAvg,
      eloExpWinsSchedule,
      log5ExpWins: log5ExpWinsSchedule,
      netRtgExpWins: netRtgExpWinsSchedule,
      adjExpWins,
      luck, pythLuck,
      projectedWins, projectedLosses,
      pythProjWins, pythProjLosses,
      winPct: t.wins / Math.max(1, t.wins + t.losses),
      seasonLength: FULL_SEASON_LENGTH,
      nTeamsInLeague: nAllTeams
    });
  });
  teamRatings.sort((a, b) => b.adjNet - a.adjNet);

  return {
    rows: teamRatings, leagueAvg, games: processedGames.length, totalGames,
    minDate, maxDate, filterDescription, meetings: GAMES_PER_MATCHUP,
    seasonLength: FULL_SEASON_LENGTH, teamsInScope: nAllTeams
  };
}

/* ------------------------------------------------------------- the input ---
   A season (EpinoiaData.season with its rows) into the engine's games: both sides of
   every game that has both, the official score as each side's points (the result the
   table is built from), possessions as season.js counts them. */
function ymd(ts) {
  const d = new Date(ts);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function gameLines(S) {
  const Sea = root.EpinoiaSeason;
  if (!S || !S.games || !S.tgs || !Sea || !Sea.teamLine) return [];
  const sides = new Map();
  S.tgs.forEach(r => {
    if (!r || (r.team_idx !== 0 && r.team_idx !== 1)) return;
    if (!sides.has(r.game_id)) sides.set(r.game_id, []);
    sides.get(r.game_id)[r.team_idx] = Sea.teamLine(r.stats);
  });
  const num = v => { const n = +v; return isFinite(n) ? n : 0; };
  const line = (T, score) => ({
    pts: score != null && score !== '' && isFinite(+score) ? +score : num(T.pts),
    fgm: num(T.fgm), fga: num(T.fga), fg3m: num(T.fg3m), fg3a: num(T.fg3a),
    ftm: num(T.ftm), fta: num(T.fta), oreb: num(T.oreb), dreb: num(T.dreb), tov: num(T.tov),
    poss: num(T.possessions) || Sea.POSS(T.fga, T.fta, T.tov, T.oreb)
  });
  const out = [];
  S.games.forEach(g => {
    const s = sides.get(g.id);
    const h = g.home_team_id, a = g.away_team_id;
    if (!s || !s[0] || !s[1] || !h || !a || h === a) return;
    const ts = g.tipoff_at ? Date.parse(g.tipoff_at) : NaN;
    out.push({
      gameId: g.id, ts: isFinite(ts) ? ts : null, date: isFinite(ts) ? ymd(ts) : '',
      teams: [h, a], data: { [h]: line(s[0], g.home_score), [a]: line(s[1], g.away_score) }
    });
  });
  return out;
}

/* HOW OFTEN A PAIR OF CLUBS MEETS, from the fixture list (played and to come): the
   commonest count across the pairs that meet at all, so a cup tie or a playoff series
   on top of the league's own schedule does not move it. null when there is no list. */
function meetingsFrom(fixtures) {
  const perPair = new Map();
  (fixtures || []).forEach(f => {
    const h = f && (f.home_team_id || f[0]), a = f && (f.away_team_id || f[1]);
    if (!h || !a || h === a) return;
    const k = h < a ? h + '|' + a : a + '|' + h;
    perPair.set(k, (perPair.get(k) || 0) + 1);
  });
  if (!perPair.size) return null;
  const freq = new Map();
  perPair.forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
  let best = null, bestN = -1;
  freq.forEach((n, c) => { if (n > bestN || (n === bestN && c > best)) { best = c; bestN = n; } });
  return best;
}

/* -------------------------------------------------------------- the view --- */
/* where the reader left the controls: kept for the page's life, so a change of season or
   scope redraws with the same range and the same sort */
const STATE = { filter: 'all', dateStart: '', dateEnd: '', lastN: 10, gameStart: 1, gameEnd: 20,
                sortKey: 'adjNet', sortDir: 'desc' };

/* binary search: the share of the league strictly below the value (index_9's getSosPercentile) */
function percentile(value, sortedValues, higherBetter) {
  if (!sortedValues || sortedValues.length === 0 || value == null) return 50;
  let low = 0, high = sortedValues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedValues[mid] < value) low = mid + 1;
    else high = mid;
  }
  const pct = (low / sortedValues.length) * 100;
  return higherBetter !== false ? pct : 100 - pct;
}

const f1 = v => v.toFixed(1);
const f2 = v => v.toFixed(2);
const sg = v => (v >= 0 ? '+' : '') + v.toFixed(1);
const rd = v => String(Math.round(v));

/* each table's columns: k the row key (and the sort), l the header, t/h its tooltip,
   low when lower is better, sep for a rule on its left */
const T_RATINGS = [
  { k: 'wins', l: 'W-L', t: 'W-L record', h: 'Actual win-loss record for the selected game range.', kind: 'wl' },
  { k: 'projectedWins', l: 'PROJ† ELO', t: 'Projected ELO W-L', h: 'Projected W-L from ELO win probabilities if every team played each other equally often.', kind: 'proj', w: 'projectedWins', ls: 'projectedLosses' },
  { k: 'pythProjWins', l: 'PROJ† PYTH', t: 'Projected Pyth W-L', h: 'Projected W-L from the adjusted net rating differential.', kind: 'proj', w: 'pythProjWins', ls: 'pythProjLosses' },
  { k: 'adjOrtg', l: 'ADJ ORTG', t: 'Adj ORtg', h: 'Adjusted offensive rating: points scored per 100 possessions, adjusted for the defences faced.', sep: 1 },
  { k: 'adjDrtg', l: 'ADJ DRTG', t: 'Adj DRtg', h: 'Adjusted defensive rating: points allowed per 100 possessions, adjusted for the offences faced.', low: 1 },
  { k: 'adjNet', l: 'ADJ NET', t: 'Adj net rating', h: 'Adj ORtg minus Adj DRtg: the single best measure of overall team quality.', fmt: sg },
  { k: 'elo', l: 'ELO', t: 'ELO rating', h: 'Chess-style rating, updated after every game. 1500 is average.', fmt: rd, sep: 1 },
  { k: 'pythExpWins', l: 'PYTH XW', t: 'Pythagorean xW', h: 'Pythagorean expected wins from points scored and allowed.', sep: 1 },
  { k: 'eloExpWinsSchedule', l: 'ELO XW*', t: 'ELO xW (schedule-adjusted)', h: 'Expected wins from the ELO win probability against each opponent actually faced.' },
  { k: 'luck', l: 'LUCK', t: 'Luck', h: 'Actual wins minus ELO expected wins. Positive means lucky.', fmt: sg },
  { k: 'sosNetRtg', l: 'SOS NET', t: 'SOS net rating', h: "Strength of schedule: the opponents' average adjusted net rating.", fmt: sg, sep: 1 },
  { k: 'sosElo', l: 'SOS ELO', t: 'SOS ELO', h: "Strength of schedule: the opponents' average ELO rating.", fmt: rd }
];
const T_XW = [
  { k: 'wins', l: 'WINS', t: 'Actual wins', h: 'Wins in the selected game range.', fmt: rd },
  { k: 'pythExpWins', l: 'PYTH XW', t: 'Pythagorean xW', h: 'Pythagorean expected wins from points scored and allowed.', sep: 1 },
  { k: 'eloExpWins', l: 'ELO VS AVG', t: 'ELO vs average', h: 'Expected wins against a league-average opponent, from the ELO rating.' },
  { k: 'eloExpWinsSchedule', l: 'ELO SCH', t: 'ELO schedule xW', h: 'Expected wins from the ELO win probability against each opponent actually faced.' },
  { k: 'log5ExpWins', l: 'LOG5', t: 'Log5 xW', h: "Bill James's Log5: expected wins from the two teams' win percentages." },
  { k: 'netRtgExpWins', l: 'NET RTG', t: 'Net rating xW', h: 'Expected wins from the adjusted net rating differential against each opponent.' },
  { k: 'pythLuck', l: 'PYTH LUCK', t: 'Pyth luck', h: 'Actual wins minus Pythagorean expected wins.', fmt: sg, sep: 1 },
  { k: 'luck', l: 'ELO LUCK', t: 'ELO luck', h: 'Actual wins minus ELO schedule-adjusted expected wins.', fmt: sg },
  { k: 'eloWinPct', l: 'WIN%', t: 'Win %', h: 'ELO probability of beating a league-average opponent.', fmt: v => (v * 100).toFixed(1) + '%', sep: 1 }
];
const T_PA = [
  { k: 'offEfgPA', l: 'EFG PA', t: 'Off eFG points added', h: 'Points added by offensive eFG% against the league average.', fmt: sg, sep: 1 },
  { k: 'offTovPA', l: 'TOV PA', t: 'Off TOV points added', h: 'Points added by a lower offensive turnover rate than the league average.', fmt: sg },
  { k: 'offOrebPA', l: 'ORB PA', t: 'Off ORB points added', h: 'Points added by offensive rebound % against the league average.', fmt: sg },
  { k: 'offFtrPA', l: 'FTR PA', t: 'Off FTR points added', h: 'Points added by free throw rate against the league average.', fmt: sg },
  { k: 'scoringPA', l: 'SCORE PA', t: 'Scoring PA', h: 'Points added by shooting (eFG% and FT rate), at both ends.', fmt: sg, sep: 1 },
  { k: 'possPA', l: 'POSS PA', t: 'Possession PA', h: 'Points added by the possession factors (turnovers and rebounds), at both ends.', fmt: sg },
  { k: 'totalPA', l: 'TOTAL PA', t: 'Total PA', h: 'Points added by all four factors together.', fmt: sg, sep: 1 }
];
const T_ADJFF = [
  { k: 'adjOffEfg', l: 'EFG%', t: 'Adj off eFG%', h: 'Schedule-adjusted offensive effective field goal %.', sep: 1, cls: 'off' },
  { k: 'adjOffTovPct', l: 'TOV%', t: 'Adj off TOV%', h: 'Schedule-adjusted offensive turnover %.', low: 1, cls: 'off' },
  { k: 'adjOffOrebPct', l: 'ORB%', t: 'Adj off ORB%', h: 'Schedule-adjusted offensive rebound %.', cls: 'off' },
  { k: 'adjOffFtRate', l: 'FTR', t: 'Adj off FT rate', h: 'Schedule-adjusted offensive free throw rate.', cls: 'off' },
  { k: 'adjDefEfg', l: 'EFG%', t: 'Adj def eFG%', h: 'Schedule-adjusted eFG% allowed.', low: 1, sep: 1, cls: 'def' },
  { k: 'adjDefTovPct', l: 'TOV%', t: 'Adj def TOV%', h: 'Schedule-adjusted turnover % forced.', cls: 'def' },
  { k: 'adjDefOrebPct', l: 'ORB%', t: 'Adj def ORB%', h: 'Schedule-adjusted opponent offensive rebound %.', low: 1, cls: 'def' },
  { k: 'adjDefFtRate', l: 'FTR', t: 'Adj def FT rate', h: 'Schedule-adjusted opponent free throw rate.', low: 1, cls: 'def' }
];
const T_Z = [
  { k: 'zOffEfg', l: 'EFG', t: 'Off eFG z-score (46%)', h: 'Offensive eFG% z-score, weighted 46% in the total.', fmt: f2, sep: 1, cls: 'off' },
  { k: 'zOffTovPct', l: 'TOV', t: 'Off TOV z-score (35%)', h: 'Offensive TOV% z-score, weighted 35% in the total.', fmt: f2, cls: 'off' },
  { k: 'zOffOrebPct', l: 'OREB', t: 'Off OREB z-score (12%)', h: 'Offensive OREB% z-score, weighted 12% in the total.', fmt: f2, cls: 'off' },
  { k: 'zOffFtRate', l: 'FTR', t: 'Off FTR z-score (7%)', h: 'Offensive FT rate z-score, weighted 7% in the total.', fmt: f2, cls: 'off' },
  { k: 'offFFScore', l: 'TOTAL', t: 'Off four factors total', h: 'The weighted offensive four factors composite.', fmt: f2, cls: 'off' },
  { k: 'zDefEfg', l: 'EFG', t: 'Def eFG z-score (46%)', h: 'Defensive eFG% z-score, weighted 46% in the total.', fmt: f2, sep: 1, cls: 'def' },
  { k: 'zDefTovPct', l: 'TOV', t: 'Def TOV z-score (35%)', h: 'Defensive TOV% z-score, weighted 35% in the total.', fmt: f2, cls: 'def' },
  { k: 'zDefOrebPct', l: 'OREB', t: 'Def OREB z-score (12%)', h: 'Defensive OREB% z-score, weighted 12% in the total.', fmt: f2, cls: 'def' },
  { k: 'zDefFtRate', l: 'FTR', t: 'Def FTR z-score (7%)', h: 'Defensive FT rate z-score, weighted 7% in the total.', fmt: f2, cls: 'def' },
  { k: 'defFFScore', l: 'TOTAL', t: 'Def four factors total', h: 'The weighted defensive four factors composite.', fmt: f2, cls: 'def' }
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* o: { host, games (gameLines), meetings (meetingsFrom, or null),
        team(key) -> { name, short, colour, logo, href } } */
function render(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';
  const games = o.games || [];
  const team = typeof o.team === 'function' ? o.team : (k => ({ name: String(k) }));
  const heat = (root.EpinoiaTable && root.EpinoiaTable.heatStyle) || (() => '');

  const wrap = el('div', 'sos');
  const ctl = el('div', 'sos-ctl');
  const out = el('div', 'sos-out');
  wrap.append(ctl, out);
  host.appendChild(wrap);

  const range = compute(games, { meetings: o.meetings });
  if (!range.totalGames) {
    out.appendChild(el('div', 'empty',
      'No finalised games in this scope yet. The strength of schedule fills in as games are finalised.'));
    return;
  }

  function field(label, input) {
    const f = el('label', 'sos-f');
    f.append(el('span', null, label), input);
    return f;
  }
  function input(type, value, attrs, onValue, evt) {
    const i = el('input', 'ep-input');
    i.type = type; i.value = value;
    Object.keys(attrs || {}).forEach(k => i.setAttribute(k, attrs[k]));
    i.addEventListener(evt || 'change', () => onValue(i.value, i));
    return i;
  }

  function controls() {
    ctl.textContent = '';
    const head = el('div', 'sos-ctl-head');
    const avail = el('span', 'sos-avail');
    avail.append(el('span', null, 'available: ' + range.totalGames + ' games'), ' ',
      el('span', null, '(' + (range.minDate || 'n/a') + ' to ' + (range.maxDate || 'n/a') + ')'));
    head.append(el('span', 'sos-lab', 'game / date range'), avail);
    const row = el('div', 'sos-ctl-row');

    const sel = el('select', 'ep-input');
    [['all', 'All games'], ['dateRange', 'Date range'], ['lastN', 'Last N games'], ['gameRange', 'Game range']]
      .forEach(([v, l]) => { const op = el('option', null, l); op.value = v; sel.appendChild(op); });
    sel.value = STATE.filter;
    sel.addEventListener('change', () => {
      STATE.filter = sel.value;
      /* a date range opens on the whole season rather than on two empty boxes */
      if (STATE.filter === 'dateRange') {
        if (!STATE.dateStart) STATE.dateStart = range.minDate;
        if (!STATE.dateEnd) STATE.dateEnd = range.maxDate;
      }
      controls(); draw();
    });
    row.appendChild(field('filter', sel));

    if (STATE.filter === 'dateRange') {
      const lim = { min: range.minDate, max: range.maxDate };
      row.append(
        field('from', input('date', STATE.dateStart, lim, v => { STATE.dateStart = v; draw(); })),
        field('to', input('date', STATE.dateEnd, lim, v => { STATE.dateEnd = v; draw(); })));
    } else if (STATE.filter === 'lastN') {
      row.appendChild(field('last', input('number', STATE.lastN, { min: 1, max: range.totalGames, inputmode: 'numeric' },
        v => { STATE.lastN = Math.max(1, parseInt(v, 10) || 1); draw(); }, 'input')));
      row.appendChild(el('span', 'sos-unit', 'games'));
    } else if (STATE.filter === 'gameRange') {
      row.append(
        field('games', input('number', STATE.gameStart, { min: 1, max: range.totalGames, inputmode: 'numeric' },
          v => { STATE.gameStart = Math.max(1, parseInt(v, 10) || 1); draw(); }, 'input')),
        field('to', input('number', STATE.gameEnd, { min: 1, max: range.totalGames, inputmode: 'numeric' },
          v => { STATE.gameEnd = Math.max(STATE.gameStart, parseInt(v, 10) || STATE.gameStart); draw(); }, 'input')));
    }
    if (STATE.filter !== 'all') {
      const reset = el('button', 'ep-chip sos-reset', '✕ reset');
      reset.type = 'button';
      reset.addEventListener('click', () => { STATE.filter = 'all'; controls(); draw(); });
      row.appendChild(reset);
    }
    ctl.append(head, row);
  }

  function draw() {
    /* a sort or a filter redraws the tables; each keeps its sideways scroll */
    const keep = [...out.querySelectorAll('.ep-tw')].map(w => w.scrollLeft);
    out.textContent = '';
    const R = compute(games, {
      filter: STATE.filter, dateStart: STATE.dateStart, dateEnd: STATE.dateEnd, lastN: STATE.lastN,
      gameStart: STATE.gameStart, gameEnd: STATE.gameEnd, meetings: o.meetings
    });

    const act = el('div', 'sos-active');
    act.append(el('span', null, 'active filter: '), el('b', null, R.filterDescription),
      el('span', null, ' (' + R.games + ' of ' + R.totalGames + ' games)'));
    out.appendChild(act);
    if (!R.rows.length) { out.appendChild(el('div', 'empty', 'No games in this range.')); return; }

    const tiles = el('div', 'sos-tiles');
    [[R.rows.length, 'teams'], [R.games, 'games'], [R.leagueAvg.efg.toFixed(1) + '%', 'lg eFG%'],
     [R.leagueAvg.ortg.toFixed(1), 'lg ORtg']].forEach(([v, l]) => {
      const t = el('div', 'sos-tile');
      t.append(el('div', 'v', String(v)), el('div', 'l', l));
      tiles.appendChild(t);
    });
    out.appendChild(tiles);

    const pools = {};
    const pool = k => pools[k] || (pools[k] = R.rows.map(r => r[k]).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b));
    const sorted = R.rows.slice().sort((a, b) => {
      let vA = a[STATE.sortKey], vB = b[STATE.sortKey];
      if (vA == null) vA = -Infinity;
      if (vB == null) vB = -Infinity;
      return STATE.sortDir === 'desc' ? vB - vA : vA - vB;
    });

    function teamTd(key) {
      const td = el('td');
      const t = team(key) || {};
      const cell = el('span', 'sos-team');
      if (root.epinoiaCrest) {
        cell.appendChild(root.epinoiaCrest({ name: t.name, short_name: t.short, colour: t.colour, logo_path: t.logo }));
      }
      const name = t.href ? el('a', null, t.name || '') : el('span', null, t.name || '');
      if (t.href) name.href = t.href;
      name.title = t.name || '';
      cell.appendChild(name);
      td.appendChild(cell);
      return td;
    }
    function dataTd(r, c) {
      const td = el('td', [c.sep ? 'sep' : '', c.cls || ''].join(' ').trim() || null);
      if (c.kind === 'proj') {
        const w = r[c.w], l = r[c.ls];
        td.textContent = w + '-' + l;
        td.classList.add(w > l ? 'up' : w < l ? 'dn' : 'ev');
        return td;
      }
      const v = c.kind === 'wl' ? r.winPct : r[c.k];
      if (v == null || isNaN(v)) { td.textContent = '–'; return td; }
      const p = percentile(v, pool(c.kind === 'wl' ? 'winPct' : c.k), !c.low);
      td.style.cssText = heat(p);
      td.title = 'percentile ' + Math.round(p) + ' of ' + R.rows.length;
      td.textContent = c.kind === 'wl' ? r.wins + '-' + r.losses : (c.fmt || f1)(v);
      return td;
    }
    function sortTh(c) {
      const on = STATE.sortKey === c.k;
      const th = el('th', [c.sep ? 'sep' : '', c.cls || '', on ? 'on' : ''].join(' ').trim() || null,
        c.l + (on ? (STATE.sortDir === 'desc' ? ' ▼' : ' ▲') : ''));
      th.title = c.t + ' — ' + c.h + (c.low ? ' Lower is better.' : '');
      th.tabIndex = 0;
      if (on) th.setAttribute('aria-sort', STATE.sortDir === 'desc' ? 'descending' : 'ascending');
      const go = () => {
        if (STATE.sortKey === c.k) STATE.sortDir = STATE.sortDir === 'desc' ? 'asc' : 'desc';
        else { STATE.sortKey = c.k; STATE.sortDir = 'desc'; }
        draw();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      return th;
    }
    function table(cols, groups) {
      const tw = el('div', 'ep-tw');
      const t = el('table', 'ep-tbl sos-tbl');
      const thead = el('thead');
      if (groups) {
        const gr = el('tr', 'sos-grp');
        const lead = el('th'); lead.colSpan = 2; gr.appendChild(lead);
        groups.forEach(g => { const th = el('th', 'sep ' + g.cls, g.l); th.colSpan = g.span; gr.appendChild(th); });
        thead.appendChild(gr);
      }
      const hr = el('tr');
      hr.append(el('th', null, '#'), el('th', null, 'TEAM'));
      cols.forEach(c => hr.appendChild(sortTh(c)));
      thead.appendChild(hr);
      t.appendChild(thead);
      const tb = el('tbody');
      sorted.forEach((r, i) => {
        const tr = el('tr');
        tr.append(el('td', null, String(i + 1)), teamTd(r.key));
        cols.forEach(c => tr.appendChild(dataTd(r, c)));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      tw.appendChild(t);
      return tw;
    }
    const head = text => out.appendChild(el('div', 'sos-h', text));
    const note = lines => {
      const n = el('div', 'sos-notes');
      lines.forEach(l => n.appendChild(el('div', null, l)));
      out.appendChild(n);
    };

    head('League table — adjusted ratings & expected wins');
    out.appendChild(table(T_RATINGS));
    note([
      '* ELO xW = schedule-adjusted expected wins: the ELO win probability against each opponent actually faced.',
      '† Proj W-L = the projected record if every team played each other ' + R.meetings + '× (' +
        R.seasonLength + ' games' + (o.meetings ? ', as this league’s fixture list has them meet' : '; the fixture list could not be read, so four is assumed') +
        '). ELO uses ELO win probabilities; Pyth uses the adjusted net rating differential.',
      'SOS Net and SOS ELO always use every game in scope (' + R.totalGames + ' games), whatever the range filter.',
      'Tap any column heading to sort. Cells are coloured by percentile rank across all teams.'
    ]);

    head('Expected wins — multiple methods');
    out.appendChild(table(T_XW));

    head('Points added — the four factors');
    out.appendChild(table(T_PA));

    head('Adjusted four factors — schedule-adjusted');
    note(['The same KenPom-style iterative adjustment as Adj ORtg and Adj DRtg (' + ITERATIONS +
      ' iterations, regression factor ' + REGRESSION_FACTOR + '), applied to each factor on its own: ' +
      'offensive factors are adjusted by the defences faced, defensive factors by the offences.']);
    out.appendChild(table(T_ADJFF, [{ l: 'offence (adjusted)', span: 4, cls: 'off' }, { l: 'defence (adjusted)', span: 4, cls: 'def' }]));

    head('Four factors — weighted z-scores');
    out.appendChild(table(T_Z, [{ l: 'offence (z × weight)', span: 5, cls: 'off' }, { l: 'defence (z × weight)', span: 5, cls: 'def' }]));

    head('Methodology & sources');
    const m = el('div', 'sos-method');
    [
      [['Adjusted ratings (KenPom-style)', 'Iterative, ridge-regression-style additive adjustment per KenPom’s 2014 method: AdjO = RawO + (LgAvg − AvgOppD) × ' + REGRESSION_FACTOR + '.'],
       ['Four factors weights', 'Empirical weights from regression (Squared Statistics 2017): eFG% 46.3%, TOV% 35.1%, OREB% 11.9%, FT rate 6.8%.']],
      [['Pythagorean expectation', 'Win% = PF¹⁴ / (PF¹⁴ + PA¹⁴), per Basketball-Reference (RMSE 3.14 wins).'],
       ['ELO rating', 'FiveThirtyEight-style with a margin-of-victory multiplier: Δ = K × ln(MOV+1) × (2.2 / (eloDiff×0.001 + 2.2)) × (actual − expected), K = ' + K_FACTOR + '.']],
      [['Expected wins methods', 'Pyth xW: PF¹⁴ / (PF¹⁴ + PA¹⁴) × games. ELO vs avg: 1 / (1 + 10^((1500 − ELO)/400)) × games. ELO schedule: Σ P(win) against each opponent from the two ELOs. Log5: (pA − pA·pB) / (pA + pB − 2·pA·pB). Net rating: 1 / (1 + 10^(−NetDiff/10)).'],
       ['Luck', 'Actual wins minus schedule-adjusted ELO expected wins.']],
      [['Projected W-L', 'The win probability against every other team, times the meetings per pair, summed over a full round-robin.'],
       ['Points added', 'Each factor against the league average, times its points per 100 possessions: eFG% 2.0, TOV% 1.4, OREB% 0.7, FTR 0.4.']]
    ].forEach(col => {
      const c = el('div');
      col.forEach(([t, body]) => { c.append(el('b', null, t), el('p', null, body)); });
      m.appendChild(c);
    });
    out.appendChild(m);

    out.querySelectorAll('.ep-tw').forEach((w, i) => { if (keep[i]) w.scrollLeft = keep[i]; });
  }

  controls();
  draw();
}

return { compute, gameLines, meetingsFrom, render, percentile, STATE,
         ITERATIONS, REGRESSION_FACTOR, POINTS_PER_PCT, EMPIRICAL_WEIGHTS };
}));
