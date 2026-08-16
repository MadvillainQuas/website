'use strict';
/* Team page — identity, record, roster, results. Public, read-only.
   Minors are filtered by RLS, not here: a U18 player simply never comes back
   from the players join, so this page cannot leak one by forgetting a check. */

const CFG = window.COURTSIDE_CONFIG;
const slug = new URLSearchParams(location.search).get('t');
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}

(async function boot() {
  if (!slug) return oops('No team specified.');
  try {
    const ts = await api(`teams?slug=eq.${encodeURIComponent(slug)}&select=*,leagues(name,slug)&limit=1`);
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
    document.title = team.name + ' · Courtside';

    await Promise.all([record(team, lg), roster(team), games(team)]);
  } catch (e) { oops('Could not load: ' + e.message); }
})();

function oops(msg) {
  $('#roster').textContent = ''; $('#games').textContent = '';
  $('#games').appendChild(el('div', 'empty', msg));
}

async function record(team) {
  const st = await api(`standings?team_id=eq.${team.id}&select=gp,w,l,pts_for,pts_against,diff,league_points,rank,streak&limit=1`);
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

async function roster(team) {
  const rows = await api(`roster_entries?team_id=eq.${team.id}&active=eq.true` +
                         `&select=jersey,position,players(first_name,last_name,slug,is_minor)&order=jersey`);
  const host = $('#roster'); host.textContent = '';
  if (!rows.length) { host.appendChild(el('div', 'empty', 'No players listed yet.')); return; }

  const t = el('table', 'cs-tbl'); t.style.minWidth = '0';
  const thead = el('thead'), hr = el('tr');
  ['#', 'PLAYER', 'POS'].forEach(h => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr); t.appendChild(thead);
  const tb = el('tbody');
  rows.forEach(r => {
    const p = r.players || {};
    const tr = el('tr');
    tr.appendChild(el('td', null, r.jersey || '–'));
    const nd = el('td');
    const name = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (p.slug) { const a = el('a', 'plain', name); a.href = '../p/?p=' + encodeURIComponent(p.slug); nd.appendChild(a); }
    else nd.textContent = name || 'Player';
    tr.appendChild(nd);
    tr.appendChild(el('td', null, r.position || ''));
    tb.appendChild(tr);
  });
  t.appendChild(tb); host.appendChild(t);
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
