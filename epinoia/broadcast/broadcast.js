'use strict';
/* ============================================================================
   BROADCAST GRAPHICS — one state document, three ways to consume it.

   A production truck does not want a website. It wants either a transparent
   layer it can composite, or a JSON document it can poll into a template. Both
   are the same underlying thing, and the mistake to avoid is inventing a second
   version of the truth for the graphics to read: a scorebug that disagrees with
   the box score on air is worse than no scorebug.

   So this page derives everything from the same event log, through the same
   engine, over the same live transport as every other surface. What it adds is
   a stable, versioned SHAPE — because a graphics template is authored once
   against field names and then not touched for a season, and a renamed field
   is a black rectangle during a game.

   ------------------------------------------------------------ the three ways

   1. BROWSER SOURCE — OBS, vMix, CasparCG, Singular, vizrt's HTML engine.
      Point the source at this page. Transparent background, scenes chosen by
      URL, scales with the render size.

        /epinoia/broadcast/?g=<game-id>&scene=scorebug&pos=bl

   2. POLLED JSON — Vizrt, Chyron, Ross XPression, vMix data sources.
      The same document from an endpoint, on whatever interval the system
      likes. See supabase/functions/broadcast.

   3. IN-PAGE — a mixer that runs its own HTML can import this file and read
      window.EpinoiaBroadcast.state() directly, or listen for the
      'epinoia:state' event, which fires on every change.

   --------------------------------------------------------------- parameters

     g       the game id                      (required)
     scene   scorebug | lower | compare | final          default scorebug
     pos     bl br tl tr bc tc c              default bl
     side    0 | 1        which team a lower third is about
     pid     player id    for scene=lower; omit for the leading scorer
     home    #rrggbb      override the home colour
     away    #rrggbb      override the away colour
     chroma  #rrggbb      paint a key colour instead of transparency
     safe    0            turn off the title-safe padding
     scale   0.5 … 2      multiply everything
     debug   1            show a transport readout, off air only

   WHY THE CLOCK IS NOT SENT OVER THE WIRE EVERY SECOND. It ticks locally from
   the last state and the server's clock offset — the same trick every other
   surface uses. A graphic that redrew on a network frame would stutter at
   exactly the moment anybody is looking at it.
   ========================================================================= */
(function () {

const E = window.EpinoiaEngine, L = window.EpinoiaLive;
const qp = new URLSearchParams(location.search);
const CFG = window.EPINOIA_CONFIG || {};

const gameId = (qp.get('g') || qp.get('game') || '').trim();
const scene  = (qp.get('scene') || 'scorebug').toLowerCase();
const side   = qp.get('side') === '1' ? 1 : 0;
const wantPid = qp.get('pid') || null;
const scale  = Math.max(0.4, Math.min(2.5, parseFloat(qp.get('scale') || '1') || 1));

const stage = document.getElementById('stage');
const diag  = document.getElementById('diag');

/* ---- chrome ---------------------------------------------------------- */
/* Defaulted ONCE. Written as a test on (get('pos') || 'bl') with the value
   taken from get('pos') unguarded, this threw on every URL that omitted pos —
   at module level, so the whole file died and window.EpinoiaBroadcast never
   existed. On air that is a blank layer with no clue why. */
const POSITIONS = ['bl','br','tl','tr','bc','tc','c'];
const pos = String(qp.get('pos') || 'bl').toLowerCase();
stage.className = 'pos-' + (POSITIONS.includes(pos) ? pos : 'bl');
if (qp.get('safe') === '0') stage.classList.add('nosafe');
if (qp.get('debug') === '1') document.body.classList.add('debug');
const chroma = qp.get('chroma');
if (chroma) {
  document.documentElement.style.setProperty('--chroma', chroma);
  document.body.classList.add('chroma');
}
if (scale !== 1) document.documentElement.style.setProperty('--u', (scale) + 'vmin');
/* vmin units are read from the root font scale, so scaling the whole graphic
   is one multiplier rather than a rule per size. */
if (scale !== 1) stage.style.zoom = String(scale);

/* ---- data ------------------------------------------------------------ */
let S = null, game = null, sub = null, lastJSON = '';

const api = async path => {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, {
    cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0]);
  return r.json();
};

const rowToEvent = r => Object.assign(
  { id: r.seq, seq: r.seq, t: r.t, team: r.team, pid: r.pid,
    period: r.period, clock: r.clock }, r.payload || {});

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');


/* ---- the state document ---------------------------------------------- */
/* THIS SHAPE IS THE CONTRACT. Fields are added, never renamed or removed:
   somewhere there is a template authored against v1 that nobody will revisit
   until it breaks on air. `v` says which shape this is. */
function buildState() {
  if (!S || !game) return null;
  const d = S.events.length ? E.deriveGame(S) : null;
  const clockMs = sub ? sub.clockMs() : (S.clockMs || 0);
  const period  = (sub && sub.state && sub.state.period) || S.period || 1;

  const teamOf = t => {
    const T = d ? d.team[t] : null;
    const fouls = T && T.foulsP ? (T.foulsP[period > 4 ? 4 : period] || 0) : 0;
    return {
      name:  (S.teams[t] || {}).name || '',
      short: shortOf(t),
      colour: colourOf(t),
      score: d ? d.score[t] : (t === 0 ? game.home_score : game.away_score) || 0,
      periodFouls: fouls,
      bonus: fouls >= 5,
      timeoutsLeft: (d && E.timeoutsLeft) ? E.timeoutsLeft(S, d, t) : null,
      onCourt: d ? d.onCourt[t].map(pid => playerCard(t, pid, d)) : []
    };
  };

  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    game: {
      id: gameId,
      status: game.status,
      competition: compName(),
      venue: game.venue || null,
      attendance: game.attendance != null ? game.attendance : null
    },
    clock: {
      period,
      periodLabel: periodLabel(period),
      ms: clockMs,
      display: mmss(clockMs),
      running: !!(sub && sub.state && sub.state.running)
    },
    possessionArrow: (sub && sub.state && sub.state.arrow != null)
      ? sub.state.arrow : (S.arrowInit != null ? S.arrowInit : null),
    home: teamOf(0),
    away: teamOf(1),
    lastPlay: lastPlay(d)
  };
}

function playerCard(t, pid, d) {
  const p = (S.teams[t].players || []).find(x => x.id === pid) || {};
  const s = d.stats[pid] || {};
  return {
    id: pid, number: p.num || '', name: p.name || '',
    pts: s.pts || 0, reb: (s.or || 0) + (s.dr || 0), ast: s.ast || 0,
    stl: s.stl || 0, blk: s.blk || 0, pf: s.pf || 0,
    fg: (s.p2m || 0) + (s.p3m || 0) + '-' + ((s.p2a || 0) + (s.p3a || 0)),
    tp: (s.p3m || 0) + '-' + (s.p3a || 0),
    ft: (s.ftm || 0) + '-' + (s.fta || 0),
    min: Math.round((s.min || 0))
  };
}

function lastPlay(d) {
  if (!d || !d.pbp || !d.pbp.length) return null;
  const e = d.pbp[d.pbp.length - 1];
  return { text: e.txt || '', period: e.period, clock: mmss(e.clock) };
}

const shortOf = t => {
  const src = t === 0 ? game.home : game.away;
  return (src && (src.short_name || src.name)) ||
         ((S.teams[t] || {}).name || '').slice(0, 3).toUpperCase();
};
const colourOf = t => {
  const override = qp.get(t === 0 ? 'home' : 'away');
  if (override) return override;
  const src = t === 0 ? game.home : game.away;
  return (src && src.colour) || (S.teams[t] || {}).color || (t === 0 ? '#93f2bf' : '#8ff5ff');
};
const compName = () => {
  const c = game.competitions || {};
  const s = c.seasons || {}; const l = s.leagues || {};
  return [l.name, c.name].filter(Boolean).join(' · ') || null;
};
const periodLabel = p => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));

/* BROADCAST CONVENTION, WHICH IS NOT THE APP'S. Under a minute a scoreboard
   shows tenths, because the last thirty seconds is the only time anybody reads
   the clock precisely; above a minute it shows m:ss, because tenths ticking
   for nine minutes is visual noise on air. */
function mmss(ms) {
  const t = Math.max(0, ms || 0);
  if (t < 60000) return (Math.floor(t / 100) / 10).toFixed(1);
  const total = Math.floor(t / 1000);
  const m = Math.floor(total / 60), sec = total % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

/* ---- scenes ----------------------------------------------------------- */
const SCENES = {
  scorebug(st) {
    const dots = n => '<div class="dots">' +
      [1,2,3,4,5].map(i => '<span class="dot' + (i <= n ? ' on' : '') + '"></span>').join('') +
      '</div>';
    const tos = n => n == null ? '' : '<div class="tos">' +
      [1,2,3].map(i => '<span class="to' + (i <= n ? ' on' : '') + '"></span>').join('') + '</div>';
    const sideHTML = (T, t) =>
      '<div class="side" style="border-' + (t === 0 ? 'left' : 'right') +
        ':.5vmin solid ' + esc(T.colour) + '">' +
        (t === 0 ? '' : '<span class="sc">' + T.score + '</span>') +
        '<span class="tag">' + esc(T.short) + '</span>' +
        (t === 0 ? '<span class="sc">' + T.score + '</span>' : '') +
      '</div>';

    return '<div class="bug">' +
      sideHTML(st.home, 0) +
      '<div class="mid"><span class="clk">' + st.clock.display + '</span>' +
        '<span class="per">' + st.clock.periodLabel + '</span></div>' +
      sideHTML(st.away, 1) +
      '<div class="rail">' +
        '<span' + (st.home.bonus ? ' class="bonus"' : '') + '>' +
          esc(st.home.short) + ' ' + st.home.periodFouls + dots(st.home.periodFouls) + '</span>' +
        '<span' + (st.away.bonus ? ' class="bonus"' : '') + '>' +
          esc(st.away.short) + ' ' + st.away.periodFouls + dots(st.away.periodFouls) + '</span>' +
      '</div></div>';
  },

  lower(st) {
    const T = side === 0 ? st.home : st.away;
    const pick = wantPid
      ? T.onCourt.find(p => p.id === wantPid)
      : T.onCourt.slice().sort((a, b) => b.pts - a.pts)[0];
    if (!pick) return '';
    return '<div class="l3"><div class="bar" style="background:' + esc(T.colour) + '"></div>' +
      '<div class="who"><span class="num">' + esc(pick.number) + '</span>' +
        '<span class="nm">' + esc(pick.name) + '</span>' +
        '<span class="tm">' + esc(T.name) + '</span></div>' +
      '<div class="line">' +
        ['pts','reb','ast'].map(k =>
          '<span class="st"><b>' + pick[k] + '</b><i>' + k + '</i></span>').join('') +
        '<span class="st"><b>' + pick.fg + '</b><i>fg</i></span>' +
        '<span class="st"><b>' + pick.tp + '</b><i>3pt</i></span>' +
      '</div></div>';
  },

  compare(st) {
    const rows = [
      ['points', st.home.score, st.away.score],
      ['fouls',  st.home.periodFouls, st.away.periodFouls]
    ];
    return '<div class="cmp">' +
      '<div class="hd"><span>' + esc(st.home.short) + '</span>' +
        '<span>' + esc(st.away.short) + '</span></div>' +
      rows.map(([lab, a, b]) => {
        const tot = (a + b) || 1;
        return '<div class="r"><b class="v">' + a + '</b>' +
          '<span class="lab">' + lab + '</span><b class="v2">' + b + '</b>' +
          '<span class="track">' +
            '<span style="width:' + (100 * a / tot) + '%;background:' + esc(st.home.colour) + '"></span>' +
            '<span style="width:' + (100 * b / tot) + '%;background:' + esc(st.away.colour) + '"></span>' +
          '</span></div>';
      }).join('') + '</div>';
  },

  final(st) {
    return '<div class="fin"><div class="lbl">Final</div><div class="row">' +
      '<span class="t" style="color:' + esc(st.home.colour) + '">' + esc(st.home.short) + '</span>' +
      '<span class="s">' + st.home.score + '</span>' +
      '<span class="s">' + st.away.score + '</span>' +
      '<span class="t" style="color:' + esc(st.away.colour) + '">' + esc(st.away.short) + '</span>' +
      '</div></div>';
  }
};

/* ---- render ----------------------------------------------------------- */
function render() {
  const st = buildState();
  if (!st) return;

  /* Only touch the DOM when something actually changed. A browser source is
     composited every frame by the mixer; rewriting identical HTML sixty times
     a second is heat, and on a laptop running OBS it is dropped frames. */
  const json = JSON.stringify(st);
  if (json !== lastJSON) {
    lastJSON = json;
    window.EpinoiaBroadcast.last = st;
    try {
      window.dispatchEvent(new CustomEvent('epinoia:state', { detail: st }));
    } catch (_) { /* a mixer's embedded engine may not have CustomEvent */ }
    const fn = SCENES[scene] || SCENES.scorebug;
    stage.innerHTML = fn(st);
    stage.dataset.ready = '1';
  }
  if (document.body.classList.contains('debug')) {
    diag.textContent = [
      'scene ' + scene, 'transport ' + (sub ? sub.transport : 'static'),
      'status ' + (sub ? sub.status : '—'), st.clock.periodLabel + ' ' + st.clock.display,
      st.home.short + ' ' + st.home.score + '–' + st.away.score + ' ' + st.away.short
    ].join('  ·  ');
  }
}

/* ---- boot ------------------------------------------------------------- */
window.EpinoiaBroadcast = {
  VERSION: '1.0.0',
  /* The document, on demand — for a mixer that runs its own script in this
     page rather than compositing the rendered layer. */
  state: () => buildState(),
  last: null,
  scenes: Object.keys(SCENES)
};

(async function boot() {
  if (!gameId) {
    stage.innerHTML = '<div class="fin"><div class="lbl">no game</div>' +
      '<div class="row"><span class="t">add ?g=&lt;game-id&gt;</span></div></div>';
    stage.dataset.ready = '1';
    return;
  }
  if (!CFG.supabaseUrl) return;

  try {
    /* THE OPTIONAL COLUMNS ARE ASKED FOR SEPARATELY, and their absence is not
       an error. attendance and capacity arrived in a later migration, and a
       graphics layer that goes black because a column it does not need is
       missing is the worst possible way to discover a deployment is behind.
       Score, clock and fouls are the graphic; everything else is garnish. */
    const CORE = 'id,status,period,home_score,away_score,venue,' +
      'roster_snapshot,starters,tip_winner,arrow_init,' +
      'home:home_team_id(name,short_name,colour),away:away_team_id(name,short_name,colour),' +
      'competitions(name,seasons(name,leagues(name)))';
    const gs = await api('games?id=eq.' + encodeURIComponent(gameId) +
      '&select=' + CORE + '&limit=1');
    if (!gs.length) return;
    game = gs[0];

    try {
      const extra = await api('games?id=eq.' + encodeURIComponent(gameId) +
        '&select=attendance,capacity,officials&limit=1');
      if (extra.length) Object.assign(game, extra[0]);
    } catch (_) { /* an older database simply has none of these */ }

    let rows = [];
    try {
      rows = await api('game_events?game_id=eq.' + encodeURIComponent(gameId) +
        '&select=seq,t,team,pid,period,clock,payload&order=seq&limit=2000');
    } catch (_) { /* a fixture that has not tipped yet has no events, which is fine */ }

    const snap = game.roster_snapshot;
    S = {
      teams: (snap && snap.teams) || [
        { name: (game.home || {}).name || 'home', color: (game.home || {}).colour, players: [] },
        { name: (game.away || {}).name || 'away', color: (game.away || {}).colour, players: [] }],
      starters: game.starters || [[], []],
      events: rows.map(rowToEvent),
      period: game.period || 1, clockMs: 0,
      tipWinner: game.tip_winner, arrowInit: game.arrow_init,
      phase: game.status === 'final' ? 'final' : 'game'
    };
    render();

    if (game.status !== 'final') {
      sub = L.subscriber({
        gameId, mode: 'supabase',
        supabase: window.epinoiaClient ? epinoiaClient() : null,
        onSnapshot(s) { merge(s.game, s.events, s.removed, true); render(); },
        onFrame(f) { merge(f.game, f.events, f.removed, f.full); render(); },
        onStatus() { render(); }
      });
      /* The clock ticks here, not on the wire. */
      setInterval(render, 200);
    }
  } catch (err) {
    /* On air, a stack trace is worse than an empty layer — so the failure is
       silent by default and visible only when a person opened this page with
       ?debug=1, which is the only time anybody can act on it. */
    if (document.body.classList.contains('debug')) {
      diag.textContent = 'boot failed: ' + ((err && err.message) || err);
      stage.dataset.ready = '1';
    }
  }
})();

/* Kept identical in shape to the embed's merge: a frame carries either the
   whole log or a delta, and a retraction removes by seq. */
function merge(g, events, removed, full) {
  if (!S) return;
  if (g) {
    if (g.period != null) S.period = g.period;
    if (g.status) S.phase = g.status === 'final' ? 'final' : 'game';
  }
  if (full && Array.isArray(events)) { S.events = events.map(rowToEvent); return; }
  if (Array.isArray(removed) && removed.length) {
    const gone = new Set(removed);
    S.events = S.events.filter(e => !gone.has(e.seq));
  }
  if (Array.isArray(events) && events.length) {
    const have = new Set(S.events.map(e => e.seq));
    events.forEach(r => { if (!have.has(r.seq)) S.events.push(rowToEvent(r)); });
    S.events.sort((a, b) => a.seq - b.seq);
  }
}

})();
