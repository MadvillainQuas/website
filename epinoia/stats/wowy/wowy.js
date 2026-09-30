'use strict';
/* ============================================================================
   THE WOWY / LINEUPS PAGE — the controller. Parts are drawn by wowyui.js, the rules and the address by
   wowylogic.js, the numbers by lineupevents.js over lineups.js (and withstats.js for a player's own box). This
   file fetches, keeps the state, and decides what shows.

   Seven views of one team's floor time, chosen in the address (?v=), each a section of the page:
     overview   the team's rating, the starting five, the rotation, the most used fives
     lineups    every unit of 2-5 players as cards or a table, coloured against the league's units, filtered
     onoff      one player: the team with him on and off, his partners, every player's on/off, his own box
     pair       two players, the four ways they shared the floor
     wowy       up to five players, every on/off arrangement of them (with or without you)
     vs         the team, its players and its fives split by who the other side had on
     build      choose up to five players, read that unit
   Every section carries the same "against" switch (?vs=all|start|mixed|bench), and every list the same layout
   (?lay=cards|table) and reading (?dm=both|values|deltas).

   WHAT IS FETCHED, AND WHEN. The chosen team's games and stints first, so the page paints at once with the stint
   numbers (minutes, +/-, ratings, the four factors: the box score's Lineups tab). Then, for a member, the team's
   play-by-play, game by game (the CDN's files first, data.js events()), each game replayed once into segments
   (lineupevents.js) and kept: in memory for the visit, and in sessionStorage by game and finalisation so a
   reload or another tab of the same club reads nothing twice. While it reads, the play-by-play cells say so and
   the switch counts the games; when it is in, the page draws again with every column. The rest of the league's
   stints follow in the background: they are the reference the colours are measured against.

   MEMBERSHIPS (docs/memberships.md, access.js). A viewer who may not see the league gets the paywall card; a
   non-member gets the PREVIEW (wowylogic.gate): the stint numbers of what one player can see, and the play-by-play
   columns, the vs-starters switch and its tab wear the site's lock. A preview never reads the event log.
   ============================================================================ */

const D = window.EpinoiaData, W = window.EpinoiaWowyLogic, UI = window.EpinoiaWowyUI, L = window.EpinoiaLineups, LE = window.EpinoiaLineupEvents;
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
let loadToken = 0, rowsMax = 25;
const unitCache = new Map(), scaleCache = new Map(), rowCache = new Map();

/* ---------------------------------------------------------- the play-by-play --- */
const GS = new Map();                              // game id -> lineupevents.gameSegments(...) (ok or not)
const RAW = new Map();                             // game id -> the flattened log, for the "on the floor with" panel
const EV = new Map();                              // team id -> { status, done, total, covered, oppCovered, recs }
let evVersion = 0;
const SS_PREFIX = 'epinoia.wowy.ev' + (LE ? LE.VERSION : 0) + ':';

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
  if (nowPreview !== preview) {
    preview = nowPreview; TD.forEach(d => { d.preview = preview; }); rowCache.clear();
    if (preview) state.vs = 'all';
    render(); if (!preview && team) ensureEvents(team);
  }
}
const previewMax = () => { const A = window.EpinoiaAccess; return (A && A.CATALOGUE && A.CATALOGUE.wowyPreviewMax) || 1; };
const gate = () => W.gate(preview, previewMax());

/* -------------------------------------------------------------- the address --- */
function writeAddress() {
  try { history.replaceState(null, '', location.pathname + W.encodeState(state, location.search)); } catch (_) { /* the page is still right */ }
}
const qs = patch => W.encodeState(Object.assign({}, state, patch || {}), location.search);

/* ---------------------------------------------------------------- the width --- */
const host = () => $('#wowyBody');
const kind = () => W.sizeKind((host() && host().clientWidth) || 800);
const colKey = (view, k) => 'epinoia.wowy.cols2.' + view + '.' + k;
function colsFor(view) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(colKey(view, kind())) || 'null'); } catch (_) { /* the default */ }
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

const GAME_SELECT = 'id,home_team_id,away_team_id,starters,period,tipoff_at,finalised_at';
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
      '&status=eq.final&select=' + GAME_SELECT);
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
    const gs = await D.all('games?competition_id=in.(' + compIds.join(',') + ')&status=eq.final&select=' + GAME_SELECT);
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
    unitCache.clear(); scaleCache.clear(); rowCache.clear();
    return LG;
  })().catch(e => { console.warn('[wowy] league', e); LGp = null; return null; });
  return LGp;
}

/* ONE GAME'S SEGMENTS: memory, then this tab's session, then the log itself (and the answer kept in both) */
const ssKey = g => SS_PREFIX + g.id + ':' + (g.finalised_at || '');
function ssGet(g) {
  try { const s = sessionStorage.getItem(ssKey(g)); return s ? LE.unpack(JSON.parse(s)) : null; } catch (_) { return null; }
}
function ssPut(g, G) {
  const v = LE.pack(G); if (!v) return;
  const s = JSON.stringify(v);
  try { sessionStorage.setItem(ssKey(g), s); }
  catch (_) {
    /* full: this page's older games go first, then try once more */
    try {
      Object.keys(sessionStorage).filter(k => k.indexOf('epinoia.wowy.ev') === 0).slice(0, 40).forEach(k => sessionStorage.removeItem(k));
      sessionStorage.setItem(ssKey(g), s);
    } catch (__) { /* memory only */ }
  }
}
async function segmentsOf(g) {
  if (GS.has(g.id)) return GS.get(g.id);
  let G = ssGet(g);
  if (!G) {
    const evs = await D.events([g.id]);
    RAW.set(g.id, evs);
    G = LE.gameSegments({ id: g.id, starters: g.starters, events: evs, period: g.period });
    if (G.ok) ssPut(g, G);
  }
  GS.set(g.id, G);
  return G;
}

/* A TEAM'S PLAY-BY-PLAY, read game by game with a few in flight, progress on the switch, one redraw at the end */
function evOf(id) { return EV.get(id) || { status: preview ? 'locked' : 'off', done: 0, total: 0, covered: 0, oppCovered: 0, recs: null }; }
function ensureEvents(t) {
  if (preview || !t || !LE) return null;
  const cur = EV.get(t.id);
  if (cur && (cur.status === 'ready' || cur.status === 'loading')) return cur.p || null;
  const d = TD.get(t.id);
  if (!d || !d.games.length) return null;
  const games = d.games.slice();
  const E = { status: 'loading', done: 0, total: games.length, covered: 0, oppCovered: 0, recs: null };
  EV.set(t.id, E);
  E.p = (async () => {
    let next = 0;
    const lane = async () => {
      while (next < games.length) {
        const g = games[next++];
        try { await segmentsOf(g); } catch (e) { GS.set(g.id, { ok: false, reason: 'read', id: g.id, segs: [] }); }
        E.done++;
        progress(t);
        await new Promise(r => setTimeout(r, 0));   // keep the page answering between games
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, games.length) }, lane));
    const recs = [];
    games.forEach(g => {
      const G = GS.get(g.id);
      if (!G || !G.ok) return;
      E.covered++;
      const side = g.home_team_id === t.id ? 0 : 1;
      const r = LE.recordsOf(G, side);
      if (r.some(x => x.ost != null)) E.oppCovered++;
      r.forEach(x => recs.push(x));
    });
    E.recs = recs;
    E.status = E.covered ? 'ready' : 'error';
    evVersion++; rowCache.clear();
    if (team && team.id === t.id) render();
  })().catch(e => { console.warn('[wowy] events', e); E.status = 'error'; if (team && team.id === t.id) render(); });
  return E.p;
}
function progress(t) {
  if (!team || team.id !== t.id) return;
  const E = EV.get(t.id);
  document.querySelectorAll('.wfaced-n').forEach(n => { n.textContent = 'Reading play-by-play… ' + E.done + '/' + E.total + ' games'; });
}

/* ------------------------------------------------------------- the records ---
   What every view sums: for the whole season, the play-by-play's segments for the games it could read and the
   stints for any it could not (so the minutes are always the whole season); against one kind of opponent five,
   only the segments that know who the opponent had on. */
function stintsOfTeam(id) {
  if (LG && LG.byTeam.has(id)) return LG.byTeam.get(id);
  const d = TD.get(id); return d ? d.stints : [];
}
function recsAll(id) {
  const E = EV.get(id);
  const stints = stintsOfTeam(id);
  if (!E || E.status !== 'ready' || preview) return LE.fromStints(stints);
  const covered = new Set(E.recs.map(r => r.g));
  return E.recs.concat(LE.fromStints(stints.filter(s => !covered.has(s.game_id))));
}
const bucket = () => (preview ? 'all' : state.v === 'vs' && state.vs === 'all' ? 'start' : state.vs);
function recsIn(id, b) {
  if (!b || b === 'all') return recsAll(id);
  const E = EV.get(id);
  if (!E || E.status !== 'ready') return [];
  return LE.inBucket(E.recs, b);
}
const cacheKey = (...p) => p.concat(bucket(), evVersion, preview ? 1 : 0).join('|');
function memo(key, fn) { if (!rowCache.has(key)) rowCache.set(key, fn()); return rowCache.get(key); }
const relOf = line => W.reliability(line, { minMinutes: state.mm, minPoss: state.mp });
const withRel = rows => rows.map(r => Object.assign(r, { rel: relOf(r.line) }));

function teamTotal(id) { return memo(cacheKey('tot', id), () => LE.sum(recsIn(id, bucket()))); }
function teamAll(id) { return memo(cacheKey('totall', id), () => LE.sum(recsAll(id))); }
function unitRowsFor(id, size) {
  return memo(cacheKey('units', id, size), () => {
    const tot = teamTotal(id);
    const t = teamsById[id];
    return LE.units(recsIn(id, bucket()), size).map(u => ({ key: u.ids.join(','), ids: u.ids, teamId: id, team: t, line: LE.line(u.acc), rest: LE.line(LE.minus(tot, u.acc)) }));
  });
}
function unitRows(size) {
  if (state.t === 'all' && LG) {
    return withRel(memo(cacheKey('allunits', size), () => {
      let all = [];
      LG.byTeam.forEach((s, id) => {
        const recs = LE.fromStints(s), tot = LE.sum(recs), t = teamsById[id];
        LE.units(recs, size).forEach(u => all.push({ key: id + ':' + u.ids.join(','), ids: u.ids, teamId: id, team: t, line: LE.line(u.acc), rest: LE.line(LE.minus(tot, u.acc)) }));
      });
      return all;
    }));
  }
  return withRel(unitRowsFor(team.id, size));
}
function rowFor(ids) {
  const id = team.id;
  return withRel([memo(cacheKey('row', id, ids.slice().sort().join(',')), () => {
    const acc = LE.sum(recsIn(id, bucket()), r => ids.every(p => r.ids.indexOf(p) !== -1));
    return { key: ids.join(','), ids: ids.slice(), team, line: LE.line(acc), rest: LE.line(LE.minus(teamTotal(id), acc)) };
  })])[0];
}
function playerRows() {
  const id = team.id;
  const roster = TD.get(id) ? TD.get(id).roster : [];
  return withRel(memo(cacheKey('players', id), () => roster.map(pid => {
    const acc = LE.sum(recsIn(id, bucket()), r => r.ids.indexOf(pid) !== -1);
    return { id: pid, key: pid, team, line: LE.line(acc), rest: LE.line(LE.minus(teamTotal(id), acc)) };
  }).filter(p => p.line.stints)));
}
function playerRow(pid) {
  const r = playerRows().find(p => p.id === pid);
  if (r) return r;
  const blank = LE.line(LE.blank());
  return { id: pid, line: blank, rest: LE.line(teamTotal(team.id)), rel: 'tiny' };
}
function partners(pid) {
  const id = team.id;
  return memo(cacheKey('partners', id, pid), () => {
    const recs = recsIn(id, bucket());
    const mates = new Set();
    recs.forEach(r => { if (r.ids.indexOf(pid) !== -1) r.ids.forEach(x => { if (x !== pid) mates.add(x); }); });
    return [...mates].map(m => {
      const w = LE.pairs(recs, pid, m);
      const both = LE.line(w.both), subjOnly = LE.line(w.aOnly);
      const sw = W.delta('net', both, subjOnly).d;
      return { id: m, both, subjOnly, mateOnly: LE.line(w.bOnly), swing: sw, rel: relOf(both) };
    });
  });
}
function pairRows(a, b) {
  const id = team.id;
  return withRel(memo(cacheKey('pair', id, a, b), () => {
    const w = LE.pairs(recsIn(id, bucket()), a, b);
    const tot = teamTotal(id);
    return [['both', true, true], ['aOnly', true, false], ['bOnly', false, true], ['neither', false, false]].map(([k, x, y]) =>
      ({ key: k, a: x, b: y, ids: [x ? a : null, y ? b : null].filter(Boolean), team, line: LE.line(w[k]), rest: LE.line(LE.minus(tot, w[k])) }));
  }));
}
function matrixRows(picked) {
  const id = team.id;
  return withRel(memo(cacheKey('matrix', id, picked.join(',')), () => {
    const tot = teamTotal(id);
    return LE.matrix(recsIn(id, bucket()), picked).map(m => ({ key: m.state.join(''), state: m.state, ids: m.on, team, line: LE.line(m.acc), rest: LE.line(LE.minus(tot, m.acc)) }));
  }));
}
/* the team against each kind of opponent five, and against the rest of its minutes */
function bucketRows() {
  const id = team.id;
  return withRel(memo(cacheKey('buckets', id), () => {
    const all = teamAll(id);
    const E = EV.get(id);
    return W.FACED.filter(f => f[0] !== 'all').map(([k, title, sub]) => {
      const acc = LE.sum(LE.inBucket(E ? E.recs || [] : [], k));
      return { key: k, ids: [], title: title.replace(/^vs /, 'Against ').replace(/^Against starters$/, 'Against the starting five'), sub, team, line: LE.line(acc), rest: LE.line(LE.minus(all, acc)) };
    });
  }));
}
/* the team's own line in this view, and what its delta is against: the league's average team for the whole
   season, the team's other minutes against one kind of five */
function teamRow() {
  const id = team.id;
  const tot = teamTotal(id);
  const line = LE.line(tot);
  let rest = null;
  if (bucket() === 'all') {
    const sc = teamScales();
    if (sc.net) { rest = {}; Object.keys(sc).forEach(k => { rest[k] = Math.round(sc[k].mean * 10) / 10; }); }
  } else rest = LE.line(LE.minus(teamAll(id), tot));
  return { line, rest, rel: relOf(line), ids: [] };
}

/* ------------------------------------------------------------------ the scales --- */
function unitsForTeam(id, size) {
  const k = id + ':' + size;
  if (!unitCache.has(k)) unitCache.set(k, L.sized(stintsOfTeam(id), size, 0).map(u => Object.assign(u, { teamId: id, pm: u.pf - u.pa, drb: u.drb })));
  return unitCache.get(k);
}
function referenceUnits(size) {
  if (LG) { let all = []; LG.byTeam.forEach((_, id) => { all = all.concat(unitsForTeam(id, size)); }); return { units: all, source: 'league' }; }
  return { units: unitsForTeam(team.id, size), source: 'team' };
}
function scaleEntry(size) {
  const k = size + ':' + (LG ? 'L' : 'T') + ':' + state.mm + ':' + state.mp + ':' + (LG ? '' : team.id);
  if (!scaleCache.has(k)) {
    const ref = referenceUnits(size);
    const thr = { minMinutes: state.mm, minPoss: state.mp };
    const keys = W.COLS.filter(c => c.src === 'st' && c.dir).map(c => c.key);
    const sc = W.referenceScales(ref.units, keys, thr);
    const n = ref.units.filter(u => W.reliability(u, thr) === 'ok').length;
    scaleCache.set(k, { sc, n, source: ref.source });
  }
  return scaleCache.get(k);
}
const scalesFor = size => scaleEntry(size).sc;
const WORD = { 1: 'single-player', 2: 'two-man', 3: 'three-man', 4: 'four-man', 5: 'five-man' };
function scaleNote(size) {
  const e = scaleEntry(size);
  return (e.source === 'league' ? 'the league’s ' : 'this team’s ') + e.n + ' ' + WORD[size] + ' unit' + (e.n === 1 ? '' : 's') + ' with at least ' + state.mm + ' minutes and ' + state.mp + ' possessions' +
    (e.source === 'team' ? ' (the rest of the league is still loading)' : '');
}
/* the play-by-play stats have no league reference (reading every club's log is not worth a page view): they rank
   among this team's own units of the size, in the same minutes */
function evScales(size) {
  if (preview || state.t === 'all') return {};
  return memo(cacheKey('evsc', team.id, size, state.mm, state.mp), () => {
    const keys = W.COLS.filter(c => c.src === 'ev' && c.dir).map(c => c.key);
    const lines = unitRowsFor(team.id, size).map(r => Object.assign({}, r.line));
    return W.referenceScales(lines, keys, { minMinutes: state.mm, minPoss: state.mp });
  });
}
function teamScales() {
  if (!LG || LG.byTeam.size < 4) return {};
  const k = 'teams:' + state.mm;
  if (!scaleCache.has(k)) {
    const lines = [...LG.byTeam.values()].map(s => LE.line(LE.sum(LE.fromStints(s)))).filter(l => l.mins >= state.mm * 3);
    const sc = {};
    W.COLS.filter(c => c.src === 'st').forEach(c => { sc[c.key] = W.scaleOf(lines.map(l => l[c.key])); });
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

/* the games in order, for the form strips */
let gameOrder = {}, gameLabel = {};
function indexGames() {
  gameOrder = {}; gameLabel = {};
  const d = team && TD.get(team.id);
  if (!d) return;
  d.games.slice().sort((a, b) => String(a.tipoff_at || '').localeCompare(String(b.tipoff_at || ''))).forEach((g, i) => {
    gameOrder[g.id] = i;
    const home = g.home_team_id === team.id;
    const opp = teamsById[home ? g.away_team_id : g.home_team_id];
    const when = g.tipoff_at ? new Date(g.tipoff_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    gameLabel[g.id] = (home ? 'v ' : '@ ') + (opp ? opp.short || opp.name : 'opponent') + (when ? ', ' + when : '');
  });
}

const ctx = {
  get state() { return state; }, get gate() { return gate(); }, get team() { return team; },
  get teamStints() { return team ? stintsOfTeam(team.id) : []; },
  get games() { const d = team && TD.get(team.id); return d ? d.games : []; },
  get thr() { return { minMinutes: state.mm, minPoss: state.mp }; },
  get rowsMax() { return rowsMax; }, set rowsMax(v) { rowsMax = v; },
  get ev() { return team ? evOf(team.id) : evOf(''); },
  get gameOrder() { return gameOrder; },
  gameInfo: id => gameLabel[id] || '',
  evState() {
    if (!gate().events) return 'locked';
    if (state.t === 'all') return 'na';
    const E = team ? EV.get(team.id) : null;
    if (!E || E.status === 'loading' || E.status === 'off') return 'loading';
    return 'ok';
  },
  meta: META, photos: PHOTOS, league: null, teamsById,
  kind, cols: colsFor, setCols, qs,
  rosterIds: () => (team && TD.get(team.id) ? TD.get(team.id).roster : []),
  stintsOfTeam, unitRows, rowFor, playerRows, playerRow, partners, pairRows, matrixRows, bucketRows, teamRow,
  scalesFor, evScales, scaleNote, teamScales, playerScales,
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
  if (preview) state.vs = 'all';
  if ('mm' in patch || 'mp' in patch) { scaleCache.clear(); }
  if ('sz' in patch || 'inc' in patch || 'exc' in patch || 'sort' in patch || 'best' in patch || 't' in patch || 'v' in patch || 'vs' in patch) rowsMax = 25;
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
  indexGames();
  render();
  ensureEvents(team);
  if (!LG && compIds.length) ensureLeague().then(() => { if (token === loadToken) { unitCache.clear(); rowCache.clear(); render(); } });
}

/* ----------------------------------------------------------------- the render --- */
const VIEW_SECTIONS = { overview: ['overview'], lineups: ['lineups'], onoff: ['onoff', 'with'], pair: ['pair'], wowy: ['wowy'], vs: ['vs'], build: ['build'] };
const SECTIONS = ['overview', 'lineups', 'onoff', 'with', 'pair', 'wowy', 'vs', 'build'];
const HOSTS = ['vOverview', 'vLineups', 'vOnoff', 'vPair', 'vWowy', 'vVs', 'vBuild'];
const VIEW_NAMES = [['overview', 'Overview'], ['lineups', 'Lineups'], ['onoff', 'On / off'], ['pair', 'Pairs'], ['wowy', 'WOWY'], ['vs', 'Vs starters'], ['build', 'Builder']];

function drawControls() {
  const c = $('#wctl');
  c.textContent = '';
  const f = el('label', 'fsel');
  f.style.setProperty('--sc', team ? (team.colour || 'var(--ink)') : 'var(--ink)');
  const s = el('select');
  const opts = teams.map(t => [t.slug, t.name]);
  if (state.v === 'lineups') opts.unshift(['all', 'All teams (whole league)']);
  opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (v === state.t) o.selected = true; s.appendChild(o); });
  s.addEventListener('change', () => go({ t: s.value, inc: [], exc: [], p: '', a: '', b: '', u: [], w: [] }));
  f.appendChild(el('span', 'fl', 'Team'));
  const box = el('span', 'fbox'); box.appendChild(s); f.appendChild(box);
  c.appendChild(f);
  const views = UI.seg(VIEW_NAMES.map(([v, t]) => [v, t, false, v === 'wowy' ? 'With or without you: every on/off arrangement of up to five players' : v === 'vs' ? 'Split by who the other side had on' : null]), state.v, v => go({ v }), 'View');
  views.classList.add('wviews');
  if (!gate().events) { const b = views.querySelector('button[data-v="vs"]'); if (b) b.classList.add('wlk-tab'); }
  c.appendChild(views);
  const d = TD.get(team && team.id);
  if (d && state.t !== 'all') c.appendChild(el('span', 'wnote wsum', d.games.length + ' games · ' + d.stints.length + ' stints · ' + d.roster.length + ' players'));
}

let rendering = 0;
function render() {
  if (walled || !team) return;
  const my = ++rendering;
  const d = TD.get(team.id);
  const isAll = state.t === 'all';
  if (preview) state.vs = 'all';
  document.documentElement.style.setProperty('--team-a', (team.colour || '#93f2bf'));
  $('#ctx').textContent = (league ? league.name + ' · ' : '') + (isAll ? 'All teams' : team.name);
  document.title = (isAll ? 'All teams' : team.name) + ' · WOWY / Lineups · Epinoia';
  drawControls();
  const show = VIEW_SECTIONS[state.v] || VIEW_SECTIONS.overview;
  SECTIONS.forEach(id => $('#' + id).classList.toggle('hide', show.indexOf(id) === -1));
  writeAddress();
  if (!d || (!isAll && (!d.games.length || !d.stints.length))) {
    const msg = !d || !d.games.length ? 'No finalised games for this team yet: WOWY fills in once one is played.' : 'No lineup data for this team yet: it fills in as games are finalised.';
    HOSTS.forEach(id => { const n = $('#' + id); n.textContent = ''; n.appendChild(el('div', 'pg-empty', msg)); });
    $('#with').classList.add('hide');
    return;
  }
  try {
    const t0 = performance.now();
    if (state.v === 'overview') UI.overviewView(ctx, $('#vOverview'));
    else if (state.v === 'lineups') {
      if (isAll && !LG) { const n = $('#vLineups'); n.textContent = ''; n.appendChild(el('div', 'pg-empty', 'Loading every team’s stints…')); ensureLeague().then(() => { unitCache.clear(); rowCache.clear(); render(); }); return; }
      UI.lineupsView(ctx, $('#vLineups'));
    } else if (state.v === 'onoff') {
      const pid = UI.onOffView(ctx, $('#vOnoff'));
      drawWith(pid);
    } else if (state.v === 'pair') UI.pairView(ctx, $('#vPair'));
    else if (state.v === 'wowy') UI.wowyView(ctx, $('#vWowy'));
    else if (state.v === 'vs') UI.vsView(ctx, $('#vVs'));
    else if (state.v === 'build') UI.buildView(ctx, $('#vBuild'));
    window.__wowyRenderMs = Math.round(performance.now() - t0);
  } catch (e) { console.error('[wowy] render', e); }
  if (my !== rendering) return;
  fillMissing();
}

/* circles of players this page has not met yet (the All teams list, an opponent), and every photo: after the paint */
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

/* his own box, split by teammates: members only, and only when the On / off view is open. The log the segments
   were read from is reused where this visit read it; a game whose segments came from the session is read again. */
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
    /* the segments' read keeps each log it fetched: wait for it rather than read the same games twice */
    const p = ensureEvents(t); if (p) await p;
    if (t !== team || state.v !== 'onoff') return;
    const d = TD.get(t.id);
    const need = d.games.filter(g => !RAW.has(g.id)).map(g => g.id);
    if (need.length) {
      const evs = await D.events(need);
      need.forEach(id => RAW.set(id, []));
      evs.forEach(e => { const a = RAW.get(e.gameId); if (a) a.push(e); });
    }
    if (t !== team || state.v !== 'onoff') return;
    const recs = window.EpinoiaWith.index(d.games.map(g => ({ starters: g.starters, events: RAW.get(g.id) || [] })));
    const mates = new Set();
    d.stints.forEach(s => { const ids = s.player_ids || []; if (ids.indexOf(pid) !== -1) ids.forEach(id => { if (id !== pid) mates.add(id); }); });
    hostEl.textContent = '';
    window.EpinoiaWithUI.render({ host: hostEl, recs, stints: d.stints, playerId: pid, meta: META, teammates: [...mates] });
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
    if (preview) state.vs = 'all';

    const rows = await D.all('teams?league_id=eq.' + league.id + '&select=id,name,short_name,slug,colour,logo_path&order=name');
    teams = rows.map(decorate); teams.forEach(t => { teamsById[t.id] = t; });
    if (!teams.length) { $('#who').querySelector('.sec-b').appendChild(el('div', 'pg-empty', 'This league has no teams yet.')); return; }
    /* the address may name a team the league has not got: the first one stands in */
    if (state.t !== 'all') { team = teams.find(t => t.slug === state.t) || teams[0]; state.t = team.slug; }
    else team = teams[0];
    watchWidth();
    await applyTeam();
  } catch (e) {
    console.warn('[wowy]', e);
    say('Could not load: ' + (e.message || e));
  }
})();
