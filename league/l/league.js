'use strict';
/* League page — standings, fixtures, leaders. Public, read-only.
   Reads PostgREST directly: no SDK needed for anonymous reads, and RLS is what
   decides what comes back. All user text goes in via textContent, never HTML. */

const CFG = window.COURTSIDE_CONFIG;
const qp  = new URLSearchParams(location.search);
const wantLeague = qp.get('l') || 'demo-league';
const wantComp   = qp.get('c');
const wantSeason = qp.get('s') || '';

const $  = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag);
  if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function api(path) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`${r.status} ${path.split('?')[0]}`);
  return r.json();
}

let league = null, season = null, seasons = [], comps = [], comp = null;

async function boot() {
  try {
    const ls = await api(`leagues?slug=eq.${encodeURIComponent(wantLeague)}&select=*&limit=1`);
    if (!ls.length) return fail(`No league "${wantLeague}".`);
    league = ls[0];
    document.documentElement.style.setProperty('--team-a', league.colour_a || '#93f2bf');
    document.documentElement.style.setProperty('--team-b', league.colour_b || '#8ff5ff');
    $('#leagueName').textContent = league.name;
    document.title = league.name + ' · Courtside';

    /* every season, not just the newest — a league's history was previously
       unreachable rather than merely unlinked, since no parameter could get
       you there */
    seasons = await api(`seasons?league_id=eq.${league.id}` +
      `&select=id,name,starts_on,ends_on&order=starts_on.desc`);
    if (!seasons.length) return fail('This league has no seasons yet.');
    season = pickSeason(seasons, wantSeason);
    $('#seasonName').textContent = season.name;
    renderSeasonPicker();

    comps = await api(`competitions?season_id=eq.${season.id}&select=*&order=name`);
    if (!comps.length) return fail('This season has no competitions yet.');
    comp = comps.find(c => c.id === wantComp) || comps[0];
    $('#ctx').textContent = league.name + ' · ' + season.name;

    renderCompPicker();
    await Promise.all([renderTable(), renderFixtures(), renderLeaders(),
                       renderTeamStats(), renderExtras()]);
    $('#foot').textContent = 'Courtside Network · ' + league.name + ' · ' + season.name;
  } catch (e) {
    fail('Could not load: ' + e.message);
  }
}

function fail(msg) {
  ['#pane-table', '#pane-fixtures', '#pane-leaders', '#pane-bracket'].forEach(s => {
    const p = $(s); p.textContent = ''; p.appendChild(el('div', 'empty', msg));
  });
}


/* A season is named like "2026-27", which is what a person would put in a URL,
   so ?s= matches on the name before falling back to the id. A mistyped season
   lands on the newest rather than on an error. */
function pickSeason(list, ref) {
  if (!list.length) return null;
  if (!ref) return list[0];
  const key = String(ref).toLowerCase().replace(/[^a-z0-9]/g, '');
  return list.find(x => x.id === ref) ||
         list.find(x => String(x.name).toLowerCase().replace(/[^a-z0-9]/g, '') === key) ||
         list[0];
}

function renderSeasonPicker() {
  const wrap = $('#seasonPick');
  if (!wrap) return;
  wrap.textContent = '';
  /* one season is not a choice, and a control offering it is noise */
  if (seasons.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  seasons.forEach(sn => {
    const b = el('button', 'cs-chip' + (sn.id === season.id ? ' on' : ''), sn.name);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (sn.id === season.id) return;
      season = sn; comp = null; SEASON = null;
      $('#seasonName').textContent = season.name;
      $('#ctx').textContent = league.name + ' · ' + season.name;
      /* the URL carries the season so a past table is linkable */
      const u = new URL(location.href);
      u.searchParams.set('s', season.name);
      u.searchParams.delete('c');
      history.replaceState(null, '', u);
      renderSeasonPicker();
      comps = await api(`competitions?season_id=eq.${season.id}&select=*&order=name`);
      comp = comps[0] || null;
      renderCompPicker();
      if (!comp) return fail('That season has no competitions.');
      await Promise.all([renderTable(), renderFixtures(), renderLeaders(),
                         renderTeamStats(), renderExtras()]);
    });
    wrap.appendChild(b);
  });
}

function renderCompPicker() {
  const wrap = $('#compPick'); wrap.textContent = '';
  if (comps.length < 2) { wrap.style.display = 'none'; return; }
  comps.forEach(c => {
    const b = el('button', 'cs-chip' + (c.id === comp.id ? ' on' : ''), c.name);
    b.addEventListener('click', () => {
      comp = c; SEASON = null; renderCompPicker(); renderTable(); renderFixtures();
      renderLeaders(); renderTeamStats(); renderExtras();
    });
    wrap.appendChild(b);
  });
}

/* ---------------------------------------------------------------- table --- */
async function renderTable() {
  const rows = await api(
    `standings?competition_id=eq.${comp.id}` +
    `&select=rank,gp,w,l,pts_for,pts_against,diff,league_points,streak,group_name,teams(name,short_name,colour,slug)` +
    `&order=group_name.asc,rank.asc`);
  const pane = $('#pane-table'); pane.textContent = '';
  if (!rows.length) { pane.appendChild(el('div', 'empty', 'No games played yet.')); return; }

  /* A competition may run as one table or as several groups side by side.
     Grouping here rather than in a second renderer means an ungrouped league
     is simply the case of one group, and gets exactly the table it had. */
  const groups = new Map();
  rows.forEach(r => {
    const k = r.group_name || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  groups.forEach((groupRows, name) => {
    if (name) pane.appendChild(el('div', 'grouphead', 'Group ' + name));
    pane.appendChild(groupTable(groupRows));
  });
}

function groupTable(rows) {
  const wrap = el('div', 'cs-tw');
  const t = el('table', 'cs-tbl'); t.style.minWidth = '620px';
  const thead = el('thead'); const hr = el('tr');
  ['#', 'TEAM', 'GP', 'W', 'L', 'PF', 'PA', 'DIFF', 'PTS', 'STREAK']
    .forEach(h => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const tm = r.teams || {};
    const tr = el('tr');
    tr.appendChild(el('td', null, r.rank ?? ''));

    const nameTd = el('td');
    const cell = el('div', 'tname-cell');
    const crest = el('span', 'crest', tm.short_name || '');
    crest.style.background = tm.colour || 'var(--lume)';
    const a = el('a', null, tm.name || '');
    a.href = '../t/?t=' + encodeURIComponent(tm.slug || '');
    cell.append(crest, a); nameTd.appendChild(cell); tr.appendChild(nameTd);

    [r.gp, r.w, r.l, r.pts_for, r.pts_against].forEach(v => tr.appendChild(el('td', null, v)));
    const d = el('td', null, (r.diff > 0 ? '+' : '') + r.diff);
    d.style.color = r.diff > 0 ? 'var(--good)' : (r.diff < 0 ? 'var(--bad)' : '');
    tr.appendChild(d);
    const pts = el('td', null, r.league_points); pts.style.color = 'var(--ink)'; tr.appendChild(pts);
    const st = el('td', null, r.streak || '');
    st.style.color = (r.streak || '').startsWith('W') ? 'var(--good)' : 'var(--bad)';
    tr.appendChild(st);
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}


/* The knockout and the trophies live in their own module — they are a
   different shape of question from a table and a fixture list, and keeping
   them separate stops this file growing a third personality. */
function renderExtras() {
  const B = window.CourtsideBracket;
  if (!B) return;
  B.renderBracket({ host: '#pane-bracket', api, comp });
  B.renderAwards({ host: '#awards', api, comp });
}

/* ------------------------------------------------------------- fixtures --- */
async function renderFixtures() {
  const gs = await api(
    `games?competition_id=eq.${comp.id}` +
    `&select=id,tipoff_at,status,home_score,away_score,venue,` +
    `home:home_team_id(name,short_name,colour),away:away_team_id(name,short_name,colour)` +
    `&order=tipoff_at.desc`);
  const pane = $('#pane-fixtures'); pane.textContent = '';
  if (!gs.length) { pane.appendChild(el('div', 'empty', 'No fixtures scheduled.')); return; }

  gs.forEach(g => {
    const row = el('div', 'fx');
    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    row.appendChild(el('div', 'd', when
      ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
        ' ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : 'TBC'));

    const final = g.status === 'final';
    const homeWon = final && g.home_score > g.away_score;
    const awayWon = final && g.away_score > g.home_score;

    const h = el('div', 'h'); const hn = el('div', 'tn' + (homeWon ? ' win' : ''), (g.home || {}).name || '—');
    h.appendChild(hn); row.appendChild(h);

    row.appendChild(el('div', 'sc', final ? `${g.home_score}–${g.away_score}` : 'v'));

    const a = el('div', 'a'); const an = el('div', 'tn' + (awayWon ? ' win' : ''), (g.away || {}).name || '—');
    a.appendChild(an); row.appendChild(a);

    const cls = g.status === 'live' ? 'live' : (final ? 'final' : 'sched');
    const st = el('div', 'st ' + cls, g.status === 'live' ? 'LIVE' : (final ? 'FINAL' : (g.venue || 'SCHEDULED')));
    row.appendChild(st);

    if (final || g.status === 'live') {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => { location.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase'; });
    }
    pane.appendChild(row);
  });
}

/* -------------------------------------------------------------- leaders --- */
/* Both boards read the same aggregated season the rest of the site does, so a
   number here and a number on the player's own page cannot disagree. */
let SEASON = null;

async function loadSeason() {
  if (SEASON && SEASON.__comp === comp.id) return SEASON;
  SEASON = await window.CourtsideData.season(comp.id);
  SEASON.__comp = comp.id;
  const [pmeta, tmeta] = await Promise.all([
    window.CourtsideData.playerMeta(SEASON.players.map(p => p.id)),
    window.CourtsideData.teamMeta(league.id)
  ]);
  SEASON.players.forEach(p => Object.assign(p, pmeta[p.id] || { name: 'Player' }));
  SEASON.teams.forEach(t => Object.assign(t, tmeta[t.id] || { name: 'Team' }));
  return SEASON;
}

async function renderLeaders() {
  const pane = $('#pane-leaders'); pane.textContent = '';
  let S;
  try { S = await loadSeason(); }
  catch (e) { pane.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return; }

  if (!S.players.length) {
    pane.appendChild(el('div', 'empty',
      'No player statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  window.CourtsideTable.render({
    host: pane, kind: 'player', sortKey: 'ppg', minGames: 1,
    filename: (league.slug || 'league') + '-leaders',
    rows: S.players,
    playerHref: r => '../p/?p=' + encodeURIComponent(r.id)
  });
}

/* ----------------------------------------------------------- team stats --- */
async function renderTeamStats() {
  const pane = $('#pane-teams'); pane.textContent = '';
  let S;
  try { S = await loadSeason(); }
  catch (e) { pane.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return; }

  if (!S.teams.length) {
    pane.appendChild(el('div', 'empty',
      'No team statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  window.CourtsideTable.render({
    host: pane, kind: 'team', sortKey: 'ppg',
    filename: (league.slug || 'league') + '-team-stats',
    rows: S.teams,
    teamHref: r => r.slug ? '../t/?t=' + encodeURIComponent(r.slug) : null
  });
}

document.querySelectorAll('.cs-tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.cs-tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  document.getElementById('pane-' + b.dataset.p).classList.add('on');
}));

boot();
