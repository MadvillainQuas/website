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

const CFG = window.EPINOIA_CONFIG;
const qp = new URLSearchParams(location.search);

/* ---------------------------------------------------------------------------
   WHAT THIS EMBED SHOWS, AND WHO DECIDED.

   The URL still decides first. A snippet already pasted into a club's website
   keeps doing exactly what it did, which is the only acceptable behaviour for
   markup living on somebody else's page.

   What is new is that a league administrator can register that club's website
   and say what an unconfigured embed should do there — the whole league, or
   only that club's fixtures. So the snippet can be one line with nothing in it,
   and the league can change what a club's site shows without asking the club to
   edit their page again.

   THE HOST IS ASKED FOR, NOT PROVEN. ancestorOrigins is the real parent origin
   where the browser provides it; document.referrer is the fallback and is
   whatever the embedding page says it is. Neither is a credential and nothing
   here treats one as such: every fixture this can select was already public, so
   the worst a site achieves by claiming to be another is showing itself a
   fixture list it could have asked for by name.
   --------------------------------------------------------------------------- */
let wantLeague = qp.get('l') || '';
let wantTeam = '';
let limit = Math.min(parseInt(qp.get('n'), 10) || 12, 40);
const limitFromUrl = !!qp.get('n');

function hostOfParent() {
  try {
    const a = location.ancestorOrigins;
    if (a && a.length) return new URL(a[a.length - 1]).hostname;
  } catch (_) { /* not supported in this browser */ }
  try { if (document.referrer) return new URL(document.referrer).hostname; }
  catch (_) { /* malformed referrer */ }
  return '';
}

async function siteConfig() {
  if (wantLeague) return;                 // the URL was explicit; leave it alone
  const host = hostOfParent();
  if (!host) return;
  let rows;
  try { rows = await rpc('embed_config', { p_host: host, p_kind: 'strip' }); }
  catch (_) { return; }                   // no rule, no change
  const c = rows && rows[0];
  if (!c) return;
  wantLeague = c.league_slug || '';
  wantTeam = c.team_slug || '';
  if (c.max_items && !limitFromUrl) limit = Math.min(c.max_items, 40);
  if (c.theme === 'light') document.body.setAttribute('data-theme', 'light');
}
const POLL_MS = 60000;
/* While something is live, a minute is too long. A strip on a club's homepage
   is the only thing telling somebody a game has started, and a score that is a
   minute old during a fourth quarter is a score that is wrong.

   FOUR SECONDS, not fifteen. This is the slowest surface on the platform and
   it is the one most people see: the box score reaches its viewers over a
   broadcast in about a quarter of a second, while this waited up to fifteen
   for the same basket — and up to fifteen more to notice a game had been
   finalised or put back on the listing. The request is one indexed row per
   game with no joins it does not already make, and it only runs at this rate
   while a game is actually being played, so the cost is a handful of small
   reads during the two hours a week a league is on court. */
const POLL_LIVE_MS = 4000;

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
    document.body.style.setProperty('--ep-accent', a1);
    document.body.style.setProperty('--ep-accent-2', a2);
  }
  const g = hex(q.get('bg'));
  if (g) document.body.style.setProperty('--ep-ground', g);
})();

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* The host page cannot know how tall this wants to be, so it is posted out and
   embed.js applies it. Called after every render and once after fonts have
   settled, because a face swapping in changes the card height.

   The message is deliberately shaped like the other embeds' — an iframe on
   somebody else's page is identified by that key, not by its origin. */
function postHeight() {
  try {
    parent.postMessage({ epinoiaEmbed: 'height',
                         height: document.body.scrollHeight }, '*');
  } catch (_) { /* not framed, or a host that refuses messages */ }
}

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
  a.className = 'ep-card ' + (live ? 'is-live' : final ? 'is-final' : 'is-upcoming');
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

/* the rules are read through a function rather than the table, so the answer is
   one row of slugs rather than a join the embed would have to unpick */
async function rpc(fn, args) {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
               Accept: 'application/json' },
    body: JSON.stringify(args || {})
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let lastKey = '';
/* set by load(); the poll cadence reads it. A flag rather than re-parsing
   lastKey, which is a rendering fingerprint and not a place to keep facts. */
let liveNow = false;

async function load() {
  let sel = 'games?select=id,tipoff_at,status,venue,home_score,away_score,' +
    'home:home_team_id(slug,name,short_name,colour),away:away_team_id(slug,name,short_name,colour),' +
    'competitions(name,seasons(leagues(slug,name)))' +
    '&status=in.(live,scheduled,final)&order=tipoff_at.desc&limit=60';

  /* LIVE GAMES ARE FETCHED SEPARATELY, AND ALWAYS.

     The list above is ordered tipoff_at.desc and capped at 60, which is fine
     until a league has more than sixty fixtures still to come — and then desc
     puts next May at the top and a game being played this evening falls off the
     end of the window. The strip would show everything except the one thing
     somebody is looking for.

     So live games get their own query. It is tiny (there are rarely more than
     a handful anywhere on the platform), it has no date window to fall out of,
     and the two results are merged by id. A live game cannot be missed now
     however many fixtures surround it. */
  let gs, live = [];
  try {
    [gs, live] = await Promise.all([
      api(sel),
      api('games?select=id,tipoff_at,status,venue,home_score,away_score,' +
          'home:home_team_id(slug,name,short_name,colour),away:away_team_id(slug,name,short_name,colour),' +
          'competitions(name,seasons(leagues(slug,name)))' +
          '&status=eq.live&order=tipoff_at.asc&limit=40').catch(() => [])
    ]);
    const seen = new Set(gs.map(g => g.id));
    live.forEach(g => { if (!seen.has(g.id)) gs.push(g); });
  }
  catch (e) {
    if (!lastKey) {           // keep whatever is on screen if a refresh fails
      $('#rail').textContent = '';
      $('#rail').appendChild(el('div', 'ep-empty', 'Fixtures unavailable'));
    }
    return;
  }

  if (wantLeague) {
    gs = gs.filter(g => {
      const l = g.competitions && g.competitions.seasons && g.competitions.seasons.leagues;
      return l && l.slug === wantLeague;
    });
  }
  /* A CLUB'S OWN SITE SHOWS THE CLUB'S OWN GAMES. Filtered here rather than in
     the query because the strip already holds both sides of every fixture, and
     a second round trip to narrow a list it is already carrying would be a
     round trip for nothing. */
  if (wantTeam) {
    gs = gs.filter(g => (g.home && g.home.slug === wantTeam) ||
                        (g.away && g.away.slug === wantTeam));
  }
  gs.sort(order);
  /* The cap trims the tail, never the head, and order() has already put every
     live game there — so asking for four fixtures while five are live shows
     five. Cutting a live game to honour ?n= would be honouring the wrong
     number: n is how much of the schedule to show, not a reason to hide a game
     that is being played. */
  const liveCount = gs.filter(g => g.status === 'live').length;
  liveNow = liveCount > 0;
  gs = gs.slice(0, Math.max(limit, liveCount));

  /* only touch the DOM when something actually changed — this repaints every
     minute, and a strip that flickers on someone's homepage is worse than one
     that is a few seconds stale */
  const key = gs.map(g => g.id + ':' + g.status + ':' + g.home_score + '-' + g.away_score).join('|');
  if (key === lastKey) return;
  lastKey = key;

  const rail = $('#rail');
  rail.textContent = '';
  if (!gs.length) {
    rail.appendChild(el('div', 'ep-empty', 'No fixtures'));
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

/* When the reader last touched the bar. The drift resumes IDLE_MS after, so
   nothing can leave it permanently stopped. */
let lastTouch = 0;
const IDLE_MS = 1400;
const touch = () => { lastTouch = Date.now(); };
const idle = () => !REDUCED && (Date.now() - lastTouch > IDLE_MS);

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
      if (idle()) rail.scrollLeft += SPEED * dt;
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
/* THE POINTER IS NOT CAPTURED UNTIL A DRAG HAS ACTUALLY BEGUN.

   Capturing on pointerdown is what stopped a card from opening: with the
   pointer captured by the rail, the click never reaches the anchor inside it,
   so every tap on a fixture did nothing. The rail now watches the first few
   pixels of movement and only takes the pointer once the gesture is clearly a
   drag — below that threshold it stays a click and the card opens normally.

   The same threshold decides whether to suppress the link afterwards, so
   there is one number governing "was this a click or a throw" rather than two
   that can disagree. */
const DRAG_SLOP = 6;          // px before a press becomes a drag

function wireDrag() {
  const rail = $('#rail');
  let startScroll = 0, startX = 0, moved = 0, armed = false;

  rail.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startScroll = rail.scrollLeft;
    moved = 0; armed = true; dragging = false; velocity = 0;
    touch();
  });

  rail.addEventListener('pointermove', e => {
    if (!armed || e.pointerId !== pointerId) return;
    const total = Math.abs(e.clientX - startX);

    /* below the threshold this is still a click in progress — do not scroll,
       do not capture, do not let go of the card underneath */
    if (!dragging) {
      if (total < DRAG_SLOP) return;
      dragging = true;
      rail.classList.add('dragging');
      try { rail.setPointerCapture(e.pointerId); } catch (_) {}
    }

    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    rail.scrollLeft = startScroll - (e.clientX - startX);
    /* velocity from the last move, not the whole gesture, so a drag that
       stops before release does not fling */
    velocity = -dx;
    wrap();
    touch();
  });

  const release = e => {
    if (e && e.pointerId !== pointerId) return;
    if (dragging) {
      try { rail.releasePointerCapture(pointerId); } catch (_) {}
      rail.classList.remove('dragging');
    }
    armed = false; dragging = false; pointerId = null;
    touch();
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);

  /* Only a real drag suppresses the link. A press that never passed the
     threshold is a click and must open the box score. */
  rail.addEventListener('click', e => {
    if (moved > DRAG_SLOP) { e.preventDefault(); e.stopPropagation(); }
    moved = 0;
  }, true);

  /* Pausing on hover used to latch: pointerenter can arrive before the script
     runs, or never fire inside an iframe, leaving the bar stopped forever.
     A last-interaction timestamp cannot latch — the drift resumes on its own
     a moment after the reader stops touching it. */
  rail.addEventListener('pointermove', touch, { passive: true });
  rail.addEventListener('pointerdown', touch, { passive: true });
  rail.addEventListener('focusin', touch);

  /* the wheel scrolls the bar sideways rather than the page */
  rail.addEventListener('wheel', e => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    rail.scrollLeft += d;
    velocity = 0;
    wrap();
    touch();
  }, { passive: false });
}

wireDrag();
/* The site rule is resolved before the first load, so a club's site never shows
   the whole platform for a moment and then narrows to one club. */
siteConfig().catch(() => {}).then(() => load());
/* The cadence follows the games rather than the clock: tight while anything
   is live, relaxed when nothing is. setTimeout rather than setInterval so the
   interval can change between ticks, and so a slow response can never queue a
   second request behind the first. */
let pollTimer = null;
function schedule() {
  clearTimeout(pollTimer);
  const anyLive = liveNow;
  pollTimer = setTimeout(async () => {
    try { await load(); } catch (_) { /* keep polling through a blip */ }
    schedule();
  }, anyLive ? POLL_LIVE_MS : POLL_MS);
}
schedule();
setTimeout(postHeight, 400);
