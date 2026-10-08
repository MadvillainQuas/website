'use strict';
/* ============================================================================
   ARENAS TICKED OFF (EPINOIA GO, Louie 2026-10-08): a fan's stamps as the arenas they have ticked off - one tile an
   arena, a tick, the town, how many times and the last - for the fan's own hub (profile/, their stamps read as
   theirs) and their public page (fan/, the stamps they show, go_feed 0177/0258).

     EpinoiaArenaTicks.group(rows)                 rows: stamps ({ venue_id, venue|venues.name, city, country,
                                                   stamped_at|created_at }) -> [{ id, name, city, country, n, last }]
     EpinoiaArenaTicks.draw(host, arenas, o)       o.goHref (where "stamp more" goes), o.empty (the words for none),
                                                   o.fresh (an arena id just ticked: it lands)
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaArenaTicks = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* stamps to arenas: a tile an arena, the newest visit first */
function group(rows) {
  const by = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r) return;
    const v = r.venues || {};
    const id = r.venue_id || v.id;
    if (!id) return;
    const at = Date.parse(r.stamped_at || r.created_at);
    const a = by.get(id) || { id, name: r.venue || v.name || '', city: r.city || v.city || '', country: r.country || v.country || '', n: 0, last: 0 };
    a.n++;
    if (isFinite(at) && at > a.last) a.last = at;
    by.set(id, a);
  });
  return Array.from(by.values()).sort((a, b) => (b.last - a.last) || a.name.localeCompare(b.name));
}

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
function dayText(ms) {
  if (!ms) return '';
  const loc = (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;
  try { return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric' }).format(ms); } catch (_) { return ''; }
}

function draw(host, arenas, o) {
  const opt = o || {};
  if (!host) return;
  host.textContent = '';
  if (!arenas.length) {
    const p = host.appendChild(el('p', 'at-none', opt.empty || 'No arenas ticked off yet.'));
    if (opt.goHref) { p.appendChild(document.createTextNode(' ')); const a = p.appendChild(el('a', null, 'EPINOIA GO →')); a.href = opt.goHref; }
    return;
  }
  const sum = host.appendChild(el('p', 'at-sum'));
  sum.appendChild(data('b', null, String(arenas.length)));
  sum.appendChild(document.createTextNode(' '));
  sum.appendChild(el('span', 'at-sum-w', arenas.length === 1 ? 'arena ticked off' : 'arenas ticked off'));
  const grid = host.appendChild(el('ul', 'at-grid'));
  arenas.forEach(a => {
    const li = grid.appendChild(el('li', 'at-tile' + (opt.fresh && opt.fresh === a.id ? ' fresh' : '')));
    const tick = li.appendChild(el('span', 'at-tick', '✓'));
    tick.setAttribute('aria-hidden', 'true');
    li.appendChild(data('b', 'at-name', a.name || '—'));
    const where = [a.city, a.country].filter(Boolean).join(' · ');
    if (where) li.appendChild(data('span', 'at-where', where));
    const when = li.appendChild(el('span', 'at-when'));
    when.appendChild(el('span', null, a.n === 1 ? 'once' : a.n + ' times'));
    const d = dayText(a.last);
    if (d) { when.appendChild(document.createTextNode(' · ')); when.appendChild(data('span', null, d)); }
  });
}

return { group, draw };
}));
