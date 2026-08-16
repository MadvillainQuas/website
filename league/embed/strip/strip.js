'use strict';
/* ============================================================================
   The fixture strip — a horizontal bar of games for another site's page.

   The information a LiveStats bar carries, laid out differently on purpose:
   the wordmark reads down a narrow edge rather than sitting in a logo box, and
   a card is a SCOREBOARD — home on the left, away on the right, score between
   them — rather than two stacked rows with the score down one side. The state
   is a coloured rule along the card's top edge instead of a word in a header.

   Three things it must get right, because it runs on a page we do not control:

   LIVE GAMES COME FIRST, then upcoming, then finished. A strip is glanced at,
   not read, and the thing worth glancing at is what is happening now.

   IT REFRESHES ITSELF. An embed is left on a page for hours. Scores are polled
   rather than socketed — one small query a minute costs nothing and needs no
   connection held open per visitor, which matters when the widget is on a page
   with more traffic than this platform has.

   IT REPORTS ITS HEIGHT. The host page cannot know how tall this wants to be,
   so it is posted out and embed.js applies it.
   ============================================================================ */

const CFG = window.COURTSIDE_CONFIG;
const qp = new URLSearchParams(location.search);
const wantLeague = qp.get('l') || '';
const limit = Math.min(parseInt(qp.get('n'), 10) || 12, 40);
const POLL_MS = 60000;

/* Appearance from the query string.

   ?theme=light for club sites that are not dark, and ?accent / ?accent2 for
   their colours. Both are variable sets rather than second stylesheets, so a
   club gets their own bar without us shipping a copy of the CSS per club.

   A colour is validated before it is used: this string arrives from a URL on
   somebody else's page, and writing it unchecked into a style is how a widget
   becomes an injection point. Only #rgb / #rrggbb is accepted. */
(function appearance() {
  const q = new URLSearchParams(location.search);
  if ((q.get('theme') || '') === 'light') document.body.setAttribute('data-theme', 'light');

  const hex = v => (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(v || '')
    ? (v[0] === '#' ? v : '#' + v) : null);
  const a1 = hex(q.get('accent'));
  const a2 = hex(q.get('accent2')) || a1;
  if (a1) {
    document.body.style.setProperty('--cs-accent', a1);
    document.body.style.setProperty('--cs-accent-2', a2);
  }
  const g = hex(q.get('bg'));
  if (g) document.body.style.setProperty('--cs-ground', g);
})();

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* a three-letter code is what fits a card; prefer the club's own abbreviation */
const abbr = t => ((t && (t.short_name || t.name)) || '???')
  .replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 3).toUpperCase();

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function fmtDate(iso) {
  if (!iso) return 'TBC';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
    .replace(/^0/, '').toUpperCase();
}

function card(g) {
  const live = g.status === 'live', final = g.status === 'final';
  const a = document.createElement('a');
  a.className = 'cs-card ' + (live ? 'is-live' : final ? 'is-final' : 'is-upcoming');
  a.target = '_blank'; a.rel = 'noopener';
  a.href = new URL('../../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase',
                   location.href).href;

  /* competition and state, small, above the scoreboard */
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'comp', (g.competitions && g.competitions.name) || 'Fixture'));
  const st = el('span', 'st');
  if (live) { st.appendChild(el('span', 'dot')); st.appendChild(document.createTextNode('LIVE')); }
  else st.textContent = final ? 'FT' : 'UPCOMING';
  meta.appendChild(st);
  a.appendChild(meta);

  /* home | score | away, laid out across as a scoreboard is */
  const row = el('div', 'row');
  const side = (t, sc, other) => {
    const box = el('div', 'tm' + (final ? (sc > other ? ' win' : sc < other ? ' lose' : '') : ''));
    const cr = el('span', 'crest', abbr(t).slice(0, 2));
    cr.style.background = (t && t.colour) || '#93f2bf';
    box.append(cr, el('span', 'abbr', abbr(t)));
    return box;
  };
  row.appendChild(side(g.home, g.home_score, g.away_score));

  const mid = el('div', 'mid');
  if (live || final) {
    const sc = el('div', 'sc');
    sc.append(el('span', 'v', String(g.home_score == null ? 0 : g.home_score)),
              el('span', 'd', '–'),
              el('span', 'v', String(g.away_score == null ? 0 : g.away_score)));
    mid.appendChild(sc);
  } else {
    mid.appendChild(el('div', 'vs', 'v'));
  }
  row.appendChild(mid);
  row.appendChild(side(g.away, g.away_score, g.home_score));
  a.appendChild(row);

  const when = el('div', 'when');
  when.appendChild(el('span', 'vn', live ? (g.venue || 'in progress') : fmtDate(g.tipoff_at)));
  when.appendChild(el('span', null, live ? 'watch ↗' : fmtTime(g.tipoff_at)));
  a.appendChild(when);
  return a;
}

/* live first, then what is coming, then what is done — a strip is glanced at */
const RANK = { live: 0, scheduled: 1, final: 2 };
function order(a, b) {
  const r = RANK[a.status] - RANK[b.status];
  if (r) return r;
  const ta = new Date(a.tipoff_at || 0), tb = new Date(b.tipoff_at || 0);
  return a.status === 'final' ? tb - ta : ta - tb;   // upcoming ascending, finished descending
}

let lastKey = '';

async function load() {
  let sel = 'games?select=id,tipoff_at,status,venue,home_score,away_score,' +
    'home:home_team_id(name,short_name,colour),away:away_team_id(name,short_name,colour),' +
    'competitions(name,seasons(leagues(slug,name)))' +
    '&status=in.(live,scheduled,final)&order=tipoff_at.desc&limit=60';

  let gs;
  try { gs = await api(sel); }
  catch (e) {
    if (!lastKey) {           // keep whatever is on screen if a refresh fails
      $('#rail').textContent = '';
      $('#rail').appendChild(el('div', 'cs-empty', 'Fixtures unavailable'));
    }
    return;
  }

  if (wantLeague) {
    gs = gs.filter(g => {
      const l = g.competitions && g.competitions.seasons && g.competitions.seasons.leagues;
      return l && l.slug === wantLeague;
    });
  }
  gs.sort(order);
  gs = gs.slice(0, limit);

  /* only touch the DOM when something actually changed — this repaints every
     minute, and a strip that flickers on someone's homepage is worse than one
     that is a few seconds stale */
  const key = gs.map(g => g.id + ':' + g.status + ':' + g.home_score + '-' + g.away_score).join('|');
  if (key === lastKey) return;
  lastKey = key;

  const rail = $('#rail');
  rail.textContent = '';
  if (!gs.length) {
    rail.appendChild(el('div', 'cs-empty', 'No fixtures'));
  } else {
    /* Two copies. The loop wraps at the halfway mark, where the halves are
       pixel-identical, so the seam is invisible. The duplicate is hidden from
       assistive technology — it is the same fixtures a second time, and a
       screen reader should not read the list twice. */
    gs.forEach(g => rail.appendChild(card(g)));
    const dup = document.createElement('div');
    dup.style.cssText = 'display:contents';
    dup.setAttribute('aria-hidden', 'true');
    gs.forEach(g => { const c = card(g); c.tabIndex = -1; dup.appendChild(c); });
    rail.appendChild(dup);
  }
  postHeight();
  startMotion();
}


/* ============================================================================
   MOTION — it scrolls itself, and you can throw it.

   The bar drifts left continuously so a page with it on looks alive without
   anyone touching it, and stops the moment a pointer is over it, because
   something moving under the cursor you are trying to click is infuriating.

   Dragging is a real throw, not a scrollbar. Velocity is sampled over the last
   few pointer moves and carried on after release with exponential decay, so a
   flick coasts and a slow drag stops where you left it. The decay constant is
   applied per frame at 60fps and normalised by the real frame time, so it
   behaves the same on a 144Hz screen as on a 60Hz one.

   The list is duplicated once and the scroll position wraps at the halfway
   point, which is what makes the loop seamless — at the wrap the two halves
   are pixel-identical, so nothing visibly jumps.

   None of it runs for a reader who has asked for reduced motion.
   ============================================================================ */
const REDUCED = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SPEED = 0.28;        // px per frame at 60fps — a drift, not a carousel
const FRICTION = 0.94;     // per 60fps frame; a flick coasts about a second
const MIN_V = 0.04;        // below this, momentum has finished

let auto = !REDUCED;
let velocity = 0;
let dragging = false;
let pointerId = null;
let lastX = 0, lastT = 0;
let rafId = null;

/* The rail holds two copies of the fixture list. Wrapping at the halfway mark
   is invisible because the halves are identical there. */
function halfWidth() {
  const rail = $('#rail');
  return rail.scrollWidth / 2;
}

function wrap() {
  const rail = $('#rail');
  const half = halfWidth();
  if (half < 8) return;
  if (rail.scrollLeft >= half) rail.scrollLeft -= half;
  else if (rail.scrollLeft < 0) rail.scrollLeft += half;
}

function tick(now) {
  const rail = $('#rail');
  const dt = lastT ? Math.min(4, (now - lastT) / 16.667) : 1;   // in 60fps frames
  lastT = now;

  if (!dragging) {
    if (Math.abs(velocity) > MIN_V) {
      rail.scrollLeft += velocity * dt;
      velocity *= Math.pow(FRICTION, dt);
    } else {
      velocity = 0;
      if (auto) rail.scrollLeft += SPEED * dt;
    }
    wrap();
  }
  rafId = requestAnimationFrame(tick);
}

function startMotion() {
  if (REDUCED || rafId) return;
  lastT = 0;
  rafId = requestAnimationFrame(tick);
}

/* ---- pointer drag, with a real throw ---- */
function wireDrag() {
  const rail = $('#rail');
  let startScroll = 0, startX = 0, moved = 0;

  rail.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true; pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startScroll = rail.scrollLeft;
    moved = 0; velocity = 0;
    rail.classList.add('dragging');
    rail.setPointerCapture(e.pointerId);
  });

  rail.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    rail.scrollLeft = startScroll - (e.clientX - startX);
    /* sample velocity from the last move rather than the whole gesture, so a
       drag that stops before release does not fling */
    velocity = -dx;
    wrap();
  });

  const release = e => {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false; pointerId = null;
    rail.classList.remove('dragging');
    /* a drag that barely moved was a click on a card — do not throw the bar */
    if (moved < 4) velocity = 0;
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);

  /* a real drag must not also follow the link under the cursor */
  rail.addEventListener('click', e => {
    if (moved > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* stop drifting under a pointer that is trying to read or click */
  rail.addEventListener('pointerenter', () => { auto = false; });
  rail.addEventListener('pointerleave', () => { if (!REDUCED) auto = true; });
  rail.addEventListener('focusin', () => { auto = false; });
  rail.addEventListener('focusout', () => { if (!REDUCED) auto = true; });

  /* the wheel should scroll the bar sideways, not the page */
  rail.addEventListener('wheel', e => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    rail.scrollLeft += d;
    velocity = 0;
    wrap();
  }, { passive: false });
}

/* the host page cannot know how tall this wants to be, so tell it */
function postHeight() {
  try {
    const h = Math.max(104, document.querySelector('.cs-strip').offsetHeight);
    parent.postMessage({ courtsideEmbed: 'height', height: h }, '*');
  } catch (_) {}
}

if (wantLeague) $('#plate').href = new URL('../../l/?l=' + encodeURIComponent(wantLeague),
                                           location.href).href;
wireDrag();
load();
setInterval(load, POLL_MS);
setTimeout(postHeight, 400);
