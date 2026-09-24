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

/* A MEMBERS-ONLY LEAGUE IS REFUSED BY ROW-LEVEL SECURITY, so a member's reads say who is
   asking. access.js decides when a token is worth sending (a members-only league this viewer
   may see) and hands back {} otherwise, so an open league's request is exactly what it was.
   Asked per call, because the answer lands after the first reads. A 401 with a token on it is
   a token the server stopped accepting, not an answer about the rows: asked once more
   anonymously, as the page always did. */
async function api(path, anon) {
  const headers = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders(league && league.id) || {}); } catch (_) { /* anonymous */ }
  }
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    cache: 'no-store',
    headers
  });
  if (r.status === 401 && headers.Authorization && !anon) return api(path, true);
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

/* WHAT THIS VIEWER MAY SEE (docs/memberships.md), decided once from access.js before the first
   pane is drawn. Both start open and stay open unless the module is on the page AND has an
   answer: analytics fail open, and the members-only card needs a known "cannot view".

   ANALYTICS_LOCKED  the full tables drop their premium columns themselves (they are handed
                     the league id); this page only skips the zone read they would have shown
   PAYWALLED         a members-only league closed to this viewer: the name, the season and the
                     card stay, the tabs go, and nothing behind them is fetched -- the database
                     would refuse it. Upcoming fixtures stay under the card while the league
                     keeps them public (§2): a league that wants people through the door must
                     say when the doors open. */
let ANALYTICS_LOCKED = false, PAYWALLED = false;

function accessNow() {
  const A = window.EpinoiaAccess;
  if (!A || !league) return { locked: false, paywalled: false, st: null };
  const st = typeof A.get === 'function' ? A.get(league.id) : null;
  return {
    locked: typeof A.analyticsOk === 'function' && !A.analyticsOk(league.id),
    paywalled: !!(st && st.known) && typeof A.canView === 'function' && !A.canView(league.id),
    st
  };
}

function decideAccess() {
  const A = window.EpinoiaAccess;
  if (!A || !league) return;
  const now = accessNow();
  ANALYTICS_LOCKED = now.locked;
  PAYWALLED = now.paywalled;
  watchAccess();
  if (!PAYWALLED) return;
  const st = now.st;
  document.body.classList.add('paywalled');
  document.body.classList.toggle('fixtures-public', st.fixturesPublic !== false);
  const card = $('#paywall');
  if (card && typeof A.paywallHTML === 'function') {
    card.innerHTML = A.paywallHTML({ league });
    card.hidden = false;
  }
}

/* THE ANSWER CAN MOVE UNDER A DRAWN PAGE: a sign-in or sign-out in another tab, an answer
   that lands after the module's own time limit, the admin preview switch. Only a change to
   what this page decided from does anything, so an open league never notices:
     the card    the page is drawn again from the top -- every read behind the wall changes
                 with it, and a reload is the one redraw that cannot miss one
     analytics   the full tables relock themselves; opening them again re-draws the Team
                 Stats pane, so the zone read it skipped is made
   On a change of account the module forgets what it held first, so the new account's
   answer is waited for rather than read from the empty state in between. */
let accessWatched = false;
function watchAccess() {
  const A = window.EpinoiaAccess;
  if (accessWatched || !A || typeof A.onChange !== 'function' || !league) return;
  accessWatched = true;
  const check = () => {
    const now = accessNow();
    if (now.paywalled !== PAYWALLED) { location.reload(); return; }
    if (now.locked === ANALYTICS_LOCKED) return;
    ANALYTICS_LOCKED = now.locked;
    if (!ANALYTICS_LOCKED && !PAYWALLED && comp && teamsShown) renderTeamStats().catch(() => {});
  };
  try {
    A.onChange(d => {
      if (d && d.leagueId && d.leagueId !== league.id) return;
      if (d && d.reason === 'auth' && typeof A.load === 'function') {
        Promise.resolve().then(() => A.load({ leagueId: league.id })).then(check, () => {});
      } else check();
    });
  } catch (_) { /* the page as drawn */ }
}

/* every pane a season change or a first load draws; behind the wall, only the fixtures.
   LEADERS, TEAM STATS AND STRENGTH OF SCHEDULE ONLY ONCE SOMEBODY HAS OPENED THEM (showTab).
   The table and the fixtures are two small reads; the other three read the whole season's box
   scores, and Team Stats the event log of every finished game in scope as well (its shot
   zones), one request a game: about 285 requests for a 240-game season, made on every visit
   while most visits never leave the table (measured 2026-09-24). */
function renderPanes() {
  if (PAYWALLED) return document.body.classList.contains('fixtures-public') ? renderFixtures() : Promise.resolve();
  return Promise.all([renderTable(), renderFixtures(), leadersShown ? renderLeaders() : null,
                      teamsShown ? renderTeamStats() : null, renderExtras(), sosShown ? renderSOS() : null]);
}

async function boot() {
  try {
    const ls = await api(`leagues?slug=eq.${encodeURIComponent(wantLeague)}&select=*&limit=1`);
    if (!ls.length) return fail(`No league "${wantLeague}".`);
    league = ls[0];
    /* asked now, by id, so it runs beside the seasons and competitions reads; the module
       gives up by itself after 4 s and answers open */
    const A = window.EpinoiaAccess;
    const accessReady = (A && typeof A.load === 'function')
      ? Promise.resolve().then(() => A.load({ leagueId: league.id })).catch(() => null)
      : Promise.resolve(null);
    document.documentElement.style.setProperty('--team-a', league.colour_a || '#93f2bf');
    document.documentElement.style.setProperty('--team-b', league.colour_b || '#8ff5ff');
    /* THE LEAGUE'S OWN COLOURS, from its logo or as its admin picked them (0122): trims on this
       page and on the sidebar while it is here. A league that chose its own accent in
       Appearance keeps it, here as on its front page. */
    const ownAccent = league.theme && /^#[0-9a-f]{6}$/i.test(league.theme.accent || '') ? league.theme.accent : null;
    if (window.EpinoiaTeamColour && window.EpinoiaTeamColour.league) {
      window.EpinoiaTeamColour.league(league, { keepAccent: !!ownAccent });
    }
    if (ownAccent) document.documentElement.style.setProperty('--lume', ownAccent);
    $('#leagueName').textContent = league.name;
    document.title = league.name + ' · Epinoia';

    /* EVERY SEASON THE READER CAN ACTUALLY GO TO, and its competitions with it
       (seasonbar.js): a league's history was previously unreachable rather
       than merely unlinked, and the seasons this page went on to offer
       included ones with no games in them at all. One read for the lot, so
       changing season below costs no request — and a season that has been
       drawn but not played is still offered and still the default, which is
       what most of the platform looks like in September. */
    const SB = window.EpinoiaSeasonBar;
    const scope = await SB.load(api, league.id);
    seasons = scope.list;
    if (!seasons.length) return fail('This league has no seasons yet.');
    season = SB.pick(seasons, wantSeason);
    $('#seasonName').textContent = season.name;
    renderSeasonPicker();

    comps = season.comps;
    if (!comps.length) return fail('This season has no competitions yet.');
    splitComps();
    comp = phases.find(c => c.id === wantComp) || phases[0] || comps[0];
    cupComp = cups.find(c => c.id === wantComp) || cups[0] || null;
    $('#ctx').textContent = league.name + ' · ' + season.name;

    await accessReady;
    try { decideAccess(); } catch (_) { /* open */ }
    if (!PAYWALLED) {
      renderPhasePicker();
      renderCupPicker();
    }
    /* from here a tab opened for the first time can draw itself (showTab) */
    booted = true;
    await renderPanes();
    $('#foot').textContent = 'Epinoia Network · ' + league.name + ' · ' + season.name;
  } catch (e) {
    fail('Could not load: ' + e.message);
  }
}

function fail(msg) {
  ['#tableBody', '#pane-fixtures', '#pane-leaders', '#cupBody', '#pane-sos'].forEach(s => {
    const p = $(s); p.textContent = ''; p.appendChild(el('div', 'empty', msg));
  });
}


/* The season control, drawn by the shared one (seasonbar.js) so that the row
   here, on the league's front page, on the fixtures page and on the statistics
   page is one control rather than four that drift. Its chips are links, so a
   past season can be copied out of the address bar or opened in a new tab;
   this page can redraw itself, so onPick catches the plain click and does.

   NO REQUEST ON A CHANGE OF SEASON: every season's competitions came back with
   the seasons in boot(). What follows is the same work a first load does. */
function renderSeasonPicker() {
  const wrap = $('#seasonPick');
  if (!wrap) return;
  window.EpinoiaSeasonBar.mount({
    host: wrap, seasons, season,
    onPick: async sn => {
      /* statScope names a competition of the season being left, and a filter
         pointing into last season would have asked for nobody's statistics. */
      season = sn; comp = null; SEASON = null; statScope = 'all'; statConf = null;
      $('#seasonName').textContent = season.name;
      $('#ctx').textContent = league.name + ' · ' + season.name;
      /* the URL carries the season so a past table is linkable */
      window.EpinoiaSeasonBar.syncUrl(season);
      renderSeasonPicker();
      comps = season.comps;
      splitComps();
      comp = phases[0] || comps[0] || null;
      cupComp = cups[0] || null;
      if (!PAYWALLED) { renderPhasePicker(); renderCupPicker(); }
      if (!comp) return fail('That season has no competitions.');
      $('#foot').textContent = 'Epinoia Network · ' + league.name + ' · ' + season.name;
      await renderPanes();
    }
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
  if (tag) { const k = el('span', 'kindtag', tag); k.setAttribute('data-i18n-ctx', 'kind'); b.appendChild(k); }
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
    renderTable(); renderFixtures(); renderExtras();
    if (leadersShown) renderLeaders();
    if (teamsShown) renderTeamStats();
    if (sosShown) renderSOS();
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
    host.setAttribute('data-i18n-ctx', 'bracket');     // i18n.js: a round called "Final" is the final, not a game's state
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
    host.setAttribute('data-i18n-ctx', 'bracket');     // i18n.js: a round called "Final" is the final, not a game's state
    body.appendChild(host);
    const B = window.EpinoiaBracket;
    if (B) await B.renderBracket({ host: '#phaseBracket', api, comp });
  }
}

/* the standings for one competition, drawn into a given element */
async function renderStandingsInto(pane, competition) {
  const ST = window.EpinoiaStandings;
  const teamCols = 'name,short_name,colour,slug,logo_path';
  const cols = ST ? ST.columns(competition, teamCols)
    : `rank,gp,w,l,pts_for,pts_against,diff,league_points,deducted_points,streak,group_name,teams(${teamCols})`;
  const rows = await api(
    `standings?competition_id=eq.${competition.id}` +
    `&select=${cols}` +
    `&order=group_name.asc,rank.asc`);
  if (!rows.length) { pane.appendChild(el('div', 'empty', 'No games played yet.')); return; }

  /* A CONFERENCE LEAGUE (0144) is read the college way: a table per
     conference, the division inside it, and two records per club. */
  if (ST && ST.isConferences(competition)) { renderConferences(pane, rows, ST, competition); return; }

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
    if (name) pane.appendChild(el('div', 'grouphead', ST ? ST.groupLabel(name, competition) : 'Group ' + name));
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
    const tr = el('tr');
    tr.appendChild(el('td', null, r.rank ?? ''));
    tr.appendChild(teamCell(r.teams));

    [r.gp, r.w, r.l, r.pts_for, r.pts_against].forEach(v => tr.appendChild(el('td', null, v)));
    tr.appendChild(diffCell(r.diff));
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
    tr.appendChild(streakCell(r.streak));
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}

/* the club's crest and name, linked to its page */
function teamCell(teams) {
  const tm = teams || {};
  const nameTd = el('td');
  const cell = el('div', 'tname-cell');
  const crest = el('span', 'crest', tm.short_name || '');
  crest.style.background = tm.colour || 'var(--lume)';
  const crestUrl = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(tm.logo_path) : null;
  if (crestUrl) {
    const img = document.createElement('img');
    img.src = crestUrl; img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;border-radius:inherit;background:#fff';
    img.addEventListener('error', () => img.remove());
    crest.textContent = ''; crest.appendChild(img);
  }
  const a = el('a', null, tm.name || '');
  a.href = '../t/?t=' + encodeURIComponent(tm.slug || '');
  cell.append(crest, a); nameTd.appendChild(cell);
  return nameTd;
}

function diffCell(diff) {
  const d = el('td', null, (diff > 0 ? '+' : '') + diff);
  d.style.color = diff > 0 ? 'var(--good)' : (diff < 0 ? 'var(--bad)' : '');
  return d;
}

function streakCell(streak) {
  const st = el('td', null, streak || '');
  st.style.color = (streak || '').startsWith('W') ? 'var(--good)' : 'var(--bad)';
  return st;
}

/* ------------------------------------------------------ conference tables --- */
/* THE COLLEGE TABLE (0144). A conference league is not read as one ladder:
   each club's standing is read inside its own conference, and it carries two
   records — CONFERENCE (only the games against its own conference) and
   OVERALL (the complete schedule, non-conference games and playoffs
   included). The conference record comes first and decides the order, because
   it is what seeds a conference's playoffs; recompute_standings has already
   ranked it so, within each division where a conference has them.

   OVERALL is the other question a reader brings to a college league — who has
   the best record in the whole thing — so it is one click away, as one table
   ranked by the complete schedule. */
let confView = 'conf';

function renderConferences(pane, rows, ST, competition) {
  const host = el('div');
  const pick = el('div', 'phasepick');
  pick.style.margin = '0 0 12px';
  [['conf', 'By conference'], ['all', 'Overall']].forEach(([k, label]) => {
    const b = el('button', 'ep-chip' + (confView === k ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (confView === k) return;
      confView = k;
      pane.textContent = '';
      renderConferences(pane, rows, ST, competition);
    });
    pick.appendChild(b);
  });
  host.appendChild(pick);

  if (confView === 'all') {
    host.appendChild(overallTable(ST.overall(rows), ST));
  } else {
    ST.split(rows).forEach(g => {
      host.appendChild(el('div', 'grouphead', ST.groupLabel(g.name, competition)));
      g.divisions.forEach(d => {
        if (d.name) host.appendChild(el('div', 'divhead', d.name));
        host.appendChild(conferenceTable(d.rows, ST));
      });
    });
    host.appendChild(el('div', 'tblnote',
      'Conference: games against the club\'s own conference only, which decides the order. ' +
      'Overall: the complete schedule, non-conference games and playoffs included.'));
  }
  pane.appendChild(host);
}

function recordCells(tr, w, l, gp, ST, strong) {
  const rec = el('td', 'rec', ST.record(w, l));
  if (strong) rec.style.color = 'var(--ink)';
  tr.appendChild(rec);
  tr.appendChild(el('td', null, ST.pct(w, gp)));
}

function conferenceTable(rows, ST) {
  const wrap = el('div', 'ep-tw');
  const t = el('table', 'ep-tbl'); t.style.minWidth = '640px';
  const thead = el('thead');
  const top = el('tr');
  [['', 2], ['CONFERENCE', 2], ['OVERALL', 2], ['', 4]].forEach(([h, n]) => {
    const th = el('th', 'spanhead', h); th.colSpan = n; top.appendChild(th);
  });
  const hr = el('tr');
  ['#', 'TEAM', 'W-L', 'PCT', 'W-L', 'PCT', 'PF', 'PA', 'DIFF', 'STREAK']
    .forEach(h => hr.appendChild(el('th', null, h)));
  thead.append(top, hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    tr.appendChild(el('td', null, r.rank ?? ''));
    tr.appendChild(teamCell(r.teams));
    recordCells(tr, r.conf_w, r.conf_l, r.conf_gp, ST, true);
    recordCells(tr, r.w, r.l, r.gp, ST, false);
    tr.appendChild(el('td', null, r.pts_for));
    tr.appendChild(el('td', null, r.pts_against));
    tr.appendChild(diffCell(r.diff));
    tr.appendChild(streakCell(r.streak));
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}

function overallTable(rows, ST) {
  const wrap = el('div', 'ep-tw');
  const t = el('table', 'ep-tbl'); t.style.minWidth = '680px';
  const thead = el('thead'); const hr = el('tr');
  ['#', 'TEAM', 'CONF.', 'W-L', 'PCT', 'CONF. W-L', 'PF', 'PA', 'DIFF', 'STREAK']
    .forEach(h => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    tr.appendChild(el('td', null, r.overall_rank));
    tr.appendChild(teamCell(r.teams));
    tr.appendChild(el('td', null, [r.group_name, r.division_name].filter(Boolean).join(' · ')));
    recordCells(tr, r.w, r.l, r.gp, ST, true);
    tr.appendChild(el('td', 'rec', ST.record(r.conf_w, r.conf_l)));
    tr.appendChild(el('td', null, r.pts_for));
    tr.appendChild(el('td', null, r.pts_against));
    tr.appendChild(diffCell(r.diff));
    tr.appendChild(streakCell(r.streak));
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
    /* Ascending: this is a FIXTURE LIST. Newest-first is right for a results
       feed and wrong for a schedule, where round one belongs at the top and
       the reader scrolls towards the games that have not happened. */
    `&order=tipoff_at.asc`);
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

/* WHICH COMPETITIONS THE NUMBERS COVER.

   Every stats surface was scoped to one competition — whichever phase the
   Table tab happened to be showing — so after a single playoff game the team
   stats read two teams and one game, and the leaders board with them. Nobody
   means that by "the season's statistics": they mean the league phase and its
   cup and its playoffs together, which is what a season is.

   So the default is everything in the season, and the filter narrows rather
   than being the only way to see anything. Held here rather than in the URL
   because it is a lens on a page, not a place — a link somebody sends should
   open on the whole season, not on whatever phase the sender was inspecting. */
let statScope = 'all';                 // 'all' | a competition id

function scopeIds() {
  if (statScope !== 'all') return [statScope];
  const ids = comps.map(c => c.id).filter(Boolean);
  return ids.length ? ids : (comp ? [comp.id] : []);
}

async function loadSeason() {
  const ids = scopeIds();
  const key = ids.slice().sort().join(',');
  if (SEASON && SEASON.__comp === key) return SEASON;
  SEASON = await window.EpinoiaData.season(ids);
  SEASON.__comp = key;
  const [pmeta, tmeta] = await Promise.all([
    window.EpinoiaData.playerMeta(SEASON.players.map(p => p.id)),
    window.EpinoiaData.teamMeta(league.id)
  ]);
  SEASON.players.forEach(p => Object.assign(p, pmeta[p.id] || { name: 'Player' }));
  SEASON.teams.forEach(t => Object.assign(t, tmeta[t.id] || { name: 'Team' }));
  return SEASON;
}

/* AND WHICH CONFERENCE. A college league is forty-eight clubs in four conferences, and one table
   of all of them is a table nobody reads, so a league of conferences (or of groups, ProB's Nord
   and Süd) gets a button for each (scopebar.js), beside the buttons for the season's
   competitions. The conference is a lens on the rows, not a different read: the season is read
   once for the scope, and the conference only decides which clubs -- and which clubs' players --
   are shown. Kept across a change of competition while the new one still has it. */
let statConf = null;                   // null: not chosen yet, so scopebar.js settles it
let SCOPE = null;                      // { season, model }: who is in which competition and group

function scopeModel() {
  const key = season && season.id;
  if (!SCOPE || SCOPE.season !== key) {
    const X = window.EpinoiaScopeBar;
    SCOPE = { season: key, model: X ? X.load(window.EpinoiaData, comps).catch(() => null) : Promise.resolve(null) };
  }
  return SCOPE.model;
}

/* One control, drawn into each stats pane. Two panes rather than one shared
   bar because they are separate tabs and a filter that lives above the tabs
   would look like it governs the Table and the fixtures too, which it does
   not — those are per-competition by their nature.
   Draws the buttons into `host` and resolves to the pane's test of whether a club is shown. */
async function scopePicker(host, onChange) {
  const X = window.EpinoiaScopeBar;
  const M = await scopeModel();
  if (!X || !M) return () => true;
  statConf = X.settle(M, scopeIds(), statConf);
  X.mount({
    host, model: M, scope: statScope, conf: statConf,
    scopeIds: s => (s === 'all' ? comps.map(c => c.id).filter(Boolean) : [s]),
    onScope: s => {
      statScope = s;
      SEASON = null;                   // the scope changed, so the numbers did
      onChange();
    },
    onConf: g => { statConf = g; onChange(); }
  });
  return X.keeper(M, scopeIds(), statConf);
}

/* the club a player's numbers are filed under: where he played (the games), else his roster */
const clubOf = (S, p) => (S.teamOfPlayer && S.teamOfPlayer.get(p.id)) || p.teamId || null;

async function renderLeaders() {
  const pane = $('#pane-leaders'); pane.textContent = '';
  const bar = el('div', 'scopehost'); pane.appendChild(bar);
  /* EpinoiaTable.render empties whatever host it is given, so the filter needs
     a host of its own — passing the pane wiped the control that had just been
     put there, which is why it appeared to do nothing. */
  const board = el('div', 'boardhost'); pane.appendChild(board);
  let S, keep;
  try { [S, keep] = await Promise.all([loadSeason(), scopePicker(bar, renderLeaders)]); }
  catch (e) { pane.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return; }

  if (!S.players.length) {
    pane.appendChild(el('div', 'empty',
      'No player statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  const rows = S.players.filter(p => keep(clubOf(S, p)));
  if (!rows.length) {
    pane.appendChild(el('div', 'empty', 'No player statistics for this conference yet.'));
    return;
  }
  window.EpinoiaTable.render({
    host: board, kind: 'player', sortKey: 'ppg', minGames: 1,
    filename: (league.slug || 'league') + '-leaders',
    /* the table drops the premium columns itself when this league's analytics are locked */
    leagueId: league.id, leagueSlug: league.slug,
    /* the same pick-and-compare the season statistics page offers (fulltable.js tray) */
    selectable: { max: 5 },
    rows,
    playerHref: r => '../p/?p=' + encodeURIComponent(r.id),
    /* the same on-request RAPM as the season statistics page: every stint in the scope */
    rapm: window.EpinoiaRAPM
      ? (onProgress => window.EpinoiaRAPM.season(EpinoiaData, S.games.map(g => g.id), onProgress))
      : null
  });
}

/* ----------------------------------------------------------- team stats --- */
async function renderTeamStats() {
  const pane = $('#pane-teams'); pane.textContent = '';
  const bar = el('div', 'scopehost'); pane.appendChild(bar);
  const board = el('div', 'boardhost'); pane.appendChild(board);
  let S, keep;
  try { [S, keep] = await Promise.all([loadSeason(), scopePicker(bar, renderTeamStats)]); }
  catch (e) { pane.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return; }

  if (!S.teams.length) {
    pane.appendChild(el('div', 'empty',
      'No team statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  const rows = S.teams.filter(t => keep(t.id));
  if (!rows.length) {
    pane.appendChild(el('div', 'empty', 'No team statistics for this conference yet.'));
    return;
  }
  /* the shot zones ride on the same rows: the logs are read once (cached) and the table is
     drawn when they are in, so its "shot zones" view is never a column of dashes.
     WITHOUT ANALYTICS THE READ IS NOT MADE: it fetches the event log of every game in scope,
     and the only thing it feeds is the zone columns the table drops for this viewer. */
  if (!ANALYTICS_LOCKED) {
    const holding = el('div', 'empty', 'reading every shot\u2026'); board.appendChild(holding);
    try {
      if (window.EpinoiaShotChart && window.EpinoiaShotChart.attachZoneStats) await window.EpinoiaShotChart.attachZoneStats(S, window.EpinoiaData);
    } catch (_) { /* the table still draws; the zones view shows dashes */ }
    holding.remove();
  }
  window.EpinoiaTable.render({
    host: board, kind: 'team', sortKey: 'ppg',
    filename: (league.slug || 'league') + '-team-stats',
    leagueId: league.id, leagueSlug: league.slug,
    rows,
    teamHref: r => r.slug ? '../t/?t=' + encodeURIComponent(r.slug) : null
  });
}

/* ------------------------------------------------- strength of schedule --- */
/* index_9's Strength of Schedule tab (epinoia/sos.js) over the same season read and the same
   "covering" control as the team statistics: both sides of every finalised game, which is
   what that table is built from. Drawn the first time the tab is opened; after that it
   follows the season, the phase and the scope like every other pane. */
let sosShown = false, booted = false, sosSeq = 0;
let leadersShown = false, teamsShown = false;   // drawn the first time their tab is opened (renderPanes)

async function renderSOS() {
  const pane = $('#pane-sos');
  if (!pane) return;
  const seq = ++sosSeq;
  pane.textContent = '';
  const bar = el('div', 'scopehost'); pane.appendChild(bar);
  const board = el('div', 'boardhost'); pane.appendChild(board);
  const X = window.EpinoiaSOS;
  if (!X) { board.appendChild(el('div', 'empty', 'The strength of schedule could not be loaded.')); return; }
  board.appendChild(el('div', 'empty', 'working out the schedule…'));
  let S, meetings = null, keep = () => true;
  try {
    const [season, fixtures, k] = await Promise.all([
      loadSeason(),
      /* how often each pair of clubs meets, from the whole fixture list (played and to come).
         Without it the projected record assumes four meetings, which is index_9's SLB. */
      window.EpinoiaData.all(`games?competition_id=in.(${scopeIds().join(',')})` +
        `&select=home_team_id,away_team_id`).catch(() => []),
      scopePicker(bar, renderSOS)
    ]);
    S = season;
    meetings = X.meetingsFrom(fixtures);
    keep = k;
  } catch (e) {
    if (seq !== sosSeq) return;
    board.textContent = '';
    board.appendChild(el('div', 'empty', 'Could not load: ' + e.message));
    return;
  }
  /* a newer scope or season is already drawing into a pane this one no longer owns */
  if (seq !== sosSeq) return;
  const byId = new Map((S.teams || []).map(t => [t.id, t]));
  X.render({
    host: board, games: X.gameLines(S), meetings,
    /* the conference's clubs are shown; every game in scope still counts, because the games
       a conference plays outside itself are what make its schedule comparable */
    only: keep,
    team: id => {
      const t = byId.get(id) || {};
      return { name: t.name || 'Team', short: t.teamShort, colour: t.colour, logo: t.logo,
               href: t.slug ? '../t/?t=' + encodeURIComponent(t.slug) : null };
    }
  });
}

/* SIX TABS RUN PAST A NARROW SCREEN, so the one being shown is scrolled into sight -- sideways
   only, so the page itself never jumps. Arriving on #sos the row is not a scroller yet (xscroll.js
   runs after this file), so it is asked again once the page has loaded. */
function revealTab(btn) {
  const row = btn.parentElement;
  if (!row) return;
  const go = () => {
    if (row.scrollWidth <= row.clientWidth) return;
    const rb = row.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    if (bb.right > rb.right) row.scrollLeft += bb.right - rb.right + 16;
    else if (bb.left < rb.left) row.scrollLeft -= rb.left - bb.left + 16;
  };
  go();
  if (document.readyState !== 'complete') window.addEventListener('load', go, { once: true });
}

function showTab(name) {
  const btn = [...document.querySelectorAll('.ep-tab')].find(b => b.dataset.p === name);
  if (!btn) return false;
  document.querySelectorAll('.ep-tab').forEach(x => x.classList.remove('on'));
  btn.classList.add('on');
  revealTab(btn);
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  const pane = document.getElementById('pane-' + name);
  if (pane) pane.classList.add('on');
  /* opened before the page has its season, renderPanes draws it when the season arrives */
  if (name === 'sos' && !sosShown) { sosShown = true; if (booted && !PAYWALLED) renderSOS(); }
  if (name === 'leaders' && !leadersShown) { leadersShown = true; if (booted && !PAYWALLED) renderLeaders(); }
  if (name === 'teams' && !teamsShown) { teamsShown = true; if (booted && !PAYWALLED) renderTeamStats(); }
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
