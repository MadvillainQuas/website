'use strict';
/* ============================================================================
   Wires the scorer to the live transport and shows where to watch it.

   The scorer builds its state lazily — S is null until a game is actually set
   up — so this waits for a game rather than attaching on load, and attaches
   exactly once.

   Game id comes from ?g=. With none supplied it invents one and forces local
   mode: BroadcastChannel needs no database row, so the whole publish/subscribe
   loop is testable in two tabs with nothing configured. A real fixture is
   scored by opening this page with the game's uuid, which is what the portal's
   "score this game" link does.
   ============================================================================ */
(function () {
  const qp = new URLSearchParams(location.search);
  const ROOM_KEY = 'epinoia.scratchGame';

  let gameId = qp.get('g');
  let mode = qp.get('mode');

  /* ------------------------------------------------------------ training ---
     ?train=1 is the door from the splash for somebody who has never seen the
     app. No account, no fixture, nothing written anywhere — a scratch room in
     local mode with two invented squads already on the sheet, so the first
     thing they see is the scoring screen rather than a form.

     It is driven through the SETUP UI rather than by reaching into the
     scorer's state: filling the same inputs a person would fill and pressing
     the same button means training cannot drift away from the real thing, and
     there is no second code path to keep working. */
  const TRAINING = qp.get('train') === '1';
  if (TRAINING) mode = 'local';


  if (!gameId) {
    // a scratch room, stable across reloads so the viewer tab keeps working
    gameId = sessionStorage.getItem(ROOM_KEY);
    if (!gameId) {
      gameId = 'scratch-' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8)
                                               : Math.floor(Math.random() * 1e9).toString(36));
      sessionStorage.setItem(ROOM_KEY, gameId);
    }
    mode = 'local';   // no row exists for a scratch id, so never try Supabase
  }
  mode = mode || (window.epinoiaMode ? window.epinoiaMode() : 'local');

  // the distinctive tail, not the prefix — "scratch-" identifies nothing
  const shortId = gameId.replace(/^scratch-/, '').slice(0, 8);

  /* A real fixture has a uuid; a scratch room does not, and there is nothing
     on the server to claim, cancel or finalise for one.

     DECLARED HERE, AT THE TOP, rather than beside the finalise code that used
     to own it. Everything in this file that talks to the database is gated on
     it, including the escape hatch's cancel button — and that hatch is an
     immediately-invoked function that runs long before the old declaration
     was reached, so reading it there was a temporal-dead-zone ReferenceError
     that would have taken the whole bar down with it. A const used by code
     that runs on load belongs above that code. */
  const isFixture = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId);

  const viewerUrl = new URL('../game/', location.href);
  viewerUrl.searchParams.set('g', gameId);
  viewerUrl.searchParams.set('mode', mode);

  /* ---------------------------------------------------------------- badge --- */
  /* Deliberately unobtrusive and out of the way of every control: the scorer's
     buttons reach the screen edges on mobile, and a mis-tap here costs a stat. */
  const bar = document.createElement('div');
  bar.id = 'ep-livebar';
  bar.style.cssText = [
    'position:fixed', 'left:6px', 'bottom:6px', 'z-index:2147483000',
    'display:flex', 'align-items:center', 'gap:7px',
    'padding:5px 8px', 'border-radius:7px',
    'background:rgba(4,16,11,.86)', 'border:1px solid rgba(147,242,191,.30)',
    'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
    'font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:.06em', 'text-transform:uppercase',
    'color:#e6fff1', 'user-select:none', 'max-width:min(92vw,320px)'
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#ffd166;flex:none';
  const label = document.createElement('span');
  label.textContent = 'connecting';
  label.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  const watch = document.createElement('a');
  watch.href = viewerUrl.href;
  watch.target = '_blank';
  watch.rel = 'noopener';
  watch.textContent = 'watch ↗';
  watch.style.cssText = 'color:#8ff5ff;text-decoration:none;white-space:nowrap;flex:none';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'copy';
  copy.style.cssText = 'all:unset;cursor:pointer;color:#93f2bf;white-space:nowrap;flex:none';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(viewerUrl.href); copy.textContent = 'copied'; }
    catch (_) { copy.textContent = 'copy failed'; }
    setTimeout(() => { copy.textContent = 'copy'; }, 1600);
  });

  const hide = document.createElement('button');
  hide.type = 'button';
  hide.textContent = '×';
  hide.title = 'hide';
  hide.style.cssText = 'all:unset;cursor:pointer;color:rgba(230,255,241,.5);padding:0 2px;flex:none';
  hide.addEventListener('click', () => bar.remove());

  bar.append(dot, label, watch, copy, hide);
  const mount = () => document.body.appendChild(bar);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function say(text, colour) { label.textContent = text; dot.style.background = colour; }

  /* ------------------------------------------------------- publishing state --- */
  /* Watching is public and always works: Realtime accepts an anonymous
     subscriber, and the scorer broadcasts a full snapshot every ten seconds,
     so anyone can open the page at any point and have the whole game without
     credentials. Nothing here gates that.

     What signing out does cost is DURABILITY. Every write to game_events is
     refused by RLS, so the game is live to whoever is watching and gone the
     moment they refresh — no log to rebuild from, nothing to finalise, no
     season statistics. That is worth saying plainly rather than leaving to be
     discovered at half-time, so it is checked on load and the badge stays
     amber until it is fixed. */
  let authOk = null;

  /* Set once the fixture gate has refused. Everything that would otherwise
     keep talking about publishing has to stop, or the badge cheerfully
     contradicts the notice covering the screen. */
  let refused = false;

  async function checkPublishing() {
    if (!isFixture || refused) return false;
    const sb = window.epinoiaClient && epinoiaClient();
    if (!sb) { authOk = false; return false; }
    const { data: { session } } = await sb.auth.getSession();
    authOk = !!session;
    if (!authOk) {
      say('live to viewers · NOT being saved', '#ffd166');
      bar.style.borderColor = 'rgba(255,209,102,.7)';
      bar.style.background = 'rgba(40,30,6,.94)';
      /* a link straight to the fix, since the statistician is mid-setup */
      if (!document.getElementById('ep-signin')) {
        const a = document.createElement('a');
        a.id = 'ep-signin';
        a.href = '../app/'; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'sign in ↗';
        a.style.cssText = 'color:#ffd166;text-decoration:underline;white-space:nowrap;flex:none';
        bar.insertBefore(a, watch);
      }
    }
    return authOk;
  }
  setTimeout(checkPublishing, 1200);

  /* ------------------------------------------------------------- tip-off --- */
  /* Nothing was ever written when a game started. The fixture stayed
     'scheduled' with a null roster_snapshot, so a viewer opening the public
     page got a game row with no squads and no log — the clock ticked locally
     against a stale state row and nothing else ever appeared. That is the
     "live games don't feed the public side" fault.

     At tip the scorer now claims the fixture: status live, the squads frozen
     as they were at tip, and the starting five. The snapshot is what lets the
     public page name a player, and freezing it means a roster edited later
     never rewrites a game that has already been played.

     This needs a signed-in statistician, because writing to someone's fixture
     should. If the write is refused the badge says so out loud rather than
     letting a whole game be scored into a void. */
  let claimed = false;

  async function claimFixture() {
    if (claimed || !isFixture) return;
    if (typeof S === 'undefined' || !S || S.phase !== 'game') return;
    claimed = true;                                   // one attempt per load

    if (!(await checkPublishing())) { claimed = false; return; }
    const sb = epinoiaClient();

    const snapshot = {
      teams: S.teams.map(t => ({
        name: t.name, color: t.color,
        players: t.players.map(p => ({ id: p.id, name: p.name, num: p.num }))
      }))
    };
    const patch = {
      status: 'live',
      roster_snapshot: snapshot,
      starters: S.starters,
      period: S.period
    };
    if (S.tipWinner != null) patch.tip_winner = S.tipWinner;
    if (S.arrowInit != null) patch.arrow_init = S.arrowInit;

    const { error } = await sb.from('games').update(patch).eq('id', gameId);
    if (error) {
      say('cannot publish: ' + (error.message || 'refused'), '#ff5f6b');
      console.warn('[tip-off]', error);
      claimed = false;                                // let a retry happen
      return;
    }
    say('live · ' + shortId, '#93f2bf');
  }

  /* ------------------------------------------------------ priming, pre-tip ---
     THE FIVES EXIST TWENTY MINUTES BEFORE THEY ARE PUBLISHED, AND THAT IS THE
     WHOLE PROBLEM.

     claimFixture only runs at tip — deliberately, because that is when a game
     becomes live. But the broadcast graphics that matter most are the ones
     shown BEFORE tip: the squads, the starting fives, the officials. Until now
     none of that reached the database until the ball was thrown, so a stream
     opening twenty minutes early had nothing to put on air except a fixture
     card, and the "starting fives" graphic honestly showed squads because the
     fives genuinely were not knowable yet.

     So the scorer now publishes the squad and the five as soon as the
     statistician has picked them — status untouched, still 'scheduled',
     because nothing has started. It is the same write, minus the one field
     that means "this game is under way".

     WHY status IS LEFT ALONE. Everything downstream gates on it: the strip
     decides what is live, the public page decides whether to subscribe,
     finalise decides what may be finalised. Writing a roster is a statement
     about who is available; writing 'live' is a statement about the ball. */
  let primed = false;

  async function primeFixture() {
    if (primed || claimed || !isFixture) return;
    if (typeof S === 'undefined' || !S || S.phase !== 'pregame') return;
    if (!S.starters || !S.starters[0] || !S.starters[0].length) return;
    primed = true;

    if (!(await checkPublishing())) { primed = false; return; }
    const sb = epinoiaClient();

    const snapshot = {
      teams: S.teams.map(t => ({
        name: t.name, color: t.color,
        players: t.players.map(p => ({ id: p.id, name: p.name, num: p.num }))
      }))
    };
    const { error } = await sb.from('games').update({
      roster_snapshot: snapshot,
      starters: S.starters
    }).eq('id', gameId);

    if (error) {
      /* Quiet, unlike the tip-off failure. Nothing is lost if this does not
         land — the same write happens again at tip — so an alarming badge
         before a game has started would be noise about a graphic. */
      console.warn('[prime]', error);
      primed = false;
      return;
    }
    say('primed · ' + shortId, '#8ff5ff');
  }

  /* The pregame card is the screen that exists between picking the fives and
     throwing the ball, so its appearance is the signal. Polled rather than
     hooked, because the scorer reaches that state by several routes and a
     missed hook would silently un-prime a broadcast. */
  setInterval(() => {
    try { primeFixture(); } catch (e) { console.warn('[prime]', e); }
  }, 2500);

  /* --------------------------------------------------------- the video ---
     THE BRIDGE BETWEEN THE SCORER AND THE FOOTAGE.

     Two instants line a video up with a game: when the stream started, and
     when the ball went up. Both are known by machines that are already on this
     platform at the moment they happen — the control room presses "go live",
     the scorer presses resume — so neither should ever have to be typed. This
     is the wire between the scorer's half of that and the database.

     Fire-and-forget, in the same spirit as everything else here: an attached
     video is a convenience, and nothing about recording a basket may ever wait
     on it or fail because of it. A refused write is a warning in the console
     and a screen the statistician can retry from, not an alarm mid-game. */
  /* THE ONE WRITE HERE THAT CANNOT SIMPLY BE DROPPED.

     Everything else this file sends is a convenience that the next tap will
     send again. Tip-off is not: it happens once, it is the anchor for every
     clip in the game, and it happens at the exact moment forty phones join one
     access point in a sports hall. Fire-and-forget meant one refused request
     and the game had no anchor at all, with nothing on any screen to say so.

     So the patch is held and retried until it lands. Two details make that
     safe rather than merely persistent:

       * PATCHES MERGE. A tip, then a URL, then a trim, all queued behind one
         outage, arrive as ONE call — and set_game_video treats null as
         leave-alone, so a merge cannot clear a field somebody else set.

       * TIMES ARE RE-DERIVED AT EACH ATTEMPT. __tipFrom and __streamFrom hold
         a device timestamp and are converted to "this many milliseconds ago"
         at the moment of sending. A retry four minutes later therefore still
         anchors to the moment the ball went up, not to the moment the wifi
         came back. Sending an absolute "now" instead — which is what this did
         — would have made the retry worse than the failure. */
  let pending = null, retryTimer = null, retryIn = 4000, videoSaidSo = false;

  function elapsedFrom(patch) {
    const out = Object.assign({}, patch);
    if (out.__tipFrom != null) {
      out.p_tip_ms_ago = Math.max(0, Date.now() - out.__tipFrom);
      delete out.__tipFrom;
    }
    if (out.__streamFrom != null) {
      out.p_stream_ms_ago = Math.max(0, Date.now() - out.__streamFrom);
      delete out.__streamFrom;
    }
    return out;
  }

  window.EpinoiaGameVideo = {
    gameId: () => gameId,
    isFixture: () => isFixture,
    pending: () => pending,

    async push(patch) {
      /* Two different refusals, said as two different things. Both used to
         report "not a fixture", which is misleading for the second and cost a
         session's debugging: a game the gate has already refused is a game
         with a row, and being told otherwise sends you looking at the id. */
      if (!isFixture) return { ok: false, why: 'not a fixture' };
      if (refused) return { ok: false, why: 'this game is not open for scoring' };
      pending = Object.assign(pending || {}, patch);
      return window.EpinoiaGameVideo.flush();
    },

    async flush() {
      if (!pending) return { ok: true };
      const sb = window.epinoiaClient && epinoiaClient();
      if (!sb) return schedule('offline');
      let session = null;
      try { session = (await sb.auth.getSession()).data.session; } catch (_) {}
      if (!session) return schedule('not signed in');

      const sending = pending;
      const { data, error } = await sb.rpc('set_game_video',
        Object.assign({ p_game: gameId }, elapsedFrom(sending)));
      if (error) { console.warn('[video]', error); return schedule(error.message); }

      /* Only clear what was actually sent. Anything added while the request
         was in flight stays queued rather than being thrown away with it. */
      if (pending === sending) pending = null;
      else Object.keys(sending).forEach(k => { delete pending[k]; });
      if (pending && !Object.keys(pending).length) pending = null;
      retryIn = 4000;
      clearTimeout(retryTimer); retryTimer = null;
      if (videoSaidSo) { say('live · ' + shortId, '#93f2bf'); videoSaidSo = false; }
      return { ok: true, row: Array.isArray(data) ? data[0] : data };
    },

    /* What is already attached — a second statistician taking over at
       half-time, or the same one after a reload, must not have to line the
       video up again. */
    async load() {
      if (!isFixture) return null;
      const sb = window.epinoiaClient && epinoiaClient();
      if (!sb) return null;
      const { data, error } = await sb.from('game_videos')
        .select('url,provider,video_ref,stream_started_at,tip_at,tip_wall,tip_offset_ms,trim_ms,is_live')
        .eq('game_id', gameId).eq('is_primary', true).limit(1);
      /* Before 0082 is applied this table does not exist, and that is not
         worth a word to anybody scoring a game. */
      if (error || !data || !data.length) return null;
      return data[0];
    }
  };

  /* Backoff to half a minute and stay there. A sports hall's wifi comes back
     within a quarter or it does not come back, and a tighter loop would just
     be more requests into the same dead air. */
  function schedule(why) {
    if (!pending) return { ok: true };
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { window.EpinoiaGameVideo.flush(); }, retryIn);
    retryIn = Math.min(30000, Math.round(retryIn * 1.6));
    /* SAID OUT LOUD, once, because a silent anchor failure is invisible until
       somebody opens the footage a week later and every clip is wrong. */
    if (!videoSaidSo && pending && (pending.__tipFrom != null || pending.p_tip_wall != null)) {
      videoSaidSo = true;
      say('video sync not saved — retrying', '#ffd166');
    }
    return { ok: false, why: why, retrying: true };
  }

  /* Fold what the database already knows into the scorer's own state, once,
     as soon as there is a state to fold it into. Local values win only where
     the database has nothing — the row is the shared truth between the person
     in the hall and the person in the control room, and a stale tab must not
     quietly overwrite what the other one set. */
  (function adoptVideo() {
    let done = false;
    const timer = setInterval(async () => {
      if (done || typeof S === 'undefined' || !S) return;
      done = true;
      clearInterval(timer);
      try {
        const row = await window.EpinoiaGameVideo.load();
        if (!row) return;
        S.video = S.video || {};
        S.video.url = row.url || S.video.url || '';
        S.video.provider = row.provider || S.video.provider || '';
        S.video.ref = row.video_ref || S.video.ref || '';
        S.video.streamStartedAt = row.stream_started_at || S.video.streamStartedAt || null;
        S.video.tipAt = row.tip_at || S.video.tipAt || null;
        S.video.tipWall = row.tip_wall != null ? +row.tip_wall : (S.video.tipWall || null);
        S.video.tipOffsetMs = row.tip_offset_ms != null ? +row.tip_offset_ms
                                                        : (S.video.tipOffsetMs || null);
        S.video.trimMs = row.trim_ms != null ? row.trim_ms : (S.video.trimMs || 0);
        if (typeof window.save === 'function') window.save();

        /* RECONCILE, DO NOT JUST ADOPT. A scorer that tipped off while the
           wifi was down, and was then reloaded, holds the only copy of the
           anchor there is: the retry queue lives in memory and did not survive
           the reload. If this device knows when the ball went up and the row
           does not, it says so — which is the difference between a video that
           lines up and one that never can. */
        if (S.video.tipWall && !row.tip_wall) {
          window.EpinoiaGameVideo.push({
            __tipFrom: S.video.tipWall, p_tip_wall: S.video.tipWall
          });
        }
      } catch (e) { console.warn('[video] adopt', e); }
    }, 1500);
    /* Give up after a minute rather than polling for the rest of a game. */
    setTimeout(() => clearInterval(timer), 60000);
  }());

  /* ------------------------------------------------ somebody else is scoring ---
     THE SCORER NEVER READ BACK A LOG, AND A SECOND DEVICE IS NOT RARE.

     loadFixture fetches the squads and nothing else, so a phone opening a game
     that is already being scored starts with an empty log and seq 1. What then
     happens is worse than it sounds, and none of it is visible from the phone:

       * Its events collide with the real ones. The durable write is an upsert
         on (game_id, seq) with ignoreDuplicates, so the EXISTING rows win and
         everything the second device records is silently discarded. It looks
         like it is scoring. It is not.
       * Its score is published over the fixture. maybeScore writes
         home_score/away_score from its own derive, which is 0-0 — so the club
         homepage, the ticker and the strip all snap back to nil-nil while a
         game is being played.
       * Both devices broadcast on the same channel, so every viewer sees the
         score flip between the two.

     This is not an exotic case. It is the same statistician in a private
     window, a phone whose storage was cleared, a colleague taking over at
     half-time, or a spare tablet opened "just to check". At one device per
     game it never happens; at a league running six games a Saturday it is a
     matter of weeks.

     So the log is counted before anything is published. If the server holds
     more than this device does, publishing STOPS and the operator is offered
     the recorded game — which is the thing they actually wanted. */
  let guarded = false;

  async function guardAgainstOverwrite() {
    if (guarded || !isFixture || refused) return;
    if (typeof S === 'undefined' || !S || S.phase === 'setup') return;
    guarded = true;

    const sb = window.epinoiaClient && epinoiaClient();
    if (!sb) return;
    let count = 0;
    try {
      const res = await sb.from('game_events')
        .select('seq', { count: 'exact', head: true }).eq('game_id', gameId);
      if (res.error) return;                 // cannot tell: say nothing
      count = res.count || 0;
    } catch (_) { return; }

    const mine = (S.events || []).length;
    if (count <= mine) return;               // nothing recorded that we lack

    /* Stop first, ask second. Every moment this keeps publishing is a moment
       the live score on somebody's homepage is wrong. */
    try { window.EpinoiaSync && window.EpinoiaSync.halt(); } catch (_) {}
    say('not publishing — another device is scoring', '#ffd166');
    offerTakeover(count, mine);
  }

  /* Pull the recorded game onto this device.

     The log is the game — the same premise the public box score is built on —
     so this is the box score's own load, applied to the scorer's state. The
     squads are NOT rebuilt: roster_snapshot is frozen at tip and is already
     what loadFixture used, so the player ids in the log match the ones on
     screen. */
  async function loadRecorded() {
    const sb = epinoiaClient();
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('game_events')
        .select('seq,t,team,pid,period,clock,payload')
        .eq('game_id', gameId).order('seq').range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    S.events = rows.map(r => {
      const e = Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock },
                              r.payload || {});
      if (r.team != null) e.team = r.team;
      if (r.pid != null) e.pid = r.pid;
      return e;
    });
    S.redo = [];
    /* The next id must not reuse one already in the durable log, or the upsert
       would drop the new event as a duplicate — which is the very fault this
       whole guard exists to prevent. */
    S.evSeq = S.events.reduce((m, e) => Math.max(m, e.id || 0), 0);

    /* Where the clock stands, from the row the other device has been keeping. */
    try {
      const { data: st } = await sb.from('game_state')
        .select('period,clock_ms,running').eq('game_id', gameId).maybeSingle();
      if (st) {
        S.period = st.period || S.period;
        S.clockMs = st.clock_ms != null ? st.clock_ms : S.clockMs;
      }
    } catch (_) { /* the log alone is enough to score from */ }
    /* Never inherit a RUNNING clock: two devices both ticking is how the game
       clock ends up ahead of the hall's. Whoever takes over starts it. */
    S.running = false;
    S.phase = 'game';

    if (typeof window.buildPmap === 'function') window.buildPmap();
    if (typeof window.save === 'function') window.save();
    if (typeof window.renderAll === 'function') window.renderAll();
    return S.events.length;
  }

  function offerTakeover(serverCount, mine) {
    if (document.getElementById('ep-takeover')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ep-takeover';
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483600', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:24px',
      'background:rgba(2,16,11,.97)', 'font-family:system-ui,sans-serif',
      'color:#e6fff1'
    ].join(';');
    wrap.innerHTML =
      '<div style="max-width:460px;line-height:1.75">' +
      '<div style="font-size:19px;margin-bottom:14px">This game is already being scored</div>' +
      '<p style="color:rgba(230,255,241,.72);font-size:14px">' +
      'The server holds <b>' + serverCount + '</b> actions for this fixture and this ' +
      'device has <b>' + mine + '</b>. Publishing from here would drop everything you ' +
      'record and reset the live score to nil-nil on every page showing it, so it has ' +
      '<b>stopped</b>.</p>' +
      '<p style="color:rgba(230,255,241,.72);font-size:14px">' +
      'If you are taking over, load what has been recorded and carry on from there.</p>' +
      '<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">' +
      '<button id="ep-take" style="padding:11px 16px;border-radius:11px;border:1px solid #93f2bf;' +
      'background:#93f2bf;color:#04100b;font-size:14px">Load the recorded game</button>' +
      '<button id="ep-leave" style="padding:11px 16px;border-radius:11px;' +
      'border:1px solid rgba(230,255,241,.28);background:transparent;color:#e6fff1;' +
      'font-size:14px">Leave it alone</button>' +
      '</div><p id="ep-take-msg" style="margin-top:12px;font-size:13px;color:#ffd166"></p></div>';
    document.body.appendChild(wrap);

    document.getElementById('ep-leave').onclick = () => {
      /* Publishing stays halted. Reading a game somebody else is scoring is a
         perfectly reasonable thing to be doing on this screen. */
      wrap.remove();
      say('reading only — not publishing', '#ffd166');
    };
    document.getElementById('ep-take').onclick = async () => {
      const btn = document.getElementById('ep-take');
      btn.disabled = true;
      document.getElementById('ep-take-msg').textContent = 'loading…';
      try {
        const n = await loadRecorded();
        wrap.remove();
        say('loaded ' + n + ' actions · reload to publish', '#93f2bf');
        /* A reload rather than restarting the halted publisher in place: halt()
           is deliberately one-way, and a fresh boot is the only path that has
           been exercised. The state is already saved, so nothing is lost. */
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        btn.disabled = false;
        document.getElementById('ep-take-msg').textContent =
          'could not load it: ' + (err.message || err);
      }
    };
  }

  /* Checked once the scorer has a game, on the same poll that primes a
     fixture — the scorer reaches that state by several routes and a missed
     hook here would leave the very corruption this prevents. */
  setInterval(() => {
    try { guardAgainstOverwrite(); } catch (e) { console.warn('[guard]', e); }
  }, 3000);

  /* --------------------------------------------------------- escape hatch --- */
  /* The scorer gets a hover bar rather than the sidebar every other page has.

     A statistician's screen has gesture targets at every edge — a rail that
     expanded under a thumb mid-drag would cost a stat, and that is the one
     thing this app must never do. So this is a 4px lip at the very top that
     opens only on deliberate hover, and on touch only after a press and hold
     on the lip itself. It cannot be opened by any gesture used to score.

     Leaving mid-game is also confirmed, because the game lives in
     localStorage and a mis-tap that navigates away mid-quarter is alarming
     even when nothing is actually lost. */
  (function escapeHatch() {
    const lip = document.createElement('div');
    lip.id = 'ep-exitlip';
    lip.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'height:4px',
      'z-index:2147482000', 'background:linear-gradient(90deg,#93f2bf,#8ff5ff)',
      'opacity:.28', 'transition:opacity .18s', 'cursor:pointer'
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'transform:translateY(-100%)', 'transition:transform .2s var(--ease,ease)',
      'z-index:2147482001', 'display:flex', 'align-items:center', 'gap:14px',
      'padding:calc(env(safe-area-inset-top) + 7px) 14px 7px',
      'background:rgba(4,16,11,.95)', 'border-bottom:1px solid rgba(147,242,191,.3)',
      'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
      'font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:.08em', 'text-transform:uppercase', 'color:#e6fff1'
    ].join(';');

    const link = (label, href, colour) => {
      const a = document.createElement('a');
      a.textContent = label; a.href = href;
      a.style.cssText = 'color:' + colour + ';text-decoration:none;white-space:nowrap';
      a.addEventListener('click', ev => {
        const live = (typeof S !== 'undefined' && S && S.phase === 'game');
        if (!live) return;
        ev.preventDefault();
        const go = () => { location.href = href; };
        if (typeof askConfirm === 'function') {
          askConfirm('leave the game? it is saved and will be here when you return', go);
        } else if (confirm('Leave the game? It is saved.')) go();
      });
      return a;
    };

    bar.append(
      link('← Epinoia', '../', '#93f2bf'),
      link('league', '../l/', '#8ff5ff'),
      link('box scores', '../', '#8ff5ff'),
      link('Prophesy Scouting', '/index.html', 'rgba(230,255,241,.6)')
    );

    /* ------------------------------------------------ the saved game ---
       Where the resume modal used to be. A game in progress is written to
       localStorage on every change, and this is how it comes back: on request,
       from the bar, described well enough to know WHICH game it is before
       loading it — the two clubs, the score and how far through it got.

       Deliberately not a modal and deliberately not automatic. The old prompt
       fired before the page had drawn, offered "yes" or "no" to a question
       nobody had asked, and destroyed the game on "no". This does nothing
       until pressed, says what it is about to do, and asks again before
       discarding anything. */
    function injectSavedGame() {
      if (typeof window.loadSaved !== 'function') return;
      let saved = null;
      try { saved = window.migrateSaved(window.loadSaved()); } catch (_) { saved = null; }
      if (!saved || !saved.teams || saved.phase === 'setup') return;

      const d = window.describeSaved(saved);
      if (!d) return;

      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none';

      const label = document.createElement('span');
      label.textContent = 'saved: ' + d.names.join(' v ') + ' ' +
        d.score[0] + '\u2013' + d.score[1];
      label.style.cssText = 'color:rgba(230,255,241,.55);white-space:nowrap';

      const mk = (text, colour) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = text;
        btn.style.cssText = 'all:unset;cursor:pointer;white-space:nowrap;flex:none;' +
          'color:' + colour + ';border:1px solid ' + colour + '55;border-radius:5px;' +
          'padding:4px 8px;font:inherit';
        return btn;
      };

      const load = mk('resume', '#93f2bf');
      load.title = 'pick this game back up where it was left';
      load.addEventListener('click', () => {
        /* Loading a saved game over a NAMED fixture is how one game's events
           end up published into another, so it is refused rather than
           explained away. */
        if (isFixture) {
          alert('This page is open on a specific fixture. Open the scorer ' +
                'without a fixture in the address to pick up a saved game.');
          return;
        }
        try { window.applySaved(saved); wrap.remove(); }
        catch (e) { alert('That game could not be restored: ' + (e.message || e)); }
      });

      const drop = mk('discard', '#ff5f6b');
      drop.title = 'delete the saved game';
      drop.addEventListener('click', () => {
        const ok = confirm('Discard the saved game?\n\n' +
          d.names.join(' v ') + ', ' + d.score[0] + '\u2013' + d.score[1] +
          ', ' + d.events + ' recorded actions.\n\nThis cannot be undone.');
        if (!ok) return;
        try { localStorage.removeItem(window.EP_KEY || 'epinoia_v1');
              localStorage.removeItem('epinoia_v1_game'); } catch (_) {}
        wrap.remove();
      });

      wrap.append(label, load, drop);
      bar.insertBefore(wrap, note);
    }

    const note = document.createElement('span');
    note.textContent = 'the game is saved as you score';
    note.style.cssText = 'margin-left:auto;color:rgba(230,255,241,.4);white-space:nowrap';
    bar.appendChild(note);

    /* ------------------------------------------------- cancel this game ---
       A game started by mistake is discovered HERE, by the person holding the
       tablet, in the first minute — not later by an administrator finding a
       fixture that has been "in progress" since Tuesday. Until now the only
       way out was to leave it live, go and find the fixture in the admin
       console or on its box score, and revert it from there; the one screen
       that knows for certain the game should not be running was the one
       screen that could not stop it.

       WHO SEES IT IS THE DATABASE'S ANSWER, not this page's guess. It asks
       can_manage_game — a platform administrator, an administrator of the
       owning league, or whoever created an ad-hoc game — which is a
       DIFFERENT and narrower question than can_score. A statistician assigned
       to a fixture may record what happens; deciding the game never happened
       is not theirs to make, and the button simply does not appear for them.

       The two-step confirmation is the same one both other call sites use:
       the first call omits the discard flag, the database refuses and reports
       how many events would be destroyed, and that number goes into the
       question. Nobody agrees to discard a log without being told its size. */
    if (isFixture) (async function cancelControl() {
      const sb = window.epinoiaClient && epinoiaClient();
      if (!sb) return;
      let mayManage = false;
      try {
        const { data, error } = await sb.rpc('can_manage_game', { p_game: gameId });
        if (error || data !== true) return;
        mayManage = true;
      } catch (_) { return; }
      if (!mayManage) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'cancel game';
      btn.title = 'this game should not be running — put the fixture back on the listing';
      btn.style.cssText = [
        'all:unset', 'cursor:pointer', 'white-space:nowrap', 'flex:none',
        'color:#ff5f6b', 'border:1px solid rgba(255,95,107,.45)',
        'border-radius:5px', 'padding:5px 9px', 'font:inherit'
      ].join(';');
      bar.insertBefore(btn, note);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const attempt = discard => sb.rpc('revert_game',
          discard ? { p_game: gameId, p_discard_events: true } : { p_game: gameId });
        try {
          let r = await attempt(false);
          if (r.error) {
            /* DETAIL first, then the sentence — the same two-step the box
               score and the admin console use, so a database that predates
               migration 0067/0068 still opens the confirmation rather than
               dropping a raw error on the statistician mid-game. */
            const e = r.error;
            const d = e.details;
            const n = (d != null && /^\s*\d+\s*$/.test(String(d))) ? String(d).trim()
                    : (/has (\d+) recorded event/.exec(e.message || '') || [])[1] || null;
            if (n == null) { btn.disabled = false; alert(e.message || 'That was refused.'); return; }
            const sure = confirm(
              'Cancel this game and put the fixture back on the listing?\n\n' +
              n + ' recorded event' + (n === '1' ? '' : 's') + ' will be discarded ' +
              'permanently. The clubs, the date and the venue are kept, so the ' +
              'fixture can be scored properly when it is played.\n\n' +
              'This device stops publishing immediately.');
            if (!sure) { btn.disabled = false; return; }
            r = await attempt(true);
            if (r.error) { btn.disabled = false; alert(r.error.message || 'That was refused.'); return; }
          }
          /* Stop publishing BEFORE going anywhere. The scorer's own watchdog
             would catch this within eight seconds, but this tab already knows
             — and pagehide fires a last flush on the way out, which is exactly
             the write that would put events back on the fixture just cancelled. */
          try { window.EpinoiaSync && window.EpinoiaSync.halt(); } catch (_) {}
          say('cancelled · back on the listing', '#ff5f6b');
          /* The scorer keeps the whole game in localStorage under this key
             (see save() in score/index.html) and restores it on load, so
             leaving it behind means reopening the scorer offers to carry on
             scoring a fixture that no longer exists. */
          try {
            localStorage.removeItem(window.EP_KEY || 'epinoia_v1');
            localStorage.removeItem('epinoia_v1_game');
            sessionStorage.removeItem(ROOM_KEY);
          } catch (_) {}
          location.href = '../game/?g=' + encodeURIComponent(gameId) + '&mode=supabase';
        } catch (err) {
          btn.disabled = false;
          alert('That was refused: ' + (err.message || err));
        }
      });
    }());

    let open = false, hold = null;
    const show = v => {
      open = v;
      bar.style.transform = v ? 'translateY(0)' : 'translateY(-100%)';
      lip.style.opacity = v ? '0' : '.28';
    };
    lip.addEventListener('mouseenter', () => show(true));
    bar.addEventListener('mouseleave', () => show(false));
    /* touch: press and hold the lip, so a swipe from the top edge does nothing */
    lip.addEventListener('touchstart', () => { hold = setTimeout(() => show(true), 450); },
                         { passive: true });
    ['touchend', 'touchcancel', 'touchmove'].forEach(e =>
      lip.addEventListener(e, () => { clearTimeout(hold); }, { passive: true }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) show(false); });

    /* Called here rather than from start(), which is outside this closure and
       could not see it — the first version threw a ReferenceError on every
       load and the control simply never appeared. It needs the bar to exist,
       which it now does, and no gating of its own: a saved game is the
       operator's own local data, and a refused page has the entire bar behind
       its overlay regardless. */
    try { injectSavedGame(); } catch (e) { console.warn('[saved]', e); }

    const mountNav = () => { document.body.append(lip, bar); };
    if (document.body) mountNav(); else document.addEventListener('DOMContentLoaded', mountNav);
  })();

  /* ------------------------------------------------------- fixture loading --- */
  /* Typing two rosters by hand before every game is the wrong workflow for a
     league that already knows who is playing — and it is also why season stats
     stayed empty: a hand-typed player gets a local id like 'p0_3', which cannot
     be aggregated across games. Loading a fixture uses the real players.id
     uuid as the scorer's pid, so the totals land on the right person.

     Injected into the setup screen rather than built into it, so the scorer
     itself is unchanged and still works standalone. */
  const CFGx = window.EPINOIA_CONFIG || {};
  const sbApi = async p => {
    const r = await fetch(CFGx.supabaseUrl + '/rest/v1/' + p,
      { cache: 'no-store', headers: { apikey: CFGx.supabaseAnonKey, Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
    return r.json();
  };

  const rosterOfTeam = async (teamId) => {
    const re = await sbApi('roster_entries?team_id=eq.' + teamId +
      '&active=eq.true&select=jersey,position,players(id,first_name,last_name)');
    return re
      .filter(r => r.players)                       // a minor withheld by RLS comes back null
      .map(r => ({
        id: r.players.id,
        name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim().toLowerCase(),
        num: String(r.jersey || '')
      }))
      .sort((a, b) => (+a.num || 99) - (+b.num || 99));
  };

  /* The two clubs in this fixture, remembered when it loads. The pre-game
     screen lets a statistician pull a late arrival off the club's published
     roster, and it can only do that if it knows which clubs are playing. */
  let sides = null;

  /* ?g=<uuid> means "score this fixture": pull both squads and go straight to
     the starting-five picker, which is the first decision that is actually the
     statistician's to make. */
  async function loadFixture(id) {
    const gs = await sbApi('games?id=eq.' + encodeURIComponent(id) +
      '&select=id,status,home_team_id,away_team_id,roster_snapshot,' +
      'home:home_team_id(name,colour),away:away_team_id(name,colour)&limit=1');
    if (!gs.length) throw new Error('that fixture is not visible to you');
    const g = gs[0];
    if (g.status === 'final') throw new Error('that game is already final');

    sides = [g.home_team_id, g.away_team_id];

    /* a resumed game keeps the squad frozen at tip, so a roster edited
       mid-game never rewrites who was available */
    if (g.roster_snapshot && g.roster_snapshot.teams) return g.roster_snapshot.teams;

    const [hp, ap] = await Promise.all([
      rosterOfTeam(g.home_team_id), rosterOfTeam(g.away_team_id)
    ]);
    return [
      { name: ((g.home || {}).name || 'home').toLowerCase(),
        color: (g.home || {}).colour || '#93f2bf', players: hp },
      { name: ((g.away || {}).name || 'away').toLowerCase(),
        color: (g.away || {}).colour || '#8ff5ff', players: ap }
    ];
  }

  function injectFixturePicker() {
    const setup = document.getElementById('setup');
    if (!setup || document.getElementById('csFixturePick')) return;
    if (!CFGx.supabaseUrl || !CFGx.supabaseAnonKey) return;   // standalone use

    const card = document.createElement('div');
    card.id = 'csFixturePick';
    card.className = 'glass';
    card.style.cssText = 'padding:14px;display:flex;flex-direction:column;gap:9px;margin-bottom:4px';

    const h = document.createElement('div');
    h.style.cssText = 'font-family:var(--f-head);font-size:13px;letter-spacing:.06em;' +
                      'text-transform:uppercase;color:var(--lume)';
    h.textContent = 'score a league fixture';

    const sub = document.createElement('div');
    sub.style.cssText = 'font-family:var(--f-mono);font-size:10px;line-height:1.7;color:var(--dim)';
    sub.textContent = 'Loads both squads with their real identities, so the stats count ' +
                      'towards the season. Or ignore this and set up a one-off below.';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';

    const mkSel = () => {
      const s = document.createElement('select');
      s.style.cssText = 'flex:1 1 150px;min-width:0;background:var(--bg-elevated);color:var(--txt);' +
        'border:1px solid var(--line);border-radius:10px;padding:9px 10px;' +
        'font-family:var(--f-mono);font-size:12px';
      return s;
    };
    const lgSel = mkSel(), fxSel = mkSel();

    const go = document.createElement('button');
    go.className = 'yes';
    go.textContent = 'load';
    go.disabled = true;
    go.style.cssText = 'flex:0 0 auto;padding:9px 18px';

    const note = document.createElement('div');
    note.style.cssText = 'font-family:var(--f-mono);font-size:10px;color:var(--dim);line-height:1.7';

    row.append(lgSel, fxSel, go);
    card.append(h, sub, row, note);
    setup.insertBefore(card, setup.firstChild);

    let fixtures = [];

    const loadFixtures = async (leagueId) => {
      fxSel.innerHTML = '';
      go.disabled = true;
      try {
        const comps = await sbApi('competitions?select=id,name,seasons!inner(league_id)' +
          '&seasons.league_id=eq.' + leagueId);
        if (!comps.length) { fxSel.append(new Option('no competitions yet', '')); return; }
        const ids = comps.map(c => c.id).join(',');
        fixtures = await sbApi('games?competition_id=in.(' + ids + ')&status=in.(scheduled,live)' +
          '&select=id,tipoff_at,status,venue,home:home_team_id(name),away:away_team_id(name)' +
          '&order=tipoff_at');
        if (!fixtures.length) {
          fxSel.append(new Option('no fixtures to score', ''));
          note.textContent = 'Every game in this league is finished. Schedule one in the ' +
                             'league admin page, or set up a one-off below.';
          return;
        }
        fixtures.forEach(f => {
          const when = f.tipoff_at
            ? new Date(f.tipoff_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
            : 'TBC';
          const label = when + '  ' + ((f.home || {}).name || '?') + ' v ' +
                        ((f.away || {}).name || '?') + (f.status === 'live' ? '  (live)' : '');
          fxSel.append(new Option(label, f.id));
        });
        go.disabled = false;
        note.textContent = '';
      } catch (e) {
        fxSel.append(new Option('could not load fixtures', ''));
        note.textContent = e.message;
      }
    };

    (async () => {
      try {
        const lgs = await sbApi('leagues?select=id,name,slug&order=name');
        if (!lgs.length) { note.textContent = 'No leagues on the platform yet.'; return; }
        lgs.forEach(l => lgSel.append(new Option(l.name, l.id)));
        lgSel.addEventListener('change', () => loadFixtures(lgSel.value));
        await loadFixtures(lgs[0].id);
      } catch (e) {
        note.textContent = 'Could not reach the league: ' + e.message;
      }
    })();

    /* Reload rather than set up in place: the game id is read once at load and
       drives the live transport and the finalise button, so it has to be in the
       URL for those to point at the right fixture. */
    go.addEventListener('click', () => {
      if (!fxSel.value) return;
      location.search = '?g=' + encodeURIComponent(fxSel.value) + '&mode=supabase';
    });
  }

  /* If we arrived with a fixture id, skip the setup screen entirely. */
  async function autoLoadFixture() {
    if (!isFixture) return;
    if (typeof showStarterPick !== 'function') return;

    /* SETTLE THE RESUME QUESTION FIRST.

       The scorer asks "resume the saved game?" from its own boot(), and while
       that modal is open S is still null — so the guard below, which exists to
       stop this trampling a game in progress, could not see the game being
       decided about and let the fixture load behind the dialog. Declining then
       reset the state and took the freshly-loaded fixture with it, which is
       exactly the "no cancels the game I clicked" fault. Waiting means the
       answer governs the work rather than racing it. */
    const R = window.__epResume;
    if (R && R.pending) {
      const resumed = await new Promise(res => { R.done = res; });
      if (resumed) return;          // they went back to the saved game; leave it alone
    }

    if (S && S.phase && S.phase !== 'setup') return;    // a game is already in progress

    say('loading the fixture…', '#ffd166');
    try {
      const teams = await loadFixture(gameId);
      /* Which fixture the saved game belongs to. Without this a later session
         cannot tell last week's saved game from tonight's, and "resume" would
         reopen the wrong one against this URL's transport and finalise button. */
      try { localStorage.setItem('epinoia_v1_game', gameId); } catch (_) {}
      const thin = teams.filter(t => t.players.length < 5);
      showStarterPick(teams);
      if (thin.length) {
        say('a squad has fewer than five listed', '#ffd166');
      }
    } catch (e) {
      say(e.message, '#ff5f6b');
      console.warn('[fixture]', e);
    }
  }

  /* WHAT THE PRE-GAME SCREEN NEEDS FROM HERE.

     Squad editing lives in the scorer, where the game state is; the club's
     published roster lives out here, where the fixture and the credentials
     are. This is the seam between them, and it is deliberately two functions
     and no state: available() says whether there is a club to ask about, and
     roster() answers for one side. Nothing about the game crosses it. */
  window.EpinoiaSquads = {
    available: () => !!(sides && sides[0] && sides[1]),
    roster: (t) => {
      if (!sides || !sides[t]) return Promise.reject(new Error('no club for that side'));
      return rosterOfTeam(sides[t]);
    }
  };

  /* =========================================================== squad picker ===
     A CLUB PER SIDE, ON THE CARD ITSELF.

     The fixture picker above handles the common case: a scheduled game, both
     squads, straight into it. This is for everything that is not that — a
     friendly, a pre-season game, a tournament nobody has entered into the
     schedule, a cup tie between two clubs from different leagues. The names
     were typed in by hand, every time, for clubs whose rosters the platform
     was already holding.

     TWO INDEPENDENT PICKERS, one per card, and that is the point rather than a
     convenience: the two sides do not have to come from the same league. A
     card picks a league, then a club, and takes that club's published roster,
     its name and its colour. The other card can do something completely
     different, or nothing at all.

     MANUAL ENTRY IS UNTOUCHED. The name field stays editable after a pick, the
     + player button still works, the scan still works, and rows can still be
     deleted. Picking a club fills the card in; it does not take it over. A
     club with two players registered and nine turning up is an ordinary
     Saturday, and the card has to survive it.

     WHY THE ROWS ARE CLEARED FIRST. Filling over the top of what is already
     there is how you end up with the last club's ninth player still in the
     sheet when the new one has eight. Picking a club replaces that card's
     roster outright — which is also what somebody means when they change their
     mind about which club is playing.

     Minors are absent by RLS rather than by anything here: rosterOfTeam drops
     the rows the database returned as null, which is what a withheld player
     looks like from out here. A youth club will come back short, and that is
     the protection working rather than a fault to route around. */
  const teamsOfLeague = (leagueId) =>
    sbApi('teams?league_id=eq.' + encodeURIComponent(leagueId) +
          '&select=id,name,slug,colour&order=name');

  function injectSquadPickers() {
    if (!CFGx.supabaseUrl || !CFGx.supabaseAnonKey) return;     // standalone use
    const cards = document.querySelectorAll('#setup .team-card');
    if (cards.length < 2) return;
    if (document.querySelector('.csSquadPick')) return;         // already mounted

    const SEL = 'flex:1 1 120px;min-width:0;background:var(--bg-elevated);color:var(--txt);' +
                'border:1px solid var(--line);border-radius:9px;padding:7px 8px;' +
                'font-family:var(--f-mono);font-size:11px';

    let leagues = null;                       // fetched once, shared by both cards

    cards.forEach((card) => {
      const bar = document.createElement('div');
      bar.className = 'csSquadPick';
      bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;' +
                          'margin:0 0 9px';

      const lg = document.createElement('select'); lg.style.cssText = SEL;
      const tm = document.createElement('select'); tm.style.cssText = SEL;
      tm.disabled = true;
      const note = document.createElement('div');
      note.style.cssText = 'flex:1 1 100%;font-family:var(--f-mono);font-size:10px;' +
                           'color:var(--dim);line-height:1.6';
      note.textContent = 'or just type the names below';

      lg.append(new Option('league…', ''));
      tm.append(new Option('club…', ''));
      bar.append(lg, tm, note);

      /* above the name field, because it is the thing that fills the name
         field — reading downwards it goes league, club, name, roster */
      card.insertBefore(bar, card.firstChild);

      const fillClubs = async (leagueId) => {
        tm.innerHTML = ''; tm.disabled = true;
        tm.append(new Option('club…', ''));
        if (!leagueId) return;
        try {
          const ts = await teamsOfLeague(leagueId);
          if (!ts.length) { note.textContent = 'no clubs in that league yet'; return; }
          ts.forEach(t => {
            const o = new Option(t.name, t.id);
            o.dataset.colour = t.colour || '';
            o.dataset.name = t.name;
            tm.append(o);
          });
          tm.disabled = false;
          note.textContent = 'or just type the names below';
        } catch (e) {
          note.textContent = 'could not load the clubs: ' + e.message;
        }
      };

      const applySquad = async (teamId, label, colour) => {
        note.textContent = 'loading the squad…';
        let roster;
        try { roster = await rosterOfTeam(teamId); }
        catch (e) { note.textContent = 'could not load that squad: ' + e.message; return; }

        const nameIn = card.querySelector('.tname');
        if (nameIn) {
          nameIn.value = label;
          nameIn.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (colour) card.dataset.color = colour;   // startGame reads this

        /* out with whatever was there, in with this club's squad */
        card.querySelectorAll('.rrow').forEach(r => r.remove());
        const add = card.querySelector('.addP');
        roster.forEach((pl) => {
          add && add.click();
          const rows = card.querySelectorAll('.rrow');
          const row = rows[rows.length - 1];
          if (!row) return;
          const n = row.querySelector('.rname'), num = row.querySelector('.rnum');
          if (n) { n.value = pl.name; n.dispatchEvent(new Event('input', { bubbles: true })); }
          if (num) { num.value = pl.num || ''; num.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        note.textContent = roster.length
          ? roster.length + ' registered — add or remove anybody below'
          : 'that club has nobody registered yet — type the names below';
      };

      lg.addEventListener('change', () => fillClubs(lg.value));
      tm.addEventListener('change', () => {
        const o = tm.selectedOptions[0];
        if (!tm.value || !o) return;
        applySquad(tm.value, o.dataset.name || o.textContent, o.dataset.colour);
      });

      /* the league list is fetched once and reused by the second card */
      (async () => {
        try {
          if (!leagues) leagues = await sbApi('leagues?select=id,name&order=name');
          if (!leagues.length) { note.textContent = 'no leagues on the platform yet'; return; }
          leagues.forEach(l => lg.append(new Option(l.name, l.id)));
        } catch (e) {
          note.textContent = 'could not reach the leagues: ' + e.message;
        }
      })();
    });
  }

  /* ------------------------------------------------------ legend clearance --- */
  /* #cols reserves a flat 52px for the fixed gesture legend, but the legend is
     150px tall on a narrow phone once its text wraps — so the bottom of the
     player columns ends up underneath it. Measuring the element is the only
     way to reserve the right amount, because the height depends on wrapping.
     Its top 96px is a transparent gradient, so only the remainder hides
     anything. Publishes --ep-legend-h for the stylesheet to use. */
  (function trackLegend() {
    const mount = () => {
      const el = document.getElementById('ctrlHelp');
      if (!el) return false;
      const apply = () => {
        const h = el.offsetHeight;                       // 0 when display:none (desktop)
        /* MEASURE THE LEAD-IN, DO NOT ASSUME IT. This subtracted a flat 96px —
           the desktop padding-top — which stopped being true the moment the
           phone layout dropped that scrim to 18. The legend then under-reported
           its own opaque height by nearly eighty pixels and #cols reserved too
           little, which is how player rows ended up underneath it. */
        const lead = parseFloat(getComputedStyle(el).paddingTop) || 0;
        const opaque = h > 0 ? Math.max(0, h - lead) : 0;
        document.documentElement.style.setProperty('--ep-legend-h', opaque + 'px');

        /* WHERE THE PLAYING FIVE END. The legend is allowed to cover the bench
           — those rows are only touched to give a technical to somebody sitting
           down — and must never cover the five on court, which are read on
           every possession. Publishing the boundary lets the stylesheet cap the
           legend instead of guessing at a fraction of the viewport. */
        const starters = [...document.querySelectorAll('#cols .prow:not(.bench)')]
          .filter(r => r.offsetParent);
        if (starters.length) {
          const low = Math.max(...starters.map(r => r.getBoundingClientRect().bottom));
          const room = Math.max(72, Math.round(window.innerHeight - low - 4));
          document.documentElement.style.setProperty('--ep-help-max', room + 'px');
        }

        /* The slide-up sheet also sits over the bottom of the columns — only
           its 40px handle when closed, but that handle still covers a player
           row. Measured rather than assumed, for the same reason. */
        const sh = document.getElementById('sheet');
        if (sh) {
          const peek = Math.min(sh.offsetHeight || 40, 40);
          document.documentElement.style.setProperty('--ep-sheet-h', peek + 'px');
        }
      };
      apply();
      if (window.ResizeObserver) new ResizeObserver(apply).observe(el);
      window.addEventListener('resize', apply, { passive: true });
      window.addEventListener('orientationchange', () => setTimeout(apply, 250));

      /* The legend lives inside #game, which is display:none until tip-off, so
         the first measurement is always 0 and a ResizeObserver does not fire
         for that transition. Re-measure whenever the scorer changes screen —
         same global-wrapping approach as everything else here. */
      const wrapShowScreen = () => {
        if (typeof window.showScreen !== 'function' || window.showScreen.__csWrapped) return false;
        const inner = window.showScreen;
        const wrapped = function () {
          const r = inner.apply(this, arguments);
          /* A timer, not requestAnimationFrame: rAF does not fire while the tab
             is backgrounded or otherwise not compositing, and the reservation
             would then stay at whatever it was when the legend was hidden.
             Two passes — one for the immediate layout, one after any transition. */
          setTimeout(apply, 0);
          setTimeout(apply, 260);
          /* tip-off is a screen change: setup -> game. Claim the fixture the
             moment that happens, so the public page has a roster from the
             first possession rather than from the final whistle. */
          setTimeout(() => { try { claimFixture(); } catch (e) { console.warn('[tip]', e); } }, 400);
          return r;
        };
        wrapped.__csWrapped = true;
        window.showScreen = wrapped;
        return true;
      };
      if (!wrapShowScreen()) {
        const t2 = setInterval(() => { if (wrapShowScreen()) clearInterval(t2); }, 300);
        setTimeout(() => clearInterval(t2), 15000);
      }
      return true;
    };
    if (!mount()) {
      const t = setInterval(() => { if (mount()) clearInterval(t); }, 300);
      setTimeout(() => clearInterval(t), 15000);
    }
  })();

  /* ------------------------------------------------------------ finalise --- */
  /* isFixture is declared at the top of this file — see the note there. */

  /* --------------------------------------------------------- claim retry ---
     claimFixture() is only ever called again from a screen transition —
     tip-off, halftime, game end — because that is the one place it is wired
     in. A statistician who was not yet signed in at tip-off sees the amber
     "NOT being saved" badge and nothing then retries the durable write for
     the rest of a period spent on one screen: the game stays 'scheduled' in
     the table, watchers still see it live (that transport needs no account
     and no row), and every other view of the site — the homepage among them
     — correctly reports nothing live, because nothing is.

     Signing in should be enough to fix it without waiting for the next
     screen change, so it retries the moment a session appears — on the
     initial check, on sign-in, and on the token refresh that follows a
     cross-tab sign-in via localStorage's 'storage' event, which is how the
     "sign in ↗" link in another tab reaches this one. It also retries on a
     slow beat regardless, for the transient case (a dropped request, RLS
     replication lag) that has nothing to do with auth. claimFixture() is
     already idempotent once it has succeeded — its first line is a no-op
     check — so calling it again after that costs nothing. */
  if (isFixture) {
    if (window.epinoiaClient) {
      const sb = epinoiaClient();
      if (sb) sb.auth.onAuthStateChange((_event, session) => { if (session) claimFixture(); });
    }
    const claimRetry = setInterval(() => {
      if (claimed) { clearInterval(claimRetry); return; }
      claimFixture();
    }, 20000);
  }

  async function finaliseGame(btn, note) {
    const CFG = window.EPINOIA_CONFIG;
    const sb = window.epinoiaClient && epinoiaClient();
    if (!sb) { note('No Supabase client — cannot finalise.', '#ff5f6b'); return; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      note('Sign in first — open /epinoia/app/ in another tab, then try again.', '#ffd166');
      return;
    }

    btn.disabled = true;
    note('pushing the event log…', '#ffd166');

    /* Push whatever the buffer still holds, then give the upserts a moment to
       land. Finalising against a partial log would produce a box score that
       silently disagrees with what was scored. */
    try { window.EpinoiaSync && window.EpinoiaSync.flush(); } catch (_) {}
    await new Promise(r => setTimeout(r, 1200));

    /* Confirm the server actually has every event before asking it to close
       the game — the flush is fire-and-forget by design. */
    try {
      const { count, error } = await sb.from('game_events')
        .select('seq', { count: 'exact', head: true }).eq('game_id', gameId);
      if (error) throw error;
      const local = (S.events || []).length;
      if (count == null || count < local) {
        note(`server has ${count == null ? '?' : count} of ${local} events — retrying…`, '#ffd166');
        try { window.EpinoiaSync && window.EpinoiaSync.flush(); } catch (_) {}
        await new Promise(r => setTimeout(r, 2500));

        /* AND THEN CHECK AGAIN, AND REFUSE. This retried and carried on
           regardless, so a game whose log had not been saved went to the
           server anyway and came back "sanity gate failed" — which is true but
           tells you nothing about the real problem, which is that the events
           are not there. Say that instead, and do not send a request that
           cannot succeed. */
        const again = await sb.from('game_events')
          .select('seq', { count: 'exact', head: true }).eq('game_id', gameId);
        const now = again.count;
        if (now == null || now < local) {
          btn.disabled = false;
          note(`the league has ${now == null ? 'no' : now} of ${local} events — not finalising ` +
               `an incomplete game. Keep this tab open; export the play-by-play if it persists.`,
               '#ff5f6b');
          return;
        }
      }
    } catch (e) {
      btn.disabled = false;
      note('could not verify the log: ' + (e.message || e), '#ff5f6b');
      return;
    }

    note('finalising…', '#ffd166');
    try {
      /* NO apikey HEADER. An edge function authenticates on the bearer token
         alone — the apikey header is a PostgREST convention that this endpoint
         never read — and sending it made the browser ask permission for a
         header the function's CORS policy did not grant. The preflight was
         refused, the fetch rejected before the request was ever made, and the
         scorer reported "network error: Failed to fetch", which looks exactly
         like being offline. Finalising therefore failed from a browser every
         time while working perfectly from curl.

         The function now allows the header too, but this stays removed so the
         fix does not depend on a redeploy — and because it was never doing
         anything. */
      const r = await fetch(CFG.supabaseUrl + '/functions/v1/finalise-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ gameId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        btn.disabled = false;
        /* The gate already sends back exactly what it objected to; this showed
           only the headline, so "sanity gate failed" was all anybody ever saw
           and there was nothing to act on. The reasons are the useful part —
           "only 1 periods played", "scores are level" — and they name the real
           problem far better than the headline does. */
        const why = Array.isArray(j.blocking) && j.blocking.length
          ? j.blocking.join(' · ') : (j.error || r.status);
        note('refused: ' + why, '#ff5f6b');
        return;
      }
      note('final — the box score is public', '#93f2bf');
      btn.textContent = 'finalised ✓';
      try { window.EpinoiaSync && window.EpinoiaSync.finalise(); } catch (_) {}
    } catch (e) {
      btn.disabled = false;
      note('network error: ' + (e.message || e), '#ff5f6b');
    }
  }

  /* renderFinal() rebuilds #finalview wholesale, so the button is re-injected
     after every render rather than added once. Wrapping the global is the same
     approach sync.js takes with addEvent: the scorer's own code is untouched. */
  function injectFinalise() {
    const host = document.getElementById('finalview');
    if (!host || host.querySelector('#csFinalise')) return;
    const row = host.querySelector('.mbtns');
    if (!row) return;

    const wrap = document.createElement('div');
    wrap.className = 'mbtns';
    wrap.style.cssText = 'padding:10px 0 0;flex-direction:column;gap:8px;align-items:stretch';

    const btn = document.createElement('button');
    btn.id = 'csFinalise';
    btn.className = 'yes';
    btn.type = 'button';

    const msg = document.createElement('div');
    msg.style.cssText = 'font-family:var(--f-mono);font-size:10px;line-height:1.7;text-align:center;' +
                        'color:var(--dim);padding:0 4px';
    const note = (t, c) => { msg.textContent = t; msg.style.color = c || 'var(--dim)'; };

    if (!isFixture) {
      btn.textContent = 'finalise to the league';
      btn.disabled = true;
      note('This is a practice game, so there is nothing to publish. Open a real ' +
           'fixture from the league admin page to score one that counts.');
    } else {
      btn.textContent = 'finalise to the league';
      note('Publishes the box score, updates the table and the season statistics. ' +
           'A finalised game stops accepting events.');
      btn.onclick = () => {
        if (typeof askConfirm === 'function') {
          askConfirm('finalise this game? the log is closed afterwards',
                     () => finaliseGame(btn, note));
        } else finaliseGame(btn, note);
      };
    }

    wrap.append(btn, msg);
    row.parentNode.insertBefore(wrap, row);

    if (isFixture) {
      const view = document.createElement('a');
      view.className = 'mini';
      view.textContent = 'open the public box score ↗';
      view.href = '../game/?g=' + encodeURIComponent(gameId) + '&mode=supabase';
      view.target = '_blank'; view.rel = 'noopener';
      view.style.cssText = 'display:block;text-align:center;font-family:var(--f-mono);' +
                           'font-size:10px;color:var(--aqua);text-decoration:none;padding-top:2px';
      wrap.appendChild(view);
    }
  }

  /* wrap once the scorer's own script has defined it */
  const wrapRenderFinal = () => {
    if (typeof window.renderFinal !== 'function' || window.renderFinal.__csWrapped) return false;
    const inner = window.renderFinal;
    const wrapped = function () {
      const r = inner.apply(this, arguments);
      try { injectFinalise(); } catch (e) { console.warn('[finalise]', e); }
      return r;
    };
    wrapped.__csWrapped = true;
    window.renderFinal = wrapped;
    return true;
  };
  if (!wrapRenderFinal()) {
    const t = setInterval(() => { if (wrapRenderFinal()) clearInterval(t); }, 300);
    setTimeout(() => clearInterval(t), 20000);
  }

  /* --------------------------------------------------------------- attach --- */
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    /* Refused fixtures never attach and never report progress towards it —
       "waiting for tip-off" under a notice saying the game is not yours is
       the badge arguing with the page. */
    if (refused) { clearInterval(timer); return; }
    /* Not just "is there state" — the scorer builds S as soon as the setup
       screen opens, and the bridge publishes status 'live' for anything that
       is not final. Attaching here would put an empty 0–0 phantom game on the
       public page the moment someone opened the scorer. Wait for a real tip. */
    if (typeof S === 'undefined' || !S || S.phase === 'setup') {
      if (tries === 1) say('waiting for tip-off', '#ffd166');
      if (tries > 1800) { clearInterval(timer); say('not attached', '#ff5f6b'); }  // ~15 min
      return;
    }
    clearInterval(timer);

    if (!window.EpinoiaSync) { say('sync.js missing', '#ff5f6b'); return; }
    const sb = (mode === 'supabase' && window.epinoiaClient) ? window.epinoiaClient() : null;
    if (mode === 'supabase' && !sb) {
      say('no supabase client — local only', '#ff5f6b');
      mode = 'local';
    }

    /* An admin can revert THIS fixture out from under a statistician who is
       still scoring it — the box score offers that button precisely so a
       game started by mistake can be undone, and it does not know or care
       whether a device is still open on the other end. sync.js notices the
       moment its next score write matches no row (the fixture is no longer
       'live') and calls this once. A quiet badge alone is too easy to miss
       mid-game, so this also interrupts with an alert — every tap from here
       is not being recorded, which is worth stopping for. */
    let revokedWarned = false;
    const onRevoked = () => {
      say('reverted by an admin · nothing is being saved', '#ff5f6b');
      bar.style.borderColor = 'rgba(255,95,107,.7)';
      bar.style.background = 'rgba(40,6,8,.94)';
      if (revokedWarned) return;
      revokedWarned = true;
      try {
        alert('This game was put back on the fixture list by an admin.\n\n' +
              'Nothing scored from now on is being saved. Close this tab and ' +
              'reopen the scorer from the fixture list if you meant to keep going.');
      } catch (_) {}
    };

    /* THE SAME TREATMENT FOR A LOG THAT IS NOT BEING WRITTEN.

       A revoked game and a refused write are the same thing from where the
       statistician sits: taps that are not being kept. The second used to be
       silent — the broadcast still went out, so the public page looked healthy
       while the table behind it took nothing, and a whole game was lost before
       anyone found out at the final whistle.

       The first failure says so quietly, because one refused frame is usually
       a blip that the backlog retries and clears. If they are still stacking
       up, it interrupts: at that point something is wrong that scoring on will
       not fix. */
    let writeWarned = false;
    const onWriteFail = (err, count) => {
      say('not saving · ' + (err && err.code ? err.code : 'write refused'), '#ff5f6b');
      bar.style.borderColor = 'rgba(255,95,107,.7)';
      if (count < 5 || writeWarned) return;
      writeWarned = true;
      try {
        alert('The league database is refusing to save this game.\n\n' +
              (err && err.message ? err.message + '\n\n' : '') +
              'Scoring still works and nothing on this screen is lost, but the ' +
              'game is not being written to the league. Do not close this tab — ' +
              'export the play-by-play from the final screen if this does not clear.');
      } catch (_) {}
    };

    try {
      window.EpinoiaSync.attach({ gameId, mode, supabase: sb, onRevoked, onWriteFail });
      say((mode === 'local' ? 'local · ' : 'live · ') + shortId, '#93f2bf');
    } catch (e) {
      console.error('[bootstrap]', e);
      say('attach failed', '#ff5f6b');
    }

    /* pending count is the honest health signal: if frames stop draining the
       scorer keeps working but the viewer is behind, and that must be visible */
    setInterval(() => {
      const st = window.EpinoiaSync.status();
      if (authOk === false) return;                 // already saying the real problem
      if (st.pending > 12) {
        /* a backlog that will not drain is a refused write, not a slow one */
        say('live · not saved (' + st.pending + ' held)', '#ffd166');
      } else {
        say((mode === 'local' ? 'local · ' : 'live · ') + shortId, '#93f2bf');
      }
    }, 3000);
  }, 500);

  /* ------------------------------------------------------------- wire up --- */
  /* Both run after the scorer's own script has defined its globals — the
     picker only needs the DOM, the auto-load needs showStarterPick(). */
  /* ===================== THE DOOR ON A REAL FIXTURE =====================

     The scorer opened for anybody who knew a game id. Signed out it warned
     that nothing was being saved and carried on regardless; signed in with no
     roles it did the same. Every WRITE was refused — can_score guards the
     event log, the claim and the finalise — so no stranger ever changed a
     game. What they got instead was a scoring app running against a real
     fixture's identity, broadcasting a fabricated score to anyone watching
     that game's public page over a transport that needs no credentials at
     all. Refused writes were never the whole story: the live view was the
     hole, and it was open to anyone with the link.

     So the fixture is checked before the app is usable, with the same
     can_score() the row-level policies use — one question, one answer, no
     second implementation to drift. Signed out is refused for the same reason
     as signed in without the role: neither may score this game.

     THE DEMO IS THE WAY THROUGH. Nobody is turned away at a dead end — the
     refusal offers the practice game, which is the thing a curious visitor
     actually wanted and which writes nothing anywhere. ?train=1 and a scratch
     room never reach this code at all: isFixture is false for both. */
  /* ================== THE DOOR ON THE SCORER ITSELF ==================

     The previous gate asked one question — "may you score THIS fixture?" — and
     only when a fixture id was in the URL. Opening /epinoia/score/ with no id
     was therefore ungated: it drew the fixture picker, listed the league's
     games, and let anybody pick one and press load. The load was refused a
     moment later, which is the right outcome reached the wrong way round: an
     account with no credentials should never have been shown the machinery,
     and being told "no" after choosing is worse than not being offered.

     So the page now asks a question about the ACCOUNT before it asks one about
     a game:

       ?train=1        the practice game. Always allowed, for anybody, signed
                       in or not — it invents two squads, writes nothing
                       anywhere and touches no fixture. This is the thing a
                       curious visitor should be able to reach, and gating it
                       would be gating the demo.
       ?g=<fixture>    may_score_game() for that game — WHO may score it, not
                       whether it is open to writes this second. can_score()
                       is the narrower write gate and refuses a fixture that
                       has been reverted, which is precisely the fixture a
                       scorer is arriving to re-claim; asking it here locked
                       people out of the reopen they came to do. The write
                       itself is still gated by can_score at the row level.
       neither         may this account score ANYTHING? Assigned to a game, or
                       an administrator of a league, or a platform admin. The
                       same predicate the rail uses to decide whether to show
                       "score a game" at all, so the two cannot disagree.

     WHY NOT A SEPARATE DEMO PAGE, which was the other way to do this. Copying
     the scorer would leave two four-thousand-line files to keep in step, and
     they would drift — the demo is valuable precisely because it is the real
     app. One file with one gate at the front leaks nothing that a second copy
     would not, and there is only ever one scorer to fix. */

  /* Whether this account may score anything at all. Deliberately the same
     shape as nav.js's predicate for the "score a game" row. */
  async function mayScoreSomething(sb) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return false;
      const { data, error } = await sb.rpc('whoami');
      if (error || !data) return false;
      return !!(data.is_platform_admin ||
                (data.leagues || []).length ||
                (data.scoring || []).length);
    } catch (_) { return false; }
  }

  function refuse(title, body) {
    /* Nothing of the scorer is left running underneath the notice: a paused
       app behind a panel is still an app, and its timers still publish. */
    try { window.EpinoiaSync && window.EpinoiaSync.halt(); } catch (_) {}
    refused = true;
    say('not your game', '#ff5f6b');
    bar.style.borderColor = 'rgba(255,95,107,.7)';
    bar.style.background = 'rgba(40,6,8,.94)';

    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483600', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:24px',
      'background:rgba(2,16,11,.97)',
      'font:400 14px/1.6 ui-sans-serif,system-ui,sans-serif', 'color:#e6fff1'
    ].join(';');
    const card = document.createElement('div');
    card.style.cssText = [
      'max-width:460px', 'width:100%', 'text-align:center',
      'border:1px solid rgba(147,242,191,.3)', 'border-radius:14px',
      'padding:26px 22px', 'background:rgba(4,16,11,.9)'
    ].join(';');
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:10px;color:#93f2bf';
    const p = document.createElement('div');
    p.textContent = body;
    p.style.cssText = 'color:rgba(230,255,241,.72);margin-bottom:18px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap';
    const mk = (label, href, primary) => {
      const a = document.createElement('a');
      a.href = href; a.textContent = label;
      a.style.cssText = 'text-decoration:none;border-radius:8px;padding:10px 15px;' +
        'font-size:13px;font-weight:600;' + (primary
          ? 'background:#93f2bf;color:#04100b'
          : 'border:1px solid rgba(147,242,191,.4);color:#93f2bf');
      return a;
    };
    row.appendChild(mk('open the demo instead', '?train=1', true));
    if (isFixture) {
      row.appendChild(mk('watch this game',
        '../game/?g=' + encodeURIComponent(gameId) + '&mode=supabase', false));
    }
    row.appendChild(mk('sign in', '../signin/?next=' +
      encodeURIComponent(location.pathname + location.search), false));
    card.append(h, p, row);
    wrap.appendChild(card);
    const mount = () => document.body.appendChild(wrap);
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    return false;
  }

  async function gateScorer() {
    /* The practice game is the one thing that needs no credentials at all. */
    if (TRAINING) return true;

    const sb = window.epinoiaClient && epinoiaClient();
    if (!sb) {
      return refuse('Scoring needs an account',
        'The scorer could not reach the sign-in service. The practice game ' +
        'works without one and writes nothing anywhere.');
    }

    if (isFixture) {
      let allowed = false;
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
          const { data, error } = await sb.rpc('may_score_game', { p_game: gameId });
          allowed = !error && data === true;
        }
      } catch (_) { allowed = false; }
      if (allowed) return true;
      return refuse('This fixture is not yours to score',
        'Scoring a real fixture needs a statistician assigned to it, or an ' +
        'administrator of its league. If that should be you, ask the league to ' +
        'add your email address to the game.');
    }

    /* No fixture named: this is the picker. It lists a league's games and
       loads one, so it needs the same standing the rail requires before it
       will even show the row. */
    if (await mayScoreSomething(sb)) return true;
    return refuse('Scoring is for assigned statisticians',
      'This account is not assigned to any fixture and does not administer a ' +
      'league, so there is nothing here for it to score. The practice game is ' +
      'open to everybody and writes nothing anywhere.');
  }

  async function start() {
    if (!(await gateScorer())) return;       // refused: nothing else is wired up

    /* THE DEMO GETS NO LEAGUE MACHINERY. ?train=1 is a practice game with two
       invented squads and nothing behind it, and it was still being handed the
       fixture picker — a dropdown of a real league's real games, on the one
       page explicitly open to anybody. The pickers also pull club rosters,
       which is a second thing the demo has no business fetching. */
    if (TRAINING) return;

    try { injectFixturePicker(); } catch (e) { console.warn('[picker]', e); }
    try { injectSquadPickers(); } catch (e) { console.warn('[squads]', e); }
    try { autoLoadFixture(); } catch (e) { console.warn('[fixture]', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* ---------------------------------------------------------------------- */
  if (TRAINING) setUpTraining();

  function setUpTraining() {
    /* TEN A SIDE. Five is a starting five and nothing else — a training game
       with six players cannot be substituted, which is half of what somebody
       is here to try. */
    const HOME = ['Ada Shaw', 'Kit Brand', 'Sol Maddox', 'Rae Fenwick', 'Ivo Marsh',
                  'Bea Okoro', 'Tam Sowerby', 'Niamh Blackwood', 'Rafe Underhill',
                  'Cleo Danforth'];
    const AWAY = ['Cass Vernon', 'Dane Hollis', 'Eli Barrow', 'Wren Castell',
                  'Otto Lynch', 'Juno Pike', 'Milo Ferrers', 'Sasha Quill',
                  'Bram Ashdown', 'Vita Crowe'];
    const NAMES = [HOME, AWAY];
    const LABELS = ['harbour blues', 'marble whites'];

    /* THE SETUP IS NOT A PLACE THIS MODE CAN GO. Training exists so somebody
       can see the scoring screen without an account; leaving a route back to
       the rosters turns it into a general-purpose scoring app with no fixture
       behind it, which is the branch that has to stay closed. So the back
       button on the starter picker is removed as it appears, and the setup
       screen is never shown again once the game has started. */
    const seal = () => {
      const back = document.getElementById('spBack');
      if (back) back.remove();
    };

    const fill = () => {
      const cards = document.querySelectorAll('.team-card');
      if (cards.length < 2) return false;
      cards.forEach((card, t) => {
        const nameIn = card.querySelector('.tname');
        if (!nameIn) return;
        nameIn.value = LABELS[t];
        /* The card opens with five empty rows. Filling those first and only
           then adding more leaves exactly ten — the earlier version added ten
           on top and left five blanks behind, which startGame() skips but
           which are still five rows of nothing sitting in the sheet. */
        const add = card.querySelector('.addP');
        NAMES[t].forEach((who, i) => {
          let rows = card.querySelectorAll('.rrow');
          let row = rows[i];
          if (!row) {
            add && add.click();
            rows = card.querySelectorAll('.rrow');
            row = rows[rows.length - 1];
          }
          if (!row) return;
          const n = row.querySelector('.rname'), num = row.querySelector('.rnum');
          if (n) { n.value = who; n.dispatchEvent(new Event('input', { bubbles: true })); }
          if (num) { num.value = String(4 + i); num.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      });
      const go = document.getElementById('goGame');
      if (!go) return false;
      go.click();
      return true;
    };

    /* STRAIGHT TO THE GAME. Pressing "go into game" lands on the starting-five
       picker, which is a screen about a decision somebody has not been asked
       to make yet. The first five of ten are already selected by the picker
       itself, so the sensible default is one more click — and this makes it,
       rather than leaving a stranger on a screen whose purpose they have to
       work out. Driven through the real buttons, so training cannot drift
       away from the live app the way a second code path would. */
    const enter = () => {
      seal();
      const go = document.getElementById('spGo');
      if (!go) return false;
      go.click();
      return !document.getElementById('startersview') ||
             document.getElementById('startersview').classList.contains('hidden');
    };

    /* The setup screen is built by the page's own script, which may not have
       run yet. Poll briefly for each step, then stop rather than spin. */
    let tries = 0;
    const step = (fn, next) => {
      const tick = () => {
        if (fn()) { if (next) next(); return; }
        if (++tries > 60) return;
        setTimeout(tick, 80);
      };
      tick();
    };
    step(fill, () => { tries = 0; step(enter, seal); });

    /* and if anything ever puts the setup screen back, it does not stay */
    const guard = new MutationObserver(() => {
      seal();
      const setup = document.getElementById('setup');
      if (setup && !setup.classList.contains('hidden') &&
          document.getElementById('game') &&
          !document.getElementById('game').classList.contains('hidden')) {
        setup.classList.add('hidden');
      }
    });
    if (document.body) guard.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded',
      () => guard.observe(document.body, { childList: true, subtree: true }));
  }
})();
