/* ============================================================================
   COURTSIDE LIVE — the transport between a scorer and every watching browser.

   Two rules from the plan's latency loop:
     1. Publish FRAMES, not events. Events buffer for ~250 ms and go out as one
        message, so a miss→block→rebound burst costs one message, not three,
        and 500 viewers cost the database the same as 5.
     2. Never stream the clock. Publish clock TRANSITIONS (start/stop/adjust);
        every viewer ticks locally against a one-time server-time offset.

   Two transports, identical API:
     'supabase' — Realtime broadcast for the hot path, table insert for durability
     'local'    — BroadcastChannel + localStorage, so the whole pipeline can be
                  driven and tested across two tabs with no backend at all

     const live = CourtsideLive.publisher({ gameId, mode:'local' });
     live.pushEvents([ev, …]);  live.pushState({period,clockMs,running,…});

     const sub = CourtsideLive.subscriber({ gameId, mode:'local',
       onSnapshot: g => …, onFrame: f => …, onStatus: s => … });
     sub.clockMs();   // smooth local tick, no bandwidth
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideLive = api;
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

const FRAME_MS   = 250;    // coalescing window
const POLL_MS    = 3000;   // fallback cadence when the socket is down
const STALE_MS   = 12000;  // no traffic for this long => degrade (> 2 heartbeats)
const RETRY_MAX  = 30000;

/* ---------------------------------------------------------------- transports */

/* local: two tabs on the same origin. Durability is localStorage. */
function localTransport(gameId) {
  const KEY = 'cslive:' + gameId;
  const ch  = ('BroadcastChannel' in self) ? new BroadcastChannel(KEY) : null;
  const read  = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
  return {
    kind: 'local',
    async snapshot() { return read() || { events: [], state: null, game: null }; },
    async send(frame) {
      const cur = read() || { events: [], state: null, game: null };
      if (frame.events && frame.events.length) {
        const seen = new Set(cur.events.map(e => e.seq));
        frame.events.forEach(e => { if (!seen.has(e.seq)) cur.events.push(e); });
      }
      if (frame.state) cur.state = frame.state;
      if (frame.game)  cur.game  = frame.game;   // rosters, for late joiners
      write(cur);
      if (ch) ch.postMessage(frame);
      return true;
    },
    listen(onFrame) {
      if (!ch) return () => {};
      const h = e => onFrame(e.data);
      ch.addEventListener('message', h);
      return () => ch.removeEventListener('message', h);
    },
    async serverNow() { return Date.now(); }
  };
}

/* supabase: broadcast for speed, table insert for durability */
function supabaseTransport(gameId, sb) {
  let channel = null;
  return {
    kind: 'supabase',
    async snapshot() {
      const [{ data: events }, { data: state }, { data: g }] = await Promise.all([
        sb.from('game_events').select('*').eq('game_id', gameId).order('seq'),
        sb.from('game_state').select('*').eq('game_id', gameId).maybeSingle(),
        sb.from('games').select('id,status,starters,roster_snapshot,home_team_id,away_team_id,period')
          .eq('id', gameId).maybeSingle()
      ]);
      return {
        events: (events || []).map(r => Object.assign({ id: r.seq, seq: r.seq, t: r.t, team: r.team,
                                                        pid: r.pid, period: r.period, clock: r.clock }, r.payload || {})),
        state: state || null,
        // roster_snapshot is frozen at tip, so later roster edits never rewrite history
        game: g ? Object.assign({ status: g.status, starters: g.starters }, g.roster_snapshot || {}) : null
      };
    },
    async send(frame) {
      // hot path first — viewers should not wait on the write
      const ch = channel || (channel = sb.channel('game:' + gameId));
      ch.send({ type: 'broadcast', event: 'frame', payload: frame });
      const jobs = [];
      if (frame.events && frame.events.length) {
        jobs.push(sb.from('game_events').upsert(frame.events.map(e => {
          const { id, seq, t, team, pid, period, clock, ...rest } = e;
          return { game_id: gameId, seq: seq != null ? seq : id, t, team, pid, period, clock, payload: rest };
        }), { onConflict: 'game_id,seq', ignoreDuplicates: true }));
      }
      if (frame.state) {
        jobs.push(sb.from('game_state').upsert(Object.assign({ game_id: gameId }, frame.state)));
      }
      const res = await Promise.allSettled(jobs);
      return res.every(r => r.status === 'fulfilled');
    },
    listen(onFrame, onStatus) {
      channel = sb.channel('game:' + gameId);
      channel.on('broadcast', { event: 'frame' }, m => onFrame(m.payload));
      channel.subscribe(s => onStatus && onStatus(s === 'SUBSCRIBED' ? 'live' : 'connecting'));
      return () => { try { sb.removeChannel(channel); } catch (_) {} };
    },
    async serverNow() {
      // one round trip; Date header is server-authoritative
      try {
        const t0 = Date.now();
        const r = await fetch(sb.supabaseUrl + '/rest/v1/', { method: 'HEAD' });
        const d = r.headers.get('date');
        if (!d) return Date.now();
        return new Date(d).getTime() + (Date.now() - t0) / 2;   // half the round trip
      } catch (_) { return Date.now(); }
    }
  };
}

const makeTransport = (gameId, mode, sb) =>
  (mode === 'supabase' && sb) ? supabaseTransport(gameId, sb) : localTransport(gameId);

/* ---------------------------------------------------------------- publisher */

const HEARTBEAT_MS = 5000;    // quiet-period resync; MUST stay well under STALE_MS

function publisher(opts) {
  const { gameId, mode, supabase } = opts;
  const tx = makeTransport(gameId, mode, supabase);
  let buf = [], timer = null, seqHigh = 0, sending = false;
  const backlog = [];                       // frames that failed to send
  let beat = null, lastSend = 0;

  async function flush() {
    timer = null;
    if (!buf.length && !backlog.length) return;
    lastSend = Date.now();
    /* every frame carries the authoritative clock, so a viewer that has been
       ticking locally corrects itself on the next play — self-healing, no extra
       messages, and an adjusted or mis-synced clock can never persist. */
    const frame = { gameId, events: buf.splice(0), state: opts.stateProvider ? opts.stateProvider() : null,
                    seq: ++seqHigh, at: Date.now() };
    if (sending) { backlog.push(frame); return; }
    sending = true;
    try {
      const ok = await tx.send(frame);
      if (!ok) backlog.push(frame);
      while (backlog.length) {                       // drain in order
        const f = backlog[0];
        if (await tx.send(f)) backlog.shift(); else break;
      }
    } catch (_) { backlog.push(frame); }
    finally { sending = false; }
  }

  function pushState(state, extra) {
    lastSend = Date.now();
    const frame = Object.assign({ gameId, events: buf.splice(0), state, seq: ++seqHigh, at: Date.now() }, extra || {});
    if (timer) { clearTimeout(timer); timer = null; }
    tx.send(frame).catch(() => backlog.push(frame));
  }

  /* during a quiet stretch (a long dead ball, half-time) nothing is published,
     so a viewer who joined mid-gap would have no way to correct. Beat softly. */
  if (opts.stateProvider) {
    beat = setInterval(() => {
      if (Date.now() - lastSend >= HEARTBEAT_MS) pushState(opts.stateProvider());
    }, HEARTBEAT_MS);
  }

  return {
    transport: tx.kind,
    /** queue events; they leave within FRAME_MS as one message */
    pushEvents(evs) {
      if (!evs || !evs.length) return;
      buf.push(...evs);
      if (!timer) timer = setTimeout(flush, FRAME_MS);
    },
    /** clock transitions: start, stop, adjust, period change */
    pushState,
    /** send everything immediately (finalise, page unload) */
    flushNow: flush,
    pending: () => buf.length + backlog.length,
    stop() { if (beat) clearInterval(beat); if (timer) clearTimeout(timer); }
  };
}

/* ---------------------------------------------------------------- subscriber */

function subscriber(opts) {
  const { gameId, mode, supabase, onSnapshot, onFrame, onStatus } = opts;
  const tx = makeTransport(gameId, mode, supabase);

  let state = null;          // last known clock state
  let offset = 0;            // serverNow - Date.now()
  let lastSeq = 0;
  let lastTraffic = Date.now();
  let status = 'connecting';
  let stopListen = null, pollTimer = null, watchdog = null, retry = 1000;

  const setStatus = s => { if (s !== status) { status = s; onStatus && onStatus(s); } };

  function applyFrame(f) {
    if (!f) return;
    lastTraffic = Date.now();
    // a gap in the sequence means we missed a frame — resync rather than drift
    if (f.seq != null && lastSeq && f.seq > lastSeq + 1) { resync('gap'); return; }
    if (f.seq != null) lastSeq = f.seq;
    if (f.state) state = f.state;
    onFrame && onFrame(f);
    setStatus('live');
  }

  async function resync(why) {
    try {
      const snap = await tx.snapshot();
      state = snap.state || state;
      lastSeq = 0;
      onSnapshot && onSnapshot(snap, why);
      /* Only a frame arriving over the socket proves the scorer is live.
         A successful poll just means the store answered — that is 'delayed',
         never 'live', or a dark scorer would look healthy. */
      if (why === 'initial') { lastTraffic = Date.now(); setStatus('live'); }
      else if (status === 'offline') setStatus('delayed');
    } catch (_) { setStatus('offline'); }
  }

  async function start() {
    offset = (await tx.serverNow()) - Date.now();
    await resync('initial');
    stopListen = tx.listen(applyFrame, s => setStatus(s === 'live' ? 'live' : 'connecting'));
    if (tx.kind === 'local') setStatus('live');
    // degradation ladder: if nothing arrives for STALE_MS, poll instead of pretending
    watchdog = setInterval(() => {
      if (Date.now() - lastTraffic > STALE_MS) {
        if (status !== 'delayed') setStatus('delayed');
        if (!pollTimer) pollTimer = setInterval(() => resync('poll'), POLL_MS);
      } else if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }, 2000);
  }

  start();

  return {
    transport: tx.kind,
    get status() { return status; },
    get state() { return state; },
    /** the whole point: a smooth clock with zero bandwidth */
    clockMs() {
      if (!state) return 0;
      if (!state.running) return state.clock_ms != null ? state.clock_ms : state.clockMs || 0;
      const base = state.clock_ms != null ? state.clock_ms : state.clockMs || 0;
      const since = (Date.now() + offset) - new Date(state.updated_at || state.at || Date.now()).getTime();
      return Math.max(0, base - Math.max(0, since));
    },
    resync,
    stop() {
      if (stopListen) stopListen();
      if (pollTimer) clearInterval(pollTimer);
      if (watchdog) clearInterval(watchdog);
    }
  };
}

return { publisher, subscriber, FRAME_MS, POLL_MS, STALE_MS, VERSION: '1.0.0' };
}));
