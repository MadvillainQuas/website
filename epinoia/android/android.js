'use strict';
/* ============================================================================
   ANDROID — the download page for Epinoia for Android (roadmap Phase 6, with
   the Play badge of Phase 8).

   ONE FILE SAYS WHAT TO DOWNLOAD. epinoia/android/version.json is read by
   Gradle (versionCode, versionName), by CI (the release tag android-v<code>)
   and by this page (apk, play, minShell), so a release is one edit in one
   place. The page's HTML already carries the contract's stable link, so the
   button works before, or without, this script.

   WHAT THIS DOES
   1. WHERE THE PAGE IS BEING READ, as classes on #page (android.css holds the
      show/hide matrix):
        in-app    the app, or any installed copy of the site: "You are using
                  the app" instead of the download. html.m-app (appmode.js)
                  is one signal; ?source=twa, the stored epinoia_shell, an
                  android-app:// referrer and display-mode are the others, so
                  the page is right even before appmode.js ships.
        webapp    THE EXCEPTION: the old Samsung Internet home-screen web app
                  is "an app" to every signal above, but it is exactly what
                  the Android app replaces, so it gets the download and a note.
                  The Android app always runs on Chrome (the launcher forces
                  it), so a SamsungBrowser user agent in app mode, with no
                  shell data, can only be that web app.
        shell     the launcher said shell=, notif=, chan= on this launch
        update    that shell is older than version.json's minShell
        ios / android / desktop
   2. version.json: the download link, the version, the Play link.
   3. THE PUBLISHED FILE'S OWN RECORD (apps/epinoia.json, beside the APK in our
      storage, written by the release workflow with the file), for the file's
      real size and the version you actually get. It also answers the question
      the link cannot: with no build published the link is a 404, and a big
      button to a 404 is worse than saying "not released yet". Anything else
      going wrong (offline, blocked) fails OPEN: the button stays, the size
      just says "a small download".
   4. No "Add to home screen" banner on this page: nav.js offers the web app
      on beforeinstallprompt, and this page is here to offer the real one.
   ============================================================================ */
(function () {
  const PACKAGE = 'uk.co.prophesyscouting.epinoia';
  const APK_FALLBACK = 'https://hhvofgqqadtyvcjudhjx.supabase.co/storage/v1/object/public/apps/epinoia.apk';
  const PLAY_PREFIX = 'https://play.google.com/';
  const API_TIMEOUT_MS = 6000;

  const doc = document;
  const $ = id => doc.getElementById(id);
  const page = $('page');
  if (!page) return;
  const cls = page.classList;

  /* READ NOW, not later: currentScript is only set while this file is executing. version.json
     sits next to this script, so its URL is resolved against the script's, which is right
     whether the page was opened as /epinoia/android/ or /epinoia/android/index.html. */
  const me = doc.currentScript;
  const versionUrl = (() => {
    try { return new URL('version.json', (me && me.src) || location.href).href; } catch (_) { return 'version.json'; }
  })();

  /* ---- 4. NO WEB-APP BANNER HERE. Registered before nav.js (deferred scripts run in document
     order), so stopImmediatePropagation keeps nav.js's listener from ever seeing the event, and
     preventDefault keeps Chrome's own mini-infobar away too. ---- */
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    e.stopImmediatePropagation();
  });

  /* ------------------------------------------------------------ helpers --- */
  const q = (() => { try { return new URLSearchParams(location.search); } catch (_) { return null; } })();
  const param = k => (q ? q.get(k) : null);
  const session = k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
  const media = m => { try { return !!(window.matchMedia && window.matchMedia(m).matches); } catch (_) { return false; } };
  /* A whole number from JSON or from a query-string copy of one; anything else is null. */
  const whole = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  /* ONLY https LINKS REACH AN href. version.json is ours, but a typo there must not become a
     javascript: link on a public page. */
  const httpsUrl = v => typeof v === 'string' && /^https:\/\/[^\s"'<>\\]+$/.test(v);
  const megabytes = bytes => {
    if (!(bytes > 0)) return '';
    const mb = bytes / 1e6;                 // decimal megabytes, as Android's own file sizes are
    return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + ' MB';
  };

  /* A JSON GET that never throws: { status, body }. status 0 = no answer (offline, blocked,
     timed out). The service worker answers a failed fetch with a 503 page, which is not JSON,
     so it lands as { 503, null } and is treated as "unknown", never as "not released". */
  async function getJson(url, headers) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), API_TIMEOUT_MS) : 0;
    try {
      const r = await fetch(url, { cache: 'no-store', headers: headers || {}, signal: ctl ? ctl.signal : undefined });
      let body = null;
      if (r.ok) { try { body = await r.json(); } catch (_) { body = null; } }
      return { status: r.status, body: body };
    } catch (_) {
      return { status: 0, body: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------ 1. where --- */
  const ua = navigator.userAgent || '';
  const shell = (() => {
    try {
      const j = JSON.parse(session('epinoia_shell') || 'null');
      return j && typeof j === 'object' ? j : null;
    } catch (_) { return null; }
  })();
  const shellCode = shell ? whole(shell.shell) : null;
  let referrer = '';
  try { referrer = String(doc.referrer || ''); } catch (_) { referrer = ''; }

  /* THE ANDROID APP ITSELF: its launch parameter, the launcher's report of itself, or the
     referrer Android gives a page opened by an app. */
  const twa = param('source') === 'twa'
    || (shellCode !== null && shellCode > 0)
    || referrer.indexOf('android-app://' + PACKAGE) === 0;
  /* ANY INSTALLED COPY: the same signals appmode.js reads. */
  const appMode = twa
    || doc.documentElement.classList.contains('m-app')
    || window.epinoiaApp === true
    || param('source') === 'pwa'
    || session('epinoia_app') === '1'
    || media('(display-mode: standalone)') || media('(display-mode: fullscreen)')
    || !!(window.navigator && window.navigator.standalone === true);
  const samsung = /SamsungBrowser/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = !ios && /Android/i.test(ua);
  const samsungWebApp = appMode && !twa && samsung;
  const inApp = appMode && !samsungWebApp;

  if (inApp) cls.add('in-app');
  if (samsungWebApp) cls.add('webapp');
  cls.add(ios ? 'ios' : android ? 'android' : 'desktop');

  /* The steps name the browser the person is actually holding, where it can be told. */
  const browser = samsung ? 'Samsung Internet'
    : /EdgA?\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : '';
  if (browser) doc.querySelectorAll('[data-browser]').forEach(n => { n.textContent = browser; });

  /* WHAT THE LAUNCHER SAID ON THIS LAUNCH. The words are the app's own notification settings
     screen's (android/.../strings.xml), so the page and the app never describe one state two
     ways. chan is the Game alerts channel's importance: 4 HIGH and 5 MAX pop up, 3 alerts
     without popping up, 1-2 are silent, 0 is off, -1 means the channel is not there yet. */
  if (twa && shellCode !== null && shellCode > 0) {
    cls.add('shell');
    const build = $('shellBuild');
    if (build) build.textContent = 'Build ' + shellCode;
    const notif = whole(shell.notif);
    const chan = whole(shell.chan);
    let words = '', tone = '';
    if (notif === 0) { words = 'Blocked'; tone = 'bad'; }
    else if (notif === 1 && chan !== null) {
      if (chan >= 4) { words = 'Alert, pops up'; tone = 'good'; }
      else if (chan === 3) { words = 'Alert, no pop-up'; tone = 'meh'; }
      else if (chan > 0) { words = 'Silent'; tone = 'meh'; }
      else if (chan === 0) { words = 'Off'; tone = 'bad'; }
      else { words = 'Not set up yet'; tone = 'meh'; }
    }
    const alerts = $('alerts');
    if (alerts && words) { alerts.textContent = words; if (tone) alerts.classList.add(tone); }
    else { const row = $('alertsRow'); if (row) row.classList.add('hide'); }
  }

  /* ---------------------------------------------------- 2 and 3. the file --- */
  const dl = $('dl');
  const upd = $('updBtn');

  function setVersion(name) {
    const ver = $('ver'), wrap = $('verWrap');
    if (!ver || !wrap) return;
    ver.textContent = name || '';
    wrap.classList.toggle('hide', !name);
  }

  function showPlay(url) {
    const box = $('play'), link = $('playLink');
    if (!box || !link || !url) return;
    link.href = url;
    box.classList.remove('hide');
    cls.add('has-play');
    /* ON PLAY, PLAY COMES FIRST: it updates the app by itself and needs no "unknown apps"
       permission. The file stays, as the second choice. */
    if (dl) {
      dl.classList.remove('pri');
      const tx = $('dlText');
      if (tx) tx.textContent = 'Download the file';
    }
  }

  function notReleased() {
    if (dl) {
      dl.removeAttribute('href');
      dl.setAttribute('aria-disabled', 'true');
      dl.classList.remove('pri');
      dl.classList.add('off');
      const tx = $('dlText');
      if (tx) tx.textContent = 'Not released yet';
    }
    const size = $('size');
    if (size) size.textContent = 'Coming soon';
    const note = $('dlNote');
    if (note) {
      note.textContent = 'The first version of the app is on its way. Check back here soon.';
      note.classList.remove('hide');
    }
  }

  /* THE PUBLISHED FILE'S RECORD, when the apk link is our storage's stable name (the only kind
     whose record sits beside it): epinoia.json in the same folder. "none" only on storage's own
     answer that there is no such record (400/404: nothing published), which makes the file link
     a dead one too. */
  async function published(apk) {
    const m = /^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/apps\/)[^/?#]+\.apk$/.exec(apk);
    if (!m) return { state: 'unknown' };
    const r = await getJson(m[1] + 'epinoia.json');
    if (r.status === 400 || r.status === 404) return { state: 'none' };
    if (!r.body || typeof r.body !== 'object') return { state: 'unknown' };
    const name = typeof r.body.versionName === 'string' && /^\d+(\.\d+){1,3}$/.test(r.body.versionName)
      ? r.body.versionName : '';
    return { state: 'ready', size: Number(r.body.bytes) || 0, versionName: name };
  }

  async function main() {
    const v = await getJson(versionUrl);
    const ver = v.body && typeof v.body === 'object' ? v.body : {};

    const apk = httpsUrl(ver.apk) ? ver.apk : APK_FALLBACK;
    if (dl) dl.href = apk;
    if (upd) upd.href = apk;

    if (httpsUrl(ver.play) && ver.play.indexOf(PLAY_PREFIX) === 0) showPlay(ver.play);

    const listedName = typeof ver.versionName === 'string' && /^\d+(\.\d+){1,3}$/.test(ver.versionName)
      ? ver.versionName : '';
    setVersion(listedName);

    /* AN UPDATE ONLY BELOW minShell. Website changes never need a new app; minShell is raised
       only when the site starts to depend on something a newer shell sends or does. */
    const minShell = whole(ver.minShell);
    if (inApp && twa && shellCode !== null && minShell !== null && shellCode < minShell) cls.add('update');

    /* Inside the app nothing below is on screen, unless an update is due, and an iPhone never
       shows the button at all; no need to ask about the file in either. */
    if ((inApp && !cls.contains('update')) || ios) return;

    const rel = await published(apk);
    if (rel.state === 'none') {
      if (!inApp) notReleased();
      return;
    }
    if (rel.state === 'ready') {
      /* THE VERSION YOU WILL ACTUALLY GET. version.json can run ahead of the release for the
         few minutes CI takes to build it. */
      if (rel.versionName) setVersion(rel.versionName);
      const size = $('size'), words = megabytes(rel.size);
      if (size && words) size.textContent = words;
    }
  }

  main().catch(() => { /* the static page already works: the contract link, no size */ });
}());
