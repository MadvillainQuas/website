'use strict';
/* ============================================================================
   MANAGER - A GAME (#/game/<round>). Louie, 2026-10-09: "the traditional and modern box scores + full stats + events +
   lineups + game flow tabs", with "similar visuals/elements and same functionality as the epinoia equivalents".

   So it IS EPINOIA's game page: the game's play-by-play (core/engine.js pbp, kept for the reader's games by
   core/season.js) is turned into the scorer's own state (core/scorer.js: the event log epinoia/engine.js reads, every
   shot on the half court), handed to the game page in this tab's sessionStorage, and the page draws it with the code it
   draws every real game with (game/game.js ?mgr=1: the box score traditional and modern, the play-by-play with its
   linked plays and faces, shot charts, lineups, full stats, game flow, connections, play types, the shot clock) - inside
   this page, without the site's rail (&embed=1). The Manager's own head stays above it: the score, the replay.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;

/* the game as the scorer would have logged it */
function scorerState(r) {
  const S = A.club.state, f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
  if (!f || !f.res || !S.pbp || !S.pbp[r]) return null;
  const names = {};
  S.people.forEach(id => { const n = A.namedOf(id); names[id] = { name: n ? n.name : A.nameOf(id), num: n && n.jersey ? n.jersey : '' }; });
  const club = i => {
    const c = A.clubAt(i);
    if (c.me) {
      const b = Mgr.badge.sanitise(A.club.badge);
      return { name: c.name, short: c.name, colour: b.c1, logo_url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(Mgr.badge.svg(b, 128).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')) };
    }
    return { name: c.name, short: c.short, colour: c.colour, logo_path: c.logo };
  };
  return Mgr.scorer.toScorer(S, r, { names, clubs: [club(f.h), club(f.a)], G: Math.round((A.lg.sim.T || 2400) / 60),
    competition: A.lg.L.name + ' · Manager · round ' + r, tipoff: Mgr.season.dueAt(f.d).toISOString() });
}
A.scorerState = scorerState;

function render(host, args) {
  const S = A.club.state, r = +args[0], f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
  if (!f || !f.res) { host.appendChild(h('div.mg-panel', 'That game has not been played yet.')); return; }
  if (A.hiddenRound() === r) {
    host.appendChild(h('div.mg-panel.glow', h('h2', 'This game is on now'), h('p.mg-sub', 'Its box score opens when it ends, or when you choose to see the result.'),
      h('div.mg-row', h('a.mg-btn.primary', { href: '#/live/' + r }, 'Watch it live'), h('button.mg-btn', { type: 'button', onclick: () => { A.reveal(r); A.route_(); } }, 'Show me the result'))));
    return;
  }
  host.appendChild(h('div.mg-panel.glow', h('div.mg-next', h('div.side', A.crest(f.h, 64), A.clubLink(f.h)), h('div.vs', h('span.mg-cap', 'Round ' + r + ' · ' + new Date(f.d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })),
    h('span.big', f.res[0] + ' – ' + f.res[1]), f.res[2] ? h('span.mg-chip', f.res[2] > 1 ? f.res[2] + ' overtimes' : 'Overtime') : null), h('div.side', A.crest(f.a, 64), A.clubLink(f.a)))));
  const st = scorerState(r);
  if (!st) { host.appendChild(h('div.mg-panel', { style: { marginTop: '16px' } }, 'This game was played before its play-by-play was kept: its result and its players’ totals are in the season.')); return; }
  try { root.sessionStorage.setItem('mgr_game', JSON.stringify(st)); } catch (_) { host.appendChild(h('div.mg-panel', 'This browser would not hold the game for the box score.')); return; }
  host.appendChild(h('div.mg-row', { style: { justifyContent: 'center', margin: '12px 0' } }, h('a.mg-btn', { href: '#/live/' + r + '?replay=1' }, '▶ Watch the replay'),
    h('a.mg-btn.ghost', { href: '../game/?mgr=1&r=' + r, target: '_blank', rel: 'noopener' }, 'Open full screen ↗')));
  /* EPINOIA's game page, drawing this game; as tall as what it draws */
  const frame = h('iframe', { src: '../game/?mgr=1&embed=1&r=' + r + (A.route.q && A.route.q.get('tab') ? '&tab=' + encodeURIComponent(A.route.q.get('tab')) : ''), title: 'Box score',
    style: { width: '100%', border: '0', borderRadius: '16px', height: '900px', background: 'transparent', display: 'block' } });
  host.appendChild(h('div.mg-panel', { style: { padding: '0', overflow: 'hidden' } }, frame));
  /* the height of what it draws: the body's, not the document's (a document is never shorter than its frame, so a
     long tab would leave every shorter one with the long one's height) */
  let last = 0;
  const fit = () => {
    if (!frame.isConnected) return;
    try {
      /* from the moment the game page's own document is there (not when its last photo has loaded) */
      const d = frame.contentDocument, H = d && d.body && /\/game\/$/.test(d.location.pathname) ? Math.ceil(d.body.scrollHeight) : 0;
      if (H && Math.abs(H - last) > 4) { frame.style.height = Math.max(400, H) + 'px'; last = H; }
    } catch (_) { /* not ours to measure */ }
    setTimeout(fit, 400);
  };
  fit();
}

A.views.game = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
