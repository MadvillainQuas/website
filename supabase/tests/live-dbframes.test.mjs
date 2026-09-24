/* ============================================================================
   A FED GAME'S FRAMES FROM THE DATABASE (migration 0157).

   A fed game had nobody publishing for it, so every viewer polled: three
   requests every three seconds. The database now broadcasts every write the
   ingest makes, as frames marked src 'db'. These run the real subscriber over
   the real local transport and check:
     * the first database frame relaxes the watchdog to FED_STALE_MS and the
       fallback poll to FED_POLL_MS, and a poll already running stops;
     * a caller that asked to poll from the start (pollNow, the broadcast
       graphics) keeps its cadence;
     * a database frame, which has no seq, never trips the scorer's gap check,
       counts as traffic, and hands its events, removals and state on.

     node supabase/tests/live-dbframes.test.mjs
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, 'epinoia', 'live.js'));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.error('  FAIL  ' + name + '\n        got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
function post(gameId, payload) {
  const ch = new BroadcastChannel('eplive:' + gameId);
  ch.postMessage(payload);
  ch.close();
}

console.log('\nthe database speaks for a fed game');
{
  const gameId = 'dbframes-' + (++n);
  const frames = [];
  let resyncs = 0;
  const sub = L.subscriber({ gameId, mode: 'local', onFrame: f => frames.push(f), onSnapshot: () => { resyncs++; } });
  await wait(250);
  const before = sub.cadence();
  eq('before any database frame: the scorer\'s cadence', [before.staleMs, before.pollMs], [12000, 3000]);
  const resyncsBefore = resyncs;

  post(gameId, { gameId, src: 'db', events: [{ id: 7, seq: 7, t: 'p2_made', team: 0, pid: 'p1', period: 1, clock: 480000 }] });
  await wait(150);
  const after = sub.cadence();
  eq('the first database frame relaxes the watchdog and the fallback poll', [after.staleMs, after.pollMs, after.polling], [45000, 15000, false]);
  eq('...its events reach the page', frames.length === 1 && frames[0].events[0].seq, 7);

  post(gameId, { gameId, src: 'db', events: [], removed: [7] });
  post(gameId, { gameId, src: 'db', events: [], state: { game_id: gameId, period: 2, clock_ms: 300000, running: false,
                                                         score_home: 30, score_away: 28, last_seq: 12 } });
  await wait(150);
  eq('...removals and state are handed on too', [frames[1] && frames[1].removed, frames[2] && frames[2].state.score_home], [[7], 30]);
  eq('...the state is adopted', [sub.state && sub.state.period, sub.clockMs()], [2, 300000]);
  eq('...a database frame carries no seq, so it never trips the gap check into a resync', resyncs, resyncsBefore);
  eq('...and it counts as the game being heard from', sub.logAge() < 1000, true);
  sub.stop();
}

{
  const gameId = 'dbframes-' + (++n);
  const sub = L.subscriber({ gameId, mode: 'local', pollNow: true, pollMs: 2000, onFrame: () => {} });
  await wait(250);
  post(gameId, { gameId, src: 'db', events: [] });
  await wait(150);
  const c = sub.cadence();
  eq('a caller polling from the start (the broadcast graphics) keeps its own cadence', [c.staleMs, c.pollMs], [12000, 2000]);
  sub.stop();
}

{
  const gameId = 'dbframes-' + (++n);
  const sub = L.subscriber({ gameId, mode: 'local', onFrame: () => {} });
  await wait(250);
  post(gameId, { gameId, events: [], state: { clock_ms: 1000, running: false } });
  await wait(150);
  eq('a frame not from the database leaves the cadence alone', sub.cadence().staleMs, 12000);
  sub.stop();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
