/* ============================================================================
   THE STRIP TICKS, AND TELLS THE TRUTH WHILE IT DOES.

   The strip used to poll: a minute apart when nothing was known to be live,
   four seconds once something was. So a game that had just tipped sat
   "upcoming" on a club's homepage for up to a minute, the score behind it by
   as much again, and you had to reload the page to find out a game had
   started. It now listens to the scorer's own broadcast and ticks the clock
   locally between frames.

   That buys speed and introduces four ways to be wrong, which is what this
   file holds:

     1. THE CLOCK. It counts down from the instant a frame ARRIVED, not from
        the frame's own timestamp, so a viewer with a wrong device clock still
        sees the right time. A stopped clock must not drift at all.
     2. WHICH SOURCE WINS. A frame is faster than the table; an old frame must
        never overwrite a newer one; and the table must never overwrite a frame
        it is behind.
     3. WHAT COUNTS AS LIVE. A frame may say a game has started before the poll
        knows — that flip is the point. It must NOT be able to say a finished
        game is unfinished, and a scorer sitting on the pre-game screen
        broadcasts 'scheduled', which must not read as live.
     4. WHO GETS A SOCKET. Live games always; fixtures near tip-off so the flip
        is instant; and a hard cap, because this runs on other people's pages.

   The functions are lifted out of strip.js rather than copied, so editing them
   there without thinking fails here.

     node supabase/tests/strip-live.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = readFileSync(path.join(ROOT, 'epinoia', 'embed', 'strip', 'strip.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* Pull the pure functions out of the real file and evaluate them against a
   LIVE/ROWS pair we control. Anything DOM-shaped stays in the browser. */
function lift(names) {
  const wanted = names.map(n => {
    const re = new RegExp('(?:^|\\n)(?:const|function)\\s+' + n + '\\b');
    const at = SRC.search(re);
    if (at < 0) throw new Error('not found in strip.js: ' + n);
    const from = SRC.indexOf('\n', at) === at ? at + 1 : at;
    /* to the next top-level declaration */
    const rest = SRC.slice(from + 1);
    const end = rest.search(/\n(?:const|let|function|\/\* =====)/);
    return SRC.slice(from, end < 0 ? undefined : from + 1 + end);
  }).join('\n');
  const body = 'const LIVE = new Map(); const ROWS = new Map();\n' + wanted +
    '\nreturn { LIVE, ROWS, ' + names.join(', ') + ' };';
  return new Function(body)();
}

const M = lift(['DONE', 'noteState', 'clockNow', 'periodLabel', 'fmtClock', 'statusOf',
                'scoreOf', 'watchable', 'NEAR_TIP_MS', 'MAX_CHANNELS']);

const state = (o) => Object.assign({
  period: 3, clock_ms: 240000, running: true, score_home: 55, score_away: 51, last_seq: 10
}, o || {});

/* ---- 1. the clock --------------------------------------------------------- */
{
  M.LIVE.clear();
  M.noteState('g1', state({ clock_ms: 90000, running: true }));
  const s = M.LIVE.get('g1');
  ok('a running clock starts at what the frame said',
     Math.abs(M.clockNow(s) - 90000) < 50, String(M.clockNow(s)));

  s.at = Date.now() - 5000;                       // five seconds ago
  ok('...and has counted down five seconds five seconds later',
     Math.abs(M.clockNow(s) - 85000) < 60, String(M.clockNow(s)));

  M.noteState('g2', state({ clock_ms: 90000, running: false }));
  const stopped = M.LIVE.get('g2');
  stopped.at = Date.now() - 30000;
  ok('a STOPPED clock does not drift — a dead ball is not time passing',
     M.clockNow(stopped) === 90000, String(M.clockNow(stopped)));

  const zero = M.LIVE.get('g1');
  zero.at = Date.now() - 600000;
  ok('a clock cannot run past zero', M.clockNow(zero) === 0, String(M.clockNow(zero)));

  M.noteState('g3', state({ clock_ms: null }));
  ok('no clock in the frame means no clock on the card, not a zero',
     M.clockNow(M.LIVE.get('g3')) === null);
}

/* ---- the display, which is a scoreboard convention not a duration --------- */
{
  ok('ten minutes reads 10:00', M.fmtClock(600000) === '10:00', M.fmtClock(600000));
  ok('four minutes twelve reads 4:12', M.fmtClock(252000) === '4:12', M.fmtClock(252000));
  ok('sixty seconds is still 1:00', M.fmtClock(60000) === '1:00', M.fmtClock(60000));
  ok('under a minute switches to tenths, as a scoreboard does',
     M.fmtClock(59900) === '59.9', M.fmtClock(59900));
  ok('the last second reads 0.4', M.fmtClock(400) === '0.4', M.fmtClock(400));
  ok('zero reads 0.0', M.fmtClock(0) === '0.0', M.fmtClock(0));
  /* 1:00 must not appear as 0:59 for most of a second: seconds round UP, which
     is what every scoreboard does and what stops a quarter ending at 0:01. */
  ok('seconds round up, so a clock never reads a second early',
     M.fmtClock(59001) === '59.0' && M.fmtClock(119001) === '2:00',
     M.fmtClock(59001) + ' / ' + M.fmtClock(119001));
  ok('periods are quarters', M.periodLabel(1) === 'Q1' && M.periodLabel(4) === 'Q4');
  ok('and then overtime', M.periodLabel(5) === 'OT' && M.periodLabel(6) === 'OT2',
     M.periodLabel(5) + ' / ' + M.periodLabel(6));
  ok('no period, no label', M.periodLabel(0) === '' && M.periodLabel(null) === '');
}

/* ---- 2. which source wins -------------------------------------------------- */
{
  M.LIVE.clear();
  M.noteState('g1', state({ last_seq: 20, score_home: 60 }));
  const accepted = M.noteState('g1', state({ last_seq: 12, score_home: 44 }));
  ok('a frame that is BEHIND the one we hold is refused', accepted === false);
  ok('...and the score it carried is not applied', M.LIVE.get('g1').home === 60,
     String(M.LIVE.get('g1').home));
  M.noteState('g1', state({ last_seq: 21, score_home: 62 }));
  ok('a newer frame is applied', M.LIVE.get('g1').home === 62);

  M.ROWS.clear();
  M.ROWS.set('g1', { id: 'g1', status: 'live', home_score: 55, away_score: 51 });
  ok('a live card shows the BROADCAST score, not the slower table',
     M.scoreOf(M.ROWS.get('g1')).join('-') === '62-51',
     M.scoreOf(M.ROWS.get('g1')).join('-'));

  M.ROWS.set('g2', { id: 'g2', status: 'final', home_score: 88, away_score: 84 });
  ok('a finished game shows the table, which is the record',
     M.scoreOf(M.ROWS.get('g2')).join('-') === '88-84');

  M.ROWS.set('g3', { id: 'g3', status: 'scheduled', home_score: null, away_score: null });
  ok('a fixture with no score shows nought, not null',
     M.scoreOf(M.ROWS.get('g3')).join('-') === '0-0');
}

/* ---- 3. what counts as live ------------------------------------------------ */
{
  M.LIVE.clear(); M.ROWS.clear();
  const g = { id: 'x', status: 'scheduled' };
  M.ROWS.set('x', g);
  ok('a fixture with no frame is what the table says it is', M.statusOf(g) === 'scheduled');

  M.noteState('x', state(), 'live');
  ok('THE FLIP: a frame saying live makes it live before the poll catches up',
     M.statusOf(g) === 'live');

  /* the scheduled-bleeding-into-live bug, from the other direction: a scorer
     on the pre-game screen broadcasts status 'scheduled' */
  M.LIVE.clear();
  M.noteState('x', state({ clock_ms: 600000, running: false }), 'scheduled');
  ok('a scorer sitting on the pre-game screen does NOT make a fixture live',
     M.statusOf(g) === 'scheduled', M.statusOf(g));

  const done = { id: 'y', status: 'final' };
  M.ROWS.set('y', done);
  M.noteState('y', state(), 'live');
  ok('a frame can never un-finish a finished game', M.statusOf(done) === 'final',
     M.statusOf(done));

  const on = { id: 'z', status: 'live' };
  M.ROWS.set('z', on);
  M.noteState('z', state(), 'scheduled');
  ok('nor can a stale frame take a live game off the air', M.statusOf(on) === 'live');
}

/* ---- 4. who gets a socket -------------------------------------------------- */
{
  const now = Date.now();
  const at = ms => new Date(now + ms).toISOString();
  const gs = [
    { id: 'live1', status: 'live', tipoff_at: at(-3600e3) },
    { id: 'soon',  status: 'scheduled', tipoff_at: at(30 * 60e3) },
    { id: 'just',  status: 'scheduled', tipoff_at: at(-10 * 60e3) },   // tipped late
    { id: 'later', status: 'scheduled', tipoff_at: at(48 * 3600e3) },
    { id: 'done',  status: 'final', tipoff_at: at(-72 * 3600e3) },
    { id: 'nodate', status: 'scheduled', tipoff_at: null }
  ];
  const w = M.watchable(gs);
  ok('a live game is watched', w.includes('game:live1'));
  ok('a fixture about to tip is watched — this is what makes the flip instant',
     w.includes('game:soon'));
  ok('one whose tip-off has just passed is too, since that is when it starts',
     w.includes('game:just'));
  ok('a fixture two days out is not', !w.includes('game:later'));
  ok('a finished game is not', !w.includes('game:done'));
  ok('a fixture with no tip-off time is not guessed at', !w.includes('game:nodate'));
  /* THE RACE THIS FILE WAS WRITTEN AFTER CATCHING. The scorer broadcasts its
     first live frame at about the moment it writes status='live', and the
     reload that frame triggers can read the row a beat before the write lands.
     Judged on the table alone, the channel was dropped at exactly the instant
     the game went live and the strip went deaf until the next poll. */
  M.LIVE.clear(); M.ROWS.clear();
  const racing = { id: 'race', status: 'scheduled', tipoff_at: at(-9 * 24 * 3600e3) };
  M.ROWS.set('race', racing);
  M.noteState('race', state(), 'live');
  ok('a game the table still calls scheduled, but a frame calls live, KEEPS its socket',
     M.watchable([racing]).includes('game:race'), M.watchable([racing]).join());
  M.LIVE.clear(); M.ROWS.clear();

  ok('the window is hours, not minutes', M.NEAR_TIP_MS >= 3600e3 && M.NEAR_TIP_MS <= 12 * 3600e3,
     String(M.NEAR_TIP_MS));

  const many = Array.from({ length: 30 }, (_, i) =>
    ({ id: 'g' + i, status: 'live', tipoff_at: at(-3600e3) }));
  ok('a busy evening cannot open thirty sockets on a visitor’s browser',
     M.watchable(many).length === M.MAX_CHANNELS, String(M.watchable(many).length));
  ok('and the cap is a handful, not a hundred', M.MAX_CHANNELS <= 12);
}

/* ---- the wiring around them ------------------------------------------------ */
{
  ok('the poll is still there as a safety net — a blocked websocket must not '
     + 'leave a dead strip', /POLL_MS\s*=\s*\d+/.test(SRC) && /schedule\(\)/.test(SRC));
  ok('...and idles no slower than half a minute',
     Number((SRC.match(/const POLL_MS = (\d+)/) || [])[1]) <= 30000,
     (SRC.match(/const POLL_MS = (\d+)/) || [])[1]);
  ok('cards carry their game id so a repaint can find both copies',
     /setAttribute\('data-game', g\.id\)/.test(SRC));
  ok('the rebuild fingerprint no longer contains the score, so a basket cannot '
     + 'tear down a rail mid-drag',
     /const key = gs\.map\(g => g\.id \+ ':' \+ statusOf\(g\)\)\.join/.test(SRC),
     (SRC.match(/const key = gs\.map[^\n]*/) || [''])[0]);
  ok('the ticking timer stops when nothing is running',
     /clearInterval\(tickTimer\); tickTimer = null/.test(SRC));
  ok('the strip page loads rt.js',
     /rt\.js\?v=\d+/.test(readFileSync(
       path.join(ROOT, 'epinoia', 'embed', 'strip', 'index.html'), 'utf8')));
  ok('and its CSP already allowed the socket',
     /connect-src[^"]*wss:\/\/\*\.supabase\.co/.test(readFileSync(
       path.join(ROOT, 'epinoia', 'embed', 'strip', 'index.html'), 'utf8')));
  ok('the clock is tabular, so a ticking card does not jiggle',
     /\.vn\.clock\{[\s\S]{0,200}tabular-nums/.test(readFileSync(
       path.join(ROOT, 'epinoia', 'kit', 'embed.css'), 'utf8')));
}

/* ---- a game being written up is a finished game ---------------------------
   finalise-game holds status at 'finalising' while it rebuilds the derived
   tables, the standings, the feeds and the match report. Every list read that
   as neither live nor final and drew a completed game as an upcoming fixture,
   while tapping it opened the finished box score — because that reads events
   rather than status. The strip's query did not even ask for the row. */
{
  M.LIVE.clear(); M.ROWS.clear();
  const fin = { id: 'f1', status: 'finalising', home_score: 88, away_score: 84 };
  M.ROWS.set('f1', fin);
  ok('a finalising game reads as final, not as an upcoming fixture',
     M.statusOf(fin) === 'final', M.statusOf(fin));
  ok('...and shows the score it finished on',
     M.scoreOf(fin).join('-') === '88-84', M.scoreOf(fin).join('-'));

  const stripSrc = readFileSync(path.join(ROOT, 'epinoia', 'embed', 'strip', 'strip.js'), 'utf8');
  ok('the strip asks the database for those rows',
     /status=in\.\([^)]*finalising/.test(stripSrc));

  const homeSrc = readFileSync(path.join(ROOT, 'epinoia', 'home.js'), 'utf8');
  ok('so does the league front page', /status=in\.\([^)]*finalising/.test(homeSrc));
  ok('...and counts one as a result rather than a fixture',
     /DONE\(g\.status\) && at\(g\) >= weekAgo/.test(homeSrc));

  const fxSrc = readFileSync(path.join(ROOT, 'epinoia', 'fixtures', 'fixtures.js'), 'utf8');
  ok('and the fixtures page draws it as finished',
     /const final = DONE\(g\.status\)/.test(fxSrc));
  M.LIVE.clear(); M.ROWS.clear();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
