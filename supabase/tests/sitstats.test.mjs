/* ============================================================================
   EVENTS SPLITS OVER A SEASON — season.js's ev_ / evd_ keys and the table
   presets that show them.

   Nothing here is hand-typed stats rows. The game is the hand-worked log from
   events.test.mjs, run through the real calculator (epinoia/situations.js),
   stored the way finalise-game stores it (toStored under stats.sit) beside the
   engine's own box score, and wrapped as four games of one little season:

     g1  the log as it happened              Leeds home, Hull away
     g2  the same log with the sides swapped Hull home, Leeds away
     g3  the first period only               Leeds home (a different line)
     g4  the log again, but its SIDE lines carry no splits (a game from before
         they existed); the player rows keep theirs, and must still not count

   Every number asserted is worked from the log's comments, not read back from
   the code: the season rollup is sums over covered games, rates from the sums,
   per game over ev_gp, and null -- not zero -- with no coverage.

     node supabase/tests/sitstats.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Sit = require(path.join(ROOT, 'epinoia', 'situations.js'));
const Eng = require(path.join(ROOT, 'epinoia', 'engine.js'));
const Season = require(path.join(ROOT, 'epinoia', 'season.js'));
const Table = require(path.join(ROOT, 'epinoia', 'fulltable.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
/* every key named, each compared exactly: the rollup rounds, so the hand values are rounded too */
const same = (n, row, want) => {
  const bad = Object.keys(want).filter(k => !(k in row) || row[k] !== want[k]);
  ok(n, bad.length === 0, bad.map(k => k + ': got ' + JSON.stringify(row[k]) + ', want ' + JSON.stringify(want[k])).join('; '));
};

/* ---- the hand log, as events.test.mjs builds it ----------------------------- */
const player = (t, i, name) => ({ id: (t ? 'a' : 'h') + i, name, num: String(i) });
const S = {
  teams: [
    { name: 'Leeds Force', players: [1, 2, 3, 4, 5, 6].map(i => player(0, i, ['', 'Ada Stone', 'Bea Moss', 'Cy Hart', 'Dee Lowe', 'Eve Park', 'Flo <b>Ray</b>'][i])) },
    { name: 'Hull Pirates', players: [1, 2, 3, 4, 5, 6].map(i => player(1, i, ['', 'Gus Roe', 'Hal Fox', 'Ian Pike', 'Jo Kent', 'Kit Lane', 'Lou Dale'][i])) }
  ],
  starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
  period: 2, clockMs: 500000,
  events: []
};
let seq = 0;
const ev = (t, team, pid, clock, extra, period) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team, pid, period: period || 1, clock }, extra || {})); return s; };
const desc = (t, ref, extra) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team: null, pid: null, period: 1, clock: null, ref }, extra)); };

ev('period_start', null, null, 600000);
ev('p2_miss', 0, 'h1', 590000);                                   // A1  half court
ev('reb', 0, 'h2', 588000, { off: true });
const putback = ev('p2_made', 0, 'h2', 587000);                   // A2  second chance, 2
desc('stype', putback, { v: 'putback' });
ev('p3_miss', 1, 'a1', 570000);                                   // B1  half court
ev('reb', 0, 'h3', 568000, { off: false });                       //     the break opens
const layup = ev('p2_made', 0, 'h3', 563000);                     // A3  transition (5 s), 2, assisted
desc('stype', layup, { v: 'layup' });
ev('ast', 0, 'h1', 563000);
ev('p2_miss', 1, 'a2', 550000);                                   // B2  half court
ev('reb', 0, 'h4', 548000, { off: false });
const jumper = ev('p2_miss', 0, 'h4', 530000);                    // A4  18 s after the rebound: half court
desc('stype', jumper, { v: 'jump shot' }); desc('loc', jumper, { x: 0.5, y: 0.3 });   // in the paint, but a jump shot
ev('reb', 1, 'a3', 528000, { off: false });
ev('to', 1, 'a3', 515000);                                        // B3  half court turnover
ev('stl', 0, 'h5', 515000);
ev('p3_made', 0, 'h5', 505000);                                   // A5  off the turnover, 3 (10 s: not a break)
ev('timeout', 1, null, 505000);                                   //     Hull's timeout
ev('p2_miss', 1, 'a4', 490000);                                   // B4  after timeout (own)
ev('reb', 1, 'a5', 488000, { off: true });
ev('p2_made', 1, 'a5', 487000);                                   // B5  second chance, 2 -- the same set
ev('p2_miss', 0, 'h1', 470000);                                   // A6  half court
ev('reb', 0, 'h1', 468000, { off: true });
ev('foul', 1, 'a1', 466000, { kind: 'shooting' });
ev('ft_made', 0, 'h1', 466000);                                   // A7  second chance, 1
ev('timeout', 0, null, 466000);                                   //     Leeds' timeout between free throws
ev('ft_made', 0, 'h1', 466000);                                   //     the engine has shut the window: not second chance
ev('p3_made', 1, 'a1', 450000);                                   // B6  after timeout (theirs), 3, assisted
ev('ast', 1, 'a2', 450000);
ev('foul', 0, 'h2', 440000, { kind: 'shooting' });
ev('ft_made', 1, 'a3', 440000);                                   // B7  half court, 1
ev('ast', 1, 'a4', 440000);                                       //     a pass that drew free throws
ev('ft_miss', 1, 'a3', 440000);
ev('reb', 0, 'h2', 438000, { off: false });
ev('timeout', 1, null, 438000);                                   //     the last timeout of the period: sets nothing up
ev('period_start', null, null, 600000, null, 2);
const late = ev('p2_made', 0, 'h6', 590000, null, 2);             // A9  half court, 2
desc('loc', late, { x: 0.5, y: 0.2 });

/* ---- the variants ----------------------------------------------------------- */
const swap = G => ({
  teams: [G.teams[1], G.teams[0]], starters: [G.starters[1], G.starters[0]], period: G.period, clockMs: G.clockMs,
  events: G.events.map(e => Object.assign({}, e, { team: e.team === 0 ? 1 : e.team === 1 ? 0 : e.team }))
});
const firstPeriod = G => ({
  teams: G.teams, starters: G.starters, period: 1, clockMs: 0,
  events: G.events.filter(e => !(e.period === 2 || e.ref === late))
});

const LEEDS = 'team-leeds', HULL = 'team-hull';
const byId = {};
const pgs = [], tgs = [];
/* the rows finalise-game writes, in the shape data.js hands season.js */
function addGame(id, G, home, away, opts) {
  const o = opts || {};
  const d = Eng.deriveGame(G);
  const TA = [Eng.teamAdv(G, d, 0), Eng.teamAdv(G, d, 1)];
  const C = Sit.compute(G);
  if (!C.possessions) throw new Error('possessions.js did not load');
  const SIT = Sit.toStored(C);
  byId[id] = { id, home_team_id: home, away_team_id: away, home_score: d.score[0], away_score: d.score[1] };
  [0, 1].forEach(t => {
    G.teams[t].players.forEach(p => {
      const stats = Object.assign({}, d.stats[p.id], { adv: Eng.playerAdv(G, d, t, p, TA[t], TA[1 - t]) });
      if (o.min && o.min[p.id] != null) stats.min = o.min[p.id];
      if (SIT.players[p.id]) stats.sit = SIT.players[p.id];
      pgs.push({ game_id: id, player_uuid: null, player_id: p.id, team_idx: t, stats });
    });
    const stats = Object.assign({}, d.team[t], { adv: TA[t], perQ: d.perQ[t], score: d.score[t] });
    if (!o.noSideSit) stats.sit = SIT.teams[t];
    tgs.push({ game_id: id, team_idx: t, stats });
  });
  return { d, SIT };
}
/* The log has no substitution, so the engine gives h6 no minutes for his second-period
   basket and a6 none at all. Minutes are set by hand where a case needs them: h6 on the
   floor for the second period of every full game, a6 on for a minute in g1 doing nothing
   the log records -- a player with no line of his own on a covered night. */
const H6 = { h6: 100000 };
const g1 = addGame('g1', S, LEEDS, HULL, { min: { h6: 100000, a6: 60000 } });
addGame('g2', swap(S), HULL, LEEDS, { min: H6 });
const g3 = addGame('g3', firstPeriod(S), LEEDS, HULL);
addGame('g4', S, LEEDS, HULL, { min: H6, noSideSit: true });

const players = Season.players(pgs, tgs);
const teams = Season.teams(tgs, byId);
const P = id => players.find(r => r.id === id);
const Tm = id => teams.find(r => r.id === id);

console.log('\nthe stored lines are what the log says');
{
  ok('situations.js and season.js read the same field lists',
     JSON.stringify(Season.SIT_FIELDS) === JSON.stringify(Sit.FIELDS) && JSON.stringify(Season.SIT_AFIELDS) === JSON.stringify(Sit.AFIELDS),
     JSON.stringify([Season.SIT_FIELDS, Sit.FIELDS, Season.SIT_AFIELDS, Sit.AFIELDS]));
  const L = g1.SIT.teams[0], L3 = g3.SIT.teams[0], H = g1.SIT.teams[1];
  ok('Leeds, the whole game: 11 pts, 4/7, a three, rim 3/3, mid 0/3, FT 2/2, 8 chances',
     JSON.stringify(L.all) === '[11,4,7,1,1,3,3,0,3,2,2,0,8]', JSON.stringify(L.all));
  ok('Leeds, first period only: the second-period layup and its chance are gone',
     JSON.stringify(L3.all) === '[9,3,6,1,1,2,2,0,3,2,2,0,7]' && JSON.stringify(L3.half) === '[0,0,3,0,0,0,0,0,3,0,0,0,3]', JSON.stringify([L3.all, L3.half]));
  ok('Hull: 6 pts, 2/5, 7 chances, a turnover; after-timeout sets 2 for 5 pts; one free-throw assist',
     JSON.stringify(H.all) === '[6,2,5,1,2,0,0,1,3,1,2,1,7]' && JSON.stringify(H.ato) === '[5,2,3,1,1,0,0,1,2,0,0,0,2]' && H.ftAst === 1,
     JSON.stringify([H.all, H.ato, H.ftAst]));
  ok('a player who did nothing the log records gets no line (a6)', !g1.SIT.players.a6 && !!g1.SIT.players.h6);
}

console.log('\na team over the season: sums over covered games, rates from the sums');
{
  const L = Tm(LEEDS);
  ok('Leeds played four games, three of them carry the splits (g4 does not)', L.gp === 4 && L.ev_gp === 3 && L.evd_gp === 3, [L.gp, L.ev_gp, L.evd_gp].join());
  same('all shots: 31 pts, 11/20 with 3 threes, 23 chances', L, {
    ev_all_pts: 31, ev_all_ppg: 10.3, ev_all_pts_sh: 100,
    ev_all_fgm: 11, ev_all_fga: 20, ev_all_fgm_pg: 3.7, ev_all_fga_pg: 6.7, ev_all_fga_sh: 100,
    ev_all_fg_pct: 55, ev_all_efg: 62.5,                      // (11 + 1.5) / 20
    ev_all_rimM: 8, ev_all_rimA: 8, ev_all_rim_apg: 2.7, ev_all_rim_pct: 100, ev_all_rim_sh: 40,
    ev_all_midM: 0, ev_all_midA: 9, ev_all_mid_apg: 3, ev_all_mid_pct: 0, ev_all_mid_sh: 45,
    ev_all_p3m: 3, ev_all_p3a: 3, ev_all_p3_apg: 1, ev_all_p3_pct: 100, ev_all_p3_sh: 15,
    ev_all_ftm: 6, ev_all_fta: 6, ev_all_fta_pg: 2, ev_all_ft_pct: 100, ev_all_tov: 0, ev_all_tov_pg: 0,
    ev_all_ch: 23, ev_all_ch_pg: 7.7, ev_all_ppp: 1.35, ev_all_freq: 100, ev_all_tov_pct: 0
  });
  same('second chance: the putback and one free throw a game, 1.50 a chance', L, {
    ev_second_pts: 9, ev_second_ppg: 3, ev_second_pts_sh: 29, ev_second_fga_sh: 15,
    ev_second_fg_pct: 100, ev_second_efg: 100, ev_second_rim_sh: 100, ev_second_mid_pct: null,
    ev_second_ftm: 3, ev_second_fta: 3, ev_second_ch: 6, ev_second_ch_pg: 2, ev_second_ppp: 1.5, ev_second_freq: 26.1
  });
  same('transition and off turnovers: one chance a game each, 2 and 3 points', L, {
    ev_transition_pts: 6, ev_transition_ppp: 2, ev_transition_freq: 13, ev_transition_pts_sh: 19.4,
    ev_offTo_pts: 9, ev_offTo_p3m: 3, ev_offTo_p3a: 3, ev_offTo_efg: 150, ev_offTo_p3_sh: 100, ev_offTo_p3_pct: 100,
    ev_offTo_rim_pct: null, ev_offTo_rim_sh: 0, ev_offTo_ppp: 3
  });
  same('after timeout: Leeds never ran a set -- zeros where counted, null where there is nothing to divide', L, {
    ev_ato_pts: 0, ev_ato_ppg: 0, ev_ato_ch: 0, ev_ato_freq: 0, ev_ato_fg_pct: null, ev_ato_efg: null,
    ev_ato_ppp: null, ev_ato_tov_pct: null, ev_ato_pts_sh: 0
  });
  same('half court: 2/11 over the three games, 11 of 23 chances', L, {
    ev_half_pts: 4, ev_half_ppg: 1.3, ev_half_fgm: 2, ev_half_fga: 11, ev_half_fg_pct: 18.2, ev_half_efg: 18.2,
    ev_half_rim_sh: 18.2, ev_half_mid_sh: 81.8, ev_half_midA: 9, ev_half_ch: 11, ev_half_ppp: 0.36, ev_half_freq: 47.8,
    ev_half_pts_sh: 12.9
  });
  same('assisted: 3 baskets for 6; unassisted 8 for 19, three of them threes', L, {
    ev_ast_fgm: 3, ev_ast_pts: 6, ev_ast_p3m: 0, ev_ast_rimM: 3, ev_ast_midM: 0, ev_ast_fgm_pg: 1, ev_ast_pts_pg: 2,
    ev_ast_ppb: 2, ev_ast_rim_sh: 100, ev_ast_mid_sh: 0, ev_ast_p3_sh: 0,
    ev_unast_fgm: 8, ev_unast_pts: 19, ev_unast_p3m: 3, ev_unast_rimM: 5, ev_unast_fgm_pg: 2.7, ev_unast_pts_pg: 6.3,
    ev_unast_ppb: 2.38, ev_unast_rim_sh: 62.5, ev_unast_p3_sh: 37.5,
    ev_ast_sh: 27.3, ev_rim_astp: 37.5, ev_mid_astp: null, ev_p3_astp: 0,
    ev_ftast: 0, ev_ftast_pg: 0
  });
  same('defence: what Hull did against Leeds in the same three games', L, {
    evd_all_pts: 18, evd_all_ppg: 6, evd_all_fga: 15, evd_all_efg: 50, evd_all_ch: 21, evd_all_ppp: 0.86,
    evd_all_tov: 3, evd_all_tov_pct: 14.3, evd_ato_pts: 15, evd_ato_ch: 6, evd_ato_ppp: 2.5, evd_ato_freq: 28.6,
    evd_ast_sh: 50, evd_ftast: 3, evd_ftast_pg: 1, evd_transition_pts: 0, evd_transition_ppp: null
  });

  const H = Tm(HULL);
  const evd = Object.keys(L).filter(k => k.startsWith('evd_'));
  const mirror = evd.filter(k => L[k] !== H['ev_' + k.slice(4)]);
  const back = evd.filter(k => H[k] !== L['ev_' + k.slice(4)]);
  ok('every Leeds defence key is Hull\'s offence key, and the other way round (' + evd.length + ' keys)',
     evd.length > 200 && mirror.length === 0 && back.length === 0, mirror.concat(back).slice(0, 6).join());
  ok('a side\'s keys and a player\'s differ only by what a side carries', 'ev_all_ch' in L && !('ev_all_ch' in P('h1')) && !('evd_all_pts' in P('h1')) && !('ev_ftast' in P('h1')));
}

console.log('\na player over the season');
{
  const h1 = P('h1');
  ok('h1: four games, three with the splits', h1.gp === 4 && h1.ev_gp === 3, [h1.gp, h1.ev_gp].join());
  same('h1: two misses and two free throws a game, one of them a second chance', h1, {
    ev_all_pts: 6, ev_all_ppg: 2, ev_all_fga: 6, ev_all_fg_pct: 0, ev_all_efg: 0, ev_all_midA: 6, ev_all_mid_pct: 0,
    ev_all_rim_pct: null, ev_all_ft_pct: 100, ev_all_fta_pg: 2,
    ev_second_pts: 3, ev_second_pts_sh: 50, ev_second_fga_sh: 0, ev_second_fg_pct: null, ev_second_ftm: 3,
    ev_half_fga: 6, ev_half_pts: 0, ev_half_fga_sh: 100,
    ev_ast_fgm: 0, ev_ast_ppb: null, ev_ast_sh: null, ev_rim_astp: null
  });
  ok('h1: the box score still counts g4, the splits do not (8 points in the box, 6 in the splits)', h1.pts === 8 && h1.ev_all_pts === 6);
  same('h3: every basket assisted, all at the rim, all in transition', P('h3'), {
    ev_ast_fgm: 3, ev_ast_sh: 100, ev_rim_astp: 100, ev_ast_ppb: 2, ev_unast_ppb: null, ev_ast_rim_sh: 100,
    ev_transition_ppg: 2, ev_transition_pts_sh: 100, ev_half_pts: 0
  });
  same('h5: a three a game off a turnover, none assisted', P('h5'), {
    ev_all_pts: 9, ev_all_efg: 150, ev_offTo_pts_sh: 100, ev_offTo_p3_sh: 100,
    ev_unast_fgm: 3, ev_unast_ppb: 3, ev_unast_p3_sh: 100, ev_ast_sh: 0, ev_p3_astp: 0
  });
  same('a1: 3 of 6 from three, the make after a timeout and assisted', P('a1'), {
    ev_all_efg: 75, ev_all_p3_pct: 50, ev_all_p3_sh: 100, ev_ato_pts: 9, ev_ato_ppg: 3, ev_half_fga: 3,
    ev_ast_fgm: 3, ev_ast_sh: 100, ev_p3_astp: 100, ev_ast_ppb: 3, ev_ast_p3_sh: 100
  });
  same('a5: the putback in a set is both second chance and after timeout -- situations overlap', P('a5'), {
    ev_second_pts: 6, ev_ato_pts: 6, ev_second_pts_sh: 100, ev_ato_pts_sh: 100, ev_all_mid_pct: 100,
    ev_unast_mid_sh: 100, ev_mid_astp: 0
  });
  const h6 = P('h6');
  ok('h6: three games in the box, two with the splits (g3 he did not play, g4 has none)', h6.gp === 3 && h6.ev_gp === 2, [h6.gp, h6.ev_gp].join());
  same('h6: a half-court layup a game', h6, { ev_all_pts: 4, ev_all_ppg: 2, ev_half_pts: 4, ev_all_rim_pct: 100, ev_unast_rim_sh: 100 });
  const a6 = P('a6');
  ok('a6: played in g1 with no line of his own -- the game counts, with zeros', a6.gp === 1 && a6.ev_gp === 1, [a6.gp, a6.ev_gp].join());
  same('a6: counts are zero, per game zero, rates null (nothing to divide)', a6, {
    ev_all_pts: 0, ev_all_ppg: 0, ev_all_fga: 0, ev_all_efg: null, ev_all_pts_sh: null, ev_second_pts: 0,
    ev_ast_fgm: 0, ev_ast_sh: null, ev_ast_ppb: null
  });
}

console.log('\nno coverage is null, not zero');
{
  const only = pgs.filter(r => r.game_id === 'g4'), onlyT = tgs.filter(r => r.game_id === 'g4');
  const ps = Season.players(only, onlyT), ts = Season.teams(onlyT, byId);
  const evKeys = r => Object.keys(r).filter(k => /^evd?_/.test(k) && k !== 'ev_gp' && k !== 'evd_gp');
  const h1 = ps.find(r => r.id === 'h1'), L = ts.find(r => r.id === LEEDS);
  ok('a season of uncovered games: ev_gp 0 and every ev_ key null for a player', h1.gp === 1 && h1.ev_gp === 0 &&
     evKeys(h1).length > 150 && evKeys(h1).every(k => h1[k] === null), evKeys(h1).filter(k => h1[k] !== null).slice(0, 5).join());
  ok('...and for a team, both ends', L.ev_gp === 0 && L.evd_gp === 0 && evKeys(L).length > 400 && evKeys(L).every(k => L[k] === null),
     evKeys(L).filter(k => L[k] !== null).slice(0, 5).join());
  const bumped = onlyT.map(r => Object.assign({}, r, { stats: Object.assign({}, r.stats, { sit: Object.assign({}, g1.SIT.teams[r.team_idx], { v: 2 }) }) }));
  ok('a side line of an unknown version is not coverage', Season.teams(bumped, byId).every(r => r.ev_gp === 0 && r.ev_all_pts === null));
}

console.log('\nthe existing season keys do not move');
{
  const strip = rows => rows.map(r => { const stats = Object.assign({}, r.stats); delete stats.sit; return Object.assign({}, r, { stats }); });
  const ps = Season.players(strip(pgs), strip(tgs)), ts = Season.teams(strip(tgs), byId);
  const diff = (a, b) => Object.keys(b).filter(k => !/^evd?_/.test(k)).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const pk = Object.keys(ps[0]).filter(k => !/^evd?_/.test(k));
  const pd = players.flatMap(r => diff(r, ps.find(x => x.id === r.id)).map(k => r.id + '.' + k));
  const td = teams.flatMap(r => diff(r, ts.find(x => x.id === r.id)).map(k => r.id + '.' + k));
  ok('every player key outside ev_ is the same with and without the splits (' + pk.length + ' keys)', pk.length > 100 && pd.length === 0, pd.slice(0, 6).join());
  ok('every team key outside ev_ / evd_ is the same too', td.length === 0, td.slice(0, 6).join());
  const L = Tm(LEEDS), h1 = P('h1');
  ok('...and they are the box score: Leeds 4 games, 42 for (10.5 a game), 24 against; h1 8 points',
     L.gp === 4 && L.pts_for === 42 && L.ppg === 10.5 && L.pts_against === 24 && h1.pts === 8 && h1.ppg === 2,
     JSON.stringify([L.gp, L.pts_for, L.ppg, L.pts_against, h1.pts, h1.ppg]));
  const tl = Season.teamLine(tgs[0].stats);
  ok('teamLine passes the side line through untouched and every count stays a number',
     tl.sit === tgs[0].stats.sit && Object.keys(tl).filter(k => k !== 'sit').every(k => typeof tl[k] === 'number'));
}

console.log('\nthe table presets');
{
  const EV = [['ev_second', 'events · second chance'], ['ev_transition', 'events · transition'],
              ['ev_offTo', 'events · off turnovers'], ['ev_ato', 'events · after timeout'],
              ['ev_half', 'events · half court'], ['ev_assist', 'events · assisted']];
  const BAD = /NaN|undefined|Infinity/;
  const cases = [['player', Table.PLAYER_COLS, players], ['team', Table.TEAM_COLS, teams]];
  const nullRows = {
    player: Season.players(pgs.filter(r => r.game_id === 'g4'), tgs.filter(r => r.game_id === 'g4')),
    team: Season.teams(tgs.filter(r => r.game_id === 'g4'), byId)
  };
  for (const [kind, CAT, rows] of cases) {
    const presets = Table.PRESETS[kind];
    ok(kind + ': the six events presets, labelled, before everything',
       EV.every(([k, l]) => presets.some(p => p[0] === k && p[1] === l)) &&
       presets[presets.length - 1][0] === '*' && presets.findIndex(p => p[0] === 'ev_second') > 0,
       JSON.stringify(presets.map(p => p[0])));
    const keys = CAT.map(c => c.k);
    ok(kind + ': column keys are unique', new Set(keys).size === keys.length, keys.filter((k, i) => keys.indexOf(k) !== i).join());
    for (const [g] of EV) {
      const cols = CAT.filter(c => c.g.includes(g));
      const missing = cols.filter(c => !rows.every(r => Object.prototype.hasOwnProperty.call(r, c.k)));
      ok(kind + ' ' + g + ': ' + cols.length + ' columns, every key on the season rows', cols.length >= 10 && missing.length === 0, missing.map(c => c.k).join());
      ok(kind + ' ' + g + ': GP and EV GP are in the preset', cols.some(c => c.k === 'gp') && cols.some(c => c.k === 'ev_gp'));
      const long = cols.filter(c => c.l.length > 8);
      ok(kind + ' ' + g + ': headers are 8 characters or fewer', long.length === 0, long.map(c => c.l).join());
      const printed = [];
      [...rows, ...nullRows[kind]].forEach((r, i) => cols.forEach(c => { const s = String(c.fmt(r, i)); if (BAD.test(s)) printed.push(c.k + '=' + s); }));
      ok(kind + ' ' + g + ': no NaN, undefined or Infinity, covered or not', printed.length === 0, printed.slice(0, 6).join());
      const dashed = nullRows[kind].every(r => cols.filter(c => c.k !== 'gp' && c.k !== 'ev_gp').every(c => c.fmt(r, 0) === '—'));
      ok(kind + ' ' + g + ': an uncovered row is all dashes', dashed);
    }
  }
  const T = Table.TEAM_COLS, Pl = Table.PLAYER_COLS;
  const byK = (CAT, k) => CAT.find(c => c.k === k) || {};
  ok('opponent columns rank lower-is-better where a defence concedes them',
     ['evd_second_ppg', 'evd_second_ppp', 'evd_second_efg', 'evd_second_ch_pg', 'evd_half_ppp', 'evd_ast_sh'].every(k => byK(T, k).low === 1) &&
     !byK(T, 'evd_half_ch_pg').low && !byK(T, 'evd_ato_ch_pg').low && byK(T, 'ev_second_tov_pct').low === 1 && byK(Pl, 'ev_offTo_tov_pg').low === 1);
  ok('rate and volume columns are in the heat map, the made-attempted pair is not',
     byK(Pl, 'ev_second_efg').heat === 1 && byK(T, 'ev_half_ppp').heat === 1 && byK(Pl, 'ev_ast_sh').heat === 1 && !byK(Pl, 'ev_second_fgm_pg').heat);
  const h1 = P('h1');
  ok('the pair column reads made-attempted per game', byK(Pl, 'ev_second_fgm_pg').fmt(h1) === '0.0-0.0' && byK(Pl, 'ev_half_fgm_pg').fmt(h1) === '0.0-2.0',
     byK(Pl, 'ev_half_fgm_pg').fmt(h1));
  ok('every events column names its situation for the hover title', Pl.concat(T).filter(c => /^evd?_/.test(c.k)).every(c => typeof c.t === 'string' && c.t.length > 4));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
