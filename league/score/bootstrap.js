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

  /* ------------------------------------------------------ legend clearance --- */
  /* #cols reserves a flat 52px for the fixed gesture legend, but the legend is
     150px tall on a narrow phone once its text wraps — so the bottom of the
     player columns ends up underneath it. Measuring the element is the only
     way to reserve the right amount, because the height depends on wrapping.
     Its top 96px is a transparent gradient, so only the remainder hides
     anything. Publishes --cs-legend-h for the stylesheet to use. */
  (function trackLegend() {
    const mount = () => {
      const el = document.getElementById('ctrlHelp');
      if (!el) return false;
      const apply = () => {
        const h = el.offsetHeight;                       // 0 when display:none (desktop)
        const opaque = h > 0 ? Math.max(0, h - 96) : 0;  // minus the gradient lead-in
        document.documentElement.style.setProperty('--cs-legend-h', opaque + 'px');
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
  /* A real fixture has a uuid; a scratch room does not, and there is nothing
     on the server to finalise for one. */
  const isFixture = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId);

  async function finaliseGame(btn, note) {
    const CFG = window.COURTSIDE_CONFIG;
    const sb = window.courtsideClient && courtsideClient();
    if (!sb) { note('No Supabase client — cannot finalise.', '#ff5f6b'); return; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      note('Sign in first — open /league/app/ in another tab, then try again.', '#ffd166');
      return;
    }

    btn.disabled = true;
    note('pushing the event log…', '#ffd166');

    /* Push whatever the buffer still holds, then give the upserts a moment to
       land. Finalising against a partial log would produce a box score that
       silently disagrees with what was scored. */
    try { window.CourtsideSync && window.CourtsideSync.flush(); } catch (_) {}
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
        try { window.CourtsideSync && window.CourtsideSync.flush(); } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      btn.disabled = false;
      note('could not verify the log: ' + (e.message || e), '#ff5f6b');
      return;
    }

    note('finalising…', '#ffd166');
    try {
      const r = await fetch(CFG.supabaseUrl + '/functions/v1/finalise-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: CFG.supabaseAnonKey,
          Authorization: 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ gameId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        btn.disabled = false;
        note('refused: ' + (j.error || r.status), '#ff5f6b');
        return;
      }
      note('final — the box score is public', '#93f2bf');
      btn.textContent = 'finalised ✓';
      try { window.CourtsideSync && window.CourtsideSync.finalise(); } catch (_) {}
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
