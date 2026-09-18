/* ============================================================================
   TWO GAMES THAT MAPPED TO THE WRONG FOOTAGE, HELD AS FIXTURES.

   Everything else about the video feature is tested against logs this repository
   writes for the purpose. These two are the opposite: they are the real rows of
   two real broadcasts that the seeking feature got wrong in public, kept because
   the ways they are broken are not ways anybody would think to invent.

     106394dc  Loughborough Riders v Oaklands Wolves, 2026-09-12
               video g5LxfyKNYtU, 8,333.9 s long.
               The play list opened at Q3 1:57 (1:54:15 into the video) and the
               first two quarters were simply not there. Two causes, stacked:
               an ingest rewrite re-inserted seq 1-893 with empty payloads, so
               the only wall stamps left were the last 2:07 of the fourth
               quarter; and the worker then narrowed its read onto those stamps,
               looking at 537 s of the broadcast and calling it a reading. The
               footer said "placed by the game clock, 69 readings, checked".

     52bfe03b  Milton Keynes Breakers v Loughborough Riders, 2026-09-13
               video 5hVqAraI-Zc, 6,949 s long.
               The first listed play mapped to the passage where the score was
               7-9 with 7:52 on the clock. Its score reading is a single sample
               at confidence zero, so saneTrack throws the track away and the
               page falls back to insert times -- and 784 rows share five insert
               instants, 668 of them one instant five hours and fifty minutes
               after tip-off. Twenty plays sat on the first instant and 256 sat
               at 6:03:11 of a video one hour fifty-five minutes long.

   And two games that were fine, so that a guard written for the broken ones
   cannot quietly cost the healthy ones their plays:

     4f60a6be  a clean score-mode reading, 74 of 78 changes matched.
     f3ab9bc9  a clean clock reading, 968 samples across all four quarters.

   THE FIXTURES ARE THE LIVE ROWS. Downloaded from the public REST API, then
   trimmed: loc/tag/stype descriptors dropped and payloads cut to the keys that
   place a play (wall, wall_err, in, out, ref), player ids replaced by p1, p2...
   Every trim was checked against the untrimmed rows first -- index(), logIsTimed
   and coverageNote all come out identical. game_videos has no duration column,
   so each fixture carries video_s, read off the broadcast itself.

     node supabase/tests/video-mapping.test.mjs
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

const FIX = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'video-mapping');
const load = name => JSON.parse(readFileSync(path.join(FIX, name), 'utf8'));

/* the box score's own flattener (game.js rowToEvent): the payload is merged onto
   the event, which is how payload.wall becomes e.wall */
const rowToEvent = r => {
  const e = Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock }, r.payload || {});
  if (r.team != null) e.team = r.team;
  if (r.pid != null) e.pid = r.pid;
  if (r.created_at) { e.created_at = r.created_at; e.seq = r.seq; }
  return e;
};

const game = name => {
  const video = load(name + '.video.json');
  const events = load(name + '.events.json').map(rowToEvent);
  const plays = V.index(events, video, { label: e => e.t });
  return { video, events, plays, note: V.coverageNote(video, events, plays) };
};

const MK   = game('mk-loughborough');
const LOUG = game('loughborough-oaklands');
const H1   = game('healthy-4f60a6be');
const H2   = game('healthy-f3ab9bc9');

/* ---- 0. the fixtures still carry the defect ------------------------------ */
/* A guard is only worth its test while the broken input is still broken. If a
   later trim of these fixtures quietly removes the pile-up, every assertion
   below would pass against data that could not fail. */
console.log('\nthe rows in the fixtures are still the rows that went wrong');

{
  const rows = load('mk-loughborough.events.json');
  const byInsert = new Map();
  for (const r of rows) byInsert.set(r.created_at, (byInsert.get(r.created_at) || 0) + 1);
  const worst = Math.max(...byInsert.values());
  ok('52bfe03b still writes hundreds of plays on one insert instant',
     worst >= 300 && byInsert.size <= 8, worst + ' rows share one of ' + byInsert.size + ' instants');
  /* A handful of late rows do carry payload.wall, but the tip does not, so the
     page has nothing to subtract them from and reads the whole log by insert
     time (index(): timedByDevice needs tipStamp too). That is what puts the
     insert clock in charge here, and why guarding only the tap stamp missed it. */
  ok('...and has no tip stamp, so every play is placed by its insert time',
     MK.video.tip_wall == null &&
     rows.filter(r => r.payload && r.payload.wall != null).length < rows.length / 10,
     'tip_wall=' + MK.video.tip_wall);
  const t = MK.video.clock_track;
  ok('...and its score reading is one sample nobody was sure of',
     t.mode === 'score' && t.samples.length === 1 && t.samples[0].conf === 0,
     JSON.stringify(t.samples));
  ok('...which saneTrack refuses, so the page has only the insert times',
     V.saneTrack(t, MK.video).samples.length === 0);
}

{
  const rows = load('loughborough-oaklands.events.json');
  const stamped = rows.filter(r => r.payload && r.payload.wall != null);
  ok('106394dc still has stamps on only the last few plays',
     stamped.length > 0 && stamped.length < rows.length / 5,
     stamped.length + ' of ' + rows.length);
  ok('...all of them in the fourth quarter',
     stamped.every(r => r.period === 4), JSON.stringify([...new Set(stamped.map(r => r.period))]));
  const ts = LOUG.video.clock_track.samples.map(s => s.t);
  ok('...and its reading covers the last few minutes of an 8,334 s broadcast',
     Math.min(...ts) > 7000 && Math.max(...ts) < LOUG.video.video_s,
     Math.round(Math.min(...ts)) + '..' + Math.round(Math.max(...ts)) + ' s');
}

/* ---- 1. the Milton Keynes game ------------------------------------------- */
console.log('\n52bfe03b: the first play is no longer wherever the first write landed');

{
  const gap = V.gapMs(MK.video);                       // 13:28 -- the tip, and the first write
  const first = MK.plays[0];
  ok('there is still a list to look at', MK.plays.length > 50, String(MK.plays.length));
  ok('the first listed play is NOT on the first write’s instant',
     Math.abs(first.ms - gap) > 30000,
     V.stamp(first.ms) + ' vs the instant at ' + V.stamp(gap));
  /* It is earlier, and it should be: the first write covered the opening 2:08 of
     the game, so the jump ball is that much before it rather than on it. */
  ok('...it is before it, because the write came after the play it recorded',
     first.ms < gap, V.stamp(first.ms));
  ok('...and it is the period_start, in the first quarter',
     first.t === 'period_start' && first.period === 1, first.t + ' Q' + first.period);

  const pile = new Map();
  for (const p of MK.plays) pile.set(Math.round(p.ms / 1000), (pile.get(Math.round(p.ms / 1000)) || 0) + 1);
  const worst = Math.max(...pile.values());
  ok('no instant carries a sixth of the game any more',
     worst < MK.plays.length / 6, worst + ' plays on one second, of ' + MK.plays.length);

  /* The 6:03:11 placements: past the end of the footage, and past anything the
     game could have produced. */
  const over = MK.plays.filter(p => p.ms > MK.video.video_s * 1000);
  eq('no play is offered past the end of its video', over.length, 0);
  ok('...and the six-hour pile is gone entirely',
     !MK.plays.some(p => p.ms > 3 * 3600000),
     JSON.stringify(MK.plays.filter(p => p.ms > 3 * 3600000).slice(0, 3)));
  ok('every clip also ends inside the footage',
     MK.plays.every(p => p.end <= MK.video.video_s * 1000));
  ok('...and starts at or after the beginning of it', MK.plays.every(p => p.start >= 0));
  ok('the list is in video order', MK.plays.every((p, i) => i === 0 || p.ms >= MK.plays[i - 1].ms));
}

console.log('\n...and the page says what it could not place');

{
  ok('the note exists at all', !!MK.note);
  ok('it does not claim a reading it does not have',
     MK.note.kind === 'rejected' && !/placed by the game clock/.test(MK.note.text), MK.note.text);
  ok('it names the periods with nothing in them',
     /nothing placed in/.test(MK.note.text) && MK.note.missing.length > 0, MK.note.text);
  ok('...and the count it reports is the count that is listed',
     MK.note.listed === MK.plays.length && MK.note.total > MK.note.listed,
     MK.note.listed + ' of ' + MK.note.total);
}

/* ---- 2. the Loughborough game -------------------------------------------- */
console.log('\n106394dc: the plays it can place are still placed, and the rest is admitted');

{
  ok('it still lists its third and fourth quarters', LOUG.plays.length > 120, String(LOUG.plays.length));
  const pers = [...new Set(LOUG.plays.map(p => p.period))].sort();
  ok('...both of them', pers.includes(3) && pers.includes(4), JSON.stringify(pers));
  ok('no play is offered past the end of its video',
     LOUG.plays.every(p => p.ms <= LOUG.video.video_s * 1000),
     V.stamp(Math.max(...LOUG.plays.map(p => p.ms))) + ' of ' + V.stamp(LOUG.video.video_s * 1000));
  ok('the list is in video order', LOUG.plays.every((p, i) => i === 0 || p.ms >= LOUG.plays[i - 1].ms));

  /* The footer used to count the STORED readings. saneTrack drops two of them as
     readings this game could not have produced, and the two the page places by
     are 67, not 69. */
  const raw = LOUG.video.clock_track.samples.length;
  const sane = V.saneTrack(LOUG.video.clock_track, LOUG.video).samples.length;
  ok('the reading really does lose samples to saneTrack', sane < raw, sane + ' of ' + raw);
  ok('the note counts the readings that place plays, not the ones that were stored',
     LOUG.note.readings === sane && new RegExp('\\b' + sane + ' readings').test(LOUG.note.text),
     LOUG.note.text);
  ok('...and says the first two quarters are missing',
     LOUG.note.missing.join(',') === '1,2' && /nothing placed in Q1 and Q2/.test(LOUG.note.text),
     LOUG.note.text);
  ok('...in a sentence a reader can act on',
     /missing from the list/.test(LOUG.note.title), LOUG.note.title);
}

/* ---- 3. the healthy games are untouched ---------------------------------- */
/* The counts are pinned. Not because 80 and 424 are meaningful numbers, but
   because a guard aimed at two broken games must not quietly cost a working one
   a single play, and only a pin will say so. */
console.log('\nthe games that were already right place exactly what they placed before');

eq('4f60a6be still lists 80 plays', H1.plays.length, 80);
ok('...every one of them by the clock overlay', H1.plays.every(p => p.byClock));
ok('...and none of them guessed', H1.plays.every(p => !p.approx));
eq('f3ab9bc9 still lists 424 plays', H2.plays.length, 424);
ok('...every one of them by the clock overlay', H2.plays.every(p => p.byClock));
ok('...and none of them guessed', H2.plays.every(p => !p.approx));
ok('4f60a6be’s note does not invent a complaint',
   H1.note.kind === 'score' && !/nothing placed/.test(H1.note.text), H1.note.text);

/* ---- 4. the rules themselves --------------------------------------------- */
console.log('\nthe rules, stated on logs small enough to check by hand');

{
  const TIP = Date.parse('2026-09-13T16:05:21Z');
  const row = (seq, period, clockSec, insert) => ({
    seq, t: 'p2_made', pid: 'p1', period, clock: clockSec * 1000,
    created_at: new Date(insert).toISOString() });

  /* One write covering two minutes of play: only what happened at the end of it
     can honestly claim the write's instant. */
  const batch = [row(1, 1, 600, TIP), row(2, 1, 570, TIP), row(3, 1, 480, TIP), row(4, 1, 478, TIP)];
  const d = V.distrustedStamps(batch, 'insert');
  ok('an insert instant is not a time for the plays before the last of its batch',
     d.has(batch[0]) && d.has(batch[1]) && !d.has(batch[3]), String(d.size));
  ok('...and the same rows are trusted when they were written one at a time',
     V.distrustedStamps([row(1, 1, 600, TIP), row(2, 1, 570, TIP + 30000),
                         row(3, 1, 480, TIP + 120000)], 'insert').size === 0);
  ok('the device-stamp rule is unchanged by the new argument',
     V.distrustedStamps(batch).size === 0, 'no row here carries a tap stamp');

  /* The physics bound, on a stamp rather than on a reading. */
  const q4 = { t: 'p2_made', period: 4, clock: 0 };
  ok('a fourth-quarter play cannot have happened six hours after tip-off',
     V.stampIsPossible(q4, 5.83 * 3600000) === false);
  ok('...and an ordinary two hours after tip-off is fine',
     V.stampIsPossible(q4, 2 * 3600000) === true);
  ok('a first-quarter play cannot be an hour after tip-off either',
     V.stampIsPossible({ t: 'p2_made', period: 1, clock: 600000 }, 3600000) === false);
  ok('...and a stamp with no time at all is not a position',
     V.stampIsPossible(q4, null) === false);
}

{
  /* A projection may not anchor another projection. One honest stamp at the top
     of a log used to lay the whole game out at the projected pace; now the rows
     beyond LONE_REACH_MS of that one stamp get no position and are left out. */
  const TIP = Date.parse('2026-09-13T16:05:21Z');
  const vid = { provider: 'youtube', video_ref: 'x', tip_offset_ms: 600000,
                tip_at: new Date(TIP).toISOString(), tip_wall: TIP, trim_ms: 0 };
  const log = [{ seq: 1, t: 'period_start', period: 1, clock: 600000, wall: TIP }];
  for (let i = 0; i < 60; i++) {                       // one play every 30 s of clock, no stamps
    const per = 1 + Math.floor(i / 15), clock = 600000 - (i % 15) * 40000;
    log.push({ seq: i + 2, t: 'p2_made', pid: 'p1', period: per, clock,
               created_at: new Date(TIP).toISOString() });
  }
  const idx = V.index(log, vid, { label: e => e.t });
  ok('a single honest stamp does not place the whole game',
     idx.length < log.length, idx.length + ' of ' + log.length);
  ok('...it places the plays near it and stops', idx.length > 1, String(idx.length));
  ok('...and everything it does place is within ten minutes of clock of that stamp',
     idx.every(p => V.cumElapsed(p) <= 600000 + 1),
     JSON.stringify(idx.map(p => V.cumElapsed(p)).filter(x => x > 600000)));
}

{
  /* A LOG WHOSE ORDER IS NOT THE GAME'S ORDER. fillGaps takes its neighbours by
     position in the log; 52bfe03b's rewrite renumbered it, so an early foul sits
     eighty rows after plays that came later. Both neighbours then had the same
     elapsed game time, and everything between them was given one position. */
  const TIP = Date.parse('2026-09-13T16:05:21Z');
  const vid = { provider: 'youtube', video_ref: 'x', tip_offset_ms: 600000,
                tip_at: new Date(TIP).toISOString(), tip_wall: TIP, trim_ms: 0 };
  const stamped = (seq, clockSec, wallSec) => ({ seq, t: 'p2_made', pid: 'p1', period: 1,
    clock: clockSec * 1000, wall: TIP + wallSec * 1000 });
  const loose = (seq, clockSec) => ({ seq, t: 'p2_made', pid: 'p1', period: 1, clock: clockSec * 1000 });

  const log = [stamped(1, 600, 0), stamped(2, 500, 100)];
  for (let i = 0; i < 8; i++) log.push(loose(3 + i, 460 - i * 40));   // elapsed 140..420 s
  log.push(stamped(11, 500, 90));                                    // the out-of-order row
  const idx = V.index(log, vid, { label: e => e.t });
  const mid = idx.filter(p => p.id >= 3 && p.id <= 10).sort((x, y) => x.id - y.id);
  eq('the rows between two same-clock neighbours are all placed', mid.length, 8);
  ok('...and not all on one frame',
     new Set(mid.map(p => Math.round(p.ms))).size === mid.length,
     JSON.stringify(mid.map(p => Math.round(p.ms / 1000))));
  ok('...they run forwards, as the game did',
     mid.every((p, i) => i === 0 || p.ms > mid[i - 1].ms),
     JSON.stringify(mid.map(p => Math.round(p.ms / 1000))));
}

/* ---- 5. the worker, run rather than read --------------------------------- */
/* The same harness videosync.test.mjs uses: the real Python functions with the
   database and the skill faked, so what is checked is the code that ships. */
console.log('\nthe worker reads the whole broadcast unless the stamps cover it');

{
  const HARNESS = [
    'import sys, json, types',
    "sys.modules['requests'] = types.ModuleType('requests')",
    'sys.path.insert(0, sys.argv[1])',
    'import ai_worker as W',
    'case = json.load(sys.stdin)',
    'out = {}',
    "out['windows'] = [W.reading_window(c['hints'], c['ctx']) for c in case['windows']]",
    "out['version'] = W.VERSION",
    'class CK:',
    '    @staticmethod',
    '    def pbp_score_events(raw):',
    '        return raw',
    "out['scores'] = [list(W.score_track_earns_it(c['track'], c.get('pbp'), CK)) for c in case['scores']]",
    '# "CURRENT" stands for whatever version this worker reports, which is the',
    '# thing that makes a re-read offer terminate; the test cannot know it',
    "for t in case['rereads'] + [c['track'] for c in case['queue'] if c['track']]:",
    "    if (t.get('coverage') or {}).get('worker') == 'CURRENT':",
    "        t['coverage']['worker'] = W.VERSION",
    "out['rereads'] = [list(W.wants_reread(t)) for t in case['rereads']]",
    "out['queue'] = [list(W.may_queue(c['track'], c['statuses'])) for c in case['queue']]",
    "out['slim'] = W.slim_track(case['slim'])",
    'sys.stdout.write("@@" + json.dumps(out))',
  ].join('\n');

  const pyRun = (input) => {
    for (const exe of ['python3', 'python']) {
      const r = spawnSync(exe, ['-c', HARNESS, path.join(ROOT, 'scripts', 'worker')],
                          { input: JSON.stringify(input), encoding: 'utf8' });
      if (r.status === 0 && r.stdout.includes('@@')) return JSON.parse(r.stdout.split('@@').pop());
      if (r.status !== null && r.stderr && /Traceback/.test(r.stderr)) throw new Error(r.stderr);
    }
    throw new Error('no python to run ai_worker with');
  };

  /* 106394dc's own shape: nineteen stamps, all of them in the last 2:07 of a
     game whose log ends at 40:00, sitting at 8,082-8,350 s of the footage. */
  const LOUGH_HINTS = [[8082.0, 4, 127000, 15000], [8350.0, 4, 0, 15000]];
  const LOUGH_CTX = { log_elapsed_ms: 2400000, hint_first_elapsed_ms: 2266000,
                      hint_last_elapsed_ms: 2400000, first_period: 4 };

  const input = {
    windows: [
      /* 0 */ { hints: LOUGH_HINTS, ctx: LOUGH_CTX },
      /* 1: stamps across the whole game -- narrow both ends, as before */
      { hints: [[600.0, 1, 600000, 9000], [7000.0, 4, 0, 9000]],
        ctx: { log_elapsed_ms: 2400000, hint_first_elapsed_ms: 0, hint_last_elapsed_ms: 2400000, first_period: 1 } },
      /* 2: stamps only at the START -- close that end, read to the end of the file */
      { hints: [[600.0, 1, 600000, 9000], [900.0, 1, 300000, 9000]],
        ctx: { log_elapsed_ms: 2400000, hint_first_elapsed_ms: 0, hint_last_elapsed_ms: 300000, first_period: 1 } },
      /* 3: no stamps at all -- the nine games this must not touch */
      { hints: [], ctx: {} },
      /* 4: stamps, but no context (an older caller) -- nothing is narrowed */
      { hints: LOUGH_HINTS, ctx: {} },
    ],
    scores: [
      /* 52bfe03b: one change matched of six seen, at confidence zero */
      { track: { matched: 1, changes_seen: 6, samples: [{ conf: 0, score: [2, 0] }] } },
      /* 7f424d2f: one of three, confidence 0.085 */
      { track: { matched: 1, changes_seen: 3, samples: [{ conf: 0.085, score: [2, 0] }] } },
      /* a40d3cef: 44 of 62 */
      { track: { matched: 44, changes_seen: 62, samples: [{ conf: 0.9, score: [71, 64] }] } },
      /* 4e5b98e9: 72 of 85 -- and it stops at the end of the fourth, before an
         overtime, so its top reading is NOT the final score. Still kept. */
      { track: { matched: 72, changes_seen: 85, samples: [{ conf: 0.9, score: [80, 80] }] },
        pbp: [[4, 0, 80, 80], [5, 0, 91, 88]] },
      /* enough matches, but the overlay climbed past a score this game reached */
      { track: { matched: 40, changes_seen: 50, samples: [{ conf: 0.9, score: [103, 98] }] },
        pbp: [[4, 0, 71, 64]] },
      /* plenty matched, but nothing was read with any confidence */
      { track: { matched: 40, changes_seen: 50, samples: [{ conf: 0.05, score: [2, 0] }] } },
      /* half the overlay's changes belong to some other game */
      { track: { matched: 10, changes_seen: 40, samples: [{ conf: 0.9, score: [2, 0] }] } },
    ],
    rereads: [
      { coverage: { worker: 'ai_worker/1.0', read_frac: 0.99 } },
      { mode: 'score', samples: [] },
      { coverage: { worker: 'CURRENT', read_frac: 0.065 } },
      { coverage: { worker: 'CURRENT', read_frac: 0.99 } },
    ],
    queue: [
      /* 0: 106394dc as it stands -- read once, by the old worker, 6% covered */
      { track: { coverage: { worker: 'ai_worker/1.0', read_frac: 0.065 } }, statuses: ['done'] },
      /* 1: the same, but read twice already -- that answer stands */
      { track: { coverage: { worker: 'ai_worker/1.0', read_frac: 0.065 } }, statuses: ['done', 'done'] },
      /* 2: a clean reading by this worker -- left alone */
      { track: { coverage: { worker: 'CURRENT', read_frac: 0.99 } }, statuses: ['done'] },
      /* 3: never read at all -- the original rule, untouched */
      { track: null, statuses: [] },
      /* 4: a job is running for this footage right now */
      { track: { coverage: { worker: 'ai_worker/1.0', read_frac: 0.065 } }, statuses: ['done', 'running'] },
      /* 5: two failures is still enough, whatever the track says */
      { track: null, statuses: ['failed', 'cancelled'] },
      /* 6: 7f424d2f's shape -- it failed twice in a download loop, and was then read badly
         (one sample at confidence 0.085, which places nothing). The failures came BEFORE the
         reading, so they do not count against reading it again. */
      { track: { coverage: { worker: 'ai_worker/1.0', read_frac: 0.02 } }, statuses: ['failed', 'failed', 'done'] },
      /* 7: ...but two failures SINCE that reading do stop it */
      { track: { coverage: { worker: 'ai_worker/1.0', read_frac: 0.02 } }, statuses: ['done', 'failed', 'failed'] },
    ],
    slim: { mode: 'score', video: 'x.mp4', source: 'clock.py (score mode)',
            matched: 2, changes_seen: 3,
            samples: [{ t: 10.0, period: 1, clock_ms: 590000, conf: 0.9, how: 'score', score: [2, 0] },
                      { t: 40.0, period: 1, clock_ms: 560000, conf: 0.1, how: 'score', score: [2, 3] }],
            read_window: { start_s: 7992.0, end_s: 8530.0 }, video_s: 8333.9 },
  };

  let got = null;
  try { got = pyRun(input); } catch (err) { ok('ai_worker runs', false, String(err.message || err).slice(-800)); }

  if (got) {
    const w = got.windows;
    const shape = x => (x.start_s === undefined ? '-' : Math.round(x.start_s)) + '..' +
                       (x.end_s === undefined || x.end_s === null ? 'end' : Math.round(x.end_s));

    ok('106394dc is read from the beginning of the footage, not from its last stamps',
       w[0].start_s === undefined && Math.round(w[0].end_s) === 8530, shape(w[0]));
    ok('...which is the difference between 537 s of an 8,334 s broadcast and all of it',
       shape(w[0]) === '-..8530');
    ok('stamps that cover the whole game still narrow both ends',
       Math.round(w[1].start_s) === 510 && Math.round(w[1].end_s) === 7180, shape(w[1]));
    ok('stamps that reach only the tip close that end and leave the other open',
       Math.round(w[2].start_s) === 510 && w[2].end_s === undefined, shape(w[2]));
    ok('a game with no usable stamps is still read whole',
       Object.keys(w[3]).length === 0, shape(w[3]));
    ok('...and so is one whose caller offered no context',
       Object.keys(w[4]).length === 0, shape(w[4]));

    const s = got.scores.map(x => x[0]);
    ok('52bfe03b’s score reading is refused before it is written',
       s[0] === false, got.scores[0][1]);
    ok('7f424d2f’s is refused too', s[1] === false, got.scores[1][1]);
    ok('a40d3cef’s 44 of 62 is kept', s[2] === true, got.scores[2][1]);
    ok('...and 4e5b98e9’s, which stops before the overtime it never read',
       s[3] === true, got.scores[3][1]);
    ok('a reading that climbed past the game’s final score is refused',
       s[4] === false, got.scores[4][1]);
    ok('...as is one nothing was sure of', s[5] === false, got.scores[5][1]);
    ok('...as is one that matched a quarter of what it saw', s[6] === false, got.scores[6][1]);
    ok('and a refusal says why, for the job row and the log',
       got.scores[0][1].length > 20 && /5 needed/.test(got.scores[0][1]), got.scores[0][1]);

    const r = got.rereads.map(x => x[0]);
    ok('a track an older worker wrote is worth a second read', r[0] === true, got.rereads[0][1]);
    ok('...as is one with no coverage summary at all', r[1] === true, got.rereads[1][1]);
    ok('...and one that only ever saw 6% of its footage', r[2] === true, got.rereads[2][1]);
    eq('a full reading by this worker is not', r[3], false);

    /* and the whole thing has to terminate: the backfill runs hourly, and a
       broadcast nobody can read will store poor coverage every time it is tried. */
    const q = got.queue.map(x => x[0]);
    ok('106394dc, read once by the old worker over 6% of its footage, is queued again',
       q[0] === true && /1\.0/.test(got.queue[0][1]), got.queue[0][1]);
    eq('...but one piece of footage is never read more than twice', q[1], false);
    eq('a game this worker read properly is left alone', q[2], false);
    eq('a game that was never read is queued, exactly as before', q[3], true);
    eq('...and nothing is queued behind a job already running for it', q[4], false);
    eq('...nor after two failures, which is the rule that was already there', q[5], false);
    ok('a game that was never read is queued without a re-read reason',
       got.queue[3][1] === '', got.queue[3][1]);
    /* 7f424d2f is the one game on the platform whose video tab lists nothing at all. Counting
       the two failures it had BEFORE its bad reading would have made that permanent. */
    eq('failures before a reading do not block reading it again', q[6], true);
    eq('...two failures since the reading do', q[7], false);

    const slim = got.slim;
    ok('a stored score reading keeps the score it read, so it can be audited',
       slim.samples.every(x => Array.isArray(x.score)), JSON.stringify(slim.samples[0]));
    ok('the track carries a coverage summary, inside the JSON, needing no migration',
       !!slim.coverage && slim.coverage.worker === got.version, JSON.stringify(slim.coverage));
    ok('...which says what fraction of the footage was read',
       Math.round(slim.coverage.read_frac * 1000) === 65, String(slim.coverage.read_frac));
    ok('...and how many readings cleared the confidence floor',
       slim.coverage.samples === 2 && slim.coverage.sure_samples === 1, JSON.stringify(slim.coverage));
    ok('...and which periods it holds', JSON.stringify(slim.coverage.periods) === '[1]');
  }
}

/* The current-version rows have to be judged against the version the worker
   actually reports, which the harness only learns at run time. */
{
  const aw = readFileSync(path.join(ROOT, 'scripts', 'worker', 'ai_worker.py'), 'utf8');
  ok('the worker version is bumped, which is what offers the old tracks back once',
     /VERSION = 'ai_worker\/1\.1'/.test(aw));
  ok('the reader is told which period a narrowed window opens in, when it can take it',
     /_accepts\(CK\.run_auto, 'start_period'\)/.test(aw));
  ok('...and says so plainly when it cannot',
     /cannot be told the window opens in period/.test(aw));
  ok('the ingest’s matching gate is named rather than silently left behind',
     /run_ingest\.py has the same enqueue gate/.test(aw));
}

/* ============================================================================
   A THIRD REAL BROADCAST: e3d1193e, Loughborough Riders v Hemel Storm, 2026-09-06,
   video dx3_ugdfECM. Read whole (993 readings, 42 runs, all four quarters) and
   still placing its plays about a minute late at the start of the first quarter.

   THE GROUND TRUTH IS THE BROADCAST'S OWN SCOREBUG: at 47:10 of the video it
   reads 7:58 of the first quarter. Nothing in the track says so — that is the
   point of it — so it is written here as the fixed point the placement is
   measured against.

   TWO THINGS WERE WRONG, both about footage outside a run.

   A run only exists where the clock was seen RUNNING, so a stoppage — the clock
   standing at one value while the footage goes on — can never be one, and
   positionFromRuns could not see those readings at all. And past the ends of the
   runs it projected at a second of footage per second of clock, which is what a
   clock does only while it is running: across a whole quarter of this game the
   footage runs at 2.04, 2.02, 1.83 and 2.31 times the clock.
   ============================================================================ */
{
  const F = load('loughborough-storm.video.json');
  const track = F.clock_track;
  const at = (p, c) => { const v = V.positionFromTrack(track, p, c); return v == null ? null : v / 1000; };

  ok('the fixture is the whole reading: four quarters, runs and readings both',
     track.samples.length === 993 && track.runs.length === 42 &&
     new Set(track.runs.map(r => r.period)).size === 4);

  /* the scorebug's own reading, and how far the placement lands from it */
  const TRUTH_T = 2830, TRUTH_C = 478000;          // 47:10 of video is Q1 7:58
  const got = at(1, TRUTH_C);
  ok('Q1 7:58 is placed within 40s of where the broadcast shows it',
     got != null && Math.abs(got - TRUTH_T) <= 40,
     got == null ? 'not placed' : `placed ${got.toFixed(0)}s, broadcast says ${TRUTH_T}s (${(got - TRUTH_T).toFixed(0)}s out)`);
  ok('...which it was not before: projecting at a second a second put it 77s late',
     got != null && got - TRUTH_T < 70,
     got == null ? 'not placed' : `${(got - TRUTH_T).toFixed(0)}s out`);

  /* the clock only falls as the footage runs: placements must not go backwards */
  const ladder = [548000, 510000, 478000, 450000, 432000, 400000, 360000]
    .map(c => at(1, c)).filter(v => v != null);
  ok('a falling clock gives a rising position, all the way down the quarter',
     ladder.every((v, i) => i === 0 || v >= ladder[i - 1]), JSON.stringify(ladder));

  /* A STOPPAGE IS EVIDENCE. 7:12 stands from 2930 to 2950 in this track: readings, never
     a run. The play that stopped the clock belongs at the front of that window. */
  const stood = track.samples.filter(s => s.period === 1 && s.clock_ms === 432000).map(s => s.t);
  const lo = Math.min(...stood), hi = Math.max(...stood);
  ok('the clock standing at Q1 7:12 is in the readings but in no run',
     stood.length > 1 && !track.runs.some(r => r.period === 1 && r.c0 >= 432000 && r.c1 <= 432000),
     `${stood.length} readings, ${lo}-${hi}s`);
  const atStood = at(1, 432000);
  ok('...and a play at that clock is placed inside the window it was on screen',
     atStood != null && atStood >= lo - 1 && atStood <= hi + 1,
     atStood == null ? 'not placed' : `${atStood}s, window ${lo}-${hi}s`);

  /* inside a run the clock demonstrably ran a second a second: that must stay exact */
  const r = track.runs.find(x => x.period === 1);
  const mid = (r.c0 + r.c1) / 2;
  const want = r.t0 + (r.c0 - mid) / 1000;
  ok('inside a run the placement is still the run, to the second',
     Math.abs(at(1, mid) - want) < 1.5, `${at(1, mid)} vs ${want}`);

  /* and the projection past the ends runs at the rate the quarter actually ran at */
  const R1 = track.runs.filter(x => x.period === 1).sort((a, b) => a.t0 - b.t0);
  const rate = (R1[R1.length - 1].t1 - R1[0].t0) / ((R1[0].c0 - R1[R1.length - 1].c1) / 1000);
  ok('the first quarter really does take about twice its clock in footage',
     rate > 1.6 && rate < 2.6, rate.toFixed(2) + 'x');
  const out40 = at(1, R1[0].c0 + 40000);
  ok('...so 40s of clock before the first run is more than 40s of footage before it',
     out40 != null && (R1[0].t0 - out40) > 55,
     out40 == null ? 'not placed' : `${(R1[0].t0 - out40).toFixed(0)}s of footage`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
