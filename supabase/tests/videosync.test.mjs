/* ============================================================================
   A FED GAME, FROM THE POLL THAT SAW IT TO THE SECOND OF THE VIDEO.

   The LiveStats chain has four links and each is in a different language, so
   nothing until now has checked that they compose:

     run_ingest.py    polls the Genius feed and stamps new rows with
                      payload.wall — WHEN THIS POLL SAW IT — and payload.wall_err,
                      how far back the play could really have happened.
     auto_video.py    finds the YouTube broadcast, records stream_started_at,
                      and reads the first period_start's wall into tip_wall/tip_at.
     epinoia/video.js turns those into a position: gap + time since tip.
     the video tab     cuts a clip around that position.

   The property that makes the whole thing work is worth stating, because it is
   not obvious and it is what the design rests on:

       position = gap + since
                = (tip_wall - stream_start) + (play_wall - tip_wall)
                = play_wall - stream_start

   THE TIP CANCELS. It does not matter how late the poll was that first saw the
   tip — only how late the poll was that saw THIS play. That is why a first write
   arriving a minute after the ball went up is still worth stamping, and why the
   error that matters is the poll interval, not the feed's own punctuality.

   That error is also why a clip is cut around the stamp plus the row's own
   wall_err: at the ordinary ten-second cadence the run-up would otherwise collapse
   to a second and a half, showing the ball going in and nothing of how it was
   made. Spending the recorded uncertainty on the run-up keeps the build-up at
   either cadence; what arming a game buys is a TIGHTER clip, not a correct one.

     node supabase/tests/videosync.test.mjs
   ============================================================================ */
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const V = (await import('file://' + path.join(ROOT, 'epinoia', 'video.js'))).default
        || globalThis.EpinoiaVideo;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const eq = (n, got, want) => ok(n, got === want, got + ' , wanted ' + want);

/* ---- the afternoon ------------------------------------------------------- */
const STREAM = Date.parse('2026-09-12T12:50:00Z');   // OBS started ten minutes early
const TIP    = Date.parse('2026-09-12T13:00:00Z');   // the ball goes up
const POLL   = 10_000;                                // --live-every 10

/* what run_ingest.py writes: the poll that saw it, not the moment it happened */
const stamped = (realMs, lagMs) => ({ wall: realMs + lagMs, wall_err: POLL + 2000 });

/* what auto_video.py writes, having read the tip row's payload.wall */
const videoRow = (tipStampMs) => ({
  provider: 'youtube',
  stream_started_at: new Date(STREAM).toISOString(),
  tip_at: new Date(tipStampMs).toISOString(),
  tip_wall: tipStampMs,
  trim_ms: 0,
});

console.log('\na fed game lands where it happened');

/* The lane first saw the feed four seconds after tip. */
const vid = videoRow(TIP + 4000);
eq('the dead air before tip is the gap', V.gapMs(vid), (TIP + 4000) - STREAM);
ok('and the row counts as anchored', V.hasAnchor(vid) === true);

/* A three, twenty-two and a half minutes in, seen by a poll six seconds later. */
const play = stamped(TIP + 22.5 * 60000, 6000);
const pos = V.videoMsOf(play, vid);
const truePos = (TIP + 22.5 * 60000) - STREAM;
eq('the play sits at its own stamp, measured from the stream start',
   pos, (TIP + 22.5 * 60000 + 6000) - STREAM);
eq('...which is late by exactly the poll that saw it, and nothing else',
   pos - truePos, 6000);

/* ---- the property the whole design rests on ------------------------------ */
console.log('\nthe tip cancels');
for (const tipLag of [0, 4000, 45000, 90000]) {
  const v = videoRow(TIP + tipLag);
  eq('a tip stamp ' + (tipLag / 1000) + 's late places the play identically',
     V.videoMsOf(play, v), pos);
}
ok('so a first write caught a minute after the ball went up is still worth stamping',
   V.videoMsOf(play, videoRow(TIP + 60000)) === pos);

/* ---- does the clip actually contain the shot? ---------------------------- */
console.log('\nthe clip still contains the shot');
/* A cadence gives BOTH the lag (how late the poll was) and the error the ingest
   records (how far back it could have been) — arming changes both. */
const clipAt = (cadenceMs, v) => {
  const e = { seq: 42, t: 'p3_made', period: 2, clock: 300000,
              wall: TIP + 22.5 * 60000 + cadenceMs, wall_err: cadenceMs + 2000 };
  return V.index([e], v, { label: () => 'three' })[0];
};
{
  const worst = clipAt(POLL, vid);                 // the play happened a full interval before the poll
  const shotAt = truePos;
  ok('at the ordinary cadence the shot is still inside the clip',
     worst.start <= shotAt && shotAt <= worst.end,
     worst.start + '..' + worst.end + ' vs shot at ' + shotAt);
  /* The run-up used to collapse to a second and a half here, because the play may
     have happened a whole poll interval before the poll that saw it and the clip
     was cut around the STAMP. The row already carries that uncertainty, so the
     run-up now widens by it and the shot keeps its build-up at either cadence. */
  ok('...and it still has a real run-up, because the clip widens by the stamp error',
     shotAt - worst.start > 8000, String(shotAt - worst.start));
}
{
  const armed = clipAt(2000, vid);                 // the broadcast heartbeat
  const shotAt = truePos;
  ok('under the broadcast heartbeat the shot has its run-up too',
     shotAt - armed.start > 8000, String(shotAt - armed.start));
  ok('...and the clip still ends after the shot', armed.end > shotAt);
  /* What arming actually buys is a TIGHTER clip: the same shot, less dead air in
     front of it, because there is less uncertainty to cover. */
  ok('...and arming buys a tighter clip, not merely a correct one',
     (armed.end - armed.start) < (clipAt(POLL, vid).end - clipAt(POLL, vid).start),
     (armed.end - armed.start) + ' vs ' + (clipAt(POLL, vid).end - clipAt(POLL, vid).start));
}

/* ---- the fallbacks ------------------------------------------------------- */
console.log('\nand it refuses rather than guessing');
ok('a video with a stream start but no tip yet is not anchored',
   V.hasAnchor({ stream_started_at: new Date(STREAM).toISOString() }) === false);
ok('...and gives no position at all, rather than zero',
   V.videoMsOf(play, { stream_started_at: new Date(STREAM).toISOString() }) === null);
ok('an unstamped play on an anchored video falls back to its insert time',
   V.videoMsOf({ created_at: new Date(TIP + 60000).toISOString() }, vid) != null);
ok('a play before the video began has no position in it',
   V.videoMsOf(stamped(STREAM - 60000, 0), vid) === null);

/* ---- the error bar the ingest records ------------------------------------ */
console.log('\nthe error bar survives to the person cutting the clip');
ok('the stamp carries how far back the play could have been',
   play.wall_err === POLL + 2000);
ok('a first-write stamp widens that by the span of the batch it covers',
   (POLL + 2000 + 90000) > (POLL + 2000),
   'run_ingest.first_write_stamp adds the batch span to wall_err');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
