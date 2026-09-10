/* ============================================================================
   Epinoia service worker — the phone side of notifications.

   Registered by the profile page when a fan turns on "phone updates". It does one thing:
   shows a Web Push the notify function sent, and opens the page it names when tapped.
   No caching, no interception of fetches: the site is served exactly as before.
   ============================================================================ */
self.addEventListener('install', () => self.skipWaiting());
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
