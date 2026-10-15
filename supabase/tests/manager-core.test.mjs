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
['value', 'ratings', 'schedule', 'names', 'badge', 'cards', 'roles', 'engine', 'season', 'instruct', 'match', 'plays'].forEach(n => { Mgr[n] = require(path.join(ROOT, 'manager', 'core', n + '.js')); });
globalThis.Mgr = Mgr;
const { value: V, ratings: R, schedule: SC, names: N, badge: B, cards: C, engine: E, season: SE, instruct: IN, match: MT, roles: RO } = Mgr;
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
  const vals = rows.filter(r => r.min >= 40).map(r => priced.get(r.id).wage);   // the range is the wages (2026-10-09)
  ok('values: every wage inside the range, give or take the outliers (12%) and the boost (25%)', vals.every(v => v >= 20000 * 0.88 * 0.99 && v <= 400000 * 1.12 * 1.25 * 1.01), [Math.min(...vals), Math.max(...vals)]);
  const t0 = rows.filter(r => teamOf.get(r.id) === 'T0'), x = t0[0];
  ok('values: a club in a continental competition carries its boost', priced.get(x.id).boost === 0.25);
  const bud = V.budgetOf(priced, rows);
  ok('values: the budget is twelve average wages', near(bud, 12 * vals.reduce((s, v) => s + v, 0) / vals.length, bud * 0.1), bud);
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
  /* and no long runs at home or away (by round + place a club kept one end all along its side of the circle: sixteen away
     games in a row in a 17-club league, 2026-10-14) */
  const runOf = (fx, ids) => Math.max(...ids.map(t => { let run = 0, last = null, best = 0; fx.filter(f => f.home === t || f.away === t).sort((a, b) => a.round - b.round).forEach(f => { const hm = f.home === t; run = hm === last ? run + 1 : 1; last = hm; best = Math.max(best, run); }); return best; }));
  const runs = [6, 9, 10, 13, 16, 17].map(n => { const ids = Array.from({ length: n }, (_, i) => i); return runOf(SC.roundRobin(ids, 3, 7), ids); });
  ok('schedule: never more than four in a row at home or away', runs.every(x => x <= 4), runs);
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
  /* ...nor a man who takes his position's share of them (Louie, 2026-10-16: a non-shooting rim-rolling centre "just scored on
     a step back 3"): a season with none keeps him well under 2% of his shots there, and any he takes are off a pass */
  const big = rows.filter(x => x.fga >= 60).map(x => Object.assign({}, x, { pos: 5, bpm_pos: 5, p3a: 0, p3m: 0 }))[0];
  const nb = C.cardOf(big, ref, {});
  ok('cards: a big with no threes in his season keeps them under 2% of his shots, and creates almost none himself', nb.mix.three < 0.02 && nb.un.three < 0.05, [nb.mix.three, nb.un.three]);
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

  /* ---- THE BALL HANDLERS' SLIDER (Louie, 2026-10-14: "obvious that get downhill/punish from deep are for the ball handlers
     (and increase the 3PT volume for the ball handlers not elsewhere) ... a single sliding scale") ---- */
  const sideWith = (tac, ins, five) => E.sideOf(five || real, { mu: L.rates, ref, tac, G: 40, dTr: L.dTr, ins });
  const hd = sideWith({ handlers: 1 }), hdn = sideWith({ handlers: -1 });
  const hIdx = base.men.map((m, i) => [m.hw, i]).sort((a, b) => b[0] - a[0])[0][1];
  const others = base.men.map((_, i) => i).filter(i => base.men[i].hw === 0);
  ok('handlers: one slider, from downhill to deep; old saved tactics read onto it', E.TACTICS.some(t => t.k === 'handlers' && t.lo === -1 && t.hi === 1)
    && !E.TACTICS.some(t => t.k === 'deep' || t.k === 'downhill') && E.normTac({ deep: 0.7 }).handlers === 0.7 && E.normTac({ downhill: 0.9 }).handlers === -0.9);
  ok('handlers: deep gives the ball handler more threes, and nobody else', hd.men[hIdx].m.three > base.men[hIdx].m.three + 0.08
    && others.every(i => Math.abs(hd.men[i].m.three - base.men[i].m.three) < 1e-9), [base.men[hIdx].m.three, hd.men[hIdx].m.three]);
  ok('handlers: downhill gives the ball handler the rim and its fouls', hdn.men[hIdx].m.rim > base.men[hIdx].m.rim + 0.06 && hdn.men[hIdx].trip > base.men[hIdx].trip);

  /* ---- PLAYER INSTRUCTIONS: what he tries moves; his own numbers decide (Louie: "can't just give a low transition player
     the transition based instructions and it work optimally, or ask a poor shooter to shoot more") ---- */
  const ins1 = (id, keys, u) => new Map([[String(id), { u: u || 0, k: new Set(keys) }]]);
  const pps = s => s.off.mixRim * s.off.pRim * 2 + s.off.mixMid * s.off.pMid * 2 + s.off.mix3 * s.off.p3 * 3;
  const withCard = (k, patch) => real.map((x, j) => (j === k ? { card: Object.assign({}, x.card, patch(x.card)), k: j } : x));
  const good = withCard(2, c => ({ p3Rel: 1.18, mixRel: Object.assign({}, c.mixRel, { three: 1.2 }), off: Object.assign({}, c.off, { d3: 0.35 }) }));
  const poor = withCard(2, c => ({ p3Rel: 0.78, mixRel: Object.assign({}, c.mixRel, { three: 0.5 }), off: Object.assign({}, c.off, { d3: -0.45 }), un: Object.assign({}, c.un, { three: 0.02 }) }));
  const wing = real[2].card.id;
  const gG = pps(sideWith(null, ins1(wing, ['green']), good)) - pps(sideWith(null, null, good)), gP = pps(sideWith(null, ins1(wing, ['green']), poor)) - pps(sideWith(null, null, poor));
  ok('instructions: a green light pays for a shooter and costs for a poor shooter', gG > gP && gP < 0, [gG, gP]);
  /* HIS TENDENCIES BEND THE ROLE (Louie, 2026-10-16: "get a low volume 3pt shooter playing in a shooting role and he'll be
     more tentative and looking to slash more often than another player playing in that role"): a slasher by his own game
     put in a shooting role takes its extra threes only as far as his comfort out there goes, the rest of his shots stay
     drives; a shooter put in the same role from a slashing game takes more of them */
  {
    const RLm = Mgr.roles, rimmy = c => ({ p3Rel: 0.8, mixRel: Object.assign({}, c.mixRel, { three: 0.3, rim: 1.7, mid: 0.9 }) });
    const slasher = withCard(2, rimmy), card = slasher[2].card, nat = RLm.bestFor(2, card, ref);
    const asRole = (five, key) => five.map((x, j) => Object.assign({}, x, { role: j === 2 ? key : null }));
    const m0 = sideWith(null, null, asRole(slasher, nat.key)).men[2].m, mR = sideWith(null, null, asRole(slasher, 'sf-moveshoot')).men[2].m;
    const T = RLm.profile(RLm.BY.get('sf-moveshoot')).mix, N = RLm.profile(nat).mix, asked = RLm.BY.get('sf-moveshoot').rho * (T.three - N.three);
    ok('roles: a slasher in a shooting role is tentative - he takes only part of the threes it asks (his comfort), and keeps driving',
      nat.key !== 'sf-moveshoot' && asked > 0 && (mR.three - m0.three) > 0 && (mR.three - m0.three) < 0.65 * asked && mR.rim > 0.6 * m0.rim,
      { nat: nat.key, asked: +asked.toFixed(3), got: +(mR.three - m0.three).toFixed(3), rim: [+m0.rim.toFixed(3), +mR.rim.toFixed(3)] });
  }
  const run = withCard(0, c => ({ off: Object.assign({}, c.off, { tr: { ppp: ref.trPpp + 0.25, hcPpp: ref.hcPpp, share: ref.trShare * 1.8, ev: true } }) }));
  const walk = withCard(0, c => ({ off: Object.assign({}, c.off, { tr: { ppp: ref.trPpp - 0.15, hcPpp: ref.hcPpp, share: ref.trShare * 0.25, ev: true } }) }));
  const pg = real[0].card.id, pr = sideWith(null, ins1(pg, ['push']), run), pw = sideWith(null, ins1(pg, ['push']), walk);
  const r0 = sideWith(null, null, run), w0 = sideWith(null, null, walk);
  ok('instructions: pushing in transition runs more for anybody, and pays only for a runner', pr.off.tr > r0.off.tr && pw.off.tr > w0.off.tr
    && pr.men[0].p.rim > r0.men[0].p.rim && pw.men[0].p.rim < w0.men[0].p.rim && pw.men[0].tov > w0.men[0].tov, [pr.men[0].p.rim - r0.men[0].p.rim, pw.men[0].p.rim - w0.men[0].p.rim]);
  const quick = withCard(0, c => ({ def: Object.assign({}, c.def, { stl: c.def.stl * 2.2 }) })), slow = withCard(0, c => ({ def: Object.assign({}, c.def, { stl: c.def.stl * 0.4 }) }));
  const gq = sideWith(null, ins1(pg, ['gam']), quick), gs = sideWith(null, ins1(pg, ['gam']), slow), q0 = sideWith(null, null, quick), s0 = sideWith(null, null, slow);
  ok('instructions: gambling turns quick hands into steals, and slow hands into open shots', (gq.def.tov - q0.def.tov) > 2 * (gs.def.tov - s0.def.tov) && (gs.def.p3 - s0.def.p3) > (gq.def.p3 - q0.def.p3),
    [gq.def.tov - q0.def.tov, gs.def.tov - s0.def.tov]);
  const c5 = real[4].card.id;
  const mobile = withCard(4, c => ({ def: Object.assign({}, c.def, { stl: c.def.stl * 2 }) })), statue = withCard(4, c => ({ def: Object.assign({}, c.def, { stl: c.def.stl * 0.35 }) }));
  const hm = sideWith(null, ins1(c5, ['hedge']), mobile), hs = sideWith(null, ins1(c5, ['hedge']), statue), m0 = sideWith(null, null, mobile), st0 = sideWith(null, null, statue);
  ok('instructions: a hedging big forces turnovers with the feet for it, and leaks without them', (hm.def.tov - m0.def.tov) > (hs.def.tov - st0.def.tov) && (hs.def.pRim - st0.def.pRim) > (hm.def.pRim - m0.def.pRim));
  const prot = withCard(4, c => ({ def: Object.assign({}, c.def, { blk: c.def.blk * 2.2, rimSave: 3 }) })), soft = withCard(4, c => ({ def: Object.assign({}, c.def, { blk: c.def.blk * 0.3, rimSave: -1 }) }));
  const dp = sideWith(null, ins1(c5, ['drop']), prot), ds = sideWith(null, ins1(c5, ['drop']), soft), p0 = sideWith(null, null, prot), so0 = sideWith(null, null, soft);
  ok('instructions: dropping gives up the mid-range, and protects the rim only with a rim protector', dp.def.mixMid > p0.def.mixMid && (dp.def.pRim - p0.def.pRim) < (ds.def.pRim - so0.def.pRim));
  const up2 = sideWith(null, ins1(pg, [], 2)), dn2 = sideWith(null, ins1(pg, [], -2));
  ok('instructions: his touches, two steps either way', up2.men[0].u2 > base.men[0].u2 + 3 && dn2.men[0].u2 < base.men[0].u2 - 3, [dn2.men[0].u2, base.men[0].u2, up2.men[0].u2]);
  const fin = sideWith(null, ins1(c5, ['fin', 'roll', 'dive']));
  ok('instructions: a finisher only takes fewer of the plays, and his shots come off passes', fin.men[4].u2 < base.men[4].u2 - 2 && fin.men[4].un.rim < base.men[4].un.rim);
  /* the instructions' own rules */
  ok('instructions: one of each choice (the later wins); what needs another goes without it', JSON.stringify(IN.norm({ ins: ['pas', 'agg'] }, 'g').keys) === '["agg"]'
    && JSON.stringify(IN.norm({ ins: ['short'] }, 'b').keys) === '[]' && IN.toggle({ ins: [] }, 'b', 'short', true).keys.includes('roll')
    && !IN.toggle({ ins: ['roll', 'short'] }, 'b', 'roll', false).keys.includes('short') && IN.norm({ ins: ['pas'], u: 7 }, 'g').u === 2);
  ok('instructions: a guard, a wing and a big each have their own', IN.list('g').some(d => d.k === 'pas') && !IN.list('g').some(d => d.k === 'roll')
    && IN.list('b').some(d => d.k === 'drop') && IN.list('w').some(d => d.k === 'rip') && IN.roleOf({ pos: 1.2 }) === 'g' && IN.roleOf(null, 4) === 'b');
  /* A BIG'S COVERAGE GOES WITH HIM (his ball-screen coverage is about the man he guards): kept at a place whose role is a
     wing's (a 3&D four) - the panel allows it beyond the role (also: COVER) - and followed there by the engine */
  ok('instructions: a big keeps his coverage at a wing\'s place (allowed beyond the role); a wing\'s own list has none',
    JSON.stringify(IN.norm({ ins: ['space', 'drop'] }, 'w', IN.COVER).keys) === '["space","drop"]' && JSON.stringify(IN.norm({ ins: ['space', 'drop'] }, 'w').keys) === '["space"]'
    && IN.list('w', IN.COVER).some(d => d.k === 'hedge') && !IN.list('w').some(d => d.k === 'hedge') && IN.toggle({ ins: ['drop'] }, 'w', 'hedge', true, IN.COVER).keys.join() === 'hedge'
    && JSON.stringify(IN.COVER) === '["hedge","cont","drop"]');
  {
    const f4 = real[3].card.id, as3d = real.map((x, j) => Object.assign({}, x, { role: j === 3 ? 'pf-3d' : null }));
    const RLm = Mgr.roles;
    const dr = sideWith(null, ins1(f4, ['drop']), as3d), hg = sideWith(null, ins1(f4, ['hedge']), as3d), nn = sideWith(null, null, as3d);
    ok('instructions: a big told to drop drops at the four in a wing\'s role (3&D PF) - and its effects come with it',
      RLm.family('pf-3d') === 'w' && dr.men[3].cov === 'drop' && hg.men[3].cov === 'hedge' && nn.men[3].cov === 'cont' && dr.def.mixMid > nn.def.mixMid,
      [dr.men[3].cov, hg.men[3].cov, nn.men[3].cov]);
  }
  const shooters = rows.filter(r => r.min > 300).map(r => cards.get(r.id)).filter(Boolean).sort((a, b) => b.p3Rel - a.p3Rel);
  ok('instructions: how well he suits it is his own line (the best shooter suits a green light better than the worst)',
    IN.fit('green', shooters[0], ref).s > IN.fit('green', shooters[shooters.length - 1], ref).s && !!IN.fit('green', shooters[0], ref).word);
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
/* ---------------------------------------------------------------- the roles --- */
/* core/roles.js and engine.js (Louie, 2026-10-14): a role at every position, played against each man's own numbers and
   against the four beside him - one ball, the pressure that opens the threes, the screens, the screener hit as his role
   plays it - its instructions kept to what it allows, a club left at the defaults playing its own men's games */
{
  const per = [0, 1, 2, 3, 4].map(k => RO.forSlot(k).length);
  ok('roles: every position has its roles (13 with the combos at the point, 12, 11, 14, 10), each diet a whole, each shot mix a whole', JSON.stringify(per) === '[13,12,11,14,10]'
    && RO.ROLES.every(r => near(Object.values(r.diet).reduce((a, v) => a + v, 0), 1, 1e-9) && near((p => p.mix.rim + p.mix.mid + p.mix.three)(RO.profile(r)), 1, 1e-6) && 'gwb'.includes(r.family)), per);
  ok('roles: each in one of its position\'s categories, every label ending in its position', RO.ROLES.every(r => RO.CATS[r.slot].includes(r.cat) && r.label.endsWith(' ' + RO.SLOTS[r.slot]))
    && RO.forSlot(0).filter(r => r.cat === 'Combo').length === 6 && RO.forSlot(1).filter(r => r.cat === 'Combo').length === 6);
  ok('roles: the five\'s roles make its alignment - a post four beside a rim roller 3-out 2-in, two popping bigs 5-out',
    RO.layout(['pg-slashpass', 'sg-moveshoot', 'sf-3d', 'pf-dualpost', 'c-roller']).label === '3-out 2-in' && RO.layout(['pg-euro', 'sg-3d', 'sf-3d', 'pf-dualspot', 'c-spot']).label === '5-out'
    && RO.layout(['pg-mixed', 'sg-combomixed', 'sf-3d', 'pf-3d', 'c-roller']).label === '4-out 1-in' && new Set(RO.layout(['pg-mixed', 'sg-comboiso', 'sf-iso', 'pf-iso', 'c-post']).spots).size === 5);
  ok('roles: one position from his own costs nothing (a shooting guard at small forward), two or more cost (at power forward, more at centre)',
    RO.posGap(2.2, 2) === 0 && RO.posGap(2, 2) === 0 && RO.posGap(2, 3) > 0.9 && RO.posGap(2, 4) > RO.posGap(2, 3), [RO.posGap(2, 2), RO.posGap(2, 3), RO.posGap(2, 4)]);
  const T0 = teams[0], cardAt = k => cards.get(T0.men[k].id);
  ok('roles: the defaults - the general role at the guards, the best fit at the forwards and the centre, never another position\'s',
    RO.resolve(null, 0, cardAt(0), ref).key === 'pg-mixed' && RO.resolve(null, 1, cardAt(1), ref).key === 'sg-combomixed' && RO.resolve(null, 4, cardAt(4), ref).key === RO.bestFor(4, cardAt(4), ref).key
    && RO.resolve('c-roller', 0, cardAt(0), ref).key === 'pg-mixed');
  const pps = s => s.off.mixRim * s.off.pRim * 2 + s.off.mixMid * s.off.pMid * 2 + s.off.mix3 * s.off.p3 * 3;
  const ppc = s => { const o = s.off, sh = 1 - o.sfoul - o.bonus; return (1 - o.tov) * (sh * pps(s) + (o.sfoul + o.bonus) * 2 * o.ft); };
  const fiveOf = (T, roles) => T.men.slice(0, 5).map((r, k) => ({ card: cards.get(r.id), k, role: roles ? roles[k] : undefined }));
  const X0 = { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr }, NONE = [null, null, null, null, null];
  const diffs = teams.map(T => ppc(E.sideOf(fiveOf(T, NONE), X0)) / ppc(E.sideOf(fiveOf(T), X0)) - 1), md = diffs.reduce((a, v) => a + v, 0) / diffs.length;
  ok('roles: left at the defaults, a club plays its own men\'s games (on average nothing; a five that fits badly a little less)', Math.abs(md) < 0.015 && diffs.every(d => Math.abs(d) < 0.05), diffs.map(d => +d.toFixed(4)));
  const sD = E.sideOf(fiveOf(T0, NONE), X0);
  const nat = [null, null, RO.bestFor(2, cardAt(2), ref).key, RO.bestFor(3, cardAt(3), ref).key, RO.bestFor(4, cardAt(4), ref).key];
  ok('roles: choosing a man the role his own game is closest to is his own game', near(ppc(E.sideOf(fiveOf(T0, nat), X0)), ppc(sD), 1e-9));
  /* ONE BALL */
  const over = E.sideOf(fiveOf(T0, ['pg-slashpass', 'sg-comboiso', 'sf-iso', 'pf-iso', 'c-post']), X0);
  ok('one ball: too many ball handlers - each gets less of it than his role asks, the plays come late, and the five says so',
    over.five.ball > E.ROLEK.ballMax && over.men.filter(m => m.lost > 0.005).length >= 4 && over.five.notes.some(n => n.key === 'ball') && ppc(over) < ppc(sD), [over.five.ball, ppc(over), ppc(sD)]);
  const none = E.sideOf(fiveOf(T0, ['pg-passspace', 'sg-3d', 'sf-3d', 'pf-3d', 'c-roller']), X0);
  ok('one ball: nobody to run it - the man who creates most has to, and the five says so', none.five.deficit > 0 && none.men.some(m => m.forced > 0) && none.five.notes.some(n => n.key === 'noball'),
    [none.five.ball, none.five.deficit]);
  /* DOWNHILL PRESSURE opens the threes: the same spot-up guard in a five that never gets to the rim and in one that does */
  const flat = E.sideOf(fiveOf(T0, ['pg-shoot', 'sg-3d', 'sf-moveshoot', 'pf-dualspot', 'c-spot']), X0), down = E.sideOf(fiveOf(T0, ['pg-slash', 'sg-3d', 'sf-slashoff', 'pf-cuthustle', 'c-roller']), X0);
  ok('pressure: a five that never attacks the paint gets its shooters contested threes, and says so', down.five.pressure > flat.five.pressure && down.men[1].p.three > flat.men[1].p.three
    && flat.five.notes.some(n => n.key === 'press'), [flat.five.pressure, down.five.pressure, flat.men[1].p.three, down.men[1].p.three]);
  /* HIT THE SCREENER, the way his role plays it */
  const f0 = (r, tac) => E.sideOf(fiveOf(T0, ['pg-mixed', 'sg-combomixed', 'sf-3d', 'pf-3d', r]), Object.assign({}, X0, { tac }));
  const roll = [f0('c-roller', null).men[4], f0('c-roller', { feed: -1 }).men[4]], pop = [f0('c-spot', null).men[4], f0('c-spot', { feed: -1 }).men[4]];
  ok('hit the screener: more of the plays to him - a rim roller\'s at the rim, a pick-and-pop big\'s from three', roll[1].u2 > roll[0].u2 + 1 && roll[1].m.rim > roll[0].m.rim
    && pop[1].u2 > pop[0].u2 + 1 && pop[1].m.three > pop[0].m.three && E.TACTICS.find(t => t.k === 'feed').left === 'Hit the screener', [roll[0].m.rim, roll[1].m.rim, pop[0].m.three, pop[1].m.three]);
  /* WHAT A ROLE RULES OUT, AND WHAT IS NOT ITS KIND */
  const insOf = (id, keys) => new Map([[String(id), { u: 0, k: new Set(keys) }]]);
  const rr = ['pg-mixed', 'sg-combomixed', 'sf-3d', 'pf-3d', 'c-roller'];
  const told = E.sideOf(fiveOf(T0, rr), Object.assign({}, X0, { ins: insOf(T0.men[4].id, ['pop']) })), plain = E.sideOf(fiveOf(T0, rr), X0);
  ok('locks: an instruction his role rules out is not followed (a rim roller told to pop)', RO.locks('c-roller').has('pop') && near(told.men[4].m.three, plain.men[4].m.three, 1e-12));
  const bigRoles = ['pg-mixed', 'sg-combomixed', 'sf-3d', 'pf-dualspot', 'c-roller'];
  const arc = E.sideOf(fiveOf(T0, bigRoles), Object.assign({}, X0, { ins: insOf(T0.men[3].id, ['arc']) })), arc0 = E.sideOf(fiveOf(T0, bigRoles), X0);
  ok('roles: a guard\'s instruction is not a big\'s to follow (pull-up threes for a two-big stretch four)', RO.family('pf-dualspot') === 'b' && near(arc.men[3].m.three, arc0.men[3].m.three, 1e-12));
  /* TRUE USAGE: the plays he ends and the shots he makes for the others */
  const euro = E.sideOf(fiveOf(T0, ['pg-euro', null, null, null, null]), X0), shoot = E.sideOf(fiveOf(T0, ['pg-shoot', null, null, null, null]), X0);
  ok('true usage: never under his usage; a pass-first point guard sets up more and ends fewer than a shooting one', euro.men.every(m => m.tusg >= m.u2 - 1e-9)
    && euro.men[0].ast > shoot.men[0].ast && euro.men[0].u2 < shoot.men[0].u2 && euro.men[0].tusg - euro.men[0].u2 > shoot.men[0].tusg - shoot.men[0].u2,
    [euro.men[0].u2, euro.men[0].tusg, shoot.men[0].u2, shoot.men[0].tusg]);
  /* THE FIT, AND ITS WORDS (Louie: "Thomas Hurley (a great shooter and solid slasher) should not be getting a more
     positive rip through colour vs green light"; "Block rate 80% of his position's [what does this mean!?]") */
  const base1 = cardAt(1);
  const shooter = Object.assign({}, base1, { p3Rel: 1.18, rimRel: 1.06, mixRel: Object.assign({}, base1.mixRel, { three: 1.4 }) });
  const slasher = Object.assign({}, base1, { p3Rel: 0.8, rimRel: 1.15, mixRel: Object.assign({}, base1.mixRel, { three: 0.6 }) });
  ok('fit: a real shooter who can also slash suits the green light far more than ripping through; a slasher who cannot shoot the other way round',
    IN.fit('green', shooter, ref).s > IN.fit('rip', shooter, ref).s + 0.2 && IN.fit('rip', slasher, ref).s > IN.fit('green', slasher, ref).s,
    [IN.fit('green', shooter, ref).s, IN.fit('rip', shooter, ref).s, IN.fit('green', slasher, ref).s, IN.fit('rip', slasher, ref).s]);
  const why = IN.fit('rimp', cardAt(2), ref).why;
  ok('fit: the reasons are plain words, never a ratio of rates', /blocks shots .* most small forwards/.test(why) && !/of his position/.test(why), why);
}
{
  /* THE ROTATION, PAINTED (Louie: "an interactive rotations chart ... I'd rather lineup granularity") */
  const lu = [{ ids: ['a1', 'a2', 'a3', 'a4', 'a5'], min: 0, when: [[0, 8], [32, 40]], roles: ['pg-euro', null, null, null, 'c-roller'] }, { ids: ['b1', 'b2', 'b3', 'b4', 'b5'], min: 0, when: [[8, 32]] }];
  const sg = E.rotation(lu, 40), mm = E.minutesOf(sg);
  ok('rotation: painted minutes are played where they were painted, each stretch with its lineup\'s roles', near(mm.get('a1'), 16, 1e-9) && near(mm.get('b1'), 24, 1e-9)
    && sg[0].roles && sg[0].roles[0] === 'pg-euro' && sg[0].roles[4] === 'c-roller' && sg.find(s => s.t0 <= 10 && s.t1 > 10).ids[0] === 'b1' && sg[sg.length - 1].ids[0] === 'a1');
  const gap = E.minutesOf(E.rotation([{ ids: ['a1', 'a2', 'a3', 'a4', 'a5'], when: [[0, 10]] }, { ids: ['b1', 'b2', 'b3', 'b4', 'b5'], when: [[10, 20]] }], 40));
  ok('rotation: a minute nobody was given goes to lineup 1', near(gap.get('a1'), 30, 1e-9) && near(gap.get('b1'), 10, 1e-9));
  const old = [{ ids: ['a1', 'a2', 'a3', 'a4', 'a5'], min: 24 }, { ids: ['b1', 'b2', 'b3', 'b4', 'b5'], min: 16 }], w = E.paintOf(old, 40);
  const tot = ws => ws.reduce((a, x) => a + x[1] - x[0], 0);
  ok('rotation: a plan from before the chart, painted to the minute as it was played', tot(w[0]) + tot(w[1]) === 40 && Math.abs(tot(w[0]) - 24) <= 1 && w[0][0][0] === 0, w);
}
/* A SIGNING WITH NO CARD (no minutes yet; Louie, 2026-10-15: "Game froze at the 6:51 minute mark ... seth wylie (who
   hasn't played a minute yet) was in the game"): on the bench he is never sent on, and the game plays to the end */
{
  const C2 = new Map(cards); C2.set('ghost', undefined);
  const H = teamObj(teams[0], { cards: C2, bench: teams[0].men.map(r => r.id).concat(['ghost']) });
  let g = null, err = null;
  try { g = MT.play(H, teamObj(teams[1]), { L, ref, G: 40 }, { seed: 77, home: 1 }); } catch (e) { err = e; }
  ok('match: a man with no card on the bench is never sent on, and the game plays to the end', !err && g && g.pts[0] > 0 && g.pts[1] > 0
    && !g.events.some(e => e.p === 'ghost' || e.in === 'ghost' || e.out === 'ghost') && g.box[0].every(x => x.id !== 'ghost' || !(x.min > 0)), err && err.message);
}
/* ...and in a painted lineup, where the freeze came from: the plan's five with him in it would have been a man short
   ("a five is missing a player") - the assistant keeps the five he has and the game goes on */
{
  const ids = teams[0].men.slice(0, 5).map(r => r.id), ids2 = teams[0].men.slice(5, 9).map(r => r.id).concat(['ghost']);
  const C2 = new Map(cards); C2.set('ghost', undefined);
  const H = teamObj(teams[0], { cards: C2, segs: E.rotation([{ ids, min: 30 }, { ids: ids2, min: 10 }], 40), bench: teams[0].men.map(r => r.id).concat(['ghost']) });
  let M = null, err = null, steps = 0;
  try { M = MT.create(H, teamObj(teams[1]), { L, ref, G: 40 }, { seed: 9, home: 1 }); while (!M.g.over && steps < 3000) { MT.step(M); steps++; } } catch (e) { err = e; }
  ok('match: a painted lineup holding a man with no card does not stop the game', !err && M && M.g.over && !M.sides[0].floor.includes('ghost'), err && err.message);
}
/* NO EVENT AFTER THE ENGINE'S CLOCK (Louie, 2026-10-16: "Happened after a missed shot on x2 speed"): the live screen shows
   the events up to the engine's clock before it asks for the next possession, so one timed after it (a late miss's board
   rounded up past the possession's end) froze the game - and the events never run backwards */
{
  let ahead = 0, back = 0, n = 0;
  for (let sd = 1; sd <= 20; sd++) {
    const M = MT.create(teamObj(teams[sd % 6]), teamObj(teams[(sd + 3) % 6]), { L, ref, G: 40 }, { seed: sd, home: 1 });
    while (!M.g.over) { const n0 = M.events.length; MT.step(M); n++; if (M.events.slice(n0).some(e => e.t > M.g.t + 1e-6)) ahead++; }
    M.events.forEach((e, k) => { if (k && e.t < M.events[k - 1].t) back++; });
  }
  ok('match: no event is ever timed after the engine clock, and none runs backwards (20 games)', ahead === 0 && back === 0 && n > 2000, { ahead, back, n });
}
/* ---------------------------------------------------------------- the match, possession by possession --- */
/* core/match.js (Louie, 2026-10-14: live games "where the user can change team instructions, make subs etc. to change the
   game"): every game is played by the men on the floor at that moment, and every change is the game's from then on */
{
  /* THE ROLES ON THE FLOOR: the plan's, a real club none, a role changed in the game holding, and kept with it */
  const ids = teams[0].men.slice(0, 5).map(r => r.id);
  const H = teamObj(teams[0], { segs: E.rotation([{ ids, min: 40, roles: ['pg-euro', null, null, null, 'c-roller'] }], 40) }), A = teamObj(teams[1]), X = { L, ref, G: 40 };
  const M = MT.create(H, A, X, { seed: 5, home: 1 });
  const r0 = MT.rolesAt(M.sides[0], 0, 40), rA = MT.rolesAt(M.sides[1], 0, 40);
  MT.act(M, 0, { type: 'role', id: M.sides[0].floor[4], k: 4, role: 'c-spot' });
  MT.runTo(M, 300);
  const r1 = MT.rolesAt(M.sides[0], M.g.t / 60, 40), M2 = MT.restore(JSON.parse(JSON.stringify(MT.snapshot(M))), H, A, X);
  ok('match: the five on the floor plays its roles (a real club none); a role changed in the game holds, and is kept with it',
    r0[0] === 'pg-euro' && r0[4] === 'c-roller' && rA === null && (M.sides[0].floor[4] !== ids[4] || r1[4] === 'c-spot') && M2.sides[0].roleOv && M2.sides[0].roleOv[ids[4] + '@4'] === 'c-spot', [r0, r1]);
}
{
  const H = teamObj(teams[0]), A = teamObj(teams[1]), X = { L, ref, G: 40 };
  const g1 = MT.play(H, A, X, { seed: 21, home: 1 }), g2 = MT.play(H, A, X, { seed: 21, home: 1 });
  ok('match: the same seed, the same game', JSON.stringify(g1.pts) === JSON.stringify(g2.pts) && JSON.stringify(g1.events) === JSON.stringify(g2.events));
  const sum = (b, k) => b.reduce((a, x) => a + x[k], 0);
  ok('match: the box scores add up to the game', [0, 1].every(s => sum(g1.box[s], 'pts') === g1.pts[s] && sum(g1.box[s], 'fga') === g1.tally[s].fga && sum(g1.box[s], 'fta') === g1.tally[s].fta
    && sum(g1.box[s], 'tov') === g1.tally[s].tov && sum(g1.box[s], 'oreb') === g1.tally[s].oreb), [0, 1].map(s => [sum(g1.box[s], 'pts'), g1.pts[s]]));
  ok('match: 200 minutes a side, nobody past the foul limit, the score never tied at the end', [0, 1].every(s => near(sum(g1.box[s], 'min'), 200 + 25 * g1.ot, 0.6))
    && g1.box.flat().every(b => b.pf <= 5 && b.fgm <= b.fga) && g1.pts[0] !== g1.pts[1], [sum(g1.box[0], 'min'), sum(g1.box[1], 'min'), g1.ot]);
  const subs = g1.events.filter(e => e.k === 'U'), quarters = g1.events.filter(e => e.k === 'q').length;
  ok('match: the coaches sub at dead balls, and every quarter starts', subs.length > 10 && quarters === 3 && g1.lineups.length > 5);
  /* a game in hand: run to half-time, a change, and the second half is another game; the first half is the same */
  const M1 = MT.create(H, A, X, { seed: 33, home: 1 }); MT.runTo(M1, 1200);
  const half = JSON.stringify(M1.events), k = M1.g.k;
  const M2 = MT.create(H, A, X, { seed: 33, home: 1 }); MT.runTo(M2, 1200);
  const star = M2.sides[0].floor[0], bench = M2.sides[0].roster.find(id => !M2.sides[0].floor.includes(id));
  MT.act(M2, 0, { type: 'tac', tac: { handlers: 1, gamble: 1, leak: 1 } });
  MT.act(M2, 0, { type: 'auto', on: false });
  MT.act(M2, 0, { type: 'sub', out: star, in: bench });
  MT.finish(M1); MT.finish(M2);
  ok('match: the first half the same, the change the game\'s from then on', JSON.stringify(M2.events.slice(0, JSON.parse(half).length)) === half && M2.log.length === 3 && M2.log[0].at === k
    && JSON.stringify(M1.g.score) !== JSON.stringify(M2.g.score), [M1.g.score, M2.g.score]);
  ok('match: the reader\'s sub at the next dead ball, and with the assistant off his five stands', M2.events.some(e => e.k === 'U' && e.s === 0 && e.out === star && e.in === bench));
  /* kept and taken up again: a game snapshot mid-way plays on to the very same end */
  const M3 = MT.create(H, A, X, { seed: 44, home: 1 }); MT.runTo(M3, 1700);
  const snap = JSON.parse(JSON.stringify(MT.snapshot(M3)));
  const M4 = MT.restore(snap, H, A, X);
  MT.finish(M3); MT.finish(M4);
  ok('match: a game kept mid-way and taken up again ends the same', JSON.stringify(M3.g.score) === JSON.stringify(M4.g.score) && M3.events.length === M4.events.length, [M3.g.score, M4.g.score]);
  /* condition: a man never subbed is spent by the fourth quarter */
  const iron = MT.create(H, A, X, { seed: 55, home: 1 });
  MT.act(iron, 0, { type: 'auto', on: false });
  MT.finish(iron);
  const ironMan = iron.sides[0].floor[0];
  ok('match: legs run down with the minutes (a man left out all game is tired by the end), and the bench\'s come back',
    iron.sides[0].en[ironMan] < 60 && Math.max(...iron.sides[0].roster.filter(id => !iron.sides[0].floor.includes(id)).map(id => iron.sides[0].en[id])) > 90, [iron.sides[0].en[ironMan]]);
  /* fouls: five and he is out, and his coach takes him off */
  const fo = MT.create(H, A, X, { seed: 66, home: 1 }); MT.runTo(fo, 300);
  const victim = fo.sides[1].floor[2]; fo.sides[1].pf[victim] = 5;
  MT.step(fo);
  ok('match: five fouls and he is out', !fo.sides[1].floor.includes(victim) && fo.events.some(e => e.k === 'U' && e.out === victim));
  /* the season plays with it, and keeps its play-by-play */
  ok('match: the result is engine.play\'s shape (season.js keeps it)', ['pts', 'ot', 'poss', 'tally', 'box', 'events', 'lineups'].every(k2 => k2 in g1) && g1.lineups.every(x => x.h.length === 5 && x.a.length === 5));
  /* THE READER'S TIMEOUT STOPS THE GAME BEFORE THE NEXT POSSESSION (views/match.js: what they change in it is in that one):
     the step that calls it plays nothing, the next plays the possession with the change in it */
  const T1 = MT.create(H, A, X, { seed: 77, home: 1 }); MT.runTo(T1, 900);
  let guard = 0;
  while (T1.g.start !== 0 && guard++ < 50) MT.step(T1);       // to a dead ball
  const k0 = T1.g.k, t0 = T1.g.t, to0 = T1.sides[0].to, n0 = T1.events.length;
  MT.act(T1, 0, { type: 'timeout' });
  MT.step(T1);
  const added = T1.events.slice(n0);
  ok('match: the reader\'s timeout stops the game there (no possession played with it)', T1.g.k === k0 && T1.g.t === t0 && added.some(e => e.k === 'Y' && e.s === 0) && !added.some(e => e.k === 'P')
    && T1.sides[0].to === to0 - 1, [T1.g.k, k0, added.map(e => e.k)]);
  const outM = T1.sides[0].floor[1], inM = T1.sides[0].roster.find(id => !T1.sides[0].floor.includes(id) && T1.sides[0].pf[id] < 5);
  MT.act(T1, 0, { type: 'sub', out: outM, in: inM });
  MT.step(T1);
  ok('match: and the change made in it is in the very next possession', T1.g.k === k0 + 1 && T1.sides[0].floor.includes(inM) && !T1.sides[0].floor.includes(outM));
  /* a substitution waiting for a dead ball can be called off */
  const C1 = MT.create(H, A, X, { seed: 88, home: 1 }); MT.runTo(C1, 400);
  const o1 = C1.sides[0].floor[0], i1 = C1.sides[0].roster.find(id => !C1.sides[0].floor.includes(id));
  MT.act(C1, 0, { type: 'sub', out: o1, in: i1 });
  MT.act(C1, 0, { type: 'unsub', out: o1, in: i1 });
  ok('match: a waiting substitution called off', C1.sides[0].pend.length === 0 && C1.log.length === 2);
  /* the instructions are kept with a game in hand, whatever the squad's are when it is taken up again */
  const Hi = Object.assign({}, H, { ins: new Map([[H.segs[0].ids[0], { u: 2, k: new Set(['agg']) }]]) });
  const K1 = MT.create(Hi, A, X, { seed: 99, home: 1 }); MT.runTo(K1, 600);
  MT.act(K1, 0, { type: 'ins', ins: {} });                     // all of them cleared, live
  const K2 = MT.restore(JSON.parse(JSON.stringify(MT.snapshot(K1))), Hi, A, X);
  ok('match: a game kept with its instructions cleared comes back cleared (not the squad\'s)', K2.sides[0].T.ins instanceof Map && K2.sides[0].T.ins.size === 0);
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
  /* ANY TIME IN ITS WEEK (Louie, 2026-10-15: "play the two weekly games whenever they want, but has to be within the
     week (otherwise auto simmed)"): the round's week, Monday to Sunday; the reader's to play in it, the assistant's after */
  const at = (d, h) => { const x = SE.dayStart(d); x.setHours(h); return x; };
  const wk = SE.weekStart(first), monday = d => d.getDay() === 1;
  ok('season: a round is the reader\'s to play any time in its week (Monday to Sunday), and played for them once the week is over',
    monday(wk) && SE.due(S, at(first, 0)).length === 0 && SE.matchday(S, at(first, 23), 0).r === 1 && SE.matchday(S, wk, 0).r === 1
      && SE.matchday(S, at(dayAfter(first, -1), 23), 0).r === 1 && SE.due(S, at(first, 23)).length === 0
      && SE.matchday(S, SE.weekEnd(first), 0) === null && SE.due(S, SE.weekEnd(first))[0] === 1 && SE.matchday(S, new Date(wk.getTime() - 1), 0) === null);
  /* both of a week's games, in their order: the second once the first is played, the same week */
  const S2 = JSON.parse(JSON.stringify(S)), r2 = S2.fixtures.find(f => f.r === 2 && (f.h === 0 || f.a === 0)), r3 = S2.fixtures.find(f => f.r === 3 && (f.h === 0 || f.a === 0));
  S2.fixtures.filter(f => f.r === 1).forEach(f => { f.res = [80, 70, 0]; });
  const wk2 = SE.weekStart(r2.d), twoInOne = r3 && SE.weekStart(r3.d).getTime() === wk2.getTime();
  const firstOf2 = SE.matchday(S2, wk2, 0);
  S2.fixtures.filter(f => f.r === 2).forEach(f => { f.res = [80, 70, 0]; });
  ok('season: the week\'s two games in their order, both the reader\'s to play that week', twoInOne && firstOf2 && firstOf2.r === 2 && SE.matchday(S2, wk2, 0).r === 3, [r2.d, r3 && r3.d]);
  /* a round without the reader's club is played when its day begins */
  {
    const odd = SE.create({ clubs: ['me'].concat(teams.slice(0, 4).map(t => t.id)), start: '2026-10-07', perWeek: 2, meetings: 1, seed: 3 });
    const bye = [...new Set(odd.fixtures.map(f => f.r))].find(r => !odd.fixtures.some(f => f.r === r && (f.h === 0 || f.a === 0)));
    const bd = odd.fixtures.find(f => f.r === bye).d;
    ok('season: a round without the reader\'s club is played when its day begins', bye != null && SE.due(odd, at(bd, 1)).includes(bye) && !SE.due(odd, at(dayAfter(bd, -1), 23)).includes(bye));
  }
  /* a Saturday game skipped (2026-10-14): the season was drawn again from the day the page opened whenever nothing had
     been played, even after the first round's time had come - so that round was gone */
  ok('season: it may be drawn again (a club of the league added) only before its first match day',
    SE.redrawable(S, at(dayAfter(first, -1), 23)) && !SE.redrawable(S, at(first, 0)) && !SE.redrawable(S, at(dayAfter(first, 3), 12)));
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
  /* one club that cannot be put together (or a game the engine stops on) leaves that game alone - the round's others are
     played (2026-10-14: "make sure all games on the fixture list today can be played") */
  {
    const S2 = SE.create({ clubs, start: '2026-10-07', perWeek: 2, meetings: 3, seed: 5 });
    const r0 = 1, broken = S2.fixtures.find(f => f.r === r0).h;
    const ctx2 = { X: { L, ref, G: 40 }, me: 0, team: i => { if (i === broken) throw new Error('no squad'); return objs[i]; } };
    const res = SE.play(S2, r0, ctx2), games = S2.fixtures.filter(f => f.r === r0);
    ok('season: a club that cannot be put together leaves only its own game unplayed, with the reason',
      games.filter(f => f.h === broken || f.a === broken).every(f => f.res == null) && games.filter(f => f.h !== broken && f.a !== broken).every(f => Array.isArray(f.res))
        && res.some(x => x.error === 'no squad'), res.map(x => x.error || 'ok'));
  }
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
  /* and his fouls, the offensive ones among them (a turnover's `of`: his foul, no free throws) */
  const ofs = Object.keys(S.pbp).reduce((a, k) => a + SE.decodeEvents(S, S.pbp[k].e).filter(e => e.k === 'T' && e.of).length, 0);
  const samePf = S.box[r1].every(side => side.every(l => { const id = S.people[l[0]], x = d.stats[id]; return /^fill:/.test(id) || (x && x.pf === l[idx('pf')]); }));
  ok('scorer: and every man\'s fouls, offensive fouls among them (and the season has some)', samePf && ofs > 0, [ofs]);
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
    /* a possession's own plays (a substitution, a timeout or the next quarter's start comes between possessions) */
    const PLAY = new Set(['S', 'F', 'T', 'O', 'D', 'f', 'X']);
    starts.forEach(p => { const i = e2.indexOf(p); for (let j = i + 1; j < e2.length && e2[j].k !== 'P' && e2[j].k !== 'Q' && e2[j].k !== 'q'; j++) if (PLAY.has(e2[j].k) && e2[j].t < 2400 && Math.floor(e2[j].t / QL) !== Math.floor(p.t / QL)) inQ = false; });
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
/* ---------------------------------------------------------------- the ball-screen coverage, against whom it meets --- */
/* engine.js coverage (Louie, 2026-10-15: "drop coverage hurts rim-bound players with no inbetween game who are set to
   slashing", "how hedging affects ball handlers w/ weaker handles", "opponent has a good drop big with good rim defense,
   I currently have a rim roller big which isn't doing much, so I bring in a good pick and pop big") */
{
  const mk = o => Object.assign({ x: 0, y: 0, popF: 0, shortF: 0, loose: 0, pass: 0, rim: 0, mid: 0, pull: 0, p3: 1, passQ: 1, rp: 1, mq: 1 }, o);
  const mix = { drop: 0.36, hedge: 0.07 };
  /* a handler (place 0) and a screening centre (place 4) against a five whose centre plays `cov` (a strong rim protector,
     quick feet) */
  const run = (h, sc, cov) => {
    const OM = [{ id: 'h', cv: mk(Object.assign({ x: 0.6 }, h)) }, { id: 'a', cv: mk({}) }, { id: 'b', cv: mk({}) }, { id: 'c', cv: mk({ y: 0.1 }) }, { id: 's', cv: mk(Object.assign({ y: 0.5 }, sc)) }];
    const DM = [0, 1, 2, 3, 4].map(j => ({ id: 'd' + j, cov: j === 4 ? cov : 'cont', cv: mk({ rp: 1.5, mq: 1.4 }) }));
    return E.coverage({ men: OM }, { men: DM, covMix: mix });
  };
  const vs = (h, sc, a, b, f) => f(run(h, sc, a)) - f(run(h, sc, b));
  ok('coverage: a hedge turns a loose-handled, poor-passing handler over; a sure-handed passer hardly',
    vs({ loose: 1.5, pass: -1 }, {}, 'hedge', 'cont', r => r[0].tov) > 0.05 && vs({ loose: -1, pass: 1.5 }, {}, 'hedge', 'cont', r => r[0].tov) < 0);
  ok('coverage: a drop makes the handler\'s rim finishes harder, and gives a pull-up shooter his three',
    vs({}, {}, 'drop', 'cont', r => r[0].p.rim) < -0.05 && vs({ pull: 1.5 }, {}, 'drop', 'cont', r => r[0].p.three) > 0 && vs({}, {}, 'drop', 'cont', r => r[0].p.mid) > 0);
  ok('coverage: a roller finishes into a dropping rim protector, a popper is open behind him',
    vs({}, { popF: 0 }, 'drop', 'cont', r => r[4].p.rim) < -0.05 && vs({}, { popF: 0.9, p3: 1.2 }, 'drop', 'cont', r => r[4].p.three) > 0.03);
  ok('coverage: a popping screener drags the drop big out of the paint - his handler\'s drives suffer less',
    run({}, { popF: 0.9 }, 'drop')[0].p.rim > run({}, { popF: 0 }, 'drop')[0].p.rim);
  ok('coverage: over a hedge the roller gets the 4-on-3', vs({}, { popF: 0 }, 'hedge', 'cont', r => r[4].p.rim) > 0);
  /* the league's usual coverage changes nothing: a five that drops and hedges as much as the league does, against the
     average handler, is even */
  const even = (() => {
    const OM = [{ id: 'h', cv: mk({ x: 0.6 }) }, { id: 'a', cv: mk({}) }, { id: 'b', cv: mk({}) }, { id: 'c', cv: mk({ y: 0.5 }) }, { id: 's', cv: mk({ y: 0.5 }) }];
    const DM = [0, 1, 2, 3, 4].map(j => ({ id: 'd' + j, cov: 'cont', cv: mk({}) }));
    return E.coverage({ men: OM }, { men: DM, covMix: { drop: 0, hedge: 0 } });
  })();
  ok('coverage: nothing moves for a league with no coverage to measure against and a five that contains', even === null || even.every(e => e.tov === 0 && e.p.rim === 0 && e.p.mid === 0 && e.p.three === 0));
  /* end to end: the same five against a club whose centre drops - a rim-rolling centre against a pick-and-pop centre */
  const base = teams[3].men.slice(0, 5).map(r => r.id), dfive = teams[4].men.slice(0, 5).map(r => r.id);
  const bigC = Object.assign({}, cards.get(dfive[4]), { id: 'dropC', def: Object.assign({}, cards.get(dfive[4]).def, { blk: 6, rimSave: 6, stl: 0.6 }) });
  const dfC = dfive.map((id, k) => ({ card: k === 4 ? bigC : cards.get(id), k }));
  const Xd = { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr, covMix: mix, cov: new Map([['dropC', E.inferCover(bigC, ref)]]) };
  const sd = E.sideOf(dfC, Xd), sdC = E.sideOf(dfC, Object.assign({}, Xd, { cov: null }));
  const ppc = r => (1 - r.tov) * ((1 - r.sfoul - r.bonus) * (2 * r.mixRim * r.pRim + 2 * r.mixMid * r.pMid + 3 * r.mix3 * r.p3) + (r.sfoul + r.bonus) * 2 * r.ft);
  const edge = role => {
    const five = base.map((id, k) => ({ card: cards.get(id), k, role: k === 4 ? role : null }));
    const so = E.sideOf(five, { mu: L.rates, ref, tac: null, G: 40, dTr: L.dTr, covMix: mix });
    const r = Sim.matchup({ off: so.off, def: so.def, n: 0 }, { off: sd.off, def: sd.def, n: 0 }, L, { home: 0 }).r[0];
    const rC = Sim.matchup({ off: so.off, def: so.def, n: 0 }, { off: sdC.off, def: sdC.def, n: 0 }, L, { home: 0 }).r[0];
    return { drop: ppc(E.interact(r, so, sd)) - ppc(r), cont: ppc(E.interact(rC, so, sdC)) - ppc(rC), cov: E.interact(r, so, sd).cov.get(base[4]) };
  };
  const roller = edge('c-roller'), popper = edge('c-dualpnp');
  ok('coverage: a rim protector read from his game drops', E.inferCover(bigC, ref) === 'drop', E.inferCover(bigC, ref));
  ok('coverage: against a club whose centre drops, a pick-and-pop centre does better than a rim roller (his own rim finishing the worse for it)',
    popper.drop > roller.drop && roller.cov.p.rim < 0, { roller: { drop: +roller.drop.toFixed(4), cont: +roller.cont.toFixed(4) }, popper: { drop: +popper.drop.toFixed(4), cont: +popper.cont.toFixed(4) } });
}
/* ---------------------------------------------------------------- the plays on the live court --- */
/* core/plays.js (Louie, 2026-10-15: "a good visual representation of how the team would play in real life with the set
   roles", "real life plays from playbooks ... assign them properly according to the player roles, position and what the
   playing engine needs"): every possession of a game drawn as a set from the playbook, ending where the engine ended it */
{
  const PL = Mgr.plays;
  ok('plays: every set\'s finishes and alignment name its own places', PL.BOOK.every(st => st.fin.every(f => st.places[f[0]] && (f[3] === '-' || st.places[f[3]])) && Object.keys(st.align).every(p => st.places[p])));
  ok('plays: the playbook holds the sets the research found (ball screens, handoffs, off-ball screens, cuts, the post, the isolation)',
    ['spread', 'side', 'horns', 'pop', 'short', 'spain', 'drag', 'pistol', 'hornsdho', 'chicago', 'delay', 'flare', 'zipper', 'floppy', 'stagger', 'elevator', 'hammer', 'iverson', 'ucla', 'chin', 'flex', 'split', 'highlow', 'iso', 'clear', 'swing'].every(id => PL.BOOK.some(s => s.id === id)));
  /* the kind of play behind a finish follows the finisher's role */
  const draw = (key, c, n) => { const R = SC.rng(7), out = {}; for (let i = 0; i < (n || 400); i++) { const k = PL.kindOf(R, RO.BY.get(key), c); out[k] = (out[k] || 0) + 1; } return out; };
  const share = (o, ks) => ks.reduce((a, k) => a + (o[k] || 0), 0) / Object.values(o).reduce((a, v) => a + v, 0);
  const roller = draw('c-roller', { end: 'S', z: 0, assisted: true }), mover = draw('sg-moveshoot', { end: 'S', z: 2, assisted: true });
  const post = draw('c-post', { end: 'S', z: 1, assisted: false }), euro = draw('pg-euro', { end: 'S', z: 1, assisted: false });
  ok('plays: a rim roller\'s assisted finish at the rim is a roll or a cut to the dunker spot', share(roller, ['roll', 'cut']) >= 0.85, roller);
  ok('plays: a movement shooter\'s assisted three comes off screens or a spot-up, mostly off screens', share(mover, ['offs', 'spot']) >= 0.9 && share(mover, ['offs']) >= 0.35, mover);
  ok('plays: a post scorer\'s own mid-range shot is a post-up', share(post, ['post']) >= 0.5, post);
  ok('plays: a Euro PG\'s own pull-up comes out of the pick-and-roll', share(euro, ['pnr']) >= 0.7, euro);
  /* one possession: the five's roles, a finish from the engine; the set drawn ends in it, the engine's passer passing */
  const five = ['p0', 'p1', 'p2', 'p3', 'p4'], d5 = ['d0', 'd1', 'd2', 'd3', 'd4'];
  const idx = id => { const a = five.indexOf(id); if (a >= 0) return a; const b = d5.indexOf(id); return b >= 0 ? 5 + b : -1; };
  const from = { pos: [[0, 60], [15, 62], [-15, 62], [8, 70], [-8, 72], [0, 50], [12, 50], [-12, 50], [6, 40], [-6, 40]], hold: 0, ball: null };
  const onePoss = (keys, end, seed) => PL.plan({ evs: [{ k: 'P', t: 100, s: 0, st: 0 }, Object.assign({ t: 114, s: 0 }, end)], idx, roles: keys.map(k => RO.BY.get(k)), from, prev: { how: 'make' },
    spot: x => PL.shotSpot(x.z, 0.5, 0.4), seed });
  const SCREENS = new Set(['High pick-and-roll', 'Side pick-and-roll (ram)', 'Horns', 'Pick-and-pop', 'Spain pick-and-roll', 'Drag screen', 'Pistol', 'Zipper', 'Iverson cut', 'Short roll', 'Horns elbow handoff', 'Chicago', 'Delay', 'UCLA cut']);
  const five1 = ['pg-euro', 'sg-3d', 'sf-3d', 'pf-dualspot', 'c-roller'];
  let inSet = 0, fromPG = 0;
  for (let i = 0; i < 40; i++) {
    const pl = onePoss(five1, { k: 'S', z: 0, m: 1, p: 'p4', a: 'p0' }, 'roll' + i);
    if (pl.calls.some(c => SCREENS.has(c.text))) inSet++;
    const catches = pl.frames.filter(f => f.ball && f.ball.fly && f.ball.fly.to === 4 && f.t <= 114);
    if (catches.length && catches[catches.length - 1].ball.fly.from === 0) fromPG++;
  }
  /* (the rest: drop-offs from drives - an isolation, a clear-out, attacking a closeout, Hammer - the research's other
     source of a big's finish at the dunker spot) */
  ok('plays: a rim roller\'s dunk off the Euro PG\'s pass is drawn mostly as a ball-screen or handoff set, the PG always making the pass', inSet >= 24 && fromPG === 40, [inSet, fromPG]);
  /* THE COVERAGE ON A BALL SCREEN is the screener's man's own instruction (Louie, 2026-10-15: "hedge big = hedging,
     contain = show and recover, drop big = drop"): the same play, only his instruction changed */
  {
    let pl = null;
    for (let i = 0; i < 80 && !pl; i++) { const x = onePoss(five1, { k: 'S', z: 1, m: 1, p: 'p0', a: null }, 'cov' + i); if (x.frames.some(f => f.hint && f.hint.pnr && f.hint.ph === 1)) pl = x; }
    const i = pl ? pl.frames.findIndex(f => f.hint && f.hint.pnr && f.hint.ph === 1) : -1, f = pl && pl.frames[i], f0 = pl && pl.frames[i - 1];
    /* (the defence reads the offence a moment late: measured against where it reads them) */
    const covAt = cov => {
      const [h, s] = f.hint.pnr, t = f0.t + 0.3 * (f.t - f0.t), seen = PL.at(pl, t - 0.3).off, d = (x, y) => +Math.hypot(x[0] - y[0], x[1] - y[1]).toFixed(1);
      pl.D = PL.defOf({ dins: [0, 1, 2, 3, 4].map(j => (j === s ? [cov] : [])) });
      const m = PL.at(pl, t);
      return { ball: d(m.def[s], seen[h]), screen: d(m.def[s], seen[s]), rim: d(m.def[s], PL.RIM), handlerRim: d(seen[h], PL.RIM) };
    };
    const hd = pl && covAt('hedge'), ct = pl && covAt('cont'), dp = pl && covAt('drop');
    ok('plays: a hedge big steps in front of the handler, a contain big shows level with the screen, a drop big sits back at the rim',
      !!pl && hd.ball <= 3 && hd.rim < hd.handlerRim && ct.screen <= 2.5 && dp.rim <= 14 && dp.ball >= 7, { hd, ct, dp });
    /* a hedge against the short roll is a trap: two men on the ball as he passes out of it */
    const shortRoll = ['pg-euro', 'sg-3d', 'sf-3d', 'pf-dualspot', 'c-shortplay'];
    let sr = null;
    for (let k = 0; k < 120 && !sr; k++) { const x = onePoss(shortRoll, { k: 'S', z: 1, m: 1, p: 'p4', a: 'p0' }, 'sr' + k); if (x.calls.some(c => c.text === 'Short roll')) sr = x; }
    const g = sr ? sr.frames.find(fr => fr.hint && fr.hint.pnr && fr.hint.ph === 2) : null, g0 = g ? sr.frames[sr.frames.indexOf(g) - 1] : null;
    let trap = null;
    if (g) {
      const [h, s] = g.hint.pnr;
      sr.D = PL.defOf({ dins: [0, 1, 2, 3, 4].map(j => (j === s ? ['hedge'] : [])) });
      const m = PL.at(sr, (g0.t + g.t) / 2), d2 = j => Math.hypot(m.def[j][0] - m.off[h][0], m.def[j][1] - m.off[h][1]);
      trap = [d2(h), d2(s)].map(x => +x.toFixed(1));
    }
    ok('plays: a hedge against the short roll traps the handler (both men on him)', !!trap && trap[0] <= 4.5 && trap[1] <= 4.5, trap);
  }
  const posts = ['pg-mixed', 'sg-3d', 'sf-3d', 'pf-dualspot', 'c-post'];
  let split = 0;
  for (let i = 0; i < 40; i++) { const pl = onePoss(posts, { k: 'S', z: 1, m: 1, p: 'p4', a: null }, 'post' + i); if (pl.calls.some(c => /Post split|High-low|Isolation|Clear-out/.test(c.text))) split++; }
  ok('plays: a post scorer\'s own hook comes out of a post entry (or an isolation)', split >= 24, split);
  const trip = onePoss(five1, { k: 'F', kind: 1, n: 2, m: 1, p: 'p1', f: 'd1' }, 'ft');
  const st = trip.stops[0], mid = st ? PL.at(trip, st.t, 0.6) : null;
  ok('plays: a trip to the line stops the clock: the shooter at the line, two of his men on the lane', !!st && Math.abs(mid.off[1][0]) < 0.5 && Math.abs(mid.off[1][1] - 20.1) < 0.5
    && mid.off.filter(p => Math.abs(Math.abs(p[0]) - 9.4) < 0.5 && p[1] < 13).length === 2, st && mid.off);
  /* whole games: every possession drawn, everybody on the court, the shot from the engine's spot, nobody faster than a man */
  let poss = 0, bad = 0, off = 0, shots = 0, there = 0, fastest = 0, called = 0, half = 0, hcP = 0, passes = 0, onePass = 0, brought = 0, byPrimary = 0, jumpers = 0, crowded = 0;
  for (let g = 0; g < 3; g++) {
    const M = MT.create(teamObj(teams[2 * g]), teamObj(teams[2 * g + 1]), { L, ref, G: 40 }, { seed: 400 + g, home: 1 });
    MT.finish(M);
    const ev = M.events, segs = M.lineups, floorAt = t => { let s = segs[0]; for (const x of segs) if (x.t0 * 60 <= t + 1e-6) s = x; return [s.h, s.a]; };
    ev.forEach((e, i) => {
      if (e.k !== 'P') return;
      let j = i + 1; while (j < ev.length && !['P', 'Q', 'q'].includes(ev[j].k)) j++;
      const evs = ev.slice(i, j), fl = floorAt(e.t), o5 = fl[e.s], d = fl[e.s ^ 1];
      const ix = id => { const a = o5.indexOf(id); if (a >= 0) return a; const b = d.indexOf(id); return b >= 0 ? 5 + b : -1; };
      const spot = x => PL.shotSpot(x.z, ((x.t * 7919) % 1000) / 1000, ((x.t * 104729) % 1000) / 1000);
      const pl = PL.plan({ evs, idx: ix, roles: o5.map((id, k) => RO.bestFor(k, cards.get(id), ref)), from: { pos: o5.concat(d).map((_, k) => [((k % 5) - 2) * 9, 70 + (k >= 5 ? -8 : 0)]), hold: 0, ball: null },
        prev: { how: 'dreb', by: 0 }, spot, seed: 'g' + g });
      poss++;
      const first = evs.find(x => x.k === 'S' || x.k === 'T' || x.k === 'F');
      if (first && first.k === 'S' && !first.tr && first.t - e.t >= 8) { half++; if (pl.calls.length) called++; }
      /* the half court (Louie, 2026-10-16): the ball brought up by the five's primary handler, and moved before the shot */
      if (first && !first.tr && first.t - e.t >= 10 && !evs.some(x => x.k === 'O')) {
        hcP++;
        const np = pl.frames.filter(f => f.ball && f.ball.fly && f.ball.fly.from !== 'rim' && f.ball.fly.to !== 'rim' && f.ball.fly.from <= 4 && f.ball.fly.to <= 4).length;
        passes += np; if (np <= 1) onePass++;
        const rs = o5.map((id, k) => RO.bestFor(k, cards.get(id), ref)), iw = rs.map((r, k) => (r.init || 0) + (k === 0 ? 0.04 : 0)), prim = iw.indexOf(Math.max(...iw));
        for (let t = e.t; t <= first.t; t += 0.2) { const mm = PL.at(pl, t); if (mm.hold != null && mm.hold <= 4 && mm.off[mm.hold][1] < 46) { brought++; if (mm.hold === prim) byPrimary++; break; } }
      }
      let last = null;
      const tEnd = j < ev.length ? ev[j].t : e.t + 20;
      for (let t = e.t; t <= tEnd; t += 0.25) {
        const m = PL.at(pl, t), all = m.off.concat(m.def);
        if (all.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) bad++;
        if (m.off.some(p => Math.abs(p[0]) > 25.5 || p[1] < 0 || p[1] > 93)) off++;
        if (last && !pl.stops.some(s => Math.abs(s.t - t) < 0.3)) m.off.forEach((p, k) => { fastest = Math.max(fastest, Math.hypot(p[0] - last.off[k][0], p[1] - last.off[k][1]) / 0.25); });
        last = m;
      }
      evs.filter(x => x.k === 'S').forEach(x => {
        const k = ix(x.p); if (k < 0 || k > 4) return;
        shots++;
        const F = spot(x), m = PL.at(pl, x.t - 0.02);
        if (Math.hypot(m.off[k][0] - F[0], m.off[k][1] - F[1]) <= 1.5) there++;
        if (x.z !== 0) { jumpers++; if (m.off.some((q, j2) => j2 !== k && Math.hypot(q[0] - m.off[k][0], q[1] - m.off[k][1]) < 6)) crowded++; }
      });
    });
  }
  ok('plays: every possession of three games drawn, nobody off the court, no number lost', poss > 400 && bad === 0 && off === 0, [poss, bad, off]);
  ok('plays: the shooter is at the engine\'s spot as the ball leaves his hand (nine shots in ten: a break too quick for the floor is the rest)', there / shots >= 0.9, [there, shots]);
  ok('plays: nobody faster than a sprinting man, outside the dead-ball stops', fastest <= 42, fastest.toFixed(1));
  ok('plays: a half-court possession has its set called', called / half >= 0.95, [called, half]);
  ok('plays: the five’s primary handler brings the ball up (not whoever runs the set)', brought > 100 && byPrimary / brought >= 0.9, [byPrimary, brought]);
  ok('plays: the half court moves the ball - about three passes a possession, few with one or none', hcP > 100 && passes / hcP >= 2.5 && onePass / hcP <= 0.22, [+(passes / hcP).toFixed(2), onePass, hcP]);
  ok('plays: nobody stands where the shooter shoots from (a teammate within 6 ft of a jump shot one time in twenty at most)', jumpers > 100 && crowded / jumpers <= 0.05, [crowded, jumpers]);
}
function dayAfter(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
