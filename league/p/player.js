'use strict';
/* Player page — identity, season averages, game log.
   A minor's row is withheld by RLS, so this page simply gets nothing back for
   one and says so, rather than relying on a check it could forget. */

const CFG = window.COURTSIDE_CONFIG;
const slug = new URLSearchParams(location.search).get('p');
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const num = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}
function table(host, cols, rows) {
  host.textContent = '';
  if (!rows.length) { host.appendChild(el('div', 'empty', 'Nothing yet.')); return; }
  const t = el('table', 'cs-tbl'); t.style.minWidth = (cols.length * 62) + 'px';
  const th = el('thead'), hr = el('tr');
  cols.forEach(c => hr.appendChild(el('th', null, c[0])));
  th.appendChild(hr); t.appendChild(th);
  const tb = el('tbody');
  rows.forEach(r => { const tr = el('tr');
    cols.forEach(c => tr.appendChild(el('td', null, c[1](r))));
    tb.appendChild(tr); });
  t.appendChild(tb); host.appendChild(t);
}

(async function boot() {
  if (!slug) return fail('No player specified.');
  try {
    const ps = await api(`players?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
    if (!ps.length) {
      return fail('This profile is not public. Under-18 players are only visible to their club.');
    }
    const pl = ps[0];
    const name = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
    $('#name').textContent = name;
    document.title = name + ' · Courtside';

    const re = await api(`roster_entries?player_id=eq.${pl.id}&select=jersey,position,teams(name,slug,colour)&order=created_at.desc&limit=1`);
    const cur = re[0] || {};
    const team = cur.teams || {};
    const colour = team.colour || '#93f2bf';
    document.documentElement.style.setProperty('--team-a', colour);
    $('#num').textContent = cur.jersey || '—';
    $('#sub').textContent = [team.name, cur.position].filter(Boolean).join(' · ') || 'Free agent';
    $('#ctx').textContent = team.name ? team.name + ' · ' + name : name;

    // season averages
    const ss = await api(`player_season_stats?player_id=eq.${pl.id}&select=*`);
    const tiles = $('#tiles'); tiles.textContent = '';
    if (ss.length) {
      const s = ss[0];
      [['games', s.gp], ['pts', num(s.ppg)], ['reb', num(s.rpg)], ['ast', num(s.apg)],
       ['ts%', num(s.ts)], ['efg%', num(s.efg)]]
        .forEach(([l, v]) => { const d = el('div', 'tile');
          d.append(el('div', 'v', v), el('div', 'l', l)); tiles.appendChild(d); });
    } else {
      tiles.appendChild(el('div', 'empty', 'No finalised games yet.'));
    }

    table($('#seasons'), [
      ['SEASON', r => r.season_id ? '—' : '—'],
      ['GP', r => r.gp], ['MIN', r => num(r.min)], ['PTS', r => r.pts],
      ['PPG', r => num(r.ppg)], ['RPG', r => num(r.rpg)], ['APG', r => num(r.apg)],
      ['FG', r => `${r.fgm}-${r.fga}`], ['3PT', r => `${r.p3m}-${r.p3a}`],
      ['FT', r => `${r.ftm}-${r.fta}`], ['EFG%', r => num(r.efg)], ['TS%', r => num(r.ts)]
    ], ss);

    // game log
    const gl = await api(`player_game_stats?player_uuid=eq.${pl.id}` +
      `&select=game_id,stats,games(tipoff_at,home_score,away_score,status)&limit=40`);
    const rows = gl.filter(r => r.games).sort((a, b) =>
      new Date(b.games.tipoff_at || 0) - new Date(a.games.tipoff_at || 0));
    table($('#log'), [
      ['DATE', r => r.games.tipoff_at ? new Date(r.games.tipoff_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'],
      ['MIN', r => Math.round((r.stats.min || 0) / 60000) + "'"],
      ['PTS', r => r.stats.pts], ['REB', r => (r.stats.or || 0) + (r.stats.dr || 0)],
      ['AST', r => r.stats.ast], ['STL', r => r.stats.stl], ['BLK', r => r.stats.blk],
      ['TO', r => r.stats.to], ['PF', r => r.stats.pf],
      ['+/-', r => (r.stats.pm > 0 ? '+' : '') + r.stats.pm]
    ], rows);
  } catch (e) { fail('Could not load: ' + e.message); }
})();

function fail(msg) {
  ['#tiles', '#seasons', '#log'].forEach(s => { const h = $(s); h.textContent = ''; });
  $('#seasons').appendChild(el('div', 'empty', msg));
}
