'use strict';
/* Epinoia home — what's on now, and every league on the platform.
   Anonymous reads only; RLS decides what comes back. A scheduled fixture is
   readable but its detail is not, which is why this page shows fixtures
   without ever asking for a box score. */

const CFG = window.EPINOIA_CONFIG;
const D = window.EpinoiaData;      // shared loader + aggregation
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* This page is two pages. Without ?l= it is the platform hub: every game, every
   league. With ?l= it is that league's SPLASH — the same shape, narrowed to one
   league, with the league directory replaced by that league's own table and
   leaders. One file, because the two differ by a filter and a section, and
   maintaining a near-copy is how they drift. */
const WANT = new URLSearchParams(location.search).get('l') || '';
/* WHICH SEASON THIS PAGE IS ABOUT. Empty means the current one, which is what
   almost every visit is; ?s=2025-26 is a link somebody sent, or a chip in the
   season row below the summaries. Everything on a league's front page that has
   a season — the games list, the clubs field, the stars, the team of the year
   and both embeds — reads it through seasonNow() and follows it. */
const WANT_SEASON = new URLSearchParams(location.search).get('s') || '';
let LEAGUE = null;              // resolved when WANT is set
/* docs/memberships.md: set only on the league splash, and only when the server
   has SAID this viewer may not see a members-only league */
let WALL = { walled: false, fixturesPublic: true };

/* A MEMBERS-ONLY LEAGUE'S ROWS ARE REFUSED to an anonymous read, so a member's
   reads carry their token. access.js decides when (a members-only league this
   viewer may see) and returns {} otherwise — the hub and every open league send
   exactly what they sent before. Asked per request, and a 401 on a token the
   server no longer accepts is asked once more without it. */
/* Set once a PRIVATE league has been resolved for this page (see the ?l= block
   in boot). access.js attaches a token only where it changes the answer for a
   members-only league, which is right — an open league's request stays
   anonymous and cacheable. A private league is the other case where it changes
   the answer, and every read after the league row needs the same treatment: its
   games, standings, clubs and news are all hidden from an anonymous request
   too, so resolving the league and then reading the rest as a stranger would
   draw a league page with nothing in it. */
let AUTHED = false;

function withAuth(headers, anon) {
  const A = window.EpinoiaAccess;
  if (anon || !A) return headers;
  if (AUTHED && typeof A.session === 'function') {
    try {
      const s = A.session();
      if (s && s.token) headers.Authorization = 'Bearer ' + s.token;
    } catch (_) { /* anonymous, as before */ }
    return headers;
  }
  if (typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous, as before */ }
  }
  return headers;
}

async function api(p, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}

/* A READ THAT ALSO SAYS HOW MANY ROWS THE DATABASE HAD. `Prefer: count=exact` puts the total in
   Content-Range even when a limit cut the rows short, which is what the games section's header
   needs: "776 upcoming" is a fact about the league, "60 upcoming" is a fact about the read. */
async function apiPage(p, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, Accept: 'application/json', Prefer: 'count=exact' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`, { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization) return apiPage(p, true);
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  const tail = (r.headers.get('content-range') || '').split('/')[1];
  return { rows: await r.json(), total: tail && /^\d+$/.test(tail) ? +tail : null };
}

/* POST to a function rather than GET a table. The anonymous reads on this
   page all go through PostgREST's table endpoints; the ballot and the socials
   go through SECURITY DEFINER functions instead, because both have to return
   something narrower than the row they read — a shortlist without the minors
   on it, a socials row without the access token. */
async function rpc(fn, args, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
                             Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store',
    headers,
    body: JSON.stringify(args || {})
  });
  if (r.status === 401 && headers.Authorization) return rpc(fn, args, true);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
  return j;
}

function fail(host, msg) {
  const h = $(host); h.textContent = ''; h.appendChild(el('div', 'empty', msg));
}

/* ------------------------------------------------------------- appearance ---
   A league's own colours and its choice of which blocks to show (0053).

   THE COLOURS GO THROUGH setProperty, never into a stylesheet as text. They
   are typed by a league administrator and rendered by every visitor, and a
   custom property set through the CSSOM cannot escape its declaration however
   the value is spelt. The database also refuses anything that is not
   six-digit hex, so this is the second of two locks rather than the only one.

   ABSENT MEANS SHOWN. A section a league has never had an opinion about is
   visible, so adding a section later does not silently hide it for every
   league that existed before it. */
const THEME_VARS = {
  bg: '--ground', panel: '--panel', ink: '--ink',
  rail: '--nav-bg', rail_ink: '--nav-ink', accent: '--lume'
};

function applyTheme(theme) {
  const t = theme || {};
  const root = document.documentElement;
  Object.keys(THEME_VARS).forEach(k => {
    const v = t[k];
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
      root.style.setProperty(THEME_VARS[k], v);
    }
  });
  /* The ink drives two derived tokens the kit fades from it. Recomputing them
     here rather than leaving the defaults means a light-on-dark league that
     switches to dark-on-light does not keep two ghost-grey shades that were
     mixed against the old colour. */
  if (t.ink && /^#[0-9a-f]{6}$/i.test(t.ink)) {
    root.style.setProperty('--ink-2', hexA(t.ink, 0.72));
    root.style.setProperty('--ink-3', hexA(t.ink, 0.52));
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

const SECTION_OF = {
  news: '#newsSec', clubs: '#clubsSec', toty: '#totySec', fanvote: '#fvSec', stars: '#starsSec',
  games: '#gamesSec', season: '#seasonSec', merch: '#merchSec',
  socials: '#socialSec', takepart: '#takepartSec'
};

function sectionOn(key) {
  const s = (LEAGUE && LEAGUE.sections) || {};
  return s[key] !== false;
}

/* Applied AFTER everything has rendered: a hidden section still loads its
   data, which costs a request and buys the ability to turn it back on without
   a reload. The two blocks that hide themselves when empty stay hidden. */
function applySections() {
  Object.keys(SECTION_OF).forEach(key => {
    if (sectionOn(key)) return;
    const node = document.querySelector(SECTION_OF[key]);
    if (node) node.classList.add('hide');
  });
}

/* ------------------------------------------------------------------ games --- */
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

/* WHICH COMPETITION, AND WHAT STATE. The section defaults to the week either side of now across
   every competition; the chips narrow it to one competition (only those that have games appear)
   and to results or upcoming, in which case the list of that kind is shown, latest result first,
   next fixture first.

   WHAT IS READ FOLLOWS WHAT IS SHOWN (epinoia/gameslist.js). This used to read every game of the
   league, newest first, capped at 400, and sort the week out of whatever came back -- so a league
   with more than 400 fixtures showed the LAST 400 of its season and none of the present: B.LEAGUE
   Premier's "this week" listed 21 January and its results were empty (reported 2026-09-24). It
   now asks for the live games, and the results and fixtures the chosen view needs, each ordered
   and limited, and a competition chip narrows the read itself. */
let gamesComp = '', gamesShow = 'week';
const KIND_LABEL = { league: 'league', cup: 'cup', trophy: 'trophy', playoff: 'playoffs', playoffs: 'playoffs', friendly: 'friendly' };

/* WHICH COMPETITIONS GET A CHIP: the season's own that have at least one game, asked once (a row
   each) rather than worked out from whichever games the current view happened to read, which
   would drop a cup whose games all lie beyond the window. The hub has no season, so it offers
   what it has come across. */
const compsSeen = new Map();
let chipCache = null;
async function chipComps() {
  if (LEAGUE) {
    if (!chipCache) {
      chipCache = (async () => {
        const s = await seasonNow();
        const cs = (s && s.comps) || [];
        const has = await Promise.all(cs.map(c =>
          api('games?competition_id=eq.' + encodeURIComponent(c.id) + '&select=id&limit=1').then(r => r.length > 0, () => true)));
        return cs.filter((c, i) => has[i]);
      })();
      chipCache.catch(() => { chipCache = null; });
    }
    try { return await chipCache; } catch (_) { /* the chips fall back to what has been read */ }
  }
  return [...compsSeen.values()];
}

function gamesPicker(comps) {
  const sec = $('#gamesSec'); if (!sec) return;
  let pick = $('#gamesPick');
  if (!pick) { pick = el('div', 'gpick'); pick.id = 'gamesPick'; $('#games').before(pick); }
  pick.textContent = '';
  const chip = (label, on, fn, tag) => {
    const b = el('button', 'ep-chip' + (on ? ' on' : ''), label); b.type = 'button';
    if (tag) { const k = el('small', 'kind', tag); k.setAttribute('data-i18n-ctx', 'kind'); b.appendChild(k); }
    b.addEventListener('click', () => { fn(); gamesKey = ''; games(); });
    return b;
  };
  if (comps.length > 1) {
    const row = el('div', 'grow');
    row.appendChild(chip('all competitions', !gamesComp, () => { gamesComp = ''; }));
    comps.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c =>
      row.appendChild(chip(c.name, gamesComp === c.id, () => { gamesComp = c.id; }, KIND_LABEL[c.kind] || '')));
    pick.appendChild(row);
  }
  const row2 = el('div', 'grow');
  [['week', 'this week'], ['results', 'results'], ['upcoming', 'upcoming']].forEach(([k, label]) =>
    row2.appendChild(chip(label, gamesShow === k, () => { gamesShow = k; })));
  pick.appendChild(row2);
}

/* the columns a row needs: the club's id as well as its name, because a fixture row asks
   initials.js for that club's letters by id (teamName), which is what a phone shows in place of
   a name it has no room for */
const GAMES_SELECT = 'id,tipoff_at,status,home_score,away_score,venue,venue_address,competition_id,' +
  'competitions(id,name,kind),' +
  'home:home_team_id(id,name,short_name,colour,logo_path),away:away_team_id(id,name,short_name,colour,logo_path)';

/* THE NUMBER ON "SHOW ALL": every game the fixtures page would list, counted by the database.
   It moves when a fixture is added, not when a score changes, so it is asked for again every
   five minutes rather than every poll. */
const totalCache = new Map();
async function gamesTotal(scope) {
  const hit = totalCache.get(scope);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.n;
  let n = null;
  try {
    n = (await apiPage('games?select=id&status=in.(live,final,finalising,scheduled)' + scope + '&limit=1')).total;
  } catch (_) { /* the link simply loses its number */ }
  if (n != null) totalCache.set(scope, { n, at: Date.now() });
  return n;
}

/* "Thu 21 Jan · 15:00", the way a fixture row writes it */
function whenText(iso) {
  const when = iso ? new Date(iso) : null;
  if (!when || isNaN(when)) return '';
  return when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
         ' · ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

let gamesSeq = 0;
async function games() {
  /* behind a members-only league's wall with its fixtures private there is nothing
     this viewer may be shown, so the timer below asks for nothing either */
  if (WALL.walled && !WALL.fixturesPublic) return;
  const GL = window.EpinoiaGamesList;
  const mine = ++gamesSeq;                 // a chip pressed while a read is out supersedes it
  const now = Date.now();
  let rows, totals, total, scope = '';
  try {
    if (LEAGUE) {
      /* A game belongs to a competition, which belongs to a season, which
         belongs to a league — so the league's competitions are resolved first
         and the games filtered by them. Two round trips, and no dependence on
         PostgREST resolving a three-deep embedded filter. */
      const comps = await leagueCompetitions();
      if (!comps.length) {
        const host = $('#games'); host.textContent = '';
        host.appendChild(el('div', 'empty', 'No fixtures in this league yet.'));
        return;
      }
      scope = '&competition_id=in.(' + comps.join(',') + ')';
    }
    /* a chosen competition narrows the READ: filtering what came back would find nothing for a
       cup whose games all lie beyond the window */
    if (gamesComp) scope = '&competition_id=eq.' + encodeURIComponent(gamesComp);
    const Q = GL.queries(gamesShow, now, scope);
    const none = { rows: [], total: null };
    const [lv, dn, nx, tot] = await Promise.all([
      apiPage('games?select=' + GAMES_SELECT + Q.live),
      Q.done ? apiPage('games?select=' + GAMES_SELECT + Q.done) : none,
      Q.next ? apiPage('games?select=' + GAMES_SELECT + Q.next) : none,
      gamesTotal(scope)
    ]);
    rows = lv.rows.concat(dn.rows, nx.rows);
    totals = { done: dn.total, next: nx.total };
    total = tot;
  } catch (e) {
    return fail('#games', 'Could not reach the server. ' + e.message);
  }
  if (mine !== gamesSeq) return;
  /* Behind the wall only the fixtures are this viewer's. The database already
     refuses the rest; this keeps the list honest where it has not (a league
     previewed through the admins' access simulation, or before enforcement). */
  if (WALL.walled) rows = rows.filter(g => g.status === 'scheduled');
  rows.forEach(g => { const c = g.competitions; if (c && c.id) compsSeen.set(c.id, c); });

  /* NOTHING CHANGED, NOTHING REDRAWN.

     This is now re-run on a timer and whenever a scorer announces a status
     change, so it has to be cheap to call when the answer is the same as last
     time. Rebuilding fifteen rows every half minute would throw away focus,
     restart the crest animations and flash the section for no reason. The
     fingerprint is what a reader would notice: which games, in what state, at
     what score -- and the hour, because "this week" moves with the clock even
     when no game does. */
  const key = gamesComp + '/' + gamesShow + '|' + Math.floor(now / 3600000) + '|' + total + '|' +
                     totals.done + '/' + totals.next + '|' + rows.map(g => g.id + ':' + g.status + ':' +
                     g.home_score + '-' + g.away_score).join('|');
  if (key === gamesKey && $('#games').childElementCount) return;

  const comps = await chipComps();
  const v = GL.pick(rows, gamesShow, now, totals);
  /* an empty week is an answer; "the next game is on the 2nd" is a better one */
  let next = null;
  if (!v.shown.length && gamesShow === 'week' && total !== 0) {
    try { next = (await api('games?select=id,tipoff_at' + GL.after(now, scope)))[0] || null; }
    catch (_) { /* the sentence below simply says less */ }
  }
  if (mine !== gamesSeq) return;
  gamesKey = key;

  gamesPicker(comps);
  const host = $('#games'); host.textContent = '';
  if (total === 0) {
    host.appendChild(el('div', 'empty',
      'No games yet. A fixture appears here as soon as a league schedules one.'));
    return;
  }
  $('#gamesNote').textContent = v.note;
  showAllLink(total);
  if (!v.shown.length) {
    if (gamesShow === 'upcoming') host.appendChild(el('div', 'empty', 'No upcoming fixtures.'));
    else if (gamesShow === 'results') host.appendChild(el('div', 'empty', 'No results yet.'));
    else if (next && next.tipoff_at) {
      const b = el('div', 'empty', 'Next: ' + whenText(next.tipoff_at));
      b.style.paddingTop = '0';
      host.append(el('div', 'empty', 'Nothing this week.'), b);
    } else {
      host.appendChild(el('div', 'empty',
        'Nothing in the last week and nothing scheduled. The full fixture list is ' +
        'still there — see all fixtures.'));
    }
    return;
  }
  const gs = v.shown;

  gs.forEach(g => {
    const final = DONE(g.status), live = g.status === 'live';
    /* a scheduled fixture is a link too — same reasoning as the fixtures page */
    const row = el('a', 'fx');
    row.href = 'game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';

    const h = el('div', 'tn h'), a = el('div', 'tn');
    if (window.epinoiaCrest) {
      h.append(teamName(g.home), window.epinoiaCrest(g.home, { cls: 'fxcrest' }));
      a.append(window.epinoiaCrest(g.away, { cls: 'fxcrest' }), teamName(g.away));
    } else { h.appendChild(teamName(g.home)); a.appendChild(teamName(g.away)); }
    if (final) {
      if (g.home_score > g.away_score) h.style.color = 'var(--lume)';
      if (g.away_score > g.home_score) a.style.color = 'var(--lume)';
    }

    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    const st = el('div', 'st ' + (live ? 'live' : final ? 'final' : 'sched'));
    if (live) { st.appendChild(el('span', 'pulse')); st.appendChild(document.createTextNode('LIVE')); }
    else if (final) st.textContent = 'FINAL';
    else {
      /* The date stays the headline — it is what somebody scans a fixture list
         for — with a quiet second line saying the row leads somewhere. A
         scheduled fixture now has a venue, a map and a written preview behind
         it, and nothing on the row said so. */
      st.textContent = when
        ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        : 'TBC';
      st.appendChild(el('span', 'pv-flag', 'preview'));
    }

    row.append(h, el('div', 'sc', final || live ? `${g.home_score}–${g.away_score}` : 'v'), a, st);
    if (window.EpinoiaFollow && !final) row.appendChild(window.EpinoiaFollow.bell('game', g.id, { cls: 'fxbell' }));
    else row.appendChild(el('span', 'fxbell'));

    /* Where and when, on a line of its own. A fixture list without a venue is
       a list you have to ask somebody about. */
    const bits = [];
    if (when) bits.push(whenText(g.tipoff_at));
    if (g.venue) bits.push(g.venue);
    if (bits.length) row.appendChild(el('div', 'fxwhere', bits.join('  ·  ')));

    host.appendChild(row);
  });
}

/* ---------------------------------------------------------------------------
   THE LIST KEEPS ITSELF HONEST.

   The fixtures page has re-read its games on a timer for a while; this one
   never did, so a league's own front page could sit showing a game as upcoming
   while it was being played, or as live an hour after it finished, until
   somebody reloaded. It is the page most likely to be left open on a second
   monitor through an evening, which makes it the worst one to be stale.

   Two mechanisms, same as the strip and the fixtures page. The announcement is
   the fast path: the scorer publishes a status change on one fixed topic and
   this re-reads within a moment of hearing it. The timer is the floor, and
   covers everything a scorer cannot announce — a fixture added or moved in the
   admin console, a game finalised by an administrator, or a network that will
   not open a websocket at all. */
const GAMES_LIVE_MS = 15000, GAMES_IDLE_MS = 30000;
let gamesKey = '';
let gamesTimer = null;
let gamesRt = null;

function anyLiveShown() {
  return !!document.querySelector('#games .fxrow.live, #games .live');
}

function watchGames(delay) {
  clearTimeout(gamesTimer);
  gamesTimer = setTimeout(async () => {
    /* A TAB NOBODY IS LOOKING AT DOES NOT POLL. This re-read is up to 400 games every 15 to 30
       seconds, and it ran in every tab left open in the background, all evening. A hidden tab
       now skips its turn and catches up the moment it is shown again (below). */
    if (!(typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
      try { await games(); } catch (_) { /* a blip must not stop the watch */ }
    }
    watchGames();
  }, delay != null ? delay : (anyLiveShown() ? GAMES_LIVE_MS : GAMES_IDLE_MS));
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && gamesTimer) watchGames(0);
  });
}

/* The message is a nudge to look, never a fact to show: the games table still
   decides what is rendered, so anything forged on the topic costs one query. */
function watchGameAnnouncements() {
  if (gamesRt || !window.EpinoiaRT || !window.EPINOIA_CONFIG) return;
  gamesRt = window.EpinoiaRT.create({ url: window.EPINOIA_CONFIG.supabaseUrl,
                                      key: window.EPINOIA_CONFIG.supabaseAnonKey });
  if (!gamesRt) return;
  let soon = null;
  gamesRt.watch('epinoia:live', () => {
    /* This page shows live games across the whole platform, so unlike an
       embedded strip it genuinely wants every announcement. What it does not
       want is to ask at the same instant as everybody else who heard the same
       message — hence the scatter. */
    clearTimeout(soon);
    soon = setTimeout(() => watchGames(0), 80 + Math.random() * 1200);
  });
}

/* the way through to the whole list, next to the heading rather than at the
   bottom — somebody who wants everything decides that before reading fifteen */
function showAllLink(total) {
  const head = $('#gamesHead');
  if (!head) return;
  head.textContent = '';
  const a = el('a', 'showall', 'show all' + (total ? ' (' + total + ')' : '') + ' →');
  /* the fixture list opens on the season this page is showing */
  a.href = 'fixtures/' + (LEAGUE ? '?l=' + encodeURIComponent(LEAGUE.slug) + seasonQuery() : '');
  head.appendChild(a);
}

/* ---------------------------------------------------------------- leagues --- */
async function leagues() {
  let ls;
  try { ls = await api('leagues?select=id,slug,name,colour_a&order=name'); }
  catch (e) { return fail('#leagues', 'Could not reach the server. ' + e.message); }

  const host = $('#leagues'); host.textContent = '';
  if (!ls.length) {
    host.appendChild(el('div', 'empty', 'No leagues yet.'));
    return;
  }

  // one request for every league's season count rather than one per league
  let seasons = [];
  try {
    seasons = await api('seasons?select=league_id,name,starts_on&order=starts_on.desc');
  } catch (_) { /* the list still renders without it */ }
  const latest = new Map();
  seasons.forEach(s => { if (!latest.has(s.league_id)) latest.set(s.league_id, s.name); });

  ls.forEach(l => {
    const row = el('a', 'lg');
    row.href = 'l/?l=' + encodeURIComponent(l.slug);
    const cr = el('div', 'cr', (l.name || '?').slice(0, 2).toUpperCase());
    cr.style.background = l.colour_a || 'var(--lume)';
    const mid = el('div');
    mid.append(el('div', 'nm', l.name),
               el('div', 'sub', latest.get(l.id) || 'No season yet'));
    row.append(cr, mid, el('div', 'go', '›'));
    host.appendChild(row);
  });
}

/* ------------------------------------------------------------ the season ---
   WHICH SEASON, ASKED ONCE, ANSWERED FOR THE WHOLE PAGE.

   Every section that shows a season used to work it out for itself, and none
   of them could be sent anywhere else: the games list took every competition
   of every season, the clubs grid read the newest season back out of the
   database again, and the team of the year walked them all. Measured before:
   seasons and competitions were each requested three times on one load.

   seasonbar.js now answers all of it in one shared read — which seasons a
   reader may go to (a season with no games at all is not one), which is the
   default, and every season's competitions with them. ?s= picks; the sections
   below simply read what it settled on, so a link to last season opens the
   whole page on last season rather than one panel of it. */
let SEASON = null;                 // the chosen season row, with its `comps`
let SEASONS = [];                  // what the chip row offers, newest first
let SEASON_CURRENT = null;         // the default, so a link can say when it differs
let seasonP = null;

function seasonNow() {
  if (seasonP) return seasonP;
  seasonP = (async () => {
    const o = await window.EpinoiaSeasonBar.load(api, LEAGUE.id);
    SEASONS = o.list;
    SEASON_CURRENT = o.current;
    SEASON = window.EpinoiaSeasonBar.pick(o.list, WANT_SEASON);
    return SEASON;
  })();
  /* A failure must not be remembered — a section that retries later should get
     a real attempt, not a cached rejection from a blip. */
  seasonP.catch(() => { seasonP = null; });
  return seasonP;
}

/* The competitions this page is reading — the chosen season's, not every one
   the league has ever run. The games list, the stars and the team of the year
   all scope themselves by this, so a page opened at ?s=2025-26 shows that
   season's games and that season's ballot rather than this one's. */
async function leagueCompetitions() {
  const s = await seasonNow();
  return s ? s.comps.map(c => c.id) : [];
}

/* ?s= on a link out of this page, and only when it is worth carrying: the
   current season is what every page opens on by itself, so spelling it out
   would put a parameter on every link on the platform for nothing. */
function seasonQuery() {
  return (SEASON && SEASON_CURRENT && SEASON.id !== SEASON_CURRENT.id)
    ? '&s=' + encodeURIComponent(SEASON.name) : '';
}

/* ---------------------------------------------------- the season's fields ---
   WHICH CLUBS ARE IN WHICH COMPETITION, for the season being shown only — last
   season's entries are not this season's field and would put a club that has
   since dropped out back on the page.

   Two requests now, once per page, cached: who is entered in the season's
   competitions (competition_teams, which the ingest maintains by the act of
   filing fixtures) and the fixtures themselves — which say which competitions
   are actually being played. The competitions no longer cost a read of their
   own: seasonNow() has them. comps.js turns the answer into the fields. A
   failure anywhere gives null, and every caller falls back to the plain
   league-wide list it showed before. */
let fieldsCache = null;
function seasonFields() {
  if (fieldsCache) return fieldsCache;
  const p = (async () => {
    const C = window.EpinoiaComps;
    if (!C) return null;
    const season = await seasonNow();
    if (!season) return null;
    const comps = season.comps;
    if (!comps.length) return null;
    const ids = comps.map(c => c.id);
    const [entries, gs] = await Promise.all([
      C.entriesFor(api, ids),
      api('games?competition_id=in.(' + ids.join(',') +
          ')&select=competition_id,home_team_id,away_team_id&limit=4000').catch(() => [])
    ]);
    return C.read({ comps, entries, games: gs });
  })();
  p.catch(() => { fieldsCache = null; });
  fieldsCache = p;
  return p;
}

/* ------------------------------------------------------------- the clubs ---
   Every club in the league, each card a print rather than a tile.

   A logo goes in the middle where one exists. None do yet, so the MONOGRAM has
   to be the artwork and not an apology for a missing image — which is why it
   is set in the scoreboard face at plate size, printed twice with the second
   pass out of register, over a halftone in the club's own ink.

   The initials come from the club's short name where it has one, because that
   is what the club calls itself, and are derived only as a fallback. */
/* the card in the club's two colours, with text-safe inks (teamcolour.js); the one-colour
   fallback when the helper is not on the page */
function paintCard(a, colour, colour2) {
  const TC = window.EpinoiaTeamColour;
  if (TC && TC.card) TC.card(a, colour || '#93f2bf', colour2);
  else a.style.setProperty('--ink-c', colour || '#93f2bf');
}

/* A CLUB'S NAME IN A FIXTURE ROW, AND ITS LETTERS FOR A PHONE. Three columns of full names on
   a 390px screen left "Yorkshire Dragons" as "YO…" and "Derby Trailblazers" as "DE…" — every
   row the same two letters and a full stop, which says nothing (reported 2026-09-18). Both are
   written; the stylesheet shows whichever fits. The letters are the league's own unique codes
   (initials.js) once they have loaded, the club's short name until then, and the title and the
   row's own aria-label keep the full name for a reader who cannot see either. */
function teamName(team) {
  const t = team || {};
  const name = t.name || '—';
  const sp = el('span', 'tnm');
  sp.title = name;
  sp.appendChild(el('span', 'full', name));
  const I = window.EpinoiaInitials;
  const code = I && typeof I.code === 'function' ? I.code(t) : '';
  const short = el('span', 'short', code || monogram(t));
  if (t.id) {
    short.setAttribute('data-initials-team', t.id);
    if (code) short.classList.add('is-code');
    if (I && typeof I.want === 'function' && LEAGUE && LEAGUE.id) I.want(LEAGUE.id);
  }
  sp.appendChild(short);
  return sp;
}

function monogram(t) {
  const s = (t.short_name || '').trim();
  if (s) return s.slice(0, 3).toUpperCase();
  const words = (t.name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (t.name || '?').slice(0, 2).toUpperCase();
}

/* THE GRID ITSELF, lifted out of clubs() so the competition buttons can
   redraw it without re-fetching a thing. */
function clubGrid(ts, logos) {
  const grid = el('div', 'clubgrid');
  ts.forEach((t, i) => {
    const a = el('a', 'club');
    a.href = 't/?t=' + encodeURIComponent(t.slug || '');
    paintCard(a, t.colour, t.colour_2);
    a.setAttribute('aria-label', t.name);

    const plate = el('div', 'club-plate');
    plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
    ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

    const mark = el('div', 'club-mark');
    /* an approved upload first; else the crest the club's feed publishes */
    const url = logos.get(t.id) || (window.epinoiaLogoUrl ? window.epinoiaLogoUrl(t.logo_path) : null);
    if (url) {
      const img = document.createElement('img');
      img.className = 'club-logo';
      img.src = url; img.alt = '';
      img.loading = 'lazy';
      /* a logo that fails to load must fall back to the monogram rather than
         leaving a hole where the club's identity should be */
      img.addEventListener('error', () => {
        img.remove();
        mark.append(el('span', 'club-mono ghost', monogram(t)),
                    el('span', 'club-mono', monogram(t)));
      });
      mark.appendChild(img);
    } else {
      mark.append(el('span', 'club-mono ghost', monogram(t)),
                  el('span', 'club-mono', monogram(t)));
    }
    plate.appendChild(mark);

    const band = el('div', 'club-band');
    band.appendChild(el('span', null, LEAGUE.name));
    plate.appendChild(band);
    plate.appendChild(el('div', 'club-grain'));

    const foot = el('div', 'club-foot');
    foot.append(el('span', 'club-name', t.name),
                el('span', 'club-ed', 'no ' + String(i + 1).padStart(2, '0') +
                                      '/' + String(ts.length).padStart(2, '0')));

    a.append(plate, foot);
    grid.appendChild(a);
  });
  return grid;
}

async function clubs() {
  const sec = $('#clubsSec');
  if (!sec || !LEAGUE) return;

  let ts = [];
  try {
    ts = await api('teams?league_id=eq.' + LEAGUE.id +
      '&select=id,name,short_name,slug,colour,colour_2,logo_path&order=name');
  } catch (e) {
    return [];                    // a league page without clubs is still a page
  }
  if (!ts.length) return [];

  /* an approved logo, if the club has one. Nothing unapproved is ever shown —
     that decision belongs to the moderation queue, not to this page. */
  const logos = new Map();
  try {
    /* ORDERED, because "the first row that came back" is not a choice. A club
       has one crest now — publishing a new one deletes the old — but this
       query ran with no ORDER BY and took whichever row PostgREST happened to
       return first, so any club that had ever uploaded twice could have shown
       either. Newest first makes the answer the same every time. */
    const rows = await api('media?owner_type=eq.team&kind=eq.logo&status=eq.approved' +
      '&owner_id=in.(' + ts.map(t => t.id).join(',') + ')' +
      '&select=owner_id,storage_path&order=created_at.desc');
    rows.forEach(r => {
      if (!logos.has(r.owner_id)) {
        /* THE BUCKET BELONGS IN THE URL. This built
              /storage/v1/object/public/team/<id>/logo-….webp
           where the endpoint wants
              /storage/v1/object/public/media-public/team/<id>/logo-….webp
           so every club card would have asked for a path that cannot exist.
           EpinoiaUpload.publicUrl has always built it correctly; this was a
           second, hand-rolled copy of the same job. */
        /* at the size a card draws it, through the image transformation (0158) */
        logos.set(r.owner_id, (window.epinoiaLogoUrl && window.epinoiaLogoUrl(r.storage_path)) ||
          (window.EpinoiaUpload
            ? window.EpinoiaUpload.publicUrl(CFG, r.storage_path)
            : CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + r.storage_path));
      }
    });
  } catch (_) { /* monograms all round */ }

  sec.classList.remove('hide');
  $('#clubsNote').textContent = ts.length + (ts.length === 1 ? ' club' : ' clubs');

  /* WHICH FIELD OF CLUBS. A league is not always one: BCB's Trophy is drawn
     from twenty sides and its Championship from fourteen of them, so the grid
     offers the choice — but ONLY when the competitions differ, because being
     asked "Championship or Cup?" and getting the same ten clubs either way is
     worse than not being asked. comps.js owns that judgement. */
  let fields = null;
  try { fields = await seasonFields(LEAGUE.id); } catch (_) { /* one list, then */ }
  const groups = (fields && fields.split) ? fields.groups : [];
  let picked = groups.length ? groups[0].id : '';

  const host = sec.querySelector('#clubs');

  const listFor = (id) => {
    if (!id || !fields) return ts;
    const want = fields.teamsOf(id);
    const out = ts.filter(t => want.has(t.id));
    /* a competition whose clubs all sit in another league (a shared cup does
       this) would otherwise empty the grid; the whole league beats none */
    return out.length ? out : ts;
  };

  function paint() {
    const list = listFor(picked);
    const g0 = groups.find(g => g.id === picked);
    $('#clubsNote').textContent = list.length + (list.length === 1 ? ' club' : ' clubs') +
      (g0 ? ' · ' + g0.name : '');
    host.textContent = '';
    if (groups.length) {
      const row = el('div', 'gpick');
      groups.forEach(g => {
        const b = el('button', 'ep-chip' + (g.id === picked ? ' on' : ''), g.name);
        b.type = 'button';
        if (g.kind && KIND_LABEL[g.kind]) { const k = el('small', 'kind', KIND_LABEL[g.kind]); k.setAttribute('data-i18n-ctx', 'kind'); b.appendChild(k); }
        b.addEventListener('click', () => { picked = g.id; paint(); });
        row.appendChild(b);
      });
      host.appendChild(row);
    }
    host.appendChild(clubGrid(list, logos));
  }
  paint();

  /* handed on to the merchandise section, which prints the same crests onto
     the same clubs — resolving the logos twice would be two chances to
     disagree about which one is approved */
  ts.forEach(t => { t.__logo = logos.get(t.id) || null; });
  return ts;
}

/* -------------------------------------------------------------- the stars ---
   Who has actually been playing well lately, by BPM over a window.

   BPM rather than points because points reward volume and a star section that
   is really a shot-attempt leaderboard is worse than no star section. BPM asks
   what a player added per 100 possessions and is adjusted to how their team
   actually performed, which is as close as a box score gets to the question.

   THE WINDOW IS ANCHORED TO THE LAST GAME PLAYED, not to today. A league that
   last played in April should show April's stars in May, rather than an empty
   panel that looks broken — and the heading says which dates it covers so the
   reader is never guessing how fresh it is.

   A MINIMUM IS ENFORCED and stated. BPM over one quiet half is noise, and a
   podium built from noise is worse than an empty one, so a week needs a game
   and twenty minutes, a month two games and sixty.

   THE WINDOWS, THE CARD AND THE ROWS NOW LIVE IN epinoia/stars.js, shared with
   HOME's best performing players across every league. This page's output is
   held identical to what it drew before the move by supabase/tests/stars.test.mjs. */

async function stars() {
  const sec = $('#starsSec');
  const ST = window.EpinoiaStars;
  if (!sec || !LEAGUE || !ST) return null;

  const comps = await leagueCompetitions();
  if (!comps.length) return null;

  let played = [];
  try {
    played = await api('games?competition_id=in.(' + comps.join(',') + ')' +
      '&status=eq.final&select=id,tipoff_at,home_team_id,away_team_id&order=tipoff_at.desc');
  } catch (_) { return null; }
  if (!played.length) return null;

  const latest = new Date(played[0].tipoff_at || Date.now()).getTime();

  /* names and clubs, resolved once for every window */
  const teamsById = new Map();
  try {
    (await api('teams?league_id=eq.' + LEAGUE.id + '&select=id,name,short_name,slug,colour,colour_2'))
      .forEach(t => teamsById.set(t.id, t));
  } catch (_) { /* the podium still works with a colourless card */ }

  /* THE WIDEST WINDOW IS FETCHED ONCE AND THE NARROWER ONES ARE CUT FROM IT.
     The week's games are a subset of the month's, yet each window used to
     download its own box scores and its own names: data.js only shares
     identical requests, so the same rows came down twice. Now one set of box
     scores (only the keys the stars read) and one playerMeta call cover both. */
  const widest = Math.max.apply(null, ST.WINDOWS.map(w => w.days));
  const inRange = days => played.filter(g => {
    const t = new Date(g.tipoff_at || 0).getTime();
    return t >= latest - days * 86400000 && t <= latest;
  });
  let box;
  try { box = await ST.boxScores(inRange(widest).map(g => g.id)); } catch (_) { return null; }

  const cut = [];
  for (const w of ST.WINDOWS) {
    const inWindow = inRange(w.days);
    if (!inWindow.length) continue;
    const agg = ST.computeWindow(box.pgs, box.tgs, inWindow);
    const eligible = ST.pick(agg.players, w, 10);   /* three on the podium, ten on tap */
    if (!eligible.length) continue;
    cut.push({ w, inWindow, eligible, teamOf: agg.teamOfPlayer });
  }
  if (!cut.length) return null;

  const ids = [...new Set(cut.flatMap(c => c.eligible.map(p => p.id)))];
  let names = {};
  try { names = await D.playerMeta(ids); } catch (_) { names = {}; }

  const rows = cut.map(c => ({
    w: c.w, top: c.eligible, meta: names, teamOf: c.teamOf, teamsById,
    games: c.inWindow.length, span: ST.span(c.inWindow)
  }));

  sec.classList.remove('hide');
  ST.render(sec.querySelector('#stars'), rows, { base: '' });

  /* The month's winner, handed to the merchandise section. It is the same row
     that just drew the first card on the podium, so the shop cannot end up
     celebrating a different player from the one two sections above it. */
  const m = rows.find(r => r.w.key === 'month') || rows[0];
  if (!m || !m.top.length) return null;
  const p = m.top[0], meta = m.meta[p.id] || {};
  return {
    id: p.id, name: meta.name || 'Player', slug: meta.slug || '',
    bpm: p.bpm, ppg: p.ppg, rpg: p.rpg, apg: p.apg,
    team: m.teamsById.get(m.teamOf && m.teamOf.get(p.id)) || null,
    span: m.span
  };
}

/* ------------------------------------------------------- the fans' vote ---
   MAKE YOUR VOICE HEARD (epinoia/fanvote.js, migration 0150): the panel that
   unrolls out of the hero's rule once a voting week, and last week's fans'
   picks above the Stars. Everything it shows comes from fanvote_state, asked as
   the reader when they are signed in (so their ballot is their account's and
   their profile switch is honoured) and anonymously otherwise. A league that
   turned the section off in Appearance gets neither. */
async function fanVote() {
  const sec = $('#fvSec');
  const FV = window.EpinoiaFanVote;
  if (!sec || !LEAGUE || !FV || !sectionOn('fanvote')) { if (sec) sec.classList.add('hide'); return null; }
  return FV.mount({ league: LEAGUE, cfg: CFG, anchor: document.querySelector('#hub .hero'), sec, base: '' });
}

/* ------------------------------------------------------ the shop window ---
   Products built here from each club's crest and colours, and the month's star
   on a print. Epinoia sells nothing; the items link out to whatever
   storefront the league has set up, and say so when it has not.

   The star's PHOTOGRAPH is fetched here rather than in the stars section,
   because only this card is big enough to use one. Two gates, both explicit:
   the league must have APPROVED the image, and the player must not be a minor.
   Under-18s do not come back from the public players read at all, so the
   second check is belt and braces — but a safeguarding rule that only holds
   because of something happening in another file is not one I want to rely
   on. */
async function merch(roster, star) {
  const sec = $('#merchSec');
  if (!sec || !LEAGUE || !window.EpinoiaMerch) return;
  const clubs = (roster || []).slice();
  if (!clubs.length) return;

  let feature = null;
  if (star && star.id) {
    feature = Object.assign({}, star);
    try {
      const rows = await api('players?id=eq.' + encodeURIComponent(star.id) +
        '&select=is_minor,photo_media_id&limit=1');
      const p = rows[0];
      if (!p || p.is_minor) {
        feature = null;                     // never a minor, on anything
      } else if (p.photo_media_id) {
        const md = await api('media?id=eq.' + p.photo_media_id +
          '&status=eq.approved&select=storage_path&limit=1');
        if (md.length) {
          feature.photo = CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + md[0].storage_path;
        }
      }
    } catch (_) { /* the printed monogram stands in for a photograph */ }
  }

  /* Anything the league has actually published. RLS makes this safe to ask
     for anonymously — a design that is still building or has failed is not
     selectable, so a half-finished shirt cannot reach the page. */
  let published = [];
  try {
    published = await api('merch_designs?league_id=eq.' + LEAGUE.id +
      '&status=eq.published&select=team_id,kind,artwork_path,external_url,' +
      'price_pennies,currency&limit=200');
  } catch (_) { /* the drawings stand in */ }

  const ok = window.EpinoiaMerch.render({
    host: '#merch', note: '#merchNote', league: LEAGUE, clubs,
    star: feature, cfg: CFG, published,
    store: LEAGUE.store_url ? { url: LEAGUE.store_url, name: LEAGUE.store_name } : null
  });
  if (ok) sec.classList.remove('hide');
}

/* THE PAGE'S COLOURWAY IN AN EMBED'S URL, so its first paint already matches: light or dark as the
   page is, and the league's own colours when somebody vouched for them (0122). teamcolour.js then
   keeps every embed on the page in step as the page changes (a reader's light/dark, colours read
   from a logo after the page has painted). */
function embedLook() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  let q = '&theme=' + (light ? 'light' : 'dark');
  const L = LEAGUE || {};
  const hex = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : null;
  if ((L.colour_source === 'logo' || L.colour_source === 'manual') && hex(L.colour_a) &&
      L.colour_a.toLowerCase() !== '#93f2bf') {
    q += '&accent=' + encodeURIComponent(L.colour_a);
    if (hex(L.colour_b)) q += '&accent2=' + encodeURIComponent(L.colour_b);
  }
  return q;
}

/* --------------------------------------------------- which season, here ---
   The season row, above the two summaries it governs (seasonbar.js draws it;
   the league page, the fixtures page and the statistics page get the same
   one). Only the seasons with games in them are offered, newest first, and
   the current one is chosen unless ?s= says otherwise.

   ITS CHIPS ARE PLAIN LINKS AND THAT IS DELIBERATE. This page is eight
   independent sections with caches of their own — the games list, the clubs
   field, the stars, the team of the year, the merchandise that reads the last
   two — and re-running all of them in place would be a redraw engine the page
   does not have and would not be worth having. The season is in the URL, so
   opening the page at it IS the redraw, and every section picks it up through
   seasonNow() on the way in.

   Drawn outside splash() because splash() owns #leagues and lays the buttons
   and the two cards out in an order the summaries depend on. */
async function seasonBar() {
  /* #seasonChips, not #seasonPick: splash() has called its competition row that
     since before seasons were navigable, and two elements of one id is a bug
     waiting for whichever $() happens to run first. */
  const host = $('#seasonChips');
  if (!host || !LEAGUE) return;
  let season;
  /* a read that failed leaves the page exactly as it was, with no row */
  try { season = await seasonNow(); } catch (_) { return; }
  if (!season) return;
  /* the heading says WHICH season, because "This season" is a lie on any other */
  const head = $('#leaguesHead');
  if (head) head.textContent = season.name + ' season';
  window.EpinoiaSeasonBar.mount({ host, wrap: $('#seasonBar'), seasons: SEASONS, season });
}

/* ------------------------------------------------------------ the splash ---
   A league's own front page: its table and its leaders, side by side, each a
   real embed rather than a bespoke copy — the same widget other sites get, so
   the thing shipped to other people's pages is the thing seen most often on
   this one and cannot quietly rot.

   Both are CLICKABLE AS A WHOLE. An iframe swallows clicks, so the card gets a
   transparent link laid over it. That also makes the embed purely a picture
   here, which is what a summary should be: the reader either glances and moves
   on, or clicks through to the page where the thing is actually interactive. */
/* ------------------------------------------------------- follow the league ---
   ONE BELL FOR ALL OF IT. A fan could follow a club, a player or one game; somebody who
   simply wants this league had to find every club and press every bell, and would still
   miss a club that joined next season. Following the league is the league — the audience
   expands it into the clubs playing in it when the notices are made (0133), so a new club
   arrives already followed.

   Mounted only when the database HAS that list. Without the migration, set_fan_prefs would
   take the write and quietly drop it, and the bell would sit there lit having saved
   nothing — which is worse than no bell. Signed out, follow.js cannot know, so no bell is
   drawn and the rest of the page is unchanged; a reader who signs in gets it on the way
   back, because the sign-in returns here. */
function leagueBell() {
  const host = $('#leagueActs');
  const F = window.EpinoiaFollow;
  if (!host || !F || !LEAGUE || !LEAGUE.id || typeof F.load !== 'function') return;
  F.load().then(() => {
    if (!F.supports || !F.supports('league') || host.querySelector('.ep-follow')) return;
    const b = F.bell('league', LEAGUE.id, {
      cls: 'big lbl', label: 'follow the league', labelOn: 'following the league',
      name: LEAGUE.name
    });
    host.appendChild(b);
  }).catch(() => { /* no bell; nothing else on the page depends on it */ });
}

/* ------------------------------------------- a league with nothing in it ---
   A BRAND NEW LEAGUE IS AN EMPTY PAGE, and an empty page does not say what to
   do about it. That is the first thing anybody handed a league sees — most
   sharply on a private one, where the league exists precisely because somebody
   is going to run it and there is nothing in it yet at all.

   So when there is nothing scheduled and the person looking IS the one who
   could schedule it, the page says so, under the league's name, and the button
   goes straight to the fixtures section of their console rather than the front
   door of it.

   ONLY FOR THEM. A visitor to a league that has not started yet gets the
   ordinary empty page — "no games yet" is the truth and there is nothing they
   can do about it. And whoami is asked ONLY when the page is empty, which on
   every established league is never, so this costs an ordinary league page
   nothing. */
async function offerSchedule() {
  const host = $('#leagueActs');
  if (!host || !LEAGUE || !LEAGUE.id) return;
  if (host.querySelector('.mk-sched') || host.querySelector('.mk-share')) return;

  /* WHO BEFORE WHAT, because most people are nobody here. A signed-out visitor
     — which is most of them — costs no request at all: there is no session, so
     there is nothing to ask. whoami needs the token whatever the league is
     (withAuth attaches one only for a members-only league, or a private one
     this page has already resolved), so it is sent explicitly. */
  const A = window.EpinoiaAccess;
  let s = null;
  try { s = A && typeof A.sessionReady === 'function' ? await A.sessionReady() : null; }
  catch (_) { return; }
  if (!s || !s.token) return;

  let who = null;
  try {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/whoami`, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
                 Accept: 'application/json', Authorization: 'Bearer ' + s.token },
      body: '{}'
    });
    if (!r.ok) return;
    who = await r.json();
  } catch (_) { return; }
  const mine = who && (who.is_platform_admin ||
    (who.leagues || []).some(l => l.id === LEAGUE.id));
  if (!mine) return;

  /* The link to hand somebody comes first and does not depend on the schedule:
     a private league wants sharing whether or not it has fixtures yet. */
  offerShareLink(who).catch(() => { /* the page is fine without it */ });

  /* Only now, and NOT "the games list on screen is empty" — the splash shows a
     WINDOW of games (recent and upcoming), so a league between seasons would be
     told to build a schedule it already has. This asks whether the league has
     any game at all. */
  try {
    const any = await api('games?select=id&limit=1&competition_id=in.(' +
      (await comps()).join(',') + ')');
    if (any.length) return;
  } catch (_) { return; }                               // could not tell: say nothing

  const a = document.createElement('a');
  a.className = 'ep-btn pri mk-sched';
  a.href = 'admin/#fixtures';
  a.textContent = 'Create a schedule';
  a.style.textDecoration = 'none';
  const note = el('span', 'ep-micro',
    'nothing is scheduled in ' + LEAGUE.name + ' yet');
  note.style.color = 'var(--ink-3)';
  host.append(a, note);
}

/* ------------------------------------------ the way in, for a private league ---
   THE LINK IS THE LEAGUE'S FRONT DOOR AND IT LIVED IN A CONSOLE. A private
   league is not listed and not searchable, so the only way anybody else gets to
   it is a link its admin sends them — and sending one meant opening the league
   console, finding the invitations panel and copying from there. The thing you
   want to hand somebody is wanted at the moment you are looking at the league,
   so it is on the league.

   ONE PRESS, AND IT IS ON THE CLIPBOARD. The newest live link if there is one —
   a permanent link is meant to be sent again and again, and minting a second
   one every time this is pressed would leave a league with forty live links and
   no idea which is which. Only if there is none does it make one.

   ONLY FOR ITS ADMINS, and only on a private league: a public league's front
   page is its own link and the button would be noise. `who` is the answer
   offerSchedule already has, so this costs no extra question. */
async function offerShareLink(who) {
  const host = $('#leagueActs');
  if (!host || !LEAGUE || LEAGUE.visibility !== 'private') return;
  if (host.querySelector('.mk-share')) return;
  const mine = who && (who.is_platform_admin ||
    (who.leagues || []).some(l => l.id === LEAGUE.id));
  if (!mine) return;

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ep-btn mk-share';
  b.textContent = 'Copy invite link';
  b.title = 'the link that lets somebody into ' + LEAGUE.name;
  host.appendChild(b);

  b.addEventListener('click', async () => {
    b.disabled = true;
    const was = b.textContent;
    b.textContent = 'one moment…';
    try {
      let rows = await rpc('league_invites_list', { p_league: LEAGUE.id });
      let live = (rows || []).find(i => !i.spent && i.role === 'viewer');
      if (!live) {
        const made = await rpc('league_invite_create',
          { p_league: LEAGUE.id, p_role: 'viewer', p_label: '' });
        live = Array.isArray(made) ? made[0] : made;   // a table-returning RPC is an array of one
      }
      if (!live || !live.token) throw new Error('no link');
      const url = new URL('invite/?i=' + encodeURIComponent(live.token), location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        b.textContent = 'copied';
      } catch (_) {
        /* a browser that refuses the clipboard (or an insecure origin) must
           still hand over the link, so it goes on screen to be copied by hand */
        b.textContent = 'copy it from here →';
        const box = document.createElement('input');
        box.value = url; box.readOnly = true;
        box.className = 'ep-input mk-share-box';
        /* LABELLED, because an unlabelled box on a page is a mystery. It sits
           next to two buttons and the eye reads it as a control it is supposed
           to do something with; a placeholder and a title say what it is even
           in the moment before the value paints. */
        box.placeholder = 'the invite link';
        box.setAttribute('aria-label', 'the invite link for ' + LEAGUE.name);
        box.title = 'the invite link — select it and copy';
        box.style.cssText = 'flex:1 1 260px;min-width:0;font-family:var(--f-mono,monospace)';
        box.addEventListener('focus', () => box.select());
        host.appendChild(box);
        box.focus();
      }
    } catch (_) {
      b.textContent = 'could not make a link';
    }
    setTimeout(() => { b.textContent = was; b.disabled = false; }, 2600);
  });
}

/* Every competition in this league, for the "is there any game at all" check.
   Cached: the page asks for them elsewhere too. */
let compIdsCache = null;
async function comps() {
  if (compIdsCache) return compIdsCache;
  const rows = await api('competitions?select=id,seasons!inner(league_id)' +
    '&seasons.league_id=eq.' + LEAGUE.id);
  compIdsCache = (rows || []).map(c => c.id);
  /* in.() with an empty list is a syntax error, and a league with no
     competition has no games by definition */
  if (!compIdsCache.length) compIdsCache = ['00000000-0000-0000-0000-000000000000'];
  return compIdsCache;
}

/* THE CARD IS A LINK, AND THE TABLE UNDER IT STILL SCROLLS. The link lies over the whole embed
   so a tap anywhere opens the page - which also meant the rows inside (every club, the top
   thirty) could not be scrolled at all: the wheel and the finger both landed on the link
   (reported 2026-09-24). So the link passes on what is not a tap:
     a wheel over the card    scrolls the table; at its top or bottom the page scrolls instead
     a drag (finger or mouse) scrolls the table, with a little glide when a finger lets go;
                              one that is mostly sideways, or that meets the table's end, is
                              left to the page
     a tap or a click         is still the link - unless the pointer moved, which was a drag
   The embed is this site's own page, so its scroller (#host) is reached directly. */
function scrollThrough(link, frame) {
  const box = () => {
    try { return frame.contentDocument && frame.contentDocument.getElementById('host'); } catch (_) { return null; }
  };
  /* how far the table moved: 0 when it was already at that end, so the page may have the gesture */
  const move = (s, dy) => {
    const was = s.scrollTop;
    s.scrollTop = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, was + dy));
    return s.scrollTop - was;
  };
  link.addEventListener('wheel', e => {
    const s = box();
    if (!s || e.ctrlKey) return;                       /* ctrl+wheel is the browser's zoom */
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? s.clientHeight : 1;
    if (move(s, e.deltaY * unit)) e.preventDefault();
  }, { passive: false });

  let drag = null, dragged = false, glide = 0;
  const stop = () => { if (glide) cancelAnimationFrame(glide); glide = 0; };
  const start = (x, y) => { stop(); drag = { x, y, last: y, t: performance.now(), v: 0, axis: '' }; };
  const step = (x, y, e) => {
    if (!drag) return;
    const s = box();
    if (!s) return;
    if (!drag.axis) {
      if (Math.abs(x - drag.x) < 6 && Math.abs(y - drag.y) < 6) return;
      drag.axis = Math.abs(y - drag.y) >= Math.abs(x - drag.x) ? 'y' : 'x';
    }
    if (drag.axis !== 'y') { dragged = true; return; }
    const dy = drag.last - y;
    const now = performance.now();
    drag.v = dy / Math.max(1, now - drag.t);
    drag.last = y; drag.t = now;
    if (move(s, dy)) { dragged = true; if (e && e.cancelable) e.preventDefault(); }
  };
  const end = () => {
    if (!drag) return;
    const s = box();
    let v = drag.v * 16;                              /* px per frame */
    drag = null;
    if (!s || Math.abs(v) < 1) return;
    const run = () => {
      v *= 0.94;
      if (Math.abs(v) < 0.5 || !move(s, v)) { glide = 0; return; }
      glide = requestAnimationFrame(run);
    };
    glide = requestAnimationFrame(run);
  };
  link.addEventListener('touchstart', e => { dragged = false; const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }, { passive: true });
  link.addEventListener('touchmove', e => { const t = e.touches[0]; if (t) step(t.clientX, t.clientY, e); }, { passive: false });
  link.addEventListener('touchend', end, { passive: true });
  link.addEventListener('touchcancel', () => { drag = null; }, { passive: true });
  /* a mouse drag too: the link's own drag (of its URL) would otherwise take it */
  link.addEventListener('dragstart', e => e.preventDefault());
  link.addEventListener('mousedown', e => { if (e.button === 0) { dragged = false; start(e.clientX, e.clientY); } });
  window.addEventListener('mousemove', e => { if (drag && e.buttons & 1) step(e.clientX, e.clientY, e); });
  window.addEventListener('mouseup', () => { if (drag) end(); });
  link.addEventListener('click', e => {
    if (dragged) { e.preventDefault(); dragged = false; }
  });
}

/* which competition the two embeds are showing; '' until the season is known,
   which is the embed's own default (its first competition) */
let splashComp = '';

function splash() {
  const host = $('#leagues'); host.textContent = '';
  const slug = encodeURIComponent(LEAGUE.slug);
  const table = 'l/?l=' + slug;

  /* THE BUTTONS GO ABOVE BOTH CARDS, because they govern both. A league is not
     one competition — it is a league, a cup, a trophy and its playoffs — and
     these two summaries showed whichever the embed happened to pick first, with
     no way to see the cup's table or the cup's leading scorers without leaving
     the page. Drawn only when there is more than one competition being played:
     a single-competition league gets no choice it does not have. */
  const picker = el('div', 'gpick'); picker.id = 'seasonPick';
  host.appendChild(picker);

  /* THE WHOLE TABLE, AND A REAL TOP THIRTY. Twelve rows cut a league's own standings
     short on its own front page, and ten leaders is a glance rather than a list. The
     embed scrolls inside its frame now, so asking for all of it costs the page nothing
     and a reader who wants the tenth club does not have to open another page to see it. */
  const cards = [
    { title: 'Table', kind: '&kind=standings&n=200', href: table },
    { title: 'Leaders', kind: '&kind=leaders&stat=ppg&n=30', href: table + '#leaders' }
  ];
  const grid = el('div', 'splitgrid');
  cards.forEach(c => {
    const card = el('div', 'embedcard');
    const h = el('div', 'embedhead');
    h.append(el('span', null, c.title), el('span', 'embedgo', 'open ›'));
    card.appendChild(h);

    const f = document.createElement('iframe');
    f.className = 'embedframe';
    f.src = 'embed/table/?l=' + slug + c.kind + embedLook();
    f.loading = 'lazy';
    f.scrolling = 'no';
    f.title = LEAGUE.name + ' ' + c.title.toLowerCase();
    card.appendChild(f);

    /* the whole card is the link; the iframe is decoration under it */
    const a = el('a', 'embedhit');
    a.href = c.href;
    a.setAttribute('aria-label', 'Open the ' + LEAGUE.name + ' ' + c.title.toLowerCase());
    card.appendChild(a);

    scrollThrough(a, f);

    c.frame = f; c.link = a;
    grid.appendChild(card);
  });
  host.appendChild(grid);

  /* Point both embeds at one competition, and take the reader there too — the
     league page reads ?c= the same way, so "open ›" opens what is on screen.
     THE SRC IS ONLY WRITTEN WHEN IT CHANGES: assigning the same URL reloads an
     iframe, which on first paint would be the summary flickering for nothing. */
  const point = id => {
    splashComp = id || '';
    const c = splashComp ? '&c=' + encodeURIComponent(splashComp) : '';
    cards.forEach(card => {
      const want = 'embed/table/?l=' + slug + card.kind + embedLook() + c;
      if (card.frame.getAttribute('src') !== want) card.frame.src = want;
      const hash = card.href.indexOf('#');
      card.link.href = hash < 0 ? card.href + c
        : card.href.slice(0, hash) + c + card.href.slice(hash);
    });
  };

  /* The competitions actually being PLAYED, from the same read the clubs grid
     makes (comps.js, cached): a competition with entries and no fixtures is not
     a view of anything. The principal one is selected, which is what the embeds
     were already showing. A league with one competition, or a read that fails,
     leaves the page exactly as it was. */
  seasonFields(LEAGUE.id).then(F => {
    const played = (F && F.all) || [];
    if (played.length < 2) return;
    const main = (F.main && F.main.id) || played[0].id;
    const order = played.slice().sort((a, b) =>
      (a.id === main ? -1 : 0) - (b.id === main ? -1 : 0) ||
      String(a.name).localeCompare(String(b.name)));
    const draw = () => {
      picker.textContent = '';
      const row = el('div', 'grow');
      order.forEach(c => {
        const b = el('button', 'ep-chip' + (splashComp === c.id ? ' on' : ''), c.name);
        b.type = 'button';
        b.setAttribute('aria-pressed', splashComp === c.id ? 'true' : 'false');
        const tag = KIND_LABEL[c.kind] || '';
        if (tag) { const k = el('small', 'kind', tag); k.setAttribute('data-i18n-ctx', 'kind'); b.appendChild(k); }
        b.addEventListener('click', () => { point(c.id); draw(); });
        row.appendChild(b);
      });
      picker.appendChild(row);
    };
    point(main);
    draw();
  }).catch(() => { /* no buttons, and the summaries as they always were */ });

  /* THE FULL TABLE BELONGS HERE, under the two summaries it is the long
     version of, rather than in "Take part" among the sign-in cards. A reader
     who has just looked at a twelve-row table and a top ten is the reader who
     wants every row and every column; sending them to a different section to
     find it was an accident of where the entry points were first collected. */
  const more = el('div', 'seasonmore');
  const full = el('a', 'ep-chip', 'Full statistics table →');
  full.href = 'stats/?l=' + slug + seasonQuery();
  full.title = 'Every player, sortable, with eFG%, TS% and rim rates';
  const tbl = el('a', 'ep-chip', 'Full league table →');
  tbl.href = table;
  more.append(full, tbl);
  host.appendChild(more);
}

/* The section numbers are a reading aid, so they must count what is actually
   on the page. The hub hides Clubs and Stars — both need a league — and a hub
   whose first heading is "02" looks like something failed to load. */
/* ------------------------------------------------- team of the year --------
   Above the stars, sharing their cards. The competitions are the SHOWN
   season's, because a ballot belongs to a season rather than to a league — an
   old team of the year hanging around on next season's front page would be
   worse than none. */
async function teamOfTheYear() {
  if (!LEAGUE || !window.EpinoiaToty) return;
  const comps = await leagueCompetitions();
  if (!comps.length) return;

  /* THE MOST EXPENSIVE THING ON THIS PAGE, and it usually displays nothing.

     This walked the competitions one at a time, and each step was two round
     trips — the published team, then the ballot — stopping at the first
     competition that had either. A league with four competitions and no Team of
     the Year therefore made eight requests, in series, and hid the section at
     the end of it. Measured on a league's front page: 600ms of a 930ms total,
     spent to draw nothing.

     Now every competition is asked at once and the first one that answers wins.
     Same rule, same winner — the choice is still the earliest in comps' own
     order, not the fastest to reply — but the wall-clock cost is one round trip
     instead of 2N. */
  const probes = await Promise.all(comps.map(id =>
    window.EpinoiaToty.probe({ competitionId: id, rpc })
      .catch(() => null)));

  const i = probes.findIndex(p => p && p.any);
  if (i < 0) return;                  // no ballot anywhere: the section stays off
  window.EpinoiaToty.render({
    sec: $('#totySec'), host: $('#toty'), ballotHost: $('#ballot'),
    head: $('#totyHead'), note: $('#totyNote'),
    competitionId: comps[i], rpc, data: probes[i]
  });
}

/* THE LEAGUE'S MARK, beside its name.

   Approved media only, and silent when there is none: a league without a logo
   gets its name in the wordmark, which is what it got before and is a complete
   design rather than a gap where a picture should be. Nothing on the page moves
   to make room — the logo is placed inside the heading's own line box, so a
   league that adds one later does not reflow the page for everybody else.

   Its own request, deliberately not folded into the league row: it is one small
   query, it runs alongside everything else rather than in front of it, and a
   league page whose heading waited on a picture would be a worse page than one
   whose picture arrives a moment after the heading. */
async function leagueLogo() {
  try {
    const rows = await api('media?owner_type=eq.league&owner_id=eq.' +
      encodeURIComponent(LEAGUE.id) +
      '&kind=eq.logo&status=eq.approved&select=storage_path' +
      '&order=created_at.desc&limit=1');
    const m = rows && rows[0];
    if (!m || !window.EpinoiaUpload) return;
    const wm = document.querySelector('.wordmark');
    if (!wm) return;
    const img = el('img', 'lg-logo');
    /* anonymous, so the logo can be read back from a canvas (media-public answers CORS with *):
       dropFlatGround needs its pixels */
    img.crossOrigin = 'anonymous';
    img.alt = '';
    /* a logo that fails to load leaves the name alone rather than a broken
       frame beside it */
    img.addEventListener('error', () => { img.remove(); wm.parentNode.classList.remove('has-logo'); });
    img.addEventListener('load', () => dropFlatGround(img), { once: true });
    img.src = window.EpinoiaUpload.publicUrl(CFG, m.storage_path);
    /* into the name's own row (.hero-head), never the hero: the tagline and the fixture strip
       below stay full width */
    wm.parentNode.insertBefore(img, wm);
    wm.parentNode.classList.add('has-logo');
  } catch (_) { /* a missing logo is not an error worth showing anybody */ }
}

/* A LOGO DELIVERED ON A WHITE SQUARE. Many leagues' logos come as a JPEG or an opaque PNG/WebP
   with the mark on white (BCB's is a round badge on a 512px white square), which on this page
   reads as a white box pasted beside the name. When the image sits on a white ground (all four
   corners opaque and near-white, and at least half its border; a round badge touches the square's
   edges, so BCB's border is only 83% white), the white CONNECTED TO THE EDGE is
   made transparent, flooded in from the border so that white INSIDE the mark (the lines through
   BCB's ball) stays. The pixels bordering the removed ground are faded by how pale they are, so
   no white halo is left round the mark. A logo that is already transparent, or that owns its
   edge (a coloured badge to the corners), is left exactly as uploaded, and so is one this cannot
   read. */
function dropFlatGround(img) {
  try {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) return;
    const k = Math.min(1, 640 / Math.max(w0, h0));
    const W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, W, H);
    const data = cx.getImageData(0, 0, W, H);          /* throws on a tainted canvas: left as is */
    const px = data.data;
    const pale = p => px[p * 4 + 3] > 250 && Math.min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]) >= 236;

    const edge = [];
    for (let x = 0; x < W; x++) edge.push(x, (H - 1) * W + x);
    for (let y = 1; y < H - 1; y++) edge.push(y * W, y * W + W - 1);
    const lit = edge.filter(pale);
    const corners = [0, W - 1, (H - 1) * W, H * W - 1];
    if (!corners.every(pale) || lit.length < edge.length * 0.5) return;

    const ground = new Uint8Array(W * H);
    const stack = lit.slice();
    let n = 0;
    while (stack.length) {
      const p = stack.pop();
      if (ground[p] || !pale(p)) continue;
      ground[p] = 1; n++;
      const x = p % W, y = (p - x) / W;
      if (x > 0) stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W);
      if (y < H - 1) stack.push(p + W);
    }
    if (n > W * H * 0.97) return;                       /* all ground: nothing left to show */

    for (let p = 0; p < W * H; p++) {
      if (ground[p]) { px[p * 4 + 3] = 0; continue; }
      const x = p % W, y = (p - x) / W;
      const touches = (x > 0 && ground[p - 1]) || (x < W - 1 && ground[p + 1]) ||
                      (y > 0 && ground[p - W]) || (y < H - 1 && ground[p + W]);
      if (!touches) continue;
      const m = Math.min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
      if (m > 150) px[p * 4 + 3] = Math.round(px[p * 4 + 3] * Math.min(1, (255 - m) / 105));
    }
    cx.putImageData(data, 0, 0);
    img.src = cv.toDataURL('image/png');
  } catch (_) { /* a canvas it may not read: the logo stays as uploaded */ }
}

/* The five most recent published articles, above everything else a league
   page shows. Silent when there are none: a league that does not write news
   should not carry an empty section explaining that it does not. */
async function news() {
  if (!LEAGUE || !window.EpinoiaNews) return;
  try {
    await window.EpinoiaNews.mountHeadlines({
      sec: $('#newsSec'), host: $('#news'), note: $('#newsNote'),
      leagueId: LEAGUE.id, leagueSlug: LEAGUE.slug, rpc, base: '',
      url: p => /^https?:\/\//.test(p || '') ? p
        : (window.EpinoiaUpload ? window.EpinoiaUpload.publicUrl(CFG, p) : p)
    });
  } catch (_) { /* news is not load-bearing for the rest of the page */ }
}

async function socials() {
  if (!LEAGUE || !window.EpinoiaSocials) return;
  try {
    await window.EpinoiaSocials.mount({
      sec: $('#socialSec'), host: $('#social'), note: $('#socialNote'),
      leagueId: LEAGUE.id, rpc
    });
  } catch (_) { /* a missing Instagram is not an error worth a red box */ }
}

/* ------------------------------------------------------------ memberships ---
   A league's splash, and only a league's (the platform hub never asks).

   A MEMBERS-ONLY LEAGUE KEEPS ITS SHOP WINDOW OPEN (docs/memberships.md §2): the
   league's own identity, its clubs, its upcoming fixtures while it keeps those
   public, its merchandise and the ways to take part. What happened on court —
   results, the table, the leaders, the stars, Team of the Year, the news — is
   refused by the database to anyone without membership, so those sections are
   not drawn as a row of empty boxes; the paywall card leads the page instead.

   Only on a KNOWN answer. An access check that fails, times out or is absent
   draws the page exactly as it was drawn before memberships existed. */
function joinCard(st) {
  const A = window.EpinoiaAccess, card = $('#joinCard');
  if (!card || !A || typeof A.joinHref !== 'function') return;
  const on = !!(st && st.known && st.hasPlans);
  if (on) card.href = A.joinHref({ leagueSlug: LEAGUE.slug, next: location.pathname + location.search });
  card.classList.toggle('hide', !on);
}

/* A sign-in or sign-out while the page is open. The sections were fetched for
   the old answer, so a changed one reloads rather than patching half a page. */
function onAccessChange() {
  const A = window.EpinoiaAccess;
  if (!A || !LEAGUE) return;
  const st = A.get(LEAGUE.id) || {};
  joinCard(st);
  if (st.known && (typeof A.canView === 'function' && !A.canView(LEAGUE.id)) !== WALL.walled) location.reload();
}

/* One access_state call, awaited before the sections that read on-court rows:
   a member's reads need the token it enables, and a non-member's would come back
   empty. Bounded by access.js (it gives up after four seconds and fails open). */
async function leagueAccess() {
  const A = window.EpinoiaAccess;
  if (!LEAGUE || !A || typeof A.load !== 'function' || typeof A.get !== 'function') return WALL;
  try { await A.load({ leagueId: LEAGUE.id, leagueSlug: LEAGUE.slug }); } catch (_) { return WALL; }
  const st = A.get(LEAGUE.id) || {};
  joinCard(st);
  if (typeof A.onChange === 'function') A.onChange(onAccessChange);
  if (!st.known || typeof A.canView !== 'function' || A.canView(LEAGUE.id) ||
      typeof A.paywallHTML !== 'function') return WALL;
  WALL = { walled: true, fixturesPublic: st.fixturesPublic !== false };
  $('#access').innerHTML = A.paywallHTML({ league: LEAGUE });
  $('#accessSec').classList.remove('hide');
  $('#seasonSec').classList.add('hide');              // the table and the leaders
  $('#leagues').textContent = '';                     // ...and their embeds stop loading
  if (!WALL.fixturesPublic) $('#gamesSec').classList.add('hide');
  return WALL;
}

function renumber() {
  let n = 0;
  document.querySelectorAll('.sec').forEach(sec => {
    if (sec.classList.contains('hide') || sec.offsetParent === null && sec.classList.contains('hide')) return;
    const idx = sec.querySelector('.idx');
    if (!idx) return;
    idx.textContent = String(n).padStart(2, '0');
    n++;
  });
}

/* ------------------------------------------------------------------- boot --- */
(async function boot() {
  const modeEl = $('#mode');
  if (modeEl) {
    modeEl.textContent = 'transport: ' +
      (window.epinoiaMode ? window.epinoiaMode() : 'local');
  }

  if (WANT) {
    /* the whole row: colour_source (0122) is read below, and naming a column a database
       without that migration does not have would lose the league page altogether */
    const q = 'leagues?slug=eq.' + encodeURIComponent(WANT) + '&select=*&limit=1';
    try {
      const ls = await api(q);
      LEAGUE = ls[0] || null;
    } catch (_) { /* fall through to the hub */ }

    /* A PRIVATE LEAGUE IS INVISIBLE TO AN ANONYMOUS READ (0139), and this page's
       reads are anonymous by design — so somebody who followed their invite
       link, joined, and clicked through landed on the hub being told "No league
       called nbl-u18s-men-s". The league was there; they were not asking as
       themselves.

       Not found BUT signed in is worth exactly one more request, as them. It
       costs nothing in the ordinary case (a public league resolves on the first
       try and the request stays cacheable) and it is the only case where the
       token changes the answer. If that finds it, the page keeps reading as
       them, because everything else about the league is hidden too. If it does
       not, the slug really is wrong: AUTHED goes back off so the hub below is
       fetched anonymously, exactly as before. */
    if (!LEAGUE) {
      const A = window.EpinoiaAccess;
      try {
        const s = A && typeof A.sessionReady === 'function' ? await A.sessionReady() : null;
        if (s && s.token) {
          AUTHED = true;
          const ls = await api(q);
          LEAGUE = ls[0] || null;
          if (!LEAGUE) AUTHED = false;
        }
      } catch (_) { AUTHED = false; }
    }
  }

  if (LEAGUE) {
    window.__CS_LEAGUE_SLUG = LEAGUE.slug;      // the rail marks it as current
    document.title = LEAGUE.name + ' · Epinoia';
    leagueLogo();
    const wm = document.querySelector('.wordmark');
    if (wm) {
      wm.textContent = LEAGUE.name;
      /* The logotype is the platform's, not a league's. The moment this
         heading carries a league name it stops being the brand, so the face
         and the brand's accessible name both come off — otherwise the page
         announces a league as "Epinoia" and sets its name in our logotype. */
      wm.classList.remove('epinoia-mark');
      wm.removeAttribute('aria-label');
    }
    const tag = document.querySelector('.tagline');
    if (tag) {
      tag.textContent = 'Live box scores, standings and season statistics for ' +
        LEAGUE.name + '.';
    }
    leagueBell();
    /* not awaited: an empty new league is the only case it draws anything in,
       and nothing else on the page waits on the answer */
    offerSchedule().catch(() => { /* the page is fine without the offer */ });
    if (LEAGUE.colour_a) {
      document.documentElement.style.setProperty('--team-a', LEAGUE.colour_a);
    }
    /* THE LEAGUE'S OWN COLOURS, from its logo or as its admin picked them (0122): trims on this
       page and on the sidebar while it is here. A league that chose its own accent in
       Appearance keeps it. Before applyTheme, so the six chosen slots still have the last word. */
    if (window.EpinoiaTeamColour && window.EpinoiaTeamColour.league) {
      window.EpinoiaTeamColour.league(LEAGUE, { keepAccent: !!(LEAGUE.theme && LEAGUE.theme.accent) });
    }
    applyTheme(LEAGUE.theme);
    /* the strip narrows to this league too */
    const strip = document.querySelector('#strip');
    /* the strip opens in the page's colourway, and teamcolour.js keeps it there */
    if (strip) strip.src = 'embed/strip/?n=24&l=' + encodeURIComponent(LEAGUE.slug) + embedLook();

    const head = document.querySelector('#leaguesHead');
    if (head) head.textContent = 'This season';

    /* THE SECTIONS DO NOT DEPEND ON EACH OTHER, so they no longer wait for
       each other. This was eight awaits in a row — games, news, clubs, team of
       the year, stars, merchandise, socials — and every one of them is a
       separate query against a separate table. Measured before: 28 serial round
       trips and a 930ms chain on a machine with no network latency at all;
       across the Atlantic on a phone that is seconds.

       Only merchandise genuinely has inputs: it needs the roster from clubs()
       and the leading player from stars(), so it waits for exactly those two
       and nothing else. splash() is synchronous — it only sets iframe sources.

       Promise.all rejects on the first failure, so each section keeps its own
       error handling and none of them is allowed to take the page down with it;
       games() and the rest already report their own failures into their own
       section, which is the behaviour worth preserving here. */
    /* MEMBERSHIPS (leagueAccess, above) change as little of this as they can.
       The table and leaders embeds read for themselves, anonymously, and the
       clubs and socials are public in every league, so those start at once as
       they always did; so does the games list, which is simply read again once
       the answer names a members-only league — with a member's token, or cut to
       the fixtures behind the wall. Read again AFTER the first read settles, so
       the anonymous answer can never land on top of the member's. The stars, Team
       of the Year and the news have no second pass, so they start after the
       answer: one access_state call, bounded at four seconds by access.js. */
    splash();
    seasonBar().catch(() => null);
    const gamesFirst = games().catch(() => null);
    const clubsP = clubs().catch(() => null);
    const socialsP = socials().catch(() => null);
    const wall = await leagueAccess();
    const AX = window.EpinoiaAccess;
    const ast = (AX && typeof AX.get === 'function' && AX.get(LEAGUE.id)) || {};
    /* not while memberships are switched off for the platform: the first,
       anonymous read already had every game */
    const gamesP = ast.known && ast.accessMode === 'members' && ast.membershipsEnabled !== false
      ? gamesFirst.then(() => { gamesKey = ''; return games(); }).catch(() => null)
      : gamesFirst;
    /* the fans' vote starts now and is NOT waited for: it is the one section whose panel can appear
       late, and a slow database must never hold the rest of the page's set-up behind it */
    if (!wall.walled) fanVote().catch(() => null);
    const [, roster, star] = await Promise.all([
      gamesP,
      clubsP,
      wall.walled ? null : stars().catch(() => null),
      wall.walled ? null : news().catch(() => null),
      wall.walled ? null : teamOfTheYear().catch(() => null),
      socialsP
    ]);
    await merch(roster, star).catch(() => null);
    applySections();
    renumber();
    /* The games list keeps itself current from here on: the announcement for
       the moment a game starts or finishes, the timer for everything else. */
    watchGames();
    watchGameAnnouncements();
  } else {
    /* ------------------------------------------------------ the splash ---
       No league asked for, so this document is the platform's front page
       rather than a league's. It is a completely different page: a pool, a
       title and four ways in. The league splash above is untouched by any of
       it — the two share a document only because they share a URL.

       A league that was ASKED FOR and does not exist is not the splash. It is
       a broken link, and saying so beats silently showing something that
       looks like the link worked. */
    if (WANT) {
      /* ?l= was set, so mode.js already put m-league on the root and the hub is
         showing — a broken link lands on the same layout as a working one, with
         the reason in it. */
      fail('#leagues', 'No league called "' + WANT + '". Every league is listed below.');
      await games();
      await leagues();
      renumber();
      watchGames();
      watchGameAnnouncements();
      return;
    }

    /* Nothing is shown or hidden here any more. mode.js settled it from the
       URL before the first paint, and repeating it in JavaScript at the bottom
       of the body is exactly the late decision that made the splash flash the
       league page first. The title is still set here because a document can
       only have one <title> and this branch is where the answer is known. */
    document.title = 'Epinoia';
    const mode = document.querySelector('#spMode');
    if (mode) mode.textContent = 'transport: ' +
      (window.epinoiaMode ? window.epinoiaMode() : 'local');
    if (window.EpinoiaSplash) window.EpinoiaSplash.mount({ api, cfg: CFG });

    /* THE TRACK, and only here. This branch is the splash; the league page is
       the other one and shares the document, so mounting from inside it is
       what keeps SoundCloud's script off every league's front page rather
       than trusting a guard inside music.js to be the only line of defence.

       Not on a phone: the slab is hidden under 900px and loading a player
       nobody can see is somebody's data spent on nothing. */
    if (window.EpinoiaMusic && window.matchMedia('(min-width:901px)').matches) {
      const sc = document.querySelector('#sc');
      if (sc) {
        sc.classList.remove('hide');
        /* THE SPLASH IS THE ONLY PAGE THAT ASKS UNPROMPTED, and the only one
           that starts on a first click the visitor aimed elsewhere. Every
           other page resumes or stays silent. */
        window.EpinoiaMusic.mount(sc, { autoplay: true, kickOnInteraction: true });
      }
    }
  }
})();

/* ---------------------------------------------------------------- strip --- */
/* The fixture strip is the same iframe other sites embed, so the widget
   shipped outward is the one seen most often here and cannot quietly rot.

   It posts its height out; apply it, checked against our own origin AND that
   specific frame, because a page can hold other frames and any of them can
   post. The number is range-checked too — a posted value is never trusted.

   This lives here rather than inline because the page's CSP is script-src
   'self', which blocks inline script. That is the policy working, not an
   obstacle to route around. */
window.addEventListener('message', ev => {
  if (ev.origin !== location.origin) return;
  const f = document.getElementById('strip');
  if (!f || ev.source !== f.contentWindow) return;
  const d = ev.data;
  if (!d || d.epinoiaEmbed !== 'height') return;
  const h = Number(d.height);
  if (!isFinite(h) || h < 60 || h > 400) return;
  f.style.height = Math.ceil(h) + 'px';
});
