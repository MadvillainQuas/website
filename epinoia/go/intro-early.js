'use strict';
/* ============================================================================
   THE INTRO, UP BEFORE THE PAGE PAINTS (Louie, 2026-09-24: "make sure the username entry screen shows
   instantly and doesn't lag for a second then pop up").

   The GO page's intro (go.js intro) needs to know two things - is a fan signed in, and do they have a
   username - and the second is a question to the database, which answers after the page has already
   painted. So this file, loaded in the page's head (not deferred), decides from what this browser
   already knows and puts the screen up at once:

     signed in, known to have no username    the username prompt ('ask'), every visit until they choose
                                              one (or say "later", for this visit)
     signed in, known to have one             nothing - or, on the very first visit, the black screen
                                              that says "Have Fun!" ('welcome')
     signed in, not known yet                 the black screen with nothing on it ('wait'), for as long
                                              as the database takes to say which
     signed out                               nothing: a visitor looks around first (7.14), and every
                                              action asks for an account when it is tried

   It only reads this browser's storage: the session access.js keeps (sb-<project>-auth-token), and
   what go.js remembers (epinoia_go_intro, epinoia_go_intro_later, epinoia_go_uname - whether this
   account has a username, never the name). go.js takes the screen over once it knows.
   ============================================================================ */
(function () {
  var html = document.documentElement;
  function get(area, k) { try { return window[area].getItem(k); } catch (_) { return null; } }
  function sub(tok) {
    try {
      var p = String(tok).split('.')[1];
      return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
    } catch (_) { return null; }
  }
  var seen = get('localStorage', 'epinoia_go_intro') === '1';
  var later = get('sessionStorage', 'epinoia_go_intro_later') === '1';
  var uid = null, signedIn = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!/^sb-[a-z0-9]+-auth-token$/.test(key)) continue;
      var j = JSON.parse(localStorage.getItem(key) || 'null') || {};
      var cs = j.currentSession || {};
      var tok = j.access_token || cs.access_token;
      if (!tok) continue;
      var exp = Number(j.expires_at || cs.expires_at) || 0;
      // an expired token that can be refreshed is still somebody signed in (access.js refreshes it)
      if (j.refresh_token || cs.refresh_token || !exp || exp * 1000 > Date.now()) {
        signedIn = true;
        uid = (j.user && j.user.id) || (cs.user && cs.user.id) || sub(tok);
      }
    }
  } catch (_) { /* no storage: go.js decides, a moment later */ }
  var named = null;
  try {
    var c = JSON.parse(get('localStorage', 'epinoia_go_uname') || 'null');
    if (c && uid && c.u === uid) named = !!c.has;
  } catch (_) { /* not known */ }
  var mode = null;
  if (signedIn) {
    if (named === true) mode = seen ? null : 'welcome';
    else if (named === false) mode = later ? null : 'ask';
    else mode = seen && later ? null : 'wait';
  } else {
    mode = null;
  }
  if (mode) {
    html.setAttribute('data-go-intro', mode);
    html.classList.add('go-intro-open');
  }
})();
