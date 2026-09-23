/* ============================================================================
   epinoia/standings.js — how a table is split and read (0144).

   The data here is U SPORTS men's basketball, 2025-26, laid out the way the
   league's own standings are (captured 2026-09-23): four conferences, two of
   them split into divisions — Canada West Pacific / Prairie, OUA Central /
   East / West — and AUS and RSEQ undivided. The records are invented but the
   shapes are real: three divisions in one conference, RSEQ's five clubs, a
   club still to play a conference game.

   The rules under test:
     - an ungrouped league asks for exactly the columns it always did, and the
       conference columns are asked for only on a 'conferences' competition
       (a column PostgREST does not know fails the whole read, and the columns
       only exist once 0144 is applied)
     - conferences come out in name order, divisions inside them, rows in the
       stored rank — nothing here re-ranks a conference table
     - the Overall view ranks the whole league by the complete schedule, the
       way recompute_standings ranks the overall record, and shares a place
       only when two clubs are level on every key
     - a college percentage prints as .750 / 1.000 / .000, and a club with no
       games has none
   ============================================================================ */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = require(path.join(HERE, '..', '..', 'epinoia', 'standings.js'));

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

const conf = { id: 'c1', format: 'conferences' };
const table = { id: 'c2', format: 'table' };
const groups = { id: 'c3', format: 'groups' };

/* a row as PostgREST hands it back */
const row = (name, group, division, rank, w, l, cw, cl, diff, pf) => ({
  rank, gp: w + l, w, l, diff, pts_for: pf, pts_against: pf - diff, league_points: 2 * w + l,
  streak: '', group_name: group, division_name: division,
  conf_gp: cw + cl, conf_w: cw, conf_l: cl,
  teams: { name, short_name: name.slice(0, 3).toUpperCase() }
});

const rows = [
  row('Acadia', 'AUS', null, 2, 19, 15, 12, 8, 60, 2600),
  row('St. Francis Xavier', 'AUS', null, 1, 19, 10, 17, 3, 90, 2400),
  row('Cape Breton', 'AUS', null, 3, 13, 11, 10, 10, 10, 1900),
  row('Victoria', 'Canada West', 'Pacific', 1, 26, 4, 18, 2, 300, 2500),
  row('UBC', 'Canada West', 'Pacific', 2, 22, 7, 16, 4, 200, 2400),
  row('Winnipeg', 'Canada West', 'Prairie', 1, 22, 5, 17, 3, 190, 2200),
  row('Carleton', 'OUA', 'East', 1, 27, 9, 17, 5, 400, 3000),
  row('TMU', 'OUA', 'Central', 1, 30, 7, 19, 3, 350, 3100),
  row('Western', 'OUA', 'West', 1, 23, 6, 18, 4, 250, 2400),
  row('Bishop\'s', 'RSEQ', null, 1, 24, 5, 14, 2, 280, 2300),
  row('McGill', 'RSEQ', null, 5, 0, 0, 0, 0, 0, 0)
];

console.log('\nwhat a table asks for');
ok('an ungrouped league asks for exactly the columns it always did', () => {
  assert.equal(S.columns(table, 'name'),
    'rank,gp,w,l,pts_for,pts_against,diff,league_points,deducted_points,streak,group_name,teams(name)');
  assert.equal(S.columns(groups), S.BASE_COLS);
});
ok('only a conference competition asks for the conference columns', () => {
  const c = S.columns(conf, 'name');
  for (const col of ['division_name', 'conf_gp', 'conf_w', 'conf_l', 'conf_pts_for', 'conf_pts_against']) {
    assert.ok(c.includes(col), col + ' missing');
    assert.ok(!S.columns(table).includes(col), col + ' asked for on an ordinary table');
  }
  assert.ok(c.endsWith(',teams(name)'));
});
ok('no competition, or one without a format, is not a conference league', () => {
  assert.equal(S.isConferences(null), false);
  assert.equal(S.isConferences({}), false);
  assert.equal(S.isConferences(conf), true);
});

console.log('\nsplitting by conference and division');
const parts = S.split(rows);
ok('conferences come out in name order', () => {
  assert.deepEqual(parts.map(p => p.name), ['AUS', 'Canada West', 'OUA', 'RSEQ']);
});
ok('divisions sit inside their conference, in name order', () => {
  assert.deepEqual(parts[1].divisions.map(d => d.name), ['Pacific', 'Prairie']);
  assert.deepEqual(parts[2].divisions.map(d => d.name), ['Central', 'East', 'West']);
  assert.deepEqual(parts[0].divisions.map(d => d.name), ['']);
});
ok('rows keep the stored rank, whatever order they arrived in', () => {
  /* St. Francis Xavier arrived after Acadia but is ranked 1 in the AUS */
  assert.deepEqual(parts[0].divisions[0].rows.map(r => r.teams.name),
                   ['St. Francis Xavier', 'Acadia', 'Cape Breton']);
});
ok('a club with no group is shown under an unnamed group, last', () => {
  const p = S.split([...rows, row('Orphan', null, null, 1, 1, 0, 0, 0, 5, 80)]);
  assert.equal(p[p.length - 1].name, '');
  assert.equal(p[p.length - 1].divisions[0].rows[0].teams.name, 'Orphan');
});
ok('an ungrouped league is one unnamed group holding the whole table', () => {
  const flat = rows.map(r => Object.assign({}, r, { group_name: null, division_name: null }));
  const p = S.split(flat);
  assert.equal(p.length, 1);
  assert.equal(p[0].name, '');
  assert.equal(p[0].divisions[0].rows.length, rows.length);
});

console.log('\nthe Overall view');
const all = S.overall(rows);
ok('ranks the whole league by the complete schedule', () => {
  /* .867, .828, .815, .811, .793 — Winnipeg's 22-5 edges TMU's 30-7, both behind Bishop's 24-5 */
  assert.deepEqual(all.slice(0, 5).map(r => r.teams.name), ['Victoria', 'Bishop\'s', 'Winnipeg', 'TMU', 'Western']);
});
ok('a club with no games sits at the bottom, not at the top', () => {
  assert.equal(all[all.length - 1].teams.name, 'McGill');
});
ok('two clubs level on every key share a place; the next takes its own', () => {
  const a = row('A', 'X', null, 1, 10, 5, 0, 0, 30, 900);
  const b = row('B', 'X', null, 2, 10, 5, 0, 0, 30, 900);
  const c = row('C', 'X', null, 3, 9, 6, 0, 0, 30, 900);
  assert.deepEqual(S.overall([c, b, a]).map(r => [r.teams.name, r.overall_rank]),
                   [['A', 1], ['B', 1], ['C', 3]]);
});
ok('does not change the rows it was given', () => {
  assert.equal(rows[0].overall_rank, undefined);
});

console.log('\nprinting a record');
ok('a college percentage', () => {
  assert.equal(S.pct(3, 4), '.750');
  assert.equal(S.pct(4, 4), '1.000');
  assert.equal(S.pct(0, 4), '.000');
  assert.equal(S.pct(2, 3), '.667');
});
ok('no games is no percentage', () => {
  assert.equal(S.pct(0, 0), '—');
});
ok('a record reads W-L, and nothing reads as nought', () => {
  assert.equal(S.record(12, 8), '12-8');
  assert.equal(S.record(null, undefined), '0-0');
});
ok('a conference is named as itself, a league group as Group X', () => {
  assert.equal(S.groupLabel('OUA', conf), 'OUA');
  assert.equal(S.groupLabel('Nord', groups), 'Group Nord');
  assert.equal(S.groupLabel('', table), '');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
