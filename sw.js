/* ============================================================
 * sw.js — Prophesy Scouting service worker
 *
 * Strategy:
 *   • App shell (HTML, JS, manifest, logo): cache-first, falls back
 *     to network. Lets the site open instantly + work offline with
 *     last-known data.
 *   • Site config files (config/*.json): network-first with cache
 *     fallback. Always tries fresh; falls back to cache when offline.
 *   • FIBA LiveStats data.json: ALWAYS network-only (live scores
 *     should never be served stale). The wrapper has its own
 *     in-memory dedup/cache for these — no need for SW caching.
 *   • Everything else (CDN fonts, etc.): stale-while-revalidate.
 *
 * Versioned cache name → bump CACHE_VERSION to invalidate the old
 * cache after a deploy. Old caches are pruned on activate.
 * ============================================================ */
const CACHE_VERSION = 'prophesy-v1';
const APP_SHELL = [
    './',
    './index.html',
    './admin.html',
    './lineup.html',
    './gamevis.html',
    './basketball-analyzer-profiles_9.html',
    './gate.js',
    './topnav.js',
    './manifest.webmanifest',
    './logo.jpg'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // addAll is atomic — if any URL fails, none get cached. We allow
        // partial misses (e.g. a page renamed mid-deploy) by adding URLs one
        // at a time + swallowing per-URL failures.
        await Promise.all(APP_SHELL.map(async (u) => {
            try { await cache.add(new Request(u, { cache: 'reload' })); }
            catch (e) { /* skip */ }
        }));
        // Activate immediately on the first install — don't wait for old
        // tabs to close. Calls to clients.claim() in 'activate' below take
        // it from there.
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (_) { return; }

    // Never cache live game data — always go to network so live mode shows
    // fresh scores. If the network is down we don't fall back to a stale
    // snapshot (the wrapper handles that via its own in-memory cache).
    if (/fibalivestats\.dcd\.shared\.geniussports\.com/i.test(url.hostname) ||
        /\/data\/\d+\/data\.json$/i.test(url.pathname)) {
        return; // let the browser handle it normally
    }

    const sameOrigin = (url.origin === self.location.origin);

    // Network-first for our config files (so admin updates propagate fast).
    if (sameOrigin && /\/config\//.test(url.pathname)) {
        event.respondWith(networkFirst(req));
        return;
    }

    // Same-origin app shell → cache-first.
    if (sameOrigin) {
        event.respondWith(cacheFirst(req));
        return;
    }

    // Cross-origin (Google Fonts, CDN libs) → stale-while-revalidate.
    event.respondWith(staleWhileRevalidate(req));
});

// ── strategies ──────────────────────────────────────────────────

async function cacheFirst(req) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    } catch (e) {
        // Last-ditch: return the index page if offline + asset not cached
        const fallback = await cache.match('./index.html');
        return fallback || Response.error();
    }
}

async function networkFirst(req) {
    const cache = await caches.open(CACHE_VERSION);
    try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
    } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw e;
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req)
        .then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
                cache.put(req, res.clone()).catch(() => {});
            }
            return res;
        })
        .catch(() => null);
    return cached || (await fetchPromise) || Response.error();
}

// Allow the page to ping the SW to bump the cache (e.g. after a deploy).
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
