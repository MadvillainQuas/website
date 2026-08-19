'use strict';
/* ============================================================================
   WIDE THINGS SCROLL SIDEWAYS INSTEAD OF SPILLING.

   Every stats surface on the platform draws a table that is wider than a
   phone, on purpose: .ep-tbl carries min-width:580px because a WOWY row or a
   lineup row is a dozen numbers and squeezing them into 375px would make them
   unreadable rather than smaller. The width is right. What was missing is
   anywhere for it to go — .ep-tw exists and does exactly this, and is used on
   three pages out of a dozen. Everywhere else the table simply overflowed its
   container, so the columns past the fifth were unreachable on a phone: not
   clipped with a hint, just gone.

   Wrapping each one at its render site would mean touching every table on
   every page and remembering it for every table added later, which is the kind
   of rule that holds for a month. This does it structurally instead: find the
   wide things, give them a scroller if they do not have one, and watch for
   re-renders so a table drawn after a tab switch is caught too.

   THE TAB BARS GET THE SAME TREATMENT. .ep-tabs is an inline-flex strip with
   no wrap, so five tabs — table, fixtures, leaders, team stats, cup — run off
   the side of a phone with the last two unreachable.

   WHY NOT JUST WRAP THE TABS ONTO TWO LINES. Because a tab bar that reflows
   changes height when you switch tabs, and the content below it jumps. A strip
   that scrolls keeps one row and one height; the fade on the right edge is
   what tells a reader there is more, which a cut-off tab does not.
   ============================================================================ */
(function () {

  /* A scroller already? Anything that can scroll horizontally will do — this
     must not double-wrap a table that a page has already handled. */
  const scrolls = el => {
    if (!el) return false;
    const o = getComputedStyle(el).overflowX;
    return o === 'auto' || o === 'scroll';
  };
  const inScroller = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (scrolls(p)) return true;
      /* stop at the first element that establishes its own width context and
         is plainly a page section rather than a wrapper */
      if (p.classList && p.classList.contains('ep-frame')) return false;
    }
    return false;
  };

  function wrap(el) {
    if (!el || el.dataset.xscrolled === '1' || inScroller(el)) return;
    const box = document.createElement('div');
    box.className = 'ep-xscroll';
    el.parentNode.insertBefore(box, el);
    box.appendChild(el);
    el.dataset.xscrolled = '1';
  }

  /* A tab strip scrolls in place rather than being wrapped: it is already a
     flex row, so it only needs to be told it may scroll. Wrapping one would
     put a box round a control that is meant to read as a single edge. */
  function tabs(el) {
    if (!el || el.dataset.xscrolled === '1') return;
    el.classList.add('ep-xtabs');
    el.dataset.xscrolled = '1';
  }

  function sweep(root) {
    const r = root || document;
    /* every wide table, wherever it was drawn */
    r.querySelectorAll('table.ep-tbl, table.wowy, table.lineups, table.fx')
      .forEach(wrap);
    /* and any table that is simply wider than the screen, which catches the
       ones that do not carry a class this file knows about */
    r.querySelectorAll('table').forEach(t => {
      if (t.dataset.xscrolled === '1') return;
      const p = t.parentElement;
      if (!p) return;
      if (t.scrollWidth > p.clientWidth + 4) wrap(t);
    });
    r.querySelectorAll('.ep-tabs, .tabbar, [role="tablist"]').forEach(tabs);
  }

  const run = () => { try { sweep(); } catch (_) { /* never break a page for this */ } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else run();

  /* Tables arrive after a fetch, a tab switch or a filter change, so one pass
     at load would catch almost none of them. Coalesced, because a render can
     touch the DOM dozens of times in a frame. */
  let queued = null;
  if (window.MutationObserver) {
    new MutationObserver(() => {
      clearTimeout(queued);
      queued = setTimeout(run, 60);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener('resize', () => { clearTimeout(queued); queued = setTimeout(run, 120); },
    { passive: true });

  window.epinoiaXScroll = run;      // for a page that renders on its own schedule
})();
