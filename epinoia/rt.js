/* ============================================================================
   EPINOIA REALTIME — broadcast frames, without the SDK.

   The scorer already publishes everything a viewer needs over a Supabase
   Realtime broadcast channel, `game:<uuid>`: score, period, clock, whether the
   clock is running, and the roster. The box score has listened to it from the
   start and reaches its viewers in about a quarter of a second.

   THE STRIP DID NOT. It polled the fixtures table — a minute apart when
   nothing was known to be live, four seconds apart once something was — which
   made it the slowest surface on the platform and the one most people see. A
   game that had just tipped could sit "upcoming" on somebody's homepage for a
   full minute, and the score behind it by as much again. That is what this is
   for.

   WHY NOT JUST LOAD supabase-js. Because the strip runs inside other people's
   pages. It ships no third-party script at all today, and its whole payload is
   smaller than a tenth of that library; pulling 212kB onto a club's homepage
   to open one websocket would be paid for by every visitor to that club, most
   of whom will never see a live game. The protocol underneath is Phoenix
   channels and the part we need is four message types, so we speak it.

   WHAT THIS DELIBERATELY DOES NOT DO. No presence, no postgres_changes, no
   RLS-authenticated channels, no sending. It joins public broadcast topics and
   hands frames to a callback. Anything richer belongs in live.js, which has
   the SDK and the sequencing to go with it.

   RECONNECTION IS THE WHOLE POINT OF THE FILE. A strip sits on a page for
   hours; laptops sleep, phones change network, and a socket that dies quietly
   is worse than no socket, because the caller believes it is being told
   things. So: heartbeats on a fixed beat, a missed heartbeat reply treated as
   death, exponential backoff with a cap, and every topic re-joined on the new
   socket without the caller being involved.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EpinoiaRT = factory();
}(typeof self !== 'undefined' ? self : this, function () {

const HEARTBEAT_MS = 25000;   // Realtime disconnects an idle socket at 60s
const REPLY_GRACE  = 12000;   // a heartbeat unanswered this long means dead
const BACKOFF_MIN  = 1000;
const BACKOFF_MAX  = 30000;

function create(opts) {
  const url = String(opts.url || '').replace(/\/+$/, '');
  const key = opts.key;
  const WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const onState = opts.onState || function () {};
  if (!url || !key || !WS) return null;

  const ref = (url.match(/^https?:\/\/([^.]+)\./) || [])[1];
  const socketUrl = (ref ? 'wss://' + ref + '.supabase.co' : url.replace(/^http/, 'ws')) +
    '/realtime/v1/websocket?apikey=' + encodeURIComponent(key) + '&vsn=1.0.0';

  /* topic -> Set of callbacks. One socket carries every game the strip is
     watching; joining a second socket per card would be a connection per
     fixture on somebody's homepage. */
  const subs = new Map();
  let ws = null, seq = 0, beat = null, deadline = null, retry = BACKOFF_MIN, closed = false;
  let joined = new Set();

  const send = o => { try { ws.send(JSON.stringify(o)); } catch (_) {} };
  const alive = () => ws && ws.readyState === 1;

  function join(topic) {
    if (!alive() || joined.has(topic)) return;
    joined.add(topic);
    send({ topic: 'realtime:' + topic, event: 'phx_join',
           payload: { config: { broadcast: { self: false }, presence: { key: '' } } },
           ref: String(++seq) });
  }

  function leave(topic) {
    if (alive() && joined.has(topic))
      send({ topic: 'realtime:' + topic, event: 'phx_leave', payload: {}, ref: String(++seq) });
    joined.delete(topic);
  }

  function heartbeat() {
    if (!alive()) return;
    /* A reply clears the deadline. If one never comes the socket is a corpse
       holding an open readyState, which is exactly the failure that leaves a
       strip frozen on a stale score with no error anywhere. */
    if (deadline == null) deadline = Date.now() + REPLY_GRACE;
    send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++seq) });
  }

  function connect() {
    if (closed) return;
    try { ws = new WS(socketUrl); } catch (_) { return schedule(); }
    joined = new Set();

    ws.onopen = function () {
      retry = BACKOFF_MIN;
      deadline = null;
      onState('open');
      subs.forEach((_, topic) => join(topic));
      clearInterval(beat);
      beat = setInterval(function () {
        if (deadline != null && Date.now() > deadline) { drop(); return; }
        heartbeat();
      }, HEARTBEAT_MS);
    };

    ws.onmessage = function (e) {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.event === 'phx_reply') { deadline = null; return; }
      if (m.event !== 'broadcast' || !m.payload) return;
      const topic = String(m.topic || '').replace(/^realtime:/, '');
      const cbs = subs.get(topic);
      if (!cbs) return;
      /* The SDK wraps a broadcast twice: the channel message carries
         {type,event,payload} and the caller wants the inner payload. */
      const frame = m.payload.payload !== undefined ? m.payload.payload : m.payload;
      const name = m.payload.event;
      cbs.forEach(cb => { try { cb(frame, name); } catch (_) {} });
    };

    ws.onerror = function () { /* onclose always follows; nothing to do here */ };
    ws.onclose = function () { onState('closed'); clearInterval(beat); beat = null; schedule(); };
  }

  function drop() {
    /* Close it ourselves so onclose runs and the backoff starts, rather than
       waiting on a socket that has already stopped answering. */
    clearInterval(beat); beat = null;
    try { ws.close(); } catch (_) { schedule(); }
  }

  function schedule() {
    if (closed) return;
    const wait = retry;
    retry = Math.min(BACKOFF_MAX, Math.round(retry * 1.8));
    setTimeout(connect, wait);
  }

  connect();

  return {
    /** listen to one topic; returns an unsubscribe */
    watch: function (topic, cb) {
      let cbs = subs.get(topic);
      if (!cbs) { cbs = new Set(); subs.set(topic, cbs); join(topic); }
      cbs.add(cb);
      return function () {
        const s = subs.get(topic);
        if (!s) return;
        s.delete(cb);
        if (!s.size) { subs.delete(topic); leave(topic); }
      };
    },
    /** replace the watched set in one go, keeping topics common to both */
    only: function (topics, cb) {
      const want = new Set(topics);
      subs.forEach((_, topic) => { if (!want.has(topic)) { subs.delete(topic); leave(topic); } });
      want.forEach(topic => {
        if (subs.has(topic)) return;
        const s = new Set([cb]); subs.set(topic, s); join(topic);
      });
    },
    get connected() { return alive(); },
    get topics() { return Array.from(subs.keys()); },
    close: function () { closed = true; clearInterval(beat); try { ws.close(); } catch (_) {} }
  };
}

return { create: create, HEARTBEAT_MS: HEARTBEAT_MS, VERSION: '1.0.0' };
}));
