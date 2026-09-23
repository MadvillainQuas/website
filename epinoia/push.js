'use strict';
/* ============================================================================
   Push — notifications on this phone (docs/notifications.md §5).

   One module every page can lazy-load. follow.js loads it after a follow and asks
   offer() to put up the FotMob-style sheet; the profile page loads it with a
   script tag and drives its "This phone" card with state(), enable(), test() and
   disable(). No SDK: the stored session is read the way nav.js and follow.js read
   it, and every write is one REST call with the apikey and the fan's token.

     state()            -> Promise<'unsupported'|'ios-install'|'denied'|'off'|'on'>
     enable()           -> Promise<{ok, state, message}>   call it straight from a tap
     disable({notifyPush?: false}) -> Promise<{ok, state, message}>
     test({delay?})     -> Promise<{ok, message}>   delay: seconds the server waits first (10 at most)
     sync()             -> Promise<{ok, state}>   re-saves this phone's subscription
     check(onStep?)     -> Promise<{ok, steps, advice, platform}>   the step-by-step
                           answer to "why is nothing arriving?" (docs/notifications.md §7)
     offer({name, kind})-> Promise<{shown, why, view?}>
     inApp()            -> boolean   inside the Epinoia Android app (roadmap Phase 7)
     inIOSApp()         -> boolean   inside the Epinoia iPhone app (ios/), which pushes through APNs
     endpoint()         -> Promise<string>   this browser's push endpoint, '' when none
     settingsIntent     the link that opens the Android app's own notification settings
     settingsOpened()   call from a tap on that link: the launch report is not believed after it
     appBlocked()       -> null | {label}   in the app, Android blocking pop-ups by the launch report

   THE ANDROID APP (a Trusted Web Activity on Chrome) posts every notification itself, on
   its own "Game alerts" channel: Chrome receives the push and hands it over. So in the app
   the switches that matter are the app's, not Chrome's site settings, and the JavaScript
   permission is not to be trusted (it can say "granted" while Android blocks the app).
   The app says what Android says on every launch (?notif=&chan=, kept by appmode.js in
   sessionStorage epinoia_shell), and the check believes that instead.

   WHAT "ON" MEANS: this browser has granted permission AND holds a push
   subscription on the /epinoia/ service worker. Whether the account wants pushes
   at all is fan_prefs.notify_push, which enable() switches on.

   THE IPHONE APP (ios/) has no Web Push at all: WKWebView has none. The app registers with
   Apple itself and hands this page its token (window.EpinoiaNative), which is saved as the
   phone instead of a subscription; every function above takes that path in the app, and
   nothing changes anywhere else. See "the iPhone app" below.

   iOS ONLY DELIVERS WEB PUSH TO AN INSTALLED APP (16.4 and later): Safari in a tab
   has no PushManager at all, so an iPhone outside the Home Screen app is told how to
   install rather than that its browser "cannot" — it can, once installed.

   THE PERMISSION PROMPT NEEDS THE TAP. Safari and Firefox refuse
   Notification.requestPermission() once the gesture that asked for it has been
   spent on a network round trip, so enable() does everything it can decide
   synchronously first and asks for permission before its first await.

   UMD so node can require() it for supabase/tests/push.test.mjs. Under node there
   is no document: offer() decides and says why, and draws nothing. Tests swap the
   browser in with _test.env({...}).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPush = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* The same script URL nav.js registers (root + 'sw.js', scope root): one
   registration, never a second worker fighting over the scope. No query string —
   a different URL would be a different worker. */
const SW_URL = '/epinoia/sw.js';
const SCOPE = '/epinoia/';
const PROFILE = '/epinoia/me/';
const SNOOZE_KEY = 'epinoia_push_offer_snoozed';
const SNOOZE_MS = 14 * 86400000;
const READY_MS = 10000;
const FETCH_MS = 15000;
/* The Android app's native notification settings screen (NotificationSettingsActivity). Chrome
   opens an intent: link only from a tap, and only inside the app is the package there. */
const SETTINGS_INTENT = 'intent://notification-settings#Intent;scheme=epinoia;package=uk.co.prophesyscouting.epinoia;end';
/* The iPhone app cancels a tap on this link and opens iOS's notification settings for itself. */
const NATIVE_SETTINGS = 'epinoia://notification-settings';
/* the iPhone app's address this page turned on (see "the iPhone app" below) */
const IOS_ON_KEY = 'epinoia_ios_push';
/* Android's NotificationManager.IMPORTANCE_HIGH: the lowest importance that pops up */
const IMPORTANCE_HIGH = 4;
/* the longest a delayed test waits on the server (notify caps it at the same) */
const MAX_DELAY_S = 10;

const MSG = Object.freeze({
  unsupported: 'This browser cannot receive notifications. On a phone, use Chrome or Samsung Internet on Android, or EPINOIΛ from the Home Screen on an iPhone.',
  iosInstall: 'On iPhone and iPad, notifications only arrive through EPINOIΛ on your Home Screen. Tap Share, then Add to Home Screen, open EPINOIΛ from there and turn notifications on.',
  denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.',
  notConfigured: 'Notifications are not set up on this site yet.',
  signedOut: 'Sign in first, so Epinoia knows whose notifications to send.',
  dismissed: 'Notifications were not allowed. Try again and choose Allow when your browser asks.',
  worker: 'This browser would not start Epinoia’s notification service. Reload the page and try again.',
  subscribe: 'This browser could not sign up for notifications. Check that notifications are allowed for this site, then try again.',
  expired: 'Your sign-in has expired. Sign in again, then turn notifications on.',
  save: 'This phone could not be added to your account just now. Check your connection and try again.',
  prefs: 'This phone was added, but your notification settings could not be saved. Try again.',
  on: 'Notifications are on for this phone.',
  off: 'Notifications are off for this phone.',
  offKept: 'Notifications are off for this phone. It will drop off your account the next time a notification cannot reach it.',
  testSent: 'A test notification is on its way. It should arrive within a few seconds.',
  testNone: 'The test reached no phone. Turn notifications off and on again here, then send another.',
  testFailed: 'The test could not be sent just now. Try again in a minute.',
  testOffline: 'The test could not be sent. Check your connection and try again.',
  testNotThisPhone: 'The test went to your other devices, but this phone is not on your account. Tap Check this phone to add it.',
  testDelayed: 'The test is on its way. Lock the phone or go to the Home Screen now: it is sent in 10 seconds.',
  testNotDelayed: 'The test was sent straight away (the server is not updated yet), so it could not wait for the phone to lock.',
  testArrived: 'The test reached this phone.',
  testNotShown: 'The test reached this phone, but it was not allowed to show. Tap Check this phone for the settings to change.',
  testNotArrived: 'The push service accepted the test, but it has not reached this phone yet. Tap Check this phone to find out why.',
  runCheck: 'Tap Check this phone to put it right.',
  nativeDenied: 'Notifications are turned off for EPINOIΛ in your iPhone’s settings. Tap Open notification settings, turn on Allow Notifications, then try again.',
  nativeNoToken: 'Your iPhone did not get a notification address from Apple. Check it is online, then try again.',
  nativeFailed: 'The EPINOIΛ app did not answer. Close it completely, open it again and try again.',
  nativeOffKept: 'Notifications are off on this iPhone, but it could not be taken off your account just now. Try again when you are online.'
});
/* how long the check and the test wait for this phone's worker to say a push arrived */
const RECEIPT_MS = 20000;

/* ------------------------------------------------------------ environment --- */
let ENV = null;
const g = k => (ENV && Object.prototype.hasOwnProperty.call(ENV, k)) ? ENV[k] : root[k];
const cfg = () => g('EPINOIA_CONFIG') || {};
const vapid = () => String(g('EPINOIA_VAPID') || '').trim();
const now = () => (ENV && typeof ENV.now === 'function') ? ENV.now() : Date.now();

function storage() { try { return g('localStorage') || null; } catch (_) { return null; } }

/* base64url (the VAPID public key as published) -> the bytes subscribe() wants.
   null for anything that is not base64url. */
function keyBytes(k) {
  const s = String(k == null ? '' : k).trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!s || /[^A-Za-z0-9+/=]/.test(s)) return null;
  try {
    const bin = atob(s.replace(/=+$/, '') + '==='.slice((s.replace(/=+$/, '').length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) { return null; }
}
function sameKey(a, b) {
  if (!a || !b) return false;
  const x = a instanceof Uint8Array ? a : new Uint8Array(a.buffer ? a.buffer : a);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b.buffer ? b.buffer : b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/* ------------------------------------------------------------- the device --- */
function isIOS(nav) {
  const ua = String((nav && nav.userAgent) || '');
  return /iPhone|iPad|iPod/.test(ua) || (!!nav && nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1);
}
/* [major, minor] from "iPhone OS 17_4" or, for iPadOS's desktop user agent,
   "Version/17.4"; null when neither is there */
function iosVersion(ua) {
  const s = String(ua || '');
  const m = /OS (\d+)[_.](\d+)/.exec(s) || /Version\/(\d+)\.(\d+)/.exec(s);
  return m ? [+m[1], +m[2]] : null;
}
function standalone() {
  const nav = g('navigator') || {};
  if (nav.standalone === true) return true;
  const mm = g('matchMedia');
  if (typeof mm !== 'function') return false;
  try {
    return !!(mm.call(root, '(display-mode: standalone)').matches || mm.call(root, '(display-mode: fullscreen)').matches);
  } catch (_) { return false; }
}

/* ------------------------------------------------------ the Android app --- */
function sessionStore() { try { return g('sessionStorage') || null; } catch (_) { return null; } }
/* What the app's launcher said about itself on this launch (appmode.js keeps it):
   {shell, notif, chan, at}, or null when this page was not opened by the app */
function launchState() {
  const ss = sessionStore();
  if (!ss) return null;
  try {
    const j = JSON.parse(ss.getItem('epinoia_shell') || 'null');
    return j && typeof j === 'object' ? j : null;
  } catch (_) { return null; }
}
/* THE LAUNCH REPORT GOES STALE. It is what Android said when the app opened, and two things
   change the answer without a new launch: Android's own permission dialog allowing
   notifications (enable() writes that back into the report), and a visit to the app's
   notification settings screen, after which Back returns to this same session. The second
   cannot be read back, so a tap on the settings button is remembered (settingsOpened) and a
   report older than it is no longer believed. */
const SETTINGS_OPENED_KEY = 'epinoia_settings_opened';
function settingsOpened() {
  const ss = sessionStore();
  try { if (ss) ss.setItem(SETTINGS_OPENED_KEY, String(now())); } catch (_) { /* then the report is believed */ }
}
function launchStale() {
  const sh = launchState();
  const ss = sessionStore();
  if (!sh || !ss) return false;
  let t = 0;
  try { t = Number(ss.getItem(SETTINGS_OPENED_KEY)) || 0; } catch (_) { t = 0; }
  return t > 0 && t > (Number(sh.at) || 0);
}
function launchSource() {
  const loc = g('location');
  try { return new URLSearchParams(String((loc && loc.search) || '')).get('source') || ''; } catch (_) { return ''; }
}
/* a whole number from what the launcher sent, else null */
function whole(v) {
  if (v === '' || v == null || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
/* INSIDE THE EPINOIA ANDROID APP: the launcher's report is in this session, or this page was
   launched with ?source=twa. Never Samsung Internet: the app is forced onto Chrome, and a
   Samsung Internet web app carrying a copied launch URL is still Samsung's to post.
   A WINDOW OPENED BY A NOTIFICATION TAP while the app was closed is a new session with neither,
   so two more signals count: the app's own android-app:// referrer, and an installed-looking
   window (display-mode standalone) in a Chrome that has run the app before (appmode.js keeps
   localStorage epinoia_twa_seen whenever the launcher reports itself). */
const TWA_SEEN_KEY = 'epinoia_twa_seen';
const APP_REFERRER = 'android-app://uk.co.prophesyscouting.epinoia';
function inApp() {
  const ua = String((g('navigator') || {}).userAgent || '');
  if (!/Android/i.test(ua) || /SamsungBrowser/i.test(ua)) return false;
  if (launchState() || launchSource() === 'twa') return true;
  const doc = g('document');
  let ref = '';
  try { ref = String((doc && doc.referrer) || ''); } catch (_) { ref = ''; }
  if (ref.indexOf(APP_REFERRER) === 0) return true;
  const ls = storage();
  let seen = null;
  try { seen = ls ? ls.getItem(TWA_SEEN_KEY) : null; } catch (_) { seen = null; }
  return !!seen && standalone();
}

/* Everything that can be known without waiting: 'unsupported', 'ios-install',
   'denied', or the permission ('granted' / 'default'). Synchronous on purpose —
   enable() runs it inside the tap. */
function quick() {
  /* the iPhone app answers for iOS itself, and needs neither a worker nor a secure-context check */
  const n = iosApp();
  if (n) return nativePermission(n.permission);
  const nav = g('navigator');
  if (!nav) return 'unsupported';
  if (g('isSecureContext') === false) return 'unsupported';
  if (isIOS(nav)) {
    const v = iosVersion(nav.userAgent);
    if (v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))) return 'unsupported';   // no web push before 16.4, installed or not
    if (!standalone()) return 'ios-install';
  }
  const N = g('Notification');
  if (!nav.serviceWorker || !g('PushManager') || !N) return 'unsupported';
  if (N.permission === 'denied') return 'denied';
  return N.permission === 'granted' ? 'granted' : 'default';
}

async function registration() {
  const nav = g('navigator');
  if (!nav || !nav.serviceWorker || typeof nav.serviceWorker.getRegistration !== 'function') return null;
  try { return (await nav.serviceWorker.getRegistration(SCOPE)) || null; } catch (_) { return null; }
}
async function currentSubscription(reg) {
  const n = iosApp();
  if (n) return nativeSub(n);
  const r = reg || await registration();
  if (!r || !r.pushManager) return null;
  try { return (await r.pushManager.getSubscription()) || null; } catch (_) { return null; }
}

/* this browser's push endpoint, so the profile page can tell this phone's row from the others */
async function endpoint() {
  const sub = await currentSubscription();
  return (sub && sub.endpoint) || '';
}

async function state() {
  const q = quick();
  if (q !== 'granted' && q !== 'default') return q;
  if (q === 'default') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/* ------------------------------------------------------------- the session --- */
function jwtSub(tok) {
  try {
    const part = String(tok).split('.')[1];
    if (!part) return '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return (JSON.parse(json) || {}).sub || '';
  } catch (_) { return ''; }
}
function storedSession() {
  const m = String(cfg().supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
  const ls = storage();
  if (!m || !ls) return null;
  let raw;
  try { raw = ls.getItem('sb-' + m[1] + '-auth-token'); } catch (_) { return null; }
  if (!raw) return null;
  let j;
  try { j = JSON.parse(raw); } catch (_) { return null; }
  const cs = j && j.currentSession;
  const tok = j && (j.access_token || (cs && cs.access_token));
  if (!tok) return null;
  const user = (j && j.user) || (cs && cs.user) || {};
  return {
    token: String(tok),
    userId: user.id || jwtSub(tok),
    exp: Number(j.expires_at || (cs && cs.expires_at)) || 0,
    refresh: !!(j.refresh_token || (cs && cs.refresh_token))
  };
}
const live = s => !!s && !(s.exp && s.exp * 1000 < now());
/* signed in for the purpose of asking: a live token, or one access.js can refresh */
const signedIn = () => { const s = storedSession(); return !!s && (live(s) || s.refresh); };

/* The token to write with. access.js, where the page has it, trades an expired
   token for a fresh one first; otherwise the stored one, if it is still good. */
async function freshSession() {
  const A = g('EpinoiaAccess');
  if (A && typeof A.sessionReady === 'function') {
    try {
      const s = await A.sessionReady();
      if (s && s.token) return { token: String(s.token), userId: s.userId || jwtSub(s.token) };
    } catch (_) { /* fall back to what is stored */ }
  }
  const s = storedSession();
  return live(s) ? { token: s.token, userId: s.userId } : null;
}

/* --------------------------------------------------------------- the wire --- */
const headers = token => ({
  apikey: cfg().supabaseAnonKey,
  Authorization: 'Bearer ' + token,
  'Content-Type': 'application/json'
});
async function call(url, init, ms) {
  const f = g('fetch');
  if (typeof f !== 'function') throw new Error('no network');
  const AC = g('AbortController');
  const ctl = typeof AC === 'function' ? new AC() : null;
  const t = ctl ? setTimeout(() => { try { ctl.abort(); } catch (_) { /* gone */ } }, ms || FETCH_MS) : null;
  try {
    return await f.call(root, url, ctl ? Object.assign({}, init, { signal: ctl.signal }) : init);
  } finally { if (t) clearTimeout(t); }
}
const okStatus = s => s >= 200 && s < 300;

/* WHICH KIND OF CLIENT MADE THE SUBSCRIPTION (0128): the Android app, Samsung Internet's
   installed web app, any other installed web app, or a browser tab. Two of these on one phone
   means every notification arrives twice, and the push endpoint cannot tell them apart (both
   Chrome and Samsung Internet use Google's service), so the profile page reads this to offer
   turning the others off. */
function clientKind() {
  if (iosApp()) return 'ios';
  if (inApp()) return 'twa';
  if (standalone()) return /SamsungBrowser/i.test(String((g('navigator') || {}).userAgent || '')) ? 'samsung-app' : 'pwa';
  return 'tab';
}
function subscriptionRow(sub, userId) {
  const j = (sub && typeof sub.toJSON === 'function') ? sub.toJSON() : (sub || {});
  const keys = (j && j.keys) || {};
  const nav = g('navigator') || {};
  return {
    user_id: userId,
    endpoint: (sub && sub.endpoint) || j.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    ua: String(nav.userAgent || '').slice(0, 200),
    client: clientKind()
  };
}
/* the status, or 0 when the request never got an answer. BEFORE 0128 the client column is
   not there and PostgREST answers 400 to a row that names it, so the row is sent again
   without it: a phone is never refused over a deploy order. */
async function saveSubscription(sub, sess) {
  const post = row => call(cfg().supabaseUrl + '/rest/v1/push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    headers: Object.assign(headers(sess.token), { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(row)
  });
  try {
    const row = subscriptionRow(sub, sess.userId);
    const r = await post(row);
    if (r.status === 400 && 'client' in row) {
      delete row.client;
      return (await post(row)).status;
    }
    return r.status;
  } catch (_) { return 0; }
}
async function deleteSubscription(endpoint, sess) {
  try {
    const r = await call(cfg().supabaseUrl + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), {
      method: 'DELETE', headers: headers(sess.token)
    });
    return r.status;
  } catch (_) { return 0; }
}
/* this browser's own IANA zone (0144), best effort: turning push on is the moment we know
   for certain what phone is about to receive it, so it rides along with that call only —
   never on a plain toggle-off, which has nothing new to say about where the reader is. */
function myTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) { return null; }
}
async function setNotifyPush(on, sess) {
  try {
    const tz = on ? myTimeZone() : null;
    const p = Object.assign({ notify_push: !!on }, tz ? { time_zone: tz } : {});
    const r = await call(cfg().supabaseUrl + '/rest/v1/rpc/set_fan_prefs', {
      method: 'POST', headers: headers(sess.token), body: JSON.stringify({ p })
    });
    return r.status;
  } catch (_) { return 0; }
}

/* ------------------------------------------------------------ subscribing --- */
function requestPermission(N) {
  return new Promise(resolve => {
    let done = false;
    const fin = p => { if (!done) { done = true; resolve(p); } };
    try {
      /* the callback form is older Safari's; the promise form everybody else's */
      const pr = N.requestPermission(fin);
      if (pr && typeof pr.then === 'function') pr.then(fin, () => fin(N.permission));
    } catch (_) { fin(N.permission); }
  });
}
function withTimeout(p, ms, fallback) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
/* subscribe() needs an ACTIVE worker. A first registration is still installing
   when register() resolves, so wait for it — with a limit, so a worker that never
   activates is a plain message rather than a button that spins for ever. */
async function whenActive(reg) {
  if (!reg) return null;
  if (reg.active) return reg;
  const nav = g('navigator') || {};
  const waits = [];
  if (nav.serviceWorker && nav.serviceWorker.ready) waits.push(Promise.resolve(nav.serviceWorker.ready).then(() => reg));
  const w = reg.installing || reg.waiting;
  if (w && typeof w.addEventListener === 'function') {
    waits.push(new Promise(resolve => w.addEventListener('statechange', () => { if (w.state === 'activated') resolve(reg); })));
  }
  if (waits.length) await withTimeout(Promise.race(waits), READY_MS, null);
  return reg.active ? reg : null;
}
/* This browser's subscription for our key: the one it already holds, unless that
   was made with a different key (a rotated VAPID pair), which cannot be reused. */
async function subscribeWith(reg, fresh) {
  const key = keyBytes(vapid());
  let sub = fresh ? null : await reg.pushManager.getSubscription();
  const had = sub && sub.options && sub.options.applicationServerKey;
  if (sub && had && !sameKey(had, key)) {
    try { await sub.unsubscribe(); } catch (_) { /* replaced below either way */ }
    sub = null;
  }
  return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}
/* Saved under this account. A 403 on the upsert is the endpoint already being
   somebody else's row — the previous account signed in on this browser — and RLS
   will not hand it over, so this browser takes a fresh subscription instead. */
async function saveOrReplace(reg, sub, sess) {
  let st = await saveSubscription(sub, sess);
  /* AN IPHONE KEEPS ITS TOKEN whoever signs in, so there is no fresh one to take: the account
     signed in now takes this exact address over from the last one (0130), then saves it */
  if (st === 403 && sub && sub.native) {
    if (okStatus(await claimDevice(sub.endpoint, sess))) st = await saveSubscription(sub, sess);
    return st;
  }
  if (st === 403) {
    try {
      await sub.unsubscribe();
      const next = await subscribeWith(reg, true);
      st = await saveSubscription(next, sess);
    } catch (_) { /* st stays the refusal */ }
  }
  return st;
}
const result = (ok, st, message) => ({ ok: !!ok, state: st, message });

async function enable() {
  /* the iPhone app asks iOS itself, so there is no gesture to keep and no worker to start */
  const n = iosApp();
  if (n) return enableNative(n);
  /* --- everything decided before the first await: the tap is still ours --- */
  const q = quick();
  if (q === 'unsupported') return result(false, 'unsupported', MSG.unsupported);
  if (q === 'ios-install') return result(false, 'ios-install', MSG.iosInstall);
  if (q === 'denied') return result(false, 'denied', MSG.denied);
  if (!keyBytes(vapid())) return result(false, 'off', MSG.notConfigured);
  if (!signedIn()) return result(false, 'off', MSG.signedOut);

  const N = g('Notification');
  const before = N.permission;
  const perm = await requestPermission(N);
  if (perm === 'denied') return result(false, 'denied', MSG.denied);
  if (perm !== 'granted') return result(false, 'off', MSG.dismissed);
  /* In the app, a permission that was not granted before the tap and is now came from
     Android's own dialog (Chrome asks through the app): notifications are on for the app, so
     the launch report's notif=0 is out of date. The channel is left as reported; the
     launcher created it on this launch and the dialog does not change it. */
  if (before !== 'granted' && inApp()) {
    const sh = launchState();
    if (sh) {
      const ss = sessionStore();
      try { if (ss) ss.setItem('epinoia_shell', JSON.stringify(Object.assign({}, sh, { notif: 1, at: now() }))); } catch (_) { /* the check says reopen */ }
    }
  }

  const nav = g('navigator');
  let reg;
  try { reg = await nav.serviceWorker.register(SW_URL, { scope: SCOPE }); } catch (_) { return result(false, 'off', MSG.worker); }
  reg = await whenActive(reg);
  if (!reg || !reg.pushManager) return result(false, 'off', MSG.worker);

  let sub;
  try { sub = await subscribeWith(reg, false); } catch (_) { return result(false, 'off', MSG.subscribe); }
  if (!sub) return result(false, 'off', MSG.subscribe);

  const sess = await freshSession();
  if (!sess || !sess.userId) return result(false, 'on', MSG.expired);
  const st = await saveOrReplace(reg, sub, sess);
  if (st === 401) return result(false, 'on', MSG.expired);
  if (!okStatus(st)) return result(false, 'on', MSG.save);

  const p = await setNotifyPush(true, sess);
  if (p === 401) return result(false, 'on', MSG.expired);
  if (!okStatus(p)) return result(false, 'on', MSG.prefs);
  return result(true, 'on', MSG.on);
}

/* This phone stops: its row goes, then its subscription. notify_push is the
   account's switch and is left alone — other phones keep theirs — unless the
   caller (the profile page's channel box) asks for it with {notifyPush: false}. */
async function disable(opts) {
  const o = opts || {};
  if (iosApp()) return disableNative(iosApp(), o);
  const sess = await freshSession();
  const sub = await currentSubscription();
  let removed = true;
  if (sub && sess) removed = okStatus(await deleteSubscription(sub.endpoint, sess));
  if (sub) { try { await sub.unsubscribe(); } catch (_) { /* the row is gone; a stale one dies on its first 410 */ } }
  if (o.notifyPush === false && sess) await setNotifyPush(false, sess);
  const st = await state();
  if (!sub) return result(true, st, MSG.off);
  return result(true, st, removed ? MSG.off : MSG.offKept);
}

/* A test through the account, exactly as real notifications travel: this phone saved
   under the account first (sync), then a push to every phone on it. When this phone
   was among them and its push service took it, the answer waits for this phone's
   worker to say it arrived.

   test({delay: 10}) asks the server to wait that many seconds (10 at most) before sending,
   so the phone can be locked first: a heads-up on a locked phone is the real test of the
   Android app's Game alerts channel. The answer then comes after the wait, so every
   timeout here is lengthened by it. A notify deployed before the delay existed ignores it
   and sends at once; it is told apart by the missing `delayed` in its answer, and the result
   is then {ok: false, notDelayed: true} with a sentence saying so. */
async function test(opts) {
  const o = opts || {};
  const delay = Math.max(0, Math.min(MAX_DELAY_S, Math.floor(Number(o.delay) || 0)));
  const sess = await freshSession();
  if (!sess) return { ok: false, message: MSG.signedOut };
  const reg = await registration();
  const sub = await currentSubscription(reg);
  if (sub && quick() === 'granted') await sync().catch(() => null);
  const arrival = sub ? waitForReceipt('test', RECEIPT_MS + delay * 1000) : null;
  const ask = { test: true, endpoint: sub ? sub.endpoint : '' };
  if (delay) ask.delay = delay;
  let r;
  try {
    r = await call(cfg().supabaseUrl + '/functions/v1/notify', {
      method: 'POST', headers: headers(sess.token), body: JSON.stringify(ask)
    }, FETCH_MS + delay * 1000);
  } catch (_) { if (arrival) arrival.cancel(); return { ok: false, message: MSG.testOffline }; }
  let data = {};
  try { data = (await r.json()) || {}; } catch (_) { data = {}; }
  if (r.status === 401) { if (arrival) arrival.cancel(); return { ok: false, message: MSG.expired }; }
  if (!r.ok) { if (arrival) arrival.cancel(); return { ok: false, message: MSG.testFailed }; }
  const devices = Array.isArray(data.devices) ? data.devices : [];
  /* A notify deployed before the delay existed sent it at once, while the person was still
     reading, so it proves nothing about a locked phone: say so rather than ask whether it
     popped up. The new notify answers with delayed: the seconds it waited. */
  if (delay && typeof data.delayed !== 'number') {
    if (arrival) arrival.cancel();
    return { ok: false, notDelayed: true, devices, message: MSG.testNotDelayed };
  }
  const mine = devices.find(d => d && d.thisPhone);
  const counts = [data.sent, data.pushed, data.delivered, data.test && data.test.sent].filter(n => typeof n === 'number');
  if (!mine) {
    if (arrival) arrival.cancel();
    if (sub) return { ok: false, devices, message: MSG.testNotThisPhone };
    if (counts.length && counts[0] === 0) return { ok: false, devices, message: MSG.testNone };
    return { ok: true, devices, message: MSG.testSent };
  }
  if (!mine.ok) { if (arrival) arrival.cancel(); return { ok: false, devices, message: (mine.text || MSG.testNone) + ' ' + MSG.runCheck }; }
  const got = arrival ? await arrival.promise : null;
  if (got && got.shown) return { ok: true, devices, message: MSG.testArrived };
  if (got) return { ok: false, devices, message: MSG.testNotShown };
  return { ok: false, devices, message: MSG.testNotArrived };
}

/* ------------------------------------------------------------- the check --- */
/* Which phone this is, for the settings a person has to find: an installed app and a
   browser tab keep their notification switch in different places. */
function platform() {
  if (iosApp()) return 'ios-native';
  const nav = g('navigator') || {};
  const ua = String(nav.userAgent || '');
  const app = standalone();
  if (isIOS(nav)) return app ? 'ios-app' : 'ios-safari';
  if (/Android/i.test(ua)) {
    /* the Epinoia Android app first: it is also display-mode standalone, but its settings
       are its own Game alerts channel, not an installed web app's App info */
    if (inApp()) return 'android-twa';
    /* Samsung Internet's installed app still has its notifications posted by Samsung Internet,
       so its fixes are Samsung's, not App info's */
    if (/SamsungBrowser/i.test(ua)) return app ? 'android-samsung-app' : 'android-samsung';
    return app ? 'android-app' : 'android-chrome';
  }
  return 'desktop';
}
const SETTINGS = Object.freeze({
  /* THE EPINOIA ANDROID APP. Chrome receives each push and the app re-posts it on Game alerts,
     so the app's channel decides whether it pops up, and both apps must be allowed to run in
     the background. One UI adds the Brief pop-up style, which only lights the screen's edge. */
  'android-twa': ['Tap Open notification settings (or open Settings, then Apps, then EPINOIΛ, then Notifications) and allow notifications.',
                  'Open Game alerts there: choose Alert rather than Silent, and turn on Show as pop-up and the lock screen.',
                  'In Settings, open Notifications, then Notification pop-up style, and choose Detailed (Brief only lights the edge of the screen).',
                  'In Settings, open Apps, then EPINOIΛ, then Battery, and choose Unrestricted. Do the same for Chrome, which receives each notification before EPINOIΛ shows it.',
                  'In Settings, open Battery (or Battery and device care), then Background usage limits: take EPINOIΛ and Chrome out of Sleeping apps and Deep sleeping apps, and add both to Never sleeping apps.'],
  'android-app':['Press and hold the EPINOIΛ icon on your Home Screen, then tap App info.',
                  'Tap Notifications and turn them on, including every category under them.'],
  'android-chrome': ['In Chrome, tap ⋮ then Settings, then Site settings, then Notifications.',
                     'Find prophesyscouting.co.uk and set it to Allowed.',
                     'In Android Settings, open Apps, then Chrome, then Notifications: they must be on, including Sites.'],
  /* A Samsung phone hides a notification that has been received and "shown" in three ways a
     browser cannot see: a category set to Silent, the Brief pop-up style (a light round the
     edge of the screen, nothing else), and a sleeping app. */
  'android-samsung': ['In Samsung Internet, open the menu, then Settings, then Sites and downloads, then Notifications: allow prophesyscouting.co.uk.',
                      'In the phone’s Settings, open Notifications, then App notifications, and turn on Samsung Internet.',
                      'Tap Samsung Internet there and set every category, including prophesyscouting.co.uk, to Alert rather than Silent.',
                      'In Settings, open Notifications, then Notification pop-up style, and choose Detailed (Brief only lights the edge of the screen).',
                      'In Settings, open Battery (or Battery and device care), then Background usage limits, and take Samsung Internet out of Sleeping apps and Deep sleeping apps.'],
  'android-samsung-app': ['In the phone’s Settings, open Notifications, then App notifications, and turn on both EPINOIΛ and Samsung Internet.',
                          'Tap each of them there and set every category to Alert rather than Silent.',
                          'In Settings, open Notifications, then Notification pop-up style, and choose Detailed (Brief only lights the edge of the screen).',
                          'In Settings, open Battery (or Battery and device care), then Background usage limits, and take EPINOIΛ and Samsung Internet out of Sleeping apps and Deep sleeping apps.',
                          'In Samsung Internet, open the menu, then Settings, then Sites and downloads, then Notifications: prophesyscouting.co.uk must be allowed.'],
  'ios-app': ['Open the Settings app, then Notifications, then EPINOIΛ.', 'Turn on Allow Notifications, and choose Lock Screen and Banners.'],
  /* THE EPINOIA IPHONE APP: iOS posts its notifications itself, so its own settings are the switch */
  'ios-native': ['Tap Open notification settings (or open the Settings app, then Notifications, then EPINOIΛ).',
                 'Turn on Allow Notifications, and tick Lock Screen, Notification Centre and Banners.',
                 'Turn on Sounds, so an alert is heard while the phone is locked.'],
  'ios-safari': ['Notifications only arrive through EPINOIΛ on your Home Screen: tap Share, then Add to Home Screen, and open it from there.'],
  desktop: ['Click the icon to the left of the address, open the site settings for prophesyscouting.co.uk and allow Notifications.',
            'Check your computer lets the browser show notifications (on Windows: Settings, then System, then Notifications).']
});
const QUIET = Object.freeze({
  'android-twa': ['Check the phone is not in Do Not Disturb, or that EPINOIΛ is allowed as an exception to it.'],
  'android-app': ['Check the phone is not in Do Not Disturb, and that Battery for EPINOIΛ (App info, then Battery) is not Restricted.'],
  'android-chrome': ['Check the phone is not in Do Not Disturb, and that Battery for Chrome (Settings, then Apps, then Chrome, then Battery) is not Restricted.'],
  'android-samsung': ['Check the phone is not in Do Not Disturb.'],
  'android-samsung-app': ['Check the phone is not in Do Not Disturb.'],
  'ios-app': ['Check Focus or Do Not Disturb is off.'],
  'ios-native': ['Check Focus is off, or that EPINOIΛ is allowed in it (Settings, then Focus).',
                 'Check Scheduled Summary is not holding EPINOIΛ back (Settings, then Notifications, then Scheduled Summary).'],
  'ios-safari': [],
  desktop: ['Check Focus assist or Do Not Disturb is off.']
});

/* THE FIX FOR A NOTIFICATION THAT ARRIVED BUT WAS NEVER SEEN. The browser reports a push
   as shown once it has handed it to the phone; whether the phone then puts it on screen is
   the phone's settings, and nothing tells the page. So after every test the person is asked
   whether it popped up, and a no gets these steps for their phone, then another test. */
function help() {
  const plat = platform();
  const out = { platform: plat, steps: (SETTINGS[plat] || []).concat(QUIET[plat] || []) };
  if (plat === 'android-twa' || plat === 'ios-native') out.action = settingsAction();
  return out;
}
/* the button that opens the app's own notification settings, for a page to draw: the Android
   app's settings screen, or in the iPhone app a link the app turns into iOS's settings */
function settingsAction() { return { label: 'Open notification settings', href: iosApp() ? NATIVE_SETTINGS : SETTINGS_INTENT }; }
/* For the profile card in the app: the permission step's finding when Android is blocking
   pop-ups by the launch report, else null (not in the app, no report, all on, or a report
   made stale by a visit to the settings) */
function appBlocked() {
  if (!inApp()) return null;
  const p = appPermission(quick());
  return p && p.ok === false ? p : null;
}
const REOPEN = 'Then close EPINOIΛ completely (swipe it away from your recent apps), open it again and run the check again: the app reports its notification settings each time it opens.';

/* THE PERMISSION STEP IN THE ANDROID APP, from what Android told the launcher: notif is
   areNotificationsEnabled() (1 or 0), chan the Game alerts channel's importance (4 HIGH and
   5 MAX pop up, 3 sounds without popping up, 1-2 silent, 0 off, -1 not created). null when
   the launch carried neither, and the browser's own answer has to do. The JavaScript
   permission is shown beside it, for information only. */
function appPermission(q) {
  const sh = launchState() || {};
  const notif = whole(sh.notif), chan = whole(sh.chan);
  if (notif === null) return null;
  const js = 'This page’s browser permission reads ' + (q === 'granted' ? 'allowed' : q === 'denied' ? 'blocked' : 'not asked') +
             '; the app’s own setting is what counts.';
  const when = ' (as of this launch)';
  /* the settings screen was opened after the report was made: neither pass nor fail, and
     the check goes on, so the live test push and its arrival decide */
  if (launchStale()) {
    return { ok: null, label: 'Your notification settings may have changed since EPINOIΛ opened',
             detail: 'What Android reported when the app opened is out of date, so the test below decides. ' + js };
  }
  if (notif === 0) {
    return { ok: false, label: 'Notifications are turned off for the EPINOIΛ app' + when, detail: js,
             title: 'Turn on notifications for the EPINOIΛ app, then reopen it' };
  }
  if (chan !== null && chan < IMPORTANCE_HIGH) {
    const how = chan < 0 ? 'Game alerts is not set up yet' : chan === 0 ? 'Game alerts is switched off'
      : chan === 3 ? 'Game alerts can sound, but is set not to pop up' : 'Game alerts is set to Silent';
    return { ok: false, label: how + when, detail: js,
             title: chan < 0 ? 'Reopen the EPINOIΛ app' : 'Set Game alerts to pop up, then reopen the app' };
  }
  return { ok: true, label: 'Notifications are on for the EPINOIΛ app' + (chan !== null ? ', and Game alerts pops up' : '') + when, detail: js };
}

/* A promise for the next receipt from this phone's worker with the given tag, and a
   way to stop listening. Resolves null when none arrives in time. */
function waitForReceipt(tag, ms) {
  if (iosApp()) return nativeReceipt(tag, ms);
  const nav = g('navigator');
  const sw = nav && nav.serviceWorker;
  let stop = () => {};
  const promise = new Promise(resolve => {
    if (!sw || typeof sw.addEventListener !== 'function') { resolve(null); return; }
    const on = ev => {
      const d = ev && ev.data;
      if (d && d.type === 'epinoia-push' && (!tag || d.tag === tag)) { stop(); resolve(d); }
    };
    const t = setTimeout(() => { stop(); resolve(null); }, ms);
    stop = () => { clearTimeout(t); try { sw.removeEventListener('message', on); } catch (_) { /* gone */ } };
    sw.addEventListener('message', on);
    try { if (typeof sw.startMessages === 'function') sw.startMessages(); } catch (_) { /* already started */ }
  });
  return { promise, cancel: () => stop() };
}

/* which worker is running, or '' when it does not answer */
function pingWorker(reg, ms) {
  return new Promise(resolve => {
    const w = reg && reg.active;
    const MC = g('MessageChannel');
    if (!w || typeof w.postMessage !== 'function' || typeof MC !== 'function') { resolve(''); return; }
    const ch = new MC();
    const t = setTimeout(() => resolve(''), ms);
    ch.port1.onmessage = ev => { clearTimeout(t); resolve((ev.data && ev.data.version) || ''); };
    try { w.postMessage({ type: 'epinoia-ping', id: String(now()) }, [ch.port2]); } catch (_) { clearTimeout(t); resolve(''); }
  });
}

async function ownRow(endpoint, sess) {
  try {
    const r = await call(cfg().supabaseUrl + '/rest/v1/push_subscriptions?select=id,last_push_at,last_push_status,last_push_error&endpoint=eq.' +
                         encodeURIComponent(endpoint), { headers: headers(sess.token) });
    if (r.status === 400) {                     // before 0125: the status columns are not there yet
      const r2 = await call(cfg().supabaseUrl + '/rest/v1/push_subscriptions?select=id&endpoint=eq.' + encodeURIComponent(endpoint),
                            { headers: headers(sess.token) });
      return { status: r2.status, row: okStatus(r2.status) ? ((await r2.json()) || [])[0] || null : null };
    }
    return { status: r.status, row: okStatus(r.status) ? ((await r.json()) || [])[0] || null : null };
  } catch (_) { return { status: 0, row: null }; }
}
async function accountPushOn(sess) {
  try {
    const r = await call(cfg().supabaseUrl + '/rest/v1/fan_prefs?select=notify_push&user_id=eq.' + encodeURIComponent(sess.userId),
                         { headers: headers(sess.token) });
    if (!okStatus(r.status)) return null;
    const row = ((await r.json()) || [])[0];
    return row ? !!row.notify_push : false;
  } catch (_) { return null; }
}
async function deviceCheck(sub, sess) {
  const j = (sub && typeof sub.toJSON === 'function') ? sub.toJSON() : sub;
  try {
    const h = { apikey: cfg().supabaseAnonKey, 'Content-Type': 'application/json' };
    if (sess && sess.token) h.Authorization = 'Bearer ' + sess.token;
    const r = await call(cfg().supabaseUrl + '/functions/v1/notify', {
      method: 'POST', headers: h, body: JSON.stringify({ check: { endpoint: sub.endpoint || j.endpoint, keys: (j && j.keys) || {} } })
    });
    let data = {};
    try { data = (await r.json()) || {}; } catch (_) { data = {}; }
    return Object.assign({ http: r.status }, data);
  } catch (_) { return { http: 0, ok: false, status: 0, text: MSG.testOffline }; }
}
const SERVICE = { 'fcm.googleapis.com': 'Google', 'android.googleapis.com': 'Google', 'web.push.apple.com': 'Apple',
                  'updates.push.services.mozilla.com': 'Mozilla' };
function serviceName(endpoint) {
  if (/^apns:/.test(String(endpoint || ''))) return 'Apple';
  let host = '';
  try { host = new URL(String(endpoint)).hostname; } catch (_) { return 'its push service'; }
  if (SERVICE[host]) return SERVICE[host];
  if (/\.push\.apple\.com$/.test(host)) return 'Apple';
  if (/\.notify\.windows\.com$/.test(host)) return 'Microsoft';
  return 'its push service';
}
function clock(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* Every step, in the order a notification travels, each saying what it found; what can
   be put right without a decision (an expired or mismatched sign-up, a phone missing
   from the account) is put right, and said so. Never asks for permission: that needs
   the Turn on button's tap. onStep(steps) is called as each step lands. */
async function check(onStep) {
  if (iosApp()) return checkNative(iosApp(), onStep);
  const steps = [];
  const plat = platform();
  const report = (extra) => Object.assign({ ok: steps.length > 0 && steps.every(s => s.ok !== false), steps, platform: plat }, extra);
  const add = (id, ok, label, detail) => {
    steps.push({ id, ok, label, detail: detail || '' });
    if (typeof onStep === 'function') { try { onStep(steps.slice()); } catch (_) { /* the page's problem */ } }
  };
  /* in the app every piece of advice carries the button into the app's notification settings */
  const app = plat === 'android-twa';
  const advise = (title, lines) => report({ advice: Object.assign({ title, lines: (lines || []).filter(Boolean) },
                                                                  app ? { action: settingsAction() } : {}) });

  /* 1. the browser */
  const q = quick();
  if (q === 'unsupported') {
    add('browser', false, 'This browser cannot receive notifications', MSG.unsupported);
    return advise('Use a browser that can', [/Android/i.test(String((g('navigator') || {}).userAgent || ''))
      ? 'Open prophesyscouting.co.uk/epinoia/me/ in Chrome or Samsung Internet (not inside another app), then run the check again.'
      : MSG.unsupported]);
  }
  if (q === 'ios-install') {
    add('browser', false, 'On iPhone, notifications need EPINOIΛ on your Home Screen', MSG.iosInstall);
    return advise('Add EPINOIΛ to your Home Screen', SETTINGS['ios-safari']);
  }
  add('browser', true, 'This browser can receive notifications');

  /* 2. permission: in the app, what Android said at launch; elsewhere the browser's */
  const native = app ? appPermission(q) : null;
  if (native) {
    add('permission', native.ok, native.label, native.detail);
    if (native.ok === false) return advise(native.title, SETTINGS[plat].slice(0, 2).concat(REOPEN));
  } else if (q === 'denied') {
    add('permission', false, 'Notifications are blocked for Epinoia on this phone');
    return advise('Allow notifications, then run the check again', SETTINGS[plat].concat(app ? [REOPEN] : []));
  } else if (q !== 'granted') {
    add('permission', false, 'Epinoia has not been allowed to send notifications yet');
    return advise('Turn notifications on', ['Tap Turn on above and choose Allow when the phone asks.',
      'If nothing asks, allow them in settings instead:'].concat(SETTINGS[plat], app ? [REOPEN] : []));
  } else {
    add('permission', true, 'Notifications are allowed for Epinoia');
  }

  /* 3. the worker */
  const nav = g('navigator');
  let reg = await registration();
  if (!reg || !reg.active) {
    try { reg = await whenActive(await nav.serviceWorker.register(SW_URL, { scope: SCOPE })); } catch (_) { reg = null; }
  }
  if (!reg || !reg.active || !reg.pushManager) {
    add('worker', false, 'Epinoia’s notification service is not running on this phone', MSG.worker);
    return advise('Reload and try again', ['Close Epinoia completely, open it again and run the check.']);
  }
  const version = await pingWorker(reg, 3000);
  add('worker', true, 'Epinoia’s notification service is running', version ? 'version ' + version : 'an older version; it updates the next time Epinoia is reopened');

  /* 4. the subscription (re-made when missing, or made with another key) */
  let sub = await currentSubscription(reg);
  let made = '';
  const key = keyBytes(vapid());
  const had = sub && sub.options && sub.options.applicationServerKey;
  if (sub && had && key && !sameKey(had, key)) {
    try { await sub.unsubscribe(); } catch (_) { /* replaced below */ }
    sub = null; made = 'renewed: it was signed up with an old key';
  }
  if (!sub) {
    try { sub = await subscribeWith(reg, true); if (!made) made = 'signed up just now: it was not signed up'; } catch (_) { sub = null; }
  }
  if (!sub) {
    add('subscription', false, 'This phone could not sign up for notifications', MSG.subscribe);
    return advise('Allow notifications, then run the check again', SETTINGS[plat]);
  }
  add('subscription', true, 'This phone is signed up with ' + serviceName(sub.endpoint), made);

  /* 5. the account */
  const sess = await freshSession();
  if (!sess || !sess.userId) {
    add('account', false, 'You are not signed in on this phone', MSG.signedOut);
  } else {
    let row = await ownRow(sub.endpoint, sess);
    let fixed = '';
    if (okStatus(row.status) && !row.row) {
      const st = await saveOrReplace(reg, sub, sess);
      if (okStatus(st)) { fixed = 'added just now: it was missing'; sub = (await currentSubscription(reg)) || sub; row = await ownRow(sub.endpoint, sess); }
    }
    if (row.row) add('account', true, 'This phone is on your account', fixed);
    else add('account', false, 'This phone could not be added to your account', row.status === 401 ? MSG.expired : MSG.save);
    const on = await accountPushOn(sess);
    if (on === false) add('channel', false, 'Phone and desktop alerts are switched off on your account', 'Tick Phone and desktop alerts below; tests still arrive, real notifications do not.');
    else if (on === true) add('channel', true, 'Phone and desktop alerts are on for your account');
    /* what happened before the check: worth knowing, but the test below decides */
    if (row.row && row.row.last_push_at && row.row.last_push_status != null && !(row.row.last_push_status >= 200 && row.row.last_push_status < 300)) {
      add('history', null, 'Before this check, the last notification to this phone was refused (' + row.row.last_push_status + ') at ' + clock(Date.parse(row.row.last_push_at)),
          String(row.row.last_push_error || '').slice(0, 160));
    }
  }

  /* 6. a push to this phone, through the push service */
  let arrival = waitForReceipt('check', RECEIPT_MS);
  let res = await deviceCheck(sub, sess);
  if (!res.ok && res.fix === 'resubscribe') {
    arrival.cancel();
    try { await sub.unsubscribe(); } catch (_) { /* replaced below */ }
    try { sub = await subscribeWith(reg, true); } catch (_) { sub = null; }
    if (sub && sess && sess.userId) await saveOrReplace(reg, sub, sess);
    if (sub) {
      add('renewed', true, 'This phone’s sign-up was out of date, so it signed up again', res.text || '');
      arrival = waitForReceipt('check', RECEIPT_MS);
      res = await deviceCheck(sub, sess);
    }
  }
  if (!res.ok) {
    arrival.cancel();
    const why = res.status === 429 ? 'A check has just run. Wait a few seconds and run it again.'
      : (res.text || res.error || MSG.testFailed) + (res.detail ? ' (' + String(res.detail).slice(0, 120) + ')' : '');
    add('delivery', false, 'The test push did not get through', why);
    return advise(res.fix === 'server' ? 'This is on Epinoia’s side, not your phone' : 'Try again in a minute',
                  [res.fix === 'server' ? 'Nothing on this phone needs changing. Try again later.' : 'If it keeps failing, tap Turn off, then Turn on, and run the check again.']);
  }
  add('delivery', true, serviceName(sub.endpoint) + ' accepted a test push for this phone');

  /* 7. did it reach the phone */
  const got = await arrival.promise;
  if (!got) {
    add('arrival', false, 'The test has not reached this phone after ' + Math.round(RECEIPT_MS / 1000) + ' seconds');
    return advise('The phone is not letting notifications through in the background', [
      'Check the phone has a connection.'].concat(QUIET[plat] || [], SETTINGS[plat] || []));
  }
  if (!got.shown) {
    add('arrival', false, 'The test reached this phone, but the browser refused to show it', got.error || '');
    return advise('Allow Epinoia to show notifications', SETTINGS[plat]);
  }
  add('arrival', true, 'The test reached this phone at ' + clock(got.at || now()) + ' and was shown');
  /* the phone can receive; what is left is the account */
  if (steps.some(s => s.id === 'account' && s.ok === false)) {
    return advise(sess && sess.userId ? 'This phone works, but it is not on your account yet' : 'This phone works: sign in so it gets your notifications',
                  sess && sess.userId ? ['Run the check again in a minute. If it still fails, tap Turn off, then Turn on.']
                                      : ['Sign in on this phone with the email you use for Epinoia, then run the check again.']);
  }
  if (steps.some(s => s.id === 'channel' && s.ok === false)) {
    return advise('This phone works: switch on Phone and desktop alerts',
                  ['Tick Phone and desktop alerts below. Tests reach this phone either way, but real notifications are only sent while it is on.']);
  }
  return advise('Everything on Epinoia’s side works', [
    'If a notification titled “This phone can get notifications” did not appear just now, the phone is hiding them:'
  ].concat(SETTINGS[plat] || [], QUIET[plat] || []));
}

/* The profile page, on every visit with notifications on: this subscription saved
   under whoever is signed in now. Heals a subscription the browser rotated without
   telling the worker which one it replaced, and a browser handed from one account
   to another. Never prompts (permission is already granted). */
async function sync() {
  if (iosApp()) return syncNative(iosApp());
  if (quick() !== 'granted') return { ok: false, state: await state() };
  const reg = await registration();
  const sub = await currentSubscription(reg);
  if (!sub) return { ok: false, state: 'off' };
  const sess = await freshSession();
  if (!sess || !sess.userId) return { ok: false, state: 'on' };
  return { ok: okStatus(await saveOrReplace(reg, sub, sess)), state: 'on' };
}

/* -------------------------------------------------------- the iPhone app --- */
/* THE EPINOIA IPHONE APP (ios/README.md). WKWebView has no Web Push: no worker push, no
   PushManager, no Notification. The app asks iOS itself, registers with Apple Push
   Notification service, and tells this page what it knows through window.EpinoiaNative,
   defined before any page script runs, only on this origin:

     { platform: 'ios', build, version, permission, token, apnsEnv, call(name, args) }
     permission  'default' | 'granted' | 'denied' | 'provisional' | 'ephemeral'
     token       Apple's address for this iPhone, lower-case hex, or null
     call        'push.status' | 'push.enable' | 'settings.open' | 'app.info' -> Promise

   and events on window, 'epinoia-native' with detail {type: 'permission', ...} or
   {type: 'push', tag, kind, shown, opened, at} when a notification is shown while the app
   is open, or tapped.

   This phone's subscription is the token, saved as the account's phone with the endpoint
   apns:<apnsEnv>:<token> (0130); notify sends it through APNs. WHAT "ON" MEANS HERE: iOS
   allows notifications AND this page turned them on (localStorage epinoia_ios_push holds the
   endpoint). The flag is needed because an iPhone never hands its token back: turning off
   removes the row and forgets the endpoint, and the token stays with the app. */
function iosApp() {
  const n = g('EpinoiaNative');
  return n && n.platform === 'ios' && typeof n.call === 'function' ? n : null;
}
/* iOS's answer in the browser's words: provisional and ephemeral deliver, so they count as allowed */
function nativePermission(p) {
  if (p === 'denied') return 'denied';
  return p === 'granted' || p === 'provisional' || p === 'ephemeral' ? 'granted' : 'default';
}
function nativeEndpoint(n, token) {
  const t = String(token || '').toLowerCase();
  if (!/^[0-9a-f]{64,200}$/.test(t)) return '';
  return 'apns:' + (n && n.apnsEnv === 'sandbox' ? 'sandbox' : 'production') + ':' + t;
}
function nativeOn() {
  const ls = storage();
  try { return String((ls && ls.getItem(IOS_ON_KEY)) || ''); } catch (_) { return ''; }
}
function setNativeOn(ep) {
  const ls = storage();
  try { if (ls) { if (ep) ls.setItem(IOS_ON_KEY, ep); else ls.removeItem(IOS_ON_KEY); } } catch (_) { /* private mode: off next page */ }
}
function nativeSubFor(ep) {
  return { endpoint: ep, native: true, toJSON: () => ({ endpoint: ep, keys: {} }) };
}
/* on: the address the app holds now (the token may have changed since), else the one turned on */
function nativeSub(n) {
  const on = nativeOn();
  return on ? nativeSubFor(nativeEndpoint(n, n.token) || on) : null;
}
/* the object the app injects may be frozen: what it says is kept where it can be */
function nativeRemember(n, r) {
  try { if (r && typeof r.permission === 'string') n.permission = r.permission; } catch (_) { /* read-only */ }
  try { if (r && (typeof r.token === 'string' || r.token === null)) n.token = r.token; } catch (_) { /* read-only */ }
}
async function nativeCall(n, name, args, ms) {
  try { return (await withTimeout(Promise.resolve().then(() => n.call(name, args || {})), ms || 20000, null)) || null; }
  catch (_) { return null; }
}
async function claimDevice(ep, sess) {
  try {
    const r = await call(cfg().supabaseUrl + '/rest/v1/rpc/push_claim_device', {
      method: 'POST', headers: headers(sess.token), body: JSON.stringify({ p_endpoint: ep })
    });
    return r.status;
  } catch (_) { return 0; }
}
/* the address saved, the old one (a changed token) removed, and remembered as on */
async function saveNative(ep, sess) {
  const st = await saveOrReplace(null, nativeSubFor(ep), sess);
  if (!okStatus(st)) return st;
  const old = nativeOn();
  if (old && old !== ep) await deleteSubscription(old, sess);
  setNativeOn(ep);
  return st;
}

async function enableNative(n) {
  if (!signedIn()) return result(false, 'off', MSG.signedOut);
  /* iOS asks the person the first time; after that the app just registers again. The wait
     includes however long they take over iOS's question, so it is generous. */
  const r = await nativeCall(n, 'push.enable', {}, 120000);
  if (!r) return result(false, 'off', MSG.nativeFailed);
  nativeRemember(n, r);
  const perm = nativePermission(r.permission);
  if (perm === 'denied') return result(false, 'denied', MSG.nativeDenied);
  if (perm !== 'granted') return result(false, 'off', MSG.dismissed);
  const ep = nativeEndpoint(n, r.token);
  if (!ep) return result(false, 'off', MSG.nativeNoToken);
  const sess = await freshSession();
  if (!sess || !sess.userId) return result(false, 'off', MSG.expired);
  const st = await saveNative(ep, sess);
  if (st === 401) return result(false, 'off', MSG.expired);
  if (!okStatus(st)) return result(false, 'off', MSG.save);
  const p = await setNotifyPush(true, sess);
  if (p === 401) return result(false, 'on', MSG.expired);
  if (!okStatus(p)) return result(false, 'on', MSG.prefs);
  return result(true, 'on', MSG.on);
}

async function disableNative(n, o) {
  const sess = await freshSession();
  const eps = [...new Set([nativeOn(), nativeEndpoint(n, n.token)].filter(Boolean))];
  let removed = true;
  if (sess) for (const ep of eps) removed = okStatus(await deleteSubscription(ep, sess)) && removed;
  else removed = !eps.length;
  setNativeOn('');
  if (o.notifyPush === false && sess) await setNotifyPush(false, sess);
  return result(true, await state(), removed ? MSG.off : MSG.nativeOffKept);
}

async function syncNative(n) {
  if (quick() !== 'granted') return { ok: false, state: await state() };
  if (!nativeOn()) return { ok: false, state: 'off' };
  /* the token iOS holds today, which the app refreshes on every launch */
  const r = await nativeCall(n, 'push.status', {}, 5000);
  if (r) nativeRemember(n, r);
  const sub = nativeSub(n);
  const sess = await freshSession();
  if (!sess || !sess.userId) return { ok: false, state: 'on' };
  return { ok: okStatus(await saveNative(sub.endpoint, sess)), state: 'on' };
}

/* the app says a notification was shown while it is open: waitForReceipt's answer */
function nativeReceipt(tag, ms) {
  const add = g('addEventListener'), remove = g('removeEventListener');
  let stop = () => {};
  const promise = new Promise(resolve => {
    if (typeof add !== 'function') { resolve(null); return; }
    const on = ev => {
      const d = ev && ev.detail;
      if (d && d.type === 'push' && (!tag || d.tag === tag)) {
        stop();
        resolve({ type: 'epinoia-push', tag: d.tag, shown: d.shown !== false, at: Number(d.at) || now() });
      }
    };
    const t = setTimeout(() => { stop(); resolve(null); }, ms);
    stop = () => { clearTimeout(t); try { remove.call(root, 'epinoia-native', on); } catch (_) { /* gone */ } };
    add.call(root, 'epinoia-native', on);
  });
  return { promise, cancel: () => stop() };
}

/* The check, in the iPhone app: the same questions in the order a notification travels, with
   the app's own answers where a browser would have a worker and a subscription. */
async function checkNative(n, onStep) {
  const steps = [];
  const plat = 'ios-native';
  const report = extra => Object.assign({ ok: steps.length > 0 && steps.every(s => s.ok !== false), steps, platform: plat }, extra);
  const add = (id, ok, label, detail) => {
    steps.push({ id, ok, label, detail: detail || '' });
    if (typeof onStep === 'function') { try { onStep(steps.slice()); } catch (_) { /* the page's problem */ } }
  };
  const advise = (title, lines) => report({ advice: { title, lines: (lines || []).filter(Boolean), action: settingsAction() } });

  /* 1. the app */
  add('browser', true, 'The EPINOIΛ app can receive notifications', n.version ? 'version ' + n.version + (n.build ? ' (' + n.build + ')' : '') : '');

  /* 2. what iOS allows, asked now rather than as the page loaded */
  const st = await nativeCall(n, 'push.status', {}, 5000);
  if (st) nativeRemember(n, st);
  const perm = nativePermission(n.permission);
  if (perm === 'denied') {
    add('permission', false, 'Notifications are turned off for EPINOIΛ on this iPhone');
    return advise('Allow notifications, then run the check again', SETTINGS[plat]);
  }
  if (perm !== 'granted') {
    add('permission', false, 'EPINOIΛ has not been allowed to send notifications yet');
    return advise('Turn notifications on', ['Tap Turn on above and choose Allow when your iPhone asks.']);
  }
  add('permission', true, 'Notifications are allowed for EPINOIΛ');

  /* 3. Apple's address for this iPhone: registered again when the app has none */
  let ep = nativeEndpoint(n, n.token);
  let made = '';
  if (!ep) {
    const r = await nativeCall(n, 'push.enable', {}, 25000);
    if (r) nativeRemember(n, r);
    ep = nativeEndpoint(n, n.token);
    if (ep) made = 'registered just now: it had no address';
  }
  if (!ep) {
    add('subscription', false, 'This iPhone has no notification address from Apple', MSG.nativeNoToken);
    return advise('Check the phone is online', ['Check the iPhone has a connection, then run the check again.',
      'If it keeps failing, close EPINOIΛ completely (swipe it away), open it again and run the check.']);
  }
  add('subscription', true, 'This iPhone is registered with Apple', made);

  /* 4. the account */
  const sess = await freshSession();
  if (!sess || !sess.userId) {
    add('account', false, 'You are not signed in on this iPhone', MSG.signedOut);
  } else {
    let row = await ownRow(ep, sess);
    let fixed = '';
    if (okStatus(row.status) && !row.row) {
      const saved = await saveNative(ep, sess);
      if (okStatus(saved)) { fixed = 'added just now: it was missing'; row = await ownRow(ep, sess); }
    } else if (row.row) {
      setNativeOn(ep);
    }
    if (row.row) add('account', true, 'This iPhone is on your account', fixed);
    else add('account', false, 'This iPhone could not be added to your account', row.status === 401 ? MSG.expired : MSG.save);
    const on = await accountPushOn(sess);
    if (on === false) add('channel', false, 'Phone and desktop alerts are switched off on your account', 'Tick Phone and desktop alerts below; tests still arrive, real notifications do not.');
    else if (on === true) add('channel', true, 'Phone and desktop alerts are on for your account');
    if (row.row && row.row.last_push_at && row.row.last_push_status != null && !(row.row.last_push_status >= 200 && row.row.last_push_status < 300)) {
      add('history', null, 'Before this check, the last notification to this iPhone was refused (' + row.row.last_push_status + ') at ' + clock(Date.parse(row.row.last_push_at)),
          String(row.row.last_push_error || '').slice(0, 160));
    }
  }

  /* 5. a push to this iPhone, through Apple */
  let arrival = waitForReceipt('check', RECEIPT_MS);
  let res = await deviceCheck(nativeSubFor(ep), sess);
  if (!res.ok && res.fix === 'resubscribe') {
    arrival.cancel();
    const r = await nativeCall(n, 'push.enable', {}, 25000);
    if (r) nativeRemember(n, r);
    const next = nativeEndpoint(n, n.token);
    if (next && next !== ep) {
      if (sess && sess.userId) await saveNative(next, sess);
      add('renewed', true, 'This iPhone’s address was out of date, so it registered again', res.text || '');
      ep = next;
      arrival = waitForReceipt('check', RECEIPT_MS);
      res = await deviceCheck(nativeSubFor(ep), sess);
    }
  }
  if (!res.ok) {
    arrival.cancel();
    const why = res.status === 429 ? 'A check has just run. Wait a few seconds and run it again.'
      : (res.text || res.error || MSG.testFailed) + (res.detail ? ' (' + String(res.detail).slice(0, 120) + ')' : '');
    add('delivery', false, 'The test push did not get through', why);
    return advise(res.fix === 'server' ? 'This is on Epinoia’s side, not your iPhone' : 'Try again in a minute',
                  [res.fix === 'server' ? 'Nothing on this iPhone needs changing. Try again later.' : 'If it keeps failing, tap Turn off, then Turn on, and run the check again.']);
  }
  add('delivery', true, 'Apple accepted a test push for this iPhone');

  /* 6. did it reach the app */
  const got = await arrival.promise;
  if (!got) {
    add('arrival', false, 'The test has not reached this iPhone after ' + Math.round(RECEIPT_MS / 1000) + ' seconds');
    return advise('The iPhone is not letting notifications through', ['Check the iPhone has a connection.'].concat(QUIET[plat], SETTINGS[plat]));
  }
  add('arrival', true, 'The test reached this iPhone at ' + clock(got.at || now()) + ' and was shown');
  if (steps.some(s => s.id === 'account' && s.ok === false)) {
    return advise(sess && sess.userId ? 'This iPhone works, but it is not on your account yet' : 'This iPhone works: sign in so it gets your notifications',
                  sess && sess.userId ? ['Run the check again in a minute. If it still fails, tap Turn off, then Turn on.']
                                      : ['Sign in on this iPhone with the email you use for Epinoia, then run the check again.']);
  }
  if (steps.some(s => s.id === 'channel' && s.ok === false)) {
    return advise('This iPhone works: switch on Phone and desktop alerts',
                  ['Tick Phone and desktop alerts below. Tests reach this iPhone either way, but real notifications are only sent while it is on.']);
  }
  return advise('Everything on Epinoia’s side works', [
    'If a notification titled “This phone can get notifications” did not appear just now, the iPhone is hiding them:'
  ].concat(SETTINGS[plat], QUIET[plat]));
}

/* ------------------------------------------------------------- the offer --- */
function snoozed() {
  const ls = storage();
  if (!ls) return false;
  try {
    const t = Number(ls.getItem(SNOOZE_KEY)) || 0;
    return t > 0 && now() - t < SNOOZE_MS;
  } catch (_) { return false; }
}
function snooze() {
  const ls = storage();
  try { if (ls) ls.setItem(SNOOZE_KEY, String(now())); } catch (_) { /* private mode: asked again next time */ }
}

/* 'ask' | 'install' to show; otherwise the reason it stays down */
async function decide() {
  if (!signedIn()) return 'signed-out';
  if (snoozed()) return 'snoozed';
  const st = await state();
  if (st === 'on' || st === 'denied' || st === 'unsupported') return st;
  return st === 'ios-install' ? 'install' : 'ask';
}

const FALLBACK = { team: 'this club', player: 'this player', game: 'this game' };
let sheet = null;

async function offer(opts) {
  const o = opts || {};
  const why = await decide();
  if (why !== 'ask' && why !== 'install') return { shown: false, why };
  const doc = g('document');
  if (!doc || !doc.body) return { shown: false, why: 'no-document', view: why };
  if (sheet) return { shown: false, why: 'already-open', view: why };
  openSheet(doc, why, String(o.name || FALLBACK[o.kind] || 'this'), o.kind);
  return { shown: true, why, view: why };
}

const CSS = [
  '.ep-push{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;',
  '--eps-bg:var(--panel,#0a1a13);--eps-ink:var(--ink,#e6fff1);--eps-ink2:var(--ink-2,rgba(230,255,241,.74));',
  '--eps-rule:var(--rule-2,rgba(147,242,191,.44));--eps-accent:var(--lume,#93f2bf);--eps-on:var(--on-accent,#04100b);--eps-bad:var(--flare,#ff5f6b);',
  'font-family:var(--f-ui,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);-webkit-text-size-adjust:100%}',
  ':root[data-theme="light"] .ep-push{--eps-bg:var(--panel,#ffffff);--eps-ink:var(--ink,#0d1f17);--eps-ink2:var(--ink-2,rgba(13,31,23,.82));',
  '--eps-rule:var(--rule-2,rgba(13,31,23,.4));--eps-accent:var(--lume,#0c7a54);--eps-on:var(--on-accent,#ffffff);--eps-bad:var(--flare,#c22f3e)}',
  '.ep-push-scrim{position:absolute;inset:0;background:rgba(2,10,7,.56);animation:ep-push-fade .2s ease-out}',
  '.ep-push-sheet{position:relative;box-sizing:border-box;width:100%;max-width:520px;max-height:92vh;overflow:auto;',
  'background:var(--eps-bg);color:var(--eps-ink);border:1px solid var(--eps-rule);border-bottom:0;border-radius:18px 18px 0 0;',
  'padding:10px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -14px 44px rgba(0,0,0,.35);',
  'animation:ep-push-up .26s cubic-bezier(.22,.9,.24,1)}',
  '.ep-push-sheet:focus{outline:none}',
  '.ep-push-grab{width:38px;height:4px;border-radius:2px;background:var(--eps-rule);margin:0 auto 14px}',
  '.ep-push-head{display:flex;gap:12px;align-items:center;margin:0 0 10px}',
  '.ep-push-ic{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:var(--eps-accent);',
  'background:rgba(147,242,191,.14);background:color-mix(in srgb,var(--eps-accent) 15%,transparent)}',
  '.ep-push-ic svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
  '.ep-push h2{margin:0;font-size:18px;line-height:1.3;font-weight:700;color:var(--eps-ink);overflow-wrap:anywhere}',
  '.ep-push p{margin:0 0 16px;font-size:15px;line-height:1.5;color:var(--eps-ink2)}',
  '.ep-push ol{margin:0 0 16px;padding-left:22px;font-size:15px;line-height:1.5;color:var(--eps-ink2)}',
  '.ep-push li{margin:5px 0}.ep-push li b{color:var(--eps-ink)}',
  '.ep-push a{color:var(--eps-accent)}',
  '.ep-push-msg{margin:0 0 14px;font-size:14px;line-height:1.5;color:var(--eps-ink)}',
  '.ep-push-msg.err{color:var(--eps-bad)}',
  '.ep-push-acts{display:flex;flex-direction:column;gap:8px}',
  '.ep-push-btn{-webkit-appearance:none;appearance:none;box-sizing:border-box;min-height:48px;width:100%;border-radius:12px;cursor:pointer;',
  'font:inherit;font-size:15px;font-weight:700;padding:12px 16px;border:1px solid var(--eps-rule);background:transparent;color:var(--eps-ink)}',
  '.ep-push-btn.pri{background:var(--eps-accent);border-color:var(--eps-accent);color:var(--eps-on)}',
  'a.ep-push-btn{display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none}',
  '.ep-push-btn:focus-visible{outline:2px solid var(--eps-accent);outline-offset:2px}',
  '.ep-push-btn[disabled]{opacity:.65;cursor:default}',
  '@media (min-width:600px){.ep-push{align-items:center;padding:16px}.ep-push-sheet{border-bottom:1px solid var(--eps-rule);border-radius:18px;',
  'padding:20px}.ep-push-grab{display:none}.ep-push-acts{flex-direction:row-reverse}.ep-push-btn{width:auto;flex:1 1 0}}',
  '@keyframes ep-push-up{from{transform:translateY(100%)}to{transform:none}}',
  '@keyframes ep-push-fade{from{opacity:0}to{opacity:1}}',
  '@media (prefers-reduced-motion:reduce){.ep-push-scrim,.ep-push-sheet{animation:none}}'
].join('');

/* THE ANDROID APP, WHERE ALERTS POP UP. nav.js (window.EpinoiaAppPromo) knows by the time a sheet
   opens whether this is an Android browser and the app is out; a page without nav.js (a league
   website's embed) has no answer, and the sheet says nothing about the app. { href } or null. */
function androidApp() {
  const a = phoneApp();
  return a && a.platform === 'android' ? { href: a.href } : null;
}
/* THE APP FOR THE PHONE IN HAND: the Android app on an Android browser, the iPhone app on an
   iPhone (kind 'ios-app', once it is out), never the other one. { href, platform } or null. */
function phoneApp() {
  const P = g('EpinoiaAppPromo');
  try {
    const p = P && typeof P.current === 'function' ? P.current() : null;
    if (p && p.kind === 'android') return { href: P.href(p), platform: 'android' };
    if (p && p.kind === 'ios-app') return { href: P.href(p), platform: 'iphone' };
    return null;
  } catch (_) { return null; }
}
const APP_NAME = { android: 'the EPINOIΛ app for Android', iphone: 'the EPINOIΛ app for iPhone' };

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';

function openSheet(doc, view, name, kind) {
  if (!doc.getElementById('ep-push-css')) {
    const st = doc.createElement('style');
    st.id = 'ep-push-css';
    st.textContent = CSS;
    (doc.head || doc.body).appendChild(st);
  }
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const before = doc.activeElement;
  const wrap = el('div', 'ep-push');
  const scrim = el('div', 'ep-push-scrim');
  const box = el('div', 'ep-push-sheet');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'ep-push-h');
  box.setAttribute('aria-describedby', 'ep-push-d');
  box.tabIndex = -1;
  wrap.append(scrim, box);

  function close(remember) {
    if (!sheet) return;
    if (remember) snooze();
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus, true);
    wrap.remove();
    sheet = null;
    try { if (before && typeof before.focus === 'function' && doc.contains(before)) before.focus(); } catch (_) { /* gone */ }
  }
  const focusables = () => [...box.querySelectorAll('button:not([disabled]), a[href]')];
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(true); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    const first = f[0], last = f[f.length - 1], at = doc.activeElement;
    if (e.shiftKey && (at === first || !box.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
  }
  function onFocus(e) {
    if (!box.contains(e.target)) { const f = focusables(); (f[0] || box).focus(); }
  }
  scrim.addEventListener('click', () => close(true));

  function head(title) {
    const h = el('div', 'ep-push-head');
    const ic = el('span', 'ep-push-ic'); ic.innerHTML = BELL;          // a fixed icon, no data in it
    const h2 = el('h2', null, title); h2.id = 'ep-push-h';
    h.append(ic, h2);
    return h;
  }
  function button(text, cls, fn) {
    const b = el('button', 'ep-push-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function draw(parts, acts) {
    box.textContent = '';
    box.appendChild(el('div', 'ep-push-grab'));
    parts.forEach(p => box.appendChild(p));
    const a = el('div', 'ep-push-acts');
    acts.forEach(b => a.appendChild(b));
    box.appendChild(a);
    (acts[0] || box).focus();
  }
  const lead = kind === 'player'
    ? 'Reminders before ' + name + ' plays, whether they start, and their line at half-time and full time, on this phone.'
    : 'Tip-off reminders 2 days and 2 hours before, starting lineups, the half-time score and the result, on this phone.';

  function ask(message) {
    const d = el('p', null, lead); d.id = 'ep-push-d';
    const parts = [head('Get notified about ' + name + '?'), d];
    const app = phoneApp();
    if (app) {
      const t = el('p', null, 'Alerts pop up most reliably in ' + APP_NAME[app.platform] + '. ');
      const a = el('a', null, 'Get the app'); a.href = app.href;
      t.appendChild(a);
      parts.push(t);
    }
    if (message) parts.push(el('p', 'ep-push-msg err', message));
    const on = button('Turn on notifications', 'pri', () => {
      /* enable() is called inside this click, before anything is awaited */
      const pending = enable();
      on.disabled = true; later.disabled = true; on.textContent = 'Turning on…';
      pending.then(r => {
        if (!sheet) return;
        if (r.ok) return verify();
        if (r.state === 'denied' || r.state === 'unsupported' || r.state === 'ios-install') return stop(r.message);
        ask(r.message);
      });
    });
    const later = button('Not now', null, () => close(true));
    draw(parts, [on, later]);
  }
  /* ON IS NOT DONE UNTIL THE PERSON HAS SEEN ONE. A test goes straight out, and the sheet
     asks whether it popped up: a phone that hides it gets its own settings to change and
     another test, instead of a "notifications are on" that turns out not to be true. */
  function verify() {
    const d = el('p', null, 'Sending a test notification to this phone…'); d.id = 'ep-push-d';
    draw([head('Checking this phone'), d], []);
    test().then(r => {
      if (!sheet) return;
      if (r.ok) return seen();
      const m = el('p', 'ep-push-msg err', r.message); m.id = 'ep-push-d';
      draw([head('Notifications are on, but the test did not arrive'), m],
           [button('Try again', 'pri', verify), button('Close', null, () => close(false))]);
    }, () => { if (sheet) done(); });
  }
  function seen() {
    const d = el('p', null, 'Epinoia just sent “Notifications are on” to this phone.'); d.id = 'ep-push-d';
    draw([head('Did a notification pop up?'), d],
         [button('Yes, it did', 'pri', done), button('No', null, hidden)]);
  }
  function hidden() {
    const d = el('p', null, 'It reached your phone, but a phone setting stopped it popping up. Change these, then send another:');
    d.id = 'ep-push-d';
    const ol = el('ol');
    const h = help();
    h.steps.forEach(s => ol.appendChild(el('li', null, s)));
    const acts = [button('Send another test', 'pri', verify)];
    /* in the Android app, straight into its own notification settings */
    if (h.action) {
      const a = el('a', 'ep-push-btn', h.action.label);
      a.href = h.action.href;
      a.addEventListener('click', settingsOpened);
      acts.push(a);
    }
    /* in an Android browser, the way out of browser settings altogether: the app posts its
       alerts itself, on its own channel that pops up */
    const parts = [head('Your phone is hiding it'), d, ol];
    const app = phoneApp();
    if (app) {
      parts.push(el('p', null, 'Or skip the browser’s settings: in ' + APP_NAME[app.platform] + ', alerts pop up on their own.'));
      const a = el('a', 'ep-push-btn', 'Get the EPINOIΛ app');
      a.href = app.href;
      acts.push(a);
    }
    acts.push(button('Close', null, () => close(false)));
    draw(parts, acts);
  }
  function done() {
    const d = el('p', null, 'You’ll hear about ' + name + ' on this phone. ');
    d.id = 'ep-push-d';
    const a = el('a', null, 'Choose what you get'); a.href = PROFILE;
    d.appendChild(a);
    draw([head('Notifications are on'), d], [button('Done', 'pri', () => close(false))]);
  }
  function stop(message) {
    const d = el('p', 'ep-push-msg err', message); d.id = 'ep-push-d';
    draw([head('Get notified about ' + name + '?'), d], [button('Close', 'pri', () => close(true))]);
  }
  function install() {
    /* ONCE THE IPHONE APP IS OUT, it is the answer: alerts through Apple, no Home Screen steps */
    const app = phoneApp();
    if (app && app.platform === 'iphone') {
      const p = el('p', null, 'On iPhone, notifications come through the EPINOIΛ app. Get it free from the App Store, sign in, and follow ' + name + ' there.');
      p.id = 'ep-push-d';
      const a = el('a', 'ep-push-btn pri', 'Get the EPINOIΛ app');
      a.href = app.href;
      draw([head('Get notified about ' + name + '?'), p], [a, button('Not now', null, () => close(true))]);
      return;
    }
    const d = el('p', null, 'On iPhone and iPad, notifications come through EPINOIΛ on your Home Screen:');
    d.id = 'ep-push-d';
    const ol = el('ol');
    /* strings are text; an array is [bold words] */
    const step = (...bits) => {
      const li = el('li');
      bits.forEach(b => li.append(Array.isArray(b) ? el('b', null, b[0]) : b));
      ol.appendChild(li);
    };
    step('Tap ', ['Share'], ' (the square with an arrow).');
    step('Choose ', ['Add to Home Screen'], '.');
    step('Open ', ['EPINOIΛ'], ' from your Home Screen, and sign in if it asks.');
    step('Follow ' + name + ' again and turn notifications on.');
    draw([head('Get notified about ' + name + '?'), d, ol], [button('Got it', 'pri', () => close(true))]);
  }

  sheet = wrap;
  doc.body.appendChild(wrap);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus, true);
  if (view === 'install') install(); else ask('');
}

return {
  state, enable, disable, test, sync, check, offer, help, inApp, endpoint, settingsOpened, appBlocked,
  inIOSApp: () => !!iosApp(),
  MESSAGES: MSG, SW_URL, SCOPE,
  /* read when used: in the iPhone app it is the app's own link, not the Android intent */
  get settingsIntent() { return iosApp() ? NATIVE_SETTINGS : SETTINGS_INTENT; },
  _test: {
    iosApp, nativeEndpoint, nativePermission, IOS_ON_KEY, NATIVE_SETTINGS,
    env(e) { ENV = e || null; },
    quick, keyBytes, sameKey, isIOS, iosVersion, decide, snoozed, snooze, storedSession,
    subscriptionRow, SNOOZE_KEY, SNOOZE_MS, platform, SETTINGS, QUIET, serviceName, RECEIPT_MS,
    clientKind, launchState, launchStale, IMPORTANCE_HIGH, SETTINGS_OPENED_KEY, androidApp, phoneApp,
    close() { if (sheet) { sheet.remove(); sheet = null; } }
  }
};
}));
