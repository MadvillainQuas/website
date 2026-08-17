'use strict';
/* League page — standings, fixtures, leaders. Public, read-only.
   Reads PostgREST directly: no SDK needed for anonymous reads, and RLS is what
   decides what comes back. All user text goes in via textContent, never HTML. */

const CFG = window.EPINOIA_CONFIG;
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
/* A season's competitions split two ways. PHASES are the stages of the league
   itself — the regular season, then the playoffs — and they share the Table
   tab, because they are the same competition to a reader even though they are
   separate rows. CUPS run alongside rather than after, so they get their own
   tab and their own selection. The distinction is the competition's `kind`,
   which a league admin sets. */
let phases = [], cups = [], cupComp = null;

async function boot() {
  try {
    const ls = await api(`leagues?slug=eq.${encodeURIComponent(wantLeague)}&select=*&limit=1`);
    if (!ls.length) return fail(`No league "${wantLeague}".`);
    league = ls[0];
    document.documentElement.style.setProperty('--team-a', league.colour_a || '#93f2bf');
    document.documentElement.style.setProperty('--team-b', league.colour_b || '#8ff5ff');
    $('#leagueName').textContent = league.name;
    document.title = league.name + ' · Epinoia';

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
    splitComps();
    comp = phases.find(c => c.id === wantComp) || phases[0] || comps[0];
    cupComp = cups.find(c => c.id === wantComp) || cups[0] || null;
    $('#ctx').textContent = league.name + ' · ' + season.name;

    renderPhasePicker();
    renderCupPicker();
    await Promise.all([renderTable(), renderFixtures(), renderLeaders(),
                       renderTeamStats(), renderExtras()]);
    $('#foot').textContent = 'Epinoia Network · ' + league.name + ' · ' + season.name;
  } catch (e) {
    fail('Could not load: ' + e.message);
  }
}

function fail(msg) {
  ['#tableBody', '#pane-fixtures', '#pane-leaders', '#cupBody'].forEach(s => {
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
    const b = el('button', 'ep-chip' + (sn.id === season.id ? ' on' : ''), sn.name);
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
      splitComps();
      comp = phases[0] || comps[0] || null;
      cupComp = cups[0] || null;
      renderPhasePicker(); renderCupPicker();
      if (!comp) return fail('That season has no competitions.');
      await Promise.all([renderTable(), renderFixtures(), renderLeaders(),
                         renderTeamStats(), renderExtras()]);
    });
    wrap.appendChild(b);
  });
}

/* A cup is a competition that runs ALONGSIDE the league rather than as a stage
   of it, which is why it gets its own tab: its table has nothing to do with
   the league table, and putting them in one selector invites the reader to
   compare two things that are not comparable. */
function splitComps() {
  phases = comps.filter(c => c.kind !== 'cup');
  cups   = comps.filter(c => c.kind === 'cup');
  /* a season with nothing but cups still needs something under Table */
  if (!phases.length && cups.length) { phases = cups.slice(); cups = []; }
}

/* the tag that says what kind of stage this is, so "Playoffs" is obviously a
   knockout before you click it */
function kindTag(c) {
  if (c.format === 'knockout' || c.format === 'groups_knockout') return 'knockout';
  if (c.kind === 'playoff') return 'playoff';
  if (c.format === 'groups') return 'groups';
  return null;
}

function pickerChip(c, isOn, onPick) {
  const b = el('button', 'ep-chip' + (isOn ? ' on' : ''), c.name);
  b.type = 'button';
  const tag = kindTag(c);
  if (tag) b.appendChild(el('span', 'kindtag', tag));
  b.addEventListener('click', onPick);
  return b;
}

function renderPhasePicker() {
  const wrap = $('#phasePick'); wrap.textContent = '';
  /* one phase is not a choice */
  if (phases.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  phases.forEach(c => wrap.appendChild(pickerChip(c, comp && c.id === comp.id, () => {
    if (comp && c.id === comp.id) return;
    comp = c; SEASON = null;
    const u = new URL(location.href);
    u.searchParams.set('c', c.id);
    history.replaceState(null, '', u);
    renderPhasePicker();
    renderTable(); renderFixtures(); renderLeaders(); renderTeamStats(); renderExtras();
  })));
}

function renderCupPicker() {
  const wrap = $('#cupPick'); wrap.textContent = '';
  if (cups.length < 2) { wrap.style.display = 'none'; }
  else {
    wrap.style.display = '';
    cups.forEach(c => wrap.appendChild(pickerChip(c, cupComp && c.id === cupComp.id, () => {
      if (cupComp && c.id === cupComp.id) return;
      cupComp = c; renderCupPicker(); renderCup();
    })));
  }
  renderCup();
}

/* The cup tab is the same bracket the playoffs use, pointed at a cup. A cup
   with a group stage shows its groups first, because that is what a cup with a
   group stage IS — the bracket only becomes meaningful once they are done. */
async function renderCup() {
  const body = $('#cupBody');
  if (!body) return;
  body.textContent = '';
  if (!cupComp) {
    body.appendChild(el('div', 'empty',
      'No cup in this season. A league administrator creates one by adding a ' +
      'competition and marking it a cup.'));
    return;
  }
  const B = window.EpinoiaBracket;
  if (cupComp.format === 'groups' || cupComp.format === 'groups_knockout') {
    await renderStandingsInto(body, cupComp);
  }
  if (cupComp.format !== 'groups') {
    const host = el('div');
    host.id = 'cupBracket';
    body.appendChild(host);
    if (B) await B.renderBracket({ host: '#cupBracket', api, comp: cupComp });
  }
}

/* ---------------------------------------------------------------- table --- */
/* The Table tab shows whatever the selected phase IS.

   A knockout phase has no table — it has a bracket — and showing an empty
   standings grid for the playoffs, or hiding the playoffs behind a separate
   tab, both misrepresent the season. A reader following a league from
   September to May is following one thing through its stages, so the stages
   share a tab and the tab renders what each one actually is. */
async function renderTable() {
  const body = $('#tableBody');
  body.textContent = '';
  if (!comp) { body.appendChild(el('div', 'empty', 'No phase selected.')); return; }

  const knockout = comp.format === 'knockout' || comp.format === 'groups_knockout';

  /* a groups-then-knockout phase shows both, groups first */
  if (!knockout || comp.format === 'groups_knockout') {
    await renderStandingsInto(body, comp);
  }
  if (knockout) {
    const host = el('div');
    host.id = 'phaseBracket';
    body.appendChild(host);
    const B = window.EpinoiaBracket;
    if (B) await B.renderBracket({ host: '#phaseBracket', api, comp });
  }
}

/* the standings for one competition, drawn into a given element */
async function renderStandingsInto(pane, competition) {
  const rows = await api(
    `standings?competition_id=eq.${competition.id}` +
    `&select=rank,gp,w,l,pts_for,pts_against,diff,league_points,deducted_points,streak,group_name,teams(name,short_name,colour,slug)` +
    `&order=group_name.asc,rank.asc`);
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
  const wrap = el('div', 'ep-tw');
  const t = el('table', 'ep-tbl'); t.style.minWidth = '620px';
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
    /* A DOCKED TOTAL HAS TO SAY SO. Without the marker the points column
       simply does not follow from the W-L beside it, and the first thing
       anybody does with a table that does not add up is assume it is broken. */
    const pts = el('td', null, r.league_points); pts.style.color = 'var(--ink)';
    if (r.deducted_points) {
      const d = el('span', 'dock', ' −' + r.deducted_points);
      d.title = r.deducted_points + ' points deducted';
      pts.appendChild(d);
    }
    tr.appendChild(pts);
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
  const B = window.EpinoiaBracket;
  if (!B) return;
  /* The bracket is no longer a tab of its own — a league phase draws its own
     inside the Table tab, and a cup draws its own inside the Cup tab. All that
     is left here are the awards, which belong to the selected phase. */
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
  SEASON = await window.EpinoiaData.season(comp.id);
  SEASON.__comp = comp.id;
  const [pmeta, tmeta] = await Promise.all([
    window.EpinoiaData.playerMeta(SEASON.players.map(p => p.id)),
    window.EpinoiaData.teamMeta(league.id)
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
  window.EpinoiaTable.render({
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
  window.EpinoiaTable.render({
    host: pane, kind: 'team', sortKey: 'ppg',
    filename: (league.slug || 'league') + '-team-stats',
    rows: S.teams,
    teamHref: r => r.slug ? '../t/?t=' + encodeURIComponent(r.slug) : null
  });
}

function showTab(name) {
  const btn = [...document.querySelectorAll('.ep-tab')].find(b => b.dataset.p === name);
  if (!btn) return false;
  document.querySelectorAll('.ep-tab').forEach(x => x.classList.remove('on'));
  btn.classList.add('on');
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  const pane = document.getElementById('pane-' + name);
  if (pane) pane.classList.add('on');
  return true;
}

document.querySelectorAll('.ep-tab').forEach(b => b.addEventListener('click', () => {
  showTab(b.dataset.p);
  /* the tab goes in the URL so a particular view can be linked to and survives
     a reload — which is also what makes the splash page's Leaders card able to
     land on the leaders rather than on the table */
  const u = new URL(location.href);
  u.hash = b.dataset.p === 'table' ? '' : b.dataset.p;
  history.replaceState(null, '', u.toString().replace(/#$/, ''));
}));

/* honour a hash on arrival, and when somebody follows a link to a different
   tab on the page they are already on */
function tabFromHash() {
  const want = (location.hash || '').replace(/^#/, '');
  if (want) showTab(want);
}
window.addEventListener('hashchange', tabFromHash);
tabFromHash();

boot();
