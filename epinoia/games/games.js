'use strict';
/* ============================================================================
   /epinoia/games/ — GLOBAL FIXTURES (roadmap Phase 2).

   The games NEAREST TO NOW first, 30 at a time, across every league that has a game in the next seven days,
   grouped into one dropdown per league.

   WHICH LEAGUES. One light read (EpinoiaGlobalGames.weekLeagues: ids and tip-offs of the scheduled games from
   two hours ago to seven days ahead, counted per league) decides it: a league with nothing in the next week is not
   on the page (its own pages have its results and calendar); a league with a game live now is, whatever else it has.
   The number beside a league is its games in that week. Both cursors below are scoped to those leagues, so the
   results shown are theirs too.

   THE ORDER, at every level (the top of the page says so in words):
     - the page:   the game closest to now first, then the next closest, outward - upcoming games and recent
                   results merged by how far they are from now (EpinoiaGlobalGames.feed);
     - the leagues: by the league whose game is closest to now (live games are pinned above them all);
     - in a league: 'next' games soonest first, then 'results' newest first (groupOrder).
   "Show more" (page-wide) reads the next 30 further from now, across all the leagues.
   "Show more in this league" (each dropdown) reads that league's next games further from now, that league only:
   its own feed (feed({ league })) that begins after what is already on the page for it, so a press always adds
   games and never repeats one; a league that has none on the page yet (its games are further from now than the
   30 nearest overall) is read when its dropdown is opened.

   "NOW" IS FROZEN AT LOAD. Every cursor measures from it: upcoming games from two hours before it, forwards;
   results before it, backwards. A reader pressing Show more ten minutes later gets the next games of the same
   list, not a list that has shifted under them.

   LIVE GAMES ARE PINNED above every group, read on their own query and kept fresh (15 s while any is live, 30 s
   otherwise, and at once on rt.js's 'epinoia:live'). A pinned game that finishes stays pinned with its final
   score for the rest of the visit rather than vanishing from under the reader; while it is being finalised
   anonymous reads cannot see it at all, so its last card is kept until it comes back.

   GROUPS. One details.ep-acc per league. The first is open. Show more adds into the groups already on the page and
   keeps each one's open or closed state, because the elements are kept and only their lists are redrawn.

   THE COUNT reads "30 of N", then "all N shown" when the cursors run out. N is the exact count of the leagues
   on the page, and becomes what was actually shown at the end, because a game can drop out while it is being
   finalised: a count is never assumed only to grow.
   ============================================================================ */
(function () {
  const PAGE = 30, LEAGUE_PAGE = 8, WEEK_DAYS = 7, LIVE_MS = 15000, IDLE_MS = 30000;
  const NOW = Date.now();

  const $ = id => document.getElementById(id);
  const G = () => window.EpinoiaGlobalGames;

  let feed = null;
  const rows = new Map();          // every non-pinned game shown, by id
  const pinned = new Map();        // live games (and ones that finished while pinned), by id
  const liveState = {};
  const groupEls = new Map();      // league id -> { det, body, n, name, foot, btn, count, ... }
  let liveIds = [];                // the games live when the page opened
  let scope = [];                  // the league ids on the page (the week's, and any with a game live)
  let total = null, pageDone = false;
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

  /* A game that is now live is pinned, and comes out of its group if a page had listed it. */
  function pin(g) {
    pinned.set(g.id, g);
    if (rows.has(g.id)) { rows.delete(g.id); return true; }
    return false;
  }

  async function readLive() {
    const gg = G();
    const live = await gg.live();
    let regroup = false;
    const seen = new Set();
    live.forEach(g => {
      seen.add(g.id);
      if (pin(g)) regroup = true;
      const l = gg.leagueOf(g);
      if (l && l.id && !groupEls.has(l.id)) { addGroup(l, 0, 0); regroup = true; }
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
    if (regroup) drawGroups();
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

  /* A LEAGUE'S NAME, SHORT, for the Show more button: the same rule as a star card's league
     tag (EpinoiaStars.leagueShort: the name up to 14 characters, otherwise its initials), so
     three full league names never make the button three lines tall on a phone */
  function shortName(l) {
    const name = String((l && (l.name || l.slug)) || 'League').trim();
    if (name.length <= 14) return name;
    const words = name.split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
    return words.length >= 2 ? words.map(w => w[0]).join('').toUpperCase() : name;
  }

  /* ------------------------------------------------------------- groups --- */
  /* one dropdown for a league: `weekN` its games in the next seven days, `first` its nearest tip-off (ms) */
  function addGroup(league, weekN, first) {
    const l = league || {};
    const key = l.id || '';
    if (groupEls.has(key)) return groupEls.get(key);
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
    const foot = el('div', 'gm-lmore');
    const btn = el('button', 'ep-btn more', 'Show more in this league');
    btn.type = 'button';
    const count = el('span', 'gm-gcount');
    count.setAttribute('aria-live', 'polite');
    foot.append(btn, count);
    const rec = { id: key, league: l, det, body, n, foot, btn, count, name: shortName(l), grewTimer: null,
                  weekN: weekN || 0, first: first || Infinity, lfeed: null, loading: false, done: false, ltotal: null, opened: false };
    btn.addEventListener('click', () => { moreInLeague(rec).catch(failedLeague(rec)); });
    /* a league that has nothing on the page yet is read when it is opened */
    det.addEventListener('toggle', () => {
      if (det.open && !rec.opened) { rec.opened = true; if (!leagueRows(rec.id).length) moreInLeague(rec).catch(failedLeague(rec)); }
    });
    groupEls.set(key, rec);
    return rec;
  }

  const leagueRows = id => Array.from(rows.values()).filter(g => leagueKey(g) === id);

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

  /* what a league's foot says: how many of its games are on the page, of how many it has once its feed has counted */
  function paintLeagueCount(rec, shownN) {
    if (rec.done) rec.count.textContent = 'all ' + shownN + ' shown';
    else if (rec.ltotal != null) rec.count.textContent = shownN + ' of ' + rec.ltotal;
    else rec.count.textContent = shownN + ' shown';
    rec.btn.hidden = rec.done;
  }

  function drawGroups() {
    const host = $('gmGroups');
    const groups = G().groupOrder(Array.from(rows.values()), NOW);
    const skel = host.querySelector('.gm-skel');
    if (skel) skel.remove();
    const empty = host.querySelector('.empty');
    if (empty) empty.remove();

    /* a league with games on the page is on the page, whatever the week read said */
    groups.forEach(grp => { if (grp.key && !groupEls.has(grp.key)) addGroup(grp.league, 0, 0); });
    const byKey = new Map(groups.map(g => [g.key, g]));

    /* nearest to now first: the league whose game (or result) is closest to now, or whose next game is */
    const dist = rec => Math.min((byKey.get(rec.id) || { imminent: Infinity }).imminent,
      rec.first === Infinity ? Infinity : Math.abs(rec.first - NOW));
    const order = Array.from(groupEls.values()).sort((a, b) => dist(a) - dist(b) ||
      String(a.league.name || '').localeCompare(String(b.league.name || '')));

    order.forEach(rec => {
      const grp = byKey.get(rec.id) || { next: [], results: [], count: 0 };
      rec.body.textContent = '';
      rec.body.appendChild(section('Next games, soonest first', grp.next, NOW));
      rec.body.appendChild(section('Latest results, newest first', grp.results, NOW));
      rec.shown = grp.count;
      if (rec.weekN) rec.n.textContent = rec.weekN + (rec.weekN === 1 ? ' game' : ' games');
      else rec.n.textContent = grp.count + (grp.count === 1 ? ' game' : ' games');
      paintLeagueCount(rec, grp.count);
      rec.body.appendChild(rec.foot);
      host.appendChild(rec.det);        // appending moves it into order; open state is the element's own
    });
    /* the league at the top is open (and read, if the page has nothing of it yet) */
    const first = host.querySelector('details.gm-acc');
    if (first && !host.dataset.opened) {
      host.dataset.opened = '1';
      first.open = true;
      const rec = groupEls.get(first.getAttribute('data-league'));
      if (rec) { rec.opened = true; if (!leagueRows(rec.id).length && !pageDone) moreInLeague(rec).catch(failedLeague(rec)); }
    }

    if (!groupEls.size && !pinned.size) {
      host.appendChild(el('div', 'empty', 'No games in the next 7 days. A league appears here when it has one.'));
    }
  }

  /* ------------------------------------------------- the two Show mores --- */
  /* pull `n` games this reader has not been shown from a feed: a cursor can hand back one that the other
     Show more already put on the page, and a press should add games, not repeat them */
  async function pull(f, n) {
    let fresh = 0, res;
    do {
      res = await f.next(n - fresh);
      res.rows.forEach(g => {
        if (pinned.has(g.id)) return;
        if (!rows.has(g.id)) fresh++;
        rows.set(g.id, g);
      });
    } while (fresh < n && !res.done);
    return res;
  }

  /* "Show more in this league": that league's next games further from now, its own cursor, after what it already shows */
  async function moreInLeague(rec) {
    if (rec.loading || rec.done) return;
    rec.loading = true;
    rec.btn.disabled = true;
    rec.btn.textContent = 'Loading…';
    try {
      if (!rec.lfeed) rec.lfeed = G().feed({ now: NOW, exclude: liveIds.concat(leagueRows(rec.id).map(g => g.id)), batch: LEAGUE_PAGE, league: rec.id });
      const before = leagueRows(rec.id).length;
      const res = await pull(rec.lfeed, LEAGUE_PAGE);
      rec.done = res.done;
      rec.ltotal = res.total;
      drawGroups();
      paintTotal();
      if (leagueRows(rec.id).length > before) lit(rec);
    } finally {
      rec.loading = false;
      rec.btn.disabled = false;
      rec.btn.textContent = 'Show more in this league';
    }
  }

  function failedLeague(rec) {
    return e => {
      console.warn('[games]', rec.id, e);
      rec.count.textContent = 'Could not load. Press Show more in this league to try again.';
      rec.btn.hidden = false;
      rec.body.appendChild(rec.foot);
    };
  }

  /* ---------------------------------------------------------- the pages --- */
  function paintCount(res) {
    const c = $('gmCount');
    if (!res) { c.textContent = ''; return; }
    const shown = rows.size;
    if (res.done) c.textContent = 'all ' + shown + ' shown';
    else if (res.total != null) c.textContent = shown + ' of ' + res.total;
    else c.textContent = shown + ' shown';
  }
  let lastRes = null;
  function paintTotal() { paintCount(lastRes); }

  /* SHOW MORE SAYS WHERE THE ROWS WENT. Most of a later page lands in groups that are closed,
     or in a league's group that did not exist yet, and on a phone the count at the top is off
     screen by the time you reach the button: a press that changed nothing visible reads as
     broken. So after a press, a group this press created opens, every group that grew has its
     count lit for a moment, and the button names the leagues that received games. The first
     page does none of this (only the first group opens, as before). */
  /* counts are read off the groups just before and just after the redraw, not remembered
     between presses, because pinning a game that went live also shrinks a group meanwhile */
  const countOf = rec => rec.shown || 0;
  function snapshot() {
    const m = new Map();
    groupEls.forEach((rec, key) => m.set(key, countOf(rec)));
    return m;
  }
  function grown(before) {
    const out = [];
    groupEls.forEach((rec, key) => {
      const was = before.has(key) ? before.get(key) : 0;
      const now = countOf(rec);
      if (now > was) out.push({ rec, added: now - was, fresh: !before.has(key) });
    });
    return out;
  }
  function lit(rec) {
    rec.n.classList.remove('gm-grew');
    void rec.n.offsetWidth;          // restart the highlight on a second quick press
    rec.n.classList.add('gm-grew');
    clearTimeout(rec.grewTimer);
    rec.grewTimer = setTimeout(() => rec.n.classList.remove('gm-grew'), 1200);
  }

  let pages = 0;
  async function page() {
    const btn = $('gmMore');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    let label = 'Show more';
    try {
      const before = snapshot();
      const res = await pull(feed, PAGE);
      lastRes = res;
      /* every cursor of the page has run out: every league's games are on it, so no league has more to read */
      if (res.done) { pageDone = true; groupEls.forEach(rec => { rec.done = true; }); }
      drawGroups();
      paintCount(res);
      const grew = grown(before);
      if (pages++ > 0 && grew.length) {
        grew.forEach(({ rec, fresh }) => { if (fresh) { rec.det.open = true; rec.opened = true; } lit(rec); });
        const added = grew.reduce((s, x) => s + x.added, 0);
        label = 'Show more · ' + added + ' added to ' + grew.map(x => x.rec.name).join(', ');
      }
      pageDone = res.done;
      btn.hidden = res.done;
      return res;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function failed(e) {
    console.warn('[games]', e);
    const host = $('gmGroups');
    host.removeAttribute('aria-busy');
    if (rows.size) return;             // keep what is shown; the button stays for another try
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

    /* the leagues on the page: those with a game in the next 7 days, and any with a game live now */
    let week, all;
    try { [week, all] = await Promise.all([gg.weekLeagues(NOW, WEEK_DAYS), gg.leagues().catch(() => [])]); }
    catch (e) { return failed(e); }
    const byId = new Map((all || []).map(l => [l.id, l]));
    week.forEach(w => { if (byId.has(w.id)) addGroup(byId.get(w.id), w.n, w.first); });
    live.forEach(g => { const l = gg.leagueOf(g); if (l && l.id && !groupEls.has(l.id)) addGroup(l, 0, 0); });
    scope = Array.from(groupEls.keys());

    if (!scope.length) {
      $('gmGroups').removeAttribute('aria-busy');
      drawGroups();
      $('gmMore').hidden = true;
    } else {
      feed = gg.feed({ now: NOW, exclude: live, batch: PAGE, league: scope });
      try {
        await page();
        $('gmGroups').removeAttribute('aria-busy');
      } catch (e) { feed = null; return failed(e); }
    }
    if (!started) {
      started = true;
      $('gmMore').addEventListener('click', () => {
        if (!feed) return;
        page().catch(failed);
      });
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
