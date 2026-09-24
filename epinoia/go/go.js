'use strict';
/* ============================================================================
   EPINOIA GO — stamping an arena at a game (docs/epinoia-go.md).

   THE PAGE (go/index.html), as Louie redesigned it on 2026-09-24:
     - an intro: the screen goes black (white on the dark theme), asks for a username, says "Have Fun!"
       and gives the page back - on a first visit, and for a signed-in fan who still has no username;
     - the logo big over the night sky, and under it the one button: "find the game I'm at". The phone
       says where it is, once; the games on now or soon are listed nearest first, measured on the phone
       (go_games_now takes no location, 0165); "stamp this venue" sends the location to stamp_venue, which
       checks it and keeps only the stamp. After a stamp: a note about the occasion (0168) and a photograph;
     - the arenas in the fan's country they have not stamped, sliding past;
     - the leaderboard, by distance, games or venues (0166, 0168), overall or one league at a time;
     - THE FEED, two rows of the fans' photographs, changing (0167);
     - the fan's own stamps: the game, the score, which game of theirs it was, how far from the last.
   THE STAMPS PAGE (go/stamps/): every game, the distance between each, notes, photographs, the map.

   Every refusal the server can give has words here, with the number that goes with it.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaGo = api; if (typeof document !== 'undefined') api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const ALLOW_M = 200;        // the phone's own doubt allowed for, as stamp_venue allows it
const NEAR_M = 50000;       // after locating, the games within 50 km are listed
const FRESH_MS = 45000;     // an older position is asked for again before stamping

/* ---------------------------------------------------------------- pure --- */

function metres(a, b) {
  const r = x => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
            Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* What a game is to a fan standing at `pos` at `now`: 'here' (stampable), 'far', 'later' (its window has
   not opened), 'over', or 'checking' (its arena's pin waits for a person). The server decides; this only
   says which button to show. */
function placeOf(g, pos, now) {
  const opens = Date.parse(g.opens_at), closes = Date.parse(g.closes_at);
  const open = now >= opens && now <= closes;
  const d = pos && g.lat != null && g.lng != null ? metres(pos, { lat: g.lat, lng: g.lng }) : null;
  const inside = d != null && d <= (g.radius_m || 300) + Math.min(Math.max(pos.accuracy || 0, 0), ALLOW_M);
  let state;
  if (!g.trusted) state = 'checking';
  else if (!open) state = now < opens ? 'later' : 'over';
  else state = inside ? 'here' : 'far';
  return { d, open, inside, state };
}

/* the games to show once the phone has said where it is: stampable first, then nearest; within 50 km */
function nearby(games, pos, now) {
  const order = { here: 0, far: 1, later: 2, checking: 3, over: 4 };
  return games.map(g => Object.assign({ g }, placeOf(g, pos, now)))
    .filter(x => x.d != null && x.d <= NEAR_M && x.state !== 'over')
    .sort((a, b) => order[a.state] - order[b.state] || a.d - b.d);
}

function nearest(games, pos) {
  let best = null;
  games.forEach(g => {
    if (g.lat == null) return;
    const d = metres(pos, { lat: g.lat, lng: g.lng });
    if (!best || d < best.d) best = { g, d };
  });
  return best;
}

/* A fan's numbers from their own stamps - arenas, stamps, and the journey (D2): from each stamp's arena to
   the next one's in the order made, summed. The same arithmetic as migration 0166's go_numbers, so the
   passport needs nothing but the fan's stamps; the ranks come from the server. */
function numbersOf(stamps) {
  const s = (stamps || []).filter(x => x.venues && x.venues.lat != null && x.venues.lng != null)
    .slice().sort((a, b) => String(a.stamped_at).localeCompare(String(b.stamped_at)));
  let km = 0;
  for (let i = 1; i < s.length; i++) {
    km += metres({ lat: s[i - 1].venues.lat, lng: s[i - 1].venues.lng }, { lat: s[i].venues.lat, lng: s[i].venues.lng }) / 1000;
  }
  return { arenas: new Set((stamps || []).map(x => x.venue_id)).size, stamps: (stamps || []).length, km };
}

/* THE JOURNEY, STAMP BY STAMP, for the fan's cards and their stamps page: in the order made, each with
   which game of theirs it was (n) and the trip that led to it - from the last stamped arena with a pin, the
   same legs numbersOf sums. [{ s, n, legKm, from }], oldest first; legKm null for the first. */
function journeyOf(stamps) {
  const s = (stamps || []).slice().sort((a, b) => String(a.stamped_at).localeCompare(String(b.stamped_at)));
  let prev = null;
  return s.map((x, i) => {
    const v = x.venues || {};
    let legKm = null, from = null;
    if (v.lat != null && v.lng != null) {
      if (prev) { legKm = metres(prev, { lat: v.lat, lng: v.lng }) / 1000; from = prev.name; }
      prev = { lat: v.lat, lng: v.lng, name: v.name || null };
    }
    return { s: x, n: i + 1, legKm, from };
  });
}

/* per league, busiest first: [{ league_id, league, arenas, stamps, km }] */
function byLeague(stamps) {
  const groups = new Map();
  (stamps || []).forEach(x => {
    if (!x.league_id) return;
    const g = groups.get(x.league_id) || { league_id: x.league_id, league: (x.leagues && x.leagues.name) || '', list: [] };
    g.list.push(x);
    groups.set(x.league_id, g);
  });
  return [...groups.values()].map(g => Object.assign({ league_id: g.league_id, league: g.league }, numbersOf(g.list)))
    .sort((a, b) => b.arenas - a.arenas || b.km - a.km || a.league.localeCompare(b.league));
}

/* BADGES (4.4), worked out on the phone from the fan's stamps like the rest of the passport: the first stamp,
   ten arenas, a thousand kilometres, and every arena a league has played in over the last 13 months (0166's
   go_leagues counts them; before 0166 is pushed, or for a league with fewer than two, there is no such
   badge). [{ key, label, got, have, of, km?, league? }]: have and of are the way there. */
const BADGE_ARENAS = 10, BADGE_KM = 1000;
function badgesOf(stamps, leagues) {
  const n = numbersOf(stamps);
  const out = [
    { key: 'first', label: 'first stamp', got: n.stamps >= 1, have: Math.min(n.stamps, 1), of: 1 },
    { key: 'arenas', label: 'arenas', got: n.arenas >= BADGE_ARENAS, have: Math.min(n.arenas, BADGE_ARENAS), of: BADGE_ARENAS },
    { key: 'km', label: 'travelled', km: true, got: n.km >= BADGE_KM, have: Math.min(n.km, BADGE_KM), of: BADGE_KM },
  ];
  byLeague(stamps).forEach(l => {
    const lg = (leagues || []).find(x => x.league_id === l.league_id);
    const total = lg ? Number(lg.arenas_total) || 0 : 0;
    if (total < 2) return;
    out.push({ key: 'league:' + l.league_id, label: 'every arena', league: l.league || lg.league || '',
               got: l.arenas >= total, have: Math.min(l.arenas, total), of: total });
  });
  return out;
}

/* THE LEADERBOARD'S ORDER, on the phone as well as the server: the server ranks (0166, and by games since
   0168), and the page ranks the same rows again, so the board by games is right before 0168 is pushed too
   (the server then answers by arenas). Ties share a rank, as rank() does. */
const BOARD_ORDER = { km: ['km', 'arenas'], stamps: ['stamps', 'arenas', 'km'], arenas: ['arenas', 'km'] };
function rerank(rows, by) {
  const order = BOARD_ORDER[by] || BOARD_ORDER.arenas;
  const num = (x, k) => Number(x[k]) || 0;
  const s = (rows || []).slice().sort((a, b) => {
    for (const k of order) { const d = num(b, k) - num(a, k); if (d) return d; }
    return 0;
  });
  let rank = 0, prev = null;
  return s.map((x, i) => {
    const sig = order.map(k => num(x, k)).join('|');
    if (sig !== prev) { rank = i + 1; prev = sig; }
    return Object.assign({}, x, { rank });
  });
}

/* THE FAN'S COUNTRY, for the arenas still to tick off. Nothing stores a home country, so the page asks, in
   order: the one this browser chose before; the country of the clubs and leagues the fan follows; where
   most of their stamps are; the time zone; the language's region. Only a country with arenas counts. */
const TZ_CC = {
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Helsinki': 'FI', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Europe/Lisbon': 'PT', 'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE', 'Europe/Amsterdam': 'NL', 'Europe/Berlin': 'DE', 'Europe/Rome': 'IT', 'Europe/Warsaw': 'PL',
  'Europe/Vilnius': 'LT', 'Europe/Riga': 'LV', 'Europe/Tallinn': 'EE', 'Europe/Prague': 'CZ', 'Europe/Bratislava': 'SK',
  'Europe/Budapest': 'HU', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Ljubljana': 'SI', 'Europe/Zagreb': 'HR',
  'Europe/Sarajevo': 'BA', 'Europe/Belgrade': 'RS', 'Europe/Podgorica': 'ME', 'Europe/Skopje': 'MK', 'Europe/Sofia': 'BG',
  'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR', 'Asia/Jerusalem': 'IL', 'Asia/Dubai': 'AE', 'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Australia/Hobart': 'AU', 'Australia/Darwin': 'AU',
  'Pacific/Auckland': 'NZ', 'America/Mexico_City': 'MX', 'America/Mazatlan': 'MX', 'America/Hermosillo': 'MX',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA'
};
function countryGuess(o) {
  const avail = (o && o.available) || [];
  const ok = c => !!c && avail.includes(c);
  const top = list => {
    const m = new Map();
    (list || []).map(c => String(c || '').toUpperCase()).filter(ok).forEach(c => m.set(c, (m.get(c) || 0) + 1));
    let best = null;
    m.forEach((n, c) => { if (!best || n > best[1]) best = [c, n]; });
    return best ? best[0] : null;
  };
  const region = (/[-_]([A-Za-z]{2})\b/.exec((o && o.lang) || '') || [])[1];
  const stored = String((o && o.stored) || '').toUpperCase();
  return (ok(stored) && stored) || top(o && o.follows) || top(o && o.stamps)
    || (ok(TZ_CC[o && o.tz]) ? TZ_CC[o.tz] : null) || (region && ok(region.toUpperCase()) ? region.toUpperCase() : null)
    || avail[0] || null;
}

const loc = () => (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;

function kmText(km, locale) {
  if (km == null || !isFinite(km)) return '—';
  return new Intl.NumberFormat(locale || loc(), { maximumFractionDigits: km < 100 ? 1 : 0 }).format(km) + ' km';
}

function distanceText(m, locale) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  const km = m / 1000;
  return new Intl.NumberFormat(locale || loc(), { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) + ' km';
}

const timeText = s => s ? new Date(s).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : '—';
const dayText = s => s ? new Date(s).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/* Every reason stamp_venue can refuse with, in words; the facts that go with it are label: value pairs. */
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
  too_fast: 'Your last stamp was too far from here, too recently.',
};
const SLOW_HOUR = 'Too many tries this hour. Try again later.';

function factsOf(r) {
  switch (r && r.reason) {
    case 'too_early': return [['Stamping opens', timeText(r.opens_at)]];
    case 'too_late': return [['Stamping closed', timeText(r.closed_at)]];
    case 'too_far': return [['Distance', distanceText(r.distance_m)], ['A stamp needs you within', (r.radius_m || 300) + ' m']];
    case 'imprecise': return [['Your phone’s accuracy', '±' + distanceText(r.accuracy_m)]];
    case 'too_fast': return [['Last stamp', r.last_venue || '—'], ['Minutes ago', String(r.minutes_ago == null ? '—' : r.minutes_ago)]];
    case 'arena_unchecked': return [['Arena', r.venue || '—']];
    default: return [];
  }
}

function whyOf(r) {
  if (!r) return 'It did not stamp. Try again in a moment.';
  if (r.reason === 'slow_down' && Number(r.retry_after) >= 3600) return SLOW_HOUR;
  return WHY[r.reason] || 'It did not stamp. Try again in a moment.';
}

const GEO = {
  none: 'This browser cannot tell where it is.',
  denied: 'Your phone said no to sharing its location. Allow location for this site, or for the EPINOIA app, in the phone’s settings, then try again.',
  unavailable: 'Your phone could not find where it is. Step outside, or away from thick walls, and try again.',
  timeout: 'Finding where you are took too long. Try again.',
};

/* the username's words, the profile page's (me.js): the same account pack translates both */
const UNAME_WHY = {
  short: 'At least 3 characters.',
  long: '20 characters at most.',
  start: 'Start with a letter.',
  characters: 'Letters, digits and underscores only.',
  reserved: 'That name is kept for EPINOIA itself.',
  blocked: 'Please choose a different name.',
  taken: 'Taken. Try another.',
};
const UNAME_FORMAT = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
function unameLocal(v) {
  if (v.length < 3) return 'short';
  if (v.length > 20) return 'long';
  if (!/^[A-Za-z]/.test(v)) return 'start';
  if (!UNAME_FORMAT.test(v)) return 'characters';
  return '';
}

/* a note's refusals (set_stamp_note, 0168) */
const NOTE_WHY = { too_long: '280 characters at most.', no_such_stamp: 'That stamp is not yours any more.', signed_out: 'Sign in first.' };

/* ---------------------------------------------------------------- page --- */

const S = { cfg: null, access: null, session: null, games: [], pos: null, mine: null, username: undefined,
            ranks: null, settings: null, leagues: null, board: { league: null, by: 'km' }, noteOk: null,
            country: null, feedTimer: null,
            photos: undefined };      // undefined: not asked yet; false: 0167 not pushed; true: photographs on
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const onStampsPage = () => !!document.getElementById('goStampsPage');
const signinHref = () => (S.access && S.access.signinHref ? S.access.signinHref() : '../signin/');

/* THE ONLY THINGS THIS PAGE KEEPS IN THE BROWSER: whether the intro has played, a "later" for this visit,
   and the country the fan picked for the strip. Never a location. */
const KEYS = { intro: 'epinoia_go_intro', later: 'epinoia_go_intro_later', country: 'epinoia_go_country',
               uname: 'epinoia_go_uname' };
function stored(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (_) { return null; } }
function store(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (_) { /* private mode */ } }

async function session() {
  try { return S.access && S.access.sessionReady ? await S.access.sessionReady() : null; } catch (_) { return null; }
}

function headers(json) {
  const h = { apikey: S.cfg.supabaseAnonKey, Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  if (S.session && S.session.token) h.Authorization = 'Bearer ' + S.session.token;
  return h;
}

/* one call; a function or table not on the server yet comes back as { missing } */
async function rpc(fn, body) {
  try {
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store',
      headers: headers(true), body: JSON.stringify(body || {}) });
    if (r.status === 404) return { missing: true };
    if (!r.ok) return { error: r.status };
    return { data: await r.json() };
  } catch (e) { return { error: 'network' }; }
}

async function restGet(path) {
  try {
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers: headers(false) });
    if (!r.ok) return { error: r.status };
    return { data: await r.json() };
  } catch (_) { return { error: 'network' }; }
}

const publicUrl = p => S.cfg.supabaseUrl + '/storage/v1/object/public/go-public/' + String(p || '').split('/').map(encodeURIComponent).join('/');
const crestOf = t => window.epinoiaCrest ? window.epinoiaCrest(t || {}) : data('span', 'ep-crest', String((t && (t.short_name || t.name)) || '?').slice(0, 3));
const colourOf = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#0e6b43');

async function loadGames() {
  const r = await rpc('go_games_now');
  if (r.missing) return 'missing';
  S.games = Array.isArray(r.data) ? r.data : [];
  return S.games;
}

function facts(host, pairs) {
  if (!pairs.length) return;
  const f = host.appendChild(el('div', 'go-facts'));
  pairs.forEach(([k, v]) => {
    const s = f.appendChild(el('span'));
    s.appendChild(el('span', null, k));
    s.appendChild(document.createTextNode(': '));
    s.appendChild(data('b', null, v));
  });
}

function say(text, kind, pairs, link) {
  const host = $('#goSay');
  host.textContent = '';
  if (!text) return;
  const box = host.appendChild(el('div', 'go-say' + (kind ? ' ' + kind : '')));
  box.appendChild(el('div', null, text));
  if (link) {
    const a = box.appendChild(el('a', null, link.text));
    a.href = link.href;
    a.style.display = 'inline-block';
    a.style.marginTop = '6px';
  }
  facts(box, pairs || []);
}

function closed(msg) {
  ['#goAt', '#goMineSec', '#goStripSec', '#goFeedSec', '#goBoardsSec', '#goFind'].forEach(s => { const n = $(s); if (n) n.classList.add('hide'); });
  const c = $('#goClosed');
  if (!c) return;
  c.textContent = msg || 'EPINOIA GO opens soon.';
  c.classList.remove('hide');
}

function drawToday() {
  const t = $('#goToday');
  if (!t) return;
  t.textContent = '';
  const leagues = new Set(S.games.map(g => g.league_id).filter(Boolean)).size;
  const chip = (key, k, v) => {
    const s = t.appendChild(el(key ? 'button' : 'span', 'go-chip'));
    s.appendChild(el('span', 'k', k));
    s.appendChild(document.createTextNode(': '));
    s.appendChild(data('b', null, v));
    if (!key) return;
    s.type = 'button';
    s.setAttribute('aria-haspopup', 'dialog');
    s.setAttribute('aria-expanded', 'false');
    wireChip(s, key);
  };
  chip('open', 'Games open to stamp now', String(openNow(Date.now()).length));
  chip('all', 'Today and tomorrow', String(S.games.length));
  chip(null, 'Leagues', String(leagues));
}

/* ------------------------------------------------- today's games, listed (7.11) --- */

/* Louie, 2026-09-24: hovering or pressing "Games open to stamp now" or "Today and tomorrow" lists those games
   - the teams, the arena, and how far each one is from the fan. How far is worked out on the phone, from the
   list go_games_now already gave it: the location is never sent for it. A press asks the phone where it is
   (the browser asks the fan first, the first time); a hover only uses a location this site may already have,
   so a pointer passing over never makes the browser ask. A drop-down under the chips on a desktop, a sheet
   from the foot of the screen on a phone; scrolls when it is long. */
const openNow = (now, games) => (games || S.games).filter(g => now >= Date.parse(g.opens_at) && now <= Date.parse(g.closes_at));
const POP = { el: null, key: null, pinned: false, hover: false, anchor: null, timer: null, locating: false, geo: null };

/* the list: open now nearest first (by tip-off until the phone has said where it is); today and tomorrow by
   tip-off, under their days */
function gamesFor(key, pos, now, games) {
  const list = key === 'open' ? openNow(now, games) : (games || S.games).slice();
  const rows = list.map(g => ({ g, d: pos && g.lat != null && g.lng != null ? metres(pos, { lat: g.lat, lng: g.lng }) : null }));
  if (key === 'open' && pos) rows.sort((a, b) => (a.d == null) - (b.d == null) || (a.d || 0) - (b.d || 0));
  else rows.sort((a, b) => Date.parse(a.g.tipoff_at) - Date.parse(b.g.tipoff_at));
  return rows;
}

function dayLabel(iso, now) {
  const a = new Date(now), b = new Date(iso);
  const k = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  return k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : k === -1 ? 'Yesterday' : dayText(iso);
}

function drawPop() {
  const p = POP.el, key = POP.key, now = Date.now();
  const pos = S.pos && now - S.pos.at < 10 * 60000 ? S.pos : null;
  p.textContent = '';
  const rows = gamesFor(key, pos, now);
  const head = p.appendChild(el('div', 'gp-head'));
  head.appendChild(el('b', null, key === 'open' ? 'Games open to stamp now' : 'Today and tomorrow'));
  head.appendChild(data('span', 'gp-count', String(rows.length)));
  const x = head.appendChild(el('button', 'gp-x', '×'));
  x.type = 'button';
  x.setAttribute('aria-label', 'close');
  x.addEventListener('click', () => closePop());
  const loc = p.appendChild(el('div', 'gp-loc'));
  if (pos) loc.appendChild(el('span', null, 'How far each one is from where you are.'));
  else if (POP.locating) loc.appendChild(el('span', null, 'Finding where you are…'));
  else {
    if (POP.geo) loc.appendChild(el('span', 'bad', GEO[POP.geo] || GEO.unavailable));
    const b = loc.appendChild(el('button', 'gp-where', 'show how far each one is'));
    b.type = 'button';
    b.addEventListener('click', () => whereAmI(true));
  }
  if (!rows.length) {
    p.appendChild(el('div', 'gp-none', key === 'open' ? 'No games open to stamp right now.' : 'No games today or tomorrow.'));
    return;
  }
  const ol = p.appendChild(el('ol', 'gp-list'));
  let day = null;
  rows.forEach(({ g, d }) => {
    if (key === 'all') {
      const dl = dayLabel(g.tipoff_at, now);
      if (dl !== day) { day = dl; ol.appendChild(el('li', 'gp-day', dl)); }
    }
    const open = now >= Date.parse(g.opens_at) && now <= Date.parse(g.closes_at);
    const here = !!pos && placeOf(g, pos, now).state === 'here';        // the stamp's own rule
    const li = ol.appendChild(el('li', 'gp-row' + (here ? ' here' : '')));
    const top = li.appendChild(el('div', 'gp-top'));
    top.appendChild(data('span', 'gp-lg', g.league || ''));
    top.appendChild(data('time', 'gp-time', timeText(g.tipoff_at))).dateTime = g.tipoff_at;
    const st = top.appendChild(el('span', 'gp-st' + (open ? ' open' : '')));
    if (open) st.appendChild(el('span', null, 'open now'));
    else { st.appendChild(el('span', null, 'Stamping opens')); st.appendChild(document.createTextNode(' ')); st.appendChild(data('b', null, timeText(g.opens_at))); }
    const m = li.appendChild(data('a', 'gp-m', (g.home || '—') + ' v ' + (g.away || '—')));
    m.href = '../game/?g=' + encodeURIComponent(g.game_id);
    const ar = li.appendChild(el('div', 'gp-ar'));
    ar.appendChild(data('span', 'gp-venue', [g.venue, g.city].filter(Boolean).join(' · ') || '—'));
    if (d != null) ar.appendChild(data('b', 'gp-d', distanceText(d)));
    if (here && open && g.trusted && !stamped(g.game_id)) {
      const b = li.appendChild(el('button', 'ep-btn pri gp-stamp', S.session ? 'stamp this venue' : 'sign in to stamp'));
      b.type = 'button';
      b.addEventListener('click', () => {
        if (!S.session) { location.href = signinHref(); return; }
        closePop();
        const at = $('#goAt');
        if (at && at.scrollIntoView) at.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        stamp(g, b);
      });
    }
  });
}

/* a drop-down under the chips where a pointer can hover; a sheet from the foot of the screen on a phone */
function placePop() {
  const p = POP.el;
  const sheet = !(typeof matchMedia === 'function' && matchMedia('(hover: hover) and (min-width: 700px)').matches);
  p.classList.toggle('sheet', sheet);
  p.classList.toggle('drop', !sheet);
  const host = sheet ? document.body : $('#goToday');
  if (host && p.parentNode !== host) host.appendChild(p);
}

function openPop(key, anchor, pinned) {
  if (!POP.el) {
    POP.el = el('div', 'go-pop');
    POP.el.setAttribute('role', 'dialog');
    POP.el.hidden = true;
    POP.el.addEventListener('mouseenter', () => { POP.hover = true; clearTimeout(POP.timer); });
    POP.el.addEventListener('mouseleave', () => { POP.hover = false; if (!POP.pinned) closeSoon(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && POP.el && !POP.el.hidden) closePop(true); });
    document.addEventListener('click', e => {
      if (!POP.el || POP.el.hidden || POP.el.contains(e.target) || (e.target.closest && e.target.closest('#goToday .go-chip'))) return;
      closePop();
    });
  }
  clearTimeout(POP.timer);
  POP.pinned = pinned || (POP.pinned && POP.key === key);
  POP.key = key;
  POP.anchor = anchor;
  POP.el.setAttribute('aria-label', key === 'open' ? 'Games open to stamp now' : 'Today and tomorrow');
  document.querySelectorAll('#goToday button.go-chip').forEach(b => b.setAttribute('aria-expanded', String(b === anchor)));
  placePop();
  drawPop();
  POP.el.hidden = false;
  document.documentElement.classList.toggle('go-pop-sheet', POP.el.classList.contains('sheet'));
}

function closePop(refocus) {
  if (!POP.el || POP.el.hidden) return;
  POP.el.hidden = true;
  POP.pinned = false;
  POP.hover = false;
  document.documentElement.classList.remove('go-pop-sheet');
  document.querySelectorAll('#goToday button.go-chip').forEach(b => b.setAttribute('aria-expanded', 'false'));
  if (refocus && POP.anchor) POP.anchor.focus();
}

function closeSoon() {
  clearTimeout(POP.timer);
  POP.timer = setTimeout(() => { if (!POP.pinned && !POP.hover) closePop(); }, 220);
}

/* where the fan is, for how far: a press may make the browser ask; a hover only uses what this site may have */
async function whereAmI(pressed) {
  if (S.pos && Date.now() - S.pos.at < 2 * 60000) { if (POP.el && !POP.el.hidden) drawPop(); return; }
  if (!pressed) {
    let state = null;
    try { state = navigator.permissions ? (await navigator.permissions.query({ name: 'geolocation' })).state : null; } catch (_) { state = null; }
    if (state !== 'granted') return;
  }
  POP.locating = true;
  POP.geo = null;
  if (POP.el && !POP.el.hidden) drawPop();
  const pos = await locate();
  POP.locating = false;
  if (pos.error) POP.geo = pos.error; else S.pos = pos;
  if (POP.el && !POP.el.hidden) drawPop();
}

function wireChip(btn, key) {
  const hoverable = () => typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
  btn.addEventListener('mouseenter', () => {
    if (!hoverable() || POP.pinned) return;
    clearTimeout(POP.timer);
    POP.timer = setTimeout(() => { openPop(key, btn, false); whereAmI(false); }, 120);
  });
  btn.addEventListener('mouseleave', () => { if (!POP.pinned) closeSoon(); });
  btn.addEventListener('click', () => {
    if (POP.el && !POP.el.hidden && POP.key === key && POP.pinned) { closePop(); return; }
    openPop(key, btn, true);
    whereAmI(true);
  });
}

/* ------------------------------------------------------------- the intro --- */

/* A fan's first visit on this device, and a signed-in fan with no username - every visit until they choose
   one, or say "later" for this visit. "Have Fun!" is the first visit's alone: after that, answering just gives
   the page back. Signed out, a username needs an account first: the intro says so, with a way in and a way
   past. intro-early.js has already put the screen up, before the first paint, from what this browser knew;
   this settles it once the database has answered. */
function introMode() {
  const noName = !!S.session && S.username === null;         // 0163 answered: no name yet
  if (noName) return stored(KEYS.later, true) === '1' ? null : 'ask';
  if (stored(KEYS.intro) === '1') return null;
  return S.session ? 'welcome' : 'signin';
}

function entered() { document.documentElement.classList.add('go-entered'); }

/* for intro-early.js next time: whether this account has a username - never the name */
function rememberName() {
  if (S.session && S.session.userId && S.username !== undefined) {
    store(KEYS.uname, JSON.stringify({ u: S.session.userId, has: !!S.username }));
  }
}

/* the page back: the screen fades (it stays up while intro-early.js's mark comes off, then goes) */
function fadeIntro(box) {
  const html = document.documentElement;
  box.hidden = false;
  box.classList.add('on');
  html.removeAttribute('data-go-intro');
  requestAnimationFrame(() => {
    box.classList.remove('on');
    entered();
    setTimeout(() => { box.hidden = true; html.classList.remove('go-intro-open'); }, reduced() ? 50 : 760);
  });
}

/* "Have Fun!" takes the prompt's place, holds, and the page comes back - on the first visit only */
function leaveIntro(box, msg, others) {
  const first = stored(KEYS.intro) !== '1';
  store(KEYS.intro, '1');
  others.forEach(n => n && n.classList.add('out'));
  msg.classList.add('out');
  const quick = reduced();
  if (!first) { setTimeout(() => fadeIntro(box), quick ? 0 : 300); return; }
  setTimeout(() => {
    msg.textContent = 'Have Fun!';
    msg.classList.add('fun');
    msg.classList.remove('out');
  }, quick ? 60 : 520);
  setTimeout(() => fadeIntro(box), quick ? 900 : 520 + 1600);
}

function intro() {
  const box = $('#goIntro');
  const html = document.documentElement;
  const early = html.getAttribute('data-go-intro');
  rememberName();
  const mode = box ? introMode() : null;
  if (!mode) {
    // the screen went up on a guess (the username not known on this browser), and there is nothing to ask
    if (box && early) fadeIntro(box);
    else entered();
    return;
  }
  const msg = $('#goIntroMsg'), form = $('#goIntroForm'), input = $('#goIntroIn'), ok = $('#goIntroOk'),
        hint = $('#goIntroHint'), alt = $('#goIntroAlt'), note = box.querySelector('.gi-note');
  // up at once, with this mode's words: already up if intro-early.js guessed so
  box.dataset.mode = mode;
  html.setAttribute('data-go-intro', mode);
  html.classList.add('go-intro-open');
  box.hidden = false;
  const finish = () => leaveIntro(box, msg, [form, hint, alt, note]);
  if (mode === 'welcome') { setTimeout(finish, reduced() ? 0 : 450); return; }
  if (mode === 'signin') {
    const a = $('#goIntroSignin');
    a.href = signinHref();
    $('#goIntroLook').addEventListener('click', finish, { once: true });
    setTimeout(() => a.focus(), 200);
    return;
  }
  $('#goIntroLater').addEventListener('click', () => { store(KEYS.later, '1', true); finish(); }, { once: true });
  if (document.activeElement !== input) setTimeout(() => input.focus(), 100);
  const setHint = (t, kind) => { hint.textContent = ''; hint.className = 'gi-hint' + (kind ? ' ' + kind : '');
    [].concat(t || []).forEach(p => hint.appendChild(p && p.name ? data('b', null, '@' + p.name) : document.createTextNode(p || ''))); };
  let asked = 0, timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    ok.disabled = true;
    const v = input.value.trim();
    if (!v) { setHint(''); return; }
    const local = unameLocal(v);
    if (local) { setHint(UNAME_WHY[local], 'bad'); return; }
    setHint('Checking…');
    const n = ++asked;
    timer = setTimeout(async () => {
      const r = await rpc('username_check', { p: v });
      if (n !== asked) return;
      if (!r.data) { setHint('Could not check just now.', 'bad'); return; }
      if (r.data.ok) { setHint([{ name: v }, ' is available.'], 'ok'); ok.disabled = false; }
      else setHint(UNAME_WHY[r.data.reason] || 'Please choose a different name.', 'bad');
    }, 320);
  });
  // a name typed while the page was still arriving (the box is there from the first paint) is checked now
  if (input.value.trim()) input.dispatchEvent(new Event('input'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (ok.disabled) return;
    ok.disabled = true;
    setHint('Saving…');
    S.session = await session();
    const r = await rpc('set_username', { p: input.value.trim() });
    if (r.data && r.data.ok) {
      S.username = r.data.username;
      rememberName();
      try { window.dispatchEvent(new CustomEvent('epinoia:username', { detail: { username: S.username } })); } catch (_) { /* a nicety */ }
      finish();
      drawPublic();
      return;
    }
    ok.disabled = false;
    setHint((r.data && UNAME_WHY[r.data.reason]) || 'Please choose a different name.', 'bad');
  });
}

/* ------------------------------------------------------------ the stamps --- */

/* the fan's stamps with their arenas and their games (teams, score); the note from 0168 on */
const STAMP_COLS = 'id,game_id,venue_id,league_id,stamped_at,venues(name,city,country,lat,lng,place_id),leagues(name),' +
  'games(tipoff_at,status,home_score,away_score,home:home_team_id(name,short_name,colour,logo_path),' +
  'away:away_team_id(name,short_name,colour,logo_path))';
async function fetchMine() {
  const get = async cols => {
    try {
      const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/stamps?select=' + cols + '&order=stamped_at.desc&limit=1000',
        { cache: 'no-store', headers: headers(false) });
      if (r.status === 400) return 'retry';
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  };
  // 0168's note column: a 400 means it is not there yet, and then it is not asked for again on this page
  let rows = S.noteOk === false ? 'retry' : await get('note,' + STAMP_COLS);
  if (Array.isArray(rows)) S.noteOk = true;
  else if (rows === 'retry') S.noteOk = false;
  if (rows === 'retry') rows = await get(STAMP_COLS);          // before 0168: no note column
  if (rows === 'retry') rows = await get('id,game_id,venue_id,league_id,stamped_at,venues(name,city,country,lat,lng),leagues(name)');
  return Array.isArray(rows) ? rows : null;
}

async function loadMine() {
  if (!S.session) { S.mine = null; drawMine(); if (onStampsPage()) drawPassport(); return; }
  S.mine = await fetchMine();
  // the ranks and the leaderboard choice are 0166's, the photographs 0167's: without them the stamps stand
  if (S.photos === undefined) await loadPhotos();
  const [ranks, settings] = await Promise.all([rpc('go_my_numbers'), rpc('go_my_settings')]);
  S.ranks = Array.isArray(ranks.data) ? ranks.data : null;
  S.settings = settings.data && !settings.missing ? settings.data : null;
  drawMine();
  drawPublic();
  if (onStampsPage()) drawPassport();
}

/* A STAMP AS A CARD: the arena, the date, which game of the fan's it was, the teams and the score, and the
   trip that led there. `j` from journeyOf. */
function stampCard(j) {
  const x = j.s, v = x.venues || {}, g = x.games || {};
  const home = g.home || {}, away = g.away || {};
  const a = el('article', 'vcard stamp');
  a.style.setProperty('--c1', colourOf(home.colour));
  const mk = a.appendChild(el('span', 'vc-mark'));
  mk.setAttribute('aria-hidden', 'true');
  mk.appendChild(crestOf(home));
  const disc = a.appendChild(el('span', 'vc-crest'));
  disc.appendChild(crestOf(home));
  const dt = a.appendChild(data('time', 'st-date', dayText(x.stamped_at)));
  dt.dateTime = x.stamped_at;
  const chip = a.appendChild(el('span', 'vc-chip'));
  chip.appendChild(el('span', null, 'game'));
  chip.appendChild(data('span', null, ' #' + j.n));
  const b = a.appendChild(el('div', 'vc-body'));
  b.appendChild(data('div', 'vc-venue', v.name || '—'));
  b.appendChild(data('div', 'vc-meta', [v.city, x.leagues && x.leagues.name].filter(Boolean).join(' · ')));
  if (home.name || away.name) {
    const t = b.appendChild(el('div', 'st-teams'));
    t.appendChild(crestOf(home));
    t.appendChild(data('span', 'nm', home.short_name || home.name || '—'));
    const played = g.home_score != null && g.away_score != null && (g.status === 'final' || g.status === 'live' || Number(g.home_score) + Number(g.away_score) > 0);
    t.appendChild(data('span', 'sc', played ? g.home_score + '–' + g.away_score : 'v'));
    t.appendChild(data('span', 'nm', away.short_name || away.name || '—'));
    t.appendChild(crestOf(away));
  }
  const leg = b.appendChild(el('div', 'st-leg'));
  if (j.legKm == null) leg.appendChild(el('span', null, j.n === 1 ? 'first stamp' : ''));
  else leg.appendChild(data('span', null, '↝ ' + kmText(j.legKm) + (j.from ? ' · ' + j.from : '')));
  return a;
}

function signInCard(host) {
  const c = host.appendChild(el('div', 'go-me'));
  const t = c.appendChild(el('div'));
  t.appendChild(el('b', null, 'Sign in to stamp arenas'));
  t.appendChild(el('span', null, 'Stamping needs an account, so your stamps are yours on every phone.'));
  const a = c.appendChild(el('a', 'ep-btn pri', 'sign in'));
  a.href = signinHref();
  return c;
}

function drawMine() {
  const host = $('#goMine');
  if (!host) return;
  host.textContent = '';
  const side = $('#goMineSide');
  if (side) side.textContent = '';
  if (!S.session) { signInCard(host); return; }
  const rows = S.mine;
  if (!Array.isArray(rows)) { host.appendChild(el('div', 'go-empty', 'Your stamps could not be read just now.')); return; }
  if (!rows.length) { host.appendChild(el('div', 'go-empty', 'No stamps yet. Your first one is at your next game.')); return; }
  if (side) {
    const all = side.appendChild(el('a', 'go-small', 'all your games'));
    all.href = 'stamps/';
  }
  const grid = host.appendChild(el('div', 'st-grid'));
  journeyOf(rows).reverse().slice(0, 6).forEach(j => grid.appendChild(stampCard(j)));
  if (rows.length > 6) {
    const more = host.appendChild(el('div', 'st-more'));
    const a = more.appendChild(el('a', 'go-small', 'all your games'));
    a.href = 'stamps/';
  }
}

/* A stamp is the fan's to take back (0165's stamps_own_delete; the privacy page promises it): it leaves the
   passport, the numbers and the boards. A photograph from that game stays until the fan removes it. */
async function takeBack(li, x, btn) {
  if (!window.confirm('Take this stamp back? It comes off your passport and your numbers.')) return;
  btn.disabled = true;
  S.session = await session();
  let gone = false;
  try {
    // representation, because a delete the policy refuses still answers 204 with nothing gone
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/stamps?id=eq.' + encodeURIComponent(x.id),
      { method: 'DELETE', headers: Object.assign(headers(false), { Prefer: 'return=representation' }) });
    gone = r.ok && (await r.json()).length === 1;
  } catch (_) { gone = false; }
  if (gone) return loadMine();
  btn.disabled = false;
  const old = li.querySelector('.go-unerr');
  if (old) old.remove();
  li.appendChild(el('div', 'go-unerr', 'Could not take it back. Try again.'));
}

/* a note about the occasion (0168): the fan's alone */
async function saveNote(x, text) {
  S.session = await session();
  const r = await rpc('set_stamp_note', { p_stamp: x.id, p_note: text });
  if (r.data && r.data.ok) { x.note = r.data.note; return { ok: true }; }
  return { ok: false, reason: r.data && r.data.reason };
}

function noteForm(host, x, done) {
  const box = host.appendChild(el('div', 'go-noteform'));
  const ta = box.appendChild(el('textarea'));
  ta.maxLength = 280;
  ta.rows = 3;
  ta.placeholder = 'Who you went with, what happened… (only you see it)';
  ta.value = x.note || '';
  const row = box.appendChild(el('div', 'row'));
  const save = row.appendChild(el('button', 'ep-btn pri', 'save the note'));
  save.type = 'button';
  const cnt = row.appendChild(data('span', 'go-count', ta.value.length + '/280'));
  ta.addEventListener('input', () => { cnt.textContent = ta.value.length + '/280'; });
  const msg = box.appendChild(el('div', 'go-pub-msg'));
  msg.setAttribute('role', 'status');
  save.addEventListener('click', async () => {
    save.disabled = true;
    const r = await saveNote(x, ta.value);
    save.disabled = false;
    msg.style.color = r.ok ? 'var(--lume)' : '';
    msg.textContent = r.ok ? 'Saved. It is on your stamps page.' : (NOTE_WHY[r.reason] || 'It did not save. Try again in a moment.');
    if (r.ok && done) done();
  });
  return box;
}

/* ----------------------------------------------------- games been to (5) --- */

/* every reason submit_go_photo (0167) can refuse with, in words */
const PHOTO_WHY = {
  signed_out: 'Sign in first.',
  username: 'Choose a username first: it is how the wall shows who took a photograph.',
  adult: 'Tick the box to confirm you are 18 or over.',
  not_stamped: 'Only a game you stamped can have your photographs.',
  no_photos_here: 'This game takes no photographs: its league has players under 18.',
  no_file: 'The photograph did not arrive. Try again.',
  caption: 'That caption cannot go on the wall. Change it and try again.',
  game_full: 'Three photographs of one game is the most.',
  day_full: 'Ten photographs a day is the most. Try again tomorrow.',
};
const PHOTO_STATE = { pending: 'waiting for a look', approved: 'on the wall', rejected: 'not put up', hidden: 'taken down after reports' };

function storageHeaders(type) {
  const h = { apikey: S.cfg.supabaseAnonKey };
  if (S.session && S.session.token) h.Authorization = 'Bearer ' + S.session.token;
  if (type) h['Content-Type'] = type;
  return h;
}

async function putFile(bucket, path, blob, type) {
  const r = await fetch(S.cfg.supabaseUrl + '/storage/v1/object/' + bucket + '/' + path,
    { method: 'POST', headers: Object.assign(storageHeaders(type), { 'x-upsert': 'false' }), body: blob });
  if (!r.ok) throw new Error('upload ' + r.status);
}

async function removeFiles(bucket, paths) {
  try {
    await fetch(S.cfg.supabaseUrl + '/storage/v1/object/' + bucket, { method: 'DELETE',
      headers: storageHeaders('application/json'), body: JSON.stringify({ prefixes: paths }) });
  } catch (_) { /* a file left behind in the fan's own private folder is untidy, not public */ }
}

/* a photograph's picture for its fan: public once approved, a short-lived signed link while it waits */
async function photoSrc(p) {
  if (p.status === 'approved' || p.status === 'hidden') {
    return S.cfg.supabaseUrl + '/storage/v1/object/public/go-public/' + p.thumb_path;
  }
  try {
    const r = await fetch(S.cfg.supabaseUrl + '/storage/v1/object/sign/go-pending/' + p.thumb_path,
      { method: 'POST', headers: storageHeaders('application/json'), body: JSON.stringify({ expiresIn: 3600 }) });
    const j = r.ok ? await r.json() : null;
    return j && (j.signedURL || j.signedUrl) ? S.cfg.supabaseUrl + '/storage/v1' + (j.signedURL || j.signedUrl) : null;
  } catch (_) { return null; }
}

/* a photograph posted from a stamp: into `host` (a stamp's row, or the card after stamping) */
function photoForm(host, stamp) {
  const was = host.querySelector('.go-phform');
  if (was) { was.remove(); return; }
  const f = host.appendChild(el('div', 'go-phform'));
  const pick = f.appendChild(el('label', 'go-phpick'));
  const file = pick.appendChild(el('input'));
  file.type = 'file';
  file.accept = 'image/*';
  const ask = pick.appendChild(el('span', null, 'choose a photograph'));
  const chosen = pick.appendChild(data('span', 'go-phname', ''));
  file.addEventListener('change', () => {
    const f0 = file.files && file.files[0];
    chosen.textContent = f0 ? f0.name : '';
    ask.classList.toggle('hide', !!f0);
  });
  const cap = f.appendChild(el('input', 'ep-input'));
  cap.maxLength = 140;
  cap.placeholder = 'a caption, if you like';
  let adult = null;
  if (!(S.settings && S.settings.adult)) {
    const lab = f.appendChild(el('label', 'go-adult'));
    adult = lab.appendChild(el('input'));
    adult.type = 'checkbox';
    lab.appendChild(el('span', null, 'I am 18 or over'));
  }
  const post = f.appendChild(el('button', 'ep-btn pri', 'post it'));
  post.type = 'button';
  const msg = f.appendChild(el('div', 'go-pub-msg'));
  msg.setAttribute('role', 'status');
  post.addEventListener('click', async () => {
    if (!file.files || !file.files[0]) { msg.textContent = 'Choose a photograph first.'; return; }
    post.disabled = true;
    msg.textContent = 'Sending…';
    const res = await sendPhoto(stamp, file.files[0], cap.value, adult ? adult.checked : false);
    post.disabled = false;
    if (res.ok) {
      f.remove();
      if (S.settings && adult && adult.checked) S.settings.adult = true;
      await loadPhotos();
      const note = host.appendChild(el('div', 'go-phsent', 'Sent. A person looks at every photograph before it goes on the wall.'));
      setTimeout(() => note.remove(), 8000);
      return;
    }
    msg.textContent = PHOTO_WHY[res.reason] || res.message || 'It did not go through. Try again in a moment.';
  });
}

async function sendPhoto(stamp, fileObj, caption, adult) {
  const U = window.EpinoiaUpload;
  S.session = await session();
  if (!S.session || !S.session.userId) return { ok: false, reason: 'signed_out' };
  if (!U || !U.prepare) return { ok: false, message: 'This page could not load. Try again in a moment.' };
  let out;
  try {
    // re-encoded in the browser: its EXIF - the phone's GPS among it - never leaves the phone (D9)
    out = await U.prepare(fileObj, 'gamephoto', { thumb: 480 });
  } catch (e) { return { ok: false, message: 'That photograph could not be read. Try another.' }; }
  const ext = out.type === 'image/webp' ? 'webp' : 'jpg';
  const base = S.session.userId + '/' + stamp.game_id + '-' + Date.now().toString(36);
  const path = base + '.' + ext, thumb = base + '-t.' + ext;
  try {
    await putFile('go-pending', path, out.main, out.type);
    await putFile('go-pending', thumb, out.thumb, out.type);
  } catch (_) {
    await removeFiles('go-pending', [path, thumb]);
    return { ok: false, message: 'The photograph did not arrive. Try again.' };
  }
  const r = await rpc('submit_go_photo', { p_game: stamp.game_id, p_path: path, p_thumb: thumb,
    p_width: out.w, p_height: out.h, p_caption: caption || null, p_adult: !!adult });
  if (r.data && r.data.ok) return { ok: true };
  await removeFiles('go-pending', [path, thumb]);          // refused: the files go too
  return { ok: false, reason: r.data && r.data.reason };
}

async function loadPhotos() {
  const host = $('#goPhotos');
  const r = await rpc('go_my_photos');
  S.photos = !r.missing && !r.error;
  if (!host) return;
  host.textContent = '';
  if (!S.photos) return;
  const rows = Array.isArray(r.data) ? r.data : [];
  const head = host.appendChild(el('div', 'go-phhead'));
  head.appendChild(el('b', null, 'Your photographs'));
  const wall = head.appendChild(el('a', 'go-small', 'see the full feed'));
  wall.href = '../photos/';
  if (!rows.length) {
    host.appendChild(el('div', 'go-none', 'None yet. Add one to a game you stamped.'));
    return;
  }
  const grid = host.appendChild(el('div', 'go-phgrid'));
  rows.forEach(p => {
    const c = grid.appendChild(el('figure', 'go-ph go-ph-' + p.status));
    const img = c.appendChild(el('img'));
    img.alt = p.venue || '';
    img.setAttribute('translate', 'no');
    img.loading = 'lazy';
    photoSrc(p).then(src => { if (src) img.src = src; });
    const cap = c.appendChild(el('figcaption'));
    cap.appendChild(el('span', 'st', PHOTO_STATE[p.status] || p.status));
    if (p.reason && p.status !== 'approved') cap.appendChild(data('span', 'why', p.reason));
    const del = cap.appendChild(el('button', 'go-phdel', 'remove'));
    del.type = 'button';
    del.addEventListener('click', () => removePhoto(p, del));
  });
}

async function removePhoto(p, btn) {
  if (!window.confirm('Remove this photograph?')) return;
  btn.disabled = true;
  S.session = await session();
  // the files first: a public one's permission asks the row whose it is
  const bucket = p.status === 'approved' || p.status === 'hidden' ? 'go-public' : 'go-pending';
  if (p.status !== 'rejected') await removeFiles(bucket, [p.path, p.thumb_path]);
  await rpc('delete_go_photo', { p_photo: p.id });
  await loadPhotos();
}

/* ------------------------------------------------ arenas still to tick off --- */

let feedP = null;
function feedRows() {
  if (!feedP) feedP = rpc('go_photos_feed', { p_limit: 60 }).then(r => (Array.isArray(r.data) ? r.data : []));
  return feedP;
}

async function followedCountries() {
  if (!S.session) return [];
  const p = await restGet('fan_prefs?select=fav_team_ids,fav_league_ids&limit=1');
  const row = Array.isArray(p.data) && p.data[0];
  if (!row) return [];
  const out = [];
  const lids = (row.fav_league_ids || []).filter(Boolean), tids = (row.fav_team_ids || []).filter(Boolean);
  if (lids.length) {
    const l = await restGet('leagues?id=in.(' + lids.join(',') + ')&select=country');
    (l.data || []).forEach(x => out.push(x.country));
  }
  if (tids.length) {
    const t = await restGet('teams?id=in.(' + tids.join(',') + ')&select=leagues(country)');
    (t.data || []).forEach(x => out.push(x.leagues && x.leagues.country));
  }
  return out.map(c => String(c || '').split('+')[0]);
}

const countryName = cc => {
  try { return new Intl.DisplayNames([loc() || 'en-GB'], { type: 'region' }).of(cc) || cc; } catch (_) { return cc; }
};

async function loadStrip() {
  const sec = $('#goStripSec'), pick = $('#goCountry');
  if (!sec || !pick) return;
  const r = await restGet('venues?select=country&lat=not.is.null&pin_note=is.null&limit=3000');
  const avail = [...new Set((r.data || []).map(x => String(x.country || '').toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c)))]
    .sort((a, b) => countryName(a).localeCompare(countryName(b)));
  if (!avail.length) { sec.classList.add('hide'); return; }
  const follows = await followedCountries();
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { tz = ''; }
  S.country = countryGuess({ stored: stored(KEYS.country), follows, tz,
    stamps: (S.mine || []).map(x => x.venues && x.venues.country), lang: (navigator.languages || [navigator.language])[0],
    available: avail });
  pick.textContent = '';
  avail.forEach(cc => {
    const o = pick.appendChild(data('option', null, countryName(cc)));
    o.value = cc;
  });
  pick.value = S.country;
  pick.addEventListener('change', () => { S.country = pick.value; store(KEYS.country, S.country); drawStrip(); });
  drawStrip();
}

function mapsHref(v) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([v.name, v.city].filter(Boolean).join(', '))
    + (v.place_id ? '&query_place_id=' + encodeURIComponent(v.place_id) : '');
}

/* AN ARENA AS A CARD: a fan's photograph taken there when one is on the wall, else its home club's crest,
   big and faint, over the club's colour */
/* THE CLUBS THAT PLAY AT AN ARENA, for its card: only a club whose league the reader can see (a club left
   behind by a deleted league, or a private league's, has none to show), and each club once - the same club
   in two competitions (London Lions, SLB and EuroCup) is one. Two clubs sharing a building (the Sharks and
   the Hatters) are one arena with both on its card: a stamp there ticks it off for both. */
function clubsAt(v) {
  const out = [];
  (v.teams || []).forEach(t => { if (t && t.name && t.leagues && !out.some(c => c.name === t.name)) out.push(t); });
  return out.sort((a, b) => (b.logo_path ? 1 : 0) - (a.logo_path ? 1 : 0) || a.name.localeCompare(b.name));
}

function venueCard(v, photo) {
  const clubs = clubsAt(v);
  const club = clubs[0] || {};
  const a = el('a', 'vcard' + (clubs.length > 1 ? ' shared' : ''));
  a.href = mapsHref(v);
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.setProperty('--c1', colourOf(club.colour));
  if (photo) { const p = a.appendChild(el('span', 'vc-photo')); p.style.backgroundImage = 'url("' + photo + '")'; }
  const mk = a.appendChild(el('span', 'vc-mark'));
  mk.setAttribute('aria-hidden', 'true');
  mk.appendChild(crestOf(club));
  const discs = a.appendChild(el('span', 'vc-crests'));
  clubs.slice(0, 3).forEach(c => discs.appendChild(el('span', 'vc-crest')).appendChild(crestOf(c)));
  const b = a.appendChild(el('span', 'vc-body'));
  const nm = b.appendChild(data('span', 'vc-venue', v.name));
  nm.style.display = 'block';
  const meta = b.appendChild(data('span', 'vc-meta', clubs.length > 1 ? v.city || '' : [v.city, club.name].filter(Boolean).join(' · ')));
  meta.style.display = 'block';
  if (clubs.length > 1) {
    b.appendChild(data('span', 'vc-clubs', clubs.map(c => c.name).join(' · ')));
  }
  a.title = [v.name].concat(clubs.map(c => c.name)).join(' · ');
  a.setAttribute('translate', 'no');                 // names only, the tooltip too
  return a;
}

async function drawStrip() {
  const host = $('#goStrip');
  if (!host || !S.country) return;
  const want = S.country;
  const r = await restGet('venues?country=eq.' + encodeURIComponent(want) + '&lat=not.is.null&pin_note=is.null' +
    '&select=id,name,city,place_id,teams!teams_home_venue_id_fkey(name,short_name,colour,logo_path,leagues(slug))' +
    '&order=name&limit=500');
  if (want !== S.country) return;
  const mine = new Set((S.mine || []).map(x => x.venue_id));
  const list = (Array.isArray(r.data) ? r.data : []).filter(v => clubsAt(v).length && !mine.has(v.id));
  host.textContent = '';
  if (!list.length) {
    host.appendChild(el('div', 'go-strip-done', r.error ? 'The arenas could not be read just now.'
      : 'Every arena here is yours. Pick another country.'));
    return;
  }
  const photos = new Map();
  (await feedRows()).forEach(p => { if (p.venue_id && !photos.has(p.venue_id)) photos.set(p.venue_id, publicUrl(p.thumb_path)); });
  mountStrip(host, list, photos);
}

/* THE STRIP: slides on its own, and the fan can take it (Louie, 2026-09-24): drag it with the mouse, swipe it,
   or press the arrows at its ends; it waits while a pointer is over it, something in it has focus, or the fan has
   just moved it. A ring: with three or more arenas the cards are laid out in enough copies (the extra ones
   hidden from readers) that going past either end comes round to the other; with fewer it is a plain row,
   arrows only when it overflows. Reduced motion: no sliding, the arrows jump. Scrolling is the browser's own
   overflow (so touch, trackpad and keyboard focus all work); a drag and the arrows move it by script. */
const STRIP = { raf: 0, io: null };
function stopStrip() {
  if (STRIP.raf) cancelAnimationFrame(STRIP.raf);
  STRIP.raf = 0;
  if (STRIP.io) STRIP.io.disconnect();
  STRIP.io = null;
}

function mountStrip(host, list, photos) {
  stopStrip();
  const n = list.length;
  const view = host.appendChild(el('div', 'go-strip-view'));
  const track = view.appendChild(el('div', 'go-strip-track'));
  list.forEach(v => track.appendChild(venueCard(v, photos.get(v.id))));
  const prev = host.appendChild(el('button', 'go-strip-btn prev'));
  const next = host.appendChild(el('button', 'go-strip-btn next'));
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Previous arenas');
  next.setAttribute('aria-label', 'Next arenas');

  const loop = n >= 3;
  let period = 0;
  if (loop) {
    const copy = () => list.forEach(v => {
      const c = venueCard(v, photos.get(v.id));
      c.setAttribute('aria-hidden', 'true');
      c.tabIndex = -1;
      track.appendChild(c);
    });
    copy(); copy();
    period = track.children[n].offsetLeft - track.children[0].offsetLeft;
    if (!(period > 50)) period = n * 266;
    // the window (up to 1200 px) always has cards under it while the position stays within one period
    for (let sets = 3; sets < 2 + Math.ceil(1200 / period); sets++) copy();
  }

  const SPEED = 40;                                   // px a second
  let pos = loop ? period : 0, glide = 0, lastSet = -1, pausedUntil = 0, last = 0;
  let hover = false, focus = false, dragging = false, visible = true;
  const maxPos = () => Math.max(0, track.scrollWidth - view.clientWidth);
  const buttons = () => {
    const room = loop || maxPos() > 1;
    prev.hidden = next.hidden = !room;
    if (!loop) { prev.disabled = pos <= 1; next.disabled = pos >= maxPos() - 1; }
  };
  // keeps the position inside the window that has cards under it; a plain row stops at its ends
  const norm = () => {
    if (loop) { while (pos >= 2 * period) pos -= period; while (pos < period) pos += period; return; }
    const c = Math.min(maxPos(), Math.max(0, pos));
    if (c !== pos) { pos = c; glide = 0; }
  };
  const apply = () => { norm(); lastSet = pos; view.scrollLeft = pos; buttons(); };
  const pause = ms => { pausedUntil = performance.now() + ms; };

  // a scroll the script did not make (a swipe, a trackpad, focus reaching a card): follow it, and wait
  view.addEventListener('scroll', () => {
    if (Math.abs(view.scrollLeft - lastSet) < 1.5) return;
    pos = view.scrollLeft;
    glide = 0;
    pause(4000);
    if (loop) { const was = pos; norm(); if (pos !== was) { lastSet = pos; view.scrollLeft = pos; } } else buttons();
  }, { passive: true });

  const step = dir => {
    pause(6000);
    const by = dir * Math.max(220, view.clientWidth * 0.8);
    if (reduced()) { pos += by; apply(); } else glide += by;
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  // the mouse drags; a finger scrolls the overflow itself
  let sx = 0, from = 0, travelled = 0;
  view.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; travelled = 0; sx = e.clientX; from = view.scrollLeft; glide = 0;
    view.classList.add('dragging');
    const move = ev => { travelled = Math.max(travelled, Math.abs(ev.clientX - sx)); pos = from - (ev.clientX - sx); apply(); };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      dragging = false; view.classList.remove('dragging'); pause(4000);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
  view.addEventListener('dragstart', e => e.preventDefault());       // not the browser's drag of a link
  view.addEventListener('click', e => { if (travelled > 5) { e.preventDefault(); e.stopPropagation(); travelled = 0; } }, true);

  host.addEventListener('mouseenter', () => { hover = true; });
  host.addEventListener('mouseleave', () => { hover = false; });
  host.addEventListener('focusin', () => { focus = true; });
  host.addEventListener('focusout', () => { focus = false; });
  if (typeof ResizeObserver === 'function') new ResizeObserver(buttons).observe(view);
  if (typeof IntersectionObserver === 'function') {
    STRIP.io = new IntersectionObserver(es => { visible = es.some(x => x.isIntersecting); });
    STRIP.io.observe(host);
  }

  apply();
  if (reduced()) return;                              // no sliding, no glide: the arrows jump
  const frame = t => {
    STRIP.raf = requestAnimationFrame(frame);
    const dt = Math.min(64, t - (last || t));
    last = t;
    if (!visible || document.hidden || dragging) return;
    if (Math.abs(glide) > 0.5) { const d = glide * (1 - Math.exp(-dt / 110)); pos += d; glide -= d; apply(); }
    else if (glide) { pos += glide; glide = 0; apply(); }
    else if (loop && !hover && !focus && t > pausedUntil) { pos += SPEED * dt / 1000; apply(); }
  };
  STRIP.raf = requestAnimationFrame(frame);
}

/* ------------------------------------------------------------- the boards --- */

/* the three ways to rank, each saying what it counts */
const BY = [
  { v: 'km', ic: '↝', t: 'Distance', d: 'Kilometres travelled between the arenas you stamped, in the order you went.' },
  { v: 'stamps', ic: '◉', t: 'Games', d: 'Every game you stamped, however many at one arena.' },
  { v: 'arenas', ic: '◎', t: 'Venues', d: 'Different arenas stamped: each one counts once.' },
];

async function loadBoards() {
  const r = await rpc('go_leagues');
  const sec = $('#goBoardsSec');
  if (r.missing || r.error) { if (sec) sec.classList.add('hide'); return; }
  S.leagues = Array.isArray(r.data) ? r.data : [];
  drawBadges();                                           // a league's arena count makes its badge
  if (!sec) return;
  sec.classList.remove('hide');
  drawBoardPick();
  loadBoard();
}

function drawBoardPick() {
  const by = $('#goBoardBy');
  by.textContent = '';
  BY.forEach(o => {
    const b = by.appendChild(el('button', S.board.by === o.v ? 'on' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(S.board.by === o.v));
    const t = b.appendChild(el('span', 't'));
    t.appendChild(data('i', null, o.ic));
    t.appendChild(el('span', null, o.t));
    b.appendChild(el('span', 'd', o.d));
    b.addEventListener('click', () => { S.board.by = o.v; drawBoardPick(); loadBoard(); });
  });
  const pick = $('#goBoardPick');
  pick.textContent = '';
  const add = (id, label, isName) => {
    const b = pick.appendChild(isName ? data('button', '', label) : el('button', '', label));
    b.type = 'button';
    const on = (S.board.league || null) === (id || null);
    b.setAttribute('aria-pressed', String(on));
    if (on) b.classList.add('on');
    b.addEventListener('click', () => { S.board.league = id; drawBoardPick(); loadBoard(); });
  };
  add(null, 'Overall', false);
  (S.leagues || []).forEach(l => add(l.league_id, l.league, true));
}

async function loadBoard() {
  const host = $('#goBoard');
  if (!host || !S.leagues) return;
  const want = JSON.stringify(S.board);
  const r = await rpc('go_leaderboard', { p_league: S.board.league, p_by: S.board.by, p_limit: S.board.by === 'stamps' ? 500 : 100 });
  if (want !== JSON.stringify(S.board)) return;           // the fan chose another board meanwhile
  host.textContent = '';
  const note = $('#goBoardNote');
  note.textContent = '';
  const lg = (S.leagues || []).find(l => l.league_id === S.board.league);
  if (lg && lg.arenas_total) {
    const s = note.appendChild(el('span'));
    s.appendChild(el('span', null, 'Arenas in this league'));
    s.appendChild(document.createTextNode(': '));
    s.appendChild(data('b', null, String(lg.arenas_total)));
  }
  const rows = rerank(Array.isArray(r.data) ? r.data : [], S.board.by).slice(0, 50);
  if (!rows.length) {
    host.appendChild(el('div', 'go-empty', 'Nobody is on this board yet. Stamp an arena and put yourself on it.'));
    return;
  }
  const list = host.appendChild(el('div', 'lb-list'));
  const cols = [['arenas', 'Venues'], ['stamps', 'Games'], ['km', 'Distance']];
  const head = list.appendChild(el('div', 'lb-row lb-head'));
  head.appendChild(el('span'));
  head.appendChild(el('span', 'lb-n', ''));
  cols.forEach(([k, label]) => {
    // the sort's own mark as well as its word: on a phone only the mark has room (the word stays, for readers)
    const sm = head.appendChild(el('span', 'lb-n' + (k === S.board.by ? ' sorted' : ''))).appendChild(el('small'));
    sm.appendChild(data('i', null, BY.find(o => o.v === k).ic));
    sm.appendChild(el('span', null, label));
  });
  rows.forEach(x => {
    const row = list.appendChild(el('div', 'lb-row' + (x.me ? ' me' : '') + (x.rank <= 3 ? ' r' + x.rank : '')));
    row.appendChild(data('span', 'lb-rank', String(x.rank)));
    row.appendChild(data('span', 'lb-who', '@' + x.username));
    cols.forEach(([k]) => row.appendChild(data('span', 'lb-n' + (k === S.board.by ? ' sorted' : ''),
      k === 'km' ? kmText(Number(x.km)) : String(x[k] == null ? '—' : x[k]))));
  });
}

/* being on the leaderboard (D6): a choice, with a username and 18 or over confirmed */
function drawPublic(msg) {
  const host = $('#goPublic');
  if (!host) return;
  host.textContent = '';
  const st = S.settings;
  if (!st) return;                                        // signed out, or 0166 not pushed yet
  const c = host.appendChild(el('div', 'go-me go-pub'));
  const t = c.appendChild(el('div'));
  if (st.public) {
    t.appendChild(el('b', null, 'You are on the leaderboards'));
    const who = t.appendChild(el('span'));
    who.appendChild(el('span', null, 'Your username'));
    who.appendChild(document.createTextNode(': '));
    who.appendChild(data('b', 'go-at', '@' + (st.username || S.username || '')));
    const off = c.appendChild(el('button', 'ep-btn', 'take me off'));
    off.type = 'button';
    off.addEventListener('click', () => setPublic(false, false, off));
  } else if (!st.username && !S.username) {
    t.appendChild(el('b', null, 'The leaderboards'));
    t.appendChild(el('span', null, 'To be on them, choose a username first. It is how they will show you.'));
    const a = c.appendChild(el('a', 'ep-btn', 'choose one'));
    a.href = '../me/#username';
  } else {
    t.appendChild(el('b', null, 'Put yourself on the leaderboards'));
    t.appendChild(el('span', null, 'They show your username and your numbers, never your email or which arenas. You can come off at any time.'));
    let tick = null;
    if (!st.adult) {
      const lab = t.appendChild(el('label', 'go-adult'));
      tick = lab.appendChild(el('input'));
      tick.type = 'checkbox';
      lab.appendChild(el('span', null, 'I am 18 or over'));
    }
    const on = c.appendChild(el('button', 'ep-btn pri', 'put me on'));
    on.type = 'button';
    on.addEventListener('click', () => setPublic(true, tick ? tick.checked : true, on));
  }
  if (msg) c.appendChild(el('div', 'go-pub-msg', msg));
}

async function setPublic(on, adult, btn) {
  btn.disabled = true;
  S.session = await session();
  const r = await rpc('set_go_public', { p_public: on, p_adult: !!adult });
  btn.disabled = false;
  if (r.missing || r.error || !r.data) return drawPublic('It did not save. Try again in a moment.');
  if (!r.data.ok) {
    return drawPublic({ adult: 'Tick the box to confirm you are 18 or over.',
                        username: 'Choose a username first.', signed_out: 'Sign in first.' }[r.data.reason] ||
                      'It did not save. Try again in a moment.');
  }
  const [ranks, settings] = await Promise.all([rpc('go_my_numbers'), rpc('go_my_settings')]);
  S.ranks = Array.isArray(ranks.data) ? ranks.data : S.ranks;
  S.settings = settings.data || S.settings;
  drawPublic();
  loadBoard();
}

/* -------------------------------------------------------------- the feed --- */

const FEED_N = 10;
async function loadFeed() {
  const host = $('#goFeed');
  if (!host) return;
  drawFeed(await feedRows());
}

function feedCard(p) {
  const a = el('a', 'feed-card');
  const cap = el('span', 'cap');
  const paint = q => {
    a.href = 'photos/?p=' + encodeURIComponent(q.id);
    cap.textContent = '';
    cap.appendChild(data('b', null, '@' + (q.username || '')));
    cap.appendChild(data('span', null, [q.venue, q.league].filter(Boolean).join(' · ')));
  };
  const img = a.appendChild(el('img'));
  img.alt = '';
  img.loading = 'lazy';
  img.src = publicUrl(p.thumb_path);
  a.appendChild(cap);
  paint(p);
  return {
    el: a,
    swap(q) {
      const next = el('img', 'gone');
      next.alt = '';
      next.addEventListener('load', () => {
        next.classList.remove('gone');
        paint(q);
        setTimeout(() => { a.querySelectorAll('img').forEach(i => { if (i !== next) i.remove(); }); }, 1100);
      }, { once: true });
      next.src = publicUrl(q.thumb_path);
      a.insertBefore(next, cap);
    }
  };
}

/* TWO ROWS OF THE FANS' PHOTOGRAPHS, one changing every few seconds. None yet: the frames stay, faded,
   with the invitation over them. */
function drawFeed(rows) {
  const host = $('#goFeed');
  host.textContent = '';
  clearInterval(S.feedTimer);
  const grid = host.appendChild(el('div', 'feed-grid'));
  if (!rows.length) {
    host.classList.add('empty');
    for (let i = 0; i < FEED_N; i++) grid.appendChild(el('div', 'feed-card')).setAttribute('aria-hidden', 'true');
    const m = host.appendChild(el('div', 'feed-empty'));
    m.appendChild(el('p', null, 'Prove your fandom — attend games, file them, take snaps!'));
    return;
  }
  host.classList.remove('empty');
  let next = 0;
  const take = () => rows[next++ % rows.length];
  const cards = [];
  for (let i = 0; i < FEED_N; i++) { const c = feedCard(take()); grid.appendChild(c.el); cards.push(c); }
  if (rows.length <= 1 || reduced()) return;
  S.feedTimer = setInterval(() => {
    if (document.hidden) return;
    cards[Math.floor(Math.random() * cards.length)].swap(take());
  }, 3200);
}

/* -------------------------------------------------------- at a game (3) --- */

function stamped(gameId) { return !!(S.mine && S.mine.some(x => x.game_id === gameId)); }

function drawList() {
  const host = $('#goList');
  host.textContent = '';
  if (!S.pos) return;
  const now = Date.now();
  const list = nearby(S.games, S.pos, now);
  if (!list.length) {
    const n = nearest(S.games, S.pos);
    const box = host.appendChild(el('div', 'go-none'));
    box.appendChild(el('div', null, 'No game near you right now.'));
    if (n) facts(box, [['Nearest game', n.g.venue || '—'], ['Distance', distanceText(n.d)]]);
    return;
  }
  list.slice(0, 12).forEach(x => {
    const g = x.g;
    const card = host.appendChild(el('div', 'go-game' + (x.state === 'here' ? ' here' : '')));
    card.appendChild(data('div', 'lg', [g.league, timeText(g.tipoff_at)].filter(Boolean).join(' · ')));
    card.appendChild(data('div', 'm', (g.home || '—') + ' v ' + (g.away || '—')));
    card.appendChild(data('div', 'ar', [g.venue, g.city].filter(Boolean).join(' · ')));
    const st = card.appendChild(el('div', 'st'));
    const fact = (k, v) => { st.appendChild(el('span', null, k)); st.appendChild(document.createTextNode(': '));
      st.appendChild(data('b', null, v)); };
    if (stamped(g.game_id)) {
      st.appendChild(el('span', 'ok', 'Stamped'));
    } else if (x.state === 'here') {
      if (S.session) {
        const b = card.appendChild(el('button', 'ep-btn pri', 'stamp this venue'));
        b.type = 'button';
        b.addEventListener('click', () => stamp(g, b));
      } else {
        const a = card.appendChild(el('a', 'ep-btn pri', 'sign in to stamp'));
        a.href = signinHref();
      }
      fact('Distance', distanceText(x.d));
    } else if (x.state === 'far') {
      fact('Distance', distanceText(x.d));
    } else if (x.state === 'later') {
      fact('Stamping opens', timeText(g.opens_at));
    } else if (x.state === 'checking') {
      st.appendChild(el('span', null, 'This arena’s pin is being checked'));
    }
  });
}

function locate() {
  return new Promise(res => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return res({ error: 'none' });
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      e => res({ error: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

async function find() {
  const b = $('#goFind');
  b.setAttribute('aria-busy', 'true');
  b.disabled = true;
  say('');
  try {
    const [pos, games] = await Promise.all([locate(), loadGames()]);
    if (games === 'missing') return closed();
    drawToday();
    if (pos.error) { S.pos = null; drawList(); say(GEO[pos.error], 'warn'); }
    else { S.pos = pos; drawList(); }
    const at = $('#goAt');
    if (at && at.scrollIntoView) at.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  } finally {
    b.removeAttribute('aria-busy');
    b.disabled = false;
  }
}

function showStamped(r) {
  const host = $('#goSay');
  host.textContent = '';
  const wrap = host.appendChild(el('div', 'go-stamped'));
  const st = wrap.appendChild(el('div', 'go-stamp'));
  st.appendChild(el('span', 'k', 'stamped'));
  st.appendChild(data('span', 'v', r.venue || ''));
  st.appendChild(data('span', 'd', dayText(r.stamped_at)));
  const side = wrap.appendChild(el('div'));
  if (r.already) {
    side.appendChild(el('div', null, 'You had already stamped this game.'));
  } else {
    side.appendChild(el('div', 'go-new', r.first_time_here ? 'a new arena' : 'another visit'));
    facts(side, [['Arenas', String(r.arenas)], ['Stamps', String(r.stamps)]]);
  }
}

/* AFTER A STAMP: a note about the occasion (0168, only the fan sees it, on their stamps page) and a
   photograph of the game (0167). Both optional; both later from the stamps page too. */
function afterStamp(gameId) {
  const x = (S.mine || []).find(s => s.game_id === gameId);
  const host = $('#goSay');
  if (!x || !host || (!S.noteOk && !S.photos)) return;
  const box = host.appendChild(el('div', 'go-after'));
  if (S.noteOk) {
    box.appendChild(el('h3', null, 'A note about the occasion'));
    noteForm(box, x);
  }
  if (S.photos && x.game_id) {
    box.appendChild(el('h3', null, 'A photograph of the game'));
    photoForm(box, x);
  }
}

async function stamp(g, btn) {
  S.session = await session();
  if (!S.session) { location.href = signinHref(); return; }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    let pos = S.pos;
    if (!pos || Date.now() - pos.at > FRESH_MS) pos = await locate();
    if (pos.error) return say(GEO[pos.error], 'warn');
    S.pos = pos;
    const r = await rpc('stamp_venue', { p_game: g.game_id, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.accuracy });
    if (r.missing) return closed();
    if (r.error || !r.data) return say('It did not stamp. Try again in a moment.', 'bad');
    if (r.data.ok) {
      showStamped(r.data);
      await loadMine();
      afterStamp(g.game_id);
      drawList();
      loadBoard();
      drawStrip();
      return;
    }
    const link = r.data.reason === 'signed_out' && S.access && S.access.signinHref
      ? { text: 'sign in', href: S.access.signinHref() } : null;
    say(whyOf(r.data), 'bad', factsOf(r.data), link);
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

/* ---------------------------------------------- the stamps page (go/stamps/) --- */

/* the badges: earned ones lit like a stamp; the others with the way there */
function drawBadges() {
  const host = $('#goBadges');
  if (!host) return;
  host.textContent = '';
  badgesOf(S.mine || [], S.leagues).forEach(b => {
    const d = host.appendChild(el('div', 'go-badge' + (b.got ? ' got' : '')));
    d.setAttribute('role', 'listitem');
    d.appendChild(data('div', 'v', b.km ? kmText(b.of) : String(b.of)));
    d.appendChild(el('div', 'k', b.label));
    if (b.league) d.appendChild(data('div', 'l', b.league));
    if (b.got) return;
    const bar = d.appendChild(el('div', 'bar'));
    bar.appendChild(el('i')).style.width = Math.round(100 * b.have / b.of) + '%';
    d.appendChild(data('div', 'p', b.km ? kmText(b.have) : b.have + '/' + b.of));
  });
}

function drawPassport() {
  const rows = S.mine || [];
  const tally = $('#goTally');
  if (!tally) return;
  const n = numbersOf(rows);
  tally.textContent = '';
  [[String(n.arenas), 'arenas'], [String(n.stamps), 'games'], [kmText(n.km), 'travelled']].forEach(([v, k]) => {
    const d = tally.appendChild(el('div'));
    d.appendChild(data('div', 'n', v));
    d.appendChild(el('div', 'k', k));
  });
  drawBadges();
  const journey = journeyOf(rows);
  const M = window.EpinoiaGoMap;
  const map = $('#goBigMap');
  if (map && M) M.draw(map, journey.filter(j => j.s.venues && j.s.venues.lat != null)
    .map(j => ({ lat: j.s.venues.lat, lng: j.s.venues.lng, name: j.s.venues.name, n: j.n })));
  const list = $('#goStampList');
  list.textContent = '';
  if (!rows.length) {
    list.appendChild(el('div', 'go-empty', 'No stamps yet. Your first one is at your next game.'));
    return;
  }
  journey.slice().reverse().forEach(j => {
    const x = j.s;
    const li = list.appendChild(el('li', 'sl-row'));
    li.appendChild(data('span', 'sl-n', '#' + j.n));
    const main = li.appendChild(el('div', 'sl-main'));
    const card = stampCard(j);
    card.classList.add('sl-card');
    main.appendChild(card);
    const side = li.appendChild(el('div', 'sl-side'));
    const leg = side.appendChild(el('div', 'sl-leg'));
    leg.setAttribute('data-i18n-ctx', 'goleg');      // "from" here is the arena before, not a date's start
    if (j.legKm == null) leg.appendChild(el('span', null, j.n === 1 ? 'first stamp' : '—'));
    else {
      leg.appendChild(data('b', null, kmText(j.legKm)));
      if (j.from) { leg.appendChild(el('span', null, 'from')); leg.appendChild(data('span', 'sl-from', j.from)); }
    }
    const note = side.appendChild(el('div', 'sl-note'));
    const paintNote = () => {
      note.textContent = '';
      if (x.note) note.appendChild(data('p', null, '“' + x.note + '”'));
      if (!S.noteOk) return;
      const edit = note.appendChild(el('button', 'go-small', x.note ? 'edit the note' : 'add a note'));
      edit.type = 'button';
      edit.addEventListener('click', () => {
        note.textContent = '';
        noteForm(note, x, paintNote);
      });
    };
    paintNote();
    const acts = side.appendChild(el('div', 'go-acts'));
    if (S.photos && x.game_id) {
      const add = acts.appendChild(el('button', 'go-addph', 'add a photo'));
      add.type = 'button';
      add.addEventListener('click', () => photoForm(side, x));
    }
    const back = acts.appendChild(el('button', 'go-unst', 'take back'));
    back.type = 'button';
    back.addEventListener('click', () => takeBack(li, x, back));
  });
}

async function bootStamps() {
  if (!S.session) {
    const out = $('#goStampsOut');
    if (out) { signInCard(out); out.classList.remove('hide'); }
    const body = $('#goStampsBody');
    if (body) body.classList.add('hide');
    return;
  }
  await loadMine();
  loadBoards();
}

async function boot() {
  S.cfg = window.EPINOIA_CONFIG;
  S.access = window.EpinoiaAccess || null;
  if (!S.cfg) return closed('This page could not load. Try again in a moment.');
  S.session = await session();
  if (onStampsPage()) return bootStamps();
  $('#goFind').addEventListener('click', find);
  // the username first: the intro asks for one (0163), and says Have Fun!
  if (S.session) {
    const u = await rpc('my_username');
    if (!u.missing && !u.error) S.username = u.data || null;
  }
  intro();
  const games = await loadGames();
  if (games === 'missing') return closed();
  drawToday();
  await loadMine();
  loadStrip();
  loadBoards();
  loadFeed();
}

return { boot, metres, placeOf, nearby, nearest, distanceText, kmText, numbersOf, journeyOf, byLeague, badgesOf, rerank,
         countryGuess, clubsAt, gamesFor, dayLabel, whyOf, factsOf, unameLocal, WHY, GEO, UNAME_WHY, NOTE_WHY, PHOTO_WHY, PHOTO_STATE, BY, ALLOW_M, NEAR_M, TZ_CC };
}));
