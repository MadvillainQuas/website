/* ============================================================================
   EPINOIA NETWORK — client configuration.
   This file is PUBLIC. It ships to every browser. Treat it accordingly.

   The anon key belongs here: it is designed to be published, and it grants
   nothing on its own — every read and write is evaluated by the row-level
   security policies in supabase/migrations/0001_init.sql.

   NEVER put the service_role key in this file, or anywhere under /epinoia/.
   That key bypasses RLS entirely. It lives only in Edge Function secrets and
   GitHub Actions secrets.

   Get the anon key:  Supabase dashboard -> Project Settings -> API
                      -> Project API keys -> "anon / public"
   ============================================================================ */
window.EPINOIA_CONFIG = {
  supabaseUrl: 'https://hhvofgqqadtyvcjudhjx.supabase.co',

  // paste the anon (public) key here — starts "eyJ…"
  supabaseAnonKey: 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO',

  // 'supabase' once the key is in and the migration is applied;
  // 'local' drives everything through BroadcastChannel for offline development.
  defaultMode: 'local'
};

/* Lazily create the Supabase client, only if the SDK and a key are present.
   Pages work in local mode with neither. */
/* ============================================================================
   A CLUB'S CREST, WHEREVER IT CAME FROM.

   teams.logo_path started life as a path inside the media-public bucket (a
   club's approved upload). A league fed from FIBA LiveStats gets its crests
   from the feed instead — Genius publishes each club's logo at an absolute
   URL, and the ingest worker writes that in. One resolver, used by every page
   that draws a crest, so both kinds work everywhere and nothing prefixes a
   bucket path onto a URL that already has a host. Tolerates the JSON blob an
   early worker wrote in place of the URL. Returns null for "no crest".
   ============================================================================ */
/* THE CLUB'S CREST, WHEREVER A CLUB IS NAMED. One element: the crest where the club has one
   (uploaded, or from its feed), the initials on the club's colour where it has not, and the
   initials again if the image fails. `team` needs logo_path (or logo_url), short_name/name and
   colour; `opts.cls` names the class the host page styles (default ep-crest). */
window.epinoiaCrest = function (team, opts) {
  const o = opts || {}; const t = team || {};
  const box = document.createElement('span');
  box.className = o.cls || 'ep-crest';
  const s = String(t.short_name || '').trim();
  const words = String(t.name || '').trim().split(/\s+/).filter(Boolean);
  const initials = s ? s.slice(0, 3).toUpperCase()
    : words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase()
    : String(t.name || '?').slice(0, 2).toUpperCase();
  const paint = () => {
    box.textContent = initials; box.classList.remove('has-img');
    box.style.background = t.colour || '#93f2bf';
  };
  const url = t.logo_url || (window.epinoiaLogoUrl ? window.epinoiaLogoUrl(t.logo_path || t.logo || null) : null);
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => { img.remove(); paint(); });
    box.classList.add('has-img'); box.style.background = '';
    box.appendChild(img);
    box.title = t.name || '';
  } else paint();
  return box;
};

/* LIGHT OR DARK, DECIDED BEFORE THE PAGE PAINTS. A fan's choice on their profile is kept in
   this browser as well as on their row, so every page opens in it without a round trip. */
try {
  const th = localStorage.getItem('epinoia_theme');
  if (th !== 'dark') document.documentElement.setAttribute('data-theme', 'light');     // light unless dark was chosen
} catch (_) { document.documentElement.setAttribute('data-theme', 'light'); }
try {
  const m = document.querySelector('meta[name="theme-color"]');
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  if (m && light) m.setAttribute('content', '#f3faf6');
  /* SAMSUNG INTERNET AND CHROME CAN DARKEN A PAGE BY FORCE ("dark mode" in the browser's own
     settings): every colour is inverted or dimmed and the light theme comes out as a murky
     dark one. "only light" is the documented opt-out; a page that chose dark says so too. */
  window.epinoiaColourScheme = function (isLight) {
    let cs = document.querySelector('meta[name="color-scheme"]');
    if (!cs) { cs = document.createElement('meta'); cs.setAttribute('name', 'color-scheme'); document.head.appendChild(cs); }
    cs.setAttribute('content', isLight ? 'only light' : 'dark');
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', isLight ? '#f3faf6' : '#04100b');
  };
  window.epinoiaColourScheme(light);
} catch (_) { /* no meta */ }
/* the public half of the Web Push key pair (the private half lives with the notify function) */
window.EPINOIA_VAPID = 'BLskwAuRGoAJnRcYe0gyLE5R0otKhcvu8fL5UxE06ep_VGzxfbirqziIS4uu3N6BmQob4Vl9vSiokUuVKpa7toM';

window.epinoiaLogoUrl = function (path) {
  if (!path) return null;
  let p = String(path).trim();
  if (p.charAt(0) === '{') {
    try { p = (JSON.parse(p) || {}).url || ''; } catch (_) { return null; }
  }
  if (!p) return null;
  if (/^https:\/\//i.test(p)) return p;
  if (/^http:\/\//i.test(p)) return null;          // mixed content: the browser would block it anyway
  const c = window.EPINOIA_CONFIG || {};
  if (!c.supabaseUrl) return null;
  return c.supabaseUrl + '/storage/v1/object/public/media-public/' +
         p.split('/').map(encodeURIComponent).join('/');
};

/* ============================================================================
   A HUNG REQUEST MUST NOT TAKE THE GAME WITH IT.

   Every frame the scorer publishes goes through one promise chain, on purpose:
   a retraction must not overtake the write that replaces it. That chain is only
   as quick as the request at its head, and nothing was putting a limit on one.

   A sports hall's access point does not usually fail by refusing a connection.
   It accepts the TCP handshake and then stops answering -- a captive portal
   wanting re-authentication, a saturated uplink, a handover between two APs
   with the same name. The fetch then sits open for the BROWSER's timeout, which
   is minutes on Chrome and on some iOS builds is effectively forever. For all
   of that time the chain is stopped, every subsequent play queues behind it, the
   badge still says live because the socket is a different connection, and the
   statistician has no reason to think anything is wrong.

   Fifteen seconds is far past any healthy round trip and far short of minutes.
   An abort is CHEAP here and that is what makes the number safe to pick: the
   rejected send is caught by deliver(), the frame goes on the backlog, and it is
   retried in order -- and every durable write is idempotent, the event upsert on
   conflict and the state row on game_id, so a write that actually landed before
   the abort costs nothing when it is sent again.

   Only the game's own traffic. Storage moves files -- a reel off a phone is
   legitimately minutes -- and an edge function may be finalising a game, which
   computes a season's awards and writes a match report. Neither is in front of
   a live score, and a deadline on either would break something that works. */
const FETCH_DEADLINE_MS = 15000;
const DEADLINED = /\/(rest|realtime)\/v1\//;

function deadlinedFetch(u, o) {
  const url = typeof u === 'string' ? u : ((u && u.url) || '');
  if (!DEADLINED.test(url)) return fetch(u, o);

  const ctl = new AbortController();
  const t = setTimeout(() => { try { ctl.abort(); } catch (_) {} }, FETCH_DEADLINE_MS);

  /* supabase-js passes its own signal on some paths (.abortSignal(), auth's
     own cancellation). Replacing it outright would quietly disable those, so
     ours is combined with whatever the caller already had. */
  const caller = o && o.signal;
  let signal = ctl.signal;
  if (caller) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([caller, ctl.signal]);
    } else if (caller.aborted) {
      try { ctl.abort(); } catch (_) {}
    } else {
      caller.addEventListener('abort', () => { try { ctl.abort(); } catch (_) {} }, { once: true });
    }
  }

  return fetch(u, Object.assign({}, o, { signal }))
    .then(r => { clearTimeout(t); return r; },
          e => { clearTimeout(t); throw e; });
}

window.epinoiaClient = function () {
  const c = window.EPINOIA_CONFIG;
  if (window.__sb) return window.__sb;
  if (!c.supabaseAnonKey || !window.supabase) return null;
  window.__sb = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 20 } },
    global: { fetch: deadlinedFetch }
  });
  return window.__sb;
};

/* ============================================================================
   SIGNING OUT, PROPERLY.

   sb.auth.signOut() posts to the server and then clears local storage, and it
   is the SERVER call that can fail — offline, a dead token, a 5xx. When it
   does, some versions leave the stored session behind and the page still holds
   a token for an account the user believes they have left. Signing in as
   somebody else then lands on top of a half-cleared state, which is how
   "logged out, logged in as another account, still shows the first one"
   happens.

   So the local half is done unconditionally afterwards, whatever the server
   said. Being signed out locally when the server disagrees is recoverable —
   the next request 401s and the page asks for a sign-in. The reverse, holding
   a session the user thinks they dropped, is not.

   scope:'local' is deliberate: this signs out THIS browser and leaves other
   devices alone, which is what a sign-out button on a shared laptop should do.
   ============================================================================ */
window.epinoiaSignOut = async function (sb) {
  const client = sb || (window.epinoiaClient && window.epinoiaClient());
  try { if (client) await client.auth.signOut({ scope: 'local' }); }
  catch (e) { console.warn('[signout] server call failed, clearing locally', e); }

  /* Whatever happened above, leave nothing behind that looks like a session. */
  try {
    const ref = (window.EPINOIA_CONFIG.supabaseUrl.match(/^https?:\/\/([^.]+)\./) || [])[1];
    if (ref) localStorage.removeItem('sb-' + ref + '-auth-token');
    Object.keys(localStorage)
      .filter(k => /^sb-.*-auth-token/.test(k))
      .forEach(k => localStorage.removeItem(k));
  } catch (_) { /* storage unavailable is not a reason to fail a sign-out */ }

  /* Tell this tab. The browser's storage event only reaches OTHER tabs, so
     without this the rail in this one would wait for its next poll. */
  try { window.dispatchEvent(new Event('epinoia:auth')); } catch (_) {}
  return true;
};

/* ----------------------------------------------------------------------------
   THE SDK, FETCHED ONLY WHEN SOMETHING NEEDS IT.

   vendor/supabase.js is 207kB — half the JavaScript on the platform's front
   page — and that page uses it for exactly one thing: the sign-in box on the
   splash. Every read it performs goes through plain fetch against PostgREST,
   because anonymous reads need a URL and an apikey header and nothing else. A
   league's front page (?l=slug) does not use the SDK at all.

   It was a plain script tag, so home.js could not run until it had arrived and
   been parsed. Measured: the first API request of a league page did not leave
   the browser until 3.1 seconds in, on localhost.

   So it is loaded on demand. Callers that need auth ask for it and get a
   promise; callers that only read never pay for it. One in-flight promise is
   shared, so two callers asking at once inject one script tag.

   Pages that are all authentication — the admin console, the club portal, the
   scorer — keep their static script tag. There is nothing to defer there: the
   SDK is the point of the page, and making it lazy would only move the wait. */
let sdk = null;
window.epinoiaSdk = function () {
  if (window.supabase) return Promise.resolve(window.supabase);
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    /* The version stamp is read off this file's own URL so the SDK cannot be
       served from a stale cache while everything around it is fresh — one
       deploy, one version, no combination of the two. */
    let v = '';
    try {
      const me = document.querySelector('script[src*="config.js"]');
      const q = me && me.getAttribute('src').split('?')[1];
      if (q) v = '?' + q;
    } catch (_) { /* unstamped is still correct, just cacheable for longer */ }

    const s = document.createElement('script');
    /* Relative to the document, matching how the static tag was written on
       every page that still has one. */
    s.src = (window.EPINOIA_CONFIG.sdkPath || 'vendor/supabase.js') + v;
    s.async = true;
    s.addEventListener('load', () => resolve(window.supabase));
    s.addEventListener('error', () => {
      sdk = null;                     // a retry should be a real attempt
      reject(new Error('the Supabase SDK could not be loaded'));
    });
    document.head.appendChild(s);
  });
  return sdk;
};

/* The client, once the SDK is there. Callers that cannot proceed without auth
   should await this; window.epinoiaClient() stays synchronous for the pages
   that load the SDK up front. */
window.epinoiaClientReady = async function () {
  try { await window.epinoiaSdk(); } catch (_) { return null; }
  return window.epinoiaClient();
};

/* Which transport should a page use? ?mode= wins, then the key's presence. */
window.epinoiaMode = function () {
  const q = new URLSearchParams(location.search).get('mode');
  if (q === 'local' || q === 'supabase') return q;
  const c = window.EPINOIA_CONFIG;
  return c.supabaseAnonKey ? 'supabase' : c.defaultMode;
};
