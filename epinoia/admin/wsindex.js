'use strict';
/* ============================================================================
   THE CONSOLE'S INDEX - every section of the open tab, under the Settings / Graphics tabs, each a link
   straight to it.                                                              window.EpinoiaWsIndex

   The Settings tab is thirty-odd numbered sections, and the one somebody came for (Fixtures, Discipline,
   API keys) was a long scroll away. So the tabs carry an index: the sections of the open tab that this
   person can see, by their number and title, as they read on the page ("06a Discipline").

     what       the open tab's sections (.sec in #tabSettings or #tabGraphics) that are showing: a section a
                role cannot see (admin.js's .hide) is not offered, and one that appears later (a league's
                guests) is. Redrawn when a section shows or hides, and when the tab changes. Fewer than two
                is no index (the Graphics tab is one section).
     a jump     glides down the page (and lands at once for a reader who asked for less motion), the address
                takes the section's anchor so it can be sent to someone, and the section takes the keyboard's
                focus without a second jump. Every section has its anchor in index.html (sec-<title>, or the
                #seasons / #teams / #fixtures the league pages already link to), so the same address opens
                it from outside too (admin.js lands it once the league has loaded).
     back up    a small arrow on each indexed section's heading returns to the index, and opens it.
     not a wall a dropdown, shut until it is asked for, floating over the page rather than pushing the
                sections down; open, it lists the first FIRST sections with the rest behind "show more".
                Picking a section, Esc or a click elsewhere shuts it again.
   ============================================================================ */
(function (root) {
  const doc = root.document;
  const FIRST = 8;                                   // the sections listed before "show more"
  const PANELS = { settings: 'tabSettings', graphics: 'tabGraphics' };

  const reduced = () => { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const shown = n => !!n && n.getClientRects().length > 0;
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

  /* a title as an anchor: what index.html's ids are made of, for a section added without one */
  function slug(t) {
    return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  /* the anchor a section is reached by: its own id, its heading's (#seasons, #teams), or one made from its title */
  function anchorOf(sec, title, byId) {
    if (sec.id) return sec.id;
    const hd = sec.querySelector(':scope > .sec-h');
    if (hd && hd.id) return hd.id;
    const base = 'sec-' + (slug(title) || 'section');
    let id = base, n = 2;
    while (byId(id)) id = base + '-' + n++;
    sec.id = id;
    return id;
  }
  /* the open tab's sections, as the index lists them: [{ id, idx, title, sec }] */
  function entries(panel, isShown, byId) {
    if (!panel) return [];
    const out = [];
    Array.prototype.forEach.call(panel.querySelectorAll(':scope > .sec'), sec => {
      if (!isShown(sec)) return;
      const hd = sec.querySelector(':scope > .sec-h');
      const h2 = hd && hd.querySelector('h2');
      const title = h2 ? h2.textContent.replace(/\s+/g, ' ').trim() : '';
      if (!title) return;
      const ix = hd.querySelector('.idx');
      out.push({ id: anchorOf(sec, title, byId), idx: ix ? ix.textContent.trim() : '', title, sec });
    });
    return out;
  }

  function init() {
    const box = doc.getElementById('wsIndex');
    if (!box) return;
    const byId = id => doc.getElementById(id);

    const fold = el('details', 'wsix');
    const sum = el('summary', 'wsix-h');
    const count = el('span', 'wsix-n');
    sum.append(el('span', 'wsix-t', 'On this page'), count);
    const pop = el('div', 'wsix-pop');
    const list = el('ol', 'wsix-l');
    const more = el('button', 'ep-btn wsix-more');
    more.type = 'button';
    pop.append(list, more);
    fold.append(sum, pop);
    box.textContent = '';
    box.appendChild(fold);

    /* the rest of the sections, behind "show more" (and behind it again each time the dropdown shuts) */
    let all = false;
    const drawMore = () => {
      const rest = list.querySelectorAll(':scope > li.x');
      Array.prototype.forEach.call(rest, li => { li.hidden = !all; });
      more.hidden = !rest.length;
      more.textContent = all ? 'Show fewer' : 'Show more (' + rest.length + ')';
      more.setAttribute('aria-expanded', String(all));
    };
    /* the panel never runs off the screen: it takes the room below it and scrolls inside. Measured, not a vh cap,
       because the kit zooms the whole body on a wide screen and a vh inside it is zoomed too: the ratio of the
       panel's height on screen to its own height is whatever zoom it is drawn at */
    const fit = () => {
      if (!fold.open) return;
      pop.style.maxHeight = '';
      const r = pop.getBoundingClientRect(), h = pop.offsetHeight;
      if (!h || !r.height) return;
      const room = (root.innerHeight - r.top - 12) / (r.height / h);
      pop.style.maxHeight = Math.max(220, Math.floor(room)) + 'px';
    };
    more.addEventListener('click', () => { all = !all; drawMore(); fit(); });
    fold.addEventListener('toggle', () => {
      if (fold.open) { fit(); return; }
      if (all) { all = false; drawMore(); }
    });
    root.addEventListener('resize', fit);
    root.addEventListener('scroll', fit, { passive: true });
    /* shut by Esc (the keyboard goes back to the button) or by a click anywhere else */
    fold.addEventListener('keydown', e => {
      if (e.key === 'Escape' && fold.open) { e.preventDefault(); fold.open = false; try { sum.focus(); } catch (_) { /* fine */ } }
    });
    doc.addEventListener('click', e => { if (fold.open && !fold.contains(e.target)) fold.open = false; });

    /* the jump: glide, take the address, hand the keyboard to the section */
    const go = (to, hash) => {
      if (!to || !to.scrollIntoView) return;
      to.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      if (hash) { try { root.history.replaceState(root.history.state, '', hash); } catch (_) { /* the jump is what matters */ } }
      if (!to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
      try { to.focus({ preventScroll: true }); } catch (_) { /* the scroll is what matters */ }
    };
    list.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      fold.open = false;
      go(byId(a.getAttribute('href').slice(1)), a.getAttribute('href'));
    });
    /* back up: every indexed heading's arrow */
    doc.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a.sec-top') : null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(box, null);
      fold.open = true;
      try { sum.focus({ preventScroll: true }); } catch (_) { /* fine */ }
    });

    let sig = null;
    const paint = () => {
      const tab = root.EpinoiaTabs && root.EpinoiaTabs.current ? root.EpinoiaTabs.current() : 'settings';
      const list0 = entries(byId(PANELS[tab] || PANELS.settings), shown, byId);
      const now = tab + '|' + list0.map(x => x.id + ':' + x.idx + ':' + x.title).join('|');
      if (now === sig) return;
      sig = now;
      list.textContent = '';
      list0.forEach((x, i) => {
        const li = el('li', i >= FIRST ? 'x' : null), a = el('a');
        a.href = '#' + x.id;
        if (x.idx) { const n = el('span', 'i', x.idx); n.setAttribute('aria-hidden', 'true'); a.appendChild(n); }
        a.appendChild(el('span', 't', x.title));
        li.appendChild(a);
        list.appendChild(li);
        /* the way back, on the section's own heading */
        const hd = x.sec.querySelector(':scope > .sec-h');
        if (hd && !hd.querySelector(':scope > .sec-top')) {
          const up = el('a', 'sec-top', '↑');
          up.href = '#wsIndex';
          up.title = 'Back to the index';
          up.setAttribute('aria-label', 'Back to the index');
          hd.appendChild(up);
        }
      });
      drawMore();
      count.textContent = list0.length + ' sections';
      box.hidden = list0.length < 2;
    };

    doc.addEventListener('epinoia-tab', () => setTimeout(paint, 0));
    if (typeof root.MutationObserver === 'function') {
      /* a section shown or hidden (admin.js's .hide, a tab's [hidden]), or the workspace itself appearing */
      let pend = 0;
      const mo = new root.MutationObserver(() => {
        if (pend) return;
        pend = setTimeout(() => { pend = 0; paint(); }, 200);
      });
      /* one registration (a second on the same node would replace it): subtree covers #ws itself too */
      const ws = byId('ws');
      if (ws) mo.observe(ws, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    }
    paint();
  }

  root.EpinoiaWsIndex = { slug, entries, anchorOf };
  if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else if (doc) init();
}(typeof globalThis !== 'undefined' ? globalThis : self));
