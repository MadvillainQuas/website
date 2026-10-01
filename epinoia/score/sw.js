/* ============================================================================
   THE SCORER'S OWN SERVICE WORKER.

   /epinoia/sw.js exists for push notifications and deliberately caches nothing —
   "a live score served from yesterday's cache would be worse than no app at
   all", which is right for a page whose whole job is showing what is happening
   now. But it registers at scope '/epinoia/', and a scope covers everything
   beneath it. So it also controlled '/epinoia/score/', and its fetch handler
   answers a failed request with a hard-coded page reading:

       Epinoia is offline
       Nothing is stored on this phone; connect and try again.

   For a statistician that sentence is false and the page is the worst possible
   one to show. The entire game IS stored on this phone — that is the scorer's
   central design decision, the log lives in localStorage and the network is a
   publishing detail — and the hall's wifi dropping is the ordinary case, not
   the exception. They reload out of habit when something looks wrong, which is
   exactly when the wifi has gone, and the app is replaced by a notice telling
   them their game does not exist.

   A more specific scope wins, so this displaces that worker for the scorer and
   leaves the rest of the site's no-cache decision exactly as it was.

   WHAT IS CACHED IS DECIDED BY THE PAGE, NOT BY A LIST HERE. Every asset carries
   a ?v= stamp that changes on deploy, and a hand-written precache list would go
   stale the first time one of them was bumped — silently, because the app would
   still work online. So install fetches the page and caches what it actually
   declares. The list maintains itself.
   ============================================================================ */

/* v2: the scorer now ships shut (body.cs-shut in index.html) and bootstrap.js is the only
   thing that opens it. A phone still holding v1 would serve its cached shell and its cached
   bootstrap.js — the ungated pair — from under the new deploy, so the name is changed and
   activate drops every epinoia-scorer-* cache that is not this one. */
const CACHE = 'epinoia-scorer-v2';
const SHELL = new URL('./', self.location).pathname;     // '/epinoia/score/'

/* src="..." and href="..." for the scripts, styles and icons; url(...) for the
   @font-face block, which is inline in the page and carries no version stamp. */
function declared(html) {
  const out = new Set();
  const add = raw => {
    if (!raw) return;
    const v = raw.trim();
    if (!v || v.charAt(0) === '#') return;
    if (/^(data|mailto|tel|blob|javascript):/i.test(v)) return;
    let u;
    try { u = new URL(v, self.location.origin + SHELL); } catch (_) { return; }
    if (u.origin !== self.location.origin) return;       // nothing cross-origin, ever
    out.add(u.href);
  };
  let m;
  const attr = /(?:src|href)\s*=\s*"([^"]+)"/gi;
  while ((m = attr.exec(html))) add(m[1]);
  const css = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
  while ((m = css.exec(html))) add(m[2]);
  return [...out];
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      /* 'reload' so an install triggered by a deploy does not warm the cache
         from the HTTP cache copy it is meant to be replacing. */
      const res = await fetch(SHELL, { cache: 'reload' });
      if (res && res.ok) {
        await c.put(SHELL, res.clone());
        const html = await res.clone().text();
        /* Individually, and failures ignored: one 404 on an icon must not leave
           the statistician with no cached application at all. */
        await Promise.all(declared(html).map(u => c.add(u).catch(() => {})));
      }
    } catch (_) { /* an install with no network still installs; it warms later */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => (n !== CACHE && n.indexOf('epinoia-scorer-') === 0)
      ? caches.delete(n) : Promise.resolve()));
    await self.clients.claim();
  })());
});

/* The page it shows when there is genuinely nothing cached — a first visit that
   went offline mid-load. It says the opposite of what the old one said, because
   by the time a scorer sees this the truthful thing to tell them is where their
   game is. */
const nothingYet = () => new Response(
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="margin:0;background:#04100b;color:#e6fff1;font-family:system-ui;' +
  'display:grid;place-items:center;height:100vh;text-align:center;padding:24px">' +
  '<div><div style="font-size:22px;font-weight:800">No connection, and nothing stored yet</div>' +
  '<div style="opacity:.75;margin-top:10px;line-height:1.6">This phone has not finished loading ' +
  'the scorer, so there is nothing to open offline.<br>A game already in progress is kept on the ' +
  'phone and will still be here.</div></div></body>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/* HOW LONG A PAGE LOAD WAITS FOR THE NETWORK BEFORE THE PHONE'S COPY.

   Network first, with no deadline, was right for a dead connection and wrong
   for a bad one. A hall's access point that has the phone associated and no
   working uplink does not fail a request, it holds it — and the statistician
   who reloads because something looked wrong stared at a blank page until the
   browser gave up, which can be a minute. Past this the copy on the phone is
   served, and the network's answer, when it comes, still updates the cache for
   next time. */
const NAV_WAIT_MS = 3500;

/* The ?v= stamp of a URL, or null. */
const stampOf = u => { try { return new URL(u).searchParams.get('v'); } catch (_) { return null; } };

/* KEEP ONE VERSION OF EACH FILE, AND ONLY THROW AN OLD ONE AWAY ONCE THE NEW ONE
   IS HERE.

   Every deploy's files stayed in the cache for ever, and the offline fallback
   below answered with the FIRST match ignoring the stamp — which, the cache
   being in insertion order, was the oldest copy on the phone, not the newest:
   months-old scripts beside this week's page. So after a page load that worked,
   the files the page declares are fetched into the cache, and for each of them
   any copy under an older stamp is deleted — but only when the copy the page
   wants is actually here, so a load that fails half way never leaves a file
   with no copy at all. Files the page does not declare (a font a stylesheet
   pulls in, a language pack) are left alone. */
async function refresh(html) {
  try {
    const c = await caches.open(CACHE);
    const want = declared(html);
    await Promise.all(want.map(u => c.match(u).then(hit => hit || c.add(u)).catch(() => {})));
    const byPath = new Map();
    want.forEach(u => { const x = new URL(u); byPath.set(x.origin + x.pathname, u); });
    const keys = await c.keys();
    await Promise.all(keys.map(async req => {
      const x = new URL(req.url);
      const cur = byPath.get(x.origin + x.pathname);
      if (!cur || req.url === cur || x.pathname === SHELL) return;
      if (stampOf(req.url) === stampOf(cur)) return;
      if (await c.match(cur)) await c.delete(req);
    }));
  } catch (_) { /* a tidy-up; never a reason to fail anything */ }
}

/* The newest copy of a file under any stamp: the last one put, since put()
   moves an entry to the end. */
async function newestCopy(req) {
  try {
    const c = await caches.open(CACHE);
    const all = await c.matchAll(req, { ignoreSearch: true });
    return all.length ? all[all.length - 1] : null;
  } catch (_) { return null; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  /* SUPABASE AND EVERYTHING ELSE OFF THIS ORIGIN IS UNTOUCHED. A live score is
     the one thing that must never come from a cache, and a service worker
     sitting in front of the API is how that happens by accident. */
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    /* The network's answer, kept as the shell and used to tidy the cache —
       whether it arrives before the deadline or after the phone's copy has
       already been shown. */
    const net = fetch(req).then(r => {
      if (r && r.ok) {
        /* both copies taken now, before the page can start reading the body */
        const forShell = r.clone(), forTidy = r.clone();
        e.waitUntil(caches.open(CACHE)
          .then(c => c.put(SHELL, forShell))
          .then(() => forTidy.text())
          .then(refresh)
          .catch(() => {}));
      }
      return r;
    });
    e.waitUntil(net.catch(() => {}));
    e.respondWith((async () => {
      try {
        const slow = new Promise(res => setTimeout(() => res(null), NAV_WAIT_MS));
        const first = await Promise.race([net, slow]);
        if (first) return first;                       // the network answered in time
        const copy = await caches.match(SHELL);       // ...it did not: the phone's copy
        if (copy) return copy;
        return await net;                              // nothing stored: wait for whatever comes
      } catch (_) {
        /* The real application, from the cache, which then loads the real game
           from localStorage. This is the whole point of the file. */
        const hit = await caches.match(SHELL);
        return hit || nothingYet();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) {
      /* Cache first, because every one of these carries a version stamp: the
         copy under this exact URL can never be the wrong version of itself.
         Refreshed behind the answer so a redeploy is picked up without a wait. */
      e.waitUntil(fetch(req).then(r => {
        if (r && r.ok) return caches.open(CACHE).then(c => c.put(req, r));
      }).catch(() => {}));
      return hit;
    }
    try {
      const r = await fetch(req);
      if (r && r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
      return r;
    } catch (err) {
      /* A DEPLOY THIS PHONE NEVER SAW, AND NOW NO NETWORK. The page asks for
         bootstrap.js?v=318 and the cache holds ?v=317. Serving last week's copy
         of a script is not ideal; refusing to open a game that is already
         half-recorded is very much worse. The NEWEST copy, though (ignoreSearch:
         true, last match) — not whichever happened to be cached first. */
      const older = await newestCopy(req);
      if (older) return older;
      throw err;
    }
  })());
});
