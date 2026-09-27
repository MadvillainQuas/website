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
    const filter = typeof H.who === 'function' ? H.who() : 'all';
    const withBar = node => {
      ctx.host.textContent = '';
      if (typeof H.whoBar === 'function') ctx.host.appendChild(H.whoBar());
      ctx.host.appendChild(node);
    };
    if (filter !== 'all') {
      const wait = document.createElement('div');
      wait.className = 'empty hm-wait';
      wait.textContent = 'Working out the records…';
      withBar(wait);
    }
    const res = await R.global({ filter });
    if (typeof H.who === 'function' && H.who() !== filter) return;     // the reader has moved on
    if (!res) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = ({
        u22: 'No record this season is held by a player listed as under 22.',
        men: 'No men’s league has finished a game this season yet.',
        women: 'No women’s league has finished a game this season yet.'
      })[filter] || 'No league has finished a game this season yet, so there are no records to show.';
      withBar(d);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'hm-records';
    const label = { u22: 'under 22 · ', men: 'men’s · ', women: 'women’s · ' }[filter] || '';
    R.render(wrap, res.data, {
      teamsById: res.teamsById, base: ctx.base,
      season: label + 'this season · ' + res.leagues + (res.leagues === 1 ? ' league' : ' leagues')
    });
    withBar(wrap);
    ctx.fadeIn(wrap);
  });
})();
