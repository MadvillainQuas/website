'use strict';
/* THE SCOUTING PAGE'S TABS (2026-10-06): Services and Successes. The choice is in the address (?t=successes) so either can be
   sent to somebody; replaceState, because a tab is not a place to press Back out of. Without this file both parts show. */
(function () {
  document.documentElement.classList.add('js');
  const panes = [...document.querySelectorAll('.pane[data-p]')];
  const tabs = [...document.querySelectorAll('.tabs [data-t]')];
  function show(t, remember) {
    if (!panes.some(p => p.dataset.p === t)) t = 'services';
    panes.forEach(p => { p.hidden = p.dataset.p !== t; });
    tabs.forEach(a => { if (a.dataset.t === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (remember) { try { const u = new URL(location.href); u.searchParams.set('t', t); u.hash = 'tabs'; history.replaceState(null, '', u); } catch (_) { /* fine */ } }
  }
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="?t="]') : null;
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    show(new URLSearchParams(a.getAttribute('href').split('#')[0]).get('t'), true);
    const bar = document.getElementById('tabs');
    if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  show(new URLSearchParams(location.search).get('t') || 'services', false);
}());
