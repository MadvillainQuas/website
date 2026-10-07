'use strict';
/* ============================================================================
   HOME - MAIN | VIDEO, the strip under ON THIS PAGE.

   MAIN is the page as it always was. VIDEO puts the black VIDEO view (videohub.js) in the place of everything under the
   strip: the page's sections fade and sink away, the view rises in, and the strip itself, the hero and ON THIS PAGE
   stay where they are (nav.js holds ON THIS PAGE still while html.vh-on is set, or its list would empty with the
   sections). MAIN brings it all back the same way, and the VIDEO view is taken down (its players stop, its reads end).

   LIGHT: the strip's own code is this file. VIDEO's code and its styles (videohub.js, kit/videohub.css) arrive with the
   first press; until then the only cost is one small read when the page is idle (live_streams, 0242), which lights the
   LIVE mark on the tab when a game is streaming.

   THE ADDRESS says which: ?view=video. A press adds a step to the history, so the browser's Back returns to MAIN; an
   address with ?view=video opens on VIDEO. A press on an entry of ON THIS PAGE while VIDEO is open goes back to MAIN
   first, then to the section.
   ============================================================================ */
(function () {
  const strip = document.getElementById('hmModes');
  const hub = document.getElementById('videoHub');
  if (!strip || !hub) return;
  const frame = strip.parentElement;
  const tabs = [...strip.querySelectorAll('.hm-mode')];
  const bar = strip.querySelector('.hm-modes-bar');
  const liveMark = strip.querySelector('.hm-mode-live');
  const me = document.currentScript || document.querySelector('script[src*="vhmode.js"]');
  const STAMP = (/[?&]v=(\d+)/.exec((me && me.src) || '') || [])[1] || '';
  const withStamp = p => p + (STAMP ? '?v=' + STAMP : '');
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let mode = 'main', busy = false, loading = null;

  /* everything under the strip but the VIDEO view: the page's sections and whatever follows them */
  const mainParts = () => [...frame.children].filter(n => n !== strip && n !== hub
    && (strip.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) && !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(n.tagName));

  /* the bar slides under the chosen tab */
  function place() {
    const t = tabs.find(x => x.dataset.mode === mode);
    if (!t || !bar) return;
    bar.style.width = t.offsetWidth + 'px';
    bar.style.transform = 'translateX(' + t.offsetLeft + 'px)';
  }
  function mark() {
    tabs.forEach(t => { const on = t.dataset.mode === mode; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    strip.dataset.mode = mode;
    place();
  }

  /* VIDEO's code and styles, once, both loaded before it opens (no unstyled flash) */
  function load() {
    if (loading) return loading;
    const css = new Promise(res => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = withStamp('../kit/videohub.css');
      l.onload = res; l.onerror = res;
      document.head.appendChild(l);
    });
    const js = new Promise((res, rej) => {
      if (window.EpinoiaVideoHub) return res();
      const s = document.createElement('script');
      s.src = withStamp('videohub.js'); s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    loading = Promise.all([css, js]).then(() => window.EpinoiaVideoHub);
    loading.catch(() => { loading = null; });
    return loading;
  }

  function address(to) {
    try {
      const u = new URL(location.href);
      if (to === 'video') u.searchParams.set('view', 'video'); else u.searchParams.delete('view');
      u.hash = '';
      history.pushState({ hmView: to }, '', u.toString());
    } catch (_) { /* the view still changes */ }
  }

  /* MAIN <-> VIDEO. how: { instant (no animation: an address that opens on VIDEO, a jump), push (false: the history is
     already where it should be) } */
  async function set(to, how) {
    const o = how || {};
    if (to === mode || busy) return;
    busy = true;
    const from = mode;
    mode = to;
    mark();
    const quick = o.instant || reduced();
    const parts = mainParts();
    try {
      if (to === 'video') {
        strip.classList.add('is-loading');
        let api;
        try { api = await load(); } catch (_) { api = null; }
        strip.classList.remove('is-loading');
        if (!api) { mode = from; mark(); return; }
        document.documentElement.classList.add('vh-on');
        if (!quick) { parts.forEach(n => n.classList.add('vh-out')); await wait(260); }
        parts.forEach(n => { n.classList.remove('vh-out'); n.classList.add('vh-gone'); });
        hub.hidden = false;
        if (!quick) hub.classList.add('vh-in');
        Promise.resolve(api.open(hub, { base: '../' })).catch(() => {});
        const top = strip.getBoundingClientRect().top + window.scrollY - 8;
        if (window.scrollY > top || o.instant) window.scrollTo({ top, behavior: quick ? 'auto' : 'smooth' });
        setTimeout(() => hub.classList.remove('vh-in'), 700);
      } else {
        if (window.EpinoiaVideoHub) window.EpinoiaVideoHub.close();
        if (!quick) { hub.classList.add('vh-out'); await wait(240); hub.classList.remove('vh-out'); }
        hub.hidden = true;
        hub.textContent = '';
        parts.forEach(n => n.classList.remove('vh-gone'));
        document.documentElement.classList.remove('vh-on');
        if (!quick) { parts.forEach(n => n.classList.add('vh-in')); setTimeout(() => parts.forEach(n => n.classList.remove('vh-in')), 700); }
      }
      if (o.push !== false) address(to);
    } finally { busy = false; }
  }

  tabs.forEach(t => t.addEventListener('click', () => set(t.dataset.mode)));
  /* the arrow keys move between the two tabs, as a tab list's do */
  strip.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.findIndex(t => t.dataset.mode === mode), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus();
    set(n.dataset.mode);
  });
  window.addEventListener('popstate', () => {
    const want = new URLSearchParams(location.search).get('view') === 'video' ? 'video' : 'main';
    set(want, { push: false });
  });
  /* an entry of ON THIS PAGE pressed while VIDEO is open: MAIN first (at once), and nav.js takes the reader to it */
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('.tt-index a[href^="#"]') : null;
    if (a && mode === 'video') set('main', { instant: true });
  }, true);
  window.addEventListener('resize', place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place).catch(() => {});
  mark();
  if (new URLSearchParams(location.search).get('view') === 'video') set('video', { instant: true, push: false });

  /* THE LIVE MARK, on the VIDEO tab: LIT while a game is streaming (one you can watch in VIDEO's LIVE), UNLIT while
     none is. One small read when the page is idle, again every two minutes while the page is seen, and whenever the VIDEO
     view reads its LIVE (setLive). A database without 0242 answers nothing: the mark stays unlit. */
  function setLive(n) {
    if (!liveMark) return;
    const on = n > 0;
    liveMark.dataset.on = on ? '1' : '0';
    liveMark.lastChild.textContent = n > 1 ? 'Live · ' + n : 'Live';
    liveMark.title = on ? (n > 1 ? n + ' games streaming now' : 'A game is streaming now') : 'Nothing live right now';
    place();
  }
  function probe() {
    const c = window.EPINOIA_CONFIG;
    if (!c || !c.supabaseUrl || !liveMark || document.hidden) return;
    fetch(c.supabaseUrl + '/rest/v1/rpc/live_streams', { method: 'POST', cache: 'no-store',
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + c.supabaseAnonKey, 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => (r.ok ? r.json() : null))
      .then(list => setLive(Array.isArray(list) ? list.length : 0))
      .catch(() => {});
  }
  if ('requestIdleCallback' in window) requestIdleCallback(probe, { timeout: 4000 }); else setTimeout(probe, 2500);
  setInterval(() => { if (mode === 'main') probe(); }, 120000);   // VIDEO open: its own LIVE read sets the mark
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'main') probe(); });
  window.EpinoiaHomeModes = { set, setLive, mode: () => mode };
})();
