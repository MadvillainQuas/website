'use strict';
/* ============================================================================
   HOME — DAILY FIXTURES (roadmap Phase 2), section 'fixtures'.

   Eight cards: every live game, then each league's next game when it is
   within a fortnight, then the rest by tip-off (EpinoiaGlobalGames.pickDaily).
   Without the per-league rule the busiest league takes almost every slot and a
   league whose season starts in ten days never appears on the front door.

   THREE READS IN PARALLEL: the live games, the forty scheduled games from two
   hours ago onwards, and one "next game" per league (cached for the page, and
   asked again once that game's tip-off has passed).

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

  function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }

  async function read() {
    const G = window.EpinoiaGlobalGames;
    if (!G) throw new Error('globalgames.js has not loaded');
    const now = Date.now();
    const from = new Date(now - G.STALE_MS).toISOString();
    const [lgs, live, up] = await Promise.all([
      G.leagues().catch(() => []),
      G.live().catch(() => []),
      G.upcoming(from, 40)
    ]);
    const nexts = await Promise.all(lgs.map(l => G.nextFor(l.id).catch(() => null)));
    const rows = G.pickDaily(live, up, nexts, now, N);
    const liveIds = rows.filter(g => g.status === 'live').map(g => g.id);
    const state = liveIds.length ? await G.liveState(liveIds) : {};
    return { rows, state, now };
  }

  function keyOf(rows, state) {
    return rows.map(g => {
      const s = state[g.id] || {};
      return [g.id, g.status, g.tipoff_at, g.home_score, g.away_score, s.period, s.score_home, s.score_away].join(':');
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
      d.textContent = 'No games in the next few days. The full list is on the fixtures page.';
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

  H.register('fixtures', async function (ctx) {
    host = ctx.host;
    base = ctx.base || '../';
    /* THE REFRESH IS SET UP BEFORE THE FIRST READ CAN FAIL. A network blip at app launch
       rethrows (front.js shows its quiet empty state), but the poll, the live nudge and the
       return-to-foreground check still run, and draw() replaces that empty state the first
       time a read succeeds. lastKey stays null until then, so that first draw always paints. */
    listen();
    document.addEventListener('visibilitychange', () => { if (!hidden()) schedule(0); });
    busy = true;
    try { draw(await read(), true); }
    finally { busy = false; schedule(); }
  });
})();
