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
    await lineupPanels(team);
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
  const D = window.CourtsideData;
  let S = null;
  try {
    const g = await D.get(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
                          `&status=eq.final&select=competition_id&limit=1`);
    if (g[0] && g[0].competition_id) S = await D.season(g[0].competition_id);
  } catch (e) {
    host.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return;
  }
  const mine = S && S.teams.find(t => t.id === team.id);
  if (!mine) {
    host.appendChild(el('div', 'empty',
      'No team statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }

  /* The four factors first and labelled as such: they are the four things that
     decide a basketball game, and both ends of each are shown because a
     defence is only describable relative to what it faced. */
  const ff = el('div');
  ff.appendChild(el('div', 'ffhead', 'four factors'));
  const grid = el('div', 'ffgrid');
  [['shooting', 'eFG%', mine.ff_efg, mine.dff_efg, false],
   ['turnovers', 'TOV%', mine.ff_tov, mine.dff_tov, true],
   ['rebounding', 'OREB%', mine.ff_oreb, mine.dff_oreb, false],
   ['free throws', 'FTr', mine.ff_ftr, mine.dff_ftr, false]]
    .forEach(([label, unit, off, def, lowGood]) => {
      const card = el('div', 'ffcard');
      card.appendChild(el('div', 'ffl', label + ' · ' + unit));
      const pair = el('div', 'ffpair');
      const o = el('div', 'ffside');
      o.append(el('div', 'ffv', n1(off)), el('div', 'ffk', 'own'));
      const d = el('div', 'ffside');
      d.append(el('div', 'ffv', n1(def)), el('div', 'ffk', 'allowed'));
      /* Green marks an ADVANTAGE TO THIS TEAM, never simply the larger number.
         Opponents shooting a better eFG% than you is a weakness; colouring
         "allowed" green because 49.1 > 48.1 would read as a strength and say
         the opposite of what happened. So the edge is computed in the team's
         favour, and a deficit is marked as such rather than dressed up. */
      const edge = (off == null || def == null) ? null
        : (lowGood ? def - off : off - def);          // positive = this team ahead
      if (edge != null && Math.abs(edge) >= 0.05) {
        (edge > 0 ? o : d).classList.add(edge > 0 ? 'win' : 'lose');
      }
      pair.append(o, d); card.appendChild(pair);
      grid.appendChild(card);
    });
  ff.appendChild(grid);
  host.appendChild(ff);

  const tiles = el('div', 'tiles');
  [['ppg', n1(mine.ppg), true], ['opp ppg', n1(mine.papg), false],
   ['diff', mine.diffpg == null ? '—' : (mine.diffpg > 0 ? '+' : '') + n1(mine.diffpg), true],
   ['ortg', n1(mine.ortg), true], ['drtg', n1(mine.drtg), false],
   ['net', mine.net == null ? '—' : (mine.net > 0 ? '+' : '') + n1(mine.net), true],
   ['pace', n1(mine.pace), false], ['ts%', n1(mine.ts), false],
   ['ast/to', mine.ast_to == null ? '—' : Number(mine.ast_to).toFixed(2), false],
   ['reb', mine.reb, false], ['ast', mine.ast, false], ['stl', mine.stl, false],
   ['blk', mine.blk, false], ['paint', mine.paint, false], ['fast', mine.fast, false],
   ['2nd chance', mine.second_chance, false], ['off turnovers', mine.pts_off_to, false],
   ['bench', mine.bench, false]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v == null ? '—' : v), el('div', 'l', l));
      tiles.appendChild(d);
    });
  host.appendChild(tiles);

  /* every player on the roster, ranked within their own team */
  const meta = await D.playerMeta(S.players.map(p => p.id));
  S.players.forEach(p => Object.assign(p, meta[p.id] || {}));
  const squad = S.players.filter(p => p.teamId === team.id);
  if (squad.length) {
    const sub = el('div');
    host.appendChild(sub);
    T.render({
      host: sub, kind: 'player', sortKey: 'ppg', showMinGames: false,
      filename: (team.slug || 'team') + '-players',
      rows: squad,
      playerHref: r => '../p/?p=' + encodeURIComponent(r.id)
    });
  }
}

/* ------------------------------------------------------- lineups & WOWY --- */
/* All three panels read the same stints, fetched once. */
async function lineupPanels(team) {
  const D = window.CourtsideData;
  try {
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=id,home_team_id,away_team_id`);
    if (!gs.length) return;
    const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
    const st = await D.stints(gs.map(g => g.id), team.id, byGame);
    if (!st.length) {
      ['#wowy', '#lufilter', '#lulist'].forEach(sel =>
        $(sel).appendChild(el('div', 'empty', 'No lineup data yet.')));
      return;
    }

    const ids = [...new Set(st.flatMap(r => r.player_ids))];
    const meta = await D.playerMeta(ids);
    $('#wowyNote').textContent = st.length + ' stints · ' + ids.length + ' players';

    /* the team WOWY needs a subject; default to the most-used player and let
       the reader change it, because "the team without X" is a question about a
       specific X rather than about the team */
    const mins = new Map();
    st.forEach(s2 => (s2.player_ids || []).forEach(id =>
      mins.set(id, (mins.get(id) || 0) + ((s2.stats && s2.stats.dur) || 0))));
    const order = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    let subject = order[0];

    const pick = $('#wowyPick');
    order.forEach(id => {
      const b = el('button', 'cs-chip' + (id === subject ? ' on' : ''),
                   (meta[id] || {}).name || 'Player');
      b.type = 'button';
      b.addEventListener('click', () => {
        subject = id;
        pick.querySelectorAll('.cs-chip').forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        drawWowy();
      });
      pick.appendChild(b);
    });

    function drawWowy() {
      window.CourtsideWowy.onOffTiles('#onoff', st, subject);
      window.CourtsideWowy.render({
        host: '#wowy', stints: st, playerId: subject, meta,
        href: id => '../p/?p=' + encodeURIComponent(id)
      });
    }
    drawWowy();

    window.CourtsideLineupUI.filterPanel({ host: '#lufilter', stints: st, meta });
    window.CourtsideLineupUI.listPanel({ host: '#lulist', stints: st, meta });
  } catch (e) {
    console.warn('[lineups]', e);
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
