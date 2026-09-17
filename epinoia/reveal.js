'use strict';
/* ============================================================================
   REVEAL ON SCROLL — the page arrives as you come to it, and stands down
   behind you.

   A block fades and lifts into place as it enters the viewport, and fades back
   out as it leaves, in the direction it left by: what you scrolled past sinks
   upward, what is still coming waits below. Scroll back and it comes in again.

   THREE RULES THIS FOLLOWS, BECAUSE REVEAL ANIMATIONS USUALLY BREAK ONE:

   1. NOTHING IS HIDDEN UNTIL WE KNOW WE CAN SHOW IT AGAIN. The hiding is done
      by CSS that only bites under html.rv-on, and that class is set from here,
      after the observer exists. If this file fails to parse, fails to load, or
      the browser has no IntersectionObserver, every block is simply visible —
      a broken animation must never cost somebody the page. And if the observer
      exists but is never CALLED — a window that has stopped painting, a tab
      never brought to the front — a net a second and a half in shows
      everything anyway (see it below; it is the one part of this worth being
      paranoid about).

   2. LAYOUT NEVER MOVES. Only opacity and transform change, so a fixture list
      does not reflow as it fades, the scrollbar does not jump, and an anchor
      still lands where it should. Nothing is display:none, so browser find,
      screen readers and ctrl-F keep working on text that happens to be dimmed.

   3. REDUCED MOTION MEANS NO MOTION. The kit already flattens durations
      globally, but a block that fades to nothing in 0.01ms is worse than one
      that never fades, so under prefers-reduced-motion this does not run at
      all and html.rv-on is never set.

   PAGES FILL THEMSELVES LATE. Every screen here renders from the network —
   sections appear seconds after the first paint — so a one-shot pass at load
   would animate an empty page. A MutationObserver picks up whatever arrives
   and the new blocks join in, debounced to one pass per frame so a list that
   appends 200 rows does not run 200 passes.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReveal = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* How far into the viewport a block has to come before it counts as arrived.
   A block is revealed once any part of it is 6% inside the frame: at the very
   edge feels late on a phone, where a card is most of the screen. */
const MARGIN = '-6% 0px -6% 0px';

/* Blocks nobody should ever fade: the ones that are furniture rather than
   content, and anything that has said for itself that it opts out. */
const NEVER = '.ep-nav, .ep-rail, .ep-bottom, .ep-drawer, .rv-never, [data-rv="off"]';

function reduced() {
  try {
    return typeof matchMedia === 'function' &&
           matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { return false; }
}

function usable() {
  return typeof IntersectionObserver === 'function' &&
         typeof document !== 'undefined' && !reduced();
}

function mount(opts) {
  const o = opts || {};
  const host = (typeof o.root === 'string' ? document.querySelector(o.root) : o.root) ||
               document.body;
  const selector = o.selector;
  if (!host || !selector || !usable()) return { refresh: function () {}, stop: function () {} };

  const seen = new WeakSet();
  const enrolled = [];
  let settled = false;      // has the browser ever told us where anything is?
  let blind = false;        // ...and did we give up waiting?

  const io = new IntersectionObserver(function (entries) {
    settled = true;
    entries.forEach(function (e) {
      const n = e.target;
      if (e.isIntersecting) {
        n.classList.add('rv-in');
        n.classList.remove('rv-above', 'rv-below');
        return;
      }
      /* WHICH WAY IT WENT. A block that left over the top is behind the
         reader and lifts away; one still below the fold waits underneath.
         Getting this from the rectangle rather than from a scroll listener
         keeps it right when the page is scrolled by a link, a keyboard, or a
         phone's momentum. */
      const above = e.boundingClientRect.bottom <= (e.rootBounds ? e.rootBounds.top : 0) + 1;
      n.classList.remove('rv-in');
      n.classList.add(above ? 'rv-above' : 'rv-below');
    });
  }, { rootMargin: MARGIN, threshold: 0 });

  function pass() {
    const list = host.querySelectorAll(selector);
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (seen.has(n) || (n.closest && n.closest(NEVER))) continue;
      seen.add(n);
      enrolled.push(n);
      n.classList.add('rv');
      if (blind) n.classList.add('rv-in');
      io.observe(n);
    }
  }

  /* THE SAFETY NET, and the reason rule 1 at the top is not just a comment.

     An observer that is never called leaves every block at opacity 0 — a blank
     page. It should not happen, but it does: a window the compositor has
     stopped painting, a tab that has never been foregrounded, a headless
     renderer taking a screenshot. All of those also stop rendering updates,
     which is what IntersectionObserver delivers on.

     So: if nothing has been reported by the time the page has had a second and
     a half, show everything and keep watching. If the browser wakes up and
     starts reporting, the normal behaviour resumes on the next scroll — the
     observer was never disconnected. The cost of being wrong here is one page
     that does not animate; the cost of not doing it is one page nobody can
     read. */
  setTimeout(function () {
    if (settled) return;
    blind = true;
    enrolled.forEach(function (n) { n.classList.add('rv-in'); });
  }, 1500);

  /* ONE PASS PER FRAME. Rendering appends in bursts; each burst is a single
     pass, and a burst that lands mid-frame waits for the next one. */
  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; pass(); });
  }

  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(refresh) : null;
  if (mo) mo.observe(host, { childList: true, subtree: true });

  document.documentElement.classList.add('rv-on');
  pass();

  return {
    refresh: refresh,
    stop: function () {
      io.disconnect();
      if (mo) mo.disconnect();
      document.documentElement.classList.remove('rv-on');
    }
  };
}

/* The usual call: mount once the document is ready, on a selector the page
   chooses. Pages differ in what a "block" is, so nothing is assumed here. */
function auto(selector, opts) {
  const start = function () { mount(Object.assign({ selector: selector }, opts || {})); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
}

/* SELF-MOUNTING FROM THE MARKUP: <body data-reveal=".sec, .hm-foot">. Every
   page here is under a script-src 'self' policy with no inline scripts, so a
   page that wants this would otherwise have to add a line to whichever module
   it happens to load — three different files, one of them per league. An
   attribute on the body keeps the decision where the blocks are. */
if (typeof document !== 'undefined') {
  const boot = function () {
    const sel = document.body && document.body.getAttribute('data-reveal');
    if (sel) auto(sel);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else boot();
}

return { mount, auto, usable, reduced };
}));
