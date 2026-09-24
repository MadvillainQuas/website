'use strict';
/* ============================================================================
   EPINOIA GO — stamping an arena at a game (docs/epinoia-go.md, step 3.4).

   A fan at a game presses one button. The phone says where it is, once; the page lists the games on
   now or soon, nearest first, measured on the phone (go_games_now takes no location, migration 0165);
   and "stamp this venue" sends the location to stamp_venue, which checks it and keeps only the stamp.
   Every refusal it can give has words here, with the number that goes with it.

   Below that, the fan's own stamps. Signed out, the page still finds the game; stamping asks for an
   account. A fan with no username yet is pointed at the profile's username section (step 2.2): it is
   how the leaderboards will show them.

   Until migration 0165 is pushed the functions are missing, and the page says EPINOIA GO opens soon.
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

const loc = () => (typeof window !== 'undefined' && window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;

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

/* ---------------------------------------------------------------- page --- */

const S = { cfg: null, access: null, session: null, games: [], pos: null, mine: null, username: undefined };
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

async function session() {
  try { return S.access && S.access.sessionReady ? await S.access.sessionReady() : null; } catch (_) { return null; }
}

function headers(json) {
  const h = { apikey: S.cfg.supabaseAnonKey, Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  if (S.session && S.session.token) h.Authorization = 'Bearer ' + S.session.token;
  return h;
}

/* one call; a function or table not on the server yet (0165 unpushed) comes back as { missing } */
async function rpc(fn, body) {
  try {
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store',
      headers: headers(true), body: JSON.stringify(body || {}) });
    if (r.status === 404) return { missing: true };
    if (!r.ok) return { error: r.status };
    return { data: await r.json() };
  } catch (e) { return { error: 'network' }; }
}

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
  ['#goAt', '#goMineSec'].forEach(s => $(s).classList.add('hide'));
  const c = $('#goClosed');
  c.textContent = msg || 'EPINOIA GO opens soon.';
  c.classList.remove('hide');
}

function drawToday() {
  const t = $('#goToday');
  t.textContent = '';
  const now = Date.now();
  const on = S.games.filter(g => now >= Date.parse(g.opens_at) && now <= Date.parse(g.closes_at)).length;
  const leagues = new Set(S.games.map(g => g.league_id).filter(Boolean)).size;
  const pairs =[['Games open to stamp now', String(on)], ['Today and tomorrow', String(S.games.length)], ['Leagues', String(leagues)]];
  pairs.forEach(([k, v]) => {
    const s = t.appendChild(el('span'));
    s.appendChild(el('span', null, k));
    s.appendChild(document.createTextNode(': '));
    s.appendChild(data('b', null, v));
  });
}

async function drawMe() {
  const host = $('#goMe');
  host.textContent = '';
  if (!S.session) {
    const c = host.appendChild(el('div', 'go-me'));
    const t = c.appendChild(el('div'));
    t.appendChild(el('b', null, 'Sign in to stamp arenas'));
    t.appendChild(el('span', null, 'Stamping needs an account, so your stamps are yours on every phone.'));
    const a = c.appendChild(el('a', 'ep-btn pri', 'sign in'));
    a.href = S.access && S.access.signinHref ? S.access.signinHref() : '../signin/';
    return;
  }
  const r = await rpc('my_username');
  if (r.missing || r.error) return;
  S.username = r.data || null;
  if (S.username) return;
  const c = host.appendChild(el('div', 'go-me'));
  const t = c.appendChild(el('div'));
  t.appendChild(el('b', null, 'Choose a username'));
  t.appendChild(el('span', null, 'It is how the leaderboards will show you. Never your email.'));
  const a = c.appendChild(el('a', 'ep-btn', 'choose one'));
  a.href = '../me/#username';
}

async function loadMine() {
  const sec = $('#goMineSec');
  if (!S.session) { sec.classList.add('hide'); return; }
  let rows = null;
  try {
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/stamps?select=id,game_id,venue_id,stamped_at,' +
      'venues(name,city,country),leagues(name)&order=stamped_at.desc&limit=1000',
      { cache: 'no-store', headers: headers(false) });
    rows = r.ok ? await r.json() : null;
  } catch (_) { rows = null; }
  if (!Array.isArray(rows)) { sec.classList.add('hide'); return; }
  S.mine = rows;
  sec.classList.remove('hide');
  const arenas = new Set(rows.map(x => x.venue_id)).size;
  const tally = $('#goTally');
  tally.textContent = '';
  [[arenas, 'arenas'], [rows.length, 'stamps']].forEach(([n, k]) => {
    const d = tally.appendChild(el('div'));
    d.appendChild(data('div', 'n', String(n)));
    d.appendChild(el('div', 'k', k));
  });
  const count = $('#goCount');
  count.textContent = arenas ? arenas + (arenas === 1 ? ' arena' : ' arenas') : '';
  const list = $('#goMine');
  list.textContent = '';
  if (!rows.length) {
    list.appendChild(el('li', 'go-none', 'No stamps yet. Your first one is at your next game.')).style.display = 'block';
    return;
  }
  rows.slice(0, 50).forEach(x => {
    const li = list.appendChild(el('li'));
    const tm = li.appendChild(el('time', null, dayText(x.stamped_at)));
    tm.dateTime = x.stamped_at;
    li.appendChild(data('b', null, (x.venues && x.venues.name) || '—'));
    li.appendChild(data('small', null, [x.venues && x.venues.city, x.venues && x.venues.country, x.leagues && x.leagues.name]
      .filter(Boolean).join(' · ')));
  });
}

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
        a.href = S.access && S.access.signinHref ? S.access.signinHref() : '../signin/';
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
    if (pos.error) { S.pos = null; drawList(); return say(GEO[pos.error], 'warn'); }
    S.pos = pos;
    drawList();
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

async function stamp(g, btn) {
  S.session = await session();
  if (!S.session) { location.href = S.access && S.access.signinHref ? S.access.signinHref() : '../signin/'; return; }
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
      drawList();
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

async function boot() {
  S.cfg = window.EPINOIA_CONFIG;
  S.access = window.EpinoiaAccess || null;
  if (!S.cfg) return closed('This page could not load. Try again in a moment.');
  S.session = await session();
  $('#goFind').addEventListener('click', find);
  const games = await loadGames();
  if (games === 'missing') return closed();
  drawToday();
  drawMe();
  loadMine();
}

return { boot, metres, placeOf, nearby, nearest, distanceText, whyOf, factsOf, WHY, GEO, ALLOW_M, NEAR_M };
}));
