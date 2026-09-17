'use strict';
/* ============================================================================
   DRAW DISTANCE — the page comes out of the distance at the edge of the screen.

   Not a reveal. There is no notion of a section here, nothing waits its turn
   and nothing pops: the top and bottom edges of the VIEWPORT hold a band of
   the page's own background that fades to nothing, so whatever is arriving —
   a fixture card, the middle of a paragraph, half a table row — comes out of
   it as you scroll and sinks back into it behind you. Like a draw distance in
   a game, it is a property of the screen rather than of the thing being drawn.

   WHY THIS IS TWO FIXED DIVS AND NOT A MASK. A mask on the scrolling element
   would be the obvious way to do it, and it is anchored to the element's own
   box rather than to the viewport — so on a page that scrolls the document it
   fades the top and bottom of the DOCUMENT, once, and never again. Anchoring
   the fade to the viewport means something fixed to the viewport, and two
   pointer-events:none gradients cost nothing to composite: no layout, no
   repaint of the content underneath, no work per element on the page.

   NOTHING IS EVER HIDDEN. Both bands are decoration painted OVER the content,
   at a z-index below the rail and the phone's bar. Every word stays in the
   document, in the accessibility tree, and findable by the browser's own find
   — which is the failure this replaces: fading blocks out by opacity meant a
   browser that stopped painting left the page blank.

   THE FADE AT EITHER END GOES AWAY. There is no draw distance where there is
   nothing to draw: at the top of the page the top band is gone, at the bottom
   the bottom band is, and a page shorter than the window has neither. That is
   the difference between a haze and a vignette somebody forgot to turn off.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaHaze = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* How much scrolling it takes for a band to come fully in. Short enough that
   it is there by the time anything has moved a card's height, long enough that
   nudging the page a few pixels does not flash it on. */
const RAMP = 150;

function clamp01(n) { return n < 0 ? 0 : (n > 1 ? 1 : n); }

function mount() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !doc.body) return { update: function () {}, stop: function () {} };

  /* the water splash is its own full-screen thing and owns its edges */
  if (doc.documentElement.classList.contains('m-splash')) {
    return { update: function () {}, stop: function () {} };
  }

  const make = (side) => {
    const n = doc.createElement('div');
    n.className = 'ep-haze ' + side;
    n.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(n);
    return n;
  };
  const top = make('top');
  const bottom = make('bottom');

  const view = () => (root.innerHeight || doc.documentElement.clientHeight || 0);
  const height = () => Math.max(
    doc.documentElement.scrollHeight || 0,
    doc.body ? doc.body.scrollHeight || 0 : 0);
  const at = () => (root.pageYOffset != null ? root.pageYOffset
                                             : doc.documentElement.scrollTop || 0);

  function update() {
    const vh = view();
    const room = height() - vh;              // how much there is to scroll
    if (room <= 4) {                         // a page that fits: no distance
      top.style.opacity = '0';
      bottom.style.opacity = '0';
      return;
    }
    const y = at();
    top.style.opacity = String(clamp01(y / RAMP));
    bottom.style.opacity = String(clamp01((room - y) / RAMP));
  }

  /* ONE UPDATE PER FRAME. A scroll fires far more often than the screen is
     drawn, and each update is two style writes — cheap, but there is no point
     doing it five times between frames. */
  let queued = false;
  function ping() {
    if (queued) return;
    queued = true;
    const run = () => { queued = false; update(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  root.addEventListener('scroll', ping, { passive: true });
  root.addEventListener('resize', ping, { passive: true });

  /* THE PAGE GROWS AFTER IT LOADS. Every screen here renders from the network,
     so the bottom band has to be told when the document gets taller — the
     reader has not scrolled, but there is suddenly something below them. */
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(ping);
    try { ro.observe(doc.documentElement); } catch (_) { ro = null; }
  }
  const beats = ro ? [] : [250, 900, 2500].map(ms => setTimeout(ping, ms));

  update();

  return {
    update: update,
    stop: function () {
      root.removeEventListener('scroll', ping);
      root.removeEventListener('resize', ping);
      if (ro) ro.disconnect();
      beats.forEach(t => clearTimeout(t));
      top.remove();
      bottom.remove();
    }
  };
}

/* SELF-MOUNTING FROM THE MARKUP: <body data-haze>. Every page here runs under
   script-src 'self' with no inline scripts, so the alternative is a line in
   whichever module the page happens to load — three files, one of them per
   league. An attribute on the body keeps the decision in the page. */
if (typeof document !== 'undefined') {
  const boot = function () {
    if (document.body && document.body.hasAttribute('data-haze')) mount();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else boot();
}

return { mount, RAMP };
}));
