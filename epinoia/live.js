/* ============================================================================
   EPINOIA LIVE — the transport between a scorer and every watching browser.

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

     const live = EpinoiaLive.publisher({ gameId, mode:'local' });
     live.pushEvents([ev, …]);  live.pushState({period,clockMs,running,…});

     const sub = EpinoiaLive.subscriber({ gameId, mode:'local',
       onSnapshot: g => …, onFrame: f => …, onStatus: s => … });
     sub.clockMs();   // smooth local tick, no bandwidth
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLive = api;
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

/* This module is loaded in a browser, in a worker, and in Node by the tests.
   `self` exists in the first two and not the third, and referring to it bare
   threw the moment a local transport was constructed under Node. */
const G = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof self !== 'undefined') ? self : {};

const FRAME_MS   = 250;    // coalescing window
const POLL_MS    = 3000;   // fallback cadence when the socket is down
const STALE_MS   = 12000;  // no traffic for this long => degrade (> 2 heartbeats)
const RETRY_MAX  = 30000;

/* ============================================================================
   diffLog — what changed in the scorer's event log since we last published.

   The obvious implementation is a high-water mark: remember how many events
   were sent and publish everything past it. That was the implementation, and
   it is wrong in a way that only shows up when a statistician corrects
   something.

   An UNDO shortens the array. The count then sits BELOW the mark, so nothing
   is published — and worse, the mark stays high, so the next few events are
   silently swallowed until the count climbs past it again. A viewer keeps the
   retracted basket forever and misses its replacement. The scorer also allows
   inserting an event at an earlier point in the log, which a length comparison
   cannot see at all.

   So compare identities, not counts. Walk both lists while they agree; from
   the first disagreement, everything we published is retracted and everything
   the scorer now has is new. That handles append, undo, redo, and an edit in
   the middle of the log with one rule, and its cost is a loop over an array we
   already hold.
   ============================================================================ */
function diffLog(sentIds, events) {
  const ids = (events || []).map(e => (e.id != null ? e.id : e.seq));
  let i = 0;
  while (i < sentIds.length && i < ids.length && sentIds[i] === ids[i]) i++;
  return {
    added:   (events || []).slice(i),
    removed: sentIds.slice(i),
    ids
  };
}

/* ---------------------------------------------------------------- transports */

/* local: two tabs on the same origin. Durability is localStorage. */
function localTransport(gameId) {
  const KEY = 'eplive:' + gameId;
  const ch  = ('BroadcastChannel' in G) ? new G.BroadcastChannel(KEY) : null;
  const read  = () => { try { return JSON.parse(G.localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const write = v => { try { G.localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
  return {
    kind: 'local',
    async snapshot() { return read() || { events: [], state: null, game: null }; },
    async send(frame) {
      const cur = read() || { events: [], state: null, game: null };
      /* retractions first: an edit republishes the tail, so applying the new
         events before dropping the old ones would leave both in the store */
      if (frame.removed && frame.removed.length) {
        const gone = new Set(frame.removed);
        cur.events = cur.events.filter(e => !gone.has(e.seq));
      }
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

/* ---------------------------------------------------------------------------
   A WHOLE NUMBER, BECAUSE THE COLUMN IS AN INTEGER.

   game_events.clock, .period, .team and .seq are all `int`. The scorer's clock
   is a float — it is real elapsed milliseconds, and the simulator advances it
   by fractions — so a row could carry clock 580270.8394733587, which Postgres
   refuses outright: "invalid input syntax for type integer".

   An upsert is ONE statement, so one such row fails the whole batch. A game
   scored to the last whistle therefore wrote a single event — the opening
   period_start, whose clock happened to be exactly 600000 — and lost the other
   753. Nothing said so, because of the two faults below.

   Rounding here rather than at the scorer is deliberate: this is the boundary
   where the shape stops being JavaScript's and starts being the table's, and
   every producer (scorer, simulator, importer) crosses it. A millisecond
   rounded off a clock display is not a fact anybody can perceive; a lost
   quarter of basketball is. */
const whole = v => (v == null || v === '' ? null
  : (Number.isFinite(+v) ? Math.round(+v) : null));

/* ---------------------------------------------------------------------------
   A COLUMN THE DATABASE HAS NOT GOT MUST COST THE GARNISH, NOT THE GAME.

   game_state carries the score, the clock, the period, the possession arrow
   and the last sequence number — the things every viewer reads — plus, since
   the interval was added, two fields that say whether it is half-time.

   Postgres refuses a row, not a field. So a platform whose migrations were one
   behind refused the WHOLE state row over two decorative columns: the score
   stopped being written, the clock stopped being written, and the statistician
   was told the league database would not save the game. For a caption.

   The essential columns have existed since 0001 and are not going to fail.
   Anything added since is optional by definition — it was not there last
   season and the platform worked. So a refusal that names an unknown column is
   retried immediately without the optional half, and the game keeps being
   recorded while somebody finds a moment to run the migration.

   IT IS RETRIED ONCE, NOT INDEFINITELY, and only for that one error. A refusal
   for any other reason — a policy, a bad value, a dead connection — is the
   caller's to hear about, unchanged, because those are faults that need
   answering rather than working around. */
const STATE_CORE = ['period', 'clock_ms', 'running', 'score_home', 'score_away',
                    'possession', 'arrow', 'last_seq', 'updated_at'];

/* PostgREST answers a column it does not know with PGRST204, and Postgres with
   42703. Matched on both, plus the wording, because a proxy in between can
   rewrite one and not the other. */
function isUnknownColumn(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (code === 'PGRST204' || code === '42703') return true;
  return /column .* does not exist|could not find the .* column/i.test(
    String(err.message || '') + ' ' + String(err.details || ''));
}

async function writeState(sb, gameId, st) {
  const res = await sb.from('game_state').upsert(st);
  if (!res || !res.error || !isUnknownColumn(res.error)) return res;

  const core = { game_id: st.game_id };
  STATE_CORE.forEach(k => { if (k in st) core[k] = st[k]; });
  const retry = await sb.from('game_state').upsert(core);
  if (!retry || !retry.error) {
    console.warn('[live] game_state is missing a column this build writes (' +
      (res.error.message || res.error) + ') — the score and clock are still ' +
      'being saved without it. Apply the outstanding migrations.');
  }
  return retry;
}

/* supabase: broadcast for speed, table insert for durability */
function supabaseTransport(gameId, sb, onError) {
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
          return { game_id: gameId, seq: whole(seq != null ? seq : id), t, team: whole(team),
                   pid, period: whole(period), clock: whole(clock), payload: rest };
        }), { onConflict: 'game_id,seq', ignoreDuplicates: true }));
      }
      /* A retracted event must leave the durable log too, or finalise would
         rebuild the game from a row the statistician has already taken back —
         the public page would self-correct and the FINAL box score would not.
         Deleting is allowed only for whoever may score the game, and only
         while it is unfinished; the policy enforces both. */
      if (frame.removed && frame.removed.length) {
        jobs.push(sb.from('game_events').delete()
          .eq('game_id', gameId).in('seq', frame.removed));
      }
      /* game_state's clock_ms, period, score and last_seq are all `int` too, so
         a fractional clock refused this write for exactly the same reason —
         which is why the durable state was only ever correct at moments the
         clock happened to be whole, such as a stopped clock at 0:00. */
      if (frame.state) {
        const st = Object.assign({ game_id: gameId }, frame.state);
        ['period', 'clock_ms', 'score_home', 'score_away', 'possession', 'arrow', 'last_seq']
          .forEach(k => { if (k in st) st[k] = whole(st[k]); });
        jobs.push(writeState(sb, gameId, st));
      }
      /* A REFUSED WRITE IS NOT A FULFILLED PROMISE'S PROBLEM — it is ours.

         supabase-js resolves with { data, error }; it does not reject. So
         `every(r => r.status === 'fulfilled')` was true whether the rows went
         in or Postgres threw them out, send() reported success, the frame was
         never put on the backlog, and buf.splice(0) had already emptied the
         buffer. Every event was discarded the instant it failed, silently, for
         the whole game — and the first anyone knew was the finalise gate
         refusing to close a game the server could not reproduce.

         The error is read now. A failed frame returns false, which puts it on
         the backlog to be retried in order, and onError is told so a scorer
         can say out loud that nothing is being saved. */
      const res = await Promise.allSettled(jobs);
      const bad = res.map(r => r.status === 'rejected' ? (r.reason || new Error('send failed'))
                              : (r.value && r.value.error) || null)
                     .filter(Boolean);
      if (bad.length) {
        const first = bad[0];
        try { onError && onError(first, frame); } catch (_) {}
        console.warn('[live] durable write refused:', first.message || first, first.details || '');
        return false;
      }
      return true;
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

const makeTransport = (gameId, mode, sb, onError) =>
  (mode === 'supabase' && sb) ? supabaseTransport(gameId, sb, onError) : localTransport(gameId);

/* ---------------------------------------------------------------- publisher */

const HEARTBEAT_MS = 5000;    // quiet-period resync; MUST stay well under STALE_MS

function publisher(opts) {
  const { gameId, mode, supabase } = opts;
  const tx = makeTransport(gameId, mode, supabase, opts.onError);
  let buf = [], retract = [], timer = null, seqHigh = 0;
  let chain = Promise.resolve();        // sends run strictly in order
  const backlog = [];                       // frames that failed to send
  let beat = null, lastSend = 0;

  /* Sends are SERIALISED onto a chain rather than gated by a busy flag.

     The flag version deferred a frame to the backlog whenever another send was
     in flight, which is correct eventually but means flush() can return before
     its own frame has gone anywhere. That is fine for a routine flush and not
     fine for the one on pagehide: a correction made just before the tab closes
     would sit in a backlog that never drains, and the retracted event would
     survive in the log.

     Chaining keeps frames strictly in order — which matters, because a
     retraction and its replacement must not overtake each other — and lets
     `await flushNow()` mean what it says. */
  function flush() {
    timer = null;
    if (!buf.length && !retract.length && !backlog.length) return chain;
    lastSend = Date.now();
    /* every frame carries the authoritative clock, so a viewer that has been
       ticking locally corrects itself on the next play — self-healing, no extra
       messages, and an adjusted or mis-synced clock can never persist. */
    const frame = { gameId, events: buf.splice(0), removed: retract.splice(0),
                    state: opts.stateProvider ? opts.stateProvider() : null,
                    seq: ++seqHigh, at: Date.now() };

    chain = chain.then(() => deliver(frame));
    return chain;
  }

  /* ---------------------------------------------------------------------------
     ONE ORDERED WAY OUT, FOR EVERY KIND OF FRAME.

     There were three, and two of them lost data.

     THE BACKLOG WENT SECOND. A new frame was sent first and only then was the
     backlog drained, so a frame held back by a failure was written AFTER
     frames created later. For an event log keyed by seq that is merely untidy;
     for a retraction it is corruption, because the delete of event 5 could
     land after the insert of its replacement and take the replacement with it.
     Held frames therefore go first, and a new frame joins the end of the queue
     rather than jumping it.

     pushState DID NOT BACKLOG AT ALL. Its .catch() only caught a THROWN error,
     and a refused write does not throw — but a state frame carries whatever
     events are buffered, and buf.splice(0) has already emptied them. So every
     event that happened to ride out on a state frame was dropped on the floor
     with no retry and no trace. That was the same silent loss as the swallowed
     error, in a second place, and it is why this is now one function. */
  async function deliver(frame) {
    try {
      while (backlog.length) {                       // held frames go FIRST
        if (await tx.send(backlog[0])) backlog.shift();
        else break;
      }
      if (backlog.length) { backlog.push(frame); return false; }
      if (await tx.send(frame)) return true;
      backlog.push(frame);
      return false;
    } catch (_) { backlog.push(frame); return false; }
  }

  /* A state frame carries whatever events are buffered, so it must not
     overtake an earlier one — it goes on the chain like everything else. */
  function pushState(state, extra) {
    lastSend = Date.now();
    const frame = Object.assign({ gameId, events: buf.splice(0), removed: retract.splice(0),
                                  state, seq: ++seqHigh, at: Date.now() }, extra || {});
    if (timer) { clearTimeout(timer); timer = null; }
    chain = chain.then(() => deliver(frame));
    return chain;
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
    /* Queue events. Leading edge, then coalesce.

       A trailing-only window made every single tap wait the full FRAME_MS
       before it left, and most of a real game is isolated taps seconds apart —
       so the coalescing was costing latency without ever having anything to
       coalesce. Now the first event of a burst goes immediately and anything
       arriving during the window behind it rides the one follow-up message.
       A 40-event flurry still costs two messages, not forty. */
    pushEvents(evs, removed) {
      if (removed && removed.length) retract.push(...removed);
      if (evs && evs.length) buf.push(...evs);
      if (!buf.length && !retract.length) return;
      if (timer) return;                       // a window is already open

      const quiet = Date.now() - lastSend >= FRAME_MS;
      if (quiet) {
        flush();                               // nothing recent — go now
        timer = setTimeout(() => {             // hold the window open behind it
          timer = null;
          if (buf.length || retract.length) flush();
        }, FRAME_MS);
      } else {
        timer = setTimeout(flush, FRAME_MS);
      }
    },
    /** The whole game, not a delta.

        Frames are deltas by design, so a viewer that joins mid-game only ever
        learns about the future — which is why a public page could show one
        play and a 3-0 score while the scorer had seven and 6-3. Re-fetching
        the log from the table only helps when the log is being written, and a
        signed-out statistician still broadcasts perfectly well while every
        durable write is refused.

        So the broadcast itself carries a full snapshot periodically. A viewer
        needs no credentials, no database read and no luck about when it
        opened the page: within one interval it holds the entire game. Frames
        dedupe by event id, so this costs the viewer nothing but bandwidth. */
    /* The whole log, on a slow beat. ORDER MATTERS MORE HERE THAN ANYWHERE:
       a snapshot is authoritative and replaces what a viewer holds, so one
       captured before a correction and delivered after it would reinstate the
       retracted event. Chaining makes that impossible. */
    pushSnapshot(allEvents, state, game) {
      lastSend = Date.now();
      const frame = { gameId, events: allEvents || [], state, game,
                      full: true, seq: ++seqHigh, at: Date.now() };
      /* A snapshot is the one frame that may be dropped rather than held: it
         is a whole-game replacement and the next one supersedes it entirely,
         so a stale copy queued behind a failure is worse than none. It still
         goes through deliver() so it cannot overtake the backlog. */
      chain = chain.then(async () => {
        while (backlog.length) {
          if (await tx.send(backlog[0])) backlog.shift(); else return false;
        }
        try { return await tx.send(frame); } catch (_) { return false; }
      });
      return chain;
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
  const tx = makeTransport(gameId, mode, supabase);   // a reader writes nothing

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

return { publisher, subscriber, diffLog, FRAME_MS, POLL_MS, STALE_MS, VERSION: '1.1.0' };
}));
