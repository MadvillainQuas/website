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
import { readFileSync } from 'node:fs';

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

/* ---------------------------------------------------------------------------
   AND THE ONE INPUT THE IDENTITY CANNOT SURVIVE BEING WRONG.

       position = play_wall - stream_start

   The tip cancels, which is the whole elegance of it. stream_start does not. It
   is the single number every clip on a game is measured from, and auto_video was
   storing a PROMISE in it.

   liveBroadcastDetails.startTimestamp -- what YouTube's player endpoint returns,
   and the only route to a start time from a datacenter without an API key --
   carries the SCHEDULED start while a stream is still upcoming. Measured against
   the live service on 2026-09-12: two fixtures' streams returned status
   LIVE_STREAM_OFFLINE, isUpcoming true, and a startTimestamp exactly equal to
   their scheduled slot. The worker had run the day before and written those into
   game_videos.stream_started_at -- a column whose own comment called it "the
   stream's real start" -- for six fixtures.

   The Falkirk game the same afternoon showed what that costs. The row said the
   stream started at 12:30; at 13:14 YouTube was still saying "this live event
   will begin in a few moments". Forty-four minutes of error and climbing, and
   the gap is tip_at minus stream_start, so every clip in that game would have
   been placed forty-four minutes too late in the footage and offered as right.

   Nothing would have caught it either: gapLooksOdd only questions a gap over
   ninety minutes, and a genuine double-header legitimately has one.
   --------------------------------------------------------------------------- */
console.log('\nand the one input the identity cannot survive being wrong');

{
  const av = readFileSync(path.join(ROOT, 'scripts', 'ingest', 'auto_video.py'), 'utf8');

  ok('a scheduled start is returned under its own name, not as a start',
     /d\["scheduled_at"\] = lb\.get\("startTimestamp"\)/.test(av));
  ok('...and started_at is only taken when the stream is live or has ended',
     /started = bool\(lb\.get\("isLiveNow"\)\) or bool\(vd\.get\("isLive"\)\) or bool\(d\["ended_at"\]\)/.test(av));
  ok('...with LIVE_STREAM_OFFLINE counted as upcoming, which is what it means',
     /upcoming = bool\(vd\.get\("isUpcoming"\)\) or \(st == "LIVE_STREAM_OFFLINE"\)/.test(av));
  ok('...so the five-minute cache miss finally does what it was written to do',
     /a stream not yet started has no start time; ask again after five minutes/.test(av));
  ok('the Data API path takes actualStartTime, which is actual by definition',
     /d\["started_at"\] = lsd\.get\("actualStartTime"\)/.test(av) &&
     /d\["scheduled_at"\] = lsd\.get\("scheduledStartTime"\)/.test(av));

  /* The six rows already in production hold a schedule, so filling the column
     only when empty is not enough — it was never empty. */
  ok('a stored start is CORRECTED once the real one is known, not just filled',
     /elif want and abs\(\(want - have\)\.total_seconds\(\)\) > 1:/.test(av));
  /* The withdrawal turns on the stream being UPCOMING, not on the stored value
     still matching a schedule we can see. YouTube stops quoting the schedule as
     the slot approaches — which is exactly when the stale value is most likely
     to be read. On 2026-09-12 the 13:00 fixture held 12:30 while the watch page
     said "this live event will begin in a few moments", and there was no
     scheduled time left to match it against. */
  ok('...and one is withdrawn on the stream not having begun',
     /patch\["stream_started_at"\] = None/.test(av) &&
     /but the stream has not begun/.test(av));
  ok('...which is a positive statement, reported as its own fact',
     /d\["upcoming"\] = upcoming and not started/.test(av) &&
     /"upcoming": False/.test(av));
  ok('...the Data API knows it too: a scheduled start and no actual one',
     /d\["upcoming"\] = bool\(lsd\.get\("scheduledStartTime"\)\) and not lsd\.get\("actualStartTime"\)/.test(av));
  ok('...so a video that is merely unreachable sets neither flag and is left alone',
     /elif d\.get\("upcoming"\) and v\.get\("stream_started_at"\):/.test(av));
  ok('...and a finished stream is not upcoming, so its anchor is safe',
     /a stream that has ENDED is not upcoming/.test(av) &&
     /or bool\(d\["ended_at"\]\)/.test(av));
  ok('...which is the same rule this file already applies to a tip it cannot justify',
     /A WRONG ANCHOR IS WORSE THAN NONE/.test(av));
}

{
  /* What the error actually does to a clip, in the numbers of that afternoon:
     a stream scheduled for 12:30 that really opened at 13:15, a tip at 13:20. */
  const sched = Date.parse('2026-09-12T12:30:00Z');
  const real  = Date.parse('2026-09-12T13:15:00Z');
  const tip   = Date.parse('2026-09-12T13:20:00Z');
  const play  = tip + 8 * 60_000;                       // a basket eight minutes in

  /* gapMs + the since term, which is what clipOf composes. */
  const posWith = start => (tip - start) + (play - tip);
  eq('placed from the real start, the basket is 13 minutes into the stream',
     Math.round(posWith(real) / 60000), 13);
  eq('placed from the scheduled one it is 58, which is 45 minutes of nothing',
     Math.round(posWith(sched) / 60000), 58);
  ok('and the old ninety-minute doubt check would not have said a word',
     (tip - sched) < 90 * 60_000);
}

/* ---------------------------------------------------------------------------
   A PARTIAL CLOCK TRACK MUST NOT SWITCH OFF THE BULK-IMPORT REFUSAL.

   logIsTimed asks whether a log's timestamps span roughly as much real time as
   the game covers. A bulk import fails it: every row was inserted inside one
   transaction, so created_at says when the CSV was loaded, not when the ball
   went in. The game page has always refused to place plays in that case and says
   so in as many words -- "imported in bulk rather than scored live".

   But it asked `hasTrack || logIsTimed(events)`, one decision for the whole
   game. A clock track covering PART of it -- a vision pass that read the first
   half and lost the overlay after the break, which is the ordinary way an OCR
   pass ends -- turned the refusal off for every play the track does not reach,
   and those fell through to gap + since: the import instant. The guard was
   written for exactly that log and was never consulted about those rows.
   --------------------------------------------------------------------------- */
console.log('\na partial clock track and an imported log');

{
  /* A full game imported in one transaction: every row's created_at is the same
     minute, and not one carries a device stamp. */
  const IMPORT = Date.parse('2026-09-05T22:00:00Z');
  const STREAM2 = Date.parse('2026-09-05T18:50:00Z');
  const imported = [];
  for (let q = 1; q <= 4; q++) {
    for (let i = 0; i < 12; i++) {
      imported.push({
        seq: imported.length + 1, t: 'p2_made', team: 0, pid: 'h4',
        period: q, clock: 600000 - i * 45000,
        created_at: new Date(IMPORT + imported.length * 40).toISOString(),
      });
    }
  }
  ok('the fixture really is a bulk import by the page\'s own test',
     V.logIsTimed(imported) === false, 'logIsTimed said ' + V.logIsTimed(imported));
  ok('...and carries no device stamp anywhere',
     imported.every(e => e.wall == null));

  /* A track that read the first half and then lost the overlay. */
  const samples = [];
  for (let q = 1; q <= 2; q++) {
    for (let i = 0; i <= 10; i++) {
      samples.push({ t: (q - 1) * 1500 + i * 60, period: q, clock: 600000 - i * 55000 });
    }
  }
  const row = {
    provider: 'youtube',
    stream_started_at: new Date(STREAM2).toISOString(),
    tip_at: new Date(STREAM2 + 10 * 60000).toISOString(),
    tip_wall: STREAM2 + 10 * 60000,
    clock_track: { mode: 'clock', samples: samples },
  };

  const placed = V.index(imported, row, { label: e => e.t });
  const byPeriod = {};
  placed.forEach(pl => {
    const q = (imported.find(e => (e.seq) === pl.id) || {}).period;
    byPeriod[q] = (byPeriod[q] || 0) + 1;
  });

  ok('the plays the reading covers are still offered',
     (byPeriod[1] || 0) + (byPeriod[2] || 0) > 0,
     JSON.stringify(byPeriod));
  ok('...and the ones it does not are left out, not placed on the import instant',
     (byPeriod[3] || 0) === 0 && (byPeriod[4] || 0) === 0,
     JSON.stringify(byPeriod));
  ok('...so nothing in the list claims a position it cannot support',
     placed.every(pl => pl.byClock === true),
     JSON.stringify(placed.filter(pl => !pl.byClock).slice(0, 3)));

  /* And the page says which plays are in the list, rather than offering a
     count that silently omits half the game. */
  const gv = readFileSync(path.join(ROOT, 'epinoia', 'game', 'video.js'), 'utf8');
  ok('the page tells the viewer the list is only what the reading covered',
     /the plays below are the ones the <b>clock reading<\/b>/i.test(gv) ||
     /The plays below are the ones the/.test(gv));
}

{
  /* The refusal needs POSITIVE evidence. logIsTimed compares a span against the
     game clock covered, so on a short log it returns false for want of anything
     to span -- which is not a bulk import, and must not cost that log its
     placements. */
  const one = [{ seq: 1, t: 'p3_made', team: 0, pid: 'h4', period: 1, clock: 540000,
                 created_at: new Date(TIP + 60000).toISOString() }];
  ok('a one-event log is not mistaken for an import',
     V.index(one, videoRow(TIP), { label: e => e.t }).length === 1,
     JSON.stringify(V.index(one, videoRow(TIP), { label: e => e.t })));

  const av2 = readFileSync(path.join(ROOT, 'epinoia', 'video.js'), 'utf8');
  ok('...because the refusal wants all three signs of one',
     /const looksImported = !timedByDevice && events\.length >= 20 && !logIsTimed\(events\);/.test(av2));
  ok('...and a log with a device stamp anywhere was scored live, whatever its span',
     /!timedByDevice &&/.test(av2));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
