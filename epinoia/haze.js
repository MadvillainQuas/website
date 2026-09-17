'use strict';
/* ============================================================================
   DRAW DISTANCE — content comes up out of nothing at the edge of the screen.

   Not a reveal, and not a section at a time: whatever is arriving at the near
   edge — a fixture card, a club, a heading, a row — rises out of nothing,
   settles as it crosses into the middle of the screen, and recedes at the far
   edge. Scroll back and it runs backwards. Where a block begins and a section
   ends has nothing to do with it; the edge of the screen decides.

   THE ANIMATION IS NOT IN HERE. It is a scroll-driven CSS animation
   (kit/haze.css) whose clock is the scroll position, so the compositor runs it
   and this file never sees a frame. All this does is decide WHAT counts as a
   block and mark it, which is the one part a stylesheet cannot do.

   WHAT COUNTS AS A BLOCK: something that fits comfortably on the screen.
   Anything taller can never be wholly inside it, so fading by position would
   leave it permanently half-lit — so this walks down through what is too tall
   until it reaches pieces that do fit. That is how a long fixture list ends up
   fading a card at a time instead of as one slab.

   AN EARLIER VERSION PAINTED TWO GRADIENT BARS over the top and bottom of the
   viewport instead. Cheap, and wrong: on a light theme it reads as a white
   strip across the screen and nothing appears to come out of anything. The
   fade belongs to the content.

   NOTHING HERE CAN COST SOMEBODY THE PAGE:
     · a browser without scroll-driven animations matches no rule and shows
       everything, marks and all;
     · prefers-reduced-motion is excluded in the stylesheet;
     · and if the browser never produces a frame at all — a window that has
       stopped painting, a tab never brought to the front — the mark comes off
       the document after a second and a half and the page is left as if none
       of this had loaded. Not hypothetical: it is how the first version of
       this was caught.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaHaze = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* A block has to fit in this much of the screen to be faded as one thing. */
const FITS = 0.72;

/* How far down to look for blocks. Deep enough for section → mount → card,
   shallow enough that this is never a walk of the whole document. */
const DEPTH = 5;

/* Never faded: the furniture, and anything that says so for itself. Fixed and
   sticky elements are excluded in code — they do not travel with the page, so
   a scroll-driven fade would hold them at whatever frame they started on. */
const NEVER = '.ep-nav, .ep-rail, .ep-bottom, .ep-drawer, .ep-tabbar, .hz-never, [data-haze="off"]';

/* The most blocks one page will mark. A season's fixture list is long and
   there is nothing to be gained marking the six hundredth card. */
const CAP = 400;

function mount(opts) {
  const o = opts || {};
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !doc.body) return { refresh: function () {}, stop: function () {}, marked: () => [] };

  /* the water splash is its own full-screen thing and owns its edges */
  if (doc.documentElement.classList.contains('m-splash')) {
    return { refresh: function () {}, stop: function () {}, marked: () => [] };
  }

  const host = (typeof o.root === 'string' ? doc.querySelector(o.root) : o.root) || doc.body;
  const marked = [];
  let blind = false;

  const view = () => (root.innerHeight || doc.documentElement.clientHeight || 0);
  const tall = n => (n.getBoundingClientRect ? n.getBoundingClientRect().height : 0);

  function still(n) {
    try {
      const p = root.getComputedStyle ? root.getComputedStyle(n).position : '';
      return p === 'fixed' || p === 'sticky';
    } catch (_) { return false; }
  }

  function walk(node, depth, limit) {
    if (depth > DEPTH || marked.length >= CAP) return;
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.closest && n.closest(NEVER)) continue;
      const h = tall(n);
      if (!h) continue;                       // not laid out, or hidden
      if (h <= limit) {
        if (!n.classList.contains('hz') && !still(n)) { n.classList.add('hz'); marked.push(n); }
        continue;
      }
      /* NOT "already marked, move on". A block marked when it was small and
         since grown past the screen -- a fixture list before and after its
         fixtures land -- has to be descended into now, or its cards are never
         faded and it sits there half-lit instead. The pass below takes the
         fade off the container itself. */
      /* too tall to fade as one thing: fade the pieces inside it instead, and
         if it has no pieces, leave it alone rather than dim a whole screen */
      if (n.children && n.children.length) walk(n, depth + 1, limit);
    }
  }

  function pass() {
    if (blind) return;
    const limit = view() * FITS;
    if (limit <= 0) return;
    walk(host, 1, limit);
    /* a block that has grown past the screen since it was marked stops being
       faded rather than sitting half-lit for ever */
    for (let i = 0; i < marked.length; i++) {
      marked[i].classList.toggle('hz-tall', tall(marked[i]) > limit);
    }
  }

  /* ONE PASS PER FRAME. These pages render in bursts from the network; each
     burst is a single pass rather than one per appended node. */
  let queued = false;
  function refresh() {
    if (queued || blind) return;
    queued = true;
    const run = () => { queued = false; pass(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  const mo = typeof MutationObserver === 'function' ? new MutationObserver(refresh) : null;
  if (mo) mo.observe(host, { childList: true, subtree: true });
  root.addEventListener('resize', refresh, { passive: true });

  doc.documentElement.classList.add('hz-on');
  pass();

  /* THE NET. A scroll timeline is driven by the browser drawing; one that has
     stopped drawing holds every marked block on its first frame, which below
     the fold is opacity 0 — a blank page. If no frame has been produced by the
     time the page has had a second and a half, the mark comes off and every
     rule in the stylesheet stops applying. It does not come back: a page that
     reads plainly is worth more than an effect. */
  let framed = false;
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { framed = true; });
  const net = setTimeout(function () {
    if (framed) return;
    blind = true;
    if (mo) mo.disconnect();
    doc.documentElement.classList.remove('hz-on');
  }, 1500);

  return {
    refresh: refresh,
    marked: () => marked.slice(),
    stop: function () {
      clearTimeout(net);
      if (mo) mo.disconnect();
      root.removeEventListener('resize', refresh);
      marked.forEach(n => n.classList.remove('hz', 'hz-tall'));
      marked.length = 0;
      doc.documentElement.classList.remove('hz-on');
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

return { mount, FITS, DEPTH, CAP };
}));
