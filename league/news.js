'use strict';
/* ============================================================================
   NEWS, on the reader's side.

   Three uses of one card: the headline strip above the clubs on a league's
   front page, the full list on the news page, and the article itself.

   THE CARD IS THE CLUB CARD. A league page already teaches a reader what one
   of those plates means — a coloured field, a monogram, a caption band — and a
   second card language for the section directly above it would make the page
   harder to read to no purpose. What changes is that the cover photograph, if
   there is one, floods the whole plate instead of the colour; without one the
   generated field stands in, which is what the club cards do already.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNews = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

const when = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

/* A colour from the headline, so two articles are not the same shade and the
   same article is the same shade every time. The same trick the club plates
   use, seeded by text rather than by a stored colour — an editorial team
   should not have to pick a hex value to publish. */
function tint(seedText) {
  let h = 0;
  for (const ch of String(seedText || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return 'hsl(' + h + ' 46% 62%)';
}

function card(a, opts) {
  const o = opts || {};
  const ink = tint(a.title);
  const link = el('a', 'club news-card');
  link.href = (o.base || '') + 'news/?l=' + encodeURIComponent(o.leagueSlug) +
              '&a=' + encodeURIComponent(a.slug);
  link.style.setProperty('--ink-c', ink);
  link.setAttribute('aria-label', a.title);

  const plate = el('div', 'club-plate');
  plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

  if (a.cover_path) {
    const img = el('img', 'news-cover-img');
    img.src = o.url ? o.url(a.cover_path) : a.cover_path;
    img.alt = '';
    img.loading = 'lazy';
    /* A cover that fails to load — not yet approved, or deleted — leaves the
       generated plate behind rather than a broken frame. */
    img.addEventListener('error', () => img.remove());
    plate.appendChild(img);
  }

  if (a.pinned) plate.appendChild(el('div', 'news-flag', 'Latest'));

  /* THE HEADLINE IS ON THE PLATE, not under it. A news card whose words sit
     below the picture reads as a picture with a caption; the point here is
     the sentence. */
  const over = el('div', 'news-over');
  over.appendChild(el('div', 'news-title', a.title));
  if (a.standfirst) over.appendChild(el('div', 'news-stand', a.standfirst));
  plate.appendChild(over);
  plate.appendChild(el('div', 'club-grain'));

  const foot = el('div', 'club-foot');
  foot.append(el('span', 'club-nm', when(a.published_at)),
              el('span', 'club-ed', a.author_name || ''));

  link.append(plate, foot);
  return link;
}

/* ---- the strip above the clubs ------------------------------------------ */
/* opts: { sec, host, note, rpc, leagueId, leagueSlug, url, base } */
async function mountHeadlines(o) {
  if (!o.sec) return false;
  let rows = [];
  try {
    rows = await o.rpc('news_public', { p_league: o.leagueId, p_limit: 5, p_offset: 0 }) || [];
  } catch (_) { return false; }
  if (!rows.length) return false;

  o.sec.classList.remove('hide');
  const host = o.host;
  host.textContent = '';

  const grid = el('div', 'news-grid');
  rows.slice(0, 5).forEach(a => grid.appendChild(card(a, o)));
  host.appendChild(grid);

  const total = Number(rows[0].total || rows.length);
  if (o.note) o.note.textContent = total + (total === 1 ? ' article' : ' articles');

  const more = el('div', 'news-more');
  const a = el('a', 'ep-chip', 'show all news →');
  a.href = (o.base || '') + 'news/?l=' + encodeURIComponent(o.leagueSlug);
  more.appendChild(a);
  host.appendChild(more);
  return true;
}

return { mountHeadlines, card, tint, when };
}));
