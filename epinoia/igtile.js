'use strict';
/* ============================================================================
   AN INSTAGRAM POST, AT THE SIZE OF A CARD.

   Two places spotlight posts — the league's Socials section under Merchandise,
   and a club's own strip under the venue photograph — and both built the same
   sandboxed iframe by hand, with the same grid, and both got the size wrong the
   same way: `repeat(auto-fit, minmax(250px, 1fr))`. auto-fit collapses the
   empty tracks and 1fr then hands the whole row to whatever is left, so a
   league spotlighting ONE post got that post at the full width of the page —
   about 1560px on a desktop, a phone screenshot blown up past legibility. The
   clubs grid two sections above had already solved this: cap the track and
   justify to start, so four cards stay four card-sized cards on a 2000px
   screen. This is that fix, once, for both.

   WHY THE FRAME IS SCALED RATHER THAN NARROWED. Instagram's /embed page lays
   itself out at a minimum of about 326px; give the iframe less and the post
   does not shrink, it gets cut off down the right-hand side. So the frame is
   always rendered at its natural 326px and then scaled to whatever the tile is
   — the tile can be team-card size without Instagram ever knowing it is small.
   ResizeObserver keeps the factor right through a window resize or a sidebar
   opening, which a media query alone cannot do because the number that matters
   is the tile's width, not the viewport's.

   IFRAMES, NOT THEIR SCRIPT — the reason, unchanged from socials.js: the
   official embed wants //www.instagram.com/embed.js on every page, which sets
   cookies, reads the page and can be changed by somebody else at any time.
   /embed is the same content in a sandbox and costs one frame-src entry.

   The trade is that a frame cannot tell us it failed: a deleted post or a
   account gone private renders as a blank white panel with no event to catch.
   Nothing here can fix that, so neither caller pretends otherwise.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaIgTile = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* The frame's own size. WIDTH is Instagram's practical minimum — below it the
   embed clips rather than reflows. HEIGHT is chosen to clear the header and a
   portrait image; the caption below that is Instagram's to clip, and it does,
   because these frames carry scrolling="no". Both are mirrored by the
   aspect-ratio on .ig-tile in kit/card.css and must be changed together. */
const W = 326, H = 470;

/* Shortcodes arrive out of the database already reduced to [A-Za-z0-9_-]. This
   checks again rather than trusting it: the value goes into an iframe src, and
   one place doing the validating is one place to get it wrong. */
const CODE_OK = /^[A-Za-z0-9_-]{4,32}$/;

function tile(code, extraClass) {
  if (!CODE_OK.test(String(code || ''))) return null;

  const box = document.createElement('div');
  box.className = 'ig-tile' + (extraClass ? ' ' + extraClass : '');

  const f = document.createElement('iframe');
  f.src = 'https://www.instagram.com/p/' + code + '/embed';
  f.loading = 'lazy';
  f.title = 'Instagram post';
  /* No allow-same-origin: the frame has no business reading anything of ours,
     and the embed does not need it to render. */
  f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('scrolling', 'no');
  box.appendChild(f);

  fit(box);
  return box;
}

/* Keep --ig-s equal to tileWidth / 326, which is what the transform reads.
   clientWidth, deliberately, not getBoundingClientRect(): these pages are
   zoomed (1.25 at 1000px, 1.5 at 1200px) and the rect comes back in device
   pixels while the iframe's 326px is CSS pixels. clientWidth is CSS pixels
   too, so the ratio is right at any zoom.

   THREE CHANCES, because the first two can each legitimately come up empty.
   The synchronous call is for the case where the caller has already attached
   the tile; it measures 0 and does nothing if not. ResizeObserver is the
   steady-state answer — a window resize, the sidebar opening, a zoom tier
   changing — but its callbacks are delivered during the rendering steps, so a
   tile built while the tab is in the background or the pane is collapsed does
   not hear from it until something renders. The timeout is what makes the
   initial size deterministic regardless: a macrotask runs whether or not
   anything is being painted, and by then the caller has certainly inserted
   the grid it was handed. */
function fit(box) {
  const apply = () => {
    const w = box.clientWidth;
    if (w > 0) box.style.setProperty('--ig-s', String(w / W));
  };
  apply();
  setTimeout(apply, 0);
  if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(box);
  else window.addEventListener('resize', apply);
}

/* A row of them. The grid class does the capping; this just fills it, and drops
   any code that does not survive validation rather than rendering a frame
   pointed at nothing. */
function grid(codes, max) {
  const g = document.createElement('div');
  g.className = 'ig-grid';
  (codes || []).slice(0, max || 4).forEach(c => {
    const t = tile(c);
    if (t) g.appendChild(t);
  });
  return g.children.length ? g : null;
}

return { tile, grid, W, H, CODE_OK };
}));
