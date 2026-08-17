/* ============================================================================
   EPINOIA SYNC — bridges the existing scorer to the live transport.

   the scorer already keeps an append-only event log in exactly the right
   shape, so this is a bridge, not a rewrite. It wraps three globals the scorer
   already calls (addEvent, pauseClock, resumeClock) and publishes:

     * new events, coalesced into ~250 ms frames
     * clock TRANSITIONS only — viewers tick locally between them
     * the roster once, so late joiners can render immediately

   Add to the scorer, after its own script:

     <script src="/epinoia/engine.js"></script>
     <script src="/epinoia/live.js"></script>
     <script src="/epinoia/config.js"></script>
     <script src="/epinoia/score/sync.js"></script>
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

let pub = null, sentIds = [], gameId = null, attached = false, lastPub = '', sb = null,
    lastScorePub = '', scoreConfirmedLive = false, onRevoked = null;

/* Only a real fixture has a row to patch — a scratch/training game has no
   uuid and nothing in the games table, so there is nothing to write. */
const GAME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/* ============================================================================
   THE RUNNING SCORE, MIRRORED ONTO THE FIXTURE ROW.

   game_state carries the score already, and that is what the box score page
   reads — but that is a realtime/broadcast row, not the games table itself.
   Nothing had ever written a live score onto games.home_score/away_score;
   finalise-game sets it once, at the final whistle, and until then every
   OTHER thing that reads a score straight off the games row — the fixture
   strip embedded on a club's site, the platform splash's own live-games
   list, any future API consumer — showed 0-0 for the entire game and only
   caught up once it ended.

   Deduplicated by signature like the roster above, so a tap that is not a
   score (a foul, a sub, a timeout) costs nothing here. Best-effort: this is
   durability for onlookers who are not on the realtime channel, not the
   scorer's own source of truth, so a failed write is logged and dropped
   rather than retried — the next scoring play carries a fresh signature and
   tries again on its own.

   THE UPDATE IS SCOPED TO status='live', and that is deliberate rather than
   incidental. An admin can revert this exact game out from under a
   statistician who is still scoring it — the fixture goes back to
   'scheduled', its score reset to 0-0 — and without the scope, this write
   would cheerfully win the race and put a live-looking score back onto a
   fixture that was just taken off the listing. Scoping the WHERE clause to
   status='live' makes a reverted game simply match no rows instead: nothing
   is overwritten, and a caller who was matching rows a moment ago and now
   is not gets told about it through onRevoked, once, not on every tick. */
function maybeScore(S) {
  if (!sb || !gameId || !GAME_UUID.test(gameId)) return;
  const d = (typeof derive === 'function') ? derive() : null;
  if (!d) return;
  const sig = d.score[0] + '-' + d.score[1];
  if (sig === lastScorePub) return;
  lastScorePub = sig;
  sb.from('games').update({ home_score: d.score[0], away_score: d.score[1] })
    .eq('id', gameId).eq('status', 'live').select('id')
    .then(({ data, error }) => {
      if (error) { console.warn('[sync] score publish refused', error); return; }
      if (data && data.length) { scoreConfirmedLive = true; return; }
      lastScorePub = '';                    // let the next scoring play try again
      /* Only a warning once we have actually seen this game matched as live —
         otherwise the very first basket, scored a beat before claimFixture's
         own status:'live' write has committed, would report a false revert. */
      if (scoreConfirmedLive && typeof onRevoked === 'function') onRevoked();
    });
}

const api = {
  attach(opts) {
    if (attached) return api;
    const S0 = (typeof S !== 'undefined') ? S : null;
    if (!S0) { console.warn('[sync] no scorer state on the page — not attaching'); return api; }
    if (!root.EpinoiaLive) { console.warn('[sync] live.js missing'); return api; }

    gameId = opts.gameId;
    const mode = opts.mode || (root.epinoiaMode ? root.epinoiaMode() : 'local');
    sb = opts.supabase || (root.epinoiaClient ? root.epinoiaClient() : null);
    onRevoked = opts.onRevoked || null;

    pub = root.EpinoiaLive.publisher({
      gameId, mode, supabase: sb,
      stateProvider: () => stateOf(S)      // every frame carries the real clock
    });

    /* --- wrap addEvent: the single funnel every stat passes through --- */
    if (typeof root.addEvent === 'function') {
      const inner = root.addEvent;
      root.addEvent = function (ev) {
        const id = inner.apply(this, arguments);
        try { drain(S); maybeScore(S); } catch (e) { console.warn('[sync]', e); }
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
        maybeScore(S);
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
    maybeScore(S);
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
