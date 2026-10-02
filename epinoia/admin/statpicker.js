'use strict';
/* ============================================================================
   THE STAT PICKER OF THE GRAPHICS TAB - one control for every list of stats a graphic shows (a star's stat lines, the stars of
   the week's and the month's, a table's columns, a final's team stats and its leaders' lines, the leaders' categories).

   It replaced two boxes of ticks a template (the graphic's own stats, then a folded list of the site's), where a list's order was
   the order the boxes happened to be in, a stat could only be dropped by finding its tick again, and ticking one of the first box
   silently dropped every stat chosen from the second. Now:

     THE CHOSEN       a row of chips, in the order the graphic draws them. Each has x to remove it (or Backspace / Delete on the
                      chip) and two arrows to move it (or the arrow keys on the chip; Home / End to the front or the back). A chip
                      is dragged to its place with a mouse, a pen or a finger (pointer events, so a phone drags as a desktop does).
     ADD A STAT       one search box over everything that may be added, grouped (the graphic's own first, then the site's
                      columns by group), never offering what is already chosen. Arrow keys and Enter, or a click.
     THE LIMITS       at the most, the box says so and offers nothing; at the least, x is put away. Never a silent refusal.
     RESET            back to the template's own default.

   Every change calls `set(list)` at once, so the preview redraws as the list changes. The pure parts (add, remove, move, what is
   offered) are exported and held by supabase/tests/statpicker.test.mjs, the screen in a browser.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStatPicker = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------ pure parts --- */
/* one more key at the end, unless it is there already or the list is full (then the list as it was) */
function addKey(list, key, max) {
  const l = (list || []).slice();
  if (!key || l.includes(key) || l.length >= max) return l;
  return l.concat([key]);
}
/* one key out, unless that would leave fewer than `min` */
function removeKey(list, key, min) {
  const l = (list || []).slice();
  if (!l.includes(key) || l.length <= (min || 0)) return l;
  return l.filter(k => k !== key);
}
/* a key moved to place `to` (clamped to the list) */
function moveKey(list, key, to) {
  const l = (list || []).slice(), from = l.indexOf(key);
  if (from < 0) return l;
  const at = Math.max(0, Math.min(l.length - 1, to));
  l.splice(from, 1);
  l.splice(at, 0, key);
  return l;
}
/* what may be added: every option not chosen, matching every word of the search, in its group's order:
   [{ group, label, items: [...] }] */
function offered(items, chosen, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  (items || []).forEach(it => {
    if ((chosen || []).includes(it.id)) return;
    const hay = (it.label + ' ' + (it.title || '') + ' ' + it.id + ' ' + (it.groupLabel || '')).toLowerCase();
    if (!words.every(w => hay.includes(w))) return;
    let g = out.find(x => x.group === it.group);
    if (!g) { g = { group: it.group, label: it.groupLabel || '', items: [] }; out.push(g); }
    g.items.push(it);
  });
  return out;
}

/* ------------------------------------------------------------------ view --- */
let seq = 0;
const doc = () => root.document;
const el = (t, c, x) => { const n = doc().createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

/* o: { title, items: [{ id, label, title?, group, groupLabel }], current() -> [ids], set(list), min, max, def: [ids] }
   -> the element. `items` is every option, in the order the add box lists them. */
function create(o) {
  const id = 'gxp' + (++seq);
  const min = o.min || 0, max = o.max || 8;
  const byId = new Map(o.items.map(it => [it.id, it]));
  const labelOf = k => (byId.get(k) || { label: String(k).replace(/^c:/, '').toUpperCase() }).label;
  const titleOf = k => { const it = byId.get(k); return it && it.title && it.title !== it.label ? it.title : ''; };

  const box = el('div', 'gx-pick');
  const head = el('div', 'gx-pick-h');
  const ttl = el('span', 'gx-cl', o.title);
  ttl.id = id + 'h';
  const count = el('span', 'gx-pick-n');
  head.append(ttl, count);
  const chips = el('ol', 'gx-chips');
  chips.setAttribute('aria-labelledby', id + 'h');
  const live = el('p', 'gx-pick-say');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  /* the add box: a search field over a list of options */
  const add = el('div', 'gx-add');
  const q = el('input', 'ep-input');
  q.type = 'search'; q.autocomplete = 'off'; q.id = id + 'q';
  q.setAttribute('role', 'combobox'); q.setAttribute('aria-autocomplete', 'list'); q.setAttribute('aria-expanded', 'false');
  q.setAttribute('aria-controls', id + 'm');
  q.setAttribute('aria-label', 'Add a stat');
  q.placeholder = '+ add a stat (search: ts, rebound, usage…)';
  const menu = el('div', 'gx-menu');
  menu.id = id + 'm'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
  add.append(q, menu);

  const foot = el('div', 'gx-pick-f');
  const reset = el('button', 'ep-btn mini', 'reset to default');
  reset.type = 'button';
  foot.appendChild(reset);
  box.append(head, chips, add, live, foot);

  const cur = () => (o.current() || []).slice();
  const say = t => { live.textContent = t; };
  const commit = (next, focusKey, msg) => {
    o.set(next);
    paint();
    if (msg) say(msg);
    if (focusKey) { const c = chips.querySelector('[data-k="' + focusKey + '"]'); if (c) c.focus(); }
  };
  const remove = k => {
    const list = cur(), i = list.indexOf(k);
    if (list.length <= min) { say('At least ' + min + ': add another before removing ' + labelOf(k) + '.'); return; }
    const next = removeKey(list, k, min);
    commit(next, next[Math.min(i, next.length - 1)] || null, labelOf(k) + ' removed.');
    if (!next.length) q.focus();
  };
  const move = (k, to) => {
    const list = cur();
    const next = moveKey(list, k, to);
    if (next.join() === list.join()) return;
    commit(next, k, labelOf(k) + ' moved to ' + (next.indexOf(k) + 1) + ' of ' + next.length + '.');
  };
  const addIt = k => {
    const list = cur();
    if (list.length >= max) { say('At most ' + max + ': remove one to add another.'); return; }
    commit(addKey(list, k, max), null, labelOf(k) + ' added, ' + (list.length + 1) + ' of ' + max + '.');
    q.value = '';
    openMenu(true);
    q.focus();
  };

  /* ---- the chips ---- */
  let drag = null;
  function chip(k, i, n) {
    const li = el('li', 'gx-chip');
    li.dataset.k = k; li.tabIndex = 0;
    li.setAttribute('aria-label', labelOf(k) + ', ' + (i + 1) + ' of ' + n + '. Arrow keys move it, Delete removes it.');
    if (titleOf(k)) li.title = titleOf(k);
    li.appendChild(el('span', 'gx-grip', '\u2807'));
    li.lastChild.setAttribute('aria-hidden', 'true');
    li.appendChild(el('span', 'gx-chl', labelOf(k)));
    const btn = (cls, text, label, fn, off) => {
      const b = el('button', 'gx-cb ' + cls, text);
      b.type = 'button'; b.tabIndex = -1; b.setAttribute('aria-label', label); b.title = label;
      if (off) b.disabled = true;
      b.addEventListener('click', e => { e.stopPropagation(); fn(); });
      b.addEventListener('pointerdown', e => e.stopPropagation());
      li.appendChild(b);
    };
    btn('gx-up', '\u2190', 'Move ' + labelOf(k) + ' earlier', () => move(k, i - 1), i === 0);
    btn('gx-dn', '\u2192', 'Move ' + labelOf(k) + ' later', () => move(k, i + 1), i === n - 1);
    btn('gx-x', '\u00d7', 'Remove ' + labelOf(k), () => remove(k), n <= min);
    li.addEventListener('keydown', e => {
      if (e.target !== li) return;
      const at = cur().indexOf(k);
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); remove(k); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(k, at - 1); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(k, at + 1); }
      else if (e.key === 'Home') { e.preventDefault(); move(k, 0); }
      else if (e.key === 'End') { e.preventDefault(); move(k, n - 1); }
    });
    /* DRAGGING: pointer events, so a finger drags as a mouse does. The chip follows the pointer's place among the others
       (the chip under it, else the nearest), the list is redrawn only when the pointer is let go. */
    li.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;
      drag = { k, x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
      try { li.setPointerCapture(e.pointerId); } catch (_) { /* a stub, or a pointer already gone */ }
      /* the window hears the rest of the drag too: moving the chip in the list releases the browser's capture */
      if (root.addEventListener) {
        root.addEventListener('pointermove', onMove);
        root.addEventListener('pointerup', end);
        root.addEventListener('pointercancel', end);
      }
    });
    const onMove = e => {
      if (!drag || drag.k !== k) return;
      if (!drag.on) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
        drag.on = true; li.classList.add('dragging'); box.classList.add('sorting');
      }
      e.preventDefault();
      const others = [...chips.children].filter(c => c !== li);
      let best = null, bd = Infinity;
      others.forEach(c => {
        const r = c.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - cx, (e.clientY - cy) * 2);
        if (d < bd) { bd = d; best = { c, after: e.clientY > r.bottom || (e.clientY >= r.top && e.clientX > cx) }; }
      });
      if (!best) return;
      const ref = best.after ? best.c.nextSibling : best.c;
      if (ref !== li && ref !== li.nextSibling) chips.insertBefore(li, ref);
    };
    li.addEventListener('pointermove', onMove);
    const end = () => {
      if (root.removeEventListener) {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', end);
        root.removeEventListener('pointercancel', end);
      }
      if (!drag || drag.k !== k) return;
      const was = drag.on;
      drag = null;
      li.classList.remove('dragging'); box.classList.remove('sorting');
      if (!was) return;
      const order = [...chips.children].map(c => c.dataset.k);
      const to = order.indexOf(k);
      commit(moveKey(cur(), k, to), k, labelOf(k) + ' moved to ' + (to + 1) + ' of ' + order.length + '.');
    };
    li.addEventListener('pointerup', end);
    li.addEventListener('pointercancel', end);
    return li;
  }

  /* ---- the add box's list ---- */
  let active = -1;
  function openMenu(show) {
    menu.textContent = '';
    const list = cur();
    if (list.length >= max) {
      menu.appendChild(el('div', 'gx-menu-x', 'At most ' + max + ': remove one to add another.'));
    } else {
      const groups = offered(o.items, list, q.value);
      let n = 0;
      groups.forEach(g => {
        if (g.label) { const gh = el('div', 'gx-menu-g', g.label); gh.setAttribute('role', 'presentation'); menu.appendChild(gh); }
        g.items.forEach(it => {
          const b = el('div', 'gx-opt');
          b.id = id + 'o' + (n++);
          b.setAttribute('role', 'option');
          b.dataset.k = it.id;
          b.appendChild(el('b', null, it.label));
          if (it.title && it.title !== it.label) b.appendChild(el('span', null, it.title));
          b.addEventListener('pointerdown', e => e.preventDefault());          // keep the focus in the search box
          b.addEventListener('click', () => addIt(it.id));
          menu.appendChild(b);
        });
      });
      if (!n) menu.appendChild(el('div', 'gx-menu-x', 'Nothing matches.'));
    }
    active = -1;
    menu.hidden = !show;
    q.setAttribute('aria-expanded', String(!!show));
    q.removeAttribute('aria-activedescendant');
  }
  const opts = () => [...menu.querySelectorAll('.gx-opt')];
  const light = i => {
    const all = opts();
    if (!all.length) return;
    active = (i + all.length) % all.length;
    all.forEach((b, j) => b.classList.toggle('on', j === active));
    q.setAttribute('aria-activedescendant', all[active].id);
    if (all[active].scrollIntoView) all[active].scrollIntoView({ block: 'nearest' });
  };
  q.addEventListener('focus', () => openMenu(true));
  q.addEventListener('input', () => openMenu(true));
  q.addEventListener('blur', () => root.setTimeout(() => { if (doc().activeElement !== q) { menu.hidden = true; q.setAttribute('aria-expanded', 'false'); } }, 120));
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (menu.hidden) openMenu(true); light(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); light(active - 1); }
    else if (e.key === 'Enter') {
      const all = opts(), b = all[active >= 0 ? active : (q.value && all.length ? 0 : -1)];
      if (b) { e.preventDefault(); addIt(b.dataset.k); }
    } else if (e.key === 'Escape') { menu.hidden = true; q.setAttribute('aria-expanded', 'false'); }
    else if (e.key === 'Backspace' && !q.value) { const last = chips.lastChild; if (last) { e.preventDefault(); last.focus(); } }
  });

  reset.addEventListener('click', () => commit((o.def || []).slice(), null, 'Back to the default: ' + ((o.def || []).map(labelOf).join(', ') || 'none') + '.'));

  function paint() {
    const list = cur();
    chips.textContent = '';
    list.forEach((k, i) => chips.appendChild(chip(k, i, list.length)));
    if (!list.length) { const e0 = el('li', 'gx-chip-none', 'None chosen'); chips.appendChild(e0); }
    count.textContent = list.length + ' of ' + max;
    box.classList.toggle('full', list.length >= max);
    reset.disabled = list.join() === (o.def || []).join();
    if (!menu.hidden) openMenu(true);
  }
  paint();
  box.refresh = paint;
  return box;
}

return { create, addKey, removeKey, moveKey, offered };
}));
