/* ============================================================================
   THE SQUAD MODEL (epinoia/t/squad.js; the Front office, Louie 2026-10-08): positions and players priced in points of
   margin a game through the league's four factors, the squad as a whole, and the roster what-if. Pinned here:
     * the identities: the team's rebounding, steals and blocks are the five positions' rates SUMMED (each player's rate is
       against his share of the floor time), the shooting the shots' own average;
     * a small gap inside a position is priced in full (a centre's DRB% 20 -> 23 is three points of team DREB%), at the
       league's b, whoever else plays;
     * each position against the league's same position (its place among the clubs, lower-is-better TOV%), each player
       against the league's average player at his positions, the scoring value (plays x the PPP gap);
     * the what-if: a removed player's minutes go to the others at his positions, an added one takes his minutes a game at
       his own positions, every position stays one game long, and the change is priced;
     * the usage sim: the floor's usage still adds up after a move, a scorer among ball handlers squeezed more than in a
       balanced side, the role players keeping their 12%, the skill curve;
     * the play-by-play's splits where they cover half a player's games: self-created points per 40 (ball handling beside
       AST%), each top user's half-court usage, share, TS%, TOV% and points a play against the league's half court, the
       ball moving; who covers for whom; the groups; the shape; nobody at a position filled from the one beside it;
     * fewer than four clubs: no model.
     node supabase/tests/squad.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Q = require(path.join(ROOT, 'epinoia', 't', 'squad.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

/* six clubs, five starters (one a position, 30 minutes) and three backups (10 minutes each at two positions) */
const VALUES = { c_efg: { b: 1.0 }, c_tovp: { b: -1.0 }, c_orebp: { b: 0.4 }, c_ftr: { b: 0.1 } };
function row(id, o) {
  const min = o.min || 300, gp = 10;
  const fga = (o.fga40 || 12) * min / 40, fta = (o.fta40 || 4) * min / 40, tov = (o.tov40 || 2) * min / 40, p3a = (o.p3a40 || 4) * min / 40;
  const efg = o.efg || 50, p3m = p3a * (o.p3p || 35) / 100, fgm = (efg / 100) * fga - 0.5 * p3m, ftm = 0.75 * fta;
  const pts = 2 * fgm + p3m + ftm, plays = fga + 0.44 * fta + tov;
  return { id, min, gp, fga, fta, tov, p3a, p3m, fgm, ftm, pts, reb: 6 * min / 40, ast: 3 * min / 40, stl: 1 * min / 40, blk: 0.5 * min / 40, rimA: fga / 3,
    oreb_pct: o.orb != null ? o.orb : 6, dreb_pct: o.drb != null ? o.drb : 15, stl_pct: o.stl != null ? o.stl : 1.5, blk_pct: o.blk != null ? o.blk : 1, ast_pct: o.ast != null ? o.ast : 15,
    usg: o.usg != null ? o.usg : 20, tov_pct: 100 * tov / plays, ts: 100 * pts / (2 * (fga + 0.44 * fta)), efg, p3_pct: o.p3p || 35, p3_rate: 100 * p3a / fga,
    rim_rate: 33, rim_pct: 60, ftr: 100 * fta / fga, ft_pct: 75, ppp: pts / plays, vorp: o.vorp != null ? o.vorp : 0.5, bpm: 0, bpm_pos: o.pos || 3 };
}
const players = [], teamOf = new Map(), pos = new Map();
for (let t = 0; t < 6; t++) {
  const tid = 'T' + t, pl = [];
  [1, 2, 3, 4, 5].forEach((p, k) => {
    const id = tid + '-s' + p;
    pl.push({ id, min: [0, 0, 0, 0, 0].map((_, j) => (j === k ? 300 : 0)) });
    players.push(row(id, { min: 300, pos: p, drb: p >= 4 ? 20 + t * 0.2 : 12, orb: p >= 4 ? 9 : 3, ast: p === 1 ? 30 : 12, blk: p === 5 ? 4 : 0.8, efg: 50 + (t % 3) }));
    teamOf.set(id, tid);
  });
  [1, 3, 5].forEach(p => {
    const id = tid + '-b' + p, k = p - 1, k2 = Math.min(4, k + 1);
    pl.push({ id, min: [0, 0, 0, 0, 0].map((_, j) => (j === k ? 50 : j === k2 ? 50 : 0)) });
    players.push(row(id, { min: 100, pos: p + 0.5, drb: p >= 4 ? 18 : 12, orb: 5 }));
    teamOf.set(id, tid);
  });
  pos.set(tid, { games: 10, players: pl });
}
const names = new Map(players.map(p => [p.id, 'Name ' + p.id]));
const base = { players, teamOf, pos, values: VALUES, sigma: 12, G: 30, gameMin: 40, names };

console.log('the identities');
{
  const m = Q.build(Object.assign({ club: 'T0' }, base));
  ok('a model for the club, from the lineups\' minutes, six clubs', m && m.source === 'lineups' && m.n === 6, m && { source: m.source, n: m.n });
  const slotDrb = m.slots.map(s => s.stats.dreb_pct ? s.stats.dreb_pct.v : null);
  ok('the team\'s DREB% is the five positions\' DRB% summed', near(m.team.mine.dreb_pct, slotDrb.reduce((a, v) => a + v, 0), 1e-9), [m.team.mine.dreb_pct, slotDrb]);
  ok('...every position one game long (the minutes scaled to 40 at each)', m.slots.every(s => near(s.players.reduce((a, p) => a + p.min, 0), 40, 1e-9)));
  const S = Q.sumSquad([1, 2, 3, 4, 5].map(k => ({ line: Q.lineOf(players.find(p => p.id === 'T0-s' + k)), at: [0, 0, 0, 0, 0].map((_, j) => (j === k - 1 ? 40 : 0)) })));
  const efgSh = S.slot.reduce((a, s) => a + s.vol.efgm, 0) / S.slot.reduce((a, s) => a + s.vol.fga, 0) * 100;
  ok('the team\'s eFG% is the shots\' own average, not the positions\' mean', near(S.team.rate.efg, efgSh, 1e-9));
}

console.log('\na small gap inside a position, priced in full');
{
  const lo = Q.build(Object.assign({ club: 'T0' }, base));
  const p2 = players.map(p => (p.id === 'T0-s5' ? Object.assign({}, p, { dreb_pct: p.dreb_pct + 3 }) : p));
  const hi = Q.build(Object.assign({}, base, { club: 'T0', players: p2 }));
  const dTeam = hi.team.mine.dreb_pct - lo.team.mine.dreb_pct;
  const shC = 300 / 350;                       // the starter's share of the centre minutes (the backup's 50 there)
  ok('a centre with six-sevenths of the minutes at C, DRB% 20 -> 23: the team\'s DREB% up by 6/7 x 3', near(dTeam, shC * 3, 1e-9), dTeam);
  const dPts = hi.slots[4].parts.dreb - lo.slots[4].parts.dreb;
  ok('...and the centre position\'s defensive-glass value up by b x that, less the league average\'s move (one club of six)', near(dPts, 0.4 * shC * 3 * (5 / 6), 1e-6), dPts);
  ok('the parts\' total is their sum', hi.slots.every(s => near(s.parts.total, Q.PARTS.reduce((a, p) => a + (typeof s.parts[p.k] === 'number' ? s.parts[p.k] : 0), 0), 1e-9)));
  const pr = Q.priceTeam({ efg: 2, tov_pct: 1, oreb_pct: 1, ftr: 1, dreb_pct: 1, stl_pct: 1, blk_pct: 1 }, VALUES);
  ok('the prices: eFG b, TOV b (fewer is better), boards, FT rate, steals as forced turnovers, blocks as 0.27 of eFG',
     near(pr.shoot, 2) && near(pr.tov, -1) && near(pr.oreb, 0.4) && near(pr.ftr, 0.1) && near(pr.dreb, 0.4) && near(pr.stl, 1) && near(pr.blk, 0.27), pr);
}

console.log('\neach position, each player');
{
  const m = Q.build(Object.assign({ club: 'T5' }, base));
  const c = m.slots[4];
  ok('the centre position: its place among the league\'s centres (T5\'s DRB% the highest)', c.stats.dreb_pct.rank === 1 && c.stats.dreb_pct.of === 6, c.stats.dreb_pct);
  ok('...its key statistics first (rebounding for a centre)', c.key5[0] === 'dreb_pct' && c.key5.includes('blk_pct'), c.key5);
  ok('...a lower-is-better statistic\'s z turned round (TOV%)', (() => { const s = m.slots[0].stats.tov_pct; return s && (s.z === null || typeof s.z === 'number'); })());
  ok('...its per-40 production and the league\'s', c.p40 && typeof c.p40.pts === 'number' && c.lgP40 && typeof c.lgP40.pts === 'number');
  ok('...VORP at the position: its players\' VORP by their share of their minutes there (both centres all at C)', c.vorp && near(c.vorp.v, 0.5 + 0.5, 1e-9), c.vorp);
  const pl = m.players.find(p => p.id === 'T5-s5');
  ok('a player: his minutes, his main position, his value against the league\'s average player at it', pl && pl.main === 'C' && near(pl.mpg, 40 * 300 / 350, 1e-9) && typeof pl.pts === 'number', pl);
  const bad = Q.build(Object.assign({}, base, { club: 'T0', players: players.map(p => (p.id === 'T0-s2' ? Object.assign({}, p, { ppp: 0.7, usg: 32 }) : p)) }));
  const sg = bad.players.find(p => p.id === 'T0-s2');
  ok('an inefficient high-usage player: his scoring value negative (his plays at his PPP against the league\'s at his position)', sg.scoring < 0, sg.scoring);
  ok('the squad as a whole: each aggregate against the league\'s, the priced ones in points', m.whole.length >= 8 && m.whole.find(r => r.k === 'dreb').rank === 1 && typeof m.whole.find(r => r.k === 'dreb').pts === 'number');
  ok('usage and efficiency, the heaviest users first', m.usage.length && m.usage.every((u, i, a) => i === 0 || a[i - 1].usg >= u.usg));
}

console.log('\nthe what-if');
{
  const m = Q.build(Object.assign({ club: 'T0' }, base));
  const r = Q.simulate(m, { remove: ['T0-s5'] });
  const C = r.depth[4];
  ok('a centre removed: his minutes go to the others at centre (the backup who plays it)', C.players.length === 1 && C.players[0].id === 'T0-b5' && near(C.players[0].min, 40, 1e-9), C);
  ok('...every position still one game long', r.depth.every(s => near(s.players.reduce((a, p) => a + p.min, 0), 40, 1e-6)), r.depth.map(s => s.players.reduce((a, p) => a + p.min, 0)));
  ok('...the defensive glass falls (the backup\'s DRB% is lower) and is priced', r.d.dreb_pct < 0 && r.parts.dreb < 0 && typeof r.wins30 === 'number', { d: r.d.dreb_pct, p: r.parts.dreb });
  const a = Q.simulate(m, { add: [{ id: 'T5-s5', mpg: 30 }] });
  const AC = a.depth[4];
  ok('a centre added at 30 minutes: he takes 30 at centre, the others give way, centre still 40', AC.players[0].id === 'T5-s5' && near(AC.players[0].min, 30, 1e-9) &&
     near(AC.players.reduce((x, p) => x + p.min, 0), 40, 1e-6), AC);
  ok('...the better rebounder adds defensive glass, in points', a.d.dreb_pct > 0 && a.parts.dreb > 0, { d: a.d.dreb_pct });
  const g = Q.simulate(m, { mpg: { 'T0-s1': 20 } });
  ok('a player\'s minutes cut to 20: the others at his position take up the rest, still 40 there', near(g.depth[0].players.reduce((x, p) => x + p.min, 0), 40, 1e-6) &&
     near(g.depth[0].players.find(p => p.id === 'T0-s1').min, 20, 1e-6), g.depth[0]);
  ok('nothing moved: no change', near(Q.simulate(m, {}).pts, 0, 1e-12));
}

console.log('\nthe usage sim (the plays add up)');
{
  /* two clubs' starters, the same scorer added at small forward in place of the starter there: a regimented club of ball
     handlers (26, 25 and 24% at the guard spots and centre) and a balanced one (20% each) */
  const L = id => Q.lineOf(players.find(p => p.id === id));
  const mk = (id, usg, ppp, unast) => { const l = Object.assign({}, L(id)); l.id = id; l.rate = Object.assign({}, l.rate, { usg, ppp }); l.unast = unast == null ? null : unast; return l; };
  const at = k => [0, 0, 0, 0, 0].map((_, j) => (j === k ? 40 : 0));
  const scorer = mk('NEW', 26, 1.08, 70);
  const handlers = [mk('h1', 26, 1.0, 60), mk('h2', 25, 1.0, 55), mk('h3', 12, 1.0, 10), mk('h4', 12, 1.0, 10), mk('h5', 25, 1.0, 50)];
  const balanced = [0, 1, 2, 3, 4].map(k => mk('b' + k, 20, 1.0, 30));
  const run = squad => {
    const base = squad.map((l, k) => ({ line: l, at: at(k) }));
    const U0 = Q.usageSim(base, null, 40);
    const moved = base.map((w, k) => (k === 2 ? { line: scorer, at: at(2) } : w));
    return { U0, U1: Q.usageSim(moved, U0.T, 40) };
  };
  const A = run(handlers), B = run(balanced);
  const fA = A.U1.rows.reduce((a, r) => a + r.f * r.u2, 0), fB = B.U1.rows.reduce((a, r) => a + r.f * r.u2, 0);
  ok('the floor\'s usage still adds up to what it was (100) after the move', Math.abs(fA - A.U0.T) < 1e-9 && Math.abs(fB - B.U0.T) < 1e-9 && Math.abs(A.U0.T - 100) < 1e-9, [fA, fB, A.U0.T]);
  const sA = A.U1.rows.find(r => r.id === 'NEW'), sB = B.U1.rows.find(r => r.id === 'NEW');
  ok('the 26% scorer dropped among ball handlers keeps less of his usage than in a balanced side', sA.u2 < sB.u2 && sA.u2 < 26, [sA.u2, sB.u2]);
  const h1 = A.U1.rows.find(r => r.id === 'h1'), h4 = A.U1.rows.find(r => r.id === 'h4');      // h3's minutes went to the scorer
  ok('...the handlers give up usage to him, the role players keep their shots (the floor\'s 12%)', h1.u2 < 26 && Math.abs(h4.u2 - 12) < 1e-9, [h1.u2, h4.u2]);
  ok('...and each is a little more efficient on the plays he keeps (the skill curve)', Math.abs(h1.ppp2 - (1.0 + Q.SKILL * (26 - h1.u2))) < 1e-9);
  const m = Q.build(Object.assign({ club: 'T0' }, base));
  const r = Q.simulate(m, { add: [{ id: 'T3-s2', mpg: 30 }] });
  ok('the what-if prices the offence by the usage sim, the glass and the defence by the sums, and shows each man\'s usage before and after',
     r && typeof r.parts.offence === 'number' && 'dreb' in r.parts && Array.isArray(r.usage) && r.usage.some(u => u.id === 'T3-s2' && u.before === null) &&
     Math.abs(r.usage.reduce((a, u) => a + u.f * u.u2, 0) - Q.usageSim(m._all.get('T0').who, null, 40).T) < 1e-6, r && r.parts);
  ok('...nothing moved, nothing changes (the squad as it is fills its own usage)', Math.abs(Q.simulate(m, {}).parts.offence) < 1e-12);
}

console.log('\nthe play-by-play splits: self-creation, the half court, the ball moving; the cover, the groups, the shape');
{
  /* every player covered by the play-by-play in 8 of his 10 games; his half-court plays 64% of his plays, his
     unassisted points 40% of his points (the point guards 60%) */
  const evRow = p => { const pg = /-s1$/.test(p.id), k = 0.8 * 0.8; return Object.assign({}, p, { ev_gp: 8, ev_unast_pts: (pg ? 0.6 : 0.4) * p.pts * 0.8, ev_unast_pts_sh: pg ? 60 : 40,
    ev_ast_sh: pg ? 40 : 60, ev_half_pts: k * p.pts, ev_half_fga: k * p.fga, ev_half_fta: k * p.fta, ev_half_tov: k * p.tov }); };
  const evPlayers = players.map(evRow);
  const teams = [...pos.keys()].map(tid => {
    const ps = evPlayers.filter(p => teamOf.get(p.id) === tid), s = f => ps.reduce((a, p) => a + p[f], 0), t = Number(tid.slice(1));
    return { id: tid, gp: 10, ev_gp: 8, net: t - 2.5, ev_half_pts: s('ev_half_pts'), ev_half_fga: s('ev_half_fga'), ev_half_fta: s('ev_half_fta'), ev_half_tov: s('ev_half_tov'),
      ev_ast_sh: 50 + t, ev_rim_astp: 40 + t, ev_unast_pts_sh: 45 - t };
  });
  const m = Q.build(Object.assign({}, base, { club: 'T0', players: evPlayers, teams }));
  const e = Q.evOf(evPlayers[0]);
  ok('a player\'s splits are read where the play-by-play covers half his games and five of them, his minutes in them by his games',
     e && near(e.min, evPlayers[0].min * 0.8, 1e-9) && Q.evOf(Object.assign({}, evPlayers[0], { ev_gp: 4 })) === null && Q.evOf(players[0]) === null);
  const l = Q.lineOf(evPlayers[0]);
  ok('self-created points per 40: his unassisted points over the minutes the play-by-play covers', near(l.rate.un40, 40 * evPlayers[0].ev_unast_pts / (evPlayers[0].min * 0.8), 1e-9));
  ok('...the team\'s self-created points a game: each position\'s per 40 over its minutes, summed (ball handling is self-creation too)',
     near(m.team.mine.unPg, m.slots.reduce((a, s) => a + s.stats.un40.v * 40 / 40, 0), 1e-9) && m.whole.some(r => r.k === 'un') && Q.KEY.PG.includes('un40'));
  const H = m.halfCourt, T0 = teams[0], Tp = T0.ev_half_fga + 0.44 * T0.ev_half_fta + T0.ev_half_tov;
  const lgPts = teams.reduce((a, t) => a + t.ev_half_pts, 0), lgPlays = teams.reduce((a, t) => a + t.ev_half_fga + 0.44 * t.ev_half_fta + t.ev_half_tov, 0);
  ok('the half court: the club\'s top users there (each 150 covered minutes and 4% of the plays or more), the heaviest first', H && H.players.length === 5 &&
     H.players.every((p, i, a) => i === 0 || a[i - 1].usg >= p.usg) && H.players.every(p => /-s\d$/.test(p.id)), H && H.players.map(p => p.id));
  const p0 = H.players[0], r0 = evPlayers.find(p => p.id === p0.id), hp = 0.64 * (r0.fga + 0.44 * r0.fta + r0.tov);
  ok('...his share of the team\'s half-court plays and his usage there (his plays a minute against the team\'s a minute of the game)',
     near(p0.share, 100 * hp / Tp, 1e-9) && near(p0.usg, 100 * (hp / (r0.min * 0.8)) / (Tp / (40 * 8)), 1e-9), [p0.share, p0.usg]);
  ok('...his TS%, TOV% and points a play there, each against the league\'s half court as a whole', near(p0.ppp, (0.64 * r0.pts) / hp, 1e-9) && near(p0.rppp, p0.ppp - lgPts / lgPlays, 1e-9) &&
     near(H.lg.ppp, lgPts / lgPlays, 1e-12) && typeof p0.rts === 'number' && typeof p0.rtov === 'number');
  const bare = Q.build(Object.assign({}, base, { club: 'T0', teams: teams.map(t => Object.assign({}, t, { ev_gp: 0 })) }));
  ok('...no play-by-play for the league: no half court, no ball moving', bare.halfCourt === null && bare.moves === null && !bare.whole.some(r => r.k === 'un'));
  ok('...the league covered but none of the club\'s players: no half court', Q.build(Object.assign({}, base, { club: 'T0', teams })).halfCourt === null);
  const ast = m.moves.find(x => x.k === 'ast');
  ok('the ball moving: the club\'s share of baskets off a pass against the league\'s clubs (T0 the lowest)', ast && ast.v === 50 && ast.rank === 6 && ast.of === 6, ast);
  ok('the groups: ball handlers (PG, SG), wings (SF), bigs (PF, C), each the positions\' priced parts added up', m.groups.length === 3 &&
     near(m.groups[0].pts, m.slots[0].pts + m.slots[1].pts, 1e-9) && near(m.groups[2].pts, m.slots[3].pts + m.slots[4].pts, 1e-9));
  /* COVERED: T0's centre rebounds like a guard, its four like two centres - the squad's DREB% stays at the league's */
  const cov = players.map(p => (p.id === 'T0-s5' ? Object.assign({}, p, { dreb_pct: 14 }) : p.id === 'T0-s4' ? Object.assign({}, p, { dreb_pct: 28 }) : p));
  const mc = Q.build(Object.assign({}, base, { club: 'T0', players: cov }));
  const dc = mc.cover.find(c => c.st === 'dreb_pct');
  ok('who covers for whom: a centre short on the glass, the four making it up, the squad level - covered', dc && dc.covered && dc.short.some(x => x.key === 'C') && dc.help.some(x => x.key === 'PF'), dc);
  const nc = players.map(p => (p.id === 'T0-s5' ? Object.assign({}, p, { dreb_pct: 12 }) : p));
  const dn = Q.build(Object.assign({}, base, { club: 'T0', players: nc })).cover.find(c => c.st === 'dreb_pct');
  ok('...nobody making it up: not covered, and what it costs the squad in points', dn && !dn.covered && dn.pts < 0, dn);
  ok('the shape: the rotation, the top five\'s minutes, the leading scorer\'s share and how concentrated the plays are, every club the same way',
     m.shape && ['rot_n', 'top5_share', 'star_pts_share', 'usg_hhi'].every(k => m.shape.some(x => x.k === k)) && near(m.shape.find(x => x.k === 'top5_share').v, 1500 / 1800, 1e-9));
  /* NOBODY AT THE POINT (box-score positions only, T0's guards all 2.0 or more): the twos cover it, half their time */
  const nopg = players.map(p => (p.id === 'T0-s1' ? Object.assign({}, p, { bpm_pos: 2 }) : p.id === 'T0-b1' ? Object.assign({}, p, { bpm_pos: 2.4 }) : p));
  const mp = Q.build(Object.assign({}, base, { club: 'T0', players: nopg, pos: new Map() }));
  ok('nobody at a position: the players at the one beside it cover it, and it is still a game long', mp && near(mp.slots[0].players.reduce((a, p) => a + p.min, 0), 40, 1e-9) &&
     mp.slots[0].players.every(p => ['T0-s1', 'T0-b1', 'T0-s2'].includes(p.id)), mp && mp.slots[0].players);
}

console.log('\nwhen it says nothing');
{
  const few = new Map([...pos].slice(0, 3));
  const p3 = players.filter(p => ['T0', 'T1', 'T2'].includes(teamOf.get(p.id)));
  ok('fewer than four clubs: no model', Q.build(Object.assign({}, base, { club: 'T0', players: p3, pos: few })) === null);
  ok('a club not in the season: no model', Q.build(Object.assign({}, base, { club: 'nobody' })) === null);
  const nopos = Q.build(Object.assign({}, base, { club: 'T0', pos: new Map() }));
  ok('no lineups anywhere: each player at his box-score position (still a model, said so)', nopos && nopos.source === 'positions', nopos && nopos.source);
  ok('the club\'s own lineups, where the page has them, are used for it', Q.build(Object.assign({}, base, { club: 'T0', clubPos: pos.get('T0') })).source === 'lineups');
  ok('a box-score position 2.3 is 70% at shooting guard, 30% at small forward', (s => near(s[1], 0.7, 1e-9) && near(s[2], 0.3, 1e-9))(Q.shareOfPos(2.3)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
