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
  const ROOM_KEY = 'courtside.scratchGame';

  let gameId = qp.get('g');
  let mode = qp.get('mode');

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
  mode = mode || (window.courtsideMode ? window.courtsideMode() : 'local');

  // the distinctive tail, not the prefix — "scratch-" identifies nothing
  const shortId = gameId.replace(/^scratch-/, '').slice(0, 8);

  const viewerUrl = new URL('../game/', location.href);
  viewerUrl.searchParams.set('g', gameId);
  viewerUrl.searchParams.set('mode', mode);

  /* ---------------------------------------------------------------- badge --- */
  /* Deliberately unobtrusive and out of the way of every control: the scorer's
     buttons reach the screen edges on mobile, and a mis-tap here costs a stat. */
  const bar = document.createElement('div');
  bar.id = 'cs-livebar';
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

  /* --------------------------------------------------------------- attach --- */
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
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

    if (!window.CourtsideSync) { say('sync.js missing', '#ff5f6b'); return; }
    const sb = (mode === 'supabase' && window.courtsideClient) ? window.courtsideClient() : null;
    if (mode === 'supabase' && !sb) {
      say('no supabase client — local only', '#ff5f6b');
      mode = 'local';
    }

    try {
      window.CourtsideSync.attach({ gameId, mode, supabase: sb });
      say((mode === 'local' ? 'local · ' : 'live · ') + shortId, '#93f2bf');
    } catch (e) {
      console.error('[bootstrap]', e);
      say('attach failed', '#ff5f6b');
    }

    /* pending count is the honest health signal: if frames stop draining the
       scorer keeps working but the viewer is behind, and that must be visible */
    setInterval(() => {
      const st = window.CourtsideSync.status();
      if (st.pending > 12) say('buffering ' + st.pending, '#ffd166');
      else say((mode === 'local' ? 'local · ' : 'live · ') + shortId, '#93f2bf');
    }, 3000);
  }, 500);
})();
