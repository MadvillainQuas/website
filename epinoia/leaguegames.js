'use strict';
/* ============================================================================
   A LEAGUE'S FRONT PAGE - GAMES (Louie, 2026-10-15): "2 rows of 4 game cards in the style of home Daily fixtures where it
   has the button for live, upcoming and results (and a 'show all games' button that directs the user to the fixtures
   page for that league)". The first group of the page (index.html #lgGamesSec), under the MAIN | VIDEO strip.

   THE TABS are HOME's (home/daily.js): LIVE only while one of the league's games is live - and then the tab a visit opens
   on -, UPCOMING (the next eight by tip-off), RESULTS (the last eight, newest first). The reader's pick is kept for the
   visit (sessionStorage). The cards are HOME's (globalgames.js card), the league's own, so no league badge on them; on a
   desktop two rows of four, on a phone HOME's sideways strip. SHOW ALL GAMES is the league's fixtures page.

   THE READS are globalgames.js's, scoped to this league (scoped({ only })): the live games, the next eight scheduled from
   two hours ago, the last eight finals - each one small. Kept fresh every 15 s while a game is live and every minute
   otherwise, not while the tab is hidden; the cards are only drawn again when the games or their scores change.

     EpinoiaLeagueGames.mount({ league: { id, slug, name } })     index.html carries the markup; home.js calls this once
                                                                  it knows the league
   ============================================================================ */
(function (root) {
  const N = 8, LIVE_MS = 15000, IDLE_MS = 60000, STALE_MS = 2 * 3600 * 1000;
  const KEY = 'epinoia_league_fixtures';
  const $ = s => document.querySelector(s);
  let league = null, G = null, mode = null, chosen = null, timer = null, lastKey = null, data = null, busy = false;
  try { const v = sessionStorage.getItem(KEY); if (v === 'live' || v === 'up' || v === 'res') chosen = v; } catch (_) { /* private mode */ }

  const host = () => $('#lgGames');
  const seg = () => $('#lgFxSeg');
  const tab = k => seg() && seg().querySelector('[data-fx="' + k + '"]');

  async function read() {
    const now = Date.now();
    const [live, up, res] = await Promise.all([
      G.live().catch(() => []),
      G.upcoming(new Date(now - STALE_MS).toISOString(), N).catch(() => []),
      G.recent(new Date(now).toISOString(), 0, N).catch(() => [])
    ]);
    const liveRows = (Array.isArray(live) ? live : (live && live.rows) || []);
    const ids = liveRows.map(g => g.id);
    const state = ids.length && G.liveState ? await G.liveState(ids).catch(() => ({})) : {};
    const list = v => (Array.isArray(v) ? v : (v && v.rows) || []);
    return { now, live: liveRows, up: list(up).filter(g => !ids.includes(g.id)).slice(0, N), res: list(res).slice(0, N), state: state || {} };
  }

  /* the tab: the reader's pick of this visit; else LIVE while anything is, UPCOMING, and RESULTS when nothing is to come */
  function decide(d) {
    if (chosen && (chosen !== 'live' || d.live.length)) return chosen;
    if (d.live.length) return 'live';
    return d.up.length || !d.res.length ? 'up' : 'res';
  }
  function paintTabs(d) {
    const lt = tab('live');
    if (lt) {
      lt.hidden = !d.live.length;
      const n = lt.querySelector('.fx-n');
      if (n) n.textContent = String(d.live.length);
    }
    ['live', 'up', 'res'].forEach(k => {
      const b = tab(k);
      if (!b) return;
      const on = k === mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const h = host();
    if (h) h.setAttribute('aria-labelledby', (tab(mode) || {}).id || '');
  }
  function draw(force) {
    const h = host();
    if (!h || !data) return;
    const rows = data[mode] || [];
    const key = mode + '|' + rows.map(g => g.id + ':' + g.status + ':' + g.home_score + ':' + g.away_score + ':' +
      JSON.stringify(data.state[g.id] || null)).join(',');
    paintTabs(data);
    h.setAttribute('aria-busy', 'false');
    if (key === lastKey && !force) return;
    lastKey = key;
    h.textContent = '';
    if (!rows.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = mode === 'live' ? 'Nothing is live just now.' : mode === 'res' ? 'No results yet this season.' : 'No games to come yet.';
      h.appendChild(e);
      return;
    }
    const rail = document.createElement('div');
    rail.className = 'fxc-rail';
    rail.setAttribute('role', 'list');
    rows.slice(0, N).forEach(g => {
      const c = G.card(g, { base: '', now: data.now, state: data.state[g.id], badge: false });
      c.setAttribute('role', 'listitem');
      rail.appendChild(c);
    });
    h.appendChild(rail);
    if (G.wireBadges) G.wireBadges(rail);
    if (G.tickClocks) G.tickClocks(rail);
  }
  async function tick() {
    clearTimeout(timer); timer = null;
    if (busy) return;
    if (document.visibilityState === 'hidden') { timer = setTimeout(tick, IDLE_MS); return; }
    busy = true;
    try {
      data = await read();
      const was = mode;
      mode = decide(data);
      draw(mode !== was);
    } catch (e) {
      const h = host();
      if (h && !data) { h.textContent = ''; const x = document.createElement('div'); x.className = 'empty'; x.textContent = 'The games could not be read just now.'; h.appendChild(x); h.setAttribute('aria-busy', 'false'); }
      if (typeof console !== 'undefined') console.warn('[league games]', e);
    } finally {
      busy = false;
      timer = setTimeout(tick, data && data.live.length ? LIVE_MS : IDLE_MS);
    }
  }

  function mount(o) {
    const GG = root.EpinoiaGlobalGames;
    league = o && o.league;
    if (!GG || !league || !league.id || !host()) return false;
    G = GG.scoped ? GG.scoped({ only: [league.id] }) : GG;
    const all = $('#lgGamesAll');
    if (all && league.slug) all.href = 'fixtures/?l=' + encodeURIComponent(league.slug);
    const s = seg();
    if (s) {
      s.addEventListener('click', e => {
        const b = e.target && e.target.closest ? e.target.closest('[data-fx]') : null;
        if (!b || b.hidden || b.dataset.fx === mode) return;
        mode = chosen = b.dataset.fx;
        try { sessionStorage.setItem(KEY, chosen); } catch (_) { /* for this visit */ }
        draw(true);
      });
      /* the arrow keys move along the tabs, as a tab list's do */
      s.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const shown = ['live', 'up', 'res'].map(tab).filter(b => b && !b.hidden);
        const i = shown.findIndex(b => b.dataset.fx === mode);
        const n = shown[(i + (e.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
        if (!n) return;
        n.focus(); n.click();
      });
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    tick();
    return true;
  }
  root.EpinoiaLeagueGames = { mount, N };
})(typeof window !== 'undefined' ? window : globalThis);
