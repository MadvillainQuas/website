'use strict';
/* ============================================================================
   HOME — THE FEED, section 'feed', under MY FOLLOWED.

   The section is feedview.js, the same file a league's front page draws its news with: six posts on the post card,
   For you (ranked on this device by feedrank.js: official partners, then the press, then the match reports, the
   group the reader opens more often climbing), Followed and Newest, and Personalise beside them. HOME's scope is
   every league: the newest 60 and, signed in, the newest 60 of what the reader follows.

   The choice is remembered in this browser under KEY (a new key, so everyone starts on For you and keeps what they
   then choose); nobody who has not chosen starts anywhere but For you.

   THE FOLLOW LIST'S TOKEN IS follow.js's (the stored session, the way nav.js reads it), as MY FOLLOWED's is:
   access.js sends no token on HOME. A database without the feed (0194 not taken) keeps the section shut.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;
  const KEY = 'epinoia.home.feed2';       // '...feed' held a choice made when Newest was an equal way in: everybody starts on For you again

  H.register('feed', async function (ctx) {
    const V = window.EpinoiaFeedView;
    if (!V) throw new Error('feedview.js is not loaded');
    const sec = document.getElementById('feed');
    await V.mount({
      sec, host: ctx.host, base: ctx.base, fadeIn: ctx.fadeIn, key: KEY,
      seg: document.getElementById('feedSeg'), all: document.getElementById('feedAll'),
      reveal: shown => { if (sec) sec.hidden = !shown; }
    });
  });
})();
