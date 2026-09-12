/* ============================================================================
   THE BROADCAST LAYER MUST READ A LIVE EVENT THE WAY IT READS A STORED ONE.

   A stored event is a database row: the seven indexed columns, and everything
   else — whether a rebound was offensive, who came on and who came off, where a
   shot was taken from — inside a `payload` column. rowToEvent exists to flatten
   that back into an event the engine understands, and for the boot path, which
   reads rows, it is exactly right.

   A LIVE event has already been flattened. The scorer publishes its own event
   objects, and live.js flattens the ones it reads from the database before it
   hands them on, so by the time a frame reaches a layer there is no `payload`
   left to unpack. Applying rowToEvent to it a second time therefore keeps the
   seven fields it names and silently drops the rest:

     a substitution loses `out` and `in`   -> nobody leaves the floor, and a
                                              sixth name appears on a five-man card
     a rebound loses `off`                 -> every offensive board is counted
                                              as a defensive one
     a shot loses `loc` and `stype`        -> the rim/mid/three split collapses

   And it is not a transient wrong that the next frame corrects: the scorer
   republishes its whole log every ten seconds as a `full` frame, and that path
   re-strips every event in it. The scorebug survives because a score is derived
   from the event TYPE alone, which is why this could sit there unnoticed while
   every stat card during play was wrong.

   These fixtures are the two events that give the game away, run through the
   real engine by both paths.

     node supabase/tests/broadcast-liveevents.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'epinoia', 'engine.js'));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.error('  FAIL  ' + name + '\n        got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
};

/* the live layer's own normaliser, read out of the file so this test cannot
   drift away from the code it is about */
import { readFileSync } from 'node:fs';
const src = readFileSync(path.join(ROOT, 'epinoia', 'broadcast', 'broadcast.js'), 'utf8');
/* Tolerant of CRLF. This repo's checkout rewrites line endings, and anchoring on
   a bare newline made the test pass or fail depending on whether git had last
   touched the file — which is a test that reports on the wrong thing. */
const m = src.match(/const rowToEvent = ([\s\S]*?);[\r\n]/);
if (!m) { console.error('could not find rowToEvent in broadcast.js'); process.exit(1); }
const rowToEvent = eval('(' + m[1] + ')');

const P = t => ['p' + t + '0', 'p' + t + '1', 'p' + t + '2', 'p' + t + '3', 'p' + t + '4'];
const team = t => ({ name: 'team ' + t, players: P(t).concat(['p' + t + '5']).map((id, i) => ({ id, name: 'player ' + i, num: String(i + 4) })) });

/* A stored row and the SAME event as it arrives live. The only difference is
   where the extra fields sit; the engine must see them either way. */
const storedRows = [
  { seq: 1, t: 'jump', team: 0, pid: null, period: 1, clock: 600000, payload: {} },
  { seq: 2, t: 'reb', team: 0, pid: 'p00', period: 1, clock: 580000, payload: { off: true } },
  { seq: 3, t: 'sub', team: 0, pid: null, period: 1, clock: 560000, payload: { out: 'p04', in: 'p05' } },
];
const liveEvents = storedRows.map(rowToEvent);          // what live.js hands a layer

const game = evs => ({
  teams: [team(0), team(1)],
  starters: [P(0), P(1)],
  events: evs, period: 1, clockMs: 540000, phase: 'game',
  tipWinner: 0, arrowInit: 1,
});

const viaBoot = E.deriveGame(game(storedRows.map(rowToEvent)));
/* the live path applies rowToEvent to events that have already been through it */
const viaLiveNow = E.deriveGame(game(liveEvents.map(rowToEvent)));

console.log('\na live event must survive the trip to the layer');

eq('the offensive rebound is credited on the boot path', viaBoot.stats['p00'].or, 1);
eq('and the same event, arriving live, is still offensive', viaLiveNow.stats['p00'].or, 1);
eq('...and is not counted as a defensive board', viaLiveNow.stats['p00'].dr, 0);

eq('the substitution takes a player off on the boot path', viaBoot.onCourt[0].length, 5);
eq('and the same substitution, arriving live, still does', viaLiveNow.onCourt[0].length, 5);
eq('the right player is on the floor', viaLiveNow.onCourt[0].includes('p05'), true);
eq('and the right one is off it', viaLiveNow.onCourt[0].includes('p04'), false);

/* the guard itself: a row has a payload column, a live event does not */
eq('a stored row is still unpacked', rowToEvent(storedRows[1]).off, true);
eq('an already-flat event passes through unharmed', rowToEvent(liveEvents[1]).off, true);
eq('and keeps the fields a substitution needs', [rowToEvent(liveEvents[2]).out, rowToEvent(liveEvents[2]).in], ['p04', 'p05']);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
