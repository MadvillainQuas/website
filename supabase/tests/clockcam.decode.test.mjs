/* ============================================================================
   THE CLOCK CAM DECODER, ON A BENCH.

   The clock cam reads a hall's scoreboard through a phone camera. Until now the
   only way to know whether a change to that decoder helped was to hold a phone up
   at a scoreboard, which means it was never really known at all: one hall, one
   board, one light level, one afternoon.

   So this renders scoreboards. Seven-segment digits, drawn from the same segment
   geometry a real board uses, put through the things that actually go wrong in a
   sports hall:

     dim          a board at the far end of a hall, or a cheap one
     flicker      LEDs are pulse-width modulated; a 1/250s phone exposure catches
                  some segments mid-cycle and they come out dark
     banding      rolling shutter across a PWM board: horizontal dark bands
     blur         a hand-held phone, or a focus that has given up
     noise        a phone sensor pushed in a dark hall
     glare        a window, a ceiling light, or the board's own perspex
     angle        nobody clamps a phone perfectly square to the board
     bright       a board that is dark digits on a light panel
     dots         a dot-matrix board rather than true segments
     colon        the colon on most boards BLINKS -- half the frames do not have it

   For each case it renders many boards, decodes them, and counts three outcomes:

     right   the decoder returned the right number
     WRONG   the decoder returned a different number    <- the one that matters
     none    the decoder declined to answer

   A decline is cheap: the clock cam simply waits for the next frame, a quarter of
   a second later, and the broadcast graphics tick on undisturbed. A WRONG reading
   is the expensive one -- it is published, and every layer on the stream slews to
   a clock that never existed. So the bench is scored on wrongness first and read
   rate second, and the thresholds below are set accordingly.

     node supabase/tests/clockcam.decode.test.mjs
     node supabase/tests/clockcam.decode.test.mjs --verbose    (per-case detail)
   ============================================================================ */
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const D = (await import('file://' + path.join(ROOT, 'epinoia', 'clockcam', 'decode.js'))).default
        || globalThis.CCDecode;
const { rng, renderCrop } = await import('file://' + path.join(ROOT, 'supabase', 'tests', 'fixtures', 'scoreboard.mjs'));

const VERBOSE = process.argv.includes('--verbose');

/* ----------------------------------------------------------------- cases ---
   Clock faces a real board shows, with the milliseconds they mean. */
const CLOCKS = [
  ['10:00', 600000], ['9:59', 599000], ['8:07', 487000], ['7:30', 450000],
  ['5:00', 300000], ['4:44', 284000], ['3:21', 201000], ['2:08', 128000],
  ['1:00', 60000], ['0:59', 59000], ['0:33', 33000], ['0:10', 10000],
  ['12:00', 720000], ['11:11', 671000],
];
/* under a minute most boards switch to seconds and tenths */
const TENTHS = [['34.5', 34500], ['12.8', 12800], ['59.9', 59900], ['5.0', 5000], ['09.3', 9300]];

const CASES = [
  { name: 'clean', opt: {} },
  { name: 'dim board', opt: { dim: 0.42 } },
  { name: 'very dim', opt: { dim: 0.26, noise: 0.02 } },
  { name: 'PWM flicker', opt: { flicker: 0.30, flickerDepth: 0.55 } },
  { name: 'rolling band', opt: { banding: 0.55 } },
  { name: 'hand blur', opt: { blur: 2 } },
  { name: 'soft focus', opt: { blur: 4 } },
  { name: 'sensor noise', opt: { noise: 0.09 } },
  { name: 'glare', opt: { glare: 0.45 } },
  { name: 'angle 4deg', opt: { angle: 4 } },
  { name: 'angle 8deg', opt: { angle: 8 } },
  { name: 'bright board', opt: { bright: true } },
  { name: 'dot matrix', opt: { dots: 5 } },
  { name: 'small crop', opt: { W: 120 } },
  { name: 'loose box', opt: { fill: 0.55 } },
  { name: 'blinking colon', opt: { colonOff: true }, colonOnly: true },
  /* A DEAD LAMP ROW. Half the digits come out as shapes that are not digits, and
     one of them comes out the height and width of a colon. Before the separator
     was told apart by counting its bands of ink, a 10:03 that lost its leading 1
     that way was read as 0:03 -- ten minutes wrong, and the SAME ten minutes wrong
     on every frame, which is the one kind of error that survives corroboration and
     reaches the stream. The read rate here is expected to be poor. The WRONG rate
     is what this case exists to hold at nothing. */
  { name: 'dead middle lamps', opt: { drop: ['g'] }, broken: true },
  { name: 'dead top lamps', opt: { drop: ['a'] }, broken: true },
  { name: 'dead upper-left lamps', opt: { drop: ['f'] }, broken: true },
  { name: 'hall: dim+flicker+blur', opt: { dim: 0.45, flicker: 0.22, flickerDepth: 0.45, blur: 2, noise: 0.03 } },
  { name: 'hall: band+angle+noise', opt: { banding: 0.4, angle: 5, noise: 0.05 } },
  /* THE SAME BOARDS, READ THE WAY THE APP READS THEM. Every LED board is pulse-width
     modulated, so a single exposure misses segments outright; the app averages three
     frames before reading. These rows are what a real phone gets, and the difference
     on a flickering board is the difference between usable and not. */
  { name: 'PWM flicker x3', opt: { flicker: 0.30, flickerDepth: 0.55 }, stack: 3 },
  /* STRESS, NOT A TARGET. This drops nearly half the segments to a third of their
     brightness INDEPENDENTLY of each other on every frame, which is worse than a
     real board does: the lamps on a scoreboard share a driver, so PWM dims them
     together -- which is the "dim" and "rolling band" cases, both of which read
     perfectly. This one exists to show where the decoder gives up rather than to
     be passed, and it is excluded from the per-case ceiling below for that reason.
     What protects a broadcast at this severity is not the decoder but the physics
     downstream: clockcam.clock.test.mjs runs a whole quarter at a worse error rate
     than this and publishes nothing wrong. */
  { name: 'heavy flicker x3', opt: { flicker: 0.45, flickerDepth: 0.7 }, stack: 3, stress: true },
  { name: 'hall dim+flicker x3', opt: { dim: 0.45, flicker: 0.22, flickerDepth: 0.45, blur: 2, noise: 0.03 }, stack: 3 },
];

const N = 12;   // renders per face per case

/* TWO REGIMES, BECAUSE THE CLOCK CAM HAS TWO.

   COLD is the first frame: the app has no clock yet, so a picture that could
   honestly be read two ways has nothing to break the tie and must decline.
   TRACKING is every frame after that: the app knows what the clock said a moment
   ago, which is all it takes to know that "500" is five minutes and not fifty
   seconds. Tracking is where the clock cam spends a game, so it is the number
   that matters -- but cold is where a WRONG reading does the most damage, because
   there is nothing yet to contradict it. */
function runCase(c, hinted) {
  const rnd = rng(0xC10C ^ (c.name.length * 7919));
  let right = 0, wrong = 0, none = 0;
  const wrongs = [];
  const faces = c.colonOnly ? CLOCKS : CLOCKS.concat(TENTHS);
  for (const [text, ms] of faces) {
    if (c.colonOnly && !text.includes(':')) continue;
    for (let i = 0; i < N; i++) {
      /* a case with `stack` renders that many frames and averages them, which is
         what the app does: the PWM phase differs every frame, so a segment missing
         from one is present in the others. See stack() in decode.js. */
      const imgs = [];
      for (let k = 0; k < (c.stack || 1); k++) imgs.push(renderCrop(text, c.opt, rnd));
      const b = D.binarise(D.stack(imgs), c.opt.bright ? true : null, 0);
      /* the hint is the clock as it was four tenths ago -- what the app would
         actually be holding when this frame arrives */
      const got = D.readClock(b, hinted ? ms + 400 : undefined);
      if (got == null) none++;
      else if (got === ms) right++;
      else { wrong++; if (wrongs.length < 4) wrongs.push(`${text} -> ${(got / 1000).toFixed(1)}s (want ${(ms / 1000).toFixed(1)}s)`); }
    }
  }
  const total = right + wrong + none;
  return { name: c.name, right, wrong, none, total, wrongs,
           readRate: (right + wrong) / total, wrongRate: wrong / total,
           acc: (right + wrong) ? right / (right + wrong) : 0 };
}

function runScores() {
  const rnd = rng(0x5C02);
  const faces = [['0', 0], ['7', 7], ['12', 12], ['48', 48], ['77', 77], ['100', 100], ['108', 108], ['93', 93]];
  let right = 0, wrong = 0, none = 0;
  for (const opt of [{}, { dim: 0.45 }, { blur: 2 }, { noise: 0.06 }, { angle: 5 }, { flicker: 0.25, flickerDepth: 0.5 }]) {
    for (const [text, v] of faces) for (let i = 0; i < 6; i++) {
      const img = renderCrop(text, opt, rnd);
      const b = D.binarise(img, opt.bright ? true : null, 0);
      const got = D.readScore(b);
      if (got == null) none++; else if (got === v) right++; else wrong++;
    }
  }
  const total = right + wrong + none;
  return { name: 'scores (all conditions)', right, wrong, none, total,
           readRate: (right + wrong) / total, wrongRate: wrong / total,
           acc: (right + wrong) ? right / (right + wrong) : 0, wrongs: [] };
}

/* ------------------------------------------------------------------- run --- */
const track = CASES.map(c => runCase(c, true));
const cold = CASES.map(c => runCase(c, false));
const scores = runScores();
track.push(scores); cold.push(scores);

const pad = (s, n) => String(s).padEnd(n);
const pct = v => (v * 100).toFixed(1).padStart(5) + '%';
const sum = rs => rs.reduce((a, r) => ({ right: a.right + r.right, wrong: a.wrong + r.wrong, none: a.none + r.none, total: a.total + r.total }), { right: 0, wrong: 0, none: 0, total: 0 });

console.log('\n  CLOCK CAM DECODER BENCH');
console.log('  tracking = the app already has a clock · cold = the very first frame\n');
console.log('  ' + pad('case', 24) + pad('   read', 9) + pad('  WRONG', 9) + '|' + pad('   read', 9) + pad('  WRONG', 9) + 'n');
console.log('  ' + pad('', 24) + pad('  tracking', 18) + '|' + pad('  cold', 18));
console.log('  ' + '-'.repeat(74));
for (let i = 0; i < track.length; i++) {
  const t = track[i], k = cold[i];
  const c = CASES[i] || {};
  console.log('  ' + pad(t.name + (c.stress ? ' *' : c.broken ? ' †' : ''), 24) + pct(t.readRate) + '   ' + pct(t.wrongRate) + '   |' + pct(k.readRate) + '   ' + pct(k.wrongRate) + '   ' + t.total);
  if (VERBOSE && t.wrongs.length) t.wrongs.forEach(w => console.log('        ! tracking: ' + w));
  if (VERBOSE && k.wrongs.length) k.wrongs.forEach(w => console.log('        ! cold:     ' + w));
}
const T = sum(track), K = sum(cold);
/* A BOARD WITH A DEAD LAMP ROW IS BROKEN HARDWARE, AND REFUSING IT IS THE RIGHT
   ANSWER. Those cases are kept out of the read-rate floor -- counting them would
   mean a reader that started GUESSING at broken boards scored better -- but they
   stay under the wrongness ceiling, which is the whole reason they are here. */
const BROKEN = new Set(CASES.filter(c => c.broken).map(c => c.name));
const sumR = rs => sum(rs.filter(r => !BROKEN.has(r.name)));
const TR = sumR(track), KR = sumR(cold);
const tRead = (TR.right + TR.wrong) / TR.total, tWrong = T.wrong / T.total;
const kRead = (KR.right + KR.wrong) / KR.total, kWrong = K.wrong / K.total;
console.log('  ' + '-'.repeat(74));
console.log('  ' + pad('OVERALL', 24) + pct(tRead) + '   ' + pct(tWrong) + '   |' + pct(kRead) + '   ' + pct(kWrong) + '   ' + T.total);
console.log('  † broken hardware: refusing is the right answer, so these are outside the read');
console.log('    floor but still under the wrongness ceiling.');
console.log('  * a stress case: harsher than a real board, kept to show where the decoder');
console.log('    gives up. Excluded from the per-case ceiling; the physics downstream is');
console.log('    what protects a broadcast at that severity (clockcam.clock.test.mjs).');
console.log('');

/* ------------------------------------------------------------ the floor ---
   Set just under what the decoder actually does, so a change that makes it worse
   fails the build and a change that makes it better invites raising the floor.
   Wrongness is capped hard and per-case, because one case quietly rotting is
   exactly what an overall average hides. Cold wrongness is capped tighter than
   tracking wrongness: a wrong first reading is the one with nothing to catch it. */
const FLOOR = { trackRead: 0.88, trackWrong: 0.010, coldWrong: 0.010 };
const PER_CASE_WRONG = 0.06;

let bad = [];
if (tRead < FLOOR.trackRead) bad.push(`tracking read rate ${pct(tRead)} is below the floor ${pct(FLOOR.trackRead)}`);
if (tWrong > FLOOR.trackWrong) bad.push(`tracking WRONG rate ${pct(tWrong)} is above the ceiling ${pct(FLOOR.trackWrong)}`);
if (kWrong > FLOOR.coldWrong) bad.push(`cold WRONG rate ${pct(kWrong)} is above the ceiling ${pct(FLOOR.coldWrong)}`);
const STRESS = new Set(CASES.filter(c => c.stress).map(c => c.name));
for (const r of track) if (!STRESS.has(r.name) && r.wrongRate > PER_CASE_WRONG) bad.push(`tracking "${r.name}" WRONG ${pct(r.wrongRate)} is above ${pct(PER_CASE_WRONG)}` + (r.wrongs.length ? ` (e.g. ${r.wrongs[0]})` : ''));
for (const r of cold) if (!STRESS.has(r.name) && r.wrongRate > PER_CASE_WRONG) bad.push(`cold "${r.name}" WRONG ${pct(r.wrongRate)} is above ${pct(PER_CASE_WRONG)}` + (r.wrongs.length ? ` (e.g. ${r.wrongs[0]})` : ''));

if (bad.length) { console.error('FAIL\n  - ' + bad.join('\n  - ') + '\n'); process.exit(1); }
console.log('  ok — the decoder holds its floor\n');
