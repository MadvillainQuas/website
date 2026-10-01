/* ============================================================================
   WHAT WINS: THE MODEL BUILDER'S ARITHMETIC (epinoia/winmodel.js), on synthetic leagues with planted truth.

     node supabase/tests/ww-winmodel.test.mjs

   What is held here (docs/what-wins-model.md §7, §9, §14, §16 WP3, A.1, A.2):
     * core4c: the planted signs, every coefficient within 3 SE of the truth, Shapley shares within 5 points of the
       truth worked out from the planted model on the same games;
     * a small league is shrunk toward the pooled priors (pooled weight above 0.6);
     * the Forecast beats home-only where clubs differ; the rolling origin never trains on a game in or after the
       week it predicts, and a pre-game profile never sees its own game;
     * the planted indirect effect (transition raises eFG) and the shooter effect (net per 100 per shooter) come back;
     * every game splits exactly: margin = expected + parts (1e-9), in every club file;
     * normListed covers §7.12's list; groupsFor cuts 40/40/20 of the minutes; slotMinutes (A.1): the 1.4/1.4 case,
       ties, a missing estimate, a short five;
     * validate and the budgets pass; validate catches a feature vector, a long string, pooled blocks, a closed
       league, a withheld player, another club's game; the teaser keys are public; the pooled file has no blocks and
       only open leagues; the same lines give the same bytes;
     * wins are worth Φ(pts / σ_pred), never σ_acc;
     * update(store, delta) (A.2): the store equals one built from nothing, and every point estimate equals a full
       build of the union (1e-9); intervals are the last full build's, flagged with ci_at;
     * the simulator is calibrated through EpinoiaWinSim.calibrate and fo.lg carries its fields.
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  -> ' + extra : ''}`);
};
globalThis.window = globalThis;
const g = (name, file) => { globalThis[name] = require(path.join(ROOT, 'epinoia', file)); return globalThis[name]; };
g('EpinoiaBPM', 'bpm.js'); g('EpinoiaSeason', 'season.js'); g('EpinoiaSOS', 'sos.js'); g('EpinoiaWinning', 'winning.js');
g('EpinoiaDepth', path.join('t', 'depth.js'));
const F = g('EpinoiaFeatures', 'features.js'), W = g('EpinoiaWinStats', 'winstats.js');
g('EpinoiaWinSim', 'winsim.js');
const M = g('EpinoiaWinModel', 'winmodel.js');
const NOW = '2026-10-01T12:00:00.000Z';
const isNum = v => typeof v === 'number' && isFinite(v);
const t0 = Date.now();

ok('winmodel.js loads with the §14 names', ['normListed', 'groupsFor', 'roles', 'blocksOf', 'storeAdd', 'storeDrop', 'buildUnit', 'buildPool', 'buildTeaser',
  'validate', 'pack', 'unpack', 'synthUnit', 'slotMinutes', 'update'].every(k => typeof M[k] === 'function') && M.FILE_V === 1 && M.CODE_V === 1 && M.STORE_V === 1 &&
  M.BUDGET.wins === 300000 && M.BUDGET.club === 25000 && M.BUDGET.teaser === 40000 && M.KEYMAP.ff_efg[0] === 'c_efg' && M.KEYMAP.dff_tov.join() === 'c_tovp,def');

/* ------------------------------------------------------------------------------------------- people --- */
console.log('\npositions (§7.12, A.1)');
{
  const want = { POINT_GUARD: 'pg', SHOOTING_GUARD: 'sg', SMALL_FORWARD: 'sf', POWER_FORWARD: 'pf', CENTER: 'c', CENTRE: 'c', GD: 'g', FD: 'f',
    'F/G': 'gf', 'G/F': 'gf', 'PG/SG': 'g', 'SG/SF': 'gf', 'SF/PF': 'f', 'C/F': 'fc', 'F/C': 'fc', 'C/PF': 'fc',
    'point guard': 'pg', 'Power-Forward': 'pf', ' c ': 'c', 'g / f': 'gf', 'pf/c': 'fc', 'Small_Forward': 'sf', 'banana': '', '': '', null: '' };
  const bad = Object.entries(want).filter(([k, v]) => M.normListed(k === 'null' ? null : k) !== v);
  ok('normListed maps every §7.12 spelling (case and punctuation tolerant; unknown -> \'\')', !bad.length, bad.map(b => b[0]).join(', '));
  /* 40 / 40 / 20 of the minutes: ten players of 100 minutes, values 1..10 */
  const ps = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, v: 1 + i * 0.4, min: 100 }));
  ps.push({ id: 'x', v: 1.1, min: 20 }, { id: 'y', v: 4.9, min: 10 });
  const gm = M.groupsFor(ps);
  const cnt = k => ps.slice(0, 10).filter(p => gm.get(p.id) === k).length;
  ok('groupsFor: sorted by value, G = the first 40% of the minutes, F the next 40%, C the last 20%', cnt('G') === 4 && cnt('F') === 4 && cnt('C') === 2, [cnt('G'), cnt('F'), cnt('C')].join('/'));
  ok('...players under 60 minutes go by their value against the cuts', gm.get('x') === 'G' && gm.get('y') === 'C');
  const sl = M.groupsFor([{ id: 'a', v: 1, min: 500, slots: [10, 200, 30, 0, 0] }, { id: 'b', v: 1, min: 500, slots: [0, 0, 100, 150, 10] }, { id: 'c', v: 1, min: 500, slots: [0, 0, 0, 40, 300] }]);
  ok('...with slot minutes (A.1): G = slots 1-2, F = 3-4, C = 5, by most minutes (whatever the value)', sl.get('a') === 'G' && sl.get('b') === 'F' && sl.get('c') === 'C');

  /* A.1 slotMinutes */
  const five = (ids, s) => ({ ids, s });
  const est = { g1: { pos: 1.41, min: 300 }, g2: { pos: 1.44, min: 900 }, w: { pos: 3.0, min: 500 }, f: { pos: 4.0 }, c: { pos: 4.9 } };
  let r = M.slotMinutes([five(['g2', 'g1', 'w', 'f', 'c'], 600)], est);
  ok('slotMinutes: two guards at 1.4 on the floor: the lower is the 1, the other the 2 for those minutes', r.min.get('g1')[0] === 10 && r.min.get('g2')[1] === 10 && r.min.get('c')[4] === 10 && r.stints === 1);
  r = M.slotMinutes([five(['t1', 't2', 'w', 'f', 'c'], 120)], Object.assign({}, est, { t1: { pos: 1.4, min: 100 }, t2: { pos: 1.4, min: 800 } }));
  ok('...equal estimates: more season minutes takes the lower slot', r.min.get('t2')[0] === 2 && r.min.get('t1')[1] === 2);
  r = M.slotMinutes([five(['zb', 'za', 'w', 'f', 'c'], 60)], Object.assign({}, est, { za: { pos: 1.4, min: 100 }, zb: { pos: 1.4, min: 100 } }));
  ok('...and then the player id', r.min.get('za')[0] === 1 && r.min.get('zb')[1] === 1);
  r = M.slotMinutes([five(['k1', 'k2', 'w', 'f', 'c'], 120)], Object.assign({}, est, { k1: { pos: 1, raw: 0.9, min: 900 }, k2: { pos: 1, raw: 0.55, min: 150 } }));
  ok('...two point guards both clamped to 1.0: the more PG-like by the unclamped estimate is the 1, whatever the minutes', r.min.get('k2')[0] === 2 && r.min.get('k1')[1] === 2);
  r = M.slotMinutes([five(['g1', 'g2', 'w', 'b1', 'b2'], 120)], Object.assign({}, est, { b1: { pos: 5, raw: 5.6, min: 100 }, b2: { pos: 5, raw: 5.2, min: 900 } }));
  ok('...and two bigs clamped to 5.0: the more centre-like is the 5', r.min.get('b1')[4] === 2 && r.min.get('b2')[3] === 2);
  {
    const B = g('EpinoiaBPM', 'bpm.js'), p100 = { trb: 30, stl: 0.5, pf: 6, ast: 1, blk: 6 }, t100 = { trb: 44, stl: 8, pf: 20, ast: 22, blk: 4 };
    ok('bpm.js estimatePosition(..., {raw: true}) is the regressed estimate before its clamp (the default still clamps)', B.estimatePosition(p100, t100, 900, 5) === 5 &&
      B.estimatePosition(p100, t100, 900, 5, { raw: true }) > 5);
  }
  r = M.slotMinutes([five(['g1', 'n1', 'n2', 'w', 'f'], 60)], Object.assign({}, est, { n1: { listed: 'C', height: 200 }, n2: { listed: 'PG', height: 210 } }));
  ok('...a missing estimate sorts after every known one, by listed position then height', r.min.get('n2')[3] === 1 && r.min.get('n1')[4] === 1 && r.min.get('f')[2] === 1);
  r = M.slotMinutes([five(['g1', 'g2', null, 'f', 'c'], 60), five(['g1', 'g2', 'w', 'f', 'c'], 30), { ids: ['g1', 'g2', 'w', 'f'], s: 50 }], est);
  ok('...a stint with fewer than five known players is skipped and counted', r.skipped === 2 && r.stints === 1 && r.seconds === 30 && r.min.get('g1')[0] === 0.5);
  r = M.slotMinutes({ p: ['g1', 'g2', 'w', 'f', 'c'], s: [[60, 0, 1, 2, 3, 4], [30, 4, 3, 2, 1, 0]] }, new Map(Object.entries(est)));
  ok('...it reads the feature row\'s compact stints and a Map of estimates', r.stints === 2 && r.min.get('g1')[0] === 1.5 && r.min.get('c')[4] === 1.5);
  r = M.slotMinutes([five(['g1', 'g2', 'w', 'f', 'c'], 60)], { g1: { pos: 2.2 }, g2: 1.44, w: 3, f: 4, c: 5 });
  ok('...dynamic: when a season estimate moves, the slots move with it', r.min.get('g2')[0] === 1 && r.min.get('g1')[1] === 1);
  const rl = M.roles([{ id: 's', min: 900, fga: 300, fg3a: 200, fg3m: 85, ast_pct: 10, blk_pct: 1, usg: 30, hz: -1, group: 'G' },
    { id: 'h', min: 900, fga: 300, fg3a: 20, fg3m: 5, ast_pct: 40, blk_pct: 0.5, usg: 18, hz: -1, group: 'G' },
    { id: 'p', min: 900, fga: 200, fg3a: 0, fg3m: 0, ast_pct: 5, blk_pct: 9, usg: 15, hz: 1.2, group: 'C' },
    { id: 'q', min: 900, fga: 250, fg3a: 60, fg3m: 15, ast_pct: 12, blk_pct: 2, usg: 20, hz: 0.2, group: 'F' },
    { id: 'r', min: 900, fga: 260, fg3a: 90, fg3m: 25, ast_pct: 15, blk_pct: 1.5, usg: 22, hz: 0, group: 'F' }], { p3: 0.34 });
  ok('roles: shooter, handler, protector + big, creator by §7.13 / §7.15\'s rules', rl.get('s').includes('shooter') && rl.get('s').includes('creator') &&
    rl.get('h').includes('handler') && rl.get('p').includes('protector') && rl.get('p').includes('big') && !rl.get('h').includes('shooter'));
  const wk = (d, k) => ({ t: Date.UTC(2026, 9, d, 12 + k) });
  const bl = M.blocksOf([wk(5, 0), wk(5, 1), wk(6, 0), wk(12, 0), wk(13, 0), wk(13, 1), wk(14, 0), wk(14, 1), wk(15, 0), wk(16, 0), wk(19, 0), wk(20, 0),
    wk(20, 1), wk(21, 0), wk(21, 1), wk(22, 0), wk(23, 0), wk(24, 0), wk(26, 0), wk(27, 0)]);
  const sizes = Array.from(new Set(bl)).map(b => bl.filter(x => x === b).length);
  ok('blocksOf: ISO weeks merged forward to at least 8 games, the last into the one before', sizes.every(n => n >= 8) && bl[0] === 0 && bl[19] === bl[11], sizes.join('/'));
}

/* ------------------------------------------------------------------------------------------- the unit --- */
console.log('\na league of 264 games (12 clubs), planted truth');
const A = M.synthUnit({ teams: 12, games: 264, seed: 5 });
const rA = M.buildUnit(A, { now: NOW, B: 80, sim: false, trace: true });
const wA = rA.wins, truth = A.truth;
{
  ok('buildUnit gives wins, fo, a club file and a pos file per club', !!wA && !!rA.fo && rA.clubs.size === 12 && rA.pos.size === 12, rA.ms + ' ms');
  const core = wA.models.core4c, coef = k => core.coef.find(c => c.k === k);
  const signs = core.coef.every(c => Math.sign(c.b) === Math.sign(truth.beta[c.k]));
  ok('core4c: every planted sign', signs, core.coef.map(c => c.k + ' ' + c.b.toFixed(3)).join(', '));
  const within = core.coef.map(c => [c.k, Math.abs(c.b - truth.beta[c.k]) / c.se]);
  ok('...every coefficient within 3 SE of the truth', within.every(x => x[1] < 3), within.map(x => x[0] + ' ' + x[1].toFixed(2)).join(', '));
  ok('...home court within 3 SE of the planted 2.5 points', Math.abs(core.home.v - truth.alpha) < 3 * (core.home.hi - core.home.lo) / 3.92, core.home.v.toFixed(3));
  /* the truth's Shapley shares on the same games: the expected statistics of the planted model on this design */
  const D = M.decodeStore(A.store), hv = new Map(A.teams.map(t => [t.id, t.home_venue_id]));
  const X = [], Y = [];
  D.games.forEach(gm => {
    const a = F.derive(gm.F[0], gm.F[1], gm.q[0], gm.q[1]), b = F.derive(gm.F[1], gm.F[0], gm.q[1], gm.q[0]);
    const row = [gm.v && hv.get(gm.h) && gm.v !== hv.get(gm.h) ? 0 : 1].concat(M.CORE.map(k => a[k] - b[k]));
    if (row.every(isNum) && isNum(a.c_margin)) { X.push(row); Y.push(a.c_margin); }
  });
  const S = W.suff(X, Y), bt = [truth.alpha].concat(M.CORE.map(k => truth.beta[k])), p = S.p;
  const full = W.full(S.xx, p), xy = new Float64Array(p);
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) xy[i] += full[i * p + j] * bt[j];
  let mean = 0; X.forEach(r => { mean += r.reduce((s, v, j) => s + v * bt[j], 0); });
  const T = Object.assign({}, S, { xy, sy: mean, yy: bt.reduce((s, v, i) => s + v * xy[i], 0) + S.n * (truth.sigma * truth.sigma + 1 / 12) });
  const tr = W.shapleyR2(T, M.CORE.map((_, c) => [c + 1]), { force: [0] }).phi.map(v => 100 * v);
  const diffs = core.shares.map((s, c) => Math.abs(s.phi - tr[c]));
  ok('...Shapley R² shares within 5 points of the truth\'s on the same games', diffs.every(d => d < 5),
    core.shares.map((s, c) => s.k + ' ' + s.phi.toFixed(1) + ' vs ' + tr[c].toFixed(1)).join(', '));
  ok('...shares carry their block-bootstrap intervals, and Oliver\'s 40/25/20/15 beside them', core.shares.every(s => s.lo <= s.phi && s.phi <= s.hi) && core.oliver.c_efg === 40);
  ok('...the full-game twin explains about as much (fullR2)', wA.models.fullR2 > 0.85, wA.models.fullR2.toFixed(3));

  /* value scale: wins from σ_pred, never σ_acc (I9) */
  const sp = wA.sigma.pred, sa = wA.sigma.acc;
  const c1 = coef('c_efg');
  const w30 = 30 * (W.normCdf(c1.pts.v / sp) - 0.5), wAcc = 30 * (W.normCdf(c1.pts.v / sa) - 0.5);
  /* the files hold 4 significant figures */
  const near = (a, b, r) => Math.abs(a - b) <= (r || 2e-3) * Math.max(1, Math.abs(a), Math.abs(b));
  ok('wins are worth Φ(pts / σ_pred): σ_pred = predictive.sigma, not core4c.sigma', near(c1.wins30.v, w30) &&
    sp === wA.predictive.sigma && Math.abs(sa - core.sigma) < 1e-12 && Math.abs(sp - sa) > 2 && Math.abs(c1.wins30.v - wAcc) > 0.5, `σ_pred ${sp.toFixed(2)} σ_acc ${sa.toFixed(2)}`);
  ok('...one team-SD better: pts = b x sdTeam.net, intervals ordered', core.coef.every(c => near(c.pts.v, c.b * c.sdTeam.net) &&
    c.pts.lo <= c.pts.v && c.pts.v <= c.pts.hi && c.wins30.lo <= c.wins30.v && c.wins30.v <= c.wins30.hi));

  /* Forecast */
  const P = wA.predictive;
  ok('Forecast: beats home-only where the clubs differ (rolling origin)', P.nEval >= 60 && P.metrics.brier < P.baselines.home.brier,
    `Brier ${P.metrics.brier.toFixed(4)} home ${P.baselines.home.brier.toFixed(4)} Elo ${P.baselines.elo.brier.toFixed(4)} net ${P.baselines.net.brier.toFixed(4)}, n ${P.nEval}`);
  ok('...the gate: live only with 60 test games, Brier below home-only and within 0.002 of Elo', P.live === (P.nEval >= 60 && P.metrics.brier < P.baselines.home.brier && P.metrics.brier <= P.baselines.elo.brier + 0.002) &&
    wA.sigma.src === (P.live ? 'forecast' : 'elo') && wA.lens.forecast === P.live);
  const tr2 = rA.trace, gT = tr2.games;
  const iso = t => { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
  let leak = 0, tested = 0;
  tr2.weeks.forEach(w => {
    if (!w.tested.length) return;
    const start = Math.min(...w.tested.map(i => iso(gT[i].t)));
    w.tested.forEach(i => { tested++; if (w.trained.includes(i)) leak++; });
    w.trained.forEach(i => { if (gT[i].t >= start) leak++; });
  });
  ok('...the rolling origin never trains on a game in or after the week it predicts', tested >= 60 && leak === 0, tested + ' tested, ' + leak + ' leaks');
  const seen = new Map(); let early = 0;
  gT.forEach((gm, i) => {
    const before = gT.filter((x, j) => j < i && x.t < gm.t);
    const nh = before.filter(x => x.h === gm.h || x.a === gm.h).length, na = before.filter(x => x.h === gm.a || x.a === gm.a).length;
    if (tr2.pre[i][0] !== nh || tr2.pre[i][1] !== na) early++;
    seen.set(gm.id, 1);
  });
  ok('...a pre-game profile counts only the clubs\' earlier games', early === 0, early + ' games off');

  /* path and lineups: the planted effects */
  const tf = wA.path.find(x => x.k === 'tr_freq'), indirect = truth.beta.c_efg * truth.trEfg;
  ok('path: transition frequency works through eFG (planted indirect ≈ ' + indirect + ' points per unit)', !!tf && tf.indirect.lo > 0 && tf.indirect.lo <= indirect && indirect <= tf.indirect.hi &&
    near(tf.indirect.v, tf.via.reduce((s, v) => s + v.v, 0)) && tf.via.find(v => v.f === 'c_efg').v > 0.8 * tf.indirect.v,
    tf ? `indirect ${tf.indirect.v.toFixed(1)} (${tf.indirect.lo.toFixed(1)} to ${tf.indirect.hi.toFixed(1)}), direct ${tf.direct.v.toFixed(1)} (${tf.direct.lo.toFixed(1)} to ${tf.direct.hi.toFixed(1)})` : 'none');
  ok('...and nothing directly: its direct effect\'s interval holds 0', !!tf && tf.direct.lo <= 0 && 0 <= tf.direct.hi);
  ok('...the extended model adds next to nothing (F test not significant at 1%)', wA.models.extended && wA.models.extended.p > 0.01 && wA.models.extended.addR2.v < 0.02,
    wA.models.extended && `+R² ${wA.models.extended.addR2.v.toFixed(4)}, p ${wA.models.extended.p.toFixed(3)}`);
  const sh = wA.lineup && wA.lineup.terms.find(t => t.k === 'shooters');
  ok('lineups: the planted shooter effect (+' + truth.shooter + ' net per 100 a shooter) comes back', !!sh && sh.lo <= truth.shooter && truth.shooter <= sh.hi && sh.lo > 0,
    sh ? `${sh.b.toFixed(2)} (${sh.lo.toFixed(2)} to ${sh.hi.toFixed(2)})` : 'none');
  const ref = wA.lineup.grid.find(c => c.s === 2 && c.b === '1');
  ok('...the grid is net per 100 against the reference five (2 shooters, 1 big)', ref.net === 0 && wA.lineup.grid.length === 15 && wA.lineup.grid.every(c => c.s + (c.b === '2+' ? 2 : +c.b) <= 5));
  {
    /* POS-1: no feature constant across clubs carries a coefficient or a z (slot minutes make G/F/C minute shares
       0.4 / 0.4 / 0.2 and pos_entropy the same for every club) */
    const clubs = Array.from(rA.clubs.values()), spreadOf = v => { const x = v.filter(isNum); if (x.length < 2) return 0; const m = x.reduce((a, b) => a + b, 0) / x.length;
      return Math.sqrt(x.reduce((a, b) => a + (b - m) * (b - m), 0) / (x.length - 1)); };
    const sq = (rA.fo.squad && rA.fo.squad.coef) || [];
    const flatSq = sq.filter(c => spreadOf(clubs.map(cl => cl.squad[c.k])) < 1e-6 * Math.max(1, Math.abs(clubs[0].squad[c.k] || 0)));
    const flatSlot = [];
    ['G', 'F', 'C'].forEach(g => Object.keys(clubs[0].slots[g] || {}).forEach(st => {
      const v = clubs.map(cl => cl.slots[g][st].v);
      if (spreadOf(v) < 1e-6 * Math.max(1, Math.abs(v[0] || 0)) && clubs.some(cl => isNum(cl.slots[g][st].z) && cl.slots[g][st].z !== 0)) flatSlot.push(g + ':' + st);
    }));
    let zBad = 0, zN = 0;
    ['G', 'F', 'C'].forEach(g => Object.keys(clubs[0].slots[g] || {}).forEach(st => {
      const vs = clubs.map(cl => cl.slots[g][st].v), m = vs.reduce((a, b) => a + b, 0) / vs.length;
      clubs.forEach(cl => { const c = cl.slots[g][st]; if (!isNum(c.sd) || !isNum(c.z)) return; zN++; const tol = 6e-4 * (Math.abs(c.v) + Math.abs(m)) / c.sd + 2e-3 * Math.max(1, Math.abs(c.z)); /* v, z and sd at 4 significant figures in the file */
        if (Math.abs(c.z - (c.v - m) / c.sd) > tol) zBad++; });
    }));
    ok('every slot cell\'s z is (v − the clubs\' mean) / sd, with that sd in the file (TC5)', zN > 50 && !zBad, zBad + ' of ' + zN);
    ok('a spread of floating-point noise around a constant is 0 (0.4 ± 1e-10 across clubs: slot minutes), a real one is kept', M._sdReal([0.4, 0.4 + 7e-10, 0.4 - 3e-10, 0.4]) === 0 &&
      M._sdReal([0.96, 0.9614, 0.9602]) > 0 && M._sdReal([1, 2, 3]) === 1);
    ok('no squad feature or slot statistic constant across clubs carries a coefficient or a non-zero z (min_share and pos_entropy under slot minutes)',
      !flatSq.length && !flatSlot.length && !(rA.fo.slots && rA.fo.slots.stats.includes('min_share') && clubs.every(cl => Math.abs(cl.slots.G.min_share.v - 0.4) < 1e-6)), [flatSq.map(c => c.k), flatSlot]);
  }
  {
    /* S8 (§7.3): the CR1 and block-bootstrap SEs are compared, and a gap over 30% is a job-summary warning */
    const sc = wA.models.core4c.seCheck;
    ok('the CR1 and bootstrap SEs are compared per coefficient (§7.3); over 30% apart is a warning', !!sc && isNum(sc.worst) &&
      (sc.worst > 0.3) === rA.warnings.some(w => /core4c: the CR1 and block-bootstrap SEs disagree/.test(w)), sc);
  }
  const club0 = rA.clubs.values().next().value;
  const roleShooters = new Set(); rA.clubs.forEach(c => c.players.forEach(p => { if (p.roles.includes('shooter')) roleShooters.add(p.id); }));
  const hit = Array.from(roleShooters).filter(id => truth.shooters.has(id)).length;
  ok('...the shooter rule finds the planted shooters', roleShooters.size > 0 && hit / roleShooters.size >= 0.8, hit + ' of ' + roleShooters.size);

  /* causes: the identity in every club file */
  let worst = 0, games = 0;
  rA.clubs.forEach(c => c.games.forEach(gm => { games++; const s = gm.xm + Object.values(gm.parts).reduce((a, b) => a + b, 0); worst = Math.max(worst, Math.abs(gm.m - s)); }));
  ok('Oaxaca: margin = expected + quality + making + tovp + orebp + ftmr + other + garbage, every game of every club (1e-9)', games === 2 * 264 && worst < 1e-9, games + ' games, worst ' + worst.toExponential(1));
  ok('...the league\'s average loss carries the same parts with intervals', wA.losses.parts.map(p => p.k).join() === 'expected,quality,making,tovp,orebp,ftmr,other,garbage' && wA.losses.n === 264);
  ok('...club records: w + l = games, factor-expected and Pythagorean wins within the games', Array.from(rA.clubs.values()).every(c => c.record.w + c.record.l === c.games.length &&
    c.record.factorW >= 0 && c.record.factorW <= c.games.length && c.record.pythW >= 0 && c.record.pythW <= c.games.length));
  ok('...a club file holds only its own games, with the realised rates of its last ten defeats', Array.from(rA.clubs.entries()).every(([tid, c]) => c.team.id === tid &&
    c.games.every(gm => gm.opp !== tid) && Object.keys(c.realised).length <= 10 && Object.values(c.realised).every(r => r.own && isNum(r.own.tov) && isNum(r.opp.p3))));

  /* positions (A.1) */
  const pos = rA.pos.values().next().value;
  ok('pos files (A.1): players by total minutes, five slots, minutes at each slot summing to the club\'s', !!pos && pos.w === 1 && pos.players.every((p, i, a) => p.min.length === 5 &&
    (i === 0 || p.min.reduce((x, y) => x + y) <= a[i - 1].min.reduce((x, y) => x + y) + 1e-9)) && Math.abs(pos.min - 200 * pos.games) < 0.08 * 200 * pos.games &&
    pos.slots.length === 5 && pos.slots.every(s => s.top.length >= 1), pos && `${pos.min} min over ${pos.games} games`);
  ok('...each slot\'s top player is the one with most minutes there; no names', pos.slots.every((s, k) => { const best = pos.players.slice().sort((a, b) => b.min[k] - a.min[k])[0]; return s.top[0] === best.id; }) &&
    !JSON.stringify(pos).includes('"name"'));
  ok('...and embedded in fo and the club file', rA.fo.pos && Object.keys(rA.fo.pos).length === 12 && club0.pos && club0.pos.team === club0.team.id);
  const p1 = wA.positions.p1;
  ok('P1 (21 cells), P2 (targets) and P2f (264 games >= 200) are there', p1.length === 21 && wA.positions.p2.length === 27 && wA.positions.p2f && wA.positions.p2f.length === 3);
  const mixed = ['usg_share', 'ast_share', 'reb_share', 'tov_share'].every(st => { const v = p1.filter(c => c.stat === st).map(c => Math.sign(c.b)); return v.length === 3 && !(v.every(x => x > 0) || v.every(x => x < 0)); });
  ok('...the share stats (they add up to the whole team across G, F, C) are contrasts: never all three of one sign', mixed);
  const wh = new Set(A.store.ctx.withheld);
  let leaked = 0; rA.clubs.forEach(c => c.players.forEach(p => { if (wh.has(p.id)) leaked++; }));
  rA.pos.forEach(pf => pf.players.forEach(p => { if (wh.has(p.id)) leaked++; }));
  ok('withheld players are left out of every per-player row (I6)', wh.size > 0 && leaked === 0, wh.size + ' withheld');

  /* files */
  const probs = [M.validate(wA, 'wins'), M.validate(rA.fo, 'fo'), ...Array.from(rA.clubs.values()).map(c => M.validate(c, 'club', { withheld: wh })),
    ...Array.from(rA.pos.values()).map(pf => M.validate(pf, 'pos', { withheld: wh }))].flat();
  ok('validate: every file of the unit passes', !probs.length, probs.slice(0, 3).join('; '));
  const bytes = f => Buffer.byteLength(JSON.stringify(f));
  const maxClub = Math.max(...Array.from(rA.clubs.values()).map(bytes)), maxPos = Math.max(...Array.from(rA.pos.values()).map(bytes));
  ok('...within budget: wins 300 KB, fo 100 KB, club 25 KB, pos 6 KB', bytes(wA) <= 300000 && bytes(rA.fo) <= 100000 && maxClub <= 25000 && maxPos <= 6000,
    `wins ${bytes(wA)}, fo ${bytes(rA.fo)}, club ${maxClub}, pos ${maxPos}`);
  ok('...the league file carries its blocks (n >= 8 each), keys h + the core four + the style set', wA.blocks && wA.blocks.keys.slice(0, 5).join() === 'h,c_efg,c_tovp,c_orebp,c_ftmr' &&
    wA.blocks.list.every(b => b.n >= 8 && b.xx.length === wA.blocks.keys.length * (wA.blocks.keys.length + 1) / 2));
  const sumB = W.sumSuff(wA.blocks.list.map(b => Object.assign({ p: wA.blocks.keys.length }, b, { xx: Float64Array.from(b.xx), xy: Float64Array.from(b.xy) })));
  const re = W.ridge(W.pick(sumB, [0, 1, 2, 3, 4]), { lambda: 0 });
  ok('...re-fitting the core four from the file\'s blocks gives the core model back (a page\'s re-fit)', re && core.coef.every((c, j) => Math.abs(re.b[j + 1] - c.b) < 0.02 * Math.max(1, Math.abs(c.b))),
    re && re.b.slice(1).map(v => v.toFixed(3)).join(', '));
  const bad = JSON.parse(JSON.stringify(club0));
  bad.games[0].g = 'not-a-game'; bad.players.push({ id: Array.from(wh)[0], g: 'G', v: 1, min: 10, bpm: null, roles: [] }); bad.extra = { f: [1, 2, 3] }; bad.note = 'x'.repeat(60);
  bad.vec = new Array(108).fill(1);
  const bp = M.validate(bad, 'club', { games: new Set(club0.games.map(x => x.g)), withheld: wh });
  ok('validate catches another club\'s game, a withheld player, a key f, a 108-vector, a long string', ['not the club', 'withheld', 'key f', '108-number', 'over 40'].every(s => bp.some(x => x.includes(s))), bp.length + ' problems');
  const big = JSON.parse(JSON.stringify(wA)); big.pad = 'y'.repeat(30);
  big.scan = Array.from({ length: 4000 }, () => wA.scan[0]);
  ok('...and a file more than 25% over its budget', M.validate(big, 'wins').some(x => x.startsWith('over budget')));
  const rB = M.buildUnit(A, { now: NOW, B: 80, sim: false });
  ok('deterministic: the same lines give byte-identical files', JSON.stringify(rB.wins) === JSON.stringify(wA) && JSON.stringify(rB.fo) === JSON.stringify(rA.fo) &&
    JSON.stringify(Array.from(rB.clubs.values())) === JSON.stringify(Array.from(rA.clubs.values())));
  const meta = wA.meta;
  ok('the files speak in their lenses: header, meta, sigma, quality', wA.w === 1 && wA.scope === 'wins' && wA.lens.explain === true && wA.n.games === 264 &&
    meta.c_efg && meta.c_efg.label && wA.quality.ok.zones === true && wA.sigma.pred > 0 && wA.homeWin.n > 0);
  ok('scan: BH q on every diff factor, score factors badged, no p left in the file', wA.scan.length > 30 && wA.scan.every(s => isNum(s.q) && !('p' in s)) &&
    wA.scan.some(s => s.score) && wA.scan.find(s => s.k === 'c_efg').r > 0.4);
  const ce = wA.curves.c_efg;
  ok('curves: bins (n >= 30), a raw curve, x50/x75 with intervals, quartiles, the hard number', ce && ce.bins.every(b => b[3] >= 30) && ce.raw.length >= 15 &&
    ce.x75 && ce.x75.lo <= ce.x75.v && ce.x75.v <= ce.x75.hi && ce.quart.length === 4 && ce.hard && ce.hard.n >= 50 && [1, 2, 2.5, 5].some(m => [0.1, 1, 10].some(e => Math.abs(ce.hard.t - m * e) < 1e-9)));
  ok('tempo: clubs, quintile bins, √N, points per first chance by window', wA.tempo.teams.length === 12 && wA.tempo.bins.length === 5 && wA.tempo.sqrtN && wA.tempo.windows &&
    wA.tempo.windows.e.v > wA.tempo.windows.l.v);
  ok('squad: n = club seasons, power \'low\' under 50, evidence words only with intervals', wA.squad && wA.squad.n === 12 && wA.squad.power === 'low' &&
    wA.squad.coef.every(c => c.evidence !== 'strong' || (c.lo > 0 || c.hi < 0)));
}

/* ------------------------------------------------------------------------------------------- pooled --- */
console.log('\nthe pooled unit, the priors, a small league, the teaser');
const B2 = M.synthUnit({ teams: 10, games: 150, seed: 12 });
const C = M.synthUnit({ teams: 8, games: 40, seed: 13, zones: false });
const open = new Set([A.league.id, B2.league.id]);
const D3 = M.synthUnit({ teams: 8, games: 64, seed: 14 }), E3 = M.synthUnit({ teams: 8, games: 64, seed: 15 });
const pool = M.buildPool([A, B2, C, D3, E3], open, { now: NOW, B: 60 });
{
  const pw = pool.wins;
  ok('buildPool: the pooled wins file and the priors', !!pw && pw.league === null && pw.season === null && pool.priors && pool.priors.core && pool.priors.core.beta.c_efg > 0,
    pw && `${pw.n.games} games`);
  ok('...no blocks, and per-league rows only for the open leagues (I5)', pw.blocks === null && pw.leagues.length === 2 && pw.leagues.every(l => open.has(l.id)) &&
    M.validate(pw, 'wins', { open }).length === 0);
  const hp = pw.models.core4c.home;
  ok('...the pooled home court is the games-weighted mean of the leagues\' alphas (not the first league\'s), with its interval', isNum(hp.v) &&
    Math.abs(hp.v - pool.priors.core.beta.h) < 2e-3 && hp.lo < hp.v && hp.hi > hp.v, `${hp.v} vs ${pool.priors.core.beta.h}`);
  const closedTeams = new Set([C, D3, E3].flatMap(u => u.teams.map(t => t.id)));
  ok('...the tempo table names no club of a closed league', pw.tempo.teams.length > 0 && pw.tempo.teams.every(t => !closedTeams.has(t.id)));
  ok('...league-out transfer for each open league with 50 games', Array.isArray(pw.predictive.transfer) && pw.predictive.transfer.length === 2 && pw.predictive.transfer.every(t => t.brier > 0 && t.brier < 0.3));
  const leaked = JSON.parse(JSON.stringify(pw)); leaked.leagues.push(Object.assign({}, leaked.leagues[0], { id: C.league.id, slug: 'closed' })); leaked.blocks = { list: [] };
  const lp = M.validate(leaked, 'wins', { open });
  ok('validate catches pooled blocks and a closed league', lp.some(x => x.includes('blocks')) && lp.some(x => x.includes('not open')));
  ok('...priors: τ² per coefficient, σ_pred, the forecast coefficients, the free-throw split', ['h'].concat(M.CORE).every(k => pool.priors.core.tau2[k] > 0) &&
    pool.priors.sigmaPred > 5 && pool.priors.forecast && isNum(pool.priors.split));
  const small = M.synthUnit({ teams: 6, games: 30, seed: 31, truth: { sigma: 7 } });
  const rs = M.buildUnit(small, { now: NOW, B: 60, sim: false, priors: pool.priors });
  const ws = rs.wins.models.core4c.coef, mw = ws.reduce((s, c) => s + c.w, 0) / ws.length;
  ok('a small league (30 games) is shrunk toward the pooled priors: pooled weight above 0.6', mw > 0.6 && ws.every(c => c.own === null) &&
    ws.every(c => (c.b - pool.priors.core.beta[c.k]) * (c.bOwn === undefined ? 1 : 1) !== null),
    ws.map(c => c.k + ' ' + c.w.toFixed(2)).join(', ') + ` (τ² ${M.CORE.map(k => pool.priors.core.tau2[k].toPrecision(2)).join(', ')})`);
  const big = M.buildUnit(A, { now: NOW, B: 60, sim: false, priors: pool.priors });
  const wb = big.wins.models.core4c.coef;
  ok('...a league of 200 games or more shows its own estimate beside the shrunk one, and leans less on the pool', wb.every(c => c.own && isNum(c.own.v)) &&
    wb.reduce((s, c) => s + c.w, 0) < ws.reduce((s, c) => s + c.w, 0), wb.map(c => c.k + ' ' + c.w.toFixed(2)).join(', '));
  ok('under 20 games: no league files', M.buildUnit(M.synthUnit({ teams: 6, games: 15, seed: 3 }), { now: NOW, B: 20, sim: false }).wins === null);
  const teaser = M.buildTeaser([A, B2, C, D3, E3], open, { now: NOW, token: 't' });
  const pub = new Set(F.PUBLIC_KEYS);
  ok('teaser: only PUBLIC_KEYS, open leagues only, shares in [0, 1], within 40 KB', teaser.ranked.length > 5 && teaser.ranked.every(r => pub.has(r.k)) &&
    (teaser.factors ? teaser.factors.shares.every(s => pub.has(s.k)) : true) && teaser.leagues.length === 2 && teaser.homeWin > 0 && teaser.homeWin < 1 &&
    teaser.n === 264 + 150 && M.validate(teaser, 'teaser').length === 0 && Buffer.byteLength(JSON.stringify(teaser)) <= 40000, Buffer.byteLength(JSON.stringify(teaser)) + ' B');
  const pt = M.poolToken([A.token, B2.token], open), pt2 = M.poolToken([B2.token, A.token], new Set([B2.league.id, A.league.id])), pt3 = M.poolToken([A.token, B2.token], new Set([A.league.id]));
  ok('the pooled token: order-free, and it changes with the open set', pt === pt2 && pt !== pt3 && /^\d+@.+@u[0-9a-f]+@o[0-9a-f]+$/.test(pt));
}

/* ------------------------------------------------------------------------------------------- NCAA size --- */
console.log('\na league of 350 clubs (NCAA size): the Front office file');
{
  const big = M.buildUnit(M.synthUnit({ teams: 350, games: 3600, seed: 3 }), { now: NOW, B: 20, sim: false });
  const fo = big.fo, S = g('EpinoiaWinSim', 'winsim.js');
  ok('350 clubs: the fo file is written (compact profiles, a per-club allowance) and validates', !!fo && fo.teams.length === 350 && M.validate(fo, 'fo').length === 0 &&
    Buffer.byteLength(JSON.stringify(fo)) <= M.budgetOf('fo', fo) * 1.25, fo ? Buffer.byteLength(JSON.stringify(fo)) + ' B, budget ' + M.budgetOf('fo', fo) : big.warnings.filter(w => /fo/.test(w)));
  const a = fo && fo.teams[0], b = fo && fo.teams[1];
  const r = a && S.simulate(S.matchup(a.prof, b.prof, fo.lg, { home: 1 }), { n: 400, seed: 1 });
  ok('...its compact profiles (an array a end) simulate as the full ones do', !!r && r.pWin > 0 && r.pWin < 1 && Array.isArray(a.prof.off) && a.prof.off.length === S.RATES.length &&
    isNum(S.natural(a.prof.off).efg) && isNum(S.applyEdits(a.prof, [{ end: 'off', key: 'efg', delta: 2 }], fo.lg).off.p3));
}

/* ------------------------------------------------------------------------------------------- update (A.2) --- */
console.log('\nRECALCULATE: update(store, delta) against a full build of the union (A.2)');
{
  const U = M.synthUnit({ teams: 10, games: 160, seed: 7 });
  const D = M.decodeStore(U.store), late = new Set(D.games.slice(-12).map(x => x.id));
  const raw = U.raw, pick = r => late.has(r.game_id), keepR = r => !late.has(r.game_id);
  const ctx = U.store.ctx;
  /* the store before the last 12 games, built the way the builder builds it, and its full build (the carry) */
  let S0 = M.storeAdd(M.emptyStore(U.league.id, U.season.id), raw.rows.filter(keepR), raw.games.filter(x => !late.has(x.id)), raw.pgs.filter(keepR), raw.stints.filter(keepR), { kinds: ctx.kinds });
  S0.ctx = ctx;
  const r0 = M.buildUnit(M.inputFromStore(S0), { now: '2026-09-30T00:00:00.000Z', B: 40, sim: false });
  S0.carry = r0.carry; S0.ci_at = '2026-09-30T00:00:00.000Z';
  const t1 = Date.now();
  const up = M.update(S0, { rows: raw.rows.filter(pick), games: raw.games.filter(x => late.has(x.id)), pgs: raw.pgs.filter(pick), stints: raw.stints.filter(pick) }, { now: NOW, raw: true });
  const dtU = Date.now() - t1;
  const body = s => JSON.stringify(Object.assign({}, s, { ctx: null, carry: null, ci_at: null }));
  const fresh = M.storeAdd(M.emptyStore(U.league.id, U.season.id), raw.rows, raw.games, raw.pgs, raw.stints, { kinds: ctx.kinds });
  ok('the updated store equals the store built from nothing on the union (byte for byte)', body(up.store) === body(fresh) && up.store.n === 160, up.store.n + ' games');
  ok('...it keeps its context and the last full build\'s carry', up.store.ctx === ctx && up.store.carry === S0.carry && up.token === '160@' + fresh.wm.at);
  const F1 = Object.assign({}, fresh, { ctx });
  const full = M.buildUnit(M.inputFromStore(F1), { now: NOW, B: 40, sim: false, raw: true, token: up.token });
  const SKIP = new Set(['lo', 'hi', 'se', 'seCheck', 'topLo', 'topHi', 'star', 'evidence', 'power', 'logitAgree', 'ci_at', 'built', 'sim', 'lens', 'platt', 'calibrated',
    'kappaN', 'sigmaN', 'hca', 'tau', 'muOff', 'dTr', 'lead', 'fouling', 'checks', 'own', 'gamma', 'x50', 'x75', 'addR2', 'or']);
  let worst = 0, where = '', count = 0;
  const cmp = (a, b, p) => {
    if (/\.pd\.[a-z_]+\[\d+\]\[[23]\]$/.test(p)) return;        // a partial-dependence row's interval ends
    if (typeof a === 'number' || typeof b === 'number') {
      if (a == null && b == null) return;
      const d = Math.abs(a - b) / Math.max(1, Math.abs(a));
      count++;
      if (!(d <= worst)) { worst = isNaN(d) ? Infinity : d; where = p + ' ' + a + ' / ' + b; }
      return;
    }
    if (Array.isArray(a)) { a.forEach((x, i) => cmp(x, b && b[i], p + '[' + i + ']')); if (!Array.isArray(b) || b.length !== a.length) { worst = Infinity; where = p + ' length'; } return; }
    if (a && typeof a === 'object') Object.keys(a).forEach(k => { if (!SKIP.has(k)) cmp(a[k], b ? b[k] : undefined, p + '.' + k); });
  };
  cmp(full.wins, up.files.wins, 'wins'); cmp(full.fo, up.files.fo, 'fo');
  full.clubs.forEach((c, k) => cmp(c, up.files.club[k], 'club'));
  full.pos.forEach((c, k) => cmp(c, up.files.pos[k], 'pos'));
  ok('every point estimate of every file equals the full build of the union (1e-9)', count > 20000 && worst <= 1e-9, `${count} numbers, worst ${worst.toExponential(2)} ${worst > 1e-9 ? where : ''}`);
  const cA = up.files.wins.models.core4c.coef[0], cR = r0.wins.models.core4c.coef[0];
  ok('...the intervals are the last full build\'s, flagged with its ci_at', up.files.wins.ci_at === '2026-09-30T00:00:00.000Z' && full.wins.ci_at === NOW &&
    cA.lo === cR.lo && cA.hi === cR.hi && up.files.wins.built === NOW);
  ok('...files for wins, fo, every club and every pos', up.files.wins && up.files.fo && Object.keys(up.files.club).length === 10 && Object.keys(up.files.pos).length === 10);
  const packed = M.update(S0, { rows: raw.rows.filter(pick), games: raw.games.filter(x => late.has(x.id)), pgs: raw.pgs.filter(pick), stints: raw.stints.filter(pick) }, { now: NOW });
  ok('...packed (4 significant figures) they validate and fit their budgets', M.validate(packed.files.wins, 'wins').length === 0 && M.validate(packed.files.fo, 'fo').length === 0 &&
    Object.values(packed.files.club).every(c => M.validate(c, 'club').length === 0));
  ok('...in a fraction of a full build', dtU < 4000, `update ${dtU} ms (12 new of 160 games), full ${full.ms} ms`);
  {
    /* S6: carried intervals are matched by column NAME: when the data move a column set between the full build and an
       update (VIF pruning, the coverage cut, the travel term), that model shows no interval rather than a neighbour's */
    const dl = { rows: raw.rows.filter(pick), games: raw.games.filter(x => late.has(x.id)), pgs: raw.pgs.filter(pick), stints: raw.stints.filter(pick) };
    ok('the carry records each model\'s column names', S0.carry.ci['model:core4c'].cols === ['h'].concat(M.CORE).join('|'), S0.carry.ci['model:core4c'].cols);
    const ci = Object.assign({}, S0.carry.ci, { 'model:core4c': Object.assign({}, S0.carry.ci['model:core4c'], { cols: 'h|c_tovp|c_efg|c_orebp|c_ftmr' }) });
    const moved = M.update(Object.assign({}, S0, { carry: Object.assign({}, S0.carry, { ci }) }), dl, { now: NOW, raw: true });
    const kept = M.update(S0, dl, { now: NOW, raw: true });
    ok('...an update whose columns moved shows no interval for that model; one whose columns held keeps the carried ones',
      moved.files.wins.models.core4c.coef.every(c => c.lo === null && c.hi === null) && kept.files.wins.models.core4c.coef.every(c => isNum(c.lo) && isNum(c.hi)));
  }
  {
    /* SEC-1 (I6): the store's context missed a withheld player (his first games are in the delta, or his consent was
       withdrawn since the last build); the caller's database list, passed as opts.withheld, keeps him out of every file */
    const Wd = ctx.withheld[0];
    const S1 = Object.assign({}, S0, { ctx: Object.assign({}, ctx, { withheld: ctx.withheld.filter(x => x !== Wd) }) });
    const dl = { rows: raw.rows.filter(pick), games: raw.games.filter(x => late.has(x.id)), pgs: raw.pgs.filter(pick), stints: raw.stints.filter(pick) };
    const leak = M.update(S1, dl, { now: NOW }), safe = M.update(S1, dl, { now: NOW, withheld: [Wd] });
    const names = u => [u.files.fo].concat(Object.values(u.files.club || {}), Object.values(u.files.pos || {})).some(f => JSON.stringify(f).includes(Wd));
    ok('update(..., {withheld}): a withheld player missing from the store\'s context is left out of fo, club and pos (and kept in the context)', names(leak) && !names(safe) &&
      safe.store.ctx.withheld.includes(Wd) && Object.values(safe.files.club).every(c => M.validate(c, 'club', { withheld: new Set(ctx.withheld) }).length === 0));
    ok('...and update() names the clubs whose games changed', Array.isArray(safe.changed) && safe.changed.length >= 2 && safe.changed.every(t => dl.games.some(g => g.home_team_id === t || g.away_team_id === t)));
  }
  {
    /* POS-2: a delta whose lineup_stints came back cut short (a capped read) falls back to the row's own stints */
    const g0 = raw.games.find(x => late.has(x.id)).id;
    const rowsG = raw.rows.filter(r => r.game_id === g0), stG = raw.stints.filter(r => r.game_id === g0);
    ok('stintGaps: a game with a side\'s stints cut short is named, a complete one is not', JSON.stringify(M.stintGaps(rowsG, stG.slice(0, 3))) === JSON.stringify([g0]) &&
      M.stintGaps(rowsG, stG).length === 0, [M.stintGaps(rowsG, stG.slice(0, 3)), M.stintGaps(rowsG, stG)]);
    const withSt = rowsG.map(r => Object.assign({}, r, { st: { p: ['a1', 'a2', 'a3', 'a4', 'a5'], s: [[60 * r.f[F.INDEX.minutes], 0, 1, 2, 3, 4]] } }));
    const cut = M.storeAdd(M.emptyStore(U.league.id, U.season.id), withSt, raw.games.filter(x => x.id === g0), [], stG.slice(0, 3), { kinds: ctx.kinds });
    const secs = M.decodeStore(cut).stints.reduce((t, x) => t + x.dur, 0);
    ok('...storeAdd keeps the row\'s own stints for a side whose rows fall short, not the cut rows', Math.abs(secs - 2 * 60 * rowsG[0].f[F.INDEX.minutes]) < 1, secs);
  }
  const again = M.update(packed.store, { rows: raw.rows.filter(pick), games: raw.games.filter(x => late.has(x.id)), pgs: [], stints: [] }, { now: NOW });
  ok('a game that comes back (re-finalised) replaces what the store held for it', again.store.n === 160);
  const refin = raw.rows.filter(pick).slice(0, 2).map(r => Object.assign({}, r, { finalised_at: '2027-01-01T00:00:00.000Z', f: r.f.map((v, i) => (i === F.INDEX.pts ? v + 1 : v)) }));
  const again2 = M.update(packed.store, { rows: refin, games: raw.games.filter(x => x.id === refin[0].game_id), pgs: [], stints: [] }, { now: NOW });
  const D2 = M.decodeStore(again2.store), gi = D2.games.findIndex(x => x.id === refin[0].game_id);
  ok('...its new line is the one kept, and the watermark moves to it', again2.store.n === 160 && D2.games[gi].F[0][F.INDEX.pts] === refin[0].f[F.INDEX.pts] &&
    again2.store.wm.at === '2027-01-01T00:00:00.000Z');
  /* the Edge Function's copy: no require, the modules analytics-file imports as globals (+ bpm.js), nothing else */
  const fs = await import('node:fs'), vm = await import('node:vm');
  const edge = withBpm => {
    const sb = { console }; sb.globalThis = sb; sb.self = sb;
    const cx = vm.createContext(sb);
    ['features.js', 'winstats.js', 'winsim.js'].concat(withBpm ? ['bpm.js'] : [], ['winmodel.js']).forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia', f), 'utf8'), cx, { filename: f }));
    return sb.EpinoiaWinModel.update(JSON.parse(JSON.stringify(S0)), JSON.parse(JSON.stringify({ rows: raw.rows.filter(pick), games: raw.games.filter(x => late.has(x.id)), pgs: raw.pgs.filter(pick), stints: raw.stints.filter(pick) })), { now: NOW });
  };
  const e1 = edge(true), e0 = edge(false);
  ok('the Edge Function\'s copy (globals, no require) with bpm.js gives the same files as the builder', ['wins', 'fo', 'club', 'pos'].every(k => JSON.stringify(e1.files[k]) === JSON.stringify(packed.files[k])) &&
    JSON.stringify(e1.store) === JSON.stringify(packed.store));
  ok('...and without bpm.js it would not (analytics-file must import ../_shared/bpm.js)', JSON.stringify(e0.files.wins) !== JSON.stringify(packed.files.wins));
  const dropped = M.storeDrop(packed.store, [refin[0].game_id]);
  ok('storeDrop leaves the game out with its lines', dropped.n === 159 && !M.decodeStore(dropped).games.some(x => x.id === refin[0].game_id));
}

/* ------------------------------------------------------------------------------------------- simulator --- */
console.log('\nthe simulator\'s calibration (§8.3) and the Front office file');
{
  const U = M.synthUnit({ teams: 10, games: 150, seed: 3 });
  const r = M.buildUnit(U, { now: NOW, B: 30, simOpts: { fitN: 40, fitSims: 40, evalSims: 120 } });
  const lg = r.fo.lg;
  ok('EpinoiaWinSim.calibrate runs on the rolling-origin games; fo.lg carries its fields (lead and ft3 too)', ['kappaN', 'sigmaN', 'hca', 'tau', 'muOff', 'dTr', 'lead', 'ft3', 'T', 'Tot', 'G', 'homeEdge']
    .every(k => isNum(lg[k])) && typeof lg.fouling === 'boolean' && lg.rates && lg.rates.tov > 0 && lg.T === 2400, `κN ${lg.kappaN} hca ${lg.hca} lead ${lg.lead}`);
  const s = r.wins.predictive.sim;
  ok('...the gate: calibrated only with Brier near the best of Forecast and Elo and slope in [0.85, 1.15]', !!s && typeof s.calibrated === 'boolean' && isNum(s.brier) && s.checks.pace &&
    r.fo.sim.calibrated === s.calibrated && r.wins.lens.simulate === s.calibrated && (!s.calibrated || (s.slope >= 0.85 && s.slope <= 1.15)), s && `Brier ${s.brier}, slope ${s.slope}`);
  ok('...observed vs simulated pace, ortg, eFG, TOV%, OREB%, FT rate, margin SD, close games, overtime', s && ['pace', 'ortg', 'efg', 'tovp', 'orebp', 'ftr', 'marginSd', 'close5', 'ot'].every(k => s.checks[k] && isNum(s.checks[k].obs)));
  const t = r.fo.teams[0];
  ok('fo: clubs with profiles (16 rates an end) and season factors at both ends; values with P25/P50/P75', r.fo.teams.length === 10 && Object.keys(t.prof.off).length === 16 &&
    t.f.c_efg && isNum(t.f.c_efg.off) && r.fo.value.c_efg && isNum(r.fo.value.c_efg.p75.off) && r.fo.value.c_tovp.dir === -1);
  ok('...the slots (P1 values, P2 targets, P2f), the squad and the lineup grid', r.fo.slots && r.fo.slots.p1.length === 21 && r.fo.squad && r.fo.lineup && r.fo.lineup.grid.length === 15);
  ok('...and the carry (intervals + the calibration) for RECALCULATE', r.carry && r.carry.at === NOW && Object.keys(r.carry.ci).length > 20 && r.carry.sim && isNum(r.carry.sim.kappaN));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
process.exit(fail ? 1 : 0);
