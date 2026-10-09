/* ============================================================================
   EPINOIΛ'S MODEL OF WHO WINS (epinoia/winodds.js), on games invented to have a known answer:
     * silent until both clubs have played three games this season; the better club favoured, by more the bigger the gap;
     * a league's home edge learned from equal clubs, and none at a neutral site;
     * the schedule: two clubs shooting the same, one against the league's best defences - the matchup's adjusted
       four factors see it;
     * every factor at both ends in one calculation: a defence that fouls a lot hands the other side the edge at the
       line (the free-throw weight once learned the wrong sign); a defence that gives up the rim loses it to an attack
       that lives there; the parts add up to the margin;
     * form: a club that turns better mid-season is rated up before its season's numbers catch up;
     * positions: a rebounder and shot-blocker is a big, a passer a guard; a defence that shuts guards down shows it;
     * who is playing: the game after a club's best player sits, its line-up rates below its roster;
     * the style: half-court points a chance and the shot diet, each attack against the defence it meets, against the
       league - a rim-heavy attack gains more against a defence that gives up the rim than one that protects it;
     * one tip-off: games tipping off together are all predicted before any is learned;
     * its own wins and losses: on coin-flip games it stays near even (Brier near 0.25);
     * the state saved and loaded predicts the same; a state of another layout is started again;
     * it tunes its own settings: strictly, kept in the state and back in force when the state is read.

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
ok('13 inputs, every one named, the matchup one of them', O.X_KEYS.length === 13 && O.C.w0.length === 13 && O.C.p0.length === 13 && O.X_KEYS[1] === 'match' && O.X_KEYS.slice(9).join() === 'hc,tr,sc,km');
ok('each rate\'s settling attempts measured at both ends: a defence\'s rim percentage settles sooner than an attack\'s, three-point percentage slowest',
   O.STAB.rim[1] < O.STAB.rim[0] && O.STAB.f3[0] > O.STAB.rim[1] && O.STAB.f3[1] > O.STAB.rim[1] && O.STAB.ft[1] === 0);
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
  const keepN = O.C.sigN; O.C.sigN = 0;
  const flat = O.predict(S, fx(0, 4)).sigma;
  O.C.sigN = keepN;
  ok('...the spread wider for clubs few games in: × √(1 + sigN / the fewer games)', Math.abs(top.sigma / flat - Math.sqrt(1 + O.C.sigN / Math.min(top.n[0], top.n[1]))) < 1e-9, [top.sigma, flat, top.n]);
  const sum = top.why.reduce((a, r) => a + r[1], 0);
  ok('its reasons add up to its margin exactly, each one of the families the page names', Math.abs(sum - top.margin) < 1e-9 && top.why.every(r => r[0] in O.WHY), [sum, top.margin, top.why]);
  ok('...largest first, and its largest on the favourite\'s side', top.why.every((r, i) => i === 0 || Math.abs(top.why[i - 1][1]) >= Math.abs(r[1])) && top.why[0][1] > 0, top.why);
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
     Light shrinkage of the margin (four games) here, so the known answer shows whatever the tuned value is */
  const keepK = O.C.srsK;
  O.C.srsK = 4;
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
  ok('the margin rating: the same two-point wins, A\'s against the strong rated far above B\'s against the weak', R.A.r > R.B.r + 5, [R.A.r, R.B.r]);
  ok('the same raw eFG% for both', Math.abs(O.factors(S.teams.A.o).efg - O.factors(S.teams.B.o).efg) < 1e-9);
  ok('the matchup\'s four factors adjusted for the schedule: A\'s shooting rated well above B\'s', R.A.a.efg > R.B.a.efg + 0.1, [R.A.a.efg, R.B.a.efg]);
  ok('...and the hard defences rated hard, the soft ones soft', R.D1.d.efg < -0.05 && R.W1.d.efg > 0.05, [R.D1.d.efg, R.W1.d.efg]);
  ok('...turnovers, the glass and free throws there too, at both ends', ['tov', 'orb', 'ftr'].every(k => Number.isFinite(R.A.a[k]) && Number.isFinite(R.A.d[k])), R.A);
  O.apply({ adjW: 0 });
  const R0 = O.ratings(S, 's', 's-26');
  ok('...not adjusted (adjW 0): the same raw shooting, the same rating', Math.abs(R0.A.a.efg - R0.B.a.efg) < 1e-9, [R0.A.a.efg, R0.B.a.efg]);
  O.apply({});
  O.C.srsK = 4;
  const fx = { h: 'A', a: 'B', lg: 's', s: 's-26', t: t + DAY, v: 'vA' };
  const pr = O.predict(S, fx);
  ok('...so A meets B with the better matchup (match > 0), its shooting the reason', pr.x[O.X_KEYS.indexOf('match')] > 0 && pr.parts.shoot > 0, [pr.x[1], pr.parts]);
  O.C.srsK = keepK;
}

console.log('\nevery factor at both ends, in one calculation');
{
  /* six clubs alike but at the line: F's defence fouls (its opponents shoot 45 free throws a hundred shots, everyone
     else 25), G's attack gets there (45). The bug of 2026-10-09: with each factor its own input the free-throw weight
     learned the wrong sign, and a club that fouls a lot was credited for it */
  const clubs = ['F', 'G', 'N1', 'N2', 'N3', 'N4'];
  const games = [];
  let t = T0, k = 0;
  for (let r = 0; r < 4; r++) for (const h of clubs) for (const a of clubs) {
    if (h === a) continue;
    const fr = x => (x.att === 'G' || x.def === 'F' ? 0.45 : 0.25);
    games.push({ id: 'l' + (k++), h, a, lg: 'l', s: 'l-26', t: (t += DAY / 3), v: 'v' + h, hs: 80, as: 78,
                 c: [side(0.5, 0.14, 0.28, fr({ att: h, def: a })), side(0.5, 0.14, 0.28, fr({ att: a, def: h }))], pl: [] });
  }
  const S = O.create();
  O.walk(S, games);
  const pre = (h, a) => O.predict(S, { h, a, lg: 'l', s: 'l-26', t: t + DAY, v: 'v' + h });
  const vF = pre('N1', 'F'), atF = pre('F', 'N1'), gF = pre('G', 'N1');
  ok('a defence that fouls a lot: the other side\'s edge at the line (lineD), at home or away', vF.parts.lineD > 0 && atF.parts.lineD < 0, [vF.parts.lineD, atF.parts.lineD]);
  ok('...worth points to it: the matchup favours whoever meets the fouling defence', vF.x[1] > 0 && atF.x[1] < 0, [vF.x[1], atF.x[1]]);
  ok('an attack that gets to the line: its own edge (line)', gF.parts.line > 0, gF.parts);
  ok('the matchup\'s parts add up to its margin exactly', Math.abs(Object.values(vF.parts).reduce((a, v) => a + v, 0) - 10 * vF.x[1]) < 1e-9);
  ok('...and the reasons to the whole margin, the matchup\'s by area and end', Math.abs(vF.why.reduce((a, r) => a + r[1], 0) - vF.margin) < 1e-9 && vF.why.some(r => r[0] === 'lineD'), vF.why);
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

console.log('\nthe shots by zone, and the flow');
{
  /* five clubs level at the four factors; A's attack lives at the rim and scores well in the half court, P's defence
     protects the rim (fewer shots there, fewer of them in) and the half court, W's gives up both. The lines: chances
     (all, transition, half-court, second) and points, then the shots by zone */
  const att = { A: { rim: 0.12, hc: 0.15 } }, def = { P: { rim: -0.12, rimp: -0.12, hc: -0.15 }, W: { rim: 0.12, rimp: 0.12, hc: 0.15 } };
  const clubs = ['A', 'P', 'W', 'N1', 'N2'];
  const line = (x, y) => {
    const a = att[x] || {}, d = def[y] || {}, fga = 70;
    const rimA = Math.round(fga * (0.33 + (a.rim || 0) + (d.rim || 0))), f3a = Math.round(fga * 0.36), midA = fga - rimA - f3a;
    const hcp = Math.round(60 * (0.9 + (a.hc || 0) + (d.hc || 0)));
    return side(0.5, 0.14, 0.28, 0.25).concat([90, 15, 18, 60, hcp, 12, 13, rimA, Math.round(rimA * (0.6 + (d.rimp || 0))), midA, Math.round(midA * 0.4), f3a, Math.round(f3a * 0.34)]);
  };
  const games = [];
  let t = T0, k = 0;
  for (let r = 0; r < 4; r++) for (const h of clubs) for (const a of clubs) {
    if (h === a) continue;
    games.push({ id: 'y' + (k++), h, a, lg: 'y', s: 'y-26', t: (t += DAY / 3), v: 'v' + h, hs: 80, as: 78, c: [line(h, a), line(a, h)], pl: [] });
  }
  const S = O.create();
  O.walk(S, games);
  const ix = key => O.X_KEYS.indexOf(key);
  const pr = opp => O.predict(S, { h: 'A', a: opp, lg: 'y', s: 'y-26', t: t + DAY, v: 'vA' });
  const pw = pr('W'), pp = pr('P'), pn = pr('N1'), xw = pw.x, xp = pp.x, xn = pn.x;
  ok('the rim-heavy attack gains more against the defence that gives up the rim than the one that protects it',
     xw[ix('match')] > xp[ix('match')] + 0.1, [xw[ix('match')], xp[ix('match')]]);
  ok('...the defence that guards the rim takes it away (rimD: the other side\'s edge when the rim is given up)',
     pw.parts.rimD > 0 && pp.parts.rimD < 0 && pw.parts.dietD > pp.parts.dietD, [pw.parts, pp.parts]);
  ok('...and its own attack\'s edge at the rim against an average defence (diet)', pn.parts.diet > 0, pn.parts);
  ok('...and in half-court points a chance the same way', xw[ix('hc')] > xp[ix('hc')] + 0.5, [xw[ix('hc')], xp[ix('hc')]]);
  ok('...against an average defence the better attack still has the edge', xn[ix('match')] > 0 && xn[ix('hc')] > 0, [xn[ix('match')], xn[ix('hc')]]);
  ok('...and where both sides are alike at something (transition), no edge', Math.abs(xn[ix('tr')]) < 0.5, xn[ix('tr')]);
  const S2 = O.create();
  O.walk(S2, league('q', [3, 0, -3], 3, 3));
  const p2 = O.predict(S2, { h: 'cq0', a: 'cq1', lg: 'q', s: 'q-26', t: T0 + 40 * DAY, v: 'vq0' }), x2 = p2.x;
  ok('a feed with neither situations nor zones: the flow is nothing', ['hc', 'tr', 'sc'].every(key => x2[ix(key)] === 0), x2.slice(9));
  ok('...and the matchup falls back on eFG% for the shooting (no zones)', 'shoot' in p2.parts && !('rim' in p2.parts), p2.parts);
}

console.log('\nWhat wins\' own refinements (built, off until they earn it)');
{
  ok('travel and each league\'s own weights are off by default', !O.C.use.km && !O.C.use.lgw);
  /* travel: the away club's last game was in Bristol, this one is in Leicester (about 150 km); the home club was at home */
  O.apply({ 'use.km': true });
  const LEI = [52.63, -1.13], BRI = [51.45, -2.59];
  const g = league('m', [2, 0, -2], 3, 2).map(x => Object.assign({}, x, { v: x.h === 'cm0' ? 'vLEI' : 'vBRI', vc: x.h === 'cm0' ? LEI : BRI }));
  const S = O.create();
  O.walk(S, g);
  S.teams.cm0.lv = 'vLEI'; S.teams.cm1.lv = 'vBRI';
  const ix = O.X_KEYS.indexOf('km');
  const xk = O.predict(S, { h: 'cm0', a: 'cm1', lg: 'm', s: 'm-26', t: T0 + 60 * DAY, v: 'vLEI', vc: LEI }).x[ix];
  ok('travel: the away club came about 150 km, the home club none: −0.15 (thousands of km, home less away)', Math.abs(xk + 0.15) < 0.02, xk);
  ok('...a venue nobody has placed: no travel either way', O.predict(S, { h: 'cm0', a: 'cm1', lg: 'm', s: 'm-26', t: T0 + 60 * DAY, v: 'vX' }).x[ix] === 0);
  O.apply({});
  ok('...and off by default: nothing', O.predict(S, { h: 'cm0', a: 'cm1', lg: 'm', s: 'm-26', t: T0 + 60 * DAY, v: 'vLEI', vc: LEI }).x[ix] === 0);
  /* each league's own weights (on the matchup, Elo and the margin rating): learned, small, kept through a pack */
  O.apply({ 'use.lgw': true, lwEta: 0.05 });
  const SL = O.create();
  O.walk(SL, league('w', [5, 1, -1, -5], 4, 4));
  const d = SL.lw.w;
  ok('...each league its own weights, learned from what the shared ones miss there, and finite', Array.isArray(d) && d.length === 3 && d.every(Number.isFinite) && d.some(v => v !== 0), d);
  ok('...kept through a pack', JSON.stringify(O.unpack(JSON.parse(JSON.stringify(O.pack(SL)))).lw.w) === JSON.stringify(d.map(v => +v.toPrecision(6))));
  O.apply({});
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
  ok('...every id written once, in one string', (() => { const j = JSON.parse(kept), ids = O.idsIn(j.id); return typeof j.id === 'string' && new Set(ids).size === ids.length && ids.includes('ck0') && ids.includes('kck0a'); })());
  ok('...a uuid in 22 characters, back exactly; any other id as it was',
     (() => { const u = ['59a35bf5-0dc3-4a09-9622-9e8c4f0e6f8a', '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff'], ids = u.concat(['feed-12', '7']);
              const s = O.idsOut(ids); return s.length === 3 * 22 + 9 + 3 && JSON.stringify(O.idsIn(s)) === JSON.stringify(ids); })());
  ok('...an id with a ~ in it keeps the list a plain array', Array.isArray(O.idsOut(['a~b', 'c'])) && O.idsIn(O.idsOut(['a~b', 'c']))[0] === 'a~b');
  ok('...the covariance by its upper triangle', JSON.parse(kept).P.length === 13 * 14 / 2);
  ok('...and it goes on learning from where it was', (() => { const a = O.learn(S2, Object.assign({}, g[0], { id: 'more', t: T0 + 51 * DAY })); return a && S2.n === S.n + 1; })());
  ok('...its clubs, leagues and players all back', Object.keys(S2.teams).length === 4 && Object.keys(S2.pl).length === 4 && !!S2.lg['k|k-26']);
  ok('a state of another layout is started again', O.unpack({ v: 1, w: [1, 2, 3], P: [] }).n === 0);
  ok('clubs, leagues and players of seasons long gone are left out of the kept state',
     (() => { const j = O.pack(S, { keepAfter: T0 + 1000 * DAY }); return j.tm.length === 0 && j.lg.length === 0 && j.pl.every(c => c.length === 0); })());
}

console.log('\nthe reads');
{
  const I = require(path.join(ROOT, 'epinoia', 'features.js')).INDEX;
  const sel = O.lineSelect(I);
  ok('22 numbers of a feature line, not the line\'s 108', sel.split(',').length === 22 && /^q0:f->90,/.test(sel) && sel.indexOf('q12:f->' + I.hc_ch + ',') >= 0 && /q21:f->4$/.test(sel), sel);
  const r = { q0: 30, q1: 60, q2: 20, q3: 12, q4: 9, q5: 25, q6: 80, q7: 75, q8: 4,
              q9: 90, q10: 18, q11: 20, q12: 50, q13: 50, q14: 12, q15: 13, q16: 24, q17: 15, q18: 12, q19: 5, q20: 24, q21: 8 };
  const cr = O.countsOfRow(r);
  ok('possessions are the competitive ones: all less garbage time\'s', JSON.stringify(cr.slice(0, 8)) === JSON.stringify([30, 60, 20, 12, 9, 25, 80, 71]));
  ok('...then the chances by how they began and the shots by zone', JSON.stringify(cr.slice(8)) === JSON.stringify([90, 18, 20, 50, 50, 12, 13, 24, 15, 12, 5, 24, 8]));
  ok('...a feed without zones: no zone counts, its threes not counted as a zone', JSON.stringify(O.countsOfRow(Object.assign({}, r, { q16: 0, q18: 0 })).slice(15)) === JSON.stringify([0, 0, 0, 0, 0, 0]));
  const f = []; Object.keys(I).forEach(k => { f[I[k]] = r['q' + O.LINE_KEYS.indexOf(k)]; });
  ok('...the same from a whole line', JSON.stringify(O.countsOf(f, I)) === JSON.stringify(O.countsOfRow(r)));
}

console.log('\nit tunes itself');
{
  O.apply({ formA: 0.2, 'use.style': false, 'p0.style': 3 });
  ok('settings over the defaults: a number, a family switched off, a family\'s freedom', O.C.formA === 0.2 && O.C.use.style === false && Math.abs(O.C.p0[9] - O.DEFAULTS.p0[9] * 3) < 1e-12);
  O.apply({});
  ok('...and back to the defaults', O.C.formA === O.DEFAULTS.formA && O.C.use.style === true && O.C.p0[9] === O.DEFAULTS.p0[9]);
  seed = 99;
  const g = league('u', [8, 4, 1, -1, -4, -8], 6, 9);
  const few = O.tune(g.slice(0, 40), { budgetMs: 5000 });
  ok('too few judged games: it changes nothing', few.enough === false && Object.keys(few.over).length === 0);
  const r = O.tune(g, { budgetMs: 20000, minGames: 50, passes: 1 });
  ok('it never keeps a setting that scores worse than where it started', r.enough && r.tried > 10 && r.best.ll <= r.base.ll + 1e-12, { tried: r.tried, base: r.base.ll, best: r.best.ll });
  ok('...and what it keeps is in force after it', Object.keys(r.over).every(key => key.indexOf('.') > 0 || O.C[key] === r.over[key]), r.over);
  const loose = O.tune(g, { budgetMs: 20000, minGames: 50, passes: 1, minGain: 0, halfGain: -1 });
  ok('...strict: rules that let any gain through move at least as much', loose.changed.length >= r.changed.length, [loose.changed.length, r.changed.length]);
  O.apply({});
  const S = O.create();
  O.walk(S, g);
  S.tuned = { formA: 0.08 }; S.tunedAt = 123;
  const j = JSON.parse(JSON.stringify(O.pack(S)));
  O.apply({});
  const S2 = O.unpack(j);
  ok('the state keeps its settings, and reading it puts them back in force', O.C.formA === 0.08 && S2.tuned.formA === 0.08 && S2.tunedAt === 123);
  O.apply({});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
