'use strict';
const E = window.CourtsideEngine, L = window.CourtsideLive;
const qp = new URLSearchParams(location.search);
const gameId = qp.get('g') || 'demo';
const mode   = qp.get('mode') === 'supabase' ? 'supabase' : 'local';

const $ = s => document.querySelector(s);
const txt = (el, v) => { if (el && el.textContent !== String(v)) el.textContent = v; };
/* user-supplied strings are never interpolated into HTML — see the security plan */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let game = null;                 // {teams, starters, …}
let events = [];                 // authoritative log
let derived = null;
let seenPbp = 0;
let statusVal = 'connecting';

/* ---------- rebuild every view from the event log ---------- */
function rebuild() {
  if (!game) return;
  const st = sub && sub.state;
  const g = Object.assign({}, game, {
    events,
    period:  st ? (st.period != null ? st.period : game.period) : game.period,
    clockMs: sub ? sub.clockMs() : game.clockMs
  });
  derived = E.deriveGame(g);
  paintBoard(g);
  paintQuarters();
  paintBox(g);
  paintTeam(g);
  paintPbp();
}

function paintBoard(g) {
  txt($('#nameA'), game.teams[0].name); txt($('#nameB'), game.teams[1].name);
  txt($('#scoreA'), derived.score[0]);  txt($('#scoreB'), derived.score[1]);
  txt($('#period'), E.perName(g.period).toUpperCase());
  $('#possA').className = derived.poss === 0 ? 'on' : '';
  $('#possB').className = derived.poss === 1 ? 'on' : '';
  document.documentElement.style.setProperty('--team-a', game.teams[0].color || '#93f2bf');
  document.documentElement.style.setProperty('--team-b', game.teams[1].color || '#8ff5ff');
  txt($('#ctx'), (game.competition || 'Friendly') + ' · ' + game.teams[0].name + ' v ' + game.teams[1].name);
  document.title = derived.score[0] + '–' + derived.score[1] + ' ' +
                   game.teams[0].name + ' v ' + game.teams[1].name + ' · Courtside';
}

function tickClock() {
  if (!sub || !sub.state) return;
  const ms = sub.clockMs();
  txt($('#clock'), E.fmtClock(ms));
}

function paintQuarters() {
  const maxP = Math.max(4, ...Object.keys(derived.perQ[0]).map(Number), ...Object.keys(derived.perQ[1]).map(Number), 1);
  let h = '';
  for (let p = 1; p <= maxP; p++) {
    h += '<div><div class="ql">' + esc(E.perName(p).toUpperCase()) + '</div>' +
         '<div class="qv a">' + (derived.perQ[0][p] || 0) + '</div>' +
         '<div class="qv b">' + (derived.perQ[1][p] || 0) + '</div></div>';
  }
  h += '<div><div class="ql">TOT</div><div class="qv a">' + derived.score[0] +
       '</div><div class="qv b">' + derived.score[1] + '</div></div>';
  $('#qstrip').innerHTML = h;
}

function paintBox(g) {
  const TA = [E.teamAdv(g, derived, 0), E.teamAdv(g, derived, 1)];
  let h = '';
  [0, 1].forEach(t => {
    const rows = game.teams[t].players.map(p => {
      const s = derived.stats[p.id]; if (!s) return '';
      const on = derived.onCourt[t].includes(p.id);
      const fg = (s.p2m + s.p3m) + '-' + (s.p2a + s.p3a);
      return '<tr' + (on ? ' class="on"' : '') + '><td>' + esc(p.num) + '</td><td>' + esc(p.name) + '</td>' +
        '<td>' + E.fmtMin(s.min) + '</td><td>' + s.pts + '</td><td>' + fg + '</td>' +
        '<td>' + s.p3m + '-' + s.p3a + '</td><td>' + s.ftm + '-' + s.fta + '</td>' +
        '<td>' + (s.or + s.dr) + '</td><td>' + s.ast + '</td><td>' + s.stl + '</td>' +
        '<td>' + s.blk + '</td><td>' + s.to + '</td><td>' + s.pf + '</td>' +
        '<td>' + (s.pm > 0 ? '+' : '') + s.pm + '</td></tr>';
    }).join('');
    const T = TA[t];
    h += '<div class="cs-hdr"><span class="idx">' + (t ? 'AWAY' : 'HOME') + '</span>' +
         '<h2 style="color:var(--team-' + (t ? 'b' : 'a') + ')">' + esc(game.teams[t].name) + '</h2></div>' +
         '<div class="cs-tw"><table class="cs-tbl"><thead><tr><th>#</th><th>PLAYER</th><th>MIN</th><th>PTS</th>' +
         '<th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>+/-</th></tr></thead>' +
         '<tbody>' + rows + '</tbody><tfoot><tr><td></td><td>TOTALS</td><td></td><td>' + T.pts + '</td>' +
         '<td>' + T.fgm + '-' + T.fga + '</td><td>' + T.fg3m + '-' + T.fg3a + '</td><td>' + T.ftm + '-' + T.fta + '</td>' +
         '<td>' + (T.oreb + T.dreb) + '</td><td>' + T.ast + '</td><td>' + T.stl + '</td><td>' + T.blk + '</td>' +
         '<td>' + T.tov + '</td><td>' + derived.team[t].foulTot + '</td><td></td></tr></tfoot></table></div>';
  });
  $('#pane-box').innerHTML = h;
}

function paintTeam(g) {
  const A = E.teamAdv(g, derived, 0), B = E.teamAdv(g, derived, 1);
  const row = (label, a, b, dp) => {
    const f = v => (dp === 0 ? Math.round(v) : v.toFixed(dp == null ? 1 : dp));
    const aw = a > b, bw = b > a;
    return '<div class="cs-mir"><span class="v a' + (aw ? ' w' : '') + '">' + f(a) + '</span>' +
      '<div><div class="cs-mb"><div class="h"><i style="width:' + Math.min(100, a / Math.max(a, b, 1) * 100) + '%"></i></div>' +
      '<div class="g"><i style="width:' + Math.min(100, b / Math.max(a, b, 1) * 100) + '%"></i></div></div>' +
      '<div class="cs-mlb">' + esc(label) + '</div></div>' +
      '<span class="v b' + (bw ? ' w' : '') + '">' + f(b) + '</span></div>';
  };
  $('#pane-team').innerHTML = '<div class="cs-band">' +
    row('OFF RATING', A.ortg, B.ortg) + row('EFG%', A.efg, B.efg) + row('TOV%', A.tovp, B.tovp) +
    row('OREB%', A.orebp, B.orebp) + row('FT RATE', A.ftr, B.ftr) + row('TS%', A.ts, B.ts) +
    row('AST / TO', A.astTo, B.astTo, 2) + row('PACE', A.pace, B.pace) +
    '</div>';
}

function paintPbp() {
  const rows = derived.pbp.slice().reverse();
  const frag = rows.map((e, i) => {
    const isNew = (rows.length - i) > seenPbp;
    return '<div class="pbprow' + (isNew && seenPbp ? ' new' : '') + '">' +
      '<span class="t">' + esc(E.perName(e.period).toUpperCase()) + ' ' + E.fmtClock(e.clock) + '</span>' +
      '<span class="x">' + esc(e.txt) + '</span>' +
      '<span class="s">' + e.s[0] + '–' + e.s[1] + '</span></div>';
  }).join('');
  $('#pbp').innerHTML = frag || '<div class="empty">No plays yet</div>';
  seenPbp = rows.length;
}

/* ---------- status ---------- */
function setStatus(s) {
  statusVal = s;
  const el = $('#status');
  const label = { live: 'live', delayed: 'delayed', offline: 'offline', connecting: 'connecting', final: 'final' }[s] || s;
  el.className = 'status ' + (s === 'connecting' ? 'offline' : s);
  txt($('#statusText'), label);
}

/* ---------- wire the live feed ---------- */
let sub = null;
function boot() {
  sub = L.subscriber({
    gameId, mode,
    supabase: window.__sb || null,
    onSnapshot(snap) {
      if (snap.game) game = snap.game;
      events = snap.events || [];
      if (!game) { $('#pane-box').innerHTML = '<div class="empty">Waiting for the game to start…</div>'; return; }
      seenPbp = 0;
      rebuild();
      if (game.status === 'final') setStatus('final');
    },
    onFrame(f) {
      if (f.game) game = f.game;
      if (f.events && f.events.length) {
        const seen = new Set(events.map(e => e.seq != null ? e.seq : e.id));
        f.events.forEach(e => { const k = e.seq != null ? e.seq : e.id; if (!seen.has(k)) events.push(e); });
      }
      rebuild();
      if (game && game.status === 'final') setStatus('final');
    },
    onStatus(s) { if (statusVal !== 'final') setStatus(s); }
  });
  setInterval(tickClock, 200);          // local tick: smooth, zero bandwidth
  txt($('#foot'), 'Courtside Network · transport: ' + (sub.transport || mode));
}

document.querySelectorAll('.cs-tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.cs-tab').forEach(x => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
  b.classList.add('on'); b.setAttribute('aria-selected', 'true');
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  document.getElementById('pane-' + b.dataset.p).classList.add('on');
}));

boot();
