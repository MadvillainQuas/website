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
    /* WHAT THIS VIEWER MAY SEE (docs/memberships.md): asked now, by id, and settled before the
       table is drawn. The module gives up by itself after 4 s and answers open, and without it
       on the page nothing here changes. */
    const A = window.EpinoiaAccess;
    const accessReady = (A && typeof A.load === 'function')
      ? Promise.resolve().then(() => A.load({ leagueId: league.id })).catch(() => null)
      : Promise.resolve(null);
    $('#ctx').textContent = league.name;
    $('#title').textContent = league.name + ' — season statistics';
    /* the route to team stats: the league page's Team Stats tab, for THIS league
       (and the same competition when one was chosen here) */
    const tl = $('#teamsLink');
    if (tl) tl.href = '../l/?l=' + encodeURIComponent(league.slug) +
      (qp.get('c') ? '&c=' + encodeURIComponent(qp.get('c')) : '') + '#teams';
    if (!comp) return fail('This league has no competitions yet.');

    /* A MEMBERS-ONLY LEAGUE closed to this viewer: the card instead of the table, and no season
       read behind it -- the database refuses those rows, and an empty table would look broken
       rather than closed. Only on a known answer; anything else draws the table. */
    await accessReady;
    const shut = () => { const st = A && typeof A.get === 'function' ? A.get(league.id) : null;
      return !!(st && st.known) && typeof A.canView === 'function' && !A.canView(league.id); };
    const paywalled = shut();
    /* THE ANSWER CAN MOVE UNDER A DRAWN PAGE (a sign-in elsewhere, an answer after the time
       limit, the admin preview switch). The table relocks its own columns; the card is the one
       thing this page decided, so only a change to it draws the page again, from the top. On a
       change of account the new account's answer is waited for, not the empty state between. */
    if (A && typeof A.onChange === 'function') {
      const check = () => { if (shut() !== paywalled) location.reload(); };
      try {
        A.onChange(d => {
          if (d && d.leagueId && d.leagueId !== league.id) return;
          if (d && d.reason === 'auth' && typeof A.load === 'function') {
            Promise.resolve().then(() => A.load({ leagueId: league.id })).then(check, () => {});
          } else check();
        });
      } catch (_) { /* the page as drawn */ }
    }
    if (paywalled) {
      const h = $('#tbl'); h.textContent = '';
      if (typeof A.paywallHTML === 'function') h.innerHTML = A.paywallHTML({ league });
      return;
    }

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
        /* the table drops the premium columns itself when this league's analytics are locked */
        leagueId: league.id, leagueSlug: league.slug,
        rows: S.players,
        playerHref: r => '../p/?p=' + encodeURIComponent(r.id),
        /* RAPM on request: it needs every stint of the scope, which means reading the
           logs of every game in it, so it is not paid for by somebody who only wanted
           points per game. The table's button calls this and puts the answer on the rows. */
        rapm: window.EpinoiaRAPM
          ? (onProgress => window.EpinoiaRAPM.season(D, S.games.map(g => g.id), onProgress))
          : null
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
