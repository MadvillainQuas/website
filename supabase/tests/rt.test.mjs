/* ============================================================================
   THE REALTIME CLIENT SURVIVES THE NETWORK.

   rt.js exists so the strip can hear a score change in a quarter of a second
   instead of a minute, and it speaks the Phoenix protocol by hand rather than
   loading 212kB of SDK onto a club's homepage. Speaking it by hand means the
   protocol is ours to get wrong, so the parts that can be wrong are held here:
   the join frame, the heartbeat, what counts as a dead socket, and — most
   importantly — that every topic comes back on a reconnect. A strip sits on a
   page for hours. A socket that dies quietly and never rejoins is worse than
   no socket, because the page goes on looking live while it has stopped being
   told anything.

     node supabase/tests/rt.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const RT = require(path.join(ROOT, 'epinoia', 'rt.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* A socket we drive by hand. Nothing here touches a network. */
const made = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; made.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  deliver(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
}
const mk = () => RT.create({
  url: 'https://abcdefgh.supabase.co', key: 'anon-key', WebSocket: FakeWS
});

/* ---- the handshake -------------------------------------------------------- */
{
  made.length = 0;
  const rt = mk();
  const s = made[0];
  ok('the socket carries the key and the protocol version',
     /^wss:\/\/abcdefgh\.supabase\.co\/realtime\/v1\/websocket\?apikey=anon-key&vsn=1\.0\.0$/.test(s.url),
     s.url);

  const frames = [];
  rt.watch('game:abc', f => frames.push(f));
  ok('nothing is sent before the socket opens', s.sent.length === 0);

  s.open();
  const join = s.sent.find(m => m.event === 'phx_join');
  ok('the topic is joined once the socket opens', !!join);
  ok('...namespaced as realtime:<topic>', join && join.topic === 'realtime:game:abc',
     join && join.topic);
  ok('...and asks not to be sent its own messages back',
     join && join.payload.config.broadcast.self === false);

  /* the SDK double-wraps a broadcast; the caller wants the inner payload */
  s.deliver({ topic: 'realtime:game:abc', event: 'broadcast',
              payload: { type: 'broadcast', event: 'frame',
                         payload: { state: { score_home: 7 } } } });
  ok('a frame is unwrapped to what the publisher actually sent',
     frames.length === 1 && frames[0].state.score_home === 7, JSON.stringify(frames));

  s.deliver({ topic: 'realtime:game:other', event: 'broadcast',
              payload: { event: 'frame', payload: { state: { score_home: 99 } } } });
  ok('a frame for a topic nobody watches is dropped', frames.length === 1);

  /* a rude callback must not take the socket down with it */
  rt.watch('game:abc', () => { throw new Error('rude'); });
  let survived = true;
  try {
    s.deliver({ topic: 'realtime:game:abc', event: 'broadcast',
                payload: { event: 'frame', payload: { state: {} } } });
  } catch (_) { survived = false; }
  ok('a callback that throws does not stop the others being called',
     survived && frames.length === 2, String(frames.length));
  rt.close();
}

/* ---- unsubscribing -------------------------------------------------------- */
{
  made.length = 0;
  const rt = mk();
  const s = made[0]; s.open();
  const seen = [];
  const off1 = rt.watch('game:a', () => seen.push('one'));
  const off2 = rt.watch('game:a', () => seen.push('two'));
  off1();
  ok('dropping one listener does not leave the topic',
     !s.sent.some(m => m.event === 'phx_leave'));
  s.deliver({ topic: 'realtime:game:a', event: 'broadcast', payload: { payload: {} } });
  ok('...and the listener that remains still hears', seen.join() === 'two', seen.join());
  off2();
  ok('dropping the last listener leaves the topic',
     s.sent.some(m => m.event === 'phx_leave' && m.topic === 'realtime:game:a'));
  ok('and nothing is left being watched', rt.topics.length === 0, rt.topics.join());
  rt.close();
}

/* ---- only(): swap the watched set without churning what is common ---------
   The strip calls this on every load. If it tore down and rebuilt every topic
   each time, a live game would lose its socket every four seconds — which is
   the opposite of what the file is for. */
{
  made.length = 0;
  const rt = mk();
  const s = made[0]; s.open();
  const cb = () => {};
  rt.only(['game:a', 'game:b'], cb);
  ok('only() joins what was asked for',
     rt.topics.slice().sort().join() === 'game:a,game:b', rt.topics.join());
  rt.only(['game:b', 'game:c'], cb);
  ok('a topic present in both sets is NOT re-joined',
     s.sent.filter(m => m.event === 'phx_join' && m.topic === 'realtime:game:b').length === 1,
     String(s.sent.filter(m => m.event === 'phx_join' && m.topic === 'realtime:game:b').length));
  ok('a topic that dropped out is unsubscribed',
     s.sent.some(m => m.event === 'phx_leave' && m.topic === 'realtime:game:a'));
  ok('and the new one is joined',
     rt.topics.slice().sort().join() === 'game:b,game:c', rt.topics.join());
  rt.close();
}

/* ---- the reconnect, which is why this file has tests ---------------------- */
{
  made.length = 0;
  const rt = mk();
  const first = made[0]; first.open();
  const heard = [];
  rt.watch('game:a', f => heard.push(f));
  rt.watch('game:b', f => heard.push(f));
  ok('two topics share one socket', made.length === 1 && rt.topics.length === 2);

  first.close();
  await new Promise(r => setTimeout(r, 1400));      // BACKOFF_MIN is 1000ms
  ok('a closed socket is replaced', made.length === 2, 'sockets made: ' + made.length);

  const second = made[1]; second.open();
  const rejoined = second.sent.filter(m => m.event === 'phx_join').map(m => m.topic).sort();
  ok('EVERY topic is re-joined on the new socket, without the caller asking',
     rejoined.join() === 'realtime:game:a,realtime:game:b', rejoined.join());

  second.deliver({ topic: 'realtime:game:b', event: 'broadcast', payload: { payload: { n: 1 } } });
  ok('and frames flow again afterwards', heard.length === 1 && heard[0].n === 1);
  rt.close();
}

/* ---- close() means closed ------------------------------------------------- */
{
  made.length = 0;
  const rt = mk();
  made[0].open();
  ok('the heartbeat is well inside Realtime’s 60s idle timeout',
     RT.HEARTBEAT_MS < 60000, String(RT.HEARTBEAT_MS));
  rt.close();
  const n = made.length;
  await new Promise(r => setTimeout(r, 1400));
  ok('a closed client never reconnects', made.length === n, made.length + ' vs ' + n);
}

/* ---- bad input is refused rather than half-built -------------------------- */
{
  ok('no url, no client', RT.create({ key: 'k', WebSocket: FakeWS }) === null);
  ok('no key, no client', RT.create({ url: 'https://x.supabase.co', WebSocket: FakeWS }) === null);
  /* An explicit WebSocket overrides; otherwise the environment's is used, which
     is what the browser relies on and what makes this file testable at all. */
  const envBacked = RT.create({ url: 'https://x.supabase.co', key: 'k' });
  ok('with no WebSocket named, the environment’s is used', envBacked !== null);
  if (envBacked) envBacked.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
