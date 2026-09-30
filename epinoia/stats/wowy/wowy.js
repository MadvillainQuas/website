'use strict';
/* ============================================================================
   THE WOWY / LINEUPS PAGE — the controller. Parts are drawn by wowyui.js, the rules and the address by
   wowylogic.js, the numbers by lineups.js (and withstats.js for a player's own box). This file fetches, keeps
   the state, and decides what shows.

   Five views of one team's floor time, chosen in the address (?v=), each a section of the page:
     overview   the team's rating against the league, the starting five, the rotation
     lineups    every unit of 2-5 players, coloured against the league's units, filtered, sortable, expandable
     onoff      one player: the team with him on and off, his best and worst partners, his own box with them
     pair       two players, four ways they shared the floor, and the on/off grid of up to five
     build      choose up to five players, read that unit

   WHAT IS FETCHED, AND WHEN. The chosen team's games and stints first (as the page always did), so it paints
   quickly. The rest of the league's stints follow in the background: they are the reference every colour is
   measured against ("better than 80% of the league's fives"), and the All teams view. Until they arrive the
   colours are measured against the team's own units and the key says so. A player's own box, split by
   teammate, needs the event log, so it is fetched only when the On / off view is open (and never for a preview).

   MEMBERSHIPS (docs/memberships.md, access.js): unchanged in what they decide. A viewer who may not see the
   league gets the paywall card; a non-member gets a PREVIEW, capped by CATALOGUE.wowyPreviewMax players,
   which wowylogic.gate() turns into what each view keeps: On / off and the overview stay open, the lineups list
   is the five best fives, and the pair, combinations and builder show what one player can plus the teaser.
   ============================================================================ */

const D = window.EpinoiaData, W = window.EpinoiaWowyLogic, UI = window.EpinoiaWowyUI, L = window.EpinoiaLineups;
const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

let league = null, leagueRow = null, teams = [], teamsById = {}, seasonComps = null, compIds = [], seasonName = '';
let preview = false, walled = false;
let state = W.decodeState(location.search);
let team = null;                                   // the chosen team (never null once booted; the All view keeps the last one)
const TD = new Map();                              // team id -> { games, stints, roster, preview }
const META = {}, PHOTOS = {};
let LG = null, LGp = null;                         // the league's stints: { byTeam: Map(teamId -> stints), games: Map }
let loadToken = 0, rowsMax = 25, matrixPick = [], events = null;
const unitCache = new Map(), scaleCache = new Map();

/* ------------------------------------------------------------- memberships --- */
function accessState() {
  const A = window.EpinoiaAccess;
  if (!A || !league || typeof A.get !== 'function') return { A: null, st: {} };
  return { A, st: A.get(league.id) || {} };
}
function showWall() {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.paywallHTML !== 'function') return false;
  walled = true;
  $('#wowyBody').classList.add('hide');
  const w = $('#accessWall');
  w.innerHTML = A.paywallHTML({ league });
  w.classList.remove('hide');
  return true;
}
function onAccessChange() {
  const { A, st } = accessState();
  if (!A || !st.known) return;
  const nowWalled = typeof A.canView === 'function' && !A.canView(league.id);
  if (nowWalled !== walled) { location.reload(); return; }
  const nowPreview = typeof A.analyticsOk === 'function' && !A.analyticsOk(league.id);
  if (nowPreview !== preview) { preview = nowPreview; events = null; TD.forEach(d => { d.preview = preview; }); render(); }
}
const previewMax = () => { const A = window.EpinoiaAccess; return (A && A.CATALOGUE && A.CATALOGUE.wowyPreviewMax) || 1; };
const gate = () => W.gate(preview, previewMax());

/* -------------------------------------------------------------- the address --- */
function writeAddress() {
  try {
    const s = Object.assign({}, state);
    history.replaceState(null, '', location.pathname + W.encodeState(s, location.search));
  } catch (_) { /* the page is still right */ }
}
const qs = patch => W.encodeState(Object.assign({}, state, patch || {}), location.search);

/* ---------------------------------------------------------------- the width --- */
const host = () => $('#wowyBody');
const kind = () => W.sizeKind((host() && host().clientWidth) || 800);
const colKey = (view, k) => 'epinoia.wowy.cols.' + view + '.' + k;
function colsFor(view) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(colKey(view, kind())) || 'null'); } catch (_) { /* the default */ }
  if (view === 'matrix' && !saved) saved = ['mins', 'poss', 'net', 'ortg', 'drtg', 'efg', 'tov', 'oreb', 'ftr', 'defg'];
  return W.pickColumns(saved, kind());
}
function setCols(view, keys) {
  try { if (keys) localStorage.setItem(colKey(view, kind()), JSON.stringify(keys)); else localStorage.removeItem(colKey(view, kind())); } catch (_) { /* per-viewer convenience only */ }
}

/* -------------------------------------------------------------------- data --- */
function decorate(t) {
  const logo = window.epinoiaLogoUrl && (t.logo_path ? window.epinoiaLogoUrl(t.logo_path, 64) : null);
  return { id: t.id, name: t.name, short: t.short_name || '', slug: t.slug, colour: t.colour, logo_path: t.logo_path, logoUrl: logo || null };
}
async function metaFor(ids) {
  const need = ids.filter(id => id != null && !META[id]);
  if (need.length) { const m = await D.playerMeta(need); Object.assign(META, m); need.forEach(id => { if (!META[id]) META[id] = { name: 'Player' }; }); }
}
async function photosFor(ids) {
  const need = ids.filter(id => id != null && !(id in PHOTOS) && /^[0-9a-f-]{36}$/i.test(String(id)));
  if (!need.length) return;
  need.forEach(id => { PHOTOS[id] = null; });
  const cfg = window.EPINOIA_CONFIG || {};
  for (let i = 0; i < need.length; i += 40) {
    try {
      const c = need.slice(i, i + 40);
      const rows = await D.get('players?id=in.(' + c.join(',') + ')&select=id,photo_url,media:photo_media_id(storage_path)') || [];
      rows.forEach(p => {
        const path = p.media && p.media.storage_path;
        const stored = path ? (cfg.supabaseUrl || '') + '/storage/v1/object/public/media-public/' + path.split('/').map(encodeURIComponent).join('/') : null;
        const url = stored || p.photo_url || null;
        if (url && /^https:\/\//i.test(url)) PHOTOS[p.id] = url;
      });
    } catch (_) { /* initials all round */ }
  }
  UI.hydrate(ctx, document);
}

function rosterOf(stints) {
  const mins = new Map();
  stints.forEach(s => (s.player_ids || []).forEach(id => mins.set(id, (mins.get(id) || 0) + ((s.stats && s.stats.dur) || 0))));
  return [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

async function fetchTeam(t) {
  if (TD.has(t.id) && TD.get(t.id).preview === preview) return TD.get(t.id);
  let out;
  if (LG && LG.byTeam.has(t.id)) {
    const games = [...LG.games.values()].filter(g => g.home_team_id === t.id || g.away_team_id === t.id);
    const stints = LG.byTeam.get(t.id);
    out = { games, stints, roster: rosterOf(stints), preview };
  } else {
    const gs = await D.all('games?or=(home_team_id.eq.' + t.id + ',away_team_id.eq.' + t.id + ')' +
      (seasonComps && seasonComps.length ? '&competition_id=in.(' + seasonComps.join(',') + ')' : '') +
      '&status=eq.final&select=id,home_team_id,away_team_id,starters');
    if (!gs.length) out = { games: [], stints: [], roster: [], preview };
    else {
      const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
      const st = await D.stints(gs.map(g => g.id), t.id, byGame);
      out = { games: gs, stints: st, roster: rosterOf(st), preview };
    }
  }
  await metaFor(out.roster);
  TD.set(t.id, out);
  return out;
}

/* the rest of the league, in the background: the reference for every colour, and the All teams view */
function ensureLeague() {
  if (LGp) return LGp;
  LGp = (async () => {
    if (!compIds.length) return null;
    const gs = await D.all('games?competition_id=in.(' + compIds.join(',') + ')&status=eq.final&select=id,home_team_id,away_team_id,starters');
    const games = new Map(); gs.forEach(g => games.set(g.id, g));
    const raw = await D.stints(gs.map(g => g.id));
    const byTeam = new Map();
    raw.forEach(r => {
      const g = games.get(r.game_id); if (!g) return;
      const tid = r.team_idx === 0 ? g.home_team_id : g.away_team_id;
      if (!byTeam.has(tid)) byTeam.set(tid, []);
      byTeam.get(tid).push(r);
    });
    LG = { byTeam, games };
    unitCache.clear(); scaleCache.clear();
    return LG;
  })().catch(e => { console.warn('[wowy] league', e); LGp = null; return null; });
  return LGp;
}

async function ensureEvents(t) {
  const d = TD.get(t.id);
  if (!d || preview || !d.games.length) return null;
  if (events && events.teamId === t.id) return events;
  const evs = await D.events(d.games.map(g => g.id));
  const recs = window.EpinoiaWith.index(d.games.map(g => ({ starters: g.starters, events: evs.filter(e => e.gameId === g.id) })));
  events = { teamId: t.id, recs };
  return events;
}

/* ------------------------------------------------------------------ the ctx --- */
function stintsOfTeam(id) {
  if (LG && LG.byTeam.has(id)) return LG.byTeam.get(id);
  const d = TD.get(id); return d ? d.stints : [];
}
function unitsForTeam(id, size) {
  const k = id + ':' + size;
  if (!unitCache.has(k)) unitCache.set(k, L.sized(stintsOfTeam(id), size, 0).map(u => Object.assign(u, { teamId: id })));
  return unitCache.get(k);
}
function unitsFor(size) {
  if (state.t === 'all' && LG) {
    const k = 'all:' + size;
    if (!unitCache.has(k)) { let all = []; LG.byTeam.forEach((_, id) => { all = all.concat(unitsForTeam(id, size)); }); unitCache.set(k, all); }
    return unitCache.get(k);
  }
  return unitsForTeam(team.id, size);
}
function referenceUnits(size) {
  if (LG) { let all = []; LG.byTeam.forEach((_, id) => { all = all.concat(unitsForTeam(id, size)); }); return { units: all, source: 'league' }; }
  return { units: unitsForTeam(team.id, size), source: 'team' };
}
function scalesFor(size) {
  const k = size + ':' + (LG ? 'L' : 'T') + ':' + state.mm + ':' + state.mp + ':' + (LG ? '' : team.id);
  if (!scaleCache.has(k)) {
    const ref = referenceUnits(size);
    const thr = { minMinutes: state.mm, minPoss: state.mp };
    const sc = W.referenceScales(ref.units, null, thr);
    const n = ref.units.filter(u => W.reliability(u, thr) === 'ok').length;
    scaleCache.set(k, { sc, n, source: ref.source });
  }
  return scaleCache.get(k).sc;
}
const WORD = { 1: 'single-player', 2: 'two-man', 3: 'three-man', 4: 'four-man', 5: 'five-man' };
function scaleNote(size) {
  scalesFor(size);
  const k = size + ':' + (LG ? 'L' : 'T') + ':' + state.mm + ':' + state.mp + ':' + (LG ? '' : team.id);
  const e = scaleCache.get(k);
  return (e.source === 'league' ? 'the league’s ' : 'this team’s ') + e.n + ' ' + WORD[size] + ' unit' + (e.n === 1 ? '' : 's') + ' with at least ' + state.mm + ' minutes and ' + state.mp + ' possessions' +
    (e.source === 'team' ? ' (the rest of the league is still loading)' : '');
}
function teamScales() {
  if (!LG || LG.byTeam.size < 4) return {};
  const k = 'teams';
  if (!scaleCache.has(k)) {
    const lines = [...LG.byTeam.values()].map(s => L.filter(s, [])).filter(l => l.mins >= state.mm * 3);
    const sc = {}; ['net', 'ortg', 'drtg', 'pace', 'mins', 'poss'].forEach(key => { sc[key] = W.scaleOf(lines.map(l => l[key])); });
    scaleCache.set(k, sc);
  }
  return scaleCache.get(k);
}
function playerScales() {
  const key = 'players:' + (LG ? 'L' : 'T') + state.mm + (LG ? '' : team.id);
  if (!scaleCache.has(key)) {
    const floor = Math.max(state.mm * 3, 30);
    let list = [];
    if (LG) LG.byTeam.forEach(s => { list = list.concat(W.playerSplits(s, floor)); });
    else list = W.playerSplits(team ? stintsOfTeam(team.id) : [], floor);
    scaleCache.set(key, { onNet: W.scaleOf(list.map(x => x.on.net)), offNet: W.scaleOf(list.map(x => x.off.net)), swing: W.scaleOf(list.map(x => x.diff.net)), n: list.length, source: LG ? 'league' : 'team' });
  }
  return scaleCache.get(key);
}

const ctx = {
  get state() { return state; }, get gate() { return gate(); }, get team() { return team; },
  get teamStints() { return team ? stintsOfTeam(team.id) : []; },
  get games() { const d = team && TD.get(team.id); return d ? d.games : []; },
  get thr() { return { minMinutes: state.mm, minPoss: state.mp }; },
  get rowsMax() { return rowsMax; }, set rowsMax(v) { rowsMax = v; },
  get matrixPick() { return matrixPick; }, set matrixPick(v) { matrixPick = v; },
  meta: META, photos: PHOTOS, league: null, teamsById,
  kind, cols: colsFor, setCols, qs,
  rosterIds: () => (team && TD.get(team.id) ? TD.get(team.id).roster : []),
  stintsOfTeam, unitsFor, scalesFor, scaleNote, teamScales, playerScales,
  go(patch) { go(patch); },
  redraw() { render(); },
  link(patch) { copyLink(patch); }
};

/* ------------------------------------------------------------------- actions --- */
function say(msg) { const n = $('#wnotes'); if (n) n.textContent = msg || ''; }
async function copyLink(patch) {
  const u = location.origin + location.pathname + W.encodeState(Object.assign({}, state, patch || {}), location.search);
  try { await navigator.clipboard.writeText(u); say('Link copied: it opens this exact view.'); }
  catch (_) { say(u); }
  setTimeout(() => say(''), 5000);
}
function go(patch) {
  const before = JSON.stringify([state.t, state.v]);
  Object.assign(state, patch);
  if ('mm' in patch || 'mp' in patch) scaleCache.clear();
  if ('sz' in patch || 'inc' in patch || 'exc' in patch || 'sort' in patch || 'best' in patch || 't' in patch || 'v' in patch) rowsMax = 25;
  if (JSON.stringify([state.t, state.v]) !== before) { applyTeam(); return; }
  render();
}

async function applyTeam() {
  /* the All teams view is for the lineups list only; the others are about one club */
  if (state.t === 'all' && state.v !== 'lineups') state.t = team ? team.slug : (teams[0] && teams[0].slug);
  if (state.t !== 'all') {
    const t = teams.find(x => x.slug === state.t) || team || teams[0];
    if (t) { state.t = t.slug; if (!team || team.id !== t.id) { team = t; } }
  } else if (!LG) { await ensureLeague(); }
  const token = ++loadToken;
  say('Loading…');
  try {
    await fetchTeam(team);
    if (token !== loadToken) return;
    if (state.t === 'all' && !LG) { say('The league is still loading…'); }
    else say('');
  } catch (e) {
    if (token !== loadToken) return;
    console.warn('[wowy]', e); say('Could not load: ' + (e.message || e)); return;
  }
  render();
  if (!LG && compIds.length) ensureLeague().then(() => { if (token === loadToken) { unitCache.clear(); render(); } });
}

/* ----------------------------------------------------------------- the render --- */
const VIEW_SECTIONS = { overview: ['overview'], lineups: ['lineups'], onoff: ['onoff', 'with'], pair: ['pair'], build: ['build'] };
const VIEW_NAMES = [['overview', 'Overview'], ['lineups', 'Lineups'], ['onoff', 'On / off'], ['pair', 'Pairs'], ['build', 'Builder']];

function drawControls() {
  const c = $('#wctl');
  c.textContent = '';
  const f = el('label', 'fsel');
  f.style.setProperty('--sc', team ? (team.colour || 'var(--ink)') : 'var(--ink)');
  const s = el('select');
  const opts = teams.map(t => [t.slug, t.name]);
  if (state.v === 'lineups') opts.unshift(['all', 'All teams (whole league)']);
  opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (v === state.t) o.selected = true; s.appendChild(o); });
  s.addEventListener('change', () => go({ t: s.value, inc: [], exc: [], p: '', a: '', b: '', u: [] }));
  f.appendChild(el('span', 'fl', 'Team'));
  const box = el('span', 'fbox'); box.appendChild(s); f.appendChild(box);
  c.appendChild(f);
  c.appendChild(UI.seg(VIEW_NAMES.map(([v, t]) => [v, t]), state.v, v => go({ v }), 'View'));
  const d = TD.get(team && team.id);
  if (d && state.t !== 'all') c.appendChild(el('span', 'wnote wsum', d.games.length + ' games · ' + d.stints.length + ' stints · ' + d.roster.length + ' players'));
}

let rendering = 0;
function render() {
  if (walled || !team) return;
  const my = ++rendering;
  const d = TD.get(team.id);
  const isAll = state.t === 'all';
  document.documentElement.style.setProperty('--team-a', (team.colour || '#93f2bf'));
  $('#ctx').textContent = (league ? league.name + ' · ' : '') + (isAll ? 'All teams' : team.name);
  document.title = (isAll ? 'All teams' : team.name) + ' · WOWY / Lineups · Epinoia';
  drawControls();
  const show = VIEW_SECTIONS[state.v] || VIEW_SECTIONS.overview;
  ['overview', 'lineups', 'onoff', 'with', 'pair', 'build'].forEach(id => $('#' + id).classList.toggle('hide', show.indexOf(id) === -1));
  writeAddress();
  if (!d || (!isAll && (!d.games.length || !d.stints.length))) {
    const msg = !d || !d.games.length ? 'No finalised games for this team yet: WOWY fills in once one is played.' : 'No lineup data for this team yet: it fills in as games are finalised.';
    ['vOverview', 'vLineups', 'vOnoff', 'vPair', 'vBuild'].forEach(id => { const n = $('#' + id); n.textContent = ''; n.appendChild(el('div', 'pg-empty', msg)); });
    $('#with').classList.add('hide');
    return;
  }
  try {
    const t0 = performance.now();
    if (state.v === 'overview') UI.overviewView(ctx, $('#vOverview'));
    else if (state.v === 'lineups') {
      if (isAll && !LG) { const n = $('#vLineups'); n.textContent = ''; n.appendChild(el('div', 'pg-empty', 'Loading every team’s stints…')); ensureLeague().then(() => { unitCache.clear(); render(); }); return; }
      UI.lineupsView(ctx, $('#vLineups'));
    } else if (state.v === 'onoff') {
      const pid = UI.onOffView(ctx, $('#vOnoff'));
      drawWith(pid);
    } else if (state.v === 'pair') UI.pairView(ctx, $('#vPair'));
    else if (state.v === 'build') UI.buildView(ctx, $('#vBuild'));
    window.__wowyRenderMs = Math.round(performance.now() - t0);
  } catch (e) { console.error('[wowy] render', e); }
  if (my !== rendering) return;
  fillMissing();
}

/* circles of players this page has not met yet (the All teams list), and every photo: fetched after the paint */
let fillBusy = false;
async function fillMissing() {
  const ids = [...new Set([...document.querySelectorAll('.wc[data-pid]')].map(n => n.dataset.pid))];
  const noMeta = ids.filter(id => !META[id]);
  if (noMeta.length && !fillBusy) {
    fillBusy = true;
    try { await metaFor(noMeta); } finally { fillBusy = false; }
    render();
    return;
  }
  photosFor(ids);
}

/* his own box, split by teammates: members only, and only when the On / off view is open */
async function drawWith(pid) {
  const hostEl = $('#vWith');
  if (!pid) { $('#with').classList.add('hide'); return; }
  if (preview) {
    hostEl.textContent = '';
    hostEl.innerHTML = window.EpinoiaAccess && window.EpinoiaAccess.teaserHTML ? window.EpinoiaAccess.teaserHTML({
      leagueSlug: league && league.slug, title: 'On the floor with is for members',
      lines: ['One player’s own box score split by who shared the floor with him: his shooting, his creation and his mistakes, with any teammates you choose against without them.']
    }) : '';
    return;
  }
  hostEl.textContent = ''; hostEl.appendChild(el('div', 'pg-empty', 'Loading his box score with each teammate…'));
  const t = team;
  try {
    const ev = await ensureEvents(t);
    if (t !== team || state.v !== 'onoff') return;
    const d = TD.get(t.id);
    const mates = new Set();
    d.stints.forEach(s => { const ids = s.player_ids || []; if (ids.indexOf(pid) !== -1) ids.forEach(id => { if (id !== pid) mates.add(id); }); });
    hostEl.textContent = '';
    window.EpinoiaWithUI.render({ host: hostEl, recs: ev.recs, stints: d.stints, playerId: pid, meta: META, teammates: [...mates] });
  } catch (e) { console.warn('[wowy] with', e); hostEl.textContent = ''; hostEl.appendChild(el('div', 'pg-empty', 'Could not load: ' + (e.message || e))); }
}

/* the width changes what a table can hold (a phone, a narrow column, a wide one): draw again when the class changes */
let lastKind = null;
function watchWidth() {
  const h = host();
  if (!h || typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => { const k = kind(); if (lastKind && k !== lastKind && team && !walled) render(); lastKind = k; }).observe(h);
  lastKind = kind();
}

/* ----------------------------------------------------------------------- boot --- */
(async function boot() {
  try {
    const SB = window.EpinoiaSeasonBar;
    const c = SB ? await SB.context(D.get, qp.get('l') || 'demo-league', qp.get('s'))
                 : await D.context(qp.get('l') || 'demo-league', qp.get('c'));
    league = c.league; ctx.league = league;
    if (SB && c.seasons.length > 1 && c.season) {
      seasonComps = (c.season.comps || []).map(x => x.id);
      SB.mount({ host: $('#seasonPick'), wrap: $('#seasonRow'), seasons: c.seasons, season: c.season });
    }
    compIds = seasonComps || (c.comps || []).map(x => x.id);
    seasonName = (c.season && c.season.name) || '';
    window.__CS_LEAGUE_SLUG = league.slug;

    /* the league's colours and its place in the head, as every page of the standard */
    try {
      const rows = await D.get('leagues?slug=eq.' + encodeURIComponent(league.slug) + '&select=*&limit=1');
      leagueRow = (rows && rows[0]) || league;
      if (window.EpinoiaTeamColour && window.EpinoiaTeamColour.league) window.EpinoiaTeamColour.league(leagueRow, { keepAccent: !!(leagueRow.theme && leagueRow.theme.accent) });
    } catch (_) { /* the kit's colours */ }
    const kick = $('#kick'); kick.textContent = '';
    const a = el('a', null, league.name); a.href = '../../?l=' + encodeURIComponent(league.slug); kick.appendChild(a);

    const A = window.EpinoiaAccess;
    if (A && typeof A.load === 'function') {
      try { await A.load({ leagueId: league.id, leagueSlug: league.slug }); } catch (_) { /* fail open */ }
      const { st } = accessState();
      if (st.known && typeof A.canView === 'function' && !A.canView(league.id) && showWall()) {
        if (typeof A.onChange === 'function') A.onChange(onAccessChange);
        return;
      }
      preview = typeof A.analyticsOk === 'function' && !A.analyticsOk(league.id);
      if (typeof A.onChange === 'function') A.onChange(onAccessChange);
    }

    const rows = await D.all('teams?league_id=eq.' + league.id + '&select=id,name,short_name,slug,colour,logo_path&order=name');
    teams = rows.map(decorate); teams.forEach(t => { teamsById[t.id] = t; });
    if (!teams.length) { $('#who').querySelector('.sec-b').appendChild(el('div', 'pg-empty', 'This league has no teams yet.')); return; }
    /* the address may name a team the league has not got: the first one stands in */
    if (state.t !== 'all') { team = teams.find(t => t.slug === state.t) || teams[0]; state.t = team.slug; }
    else team = teams[0];
    matrixPick = [];
    watchWidth();
    await applyTeam();
  } catch (e) {
    console.warn('[wowy]', e);
    say('Could not load: ' + (e.message || e));
  }
})();
