'use strict';
/* ============================================================================
   IOS — the page for EPINOIΛ for iPhone (ios/README.md).

   ONE FILE SAYS WHETHER THE APP IS OUT. epinoia/ios/version.json is read by
   CI (build, version: the App Store build and the tag ios-v<build>), by
   nav.js (the banners, the rail's row, HOME's card: released) and by this
   page (released, appStoreId, minShell), so a release is one edit in one
   place. Until it says released: true with an App Store id, the page says
   "coming soon" and gives the Home Screen steps, which is the truth.

   WHAT THIS DOES
   1. WHERE THE PAGE IS BEING READ, as classes on #page (android.css and
      ios.css hold the show/hide matrix):
        in-app    the iPhone app: "You are using the app" instead of the store
                  button (html.m-app from appmode.js says it before paint)
        webapp    EPINOIΛ from the Home Screen (also m-app), which is offered
                  the real app like a Safari tab
        native    the iPhone app itself, which reports its build and whether
                  iOS lets it notify (window.EpinoiaNative)
        update    that build is older than version.json's minShell
        ios / android / desktop
   2. version.json: released, the App Store link (only ever
      https://apps.apple.com/app/id<digits>), the version.
   3. No "Add to home screen" banner here: this page offers the real app.
   ============================================================================ */
(function () {
  const doc = document;
  const $ = id => doc.getElementById(id);
  const page = $('page');
  if (!page) return;
  const cls = page.classList;

  const me = doc.currentScript;
  const versionUrl = (() => {
    try { return new URL('version.json', (me && me.src) || location.href).href; } catch (_) { return 'version.json'; }
  })();

  /* ---- 3. NO WEB-APP BANNER HERE (registered before nav.js, as android.js does) ---- */
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    e.stopImmediatePropagation();
  });

  const whole = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  const media = m => { try { return !!(window.matchMedia && window.matchMedia(m).matches); } catch (_) { return false; } };
  const session = k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };

  /* ------------------------------------------------------------ 1. where --- */
  const ua = navigator.userAgent || '';
  const nat = (() => {
    try { const n = window.EpinoiaNative; return n && n.platform === 'ios' ? n : null; } catch (_) { return null; }
  })();
  const build = nat ? whole(nat.build) : null;
  const inApp = !!nat
    || doc.documentElement.classList.contains('m-app')
    || window.epinoiaApp === true
    || session('epinoia_app') === '1'
    || media('(display-mode: standalone)')
    || !!(window.navigator && window.navigator.standalone === true);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = !ios && /Android/i.test(ua);

  /* THE EXCEPTION, as android.js makes one for Samsung's web app: EPINOIΛ added to the Home
     Screen from Safari is "an app" to every signal above, but the iPhone app is exactly what it
     is offered here, so it gets the store button (android.css's .webapp undoes html.m-app) */
  if (inApp && !nat) cls.add('webapp');
  else if (inApp) cls.add('in-app');
  cls.add(ios ? 'ios' : android ? 'android' : 'desktop');

  /* WHAT THE APP SAYS ABOUT ITSELF: its build, and iOS's answer about notifications, in the
     words the profile page uses */
  if (nat) {
    cls.add('native');
    const b = $('appBuild');
    if (b) b.textContent = (nat.version ? 'Version ' + nat.version + ' · ' : '') + (build ? 'build ' + build : '');
    const alerts = $('alerts');
    const words = { granted: ['Allowed', 'good'], provisional: ['Delivered quietly', 'meh'], ephemeral: ['Allowed', 'good'],
                    denied: ['Turned off', 'bad'], default: ['Not asked yet', 'meh'] }[nat.permission] || ['Not asked yet', 'meh'];
    if (alerts) { alerts.textContent = words[0]; alerts.classList.add(words[1]); }
  }

  /* --------------------------------------------------- 2. version.json --- */
  function setVersion(name) {
    const ver = $('ver'), wrap = $('verWrap');
    if (!ver || !wrap) return;
    ver.textContent = name || '';
    wrap.classList.toggle('hide', !name);
  }

  async function main() {
    let ver = {};
    try {
      const r = await fetch(versionUrl, { cache: 'no-store' });
      if (r.ok) ver = (await r.json()) || {};
    } catch (_) { ver = {}; }
    const id = /^\d{6,12}$/.test(String(ver.appStoreId == null ? '' : ver.appStoreId)) ? String(ver.appStoreId) : '';
    const store = id ? 'https://apps.apple.com/app/id' + id : '';
    /* OUT only with somewhere to send people: released and a listing to open */
    if (ver.released === true && store) {
      cls.add('released');
      const link = $('storeLink');
      if (link) link.href = store;
    }
    const upd = $('updBtn');
    if (upd && store) upd.href = store;
    setVersion(typeof ver.version === 'string' && /^\d+(\.\d+){1,3}$/.test(ver.version) ? ver.version : '');
    /* AN UPDATE ONLY BELOW minShell, as for the Android app */
    const minShell = whole(ver.minShell);
    if (nat && build !== null && minShell !== null && build < minShell) cls.add('update');
  }

  main().catch(() => { /* the static page already says "coming soon", which is safe */ });
}());
