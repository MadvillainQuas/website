'use strict';
/* ============================================================================
   EPINOIA GO ON A CLUB'S PAGE: "STAMP THIS VENUE" (docs/epinoia-go.md 7.14).

   The home-venue panel of a team page carries a small EPINOIA GO card: what GO is, in one line, and the button.
   The button does what the GO page's does, for this arena only:

     signed out     it says a stamp needs an account, with the way in (a stamp is the fan's own, so it is
                    login-gated here as everywhere: stamp_venue is not callable without an account)
     signed in      the phone says where it is (the browser asks first), go_games_now is read, and the games
                    at THIS arena are looked at:
                      one whose window is open   stamp_venue checks the phone is at the arena, the game is on,
                                                 and every other rule, and keeps only the stamp
                      one still to come          "stamping opens at ..."
                      none in the next day       said plainly
     A refusal has its words, the same words the GO page gives (WHY, below - the GO page's tests hold the two
     lists together).

   The phone's location goes to the server in the stamp call and nowhere else, as on the GO page.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGoVenue = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const FRESH_MS = 45000;

/* the GO page's own sentences (go.js WHY / GEO), so a refusal reads the same wherever the button is */
const WHY = {
  signed_out: 'Sign in to stamp.',
  slow_down: 'Too many tries in a row. Wait a minute, then try again.',
  bad_location: 'Your phone gave a location that is not one. Try again.',
  no_such_game: 'That game is not there any more.',
  not_on: 'That game is not being played.',
  no_time: 'That game has no tip-off time yet, so it cannot be stamped.',
  too_early: 'Stamping opens two hours before tip-off.',
  too_late: 'Stamping closed an hour after the game.',
  no_arena: 'Nobody knows yet where this game is played.',
  arena_unchecked: 'This arena’s pin is being checked. Stamping opens here once it is.',
  imprecise: 'Your phone does not know precisely enough where it is. Turn on precise location, or step outside, and try again.',
  too_far: 'You are too far from the arena to stamp it.',
  too_fast: 'Your last stamp was too far from here, too recently.'
};
const GEO = {
  none: 'This browser cannot tell where it is.',
  denied: 'Your phone said no to sharing its location. Allow location for this site, or for the EPINOIA app, in the phone’s settings, then try again.',
  unavailable: 'Your phone could not find where it is. Step outside, or away from thick walls, and try again.',
  timeout: 'Finding where you are took too long. Try again.'
};

/* ---------------------------------------------------------------- pure --- */

/* the games at this arena, from go_games_now: [{ g, open, opens }] soonest first, and which of them is open now */
function gamesHere(rows, venueId, now) {
  const here = (rows || []).filter(g => g && g.venue_id === venueId)
    .map(g => ({ g, opens: Date.parse(g.opens_at), closes: Date.parse(g.closes_at), tip: Date.parse(g.tipoff_at) }))
    .map(x => Object.assign(x, { open: now >= x.opens && now <= x.closes }))
    .sort((a, b) => a.tip - b.tip);
  return { all: here, open: here.filter(x => x.open), next: here.find(x => !x.open && x.opens > now) || null };
}

function distanceText(m, locale) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  const km = m / 1000;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) + ' km';
}

/* the facts that go with a refusal, as label / value pairs (go.js factsOf) */
function factsOf(r, locale) {
  const time = s => (s ? new Date(s).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—');
  switch (r && r.reason) {
    case 'too_early': return [['Stamping opens', time(r.opens_at)]];
    case 'too_late': return [['Stamping closed', time(r.closed_at)]];
    case 'too_far': return [['Distance', distanceText(r.distance_m, locale)], ['A stamp needs you within', (r.radius_m || 300) + ' m']];
    case 'imprecise': return [['Your phone’s accuracy', '±' + distanceText(r.accuracy_m, locale)]];
    case 'too_fast': return [['Last stamp', r.last_venue || '—'], ['Minutes ago', String(r.minutes_ago == null ? '—' : r.minutes_ago)]];
    case 'arena_unchecked': return [['Arena', r.venue || '—']];
    default: return [];
  }
}

function whyOf(r) {
  if (!r) return 'It did not stamp. Try again in a moment.';
  return WHY[r.reason] || 'It did not stamp. Try again in a moment.';
}

/* ---------------------------------------------------------------- page --- */

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const loc = () => (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;

function locate() {
  return new Promise(res => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return res({ error: 'none' });
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      e => res({ error: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

async function call(cfg, session, fn, body) {
  try {
    const h = { apikey: cfg.supabaseAnonKey, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (session && session.token) h.Authorization = 'Bearer ' + session.token;
    const r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify(body || {}) });
    if (r.status === 404) return { missing: true };
    if (!r.ok) return { error: r.status };
    return { data: await r.json() };
  } catch (_) { return { error: 'network' }; }
}

/* the card, into `host`: { venueId, venueName, base } - base is the path up to /epinoia/ ('../' from a team page) */
function mount(host, o) {
  if (!host || !o || !o.venueId) return null;
  const cfg = window.EPINOIA_CONFIG, A = window.EpinoiaAccess;
  const base = o.base || '../';
  const box = el('div', 'gv');
  box.setAttribute('data-venue', o.venueId);
  box.appendChild(el('div', 'gv-bg')).setAttribute('aria-hidden', 'true');
  const top = box.appendChild(el('div', 'gv-top'));
  const logo = window.EpinoiaGoLogo && window.EpinoiaGoLogo.make ? window.EpinoiaGoLogo.make({ size: 'head' }) : null;
  const a = top.appendChild(el('a', 'gv-logo'));
  a.href = base + 'go/';
  a.title = 'EPINOIA GO';
  if (logo) a.appendChild(logo);
  else { const t = a.appendChild(el('span', 'gv-word')); t.setAttribute('translate', 'no'); t.textContent = 'EPINOIΛ GO'; }
  top.appendChild(el('p', 'gv-tag', 'Stamp the arenas you go to: at a game, with your phone.'));
  const row = box.appendChild(el('div', 'gv-row'));
  const btn = row.appendChild(el('button', 'gv-btn', 'stamp this venue'));
  btn.type = 'button';
  const more = row.appendChild(el('a', 'gv-more', 'how it works ›'));
  more.href = base + 'go/';
  const say = box.appendChild(el('div', 'gv-say'));
  say.setAttribute('role', 'status');
  say.setAttribute('aria-live', 'polite');

  const show = (text, kind, pairs, link) => {
    say.textContent = '';
    if (!text) return;
    const m = say.appendChild(el('div', 'gv-msg' + (kind ? ' ' + kind : '')));
    m.appendChild(el('div', null, text));
    (pairs || []).forEach(([k, v]) => {
      const s = m.appendChild(el('span', 'gv-fact'));
      s.appendChild(el('span', null, k));
      s.appendChild(document.createTextNode(': '));
      s.appendChild(data('b', null, v));
    });
    if (link) { const l = m.appendChild(el('a', 'gv-link', link.text)); l.href = link.href; }
  };

  btn.addEventListener('click', async () => {
    if (!cfg) return show('This page could not load. Try again in a moment.', 'bad');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      let session = null;
      try { session = A && A.sessionReady ? await A.sessionReady() : null; } catch (_) { session = null; }
      if (!session) {
        return show(WHY.signed_out, 'warn', [], { text: 'sign in', href: A && A.signinHref ? A.signinHref() : base + 'signin/' });
      }
      show('Finding where you are…');
      const pos = await locate();
      if (pos.error) return show(GEO[pos.error] || GEO.unavailable, 'warn');
      const list = await call(cfg, session, 'go_games_now');
      if (list.missing) return show('EPINOIA GO opens soon.', 'warn');
      if (list.error || !Array.isArray(list.data)) return show('It did not stamp. Try again in a moment.', 'bad');
      const now = Date.now(), here = gamesHere(list.data, o.venueId, now);
      if (!here.open.length) {
        if (here.next) {
          const t = new Date(here.next.opens).toLocaleString(loc(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
          return show('Stamping opens two hours before tip-off.', 'warn', [['Stamping opens', t]]);
        }
        return show('No game is being played at this arena in the next day. Stamping opens two hours before tip-off.', 'warn');
      }
      const g = here.open[0].g;
      if (!g.trusted) return show(WHY.arena_unchecked, 'warn', [['Arena', g.venue || o.venueName || '—']]);
      const r = await call(cfg, session, 'stamp_venue', { p_game: g.game_id, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.accuracy });
      if (r.missing) return show('EPINOIA GO opens soon.', 'warn');
      if (r.error || !r.data) return show('It did not stamp. Try again in a moment.', 'bad');
      if (r.data.ok) {
        const pairs = r.data.already ? [] : [['Arenas', String(r.data.arenas)], ['Stamps', String(r.data.stamps)]];
        return show(r.data.already ? 'You had already stamped this game.' : (r.data.first_time_here ? 'Stamped: a new arena.' : 'Stamped: another visit.'),
          'ok', pairs, { text: 'your stamps', href: base + 'go/stamps/' });
      }
      show(whyOf(r.data), 'bad', factsOf(r.data, loc()));
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });

  host.appendChild(box);
  return box;
}

return { mount, gamesHere, factsOf, whyOf, distanceText, WHY, GEO };
}));
