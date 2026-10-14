'use strict';
/* ============================================================================
   HOME IN GROUPS (Louie, 2026-10-10): "aesthetic, modern card backings to each section ... a grouping card visual for
   both daily fixtures and my followed, then one for feed and video, then one for Epinoia Go, then one for stars"; ON THIS
   PAGE as "proper buttons for each group ... in the strip's style"; each group collapsible.

   The sections are not moved (other scripts find them where they are): each gets its group's card backing, a head is
   put before a group's first section (its name, and a button that folds the group away - remembered), and a row of
   buttons under the hero jumps to each group. A group none of whose sections is showing has no head and no button.

   ON A DESKTOP THE BUTTONS ARE TABS (Louie, 2026-10-14): one group shows at a time, the tab remembered, and no folding
   (the tab is the fold). A phone keeps the jumps down one long page. An address naming a section (home/#leagues, the
   rail's ON THIS PAGE) opens the tab that holds it.
   ============================================================================ */
(function () {
  const GROUPS = [
    ['games', 'Games', ['fixtures', 'followed', 'watch']],
    ['media', 'Feed & video', ['feed', 'videos']],
    ['go', 'EPINOIA GO', ['go']],
    ['stars', 'Stars', ['stars', 'records']],
    ['leagues', 'Leagues', ['leagues', 'scouting', 'privateLeagues']]
  ];
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const get = k => { try { return localStorage.getItem('hm_fold_' + k) === '1'; } catch (_) { return false; } };
  const set = (k, v) => { try { localStorage.setItem('hm_fold_' + k, v ? '1' : '0'); } catch (_) { /* private mode */ } };
  const hero = document.querySelector('.hm-modes') || document.querySelector('.hm-hero, .hero');
  if (!hero) return;
  const nav = el('nav', 'hg-nav');
  nav.setAttribute('aria-label', 'On this page');
  const desk = window.matchMedia ? window.matchMedia('(min-width: 721px)') : { matches: false };
  const TAB_KEY = 'hm_tab';
  let tab = null;
  try { tab = localStorage.getItem(TAB_KEY); } catch (_) { /* private mode */ }
  hero.after(nav);
  const built = [];
  GROUPS.forEach(([key, name, ids]) => {
    const secs = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!secs.length) return;
    secs.forEach((s, i) => { s.classList.add('hg-sec', 'hg-' + key); if (i === 0) s.classList.add('hg-first'); if (i === secs.length - 1) s.classList.add('hg-last'); });
    const head = el('div', 'hg-head hg-' + key);
    head.id = 'group-' + key;
    const t = el('span', 'hg-name', name);
    if (key === 'go') t.setAttribute('translate', 'no');
    const fold = el('button', 'hg-fold');
    fold.type = 'button';
    head.append(t, fold);
    secs[0].before(head);
    const btn = el('a', 'hg-btn hg-' + key, name);
    btn.href = '#group-' + key;
    if (key === 'go') btn.setAttribute('translate', 'no');
    nav.appendChild(btn);
    const apply = folded => {
      secs.forEach(s => s.classList.toggle('hg-folded', folded));
      head.classList.toggle('folded', folded);
      fold.textContent = folded ? 'show' : 'hide';
      fold.setAttribute('aria-expanded', String(!folded));
      fold.setAttribute('aria-label', (folded ? 'Show ' : 'Hide ') + name);
    };
    apply(get(key));
    fold.addEventListener('click', () => { const f = !head.classList.contains('folded'); set(key, f); apply(f); });
    btn.addEventListener('click', e => {
      e.preventDefault();
      if (desk.matches) { showTab(key, true); return; }
      if (head.classList.contains('folded')) { set(key, false); apply(false); }
      head.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    built.push({ key, head, btn, secs, apply });
  });
  /* the desktop's tabs: the chosen group shows, the others step aside (classes only: the sections stay where other
     scripts find them); on a phone every group shows, folded as its reader left it */
  function showTab(k, save) {
    const vis = built.filter(g => !g.btn.hidden);
    if (!vis.some(g => g.key === k)) k = vis.length ? vis[0].key : null;
    tab = k;
    if (save) { try { localStorage.setItem(TAB_KEY, k); } catch (_) { /* private mode */ } }
    const on = !!desk.matches;
    document.documentElement.classList.toggle('hg-tabs', on);
    /* which tab is open, for what belongs to one tab only (the favourites' line: Games) */
    document.documentElement.setAttribute('data-hg-tab', on && k ? k : '');
    nav.setAttribute('role', on ? 'tablist' : 'navigation');
    built.forEach(g => {
      const off = on && g.key !== k;
      g.head.classList.toggle('hg-off', off);
      g.secs.forEach(s => s.classList.toggle('hg-off', off));
      g.btn.classList.toggle('on', on && g.key === k);
      if (on) { g.btn.setAttribute('role', 'tab'); g.btn.setAttribute('aria-selected', String(g.key === k)); }
      else { g.btn.removeAttribute('role'); g.btn.removeAttribute('aria-selected'); }
      g.apply(on ? false : get(g.key));
    });
    /* what was hidden measures itself again (strips, rails, charts sized on a resize) */
    if (save) { try { window.dispatchEvent(new Event('resize')); } catch (_) { /* old browser */ } }
  }
  /* an address naming a section, or a group, opens its tab and goes to it */
  function fromHash(go) {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return false;
    const g = built.find(x => x.head.id === id || x.secs.some(s => s.id === id));
    if (!g) return false;
    showTab(g.key, false);
    if (go) { const to = document.getElementById(id); if (to) setTimeout(() => to.scrollIntoView({ block: 'start' }), 0); }
    return true;
  }
  /* a group with nothing showing (every section hidden) has no head and no button */
  const sync = () => {
    built.forEach(g => { const any = g.secs.some(s => !s.hidden); g.head.hidden = !any; g.btn.hidden = !any; });
    showTab(tab, false);
  };
  sync();
  if (!fromHash(true)) showTab(tab, false);
  window.addEventListener('hashchange', () => fromHash(true));
  /* the rail's ON THIS PAGE glides to a section without changing the address first: open its tab on the way */
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a || !desk.matches || a.classList.contains('hg-btn')) return;
    const id = a.getAttribute('href').slice(1);
    const g = id && built.find(x => x.head.id === id || x.secs.some(s => s.id === id));
    if (g && g.key !== tab) showTab(g.key, false);
  }, true);
  if (desk.addEventListener) desk.addEventListener('change', () => showTab(tab, false));
  const mo = new MutationObserver(sync);
  built.forEach(g => g.secs.forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['hidden'] })));
})();
