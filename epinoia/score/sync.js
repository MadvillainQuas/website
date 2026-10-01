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

/* content keys, one per published event, in order -- see diffLog in live.js */
let pub = null, sentIds = [], gameId = null, attached = false, lastPub = '', sb = null,
    lastScorePub = '', scoreConfirmedLive = false, onRevoked = null;

/* Publishing stops dead when this is set, and never restarts. See halt(). */
let halted = false, haltReason = null;
let onWriteFail = null, onClosed = null, onForeign = null;
let writeFails = 0;

/* WHAT THE LAST WRITE SAID, kept until a later one says otherwise.

   The bar used to be repainted green every three seconds unless more than twelve
   frames were held, so a refusal showed for at most three seconds and a halted
   publisher showed "live" for ever. The state lives here, where the answers
   arrive: a failure stays a failure until a frame actually lands. */
let failing = false, failKind = null, failCode = null, failMsg = null;

/* A refusal is the database answering; a network failure is nobody answering.
   They need different words on the bar — "will retry" is true of one and a lie
   about the other — and only a refusal is worth interrupting a game for.
   PostgREST reports a transport failure as an error with no code and the fetch's
   own message ("TypeError: Failed to fetch", "AbortError" from the deadline in
   config.js, "Load failed" on Safari). */
function isNetworkError(err) {
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return true; } catch (_) {}
  if (!err) return false;
  const code = String(err.code || '');
  if (code && !/^(ECONN|ETIMEDOUT|ENOTFOUND)/.test(code)) return false;   // the database spoke
  const msg = String(err.message || err) + ' ' + String(err.details || '');
  return /failed to fetch|networkerror|network request failed|load failed|abort|timed? ?out|fetch/i.test(msg) ||
         err.name === 'TypeError' || err.name === 'AbortError';
}
const timers = [];      // every interval this module owns, so halt() can end them all

/* Only a real fixture has a row to patch — a scratch/training game has no
   uuid and nothing in the games table, so there is nothing to write. */
const GAME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* NOTHING GOES OUT WHILE THIS GAME IS NOT THE PAGE'S TO PUBLISH, FOR NOW.

   halt() is for good. These two are not: a training game is a state the page can
   leave (a real game started after it is publishable), and a tab that does not
   hold the game (bootstrap.js, the tab lock) is told so by the page. Both used to
   be possible on a real fixture's address and both published — a practice squad
   onto a real fixture, a stale tab's score over the live one.

   ONE TRAINING GAME DOES GO OUT, AS FAR AS THIS BROWSER: a scratch room (no uuid,
   so no row anywhere) on the local transport, which is BroadcastChannel and
   reaches this browser's other tabs and nothing else. That is the ?train=1 demo,
   whose watch tab is how a newcomer sees what a viewer would. Every path here
   that touches the database also needs a uuid, so none of them can run for it. */
const inBrowserOnly = () => mode0 === 'local' && !GAME_UUID.test(gameId || '');
function quiet() {
  if (halted) return true;
  try { if (root.epReadOnly) return true; } catch (_) {}
  try { if (typeof S !== 'undefined' && S && S.training && !inBrowserOnly()) return true; } catch (_) {}
  return false;
}

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
    /* A GAME IS NOT LIVE UNTIL IT HAS TIPPED.

       This said "anything that is not final is live", so a scorer sitting on
       the pre-game screen — squads picked, clock untouched, nobody on court —
       broadcast status 'live' to every watching page. The public box score
       took it at face value and showed a live game with a running clock for a
       fixture that had not started, which is the scheduled-bleeding-into-live
       people kept seeing. The scorer's own phases already carry the answer:
       'pregame' means exactly the state where the game has not begun. */
    status: S.phase === 'final' ? 'final'
          : S.phase === 'pregame' ? 'scheduled'
          : 'live'
  };
}

function stateOf(S) {
  const d = (typeof derive === 'function') ? derive() : null;
  return {
    period: S.period, clock_ms: S.clockMs, running: !!S.running,
    /* THE INTERVAL IS STATE A VIEWER NEEDS TOO. Half-time is fifteen minutes
       of a stream, a ticker and a club's homepage all showing 0:00 in the
       second quarter and no indication that anything is coming back. Sent as
       a plain remainder so every consumer can render it however it likes —
       the scorebug counts it down, a fixture strip can just say "half-time". */
    break_ms: (S.breakMs > 0 && S.period === 2 && S.clockMs === 0) ? S.breakMs : 0,
    break_running: !!S.breakRunning,
    score_home: d ? d.score[0] : 0, score_away: d ? d.score[1] : 0,
    possession: d ? d.poss : null, arrow: d ? d.arrow : null,
    last_seq: S.evSeq || 0,
    updated_at: new Date().toISOString()
  };
}

let snapPass = 0, healing = false;

/* ============================================================================
   ASKING THE LEAGUE HOW MUCH OF THE GAME IT ACTUALLY HAS.

   The ten-second snapshot used to write the whole log to the database as well
   as broadcasting it, which was pure waste six times a minute — and also, by
   accident, the only thing repairing a durable write that had been lost. It is
   not lost often: a refused frame is backlogged and retried in order, and a
   reload republishes from nothing. But "not often" over a season of six games a
   Saturday is a box score that cannot be reproduced, found weeks later by the
   finalise gate refusing to close a game.

   So the repair is kept and the waste is not. Once a minute this asks for a
   COUNT — head:true, so no rows come back and it costs a few hundred bytes —
   and sends the log again only if the server is short. The upsert ignores
   duplicates, so a short server gets exactly the rows it is missing and a
   healthy one gets a single no-op write.

   Deliberately one-directional. A server holding MORE than this device is a
   different situation entirely — another device is scoring this game — and it
   belongs to guardAgainstOverwrite in bootstrap.js, which halts rather than
   heals. This must never be the thing that decides that question.
   ============================================================================ */
async function healDurable(S) {
  if (healing || halted || !pub || !sb || !gameId) return;
  if (quiet()) return;
  const mine = (S.events || []).length;
  if (!mine) return;
  healing = true;
  try {
    const { count, error } = await sb.from('game_events')
      .select('seq', { count: 'exact', head: true }).eq('game_id', gameId);
    if (error || count == null || count >= mine) return;
    console.warn('[sync] durable log short: ' + count + ' of ' + mine + ' — resending');
    pub.pushEvents((S.events || []).map(e => Object.assign({ seq: e.id }, e)), []);
  } catch (_) { /* the next pass asks again */ }
  finally { healing = false; }
}

/* Publish whatever changed since last time — including what was taken back.

   This used to be a high-water mark on the array's LENGTH, which quietly broke
   the moment a statistician pressed undo: the array shrank, the mark stayed
   high, and every event after it was swallowed until the count climbed back
   past the old value. The viewer kept a retracted basket for the rest of the
   game and never saw its replacement. The scorer can also insert an event
   earlier in the log, which a length comparison cannot detect at all.

   EpinoiaLive.diffLog compares identities instead, so append, undo, redo and
   a mid-log edit are all one code path.

   What it remembers between drains is a list of CONTENT keys, not ids: the
   commonest correction of all -- relabelling a foul, fixing which player scored,
   flipping a rebound -- is made by mutating the event in place, so the id and
   the position are both untouched and an id-only comparison found nothing to
   publish. The wrong version then stood on air and in the durable log for the
   rest of the game, while the scorer's own screen corrected itself at once,
   which is exactly what made it invisible from the table. */
function drain(S) {
  if (!pub || quiet()) return;
  const d = root.EpinoiaLive.diffLog(sentIds, S.events || []);
  if (!d.added.length && !d.removed.length) return;
  pub.pushEvents(d.added.map(e => Object.assign({ seq: e.id }, e)), d.removed);
  sentIds = d.ids;
}

/* the roster can change (a sub-in of a player added mid-game), so re-publish
   it only when it actually differs — cheap, and keeps late joiners correct */
function maybeRoster(S) {
  if (!pub || quiet()) return;
  const r = rosterOf(S);
  const sig = JSON.stringify(r);
  if (sig === lastPub) return;
  lastPub = sig;
  pub.pushState(stateOf(S), { game: r });
  announce(r.status);
}

/* ============================================================================
   TELLING THE WHOLE PLATFORM A GAME HAS STARTED.

   A strip on a club's homepage cannot listen to a game it does not yet know
   is being played. It watches the channels of live fixtures and of anything
   near its tip-off, which covers a game that starts when it was meant to — and
   misses one played early, late, or rearranged. A fixture scheduled for next
   Sunday that tips this morning was found only by the fallback poll, so it took
   half a minute to appear as live, and the whole point of the socket is that it
   should not.

   One fixed topic solves it. This is the only message that has to reach a page
   that is not already listening to this game, so it is the only thing on it:
   an id and a status, a few times a game. Every strip anywhere joins it and
   reloads the moment it hears one.

   IT IS NOT AUTHORITATIVE AND DOES NOT NEED TO BE. A listener re-reads the
   fixtures table when it hears this; the announcement only tells it WHEN to
   look. Anything forged on this topic can therefore cause an extra query and
   nothing else — no state on any page comes from it. */
const ANNOUNCE_TOPIC = 'epinoia:live';
let announced = null;
let announceCh = null;

/* WHOSE GAME THIS IS, so that everybody else can ignore it.

   One fixed topic is the right shape — it is the only way to reach a page that
   does not yet know this game exists — but it means every listener on the
   platform hears every announcement. Until now each of them responded by
   re-reading its own fixture list, so ONE game going live made EVERY embedded
   strip on EVERY club website run a query. At sixty games on a Saturday and a
   few hundred embeds that is tens of thousands of queries, almost all of them
   for a game the asker does not show. It is the textbook thundering herd, and
   it gets linearly worse as the platform grows — which is to say it is a
   problem that only appears once the thing is succeeding.

   The cure is to say who it is about. Slugs rather than ids, because slugs are
   what an embed is configured with (?l=demo-league&t=east-dock) and a
   listener that has to resolve an id first would need the query we are trying
   to avoid.

   READ ONCE PER GAME, not per announcement, and never in the path of a tap. */
let scope = null, scopeAsked = false;

async function loadScope() {
  if (scopeAsked || !sb || !GAME_UUID.test(gameId || '')) return;
  scopeAsked = true;
  try {
    const { data } = await sb.from('games')
      .select('home:home_team_id(slug),away:away_team_id(slug),' +
              'competitions(seasons(leagues(slug)))')
      .eq('id', gameId).maybeSingle();
    if (!data) return;
    const lg = ((data.competitions || {}).seasons || {}).leagues || {};
    scope = { league: lg.slug || null,
              home: (data.home || {}).slug || null,
              away: (data.away || {}).slug || null };
  } catch (_) { /* without it every listener falls back to reloading, as before */ }
}

/* ONLY A FIXTURE, ON THE LEAGUE'S TRANSPORT. A scratch room has no row for a
   listener to re-read and no slugs to scope it, so it reached every strip on the
   platform as an unscoped "reload" — the herd above, for a game nobody can see.
   sb is set on a local page too (attach falls back to the page's client), which is
   why the transport is asked as well as the id. */
function announce(status) {
  if (!sb || halted || !gameId || status === announced) return;
  if (mode0 !== 'supabase' || !GAME_UUID.test(gameId)) return;
  announced = status;
  loadScope();                       // fire and forget; the next one carries it
  try {
    announceCh = announceCh || sb.channel(ANNOUNCE_TOPIC);
    announceCh.send({ type: 'broadcast', event: 'status',
                      payload: Object.assign(
                        { gameId: gameId, status: status, at: Date.now() },
                        scope || {}) });
  } catch (_) { /* the poll still covers this; never break scoring for it */ }
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
  if (!sb || !gameId || quiet() || !GAME_UUID.test(gameId)) return;
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

/* ============================================================================
   THE WATCHDOG — noticing that this game was taken away.

   maybeScore above detects a revert, but only as a side effect of a SCORE
   CHANGING: it is deduplicated by score signature, so a game sitting at 0-0
   — which is exactly what a mis-started fixture in live limbo looks like —
   never reaches the write that would notice, and the tab publishes into the
   void indefinitely. The one case the detection existed for was the one case
   it could not see.

   So the status is asked for directly, on a slow beat. One indexed row every
   eight seconds is nothing next to the 2-second publish loop already running
   beside it.

   ONLY AFTER THE GAME HAS BEEN SEEN LIVE. Before tip-off a fixture is legitimately
   'scheduled' — treating that as a revert would halt the scorer before the
   game had started, which is the opposite of the point. So the watchdog arms
   itself the first time it sees 'live' and only then can it fire.

   A DELETED FIXTURE COUNTS TOO. If the row cannot be read at all any more the
   game is gone rather than reverted, and publishing into it is equally
   pointless — but a failed REQUEST is not a deleted row, so only a successful
   read that returns nothing halts anything. A phone that loses signal mid-game
   must never be told its game was cancelled. */
function watchStatus() {
  if (!sb || !gameId || !GAME_UUID.test(gameId)) return;
  let armed = false;
  timers.push(setInterval(() => {
    if (halted) return;
    sb.from('games').select('id,status').eq('id', gameId).maybeSingle()
      .then(({ data, error }) => {
        if (error) return;                 // a blip is not a verdict
        if (data && data.status === 'live') { armed = true; return; }
        /* FINALISING IS "WAIT", NOT "GONE". finalise-game takes the game to
           'finalising' while it rebuilds the box score and only then to 'final'.
           Treated as a revert, a poll that landed in that window — this
           device's own finalise among them — stopped publishing for good and
           told the statistician an administrator had put the game back on the
           listing. If the finalise fails the game returns to live and nothing
           here has stopped; if it succeeds the next poll sees final. */
        if (data && data.status === 'finalising') return;
        /* FINAL OR VOID IS NEVER A PRE-TIP STATE, so it does not wait for the
           watchdog to be armed: a device that comes back from an outage to a game
           the platform has since closed (0203's close_stuck_games, an
           administrator, another device's finalise) must stop at once rather
           than have every write refused one at a time. And it is no longer
           silent. Stopping quietly was right only when THIS device had
           finalised; when it had not, the statistician went on scoring into a
           closed game under a green bar. bootstrap.js decides which it was. */
        if (data && (data.status === 'final' || data.status === 'void')) {
          halt('the league has this game as ' + data.status);
          if (typeof onClosed === 'function') { try { onClosed(data.status); } catch (_) {} }
          return;
        }
        if (!armed) return;                // never been live: still pre-tip
        halt(data ? 'put back on the listing' : 'the fixture is gone');
        if (typeof onRevoked === 'function') onRevoked();
      });
  }, 8000));
}

/* Stop publishing, for good. Called when the game is no longer this tab's to
   write to. Every interval this module owns is cleared and the publisher's own
   heartbeat is stopped, so nothing here touches the database again — the
   statistician's screen keeps working exactly as it did, because the scorer's
   state is local and this only ever mirrored it outward.

   The reason is kept, because the bar has to say WHY nothing is being published:
   "another device is scoring" and "the game is final" ask for different things
   from the person holding the phone. */
function halt(reason) {
  if (halted) return;
  halted = true;
  haltReason = (typeof reason === 'string' && reason) ? reason : 'stopped';
  timers.forEach(t => clearInterval(t));
  timers.length = 0;
  try { if (pub && pub.stop) pub.stop(); } catch (_) {}
  console.warn('[sync] halted (' + haltReason + ') — nothing further is being saved');
}

/* ============================================================================
   MAKING THE LEAGUE'S COPY AGREE WITH THE PHONE, BY CONTENT.

   A fresh attach has always assumed the server's log is a prefix of the phone's:
   sentIds starts empty, the whole log goes out with ignoreDuplicates, and every
   row the server already holds is kept as it is. That is true until a correction
   is lost — an undo, a delete, an edit, queued in the in-memory backlog when the
   tab died. Then the server keeps the undone basket and the scorer before the
   edit, the count says nothing is wrong (an edit does not change a count, an undo
   plus a new play does not either), and finalise publishes the box score the
   statistician corrected an hour ago.

   So on attach, once the takeover guard has decided this device is the one
   scoring, the rows are read back and compared row by row in the canonical shape
   live.js writes them in (durableRow / rowKey). A server row this device does not
   have, or has differently, is retracted; this device's version is sent in its
   place. One frame, through the ordinary ordered publisher, so it cannot overtake
   or be overtaken by a tap.

   A ROW THIS DEVICE NEVER WROTE IS NOT THIS DEVICE'S TO DELETE. Ids come from
   S.evSeq, which only ever counts up and is saved with the game, so a server row
   whose seq is past it was written by something else — another device scoring the
   same fixture. That is the takeover guard's question, not a repair: nothing is
   sent and onForeign is told. (Two devices whose ids overlap cannot be told apart
   by this; that needs the writer lease in docs/outstanding.md #27.)
   ============================================================================ */
let reconciled = false, reconcileArmed = false, reconciling = null;

async function readDurable() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('game_events')
      .select('seq,t,team,pid,period,clock,payload')
      .eq('game_id', gameId).order('seq').range(from, from + 999);
    if (error) throw new Error(error.message || String(error));
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function planReconcile(serverRows, localEvents, evSeq) {
  const L = root.EpinoiaLive;
  const mine = new Map();
  (localEvents || []).forEach(e => {
    const row = L.durableRow(Object.assign({ seq: e.id }, e));
    mine.set(row.seq, { ev: e, key: L.rowKey(row) });
  });
  const theirs = new Map();
  (serverRows || []).forEach(r => theirs.set(+r.seq, L.rowKey(r)));
  const high = Math.max(evSeq || 0, ...[...mine.keys()].map(Number), 0);
  const foreign = [...theirs.keys()].filter(q => q > high);
  const removed = [], added = [];
  theirs.forEach((key, q) => {
    const m = mine.get(q);
    if (q > high) return;                       // never ours to retract
    if (!m || m.key !== key) removed.push(q);
  });
  mine.forEach((m, q) => {
    if (theirs.get(q) !== m.key) added.push(Object.assign({ seq: m.ev.id }, m.ev));
  });
  return { removed, added, foreign };
}

/* force: run even before the guard has armed it (finalise and reopen ask for a
   repair directly). wait: resolve only once the repair frame has been delivered
   — or refused — so a caller can compare digests straight afterwards. */
function reconcile(opts) {
  const o = opts || {};
  if (reconciling) return reconciling;
  if (!pub || !sb || !gameId || !GAME_UUID.test(gameId)) return Promise.resolve({ ok: false, why: 'not publishing' });
  if (quiet()) return Promise.resolve({ ok: false, why: 'not publishing' });
  if (!o.force && !reconcileArmed) return Promise.resolve({ ok: false, why: 'not armed' });
  reconciling = (async () => {
    try {
      const S0 = (typeof S !== 'undefined') ? S : null;
      if (!S0) return { ok: false, why: 'no game' };
      const rows = await readDurable();
      const plan = planReconcile(rows, S0.events || [], S0.evSeq);
      if (plan.foreign.length) {
        if (typeof onForeign === 'function') {
          try { onForeign(rows.length, (S0.events || []).length, plan.foreign.length); } catch (_) {}
        }
        return { ok: false, why: 'foreign', foreign: plan.foreign.length };
      }
      if (plan.removed.length || plan.added.length) {
        console.warn('[sync] the league copy differs: retracting ' + plan.removed.length +
                     ', sending ' + plan.added.length);
        pub.pushEvents(plan.added, plan.removed);
      }
      if (o.wait) await pub.flushNow();
      reconciled = true;
      return { ok: true, removed: plan.removed.length, added: plan.added.length };
    } catch (e) {
      return { ok: false, why: String((e && e.message) || e) };
    } finally {
      reconciling = null;
    }
  })();
  return reconciling;
}

/* The loops attach() starts, and restart() starts again after a reopen. */
function startLoops() {
  /* --- a clock adjustment or an edit does not go through addEvent, so poll
         cheaply for divergence; this is a safety net, not the main path --- */
  timers.push(setInterval(() => {
    if (quiet()) return;
    try {
      drain(S);
      maybeRoster(S);
      maybeScore(S);
    } catch (e) { /* never let sync break scoring */ }
  }, 2000));

  /* A full snapshot on a slow beat, so anyone watching has the whole game
     whether or not they were watching when it happened — and whether or not
     anything is being written to the database. This is the public viewer's
     guarantee: no credentials, no table read, no luck about when they
     opened the page. Ten seconds is chosen to be cheap: an 800-event game
     is ~80 KB, and the delta frames in between keep the page live to the
     quarter-second regardless. */
  timers.push(setInterval(() => {
    if (quiet()) return;
    try {
      if (!S || !S.events || !S.events.length) return;
      pub.pushSnapshot(S.events.map(e => Object.assign({ seq: e.id }, e)),
                       stateOf(S), rosterOf(S));
      /* Once a minute, not every pass: see healDurable. A reconcile that could
         not read the log (no signal at attach) is tried again on the same beat. */
      if ((++snapPass % 6) === 0) healDurable(S);
      if (snapPass % 6 === 0 && reconcileArmed && !reconciled) reconcile();
    } catch (e) { /* never let sync break scoring */ }
  }, 10000));

  watchStatus();
}

function makePublisher(mode) {
  return root.EpinoiaLive.publisher({
    gameId, mode, supabase: sb,
    stateProvider: () => stateOf(S),     // every frame carries the real clock
    paused: quiet,
    /* THE DURABLE LOG FAILING IS NOT A DETAIL TO LOG AND MOVE ON FROM.

       A refused write used to be invisible: the broadcast still went out, so
       the public box score looked perfect and kept updating, while the table
       behind it took nothing. A full game was scored that way and the loss
       was only discovered at the final whistle, when finalise refused to
       close a game the server could not reproduce — by which point the only
       copy of the game was in one browser tab.

       So the scorer is told the first time it happens, and told again if it
       is still failing a while later. The frame itself is retried from the
       backlog regardless; this is about the statistician knowing. */
    onError: (err) => {
      writeFails++;
      failing = true;
      failKind = isNetworkError(err) ? 'network' : 'refused';
      failCode = (err && err.code) || null;
      failMsg = String((err && (err.message || err)) || '');
      if (typeof onWriteFail === 'function') {
        try { onWriteFail(err, writeFails, failKind); } catch (_) {}
      }
    },
    /* ...and told when it is over. The count starts again, so five blips spread
       over a game are not the "keeps failing" that interrupts somebody. */
    onDelivered: () => {
      writeFails = 0;
      failing = false; failKind = null; failCode = null; failMsg = null;
    }
  });
}

let mode0 = 'local';

const api = {
  attach(opts) {
    if (attached) return api;
    /* halt() can be called BEFORE anything attaches — the fixture gate in
       bootstrap.js halts the moment it refuses, which is well before the
       attach timer notices a game. Without this, a refused session that then
       restored a saved game from localStorage would sail past the halt and
       start publishing a fabricated score to a real fixture's public page.
       Halted means halted, whenever it was asked for. */
    if (halted) { console.warn('[sync] halted — not attaching'); return api; }
    const S0 = (typeof S !== 'undefined') ? S : null;
    if (!S0) { console.warn('[sync] no scorer state on the page — not attaching'); return api; }
    if (!root.EpinoiaLive) { console.warn('[sync] live.js missing'); return api; }

    gameId = opts.gameId;
    const mode = opts.mode || (root.epinoiaMode ? root.epinoiaMode() : 'local');
    mode0 = mode;
    sb = opts.supabase || (root.epinoiaClient ? root.epinoiaClient() : null);
    onRevoked = opts.onRevoked || null;
    onClosed = opts.onClosed || null;
    onForeign = opts.onForeign || null;

    onWriteFail = opts.onWriteFail || null;

    pub = makePublisher(mode);

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
        if (quiet()) return r;
        try { pub.pushState(stateOf(S)); } catch (e) { console.warn('[sync]', e); }
        return r;
      };
    });

    startLoops();

    maybeRoster(S);
    drain(S);
    maybeScore(S);
    attached = true;
    console.log('[sync] attached to game', gameId, 'via', pub.transport);
    return api;
  },

  /* flush before the tab closes so nothing is stranded in the 250 ms buffer.
     A halted tab has nothing legitimate left to flush — the game is not this
     tab's any more, and pagehide firing a last write into it is exactly the
     resurrection halt() exists to prevent. */
  flush() { if (pub && !quiet()) pub.flushNow(); },

  /* Everything queued, sent, and the answer awaited — or the time is up. True
     when nothing is left held, which is what finalise needs to know before it
     compares its digest with the league's. */
  async settle(ms) {
    if (!pub || quiet()) return false;
    const done = pub.flushNow();
    await Promise.race([done, new Promise(r => setTimeout(r, ms || 8000))]);
    return pub.pending() === 0;
  },

  /* mark the game final and push a last frame */
  finalise() {
    if (!pub || quiet()) return;
    try {
      lastPub = '';                          // force a roster republish with status:final
      maybeRoster(S);
      pub.flushNow();
    } catch (e) { console.warn('[sync]', e); }
  },

  reconcile,
  /* The takeover guard has decided this device is the one scoring the game, so a
     repair may now retract rows from the league's copy. */
  armReconcile() { reconcileArmed = true; return reconcile(); },

  /* What finalise-game must find, in the shape it computes it: the count and the
     digest of the log as this device holds it. */
  expectation() {
    const L = root.EpinoiaLive;
    const evs = (typeof S !== 'undefined' && S && S.events) || [];
    const d = L.logDigest(evs.map(e => L.durableRow(Object.assign({ seq: e.id }, e))));
    const dv = (typeof derive === 'function') ? (function () { try { return derive(); } catch (_) { return null; } }()) : null;
    return { events: d.events, digest: d.digest, score: dv ? dv.score.slice() : null };
  },

  /* PUBLISHING AGAIN, AFTER A REOPEN.

     halt() is deliberately one-way within a game's life: nothing that stopped
     publishing can be argued back into it by the network. A reopen is the one
     exception, and it is an explicit act by somebody allowed to make it — the
     league has turned a final game back into a live one. So a fresh publisher,
     fresh loops, sentIds from nothing (the reconcile below brings the league's
     copy into line rather than trusting it), and the watchdog armed again from
     scratch. Not used for anything else. */
  restart() {
    if (!attached) return false;
    timers.forEach(t => clearInterval(t));
    timers.length = 0;
    try { if (pub && pub.stop) pub.stop(); } catch (_) {}
    halted = false; haltReason = null;
    sentIds = []; lastPub = ''; lastScorePub = ''; scoreConfirmedLive = false;
    announced = null; reconciled = false; reconcileArmed = true;
    writeFails = 0; failing = false; failKind = null; failCode = null; failMsg = null;
    pub = makePublisher(mode0);
    startLoops();
    maybeRoster(S);
    drain(S);
    maybeScore(S);
    reconcile();
    console.log('[sync] publishing again to game', gameId);
    return true;
  },

  /* the scorer's own escape hatch, and what the watchdog calls */
  halt,
  get halted() { return halted; },

  status() { return { gameId, sent: sentIds.length, halted, haltReason, attached,
                      quiet: quiet(),
                      failing, failKind, failCode, failMsg, writeFails,
                      reconciled,
                      pending: pub ? pub.pending() : 0, transport: pub && pub.transport }; }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => api.flush());
  window.addEventListener('beforeunload', () => api.flush());
}

/* For the tests: the comparison itself, with no network in front of it. */
api._planReconcile = planReconcile;
api._isNetworkError = isNetworkError;

return api;
}));
