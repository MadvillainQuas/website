/* ============================================================================
   GAME PERCENTILES, BUILT — writes epinoia/gamepct-data.js.

     node tools/build-gamepct.mjs            write the preset
     node tools/build-gamepct.mjs --report   ...and print every scale

   A preset, rebuilt by hand when there is a new season of games to read: the
   box score reads it, it never reads the database (epinoia/gamepct.js has the
   rules a number is read by).

   WHAT GOES IN, all of it already in this repository:

     SLB 2025-26, 160 whole games   data/data_2026-05-09T15-59_SLB/game_data, the
                                    FIBA LiveStats feeds. Translated by the ingest's
                                    own translator (scripts/ingest/translate/
                                    fiba_events.py) and replayed through engine.js,
                                    boxscore.js and situations.js: the code the game
                                    page runs, so every number here is the page's.
     BCB 2025-26, 364 team games    data/data_2026-06-29T22-39_HBBC/team_totals.csv:
                                    box totals for each side of each game, no
                                    play-by-play.
     season averages, 48 leagues    data/player-stats: 12,800 player-seasons and
                                    810 team-seasons, for how far apart season
                                    averages sit.

   HOW A SCALE IS MADE, for each league and stat:

     1. Every game's value, gated and shrunk exactly as gamepct.js reads one
        (sample, then adjusted), towards the league's average: the average of the
        whole league's games, weighted by volume.
     2. The quantiles of those: the SINGLE-GAME spread.
     3. The SEASON spread. A player: the league's own player-seasons, or where the
        stat can be worked out from the 48 leagues' season averages (true
        shooting, usage, rebound, steal, block and turnover rates …) their spread
        about each league's mean, re-centred on this league's. A team: a normal
        curve on the league's season average, as wide as the 48 leagues' team
        seasons spread about their own league's (a league alone has 10 to 14).
     4. SEASON_WEIGHT (60%) of the season spread, the rest single games, quantile
        by quantile.

   BCB's team rates that box totals can give are built from its own 364 games.
   Everything that needs the play-by-play (players, situations, zones, paint and
   fast-break points) is SLB's scale moved by the ratio of the two leagues'
   averages of the nearest box-score rate, both measured from the same scraper's
   team totals, so the ratio compares like with like.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const GP = require(path.join(ROOT, 'epinoia', 'gamepct.js'));
const B = require(path.join(ROOT, 'epinoia', 'boxscore.js'));
const Sit = require(path.join(ROOT, 'epinoia', 'situations.js'));
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

const SRC = {
  slbFeeds: 'data/data_2026-05-09T15-59_SLB/game_data',
  bcbTeams: 'data/data_2026-06-29T22-39_HBBC/team_totals.csv',
  slbTeams: 'data/data_2026-06-12T15-42_SLB/team_totals.csv',
  seasonTeams: 'data/player-stats/team_totals.csv',
  seasonPlayers: 'data/player-stats/raw_player_stats.csv'
};
const OUT = path.join(ROOT, 'epinoia', 'gamepct-data.js');
const REPORT = process.argv.includes('--report');
const GRID = GP.GRID, W = GP.SEASON_WEIGHT;

/* ----------------------------------------------------------------- helpers --- */
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, ''));
  return rows.filter(r => r.length > 1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; });
}
const csv = rel => parseCSV(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const f = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)) : null; };
/* linear between order statistics (R's type 7) */
function quantiles(values) {
  const v = values.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return GRID.map(p => { const h = (v.length - 1) * p / 100, lo = Math.floor(h), hi = Math.ceil(h); return v[lo] + (v[hi] - v[lo]) * (h - lo); });
}
/* the standard normal's quantile (Acklam) */
function z(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q0 = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 1 - 0.02425 ? Math.sqrt(-2 * Math.log(1 - p)) : null;
  if (q0 != null) {
    const x = (((((c[0] * q0 + c[1]) * q0 + c[2]) * q0 + c[3]) * q0 + c[4]) * q0 + c[5]) / ((((d[0] * q0 + d[1]) * q0 + d[2]) * q0 + d[3]) * q0 + 1);
    return p < 0.5 ? x : -x;
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const sig = v => (v == null ? null : +(+v).toPrecision(4));

/* THE TEAM FORMULAS ON TOTALS: boxscore.js teamAdv, for totals that are not one replayed game
   (a season summed, a CSV row). Held equal to teamAdv on every replayed game below. */
function advFromTotals(T, O) {
  const dv = (a, b) => (b ? a / b : 0);
  const poss = 0.96 * (T.fga + T.tov + 0.44 * T.fta - T.oreb), oPoss = 0.96 * (O.fga + O.tov + 0.44 * O.fta - O.oreb);
  const tsa = T.fga + 0.44 * T.fta;
  return Object.assign({}, T, {
    possessions: poss, tsa,
    ortg: dv(T.pts, poss) * 100, drtg: dv(O.pts, oPoss) * 100, ppp: dv(T.pts, poss),
    efg: dv(T.fgm + 0.5 * T.fg3m, T.fga) * 100, ts: dv(T.pts, 2 * tsa) * 100,
    tovp: dv(T.tov, T.fga + 0.44 * T.fta + T.tov) * 100,
    orebp: dv(T.oreb, T.oreb + O.dreb) * 100, drebp: dv(T.dreb, T.dreb + O.oreb) * 100,
    ftr: dv(T.fta, T.fga) * 100, ftp: dv(T.ftm, T.fta) * 100,
    astp: dv(T.ast, T.fgm) * 100, astTo: T.tov ? T.ast / T.tov : T.ast,
    stlp: dv(T.stl, oPoss) * 100, blkp: dv(T.blk, O.fga - O.fg3a) * 100,
    rimp: dv(T.rimM, T.rimA) * 100, rimr: dv(T.rimA, T.fga) * 100, midp: dv(T.midM, T.midA) * 100,
    p3p: dv(T.fg3m, T.fg3a) * 100, p3r: dv(T.fg3a, T.fga) * 100,
    astPtsP: dv(T.ptsAst, T.pts - T.ftm) * 100, tsaPer100: dv(tsa, poss) * 100,
    pace: dv(poss + oPoss, 2) / Math.max(1, T.minutes / 5) * 40, paceOwn: poss / Math.max(1, T.minutes / 5) * 40,
    /* not the box score's, for the league-to-league ratios only */
    fgp: dv(T.fgm, T.fga) * 100, pppUsed: dv(T.pts, T.fga + 0.44 * T.fta + T.tov), ptsPer40: dv(T.pts, T.minutes / 5) * 40
  });
}
const TOTAL_KEYS = ['pts', 'fgm', 'fga', 'fg3m', 'fg3a', 'fg2m', 'fg2a', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov',
  'rimA', 'rimM', 'midA', 'midM', 'ptsAst', 'minutes'];
const addInto = (acc, src, keys) => { keys.forEach(k => { acc[k] = (acc[k] || 0) + (+src[k] || 0); }); return acc; };

/* ----------------------------------------------------- 1. SLB, game by game --- */
function translateFeeds(dir) {
  const script = [
    'import sys, json, io, glob, os',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'for f in sorted(glob.glob(os.path.join(sys.argv[2], "*.json"))):',
    '    raw = json.load(io.open(f, encoding="utf-8"))',
    '    T = translate(raw, lambda team, pno: "%s:%s" % (team, pno))',
    '    sys.stdout.write(json.dumps({"id": os.path.basename(f)[:-5], "T": T}) + "\\n")'
  ].join('\n');
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'), path.join(ROOT, dir)], { encoding: 'utf8', maxBuffer: 512 << 20 });
    if (r.status === 0 && r.stdout) return r.stdout.trim().split('\n').map(l => JSON.parse(l));
  }
  throw new Error('could not translate the feeds (python with scripts/ingest on the path)');
}

const STAT_KEYS = ['pts', 'p2m', 'p2a', 'p3m', 'p3a', 'ftm', 'fta', 'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf', 'fd', 'pm', 'min',
  'ptsAst', 'rimA', 'rimM', 'midA', 'midM', 'paint', 'fast', 'sc', 'pot'];
const OC_KEYS = ['tFGA', 'tFGM', 't3M', 'tFTA', 'tTOV', 'tOR', 'tDR', 'tPTS', 'oFGA', 'oFGM', 'o3M', 'oFTA', 'oTOV', 'oOR', 'oDR', 'oPTS'];
const SIT_COUNTS = ['chances', 'pts', 'fga', 'fgm', 'p3a', 'p3m', 'fta', 'ftm', 'tov'];
const ZONES = ['rim', 'mid', 'three'];
const zoneAll = s => ({ a: s.fga, m: s.fgm });
const bucketOf = sums => ({
  chances: sums.chances, fga: sums.fga,
  ppp: sums.chances ? sums.pts / sums.chances : null,
  efg: sums.fga ? (sums.fgm + 0.5 * sums.p3m) / sums.fga : null,
  tovPct: sums.chances ? sums.tov / sums.chances : null
});

const slb = { games: 0, dropped: [], team: [], player: [], sit: [], psit: [], zone: [], seasonTeam: {}, seasonPlayer: {} };
{
  const feeds = translateFeeds(SRC.slbFeeds);
  let parityChecked = 0;
  for (const { id, T } of feeds) {
    const G = {
      teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
      period: T.period, clockMs: 0, status: 'final', phase: 'final',
      events: T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}))
    };
    const d = E.deriveGame(G);
    globalThis.S = G; globalThis.derive = () => d;
    const TA = [B.teamAdv(d, 0), B.teamAdv(d, 1)];
    /* THE GATE FOR A GAME: the replay must agree with the feed's own score, the game must have
       run its forty minutes, and neither side's possessions may be absurd (a feed that lost a
       quarter, or doubled one) */
    const why = d.score[0] !== T.home_score || d.score[1] !== T.away_score ? 'score ' + d.score + ' v ' + [T.home_score, T.away_score]
      : TA[0].minutes < 200 - 1e-6 ? 'minutes ' + TA[0].minutes
      : TA.some(a => a.possessions < 55 || a.possessions > 115) ? 'possessions ' + TA.map(a => a.possessions.toFixed(1))
      : [0, 1].some(t => G.teams[t].players.filter(p => d.stats[p.id] && d.stats[p.id].min > 0).length < 5) ? 'fewer than five players'
      : null;
    if (why) { slb.dropped.push(id + ': ' + why); continue; }
    slb.games++;

    /* the totals formulas are teamAdv's, to the last decimal, or nothing built on them is */
    [0, 1].forEach(t => {
      const R = advFromTotals(TA[t], TA[1 - t]);
      Object.keys(TA[t]).forEach(k => {
        if (typeof TA[t][k] === 'number' && Math.abs(TA[t][k] - R[k]) > 1e-9) throw new Error('advFromTotals disagrees with teamAdv on ' + k + ' in ' + id);
      });
      parityChecked++;
    });

    const gameAvg = {};
    ['ortg', 'efg', 'orebp', 'tovp'].forEach(k => { gameAvg[k] = (TA[0][k] + TA[1][k]) / 2; });
    const C = Sit.compute(G);
    [0, 1].forEach(t => {
      const name = G.teams[t].name;
      slb.team.push({ T: TA[t], O: TA[1 - t], c: d.team[t] });
      /* a season, summed */
      const ST = slb.seasonTeam[name] = slb.seasonTeam[name] || { games: 0, T: {}, O: {}, c: {}, sit: {}, zone: {} };
      ST.games++;
      addInto(ST.T, TA[t], TOTAL_KEYS); addInto(ST.O, TA[1 - t], TOTAL_KEYS);
      addInto(ST.c, d.team[t], ['paint', 'fast', 'sc', 'pot', 'bench', 'lead']);

      const side = C.side[t];
      GP.SITS.forEach(k => {
        const s = side.sits[k];
        /* .freq (how often this side gets this kind of chance at all) reads the game's own
           'all' bucket alongside the situation's -- see gamepct.js's SIT[..'.freq'] */
        slb.sit.push({ key: k, s, all: side.sits.all });
        ST.sit[k] = addInto(ST.sit[k] || {}, s, SIT_COUNTS);
        const zs = ST.zone[k] = ST.zone[k] || {};
        ZONES.forEach(zn => { zs[zn] = addInto(zs[zn] || {}, s.zones[zn], ['a', 'm']); });
        zs.all = addInto(zs.all || {}, zoneAll(s), ['a', 'm']);
        ZONES.forEach(zn => slb.zone.push({ key: 'team.' + k + '.' + zn, z: s.zones[zn] }));
        slb.zone.push({ key: 'team.' + k + '.all', z: zoneAll(s) });
      });

      G.teams[t].players.forEach(p => {
        const x = d.stats[p.id];
        if (!x || !(x.min > 0)) return;
        const a = B.playerAdv(d, t, p, TA[t], TA[1 - t], gameAvg);
        slb.player.push({ a, x, TT: TA[t], OT: TA[1 - t] });
        const key = name + '|' + p.name;
        const SP = slb.seasonPlayer[key] = slb.seasonPlayer[key] || { games: 0, name: p.name, x: { oc: {} }, TT: {}, OT: {}, sit: {}, zone: {} };
        SP.games++;
        addInto(SP.x, x, STAT_KEYS); addInto(SP.x.oc, x.oc, OC_KEYS);
        addInto(SP.TT, TA[t], TOTAL_KEYS.concat(['possessions'])); addInto(SP.OT, TA[1 - t], TOTAL_KEYS.concat(['possessions']));
        const ps = side.players[p.id];
        if (ps) {
          GP.SITS.forEach(k => {
            const s = ps.sits[k];
            if (!s) return;
            slb.psit.push({ key: k, s });
            SP.sit[k] = addInto(SP.sit[k] || {}, s, ['pts', 'fga', 'fgm', 'p3a', 'p3m', 'fta', 'ftm', 'tov']);
            const zs = SP.zone[k] = SP.zone[k] || {};
            ZONES.forEach(zn => { zs[zn] = addInto(zs[zn] || {}, s.zones[zn], ['a', 'm']); slb.zone.push({ key: 'player.' + k + '.' + zn, z: s.zones[zn] }); });
            zs.all = addInto(zs.all || {}, zoneAll(s), ['a', 'm']);
            slb.zone.push({ key: 'player.' + k + '.all', z: zoneAll(s) });
          });
        }
      });
    });
  }
  if (!parityChecked) throw new Error('no SLB game survived the gate');
  console.log('SLB: ' + slb.games + ' of ' + feeds.length + ' games replayed (' + slb.dropped.length + ' dropped' +
    (slb.dropped.length ? ': ' + slb.dropped.join('; ') : '') + '), ' + slb.player.length + ' player lines; ' +
    'teamAdv and the totals formulas agree on all ' + parityChecked + ' sides');
}

/* ------------------------------------------- 2. SLB seasons, same formulas --- */
const seasonOfPlayer = SP => {
  const pid = 'season';
  const x = Object.assign({}, SP.x, { oc: SP.x.oc });
  const TT = Object.assign({}, SP.TT), OT = Object.assign({}, SP.OT);
  const a = B.playerAdv({ stats: { [pid]: x } }, 0, { id: pid, num: '', name: SP.name }, TT, OT, {});
  return { a, x, TT, OT, games: SP.games };
};
const seasonOfTeam = ST => ({ T: advFromTotals(ST.T, ST.O), O: advFromTotals(ST.O, ST.T), games: ST.games,
  c: Object.fromEntries(Object.entries(ST.c).map(([k, v]) => [k, v])) });

/* ------------------------------------------------ 3. the 48 leagues' seasons --- */
/* team-seasons: this side and its opponents, as box totals */
const pooledTeams = (() => {
  const rows = csv(SRC.seasonTeams);
  const opp = {};
  rows.filter(r => r.type === 'Opponent').forEach(r => { opp[r.league + '|' + r.season + '|' + r.team] = r; });
  const tot = r => ({ pts: f(r.PTS), fgm: f(r.FGM), fga: f(r.FGA), fg3m: f(r.ThreePM), fg3a: f(r.ThreePA), fg2m: f(r.FGM) - f(r.ThreePM),
    fg2a: f(r.FGA) - f(r.ThreePA), ftm: f(r.FTM), fta: f(r.FTA), oreb: f(r.OREB), dreb: f(r.DREB), ast: f(r.AST), stl: f(r.STL),
    blk: f(r.BLK), tov: f(r.TOV), rimA: 0, rimM: 0, midA: 0, midM: 0, ptsAst: 0, minutes: f(r.MIN) });
  const out = [];
  rows.filter(r => r.type === 'Team').forEach(r => {
    const o = opp[r.league + '|' + r.season + '|' + r.team];
    if (!o || !(f(r.GP) >= 10) || !(f(r.FGA) > 0)) return;
    const T = tot(r), O = tot(o);
    out.push({ league: r.league + '|' + r.season, team: r.team, gp: f(r.GP), T: advFromTotals(T, O), O: advFromTotals(O, T), perGame: { tsa: (T.fga + 0.44 * T.fta) / f(r.GP) } });
  });
  return out;
})();
/* the stats a team-season from box totals can give, and how far apart they sit about their league */
const TEAM_BOX = ['ortg', 'drtg', 'ppp', 'efg', 'ts', 'tovp', 'orebp', 'drebp', 'ftr', 'ftp', 'astp', 'astTo', 'stlp', 'blkp', 'p3p', 'p3r', 'tsaPer100', 'paceOwn'];
const pooledTeamSD = (() => {
  const out = {};
  TEAM_BOX.concat(['possessions', 'tsa']).forEach(k => {
    const byLeague = {};
    pooledTeams.forEach(r => {
      const v = k === 'possessions' ? r.T.possessions / r.gp : k === 'tsa' ? r.perGame.tsa : r.T[k];
      (byLeague[r.league] = byLeague[r.league] || []).push(v);
    });
    const dev = [];
    Object.values(byLeague).forEach(vs => { if (vs.length >= 6) { const m = mean(vs); vs.forEach(v => dev.push(v - m)); } });
    out[k] = { sd: sd(dev), n: dev.length };
  });
  return out;
})();

/* player-seasons: per-game averages, with the club's per-game totals for the context usage,
   assist, rebound, steal and block rates need (playerAdv's own formulas, a season as one game) */
const PLAYER_BOX = ['ts', 'ppp', 'usg', 'ftr', 'p3P', 'astPct', 'tovP', 'orebP', 'drebP', 'stlP', 'blkP', 'au'];
const pooledPlayerDev = (() => {
  const teams = {};
  pooledTeams.forEach(r => { teams[r.league + '|' + r.team] = r; });
  const zeroOC = {}; OC_KEYS.forEach(k => { zeroOC[k] = 0; });
  const byLeague = {};
  csv(SRC.seasonPlayers).forEach(r => {
    const lg = r.league + '|' + r.season, tm = teams[lg + '|' + r.team];
    const gp = f(r.GP), mpg = f(r.MPG);
    if (!tm || gp < 10 || mpg < 12) return;
    const per = (v, g) => v / g;
    const TT = Object.assign({}, tm.T), OT = Object.assign({}, tm.O);
    TOTAL_KEYS.concat(['possessions']).forEach(k => { TT[k] = per(tm.T[k], tm.gp); OT[k] = per(tm.O[k], tm.gp); });
    const x = { pts: f(r.PPG), p2m: f(r['2PM']), p2a: f(r['2PA']), p3m: f(r['3PM']), p3a: f(r['3PA']), ftm: f(r.FTM), fta: f(r.FTA),
      or: f(r.ORB), dr: f(r.DRB), ast: f(r.APG), stl: f(r.SPG), blk: f(r.BPG), to: f(r.TO), pf: f(r.PF), fd: 0, pm: 0,
      min: mpg * 60000, ptsAst: 0, rimA: 0, rimM: 0, midA: 0, midM: 0, oc: zeroOC };
    const a = B.playerAdv({ stats: { p: x } }, 0, { id: 'p', num: '', name: '' }, TT, OT, {});
    const ctx = { a, x, TT, OT };
    const row = {};
    PLAYER_BOX.forEach(k => {
      const s = GP.sample('player', k, ctx);
      /* a season's worth of the stat's own volume, not one game's */
      if (s && s.n * gp >= GP.PLAYER[k].min * 12) row[k] = s.x;
    });
    (byLeague[lg] = byLeague[lg] || []).push(row);
  });
  const dev = {}; PLAYER_BOX.forEach(k => { dev[k] = []; });
  Object.values(byLeague).forEach(rows => PLAYER_BOX.forEach(k => {
    const vs = rows.map(r => r[k]).filter(v => v != null);
    if (vs.length < 20) return;
    const m = mean(vs); vs.forEach(v => dev[k].push(v - m));
  }));
  return dev;
})();

/* ------------------------------------------------------------ 4. the scales --- */
/* single games: gated and shrunk as gamepct.js reads one, towards the volume-weighted average */
function gameScale(scope, key, ctxs) {
  const st = GP.SCOPES[scope][key];
  const samples = ctxs.map(c => GP.sample(scope, key, c)).filter(Boolean);
  if (samples.length < 20) return null;
  let mu;
  if (st.count === 'max') mu = mean(samples.map(s => s.x));
  else if (st.count) mu = mean(samples.map(s => s.x * 40 / Math.max(40, s.n)));
  else { const nx = samples.reduce((t, s) => t + s.n * s.x, 0), n = samples.reduce((t, s) => t + s.n, 0); mu = n ? nx / n : null; }
  if (mu == null) return null;
  return { mu, q: quantiles(samples.map(s => GP.adjusted(st, s.x, s.n, mu))), n: samples.length };
}
const blend = (QA, QG) => QG.map((g, i) => W * QA[i] + (1 - W) * g);
const normalQ = (m, s) => GRID.map(p => m + s * z(p / 100));

const leagues = {};
const report = [];
function put(league, scope, key, G, QA, how) {
  if (!G || !QA) return;
  const L = leagues[league] = leagues[league] || {};
  (L[scope] = L[scope] || {})[key] = { mu: sig(G.mu), q: blend(QA, G.q).map(sig) };
  if (REPORT) report.push([league, scope, key, how, G.n, sig(G.mu), [G.q[3], G.q[11], G.q[19]].map(sig).join(' / '),
    [QA[3], QA[11], QA[19]].map(sig).join(' / '), [3, 11, 19].map(i => L[scope][key].q[i]).join(' / ')].join('  '));
}

/* SLB */
{
  const seasonsT = Object.values(slb.seasonTeam).map(seasonOfTeam);
  const seasonsP = Object.values(slb.seasonPlayer).map(seasonOfPlayer).filter(s => s.x.min / 60000 >= 200 && s.games >= 8);
  /* TEAMS */
  Object.keys(GP.TEAM).forEach(k => {
    const st = GP.TEAM[k], G = gameScale('team', k, slb.team);
    if (!G) return;
    const vals = seasonsT.map(s => {
      if (st.count) return (k === 'tsa' ? s.T.tsa : k === 'possessions' ? s.T.possessions : s.c[k]) / s.games;
      const x = GP.sample('team', k, s);
      return x ? x.x : null;
    }).filter(v => v != null);
    const m = mean(vals);
    const pooled = pooledTeamSD[k];
    const s = pooled && pooled.sd != null ? pooled.sd : sd(vals);
    put('slb-men', 'team', k, G, normalQ(m, s), pooled && pooled.sd != null ? 'season sd: 48 leagues (' + pooled.n + ')' : 'season sd: SLB teams (' + vals.length + ')');
  });
  /* PLAYERS */
  Object.keys(GP.PLAYER).forEach(k => {
    const st = GP.PLAYER[k], G = gameScale('player', k, slb.player);
    if (!G) return;
    const vals = seasonsP.map(s => {
      if (st.count) return s.a[k] / s.games;
      const x = GP.sample('player', k, s);
      return x && x.n >= st.min * 12 ? x.x : null;
    }).filter(v => v != null);
    const dev = pooledPlayerDev[k];
    if (dev && dev.length >= 200) put('slb-men', 'player', k, G, quantiles(dev).map(v => v + mean(vals)), 'season: 48 leagues (' + dev.length + ') about SLB\'s ' + sig(mean(vals)));
    else if (vals.length >= 30) put('slb-men', 'player', k, G, quantiles(vals), 'season: SLB players (' + vals.length + ')');
  });
  /* SITUATIONS, a side's. freq (how often this side gets the chance at all, not what it did
     with the ones it got) only exists for the four keys gamepct.js defines a direction for --
     'all' is trivially 100% of itself and after-timeout frequency is a count of timeouts
     called, not a skill. */
  GP.SITS.forEach(sk => ['ppp', 'efg', 'tov'].concat((sk + '.freq') in GP.SIT ? ['freq'] : []).forEach(stat => {
    const key = sk + '.' + stat;
    const G = gameScale('sit', key, slb.sit.filter(r => r.key === sk));
    if (!G) return;
    const vals = seasonsT.length ? Object.values(slb.seasonTeam).map(ST => GP.sample('sit', key, { s: bucketOf(ST.sit[sk]), all: bucketOf(ST.sit.all) })).filter(Boolean).map(s => s.x) : [];
    put('slb-men', 'sit', key, G, normalQ(mean(vals), sd(vals)), 'season: SLB teams (' + vals.length + ')');
  }));
  /* A SPLIT TOO THIN FOR ITS OWN SEASON SPREAD. Few players take thirty shots after a timeout
     in a season, so a situation or a zone with fewer than thirty player-seasons (five teams)
     borrows the spread of the whole — every situation, or every zone — about its own average. */
  const spreadAbout = (vals, mu) => { const m = mean(vals); return quantiles(vals).map(v => v - m + mu); };
  /* SITUATIONS, a player's eFG% */
  const psitSeason = sk => Object.values(slb.seasonPlayer).filter(SP => SP.sit[sk] && SP.sit[sk].fga >= 25)
    .map(SP => 100 * (SP.sit[sk].fgm + 0.5 * SP.sit[sk].p3m) / SP.sit[sk].fga);
  GP.SITS.forEach(sk => {
    const key = sk + '.efg';
    const G = gameScale('psit', key, slb.psit.filter(r => r.key === sk));
    if (!G) return;
    const vals = psitSeason(sk);
    if (vals.length >= 30) put('slb-men', 'psit', key, G, quantiles(vals), 'season: SLB players (' + vals.length + ')');
    else put('slb-men', 'psit', key, G, spreadAbout(psitSeason('all'), G.mu), 'season: all situations\' spread (' + psitSeason('all').length + ')');
  });
  /* ZONES */
  const zoneSeason = (who, sk, zn) => (who === 'team' ? Object.values(slb.seasonTeam) : Object.values(slb.seasonPlayer))
    .map(X => X.zone[sk] && X.zone[sk][zn]).filter(zz => zz && zz.a >= (who === 'team' ? 20 : 15)).map(zz => 100 * zz.m / zz.a);
  Object.keys(GP.ZONE).forEach(key => {
    const [who, sk, zn] = key.split('.');
    const G = gameScale('zone', key, slb.zone.filter(r => r.key === key));
    if (!G) return;
    const vals = zoneSeason(who, sk, zn), whole = zoneSeason(who, 'all', zn);
    if (who === 'team') {
      const own = vals.length >= 5;
      put('slb-men', 'zone', key, G, normalQ(G.mu, sd(own ? vals : whole)), 'season sd: SLB teams (' + (own ? vals.length : 'all situations, ' + whole.length) + ')');
    } else if (vals.length >= 30) put('slb-men', 'zone', key, G, quantiles(vals), 'season: SLB players (' + vals.length + ')');
    else if (whole.length >= 30) put('slb-men', 'zone', key, G, spreadAbout(whole, G.mu), 'season: all situations\' spread (' + whole.length + ')');
  });
}

/* BCB: its own team games for what box totals give, SLB's scales moved by the leagues' ratio for the rest */
const ratios = (() => {
  const league = rel => {
    const rows = csv(rel), byGame = {};
    rows.forEach(r => { (byGame[r.game_id] = byGame[r.game_id] || []).push(r); });
    const T = {}, O = {};
    Object.values(byGame).filter(g => g.length === 2).forEach(g => [0, 1].forEach(i => {
      const me = g[i], them = g[1 - i];
      const tot = r => ({ pts: f(r.points), fgm: f(r.fgm), fga: f(r.fga), fg3m: f(r.fg3m), fg3a: f(r.fg3a), fg2m: f(r.fg2m), fg2a: f(r.fg2a),
        ftm: f(r.ftm), fta: f(r.fta), oreb: f(r.oreb), dreb: f(r.dreb), ast: f(r.ast), stl: f(r.stl), blk: f(r.blk), tov: f(r.tov), minutes: 200 });
      addInto(T, tot(me), Object.keys(tot(me))); addInto(O, tot(them), Object.keys(tot(them)));
    }));
    ['rimA', 'rimM', 'midA', 'midM', 'ptsAst'].forEach(k => { T[k] = 0; O[k] = 0; });
    return advFromTotals(T, O);
  };
  const S0 = league(SRC.slbTeams), B0 = league(SRC.bcbTeams);
  const r = {};
  ['ortg', 'ppp', 'efg', 'ts', 'tovp', 'orebp', 'drebp', 'ftr', 'ftp', 'astp', 'stlp', 'blkp', 'p3p', 'p3r', 'fgp', 'pppUsed', 'ptsPer40', 'paceOwn', 'tsaPer100']
    .forEach(k => { r[k] = S0[k] ? B0[k] / S0[k] : 1; });
  return r;
})();
const ANALOG = {
  team: { rimp: 'efg', midp: 'efg', rimr: null, astPtsP: null, tsa: 'tsaPer100', possessions: 'paceOwn',
          paint: 'ptsPer40', fast: 'ptsPer40', sc: 'ptsPer40', pot: 'ptsPer40', bench: 'ptsPer40', lead: null },
  player: { ts: 'ts', ppp: 'pppUsed', usg: null, ftr: 'ftr', rimP: 'efg', midP: 'efg', p3P: 'p3p', tpc: 'ptsPer40', astPct: 'astp',
            tovP: 'tovp', orebP: 'orebp', drebP: 'drebp', stlP: 'stlp', blkP: 'blkp', au: 'astp', pacePM: null,
            ocOrtg: 'ortg', ocDrtg: 'ortg', net: null, ocEfg: 'efg', ocOreb: 'orebp', ocTov: 'tovp', ocOppEfg: 'efg', ocOppOreb: 'orebp', ocTovF: 'tovp' },
  sit: key => ({ ppp: 'ppp', efg: 'efg', tov: 'tovp' })[key.split('.')[1]],
  psit: () => 'efg',
  zone: key => (key.endsWith('.three') ? 'p3p' : key.endsWith('.all') ? 'fgp' : 'efg')
};
const bcbTeamGames = (() => {
  const byGame = {};
  csv(SRC.bcbTeams).forEach(r => { (byGame[r.game_id] = byGame[r.game_id] || []).push(r); });
  const out = [];
  Object.values(byGame).filter(g => g.length === 2).forEach(g => {
    /* the pipeline's own possessions and pace put the game's length back: 40 minutes, or 45 with an overtime */
    const mins = Math.max(40, 5 * Math.round((40 * f(g[0].poss) / Math.max(1, f(g[0].pace))) / 5));
    const tot = r => ({ pts: f(r.points), fgm: f(r.fgm), fga: f(r.fga), fg3m: f(r.fg3m), fg3a: f(r.fg3a), fg2m: f(r.fg2m), fg2a: f(r.fg2a),
      ftm: f(r.ftm), fta: f(r.fta), oreb: f(r.oreb), dreb: f(r.dreb), ast: f(r.ast), stl: f(r.stl), blk: f(r.blk), tov: f(r.tov),
      rimA: 0, rimM: 0, midA: 0, midM: 0, ptsAst: 0, minutes: 5 * mins });
    const A = [advFromTotals(tot(g[0]), tot(g[1])), advFromTotals(tot(g[1]), tot(g[0]))];
    if (A.some(a => a.possessions < 55 || a.possessions > 115 || a.pts < 35)) return;
    out.push({ T: A[0], O: A[1] }, { T: A[1], O: A[0] });
  });
  return out;
})();
{
  const bcbSeasons = pooledTeams.filter(r => r.league === 'BCB|2025-2026');
  const moved = (scope, key, ref) => {
    const a = typeof ANALOG[scope] === 'function' ? ANALOG[scope](key) : ANALOG[scope][key];
    const r = a ? ratios[a] : 1;
    return { mu: sig(ref.mu * r), q: ref.q.map(v => sig(v * r)), analog: a, r };
  };
  const S0 = leagues['slb-men'];
  Object.keys(S0).forEach(scope => Object.keys(S0[scope]).forEach(key => {
    const L = leagues.bcb = leagues.bcb || {};
    if (scope === 'team' && TEAM_BOX.indexOf(key) >= 0) {
      const G = gameScale('team', key, bcbTeamGames);
      const vals = bcbSeasons.map(s => s.T[key]);
      if (G && vals.length >= 10) {
        put('bcb', 'team', key, G, normalQ(mean(vals), pooledTeamSD[key].sd), 'BCB games (' + G.n + '), season: BCB ' + sig(mean(vals)) + ' ± 48 leagues');
        return;
      }
    }
    const m = moved(scope, key, S0[scope][key]);
    (L[scope] = L[scope] || {})[key] = { mu: m.mu, q: m.q };
    if (REPORT) report.push(['bcb', scope, key, 'SLB × ' + (m.analog ? m.analog + ' ' + m.r.toFixed(3) : '1'), '', m.mu, '', '', [3, 11, 19].map(i => m.q[i]).join(' / ')].join('  '));
  }));
  console.log('BCB: ' + bcbTeamGames.length + ' team games; SLB → BCB ratios ' +
    Object.entries(ratios).map(([k, v]) => k + ' ' + v.toFixed(3)).join(', '));
}

/* ------------------------------------------------------------------ write --- */
const count = L => Object.values(L).reduce((n, s) => n + Object.keys(s).length, 0);
const DATA = {
  version: 1,
  built: new Date().toISOString().slice(0, 10),
  grid: GRID,
  seasonWeight: W,
  fallback: 'slb-men',
  alias: {},
  leagues: {
    'slb-men': Object.assign({ label: 'SLB 2025-26 games, weighted to season averages', games: slb.games }, leagues['slb-men']),
    'bcb': Object.assign({ label: 'BCB 2025-26 games, weighted to season averages', games: bcbTeamGames.length / 2 }, leagues.bcb)
  }
};
const body = JSON.stringify(DATA).replace(/\},"/g, '},\n"');
const out = `/* ============================================================================
   GAME PERCENTILE SCALES — GENERATED FILE, DO NOT EDIT.

   Written by tools/build-gamepct.mjs from a season of real games (see there
   for what went in and how each scale is made); read by epinoia/gamepct.js.
   Rebuild with:  node tools/build-gamepct.mjs

   Every stat: mu, the league average a small sample is pulled towards, and q,
   the value at each percentile of grid.
   ============================================================================ */
(function (root) {
  const DATA = ${body};
  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.EpinoiaGamePctData = DATA;
}(typeof globalThis !== 'undefined' ? globalThis : self));
`;
fs.writeFileSync(OUT, out);
console.log('wrote ' + path.relative(ROOT, OUT) + ' — slb-men ' + count(leagues['slb-men']) + ' scales, bcb ' + count(leagues.bcb) +
  ' scales, ' + (out.length / 1024).toFixed(0) + 'KB');
if (REPORT) {
  console.log('\nleague  scope  stat  source  games  mu  single-game p10/p50/p90  season p10/p50/p90  blended p10/p50/p90');
  report.forEach(l => console.log(l));
}
