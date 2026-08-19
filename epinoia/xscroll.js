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
  /* A HORIZONTAL SCROLLER IS NOT ONLY ONE THE COMPUTED STYLE ADMITS TO.
     Below 640px .ft-wrap and .ep-xscroll are deliberately overflow:hidden —
     they pan from pointer events instead (see drag() below) — so asking the
     computed style whether a box scrolls answers "no" for exactly the boxes
     that do. Left at that, every table already inside a .ft-wrap got a second
     wrapper around it: a redundant DOM level whose own scrollWidth equals its
     clientWidth, so it scrolls nothing while still taking the gesture.
     A box this file manages, or one a page built for this purpose, counts. */
  const MANAGED = '.ep-xscroll, .ft-wrap, .ep-tw, .ep-xtabs';
  const scrolls = el => {
    if (!el) return false;
    if (el.matches && el.matches(MANAGED)) return true;
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

  /* ==========================================================================
     HORIZONTAL PANNING BY HAND ON A PHONE, INSTEAD OF BY touch-action.

     This is the third attempt at one bug and the first that stops trying to
     word a CSS declaration correctly. A box with overflow-x:auto is a scroll
     container, and when a touch begins inside one the browser has to decide
     which axis the gesture belongs to before it knows where the finger is
     going. touch-action is the only lever over that decision, and neither
     pan-x (which discards vertical outright) nor pan-x pan-y (which leaves the
     arbitration in place and lets the box win) reliably hands a mostly-vertical
     swipe back to the page — reported broken on a real phone after each.

     So there is no arbitration any more. kit/table.css sets overflow:hidden on
     both axes below 640px, which leaves the browser with no scrollable surface
     here to claim, and touch-action:pan-y says in as many words that vertical
     is the page's. scrollLeft still moves under script on an overflow:hidden
     box, so sideways panning is driven from pointer events below.

     THE RULE THAT MAKES IT WORK is that nothing is claimed until a drag has
     clearly gone sideways: past a small slop AND more horizontal than vertical.
     A touch that turns out to be vertical is dropped at that instant with
     preventDefault never called and the pointer never captured, so the page's
     own scrolling takes it having never been interfered with. Lifted out of
     fulltable.js, where it worked and where it was reachable by exactly one
     table out of the dozen that need it.

     Only below 640px: above that a mouse has a scrollbar and a trackpad has
     two axes, and drag-to-pan would fight text selection and column sorting.
     ========================================================================== */
  const PHONE = () => window.matchMedia('(max-width:640px)').matches;

  /* MOMENTUM, BECAUSE 1:1 TRACKING ALONE READS AS SLOW.

     A hand-driven scrollLeft follows the finger exactly and then stops dead on
     release. That is not what a native scroller does and it is not what a
     thumb expects: the flick — throw it and let it coast — is how you cross a
     wide table in one gesture. Without it a 1023px table in a 373px window
     takes two full swipes of the screen instead of one, which is precisely the
     "very slow" this was reported as. The tracking was never slow; the coast
     was missing.

     Velocity is smoothed over the last few moves rather than taken from the
     final pair, because the last sample before a lift is often a near-zero
     one — the thumb slows as it leaves the glass — and reading only that gives
     a flick no throw at all. */
  const DECAY = 0.94;        // per 16ms frame; ~0.5s of coast from a firm flick
  const MIN_V = 0.02;        // px/ms — below this the coast is invisible, stop

  function drag(box) {
    if (!box || box.dataset.dragscroll === '1') return;
    box.dataset.dragscroll = '1';
    const SLOP = 6;
    let startX = 0, startY = 0, startScroll = 0, pointerId = null,
        dragging = false, armed = false;
    let vel = 0, lastX = 0, lastT = 0, glide = null;

    const stopGlide = () => { if (glide) { cancelAnimationFrame(glide); glide = null; } };

    function coast() {
      let prev = performance.now();
      const step = now => {
        const dt = Math.min(32, now - prev); prev = now;
        const max = box.scrollWidth - box.clientWidth;
        const next = box.scrollLeft + vel * dt;
        box.scrollLeft = Math.max(0, Math.min(max, next));
        vel *= Math.pow(DECAY, dt / 16);
        /* stop at the ends rather than grinding against them */
        if (Math.abs(vel) < MIN_V || box.scrollLeft <= 0 || box.scrollLeft >= max) {
          glide = null; return;
        }
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    }

    box.addEventListener('pointerdown', e => {
      stopGlide();                       // a touch down catches a moving table
      if (!PHONE()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      lastX = e.clientX; lastT = performance.now(); vel = 0;
      startScroll = box.scrollLeft;
      armed = true; dragging = false;
    });

    box.addEventListener('pointermove', e => {
      if (!armed || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        /* vertical — release it untouched and let the page have it */
        if (Math.abs(dy) >= Math.abs(dx)) { armed = false; return; }
        dragging = true;
        try { box.setPointerCapture(e.pointerId); } catch (_) {}
      }
      /* scrollLeft moves opposite the finger, so velocity does too */
      const now = performance.now(), dt = now - lastT;
      if (dt > 0) {
        const v = -(e.clientX - lastX) / dt;
        vel = vel ? vel * 0.3 + v * 0.7 : v;
        lastX = e.clientX; lastT = now;
      }
      box.scrollLeft = startScroll - (e.clientX - startX);
      e.preventDefault();
    });

    const release = e => {
      if (e && e.pointerId !== pointerId) return;
      const threw = dragging;
      if (dragging) { try { box.releasePointerCapture(pointerId); } catch (_) {} }
      armed = false; dragging = false; pointerId = null;
      /* a finger resting still before the lift is not a throw */
      if (threw && Math.abs(vel) > MIN_V * 4 && performance.now() - lastT < 120) coast();
      else vel = 0;
    };
    box.addEventListener('pointerup', release);
    box.addEventListener('pointercancel', release);
    box.addEventListener('lostpointercapture', release);
  }

  /* A tap that lands on a sortable header must still sort, so the drag must not
     swallow the click. It does not: the click only goes missing when the
     pointer was captured, and capture happens only once a drag has gone
     sideways past the slop — which is not a tap. */

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

    /* .ft-wrap and .ep-tw are built by the pages themselves and are already
       scrollers, so wrap() skips them — but they are exactly the boxes the
       drag is for. Every horizontal surface on the platform, in one place. */
    document.querySelectorAll(MANAGED).forEach(drag);
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

  window.epinoiaXScroll = run;
  window.epinoiaDragScroll = drag;   // for a surface built outside the sweep      // for a page that renders on its own schedule
})();
