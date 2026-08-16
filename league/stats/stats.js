'use strict';
/* Season statistics — every player in the competition, in the full table.
   Same aggregation and same component as the leaders board; this page just
   gives it the whole width of the screen. */

const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const fail = m => { const h = $('#tbl'); h.textContent = ''; h.appendChild(el('div', 'ft-empty', m)); };

(async function boot() {
  try {
    const D = window.CourtsideData;
    const { league, comp } = await D.context(qp.get('l') || 'demo-league', qp.get('c'));
    $('#ctx').textContent = league.name;
    $('#title').textContent = league.name + ' — season statistics';
    if (!comp) return fail('This league has no competitions yet.');

    const S = await D.season(comp.id);
    if (!S.players.length) {
      return fail('No season statistics yet — these fill in as games are finalised in the scorer.');
    }
    const meta = await D.playerMeta(S.players.map(p => p.id));
    S.players.forEach(p => Object.assign(p, meta[p.id] || { name: 'Player' }));

    window.CourtsideTable.render({
      host: '#tbl', kind: 'player', sortKey: 'ppg', minGames: 1,
      filename: league.slug + '-season-stats',
      rows: S.players,
      playerHref: r => '../p/?p=' + encodeURIComponent(r.id)
    });
  } catch (e) { fail('Could not load: ' + e.message); }
})();
