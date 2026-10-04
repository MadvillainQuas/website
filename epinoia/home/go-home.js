'use strict';
/* ============================================================================
   HOME — EPINOIA GO, under the feed (2026-10-04).

   The GO page's own pieces, drawn by go.js (home()) in this section's hosts:
     - the two pills, "Games open to stamp now" and "Today and tomorrow": a hover or a press lists those games,
       the teams, the arena, and how far each one is (a press asks the phone where it is; a hover only uses a
       location this site already has), with the stamp itself a link to the GO page;
     - the arenas in the reader's country they have not stamped yet, sliding past (the country is the GO page's
       choice, kept in this browser, and can be changed here), an arena with a game open to stamp now lit up,
       the game shown under a pointer.
   The title and "open EPINOIA GO" go to the GO page. The section stays shut when EPINOIA GO is not open.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;
  H.register('go', async function (ctx) {
    const sec = document.getElementById('go');
    const G = window.EpinoiaGo;
    if (!sec || !G || typeof G.home !== 'function') return;
    const ok = await G.home({ pills: document.getElementById('homeGoToday'), sec: '#homeGoStripSec',
      pick: '#homeGoCountry', strip: '#homeGoStrip', goHref: ctx.base + 'go/' });
    if (!ok) { sec.hidden = true; return; }
    const pick = document.getElementById('homeGoCountry');
    if (pick && !pick.options.length) pick.hidden = true;            // no arena has a pin anywhere yet
    sec.hidden = false;
    ctx.fadeIn(sec);
  });
})();
