/* ============================================================================
   WHAT A CLOCK IS ALLOWED TO DO.

   Every reading the clock cam takes is a guess about a photograph, and the reader
   is right most of the time rather than all of it. This is the part that throws
   away the rest, and the only thing separating a misread from a real reading is
   whether it makes sense as the next thing a clock could do.

   Between two frames a quarter of a second apart, a basketball clock may fall by
   about a quarter of a second, or stand still. It may not rise. It may not fall
   by six seconds. So a reading inside that window is believed, and one outside it
   is HELD until the board keeps saying it -- which is the only way to tell a new
   period, or the table putting the clock right, from one bad frame.

   THE OLD VERSION HAD THIS BACKWARDS. It held readings that jumped UP and took
   readings that jumped DOWN without question. On air that is the difference
   between a clock that is occasionally slow to correct and a clock that leaps:
   a 9 misread as a 3 sent 9:47 to 3:47 instantly, every layer on the stream
   slewed to it, and a quarter of a second later it came back as though nothing
   had happened. A jump is a jump whichever way it goes.

   It is pure -- readings and timestamps in, decisions out, no camera, no channel,
   no clock of its own -- which is what lets supabase/tests/clockcam.clock.test.mjs
   run a whole quarter of bad frames through it in a millisecond.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CCClock = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {
'use strict';

const DEFAULTS = {
  /* a reading may sit this far the wrong side of where the clock should be and
     still be believed: rounding on a board that shows tenths, mostly */
  rise: 400,
  /* the slack on a fall grows with the gap between readings, because a frame we
     did not get is time the clock moved without us -- but never past a few
     seconds, or a stopped clock would accept anything */
  slackMin: 1000, slackShare: 0.5, slackMax: 5000,
  /* A JUMP HAS TO KEEP SAYING IT. Two readings was not enough: a board with one
     dead segment, or a box clipping the edge of a digit, produces the SAME wrong
     answer on frame after frame, and two of those in a row look exactly like the
     table correcting the clock. Three readings that agree AND span most of a
     second is a thing the board is actually showing. It costs a real correction
     three quarters of a second to land, which nobody watching can see, because
     the graphics go on ticking the old clock and slide to the new one. */
  agreeN: 3, agreeMs: 700,
  /* after this long with nothing believable, the clock we are holding is no
     longer a witness to anything and the lock is earned again */
  forget: 8000,
  /* a value that has not moved for this long is a stopped clock */
  still: 1600,
};

function makeClock(opt) {
  const C = Object.assign({}, DEFAULTS, opt || {});
  let locked = false, running = false;
  let accepted = null, rawPrev = null, held = null, steady = null, lastChangeAt = 0;
  let reads = 0, refused = 0;

  function reset() { locked = false; running = false; accepted = null; rawPrev = null; held = null; steady = null; }

  /* Could a clock at `fromMs` at time `fromAt` be showing `ms` now? It may have
     fallen by up to the time that has passed, with slack for frames we did not
     get; it may have stood still; it may not have risen. This one predicate is
     the whole physics, and it is asked twice -- once of the clock we believe, and
     once of a jump that is trying to convince us. */
  function fits(fromMs, fromAt, ms, now) {
    const dt = now - fromAt, drop = fromMs - ms;
    const slack = Math.min(C.slackMax, Math.max(C.slackMin, C.slackShare * dt));
    return drop >= -C.rise && drop <= dt + slack;
  }

  /* where the clock should be now, given what we last believed. The reader is
     handed this so a picture that can honestly be read two ways -- a board whose
     colon has blinked off shows "500" for both 5:00 and 50.0 -- is settled by the
     clock rather than by a coin toss. */
  function predict(now) {
    if (!accepted) return null;
    return running ? Math.max(0, accepted.ms - (now - accepted.at)) : accepted.ms;
  }

  /* Returns what to do with this reading:
       null                      nothing: it was not believed
       {ms, running, force}      believed; publish it (force = publish at once) */
  function consider(ms, now) {
    reads++;
    if (ms == null) return null;
    if (accepted && now - accepted.at > C.forget) reset();

    if (!locked) {
      /* NOTHING IS A CLOCK UNTIL IT BEHAVES LIKE ONE. Two readings that run down
         together at the speed of time, or one reading that holds still for over a
         second: either will do, and a board showing something else -- the shot
         clock, an idle display, a misframed box -- is neither. */
      let out = null;
      /* how long this exact value has been on the board. It has to be measured
         from the FIRST frame that showed it, not from the previous frame: reading
         four times a second, the previous frame is always a quarter of a second
         ago, so "the same value for over a second" could never once be true and a
         stopped clock could never be locked on to at all. Which meant the clock
         cam could only ever be started while the clock was RUNNING -- never
         before the tip, never during a time-out, which is when somebody setting
         up a camera actually does it. */
      if (!steady || steady.ms !== ms) steady = { ms, since: now };
      if (rawPrev) {
        const dt = (now - rawPrev.at) / 1000, drop = (rawPrev.ms - ms) / 1000;
        const runs = drop > 0.2 && Math.abs(drop - dt) <= Math.max(1.0, 0.6 * dt);
        const still = now - steady.since > 1200;
        if (runs || still) {
          locked = true; running = !!runs; accepted = { ms, at: now }; lastChangeAt = now;
          out = { ms, running, force: true };
        }
      }
      rawPrev = { ms, at: now };
      return out;
    }

    let out = null;

    if (fits(accepted.ms, accepted.at, ms, now)) {
      /* believable -- and a believable reading also ends any argument a jump was
         making, because the clock we already had is evidently still on the board */
      held = null;
      if (ms < accepted.ms - 100) { running = true; lastChangeAt = now; }
      else if (ms === accepted.ms && now - lastChangeAt > C.still) running = false;
      accepted = { ms, at: now };
      out = { ms, running, force: false };
    } else if (held && fits(held.ms, held.at, ms, now)) {
      /* the jump is still saying it, and behaving like a clock while it does */
      held.n++; held.ms = ms; held.at = now;
      if (held.n >= C.agreeN && now - held.first >= C.agreeMs) {
        /* a new period, or somebody at the table putting the clock right */
        held = null; running = false; lastChangeAt = now;
        accepted = { ms, at: now };
        out = { ms, running, force: true };
      }
    } else {
      held = { ms, at: now, first: now, n: 1 };
      refused++;
    }
    rawPrev = { ms, at: now };
    return out;
  }

  return {
    consider, predict, reset,
    get locked() { return locked; },
    get running() { return running; },
    get ms() { return accepted ? accepted.ms : null; },
    get raw() { return rawPrev ? rawPrev.ms : null; },
    get stats() { return { reads, refused }; },
  };
}

return { makeClock, DEFAULTS };
}));
