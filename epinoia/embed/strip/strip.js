'use strict';
/* ============================================================================
   The fixture strip — a horizontal bar of games for another site's page.

   The information a LiveStats bar carries, laid out differently on purpose:
   the wordmark reads down a narrow edge rather than sitting in a logo box, and
   a card is a SCOREBOARD — home on the left, away on the right, score between
   them — rather than two stacked rows with the score down one side. The state
   is a coloured rule along the card's top edge instead of a word in a header.

   Three things it must get right, because it runs on a page we do not control:

   LIVE GAMES COME FIRST, then upcoming, then finished. A strip is glanced at,
   not read, and the thing worth glancing at is what is happening now.

   IT REFRESHES ITSELF, AND WHILE A GAME IS ON IT IS A TICKER. This used to be
   polling alone — a minute apart when nothing was known to be live, four
   seconds once something was — and that made it the slowest surface on the
   platform and the one most people see. A game that had just tipped could sit
   "upcoming" on a club's homepage for a full minute, and the score behind it
   by as much again; you had to reload the page to find out a game had started.

   So the polling has been demoted to a safety net and the live path is the
   scorer's own broadcast, the same one the box score has always used: score,
   period and clock arrive in about a quarter of a second, the clock then ticks
   locally at no bandwidth at all, and a fixture flips to LIVE the instant the
   first frame lands rather than whenever the next poll happens to run. rt.js
   speaks the protocol directly so no third-party script is added to a page we
   do not control. When there is nothing live there is no socket traffic and
   the poll drops back to its slow beat.

   IT REPORTS ITS HEIGHT. The host page cannot know how tall this wants to be,
   so it is posted out and embed.js applies it.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const qp = new URLSearchParams(location.search);

/* ---------------------------------------------------------------------------
   WHAT THIS EMBED SHOWS, AND WHO DECIDED.

   The URL still decides first. A snippet already pasted into a club's website
   keeps doing exactly what it did, which is the only acceptable behaviour for
   markup living on somebody else's page.

   What is new is that a league administrator can register that club's website
   and say what an unconfigured embed should do there — the whole league, or
   only that club's fixtures. So the snippet can be one line with nothing in it,
   and the league can change what a club's site shows without asking the club to
   edit their page again.

   THE HOST IS ASKED FOR, NOT PROVEN. ancestorOrigins is the real parent origin
   where the browser provides it; document.referrer is the fallback and is
   whatever the embedding page says it is. Neither is a credential and nothing
   here treats one as such: every fixture this can select was already public, so
   the worst a site achieves by claiming to be another is showing itself a
   fixture list it could have asked for by name.
   --------------------------------------------------------------------------- */
let wantLeague = qp.get('l') || '';
let wantTeam = '';
let limit = Math.min(parseInt(qp.get('n'), 10) || 12, 40);
const limitFromUrl = !!qp.get('n');

function hostOfParent() {
  try {
    const a = location.ancestorOrigins;
    if (a && a.length) return new URL(a[a.length - 1]).hostname;
  } catch (_) { /* not supported in this browser */ }
  try { if (document.referrer) return new URL(document.referrer).hostname; }
  catch (_) { /* malformed referrer */ }
  return '';
}

async function siteConfig() {
  if (wantLeague) return;                 // the URL was explicit; leave it alone
  const host = hostOfParent();
  if (!host) return;
  let rows;
  try { rows = await rpc('embed_config', { p_host: host, p_kind: 'strip' }); }
  catch (_) { return; }                   // no rule, no change
  const c = rows && rows[0];
  if (!c) return;
  wantLeague = c.league_slug || '';
  wantTeam = c.team_slug || '';
  if (c.max_items && !limitFromUrl) limit = Math.min(c.max_items, 40);
  if (c.theme === 'light') document.body.setAttribute('data-theme', 'light');
}
/* THE POLL IS NOW THE SAFETY NET, NOT THE LIVE PATH.

   Scores and the clock come over the broadcast, and a fixture flips to LIVE on
   the frame that says so. What the poll is still for is everything a socket
   cannot tell us: a fixture added or rescheduled, a game finalised by an
   administrator rather than by the scorer, a fixture put back on the listing,
   and the case where the socket never connected at all — a corporate network
   that blocks websockets must still show a strip that works, just not one that
   ticks.

   Twenty seconds rather than a minute when nothing is live, because that is
   also how long a game takes to appear if the socket is blocked. Four seconds
   while something is live, unchanged: cheap, and it corrects anything the
   broadcast missed. */
const POLL_MS = 20000;
const POLL_LIVE_MS = 4000;

/* Appearance from the query string.

   ?theme=light for club sites that are not dark, and ?accent / ?accent2 for
   their colours. Both are variable sets rather than second stylesheets, so a
   club gets their own bar without us shipping a copy of the CSS per club.

   A colour is validated before it is used: this string arrives from a URL on
   somebody else's page, and writing it unchecked into a style is how a widget
   becomes an injection point. Only #rgb / #rrggbb is accepted. */
(function appearance() {
  const q = new URLSearchParams(location.search);
  if ((q.get('theme') || '') === 'light') document.body.setAttribute('data-theme', 'light');

  const hex = v => (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(v || '')
    ? (v[0] === '#' ? v : '#' + v) : null);
  const a1 = hex(q.get('accent'));
  const a2 = hex(q.get('accent2')) || a1;
  if (a1) {
    document.body.style.setProperty('--ep-accent', a1);
    document.body.style.setProperty('--ep-accent-2', a2);
  }
  const g = hex(q.get('bg'));
  if (g) document.body.style.setProperty('--ep-ground', g);
})();

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* The host page cannot know how tall this wants to be, so it is posted out and
   embed.js applies it. Called after every render and once after fonts have
   settled, because a face swapping in changes the card height.

   The message is deliberately shaped like the other embeds' — an iframe on
   somebody else's page is identified by that key, not by its origin. */
function postHeight() {
  try {
    parent.postMessage({ epinoiaEmbed: 'height',
                         height: document.body.scrollHeight }, '*');
  } catch (_) { /* not framed, or a host that refuses messages */ }
}

/* a three-letter code is what fits a card; prefer the club's own abbreviation */
const abbr = t => ((t && (t.short_name || t.name)) || '???')
  .replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 3).toUpperCase();

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

/* ============================================================================
   THE LIVE PATH.

   Everything below is what turns the strip from a thing that reloads into a
   thing that ticks. Three sources, in order of how quickly they answer:

     1. the broadcast    game:<uuid>, the scorer's own frames. Score, period,
                         clock and running-state, about a quarter of a second
                         after the statistician's thumb. This is the hot path.
     2. game_state       the durable mirror of exactly the same fields, read
                         once on load so somebody arriving mid-game sees a
                         clock immediately instead of waiting up to five
                         seconds for the next heartbeat frame.
     3. the games row    home_score / away_score, mirrored by the scorer. The
                         safety net, and all a finished game ever needs.

   THE CLOCK IS NOT STREAMED, IT IS TICKED. A frame carries clock_ms and
   whether it is running; between frames the strip counts down locally from the
   moment the frame arrived. That is zero bandwidth for a smooth clock, and
   because a frame lands every couple of seconds while play is on, local drift
   is corrected before anyone could see it. Measuring from arrival rather than
   from the frame's own timestamp also means a viewer whose device clock is
   wrong still sees the right time — there is no skew to get wrong.
   ========================================================================== */

/* Latest known live state per game id, plus the local instant it arrived. */
const LIVE = new Map();
/* Latest polled row per game id — what render() drew from. */
const ROWS = new Map();

let rt = null;
function realtime() {
  if (rt !== null) return rt;
  rt = (window.EpinoiaRT && CFG && CFG.supabaseUrl && CFG.supabaseAnonKey)
    ? window.EpinoiaRT.create({ url: CFG.supabaseUrl, key: CFG.supabaseAnonKey })
    : false;                                  // false = tried and unavailable
  return rt;
}

function noteState(id, state, status) {
  if (!id || !state) return false;
  const was = LIVE.get(id);
  /* A stale frame must never overwrite a newer one. Frames are chained by the
     publisher so they arrive in order, but a resync can deliver an older
     snapshot behind a newer delta. */
  if (was && state.last_seq != null && was.last_seq != null && state.last_seq < was.last_seq)
    return false;
  LIVE.set(id, {
    period: state.period, clock_ms: state.clock_ms, running: !!state.running,
    home: state.score_home, away: state.score_away, last_seq: state.last_seq,
    status: status || (was && was.status) || null,
    at: Date.now(), elapsedBase: 0
  });
  return true;
}

/* How much of the clock has run down since the frame we are holding. */
function clockNow(s) {
  if (!s || s.clock_ms == null) return null;
  if (!s.running) return s.clock_ms;
  return Math.max(0, s.clock_ms - (Date.now() - s.at) - (s.elapsedBase || 0));
}

/* Q1–Q4, then overtime. A league playing halves would want two labels here;
   nothing on the platform does yet, and inventing the second one now would be
   inventing a rule nobody has asked for. */
function periodLabel(p) {
  if (!p) return '';
  return p <= 4 ? 'Q' + p : p === 5 ? 'OT' : 'OT' + (p - 4);
}

/* Broadcast convention: minutes and seconds until the last minute, then
   seconds and tenths, which is what a scoreboard does and what makes the end
   of a close quarter readable. */
function fmtClock(ms) {
  if (ms == null) return '';
  if (ms >= 60000) {
    const t = Math.ceil(ms / 1000);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  return (Math.floor(ms / 100) / 10).toFixed(1);
}

/* The effective status: the database says what a fixture IS, a frame says what
   it is DOING. A frame wins only when it says something has started, because
   that is the transition the poll is too slow for — never the other way, or a
   scorer closing their laptop would un-finish a game. */
/* A GAME BEING WRITTEN UP IS A FINISHED GAME.

   finalise-game sets status='finalising' as a lock, then rebuilds the derived
   tables, the standings, the feeds and the match report before setting
   'final'. That is not instant, and for the whole of it every list on the
   platform read the game as neither live nor final and drew it as an upcoming
   fixture — a completed game showing as not played, while tapping it opened
   the finished box score, because that reads the events rather than the
   status. Worse, the list queries filtered `status=in.(live,scheduled,final)`,
   so the row was not even returned and the card showed whatever it had before.

   Scoring is closed the moment that lock is taken and the score cannot change
   again, so the reader is told what is true: it is finished. */
const DONE = st => st === 'final' || st === 'finalising';

function statusOf(g) {
  const s = LIVE.get(g.id);
  if (g.status === 'scheduled' && s && s.status === 'live') return 'live';
  return DONE(g.status) ? 'final' : g.status;
}

function scoreOf(g) {
  const s = LIVE.get(g.id);
  if (s && s.home != null && statusOf(g) === 'live') return [s.home, s.away];
  return [g.home_score == null ? 0 : g.home_score, g.away_score == null ? 0 : g.away_score];
}

/* ---- painting, without rebuilding ------------------------------------------
   The rail holds two copies of every card so the loop can wrap invisibly, and
   it is dragged and animated continuously. Rebuilding it to change a digit
   would fight the scroll, drop the drag and flicker on somebody's homepage —
   so a score, a clock or a status flip is written straight onto the nodes that
   are already there. Only a change in WHICH games are shown, or their order,
   rebuilds anything. */
function paint() {
  document.querySelectorAll('[data-game]').forEach(node => {
    const g = ROWS.get(node.getAttribute('data-game'));
    if (!g) return;
    const st = statusOf(g), live = st === 'live', final = st === 'final';
    const cls = 'ep-card ' + (live ? 'is-live' : final ? 'is-final' : 'is-upcoming');
    if (node.className !== cls) node.className = cls;

    const label = node.querySelector('.st');
    if (label) {
      if (live) {
        if (!label.querySelector('.dot')) {
          label.textContent = '';
          label.appendChild(el('span', 'dot'));
          label.appendChild(document.createTextNode('LIVE'));
        }
      } else {
        const want = final ? 'FT' : 'PREVIEW & INFO';
        if (label.textContent !== want) label.textContent = want;
      }
    }

    const sc = node.querySelector('.sc');
    const mid = node.querySelector('.mid');
    if ((live || final) && mid) {
      const [h, a] = scoreOf(g);
      if (!sc) { mid.textContent = ''; mid.appendChild(scoreEl(h, a)); }
      else {
        const vs = sc.querySelectorAll('.v');
        if (vs[0] && vs[0].textContent !== String(h)) vs[0].textContent = String(h);
        if (vs[1] && vs[1].textContent !== String(a)) vs[1].textContent = String(a);
      }
    }

    /* The clock replaces the venue on a live card. A venue is worth reading
       before tip-off and worth nothing during the third quarter, when the one
       thing a glance wants is how long is left. */
    const vn = node.querySelector('.vn');
    if (vn) {
      const s = LIVE.get(g.id);
      const ms = live ? clockNow(s) : null;
      const want = live
        ? (ms == null ? (g.venue || 'in progress')
                      : (periodLabel(s.period) + ' · ' + fmtClock(ms)))
        : fmtDate(g.tipoff_at);
      if (vn.textContent !== want) vn.textContent = want;
      vn.classList.toggle('clock', live && ms != null);
    }
  });
  tickCadence();
}

function scoreEl(h, a) {
  const sc = el('div', 'sc');
  sc.append(el('span', 'v', String(h)), el('span', 'd', '–'), el('span', 'v', String(a)));
  return sc;
}

/* The repaint beat only exists while a clock is actually running: a stopped
   clock during a dead ball, or a strip with nothing live on it, costs nothing.
   Four times a second is enough for tenths to look continuous without being a
   timer that matters on somebody else's page. */
let tickTimer = null;
function tickCadence() {
  const running = Array.from(LIVE.values()).some(s => s.running);
  const anyLiveCard = Array.from(ROWS.values()).some(g => statusOf(g) === 'live');
  if (running && anyLiveCard) {
    if (!tickTimer) tickTimer = setInterval(paint, 250);
  } else if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

/* ---- which games are worth a socket ----------------------------------------
   Every live game, plus anything scheduled close enough to its tip-off that it
   could start while somebody is looking. The second half is what makes the
   flip to LIVE instant: the scorer starts broadcasting the moment it claims a
   fixture, so if the strip is already listening the card changes on the same
   frame the statistician presses start. Without it the flip waits for a poll.

   Capped, because this runs on other people's pages and a league with thirty
   fixtures in one evening should not open thirty channels on a visitor's
   browser. Live games are never cut — they are the reason for the file. */
const NEAR_TIP_MS = 4 * 3600 * 1000;
const MAX_CHANNELS = 8;

function watchable(gs) {
  const now = Date.now();
  /* statusOf, NOT g.status. The scorer broadcasts its first live frame around
     the same moment it writes status='live', and the reload that frame triggers
     can easily read the row a beat before the write lands. Judging on the table
     alone therefore dropped the channel at the precise instant the game went
     live, and the strip went deaf until a poll put it back — the one failure
     this whole file exists to prevent. A frame that says live keeps its socket. */
  const live = gs.filter(g => statusOf(g) === 'live');
  const near = gs.filter(g => statusOf(g) === 'scheduled' && g.tipoff_at &&
    Math.abs(new Date(g.tipoff_at).getTime() - now) < NEAR_TIP_MS);
  return live.concat(near).slice(0, MAX_CHANNELS).map(g => 'game:' + g.id);
}

/* ---- the announcement -------------------------------------------------------
   A strip cannot listen to a game it does not know is being played, and it only
   holds channels for live fixtures and ones near their tip-off. A fixture
   scheduled for next Sunday that tips this morning was therefore found only by
   the fallback poll, and took half a minute to show as live.

   The scorer announces every status change on one fixed topic, which this joins
   for as long as it is on the page. Hearing one is a reason to LOOK, not a fact
   to display: the fixtures table is re-read and that decides what is shown, so
   a forged message costs one query and can change nothing. The optimistic flip
   below is the single exception, and it only ever runs for a game already on
   this strip whose row we are re-reading in the same breath. */
const ANNOUNCE_TOPIC = 'epinoia:live';
let announceTimer = null;
function onAnnounce(msg) {
  if (!msg || !msg.gameId || !msg.status) return;
  if (msg.status === 'live' && ROWS.has(msg.gameId)) {
    const held = LIVE.get(msg.gameId);
    if (held) held.status = 'live';
    else LIVE.set(msg.gameId, { status: 'live', at: Date.now(), clock_ms: null, running: false });
    paint();                                   // looks right within the frame
  }
  /* Coalesced: finalising publishes a roster change and a status in the same
     breath, and two reloads a millisecond apart would be one wasted query. */
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => load().catch(() => {}), 60);
}

function onFrame(frame, event) {
  if (event === 'status') return onAnnounce(frame);
  if (!frame || !frame.gameId) return;
  const status = frame.game && frame.game.status;
  const changed = noteState(frame.gameId, frame.state, status);
  if (!changed && !status) return;
  const row = ROWS.get(frame.gameId);
  /* A fixture that has just started, or just finished, changes the ORDER of
     the strip as well as one card — live games sort to the front. Repaint now
     so it looks right within the frame, and reload so it is right. */
  if (row && status && status !== row.status && (status === 'live' || status === 'final')) {
    paint();
    load().catch(() => {});
    return;
  }
  paint();
}

function syncWatch(gs) {
  const client = realtime();
  if (!client) return;
  /* The announce topic is never dropped. It is how a game nobody is watching
     yet gets noticed at all, so it has to outlive every change to the list. */
  client.only([ANNOUNCE_TOPIC].concat(watchable(gs)), onFrame);
}

/* ---- the durable mirror, read once per structural change -------------------
   A viewer opening a page in the middle of a quarter should not stare at a
   card with no clock on it until the scorer's next heartbeat. game_state holds
   the same fields the broadcast carries, so one small read fills the gap.

   THE ELAPSED TIME IS MEASURED IN SERVER TIME. updated_at is the server's
   clock and the response's own Date header is the same clock a moment later,
   so the difference is how long ago the state was written regardless of what
   the viewer's device believes the time is. Getting this wrong shows a clock
   several minutes out on any machine with a lazy NTP. */
async function loadState(ids) {
  if (!ids.length) return;
  const q = 'game_state?select=game_id,period,clock_ms,running,score_home,score_away,' +
            'last_seq,updated_at&game_id=in.(' + ids.join(',') + ')';
  let rows, serverNow;
  try {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${q}`,
      { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
    if (!r.ok) return;
    serverNow = Date.parse(r.headers.get('date') || '') || Date.now();
    rows = await r.json();
  } catch (_) { return; }

  rows.forEach(row => {
    const held = LIVE.get(row.game_id);
    /* A frame already heard is fresher than anything a table can offer. */
    if (held && held.last_seq != null && row.last_seq != null && row.last_seq <= held.last_seq) return;
    if (!noteState(row.game_id, row, held && held.status)) return;
    const s = LIVE.get(row.game_id);
    s.elapsedBase = Math.max(0, serverNow - Date.parse(row.updated_at || '') || 0);
  });
  paint();
}

function fmtDate(iso) {
  if (!iso) return 'TBC';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
    .replace(/^0/, '').toUpperCase();
}

function card(g) {
  const phase = statusOf(g);
  const live = phase === 'live', final = phase === 'final';
  const a = document.createElement('a');
  a.className = 'ep-card ' + (live ? 'is-live' : final ? 'is-final' : 'is-upcoming');
  /* paint() finds its cards by this, and finds BOTH copies of each — the rail
     holds the list twice so the scroll can wrap invisibly. */
  a.setAttribute('data-game', g.id);
  a.target = '_blank'; a.rel = 'noopener';
  a.href = new URL('../../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase',
                   location.href).href;

  /* competition and state, small, above the scoreboard */
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'comp', (g.competitions && g.competitions.name) || 'Fixture'));
  const st = el('span', 'st');
  if (live) { st.appendChild(el('span', 'dot')); st.appendChild(document.createTextNode('LIVE')); }
  /* A scheduled fixture is not a placeholder any more — it has a page with the
     venue, a map and a written preview behind it, and "UPCOMING" said nothing
     about that. Saying so is the difference between a card people ignore until
     tip-off and one worth pressing the week before. */
  else st.textContent = final ? 'FT' : 'PREVIEW & INFO';
  meta.appendChild(st);
  a.appendChild(meta);

  /* home | score | away, laid out across as a scoreboard is */
  const row = el('div', 'row');
  const side = (t, sc, other) => {
    const box = el('div', 'tm' + (final ? (sc > other ? ' win' : sc < other ? ' lose' : '') : ''));
    const cr = el('span', 'crest', abbr(t).slice(0, 2));
    cr.style.background = (t && t.colour) || '#93f2bf';
    box.append(cr, el('span', 'abbr', abbr(t)));
    return box;
  };
  row.appendChild(side(g.home, g.home_score, g.away_score));

  const mid = el('div', 'mid');
  if (live || final) {
    const [h, aw] = scoreOf(g);
    mid.appendChild(scoreEl(h, aw));
  } else {
    mid.appendChild(el('div', 'vs', 'v'));
  }
  row.appendChild(mid);
  row.appendChild(side(g.away, g.away_score, g.home_score));
  a.appendChild(row);

  /* On a live card the left slot is the game clock, which paint() then keeps
     ticking. Until a frame arrives it holds the venue, so a game being scored
     by somebody who is offline still reads sensibly rather than showing an
     empty gap where a clock should be. */
  const s = live ? LIVE.get(g.id) : null;
  const ms = live ? clockNow(s) : null;
  const when = el('div', 'when');
  const vn = el('span', 'vn', live
    ? (ms == null ? (g.venue || 'in progress') : periodLabel(s.period) + ' · ' + fmtClock(ms))
    : fmtDate(g.tipoff_at));
  if (live && ms != null) vn.classList.add('clock');
  when.appendChild(vn);
  when.appendChild(el('span', null,
    live ? 'watch ↗' : final ? fmtTime(g.tipoff_at) : fmtTime(g.tipoff_at) + ' · preview ↗'));
  a.appendChild(when);
  return a;
}

/* live first, then what is coming, then what is done — a strip is glanced at */
const RANK = { live: 0, scheduled: 1, final: 2 };
function order(a, b) {
  const r = RANK[a.status] - RANK[b.status];
  if (r) return r;
  const ta = new Date(a.tipoff_at || 0), tb = new Date(b.tipoff_at || 0);
  return a.status === 'final' ? tb - ta : ta - tb;   // upcoming ascending, finished descending
}

/* the rules are read through a function rather than the table, so the answer is
   one row of slugs rather than a join the embed would have to unpick */
async function rpc(fn, args) {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
               Accept: 'application/json' },
    body: JSON.stringify(args || {})
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let lastKey = '';
/* set by load(); the poll cadence reads it. A flag rather than re-parsing
   lastKey, which is a rendering fingerprint and not a place to keep facts. */
let liveNow = false;

async function load() {
  let sel = 'games?select=id,tipoff_at,status,venue,home_score,away_score,' +
    'home:home_team_id(slug,name,short_name,colour),away:away_team_id(slug,name,short_name,colour),' +
    'competitions(name,seasons(leagues(slug,name)))' +
    '&status=in.(live,scheduled,final,finalising)&order=tipoff_at.desc&limit=60';

  /* LIVE GAMES ARE FETCHED SEPARATELY, AND ALWAYS.

     The list above is ordered tipoff_at.desc and capped at 60, which is fine
     until a league has more than sixty fixtures still to come — and then desc
     puts next May at the top and a game being played this evening falls off the
     end of the window. The strip would show everything except the one thing
     somebody is looking for.

     So live games get their own query. It is tiny (there are rarely more than
     a handful anywhere on the platform), it has no date window to fall out of,
     and the two results are merged by id. A live game cannot be missed now
     however many fixtures surround it. */
  let gs, live = [];
  try {
    [gs, live] = await Promise.all([
      api(sel),
      api('games?select=id,tipoff_at,status,venue,home_score,away_score,' +
          'home:home_team_id(slug,name,short_name,colour),away:away_team_id(slug,name,short_name,colour),' +
          'competitions(name,seasons(leagues(slug,name)))' +
          '&status=eq.live&order=tipoff_at.asc&limit=40').catch(() => [])
    ]);
    const seen = new Set(gs.map(g => g.id));
    live.forEach(g => { if (!seen.has(g.id)) gs.push(g); });
  }
  catch (e) {
    if (!lastKey) {           // keep whatever is on screen if a refresh fails
      $('#rail').textContent = '';
      $('#rail').appendChild(el('div', 'ep-empty', 'Fixtures unavailable'));
    }
    return;
  }

  if (wantLeague) {
    gs = gs.filter(g => {
      const l = g.competitions && g.competitions.seasons && g.competitions.seasons.leagues;
      return l && l.slug === wantLeague;
    });
  }
  /* A CLUB'S OWN SITE SHOWS THE CLUB'S OWN GAMES. Filtered here rather than in
     the query because the strip already holds both sides of every fixture, and
     a second round trip to narrow a list it is already carrying would be a
     round trip for nothing. */
  if (wantTeam) {
    gs = gs.filter(g => (g.home && g.home.slug === wantTeam) ||
                        (g.away && g.away.slug === wantTeam));
  }
  gs.sort(order);
  /* The cap trims the tail, never the head, and order() has already put every
     live game there — so asking for four fixtures while five are live shows
     five. Cutting a live game to honour ?n= would be honouring the wrong
     number: n is how much of the schedule to show, not a reason to hide a game
     that is being played. */
  const liveCount = gs.filter(g => statusOf(g) === 'live').length;
  liveNow = liveCount > 0;
  gs = gs.slice(0, Math.max(limit, liveCount));

  /* Rows first: paint() and statusOf() both read through this, and a frame can
     arrive between here and the render below. */
  ROWS.clear();
  gs.forEach(g => ROWS.set(g.id, g));
  syncWatch(gs);
  loadState(gs.filter(g => statusOf(g) === 'live').map(g => g.id)).catch(() => {});

  /* REBUILD ONLY WHEN THE SET OF CARDS CHANGES — which games, in which order,
     in which state. A score is deliberately NOT part of this fingerprint any
     more: paint() writes digits onto the cards that are already there, so a
     basket no longer tears down a rail that is mid-drag, and a poll returning
     a score a few seconds behind the broadcast can no longer stomp on it. */
  const key = gs.map(g => g.id + ':' + statusOf(g)).join('|');
  if (key === lastKey) { paint(); return; }
  lastKey = key;

  const rail = $('#rail');
  rail.textContent = '';
  if (!gs.length) {
    rail.appendChild(el('div', 'ep-empty', 'No fixtures'));
  } else {
    /* Two copies. The loop wraps at the halfway mark, where the halves are
       pixel-identical, so the seam is invisible. The duplicate is hidden from
       assistive technology — it is the same fixtures a second time, and a
       screen reader should not read the list twice. */
    gs.forEach(g => rail.appendChild(card(g)));
    const dup = document.createElement('div');
    dup.style.cssText = 'display:contents';
    dup.setAttribute('aria-hidden', 'true');
    gs.forEach(g => { const c = card(g); c.tabIndex = -1; dup.appendChild(c); });
    rail.appendChild(dup);
  }
  paint();
  postHeight();
  startMotion();
}


/* ============================================================================
   MOTION — it scrolls itself, and you can throw it.

   The bar drifts left continuously so a page with it on looks alive without
   anyone touching it, and stops the moment a pointer is over it, because
   something moving under the cursor you are trying to click is infuriating.

   Dragging is a real throw, not a scrollbar. Velocity is sampled over the last
   few pointer moves and carried on after release with exponential decay, so a
   flick coasts and a slow drag stops where you left it. The decay constant is
   applied per frame at 60fps and normalised by the real frame time, so it
   behaves the same on a 144Hz screen as on a 60Hz one.

   The list is duplicated once and the scroll position wraps at the halfway
   point, which is what makes the loop seamless — at the wrap the two halves
   are pixel-identical, so nothing visibly jumps.

   None of it runs for a reader who has asked for reduced motion.
   ============================================================================ */
const REDUCED = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SPEED = 0.28;        // px per frame at 60fps — a drift, not a carousel
const FRICTION = 0.94;     // per 60fps frame; a flick coasts about a second
const MIN_V = 0.04;        // below this, momentum has finished

/* When the reader last touched the bar. The drift resumes IDLE_MS after, so
   nothing can leave it permanently stopped. */
let lastTouch = 0;
const IDLE_MS = 1400;
const touch = () => { lastTouch = Date.now(); };
const idle = () => !REDUCED && (Date.now() - lastTouch > IDLE_MS);

let velocity = 0;
let dragging = false;
let pointerId = null;
let lastX = 0, lastT = 0;
let rafId = null;

/* The rail holds two copies of the fixture list. Wrapping at the halfway mark
   is invisible because the halves are identical there. */
function halfWidth() {
  const rail = $('#rail');
  return rail.scrollWidth / 2;
}

function wrap() {
  const rail = $('#rail');
  const half = halfWidth();
  if (half < 8) return;
  if (rail.scrollLeft >= half) rail.scrollLeft -= half;
  else if (rail.scrollLeft < 0) rail.scrollLeft += half;
}

function tick(now) {
  const rail = $('#rail');
  const dt = lastT ? Math.min(4, (now - lastT) / 16.667) : 1;   // in 60fps frames
  lastT = now;

  if (!dragging) {
    if (Math.abs(velocity) > MIN_V) {
      rail.scrollLeft += velocity * dt;
      velocity *= Math.pow(FRICTION, dt);
    } else {
      velocity = 0;
      if (idle()) rail.scrollLeft += SPEED * dt;
    }
    wrap();
  }
  rafId = requestAnimationFrame(tick);
}

function startMotion() {
  if (REDUCED || rafId) return;
  lastT = 0;
  rafId = requestAnimationFrame(tick);
}

/* ---- pointer drag, with a real throw ---- */
/* THE POINTER IS NOT CAPTURED UNTIL A DRAG HAS ACTUALLY BEGUN.

   Capturing on pointerdown is what stopped a card from opening: with the
   pointer captured by the rail, the click never reaches the anchor inside it,
   so every tap on a fixture did nothing. The rail now watches the first few
   pixels of movement and only takes the pointer once the gesture is clearly a
   drag — below that threshold it stays a click and the card opens normally.

   The same threshold decides whether to suppress the link afterwards, so
   there is one number governing "was this a click or a throw" rather than two
   that can disagree. */
const DRAG_SLOP = 6;          // px before a press becomes a drag

function wireDrag() {
  const rail = $('#rail');
  let startScroll = 0, startX = 0, moved = 0, armed = false;

  rail.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startScroll = rail.scrollLeft;
    moved = 0; armed = true; dragging = false; velocity = 0;
    touch();
  });

  rail.addEventListener('pointermove', e => {
    if (!armed || e.pointerId !== pointerId) return;
    const total = Math.abs(e.clientX - startX);

    /* below the threshold this is still a click in progress — do not scroll,
       do not capture, do not let go of the card underneath */
    if (!dragging) {
      if (total < DRAG_SLOP) return;
      dragging = true;
      rail.classList.add('dragging');
      try { rail.setPointerCapture(e.pointerId); } catch (_) {}
    }

    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    rail.scrollLeft = startScroll - (e.clientX - startX);
    /* velocity from the last move, not the whole gesture, so a drag that
       stops before release does not fling */
    velocity = -dx;
    wrap();
    touch();
  });

  const release = e => {
    if (e && e.pointerId !== pointerId) return;
    if (dragging) {
      try { rail.releasePointerCapture(pointerId); } catch (_) {}
      rail.classList.remove('dragging');
    }
    armed = false; dragging = false; pointerId = null;
    touch();
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);

  /* Only a real drag suppresses the link. A press that never passed the
     threshold is a click and must open the box score. */
  rail.addEventListener('click', e => {
    if (moved > DRAG_SLOP) { e.preventDefault(); e.stopPropagation(); }
    moved = 0;
  }, true);

  /* Pausing on hover used to latch: pointerenter can arrive before the script
     runs, or never fire inside an iframe, leaving the bar stopped forever.
     A last-interaction timestamp cannot latch — the drift resumes on its own
     a moment after the reader stops touching it. */
  rail.addEventListener('pointermove', touch, { passive: true });
  rail.addEventListener('pointerdown', touch, { passive: true });
  rail.addEventListener('focusin', touch);

  /* the wheel scrolls the bar sideways rather than the page */
  rail.addEventListener('wheel', e => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    rail.scrollLeft += d;
    velocity = 0;
    wrap();
    touch();
  }, { passive: false });
}

wireDrag();
/* The site rule is resolved before the first load, so a club's site never shows
   the whole platform for a moment and then narrows to one club. */
siteConfig().catch(() => {}).then(() => load());
/* The cadence follows the games rather than the clock: tight while anything
   is live, relaxed when nothing is. setTimeout rather than setInterval so the
   interval can change between ticks, and so a slow response can never queue a
   second request behind the first. */
let pollTimer = null;
function schedule() {
  clearTimeout(pollTimer);
  const anyLive = liveNow;
  pollTimer = setTimeout(async () => {
    try { await load(); } catch (_) { /* keep polling through a blip */ }
    schedule();
  }, anyLive ? POLL_LIVE_MS : POLL_MS);
}
schedule();
setTimeout(postHeight, 400);
