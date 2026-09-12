/* ============================================================================
   A HUNG REQUEST MUST NOT TAKE THE GAME WITH IT.

   Every frame the scorer publishes goes through one promise chain, deliberately:
   a retraction must not overtake the write that replaces it. That chain is only
   as quick as the request at its head, and nothing was limiting one.

   A sports hall's access point does not usually fail by refusing a connection.
   It accepts the handshake and then stops answering — a captive portal wanting
   re-authentication, a saturated uplink, a handover between two APs sharing a
   name. The fetch then sits open for the BROWSER's own timeout, minutes on
   Chrome and on some iOS builds effectively unbounded. For all that time the
   chain is stopped, every subsequent play queues behind it, and the badge still
   says live because the socket is a different connection.

   This runs the shipped deadlinedFetch against a server that accepts the
   connection and then says nothing, at the real fifteen seconds — a shortened
   one would not prove the shipped number. It takes about fifteen seconds.

     node supabase/tests/fetch-deadline.test.mjs
   ============================================================================ */
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const src = readFileSync(path.join(ROOT, 'epinoia', 'config.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* Lift the shipped region rather than reimplementing it: the constant, the
   pattern that decides what gets a deadline, and the function itself. */
const from = src.indexOf('const FETCH_DEADLINE_MS');
const to = src.indexOf('window.epinoiaClient = function');
if (from < 0 || to < 0 || to < from) { console.error('could not find the region'); process.exit(1); }
const region = src.slice(from, to);
const { deadlinedFetch, FETCH_DEADLINE_MS, DEADLINED } =
  new Function(region + '\nreturn { deadlinedFetch, FETCH_DEADLINE_MS, DEADLINED };')();

console.log('\nwhich requests get a deadline');

ok('a PostgREST read does', DEADLINED.test('https://x.supabase.co/rest/v1/games?id=eq.1'));
ok('the realtime broadcast POST does', DEADLINED.test('https://x.supabase.co/realtime/v1/api/broadcast'));
/* Storage moves files — a reel off a phone is legitimately minutes — and an
   edge function may be finalising a game, which computes a season's awards and
   writes a match report. Neither sits in front of a live score. */
ok('storage does not, because an upload is legitimately long',
   !DEADLINED.test('https://x.supabase.co/storage/v1/object/highlights/q3.mp4'));
ok('an edge function does not, because finalising a game is legitimately long',
   !DEADLINED.test('https://x.supabase.co/functions/v1/finalise-game'));
ok('and the deadline is the one that was reasoned about', FETCH_DEADLINE_MS === 15000,
   String(FETCH_DEADLINE_MS));

/* ---- a server that accepts the connection and then says nothing ---------- */
const sockets = new Set();
const hung = http.createServer(() => { /* never respond, never close */ });
hung.on('connection', s => sockets.add(s));
await new Promise(r => hung.listen(0, '127.0.0.1', r));
const port = hung.address().port;
const restUrl = `http://127.0.0.1:${port}/rest/v1/game_events`;

console.log('\nand what happens when one of them hangs');

{
  const t0 = Date.now();
  let name = null;
  try { await deadlinedFetch(restUrl, { method: 'GET' }); }
  catch (e) { name = e.name; }
  const took = Date.now() - t0;

  ok('a request that is answered by silence is abandoned, not waited on',
     name === 'AbortError', 'threw ' + name);
  ok('...at the deadline rather than the browser\'s own timeout',
     took >= FETCH_DEADLINE_MS - 500 && took < FETCH_DEADLINE_MS + 5000,
     took + 'ms against a ' + FETCH_DEADLINE_MS + 'ms deadline');
}

{
  /* supabase-js passes its own signal on some paths — .abortSignal(), auth's
     own cancellation. Replacing it outright would quietly disable those, so
     ours is combined with it rather than substituted for it. */
  const c = new AbortController();
  const p = deadlinedFetch(restUrl, { method: 'GET', signal: c.signal });
  const t0 = Date.now();
  setTimeout(() => c.abort(), 150);
  let name = null;
  try { await p; } catch (e) { name = e.name; }
  ok('a caller that cancels is still obeyed', name === 'AbortError', 'threw ' + name);
  ok('...immediately, not fifteen seconds later', Date.now() - t0 < 3000,
     (Date.now() - t0) + 'ms');
}

{
  /* A path with no deadline must pass straight through — including its hang,
     which is the point: we are not putting a limit on an upload. */
  const c = new AbortController();
  const t0 = Date.now();
  const p = deadlinedFetch(`http://127.0.0.1:${port}/storage/v1/object/x`,
                           { method: 'GET', signal: c.signal });
  setTimeout(() => c.abort(), 400);
  let name = null;
  try { await p; } catch (e) { name = e.name; }
  ok('an exempt request is not abandoned by us', name === 'AbortError' && Date.now() - t0 < 3000,
     'threw ' + name + ' after ' + (Date.now() - t0) + 'ms');
}

sockets.forEach(s => s.destroy());
hung.close();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
