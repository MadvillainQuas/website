'use strict';
/* ============================================================================
   Player profile.

   Reached from every place a player's name appears — box score, leaders, the
   season table, a team's roster — by id, so a rename never breaks the link.
   ?p= accepts either the uuid or the slug; ids are what the tables link with
   and slugs are what a person would type.

   A minor is withheld by RLS, so this page simply gets nothing back for one
   and says so. It never has to remember to check.
   ============================================================================ */

const CFG = window.COURTSIDE_CONFIG;
const T = window.CourtsideTable;
const want = new URLSearchParams(location.search).get('p') || '';
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

function fail(msg) {
  $('#seasons').textContent = '';
  $('#seasons').appendChild(el('div', 'empty', msg));
  $('#log').textContent = '';
}

/* --------------------------------------------------------------- identity --- */
function paintIdentity(pl, entry, team) {
  const name = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
  $('#name').textContent = name;
  document.title = name + ' · Courtside';

  const colour = (team && team.colour) || '#93f2bf';
  document.documentElement.style.setProperty('--team-a', colour);

  /* Photo. media rows are only readable once approved, and a minor's needs
     recorded guardian consent — both enforced in the database, so if a photo
     comes back it is publishable. Initials stand in when it does not. */
  const box = $('#photo');
  if (pl.photo_url) {
    const img = document.createElement('img');
    img.src = pl.photo_url;
    img.alt = name;
    img.addEventListener('error', () => img.remove());   // never a broken frame
    box.textContent = '';
    box.appendChild(img);
  } else {
    $('#ini').textContent = ((pl.first_name || '?')[0] + (pl.last_name || '')[0] || '')
      .toUpperCase() || '—';
  }
  if (entry && entry.jersey) {
    const num = el('span', 'num', entry.jersey);
    num.style.background = colour;
    box.appendChild(num);
  }

  const sub = $('#sub'); sub.textContent = '';
  if (team && team.name) {
    const a = el('a', null, team.name);
    a.href = '../t/?t=' + encodeURIComponent(team.slug || '');
    sub.appendChild(a);
    $('#teamLink').href = a.href;
  } else {
    sub.appendChild(el('span', null, 'Free agent'));
    $('#teamLink').style.display = 'none';
  }
  if (entry && entry.position) sub.appendChild(el('span', 'pos-chip', entry.position));
  if (pl.birth_year) sub.appendChild(el('span', null, 'born ' + pl.birth_year));
  $('#ctx').textContent = [(team || {}).name, name].filter(Boolean).join(' · ');
}

function paintTiles(s) {
  const host = $('#tiles'); host.textContent = '';
  if (!s) {
    host.appendChild(el('div', 'empty', 'No finalised games yet.'));
    return;
  }
  [['games', s.gp, false], ['pts', n1(s.ppg), true], ['reb', n1(s.rpg), true],
   ['ast', n1(s.apg), true], ['efg%', n1(s.efg), false], ['ts%', n1(s.ts), false],
   ['min', n1(s.min), false], ['+/-', (s.pm > 0 ? '+' : '') + (s.pm ?? '—'), false]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v), el('div', 'l', l));
      host.appendChild(d);
    });
}

/* -------------------------------------------------------------- game log --- */
function paintLog(rows) {
  const host = $('#log'); host.textContent = '';
  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No games yet.'));
    return;
  }
  $('#logNote').textContent = rows.length + (rows.length === 1 ? ' game' : ' games');

  const wrap = el('div', 'ft-wrap');
  const t = el('table', 'ft');
  const head = ['DATE', 'OPP', 'RES', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FG', '3PT', 'FT', '+/-'];
  const thead = el('thead'), hr = el('tr');
  head.forEach((h, i) => hr.appendChild(el('th', i < 2 ? 'stick c' + i : '', h)));
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const s = r.stats || {};
    const g = r.games || {};
    const tr = el('tr');
    const date = g.tipoff_at
      ? new Date(g.tipoff_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

    const d0 = el('td', 'stick c0', date); tr.appendChild(d0);

    const oppTd = el('td', 'stick c1');
    const cell = el('div', 'ft-name');
    if (r.__opp) {
      const a = el('a', null, (r.__home ? 'v ' : '@ ') + r.__opp.name);
      a.href = '../t/?t=' + encodeURIComponent(r.__opp.slug || '');
      cell.appendChild(a);
    } else cell.appendChild(el('span', null, '—'));
    oppTd.appendChild(cell); tr.appendChild(oppTd);

    const res = el('td', null, r.__res || '');
    if (r.__res && r.__res.startsWith('W')) res.classList.add('pos');
    if (r.__res && r.__res.startsWith('L')) res.classList.add('neg');
    tr.appendChild(res);

    const boxLink = '../game/?g=' + encodeURIComponent(r.game_id) + '&mode=supabase';
    [Math.round((s.min || 0) / 60000) + "'", s.pts, (s.or || 0) + (s.dr || 0), s.ast,
     s.stl, s.blk, s.to, s.pf,
     `${(s.p2m || 0) + (s.p3m || 0)}-${(s.p2a || 0) + (s.p3a || 0)}`,
     `${s.p3m || 0}-${s.p3a || 0}`, `${s.ftm || 0}-${s.fta || 0}`]
      .forEach(v => tr.appendChild(el('td', null, v)));

    const pmTd = el('td', null, (s.pm > 0 ? '+' : '') + (s.pm ?? ''));
    if (s.pm > 0) pmTd.classList.add('pos'); else if (s.pm < 0) pmTd.classList.add('neg');
    tr.appendChild(pmTd);

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => { location.href = boxLink; });
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);
}

/* ------------------------------------------------------------------- boot --- */
(async function boot() {
  if (!want) return fail('No player specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    const ps = await api(`players?${key}=eq.${encodeURIComponent(want)}&select=*&limit=1`);
    if (!ps.length) {
      return fail('This profile is not public. Under-18 players are only visible to their club.');
    }
    const pl = ps[0];

    const re = await api(`roster_entries?player_id=eq.${pl.id}` +
      `&select=jersey,position,teams(id,name,slug,colour,short_name)&order=created_at.desc&limit=1`);
    const entry = re[0] || {};
    const team = entry.teams || null;
    paintIdentity(pl, entry, team);

    /* season lines — the same full table as everywhere else */
    const ss = await api(`player_season_stats?player_id=eq.${pl.id}&select=*`);
    paintTiles(ss[0]);
    $('#seasonNote').textContent = ss.length
      ? ss.length + (ss.length === 1 ? ' season' : ' seasons') : '';

    if (ss.length) {
      T.render({
        host: '#seasons', kind: 'player', sortKey: 'gp',
        showMinGames: false,
        filename: (pl.slug || 'player') + '-seasons',
        rows: ss.map(r => ({ ...r,
          name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(),
          teamName: r.team_short || r.team_name || '', teamShort: r.team_short || '',
          colour: r.team_colour || null }))
      });
    } else {
      $('#seasons').appendChild(el('div', 'empty',
        'No finalised games yet — a season line appears once one is played.'));
    }

    /* game log, with the opponent resolved from the game row */
    const gl = await api(`player_game_stats?player_uuid=eq.${pl.id}` +
      `&select=game_id,team_idx,stats,games(tipoff_at,home_score,away_score,status,` +
      `home:home_team_id(name,slug),away:away_team_id(name,slug))&limit=80`);
    const rows = gl.filter(r => r.games)
      .sort((a, b) => new Date(b.games.tipoff_at || 0) - new Date(a.games.tipoff_at || 0))
      .map(r => {
        const g = r.games;
        const home = r.team_idx === 0;
        const us = home ? g.home_score : g.away_score;
        const them = home ? g.away_score : g.home_score;
        return Object.assign({}, r, {
          __home: home,
          __opp: home ? g.away : g.home,
          __res: g.status === 'final' ? (us > them ? 'W ' + us + '-' + them
                                                   : 'L ' + us + '-' + them) : ''
        });
      });
    paintLog(rows);
  } catch (e) {
    fail('Could not load: ' + e.message);
  }
})();
