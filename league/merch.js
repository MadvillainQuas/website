'use strict';
/* ============================================================================
   MERCHANDISE — a shop window a league gets for free the day it uploads a
   logo.

   WHAT THIS IS. Epinoia does not take money, hold stock or ship anything,
   and this deliberately does not pretend to. What it does is CONSTRUCT THE
   PRODUCTS: a shirt, a hoodie, a scarf, a print and a mug, drawn from each
   club's own crest and colours, so a league has something to show and
   something to link from on day one rather than on the day it finds a
   designer. The products click through to whatever print-on-demand storefront
   the league has actually set up; without one the section says so plainly
   instead of showing buttons that go nowhere.

   Everything is DRAWN, not photographed. A mockup is a picture of a thing that
   does not exist yet, and a photorealistic one is a promise — this is the same
   flat screenprint language as the club cards, which reads as a design rather
   than as a photograph of stock we do not have.

   THE STAR OF THE MONTH gets the top of the section, because a league shop
   sells the season it is having, not a catalogue. It reuses the plate from the
   Stars podium — the same graphic, so the two agree — and swaps in the
   player's photograph where the league has approved one.

   SAFEGUARDING. A minor is never on merchandise. Under-18 players do not come
   back from the public players read at all, and the check is repeated here
   anyway, because "it cannot happen" is not a reason to let it happen quietly
   if it ever does.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMerch = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const NS = 'http://www.w3.org/2000/svg';
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* The mark on the garment. A club that has given itself a short name has
   already decided what its monogram is — "ED" must print as ED, not as E,
   which is what taking first letters blindly did. Only a name that is one
   long word gets abbreviated, and a name of several gets their initials. */
function initials(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/* ========================================================= the products ===
   Each is a flat silhouette with the club's crest printed on it. The garment
   is dark and the ink is the club's, which is how a screenprinted shirt
   actually looks and keeps five products on a page from becoming a paint
   chart. */
function svg(vb) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', vb);
  s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  s.setAttribute('aria-hidden', 'true');
  return s;
}
const add = (parent, tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
  parent.appendChild(n);
  return n;
};

/* the crest, printed: the club's logo if it has one, its monogram if not */
function printCrest(s, club, cx, cy, size) {
  const ink = club.colour || '#93f2bf';
  if (club.__logo) {
    add(s, 'image', {
      href: club.__logo, x: cx - size / 2, y: cy - size / 2,
      width: size, height: size, preserveAspectRatio: 'xMidYMid meet'
    });
    return;
  }
  add(s, 'circle', { cx, cy, r: size / 2, fill: 'none', stroke: ink,
                     'stroke-width': size * 0.055, opacity: 0.9 });
  const t = add(s, 'text', {
    x: cx, y: cy + size * 0.145, 'text-anchor': 'middle', fill: ink,
    'font-family': 'var(--f-score, monospace)', 'font-size': size * 0.44,
    'font-weight': '700', 'letter-spacing': size * 0.01
  });
  t.textContent = initials(club.short_name || club.name);
}

const GARMENT = '#0d1c15';        // the cloth: near-black, so the ink reads

function tee(club) {
  const s = svg('0 0 200 200');
  const ink = club.colour || '#93f2bf';
  add(s, 'path', { d: 'M62 34 L84 26 Q100 40 116 26 L138 34 L162 54 L146 76 L132 66 ' +
                      'L132 172 L68 172 L68 66 L54 76 L38 54 Z',
                   fill: GARMENT, stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' });
  add(s, 'path', { d: 'M84 26 Q100 40 116 26', fill: 'none', stroke: ink,
                   'stroke-width': 1.6, opacity: 0.65 });
  printCrest(s, club, 100, 100, 54);
  return s;
}

function hoodie(club) {
  const s = svg('0 0 200 200');
  const ink = club.colour || '#93f2bf';

  /* THE HOOD IS DRAWN FIRST, so the body covers its lower half and it sits
     behind the shoulders the way a hood does. Drawn on top it read as a hole
     in the neckline rather than as a garment — which is what it did, and is
     the whole difference between this and the shirt above it. */
  add(s, 'path', { d: 'M74 54 Q72 14 100 14 Q128 14 126 54 Q100 68 74 54 Z',
                   fill: GARMENT, stroke: ink, 'stroke-width': 2,
                   'stroke-linejoin': 'round' });
  add(s, 'path', { d: 'M82 50 Q100 60 118 50', fill: 'none', stroke: ink,
                   'stroke-width': 1.2, opacity: 0.5 });

  add(s, 'path', { d: 'M62 46 L84 38 Q100 62 116 38 L138 46 L166 68 L150 92 L136 82 ' +
                      'L136 176 L64 176 L64 82 L50 92 L34 68 Z',
                   fill: GARMENT, stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' });
  add(s, 'path', { d: 'M84 38 Q100 62 116 38', fill: 'none', stroke: ink,
                   'stroke-width': 1.6, opacity: 0.7 });

  /* drawstrings, hanging from the neckline */
  add(s, 'path', { d: 'M93 56 V74 M107 56 V74', stroke: ink, 'stroke-width': 2,
                   'stroke-linecap': 'round', opacity: 0.9, fill: 'none' });
  add(s, 'circle', { cx: 93, cy: 76, r: 2.4, fill: ink });
  add(s, 'circle', { cx: 107, cy: 76, r: 2.4, fill: ink });

  /* the kangaroo pocket and the ribbed waistband, which are what a hoodie
     has and a shirt does not */
  add(s, 'path', { d: 'M72 132 h56 v22 l-10 6 H82 l-10 -6 Z', fill: 'none',
                   stroke: ink, 'stroke-width': 1.4, opacity: 0.6 });
  add(s, 'path', { d: 'M64 166 h72', stroke: ink, 'stroke-width': 1.4, opacity: 0.55 });
  for (let x = 68; x <= 132; x += 8) {
    add(s, 'path', { d: `M${x} 166 V176`, stroke: ink, 'stroke-width': 0.9, opacity: 0.35 });
  }

  printCrest(s, club, 100, 106, 40);
  return s;
}

function scarf(club) {
  const s = svg('0 0 200 200');
  const ink = club.colour || '#93f2bf';
  add(s, 'rect', { x: 66, y: 22, width: 68, height: 148, fill: GARMENT,
                   stroke: ink, 'stroke-width': 2 });
  [40, 152].forEach(y => add(s, 'rect',
    { x: 66, y, width: 68, height: 9, fill: ink, opacity: 0.85 }));
  [54, 138].forEach(y => add(s, 'rect',
    { x: 66, y, width: 68, height: 3, fill: ink, opacity: 0.45 }));
  /* the fringe */
  for (let i = 0; i < 9; i++) {
    const x = 70 + i * 7.5;
    add(s, 'path', { d: `M${x} 170 V182 M${x} 22 V10`, stroke: ink,
                     'stroke-width': 1.6, opacity: 0.7, fill: 'none' });
  }
  const t = add(s, 'text', { x: 100, y: 104, 'text-anchor': 'middle', fill: ink,
    'font-family': 'var(--f-score, monospace)', 'font-size': 17,
    'letter-spacing': 2, transform: 'rotate(-90 100 104)' });
  t.textContent = (club.name || '').toUpperCase().slice(0, 18);
  return s;
}

function poster(club) {
  const s = svg('0 0 200 200');
  const ink = club.colour || '#93f2bf';
  add(s, 'rect', { x: 44, y: 16, width: 112, height: 168, fill: GARMENT,
                   stroke: ink, 'stroke-width': 2 });
  add(s, 'rect', { x: 52, y: 24, width: 96, height: 152, fill: 'none',
                   stroke: ink, 'stroke-width': 0.8, opacity: 0.45 });
  printCrest(s, club, 100, 84, 62);
  add(s, 'path', { d: 'M56 126 h88', stroke: ink, 'stroke-width': 1, opacity: 0.5 });
  const t = add(s, 'text', { x: 100, y: 146, 'text-anchor': 'middle', fill: ink,
    'font-family': 'var(--f-score, monospace)', 'font-size': 13, 'letter-spacing': 1.5 });
  t.textContent = (club.short_name || initials(club.name)).toUpperCase();
  const u = add(s, 'text', { x: 100, y: 164, 'text-anchor': 'middle',
    fill: ink, opacity: 0.65,
    'font-family': 'var(--f-micro, monospace)', 'font-size': 7, 'letter-spacing': 2.4 });
  u.textContent = 'EPINOIA';
  return s;
}

function mug(club) {
  const s = svg('0 0 200 200');
  const ink = club.colour || '#93f2bf';
  add(s, 'rect', { x: 54, y: 56, width: 84, height: 96, rx: 6, fill: GARMENT,
                   stroke: ink, 'stroke-width': 2 });
  add(s, 'ellipse', { cx: 96, cy: 56, rx: 42, ry: 9, fill: GARMENT,
                      stroke: ink, 'stroke-width': 2 });
  add(s, 'ellipse', { cx: 96, cy: 56, rx: 34, ry: 6, fill: 'none',
                      stroke: ink, 'stroke-width': 1, opacity: 0.5 });
  add(s, 'path', { d: 'M138 78 q26 4 26 26 t-26 26', fill: 'none',
                   stroke: ink, 'stroke-width': 5, 'stroke-linecap': 'round' });
  printCrest(s, club, 96, 106, 46);
  return s;
}

const PRODUCTS = [
  { key: 'tee',    name: 'Match tee',      draw: tee,    from: 22 },
  { key: 'hoodie', name: 'Terrace hoodie', draw: hoodie, from: 42 },
  { key: 'scarf',  name: 'Bar scarf',      draw: scarf,  from: 16 },
  { key: 'poster', name: 'Crest print',    draw: poster, from: 14 },
  { key: 'mug',    name: 'Half-time mug',  draw: mug,    from: 11 }
];

/* Where a product sends somebody. The league's own storefront, with the club
   and the item named in the query so a shop that can read them lands on the
   right page and one that cannot still lands somewhere real. */
function storeHref(store, club, product) {
  if (!store) return null;
  try {
    const u = new URL(store);
    u.searchParams.set('club', club.slug || '');
    if (product) u.searchParams.set('item', product);
    return u.toString();
  } catch (_) { return store; }
}

/* ==================================================== star of the month ===
   The podium plate again, at feature size, with the player's photograph if the
   league has approved one and the printed monogram if not. The lockup sits
   over the top either way, so the card has the same silhouette whichever it
   is — a photograph that arrives later must not change the layout. */
function starCard(star, store) {
  const ink = (star.team && star.team.colour) || '#93f2bf';
  const card = el('div', 'merch-star');
  card.style.setProperty('--ink-c', ink);

  const plate = el('div', 'ms-plate');
  plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

  if (star.photo) {
    const img = document.createElement('img');
    img.className = 'ms-photo';
    img.src = star.photo;
    img.alt = star.name || 'The star of the month';
    img.loading = 'lazy';
    /* a photograph that fails to load falls back to the monogram rather than
       leaving a hole where the player should be */
    img.addEventListener('error', () => { img.remove(); plate.appendChild(monoMark(star)); });
    plate.appendChild(img);
  } else {
    plate.appendChild(monoMark(star));
  }

  /* THE LOCKUP. Two lines of type over the plate, in the club's ink, with the
     word STAR set large and hollow so the picture reads through it. */
  const lock = el('div', 'ms-lock');
  lock.appendChild(el('span', 'ms-kicker', 'Star of the'));
  lock.appendChild(el('span', 'ms-big', 'MONTH'));
  plate.appendChild(lock);
  plate.appendChild(el('div', 'club-grain'));
  card.appendChild(plate);

  const side = el('div', 'ms-side');
  side.appendChild(el('div', 'ms-eyebrow', star.span || 'this month'));
  const nm = el('a', 'ms-name', star.name || 'Player');
  nm.href = 'p/?p=' + encodeURIComponent(star.slug || '');
  side.appendChild(nm);
  side.appendChild(el('div', 'ms-team', (star.team && star.team.name) || ''));

  const figs = el('div', 'ms-figs');
  [[(star.bpm > 0 ? '+' : '') + Number(star.bpm).toFixed(1), 'BPM'],
   [star.ppg == null ? '—' : star.ppg, 'PTS'],
   [star.rpg == null ? '—' : star.rpg, 'REB'],
   [star.apg == null ? '—' : star.apg, 'AST']]
    .forEach(([v, k]) => {
      const f = el('div', 'ms-fig');
      f.append(el('span', 'v', v), el('span', 'k', k));
      figs.appendChild(f);
    });
  side.appendChild(figs);

  side.appendChild(el('p', 'ms-copy',
    'The month’s best player by box plus/minus, on a print in ' +
    ((star.team && star.team.name) || 'the club') + '’s colours.'));

  const href = storeHref(store && store.url, (star.team || {}), 'star-print');
  if (href) {
    const a = el('a', 'ms-btn', 'Get the print');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
    side.appendChild(a);
  }
  card.appendChild(side);
  return card;
}

function monoMark(star) {
  const mark = el('div', 'ms-mono');
  const t = initials(star.name);
  mark.append(el('span', 'club-mono ghost', t), el('span', 'club-mono', t));
  return mark;
}

/* ============================================================== the shop === */
function productCard(club, p, store) {
  const href = storeHref(store && store.url, club, p.key);
  const card = el(href ? 'a' : 'div', 'prod');
  if (href) {
    card.href = href;
    card.target = '_blank';
    /* nofollow because a league's shop is a commercial destination we do not
       vouch for; noopener because the page it opens must not reach back */
    card.rel = 'noopener noreferrer nofollow';
  }
  card.style.setProperty('--ink-c', club.colour || '#93f2bf');

  const art = el('div', 'prod-art');
  art.appendChild(p.draw(club));
  art.appendChild(el('div', 'club-grain'));
  card.appendChild(art);

  const foot = el('div', 'prod-foot');
  foot.append(el('span', 'prod-name', p.name),
              el('span', 'prod-club', club.short_name || club.name));
  card.appendChild(foot);
  return card;
}

/* A PUBLISHED product beats a drawing of one. Where the league has actually
   created merchandise, the rack shows the real thing with its real price and
   a link that buys it; where it has not, the drawn mockups stand in, which is
   what every league starts with. Both are the same card, so a club watching
   their page does not see the layout change under them on the day the shop
   opens. */
function publishedCard(row, cfg) {
  const card = el(row.external_url ? 'a' : 'div', 'prod live');
  if (row.external_url) {
    card.href = row.external_url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer nofollow';
  }
  card.style.setProperty('--ink-c', (row.__colour) || '#93f2bf');
  const art = el('div', 'prod-art');
  if (row.artwork_path) {
    const img = document.createElement('img');
    img.className = 'prod-print';
    img.src = cfg.supabaseUrl + '/storage/v1/object/public/merch-print/' + row.artwork_path;
    img.alt = '';
    img.loading = 'lazy';
    art.appendChild(img);
  }
  art.appendChild(el('div', 'club-grain'));
  card.appendChild(art);
  const foot = el('div', 'prod-foot');
  const p = PRODUCTS.find(x => x.key === row.kind);
  foot.append(el('span', 'prod-name', (p && p.name) || row.kind),
              el('span', 'prod-club', row.price_pennies == null ? (row.__short || '')
                : '£' + (row.price_pennies / 100).toFixed(2)));
  card.appendChild(foot);
  return card;
}

/* opts: { host, note, league, clubs, star, store, cfg, published } */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return false;
  const clubs = (opts.clubs || []).filter(Boolean);
  if (!clubs.length) return false;

  host.textContent = '';
  const store = opts.store && opts.store.url ? opts.store : null;

  if (opts.star) host.appendChild(starCard(opts.star, store));

  /* the club rail: one club's rack at a time, because five products across
     eight clubs is a catalogue and this is a shop window */
  let current = clubs[0];
  const rail = el('div', 'merch-rail');
  const rack = el('div', 'merch-rack');

  const byClub = new Map();
  (opts.published || []).forEach(r => {
    if (!byClub.has(r.team_id)) byClub.set(r.team_id, new Map());
    byClub.get(r.team_id).set(r.kind, r);
  });

  const draw = () => {
    rack.textContent = '';
    const real = byClub.get(current.id);
    PRODUCTS.forEach(p => {
      const row = real && real.get(p.key);
      if (row) {
        row.__colour = current.colour;
        row.__short = current.short_name || current.name;
        rack.appendChild(publishedCard(row, opts.cfg || {}));
      } else {
        rack.appendChild(productCard(current, p, store));
      }
    });
  };

  clubs.forEach(c => {
    const b = el('button', 'ep-chip' + (c === current ? ' on' : ''),
                 c.short_name || c.name);
    b.type = 'button';
    b.title = c.name;
    b.addEventListener('click', () => {
      current = c;
      rail.querySelectorAll('.ep-chip').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      draw();
    });
    rail.appendChild(b);
  });
  host.append(rail, rack);
  draw();

  /* what this is, and what it is not */
  const foot = el('div', 'merch-foot');
  if (store) {
    const a = el('a', 'ms-btn wide', 'Open ' + (store.name || 'the shop') + ' ↗');
    a.href = storeHref(store.url, current, null);
    a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
    foot.appendChild(a);
    foot.appendChild(el('p', 'merch-note',
      'Every item is built here from the club’s own crest and colours. ' +
      (store.name || 'The shop') + ' takes the order and ships it — Epinoia ' +
      'handles neither payment nor delivery.'));
  } else {
    foot.appendChild(el('p', 'merch-note',
      'These are built here from each club’s crest and colours, and they are ' +
      'not on sale yet: this league has no shop linked. A league administrator ' +
      'adds one in the console and every item above starts pointing at it.'));
  }
  host.appendChild(foot);

  if (opts.note) {
    const n = document.querySelector(opts.note);
    const live = (opts.published || []).length;
    if (n) n.textContent = live ? live + ' on sale'
      : (store ? (store.name || 'shop linked') : 'preview only');
  }
  return true;
}

return { render, PRODUCTS };
}));
