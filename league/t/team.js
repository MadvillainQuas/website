'use strict';
/* ============================================================================
   Team profile — identity, record, team statistics, roster, results.

   The statistics table is the same component the leaders board and the season
   page use, so a column means the same thing wherever you read it. Minors are
   filtered by RLS, not here: a U18 player never comes back from the players
   join, so this page cannot leak one by forgetting a check.
   ============================================================================ */

const CFG = window.COURTSIDE_CONFIG;
const T = window.CourtsideTable;
const want = new URLSearchParams(location.search).get('t') || '';
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want);

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = (v, d = '—') => (v == null ? d : Number(v).toFixed(1));

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

function oops(msg) {
  ['#roster', '#games', '#teamstats'].forEach(s => { const h = $(s); if (h) h.textContent = ''; });
  $('#games').appendChild(el('div', 'empty', msg));
}

(async function boot() {
  if (!want) return oops('No team specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    const ts = await api(`teams?${key}=eq.${encodeURIComponent(want)}&select=*,leagues(id,name,slug)&limit=1`);
    if (!ts.length) return oops('Team not found.');
    const team = ts[0];
    const colour = team.colour || '#93f2bf';
    document.documentElement.style.setProperty('--team-a', colour);

    $('#badge').style.background = colour;
    $('#badge').textContent = team.short_name || (team.name || '?').slice(0, 2).toUpperCase();
    $('#tname').textContent = team.name;
    $('#tname').style.color = colour;
    const lg = team.leagues || {};
    $('#tsub').textContent = lg.name || 'Independent';
    $('#ctx').textContent = lg.name ? lg.name + ' · ' + team.name : team.name;
    if (lg.slug) $('#leagueLink').href = '../l/?l=' + encodeURIComponent(lg.slug);
    else $('#leagueLink').style.display = 'none';
    document.title = team.name + ' · Courtside';

    await Promise.all([record(team), teamStats(team), roster(team), games(team)]);
  } catch (e) { oops('Could not load: ' + e.message); }
})();

async function record(team) {
  const st = await api(`standings?team_id=eq.${team.id}` +
    `&select=gp,w,l,pts_for,pts_against,diff,league_points,rank,streak&limit=1`);
  const wrap = $('#rec'); wrap.textContent = '';
  const s = st[0];
  const cells = s
    ? [['rank', s.rank ?? '—'], ['record', `${s.w}-${s.l}`], ['played', s.gp],
       ['pts for', s.pts_for], ['pts against', s.pts_against],
       ['diff', (s.diff > 0 ? '+' : '') + s.diff], ['streak', s.streak || '—']]
    : [['record', '0-0'], ['played', 0]];
  cells.forEach(([l, v]) => {
    const d = el('div'); d.append(el('div', 'v', v), el('div', 'l', l)); wrap.appendChild(d);
  });
}

/* ------------------------------------------------------------ team stats --- */
/* Two readings of the same season: the team's own line, and every player on it
   through the full table. The team line is shown as tiles because there is
   only one row of it — a one-row table is a worse way to read a single line. */
async function teamStats(team) {
  const host = $('#teamstats'); host.textContent = '';
  let rows = [];
  try { rows = await api(`team_season_stats?team_id=eq.${team.id}&select=*`); }
  catch (e) { host.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return; }

  if (!rows.length) {
    host.appendChild(el('div', 'empty',
      'No team statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  const s = rows[0];

  const tiles = el('div', 'tiles');
  [['ppg', n1(s.ppg), true], ['opp ppg', n1(s.papg), false],
   ['diff', (s.diff > 0 ? '+' : '') + s.diff, false],
   ['efg%', n1(s.efg), true], ['ts%', n1(s.ts), false],
   ['ortg', n1(s.ortg), true], ['pace', n1(s.pace), false],
   ['ast/to', s.ast_to == null ? '—' : Number(s.ast_to).toFixed(2), false],
   ['reb', s.reb, false], ['ast', s.ast, false],
   ['stl', s.stl, false], ['blk', s.blk, false],
   ['paint', s.paint, false], ['fast', s.fast, false],
   ['2nd chance', s.second_chance, false], ['off turnovers', s.pts_off_to, false],
   ['bench', s.bench, false], ['turnovers', s.tov, false]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v == null ? '—' : v), el('div', 'l', l));
      tiles.appendChild(d);
    });
  host.appendChild(tiles);

  /* every player on the team, same table as the leaders board */
  let ps = [];
  try { ps = await api(`player_season_stats?team_id=eq.${team.id}&select=*`); } catch (_) {}
  if (ps.length) {
    const sub = el('div');
    host.appendChild(sub);
    T.render({
      host: sub, kind: 'player', sortKey: 'ppg', showMinGames: false,
      filename: (team.slug || 'team') + '-players',
      rows: ps.map(r => ({ ...r,
        name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || 'Player',
        teamName: r.team_short || r.team_name || '',
        teamShort: r.team_short || '', colour: r.team_colour || null })),
      playerHref: r => '../p/?p=' + encodeURIComponent(r.player_id || r.player_slug || '')
    });
  }
}

async function roster(team) {
  const rows = await api(`roster_entries?team_id=eq.${team.id}&active=eq.true` +
                         `&select=jersey,position,players(id,first_name,last_name,slug,is_minor)&order=jersey`);
  const host = $('#roster'); host.textContent = '';
  if (!rows.length) { host.appendChild(el('div', 'empty', 'No players listed yet.')); return; }

  const wrap = el('div', 'ft-wrap');
  const t = el('table', 'ft');
  const thead = el('thead'), hr = el('tr');
  ['#', 'PLAYER', 'POS'].forEach((h, i) => hr.appendChild(el('th', i < 2 ? 'stick c' + i : '', h)));
  thead.appendChild(hr); t.appendChild(thead);
  const tb = el('tbody');
  rows.sort((a, b) => (+a.jersey || 99) - (+b.jersey || 99)).forEach(r => {
    const p = r.players || {};
    const tr = el('tr');
    tr.appendChild(el('td', 'stick c0', r.jersey || '–'));
    const nd = el('td', 'stick c1');
    const cell = el('div', 'ft-name');
    const name = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (p.id) { const a = el('a', null, name); a.href = '../p/?p=' + encodeURIComponent(p.id); cell.appendChild(a); }
    else cell.appendChild(el('span', null, name || 'Player'));
    nd.appendChild(cell); tr.appendChild(nd);
    tr.appendChild(el('td', null, r.position || ''));
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);
}

async function games(team) {
  const gs = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
    `&select=id,tipoff_at,status,home_score,away_score,home_team_id,venue,` +
    `home:home_team_id(name,slug),away:away_team_id(name,slug)&order=tipoff_at.desc`);
  const host = $('#games'); host.textContent = '';
  if (!gs.length) { host.appendChild(el('div', 'empty', 'No games yet.')); return; }

  gs.forEach(g => {
    const home = g.home_team_id === team.id;
    const opp = home ? (g.away || {}) : (g.home || {});
    const us = home ? g.home_score : g.away_score;
    const them = home ? g.away_score : g.home_score;
    const final = g.status === 'final';

    const row = el('div', 'fx');
    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    row.appendChild(el('div', 'd', when ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'TBC'));
    row.appendChild(el('div', 'o', (home ? 'v ' : '@ ') + (opp.name || '—')));
    row.appendChild(el('div', 's', final ? `${us}–${them}` : (g.status === 'live' ? 'LIVE' : '')));
    const res = final ? (us > them ? 'W' : 'L') : (g.status === 'live' ? 'LIVE' : (g.venue || 'SCHEDULED'));
    row.appendChild(el('div', 'r ' + (final ? (us > them ? 'w' : 'ls') : ''), res));
    if (final || g.status === 'live') {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => location.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase');
    }
    host.appendChild(row);
  });
}
