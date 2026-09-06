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

/* THE BUSIEST READ ON THE PLATFORM, so it is the one that has to survive a
   crowd. Same reasoning as epinoia/data.js: a 429 or a pooler 503 is a "not
   now", not an answer, and four hundred people opening one box score in a
   minute is precisely when it arrives. Anything else — a 400, a 404 — is a
   real answer and is reported straight away rather than asked three times.

   Deliberately a copy rather than an import: this page loads six scripts and
   must render a box score with the network hostile; adding a dependency
   between them to save fifteen lines would trade robustness for tidiness. */
const API_RETRY = new Set([429, 500, 502, 503, 504]);

async function api(p, attempt = 0) {
  let r;
  try {
    r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
      { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  } catch (netErr) {
    if (attempt >= 3) throw netErr;
    await new Promise(res => setTimeout(res, 400 * Math.pow(2, attempt)));
    return api(p, attempt + 1);
  }
  if (r.ok) return r.json();
  if (API_RETRY.has(r.status) && attempt < 3) {
    const ra = r.headers.get('retry-after');
    let hold = 400 * Math.pow(2, attempt);
    if (ra && /^\d+$/.test(ra.trim())) hold = Math.min(10000, +ra * 1000);
    await new Promise(res => setTimeout(res, hold));
    return api(p, attempt + 1);
  }
  throw new Error(`${r.status} on ${p.split('?')[0]}`);
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
  /* The wall clock rides along untouched. The replay ignores it — engine.js
     works entirely in period and game clock — but it is the ONLY axis a video
     of the game shares with the log, so dropping it here would mean fetching
     the whole log twice to get it back. */
  if (r.created_at) { e.created_at = r.created_at; e.seq = r.seq; }
  return e;
}

/* Page through the log. PostgREST caps a response and a game runs to ~800
   events; a silent truncation would show a box score that is quietly wrong,
   which is worse than one that fails. */
async function fetchLog() {
  let events = [], from = 0;
  for (;;) {
    const page = await api(`game_events?game_id=eq.${encodeURIComponent(gameId)}` +
      `&select=seq,t,team,pid,period,clock,payload,created_at&order=seq&offset=${from}&limit=1000`);
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

  /* THE OPTIONAL COLUMNS ARE A SECOND QUESTION, AND A REFUSAL IS AN ANSWER.
     capacity, attendance and officials arrived in migration 0076. Asking for
     them in the main select made the whole request 400 on any database that
     had not run it yet — which took out the entire game page, including the
     box score, over three fields that decorate a header. A page that cannot
     show the attendance is fine; a page that cannot show the game is not. */
  try {
    const extra = await api(`games?id=eq.${encodeURIComponent(gameId)}` +
      `&select=capacity,attendance,officials&limit=1`);
    if (extra.length) Object.assign(g, extra[0]);
  } catch (_) { /* an older database simply has none of these */ }

  /* THE VIDEO IS ALSO A SEPARATE QUESTION, for exactly the reason above: the
     table arrives in migration 0082 and a database without it must still be
     able to show a box score. */
  let video = null;
  try {
    const vs = await api(`game_videos?game_id=eq.${encodeURIComponent(gameId)}` +
      `&is_primary=eq.true&select=url,provider,video_ref,label,` +
      `stream_started_at,tip_at,tip_wall,tip_offset_ms,trim_ms,is_live,clock_track&limit=1`);
    if (vs.length && vs[0].url) video = vs[0];
    else if (vs.length) video = vs[0];         // anchored, link still to come
  } catch (_) { /* no table, or none attached — the tab simply does not appear */ }

  /* THE LEAGUE'S CHANNEL, WHEN NOBODY HAS PASTED A LINK.

     A mixer can tell the platform when a stream started and which service it
     goes to; it cannot tell us the public watch URL, because YouTube issues
     that to the broadcast rather than to the encoder. Without a fallback,
     every fixture would need a link pasted into it before anybody could watch
     from here.

     So a league that has recorded its channel id once gets "whatever this
     channel is streaming right now" — which, during a game, is the game. It
     cannot be seeked, so the play list stays unavailable until the archive
     link arrives; that is stated on the tab rather than discovered by a
     viewer pressing a play and going nowhere. */
  if ((!video || !video.url) && g.status === 'live') {
    try {
      const chans = await api(`rpc/league_channel_for_game?p_game=` +
        encodeURIComponent(gameId));
      const c = Array.isArray(chans) ? chans[0] : chans;
      if (c && c.channel_ref && window.EpinoiaVideo) {
        const src = window.EpinoiaVideo.liveEmbedSrc(c.platform, c.channel_ref);
        if (src) {
          video = Object.assign({}, video || {}, {
            provider: c.platform, channel_ref: c.channel_ref,
            live_src: src, url: video && video.url ? video.url : '',
            label: 'Live on the league channel', is_live: true
          });
        }
      }
    } catch (_) { /* no 0083 yet, or no channel recorded — nothing to show */ }
  }

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
    video: video,
    /* The scoresheet's context, in the shape matchDetailsHTML reads on both
       sides — the scorer keeps the same object on its own S, so one renderer
       serves the statistician's screen and the public page. */
    details: {
      venue: g.venue, address: g.venue_address,
      capacity: g.capacity, attendance: g.attendance,
      officials: g.officials || {}
    },
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
  box:     d => B.qstripHTML(d) + B.matchDetailsHTML() +
                B.bxTeamHTML(d, 0) + B.bxTeamHTML(d, 1),
  pbp:     d => B.pbpHTML(d),
  shots:   d => B.shotChartHTML(d, 0) + B.shotChartHTML(d, 1),
  adv:     d => B.advHTML(d),
  lineups: () => B.lineupsHTML(),
  /* Rendered rather than returned as a string: the video tab owns a player, a
     set of filters and a scroll position, and handing back HTML for the page
     to insert would throw all three away on every redraw. */
  video:   () => '<div id="vidHost"></div>'
};
/* the same five, in the same order, with the same labels as renderFinal() */
const TABS = [['box', 'box score'], ['pbp', 'play-by-play'], ['shots', 'shot charts'],
              ['adv', 'full table / advanced'], ['lineups', 'lineups']];

/* THE MATCH REPORT IS A TAB, and on a finished game it is the FIRST one.
   A box score answers "what were the numbers"; the report answers "what
   happened", which is the question most people arrive with. It is only offered
   once a game is final — there is nothing to report on a game still being
   played, and the facts it reads assume a complete log. */
/* VIDEO IS A TAB ONLY WHEN THERE IS ONE. A permanently present tab that says
   "no video has been attached" is a tab that trains people not to press it,
   and every league without a camera would carry it for ever. */
function tabsFor(status) {
  const base = status === 'final'
    ? [['report', 'match report']].concat(TABS)
    : TABS;
  const S = window.S;
  const v = S && S.video;
  return (v && (v.url || v.live_src)) ? base.concat([['video', 'video']]) : base;
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
    '<div class="ovhead"><div class="ovtitle" id="csHeading"></div>' +
      /* THE SCORESHEET IS THE RECORD, so it is offered wherever the record is
         read — not buried in an admin screen. Only once the game is final:
         a scoresheet of a game still being played is a document that will be
         wrong by the time it is printed. */
      (S.status === 'final'
        ? '<button class="tabbtn" id="csSheet" style="margin-left:auto">scoresheet · pdf</button>'
        : '') + '</div>' +
    '<div id="csHead"></div>' +
    '<div class="tabrow" style="flex-wrap:wrap">' + tabsFor(S.status).map(t =>
      '<button class="tabbtn' + (fTab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' +
      B.esc(t[1]) + '</button>').join('') + '</div>' +
    '<div id="csBody"></div>';

  const sheetBtn = document.getElementById('csSheet');
  if (sheetBtn) sheetBtn.onclick = () => B.printScoresheet();

  document.querySelectorAll('#view .tabbtn[data-tab]').forEach(b => {
    b.onclick = () => {
      fTab = b.dataset.tab;
      document.querySelectorAll('#view .tabbtn[data-tab]').forEach(x =>
        x.classList.toggle('on', x.dataset.tab === fTab));
      lastBodyKey = '';                 // force a redraw for the new tab
      renderBody();
    };
  });

  txt($('#ctx'), (S.competition || 'Friendly') + ' · ' +
      S.teams[0].name + ' v ' + S.teams[1].name);
  offerToScore();
  offerToRevert();
  offerToAttachVideo(); offerToMoveCompetition();
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

   WHO SEES IT IS DECIDED BY THE DATABASE, not by this page — but by the right
   question, which took a second go. 0068 split the old permission in two:

     may_score_game(g)  WHO. An assigned statistician, a league administrator
                        of the owning league, or a platform administrator.
     can_score(g)       WHO **and** whether the game is currently open to
                        event writes.

   This button asked can_score, on the reasoning that it should appear exactly
   when the write would be allowed. That is wrong for a REVERTED fixture.
   can_score deliberately refuses a scheduled game carrying reverted_at, so
   that a scorer left open on a fixture someone just put back cannot rebuild
   the log that was discarded — and the button vanished from the one page where
   the fixture needs re-claiming, leaving the admin console as the only route
   back. 0068 says as much itself about the games_update policy: re-claiming is
   judged on WHO, not on the state the row is in.

   So the button asks WHO. Clicking it opens the scorer, which claims the
   fixture by taking it live; the trigger clears reverted_at on the way, and
   can_score is true again by the time the first event is written. The write
   gate is untouched and still strictly narrower than the button.

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
    const ok = await withRetry(() => rpcCall('may_score_game', { p_game: gameId }, token));
    if (ok !== true) {
      /* Silence here meant a missing button with no way to tell whether the
         account was refused, the request failed, or the code never ran. */
      console.info('[epinoia] "score this game" hidden: may_score_game returned',
                   ok, '— signed in as', (storedToken() ? 'yes' : 'no'));
      return;
    }
    cta.href = '../score/?g=' + encodeURIComponent(gameId);
    cta.textContent = S.status === 'live' ? 'continue scoring →' : 'score this game →';
    const wrap = document.getElementById('ctaWrap');
    if (wrap) wrap.classList.remove('hide'); else cta.classList.remove('hide');
    buildCtaMenu();
    scoreShown = true;
  } finally { scoreChecking = false; }
}


/* ---------------------------------------------------------------------------
   PRIMING A FIXTURE FOR BROADCAST.

   Whoever streams a game is almost always the same person who scores it, and
   they need to do their setting up BEFORE the hall fills — lay the scorebug
   out in OBS, check the crests loaded, confirm the colours read over the floor
   they are actually playing on. All of that is possible from a scheduled
   fixture, because the graphics draw the teams, the crests and a 0-0 scorebug
   from the fixture row alone; none of it needs a ball to have been thrown.

   That is what "prime for broadcast" means here, and it is worth being plain
   that it is not a switch that turns something on: there is nothing to enable.
   The graphics read the same live feed as the public box score, so a layer
   pointed at this fixture is already correct and starts moving by itself the
   moment the statistician taps the first basket. The button opens the control
   room, and the control room is where the setting up happens.

   IT IS A CARET, NOT A SECOND BUTTON. Scoring is what nearly everybody who
   sees this is here to do; broadcasting is a minority of a minority, and it
   must not cost the majority a decision on the way past.
   --------------------------------------------------------------------------- */
function buildCtaMenu() {
  const menu = document.getElementById('ctaMenu');
  const more = document.getElementById('ctaMore');
  if (!menu || !more || menu.dataset.built === '1') return;
  menu.dataset.built = '1';

  const g = encodeURIComponent(gameId);
  const items = [
    ['../broadcast/control/?g=' + g, 'Prime for broadcast',
     'Lay out the graphics before tip — they draw the real teams and crests now, ' +
     'and start moving on the first basket.'],
    ['../broadcast/?g=' + g + '&live=1&pos=bl', 'Open the graphics layer',
     'The transparent page to add as a browser source in OBS or vMix.'],
    ['../score/?g=' + g, S.status === 'live' ? 'Continue scoring' : 'Open the scoring app',
     'The statistician’s screen.']
  ];
  menu.innerHTML = items.map(([href, title, note]) =>
    '<a href="' + href + '" target="_blank" rel="noopener">' + B.esc(title) +
    '<small>' + B.esc(note) + '</small></a>').join('');

  const close = () => { menu.classList.add('hide'); more.setAttribute('aria-expanded', 'false'); };
  more.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const open = menu.classList.toggle('hide') === false;
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  /* Anywhere else closes it, including inside the menu — a link that has been
     followed into a new tab should not leave the menu hanging open behind it. */
  document.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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

/* ==========================================================================
   ATTACHING THE RECORDING, AFTER THE GAME.

   The ordinary case: the game finished on Saturday, the footage went up on
   Sunday, and whoever ran the table wants to line the two up. The scorer
   cannot help — it refuses to open a finished fixture, and rightly, because
   its log is closed — so this page carries it instead.

   Two numbers and one of them is already known. The tip's wall clock is in the
   event log (the first period_start), so anchor_video_from_log fills it in.
   The only thing nobody can derive is where the jump ball sits on the scrub
   bar, which is the one field this asks for.
   ========================================================================== */
let vidChecking = false, vidShown = false;

async function offerToAttachVideo() {
  const cta = document.getElementById('vidCta');
  if (!cta || vidShown || vidChecking || !gameId) return;
  const token = storedToken();
  if (!token) return;                          // ask again once signed in
  vidChecking = true;
  try {
    const ok = await withRetry(() => rpcCall('may_attach_video', { p_game: gameId }, token));
    if (ok !== true) return;
    vidShown = true;
    cta.classList.remove('hide');
    cta.textContent = (window.S && window.S.video && window.S.video.url)
      ? 'video sync' : 'attach video';
    cta.onclick = openAttach;
    offerLiveStatsLink();                      // same people, same moment
  } catch (_) {
    /* Before 0088 the function does not exist, and a page that cannot offer
       this is a page, not a failure. */
  } finally { vidChecking = false; }
}

/* ---- The source of a fed game --------------------------------------------
   A game the ingest worker writes from FIBA LiveStats has an external_games
   row (public read). For the people who may attach video the top bar also
   links to the Genius LiveStats page it is read from. The client code that
   page needs comes from the feed's schedule_sources row (console-made
   leagues; readable by that league's admins) or, for registry leagues, from
   config/ingest-sources.json on this site; the feed code itself is the last
   resort (SLB's client code is SLB). */
let lsShown = false;
async function offerLiveStatsLink() {
  const cta = document.getElementById('lsCta');
  if (!cta || lsShown || !gameId) return;
  try {
    const H = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
    const token = storedToken();
    if (token) H.Authorization = 'Bearer ' + token;
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/external_games?game_id=eq.' + gameId +
      '&adapter=eq.fiba_livestats&select=external_id,competition_code,source_id&limit=1', { cache: 'no-store', headers: H });
    const ext = r.ok ? (await r.json())[0] : null;
    if (!ext || !ext.external_id) return;
    let client = null;
    if (ext.source_id) {
      const rs = await fetch(CFG.supabaseUrl + '/rest/v1/schedule_sources?id=eq.' + ext.source_id +
        '&select=adapter_config', { cache: 'no-store', headers: H });
      const src = rs.ok ? (await rs.json())[0] : null;
      client = src && src.adapter_config && (src.adapter_config.client_code || src.adapter_config.code);
    }
    if (!client) {
      const rc = await fetch('../../config/ingest-sources.json', { cache: 'no-store' });
      const reg = rc.ok ? await rc.json() : null;
      const src = reg && (reg.sources || []).find(x => x.code === ext.competition_code);
      client = src && ((src.adapter_config && src.adapter_config.client_code) || src.code);
    }
    client = client || ext.competition_code;
    if (!client) return;
    cta.href = 'https://fibalivestats.dcd.shared.geniussports.com/u/' +
      encodeURIComponent(client) + '/' + encodeURIComponent(ext.external_id) + '/bs.html';
    cta.title = 'the FIBA LiveStats page this game is fed from (' + client + ' ' + ext.external_id + ')';
    cta.classList.remove('hide');
    lsShown = true;
  } catch (_) {
    /* a page without the link is a page, not a failure */
  }
}

function openAttach() {
  const V = window.EpinoiaVideo;
  const cur = (window.S && window.S.video) || {};
  const gap = V ? V.gapMs(cur) : null;
  const wrap = document.createElement('div');
  wrap.className = 'vsheet';
  wrap.innerHTML =
    '<div class="box">' +
      '<h3>The recording of this game</h3>' +
      '<p>Paste the link, then say where the jump ball is on the scrub bar — or let ' +
      'the page find it. The tip-off time comes from the event log, so from that one ' +
      'number every play in the game gets a position in the video — here, and on the ' +
      'profile of every player in it.</p>' +
      '<input id="vsUrl" type="url" placeholder="https://www.youtube.com/watch?v=…" ' +
        'value="' + B.esc(cur.url || '') + '">' +
      '<div class="tip"><span style="font-size:12.5px">tip-off is at</span>' +
        '<input id="vsMin" type="number" min="0" max="600" placeholder="mm" value="' +
          (gap != null ? Math.floor(gap / 60000) : '') + '">' +
        '<span>:</span>' +
        '<input id="vsSec" type="number" min="0" max="59" placeholder="ss" value="' +
          (gap != null ? Math.floor(gap / 1000) % 60 : '') + '"></div>' +
      /* THE THREE WAYS THE PAGE CAN FILL THAT NUMBER IN ITSELF (roadmap Phase 1).
         Each is offered, none is applied silently: the number lands in the
         fields above with its source written beside it, and the person who can
         see the footage presses save. */
      '<div class="vsauto">' +
        '<div class="vsrow"><button type="button" id="vsFromStream">from the stream\u2019s start time</button>' +
          '<span class="vsnote" id="vsStreamNote">YouTube live streams</span></div>' +
        '<div class="vsrow"><label class="vsfile"><span>from a local copy of the footage</span>' +
          '<input type="file" id="vsFile" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/*"></label>' +
          '<span class="vsnote" id="vsFileNote">read here, never uploaded</span></div>' +
        '<div class="vsrow hide" id="vsScanRow"><button type="button" id="vsScan">read the scoreboard in the picture</button>' +
          '<span class="vsnote" id="vsScanNote"></span></div>' +
        /* THE WHOLE CLOCK. After the game, with the video attached: read the
           clock overlay right through the footage so every play is placed by
           its own game clock — or import the same readings from a vision model
           (epinoia-clock-track/1 JSON). Either way the plays stop depending on
           a tip-off anchor at all. */
        '<div class="vsrow hide" id="vsTrackRow"><button type="button" id="vsTrack">read the whole game clock</button>' +
          '<span class="vsnote" id="vsTrackNote"></span></div>' +
        '<div class="vsrow"><label class="vsfile"><span>import a clock track (JSON from a vision model)</span>' +
          '<input type="file" id="vsTrackFile" accept="application/json,.json"></label>' +
          '<span class="vsnote" id="vsTrackFileNote">' + (cur.clock_track && cur.clock_track.samples ? cur.clock_track.samples.length + ' readings on file' : 'none yet') + '</span></div>' +
      '</div>' +
      '<div class="msg" id="vsMsg"></div>' +
      '<div class="row"><button id="vsCancel">cancel</button>' +
        '<button class="go" id="vsSave">save</button></div>' +
    '</div>';
  document.body.appendChild(wrap);
  document.getElementById('vsCancel').onclick = () => { wrap.remove(); anchorCleanup(); };
  document.getElementById('vsSave').onclick = () => saveAttach(wrap);
  document.getElementById('vsFromStream').onclick = () => anchorFromStream();
  document.getElementById('vsFile').onchange = ev => anchorFromFile(ev.target.files && ev.target.files[0]);
  document.getElementById('vsScan').onclick = () => anchorFromScoreboard();
  document.getElementById('vsTrack').onclick = () => anchorTrackClock();
  document.getElementById('vsTrackFile').onchange = ev => importClockTrack(ev.target.files && ev.target.files[0]);
  document.getElementById('vsUrl').focus();
}

/* ---- the whole game clock ----------------------------------------------
   Reads the overlay right through a local copy of the footage (the sheet's
   file), every 5 s, and saves the readings on the video row. Needs the video
   attached first (the readings belong to that footage), and takes a few
   minutes for a full game — the note counts along. */
async function anchorTrackClock() {
  const A = window.EpinoiaVideoAnchor;
  const note = document.getElementById('vsTrackNote'), btn = document.getElementById('vsTrack');
  if (!anchorFile) { note.textContent = 'choose the footage file first'; return; }
  if (!(window.S && window.S.video && window.S.video.url)) { note.textContent = 'save the video link first — the readings belong to that footage'; return; }
  if (anchorBusy) return;
  anchorBusy = true; btn.disabled = true;
  const ctl = new AbortController();
  const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'stop'; stop.style.marginLeft = '8px';
  stop.onclick = () => ctl.abort();
  btn.after(stop);
  try {
    const v = anchorVideo();
    await new Promise((res, rej) => {
      if (v.readyState >= 1) return res();
      v.addEventListener('loadedmetadata', res, { once: true });
      v.addEventListener('error', () => rej(new Error('this browser cannot decode that file')), { once: true });
    });
    const status = s => { note.textContent = s; };
    const mm = +document.getElementById('vsMin').value || 0, ss = +document.getElementById('vsSec').value || 0;
    const guess = (mm * 60 + ss) || 60;
    status('finding the scoreboard…');
    let found = await A.autoCrop(v, Math.min(guess + 60, v.duration - 1), { onStatus: status });
    if (!found.crop) found = await A.autoCrop(v, Math.min(guess + 300, v.duration - 1), { onStatus: status });
    if (!found.crop) { status('no clock overlay found in the picture — a vision model’s track can be imported instead'); return; }
    const track = await A.trackClock(v, found.crop, {
      from: Math.max(0, guess - 120), step: 5, signal: ctl.signal,
      onProgress: (i, n, s) => { note.textContent = 'reading… ' + Math.round(100 * i / n) + '% · ' + A.stampS(s.t) + ' → "' + (s.text || '') + '"'; }
    });
    if (!track.samples.length) { status('no readable clock in the footage'); return; }
    const ok = await saveClockTrack(track);
    status(ok ? track.samples.length + ' readings saved — every play now sits where its clock was on screen'
              : 'read ' + track.samples.length + ' readings but could not save them (signed in? migration 0099 applied?)');
  } catch (err) {
    note.textContent = 'could not read the footage: ' + (err && err.message || err);
  } finally { anchorBusy = false; btn.disabled = false; stop.remove(); }
}

/* A vision model's readings, in the same shape: {samples:[{t, period, clock_ms}]}.
   Also accepts the studio's export ({format:'epinoia-clock-track/1', …}). */
async function importClockTrack(file) {
  const note = document.getElementById('vsTrackFileNote');
  if (!file) return;
  if (!(window.S && window.S.video && window.S.video.url)) { note.textContent = 'save the video link first'; return; }
  try {
    const j = JSON.parse(await file.text());
    const samples = (j.samples || j.track || []).map(s => ({
      t: +s.t != null && isFinite(+s.t) ? +s.t : (+s.video_s || 0),
      period: +(s.period || s.p || 1),
      clock_ms: s.clock_ms != null ? +s.clock_ms : (s.clock_s != null ? Math.round(+s.clock_s * 1000) : null)
    })).filter(s => isFinite(s.t) && s.clock_ms != null && isFinite(s.clock_ms) && s.period >= 1);
    if (!samples.length) { note.textContent = 'no readings in that file (expected samples:[{t, period, clock_ms}])'; return; }
    const ok = await saveClockTrack({ format: 'epinoia-clock-track/1', source: j.source || file.name, samples });
    note.textContent = ok ? samples.length + ' readings saved' : 'could not save the track (signed in? migration 0099 applied?)';
  } catch (err) { note.textContent = 'not a clock track: ' + (err && err.message || err); }
}

async function saveClockTrack(track) {
  const token = storedToken();
  if (!token || !gameId) return false;
  const r = await rpcCallRaw('set_video_clock_track', { p_game: gameId, p_track: track }, token);
  if (!r.ok) return false;
  if (window.S && window.S.video) { window.S.video.clock_track = track; mountVideo(window.derive()); }
  return true;
}

/* ---- the automatic anchors -------------------------------------------
   All three need the same fact: WHEN the ball went up, as a wall clock. For a
   fed game that is the first period_start's poll stamp (payload.wall); for a
   scored one its device stamp or insert time; and failing both, the
   database's own answer (game_tip_wallclock). */
let anchorFile = null, anchorVideoEl = null, anchorBusy = false;

function tipWallMs() {
  const S = window.S;
  const ev = (S && S.events || []).find(e => e.t === 'period_start' && (e.period || 1) === 1);
  if (ev) {
    if (typeof ev.wall === 'number' && isFinite(ev.wall)) return ev.wall;
    const t = ev.created_at || ev.at;
    if (t && !isNaN(new Date(t).getTime())) return new Date(t).getTime();
  }
  return null;
}
async function tipWallMsAsync() {
  const local = tipWallMs();
  if (local != null) return local;
  try {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/game_tip_wallclock', {
      method: 'POST', cache: 'no-store',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_game: gameId })
    });
    const j = r.ok ? await r.json() : null;
    return j && !isNaN(new Date(j).getTime()) ? new Date(j).getTime() : null;
  } catch (_) { return null; }
}

function setProposedOffset(ms, note) {
  const m = document.getElementById('vsMin'), sIn = document.getElementById('vsSec'), msg = document.getElementById('vsMsg');
  if (!m || !sIn) return;
  const clamped = Math.max(0, Math.round(ms / 1000));
  m.value = Math.floor(clamped / 60); sIn.value = clamped % 60;
  if (msg) msg.textContent = note || '';
}
const fmtMMSS = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

async function anchorFromStream() {
  const A = window.EpinoiaVideoAnchor, V = window.EpinoiaVideo;
  const note = document.getElementById('vsStreamNote');
  const raw = document.getElementById('vsUrl').value.trim();
  const parsed = V && raw ? V.parse(raw) : null;
  if (!parsed || parsed.provider !== 'youtube') { note.textContent = 'paste the YouTube link first — only YouTube publishes a stream\u2019s start time'; return; }
  if (!CFG.youtubeApiKey) { note.textContent = 'needs a YouTube Data API key in epinoia/config.js (youtubeApiKey) — free, read-only'; return; }
  note.textContent = 'asking YouTube…';
  const tip = await tipWallMsAsync();
  if (tip == null) { note.textContent = 'this game has no recorded tip-off yet'; return; }
  const st = await A.youtubeStreamStart(parsed.ref, CFG.youtubeApiKey);
  if (!st) { note.textContent = 'YouTube has no start time for that video (not a live stream, or the key is wrong)'; return; }
  const off = tip - st.at.getTime();
  if (off < -5 * 60000 || off > 6 * 3600000) { note.textContent = 'the stream started ' + fmtMMSS(Math.abs(off)) + (off < 0 ? ' after' : ' before') + ' the tip — that does not look like this game\u2019s stream'; return; }
  note.textContent = 'stream began ' + fmtMMSS(off) + ' before tip (platform delay is usually 5–30 s: check one play, nudge if needed)';
  setProposedOffset(off, 'From the stream\u2019s start time on YouTube. Press save, then check a play and nudge the video if it lands a few seconds off.');
}

async function anchorFromFile(file) {
  const A = window.EpinoiaVideoAnchor;
  const note = document.getElementById('vsFileNote'), scanRow = document.getElementById('vsScanRow');
  anchorFile = file || null;
  const trackRow = document.getElementById('vsTrackRow');
  if (!file) { note.textContent = 'read here, never uploaded'; scanRow.classList.add('hide'); if (trackRow) trackRow.classList.add('hide'); return; }
  scanRow.classList.remove('hide');
  if (trackRow) trackRow.classList.remove('hide');
  note.textContent = 'reading the file\u2019s clock…';
  const tip = await tipWallMsAsync();
  const ct = await A.mp4CreationTime(file);
  if (!ct) { note.textContent = 'no recording time in this file (downloads usually strip it) — use the scoreboard below'; return; }
  if (tip == null) { note.textContent = 'file made ' + ct.at.toLocaleString() + ', but this game has no recorded tip-off yet'; return; }
  const off = tip - ct.at.getTime();
  if (off < -5 * 60000 || off > 6 * 3600000) { note.textContent = 'file made ' + ct.at.toLocaleString() + ' — ' + fmtMMSS(Math.abs(off)) + (off < 0 ? ' after' : ' before') + ' tip, which does not look like this game\u2019s recording'; return; }
  note.textContent = 'file made ' + fmtMMSS(off) + ' before tip (' + ct.source + '). Camera clocks drift — confirm on the scoreboard.';
  setProposedOffset(off, 'From the file\u2019s own clock. Camera clocks drift by minutes, so press “read the scoreboard in the picture” to confirm it before saving.');
}

function anchorVideo() {
  if (anchorVideoEl && anchorVideoEl._file === anchorFile) return anchorVideoEl;
  anchorCleanup();
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:-9px;top:-9px';
  v.src = URL.createObjectURL(anchorFile);
  v._file = anchorFile;
  document.body.appendChild(v);
  anchorVideoEl = v;
  return v;
}
function anchorCleanup() {
  if (anchorVideoEl) {
    try { URL.revokeObjectURL(anchorVideoEl.src); } catch (_) {}
    anchorVideoEl.remove(); anchorVideoEl = null;
  }
}

/* THE SCOREBOARD ROUTE. Find where the overlay is (the usual corners and
   edges), then search from a little before the proposed tip for the first
   frame the first-period clock is running in, and refine to half a second.
   Everything happens in this tab on the local file; nothing leaves it. */
async function anchorFromScoreboard() {
  const A = window.EpinoiaVideoAnchor;
  const note = document.getElementById('vsScanNote'), btn = document.getElementById('vsScan');
  if (!anchorFile) { note.textContent = 'choose the footage file first'; return; }
  if (anchorBusy) return;
  anchorBusy = true; btn.disabled = true;
  try {
    const v = anchorVideo();
    await new Promise((res, rej) => {
      if (v.readyState >= 1) return res();
      v.addEventListener('loadedmetadata', res, { once: true });
      v.addEventListener('error', () => rej(new Error('this browser cannot decode that file')), { once: true });
    });
    const mm = +document.getElementById('vsMin').value || 0, ss = +document.getElementById('vsSec').value || 0;
    const guess = (mm * 60 + ss) || null;
    const probeAt = Math.min(Math.max(0, (guess != null ? guess : 0) + 60), Math.max(0, v.duration - 1));
    const status = s => { note.textContent = s; };
    status('finding the scoreboard…');
    let found = await A.autoCrop(v, probeAt, { onStatus: status });
    if (!found.crop && guess == null) found = await A.autoCrop(v, Math.min(300, v.duration - 1), { onStatus: status });
    if (!found.crop) {
      status('no clock overlay found in the picture at ' + A.stampS(probeAt) + ' — type the time by hand, or try a link with the broadcast graphics');
      return;
    }
    const from = Math.max(0, (guess != null ? guess - 15 * 60 : 0));
    const to = Math.min(v.duration, guess != null ? guess + 15 * 60 : Math.min(v.duration, 60 * 60));
    const r = await A.findTip(v, found.crop, { from, to, step: 2, onStatus: status });
    if (r.tipMs == null) { status(r.why || 'could not find the start of the first period'); return; }
    const read = r.read.m + ':' + String(r.read.s).padStart(2, '0');
    status('clock read ' + read + ' at ' + A.stampS(r.readAt) + ' → tip at ' + fmtMMSS(r.tipMs) + (r.refined ? ' (to about a second)' : ' (to about 2 s)'));
    setProposedOffset(r.tipMs, 'From the scoreboard in the picture: it read ' + read + ' at ' + A.stampS(r.readAt) + ', so the ball went up at ' + fmtMMSS(r.tipMs) + '. Press save.');
  } catch (err) {
    note.textContent = 'could not read the footage: ' + (err && err.message || err);
  } finally { anchorBusy = false; btn.disabled = false; }
}

async function saveAttach(wrap) {
  const V = window.EpinoiaVideo;
  const msg = document.getElementById('vsMsg');
  const save = document.getElementById('vsSave');
  const raw = document.getElementById('vsUrl').value.trim();
  if (!raw) { msg.textContent = 'The link first.'; return; }
  const parsed = V ? V.parse(raw) : { ok: false, provider: 'other', ref: '' };
  if (!parsed.ok) {
    msg.textContent = 'That link is not one this recognises — YouTube, Twitch, ' +
      'Vimeo, Facebook or a video file. It would be stored but no play could ' +
      'seek into it.';
    return;
  }
  const mm = Math.max(0, +document.getElementById('vsMin').value || 0);
  const ss = Math.min(59, Math.max(0, +document.getElementById('vsSec').value || 0));
  const tipMs = (mm * 60 + ss) * 1000;

  const token = storedToken();
  save.disabled = true;
  msg.textContent = 'saving…';
  try {
    /* THIS IS THE RECORDING PATH, so it writes an offset and never a stream
       start. It used to compute stream_started_at = tip − offset, inventing a
       moment that never happened purely so the live path's arithmetic could
       serve it; migration 0090 separated the two and this is the other half of
       that change.

       The link and the offset go in ONE call, so a row can never end up with
       the video but not the number that places its plays. */
    /* A fed game's plays carry the poll's wall clock (payload.wall, see the
       ingest worker); the tip's stamp is the same clock at the same moment, so
       handing it over makes every play a device-against-itself subtraction. */
    const tw = tipWallMs();
    const args = { p_game: gameId, p_url: raw, p_provider: parsed.provider, p_ref: parsed.ref,
                   p_tip_offset_ms: tipMs, p_trim_ms: 0 };
    if (tw != null) args.p_tip_wall = Math.round(tw);
    let r = await rpcCallRaw('set_game_video', args, token);
    if (!r.ok) throw new Error((r.body && r.body.message) || 'refused');

    /* The offset says where tip-off is in the FOOTAGE. Placing an individual
       play also needs to know when it happened relative to the tip, and for a
       finished game that reference is in the log — the first period_start.
       Recovered rather than asked for: nobody remembers when a game last month
       started, and the database already knows. */
    r = await rpcCallRaw('anchor_video_from_log', { p_game: gameId }, token);
    if (!r.ok) throw new Error((r.body && r.body.message) || 'no tip-off in the log');
    const row = Array.isArray(r.body) ? r.body[0] : r.body;
    if (!row || !row.tip_at) throw new Error('this game has no recorded tip-off');

    wrap.remove(); anchorCleanup();
    location.reload();                 // the tab, the list and the embed, fresh
  } catch (err) {
    save.disabled = false;
    msg.textContent = 'Could not save it: ' + (err.message || err);
  }
}

let revertChecking = false, revertShown = false;
async function offerToRevert() {
  const cta = document.getElementById('revertCta');
  if (!cta || revertShown || revertChecking) return;
  /* A game that is actually stuck, OR a scheduled one still carrying events.

     The second case is the one this missed. A fixture put back on the listing
     while a scorer was mid-game, or reopened and abandoned, sits as
     'scheduled' with a log behind it — and the preview page is exactly where
     somebody notices. Offering nothing there left the only route to clearing
     it the admin console. A clean scheduled fixture still gets no button,
     because there is genuinely nothing to put back. */
  const stuck = S && (S.status === 'live' || S.status === 'finalising');
  const dirty = S && S.status === 'scheduled' && (S.events || []).length > 0;
  if (!gameId || !S || (!stuck && !dirty)) return;
  const token = storedToken();
  if (!token) return;                          // try again once signed in
  revertChecking = true;
  try {
    const ok = await withRetry(() => rpcCall('can_manage_game', { p_game: gameId }, token));
    if (ok !== true) {
      console.info('[epinoia] "back to listing" hidden: can_manage_game returned', ok);
      return;
    }
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
  if (e.key && /-auth-token$/.test(e.key)) {
    offerToScore(); offerToRevert(); offerToAttachVideo(); offerToMoveCompetition();
  }
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
  if (el) {
    el.innerHTML = (BODIES[fTab] || BODIES.box)(d);
    linkifyPlayers(el); decorateTeams(el);
    if (fTab === 'video') mountVideo(d);
  }
}

/* The video tab draws itself, because it owns a player that must not be
   rebuilt on every redraw — reloading an iframe mid-clip is not a redraw, it
   is an interruption. renderBody's key already prevents that for the common
   case; this is the belt to its braces.

   ?v= carries a focus in from elsewhere on the platform — a player profile
   linking to "his plays in this game" — so arriving from a profile lands on
   the right list rather than on all four hundred plays of the game. */
function mountVideo(d) {
  const S = window.S;
  if (!S || !S.video || !window.EpinoiaVideoTab) {
    const host = document.getElementById('vidHost');
    if (host) host.innerHTML = '<div class="msg">No video is attached to this game.</div>';
    return;
  }
  const qp2 = new URLSearchParams(location.search);
  window.EpinoiaVideoTab.render({
    host: '#vidHost', video: S.video, events: S.events, S: S, d: d,
    focus: { pid: qp2.get('vp') || null, filter: qp2.get('vf') || null },
    /* the people who may attach a video may also nudge it; the same check */
    canEdit: vidShown,
    onTrim: nudgeVideo,
    game: { id: gameId, home: S.teams[0] && S.teams[0].name, away: S.teams[1] && S.teams[1].name,
            tipoff_at: S.meta && S.meta.tipoff_at || null }
  });
}

/* "The clips land four seconds early" is one number on the video row —
   trim_ms — and this is the control for it. Cumulative, saved at once, and the
   tab redraws from the new value; nothing else on the page is touched. */
async function nudgeVideo(deltaMs) {
  const S = window.S;
  if (!S || !S.video || !gameId) return false;
  const token = storedToken();
  if (!token) return false;
  const next = (+S.video.trim_ms || 0) + deltaMs;
  const r = await rpcCallRaw('set_game_video', { p_game: gameId, p_trim_ms: next }, token);
  if (!r.ok) return false;
  S.video.trim_ms = next;
  mountVideo(window.derive());
  return true;
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
    const crestUrl = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(club.logo_path) : null;
    if (crestUrl) {
      const img = document.createElement('img');
      img.src = crestUrl;
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
    /* A FED GAME HAS NO SCORER BROADCASTING, so no frame ever arrives and the
       watchdog would call it "delayed" for the whole game. Its heartbeat is the
       state row the ingest worker rewrites every poll: fresh = live. */
    onStatus(s) {
      if (statusVal === 'final') return;
      if (window.S && window.S.fed && s === 'delayed' && feedFresh()) { setStatus('live'); return; }
      setStatus(s);
    }
  });
  detectFed();
  /* The clock lives inside the scoreboard block the scorer renders, not in a
     element of its own, so ticking it means redrawing that block — which is
     cheap. The body is untouched, so tables keep their scroll position. */
  /* Shortly after connecting, and then as a slow safety net. The gap check
     above catches the normal case within one frame; this catches the case
     where no frame arrives at all — a scorer that reconnected, a dropped
     broadcast, a viewer that woke from sleep. */
  setTimeout(() => backfill('post-connect'), 1500);
  setInterval(() => checkGap(), 10000);
  watchForVideo();

  /* THE CLOCK TICK. Two things it must not do, both learned on a fed game:
       - rebuild the header. Rebuilding replaced the team names every half
         second, and as the clock digits changed width the flex row re-laid
         them out — the names visibly jittered. Now the tick touches only the
         text inside the pill; the header is rebuilt when an event arrives.
       - trust the period it was loaded with. The games row's period is what
         the page opened on; the live state's period is where the game IS. A
         fed game that moved into Q3 while nobody was watching read "Q2" with
         Q3 points already in the quarter row. */
  liveClock = setInterval(() => {
    if (!sub || !sub.state || !window.S) return;
    const S = window.S;
    /* A fed clock never ticks here: it is whatever the last payload said
       (the worker writes it stopped), and it moves when the next poll lands —
       exactly what the FIBA LiveStats page does. */
    S.clockMs = S.fed ? (+sub.state.clock_ms || 0) : sub.clockMs();
    if (S.fed && statusVal !== 'final' && S.status !== 'final') {
      const want = feedFresh() ? 'live' : 'delayed';
      if (statusVal !== want) setStatus(want);
    }
    if (sub.state.period != null && +sub.state.period > 0 && +sub.state.period !== +S.period) {
      S.period = +sub.state.period;
      renderHead();                              // a new period is worth a rebuild
      return;
    }
    const pill = document.querySelector('#csHead .pacepill');
    if (!pill || S.phase === 'final') { renderHead(); return; }
    const want = B.perName(S.period) + ' · ' + B.fmtClock(S.clockMs) + ' ';
    if (pill.firstChild && pill.firstChild.nodeType === 3) {
      if (pill.firstChild.nodeValue !== want) pill.firstChild.nodeValue = want;
    } else renderHead();
  }, 500);
}

/* IS THIS A FED GAME? One anonymous read of external_games at connect time.
   The answer changes two things above: the clock stops ticking locally, and
   "live" means the worker's state row is fresh rather than a scorer's frame. */
let feedFreshMs = 90 * 1000;              // the live lane polls every 10 s; three misses = delayed
async function detectFed() {
  if (!gameId || !window.S || window.S.fed != null) return;
  try {
    const rows = await api('external_games?game_id=eq.' + encodeURIComponent(gameId) + '&select=external_id&limit=1');
    window.S.fed = !!(rows && rows.length);
  } catch (_) { window.S.fed = false; }
  /* the header was drawn with a ticking clock before this was known — redraw
     it from the feed's own clock so pace and minutes agree with the state row */
  if (window.S.fed && sub && sub.state) { window.S.clockMs = +sub.state.clock_ms || 0; render(); }
}
function feedFresh() {
  if (!sub || !sub.state || !sub.state.updated_at) return false;
  const t = new Date(sub.state.updated_at).getTime();
  return isFinite(t) && (Date.now() - t) < feedFreshMs;
}

/* ---- which competition this game counts for --------------------------------
   A game's phase IS its competition (league, cup, trophy, playoff), and the
   console can move one. The same control here, for the people who may manage
   the game, so a fixture entered under the wrong phase — or a fed game the
   feed could only file under the league — can be put right from the page it
   is being looked at on, before or after it is played. Both tables are
   rebuilt afterwards, exactly as the console does. */
let compShown = false;
async function offerToMoveCompetition() {
  const sel = document.getElementById('compCta');
  if (!sel || compShown || !gameId) return;
  const token = storedToken();
  if (!token) return;
  try {
    const ok = await withRetry(() => rpcCall('can_manage_game', { p_game: gameId }, token));
    if (ok !== true) return;
    const H = { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const g = await (await fetch(CFG.supabaseUrl + '/rest/v1/games?id=eq.' + gameId +
      '&select=competition_id,competitions(season_id)', { headers: H, cache: 'no-store' })).json();
    const row = g && g[0];
    const seasonId = row && row.competitions && row.competitions.season_id;
    if (!seasonId) return;
    const comps = await (await fetch(CFG.supabaseUrl + '/rest/v1/competitions?season_id=eq.' + seasonId +
      '&select=id,name,kind&order=name', { headers: H, cache: 'no-store' })).json();
    if (!Array.isArray(comps) || comps.length < 2) return;   // nowhere to move it to
    sel.textContent = '';
    comps.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.kind && c.kind !== 'league' ? ' (' + c.kind + ')' : '');
      sel.appendChild(o);
    });
    sel.value = row.competition_id;
    sel.onchange = async () => {
      const to = comps.find(c => c.id === sel.value);
      if (!to || to.id === row.competition_id) return;
      if (!confirm('Move this game to ' + to.name + '? Both tables will be rebuilt.')) { sel.value = row.competition_id; return; }
      sel.disabled = true;
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/games?id=eq.' + gameId, {
        method: 'PATCH', cache: 'no-store',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, H),
        body: JSON.stringify({ competition_id: to.id, tie_id: null, leg: null })
      });
      if (!r.ok) { sel.disabled = false; sel.value = row.competition_id; alert('Could not move the game (HTTP ' + r.status + ').'); return; }
      /* a played game counts towards a table, so BOTH ends are redone */
      for (const cid of [row.competition_id, to.id]) {
        for (const fn of ['recompute_standings', 'compute_season_awards', 'advance_bracket']) {
          try { await rpcCallRaw(fn, { p_competition: cid }, token); } catch (_) {}
        }
      }
      location.reload();
    };
    sel.classList.remove('hide');
    compShown = true;
  } catch (_) {
    /* a page without the control is a page, not a failure */
  }
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
/* A TAB NOBODY IS LOOKING AT ASKS FOR NOTHING.

   This fires every four seconds for as long as the page is open, which is
   right for somebody watching a game and wrong for the six tabs they left
   behind. A phone in a pocket with four fixtures open was making one request a
   second, for ever, and at a few hundred viewers that is the platform's
   busiest endpoint serving people who cannot see the answer.

   The Page Visibility API says when nobody is looking. Coming back is handled
   too: a tab restored after an hour polls IMMEDIATELY rather than waiting out
   the interval, because the first thing somebody does on returning is look at
   the score. */
const STATUS_POLL_MS = 4000;
function watchGameStatus() {
  if (mode !== 'supabase' || !gameId) return;
  let missedWhileHidden = false;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && missedWhileHidden) { missedWhileHidden = false; pollStatus(); }
  });
  async function pollStatus() {
    if (!window.S || window.S.status === 'final') return;
    let rows;
    try { rows = await api('games?id=eq.' + encodeURIComponent(gameId) + '&select=status&limit=1'); }
    catch (_) { return; }                 // a blip is not a verdict
    const now = rows && rows[0] && rows[0].status;
    if (!now || now === window.S.status) return;
    console.log('[status] ' + window.S.status + ' -> ' + now + ', reloading');
    location.reload();
  }
  setInterval(() => {
    if (document.hidden) { missedWhileHidden = true; return; }
    pollStatus();
  }, STATUS_POLL_MS);
}

/* A STREAM LINK USUALLY ARRIVES AFTER THE VIEWERS DO.

   The video row is fetched once, at boot, and the tab bar is built from what
   came back. That is right for a finished game and wrong for a live one: a
   producer starts the stream, YouTube hands out the public link a minute
   later, and by then everybody watching the box score has a tab bar without a
   video tab on it and no reason to reload.

   So a live game asks again, slowly. Once — the moment the row appears the
   tab bar is rebuilt and the poll stops, because a video is attached once per
   game and there is nothing further to watch for. */
const VIDEO_POLL_MS = 45000;
let videoMisses = 0;
function watchForVideo() {
  if (mode !== 'supabase' || !gameId) return;
  const timer = setInterval(async () => {
    if (document.hidden) return;              // nobody is looking; ask nothing
    /* Keeps looking while the video row has no watchable LINK, not merely no
       row. A stream anchored by the control room exists as a row minutes
       before YouTube hands out the URL, and stopping at the row would mean the
       link never arrived on a page anybody had open. */
    if (!window.S || window.S.status === 'final') return;
    if (window.S.video && window.S.video.url) return;
    let rows;
    try {
      rows = await api('game_videos?game_id=eq.' + encodeURIComponent(gameId) +
        '&is_primary=eq.true&select=url,provider,video_ref,label,' +
        'stream_started_at,tip_at,tip_wall,tip_offset_ms,trim_ms,is_live,clock_track&limit=1');
      videoMisses = 0;
    } catch (_) {
      /* A blip is worth retrying; a database without the table is not. Before
         0082 is applied every one of these is a 400, and a page left open on a
         live game would fire one every 45 seconds for the rest of the evening
         — a request per minute per viewer, for a table that will not exist
         until somebody runs a migration. Three strikes and it stops. */
      if (++videoMisses >= 3) clearInterval(timer);
      return;
    }
    if (!rows.length || !rows[0].url) return;
    /* Keep a channel fallback's own fields — the row that has just arrived
       carries the anchor and the link; live_src is how the page was showing
       the league channel until now, and losing it mid-poll would blank the
       frame for a beat. */
    window.S.video = Object.assign({}, window.S.video || {}, rows[0]);
    clearInterval(timer);
    /* Rebuild the shell rather than the whole page: somebody is watching a
       game, and a reload would throw away their scroll and their tab. */
    shellBuilt = false; renderShell(); shellBuilt = true;
  }, VIDEO_POLL_MS);
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
/* THE SEASON, FOR CONTEXT.

   Shared by the preview (which is entirely about the season) and the match
   report (which uses it to say whether a performance was normal). "24 points"
   is a fact; "24 points, nine clear of his average" is the sentence somebody
   reads — and the evaluator found the report mentioning season context in
   exactly none of twelve games, because nothing ever handed it any.

   Scoped to the SEASON rather than the competition: a cup tie belongs to a
   competition with few finished games, and scoping to it leaves a player with
   no average to be measured against. */
async function loadSeason(competitionId) {
  if (!competitionId || !window.EpinoiaData) return null;
  try {
    const comps = await window.EpinoiaData.all(
      'competitions?id=eq.' + encodeURIComponent(competitionId) + '&select=season_id');
    const seasonId = comps && comps[0] && comps[0].season_id;
    if (!seasonId) return null;
    const sibling = await window.EpinoiaData.all(
      'competitions?season_id=eq.' + encodeURIComponent(seasonId) + '&select=id');
    const ids = (sibling || []).map(c => c.id);
    if (!ids.length) return null;
    const games = await window.EpinoiaData.all(
      'games?competition_id=in.(' + ids.join(',') + ')&status=eq.final' +
      '&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at');
    if (!games.length) return null;
    const S = await window.EpinoiaData.statsForGames(games);
    try {
      const meta = await window.EpinoiaData.playerMeta((S.players || []).map(p => p.id));
      (S.players || []).forEach(p => Object.assign(p, meta[p.id] || {}));
    } catch (_) { /* names are a nicety here; the numbers are the point */ }
    return S;
  } catch (e) { console.warn('[season]', e); return null; }
}

/* The report reads season context off S.season. Fetched AFTER the first paint
   and the body redrawn when it lands: the report is worth reading without it,
   and making the page wait on a second round trip to add one clause to two
   sentences is the wrong trade. */
async function addSeasonContext() {
  const m = (window.S && window.S.meta) || {};
  const S = await loadSeason(m.competitionId);
  if (!S || !window.S) return;
  const idx = {};
  if (m.homeTeamId) idx[m.homeTeamId] = 0;
  if (m.awayTeamId) idx[m.awayTeamId] = 1;
  window.S.season = { players: S.players || [], teams: S.teams || [], teamIndex: idx };
  if (fTab === 'report') { lastBodyKey = ''; renderBody(); }
}

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
     may score it, and whoever may take it back off the listing — plus the one
     that belongs on a fixture that is OVER, which is where a recording is
     normally attached. */
  offerToScore();
  offerToRevert();
  offerToAttachVideo(); offerToMoveCompetition();
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
