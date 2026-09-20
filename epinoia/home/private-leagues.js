'use strict';
/* ============================================================================
   HOME — PRIVATE LEAGUES (Section for signed-in users)

   Shows private leagues the user is a member of, using league cards similar
   to the public leagues section. Only displayed if the user is signed in and
   is a member of any private leagues.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const CFG = window.EPINOIA_CONFIG;
  const MINT = '#93f2bf';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
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

  async function getPrivateLeagues() {
    try {
      // Get private leagues the user is part of
      // This queries league_members for the current user and joins with leagues
      const rows = await api(
        `leagues?select=id,slug,name,country,colour_a,colour_b,colour_source,logo_path,access_mode` +
        `&access_mode=eq.members&order=name.asc`
      );
      return rows || [];
    } catch (_) {
      return [];
    }
  }

  async function getTeamCounts() {
    try {
      const rows = await api('teams?select=league_id&league_id=not.is.null');
      const m = new Map();
      rows.forEach(r => {
        if (r.league_id) m.set(r.league_id, (m.get(r.league_id) || 0) + 1);
      });
      return m;
    } catch (_) {
      return new Map();
    }
  }

  function colorStyle(league) {
    if (!league.colour_a) return {};
    if (league.colour_source === 'default') return {};
    const style = {};
    if (/^#[0-9a-f]{6}$/i.test(league.colour_a)) {
      style['--plate-colour'] = league.colour_a;
    }
    return style;
  }

  function leagueCard(league, teamCount) {
    const card = el('div', 'plate');
    Object.assign(card.style, colorStyle(league));

    const link = el('a');
    link.href = `../?l=${encodeURIComponent(league.slug)}`;
    link.className = 'plate-link';

    const logo = el('div', 'plate-logo');
    if (league.logo_path) {
      const img = el('img');
      img.src = league.logo_path.startsWith('http')
        ? league.logo_path
        : `${CFG.supabaseUrl}/storage/v1/object/public/media-public/${league.logo_path}`;
      img.alt = league.name;
      img.onload = () => { logo.classList.add('img-loaded'); };
      img.onerror = () => { logo.classList.add('img-failed'); };
      logo.appendChild(img);
    }
    const monogram = el('div', 'plate-monogram');
    monogram.textContent = (league.name || '').split(' ').map(w => w[0]).join('').slice(0, 2);
    logo.appendChild(monogram);
    link.appendChild(logo);

    const info = el('div', 'plate-info');
    const name = el('div', 'plate-name');
    name.textContent = league.name;
    info.appendChild(name);

    const meta = el('div', 'plate-meta');
    if (league.country) {
      const country = el('span', 'plate-country');
      country.textContent = league.country;
      meta.appendChild(country);
    }
    if (teamCount > 0) {
      const clubs = el('span', 'plate-clubs');
      clubs.textContent = teamCount + (teamCount === 1 ? ' club' : ' clubs');
      meta.appendChild(clubs);
    }
    info.appendChild(meta);
    link.appendChild(info);

    card.appendChild(link);
    return card;
  }

  async function paint() {
    const host = document.getElementById('homePrivateLeagues');
    if (!host) return;

    try {
      const leagues = await getPrivateLeagues();
      if (leagues.length === 0) {
        document.getElementById('privateLeagues').hidden = true;
        return;
      }

      const teamCounts = await getTeamCounts();
      host.setAttribute('aria-busy', 'false');
      host.textContent = '';

      const rail = el('div', 'plate-rail');
      leagues.forEach(league => {
        const count = teamCounts.get(league.id) || 0;
        rail.appendChild(leagueCard(league, count));
      });
      host.appendChild(rail);

      document.getElementById('privateLeagues').hidden = false;
    } catch (err) {
      console.error('Error loading private leagues:', err);
      host.setAttribute('aria-busy', 'false');
      document.getElementById('privateLeagues').hidden = true;
    }
  }

  // Run after page loads
  function start() {
    const section = document.getElementById('privateLeagues');
    if (!section) return;

    // Always try to load - paint() will show/hide based on data
    paint().catch(err => {
      console.error('Error loading private leagues:', err);
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
