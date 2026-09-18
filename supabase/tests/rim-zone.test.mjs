/* WHERE A SHOT WAS TAKEN FROM decides whether it was at the rim.

   The engine used to ask the shot's TYPE first and only fall back to its coordinates. That
   reads well until a feed stops choosing: LNB's names 90 of 95 shots "jumpshot", layups under
   the basket included, so "jump shot" short-circuited ahead of a perfectly good marker and the
   league's rim rate came out at three attempts a game, every one of them made.

   These are the cases that decide it, run through the real replay.

       node supabase/tests/rim-zone.test.mjs
*/
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const E = require('../../epinoia/engine.js');
assert.equal(typeof E.deriveGame, 'function', 'the engine is loadable');

let pass = 0, fail = 0;
const ok = (what, got, want) => {
  if (got === want) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
};

/* the chart the markers sit on: half of 28 x 15 m in centimetres, ring at (750, 157.5) */
const at = (xcm, ycm) => ({ x: xcm / 1500, y: ycm / 1400 });
const RING = at(750, 157.5);            // dead under the basket
const RESTRICTED_EDGE = at(750, 157.5 + 120);   // 1.20 m out — just inside the restricted area
const JUST_OUTSIDE = at(750, 157.5 + 140);      // 1.40 m out — just outside it
const FT_LINE = at(750, 157.5 + 450);           // the free-throw line, deep in the key
const CORNER = at(120, 200);

let seq = 0;
const ev = (t, pid, extra) => Object.assign({ id: ++seq, seq, t, pid, team: 0, period: 1, clock: 500000 }, extra || {});

/* one shot, with whatever marker and label the feed gave it */
function replay(shots) {
  const events = [];
  shots.forEach(s => {
    const shot = ev(s.made ? 'p2_made' : 'p2_miss', 'p1');
    events.push(shot);
    /* in memory a satellite is FLAT -- game.js's rowToEvent spreads the payload column onto
       the event, and `ref` points at the shot's id */
    if (s.loc) events.push(ev('loc', null, { ref: shot.id, x: s.loc.x, y: s.loc.y }));
    if (s.type) events.push(ev('stype', null, { ref: shot.id, v: s.type }));
  });
  const S = {
    teams: [{ name: 'A', players: [{ id: 'p1', name: 'One', num: '1' }] },
            { name: 'B', players: [{ id: 'p2', name: 'Two', num: '2' }] }],
    starters: [['p1'], ['p2']], events, period: 1, clockMs: 0, status: 'live', phase: 'game'
  };
  const d = E.deriveGame(S);
  return d.stats.p1;
}

console.log('-- the marker decides, whatever the feed calls the shot');
ok('a "jump shot" under the ring is at the rim',
   replay([{ type: 'jump shot', loc: RING, made: true }]).rimA, 1);
ok('...and is not counted as a mid-range attempt',
   replay([{ type: 'jump shot', loc: RING, made: true }]).midA, 0);
ok('a "jump shot" from the free-throw line is not at the rim',
   replay([{ type: 'jump shot', loc: FT_LINE, made: false }]).rimA, 0);
ok('...it is a mid-range attempt',
   replay([{ type: 'jump shot', loc: FT_LINE, made: false }]).midA, 1);

console.log('\n-- the restricted area is the edge, and it is the court\'s own circle');
ok('1.20 m from the ring is at the rim', replay([{ loc: RESTRICTED_EDGE, made: true }]).rimA, 1);
ok('1.40 m from the ring is not', replay([{ loc: JUST_OUTSIDE, made: true }]).rimA, 0);
ok('a corner shot is not', replay([{ loc: CORNER, made: false }]).rimA, 0);

console.log('\n-- a type that is a fact about the shot still wins where it is decisive');
ok('a tip-in recorded a metre and a half out is still at the rim',
   replay([{ type: 'tip-in', loc: JUST_OUTSIDE, made: true }]).rimA, 1);
ok('a dunk with no marker at all is at the rim',
   replay([{ type: 'dunk', made: true }]).rimA, 1);

console.log('\n-- and with no marker the label is all there is');
ok('an unmarked "jump shot" is not at the rim', replay([{ type: 'jump shot', made: false }]).rimA, 0);
ok('an unmarked layup is', replay([{ type: 'layup', made: true }]).rimA, 1);
ok('an unmarked, unlabelled shot is not', replay([{ made: false }]).rimA, 0);

console.log('\n-- made and attempted move together');
const m = replay([{ type: 'jump shot', loc: RING, made: true }, { type: 'jump shot', loc: RING, made: false }]);
ok('two at the rim', m.rimA, 2);
ok('one of them made', m.rimM, 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
