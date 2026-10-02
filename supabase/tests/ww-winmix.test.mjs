/* ============================================================================
   THE LINEUP MIXES (epinoia/winmix.js; docs/what-wins-model.md A.3), with no browser.

     node supabase/tests/ww-winmix.test.mjs

   What is held here:
     * a filter's result equals the sum worked out by hand on a small file: the fives meeting the conditions (AND), the
       rest of the scope, their minutes, possessions, points, ratings and four factors at both ends, and the dose (fives
       by how many meet the first condition);
     * a player under the file's minRate minutes, an unknown one (-1) and a withheld one never meet a condition; role
       conditions read the tag bits;
     * the intervals are the cluster-robust ones (each five a cluster), checked against the formula written out;
     * on the real fixture (fixtures/ww-page/mix.json, the builder's --local output): every preset runs, the selection
       and the rest partition the scope, a club's scope holds only its fives, and a filter stays far inside the page's
       budget (50 ms on a phone: here, where a phone is some 4-6 times slower, under 8 ms);
     * the file's size: under 100 KB gzipped, and it carries no player id.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const X = require(path.join(ROOT, 'epinoia', 'winmix.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`); };
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9) * Math.max(1, Math.abs(b));

/* ------------------------------------------------------------------ a file small enough to sum by hand --- */
console.log('\na file summed by hand');
/* players: 0 a ball handler with AST% 30 (900 min), 1 a shooter with AST% 12 (800), 2 a big with AST% 8 (700),
   3 a handler with AST% 25 but only 50 minutes (under minRate: never meets a statistic), 4 a shooter AST% 18 (400) */
const roles = ['shooter', 'handler', 'passer', 'slasher', 'crasher', 'glass', 'protector', 'disruptor', 'big', 'creator'];
const bit = r => 1 << roles.indexOf(r);
const file = {
  w: 1, scope: 'mix', stats: ['ast_pct', 'orb_pct'], roles, minRate: 100, teams: ['tA', 'tB'], pct: { ast_pct: [8, 12, 25, 30], orb_pct: [2, 4, 7, 9] },
  players: { t: [0, 0, 0, 0, 1], min: [900, 800, 700, 50, 400], tag: [bit('handler'), bit('shooter'), bit('big'), bit('handler'), bit('shooter')],
    v: [[30, 12, 8, 25, 18], [1, 2, 9, 3, 5]] },
  /* four fives: box o / d = fga, fgm, f3m, fta, pts, tov, or, dr */
  rows: { t: [0, 0, 0, 1], p: [0, 1, 2, -1, -1, 0, 3, 1, 2, -1, 1, 2, -1, -1, -1, 4, -1, -1, -1, -1], s: [600, 300, 240, 500],
    o: [20, 10, 3, 6, 27, 3, 4, 10, 10, 4, 1, 2, 9, 2, 3, 5, 8, 3, 1, 0, 7, 2, 2, 4, 16, 7, 2, 4, 18, 2, 3, 9],
    d: [22, 9, 2, 4, 22, 4, 5, 12, 11, 5, 2, 0, 12, 1, 1, 6, 9, 4, 0, 4, 12, 1, 2, 5, 18, 8, 3, 2, 21, 3, 2, 10] },
  box: ['fga', 'fgm', 'f3m', 'fta', 'pts', 'tov', 'or', 'dr'], n: { games: 4, stints: 9, fives: 4, players: 5 }, trim: null
};
const D = X.decode(file);
const pe = (b, k) => 0.96 * (b[k] + b[k + 5] + 0.44 * b[k + 3] - b[k + 6]);
const poss = i => 0.5 * (pe(file.rows.o, 8 * i) + pe(file.rows.d, 8 * i));
{
  ok('decode: the fives, their possessions (½ of each end\'s estimate) and points', D.nF === 4 && D.nP === 5 && [0, 1, 2, 3].every(i => near(D.poss[i], poss(i)) && D.pf[i] === file.rows.o[8 * i + 4] && D.pa[i] === file.rows.d[8 * i + 4]));
  ok('...a five with an unknown player or one under minRate is marked unrated', Array.from(D.unrated).join() === '1,1,1,1');
  const m = X.meets(D, { kind: 'stat', stat: 'ast_pct', cmp: '>', x: 20 });
  ok('a stat condition: AST% above 20 is player 0 only (player 3 has 25 but 50 minutes)', Array.from(m).join() === '1,0,0,0,0');
  ok('...below 10: player 2; ORB% above 4: players 2 and 4', Array.from(X.meets(D, { kind: 'stat', stat: 'ast_pct', cmp: '<', x: 10 })).join() === '0,0,1,0,0' &&
     Array.from(X.meets(D, { kind: 'stat', stat: 'orb_pct', cmp: '>', x: 4 })).join() === '0,0,1,0,1');
  ok('a role condition reads the tag bits (player 3 is a handler by his tag)', Array.from(X.meets(D, { kind: 'role', role: 'handler' })).join() === '1,0,0,1,0');
  ok('counts: the fives\' handlers 1, 2, 0, 0', Array.from(X.counts(D, X.meets(D, { kind: 'role', role: 'handler' }))).join() === '1,2,0,0');

  /* at least one handler AND at least one shooter: fives 0 and 1 (five 2 has a shooter, no handler; five 3 a shooter) */
  const r = X.filter(D, [{ kind: 'role', role: 'handler', op: 'ge', n: 1 }, { kind: 'role', role: 'shooter', op: 'ge', n: 1 }]);
  ok('filter (AND): fives 0 and 1 meet both, 2 and 3 are the rest', Array.from(r.sel).join() === '1,1,0,0' && r.in.fives === 2 && r.rest.fives === 2);
  const sum = (ix, f) => ix.reduce((a, i) => a + f(i), 0), IN = [0, 1], RS = [2, 3];
  const o = (i, k) => file.rows.o[8 * i + k], d = (i, k) => file.rows.d[8 * i + k];
  ok('...minutes, possessions, points: the hand sums', near(r.in.min, (600 + 300) / 60) && near(r.in.poss, sum(IN, poss)) && r.in.pf === 27 + 9 && r.in.pa === 22 + 12 && near(r.rest.poss, sum(RS, poss)));
  ok('...net, offensive and defensive rating per 100: ratios of the hand sums', near(r.in.net.v, 100 * (36 - 34) / sum(IN, poss)) && near(r.in.ortg.v, 100 * 36 / sum(IN, poss)) &&
     near(r.in.drtg.v, 100 * 34 / sum(IN, poss)) && near(r.rest.net.v, 100 * ((7 + 18) - (12 + 21)) / sum(RS, poss)));
  ok('...eFG%, TOV%, OREB% and FT attempt rate (FTA/FGA) at both ends: the hand sums', near(r.in.efg.v, 100 * (10 + 4 + 0.5 * (3 + 1)) / (20 + 10)) &&
     near(r.in.tovp.v, 100 * (3 + 2) / (20 + 10 + 0.44 * (6 + 2) + 3 + 2)) && near(r.in.orebp.v, 100 * (4 + 3) / (4 + 3 + 12 + 6)) && near(r.in.ftr.v, 100 * (6 + 2) / (20 + 10)) &&
     near(r.in.defg.v, 100 * (9 + 5 + 0.5 * (2 + 2)) / (22 + 11)) && near(r.in.dorebp.v, 100 * (5 + 1) / (5 + 1 + 10 + 5)) && near(r.in.dftr.v, 100 * (4 + 0) / (22 + 11)));
  /* the cluster-robust interval, written out: e_i = a_i - R b_i, se = sqrt(n/(n-1) Σ e_i²) / Σ b */
  const a = i => o(i, 4) - d(i, 4), R = sum(IN, a) / sum(IN, poss), se = Math.sqrt(2 / 1 * sum(IN, i => (a(i) - R * poss(i)) ** 2)) / sum(IN, poss);
  ok('...its interval is the cluster-robust one (each five a cluster)', near(r.in.net.se, 100 * se, 1e-9) && near(r.in.net.lo, 100 * (R - 1.959963984540054 * se), 1e-9));
  ok('...and the difference against the rest: estimate and an interval from both', near(r.diff.net.v, r.in.net.v - r.rest.net.v) && near(r.diff.net.se, Math.hypot(r.in.net.se, r.rest.net.se)));
  ok('the dose: the fives by how many handlers (the shooter condition applied): 1 handler five 0, 2 handlers five 1, 0 handlers fives 2 and 3', r.byCount.length === 6 &&
     r.byCount[1].fives === 1 && r.byCount[2].fives === 1 && r.byCount[0].fives === 2 && near(r.byCount[0].poss, sum(RS, poss)));
  const eq = X.filter(D, [{ kind: 'role', role: 'handler', op: 'eq', n: 2 }]), le = X.filter(D, [{ kind: 'role', role: 'handler', op: 'le', n: 0 }]);
  ok('exactly 2 handlers: five 1; at most 0: fives 2 and 3', Array.from(eq.sel).join() === '0,1,0,0' && Array.from(le.sel).join() === '0,0,1,1');
  const club = X.filter(D, [{ kind: 'role', role: 'shooter', op: 'ge', n: 1 }], { team: 'tB' });
  ok('a club\'s scope: only its fives, in or out', club.in.fives === 1 && club.rest.fives === 0 && club.scope === 'tB');
  const none = X.filter(D, [{ kind: 'stat', stat: 'ast_pct', cmp: '>', x: 99, op: 'ge', n: 1 }]);
  ok('nothing meets: an empty group (no rating), the whole scope the rest', none.in.fives === 0 && none.in.net.v === null && none.rest.fives === 4);
}

/* ------------------------------------------------------------------ the real fixture --- */
console.log('\nthe real fixture (fixtures/ww-page/mix.json)');
{
  const fp = path.join(ROOT, 'supabase/tests/fixtures/ww-page/mix.json');
  const txt = fs.readFileSync(fp, 'utf8'), F = JSON.parse(txt);
  const gz = zlib.gzipSync(txt, { level: 9 }).length;
  ok('the file: under 100 KB gzipped (' + Math.round(gz / 1024) + ' KB), ' + F.n.fives + ' fives of ' + F.n.games + ' games', gz < 100 * 1024 && F.n.fives > 100);
  ok('...no player id anywhere in it, only anonymous indexes', !/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(JSON.stringify(F.players)) && !('ids' in F.players));
  let t = process.hrtime.bigint();
  const R = X.decode(F);
  const dec = Number(process.hrtime.bigint() - t) / 1e6;
  ok('decode once: ' + dec.toFixed(1) + ' ms', dec < 60);
  const P = X.presets(R);
  ok('the presets are there (ball handlers, shooters, passers, no big, the stat thresholds at the league\'s top quarter)', P.length >= 6 && P.some(p => p.id === 'handlers2') && P.some(p => p.id === 'ast'));
  let part = true;
  const all = X.agg(R, new Uint8Array(R.nF).fill(1));
  for (const p of P) {
    const r = X.filter(R, p.conds);
    if (!near(r.in.poss + r.rest.poss, all.poss, 1e-9) || r.in.fives + r.rest.fives !== R.nF) part = false;
  }
  ok('every preset: the selection and the rest partition the league\'s fives', part);
  /* the time a reader waits: every preset ten times over (the first round warms the engine, as a page's first draw does) */
  const times = [];
  for (let k = 0; k < 10; k++) for (const p of P) { t = process.hrtime.bigint(); X.filter(R, p.conds); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  const sorted = times.slice(P.length).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)], worst = sorted[sorted.length - 1];
  ok('a filter takes ' + med.toFixed(2) + ' ms (median), ' + worst.toFixed(2) + ' ms at worst, ' + times[0].toFixed(2) + ' ms cold (the page\'s budget is 50 ms on a phone, some 4-6 times slower)',
     med < 4 && worst < 12 && times[0] < 25);
  const T = R.teams[0], c = X.filter(R, P[0].conds, { team: T });
  ok('a club\'s scope holds only its fives', c.in.fives + c.rest.fives === Array.from(R.t).filter(x => x === R.teams.indexOf(T)).length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
