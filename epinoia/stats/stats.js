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
    const D = window.EpinoiaData;
    const { league, comp, comps } = await D.context(qp.get('l') || 'demo-league', qp.get('c'));
    $('#ctx').textContent = league.name;
    $('#title').textContent = league.name + ' — season statistics';
    /* the route to team stats: the league page's Team Stats tab, for THIS league
       (and the same competition when one was chosen here) */
    const tl = $('#teamsLink');
    if (tl) tl.href = '../l/?l=' + encodeURIComponent(league.slug) +
      (qp.get('c') ? '&c=' + encodeURIComponent(qp.get('c')) : '') + '#teams';
    if (!comp) return fail('This league has no competitions yet.');

    /* THE SAME SCOPE THE LEAGUE PAGE USES, for the same reason: this table was
       reading one competition, so a page titled "season statistics" showed a
       single phase and disagreed with itself depending on which phase that was.
       A season is the league, its cup and its playoffs together. */
    let scope = 'all';
    const scopeIds = () => scope === 'all'
      ? (comps || []).map(c => c.id).filter(Boolean)
      : [scope];

    /* The table's renderer empties whatever host it is given, so the filter
       gets a host of its own — appending both to #tbl wiped the control. */
    const host = $('#tbl');
    host.textContent = '';
    const bar = el('div', 'scopebar');
    const board = el('div', 'boardhost');
    host.append(bar, board);

    async function draw() {
      board.textContent = '';
      const S = await D.season(scopeIds());
      if (!S.players.length) {
        board.appendChild(el('div', 'ft-empty',
          'No statistics for that selection yet — these fill in as games are finalised.'));
        return;
      }
      const meta = await D.playerMeta(S.players.map(p => p.id));
      S.players.forEach(p => Object.assign(p, meta[p.id] || { name: 'Player' }));
      window.EpinoiaTable.render({
        host: board, kind: 'player', sortKey: 'ppg', minGames: 1,
        filename: league.slug + '-season-stats',
        rows: S.players,
        playerHref: r => '../p/?p=' + encodeURIComponent(r.id)
      });
    }

    bar.appendChild(el('span', 'scopelab', 'covering'));
    const sel = document.createElement('select');
    sel.className = 'ep-input scopesel';
    const add = (v, label) => { const o = document.createElement('option');
      o.value = v; o.textContent = label; sel.appendChild(o); };
    add('all', 'the whole season · ' + (comps || []).length + ' competitions');
    (comps || []).forEach(c => add(c.id,
      c.name + (c.kind && c.kind !== 'league' ? ' · ' + c.kind : '')));
    sel.addEventListener('change', () => { scope = sel.value; draw(); });
    bar.appendChild(sel);

    await draw();
  } catch (e) { fail('Could not load: ' + e.message); }
})();
