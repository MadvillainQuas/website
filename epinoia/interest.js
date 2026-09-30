'use strict';
/* ============================================================================
   INTEREST — the time a reader spends on a league's pages, kept on THIS DEVICE (feedrank.js).

   One tiny include for the league, club, player, game, stats, fixtures, news and creators pages, loaded
   deferred after feedrank.js. It does nothing on its own: feedrank.js counts the time (only while the
   tab is visible and the reader has touched, scrolled or typed in the last 30 seconds, and at most 15
   minutes a league a session), for the league the page says it is about (window.__CS_LEAGUE_SLUG, or
   ?l=), and keeps it in localStorage (epinoia_feed_v1). It sends nothing: no network, no cookie, no
   account. It is a no-op when the reader has switched personalisation off (the feed's Personalise), when
   the page is nobody's league, and when storage is blocked. See docs/news-and-creators.md and the
   privacy page.
   ============================================================================ */
(function () {
  const FR = window.EpinoiaFeedRank;
  if (!FR || typeof FR.watchDwell !== 'function') return;
  try { FR.watchDwell(window); } catch (_) { /* never in the reader's way */ }
})();
