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

  /* the ALL / U22 / MEN'S / WOMEN'S row (front.js), then what it chose */
  const withBar = (host, node) => {
    host.textContent = '';
    if (typeof H.whoBar === 'function') host.appendChild(H.whoBar());
    host.appendChild(node);
  };
  const EMPTY = {
    u22: 'No player listed as under 22 has met the minutes in the latest month of games.',
    men: 'No player in a men’s league has met the minutes in the latest month of games.',
    women: 'No player in a women’s league has met the minutes in the latest month of games.'
  };

  H.register('stars', async function (ctx) {
    const ST = window.EpinoiaStars;
    if (!ST) throw new Error('stars.js has not loaded');
    const filter = typeof H.who === 'function' ? H.who() : 'all';
    /* a filtered podium is worked out on the reader's side, which takes a moment: say so */
    if (filter !== 'all') {
      const wait = document.createElement('div');
      wait.className = 'empty hm-wait';
      wait.textContent = 'Working out the podiums…';
      withBar(ctx.host, wait);
    }
    const res = await ST.global({ base: ctx.base, now: ctx.now, filter });
    if (typeof H.who === 'function' && H.who() !== filter) return;     // the reader has moved on

    const rows = ST.WINDOWS.map(w => res[w.key]).filter(Boolean);
    if (!rows.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = EMPTY[filter] || (res.anchor
        ? 'No player has met the minutes in any league’s latest month of games yet.'
        : 'No league has finished a game yet, so there are no best performers to show.');
      withBar(ctx.host, d);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'hm-stars';
    ST.render(wrap, rows, { base: ctx.base });
    withBar(ctx.host, wrap);
    ctx.fadeIn(wrap);
  });
})();
