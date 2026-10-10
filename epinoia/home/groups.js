'use strict';
/* ============================================================================
   HOME IN GROUPS (Louie, 2026-10-10): "aesthetic, modern card backings to each section ... a grouping card visual for
   both daily fixtures and my followed, then one for feed and video, then one for Epinoia Go, then one for stars"; ON THIS
   PAGE as "proper buttons for each group ... in the strip's style"; each group collapsible.

   The sections are not moved (other scripts find them where they are): each gets its group's card backing, a head is
   put before a group's first section (its name, and a button that folds the group away - remembered), and a row of
   buttons under the hero jumps to each group. A group none of whose sections is showing has no head and no button.
   ============================================================================ */
(function () {
  const GROUPS = [
    ['games', 'Games', ['fixtures', 'followed']],
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
      if (head.classList.contains('folded')) { set(key, false); apply(false); }
      head.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    built.push({ head, btn, secs });
  });
  /* a group with nothing showing (every section hidden) has no head and no button */
  const sync = () => built.forEach(g => { const any = g.secs.some(s => !s.hidden); g.head.hidden = !any; g.btn.hidden = !any; });
  sync();
  const mo = new MutationObserver(sync);
  built.forEach(g => g.secs.forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['hidden'] })));
})();
