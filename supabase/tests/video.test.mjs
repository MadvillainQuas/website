/* ============================================================================
   THE VIDEO TIMELINE, AND THE INTERVAL BETWEEN HALVES.

   Two features that share one idea: the platform already knows what time it
   is, so nobody should have to write a time down.

   What is asserted here, and why each one is worth a test rather than a read:

     1. THE ARITHMETIC. A play's position in the footage is derived from two
        wall-clock instants and a trim. Getting it wrong by a constant is the
        failure mode that looks fine — every clip is early by the same eleven
        minutes and the page reports no error at all — so the numbers are
        checked against hand-computed answers rather than against themselves.

     2. NULL IS NOT ZERO. A video with no anchor yet must return null, not 0.
        Zero would seek every play to the start of the stream and look like a
        working feature pointed at an empty court.

     3. THE URLS. An id extracted from the wrong capture group embeds somebody
        else's video, which is the one bug on this page that is genuinely
        embarrassing rather than merely wrong.

     4. THE INTERVAL IS ADVISORY. It must not gate the third quarter, must be
        stoppable, and must not let the scoreboard's clock tap start a period
        by accident — a stray period_start at half-time is in an append-only
        log for ever.

     5. THE WALL CLOCK SURVIVES THE FETCH. Every page that feeds this module
        has to actually select created_at. It is one word in a query string and
        losing it silently disables the whole feature.

     node supabase/tests/video.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const V         = (await import('file://' + path.join(ROOT, 'epinoia', 'video.js'))).default
                || globalThis.EpinoiaVideo;
const scorer    = rd('epinoia', 'score', 'index.html');
const gamejs    = rd('epinoia', 'game', 'game.js');
const datajs    = rd('epinoia', 'data.js');
const controljs = rd('epinoia', 'broadcast', 'control', 'control.js');
const bootstrap = rd('epinoia', 'score', 'bootstrap.js');
const sql       = rd('supabase', 'migrations', '0082_game_video.sql');
const tabjs     = rd('epinoia', 'game', 'video.js');
const pvjs      = rd('epinoia', 'p', 'video.js');
const syncjs    = rd('epinoia', 'score', 'sync.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- 1. the arithmetic --------------------------------------------------- */
console.log('\na play lands where it actually is in the footage');

const T0 = Date.parse('2026-03-14T14:00:00Z');          // tip-off
const VID = {
  provider: 'youtube', video_ref: 'dQw4w9WgXcQ',
  url: 'https://youtu.be/dQw4w9WgXcQ',
  stream_started_at: '2026-03-14T13:45:00Z',            // fifteen minutes early
  tip_at: '2026-03-14T14:00:00Z',
  trim_ms: 0
};

ok('the gap is the dead air at the front of the stream',
   V.gapMs(VID) === 900000, String(V.gapMs(VID)));

ok('tip-off itself sits at the gap',
   V.videoMsOf(T0, VID) === 900000, String(V.videoMsOf(T0, VID)));

/* Seven minutes and twelve seconds of real time after the tip. */
ok('a play seven minutes in sits at 22:12 of video',
   V.videoMsOf(T0 + 432000, VID) === 1332000,
   String(V.videoMsOf(T0 + 432000, VID)));

ok('...and reads as 22:12', V.stamp(1332000) === '22:12', V.stamp(1332000));
ok('an hour is written as an hour, not seventy minutes',
   V.stamp(4231000) === '1:10:31', V.stamp(4231000));

/* The trim is the only knob, so it has to move everything by exactly itself. */
const TRIM = Object.assign({}, VID, { trim_ms: 2500 });
ok('the trim shifts every position by exactly itself',
   V.videoMsOf(T0 + 432000, TRIM) - V.videoMsOf(T0 + 432000, VID) === 2500);
ok('...including the gap',
   V.gapMs(TRIM) - V.gapMs(VID) === 2500);

/* A stream that started AFTER the tip is a real thing — somebody pressed go
   live late — and its gap is negative, not an error. */
const LATE = Object.assign({}, VID, { stream_started_at: '2026-03-14T14:02:00Z' });
ok('a stream started late has a negative gap, not a broken one',
   V.gapMs(LATE) === -120000, String(V.gapMs(LATE)));
ok('...and the plays before it began have no position at all',
   V.videoMsOf(T0 + 30000, LATE) === null);
ok('...while the ones after it do',
   V.videoMsOf(T0 + 180000, LATE) === 60000,
   String(V.videoMsOf(T0 + 180000, LATE)));

/* ---- 2. null is not zero ------------------------------------------------- */
console.log('\nnot lined up yet is a state, not a zero');

ok('no tip-off yet means no gap',
   V.gapMs(Object.assign({}, VID, { tip_at: null })) === null);
ok('no stream start means no gap',
   V.gapMs(Object.assign({}, VID, { stream_started_at: null })) === null);
ok('hasAnchor says so out loud',
   V.hasAnchor(VID) === true &&
   V.hasAnchor(Object.assign({}, VID, { tip_at: null })) === false);
ok('an unanchored video gives no positions rather than position zero',
   V.videoMsOf(T0, Object.assign({}, VID, { tip_at: null })) === null);
ok('gapText says it in words a person can act on',
   /not lined up/.test(V.gapText(Object.assign({}, VID, { tip_at: null }))));

/* The panel that would render those plays has to refuse rather than list them
   all at 0:00, which is the version of this bug that ships. */
ok('the game tab warns instead of listing when there is no anchor',
   /hasAnchor/.test(tabjs) && /has not been lined up/.test(tabjs));
ok("the profile panel simply does not appear without an anchor",
   /g\.video && V\(\)\.hasAnchor\(g\.video\) && V\(\)\.logIsTimed\(g\.events\)/.test(pvjs));

/* ---- 2b. a log that was imported in bulk carries no time of day ----------- */
console.log('\nan imported log is refused rather than stacked on one frame');

/* created_at is the INSERT time. For a live-scored game that is the play; for a
   CSV import it is the import, and eight hundred events share one second. The
   test is physical: elapsed real time can never be less than elapsed game time. */
const bulk = [];
for (let i = 0; i < 200; i++) {
  bulk.push({ seq: i + 1, t: 'p2_made', pid: 'p1', period: 4, clock: 0,
              created_at: '2026-08-16T10:02:10.0' + String(i % 10) + '0000+00:00' });
}
ok('forty minutes of basketball inside one second is refused',
   V.logIsTimed(bulk) === false);

const real = [];
for (let i = 0; i < 200; i++) {
  real.push({ seq: i + 1, t: 'p2_made', pid: 'p1', period: 4, clock: 0,
              created_at: new Date(T0 + i * 30000).toISOString() });
}
ok('...and a hundred minutes of afternoon is accepted', V.logIsTimed(real) === true);
ok('a one-event log cannot be judged, so it is refused',
   V.logIsTimed([real[0]]) === false);
ok('an empty log is refused', V.logIsTimed([]) === false);

ok('the game tab says so in words rather than listing 400 plays at one time',
   /logIsTimed/.test(tabjs) && /imported in bulk/.test(tabjs));
ok('...and hides the filters, which would do nothing',
   /\(timed \? '<div class="vidbar">'/.test(tabjs));
ok('the profile panel drops those games entirely',
   /V\(\)\.logIsTimed\(g\.events\)/.test(pvjs));

/* ---- 2c. a stored URL is untrusted input --------------------------------- */
console.log('\nno scheme but http(s) reaches an iframe src');

/* parse() refuses an unrecognised link, but nothing forced a caller to act on
   that: the row is written by whoever may score the game and was handed back
   verbatim. Rendered into <iframe src>, a javascript: URL runs in THIS page's
   origin — stored XSS on a public box score. esc() does not touch it: the
   string carries no quotes and no angle brackets. */
const SCHEMES = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)',
  'java\tscript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:msgbox',
  'blob:https://x/y', 'file:///c:/x'];
let leaked = [];
for (const u of SCHEMES) {
  const e = V.embedSrc({ provider: 'other', url: u }, {});
  const w = V.watchHref({ provider: 'other', url: u }, 0);
  if (e && !/^https?:/i.test(e)) leaked.push('embed ' + u);
  if (w !== '#' && !/^https?:/i.test(w)) leaked.push('watch ' + u);
}
ok('no dangerous scheme survives either exit', leaked.length === 0, leaked.join(', '));
ok('an ordinary https link still works',
   V.embedSrc({ provider: 'other', url: 'https://example.org/a.mp4' }, {})
     === 'https://example.org/a.mp4');
ok('parse refuses one too', V.parse('javascript:alert(1)').ok === false);
/* An allowlist rather than a javascript: blocklist — a blocklist has to
   anticipate the next spelling, an allowlist has to anticipate nothing. */
ok('the gate is a scheme allowlist, not a blocklist',
   /protocol !== 'http:' && parsed\.protocol !== 'https:'/.test(rd('epinoia', 'video.js')));
ok('the mp4 element goes through the same gate',
   /V\(\)\.safeUrl\(v\.url\)/.test(tabjs));

/* ---- 2d. a play placed by hand ------------------------------------------- */
console.log('\na play added or re-timed by hand is not a play that happened when it was typed');

const TIPS = Date.parse('2026-03-14T14:00:00Z'), TIPD = TIPS + 60000;
const VID2 = { provider: 'youtube', video_ref: 'x',
  stream_started_at: new Date(TIPS - 660000).toISOString(),
  tip_at: new Date(TIPS).toISOString(), tip_wall: TIPD, trim_ms: 0 };
const tapped = (seq, clockSec, realSec) => ({ seq, t: 'p2_made', pid: 'p1', period: 1,
  clock: clockSec * 1000, wall: TIPD + realSec * 1000,
  created_at: new Date(TIPS + realSec * 1000).toISOString() });

/* A basket missed in the first quarter and added at half-time: no tap stamp,
   and a created_at twenty-two minutes after the play. */
const handLog = [
  tapped(1, 580, 44),
  { seq: 2, t: 'p3_made', pid: 'p2', period: 1, clock: 570000,
    created_at: new Date(TIPS + 22 * 60000).toISOString() },
  tapped(3, 560, 88),
  tapped(4, 540, 132)
];
const handIdx = V.index(handLog, VID2, { label: e => e.t });
const placed = handIdx.find(p => p.id === 2);
const nb = handIdx.find(p => p.id === 1), na = handIdx.find(p => p.id === 3);
ok('it lands between the plays either side of it',
   placed.ms > nb.ms && placed.ms < na.ms,
   V.stamp(nb.ms) + ' < ' + V.stamp(placed.ms) + ' < ' + V.stamp(na.ms));
ok('...and NOT at the moment somebody opened the editor',
   Math.abs(placed.ms - (V.gapMs(VID2) + 22 * 60000)) > 60000, V.stamp(placed.ms));
ok('...and is marked as worked out rather than timed', placed.approx === true);
ok('a play that WAS tapped is not marked', nb.approx === false);

/* The rule that makes that possible: in a log carrying tap stamps, a missing
   one means hand-placed. In a log carrying none, created_at is all there is. */
const noStamps = handLog.map(e => { const c = Object.assign({}, e); delete c.wall; return c; });
ok('a log with no tap stamps at all still uses created_at for everything',
   V.index(noStamps, VID2, { label: e => e.t }).length === 4);
ok('...and marks none of them as interpolated',
   V.index(noStamps, VID2, { label: e => e.t }).every(p => !p.approx));
ok('a play with no neighbours to place it against is left out, not guessed',
   V.index([{ seq: 20, t: 'p2_made', pid: 'p1', period: 1, clock: 500000 }],
           VID2, { label: e => e.t }).length === 0);

ok('the scorer stops vouching for a stamp it has invalidated',
   /delete ev\.wall;/.test(scorer) && /THE TAP TIME IS NO LONGER TRUE OF THIS PLAY/.test(scorer));

/* ---- 2e. the player is not rebuilt to redraw a list ---------------------- */
console.log('\nchanging a filter must not restart the video');

ok('the stage is written once and only re-sourced when the position changes',
   /function paintStage\(\)/.test(tabjs) && /stage\.dataset\.sig === wanted/.test(tabjs));
ok('...and the body redraws separately', /host\.querySelector\('\.vidbody'\)/.test(tabjs));
ok('the profile panel does the same', /function paintStage\(g\)/.test(pvjs));
ok('the index is computed once per log, not once per glance',
   /let indexed = null, indexedKey = ''/.test(tabjs) && /let indexed = null;/.test(pvjs));

/* ---- 2f. a row is a control ---------------------------------------------- */
ok('every play is reachable with a keyboard',
   /role="button" tabindex="0"/.test(tabjs) && /role="button" tabindex="0"/.test(pvjs));
ok('...and Enter or space plays it',
   /e\.key === 'Enter' \|\| e\.key === ' '/.test(tabjs));
ok('...and it says what it is to a screen reader', /aria-label="/.test(tabjs));

/* ---- 2g. a poll that stops ------------------------------------------------ */
ok('the video poll gives up rather than 400ing every 45 seconds for ever',
   /if \(\+\+videoMisses >= 3\) clearInterval\(timer\);/.test(gamejs));

/* ---- 3. the URLs --------------------------------------------------------- */
console.log('\nevery link shape a person might paste');

const LINKS = [
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/watch?list=PL9&v=dQw4w9WgXcQ&t=90', 'youtube', 'dQw4w9WgXcQ'],
  ['https://youtu.be/dQw4w9WgXcQ?t=42', 'youtube', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
  ['https://www.twitch.tv/videos/123456789', 'twitch', '123456789'],
  ['https://vimeo.com/76979871', 'vimeo', '76979871'],
  ['https://example.org/game.mp4', 'mp4', '']
];
let bad = [];
for (const [url, provider, ref] of LINKS) {
  const p = V.parse(url);
  if (!p.ok || p.provider !== provider || p.ref !== ref) bad.push(url + ' -> ' + JSON.stringify(p));
}
ok('every shape parses to the right provider and id', bad.length === 0, bad.join('\n          '));

ok('a link with no id is refused rather than guessed at',
   V.parse('https://example.org/watch').ok === false);
ok('nonsense is refused', V.parse('not a url').ok === false);
ok('an empty string is refused', V.parse('').ok === false);

/* An id that came out of the wrong capture group is how you embed somebody
   else's video, so the length rule is asserted rather than assumed. */
ok('a mistyped YouTube id is refused rather than embedded',
   V.parse('https://youtu.be/tooshort').ok === false);

const src = V.embedSrc(VID, { ms: 1332000 });
ok('the embed seeks in whole seconds', /[?&]start=1332(&|$)/.test(src), src);
ok('the embed carries the id and nothing else in its path',
   src.includes('/embed/dQw4w9WgXcQ?'), src);
ok('twitch is given a parent, which it refuses to play without',
   V.embedSrc({ provider: 'twitch', video_ref: '123' }, { ms: 0 }).includes('parent='));
ok('twitch time is hms, not seconds',
   V.embedSrc({ provider: 'twitch', video_ref: '123' }, { ms: 3723000 }).includes('time=1h02m03s'),
   V.embedSrc({ provider: 'twitch', video_ref: '123' }, { ms: 3723000 }));
ok('the watch link seeks too',
   V.watchHref(VID, 1332000) === 'https://youtu.be/dQw4w9WgXcQ?t=1332',
   V.watchHref(VID, 1332000));

/* ---- 4. the index and its filters ---------------------------------------- */
console.log('\nthe log becomes a list of watchable plays');

const mk = (seq, t, mins, extra) => Object.assign(
  { seq, t, pid: 'p1', period: 1, clock: 600000 - mins * 60000,
    created_at: new Date(T0 + mins * 60000).toISOString() }, extra || {});

const LOG = [
  mk(1, 'period_start', 0, { pid: null }),
  mk(2, 'p3_made', 2),
  mk(3, 'loc', 2, { ref: 2 }),                  // a descriptor, not a play
  mk(4, 'p2_miss', 4),
  mk(5, 'reb', 4, { pid: 'p2', off: false }),
  mk(6, 'ft_made', 6),
  mk(7, 'foul', 8, { kind: 'shooting' }),
  mk(8, 'sub', 9, { pid: null })
];

const idx = V.index(LOG, VID, { label: e => e.t });
ok('descriptors do not become plays', !idx.some(p => p.t === 'loc'));
ok('everything else does', idx.length === LOG.length - 1, String(idx.length));
ok('plays come out in video order',
   idx.every((p, i) => i === 0 || p.ms >= idx[i - 1].ms));

const three = idx.find(p => p.t === 'p3_made');
ok('a three sits where its wall clock says',
   three.ms === 900000 + 120000, String(three.ms));
ok('...and its clip starts before it, not on it',
   three.start === three.ms - 9500 && three.end === three.ms + 4500,
   three.start + '..' + three.end);
/* A basket six seconds into the footage — a warm-up shot, or a stream that
   went up as the ball did — wants nine and a half seconds of run-up it cannot
   have. It gets what there is rather than a negative seek. */
const early = [Object.assign({}, mk(9, 'p3_made', 0),
  { created_at: new Date(T0 - 894000).toISOString() })];
ok('a clip never starts before the video does',
   V.index(early, VID, { label: e => e.t })[0].start === 0,
   JSON.stringify(V.index(early, VID, { label: e => e.t })[0]));

ok('skipStructural drops subs and period starts',
   V.index(LOG, VID, { skipStructural: true, label: e => e.t })
    .every(p => !['sub', 'period_start'].includes(p.t)));

const pts = V.select(idx, { filter: 'points' });
ok('"every point" is made shots only, of all three kinds',
   pts.length === 2 && pts.every(p => /_made$/.test(p.t)),
   pts.map(p => p.t).join(','));
ok('"three-pointers" catches misses as well as makes',
   V.FILTERS.find(f => f.key === 'three').fn({ t: 'p3_miss' }) === true);
ok('filtering by player narrows to that player',
   V.select(idx, { filter: 'all', pid: 'p2' }).length === 1);
ok('an unknown filter key falls back to everything rather than to nothing',
   V.select(idx, { filter: 'nonsense-key' }).length === idx.length);

/* ---- 5. the wall clock survives every fetch ------------------------------ */
console.log('\ncreated_at is actually selected everywhere it is needed');

ok('the box score fetches it', /select=seq,t,team,pid,period,clock,payload,created_at/.test(gamejs));
ok('...and keeps it on the event', /e\.created_at = r\.created_at/.test(gamejs));
ok('the shared data layer fetches it',
   /select=game_id,seq,t,team,pid,period,clock,payload,created_at/.test(datajs));
ok('...and keeps it on the event', /created_at: r\.created_at/.test(datajs));

/* ---- 6. stamping, and who does it ---------------------------------------- */
console.log('\nnobody has to write a time down');

ok('the scorer stamps tip-off at the first period_start',
   /ev\.t==='period_start' && \(ev\.period\|\|1\)===1 && !vid\(\)\.tipAt/.test(scorer));
ok('...inside addEvent, so every route into the first quarter is covered',
   scorer.indexOf('!vid().tipAt') > scorer.indexOf('function addEvent'));
ok('the control room stamps the stream start when it goes live',
   /stampStreamStart\(\)/.test(controljs));
/* It used to be stamped straight after startStream resolved. That was right as
   far as it went and covered only the case where THIS page started the stream;
   the poll now covers every case, from the mixer's own duration counter, and
   two paths that disagree would be worse than one that is slightly later. */
ok('...from the poll, so a stream started anywhere else is caught too',
   /if \(st\.outputActive\) stampStreamStart\(\);/.test(controljs));
ok('...and never from a second, eager path that is right only sometimes',
   !/startStream\(\);[^;]{0,40}stampStreamStart/.test(controljs.replace(/\s+/g, ' ')));
ok('...and only once per stream',
   /let stampedStart = false/.test(controljs) && /if \(stampedStart/.test(controljs));
ok('the scorer adopts whatever the database already knows',
   /adoptVideo/.test(bootstrap) && /game_videos/.test(bootstrap));

/* ---- 7. the database ----------------------------------------------------- */
console.log('\nthe row is public where the game is, and writable where scoring is');

ok('reading is exactly can_read_game',
   /create policy game_videos_read on public\.game_videos for select\s*\n\s*using \(public\.can_read_game\(game_id\)\)/.test(sql));
ok('writing needs can_score or a league admin',
   /can_score\(game_id\) or public\.is_platform_admin\(\) or exists/.test(sql));
ok('the gap is derived, never stored as its own column',
   !/\bgap_ms\s+(int|bigint)\b/.test(sql.split('SELF-TEST')[0]));
ok('the trim is bounded, so a fat finger cannot push a video two days out',
   /check \(trim_ms between -7200000 and 7200000\)/.test(sql));
ok('a first call with no URL is allowed — the stream start is perishable',
   !/a video URL is needed the first time/.test(sql));
ok('the RPC treats null as leave-alone rather than as clear',
   /stream_started_at = coalesce\(p_stream_start, stream_started_at\)/.test(sql));

/* ---- 8. the interval between halves -------------------------------------- */
console.log('\nhalf-time is fifteen minutes, and it is advisory');

ok('it is fifteen minutes', /const BREAK_MS = 900000;/.test(scorer));
ok('it starts when the second quarter ends',
   /S\.period === 2\)\{\s*\n\s*startBreak\(\);/.test(scorer.replace(/\r/g, '')),
   'startBreak must be called from onPeriodEnd for period 2');
ok('it is only "active" at 0:00 of the second quarter',
   /S\.breakMs > 0 && S\.period === 2 && S\.clockMs === 0/.test(scorer));
ok('it counts down on the same tick as everything else',
   /S\.breakRunning && S\.breakMs > 0/.test(scorer));
ok('it can be held, because real intervals stop',
   /S\.breakRunning = !S\.breakRunning/.test(scorer));

/* The point of the whole design: nothing waits for it. */
const resume = scorer.slice(scorer.indexOf('function resumeClock()'),
                            scorer.indexOf('/* ==================== pending helpers'));
ok('resuming ends the interval rather than being blocked by it',
   /endBreak\(\);/.test(resume) && !/breakMs\s*>\s*0\s*\)\s*return/.test(resume), resume.slice(0, 400));
ok('...and says how much was skipped',
   /of the interval skipped/.test(resume));

/* A stray period_start at half-time is in an append-only log for ever. */
ok('the clock tap drives the interval, not the next period',
   /if\(breakActive\(\)\)\{ S\.breakRunning = !S\.breakRunning; save\(\); renderScore\(\); vibrate\(8\); return; \}/
     .test(scorer));

ok('viewers are told about it too, so a stream is not fifteen minutes of 0:00',
   /break_ms:/.test(syncjs) && /break_running:/.test(syncjs));

/* ---- 8b. the page is actually allowed to frame a player ------------------- */
console.log('\nthe CSP permits the players and nothing else');

const gameHtml = rd('epinoia', 'game', 'index.html');
const pHtml    = rd('epinoia', 'p', 'index.html');
const csp = h => (h.match(/Content-Security-Policy"[\s\S]*?content="([^"]*)"/) || [])[1] || '';

for (const [name, html] of [['the box score', gameHtml], ['a player profile', pHtml]]) {
  const c = csp(html);
  const frame = (c.match(/frame-src ([^;"]*)/) || [])[1] || '';
  ok(name + ' may frame YouTube', /https:\/\/www\.youtube\.com/.test(frame), frame);
  ok(name + ' may frame Twitch and Vimeo',
     /player\.twitch\.tv/.test(frame) && /player\.vimeo\.com/.test(frame), frame);
  /* frame-src does not fall back to default-src once declared, so dropping
     'self' would silently forbid framing anything of ours. */
  ok(name + " keeps 'self' in frame-src", /'self'/.test(frame), frame);
  ok(name + ' does not open frame-src to the whole web',
     !/frame-src[^;"]*\*[^.]/.test(c) && !/frame-src[^;"]*https:(?!\/)/.test(c), frame);
  ok(name + ' may play a video file served from elsewhere',
     /media-src[^;"]*https:/.test(c), c.slice(0, 120));
}

/* ---- 9. the one entrance ------------------------------------------------- */
console.log('\nevery graphic still appears in one piece');

const bcast = rd('epinoia', 'broadcast', 'broadcast.js');
ok('the reveal waits for the loads to settle',
   /if \(settled\) stage\.dataset\.ready = '1';/.test(bcast));
ok('...but never for ever',
   /Promise\.race\(\[ready, new Promise\(r => setTimeout\(r, REVEAL_MAX_MS\)\)\]\)/.test(bcast));
ok('...and a terminal state reveals immediately',
   (bcast.match(/settled = true; stage\.dataset\.ready = '1';/g) || []).length === 2);


/* ---- attaching a recording to a game that is already over ---------------- */
console.log('\nthe ordinary case: the game was Saturday, the footage went up Sunday');

const sql88 = rd('supabase', 'migrations', '0088_attach_video_after.sql');
const playerjs = rd('epinoia', 'p', 'player.js');
const gamehtml = rd('epinoia', 'game', 'index.html');

/* can_score exists to guard the EVENT LOG and says "never once the game is
   final". A video link is not the event log, and the normal moment to attach
   one is the moment that gate forbids. */
ok('video has its own permission, separate from scoring',
   /create or replace function public\.may_attach_video/.test(sql88));
ok('...which does NOT expire when the game does',
   !/status in \('scheduled','live'\)/.test(
     sql88.slice(sql88.indexOf('may_attach_video'), sql88.indexOf('comment on function'))));
ok('...and admits exactly the people can_score did: officials, league and platform admins',
   /game_officials go/.test(sql88) && /is_league_admin/.test(sql88) &&
   /is_platform_admin/.test(sql88));
ok('the RPC and the table policy both move onto it',
   /if not public\.may_attach_video\(p_game\) then/.test(sql88) &&
   /using \(public\.may_attach_video\(game_id\)\)/.test(sql88));
ok('the migration refuses to apply if somebody re-copies the status condition in',
   /may_attach_video still refuses a finished game/.test(sql88));
ok('...and checks the permission has not reached the event log',
   /video permission has reached the event log/.test(sql88));

/* The tip is already in the log — the first period_start — so the only thing a
   human has to supply is where the jump ball is on the scrub bar. */
ok('the tip-off is recovered from the log rather than asked for',
   /create or replace function public\.anchor_video_from_log/.test(sql88) &&
   /public\.game_tip_wallclock\(p_game\)/.test(sql88));
ok('...and it refuses rather than guessing when the log has no tip',
   /this game has no recorded tip-off to line a video up with/.test(sql88));
ok('...and never overwrites a tip that is already set',
   /where game_id = p_game and is_primary and tip_at is null/.test(sql88));

/* The scorer will not open a finished fixture, so the route has to be the page
   that still knows which game you are looking at. */
ok('the game page offers it to whoever may attach one',
   /async function offerToAttachVideo\(\)/.test(gamejs) &&
   /rpcCall\('may_attach_video', \{ p_game: gameId \}/.test(gamejs));
ok('...hidden until the database says yes', /id="vidCta"/.test(gamehtml) &&
   /cta\.classList\.remove\('hide'\)/.test(gamejs));
ok('...and re-offered the moment somebody signs in',
   /offerToScore\(\); offerToRevert\(\); offerToAttachVideo\(\);/.test(gamejs));
ok('a link the platform cannot seek into is refused before anything is written',
   /if \(!parsed\.ok\) \{/.test(gamejs) &&
   /would be stored but no play could/.test(gamejs.replace(/\s+/g, ' ')));
/* Order matters: a gap is measured FROM the tip, so the tip has to exist first
   or the arithmetic is against null. */
ok('the tip is anchored before the gap is set',
   gamejs.indexOf("rpcCallRaw('anchor_video_from_log'") <
   gamejs.indexOf('p_stream_start: started'));

/* And the point of all of it: the same row feeds a player's own page. */
ok('a player profile reads the same rows for the games their club played',
   /game_videos\?game_id=in\./.test(playerjs) &&
   /EpinoiaPlayerVideo\.render/.test(playerjs));
ok('...and the panel only appears when the plays can actually be found',
   /g\.video && V\(\)\.hasAnchor\(g\.video\) && V\(\)\.logIsTimed\(g\.events\)/.test(pvjs));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
