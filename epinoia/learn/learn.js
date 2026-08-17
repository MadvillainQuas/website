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
