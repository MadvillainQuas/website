'use strict';
/* ============================================================================
   /epinoia/injuries/ — THE INJURY REPORT AND THE WAIVER WIRE.

   One page, two scopes:

     ?l=<slug>   one league's report, a dropdown per club
     (no ?l=)    every league on the platform, a dropdown per league and a
                 dropdown per club inside it — the global wire, off HOME's rail

   Nothing here decides who is missing: epinoia/injuries.js does that from the
   box scores the statistics pages already read (docs and rules there). This
   page asks for the season, hands it over, and draws the answer.

   EVERY CLUB IS LISTED, including the ones with nobody missing. A club absent
   from the page would read as "not checked" rather than "nobody out", and the
   set of dropdowns then changes shape every week.

   THE CLUB'S OWN BUTTON. A team manager (or their league's administrator) sees
   Released beside each player: the one fact the box scores cannot hold, because
   a released player never appears again and would otherwise sit here forever.
   Which clubs that is comes back in a single teams_i_manage call (0132), not
   one per club.
   ============================================================================ */
(function () {
  const qp = new URLSearchParams(location.search);
  const SLUG = qp.get('l') || '';
  const $ = id => document.getElementById(id);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
    if (x != null) n.textContent = x; return n; };

  const D = () => window.EpinoiaData;
  const I = () => window.EpinoiaInjuries;

  const body = $('wrBody');
  let mine = new Set();                 // club ids this viewer manages
  let firstOpen = true;

  const fail = m => { body.textContent = ''; body.removeAttribute('aria-busy');
    body.appendChild(el('div', 'empty', m)); };

  /* ---------------------------------------------------------- one league --- */
  /* league: { id, slug, name }; returns { node, out } or null when there is
     nothing to draw at all (no season, no games). */
  async function loadLeague(league) {
    const d = D();
    const seasons = await d.all('seasons?league_id=eq.' + encodeURIComponent(league.id) +
      '&select=id,name,starts_on,competitions(id)&order=starts_on.desc&limit=1');
    const s = seasons && seasons[0];
    const compIds = s && Array.isArray(s.competitions) ? s.competitions.map(c => c.id).filter(Boolean) : [];
    if (!compIds.length) return null;

    const S = await d.season(compIds, { trim: true });
    if (!S.games || !S.games.length) return null;

    const teams = await d.teamMeta(league.id);
    const clubIds = Object.keys(teams);
    /* the releases, and — for whoever manages a club here — which clubs those are */
    const [released] = await Promise.all([
      d.releases(clubIds),
      askMine(clubIds)
    ]);

    const rep = I().report({ games: S.games, pgs: S.pgs, released });
    const ids = rep.entries.map(e => e.playerId);
    let meta = {};
    if (ids.length) { try { meta = await d.playerMeta(ids); } catch (_) { meta = {}; } }

    return { league, rep, teams, meta, season: s, out: rep.entries.length };
  }

  /* WHICH CLUBS DO I MANAGE — one call for the whole page, and nothing at all
     when nobody is signed in. A failure here only means no buttons. */
  async function askMine(clubIds) {
    if (!clubIds.length) return;
    try {
      /* a reader who is signed out never loads the SDK, let alone makes the call */
      if (!(window.epinoiaMaybeSignedIn && window.epinoiaMaybeSignedIn())) return;
      const sb = window.epinoiaClientReady ? await window.epinoiaClientReady() : null;
      if (!sb) return;
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      const { data, error } = await sb.rpc('teams_i_manage', { p_teams: clubIds });
      if (error || !Array.isArray(data)) return;
      data.forEach(id => mine.add(String(id)));
    } catch (_) { /* no buttons, which is the safe way to be wrong */ }
  }

  /* ------------------------------------------------------------ drawing --- */
  function playerRow(e, L, meta) {
    const m = meta[e.playerId] || {};
    const row = el('div', 'wr-row' + (e.dnp ? ' is-dnp' : '') + (e.stale ? ' is-stale' : ''));
    const q = el('span', 'wr-q', e.dnp ? '–' : '?');
    q.setAttribute('aria-hidden', 'true');
    const who = el('div', 'wr-who');
    const name = el(m.slug || e.playerId ? 'a' : 'span', 'wr-name', m.name || 'Player');
    if (name.tagName === 'A') name.href = '../p/?p=' + encodeURIComponent(e.playerId);
    const line = el('span', 'wr-line', I().line(e, { stale: true }));
    who.append(name, line);
    row.append(q, who);
    if (mine.has(String(e.teamId))) row.appendChild(releaseButton(e, m));
    return row;
  }

  /* the club's own button. It is a toggle: released takes the player off this
     page and off every preview, and pressing it again puts them back. */
  function releaseButton(e, m) {
    const wrap = el('div', 'wr-act');
    const b = el('button', 'wr-rel', 'released');
    b.type = 'button';
    b.title = 'Mark ' + (m.name || 'this player') + ' as released — they leave the injury report and the game previews';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const sb = window.epinoiaClientReady ? await window.epinoiaClientReady() : null;
        if (!sb) throw new Error('not signed in');
        const { error } = await sb.rpc('set_player_released',
          { p_team: e.teamId, p_player: e.playerId, p_released: true, p_note: '' });
        if (error) throw error;
        const row = wrap.parentNode;
        const note = el('div', 'wr-note', (m.name || 'That player') + ' is released — off the report and the previews.');
        if (row && row.parentNode) row.parentNode.replaceChild(note, row);
      } catch (err) {
        b.disabled = false;
        const note = el('div', 'wr-note err', 'Could not do that: ' + ((err && err.message) || err));
        if (wrap.parentNode) wrap.parentNode.appendChild(note);
      }
    });
    wrap.appendChild(b);
    return wrap;
  }

  function clubBlock(L) {
    const frag = document.createDocumentFragment();
    /* clubs with somebody missing first, and the rest of the league after them:
       a reader came here for the absences, not for a register of every club */
    const ids = Object.keys(L.teams).sort((a, b) => {
      const na = (L.rep.byTeam.get(a) || []).length, nb = (L.rep.byTeam.get(b) || []).length;
      return nb - na || String((L.teams[a] || {}).name).localeCompare(String((L.teams[b] || {}).name));
    });
    ids.forEach(id => {
      const t = L.teams[id] || {};
      const list = L.rep.byTeam.get(id) || [];
      const det = el('details', 'ep-acc wr-club');
      det.dataset.club = id;
      if (list.length && firstOpen) { det.open = true; firstOpen = false; }
      const sum = el('summary');
      const label = el('span', 't', t.name || 'Club');
      if (window.epinoiaCrest) sum.appendChild(window.epinoiaCrest(
        { id: id, name: t.name, short_name: t.teamShort, colour: t.colour, logo_path: t.logo },
        { cls: 'ep-crest' }));
      sum.appendChild(label);
      sum.appendChild(el('span', 'n' + (list.length ? ' wr-out' : ''),
        list.length ? list.length + ' out' : 'full squad'));
      det.appendChild(sum);
      const holder = el('div', 'wr-list');
      if (!list.length) holder.appendChild(el('div', 'wr-note',
        'Everybody the club has been playing turned out in its last game.'));
      else list.forEach(e => holder.appendChild(playerRow(e, L, L.meta)));
      det.appendChild(holder);
      frag.appendChild(det);
    });
    return frag;
  }

  function leagueBlock(L) {
    const det = el('details', 'ep-acc wr-league');
    det.dataset.league = L.league.slug || L.league.id;
    if (L.out && firstOpen) det.open = true;
    const sum = el('summary');
    sum.appendChild(el('span', 't', L.league.name || 'League'));
    sum.appendChild(el('span', 'n' + (L.out ? ' wr-out' : ''),
      L.out ? L.out + ' out' : 'nobody out'));
    det.appendChild(sum);
    det.appendChild(clubBlock(L));
    return det;
  }

  /* --------------------------------------------------------------- boot --- */
  (async function boot() {
    const d = D();
    if (!d || !I()) return fail('Could not load.');
    try {
      if (SLUG) {
        const { league } = await d.context(SLUG, null);
        window.__CS_LEAGUE_SLUG = league.slug;
        $('wrCtx').textContent = league.name;
        $('wrTitle').textContent = league.name + ' — injury report';
        document.title = league.name + ' — injury report · Epinoia';
        const L = await loadLeague(league);
        body.textContent = '';
        body.removeAttribute('aria-busy');
        if (!L) return fail('No finished games in this season yet — the report fills in as games are finalised.');
        $('wrCount').textContent = L.out ? L.out + (L.out === 1 ? ' player out' : ' players out') : 'nobody out';
        body.appendChild(clubBlock(L));
        if (window.EpinoiaInitials && window.EpinoiaInitials.fill) window.EpinoiaInitials.fill(document);
        return;
      }

      /* the global wire: every league a reader may see, each drawn as it lands */
      let leagues = await d.all('leagues?select=id,slug,name,country,access_mode&order=name');
      const A = window.EpinoiaAccess;
      if (A && typeof A.loadMany === 'function') {
        try {
          await A.loadMany({ leagueIds: leagues.map(l => l.id) });
          leagues = leagues.filter(l => typeof A.canView !== 'function' || A.canView(l.id));
        } catch (_) { /* everything, which is what the database will enforce anyway */ }
      }
      body.textContent = '';
      body.removeAttribute('aria-busy');
      if (!leagues.length) return fail('No leagues yet.');

      let total = 0, done = 0;
      const slots = new Map();
      leagues.forEach(l => { const s = el('div'); slots.set(l.id, s); body.appendChild(s); });
      await Promise.all(leagues.map(async l => {
        let L = null;
        try { L = await loadLeague(l); } catch (_) { L = null; }
        done++;
        const slot = slots.get(l.id);
        if (!L) { if (slot) slot.remove(); }
        else { total += L.out; slot.replaceWith(leagueBlock(L)); }
        $('wrCount').textContent = total + (total === 1 ? ' player out' : ' players out') +
          (done < leagues.length ? ' so far…' : '');
      }));
      if (!body.children.length) fail('No finished games anywhere yet.');
      if (window.EpinoiaInitials && window.EpinoiaInitials.fill) window.EpinoiaInitials.fill(document);
    } catch (e) {
      fail('Could not load: ' + ((e && e.message) || e));
    }
  })();
})();
