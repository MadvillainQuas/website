'use strict';
/* ============================================================================
   THE CONSOLE'S TABS - Settings (every numbered section, as it has always been) and Graphics.

   The league dropdown sits above the tabs and applies to both. Nothing inside a tab is moved or renamed: the
   Settings panel is the same DOM the panels mount into, only hidden while Graphics is showing, so every id and
   every mount in admin.js is where it was.

     address    #graphics opens the Graphics tab (a link that can be sent to someone); #settings, or any other
                anchor (#fixtures, #backfill, #seasons: the ones the league pages link to), opens Settings
     memory     the last tab, kept in localStorage when the address does not say (never required: try/catch)
     keyboard   left / right / home / end move between the tabs, the tab list is one tab stop (roving tabindex)
     event      'epinoia-tab' on document, { detail: { id } }, so a panel can load when its tab is first opened
     api        window.EpinoiaTabs.show(id) / .current(): admin.js calls show('settings') before it scrolls to a
                section, which would otherwise be hidden under Graphics
   ============================================================================ */
(function (root) {
  const KEY = 'epinoia.admin.tab';
  const IDS = ['settings', 'graphics'];
  const doc = root.document;
  let now = null;

  const btns = () => Array.from(doc.querySelectorAll('#wsTabs [data-tab]'));
  const panel = id => doc.getElementById('tab' + id.charAt(0).toUpperCase() + id.slice(1));
  const remembered = () => { try { const v = root.localStorage.getItem(KEY); return IDS.includes(v) ? v : null; } catch (_) { return null; } };
  const remember = id => { try { root.localStorage.setItem(KEY, id); } catch (_) { /* private window: the tab still works */ } };

  function show(id, o) {
    if (!IDS.includes(id)) id = 'settings';
    const changed = id !== now;
    now = id;
    btns().forEach(b => {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    IDS.forEach(t => { const p = panel(t); if (p) p.hidden = t !== id; });
    if (!(o && o.quiet)) {
      remember(id);
      /* the address follows the tab (replaceState: no history entry per click), keeping ?l= and leaving an
         anchor to a Settings section alone */
      try {
        const h = root.location.hash;
        if (id === 'graphics' && h !== '#graphics') root.history.replaceState(null, '', root.location.pathname + root.location.search + '#graphics');
        else if (id === 'settings' && h === '#graphics') root.history.replaceState(null, '', root.location.pathname + root.location.search);
      } catch (_) { /* file:// and the like */ }
    }
    if (changed || (o && o.force)) doc.dispatchEvent(new root.CustomEvent('epinoia-tab', { detail: { id } }));
    return id;
  }

  /* what the address, then the memory, then the default say */
  function fromAddress() {
    const h = root.location.hash.replace(/^#/, '');
    if (h === 'graphics') return 'graphics';
    if (h) return 'settings';
    return remembered() || 'settings';
  }

  function init() {
    const bar = doc.getElementById('wsTabs');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) show(b.dataset.tab);
    });
    bar.addEventListener('keydown', e => {
      const list = btns(), at = list.findIndex(b => b.dataset.tab === now);
      const to = e.key === 'ArrowRight' ? (at + 1) % list.length : e.key === 'ArrowLeft' ? (at + list.length - 1) % list.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      show(list[to].dataset.tab);
      list[to].focus();
    });
    doc.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('[data-tab-link]');
      if (!a) return;
      e.preventDefault();
      show(a.dataset.tabLink);
      const p = panel(a.dataset.tabLink);
      if (p && p.scrollIntoView) p.scrollIntoView({ block: 'start' });
    });
    root.addEventListener('hashchange', () => {
      const h = root.location.hash.replace(/^#/, '');
      if (h === 'graphics') show('graphics', { quiet: true });
      else if (h && now !== 'settings') show('settings', { quiet: true });
    });
    show(fromAddress(), { quiet: true, force: true });
  }

  root.EpinoiaTabs = { show, current: () => now, IDS };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
}(typeof globalThis !== 'undefined' ? globalThis : self));
