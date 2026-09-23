/* ============================================================================
   THE SCOREBOARD PILL, AND THE CLOCK IT (AND EVERY MINUTE) IS READ FROM.

   A period's clock is at its full length at BOTH ends of a break on a fed game:
   period_start preloads it before a second of the period is played, and a feed
   that resets its clock the moment a quarter ends (LiveStats does) shows the
   next period's full length through the whole break after it
   (notify_halftime.sql, 0124, documents both readings).

     2026-09-18  a live game read "Q2 · 10:00" through half-time
     2026-09-23  B.LEAGUE's tip-off read "end of q1" at 0-0 with a full clock
     2026-09-23  London Lions v Cheshire Phoenix read "Q1 · 10:00" through the
                 break after the first quarter; and a box score opened during
                 the first quarter gave the starters ten minutes each until
                 the next play (the page drew its first table at 0:00)

   Only the log can say which end a full clock is, so the pill no longer
   guesses: 0:00 is the end, a full clock is the start, and the game page
   settles a reset clock to 0:00 first (settleClock in epinoia/game/game.js,
   lifted and run here) -- the same clock the engine counts minutes with.

     node supabase/tests/periodpill.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const sandbox = { S: {}, console };
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(read('epinoia/boxscore.js'), ctx, { filename: 'boxscore.js' });
vm.runInContext(read('epinoia/engine.js'), ctx, { filename: 'engine.js' });
const B = sandbox.EpinoiaBox;
const E = sandbox.EpinoiaEngine;

const pill = (period, clockMs, phase) => {
  Object.assign(sandbox.S, { period, clockMs, phase: phase || 'game' });
  return B.periodPill(sandbox.S);
};

console.log('\nthe period pill');
ok('mid-quarter reads the clock as normal', pill(2, 313000) === 'q2 · 5:13', pill(2, 313000));
ok('a clock at exactly zero is the end of that quarter, not a stopped one',
   pill(2, 0) === 'end of q2', pill(2, 0));
ok('...the same for q1 and q3', pill(1, 0) === 'end of q1' && pill(3, 0) === 'end of q3');
ok('a full clock is the START of a period: tip-off is never "the end of" anything',
   pill(1, 600000) === 'q1 · 10:00', pill(1, 600000));
ok('...and the start of the second quarter is not the end of it',
   pill(2, 600000) === 'q2 · 10:00', pill(2, 600000));

/* the fourth period is never "the end of" anything: what follows is not simply
   the next quarter, so the raw clock (however it reads) is left alone */
ok('period 4 at zero still shows the raw clock — nothing "ends" into overtime by default',
   pill(4, 0) === 'q4 · 0:00', pill(4, 0));
ok('...even at a full clock', pill(4, 600000) === 'q4 · 10:00', pill(4, 600000));
ok('overtime\'s own, shorter length is what "full" means there',
   pill(5, 300000) === 'ot1 · 5:00', pill(5, 300000));
ok('...so half that long prints the same way it would for any other in-progress period',
   pill(5, 150000) === 'ot1 · 2:30', pill(5, 150000));

Object.assign(sandbox.S, { period: 2, clockMs: 313000, phase: 'final' });
ok('a final game always reads "final"', B.periodPill(sandbox.S) === 'final');

/* ---------------------------------------------------------------------------
   settleClock -- lifted from epinoia/game/game.js and run against boxscore.js's PLEN.
   --------------------------------------------------------------------------- */
const gameSrc = read('epinoia/game/game.js');
const m = /function settleClock\(events, period, clockMs, lastSeq\) \{[\s\S]*?\n\}/.exec(gameSrc);
ok('settleClock is where the game page says it is', !!m);
const settleClock = m ? vm.runInContext('(B => (' + m[0] + '))', ctx)(B) : () => NaN;

/* events in the page's shape: {id (= seq), t, period, clock} */
let seq = 0;
const ev = (t, period, clock) => ({ id: ++seq, t, period, clock });
const q1 = [ev('period_start', 1, 600000), ev('sub', 1, 600000), ev('p2_made', 1, 512000),
            ev('reb', 1, 31000), ev('p3_miss', 1, 4000)];
const settle = (events, period, clock, lastSeq) => settleClock(events, period, clock, lastSeq);
const pillOf = (events, period, clock, lastSeq) =>
  pill(period, settle(events, period, clock, lastSeq));

console.log('\nthe clock the page settles on');
ok('the break after the first quarter: a reset clock in a played period is its end (the report)',
   pillOf(q1, 1, 600000, seq) === 'end of q1', pillOf(q1, 1, 600000, seq));
ok('...and so is half-time on the same reading',
   pillOf(q1.concat([ev('period_start', 2, 600000), ev('p2_made', 2, 20000)]), 2, 600000, seq) === 'end of q2');
const tip = [ev('period_start', 1, 600000), ev('jump', 1, 600000)];
ok('tip-off (period_start, a jump ball at 10:00, nothing played) keeps its full clock',
   pillOf(tip, 1, 600000, seq) === 'q1 · 10:00', pillOf(tip, 1, 600000, seq));
const q2start = q1.concat([ev('sub', 2, 600000), ev('timeout', 2, 600000), ev('period_start', 2, 600000)]);
ok('the second quarter\'s subs, a timeout and its period_start at 10:00 are its start, not play in it',
   pillOf(q2start, 2, 600000, seq) === 'q2 · 10:00', pillOf(q2start, 2, 600000, seq));
const covered = seq;
const q2first = q2start.concat([ev('p2_miss', 2, 598000)]);
ok('a poll that caught the first play of a period before the state row written with it is its START',
   pillOf(q2first, 2, 600000, covered) === 'q2 · 10:00', pillOf(q2first, 2, 600000, covered));
ok('...but once the reading has seen that play, a full clock is the reset',
   pillOf(q2first, 2, 600000, seq) === 'end of q2');
ok('a reading with no last_seq trusts the whole log', settle(q1, 1, 600000, null) === 0);
ok('a clock inside the period is left exactly as it reads', settle(q1, 1, 45000, seq) === 45000);
ok('no reading yet: where the log has got to in the period, never 0:00',
   settle(q1, 1, null, null) === 4000, settle(q1, 1, null, null));
ok('...or the period\'s full length when nothing is in it', settle([], 1, null, null) === 600000);
ok('...and an unreadable one is no reading', settle(q1, 1, 'abc', null) === 4000);
const ot = [ev('period_start', 5, 300000), ev('p2_made', 5, 120000)];
ok('overtime is judged by its own five minutes', settle(ot, 5, 300000, seq) === 0 && settle(ot, 5, 150000, seq) === 150000);

/* THE MINUTES. The engine runs each stint on the floor up to the clock it is given, so the
   clock the page settles on IS the minutes column. */
console.log('\nthe minutes the box score shows');
const teams = [0, 1].map(t => ({ name: 't' + t, players: [1, 2, 3, 4, 5, 6].map(i => ({ id: 'p' + t + i, name: 'P' + t + i, num: i })) }));
const starters = [0, 1].map(t => [1, 2, 3, 4, 5].map(i => 'p' + t + i));
const minsOf = (events, period, clockMs) => {
  const d = E.deriveGame({ teams, starters, events, period, clockMs });
  return d.stats.p01.min / 60000;
};
const early = [ev('period_start', 1, 600000), ev('p2_made', 1, 480000)];
early[1].team = 0; early[1].pid = 'p01';
ok('two minutes into the first quarter a starter has two minutes, not ten',
   minsOf(early, 1, settle(early, 1, 480000, seq)) === 2, minsOf(early, 1, settle(early, 1, 480000, seq)));
ok('...which is what the old first draw, at a placeholder 0:00, got wrong (ten)',
   minsOf(early, 1, 0) === 10);
ok('...and a page with no clock yet does not give him the quarter either',
   minsOf(early, 1, settle(early, 1, null, null)) === 2);
const played = [ev('period_start', 1, 600000), Object.assign(ev('p2_made', 1, 512000), { team: 0, pid: 'p01' }),
                Object.assign(ev('p3_miss', 1, 4000), { team: 1, pid: 'p11' })];
ok('at the break after the first quarter a starter who played it all has ten, not none',
   minsOf(played, 1, settle(played, 1, 600000, seq)) === 10, minsOf(played, 1, settle(played, 1, 600000, seq)));
ok('...where the unsettled reset clock gave him none', minsOf(played, 1, 600000) === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
