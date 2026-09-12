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
import { spawnSync } from 'node:child_process';

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

/* ---------------------------------------------------------------------------
   AND A BLANK BOX IS NOT AN OFFSET OF ZERO.

   The attach-video sheet read both jump-ball boxes as `+value || 0`, which
   cannot tell an empty one from a typed nought, and sent the result
   unconditionally. So pasting a link and leaving the time blank saved
   tip_offset_ms = 0 — and zero is not a refusal, it is the claim that the ball
   went up in the first frame of the recording. 0090's constraint accepts it
   (0..43200000), and gapMs prefers tip_offset_ms over every other anchor,
   unconditionally and for good reason: an offset was typed by somebody looking
   at the footage.

   One empty form therefore outranked the stream anchor for the life of the row
   and placed every play as if the broadcast began at the jump ball — early by
   the whole pre-game, five to twenty minutes on a league stream — with each
   position stated in full confidence, because as far as the page could tell a
   person had said so.
   --------------------------------------------------------------------------- */
console.log('\nand a blank box is not an offset of zero');

{
  const gj = readFileSync(path.join(ROOT, 'epinoia', 'game', 'game.js'), 'utf8');

  ok('the sheet can tell an empty box from a typed nought',
     /const blankOffset = String\(\(minEl && minEl\.value\) \|\| ''\)\.trim\(\) === '' &&/.test(gj));
  ok('...and sends nothing at all when both are empty',
     /const tipMs = blankOffset \? null : \(mm \* 60 \+ ss\) \* 1000;/.test(gj) &&
     /if \(tipMs != null\) args\.p_tip_offset_ms = tipMs;/.test(gj));
  ok('...which the RPC reads as "I did not say", not as zero',
     /tip_offset_ms\s+= coalesce\(p_tip_offset_ms, game_videos\.tip_offset_ms\)/
       .test(readFileSync(path.join(ROOT, 'supabase', 'migrations',
                                    '0090_two_kinds_of_video.sql'), 'utf8')));

  /* And a typed 0:00 still means the first frame, because it is a real answer. */
  const trimOnly = { tip_offset_ms: 0, trim_ms: 0 };
  eq('a typed 0:00 still places the tip at the first frame', V.gapMs(trimOnly), 0);
  ok('...and the anchor still reads as one somebody typed',
     V.anchorKind(trimOnly) === 'recording', String(V.anchorKind(trimOnly)));

  /* What the old behaviour cost, in the numbers of a league stream: a broadcast
     that went up eleven minutes before the ball. */
  const real = { stream_started_at: new Date(TIP - 11 * 60000).toISOString(),
                 tip_at: new Date(TIP).toISOString(), tip_wall: TIP, trim_ms: 0 };
  eq('the stream anchor puts the tip eleven minutes in', V.gapMs(real), 11 * 60000);
  const clobbered = Object.assign({}, real, { tip_offset_ms: 0 });
  eq('...and a blank form used to overrule it with nought', V.gapMs(clobbered), 0);
  ok('...which is the whole pre-game of error, silently',
     V.gapMs(real) - V.gapMs(clobbered) === 11 * 60000);
}

/* ---------------------------------------------------------------------------
   A PLAY WITH ONE NEIGHBOUR IS PROJECTED, AND THE RATE IS NOT 1:1.

   A play with neighbours on both sides is interpolated between them, which
   absorbs every stoppage between the two by construction. A play with only one
   has to be projected — and both single-sided branches added the game-clock
   difference straight onto the neighbour's position, which says a second of
   stopped clock costs no real time. Forty minutes of basketball inside a
   ninety-minute broadcast runs nearer 2:1, and nowhere near uniformly: a free
   throw pair, a timeout and a foul all cost real time and no game clock at all.

   This is the case that matters most tonight. When a feed correction un-times
   the early part of a log, every surviving stamp is LATER than the gap — so
   every unplaced play in the first half has exactly one neighbour, and all of
   them were being projected backwards at 1:1. Measured on tonight's fixtures:
   logs down to 8-32% stamped, with the losses concentrated at the front.
   --------------------------------------------------------------------------- */
console.log('\na play with one neighbour, and the rate that is not 1:1');

{
  /* The shape tonight's damage actually makes: the first half un-timed, the
     second half stamped, and a broadcast running at about 2:1 against the game
     clock. Q1 and Q2 carry no wall; Q3 and Q4 do. */
  const STREAM2 = Date.parse('2026-09-12T18:00:00Z');
  const TIP2 = Date.parse('2026-09-12T18:10:00Z');
  const PACE = 2;                        // two seconds of footage per second of clock

  const evs = [];
  let seq = 0;
  for (let q = 1; q <= 4; q++) {
    for (let i = 0; i < 10; i++) {
      const clock = 600000 - i * 60000;
      const cum = (q - 1) * 600000 + (600000 - clock);
      const e = { seq: ++seq, t: 'p2_made', team: 0, pid: 'h4', period: q, clock: clock,
                  created_at: new Date(TIP2 + cum * PACE).toISOString() };
      /* the stamps that survived: the second half only */
      if (q >= 3) e.wall = TIP2 + cum * PACE;
      evs.push(e);
    }
  }
  const row = {
    provider: 'youtube',
    stream_started_at: new Date(STREAM2).toISOString(),
    tip_at: new Date(TIP2).toISOString(),
    tip_wall: TIP2,
  };

  const placed = V.index(evs, row, { label: e => e.t });
  const byId = {};
  placed.forEach(pl => { byId[pl.id] = pl; });

  /* A Q1 play 30 minutes of game clock before the first stamp is beyond the
     reach of a single neighbour and is left out rather than invented. */
  ok('a play far beyond its only neighbour is not placed at all',
     byId[1] === undefined, JSON.stringify(byId[1] || null));

  /* One close enough IS placed, and at the measured pace rather than 1:1. The
     first stamped play is the start of Q3: cum 1200000, at 2x. A play 4 minutes
     of game clock earlier sits 8 minutes of footage earlier, not 4. */
  const q2late = evs.find(e => e.period === 2 && e.clock === 240000);   // cum 960000
  const got = byId[q2late.seq];
  if (got) {
    const firstStamped = evs.find(e => e.wall != null);
    const gap = (TIP2 - STREAM2);
    const truth = gap + (960000 * PACE);
    const oneToOne = gap + (1200000 * PACE) - (1200000 - 960000);
    ok('...and one within reach is placed at the measured pace',
       Math.abs(got.ms - truth) < 1000,
       'got ' + Math.round(got.ms / 1000) + 's, truth ' + Math.round(truth / 1000) +
       's, 1:1 would have said ' + Math.round(oneToOne / 1000) + 's');
    ok('...which is nowhere near what 1:1 would have said',
       Math.abs(oneToOne - truth) > 120000,
       'the two answers differ by ' + Math.round(Math.abs(oneToOne - truth) / 1000) + 's');
    ok('...and it is flagged as a guess, not stated flat',
       got.approx === true, JSON.stringify({ approx: got.approx }));
  } else {
    ok('...and one within reach is placed at the measured pace', false, 'not placed at all');
  }

  /* The stamped half is untouched by any of this. */
  const q3first = evs.find(e => e.period === 3 && e.clock === 600000);
  ok('a play that knows its own time is placed exactly, and not guessed',
     byId[q3first.seq] && byId[q3first.seq].approx === false,
     JSON.stringify(byId[q3first.seq] || null));
}

{
  const vj = readFileSync(path.join(ROOT, 'epinoia', 'video.js'), 'utf8');
  ok('the pace is measured from rows that know, not from guesses',
     /if \(r\.since == null \|\| r\.guessed\) continue;/.test(vj));
  ok('...and a nonsense rate is refused rather than used',
     /return \(p >= 1 && p <= 4\) \? p : null;/.test(vj));
  ok('...falling back to 1:1 only when nothing can be measured',
     /anchor\.since \+ d \* \(pace \|\| 1\)/.test(vj));
  ok('a lone neighbour has a reach, and a quarter is past it',
     /const LONE_REACH_MS = 600000;/.test(vj) &&
     /if \(Math\.abs\(d\) > LONE_REACH_MS\) continue;/.test(vj));
  ok('...and the two single-sided branches are now one, so they cannot drift apart',
     /\} else if \(before \|\| after\) \{/.test(vj));
}

/* ---------------------------------------------------------------------------
   A GAP IN THE CLOCK TRACK IS NOT AUTOMATICALLY A STOPPAGE.

   A clock track is a thousand readings of the overlay; what they describe is a
   few dozen stretches where the clock ran and the whistles between them. Between
   two runs the code returned the end of the first — the whistle — which is right
   when the clock STOOD still.

   But the clock also keeps running through a stretch the overlay cannot be read
   in: a full-screen replay, a graphic over the corner, a cut to the bench.
   runsFromTrack breaks a run when two readings are over thirty seconds apart or
   the clock did not fall by about the time between them, so an
   unreadable-but-running stretch leaves two runs whose clocks do NOT meet. Every
   play in that stretch was placed on the last readable frame — a minute of
   basketball collapsed onto one instant, and each row tagged byClock with no
   '~' on it.

   The clock itself tells the two apart: standing still, the readings either side
   agree; running through, it fell by about the real time that passed.
   --------------------------------------------------------------------------- */
console.log('\na gap in the clock track, read for what it is');

{
  /* Two runs with a 60 s hole. Case one: the clock STOOD (both sides read 9:00),
     so the whistle at the end of the first run is the moment. */
  const stood = { mode: 'clock', samples: [], runs: [
    { period: 1, t0: 100, t1: 160, c0: 600000, c1: 540000 },
    { period: 1, t0: 220, t1: 280, c0: 540000, c1: 480000 },
  ] };
  /* A true stoppage leaves the clock reading the SAME either side, so no clock
     value falls strictly between the runs: a play at that value sits inside the
     first run and lands on its end, which IS the whistle. */
  eq('a clock that stood places the play at the whistle',
     V.positionFromRuns(stood.runs, 1, 540000), 160 * 1000);

  /* The gap branch is reached when the clocks ALMOST meet -- a second of misread
     either side -- and that is still a stoppage, not a running clock. */
  const nearly = { runs: [
    { period: 1, t0: 100, t1: 160, c0: 600000, c1: 540000 },
    { period: 1, t0: 220, t1: 280, c0: 539000, c1: 480000 },
  ] };
  eq('...and a second of misread across the gap is still a stoppage',
     V.positionFromRuns(nearly.runs, 1, 539500), 160 * 1000);

  /* Case two: the clock RAN through the hole — 9:00 at the end of the first run,
     8:00 at the start of the second, and 60 s of footage between them. A play at
     8:30 sits half way through the hole, not on its front edge. */
  const ran = { runs: [
    { period: 1, t0: 100, t1: 160, c0: 600000, c1: 540000 },
    { period: 1, t0: 220, t1: 280, c0: 480000, c1: 420000 },
  ] };
  const mid = V.positionFromRuns(ran.runs, 1, 510000);      // half of 9:00 -> 8:00
  eq('a clock that ran through an unread stretch is placed across it',
     Math.round(mid / 1000), 190);
  ok('...which is not the front edge of the gap', Math.round(mid / 1000) !== 160,
     'got ' + Math.round(mid / 1000) + 's');
  eq('...and the ends of the hole still land on the runs either side',
     Math.round(V.positionFromRuns(ran.runs, 1, 539999) / 1000), 160);
}

{
  /* Outside the runs entirely, the projection crosses stoppages nobody read at a
     second of footage per second of clock. Bounded now: index() falls back to the
     wall-clock arithmetic for a play the track will not vouch for. */
  const R = [{ period: 1, t0: 600, t1: 660, c0: 300000, c1: 240000 }];
  ok('a clock just outside the runs is still projected',
     V.positionFromRuns(R, 1, 330000) != null);
  ok('...and one far outside is declined rather than guessed',
     V.positionFromRuns(R, 1, 590000) === null,
     String(V.positionFromRuns(R, 1, 590000)));
  ok('...on the late side too',
     V.positionFromRuns(R, 1, 60000) === null,
     String(V.positionFromRuns(R, 1, 60000)));

  const vj = readFileSync(path.join(ROOT, 'epinoia', 'video.js'), 'utf8');
  const va = readFileSync(path.join(ROOT, 'epinoia', 'videoanchor.js'), 'utf8');
  ok('the reach is named and reasoned about', /const RUN_REACH_MS = 120000;/.test(vj));
  ok('...and the stoppage test with it', /const GAP_STOOD_MS = 1500;/.test(vj));
  /* videoanchor.js carries a fallback for pages that do not load video.js, and
     its header insists the two place a play the same way. */
  ok('the standalone fallback is bounded the same way',
     /const REACH_MS = 120000;/.test(va) &&
     /The same bound as RUN_REACH_MS in epinoia\/video\.js/.test(va));
  ok('...and no longer claims the clock simply runs on',
     /"The clock runs on" is true of the clock and not of the game/.test(va));
}

/* ---------------------------------------------------------------------------
   THE KEY MUST NOT BE SPENT ON THE FIRST EVENING.

   Adding YOUTUBE_API_KEY switches on find_with_api, which calls YouTube's search.
   Google's quota page gives a project 100 search.list calls a day, separate from
   the 10,000 units everything else shares. write_platform calls attach() on every
   poll of a live game, attach() stops only once a video row exists, and nothing
   remembered an empty search — so one live game the channel feed failed to match
   searched on every poll and spent the day's hundred calls in about seventeen
   minutes, leaving every other game that day unfindable.

   Exercised against the real function with HTTP mocked: ninety polls of an
   unmatched game made ninety searches before and make one now, and a quota
   refusal holds the search off across other games until YouTube's reset.
   --------------------------------------------------------------------------- */
console.log('\nthe search allowance is rationed');

{
  const av = readFileSync(path.join(ROOT, 'scripts', 'ingest', 'auto_video.py'), 'utf8');
  ok('a search that found nothing is remembered per fixture',
     /_SEARCH_SEEN\[seen_key\] = \(time\.time\(\), None\)/.test(av));
  ok('...and not repeated for twenty minutes', /SEARCH_RETRY_S = 20 \* 60/.test(av) &&
     /time\.time\(\) - hit\[0\] < SEARCH_RETRY_S/.test(av));
  ok('...keyed on the fixture, so a different game still gets its own search',
     /seen_key = \(\(home or ""\)\.lower\(\), \(away or ""\)\.lower\(\), tip\.date\(\)\.isoformat\(\)\)/.test(av));
  ok('a quota refusal switches the search off rather than hammering it',
     /if r\.status_code == 403 and re\.search\(r"quota\|dailyLimit\|rateLimit"/.test(av) &&
     /_SEARCH_DEAD_UNTIL = _next_quota_reset\(\)/.test(av));
  ok('...until YouTube resets it, at midnight Pacific',
     /ZoneInfo\("America\/Los_Angeles"\)/.test(av));
  ok('...and only the SEARCH: stream starts come from a separate pool and keep working',
     /It is finding broadcasts that dies, not timing them/.test(av) &&
     !/_SEARCH_DEAD_UNTIL/.test(av.slice(av.indexOf('def watch_details'), av.indexOf('def _instant') > av.indexOf('def watch_details') ? av.indexOf('def _instant') : av.indexOf('def watch_details') + 4000)));
  ok('the quota figure is cited to its source', /determine_quota_cost/.test(av));
}

/* ---------------------------------------------------------------------------
   THE WORKER PLACES A PLAY WHERE THE PAGE DOES, OR NOT AT ALL.

   ai_worker.wall_hints turns the log's stamps into video positions before a frame
   is read: they narrow the reader onto the right stretch of footage, and when the
   picture has no readable clock they BECOME the track (wall_track). The page
   prefers a saved track to its own arithmetic, so a wrong hint outranks a right
   answer for the life of the row.

   It had its own arithmetic. It subtracted a play's stamp straight from
   stream_started_at, ignored a typed tip_offset_ms, and filled a missing stamp
   with created_at — the moment the row was written, which for a log a feed
   correction rewrote is one instant for every play. Inert only because no video
   had a stream start; YOUTUBE_API_KEY supplies them.

   Run against the real Python function with the database faked, and compared
   with video.js on the same rows — not with a copy of the formula.
   --------------------------------------------------------------------------- */
console.log('\nthe worker places plays by the page\'s arithmetic');

{
  const HARNESS = [
    'import sys, json, types',
    "sys.modules['requests'] = types.ModuleType('requests')",
    'sys.path.insert(0, sys.argv[1])',
    'import ai_worker as W',
    'out = []',
    'for case in json.load(sys.stdin):',
    '    class DB:',
    '        def select(self, table, q, case=case):',
    "            return case['video'] if table == 'game_videos' else case['events']",
    '    out.append(W.wall_hints(DB(), "g"))',
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');

  const pyRun = (cases) => {
    for (const exe of ['python3', 'python']) {
      const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'worker')],
                          { input: JSON.stringify(cases), encoding: 'utf8' });
      if (r.status === 0 && r.stdout.includes('@@')) return JSON.parse(r.stdout.split('@@').pop());
      if (r.status !== null && r.stderr && /Traceback/.test(r.stderr)) throw new Error(r.stderr);
    }
    throw new Error('no python to run ai_worker.wall_hints with');
  };

  const S0 = Date.parse('2026-09-12T18:50:00Z');         // YouTube's actualStartTime
  const T0 = Date.parse('2026-09-12T19:00:00Z');         // the ball goes up
  /* twenty plays a minute apart while the clock runs thirty seconds each, every
     one stamped by the poll that saw it, four seconds late, claiming +-12 s */
  const fed = (walls) => [
    { seq: 1, t: 'period_start', period: 1, clock: 600000, created_at: '2026-09-12T23:59:59Z',
      payload: { wall: walls(0), wall_err: 12000 } },
    ...Array.from({ length: 20 }, (_, i) => ({
      seq: i + 2, t: i % 2 ? 'p2_made' : 'p3_miss', period: 1, clock: 600000 - (i + 1) * 30000,
      created_at: '2026-09-12T23:59:59Z',
      payload: { wall: walls(i + 1), wall_err: 12000 } })),
  ];
  const liveWalls = k => T0 + 4000 + k * 60000;
  const streamRow = { stream_started_at: new Date(S0).toISOString(), tip_at: new Date(liveWalls(0)).toISOString(),
                      tip_wall: liveWalls(0), tip_offset_ms: null, trim_ms: 0 };
  const recRow = { stream_started_at: null, tip_at: new Date(liveWalls(0)).toISOString(),
                   tip_wall: liveWalls(0), tip_offset_ms: 7 * 60000, trim_ms: 0 };

  const cases = [
    /* 0 */ { video: [streamRow], events: fed(liveWalls) },
    /* 1 */ { video: [recRow], events: fed(liveWalls) },
    /* 2 */ { video: [Object.assign({}, recRow, { stream_started_at: new Date(S0).toISOString() })], events: fed(liveWalls) },
    /* 3 */ { video: [streamRow], events: fed(liveWalls).map(e => Object.assign({}, e, { payload: {} })) },
    /* 4 */ { video: [streamRow], events: fed(k => T0 + 3 * 3600000 + k * 400) },
    /* 5 */ { video: [Object.assign({}, streamRow, { tip_wall: null })], events: fed(liveWalls) },
    /* 6 */ { video: [Object.assign({}, streamRow, { tip_wall: null })],
              events: fed(liveWalls).map((e, i) => i ? e : Object.assign({}, e, { payload: {} })) },
    /* 7 */ { video: [streamRow], events: fed(k => liveWalls(k) + (k >= 12 ? 240000 : 0)) },
    /* 8 */ { video: [streamRow], events: fed(liveWalls).map(e => Object.assign({}, e, { payload: { wall: e.payload.wall } })) },
  ];

  let got = null;
  try { got = pyRun(cases); } catch (err) { ok('ai_worker.wall_hints runs', false, String(err.message || err).slice(-600)); }

  if (got) {
    const pageMs = (row, e) => V.videoMsOf({ wall: e.payload.wall, created_at: e.created_at }, row);
    const agrees = (hints, row, events) => {
      const want = new Map(events.map(e => [e.period + ':' + e.clock, pageMs(row, e)]));
      return hints.length > 0 && hints.every(([ts, per, clk]) => Math.abs(ts * 1000 - want.get(per + ':' + clk)) < 1);
    };

    eq('a stream-anchored fed game: every play the page can place, the worker places',
       got[0].length, fed(liveWalls).length);
    ok('...at the same millisecond as video.js', agrees(got[0], streamRow, fed(liveWalls)),
       JSON.stringify(got[0].slice(0, 3)));
    eq('...which is the play\'s stamp less the stream start, the tip cancelling',
       Math.round((got[0][5] || [NaN])[0] * 1000), liveWalls(5) - S0);

    ok('a recording anchored by a typed offset is placed too (it used to be skipped)',
       agrees(got[1], recRow, fed(liveWalls)), JSON.stringify(got[1].slice(0, 2)));
    eq('...with tip-off at the typed seven minutes', Math.round((got[1][0] || [NaN])[0] * 1000), 7 * 60000);
    ok('a typed offset outranks a stream start, as it does on the page',
       got[1].length > 0 && JSON.stringify(got[2]) === JSON.stringify(got[1]));

    eq('a log with no stamps places nothing: created_at is when a row was written', got[3].length, 0);
    eq('a log whose stamps span eight seconds for ten minutes of clock places nothing', got[4].length, 0);

    ok('a video row missing tip_wall takes it from the first period_start\'s stamp',
       JSON.stringify(got[5]) === JSON.stringify(got[0]));
    eq('...and with no stamp there either, nothing is placed', got[6].length, 0);

    const g7 = got[7];
    ok('an error bar is widened to the real spacing of the polls, not the configured one',
       g7.filter(h => h[2] > 600000 - 12 * 30000 && h[2] < 600000).length === 11 &&
       g7.filter(h => h[2] > 600000 - 12 * 30000 && h[2] < 600000).every(h => h[3] === 60000) &&
       (g7.find(h => h[2] === 600000) || [])[3] === 12000, JSON.stringify(g7.slice(0, 3)));
    ok('...and a play behind a four-minute hole in the polling is dropped, not guessed',
       !g7.some(h => h[2] === 600000 - 12 * 30000) && g7.some(h => h[2] === 600000 - 13 * 30000));
    ok('a scorer\'s tap with no wall_err keeps the generous default',
       got[8].length === 21 && got[8].every(h => h[3] === 15000));
  }

  const aw = readFileSync(path.join(ROOT, 'scripts', 'worker', 'ai_worker.py'), 'utf8');
  const fn = aw.slice(aw.indexOf('def wall_hints('), aw.indexOf('def wall_track('));
  ok('the worker no longer reads created_at at all', !/created_at'\)/.test(fn) && !/select=[^']*created_at/.test(fn));

  const gj = readFileSync(path.join(ROOT, 'epinoia', 'game', 'game.js'), 'utf8');
  const tw = gj.slice(gj.indexOf('function tipWallMs()'), gj.indexOf('function tipInstantMs()'));
  ok('the game page saves tip_wall only from a stamp on the plays\' own clock',
     tw.length > 0 && !/created_at/.test(tw) && /ev\.wall/.test(tw));
  ok('...while the stream and file anchors keep an insert time, for a log written live',
     /function tipInstantMs\(\)[\s\S]{0,600}logIsTimed\(events\)/.test(gj) &&
     (gj.match(/await tipInstantMsAsync\(\)/g) || []).length === 2 && !/tipWallMsAsync/.test(gj));
}

/* ---------------------------------------------------------------------------
   A NEW VIDEO DOES NOT INHERIT THE OLD ONE'S CLOCK.

   Pasting a different video over an attached one kept the old recording's
   tip_offset_ms, stream start, trim and clock track (set_game_video coalesced
   every column), so every play was placed at its second in footage nobody was
   watching. Migration 0115 starts the footage anchors again when the video
   changes; the worker must not write a track of the old footage onto the new
   row afterwards, and a repointed video must be free to be read again.
   --------------------------------------------------------------------------- */
console.log('\na new video does not inherit the old one\'s clock');

{
  const m = readFileSync(path.join(ROOT, 'supabase', 'migrations', '0115_new_video_new_anchors.sql'), 'utf8');
  ok('0115 decides sameness by the provider id, else the link',
     /create or replace function public\.video_is_same/.test(m) &&
     /same := old\.id is null\s*\n\s*or public\.video_is_same\(old\.url, old\.provider, old\.video_ref, p_url, p_provider, p_ref\)/.test(m));
  for (const col of ['stream_started_at', 'tip_offset_ms', 'trim_ms', 'is_live', 'clock_track']) {
    ok('...and carries ' + col + ' only while it is the same footage',
       new RegExp(col + '\\s*=\\s*case when same then ').test(m));
  }
  ok('...while the tip-off, a fact about the game, is kept whatever the video',
     /tip_at\s*=\s*coalesce\(tip_final, game_videos\.tip_at\)/.test(m) &&
     /tip_wall\s*=\s*coalesce\(p_tip_wall, game_videos\.tip_wall\)/.test(m));
  ok('...proved through the real function as a real admin, and cleaned up on the way out',
     /set local role authenticated/.test(m) && /raise exception '0115: a different video kept a clock track/.test(m) &&
     /exception when others then[\s\S]{0,200}delete from public\.game_videos where game_id = gid and video_ref like '__t115%'/.test(m));

  const HARNESS = [
    'import sys, json, types',
    'try:',
    '    import requests',
    'except ImportError:',
    "    sys.modules['requests'] = types.ModuleType('requests')   # a bare CI python; nothing here calls it",
    'sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])',
    'import ai_worker as AW',
    'import run_ingest as RI',
    'OLD, NEW = "https://youtu.be/AAAAAAAAAAA", "https://www.youtube.com/watch?v=BBBBBBBBBBB&t=1"',
    'out = {}',
    'class DB:',
    '    def __init__(self): self.q = None',
    '    def patch(self, table, q, body):',
    '        self.q = q',
    '        from urllib.parse import unquote',
    '        return [{"id": 1}] if ("url=eq." not in q or unquote(q.split("url=eq.")[1].split("&")[0]) == NEW) else []',
    'track = {"mode": "clock", "samples": [{"t": 1.0, "period": 1, "clock_ms": 600000}], "runs": []}',
    'db = DB()',
    'AW.write_track(db, "g", track, NEW); out["new_ok"] = True; out["q"] = db.q',
    'try:',
    '    AW.write_track(db, "g", track, OLD); out["old_written"] = True',
    'except RuntimeError as e:',
    '    out["old_written"] = False; out["old_msg"] = str(e)',
    'class SB:',
    '    def __init__(self, jobs): self.jobs, self.inserted = jobs, []',
    '    def select(self, table, q):',
    '        return [{"url": NEW, "clock_track": None}] if table == "game_videos" else self.jobs',
    '    def insert(self, table, row): self.inserted.append(row)',
    'a = SB([{"status": "done", "video_url": OLD}]); RI.enqueue_video_job(a, "g")',
    'b = SB([{"status": "done", "video_url": NEW}]); RI.enqueue_video_job(b, "g")',
    'out["requeued_for_new"] = len(a.inserted); out["requeued_same"] = len(b.inserted)',
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');

  let got = null;
  for (const exe of ['python3', 'python']) {
    const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'worker'), path.join(ROOT, 'scripts', 'ingest')],
                        { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    if (r.status === 0 && r.stdout.includes('@@')) { got = JSON.parse(r.stdout.split('@@').pop()); break; }
    if (r.stderr && /Traceback/.test(r.stderr)) { ok('the worker and ingest run', false, r.stderr.slice(-800)); break; }
  }
  if (got) {
    ok('the worker writes a track onto the video it was read from', got.new_ok === true &&
       /url=eq\.https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DBBBBBBBBBBB%26t%3D1/.test(got.q), got.q);
    ok('...and refuses once the row holds a different video, saying why',
       got.old_written === false && /changed while this one was being read/.test(got.old_msg || ''), JSON.stringify(got));
    ok('a done read of the OLD video does not stop the new one being read', got.requeued_for_new === 1);
    ok('...while a done read of THIS video still does', got.requeued_same === 0);
  } else if (!fail) ok('a python to run the worker with', false);

  const aw = readFileSync(path.join(ROOT, 'scripts', 'worker', 'ai_worker.py'), 'utf8');
  ok('the worker passes the job\'s own link when it saves the track',
     /slim = write_track\(db, game_id, track, row\.get\('video_url'\)\)/.test(aw));
  ok('...and its backfill counts a job only against the footage it was for',
     /have = \[j for j in have if j\.get\('video_url'\) == url_of\.get\(j\['game_id'\]\)\]/.test(aw));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
