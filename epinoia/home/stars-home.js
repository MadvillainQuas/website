'use strict';
/* ============================================================================
   HOME — BEST PERFORMING PLAYERS (roadmap Phase 3).

   The monthly and weekly podiums across every league, with the league pages'
   top-10 toggle, drawn by epinoia/stars.js. This file only asks and places:
   the anchor, the windows, the per-league arithmetic, the names and the cache
   are all EpinoiaStars.global, so HOME and a league's front page cannot come to
   disagree about who a star is.

   front.js runs it after the fixtures have settled, because it is the heaviest
   read on the page; a second visit inside ten minutes costs one small request.

   AN EMPTY PODIUM SAYS WHY. No league with a final in the last month is not an
   error, it is the off-season, and a blank panel would look broken.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H || typeof H.register !== 'function') return;

  const quiet = (host, msg) => {
    host.textContent = '';
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = msg;
    host.appendChild(d);
  };

  H.register('stars', async function (ctx) {
    const ST = window.EpinoiaStars;
    if (!ST) throw new Error('stars.js has not loaded');
    const res = await ST.global({ base: ctx.base, now: ctx.now });

    const rows = ST.WINDOWS.map(w => res[w.key]).filter(Boolean);
    if (!rows.length) {
      quiet(ctx.host, res.anchor
        ? 'No player has met the minutes in any league’s latest month of games yet.'
        : 'No league has finished a game yet, so there are no best performers to show.');
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'hm-stars';
    ST.render(wrap, rows, { base: ctx.base });
    ctx.host.textContent = '';
    ctx.host.appendChild(wrap);
    ctx.fadeIn(wrap);
  });
})();
