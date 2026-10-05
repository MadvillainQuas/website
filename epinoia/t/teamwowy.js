'use strict';
/* ============================================================================
   THE CLUB PAGE'S LINEUPS: the WOWY / Lineups page's own views (stats/wowy/wowyui.js), for one club.
   window.EpinoiaTeamWowy.

   The club page's three lineup sections are drawn by the WOWY page's code, so they read and behave alike and every
   upgrade to that page reaches them too:

     WITH OR WITHOUT   wowyView     up to five players, every on/off arrangement of them, each its own line
     LINEUP FILTER     buildView    up to five players: that unit, every stat, against the rest of the team
     EVERY LINEUP      lineupsView  every unit of two to five as a table or cards: a header sorts (again for the
                                    other way), every stat coloured against the league's units with its on/off delta,
                                    with / without filters, the split by the opponent's five, rows that open

   This file is to the club page what stats/wowy/wowy.js is to the WOWY page, for one team: it keeps the state, sums
   the records and builds the ctx the views read. team.js hands it the games, the stints and who everyone is. It reads
   only what the club page had not already: the league's stints (the colours' reference, once, in the background), the
   league's clubs (who each game was against, for the form strips) and the players' photographs. The play-by-play is
   the page's own read (team.js seasonLogs, already made for the shot chart and the season line), never a second one.

   WHO SEES WHAT (docs/memberships.md). The club page has always shown every five and the lineup filter to everyone,
   and still does. What the WOWY page keeps for members stays members' here: the play-by-play columns and the split by
   the opponent's five wear the site's lock, units of two to four are members', and the combinations take one player
   at a time (CATALOGUE.wowyPreviewMax), as they did.

   STATE. In memory for the visit. How the lists read (cards or table, values, deltas or both) and the sample
   thresholds are kept on the device; the columns are the WOWY page's own choice, shared with it. "Copy link" copies
   the WOWY page's address for exactly what is shown, and "Open in WOWY" / "Open in builder" go to the section here.
   ============================================================================ */
(function (root) {
const W = root.EpinoiaWowyLogic, UI = root.EpinoiaWowyUI, LE = root.EpinoiaLineupEvents, L = root.EpinoiaLineups;
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

/* what the views need of a game: its sides, its starters and periods (the play-by-play's replay), its date (the
   form strips' order) and when it was finalised */
const GAME_SELECT = 'id,home_team_id,away_team_id,starters,period,tipoff_at,finalised_at,competition_id';

/* the reader's way of reading the lists, kept on the device (never needed: a private window reads the defaults) */
const KEEP = 'epinoia.team.lineups';
function kept() {
  try { const v = JSON.parse(localStorage.getItem(KEEP) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}
/* only what the reader changed: a default (cards on a phone) is not a choice to carry to a wider screen */
function keep(s, patch) {
  const changed = ['lay', 'dm', 'mm', 'mp'].filter(k => k in (patch || {}));
  if (!changed.length) return;
  const o = kept();
  changed.forEach(k => { o[k] = s[k]; });
  try { localStorage.setItem(KEEP, JSON.stringify(o)); } catch (_) { /* this visit only */ }
}

/* the state a visit opens on: the WOWY page's defaults, but as a table where there is the room for one (the
   section always was one; on a phone the five names take half the width, so cards there), and the reader's own
   reading where they chose one before */
function initialState(slug, saved, phone) {
  const s = Object.assign({}, W.DEFAULT_STATE, { u: [], inc: [], exc: [], w: [] }, { t: slug || '', v: 'lineups', lay: phone ? 'cards' : 'table' });
  const k = saved || {};
  if (W.LAYOUTS.indexOf(k.lay) !== -1) s.lay = k.lay;
  if (W.DMODES.indexOf(k.dm) !== -1) s.dm = k.dm;
  const t = W.normThr(k.mm, k.mp);
  s.mm = t.minMinutes; s.mp = t.minPoss;
  return s;
}

/* WHO SEES WHAT: the WOWY page's gate for the combinations; for the list and the filter, the club page's own rule
   (every five and the filter for everyone), the rest of the gate as the WOWY page has it */
function gates(locked, previewMax) {
  const strict = W.gate(!!locked, previewMax || 1);
  const open = locked ? Object.assign({}, strict, { preview: false, rows: Infinity, players: 5, builder: true }) : strict;
  /* the lineup filter is open to all, a locked reader picks up to three players in it (wowyui.js buildView reads pickMax) */
  return { wowy: strict, build: Object.assign({}, open, { pickMax: locked ? 3 : 5 }), lineups: open };
}

/* which sections a change touches: a pick is its own section's; how a list reads and the thresholds are everyone's */
const OWN = { w: 'wowy', u: 'build', sz: 'lineups', inc: 'lineups', exc: 'lineups', sort: 'lineups', dir: 'lineups', best: 'lineups' };
const SECTIONS = ['wowy', 'build', 'lineups'];
function touched(patch) {
  const out = new Set();
  Object.keys(patch || {}).forEach(k => { if (OWN[k]) out.add(OWN[k]); else SECTIONS.forEach(s => out.add(s)); });
  return SECTIONS.filter(s => out.has(s));
}

function rosterOf(stints) {
  const mins = new Map();
  stints.forEach(s => (s.player_ids || []).forEach(id => mins.set(id, (mins.get(id) || 0) + ((s.stats && s.stats.dur) || 0))));
  return [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

/* o: { team, league: { id, slug, name }, games (GAME_SELECT rows), stints, meta, locked, previewMax,
        hosts: { wowy, build, lineups }, compIds (the season's competitions, or null), season (the ?s= to carry),
        base (the site's root from this page, '../'), readLogs() -> { gs, byG, sideOf }, segCache (Map) } */
function mount(o) {
  const D = root.EpinoiaData;
  const hosts = o.hosts || {};
  const t0 = o.team || {};
  const logo = root.epinoiaLogoUrl && t0.logo_path ? root.epinoiaLogoUrl(t0.logo_path, 64) : null;
  const team = { id: t0.id, name: t0.name, short: t0.short_name || '', slug: t0.slug || '', colour: t0.colour, logo_path: t0.logo_path, logoUrl: logo || null };
  const league = o.league || {};
  const games = o.games || [], stints = o.stints || [];
  const roster = rosterOf(stints);
  const META = o.meta || {}, PHOTOS = {};
  const teamsById = {};
  const host = () => hosts.lineups || hosts.build || hosts.wowy;
  const kind = () => W.sizeKind((host() && host().clientWidth) || 800);
  const state = initialState(team.slug, kept(), kind() === 'phone');
  const G = gates(o.locked, o.previewMax);
  let rowsMax = 25, evVersion = 0, LG = null, LGp = null;
  const rowCache = new Map(), scaleCache = new Map(), unitCache = new Map();
  const EV = { status: o.locked ? 'locked' : 'off', done: 0, total: 0, covered: 0, oppCovered: 0, recs: null };

  /* --------------------------------------------------------------- the records ---
     The WOWY page's sums, for this one club: the play-by-play's segments for the games it could read and the stints
     for any it could not, so the minutes are always the whole season; against one kind of opponent five, only the
     segments that know who the opponent had on. */
  /* the club's own minutes are always the stints this page read; the league's are only the colours' reference */
  const stintsOfTeam = () => stints;
  function recsAll() {
    if (EV.status !== 'ready' || o.locked) return LE.fromStints(stintsOfTeam());
    const covered = new Set(EV.recs.map(r => r.g));
    return EV.recs.concat(LE.fromStints(stintsOfTeam().filter(s => !covered.has(s.game_id))));
  }
  const bucket = () => (o.locked ? 'all' : state.vs);
  function recsIn(b) {
    if (!b || b === 'all') return recsAll();
    return EV.status === 'ready' ? LE.inBucket(EV.recs, b) : [];
  }
  const cacheKey = (...p) => p.concat(bucket(), evVersion).join('|');
  function memo(key, fn) { if (!rowCache.has(key)) rowCache.set(key, fn()); return rowCache.get(key); }
  const relOf = line => W.reliability(line, { minMinutes: state.mm, minPoss: state.mp });
  const withRel = rows => rows.map(r => Object.assign(r, { rel: relOf(r.line) }));

  const teamTotal = () => memo(cacheKey('tot'), () => LE.sum(recsIn(bucket())));
  function unitRows(size) {
    return withRel(memo(cacheKey('units', size), () => {
      const tot = teamTotal();
      return LE.units(recsIn(bucket()), size).map(u => ({ key: u.ids.join(','), ids: u.ids, teamId: team.id, team, line: LE.line(u.acc), rest: LE.line(LE.minus(tot, u.acc)) }));
    }));
  }
  function rowFor(ids) {
    return withRel([memo(cacheKey('row', ids.slice().sort().join(',')), () => {
      const acc = LE.sum(recsIn(bucket()), r => ids.every(p => r.ids.indexOf(p) !== -1));
      return { key: ids.join(','), ids: ids.slice(), team, line: LE.line(acc), rest: LE.line(LE.minus(teamTotal(), acc)) };
    })])[0];
  }
  function matrixRows(picked) {
    return withRel(memo(cacheKey('matrix', picked.join(',')), () => {
      const tot = teamTotal();
      return LE.matrix(recsIn(bucket()), picked).map(m => ({ key: m.state.join(''), state: m.state, ids: m.on, team, line: LE.line(m.acc), rest: LE.line(LE.minus(tot, m.acc)) }));
    }));
  }

  /* ---------------------------------------------------------------- the scales ---
     The colours: the league's units of the size once the league's stints are in, this club's own until then (the
     legend says which); the play-by-play stats against this club's own units, as on the WOWY page. */
  function unitsForTeam(id, size) {
    const k = id + ':' + size;
    if (!unitCache.has(k)) {
      const s = id === team.id ? stintsOfTeam() : (LG && LG.byTeam.get(id)) || [];
      unitCache.set(k, L.sized(s, size, 0).map(u => Object.assign(u, { teamId: id, pm: u.pf - u.pa })));
    }
    return unitCache.get(k);
  }
  function scaleEntry(size) {
    const k = size + ':' + (LG ? 'L' : 'T') + ':' + state.mm + ':' + state.mp;
    if (!scaleCache.has(k)) {
      let units = [];
      if (LG) LG.byTeam.forEach((_, id) => { units = units.concat(unitsForTeam(id, size)); });
      else units = unitsForTeam(team.id, size);
      const thr = { minMinutes: state.mm, minPoss: state.mp };
      const keys = W.COLS.filter(c => c.src === 'st' && c.dir).map(c => c.key);
      scaleCache.set(k, { sc: W.referenceScales(units, keys, thr), n: units.filter(u => W.reliability(u, thr) === 'ok').length, source: LG ? 'league' : 'team' });
    }
    return scaleCache.get(k);
  }
  const WORD = { 1: 'single-player', 2: 'two-man', 3: 'three-man', 4: 'four-man', 5: 'five-man' };
  function scaleNote(size) {
    const e = scaleEntry(size);
    return (e.source === 'league' ? 'the league’s ' : 'this team’s ') + e.n + ' ' + WORD[size] + ' unit' + (e.n === 1 ? '' : 's') + ' with at least ' + state.mm + ' minutes and ' + state.mp + ' possessions' +
      (e.source === 'team' ? ' (the rest of the league is still loading)' : '');
  }
  function evScales(size) {
    if (o.locked) return {};
    return memo(cacheKey('evsc', size, state.mm, state.mp), () => {
      const keys = W.COLS.filter(c => c.src === 'ev' && c.dir).map(c => c.key);
      return W.referenceScales(unitRows(size).map(r => Object.assign({}, r.line)), keys, { minMinutes: state.mm, minPoss: state.mp });
    });
  }

  /* --------------------------------------------------------- the league, behind ---
     Every club's stints in this season's competitions: the reference every colour is measured against. Asked once
     the sections are drawn, never waited for. */
  function ensureLeague() {
    if (LGp) return LGp;
    const comps = (o.compIds && o.compIds.length ? o.compIds : [...new Set(games.map(g => g.competition_id).filter(Boolean))]);
    if (!comps.length || !D) return (LGp = Promise.resolve(null));
    LGp = (async () => {
      const gs = await D.all('games?competition_id=in.(' + comps.join(',') + ')&status=eq.final&select=' + GAME_SELECT);
      const byId = new Map(); gs.forEach(g => byId.set(g.id, g));
      const raw = await D.stints(gs.map(g => g.id));
      const byTeam = new Map();
      raw.forEach(r => {
        const g = byId.get(r.game_id); if (!g) return;
        const tid = r.team_idx === 0 ? g.home_team_id : g.away_team_id;
        if (!byTeam.has(tid)) byTeam.set(tid, []);
        byTeam.get(tid).push(r);
      });
      byTeam.set(team.id, stints);   // the club's own, as the page read them
      LG = { byTeam, games: byId };
      unitCache.clear(); scaleCache.clear(); rowCache.clear();
      draw();
      return LG;
    })().catch(e => { console.warn('[lineups] league', e); return null; });
    return LGp;
  }

  /* ------------------------------------------------------- the play-by-play ---
     The page's own read of the club's logs (team.js seasonLogs), each game replayed into the stretches in which
     neither five changed (lineupevents.js), kept in the page's cache with the season line's. Members only: a preview
     never replays a log. */
  function progress() {
    SECTIONS.forEach(v => { const h = hosts[v]; if (h) h.querySelectorAll('.wfaced-n').forEach(n => { n.textContent = 'Reading play-by-play… ' + EV.done + '/' + EV.total + ' games'; }); });
  }
  async function ensureEvents() {
    if (o.locked || EV.status !== 'off') return;
    /* a page with no log to read says so (the stint numbers stand), rather than "reading…" for ever */
    if (!LE || typeof o.readLogs !== 'function') { EV.status = 'error'; return; }
    EV.status = 'loading';
    try {
      const logs = await o.readLogs();
      const own = new Set(games.map(g => g.id));
      const gs = (logs.gs || []).filter(g => own.has(g.id));
      EV.total = gs.length;
      const cache = o.segCache || new Map();
      const recs = [];
      for (const g of gs) {
        let S = cache.get(g.id);
        if (!S) {
          try { S = LE.gameSegments({ id: g.id, starters: g.starters, events: (logs.byG || {})[g.id] || [], period: g.period }); } catch (_) { S = { ok: false }; }
          cache.set(g.id, S);
          await new Promise(r => setTimeout(r, 0));   // the page keeps answering between games
        }
        EV.done++;
        progress();
        if (!S || !S.ok) continue;
        EV.covered++;
        const r = LE.recordsOf(S, g.home_team_id === team.id ? 0 : 1);
        if (r.some(x => x.ost != null)) EV.oppCovered++;
        r.forEach(x => recs.push(x));
      }
      EV.recs = recs;
      EV.status = EV.covered ? 'ready' : 'error';
    } catch (e) {
      console.warn('[lineups] events', e);
      EV.status = 'error';
    }
    evVersion++; rowCache.clear();
    draw();
  }

  /* --------------------------------------------------------------- the photos --- */
  async function photosFor(ids) {
    const need = ids.filter(id => id != null && !(id in PHOTOS) && /^[0-9a-f-]{36}$/i.test(String(id)));
    if (!need.length || !D) return;
    need.forEach(id => { PHOTOS[id] = null; });
    const cfg = root.EPINOIA_CONFIG || {};
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
    SECTIONS.forEach(v => { if (hosts[v]) UI.hydrate(base, hosts[v]); });
  }

  /* the games in order, and who each was against, for the form strips */
  const gameOrder = {}, gameLabel = {};
  function indexGames() {
    games.slice().sort((a, b) => String(a.tipoff_at || '').localeCompare(String(b.tipoff_at || ''))).forEach((g, i) => {
      gameOrder[g.id] = i;
      const home = g.home_team_id === team.id;
      const opp = teamsById[home ? g.away_team_id : g.home_team_id];
      const when = g.tipoff_at ? new Date(g.tipoff_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
      gameLabel[g.id] = (home ? 'v ' : '@ ') + (opp ? opp.teamShort || opp.name : 'opponent') + (when ? ', ' + when : '');
    });
  }

  /* ------------------------------------------------------------ the address --- */
  const wowyQuery = patch => W.encodeState(Object.assign({}, state, { t: team.slug }, patch || {}),
    '?l=' + encodeURIComponent(league.slug || '') + (o.season ? '&s=' + encodeURIComponent(o.season) : ''));
  const wowyHref = patch => (o.base || '../') + 'stats/wowy/' + wowyQuery(patch);
  function say(view, msg) {
    const h = hosts[view]; const n = h && h.querySelector('.tlu-say');
    if (n) n.textContent = msg || '';
  }
  async function copyLink(view, patch) {
    const u = new URL(wowyHref(Object.assign({ v: view === 'lineups' ? 'lineups' : view === 'build' ? 'build' : 'wowy' }, patch || {})), location.href).href;
    try { await navigator.clipboard.writeText(u); say(view, 'Link copied: it opens this exact view on the WOWY / Lineups page.'); }
    catch (_) { say(view, u); }
    setTimeout(() => say(view, ''), 6000);
  }

  /* -------------------------------------------------------------- the actions --- */
  function go(patch) {
    const p = Object.assign({}, patch || {});
    /* a view inside a view: the combinations and the builder are sections of this page; anything else is the
       WOWY page's (On / off, Pairs, Vs starters) */
    if (p.v) {
      const v = p.v; delete p.v;
      if (v === 'build' || v === 'wowy') {
        Object.assign(state, p);
        draw([v]);
        const h = hosts[v];
        if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (v !== 'lineups') { location.href = wowyHref(Object.assign({ v }, p)); return; }
    }
    Object.assign(state, p);
    if (o.locked) state.vs = 'all';
    if ('mm' in p || 'mp' in p) scaleCache.clear();
    if (['sz', 'inc', 'exc', 'sort', 'best', 'vs'].some(k => k in p)) rowsMax = 25;
    keep(state, p);
    draw(touched(p));
  }

  /* the columns are the WOWY page's own choice, under its keys: picked there or here, the same on both */
  const colKey = (view, k) => 'epinoia.wowy.cols2.' + view + '.' + k;
  function cols(view) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(colKey(view, kind())) || 'null'); } catch (_) { /* the default */ }
    return W.pickColumns(saved, kind());
  }
  function setCols(view, keys) {
    try { if (keys) localStorage.setItem(colKey(view, kind()), JSON.stringify(keys)); else localStorage.removeItem(colKey(view, kind())); } catch (_) { /* per-viewer only */ }
  }

  /* --------------------------------------------------------------------- ctx ---
     What the views read. Each section has its own (it inherits this one): its gate, and what "Copy link" copies. */
  const base = {
    get state() { return state; }, get team() { return team; },
    get teamStints() { return stintsOfTeam(); }, get games() { return games; },
    get thr() { return { minMinutes: state.mm, minPoss: state.mp }; },
    get rowsMax() { return rowsMax; }, set rowsMax(v) { rowsMax = v; },
    get ev() { return EV; },
    get gameOrder() { return gameOrder; },
    gameInfo: id => gameLabel[id] || '',
    evState() {
      if (o.locked) return 'locked';
      if (EV.status === 'loading' || EV.status === 'off') return 'loading';
      return 'ok';
    },
    meta: META, photos: PHOTOS, league: { id: league.id, slug: league.slug, name: league.name }, teamsById,
    kind, cols, setCols, qs: wowyQuery,
    playerHref: id => (o.base || '../') + 'p/?p=' + encodeURIComponent(id),
    rosterIds: () => roster,
    stintsOfTeam, unitRows, rowFor, matrixRows,
    scalesFor: size => scaleEntry(size).sc, evScales, scaleNote,
    teamScales: () => ({}),
    go(patch) { go(patch); },
    redraw() { draw(); }
  };
  const ctxs = {};
  SECTIONS.forEach(v => {
    ctxs[v] = Object.create(base, {
      gate: { get: () => G[v] },
      link: { value: patch => { copyLink(v, patch); } }
    });
  });

  /* ------------------------------------------------------------------- the draw --- */
  const VIEW = { wowy: UI.wowyView, build: UI.buildView, lineups: UI.lineupsView };
  function draw(which) {
    (which || SECTIONS).forEach(v => {
      const h = hosts[v];
      if (!h) return;
      try { VIEW[v](ctxs[v], h); }
      catch (e) { console.error('[lineups] ' + v, e); h.textContent = ''; h.appendChild(el('div', 'pg-empty', 'Could not draw this section: ' + (e.message || e))); return; }
      /* the line "Copy link" answers on, and the way to the rest of it on the WOWY page */
      const foot = el('div', 'tlu-foot');
      const s = el('p', 'wnote tlu-say'); s.setAttribute('role', 'status');
      const a = el('a', 'tlu-more', v === 'wowy' ? 'On / off, pairs and vs starters on the WOWY page →' : 'This on the WOWY / Lineups page →');
      a.href = wowyHref({ v: v === 'build' ? 'build' : v === 'wowy' ? 'wowy' : 'lineups' });
      foot.append(s, a);
      h.appendChild(foot);
    });
    photosFor(roster);
  }

  /* the width decides what a table holds (a phone, a middling column, a wide one): draw again when its class changes */
  let lastKind = kind();
  if (typeof ResizeObserver === 'function' && host()) {
    new ResizeObserver(() => { const k = kind(); if (k !== lastKind) { lastKind = k; draw(); } }).observe(host());
  }

  indexGames();
  ensureEvents();            // first, so the first draw already knows whether the log is being read
  draw();
  ensureLeague();
  if (D && typeof D.teamMeta === 'function' && league.id) {
    D.teamMeta(league.id).then(m => { Object.assign(teamsById, m || {}); indexGames(); }).catch(() => { /* "opponent" */ });
  }
  return { ctx: base, state, draw, go };
}

root.EpinoiaTeamWowy = { mount, GAME_SELECT, initialState, gates, touched, KEEP };
})(typeof window !== 'undefined' ? window : globalThis);
