'use strict';
/* ============================================================================
   Visit counts — PERMANENTLY ANONYMOUS (migration 0173, the console's Analytics tab).

   What one page sends, and nothing else:
     page     where it is on the site ('game', 'l', 'stats/wowy', 'go' ...)
     league / team / game   the slugs or id already in its own address (?l= ?t= ?g=)
     tab      the key of a tab clicked on it (data-tab / data-p), never its words
     and, per visit: signed in yes/no, phone / tablet / desktop, the page's language,
     the app or the browser, and the SITE a visitor arrived from (host name only).

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
  const key = seg.toLowerCase().replace(/\/+$/, '').replace(/[^a-z0-9/-]/g, '');
  return (key || 'splash').slice(0, 40);
}

function context() {
  const loc = g('location') || {};
  const q = new URLSearchParams(String(loc.search || ''));
  const l = String(q.get('l') || '').toLowerCase();
  const t = String(q.get('t') || '').toLowerCase();
  const gm = String(q.get('g') || '');
  return {
    league: SLUG.test(l) ? l : null,
    team: SLUG.test(t) ? t : null,
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

function push(ev) {
  if (stopped || !enabled()) return;
  queue.push(ev);
  if (queue.length >= 50) { flush(false); return; }
  if (!timer) timer = g('setTimeout').call(root, () => { timer = null; flush(false); }, 4000);
}

let ref = undefined;
function flush(leaving) {
  if (timer) { g('clearTimeout').call(root, timer); timer = null; }
  if (stopped || !queue.length) return Promise.resolve(0);
  if (!enabled()) { queue.length = 0; return Promise.resolve(0); }     // e.g. whoami() has since said this is staff
  const events = queue.splice(0, 50);
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

/* A tab is recorded by its KEY, which is the same in every language: data-tab (the box
   score, the league page), data-p, data-key. A tab that has no key is not recorded. */
function onClick(e) {
  const t = e && e.target && e.target.closest ? e.target.closest('[data-tab],[data-p],[data-key]') : null;
  if (!t || !t.dataset) return;
  const isTab = t.getAttribute('role') === 'tab' || t.hasAttribute('data-tab') ||
                /(^|\s)(ep-tab|tabbtn)(\s|$)/.test(t.className || '');
  if (!isTab) return;
  const key = String(t.dataset.tab || t.dataset.p || t.dataset.key || '').toLowerCase();
  const page = pageKey((g('location') || {}).pathname);
  if (!page || STAFF.test(page) || !TAB.test(key)) return;
  const c = context();
  push({ kind: 'tab', page, tab: key, league: c.league, team: c.team, game: c.game });
}

function boot() {
  if (!enabled()) return;
  const page = pageKey((g('location') || {}).pathname);
  if (!page || STAFF.test(page)) return;
  const c = context();
  push({ kind: 'view', page, league: c.league, team: c.team, game: c.game });
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
  boot, flush, setCounting, counting, search,
  _test: {
    env(e) { ENV = e || null; queue.length = 0; stopped = false; searchStopped = false; session = null; ref = undefined; timer = null; },
    pageKey, context, signedIn, device, app, lang, referrerHost, optedOut, enabled, automated, staffSignedIn, onClick, queue
  }
};
}));
