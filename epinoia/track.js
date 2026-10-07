'use strict';
/* ============================================================================
   Visit counts — PERMANENTLY ANONYMOUS (migration 0173, the console's Analytics tab).

   What one page sends, and nothing else:
     page     where it is on the site ('game', 'l', 'stats/wowy', 'go' ...)
     league / team / game   the slugs or id already in its own address (?l= ?t= ?g=)
     tab      the key of a tab clicked on it (data-tab / data-p), never its words
     and, per visit: signed in yes/no, phone / tablet / desktop, the page's language,
     the app or the browser, and the SITE a visitor arrived from (host name only).

   WHO THE PAGE IS ABOUT (2026-10-06): a page that stands for a league, a club or a player always says which. The address says it where it can
   (?l= ?t= ?p= ?g=); a copy made for search engines (/p/<name>.html, /t/..., /l/..., in any language) says it in its
   <meta name="epinoia-entity">; and the page itself says it once it has found out (EpinoiaTrack.entity({ league, team, player })
   - a club opened by its id gets its slug, a player's club and league are named, a league page knows its slug). The league any page
   names for the rail (__CS_LEAGUE_SLUG) is the last resort. All of it is read when the visit is sent, a few seconds after the page
   opens, so what the page worked out in the meantime is in it. Player and club are ids and slugs of public pages, nothing about the reader.

   What it never sends or stores: an account, an email, an IP address (nothing here reads
   one and the database has no column for it), the user agent, a cookie, or anything that
   outlives the tab. `session` is random bytes kept in sessionStorage, which the browser
   deletes when the tab is closed, so tomorrow's visit is a stranger to today's and no row
   can ever be tied back to a person.

   THE SEARCH BOX (migration 0180, epinoia/search.js) reports each search once it is done - a result picked or the box closed
   - to its own function, analytics_search: the words typed (the server folds them again), how many results were shown, the
   kind of thing picked and its page name, and the same three facts as a visit (device, language, app). No session token, not
   even the per-tab one: a search cannot be joined to a visit or to another search. A query that looks like an address, a phone
   number or a web address is never sent (and never stored: the server refuses it too).

   Nothing is sent at all when the browser asks not to be tracked (Global Privacy Control or
   Do Not Track), when the privacy page's "don't count my visits" is on, or until config.js
   says analytics: true (the table exists only once 0173 is applied).

   NOR IS ANYTHING SENT FOR VISITS THAT ARE NOT FANS (26 Sep 2026):
     * a browser driven by a program - an AI assistant's browser (its user agent says Claude), a
       headless or automated one (navigator.webdriver, Puppeteer, Playwright, Selenium...), a crawler
       or link-preview robot. The user agent is read here to decide THAT and is never sent.
     * the site's own staff while signed in: nav.js writes STAFF_KEY when whoami() says the account
       is a platform admin or holds a league role, and clears it when a signed-in account is not.
       It only silences this browser while somebody is signed in; ordinary signed-in fans still count
       (as the yes/no `signed in`).

   Loaded by nav.js, so every page with the rail counts; staff tools (admin/, score/,
   broadcast/, clockcam/) and the embeds on other sites never do.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaTrack = api; api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

let ENV = null;
const g = k => (ENV && Object.prototype.hasOwnProperty.call(ENV, k)) ? ENV[k] : root[k];

const OPT_OUT_KEY = 'epinoia_no_count';
const SESSION_KEY = 'epinoia_visit';
const REF_SENT_KEY = 'epinoia_visit_ref';
const STAFF_KEY = 'epinoia_staff';       // written by nav.js from whoami(): '1' for a platform admin or league staff
const STAFF = /^(admin|score|broadcast|clockcam|embed)(\/|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,100}$/;
const TAB = /^[a-z0-9_-]{1,40}$/;

const queue = [];
let timer = null, stopped = false, session = null;
/* what the page has said it is about (entity()) */
let ENTITY = {};

function store(name) { try { return g(name) || null; } catch (_) { return null; } }
function get(s, k) { try { return s ? s.getItem(k) : null; } catch (_) { return null; } }
function set(s, k, v) { try { if (s) s.setItem(k, v); } catch (_) { /* private mode: fine */ } }

/* the one yes/no that turns everything off */
function optedOut() {
  const nav = g('navigator') || {};
  if (nav.globalPrivacyControl === true) return true;
  if (nav.doNotTrack === '1' || g('doNotTrack') === '1') return true;
  return get(store('localStorage'), OPT_OUT_KEY) === '1';
}
/* A BROWSER A PROGRAM IS DRIVING, or a robot: not a visit. The Claude desktop app's browser puts "Claude/<version>" in its
   user agent; automation frameworks set navigator.webdriver or say Headless / Puppeteer / Playwright / Selenium / PhantomJS /
   Lighthouse; crawlers and link previewers name themselves. Real phones and browsers never say any of these ("Cubot" is a
   phone, so "bot" has to stand alone or end a known crawler's name). */
const AUTOMATED = /\b(claude|anthropic)\b|headless|puppeteer|playwright|selenium|phantomjs|lighthouse|(^|[^a-z])bot([^a-z]|$)|(google|bing|yandex|baidu|duckduck|petal|semrush|ahrefs|mj12|apple|facebook|twitter|linkedin|slack|discord|telegram|whatsapp|pinterest|amazon|yahoo)bot|facebookexternalhit|crawl|spider|slurp|python-requests|node-fetch|axios|go-http-client|^curl\/|^wget\//i;
function automated() {
  const nav = g('navigator') || {};
  if (nav.webdriver === true) return true;
  return AUTOMATED.test(String(nav.userAgent || ''));
}
/* the site's own staff, and only while signed in (see the header) */
function staffSignedIn() {
  return get(store('localStorage'), STAFF_KEY) === '1' && signedIn();
}
function enabled() {
  const cfg = g('EPINOIA_CONFIG') || {};
  return cfg.analytics === true && !!cfg.supabaseUrl && !!cfg.supabaseAnonKey && !optedOut() && !automated() && !staffSignedIn();
}

/* random, per tab, forgotten when the tab closes */
function sessionToken() {
  if (session) return session;
  const ss = store('sessionStorage');
  const have = get(ss, SESSION_KEY);
  if (have && /^[A-Za-z0-9_-]{16,40}$/.test(have)) return (session = have);
  const bytes = new Uint8Array(24);
  const c = g('crypto');
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of bytes) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63];
  session = s;
  set(ss, SESSION_KEY, s);
  return s;
}

/* where on the site this is: the path below /epinoia/, 'splash' at its root */
function pageKey(pathname) {
  const seg = String(pathname || '').replace(/\/index\.html$/, '/').split('/epinoia/')[1];
  if (seg == null) return null;
  let one = seg.toLowerCase().replace(/^(ja|es)\//, '');
  /* the copies made for search engines (/p/nicklaus-reid.html, /t/..., /l/..., /game/<id>.html) are the same pages as p/, t/, l/ and game/ */
  const copy = /^(p|t|l|game)\/[^/]+\.html$/.exec(one);
  if (copy) one = copy[1];
  const key = one.replace(/\/+$/, '').replace(/[^a-z0-9/-]/g, '');
  return (key || 'splash').slice(0, 40);
}

/* WHERE THE READER IS, which is more than the path in one place: HOME's VIDEO view (home/vhmode.js, ?view=video) is a page of
   its own to a reader - the rail's VIDEOS row goes there - so it is counted as 'home/video', not as HOME. */
function here() {
  const loc = g('location') || {};
  const key = pageKey(loc.pathname);
  if (key === 'home') {
    try { if (new URLSearchParams(String(loc.search || '')).get('view') === 'video') return 'home/video'; } catch (_) { /* HOME */ }
  }
  return key;
}

const clean = v => { const x = String(v == null ? '' : v).trim().toLowerCase(); return SLUG.test(x) ? x : null; };
/* the page says who it is about, once it knows: { league, team, player } as slugs (a player as his or her id) */
function entity(o) {
  ['league', 'team', 'player'].forEach(k => { const v = clean(o && o[k]); if (v) ENTITY[k] = v; });
}
function context() {
  const loc = g('location') || {};
  const q = new URLSearchParams(String(loc.search || ''));
  const page = pageKey(loc.pathname);
  const em = g('document') && g('document').querySelector ? g('document').querySelector('meta[name="epinoia-entity"]') : null;
  const meta = em ? String(em.content || '') : '';
  const gm = String(q.get('g') || (em && /\/game\//.test(String(loc.pathname || '')) && em.content) || '');
  let team = clean(q.get('t')) || (page === 't' ? clean(meta) : null);
  /* a club opened by its id is counted by its slug, which is what the league tables join on */
  if ((!team || UUID.test(team)) && ENTITY.team) team = ENTITY.team;
  let slugOfRail = null;
  try { slugOfRail = clean(g('__CS_LEAGUE_SLUG')); } catch (_) { slugOfRail = null; }
  return {
    league: clean(q.get('l')) || (page === 'l' ? clean(meta) : null) || ENTITY.league || slugOfRail,
    team,
    player: ENTITY.player || clean(q.get('p')) || (page === 'p' ? clean(meta) : null),
    game: UUID.test(gm) ? gm.toLowerCase() : null
  };
}

/* signed in = the SDK's stored session names a user. Only the yes/no leaves the page. */
function signedIn() {
  const cfg = g('EPINOIA_CONFIG') || {};
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(cfg.supabaseUrl || '');
  const raw = m ? get(store('localStorage'), 'sb-' + m[1] + '-auth-token') : null;
  if (!raw) return false;
  try { const s = JSON.parse(raw); return !!(s && (s.user || (s.currentSession && s.currentSession.user))); }
  catch (_) { return false; }
}

function device() {
  const w = Number(g('innerWidth')) || 1200;
  const mm = g('matchMedia');
  let coarse = false;
  try { coarse = typeof mm === 'function' && !!mm.call(root, '(pointer: coarse)').matches; } catch (_) { coarse = false; }
  if (w < 720) return 'phone';
  if (w < 1100 && coarse) return 'tablet';
  return 'desktop';
}
function app() {
  const doc = g('document');
  const cl = doc && doc.documentElement && doc.documentElement.classList;
  if (cl && cl.contains('m-ios-app')) return 'ios';
  if (cl && cl.contains('m-app')) return 'android';
  return 'web';
}
function lang() {
  const doc = g('document');
  const l = String((doc && doc.documentElement && doc.documentElement.lang) || '').slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(l) ? l : null;
}
/* the site a visitor came from, host only, once a visit, and never this site itself */
function referrerHost() {
  const ss = store('sessionStorage');
  if (get(ss, REF_SENT_KEY)) return null;
  set(ss, REF_SENT_KEY, '1');
  const doc = g('document');
  const loc = g('location') || {};
  try {
    const u = new URL(String((doc && doc.referrer) || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const self = String(loc.hostname || '').toLowerCase().replace(/^www\./, '');
    return host && host !== self && /^[a-z0-9.-]{1,100}$/.test(host) ? host : null;
  } catch (_) { return null; }
}

/* WHERE A VISIT CAME FROM (2026-10-06): the first page view of a visit is its landing; it carries the campaign tags of a link of ours
   (utm_source / utm_medium / utm_campaign, as short slugs) and, for a Google advert's click id, medium 'cpc'. The search engine itself is
   worked out by the server from the referring host (p_ref). A search engine never passes what was searched, so nothing of the sort is read. */
const LANDED_KEY = 'epinoia_visit_landed';
function landingTags() {
  const ss = store('sessionStorage');
  if (get(ss, LANDED_KEY)) return {};
  set(ss, LANDED_KEY, '1');
  const out = { landing: true };
  try {
    const q = new URLSearchParams(String((g('location') || {}).search || ''));
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => {
      const v = String(q.get(k) || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (v) out[k] = v;
    });
    if (!out.utm_medium && (q.get('gclid') || q.get('gbraid') || q.get('wbraid'))) { out.utm_medium = 'cpc'; if (!out.utm_source) out.utm_source = 'google'; }
  } catch (_) { /* a count is never worth a page */ }
  return out;
}

function push(ev) {
  if (stopped || !enabled()) return;
  queue.push(ev);
  if (queue.length >= 50) { flush(false); return; }
  if (!timer) timer = g('setTimeout').call(root, () => { timer = null; flush(false); }, sentOnce ? 4000 : 6000);   // the first visit waits for the page to say who it is about
}

let ref = undefined, sentOnce = false;
function flush(leaving) {
  if (timer) { g('clearTimeout').call(root, timer); timer = null; }
  if (stopped || !queue.length) return Promise.resolve(0);
  if (!enabled()) { queue.length = 0; return Promise.resolve(0); }     // e.g. whoami() has since said this is staff
  const events = queue.splice(0, 50);
  /* WHO IT IS ABOUT, as it is now: what the page worked out since it opened fills what the address did not say */
  const now = context();
  events.forEach(ev => {
    if (!ev.league && now.league) ev.league = now.league;
    if ((!ev.team || UUID.test(ev.team)) && now.team) ev.team = now.team;
    if (!ev.player && now.player) ev.player = now.player;
  });
  sentOnce = true;
  const cfg = g('EPINOIA_CONFIG') || {};
  if (ref === undefined) ref = referrerHost();
  const body = { p_session: sessionToken(), p_signed_in: signedIn(), p_device: device(), p_lang: lang(),
                 p_app: app(), p_ref: ref, p_events: events };
  ref = null;
  const f = g('fetch');
  if (typeof f !== 'function') return Promise.resolve(0);
  return Promise.resolve(f.call(root, cfg.supabaseUrl + '/rest/v1/rpc/analytics_track', {
    method: 'POST', keepalive: !!leaving,
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).then(r => {
    /* not there (0173 not applied) or refused: stop for this page rather than retry */
    if (!r || !r.ok) stopped = true;
    return events.length;
  }, () => 0);
}

/* One finished search (search.js): { q, n, kind, ref }. Its own switch (a failure of this call, before 0180 is applied, does not
   stop the page views) and its own function; the same opt-outs as everything else here. */
let searchStopped = false;
const NOT_A_QUERY = /@|https?:|www\.|\.(com|net|org|edu|gov|io)(\b|\/)/i;
function search(o) {
  if (searchStopped || stopped || !enabled()) return Promise.resolve(0);
  const q = String((o && o.q) || '').trim().slice(0, 100);
  if (q.length < 2 || NOT_A_QUERY.test(q) || q.replace(/\D/g, '').length >= 6) return Promise.resolve(0);
  const kind = o && ['league', 'team', 'player'].indexOf(o.kind) >= 0 ? o.kind : null;
  const refv = kind ? String((o && o.ref) || '').toLowerCase() : '';
  const cfg = g('EPINOIA_CONFIG') || {};
  const f = g('fetch');
  if (typeof f !== 'function') return Promise.resolve(0);
  const body = { p_q: q, p_results: Math.max(0, Math.min(30, (o && o.n) | 0)), p_picked: kind, p_ref: kind && SLUG.test(refv) ? refv : null,
                 p_device: device(), p_lang: lang(), p_app: app() };
  return Promise.resolve(f.call(root, cfg.supabaseUrl + '/rest/v1/rpc/analytics_search', {
    method: 'POST', keepalive: true,
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).then(r => { if (!r || !r.ok) searchStopped = true; return r && r.ok ? 1 : 0; }, () => 0);
}

/* A CREATOR'S PIECE (migration 0200: the creator hub's numbers). { post, kind, outlet }:
     seen   its card was on screen (once a page);
     open   its own page was opened here - from which page of the site, or which other site (host only);
     out    its link was followed, to where it lives.
   The piece's id and the page it happened on, nothing about the reader: the same per-tab token and the same opt-outs as
   a visit, its own function and its own switch (before 0200 is applied a refusal stops these alone). Never counted: an
   outlet's own people on their own piece - nav.js keeps the outlets the account writes for ('league/outlet', MINE_KEY),
   and `outlet` says whose the piece is. */
const MINE_KEY = 'epinoia_my_outlets';
const pieceQueue = [], seenOnce = new Set();
let pieceTimer = null, pieceStopped = false, pieceHooked = false;
function mine(outlet) {
  if (!outlet) return false;
  try { const m = JSON.parse(get(store('localStorage'), MINE_KEY) || '[]'); return Array.isArray(m) && m.indexOf(outlet) >= 0; }
  catch (_) { return false; }
}
/* where an opening came from: a page of this site (its key), or another site's host */
function openedFrom() {
  const doc = g('document');
  const loc = g('location') || {};
  try {
    const u = new URL(String((doc && doc.referrer) || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const self = String(loc.hostname || '').toLowerCase().replace(/^www\./, '');
    if (host === self) { const k = pageKey(u.pathname); return { source: k && !STAFF.test(k) ? k : null, ref: null }; }
    return { source: null, ref: /^[a-z0-9.-]{1,100}$/.test(host) ? host : null };
  } catch (_) { return { source: null, ref: null }; }
}
function piece(o) {
  if (pieceStopped || stopped || !enabled()) return;
  const post = String((o && o.post) || '').toLowerCase();
  const kind = o && ['seen', 'open', 'out'].indexOf(o.kind) >= 0 ? o.kind : null;
  if (!UUID.test(post) || !kind || mine(o.outlet)) return;
  if (kind === 'seen') { if (seenOnce.has(post)) return; seenOnce.add(post); }
  const on = here();
  const at = kind === 'open' ? openedFrom() : { source: on && !STAFF.test(on) ? on : null, ref: null };
  pieceQueue.push({ post, kind, source: at.source, ref: at.ref });
  if (!pieceHooked) {
    pieceHooked = true;
    const doc = g('document'), w = g('addEventListener');
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') flushPieces(true); });
    if (typeof w === 'function') w.call(root, 'pagehide', () => flushPieces(true));
  }
  /* a link followed may be the page leaving: at once, and kept alive */
  if (kind === 'out' || pieceQueue.length >= 50) { flushPieces(kind === 'out'); return; }
  if (!pieceTimer) pieceTimer = g('setTimeout').call(root, () => { pieceTimer = null; flushPieces(false); }, 3000);
}
function flushPieces(leaving) {
  if (pieceTimer) { g('clearTimeout').call(root, pieceTimer); pieceTimer = null; }
  if (pieceStopped || !pieceQueue.length) return Promise.resolve(0);
  if (!enabled()) { pieceQueue.length = 0; return Promise.resolve(0); }
  const events = pieceQueue.splice(0, 50);
  const cfg = g('EPINOIA_CONFIG') || {};
  const f = g('fetch');
  if (typeof f !== 'function') return Promise.resolve(0);
  return Promise.resolve(f.call(root, cfg.supabaseUrl + '/rest/v1/rpc/creator_track', {
    method: 'POST', keepalive: !!leaving,
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session: sessionToken(), p_device: device(), p_events: events })
  })).then(r => { if (!r || !r.ok) pieceStopped = true; return events.length; }, () => 0);
}

/* A tab is recorded by its KEY, which is the same in every language: data-tab (the box
   score, the league page), data-p, data-key. A tab that has no key is not recorded. */
function onClick(e) {
  const t = e && e.target && e.target.closest ? e.target.closest('[data-tab],[data-p],[data-key]') : null;
  if (!t || !t.dataset) return;
  const isTab = t.getAttribute('role') === 'tab' || t.hasAttribute('data-tab') ||
                /(^|\s)(ep-tab|tabbtn)(\s|$)/.test(t.className || '');
  if (!isTab) return;
  const key = String(t.dataset.tab || t.dataset.p || t.dataset.key || '').toLowerCase();
  const page = here();
  if (!page || STAFF.test(page) || !TAB.test(key)) return;
  const c = context();
  push({ kind: 'tab', page, tab: key, league: c.league, team: c.team, player: c.player, game: c.game });
}

/* AN ACTION A PAGE NAMES ITSELF, for the controls that are not tabs (2026-10-07: the VIDEO view's chips, plays, live games,
   full screen, WATCH HERE, the chat). Recorded exactly as a tab is - kind 'tab', a KEY, never words - on the page it happens
   on; o = { league, game } when the action is about one (a video's league, a live game), else the page's own. */
function action(key, o) {
  const k = String(key || '').toLowerCase();
  const page = here();
  if (!page || STAFF.test(page) || !TAB.test(k)) return;
  const c = context();
  const lg = clean(o && o.league), gm = String((o && o.game) || '');
  push({ kind: 'tab', page, tab: k, league: lg || c.league, team: c.team, player: c.player,
         game: UUID.test(gm) ? gm.toLowerCase() : c.game });
}
/* A VIEW THAT CHANGES WITHOUT A NEW PAGE: HOME's MAIN -> VIDEO is a page view of 'home/video' (the address has already changed) */
function view() {
  const page = here();
  if (!page || STAFF.test(page)) return;
  const c = context();
  push({ kind: 'view', page, league: c.league, team: c.team, player: c.player, game: c.game });
}

function boot() {
  if (!enabled()) return;
  const page = here();
  if (!page || STAFF.test(page)) return;
  const c = context();
  push(Object.assign({ kind: 'view', page, league: c.league, team: c.team, player: c.player, game: c.game }, landingTags()));
  const doc = g('document');
  if (doc && doc.addEventListener) {
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(true); });
  }
  const w = g('addEventListener');
  if (typeof w === 'function') w.call(root, 'pagehide', () => flush(true));
}

/* the privacy page's switch */
function setCounting(on) {
  const ls = store('localStorage');
  try { if (on) ls.removeItem(OPT_OUT_KEY); else ls.setItem(OPT_OUT_KEY, '1'); } catch (_) { /* nothing stored */ }
  if (!on) { queue.length = 0; stopped = true; }
}
function counting() { return !optedOut(); }

return {
  boot, flush, entity, setCounting, counting, search, piece, flushPieces, action, view, MINE_KEY,
  _test: {
    env(e) { ENV = e || null; ENTITY = {}; sentOnce = false; queue.length = 0; stopped = false; searchStopped = false; session = null; ref = undefined; timer = null;
             pieceQueue.length = 0; seenOnce.clear(); pieceStopped = false; pieceTimer = null; pieceHooked = false; },
    pageKey, here, context, signedIn, device, app, lang, referrerHost, optedOut, enabled, automated, staffSignedIn, onClick, queue,
    pieceQueue, openedFrom, mine
  }
};
}));
