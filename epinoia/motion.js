/* ============================================================================
   MOTION (epinoia/motion.js + kit/motion.css, 2026-10-05): the small animations a reader expects from an interface, on every page that
   loads it, from one place and with no page changed.

     A PRESS         a button, a tab, a segment or a row that opens something gives a quick press (a squeeze and back).
     AN OPENING      what a press (or a key) brings onto the page - a dropdown row's contents, the panel of the tab pressed,
                     LIVE / UPCOMING / RESULTS, a box score tab - rises in and fades up. Found, not wired: for a moment after a
                     press or Enter/Space on something interactive, any block added to the page (or un-hidden, or named by a
                     button's aria-expanded) is given the opening. Nothing changes what a page does with its data.
     <details>       its contents open the same way.
     A CLOSING       what a press takes away - a dropdown row folding, the panel of the tab left behind - is not removed in one
                     frame: a copy of it, taken at the press, stays where it was for a moment and fades up and out (a cross-fade
                     with whatever replaced it). The page itself closes at once and is never held back.

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
    /* #csBody: the box score animates its own tab switch (game.js); a second animation over it was the stutter */
    if (el.closest('[data-no-motion], .ep-mo-in, .ep-mo-out, .tt-line, .ep-scrollmark, #toast, .ep-toast, #csBody')) return false;
    if (el.getElementsByTagName('*').length > 1500) return false;     // too big to move smoothly: it simply appears
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

  /* ---- THE CLOSING: a copy of what may go, taken at the press, shown fading out when it has gone ---- */
  const MAX_NODES = 1500;   // copying a bigger block at the press froze the page for a moment (2026-10-06)
  const TABSTRIP = '[role="tablist"], .tabrow, .tabs, .ep-xtabs, .hm-seg, .mv-switch, .tabgroup, .scw-seg';
  /* the blocks a press might close or replace: what it controls, what it opened, what sits under the strip it belongs to */
  function candidates(t) {
    const out = [], add = n => { if (n && n.nodeType === 1 && out.indexOf(n) < 0 && !n.contains(t)) out.push(n); };
    const id = t.getAttribute('aria-controls');
    if (id) add(doc.getElementById(id));
    if (t.getAttribute('aria-expanded') === 'true') add(t.nextElementSibling);
    const d = t.tagName === 'SUMMARY' ? t.parentElement : null;
    if (d && d.tagName === 'DETAILS' && d.open) [...d.children].forEach(c => { if (c.tagName !== 'SUMMARY') add(c); });
    const strip = t.closest(TABSTRIP);
    if (strip) { add(strip.nextElementSibling); if (strip.nextElementSibling) add(strip.nextElementSibling.nextElementSibling); }
    return out;
  }
  function snapshot(t) {
    if (t.closest('#view')) return [];        // the box score fades its own tabs (game.js)
    return candidates(t).map(node => {
      const r = node.getBoundingClientRect();
      if (r.width < 60 || r.height < 24 || node.getElementsByTagName('*').length > MAX_NODES) return null;
      const f = node.offsetWidth ? r.width / node.offsetWidth : 1;            // the page's zoom, if it has one
      return { node, parent: node.parentElement, next: node.nextSibling, first: node.firstElementChild, n: node.childElementCount,
               r: { l: r.left, t: r.top, w: r.width, h: r.height }, f: f || 1, clone: node.cloneNode(true) };
    }).filter(Boolean);
  }
  /* has it gone: removed, hidden, or its contents replaced */
  function gone(c) {
    const n = c.node;
    if (!n.isConnected || n.hidden) return true;
    if (getComputedStyle(n).display === 'none') return true;
    return n.firstElementChild !== c.first || n.childElementCount !== c.n;
  }
  function ghost(c) {
    const host = c.parent && c.parent.isConnected ? c.parent : doc.body;
    const g = c.clone;
    g.removeAttribute('id');
    g.classList.remove('ep-mo-in', 'ep-mo-fade');
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute('inert', '');
    const f = c.f || 1;
    g.style.cssText += ';position:fixed;margin:0;pointer-events:none;overflow:hidden;z-index:40;left:' + (c.r.l / f) + 'px;top:' + (c.r.t / f) + 'px;width:' + (c.r.w / f) + 'px;height:' + (c.r.h / f) + 'px';
    g.classList.add('ep-mo-out');
    host.appendChild(g);
    const done = () => { g.remove(); };
    g.addEventListener('animationend', done);
    setTimeout(done, 600);
  }
  function watchClosing(snaps) {
    if (reduced || !snaps.length) return;
    const t0 = Date.now(), left = snaps.slice();
    (function look() {
      for (let i = left.length - 1; i >= 0; i--) {
        if (gone(left[i])) { ghost(left[i]); left.splice(i, 1); }
      }
      if (left.length && Date.now() - t0 < WINDOW_MS) setTimeout(look, 70);
    })();
  }

  /* THE PRESS: a squeeze on whatever was pressed, and the window in which the page's answer is animated */
  function pressed(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest(PRESSABLE) : null;
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    until = Date.now() + WINDOW_MS;
    if (!reduced) { try { watchClosing(snapshot(t)); } catch (_) { /* no closing animation */ } }
    if (reduced || busy.has(t)) return;
    /* A BLOCK THAT POSITIONS ITSELF WITH A TRANSFORM IS NOT SQUEEZED: the squeeze's keyframes replace the transform, so the block would
       jump (a player's face on the modern box score sits at translateY(-38%) and dropped ~40px under the pointer on pointer-down, the
       press landed beside it and its card did not open). It still gets the closing/opening animations of what the press does. */
    try { const tf = getComputedStyle(t).transform; if ((tf && tf !== 'none') || t.closest('[data-no-motion]')) return; } catch (_) { /* squeeze as usual */ }
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
