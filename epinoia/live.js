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
/* how far a stamped clock may be run forward with no fresh reading behind it:
   past this the source is gone and the graphics hold rather than invent */
const CLOCK_RUN_ON_MS = 20000;
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
/* THE IDENTITY OF AN EVENT IS WHAT IT SAYS, NOT ONLY WHICH ONE IT IS.

   Comparing ids alone catches append, undo, redo and an insertion in the middle
   — everything that changes the SHAPE of the log. It is blind to the correction
   a statistician makes most often, which changes nothing about the shape: an
   edit in place. Relabelling a foul from personal to shooting, fixing which
   player scored, flipping a rebound from offensive to defensive — all of them
   keep the event's id and its position, so the diff found nothing to publish
   and the wrong version stood on air and in the durable log for the rest of the
   game. The scorer's own screen corrected itself immediately, which is what
   made it invisible from the table.

   So the key is the id followed by the content. Two details in how it is built
   matter:

     * the keys are SORTED. The edit path does `delete ev.off; delete ev.kind;
       Object.assign(ev, ...)`, which reorders an object's keys without changing
       a thing about it. Against a plain JSON.stringify that would retract and
       republish the whole tail every time somebody opened an action and saved
       it unchanged.

     * the id comes FIRST, separated by a NUL, which cannot occur in an integer.
       That is what lets the retraction list be read back out of the keys: the
       delete is by sequence number, and only this function knows both. */
function logKey(e) {
  const id = e.id != null ? e.id : e.seq;
  const ks = Object.keys(e).filter(k => k !== 'id' && k !== 'seq').sort();
  let s = '';
  for (let i = 0; i < ks.length; i++) {
    const v = e[ks[i]];
    if (v === undefined) continue;
    s += ks[i] + '\u0001' + (v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))) + '\u0002';
  }
  return id + '\u0000' + s;
}

function diffLog(sentKeys, events) {
  const evs = events || [];
  const ids = evs.map(logKey);
  let i = 0;
  while (i < sentKeys.length && i < ids.length && sentKeys[i] === ids[i]) i++;
  return {
    added:   evs.slice(i),
    /* numbers, because the durable delete is `in ('seq', ...)` */
    removed: sentKeys.slice(i).map(k => {
      const j = String(k).indexOf('\u0000');
      return j < 0 ? +k : +String(k).slice(0, j);
    }),
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
  /* ONE CHANNEL, AND IT IS JOINED.

     send() used to do `channel || (channel = sb.channel(...))` and nothing ever
     subscribed it, because subscribe lives in listen() and listen is only
     called by a SUBSCRIBER -- and the scorer builds a publisher and nothing
     else. supabase-js does not fail on an unjoined channel; it falls back to a
     fresh HTTPS POST to /realtime/v1/api/broadcast, one per frame, which is the
     slowest path there is. Several times a second, off a phone on a sports
     hall's uplink, for the length of a game, to deliver something the socket
     was sitting there ready to carry.

     Joined lazily rather than at construction, because listen() has to bind its
     handler BEFORE subscribing or it can miss the first frames, and the
     transport does not know at construction which half it is. publisher() and
     subscriber() each build their own instance, so one is never both. */
  let channel = null, joining = false;

  function chan() {
    if (!channel) channel = sb.channel('game:' + gameId);
    return channel;
  }
  /* A publisher wants the socket open and has nothing to listen for. */
  function joinForSending() {
    if (joining || !channel) return;
    joining = true;
    try { channel.subscribe(); } catch (_) { joining = false; }
  }

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
      const ch = chan();
      joinForSending();
      /* Started here and awaited at the bottom, so the durable write still
         runs alongside it rather than behind it. The result was thrown away
         before, so a broadcast that never left was indistinguishable from one
         that did. */
      const cast = Promise.resolve(ch.send({ type: 'broadcast', event: 'frame', payload: frame }))
        .catch(() => 'error');
      const jobs = [];

      /* THE RETRACTION GOES FIRST, AND IT GOES ALONE.

         A retracted event must leave the durable log too, or finalise would
         rebuild the game from a row the statistician has already taken back —
         the public page would self-correct and the FINAL box score would not.
         Deleting is allowed only for whoever may score the game, and only while
         it is unfinished; the policy enforces both.

         It used to be pushed onto the same jobs array as the upsert, AFTER it,
         and both were fired together with Promise.allSettled. So the two
         requests left in the same tick and the server decided their order,
         directly contradicting the local transport, which has always applied
         retractions first and says why.

         The order is not a nicety here. A correction republishes the tail from
         the point it changed, reusing those sequence numbers, and the upsert
         runs with ignoreDuplicates — which means that if it arrives while the
         old rows are still there it is a no-op for every one of them. The
         delete then removes the rows it did not replace. A mid-log time
         correction in a game with three hundred actions after it therefore
         deleted three hundred rows and wrote none of them back, deterministicly,
         and the only place the game still existed intact was the phone.

         Awaited, so the rows are gone before anything tries to insert them, and
         a refused delete abandons the frame rather than letting the upsert run
         into rows it will silently decline to replace. */
      if (frame.removed && frame.removed.length) {
        /* In chunks, because this is a query string: a correction early in a
           long game retracts everything after it, and a single `in` list of
           several hundred sequence numbers is a URL long enough to be refused
           outright by the edge in front of PostgREST. */
        for (let i = 0; i < frame.removed.length; i += 200) {
          const { error } = await sb.from('game_events').delete()
            .eq('game_id', gameId).in('seq', frame.removed.slice(i, i + 200));
          if (error) {
            try { onError && onError(error, frame); } catch (_) {}
            console.warn('[live] retraction refused:', error.message || error);
            return false;
          }
        }
      }

      /* A SNAPSHOT IS FOR THE SOCKET, NOT FOR POSTGRES.

         sync.js publishes the whole log every ten seconds, and its comment says
         exactly why: somebody who opens the public page at the start of the
         third quarter needs the whole game, over the BROADCAST, with no
         credentials and no table read. That is the snapshot's entire purpose and
         it is served by the ch.send above.

         This did not know a snapshot from a delta, so it fired the durable
         upsert for it as well. Every ten seconds, for the rest of the game, the
         complete event log was written to the database again: at eight hundred
         events that is eight hundred rows of conflict checking and eighty
         kilobytes off a phone on a sports hall's uplink, six times a minute,
         to change nothing — ignoreDuplicates makes the whole write a no-op for
         every row that is already there, which by then is all of them.

         The delta frames are what make the log durable, and a refused one is
         backlogged and retried in order. The accidental self-heal this was
         providing is replaced by a deliberate one in sync.js, which asks the
         server how many rows it holds once a minute and only sends anything if
         the answer is short. */
      if (frame.events && frame.events.length && !frame.full) {
        jobs.push(sb.from('game_events').upsert(frame.events.map(e => {
          const { id, seq, t, team, pid, period, clock, ...rest } = e;
          return { game_id: gameId, seq: whole(seq != null ? seq : id), t, team: whole(team),
                   pid, period: whole(period), clock: whole(clock), payload: rest };
        }), { onConflict: 'game_id,seq', ignoreDuplicates: true }));
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

      /* A LOST BROADCAST IS REPORTED, BUT IT DOES NOT FAIL THE FRAME.

         The two halves of send() answer different questions. The durable write
         is whether the league has the game: a failure there backlogs the frame
         and everything after it queues behind, which is right, because a game
         the database does not have is a game that cannot be finalised. The
         broadcast is whether people watching right now saw the play, and the
         ten-second snapshot repairs that on its own.

         Making a broadcast failure fail the frame would tie the more important
         half to the less important one: a channel that is refusing -- rate
         limited, mid-reconnect -- would stop the backlog draining at all, and
         with it every durable write for the rest of the game. So it is retried
         once over the socket and then said out loud, and the frame stands. */
      /* Only an explicit failure counts. supabase-js answers 'ok', 'error' or
         'timed out'; anything else is a version that does not answer at all,
         and treating silence as failure would double every frame on the wire
         for the length of a game to fix a problem that may not exist. */
      const lost = v => (v === 'error' || v === 'timed out');
      let castOk = 'ok';
      try { castOk = await cast; } catch (_) { castOk = 'error'; }
      if (lost(castOk)) {
        try {
          castOk = await Promise.resolve(ch.send({ type: 'broadcast', event: 'frame', payload: frame }))
            .catch(() => 'error');
        } catch (_) { castOk = 'error'; }
        if (lost(castOk)) {
          console.warn('[live] broadcast not delivered (' + castOk +
                       ') — viewers correct on the next snapshot');
        }
      }
      return true;
    },
    /* THE CHEAP POLL. A full snapshot is the whole log every time -- five hundred rows every
       two seconds on a poor connection is how a layer falls behind the game it is drawing.
       The delta asks only for what is new past the last sequence held, plus the state row and
       the fixture's own fields (starters, roster, period, status), which are small. */
    async delta(afterSeq) {
      const [{ data: events }, { data: state }, { data: g }] = await Promise.all([
        sb.from('game_events').select('*').eq('game_id', gameId).gt('seq', afterSeq || 0).order('seq'),
        sb.from('game_state').select('*').eq('game_id', gameId).maybeSingle(),
        sb.from('games').select('id,status,starters,roster_snapshot,period').eq('id', gameId).maybeSingle()
      ]);
      return {
        events: (events || []).map(r => Object.assign({ id: r.seq, seq: r.seq, t: r.t, team: r.team,
                                                        pid: r.pid, period: r.period, clock: r.clock }, r.payload || {})),
        state: state || null,
        game: g ? Object.assign({ status: g.status, starters: g.starters, period: g.period }, g.roster_snapshot || {}) : null
      };
    },
    listen(onFrame, onStatus) {
      /* The same object send() uses, not a second one: reassigning it left the
         first channel joined and unreferenced on any page that did both. The
         handler is bound before subscribing, which is the reason the join is
         lazy rather than done at construction. */
      const ch = chan();
      ch.on('broadcast', { event: 'frame' }, m => onFrame(m.payload));
      joining = true;
      ch.subscribe(s => onStatus && onStatus(s === 'SUBSCRIBED' ? 'live' : 'connecting'));
      return () => { try { sb.removeChannel(ch); } catch (_) {} channel = null; joining = false; };
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
  /* A FED GAME NEVER SENDS A FRAME: its store is written by the ingest worker, not by a
     scorer on a socket, so the only way its changes reach a reader is a poll. A caller that
     knows this asks for polling from the start (pollNow) at its own cadence (pollMs) -- the
     broadcast layer asks for two seconds on an armed game -- rather than waiting out the
     stale timer and then polling at the fallback rate. */
  const pollEvery = Math.max(500, +opts.pollMs || POLL_MS);
  const pollNow = !!opts.pollNow;
  const tx = makeTransport(gameId, mode, supabase);   // a reader writes nothing

  let state = null;          // last known clock state
  let offset = 0;            // serverNow - Date.now()
  let lastSeq = 0;
  let lastTraffic = Date.now(), clockTraffic = Date.now();
  let status = 'connecting';
  let stopListen = null, pollTimer = null, watchdog = null, retry = 1000;
  let maxSeq = 0;            // the highest event sequence held, for the cheap poll
  let polling = false, lastFull = 0;
  const FULL_EVERY_MS = 30000;   // a retraction cannot be seen in a delta; a full read catches it
  const setStatus = s => { if (s !== status) { status = s; onStatus && onStatus(s); } };
  const noteSeqs = evs => { (evs || []).forEach(e => { const s = +(e.seq != null ? e.seq : e.id); if (s > maxSeq) maxSeq = s; }); };
  /* THE CLOCK HAS A PECKING ORDER. A federation feed's clock is a snapshot that moves when the
     table syncs an action; a clock keeper in the control room, or a camera on the hall's
     scoreboard, sends the real thing. When one of those has spoken in the last twenty seconds
     its clock fields are kept and the feed's are not allowed to overwrite them; everything
     else in the polled state (score, fouls, possession) is still taken. */
  let authority = null;        // { source, until, at }
  const AUTHORITY_MS = 20000;
  /* TWO SOURCES ON ONE CLOCK MUST NOT TAKE TURNS.

     A control room can have a keeper tapping and a camera on the board at the
     same time, and both publish continuously -- the keeper re-states itself every
     five seconds, the camera reads every second and a half. Whichever frame
     landed last won, so the clock alternated between a human's taps and a
     camera's readings several times a minute, sliding a little each way. On air
     that is a clock that will not settle, and nothing anywhere said why.

     So the source that is actually driving keeps the clock until it goes quiet.
     A rival only gets it after this long without a word from the incumbent, which
     a camera at a frame and a half never is and a keeper's five-second restatement
     always is -- so a camera on the board beats a keeper who has stopped tapping,
     which is the right way round.

     The exception is a DELIBERATE ACT. A tap on start or stop, a time typed in,
     carries assert and takes the clock at once: a person reaching for the keeper
     while a camera is misreading is the one case where the human must win, and
     they should not have to wait three seconds to be heard. */
  const HANDOVER_MS = 3000;
  const clockFields = ['clock_ms', 'running', 'updated_at', 'at', 'period', 'source'];
  function adoptState(next, viaFrame) {
    if (!next) return;
    const src = next.source;
    if (viaFrame && (src === 'keeper' || src === 'cam')) {
      const now = Date.now();
      const contested = authority && authority.source !== src && now - (authority.at || 0) < HANDOVER_MS;
      if (contested && !next.assert) {
        /* somebody else is driving and has not gone quiet: take everything this
           frame carries except its opinion of the clock */
        if (state) {
          const kept = {};
          clockFields.forEach(k => { if (k in state) kept[k] = state[k]; });
          state = Object.assign({}, state, next, kept);
        }
        return;
      }
      authority = { source: src, until: now + AUTHORITY_MS, at: now };
      state = Object.assign({}, state || {}, next);
      return;
    }
    if (authority && Date.now() < authority.until && state) {
      const kept = {};
      clockFields.forEach(k => { if (k in state) kept[k] = state[k]; });
      state = Object.assign({}, next, kept);
      return;
    }
    state = next;
  }
  function applyFrame(f) {
    if (!f) return;
    /* ONLY THE SCORER'S OWN FRAMES COUNT AS THE SCORER BEING ALIVE.

       The clause used to include f.state, and the reasoning above it -- a phone
       saying hello must not stop the ladder noticing a dark scorer -- was exactly
       right and the code did not implement it. The clock keeper restates the clock
       every five seconds and the clock cam publishes a reading every second and a
       half, and BOTH of those frames carry state. So on any game where the control
       room is keeping the clock or a camera is on the board -- which is every game
       worth broadcasting -- the statistician's tablet could die at 8:00 of the
       third and this never noticed. lastTraffic was refreshed by the keeper,
       STALE_MS never elapsed, the watchdog never fired, the ladder never dropped to
       polling, and the status stayed 'live' over a feed where the score had stopped
       moving. The clock kept ticking on air the whole time, which is precisely what
       makes it convincing.

       Every publisher frame carries a seq (flush, pushState, pushSnapshot all
       stamp one); no keeper or cam frame does. So seq is the thing that means
       "the game is still being recorded", and state alone is not. */
    if (f.events || f.seq != null || f.full) lastTraffic = Date.now();
    /* Clock freshness is tracked separately rather than thrown away: a layer that
       wants to say "clock live, score stale" -- which is the honest thing to put on
       air in exactly this situation -- needs both ages, not one merged one. */
    if (f.state) clockTraffic = Date.now();
    // a gap in the sequence means we missed a frame — resync rather than drift
    if (f.seq != null && lastSeq && f.seq > lastSeq + 1) { resync('gap'); return; }
    if (f.seq != null) lastSeq = f.seq;
    if (f.state) adoptState(f.state, true);
    noteSeqs(f.events);
    onFrame && onFrame(f);
    /* a clock frame alone does not prove a scorer is on the socket: the status stays as it was */
    if (f.events || f.seq != null || f.full) setStatus('live');
  }
  /* ONE POLL AT A TIME. On a slow link a poll can take longer than the interval; a second
     one starting before the first returns would stack requests until the connection gave
     up. A poll that finds the transport can do a delta asks for the delta; every
     FULL_EVERY_MS it takes the whole snapshot instead, which is what retracted events and a
     replaced roster need. */
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      if (!tx.delta || Date.now() - lastFull > FULL_EVERY_MS) { await resync('poll'); return; }
      const d = await tx.delta(maxSeq);
      if (d.state) adoptState(d.state, false);
      noteSeqs(d.events);
      if (onFrame && (d.events.length || d.state || d.game)) onFrame({ events: d.events, state: d.state, game: d.game, full: false, polled: true });
      if (status === 'offline') setStatus('delayed');
    } catch (_) { setStatus('offline'); }
    finally { polling = false; }
  }
  async function resync(why) {
    try {
      const snap = await tx.snapshot();
      if (snap.state) adoptState(snap.state, false);
      lastSeq = 0;
      maxSeq = 0; noteSeqs(snap.events);
      lastFull = Date.now();
      onSnapshot && onSnapshot(snap, why);
      /* Only a frame arriving over the socket proves the scorer is live.
         A successful poll just means the store answered — that is 'delayed',
         never 'live', or a dark scorer would look healthy. */
      if (why === 'initial') { lastTraffic = clockTraffic = Date.now(); setStatus('live'); }
      else if (status === 'offline') setStatus('delayed');
    } catch (_) { setStatus('offline'); }
  }

  async function start() {
    offset = (await tx.serverNow()) - Date.now();
    await resync('initial');
    stopListen = tx.listen(applyFrame, s => setStatus(s === 'live' ? 'live' : 'connecting'));
    if (tx.kind === 'local') setStatus('live');
    if (pollNow && !pollTimer) pollTimer = setInterval(poll, pollEvery);
    // degradation ladder: if nothing arrives for STALE_MS, poll instead of pretending
    watchdog = setInterval(() => {
      if (Date.now() - lastTraffic > STALE_MS) {
        if (status !== 'delayed') setStatus('delayed');
        if (!pollTimer) pollTimer = setInterval(poll, pollEvery);
      } else if (pollTimer && !pollNow) { clearInterval(pollTimer); pollTimer = null; }
    }, 2000);
  }

  start();

  return {
    transport: tx.kind,
    get status() { return status; },
    get state() { return state; },
    /** who is driving the clock right now: 'keeper', 'cam', or 'feed' */
    clockSource() { return (authority && Date.now() < authority.until) ? authority.source : 'feed'; },
    /** IS ANYBODY STILL DRIVING IT?

        clockMs() stops running the last reading forward once it is older than
        CLOCK_RUN_ON_MS, which keeps it from counting down to zero on a dead
        source. But a consumer that ticks its OWN clock between readings — which
        every graphics layer does, because that is what makes it smooth — has no
        way to know the target has stopped moving, so it ticks away from a frozen
        target, snaps back when the gap gets big enough, and does it again. A clock
        that sawtooths on air is worse than one that has visibly stopped.

        True only for a clock that claims to be RUNNING: a stopped clock is
        supposed to sit still, and its age says nothing. */
    clockStale() {
      if (!state || !state.running) return false;
      const at = new Date(state.updated_at || state.at || 0).getTime();
      if (!at) return false;
      return ((Date.now() + offset) - at) > CLOCK_RUN_ON_MS;
    },
    /** HOW LONG SINCE THE GAME ITSELF WAS HEARD FROM, in ms.

        Distinct from clockAge() on purpose. A game with a clock keeper or a clock
        cam on it has two independent sources, and they fail independently: the
        common bad case is a dead statistician under a live clock, which reads as a
        perfectly healthy stream with a frozen score. A consumer that wants to be
        honest about that can compare the two. */
    logAge() { return Date.now() - lastTraffic; },
    /** how long since anybody stated the clock, in ms */
    clockAge() { return Date.now() - clockTraffic; },
    /** the whole point: a smooth clock with zero bandwidth */
    clockMs() {
      if (!state) return 0;
      if (!state.running) return state.clock_ms != null ? state.clock_ms : state.clockMs || 0;
      const base = state.clock_ms != null ? state.clock_ms : state.clockMs || 0;
      /* A CLOCK NOBODY IS DRIVING MUST STOP, NOT RUN OUT.

         This ran the last reading forward by however long ago it was, with no
         limit. That is right for the second or two between readings, which is what
         it is for. It is wrong when the source dies: a phone whose battery goes at
         8:00 of the third left every layer on the stream counting steadily down to
         0:00 and sitting there, through the rest of the quarter, with nothing to
         say the clock had stopped being a clock.

         Every source that stamps updated_at refreshes far faster than this -- the
         clock cam at most a second and a half, the keeper on every tap, a feed
         every two seconds -- so the cap can only ever bind when there is no longer
         anybody there. It is set to the same twenty seconds after which a camera's
         authority lapses: if a feed exists it takes the clock back at that moment,
         and if one does not, the graphics hold the last time anybody actually saw
         rather than inventing the rest of the quarter. A clock frozen at 8:00 is
         obviously broken to whoever is producing the stream. One reading 0:00 in
         the middle of a period just looks like the game.

         The scoring app is the one worth checking, because it publishes clock
         TRANSITIONS rather than a clock every second, and a quiet stretch of a
         quarter can pass with nothing happening. It is safe: stateOf() stamps
         updated_at on every state it sends, and the publisher's heartbeat sends
         one every five seconds whether or not anything happened, precisely so a
         viewer who joined mid-gap has something to correct against. Five seconds
         against a twenty-second cap leaves three heartbeats of room. */
      const since = (Date.now() + offset) - new Date(state.updated_at || state.at || Date.now()).getTime();
      return Math.max(0, base - Math.min(Math.max(0, since), CLOCK_RUN_ON_MS));
    },
    resync,
    stop() {
      if (stopListen) stopListen();
      if (pollTimer) clearInterval(pollTimer);
      if (watchdog) clearInterval(watchdog);
    }
  };
}

return { publisher, subscriber, diffLog, logKey, FRAME_MS, POLL_MS, STALE_MS, CLOCK_RUN_ON_MS, HANDOVER_MS: 3000, VERSION: '1.1.0' };
}));
