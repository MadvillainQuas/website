'use strict';
/* ============================================================================
   THE FIXTURE STRIP AS HOME'S CARDS (Louie, 2026-10-07) - on a league's front page and a club's page, where the
   embedded strip (embed/strip/, the widget club websites carry) used to sit in a 129px frame.

   The cards are HOME's own (globalgames.js card): each club's tile in its colours, the score or the time, the venue,
   the where-to-watch pill (watch.js) and the who-wins strip hanging under each card (predict.js), whose middle opens
   the game at a glance (gamepeek.js). None of that could live in the frame: its cards, pop-ups and sign-in prompt
   would have been cut off at its edges. The widget itself is unchanged for the sites that embed it.

     EpinoiaCardStrip.mount(host, { league: slug, team: id, base: '../', n: 12 })   -> Promise; false when it cannot

   What it shows: the games being played, then the next ones soonest first, then the latest results newest first - the
   league's (league) or one club's (team, within its league when both are given). One row that scrolls sideways, read
   again every half a minute while the page is in view (a live score, a game going final).
   ============================================================================ */
(function (root) {
  const GG = () => root.EpinoiaGlobalGames;
  const HOUR = 3600 * 1000;

  async function read(o) {
    const G = GG();
    const f = (o.league ? '&competitions.seasons.leagues.slug=eq.' + encodeURIComponent(o.league) : '') +
              (o.team ? '&or=(home_team_id.eq.' + o.team + ',away_team_id.eq.' + o.team + ')' : '');
    const sel = 'games?select=' + G.SEL + f;
    const since = new Date(Date.now() - 2 * HOUR).toISOString();
    const n = Math.max(4, o.n || 12);
    const [live, next, done] = await Promise.all([
      G.request(sel + '&status=in.(live,finalising)&order=tipoff_at.asc&limit=12').catch(() => []),
      G.request(sel + '&status=eq.scheduled&tipoff_at=gte.' + since + '&order=tipoff_at.asc&limit=' + n).catch(() => []),
      G.request(sel + '&status=eq.final&order=tipoff_at.desc&limit=' + Math.ceil(n / 2)).catch(() => [])
    ]);
    const seen = new Set();
    return [].concat(live || [], next || [], done || []).filter(g => g && !seen.has(g.id) && seen.add(g.id));
  }

  async function draw(host, o, rail) {
    const G = GG();
    const gs = await read(o);
    if (!gs.length) { host.hidden = true; return false; }
    const liveIds = gs.filter(g => g.status === 'live').map(g => g.id);
    const state = liveIds.length && G.liveState ? await G.liveState(liveIds).catch(() => ({})) : {};
    const now = new Date();
    /* the same game keeps its card when nothing about it changed: the pick strip and an open pop-up stay put */
    const sig = g => [g.status, g.home_score, g.away_score, g.tipoff_at, JSON.stringify((state && state[g.id]) || null)].join('|');
    const keep = new Map([...rail.children].map(c => [c.getAttribute('data-game'), c]));
    const out = gs.map(g => {
      const old = keep.get(g.id);
      if (old && old.__sig === sig(g)) return old;
      const c = G.card(g, { base: o.base, now, state: state && state[g.id], badge: !o.league });
      c.__sig = sig(g);
      return c;
    });
    out.forEach((c, i) => { if (rail.children[i] !== c) rail.insertBefore(c, rail.children[i] || null); });
    while (rail.children.length > out.length) rail.lastElementChild.remove();
    host.hidden = false;
    return true;
  }

  async function mount(host, opt) {
    const o = Object.assign({ base: '../', n: 12 }, opt || {});
    if (!host || !GG() || !GG().card || !GG().request || !GG().SEL) return false;
    host.textContent = '';
    host.classList.add('cs');
    const rail = document.createElement('div');
    rail.className = 'fxc-rail cs-rail';
    rail.setAttribute('role', 'list');
    host.appendChild(rail);
    let ok = false;
    try { ok = await draw(host, o, rail); } catch (_) { ok = false; }
    if (!ok) return false;
    /* again every half a minute while the page is in view; at once when it comes back into view */
    const again = () => { if (!document.hidden) draw(host, o, rail).catch(() => { /* the cards stay as they were */ }); };
    setInterval(again, 30000);
    document.addEventListener('visibilitychange', again);
    return true;
  }

  root.EpinoiaCardStrip = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
