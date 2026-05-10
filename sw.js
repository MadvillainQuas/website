/* ============================================================
 * sw.js — Prophesy Scouting service worker
 *
 * Strategy:
 *   • Same-origin HTML / JS / CSS: stale-while-revalidate. Serves
 *     the cached copy instantly so the site feels snappy + works
 *     offline, then fetches the fresh version in the background so
 *     the *next* navigation gets your latest deploy. (Before this
 *     was cache-first, which meant edits stayed invisible until
 *     CACHE_VERSION was bumped — too easy to forget.)
 *   • Site config files (config/*.json): network-first with cache
 *     fallback. Always tries fresh; falls back to cache when offline.
 *   • FIBA LiveStats data.json: ALWAYS network-only (live scores
 *     should never be served stale). The wrapper has its own
 *     in-memory dedup/cache for these — no need for SW caching.
 *   • Cross-origin (CDN fonts, etc.): stale-while-revalidate.
 *
 * Versioned cache name → bump CACHE_VERSION to invalidate the old
 * cache after a deploy. Old caches are pruned on activate.
 * ============================================================ */
const CACHE_VERSION = 'prophesy-v3-2026-05-10b';
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

    // Same-origin code-bearing assets (HTML, JS, CSS) →
    // stale-while-revalidate. User sees the cached version instantly +
    // offline, AND a fresh deploy lands on the next navigation. This
    // avoids the "I shipped a fix and the user is still on the old code"
    // gotcha that pure cache-first creates.
    if (sameOrigin && /\.(html|js|css|webmanifest|json)$/i.test(url.pathname)) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    // Same-origin everything else (images, etc.) → cache-first.
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
    // First try a strict match. If that misses (e.g. /gamevis.html?game=…
    // wasn't seen during install), try again ignoring the query string so
    // the cached /gamevis.html still serves and we don't return a network
    // error during page navigation.
    let cached = await cache.match(req);
    const isHtml = /\.html$/i.test(new URL(req.url).pathname) || req.mode === 'navigate';
    if (!cached && isHtml) {
        cached = await cache.match(req, { ignoreSearch: true });
    }
    const fetchPromise = fetch(req)
        .then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
                cache.put(req, res.clone()).catch(() => {});
            }
            return res;
        })
        .catch(() => null);
    if (cached) {
        // Stale-while-revalidate: serve cached, refresh in background.
        // Don't await — let the network request finish on its own.
        fetchPromise.catch(() => {});
        return cached;
    }
    const fresh = await fetchPromise;
    return fresh || Response.error();
}

// Allow the page to ping the SW to bump the cache (e.g. after a deploy).
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
