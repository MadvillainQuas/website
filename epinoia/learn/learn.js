'use strict';
/* Two tabs, and the sales one lands first on purpose: somebody arriving from
   the splash is deciding whether this is for them, not learning to drive it.

   The choice is reflected in the URL so either tab can be linked to directly —
   "read how it works" is the sort of thing somebody sends to a colleague, and
   a link that lands on the wrong tab makes them hunt. replaceState rather than
   pushState, because switching tabs is not a place you should have to press
   Back out of. */
const panes = [...document.querySelectorAll('.pane')];
const tabs = [...document.querySelectorAll('.ep-tab')];

function show(which, remember) {
  tabs.forEach(t => t.classList.toggle('on', t.dataset.p === which));
  panes.forEach(p => p.classList.toggle('on', p.id === 'pane-' + which));
  if (remember) {
    const u = new URL(location.href);
    u.searchParams.set('t', which);
    history.replaceState(null, '', u);
  }
}

tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.p, true)));

const want = new URLSearchParams(location.search).get('t');
if (want && panes.some(p => p.id === 'pane-' + want)) show(want, false);

/* ==================== the framed product shots ====================
   A whole page shown inside a card has to be rendered at the width it was
   designed for and then shrunk, not squeezed: an iframe 400px wide serves the
   phone layout, which is honest but is not what somebody buying a competition
   site is trying to look at. So each frame renders at a desktop width and is
   scaled down to whatever the card actually is.

   The scale cannot be written in CSS because it depends on the card's measured
   width, and the height has to follow it or the card keeps a gap the size of
   the unscaled page. Both are set here and recomputed on resize.

   The widgets in Model 02 are deliberately NOT in here. They are built to be
   embedded at whatever width they are given, so they are shown at their real
   size and left interactive — a live one argues better than a picture. */
function fitShots() {
  document.querySelectorAll('.port[data-scale]').forEach(port => {
    const frame = port.querySelector('iframe');
    if (!frame) return;
    const w = +port.dataset.w || 1280;          // the width the page renders at
    const h = +port.dataset.h || 860;           // and how much of it to show
    const avail = port.clientWidth || port.getBoundingClientRect().width;
    if (!avail) return;
    const k = avail / w;
    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    frame.style.transform = 'scale(' + k + ')';
    port.style.height = Math.round(h * k) + 'px';
  });
}

fitShots();
addEventListener('resize', fitShots, { passive: true });
/* a lazy frame can arrive after the first pass, and a tab switch gives a card
   a width for the first time */
addEventListener('load', fitShots);
tabs.forEach(t => t.addEventListener('click', () => setTimeout(fitShots, 0)));
