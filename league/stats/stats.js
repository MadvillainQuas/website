'use strict';
/* ============================================================================
   Season statistics — every player in the competition, in the full table.

   The table itself is league/fulltable.js, the same component the leaders
   board and the team pages use, so a column means the same thing wherever it
   is read and there is only one place to fix a mistake.
   ============================================================================ */

const CFG = window.COURTSIDE_CONFIG;
const T = window.CourtsideTable;
const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

function fail(m) { const h = $('#tbl'); h.textContent = ''; h.appendChild(el('div', 'ft-empty', m)); }

(async function boot() {
  try {
    const leagueSlug = qp.get('l') || 'demo-league';
    const lg = (await api(`leagues?slug=eq.${encodeURIComponent(leagueSlug)}&select=id,name,slug&limit=1`))[0];
    if (!lg) return fail('League not found.');
    $('#ctx').textContent = lg.name;
    $('#title').textContent = lg.name + ' — season statistics';

    let comp = qp.get('c');
    if (!comp) {
      const sn = (await api(`seasons?league_id=eq.${lg.id}&select=id&order=starts_on.desc&limit=1`))[0];
      if (sn) comp = ((await api(`competitions?season_id=eq.${sn.id}&select=id&limit=1`))[0] || {}).id;
    }
    if (!comp) return fail('This league has no competitions yet.');

    // names are joined into the view itself — PostgREST cannot embed into a view
    const raw = await api(`player_season_stats?competition_id=eq.${comp}&select=*`);
    if (!raw.length) {
      return fail('No season statistics yet — these fill in as games are finalised in the scorer.');
    }

    T.render({
      host: '#tbl',
      kind: 'player',
      sortKey: 'ppg',
      minGames: 1,
      filename: lg.slug + '-season-stats',
      rows: raw.map(r => ({
        ...r,
        name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || 'Player',
        teamName: r.team_short || r.team_name || '',
        teamShort: r.team_short || '',
        colour: r.team_colour || null
      })),
      playerHref: r => '../p/?p=' + encodeURIComponent(r.player_id || r.player_slug || '')
    });
  } catch (e) { fail('Could not load: ' + e.message); }
})();
