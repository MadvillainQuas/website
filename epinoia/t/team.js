'use strict';
/* ============================================================================
   Team profile — identity, record, team statistics, roster, results.

   The statistics table is the same component the leaders board and the season
   page use, so a column means the same thing wherever you read it. Minors are
   filtered by RLS, not here: a U18 player never comes back from the players
   join, so this page cannot leak one by forgetting a check.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const T = window.EpinoiaTable;
/* WHICH TEAM: ?t=, or on the copy of this page tools/build-seo.py writes for one team (t/<slug>.html) the
   id in <meta name="epinoia-entity"> (see p/player.js). */
const want = new URLSearchParams(location.search).get('t') ||
  ((document.querySelector('meta[name="epinoia-entity"]') || {}).content || '');
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want);

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = (v, d = '—') => (v == null ? d : Number(v).toFixed(1));

/* A MEMBERS-ONLY LEAGUE IS REFUSED BY ROW-LEVEL SECURITY, so a member's reads say who is
   asking: access.js hands back a token only for a members-only league this viewer may see and
   {} otherwise, so an open league's request is exactly what it was. A 401 with a token on it
   is a token the server stopped accepting: asked once more anonymously, as it always was. */
async function api(p, anon) {
  const headers = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous */ }
  }
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`, { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization && !anon) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

function oops(msg) {
  ['#roster', '#games', '#teamstats'].forEach(s => { const h = $(s); if (h) h.textContent = ''; });
  $('#games').appendChild(el('div', 'empty', msg));
}

/* ---------------------------------------------------------------- access ---
   WHAT THIS VIEWER MAY SEE (docs/memberships.md), decided once from the club's league before
   the first gated section is drawn, and read by every section as a flag. It starts open and
   stays open unless access.js is on the page AND has an answer: analytics fail open, and the
   members-only card needs a known "cannot view".

   locked     true = no analytics: the events splits, the zones and the full WOWY are drawn
              as teasers (the full tables drop their own premium columns)
   paywall    a members-only league this viewer cannot see: the club's identity, crest,
              venue and squad stay (the shop window, §2), the card stands where the record
              and the statistics were, and nothing behind it is fetched -- the database would
              refuse every row
   fixtures   upcoming fixtures stay public in a members-only league while the league says so */
const ACCESS = { locked: false, paywall: false, fixtures: true, slug: '' };
const accessTeaser = o => { const A = window.EpinoiaAccess;
  return A && typeof A.teaserHTML === 'function'
    ? A.teaserHTML(Object.assign({ leagueSlug: ACCESS.slug }, o)) : ''; };

function accessNow(A, lg) {
  const st = typeof A.get === 'function' ? A.get(lg.id) : null;
  return {
    locked: typeof A.analyticsOk === 'function' && !A.analyticsOk(lg.id),
    paywall: !!(st && st.known) && typeof A.canView === 'function' && !A.canView(lg.id),
    st
  };
}

/* THE ANSWER CAN MOVE UNDER A DRAWN PAGE: a sign-in or sign-out in another tab, an answer that
   lands after the module's time limit, the admin preview switch. Nearly every section was drawn
   from it, so a change to what was decided draws the page again from the top; an open league
   never notices. On a change of account the module forgets what it held first, so the new
   account's answer is waited for rather than read from the empty state in between. */
function watchAccess(A, lg) {
  if (typeof A.onChange !== 'function') return;
  const drawn = ACCESS.locked + '|' + ACCESS.paywall;
  const check = () => { const n = accessNow(A, lg); if (n.locked + '|' + n.paywall !== drawn) location.reload(); };
  try {
    A.onChange(d => {
      if (d && d.leagueId && d.leagueId !== lg.id) return;
      if (d && d.reason === 'auth' && typeof A.load === 'function') {
        Promise.resolve().then(() => A.load({ leagueId: lg.id })).then(check, () => {});
      } else check();
    });
  } catch (_) { /* the page as drawn */ }
}

function decideAccess(lg) {
  const A = window.EpinoiaAccess;
  if (!A || !lg || !lg.id) return;
  ACCESS.slug = lg.slug || '';
  const now = accessNow(A, lg);
  ACCESS.locked = now.locked;
  ACCESS.paywall = now.paywall;
  watchAccess(A, lg);
  if (!ACCESS.paywall) return;
  const st = now.st;
  ACCESS.fixtures = st.fixturesPublic !== false;
  document.body.classList.add('paywalled');
  const card = $('#paywall');
  if (card && typeof A.paywallHTML === 'function') {
    card.innerHTML = A.paywallHTML({ league: lg });
    card.hidden = false;
  }
}

/* WHICH SEASON. The club's league may have more than one season with games (seasonbar.js); every
   read of the club's games below appends inSeason(), so the page is one season at a time. With one
   season on offer nothing is set and the page reads as it always did. */
let SEASON_COMPS = null, SEASON_NAME = '';
/* the season's own id, for the Front office's model files (EpinoiaWinFile); null = the league's current season */
let SEASON_ID = null;
/* is the season shown the newest one (or the only one)? Who is out now, and who has left, belong to it alone */
let SEASON_NOW = true;
/* the season the page's numbers are from, as a person writes it (seasonbar.js label): the hero's scoreboard says it */
let SEASON_LABEL = '';
/* the season row shown (seasonbar.js), with its competitions: the season card's buttons are its competitions */
let SEASON_ROW = null;
/* the club's linked sides (linkswitch.js paintTeam, migration 0178): the season card adds the same squad's other competitions */
let LINKED_T = null;
const seasonText = n => { const SB = window.EpinoiaSeasonBar; return SB && SB.label ? SB.label(n) : String(n || ''); };
/* this script's own ?v=, so the win model's code loaded later (loadWinModel) is of the same deploy */
const TEAM_V = (() => {
  const s = document.currentScript || Array.from(document.scripts).find(x => /\/t\/team\.js/.test(x.src));
  const m = /[?&]v=([^&#]+)/.exec((s && s.src) || '');
  return m ? m[1] : '';
})();
const inSeason = () => (SEASON_COMPS && SEASON_COMPS.length ? '&competition_id=in.(' + SEASON_COMPS.join(',') + ')' : '');
/* THE SQUAD OF THE SEASON SHOWN, one row a player (depth.js squad()): a player has a roster row for every season he is
   on the club's books, so every read of the club's active rows - the squad, the depth chart, the league's view of a
   position - listed a player of two seasons twice. SQUAD_COLS are the columns squad() needs beside each read's own. */
const SQUAD_COLS = 'team_id,season_id,created_at,seasons(name)';
const squadOf = rows => {
  const X = window.EpinoiaDepth;
  return X && X.squad ? X.squad(rows || [], SEASON_ID) : (rows || []);
};
async function chooseSeason(team, lg) {
  const SB = window.EpinoiaSeasonBar;
  if (!SB || !lg || !lg.id) return;
  try {
    const o = await SB.load(api, lg.id);
    SEASON_LABEL = o.current ? seasonText(o.current.name) : '';    // one season: still named on the hero
    SEASON_ROW = o.current || null;
    if (!o.list || o.list.length < 2) return;
    const wantS = new URLSearchParams(location.search).get('s');
    let season = wantS ? SB.pick(o.list, wantS) : null;
    if (!season) {
      /* no ?s=: the season of the club's latest game, so a club that sat out the newest season
         still opens on its own games rather than on an empty page */
      const last = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
        `&select=competition_id&order=tipoff_at.desc&limit=1`);
      const cid = last[0] && last[0].competition_id;
      season = (cid && o.list.find(s => (s.comps || []).some(c => c.id === cid))) || o.list[0];
    }
    SEASON_COMPS = (season.comps || []).map(c => c.id);
    SEASON_NAME = season.name || '';
    SEASON_ID = season.id || null;
    SEASON_NOW = !o.list[0] || season.id === o.list[0].id;
    SEASON_LABEL = seasonText(season.name);
    SEASON_ROW = season;
    SB.mount({ host: $('#seasonPick'), wrap: $('#seasonRow'), seasons: o.list, season });
  } catch (_) { /* every season, as before */ }
}

(async function boot() {
  if (!want) return oops('No team specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    const ts = await api(`teams?${key}=eq.${encodeURIComponent(want)}&select=*,leagues(id,name,slug,initials,country,logo_path,colour_a,periods:rules->periods,period_ms:rules->period_ms)&limit=1`);
    if (!ts.length) return oops('Team not found.');
    const team = ts[0];
    const colour = team.colour || '#93f2bf';
    document.documentElement.style.setProperty('--team-a', colour);
    /* THE PAGE IN THE CLUB'S COLOURS. A team with colours of its own -- read from the crest by
       the ingest, or chosen by an admin -- gets the whole page in them (body.themed, see the
       stylesheet); a team still on the site's default mint is left in the site's own dress,
       because mint everywhere is the site, not a club that happens to be mint. */
    const TC = window.EpinoiaTeamColour;
    const paint = (a, b) => {
      if (!TC || !a || String(a).toLowerCase() === '#93f2bf') return false;
      if (!TC.apply(document.documentElement, a, b)) return false;
      document.body.classList.add('themed');
      return true;
    };
    const themed = paint(team.colour, team.colour_2);

    /* THE CLUB'S CREST WHERE ITS INITIALS WERE.

       teams.logo_path is the right source rather than a query against media:
       it is set only when a crest is actually published and cleared when one is
       removed, so a non-null value already means "live", and it arrives with
       the team row that has just been fetched — no second request to decide
       whether to draw a badge.

       The initials stay as the fallback, and stay in the DOM until the image
       has actually loaded: a crest that 404s must leave a badge behind rather
       than an empty square where the club should be. */
    const badge = $('#badge');
    /* its ground is the stylesheet's (kit/clubhero.css): a white disc for a crest, the club's colour for its letters -
       the code HOME's cards give it (initials.js), never a whole short name that cannot fit */
    const IN = window.EpinoiaInitials;
    let letters = '';
    try { letters = (IN && IN.candidates && IN.candidates(team)[0]) || ''; } catch (_) { letters = ''; }
    badge.textContent = letters || (team.name || '?').slice(0, 3).toUpperCase();
    const crestUrl = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(team.logo_path) : null;
    if (crestUrl) {
      const crest = document.createElement('img');
      /* resolved by the shared helper: a club's uploaded crest lives in the
         media-public bucket, a fed club's comes from FIBA LiveStats as a URL */
      crest.src = crestUrl;
      crest.alt = '';
      crest.addEventListener('load', () => {
        /* the initials are only cleared once the crest is actually on screen */
        [...badge.childNodes].forEach(n => { if (n !== crest) n.remove(); });
        badge.classList.add('has-crest');
      });
      crest.addEventListener('error', () => crest.remove());
      badge.appendChild(crest);
      /* a crest the ingest has not read yet (a club's fresh upload): read it here, for this
         visit -- the media-public bucket is CORS-readable; the feed's image host is not, and
         fromImage resolves null there without a word */
      if (!themed && team.colour_source !== 'manual' && TC && TC.fromImage) {
        TC.fromImage(crestUrl).then(pal => {
          if (pal && pal.primary && paint(pal.primary, pal.secondary)) {
            badge.style.background = '';
            $('#tname').style.color = '';
          }
        });
      }
    }
    $('#tname').textContent = team.name;
    /* a club without colours of its own keeps the page's ink: the site's mint is too pale for a name on the light theme */
    /* follow the club: results and fixtures in the bell, email or a push if asked */
    const acts = el('div', 'hero-acts');
    if (window.EpinoiaFollow) {
      const fb = window.EpinoiaFollow.bell('team', team.id, { cls: 'big', label: 'follow' });
      fb.classList.add('lbl'); acts.appendChild(fb);
    }
    /* THE FIXTURES IN YOUR CALENDAR. The ics function serves the club's games as a feed that
       calendars fetch themselves and keep fetching, so a moved tip-off, a new round or a final
       score arrives on its own. WHICH ROUTE WORKS DEPENDS ON THE DEVICE, and getting that wrong
       is how a calendar ends up added but never seen: a feed added to Google by URL shows in
       Google Calendar and its app, but never in Samsung Calendar or any other Android calendar
       app. calendar.js puts the routes in order for the device in hand — Apple, ICSx⁵ on
       Android, Google, Outlook, and the file for anything else — and says what each one does
       (docs/calendar.md). */
    const ics = CFG.supabaseUrl + '/functions/v1/ics/team/' + encodeURIComponent(team.slug || team.id) + '.ics';
    if (window.EpinoiaCalendar) window.EpinoiaCalendar.mount(acts, { url: ics, name: team.name });
    /* SUGGEST AN EDIT (suggest.js, 0199): the crest on hover, and every detail of the page from the button */
    SUGGEST.team = team;
    if (window.EpinoiaSuggest) {
      window.EpinoiaSuggest.attach(badge, crestChoice(), { at: 'icon' });
      acts.appendChild(window.EpinoiaSuggest.button(suggestList, { title: team.name }));
    }
    /* EDIT, for whoever manages the club (adminedit.js, 0214): the database says who; the button above becomes theirs */
    if (window.EpinoiaAdminEdit) window.EpinoiaAdminEdit.mount({ type: 'team', id: team.id, name: team.name, host: acts, venue: team.home_venue_id || null });
    $('#tname').parentNode.appendChild(acts);
    const lg = team.leagues || {};
    if (lg.slug) window.__CS_LEAGUE_SLUG = lg.slug;
    $('#tsub').textContent = lg.name || 'Independent';
    $('#ctx').textContent = lg.name ? lg.name + ' · ' + team.name : team.name;
    if (lg.slug) $('#leagueLink').href = '../l/?l=' + encodeURIComponent(lg.slug);
    else $('#leagueLink').style.display = 'none';
    /* A WOMEN'S SIDE SAYS SO beside its league, and a club linked to its other competitions (the SLB, the EuroCup,
       the women's side) gets a button that opens them (linkswitch.js, migration 0178). Asked without waiting. */
    if (window.EpinoiaLinks) LINKED_T = window.EpinoiaLinks.paintTeam(team, { sub: $('#tsub') }).catch(() => null);   // null: the page as it was
    if (!document.querySelector('meta[name="epinoia-entity"]')) document.title = team.name + ' · Epinoia';   // a build-seo.py copy keeps its own
    teamStrip(team, lg);

    /* ACCESS FIRST FOR THE SECTIONS IT DECIDES, and only for those: the venue and the squad
       are never gated, so they start at once, while the record, the statistics and the
       results wait for the answer (by id: a slug would cost a leagues read first). The
       module gives up by itself after 4 s and answers open. */
    const A = window.EpinoiaAccess;
    await chooseSeason(team, lg);
    const accessReady = (A && typeof A.load === 'function' && lg.id)
      ? Promise.resolve().then(() => A.load({ leagueId: lg.id })).catch(() => null)
      : Promise.resolve(null);
    await Promise.all([venue(team), roster(team),
                       accessReady.then(() => { try { decideAccess(lg); } catch (_) { /* open */ }
                         return Promise.all([record(team), teamStats(team), games(team)]); })]);
    whenNear($('#teamdepth'), () => profileDepth(team));
    whenNear($('#teamshots'), () => teamShots(team));
    whenNear($('#teamclock'), () => teamShotClock(team));
    whenNear($('#teamrot'), () => teamRotations(team));
    whenNear($('#wowy') || $('#lulist'), () => { lineupPanels(team).catch(() => {}); });
    reportTab(team);
    await videoPanel(team);
    frontOfficeTab(team);
  } catch (e) { oops('Could not load: ' + e.message); }
})();

/* ---------------------------------------------------------------------------
   THE CLUB'S SHOOTING, on the box score's court: every located shot the side took in its
   last forty finalised games, dots and crosses in the club's colour, the floor cut into zones
   with each zone's makes, attempts and percentage. Locations live in the event log, so the
   logs are fetched; the video panel below fetches its own subset for the games with footage.
   --------------------------------------------------------------------------- */
/* START A SECTION WHEN IT IS NEARLY IN VIEW. The club page's lower sections are its heaviest
   reads: the shot zones read the event log of every game in the club's competitions (other
   clubs' games too, for the league percentiles), the chart, clock and rotations forty more
   logs, the lineups every stint the club has played. All of it was fetched on arrival, 330 to
   600 requests (measured 2026-09-24), while many visits read the roster and the results and
   leave. A section now starts when it comes within a screen or so of the viewport, which to a
   reader who scrolls looks the same. No IntersectionObserver: start at once, as before. A
   section hidden behind the wall never comes into view, so it is never read, which is right. */
function whenNear(node, run) {
  if (!node || typeof IntersectionObserver !== 'function') { run(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); run(); }
  }, { rootMargin: '600px 0px' });
  io.observe(node);
}

/* ONE SEASON OF LOGS, FETCHED ONCE. The shot chart, the shot clock and the rotations all read
   the club's last forty finalised games, and the event logs are the heaviest request this page
   makes; three sections asking for them separately would be three times that. The starters and
   the roster snapshot ride along for the rotations. */
let logsP = null;
function seasonLogs(team) {
  if (logsP) return logsP;
  const D = window.EpinoiaData;
  logsP = (async () => {
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=id,home_team_id,away_team_id,tipoff_at,period,starters,roster_snapshot` + inSeason() +
      `&order=tipoff_at.desc&limit=40`);
    const evs = gs.length ? await D.events(gs.map(g => g.id)) : [];
    const byG = {}; evs.forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
    const sideOf = {}; gs.forEach(g => { sideOf[g.id] = g.home_team_id === team.id ? 0 : 1; });
    return { gs, byG, sideOf };
  })();
  logsP.catch(() => { logsP = null; });
  return logsP;
}

/* THE SEASON'S GAMES WITHOUT THEIR LOGS (docs/what-wins-model.md §12): the Front office needs the club's last forty
   finals and their starters, not their event logs, so it reads seasonLogs' games query alone (or seasonLogs' own
   answer when a section has already loaded it). Opening the tab no longer downloads the logs. */
let gamesP = null;
function seasonGames(team) {
  if (logsP) return logsP.then(({ gs, sideOf }) => ({ gs, sideOf }));
  if (gamesP) return gamesP;
  const D = window.EpinoiaData;
  gamesP = (async () => {
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=id,home_team_id,away_team_id,tipoff_at,period,starters,roster_snapshot` + inSeason() +
      `&order=tipoff_at.desc&limit=40`);
    const sideOf = {}; gs.forEach(g => { sideOf[g.id] = g.home_team_id === team.id ? 0 : 1; });
    return { gs, sideOf };
  })();
  gamesP.catch(() => { gamesP = null; });
  return gamesP;
}

/* the club's colour as this theme can read it: on the light page a pale kit is inked darker */
function readableColour(team) {
  const c = /^#[0-9a-f]{6}$/i.test(String(team.colour || '')) ? team.colour : '#93f2bf';
  const TC = window.EpinoiaTeamColour;
  return (TC && TC.ink && document.documentElement.getAttribute('data-theme') === 'light') ? (TC.ink(c) || c) : c;
}

async function teamShots(team) {
  const host = $('#teamshots');
  if (ACCESS.paywall) return;
  if (!host || !window.EpinoiaShotChart || !window.EpinoiaData) return;
  try {
    const { gs, byG, sideOf } = await seasonLogs(team);
    if (!gs.length) { host.appendChild(el('div', 'empty', 'No finalised games yet.')); return; }
    const shots = await window.EpinoiaShotChart.gather({
      fetchEvents: async () => Object.values(byG), gameIds: gs.map(g => g.id), playerId: null, sideOf: id => sideOf[id]
    });
    /* the chart alone: the zone numbers live in the team statistics block, ranked in the league.
       Without analytics, the marks without the zones, and a line saying what they would add. The
       games (for the "last 5 / 10" control and each shot's date) go with it, and the shooters'
       names follow once they are read, for the player control (a second draw keeps the choices). */
    const SC = window.EpinoiaShotChart;
    const opts = { host, shots, colour: team.colour || '#93f2bf', minAttempts: 5, games: gs.length, table: false,
      gameList: SC.gameListOf ? SC.gameListOf(gs) : null,
      note: 'last ' + gs.length + (gs.length === 1 ? ' game' : ' games'), zones: !ACCESS.locked };
    SC.renderZones(opts);
    const pids = [...new Set(shots.map(s => s.pid).filter(Boolean))];
    if (pids.length > 1 && window.EpinoiaData.playerMeta) {
      window.EpinoiaData.playerMeta(pids).then(meta => {
        const names = {};
        pids.forEach(id => { const m = meta && meta[id]; if (m && m.name) names[id] = (m.jersey ? '#' + m.jersey + ' ' : '') + m.name; });
        SC.renderZones(Object.assign(opts, { names }));
        if (ACCESS.locked) {
          host.insertAdjacentHTML('beforeend', accessTeaser({ compact: true, title: 'Shot zones',
            lines: ['Twelve zones, each tinted against its own break-even.'] }));
        }
      }).catch(() => { /* the chart without the player control */ });
    }
    if (ACCESS.locked) {
      host.insertAdjacentHTML('beforeend', accessTeaser({ compact: true, title: 'Shot zones',
        lines: ['Twelve zones, each tinted against its own break-even.'] }));
    }
  } catch (e) { host.appendChild(el('div', 'empty', 'The shot chart could not be drawn.')); }
}

/* ---------------------------------------------------------------------------
   SHOT CLOCK ANALYSIS, over the season: every possession the club had in those games, and
   every one its opponents had against it, by how long each ran from the change of possession
   before it ended (epinoia/shotclock.js). The same slider as the game page's tab; the two
   tabs here are the club's offence and its defence.
   --------------------------------------------------------------------------- */
async function teamShotClock(team) {
  const host = $('#teamclock');
  if (ACCESS.paywall || !host) return;
  const SCk = window.EpinoiaShotClock, V = window.EpinoiaShotClockView;
  if (!SCk || !V || !window.EpinoiaData) return;
  if (ACCESS.locked) {
    host.innerHTML = accessTeaser({ compact: true, title: 'Shot clock analysis',
      lines: ['The four factors and the shots of the possessions that ended in any stretch of the 24 seconds, at both ends.'] });
    return;
  }
  host.appendChild(el('div', 'empty', 'Timing every possession…'));
  try {
    const { gs, byG, sideOf } = await seasonLogs(team);
    if (!gs.length) { host.innerHTML = ''; host.appendChild(el('div', 'empty', 'No finalised games yet.')); return; }
    const own = [], opp = [];
    gs.forEach(g => {
      const R = SCk.compute({ events: byG[g.id] || [] });
      const s = sideOf[g.id];
      R.chances.forEach(r => (r.team === s ? own : opp).push(r));
    });
    const name = team.short_name || team.name || 'This club';
    V.mount(host, 'team', { unit: 'season', sides: [
      { label: name + ' offence', colour: readableColour(team), chances: own },
      { label: name + ' defence', colour: '#8a9a92', chances: opp }
    ] });
    const note = $('#clockNote');
    if (note) note.textContent = 'last ' + gs.length + (gs.length === 1 ? ' game' : ' games');
  } catch (e) {
    host.innerHTML = '';
    host.appendChild(el('div', 'empty', 'The shot clock analysis could not be drawn.'));
  }
}

/* ---------------------------------------------------------------------------
   ROTATIONS, over the season: each player's share of every minute across the club's games
   (a game he missed counts as none of it), longest-playing first, with the club's average
   margin at each minute beneath (epinoia/rotation.js). Names are the players' own rows --
   the snapshots carry whatever the feed wrote, which on a translated league is katakana.
   --------------------------------------------------------------------------- */
async function teamRotations(team) {
  const host = $('#teamrot');
  if (ACCESS.paywall || !host) return;
  const R = window.EpinoiaRotation, D = window.EpinoiaData;
  if (!R || !D) return;
  if (ACCESS.locked) {
    host.innerHTML = accessTeaser({ compact: true, title: 'Rotations',
      lines: ['Who is on the floor at every minute of a game, across the season.'] });
    return;
  }
  try {
    const { gs, byG, sideOf } = await seasonLogs(team);
    const games = gs.filter(g => g.roster_snapshot && g.roster_snapshot.teams && Array.isArray(g.starters)).map(g => ({
      side: sideOf[g.id],
      model: R.compute({ status: 'final', period: g.period || 4, clockMs: 0, teams: g.roster_snapshot.teams,
                         starters: g.starters, events: byG[g.id] || [] })
    }));
    if (!games.length) { host.appendChild(el('div', 'empty', 'No finalised games with a lineup yet.')); return; }
    const name = team.short_name || team.name || '';
    const M = R.season(games, name);
    try {
      const meta = await D.playerMeta(M.teams[0].rows.map(r => r.pid).filter(Boolean));
      M.teams[0].rows.forEach(r => { const m = meta[r.pid]; if (m && m.name && m.name !== 'Player') r.name = m.name; });
    } catch (_) { /* the snapshot's names stand */ }
    host.innerHTML = R.html(M, { colours: [readableColour(team), '#8a9a92'],
      marginLabel: 'average margin at each minute · above the line ' + name + ' ahead' });
    const note = $('#rotNote');
    if (note) note.textContent = games.length + (games.length === 1 ? ' game' : ' games') + ', regulation only';
  } catch (e) { host.appendChild(el('div', 'empty', 'The rotations could not be drawn.')); }
}

/* WHO MAY OPEN THE FRONT OFFICE. Today it is analytics like the rotations and the lineups: a league whose analytics
   are for members shows everyone else the teaser. To sell it on its own, set membersOnly: a viewer then needs a plan
   whose features include 'front_office' (access.js carries each plan's features; the tab asks for the league's). */
const FRONT_OFFICE = { membersOnly: false, feature: 'front_office' };
function frontOfficeOpen(team) {
  if (ACCESS.paywall || ACCESS.locked) return false;
  if (!FRONT_OFFICE.membersOnly) return true;
  const A = window.EpinoiaAccess, lg = (team && team.leagues) || {};
  const st = A && typeof A.get === 'function' ? A.get({ id: lg.id, slug: lg.slug }) : null;
  return !!(st && Array.isArray(st.features) && st.features.indexOf(FRONT_OFFICE.feature) !== -1);
}

/* THE TAB, beside Profile, Video and the weekly report. The same pattern as the weekly report's (weekly.js mount):
   the profile steps aside while it is open, the other tabs close it, and nothing is read until it is first opened.
   ?tab=front-office opens it on arrival. */
function frontOfficeTab(team) {
  const tabs = $('#ttabs'), panel = $('#fosec');
  if (!tabs || !panel || !window.EpinoiaDepth || ACCESS.paywall) return;
  const btn = document.createElement('button');
  btn.className = 'ep-tab'; btn.type = 'button'; btn.dataset.p = 'front-office';
  btn.setAttribute('role', 'tab');
  btn.textContent = 'Front office';
  tabs.appendChild(btn);
  tabs.style.display = '';
  let loaded = false;
  const show = on => {
    document.body.classList.toggle('fotab', on);
    panel.style.display = on ? '' : 'none';
    if (!on || loaded) return;
    loaded = true;
    frontOffice(team).catch(() => { loaded = false; });
  };
  btn.onclick = () => { show(true); syncTabs(); };
  tabs.querySelectorAll('.ep-tab').forEach(b => {
    if (b === btn) return;
    const prev = b.onclick;
    b.onclick = e => { show(false); if (prev) prev.call(b, e); syncTabs(); };
  });
  if (new URLSearchParams(location.search).get('tab') === 'front-office') { show(true); syncTabs(); }
  syncTabs();
}

/* SHARE THE FRONT OFFICE (0193). A club official - is_team_manager: its managers, its league's administrators - gives
   the tab to an analyst, a scout or an assistant by their email address, before they have even signed in; it
   appears in their hub the moment they do (with a membership that opens it). Nothing is drawn for anybody else. */
async function frontOfficeShare(team) {
  const host = $('#foshare');
  const sb = window.epinoiaClient && window.epinoiaClient();
  if (!host || !sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data: mine } = await sb.rpc('is_team_manager', { p_team: team.id });
    if (!mine) return;
  } catch (_) { return; }
  host.textContent = '';
  const card = el('div', 'ep-card fo-share');
  card.appendChild(el('div', 'fo-share-h', 'share the front office'));
  card.appendChild(el('p', 'fo-share-p', 'Give this tab to someone who works for the club - an analyst, a scout, an assistant coach. ' +
    'It appears in their hub under "front office" when they sign in with this address (and their membership opens it).'));
  const row = el('div', 'fo-share-row');
  const input = el('input', 'ep-input');
  input.type = 'email'; input.placeholder = 'their email address'; input.autocomplete = 'off';
  const add = el('button', 'ep-btn', 'give access'); add.type = 'button';
  row.append(input, add);
  const list = el('div', 'fo-share-list');
  const msg = el('div', 'fo-share-msg');
  card.append(row, msg, list);
  host.appendChild(card);
  const say = (t, bad) => { msg.textContent = t; msg.classList.toggle('bad', !!bad); };
  const draw = async () => {
    const { data, error } = await sb.rpc('front_office_grants_for', { p_team: team.id });
    list.textContent = '';
    if (error) { say('Who has it could not be read: ' + error.message, true); return; }
    if (!(data || []).length) { list.appendChild(el('div', 'fo-share-none', 'Only the club\'s own officials have it so far.')); return; }
    data.forEach(g => {
      const r = el('div', 'fo-share-item');
      r.append(el('span', 'fo-share-e', g.email));
      const x = el('button', 'ep-btn mini', 'remove'); x.type = 'button';
      x.addEventListener('click', async () => {
        x.disabled = true;
        const { error: e2 } = await sb.rpc('revoke_front_office', { p_team: team.id, p_email: g.email });
        if (e2) { x.disabled = false; say(e2.message, true); return; }
        say(g.email + ' no longer has the front office.');
        draw();
      });
      r.append(x);
      list.appendChild(r);
    });
  };
  add.addEventListener('click', async () => {
    const email = input.value.trim();
    if (!email) return;
    add.disabled = true;
    const { error } = await sb.rpc('grant_front_office', { p_team: team.id, p_email: email });
    add.disabled = false;
    if (error) { say(error.message, true); return; }
    input.value = '';
    say(email + ' has the front office: it is in their hub when they sign in.');
    draw();
  });
  draw();
}

/* ONE TAB LIT, THE ONE WHOSE SECTION IS SHOWING. Each tab (video, the weekly report, the front office) toggles its
   own body class; read together they say which is open, so the highlight cannot disagree with the page - which it
   did when three handlers each lit buttons by their own rule. */
function syncTabs() {
  const tabs = $('#ttabs');
  if (!tabs) return;
  const c = document.body.classList;
  const open = c.contains('rptab') ? 'report' : c.contains('fotab') ? 'front-office' : c.contains('vtab') ? 'video' : 'profile';
  tabs.querySelectorAll('.ep-tab').forEach(b => {
    const on = b.dataset.p === open;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
}

/* THE DEPTH CHART'S BASE, read once for the page: the club's last forty finals with their starters (seasonGames: never
   their logs), the squad, the releases and who started. Enough for the profile's chart wherever each game's position
   file is there (depthShares); depthInput adds what only the projection and the Front office need. */
let depthBaseP = null;
function depthBase(team) {
  const D = window.EpinoiaData;
  return depthBaseP || (depthBaseP = (async () => {
    const [{ gs, sideOf }, roster, rel] = await Promise.all([
      seasonGames(team),
      api(`roster_entries?team_id=eq.${team.id}&active=eq.true&select=jersey,position,${SQUAD_COLS},players(id,first_name,last_name,height_cm)`)
        .then(rows => squadOf(rows)),
      D.releases(team.id).catch(() => [])
    ]);
    const games = gs.slice().sort((a, b) => String(b.tipoff_at).localeCompare(String(a.tipoff_at)));
    /* starts: the whole window, and the last five */
    const starts = { season: new Map(), recent: new Map(), games: 0 };
    games.forEach((g, i) => {
      const five = Array.isArray(g.starters) && g.starters[sideOf[g.id]];
      if (!Array.isArray(five) || !five.length) return;
      if (i < 5) starts.games++;
      five.forEach(id => {
        starts.season.set(id, (starts.season.get(id) || 0) + 1);
        if (i < 5) starts.recent.set(id, (starts.recent.get(id) || 0) + 1);
      });
    });
    const released = new Set((rel || []).map(r => r.player_id));
    const people = roster.filter(r => r.players && r.players.id).map(r => ({
      id: r.players.id, name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim(), num: r.jersey,
      position: r.position || '', height: r.players.height_cm }));
    return { gs, sideOf, games, rel, starts, released, people };
  })().catch(e => { depthBaseP = null; throw e; }));
}

/* THE DEPTH CHART'S INPUTS, read once for the page: the base, the last ten games' lines (recent minutes, who is missing
   now) and the league's season line. The projection (a club with no lineups) and the Front office draw from it; neither
   waits for the win model. */
let depthInP = null;
function depthInput(team) {
  const D = window.EpinoiaData;
  return depthInP || (depthInP = (async () => {
    const { gs, sideOf, games, rel, starts, released, people } = await depthBase(team);
    /* the last ten games' lines: minutes over the last five, and who is missing now */
    const last10 = games.slice(0, 10);
    const W = last10.length ? await D.statsForGames(last10) : { pgs: [] };
    const five = new Set(games.slice(0, 5).map(g => g.id));
    const agg = new Map();
    (W.pgs || []).forEach(r => {
      const pid = r.player_uuid || r.player_id, m = (r.stats && +r.stats.min || 0) / 60000;
      if (!pid || !five.has(r.game_id) || (r.team_idx !== sideOf[r.game_id]) || m <= 0) return;
      const a = agg.get(pid) || { min: 0, gp: 0 };
      a.min += m; a.gp++; agg.set(pid, a);
    });
    const recent = new Map([...agg].map(([id, a]) => [id, { mpg: a.min / a.gp }]));
    const I = window.EpinoiaInjuries;
    const out = new Set();
    if (I && I.report) {
      const rep = I.report({ games: last10, pgs: W.pgs || [], released: rel });
      (rep.byTeam.get(String(team.id)) || []).forEach(e => { if (!e.stale) out.add(e.playerId); });
    }

    /* the league's season line: the club's own players, and every club for the ranks */
    const played = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&status=eq.final&select=competition_id` + inSeason());
    const ids = [...new Set(played.map(g => g.competition_id).filter(Boolean))];
    const comps = ids.length ? await D.all(`competitions?id=in.(${ids.join(',')})&select=id,kind`) : [];
    const league = comps.filter(c => (c.kind || 'league') === 'league').map(c => c.id);
    const S = await D.season(league.length ? league : ids, { rows: false });
    const seasonRows = new Map((S.players || []).map(p => [p.id, p]));
    const names = new Map(people.map(p => [p.id, p.name]));
    const mine = (S.players || []).filter(p => S.teamOfPlayer && S.teamOfPlayer.get(p.id) === team.id)
      .map(p => Object.assign({}, p, { name: names.get(p.id) || p.name || '' }));
    const missingNames = mine.filter(p => !p.name).map(p => p.id);
    if (missingNames.length && D.playerMeta) {
      try { const meta = await D.playerMeta(missingNames); mine.forEach(p => { if (!p.name && meta[p.id]) p.name = meta[p.id].name; }); } catch (_) { /* unnamed */ }
    }

    const chartIn = { roster: people, season: seasonRows, recent, starts, out, released };
    return { chartIn, S, mine, people, names, gs, sideOf };
  })().catch(e => { depthInP = null; throw e; }));
}

/* THE CLUB'S OWN LINEUPS (lineup_stints: the five on the floor and how long; ids and seconds only), its own side of
   each game alone (a home game's team_idx 0, an away game's 1: half the rows), read once a game for the page. */
const stintCache = new Map();          // game id -> the club's stints in it (a promise)
function clubStintsFor(games, sideOf) {
  const D = window.EpinoiaData;
  const todo = games.filter(g => !stintCache.has(g.id));
  [0, 1].forEach(side => {
    const ids = todo.filter(g => sideOf[g.id] === side).map(g => g.id);
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const read = D.all(`lineup_stints?game_id=in.(${chunk.join(',')})&team_idx=eq.${side}&select=game_id,team_idx,player_ids,dur:stats->dur&order=game_id,id`);
      read.catch(() => chunk.forEach(id => stintCache.delete(id)));
      chunk.forEach(id => stintCache.set(id, read.then(rows => rows.filter(r => r.game_id === id))));
    }
  });
  return Promise.all(games.map(g => stintCache.get(g.id) || Promise.resolve([]))).then(parts => parts.flat());
}

/* THE CLUB'S MINUTES AT EACH POSITION, FROM ITS OWN LINEUPS (no model file): every stint of its last forty finals, each
   five ranked point guard to centre by the players' positions on the league's season line (depth.js floorPos). The
   Front office's, and the profile's for a club whose games have no position files. Kept for the page. */
let stintsP = null, floorP = null;
function clubStints(team) {
  return stintsP || (stintsP = (async () => {
    const X = window.EpinoiaDepth;
    const I = await depthInput(team);
    const stints = await clubStintsFor(I.gs, I.sideOf);
    const value = new Map();
    I.people.forEach(p => value.set(p.id, X.positionOf(p, I.chartIn.season.get(p.id))));
    return { I, stints, valueOf: id => value.has(id) ? value.get(id) : X.positionOf({}, I.chartIn.season.get(id)) };
  })().catch(e => { stintsP = null; throw e; }));
}
function floorMinutes(team) {
  return floorP || (floorP = clubStints(team).then(({ I, stints, valueOf }) => window.EpinoiaDepth.floorPos(stints, I.sideOf, valueOf))
    .catch(e => { floorP = null; throw e; }));
}

/* EACH GAME'S POSITION FILE (snapshots/pos/<game>.json, written by the snapshots function with depth.js posFile): the
   minutes each player played at each position, a few hundred bytes a game, in place of both sides' lineups and the
   league's season line it took to rank them. Read once for the page. */
let filesP = null;
function clubFiles(team) {
  return filesP || (filesP = (async () => {
    const B = await depthBase(team), D = window.EpinoiaData;
    if (!D.posFiles || !B.games.length) return { B, files: new Map() };
    /* the newest three first: a league whose games get no file (members-only) costs three asks, not forty */
    const ids = B.games.map(g => g.id);
    const files = await D.posFiles(ids.slice(0, 3));
    if (ids.length > 3 && [...files.values()].some(Boolean)) (await D.posFiles(ids.slice(3))).forEach((f, id) => files.set(id, f));
    return { B, files };
  })().catch(e => { filesP = null; throw e; }));
}
/* WHO IS MISSING NOW (injuries.js), from the files' box minutes for the club's last ten games, and for a game with no
   file yet from its own lineups; a game with neither says nothing about who played and is left out. */
let outP = null;
function outNow(team) {
  return outP || (outP = (async () => {
    const I = window.EpinoiaInjuries, X = window.EpinoiaDepth;
    if (!I || !I.report) return new Set();
    const { B, files } = await clubFiles(team);
    const last10 = B.games.slice(0, 10);
    const pgs = X.posLines(last10.map(g => files.get(g.id)).filter(Boolean));
    const bare = last10.filter(g => !files.get(g.id));
    if (bare.length) {
      const per = new Map();
      (await clubStintsFor(bare, B.sideOf)).forEach(r => (r.player_ids || []).forEach(id => {
        const k = r.game_id + '|' + id;
        per.set(k, (per.get(k) || 0) + (+r.dur || 0));
      }));
      per.forEach((ms, k) => { const [g, id] = k.split('|'); pgs.push({ game_id: g, player_uuid: id, team_idx: B.sideOf[g], stats: { min: ms } }); });
    }
    const known = new Set(pgs.map(r => r.game_id));
    const rep = I.report({ games: last10.filter(g => known.has(g.id)), pgs, released: B.rel });
    const out = new Set();
    (rep.byTeam.get(String(team.id)) || []).forEach(e => { if (!e.stale) out.add(e.playerId); });
    return out;
  })().catch(e => { outP = null; throw e; }));
}

/* THE PROFILE'S DEPTH CHART (under the team statistics): each position's minutes and who took them (depth.js shareChart),
   over the season shown or the club's last five games - the switch above it. Every column adds up to 100%: each player's
   share of the minutes the club played at that position, a player standing once however many roster rows he has
   (squadOf), and one out now or let go since keeping the minutes he played. A club with no lineups yet gets the
   projection (splitChart) and no switch. Open to every reader the page is open to; the Front office's own view adds
   the league comparison and the win model.
   FROM THE FILES FIRST: the club's side of each game's position file, summed (depth.js posFromFiles); a game without one
   (finished in the last few minutes) is read from its own lineups, each five ranked by where the files put each player
   (his minutes' average position, else his listing and height). A club whose games have no file at all (a members-only
   league's, or before the files were written) is read the old way, the season line and every lineup (clubStints). */
let depthWin = 'season', depthAll = false;
const depthNames = new Map();          // names of players the squad does not carry, read once
async function depthShares(team, win, all) {
  const X = window.EpinoiaDepth, D = window.EpinoiaData;
  const { B, files } = await clubFiles(team);
  const want = win === 'last5' ? B.games.slice(0, 5) : B.games;
  const filed = X.posFromFiles ? want.filter(g => files.get(g.id)) : [];
  let pos, out, I = null;
  if (filed.length || (X.posFromFiles && B.games.some(g => files.get(g.id)))) {
    pos = X.posFromFiles(filed.map(g => files.get(g.id)), B.sideOf);
    const rest = want.filter(g => !files.get(g.id));
    if (rest.length) {
      const seen = X.posFromFiles(B.games.map(g => files.get(g.id)).filter(Boolean), B.sideOf);
      const place = new Map(((seen && seen.players) || []).map(p => {
        const t = p.min.reduce((a, m) => a + m, 0);
        return [String(p.id), t > 0 ? p.min.reduce((a, m, k) => a + (k + 1) * m, 0) / t : 3];
      }));
      const roster = new Map(B.people.map(p => [String(p.id), p]));
      const more = X.floorPos(await clubStintsFor(rest, B.sideOf), B.sideOf,
        id => (place.has(String(id)) ? place.get(String(id)) : X.positionOf(roster.get(String(id)) || {}, null)));
      if (more) pos = pos ? { games: pos.games + more.games, min: pos.min + more.min, players: pos.players.concat(more.players) } : more;
    }
    /* out now: today's news, so only on the season being played now */
    out = SEASON_NOW ? await outNow(team).catch(() => new Set()) : new Set();
  } else {
    const cs = await clubStints(team);
    I = cs.I;
    const ids = new Set(want.map(g => g.id));
    pos = X.floorPos(cs.stints.filter(st => ids.has(st.game_id)), cs.I.sideOf, cs.valueOf);
    out = SEASON_NOW ? cs.I.chartIn.out || new Set() : new Set();
  }
  if (!pos) return { c: null, games: want.length };
  const people = new Map(B.people.map(p => [String(p.id), p]));
  const seasonNames = new Map(((I && I.mine) || []).map(p => [String(p.id), p.name]));
  const unnamed = pos.players.map(p => String(p.id)).filter(id => !people.has(id) && !seasonNames.get(id) && !depthNames.has(id));
  if (unnamed.length && D.playerMeta) {
    try { const meta = await D.playerMeta(unnamed); unnamed.forEach(id => depthNames.set(id, (meta[id] && meta[id].name) || '')); } catch (_) { /* unnamed */ }
  }
  /* gone since: today's news too */
  const left = SEASON_NOW ? B.released : new Set();
  const who = id => {
    const p = people.get(id);
    return { name: (p && p.name) || seasonNames.get(id) || depthNames.get(id) || '', num: p ? p.num : '',
             out: out.has(id), left: left.has(id) && !p };
  };
  const starts = win === 'last5' ? B.starts.recent : B.starts.season;
  return { c: X.shareChart({ pos, who, starts, window: win, games: want.length, all: !!all }), games: want.length };
}

async function profileDepth(team, win, all) {
  const host = $('#teamdepth'), X = window.EpinoiaDepth;
  if (!host || !X || ACCESS.paywall) return;
  if (win) depthWin = win;
  if (typeof all === 'boolean') depthAll = all;
  if (!host.firstChild) host.innerHTML = '<div class="empty">Working out the depth chart…</div>';
  const note = $('#tdepthNote');
  const link = p => '../p/?p=' + encodeURIComponent(p.id);
  const season = SEASON_NAME ? seasonText(SEASON_NAME) : '';
  try {
    let whole = null;
    try { whole = X.shareChart ? await depthShares(team, 'season', depthAll) : null; } catch (_) { /* no lineups read: projected */ }
    if (!whole || !whole.c) {
      /* no lineups: the projection, which is what needs the box scores and the season line */
      const I = await depthInput(team);
      const gameMin = X.gameMinutes ? X.gameMinutes(team.leagues || {}) : 40;
      host.innerHTML = X.chartHTML(X.splitChart(X.chart(I.chartIn), gameMin), { link, static: true });
      if (note) note.textContent = 'projected from the club\'s own games';
      return;
    }
    const view = depthWin === 'last5' ? await depthShares(team, 'last5', depthAll) : whole;
    const sw = el('div', 'ep-tabs dcwin');
    sw.setAttribute('role', 'tablist'); sw.setAttribute('aria-label', 'depth chart period');
    [['season', season ? 'Season ' + season : 'Season'], ['last5', 'Last 5 games']].forEach(([k, lab]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ep-tab' + (k === depthWin ? ' on' : ''); b.textContent = lab;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === depthWin));
      b.onclick = () => { if (k !== depthWin) profileDepth(team, k); };
      sw.appendChild(b);
    });
    /* SHOW ALL: the shares under 5% are folded into each column's 'others' line until the reader asks for them */
    const row = el('div', 'dcbar');
    row.appendChild(sw);
    if (depthAll || (view.c && view.c.hidden)) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'ep-btn dcall'; more.setAttribute('aria-pressed', String(depthAll));
      more.textContent = depthAll ? 'Show fewer' : 'Show all';
      more.onclick = () => profileDepth(team, null, !depthAll);
      row.appendChild(more);
    }
    host.textContent = '';
    host.appendChild(row);
    host.insertAdjacentHTML('beforeend', X.shareHTML(view.c, { link }));
    if (note) note.textContent = 'from the club\'s own lineups: each player\'s share of the minutes at each position';
  } catch (_) { host.innerHTML = '<div class="empty">The depth chart could not be drawn just now.</div>'; }
}

/* THE FRONT OFFICE: the depth chart, the GM's view (t/depth.js) and the win model (t/fomodel.js). Everything it reads
   is already read for this page or cached: the club's last forty finals with their starters (seasonGames: the games,
   never their event logs), the league's season line (D.season without rows: the snapshot or this browser's copy), the
   last ten games' player lines for the minutes and who is missing now, the roster for positions and heights, the
   releases and the ages; and, for the win model, two members-only files through EpinoiaWinFile (the league's `fo`
   file and the club's own) and the fixtures to come. The files carry the club's minutes at each position (A.1), so
   the depth chart is filled from the floor where they arrive. */
async function frontOffice(team) {
  const hostD = $('#depth'), hostG = $('#gmview'), hostM = $('#wmodel');
  const X = window.EpinoiaDepth, D = window.EpinoiaData;
  if (ACCESS.paywall || !hostD || !X || !D) return;
  if (!frontOfficeOpen(team)) {
    hostD.innerHTML = accessTeaser({ compact: true, title: 'The front office', lines: [
      'Who starts, who backs up, and at which position, projected from the club\'s own games.',
      'Every position charted against the same position at every club in the league.',
      'Strengths, weaknesses and needs, read the way a general manager would.'] });
    if (hostG) hostG.textContent = '';
    modelLocked(hostM, team);
    return;
  }
  /* the win model's files, asked for at once beside everything else */
  const modelP = winModelFiles(team).catch(() => null);
  try {
    const { chartIn, S, mine, people, names } = await depthInput(team);
    let c = X.chart(chartIn);
    /* the league view compares the club with every other club put through chart(), each player at ONE slot: the club
       keeps its own chart() for that, never the slot chart below, where a player stands at two or three positions and
       his whole season would count at each (POS2-1) */
    const cLeague = c;
    const link = p => '../p/?p=' + encodeURIComponent(p.id);
    /* WHAT IS DRAWN ADDS UP: every position one game long (the league's own length), a player's minutes split where
       they cross from one position to the next */
    const gameMin = X.gameMinutes ? X.gameMinutes(team.leagues || {}) : 40;
    if (X.splitChart) c = X.splitChart(c, gameMin);
    hostD.innerHTML = X.chartHTML(c, { link });
    /* EACH POSITION OPENS ITS LEAGUE VIEW (position.js): every club put through the same chart, read the first time
       a position is pressed and kept - the clubs' rosters for heights and listed positions, and their names and colours */
    const PV = window.EpinoiaPosition;
    let ctxP = null;
    const leagueCtx = () => ctxP || (ctxP = (async () => {
      const ids = (S.teams || []).map(t => t.id).filter(Boolean);
      const [rosters, meta] = await Promise.all([
        ids.length ? api(`roster_entries?team_id=in.(${ids.join(',')})&active=eq.true&select=position,${SQUAD_COLS},players(id,height_cm)`).then(rows => squadOf(rows)) : [],
        ids.length ? api(`teams?id=in.(${ids.join(',')})&select=id,name,short_name,colour,logo_path`) : []
      ]);
      return PV.context({ season: S, rosters, meta, own: { teamId: team.id, chart: cLeague } });
    })().catch(e => { ctxP = null; throw e; }));
    /* the depth chart's positions and the win model's slot buttons (F3) open the same view */
    const onSlot = async e => {
      const b = e.target.closest && e.target.closest('[data-slot]');
      if (!b) return;
      b.classList.add('dc-busy');
      try {
        const rep = PV.report(await leagueCtx(), team.id, b.getAttribute('data-slot'));
        if (rep) { rep.club.name = team.name; rep.club.colour = readableColour(team); }
        PV.open(PV.html(rep, { close: true, link }), b);
      } catch (_) { PV.open('<div class="pv"><div class="empty">The league view could not be read just now.</div><button type="button" class="pv-x" data-pv-close aria-label="close">×</button></div>', b); }
      b.classList.remove('dc-busy');
    };
    if (PV) { hostD.addEventListener('click', onSlot); if (hostM) hostM.addEventListener('click', onSlot); }

    /* THE CLUB'S OWN LINEUPS fill the depth chart, whether or not the win model is built (the profile's copy reads the
       same, once for the page) */
    let byFloor = false;
    try {
      const fp = X.floorPos ? await floorMinutes(team) : null;
      const cs = fp && X.slotChart(Object.assign({ pos: fp, gameMin }, chartIn));
      if (cs) {
        c = cs; byFloor = true;
        hostD.innerHTML = X.chartHTML(c, { link });
        const note = $('#depthNote');
        if (note) note.textContent = 'from the club\'s own lineups: the minutes each player has played at each position';
      }
    } catch (_) { /* no lineups read: the projection stands, or the model's file below */ }

    /* THE WIN MODEL'S FILES: the GM's view is ordered by what each measure is worth, and F3 is drawn; where the club's
       lineups could not be read, the model's minutes at each position (A.1) fill the depth chart */
    const M = await modelP;
    const fo = M && M.fo && M.fo.ok ? M.fo.data : null, club = M && M.club && M.club.ok ? M.club.data : null;
    const pos = (club && club.pos) || (fo && fo.pos && fo.pos[team.id]) || null;
    if (!byFloor && pos && X.slotChart) {
      const cs = X.slotChart(Object.assign({ pos, gameMin }, chartIn));
      if (cs) {
        c = cs;
        hostD.innerHTML = X.chartHTML(c, { link });
        const note = $('#depthNote');
        if (note) note.textContent = 'filled from the minutes each player has played at each position';
      }
    }
    mine.forEach(p => { if (p.name && !names.has(p.id)) names.set(p.id, p.name); });
    winModel(hostM, team, M, { names, link });
    if (!hostG) return;
    const ages = window.EpinoiaAges ? await window.EpinoiaAges.load(CFG, mine.map(p => p.id)).catch(() => ({})) : {};
    const FM = window.EpinoiaFoModel;
    const g = X.gm({ team, teams: S.teams || [], players: mine, ages: new Map(Object.entries(ages)),
                     heights: new Map(people.filter(p => p.height).map(p => [p.id, +p.height])),
                     model: fo && FM ? FM.gmModel(fo, team.id) : undefined });
    hostG.innerHTML = X.gmHTML(g);
    const note = $('#gmNote');
    if (note && g.of) note.textContent = 'against the ' + g.of + ' clubs of the league';
    frontOfficeShare(team).catch(() => { /* not an official, or an older database: nothing to share */ });
  } catch (e) {
    hostD.innerHTML = '<div class="empty">The depth chart could not be drawn.</div>';
  }
}

/* THE WIN MODEL'S FILES (F3; docs/what-wins-model.md §10, §12): the league-season's `fo` file, then the club's own, and
   the fixtures to come. The database decides on each request; the catalogue's 'model' lock (or, before access.js
   lists it, the analytics entitlement it rides on) only skips asking when the answer is already known to be no. */
function modelUnit(team) {
  const lg = (team && team.leagues) || {};
  return { league: lg.id, season: SEASON_ID || undefined };
}
function modelKnownLocked(team) {
  const A = window.EpinoiaAccess, M = window.EpinoiaMemLock, lid = ((team && team.leagues) || {}).id;
  let locked = false;
  try { locked = !!(M && M.locked && M.locked('model', lid)); } catch (_) { /* fails open */ }
  try { if (!locked && A && A.CATALOGUE && A.CATALOGUE.locks && !A.CATALOGUE.locks.model && A.analyticsOk) locked = A.analyticsOk(lid) === false; } catch (_) { /* fails open */ }
  return locked;
}
/* THE WIN MODEL'S CODE (PERF: about 250 KB a team-page view never needed): loaded when the Front office first opens,
   never on a plain view. The statistics and the simulator (the panel builds its matchups on the page; its Worker
   imports its own copies), the files' loader, the chart kit and the panel, in that order, at this script's own ?v=;
   their two sheets go in before legibility.css, which stays last. Resolves when all have run (or failed: the panel
   then says the model could not be reached). */
let winModelLoad = null;
function loadWinModel() {
  if (winModelLoad) return winModelLoad;
  const v = TEAM_V ? '?v=' + TEAM_V : '';
  const last = document.querySelector('link[rel="stylesheet"][href*="kit/legibility.css"]');
  ['../kit/vizkit.css', '../kit/fomodel.css'].forEach(href => {
    if (document.querySelector('link[href^="' + href + '"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href + v;
    if (last && last.parentNode) last.parentNode.insertBefore(l, last); else document.head.appendChild(l);
  });
  const one = (src, has) => new Promise(res => {
    if (has()) return res(true);
    const s = document.createElement('script'); s.src = src + v; s.async = false;
    s.onload = () => res(true); s.onerror = () => res(false);
    document.head.appendChild(s);
  });
  winModelLoad = (async () => {
    for (const [src, has] of [['../winstats.js', () => !!window.EpinoiaWinStats], ['../winsim.js', () => !!window.EpinoiaWinSim],
      ['../winfile.js', () => !!window.EpinoiaWinFile], ['../vizkit.js', () => !!window.EpinoiaVizKit], ['fomodel.js', () => !!window.EpinoiaFoModel]]) await one(src, has);
    return !!(window.EpinoiaWinFile && window.EpinoiaFoModel);
  })();
  return winModelLoad;
}
async function winModelFiles(team) {
  await loadWinModel();
  const WF = window.EpinoiaWinFile, unit = modelUnit(team);
  if (!WF || !window.EpinoiaFoModel || !unit.league) return null;
  if (modelKnownLocked(team)) return { fo: { ok: false, reason: 'members' } };
  const fixturesP = api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&status=in.(scheduled,live)` +
    `&select=id,home_team_id,away_team_id,tipoff_at` + inSeason() + `&order=tipoff_at.asc`).catch(() => []);
  /* the league's file and the club's at once: the club's ask needs nothing from the fo file, only that it is allowed,
     and a refusal of one is a refusal of both (the club's answer is then dropped) */
  const both = await Promise.all([WF.get(Object.assign({ scope: 'fo' }, unit)), WF.get(Object.assign({ scope: 'club', team: team.id }, unit))]);
  const club = both[1];
  let fo = both[0];
  /* nothing built yet (the public teaser's index is not there either): said as that, never "could not be reached" */
  if (!fo.ok && (fo.reason === 'network' || fo.reason === 'none')) {
    const t = await WF.get({ scope: 'teaser' });
    if (!t.ok && t.reason === 'none') fo = { ok: false, reason: 'unbuilt' };
  }
  return { fo, club: fo.ok ? club : null, fixtures: await fixturesP };
}
function modelLocked(host, team) {
  if (!host) return;
  const M = window.EpinoiaMemLock, node = M && M.placeholder ? M.placeholder({ rows: 5, what: 'What wins model', leagueSlug: ((team && team.leagues) || {}).slug }) : null;
  host.textContent = '';
  if (node) host.appendChild(node); else host.appendChild(el('div', 'empty', 'Members’ analysis.'));
}
/* F3: the panel, its Worker, and RECALCULATE (the fo file refreshed, then the club's own read again) */
function winModel(host, team, M, o) {
  const FM = window.EpinoiaFoModel, WF = window.EpinoiaWinFile;
  if (!host || !FM) return;
  if (!M) { host.innerHTML = '<div class="empty">The model could not be reached just now</div>'; return; }
  const unit = modelUnit(team), A = window.EpinoiaAccess;
  const fo = M.fo || { ok: false, reason: 'network' };
  const input = { fo: fo.ok ? fo.data : null, club: M.club && M.club.ok ? M.club.data : null, team: { id: team.id, name: team.name },
                  fixtures: M.fixtures || [], names: o.names, reason: fo.ok ? null : fo.reason, retryAfter: fo.retryAfter };
  let signin = '../signin/';
  try { if (A && A.signinHref) signin = A.signinHref(location.pathname + location.search); } catch (_) { /* the plain link */ }
  const refresh = async ({ signal, onProgress }) => {
    const a = await WF.refresh(Object.assign({ scope: 'fo' }, unit), { signal, onProgress });
    if (!a.ok) return a;
    if (a.queued || a.refreshReason === 'recent' || a.refreshReason === 'cap') return Object.assign({}, a, { ans: a, fo: a.data, club: input.club });
    const c = await WF.get(Object.assign({ scope: 'club', team: team.id }, unit), { force: true, signal });
    return Object.assign({}, a, { ans: a, fo: a.data, club: c.ok ? c.data : input.club });
  };
  FM.mount(host, FM.view(input), { input, worker: FM.makeWorker(), link: o.link, ans: fo.ok ? fo : null, refresh, signin,
                                   leagueSlug: ((team && team.leagues) || {}).slug });
}

/* ON VIDEO — every play the club made in every game that has footage the page can
   seek, under a Video tab beside the profile. The same panel as a player's profile
   (p/video.js) in team mode: the whole side of each game, each man named. */
async function videoPanel(team) {
  const D = window.EpinoiaData;
  if (ACCESS.paywall) return;          // video rows are behind the wall (§2)
  if (!D || !window.EpinoiaPlayerVideo) return;
  try {
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=id,home_team_id,away_team_id,tipoff_at,` + inSeason() +
      `home:home_team_id(short_name,name),away:away_team_id(short_name,name)&order=tipoff_at.desc&limit=40`);
    if (!gs.length) return;
    const chunk = async (ids, build) => {
      const out = [];
      for (let i = 0; i < ids.length; i += 40) out.push(...await api(build(ids.slice(i, i + 40))));
      return out;
    };
    const vids = await chunk(gs.map(g => g.id), c =>
      'game_videos?game_id=in.(' + c.join(',') + ')&is_primary=eq.true&select=game_id,url,provider,video_ref,label,' +
      'stream_started_at,tip_at,tip_wall,tip_offset_ms,trim_ms,clock_track');
    const byGameV = {};
    vids.forEach(v => { if (v.url) byGameV[v.game_id] = v; });
    const withV = gs.filter(g => byGameV[g.id]);
    if (!withV.length) return;
    const evs = await D.events(withV.map(g => g.id));
    const names = {};
    try {
      const meta = await D.playerMeta([...new Set(evs.map(e => e.pid).filter(Boolean))]);
      Object.keys(meta).forEach(id => { if (meta[id] && meta[id].name) names[id] = meta[id].name; });
    } catch (_) { /* rows fall back to the play alone */ }
    const games = withV.map(g => {
      const h = (g.home || {}).short_name || (g.home || {}).name || 'home';
      const a = (g.away || {}).short_name || (g.away || {}).name || 'away';
      return {
        id: g.id, video: byGameV[g.id], date: g.tipoff_at,
        side: g.home_team_id === team.id ? 0 : 1,
        title: h + ' v ' + a + (g.tipoff_at ? ' \u00b7 ' + new Date(g.tipoff_at).toLocaleDateString() : ''),
        events: evs.filter(e => e.gameId === g.id)
      };
    });
    const shown = window.EpinoiaPlayerVideo.render({ host: '#videopanel', games, teamId: team.id, names });
    if (!shown) return;
    $('#videoNote').textContent = games.length + (games.length === 1 ? ' game with footage' : ' games with footage');
    const tabs = $('#ttabs');
    if (!tabs) return;
    tabs.dataset.video = '1';                 // the Video tab is offered only now (index.html's rule hides it before)
    tabs.style.display = '';
    const showVideo = on => {
      document.body.classList.toggle('vtab', on);
      $('#videosec').style.display = on ? '' : 'none';
      tabs.querySelectorAll('.ep-tab').forEach(b => b.classList.toggle('on', (b.dataset.p === 'video') === on));
      if (on) window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });
    };
    tabs.querySelectorAll('.ep-tab').forEach(b => { if (b.dataset.p === 'profile' || b.dataset.p === 'video') b.onclick = () => showVideo(b.dataset.p === 'video'); });
    if (new URLSearchParams(location.search).get('tab') === 'video') showVideo(true);
  } catch (e) { console.warn('[video]', e); }
}

/* THE REPORT (report.js, report-teampages.js; 2026-10-02, in place of the weekly report): the club's analysis as A4 pages,
   the preview the document. Its data is this page's own, read once and shared: the season line of the scope shown
   (teamStats hands it over as it is drawn, rpGive), the club's logs, lineups and depth chart. */
const RP_WAIT = {};
function rpSlot(k) { if (!RP_WAIT[k]) { let res; RP_WAIT[k] = { p: new Promise(r => { res = r; }), res, done: false, v: null }; } return RP_WAIT[k]; }
function rpGive(k, v) { const w = rpSlot(k); w.v = v; if (!w.done) { w.done = true; w.res(v); } }
function rpGet(k, ms) { const w = rpSlot(k); return w.done ? Promise.resolve(w.v) : Promise.race([w.p, new Promise(r => setTimeout(() => r(w.v), ms || 120000))]); }
let REPORT = null;
function reportTab(team) {
  const E = window.EpinoiaReport, RT = window.EpinoiaReportTeam, D = window.EpinoiaData;
  if (!E || !RT || !D || REPORT || ACCESS.paywall) return;
  const lg = team.leagues || {};
  const scopeText = () => [teamScopeKind !== 'all' ? (KIND_LABEL[teamScopeKind] || teamScopeKind) : '', lg.name, SEASON_NAME ? seasonText(SEASON_NAME) : '']
    .filter(Boolean).join(' ');
  const ctx = {
    season: () => rpGet('season'),
    logs: () => seasonLogs(team),
    clubLogs: scoped => clubLogs(team, scoped),
    starters: comps => scopeStarters(comps),
    depth: all => depthShares(team, 'season', !!all),
    /* the rebounds off each zone need the competition's shots read once (shotchart.js attachZoneStats), as the page's own
       shot zones card reads them when it is opened */
    rebounds: async (S, mine) => {
      if (!mine.rb_ready && window.EpinoiaShotChart && window.EpinoiaShotChart.attachZoneStats) { try { await window.EpinoiaShotChart.attachZoneStats(S, D); } catch (_) { /* without */ } }
      const row = S.teams.find(t => t.id === mine.id) || mine;
      const h = el('div'); reboundZones(h, S, row); return h.innerHTML;
    },
    meta: ids => D.playerMeta(ids),
    stints: gs => { const by = {}; gs.forEach(g => { by[g.id] = g; }); return D.stints(gs.map(g => g.id), team.id, by); },
    rapm: window.EpinoiaRAPM ? ((ids, fn) => window.EpinoiaRAPM.season(D, ids, fn).then(r => r.rapm)) : null,
    week: () => window.EpinoiaWeekly ? window.EpinoiaWeekly.teamWeek(api, team.id, { name: team.name, league: ACCESS.slug, days: 7 }) : null
  };
  REPORT = E.mount({
    tabs: '#ttabs', panel: '#reportsec', kind: 'team', label: 'Report',
    modules: RT.modules(ctx),
    context: () => ({
      kind: 'team', name: team.name, club: team.name, kicker: 'Club report',
      crest: window.epinoiaLogoUrl && team.logo_path ? window.epinoiaLogoUrl(team.logo_path, 512) : null,
      colour: team.colour || '#93f2bf', accent: E.inkOn ? E.inkOn(team.colour) : '#08603f',
      monogram: team.short_name && team.short_name.length <= 4 ? team.short_name : null,
      line: [team.name, lg.name].filter(Boolean).join(' · '), scope: scopeText(), subtitle: scopeText()
    })
  });
}

/* THE SEASON CARD (2026-10-02): the club's standing in ONE competition of the season at a time, with a button for each
   competition it has a game in -- its league's own (SLB, SLB Cup) and, where the club is linked to the same squad playing
   another competition that season (0178: London Lions' EuroCup side), that one's too. The pressed button says which
   competition the numbers are from; a club in one competition has its name there instead.
   It used to read the club's first standings row of ANY competition (limit 1): Liverpool's was an empty placeholder
   ("Super League Basketball Men", 0-0, rank 3) while its Championship stood at 0-2.
   The numbers are the competition's own table (standings). Where the table has no row for the club, or has not caught
   up with its finished games (a knockout cup keeps none), they are worked out from the games themselves, without a rank.
   The default is the competition with the most finished games, a league before a cup. */
const REC = { cards: [], at: null, chosen: false };
const KIND_ORDER = { league: 0, playoff: 1, cup: 2, trophy: 3, friendly: 4 };
const REC_GAME_COLS = 'competition_id,status,tipoff_at,home_team_id,away_team_id,home_score,away_score';
function recFromGames(gs, teamId) {
  const fin = (gs || []).filter(g => g.status === 'final' && g.home_score != null && g.away_score != null)
    .sort((a, b) => String(a.tipoff_at || '').localeCompare(String(b.tipoff_at || '')));
  let w = 0, l = 0, pf = 0, pa = 0;
  const res = fin.map(g => {
    const home = g.home_team_id === teamId;
    const us = +(home ? g.home_score : g.away_score) || 0, them = +(home ? g.away_score : g.home_score) || 0;
    pf += us; pa += them;
    if (us > them) { w++; return 'W'; }
    if (us < them) { l++; return 'L'; }
    return 'T';
  });
  let streak = '';
  const last = res[res.length - 1];
  if (last === 'W' || last === 'L') { let n = 0; for (let i = res.length - 1; i >= 0 && res[i] === last; i--) n++; streak = last + n; }
  return { gp: fin.length, w, l, pts_for: pf, pts_against: pa, diff: pf - pa, rank: null, streak };
}
function recNumbers(card) {
  const fin = card.games.filter(g => g.status === 'final').length;
  const r = card.row;
  if (r && (+r.gp || 0) >= fin) return r;
  return recFromGames(card.games, card.teamId);
}
/* the competitions in the order the buttons stand: the club's own first (its league, then playoffs, cups), then a linked side's */
function recSort(a, b) {
  return (a.own === b.own ? 0 : a.own ? -1 : 1) || ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)) ||
    String(a.label || '').localeCompare(String(b.label || ''));
}
function recLabel() {
  const SB = window.EpinoiaSeasonBar;
  const labels = SB && SB.compLabels ? SB.compLabels(REC.cards) : new Map();
  REC.cards.forEach(c => { c.label = labels.get(c.id) || c.name || KIND_LABEL[c.kind] || ''; });
  REC.cards.sort(recSort);
}
function drawRec() {
  const wrap = $('#rec');
  if (!wrap) return;
  wrap.textContent = '';
  wrap.classList.remove('has-season', 'has-comps');
  const card = REC.cards.find(c => c.id === REC.at) || REC.cards[0] || null;
  const s = card ? recNumbers(card) : null;
  const played = !!s && (+s.gp || 0) > 0;
  const pct = s && played ? (window.EpinoiaStandings ? window.EpinoiaStandings.pct(s.w, s.gp) : (s.w / s.gp).toFixed(3).replace(/^0/, '')) : '\u2014';
  const cells = s
    /* the winning percentage in place of games played (a basketball record already says how many: W + L) */
    ? [['rank', played && s.rank != null ? s.rank : '\u2014'], ['record', `${s.w}-${s.l}`], ['win%', pct],
       ['pts for', s.pts_for], ['pts against', s.pts_against],
       ['diff', (s.diff > 0 ? '+' : '') + s.diff], ['streak', s.streak || '\u2014']]
    : [['record', '0-0'], ['played', 0]];
  cells.forEach(([l, v]) => {
    /* data-k: the scoreboard lays the rank out on its own (kit/clubhero.css) */
    const d = el('div'); d.dataset.k = l.replace(/\s+/g, '-');
    d.append(el('div', 'v', v), el('div', 'l', l)); wrap.appendChild(d);
  });
  /* WHICH COMPETITION: a button each, the one shown pressed; one competition is named */
  if (REC.cards.length) {
    const row = el('div', 'rec-comps'); row.dataset.k = 'comps';
    if (REC.cards.length > 1) {
      row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'competition');
      REC.cards.forEach(c => {
        const b = el('button', 'rec-c' + (c === card ? ' on' : ''), c.label);
        b.type = 'button'; b.setAttribute('translate', 'no'); b.setAttribute('aria-pressed', c === card ? 'true' : 'false');
        b.title = [c.name, c.linked ? c.linked.league || '' : ''].filter(Boolean).join(' \u00b7 ');
        b.onclick = () => { if (REC.at === c.id) return; REC.at = c.id; REC.chosen = true; drawRec(); };
        row.appendChild(b);
      });
    } else {
      const one = el('span', 'rec-c one', card.label); one.setAttribute('translate', 'no'); one.title = card.name || '';
      row.appendChild(one);
    }
    wrap.insertBefore(row, wrap.firstChild);
    wrap.classList.add('has-comps');
  }
  /* WHICH SEASON THE BOARD IS FROM, always: a line across its top (2025/26) */
  if (SEASON_LABEL) {
    const h = el('div'); h.dataset.k = 'season';
    h.append(el('div', 'l', 'season'), el('div', 'v', SEASON_LABEL));
    wrap.insertBefore(h, wrap.firstChild);
    wrap.classList.add('has-season');
  }
}
async function record(team) {
  if (ACCESS.paywall) return;          // standings are behind the wall; the strip is hidden
  const lg = team.leagues || {};
  let comps = (SEASON_ROW && SEASON_ROW.comps) || [];
  let gs = [];
  try {
    if (comps.length) {
      gs = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&competition_id=in.(${comps.map(c => c.id).join(',')})` +
        `&select=${REC_GAME_COLS}&order=tipoff_at.asc`);
    } else {
      /* no season read (seasonbar.js missing or refused): the competitions of the season of the club's latest game */
      const all = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})&select=${REC_GAME_COLS}` +
        `,competitions(id,name,kind,season_id)&order=tipoff_at.asc`);
      const last = all.length ? (all[all.length - 1].competitions || {}).season_id : null;
      gs = all.filter(g => g.competitions && g.competitions.season_id === last);
      comps = [...new Map(gs.map(g => [g.competition_id, g.competitions])).values()];
    }
  } catch (e) { console.warn('[record]', e); }
  const ids = [...new Set(gs.map(g => g.competition_id).filter(Boolean))];
  let st = [];
  try {
    if (ids.length) st = await api(`standings?team_id=eq.${team.id}&competition_id=in.(${ids.join(',')})` +
      `&select=competition_id,gp,w,l,pts_for,pts_against,diff,league_points,rank,streak`);
  } catch (e) { console.warn('[record standings]', e); }
  const byId = new Map(comps.map(c => [c.id, c]));
  REC.cards = ids.map(id => {
    const c = byId.get(id) || {};
    return { id, own: true, teamId: team.id, name: c.name || '', kind: c.kind || 'league',
             league: { name: lg.name, slug: lg.slug, initials: lg.initials }, row: st.find(r => r.competition_id === id) || null,
             games: gs.filter(g => g.competition_id === id) };
  });
  recLabel();
  /* the default: the most finished games, a league before a cup, then the most games */
  const fin = c => c.games.filter(g => g.status === 'final').length;
  const best = REC.cards.slice().sort((a, b) => (fin(b) - fin(a)) || ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)) ||
    (b.games.length - a.games.length))[0];
  REC.at = best ? best.id : null;
  drawRec();
  recLinked(team).catch(e => console.warn('[record linked]', e));
}

/* THE SAME SQUAD IN ANOTHER COMPETITION. A club's linked sides (0178) are its other entries anywhere -- London Lions'
   EuroCup side, but also its NBL Division One side, another squad. A side counts on this card when it plays a
   competition of the same season and shares its players with this one (their profiles linked, player_group_members):
   two at least, and a third of the smaller squad. Measured 2026-10-02: the EuroCup side shares 11 of its 12, the
   Division One side none of its 15. Its women's and youth flags must match too. */
async function sameSquad(a, b) {
  const A = [...new Set(a.map(r => r.player_id).filter(Boolean))], B = [...new Set(b.map(r => r.player_id).filter(Boolean))];
  if (A.length < 2 || B.length < 2) return false;
  const ids = A.concat(B), grp = new Map();
  for (let i = 0; i < ids.length; i += 60) {
    (await api(`player_group_members?player_id=in.(${ids.slice(i, i + 60).join(',')})&select=player_id,group_id`))
      .forEach(r => grp.set(r.player_id, r.group_id));
  }
  const ga = new Set(A.map(id => grp.get(id) || id));
  const shared = new Set(B.map(id => grp.get(id) || id).filter(g => ga.has(g))).size;
  return shared >= 2 && shared >= Math.min(A.length, B.length) / 3;
}
async function recLinked(team) {
  if (!LINKED_T || !SEASON_LABEL) return;
  const found = await LINKED_T;
  const sides = ((found && found.linked && found.linked.teams) || []);
  const me = sides.find(t => t.id === team.id) || {};
  const others = sides.filter(t => t.id !== team.id && !!t.women === !!me.women && !!t.youth === !!me.youth &&
    (t.age || null) === (me.age || null) && (t.competitions || []).some(k => seasonText(k.season) === SEASON_LABEL));
  if (!others.length) return;
  const ownIds = REC.cards.filter(c => c.own).map(c => c.id);
  const mine = ownIds.length ? await api(`player_season_stats?team_id=eq.${team.id}&competition_id=in.(${ownIds.join(',')})&select=player_id`) : [];
  let added = false;
  for (const t of others) {
    try {
      const tg = (await api(`games?or=(home_team_id.eq.${t.id},away_team_id.eq.${t.id})&select=${REC_GAME_COLS}` +
        `,competitions(id,name,kind,seasons(name,leagues(name,slug,initials)))&order=tipoff_at.asc`))
        .filter(g => g.competitions && g.competitions.seasons && seasonText(g.competitions.seasons.name) === SEASON_LABEL);
      const tc = [...new Set(tg.map(g => g.competition_id))];
      if (!tc.length) continue;
      const theirs = await api(`player_season_stats?team_id=eq.${t.id}&competition_id=in.(${tc.join(',')})&select=player_id`);
      if (!(await sameSquad(mine, theirs))) continue;
      const st = await api(`standings?team_id=eq.${t.id}&competition_id=in.(${tc.join(',')})` +
        `&select=competition_id,gp,w,l,pts_for,pts_against,diff,league_points,rank,streak`);
      tc.forEach(id => {
        if (REC.cards.some(c => c.id === id)) return;
        const c = tg.find(g => g.competition_id === id).competitions;
        REC.cards.push({ id, own: false, teamId: t.id, name: c.name || '', kind: c.kind || 'league', linked: t,
                         league: (c.seasons && c.seasons.leagues) || { name: t.league, slug: t.league_slug },
                         row: st.find(r => r.competition_id === id) || null, games: tg.filter(g => g.competition_id === id) });
        added = true;
      });
    } catch (e) { console.warn('[record linked side]', t.id, e); }
  }
  if (!added) return;
  recLabel();
  drawRec();
}

/* ------------------------------------------------------------ team stats --- */
/* Two readings of the same season: the team's own line, and every player on it
   through the full table. The team line is shown as tiles because there is
   only one row of it — a one-row table is a worse way to read a single line. */
let teamScopeKind = 'all';
const KIND_LABEL = { league: 'League', cup: 'Cup', trophy: 'Trophy', playoff: 'Playoffs', friendly: 'Friendlies' };

/* THE POPUP (statpop.js) for a club statistic: every club in the scoped competitions, with names and crests read
   once from the league's teams (D.teamMeta) only when the popup wants them */
let TEAM_META = null;
function teamStatBind(node, k, label, S, mine, team, opts) {
  const SP = window.EpinoiaStatPop;
  if (!SP || !S || !S.teams || S.teams.length < 3 || !node) return;
  const o = opts || {};
  SP.bind(node, () => ({
    key: k, label, kind: 'team', subjectId: mine.id, rows: S.teams, value: o.value || k,
    signed: k === 'diffpg' || k === 'net', dp: k === 'ast_to' ? 2 : 1, y: k === 'pace' ? 'gp' : 'pace',
    meta: async ids => {
      const D = window.EpinoiaData, lid = (team.leagues || {}).id;
      if (!TEAM_META && D && D.teamMeta && lid) { try { TEAM_META = await D.teamMeta(lid); } catch (_) { TEAM_META = {}; } }
      const out = {};
      ids.forEach(i => { const m = (TEAM_META || {})[i]; if (m) out[i] = { name: m.name, teamShort: m.teamShort, colour: m.colour, logo: m.logo }; });
      return out;
    }
  }));
}

async function teamStats(team, kind) {
  const host = $('#teamstats'); host.textContent = '';
  try {   // the '?' in the section heading: what every statistic below means (statpop.js)
    const th = host.previousElementSibling;
    if (th && th.classList.contains('ep-hdr') && window.EpinoiaStatPop) window.EpinoiaStatPop.helpButton(th, 'team');
  } catch (_) { /* a convenience */ }
  if (ACCESS.paywall) return;          // the card stands in for this section
  const D = window.EpinoiaData;
  if (kind) teamScopeKind = kind;
  let S = null, scopeComps = [];
  try {
    /* WHICH COMPETITION. The club's finalised games name the competitions it plays
       in; the reader takes all of them or one kind (league, cup, trophy, playoffs). */
    const played = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
                               `&status=eq.final&select=competition_id` + inSeason());
    const ids = [...new Set(played.map(g => g.competition_id).filter(Boolean))];
    const comps = ids.length ? await D.all(`competitions?id=in.(${ids.join(',')})&select=id,name,kind`) : [];
    const kinds = [...new Set(comps.map(c => c.kind || 'league'))];
    if (kinds.length > 1) {
      const strip = el('div', 'ep-tabs compscope'); strip.setAttribute('role', 'tablist');
      [['all', 'All']].concat(kinds.map(k => [k, KIND_LABEL[k] || k])).forEach(([k, lab]) => {
        const b = document.createElement('button');
        b.className = 'ep-tab' + (k === teamScopeKind ? ' on' : ''); b.dataset.k = k; b.setAttribute('role', 'tab'); b.textContent = lab;
        b.onclick = () => teamStats(team, k);
        strip.appendChild(b);
      });
      host.appendChild(strip);
    }
    const scoped = comps.filter(c => teamScopeKind === 'all' || (c.kind || 'league') === teamScopeKind).map(c => c.id);
    scopeComps = scoped;
    if (scoped.length) S = await D.season(scoped, { rows: false, trim: true });
  } catch (e) {
    host.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return;
  }
  const mine = S && S.teams.find(t => t.id === team.id);
  rpGive('season', S ? { S, mine: mine || null, scopeComps, kind: teamScopeKind } : null);
  if (REPORT && REPORT.refresh) REPORT.refresh();
  try {   // the club's ELO and its schedule, beside the heading (p/sos-chip.js), over the same games as everything below
    let th = host.previousElementSibling;          // statpop's hint line sits between the heading and the section
    while (th && !th.classList.contains('ep-hdr')) th = th.previousElementSibling;
    if (th && window.EpinoiaSosChip && window.EpinoiaSosChip.paintClub)
      window.EpinoiaSosChip.paintClub(th, { games: mine ? S.games : null, teamId: team.id });
  } catch (_) { /* a convenience */ }
  if (!mine) {
    host.appendChild(el('div', 'empty',
      'No team statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }

  /* THE SECTIONS ARE CARDS (cards.js): four factors, the season line, shot zones and events each fold away, and the
     state is remembered in this browser. A shut card draws nothing, which is the point for the two that read every
     event of the competition (shot zones) or every situation (events): they are only built when opened.
     The players' table below is not one of them - it stays on the page. */
  const C = window.EpinoiaCards;
  const metaP = D.playerMeta(S.players.map(p => p.id)).catch(() => ({}));
  const cards = el('div', 'xcs');
  host.appendChild(cards);
  const card = (key, title, body, note) => {
    const c = C.collapsible({ key: 't_' + key, title, note, body });
    cards.appendChild(c);
    return c;
  };

  /* The four factors first and labelled as such: they are the four things that
     decide a basketball game, and both ends of each are shown because a
     defence is only describable relative to what it faced. */
  card('ff', 'four factors', () => {
    const grid = el('div', 'ffgrid');
    [['shooting', 'eFG%', mine.ff_efg, mine.dff_efg, false],
     ['turnovers', 'TOV%', mine.ff_tov, mine.dff_tov, true],
     ['rebounding', 'OREB%', mine.ff_oreb, mine.dff_oreb, false],
     ['free throws', 'FTr', mine.ff_ftr, mine.dff_ftr, false]]
      .forEach(([label, unit, off, def, lowGood]) => {
        const fk = { shooting: 'efg', turnovers: 'tov', rebounding: 'oreb', 'free throws': 'ftr' }[label];
        const fc = el('div', 'ffcard');
        fc.appendChild(el('div', 'ffl', label + ' · ' + unit));
        const pair = el('div', 'ffpair');
        const o = el('div', 'ffside');
        o.append(el('div', 'ffv', n1(off)), el('div', 'ffk', 'own'));
        const d = el('div', 'ffside');
        d.append(el('div', 'ffv', n1(def)), el('div', 'ffk', 'allowed'));
        /* Green marks an ADVANTAGE TO THIS TEAM, never simply the larger number.
           Opponents shooting a better eFG% than you is a weakness; colouring
           "allowed" green because 49.1 > 48.1 would read as a strength and say
           the opposite of what happened. So the edge is computed in the team's
           favour, and a deficit is marked as such rather than dressed up. */
        const edge = (off == null || def == null) ? null
          : (lowGood ? def - off : off - def);          // positive = this team ahead
        if (edge != null && Math.abs(edge) >= 0.05) {
          (edge > 0 ? o : d).classList.add(edge > 0 ? 'win' : 'lose');
        }
        if (fk) { teamStatBind(o, 'ff_' + fk, label + ' \u00b7 own', S, mine, team); teamStatBind(d, 'dff_' + fk, label + ' \u00b7 allowed', S, mine, team); }
        pair.append(o, d); fc.appendChild(pair);
        grid.appendChild(fc);
      });
    return grid;
  }, 'own · allowed');

  /* THE SEASON LINE (t/seasonline.js): the three ratings on a row of their own, then tempo, efficiency, how the ball
     and the minutes are shared, and the ratings against the other side's starters and its bench. The rows the season
     can rank are ranked among every club in the scope; the possession, heliocentrism and the two against-starters rows
     are the club's own play-by-play, read as the WOWY page reads it (members only, as that is); the bench's minutes
     need each game's starters and the players' minutes, read once per scope. */
  card('line', 'season line', () => {
    const box = el('div');
    const SL = window.EpinoiaSeasonLine;
    if (!SL) { box.appendChild(el('div', 'empty', 'The season line could not be drawn.')); return box; }
    const scoped = new Set((S.games || []).map(g => g.id));
    SL.render(box, {
      S, mine, LE: window.EpinoiaLineupEvents,
      bind: (node, d) => teamStatBind(node, d.k, d.l, S, mine, team),
      logs: ACCESS.locked ? Promise.resolve({ why: 'for members, with the play-by-play' }) : clubLogs(team, scoped),
      starters: ACCESS.locked ? null : scopeStarters(scopeComps),
      bench: benchMinutes(S, team),
      nameOf: id => metaP.then(m => (m && m[id] && m[id].name && m[id].name !== 'Player') ? m[id].name : null)
    });
    return box;
  }, mine.gp ? mine.gp + (mine.gp === 1 ? ' game' : ' games') : null);

  /* SHOT ZONES, RANKED IN THE LEAGUE. Every located shot of every side in the scoped
     competitions, cut into the chart's zones; this club's share, rate per 100 possessions,
     per-game attempts and makes and eFG% in each, each one a percentile among the teams. */
  card('zones', 'shot zones', () => {
    const zh = el('div');
    /* Without analytics the teaser stands in, and the zone read is never made: it fetches the
       event log of every game in the competition, and saving that is half the point. */
    if (ACCESS.locked) {
      const tz = el('div');
      tz.innerHTML = accessTeaser({ title: 'Shot zones, ranked in the league',
        lines: ['Share of shots, attempts per 100 possessions, makes and eFG% from every area of the floor, each a percentile among the league’s clubs.'] });
      zh.appendChild(tz);
    } else {
      /* after the card has attached the node: whenNear watches where it is on the page */
      Promise.resolve().then(() => whenNear(zh, () => zoneStats(zh, S, team)
        .catch(() => zh.appendChild(el('div', 'empty', 'The shot zones could not be computed.')))));
    }
    return zh;
  });

  /* EVENTS, AT BOTH ENDS. What the club made of second chances, breaks, turnovers,
     timeouts and half-court sets over the scoped season, and what opponents made of
     the same against it -- from the season rows' ev_ / evd_ keys, ranked among
     S.teams. Its own try, because anything thrown here would reach boot's catch and
     blank the roster and the results. */
  card('events', 'events', () => {
    const evHost = el('div');
    try {
      const clubLabel = team.name || team.short_name || '';
      if (ACCESS.locked) {
        evHost.innerHTML = accessTeaser({ title: 'Events, at both ends',
          lines: ['Second chances, transition, points off turnovers, after-timeout sets and the half court — what the club made of each, and what opponents made of the same.'] });
        { const M = window.EpinoiaMemLock, ph = M && M.placeholder({ what: 'Events', leagueSlug: ACCESS.slug }); if (ph) evHost.insertBefore(ph, evHost.firstChild); }
      } else if (window.EpinoiaSitPanel) {
        window.EpinoiaSitPanel.render({
          host: evHost, kind: 'team', row: mine, field: S.teams, name: clubLabel, side: 'off',
          note: teamScopeKind !== 'all' ? (KIND_LABEL[teamScopeKind] || teamScopeKind) : ''
        });
      }
    } catch (e) {
      console.warn('[events]', e);
      evHost.textContent = '';
      evHost.appendChild(el('div', 'empty', 'The event splits could not be drawn.'));
    }
    return evHost;
  });

  /* every player on the roster, ranked within their own team */
  const meta = await metaP;
  S.players.forEach(p => Object.assign(p, meta[p.id] || {}));
  const squad = S.players.filter(p => p.teamId === team.id);
  if (squad.length) {
    const sub = el('div');
    host.appendChild(sub);
    T.render({
      host: sub, kind: 'player', sortKey: 'ppg', showMinGames: false,
      filename: (team.slug || 'team') + '-players',
      /* the table drops the premium columns itself when the league's analytics are locked */
      leagueId: (team.leagues || {}).id, leagueSlug: ACCESS.slug,
      rows: squad,
      playerHref: r => '../p/?p=' + encodeURIComponent(r.id)
    });
  }
}

/* THE CLUB'S PLAY-BY-PLAY, read the way the WOWY page reads it (lineupevents.js): every logged game of the scope
   replayed into the stretches in which neither five changed, as records from the club's side, each told which club
   the other side was (for its regular starters). The season line sums them (seasonline.js logSummary): the possession,
   heliocentrism, and the ratings against the other side's starters and its bench, split as the reader chooses. A game
   at a time, so the page stays responsive; each game's segments kept for the page's life, so a scope read again is
   only summed again. */
const segCache = new Map();
async function clubLogs(team, scoped) {
  const LE = window.EpinoiaLineupEvents;
  if (!LE) return { why: 'not available on this page' };
  const { gs, byG, sideOf } = await seasonLogs(team);
  const games = gs.filter(g => scoped.has(g.id));
  if (!games.length) return { why: 'no game log in this scope yet' };
  const recs = [];
  let n = 0;
  for (const g of games) {
    let G = segCache.get(g.id);
    if (!G) {
      try { G = LE.gameSegments({ id: g.id, starters: g.starters, events: byG[g.id] || [], period: g.period }); } catch (_) { G = { ok: false }; }
      segCache.set(g.id, G);
      await new Promise(r => setTimeout(r, 0));
    }
    if (!G.ok) continue;
    n++;
    const side = sideOf[g.id], oteam = side === 0 ? g.away_team_id : g.home_team_id;   // (a record's `opp` is that side's box)
    LE.recordsOf(G, side).forEach(r => { r.oteam = oteam; recs.push(r); });
  }
  return recs.length ? { recs, games: n } : { why: 'no game with its starters on record yet' };
}

/* EVERY GAME'S STARTERS IN THE SCOPE, for who counts as each club's regular starter (index_9: N games started or
   more). One small read per scope's competitions (D.all pages it), kept for the page's life. */
const startersCache = new Map();
function scopeStarters(compIds) {
  const D = window.EpinoiaData;
  const ids = (compIds || []).slice().sort();
  if (!ids.length || !D) return null;
  const key = ids.join(',');
  if (startersCache.has(key)) return startersCache.get(key);
  const p = D.all(`games?competition_id=in.(${key})&status=eq.final&select=id,home_team_id,away_team_id,starters`);
  p.catch(() => startersCache.delete(key));
  startersCache.set(key, p);
  return p;
}

/* THE BENCH'S MINUTES for every club in the scope: each game's starters and every player's minutes (two small reads a
   batch of forty games). A competition past 400 games reads the club's own games only, and is not ranked. Kept for the
   page's life, so a scope read twice is read once. */
const benchCache = new Map();
function benchMinutes(S, team) {
  const SL = window.EpinoiaSeasonLine, D = window.EpinoiaData;
  const all = (S && S.games) || [];
  const games = all.length > 400 ? all.filter(g => g.home_team_id === team.id || g.away_team_id === team.id) : all;
  const ids = games.map(g => g.id).sort();
  if (!ids.length || !SL || !D) return null;
  const key = ids.join(',');
  if (benchCache.has(key)) return benchCache.get(key);
  const p = (async () => {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
    const parts = await Promise.all(chunks.map(c => Promise.all([
      D.all(`games?id=in.(${c.join(',')})&select=id,home_team_id,away_team_id,starters`),
      D.all(`player_game_stats?game_id=in.(${c.join(',')})&select=game_id,player_uuid,player_id,team_idx,min:stats->min`)
    ])));
    const lines = parts.flatMap(x => x[1]).map(r => ({ game_id: r.game_id, pid: r.player_uuid || r.player_id, team_idx: r.team_idx, min: r.min }));
    return SL.bench(parts.flatMap(x => x[0]), lines);
  })();
  p.catch(() => benchCache.delete(key));
  benchCache.set(key, p);
  return p;
}

/* ------------------------------------------------------------- shot zones --- */
/* THE CLUB'S RANK among the clubs of the scope, as a small chip (kit/clubstats.css): toned from red to green where more
   is better (dir 1), plain where a number is a style (dir 0: how often a club shoots from somewhere is neither good nor
   bad). Nothing under two ranked clubs, or when `few` says the sample is too thin to rank. */
function rankChip(S, mine, k, dir, few) {
  const SL = window.EpinoiaSeasonLine;
  const P = SL && !few ? SL.place(S.teams, r => r[k], mine.id, dir) : null;
  if (!P || P.n < 2) return '';
  const b = dir ? SL.band(P.pct) : 0;
  return '<span class="czt-rk' + (dir ? '' : ' style') + '"' + (b ? ' data-b="' + b + '"' : '') + ' title="' + SL.ordinal(P.rank) +
    ' of ' + P.n + '">' + SL.ordinal(P.rank) + '</span>';
}

/* SHOT ZONES, RANKED IN THE LEAGUE. Every located shot of every side in the scoped competitions, cut into the chart's
   zones: this club's share of its shots in each (a bar), its attempts per 100 possessions and per game, its makes and
   its eFG%, each with its rank among the clubs. The larger cuts (sides, the paint, jump shots, every shot) below. */
async function zoneStats(host, S, team) {
  const SC = window.EpinoiaShotChart, SE = window.EpinoiaSeason, D = window.EpinoiaData;
  if (!SC || !SE || !S || !S.games || !S.games.length) { host.appendChild(el('div', 'empty', 'No located shots yet.')); return; }
  const holding = el('div', 'empty', 'reading every shot in the competition\u2026'); host.appendChild(holding);
  const zr = await SC.attachZoneStats(S, D);
  holding.remove();
  const mine = S.teams.find(tm => tm.id === team.id);
  if (!mine || !zr[team.id]) { host.appendChild(el('div', 'empty', 'No located shots for this club yet.')); return; }
  /* the rebounds off each zone's misses need no locations (they are the box score's zones), so they are drawn
     whether or not there are located shots to chart */
  if (!mine.z_located) { host.appendChild(el('div', 'empty', 'No located shots for this club yet.')); reboundZones(host, S, mine); return; }
  const f1 = v => v == null ? '\u2014' : (+v).toFixed(1);
  const SW = { paint: 'rim', mid: 'mid', three: 'three' };
  const lb = t => '<span class="czt-lb" data-i18n-ctx="col">' + t + '</span>';   // a column's name, for a row drawn as a card
  const row = (g, max) => {
    const k = m => 'z_' + g.k + '_' + m, none = !mine[k('att')];
    const share = mine[k('share')];
    const w = share == null || !(max > 0) ? 0 : Math.max(2, 100 * share / max);
    const cell = (m, label, dir) => '<td>' + lb(label) + '<span class="czt-v">' + f1(mine[k(m)]) + '</span>' + (none ? '' : rankChip(S, mine, k(m), dir)) + '</td>';
    return '<tr class="r' + (none ? ' none' : '') + '"><th class="l" scope="row">' + (g.kind ? '<i class="czt-sw z-' + SW[g.kind] + '"></i>' : '') + g.label + '</th>' +
      '<td class="czt-share">' + lb('% of shots') + '<span class="czt-v">' + (share == null ? '\u2014' : f1(share) + '%') + '</span>' +
        (none ? '' : rankChip(S, mine, k('share'), 0)) + '<span class="czt-bar"><i style="width:' + w.toFixed(1) + '%"></i></span></td>' +
      cell('att100', 'att / 100 poss', 0) + cell('attG', 'att / g', 0) + cell('madeG', 'made / g', 1) + cell('efg', 'efg%', 1) + '</tr>';
  };
  const block = (title, groups) => {
    const max = Math.max(0, ...groups.filter(g => g.k !== 'all').map(g => +mine['z_' + g.k + '_share'] || 0));
    return '<tbody><tr class="czt-gh"><th colspan="6">' + title + '</th></tr>' + groups.map(g => row(g, max)).join('') + '</tbody>';
  };
  const wrap = el('div', 'czt-wrap');
  wrap.setAttribute('data-i18n-ctx', 'zonetable');
  wrap.innerHTML = '<table class="czt">' +
    '<thead><tr><th class="l">zone</th><th>% of shots</th><th>att / 100 poss</th><th>att / g</th><th>made / g</th><th>efg%</th></tr></thead>' +
    block('every zone', SC.GROUPS) + block('the larger cuts', SC.BIG) + '</table>' +
    '<div class="czt-note">every located shot in the competition' + (teamScopeKind !== 'all' ? ' (' + (KIND_LABEL[teamScopeKind] || teamScopeKind).toLowerCase() + ')' : '') +
    ' \u00b7 the chip is the club\u2019s rank among the ' + S.teams.length + ' clubs: green to red where more is better, plain where it is only a style' +
    ' \u00b7 att / 100 = attempts per 100 of the club\u2019s own possessions \u00b7 the same numbers for every club are under \u201cshot zones\u201d in the league table\u2019s team statistics</div>';
  host.appendChild(wrap);
  reboundZones(host, S, mine);
}

/* WHAT BECAME OF EVERY SHOT ATTEMPT, by zone, for the club's own attempts and for the attempts taken against it
   (Louie, 2026-09-25). Rim, mid-range and three by the box score's own zone rule, over every game in the scope: every
   attempt went in, or was missed and rebounded by the shooter's side (offensive) or by the other side (defensive), or
   had no rebound -- the four add up to the attempts, drawn as one bar per zone. The rebounds are the first one after
   each miss, before anything else happens to the ball (epinoia/situations.js reboundZones); a miss with none is a foul
   and free throws, a turnover, the end of a period or a rebound the feed did not log.
   Beside the bar, the club's ORB% (its own misses) and DRB% (the opponents'), as the four factors count them: of the
   misses somebody rebounded, the share it took (rb_<zone>_orb / _drb, the team table's defence + rebounding columns),
   ranked among the clubs once there are ten rebounded misses to go on. */
function reboundZones(host, S, mine) {
  if (!mine || !mine.rb_ready) return;
  const ZS = [['rim', 'at the rim', 'rim'], ['mid', 'mid-range', 'mid'], ['three', 'threes', 'three'], ['all', 'every shot', '']];
  const FEW = 10;                                            // a rate on fewer rebounded misses than this is not ranked
  const lb = t => '<span class="czt-lb" data-i18n-ctx="col">' + t + '</span>';
  const pc = v => v == null ? '\u2014' : (+v).toFixed(1) + '%';
  const part = (n, a, cls, label) => {
    const w = a ? 100 * n / a : 0;
    return w > 0 ? '<i class="' + cls + '" style="width:' + w.toFixed(2) + '%" title="' + label + ' ' + w.toFixed(1) + '%"></i>' : '';
  };
  /* own: the club's attempts (made, its own offensive rebound, the other side's defensive rebound, none); against:
     the attempts taken against it (made, the other side's offensive rebound, its own defensive rebound, none) */
  const tr = ([z, label, sw], end) => {
    const own = end === 'own', g = f => +mine['rb_' + z + '_' + (own ? '' : 'g') + f] || 0;
    const a = g('a'), made = g('m'), o = g('o'), d = g('d'), none = Math.max(0, a - made - o - d);
    const m = own ? 'orb' : 'drb', rk = 'rb_' + z + '_' + m;       // its own share of the rebounded misses, ranked
    const reb = o + d;
    return '<tr class="r' + (a ? '' : ' none') + (z === 'all' ? ' tot' : '') + '"><th class="l" scope="row">' + (sw ? '<i class="czt-sw z-' + sw + '"></i>' : '') + label + '</th>' +
      '<td>' + lb('attempts') + '<span class="czt-v">' + a + '</span></td>' +
      '<td class="cob-c">' + lb('what became of them') + '<span class="cob-bar ' + end + '">' +
        part(made, a, 'm', 'made') + part(o, a, own ? 'ko' : 'lo', own ? 'own offensive rebound' : 'other side\u2019s offensive rebound') +
        part(d, a, own ? 'ld' : 'kd', own ? 'other side\u2019s defensive rebound' : 'own defensive rebound') + part(none, a, 'n', 'no rebound') + '</span></td>' +
      '<td>' + lb('fg%') + '<span class="czt-v">' + (a ? pc(100 * made / a) : '\u2014') + '</span></td>' +
      '<td>' + lb(own ? 'orb%' : 'drb%') + '<span class="czt-v">' + pc(mine[rk]) + '</span>' + rankChip(S, mine, rk, 1, reb < FEW) + '</td></tr>';
  };
  const key = own => '<span class="cob-key">' +
    '<span><i class="m"></i>made</span>' +
    '<span><i class="' + (own ? 'ko' : 'lo') + '"></i>' + (own ? 'own offensive rebound' : 'other side\u2019s offensive rebound') + '</span>' +
    '<span><i class="' + (own ? 'ld' : 'kd') + '"></i>' + (own ? 'other side\u2019s defensive rebound' : 'own defensive rebound') + '</span>' +
    '<span><i class="n"></i>no rebound</span></span>';
  const block = (end, title, rate) => '<tbody class="cob-g ' + end + '"><tr class="czt-gh"><th colspan="5">' + title + key(end === 'own') + '</th></tr>' +
    '<tr class="czt-sh"><th class="l">zone</th><th>attempts</th><th class="cob-c">what became of them</th><th>fg%</th><th>' + rate + '</th></tr>' +
    ZS.map(zz => tr(zz, end)).join('') + '</tbody>';
  const wrap = el('div', 'czt-wrap cob');
  wrap.setAttribute('data-i18n-ctx', 'zonetable');
  wrap.innerHTML = '<div class="czt-h">what became of every shot attempt</div>' +
    '<table class="czt cob-t">' + block('own', 'the club\u2019s own attempts', 'orb%') + block('against', 'attempts against the club', 'drb%') + '</table>' +
    '<div class="czt-note">every shot attempt in a zone went in, or was missed and rebounded by the shooter\u2019s side (offensive) or the other side (defensive), or had no rebound \u00b7 ' +
    'the four add up to the attempts \u00b7 the first rebound after each miss counts, team rebounds too; a miss followed by a foul and free throws, a turnover or the end of a period has none \u00b7 ' +
    'orb% and drb% are of the misses somebody rebounded, as the four factors count them \u00b7 the chip is the club\u2019s rank among the clubs, on ten rebounded misses or more</div>';
  host.appendChild(wrap);
}

/* ------------------------------------------------------- lineups & WOWY --- */
/* THE THREE LINEUP SECTIONS ARE THE WOWY PAGE'S OWN (t/teamwowy.js over stats/wowy/wowyui.js): With or without is
   its combinations, the Lineup filter its builder, Every lineup its Lineups list (a table that sorts by any column,
   coloured against the league's units, with the on/off delta of every stat). They read the same games and stints,
   fetched once here, and the play-by-play the page has already read for the shot chart and the season line. */
async function lineupPanels(team) {
  const D = window.EpinoiaData, TW = window.EpinoiaTeamWowy;
  if (ACCESS.paywall) return;          // stints are behind the wall; the sections are hidden
  const hosts = { wowy: $('#wowy'), build: $('#lufilter'), lineups: $('#lulist') };
  const say = msg => Object.values(hosts).forEach(h => {
    if (h && !h.children.length) h.appendChild(el('div', 'empty', msg));
  });
  try {
    if (!TW) throw new Error('the lineups script did not load');
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=${TW.GAME_SELECT}` + inSeason());
    if (!gs.length) return say('No finalised games yet — lineups appear once one is played.');
    const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
    const st = await D.stints(gs.map(g => g.id), team.id, byGame);
    if (!st.length) return say('No lineup data yet.');

    const ids = [...new Set(st.flatMap(r => r.player_ids))];
    const meta = await D.playerMeta(ids);
    $('#wowyNote').textContent = st.length + ' stints · ' + ids.length + ' players';
    const lg = team.leagues || {};
    const A = window.EpinoiaAccess;
    TW.mount({
      team, league: { id: lg.id, slug: lg.slug || ACCESS.slug, name: lg.name },
      games: gs, stints: st, meta, hosts,
      /* without analytics: every five and the filter as ever, the members' parts locked (teamwowy.js gates) */
      locked: ACCESS.locked,
      previewMax: (A && A.CATALOGUE && A.CATALOGUE.wowyPreviewMax) || 1,
      compIds: SEASON_COMPS, season: SEASON_NAME, base: '../',
      readLogs: () => seasonLogs(team), segCache
    });
  } catch (e) {
    /* A silent catch left three empty sections with no explanation — which is
       exactly what a reader saw when the scripts failed to load. Say what
       happened, in the sections themselves. */
    console.warn('[lineups]', e);
    say('Could not load lineup data: ' + (e.message || e));
  }
}

/* the home venue panel lives in its own module — it is a self-contained
   piece of page with its own illustration and its own privacy rule */
async function venue(team) {
  /* THE ARENAS THE CLUB'S HOME GAMES WERE PLAYED AT (0162's games.venue_id): the main one large
     and the others smaller, with their counts (homearenas.js holds the rule). Where nobody has
     typed a venue in, the main arena's own name and address stand in for it. A read that fails
     leaves the panel exactly as it was. */
  team.home_arenas = null;
  try {
    const H = window.EpinoiaHomeArenas;
    if (H) {
      const rows = await api('games?home_team_id=eq.' + team.id + '&venue_id=not.is.null&select=venue_id&limit=1000');
      const s = H.split((rows || []).map(r => r.venue_id), team.home_venue_id);
      const ids = [s.primary, ...s.others.map(o => o.id)].filter(Boolean);
      if (ids.length) {
        const vs = await api('venues?id=in.(' + ids.join(',') + ')&select=id,name,city,address,lat,lng,place_id');
        const by = {}; (vs || []).forEach(v => { by[v.id] = v; });
        const main = by[s.primary] ? { ...by[s.primary], n: s.primaryN } : null;
        const others = s.others.filter(o => by[o.id]).map(o => ({ ...by[o.id], n: o.n }));
        team.home_arenas = { main, others, total: s.total };
        if (main && !team.home_venue) {
          team.home_venue_auto = main.name;
          team.home_venue_auto_n = main.n;
          if (!team.home_venue_address && main.address) team.home_venue_address = main.address;
        }
      }
    }
  } catch (_) { /* the panel is shown without the other arenas */ }

  /* THE HOME VENUE, READ OFF THE FIXTURES when nobody has typed one in. Every
     home fixture the feed (or a league admin) files carries a venue, and the
     one that appears most is the club's hall. A recorded venue still wins —
     this only fills the gap, and a league administrator or the club can
     overwrite it from their own settings. */
  if (!team.home_venue && !team.home_venue_address && !team.home_venue_auto) {
    try {
      const rows = await api('games?home_team_id=eq.' + team.id + '&venue=not.is.null&select=venue&order=tipoff_at.desc&limit=60');
      const count = new Map();
      (rows || []).forEach(g => { const v = String(g.venue || '').trim(); if (v) count.set(v, (count.get(v) || 0) + 1); });
      let best = null, n = 0;
      count.forEach((c, v) => { if (c > n) { best = v; n = c; } });
      if (best) { team.home_venue_auto = best; team.home_venue_auto_n = n; }
    } catch (_) { /* no fixtures, no guess */ }
  }
  const out = await window.EpinoiaVenue.render({
    host: '#venue', team, api, cfg: CFG
  });
  SUGGEST.venue = (out && out.suggest) || [];
  const note = $('#venueNote');
  if (note) note.textContent = (out && out.photo) ? '' : 'no photograph yet';
}

/* ------------------------------------------------------------------ roster ---
   The squad, with the measurements a scout actually asks for.

   EDITABLE IN PLACE for whoever manages the club. A separate edit screen for
   four numbers is a screen nobody opens, so the cells become inputs when the
   viewer has the right and stay plain text when they do not. Nothing here
   decides who may edit — it asks the database, and a save that should not
   happen is refused by RLS whatever this page believes.

   Height and wingspan are entered and shown in centimetres because that is
   what a tape measure in a British sports hall reads, with feet and inches
   alongside since that is how people talk about it. */
const MEASURES = [
  { k: 'height_cm',     l: 'HT',   w: 74, unit: 'cm', imperial: true,  min: 100, max: 260 },
  { k: 'weight_kg',     l: 'WT',   w: 66, unit: 'kg', imperial: false, min: 30,  max: 250 },
  { k: 'wingspan_cm',   l: 'WING', w: 74, unit: 'cm', imperial: true,  min: 120, max: 280 },
  { k: 'previous_club', l: 'PREVIOUS CLUB', w: 160, text: true }
];

const feetInches = cm => {
  if (!cm) return '';
  const total = Math.round(cm / 2.54);
  return Math.floor(total / 12) + "'" + String(total % 12) + '"';
};

/* ONE SET OF UNITS, THE READER'S (units.js): centimetres and kilograms, or feet, inches and pounds -
   the same choice the profile and the stats tables follow. The database, and the boxes a manager
   types into, stay in centimetres and kilograms. Without units.js, the old metric-with-imperial. */
const UNITS = () => window.EpinoiaUnits || null;
function measText(m, val) {
  const U = UNITS();
  if (m.text) return [String(val), ''];
  if (!U) return [val + m.unit, m.imperial ? feetInches(val) : ''];
  const s = m.unit === 'kg' ? U.weight(val) : U.height(val);
  return [s.replace(/ (cm|kg|lb)$/, '$1'), ''];
}
function fillMeas(td, m, val) {
  td.textContent = '';
  if (val == null || val === '') { td.appendChild(el('span', 'meas-none', '–')); return; }
  const [main, alt] = measText(m, val);
  const s = el('span', null, main); s.setAttribute('translate', 'no'); td.appendChild(s);
  if (alt) td.appendChild(el('span', 'meas-alt', alt));
}
const measTitle = m => {
  const U = UNITS();
  if (m.text || !U) return '';
  return (m.k === 'height_cm' ? 'height' : m.k === 'weight_kg' ? 'weight' : 'wingspan') + ', ' +
    (m.unit === 'kg' ? U.weightUnit() : U.heightUnit());
};

/* THE SQUAD'S AVERAGES, under the roster: average age, height and weight, each over the players who have that number, with how many
   that was when it is not everyone (a squad half of whom have no listed weight has an average of the other half, and says so).
   One cell per column the roster is showing (plan, from roster()), so the row lines up whichever columns a club's data leaves.
   A roster that shows BORN (birth years, no exact ages) has the average year there. */
function squadAverages(players, ages, plan) {
  const S = window.EpinoiaAges ? window.EpinoiaAges.summary(players, ages) : null;
  const tf = el('tfoot'), tr = el('tr');
  const cell = (cls, text, note) => { const td = el('td', cls, text); if (note) td.appendChild(el('span', 'meas-alt', note)); return td; };
  const none = () => el('td', 'meas meas-none', '–');
  tr.appendChild(el('td', 'stick c0', ''));
  tr.appendChild(el('td', 'stick c1 avg-l', 'squad average'));
  tr.appendChild(el('td', ''));
  const of = (n) => (S && n < S.players ? n + ' of ' + S.players : '');
  if (plan.age) tr.appendChild(S && S.age != null ? cell('meas', S.age.toFixed(1), of(S.ageN)) : none());
  if (plan.born) {
    const ys = players.map(p => p.birth_year).filter(v => Number.isFinite(v) && v > 0);
    tr.appendChild(ys.length ? cell('meas', String(Math.round(ys.reduce((a, b) => a + b, 0) / ys.length)), of(ys.length)) : none());
  }
  plan.measures.forEach(m => {
    if (m.k === 'height_cm') {
      const [htMain, htAlt] = S && S.height != null ? measText(m, Math.round(S.height)) : ['', ''];
      tr.appendChild(S && S.height != null ? cell('meas', htMain, [htAlt, of(S.heightN)].filter(Boolean).join(' · ')) : none());
    } else if (m.k === 'weight_kg') {
      const [wtMain] = S && S.weight != null ? measText(m, Math.round(S.weight)) : [''];
      tr.appendChild(S && S.weight != null ? cell('meas', wtMain, of(S.weightN)) : none());
    } else tr.appendChild(el('td', ''));
  });
  tf.appendChild(tr);
  return tf;
}

/* ------------------------------------------------------------ suggestions ---
   A FAN MAY SUGGEST A CORRECTION to what only the club, the league or the platform may change (suggest.js,
   0199): the crest, the coaching staff (a name, a role, someone who has left, someone missing) and the arena
   (venue.js hands back its name, address, city and place on the map). Hovering one offers it; the button
   beside the follow bell reaches all of them. The club's own managers edit the staff in place instead. */
const SUGGEST = { team: null, staff: [], venue: [] };
const crestChoice = () => ({ type: 'team', id: SUGGEST.team.id, field: 'photo', subject: SUGGEST.team.name, label: 'crest' });
const addStaffChoice = () => ({ type: 'team', id: SUGGEST.team.id, field: 'staff_add', subject: SUGGEST.team.name });
const staffChoices = s => ['staff_name', 'staff_role', 'staff_remove'].map(f => ({
  type: 'staff', id: s.id, field: f, subject: s.name, current: f === 'staff_name' ? s.name : f === 'staff_role' ? s.role : null }));
const suggestList = () => (SUGGEST.team
  ? [crestChoice(), addStaffChoice()].concat(...SUGGEST.staff.map(staffChoices), SUGGEST.venue || []) : []);

/* ------------------------------------------------------------------ staff ---
   The bench, above the squad — head coach first, then whatever order a
   programme would print.

   AGE, NOT DATE OF BIRTH. `team_staff_public` computes it from a year of
   birth, which is all that is stored: the same rule `players` follows, and an
   age derived from a year cannot go stale the way a typed-in age does. The
   cost is that it is right to within a year, which is what a staff list means
   anyway.

   Ordering comes from the database's `sort`, seeded from the role, so a club
   that adds a physio before an assistant coach still gets a list that reads
   correctly without anybody having to reorder it. */
const ROLE_SUGGESTIONS = [
  'Head Coach', 'Assistant Coach', 'Associate Head Coach', 'Player Development',
  'General Manager', 'Team Manager', 'Strength and Conditioning', 'Physiotherapist',
  'Doctor', 'Video Analyst', 'Analyst', 'Scout', 'Equipment Manager', 'Statistician'
];

/* The same ordering the database seeds a new row with (staff_rank in 0036),
   repeated here so an EDITED role re-sorts too. Two copies of a rule is one
   too many, but the alternative is a round trip on every keystroke; if this
   list grows it should become an RPC. */
const ROLE_RANK = {
  'head coach': 10, 'manager': 10, 'associate head coach': 15,
  'assistant coach': 20, 'player development': 25, 'general manager': 30,
  'team manager': 35, 'strength and conditioning': 40, 's&c': 40,
  'physiotherapist': 50, 'physio': 50, 'doctor': 55,
  'analyst': 60, 'video analyst': 60, 'scout': 65,
  'equipment manager': 70, 'statistician': 75
};
const roleRank = r => ROLE_RANK[String(r || '').trim().toLowerCase()] ?? 100;

async function staff(team, canEdit, sb) {
  const host = $('#roster');

  /* A manager needs the year of birth to edit it; everyone else gets the view,
     which carries an age and nothing else. Two reads because they are two
     different things, not one read with a flag. */
  let rows = [];
  try {
    rows = canEdit
      ? (await sb.from('team_staff').select('id,name,role,born_year,sort,active')
           .eq('team_id', team.id).eq('active', true).order('sort').order('role')).data || []
      : await api(`team_staff_public?team_id=eq.${team.id}&select=id,name,role,age,sort` +
                  `&order=sort,role`);
  } catch (_) { rows = []; }

  const S = window.EpinoiaSuggest && SUGGEST.team ? window.EpinoiaSuggest : null;
  SUGGEST.staff = canEdit ? [] : rows.filter(s => s.id && s.name);
  if (!rows.length && !canEdit) {
    /* no staff on file: nothing to list, but a fan may know who coaches the club */
    if (!S) return;
    const head = el('div', 'staffhead');
    head.appendChild(el('div', 'sh', 'Coaching & support staff'));
    host.appendChild(head);
    const ask = el('div', 'sg-ask');
    ask.setAttribute('data-i18n-ctx', 'suggest');
    ask.appendChild(el('span', null, 'No staff listed yet. Know who coaches this club?'));
    ask.appendChild(S.button([addStaffChoice()], { label: 'suggest a coach', cls: 'mini', title: team.name }));
    host.appendChild(ask);
    return;
  }

  const head = el('div', 'staffhead');
  head.appendChild(el('div', 'sh', 'Coaching & support staff'));
  if (rows.length) head.appendChild(el('div', 'sn', rows.length + ' listed'));
  host.appendChild(head);

  const grid = el('div', 'staffgrid');
  host.appendChild(grid);

  const thisYear = new Date().getFullYear();

  const readOnlyCard = (s) => {
    const c = el('div', 'staffcard');
    c.appendChild(el('div', 'staffrole', s.role || 'Staff'));
    c.appendChild(el('div', 'staffname', s.name || '—'));
    if (s.age != null) {
      const a = el('div', 'staffage', String(s.age));
      a.appendChild(el('span', null, 'years'));
      c.appendChild(a);
    }
    if (S && s.id && s.name) S.attach(c, staffChoices(s), { at: 'top' });
    return c;
  };

  const editCard = (s) => {
    const c = el('div', 'staffcard edit');

    const mk = (cls, value, ph, onSave, attrs) => {
      const i = el('input', cls);
      i.value = value == null ? '' : String(value);
      i.placeholder = ph;
      /* `list` is a READ-ONLY property on HTMLInputElement — it returns the
         datalist element, it does not set one. Object.assign onto it throws
         in strict mode, which took the whole roster down and, through the
         boot catch, printed "cannot set property list" where the fixtures
         should have been. Anything that is only ever an attribute goes
         through setAttribute; the rest can be assigned. */
      Object.entries(attrs || {}).forEach(([k, v]) => {
        if (k === 'list' || k === 'min' || k === 'max') i.setAttribute(k, v);
        else i[k] = v;
      });
      let last = i.value;
      const save = async () => {
        if (i.value === last) return;
        const out = onSave(i.value.trim());
        if (out === false) { i.classList.add('bad'); return; }
        i.classList.remove('bad');
        const patch = out;
        /* A row that has never been saved has no id yet — the first edit
           creates it, so a half-typed card is never left in the database. */
        if (s.id) {
          const { error } = await sb.from('team_staff').update(patch).eq('id', s.id);
          if (error) { i.classList.add('bad'); i.title = error.message; i.value = last; return; }
        } else {
          const seed = { team_id: team.id, name: s.name || 'New name',
                         role: s.role || 'Staff', ...patch };
          seed.sort = roleRank(seed.role);
          const { data, error } = await sb.from('team_staff')
            .insert(seed).select('id').single();
          if (error) { i.classList.add('bad'); i.title = error.message; i.value = last; return; }
          s.id = data.id;
        }
        Object.assign(s, patch);
        last = i.value;
      };
      i.addEventListener('blur', save);
      i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
      return i;
    };

    /* Changing the role also moves the card, because "Head Coach" belongs at
       the top wherever it was typed. The new position takes effect on the next
       load rather than jumping the card out from under the cursor. */
    c.appendChild(mk('role', s.role, 'ROLE', v =>
      v ? { role: v, sort: roleRank(v) } : false, { maxLength: 60, list: 'staffroles' }));

    c.appendChild(mk('nm', s.name, 'Full name', v =>
      v ? { name: v } : false, { maxLength: 90 }));

    const row = el('div', 'srow');
    row.appendChild(mk('yr', s.born_year, 'Born', v => {
      if (v === '') return { born_year: null };
      const y = parseInt(v, 10);
      if (!isFinite(y) || y < 1900 || y > thisYear) return false;
      return { born_year: y };
    }, { type: 'number', min: '1900', max: String(thisYear) }));

    const del = el('button', 'staffdel', 'remove');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!s.id) { c.remove(); return; }
      del.disabled = true;
      /* Deactivated, not deleted. A club that removes the wrong person can be
         put back, and a hard delete of a named individual is not something to
         hang on a single mis-click. */
      const { error } = await sb.from('team_staff').update({ active: false }).eq('id', s.id);
      del.disabled = false;
      if (error) { del.title = error.message; del.classList.add('bad'); return; }
      c.remove();
    });
    row.appendChild(del);
    c.appendChild(row);
    return c;
  };

  rows.forEach(s => grid.appendChild(canEdit ? editCard(s) : readOnlyCard(s)));
  if (!canEdit && S) {
    const add = el('div', 'staffcard add');
    add.appendChild(S.button([addStaffChoice()], { label: 'suggest someone', title: team.name }));
    grid.appendChild(add);
  }

  if (canEdit) {
    /* the role suggestions, shared by every card */
    if (!document.getElementById('staffroles')) {
      const dl = el('datalist'); dl.id = 'staffroles';
      ROLE_SUGGESTIONS.forEach(r => { const o = el('option'); o.value = r; dl.appendChild(o); });
      document.body.appendChild(dl);
    }
    const add = el('div', 'staffcard add');
    const btn = el('button', null, '+ add somebody');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const blank = { id: null, name: '', role: '', born_year: null };
      grid.insertBefore(editCard(blank), add);
    });
    add.appendChild(btn);
    grid.appendChild(add);

    if (!rows.length) {
      host.appendChild(el('div', 'empty',
        'No staff listed yet. Add the head coach and anyone else who should be ' +
        'on the club\'s page — the list orders itself by role.'));
    }
  }
}

async function roster(team) {
  const rows = squadOf(await api(`roster_entries?team_id=eq.${team.id}&active=eq.true` +
    `&select=jersey,position,${SQUAD_COLS},players(id,first_name,last_name,slug,is_minor,` +
    `birth_year,height_cm,weight_kg,wingspan_cm,previous_club)&order=jersey`));
  const host = $('#roster'); host.textContent = '';
  /* Ages, from the database's age function (0184): the date of birth itself is never sent to a browser. A server without it gives none. */
  const AGES = window.EpinoiaAges
    ? await window.EpinoiaAges.load(CFG, rows.map(r => r.players && r.players.id)).catch(() => ({})) : {};

  /* May this viewer edit? The database is asked, not assumed — and a viewer
     who is not signed in never even makes the request. */
  let canEdit = false;
  const sb = window.epinoiaClient && window.epinoiaClient();
  if (sb) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data } = await sb.rpc('is_team_manager', { p_team: team.id });
        canEdit = !!data;
      }
    } catch (_) { canEdit = false; }
  }

  /* Staff first — a squad list starts with who picks it. */
  await staff(team, canEdit, sb);

  if (!rows.length) { host.appendChild(el('div', 'empty', 'No players listed yet.')); return; }

  /* Suggestions for the position box. A datalist rather than a select, because
     a league that plays "Combo" or "Point Forward" must be able to write it. */
  if (!document.getElementById('posOptions')) {
    const dl = el('datalist'); dl.id = 'posOptions';
    ['Guard', 'Point Guard', 'Shooting Guard', 'Wing', 'Forward',
     'Small Forward', 'Power Forward', 'Centre', 'Guard/Forward', 'Forward/Centre']
      .forEach(v => { const o = el('option'); o.value = v; dl.appendChild(o); });
    document.body.appendChild(dl);
  }

  /* ONLY THE COLUMNS THIS CLUB'S DATA CAN FILL, each decided on its own (ages.js bioColumns): AGE where the database gives exact
     ages, else BORN with the year where only birth years are known, and HT, WT, WING and PREVIOUS CLUB where anyone has one.
     A manager sees every measurement column regardless - they are the boxes the numbers are typed into. */
  const squadP = rows.map(r => r.players).filter(Boolean);
  const cols = window.EpinoiaAges && window.EpinoiaAges.bioColumns
    ? window.EpinoiaAges.bioColumns(squadP.map(p => ({ a: AGES[p.id], y: p.birth_year, h: p.height_cm, w: p.weight_kg })))
    : { age: true, born: false, ht: true, wt: true };
  const known = k => squadP.some(p => p[k] != null && p[k] !== '' && p[k] !== 0);
  const plan = {
    age: cols.age, born: cols.born,
    measures: MEASURES.filter(m => canEdit || (m.k === 'height_cm' ? cols.ht : m.k === 'weight_kg' ? cols.wt : known(m.k)))
  };
  const yearNow = new Date().getFullYear();

  const wrap = el('div', 'ft-wrap roster-wrap');
  /* no position anywhere in the squad and nobody here to type one: the column is left out (CSS, so
     every row and the average keep the same cells) */
  const t = el('table', 'ft roster' + (!canEdit && !rows.some(r => r.position) ? ' nopos' : ''));
  const thead = el('thead'), hr = el('tr');
  ['#', 'PLAYER', 'POS'].concat(plan.age ? ['AGE'] : plan.born ? ['BORN'] : [])
    .forEach((h, i) => hr.appendChild(el('th', i < 2 ? 'stick c' + i : '', h)));
  plan.measures.forEach(m => {
    const th = el('th', null, m.l);
    th.style.width = m.w + 'px';
    if (!m.text) th.dataset.mk = m.k;
    th.title = measTitle(m);
    hr.appendChild(th);
  });
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.sort((a, b) => (+a.jersey || 99) - (+b.jersey || 99)).forEach(r => {
    const p = r.players || {};
    const tr = el('tr');
    tr.appendChild(el('td', 'stick c0', r.jersey || '–'));

    const nd = el('td', 'stick c1');
    const cell = el('div', 'ft-name');
    const name = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (p.slug) { const a = el('a', null, name); a.href = '../p/?p=' + encodeURIComponent(p.slug); cell.appendChild(a); }
    else cell.appendChild(el('span', null, name || 'Player'));
    nd.appendChild(cell); tr.appendChild(nd);
    /* POSITION, EDITABLE WHERE THE ROSTER IS READ.
       It has always been settable — several clicks into a per-player card in
       the team portal — and read-only here, which is the page a club secretary
       actually opens. Same inline treatment as the measurements beside it, and
       the same permission: the club's own manager, a league administrator over
       that club, or a platform administrator. */
    if (!canEdit) {
      { const pd = el('td', null, r.position || ''); pd.setAttribute('data-i18n-ctx', 'pos'); tr.appendChild(pd); }
    } else {
      const td = el('td', 'meas');
      const inp = el('input', 'meas-in pos-in');
      inp.value = r.position || '';
      inp.placeholder = '—';
      inp.maxLength = 24;
      /* the vocabulary a basketball roster actually uses, offered rather than
         enforced: a league that writes "Combo" or "Point Forward" must not be
         told it is wrong by a dropdown */
      inp.setAttribute('list', 'posOptions');
      let last = inp.value;
      const save = async () => {
        const raw = inp.value.trim();
        if (raw === last) return;
        inp.classList.remove('bad'); inp.title = '';
        inp.classList.add('saving');
        const { error } = await sb.from('roster_entries')
          .update({ position: raw || null })
          .eq('team_id', team.id).eq('player_id', p.id);
        inp.classList.remove('saving');
        if (error) {
          inp.classList.add('bad'); inp.title = error.message;
          inp.value = last; return;
        }
        last = inp.value;
        inp.classList.add('saved');
        setTimeout(() => inp.classList.remove('saved'), 1200);
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      td.appendChild(inp);
      tr.appendChild(td);
    }
    if (plan.age) {
      /* an exact age; a player with only a year reads ~30, marked because it can be a year out */
      const txt = AGES[p.id] != null ? String(AGES[p.id]) : p.birth_year ? '~' + (yearNow - p.birth_year) : '–';
      const td = el('td', 'meas' + (txt === '–' ? ' meas-none' : ''), txt);
      if (AGES[p.id] == null && p.birth_year) td.title = 'born ' + p.birth_year;
      tr.appendChild(td);
    } else if (plan.born) {
      tr.appendChild(el('td', 'meas' + (p.birth_year ? '' : ' meas-none'), p.birth_year ? String(p.birth_year) : '–'));
    }

    plan.measures.forEach(m => {
      const td = el('td', 'meas');
      const val = p[m.k];

      if (!canEdit) {
        /* read-only: show it in the reader's units, kept to repaint when those change */
        fillMeas(td, m, val);
        if (!m.text) { td.dataset.mk = m.k; td.dataset.mv = val == null ? '' : String(val); }
        tr.appendChild(td);
        return;
      }

      const inp = el('input', 'meas-in');
      inp.value = val == null ? '' : String(val);
      inp.placeholder = m.text ? '—' : m.unit;
      if (!m.text) { inp.type = 'number'; inp.min = String(m.min); inp.max = String(m.max); }
      else inp.maxLength = 80;

      let last = inp.value;
      const save = async () => {
        const raw = inp.value.trim();
        if (raw === last) return;
        let out = raw === '' ? null : (m.text ? raw : parseInt(raw, 10));
        if (!m.text && out != null && (!isFinite(out) || out < m.min || out > m.max)) {
          inp.classList.add('bad');
          inp.title = m.l + ' must be between ' + m.min + ' and ' + m.max + m.unit;
          return;
        }
        inp.classList.remove('bad'); inp.title = '';
        inp.classList.add('saving');
        const patch = {}; patch[m.k] = out;
        const { error } = await sb.from('players').update(patch).eq('id', p.id);
        inp.classList.remove('saving');
        if (error) {
          inp.classList.add('bad');
          inp.title = error.message;
          inp.value = last;                 // put back what was there
          return;
        }
        last = inp.value;
        inp.classList.add('saved');
        setTimeout(() => inp.classList.remove('saved'), 1200);
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      td.appendChild(inp);
      tr.appendChild(td);
    });

    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const squad = squadP;
  /* no average row when there is nothing to average: a club whose data gives no ages, years or measurements */
  const averaged = plan.age || plan.born || plan.measures.some(m => m.k === 'height_cm' || m.k === 'weight_kg');
  if (averaged) t.appendChild(squadAverages(squad, AGES, plan));
  wrap.appendChild(t); host.appendChild(wrap);

  /* THE UNITS SWITCH, in the roster's heading: pressing it repaints the heights, weights and the
     squad's averages in place (and every other page's, since the choice is site-wide) */
  const U = UNITS();
  const slot = $('#rosterUnits');
  const converts = plan.measures.some(m => !m.text);
  if (U && slot && !slot.firstChild && converts) slot.appendChild(U.toggle());
  if (slot && !converts) slot.textContent = '';
  if (U && !t.__unitsHooked) {
    t.__unitsHooked = true;
    U.onChange(() => {
      if (!t.isConnected) return;
      const byK = Object.fromEntries(MEASURES.map(m => [m.k, m]));
      t.querySelectorAll('td[data-mk]').forEach(td => fillMeas(td, byK[td.dataset.mk], td.dataset.mv === '' ? null : +td.dataset.mv));
      t.querySelectorAll('th[data-mk]').forEach(th => { th.title = measTitle(byK[th.dataset.mk]); });
      const old = t.querySelector('tfoot');
      if (old) old.replaceWith(squadAverages(squad, AGES, plan));
    });
  }

  if (canEdit) {
    host.appendChild(el('div', 'empty',
      'You manage this club, so the position and the measurements are editable — ' +
      'they save when you leave the box. Heights and wingspans are in centimetres, ' +
      'and the position appears on the broadcast lineup graphics.'));
  }
}


/* THE CLUB'S FIXTURE STRIP, under the record: the same embed club websites carry, showing only
   this club's games (?t=) with its league named in the corner (?l=). It opens in the page's light
   or dark and, on a club-coloured page, the club's colours; teamcolour.js keeps it in step after. */
function teamStrip(team, lg) {
  const wrap = $('#teamStrip'), frame = $('#teamStripFrame');
  if (!wrap || !frame || !team.slug) return;
  const hex = v => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  let src = '../embed/strip/?n=12&t=' + encodeURIComponent(team.slug) +
    (lg && lg.slug ? '&l=' + encodeURIComponent(lg.slug) : '') + '&theme=' + (light ? 'light' : 'dark');
  if (document.body.classList.contains('themed') && hex(team.colour)) {
    src += '&accent=' + encodeURIComponent(team.colour) +
      (hex(team.colour_2) ? '&accent2=' + encodeURIComponent(team.colour_2) : '');
  }
  frame.title = team.name + ' fixtures';
  frame.src = src;
  wrap.hidden = false;
  /* not drawn while the reader is a screen or more from it (teamcolour.js drawDistance) */
  const TC = window.EpinoiaTeamColour;
  if (TC && TC.drawDistance) TC.drawDistance(frame);
}

let TG = { comp: '', show: 'all', rows: [] };
async function games(team) {
  const gs = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` + inSeason() +
    `&select=id,tipoff_at,status,home_score,away_score,home_team_id,venue,competition_id,competitions(id,name,kind),` +
    `home:home_team_id(name,slug,short_name,colour,colour_2,logo_path),away:away_team_id(name,slug,short_name,colour,colour_2,logo_path)&order=tipoff_at.desc`);
  const host = $('#games'); host.textContent = '';
  /* A MEMBERS-ONLY LEAGUE keeps its upcoming fixtures public while it says so (§2) -- a league
     that wants people through the door must say when the doors open -- and the database
     returns nothing else. The list opens on them and offers nothing that is not there. */
  if (ACCESS.paywall) {
    TG.show = 'upcoming';
    if (!gs.length) {
      host.appendChild(el('div', 'empty', ACCESS.fixtures ? 'No upcoming fixtures.' : 'Fixtures are shown to members.'));
      return;
    }
  }
  if (!gs.length) { host.appendChild(el('div', 'empty', 'No games yet.')); return; }
  TG.rows = gs;
  paintGames(team);
}
/* WHICH COMPETITION, WHAT STATE. The chips sit above the list: one per competition the club
   has played in (only when there is more than one), then all / results / upcoming. */
function paintGames(team) {
  const host = $('#games'); host.textContent = '';
  const gs = TG.rows;
  const comps = new Map();
  gs.forEach(g => { const c = g.competitions; if (c && c.id && !comps.has(c.id)) comps.set(c.id, c); });
  const pick = el('div', 'gpick');
  const chip = (label, on, fn, kind) => {
    const b = el('button', 'ep-chip' + (on ? ' on' : ''), label); b.type = 'button';
    if (kind) { const k = el('small', 'kind', kind); k.setAttribute('data-i18n-ctx', 'kind'); b.appendChild(k); }
    b.addEventListener('click', () => { fn(); paintGames(team); });
    return b;
  };
  if (comps.size > 1) {
    const row = el('div', 'grow');
    row.appendChild(chip('all competitions', !TG.comp, () => { TG.comp = ''; }));
    [...comps.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c =>
      row.appendChild(chip(c.name, TG.comp === c.id, () => { TG.comp = c.id; }, c.kind || '')));
    pick.appendChild(row);
  }
  const row2 = el('div', 'grow');
  [['all', 'all games'], ['results', 'results'], ['upcoming', 'upcoming']].forEach(([k, label]) =>
    row2.appendChild(chip(label, TG.show === k, () => { TG.show = k; })));
  if (!ACCESS.paywall) pick.appendChild(row2);    // behind the wall there are only fixtures
  host.appendChild(pick);

  const done = st => st === 'final' || st === 'finalising';
  let list = gs.slice();
  if (TG.comp) list = list.filter(g => g.competition_id === TG.comp);
  if (TG.show === 'results') list = list.filter(g => done(g.status) || g.status === 'live');
  if (TG.show === 'upcoming') list = list.filter(g => g.status === 'scheduled')
                                       .sort((a, b) => new Date(a.tipoff_at || 0) - new Date(b.tipoff_at || 0));
  /* THE NEXT GAME FIRST. The rows arrive newest tip-off first, which for a club with a season
     listed put next spring's last fixture at the top and the game this weekend thirty rows down.
     So: anything live, then what is still to come, soonest first, then the results, latest first.
     A fixture with no date yet goes to the end of the ones to come. */
  if (TG.show === 'all') {
    const t = g => (g.tipoff_at ? new Date(g.tipoff_at).getTime() : Infinity);
    const rank = g => (g.status === 'live' ? 0 : done(g.status) ? 2 : 1);
    list.sort((a, b) => rank(a) - rank(b) ||
      (rank(a) === 2 ? t(b) - t(a) : t(a) - t(b)));
  }
  if (!list.length) { host.appendChild(el('div', 'empty', 'Nothing matches that.')); return; }

  /* EACH GAME AS THE FIXTURES PAGE DRAWS IT: both clubs, home on the left, in their colours, crests in
     ringed white discs, the score (or the tip-off) on a black block with the winner in yellow, and this
     club's result on a W / L key under it; each day on a teletext strip. The whole row opens the game. */
  const TC = window.EpinoiaTeamColour;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const side = (t, k) => {
    const tm = t || {};
    const sd = el('div', 'tfs ' + k);
    if (TC && TC.card) TC.card(sd, tm.colour || '#93f2bf', tm.colour_2);
    const code = (tm.short_name || tm.name || '?').slice(0, 3).toUpperCase();
    const disc = el('span', 'tfc', code);
    const url = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(tm.logo_path) : null;
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      /* a crest that will not load leaves the club's letters behind, not an empty disc */
      img.addEventListener('error', () => { disc.textContent = code; });
      disc.textContent = ''; disc.appendChild(img);
    }
    const nm = el('div');
    nm.append(el('div', 'tn' + (tm.slug === team.slug ? ' us' : ''), tm.name || '—'), el('div', 'ha', k === 'h' ? 'Home' : 'Away'));
    sd.append(disc, nm);
    return sd;
  };
  let lastDay = null;
  list.forEach(g => {
    const home = g.home_team_id === team.id;
    const us = home ? g.home_score : g.away_score;
    const them = home ? g.away_score : g.home_score;
    const final = done(g.status), live = g.status === 'live';
    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    const dk = live ? 'live' : (when ? when.toDateString() : 'tbc');
    if (dk !== lastDay) {
      lastDay = dk;
      host.appendChild(el('div', 'tfday' + (live ? ' live' : ''), live ? 'Live now'
        : when ? DAYS[when.getDay()] + ' ' + when.getDate() + ' ' + MONTHS[when.getMonth()] + ' ' + when.getFullYear() : 'Date to be confirmed'));
    }
    const row = el('a', 'tfx' + (live ? ' live' : ''));
    row.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
    const H = g.home || {}, A = g.away || {};
    if (H.colour) row.style.setProperty('--hc', H.colour);
    if (A.colour) row.style.setProperty('--ac', A.colour);

    const mid = el('div', 'tfm');
    if (final || live) {
      const sc = el('div', 'sc');
      sc.append(el('span', final && g.home_score > g.away_score ? 'w' : '', String(g.home_score ?? 0)), el('span', 'dash', '–'),
                el('span', final && g.away_score > g.home_score ? 'w' : '', String(g.away_score ?? 0)));
      mid.appendChild(sc);
      if (final) {
        const res = el('div', 'res ' + (us > them ? 'w' : 'l'), us > them ? 'W' : 'L');
        res.setAttribute('data-i18n-ctx', 'res');
        mid.appendChild(res);
      } else mid.appendChild(el('div', 'st live', 'LIVE'));
    } else {
      mid.append(el('div', 'sc t', when ? String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') : 'TBC'),
                 el('div', 'st', 'preview'));
    }
    row.append(side(H, 'h'), mid, side(A, 'a'));
    const bits = [];
    if (g.venue) bits.push(g.venue);
    if (g.competitions && g.competitions.name && comps.size > 1) bits.push(g.competitions.name);
    if (bits.length) row.appendChild(el('div', 'tfwhere', bits.join('  ·  ')));
    if (window.EpinoiaFollow && !final) { row.classList.add('hasbell'); row.appendChild(window.EpinoiaFollow.bell('game', g.id, { cls: 'tfbell' })); }
    host.appendChild(row);
  });
}
