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
const yes = (name, cond) => eq(name, !!cond, true);
const wait = ms => new Promise(r => setTimeout(r, ms));

let n = 0;
async function pair() {
  const gameId = 'authority-test-' + (++n);
  const pub = L.publisher({ gameId, mode: 'local' });
  const sub = L.subscriber({ gameId, mode: 'local', onFrame: () => {} });
  await wait(250);
  return { pub, sub, gameId };
}
/* A keeper and a clock cam do NOT publish through the publisher: they post a bare
   frame on the game channel carrying a state and nothing else -- no seq, no
   events. That difference is the whole of what the tests below turn on, so they
   post the real shape rather than going through pushState, which would stamp a
   seq the real thing has never had. */
function rawFrame(gameId, payload) {
  const ch = new BroadcastChannel('eplive:' + gameId);
  ch.postMessage(payload);
  ch.close();
}
const keeperFrame = ms => ({ keeper: true, state: {
  clock_ms: ms, running: true, source: 'keeper', updated_at: new Date().toISOString() } });
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

/* ---------------------------------------------------------------------------
   AND WHETHER ANYBODY IS STILL DRIVING IT.

   clockMs() stops running a dead source forward, so it cannot count down to zero
   on air. But a graphics layer ticks its OWN clock between readings — that is what
   makes it smooth — and against a frozen target it would tick away, snap back when
   the gap grew past a second and a half, and do it again for the rest of the
   period. A clock that sawtooths is worse than one that has plainly stopped, so
   the transport says out loud when nothing is driving it.
   --------------------------------------------------------------------------- */
console.log('\nand whether anybody is still driving it');

{
  const { pub, sub } = await pair();
  pub.pushState(clockOf('cam', 500000));
  await wait(200);
  eq('a clock that was just read is not stale', sub.clockStale(), false);
}

{
  const { pub, sub } = await pair();
  /* the same reading, stamped well beyond the run-on cap: the phone is gone */
  pub.pushState({ clock_ms: 500000, running: true, source: 'cam',
                  updated_at: new Date(Date.now() - (L.CLOCK_RUN_ON_MS + 5000)).toISOString() });
  await wait(200);
  eq('a running clock nobody has read for longer than the cap is stale', sub.clockStale(), true);
  eq('...and the clock it reports has stopped at the cap, not run to zero',
     sub.clockMs(), 500000 - L.CLOCK_RUN_ON_MS);
}

{
  const { pub, sub } = await pair();
  /* a STOPPED clock is meant to sit still; its age says nothing about anybody */
  pub.pushState({ clock_ms: 500000, running: false, source: 'cam',
                  updated_at: new Date(Date.now() - 600000).toISOString() });
  await wait(200);
  eq('a stopped clock is never stale, however old the reading', sub.clockStale(), false);
  eq('...and it reports exactly what it was given', sub.clockMs(), 500000);
}

{
  const { sub } = await pair();
  eq('a subscriber with no state at all is not stale either', sub.clockStale(), false);
}

/* ---------------------------------------------------------------------------
   A LIVE CLOCK IS NOT A LIVE SCORER.

   The degradation ladder exists to notice that the statistician has gone dark:
   no traffic for STALE_MS and the status drops to 'delayed', polling starts, and
   whoever is watching is told the feed is not what it was. It was defeated by
   its own clock. The keeper restates itself every five seconds and the camera
   reads every second and a half, and both of those frames carry a state -- which
   the ladder counted as traffic. So on every game worth broadcasting, the ones
   with a control room or a camera on the board, the tablet could die at 8:00 of
   the third and nothing noticed: status stayed 'live', the clock kept ticking on
   air, and the score simply stopped moving.

   The clock is still tracked, separately, because "clock live, score stale" is
   the honest thing to say and it needs both ages rather than one merged one.
   --------------------------------------------------------------------------- */
console.log('\na live clock is not a live scorer');

{
  const { pub, sub, gameId } = await pair();
  pub.pushState(clockOf('keeper', 480000));
  /* a stretch with nothing at all from the scorer, so the two ages are far
     enough apart that neither assertion can be satisfied by timing noise */
  await wait(1400);
  const t0 = sub.logAge();
  rawFrame(gameId, keeperFrame(479000));
  rawFrame(gameId, keeperFrame(478000));
  await wait(300);
  yes('a keeper frame does not pass for the scorer being alive', sub.logAge() > t0 + 250);
  yes('...but it is counted as the clock being alive', sub.clockAge() < 600);
  sub.stop();
}

{
  const { pub, sub, gameId } = await pair();
  rawFrame(gameId, keeperFrame(479000));
  await wait(400);
  const dark = sub.logAge();
  pub.pushEvents([{ id: 1, t: 'shot', period: 1, clock: 479000 }]);
  await pub.flushNow();
  await wait(200);
  yes('a frame from the scorer itself does count', sub.logAge() < dark);
  sub.stop();
}

{
  const { sub, gameId } = await pair();
  /* The real thing at real speed: nothing but the control room's clock for longer
     than the ladder's patience. The wait is the test -- STALE_MS is not injected
     or shortened, because a shortened one would not prove the shipped number. */
  const beat = setInterval(() => rawFrame(gameId, keeperFrame(470000)), 800);
  await wait(L.STALE_MS + 3500);
  clearInterval(beat);
  eq('a scorer that dies under a live clock is noticed', sub.status, 'delayed');
  yes('...and the clock is still known to be fresh', sub.clockAge() < 2000);
  sub.stop();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
