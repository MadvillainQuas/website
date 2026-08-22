/* ============================================================================
   THE MIXERS, AND THE TIMING THAT SURVIVES THEM.

   Three integrations that are genuinely different, and one arithmetic that
   has to be right for all of them.

     OBS       a real bidirectional API. Builds the rundown, drives takes,
               reports the stream back — including how long it has been
               running, which is the only trustworthy answer to "when did the
               stream start".
     vMix      one-way unless the browser is allowed to read the reply. It is
               probed rather than assumed, and the interface says which one
               the operator has got.
     Wirecast  no control API at all. It does not need one: ONE browser source
               driven from the platform's own socket, which is also the right
               answer for every other mixer that can open a web page.

   What is asserted here:

     1. NOTHING CLAIMS TO DRIVE A MIXER IT CANNOT. drives:false is the whole
        Wirecast path, and a green light over a mixer nobody is talking to is
        worse than no light.
     2. THE ANCHOR COMES FROM THE MIXER, NOT FROM A BUTTON PRESS. A stream
        started in OBS twenty minutes early must still line up.
     3. NO CLOCK IS COMPARED ACROSS TWO MACHINES. The gap is server-to-server;
        the offset is device-to-device. A phone that is a minute fast must
        cancel itself exactly.
     4. INSERT TIME IS THE FALLBACK, NOT THE SOURCE. A wifi outage must not
        move a single clip.
     5. NO STREAM KEY IS EVER READ, LOGGED OR RENDERED.

     node supabase/tests/mixers.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const V = (await import('file://' + path.join(ROOT, 'epinoia', 'video.js'))).default
        || globalThis.EpinoiaVideo;
const mixers    = rd('epinoia', 'broadcast', 'control', 'mixers.js');
const control   = rd('epinoia', 'broadcast', 'control', 'control.js');
const ctrlHtml  = rd('epinoia', 'broadcast', 'control', 'index.html');
const layer     = rd('epinoia', 'broadcast', 'broadcast.js');
const scorer    = rd('epinoia', 'score', 'index.html');
const bootstrap = rd('epinoia', 'score', 'bootstrap.js');
const sql83     = rd('supabase', 'migrations', '0083_video_timing.sql');
const adminUI   = rd('epinoia', 'admin', 'stream-ui.js');
const gamejs    = rd('epinoia', 'game', 'game.js');
const tabjs     = rd('epinoia', 'game', 'video.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- 1. three integrations, each honest about itself --------------------- */
console.log('\nnothing claims to drive a mixer it cannot');

ok('there is an adapter for mixers with no API at all', /function manual\(/.test(mixers));
ok('...and it reports drives:false, which is the whole point',
   /drives: false/.test(mixers));
ok('OBS reports drives:true', /kind: 'obs', readable: true, drives: true/.test(mixers));
ok('vMix reports drives:true', /kind: 'vmix', drives: true/.test(mixers));

ok('take only reaches a mixer that can be driven',
   /if \(!mx \|\| !mx\.drives \|\| !\$\('#mxDrive'\)\.checked\) return;/.test(control));
ok('Wirecast and "any other mixer" are offered in the interface',
   /value="wirecast"/.test(ctrlHtml) && /value="manual"/.test(ctrlHtml));
ok('...and each has its own explanation rather than a shared one',
   /const MX_HELP = \{/.test(control) &&
   ['obs:', 'vmix:', 'wirecast:', 'manual:'].every(k => control.includes(k)));
ok('the Wirecast path is a numbered setup, not prose',
   /function manualSteps\(/.test(control) && /class="mxsteps"/.test(control));
ok('there is a setup sheet to take away from the screen',
   /function wirecastSheet\(/.test(control) && /expWirecast/.test(ctrlHtml));

/* The one-source path is worthless if the single source cannot do everything
   twelve sources could. Two things it could not do until now. */
console.log('\none browser source can do what twelve could');
ok('the layer applies the side it is sent, so one source can switch teams',
   /if \(frame\.side != null\) side = String\(frame\.side\) === '1' \? 1 : 0;/.test(layer));
ok('...which needs side to be reassignable', /^let side   =/m.test(layer));
ok('there is an off-air scene, so a graphic can come down',
   /blank: \(\) => ''/.test(layer));
ok('...and a button that means clean', /function clearAir\(/.test(control) &&
   /id="clearAir"/.test(ctrlHtml));
ok('going clean also clears a driven mixer',
   /await mx\.clearAll\(\)/.test(control));

/* ---- 2. the anchor comes from the mixer ---------------------------------- */
console.log('\nthe stream start is read, not assumed');

ok('OBS is asked how long it has been streaming',
   /async function streamStartedMsAgo\(\)/.test(mixers) && /st\.outputDuration/.test(mixers));
ok('...and reports null when nothing is streaming, which is not zero',
   /if \(!st\.outputActive\) return null;/.test(mixers));
ok('a stream started anywhere else is still noticed',
   /if \(st\.outputActive\) stampStreamStart\(\);/.test(control));
ok('...exactly once per stream', /let stampedStart = false/.test(control));
ok('what is sent is an ELAPSED DURATION, so the server stamps the moment',
   /p_stream_ms_ago: ago != null \? ago : 0/.test(control));
ok('the button no longer stamps a second, different way',
   !/await mx\.startStream\(\);\s*\n\s*stampStreamStart\(\);/.test(control));

/* Measured against a real OBS 32.2.2: StartStream and StartRecord return
   success and then do nothing at all when the output cannot start. OBS logs
   "failed to start"; obs-websocket says nothing. */
ok('a start request that succeeds is not treated as a stream that started',
   /async function confirmStarted\(\)/.test(control) &&
   /accepted the request but the stream has not started/.test(control));
ok('...and nothing is anchored to an attempt that never went live',
   /if \(st\.outputActive\) stampStreamStart\(\);/.test(control));

ok('the platform is read from the encoder rather than chosen from a dropdown',
   /providerFromServer/.test(mixers) && /patch\.p_provider = dest\.provider/.test(control));
ok('providerFromServer knows the ingest hosts',
   V.providerFromServer('rtmps://a.rtmps.youtube.com:443/live2') === 'youtube' &&
   V.providerFromServer('rtmp://live.twitch.tv/app') === 'twitch' &&
   V.providerFromServer('rtmps://live-api-s.facebook.com:443/rtmp') === 'facebook');
ok('...and says so rather than guessing when it does not',
   V.providerFromServer('rtmp://rtmp.example.org/live') === null);

/* The one thing a mixer genuinely cannot supply. */
ok('the watch URL is not invented from the stream key',
   !/streamServiceSettings[\s\S]{0,400}\bkey\b[\s\S]{0,80}(youtu|watch\?v)/.test(mixers));
ok('a league channel is the no-typing route instead',
   /function liveEmbedSrc/.test(rd('epinoia', 'video.js')) &&
   /channel_ref/.test(sql83) && /channel_ref/.test(adminUI));
ok('the live channel embed is the live edge, and says it cannot be seeked',
   /channelOnly/.test(tabjs) && /cannot be wound back/.test(tabjs));
ok('the box score falls back to it only while the game is live',
   /g\.status === 'live'/.test(gamejs) && /league_channel_for_game/.test(gamejs));

/* ---- 3. no clock crosses two machines ------------------------------------ */
console.log('\nthe gap is one clock and the offset is another');

const TIP_SRV = Date.parse('2026-03-14T14:00:00Z');   // the database's clock
const TIP_DEV = TIP_SRV + 60000;                      // a phone a minute fast
const VID = {
  provider: 'youtube', video_ref: 'dQw4w9WgXcQ',
  stream_started_at: new Date(TIP_SRV - 660000).toISOString(),
  tip_at: new Date(TIP_SRV).toISOString(),
  tip_wall: TIP_DEV,
  trim_ms: 0
};

ok('the gap is eleven minutes, from the two server stamps',
   V.gapMs(VID) === 660000, String(V.gapMs(VID)));

/* An event tapped ninety seconds after tip, on that same fast phone. */
const ev = { seq: 9, t: 'p3_made', pid: 'p1', period: 1, clock: 510000,
             wall: TIP_DEV + 90000,
             created_at: new Date(TIP_SRV + 97000).toISOString() };  // insert 7s late
ok('a wrong device clock cancels itself exactly',
   V.sinceTipMs(ev, VID) === 90000, String(V.sinceTipMs(ev, VID)));
ok('...so the play sits at 12:30 of video, not 12:37',
   V.videoMsOf(ev, VID) === 750000, String(V.videoMsOf(ev, VID)));

/* THE ONE THAT MATTERS MOST: a wifi outage. Every event scored while the
   connection was down is inserted at once when it comes back. */
const outage = [0, 15000, 30000, 45000].map((off, i) => ({
  seq: 20 + i, t: 'p2_made', pid: 'p1', period: 2, clock: 300000 - off,
  wall: TIP_DEV + 900000 + off,
  created_at: new Date(TIP_SRV + 1200000).toISOString()      // all in one batch
}));
const spread = V.index(outage, VID, { label: () => 'x' }).map(p => p.ms);
ok('four plays inserted in one batch keep four different positions',
   new Set(spread).size === 4, spread.join(','));
ok('...and they are 15 seconds apart, as they were played',
   spread[1] - spread[0] === 15000 && spread[3] - spread[2] === 15000, spread.join(','));

/* Without the device stamp there is nothing better than the insert time, and
   that fallback has to keep working — every game scored before this existed
   depends on it. */
const legacy = outage.map(e => { const c = Object.assign({}, e); delete c.wall; return c; });
const legacySpread = V.index(legacy, VID, { label: () => 'x' }).map(p => p.ms);
ok('an older log still lines up, through created_at',
   legacySpread.length === 4 && legacySpread.every(v => v > 0));
ok('...and shows exactly the flaw the device stamp fixes — all on one frame',
   new Set(legacySpread).size === 1, legacySpread.join(','));

/* ---- 4. the scorer stamps its own clock ---------------------------------- */
console.log('\nthe scorer stamps the tap, not the insert');

ok('every event carries the moment of the tap',
   /if\(ev\.wall==null\) ev\.wall = Date\.now\(\);/.test(scorer));
ok('...before anything can be published, batched or retried',
   scorer.indexOf('ev.wall = Date.now()') < scorer.indexOf('S.events.push(ev)'));
ok('tip-off is stamped on BOTH clocks, for the two different subtractions',
   /__tipFrom: ev\.wall, p_tip_wall: ev\.wall/.test(scorer));
/* Elapsed rather than an instant, because that write RETRIES. */
ok('...and as an elapsed duration, so a retry does not move the anchor',
   /out\.p_tip_ms_ago = Math\.max\(0, Date\.now\(\) - out\.__tipFrom\);/.test(bootstrap));
ok('the payload reaches the row untouched — rest becomes payload',
   /const \{ id, seq, t, team, pid, period, clock, \.\.\.rest \} = e;/.test(rd('epinoia', 'live.js')));

ok('the database stamps its own clock on request',
   /p_tip_now/.test(sql83) && /p_stream_ms_ago/.test(sql83));
ok('...and refuses a nonsense duration rather than anchoring before the league existed',
   /p_stream_ms_ago between 0 and 14400000/.test(sql83));
ok('the 0082 signature is dropped, or every named call becomes ambiguous',
   /drop function if exists public\.set_game_video\(uuid, text, text, text, text,\s*\n\s*timestamptz, timestamptz, int, boolean\);/
     .test(sql83.replace(/\r/g, '')));
ok('tip_wall is documented as a device clock, never to be compared with a server one',
   /Never compare it with a server timestamp/.test(sql83));

/* ---- 4b. the anchor survives the hall wifi -------------------------------- */
console.log('\ntip-off is the one write that cannot be dropped');

ok('the tip is queued and retried rather than fired and forgotten',
   /let pending = null, retryTimer = null/.test(bootstrap) &&
   /function schedule\(why\)/.test(bootstrap));
ok('patches merge, so a queue behind an outage arrives as one call',
   /pending = Object\.assign\(pending \|\| \{\}, patch\)/.test(bootstrap));
ok('...and only what was actually sent is cleared',
   /if \(pending === sending\) pending = null;/.test(bootstrap));
ok('the backoff settles rather than hammering a dead network',
   /Math\.min\(30000, Math\.round\(retryIn \* 1\.6\)\)/.test(bootstrap));
ok('a failure to anchor is said out loud, once',
   /video sync not saved/.test(bootstrap));
ok('a reloaded scorer offers the anchor the database is missing',
   /if \(S\.video\.tipWall && !row\.tip_wall\)/.test(bootstrap));
ok('the two refusals are told apart, rather than both saying "not a fixture"',
   /this game is not open for scoring/.test(bootstrap));

/* The elapsed conversion is the reason a retry is safe at all, so it is RUN
   rather than read: lifted out of the file and given a stamp from five seconds
   ago. If this ever became "now" again, every retry would move the anchor. */
/* Sliced by matching braces rather than by looking for a line that resembles
   the end — the function contains nested blocks, and an indexOf on an indented
   closing brace cut it off after its first statement. */
function lift(src, signature) {
  const from = src.indexOf(signature);
  if (from === -1) throw new Error('cannot find ' + signature);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(from, j + 1); }
  }
  throw new Error('unbalanced ' + signature);
}
const elapsedFrom = new Function('return ' +
  lift(bootstrap, 'function elapsedFrom(patch)'))();
const conv = elapsedFrom({ __tipFrom: Date.now() - 5000, p_tip_wall: 42 });
ok('__tipFrom becomes an elapsed duration at the moment of sending',
   conv.p_tip_ms_ago >= 4900 && conv.p_tip_ms_ago <= 5600, JSON.stringify(conv));
ok('...and the sentinel never reaches the database',
   !('__tipFrom' in conv) && !('__streamFrom' in conv));
ok('...while everything else is passed through untouched', conv.p_tip_wall === 42);
ok('the database can take an elapsed tip as well as a "now"',
   /p_tip_ms_ago   bigint default null/.test(sql83) &&
   /p_tip_ms_ago between 0 and 14400000/.test(sql83));
ok('...and every earlier signature is dropped BEFORE the new one is made',
   sql83.indexOf('drop function if exists public.set_game_video') <
   sql83.indexOf('create or replace function public.set_game_video'));

/* ---- 5. the key stays where it belongs ----------------------------------- */
console.log('\nno stream key is read, rendered or logged');

ok('the mixer layer reads the server but never returns the key',
   /server: s\.server \|\| null/.test(mixers) &&
   !/return[^;]*\bkey: s\.key/.test(mixers));
ok('the control room never renders a key',
   !/\$\('#lv[A-Za-z]*'\)\.(textContent|innerHTML)[^;]*\.key/.test(control));
ok('the admin listing still shows only the last four characters',
   /key_tail/.test(adminUI) && !/stream_key/.test(adminUI.replace(/stream_key: k/, '')));
ok('the channel id is stored as public, beside the key that is not',
   /not a credential/i.test(sql83));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
