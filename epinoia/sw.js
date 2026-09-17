/* ============================================================================
   Epinoia service worker — the phone side of notifications.
   Version: notifications v2, 2026-09-17 (docs/notifications.md §5). Any byte
   changed here is a new worker to the browser; this line is the one to bump.

   Registered by nav.js on every page and by push.js when a fan turns notifications
   on (the same URL, /epinoia/sw.js, scope /epinoia/). It does these things:
     push                    shows what the notify function sent — the title, the
                             body, the lock-screen slot (tag), the buttons (actions) —
                             and tells any open Epinoia page that it arrived, so the
                             profile page's check can tell "never reached this phone"
                             from "reached it, and the phone did not show it"
     message                 answers the profile page's ping with this worker's version
     notificationclick       opens the page the notice is about, in a tab already on
                             Epinoia when there is one, else in a new window
     pushsubscriptionchange  when the browser rotates the subscription, takes a new
                             one and tells the database which row it replaces
     fetch                   page loads only: when one fails for want of a connection, a
                             small offline page (status 200) instead of the browser's error.
                             Every other request is left to the browser, so a JSON caller
                             sees a real network error, never an HTML page
   No caching: the site is served exactly as before.

   The decisions are small pure functions (notificationFor, actionUrl, clickTarget,
   pickClient, swapBody) so supabase/tests/push.test.mjs can run this file in node
   with a stubbed `self` and check them.
   ============================================================================ */
const SW_VERSION = 'notifications-v2-2026-09-17-offline';
const SITE_PATH = '/epinoia/';
/* A NOTICE WITH NOWHERE OF ITS OWN TO GO OPENS HOME, not the splash. A tap that opens a fresh
   window carries no ?source=, no referrer and no stored app flag, so nothing downstream could
   tell it came from the app and keep it off the water page; HOME is right on the web and in
   the app alike. SITE_PATH stays the site's root: relative links resolve under it, and
   pickClient uses it to recognise a window that is already on Epinoia. */
const HOME_PATH = '/epinoia/home/';
/* THE PICTURE ON A NOTIFICATION IS THE APP'S LOGO, the blue EPINOIΛ square the Android app
   wears (tools/build-android-icons.py writes both), not the old black mark: on a phone it sits
   right beside the app's own icon. A league's crest in the payload still takes its place. */
const ICON = '/epinoia/brand/epinoia-app-192.png';
/* THE BADGE IS A SILHOUETTE. Android draws a badge from its alpha channel alone, so the 32px
   colour mark (an opaque rounded square) showed as a blank white tile in the status bar; this
   is the Λ in white on a transparent ground. */
const BADGE = '/epinoia/brand/epinoia-badge-96.png';
/* PUBLIC VALUES, COPIED FROM epinoia/config.js. A service worker cannot read
   config.js (it runs without the page), so they are written in here; push.test.mjs
   fails if these and config.js ever disagree. The publishable key and the VAPID
   public key are designed to be published — neither grants anything on its own. */
const SUPABASE_URL = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';
const VAPID_PUBLIC_KEY = 'BLskwAuRGoAJnRcYe0gyLE5R0otKhcvu8fL5UxE06ep_VGzxfbirqziIS4uu3N6BmQob4Vl9vSiokUuVKpa7toM';

self.addEventListener('install', () => self.skipWaiting());
/* A fetch handler makes the app installable. Nothing is cached here on purpose: a live score
   served from yesterday's cache would be worse than no app at all, and the pages already carry
   their own version stamps.

   ONLY A PAGE LOAD IS ANSWERED, and only when it fails. It used to be every GET: a Supabase
   read that failed offline came back as a 503 HTML page, and code waiting for JSON reported a
   parse error instead of "no connection". Requests the worker does not answer go to the
   network exactly as if there were no worker. The offline page is status 200, as Chrome's
   Trusted Web Activity quality checks ask of an offline launch, in light (the default) or
   dark as the phone is set; it cannot read the site's own theme choice, which lives in the
   page's storage. */
function offlinePage() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><title>Offline · Epinoia</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;padding:16px;box-sizing:border-box;' +
    'background:#f3faf6;color:#0d1f17;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    'b{display:block;font-size:22px;font-weight:800}p{margin:8px 0 20px;opacity:.78;line-height:1.5}' +
    'a{display:inline-block;padding:12px 22px;border-radius:12px;background:#0c7a54;color:#fff;font-weight:700;text-decoration:none}' +
    '@media (prefers-color-scheme:dark){body{background:#04100b;color:#e6fff1}a{background:#93f2bf;color:#04100b}}</style>' +
    '<body><div><b>Epinoia is offline</b><p>Nothing is stored on this phone. Connect, then try again.</p><a href="">Try again</a></div></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (!req || req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith(fetch(req).catch(() => offlinePage()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* ------------------------------------------------------------------ push --- */
function readPayload(data) {
  if (!data) return {};
  try {
    const j = data.json();
    return j && typeof j === 'object' ? j : {};
  } catch (_) {
    let t = '';
    try { t = data.text(); } catch (_) { t = ''; }
    return { title: 'EPINOIΛ', body: t };
  }
}

/* The page a button opens. "See lineups" on a lineups notice lands on the starting
   fives (the link already says show=starters; it is added if a link ever does not);
   "Box score" on a result, and anything else, opens the notice's own page. */
function actionUrl(kind, action, url) {
  if (kind === 'lineups' && action === 'starters' && !/[?&]show=starters(?:[&#]|$)/.test(url)) {
    const hash = url.indexOf('#');
    const base = hash < 0 ? url : url.slice(0, hash);
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'show=starters' + (hash < 0 ? '' : url.slice(hash));
  }
  /* "Box score" lands on the box score: a finished game otherwise opens on its report
     (and a half-time notice tapped after full time is a finished game) */
  if ((kind === 'result' || kind === 'halftime') && action === 'box' && !/[?&]tab=/.test(url)) {
    const hash = url.indexOf('#');
    const base = hash < 0 ? url : url.slice(0, hash);
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'tab=box' + (hash < 0 ? '' : url.slice(hash));
  }
  return url;
}

/* payload {title, body, url, tag, renotify, kind, timestamp, actions} -> the two
   arguments showNotification takes */
function notificationFor(payload) {
  const d = payload && typeof payload === 'object' ? payload : {};
  const url = typeof d.url === 'string' && d.url ? d.url : HOME_PATH;
  const kind = typeof d.kind === 'string' ? d.kind : '';
  const tag = typeof d.tag === 'string' && d.tag ? d.tag : '';
  const actions = (Array.isArray(d.actions) ? d.actions : [])
    .filter(a => a && typeof a.action === 'string' && a.action && typeof a.title === 'string' && a.title)
    .slice(0, 2)
    .map(a => ({ action: a.action, title: a.title }));
  const map = {};
  actions.forEach(a => { map[a.action] = actionUrl(kind, a.action, url); });
  const options = {
    body: typeof d.body === 'string' ? d.body : String(d.body == null ? '' : d.body),
    /* a league's crest, for a notification button's subscriber (docs/notify-embed.md §6) */
    icon: typeof d.icon === 'string' && /^https:\/\/[^\s]+$/.test(d.icon) ? d.icon : ICON,
    badge: BADGE,
    vibrate: [80, 40, 80],
    data: { url, kind, actions: map }
  };
  /* renotify without a tag is a TypeError in showNotification, and a notice that
     throws is a notice nobody sees */
  if (tag) {
    options.tag = tag;
    if (d.renotify) options.renotify = true;
  }
  const ts = Number(d.timestamp);
  if (Number.isFinite(ts) && ts > 0) options.timestamp = ts;
  if (actions.length) options.actions = actions;
  return { title: typeof d.title === 'string' && d.title ? d.title : 'EPINOIΛ', options };
}

/* Tells every open Epinoia page that a push arrived and whether the browser agreed to
   show it. The profile page's check waits for this: a push that arrives and is shown,
   yet never seen, is the phone's notification settings, not the site. Best effort — a
   receipt never delays or blocks the notification itself. */
function receipt(kind, tag, shown, error) {
  let list;
  try { list = self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (_) { return Promise.resolve(); }
  return Promise.resolve(list).then(cs => (cs || []).forEach(c => {
    if (c && typeof c.postMessage === 'function') {
      try { c.postMessage({ type: 'epinoia-push', kind, tag, shown, error: error || '', at: Date.now(), version: SW_VERSION }); } catch (_) { /* gone */ }
    }
  })).catch(() => {});
}

self.addEventListener('push', e => {
  const n = notificationFor(readPayload(e.data));
  /* A browser that rejects an option (actions, vibrate) still shows the words: a
     push that shows nothing is the one thing a push must never do. */
  e.waitUntil(Promise.resolve()
    .then(() => self.registration.showNotification(n.title, n.options))
    .catch(() => self.registration.showNotification(n.title, {
      body: n.options.body, icon: n.options.icon, badge: n.options.badge,
      tag: n.options.tag, data: n.options.data
    }))
    .then(() => receipt(n.options.data.kind, n.options.tag || '', true, ''),
          err => receipt(n.options.data.kind, n.options.tag || '', false, String((err && err.message) || err || 'not shown'))));
});

/* the profile page asks which worker is running (a phone can hold on to an old one) */
self.addEventListener('message', e => {
  const d = e && e.data;
  if (!d || d.type !== 'epinoia-ping') return;
  const reply = { type: 'epinoia-pong', version: SW_VERSION, id: d.id || null };
  try {
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source && typeof e.source.postMessage === 'function') e.source.postMessage(reply);
  } catch (_) { /* the page went away */ }
});

/* --------------------------------------------------------------- the tap --- */
/* Where a tap goes: the button's page, else the notice's page, else HOME.
   Relative links resolve under /epinoia/; anything that is not http(s) goes to HOME.
   THE SITE'S OWN ROOT IS HOME TOO. A notify deployed before HOME existed sends rows with no
   link to https://<site>/epinoia/, the splash with the water; this site's /epinoia/ (or
   /epinoia/index.html) with no league asked for goes to HOME, keeping the query and hash. */
function clickTarget(data, action, origin) {
  const d = data && typeof data === 'object' ? data : {};
  const map = d.actions && typeof d.actions === 'object' ? d.actions : {};
  const raw = (action && typeof map[action] === 'string' && map[action]) ||
              (typeof d.url === 'string' && d.url) || HOME_PATH;
  const home = origin + HOME_PATH;
  try {
    const u = new URL(raw, origin + SITE_PATH);
    if (!/^https?:$/.test(u.protocol)) return home;
    if (u.origin === origin && /^\/epinoia\/(index\.html)?$/.test(u.pathname) && !u.searchParams.get('l')) {
      u.pathname = HOME_PATH;
    }
    return u.href;
  } catch (_) { return home; }
}

/* An open window already on Epinoia: the focused one, else a visible one, else any. */
function pickClient(list, origin) {
  const prefix = origin + SITE_PATH;
  const mine = (list || []).filter(c => c && typeof c.url === 'string' && c.url.indexOf(prefix) === 0);
  return mine.find(c => c.focused) || mine.find(c => c.visibilityState === 'visible') || mine[0] || null;
}

async function openAt(target, origin) {
  const [all, controlled] = await Promise.all([
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
    self.clients.matchAll({ type: 'window' })
  ]);
  const c = pickClient(all, origin);
  const mine = c && (controlled || []).some(x => x === c || (x && c.id && x.id === c.id));
  /* navigate() only works on a window this worker controls, and only within the site */
  if (c && mine && typeof c.navigate === 'function' && target.indexOf(origin + '/') === 0) {
    try {
      /* focus first, while the tap still allows it (Firefox gives a second); the
         navigation can take longer than that on a slow connection */
      if (typeof c.focus === 'function') { try { await c.focus(); } catch (_) { /* navigate anyway */ } }
      const w = await c.navigate(target);
      if (w && typeof w.focus === 'function') { try { await w.focus(); } catch (_) { /* already in front */ } }
      return w || c;
    } catch (_) { /* fall through to a new window */ }
  }
  return self.clients.openWindow(target);
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const origin = self.location.origin;
  const target = clickTarget(e.notification.data, e.action, origin);
  e.waitUntil(openAt(target, origin));
});

/* ------------------------------------------------ a rotated subscription --- */
function keyBytes(k) {
  const s = String(k || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* the body swap_push_subscription(p_old, p_endpoint, p_p256dh, p_auth) takes, or
   null when either side is missing what identifies it */
function swapBody(oldEndpoint, sub) {
  if (!oldEndpoint || !sub) return null;
  const j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
  const keys = (j && j.keys) || {};
  const endpoint = sub.endpoint || (j && j.endpoint);
  if (!endpoint || !keys.p256dh || !keys.auth) return null;
  return { p_old: String(oldEndpoint), p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth };
}

/* The old endpoint (an unguessable URL) is the credential: the database swaps only
   the row that holds it. Without one — Chrome often sends none — the new
   subscription is still taken, and the profile page saves it on the next visit
   (push.js sync). */
async function resubscribe(oldSub, newSub) {
  let next = newSub || null;
  if (!next) {
    const opts = oldSub && oldSub.options;
    const key = (opts && opts.applicationServerKey) || keyBytes(VAPID_PUBLIC_KEY);
    next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const body = swapBody(oldSub && oldSub.endpoint, next);
  if (!body) return false;
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/swap_push_subscription', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return !!(r && r.ok);
}

self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(resubscribe(e.oldSubscription || null, e.newSubscription || null).catch(() => false));
});

/* node only (push.test.mjs); a service worker has no `module` */
if (typeof module === 'object' && module && module.exports) {
  module.exports = { SW_VERSION, SITE_PATH, HOME_PATH, ICON, BADGE, SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY,
                     readPayload, actionUrl, notificationFor, clickTarget, pickClient, swapBody, keyBytes, resubscribe, openAt, receipt,
                     offlinePage };
}
