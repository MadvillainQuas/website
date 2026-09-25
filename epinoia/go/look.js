'use strict';
/* ============================================================================
   LOOKING AROUND EPINOIA GO WITHOUT AN ACCOUNT (docs/epinoia-go.md 7.14).

   The GO page, THE FEED and the stamps page can all be opened by anybody, to see what they are for; what needs an
   account asks for one at the moment it is tried, and the database refuses it too (stamp_venue, the notes, the
   photographs and the settings are callable by a signed-in account only, 0165-0168). This file is the friendly half:
   a slim banner at the top of each page's main column for a visitor who is not signed in, saying so and
   offering the way in. Nothing for a signed-in fan; nothing until the session is known, so a fan is never
   shown it for a moment.
   ============================================================================ */
(function () {
  if (typeof document === 'undefined') return;
  /* the GO page and the stamps page have a main column; THE FEED is a frame with its brand bar on top */
  const where = () => {
    const m = document.querySelector('main.go-main');
    if (m) return { host: m, before: m.firstChild };
    const top = document.querySelector('.ep-frame.gp > .gp-top');
    return top ? { host: top.parentNode, before: top.nextSibling } : null;
  };

  async function boot() {
    const A = window.EpinoiaAccess;
    let s = null;
    try { s = A && A.sessionReady ? await A.sessionReady() : (A && A.session ? A.session() : null); } catch (_) { s = null; }
    const at = where();
    if (s || !at || document.getElementById('goLook')) return;
    /* the card look of the GO page's "your stamps" sign-in prompt (look.css) */
    const box = document.createElement('aside');
    box.id = 'goLook';
    box.className = 'go-look';
    box.setAttribute('role', 'note');
    const txt = box.appendChild(document.createElement('div'));
    const b = txt.appendChild(document.createElement('b'));
    b.textContent = 'You’re looking around.';
    const p = txt.appendChild(document.createElement('span'));
    p.textContent = 'Sign in to stamp arenas, add photographs and notes, and join the leaderboard.';
    const a = box.appendChild(document.createElement('a'));
    a.className = 'ep-btn pri';
    a.textContent = 'sign in';
    a.href = A && A.signinHref ? A.signinHref() : '../signin/';
    at.host.insertBefore(box, at.before);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
