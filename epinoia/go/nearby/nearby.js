'use strict';
/* ============================================================================
   EPINOIA GO - FIND A GAME (docs/epinoia-go.md 7.13).

   The games nearest the fan, inside a time window the fan sets, as a strip that slides sideways: each card
   the two clubs, how far the arena is, the day and the time. A card opens the arena on Google's map with the
   game's short preview underneath (the record of each club, their last five, and the first lines of the story
   so far, from the same season file the game page's preview reads).

   PASSPORT MODE stands the fan somewhere else: a city, a country's arenas or one arena, chosen from the arenas
   EPINOIA already knows, and the games shown are the nearest to there. It is a pin on the fan's own screen for
   this visit and nothing else.

   WHERE THE FAN IS GOES NOWHERE. Every arena and every game in the window is read once (games and venues are
   public facts, read with the reader's own rights, so a private league's games appear only for its members) and
   the distances are worked out here, on the phone, as the GO page's list of today's games does. The phone's
   position is asked for by a press, or used at once only when the browser has already been told yes. Nothing about
   it is stored; passport mode's place lives in sessionStorage, for this visit.

   THE TIME IS THE ARENA'S. A game is shown in its league's own time zone (leagues.timezone, 0172) with "local
   time" beside it when that is not the fan's; a league with no zone of its own shows the fan's clock. A tip-off
   at 00:00 there is a schedule that has not fixed the hour yet and reads "time to be confirmed".
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaGoNearby = api; if (typeof document !== 'undefined') api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const WINDOWS = [
  { key: '24h', hours: 24, label: '24 hours' },
  { key: '3d', hours: 72, label: '3 days' },
  { key: '7d', hours: 168, label: '7 days' },
  { key: '14d', hours: 336, label: '2 weeks' },
  { key: '30d', hours: 720, label: '30 days' }
];
const DEFAULT_WINDOW = '7d';
const SHOWN = 30;                     // the strip holds the nearest this many
const LATE_MS = 3 * 3600000;          // a game that tipped off up to three hours ago is still on
const PICKS = 12;                     // places offered under the passport search
const KEYS = { win: 'epinoia_go_nearby_window', place: 'epinoia_go_passport' };

/* ---------------------------------------------------------------- pure --- */

/* the same arithmetic as go.js metres(): a test holds the two together */
function metres(a, b) {
  const r = x => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
            Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function distanceText(m, locale) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  const km = m / 1000;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) + ' km';
}

const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const windowOf = key => WINDOWS.find(w => w.key === key) || WINDOWS.find(w => w.key === DEFAULT_WINDOW);

function zoneOk(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (_) { return false; }
}

/* A tip-off as the fan reads it: the day (Today, Tomorrow, or a date), the time, whether the hour is still to be
   confirmed, and whether the clock it is on is not the fan's own. `tz` is the league's IANA zone or nothing. */
function whenOf(iso, tz, now, locale) {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return { ms: NaN, day: '', time: '', tbc: true, local: false, dayDiff: null };
  const zone = zoneOk(tz) ? tz : undefined;
  const ymd = t => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const hm = (t, z) => new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  const clock = hm(ms, zone);
  const dayDiff = Math.round((Date.parse(ymd(ms) + 'T00:00:00Z') - Date.parse(ymd(now) + 'T00:00:00Z')) / 86400000);
  const day = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow'
    : new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(ms);
  return { ms, day, time, tbc: clock === '00:00', local: !!zone && clock !== hm(ms, undefined), dayDiff };
}

/* one game row from the REST read, with its arena joined: the game's own venue, else its home club's usual one
   (the rule EPINOIA GO uses everywhere: go_games_now, game_venue_id) */
function shape(g, venues) {
  const comp = g.competitions || {}, lg = (comp.seasons || {}).leagues || {};
  const home = g.home || {}, away = g.away || {};
  const vid = g.venue_id || home.home_venue_id || null;
  const v = vid && venues ? venues.get(vid) : null;
  return {
    id: g.id, tipoff_at: g.tipoff_at, status: g.status,
    home, away, homeId: g.home_team_id, awayId: g.away_team_id,
    league: lg.name || '', leagueSlug: lg.slug || null, tz: lg.timezone || null,
    competition: comp.name || '', competitionId: g.competition_id || null, seasonId: comp.season_id || null,
    venueId: vid,
    venue: (v && v.name) || g.venue || '', city: (v && v.city) || '',
    address: g.venue_address || (v && v.address) || '',
    placeId: (v && v.place_id) || null,
    lat: v && v.lat != null ? +v.lat : null, lng: v && v.lng != null ? +v.lng : null,
    /* a pin nobody has checked can be a whole country out (a Japanese arena pinned to a street in London): such a
       game is counted, never placed, as the stamp itself refuses to trust it */
    trusted: !!v && !v.pin_note
  };
}

/* the games to show from `pos` inside `hours`: on now or to come, an arena we can place, nearest first;
   `all` is everything that qualified, `shown` the strip's share of it */
function nearest(games, pos, now, hours, limit) {
  const from = now - LATE_MS, to = now + hours * 3600000;
  const rows = [];
  let unchecked = 0;
  (games || []).forEach(g => {
    const t = Date.parse(g.tipoff_at);
    if (!isFinite(t) || t < from || t >= to || g.lat == null || g.lng == null) return;
    if (!g.trusted) { unchecked++; return; }
    rows.push({ g, t, d: pos ? metres(pos, { lat: g.lat, lng: g.lng }) : null });
  });
  rows.sort((a, b) => (a.d - b.d) || (a.t - b.t) || String(a.g.id).localeCompare(String(b.g.id)));
  return { all: rows.length, unchecked, shown: rows.slice(0, limit == null ? SHOWN : limit) };
}

/* the places passport mode can go to, from the arenas we know: every city (its arenas' centre) and every arena */
function placesOf(venues) {
  const cities = new Map(), out = [];
  (venues || []).forEach(v => {
    if (v == null || v.lat == null || v.lng == null || v.pin_note) return;      // a pin nobody has checked is no place to stand
    const lat = +v.lat, lng = +v.lng;
    if (v.city) {
      const k = fold(v.city) + '|' + (v.country || '');
      const c = cities.get(k) || { kind: 'city', city: v.city, country: v.country || null, lat: 0, lng: 0, n: 0 };
      c.lat += lat; c.lng += lng; c.n++;
      cities.set(k, c);
    }
    out.push({ kind: 'arena', label: v.name + (v.city ? ' · ' + v.city : ''), key: fold(v.name), city: v.city || '',
               country: v.country || null, lat, lng, n: 1 });
  });
  cities.forEach(c => out.push({ kind: 'city', label: c.city + (c.country ? ', ' + c.country : ''), key: fold(c.city),
                                 city: c.city, country: c.country, lat: c.lat / c.n, lng: c.lng / c.n, n: c.n }));
  return out;
}

/* what the passport search offers for what was typed: cities before arenas, a name that starts with it before
   one that only holds it, the country's name counted too; with nothing typed, the cities with most arenas */
function findPlaces(places, q, regionName, limit) {
  const want = fold(q), cap = limit || PICKS;
  const region = regionName || (cc => cc || '');
  const scored = [];
  (places || []).forEach(p => {
    let s;
    if (!want) s = p.kind === 'city' ? 1 : null;
    else {
      const name = p.key, country = fold(region(p.country));
      if (name.startsWith(want)) s = 0;
      else if (name.split(/[^a-z0-9\u0080-￿]+/).some(w => w.startsWith(want))) s = 1;
      else if (name.includes(want)) s = 2;
      else if (country && (country === want || (want.length >= 3 && country.startsWith(want)))) s = 3;
      else s = null;
    }
    if (s != null) scored.push({ p, s });
  });
  scored.sort((a, b) => a.s - b.s || (a.p.kind === b.p.kind ? 0 : a.p.kind === 'city' ? -1 : 1)
    || b.p.n - a.p.n || a.p.label.localeCompare(b.p.label));
  return scored.slice(0, cap).map(x => x.p);
}

/* a club's last `n` finished games, oldest first, as 'W' / 'L' from a season file's games */
function formOf(games, teamId, n) {
  return (games || [])
    .filter(g => (g.home_team_id === teamId || g.away_team_id === teamId) && g.home_score != null && g.away_score != null
      && g.home_score !== g.away_score)
    .sort((a, b) => String(b.tipoff_at).localeCompare(String(a.tipoff_at)))
    .slice(0, n || 5)
    .reverse()
    .map(g => ((g.home_team_id === teamId) === (g.home_score > g.away_score) ? 'W' : 'L'));
}

/* Google's own pages: the map is the arena's pin; the route starts from where the fan says they are in passport
   mode and from where Google finds them otherwise */
function mapSrc(g, lang) {
  return 'https://www.google.com/maps?q=' + encodeURIComponent(g.lat + ',' + g.lng) + '&z=16&output=embed'
    + (lang ? '&hl=' + encodeURIComponent(lang) : '');
}
function directionsHref(g, origin) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(g.lat + ',' + g.lng)
    + (origin ? '&origin=' + encodeURIComponent(origin.lat + ',' + origin.lng) : '');
}
function mapHref(g) {
  // the arena's pin, not a search for its name (see go.js mapsHref)
  const q = g.lat != null && g.lng != null ? g.lat + ',' + g.lng : [g.venue, g.city].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q)
    + (g.placeId ? '&query_place_id=' + encodeURIComponent(g.placeId) : '');
}

const GEO = {
  none: 'This browser cannot tell where it is.',
  denied: 'Your phone said no to sharing its location. Allow location for this site, or for the EPINOIA app, in the phone’s settings, then try again.',
  unavailable: 'Your phone could not find where it is. Step outside, or away from thick walls, and try again.',
  timeout: 'Finding where you are took too long. Try again.'
};

/* ---------------------------------------------------------------- page --- */

const S = { cfg: null, venues: new Map(), places: [], games: [], loadedHours: 0, loading: false, loadError: false,
            win: DEFAULT_WINDOW, mode: 'live', pos: null, place: null, locating: false, geo: null, picked: null,
            seasons: new Map(), region: null, last: [], abort: null, picking: false };

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const loc = () => (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;
const lang = () => (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.lang) || (document.documentElement.lang || 'en');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const crestOf = t => window.epinoiaCrest ? window.epinoiaCrest(t || {}) : data('span', 'ep-crest', String((t && (t.short_name || t.name)) || '?').slice(0, 3));
const colourOf = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#0e6b43');
function stored(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (_) { return null; } }
function store(k, v, session) {
  try { const s = session ? sessionStorage : localStorage; if (v == null) s.removeItem(k); else s.setItem(k, v); } catch (_) { /* private mode */ }
}
function regionName(cc) {
  if (!cc) return '';
  try {
    if (!S.region) S.region = new Intl.DisplayNames([loc() || 'en'], { type: 'region' });
    return S.region.of(cc) || cc;
  } catch (_) { return cc; }
}

const near = d => d != null && d < 100;                          // at the arena's own door
const curPos = () => (S.mode === 'passport' ? S.place : S.pos);

/* ------------------------------------------------------------ reading --- */

const GAME_SELECT = 'id,tipoff_at,status,venue,venue_address,venue_id,home_team_id,away_team_id,competition_id,' +
  'home:home_team_id(name,short_name,slug,colour,logo_path,home_venue_id),' +
  'away:away_team_id(name,short_name,slug,colour,logo_path),' +
  'competitions(name,season_id,seasons(leagues(id,name,slug,timezone)))';

async function loadVenues() {
  const rows = await window.EpinoiaData.all('venues?select=id,name,city,country,address,lat,lng,place_id,pin_note&lat=not.is.null&order=id');
  S.venues = new Map(rows.map(v => [v.id, v]));
  S.places = placesOf(rows);
}

/* everything on or coming inside the biggest window asked for so far; a longer window asks again, a shorter one
   filters what it has */
async function loadGames(hours) {
  if (S.loading || (S.loadedHours >= hours && !S.loadError)) return;
  S.loading = true;
  S.loadError = false;
  drawCount();
  try {
    const from = new Date(Date.now() - LATE_MS).toISOString(), to = new Date(Date.now() + hours * 3600000).toISOString();
    const rows = await window.EpinoiaData.all('games?select=' + GAME_SELECT +
      '&status=in.(scheduled,live)&tipoff_at=gte.' + encodeURIComponent(from) + '&tipoff_at=lt.' + encodeURIComponent(to) +
      '&order=tipoff_at.asc,id.asc');
    S.games = rows.map(g => shape(g, S.venues));
    S.loadedHours = hours;
  } catch (_) { S.loadError = true; }
  S.loading = false;
  if (!S.loadError && S.loadedHours < windowOf(S.win).hours) return loadGames(windowOf(S.win).hours);
  draw();
}

/* ------------------------------------------------------------ where --- */

function locate() {
  return new Promise(res => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return res({ error: 'none' });
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      e => res({ error: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 });
  });
}

async function useMyLocation() {
  S.mode = 'live';
  store(KEYS.place, null, true);
  S.locating = true;
  S.geo = null;
  draw();
  const p = await locate();
  S.locating = false;
  if (p.error) S.geo = p.error; else S.pos = p;
  S.picked = null;
  draw();
}

function goPassport(on) {
  S.mode = on ? 'passport' : 'live';
  if (!on) { S.place = null; store(KEYS.place, null, true); }
  S.picking = on && !S.place;
  S.picked = null;
  draw();
  if (S.picking) askPlace();
}

/* the search opens (again) and takes the keyboard */
function askPlace() {
  S.picking = true;
  draw();
  const q = $('#nbQuery');
  if (q) { q.focus(); drawPlaces(); }
}

function choosePlace(p) {
  S.place = { lat: p.lat, lng: p.lng, label: p.label };
  store(KEYS.place, JSON.stringify(S.place), true);
  S.mode = 'passport';
  S.picking = false;
  S.picked = null;
  const q = $('#nbQuery');
  if (q) q.value = '';
  draw();
}

function drawHere() {
  const box = $('#nbHere');
  box.textContent = '';
  const line = box.appendChild(el('div', 'nb-line'));
  if (S.mode === 'passport') {
    line.classList.add('passport');
    line.appendChild(el('span', 'k', 'Passport mode'));
    line.appendChild(document.createTextNode(': '));
    if (S.place) {
      line.appendChild(data('b', null, S.place.label));
      const chg = line.appendChild(el('button', 'nb-link', 'change'));
      chg.type = 'button';
      chg.addEventListener('click', askPlace);
      const back = line.appendChild(el('button', 'nb-link', 'back to my location'));
      back.type = 'button';
      back.addEventListener('click', useMyLocation);
    } else line.appendChild(el('span', null, 'pick where you are headed below.'));
  } else if (S.locating) {
    line.appendChild(el('span', null, 'Finding where you are…'));
  } else if (S.pos) {
    line.appendChild(el('span', 'k', 'Using'));
    line.appendChild(document.createTextNode(': '));
    line.appendChild(el('b', null, 'your location'));
  } else {
    if (S.geo) line.appendChild(el('span', 'bad', GEO[S.geo] || GEO.unavailable));
    else line.appendChild(el('span', null, 'Press the button and the nearest games appear.'));
  }
  const b = $('#nbPassport');
  b.setAttribute('aria-pressed', String(S.mode === 'passport'));
  b.classList.toggle('on', S.mode === 'passport');
  const locBtn = $('#nbLocate');
  locBtn.disabled = S.locating;
  locBtn.classList.toggle('pri', S.mode === 'live');
  $('#nbPlaces').classList.toggle('hide', !(S.mode === 'passport' && (S.picking || !S.place)));
  b.setAttribute('aria-expanded', String(S.picking));
}

let active = -1;
function drawPlaces() {
  if (S.mode !== 'passport') return;
  const q = $('#nbQuery'), ul = $('#nbList');
  const list = findPlaces(S.places, q.value, regionName);
  ul.textContent = '';
  active = -1;
  if (!list.length) {
    ul.appendChild(el('li', 'nb-none', S.places.length ? 'No arena or city by that name.' : 'The arenas could not be read just now.'));
  }
  list.forEach((p, i) => {
    const li = ul.appendChild(el('li'));
    li.setAttribute('role', 'option');
    li.id = 'nbP' + i;
    const b = li.appendChild(el('button', 'nb-place'));
    b.type = 'button';
    b.tabIndex = -1;
    b.appendChild(data('span', 'nb-pn', p.label));
    b.appendChild(el('span', 'nb-pk', p.kind === 'city' ? 'city' : 'arena'));
    b.addEventListener('click', () => choosePlace(p));
  });
  q.setAttribute('aria-expanded', String(list.length > 0));
}

function wirePlaces() {
  const q = $('#nbQuery'), ul = $('#nbList');
  q.addEventListener('input', drawPlaces);
  q.addEventListener('keydown', e => {
    const opts = [...ul.querySelectorAll('li[role="option"]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length) return;
      e.preventDefault();
      active = e.key === 'ArrowDown' ? Math.min(opts.length - 1, active + 1) : Math.max(0, active - 1);
      opts.forEach((o, i) => o.classList.toggle('on', i === active));
      q.setAttribute('aria-activedescendant', opts[active].id);
      opts[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const b = (opts[active >= 0 ? active : 0] || {}).querySelector && opts[active >= 0 ? active : 0].querySelector('button');
      if (b) b.click();
    } else if (e.key === 'Escape' && S.mode === 'passport' && S.place) {
      e.preventDefault();
      S.picking = false;                                  // the place already chosen stays
      draw();
      $('#nbPassport').focus();
    }
  });
}

/* ------------------------------------------------------------- when --- */

function drawWhen() {
  const host = $('#nbWhen');
  host.textContent = '';
  host.appendChild(el('span', 'k', 'How far ahead'));
  WINDOWS.forEach(w => {
    const b = host.appendChild(el('button', 'go-chip nb-chip' + (w.key === S.win ? ' on' : '')));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(w.key === S.win));
    b.textContent = w.label;
    b.addEventListener('click', () => {
      if (S.win === w.key) return;
      S.win = w.key;
      store(KEYS.win, w.key);
      S.picked = null;
      loadGames(windowOf(w.key).hours);
      draw();
    });
  });
}

function drawCount(res) {
  const c = $('#nbCount');
  c.textContent = '';
  if (S.loading) { c.appendChild(el('span', 'k', 'Finding the games…')); return; }
  if (S.loadError) {
    c.appendChild(el('span', 'bad', 'The games could not be read just now.'));
    const r = c.appendChild(el('button', 'nb-link', 'try again'));
    r.type = 'button';
    r.addEventListener('click', () => loadGames(windowOf(S.win).hours));
    return;
  }
  if (!res) return;
  const add = (k, v) => {
    const s = c.appendChild(el('span', 'nb-stat'));
    s.appendChild(el('span', 'k', k));
    s.appendChild(document.createTextNode(': '));
    s.appendChild(data('b', null, String(v)));
  };
  add('Games in this window', res.all);
  if (res.all > res.shown.length) add('Shown, nearest first', res.shown.length);
  if (res.unchecked) add('Not shown: the arena’s pin is being checked', res.unchecked);
}

/* ------------------------------------------------------------ cards --- */

function card(row, i) {
  const g = row.g, w = whenOf(g.tipoff_at, g.tz, Date.now(), loc());
  const b = el('button', 'vcard nb-card');
  b.type = 'button';
  b.dataset.id = g.id;
  b.style.setProperty('--c1', colourOf(g.home.colour));
  b.style.setProperty('--c2', colourOf(g.away.colour));
  b.setAttribute('aria-expanded', String(S.picked === g.id));
  b.setAttribute('aria-controls', 'nbDetail');
  const mk = b.appendChild(el('span', 'vc-mark'));
  mk.setAttribute('aria-hidden', 'true');
  mk.appendChild(crestOf(g.home));
  const discs = b.appendChild(el('span', 'vc-crests'));
  [g.home, g.away].forEach(t => discs.appendChild(el('span', 'vc-crest')).appendChild(crestOf(t)));
  b.appendChild(near(row.d) ? el('span', 'vc-chip nb-dist', 'you are here') : data('span', 'vc-chip nb-dist', distanceText(row.d, loc())));
  const body = b.appendChild(el('span', 'vc-body'));
  body.appendChild(data('span', 'vc-venue', (g.home.name || '—') + ' v ' + (g.away.name || '—'))).style.display = 'block';
  const when = body.appendChild(el('span', 'nb-when-l'));
  when.appendChild(el('span', 'nb-day', w.day));
  if (w.tbc) when.appendChild(el('span', 'nb-tbc', 'time to be confirmed'));
  else {
    when.appendChild(data('time', 'nb-time', w.time)).dateTime = g.tipoff_at;
    if (w.local) when.appendChild(el('span', 'nb-local', 'local time'));
  }
  const meta = body.appendChild(data('span', 'vc-meta', [g.venue, g.city].filter(Boolean).join(' · ') || g.league));
  meta.style.display = 'block';
  b.addEventListener('click', () => pick(g.id));
  return b;
}

function mountStrip(host, rows) {
  host.textContent = '';
  const view = host.appendChild(el('div', 'go-strip-view nb-view'));
  view.tabIndex = -1;
  const track = view.appendChild(el('div', 'go-strip-track'));
  rows.forEach((r, i) => track.appendChild(card(r, i)));
  const prev = host.appendChild(el('button', 'go-strip-btn prev'));
  const next = host.appendChild(el('button', 'go-strip-btn next'));
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Nearer games');
  next.setAttribute('aria-label', 'Further games');
  const room = () => {
    const max = view.scrollWidth - view.clientWidth;
    prev.hidden = max < 2 || view.scrollLeft < 2;              // an arrow at an end would sit on the first card
    next.hidden = max < 2 || view.scrollLeft > max - 2;
  };
  const by = dir => view.scrollBy({ left: dir * Math.max(200, view.clientWidth * 0.85), behavior: reduced() ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => by(-1));
  next.addEventListener('click', () => by(1));
  if (S.abort) S.abort.abort();
  const life = S.abort = new AbortController(), on = { signal: life.signal };
  view.addEventListener('scroll', room, { passive: true });
  window.addEventListener('resize', room, on);
  requestAnimationFrame(room);
  /* a mouse can take it and pull, as the arenas strip can; a touch already scrolls it. A drag is not a press. */
  let down = null, moved = false;
  view.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = { x: e.clientX, left: view.scrollLeft };
    moved = false;
  });
  window.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 5) { moved = true; view.classList.add('dragging'); }
    if (moved) view.scrollLeft = down.left - dx;
  }, on);
  window.addEventListener('pointerup', () => { down = null; view.classList.remove('dragging'); }, on);
  view.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
}

/* ------------------------------------------------------------ detail --- */

function pick(id) {
  S.picked = S.picked === id ? null : id;
  document.querySelectorAll('.nb-card').forEach(c => c.setAttribute('aria-expanded', String(c.dataset.id === S.picked)));
  drawDetail();
  const d = $('#nbDetail');
  if (S.picked && d.scrollIntoView) d.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
}

/* a tile: its label, its value and a line under it; `words` are the page's own (translated), the rest are names */
function tile(k, v, sub, words) {
  const t = el('div', 'nb-tile');
  t.appendChild(el('div', 'nb-tk', k));
  t.appendChild((words ? el : data)('div', 'nb-tv', v));
  if (sub) t.appendChild((words === 'sub' ? el : data)('div', 'nb-ts', sub));
  return t;
}

function drawDetail() {
  const host = $('#nbDetail');
  host.textContent = '';
  const row = S.picked && (S.last || []).find(r => r.g.id === S.picked);
  host.classList.toggle('hide', !row);
  if (!row) return;
  const g = row.g, w = whenOf(g.tipoff_at, g.tz, Date.now(), loc());
  const head = host.appendChild(el('div', 'nb-dh'));
  const crests = head.appendChild(el('span', 'nb-dc'));
  [g.home, g.away].forEach(t => crests.appendChild(el('span', 'vc-crest')).appendChild(crestOf(t)));
  const ttl = head.appendChild(el('div', 'nb-dt'));
  ttl.appendChild(data('h3', null, (g.home.name || '—') + ' v ' + (g.away.name || '—')));
  ttl.appendChild(data('div', 'nb-dl', [g.league, g.competition].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ')));
  const x = head.appendChild(el('button', 'gp-x', '×'));
  x.type = 'button';
  x.setAttribute('aria-label', 'close');
  x.addEventListener('click', () => pick(g.id));

  const tiles = host.appendChild(el('div', 'nb-tiles'));
  tiles.appendChild(near(row.d) ? tile('distance', 'you are here', S.mode === 'passport' && S.place ? S.place.label : '', true)
    : tile('distance', distanceText(row.d, loc()), S.mode === 'passport' && S.place ? S.place.label : ''));
  const tip = tile('tip-off', w.day, null, true);
  if (!w.tbc) tip.querySelector('.nb-tv').appendChild(document.createTextNode(' · ')), tip.querySelector('.nb-tv').appendChild(data('time', null, w.time));
  tiles.appendChild(tip);
  if (w.tbc || w.local) tip.appendChild(el('div', 'nb-ts', w.tbc ? 'time to be confirmed' : 'local time'));
  tiles.appendChild(tile('venue', g.venue || '—', [g.address || g.city].filter(Boolean).join(' · ')));

  const map = host.appendChild(el('div', 'nb-map'));
  const f = map.appendChild(el('iframe'));
  f.title = 'Arena map';
  f.loading = 'lazy';
  f.referrerPolicy = 'no-referrer-when-downgrade';
  f.src = mapSrc(g, lang());
  const links = host.appendChild(el('div', 'nb-links'));
  const dir = links.appendChild(el('a', 'nb-go', 'directions ↗'));
  dir.href = directionsHref(g, S.mode === 'passport' ? S.place : null);
  const gm = links.appendChild(el('a', 'nb-go', 'open in Google Maps ↗'));
  gm.href = mapHref(g);
  [dir, gm].forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });

  const pv = host.appendChild(el('section', 'nb-pv'));
  pv.appendChild(el('h4', null, 'The story so far'));
  const body = pv.appendChild(el('div', 'nb-pvb', '…'));
  const full = host.appendChild(el('a', 'nb-go full', 'the full preview ↗'));
  full.href = '../../game/?g=' + encodeURIComponent(g.id);
  loadPreview(g).then(html => { if (S.picked === g.id) { body.textContent = ''; body.appendChild(html); } });
}

/* the short preview from the season file the game page's preview also reads: each club's record and last five,
   and the first two paragraphs of the story so far. Any missing piece is simply not written. */
async function seasonOf(g) {
  if (!g.seasonId) return null;
  if (S.seasons.has(g.seasonId)) return S.seasons.get(g.seasonId);
  const p = (async () => {
    try {
      const comps = await window.EpinoiaData.all('competitions?season_id=eq.' + encodeURIComponent(g.seasonId) + '&select=id');
      const ids = (comps || []).map(c => c.id);
      return ids.length ? await window.EpinoiaData.season(ids, { rows: false }) : null;
    } catch (_) { return null; }
  })();
  S.seasons.set(g.seasonId, p);
  return p;
}

async function loadPreview(g) {
  const box = el('div', 'nb-pvi');
  const sn = await seasonOf(g);
  const row = id => ((sn && sn.teams) || []).find(t => t.id === id) || null;
  const A = row(g.homeId), B = row(g.awayId);
  const line = (team, r) => {
    const l = box.appendChild(el('div', 'nb-team'));
    l.appendChild(data('b', null, team.name || '—'));
    const rec = l.appendChild(el('span', 'nb-rec'));
    if (r && r.gp) {
      rec.appendChild(el('span', null, r.gp + (r.gp === 1 ? ' game' : ' games') + ' · ' + (r.ppg == null ? '—' : (+r.ppg).toFixed(1)) + ' for, ' + (r.papg == null ? '—' : (+r.papg).toFixed(1)) + ' against'));
    } else rec.appendChild(el('span', null, 'no games yet this season'));
    const form = formOf(sn && sn.games, team === g.home ? g.homeId : g.awayId, 5);
    if (form.length) {
      const f = l.appendChild(el('span', 'nb-form'));
      f.setAttribute('aria-label', 'Last five');
      form.forEach(x => { const i = f.appendChild(el('i', x === 'W' ? 'w' : 'l', x === 'W' ? '✓' : '✕')); i.setAttribute('translate', 'no'); });
    }
  };
  line(g.home, A);
  line(g.away, B);
  const P = window.EpinoiaPreview;
  if (P && P.narrative) {
    const paras = P.narrative({ nameA: g.home.name || '', nameB: g.away.name || '', teamA: A, teamB: B, starsA: [], starsB: [] });
    const prose = box.appendChild(el('div', 'nb-prose'));
    prose.setAttribute('data-i18n-ctx', 'report');
    /* the preview writer escapes every name it prints; its own sentences are fixed text and numbers */
    paras.slice(0, 2).forEach(h => { const p = prose.appendChild(el('p')); p.innerHTML = h; });
  }
  return box;
}

/* --------------------------------------------------------------- page --- */

function draw() {
  drawHere();
  drawWhen();
  const strip = $('#nbStrip'), sub = $('#nbSub');
  const pos = curPos();
  if (!pos) {
    S.last = [];
    strip.classList.add('hide');
    strip.textContent = '';
    drawCount();
    drawDetail();
    sub.textContent = S.mode === 'passport' ? 'Pick a place above and its nearest games appear here.'
      : 'Press “Use my location”, or go on passport mode, and the nearest games appear here.';
    return;
  }
  sub.textContent = S.mode === 'passport' ? 'The games nearest your passport place: the distance, the day and the time.'
    : 'Nearest first, with the distance, the day and the time.';
  if (S.loading) { drawCount(); return; }
  const res = nearest(S.games, pos, Date.now(), windowOf(S.win).hours, SHOWN);
  S.last = res.shown;
  drawCount(S.loadError ? null : res);
  strip.textContent = '';
  if (S.loadError) { strip.classList.add('hide'); drawDetail(); return; }
  if (!res.shown.length) {
    strip.classList.remove('hide');
    strip.appendChild(el('div', 'go-strip-done', 'No games with a known arena in this window. Try looking further ahead.'));
    S.picked = null;
    drawDetail();
    return;
  }
  strip.classList.remove('hide');
  if (S.picked && !res.shown.some(r => r.g.id === S.picked)) S.picked = null;
  mountStrip(strip, res.shown);
  drawDetail();
}

async function boot() {
  S.cfg = window.EPINOIA_CONFIG;
  if (!S.cfg || !window.EpinoiaData) {
    const c = $('#nbCount');
    if (c) c.textContent = 'This page could not load. Try again in a moment.';
    return;
  }
  try { if (window.EpinoiaAccess && window.EpinoiaAccess.sessionReady) await window.EpinoiaAccess.sessionReady(); } catch (_) { /* signed out reads as everybody */ }
  S.win = windowOf(stored(KEYS.win)).key;
  try { const p = JSON.parse(stored(KEYS.place, true) || 'null'); if (p && isFinite(p.lat) && isFinite(p.lng)) { S.place = { lat: +p.lat, lng: +p.lng, label: String(p.label || '') }; S.mode = 'passport'; } } catch (_) { /* nothing kept */ }
  $('#nbLocate').addEventListener('click', useMyLocation);
  $('#nbPassport').addEventListener('click', () => goPassport(S.mode !== 'passport'));
  wirePlaces();
  draw();
  try { await loadVenues(); } catch (_) { S.venues = new Map(); }
  loadGames(windowOf(S.win).hours);
  /* a browser that has already been told yes needs no press */
  if (S.mode === 'live') {
    let st = null;
    try { st = navigator.permissions ? (await navigator.permissions.query({ name: 'geolocation' })).state : null; } catch (_) { st = null; }
    if (st === 'granted') useMyLocation();
  }
}

return { boot, metres, distanceText, whenOf, shape, nearest, placesOf, findPlaces, formOf, mapSrc, directionsHref, mapHref,
         windowOf, fold, WINDOWS, DEFAULT_WINDOW, SHOWN, LATE_MS, GEO, KEYS };
}));
