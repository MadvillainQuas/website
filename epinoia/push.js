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
     test()             -> Promise<{ok, message}>
     sync()             -> Promise<{ok, state}>   re-saves this phone's subscription
     check(onStep?)     -> Promise<{ok, steps, advice, platform}>   the step-by-step
                           answer to "why is nothing arriving?" (docs/notifications.md §7)
     offer({name, kind})-> Promise<{shown, why, view?}>

   WHAT "ON" MEANS: this browser has granted permission AND holds a push
   subscription on the /epinoia/ service worker. Whether the account wants pushes
   at all is fan_prefs.notify_push, which enable() switches on.

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

const MSG = Object.freeze({
  unsupported: 'This browser cannot receive notifications. On a phone, use Chrome or Samsung Internet on Android, or Epinoia from the Home Screen on an iPhone.',
  iosInstall: 'On iPhone and iPad, notifications only arrive through Epinoia on your Home Screen. Tap Share, then Add to Home Screen, open Epinoia from there and turn notifications on.',
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
  testArrived: 'The test reached this phone.',
  testNotShown: 'The test reached this phone, but it was not allowed to show. Tap Check this phone for the settings to change.',
  testNotArrived: 'The push service accepted the test, but it has not reached this phone yet. Tap Check this phone to find out why.',
  runCheck: 'Tap Check this phone to put it right.'
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

/* Everything that can be known without waiting: 'unsupported', 'ios-install',
   'denied', or the permission ('granted' / 'default'). Synchronous on purpose —
   enable() runs it inside the tap. */
function quick() {
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
  const r = reg || await registration();
  if (!r || !r.pushManager) return null;
  try { return (await r.pushManager.getSubscription()) || null; } catch (_) { return null; }
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
async function call(url, init) {
  const f = g('fetch');
  if (typeof f !== 'function') throw new Error('no network');
  const AC = g('AbortController');
  const ctl = typeof AC === 'function' ? new AC() : null;
  const t = ctl ? setTimeout(() => { try { ctl.abort(); } catch (_) { /* gone */ } }, FETCH_MS) : null;
  try {
    return await f.call(root, url, ctl ? Object.assign({}, init, { signal: ctl.signal }) : init);
  } finally { if (t) clearTimeout(t); }
}
const okStatus = s => s >= 200 && s < 300;

function subscriptionRow(sub, userId) {
  const j = (sub && typeof sub.toJSON === 'function') ? sub.toJSON() : (sub || {});
  const keys = (j && j.keys) || {};
  const nav = g('navigator') || {};
  return {
    user_id: userId,
    endpoint: (sub && sub.endpoint) || j.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    ua: String(nav.userAgent || '').slice(0, 200)
  };
}
/* the status, or 0 when the request never got an answer */
async function saveSubscription(sub, sess) {
  try {
    const r = await call(cfg().supabaseUrl + '/rest/v1/push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: Object.assign(headers(sess.token), { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify(subscriptionRow(sub, sess.userId))
    });
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
async function setNotifyPush(on, sess) {
  try {
    const r = await call(cfg().supabaseUrl + '/rest/v1/rpc/set_fan_prefs', {
      method: 'POST', headers: headers(sess.token), body: JSON.stringify({ p: { notify_push: !!on } })
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
  /* --- everything decided before the first await: the tap is still ours --- */
  const q = quick();
  if (q === 'unsupported') return result(false, 'unsupported', MSG.unsupported);
  if (q === 'ios-install') return result(false, 'ios-install', MSG.iosInstall);
  if (q === 'denied') return result(false, 'denied', MSG.denied);
  if (!keyBytes(vapid())) return result(false, 'off', MSG.notConfigured);
  if (!signedIn()) return result(false, 'off', MSG.signedOut);

  const N = g('Notification');
  const perm = await requestPermission(N);
  if (perm === 'denied') return result(false, 'denied', MSG.denied);
  if (perm !== 'granted') return result(false, 'off', MSG.dismissed);

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
   worker to say it arrived. */
async function test() {
  const sess = await freshSession();
  if (!sess) return { ok: false, message: MSG.signedOut };
  const reg = await registration();
  const sub = await currentSubscription(reg);
  if (sub && quick() === 'granted') await sync().catch(() => null);
  const arrival = sub ? waitForReceipt('test', RECEIPT_MS) : null;
  let r;
  try {
    r = await call(cfg().supabaseUrl + '/functions/v1/notify', {
      method: 'POST', headers: headers(sess.token), body: JSON.stringify({ test: true, endpoint: sub ? sub.endpoint : '' })
    });
  } catch (_) { if (arrival) arrival.cancel(); return { ok: false, message: MSG.testOffline }; }
  let data = {};
  try { data = (await r.json()) || {}; } catch (_) { data = {}; }
  if (r.status === 401) { if (arrival) arrival.cancel(); return { ok: false, message: MSG.expired }; }
  if (!r.ok) { if (arrival) arrival.cancel(); return { ok: false, message: MSG.testFailed }; }
  const devices = Array.isArray(data.devices) ? data.devices : [];
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
  const nav = g('navigator') || {};
  const ua = String(nav.userAgent || '');
  const app = standalone();
  if (isIOS(nav)) return app ? 'ios-app' : 'ios-safari';
  if (/Android/i.test(ua)) {
    /* Samsung Internet's installed app still has its notifications posted by Samsung Internet,
       so its fixes are Samsung's, not App info's */
    if (/SamsungBrowser/i.test(ua)) return app ? 'android-samsung-app' : 'android-samsung';
    return app ? 'android-app' : 'android-chrome';
  }
  return 'desktop';
}
const SETTINGS = Object.freeze({
  'android-app': ['Press and hold the Epinoia icon on your Home Screen, then tap App info.',
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
  'android-samsung-app': ['In the phone’s Settings, open Notifications, then App notifications, and turn on both Epinoia and Samsung Internet.',
                          'Tap each of them there and set every category to Alert rather than Silent.',
                          'In Settings, open Notifications, then Notification pop-up style, and choose Detailed (Brief only lights the edge of the screen).',
                          'In Settings, open Battery (or Battery and device care), then Background usage limits, and take Epinoia and Samsung Internet out of Sleeping apps and Deep sleeping apps.',
                          'In Samsung Internet, open the menu, then Settings, then Sites and downloads, then Notifications: prophesyscouting.co.uk must be allowed.'],
  'ios-app': ['Open the Settings app, then Notifications, then Epinoia.', 'Turn on Allow Notifications, and choose Lock Screen and Banners.'],
  'ios-safari': ['Notifications only arrive through Epinoia on your Home Screen: tap Share, then Add to Home Screen, and open it from there.'],
  desktop: ['Click the icon to the left of the address, open the site settings for prophesyscouting.co.uk and allow Notifications.',
            'Check your computer lets the browser show notifications (on Windows: Settings, then System, then Notifications).']
});
const QUIET = Object.freeze({
  'android-app': ['Check the phone is not in Do Not Disturb, and that Battery for Epinoia (App info, then Battery) is not Restricted.'],
  'android-chrome': ['Check the phone is not in Do Not Disturb, and that Battery for Chrome (Settings, then Apps, then Chrome, then Battery) is not Restricted.'],
  'android-samsung': ['Check the phone is not in Do Not Disturb.'],
  'android-samsung-app': ['Check the phone is not in Do Not Disturb.'],
  'ios-app': ['Check Focus or Do Not Disturb is off.'],
  'ios-safari': [],
  desktop: ['Check Focus assist or Do Not Disturb is off.']
});

/* THE FIX FOR A NOTIFICATION THAT ARRIVED BUT WAS NEVER SEEN. The browser reports a push
   as shown once it has handed it to the phone; whether the phone then puts it on screen is
   the phone's settings, and nothing tells the page. So after every test the person is asked
   whether it popped up, and a no gets these steps for their phone, then another test. */
function help() {
  const plat = platform();
  return { platform: plat, steps: (SETTINGS[plat] || []).concat(QUIET[plat] || []) };
}

/* A promise for the next receipt from this phone's worker with the given tag, and a
   way to stop listening. Resolves null when none arrives in time. */
function waitForReceipt(tag, ms) {
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
  const steps = [];
  const plat = platform();
  const report = (extra) => Object.assign({ ok: steps.length > 0 && steps.every(s => s.ok !== false), steps, platform: plat }, extra);
  const add = (id, ok, label, detail) => {
    steps.push({ id, ok, label, detail: detail || '' });
    if (typeof onStep === 'function') { try { onStep(steps.slice()); } catch (_) { /* the page's problem */ } }
  };
  const advise = (title, lines) => report({ advice: { title, lines: (lines || []).filter(Boolean) } });

  /* 1. the browser */
  const q = quick();
  if (q === 'unsupported') {
    add('browser', false, 'This browser cannot receive notifications', MSG.unsupported);
    return advise('Use a browser that can', [/Android/i.test(String((g('navigator') || {}).userAgent || ''))
      ? 'Open prophesyscouting.co.uk/epinoia/me/ in Chrome or Samsung Internet (not inside another app), then run the check again.'
      : MSG.unsupported]);
  }
  if (q === 'ios-install') {
    add('browser', false, 'On iPhone, notifications need Epinoia on your Home Screen', MSG.iosInstall);
    return advise('Add Epinoia to your Home Screen', SETTINGS['ios-safari']);
  }
  add('browser', true, 'This browser can receive notifications');

  /* 2. permission */
  if (q === 'denied') {
    add('permission', false, 'Notifications are blocked for Epinoia on this phone');
    return advise('Allow notifications, then run the check again', SETTINGS[plat]);
  }
  if (q !== 'granted') {
    add('permission', false, 'Epinoia has not been allowed to send notifications yet');
    return advise('Turn notifications on', ['Tap Turn on above and choose Allow when the phone asks.',
      'If nothing asks, allow them in settings instead:'].concat(SETTINGS[plat]));
  }
  add('permission', true, 'Notifications are allowed for Epinoia');

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
  if (quick() !== 'granted') return { ok: false, state: await state() };
  const reg = await registration();
  const sub = await currentSubscription(reg);
  if (!sub) return { ok: false, state: 'off' };
  const sess = await freshSession();
  if (!sess || !sess.userId) return { ok: false, state: 'on' };
  return { ok: okStatus(await saveOrReplace(reg, sub, sess)), state: 'on' };
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
  '.ep-push-btn:focus-visible{outline:2px solid var(--eps-accent);outline-offset:2px}',
  '.ep-push-btn[disabled]{opacity:.65;cursor:default}',
  '@media (min-width:600px){.ep-push{align-items:center;padding:16px}.ep-push-sheet{border-bottom:1px solid var(--eps-rule);border-radius:18px;',
  'padding:20px}.ep-push-grab{display:none}.ep-push-acts{flex-direction:row-reverse}.ep-push-btn{width:auto;flex:1 1 0}}',
  '@keyframes ep-push-up{from{transform:translateY(100%)}to{transform:none}}',
  '@keyframes ep-push-fade{from{opacity:0}to{opacity:1}}',
  '@media (prefers-reduced-motion:reduce){.ep-push-scrim,.ep-push-sheet{animation:none}}'
].join('');

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
    help().steps.forEach(s => ol.appendChild(el('li', null, s)));
    draw([head('Your phone is hiding it'), d, ol],
         [button('Send another test', 'pri', verify), button('Close', null, () => close(false))]);
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
    const d = el('p', null, 'On iPhone and iPad, notifications come through Epinoia on your Home Screen:');
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
    step('Open ', ['Epinoia'], ' from your Home Screen, and sign in if it asks.');
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
  state, enable, disable, test, sync, check, offer, help,
  MESSAGES: MSG, SW_URL, SCOPE,
  _test: {
    env(e) { ENV = e || null; },
    quick, keyBytes, sameKey, isIOS, iosVersion, decide, snoozed, snooze, storedSession,
    subscriptionRow, SNOOZE_KEY, SNOOZE_MS, platform, SETTINGS, QUIET, serviceName, RECEIPT_MS,
    close() { if (sheet) { sheet.remove(); sheet = null; } }
  }
};
}));
