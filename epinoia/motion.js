/* ============================================================================
   MOTION (epinoia/motion.js + kit/motion.css, 2026-10-05): the small animations a reader expects from an interface, on every page that
   loads it, from one place and with no page changed.

     A PRESS         a button, a tab, a segment or a row that opens something gives a quick press (a squeeze and back).
     AN OPENING      what a press (or a key) brings onto the page - a dropdown row's contents, the panel of the tab pressed,
                     LIVE / UPCOMING / RESULTS, a box score tab - rises in and fades up. Found, not wired: for a moment after a
                     press or Enter/Space on something interactive, any block added to the page (or un-hidden, or named by a
                     button's aria-expanded) is given the opening. Nothing changes what a page does with its data.
     <details>       its contents open the same way.

   NOT ANIMATED: anything that arrives on its own (a live score changing, a poll redrawing a list), anything small (a word, a
   badge), a block already moving, and everything when the reader asks for reduced motion. It never delays or blocks: the
   animation is on the block's appearance only, drawn by CSS, and is removed when it ends.
   ============================================================================ */
(function () {
  'use strict';
  const doc = document, root = doc.documentElement;
  if (!doc.addEventListener || typeof MutationObserver !== 'function') return;
  let reduced = false;
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = !!mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', e => { reduced = !!e.matches; });
  } catch (_) { /* animate */ }

  const WINDOW_MS = 1400;          // how long after a press new content still counts as its answer (a tab may fetch first)
  const PRESSABLE = 'button, [role="tab"], [role="button"], summary, .ep-btn, .ep-tab, .tabbtn, .hm-seg button, .ep-xtabs button, .item, .crow, .lrow';
  let until = 0;

  const skipTag = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|SVG|PATH|BR|HR|INPUT|OPTION|TR|TD|TH|TBODY|THEAD|COL)$/;
  const busy = new WeakSet();

  /* is this block worth animating: visible, and bigger than a badge */
  function worth(el) {
    if (!el || el.nodeType !== 1 || skipTag.test(el.tagName) || busy.has(el)) return false;
    if (el.closest('[data-no-motion], .ep-mo-in, .tt-line, .ep-scrollmark, #toast, .ep-toast')) return false;
    if (el.hasAttribute('hidden')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 60 && r.height >= 24;
  }
  function play(el) {
    if (reduced || !worth(el)) return;
    busy.add(el);
    const pos = getComputedStyle(el).position;
    /* a fixed or sticky block keeps its place: it only fades */
    el.classList.add(pos === 'fixed' || pos === 'sticky' ? 'ep-mo-fade' : 'ep-mo-in');
    const done = () => { el.classList.remove('ep-mo-in', 'ep-mo-fade'); busy.delete(el); el.removeEventListener('animationend', done); };
    el.addEventListener('animationend', done);
    setTimeout(done, 700);
  }

  /* THE PRESS: a squeeze on whatever was pressed, and the window in which the page's answer is animated */
  function pressed(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest(PRESSABLE) : null;
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    until = Date.now() + WINDOW_MS;
    if (reduced || busy.has(t)) return;
    busy.add(t);
    t.classList.add('ep-mo-press');
    const done = () => { t.classList.remove('ep-mo-press'); busy.delete(t); t.removeEventListener('animationend', done); };
    t.addEventListener('animationend', done);
    setTimeout(done, 400);
  }
  doc.addEventListener('pointerdown', pressed, true);
  doc.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') pressed(ev); }, true);

  /* WHAT THE PRESS BROUGHT: blocks added, un-hidden, or opened by aria-expanded, inside the window */
  const obs = new MutationObserver(list => {
    if (Date.now() > until || reduced) return;
    const seen = new Set();
    const take = el => { if (el && !seen.has(el)) { seen.add(el); } };
    list.forEach(m => {
      if (m.type === 'childList') {
        m.addedNodes.forEach(n => { if (n.nodeType === 1) take(n); });
      } else if (m.type === 'attributes') {
        const el = m.target;
        if (m.attributeName === 'hidden' && !el.hasAttribute('hidden')) take(el);
        else if (m.attributeName === 'aria-expanded' && el.getAttribute('aria-expanded') === 'true') {
          const id = el.getAttribute('aria-controls');
          take((id && doc.getElementById(id)) || el.nextElementSibling);
        } else if (m.attributeName === 'aria-selected' && el.getAttribute('aria-selected') === 'true') {
          const id = el.getAttribute('aria-controls');
          take(id && doc.getElementById(id));
        }
      }
    });
    /* the outermost of what was added: a child of something that is itself coming in rides on its parent */
    const els = [...seen].filter(e => e.isConnected && ![...seen].some(o => o !== e && o.contains(e)));
    els.slice(0, 6).forEach(play);
  });
  function start() {
    obs.observe(doc.body || root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded', 'aria-selected'] });
  }
  if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start);

  /* <details>: its contents open the same way (the toggle event does not bubble, so it is caught on the way down) */
  doc.addEventListener('toggle', ev => {
    const d = ev.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open || reduced) return;
    [...d.children].filter(c => c.tagName !== 'SUMMARY').slice(0, 4).forEach(play);
  }, true);
})();
