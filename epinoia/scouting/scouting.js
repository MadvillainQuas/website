'use strict';
/* ============================================================================
   GLOBAL SCOUTING — the leagues a scout chooses, in one table.

   SET UP FIRST (setup.js). The page opens on a set-up drawn from global.js
   catalogue() alone (the leagues, what the viewer may see, their seasons): which
   leagues, which seasons, men's or women's, and the players' ranges. Nothing
   heavy is read until LOAD, and then only those leagues, CONCURRENCY at a time,
   each season read going through data.js's own caches. ?go=1 in the address
   (a shared link) loads at once.

   The Statistics page's table (fulltable.js) over the rows global.js merges
   from every league the viewer may see, with the cross-league options switched
   on: a LEAGUE column and select, percentiles within each league, the stat
   filters drawer, a compare tray, fifty rows at a time. Nothing is drawn here
   that the table already draws; this page loads, keeps the URL and opens the
   comparison.

   DRAWN AS LEAGUES ARRIVE. global.js runs every league's season read at once
   and hands each over as it lands, so the first league's rows are on screen
   while the slower ones are still being read (roadmap Phase 5: first league
   within 3 s on a phone). The table is drawn once, on the first rows, and
   handed the growing set after that -- setRows keeps the sort, the filters,
   the picks and the rows shown.

   THE URL IS THE STATE. Sort, direction, preset, search, stat filters, league,
   club, within-league, qualified and pages shown are written with replaceState
   (never a history entry per keystroke) and read back on load, so a filtered
   view can be shared or survive a reload. Only values that differ from the
   defaults are written; parameters this page does not own (?source=pwa) stay.

   THE LOCKS ARE THE PAGE'S. A premium column is locked for everybody here if
   any included league locks it (global.js lockedColumns): hiding only one
   league's cells would still print its order through a sort. Locked columns
   are left out of the table's pickers and out of the comparison's stats.

   UMD like data.js: in the browser it boots itself; node requires the pure
   parts (URL state, the table's options, the comparison's input) for
   supabase/tests/scouting-page.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.EpinoiaScouting = api;
    if (root.document) api.boot();
  }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const fin = v => typeof v === 'number' && isFinite(v);
const RAPM_KEYS = new Set(['rapm', 'orapm', 'drapm']);
/* the comparison's stat chips offer the visible preset's stats plus these, so a scout on the
   shooting preset can still add rebounds without closing the chart */
const CORE_STATS = ['ppg', 'rpg', 'apg', 'spg', 'bpg', 'topg', 'ts', 'efg', 'p3_pct', 'usg', 'ast_pct', 'blk_pct', 'bpm'];
const MAX_COMPARE_STATS = 8;
/* playing time, fouls and turnovers: offered as chips, never chosen ahead of a real stat */
const DEMOTED = new Set(['mpg', 'min', 'pfpg', 'pf', 'topg', 'tov']);
const PAGE_SIZE = 50;

/* ------------------------------------------------------------ URL state ---
   The table's state object, in and out of a query string. Short parameter names, because
   the URL is shared in chats; the defaults are the table's own, so an untouched page has
   a clean URL. */
const DEFAULTS = Object.freeze({
  sort: 'ppg', dir: -1, preset: 'basic', search: '', filters: [], league: '', team: '',
  withinLeague: true, page: 1, qualified: true
});
const PARAM = { sort: 's', dir: 'dir', preset: 'view', search: 'q', filters: 'f', league: 'lg',
  team: 'tm', withinLeague: 'wl', page: 'pg', qualified: 'ql' };
const OWNED = Object.keys(PARAM).map(k => PARAM[k]);

/* WHOSE GAME. Not part of the table's state — it decides which leagues' rows
   are on the page at all, which is this page's business rather than
   fulltable's — so it rides in its own parameter and writeState leaves it
   alone (it only clears the ones it owns). */
const WHO = ['men', 'women'];
const WHO_PARAM = 'g';
function readWho(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const v = (p.get(WHO_PARAM) || '').toLowerCase();
  return WHO.indexOf(v) >= 0 ? v : '';
}

/* a stat filter line is key:op:mode:x, lines joined by commas (keys never hold either) */
function encodeFilters(list) {
  return (Array.isArray(list) ? list : [])
    .filter(f => f && typeof f.k === 'string' && /^[\w-]+$/.test(f.k) && fin(Number(f.x)) && f.x !== null && f.x !== '')
    .map(f => [f.k, f.op === 'le' ? 'le' : 'ge', f.mode === 'pct' ? 'pct' : 'val', String(Number(f.x))].join(':'))
    .join(',');
}
function decodeFilters(s) {
  if (!s) return [];
  return String(s).split(',').map(part => {
    const [k, op, mode, x] = part.split(':');
    const n = Number(x);
    if (!k || !/^[\w-]+$/.test(k) || (op !== 'ge' && op !== 'le') || (mode !== 'val' && mode !== 'pct') ||
        x == null || x === '' || !fin(n)) return null;
    return { k, op, mode, x: n };
  }).filter(Boolean).slice(0, 12);
}

/* query string (or URLSearchParams) -> a full state object for EpinoiaTable.render */
function readState(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const st = Object.assign({}, DEFAULTS, { filters: [] });
  const g = k => p.get(PARAM[k]);
  const clean = (v, max) => String(v).slice(0, max);
  if (g('sort') && /^[\w-]+$/.test(g('sort'))) st.sort = clean(g('sort'), 40);
  if (g('dir') === '1' || g('dir') === 'asc') st.dir = 1;
  if (g('preset') && /^[\w*-]+$/.test(g('preset'))) st.preset = clean(g('preset'), 40);
  if (g('search') != null) st.search = clean(g('search'), 80);
  st.filters = decodeFilters(g('filters'));
  if (g('league')) st.league = clean(g('league'), 80);
  if (g('team')) st.team = clean(g('team'), 80);
  if (g('withinLeague') === '0') st.withinLeague = false;
  const pg = parseInt(g('page'), 10);
  if (pg > 1) st.page = Math.min(pg, 200);
  if (g('qualified') === '0') st.qualified = false;
  return st;
}

/* a state object -> the query string, keeping every parameter this page does not own */
function writeState(state, search) {
  const p = new URLSearchParams(search || '');
  OWNED.forEach(k => p.delete(k));
  const s = Object.assign({}, DEFAULTS, state || {});
  if (s.sort && s.sort !== DEFAULTS.sort) p.set(PARAM.sort, s.sort);
  if (s.dir === 1) p.set(PARAM.dir, '1');
  if (s.preset && s.preset !== DEFAULTS.preset) p.set(PARAM.preset, s.preset);
  if (s.search && String(s.search).trim()) p.set(PARAM.search, String(s.search).trim());
  const f = encodeFilters(s.filters);
  if (f) p.set(PARAM.filters, f);
  if (s.league) p.set(PARAM.league, String(s.league));
  if (s.team) p.set(PARAM.team, String(s.team));
  if (s.withinLeague === false) p.set(PARAM.withinLeague, '0');
  if (Number(s.page) > 1) p.set(PARAM.page, String(Math.floor(Number(s.page))));
  if (s.qualified === false) p.set(PARAM.qualified, '0');
  /* commas left as commas: the set-up's lists and the filter lines read the same either way */
  const out = p.toString().replace(/%2C/g, ',');
  return out ? '?' + out : '';
}

/* ------------------------------------------------------ the table's options ---
   Everything this page asks of fulltable.js, in one place the test can read. */
function tableOptions(o) {
  return {
    host: o.host,
    kind: 'player',
    rows: o.rows || [],
    sortKey: 'ppg',
    minGames: 1,
    /* fifty at every width, with "show more": the top fifty by whatever is sorted */
    pageSize: PAGE_SIZE,
    filename: 'epinoia-global-scouting',
    leagueColumn: true,
    leagueSelect: true,
    rankWithinLeague: true,
    searchLeagues: true,
    /* players in different leagues never shared a floor, so there is no RAPM to ask for */
    noRapm: true,
    filters: true,
    selectable: { max: 5 },
    locked: o.locked,
    state: o.state,
    onState: o.onState,
    onCompare: o.onCompare,
    /* the player page is keyed by the player, not by the league-scoped row id */
    playerHref: r => '../p/?p=' + encodeURIComponent(r.playerId != null ? r.playerId : r.id)
  };
}

/* ---------------------------------------------------- the comparison's input ---
   picks: the table's selected rows; statKeys: the visible preset's stat columns; cols: the
   table's PLAYER_COLS; ranks: getRanks' Map<key, Map<rowId, pct>> over the pool;
   locked(k): the page lock. Returns the object EpinoiaCompare.render/open take. */
function compareStats(statKeys, cols, locked) {
  const byKey = new Map((cols || []).map(c => [c.k, c]));
  const usable = k => { const c = byKey.get(k);
    return !!(c && c.heat && !RAPM_KEYS.has(k) && !(locked && locked(k))); };
  const uniq = list => list.filter((k, i) => list.indexOf(k) === i);
  /* THE EIGHT DEFAULTS ARE WHAT A SCOUT COMPARES ON. Playing time says how much, not how good,
     and fouls and turnovers only count events: on the per-game preset they took three of the
     eight bars (MPG, TOPG, PFPG) while real stats were cut. So the preset's other stats come
     first and these go behind them; the chart still draws the preset on screen (the core
     stats only stand in when the preset has nothing else to draw). Every one stays a chip. */
  const minor = k => DEMOTED.has(k);
  const preset = uniq((statKeys || []).filter(usable));
  const major = preset.filter(k => !minor(k));
  const keys = (major.length ? major.concat(preset.filter(minor))
    : CORE_STATS.filter(k => usable(k) && !minor(k)).concat(preset))
    .filter((k, i, a) => a.indexOf(k) === i)
    .slice(0, MAX_COMPARE_STATS);
  const pool = uniq((statKeys || []).concat(CORE_STATS)).filter(usable);
  /* AND EVERY OTHER COMPARABLE COLUMN. The chips are the preset and the core stats; the
     category dropdowns beside them reach the rest of the table, so anything one of them can
     choose must arrive with a value and a percentile or its bar would read "no data". */
  const every = (cols || []).map(c => c.k).filter(usable);
  return { keys, pool, every, byKey };
}

function statOf(c) {
  const k = c.k;
  const out = {
    key: k, label: c.l || k,
    fmt: v => {
      if (!fin(v)) return '—';
      const probe = {}; probe[k] = v;
      const s = c.fmt ? c.fmt(probe, 0) : String(v);
      return s == null || s === '' ? String(Math.round(v * 10) / 10) : String(s);
    }
  };
  if (c.signed) out.signed = true;
  return out;
}

function compareInput(picks, statKeys, cols, ranks, opt) {
  const o = opt || {};
  const S = compareStats(statKeys, cols, o.locked);
  const rows = (picks || []).slice(0, 5);
  const values = {}, pcts = {};
  rows.forEach(r => {
    const id = String(r.id);
    values[id] = {}; pcts[id] = {};
    S.every.forEach(k => {
      values[id][k] = fin(r[k]) ? r[k] : null;
      const m = ranks && ranks.get ? ranks.get(k) : null;
      const p = m && m.get ? (m.has(r.id) ? m.get(r.id) : m.get(id)) : null;
      pcts[id][k] = fin(p) ? p : null;
    });
  });
  return {
    title: 'Compare ' + rows.length + ' players',
    players: rows.map(r => ({ id: String(r.id), name: r.name || 'Player', league: r.leagueShort || r.leagueName || '' })),
    stats: S.keys.map(k => statOf(S.byKey.get(k))),
    allStats: S.pool.map(k => statOf(S.byKey.get(k))),
    /* the table's categories, each a dropdown of its own stats — built by the caller from
       EpinoiaCompare.tableGroups, because that is the same list a league's own table offers */
    statGroups: o.statGroups || [],
    values, pcts,
    mode: 'pct',
    note: o.withinLeague === false
      ? 'Percentiles across every league on this page, among the players the table covers before stat filters and search.'
      : 'Percentiles within each player’s own league, among the players the table covers before stat filters and search.'
  };
}

/* ---------------------------------------------------------- progress line --- */
function progressText(leagues, done) {
  const names = (leagues || []).map(L => L.short || L.name).filter(Boolean);
  if (!names.length) return done ? '' : 'Loading leagues…';
  return names.join(' · ') + (done ? '' : ' · …');
}
function excludedText(excluded) {
  const n = (excluded || []).length;
  if (!n) return '';
  return n + ' members-only league' + (n === 1 ? '' : 's') + ' not included';
}

/* ---------------------------------------------------------- the progress ---
   'loading 3 of 12 leagues…', then what came of it. Pure, for the test. */
function loadingText(got, total, state) {
  const t = Math.max(0, total | 0), g = Math.min(t, Math.max(0, got | 0));
  const unit = t === 1 ? 'league' : 'leagues';
  if (state === 'stopped') return 'Stopped: ' + g + ' of ' + t + ' ' + unit + ' loaded';
  if (state === 'done') return t + ' ' + unit + ' loaded';
  return 'Loading ' + g + ' of ' + t + ' ' + unit + '…';
}

/* how many leagues are read at once: enough to keep the line busy, few enough that the first
   league lands quickly and a phone's connection is not asked for twelve season files at once */
const CONCURRENCY = 4;

/* ------------------------------------------------------------------- boot ---
   THE PAGE OPENS ON THE SET-UP (setup.js), drawn from the light read alone, and loads
   nothing heavy until LOAD — or at once, when the address says so (?go=1 with leagues, a
   shared link, or an older link to one league's rows). */
function boot() {
  const doc = root.document;
  const $ = s => doc.querySelector(s);
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c;
    if (x != null) n.textContent = x; return n; };
  const host = $('#tbl'), status = $('#status'), panel = $('#cmpPanel');
  if (!host) return;

  const G = root.EpinoiaGlobal, T = root.EpinoiaTable, A = root.EpinoiaAccess, C = root.EpinoiaCompare;
  const SU = root.EpinoiaScoutSetup || null, Ages = root.EpinoiaAges || null;
  const results = $('#results'), summary = $('#scSummary'), prog = $('#scProg');

  function stateBox(msg, retry, act) {
    host.textContent = '';
    const box = el('div', 'sc-state');
    box.appendChild(el('div', '', msg));
    if (act) {
      const b = el('button', 'ep-btn pri', act.label);
      b.type = 'button';
      b.addEventListener('click', act.run);
      box.appendChild(b);
    }
    if (retry) {
      const b = el('button', 'ep-btn ft-btn', 'try again');
      b.type = 'button';
      b.addEventListener('click', () => root.location.reload());
      box.appendChild(b);
    }
    host.appendChild(box);
  }
  if (!G || !T || !root.EpinoiaData) { stateBox('Could not load the scouting table. Check your connection.', true); return; }
  const D = root.EpinoiaData;

  /* ---- the set-up: the address first, then this browser's copy (per account) ---- */
  const store = (() => { try { return root.localStorage || null; } catch (_) { return null; } })();
  const cfg = root.EPINOIA_CONFIG || {};
  const key = SU ? SU.storeKey(SU.userId(store, cfg.supabaseUrl)) : '';
  const fromUrl = SU ? SU.readSetup(root.location.search) : { setup: null, go: false, has: false };
  let current = null;                      // the set-up the table on screen was loaded with
  let initial = null;
  if (SU) {
    const kept = SU.loadStored(store, key);
    if (fromUrl.setup.leagues.length) initial = fromUrl.setup;
    else {
      initial = kept || SU.cleanSetup({});
      /* an address with only the gender (?g=women, an older link) keeps it over this browser's */
      const p = new URLSearchParams(root.location.search);
      if (p.has('g')) initial = SU.cleanSetup(Object.assign({}, initial, { g: fromUrl.setup.g }));
    }
  }

  /* THE LIGHT READ, AT ONCE: the leagues, what this viewer may see, their seasons */
  const catP = typeof G.catalogue === 'function' ? G.catalogue() : Promise.resolve(null);
  catP.catch(() => {});
  /* the clubs per league, for the size estimate: one short read, after the catalogue */
  /* COUNTED BY THE DATABASE (PostgREST's embedded count): one row a league, not one a club - NCAA D2/D3
     alone adds ~1,460 clubs, and every club's row was paged through to be counted here */
  const teamP = catP.then(() => (typeof D.get === 'function' ? D.get('leagues?select=id,teams(count)') : []))
    .then(ls => { const m = {}; (ls || []).forEach(l => { const n = l && Array.isArray(l.teams) && l.teams[0] ? +l.teams[0].count : 0; if (l && l.id && n) m[l.id] = n; }); return m; })
    .catch(() => ({}));
  /* the leagues this reader follows, when signed in (fan_prefs: one small read) */
  const F = root.EpinoiaFollow;
  const followP = (F && typeof F.session === 'function' && F.session() && typeof F.load === 'function')
    ? Promise.resolve(F.load()).then(p => (p && p.fav_league_ids) || []).catch(() => []) : Promise.resolve([]);

  const writeUrl = q => {
    try { root.history.replaceState(root.history.state, '', root.location.pathname + q + root.location.hash); }
    catch (_) { /* a sandboxed frame: the page works, the address does not follow */ }
  };
  const ui = SU ? SU.mount({
    initial, catalogue: catP, teamCount: teamP, follows: followP,
    onChange: s => { SU.saveStored(store, key, s); },
    onLoad: s => start(s)
  }) : null;
  const editBtn = $('#scEdit');
  if (editBtn) editBtn.addEventListener('click', () => {
    if (!ui) return;
    ui.set(current || ui.get());
    ui.open();
    /* the address loses go=1 while the set-up is open: a reload now lands on the set-up */
    if (current) writeUrl(SU.writeSetup(current, root.location.search, { go: false }));
    const sec = $('#setup');
    try { sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { /* old engines */ }
    const first = sec && sec.querySelector('#suWho button[aria-pressed="true"]');
    if (first) try { first.focus({ preventScroll: true }); } catch (_) { /* focus is a nicety */ }
  });
  const reduced = () => { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

  /* ---- the status line ---- */
  let arrived = [];                      // leagues in the order they landed
  let byLeague = new Map();              // league id -> rows kept by the set-up
  let rawCount = new Map();              // league id -> rows read, before the set-up's filters
  let excluded = [], failed = [], done = false, total = 0, stopped = false;
  function paintStatus() {
    if (!status) return;
    status.textContent = '';
    const line = el('div', 'sc-leagues');
    if (!arrived.length) line.textContent = progressText([], done);
    else {
      arrived.forEach((L, i) => {
        if (i) line.appendChild(doc.createTextNode(' · '));
        const n = el('span', 'on', (L.short || L.name) + ' ' + (byLeague.get(L.id) || []).length);
        n.title = L.name + (L.seasonName ? ' · ' + L.seasonName : '');
        line.appendChild(n);
      });
      if (!done) line.appendChild(el('span', 'wait', ' · …'));
    }
    status.appendChild(line);
    const ex = excludedText(excluded);
    /* not .sc-note: the kit already uses that name for the scorer's 9px centred note */
    if (ex) status.appendChild(el('div', 'sc-excl', ex));
    if (failed.length) status.appendChild(el('div', 'sc-warn',
      'Could not load ' + failed.map(f => f.name).join(', ') + ' — try again later'));
  }
  /* 'loading 3 of 12 leagues…', a bar, and a way out */
  let cancel = null;
  function paintProg() {
    if (!prog) return;
    const got = arrived.length + failed.length;
    prog.textContent = '';
    if (!total) { prog.hidden = true; return; }
    prog.hidden = false;
    const state = stopped ? 'stopped' : done ? 'done' : 'loading';
    const bar = el('div', 'sc-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(got));
    bar.setAttribute('aria-label', 'Leagues loaded');
    const fill = el('i');
    fill.style.width = Math.round(100 * got / total) + '%';
    bar.appendChild(fill);
    const txt = el('span', 'sc-prog-t', loadingText(got, total, state));
    prog.append(bar, txt);
    if (state === 'loading' && cancel) {
      const b = el('button', 'ep-chip sc-cancel', 'cancel');
      b.type = 'button';
      b.addEventListener('click', cancel);
      prog.appendChild(b);
    }
    prog.classList.toggle('done', state !== 'loading');
  }

  /* ---- the summary over the table: what was loaded, and the way back to the set-up ---- */
  let cover = null;
  function paintSummary(setup) {
    if (!summary || !SU) return;
    const parts = summary.querySelector('.sc-sum-parts') || summary;
    parts.textContent = '';
    const Un = root.EpinoiaUnits;
    const imperial = Un && typeof Un.get === 'function' && Un.get() === 'imperial';
    const n = arrived.length ? new Set(arrived.map(L => L.accessId || L.id)).size : (setup.leagues || []).length;
    SU.summaryParts(setup, { leagues: n,
      height: imperial ? v => Un.height(v) : null, weight: imperial ? v => Un.weight(v) : null
    }).forEach(t => parts.appendChild(el('span', 'sc-sum-p', t)));
    const cv = summary.querySelector('.sc-sum-cover');
    if (cv) {
      cv.textContent = '';
      if (cover && cover.players) {
        /* how much of what was read had each number, so an empty table is not a mystery */
        const bits = [];
        if (setup.age) bits.push('age known: ' + cover.age + '%');
        if (setup.ht) bits.push('height known: ' + cover.ht + '%');
        if (setup.wt) bits.push('weight known: ' + cover.wt + '%');
        if (bits.length) {
          cv.appendChild(el('span', '', bits.join(' · ')));
          cv.appendChild(el('span', '', setup.unk ? ' (players with none are kept)' : ' (players with none are left out)'));
        }
      }
    }
  }

  /* ---- the lock, the page's own (global.js) ---- */
  /* Over EVERY included league, known before any row is read (global.js onAccess), not only the
     leagues that have arrived: otherwise an open league landing first drew premium columns that
     a locking league then took away. The arrived leagues are the fallback for a loader without
     onAccess. */
  let lockSet = new Set();
  let included = null;                   // every league on this page, once onAccess has said
  const relock = () => {
    const list = included || arrived;
    const states = list.map(L => (A && typeof A.get === 'function') ? A.get(L.accessId || L.id) : null).filter(Boolean);
    lockSet = G.lockedColumns(states);
  };
  const locked = k => lockSet.has(k);

  /* ---- men's, women's, or all (0131) ----
     A recruiter working a women's roster does not want SLB Men and BCB in the
     same ranking. The leagues say which they are; a league that has not said
     appears only under "all" (or under either, when the set-up asked for those
     too), because guessing from a name is how you end up filing a women's league
     under men's.

     The row is only drawn when it would DO something: if every league on the
     page is one gender (or none has said), three buttons that all show the
     same table is furniture; and a set-up that chose a gender has chosen. */
  let who = readWho(root.location.search);
  let setupNow = null;
  const genderOf = id => {
    const L = (included || arrived).find(x => x.id === id);
    return (L && L.gender) || '';
  };
  const passWho = L => {
    if (!who) return true;
    const g = L.gender || genderOf(L.id);
    return g ? g === who : !!(setupNow && setupNow.gu && setupNow.g === who);
  };
  function paintWho() {
    const host2 = $('#who');
    if (!host2) return;
    const list = included || arrived || [];
    const kinds = new Set(list.map(L => L.gender).filter(Boolean));
    host2.textContent = '';
    if (kinds.size < 2 || (setupNow && setupNow.g)) { host2.hidden = true; return; }   // nothing to choose between
    host2.hidden = false;
    [['', 'all'], ['men', 'men’s'], ['women', 'women’s']].forEach(([k, label]) => {
      if (k && !kinds.has(k)) return;
      const b = el('button', 'ep-chip' + (who === k ? ' on' : ''), label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(who === k));
      b.addEventListener('click', () => {
        if (who === k) return;
        who = k;
        try {
          const p = new URLSearchParams(root.location.search);
          if (k) p.set(WHO_PARAM, k); else p.delete(WHO_PARAM);
          const q = p.toString();
          root.history.replaceState(root.history.state, '',
            root.location.pathname + (q ? '?' + q : '') + root.location.hash);
        } catch (_) { /* a sandboxed frame still filters, it just is not in the URL */ }
        paintWho(); paintStatus();
        if (tbl) tbl.setRows(allRows());
      });
      host2.appendChild(b);
    });
  }

  const allRows = () => {
    const out = [];
    arrived.forEach(L => {
      if (!passWho(L)) return;
      (byLeague.get(L.id) || []).forEach(r => out.push(r));
    });
    return out;
  };

  /* ---- the URL ---- */
  let state = readState(root.location.search);
  const onState = s => {
    state = s;
    try {
      const q = writeState(s, root.location.search);
      root.history.replaceState(root.history.state, '', root.location.pathname + q + root.location.hash);
    } catch (_) { /* a sandboxed frame: the view still works, it just is not in the URL */ }
  };

  /* ---- the comparison ---- */
  let panelChart = null;
  const phone = () => { try { return root.matchMedia(T.PHONE_MQ || '(max-width:820px)').matches; } catch (_) { return false; } };
  function closePanel() {
    if (panelChart) { panelChart.destroy(); panelChart = null; }
    if (panel) { panel.textContent = ''; panel.hidden = true; }
  }
  function onCompare(picks, statKeys) {
    if (!C || !tbl || !picks || picks.length < 2) return;
    const S = compareStats(statKeys, T.PLAYER_COLS, locked);
    const within = tbl.getState ? tbl.getState().withinLeague !== false : true;
    /* every comparable column, not only the chips': the category dropdowns can choose any of
       them, and a stat without its percentile draws as "no data" */
    const groups = typeof C.tableGroups === 'function' ? C.tableGroups(T.PRESETS.player, T.PLAYER_COLS, locked) : [];
    const o = compareInput(picks, statKeys, T.PLAYER_COLS, tbl.getRanks(S.every),
      { locked, withinLeague: within, statGroups: groups });
    if (phone() || !panel) { closePanel(); C.open(o); return; }
    closePanel();
    panel.hidden = false;
    const head = el('div', 'sc-cmp-head');
    const x = el('button', 'sc-cmp-close', '×');
    x.type = 'button'; x.setAttribute('aria-label', 'Close the comparison');
    x.addEventListener('click', closePanel);
    head.append(el('span', 'sc-cmp-title', o.title), x);
    const body = el('div', 'sc-cmp-body');
    panel.append(head, body);
    panelChart = C.render(body, Object.assign({}, o, { title: null }));
    try { panel.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { /* old engines */ }
  }

  /* ---- the table, drawn on the first rows ---- */
  let tbl = null;
  function paintTable() {
    const rows = allRows();
    if (!rows.length) return;
    if (!tbl) {
      host.textContent = '';
      tbl = T.render(tableOptions({ host, rows, locked, state, onState, onCompare }));
      /* the table drops what it cannot show (a locked preset, a filter on a locked or unknown
         stat), so the URL is written back from what it actually drew */
      if (tbl && typeof tbl.getState === 'function') onState(tbl.getState());
    } else tbl.setRows(rows);
  }

  /* ---- LOAD: the chosen leagues only, a few at a time ---- */
  let run = 0, ac = null;
  const skeleton = () => { host.textContent = ''; const k = el('div', 'sc-skel'); k.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 8; i++) k.appendChild(el('i')); host.appendChild(k); };
  async function start(setup) {
    const my = ++run;
    if (ac) { try { ac.abort(); } catch (_) { /* gone */ } }
    ac = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    const signal = ac ? ac.signal : undefined;
    setupNow = setup || null;
    current = setup || null;
    if (setupNow && setupNow.g) who = setupNow.g;
    arrived = []; byLeague = new Map(); rawCount = new Map(); excluded = []; failed = []; done = false; stopped = false;
    total = 0; included = null; lockSet = new Set(); cover = null;
    const bio = {};
    const year = new Date().getUTCFullYear();
    const wantBio = !!(SU && setupNow && SU.needsBio(setupNow) && Ages && typeof Ages.loadBio === 'function');
    const keep = rows => (SU && setupNow ? rows.filter(r => SU.rowPasses(r, bio[r.playerId != null ? r.playerId : r.id], setupNow, year)) : rows);
    const pending = [];
    if (tbl) { tbl = null; }
    closePanel();
    skeleton();
    if (results) { results.classList.remove('hide'); results.classList.add('sc-in'); setTimeout(() => results.classList.remove('sc-in'), 900); }
    if (ui) { ui.close(); ui.busy(true); }
    if (SU && setupNow) {
      SU.saveStored(store, key, setupNow);
      writeUrl(SU.writeSetup(setupNow, root.location.search, { go: true }));
      paintSummary(setupNow);
    }
    /* CANCEL settles the page at once: the reads already in flight finish in the background
       but are handed over no more (global.js stops announcing on an aborted signal) */
    const halt = () => {
      done = true; stopped = true;
      if (ui) ui.busy(false);
      paintStatus(); paintProg();
      if (!tbl) stateBox('Stopped before any players arrived. Edit the set-up, or load it again.');
    };
    cancel = () => { if (ac) ac.abort(); if (my === run) halt(); };
    paintStatus(); paintProg();
    if (results && my > 1) { try { results.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { /* old engines */ } }

    let cat = null;
    try { cat = await catP; } catch (_) { cat = null; }
    if (my !== run) return;
    const ids = SU && setupNow && cat ? SU.resolve(setupNow.leagues, (cat.leagues || []).concat(cat.all || [])).map(L => L.id)
      : (setupNow ? setupNow.leagues : null);
    const opts = {
      signal, concurrency: CONCURRENCY,
      onAccess(access, leagues, ex) {
        if (my !== run) return;
        included = (leagues || []).slice();
        excluded = ex || [];
        total = included.length;
        relock();
        paintWho();
        paintStatus(); paintProg();
      },
      onLeague(rows, L) {
        if (my !== run) return;
        const land = () => {
          if (my !== run) return;
          rawCount.set(L.id, (rows || []).length);
          byLeague.set(L.id, keep(rows || []));
          if (!arrived.some(x => x.id === L.id)) arrived.push(L);
          relock();
          paintStatus(); paintProg();
          paintTable();
        };
        if (wantBio && rows && rows.length) {
          pending.push(Promise.resolve(Ages.loadBio(cfg, rows.map(r => r.playerId != null ? r.playerId : r.id)))
            .then(b => { Object.assign(bio, b || {}); }, () => {}).then(land));
        } else land();
      }
    };
    if (cat) opts.catalogue = cat;
    if (ids) opts.leagueIds = ids;
    if (setupNow && setupNow.seasons && setupNow.seasons.length) opts.seasons = setupNow.seasons;
    if (ids && !ids.length) {
      if (ui) ui.busy(false);
      total = 0; done = true; paintProg(); paintStatus();
      stateBox('None of the leagues in this set-up is open to you. Edit the set-up to choose others.');
      return;
    }
    G.players(opts).then(async res => {
      await Promise.all(pending);
      if (my !== run) return;
      done = true;
      excluded = res.excluded || [];
      failed = res.failed || [];
      if (!total) total = (res.leagues || []).length;
      if (ui) ui.busy(false);
      if (wantBio) {
        cover = SU.coverage(res.rows || [], r => bio[r.playerId != null ? r.playerId : r.id]);
      }
      if (setupNow) paintSummary(setupNow);
      paintStatus(); paintProg();
      /* every included league has been handed over through onLeague by now, so the table is
         already whole; only an empty page is left to say so */
      if (tbl) return followAccess(res);
      const read = [...rawCount.values()].reduce((a, b) => a + b, 0);
      if (!res.leagues.length && excluded.length) stateBox('Every league on the platform is members-only. Sign in as a member to scout them.');
      else if (read) {
        /* most often a range over a number these leagues hardly record (the summary says how
           little): one press loads it again keeping those players */
        const s0 = setupNow;
        const widen = s0 && !s0.unk && (s0.age || s0.ht || s0.wt || (s0.pos && s0.pos.length))
          ? { label: 'keep players with no data', run: () => { const s1 = Object.assign({}, s0, { unk: true }); if (ui) ui.set(s1); start(s1); } } : null;
        stateBox('No player in these leagues fits the set-up. Widen a range or edit the set-up.', false, widen);
      }
      else stateBox('No statistics yet — these fill in as games are finalised in each league.');
      followAccess(res);
    }).catch(e => {
      if (my !== run) return;
      if (ui) ui.busy(false);
      if (e && e.name === 'AbortError') { halt(); return; }
      done = true;
      paintStatus(); paintProg();
      if (tbl) return;                    // what arrived stays on screen
      stateBox('Could not load the scouting table: ' + ((e && e.message) || 'network error'), true);
    });
  }

  /* ---- a sign-in, sign-out or late answer after the page is drawn ----
     Which leagues are on the page was decided at load, so a change to that reloads the page;
     a change only to what is locked relocks the drawn table. One listener for the page, over
     whichever load is on screen. */
  let watch = null;
  function followAccess(res) {
    if (!A || typeof A.onChange !== 'function' || typeof A.canView !== 'function') return;
    const ids = res.leagues.map(L => L.accessId || L.id).concat(excluded.map(x => x.id));
    const sig = () => ids.filter(id => A.canView(id)).join(',');
    const first = !watch;
    watch = { ids, sig, seen: sig() };
    if (!first) return;
    const check = () => {
      if (watch.sig() !== watch.seen) { root.location.reload(); return; }
      const before = [...lockSet].sort().join(',');
      relock();
      if (tbl && [...lockSet].sort().join(',') !== before) tbl.setRows(allRows());
    };
    try {
      A.onChange(d => {
        if (d && d.reason === 'auth' && typeof A.loadMany === 'function') {
          Promise.resolve().then(() => A.loadMany({ leagueIds: watch.ids, force: true })).then(check, () => {});
        } else check();
      });
    } catch (_) { /* the page as drawn */ }
  }

  /* ---- a link that says go, or a page with no set-up module: load now ---- */
  if (!SU) start(null);
  else if (fromUrl.go) start(initial);
}

return { boot, readState, writeState, encodeFilters, decodeFilters, tableOptions, compareInput,
  compareStats, progressText, excludedText, loadingText, CONCURRENCY, DEFAULTS, PARAM, CORE_STATS, MAX_COMPARE_STATS, PAGE_SIZE };
}));
