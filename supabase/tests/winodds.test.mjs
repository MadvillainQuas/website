/* ============================================================================
   EPINOIΛ'S MODEL OF WHO WINS (epinoia/winodds.js), on games invented to have a known answer:
     * silent until both clubs have played three games this season; the better club favoured, by more the bigger the gap;
     * a league's home edge learned from equal clubs, and none at a neutral site;
     * the schedule: two clubs shooting the same, one against the league's best defences - the adjusted rating sees it;
     * form: a club that turns better mid-season is rated up before its season's numbers catch up;
     * positions: a rebounder and shot-blocker is a big, a passer a guard; a defence that shuts guards down shows it;
     * who is playing: the game after a club's best player sits, its line-up rates below its roster;
     * one tip-off: games tipping off together are all predicted before any is learned;
     * its own wins and losses: on coin-flip games it stays near even (Brier near 0.25);
     * the state saved and loaded predicts the same; a state of another layout is started again.

     node supabase/tests/winodds.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const O = require(path.join(ROOT, 'epinoia', 'winodds.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

/* a seeded random number, so every run invents the same games */
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const DAY = 86400000, T0 = Date.UTC(2026, 9, 1);
/* a side's counts for a game: eFG% e, turnover share tv, offensive rebound share ob (of its misses), FT rate fr */
const side = (e, tv, ob, fr) => {
  const fga = 70, efgm = fga * e, fta = fga * fr, miss = fga - efgm * 0.85, ro = miss * ob, rd = miss - ro;
  const tov = tv * (fga + 0.44 * fta) / (1 - tv), poss = fga + 0.44 * fta + tov - ro;
  /* as the box score keeps them: whole numbers (eFG makes to the half) */
  return [Math.round(2 * efgm) / 2, fga, Math.round(fta), Math.round(tov), Math.round(ro), Math.round(rd), Math.round(2 * efgm + 0.75 * fta), Math.round(poss)];
};
/* a round robin of n clubs (each pair home and away, k times), strength s[i] in points; noise sd points */
function league(lg, s, rounds, noise, o) {
  const games = [];
  let t = T0, id = 0;
  const n = s.length;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      t += DAY / 4;
      const hca = (o && o.hca) || 0, m = s[i] - s[j] + hca + noise * (rnd() + rnd() + rnd() - 1.5) * 2;
      const e0 = 0.5 + m / 400, e1 = 0.5 - m / 400;
      const hs = Math.round(80 + m / 2), as = Math.round(80 - m / 2);
      games.push({ id: lg + '-' + (id++), h: 'c' + lg + i, a: 'c' + lg + j, lg, s: lg + '-26', t, v: 'v' + lg + i, hs, as: hs === as ? as - 1 : as,
                   c: [side(e0, 0.14, 0.28, 0.25), side(e1, 0.14, 0.28, 0.25)], pl: [] });
    }
  }
  return games;
}

console.log('the shape of it');
ok('sixteen inputs, every one named', O.X_KEYS.length === 16 && O.C.w0.length === 16 && O.C.p0.length === 16);
ok('a player line from the engine\'s named stats: minutes from ms, makes and attempts of both kinds',
   (() => { const l = O.lineOf('p', 0, { min: 1800000, pts: 20, p2m: 5, p2a: 9, p3m: 2, p3a: 6, fta: 5, ftm: 4, or: 1, dr: 5, ast: 3, stl: 1, blk: 0, to: 2, pf: 3 });
            return l[2] === 30 && l[4] === 7 && l[5] === 15 && l[8] === 1 && l[9] === 5; })());
ok('game score as Hollinger\'s', Math.abs(O.gmsc(['p', 0, 30, 20, 7, 15, 5, 4, 1, 5, 3, 1, 0, 2, 3]) - (20 + 2.8 - 10.5 - 0.4 + 0.7 + 1.5 + 1 + 2.1 - 1.2 - 2)) < 1e-9);

console.log('\nthe better club');
{
  const S = O.create();
  const g = league('a', [8, 4, 0, -4, -8], 2, 6);
  const recs = O.walk(S, g.slice(0, 6));
  ok('silent until both clubs have played three games', recs.every(r => !r.pre.ok));
  O.walk(S, g.slice(6));
  const fx = (h, a) => ({ h: 'ca' + h, a: 'ca' + a, lg: 'a', s: 'a-26', t: T0 + 40 * DAY, v: 'va' + h });
  const top = O.predict(S, fx(0, 4)), near = O.predict(S, fx(0, 1)), rev = O.predict(S, fx(4, 0));
  ok('the strongest club at home to the weakest: well over even', top.ok && top.p > 0.8, top.p);
  ok('...by more than against the second best', top.p > near.p && near.p > 0.5, [top.p, near.p]);
  ok('...and the weakest at home to it: well under even', rev.p < 0.35, rev.p);
  ok('a margin and a spread for each', top.margin > 8 && top.sigma > 3, [top.margin, top.sigma]);
}

console.log('\nthe home court');
{
  const S = O.create();
  O.walk(S, league('h', [0, 0, 0, 0], 6, 4, { hca: 6 }));
  const fx = { h: 'ch0', a: 'ch1', lg: 'h', s: 'h-26', t: T0 + 60 * DAY, v: 'vh0' };
  const at = O.predict(S, fx), away = O.predict(S, Object.assign({}, fx, { v: 'vneutral' }));
  ok('equal clubs, home wins by six: the home side favoured', at.p > 0.6 && at.margin > 3, [at.p, at.margin]);
  ok('the same game at a neutral site: no home court', away.home === 0 && Math.abs(away.p - 0.5) < Math.abs(at.p - 0.5), [away.p, at.p]);
}

console.log('\nthe schedule');
{
  /* clubs A and B both shoot 52%; A has played only the league's best defences (they hold everyone else to 44%), B only
     its worst (they let everyone else shoot 56%): A's shooting is the better, adjusted for whom it met. And the margin:
     A only scrapes past the clubs that beat everyone else by fifteen, B only scrapes past the ones that lose by fifteen.
     Light shrinkage (four games) here, so the known answer shows whatever the tuned value is */
  const keepK = [O.C.adjK, O.C.srsK];
  O.C.adjK = 4; O.C.srsK = 4;
  const S = O.create();
  const games = [];
  let t = T0, k = 0;
  const g = (h, a, eh, ea, hs, as) => games.push({ id: 's' + (k++), h, a, lg: 's', s: 's-26', t: (t += DAY / 3), v: 'v' + h, hs, as,
                                                   c: [side(eh, 0.14, 0.28, 0.25), side(ea, 0.14, 0.28, 0.25)], pl: [] });
  for (let r = 0; r < 6; r++) {
    g('A', 'D1', 0.52, 0.50, 80, 78); g('B', 'W1', 0.52, 0.50, 80, 78);
    g('D1', 'x' + r, 0.50, 0.44, 85, 70); g('W1', 'y' + r, 0.50, 0.56, 70, 85);
    g('D2', 'z' + r, 0.50, 0.44, 85, 70); g('A', 'D2', 0.52, 0.50, 80, 78);
    g('W2', 'u' + r, 0.50, 0.56, 70, 85); g('B', 'W2', 0.52, 0.50, 80, 78);
  }
  O.walk(S, games);
  const R = O.ratings(S, 's', 's-26');
  O.C.adjK = keepK[0]; O.C.srsK = keepK[1];
  ok('the margin rating: the same two-point wins, A\'s against the strong rated far above B\'s against the weak', R.A.r > R.B.r + 5, [R.A.r, R.B.r]);
  ok('the same raw eFG% for both', Math.abs(O.factors(S.teams.A.o).efg - O.factors(S.teams.B.o).efg) < 1e-9);
  ok('adjusted for the schedule, A\'s shooting rated well above B\'s', R.A.o[0] > R.B.o[0] + 0.12, [R.A.o[0], R.B.o[0]]);
  ok('...and the hard defences rated hard, the soft ones soft', R.D1.d[0] < -0.1 && R.W1.d[0] > 0.1, [R.D1.d[0], R.W1.d[0]]);
  const fx = { h: 'A', a: 'B', lg: 's', s: 's-26', t: t + DAY, v: 'vA' };
  ok('...so A meets B with the better adjusted shooting (aefg > 0)', O.predict(S, fx).x[O.X_KEYS.indexOf('aefg')] > 0);
}

console.log('\nform');
{
  const S = O.create();
  /* six equal clubs; half-way, club 0 turns ten points better */
  const g = league('f', [0, 0, 0, 0, 0, 0], 4, 3);
  const half = Math.floor(g.length / 2);
  g.slice(half).forEach(x => { if (x.h === 'cf0') { x.hs += 10; } if (x.a === 'cf0') { x.as += 10; } if (x.hs === x.as) x.as -= 1; });
  O.walk(S, g);
  ok('the club that turned better carries positive form', S.teams.cf0.f > 1, S.teams.cf0.f);
  ok('...the others none to speak of', ['cf1', 'cf2', 'cf3'].every(id => Math.abs(S.teams[id].f) < S.teams.cf0.f / 2), ['cf1', 'cf2', 'cf3'].map(id => S.teams[id].f));
}

console.log('\npositions and who is playing');
{
  const S = O.create();
  const line = (id, sd, min, o) => [id, sd, min, o.pts || 0, o.fgm || 0, o.fga || 0, o.fta || 0, o.ftm || 0, o.or || 0, o.dr || 0, o.ast || 0, o.stl || 0, o.blk || 0, o.to || 0, o.pf || 0];
  /* each club: a guard (assists, steals), two wings, a big (rebounds, blocks), a star wing; P's defence holds guards to
     nothing; in the last game Q's star sits */
  const roster = (c, sd, o) => [
    line(c + 'g', sd, 32, { pts: o.gpts == null ? 14 : o.gpts, fgm: 5, fga: 12, ast: 8, stl: 2, dr: 2, pf: 2, to: 3 }),
    line(c + 'w1', sd, 30, { pts: 10, fgm: 4, fga: 10, ast: 2, dr: 4, or: 1, stl: 1, pf: 2, to: 1 }),
    line(c + 'w2', sd, 28, { pts: 9, fgm: 4, fga: 9, ast: 2, dr: 4, or: 1, stl: 1, pf: 2, to: 1 }),
    line(c + 'b', sd, 30, { pts: 12, fgm: 5, fga: 9, dr: 9, or: 4, blk: 3, pf: 4, to: 1 }),
    ...(o.noStar ? [line(c + 'r', sd, 35, { pts: 4, fgm: 2, fga: 8, dr: 2, pf: 2, to: 2 })] : [line(c + 's', sd, 35, { pts: 26, fgm: 10, fga: 18, ast: 4, dr: 5, or: 1, stl: 1, pf: 2, to: 2 })]),
    line(c + 'x', sd, 45, { pts: 6, fgm: 3, fga: 7, ast: 1, dr: 3, pf: 3, to: 1 })
  ];
  const games = [];
  const clubs = ['P', 'Q', 'R', 'U'];
  let t = T0, k = 0;
  for (let r = 0; r < 4; r++) for (const h of clubs) for (const a of clubs) {
    if (h === a) continue;
    const last = r === 3 && a === 'U' && h === 'Q';
    games.push({ id: 'p' + (k++), h, a, lg: 'p', s: 'p-26', t: (t += DAY / 3), v: 'v' + h, hs: 80, as: 77,
                 c: [side(0.5, 0.14, 0.28, 0.25), side(0.5, 0.14, 0.28, 0.25)],
                 pl: [...roster(h, 0, { gpts: a === 'P' ? 0 : 14, noStar: last }), ...roster(a, 1, { gpts: h === 'P' ? 0 : 14 })] });
  }
  /* the last game must be Q's: drop Q's games after its star sat */
  const cut = games.findIndex(x => x.h === 'Q' && x.pl.some(l => l[0] === 'Qr'));
  O.walk(S, games.slice(0, cut + 1));
  const pos = id => { const T = S.teams[id[0]]; const p = S.pl[id]; return p ? (() => { const tm = T.ps.tot[0], sh = (k2, j) => (p[k2] / p.m) / (T.ps.tot[j] / tm) / 5;
    const raw = 2.130 + 8.668 * sh('trb', 1) - 2.486 * sh('stl', 3) + 0.992 * sh('pf', 5) - 3.536 * sh('ast', 2) + 1.667 * sh('blk', 4); return (p.m * raw + 150) / (p.m + 50); })() : null; };
  ok('the passer is placed a guard, the rebounder and shot-blocker a big', pos('Pg') < 2.5 && pos('Pb') > 3.75, [pos('Pg'), pos('Pb')]);
  const P = S.teams.P, Rt = S.teams.R;
  ok('the defence that shuts guards down: opposing guards well below their usual against it', P.ps.dv[0] / P.ps.dm[0] < Rt.ps.dv[0] / Rt.ps.dm[0] - 0.05,
     [P.ps.dv[0] / P.ps.dm[0], Rt.ps.dv[0] / Rt.ps.dm[0]]);
  const fx = (h, a) => ({ h, a, lg: 'p', s: 'p-26', t: t + DAY, v: 'v' + h });
  const x = O.predict(S, fx('Q', 'R')).x, xi = O.X_KEYS.indexOf('avail');
  ok('the game after Q\'s star sat: its line-up rated below its roster (who is playing < 0)', x[xi] < 0, x[xi]);
  const pe = O.predict(S, fx('R', 'P')).x[O.X_KEYS.indexOf('pos')];
  ok('a position edge is worked out for every matchup', Number.isFinite(pe));
}

console.log('\none tip-off');
{
  const S = O.create();
  const g = league('t', [5, 0, -5], 3, 2);
  O.walk(S, g);
  const same = [
    { id: 'z1', h: 'ct0', a: 'ct1', lg: 't', s: 't-26', t: T0 + 90 * DAY, v: 'vt0', hs: 60, as: 100, c: [side(0.4, 0.14, 0.28, 0.25), side(0.6, 0.14, 0.28, 0.25)], pl: [] },
    { id: 'z2', h: 'ct0', a: 'ct2', lg: 't', s: 't-26', t: T0 + 90 * DAY, v: 'vt0', hs: 90, as: 80, c: [side(0.5, 0.14, 0.28, 0.25), side(0.5, 0.14, 0.28, 0.25)], pl: [] }
  ];
  const before = O.predict(S, same[1]).p;
  const recs = O.walk(S, same);
  ok('the second game\'s pick is the one made before the first was learned', Math.abs(recs.find(r => r.game.id === 'z2').pre.p - before) < 1e-12);
}

console.log('\nits own wins and losses');
{
  seed = 777;
  const S = O.create();
  const g = league('c', [0, 0, 0, 0, 0, 0], 8, 14);
  const recs = O.walk(S, g).filter(r => r.pre.ok);
  const brier = recs.reduce((s, r) => s + (r.pre.p - (r.game.hs > r.game.as ? 1 : 0)) ** 2, 0) / recs.length;
  ok('coin-flip games: it stays near even (Brier within 0.02 of 0.25)', Math.abs(brier - 0.25) < 0.02, brier);
  ok('...and its record counted', S.metrics.n === recs.filter(r => r.game.hs !== r.game.as).length, [S.metrics.n, recs.length]);
}

console.log('\nthe state');
{
  seed = 4242;
  const S = O.create();
  const g = league('k', [6, 2, -2, -6], 3, 5);
  g.forEach(x => { x.pl = [['k' + x.h + 'a', 0, 30, 12, 5, 10, 2, 2, 1, 4, 3, 1, 0, 2, 2], ['k' + x.a + 'a', 1, 30, 10, 4, 10, 2, 2, 1, 4, 3, 1, 0, 2, 2]]; });
  O.walk(S, g);
  const fx = { h: 'ck0', a: 'ck3', lg: 'k', s: 'k-26', t: T0 + 50 * DAY, v: 'vk0' };
  const kept = JSON.stringify(O.pack(S)), S2 = O.unpack(JSON.parse(kept));
  ok('packed and unpacked, it predicts the same (to 4 places)', Math.abs(O.predict(S, fx).p - O.predict(S2, fx).p) < 1e-4, [O.predict(S, fx).p, O.predict(S2, fx).p]);
  ok('...every id written once', (() => { const j = JSON.parse(kept); return new Set(j.id).size === j.id.length && j.id.includes('ck0') && j.id.includes('kck0a'); })());
  ok('...the covariance by its upper triangle', JSON.parse(kept).P.length === 16 * 17 / 2);
  ok('...and it goes on learning from where it was', (() => { const a = O.learn(S2, Object.assign({}, g[0], { id: 'more', t: T0 + 51 * DAY })); return a && S2.n === S.n + 1; })());
  ok('...its clubs, leagues and players all back', Object.keys(S2.teams).length === 4 && Object.keys(S2.pl).length === 4 && !!S2.lg['k|k-26']);
  ok('a state of another layout is started again', O.unpack({ v: 1, w: [1, 2, 3], P: [] }).n === 0);
  ok('clubs, leagues and players of seasons long gone are left out of the kept state',
     (() => { const j = O.pack(S, { keepAfter: T0 + 1000 * DAY }); return j.tm.length === 0 && j.lg.length === 0 && j.pl.length === 0; })());
}

console.log('\nthe reads');
{
  const I = { c_efgm: 90, c_fga: 89, c_fta: 91, c_tov: 93, c_reb_off: 94, c_reb_def: 95, c_pts: 88, poss: 3, g_poss: 87 };
  ok('nine numbers of a feature line, not the line', O.lineSelect(I) === 'q0:f->90,q1:f->89,q2:f->91,q3:f->93,q4:f->94,q5:f->95,q6:f->88,q7:f->3,q8:f->87');
  const r = { q0: 30, q1: 60, q2: 20, q3: 12, q4: 9, q5: 25, q6: 80, q7: 75, q8: 4 };
  ok('possessions are the competitive ones: all less garbage time\'s', JSON.stringify(O.countsOfRow(r)) === JSON.stringify([30, 60, 20, 12, 9, 25, 80, 71]));
  const f = []; Object.keys(I).forEach(k => { f[I[k]] = r['q' + O.LINE_KEYS.indexOf(k)]; });
  ok('...the same from a whole line', JSON.stringify(O.countsOf(f, I)) === JSON.stringify(O.countsOfRow(r)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
