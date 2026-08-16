'use strict';
/* ============================================================================
   Public box score.

   This page renders through league/boxscore.js — the scorer's own render
   functions, lifted verbatim — over league/engine.js, the scorer's own
   calculators. So the public box score is not a second implementation that has
   to be kept in agreement with the statistician's screen; it is the same code
   reading the same event log, and it carries the same five tabs.

   Two sources, one code path:
     * the event log in Postgres, for any game that has been played
     * the live transport, for a game in progress

   The previous version had only the second, which is why a finished game
   showed a clock and nothing else: with no live publisher attached there was
   no roster to name anyone with, and no events to replay. games.roster_snapshot
   now supplies the first and game_events the second.
   ============================================================================ */

const E = window.CourtsideEngine, B = window.CourtsideBox, L = window.CourtsideLive;
const CFG = window.COURTSIDE_CONFIG;
const qp = new URLSearchParams(location.search);
const gameId = qp.get('g') || '';
const mode = qp.get('mode') === 'supabase' ? 'supabase'
           : qp.get('mode') === 'local' ? 'local'
           : (window.courtsideMode ? courtsideMode() : 'local');

const $ = s => document.querySelector(s);
const txt = (el, v) => { if (el && el.textContent !== String(v)) el.textContent = v; };

let statusVal = 'connecting';
let fTab = 'box';
let sub = null;
let liveClock = null;      // set while a live publisher is driving the clock

/* boxscore.js reads S and derive() as free variables, exactly as it does
   inside the scorer. Supplying them here is what lets the same code run. */
window.S = null;
window.derive = () => E.deriveGame(window.S);

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} on ${p.split('?')[0]}`);
  return r.json();
}

function fail(msg) { $('#view').innerHTML = ''; $('#view').appendChild(
  Object.assign(document.createElement('div'), { className: 'msg', textContent: msg })); }

/* ------------------------------------------------------- load from Postgres --- */
/* An event row is stored normalised; the scorer's replay wants it flat, with
   the payload merged back in and `seq` back under its original name. */
function rowToEvent(r) {
  const e = Object.assign({ t: r.t, id: r.seq, period: r.period, clock: r.clock }, r.payload || {});
  if (r.team != null) e.team = r.team;
  if (r.pid != null) e.pid = r.pid;
  return e;
}

async function loadStored() {
  const gs = await api(`games?id=eq.${encodeURIComponent(gameId)}` +
    `&select=id,status,period,home_score,away_score,tipoff_at,venue,roster_snapshot,starters,` +
    `tip_winner,arrow_init,home:home_team_id(name,short_name,colour),` +
    `away:away_team_id(name,short_name,colour),competitions(name,seasons(name,leagues(name,slug)))&limit=1`);
  if (!gs.length) return null;
  const g = gs[0];

  /* Page through the log. PostgREST caps a response, and a game runs to ~800
     events — a silent truncation would show a box score that is quietly wrong,
     which is worse than one that fails. */
  let events = [], from = 0;
  for (;;) {
    const page = await api(`game_events?game_id=eq.${encodeURIComponent(gameId)}` +
      `&select=seq,t,team,pid,period,clock,payload&order=seq&offset=${from}&limit=1000`);
    events = events.concat(page);
    if (page.length < 1000) break;
    from += 1000;
  }

  const snap = g.roster_snapshot;
  const teams = (snap && snap.teams) ? snap.teams : [
    { name: (g.home || {}).name || 'home', color: (g.home || {}).colour || '#93f2bf', players: [] },
    { name: (g.away || {}).name || 'away', color: (g.away || {}).colour || '#8ff5ff', players: [] }
  ];

  const comp = g.competitions || {};
  const season = comp.seasons || {};
  const league = season.leagues || {};

  return {
    teams,
    starters: g.starters || [[], []],
    events: events.map(rowToEvent),
    period: g.period || 1,
    clockMs: 0,
    tipWinner: g.tip_winner, arrowInit: g.arrow_init,
    phase: g.status === 'final' ? 'final' : 'game',
    status: g.status,
    competition: [league.name, comp.name].filter(Boolean).join(' · ') || 'Friendly',
    leagueSlug: league.slug || null,
    venue: g.venue
  };
}

/* ------------------------------------------------------------------ render --- */
const BODIES = {
  box:     d => B.qstripHTML(d) + B.bxTeamHTML(d, 0) + B.bxTeamHTML(d, 1),
  pbp:     d => B.pbpHTML(d),
  shots:   d => B.shotChartHTML(d, 0) + B.shotChartHTML(d, 1),
  adv:     d => B.advHTML(d),
  lineups: () => B.lineupsHTML()
};
/* the same five, in the same order, with the same labels as renderFinal() */
const TABS = [['box', 'box score'], ['pbp', 'play-by-play'], ['shots', 'shot charts'],
              ['adv', 'full table / advanced'], ['lineups', 'lineups']];

/* Rendering is split three ways on purpose.

   The advanced tab alone is ~107KB of HTML. Rebuilding the whole view on
   every frame — four times a second during a live game — is what made the
   page feel slow, and it also threw away the scroll position and any table
   the reader was part-way down. So the shell is built once, the scoreboard
   redraws on the clock, and the heavy body only redraws when the log has
   actually changed. */
let shellBuilt = false;
let lastBodyKey = '';

function renderShell() {
  const S = window.S;
  $('#view').innerHTML =
    '<div class="ovhead"><div class="ovtitle" id="csHeading"></div></div>' +
    '<div id="csHead"></div>' +
    '<div class="tabrow" style="flex-wrap:wrap">' + TABS.map(t =>
      '<button class="tabbtn' + (fTab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' +
      B.esc(t[1]) + '</button>').join('') + '</div>' +
    '<div id="csBody"></div>';

  document.querySelectorAll('#view .tabbtn').forEach(b => {
    b.onclick = () => {
      fTab = b.dataset.tab;
      document.querySelectorAll('#view .tabbtn').forEach(x =>
        x.classList.toggle('on', x.dataset.tab === fTab));
      lastBodyKey = '';                 // force a redraw for the new tab
      renderBody();
    };
  });

  txt($('#ctx'), (S.competition || 'Friendly') + ' · ' +
      S.teams[0].name + ' v ' + S.teams[1].name);
  document.documentElement.style.setProperty('--team0', S.teams[0].color || '#93f2bf');
  document.documentElement.style.setProperty('--team1', S.teams[1].color || '#8ff5ff');
  shellBuilt = true;
}

/* cheap: 576 characters, safe to run on every clock tick */
function renderHead(d) {
  const S = window.S;
  d = d || window.derive();
  const el = $('#csHead');
  if (el) el.innerHTML = B.scoreHeadHTML(d);
  txt($('#csHeading'), S.status === 'final' ? 'final'
                     : S.status === 'live' ? 'live' : 'scheduled');
  document.title = d.score[0] + '–' + d.score[1] + ' ' +
      S.teams[0].name + ' v ' + S.teams[1].name + ' · Courtside';
}

function renderBody(d) {
  d = d || window.derive();
  /* the log length and the score are enough to know whether anything the body
     shows can have changed; the clock alone never changes a table */
  const key = fTab + ':' + window.S.events.length + ':' + d.score.join('-');
  if (key === lastBodyKey) return;
  lastBodyKey = key;
  const el = $('#csBody');
  if (el) el.innerHTML = (BODIES[fTab] || BODIES.box)(d);
}

function render() {
  const S = window.S;
  if (!S) return;
  /* the pid -> player lookup the renderers name people through; rebuilt every
     pass because a live sub can introduce a player who was not on the sheet */
  B.rebuildPmap();
  if (!shellBuilt) renderShell();
  const d = window.derive();
  renderHead(d);
  renderBody(d);
}

function setStatus(s) {
  statusVal = s;
  $('#status').className = 'status ' + (s === 'connecting' ? 'offline' : s);
  txt($('#statusText'), s);
}

/* --------------------------------------------------------------- live feed --- */
/* Only games that are not finished need a socket. Subscribing to a finished
   game would burn a realtime connection to learn nothing. */
function goLive() {
  sub = L.subscriber({
    gameId, mode,
    supabase: (mode === 'supabase' && window.courtsideClient) ? courtsideClient() : null,
    onSnapshot(snap) {
      if (snap.game) mergeLive(snap.game, snap.events);
      else if (snap.events) mergeLive(null, snap.events);
      render();
    },
    onFrame(f) { mergeLive(f.game, f.events); render(); },
    onStatus(s) { if (statusVal !== 'final') setStatus(s); }
  });
  /* The clock lives inside the scoreboard block the scorer renders, not in a
     element of its own, so ticking it means redrawing that block — which is
     cheap. The body is untouched, so tables keep their scroll position. */
  liveClock = setInterval(() => {
    if (!sub || !sub.state || !window.S) return;
    window.S.clockMs = sub.clockMs();
    renderHead();
  }, 500);
}

/* A live frame carries the roster and any events the scorer has published.
   Events are merged by seq so a reconnect that replays a frame cannot
   double-count, which would silently inflate the score. */
function mergeLive(game, events) {
  if (!window.S) return;
  if (game) {
    if (game.teams) window.S.teams = game.teams;
    if (game.starters) window.S.starters = game.starters;
    if (game.period != null) window.S.period = game.period;
    if (game.tipWinner != null) window.S.tipWinner = game.tipWinner;
    if (game.arrowInit != null) window.S.arrowInit = game.arrowInit;
    if (game.status) {
      window.S.status = game.status;
      window.S.phase = game.status === 'final' ? 'final' : 'game';
      if (game.status === 'final') setStatus('final');
    }
  }
  if (events && events.length) {
    const seen = new Set(window.S.events.map(e => e.id));
    events.forEach(e => {
      const ev = Object.assign({}, e);
      if (ev.seq != null && ev.id == null) ev.id = ev.seq;
      if (!seen.has(ev.id)) { seen.add(ev.id); window.S.events.push(ev); }
    });
    window.S.events.sort((a, b) => a.id - b.id);
  }
}

/* ------------------------------------------------------------------- boot --- */
(async function boot() {
  if (!gameId) return fail('No game specified.');
  txt($('#foot'), 'transport: ' + mode);

  let stored = null;
  if (mode === 'supabase') {
    try { stored = await loadStored(); }
    catch (e) { return fail('Could not load this game: ' + e.message); }
    if (!stored) return fail('This game is not public, or does not exist.');
  } else {
    /* a local scratch room has no database row — the publisher is the source */
    stored = { teams: [{ name: 'home', color: '#93f2bf', players: [] },
                       { name: 'away', color: '#8ff5ff', players: [] }],
               starters: [[], []], events: [], period: 1, clockMs: 0,
               phase: 'game', status: 'live', competition: 'Friendly' };
  }

  window.S = stored;

  if (stored.status === 'final') {
    setStatus('final');
    render();
    return;                       // finished: nothing left to listen for
  }

  render();
  goLive();
})();
