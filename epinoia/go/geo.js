/* ============================================================================
   WHERE THE PHONE IS, ON ANY PHONE (epinoia/go/geo.js, 2026-10-05): the one place EPINOIA GO asks a device for its location - the GO page, the
   drop-down on HOME, the club page's and the game page's stamp buttons all use it - and the words for when it cannot.

     EpinoiaGeo.locate()      -> { lat, lng, accuracy, at } | { error: 'none' | 'insecure' | 'denied' | 'timeout' | 'unavailable' }
     EpinoiaGeo.help(error)   -> what the reader should do, for THEIR device and browser (iPhone, Android, a desktop; an in-app browser)
     EpinoiaGeo.env()         -> { ios, android, inapp, safari, chrome, firefox, samsung, edge, secure }

   WHY IT IS ONE CALL, MADE AT ONCE. Every browser asks the reader for permission the moment getCurrentPosition is called, and some (Safari
   on an iPhone, Firefox, a few Android browsers) only do so when the call is made straight from the tap: so locate() must be the first thing a
   click handler does, before any await. The first try is the precise one (GPS); if it times out or the device cannot fix it, one more try
   with the coarse one, which is better than nothing (the server's own accuracy check says if it is not enough). A refusal is final: the
   browser will not ask again, so it is answered at once with the way to switch it back on.
   ============================================================================ */
(function (root) {
  'use strict';
  const nav = () => (typeof navigator !== 'undefined' ? navigator : {});

  function env() {
    const n = nav(), u = String(n.userAgent || '');
    const ios = /iPad|iPhone|iPod/.test(u) || (/Macintosh/.test(u) && (n.maxTouchPoints || 0) > 1);
    const android = /Android/i.test(u);
    /* a browser inside another app (Facebook, Instagram, TikTok, a webview) often cannot ask at all */
    const inapp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Twitter|GSA\/|; wv\)/i.test(u);
    const edge = /EdgA|EdgiOS|Edg\//.test(u), samsung = /SamsungBrowser/.test(u), firefox = /Firefox|FxiOS/.test(u);
    const chrome = /Chrome|CriOS/.test(u) && !edge && !samsung;
    const safari = /Safari/.test(u) && !chrome && !firefox && !edge && !samsung;
    return { ios, android, inapp, safari, chrome, firefox, samsung, edge, secure: !(root && root.isSecureContext === false) };
  }

  function one(opts) {
    return new Promise(res => {
      try {
        nav().geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
          e => res({ error: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }),
          opts);
      } catch (_) { res({ error: 'unavailable' }); }
    });
  }

  /* THE PRECISE FIX, GIVEN A FEW SECONDS TO SETTLE (2026-10-08). Inside an arena a phone's first answer is often a cell
     mast's, a kilometre or more out, and its Wi-Fi and GPS answers only come after it: on 2026-10-04 sixteen of the
     seventeen tries at a stamp, by two fans at two arenas, were refused as too imprecise. So the phone is watched: the
     best fix it gives, as soon as one is within GOOD_M, else the best at the end of SETTLE_MS - a fix in hand is never
     thrown away for a timeout. The watch is the call made from the tap, so the permission question still comes up. */
  const GOOD_M = 100, SETTLE_MS = 10000;
  function settle(g, ms) {
    return new Promise(res => {
      let best = null, id = null, done = false, timer = 0;
      const finish = r => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (id != null) g.clearWatch(id); } catch (_) { /* gone */ }
        res(r);
      };
      timer = setTimeout(() => finish(best || { error: 'timeout' }), ms);
      try {
        id = g.watchPosition(p => {
          const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
          if (!best || !(best.accuracy <= f.accuracy)) best = f;
          if (best.accuracy != null && best.accuracy <= GOOD_M) finish(best);
        }, e => {
          if (e && e.code === 1) finish({ error: 'denied' });
          else if (!best && !(e && e.code === 3)) finish({ error: 'unavailable' });    // a timeout: keep watching to the end
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: ms });
      } catch (_) { finish({ error: 'unavailable' }); }
    });
  }

  async function locate(o) {
    const g = nav().geolocation;
    if (!g) return { error: 'none' };
    if (!env().secure) return { error: 'insecure' };
    let r = typeof g.watchPosition === 'function'
      ? await settle(g, (o && o.settleMs) || SETTLE_MS)
      : await one({ enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
    if (r.error === 'timeout' || r.error === 'unavailable') r = await one({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    return r;
  }

  function help(error) {
    const e = env();
    switch (error) {
      case 'none': return 'This browser cannot tell where it is. Open this page in Safari, Chrome or Firefox.';
      case 'insecure': return 'Location only works on a secure page (one that starts https://). Open the site from its normal address.';
      case 'denied':
        if (e.inapp) return 'This app’s built-in browser does not let a page see your location. Open this page in ' + (e.ios ? 'Safari' : 'Chrome') + ' (the menu has “Open in browser”), then tap Stamp game again.';
        if (e.ios) return 'Location is off for this browser. Open Settings › Privacy & Security › Location Services, make sure it is on, then find ' + (e.safari ? 'Safari Websites' : 'your browser') + ' and choose While Using the App. Come back and tap Stamp game again.';
        if (e.android) return 'Location is blocked for this site. Tap the lock icon beside the address, then Permissions › Location › Allow, and check Location is switched on in your phone’s quick settings. Then tap Stamp game again.';
        return 'Location is blocked for this site. Click the lock icon beside the address, set Location to Allow, then press Stamp game again.';
      case 'timeout': return 'Finding where you are took too long. Check that Location is switched on and try again.';
      default: return 'Your device could not work out where it is. Switch Location on in its settings, step outside or away from thick walls, and try again.';
    }
  }

  root.EpinoiaGeo = { locate, help, env };
})(typeof window !== 'undefined' ? window : globalThis);
