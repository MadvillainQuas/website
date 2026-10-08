'use strict';
/* ============================================================================
   THE STAMP, ON SCREEN (EPINOIA GO, Louie 2026-10-08): the moment a fan stamps an arena, the screen dims, the
   stamp comes down on it - the arena's name in a double-ruled plate, set at a slant, a ring of ink and a burst of
   the kit's colours where it lands, the screen giving a little - and under it "ARENA TICKED OFF ✓", their arenas
   and stamps so far, and "a new arena" the first time. A phone that can buzz buzzes. It goes by itself after a few
   seconds, or at a tap, a click or Escape.

     EpinoiaStampFx.play({ venue, city, at, first, arenas, stamps })   -> Promise, settled when it has gone

   One module for every place a stamp is made: the GO page (go.js), STAMP THIS GAME on a game's and a club's page
   (venuestamp.js). With reduced motion asked for, it fades in and out and nothing flies. Words as text (i18n).
   ============================================================================ */
(function (root) {
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const COLOURS = ['#93f2bf', '#8ff5ff', '#ffe14d', '#ff5f6b', '#c7a6ff', '#ffffff'];
  let live = null;

  function dayText(iso) {
    const ms = Date.parse(iso);
    const loc = (root.EpinoiaI18n && root.EpinoiaI18n.locale) || undefined;
    try { return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric' }).format(isFinite(ms) ? ms : Date.now()); }
    catch (_) { return ''; }
  }

  function play(o) {
    const x = o || {};
    if (typeof document === 'undefined' || !document.body) return Promise.resolve();
    if (live) live.close();
    const calm = reduced();
    const fx = el('div', 'gsx' + (calm ? ' calm' : ''));
    fx.setAttribute('role', 'status');
    fx.setAttribute('aria-live', 'assertive');
    const stage = fx.appendChild(el('div', 'gsx-stage'));
    /* where it lands: the ring of ink, the burst */
    const ring = stage.appendChild(el('span', 'gsx-ring'));
    ring.setAttribute('aria-hidden', 'true');
    const burst = stage.appendChild(el('span', 'gsx-burst'));
    burst.setAttribute('aria-hidden', 'true');
    if (!calm) {
      for (let i = 0; i < 22; i++) {
        const b = burst.appendChild(el('i'));
        const a = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.4, d = 120 + Math.random() * 140;
        b.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
        b.style.setProperty('--dy', Math.round(Math.sin(a) * d) + 'px');
        b.style.setProperty('--r', Math.round(Math.random() * 360) + 'deg');
        b.style.setProperty('--c', COLOURS[i % COLOURS.length]);
        b.style.setProperty('--s', (5 + Math.round(Math.random() * 6)) + 'px');
      }
    }
    /* the stamp itself */
    const plate = stage.appendChild(el('div', 'gsx-plate'));
    plate.appendChild(el('span', 'gsx-k', 'stamped'));
    plate.appendChild(data('span', 'gsx-v', x.venue || 'EPINOIΛ GO'));
    const sub = [x.city, dayText(x.at)].filter(Boolean).join(' · ');
    if (sub) plate.appendChild(data('span', 'gsx-d', sub));
    /* what it means */
    const after = stage.appendChild(el('div', 'gsx-after'));
    const tick = after.appendChild(el('span', 'gsx-tick'));
    tick.appendChild(el('span', null, 'arena ticked off'));
    tick.appendChild(el('b', null, ' ✓'));
    if (x.first) after.appendChild(el('span', 'gsx-new', 'a new arena'));
    if (x.arenas != null || x.stamps != null) {
      const n = after.appendChild(el('span', 'gsx-n'));
      if (x.arenas != null) { n.appendChild(el('span', null, 'Arenas')); n.appendChild(data('b', null, String(x.arenas))); }
      if (x.stamps != null) { n.appendChild(el('span', null, 'Stamps')); n.appendChild(data('b', null, String(x.stamps))); }
    }
    after.appendChild(el('span', 'gsx-tap', 'tap to carry on'));
    document.body.appendChild(fx);
    try { if (!calm && root.navigator && typeof root.navigator.vibrate === 'function') root.navigator.vibrate([18, 40, 70]); } catch (_) { /* no buzz */ }

    return new Promise(resolve => {
      let done = false, timer = 0;
      const close = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener('keydown', key, true);
        fx.classList.add('out');
        setTimeout(() => { fx.remove(); if (live === handle) live = null; resolve(); }, calm ? 200 : 420);
      };
      const key = e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } };
      const handle = { close };
      live = handle;
      requestAnimationFrame(() => fx.classList.add('on'));
      fx.addEventListener('click', close);
      document.addEventListener('keydown', key, true);
      timer = setTimeout(close, x.holdMs || 3800);
    });
  }

  root.EpinoiaStampFx = { play };
})(typeof window !== 'undefined' ? window : globalThis);
