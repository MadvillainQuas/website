'use strict';
/* League page — standings, fixtures, leaders. Public, read-only.
   Reads PostgREST directly: no SDK needed for anonymous reads, and RLS is what
   decides what comes back. All user text goes in via textContent, never HTML. */

const CFG = window.COURTSIDE_CONFIG;
const qp  = new URLSearchParams(location.search);
const wantLeague = qp.get('l') || 'demo-league';
const wantComp   = qp.get('c');

const $  = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag);
  if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function api(path) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`${r.status} ${path.split('?')[0]}`);
  return r.json();
}

let league = null, season = null, comps = [], comp = null;

async function boot() {
  try {
    const ls = await api(`leagues?slug=eq.${encodeURIComponent(wantLeague)}&select=*&limit=1`);
    if (!ls.length) return fail(`No league "${wantLeague}".`);
    league = ls[0];
    document.documentElement.style.setProperty('--team-a', league.colour_a || '#93f2bf');
    document.documentElement.style.setProperty('--team-b', league.colour_b || '#8ff5ff');
    $('#leagueName').textContent = league.name;
    document.title = league.name + ' · Courtside';

    const ss = await api(`seasons?league_id=eq.${league.id}&select=*&order=starts_on.desc&limit=1`);
    if (!ss.length) return fail('This league has no seasons yet.');
    season = ss[0];
    $('#seasonName').textContent = season.name;

    comps = await api(`competitions?season_id=eq.${season.id}&select=*&order=name`);
    if (!comps.length) return fail('This season has no competitions yet.');
    comp = comps.find(c => c.id === wantComp) || comps[0];
    $('#ctx').textContent = league.name + ' · ' + season.name;

    renderCompPicker();
    await Promise.all([renderTable(), renderFixtures(), renderLeaders()]);
    $('#foot').textContent = 'Courtside Network · ' + league.name + ' · ' + season.name;
  } catch (e) {
    fail('Could not load: ' + e.message);
  }
}

function fail(msg) {
  ['#pane-table', '#pane-fixtures', '#pane-leaders'].forEach(s => {
    const p = $(s); p.textContent = ''; p.appendChild(el('div', 'empty', msg));
  });
}

function renderCompPicker() {
  const wrap = $('#compPick'); wrap.textContent = '';
  if (comps.length < 2) { wrap.style.display = 'none'; return; }
  comps.forEach(c => {
    const b = el('button', 'cs-chip' + (c.id === comp.id ? ' on' : ''), c.name);
    b.addEventListener('click', () => {
      comp = c; renderCompPicker(); renderTable(); renderFixtures(); renderLeaders();
    });
    wrap.appendChild(b);
  });
}

/* ---------------------------------------------------------------- table --- */
async function renderTable() {
  const rows = await api(
    `standings?competition_id=eq.${comp.id}` +
    `&select=rank,gp,w,l,pts_for,pts_against,diff,league_points,streak,teams(name,short_name,colour,slug)` +
    `&order=rank`);
  const pane = $('#pane-table'); pane.textContent = '';
  if (!rows.length) { pane.appendChild(el('div', 'empty', 'No games played yet.')); return; }

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
  t.appendChild(tb); wrap.appendChild(t); pane.appendChild(wrap);
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
async function renderLeaders() {
  const pane = $('#pane-leaders'); pane.textContent = '';
  let rows = [];
  try {
    rows = await api(`player_season_stats?competition_id=eq.${comp.id}` +
                     `&select=player_id,gp,ppg,rpg,apg,ts,first_name,last_name,player_slug` +
                     `&order=ppg.desc&limit=10`);
  } catch (_) { /* view may be empty before any game is finalised through the app */ }

  if (!rows.length) {
    pane.appendChild(el('div', 'empty',
      'No player statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  const hdr = el('div', 'cs-hdr');
  hdr.append(el('span', 'idx', 'PPG'), el('h2', null, 'Leading scorers'));
  pane.appendChild(hdr);
  rows.forEach((r, i) => {
    const row = el('div', 'lead');
    row.appendChild(el('div', 'r', i + 1));
    row.appendChild(el('div', 'n', ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || 'Player'));
    row.appendChild(el('div', 'v', r.ppg != null ? Number(r.ppg).toFixed(1) : '—'));
    pane.appendChild(row);
  });
}

document.querySelectorAll('.cs-tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.cs-tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  document.getElementById('pane-' + b.dataset.p).classList.add('on');
}));

boot();
