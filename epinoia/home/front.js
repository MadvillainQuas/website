'use strict';
/* ============================================================================
   HOME — the platform's front door, /epinoia/home/ (roadmap Phase 1).

   THIS FILE IS THE CONDUCTOR, NOT THE ORCHESTRA. The sections are written in
   their own files (daily.js, stars-home.js, leagues.js), each registering one
   async function at load:

     EpinoiaHome.register('fixtures' | 'stars' | 'leagues', async function (ctx) { … })

   ctx = { host, base, now, fadeIn }
     host    the section's mount element (#homeDaily, #homeStars, #homeLeagues)
     base    '../', the path from this page to /epinoia/
     now     the Date the page froze at load, so every section agrees on "today"
     fadeIn  fadeIn(el): 200 ms in, nothing under reduced motion

   ORDER. Fixtures and leagues start at once. Stars start after fixtures has
   settled: they fetch box scores in bulk and are the heaviest thing on the
   page, and the fixtures are what a reader opened HOME to see.

   ONE BROKEN SECTION NEVER BREAKS THE OTHERS. A section that throws, or was
   never registered, gets a quiet empty state; its neighbours run regardless.
   While a section is running its mount carries aria-busy, which is also what
   keeps its skeleton height in kit/home.css, so the page does not jump.

   WHAT HOME NEVER DOES: set __CS_LEAGUE_SLUG or paint a league's theme (it is
   the platform's page, not a league's), load mode.js or splash.css, or show
   the water.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaHome = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const NOW = new Date();
const BASE = '../';
const MOUNTS = { fixtures: 'homeDaily', stars: 'homeStars', leagues: 'homeLeagues' };
const QUIET = {
  fixtures: 'Fixtures could not be loaded just now.',
  stars: 'The best performers could not be loaded just now.',
  leagues: 'The leagues could not be loaded just now.'
};
const sections = Object.create(null);

function register(name, fn) {
  if (typeof fn === 'function') sections[name] = fn;
}

const reduced = () => {
  try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (_) { return false; }
};

/* FADE IN. Opacity 0 is committed (a forced layout) before .in is added, or the browser would
   merge the two and skip the transition. requestAnimationFrame never fires in a tab that is not
   painting, so a timeout is the floor: an element must never be left invisible. */
function fadeIn(el) {
  if (!el || !el.classList) return el;
  if (reduced()) { el.classList.remove('hm-fade'); return el; }
  el.classList.remove('in');
  el.classList.add('hm-fade');
  void el.offsetWidth;
  let done = false;
  const show = () => { if (!done) { done = true; el.classList.add('in'); } };
  if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(show);
  setTimeout(show, 80);
  return el;
}

/* ------------------------------------------------------------ the address ---
   The launch URL carries ?source= (pwa, twa) and the Android shell's shell=,
   notif= and chan=. appmode.js has already read and stored them, so they come
   out of the address bar: a shared or bookmarked HOME link should not claim to
   be an app launch. ?code= and the #hash stay, because they are a sign-in the
   SDK has not finished yet. */
function tidyUrl() {
  try {
    const u = new URL(location.href);
    let changed = false;
    ['source', 'shell', 'notif', 'chan'].forEach(k => {
      if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
    });
    if (changed) history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch (_) { /* an address we cannot parse is left as it is */ }
}

/* A SIGN-IN LANDING HERE. Magic links and Google both return to the page they started on, and
   in the app that is HOME. The SDK finishes the job itself (detectSessionInUrl) as soon as the
   client exists, so all this does is make the client exist when there is something to finish.
   config.js loads the SDK relative to the document, and this document is one folder down. */
function finishSignIn() {
  let pending = false;
  try {
    const q = new URLSearchParams(location.search);
    pending = q.has('code') || /(^#|&)(access_token|error_description)=/.test(location.hash || '');
  } catch (_) { pending = false; }
  if (!pending || typeof root.epinoiaClientReady !== 'function') return;
  const c = root.EPINOIA_CONFIG;
  if (c && !c.sdkPath) c.sdkPath = BASE + 'vendor/supabase.js';
  root.epinoiaClientReady()
    .then(sb => sb && sb.auth && sb.auth.getSession())
    .then(() => {
      try { root.dispatchEvent(new Event('epinoia:auth')); } catch (_) {}
      paintFoot();
    })
    .catch(e => console.warn('[home] sign-in did not complete', e));
}

/* ------------------------------------------------------------- the foot ---
   "Sign in" only for somebody signed out. Read from the stored session, the
   way nav.js reads it, so HOME never loads the 207 kB SDK just to hide a link. */
function signedIn() {
  const c = root.EPINOIA_CONFIG;
  const ref = c && c.supabaseUrl && (String(c.supabaseUrl).match(/^https?:\/\/([^.]+)\./) || [])[1];
  if (!ref) return false;
  try {
    const raw = localStorage.getItem('sb-' + ref + '-auth-token');
    if (!raw) return false;
    const j = JSON.parse(raw);
    const s = (j && j.currentSession) || j || {};
    if (!s.access_token) return false;
    return !(s.expires_at && Number(s.expires_at) * 1000 < Date.now());
  } catch (_) { return false; }
}

function paintFoot() {
  const a = document.getElementById('homeSignin');
  if (a) a.hidden = signedIn();
}

/* ------------------------------------------------------------ #leagues ---
   /epinoia/countries/ now lands on /epinoia/home/#leagues. The browser jumps
   to the anchor at once, while the fixtures and stars above it are still
   skeletons, and they grow when their data arrives. So the section is scrolled
   to again after the sections render, instantly (a smooth scroll here would be
   the page visibly lurching), unless the reader has already moved. */
let readerMoved = false;
function watchReader() {
  const moved = () => { readerMoved = true; };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(t =>
    root.addEventListener(t, moved, { passive: true, once: true }));
}
function reScroll() {
  if (readerMoved || location.hash !== '#leagues') return;
  const el = document.getElementById('leagues');
  if (!el) return;
  try { el.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  catch (_) { el.scrollIntoView(true); }
}

/* ------------------------------------------------------ the Android app ---
   div#homeApp: a "Get the Android app" card for an Android browser (Chrome, Samsung Internet or
   any other) that is not the app, linking to the download page, and on an iPhone the same card
   for the iPhone app, linking to the iPhone page, once epinoia/ios/version.json says it is out.
   Nothing inside an app or on a desktop. WHO GETS IT is nav.js's decision (window.EpinoiaAppShell.appCard), the
   same one that swaps the rail's install banner for the Android app, so the two never disagree;
   nav.js loads after this file but before DOMContentLoaded, so it is there when this runs, and
   a page without it simply has no card. The card is drawn when version.json answers (once a
   session, shared with nav.js) with released: true, carrying the version it names.

   deps (for the tests): { host, shell, env, store, doc } */
function paintApp(deps) {
  const d = deps || {};
  const doc = d.doc || (typeof document !== 'undefined' ? document : null);
  const host = d.host || (doc && doc.getElementById('homeApp'));
  const shell = d.shell || root.EpinoiaAppShell;
  if (!doc || !host || !shell || typeof shell.appCard !== 'function') return Promise.resolve(null);
  const nav = root.navigator || {};
  const env = d.env || {
    app: root.epinoiaApp === true,
    mApp: !!(doc.documentElement && doc.documentElement.classList && doc.documentElement.classList.contains('m-app')),
    ua: nav.userAgent || '', platform: nav.platform || '', maxTouchPoints: nav.maxTouchPoints || 0
  };
  env.href = BASE + 'android/';
  env.iosHref = BASE + 'ios/';
  let store = d.store;
  if (store === undefined) { try { store = root.sessionStorage; } catch (_) { store = null; } }
  const w = typeof shell.where === 'function' ? shell.where(env) : '';
  /* AN IPHONE GETS THE IPHONE APP'S CARD, from its own release file, and never the Android one */
  if (w === 'ios') {
    if (typeof shell.iosVersion !== 'function') return Promise.resolve(null);
    return shell.iosVersion(BASE + 'ios/version.json', { store }).then(ver => {
      const card = shell.appCard(env, ver);
      return card ? drawAppCard(doc, host, card) : null;
    }, () => null);
  }
  /* NOT BEFORE THE FIRST RELEASE: the card waits for version.json, and draws only when it says
     released: true. Not an Android browser or an iPhone, no answer, or not out yet: no card,
     and only those two ask at all. */
  if (w !== 'android' || typeof shell.version !== 'function') {
    return Promise.resolve(null);
  }
  return shell.version(BASE + 'android/version.json', { store }).then(ver => {
    const card = shell.appCard(env, ver);
    return card ? drawAppCard(doc, host, card) : null;
  }, () => null);
}
function drawAppCard(doc, host, card) {
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const a = el('a', 'hm-app');
  a.href = card.href;
  const t = el('span', 't');
  const v = el('span', 'v');
  const ios = card.platform === 'ios';
  t.append(el('span', null, ios ? 'Get the iPhone app' : 'Get the Android app'), v);
  const go = el('span', 'go', '→');
  go.setAttribute('aria-hidden', 'true');
  a.append(
    el('span', 'k', ios ? 'EPINOIΛ for iPhone' : 'EPINOIΛ for Android'),
    t,
    el('span', 'd', ios
      ? 'Its own icon and window, and game alerts on your lock screen. Free on the App Store. It shows the live site, so it needs a connection.'
      : 'Its own icon and window, and game alerts that pop up. It shows the live site, so it needs a connection and Chrome on the phone.'),
    go
  );
  if (card.versionName) v.textContent = 'v' + card.versionName;
  host.textContent = '';
  host.appendChild(a);
  fadeIn(a);
  return a;
}

/* ------------------------------------------------------------ sections --- */
function quiet(host, name) {
  host.textContent = '';
  const d = document.createElement('div');
  d.className = 'empty';
  d.textContent = QUIET[name] || 'Nothing to show just now.';
  host.appendChild(d);
  fadeIn(d);
}

async function run(name) {
  const host = document.getElementById(MOUNTS[name]);
  if (!host) return;
  host.setAttribute('aria-busy', 'true');
  try {
    const fn = sections[name];
    if (typeof fn !== 'function') throw new Error('section "' + name + '" is not registered');
    await fn({ host, base: BASE, now: NOW, fadeIn });
  } catch (e) {
    console.warn('[home] ' + name, e);
    quiet(host, name);
  } finally {
    host.querySelectorAll('.hm-skel').forEach(n => n.remove());
    host.removeAttribute('aria-busy');
  }
}

function boot() {
  tidyUrl();
  finishSignIn();
  paintFoot();
  root.addEventListener('epinoia:auth', paintFoot);
  root.addEventListener('storage', e => { if (e.key && e.key.indexOf('-auth-token') !== -1) paintFoot(); });
  watchReader();
  try { paintApp(); } catch (e) { console.warn('[home] app card', e); }

  const fixtures = run('fixtures');
  const leagues = run('leagues').then(reScroll);
  const stars = fixtures.then(() => run('stars'));
  Promise.all([fixtures, leagues, stars]).then(reScroll, reScroll);
}

/* ON DOMContentLoaded, NOT "WHEN THE DOCUMENT IS NO LONGER LOADING". A deferred script runs
   while readyState is already "interactive" and before the deferred section files after it
   have run, so booting on readyState would start before they had registered. DOMContentLoaded
   fires after every deferred script; load is the fallback for a late inclusion. */
let booted = false;
const bootOnce = () => { if (!booted) { booted = true; boot(); } };
if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  if (document.readyState === 'complete') setTimeout(bootOnce, 0);
  else {
    document.addEventListener('DOMContentLoaded', bootOnce, { once: true });
    root.addEventListener('load', bootOnce, { once: true });
  }
}

return { register, fadeIn, paintApp, now: NOW };
}));
