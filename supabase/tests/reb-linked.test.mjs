/* ============================================================================
   LINKED EVENTS: a rebound is the result of the miss before it.

   The engine's per-player rebound counters (rbTm, rbTmO, rbSf, rbSfO), the opponent
   rim counters while a player is on the floor (oc.oRimA / oc.oRimM), what season.js
   makes of them (coverage per player, null and never zero), and the backfill's plan.
   A hand-built log where every number can be worked out by eye:

     node supabase/tests/reb-linked.test.mjs
   ============================================================================ */
import path from 'node:path';
import * as nodeModule from 'node:module';
import fs from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = nodeModule.createRequire(import.meta.url);
const E = require(path.join(ROOT, 'epinoia', 'engine.js'));
const SE = require(path.join(ROOT, 'epinoia', 'season.js'));
const B = await import(new URL('../../scripts/backfill_player_reb.mjs', import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

const pl = (t, i) => ({ id: (t ? 'a' : 'h') + i, name: (t ? 'A' : 'H') + i, num: String(i) });
const teams = [{ name: 'Home', players: [1, 2, 3, 4, 5, 6].map(i => pl(0, i)) },
               { name: 'Away', players: [1, 2, 3, 4, 5, 6].map(i => pl(1, i)) }];
const starters = [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']];
const RIM = { x: 0.5, y: 157.5 / 1400 }, FAR = { x: 0.5, y: 0.6 };

/* build a log: each play gets the next id and a falling clock; a loc descriptor follows its shot */
function log() {
  const evs = []; let id = 0, clock = 600000;
  const add = (o) => { evs.push(Object.assign({ id: ++id, period: 1, clock }, o)); clock -= 1000; return id; };
  const shot = (t, team, pid, at) => { const i = add({ t, team, pid }); if (at) evs.push({ t: 'loc', ref: i, x: at.x, y: at.y, id: ++id, period: 1, clock: clock + 1000 }); return i; };
  add({ t: 'period_start' });
  shot('p3_miss', 0, 'h3'); add({ t: 'reb', team: 0, pid: 'h5', off: true });          // teammate miss, starter ORB
  shot('p2_miss', 0, 'h5'); add({ t: 'reb', team: 0, pid: 'h5', off: true });          // own miss, putback board
  shot('p2_miss', 0, 'h2'); add({ t: 'reb', team: 0, pid: null, off: true });          // team rebound: denominator only
  shot('p2_miss', 0, 'h2'); add({ t: 'ft_miss', team: 0, pid: 'h2' });                 // miss then a missed free throw ...
  add({ t: 'reb', team: 0, pid: 'h4', off: true });                                    // ... the board belongs to the FT
  shot('p2_miss', 1, 'a1', RIM); add({ t: 'reb', team: 0, pid: 'h5', off: false });    // a defensive board off a rim miss
  shot('p2_miss', 1, 'a2', RIM);                                                        // a rim miss, no rebound recorded
  add({ t: 'to', team: 1, pid: 'a2' });
  shot('p2_made', 1, 'a3', FAR);                                                        // mid-range: not a rim shot
  add({ t: 'sub', team: 0, in: 'h6', out: 'h5' });
  shot('p2_made', 1, 'a4', RIM); shot('p2_made', 1, 'a1', RIM);
  shot('p2_miss', 0, 'h6'); add({ t: 'reb', team: 0, pid: 'h6', off: true });          // bench player's own-miss board
  shot('p3_miss', 0, 'h1'); add({ t: 'reb', team: 0, pid: 'h6', off: true });          // bench player takes a teammate's miss
  return evs;
}
const game = () => ({ teams, starters, events: log(), period: 1, clockMs: 0 });
const d = E.deriveGame(game());
const S = id => d.stats[id];
const rb = id => [S(id).rbTm, S(id).rbTmO, S(id).rbSf, S(id).rbSfO];

/* the five before the sub: h1-h5. h5 was on for: h3 miss, own miss, h2 miss (team reb) => 2 team, 1 orb, 1 own, 1 orb */
eq('starter h5: team misses / offensive boards / own / own boards', rb('h5'), [2, 1, 1, 1]);
/* h3 (on all game): teammates' misses that got a rebound: h5, h2, h6, h1 = 4; his own, rebounded by h5 = 1 */
eq('h3: four teammate misses, own miss rebounded by a teammate', rb('h3'), [4, 0, 1, 0]);
/* the FT-miss rebound is not the miss's rebound: h4 saw three resolved misses and grabbed none of them */
eq('h4: five resolved misses, no boards (the ft rebound is not counted)', rb('h4'), [5, 0, 0, 0]);
eq('h2: own miss resolved by a team rebound is a denominator only', rb('h2'), [4, 0, 1, 0]);
/* h1 is on all game: team misses = h3, h5, h2 before, then h6's own miss => 4; own h1 miss 1 (bench board) */
eq('h1: teammate misses 4, own 1', rb('h1'), [4, 0, 1, 0]);
/* h6 arrives late: sees h6's own miss (rbSf) and h1's miss (rbTm); takes both */
eq('bench h6: own-miss putback and a teammate’s miss', rb('h6'), [1, 1, 1, 1]);
ok('h5 (subbed out) never sees the late misses', S('h5').rbTm === 2);
eq('a1: his own miss resolved by the other side', rb('a1'), [0, 0, 1, 0]);
eq('a2: sees a1 miss; the turnover-ended miss has no outcome', rb('a2'), [1, 0, 0, 0]);
ok('a defensive rebound is not an offensive one', S('h5').rbTmO === 1 && S('h5').rbSfO === 1);

/* rim defence: a1, a2 took rim shots before the sub, a4 and a1 made two after it; a3's was mid-range */
const oc = id => [S(id).oc.oRimA, S(id).oc.oRimM];
eq('h5 on for two rim tries, none made', oc('h5'), [2, 0]);
eq('h6 on for two rim shots, both made', oc('h6'), [2, 2]);
eq('h1 on all game: four rim shots, two made', oc('h1'), [4, 2]);
eq('the shooters’ own team collects no opponent rim counts', oc('a1'), [0, 0]);
ok('every counter is a plain number', ['rbTm', 'rbTmO', 'rbSf', 'rbSfO'].every(k => typeof S('h5')[k] === 'number') && typeof S('h5').oc.oRimA === 'number');

/* the generated Edge Function copy runs the same numbers */
const genSrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/engine.js'), 'utf8');
const G = await import('data:text/javascript;base64,' + Buffer.from(genSrc).toString('base64'));
eq('the Edge Function engine agrees', G.deriveGame(game()).stats.h5.rbTm, 2);

/* ---- season.js: coverage per player, null and never zero ---- */
function rows(n, strip) {
  const pgs = [], tgs = [];
  for (let g = 0; g < n; g++) {
    const gm = game(), dd = E.deriveGame(gm);
    const TA = [E.teamAdv(gm, dd, 0), E.teamAdv(gm, dd, 1)];
    [0, 1].forEach(t => {
      tgs.push({ game_id: 'g' + g + strip, team_idx: t, stats: { adv: TA[t], score: dd.score[t] } });
      teams[t].players.forEach(p => {
        const s = JSON.parse(JSON.stringify(dd.stats[p.id]));
        if (strip === 'old') { ['rbTm', 'rbTmO', 'rbSf', 'rbSfO'].forEach(k => delete s[k]); delete s.oc.oRimA; delete s.oc.oRimM; }
        pgs.push({ game_id: 'g' + g + strip, player_id: p.id, team_idx: t, stats: s });
      });
    });
  }
  return { pgs, tgs };
}
const pick = (R, id) => SE.players(R.pgs, R.tgs).find(r => r.id === id);
const NEW = rows(20, 'new'), OLD = rows(20, 'old');
const a = pick(NEW, 'h5');
eq('orb on team misses: 20 games x (1 of 2)', a.orb_tm_pct, 50);
eq('orb on own misses: 20 of 20', a.orb_self_pct, 100);
ok('rim fg% on 0 / off 100 (2 of 2 after he left... on 0 of 2)', a.def_rim_fg_on === 0 && a.def_rim_fg_pm === a.def_rim_fg_on - a.def_rim_fg_off, JSON.stringify([a.def_rim_fg_on, a.def_rim_fg_off, a.def_rim_fg_pm]));
ok('rim volume on/off/diff are numbers', [a.def_rim_vol_on, a.def_rim_vol_off, a.def_rim_vol_pm].every(v => typeof v === 'number' && isFinite(v)), JSON.stringify([a.def_rim_vol_on, a.def_rim_vol_off]));
const o = pick(OLD, 'h5');
ok('games with no stored fields give null, never zero',
   [o.orb_tm_pct, o.orb_self_pct, o.def_rim_fg_pm, o.def_rim_vol_pm, o.def_rim_fg_on, o.def_rim_fg_off].every(v => v === null));
const MIX = { pgs: NEW.pgs.concat(OLD.pgs), tgs: NEW.tgs.concat(OLD.tgs) };
const m = pick(MIX, 'h5');
eq('a mixed season counts only the covered games', [m.orb_tm_pct, m.orb_self_pct, m.def_rim_fg_pm, m.def_rim_vol_pm],
   [a.orb_tm_pct, a.orb_self_pct, a.def_rim_fg_pm, a.def_rim_vol_pm]);
const few = pick(rows(2, 'new'), 'h5');
ok('under the sample guards the numbers are null', few.orb_tm_pct === null && few.def_rim_fg_pm === null && few.def_rim_vol_pm === null,
   JSON.stringify([few.orb_tm_pct, few.def_rim_fg_pm]));

/* ---- the backfill plan ---- */
const g0 = { id: '00000000-0000-0000-0000-000000000001', roster_snapshot: { teams }, starters };
const evs = log().map(e => ({ seq: e.id, t: e.t, team: e.team, pid: e.pid, period: e.period, clock: e.clock,
  payload: Object.fromEntries(Object.entries(e).filter(([k]) => !['id', 't', 'team', 'pid', 'period', 'clock'].includes(k))) }));
const events = B.mapEvents(evs);
const stored = 'h5';
const playerRows = [{ player_id: stored, team_idx: 0, stats: { pts: 7, min: 123, oc: { tFGA: 9 }, adv: { x: 1 } } }];
const teamRows = [{ team_idx: 0, stats: { score: d.score[0] } }, { team_idx: 1, stats: { score: d.score[1] } }];
const plan = B.planGame({ game: g0, events, playerRows, teamRows });
ok('plan patches the row', plan.patches.length === 1 && !plan.skip, JSON.stringify(plan));
const body = plan.patches[0] && plan.patches[0].body.stats;
ok('only the new fields change; the rest is sent back as it was',
   body && body.pts === 7 && body.min === 123 && body.oc.tFGA === 9 && body.adv.x === 1 &&
   body.rbTm === 2 && body.rbTmO === 1 && body.rbSf === 1 && body.rbSfO === 1 && body.oc.oRimA === 2 && body.oc.oRimM === 0);
const again = B.planGame({ game: g0, events, playerRows: [{ player_id: stored, team_idx: 0, stats: body }], teamRows });
eq('a row that is already right is left alone', again.patches.length, 0);
eq('--force rewrites it', B.planGame({ game: g0, events, playerRows: [{ player_id: stored, team_idx: 0, stats: body }], teamRows, force: true }).patches.length, 1);
const bad = B.planGame({ game: g0, events, playerRows, teamRows: [{ team_idx: 0, stats: { score: 999 } }] });
ok('a log that does not match the stored score is refused', bad.skip === 'log and box score disagree' && !bad.patches.length);
eq('no roster snapshot is skipped', B.planGame({ game: { id: 'x' }, events, playerRows, teamRows }).skip, 'no roster snapshot');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
