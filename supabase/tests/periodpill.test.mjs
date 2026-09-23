/* ============================================================================
   THE SCOREBOARD PILL SAYS "END OF Q2", NOT "Q2 · 10:00".

   A fed game reports the break between quarters two different ways depending
   on the feed: sometimes the clock is 0:00 (the buzzer), sometimes it is
   already reset to the FULL length of the next period before that period has
   actually tipped off (notify_halftime.sql, 0124, documents both readings as
   the same break). Before this fix periodPill() only recognised the first —
   a live game sitting on the second reading printed "Q2 · 10:00", which reads
   as a fresh quarter starting rather than the one just played ending
   (reported 2026-09-18).

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
const B = sandbox.EpinoiaBox;

const pill = (period, clockMs, phase) => {
  Object.assign(sandbox.S, { period, clockMs, phase: phase || 'game' });
  return B.periodPill(sandbox.S);
};

console.log('\nthe period pill');
ok('mid-quarter reads the clock as normal', pill(2, 313000) === 'q2 · 5:13', pill(2, 313000));
ok('a clock at exactly zero is the end of that quarter, not a stopped one',
   pill(2, 0) === 'end of q2', pill(2, 0));
ok('...the same for q1 and q3', pill(1, 0) === 'end of q1' && pill(3, 0) === 'end of q3');

/* THE FIX: a full clock at an unchanged period is the same break as a zero clock. */
ok('a clock pre-loaded to the NEXT period\'s full length is also the end of this one',
   pill(2, 600000) === 'end of q2', pill(2, 600000));
ok('...past the full length (a feed rounding up) reads the same way',
   pill(2, 600001) === 'end of q2', pill(2, 600001));
ok('...and it is q3 that ends this way, not q2 again, when q3 is the one that is full',
   pill(3, 600000) === 'end of q3', pill(3, 600000));

/* Q1 HAS NO PREVIOUS PERIOD for a full clock to mean "just ended" -- a period_start event
   ALSO preloads the clock to the period's full length, at the true start of the game, not a
   break in it. Reported 2026-09-23: B.LEAGUE's feed sat still for a few minutes right after
   tip-off (period_start, clock 10:00, no plays yet), and Nagasaki v Shimane read "end of q1"
   at 0-0 with a full clock for as long as it did. */
ok('a full clock at period 1 is the tip-off itself, never "the end of" a period before it',
   pill(1, 600000) === 'q1 · 10:00', pill(1, 600000));

/* the fourth period is never "the end of" anything: what follows is not simply
   the next quarter, so the raw clock (however it reads) is left alone */
ok('period 4 at zero still shows the raw clock — nothing "ends" into overtime by default',
   pill(4, 0) === 'q4 · 0:00', pill(4, 0));
ok('...even at a full clock', pill(4, 600000) === 'q4 · 10:00', pill(4, 600000));

/* overtime is left exactly as period 4 is: it only continues if the score still ties, so
   whether there is a "next period" to announce is conditional in the same way — periodPill
   never says "end of" past period 3, in overtime as much as in the fourth. Its OWN length
   still has to come from PLEN, though (5 minutes, not 10), so a full OT clock (300000ms) is
   read correctly as OT NOT STARTED rather than as if 10 of its 5 minutes remained. */
ok('overtime\'s own, shorter length is what "full" means there — read as the raw clock, not "end of"',
   pill(5, 300000) === 'ot1 · 5:00', pill(5, 300000));
ok('...so half that long prints the same way it would for any other in-progress period',
   pill(5, 150000) === 'ot1 · 2:30', pill(5, 150000));

/* final overrides everything else, at any period or clock reading */
Object.assign(sandbox.S, { period: 2, clockMs: 313000, phase: 'final' });
ok('a final game always reads "final"', B.periodPill(sandbox.S) === 'final');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
