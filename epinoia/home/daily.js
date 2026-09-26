'use strict';
/* ============================================================================
   HOME — DAILY FIXTURES (roadmap Phase 2), section 'fixtures'.

   Eight cards: every live game, then each league's next game when it is
   within a fortnight, then the rest by tip-off (EpinoiaGlobalGames.pickDaily).
   WHAT THE READER FOLLOWS COMES FIRST: with several games live, those in a league or of a club they follow are
   pulled to the front (all of them), and the next game of each league and club they follow takes a card before
   anybody else's does (follow.js: fan_prefs, signed in; nothing followed is everybody's order).
   Without the per-league rule the busiest league takes almost every slot and a
   league whose season starts in ten days never appears on the front door.

   THREE READS IN PARALLEL: the live games; the forty scheduled games from two
   hours ago onwards (kept between ticks until one tips off); and every league's
   next game in one read (EpinoiaGlobalGames.nextAll, 0152's view), which was one
   query per league until 2026-09-24: 26 of them, two seconds before a card.

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

  /* lastKey starts null, not '': an empty day's key is '', and a first successful read after
     a failed launch must still replace front.js's error message with the "no games" one */
  let host = null, base = '../', timer = null, rt = null, lastKey = null, busy = false;

  /* UPCOMING (the live games and what is next) or RESULTS (the most recent finals): the reader's choice for this
     visit. Results are read newest first, forty of them, and no league takes more than three of the eight cards, so
     a busy night in one league does not push every other league off the front door. */
  const MODE_KEY = 'epinoia_home_fixtures';
  const PER_LEAGUE = 3;
  let mode = 'up';
  try { if (sessionStorage.getItem(MODE_KEY) === 'res') mode = 'res'; } catch (_) { /* private mode */ }

  function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }

  /* THE FORTY UPCOMING GAMES CHANGE WHEN ONE TIPS OFF, not every thirty seconds: a
     game going live is the live read's business. So they are kept between ticks
     and read again once the first of them has tipped, or after two minutes (a
     fixture the ingest has just added, or one moved). */
  const UP_MS = 2 * 60 * 1000;
  let upHeld = null;
  function upcoming(G, now) {
    const first = upHeld && upHeld.rows[0];
    const tipped = first && Date.parse(first.tipoff_at || '') <= now;
    if (upHeld && !tipped && now - upHeld.at < UP_MS) return Promise.resolve(upHeld.rows);
    const from = new Date(now - G.STALE_MS).toISOString();
    return G.upcoming(from, 40).then(rows => { upHeld = { at: now, rows }; return rows; });
  }

  /* each league's next game: one read for all of them (nextAll), or, where the
     database does not have its view yet, league by league as before */
  async function nextGames(G) {
    const m = typeof G.nextAll === 'function' ? await G.nextAll().catch(() => null) : null;
    if (m) return Array.from(m.values());
    const lgs = await G.leagues().catch(() => []);
    return Promise.all(lgs.map(l => G.nextFor(l.id).catch(() => null)));
  }

  /* the results: finals before now, newest first, a few from each league */
  const RES_MS = 60 * 1000;
  let resHeld = null;
  async function results(G, now) {
    if (!resHeld || now - resHeld.at > RES_MS) {
      const rows = await G.recent(new Date(now).toISOString(), 0, 40);
      resHeld = { at: now, rows };
    }
    const per = new Map(), out = [];
    resHeld.rows.forEach(g => {
      if (out.length >= N || g.status !== 'final') return;
      const l = G.leagueOf ? G.leagueOf(g) : null;
      const k = l ? l.id : '';
      if ((per.get(k) || 0) >= PER_LEAGUE) return;
      per.set(k, (per.get(k) || 0) + 1);
      out.push(g);
    });
    return out;
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

  async function read() {
    const G = window.EpinoiaGlobalGames;
    if (!G) throw new Error('globalgames.js has not loaded');
    const now = Date.now();
    if (mode === 'res') return { rows: await results(G, now), state: {}, now, mode };
    const [live, up, nexts, fol] = await Promise.all([
      G.live().catch(() => []),
      upcoming(G, now),
      nextGames(G),
      followed()
    ]);
    const rows = G.pickDaily(live, up, nexts, now, N, fol);
    const liveIds = rows.filter(g => g.status === 'live').map(g => g.id);
    const state = liveIds.length ? await G.liveState(liveIds) : {};
    return { rows, state, now, mode };
  }

  function keyOf(rows, state) {
    return mode + '>' + rows.map(g => {
      const s = state[g.id] || {};
      /* the clock is in the key too, so a stopped clock that moved (a timeout ended, a new quarter) redraws the card */
      return [g.id, g.status, g.tipoff_at, g.home_score, g.away_score, s.period, s.score_home, s.score_away, s.clock_ms, s.running, s.break_ms].join(':');
    }).join('|');
  }

  function draw(data, first) {
    const G = window.EpinoiaGlobalGames;
    const key = keyOf(data.rows, data.state);
    if (key === lastKey && !first) return;
    lastKey = key;

    if (!data.rows.length) {
      host.textContent = '';
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = data.mode === 'res' ? 'No results yet. The full list is on the fixtures page.'
        : 'No games in the next few days. The full list is on the fixtures page.';
      host.appendChild(d);
      if (first) H.fadeIn(d);
      return;
    }

    /* the old rail's scroll position survives a redraw */
    const old = host.querySelector('.fxc-rail');
    const left = old ? old.scrollLeft : 0;
    const rail = document.createElement('div');
    rail.className = 'fxc-rail';
    rail.setAttribute('role', 'list');
    data.rows.forEach(g => {
      const c = G.card(g, { base, now: data.now, state: data.state[g.id] });
      c.setAttribute('role', 'listitem');
      rail.appendChild(c);
    });
    host.textContent = '';
    host.appendChild(rail);
    if (left) rail.scrollLeft = left;
    if (first) H.fadeIn(rail);
  }

  function anyLive() { return !!(host && host.querySelector('.fxc.is-live')); }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay != null ? delay : (anyLive() ? LIVE_MS : IDLE_MS));
  }

  async function refresh() {
    if (busy) return schedule();
    /* a tab nobody is looking at does not poll; it catches up when it is shown again */
    if (hidden()) return schedule();
    busy = true;
    try { draw(await read(), false); }
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

  /* the two buttons: the chosen one is pressed; choosing the other reads and draws it at once */
  function wireSeg() {
    /* a page without the buttons (or a stand-in document) just has the one view */
    const seg = typeof document.getElementById === 'function' ? document.getElementById('fxSeg') : null;
    if (!seg) return;
    const paint = () => seg.querySelectorAll('button[data-fx]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.fx === mode)));
    paint();
    seg.addEventListener('click', async e => {
      const b = e.target.closest && e.target.closest('button[data-fx]');
      if (!b || b.dataset.fx === mode) return;
      mode = b.dataset.fx;
      try { sessionStorage.setItem(MODE_KEY, mode); } catch (_) { /* private mode */ }
      paint();
      clearTimeout(timer);
      host.setAttribute('aria-busy', 'true');
      try { const d = await read(); if (d.mode === mode) { lastKey = null; draw(d, true); } }
      catch (_) { /* what is on screen stays; the next tick tries again */ }
      finally { host.removeAttribute('aria-busy'); schedule(); }
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
    try { draw(await read(), true); }
    finally { busy = false; schedule(); }
  });
})();
