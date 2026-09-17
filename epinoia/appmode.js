'use strict';
/* ============================================================================
   ARE WE IN THE APP? — decided before the first paint, on every page.

   The installed web app and the Android app (a Trusted Web Activity) show the
   live website, so every page has to know, before it paints anything, whether
   it is being shown in a browser tab or inside the app. Five scripts used to
   ask that question separately (nav.js, push.js, me.js, clockcam.js, the
   notify embed), all deferred, so none of them could act before the page had
   already been drawn, and none of them recognised an Android app launch.

   A FILE, NOT AN INLINE SCRIPT, because the CSP forbids inline scripts. It is
   loaded blocking, first in <head>, on every /epinoia/ page that links the
   manifest. Like mode.js it is deliberately tiny, and its whole job is to be
   finished before the body is parsed.

   KEPT APART FROM mode.js. mode.js promises no state and no storage, and it
   also runs on the news archive. This file needs sessionStorage (a page opened
   from inside the app carries no ?source= of its own), and it must never send
   the news archive anywhere.

   WHAT IT DOES
   1. The saved theme, before paint: a copy of config.js's rule (light unless
      the reader chose dark), and theme-color to match, so a light page never
      flashes the dark bar and a dark reader on HOME (which ships #f3faf6) gets
      the dark one.
   2. App detection: the epinoia_app sessionStorage flag, ?source=pwa|twa, the
      Android launcher's own shell=/notif=/chan= (Chrome on Android), an
      android-app:// referrer, display-mode standalone, or iOS's
      navigator.standalone. In the app: html.m-app, window.epinoiaApp = true,
      the ground colour on the root (no white or black flash between pages;
      skipped where the tag carries data-no-ground), and the flag saved for
      the rest of the session.
   3. The Android shell's launch parameters (shell, notif, chan: the app's
      version code, whether notifications are on, the channel's importance) go
      to sessionStorage epinoia_shell as JSON for the update notice and the
      notification checks (roadmap Phase 6 and 7).
   4. THE WATER NEVER APPEARS IN THE APP. On the splash document only (its tag
      carries data-water="front") and only when no league is asked for (no ?l=,
      or an empty one, which mode.js also treats as the splash), the root is
      hidden and the page replaced with /epinoia/home/, keeping the query and
      the hash, because those carry sign-in tokens (?code=, #access_token).
      replace() keeps the pool out of history, so Back from HOME leaves the
      app. The root is hidden FIRST because the navigation is asynchronous and
      the document keeps parsing meanwhile: hidden, splash.css never lays the
      pool out and never fetches its pool-*.jpg backgrounds.
   5. THE REST OF THE SITE OPENS IN A BROWSER TAB. The Android app verifies the
      whole origin, so a link from /epinoia/ to the Prophesy scouting pages (or
      anything else on prophesyscouting.co.uk outside /epinoia/) would open
      full-screen inside the app, with no way back to it but Back. One click
      listener on the document, attached here and doing nothing until a click,
      gives such a link target="_blank" rel="noopener" at the moment it is
      followed. /epinoia/ links, same-page anchors, downloads, modified or
      non-primary clicks, clicks a page script already handled, and links that
      name their own target are left exactly as they are.
   ============================================================================ */
(function () {
  var doc = document;
  var root = doc.documentElement;
  var LIGHT = '#f3faf6', DARK = '#04100b';

  /* ---- 1. THE THEME. Same rule as config.js:71-74, which still runs later and agrees. ---- */
  var light = true;
  try { light = localStorage.getItem('epinoia_theme') !== 'dark'; } catch (_) { light = true; }
  if (light) root.setAttribute('data-theme', 'light');
  try {
    var tc = doc.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', light ? LIGHT : DARK);
  } catch (_) { /* no meta: nothing to match */ }

  /* ---- 2. THE APP, OR A TAB. ---- */
  var q = null;
  try { q = new URLSearchParams(location.search); } catch (_) { q = null; }
  var param = function (k) { return q ? q.get(k) : null; };
  var media = function (m) {
    try { return !!(window.matchMedia && window.matchMedia(m).matches); } catch (_) { return false; }
  };

  var stored = false;
  try { stored = sessionStorage.getItem('epinoia_app') === '1'; } catch (_) { stored = false; }
  var source = param('source');
  var referrer = '';
  try { referrer = String(doc.referrer || ''); } catch (_) { referrer = ''; }

  /* NOT display-mode fullscreen. A desktop browser in F11 full screen matches it too, and
     the stored flag would then keep an ordinary tab "in the app" (and off the splash) for
     the rest of its session. The manifest asks for standalone, and the Android app is
     already recognised by ?source=twa and its android-app:// referrer. */
  /* THE LAUNCHER'S OWN REPORT IS AN APP SIGNAL TOO. An App Link (the digest email's, a
     notification's) launches with shell=, notif= and chan= but not the manifest's ?source=twa.
     All three, a whole shell build, and Chrome on Android: a lone ?shell= in a pasted link, or
     Samsung Internet, is not the app. */
  var ua = '';
  try { ua = String((window.navigator && window.navigator.userAgent) || ''); } catch (_) { ua = ''; }
  var launcher = !!q && /^[1-9]\d*$/.test(param('shell') || '') && q.has('notif') && q.has('chan')
    && /Android/i.test(ua) && !/SamsungBrowser/i.test(ua);

  var app = stored
    || source === 'pwa' || source === 'twa'
    || launcher
    || referrer.indexOf('android-app://') === 0
    || media('(display-mode: standalone)')
    || !!(window.navigator && window.navigator.standalone === true);

  window.epinoiaApp = app;
  if (!app) return;

  var me = doc.currentScript;
  var attr = function (k) { return me && me.getAttribute ? me.getAttribute(k) : null; };

  root.classList.add('m-app');
  /* A PAGE THAT PAINTS ITS OWN GROUND OPTS OUT with data-no-ground. The scorer is always
     dark and paints on body; a background on html would stop body's from reaching the
     canvas, so the light mint would show round it when the page rubber-bands. */
  if (attr('data-no-ground') == null) root.style.background = light ? LIGHT : DARK;
  try { sessionStorage.setItem('epinoia_app', '1'); } catch (_) { /* private mode: detection still works per page */ }

  /* ---- 3. WHAT THE ANDROID SHELL SAID ABOUT ITSELF. Numbers where they are numbers. ---- */
  if (q && (q.has('shell') || q.has('notif') || q.has('chan'))) {
    var shell = {};
    try { shell = JSON.parse(sessionStorage.getItem('epinoia_shell') || '{}') || {}; } catch (_) { shell = {}; }
    ['shell', 'notif', 'chan'].forEach(function (k) {
      if (!q.has(k)) return;
      var v = q.get(k);
      var n = Number(v);
      shell[k] = (v !== '' && isFinite(n)) ? n : v;
    });
    shell.at = Date.now();
    try { sessionStorage.setItem('epinoia_shell', JSON.stringify(shell)); } catch (_) { /* best effort */ }
    /* REMEMBERED BEYOND THIS SESSION, so push.js still knows the app in a window a notification
       tap opens later with no report of its own. Chrome only: Samsung Internet is never the app. */
    if (typeof shell.shell === 'number' && shell.shell > 0 && !/SamsungBrowser/i.test(ua)) {
      try { localStorage.setItem('epinoia_twa_seen', String(shell.shell)); } catch (_) { /* best effort */ }
    }
  }

  /* ---- 4. THE SPLASH, NEVER IN THE APP. ---- */
  var water = attr('data-water');
  /* The path check is belt and braces: only the platform front page itself may ever be sent
     away, whatever tag a copy-pasted head ends up carrying (the news archive is also a
     "no league" page, and a league page has ?l=). */
  var atFront = /^\/epinoia\/(index\.html)?$/.test(location.pathname || '');
  if (water === 'front' && q && !param('l') && atFront) {
    root.style.display = 'none';
    try {
      location.replace('/epinoia/home/' + (location.search || '') + (location.hash || ''));
    } catch (_) {
      root.style.display = '';     // could not leave: showing the splash beats a blank app
    }
  }

  /* ---- 5. OUTSIDE /epinoia/, A BROWSER TAB. Bubble phase, so a page's own handler that
     called preventDefault (and navigates itself, or not at all) is seen and respected. The
     browser reads the target after the click has been dispatched, so setting it here is in
     time for this very click. Only the PATH decides: an <a> with no href, a javascript: or
     mailto: link, or another origin never gets here. ---- */
  if (doc.addEventListener) {
    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented || (e.button && e.button !== 0)
          || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var n = e.target;
      if (n && n.nodeType === 3) n = n.parentNode;
      var a = n && n.closest ? n.closest('a[href]') : null;
      if (!a || a.hasAttribute('download') || a.getAttribute('target')) return;
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') return;
      var u;
      try { u = new URL(href, location.href); } catch (_) { return; }
      if (u.origin !== location.origin || /^\/epinoia(\/|$)/.test(u.pathname)) return;
      a.setAttribute('target', '_blank');
      var rel = a.getAttribute('rel') || '';
      if (!/(^|\s)noopener(\s|$)/i.test(rel)) a.setAttribute('rel', (rel ? rel + ' ' : '') + 'noopener');
    });
  }
}());
