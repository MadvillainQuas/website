/* ============================================================================
   WHO IS DRIVING THE CLOCK.

   A game can have three things with an opinion about the time: the scoring app
   or a federation feed, which know what the clock was when something last
   happened; a person in the control room tapping a keeper; and a camera pointed
   at the hall's scoreboard. Only one of them can be right on air at a time, and
   until this was fixed the answer was "whichever frame arrived last".

   That is not a tie-break, it is a coin toss several times a minute. A keeper
   restates itself every five seconds and a camera reads every second and a half,
   so with both running the clock alternated between a human's taps and a camera's
   readings, sliding a little each way, for the whole game -- and nothing anywhere
   said why it would not settle.

   The rule now: the source actually driving keeps the clock until it goes quiet,
   and a DELIBERATE act -- a tap on start or stop -- takes it at once, because a
   person reaching for the keeper while a camera misreads is the one case where
   the human must win and should not have to wait to be heard.

   These run the real subscriber over the real local transport, so they exercise
   adoptState itself rather than a copy of its rule.

     node supabase/tests/clockauthority.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, 'epinoia', 'live.js'));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.error('  FAIL  ' + name + '\n        got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

let n = 0;
async function pair() {
  const gameId = 'authority-test-' + (++n);
  const pub = L.publisher({ gameId, mode: 'local' });
  const sub = L.subscriber({ gameId, mode: 'local', onFrame: () => {} });
  await wait(250);
  return { pub, sub };
}
const clockOf = (src, ms, extra) => Object.assign(
  { clock_ms: ms, running: true, source: src, updated_at: new Date().toISOString() }, extra || {});

console.log('\nwho is driving the clock');

{
  const { pub, sub } = await pair();
  pub.pushState(clockOf('cam', 500000));
  await wait(200);
  eq('a camera reading takes the clock', sub.clockSource(), 'cam');
  eq('and the clock is the camera\'s', sub.state.clock_ms, 500000);
}

{
  const { pub, sub } = await pair();
  pub.pushState(clockOf('cam', 500000));
  await wait(200);
  /* the keeper's five-second restatement, arriving while the camera is still
     reading: it must not take the clock away */
  pub.pushState(clockOf('keeper', 480000));
  await wait(200);
  eq('a keeper restating itself does not interrupt an active camera', sub.clockSource(), 'cam');
  eq('and the clock is still the camera\'s', sub.state.clock_ms, 500000);
}

{
  const { pub, sub } = await pair();
  pub.pushState(clockOf('cam', 500000));
  await wait(200);
  /* somebody taps start or stop: a deliberate act, and it wins at once */
  pub.pushState(clockOf('keeper', 480000, { assert: true }));
  await wait(200);
  eq('a deliberate tap takes the clock from the camera immediately', sub.clockSource(), 'keeper');
  eq('and the clock is the keeper\'s', sub.state.clock_ms, 480000);
}

{
  const { pub, sub } = await pair();
  pub.pushState(clockOf('keeper', 480000, { assert: true }));
  await wait(200);
  eq('the keeper has it', sub.clockSource(), 'keeper');
  /* the keeper stops being tapped; its restatements stop. After the hand-over
     window a camera on the board takes over, which is the right way round. */
  await wait(L.HANDOVER_MS + 300);
  pub.pushState(clockOf('cam', 470000));
  await wait(200);
  eq('a camera takes over from a keeper that has gone quiet', sub.clockSource(), 'cam');
  eq('and the clock is the camera\'s', sub.state.clock_ms, 470000);
}

{
  const { pub, sub } = await pair();
  pub.pushState(clockOf('cam', 500000));
  await wait(200);
  /* the scoring app's own state, which carries no source: its score is taken and
     its opinion of the clock is not, for as long as a camera is driving */
  pub.pushState({ clock_ms: 1000, running: false, score_home: 61, score_away: 58,
                  updated_at: new Date().toISOString() });
  await wait(200);
  eq('the scorer\'s score is taken while a camera drives', sub.state.score_home, 61);
  eq('but the scorer\'s clock is not', sub.state.clock_ms, 500000);
  eq('and the camera is still driving', sub.clockSource(), 'cam');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
