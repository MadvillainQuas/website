/* ============================================================================
   WHAT WINS 2 — THE FEATURE LINE (epinoia/features.js, docs/what-wins-model.md §3, §16 WP1).

   On the fixture game, its conversion to two halves, its copy without markers or shot types, and an
   overtime variant built here:
     * the layout: 108 unique keys at contiguous indices, the published units and need bits;
     * the box counts are teamAdv's; poss is the shot clock's possession count; timed_s / timed_n is
       ShotClock.averages to 1e-9; time-of-possession shares sum to 1; lead changes and ties are one game
       value on both rows; the halves and overtime add up to the score; live turnovers never exceed turnovers;
     * the stripped copy loses MARK, TYPE and ZONES and its rim rate is null;
     * free-throw trips, and-ones and the bonus on hand-built logs: a free throw logged before its foul, an
       assist between two free throws, the fifth team foul in quarters and the seventh in halves;
     * the A.1 stints add up to the side's floor time;
     * deterministic, under 15 ms a game, toRows' rounding and nulls, seasonFactors a ratio of sums under
       the quality masks, and the generated Edge Function copy giving the same line.

     node supabase/tests/ww-features.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const F = require(path.join(ROOT, 'epinoia', 'features.js'));
const E = require(path.join(ROOT, 'epinoia', 'engine.js'));
const SC = require(path.join(ROOT, 'epinoia', 'shotclock.js'));
const Sit = require(path.join(ROOT, 'epinoia', 'situations.js'));
const GAME = JSON.parse(readFileSync(path.join(ROOT, 'supabase', 'tests', 'fixtures', 'game.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 400))); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
const clone = x => JSON.parse(JSON.stringify(x));
const I = F.INDEX, Q = F.QBITS;
const g = (out, t, k) => out.f[t][I[k]];

/* ------------------------------------------------------------ the variants --- */
/* quarters 1-2 -> half 1, 3-4 -> half 2; the first of each pair 10:00 later on the clock */
function halves(src) {
  const x = clone(src);
  x.events = x.events.filter(ev => !(ev.t === 'period_start' && (ev.period === 2 || ev.period === 4))).map(ev => {
    const p = ev.period || 1;
    if (p > 4) return Object.assign(ev, { period: p - 2 });
    const first = p % 2 === 1;
    return Object.assign(ev, { period: p <= 2 ? 1 : 2, clock: (+ev.clock || 0) + (first ? 600000 : 0) });
  });
  x.period = 2;
  return x;
}
const stripped = src => { const x = clone(src); x.events = x.events.filter(ev => ev.t !== 'loc' && ev.t !== 'stype'); return x; };
/* the trailing side closes the gap with late threes, then an overtime */
function overtime(src) {
  const x = clone(src);
  const d = E.deriveGame(x);
  const lo = d.score[0] < d.score[1] ? 0 : 1, gap = Math.abs(d.score[0] - d.score[1]);
  let id = Math.max(...x.events.map(e => e.id)) + 1;
  x.events = x.events.filter(e => e.t !== 'game_end');
  const shooter = d.onCourt[lo][0], other = d.onCourt[1 - lo][0];
  let clock = 50000, left = gap;
  while (left > 0) {
    const v = left >= 3 ? 3 : 2;
    x.events.push({ t: v === 3 ? 'p3_made' : 'p2_made', team: lo, pid: shooter, id: id++, period: 4, clock });
    clock -= 4000; left -= v;
  }
  if (left < 0) x.events.push({ t: 'p2_made', team: 1 - lo, pid: other, id: id++, period: 4, clock: 2000 });
  x.events.push({ t: 'period_start', id: id++, period: 5, clock: 300000 });
  x.events.push({ t: 'p2_made', team: 0, pid: x.starters[0][0], id: id++, period: 5, clock: 280000 });
  x.events.push({ t: 'p2_made', team: 1, pid: x.starters[1][0], id: id++, period: 5, clock: 250000 });
  x.events.push({ t: 'p2_made', team: 0, pid: x.starters[0][1], id: id++, period: 5, clock: 200000 });
  x.events.push({ t: 'game_end', id: id++, period: 5, clock: 0 });
  x.period = 5; x.clockMs = 0;
  return x;
}

/* ------------------------------------------------------------- 1. layout --- */
console.log('\nthe layout');
ok('108 entries, indices 0..107 in order', F.N === 108 && F.LAYOUT.length === 108 && F.LAYOUT.every((x, i) => x.i === i));
ok('...with unique keys, and INDEX naming every one', new Set(F.LAYOUT.map(x => x.k)).size === 108 &&
   F.LAYOUT.every(x => I[x.k] === x.i));
ok('the anchors sit where §3.3 puts them', I.pts === 0 && I.rim_a === 13 && I.max_lead === 26 && I.poss === 27 && I.reb_def_ch === 42 &&
   I.sit_ch === 43 && I.fg3m_ast === 56 && I.to_n === 57 && I.fta_bonus === 70 && I.lead_changes === 71 && I.ot_periods === 80 &&
   I.cl_poss === 81 && I.g_poss === 87 && I.c_reb_def === 95 && I.players_used === 96 && I.starters_net === 104 &&
   I.events === 105 && I.sit_rim_a === 107);
ok('the box (0-26) is all public, nothing after it is', F.LAYOUT.every(x => x.pub === (x.i <= 26)));
ok('FV is 1, the bits are §3.4\'s', F.FV === 1 && Q.MARK === 1 && Q.ZONES === 4 && Q.TIMED === 8 && Q.SIT === 16 && Q.DENSE === 512);
ok('PUBLIC_KEYS are factors built from public counts only', F.PUBLIC_KEYS.every(k => {
  const fx = F.FACTORS.find(x => x.k === k);
  return fx && fx.pub && fx.uses.own.concat(fx.uses.opp).every(i => F.LAYOUT[i].pub);
}));
ok('every factor carries the §3.6 fields', F.FACTORS.every(x => ['k', 'label', 'grp', 'unit', 'dir', 'side', 'need', 'diff', 'score', 'pub', 'def']
  .every(k => k in x)) && new Set(F.FACTORS.map(x => x.k)).size === F.FACTORS.length);
ok('the constants: clutch 5 minutes, garbage 8:00/20 and 4:00/13, bonus 5 (quarters) and 7 (halves)',
   F.CLUTCH_MS === 300000 && JSON.stringify(F.GARBAGE) === '[[480000,20],[240000,13]]' && F.BONUS[4] === 5 && F.BONUS[2] === 7);

/* ------------------------------------------------------ 2. the four games --- */
const variants = { fixture: GAME, halves: halves(GAME), stripped: stripped(GAME), overtime: overtime(GAME) };
const outs = {};
for (const [name, game] of Object.entries(variants)) {
  console.log('\n' + name);
  const d = E.deriveGame(game);
  const TA = [E.teamAdv(game, d, 0), E.teamAdv(game, d, 1)];
  const out = F.extract(game, {});
  outs[name] = { out, d, TA, game };
  const boxKeys = { pts: 'pts', fga: 'fga', fgm: 'fgm', fg3a: 'fg3a', fg3m: 'fg3m', fta: 'fta', ftm: 'ftm', oreb: 'oreb', dreb: 'dreb',
                    tov: 'tov', ast: 'ast', stl: 'stl', blk: 'blk', rim_a: 'rimA', rim_m: 'rimM', mid_a: 'midA', mid_m: 'midM', poss_est: 'possessions' };
  const boxBad = [];
  [0, 1].forEach(t => Object.entries(boxKeys).forEach(([k, a]) => { if (!near(g(out, t, k), TA[t][a])) boxBad.push([t, k, g(out, t, k), TA[t][a]]); }));
  ok('box counts are teamAdv\'s', !boxBad.length, boxBad);
  ok('minutes are the game\'s length (teamAdv minutes / 5)', near(g(out, 0, 'minutes'), TA[0].minutes / 5) && g(out, 0, 'minutes') === g(out, 1, 'minutes'));
  const R = SC.compute({ events: game.events });
  ok('poss is the shot clock\'s possession count', [0, 1].every(t => g(out, t, 'poss') === R.possessions.filter(p => p.team === t).length),
     [g(out, 0, 'poss'), g(out, 1, 'poss')]);
  const av = SC.averages({ events: game.events });
  ok('timed_s / timed_n = ShotClock.averages (1e-9)', [0, 1].every(t => near(g(out, t, 'timed_s') / g(out, t, 'timed_n'), av[t])), av);
  const D0 = F.derive(out.f[0], out.f[1], out.q[0], out.q[1]), D1 = F.derive(out.f[1], out.f[0], out.q[1], out.q[0]);
  ok('time-of-possession shares sum to 1', name === 'stripped' && D0.top_share == null ? true : near(D0.top_share + D1.top_share, 1), [D0.top_share, D1.top_share]);
  ok('lead changes and ties are one value on both rows', g(out, 0, 'lead_changes') === g(out, 1, 'lead_changes') && g(out, 0, 'ties') === g(out, 1, 'ties'));
  ok('first half + second half + overtime = the score', [0, 1].every(t => g(out, t, 'pts_h1') + g(out, t, 'pts_h2') + g(out, t, 'pts_ot') === d.score[t]),
     [0, 1].map(t => [g(out, t, 'pts_h1'), g(out, t, 'pts_h2'), g(out, t, 'pts_ot'), d.score[t]]));
  ok('live turnovers never exceed turnovers, and turnovers are the box\'s', [0, 1].every(t => g(out, t, 'to_live') <= g(out, t, 'to_n') && g(out, t, 'to_n') === TA[t].tov));
  ok('clutch and garbage possessions are possessions', [0, 1].every(t => g(out, t, 'cl_poss') <= g(out, t, 'poss') && g(out, t, 'g_poss') <= g(out, t, 'poss')));
  ok('the line hangs together (valid)', F.valid(out.f[0]) && F.valid(out.f[1]));
  const floor = [0, 1].map(t => out.st[t].s.reduce((a, r) => a + r[0], 0));
  ok('A.1 stints: seconds add up to the side\'s floor time, five indexes each into its player list', [0, 1].every(t =>
    near(floor[t], g(out, t, 'minutes') * 60, 0.5 * out.st[t].s.length) && out.st[t].s.every(r => r.length === 6 && r.slice(1).every(i => i >= 0 && i < out.st[t].p.length))),
    floor);
  ok('...and the stints carry ids, never names', !JSON.stringify(out.st).includes(game.teams[0].players[0].name));
}

console.log('\nwhat each variant changes');
{
  const fx = outs.fixture.out, hv = outs.halves.out, sp = outs.stripped.out, ot = outs.overtime.out;
  ok('the fixture: every bit on both sides', fx.q.every(b => b === 1023), fx.q);
  ok('halves: regulation is 40 minutes either way, and the box is unchanged', g(hv, 0, 'reg_min') === 40 &&
     ['pts', 'fga', 'fta', 'tov'].every(k => g(hv, 0, k) === g(fx, 0, k) && g(hv, 1, k) === g(fx, 1, k)));
  ok('halves: the first half is the first two quarters', g(hv, 0, 'pts_h1') === g(fx, 0, 'pts_h1') && g(hv, 1, 'pts_h2') === g(fx, 1, 'pts_h2'));
  ok('halves: the bonus needs seven team fouls, so it comes no sooner than in quarters',
     g(hv, 0, 'trips_bonus') + g(hv, 1, 'trips_bonus') <= g(fx, 0, 'trips_bonus') + g(fx, 1, 'trips_bonus'),
     [g(hv, 0, 'trips_bonus'), g(hv, 1, 'trips_bonus'), g(fx, 0, 'trips_bonus'), g(fx, 1, 'trips_bonus')]);
  ok('stripped: MARK, TYPE and ZONES off on both sides', sp.q.every(b => !(b & Q.MARK) && !(b & Q.TYPE) && !(b & Q.ZONES)), sp.q);
  ok('...the rest of what the log supports still on (TIMED, SIT, FOULKIND, STARTERS, STL)', sp.q.every(b => (b & (Q.TIMED | Q.SIT | Q.FOULKIND | Q.STARTERS | Q.STL)) === (Q.TIMED | Q.SIT | Q.FOULKIND | Q.STARTERS | Q.STL)));
  const Ds = F.derive(sp.f[0], sp.f[1], sp.q[0], sp.q[1]);
  ok('...and its rim rate is null, its eFG% is not', Ds.rimr === null && Ds.rimp === null && typeof Ds.efg === 'number', [Ds.rimr, Ds.efg]);
  ok('stripped: no shot types, so turnover types are gone too (STYPE off)', sp.q.every(b => !(b & Q.STYPE)));
  ok('overtime: one overtime period, its points in pts_ot', g(ot, 0, 'ot_periods') === 1 && g(ot, 1, 'ot_periods') === 1 &&
     g(ot, 0, 'pts_ot') === 4 && g(ot, 1, 'pts_ot') === 2, [g(ot, 0, 'pts_ot'), g(ot, 1, 'pts_ot')]);
  ok('overtime: the comeback made clutch possessions, the fixture had none', g(ot, 0, 'cl_poss') > 0 && g(ot, 1, 'cl_poss') > 0 && g(fx, 0, 'cl_poss') === 0,
     [g(ot, 0, 'cl_poss'), g(ot, 1, 'cl_poss')]);
  ok('overtime: the side that came back took the lead in overtime (a lead change)', g(ot, 0, 'lead_changes') >= 1 && g(ot, 0, 'ties') >= 2);
  ok('overtime: minutes include the overtime', g(ot, 0, 'minutes') === 45);
}

/* ------------------------------------------------- 3. hand-built free throws --- */
console.log('\nfree-throw trips, and-ones and the bonus');
function handGame(halvesFormat) {
  const P = (t, n) => Array.from({ length: n }, (_, k) => ({ id: (t ? 'b' : 'a') + (k + 1), name: (t ? 'B' : 'A') + (k + 1), num: String(k + 1) }));
  const teams = [{ name: 'A', players: P(0, 7) }, { name: 'B', players: P(1, 7) }];
  const starters = [['a1', 'a2', 'a3', 'a4', 'a5'], ['b1', 'b2', 'b3', 'b4', 'b5']];
  const off = halvesFormat ? 600000 : 0;
  let id = 1;
  const ev = [];
  const e = (o) => ev.push(Object.assign({ id: id++, period: 1 }, o, { clock: o.clock + off }));
  e({ t: 'period_start', clock: 600000 });
  // an and-one: the basket, the foul on it, one free throw
  e({ t: 'p2_made', team: 0, pid: 'a1', clock: 590000 });
  e({ t: 'foul', team: 1, pid: 'b1', kind: 'shooting', clock: 590000 });
  e({ t: 'ft_made', team: 0, pid: 'a1', clock: 590000 });
  e({ t: 'p2_miss', team: 1, pid: 'b2', clock: 580000 });
  e({ t: 'reb', team: 0, pid: 'a2', off: false, clock: 579000 });
  // two free throws, an assist logged between them, the foul logged AFTER them
  e({ t: 'ft_made', team: 0, pid: 'a3', clock: 560000 });
  e({ t: 'ast', team: 0, pid: 'a4', clock: 560000 });
  e({ t: 'ft_miss', team: 0, pid: 'a3', clock: 560000 });
  e({ t: 'foul', team: 1, pid: 'b3', kind: 'shooting', clock: 560000 });
  e({ t: 'reb', team: 1, pid: 'b3', off: false, clock: 559000 });
  // team A's personal fouls; free throws on the fifth (quarters) or the seventh (halves)
  const fouls = halvesFormat ? 7 : 5;
  for (let k = 1; k <= fouls; k++) {
    e({ t: 'foul', team: 0, pid: 'a' + (((k - 1) % 5) + 1), kind: 'personal', clock: 550000 - k * 10000 });
    if (k === 5 || k === fouls) {
      e({ t: 'ft_made', team: 1, pid: 'b1', clock: 550000 - k * 10000 });
      e({ t: 'ft_made', team: 1, pid: 'b1', clock: 550000 - k * 10000 });
    }
  }
  // a live turnover (a steal beside it), a travel, an offensive foul
  e({ t: 'to', team: 1, pid: 'b2', clock: 450000 });
  e({ t: 'stl', team: 0, pid: 'a1', clock: 450000 });
  e({ t: 'p2_made', team: 0, pid: 'a1', clock: 445000 });
  e({ t: 'to', team: 1, pid: 'b4', clock: 430000 });
  e({ t: 'stype', ref: id - 1, v: 'travel', clock: 430000 });
  e({ t: 'foul', team: 0, pid: 'a2', kind: 'offensive', clock: 420000 });
  e({ t: 'to', team: 0, pid: 'a2', clock: 420000 });
  e({ t: 'p3_made', team: 1, pid: 'b5', clock: 400000 });
  const game = { teams, starters, events: ev, period: 1, clockMs: 0 + off };
  if (halvesFormat) game.format = { periods: 2, period_ms: 1200000, ot_ms: 300000 };
  return game;
}
{
  const out = F.extract(handGame(false), {});
  ok('A: two trips, one of them an and-one, one shooting trip (and-ones out)', g(out, 0, 'ft_trips') === 2 && g(out, 0, 'and1') === 1 && g(out, 0, 'trips_shooting') === 1,
     ['ft_trips', 'and1', 'trips_shooting'].map(k => g(out, 0, k)));
  ok('...the free throw logged before its foul still finds it (no trip left without a kind)', g(out, 0, 'trips_shooting') === 1);
  ok('B: the fifth personal foul in a quarter sends them to the line in the bonus', g(out, 1, 'ft_trips') === 1 && g(out, 1, 'trips_bonus') === 1 && g(out, 1, 'fta_bonus') === 2,
     ['ft_trips', 'trips_bonus', 'fta_bonus'].map(k => g(out, 1, k)));
  ok('the steal makes a live turnover, the travel a handling one', g(out, 1, 'to_live') === 1 && g(out, 1, 'to_handle') === 1 && g(out, 1, 'to_n') === 2 && g(out, 1, 'to_typed') === 1);
  ok('the offensive foul is a turnover by offensive foul', g(out, 0, 'to_offfoul') === 1 && g(out, 0, 'fouls_offensive') === 1);
  ok('shooting fouls by side', g(out, 1, 'fouls_shooting') === 2 && g(out, 0, 'fouls_shooting') === 0);
  ok('the and-one rate is per made field goal', near(F.derive(out.f[0], out.f[1], out.q[0], out.q[1]).and1_rate, 100 * 1 / g(out, 0, 'fgm')));
  const hv = F.extract(handGame(true), {});
  ok('in halves the fifth foul is not the bonus and the seventh is', g(hv, 1, 'ft_trips') === 2 && g(hv, 1, 'trips_bonus') === 1 && g(hv, 1, 'fta_bonus') === 2,
     ['ft_trips', 'trips_bonus', 'fta_bonus'].map(k => g(hv, 1, k)));
  ok('...and the halves game is read as halves (regulation 40 minutes)', g(hv, 0, 'reg_min') === 40);
}

/* ---------------------------------------------- 4. determinism and speed --- */
console.log('\ndeterministic and quick');
{
  const a = F.extract(GAME, {}), b = F.extract(clone(GAME), {});
  ok('the same log gives the same line, bit for bit', JSON.stringify(Array.from(a.f[0]).concat(Array.from(a.f[1]), a.q, a.st)) ===
     JSON.stringify(Array.from(b.f[0]).concat(Array.from(b.f[1]), b.q, b.st)));
  const d = E.deriveGame(GAME), TA = [E.teamAdv(GAME, d, 0), E.teamAdv(GAME, d, 1)], C = Sit.compute(GAME);
  const c = F.extract(GAME, { d, TA, C });
  ok('what finalise already holds (d, TA, C) gives the same line as working it all out', JSON.stringify(Array.from(c.f[0])) === JSON.stringify(Array.from(a.f[0])));
  for (let k = 0; k < 5; k++) F.extract(GAME, {});
  let t0 = performance.now();
  for (let k = 0; k < 20; k++) F.extract(GAME, {});
  const cold = (performance.now() - t0) / 20;
  t0 = performance.now();
  for (let k = 0; k < 20; k++) F.extract(GAME, { d, TA, C });
  const warm = (performance.now() - t0) / 20;
  console.log(`        ${cold.toFixed(2)} ms a game from the log alone, ${warm.toFixed(2)} ms with finalise's own replay`);
  ok('under 15 ms a game (everything worked out)', cold < 15, cold);
  ok('...and under 10 ms on top of what finalise already holds (the p95 budget; ~2 ms here)', warm < 10, warm);
}
{
  const thin = F.extract({ teams: [{ players: [] }, { players: [] }], starters: [[], []], events: [] }, {});
  ok('a game with no log does not throw, and vouches for nothing (no bits)', thin.q[0] === 0 && thin.q[1] === 0 && thin.f[0].length === 108);
  const noDeps = F.extract(GAME, { d: { team: null } });
  ok('...a broken replay leaves its sections NaN instead of throwing', Number.isNaN(noDeps.f[0][I.pts]) && noDeps.f.length === 2);
  ok('...and nothing at all is not a crash either', F.extract(null).f.length === 2);
}

/* ------------------------------------------------------------ 5. the rows --- */
console.log('\nthe rows');
{
  const out = F.extract(GAME, {});
  out.f[0][I.ties] = NaN; out.f[1][I.top_usg_share] = Infinity;
  const rows = F.toRows('g-1', out, { league_id: 'L', season_id: 'S', competition_id: 'C', finalised_at: '2026-10-01T00:00:00Z' });
  ok('two rows, team_idx 0 and 1, fv 1, the meta on both', rows.length === 2 && rows[0].team_idx === 0 && rows[1].team_idx === 1 && rows.every(r =>
     r.fv === 1 && r.game_id === 'g-1' && r.league_id === 'L' && r.season_id === 'S' && r.competition_id === 'C' && r.finalised_at === '2026-10-01T00:00:00Z'));
  ok('108 numbers a row, each to 4 significant figures', rows.every(r => r.f.length === 108) &&
     rows[0].f[I.timed_s] === +g(F.extract(GAME, {}), 0, 'timed_s').toPrecision(4) && rows[0].f[I.top5_min_share] === 0.7704, [rows[0].f[I.timed_s], rows[0].f[I.top5_min_share]]);
  ok('NaN and Infinity are stored as null', rows[0].f[I.ties] === null && rows[1].f[I.top_usg_share] === null);
  ok('the quality bits and the stints ride along', rows[0].q === out.q[0] && rows[0].st && Array.isArray(rows[0].st.s));
  const back = F.fromRow(rows[1]);
  ok('fromRow: a Float64Array of 108, null back to NaN', back instanceof Float64Array && back.length === 108 && Number.isNaN(back[I.top_usg_share]) && back[I.pts] === rows[1].f[I.pts]);
  ok('...and a short row is padded with NaN', Number.isNaN(F.fromRow({ f: [1, 2] })[107]) && F.fromRow({ f: [1, 2] })[1] === 2);
  ok('a row of every 0-26 count survives the trip within 4 significant figures', rows[0].f.slice(0, 27).every((v, i) => near(v, out.f[0][i], Math.abs(out.f[0][i]) * 5e-4)));
}

/* ------------------------------------------------------- 6. season sums --- */
console.log('\nseason sums');
{
  const games = [outs.fixture.out, outs.halves.out, outs.stripped.out];
  const pairs = games.map(o => ({ own: o.f[0], opp: o.f[1], qOwn: o.q[0], qOpp: o.q[1] }));
  const S = F.seasonFactors(pairs);
  const sum = (k, list) => list.reduce((a, o) => a + o.f[0][I[k]], 0);
  ok('eFG% is a ratio of sums over all three games', S.efg.n === 3 && near(S.efg.v, 100 * (sum('fgm', games) + 0.5 * sum('fg3m', games)) / sum('fga', games)), S.efg);
  const zoned = games.filter(o => o.q[0] & Q.ZONES);
  ok('the rim rate uses only the games that carry ZONES (the stripped one is masked out)', S.rimr.n === 2 && zoned.length === 2 &&
     near(S.rimr.v, 100 * sum('rim_a', zoned) / sum('fga', zoned)), S.rimr);
  const mixed = [outs.fixture.out.f, outs.overtime.out.f].map(f => ({ own: f[0], opp: f[1], qOwn: 1023, qOpp: 1023 }))
    .concat([{ own: outs.fixture.out.f[1], opp: outs.fixture.out.f[0], qOwn: 1023, qOpp: 1023 }]);
  const Sm = F.seasonFactors(mixed);
  const means = mixed.map(p => F.derive(p.own, p.opp, p.qOwn, p.qOpp).efg);
  const fgaM = mixed.reduce((a, p) => a + p.own[I.fga], 0), efM = mixed.reduce((a, p) => a + p.own[I.fgm] + 0.5 * p.own[I.fg3m], 0);
  ok('...never a mean of the games\' ratios (three different lines)', near(Sm.efg.v, 100 * efM / fgaM) && !near(Sm.efg.v, means.reduce((a, b) => a + b, 0) / 3, 1e-6),
     [Sm.efg.v, means]);
  ok('a per-game factor is the sum over the games used', near(S.paint.v, sum('pts_paint', games) / 3));
  ok('a mean field is averaged (max lead)', near(S.max_lead.v, sum('max_lead', games) / 3));
  const def = F.seasonFactors(games.map(o => ({ own: o.f[1], opp: o.f[0], qOwn: o.q[1], qOpp: o.q[0] })));
  ok('swapping the pairs gives the defence (eFG% allowed)', near(def.efg.v, 100 * (games.reduce((a, o) => a + o.f[1][I.fgm] + 0.5 * o.f[1][I.fg3m], 0)) / games.reduce((a, o) => a + o.f[1][I.fga], 0)));
  ok('a factor with no usable game is null with n 0', F.seasonFactors([{ own: outs.stripped.out.f[0], opp: outs.stripped.out.f[1], qOwn: outs.stripped.out.q[0], qOpp: outs.stripped.out.q[1] }]).rimr.n === 0);
}

/* --------------------------------------------- 7. the Edge Function's copy --- */
console.log('\nthe Edge Function copy');
{
  const shared = readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'features.js'), 'utf8');
  ok('the shared copy is the browser file plus the generated tail', shared.includes(readFileSync(path.join(ROOT, 'epinoia', 'features.js'), 'utf8')) &&
     /export const \{ FV, LAYOUT, INDEX, QBITS, FACTORS, PUBLIC_KEYS/.test(shared));
  /* the Deno order: the calculators as globals first, then the line */
  for (const f of ['engine.js', 'possessions.js', 'situations.js', 'shotclock.js']) await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', f)).href);
  const M = await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'features.js')).href);
  const a = M.extract(GAME, {}), b = F.extract(GAME, {});
  ok('...and gives the same line from globals as the node module gives from require', JSON.stringify(Array.from(a.f[1])) === JSON.stringify(Array.from(b.f[1])) && a.q.join() === b.q.join());
}

/* ----------------------------------------------------- 8. the backfill's half --- */
console.log('\nthe backfill (scripts/backfill_features.mjs, pure half)');
{
  const { planFeatures, parseArgs, gameOf } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'backfill_features.mjs')).href);
  const { mapEvents } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'backfill_situations.mjs')).href);
  const d = E.deriveGame(GAME);
  /* the fixture as it is stored: a games row and its log rows (payload beside the columns) */
  const logRows = GAME.events.map(ev => { const { id, t, team, pid, period, clock, ...payload } = ev; return { seq: id, t, team, pid, period, clock, payload }; });
  const row = { id: 'g-1', status: 'final', period: 4, starters: GAME.starters, roster_snapshot: { teams: GAME.teams }, competition_id: 'C',
                finalised_at: '2026-09-30T20:00:00Z', home_score: d.score[0], away_score: d.score[1], tip_winner: GAME.tipWinner, arrow_init: GAME.arrowInit };
  const meta = { league_id: 'L', season_id: 'S' };
  const plan = planFeatures({ row, events: mapEvents(logRows), meta });
  const direct = F.toRows('g-1', F.extract(GAME, {}), { league_id: 'L', season_id: 'S', competition_id: 'C', finalised_at: '2026-09-30T20:00:00Z' });
  ok('the backfill writes exactly the rows finalise would (mapEvents, the same extract, the game\'s finalised_at)', !plan.skip && JSON.stringify(plan.rows) === JSON.stringify(direct));
  ok('...a game without a roster snapshot is skipped and named', planFeatures({ row: Object.assign({}, row, { roster_snapshot: null }), events: [], meta }).skip === 'no roster snapshot or starters');
  ok('...a game without events too', planFeatures({ row, events: [], meta }).skip === 'no events');
  const off = planFeatures({ row: Object.assign({}, row, { home_score: row.home_score + 2 }), events: mapEvents(logRows), meta });
  ok('...and one whose replayed score differs from the stored one, with both scores in the note', off.skip === 'replayed score differs' && /re-finalise/.test(off.detail), off);
  ok('...and one whose competition has no season', planFeatures({ row, events: mapEvents(logRows), meta: null }).skip === 'no season or league for its competition');
  const a = parseArgs(['--dry', '--league', 'cebl', '--since', '2026-09-01', '--max-minutes', '30', '--lanes', '2', '--force', '0A000000-0000-4000-8000-000000000001']);
  ok('the flags: --dry, --league, --since, --max-minutes, --lanes, --force and one game id', a.dry && a.league === 'cebl' && a.since === '2026-09-01' && a.maxMinutes === 30 &&
     a.lanes === 2 && a.force && a.game === '0a000000-0000-4000-8000-000000000001' && parseArgs([]).maxMinutes === 45 && parseArgs([]).lanes === 4);
  ok('gameOf is finalise\'s game object', gameOf(row, []).teams === row.roster_snapshot.teams && gameOf(row, []).clockMs === 0 && gameOf(row, []).period === 4);
  const src = readFileSync(path.join(ROOT, 'scripts', 'backfill_features.mjs'), 'utf8');
  ok('it reads the log as finalise does (paged by seq, mapEvents imported from backfill_situations.mjs) and upserts merge-duplicates',
     /import \{ mapEvents \} from '\.\/backfill_situations\.mjs'/.test(src) && /select=seq,t,team,pid,period,clock,payload&order=seq&seq=gt\./.test(src) &&
     /resolution=merge-duplicates/.test(src) && /rpc\('game_features_missing', \{ p_fv: F\.FV, p_limit/.test(src));
  const wf = readFileSync(path.join(ROOT, '.github', 'workflows', 'backfill-features.yml'), 'utf8');
  ok('the workflow: manual, dry run by default, game, league, force and max_minutes, its own concurrency, node 24, 120 minutes',
     /workflow_dispatch:/.test(wf) && !/schedule:/.test(wf) && /dry_run:[\s\S]*?default: true/.test(wf) && /game_id:/.test(wf) && /league:/.test(wf) && /force:/.test(wf) &&
     /max_minutes:/.test(wf) && /group: backfill-features/.test(wf) && /node-version: '24'/.test(wf) && /timeout-minutes: 120/.test(wf));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
