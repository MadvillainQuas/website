/* ============================================================================
   WHAT THE CLOCK CAM PUTS ON AIR.

   The decoder's bench (clockcam.decode.test.mjs) asks how often a scoreboard is
   read correctly. This asks the question after that one: given that some readings
   WILL be wrong, which of them reach the broadcast?

   That is the question that matters, because the two failures cost completely
   different amounts. A reading the phone declines costs a quarter of a second and
   nobody sees it -- the graphics tick on by themselves and slide to the next
   correction. A reading the phone believes and publishes is on every layer of the
   stream within a frame, and if it is wrong the clock visibly leaps and comes
   back. One is invisible; the other is the thing a league gets tweeted about.

   So each case below feeds a stream of readings -- some real, some the specific
   kinds of wrong a seven-segment reader produces -- and asserts what came out.

     node supabase/tests/clockcam.clock.test.mjs
   ============================================================================ */
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const { makeClock } = (await import('file://' + path.join(ROOT, 'epinoia', 'clockcam', 'clock.js'))).default
  || globalThis.CCClock;

let failed = 0, ran = 0;
function check(name, fn) {
  ran++;
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}
const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: got ${got}, wanted ${want}`); };

/* Runs a script of [reading, millisecondsSinceStart] through a fresh clock and
   returns everything it chose to publish. A reading of null is a frame the
   decoder declined. */
function run(script, opt) {
  const c = makeClock(opt);
  const out = [];
  for (const [ms, at] of script) {
    const r = c.consider(ms, at);
    if (r) out.push({ ms: r.ms, running: r.running, at });
  }
  return { out, c };
}

/* a clock running down cleanly from 9:59, read four times a second */
function runDown(fromMs, frames, startAt, stepMs) {
  const s = [];
  for (let i = 0; i < frames; i++) {
    const at = (startAt || 0) + i * (stepMs || 250);
    s.push([Math.max(0, fromMs - i * (stepMs || 250)), at]);
  }
  return s;
}

/* ---------------------------------------------------------------- lock in --- */
check('nothing is published until the picture behaves like a clock', () => {
  /* one frame, however clear, is a photograph of a number -- it could be the shot
     clock, or a box on the wrong part of the board */
  const { out } = run([[599000, 0]]);
  eq(out.length, 0, 'published from a single frame');
});

check('two frames running down together earn the lock', () => {
  const { out, c } = run([[599000, 0], [598750, 250]]);
  eq(c.locked, true, 'locked');
  eq(out.length, 1, 'published');
  eq(out[0].running, true, 'running');
});

check('a still value held for over a second earns the lock, stopped', () => {
  const { out, c } = run([[450000, 0], [450000, 250], [450000, 700], [450000, 1400]]);
  eq(c.locked, true, 'locked');
  eq(out.length, 1, 'published once');
  eq(out[0].running, false, 'running');
});

/* -------------------------------------------------------- the whole point --- */
check('A MISREAD THAT DROPS THE CLOCK IS NOT PUBLISHED', () => {
  /* 9:47 with the 9 misread as a 3. This is the failure the old physics let
     straight through: it held jumps up and took jumps down unquestioned. */
  const s = runDown(587000, 4);
  s.push([227000, 1000]);              // 3:47 -- a five-and-a-half minute fall in a quarter second
  s.push([586000, 1250]);              // and the board reads correctly again
  const { out } = run(s);
  if (out.some(o => o.ms === 227000)) throw new Error('the misread reached the broadcast');
  eq(out[out.length - 1].ms, 586000, 'recovered to the real clock');
});

check('a misread that raises the clock is not published either', () => {
  const s = runDown(587000, 4);
  s.push([647000, 1000]);              // 10:47 -- a minute appeared
  s.push([586000, 1250]);
  const { out } = run(s);
  if (out.some(o => o.ms === 647000)) throw new Error('the misread reached the broadcast');
});

check('a one-frame misread of the seconds is not published', () => {
  /* the nastiest class, because it is nearly plausible: 8:07 read as 8:01 */
  const s = runDown(487000, 4);
  s.push([481000, 1000]);
  s.push([486000, 1250]);
  const { out } = run(s);
  if (out.some(o => o.ms === 481000)) throw new Error('a six-second jump was published');
});

/* ------------------------------------------------ but real jumps must land --- */
check('a new period IS published, because the board keeps saying it', () => {
  const s = runDown(3000, 4);          // running out the quarter
  s.push([600000, 1000]);              // the board resets to 10:00
  s.push([600000, 1250]);              // and goes on saying so, frame after frame
  s.push([600000, 1500]);
  s.push([600000, 1750]);
  const { out } = run(s);
  const last = out[out.length - 1];
  eq(last.ms, 600000, 'the reset landed');
  eq(last.running, false, 'a reset clock is stopped');
});

check('the table correcting the clock IS published', () => {
  const s = runDown(587000, 4);
  s.push([595000, 1000]);              // put back eight seconds after a review
  s.push([595000, 1250]);
  s.push([595000, 1500]);
  s.push([595000, 1750]);
  const { out } = run(s);
  eq(out[out.length - 1].ms, 595000, 'the correction landed');
});

check('two unrelated misreads in a row are not a correction', () => {
  /* two DIFFERENT impossible readings in a row are two misreads, not a correction */
  const s = runDown(587000, 4);
  s.push([227000, 1000]);
  s.push([317000, 1250]);
  const { out } = run(s);
  if (out.some(o => o.ms === 227000 || o.ms === 317000)) throw new Error('two unrelated misreads were taken as a correction');
});

/* ------------------------------------------------------------- stop / go --- */
check('a clock that stops is reported stopped', () => {
  const s = runDown(587000, 4);
  for (let i = 0; i < 10; i++) s.push([586250, 1000 + i * 250]);
  const { out, c } = run(s);
  eq(c.running, false, 'running');
  eq(out[out.length - 1].running, false, 'the last publish said stopped');
});

check('a clock that starts again is reported running', () => {
  const s = runDown(587000, 4);
  for (let i = 0; i < 10; i++) s.push([586250, 1000 + i * 250]);
  for (let i = 1; i <= 6; i++) s.push([586250 - i * 250, 3500 + i * 250]);
  const { c } = run(s);
  eq(c.running, true, 'running');
});

/* --------------------------------------------------------------- the gaps --- */
check('a gap in the frames does not invalidate the next reading', () => {
  /* the phone missed a second of frames -- a blurred run, somebody walking past */
  const { out } = run([[587000, 0], [586750, 250], [585750, 1250]]);
  eq(out[out.length - 1].ms, 585750, 'the reading after the gap was taken');
});

check('after a long silence the lock is earned again rather than assumed', () => {
  /* the page was hidden, or the board went out of shot. What we were holding is
     no longer a witness to anything. */
  const c = makeClock();
  c.consider(587000, 0); c.consider(586750, 250);
  eq(c.locked, true, 'locked before');
  const r = c.consider(300000, 30000);    // half a minute later, a completely different clock
  eq(r, null, 'published something after a long silence');
  eq(c.locked, false, 'still locked after a long silence');
});

/* ------------------------------------------------------------ the predict --- */
check('the predicted clock runs on between readings, and stands still when stopped', () => {
  const c = makeClock();
  c.consider(587000, 0); c.consider(586750, 250);
  eq(c.predict(750), 586250, 'predicted while running');
  const c2 = makeClock();
  c2.consider(450000, 0); c2.consider(450000, 250); c2.consider(450000, 1400);
  eq(c2.predict(5000), 450000, 'predicted while stopped');
});

/* ------------------------------------------------------- a whole quarter --- */
check('ten minutes of frames with one bad frame in six publishes nothing wrong', () => {
  /* A stand-in for a real hall: the clock runs down for ten minutes at four
     frames a second, and one frame in six is the kind of wrong a seven-segment
     reader produces -- a digit dropped, a digit gained, a minute misread. The
     test is not that they are all caught; it is that nothing published is more
     than a heartbeat away from the truth. */
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const c = makeClock();
  const bad = [];
  let t = 0, real = 600000;
  c.consider(real, t); t += 250; real -= 250;
  c.consider(real, t);
  for (let i = 0; i < 2400; i++) {
    t += 250; real = Math.max(0, real - 250);
    let reading = real;
    if (rnd() < 1 / 6) {
      const r = rnd();
      reading = r < 0.33 ? real - 60000 * (1 + Math.floor(rnd() * 5))    // a minutes digit misread
              : r < 0.66 ? real + 60000                                  // a minute gained
              : real - 6000 - Math.floor(rnd() * 40000);                 // seconds mangled
      if (reading < 0) reading = real + 36000;
    }
    const out = c.consider(reading, t);
    if (out && Math.abs(out.ms - real) > 1200) bad.push({ t, published: out.ms, real });
  }
  if (bad.length) throw new Error(`${bad.length} wrong clocks reached the broadcast, e.g. at ${bad[0].t}ms published ${bad[0].published} when it was ${bad[0].real}`);
});

console.log('');
if (failed) { console.error(`  ${failed} of ${ran} failed\n`); process.exit(1); }
console.log(`  ok — ${ran} checks, nothing wrong reached the broadcast\n`);
