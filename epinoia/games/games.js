'use strict';
/* ============================================================================
   /epinoia/games/ — GLOBAL FIXTURES (roadmap Phase 2), one dropdown per league.

   Every league with a game in the NEXT SEVEN DAYS, each as its own dropdown, nearest first. A league with nothing
   in the next week is not on the page (its own pages have its results and its calendar); a league with a game
   live now is, whatever else it has.

   WHICH LEAGUES: one light read (EpinoiaGlobalGames.weekLeagues: ids and tip-offs of the scheduled games from two
   hours ago to seven days ahead, counted per league). The dropdown's heading carries that league's count.

   WHAT A DROPDOWN HOLDS, AND SHOW MORE IS ITS OWN. A league's games are read when its dropdown is opened (the
   first one is opened for the reader) with a feed of that league alone (EpinoiaGlobalGames.feed({ league })):
   the games nearest to now first - the next ones and the latest results - PAGE of them, and a Show more at the
   foot of THAT dropdown reads the next PAGE of that league. Nothing about one league's button moves another
   league's list, and a league nobody opens is never read. Inside a dropdown: 'next' soonest first, then
   'results' newest first.

   "NOW" IS FROZEN AT LOAD. Every league's cursors measure from it, so pressing Show more ten minutes later gets the
   next games of the same list, not a list that has shifted under the reader.

   LIVE GAMES ARE PINNED above every dropdown, read on their own query and kept fresh (15 s while any is live, 30 s
   otherwise, and at once on rt.js's 'epinoia:live'). A pinned game that finishes stays pinned with its final
   score for the rest of the visit rather than vanishing from under the reader; while it is being finalised
   anonymous reads cannot see it at all, so its last card is kept until it comes back.

   THE COUNT under each heading is the league's games in the next seven days; the count beside its button reads
   "8 of 47", then "all 47 shown" when that league's cursors run out (and becomes what was actually shown, because
   a game can drop out while it is being finalised).
   ============================================================================ */
(function () {
  const PAGE = 8, WEEK_DAYS = 7, LIVE_MS = 15000, IDLE_MS = 30000;
  const NOW = Date.now();

  const $ = id => document.getElementById(id);
  const G = () => window.EpinoiaGlobalGames;

  const groups = new Map();        // league id -> { id, league, det, body, n, foot, btn, count, weekN, first, rows, feed, ... }
  const pinned = new Map();        // live games (and ones that finished while pinned), by id
  const liveState = {};
  let liveIds = [];                // the games live when the page opened: no league's feed repeats them
  let liveTimer = null;

  /* --------------------------------------------------------------- flags --- */
  function flagOf(code) {
    const C = window.EpinoiaCountry;
    if (C && typeof C.flagOf === 'function') return C.flagOf(code);
    if (!/^[A-Za-z]{2}$/.test(code || '')) return '\u{1F30D}';
    return String.fromCodePoint(...[...String(code).toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  function countryName(code) {
    const C = window.EpinoiaCountry;
    if (C && typeof C.countryName === 'function') return C.countryName(code);
    if (String(code).toUpperCase() === 'XB') return 'Balkans';   // a region, not a country (country.js)
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()); }
    catch (_) { return code || ''; }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const leagueKey = g => ((G().leagueOf(g) || {}).id) || '';

  /* --------------------------------------------------------------- live --- */
  function drawLive() {
    const box = $('gmLive'), grid = $('gmLiveGrid');
    const list = Array.from(pinned.values()).sort((a, b) =>
      ((a.status === 'live') !== (b.status === 'live') ? (a.status === 'live' ? -1 : 1)
        : Date.parse(a.tipoff_at) - Date.parse(b.tipoff_at)));
    box.hidden = !list.length;
    grid.textContent = '';
    list.forEach(g => grid.appendChild(G().card(g, { base: '../', now: Date.now(), state: liveState[g.id] })));
  }

  /* A game that is now live is pinned, and comes out of its league's list if that had shown it: the league
     whose list changed is returned, to be redrawn. */
  function pin(g) {
    pinned.set(g.id, g);
    const rec = groups.get(leagueKey(g));
    return rec && rec.rows.delete(g.id) ? rec : null;
  }

  async function readLive() {
    const gg = G();
    const live = await gg.live();
    const touched = new Set();
    const seen = new Set();
    live.forEach(g => {
      seen.add(g.id);
      const rec = pin(g);
      if (rec) touched.add(rec);
      if (!groups.has(leagueKey(g)) && leagueKey(g)) { addGroup(gg.leagueOf(g), 0, 0); touched.add(groups.get(leagueKey(g))); }
    });
    /* pinned games no longer live: ask for them by id (final comes back; finalising does not,
       and keeps its last card) */
    const gone = Array.from(pinned.keys()).filter(id => !seen.has(id) && pinned.get(id).status === 'live');
    if (gone.length) {
      try {
        const back = await gg.request('games?select=' + gg.SEL + '&id=in.(' + gone.map(encodeURIComponent).join(',') + ')', false);
        back.forEach(g => pinned.set(g.id, g));
      } catch (_) { /* keep the last cards */ }
    }
    const ids = Array.from(pinned.values()).filter(g => g.status === 'live').map(g => g.id);
    const st = ids.length ? await gg.liveState(ids) : {};
    Object.keys(st).forEach(k => { liveState[k] = st[k]; });
    drawLive();
    touched.forEach(rec => { if (rec) drawGroup(rec); });
    if (touched.size) orderGroups();
  }

  function watchLive(delay) {
    clearTimeout(liveTimer);
    const anyLive = Array.from(pinned.values()).some(g => g.status === 'live');
    liveTimer = setTimeout(async () => {
      if (document.visibilityState !== 'hidden') {
        try { await readLive(); } catch (_) { /* a blip keeps what is on screen */ }
      }
      watchLive();
    }, delay != null ? delay : (anyLive ? LIVE_MS : IDLE_MS));
  }

  let rt = null;
  function listen() {
    if (rt || !window.EpinoiaRT || !window.EPINOIA_CONFIG) return;
    try { rt = window.EpinoiaRT.create({ url: window.EPINOIA_CONFIG.supabaseUrl, key: window.EPINOIA_CONFIG.supabaseAnonKey }); }
    catch (_) { rt = null; }
    if (!rt) return;
    let soon = null;
    rt.watch('epinoia:live', () => {
      clearTimeout(soon);
      soon = setTimeout(() => watchLive(0), 80 + Math.random() * 1200);
    });
  }

  /* ------------------------------------------------------------- groups --- */
  /* one dropdown for a league: `weekN` its games in the next seven days, `first` its nearest tip-off (ms) */
  function addGroup(league, weekN, first) {
    const l = league || {};
    const key = l.id || '';
    if (groups.has(key)) return groups.get(key);
    const det = el('details', 'ep-acc gm-acc');
    det.setAttribute('data-league', key);
    const sum = el('summary');
    const t = el('span', 't');
    t.innerHTML = typeof window.epinoiaLeagueBadge === 'function'
      ? window.epinoiaLeagueBadge(l, { cls: 'lg' })
      : '<span class="lgb lg"><span class="lgb-name"></span></span>';
    if (typeof window.epinoiaLeagueBadge !== 'function') t.querySelector('.lgb-name').textContent = l.name || 'League';
    G().wireBadges(t);
    sum.appendChild(t);
    if (l.country) {
      const f = el('span', 'flag', flagOf(l.country));
      f.title = countryName(l.country);
      f.setAttribute('aria-label', countryName(l.country));
      f.setAttribute('role', 'img');
      sum.appendChild(f);
    }
    const n = el('span', 'n', weekN ? weekN + (weekN === 1 ? ' game' : ' games') : '');
    sum.appendChild(n);
    det.appendChild(sum);
    const body = el('div', 'gm-body');
    det.appendChild(body);
    /* this league's own Show more, at the foot of its list */
    const foot = el('div', 'gm-more');
    const btn = el('button', 'ep-btn more', 'Show more');
    btn.type = 'button';
    const count = el('span', 'gm-gcount');
    count.setAttribute('aria-live', 'polite');
    foot.append(btn, count);
    const rec = { id: key, league: l, det, body, n, foot, btn, count, weekN: weekN || 0, first: first || Infinity,
                  rows: new Map(), feed: null, started: false, loading: false, done: false };
    btn.addEventListener('click', () => { loadGroup(rec).catch(failedGroup(rec)); });
    /* a league is read when it is opened (the first one is opened for the reader, below) */
    det.addEventListener('toggle', () => { if (det.open && !rec.started) loadGroup(rec).catch(failedGroup(rec)); });
    groups.set(key, rec);
    return rec;
  }

  /* leagues with a game live come first, then by nearest tip-off; appending moves an element into order (open state
     is the element's own) */
  function orderGroups() {
    const host = $('gmGroups');
    const hasLive = rec => Array.from(pinned.values()).some(g => g.status === 'live' && leagueKey(g) === rec.id);
    Array.from(groups.values())
      .sort((a, b) => (hasLive(b) - hasLive(a)) || (a.first - b.first) ||
        String(a.league.name || '').localeCompare(String(b.league.name || '')))
      .forEach(rec => host.appendChild(rec.det));
    const c = $('gmCount');
    const n = groups.size;
    c.textContent = n ? n + (n === 1 ? ' league' : ' leagues') : '';
  }

  function section(title, list, now) {
    const frag = document.createDocumentFragment();
    if (!list.length) return frag;
    const h = el('h3', 'gm-sub');
    h.appendChild(document.createTextNode(title + ' '));
    h.appendChild(el('span', 'n', '· ' + list.length));
    frag.appendChild(h);
    const grid = el('div', 'fxc-grid');
    list.forEach(g => grid.appendChild(G().card(g, { base: '../', now, badge: false })));
    frag.appendChild(grid);
    return frag;
  }

  /* one league's list: 'next' soonest first, then 'results' newest first, then its Show more */
  function drawGroup(rec, res) {
    const all = Array.from(rec.rows.values());
    const time = g => Date.parse(g.tipoff_at) || 0;
    const next = all.filter(g => g.status !== 'final').sort((a, b) => time(a) - time(b));
    const results = all.filter(g => g.status === 'final').sort((a, b) => time(b) - time(a));
    rec.body.textContent = '';
    rec.body.appendChild(section('next', next, NOW));
    rec.body.appendChild(section('results', results, NOW));
    if (!all.length && rec.started && !rec.loading) {
      rec.body.appendChild(el('div', 'empty', 'No games to show here yet.'));
    }
    if (res) {
      rec.done = res.done;
      if (res.done) rec.count.textContent = 'all ' + res.shown + ' shown';
      else if (res.total != null) rec.count.textContent = res.shown + ' of ' + res.total;
      else rec.count.textContent = res.shown + ' shown';
    }
    rec.btn.hidden = rec.done;
    rec.body.appendChild(rec.foot);
  }

  async function loadGroup(rec) {
    if (rec.loading || rec.done) return;
    rec.loading = true;
    if (!rec.started && !rec.rows.size) { rec.body.textContent = ''; rec.body.appendChild(el('div', 'gm-sub', 'Loading…')); rec.body.appendChild(rec.foot); }
    rec.started = true;
    rec.btn.disabled = true;
    rec.btn.textContent = 'Loading…';
    try {
      if (!rec.feed) rec.feed = G().feed({ now: NOW, exclude: liveIds, batch: PAGE, league: rec.id });
      const res = await rec.feed.next(PAGE);
      res.rows.forEach(g => { if (!pinned.has(g.id)) rec.rows.set(g.id, g); });
      rec.loading = false;
      drawGroup(rec, res);
    } catch (e) {
      rec.loading = false;
      rec.started = rec.rows.size > 0;          // an opened league that failed to read asks again when opened
      throw e;
    } finally {
      rec.loading = false;
      rec.btn.disabled = false;
      rec.btn.textContent = 'Show more';
    }
  }

  /* a league that could not be read keeps what it showed, and says so beside its button */
  function failedGroup(rec) {
    return e => {
      console.warn('[games]', rec.id, e);
      rec.count.textContent = 'Could not load. Press Show more to try again.';
      rec.btn.hidden = false;
      rec.body.appendChild(rec.foot);
    };
  }

  /* ---------------------------------------------------------- the page --- */
  function failed(e) {
    console.warn('[games]', e);
    const host = $('gmGroups');
    host.removeAttribute('aria-busy');
    if (groups.size) return;
    host.textContent = '';
    const box = el('div', 'empty', 'Fixtures could not be loaded just now.');
    const again = el('button', 'ep-btn', 'Try again');
    again.type = 'button';
    again.addEventListener('click', () => { host.setAttribute('aria-busy', 'true'); start(); }, { once: true });
    box.appendChild(el('br'));
    box.appendChild(again);
    host.appendChild(box);
  }

  let started = false;
  async function start() {
    const gg = G();
    if (!gg) return failed(new Error('globalgames.js has not loaded'));
    let live = [];
    try { live = await gg.live(); } catch (_) { live = []; }
    live.forEach(g => pinned.set(g.id, g));
    liveIds = live.map(g => g.id);
    if (live.length) {
      const st = await gg.liveState(live.map(g => g.id));
      Object.keys(st).forEach(k => { liveState[k] = st[k]; });
    }
    drawLive();

    let week, all;
    try { [week, all] = await Promise.all([gg.weekLeagues(NOW, WEEK_DAYS), gg.leagues().catch(() => [])]); }
    catch (e) { return failed(e); }
    const byId = new Map((all || []).map(l => [l.id, l]));
    week.forEach(w => { if (byId.has(w.id)) addGroup(byId.get(w.id), w.n, w.first); });
    live.forEach(g => { const l = gg.leagueOf(g); if (l && l.id && !groups.has(l.id)) addGroup(l, 0, 0); });

    const host = $('gmGroups');
    host.textContent = '';
    if (!groups.size && !pinned.size) {
      host.appendChild(el('div', 'empty', 'No games in the next 7 days. A league appears here when it has one.'));
    }
    orderGroups();
    host.removeAttribute('aria-busy');
    /* the league at the top is open, and read */
    const top = host.querySelector('details.gm-acc');
    if (top) { top.open = true; const rec = groups.get(top.getAttribute('data-league')); if (rec) loadGroup(rec).catch(failedGroup(rec)); }
    if (!started) {
      started = true;
      watchLive();
      listen();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') watchLive(0);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
