'use strict';
/* ============================================================================
   Visit counts — PERMANENTLY ANONYMOUS (migration 0173, the console's Analytics tab).

   What one page sends, and nothing else:
     page     where it is on the site ('game', 'l', 'stats/wowy', 'go' ...)
     league / team / game   the slugs or id already in its own address (?l= ?t= ?g=)
     tab      the key of a tab clicked on it (data-tab / data-p), never its words
     and, per visit: signed in yes/no, phone / tablet / desktop, the page's language,
     the app or the browser, and the SITE a visitor arrived from (host name only).
   ...and, since 0260, what is done on the page: time in use and how far it was read, videos played and how far, files
   downloaded (what and from where), links out (site name only), shares and copies, load speed, script errors (file and
   line), and our widgets seen on other sites - see WHAT PEOPLE DO ON A PAGE below. All in one request as the page is left.

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

   Loaded by nav.js, so every page with the rail counts; staff tools (admin/, score/, broadcast/, clockcam/) never do. The
   widgets on other sites (embed/<widget>) load it themselves and count only as a widget seen, never as a visit.
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
/* staff tools are never counted; a widget drawn on another site (embed/<widget>) is counted only as a widget seen (0260), never as a visit */
const STAFF = /^(admin|score|broadcast|clockcam)(\/|$)|^embed\//;
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

/* ============================================================================
   WHAT PEOPLE DO ON A PAGE (migration 0260, analytics_activity) — still anonymous, the same token and opt-outs as a visit.
     time      seconds the page was in use (visible, and touched / scrolled / typed in the last 30 s, or a video playing),
               and how far down it was read, sent when the reader leaves or hides it
     video     a video's public id on its platform and how far it got: open, play, q25 / q50 / q75 / done, and seconds watched
     download  what was saved (the link's data-track key: 'report', 'season-stats' ...) and its format, from this page
     out       the NAME of another site a link went to, never the address
     share / copy   that the share sheet or a copy button was used, and the kind of thing (never what was copied)
     speed     milliseconds until the page's main content was drawn, once a load
     error     a script error in this site's own code as file and line, never its message (at most five a page)
     embed     a widget of ours drawn on another site: which widget and that site's name
   LIGHT BY DESIGN: everything waits in one queue and goes in ONE request when the page is hidden or left (keepalive), or
   sooner only if 40 pile up. One timer every five seconds does the time-keeping and looks for new video players; no
   observer watches the page, nothing polls the server.
   ============================================================================ */
const TICK_MS = 5000, IDLE_MS = 30000, ACT_MAX = 40;
const actQueue = [];
let actStopped = false;
let curSig = null, curBase = null;          // the page view being read now, and who it is about
let unsent = 0, depthMax = 0, lastInput = 0, lastScrollAt = 0, tickTimer = null, errs = 0, speedSend = null, hooked = false;
let lastActCtx = null;                      // an action that named a league or game, for the video it starts
const players = new Map();                  // a video player on the page -> how far it has got
let playerSeq = 0;

const nowMs = () => Date.now();
const keyOf = v => { const k = String(v == null ? '' : v).trim().toLowerCase(); return /^[a-z0-9_-]{1,40}$/.test(k) ? k : null; };
const selfHost = () => String((g('location') || {}).hostname || '').toLowerCase().replace(/^www\./, '');
/* an address as the browser would follow it from this page (an absolute one needs no page to stand on) */
function absUrl(h) { const base = String((g('location') || {}).href || ''); return base ? new URL(String(h || ''), base) : new URL(String(h || '')); }

/* the page as the address says it, for telling a new page from a tidier address */
function sigNow() {
  const loc = g('location') || {};
  let q;
  try { q = new URLSearchParams(String(loc.search || '')); } catch (_) { q = { get: () => null }; }
  return { page: here(), l: q.get('l'), t: q.get('t'), p: q.get('p'), g: q.get('g') };
}
/* the same page: same place, and nothing it was about has changed to something else (a filled-in slug, an id swapped
   for its slug, or a filter added are not new pages) */
function sameView(a, b) {
  if (!a || !b || a.page !== b.page) return false;
  for (const k of ['l', 't', 'p', 'g']) {
    const x = a[k], y = b[k];
    if (x && y && x !== y && UUID.test(x) === UUID.test(y)) return false;
  }
  return true;
}
function baseFrom(page) {
  const c = context();
  return { page, league: c.league, team: c.team, player: c.player, game: c.game };
}
/* who the page is about now: what it has worked out since it opened, while the reader is still on it */
function baseNow() {
  if (curBase && curSig && sameView(curSig, sigNow())) {
    const c = context();
    ['league', 'team', 'player', 'game'].forEach(k => { if (!curBase[k] && c[k]) curBase[k] = c[k]; });
  }
  return curBase;
}

/* its own switch in config.js (analyticsActivity: true), turned on once 0260 is applied, so no page asks for a function the
   database does not have yet */
function activityOn() { const cfg = g('EPINOIA_CONFIG') || {}; return cfg.analyticsActivity === true; }
function actPush(ev) {
  if (actStopped || !activityOn() || !enabled() || !ev || !ev.page) return;
  actQueue.push(ev);
  if (actQueue.length >= ACT_MAX) flushActivity(false);
}
function flushActivity(leaving) {
  if (actStopped || !actQueue.length) return Promise.resolve(0);
  if (!enabled()) { actQueue.length = 0; return Promise.resolve(0); }
  const events = actQueue.splice(0, 50);
  const cfg = g('EPINOIA_CONFIG') || {};
  const f = g('fetch');
  if (typeof f !== 'function') return Promise.resolve(0);
  return Promise.resolve(f.call(root, cfg.supabaseUrl + '/rest/v1/rpc/analytics_activity', {
    method: 'POST', keepalive: !!leaving,
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session: sessionToken(), p_device: device(), p_app: app(), p_events: events })
  })).then(r => { if (!r || !r.ok) actStopped = true; return events.length; }, () => 0);
}

/* ---- time on the page, and how far down it was read ---- */
function visible() { const d = g('document'); return !d || d.visibilityState !== 'hidden'; }
let lcpCut = Infinity;                       // load speed stops at the reader's first touch or key, as browsers measure it
function noteInput() { lastInput = nowMs(); if (lcpCut === Infinity) { try { lcpCut = g('performance').now(); } catch (_) { lcpCut = 0; } } }
function pageDepth() {
  const d = g('document'), de = d && d.documentElement;
  if (!de) return 0;
  const h = Math.max(de.scrollHeight || 0, (d.body && d.body.scrollHeight) || 0);
  const vh = Number(g('innerHeight')) || de.clientHeight || 0;
  const y = Number(g('scrollY')) || de.scrollTop || 0;
  if (!h || !vh) return 0;
  if (h <= vh + 8) return 100;
  return Math.max(0, Math.min(100, Math.round(100 * (y + vh) / h)));
}
/* a scroll, of the page or of a big panel that scrolls inside it (several pages read in a column of their own) */
function onScroll(e) {
  noteInput();
  const t = nowMs();
  if (t - lastScrollAt < 400) return;
  lastScrollAt = t;
  let d = pageDepth();
  const el = e && e.target;
  if (el && el.nodeType === 1 && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 0.5 * (Number(g('innerHeight')) || 0)) {
    d = Math.max(d, Math.min(100, Math.round(100 * (el.scrollTop + el.clientHeight) / el.scrollHeight)));
  }
  if (d > depthMax) depthMax = d;
}
function videoPlaying() {
  for (const s of players.values()) if (s.el.isConnected !== false && (s.playing || (!s.api && s.kind === 'frame'))) return true;
  return false;
}
function tick() {
  if (visible() && (nowMs() - lastInput < IDLE_MS || videoPlaying())) unsent += TICK_MS / 1000;
  scanPlayers();
}
function emitTime() {
  const b = baseNow();
  if (!b || unsent < 1) { unsent = 0; return; }
  actPush(Object.assign({ kind: 'time', secs: Math.round(unsent), depth: Math.max(depthMax, pageDepth()) }, b));
  unsent = 0;
}

/* ---- a new page view: the first, or one made without loading a page (the address changed to another page or person) ---- */
function countView(extra) {
  const page = here();
  if (!page || STAFF.test(page)) return false;
  const s = sigNow();
  if (curSig && sameView(curSig, s)) { curSig = s; return false; }
  if (curSig) { emitTime(); players.forEach(flushWatch); }
  curSig = s;
  curBase = baseFrom(page);
  depthMax = 0; unsent = 0; lastInput = nowMs();
  push(Object.assign({ kind: 'view' }, curBase, extra || {}));
  return true;
}
function hookHistory() {
  const H = g('history');
  if (!H || H.__epTrack) return;
  ['pushState', 'replaceState'].forEach(m => {
    const orig = H[m];
    if (typeof orig !== 'function') return;
    H[m] = function () { const r = orig.apply(this, arguments); try { countView(); } catch (_) { /* a count is never worth a page */ } return r; };
  });
  try { H.__epTrack = true; } catch (_) { /* fine */ }
  const w = g('addEventListener');
  if (typeof w === 'function') w.call(root, 'popstate', () => { try { countView(); } catch (_) { /* fine */ } });
}

/* ---- links: a file saved, a calendar subscribed to, another site ---- */
function fmtOf(name, href) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || '')) ||
            (/^blob:|^data:/i.test(href) ? null : /\.([a-z0-9]{1,8})(?:[?#]|$)/i.exec(String(href || '').split(/[?#]/)[0]));
  return m ? m[1].toLowerCase() : 'file';
}
function linkClicked(a) {
  const b = baseNow();
  if (!b) return false;
  const href = String(a.getAttribute('href') || '');
  const dl = typeof a.hasAttribute === 'function' && a.hasAttribute('download');
  const cal = /^webcals?:|scheme=webcal|\.ics(\?|#|$)/i.test(href);
  if (dl || cal) {
    const what = keyOf(a.dataset && a.dataset.track) || (cal ? 'calendar' : 'file');
    actPush(Object.assign({ kind: 'download', what, fmt: cal ? 'ics' : fmtOf(a.getAttribute('download'), href) }, b));
    return true;
  }
  try {
    const u = absUrl(href);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host && host !== selfHost() && /^[a-z0-9.-]{1,80}$/.test(host)) actPush(Object.assign({ kind: 'out', what: host }, b));
  } catch (_) { /* not a link anywhere */ }
  return false;
}
/* a page saving something without a link of its own (a report drawn and handed over another way) says so here */
function download(what, fmt) {
  const b = baseNow(), k = keyOf(what), f = keyOf(fmt);
  if (b && k) actPush(Object.assign({ kind: 'download', what: k, fmt: f && /^[a-z0-9]{1,12}$/.test(f) ? f : 'file' }, b));
}

/* ---- sharing: the share sheet, and the copy buttons (never what was copied) ---- */
function copyKind(text) {
  const d = g('document'), ae = d && d.activeElement;
  const tr = ae && ae.closest ? ae.closest('[data-track]') : null;
  const k = keyOf(tr && tr.dataset && tr.dataset.track);
  if (k) return k;
  const s = String(text == null ? '' : text);
  if (/^\s*<(iframe|script|div)/i.test(s)) return 'embed-code';
  if (/^\s*(https?|webcal):\/\//i.test(s)) return 'link';
  return 'text';
}
function hookSharing() {
  const nav = g('navigator');
  if (!nav) return;
  try {
    if (typeof nav.share === 'function' && !nav.share.__ep) {
      const o = nav.share;
      const w = function () { try { const b = baseNow(); if (b) actPush(Object.assign({ kind: 'share', what: 'native' }, b)); } catch (_) { /* fine */ } return o.apply(this, arguments); };
      w.__ep = true;
      nav.share = w;
    }
  } catch (_) { /* a browser that will not have it wrapped */ }
  try {
    const cb = nav.clipboard;
    if (cb && typeof cb.writeText === 'function' && !cb.writeText.__ep) {
      const o = cb.writeText;
      const w = function (text) { try { const b = baseNow(); if (b) actPush(Object.assign({ kind: 'copy', what: copyKind(text) }, b)); } catch (_) { /* fine */ } return o.apply(this, arguments); };
      w.__ep = true;
      cb.writeText = w;
    }
  } catch (_) { /* fine */ }
}

/* ---- speed: until the page's main content was drawn, once a load, and only a load somebody waited for ---- */
function measureSpeed() {
  if (!visible()) return;
  let lcp = 0, sent = false;
  try {
    const P = g('PerformanceObserver');
    if (typeof P === 'function') new P(list => { list.getEntries().forEach(e => { if (e.startTime <= lcpCut) lcp = e.startTime; }); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) { /* no LCP here: the load's own timing below */ }
  speedSend = () => {
    if (sent) return;
    sent = true;
    let ms = lcp;
    if (!ms) { try { const n = g('performance').getEntriesByType('navigation')[0]; ms = n && (n.domContentLoadedEventEnd || n.responseEnd); } catch (_) { ms = 0; } }
    ms = Math.round(ms || 0);
    const b = baseNow();
    if (b && ms > 0 && ms <= 120000) actPush(Object.assign({ kind: 'speed', ms }, b));
  };
  const st = g('setTimeout');
  if (typeof st === 'function') st.call(root, () => speedSend && speedSend(), 15000);
}

/* ---- script errors in this site's own files: file and line, never the message ---- */
function ownFile(url) {
  try {
    const loc = g('location') || {};
    const u = absUrl(url);
    if (u.hostname.toLowerCase() !== String(loc.hostname || '').toLowerCase()) return null;
    const f = (u.pathname.split('/').pop() || '').toLowerCase();
    return /^[a-z0-9._-]{1,55}\.js$/.test(f) ? f : null;
  } catch (_) { return null; }
}
function noteError(file, line) {
  const b = baseNow();
  if (!b || errs >= 5 || !file) return;
  errs++;
  const n = Number(line) | 0;
  actPush(Object.assign({ kind: 'error', what: file + (n > 0 && n < 1000000 ? ':' + n : '') }, b));
}
function onError(e) { noteError(ownFile(e && e.filename), e && e.lineno); }
function onRejection(e) {
  const st = String((e && e.reason && e.reason.stack) || '');
  const m = /(https?:\/\/[^\s)]+?\.js)(?:\?[^\s):]*)?:(\d+):\d+/.exec(st);
  if (m) noteError(ownFile(m[1]), m[2]);
}

/* ---- videos: every player on the page, whichever part of the site put it there ---- */
const VIDEO_WHAT = /^[a-z-]{2,14}:[A-Za-z0-9._-]{1,64}$/;
const NO_VIDEO_PAGES = /^(edit|creators\/studio)$/;           // tools for cutting and tagging, not watching
function videoOf(src) {
  let u;
  try { u = absUrl(src); } catch (_) { return null; }
  const h = u.hostname.toLowerCase().replace(/^www\./, ''), p = u.pathname;
  let m, out = null;
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) {
    if (/\/embed\/live_stream/.test(p)) { const ch = u.searchParams.get('channel'); if (ch) out = { what: 'youtube-live:' + ch, api: /enablejsapi=1/.test(u.search) ? 'yt' : null, live: true }; }
    else if ((m = /\/embed\/([A-Za-z0-9_-]{11})/.exec(p))) out = { what: 'youtube:' + m[1], api: /enablejsapi=1/.test(u.search) ? 'yt' : null };
  } else if (h === 'player.vimeo.com' && (m = /\/video\/(\d+)/.exec(p))) out = { what: 'vimeo:' + m[1], api: 'vimeo' };
  else if (h === 'player.twitch.tv') {
    const v = u.searchParams.get('video'), c = u.searchParams.get('channel');
    if (v) out = { what: 'twitch:' + v.replace(/^v/, ''), api: null };
    else if (c) out = { what: 'twitch-live:' + c.toLowerCase(), api: null, live: true };
  } else if (/(^|\.)facebook\.com$/.test(h) && /\/plugins\/video/.test(p)) {
    m = /\/videos\/(\d+)/.exec(decodeURIComponent(u.searchParams.get('href') || ''));
    if (m) out = { what: 'facebook:' + m[1], api: null };
  } else if (h === 'tiktok.com' && (m = /\/embed\/v2\/(\d+)/.exec(p))) out = { what: 'tiktok:' + m[1], api: null };
  else if (h === 'instagram.com' && (m = /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(p))) out = { what: 'instagram:' + m[2], api: null };
  return out && VIDEO_WHAT.test(out.what) ? out : null;
}
/* the league / game a video is about: the player's own markup says it, or the action that started it, or the page */
function videoBase(el) {
  const b = Object.assign({}, baseNow() || {});
  const gEl = el && el.closest ? el.closest('[data-game]') : null, lEl = el && el.closest ? el.closest('[data-league]') : null;
  const gm = String((gEl && gEl.dataset && gEl.dataset.game) || '');
  if (UUID.test(gm)) b.game = gm.toLowerCase();
  const lg = clean(lEl && lEl.dataset && lEl.dataset.league);
  if (lg) b.league = lg;
  if (lastActCtx && nowMs() - lastActCtx.at < 3000) {
    if (lastActCtx.league) b.league = lastActCtx.league;
    if (lastActCtx.game) b.game = lastActCtx.game;
  }
  return b;
}
function videoStep(s, step) {
  if (s.steps.has(step)) return;
  s.steps.add(step);
  if (s.base && s.base.page) actPush(Object.assign({}, s.base, { kind: 'video', what: s.what, step }));
}
function flushWatch(s) {
  if (s.secs >= 1 && s.base && s.base.page) actPush(Object.assign({}, s.base, { kind: 'video', what: s.what, step: 'watch', secs: Math.round(s.secs) }));
  s.secs = 0;
}
function playState(s, on) {
  if (on && !s.playing) { videoStep(s, 'play'); s.lastT = null; }
  s.playing = on;
}
function progress(s, t, d) {
  if (!(t >= 0)) return;
  if (d > 0 && isFinite(d)) s.dur = d; else d = s.dur;           /* a player says its length now and then, not every time */
  if (s.playing && s.lastT != null) { const dt = t - s.lastT; if (dt > 0 && dt <= 5) s.secs += dt; }
  s.lastT = t;
  if (!s.live && d > 0 && isFinite(d)) {
    const pct = 100 * t / d;
    if (pct >= 25) videoStep(s, 'q25');
    if (pct >= 50) videoStep(s, 'q50');
    if (pct >= 75) videoStep(s, 'q75');
    if (pct >= 97) videoStep(s, 'done');
  }
  if (s.secs >= 300) flushWatch(s);
}
function greet(s) {
  if (!s.api || s.heard || s.tries >= 12 || s.el.isConnected === false) return;
  s.tries++;
  try {
    const w = s.el.contentWindow;
    if (w) {
      if (s.api === 'yt') {
        w.postMessage(JSON.stringify({ event: 'listening', id: s.n, channel: 'widget' }), s.origin);
        w.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: s.n, channel: 'widget' }), s.origin);
      } else ['play', 'pause', 'ended', 'timeupdate'].forEach(v => w.postMessage(JSON.stringify({ method: 'addEventListener', value: v }), s.origin));
    }
  } catch (_) { /* not ready: the next try */ }
  const st = g('setTimeout');
  if (typeof st === 'function') st.call(root, () => greet(s), 1500);
}
function attachFrame(f) {
  const src = String((f.getAttribute && f.getAttribute('src')) || f.src || '');
  const had = players.get(f);
  if (had && had.src === src) return;
  if (had) flushWatch(had);
  const v = videoOf(src);
  if (!v) { players.delete(f); return; }
  let origin = '*';
  try { origin = new URL(src).origin; } catch (_) { /* '*' then */ }
  const s = { el: f, kind: 'frame', src, what: v.what, api: v.api, live: !!v.live, origin, n: ++playerSeq, base: videoBase(f),
              playing: false, lastT: null, secs: 0, steps: new Set(), heard: false, tries: 0 };
  players.set(f, s);
  videoStep(s, 'open');
  if (s.api) {
    if (f.addEventListener) f.addEventListener('load', () => { s.tries = 0; s.heard = false; greet(s); });
    greet(s);
  }
}
/* a <video> of the site's own (game clips): only a player somebody can use, with controls on the page */
function fileVideo(v) {
  if (players.has(v)) return players.get(v);
  if (!v.controls || !(v.offsetWidth > 40)) return null;
  const tag = v.closest ? v.closest('[data-video]') : null;
  let ref = keyOf(tag && tag.dataset && tag.dataset.video);
  if (!ref) { try { ref = (new URL(String(v.currentSrc || v.src || ''), 'https://x/').pathname.split('/').pop() || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64); } catch (_) { ref = ''; } }
  if (!ref || /^blob/.test(String(v.currentSrc || v.src || ''))) ref = 'clip';
  const s = { el: v, kind: 'file', src: '', what: 'file:' + ref, api: 'media', live: false, base: videoBase(v),
              playing: false, lastT: null, secs: 0, steps: new Set(), heard: true, tries: 0 };
  players.set(v, s);
  videoStep(s, 'open');
  return s;
}
function onMedia(e) {
  const v = e && e.target;
  if (!v || v.tagName !== 'VIDEO') return;
  const page = curBase && curBase.page;
  if (!page || NO_VIDEO_PAGES.test(page)) return;
  const s = fileVideo(v);
  if (!s) return;
  if (e.type === 'play' || e.type === 'playing') playState(s, true);
  else if (e.type === 'pause') playState(s, false);
  else if (e.type === 'ended') { playState(s, false); videoStep(s, 'done'); }
  else if (e.type === 'timeupdate') progress(s, v.currentTime, v.duration);
}
function onMessage(e) {
  if (!e || !/^https:\/\/(www\.)?(youtube(-nocookie)?\.com|player\.vimeo\.com)$/.test(String(e.origin || ''))) return;
  let s = null;
  for (const x of players.values()) if (x.kind === 'frame' && x.el.contentWindow === e.source) { s = x; break; }
  if (!s) return;
  let d = e.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
  if (!d || typeof d !== 'object') return;
  s.heard = true;
  if (s.api === 'yt') {
    const info = d.info;
    if (d.event === 'onStateChange' && typeof info === 'number') ytState(s, info);
    else if ((d.event === 'infoDelivery' || d.event === 'initialDelivery') && info && typeof info === 'object') {
      if (typeof info.playerState === 'number') ytState(s, info.playerState);
      if (typeof info.currentTime === 'number') progress(s, info.currentTime, Number(info.duration));
    }
  } else if (s.api === 'vimeo') {
    if (d.event === 'ready') { s.heard = false; s.tries = 0; greet(s); }
    else if (d.event === 'play') playState(s, true);
    else if (d.event === 'pause') playState(s, false);
    else if (d.event === 'ended') { playState(s, false); videoStep(s, 'done'); }
    else if (d.event === 'timeupdate' && d.data) progress(s, Number(d.data.seconds), Number(d.data.duration));
  }
}
function ytState(s, st) {
  if (st === 1) playState(s, true);
  else if (st === 0) { playState(s, false); videoStep(s, 'done'); }
  else if (st === 2 || st === -1 || st === 5) playState(s, false);
}
/* the players on the page now: a cheap look on the timer and just after a click, rather than watching every change */
function scanPlayers() {
  const page = curBase && curBase.page;
  for (const [el, s] of players) if (el.isConnected === false) { flushWatch(s); players.delete(el); }
  if (!page || NO_VIDEO_PAGES.test(page)) return;
  const d = g('document');
  const frames = d && d.getElementsByTagName ? d.getElementsByTagName('iframe') : [];
  for (let i = 0; i < frames.length; i++) attachFrame(frames[i]);
}

/* ---- a widget of ours on another site: seen, and where ---- */
function embedSeen(page) {
  let host = null;
  try {
    const loc = g('location') || {}, ao = loc.ancestorOrigins;
    const from = (ao && ao.length) ? ao[0] : String((g('document') || {}).referrer || '');
    if (from) host = new URL(from).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) { host = null; }
  if (host && host === selfHost()) return;                    // the site's own gallery, previewing it
  curBase = baseFrom(page);
  actPush(Object.assign({ kind: 'embed', what: host && /^[a-z0-9.-]{1,80}$/.test(host) ? host : null }, curBase));
}

/* hidden or left: what is owed goes now, in one request each */
function leaving() {
  emitTime();
  if (speedSend) speedSend();
  players.forEach(flushWatch);
  flushActivity(true);
  flush(true);
}

/* A tab is recorded by its KEY, which is the same in every language: data-tab (the box
   score, the league page), data-p, data-key. A tab that has no key is not recorded. A link is a file saved or another
   site (above); any other control can name itself with data-track="<key>" and is counted as an action. */
function onClick(e) {
  noteInput();
  const target = e && e.target;
  if (!target || !target.closest) return;
  const a = target.closest('a[href]');
  const saved = a && a.getAttribute ? linkClicked(a) : false;
  const st = g('setTimeout');
  if (typeof st === 'function') st.call(root, scanPlayers, 800);    // a cover pressed becomes a player
  const t = target.closest('[data-tab],[data-p],[data-key]');
  const isTab = !!(t && t.dataset && (t.getAttribute('role') === 'tab' || t.hasAttribute('data-tab') ||
                /(^|\s)(ep-tab|tabbtn)(\s|$)/.test(t.className || '')));
  if (!isTab) {
    const tr = target.closest('[data-track]');
    if (tr && !(saved && tr === a) && tr.dataset) { const k = keyOf(tr.dataset.track); if (k) action(k); }
    return;
  }
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
  if (lg || UUID.test(gm)) lastActCtx = { league: lg, game: UUID.test(gm) ? gm.toLowerCase() : null, at: nowMs() };
  push({ kind: 'tab', page, tab: k, league: lg || c.league, team: c.team, player: c.player,
         game: UUID.test(gm) ? gm.toLowerCase() : c.game });
}
/* A VIEW THAT CHANGES WITHOUT A NEW PAGE (HOME's MAIN -> VIDEO): counted once, whether the page says so here or the
   address change was seen first */
function view() { countView(); }

function boot() {
  if (!enabled()) return;
  const page = here();
  if (!page) return;
  const doc = g('document'), w = g('addEventListener');
  const listen = (t, fn, o) => { if (doc && doc.addEventListener) doc.addEventListener(t, fn, o); };
  const onHide = () => { if (doc.visibilityState === 'hidden') leaving(); else noteInput(); };
  if (/^embed\//.test(page)) {
    embedSeen(page);
    if (!hooked) { hooked = true; listen('visibilitychange', onHide); if (typeof w === 'function') w.call(root, 'pagehide', leaving); }
    return;
  }
  if (STAFF.test(page)) return;
  countView(landingTags());
  if (hooked) return;
  hooked = true;
  listen('click', onClick, true);
  listen('visibilitychange', onHide);
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => listen(t, noteInput, { passive: true, capture: true }));
  listen('scroll', onScroll, { passive: true, capture: true });
  ['play', 'playing', 'pause', 'ended', 'timeupdate'].forEach(t => listen(t, onMedia, true));
  if (typeof w === 'function') {
    w.call(root, 'pagehide', leaving);
    w.call(root, 'message', onMessage);
    w.call(root, 'error', onError);
    w.call(root, 'unhandledrejection', onRejection);
  }
  hookHistory();
  hookSharing();
  measureSpeed();
  const si = g('setInterval');
  if (typeof si === 'function') tickTimer = si.call(root, tick, TICK_MS);
  scanPlayers();
}

/* the privacy page's switch */
function setCounting(on) {
  const ls = store('localStorage');
  try { if (on) ls.removeItem(OPT_OUT_KEY); else ls.setItem(OPT_OUT_KEY, '1'); } catch (_) { /* nothing stored */ }
  if (!on) { queue.length = 0; stopped = true; actQueue.length = 0; actStopped = true; }
}
function counting() { return !optedOut(); }

return {
  boot, flush, entity, setCounting, counting, search, piece, flushPieces, action, view, download, MINE_KEY,
  /* whether this browser counts at all (feedrank.js's click-through counts ask the same question) */
  enabled,
  _test: {
    env(e) { ENV = e || null; ENTITY = {}; sentOnce = false; queue.length = 0; stopped = false; searchStopped = false; session = null; ref = undefined; timer = null;
             pieceQueue.length = 0; seenOnce.clear(); pieceStopped = false; pieceTimer = null; pieceHooked = false;
             actQueue.length = 0; actStopped = false; curSig = null; curBase = null; unsent = 0; depthMax = 0; lastInput = 0; errs = 0;
             speedSend = null; hooked = false; lastActCtx = null; players.clear(); lcpCut = Infinity; },
    pageKey, here, context, signedIn, device, app, lang, referrerHost, optedOut, enabled, automated, staffSignedIn, onClick, queue,
    pieceQueue, openedFrom, mine,
    actQueue, flushActivity, tick, emitTime, leaving, countView, sameView, videoOf, attachFrame, onMessage, onMedia, players,
    onError, onRejection, linkClicked, fmtOf, copyKind, hookSharing, embedSeen, unsentSecs: () => unsent
  }
};
}));
