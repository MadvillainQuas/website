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
    const SB = window.EpinoiaSeasonBar;
    /* EVERY SEASON THIS LEAGUE HAS PLAYED, not only the newest (seasonbar.js):
       the same league / season / competitions read data.js context() makes, cut
       to the seasons that have games and with each one's competitions attached,
       so the chips below can offer them and changing season costs no request. */
    const ctx = await SB.context(D.get, qp.get('l') || 'demo-league', qp.get('s'));
    const league = ctx.league;
    let season = ctx.season;
    let comps = ctx.comps;
    const comp = comps[0] || null;
    /* WHAT THIS VIEWER MAY SEE (docs/memberships.md): asked now, by id, and settled before the
       table is drawn. The module gives up by itself after 4 s and answers open, and without it
       on the page nothing here changes. */
    const A = window.EpinoiaAccess;
    const accessReady = (A && typeof A.load === 'function')
      ? Promise.resolve().then(() => A.load({ leagueId: league.id })).catch(() => null)
      : Promise.resolve(null);
    /* the rail marks the league, and the page wears its colours (nav.js) */
    window.__CS_LEAGUE_SLUG = league.slug;
    $('#ctx').textContent = league.name + (season ? ' · ' + season.name : '');
    $('#title').textContent = league.name + ' — season statistics';
    /* ?s= on the way out, and only when it is worth carrying: every page opens on
       the current season by itself, so naming it would be a parameter on a link
       that means nothing. A season the reader chose does have to travel. */
    const seasonQ = () => (season && ctx.current && season.id !== ctx.current.id)
      ? '&s=' + encodeURIComponent(season.name) : '';
    /* the route to team stats: the league page's Team Stats tab, for THIS league
       (and the same competition when one was chosen here) */
    const tl = $('#teamsLink');
    const teamsHref = () => '../l/?l=' + encodeURIComponent(league.slug) +
      (qp.get('c') ? '&c=' + encodeURIComponent(qp.get('c')) : '') + seasonQ() + '#teams';
    if (tl) tl.href = teamsHref();
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

    /* THE SEASON, in the chips the rest of the platform uses (seasonbar.js).
       Above the table rather than in the "covering" select beside the phases:
       a season is which numbers these are, a phase is which part of them. */
    SB.mount({
      host: $('#seasonPick'), wrap: $('#seasonRow'),
      seasons: ctx.seasons, season,
      onPick: sn => {
        season = sn;
        comps = sn.comps;
        /* the phase filter named a competition of the season being left */
        scope = 'all';
        SB.syncUrl(sn);
        $('#ctx').textContent = league.name + ' · ' + sn.name;
        if (tl) tl.href = teamsHref();
        fillScopes();
        draw();
      }
    });

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
        /* fifty rows and a "show more": the whole league is a search away, and building
           every row on each filter change is what made the page slow on a phone */
        pageSize: 50,
        filename: league.slug + '-season-stats',
        /* the table drops the premium columns itself when this league's analytics are locked */
        leagueId: league.id, leagueSlug: league.slug,
        /* PICK UP TO FIVE AND COMPARE THEM (fulltable.js tray -> compare.js). No onCompare:
           this table's percentiles are one league's, which is exactly what the table's own
           comparison ranks over, so it opens the shared chart itself. */
        selectable: { max: 5 },
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
    /* refilled on a change of season: these are that season's phases, and last
       season's would ask the table for a competition it no longer has */
    function fillScopes() {
      sel.textContent = '';
      add('all', 'the whole season · ' + (comps || []).length + ' competitions');
      (comps || []).forEach(c => add(c.id,
        c.name + (c.kind && c.kind !== 'league' ? ' · ' + c.kind : '')));
      sel.value = scope;
    }
    fillScopes();
    sel.addEventListener('change', () => { scope = sel.value; draw(); });
    bar.appendChild(sel);

    await draw();
  } catch (e) { fail('Could not load: ' + e.message); }
})();
