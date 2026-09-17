'use strict';
/* ============================================================================
   /epinoia/games/ — GLOBAL FIXTURES (roadmap Phase 2).

   Every league's games on one page, 30 at a time, nearest to now first.

   "NOW" IS FROZEN AT LOAD. Both cursors (EpinoiaGlobalGames.feed) measure
   from it: upcoming games from two hours before it, forwards; results before
   it, backwards. A reader pressing Show more ten minutes later gets the next
   thirty of the same list, not a list that has shifted under them.

   LIVE GAMES ARE PINNED above every group, read on their own query and kept
   fresh (15 s while any is live, 30 s otherwise, and at once on rt.js's
   'epinoia:live'). A pinned game that finishes stays pinned with its final
   score for the rest of the visit rather than vanishing from under the reader;
   while it is being finalised anonymous reads cannot see it at all, so its
   last card is kept until it comes back.

   GROUPS. One details.ep-acc per league, ordered by its most imminent game.
   The first group is open. Show more adds into the groups already on the page
   and keeps each one's open or closed state, because the elements are kept and
   only their lists are redrawn. Inside a group: 'next' soonest first, then
   'results' newest first (EpinoiaGlobalGames.groupOrder).

   THE COUNT reads "30 of N", then "all N shown" when both cursors run out. N
   comes from the two exact counts on the first reads, and becomes what was
   actually shown at the end, because a game can drop out while it is being
   finalised: a count is never assumed only to grow.
   ============================================================================ */
(function () {
  const PAGE = 30, LIVE_MS = 15000, IDLE_MS = 30000;
  const NOW = Date.now();

  const $ = id => document.getElementById(id);
  const G = () => window.EpinoiaGlobalGames;

  let feed = null;
  const rows = new Map();          // every non-pinned game shown, by id
  const pinned = new Map();        // live games (and ones that finished while pinned), by id
  const liveState = {};
  const groupEls = new Map();      // league id -> { det, body, n }
  let firstGroup = true;
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
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()); }
    catch (_) { return code || ''; }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

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
    live.forEach(g => { seen.add(g.id); if (pin(g)) regroup = true; });
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
  function groupEl(grp) {
    const key = grp.key;
    if (groupEls.has(key)) return groupEls.get(key);
    const l = grp.league || {};
    const det = el('details', 'ep-acc gm-acc');
    det.setAttribute('data-league', key);
    if (firstGroup) { det.open = true; firstGroup = false; }
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
    const n = el('span', 'n');
    sum.appendChild(n);
    det.appendChild(sum);
    const body = el('div', 'gm-body');
    det.appendChild(body);
    const rec = { det, body, n, name: shortName(l), grewTimer: null };
    groupEls.set(key, rec);
    return rec;
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

  function drawGroups() {
    const host = $('gmGroups');
    const groups = G().groupOrder(Array.from(rows.values()), NOW);
    const skel = host.querySelector('.gm-skel');
    if (skel) skel.remove();
    const empty = host.querySelector('.empty');
    if (empty) empty.remove();

    const want = new Set(groups.map(g => g.key));
    groupEls.forEach((rec, key) => { if (!want.has(key)) { rec.det.remove(); groupEls.delete(key); } });

    groups.forEach(grp => {
      const rec = groupEl(grp);
      rec.body.textContent = '';
      rec.body.appendChild(section('next', grp.next, NOW));
      rec.body.appendChild(section('results', grp.results, NOW));
      rec.n.textContent = grp.count + (grp.count === 1 ? ' game' : ' games');
      host.appendChild(rec.det);        // appending moves it into order; open state is the element's own
    });

    if (!groups.length && !pinned.size) {
      host.appendChild(el('div', 'empty', 'No fixtures or results yet.'));
    }
  }

  /* ---------------------------------------------------------- the pages --- */
  function paintCount(res) {
    const c = $('gmCount');
    if (!res) { c.textContent = ''; return; }
    if (res.done) c.textContent = 'all ' + res.shown + ' shown';
    else if (res.total != null) c.textContent = res.shown + ' of ' + res.total;
    else c.textContent = res.shown + ' shown';
  }

  /* SHOW MORE SAYS WHERE THE ROWS WENT. Most of a later page lands in groups that are closed,
     or in a league's group that did not exist yet, and on a phone the count at the top is off
     screen by the time you reach the button: a press that changed nothing visible reads as
     broken. So after a press, a group this press created opens, every group that grew has its
     count lit for a moment, and the button names the leagues that received games. The first
     page does none of this (only the first group opens, as before). */
  /* counts are read off the groups just before and just after the redraw, not remembered
     between presses, because pinning a game that went live also shrinks a group meanwhile */
  const countOf = rec => Number.parseInt(rec.n.textContent, 10) || 0;
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

  let pages = 0;
  async function page() {
    const btn = $('gmMore');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    let label = 'Show more';
    try {
      const res = await feed.next(PAGE);
      res.rows.forEach(g => { if (!pinned.has(g.id)) rows.set(g.id, g); });
      const before = snapshot();
      drawGroups();
      paintCount(res);
      const grew = grown(before);
      if (pages++ > 0 && grew.length) {
        grew.forEach(({ rec, fresh }) => {
          if (fresh) rec.det.open = true;
          rec.n.classList.remove('gm-grew');
          void rec.n.offsetWidth;          // restart the highlight on a second quick press
          rec.n.classList.add('gm-grew');
          clearTimeout(rec.grewTimer);
          rec.grewTimer = setTimeout(() => rec.n.classList.remove('gm-grew'), 1200);
        });
        const added = grew.reduce((s, x) => s + x.added, 0);
        label = 'Show more · ' + added + ' added to ' + grew.map(x => x.rec.name).join(', ');
      }
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
    if (live.length) {
      const st = await gg.liveState(live.map(g => g.id));
      Object.keys(st).forEach(k => { liveState[k] = st[k]; });
    }
    drawLive();
    feed = gg.feed({ now: NOW, exclude: live, batch: PAGE });
    try {
      await page();
      $('gmGroups').removeAttribute('aria-busy');
    } catch (e) { feed = null; return failed(e); }
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
