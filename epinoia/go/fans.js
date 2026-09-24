'use strict';
/* ============================================================================
   FANS AT THIS GAME - the fans' approved photographs of one game, on its game page (EPINOIA GO 5.4).

   A strip of up to eight tiles and a link to all of them on the wall (/epinoia/go/photos/?g=<game>).
   Nothing is drawn when the game has none - most games - or before migration 0167 is pushed, so the
   game page is exactly as it was until a fan has put a photograph up.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaGoFans = api; if (typeof document !== 'undefined') api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const MAX = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* what to draw: the tiles and the link, or null for nothing */
function plan(rows, cfg, gameId, root) {
  if (!Array.isArray(rows) || !rows.length || !cfg || !UUID.test(gameId || '')) return null;
  const base = (root || '../') + 'go/photos/';
  return {
    tiles: rows.slice(0, MAX).map(r => ({
      src: cfg.supabaseUrl + '/storage/v1/object/public/go-public/' + String(r.thumb_path).split('/').map(encodeURIComponent).join('/'),
      href: base + '?g=' + encodeURIComponent(gameId) + '&p=' + encodeURIComponent(r.id),
      alt: '@' + r.username })),
    all: base + '?g=' + encodeURIComponent(gameId),
    more: rows.length > MAX
  };
}

async function boot() {
  const host = document.getElementById('goFans');
  const cfg = window.EPINOIA_CONFIG;
  const gameId = new URLSearchParams(location.search).get('g') || '';
  if (!host || !cfg || !UUID.test(gameId)) return;
  let rows = null;
  try {
    const r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/go_photos_feed', { method: 'POST', cache: 'no-store',
      headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_game: gameId, p_limit: MAX + 1 }) });
    rows = r.ok ? await r.json() : null;                 // 404 before 0167: nothing to draw
  } catch (_) { rows = null; }
  const p = plan(rows, cfg, gameId);
  if (!p) return;
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  host.textContent = '';
  const head = host.appendChild(el('div', 'gofans-h'));
  head.appendChild(el('span', 'gofans-k', 'Fans at this game'));
  const all = head.appendChild(el('a', 'gofans-all', 'all their photographs'));
  all.href = p.all;
  const strip = host.appendChild(el('div', 'gofans-strip'));
  p.tiles.forEach(t => {
    const a = strip.appendChild(el('a', 'gofans-t'));
    a.href = t.href;
    const img = a.appendChild(el('img'));
    img.src = t.src;
    img.alt = t.alt;
    img.loading = 'lazy';
    img.setAttribute('translate', 'no');
  });
  host.classList.remove('hide');
}

return { boot, plan, MAX };
}));
