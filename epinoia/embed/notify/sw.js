/* ============================================================================
   Epinoia notifications, on a league's own website (docs/notify-embed.md §3).

   A league that wants notifications to come from its own domain uploads one file
   to its site's root, /epinoia-sw.js:

       importScripts('https://prophesyscouting.co.uk/epinoia/embed/notify/sw.js');

   and its notification buttons register that file with the scope /epinoia-push/.
   This is what runs inside it:
     push                    shows what the notify function sent (title, body, the
                             lock-screen slot, the league's crest), and tells any
                             open page of the site that it arrived
     notificationclick       opens the notice's page (the league's own match page,
                             or Epinoia's), in a window of the site already open on
                             it when there is one
     pushsubscriptionchange  takes a new subscription when the browser rotates one,
                             and tells Epinoia which it replaces
     message                 answers a ping with this worker's version

   It is a GUEST on someone else's domain: no fetch handler (the site's own pages,
   and any service worker it has for them, are left exactly as they are), no cache,
   no storage. Everything it needs is in the push itself or below.

   The decisions are small pure functions so supabase/tests/notify-embed.test.mjs can
   run this file in node with a stubbed `self`.
   ============================================================================ */
const EMBED_SW_VERSION = 'notify-embed-2026-09-17';
const EPINOIA = 'https://prophesyscouting.co.uk/epinoia/';
const EMBED_ICON = EPINOIA + 'brand/epinoia-mark-192.png';
const EMBED_BADGE = EPINOIA + 'brand/epinoia-mark-32.png';
/* PUBLIC VALUES, COPIED FROM epinoia/config.js; the test fails if they drift. */
const EMBED_SUPABASE_URL = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
const EMBED_SUPABASE_KEY = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';
const EMBED_VAPID_PUBLIC_KEY = 'BLskwAuRGoAJnRcYe0gyLE5R0otKhcvu8fL5UxE06ep_VGzxfbirqziIS4uu3N6BmQob4Vl9vSiokUuVKpa7toM';

function embedReadPayload(data) {
  if (!data) return {};
  try {
    const j = data.json();
    return j && typeof j === 'object' ? j : {};
  } catch (_) {
    let t = '';
    try { t = data.text(); } catch (_) { t = ''; }
    return { title: 'Notification', body: t };
  }
}

const embedHttps = u => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u);

/* payload -> the two arguments showNotification takes. Links and icons are absolute:
   this worker runs on the league's domain, not Epinoia's. */
function embedNotificationFor(payload) {
  const d = payload && typeof payload === 'object' ? payload : {};
  const url = embedHttps(d.url) ? d.url : '';
  const tag = typeof d.tag === 'string' && d.tag ? d.tag : '';
  const options = {
    body: typeof d.body === 'string' ? d.body : String(d.body == null ? '' : d.body),
    icon: embedHttps(d.icon) ? d.icon : EMBED_ICON,
    badge: EMBED_BADGE,
    vibrate: [80, 40, 80],
    data: { url, kind: typeof d.kind === 'string' ? d.kind : '' }
  };
  if (tag) {
    options.tag = tag;
    if (d.renotify) options.renotify = true;
  }
  const ts = Number(d.timestamp);
  if (Number.isFinite(ts) && ts > 0) options.timestamp = ts;
  return { title: typeof d.title === 'string' && d.title ? d.title : 'Notification', options };
}

/* where a tap goes: the notice's page, else the site's own front page */
function embedTarget(data, origin) {
  const d = data && typeof data === 'object' ? data : {};
  return embedHttps(d.url) ? d.url : origin + '/';
}

function embedReceipt(kind, tag, shown, error) {
  let list;
  try { list = self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (_) { return Promise.resolve(); }
  return Promise.resolve(list).then(cs => (cs || []).forEach(c => {
    if (c && typeof c.postMessage === 'function') {
      try { c.postMessage({ type: 'epinoia-push', kind, tag, shown, error: error || '', at: Date.now(), version: EMBED_SW_VERSION }); } catch (_) { /* gone */ }
    }
  })).catch(() => {});
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  const n = embedNotificationFor(embedReadPayload(e.data));
  e.waitUntil(Promise.resolve()
    .then(() => self.registration.showNotification(n.title, n.options))
    .catch(() => self.registration.showNotification(n.title, { body: n.options.body, icon: n.options.icon, tag: n.options.tag, data: n.options.data }))
    .then(() => embedReceipt(n.options.data.kind, n.options.tag || '', true, ''),
          err => embedReceipt(n.options.data.kind, n.options.tag || '', false, String((err && err.message) || err || 'not shown'))));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const origin = self.location.origin;
  const target = embedTarget(e.notification.data, origin);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const same = (list || []).find(c => c && typeof c.url === 'string' && c.url === target && typeof c.focus === 'function');
    if (same) return same.focus();
    return self.clients.openWindow(target);
  }));
});

/* the body swap_push_subscription(p_old, p_endpoint, p_p256dh, p_auth) takes, or null */
function embedSwapBody(oldEndpoint, sub) {
  if (!oldEndpoint || !sub) return null;
  const j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
  const keys = (j && j.keys) || {};
  const endpoint = sub.endpoint || (j && j.endpoint);
  if (!endpoint || !keys.p256dh || !keys.auth) return null;
  return { p_old: String(oldEndpoint), p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth };
}
function embedKeyBytes(k) {
  const s = String(k || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function embedResubscribe(oldSub, newSub) {
  let next = newSub || null;
  if (!next) {
    const opts = oldSub && oldSub.options;
    const key = (opts && opts.applicationServerKey) || embedKeyBytes(EMBED_VAPID_PUBLIC_KEY);
    next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const body = embedSwapBody(oldSub && oldSub.endpoint, next);
  if (!body) return false;
  const r = await fetch(EMBED_SUPABASE_URL + '/rest/v1/rpc/swap_push_subscription', {
    method: 'POST', headers: { apikey: EMBED_SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return !!(r && r.ok);
}
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(embedResubscribe(e.oldSubscription || null, e.newSubscription || null).catch(() => false));
});

self.addEventListener('message', e => {
  const d = e && e.data;
  if (!d || d.type !== 'epinoia-ping') return;
  const reply = { type: 'epinoia-pong', version: EMBED_SW_VERSION, id: d.id || null };
  try {
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source && typeof e.source.postMessage === 'function') e.source.postMessage(reply);
  } catch (_) { /* the page went away */ }
});

/* node only (notify-embed.test.mjs) */
if (typeof module === 'object' && module && module.exports) {
  module.exports = { EMBED_SW_VERSION, EMBED_ICON, EMBED_BADGE, EMBED_SUPABASE_URL, EMBED_SUPABASE_KEY, EMBED_VAPID_PUBLIC_KEY,
                     embedReadPayload, embedNotificationFor, embedTarget, embedReceipt, embedSwapBody, embedResubscribe };
}
