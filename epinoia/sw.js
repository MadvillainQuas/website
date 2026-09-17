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
   No caching, no interception of fetches: the site is served exactly as before.

   The decisions are small pure functions (notificationFor, actionUrl, clickTarget,
   pickClient, swapBody) so supabase/tests/push.test.mjs can run this file in node
   with a stubbed `self` and check them.
   ============================================================================ */
const SW_VERSION = 'notifications-v2-2026-09-17-receipts';
const SITE_PATH = '/epinoia/';
const ICON = '/epinoia/brand/epinoia-mark-192.png';
const BADGE = '/epinoia/brand/epinoia-mark-32.png';
/* PUBLIC VALUES, COPIED FROM epinoia/config.js. A service worker cannot read
   config.js (it runs without the page), so they are written in here; push.test.mjs
   fails if these and config.js ever disagree. The publishable key and the VAPID
   public key are designed to be published — neither grants anything on its own. */
const SUPABASE_URL = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';
const VAPID_PUBLIC_KEY = 'BLskwAuRGoAJnRcYe0gyLE5R0otKhcvu8fL5UxE06ep_VGzxfbirqziIS4uu3N6BmQob4Vl9vSiokUuVKpa7toM';

self.addEventListener('install', () => self.skipWaiting());
/* A fetch handler makes the app installable; it passes every request straight through. Nothing
   is cached here on purpose: a live score served from yesterday's cache would be worse than no
   app at all, and the pages already carry their own version stamps. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;background:#04100b;color:#e6fff1;font-family:system-ui;display:grid;place-items:center;height:100vh;text-align:center">' +
    '<div><div style="font-size:22px;font-weight:800">Epinoia is offline</div><div style="opacity:.7;margin-top:8px">Nothing is stored on this phone; connect and try again.</div></div></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
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
    return { title: 'Epinoia', body: t };
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
  const url = typeof d.url === 'string' && d.url ? d.url : SITE_PATH;
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
    icon: ICON,
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
  return { title: typeof d.title === 'string' && d.title ? d.title : 'Epinoia', options };
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
/* Where a tap goes: the button's page, else the notice's page, else the front page.
   Relative links resolve under /epinoia/; anything that is not http(s) goes home. */
function clickTarget(data, action, origin) {
  const d = data && typeof data === 'object' ? data : {};
  const map = d.actions && typeof d.actions === 'object' ? d.actions : {};
  const raw = (action && typeof map[action] === 'string' && map[action]) ||
              (typeof d.url === 'string' && d.url) || SITE_PATH;
  const home = origin + SITE_PATH;
  try {
    const u = new URL(raw, home);
    return /^https?:$/.test(u.protocol) ? u.href : home;
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
  module.exports = { SW_VERSION, SITE_PATH, ICON, BADGE, SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY,
                     readPayload, actionUrl, notificationFor, clickTarget, pickClient, swapBody, keyBytes, resubscribe, openAt, receipt };
}
