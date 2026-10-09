'use strict';
/* ============================================================================
   MANAGER - WATCHING A GAME (#/live/<round>, and the LIVE panel on the club's home).

   Louie, 2026-10-09: "an ability to 'watch' the game live on the time of game on the home screen via the play-by-play
   simming through the game (which has no effect on the actual sim ability/actual game)". The game is played at tip-off
   (core/season.js: from TIP_UTC on its day) and its play-by-play kept; WATCHING is that play-by-play shown along a
   broadcast's clock - the quarters at the game clock's own pace, two minutes between quarters, five at half-time, two
   before each overtime - so at 19:20 a reader sees the game as it stands twenty minutes in. Nothing here plays anything:
   the result was settled at tip-off, whoever watches.
   THE CHOICE (Louie: "please hide from other screens until the game is finished if the user opts to watch"): once the
   game is on, the club's home asks - watch it live, or the result now - and shows nothing of the score until the
   reader says. Watching, the round stays out of every other screen (the table, the fixtures, the statistics, the
   club and player pages, the leaderboards' record: app.js view) until the broadcast ends or they skip to the end; the
   result chosen, or the broadcast over, it is everywhere at once. A game already over can be watched again from its
   page (?replay=1), at any speed.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const SE = () => Mgr.season;
const BREAK = { quarter: 120, half: 300, ot: 120 };

/* THE BROADCAST'S CLOCK: real seconds since tip-off -> the game's seconds (and whether it is a break) */
function plan(L, ot) {
  const T = L.T || 2400, Tot = L.Tot || 300, q = T / 4, parts = [];
  let r = 0;
  for (let i = 0; i < 4; i++) {
    parts.push({ g0: i * q, g1: (i + 1) * q, r0: r, label: 'Q' + (i + 1) });
    r += q;
    if (i < 3) { parts.push({ brk: i === 1 ? 'Half-time' : 'End of Q' + (i + 1), g: (i + 1) * q, r0: r, r1: r + (i === 1 ? BREAK.half : BREAK.quarter) }); r += i === 1 ? BREAK.half : BREAK.quarter; }
  }
  for (let o = 0; o < ot; o++) {
    parts.push({ brk: 'End of regulation' + (o ? ', overtime ' + o : ''), g: T + o * Tot, r0: r, r1: r + BREAK.ot }); r += BREAK.ot;
    parts.push({ g0: T + o * Tot, g1: T + (o + 1) * Tot, r0: r, label: 'OT' + (o ? o + 1 : '') }); r += Tot;
  }
  return { parts, end: r };
}
function at(P, sec) {
  if (sec >= P.end) return { g: Infinity, label: 'Final', clock: '', final: true };
  for (const p of P.parts) {
    if (p.brk && sec >= p.r0 && sec < p.r1) return { g: p.g, label: p.brk, clock: Math.ceil((p.r1 - sec) / 60) + ' min', brk: true };
    if (!p.brk && sec >= p.r0 && sec < p.r0 + (p.g1 - p.g0)) { const g = p.g0 + (sec - p.r0), left = p.g1 - g; return { g, label: p.label, clock: Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0') }; }
  }
  return { g: 0, label: 'Q1', clock: '' };
}
A.broadcast = { plan, at };

/* the reader's game being played now: its round, its tip-off, its broadcast's end, and the reader's choice ('' not yet,
   'watch'); a game whose result they chose, or whose broadcast is over, is not live */
const tipOf = d => SE().dueAt(d).getTime();
const choiceKey = r => 'mgr_watch_' + A.club.id + '_' + r;
A.choice = r => A.stored(choiceKey(r)) || '';
A.liveRound = () => {
  const S = A.club && A.club.state;
  if (!S || !A.lg) return null;
  const now = Date.now();
  for (const f of S.fixtures) {
    if (!(f.h === 0 || f.a === 0) || !f.res) continue;
    const tip = tipOf(f.d), P = plan(A.lg.sim, f.res[2] || 0), end = tip + P.end * 1000, c = A.choice(f.r);
    if (now >= tip && now < end && c !== 'seen') return { r: f.r, f, tip, end, P, choice: c };
  }
  return null;
};
A.watch = r => { A.store(choiceKey(r), 'watch'); };
/* the result shown: everywhere at once, and the leaderboards' record with it */
A.reveal = r => { A.store(choiceKey(r), 'seen'); if (A.saveSeason) A.saveSeason().catch(() => {}); };

/* what a game looks like at a moment of it: the score, the last plays, the men's lines so far */
function upTo(ev, g) {
  const sc = [0, 0], lines = [new Map(), new Map()], last = [];
  const L = (s, id) => { if (!id) return null; if (!lines[s].has(id)) lines[s].set(id, { id, pts: 0, reb: 0, ast: 0 }); return lines[s].get(id); };
  ev.forEach(e => {
    if (e.t > g) return;
    if (e.k === 'S' && e.m) { const v = e.z === 2 ? 3 : 2; sc[e.s] += v; const x = L(e.s, e.p); if (x) x.pts += v; const a = L(e.s, e.a); if (a) a.ast++; }
    if (e.k === 'F' && e.m) { sc[e.s] += e.m; const x = L(e.s, e.p); if (x) x.pts += e.m; }
    if (e.k === 'X') sc[e.s] += 1;
    if (e.k === 'O' || e.k === 'D') { const x = L(e.s, e.p); if (x) x.reb++; }
    if (e.k !== 'P' && e.k !== 'Q') last.push(e);
  });
  return { sc, lines, last: last.slice(-12).reverse() };
}

/* ------------------------------------------------------------------ the panel on the club's home --- */
A.livePanel = host => {
  const lv = A.liveRound();
  if (!lv) return null;
  const S = A.club.state, ev = S.pbp && S.pbp[lv.r] ? SE().decodeEvents(S, S.pbp[lv.r].e) : [];
  const clubs = [lv.f.h, lv.f.a];
  /* not chosen yet: the two clubs, no score, and the choice */
  if (lv.choice !== 'watch') {
    const ask = h('div.mg-panel.glow', { style: { marginBottom: '16px' } },
      h('div.mg-row.between', h('span.mg-chip', { style: { color: '#fff', background: '#e0455c', borderColor: '#e0455c' } }, '● LIVE NOW'), h('span.mg-sub', 'Round ' + lv.r)),
      h('div.mg-next', { style: { marginTop: '8px' } }, h('div.side', A.crest(clubs[0], 54), A.clubLink(clubs[0])), h('div.vs', h('span.big', 'v')), h('div.side', A.crest(clubs[1], 54), A.clubLink(clubs[1]))),
      h('p.mg-sub', { style: { textAlign: 'center' } }, 'Your game has tipped off. Watch it as it happens (the result stays hidden everywhere else until it ends), or see the result now.'),
      h('div.mg-row', { style: { justifyContent: 'center' } },
        h('button.mg-btn.primary.big', { type: 'button', onclick: () => { A.watch(lv.r); A.route_(); } }, 'Watch it live'),
        h('button.mg-btn', { type: 'button', onclick: () => { A.reveal(lv.r); A.route_(); } }, 'Show me the result')));
    host.appendChild(ask);
    return ask;
  }
  const score = h('span.big', '0 – 0'), clock = h('span.mg-cap'), play = h('span.mg-sub');
  const panel = h('div.mg-panel.glow', { style: { marginBottom: '16px' } },
    h('div.mg-row.between', h('span.mg-chip.bad', { style: { color: '#fff', background: '#e0455c', borderColor: '#e0455c' } }, '● LIVE'),
      h('span.mg-row', h('a.mg-btn.primary', { href: '#/live/' + lv.r }, 'Full view'), h('button.mg-btn', { type: 'button', onclick: () => { A.reveal(lv.r); A.route_(); } }, 'Skip to the result'))),
    h('div.mg-next', { style: { marginTop: '8px' } }, h('div.side', A.crest(clubs[0], 54), A.clubLink(clubs[0])), h('div.vs', clock, score, play), h('div.side', A.crest(clubs[1], 54), A.clubLink(clubs[1]))));
  const tick = () => {
    if (!panel.isConnected) return;
    const sec = (Date.now() - lv.tip) / 1000, c = at(lv.P, sec);
    if (c.final) { A.reveal(lv.r); panel.remove(); A.route_(); return; }
    const u = upTo(ev, c.g);
    score.textContent = u.sc[0] + ' – ' + u.sc[1];
    clock.textContent = c.label + (c.clock ? ' · ' + c.clock : '');
    play.textContent = u.last[0] ? plain(u.last[0]) : 'Tip-off';
    setTimeout(tick, 1000);
  };
  host.appendChild(panel);
  tick();
  return panel;
};
const who = id => (id == null ? '' : String(id).startsWith('fill:') ? 'a reserve' : A.nameOf(id));
function plain(e) {
  switch (e.k) {
    case 'S': return who(e.p) + (e.m ? (e.z === 2 ? ' makes a three' : e.z === 0 ? ' scores at the rim' : ' scores') : ' misses') + (e.b ? ', blocked by ' + who(e.b) : '');
    case 'F': return who(e.p) + ' ' + e.m + ' of ' + e.n + ' at the line';
    case 'T': return who(e.p) + ' turns it over' + (e.st ? ', ' + who(e.st) + ' steals' : '');
    case 'O': return who(e.p) + ' offensive rebound';
    case 'D': return who(e.p) + ' rebound';
    case 'f': return 'Foul on ' + who(e.p);
    default: return '';
  }
}

/* ------------------------------------------------------------------ the full view --- */
function render(host, args) {
  const S = A.club.state, r = +args[0], f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
  const replay = A.route.q && A.route.q.get('replay') === '1';
  if (!f || !f.res || !S.pbp || !S.pbp[r]) { host.appendChild(h('div.mg-panel', 'This game has not been played yet: it goes live at tip-off.')); return; }
  const ev = SE().decodeEvents(S, S.pbp[r].e), P = plan(A.lg.sim, f.res[2] || 0), clubs = [f.h, f.a];
  if (!replay && A.choice(r) !== 'seen') A.watch(r);
  const tip = tipOf(f.d), started = Date.now();
  let speed = 1, viewSec = replay ? 0 : Math.max(0, (Date.now() - tip) / 1000), lastT = performance.now(), stopped = false;
  const score = h('span.big', { style: { fontSize: '44px' } }, '0 – 0'), clock = h('span.mg-cap', { style: { fontSize: '13px' } }), feed = h('ul.mg-news'), leaders = h('div.mg-grid.c2'), spark = h('div');
  host.appendChild(h('div.mg-panel.glow', h('div.mg-row.between', h('span.mg-chip', { style: replay ? {} : { color: '#fff', background: '#e0455c', borderColor: '#e0455c' } }, replay ? 'Replay' : '● LIVE'),
    h('span.mg-sub', 'Round ' + r)), h('div.mg-next', { style: { marginTop: '10px' } }, h('div.side', A.crest(clubs[0], 72), A.clubLink(clubs[0])), h('div.vs', clock, score),
    h('div.side', A.crest(clubs[1], 72), A.clubLink(clubs[1]))), spark));
  const ctrls = h('div.mg-row', { style: { margin: '14px 0' } });
  const speeds = h('div.mg-tabs', { role: 'group', 'aria-label': 'Speed' });
  [1, 2, 4, 10].forEach(x => speeds.appendChild(h('button', { type: 'button', 'aria-pressed': String(x === 1), onclick: ev2 => { speed = x; speeds.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === ev2.currentTarget))); } }, x + '×')));
  ctrls.appendChild(h('span.mg-sub', 'Speed')); ctrls.appendChild(speeds);
  ctrls.appendChild(h('button.mg-btn', { type: 'button', onclick: () => { A.reveal(r); stopped = true; A.go('/game/' + r); } }, 'Skip to the result'));
  host.appendChild(ctrls);
  host.appendChild(h('div.mg-grid.side', h('div.mg-panel', h('div.mg-h', h('h3', 'Play-by-play')), feed), h('div.mg-stack', h('div.mg-panel', h('div.mg-h', h('h3', 'Leading the way')), leaders))));
  const tick = () => {
    if (stopped || !host.isConnected) return;
    const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
    viewSec = Math.min(P.end, viewSec + dt * speed);
    /* live: never behind the broadcast (a reader who comes back later picks it up where it is); faster, ahead of it */
    if (!replay) viewSec = Math.max(viewSec, Math.min(P.end, (Date.now() - tip) / 1000));
    const c = at(P, viewSec), u = upTo(ev, c.g);
    score.textContent = u.sc[0] + ' – ' + u.sc[1];
    clock.textContent = c.final ? 'Final' + (f.res[2] ? ' (OT)' : '') : c.label + (c.clock ? ' · ' + c.clock : '');
    feed.textContent = '';
    u.last.forEach(e => {
      const k = Mgr.engine && e.s != null ? clubs[e.s] : null;
      feed.appendChild(h('li', h('span.t', A.broadcast.at(P, 0) && labelOf(e)), k != null ? A.crest(k, 18) : null, ' ', plain(e)));
    });
    leaders.textContent = '';
    [0, 1].forEach(s => {
      const top = [...u.lines[s].values()].sort((a, b) => b.pts - a.pts).slice(0, 3);
      leaders.appendChild(h('div', h('div.mg-row', A.crest(clubs[s], 20), A.clubLink(clubs[s])), top.map(x => h('div.mg-row.between', { style: { padding: '4px 0' } }, A.nm(who(x.id)), h('b', x.pts + ' pts · ' + x.reb + ' reb · ' + x.ast + ' ast')))));
    });
    spark.textContent = '';
    spark.appendChild(sparkline(ev, c.g, P));
    if (c.final) { A.reveal(r); stopped = true; host.appendChild(h('div.mg-row', { style: { justifyContent: 'center', marginTop: '10px' } }, h('a.mg-btn.primary.big', { href: '#/game/' + r }, 'The full box score'))); return; }
    setTimeout(tick, speed >= 4 ? 250 : 1000);
  };
  const labelOf = e => { const c = clockFromGame(e.t); return c; };
  const clockFromGame = g => { const T = A.lg.sim.T || 2400, q = T / 4; if (g < T) { const p = Math.min(3, Math.floor(g / q)); const left = (p + 1) * q - g; return 'Q' + (p + 1) + ' ' + Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0'); } return 'OT'; };
  void started;
  tick();
}
/* the margin so far, small */
function sparkline(ev, g, P) {
  const W = 600, H = 60, end = Math.max(1, ...ev.map(e => e.t));
  const sc = [0, 0], pts = [[0, 0]];
  ev.forEach(e => {
    if (e.t > g) return;
    const v = e.k === 'S' && e.m ? (e.z === 2 ? 3 : 2) : e.k === 'F' ? e.m : e.k === 'X' ? 1 : 0;
    if (v) { sc[e.s] += v; pts.push([e.t, sc[0] - sc[1]]); }
  });
  const max = Math.max(8, ...pts.map(p => Math.abs(p[1])));
  const ns = 'http://www.w3.org/2000/svg', svg = root.document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('aria-hidden', 'true');
  const path = root.document.createElementNS(ns, 'path');
  path.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + (W * p[0] / end).toFixed(1) + ' ' + (H / 2 - (H / 2 - 4) * p[1] / max).toFixed(1)).join(' '));
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'var(--mg-royal-3)'); path.setAttribute('stroke-width', '2');
  const mid = root.document.createElementNS(ns, 'line');
  mid.setAttribute('x1', '0'); mid.setAttribute('x2', String(W)); mid.setAttribute('y1', String(H / 2)); mid.setAttribute('y2', String(H / 2)); mid.setAttribute('stroke', 'currentColor'); mid.setAttribute('stroke-opacity', '.2');
  svg.appendChild(mid); svg.appendChild(path);
  void P;
  return svg;
}

A.views.live = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
