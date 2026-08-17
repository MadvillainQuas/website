'use strict';
/* ============================================================================
   THE SOCIALS SPOTLIGHT.

   A league's Instagram, under the merchandise section: the page itself, and
   up to four posts.

   IFRAMES, NOT THEIR SCRIPT. The official embed is a blockquote plus
   //www.instagram.com/embed.js, which would mean allowing a third-party
   script on every league page for the sake of four photographs — and that
   script sets cookies, reads the page and can be changed by somebody else at
   any time. instagram.com/p/CODE/embed is the same content in a sandboxed
   frame and costs one frame-src entry in the policy.

   The trade is that a frame cannot tell us it failed. A post that has been
   deleted, or an account that has gone private, renders as a blank white
   panel and there is no event to catch — so the section says where the four
   came from and when, which is the only honest thing available.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSocials = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* Shortcodes come out of the database already reduced to [A-Za-z0-9_-], which
   is checked again here rather than trusted: this value goes into an iframe
   src, and one place doing the validating is one place to get it wrong. */
const CODE_OK = /^[A-Za-z0-9_-]{4,32}$/;

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

  const grid = el('div', 'so-grid');
  posts.forEach(p => {
    const cardEl = el('div', 'so-card');
    const f = document.createElement('iframe');
    f.src = 'https://www.instagram.com/p/' + p.code + '/embed';
    f.loading = 'lazy';
    f.title = 'Instagram post';
    /* No allow-same-origin: the frame has no business reading anything of
       ours, and the embed does not need it to render. */
    f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('scrolling', 'no');
    cardEl.appendChild(f);
    grid.appendChild(cardEl);
  });
  wrap.appendChild(grid);
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
