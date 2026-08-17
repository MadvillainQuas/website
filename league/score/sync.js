/* ============================================================================
   EPINOIA SYNC — bridges the existing scorer to the live transport.

   the scorer already keeps an append-only event log in exactly the right
   shape, so this is a bridge, not a rewrite. It wraps three globals the scorer
   already calls (addEvent, pauseClock, resumeClock) and publishes:

     * new events, coalesced into ~250 ms frames
     * clock TRANSITIONS only — viewers tick locally between them
     * the roster once, so late joiners can render immediately

   Add to the scorer, after its own script:

     <script src="/league/engine.js"></script>
     <script src="/league/live.js"></script>
     <script src="/league/config.js"></script>
     <script src="/league/score/sync.js"></script>
     <script>EpinoiaSync.attach({ gameId: 'abc-123' });</script>

   Nothing here can slow a tap down: every publish is fire-and-forget, and the
   scorer stays fully usable with the network gone.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
'use strict';

let pub = null, sentIds = [], gameId = null, attached = false, lastPub = '';

/* the scorer's own state object, published so viewers can name players */
function rosterOf(S) {
  return {
    teams: S.teams.map(t => ({
      name: t.name, color: t.color,
      players: t.players.map(p => ({ id: p.id, name: p.name, num: p.num }))
    })),
    starters: S.starters,
    tipWinner: S.tipWinner, arrowInit: S.arrowInit,
    period: S.period, clockMs: S.clockMs,
    status: S.phase === 'final' ? 'final' : 'live'
  };
}

function stateOf(S) {
  const d = (typeof derive === 'function') ? derive() : null;
  return {
    period: S.period, clock_ms: S.clockMs, running: !!S.running,
    score_home: d ? d.score[0] : 0, score_away: d ? d.score[1] : 0,
    possession: d ? d.poss : null, arrow: d ? d.arrow : null,
    last_seq: S.evSeq || 0,
    updated_at: new Date().toISOString()
  };
}

/* Publish whatever changed since last time — including what was taken back.

   This used to be a high-water mark on the array's LENGTH, which quietly broke
   the moment a statistician pressed undo: the array shrank, the mark stayed
   high, and every event after it was swallowed until the count climbed back
   past the old value. The viewer kept a retracted basket for the rest of the
   game and never saw its replacement. The scorer can also insert an event
   earlier in the log, which a length comparison cannot detect at all.

   EpinoiaLive.diffLog compares identities instead, so append, undo, redo and
   a mid-log edit are all one code path. */
function drain(S) {
  if (!pub) return;
  const d = root.EpinoiaLive.diffLog(sentIds, S.events || []);
  if (!d.added.length && !d.removed.length) return;
  pub.pushEvents(d.added.map(e => Object.assign({ seq: e.id }, e)), d.removed);
  sentIds = d.ids;
}

/* the roster can change (a sub-in of a player added mid-game), so re-publish
   it only when it actually differs — cheap, and keeps late joiners correct */
function maybeRoster(S) {
  const r = rosterOf(S);
  const sig = JSON.stringify(r);
  if (sig === lastPub) return;
  lastPub = sig;
  pub.pushState(stateOf(S), { game: r });
}

const api = {
  attach(opts) {
    if (attached) return api;
    const S0 = (typeof S !== 'undefined') ? S : null;
    if (!S0) { console.warn('[sync] no scorer state on the page — not attaching'); return api; }
    if (!root.EpinoiaLive) { console.warn('[sync] live.js missing'); return api; }

    gameId = opts.gameId;
    const mode = opts.mode || (root.epinoiaMode ? root.epinoiaMode() : 'local');
    const sb = opts.supabase || (root.epinoiaClient ? root.epinoiaClient() : null);

    pub = root.EpinoiaLive.publisher({
      gameId, mode, supabase: sb,
      stateProvider: () => stateOf(S)      // every frame carries the real clock
    });

    /* --- wrap addEvent: the single funnel every stat passes through --- */
    if (typeof root.addEvent === 'function') {
      const inner = root.addEvent;
      root.addEvent = function (ev) {
        const id = inner.apply(this, arguments);
        try { drain(S); } catch (e) { console.warn('[sync]', e); }
        return id;
      };
    }

    /* --- wrap the clock controls: transitions are the only clock traffic --- */
    ['pauseClock', 'resumeClock'].forEach(fn => {
      if (typeof root[fn] !== 'function') return;
      const inner = root[fn];
      root[fn] = function () {
        const r = inner.apply(this, arguments);
        try { pub.pushState(stateOf(S)); } catch (e) { console.warn('[sync]', e); }
        return r;
      };
    });

    /* --- a clock adjustment or an edit does not go through addEvent, so poll
           cheaply for divergence; this is a safety net, not the main path --- */
    setInterval(() => {
      try {
        drain(S);
        maybeRoster(S);
      } catch (e) { /* never let sync break scoring */ }
    }, 2000);

    /* A full snapshot on a slow beat, so anyone watching has the whole game
       whether or not they were watching when it happened — and whether or not
       anything is being written to the database. This is the public viewer's
       guarantee: no credentials, no table read, no luck about when they
       opened the page. Ten seconds is chosen to be cheap: an 800-event game
       is ~80 KB, and the delta frames in between keep the page live to the
       quarter-second regardless. */
    setInterval(() => {
      try {
        if (!S || !S.events || !S.events.length) return;
        pub.pushSnapshot(S.events.map(e => Object.assign({ seq: e.id }, e)),
                         stateOf(S), rosterOf(S));
      } catch (e) { /* never let sync break scoring */ }
    }, 10000);

    maybeRoster(S);
    drain(S);
    attached = true;
    console.log('[sync] attached to game', gameId, 'via', pub.transport);
    return api;
  },

  /* flush before the tab closes so nothing is stranded in the 250 ms buffer */
  flush() { if (pub) pub.flushNow(); },

  /* mark the game final and push a last frame */
  finalise() {
    if (!pub) return;
    try {
      lastPub = '';                          // force a roster republish with status:final
      maybeRoster(S);
      pub.flushNow();
    } catch (e) { console.warn('[sync]', e); }
  },

  status() { return { gameId, sent: sentIds.length,
                      pending: pub ? pub.pending() : 0, transport: pub && pub.transport }; }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => api.flush());
  window.addEventListener('beforeunload', () => api.flush());
}

return api;
}));
