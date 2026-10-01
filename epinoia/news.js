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

/* ON A PHONE THE DATE IS NUMBERS: 13/9/26 in Britain, 9/13/26 in the US, 13.9.26 in
   Germany. The reader's own locale gives the order and the separators; the day and month lose
   their leading zeros, which en-GB would otherwise print (13/09/26). A wider screen keeps the
   written date. opts: { short, locale } (the tests pass both). */
const PHONE_Q = '(max-width:820px)';
function shortDate(d, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: '2-digit' })
      .formatToParts(d)
      .map(p => (p.type === 'day' || p.type === 'month') ? String(Number(p.value)) : p.value)
      .join('');
  } catch (_) {
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2);
  }
}
const when = (iso, opts) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const o = opts || {};
  const short = o.short != null ? !!o.short
    : (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_Q).matches);
  if (short) return shortDate(d, o.locale);
  return d.toLocaleDateString(o.locale, { day: 'numeric', month: 'long', year: 'numeric' });
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

/* A MATCH REPORT'S CARD IS THE RESULT, AS A BROADCAST PUTS IT UP. news_public brings the game with
   the article (0104), and the plate is drawn from it:

     each half        one club's colour, deep, the print's halftone over it, the plate cut on a diagonal
     the cut          a slash in the LEAGUE's colour (its own, from its logo or set by hand), edged in black
     the crests       on white discs ringed in the club's colour, each with its code under it (CHE, LEI)
     the score        on a black slab, FINAL over it on the league's colour; the losing figure dimmed
     the league       its logo heading the score's column, on a white chip (its monogram on its colours
                      without one): a card seen on its own - shared, or in a feed - says whose game it was

   A club without a crest shows its initials; a club still on the default colour takes the card's
   headline tint for its half, so the cut is always there. opts.league is the league's row (the
   front page's and the news page's own); opts.full puts the clubs' names in full under the crests
   (the article's own head, which has the room) instead of their codes. */
const DEFAULT_MINT = '#93f2bf';
const ownColour = c => { const h = hex(c); return h && h.toLowerCase() !== DEFAULT_MINT ? h : null; };
/* how light a colour is, 0-1 (the WCAG weights): a near-white club colour is no card edge */
function lum(c) {
  const h = hex(c);
  if (!h) return null;
  const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/* the words on a colour: black or white, whichever reads better on it (teamcolour.js on() makes the same choice) */
const inkOn = c => { const L = lum(c); return L == null || (L + 0.05) / 0.053 >= 1.05 / (L + 0.05) ? '#0a0a0a' : '#ffffff'; };
/* A CLUB'S THREE LETTERS, as a scoreboard prints them: its short name when that is one already (CHE), else
   the first word that names it, past a club's prefix (KK Partizan, BC Wolves, CB Canarias) or a Le / La, cut
   to three. pick 'last' takes the full name's last such word instead: the way two clubs whose first words are
   the same are told apart (London Lions v London City Royals: LIO v ROY; matchPlate) */
function codeOf(short, name, pick) {
  const s = String(short || '').trim();
  if (!pick && s && s.length <= 4 && !/\s/.test(s)) return s.toUpperCase();
  const words = String((pick ? name || s : s || name) || '').trim().split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const named = words.filter(w => w.length > 3 || (w.length === 3 && w !== w.toUpperCase()));
  const pool = named.length ? named : words;
  const w = pick === 'last' ? pool[pool.length - 1] : pool[0];
  return w ? w.slice(0, 3).toUpperCase() : '';
}
/* the league's own colour, when it has one: from its logo or set by hand, never the platform's default */
function leagueColour(lg) {
  if (!lg) return null;
  const mine = !lg.colour_source || lg.colour_source === 'logo' || lg.colour_source === 'manual';
  return mine ? ownColour(lg.colour_a) : null;
}
function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  return (words.length >= 2 ? words.slice(0, 3).map(w => w[0]).join('') : String(name || '?').slice(0, 3)).toUpperCase();
}
/* THE LEAGUE'S CHIP: its logo on white, or its monogram on its colour */
function leagueChip(lg) {
  if (!lg || !(lg.name || lg.logo_path)) return null;
  const logoUrl = typeof window !== 'undefined' ? window.epinoiaLogoUrl : null;
  const chip = el('span', 'mt-league');
  chip.title = lg.name || '';
  const mono = () => {
    chip.textContent = monogram(lg.name);
    chip.classList.add('mono');
    const c = leagueColour(lg);
    if (c) { chip.style.setProperty('--lg', c); chip.style.setProperty('--lg-ink', inkOn(c)); }
  };
  const url = logoUrl && lg.logo_path ? logoUrl(lg.logo_path, 96) : null;
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = lg.name || ''; img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => { img.remove(); mono(); });
    chip.appendChild(img);
  } else mono();
  return chip;
}

function matchPlate(a, o, plate, ink) {
  const logoUrl = typeof window !== 'undefined' ? window.epinoiaLogoUrl : null;
  const opts = o || {};
  const scored = a.home_score != null && a.away_score != null;
  const won = k => scored && (k === 'home' ? a.home_score > a.away_score : a.away_score > a.home_score);
  const lost = k => scored && (k === 'home' ? a.home_score < a.away_score : a.away_score < a.home_score);
  /* the two codes, and never the same two: a derby's clubs by their last words instead */
  const codes = { home: codeOf(a.home_short, a.home_name), away: codeOf(a.away_short, a.away_name) };
  if (codes.home && codes.home === codes.away) {
    const h = codeOf(a.home_short, a.home_name, 'last'), w = codeOf(a.away_short, a.away_name, 'last');
    if (h && w && h !== w) { codes.home = h; codes.away = w; }
  }
  const side = (k) => {
    const colour = ownColour(a[k + '_colour']) || ink;
    const half = el('div', 'mt-half ' + k);
    half.style.setProperty('--c', colour);
    half.style.setProperty('--c2', hex(a[k + '_colour_2']) || colour);
    const who = el('div', 'mt-club ' + k + (won(k) ? ' win' : lost(k) ? ' lose' : ''));
    who.style.setProperty('--c', colour);
    const url = logoUrl ? logoUrl(a[k + '_logo'], 192) : null;
    const code = codes[k];
    const mark = el('div', 'mt-crest');
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); mark.textContent = code || '?'; });
      mark.appendChild(img);
    } else {
      mark.textContent = code || '?';
    }
    /* the code always; the name in full as well where the plate has the room for it (the article's head, which
       shows one or the other by its own width: kit/news.css) */
    const nm = el('div', 'mt-name');
    if (opts.full) nm.append(el('span', 'full', a[k + '_name'] || a[k + '_short'] || code), el('span', 'code', code));
    else nm.textContent = code;
    nm.title = a[k + '_name'] || '';
    who.append(mark, nm);
    return [half, who];
  };
  const [hh, hw] = side('home'), [ah, aw] = side('away');
  const lg = leagueColour(opts.league);
  if (lg) { plate.style.setProperty('--lg', lg); plate.style.setProperty('--lg-ink', inkOn(lg)); }
  plate.classList.add('mt-plate');
  plate.append(hh, ah, el('div', 'mt-shade'), el('div', 'mt-seam k'), el('div', 'mt-seam'));
  /* the score's column: the league's chip over the board, where no crest can run into it however narrow the card */
  const mid = el('div', 'mt-mid');
  const chip = leagueChip(opts.league);
  if (chip) mid.appendChild(chip);
  const board = el('div', 'mt-board');
  if (scored) {
    const st = el('span', 'mt-st' + (opts.live ? ' live' : ''), opts.live ? 'Live' : 'Final');
    if (opts.when) st.appendChild(el('span', 'when', ' · ' + opts.when));
    board.appendChild(st);
    const sc = el('span', 'mt-sc');
    sc.append(el('span', 'v' + (lost('home') ? ' lose' : ''), String(a.home_score)), el('span', 'd', '–'),
              el('span', 'v' + (lost('away') ? ' lose' : ''), String(a.away_score)));
    board.appendChild(sc);
  } else {
    board.appendChild(el('span', 'mt-sc vs', 'v'));
  }
  mid.appendChild(board);
  const row = el('div', 'mt-row');
  row.append(hw, mid, aw);
  plate.appendChild(row);
  /* the card's own colour (its edge, its shadow): the winner's, so the card is the story's colour, not a
     headline's hash; a club colour too pale to edge a white card gives way to the other's, then the tint */
  const cardInk = [won('away') ? 'away' : 'home', won('away') ? 'home' : 'away']
    .map(k => ownColour(a[k + '_colour'])).find(c => c && lum(c) <= 0.7);
  return cardInk || ink;
}
/* THE PLATE ON ITS OWN, for the article's head (news-page.js): a.home_* / a.away_* as news_public names them */
function plate(a, opts) {
  const p = el('div', 'club-plate art-plate');
  const ink = matchPlate(a, Object.assign({ full: true }, opts || {}), p, tint(String(a.home_name || '') + String(a.away_name || '')));
  p.style.setProperty('--ink-c', ink);
  p.appendChild(el('div', 'club-grain'));
  return p;
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
  if (isMatch && !a.cover_path) link.style.setProperty('--ink-c', matchPlate(a, o, plate, ink));
  else {
    plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
    ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));
  }

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
  let flag = null;
  if (a.pinned) flag = el('div', 'news-flag pin', 'Pinned');
  else if (opts && opts.latest) flag = el('div', 'news-flag', 'Latest');
  /* a match report's plate is the result, edge to edge, and a corner flag ran into a crest on a narrow card
     (and a pin's dark outline was lost on a dark club): its flag is a tab on the line under the plate instead */
  const flagOnLine = isMatch && !a.cover_path;
  if (flag && !flagOnLine) plate.appendChild(flag);

  plate.appendChild(el('div', 'club-grain'));

  /* THE HEADLINE ON ITS OWN PANEL, under the print. Laid over the plate on a scrim it fought the
     crests and the score for the same space, and on a narrow card lost; here it has the card's
     width, a teletext kicker that says what the piece is and when, and the plate keeps the clubs.
     The panel carries the card's colour down its edge. */
  const body = el('div', 'news-cbody');
  const d = a.published_at ? new Date(a.published_at) : null;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d && !isNaN(d.getTime()) ? d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() : '';
  const kick = el('div', 'news-kick');
  kick.append(el('b', null, isMatch ? 'Match report' : 'News'));
  if (day) kick.append(el('span', null, day));
  const over = el('div', 'news-over');
  over.appendChild(el('div', 'news-title', a.title));
  if (a.standfirst) over.appendChild(el('div', 'news-stand', a.standfirst));
  body.append(kick, over);
  if (flag && flagOnLine) body.appendChild(flag);

  /* who wrote it, printed as it was filed (club-ed), and the call to read it (club-name, the band
     a club plate carries) now that the date rides in the kicker */
  const foot = el('div', 'club-foot');
  foot.append(el('span', 'club-ed', a.author_name || ''),
              el('span', 'club-name', 'Read \u2192'));

  link.append(plate, body, foot);
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

return { mountHeadlines, card, tint, when, plate, codeOf };
}));
