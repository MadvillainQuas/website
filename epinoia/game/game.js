'use strict';
/* ============================================================================
   Public box score.

   This page renders through epinoia/boxscore.js — the scorer's own render
   functions, lifted verbatim — over epinoia/engine.js, the scorer's own
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

const E = window.EpinoiaEngine, B = window.EpinoiaBox, L = window.EpinoiaLive;
const CFG = window.EPINOIA_CONFIG;
const qp = new URLSearchParams(location.search);
const gameId = qp.get('g') || '';
const mode = qp.get('mode') === 'supabase' ? 'supabase'
           : qp.get('mode') === 'local' ? 'local'
           : (window.epinoiaMode ? epinoiaMode() : 'local');

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
    `&select=id,status,period,home_score,away_score,tipoff_at,venue,venue_address,` +
    `competition_id,home_team_id,away_team_id,roster_snapshot,starters,` +
    `tip_winner,arrow_init,home:home_team_id(slug,name,short_name,colour,logo_path),` +
    `away:away_team_id(slug,name,short_name,colour,logo_path),competitions(name,seasons(name,leagues(name,slug)))&limit=1`);
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
      venue_address: g.venue_address,
      home_score: g.home_score, away_score: g.away_score,
      home: g.home, away: g.away,
      homeTeamId: g.home_team_id, awayTeamId: g.away_team_id,
      competitionId: g.competition_id,
      leagueName: league.name || null, competitionName: comp.name || null
    }
  };
}

/* ------------------------------------------------------------------ render --- */
const BODIES = {
  /* Built from the same derive() every other tab reads, so the prose and the
     tables are two views of one replay rather than two sources that have to be
     kept in agreement. */
  report:  d => {
    if (!window.EpinoiaStory || !window.EpinoiaReport || !window.EpinoiaGameFacts) {
      return '<div class="msg">The match report could not be loaded.</div>';
    }
    const g = window.EpinoiaGameFacts.brief(window.S, d, B);
    return window.EpinoiaReportView.render(g, window.EpinoiaReport.report(g));
  },
  box:     d => B.qstripHTML(d) + B.bxTeamHTML(d, 0) + B.bxTeamHTML(d, 1),
  pbp:     d => B.pbpHTML(d),
  shots:   d => B.shotChartHTML(d, 0) + B.shotChartHTML(d, 1),
  adv:     d => B.advHTML(d),
  lineups: () => B.lineupsHTML()
};
/* the same five, in the same order, with the same labels as renderFinal() */
const TABS = [['box', 'box score'], ['pbp', 'play-by-play'], ['shots', 'shot charts'],
              ['adv', 'full table / advanced'], ['lineups', 'lineups']];

/* THE MATCH REPORT IS A TAB, and on a finished game it is the FIRST one.
   A box score answers "what were the numbers"; the report answers "what
   happened", which is the question most people arrive with. It is only offered
   once a game is final — there is nothing to report on a game still being
   played, and the facts it reads assume a complete log. */
function tabsFor(status) {
  return status === 'final'
    ? [['report', 'match report']].concat(TABS)
    : TABS;
}

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
    '<div class="tabrow" style="flex-wrap:wrap">' + tabsFor(S.status).map(t =>
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
  offerToScore();
  offerToRevert();
  /* THE GLOWS COME FROM THE CLUB COLOURS TOO.

     boxscore.css colours 27 things from --team0/--team1 — the score, the tab
     buttons, the hero stripe, hover states — and several of them glow with
     --team0-glow / --team1-glow. This page set the two colours and never the
     two glows, so every score on the public box score glowed the default mint
     and cyan whatever the two clubs actually wear. The scorer has always set
     all four; this is the public page catching up with it.

     Through safeColour for the same reason everything else on this page is: the
     value is a club's, and it is going into a style. */
  /* B is the module's own EpinoiaBox, declared at the top of this file.
     Re-declaring it here put the use of B thirty lines above into the temporal
     dead zone of the inner binding, so renderShell threw before it drew
     anything — the box score fell back to the stylesheet's default colours and
     looked almost right, which is how it survived a first glance. */
  const c0 = B.safeColour(S.teams[0].color, '#93f2bf');
  const c1 = B.safeColour(S.teams[1].color, '#8ff5ff');
  const glow = (h, a) => {
    const m = String(h).replace('#', '');
    if (m.length !== 6) return 'rgba(147,242,191,' + a + ')';
    return 'rgba(' + parseInt(m.slice(0, 2), 16) + ',' + parseInt(m.slice(2, 4), 16) +
           ',' + parseInt(m.slice(4, 6), 16) + ',' + a + ')';
  };
  const r = document.documentElement.style;
  r.setProperty('--team0', c0);
  r.setProperty('--team1', c1);
  r.setProperty('--team0-glow', glow(c0, .4));
  r.setProperty('--team1-glow', glow(c1, .4));
  shellBuilt = true;
}

/* ---------------------------------------------------------------------------
   THE WAY FROM A FIXTURE INTO SCORING IT.

   Every fixture in every list now links here, including one that has not been
   played — so this page is where somebody arrives twenty minutes before a tip.
   For the person who is going to score it, the next thing they need is the
   scorer, opened on THIS game, and until now the only route was the rail's
   generic "score a game" and then finding the fixture again in a list.

   WHO SEES IT IS DECIDED BY THE DATABASE, not by this page. can_score() is the
   same function the row-level policies use, so the button appears exactly when
   the write would be allowed — an assigned statistician, a league administrator
   of the owning league, or a platform administrator, and never once the game is
   final. A page that offered the button on its own guess would eventually offer
   it to somebody who then got refused by the scorer, which is a worse
   experience than not offering it.

   NO SDK IS LOADED FOR THIS. The session token is read straight out of storage
   the way nav.js reads it, and the check is one small POST with a bearer token.
   This page is public and mostly read by people who are not signed in; pulling
   200kB of auth library to decide whether to draw one button would be paid for
   by everybody to benefit the few.

   Signed out, nothing happens at all — not even the request. */
function storedToken() {
  try {
    const ref = (CFG.supabaseUrl.match(/^https?:\/\/([^.]+)\./) || [])[1];
    if (!ref) return null;
    const raw = localStorage.getItem('sb-' + ref + '-auth-token');
    if (!raw) return null;
    const j = JSON.parse(raw);
    const tok = j && (j.access_token || (j.currentSession && j.currentSession.access_token));
    if (!tok) return null;
    const exp = j.expires_at || (j.currentSession && j.currentSession.expires_at);
    if (exp && Number(exp) * 1000 < Date.now()) return null;   // expired is not signed in
    return tok;
  } catch (_) { return null; }
}

/* A transient failure (a dropped request, a cold function) must not be the
   difference between a statistician seeing the button and not — three tries
   with a growing pause, which is cheap because this only runs while the
   button is still hidden. */
async function withRetry(fn, tries, delayMs) {
  tries = tries || 3; delayMs = delayMs || 700;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (_) { if (i === tries - 1) return null; }
    await new Promise(res => setTimeout(res, delayMs * (i + 1)));
  }
  return null;
}

async function rpcCall(fn, args, token) {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token,
               'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* HOW MANY EVENTS WOULD THIS REVERT DESTROY — read from wherever it is.
   Shared with epinoia/admin/governance-ui.js, which asks the same question of
   the same refusal and must never disagree with this page about the answer.

   Migration 0067 puts the count in the exception's DETAIL field, which is the
   right place for a machine-readable number. It is read FIRST and it is the
   only source that cannot be broken by rewording.

   But a client and a database are deployed separately and can be out of step
   in either direction, and reading DETAIL alone turned "back to listing" into
   a dead button against a database that had not had 0067 applied yet — the
   refusal arrives, the count is not in the field this looks in, and the
   confirmation never opens. So the sentence is still parsed, as a fallback
   only. Neither half depends on the other having shipped, which is the
   property that matters: whichever is older, the button still works. */
function eventCountFromRefusal(body) {
  if (!body) return null;
  const d = body.details;
  if (d != null && /^\s*\d+\s*$/.test(String(d))) return String(d).trim();
  const m = /has (\d+) recorded event/.exec(body.message || '');
  return m ? m[1] : null;
}

/* Re-checked whenever a session appears where there was none — signing in on
   /epinoia/app/ in another tab writes the same localStorage key this page
   reads, and that write fires a 'storage' event here. Without this, a reader
   who opened the box score before signing in would never see either button
   for the rest of the visit, no matter how they signed in afterwards. */
let scoreChecking = false, scoreShown = false;
async function offerToScore() {
  const cta = document.getElementById('scoreCta');
  if (!cta || scoreShown || scoreChecking) return;
  /* A finalised game is not scorable by anyone, so there is nothing to ask
     about — and asking anyway would put a request on the most-visited version
     of this page. */
  if (!gameId || !S || S.status === 'final') return;
  const token = storedToken();
  if (!token) return;                          // try again once signed in
  scoreChecking = true;
  try {
    const ok = await withRetry(() => rpcCall('can_score', { p_game: gameId }, token));
    if (ok !== true) return;
    cta.href = '../score/?g=' + encodeURIComponent(gameId);
    cta.textContent = S.status === 'live' ? 'continue scoring →' : 'score this game →';
    cta.classList.remove('hide');
    scoreShown = true;
  } finally { scoreChecking = false; }
}

/* ---------------------------------------------------------------------------
   AND THE UNDO, ON THE SAME PAGE.

   A game left in live limbo is noticed HERE — somebody opens the box score,
   sees a fixture that has been "in progress" since last Tuesday, and that is
   the moment they want to put it back. Making them remember which league it
   belongs to, open the admin console, find the season, find the competition
   and find the fixture again is a long walk to undo one mis-tap.

   A DIFFERENT PERMISSION FROM SCORING, and the distinction matters. can_score
   includes a statistician assigned to this game; can_manage_game does not. A
   statistician should be able to record what happens and should not be able to
   destroy the record — so this asks can_manage_game, which is a platform
   admin, a league admin of the owning league, or whoever created an ad-hoc
   game. The same predicate the admin panel's button is judged by, so the two
   places can never disagree about who may do this.

   The two checks go out together rather than one after the other: they are
   independent questions and a live game asks both.

   The confirmation is the same two-step the admin panel uses — the first call
   omits the discard flag, the database refuses and answers with the count, and
   that count goes into the question. Nobody agrees to discard a log without
   being told how big it is. */
/* The raw fetch body on refusal — needed below to read the structured event
   count off a REJECTED call, which r.json() alone does not give us since
   rpcCall() throws on a non-2xx status. */
async function rpcCallRaw(fn, args, token) {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token,
               'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args)
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, body };
}

let revertChecking = false, revertShown = false;
async function offerToRevert() {
  const cta = document.getElementById('revertCta');
  if (!cta || revertShown || revertChecking) return;
  /* Only a game that is actually stuck. A scheduled game has nothing to put
     back, and a final one is refused by the database anyway — offering the
     button there would be offering a refusal. */
  if (!gameId || !S || (S.status !== 'live' && S.status !== 'finalising')) return;
  const token = storedToken();
  if (!token) return;                          // try again once signed in
  revertChecking = true;
  try {
    const ok = await withRetry(() => rpcCall('can_manage_game', { p_game: gameId }, token));
    if (ok !== true) return;
    cta.classList.remove('hide');
    revertShown = true;
    cta.addEventListener('click', onRevertClick, { once: false });
  } finally { revertChecking = false; }

  async function onRevertClick() {
    cta.disabled = true;
    const tok = storedToken();
    if (!tok) { cta.disabled = false; alert('Signed out — sign in again to revert this game.'); return; }
    const attempt = discard => rpcCallRaw('revert_game',
      discard ? { p_game: gameId, p_discard_events: true } : { p_game: gameId }, tok);
    try {
      let out = await attempt(false);
      if (!out.ok) {
        const n = eventCountFromRefusal(out.body);
        /* No count anywhere means this was NOT the "confirm the discard"
           refusal — it is a real one (not signed in, not an administrator of
           this game, the game is already final), and those are reported, not
           retried behind a confirmation. */
        if (n == null) {
          cta.disabled = false;
          alert((out.body && out.body.message) || 'That was refused.');
          return;
        }
        const sure = confirm(
          'Put this game back on the fixture list?\n\n' +
          n + ' recorded event' + (n === '1' ? '' : 's') + ' will be discarded ' +
          'permanently. The clubs, the date and the venue are kept, so the ' +
          'fixture can be scored properly when it is played.\n\n' +
          'Any device still open on this game in the scorer will be told to ' +
          'stop within a few seconds.');
        if (!sure) { cta.disabled = false; return; }
        out = await attempt(true);
        if (!out.ok) {
          cta.disabled = false;
          alert((out.body && out.body.message) || 'That was refused.');
          return;
        }
      }
      /* The page is now showing a game that no longer exists in the state it
         was drawn from, so it is reloaded rather than patched. Reloading lands
         on the same fixture, correctly drawn as scheduled. */
      location.reload();
    } catch (e) {
      cta.disabled = false;
      alert('That was refused: ' + (e.message || e));
    }
  }
}

/* Signing in elsewhere writes this page's own auth key, which fires 'storage'
   here. Retrying costs nothing once a button is already shown — both
   functions no-op on their own guard. */
window.addEventListener('storage', e => {
  if (e.key && /-auth-token$/.test(e.key)) { offerToScore(); offerToRevert(); }
});

/* cheap: 576 characters, safe to run on every clock tick */
function renderHead(d) {
  const S = window.S;
  d = d || window.derive();
  const el = $('#csHead');
  if (el) { el.innerHTML = B.scoreHeadHTML(d); decorateTeams(el); }
  txt($('#csHeading'), S.status === 'final' ? 'final'
                     : S.status === 'live' ? 'live' : 'scheduled');
  document.title = d.score[0] + '–' + d.score[1] + ' ' +
      S.teams[0].name + ' v ' + S.teams[1].name + ' · Epinoia';

  /* Link previews and structured data. Cheap enough to redo here, and it has
     to be redone rather than set once: a game that finalises while somebody is
     watching should stop describing itself as in progress. */
  if (window.EpinoiaSEO && S.meta) {
    const m = S.meta;
    window.EpinoiaSEO.game({
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
  if (el) { el.innerHTML = (BODIES[fTab] || BODIES.box)(d); linkifyPlayers(el); decorateTeams(el); }
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

/* ---------------------------------------------------------------------------
   THE TWO CLUBS, AS DESTINATIONS.

   Done out here rather than inside bxTeamHTML for exactly the reason
   linkifyPlayers is: those renderers are lifted verbatim from the scorer, and
   inside the scorer a club name is a heading on a statistician's screen, not a
   navigation. Decorating afterwards keeps the two copies identical and leaves
   the scorer untouched.

   THE CREST IS SHOWN ONLY IF THERE IS ONE. teams.logo_path is null until a club
   publishes a crest, and a placeholder box in its place would make every club
   that has not uploaded one look broken. Nothing renders in that case — no
   monogram, no grey square, no gap. The image also removes itself if the file
   404s, so a crest whose row survived its object cannot leave a broken-image
   glyph next to a club's name on a public page.

   Names come from the frozen roster snapshot, so they read as they did at
   tip-off; the LINK comes from the fixture's own club rows, which is the only
   place a slug lives. A club with no slug is not a link, just a name. */
/* Sized in em so it tracks whatever it sits beside — 16px on the scoreboard,
   13px on a table heading — rather than being one pixel height that is bold in
   one place and lost in the other. 1.45em reads as a crest next to a club name
   without out-shouting it; max-width holds a wide, letterbox badge to the same
   optical weight as a tall shield, since object-fit:contain would otherwise let
   it run away horizontally. */
const TEAM_CREST_CSS =
  'height:1.45em;width:auto;max-width:2.4em;object-fit:contain;' +
  'vertical-align:-.30em;margin-right:.4em;flex:none';

function clubOf(t) {
  const m = window.S && window.S.meta;
  if (!m) return null;
  return (t === 0 ? m.home : m.away) || null;
}

function decorateTeams(scope) {
  scope.querySelectorAll('[data-team-slot]').forEach(node => {
    if (node.dataset.teamDone === '1') return;
    const t = +node.dataset.teamSlot;
    const club = clubOf(t);
    if (!club) return;
    node.dataset.teamDone = '1';

    const label = node.textContent;
    node.textContent = '';

    /* the crest, when the club actually has one */
    if (club.logo_path) {
      const img = document.createElement('img');
      img.src = CFG.supabaseUrl + '/storage/v1/object/public/media-public/' +
                club.logo_path.split('/').map(encodeURIComponent).join('/');
      img.alt = '';
      img.style.cssText = TEAM_CREST_CSS;
      img.addEventListener('error', () => img.remove());
      node.appendChild(img);
    }

    if (club.slug) {
      const a = document.createElement('a');
      a.href = '../t/?t=' + encodeURIComponent(club.slug);
      a.textContent = label;
      a.style.cssText = 'color:inherit;text-decoration:none';
      a.addEventListener('mouseenter', () => { a.style.textDecoration = 'underline'; });
      a.addEventListener('mouseleave', () => { a.style.textDecoration = 'none'; });
      node.appendChild(a);
    } else {
      node.appendChild(document.createTextNode(label));
    }
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
    supabase: (mode === 'supabase' && window.epinoiaClient) ? epinoiaClient() : null,
    onSnapshot(snap) {
      if (snap.game) mergeLive(snap.game, snap.events);
      else if (snap.events) mergeLive(null, snap.events);
      render();
      /* the snapshot is the log as the transport sees it; reconcile against
         the table too, since the boot fetch may have run before the tip */
      backfill('snapshot');
    },
    onFrame(f) { mergeLive(f.game, f.events, f.removed, f.full); render(); checkGap(); },
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

/* THE STATUS WATCH — how this page learns the game has been taken away.

   Everything else here rides the broadcast: an event reaches a viewer in about
   a quarter of a second, and a game finalised BY A SCORER STILL PUBLISHING
   arrives the same way, because sync.finalise() republishes the roster with
   status 'final' on its way out.

   Neither of those covers the two ways a game changes with nobody publishing:

     REVERTED — an administrator puts the fixture back on the listing from the
       admin console or from this very page. Nothing broadcasts it. A viewer
       sat on a live box score kept the score, the clock and the play-by-play
       of a game that no longer exists, indefinitely, until they reloaded.
     FINALISED ELSEWHERE — the importer, or a scorer whose tab was already
       closed when the edge function ran.

   So the game row itself is asked, on a short beat, and any change of status
   reloads the page rather than trying to patch a view that was drawn from the
   old one. Reloading is the honest move: a reverted fixture is drawn as
   scheduled, a finalised one as final, both by the code that already knows
   how. One indexed row every four seconds, and only while the game is not
   already final — a finished game has nothing left to change. */
const STATUS_POLL_MS = 4000;
function watchGameStatus() {
  if (mode !== 'supabase' || !gameId) return;
  setInterval(async () => {
    if (!window.S || window.S.status === 'final') return;
    let rows;
    try { rows = await api('games?id=eq.' + encodeURIComponent(gameId) + '&select=status&limit=1'); }
    catch (_) { return; }                 // a blip is not a verdict
    const now = rows && rows[0] && rows[0].status;
    if (!now || now === window.S.status) return;
    console.log('[status] ' + window.S.status + ' -> ' + now + ', reloading');
    location.reload();
  }, STATUS_POLL_MS);
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
function mergeLive(game, events, removed, full) {
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
      if (game.status === 'final') {
        setStatus('final');
        /* Neither button is offered to a final game — scoring is refused and
           reverting is refused, both server-side, so a button left visible
           from before the game ended would only ever produce an alert. */
        const scoreCta = document.getElementById('scoreCta');
        if (scoreCta) scoreCta.classList.add('hide');
        const revertCta = document.getElementById('revertCta');
        if (revertCta) revertCta.classList.add('hide');
      }
    }
  }
  /* Retractions first. A statistician who undoes a basket, or edits one in
     the middle of the log, sends the retracted ids alongside the replacements
     — and the replacement can reuse an id, so dropping the old ones after
     adding the new ones would delete what just arrived. */
  if (removed && removed.length) {
    const gone = new Set(removed);
    const before = window.S.events.length;
    window.S.events = window.S.events.filter(e => !gone.has(e.id));
    if (window.S.events.length !== before) {
      console.log('[live] retracted ' + (before - window.S.events.length) + ' event(s)');
    }
  }

  /* A FULL frame is the scorer's entire log, published every ten seconds. It
     is authoritative, so it REPLACES rather than merges — merging cannot undo
     anything, which would leave a viewer who missed a retraction frame holding
     the retracted event until they reloaded. This is the self-healing path:
     whatever else goes wrong, a viewer is correct within ten seconds. */
  if (full && events) {
    const norm = events.map(e => {
      const ev = Object.assign({}, e);
      if (ev.seq != null && ev.id == null) ev.id = ev.seq;
      return ev;
    }).sort((a, b) => a.id - b.id);
    const changed = norm.length !== window.S.events.length;
    window.S.events = norm;
    if (changed) console.log('[live] snapshot resynced to ' + norm.length + ' events');
    return;
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

/* --------------------------------------------------------------- preview ---
   Everything the preview needs that the game row does not carry: the two
   clubs' season aggregates and their leading players, from the same
   EpinoiaData.season() the statistics pages read, so a number here and a
   number there cannot disagree.

   A fixture with no competition — an ad-hoc friendly — still gets the page,
   just without the statistics half. That is the honest result rather than an
   error: the venue, the time and the map are the part somebody actually came
   for. */
async function renderPreview() {
  const S = window.S, m = S.meta || {};
  let season = { players: [], teams: [], teamOfPlayer: new Map() };

  /* THE WHOLE SEASON, NOT THIS COMPETITION.

     EpinoiaData.season() aggregates one competition, which is right for a
     league table and wrong here. A cup tie or a playoff fixture belongs to a
     competition with few finished games or none at all, so scoping to it gave
     a preview reading "no games yet" for two clubs who have played each other
     twice already this season. "The story so far" means the season, so the
     fixture's competition is resolved to its season and every competition
     under that season is aggregated together. */
  if (m.competitionId && window.EpinoiaData) {
    try {
      const comps = await window.EpinoiaData.all(
        'competitions?id=eq.' + encodeURIComponent(m.competitionId) + '&select=season_id');
      const seasonId = comps && comps[0] && comps[0].season_id;
      let games = [];
      if (seasonId) {
        const sibling = await window.EpinoiaData.all(
          'competitions?season_id=eq.' + encodeURIComponent(seasonId) + '&select=id');
        const ids = (sibling || []).map(c => c.id);
        if (ids.length) {
          games = await window.EpinoiaData.all(
            'games?competition_id=in.(' + ids.join(',') + ')&status=eq.final' +
            '&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at');
        }
      }
      if (games.length) season = await window.EpinoiaData.statsForGames(games);
    } catch (e) { console.warn('[preview] season stats unavailable', e); }
  }

  /* Season rows carry ids and numbers; the names live on the players table.
     Without this the key-player cards read "Player". */
  if ((season.players || []).length && window.EpinoiaData) {
    try {
      const meta = await window.EpinoiaData.playerMeta(season.players.map(p => p.id));
      season.players.forEach(p => Object.assign(p, meta[p.id] || {}));
    } catch (e) { console.warn('[preview] player names unavailable', e); }
  }

  const teamRow = id => (season.teams || []).find(t => t.id === id) || null;

  /* Two per side, ranked by production rather than by one counting stat, so a
     rebounder or a creator can make the card and it is not four scorers. */
  const starsOf = id => {
    const tp = season.teamOfPlayer || new Map();
    const mine = (season.players || []).filter(p => tp.get(p.id) === id && p.gp);
    const rank = (a, b) => ((b.ppg || 0) + (b.rpg || 0) + (b.apg || 0)) -
                           ((a.ppg || 0) + (a.rpg || 0) + (a.apg || 0));
    /* A REAL SAMPLE FIRST. Ranking on per-game production alone put a player
       with two appearances and a 7/7/3 line ahead of a regular, which is what
       two games of noise looks like when it is averaged. Anybody at or past
       the preview's own minimum is preferred; the short-sample players are
       kept only as a fallback so a club early in its season still gets cards
       rather than an empty section. */
    const MIN = (window.EpinoiaPreview && window.EpinoiaPreview.MIN_GP) || 3;
    const solid = mine.filter(p => p.gp >= MIN).sort(rank);
    if (solid.length >= 2) return solid.slice(0, 2);
    return solid.concat(mine.filter(p => p.gp < MIN).sort(rank)).slice(0, 2);
  };

  /* Names come from the club rows, not the roster snapshot — a scheduled game
     has no snapshot, because nothing has been frozen yet. */
  const home = m.home || {}, away = m.away || {};

  $('#view').innerHTML = window.EpinoiaPreview.render({
    nameA: home.name || S.teams[0].name, nameB: away.name || S.teams[1].name,
    colourA: B.safeColour(home.colour, '#93f2bf'),
    colourB: B.safeColour(away.colour, '#8ff5ff'),
    slugA: home.slug || null, slugB: away.slug || null,
    teamA: teamRow(m.homeTeamId), teamB: teamRow(m.awayTeamId),
    starsA: starsOf(m.homeTeamId), starsB: starsOf(m.awayTeamId),
    tipoff: m.tipoff_at, venue: m.venue, address: m.venue_address,
    competition: S.competition, leagueSlug: S.leagueSlug
  });

  txt($('#ctx'), (S.competition || 'Fixture') + ' · ' +
      (home.name || S.teams[0].name) + ' v ' + (away.name || S.teams[1].name));
  document.title = (home.name || 'home') + ' v ' + (away.name || 'away') +
      ' · preview · Epinoia';

  /* The two consoles that belong on a fixture that has not started: whoever
     may score it, and whoever may take it back off the listing. */
  offerToScore();
  offerToRevert();
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
    /* A finished game opens on the report rather than the box score: the
       numbers are still one tap away, and "what happened" is the question
       most people arrive with. A live game keeps opening on the box score,
       where the numbers ARE the story as it happens. */
    if (window.EpinoiaReport) fTab = 'report';
    render();
    return;                       // finished: nothing left to listen for
  }

  /* A SCHEDULED FIXTURE IS A PREVIEW, NOT AN EMPTY BOX SCORE.

     Drawing the tabbed box score for a game nobody has played gave five tabs
     of zeroes, a play-by-play with nothing in it and a clock — and the clock
     is most of why these read as live. A fixture that has not happened has a
     different job: say when it is, how to get there, and what the season so
     far suggests about the two clubs. No socket is opened, because there is
     nothing publishing and a connected socket is itself a claim that
     something is happening.

     The status watch still runs, and is the only thing that does: the moment
     a scorer claims this fixture the page reloads into the live box score. */
  if (stored.status === 'scheduled') {
    setStatus('scheduled');
    renderPreview().catch(e => {
      console.warn('[preview]', e);
      fail('Could not build the preview: ' + (e.message || e));
    });
    watchGameStatus();
    return;
  }

  watchGameStatus();

  render();
  goLive();
})();
