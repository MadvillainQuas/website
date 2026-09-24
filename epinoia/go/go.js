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

/* ---------------------------------------------------------------- page --- */

const S = { cfg: null, access: null, session: null, games: [], pos: null, mine: null, username: undefined,
            ranks: null, settings: null, leagues: null, board: { league: null, by: 'arenas' },
            photos: undefined };      // undefined: not asked yet; false: 0167 not pushed; true: photographs on
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
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/stamps?select=id,game_id,venue_id,league_id,stamped_at,' +
      'venues(name,city,country,lat,lng),leagues(name)&order=stamped_at.desc&limit=1000',
      { cache: 'no-store', headers: headers(false) });
    rows = r.ok ? await r.json() : null;
  } catch (_) { rows = null; }
  if (!Array.isArray(rows)) { sec.classList.add('hide'); return; }
  S.mine = rows;
  sec.classList.remove('hide');
  // the ranks and the leaderboard choice are 0166's, the photographs 0167's: without them the passport stands
  if (S.photos === undefined) await loadPhotos();
  const [ranks, settings] = await Promise.all([rpc('go_my_numbers'), rpc('go_my_settings')]);
  S.ranks = Array.isArray(ranks.data) ? ranks.data : null;
  S.settings = settings.data && !settings.missing ? settings.data : null;
  drawPassport();
}

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

/* the fan's rank on a board (overall when league is null), or null */
function rankOf(leagueId, by) {
  const r = (S.ranks || []).find(x => (x.league_id || null) === (leagueId || null));
  return r ? r[by === 'km' ? 'rank_km' : 'rank_arenas'] : null;
}

function drawPassport() {
  const rows = S.mine || [];
  const n = numbersOf(rows);
  const tally = $('#goTally');
  tally.textContent = '';
  [[String(n.arenas), 'arenas'], [String(n.stamps), 'stamps'], [kmText(n.km), 'travelled']].forEach(([v, k]) => {
    const d = tally.appendChild(el('div'));
    d.appendChild(data('div', 'n', v));
    d.appendChild(el('div', 'k', k));
  });
  $('#goCount').textContent = n.arenas ? n.arenas + (n.arenas === 1 ? ' arena' : ' arenas') : '';
  drawBadges();

  const J = window.EpinoiaJourney;
  const map = $('#goMap');
  const plan = J ? J.draw(map, rows.map(x => ({ venue_id: x.venue_id, name: x.venues && x.venues.name,
    lat: x.venues && x.venues.lat, lng: x.venues && x.venues.lng, stamped_at: x.stamped_at }))) : null;
  map.classList.toggle('hide', !plan);

  const lg = $('#goLeagueNums');
  lg.textContent = '';
  const leagues = byLeague(rows);
  if (leagues.length) {
    const t = lg.appendChild(el('div', 'go-lnums'));
    leagues.forEach(l => {
      const row = t.appendChild(el('div', 'go-lnum'));
      row.appendChild(data('b', null, l.league || '—'));
      const f = row.appendChild(el('div', 'go-facts'));
      const fact = (k, v) => { const s = f.appendChild(el('span')); s.appendChild(el('span', null, k));
        s.appendChild(document.createTextNode(': ')); s.appendChild(data('b', null, v)); };
      fact('Arenas', String(l.arenas));
      fact('Distance', kmText(l.km));
      const ra = rankOf(l.league_id, 'arenas');
      if (ra) fact('Rank', '#' + ra);
    });
  }
  drawPublic();

  const list = $('#goMine');
  list.textContent = '';
  if (!rows.length) {
    list.appendChild(el('li', 'go-none', 'No stamps yet. Your first one is at your next game.')).style.display = 'block';
    return;
  }
  rows.slice(0, 50).forEach(x => {
    const li = list.appendChild(el('li'));
    // formatted in the reader's own locale already: data, not a phrase to look up
    const tm = li.appendChild(data('time', null, dayText(x.stamped_at)));
    tm.dateTime = x.stamped_at;
    li.appendChild(data('b', null, (x.venues && x.venues.name) || '—'));
    li.appendChild(data('small', null, [x.venues && x.venues.city, x.venues && x.venues.country, x.leagues && x.leagues.name]
      .filter(Boolean).join(' · ')));
    const acts = li.appendChild(el('div', 'go-acts'));
    if (S.photos && x.game_id) {
      const add = acts.appendChild(el('button', 'go-addph', 'add a photo'));
      add.type = 'button';
      add.addEventListener('click', () => photoForm(li, x, add));
    }
    const back = acts.appendChild(el('button', 'go-unst', 'take back'));
    back.type = 'button';
    back.addEventListener('click', () => takeBack(li, x, back));
  });
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

function photoForm(li, stamp, btn) {
  const was = li.querySelector('.go-phform');
  if (was) { was.remove(); return; }
  const f = li.appendChild(el('div', 'go-phform'));
  const pick = f.appendChild(el('label', 'go-phpick'));
  const file = pick.appendChild(el('input'));
  file.type = 'file';
  file.accept = 'image/*';
  pick.appendChild(el('span', null, 'choose a photograph'));
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
      const note = li.appendChild(el('div', 'go-phsent', 'Sent. A person looks at every photograph before it goes on the wall.'));
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
  host.textContent = '';
  if (!S.photos) return;
  const rows = Array.isArray(r.data) ? r.data : [];
  const head = host.appendChild(el('div', 'go-phhead'));
  head.appendChild(el('b', null, 'Your photographs'));
  const wall = head.appendChild(el('a', 'ep-btn', 'see the wall'));
  wall.href = 'photos/';
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

/* being on the leaderboards (D6): a choice, with a username and 18 or over confirmed */
function drawPublic(msg) {
  const host = $('#goPublic');
  host.textContent = '';
  const st = S.settings;
  if (!st) return;                                        // 0166 not pushed yet
  const c = host.appendChild(el('div', 'go-me go-pub'));
  const t = c.appendChild(el('div'));
  if (st.public) {
    t.appendChild(el('b', null, 'You are on the leaderboards'));
    const who = t.appendChild(el('span'));
    who.appendChild(el('span', null, 'Your username'));
    who.appendChild(document.createTextNode(': '));
    who.appendChild(data('b', 'go-at', '@' + (st.username || '')));
    const off = c.appendChild(el('button', 'ep-btn', 'take me off'));
    off.type = 'button';
    off.addEventListener('click', () => setPublic(false, false, off));
  } else if (!st.username) {
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
  drawPassport();
  loadBoard();
}

/* ------------------------------------------------------------- the boards --- */

async function loadBoards() {
  const r = await rpc('go_leagues');
  const sec = $('#goBoardsSec');
  if (r.missing || r.error) { sec.classList.add('hide'); return; }
  S.leagues = Array.isArray(r.data) ? r.data : [];
  drawBadges();                                           // a league's arena count makes its badge
  sec.classList.remove('hide');
  drawBoardPick();
  loadBoard();
}

function drawBoardPick() {
  const pick = $('#goBoardPick');
  pick.textContent = '';
  const add = (id, label, isName) => {
    const b = pick.appendChild(isName ? data('button', 'ep-tab', label) : el('button', 'ep-tab', label));
    b.type = 'button';
    b.setAttribute('aria-pressed', String((S.board.league || null) === (id || null)));
    if ((S.board.league || null) === (id || null)) b.classList.add('on');
    b.addEventListener('click', () => { S.board.league = id; drawBoardPick(); loadBoard(); });
  };
  add(null, 'Overall', false);
  (S.leagues || []).forEach(l => add(l.league_id, l.league, true));
  const by = $('#goBoardBy');
  by.textContent = '';
  [['arenas', 'by arenas'], ['km', 'by distance']].forEach(([v, label]) => {
    const b = by.appendChild(el('button', 'ep-tab' + (S.board.by === v ? ' on' : ''), label));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(S.board.by === v));
    b.addEventListener('click', () => { S.board.by = v; drawBoardPick(); loadBoard(); });
  });
}

async function loadBoard() {
  const host = $('#goBoard');
  if (!host || !S.leagues) return;
  const want = JSON.stringify(S.board);
  const r = await rpc('go_leaderboard', { p_league: S.board.league, p_by: S.board.by, p_limit: 100 });
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
  const rows = Array.isArray(r.data) ? r.data : [];
  if (!rows.length) {
    host.appendChild(el('div', 'go-none', 'Nobody is on this board yet. Stamp an arena and put yourself on it.'));
    return;
  }
  const wrap = host.appendChild(el('div', 'go-board-wrap'));
  const t = wrap.appendChild(el('table', 'go-board'));
  const hr = t.appendChild(el('thead')).appendChild(el('tr'));
  ['#', 'Fan', 'Arenas', 'Distance'].forEach((h, i) => {
    const th = hr.appendChild(el('th', i === 1 ? '' : 'n', h));
    th.scope = 'col';
  });
  const tb = t.appendChild(el('tbody'));
  rows.forEach(x => {
    const tr = tb.appendChild(el('tr', x.me ? 'me' : ''));
    tr.appendChild(data('td', 'n', String(x.rank)));
    tr.appendChild(data('td', 'who', '@' + x.username));
    tr.appendChild(data('td', 'n', String(x.arenas)));
    tr.appendChild(data('td', 'n', kmText(Number(x.km))));
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
      loadBoard();
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
  loadBoards();
}

return { boot, metres, placeOf, nearby, nearest, distanceText, kmText, numbersOf, byLeague, badgesOf, whyOf, factsOf, WHY, GEO,
         PHOTO_WHY, PHOTO_STATE, ALLOW_M, NEAR_M };
}));
