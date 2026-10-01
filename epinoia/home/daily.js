'use strict';
/* ============================================================================
   HOME — DAILY FIXTURES (roadmap Phase 2), section 'fixtures'.

   THREE TABS: LIVE | UPCOMING | RESULTS (2026-10-01). Each holds one kind of game:
     LIVE      the games in progress (EpinoiaGlobalGames.pickLive: the overdue and stalled guard, followed first).
               The tab is only there while something is live; it slides in when the first game tips off, its badge
               counts the games, and it is the tab a visit opens on whenever anything is live.
     UPCOMING  the games not yet started (pickUpcoming): eight cards, each league's next game within a fortnight
               before the rest by tip-off, what the reader follows first (pickDaily's rules, unchanged).
     RESULTS   the finals, newest first, no league taking more than three of the first eight (pickResults).
   The reader's pick is kept for the visit (sessionStorage). The tab never moves by itself, with one exception: LIVE
   emptying while it is shown falls back to UPCOMING with a line saying why (EpinoiaGlobalGames.dailyTab). A game going
   live while the reader is on UPCOMING lights the LIVE tab and its count, and leaves the reader where they are.

   SHOW MORE: eight more cards a press, up to forty, then the button is the link to the fixtures page; SHOW LESS
   folds back to eight. New cards only ever go at the END (pickUpcoming / pickResults keep the first eight where they
   were), wipe in one after another, the list's height follows them, and focus goes to the first new card. On a phone
   the eight sit in the sideways strip as before; more than eight open into a grid two across. Under reduced motion
   all of it is instant. The reads grow only when a press needs more rows than the first page holds.

   WHAT THE READER FOLLOWS COMES FIRST: their leagues' and clubs' live games lead the LIVE tab, and the next game of
   each league and club they follow takes an UPCOMING card before anybody else's does (follow.js: fan_prefs, signed
   in; nothing followed is everybody's order).

   THE READS: the live games on every tick, whichever tab is shown (the LIVE tab's count is always current); the
   forty scheduled games from two hours ago onwards (kept between ticks until one tips off) and every league's next
   game in one read (EpinoiaGlobalGames.nextAll) for UPCOMING; forty finals for RESULTS.

   KEPT FRESH the way the league front page keeps its games (home.js
   watchGames): every 15 s while a game is live, every 30 s otherwise, and at
   once (with a scatter, so a thousand open pages do not ask in the same
   instant) when rt.js hears the scorer announce a status change on
   'epinoia:live'. The announcement is a nudge to look, never a fact to show.
   The rail is only rebuilt when WHICH games or their scores change, so a
   refresh never throws a reader's sideways scroll back to the start.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const LIVE_MS = 15000, IDLE_MS = 30000, N = 8;
  /* SHOW MORE: eight a press, forty at most (then the full fixtures page) */
  const STEP = 8, CAP = 40;
  /* LIVE shows its first 20, then SHOW MORE adds 20 at a time, with no cap: every live game is already in hand, so a
     press fetches nothing. UPCOMING and RESULTS keep their eight, then eight a press, to 40. */
  const LIVE_N = 20, LIVE_STEP = 20;
  const firstOf = m => (m === 'live' ? LIVE_N : N);
  const stepOf = m => (m === 'live' ? LIVE_STEP : STEP);
  const capOf = m => (m === 'live' ? Infinity : CAP);
  /* a page of a read: what the upcoming and the results reads ask for at a time */
  const PAGE = 40;

  /* lastKey starts null, not '': an empty day's key is '', and a first successful read after
     a failed launch must still replace front.js's error message with the "no games" one */
  let host = null, base = '../', timer = null, rt = null, lastKey = null, busy = false;
  let seg = null, say = null, lastData = null, liveCount = -1, fellNote = false;

  /* THE TAB: null until the first read decides it; the reader's own pick of this visit, if any */
  const MODE_KEY = 'epinoia_home_fixtures';
  const PER_LEAGUE = 3;
  let mode = null, chosen = null;
  try { const v = sessionStorage.getItem(MODE_KEY); if (v === 'live' || v === 'up' || v === 'res') chosen = v; } catch (_) { /* private mode */ }
  const limit = { live: LIVE_N, up: N, res: N };

  function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
  }

  /* THE FORTY UPCOMING GAMES CHANGE WHEN ONE TIPS OFF, not every thirty seconds: a
     game going live is the live read's business. So they are kept between ticks
     and read again once one of them has tipped off since they were read, or after
     two minutes (a fixture the ingest has just added, or one moved).
     MORE THAN A PAGE only when SHOW MORE needs it: the next page is read from the last tip-off held (a keyset, so a game
     going live between the two reads cannot shift an offset and skip one; the game on the seam comes back twice and is
     de-duplicated). */
  const UP_MS = 2 * 60 * 1000;
  let upHeld = null;
  async function upcoming(G, now, need) {
    /* since the read, not before it: the list starts two hours back, so its first game has often tipped off already,
       and a new read would bring the same list back */
    const tipped = upHeld && upHeld.rows.some(g => { const t = Date.parse(g.tipoff_at || ''); return t > upHeld.at && t <= now; });
    if (!upHeld || tipped || now - upHeld.at >= UP_MS) {
      const from = new Date(now - G.STALE_MS).toISOString();
      const rows = await G.upcoming(from, 40);
      upHeld = { at: now, rows, full: rows.length >= PAGE };
    }
    for (let pages = 0; upHeld.full && upHeld.rows.length < (need || 0) && pages < 3; pages++) {
      const last = upHeld.rows[upHeld.rows.length - 1];
      const part = await G.upcoming(last.tipoff_at, PAGE);
      const seen = new Set(upHeld.rows.map(g => g.id));
      const add = part.filter(g => !seen.has(g.id));
      upHeld = { at: upHeld.at, rows: upHeld.rows.concat(add), full: part.length >= PAGE && add.length > 0 };
    }
    return upHeld.rows;
  }

  /* each league's next game: one read for all of them (nextAll), or, where the
     database does not have its view yet, league by league as before */
  async function nextGames(G) {
    const m = typeof G.nextAll === 'function' ? await G.nextAll().catch(() => null) : null;
    if (m) return Array.from(m.values());
    const lgs = await G.leagues().catch(() => []);
    return Promise.all(lgs.map(l => G.nextFor(l.id).catch(() => null)));
  }

  /* the results: finals before now, newest first, forty at a time; the next forty (the same query, offset) only
     when SHOW MORE needs more rows than are held */
  const RES_MS = 60 * 1000;
  let resHeld = null;
  async function results(G, now, need) {
    if (!resHeld || now - resHeld.at > RES_MS) {
      const before = new Date(now).toISOString();
      const rows = await G.recent(new Date(now).toISOString(), 0, 40);
      resHeld = { at: now, before, rows, full: rows.length >= PAGE };
    }
    for (let pages = 0; resHeld.full && resHeld.rows.length < (need || 0) && pages < 3; pages++) {
      const part = await G.recent(resHeld.before, resHeld.rows.length, PAGE);
      const seen = new Set(resHeld.rows.map(g => g.id));
      resHeld = Object.assign({}, resHeld, { rows: resHeld.rows.concat(part.filter(g => !seen.has(g.id))), full: part.length >= PAGE });
    }
    return resHeld.rows;
  }

  /* WHAT THE READER FOLLOWS, through follow.js (never access.js: one read of the fan's row, shared with MY FOLLOWED
     and every bell). Signed out, nothing followed, or no follow.js: null, and the order is everybody's. */
  async function followed() {
    const F = window.EpinoiaFollow;
    if (!F || typeof F.load !== 'function') return null;
    try {
      const p = await F.load();
      if (!p) return null;
      return { leagues: p.fav_league_ids || [], teams: p.fav_team_ids || [] };
    } catch (_) { return null; }
  }

  /* ONE READ: the live games always (the LIVE tab's count), then what the tab shows. `cur` is the tab on screen when
     the read began (null before the first draw); the answer says which tab it drew for. `avail` is how many games
     the tab could show, read one past the shown ones, which is how SHOW MORE knows there is more. */
  /* SHOW MORE reads `quick`: the live games and the follows of the last read (seconds old, and the next tick reads them
     again), so a press waits only for rows it does not hold yet */
  let liveHeld = null;
  async function read(cur, quick) {
    const G = window.EpinoiaGlobalGames;
    if (!G) throw new Error('globalgames.js has not loaded');
    const now = Date.now();
    const [liveRaw, fol] = quick && liveHeld ? liveHeld
      : await Promise.all([G.live().catch(() => []), followed()]);
    liveHeld = [liveRaw, fol];
    const lives = G.pickLive(liveRaw, now, fol);
    const pick = G.dailyTab({ chosen, live: lives.length, current: cur });
    const tab = pick.tab;
    let rows, avail;
    if (tab === 'live') {
      rows = lives.slice(0, limit.live); avail = lives.length;
    } else if (tab === 'res') {
      const held = await results(G, now, limit.res + 1);
      const all = G.pickResults(held, N, limit.res + 1, PER_LEAGUE);
      rows = all.slice(0, limit.res); avail = all.length;
    } else {
      const [ups, nexts] = await Promise.all([upcoming(G, now, limit.up + 1), nextGames(G)]);
      const all = G.pickUpcoming(liveRaw, ups, nexts, now, N, limit.up + 1, fol);
      rows = all.slice(0, limit.up); avail = all.length;
    }
    const liveIds = rows.filter(g => g.status === 'live').map(g => g.id);
    const state = liveIds.length ? await G.liveState(liveIds) : {};
    return { rows, state, now, mode: tab, fell: pick.fell, live: lives.length, avail, limit: limit[tab] };
  }

  function keyOf(data) {
    return data.mode + '>' + (data.limit === Infinity ? 'all' : data.limit) + '>' + (data.avail > data.rows.length ? '+' : '') +
      (fellNote ? '!' : '') + '>' + data.rows.map(g => {
      const s = data.state[g.id] || {};
      /* the clock is in the key too, so a stopped clock that moved (a timeout ended, a new quarter) redraws the card */
      return [g.id, g.status, g.tipoff_at, g.home_score, g.away_score, s.period, s.score_home, s.score_away, s.clock_ms, s.running, s.break_ms].join(':');
    }).join('|');
  }

  /* ----------------------------------------------------------- the tabs ---
     role=tablist: the chosen tab aria-selected and the only one in the Tab order (the arrows move between them).
     LIVE is hidden while nothing is live (unless it is the tab shown); it slides in when it comes back, and its
     count is read out once each time it changes. */
  function paintTabs(live) {
    if (!seg) return;
    seg.querySelectorAll('button[data-fx]').forEach(b => {
      const on = b.dataset.fx === mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && host && b.id) host.setAttribute('aria-labelledby', b.id);
    });
    const lb = seg.querySelector('button[data-fx="live"]');
    if (!lb) return;
    const n = lb.querySelector('.fx-n');
    if (n) n.textContent = String(live);
    const show = live > 0 || mode === 'live';
    if (show && lb.hidden) {
      lb.hidden = false;
      /* the slide-in only when it appears on a page already drawn: the first paint is not news */
      if (liveCount >= 0 && !reduced()) {
        lb.classList.add('is-new');
        setTimeout(() => lb.classList.remove('is-new'), 900);
      }
    } else if (!show && !lb.hidden) lb.hidden = true;
    if (say && liveCount >= 0 && live !== liveCount) say.textContent = live ? live + ' live' : 'No games live';
    liveCount = live;
  }

  /* ------------------------------------------------------------ motion ---
     Web Animations, so nothing is left in a half state by a class: each animation is finished by a timer as well, in
     case the tab stops painting (an element must never be left invisible). Reduced motion: nothing moves. */
  function play(el, frames, opts) {
    if (reduced() || !el || typeof el.animate !== 'function') return null;
    const a = el.animate(frames, Object.assign({ easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }, opts));
    setTimeout(() => { try { a.finish(); } catch (_) { /* already gone */ } }, (opts.duration || 0) + (opts.delay || 0) + 250);
    return a;
  }
  function growFrom(h0) {
    if (h0 == null) return;
    const h1 = host.offsetHeight;
    if (Math.abs(h1 - h0) < 2) return;
    host.style.overflow = 'hidden';
    const a = play(host, [{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 380, fill: 'none' });
    const done = () => { host.style.overflow = ''; };
    if (a) a.onfinish = a.oncancel = done; else done();
  }
  function wipeIn(cards, from) {
    cards.slice(from).forEach((c, i) => play(c, [
      { opacity: 0, transform: 'translateY(10px)', clipPath: 'inset(0 0 100% 0)' },
      { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' }
    ], { duration: 340, delay: Math.min(i, 15) * 50 }));
  }

  /* ------------------------------------------------------------- drawing --- */
  function emptyText(m) {
    return m === 'res' ? 'No results yet. The full list is on the fixtures page.'
      : m === 'live' ? 'Nothing is live just now.'
      : 'No games in the next few days. The full list is on the fixtures page.';
  }

  function draw(data, first, opts) {
    const G = window.EpinoiaGlobalGames;
    const o = opts || {};
    lastData = data;
    const key = keyOf(data);
    if (key === lastKey && !first && !o.force) return;
    lastKey = key;

    if (!data.rows.length) {
      host.textContent = '';
      if (fellNote) host.appendChild(note());
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = emptyText(data.mode);
      host.appendChild(d);
      if (first) H.fadeIn(d);
      return;
    }

    /* MORE LIVE GAMES THAN THE RAIL HOLDS: split by league, one dropdown row each, the shape of MY FOLLOWED's rows */
    if (isSplit(data)) { drawSplit(G, data, first, o || {}); return; }

    /* the old rail's scroll position, and what had focus, survive a redraw */
    const old = host.querySelector('.fxc-rail');
    const left = old ? old.scrollLeft : 0;
    const act = typeof document.activeElement !== 'undefined' && document.activeElement && host.contains && host.contains(document.activeElement)
      ? (document.activeElement.getAttribute('data-act') || document.activeElement.getAttribute('href')) : null;
    const rail = document.createElement('div');
    rail.className = 'fxc-rail' + (data.rows.length > N ? ' is-open' : '');
    rail.id = 'fxList';
    rail.setAttribute('role', 'list');
    const cards = data.rows.map(g => {
      const c = G.card(g, { base, now: data.now, state: data.state[g.id] });
      c.setAttribute('role', 'listitem');
      rail.appendChild(c);
      return c;
    });
    host.textContent = '';
    if (fellNote) host.appendChild(note());
    host.appendChild(rail);
    const foot = moreBar(data);
    if (foot) host.appendChild(foot);
    if (left && data.rows.length <= N) rail.scrollLeft = left;
    if (first) H.fadeIn(rail);
    if (o.reveal != null) {
      wipeIn(cards, o.reveal);
      growFrom(o.h0);
      const c = cards[o.reveal];
      if (c && typeof c.focus === 'function') {
        c.focus({ preventScroll: true });
        /* the new cards start where the button was, often the bottom of the screen: bring the first of them into view */
        if (typeof c.scrollIntoView === 'function') c.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      }
    } else if (o.h0 != null) {
      growFrom(o.h0);
    } else if (act) {
      const back = Array.from(host.querySelectorAll('[data-act],a[href]')).find(e => (e.getAttribute('data-act') || e.getAttribute('href')) === act);
      if (back) back.focus({ preventScroll: true });
    }
  }

  function note() {
    const p = document.createElement('p');
    p.className = 'fx-note';
    p.setAttribute('role', 'status');
    p.textContent = 'Nothing is live just now, so here is what is next.';
    return p;
  }

  /* SHOW MORE / SHOW LESS / ALL FIXTURES under the cards. Nothing at all when the tab's first eight are all there is. */
  function moreBar(data) {
    const G = window.EpinoiaGlobalGames;
    const shown = data.rows.length, F = firstOf(data.mode);
    const step = G.moreStep(shown, data.avail, stepOf(data.mode), capOf(data.mode));
    const open = data.limit > F && shown > F;
    if (!step.more && !open) return null;
    const bar = document.createElement('div');
    bar.className = 'fx-more';
    if (step.more) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ep-btn fx-more-btn';
      b.setAttribute('data-act', 'more');
      b.setAttribute('aria-controls', 'fxList');
      b.setAttribute('aria-expanded', String(open));
      b.textContent = 'Show more';
      b.addEventListener('click', () => showMore(b));
      bar.appendChild(b);
    } else if (data.mode !== 'live') {
      const a = document.createElement('a');
      a.className = 'ep-btn fx-all';
      a.href = base + 'games/';
      a.textContent = 'all fixtures →';
      bar.appendChild(a);
    }
    if (open) {
      const l = document.createElement('button');
      l.type = 'button';
      l.className = 'ep-btn fx-less';
      l.setAttribute('data-act', 'less');
      l.setAttribute('aria-controls', 'fxList');
      l.setAttribute('aria-expanded', 'true');
      l.textContent = 'Show less';
      l.addEventListener('click', showLess);
      bar.appendChild(l);
    }
    return bar;
  }

  async function showMore(btn, tries) {
    /* a press during a background refresh waits for it (then presses the button that refresh drew), never lost */
    if (busy) {
      if ((tries || 0) < 40) setTimeout(() => showMore(host.querySelector('[data-act="more"]') || btn, (tries || 0) + 1), 120);
      return;
    }
    /* the cards on screen are another tab's while a switch is loading: their button is not this tab's */
    if (!lastData || lastData.mode !== mode || !btn || btn.disabled && !tries) return;
    const m = mode, G = window.EpinoiaGlobalGames;
    const shown = lastData.rows.length;
    limit[m] = G.moreStep(shown, lastData.avail, stepOf(m), capOf(m)).next;
    busy = true;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    clearTimeout(timer);
    const h0 = host.offsetHeight;
    try {
      const d = await read(m, true);
      if (mode === m && d.mode === m) { applyTab(d); draw(d, false, { force: true, reveal: Math.min(shown, d.rows.length), h0 }); }
    } catch (_) {
      limit[m] = shown;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    } finally { busy = false; schedule(); }
  }

  function showLess() {
    if (busy || !lastData) return;
    const m = mode;
    const h0 = host.offsetHeight;
    const F = firstOf(m);
    limit[m] = F;
    const d = Object.assign({}, lastData, { rows: lastData.rows.slice(0, F), limit: F, avail: Math.max(lastData.avail, lastData.rows.length) });
    draw(d, false, { force: true, h0 });
    const more = host.querySelector('[data-act="more"]');
    if (more) more.focus({ preventScroll: true });
    /* the top of the section back in view, if the long list had taken the reader past it */
    const sec = host.closest ? host.closest('section') : null;
    if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  /* THE LIVE GAMES BY LEAGUE. With more than eight live, one long rail says nothing about where they are, so above
     eight they are split into a row per league, in the order the games arrive (a followed league first), each row a
     dropdown like the ones in MY FOLLOWED (the league's badge, how many are live, a link to the league) open on that
     league's cards, which then need no badge of their own. Above 20 live, the first 20 are shown and SHOW MORE adds
     20 a press (all of them are already read, so it fetches nothing). What a reader shuts stays shut, and each row's sideways scroll stays put, across the redraws of a live night. */
  const shut = new Set();
  function isSplit(data) {
    return data.mode === 'live' && data.rows.length > N;
  }
  function drawSplit(G, data, first, o) {
    const groups = new Map();
    data.rows.forEach(g => {
      const l = G.leagueOf ? G.leagueOf(g) : null;
      const k = l && l.id != null ? String(l.id) : '';
      if (!groups.has(k)) groups.set(k, { key: k, league: l, games: [] });
      groups.get(k).games.push(g);
    });
    const lefts = new Map();
    host.querySelectorAll('.fxc-rail[data-lg]').forEach(r => lefts.set(r.getAttribute('data-lg'), r.scrollLeft));
    const wrap = document.createElement('div');
    wrap.className = 'fxc-groups';
    wrap.id = 'fxList';
    groups.forEach(gr => {
      const det = document.createElement('details');
      det.className = 'ep-acc hmf-acc fxc-lgrp';
      det.setAttribute('data-lg', gr.key);
      if (!shut.has(gr.key)) det.open = true;
      det.addEventListener('toggle', () => { if (det.open) shut.delete(gr.key); else shut.add(gr.key); });
      const sum = document.createElement('summary');
      const t = document.createElement('span');
      t.className = 't';
      if (gr.league && typeof window.epinoiaLeagueBadge === 'function') { t.innerHTML = window.epinoiaLeagueBadge(gr.league, { cls: 'lg' }); G.wireBadges(t); }
      else t.textContent = (gr.league && gr.league.name) || 'League';
      const n = document.createElement('span');
      n.className = 'hmf-n';
      n.textContent = gr.games.length + ' live';
      t.appendChild(n);
      sum.appendChild(t);
      if (gr.league && gr.league.slug) {
        const go = document.createElement('a');
        go.className = 'hmf-go';
        go.textContent = 'league →';
        go.href = base + '?l=' + encodeURIComponent(gr.league.slug);
        go.addEventListener('click', e => e.stopPropagation());       // inside a summary a click would toggle the row instead
        sum.appendChild(go);
      }
      det.appendChild(sum);
      const rail = document.createElement('div');
      rail.className = 'fxc-rail';
      rail.setAttribute('role', 'list');
      rail.setAttribute('data-lg', gr.key);
      gr.games.forEach(g => {
        const c = G.card(g, { base, now: data.now, state: data.state[g.id], badge: false });
        c.setAttribute('role', 'listitem');
        rail.appendChild(c);
      });
      det.appendChild(rail);
      wrap.appendChild(det);
      if (lefts.get(gr.key)) setTimeout(() => { rail.scrollLeft = lefts.get(gr.key); }, 0);
    });
    host.textContent = '';
    if (fellNote) host.appendChild(note());
    host.appendChild(wrap);
    /* above 20 live: SHOW MORE / SHOW LESS under the rows, the new cards revealed the way the rail's are */
    const foot = moreBar(data);
    if (foot) host.appendChild(foot);
    if (first) H.fadeIn(wrap);
    if (o.reveal != null) {
      const cards = Array.from(wrap.querySelectorAll('.fxc'));
      wipeIn(cards, o.reveal);
      growFrom(o.h0);
      const c = cards[o.reveal];
      if (c && typeof c.focus === 'function') c.focus({ preventScroll: true });
    } else if (o.h0 != null) {
      growFrom(o.h0);
    }
  }

  function anyLive() { return liveCount > 0 || !!(host && host.querySelector && host.querySelector('.fxc.is-live')); }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay != null ? delay : (anyLive() ? LIVE_MS : IDLE_MS));
  }

  /* what a read says about the tabs: LIVE emptying under the reader is the one move the page makes by itself */
  function applyTab(d) {
    /* the line goes once something is live again (the LIVE tab is back) or the reader picks a tab */
    if (d.fell) fellNote = true;
    else if (d.live > 0 || d.mode !== 'up') fellNote = false;
    mode = d.mode;
    paintTabs(d.live);
  }

  async function refresh() {
    if (busy) return schedule();
    /* a tab nobody is looking at does not poll; it catches up when it is shown again */
    if (hidden()) return schedule();
    busy = true;
    const cur = mode;
    try {
      const d = await read(cur);
      if (mode === cur) { applyTab(d); draw(d, false); }
    }
    catch (e) { /* a blip keeps what is on screen; the next tick tries again */ }
    finally { busy = false; schedule(); }
  }

  function listen() {
    if (rt || !window.EpinoiaRT || !window.EPINOIA_CONFIG) return;
    try {
      rt = window.EpinoiaRT.create({ url: window.EPINOIA_CONFIG.supabaseUrl, key: window.EPINOIA_CONFIG.supabaseAnonKey });
    } catch (_) { rt = null; }
    if (!rt) return;
    let soon = null;
    rt.watch('epinoia:live', () => {
      clearTimeout(soon);
      soon = setTimeout(() => schedule(0), 80 + Math.random() * 1200);
    });
  }

  /* the tabs: choosing one reads and draws it at once; the arrows, Home and End move between them (the tab pattern) */
  async function choose(fx) {
    if (fx === mode) return;
    mode = fx;
    chosen = fx;
    fellNote = false;
    try { sessionStorage.setItem(MODE_KEY, fx); } catch (_) { /* private mode */ }
    paintTabs(Math.max(0, liveCount));
    clearTimeout(timer);
    host.setAttribute('aria-busy', 'true');
    /* the old tab's cards stay until the new ones land, dimmed, and their SHOW MORE / LESS do nothing meanwhile */
    host.querySelectorAll('button[data-act]').forEach(b => { b.disabled = true; });
    try {
      const d = await read(fx);
      if (mode === fx) { applyTab(d); lastKey = null; draw(d, true); }
    }
    catch (_) { /* what is on screen stays; the next tick tries again */ }
    finally { host.removeAttribute('aria-busy'); schedule(); }
  }
  function wireSeg() {
    /* a page without the buttons (or a stand-in document) just has the one view */
    seg = typeof document.getElementById === 'function' ? document.getElementById('fxSeg') : null;
    say = typeof document.getElementById === 'function' ? document.getElementById('fxSay') : null;
    if (!seg) return;
    seg.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button[data-fx]');
      if (b) choose(b.dataset.fx);
    });
    seg.addEventListener('keydown', e => {
      const tabs = Array.from(seg.querySelectorAll('button[data-fx]')).filter(b => !b.hidden);
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      tabs[j].focus();
      choose(tabs[j].dataset.fx);
    });
  }

  H.register('fixtures', async function (ctx) {
    host = ctx.host;
    base = ctx.base || '../';
    wireSeg();
    /* THE REFRESH IS SET UP BEFORE THE FIRST READ CAN FAIL. A network blip at app launch
       rethrows (front.js shows its quiet empty state), but the poll, the live nudge and the
       return-to-foreground check still run, and draw() replaces that empty state the first
       time a read succeeds. lastKey stays null until then, so that first draw always paints. */
    listen();
    document.addEventListener('visibilitychange', () => { if (!hidden()) schedule(0); });
    /* a follow saved on this page (a bell, "Who's your favourite?") re-orders the cards at once */
    if (typeof window.addEventListener === 'function') window.addEventListener('epinoia:follows', () => schedule(0));
    busy = true;
    try { const d = await read(mode); applyTab(d); draw(d, true); }
    finally { busy = false; schedule(); }
  });
})();
