/* ============================================================================
   epinoia/game/dyntable.js — the box score's DYNAMIC TABLES tab.

   The projection lays games in progress over the official standings rows and
   ranks with recompute_standings's own keys (league points, point difference,
   points for). Under test: the projected order and each club's movement, a
   level score (no result), several live games at once, a live game between two
   clubs that both move, the tie-break, conference records, and the tab's place
   in game.js (after lineups, not in the advanced or gated lists).
   ============================================================================ */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = require(path.join(HERE, '..', '..', 'epinoia', 'game', 'dyntable.js'));
const js = readFileSync(path.join(HERE, '..', '..', 'epinoia', 'game', 'game.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

const t = (id, name, w, l, pf, pa, extra) => Object.assign({
  team_id: id, gp: w + l, w, l, pts_for: pf, pts_against: pa, league_points: 2 * w + l, group_name: null,
  rank: null, teams: { name }
}, extra || {});
/* A 3-1 (7), B 2-2 (6, +10), C 2-2 (6, +5), D 1-3 (5) */
const base = () => [t('A', 'Alpha', 3, 1, 400, 380), t('B', 'Bravo', 2, 2, 390, 380), t('C', 'Cedar', 2, 2, 385, 380), t('D', 'Delta', 1, 3, 350, 400)];
const order = P => P.rows.map(r => r.team_id).join('');
const mv = (P, id) => P.rows.find(r => r.team_id === id).move;

ok('no live games: the projection is the official table, nobody moves', () => {
  const P = D.project(base(), []);
  assert.equal(order(P), 'ABCD');
  assert.ok(P.rows.every(r => r.move === 0 && r.off === r.pos));
});
ok('one live game: the winner takes 2 points, the loser 1, and the table re-orders', () => {
  /* C beats B 80-70: C 8 pts, B 7 pts (2-3 -> 1 more loss point) */
  const P = D.project(base(), [{ id: 'g1', home_team_id: 'B', away_team_id: 'C', home_score: 70, away_score: 80 }]);
  const c = P.rows.find(r => r.team_id === 'C'), b = P.rows.find(r => r.team_id === 'B');
  assert.equal(c.pts, 8); assert.equal(b.pts, 7);
  assert.equal(c.w, 3); assert.equal(b.l, 3); assert.equal(c.gp, 5);
  assert.equal(order(P), 'CABD');       // C 8, then A and B level on 7: A's +20 beats B's
  assert.equal(mv(P, 'C'), 2); assert.equal(mv(P, 'A'), -1); assert.equal(mv(P, 'B'), -1);
  assert.deepEqual(c.touched, ['g1']);
});
ok('a live game between two clubs moves both: the winner climbs, the loser drops, a bystander is pushed down', () => {
  const P = D.project(base(), [{ id: 'g1', home_team_id: 'B', away_team_id: 'D', home_score: 40, away_score: 100 }]);
  assert.equal(order(P), 'ADBC');
  assert.equal(mv(P, 'D'), 2); assert.equal(mv(P, 'B'), -1); assert.equal(mv(P, 'C'), -1); assert.equal(mv(P, 'A'), 0);
});
ok('several live games are all applied, and each club records the game that touches it', () => {
  const P = D.project(base(), [
    { id: 'g1', home_team_id: 'A', away_team_id: 'D', home_score: 50, away_score: 90 },
    { id: 'g2', home_team_id: 'B', away_team_id: 'C', home_score: 71, away_score: 70 }]);
  assert.equal(P.applied.length, 2);
  assert.deepEqual(P.rows.find(r => r.team_id === 'D').touched, ['g1']);
  assert.deepEqual(P.rows.find(r => r.team_id === 'B').touched, ['g2']);
  assert.equal(P.rows.find(r => r.team_id === 'A').pts, 8);     // 7 + a loss point
  assert.equal(P.rows.find(r => r.team_id === 'D').pts, 7);     // 5 + a win
});
ok('a level score is not a result: listed, marks the clubs, changes nothing', () => {
  const P = D.project(base(), [{ id: 'g1', home_team_id: 'B', away_team_id: 'C', home_score: 55, away_score: 55 }]);
  assert.equal(P.level.length, 1); assert.equal(P.applied.length, 0);
  assert.equal(order(P), 'ABCD');
  assert.ok(P.rows.every(r => r.move === 0));
  assert.equal(P.rows.find(r => r.team_id === 'B').gp, 4);
  assert.deepEqual(P.rows.find(r => r.team_id === 'B').touched, ['g1']);
});
ok('clubs level on points are split by the league\'s own tie-break: point difference, then points scored', () => {
  /* B (+10) above C (+5), level on 6 */
  assert.equal(order(D.project(base(), [])).slice(1, 3), 'BC');
  const rows = [t('X', 'X', 2, 2, 400, 390), t('Y', 'Y', 2, 2, 410, 400), t('Z', 'Z', 2, 2, 390, 380)];
  /* all +10, all 6: points scored decides: Y, X, Z */
  assert.equal(order(D.project(rows, [])), 'YXZ');
  /* still level on everything: the stored rank, then the name */
  const eq = [t('P', 'Pine', 1, 1, 100, 100, { rank: 2 }), t('Q', 'Quay', 1, 1, 100, 100, { rank: 1 })];
  assert.equal(order(D.project(eq, [])), 'QP');
});
ok('games with a missing score, or a club outside the table, are skipped without a throw', () => {
  const P = D.project(base(), [{ id: 'g1', home_team_id: 'A', away_team_id: 'Q', home_score: 1, away_score: 0 },
    { id: 'g2', home_team_id: 'A', away_team_id: 'B', home_score: null, away_score: 0 }]);
  assert.equal(P.skipped.length, 2); assert.equal(order(P), 'ABCD');
});
ok('the league\'s own points rule is used (3-for-a-win, 0 for a loss)', () => {
  const P = D.project(base(), [{ id: 'g1', home_team_id: 'B', away_team_id: 'C', home_score: 70, away_score: 80 }], { winPoints: 3, lossPoints: 0 });
  assert.equal(P.rows.find(r => r.team_id === 'C').pts, 9); assert.equal(P.rows.find(r => r.team_id === 'B').pts, 6);
});
ok('groups are ranked apart, and a game across two groups moves each inside its own table', () => {
  const rows = [t('A', 'A', 3, 0, 300, 250, { group_name: 'Nord' }), t('B', 'B', 2, 1, 300, 280, { group_name: 'Nord' }),
    t('C', 'C', 2, 1, 300, 280, { group_name: 'Sud' }), t('D', 'D', 1, 2, 250, 300, { group_name: 'Sud' })];
  const P = D.project(rows, [{ id: 'g', home_team_id: 'B', away_team_id: 'C', home_score: 90, away_score: 80 }]);
  assert.equal(P.rows.filter(r => r.pos === 1).length, 2);
  assert.equal(P.rows.find(r => r.team_id === 'B').pos, 1); assert.equal(P.rows.find(r => r.team_id === 'B').move, 1);
  assert.equal(P.rows.find(r => r.team_id === 'A').pos, 2);
  assert.equal(P.rows.find(r => r.team_id === 'C').pos, 1);
});
ok('a conference table is ranked by the conference record, and only a conference game moves it', () => {
  const c = (id, name, w, l, cw, cl, grp) => t(id, name, w, l, 300 + w, 300 + l, { group_name: grp, division_name: null, conf_gp: cw + cl, conf_w: cw, conf_l: cl });
  const rows = [c('A', 'A', 10, 5, 6, 4, 'East'), c('B', 'B', 9, 6, 7, 3, 'East'), c('X', 'X', 12, 3, 2, 1, 'West')];
  assert.equal(order(D.project(rows, [], { conferences: true })).slice(0, 2), 'BA');
  const P = D.project(rows, [{ id: 'g', home_team_id: 'A', away_team_id: 'B', home_score: 80, away_score: 70 }], { conferences: true });
  const a = P.rows.find(r => r.team_id === 'A'), b = P.rows.find(r => r.team_id === 'B');
  assert.equal(a.cw, 7); assert.equal(b.cl, 4);                    // 7-4 v 7-4: A takes it on overall record
  /* not a conference game (feed says so): only the overall record moves */
  const Q = D.project(rows, [{ id: 'g', home_team_id: 'A', away_team_id: 'B', home_score: 80, away_score: 70, conference_game: false }], { conferences: true });
  assert.equal(Q.rows.find(r => r.team_id === 'A').cw, 6);
  assert.equal(Q.rows.find(r => r.team_id === 'A').w, 11);
});
ok('the input rows are not mutated', () => {
  const rows = base(); const snap = JSON.stringify(rows);
  D.project(rows, [{ id: 'g1', home_team_id: 'B', away_team_id: 'C', home_score: 70, away_score: 80 }]);
  assert.equal(JSON.stringify(rows), snap);
});
ok('period and clock read as the scoreboard does', () => {
  assert.equal(D.periodLabel(3, 4), 'Q3'); assert.equal(D.periodLabel(5, 4), 'OT1'); assert.equal(D.periodLabel(2, 2), 'H2');
  assert.equal(D.clockLabel(252000), '4:12'); assert.equal(D.clockLabel(9400), '9.4'); assert.equal(D.clockLabel(0), '0.0');
});
ok('a pure knockout has no table; a league, groups and conferences do', () => {
  assert.equal(D.hasTable({ format: 'knockout' }), false);
  assert.ok(['table', 'groups', 'conferences', 'groups_knockout'].every(f => D.hasTable({ format: f })));
  assert.equal(D.hasTable(null), false);
});

/* ---- the tab list in game.js ---- */
const tabs = eval('(' + /const TABS = (\[[\s\S]*?\]);\n/.exec(js)[1] + ')');
const ids = tabs.map(x => x[0]);
const adv = eval('(' + /const ADV_TABS = (\[[^\]]*\])/.exec(js)[1] + ')');
const gated = eval('(' + /const GATED_TABS_DEFAULT = (\[[^\]]*\])/.exec(js)[1] + ')');
ok("TABS has ['dyn','dynamic tables'] straight after lineups", () => {
  assert.deepEqual(tabs[ids.indexOf('lineups') + 1], ['dyn', 'dynamic tables']);
});
ok('the tab is not in the advanced stats group or the members\' gated lists', () => {
  assert.ok(!adv.includes('dyn')); assert.ok(!gated.includes('dyn'));
  assert.ok(!/gameTabs[^\n]*dyn/.test(js));
});
ok('the body and the mount are wired, and the page loads the module after the stylesheet-free order', () => {
  assert.ok(/dyn:\s+d => window\.EpinoiaDynTable \? window\.EpinoiaDynTable\.render\(/.test(js));
  assert.ok(/fTab === 'dyn' && window\.EpinoiaDynTable\) window\.EpinoiaDynTable\.mounted\(el\)/.test(js));
  const html = readFileSync(path.join(HERE, '..', '..', 'epinoia', 'game', 'index.html'), 'utf8');
  assert.ok(/dyntable\.css/.test(html) && /dyntable\.js/.test(html));
  assert.ok(html.indexOf('dyntable.css') < html.indexOf('kit/legibility.css'));
  assert.ok(html.lastIndexOf('<link rel="stylesheet"') === html.indexOf('<link rel="stylesheet" href="../kit/legibility.css'));
});

console.log('\nthe points scheme is read off the official rows (a loss worth 0 included)');
{
  const row = (id, w, l, lp, ded) => ({ team_id: id, gp: w + l, w, l, league_points: lp, deducted_points: ded || 0, diff: 0, pts_for: 0, pts_against: 0 });
  const two1 = [row('A', 3, 1, 7), row('B', 2, 2, 6), row('C', 1, 3, 5), row('D', 0, 4, 4)];
  const two0 = [row('A', 3, 1, 6), row('B', 2, 2, 4), row('C', 1, 3, 2), row('D', 0, 4, 0)];
  let s = D.inferScheme(two1, { win_points: 2, loss_points: 0 });
  ok('rows built 2/1 under a rule now saying 2/0: the rows win (no phantom moves before the recompute)', () => assert.ok(s.win === 2 && s.loss === 1));
  s = D.inferScheme(two0, { win_points: 2, loss_points: 1 });
  ok('rows built 2/0 under a rule still saying 2/1: 2/0', () => assert.ok(s.win === 2 && s.loss === 0));
  s = D.inferScheme(two0, { win_points: 2, loss_points: 0 });
  ok('rows and rules agree on a loss worth 0: 2/0 (zero is a value, not a missing one)', () => assert.ok(s.win === 2 && s.loss === 0));
  s = D.inferScheme(two0, {});
  ok('no rules at all: read from the rows', () => assert.ok(s.win === 2 && s.loss === 0));
  s = D.inferScheme([row('A', 1, 0, 2)], { win_points: 2, loss_points: 0 });
  ok('too few rows played to tell: the rules', () => assert.ok(s.win === 2 && s.loss === 0));
  s = D.inferScheme([row('A', 3, 1, 5, 2), row('B', 2, 2, 4), row('C', 1, 3, 2), row('D', 0, 4, 0)], { win_points: 2, loss_points: 0 });
  ok('a points deduction is added back before fitting', () => assert.ok(s.win === 2 && s.loss === 0));
  const live = [{ id: 'g', home_team_id: 'D', away_team_id: 'A', home_score: 90, away_score: 80 }];
  const P = D.project(two0, live, { winPoints: 2, lossPoints: 0 });
  const rowOf = id => P.rows.find(x => x.team_id === id);
  ok('projection under 2/0: the live winner gains 2 and the live loser gains nothing', () => assert.ok(rowOf('D').pts === 2 && rowOf('A').pts === 6));
}


console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
