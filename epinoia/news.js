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

const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : null);

/* A MATCH REPORT'S CARD IS THE TWO CLUBS. news_public brings the game with the article
   (0104): the plate is cut on a diagonal, the home club's colour on the left and the away
   club's on the right, each side printed as the club cards are -- a flood with the halftone
   bitten into it -- with the crest and short name on each half and the score between them.
   A club without a crest shows its initials; a club still on the default colour takes the
   card's headline tint for its half, so the cut is always there. */
function matchPlate(a, o, plate, ink) {
  const TC = typeof window !== 'undefined' ? window.EpinoiaTeamColour : null;
  const logoUrl = typeof window !== 'undefined' ? window.epinoiaLogoUrl : null;
  const side = (k) => {
    const c = hex(a[k + '_colour']);
    const colour = (c && c.toLowerCase() !== '#93f2bf') ? c : ink;
    const half = el('div', 'mt-half ' + k);
    half.style.setProperty('--c', colour);
    half.style.setProperty('--c2', hex(a[k + '_colour_2']) || colour);
    const who = el('div', 'mt-club ' + k);
    const url = logoUrl ? logoUrl(a[k + '_logo']) : null;
    const mark = el('div', 'mt-crest');
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); mark.textContent = (a[k + '_short'] || '?').slice(0, 3); });
      mark.appendChild(img);
    } else {
      mark.textContent = (a[k + '_short'] || a[k + '_name'] || '?').slice(0, 3);
    }
    const nm = el('div', 'mt-name', a[k + '_short'] || a[k + '_name'] || '');
    nm.style.color = TC && TC.ink ? TC.ink(colour) : colour;
    who.append(mark, nm);
    return [half, who];
  };
  const [hh, hw] = side('home'), [ah, aw] = side('away');
  plate.append(hh, ah, el('div', 'mt-seam'));
  const mid = el('div', 'mt-mid');
  if (a.home_score != null && a.away_score != null) {
    mid.append(el('span', 'v', String(a.home_score)), el('span', 'd', '–'), el('span', 'v', String(a.away_score)));
  } else {
    mid.appendChild(el('span', 'vs', 'v'));
  }
  const row = el('div', 'mt-row');
  row.append(hw, mid, aw);
  plate.appendChild(row);
}

function card(a, opts) {
  const o = opts || {};
  const ink = tint(a.title);
  const isMatch = !!(a.game_id && (a.home_name || a.away_name));
  const link = el('a', 'club news-card' + (isMatch ? ' match' : ''));
  link.href = (o.base || '') + 'news/?l=' + encodeURIComponent(o.leagueSlug) +
              '&a=' + encodeURIComponent(a.slug);
  link.style.setProperty('--ink-c', ink);
  link.setAttribute('aria-label', a.title);

  const plate = el('div', 'club-plate');
  if (isMatch && !a.cover_path) matchPlate(a, o, plate, ink);
  else plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
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

  /* THE FLAG SAYS WHICH THING THIS IS, and it used to say the wrong one.

     "Latest" was printed on any PINNED article, which is a different claim
     entirely: pinning holds a piece at the front deliberately — a fixture
     announcement, a ticket link — and the newest article is whatever was
     published most recently. A match report filed minutes ago therefore sat
     second, behind a week-old piece wearing the word "Latest", which reads as
     the report being older than something published days before it.

     So the two are separated. Pinned says pinned. Latest is decided by the
     caller, which is the only place that knows the whole list — a card cannot
     see the article next to it. */
  if (a.pinned) plate.appendChild(el('div', 'news-flag pin', 'Pinned'));
  else if (opts && opts.latest) plate.appendChild(el('div', 'news-flag', 'Latest'));

  /* THE HEADLINE IS ON THE PLATE, not under it. A news card whose words sit
     below the picture reads as a picture with a caption; the point here is
     the sentence. */
  const over = el('div', 'news-over');
  over.appendChild(el('div', 'news-title', a.title));
  if (a.standfirst) over.appendChild(el('div', 'news-stand', a.standfirst));
  plate.appendChild(over);
  plate.appendChild(el('div', 'club-grain'));

  /* club-name, not club-nm. The band under a club plate is .club-name and
     always was; this said club-nm, so the date under every news card fell back
     to body type — 400-weight Archivo where the clubs beside it are 800-weight
     and letterspaced. Invisible as a bug and obvious as a difference, which is
     the worst combination. */
  const foot = el('div', 'club-foot');
  foot.append(el('span', 'club-name', when(a.published_at)),
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

  /* Which of these is actually the newest — the pin decides what LEADS, and
     that is a separate question from what is most recent. Only this level can
     answer it, because a card cannot see the ones beside it. */
  const newest = rows.reduce((best, a) =>
    (!best || new Date(a.published_at || 0) > new Date(best.published_at || 0)) ? a : best, null);

  const grid = el('div', 'news-grid');
  rows.slice(0, 5).forEach(a => grid.appendChild(
    card(a, Object.assign({ latest: newest && a.id === newest.id }, o))));
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
