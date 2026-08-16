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

/* Page through the log. PostgREST caps a response and a game runs to ~800
   events; a silent truncation would show a box score that is quietly wrong,
   which is worse than one that fails. */
async function fetchLog() {
  let events = [], from = 0;
  for (;;) {
    const page = await api(`game_events?game_id=eq.${encodeURIComponent(gameId)}` +
      `&select=seq,t,team,pid,period,clock,payload&order=seq&offset=${from}&limit=1000`);
    events = events.concat(page);
    if (page.length < 1000) break;
    from += 1000;
  }
  return events;
}

async function loadStored() {
  const gs = await api(`games?id=eq.${encodeURIComponent(gameId)}` +
    `&select=id,status,period,home_score,away_score,tipoff_at,venue,roster_snapshot,starters,` +
    `tip_winner,arrow_init,home:home_team_id(name,short_name,colour),` +
    `away:away_team_id(name,short_name,colour),competitions(name,seasons(name,leagues(name,slug)))&limit=1`);
  if (!gs.length) return null;
  const g = gs[0];

  const events = await fetchLog();

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
    venue: g.venue,
    /* kept for the link-preview and structured-data tags, which want the
       fixture's own facts rather than the replayed game's */
    meta: {
      tipoff_at: g.tipoff_at, status: g.status, venue: g.venue,
      home_score: g.home_score, away_score: g.away_score,
      home: g.home, away: g.away,
      leagueName: league.name || null, competitionName: comp.name || null
    }
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

  /* Link previews and structured data. Cheap enough to redo here, and it has
     to be redone rather than set once: a game that finalises while somebody is
     watching should stop describing itself as in progress. */
  if (window.CourtsideSEO && S.meta) {
    const m = S.meta;
    window.CourtsideSEO.game({
      game: { status: S.status, tipoff_at: m.tipoff_at,
              home_score: d.score[0], away_score: d.score[1] },
      home: m.home || { name: S.teams[0].name },
      away: m.away || { name: S.teams[1].name },
      league: m.leagueName, competition: m.competitionName, venue: m.venue
    });
  }
}

function renderBody(d) {
  d = d || window.derive();
  /* the log length and the score are enough to know whether anything the body
     shows can have changed; the clock alone never changes a table */
  const key = fTab + ':' + window.S.events.length + ':' + d.score.join('-');
  if (key === lastBodyKey) return;
  lastBodyKey = key;
  const el = $('#csBody');
  if (el) { el.innerHTML = (BODIES[fTab] || BODIES.box)(d); linkifyPlayers(el); }
}

/* Turn every player row in the box score into a link to that player's profile.

   Done here rather than in the renderer because the renderer is lifted from
   the scorer verbatim, and inside the scorer a name is a tap target that opens
   a player card — not a navigation. The rows already carry data-pid, and on a
   league game that pid IS the players.id uuid, so the link needs nothing else.

   A practice game's pid is a local label like 'p0_3', which is not a player and
   must not become a link to nowhere — hence the uuid test. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function linkifyPlayers(scope) {
  scope.querySelectorAll('tr[data-pid]').forEach(tr => {
    const pid = tr.getAttribute('data-pid');
    if (!UUID.test(pid || '')) return;
    /* the name is the first cell that is not the jersey number */
    const cells = tr.querySelectorAll('td');
    const nameCell = cells[1];
    if (!nameCell || nameCell.querySelector('a')) return;
    const name = nameCell.textContent;
    if (!name.trim()) return;
    const a = document.createElement('a');
    a.href = '../p/?p=' + encodeURIComponent(pid);
    a.textContent = name;
    a.style.cssText = 'color:inherit;text-decoration:none';
    a.addEventListener('mouseenter', () => { a.style.textDecoration = 'underline'; });
    a.addEventListener('mouseleave', () => { a.style.textDecoration = 'none'; });
    nameCell.textContent = '';
    nameCell.appendChild(a);
  });
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
      /* the snapshot is the log as the transport sees it; reconcile against
         the table too, since the boot fetch may have run before the tip */
      backfill('snapshot');
    },
    onFrame(f) { mergeLive(f.game, f.events); render(); checkGap(); },
    onStatus(s) { if (statusVal !== 'final') setStatus(s); }
  });
  /* The clock lives inside the scoreboard block the scorer renders, not in a
     element of its own, so ticking it means redrawing that block — which is
     cheap. The body is untouched, so tables keep their scroll position. */
  /* Shortly after connecting, and then as a slow safety net. The gap check
     above catches the normal case within one frame; this catches the case
     where no frame arrives at all — a scorer that reconnected, a dropped
     broadcast, a viewer that woke from sleep. */
  setTimeout(() => backfill('post-connect'), 1500);
  setInterval(() => checkGap(), 10000);

  liveClock = setInterval(() => {
    if (!sub || !sub.state || !window.S) return;
    window.S.clockMs = sub.clockMs();
    renderHead();
  }, 500);
}

/* THE BACKFILL.

   A frame carries only the events published since the last one — that is the
   whole point of coalescing. So a viewer that joins at 9:18 sees the play at
   9:18 and nothing before it, which is exactly the "only shows what happened
   while I was watching" fault: the page had one play and a 3-0 score while the
   scorer had seven plays and 6-3.

   The plan calls for sequence numbers to heal gaps, and this is that. The log
   is re-fetched whenever the highest sequence we hold falls short of the one
   the scorer says it has published, and once shortly after connecting — because
   the boot fetch usually happens before the scorer has written anything, and
   the socket then only ever tells us about the future.

   Cheap: one indexed query, and only when a gap is actually detected. */
let backfilling = false;

async function backfill(why) {
  if (backfilling || !window.S || mode !== 'supabase') return;
  backfilling = true;
  try {
    const rows = await fetchLog();
    if (!rows.length) return;
    const seen = new Set(window.S.events.map(e => e.id));
    let added = 0;
    rows.map(rowToEvent).forEach(e => {
      if (!seen.has(e.id)) { seen.add(e.id); window.S.events.push(e); added++; }
    });
    if (added) {
      window.S.events.sort((a, b) => a.id - b.id);
      render();
      console.log('[backfill] +' + added + ' events (' + why + ')');
    }
  } catch (e) {
    console.warn('[backfill]', e);
  } finally {
    backfilling = false;
  }
}

/* the scorer publishes last_seq with every state frame; if ours is behind,
   the socket has not told us something and a re-fetch is the only cure */
function checkGap() {
  if (!sub || !sub.state || !window.S) return;
  const theirs = sub.state.last_seq;
  if (theirs == null) return;
  const ours = window.S.events.reduce((n, e) => Math.max(n, e.id || 0), 0);
  if (theirs > ours) backfill('gap ' + ours + ' -> ' + theirs);
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
