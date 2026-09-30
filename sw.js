/* The older Prophesy tools installed a service worker at the site root. Those tools are retired, so this one does nothing but
   remove itself and the caches it made, the next time a browser checks for an update. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) { /* nothing to clear */ }
    try { await self.registration.unregister(); } catch (_) { /* already gone */ }
    try { const cs = await self.clients.matchAll({ type: 'window' }); cs.forEach(c => { try { c.navigate(c.url); } catch (_) {} }); } catch (_) { /* fine */ }
  })());
});
