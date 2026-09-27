'use strict';
/* ============================================================================
   HOME — GLOBAL RECORDS.

   The season's single-game bests across every league, under the best
   performing players: the same Player / Team switch and the same cards as a
   league's front page, drawn by epinoia/records.js. This file only asks and
   places; which season counts in each league, the reads, the names and the
   cache are EpinoiaRecords.global. Each card says which league it is from.

   front.js runs it after the podiums. A season with no finished game anywhere
   is the off-season, and says so rather than leaving a blank panel.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H || typeof H.register !== 'function') return;

  H.register('records', async function (ctx) {
    const R = window.EpinoiaRecords;
    if (!R) throw new Error('records.js has not loaded');
    const res = await R.global();
    ctx.host.textContent = '';
    if (!res) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'No league has finished a game this season yet, so there are no records to show.';
      ctx.host.appendChild(d);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'hm-records';
    R.render(wrap, res.data, {
      teamsById: res.teamsById, base: ctx.base,
      season: 'this season · ' + res.leagues + (res.leagues === 1 ? ' league' : ' leagues')
    });
    ctx.host.appendChild(wrap);
    ctx.fadeIn(wrap);
  });
})();
