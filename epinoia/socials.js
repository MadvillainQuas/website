'use strict';
/* ============================================================================
   THE SOCIALS SPOTLIGHT.

   A league's Instagram, under the merchandise section: the page itself, and
   up to four posts.

   THE TILES THEMSELVES ARE IN igtile.js, shared with a club's own strip under
   its venue photograph. That is where the reasoning about iframes-not-scripts
   and about scaling the frame to the tile lives, because both places need it
   and both used to get the size wrong the same way.

   What stays here is the section: whose account it is, whether the four were
   chosen or taken automatically, and when they were last looked at. A frame
   cannot tell us it failed — a deleted post renders as a blank white panel with
   no event to catch — so saying where the four came from and when is the only
   honest thing available.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSocials = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* Validation belongs with the thing that builds the src, so the shortcode
   pattern is igtile.js's. This only needs to know which posts will survive it,
   to decide whether there is a row to draw at all. */
const CODE_OK = window.EpinoiaIgTile ? window.EpinoiaIgTile.CODE_OK
                                     : /^[A-Za-z0-9_-]{4,32}$/;

/* opts: { sec, host, note, rpc, leagueId } */
async function mount(o) {
  if (!o.sec) return false;
  let rows = [];
  try {
    rows = await o.rpc('league_socials_public', { p_league: o.leagueId }) || [];
  } catch (_) { return false; }
  const s = rows[0];
  if (!s || !s.instagram) return false;

  o.sec.classList.remove('hide');
  const host = o.host;
  host.textContent = '';

  const wrap = el('div', 'so-wrap');
  const head = el('div', 'so-head');
  const handle = el('div', 'so-handle');
  const a = el('a', null, '@' + s.instagram);
  a.href = 'https://www.instagram.com/' + encodeURIComponent(s.instagram) + '/';
  a.target = '_blank'; a.rel = 'noopener noreferrer';
  handle.appendChild(a);
  head.appendChild(handle);

  const posts = (s.posts || []).filter(p => p && CODE_OK.test(p.code)).slice(0, 4);
  if (posts.length) {
    head.appendChild(el('span', 'ep-micro',
      s.source === 'auto'
        ? 'the four most recent' +
          (s.refreshed_at ? ', updated ' + ago(s.refreshed_at) : '')
        : 'selected by the league'));
  }
  wrap.appendChild(head);

  if (!posts.length) {
    wrap.appendChild(el('div', 'so-empty',
      'Nothing spotlit yet — the page is linked above.'));
    host.appendChild(wrap);
    if (o.note) o.note.textContent = '@' + s.instagram;
    return true;
  }

  const grid = window.EpinoiaIgTile.grid(posts.map(p => p.code), 4);
  if (grid) wrap.appendChild(grid);
  host.appendChild(wrap);
  if (o.note) o.note.textContent = '@' + s.instagram;
  return true;
}

function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

return { mount };
}));
