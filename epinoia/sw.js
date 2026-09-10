/* ============================================================================
   Epinoia service worker — the phone side of notifications.

   Registered by the profile page when a fan turns on "phone updates". It does one thing:
   shows a Web Push the notify function sent, and opens the page it names when tapped.
   No caching, no interception of fetches: the site is served exactly as before.
   ============================================================================ */
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

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Epinoia', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Epinoia';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/epinoia/brand/epinoia-mark-180.png',
    badge: '/epinoia/brand/epinoia-mark-32.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/epinoia/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/epinoia/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
