// MANAGER MODE'S CORE (epinoia/manager/core/): values, the 1-20 attributes, the schedule and table, names, badges,
// the player cards, the game engine and the season - on a synthetic league, no network.
//   node supabase/tests/manager-core.test.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia');
globalThis.EpinoiaWinStats = require(path.join(ROOT, 'winstats.js'));
const Sim = require(path.join(ROOT, 'winsim.js'));
const Mgr = {};
['value', 'ratings', 'schedule', 'names', 'badge', 'cards', 'engine', 'season'].forEach(n => { Mgr[n] = require(path.join(ROOT, 'manager', 'core', n + '.js')); });
globalThis.Mgr = Mgr;
const { value: V, ratings: R, schedule: SC, names: N, badge: B, cards: C, engine: E, season: SE } = Mgr;
E.use(Sim);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------------------------------------------------------------- a synthetic league ---
   ten clubs of eleven, each man a season line in season.js's shape, drawn from a seeded generator */
const rnd = SC.rng(42);
const nrm = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function line(id, pos, mpg, skill) {
  const gp = 28, min = mpg * gp, poss = min * 1.9;
  const usg = Math.max(8, 15 + 5 * skill + 3 * nrm() + (pos <= 2 ? 2 : 0));
  const plays = poss * usg / 100, tov = plays * (0.13 + 0.02 * nrm()) * (pos <= 2 ? 1.1 : 0.9);
  const fta = plays * (0.22 + 0.06 * nrm() + (pos >= 4 ? 0.06 : 0)), fga = Math.max(1, plays - tov - 0.44 * fta);
  const p3sh = Math.max(0.01, 0.45 - 0.09 * (pos - 1) + 0.05 * nrm()), p3a = fga * p3sh, two = fga - p3a;
  const rimsh = Math.min(0.9, 0.45 + 0.08 * (pos - 1) + 0.05 * nrm()), rimA = two * rimsh, midA = two - rimA;
  const p3 = 0.34 + 0.03 * skill + 0.02 * nrm(), rimp = 0.6 + 0.03 * skill + 0.02 * nrm(), midp = 0.4 + 0.02 * skill + 0.02 * nrm();
  const p3m = p3a * p3, rimM = rimA * rimp, midM = midA * midp, ftm = fta * (0.72 + 0.04 * nrm());
  const fgm = p3m + rimM + midM, pts = 2 * (rimM + midM) + 3 * p3m + ftm;
  const orb = Math.max(1, 3 + 2.4 * (pos - 1) + 1.5 * nrm()), drb = Math.max(5, 11 + 3.5 * (pos - 1) + 2 * nrm());
  const stl = Math.max(0.3, 1.8 - 0.15 * (pos - 1) + 0.4 * nrm()), blk = Math.max(0.1, 0.4 + 1.1 * (pos - 1) + 0.5 * nrm()), ast = Math.max(3, 26 - 5 * (pos - 1) + 5 * nrm() + 3 * skill);
  return { id, gp, min, pts, fga, fgm, p3a, p3m, fta, ftm, tov, rimA, rimM, midA, midM, pf: min * 0.085, fast: min * 0.06, ast: min * ast / 100 * 0.6, reb: min * (orb + drb) / 100 * 0.45,
    stl: min * 0.03, blk: min * 0.015 * pos,
    usg, ast_pct: ast, tov_pct: 100 * tov / plays, stl_pct: stl, blk_pct: blk, oreb_pct: orb, dreb_pct: drb, bpm_pos: pos, on_pace: 72 + 2 * nrm(), on_poss: poss,
    ppp: pts / plays, ts: 100 * pts / (2 * (fga + 0.44 * fta)), p3_pct: 100 * p3, p3_rate: 100 * p3sh, rim_pct: 100 * rimp, rim_rate: 100 * rimsh * (1 - p3sh), ftr: 100 * fta / fga, ft_pct: 72,
    vorp: skill, bpm: 2 * skill };
}
const teams = [], rows = [], teamOf = new Map();
for (let t = 0; t < 10; t++) {
  const id = 'T' + t, men = [], sk = 0.6 * nrm();
  [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 3].forEach((pos, i) => {
    const r = line(id + 'p' + i, pos, i < 5 ? 30 : i < 9 ? 14 : 6, sk + 0.5 * nrm());
    rows.push(r); men.push(r); teamOf.set(r.id, id);
  });
  teams.push({ id, men });
}

/* ---------------------------------------------------------------- positions --- */
/* THE POSITION THE SITE LISTS HIM AT (Louie, 2026-10-09: "some of the positions are off from what they're listed as on the
   main site"): a listing that names a position is his, whatever his season line suggests; a broad one is narrowed */
{
  ok('positions: a man listed PF is a PF, though his line plays like a wing', C.listedSlot('PF', C.listedShare({ bpm_pos: 3.0 }, 'PF')) === 3);
  ok('positions: ...and most of his minutes are at PF', (() => { const s = C.listedShare({ bpm_pos: 3.0 }, 'PF'); return s[3] > 0.5 && Math.abs(s.reduce((a, v) => a + v, 0) - 1) < 1e-9; })());
  ok('positions: a man listed C is a C', C.listedSlot('C', C.listedShare({ bpm_pos: 3.6 }, 'C')) === 4 && C.listedSlot('Center', null) === 4);
  ok('positions: a forward (F) is narrowed by his line: a big one is a PF, never a guard', C.listedSlot('F', C.listedShare({ bpm_pos: 4.6 }, 'F')) === 3 && C.listedSlot('F', C.listedShare({ bpm_pos: 1.2 }, 'F')) === 2);
  ok('positions: a guard (G) is a PG or an SG', [1, 1.8, 2.6, 4].every(b => C.listedSlot('G', C.listedShare({ bpm_pos: b }, 'G')) <= 1));
  ok('positions: no listing, his line decides; nothing at all, no share', C.listedSlot('', C.listedShare({ bpm_pos: 2.2 }, '')) === 1 && C.listedShare({}, '') === null);
  ok('positions: the position files (minutes at each position) narrow a broad listing too', C.listedSlot('G/F', [0.1, 0.2, 0.6, 0.1, 0]) === 2 && C.listedSlot('G/F', [0.5, 0.3, 0.2, 0, 0]) === 1);
  ok('positions: two listed together, either way round: F/G is an SG or an SF, C/F a PF or a C, PG/SG a guard',
    [1.2, 2.8, 4.5].every(b => [1, 2].includes(C.listedSlot('F/G', C.listedShare({ bpm_pos: b }, 'F/G'))))
    && [2.5, 3.8, 4.9].every(b => [3, 4].includes(C.listedSlot('C/F', C.listedShare({ bpm_pos: b }, 'C/F'))))
    && [1, 2.5, 4].every(b => [0, 1].includes(C.listedSlot('PG/SG', C.listedShare({ bpm_pos: b }, 'PG/SG')))));
  ok('positions: a listing it cannot read is no listing (his line decides)', C.listedSlot('Utility', [0, 0, 0, 1, 0]) === 3);
}

/* ---------------------------------------------------------------- values --- */
{
  const ctx = V.leagueContext(rows);
  const a = { gp: 20, min: 600, pts: 300, reb: 100, ast: 60, stl: 20, blk: 5, tov: 40, bpm_pos: 2 }, b = Object.assign({}, a, { pts: 200 });
  ok('values: more points, a higher index', V.indexOf(a, ctx) > V.indexOf(b, ctx));
  const big = Object.assign({}, a, { bpm_pos: 5, blk_pct: 6 }), wing = Object.assign({}, a, { bpm_pos: 3, blk_pct: 6 });
  ok('values: a big (and an athletic big) is worth more for the same line', V.indexOf(big, ctx) > V.indexOf(wing, ctx));
  ok('values: minutes are valued', V.indexOf(Object.assign({}, a, { min: 200 }), ctx) < V.indexOf(a, ctx));
  const priced = V.priceLeague(rows, { min: 20000, max: 400000 }, r => (teamOf.get(r.id) === 'T0' ? 0.25 : 0));
  const vals = rows.filter(r => r.min >= 40).map(r => priced.get(r.id).value);
  ok('values: everybody inside the range, give or take the outliers (12%) and the boost (25%)', vals.every(v => v >= 20000 * 0.88 * 0.99 && v <= 400000 * 1.12 * 1.25 * 1.01), [Math.min(...vals), Math.max(...vals)]);
  const t0 = rows.filter(r => teamOf.get(r.id) === 'T0'), x = t0[0];
  ok('values: a club in a continental competition carries its boost', priced.get(x.id).boost === 0.25);
  const bud = V.budgetOf(priced, rows);
  ok('values: the budget is twelve average wages', near(bud, 12 * vals.reduce((s, v) => s + v * V.WAGE_RATE, 0) / vals.length, bud * 0.1), bud);
  ok('values: money prints as a market does', V.money(1234567) === '€1.2M' && V.money(450000) === '€450K' && V.roundMoney(123456) === 120000);
}
/* ---------------------------------------------------------------- the 1-20 attributes --- */
{
  const rated = R.rateLeague(rows, { min: 20000, max: 400000 }, { min: 20000, max: 400000 });
  const all = [...rated.values()];
  ok('attributes: every one on 1-20 or null', all.every(a => Object.values(a).every(v => v == null || (v >= 1 && v <= 20 && Number.isInteger(v)))));
  const shooters = rows.slice().sort((a, b) => b.p3_pct * b.p3a - a.p3_pct * a.p3a);
  ok('attributes: the league\'s best shooter rates above its worst', rated.get(shooters[0].id).three > rated.get(shooters[shooters.length - 1].id).three);
  const strong = R.rateLeague(rows, { min: 200000, max: 4000000 }, { min: 20000, max: 400000 }), id = rows[0].id;
  ok('attributes: the same line in a stronger league reads higher (skills), usage unchanged', strong.get(id).three >= rated.get(id).three && strong.get(id).usg === rated.get(id).usg);
  ok('attributes: a colour band for each value', R.band(3) === 'a1' && R.band(18) === 'a4' && R.band(null) === '');
  /* EARLY IN A SEASON (Louie, 2026-10-09: "There are no attributes coming up"): three games in, nobody has 150 minutes, and
     the league is still rated - the bar and the shrinkage scale with what its regulars have played; a season under way is
     rated as before */
  const early = rows.map(r => Object.assign({}, r, { min: r.min * 3 / 28, gp: 3 }));
  const ratedEarly = R.rateLeague(early, { min: 20000, max: 400000 }, { min: 20000, max: 400000 });
  const filled = [...ratedEarly.values()].filter(a => a.three != null && a.usg != null).length;
  ok('attributes: three games into a season the league is rated all the same', filled >= early.length * 0.8, [filled, early.length]);
  ok('attributes: ...its best shooter still above its worst', ratedEarly.get(shooters[0].id).three > ratedEarly.get(shooters[shooters.length - 1].id).three);
  const popFull = R.population(rows);
  ok('attributes: a season under way keeps the 150-minute bar', popFull.bar === R.POP_MIN, popFull.bar);
}
/* ---------------------------------------------------------------- the schedule --- */
{
  const ids = ['a', 'b', 'c', 'd', 'e'], fx = SC.roundRobin(ids, 3, 7);
  const pairs = new Map();
  fx.forEach(f => { const k = [f.home, f.away].sort().join(); pairs.set(k, (pairs.get(k) || 0) + 1); });
  ok('schedule: every pair meets three times', pairs.size === 10 && [...pairs.values()].every(n => n === 3), [...pairs.values()]);
  const byRound = new Map();
  fx.forEach(f => { if (!byRound.has(f.round)) byRound.set(f.round, []); byRound.get(f.round).push(f); });
  ok('schedule: nobody plays twice in a round (an odd league: one bye a round)', [...byRound.values()].every(g => new Set(g.flatMap(f => [f.home, f.away])).size === 2 * g.length) && byRound.size === 15);
  const homes = ids.map(id => fx.filter(f => f.home === id).length);
  ok('schedule: the homes spread (each club 5-7 of its 12)', homes.every(h => h >= 5 && h <= 7), homes);
  ok('schedule: the same league, the same schedule', JSON.stringify(SC.roundRobin(ids, 3, 7)) === JSON.stringify(fx));
  const T = SC.table([{ round: 1, home: 'a', away: 'b', hs: 80, as: 70 }, { round: 2, home: 'b', away: 'a', hs: 90, as: 70 }, { round: 3, home: 'c', away: 'a', hs: 60, as: 61 }], ['a', 'b', 'c']);
  ok('table: wins first, then the head-to-head, then the difference', T.rows[0].id === 'a' && T.rows[0].w === 2 && T.rows[1].id === 'b', T.rows.map(r => r.id + r.w));
  ok('table: the last five and the streak', T.rows[0].last5.join('') === 'WLW' && T.rows[0].streak === 'W1');
}
/* ---------------------------------------------------------------- names and badges --- */
{
  ok('names: a fine name passes', N.check('Utopia City') === '' && N.check('Ψ Αθήνα') === '' && N.check("St. Mary's & Co") === '');
  ok('names: towns and words that only contain a bad string pass', ['Scunthorpe Kings', 'Essex Hawks', 'Arsenal Ballers', 'Dickinson State', 'Assist Masters', 'Classic Five'].every(n => N.check(n) === ''));
  ok('names: swearing through disguises is refused', ['Sh1t Kickers', 'F.U.C.K', 'f u c k ers', 'Pu7a Madre'].every(n => N.check(n) === 'not allowed'));
  ok('names: length and characters', N.check('A') === 'too short' && N.check('x'.repeat(29)) === 'too long' && /letters/.test(N.check('Club <b>')));
  const svg = B.svg({ shape: 'hex', pattern: 'hoops', c1: '#112233', text: 'utc' }, 48);
  ok('badge: drawn as SVG at its size, its letters upper case', /^<svg/.test(svg) && /width="48"/.test(svg) && />UTC</.test(svg));
  const bad = B.sanitise({ shape: 'evil', c1: 'red', text: '<script>', img: 'javascript:alert(1)' });
  ok('badge: anything unknown falls back, nothing unsafe kept', bad.shape === 'shield' && bad.c1 === '#1d4ed8' && bad.text === 'SCR' && !bad.img, bad);
  ok('badge: an image only as a small data URL', !B.sanitise({ img: 'data:image/png;base64,' + 'A'.repeat(B.IMG_MAX) }).img && !!B.sanitise({ img: 'data:image/png;base64,AAAA' }).img);
}
/* ---------------------------------------------------------------- cards --- */
const ref = C.refOf(rows);
{
  ok('cards: the league reference has its zones, its shot mix and five positions', ref.zones && near(ref.mix.rim + ref.mix.mid + ref.mix.three, 1, 1e-9) && ref.byPos.length === 5);
  const r = rows[0], c = C.cardOf(r, ref, {});
  ok('cards: a card carries its usage, mix, make deltas, rates and on/off', c && c.usg > 0 && c.mixRel && Number.isFinite(c.off.d3) && c.def.drb > 0 && c.onoff);
  const tiny = Object.assign({}, r, { min: 20, gp: 2, fga: 6, fgm: 6, p3a: 3, p3m: 3, rimA: 3, rimM: 3, midA: 0, midM: 0, pts: 15 });
  const ct = C.cardOf(tiny, ref, {});
  ok('cards: a handful of perfect shots is mostly the league\'s average (shrunk)', Math.abs(ct.off.d3) < 0.25 && Math.abs(ct.off.dRim) < 0.4, [ct.off.d3, ct.off.dRim]);
  const lo = C.cardOf(Object.assign({}, r, { on_poss: 50, diff_vs_oreb: -10 }), ref, {}), hi = C.cardOf(Object.assign({}, r, { on_poss: 3000, diff_vs_oreb: -10 }), ref, {});
  ok('cards: on/off counts lightly, more with more possessions', Math.abs(lo.onoff.vsOreb) < Math.abs(hi.onoff.vsOreb) && Math.abs(hi.onoff.vsOreb) <= 10 * C.ONOFF_MAX, [lo.onoff.vsOreb, hi.onoff.vsOreb]);
  const never = C.cardOf(Object.assign({}, r, { p3a: 0, p3m: 0 }), ref, {});
  ok('cards: a man who never shoots threes is not a league-average shooter', never.p3Rel < 0.9, never.p3Rel);
  const up = C.cardOf(r, ref, { shift: 0.5 }), dn = C.cardOf(r, ref, { shift: -0.5 });
  ok('cards: a stronger league\'s man is better in a weaker one, and the other way round', up.off.d3 > c.off.d3 && dn.off.d3 < c.off.d3 && up.usg > dn.usg);
  ok('cards: the shift from two value ranges', near(C.shiftOf({ min: 100000, max: 900000 }, { min: 10000, max: 90000 }), 1, 1e-9) && C.shiftOf(null, null) === 0);
  const f0 = C.formOf(r, []), fHot = C.formOf(r, [{ min: 30 * 60000, pts: 40, p2m: 12, p2a: 16, p3m: 4, p3a: 7, ftm: 4, fta: 4, or: 3, dr: 8, ast: 6, stl: 3, blk: 1, to: 1, pf: 1 }]);
  const fCold = C.formOf(r, [{ min: 30 * 60000, pts: 2, p2m: 1, p2a: 12, p3m: 0, p3a: 6, ftm: 0, fta: 2, or: 0, dr: 1, ast: 0, stl: 0, blk: 0, to: 6, pf: 5 }]);
  ok('form: no games is neutral; a big night is hot, a bad one cold, both capped', f0 === 0 && fHot > 0.5 && fCold < -0.5 && fHot <= 2 && fCold >= -2, [f0, fHot, fCold]);
}
/* ---------------------------------------------------------------- the engine --- */
const L = E.leagueOf(ref, null, 40, { teams: [], games: [] });
const cards = new Map(rows.map(r => [r.id, C.cardOf(r, ref, {})]));
{
  /* an average five: one league-average player at each position gives back the league's own rates */
  const avgCard = k => ({ id: 'a' + k, min: 1000, gp: 30, mpg: 30, pos: k + 1, share: [0, 0, 0, 0, 0].map((_, i) => (i === k ? 1 : 0)), shift: 0, zoned: true, rel: {},
    usg: 20, creator: 0.35, un: { rim: ref.un.rim, mid: ref.un.mid, three: ref.un.three }, mix: ref.mix, mixRel: { rim: 1, mid: 1, three: 1 }, p3Rel: 1, rimRel: 1,
    off: { dTov: 0, rFta: 1, dRim: 0, dMid: 0, d2: 0, d3: 0, dFt: 0, ast: ref.byPos[k].ast_pct, orb: ref.byPos[k].oreb_pct, pace: 1, tr: { ppp: ref.trPpp, hcPpp: ref.hcPpp, share: ref.trShare } },
    def: { drb: ref.byPos[k].dreb_pct, stl: ref.byPos[k].stl_pct, blk: ref.byPos[k].blk_pct, pf40: ref.byPos[k].pf40, rimSave: 0, rimDeter: 0 },
    onoff: { efg: 0, tov: 0, oreb: 0, vsEfg: 0, vsTov: 0, vsOreb: 0, vsFtr: 0 } });
  const five = [0, 1, 2, 3, 4].map(k => ({ card: avgCard(k), k }));
  const side = E.sideOf(five, { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr });
  const keys = ['tov', 'sfoul', 'bonus', 'pRim', 'pMid', 'p3', 'orb', 'd'];
  ok('engine: an average five plays the league\'s own rates at both ends',
    keys.every(k => near(side.off[k], L.rates[k], 0.002 + 0.01 * L.rates[k])) && near(side.off.mix3, L.rates.mix3 / (L.rates.mixRim + L.rates.mixMid + L.rates.mix3), 0.01)
      && ['tov', 'pRim', 'p3', 'orb'].every(k => near(side.def[k], L.rates[k], 0.002 + 0.01 * L.rates[k])),
    keys.map(k => [k, +side.off[k].toFixed(4), +L.rates[k].toFixed(4)]));
  ok('engine: the five\'s plays add up to 100', near(side.men.reduce((a, m) => a + m.u2, 0), 100, 1e-6));
  const real = teams[0].men.slice(0, 5).map((r, k) => ({ card: cards.get(r.id), k }));
  const base = E.sideOf(real, { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr }), deep = E.sideOf(real, { mu: L.rates, ref, tac: { deep: 1 }, G: 40, dTr: L.dTr });
  ok('engine: punish from deep takes more threes', deep.off.mix3 > base.off.mix3 + 0.05, [base.off.mix3, deep.off.mix3]);
  const g = E.sideOf(real, { mu: L.rates, ref, tac: { gamble: 1 }, G: 40, dTr: L.dTr });
  ok('engine: gambling forces more turnovers and gives up more makes', g.def.tov > base.def.tov && g.def.p3 > base.def.p3);
  const lk = E.sideOf(real, { mu: L.rates, ref, tac: { leak: 1 }, G: 40, dTr: L.dTr });
  ok('engine: leaking out runs more and gives up the glass', lk.off.tr > base.off.tr && lk.def.orb > base.def.orb);
  const usg = E.sideOf(real, { mu: L.rates, ref, tac: { usage: { [real[0].card.id]: 1 } }, G: 40, dTr: L.dTr });
  ok('engine: the usage dial gives a man more of the plays', usg.men[0].u2 > base.men[0].u2 + 2, [base.men[0].u2, usg.men[0].u2]);
  const tired = E.sideOf(real, { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr, mins: new Map(real.map(x => [x.card.id, 39.5])) });
  ok('engine: a five run into the ground is a five on tired legs', tired.off.pRim < base.off.pRim && tired.men[0].dLoad > 0);
  const oop = E.sideOf([real[4], real[3], real[2], real[1], real[0]].map((x, k) => ({ card: x.card, k })), { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr });
  ok('engine: a centre at the point and a point at centre cost both ends', oop.off.tov > base.off.tov && oop.def.pRim > base.def.pRim);
}
{
  const lu = [{ ids: ['a1', 'a2', 'a3', 'a4', 'a5'], min: 24 }, { ids: ['b1', 'b2', 'b3', 'b4', 'b5'], min: 16 }];
  const segs = E.rotation(lu, 40), mins = E.minutesOf(segs);
  ok('rotation: the lineups get their minutes, lineup 1 opens and closes every quarter', near(mins.get('a1'), 24, 1e-9) && near(mins.get('b1'), 16, 1e-9)
    && [0, 10, 20, 30].every(t => segs.find(s => s.t0 <= t + 0.01 && s.t1 > t + 0.01).ids[0] === 'a1') && segs[segs.length - 1].ids[0] === 'a1'
    && [5, 15, 25, 35].every(t => segs.find(s => s.t0 <= t && s.t1 > t).ids[0] === 'b1'));
  const T = teams[0], players = T.men.map(r => ({ id: r.id, mpg: r.min / r.gp, share: C.shareOf(r) }));
  const auto = E.autoRotation(players, 40), am = E.minutesOf(auto);
  ok('autoRotation: five different men on the floor all game, 200 minutes in all, nobody past 36', auto.every(s => new Set(s.ids).size === 5)
    && near([...am.values()].reduce((a, v) => a + v, 0), 200, 1e-6) && [...am.values()].every(v => v <= 36 + 1e-9), [...am.values()].map(v => +v.toFixed(1)));
  ok('autoRotation: the starters play the most', am.get(T.men[0].id) > am.get(T.men[5].id));
}
const teamObj = (T, extra) => Object.assign({ id: T.id, segs: E.autoRotation(T.men.map(r => ({ id: r.id, mpg: r.min / r.gp, share: C.shareOf(r) })), 40), cards }, extra || {});
{
  const H = teamObj(teams[0]), A = teamObj(teams[1]), X = { L, ref, G: 40, seed: 99, home: 1 };
  const g1 = E.play(H, A, X), g2 = E.play(H, A, X);
  ok('play: the same seed, the same game', JSON.stringify(g1.pts) === JSON.stringify(g2.pts) && JSON.stringify(g1.box) === JSON.stringify(g2.box));
  const sum = (b, k) => b.reduce((a, x) => a + x[k], 0);
  ok('play: the box scores add up to the game (points, shots, threes, free throws, turnovers, boards)', [0, 1].every(s => sum(g1.box[s], 'pts') === g1.pts[s]
    && sum(g1.box[s], 'fga') === g1.tally[s].fga && sum(g1.box[s], 'p3m') === g1.tally[s].fg3m && sum(g1.box[s], 'fta') === g1.tally[s].fta
    && sum(g1.box[s], 'ftm') === g1.tally[s].ftm && sum(g1.box[s], 'tov') === g1.tally[s].tov && sum(g1.box[s], 'oreb') === g1.tally[s].oreb),
    [0, 1].map(s => [sum(g1.box[s], 'pts'), g1.pts[s], sum(g1.box[s], 'fta'), g1.tally[s].fta]));
  ok('play: 200 minutes a side', [0, 1].every(s => near(sum(g1.box[s], 'min'), 200, 0.6)));
  ok('play: makes never exceed attempts, nobody fouls out past the limit', g1.box.flat().every(b => b.fgm <= b.fga && b.p3m <= b.p3a && b.ftm <= b.fta && b.pf <= 5));
  const pv = E.preview(H, A, X, 200);
  ok('preview: a chance and an expected margin', pv.pWin >= 0 && pv.pWin <= 1 && Number.isFinite(pv.margin) && pv.n === 200);
  /* identity: a club whose real four factors are far from its build plays toward them */
  const row = { gp: 30, ff_efg: 60, ff_tov: 10, ff_oreb: 35, ff_ftr: 40, dff_efg: 45, dff_tov: 20, dff_oreb: 25, dff_ftr: 25 };
  const id = E.identityOf(H, row, { L, ref, G: 40 });
  ok('identity: edits toward the club\'s real four factors', Array.isArray(id) && id.some(e => e.end === 'off' && e.key === 'efg' && e.delta > 0) && id.some(e => e.end === 'def' && e.key === 'efg' && e.delta < 0), id);
  const Hid = teamObj(teams[0], { identity: id });
  const strong = E.preview(Hid, A, X, 300).margin, plain = E.preview(H, A, X, 300).margin;
  ok('identity: and plays better for it', strong > plain + 3, [plain, strong]);
}
/* ---------------------------------------------------------------- the season --- */
{
  const clubs = ['me'].concat(teams.slice(0, 5).map(t => t.id));
  const S = SE.create({ clubs, start: '2026-10-07', perWeek: 2, meetings: 3, seed: 5 });
  ok('season: every club plays every other three times', S.fixtures.length === 3 * 15 && S.fixtures.reduce((a, f) => Math.max(a, f.r), 0) === 15);
  ok('season: match days are Wednesdays and Saturdays, from the day after the start', S.fixtures.every(f => [3, 6].includes(new Date(f.d + 'T00:00:00Z').getUTCDay())) && S.fixtures[0].d > '2026-10-07');
  const S1 = SE.create({ clubs, start: '2026-10-07', perWeek: 1, meetings: 3, seed: 5 });
  ok('season: one a week is Saturdays', S1.fixtures.every(f => new Date(f.d + 'T00:00:00Z').getUTCDay() === 6));
  const first = S.fixtures[0].d;
  ok('season: nothing is due before the first tip-off, the first round after it', SE.due(S, first + 'T18:59:00Z').length === 0 && SE.due(S, first + 'T19:00:00Z')[0] === 1);
  const mine = { id: 'me', segs: E.rotation([{ ids: teams[9].men.slice(0, 5).map(r => r.id), min: 28 }, { ids: teams[9].men.slice(5, 10).map(r => r.id), min: 12 }], 40), cards };
  const objs = clubs.map((c, i) => (i === 0 ? mine : teamObj(teams[i - 1])));
  const ctx = { X: { L, ref, G: 40 }, team: i => objs[i], me: 0 };
  const now = new Date(dayAfter(S.fixtures[S.fixtures.length - 1].d, 3) + 'T00:00:00Z');
  SE.due(S, now).forEach(r => SE.play(S, r, ctx));
  ok('season: the whole season played, every game a result', S.fixtures.every(f => Array.isArray(f.res) && f.res[0] !== f.res[1]) && S.played === 15);
  const T = SE.table(S), sum = SE.summary(S, 0);
  ok('season: the table has every club, wins and losses add up', T.rows.length === 6 && T.rows.reduce((a, r) => a + r.w, 0) === 45 && T.rows.reduce((a, r) => a + r.l, 0) === 45);
  ok('season: the summary the boards read', sum.w + sum.l === 15 && sum.of === 6 && sum.pos >= 1 && sum.pos <= 6 && sum.rounds === 15, sum);
  ok('season: the user\'s games kept whole, everybody\'s totals', Object.keys(S.box).length === 15 && S.people.length > 30 && SE.leaders(S, 'pts', 5).length === 5);
  const again = SE.create({ clubs, start: '2026-10-07', perWeek: 2, meetings: 3, seed: 5 });
  SE.due(again, now).forEach(r => SE.play(again, r, ctx));
  ok('season: the same league played again gives the same results', JSON.stringify(again.fixtures) === JSON.stringify(S.fixtures));
  ok('season: a state small enough to keep', JSON.stringify(S).length < 300000, JSON.stringify(S).length);
  /* the play-by-play kept for the user's games: decoded, it replays to the score and to every man's points */
  const r1 = Object.keys(S.pbp)[0], ev = SE.decodeEvents(S, S.pbp[r1].e), f1 = S.fixtures.find(f => f.r === +r1 && (f.h === 0 || f.a === 0));
  const sc = [0, 0], pts = new Map();
  ev.forEach(e => {
    const v = e.k === 'S' && e.m ? (e.z === 2 ? 3 : 2) : e.k === 'F' ? e.m : e.k === 'X' ? 1 : 0;
    if (!v) return;
    sc[e.s] += v;
    if (e.p) pts.set(e.p, (pts.get(e.p) || 0) + v);
  });
  ok('play-by-play: every user game has one, and it replays to the final score', Object.keys(S.pbp).length === 15 && sc[0] === f1.res[0] && sc[1] === f1.res[1], [sc, f1.res]);
  const LN = SE.LINE, iP = LN.indexOf('pts');
  ok('play-by-play: and to every man\'s points in the box score', S.box[r1].every((side, s) => side.every(l => (pts.get(S.people[l[0]]) || 0) === l[iP])));
  ok('play-by-play: plus-minus sums to five times the margin', S.box[r1].every((side, s) => side.reduce((a, l) => a + l[LN.length], 0) === 5 * (s ? f1.res[1] - f1.res[0] : f1.res[0] - f1.res[1])));
  ok('play-by-play: a game is a few kilobytes', S.pbp[r1].e.length < 8000, S.pbp[r1].e.length);
  /* THE SCORER'S SHAPE: the game converted (core/scorer.js) and replayed by EPINOIA's own engine (epinoia/engine.js, what
     the game page draws with) gives back the Manager's own box score, man by man, and the final score */
  const Eng = require(path.join(ROOT, 'engine.js')), SC2 = require(path.join(ROOT, 'manager', 'core', 'scorer.js'));
  const st = SC2.toScorer(S, +r1, { clubs: [{ name: 'Home', colour: '#123456' }, { name: 'Away', colour: '#654321' }] });
  const d = Eng.deriveGame(st);
  ok('scorer: the engine replays it to the final score', d.score[0] === f1.res[0] && d.score[1] === f1.res[1], [d.score, f1.res]);
  const idx = k => LN.indexOf(k);
  const same = S.box[r1].every(side => side.every(l => {
    const id = S.people[l[0]], x = d.stats[/^fill:/.test(id) ? null : id];
    if (/^fill:/.test(id)) return true;
    return x && x.pts === l[idx('pts')] && x.or + x.dr === l[idx('oreb')] + l[idx('dreb')] && x.ast === l[idx('ast')] && x.stl === l[idx('stl')] && x.blk === l[idx('blk')]
      && x.to === l[idx('tov')] && x.p3a === l[idx('p3a')] && x.fta === l[idx('fta')] && x.pm === l[LN.length];
  }));
  ok('scorer: and every man\'s points, boards, assists, steals, blocks, turnovers, threes, free throws and plus-minus', same,
    S.box[r1][0].slice(0, 3).map(l => { const x = d.stats[S.people[l[0]]] || {}; return [l[idx('pts')], x.pts, l[LN.length], x.pm]; }));
  const mins = S.box[r1].every(side => side.every(l => { const x = d.stats[S.people[l[0]]]; return /^fill:/.test(S.people[l[0]]) || (x && Math.abs(x.min / 60000 - l[idx('min')]) < 0.6); }));
  ok('scorer: and his minutes, from the substitutions', mins);
  const locs = st.events.filter(e => e.t === 'loc');
  ok('scorer: every shot placed on the half court, the rim\'s inside the restricted area', locs.length === st.events.filter(e => /^p[23]_(made|miss)$/.test(e.t)).length
    && locs.every(l => l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1) && Object.keys(d.locs || {}).length === locs.length);
  /* THE CLOCK (core/engine.js clockOf): the play-by-play runs forward and every quarter keeps its own plays; the breaks
     EPINOIA's engine finds from the clock (a score within 8 s of a defensive board or a steal) are the game's own
     transition chances, and a set play takes its time - over every one of the user's games */
  let forward = true, inQ = true, trPts = 0, fast = 0, sets = 0, late = 0, minsOk = true;
  Object.keys(S.pbp).forEach(r => {
    const e2 = SE.decodeEvents(S, S.pbp[r].e), st2 = SC2.toScorer(S, +r, {}), d2 = Eng.deriveGame(st2);
    e2.forEach((e, i) => { if (i && e.t < e2[i - 1].t) forward = false; });
    const QL = 600, starts = e2.filter(e => e.k === 'P');
    starts.forEach(p => { const i = e2.indexOf(p); for (let j = i + 1; j < e2.length && e2[j].k !== 'P' && e2[j].k !== 'Q'; j++) if (e2[j].t < 2400 && Math.floor(e2[j].t / QL) !== Math.floor(p.t / QL)) inQ = false; });
    trPts += e2.reduce((a, e) => a + (e.k === 'S' && e.m && e.tr ? (e.z === 2 ? 3 : 2) : 0), 0);
    fast += d2.team[0].fast + d2.team[1].fast;
    starts.forEach(p => {
      const i = e2.indexOf(p), first = e2.slice(i + 1).find(e => e.k === 'S' || e.k === 'T' || e.k === 'F' || e.k === 'P');
      if (first && first.k === 'S' && !first.tr && !p.f) { sets++; if (first.t - p.t >= 8) late++; }
    });
    S.box[r].forEach(side => side.forEach(l => { const x = d2.stats[S.people[l[0]]]; if (!/^fill:/.test(S.people[l[0]]) && (!x || Math.abs(x.min / 60000 - l[idx('min')]) > 0.1)) minsOk = false; }));
  });
  ok('clock: the play-by-play runs forward', forward);
  ok('clock: a possession\'s plays stay in its quarter', inQ);
  ok('clock: the box score\'s transition points are the game\'s breaks', trPts > 0 && fast >= 0.85 * trPts && fast <= 1.6 * trPts, [fast, trPts]);
  ok('clock: a set play\'s first shot comes 8 s or more after the ball changed hands, nine times in ten', sets > 100 && late / sets >= 0.9, [late, sets]);
  ok('clock: both boxes\' minutes agree, to the tenth', minsOk);
  console.log('      (transition points: box ' + fast + ', breaks ' + trPts + '; set plays late ' + late + '/' + sets + ')');
}
function dayAfter(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
