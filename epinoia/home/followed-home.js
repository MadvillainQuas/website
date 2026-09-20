'use strict';
/* ============================================================================
   HOME — MY FOLLOWED (Section for signed-in users)

   Shows recent results, upcoming games, and top players for followed leagues
   and clubs. Only displayed if the user is signed in and has followed items.

   Fetches:
     - User's fan preferences (followed leagues and teams)
     - Recent results for each (3 most recent)
     - Upcoming games (3 next games)
     - Top players for that league/club this week
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const CFG = window.EPINOIA_CONFIG;
  const D = window.EpinoiaData;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function teamName(t) {
    if (!t) return el('span', '', '');
    const span = el('span');
    if (t.short_name) {
      const short = el('span', 'team-init');
      short.textContent = t.short_name;
      span.appendChild(short);
    }
    const name = el('span', 'team-name');
    name.textContent = t.name || '';
    span.appendChild(name);
    return span;
  }

  async function api(path) {
    const headers = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
    try {
      const A = window.EpinoiaAccess;
      if (A && typeof A.authHeaders === 'function') {
        Object.assign(headers, A.authHeaders() || {});
      }
    } catch (_) { /* anonymous */ }
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, {
      cache: 'no-store',
      headers
    });
    if (r.status === 401 && headers.Authorization) {
      const r2 = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, {
        cache: 'no-store',
        headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' }
      });
      if (!r2.ok) throw new Error(r2.status + ' ' + path.split('?')[0]);
      return r2.json();
    }
    if (!r.ok) throw new Error(r.status + ' ' + path.split('?')[0]);
    return r.json();
  }

  async function getUserPrefs() {
    try {
      const rows = await api('fan_prefs?select=fav_league_ids,fav_team_ids&limit=1');
      return rows[0] || { fav_league_ids: [], fav_team_ids: [] };
    } catch (_) {
      return { fav_league_ids: [], fav_team_ids: [] };
    }
  }

  async function loadFollowedGames(followedIds, type) {
    if (!followedIds || followedIds.length === 0) return [];
    const hour = 3600 * 1000;
    const from = new Date(Date.now() - 7 * 24 * hour).toISOString();
    const to = new Date(Date.now() + 7 * 24 * hour).toISOString();

    if (type === 'league') {
      const ids = followedIds.map(id => `"${id}"`).join(',');
      return api(
        `games?select=id,tipoff_at,status,home:home_team_id(id,name,short_name),away:away_team_id(id,name,short_name),competitions!inner(id,seasons!inner(id,league_id))` +
        `&competitions.seasons.league_id=in.(${ids})` +
        `&tipoff_at=gte.${encodeURIComponent(from)}&tipoff_at=lte.${encodeURIComponent(to)}` +
        `&order=tipoff_at.asc&limit=100`
      );
    } else {
      const ids = followedIds.map(id => `"${id}"`).join(',');
      return api(
        `games?select=id,tipoff_at,status,home:home_team_id(id,name,short_name),away:away_team_id(id,name,short_name),competitions!inner(id,seasons!inner(id,league_id))` +
        `&or=(home_team_id.in.(${ids}),away_team_id.in.(${ids}))` +
        `&tipoff_at=gte.${encodeURIComponent(from)}&tipoff_at=lte.${encodeURIComponent(to)}` +
        `&order=tipoff_at.asc&limit=100`
      );
    }
  }

  function gameCard(g) {
    const row = el('div', 'fx-row');
    const link = el('a');
    link.href = `../game/?g=${g.id}`;

    const h = el('div', 'fx-side home');
    h.appendChild(teamName(g.home));
    link.appendChild(h);

    const st = el('div', 'fx-state');
    const score = el('div', 'fx-score');
    if (g.status === 'live') {
      st.appendChild(el('span', 'pulse'));
      st.appendChild(document.createTextNode('LIVE'));
    } else if (g.status === 'final') {
      score.textContent = `${g.home_score || 0}–${g.away_score || 0}`;
    } else {
      const t = new Date(g.tipoff_at);
      const h = String(t.getHours()).padStart(2, '0');
      const m = String(t.getMinutes()).padStart(2, '0');
      score.textContent = `${h}:${m}`;
    }
    if (score.textContent) st.appendChild(score);
    link.appendChild(st);

    const a = el('div', 'fx-side away');
    a.appendChild(teamName(g.away));
    link.appendChild(a);

    row.appendChild(link);
    return row;
  }

  async function paint() {
    const host = document.getElementById('homeFollowed');
    if (!host) return;

    try {
      const prefs = await getUserPrefs();
      const followedLeagues = prefs.fav_league_ids || [];
      const followedTeams = prefs.fav_team_ids || [];

      if (followedLeagues.length === 0 && followedTeams.length === 0) {
        document.getElementById('followed').hidden = true;
        return;
      }

      host.setAttribute('aria-busy', 'false');
      host.textContent = '';

      // Load all games for followed items
      const [leagueGames, teamGames] = await Promise.all([
        loadFollowedGames(followedLeagues, 'league'),
        loadFollowedGames(followedTeams, 'team')
      ]);

      const allGames = [...leagueGames, ...teamGames].sort(
        (a, b) => new Date(a.tipoff_at) - new Date(b.tipoff_at)
      );

      if (allGames.length === 0) {
        document.getElementById('followed').hidden = true;
        return;
      }

      // Separate results and upcoming
      const now = new Date();
      const results = allGames
        .filter(g => g.status === 'final' || (g.tipoff_at && new Date(g.tipoff_at) < now))
        .sort((a, b) => new Date(b.tipoff_at) - new Date(a.tipoff_at))
        .slice(0, 3);

      const upcoming = allGames
        .filter(g => g.status !== 'final' && g.tipoff_at && new Date(g.tipoff_at) >= now)
        .slice(0, 3);

      // Create dropdowns
      if (results.length > 0) {
        const section = el('div', 'followed-section');
        const header = el('div', 'followed-header');
        header.textContent = '📊 Recent results';
        section.appendChild(header);
        const games = el('div', 'followed-games');
        results.forEach(g => games.appendChild(gameCard(g)));
        section.appendChild(games);
        host.appendChild(section);
      }

      if (upcoming.length > 0) {
        const section = el('div', 'followed-section');
        const header = el('div', 'followed-header');
        header.textContent = '🎯 Coming up';
        section.appendChild(header);
        const games = el('div', 'followed-games');
        upcoming.forEach(g => games.appendChild(gameCard(g)));
        section.appendChild(games);
        host.appendChild(section);
      }

      // Show the section
      document.getElementById('followed').hidden = false;
    } catch (err) {
      console.error('Error loading followed section:', err);
      host.setAttribute('aria-busy', 'false');
      document.getElementById('followed').hidden = true;
    }
  }

  // Run after page loads
  function start() {
    const section = document.getElementById('followed');
    if (!section) return;

    // Always try to load - paint() will show/hide based on data
    paint().catch(err => {
      console.error('Error loading followed section:', err);
      section.hidden = true;
    });
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    setTimeout(start, 100);
  }
})();
