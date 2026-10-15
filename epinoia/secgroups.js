'use strict';
/* ============================================================================
   THE CLUB AND PLAYER PAGES IN GROUPS (Louie, 2026-10-15): in place of ON THIS PAGE, HOME's buttons and cards
   (home/groups.js) - the page's sections gathered into groups, each group a card with a head, and a row of buttons
   under the profile's own tabs, one a group.

   ON A DESKTOP THE BUTTONS ARE TABS: one group shows at a time, the tab remembered for the kind of page (every club page
   opens on the group last chosen on one). A PHONE HAS HOME'S SWITCH beside the buttons, TABS or SCROLL: Tabs is the
   desktop's way; Scroll is one long page, each button a jump to its group and each group foldable. One choice for the
   whole site (HOME's own key), Scroll until the reader chooses; a desktop is always tabs and shows no switch.

   THE PAGE'S MARKUP SAYS WHAT THE GROUPS ARE:
     <div class="pgrp-root" data-pgrp="t">                                        (t: the club page, p: the player page)
       <div class="pgrp-group" data-pgrp-key="main" data-pgrp-name="Main stats"> ...its sections, in reading order... </div>
   Nothing is moved and nothing is drawn here but the buttons, the heads and the switch, so the pages' own scripts find
   every section where they always did. A group none of whose headings is showing (a members' section locked away, clutch
   time before there is any) has no button and no head, and the tabs open the next one. An address naming anything inside a
   group (#roster) opens its tab, and so does any link on the page to a section in another tab.
   ============================================================================ */
(function (root) {
  const doc = root.document;
  if (!doc || !doc.querySelector) return;
  /* the teletext set's colours, HOME's five first */
  const COLOURS = ['#ff5a4d', '#ffd23f', '#3ad6e6', '#c05cff', '#2fd47a', '#5b8cff', '#ff9f43', '#ff6fae', '#9be15d'];
  const MODE_KEY = 'hm_phone_mode';
  const get = k => { try { return root.localStorage.getItem(k); } catch (_) { return null; } };
  const put = (k, v) => { try { root.localStorage.setItem(k, v); } catch (_) { /* private mode: for this visit */ } };
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

  /* a heading shows when nothing between it and its group is display:none (the group's own tab state aside) */
  function shows(h, g) {
    for (let n = h; n && n !== g; n = n.parentElement) {
      if (n.hidden) return false;
      try { if (root.getComputedStyle(n).display === 'none') return false; } catch (_) { return true; }
    }
    return true;
  }

  function mount(box) {
    const kind = box.getAttribute('data-pgrp') || 'page';
    /* data-pgrp-v: the page's default group has changed, so the tab a reader chose before is set aside once (a new key)
       and they open on the new default (the first group) */
    const ver = box.getAttribute('data-pgrp-v');
    const TAB_KEY = 'pgrp_tab_' + kind + (ver ? '_v' + ver : ''), foldKey = k => 'pgrp_fold_' + kind + '_' + k;
    const groups = [].filter.call(box.children, n => n.classList.contains('pgrp-group'));
    if (groups.length < 2) return null;
    doc.documentElement.classList.add('pgrp-page');
    const nav = el('nav', 'pgrp-nav');
    nav.setAttribute('aria-label', 'On this page');
    /* the buttons wrap onto a second line and keep the phone's switch in view (xscroll.js leaves it be) */
    nav.dataset.xscrolled = '1';
    box.insertBefore(nav, box.firstChild);
    const desk = root.matchMedia ? root.matchMedia('(min-width: 721px)') : { matches: false };
    let phoneTabs = get(MODE_KEY) === 'tabs';
    const tabsOn = () => !!desk.matches || phoneTabs;
    let tab = get(TAB_KEY);
    /* the tab the reader chose (or an address asked for): kept while its group waits for its data, so a tab that shows
       before it does is a stand-in, not the choice */
    let want = tab;

    const built = groups.map((g, i) => {
      const key = g.getAttribute('data-pgrp-key') || 'g' + (i + 1);
      const name = g.getAttribute('data-pgrp-name') || key;
      g.style.setProperty('--pgrp', COLOURS[i % COLOURS.length]);
      const head = el('div', 'pgrp-head');
      head.id = 'group-' + key;
      const fold = el('button', 'pgrp-fold');
      fold.type = 'button';
      /* the button says show or hide; which group it folds is read from the head's name, so no sentence is put together
         from the two (one translation each) */
      const nm = el('span', 'pgrp-name', name);
      nm.id = 'group-' + key + '-name';
      fold.setAttribute('aria-describedby', nm.id);
      head.append(nm, fold);
      g.insertBefore(head, g.firstChild);
      const btn = el('a', 'pgrp-btn', name);
      btn.href = '#group-' + key;
      btn.style.setProperty('--pgrp', COLOURS[i % COLOURS.length]);
      btn.dataset.track = 'pgrp-' + kind + '-' + key;
      nav.appendChild(btn);
      const apply = folded => {
        g.classList.toggle('pgrp-folded', folded);
        fold.textContent = folded ? 'show' : 'hide';
        fold.setAttribute('aria-expanded', String(!folded));
      };
      apply(get(foldKey(key)) === '1');
      fold.addEventListener('click', () => { const f = !g.classList.contains('pgrp-folded'); put(foldKey(key), f ? '1' : '0'); apply(f); });
      btn.addEventListener('click', e => {
        e.preventDefault();
        if (tabsOn()) { showTab(key, true); return; }
        if (g.classList.contains('pgrp-folded')) { put(foldKey(key), '0'); apply(false); }
        head.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      });
      return { key, name, g, head, btn, apply, on: true };
    });

    /* the phone's switch, after the buttons: shown on a phone only (kit/secgroups.css .pgrp-mode) */
    const mode = el('div', 'pgrp-mode');
    mode.setAttribute('role', 'group');
    mode.setAttribute('aria-label', 'Show the groups as tabs or in one scrolling page');
    const modeBtns = [['tabs', 'Tabs'], ['scroll', 'Scroll']].map(([k, label]) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.dataset.mode = k;
      b.dataset.track = 'pgrp-mode-' + k;
      b.addEventListener('click', () => {
        if ((k === 'tabs') === phoneTabs) return;
        phoneTabs = k === 'tabs';
        put(MODE_KEY, k);
        showTab(tab, true);
        nav.scrollIntoView({ block: 'nearest' });
      });
      mode.appendChild(b);
      return b;
    });
    nav.appendChild(mode);

    /* the tabs: the chosen group shows, the others step aside (classes only); in Scroll every group shows, folded as its
       reader left it */
    function showTab(k, save) {
      if (save && k) want = k;
      const vis = built.filter(x => x.on);
      if (!vis.some(x => x.key === k)) k = vis.length ? vis[0].key : null;
      tab = k;
      if (save && k) put(TAB_KEY, k);
      const on = tabsOn();
      const html = doc.documentElement;
      html.classList.toggle('pgrp-tabs', on);
      html.classList.toggle('pgrp-ptabs', on && !desk.matches);
      modeBtns.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.mode === 'tabs') === phoneTabs)));
      nav.setAttribute('role', on ? 'tablist' : 'navigation');
      built.forEach(x => {
        const off = on && x.key !== k;
        x.g.classList.toggle('pgrp-off', off);
        x.btn.classList.toggle('on', on && x.key === k);
        if (on) { x.btn.setAttribute('role', 'tab'); x.btn.setAttribute('aria-selected', String(x.key === k)); }
        else { x.btn.removeAttribute('role'); x.btn.removeAttribute('aria-selected'); }
        x.apply(on ? false : get(foldKey(x.key)) === '1');
      });
      /* what was hidden measures itself again (charts and strips sized on a resize), and the rail's SKIP key learns
         which sections are showing now (nav.js listens for epinoia:sections) */
      try { root.dispatchEvent(new Event('resize')); root.dispatchEvent(new Event('epinoia:sections')); } catch (_) { /* old browser */ }
    }
    const groupOf = id => {
      if (!id) return null;
      const t = doc.getElementById(id);
      return built.find(x => x.head.id === id || (t && x.g.contains(t))) || null;
    };
    /* an address naming a section, or a group, opens its tab and goes to it */
    function fromHash(go) {
      let id = '';
      try { id = decodeURIComponent(root.location.hash.slice(1)); } catch (_) { return false; }
      const x = groupOf(id);
      if (!x) return false;
      want = x.key;
      showTab(x.key, false);
      if (go) { const to = doc.getElementById(id); if (to) setTimeout(() => to.scrollIntoView({ block: 'start' }), 0); }
      return true;
    }
    /* a group with no heading showing has no head and no button. Read again whenever the page shows or hides
       something inside a group; only a change in what shows touches the tabs (which would otherwise wake this again) */
    let sig = null, pend = 0;
    const sync = () => {
      pend = 0;
      built.forEach(x => {
        /* a folded group hides its own sections: measured unfolded, or it would lose the head that unfolds it */
        const folded = x.g.classList.contains('pgrp-folded');
        if (folded) x.g.classList.remove('pgrp-folded');
        const hs = [].filter.call(x.g.querySelectorAll('.ep-hdr, .sec-h'), h => !x.head.contains(h));
        x.on = hs.some(h => shows(h, x.g));
        if (folded) x.g.classList.add('pgrp-folded');
      });
      const now = built.map(x => (x.on ? 1 : 0)).join('');
      if (now === sig) return;
      sig = now;
      built.forEach(x => { x.head.hidden = !x.on; x.btn.hidden = !x.on; x.g.classList.toggle('pgrp-empty', !x.on); });
      nav.hidden = built.filter(x => x.on).length < 2;
      showTab(want || tab, false);
    };
    const soon = () => { if (!pend) pend = setTimeout(sync, 60); };
    sync();
    if (!fromHash(true)) showTab(want || tab, false);
    root.addEventListener('hashchange', () => fromHash(true));
    /* any link on the page to a section in another tab (the rail's, a "see the roster" in the text) opens that tab
       on the way, before the browser goes to it */
    doc.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || !tabsOn() || a.classList.contains('pgrp-btn')) return;
      const x = groupOf(a.getAttribute('href').slice(1));
      if (x && x.key !== tab) { want = x.key; showTab(x.key, false); }
    }, true);
    if (desk.addEventListener) desk.addEventListener('change', () => showTab(tab, false));
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(soon);
      groups.forEach(g => mo.observe(g, { subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] }));
    }
    /* the season or competition changes what a page draws: read again once it has */
    root.addEventListener('load', soon);
    return { open: k => showTab(k, true), current: () => tab, sync };
  }
  const reduced = () => { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

  const done = new Set();
  const boot = () => doc.querySelectorAll('.pgrp-root[data-pgrp]').forEach(b => { if (!done.has(b)) { done.add(b); mount(b); } });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
  root.EpinoiaSecGroups = { mount, shows, COLOURS, MODE_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
