'use strict';
/* ============================================================================
   ACCESS — what this viewer may see, as the database says, for every page that
   draws something a membership pays for.            window.EpinoiaAccess

   The contract is docs/memberships.md §6. This file is the browser half of it:
   one question asked once per league per page (the access_state RPC), and a
   handful of synchronous answers the page can ask on every redraw.

   TWO KINDS OF ENFORCEMENT, AND THIS FILE ONLY DRAWS ONE OF THEM.
   A members-only league is refused by row-level security; nothing here can let
   anybody past it, and nothing here needs to. Premium analytics are computed in
   the browser from rows the free box score needs, so for those the page itself
   draws a teaser instead of the analysis. That is why the rules differ:

     analyticsOk(league)  FAILS OPEN. If the check cannot be made — the
                          migration is not applied, the network dropped, the
                          token was refused, four seconds went by — the
                          analytics are shown. Hiding them on an error protects
                          nothing (the numbers are one rebuild away from the
                          free play-by-play) and breaks the page for members.
     canView(league)      is false ONLY on a known answer. The paywall card is
                          drawn when the server has said can_view = false, never
                          on a guess; the database refuses the rows either way,
                          so a wrong "true" costs an empty table, while a wrong
                          "false" would lock a member out of a league they pay for.

   THE MASTER SWITCH. access_state says whether memberships are switched on for
   the platform at all (memberships_enabled; they ship off). While they are off
   the database gates nothing, so a known state with membershipsEnabled false
   answers canView and analyticsOk TRUE whatever else it carries — accessMode
   still names the league's stored mode, for a page that wants to say what will
   apply. An older payload without the key is taken as switched on: its own
   can_view and analytics_ok already said what applied. The simulation below
   still works while the switch is off, so an admin can preview the gating
   before switching it on.

   WHO IS SIGNED IN is read the way nav.js reads it — the SDK's own stored
   session, sb-<project-ref>-auth-token, with an expired token treated as signed
   out — because the pages that need this mostly do not load the 200kB SDK.

   AN EXPIRED TOKEN IS REFRESHED BEFORE IT IS BELIEVED. An access token lives an
   hour, and on a page without the SDK nothing renews it, so a member who opens a
   bookmarked league page the next morning — or comes back to a tab after lunch —
   would be asked about as a stranger and drawn the paywall. So load() and the
   auth-change check first trade the stored refresh token for a new session,
   inside the same four-second deadline: through the SDK's own getSession() where
   the page already carries the SDK, otherwise with one POST to
   /auth/v1/token?grant_type=refresh_token, written back to the same key in the
   shape supabase-js itself stores (expires_at included — the SDK throws away a
   stored session without one). A short localStorage lock keeps two tabs from
   spending the same refresh token at once, and the write is compare-and-set, so
   a sign-out in another tab is never overwritten by a refresh that finished
   after it. A refresh that fails leaves the stored session exactly as it was.

   CACHING. One access_state call per league per page (load() is idempotent and
   concurrent calls share one request), plus sessionStorage for 60 seconds keyed
   by user and league, so walking from a league page to a player page to a game
   does not ask three times. The cache is a convenience, not a secret: editing
   it only changes what this browser draws, which it could already do.
   The state is re-read when the account changes (the storage event from another
   tab, epinoia:auth from epinoiaSignOut in this one, the SDK's own auth events
   on a page that carries it, or coming back to the tab with a different token),
   and a tab coming back after more than 60 seconds quietly refreshes what it
   holds, so joining in another tab reaches this one without a reload. onChange
   listeners fire only when an answer actually moved — and a quiet refresh that
   FAILS changes nothing: a known answer is kept and asked for again later,
   because a dropped connection is not news about anybody's membership.

   SIMULATION, for admins previewing and for testing. localStorage key
   'epinoia_access_sim':
     'locked'  analyticsOk() is false everywhere (every league, no league, and
               leagues never loaded); canView() is false only for a league whose
               KNOWN accessMode is 'members' — an open league stays visible,
               because that is what a non-member would actually get.
     'member'  analyticsOk() and canView() are both true everywhere.
     anything else, or nothing: the server's answer.
   Client-side only. It changes what the page draws, never what the server
   returns: authHeaders() ignores it, and a simulated member still gets no rows
   from a members-only league the database refuses them.
   Set it from the console:  localStorage.epinoia_access_sim = 'locked'

   THE API (§6), plus a few additions marked +:
     FEATURES, CATALOGUE
     load({leagueId | leagueSlug, force+})  -> Promise<state>   never rejects
     + loadMany({leagueIds, force})  -> Promise<Map<id, state>>, one request for up to 50
     get(league) analyticsOk(league) canView(league)   league = id (or a loaded slug)
     isPremiumColumn(key)  teaserHTML(o)  paywallHTML(o)  joinHref(o)
     authHeaders(league?)  onChange(fn) -> unsubscribe
     + session()        {token, userId, email, exp} or null
     + sessionReady()   -> Promise<session()>, after refreshing an expired token
     + fromPayload(p, leagueId)   the pure access_state -> state mapping
     + signinHref(next) + priceText(pennies, currency, interval)
     + safePath(next)   the ?next= rule: a same-origin /epinoia/ path, or ''
     + forget()         drop every cached answer (the join page, after a purchase)

   UMD so node can require() it for supabase/tests/access.test.mjs. Under node
   there is no window and no document: nothing listens and nothing is fetched
   (load() resolves the fail-open state) unless a test hands in a transport.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAccess = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const SIM_KEY = 'epinoia_access_sim';
const CACHE_PREFIX = 'epinoia_access:';          // + user + ':' + league id
const SLUG_PREFIX = 'epinoia_access_slug:';      // + slug -> {id, slug, name}
const MISSING_KEY = 'epinoia_access_missing';
const TTL_MS = 60 * 1000;
/* A 404 from the RPC means the migration is not applied yet. Asking again on
   every page for the next five minutes would be a wasted request per page view
   for a question with a known answer, so the absence is remembered briefly. */
const MISSING_MS = 5 * 60 * 1000;
let DEADLINE_MS = 4000;

/* ------------------------------------------------------------- catalogue --- */
/* What is sold, in words a fan reads on the join page and in the teasers. The
   keys are the feature keys the database compares against and nothing else. */
const FEATURES = Object.freeze({
  analytics: Object.freeze({
    label: 'Advanced analytics',
    blurb: 'The analysis behind the box score: where the points came from, where the shots were taken, and who plays well together.',
    includes: Object.freeze([
      'Second chances, transition, points off turnovers, after timeouts, and assisted against unassisted baskets, on every screen',
      'Shot charts by zone, with zone tables and the shooting each shot diet should return',
      'The game flow, connections and events tabs of every box score',
      'The full with-or-without screen, every combination of players (everyone gets a preview)'
    ])
  }),
  league: Object.freeze({
    label: 'Members-only league',
    blurb: 'A league that keeps its games for its members: results, box scores, live games, statistics, standings, awards, news and video.',
    includes: Object.freeze([
      'Results, box scores and live games',
      'Season statistics, standings, brackets and awards',
      'News, match reports and video'
    ])
  })
});

/* THE ONE PLACE TO MOVE THINGS BETWEEN TIERS. Every page asks this rather than
   keeping its own list, so moving a column or a tab is a one-line change here.

   presets is the full-table preset ids whose columns are wholly premium, read
   off fulltable.js: the six events presets and the five zone presets. "Wholly"
   ignores the id columns and the context columns — gp rides along with every
   preset so a reader can see how many games a row covers, and it is free
   everywhere else. The test (access.test.mjs) recomputes this list from
   fulltable.js, so it cannot drift silently. */
const CATALOGUE = Object.freeze({
  gameTabs: Object.freeze(['flow', 'connections', 'events']),
  columnPrefixes: Object.freeze(['ev_', 'evd_', 'z_']),
  columns: Object.freeze(['pred_efg', 'efg_sh', 'efg_vs', 'morey']),
  presets: Object.freeze(['ev_second', 'ev_transition', 'ev_offTo', 'ev_ato', 'ev_half', 'ev_assist',
                          'z_rim', 'z_mid', 'z_three', 'z_cuts', 'z_rate']),
  contextColumns: Object.freeze(['gp']),
  barKeys: key => /^ev_/.test(String(key == null ? '' : key)),
  wowyPreviewMax: 1
});

function isPremiumColumn(key) {
  const k = String(key == null ? '' : key);
  if (!k) return false;
  return CATALOGUE.columnPrefixes.some(p => k.indexOf(p) === 0) || CATALOGUE.columns.indexOf(k) !== -1;
}

/* -------------------------------------------------------------- plumbing --- */
const cfg = () => root.EPINOIA_CONFIG || {};
let transport = null;
/* the network, only in a browser (or when a test supplies one) */
const net = () => transport || (BROWSER && typeof root.fetch === 'function' ? root.fetch.bind(root) : null);

function store(kind) { try { return root[kind] || null; } catch (_) { return null; } }
function sget(kind, k) { try { const s = store(kind); return s ? s.getItem(k) : null; } catch (_) { return null; } }
function sset(kind, k, v) { try { const s = store(kind); if (s) s.setItem(k, v); } catch (_) { /* full or blocked */ } }
function sdel(kind, k) { try { const s = store(kind); if (s) s.removeItem(k); } catch (_) { /* blocked */ } }

const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Where the platform's pages live, read off this script's own URL at load, so a
   link to join/ or signin/ is right from a page three folders deep. A deferred
   classic script still has document.currentScript while it runs. */
const ROOT_PATH = (function () {
  try {
    const s = typeof document !== 'undefined' ? document.currentScript : null;
    if (s && s.src) {
      const p = new URL(s.src, root.location ? root.location.href : undefined).pathname;
      const dir = p.replace(/[^/]*$/, '');
      if (dir.charAt(0) === '/') return dir;
    }
  } catch (_) { /* fall through */ }
  return '/epinoia/';
}());

function here() {
  try { return root.location ? root.location.pathname + root.location.search : ''; } catch (_) { return ''; }
}
/* WHERE A ?next= MAY SEND SOMEBODY: a path on this site, under /epinoia/, and
   nothing else. An open redirect on a sign-in or payment page is how phishing
   borrows a real domain, and "starts with one slash" was not enough — browsers
   strip tabs and newlines out of a URL and read a backslash as a slash, so
   '/%09/evil.com' once decoded, '/\evil.com' and '/epinoia/..//evil.com' all
   leave the site. So: no control characters or spaces, no backslash (raw or
   %5c), no '//' anywhere, and then the browser's own parser has the last word —
   resolved against this origin it must still be this origin, under /epinoia/.
   The same rule, character for character, is safeNext in join.js and
   signin.js; access.test.mjs runs the same attack strings through all three. */
function safePath(n) {
  const s = String(n == null ? '' : n);
  if (s.indexOf('/epinoia/') !== 0) return '';
  if (/[\x00-\x20\x7f\\]|%5c|\/\//i.test(s)) return '';
  let origin = 'https://epinoia.invalid';          // under node, for the tests
  try { if (root.location && /^https?:/.test(root.location.origin)) origin = root.location.origin; } catch (_) { /* keep it */ }
  try {
    const u = new URL(s, origin);
    if (u.origin !== origin || u.pathname.indexOf('/epinoia/') !== 0) return '';
  } catch (_) { return ''; }
  return s;
}

/* --------------------------------------------------------------- session --- */
function projectRef() {
  const m = String(cfg().supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
  return m ? m[1] : null;
}
const tokenKey = () => { const ref = projectRef(); return ref ? 'sb-' + ref + '-auth-token' : null; };
function jwtSub(tok) {
  try {
    const part = String(tok).split('.')[1];
    if (!part || typeof atob !== 'function') return '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return (JSON.parse(json) || {}).sub || '';
  } catch (_) { return ''; }
}
function parseSession(raw) {
  let j;
  try { j = JSON.parse(raw); } catch (_) { return null; }
  const cs = j && j.currentSession;
  const tok = j && (j.access_token || (cs && cs.access_token));
  if (!tok) return null;
  const exp = Number(j.expires_at || (cs && cs.expires_at)) || 0;
  const user = j.user || (cs && cs.user) || {};
  const refresh = j.refresh_token || (cs && cs.refresh_token) || '';
  return { token: String(tok), userId: user.id || jwtSub(tok), email: user.email || '', exp, refresh: String(refresh) };
}
/* parsed once per distinct stored value: analyticsOk() can be asked on every
   redraw of a live game, and a JSON.parse per play is waste for no change.
   stored() is the whole thing, expired or not and refresh token included; it
   never leaves this file. session() is what a page may have. */
let memoRaw = null, memoSess = null;
function stored() {
  const key = tokenKey();
  if (!key) return null;
  const raw = sget('localStorage', key);
  if (!raw) { memoRaw = null; memoSess = null; return null; }
  if (raw !== memoRaw) { memoRaw = raw; memoSess = parseSession(raw); }
  return memoSess;
}
const expired = (s, now) => !!(s && s.exp && s.exp * 1000 < now);
function session() {
  const s = stored();
  /* an expired token is not a session — every request with it would 401 */
  if (!s || expired(s, Date.now())) return null;
  return { token: s.token, userId: s.userId, email: s.email, exp: s.exp };
}
const userKey = () => { const s = session(); return s ? (s.userId || 'user') : 'anon'; };

/* ------------------------------------------------------- session refresh --- */
/* What to do about the stored session, in one word. Pure, so the test pins it.
     'none'     nobody is signed in, or what is stored cannot be refreshed (no
                refresh token, one the server already refused on this page, or
                the last attempt got no answer under thirty seconds ago)
     'valid'    the access token is good for more than REFRESH_MARGIN_MS
     'refresh'  it has run out, or is about to, and there is a refresh token
   The margin is ten seconds, not the SDK's ninety: a tab running the SDK renews
   its token a minute and a half early, so by the time this file would act, no
   SDK tab that is awake is about to spend the same refresh token. */
const REFRESH_MARGIN_MS = 10 * 1000;
const LOCK_KEY = 'epinoia_auth_refresh_lock';
const LOCK_MS = 10 * 1000;       // a lock older than this belongs to a tab that died mid-refresh
const LOCK_POLL_MS = 150;
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
let deadRefresh = '';            // a refresh token the server refused: not tried again on this page
let refreshing = null;           // the one refresh in flight in this tab
/* After a refresh that got no answer (offline, a timeout, a 5xx), the next
   thirty seconds do not try again: every load() on the page would otherwise
   spend its whole deadline waiting on the same unreachable server. */
const REFRESH_BACKOFF_MS = 30 * 1000;
let refreshQuietUntil = 0;

function refreshPlan(s, now) {
  if (!s) return 'none';
  if (!s.exp || s.exp * 1000 - REFRESH_MARGIN_MS > now) return 'valid';
  return s.refresh && s.refresh !== deadRefresh && now >= refreshQuietUntil ? 'refresh' : 'none';
}

const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

/* A lock in localStorage, because it is the one thing every tab of this origin
   shares synchronously. Written, then read back: if another tab wrote in the
   same instant, the read shows whose write landed last, and only that tab
   refreshes. If the write itself is refused (storage full) and nobody holds the
   lock, go ahead without one — two refreshes are better than none. */
function readLock() {
  try { return JSON.parse(sget('localStorage', LOCK_KEY) || 'null'); } catch (_) { return null; }
}
function takeLock(now) {
  const held = readLock();
  if (held && held.id !== TAB_ID && now - Number(held.at) < LOCK_MS) return false;
  sset('localStorage', LOCK_KEY, JSON.stringify({ id: TAB_ID, at: now }));
  const back = readLock();
  return !back || back.id === TAB_ID;
}
function releaseLock() {
  const held = readLock();
  if (held && held.id === TAB_ID) sdel('localStorage', LOCK_KEY);
}

/* The refreshed session, written where supabase-js keeps it and in the shape it
   keeps it: the token endpoint's answer as it came, plus expires_at when the
   answer left it off (the SDK computes it the same way, and discards a stored
   session that has none). Compare-and-set on the refresh token this refresh
   spent: if the stored value moved meanwhile — signed out in another tab, or
   refreshed by one — what is there is newer than this answer, and writing over a
   sign-out would sign somebody back in. */
function writeBack(used, body) {
  const key = tokenKey();
  const cur = stored();
  if (!key || !cur || cur.refresh !== used) return false;
  let prev = null;
  try { prev = JSON.parse(sget('localStorage', key)); } catch (_) { prev = null; }
  const next = Object.assign({}, body);
  if (!next.expires_at && next.expires_in) next.expires_at = Math.round(Date.now() / 1000) + Number(next.expires_in);
  if (!next.user && prev) next.user = prev.user || (prev.currentSession && prev.currentSession.user) || undefined;
  sset('localStorage', key, JSON.stringify(next));
  return true;
}

async function refreshNow(until) {
  /* A page that already carries the SDK lets the SDK do it: getSession()
     refreshes an expired session under the SDK's own cross-tab lock and saves
     it itself, and two writers of one key is how a session gets clobbered. The
     SDK is never fetched for this — only used when the page loaded it anyway. */
  if (root.supabase && typeof root.epinoiaClientReady === 'function') {
    try {
      const client = await timed(until - Date.now(), () => root.epinoiaClientReady());
      if (client && client !== TIMED_OUT && client.auth && typeof client.auth.getSession === 'function') {
        watchSdk(client);
        await timed(until - Date.now(), () => client.auth.getSession());
      }
    } catch (_) { /* whatever is stored now is the answer */ }
    return session();
  }

  const f = net(), c = cfg();
  if (!f || !c.supabaseUrl || !c.supabaseAnonKey) return session();
  /* Wait for the lock. Whoever holds it is refreshing this same session, so
     every turn first looks at storage: once the other tab has written, there is
     nothing left to do here. */
  for (;;) {
    const now = Date.now();
    if (refreshPlan(stored(), now) !== 'refresh') return session();
    if (now >= until) return session();
    if (takeLock(now)) break;
    await sleep(Math.min(LOCK_POLL_MS, until - now));
  }
  try {
    const cur = stored();
    if (refreshPlan(cur, Date.now()) !== 'refresh') return session();
    const used = cur.refresh;
    const out = await timed(until - Date.now(), signal =>
      f(c.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', cache: 'no-store', signal,
        headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh_token: used })
      }).then(async r => {
        let body = null;
        try { body = r ? await r.json() : null; } catch (_) { body = null; }
        return { ok: !!(r && r.ok), status: r ? r.status : 0, body };
      }));
    if (out === TIMED_OUT) { refreshQuietUntil = Date.now() + REFRESH_BACKOFF_MS; return session(); }
    const b = out.body;
    if (out.ok && b && typeof b === 'object' && b.access_token && b.refresh_token) {
      writeBack(used, b);
    } else if (out.status === 400 || out.status === 401) {
      /* refused (revoked, or already spent by a tab outside the lock). Storage
         is left alone — if another tab wrote a newer session it has a different
         refresh token and is tried on its own merits — but this one is not
         offered to the server again from this page. */
      deadRefresh = used;
    } else {
      refreshQuietUntil = Date.now() + REFRESH_BACKOFF_MS;
    }
    return session();
  } catch (_) {
    refreshQuietUntil = Date.now() + REFRESH_BACKOFF_MS;   // offline: try again in a while
    return session();
  } finally {
    releaseLock();
  }
}

/* The session as it is after an expired token has been refreshed (or could not
   be). Resolves at once when nothing needs doing; never rejects; one refresh per
   tab at a time, shared by every caller. */
function ensureSession(until) {
  try {
    if (refreshPlan(stored(), Date.now()) !== 'refresh') return Promise.resolve(session());
    if (!refreshing) {
      const p = refreshNow(until || Date.now() + DEADLINE_MS)
        .catch(() => null)
        .then(v => { if (refreshing === p) refreshing = null; return session() || v; });
      refreshing = p;
    }
    return refreshing;
  } catch (_) {
    return Promise.resolve(session());
  }
}
const sessionReady = () => ensureSession(Date.now() + DEADLINE_MS);

/* On a page with the SDK, hear its own sign-ins and refreshes in this tab —
   they write storage, and a tab never gets a storage event for its own writes.
   Deferred with a timeout because the SDK calls listeners while it holds its
   lock, and anything that asked the SDK from inside would wait on itself. */
let sdkWatched = null;
function watchSdk(client) {
  if (!BROWSER || !client || sdkWatched === client || !client.auth ||
      typeof client.auth.onAuthStateChange !== 'function') return;
  sdkWatched = client;
  try {
    client.auth.onAuthStateChange(event => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setTimeout(() => { checkAuth(); }, 0);
      }
    });
  } catch (_) { /* an SDK without it: the storage and visibility checks remain */ }
}

function sim() {
  const v = sget('localStorage', SIM_KEY);
  return v === 'locked' || v === 'member' ? v : '';
}

/* ----------------------------------------------------------------- state --- */
/* One shape, keys always in this order, so two states compare as strings.
   Memberships switched off opens everything here, once, so a state read back
   from the cache answers the same as the one the server sent. */
function shape(x) {
  const enabled = x.membershipsEnabled !== false;
  return {
    known: !!x.known,
    signedIn: !!x.signedIn,
    leagueId: x.leagueId || null,
    slug: x.slug || '',
    name: x.name || '',
    accessMode: x.accessMode === 'members' ? 'members' : 'open',
    fixturesPublic: x.fixturesPublic !== false,
    analytics: x.analytics === 'members' ? 'members' : 'free',
    features: Array.isArray(x.features) ? x.features.filter(f => typeof f === 'string') : [],
    canView: !enabled || x.canView !== false,
    analyticsOk: !enabled || x.analyticsOk !== false,
    hasPlans: !!x.hasPlans,
    hasLeaguePlans: !!x.hasLeaguePlans,
    subscriptions: Math.max(0, parseInt(x.subscriptions, 10) || 0),
    analyticsDefault: x.analyticsDefault === 'members' ? 'members' : 'free',
    membershipsEnabled: enabled
  };
}
function failOpen(extra) {
  return shape(Object.assign({ known: false, signedIn: !!session() }, extra || {}));
}

/* The access_state payload (§4.3) as the page's state for one league. Pure.
   The server's can_view and analytics_ok are the answer; they are only worked
   out here if an older payload left them off.

   hasPlans is "anything on sale applies here", Epinoia's analytics plans
   included — right for an analytics teaser. hasLeaguePlans is "this league sells
   its own way in", which is what a members-only paywall needs: an analytics plan
   does not open a closed league, so offering it there sells the wrong thing.
   Missing from an older payload it reads true, the unknown-shows-the-link rule. */
function fromPayload(payload, leagueId) {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  if (!p) return failOpen({ leagueId: leagueId || null });
  const base = {
    signedIn: !!p.signed_in,
    subscriptions: p.subscriptions,
    analyticsDefault: p.analytics_default,
    /* the master switch; left off by an older payload, it reads as on and the
       payload's own answers stand */
    membershipsEnabled: typeof p.memberships_enabled === 'boolean' ? p.memberships_enabled : true
  };
  /* no league asked about: what is known is who you are and what you hold, and
     the top-level analytics_ok — the answer for a game or a player that belongs
     to no league, which follows the platform default and platform plans. Left
     off by an older payload, it fails open like everything else. */
  if (!leagueId) {
    return shape(Object.assign({
      known: true, analytics: p.analytics_default,
      analyticsOk: typeof p.analytics_ok === 'boolean' ? p.analytics_ok : true
    }, base));
  }
  const e = (Array.isArray(p.leagues) ? p.leagues : []).find(x => x && x.id === leagueId);
  if (!e) return shape(Object.assign({ known: false, leagueId }, base));
  const features = (Array.isArray(e.features) ? e.features : []).filter(f => typeof f === 'string');
  const accessMode = e.access_mode === 'members' ? 'members' : 'open';
  const analytics = e.analytics === 'members' ? 'members' : 'free';
  return shape(Object.assign({}, base, {
    known: true,
    leagueId: e.id, slug: e.slug, name: e.name,
    accessMode,
    fixturesPublic: e.fixtures_public !== false,
    analytics,
    features,
    canView: typeof e.can_view === 'boolean' ? e.can_view
      : (accessMode === 'open' || features.indexOf('league') !== -1),
    analyticsOk: typeof e.analytics_ok === 'boolean' ? e.analytics_ok
      : (analytics === 'free' || features.indexOf('analytics') !== -1),
    hasPlans: !!e.has_plans,
    hasLeaguePlans: typeof e.has_league_plans === 'boolean' ? e.has_league_plans : true
  }));
}

const states = new Map();       // league id ('' = no league) -> {user, at, st}
const slugs = new Map();        // slug -> {id, slug, name}
const inflight = new Map();     // user|league -> Promise
const slugInflight = new Map(); // slug -> Promise
const listeners = new Set();

function idFor(league) {
  const k = league == null ? '' : String(league);
  if (states.has(k)) return k;
  const s = slugs.get(k);
  return s ? s.id : k;
}
/* the server's answer for this league — only if it was given to the account
   that is signed in NOW; a state loaded for somebody else is no answer at all */
function raw(league) {
  const e = states.get(idFor(league));
  if (!e || e.user !== userKey()) return null;
  return e.st;
}
function slugMeta(id) {
  for (const v of slugs.values()) if (v.id === id) return v;
  return null;
}

/* The simulation first, so it previews the gating even while memberships are
   switched off; then a known "switched off", which opens everything. */
function analyticsOk(league) {
  const m = sim();
  if (m === 'locked') return false;
  if (m === 'member') return true;
  const st = raw(league);
  if (st && st.known && st.membershipsEnabled === false) return true;
  return !(st && st.known && st.analyticsOk === false);
}
function canView(league) {
  const m = sim();
  if (m === 'member') return true;
  const st = raw(league);
  if (m === 'locked') return !(st && st.known && st.accessMode === 'members');
  if (st && st.known && st.membershipsEnabled === false) return true;
  return !(st && st.known && st.canView === false);
}
function get(league) {
  const id = idFor(league) || null;
  const st = raw(league) || failOpen({ leagueId: id });
  const out = shape(st);
  if (!out.slug || !out.name) {
    const m = id ? slugMeta(id) : null;
    if (m) { out.slug = out.slug || m.slug || ''; out.name = out.name || m.name || ''; }
  }
  const s = sim();
  if (s) {
    out.simulated = s;
    out.analyticsOk = analyticsOk(league);
    out.canView = canView(league);
  }
  return out;
}

function emit(detail) {
  listeners.forEach(fn => { try { fn(detail); } catch (e) { if (root.console) console.warn('[access] listener', e); } });
  if (BROWSER) {
    try { window.dispatchEvent(new CustomEvent('epinoia:access', { detail })); } catch (_) { /* old browser */ }
  }
}
function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readCache(uk, key) {
  const raw = sget('sessionStorage', CACHE_PREFIX + uk + ':' + (key || '-'));
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j || !j.st || !j.st.known || !(Date.now() - j.at < TTL_MS)) return null;
    return { at: j.at, st: shape(j.st) };
  } catch (_) { return null; }
}
function writeCache(uk, key, st) {
  sset('sessionStorage', CACHE_PREFIX + uk + ':' + (key || '-'), JSON.stringify({ at: Date.now(), st }));
}

function put(key, st, uk, at) {
  const before = JSON.stringify(get(key));
  states.set(key, { user: uk, at: at || Date.now(), st });
  if (st.slug && key) slugs.set(st.slug, { id: key, slug: st.slug, name: st.name });
  /* only a real answer is worth carrying to the next page; a failure is kept in
     memory for this page and tried again after the TTL */
  if (st.known && !at) writeCache(uk, key, st);
  if (JSON.stringify(get(key)) !== before) emit({ reason: 'load', leagueId: key || null });
}

/* ------------------------------------------------------------- network --- */
const TIMED_OUT = { timedOut: true };
function timed(ms, run) {
  let timer = null, ctl = null;
  try { ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; } catch (_) { ctl = null; }
  const late = new Promise(resolve => {
    timer = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (_) {} resolve(TIMED_OUT); }, Math.max(0, ms));
  });
  return Promise.race([Promise.resolve().then(() => run(ctl ? ctl.signal : undefined)), late])
    .then(v => { clearTimeout(timer); return v; }, e => { clearTimeout(timer); throw e; });
}

function missingRecently() {
  const t = Number(sget('sessionStorage', MISSING_KEY)) || 0;
  return t > 0 && Date.now() - t < MISSING_MS;
}

async function resolveSlug(slug, until) {
  const had = slugs.get(slug);
  if (had) return had.id;
  try {
    const j = JSON.parse(sget('sessionStorage', SLUG_PREFIX + slug) || 'null');
    if (j && j.id) { slugs.set(slug, { id: j.id, slug: j.slug || slug, name: j.name || '' }); return j.id; }
  } catch (_) { /* re-read it */ }
  const f = net(), c = cfg();
  if (!f || !c.supabaseUrl || !c.supabaseAnonKey) return null;
  try {
    /* the league row is public even for a members-only league — the shop window
       stays open — so this is an anonymous read with the anon key alone */
    const out = await timed(until - Date.now(), signal =>
      f(c.supabaseUrl + '/rest/v1/leagues?slug=eq.' + encodeURIComponent(slug) + '&select=id,slug,name', {
        cache: 'no-store', signal,
        headers: { apikey: c.supabaseAnonKey, Accept: 'application/json' }
      }).then(r => (r && r.ok ? r.json() : null)));
    const row = out !== TIMED_OUT && Array.isArray(out) ? out[0] : null;
    if (!row || !row.id) return null;
    const meta = { id: row.id, slug: row.slug || slug, name: row.name || '' };
    slugs.set(slug, meta);
    sset('sessionStorage', SLUG_PREFIX + slug, JSON.stringify(meta));
    return row.id;
  } catch (_) { return null; }
}

async function fetchState(key, until) {
  const body = await askServer(key ? [key] : null, until);
  return body ? fromPayload(body, key || null) : failOpen({ leagueId: key || null });
}

/* The one access_state request, for no league (null) or a list of league ids. The
   payload, or null for every kind of "no answer" -- no network, the migration
   missing, a refusal, a 5xx, the deadline -- which the callers turn into the
   fail-open state. */
async function askServer(leagues, until) {
  const f = net(), c = cfg();
  if (!f || !c.supabaseUrl || !c.supabaseAnonKey) return null;
  if (missingRecently()) return null;
  const s = session();
  const headers = { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (s) headers.Authorization = 'Bearer ' + s.token;
  try {
    const out = await timed(until - Date.now(), signal =>
      f(c.supabaseUrl + '/rest/v1/rpc/access_state', {
        method: 'POST', cache: 'no-store', headers, signal,
        body: JSON.stringify({ p_leagues: leagues })
      }).then(async r => {
        if (r && r.ok) return { ok: true, body: await r.json() };
        let j = null;
        try { j = r ? await r.json() : null; } catch (_) { j = null; }
        return { ok: false, status: r ? r.status : 0, code: j && j.code };
      }));
    if (out === TIMED_OUT) return null;
    if (!out.ok) {
      /* PGRST202 / 404: the function is not there — the migration is not applied */
      if (out.status === 404 || out.code === 'PGRST202') sset('sessionStorage', MISSING_KEY, String(Date.now()));
      return null;                               // 401 and 5xx too: fail open
    }
    return out.body;
  } catch (_) { return null; }
}

function loadId(key, force, until) {
  const uk = userKey();
  if (!force) {
    const e = states.get(key);
    if (e && e.user === uk && (e.st.known || Date.now() - e.at < TTL_MS)) return Promise.resolve(get(key));
    const c = readCache(uk, key);
    if (c) { put(key, c.st, uk, c.at); return Promise.resolve(get(key)); }
  }
  const fk = uk + '|' + key;
  if (inflight.has(fk)) return inflight.get(fk);
  const p = fetchState(key, until || Date.now() + DEADLINE_MS)
    .then(st => settle(key, st, uk), () => {})
    .then(() => { if (inflight.get(fk) === p) inflight.delete(fk); return get(key); });
  inflight.set(fk, p);
  return p;
}

/* An answer arriving for one league, from load() or loadMany() alike. */
function settle(key, st, uk) {
  if (userKey() !== uk) return;
  /* A FAILED RE-ASK CHANGES NOTHING. The fail-open fallback stands in for
     an answer nobody has; put over a KNOWN one it would take a paywall
     down, or put analytics back, on a network blip, and tell every
     listener so. The known answer stays, and is asked for again later. */
  const had = states.get(key);
  if (!st.known && had && had.user === uk && had.st.known) { retryLater(); return; }
  put(key, st, uk);
}

/* ---------------------------------------------------------- many leagues ---
   A PAGE ABOUT EVERY LEAGUE (global scouting) needs every league's answer before
   it reads a row: which leagues this viewer may see, whether any locks the paid
   columns, and -- because authHeaders() only sends a member's token once a
   members-only league they may see is loaded -- whether its reads go out as the
   member at all. One load() per league would be one request per league; the RPC
   takes a list (access_state(p_leagues uuid[]), up to 50), so this asks once.

   Everything else is load()'s: the same four-second deadline across the token
   refresh and the request, the same per-league memory and 60-second
   sessionStorage cache (a league already answered is not asked again), a league
   already being asked about by load() is waited for rather than asked twice (and
   the reverse), a failed re-ask keeps a known answer, and it never rejects. A
   league the server leaves out of its answer comes back unknown, which fails
   open like any other missing answer. More than 50 ids go out as several
   requests of 50, together.

   loadMany({ leagueIds, force }) -> Promise<Map<leagueId, state>>, in the order
   asked, duplicates and blanks dropped; each state is get(leagueId). */
const MANY_MAX = 50;
function loadMany(opts) {
  try {
    const o = opts || {};
    const until = Date.now() + DEADLINE_MS;
    if (refreshPlan(stored(), Date.now()) === 'refresh') {
      return ensureSession(until).then(() => loadManyNow(o, until), () => loadManyNow(o, until));
    }
    return loadManyNow(o, until);
  } catch (_) {
    return Promise.resolve(new Map());
  }
}
function loadManyNow(o, until) {
  const ids = [];
  try {
    (Array.isArray(o.leagueIds) ? o.leagueIds : []).forEach(x => {
      const id = x == null ? '' : String(x);
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    const force = !!o.force, uk = userKey();
    const waits = new Map();
    const ask = [];
    ids.forEach(id => {
      if (!force) {
        const e = states.get(id);
        if (e && e.user === uk && (e.st.known || Date.now() - e.at < TTL_MS)) { waits.set(id, Promise.resolve(get(id))); return; }
        const c = readCache(uk, id);
        if (c) { put(id, c.st, uk, c.at); waits.set(id, Promise.resolve(get(id))); return; }
      }
      const fk = uk + '|' + id;
      if (inflight.has(fk)) { waits.set(id, inflight.get(fk)); return; }
      ask.push(id);
    });
    for (let i = 0; i < ask.length; i += MANY_MAX) {
      const chunk = ask.slice(i, i + MANY_MAX);
      const req = askServer(chunk, until).catch(() => null);
      chunk.forEach(id => {
        const fk = uk + '|' + id;
        const p = req
          .then(body => settle(id, body ? fromPayload(body, id) : failOpen({ leagueId: id }), uk), () => {})
          .then(() => { if (inflight.get(fk) === p) inflight.delete(fk); return get(id); });
        inflight.set(fk, p);
        waits.set(id, p);
      });
    }
    return Promise.all(ids.map(id => Promise.resolve(waits.get(id)).catch(() => get(id))))
      .then(list => new Map(ids.map((id, i) => [id, list[i]])), () => new Map(ids.map(id => [id, get(id)])));
  } catch (_) {
    return Promise.resolve(new Map(ids.map(id => [id, failOpen({ leagueId: id })])));
  }
}

/* One quiet retry a minute after a failed re-ask, while the tab is in view —
   so a tab that stays open and visible does not keep a stale answer until the
   next time somebody switches to it. */
let retryTimer = null;
function retryLater() {
  if (!BROWSER || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!document.hidden) refreshStale();
  }, TTL_MS);
}

/* Either id or slug. Idempotent per league; never rejects; four seconds at most
   across every request — a token refresh, the slug, the state — after which the
   page gets the fail-open state and draws. */
function load(opts) {
  try {
    const o = opts || {};
    const until = Date.now() + DEADLINE_MS;
    /* signed in with a token that has run out: renew it first, or the question
       is asked about a stranger and a member is drawn the paywall */
    if (refreshPlan(stored(), Date.now()) === 'refresh') {
      return ensureSession(until).then(() => loadNow(o, until), () => loadNow(o, until));
    }
    return loadNow(o, until);
  } catch (_) {
    return Promise.resolve(failOpen());
  }
}
function loadNow(o, until) {
  try {
    const force = !!o.force;
    if (o.leagueId) return loadId(String(o.leagueId), force, until);
    if (o.leagueSlug) {
      const slug = String(o.leagueSlug);
      const known = slugs.get(slug);
      if (known) return loadId(known.id, force, until);
      if (slugInflight.has(slug)) return slugInflight.get(slug);
      const p = resolveSlug(slug, until)
        .then(id => (id ? loadId(id, force, until) : failOpen({ slug })), () => failOpen({ slug }))
        .then(v => { slugInflight.delete(slug); return v; });
      slugInflight.set(slug, p);
      return p;
    }
    return loadId('', force, until);
  } catch (_) {
    return Promise.resolve(failOpen());
  }
}

/* Drop every cached answer, in memory and in this tab's sessionStorage. The join
   page calls it after a purchase so the page a member returns to asks again. */
function forget() {
  states.clear(); inflight.clear();
  const s = store('sessionStorage');
  if (s) {
    try {
      const ks = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.indexOf(CACHE_PREFIX) === 0) ks.push(k); }
      ks.forEach(k => s.removeItem(k));
    } catch (_) { /* blocked */ }
  }
  sdel('sessionStorage', MISSING_KEY);
}

/* ------------------------------------------------------------ auth header --- */
/* A token rides on the page's reads ONLY where it changes the answer: a
   members-only league this account may see. An open league's request stays
   exactly the anonymous request it always was, which keeps it cacheable and
   keeps a stale token from turning a public read into a 401. The simulation is
   ignored on purpose — this is about what the server will return.

   The master switch is ignored too, deliberately. While memberships are off a
   members-mode league is readable by anyone, so the token changes nothing — but
   the moment a platform admin switches them on, a page still holding the
   switched-off answer (for up to a minute) keeps sending a member's token, and
   the member does not see the league empty out before the page asks again. */
function authHeaders(league) {
  const s = session();
  if (!s || !s.token) return {};
  const uk = s.userId || 'user';
  const fits = e => !!(e && e.user === uk && e.st.known && e.st.accessMode === 'members' && e.st.canView === true);
  let hit = false;
  if (league != null && league !== '') hit = fits(states.get(idFor(league)));
  else states.forEach(e => { if (fits(e)) hit = true; });
  return hit ? { Authorization: 'Bearer ' + s.token } : {};
}

/* ----------------------------------------------------------------- links --- */
function joinHref(o) {
  const x = o || {};
  const q = [];
  if (x.leagueSlug) q.push('l=' + encodeURIComponent(String(x.leagueSlug)));
  const next = safePath(x.next != null ? x.next : here());
  if (next) q.push('next=' + encodeURIComponent(next));
  return ROOT_PATH + 'join/' + (q.length ? '?' + q.join('&') : '');
}
function signinHref(next) {
  const n = safePath(next != null ? next : here());
  return ROOT_PATH + 'signin/' + (n ? '?next=' + encodeURIComponent(n) : '');
}

/* £4.99 a month. Pennies, as merch stores them; the price a fan sees is the
   price they pay, VAT included, per CMA209 — the plan's price already is. */
const SYMBOL = { gbp: '£', eur: '€', usd: '$' };
function amountText(pennies, currency) {
  const n = Math.max(0, Number(pennies) || 0) / 100;
  const cur = String(currency || 'gbp').toLowerCase();
  return SYMBOL[cur] ? SYMBOL[cur] + n.toFixed(2) : cur.toUpperCase() + ' ' + n.toFixed(2);
}
function priceText(pennies, currency, interval) {
  return amountText(pennies, currency) + (interval === 'year' ? ' a year' : ' a month');
}

/* --------------------------------------------------------------- teasers --- */
const LOCK_SVG = '<svg class="ep-lock-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<rect x="5" y="10.5" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const DEFAULT_TITLE = 'Advanced analytics are for members';

function stateBySlug(slug) {
  if (!slug) {
    /* no league named: if exactly one league is loaded on this page, that is it */
    const uk = userKey();
    const known = [...states.values()].filter(e => e.user === uk && e.st.known && e.st.leagueId);
    return known.length === 1 ? known[0].st : null;
  }
  const m = slugs.get(String(slug));
  return m ? raw(m.id) : null;
}
/* Is there anything to buy? Only a KNOWN "no plans" hides the link; a page that
   never loaded the league shows it, and the join page says what is on sale. */
const plansFor = st => (st && st.known ? !!st.hasPlans : true);

function teaserHTML(o) {
  const x = o || {};
  const slug = x.leagueSlug ? String(x.leagueSlug) : '';
  const plans = plansFor(stateBySlug(slug));
  const signedIn = !!session();
  const join = joinHref({ leagueSlug: slug });

  if (x.compact) {
    const t = plans ? (x.title || DEFAULT_TITLE) : 'Members only';
    return '<div class="ep-lock ep-lock-compact" role="note">' + LOCK_SVG +
      '<span class="ep-lock-t">' + esc(t) + '</span>' +
      (plans ? '<a class="ep-lock-go" href="' + esc(join) + '">See membership</a>' : '') +
      '</div>';
  }

  const title = plans ? (x.title || DEFAULT_TITLE) : 'Members only';
  const given = x.lines == null ? [FEATURES.analytics.blurb] : (Array.isArray(x.lines) ? x.lines : [x.lines]);
  const lines = given.filter(l => l != null && String(l).trim()).slice(0, 3);
  const cta = [];
  if (plans) cta.push('<a class="ep-lock-go" href="' + esc(join) + '">See membership</a>');
  /* a grant is keyed on an email address and only counts once its holder signs
     in, so the way in is offered even where nothing is for sale */
  if (!signedIn) {
    cta.push('<span class="ep-lock-or">Already a member?</span>' +
             '<a class="ep-lock-in" href="' + esc(signinHref()) + '">Sign in</a>');
  }
  return '<div class="ep-lock" role="note">' + LOCK_SVG +
    '<div class="ep-lock-tx">' +
      '<div class="ep-lock-t">' + esc(title) + '</div>' +
      lines.map(l => '<p class="ep-lock-l">' + esc(l) + '</p>').join('') +
      (cta.length ? '<div class="ep-lock-cta">' + cta.join('') + '</div>' : '') +
    '</div></div>';
}

/* The card a members-only league shows in place of what happened on court. It
   says what the league is, that the games are for members, and — because a
   closed door with nothing visible through it looks broken rather than closed —
   what is still free to everyone. */
let paywallSeq = 0;
function paywallHTML(o) {
  const lg = (o && o.league) || {};
  const st = (lg.id && raw(lg.id)) || (lg.slug && stateBySlug(lg.slug)) || null;
  const name = lg.name || (st && st.name) || 'This league';
  const slug = lg.slug || (st && st.slug) || '';
  const pick = (...vals) => vals.find(v => typeof v === 'boolean');
  const fixturesPublic = pick(lg.fixturesPublic, lg.fixtures_public, st ? st.fixturesPublic : undefined, true);
  /* the league's OWN way in, not "any plan applies here": Epinoia's analytics
     plan applies in every league and opens none of them (see fromPayload) */
  const plans = pick(lg.hasLeaguePlans, lg.has_league_plans, st && st.known ? st.hasLeaguePlans : undefined, true);
  const signedIn = !!session();
  const id = 'ep-paywall-' + (++paywallSeq);

  const free = [];
  if (fixturesPublic) free.push('Upcoming fixtures: who plays whom, and when');
  free.push('The clubs, their crests and squads');
  if (plans) free.push('Membership plans and prices');

  const cta = [];
  if (plans) cta.push('<a class="ep-lock-go" href="' + esc(joinHref({ leagueSlug: slug })) + '">See membership</a>');
  if (!signedIn) {
    cta.push('<span class="ep-lock-or">Already a member?</span>' +
             '<a class="ep-lock-in" href="' + esc(signinHref()) + '">Sign in</a>');
  }

  return '<section class="ep-paywall" aria-labelledby="' + id + '">' +
    '<div class="ep-paywall-kick">' + LOCK_SVG + '<span>Members only</span></div>' +
    '<h2 class="ep-paywall-h" id="' + id + '">' + esc(name) + '</h2>' +
    '<p class="ep-paywall-p">' + esc(name) + ' keeps its results and statistics for its members.</p>' +
    (signedIn ? '<p class="ep-paywall-p">You are signed in, but this account is not a member here yet.</p>' : '') +
    (plans ? '' : '<p class="ep-paywall-p">Memberships are not on sale here yet. The league arranges them itself.</p>') +
    '<div class="ep-paywall-free"><div class="ep-paywall-k">Free to everyone</div><ul class="ep-paywall-list">' +
      free.map(f => '<li>' + esc(f) + '</li>').join('') +
    '</ul></div>' +
    (cta.length ? '<div class="ep-lock-cta">' + cta.join('') + '</div>' : '') +
    '</section>';
}

/* ----------------------------------------------------------- watch auth --- */
/* The signature has three forms: 'user|token-tail' for a live session,
   'user|expired' for one whose access token ran out but can be refreshed, and
   'signed-out'. The middle one is never believed as it stands. */
let authSig = null;
function sig() {
  const s = stored(), t = Date.now();
  if (!s) return 'signed-out';
  if (!expired(s, t)) return (s.userId || '?') + '|' + s.token.slice(-24);
  return refreshPlan(s, t) === 'refresh' ? (s.userId || '?') + '|expired' : 'signed-out';
}
function checkAuth(settled) {
  let now = sig();
  if (/\|expired$/.test(now)) {
    if (settled !== true) {
      /* SIGNED OUT ONLY BECAUSE THE TOKEN RAN OUT while the tab sat there — the
         commonest "change" of all, an hour after a page was opened. Refresh
         first and look again; taken at face value it would clear every answer
         and redraw a member's page as a stranger's. Returns true (handled): the
         look after the refresh does whatever the change calls for. */
      ensureSession(Date.now() + DEADLINE_MS)
        .then(() => { if (!checkAuth(true)) refreshStale(); }, () => {});
      return true;
    }
    now = 'signed-out';                  // the refresh did not work: for now, signed out
  }
  if (now === authSig) return false;
  const was = authSig;
  authSig = now;
  const keys = [...states.keys()];
  const sameUser = was && was !== 'signed-out' && now !== 'signed-out' && was.split('|')[0] === now.split('|')[0];
  if (sameUser) {
    /* a refreshed token for the same account: ask again quietly; listeners
       hear about it only if the answer moved */
    keys.forEach(k => loadId(k, true));
    return true;
  }
  inflight.clear();
  states.clear();
  emit({ reason: 'auth' });
  keys.forEach(k => loadId(k, false));
  return true;
}
function refreshStale() {
  const uk = userKey(), t = Date.now();
  [...states.entries()].forEach(([k, e]) => { if (e.user === uk && t - e.at >= TTL_MS) loadId(k, true); });
}

if (BROWSER) {
  authSig = sig();
  window.addEventListener('storage', e => {
    if (!e.key) { checkAuth(); emit({ reason: 'sim' }); return; }     // storage cleared
    if (e.key.indexOf('-auth-token') !== -1) checkAuth();
    else if (e.key === SIM_KEY) emit({ reason: 'sim' });
  });
  /* fired by epinoiaSignOut in this same tab, where no storage event arrives.
     Wrapped: the event object must not arrive as checkAuth's argument. */
  window.addEventListener('epinoia:auth', () => { checkAuth(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!checkAuth()) refreshStale();
  });
  /* The SDK, where a page loads it, arrives after this file on some pages (the
     game page), so it is looked for once every deferred script has run. */
  const hookSdk = () => {
    try { if (root.supabase && typeof root.epinoiaClient === 'function') watchSdk(root.epinoiaClient()); }
    catch (_) { /* no SDK client: the storage and visibility checks remain */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookSdk);
  else hookSdk();
}

return {
  FEATURES, CATALOGUE,
  load, loadMany, get, analyticsOk, canView, isPremiumColumn,
  teaserHTML, paywallHTML, joinHref, authHeaders, onChange,
  session, sessionReady, fromPayload, signinHref, safePath, priceText, amountText, forget,
  /* for supabase/tests/access.test.mjs only: a fake network, a shorter deadline,
     the refresh decision, and a clean slate between cases. Nothing on a page
     calls these. */
  _test: {
    transport(fn) { transport = typeof fn === 'function' ? fn : null; },
    deadline(ms) { DEADLINE_MS = ms > 0 ? ms : 4000; },
    refreshPlan(raw, now) { return refreshPlan(raw == null ? null : parseSession(raw), now == null ? Date.now() : now); },
    checkAuth(settled) { return checkAuth(settled); },
    sig() { return sig(); },
    setAuthSig(v) { authSig = v; },
    reset() {
      states.clear(); slugs.clear(); inflight.clear(); slugInflight.clear(); listeners.clear();
      memoRaw = null; memoSess = null; refreshing = null; deadRefresh = ''; refreshQuietUntil = 0;
    },
    LOCK_KEY, TAB_ID, ROOT_PATH
  }
};
}));
