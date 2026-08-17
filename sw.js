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
const CACHE_VERSION = 'prophesy-v28-2026-08-16';
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

    // The public league section is never cached. A live box score served from
    // cache would show a stale score confidently, with no way for the viewer to
    // tell. Same reasoning as the FIBA bypass below. Enforced by CI so it can't
    // be dropped by accident (.github/workflows/guard.yml).
    if (url.origin === self.location.origin && url.pathname.startsWith('/epinoia/')) {
        return; // let the browser handle it normally
    }

    // Never cache live game data — always go to network so live mode shows
    // fresh scores. If the network is down we don't fall back to a stale
    // snapshot (the wrapper handles that via its own in-memory cache).
    if (/fibalivestats\.dcd\.shared\.geniussports\.com/i.test(url.hostname) ||
        /\/data\/\d+\/data\.json$/i.test(url.pathname)) {
        return; // let the browser handle it normally
    }

    // Same live data, but fetched THROUGH a CORS proxy (codetabs / allorigins /
    // corsproxy / a self-hosted Cloudflare Worker). The proxied request's
    // hostname is the proxy's, so the check above misses it — match the FIBA
    // target anywhere in the URL (it appears in the proxy's query string), and
    // bypass the known proxy hosts outright. These MUST stay network-only:
    // caching them serves stale scores, and wrapping a failed proxy fetch in
    // Response.error() is what produced the "FetchEvent … network error" log.
    if (/fibalivestats|geniussports/i.test(req.url)) {
        return;
    }
    if (/^(api\.codetabs\.com|api\.allorigins\.win|corsproxy\.io|thingproxy\.freeboard\.io)$/i.test(url.hostname) ||
        /\.workers\.dev$/i.test(url.hostname)) {
        return;
    }

    // NEVER cache GitHub API responses. We use the Contents API to:
    //   • read the current `sha` of a file right before writing back to it
    //   • read user/admin config files freshly when a PAT is available
    // If we served a cached GET for /repos/.../contents/<path>, the
    // returned `sha` would be stale and the very next PUT would fail with
    // "does not match <sha>" (HTTP 409/422). Same problem with
    // raw.githubusercontent.com when used as a fallback read path.
    // Method check above (req.method !== 'GET') already excludes the PUTs,
    // so this is purely about not poisoning the read-for-sha step.
    if (/^(api\.github\.com|raw\.githubusercontent\.com|uploads\.github\.com)$/i.test(url.hostname)) {
        return; // let the browser handle it normally
    }

    const sameOrigin = (url.origin === self.location.origin);

    // Transfer Matrix (/transfermatrix/): bypass the SW entirely. Its
    // player_stats CSVs are ~77 MB total — caching them here would pin a
    // stale copy in Cache Storage until the next version bump. The app
    // fetches them with cache:'no-cache', so the browser's HTTP cache +
    // GitHub Pages ETags handle freshness (304s) far more cheaply.
    if (sameOrigin && /^\/transfermatrix\//i.test(url.pathname)) {
        return; // let the browser handle it normally
    }

    // Network-first for our config files (so admin updates propagate fast).
    if (sameOrigin && /\/config\//.test(url.pathname)) {
        event.respondWith(networkFirst(req));
        return;
    }

    // Network-first for the data-folder manifest — a fresh scrape must be
    // discoverable on the very next page load, not one reload later. Falls
    // back to cache when offline.
    if (sameOrigin && /folders\.json$/i.test(url.pathname)) {
        event.respondWith(networkFirst(req));
        return;
    }

    // Same-origin HTML (and navigations) → network-first. A deploy must be
    // visible on the very next load — stale-while-revalidate kept serving
    // the previous build for one extra visit, which made shipped fixes look
    // broken. Cache is still the offline fallback.
    if (sameOrigin && (/\.html$/i.test(url.pathname) || req.mode === 'navigate')) {
        event.respondWith(networkFirst(req));
        return;
    }

    // Same-origin JS / CSS / JSON → stale-while-revalidate. Served from
    // cache instantly + refreshed in the background for the next load.
    if (sameOrigin && /\.(js|css|webmanifest|json)$/i.test(url.pathname)) {
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
