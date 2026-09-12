/* ============================================================================
   A GAME THAT WAS SCORED MUST BE A GAME THAT WAS SAVED.

   A full game — 754 events, four quarters, a final score of 105–86 — was
   scored, and the league database ended up holding exactly ONE row of it. The
   public box score looked perfect throughout, because that arrives over the
   broadcast and the broadcast was fine. The loss surfaced only at the final
   whistle, when finalise refused to close a game the server could not
   reproduce, by which point the only copy was in one browser tab.

   Three faults, each of which alone would have been survivable:

   1. THE CLOCK WAS A FLOAT AND THE COLUMN IS AN INTEGER. The scorer's clock is
      real elapsed milliseconds, so a row carried clock 580270.8394733587.
      Postgres refuses that outright, and an upsert is one statement, so one
      such row failed the whole batch. The single surviving row was the opening
      period_start — the one event whose clock was exactly 600000.

   2. A REFUSED WRITE LOOKED LIKE A SUCCESSFUL ONE. supabase-js resolves with
      { data, error } rather than rejecting, so `every(r => r.status ===
      'fulfilled')` was true whether the rows went in or bounced. send()
      reported success, the frame was never put on the backlog to retry, and
      the buffer had already been emptied. Every event was discarded at the
      moment it failed.

   3. NOBODY WAS TOLD. Not the statistician, not the console.

   These tests hold all three, and they drive the real transport against a fake
   supabase client so the assertions are about what would actually be sent.

     node supabase/tests/durability.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const Live = require(path.join(ROOT, 'epinoia', 'live.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* A supabase client that records what it was asked to write, and can be told
   to refuse the way PostgREST refuses: by RESOLVING with an error. */
function fakeSb(opts = {}) {
  const wrote = { game_events: [], game_state: [], deleted: [] };
  const sent = [];
  return {
    wrote, sent,
    channel: () => ({ send: m => sent.push(m), subscribe: () => {}, on: () => {} }),
    from(table) {
      return {
        upsert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (opts.refuse && opts.refuse(table, list)) {
            /* exactly how supabase-js reports a rejected write */
            return Promise.resolve({ data: null, error: {
              code: '22P02', message: 'invalid input syntax for type integer',
              details: null } });
          }
          wrote[table].push(...list);
          return Promise.resolve({ data: list, error: null });
        },
        delete() { return { eq() { return { in(_c, v) {
          wrote.deleted.push(...v); return Promise.resolve({ data: null, error: null }); } }; } }; }
      };
    }
  };
}

const frameOf = (events, state) => ({
  gameId: 'g1', events, removed: [], state, seq: 1, at: 1
});

/* ---- 1. the integer columns ----------------------------------------------- */
{
  const sb = fakeSb();
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  /* the exact row the simulator produced, fractional clock and all */
  pub.pushEvents([
    { id: 1, seq: 1, t: 'period_start', period: 1, clock: 600000 },
    { id: 2, seq: 2, t: 'foul', team: 1, pid: 'p1_3', period: 1,
      clock: 580270.8394733587, kind: 'personal' },
    { id: 3, seq: 3, t: 'p2_make', team: 0, pid: 'p0_1', period: 1.0,
      clock: 579911.22, x: 0.5, y: 0.1 }
  ]);
  await pub.flushNow();

  const rows = sb.wrote.game_events;
  ok('every event reaches the table', rows.length === 3, String(rows.length));
  ok('a fractional clock is written as a whole number — the column is an int',
     rows.every(r => r.clock == null || Number.isInteger(r.clock)),
     JSON.stringify(rows.map(r => r.clock)));
  ok('...rounded, not truncated', rows[1].clock === 580271, String(rows[1].clock));
  ok('seq, period and team are whole too',
     rows.every(r => [r.seq, r.period, r.team].every(v => v == null || Number.isInteger(v))),
     JSON.stringify(rows.map(r => [r.seq, r.period, r.team])));
  ok('the payload keeps its floats — only the columns are integers',
     rows[2].payload.x === 0.5 && rows[2].payload.y === 0.1,
     JSON.stringify(rows[2].payload));
  ok('nothing else about the row is changed',
     rows[1].t === 'foul' && rows[1].pid === 'p1_3' && rows[1].payload.kind === 'personal');
  pub.stop();
}

/* game_state has the same integer columns and was failing the same way */
{
  const sb = fakeSb();
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  await pub.pushState({ period: 2, clock_ms: 431288.6667, running: true,
                        score_home: 44, score_away: 41, last_seq: 312.0 });
  const st = sb.wrote.game_state[0];
  ok('the durable state rounds its clock as well',
     Number.isInteger(st.clock_ms) && st.clock_ms === 431289, JSON.stringify(st));
  ok('and keeps running, which is a boolean not a number', st.running === true);
  pub.stop();
}

/* ---- 2. a refused write must not report success ---------------------------- */
{
  const sb = fakeSb({ refuse: (table) => table === 'game_events' });
  const errs = [];
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb,
                               onError: e => errs.push(e) });
  pub.pushEvents([{ id: 1, seq: 1, t: 'p2_make', team: 0, period: 1, clock: 100 }]);
  await pub.flushNow();

  ok('a refusal that RESOLVES is still a refusal', errs.length === 1,
     'onError calls: ' + errs.length);
  ok('...and the caller is given the database’s own message',
     errs[0] && /invalid input syntax/.test(errs[0].message || ''),
     errs[0] && errs[0].message);
  ok('the frame is kept for retry rather than dropped', pub.pending() > 0,
     'pending: ' + pub.pending());
  pub.stop();
}

/* and once the cause clears, the backlog goes in — the game is not lost */
{
  let refusing = true;
  const sb = fakeSb({ refuse: (table) => refusing && table === 'game_events' });
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  pub.pushEvents([{ id: 1, seq: 1, t: 'p2_make', team: 0, period: 1, clock: 100 }]);
  await pub.flushNow();
  ok('nothing was written while the write was refused', sb.wrote.game_events.length === 0);

  refusing = false;
  pub.pushEvents([{ id: 2, seq: 2, t: 'p3_make', team: 1, period: 1, clock: 90 }]);
  await pub.flushNow();
  const seqs = sb.wrote.game_events.map(r => r.seq).sort((a, b) => a - b);
  ok('when it clears, the held frame goes in too — nothing is lost',
     seqs.join() === '1,2', seqs.join());
  ok('...and in order', sb.wrote.game_events[0].seq === 1);
  pub.stop();
}

/* ---- 3. the broadcast must still go out --------------------------------------
   The hot path is deliberately independent of the durable one: a database
   problem should not also blank the public box score. */
{
  const sb = fakeSb({ refuse: () => true });
  const pub = Live.publisher({ gameId: 'g1', mode: 'supabase', supabase: sb });
  pub.pushEvents([{ id: 1, seq: 1, t: 'p2_make', team: 0, period: 1, clock: 100 }]);
  await pub.flushNow();
  ok('viewers are still served while the table refuses the write',
     sb.sent.length === 1 && sb.sent[0].event === 'frame', JSON.stringify(sb.sent));
}

/* ---- the scorer is told ----------------------------------------------------- */
{
  const src = require('node:fs').readFileSync(
    path.join(ROOT, 'epinoia', 'score', 'sync.js'), 'utf8');
  const boot = require('node:fs').readFileSync(
    path.join(ROOT, 'epinoia', 'score', 'bootstrap.js'), 'utf8');
  ok('sync passes a write-failure hook to the publisher', /onError:\s*\(err\)/.test(src));
  ok('...and the scorer shows it on the bar', /not saving/.test(boot));
  /* Asserted as a PROPERTY of the handler, not as a distance in the source.

     This used to be /writeWarned[\s\S]{0,400}alert\(/ — a bet that the flag and
     the alert would stay within 400 characters of each other. Adding a comment
     between them broke it, which is a test failing for a reason that has nothing
     to do with whether the scorer warns anybody. So the handler is sliced out
     and asked the two questions that matter: does it warn once rather than
     every frame, and does it actually interrupt. */
  const handler = boot.slice(boot.indexOf('const onWriteFail'),
                             boot.indexOf('window.EpinoiaSync.attach'));
  ok('...and interrupts if failures keep stacking up',
     handler.length > 0 &&
     /writeWarned\s*=\s*true/.test(handler) &&      // only once
     /if\s*\(count\s*<\s*5\s*\|\|\s*writeWarned\)\s*return/.test(handler) &&
     /alert\(/.test(handler));
  /* And that the interruption says something the statistician can act on: a
     policy refusal is nearly always a fixture awaiting re-claim, which starting
     the game fixes by itself. */
  ok('...and a permissions refusal explains itself rather than quoting Postgres',
     /42501|row-level security/i.test(handler) && /re-claim/i.test(handler));
}

/* ---- the announcement that makes a live game appear at once ----------------- */
{
  const fs = require('node:fs');
  const sync = fs.readFileSync(path.join(ROOT, 'epinoia', 'score', 'sync.js'), 'utf8');
  const strip = fs.readFileSync(path.join(ROOT, 'epinoia', 'embed', 'strip', 'strip.js'), 'utf8');
  ok('the scorer announces a status change on a fixed topic',
     /ANNOUNCE_TOPIC = 'epinoia:live'/.test(sync));
  ok('the strip listens on the same one',
     /ANNOUNCE_TOPIC = 'epinoia:live'/.test(strip));
  ok('...and never drops it when the watched games change',
     /only\(\[ANNOUNCE_TOPIC\]\.concat\(watchable\(gs\)\)/.test(strip));
  ok('an announcement causes a re-read rather than being believed',
     /onAnnounce[\s\S]{0,700}load\(\)/.test(strip));
  ok('the scorer announces the final whistle too, not just the tip',
     /finalise\(\)[\s\S]{0,220}maybeRoster\(S\)/.test(sync));
}

/* ---------------------------------------------------------------------------
   A SAVE THAT FAILS HAS TO SAY SO.

   save() was one setItem inside a bare catch that threw the error away, called on
   every tap. When it starts failing it fails hundreds of times and says nothing:
   the screen keeps drawing a perfect game, every number on it is right, and
   nothing has reached the phone since whenever the store filled up. The
   statistician finds out by reloading — which is what they do when something else
   goes wrong, which is exactly when this is most likely to have happened.

   The quota is shared, too: this origin also serves the analyser, and every
   scratch game leaves an eplive: key behind.
   --------------------------------------------------------------------------- */
{
  const fs2 = require('node:fs');
  const sc = fs2.readFileSync(path.join(ROOT, 'epinoia', 'score', 'index.html'), 'utf8');

  ok('a failed save is reported rather than swallowed',
     /catch\(e\)\{[\s\S]{0,200}saveBroken = true;[\s\S]{0,120}saveBanner\(/.test(sc));
  ok('...with a notice that names the only useful thing to do about it',
     /NOT BEING SAVED ON THIS PHONE/.test(sc) && /export the play-by-play now/.test(sc));
  ok('...and a button wired to the export',
     /b\.onclick = \(\) => \{ try\{ downloadJSON\(\); \}/.test(sc));
  ok('the notice does not stack on every subsequent tap',
     /if\(!saveBroken\)\{\s*\n?\s*saveBroken = true;/.test(sc));
  ok('...and it clears if saving starts working again',
     /if\(saveBroken\)\{[\s\S]{0,200}el\.remove\(\)/.test(sc));
  ok('the write is read back periodically, for a store that accepts and does not keep',
     /saveChecks % 40/.test(sc) && /written but not stored/.test(sc));
  ok('...but not on every tap, because that copies the whole game',
     !/const back = localStorage\.getItem\(EP_KEY\);\s*\n\s*if\(back == null[\s\S]{0,40}\}\s*\n\s*if\(saveBroken/.test(sc));
  ok('stale live-transport keys are swept on boot, since they share the same quota',
     /sweepLiveKeys/.test(sc) && /k\.indexOf\('eplive:'\) === 0 && k !== keep/.test(sc));
}

/* ---------------------------------------------------------------------------
   "COULD NOT ASK" IS NOT "NO".

   gateScorer decided with `allowed = !error && data === true`, under a catch that
   set it false — so a transport error was indistinguishable from "you may not
   score this game". Hall wifi drops while the page is loading, which is the normal
   case after the crash that flaky connection caused, and the statistician is told
   the fixture in their hands is not theirs: sync halted (one-way, by design) and a
   full-screen notice at a z-index above the escape hatch, so the saved game is
   physically unreachable behind it. Nothing recovered when the wifi came back.

   Three states now, and the middle one keeps scoring without publishing.
   --------------------------------------------------------------------------- */
{
  const fs3 = require('node:fs');
  const bs = fs3.readFileSync(path.join(ROOT, 'epinoia', 'score', 'bootstrap.js'), 'utf8');

  ok('the question has three answers, not two',
     /async function mayScoreThis\(sb\)/.test(bs) &&
     /if \(error\) return null;/.test(bs));
  ok('signed out is a real no, and answered without asking the server',
     /if \(!session\) return false;/.test(bs));
  ok('a thrown call is "could not ask", not "no"',
     /catch \(_\) \{ return null; \}/.test(bs));
  ok('only a definite no refuses',
     /if \(verdict === false\) \{[\s\S]{0,160}refuse\('This fixture is not yours to score'/.test(bs));
  ok('an unanswered question lets the scorer run',
     /unverified = true;[\s\S]{0,220}return true;/.test(bs));
  ok('...and says so on the badge rather than pretending',
     /offline \u00b7 not verified/.test(bs));
  ok('...publishes nothing while it is unknown',
     /if \(unverified\) return;\s*\n\s*clearInterval\(timer\);/.test(bs));
  ok('...and keeps asking until somebody answers',
     /function verifyLater\(sb\)/.test(bs) && /\}, 20000\);/.test(bs));
  ok('a later yes starts publishing, a later no refuses',
     /if \(v === true\) \{[\s\S]{0,200}unverified = false;/.test(bs) &&
     /\} else if \(v === false\) \{[\s\S]{0,200}refuse\(/.test(bs));
  ok('and halt() is never reached on the unverified path — it is documented one-way',
     !/unverified = true;[\s\S]{0,400}halt\(\)/.test(bs));
}

/* ---------------------------------------------------------------------------
   A BLANK PAGE MUST NOT OVERWRITE A GAME IN PROGRESS.

   The scorer boots with `S = newState()` -- blank, phase 'setup' -- and the
   saved game is deliberately NOT read back: it waits behind a `resume` control
   in the bar, because the old modal fired before the page had drawn and
   destroyed the game on "no".

   That leaves a window where S is blank and the phone still holds a whole game,
   and anything calling save() in it writes the blank one over the real one.
   adoptVideo did: it polls every 1500 ms, fires as soon as S is truthy -- which
   it is immediately -- and saved to persist the video row it had just read. On a
   fixture with a video attached, ONE reload was enough, with no tap and nothing
   on screen. And because injectSavedGame skips a saved state whose phase is
   'setup', the resume control did not return on the next load either: the game
   was gone and so was the door back to it.

   Two guards, because either alone would leave the other route open, plus the
   recovery the crash used to close.
   --------------------------------------------------------------------------- */
{
  const fs4 = require('node:fs');
  const sc4 = fs4.readFileSync(path.join(ROOT, 'epinoia', 'score', 'index.html'), 'utf8');
  const bs4 = fs4.readFileSync(path.join(ROOT, 'epinoia', 'score', 'bootstrap.js'), 'utf8');

  ok('the page knows at boot whether the phone already holds a game',
     /let savedInPlay = \(function \(\) \{[\s\S]{0,400}p\.phase !== 'setup' && \(p\.events \|\| \[\]\)\.length/.test(sc4));
  ok('...and save refuses to write a blank state over it',
     /function save\(\)\{\s*\n\s*if\(savedInPlay && S && S\.phase === 'setup'\)\{/.test(sc4) &&
     /shrinkSaid = true;[\s\S]{0,260}\n\s*return;\n\s*\}/.test(sc4));
  ok('...saying so once, to the console, because the bar already shows the game',
     /refusing to write a blank state over the stored game/.test(sc4) &&
     /if\(!shrinkSaid\)\{/.test(sc4));
  ok('...and the protection lifts the moment this page IS a game',
     /if\(S && S\.phase && S\.phase !== 'setup'\) savedInPlay = false;/.test(sc4));
  ok('...and when the stored game is discarded',
     /window\.epForgetSaved = function \(\) \{ savedInPlay = false; \};/.test(sc4) &&
     /window\.epForgetSaved && window\.epForgetSaved\(\)/.test(bs4));

  ok('the call site that should never have asked no longer asks',
     /if \(S\.phase !== 'setup' && typeof window\.save === 'function'\) window\.save\(\);/.test(bs4));
  ok('...and nothing else in adoptVideo saves unconditionally',
     !/S\.video\.trimMs = row\.trim_ms[\s\S]{0,80}\n\s*if \(typeof window\.save === 'function'\) window\.save\(\);/.test(bs4));

  /* And the recovery route the crash used to close. */
  ok('a scored fixture records which fixture it is',
     /if \(S\.fixtureId !== gameId\) \{ S\.fixtureId = gameId;/.test(bs4));
  ok('...so resume accepts the statistician\'s own game back',
     /if \(isFixture && saved\.fixtureId !== gameId\) \{/.test(bs4));
  ok('...and still refuses one that belongs to a different fixture',
     /belongs to a different fixture/.test(bs4));
  ok('...and one that does not say, which is every game recorded before today',
     /not say which fixture it belongs to/.test(bs4) &&
     /saved\.fixtureId\s*\n?\s*\?/.test(bs4));
}

/* ---------------------------------------------------------------------------
   THE PHONE MUST NOT LOCK ITSELF IN THE MIDDLE OF A GAME.

   The clock cam asks for a wake lock. The scoring app -- the one actually held
   for forty minutes of live play -- asked for nothing. iOS auto-lock defaults to
   thirty seconds, and a statistician's hands leave the screen for every stretch
   of play with no event in it, which in a semi-pro game is routinely twenty to
   forty seconds. Every lock costs a wake, a passcode or a Face ID and a
   re-orient, with the game still going on in front of them.

   Two halves, and the second is the one that would have made this look like it
   half-worked: the UA drops the lock on every backgrounding and restores
   nothing, so a scorer who glances at a message comes back to a phone that
   locks again thirty seconds later.
   --------------------------------------------------------------------------- */
{
  const fs5 = require('node:fs');
  const bs5 = fs5.readFileSync(path.join(ROOT, 'epinoia', 'score', 'bootstrap.js'), 'utf8');

  ok('the scoring app asks the phone to stay awake',
     /navigator\.wakeLock\.request\('screen'\)/.test(bs5));
  ok('...guarded, because every iOS before 16.4 has no such thing',
     /if \(!\('wakeLock' in navigator\)\) return;/.test(bs5));
  ok('...and a refusal is swallowed rather than thrown at a game in progress',
     /catch \(_\) \{ wake = null; \}/.test(bs5));
  ok('only while the game screen is up',
     /const onGame = \(\) => \{[\s\S]{0,160}!g\.classList\.contains\('hidden'\)/.test(bs5));
  ok('...read off the DOM, not the argument, because beginGame calls showScreen(\'game\') again',
     /showScreen is also called with/.test(bs5));
  ok('the lock is re-taken when the app comes back to the front',
     /visibilitychange[\s\S]{0,200}visibilityState === 'visible'\) sync\(\);/.test(bs5));
  ok('...and the dropped sentinel is let go of when it goes away',
     /else wake = null;\s*\/\/ the UA has already dropped it/.test(bs5));

  /* It composes with the legend's wrapper, in either order. The legend's is
     installed from inside a mount() that waits on an element being present, and
     the screen staying on must not be contingent on a caption measuring itself. */
  ok('it wraps showScreen under its own marker',
     /wrapped\.__wakeWrapped = true;/.test(bs5));
  ok('...and carries the legend\'s marker forward so neither installer wraps twice',
     /if \(inner\.__csWrapped\) wrapped\.__csWrapped = true;/.test(bs5));
  ok('...and keeps retrying until showScreen exists, then stops',
     /if \(!wrap\(\)\) \{[\s\S]{0,220}setTimeout\(\(\) => clearInterval\(t\), 15000\);/.test(bs5));
}

/* ---------------------------------------------------------------------------
   THE OFFLINE PAGE TOLD THE STATISTICIAN THEIR GAME DID NOT EXIST.

   /epinoia/sw.js is the push worker and caches nothing on purpose — "a live
   score served from yesterday's cache would be worse than no app at all", which
   is right for a page whose job is showing what is happening now. But it
   registers at scope '/epinoia/', a scope covers everything beneath it, and its
   fetch handler answers a failed request with a hard-coded page reading
   "Nothing is stored on this phone".

   For a statistician that sentence is false and it is the worst page there is.
   The whole game IS on the phone — the log lives in localStorage and the network
   is a publishing detail — and a hall's wifi dropping is the ordinary case. They
   reload out of habit when something looks wrong, which is exactly when the wifi
   has gone, and the app is replaced by a notice saying their game is not there.

   A more specific scope wins, so the scorer has its own.
   --------------------------------------------------------------------------- */
{
  const fs7 = require('node:fs');
  const sw = fs7.readFileSync(path.join(ROOT, 'epinoia', 'score', 'sw.js'), 'utf8');
  const sc7 = fs7.readFileSync(path.join(ROOT, 'epinoia', 'score', 'index.html'), 'utf8');

  ok('the scorer registers a worker of its own',
     /navigator\.serviceWorker\.register\('sw\.js', \{ scope: '\.\/'/.test(sc7));
  ok('...at a scope more specific than the push worker\'s, which is what displaces it',
     /scope: '\.\/'/.test(sc7) && !/scope: '\/epinoia\/'/.test(sc7));
  ok('...and the worker script itself is never served from the HTTP cache',
     /updateViaCache: 'none'/.test(sc7));
  ok('...registered on load, after everything the app needs',
     /window\.addEventListener\('load', function \(\) \{[\s\S]{0,300}serviceWorker\.register/.test(sc7));
  ok('...and on localhost too, or it could never be exercised before a hall',
     /location\.hostname === 'localhost'/.test(sc7));

  /* The list maintains itself: every asset carries a ?v= stamp that changes on
     deploy, and a hand-written precache list would go stale the first time one
     was bumped — silently, because the app still works online. */
  ok('what is cached is read off the page rather than listed here',
     /function declared\(html\)/.test(sw) && /const res = await fetch\(SHELL, \{ cache: 'reload' \}\)/.test(sw));
  ok('...including the fonts, which are declared in an inline @font-face block',
     /url\\\(\\s\*\(\['"\]\?\)/.test(sw) || /url\\\(/.test(sw));
  ok('...and one missing icon does not leave the phone with no application',
     /declared\(html\)\.map\(u => c\.add\(u\)\.catch\(\(\) => \{\}\)\)/.test(sw));

  ok('a navigation that fails is answered with the real application',
     /const hit = await caches\.match\(SHELL\);\s*\n\s*return hit \|\| nothingYet\(\);/.test(sw));
  /* Scoped to the response it actually serves: the header comment quotes the
     old message on purpose, to say what was wrong with it. */
  const served = sw.slice(sw.indexOf('const nothingYet'), sw.indexOf("self.addEventListener('fetch'"));
  ok('...and the fallback says where the game actually is',
     /A game already in progress is kept on the/.test(served) &&
     !/Nothing is stored on this phone/.test(served));

  /* The one thing a service worker in front of a live score must never do. */
  ok('nothing off this origin is touched, so the API can never come from a cache',
     /if \(url\.origin !== self\.location\.origin\) return;/.test(sw));
  ok('...and neither is anything that is not a GET',
     /if \(req\.method !== 'GET'\) return;/.test(sw));

  ok('a version this phone never saw falls back to the one it has',
     /ignoreSearch: true/.test(sw) && /bootstrap\.js\?v=318/.test(sw));
  ok('...and a cached asset is refreshed behind the answer, so a deploy lands next time',
     /e\.waitUntil\(fetch\(req\)\.then/.test(sw));
  ok('old versions of this cache are cleared on activate',
     /n\.indexOf\('epinoia-scorer-'\) === 0/.test(sw));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
