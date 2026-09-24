'use strict';
/* ============================================================================
   GAMES BEEN TO - the fans' photographs of the games they stamped (EPINOIA GO phase 5, migration 0167).

   A wall of square tiles, browsed the way a collection is: newest or most liked, one league, one fan, one
   arena or one game (?u= ?v= ?g=), a page more at a time. A tile opens the photograph whole, with who
   took it and where, a like, a report, and the ways into more of the same game, arena or fan; ?p=<id>
   opens one by its link.

   Everything on the wall was approved by a person first (D7). Public files are named for the photograph,
   never for its fan (0167), so nothing here ties a username to an account.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaGoPhotos = api; if (typeof document !== 'undefined') api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const PAGE = 48;

/* ---------------------------------------------------------------- pure --- */

function publicUrl(cfg, path) {
  if (!cfg || !path) return null;
  return cfg.supabaseUrl + '/storage/v1/object/public/go-public/' + path.split('/').map(encodeURIComponent).join('/');
}

/* the wall's filters from the address: ?l=<league id> ?u=<username> ?v=<arena id> ?g=<game id> ?s=liked ?p=<photo> */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readParams(search) {
  const q = new URLSearchParams(search || '');
  const id = k => (UUID.test(q.get(k) || '') ? q.get(k).toLowerCase() : null);
  const u = (q.get('u') || '').replace(/^@/, '');
  return { league: id('l'), venue: id('v'), game: id('g'), photo: id('p'),
           username: /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(u) ? u : null,
           sort: q.get('s') === 'liked' ? 'liked' : 'new' };
}

function writeParams(f) {
  const q = new URLSearchParams();
  if (f.league) q.set('l', f.league);
  if (f.username) q.set('u', f.username);
  if (f.venue) q.set('v', f.venue);
  if (f.game) q.set('g', f.game);
  if (f.sort === 'liked') q.set('s', 'liked');
  if (f.photo) q.set('p', f.photo);
  const s = q.toString();
  return s ? '?' + s : '';
}

/* ---------------------------------------------------------------- page --- */

const S = { cfg: null, access: null, session: null, f: null, rows: [], done: false, leagues: [], open: -1, venueName: null, gameName: null };
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const loc = () => (window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;
const day = s => s ? new Date(s).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';

async function session() {
  try { return S.access && S.access.sessionReady ? await S.access.sessionReady() : null; } catch (_) { return null; }
}
function headers() {
  const h = { apikey: S.cfg.supabaseAnonKey, Accept: 'application/json', 'Content-Type': 'application/json' };
  if (S.session && S.session.token) h.Authorization = 'Bearer ' + S.session.token;
  return h;
}
async function rpc(fn, body) {
  try {
    const r = await fetch(S.cfg.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: headers(),
      body: JSON.stringify(body || {}) });
    if (r.status === 404) return { missing: true };
    if (!r.ok) return { error: r.status };
    return { data: await r.json() };
  } catch (_) { return { error: 'network' }; }
}

function say(msg) {
  const w = $('#gpWall');
  w.textContent = '';
  w.setAttribute('aria-busy', 'false');
  const e = w.appendChild(el('div', 'gp-empty', msg));
  e.style.gridColumn = '1 / -1';
  return e;
}

function go(f, keepRows) {
  S.f = Object.assign({}, f, { photo: null });
  history.replaceState(null, '', location.pathname + writeParams(S.f));
  if (!keepRows) { S.rows = []; S.done = false; }
  drawBar();
  load();
}

function drawBar() {
  const sort = $('#gpSort');
  sort.textContent = '';
  [['new', 'newest'], ['liked', 'most liked']].forEach(([v, t]) => {
    const b = sort.appendChild(el('button', 'ep-tab' + (S.f.sort === v ? ' on' : ''), t));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(S.f.sort === v));
    b.addEventListener('click', () => go(Object.assign({}, S.f, { sort: v })));
  });
  const sel = $('#gpLeague');
  sel.textContent = '';
  const all = sel.appendChild(el('option', null, 'every league'));
  all.value = '';
  S.leagues.forEach(l => { const o = sel.appendChild(data('option', null, l.league)); o.value = l.league_id; });
  sel.value = S.f.league || '';
  const chips = $('#gpChips');
  chips.textContent = '';
  const chip = (label, value, key) => {
    const c = chips.appendChild(el('button', 'gp-chip'));
    c.type = 'button';
    c.appendChild(el('span', null, label));
    c.appendChild(document.createTextNode(': '));
    c.appendChild(data('b', null, value));
    c.appendChild(document.createTextNode(' ×'));
    c.setAttribute('aria-label', 'remove');
    c.addEventListener('click', () => go(Object.assign({}, S.f, { [key]: null })));
  };
  if (S.f.username) chip('Fan', '@' + S.f.username, 'username');
  if (S.f.venue) chip('Arena', S.venueName || '…', 'venue');
  if (S.f.game) chip('Game', S.gameName || '…', 'game');
}

async function load() {
  const w = $('#gpWall');
  w.setAttribute('aria-busy', 'true');
  const last = S.rows[S.rows.length - 1];
  const r = await rpc('go_photos_feed', {
    p_league: S.f.league, p_venue: S.f.venue, p_game: S.f.game, p_username: S.f.username, p_sort: S.f.sort,
    p_before: S.f.sort === 'new' && last ? last.created_at : null,
    p_offset: S.f.sort === 'liked' ? S.rows.length : 0, p_limit: PAGE });
  if (r.missing) { say('The feed opens soon.'); $('#gpMore').classList.add('hide'); return; }
  const rows = Array.isArray(r.data) ? r.data : [];
  if (!S.rows.length) w.textContent = '';
  S.rows = S.rows.concat(rows);
  S.done = rows.length < PAGE;
  if (S.f.venue && rows[0]) S.venueName = rows[0].venue;
  if (S.f.game && rows[0]) S.gameName = (rows[0].home || '—') + ' v ' + (rows[0].away || '—');
  drawBar();
  if (!S.rows.length) {
    const e = say('No photographs here yet. Stamp a game on EPINOIA GO and add yours.');
    e.textContent = '';
    e.appendChild(el('span', null, 'No photographs here yet.'));
    e.appendChild(document.createTextNode(' '));
    const a = e.appendChild(el('a', null, 'Stamp a game on EPINOIA GO and add yours.'));
    a.href = '../';
  }
  rows.forEach((x, i) => w.appendChild(tile(x, S.rows.length - rows.length + i)));
  w.setAttribute('aria-busy', 'false');
  $('#gpMore').classList.toggle('hide', S.done || !S.rows.length);
}

function tile(x, i) {
  const b = el('button', 'gp-tile');
  b.type = 'button';
  const img = b.appendChild(el('img'));
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = [x.venue, day(x.tipoff_at || x.created_at)].filter(Boolean).join(' · ');
  img.setAttribute('translate', 'no');
  img.src = publicUrl(S.cfg, x.thumb_path);
  b.appendChild(data('span', 'cap', [x.venue, day(x.tipoff_at || x.created_at)].filter(Boolean).join(' · ')));
  if (x.likes) b.appendChild(data('span', 'lk', '♥ ' + x.likes));
  b.addEventListener('click', () => view(i));
  return b;
}

/* one photograph, whole */
function view(i, row) {
  const x = row || S.rows[i];
  if (!x) return;
  S.open = row ? -1 : i;
  const v = $('#gpView');
  $('#gpImg').src = publicUrl(S.cfg, x.path);
  $('#gpImg').alt = [x.caption, x.venue].filter(Boolean).join(' · ');
  const info = $('#gpInfo');
  info.textContent = '';
  if (x.caption) info.appendChild(data('div', 'c', x.caption));
  const w = info.appendChild(el('div', 'w'));
  w.appendChild(data('b', null, '@' + x.username));
  w.appendChild(document.createTextNode(' · '));
  w.appendChild(data('span', null, [x.venue, x.city].filter(Boolean).join(', ')));
  if (x.home || x.away) { w.appendChild(document.createTextNode(' · ')); w.appendChild(data('span', null, (x.home || '—') + ' v ' + (x.away || '—'))); }
  w.appendChild(document.createTextNode(' · '));
  w.appendChild(data('span', null, [x.league, day(x.tipoff_at || x.created_at)].filter(Boolean).join(' · ')));
  const acts = info.appendChild(el('div', 'gp-acts'));
  const like = acts.appendChild(el('button', x.liked ? 'liked' : ''));
  like.type = 'button';
  like.setAttribute('aria-pressed', String(!!x.liked));
  like.appendChild(el('span', null, x.liked ? 'liked' : 'like'));
  like.appendChild(data('span', null, '♥ ' + (x.likes || 0)));
  like.addEventListener('click', () => toggleLike(x, i, row));
  const more = (label, f) => { const a = acts.appendChild(el('a', null, label)); a.href = location.pathname + writeParams(f);
    a.addEventListener('click', ev => { ev.preventDefault(); close(); go(Object.assign({ sort: S.f.sort }, f)); }); };
  if (x.game_id) more('this game', { game: x.game_id });
  if (x.venue_id) more('this arena', { venue: x.venue_id });
  more('this fan', { username: x.username });
  const rep = acts.appendChild(el('button', 'gp-rep', 'report'));
  rep.type = 'button';
  rep.addEventListener('click', () => report(x));
  const note = info.appendChild(el('div', 'gp-say'));
  note.id = 'gpNote';
  $('#gpPrev').classList.toggle('hide', S.open <= 0);
  $('#gpNext').classList.toggle('hide', S.open < 0 || S.open >= S.rows.length - 1);
  v.classList.add('on');
  document.body.style.overflow = 'hidden';
  history.replaceState(null, '', location.pathname + writeParams(Object.assign({}, S.f, { photo: x.id })));
  $('#gpClose').focus();
}

function close() {
  $('#gpView').classList.remove('on');
  document.body.style.overflow = '';
  history.replaceState(null, '', location.pathname + writeParams(S.f));
}

async function toggleLike(x, i, row) {
  S.session = await session();
  if (!S.session) {
    const n = $('#gpNote');
    n.textContent = '';
    const a = n.appendChild(el('a', null, 'Sign in to like a photograph.'));
    a.href = S.access && S.access.signinHref ? S.access.signinHref() : '../../signin/';
    a.style.color = 'inherit';
    return;
  }
  const r = await rpc('like_go_photo', { p_photo: x.id, p_on: !x.liked });
  if (r.data && r.data.ok) { x.liked = r.data.liked; x.likes = r.data.likes; view(i, row); }
}

async function report(x) {
  S.session = await session();
  const n = $('#gpNote');
  if (!S.session) { n.textContent = 'Sign in to report a photograph.'; return; }
  const why = window.prompt('What is wrong with this photograph?', '');
  if (why == null) return;
  const r = await rpc('report_go_photo', { p_photo: x.id, p_reason: why });
  n.textContent = r.data && r.data.ok ? 'Thank you. A person will look at it.' : 'That did not go through. Try again in a moment.';
}

async function boot() {
  S.cfg = window.EPINOIA_CONFIG;
  S.access = window.EpinoiaAccess || null;
  if (!S.cfg) { say('This page could not load. Try again in a moment.'); return; }
  S.session = await session();
  S.f = readParams(location.search);
  $('#gpLeague').addEventListener('change', e => go(Object.assign({}, S.f, { league: e.target.value || null })));
  $('#gpMore').addEventListener('click', load);
  $('#gpClose').addEventListener('click', close);
  $('#gpView').addEventListener('click', e => { if (e.target.id === 'gpView' || e.target.tagName === 'FIGURE') close(); });
  $('#gpPrev').addEventListener('click', () => view(S.open - 1));
  $('#gpNext').addEventListener('click', () => view(S.open + 1));
  document.addEventListener('keydown', e => {
    if (!$('#gpView').classList.contains('on')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && S.open > 0) view(S.open - 1);
    else if (e.key === 'ArrowRight' && S.open >= 0 && S.open < S.rows.length - 1) view(S.open + 1);
  });
  const lg = await rpc('go_leagues');
  S.leagues = Array.isArray(lg.data) ? lg.data : [];
  const first = S.f.photo;
  drawBar();
  await load();
  if (first) {
    const r = await rpc('go_photo', { p_photo: first });
    if (Array.isArray(r.data) && r.data[0]) {
      const i = S.rows.findIndex(x => x.id === first);
      if (i >= 0) view(i); else view(-1, r.data[0]);
    }
  }
}

return { boot, publicUrl, readParams, writeParams, PAGE };
}));
