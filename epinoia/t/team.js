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
let SEASON_COMPS = null;
const inSeason = () => (SEASON_COMPS && SEASON_COMPS.length ? '&competition_id=in.(' + SEASON_COMPS.join(',') + ')' : '');
async function chooseSeason(team, lg) {
  const SB = window.EpinoiaSeasonBar;
  if (!SB || !lg || !lg.id) return;
  try {
    const o = await SB.load(api, lg.id);
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
    SB.mount({ host: $('#seasonPick'), wrap: $('#seasonRow'), seasons: o.list, season });
  } catch (_) { /* every season, as before */ }
}

(async function boot() {
  if (!want) return oops('No team specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    const ts = await api(`teams?${key}=eq.${encodeURIComponent(want)}&select=*,leagues(id,name,slug,country)&limit=1`);
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
    if (!themed) badge.style.background = colour;
    badge.textContent = team.short_name || (team.name || '?').slice(0, 2).toUpperCase();
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
    if (!themed) $('#tname').style.color = colour;
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
    $('#tname').parentNode.appendChild(acts);
    const lg = team.leagues || {};
    if (lg.slug) window.__CS_LEAGUE_SLUG = lg.slug;
    $('#tsub').textContent = lg.name || 'Independent';
    $('#ctx').textContent = lg.name ? lg.name + ' · ' + team.name : team.name;
    if (lg.slug) $('#leagueLink').href = '../l/?l=' + encodeURIComponent(lg.slug);
    else $('#leagueLink').style.display = 'none';
    /* A WOMEN'S SIDE SAYS SO beside its league, and a club linked to its other competitions (the SLB, the EuroCup,
       the women's side) gets a button that opens them (linkswitch.js, migration 0178). Asked without waiting. */
    if (window.EpinoiaLinks) window.EpinoiaLinks.paintTeam(team, { sub: $('#tsub') }).catch(() => { /* the page as it was */ });
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
    whenNear($('#teamshots'), () => teamShots(team));
    whenNear($('#teamclock'), () => teamShotClock(team));
    whenNear($('#teamrot'), () => teamRotations(team));
    whenNear($('#lulist') || $('#wowy'), () => { lineupPanels(team).catch(() => {}); });
    await videoPanel(team);
    weeklyTab(team);
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
       Without analytics, the marks without the zones, and a line saying what they would add. */
    window.EpinoiaShotChart.renderZones({ host, shots, colour: team.colour || '#93f2bf', minAttempts: 5, games: gs.length, table: false,
      note: 'last ' + gs.length + (gs.length === 1 ? ' game' : ' games'), zones: !ACCESS.locked });
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
    tabs.style.display = '';
    const showVideo = on => {
      document.body.classList.toggle('vtab', on);
      $('#videosec').style.display = on ? '' : 'none';
      tabs.querySelectorAll('.ep-tab').forEach(b => b.classList.toggle('on', (b.dataset.p === 'video') === on));
      if (on) window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });
    };
    tabs.querySelectorAll('.ep-tab').forEach(b => { b.onclick = () => showVideo(b.dataset.p === 'video'); });
    if (new URLSearchParams(location.search).get('tab') === 'video') showVideo(true);
  } catch (e) { console.warn('[video]', e); }
}

/* THE WEEK, SCOUTED. The same ledger the match report's scout's note is built on, asked of the
   club's last seven days instead of one game: what to keep doing, what to work on, and the whole
   column of measures underneath as the evidence for both. Mounted whether or not there is video,
   so the tab bar appears for every club rather than only the filmed ones. */
function weeklyTab(team) {
  const W = window.EpinoiaWeekly;
  if (!W || !W.mount) return;
  W.mount({
    tabs: '#ttabs', panel: '#weeklysec', window: 'the last seven days',
    load: () => W.teamWeek(api, team.id, { name: team.name, league: ACCESS.slug, days: 7 })
  });
}

async function record(team) {
  if (ACCESS.paywall) return;          // standings are behind the wall; the strip is hidden
  const st = await api(`standings?team_id=eq.${team.id}` + inSeason() +
    `&select=gp,w,l,pts_for,pts_against,diff,league_points,rank,streak&limit=1`);
  const wrap = $('#rec'); wrap.textContent = '';
  const s = st[0];
  const cells = s
    ? [['rank', s.rank ?? '—'], ['record', `${s.w}-${s.l}`], ['played', s.gp],
       ['pts for', s.pts_for], ['pts against', s.pts_against],
       ['diff', (s.diff > 0 ? '+' : '') + s.diff], ['streak', s.streak || '—']]
    : [['record', '0-0'], ['played', 0]];
  cells.forEach(([l, v]) => {
    const d = el('div'); d.append(el('div', 'v', v), el('div', 'l', l)); wrap.appendChild(d);
  });
}

/* ------------------------------------------------------------ team stats --- */
/* Two readings of the same season: the team's own line, and every player on it
   through the full table. The team line is shown as tiles because there is
   only one row of it — a one-row table is a worse way to read a single line. */
let teamScopeKind = 'all';
const KIND_LABEL = { league: 'League', cup: 'Cup', trophy: 'Trophy', playoff: 'Playoffs', friendly: 'Friendlies' };

async function teamStats(team, kind) {
  const host = $('#teamstats'); host.textContent = '';
  if (ACCESS.paywall) return;          // the card stands in for this section
  const D = window.EpinoiaData;
  if (kind) teamScopeKind = kind;
  let S = null;
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
    if (scoped.length) S = await D.season(scoped);
  } catch (e) {
    host.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return;
  }
  const mine = S && S.teams.find(t => t.id === team.id);
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
        pair.append(o, d); fc.appendChild(pair);
        grid.appendChild(fc);
      });
    return grid;
  }, 'own · allowed');

  const pg = v => (v == null || !isFinite(v)) ? null : v / (mine.gp || 1);
  card('line', 'season line', () => {
    const tiles = el('div', 'tiles');
    [['ppg', n1(mine.ppg), true], ['opp ppg', n1(mine.papg), false],
     ['diff', mine.diffpg == null ? '—' : (mine.diffpg > 0 ? '+' : '') + n1(mine.diffpg), true],
     ['ortg', n1(mine.ortg), true], ['drtg', n1(mine.drtg), false],
     ['net', mine.net == null ? '—' : (mine.net > 0 ? '+' : '') + n1(mine.net), true],
     ['pace', n1(mine.pace), false], ['ts%', n1(mine.ts), false],
     ['ast/to', mine.ast_to == null ? '—' : Number(mine.ast_to).toFixed(2), false],
     ['reb / g', n1(pg(mine.reb)), false], ['ast / g', n1(pg(mine.ast)), false], ['stl / g', n1(pg(mine.stl)), false],
     ['blk / g', n1(pg(mine.blk)), false], ['paint / g', n1(pg(mine.paint)), false], ['fast / g', n1(pg(mine.fast)), false],
     ['2nd chance / g', n1(pg(mine.second_chance)), false], ['off turnovers / g', n1(pg(mine.pts_off_to)), false],
     ['bench / g', n1(pg(mine.bench)), false]]
      .forEach(([l, v, hi]) => {
        const d = el('div', 'tile' + (hi ? ' hi' : ''));
        d.append(el('div', 'v', v == null ? '—' : v), el('div', 'l', l));
        tiles.appendChild(d);
      });
    return tiles;
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
  const meta = await D.playerMeta(S.players.map(p => p.id));
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

/* ------------------------------------------------------------- shot zones --- */
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
  const groups = SC.GROUPS.concat(SC.BIG);
  const keys = [];
  groups.forEach(g => ['share', 'att100', 'attG', 'madeG', 'efg'].forEach(m => keys.push('z_' + g.k + '_' + m)));
  const ranks = SE.percentiles(S.teams, keys, []);
  const pctOf = k => { const tb = ranks.get(k); return tb ? tb.get(team.id) : null; };
  const heat = window.EpinoiaTable && window.EpinoiaTable.heatStyle ? window.EpinoiaTable.heatStyle : () => '';
  const f1 = v => v == null ? '\u2014' : (+v).toFixed(1);
  const cell = (k, f) => { const p = pctOf(k); return '<td class="heat" style="' + heat(p) + '">' + (f || f1)(mine[k]) + (p == null ? '' : '<span class="pctl">' + Math.round(p) + '</span>') + '</td>'; };
  const head = '<tr><th class="l">zone</th><th>% of shots</th><th>att / 100 poss</th><th>att / g</th><th>made / g</th><th>efg%</th></tr>';
  const tr = g => '<tr' + (mine['z_' + g.k + '_att'] ? '' : ' class="none"') + '><td class="l">' + g.label + '</td>' +
    cell('z_' + g.k + '_share') + cell('z_' + g.k + '_att100') + cell('z_' + g.k + '_attG') + cell('z_' + g.k + '_madeG') + cell('z_' + g.k + '_efg', v => v == null ? '\u2014' : (+v).toFixed(0)) + '</tr>';
  const wrap = el('div');
  wrap.innerHTML = '<div class="sc-tablewrap"><table class="sc-table">' +
    '<thead>' + head + '</thead><tbody>' + SC.GROUPS.map(tr).join('') + '</tbody>' +
    '<thead><tr><th class="l" colspan="6">the larger cuts</th></tr>' + head + '</thead><tbody>' + SC.BIG.map(tr).join('') + '</tbody></table></div>' +
    '<div class="sc-note">every located shot in the competition' + (teamScopeKind !== 'all' ? ' (' + (KIND_LABEL[teamScopeKind] || teamScopeKind).toLowerCase() + ')' : '') +
    ' \u00b7 the small number is the percentile among the ' + S.teams.length + ' teams (higher is more, or better) \u00b7 att / 100 = attempts per 100 of the club\u2019s own possessions \u00b7 the same numbers for every club are under \u201cshot zones\u201d in the league table\u2019s team statistics</div>';
  host.appendChild(wrap);
  reboundZones(host, S, mine);
}

/* WHAT BECAME OF EVERY SHOT ATTEMPT, by zone, for the club's own attempts and for the attempts taken against it
   (Louie, 2026-09-25). Rim, mid-range and three by the box score's own zone rule, over every game in the scope: of
   the attempts in a zone, the share that went in, the share missed and rebounded by the shooter's own side
   (offensive), and by the other side (defensive) -- the four kinds add up to the attempts, the way FG% splits them
   into made and missed. The rebounds are the first one after each miss, before anything else happens to the ball
   (epinoia/situations.js reboundZones); a miss with none is a foul and free throws, a turnover, the end of a
   period or a rebound the feed did not log. The club's own OREB% and DREB% carry a percentile among the teams. */
function reboundZones(host, S, mine) {
  if (!mine || !mine.rb_ready) return;
  const SE = window.EpinoiaSeason;
  const ZS = [['rim', 'at the rim'], ['mid', 'mid-range'], ['three', 'threes'], ['all', 'every shot']];
  const keys = [];
  ZS.forEach(([z]) => ['orp', 'drp'].forEach(m => keys.push('rb_' + z + '_' + m)));
  const ranks = SE ? SE.percentiles(S.teams, keys, []) : new Map();
  const pctOf = k => { const tb = ranks.get(k); return tb ? tb.get(mine.id) : null; };
  const heat = window.EpinoiaTable && window.EpinoiaTable.heatStyle ? window.EpinoiaTable.heatStyle : () => '';
  const pc = v => v == null ? '\u2014' : (+v).toFixed(1) + '%';
  const share = (n, d) => (d ? pc(100 * n / d) : '\u2014');
  const FEWA = 15;                                             // a rate on fewer attempts than this is not ranked
  const plain = (n, d) => '<td>' + share(n, d) + '</td>';
  const ranked = (k, n) => { const p = n < FEWA ? null : pctOf(k); return '<td class="heat" style="' + heat(p) + '">' + pc(mine[k]) + (p == null ? '' : '<span class="pctl">' + Math.round(p) + '</span>') + '</td>'; };
  /* own: the club's attempts (its own offensive rebound is the good one, ranked); against: the attempts taken
     against it (its own defensive rebound is the good one, ranked) */
  const tr = ([z, label], end) => {
    const own = end === 'own', g = f => mine['rb_' + z + '_' + (own ? '' : 'g') + f], a = g('a');
    return '<tr' + (a ? '' : ' class="none"') + '><td class="l">' + label + '</td><td>' + a + '</td>' + plain(g('m'), a) +
      (own ? ranked('rb_' + z + '_orp', a) + plain(g('d'), a) : plain(g('o'), a) + ranked('rb_' + z + '_drp', a)) +
      '<td>' + share(a - g('m') - g('o') - g('d'), a) + '</td></tr>';
  };
  const head = (first, off, def) => '<tr><th class="l">' + first + '</th><th>attempts</th><th>made</th><th>' + off + '</th><th>' + def + '</th><th>no rebound</th></tr>';
  const wrap = el('div');
  wrap.innerHTML = '<div class="ffhead">what became of every shot attempt</div>' +
    '<div class="sc-tablewrap"><table class="sc-table">' +
      '<thead>' + head('the club\u2019s own attempts', 'own offensive rebound', 'other side\u2019s defensive rebound') + '</thead><tbody>' + ZS.map(z => tr(z, 'own')).join('') + '</tbody>' +
      '<thead>' + head('attempts against the club', 'other side\u2019s offensive rebound', 'own defensive rebound') + '</thead><tbody>' + ZS.map(z => tr(z, 'against')).join('') + '</tbody></table></div>' +
    '<div class="sc-note">every shot attempt in a zone went in, or was missed and rebounded by the shooter\u2019s side (offensive) or the other side (defensive), or had no rebound \u00b7 ' +
    'the four add up to the attempts \u00b7 the first rebound after each miss counts, team rebounds too; a miss followed by a foul and free throws, a turnover or the end of a period has none \u00b7 ' +
    'the small number is the percentile among the teams, higher is better, and a rate on fewer than 15 attempts is not ranked</div>';
  host.appendChild(wrap);
}

/* ------------------------------------------------------- lineups & WOWY --- */
/* All three panels read the same stints, fetched once. */
async function lineupPanels(team) {
  const D = window.EpinoiaData;
  if (ACCESS.paywall) return;          // stints are behind the wall; the sections are hidden
  try {
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=id,home_team_id,away_team_id` + inSeason());
    if (!gs.length) {
      ['#wowy', '#lufilter', '#lulist'].forEach(sel =>
        $(sel).appendChild(el('div', 'empty',
          'No finalised games yet — lineups appear once one is played.')));
      return;
    }
    const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
    const st = await D.stints(gs.map(g => g.id), team.id, byGame);
    if (!st.length) {
      ['#wowy', '#lufilter', '#lulist'].forEach(sel =>
        $(sel).appendChild(el('div', 'empty', 'No lineup data yet.')));
      return;
    }

    const ids = [...new Set(st.flatMap(r => r.player_ids))];
    const meta = await D.playerMeta(ids);
    $('#wowyNote').textContent = st.length + ' stints · ' + ids.length + ' players';

    /* the team WOWY needs a subject; default to the most-used player and let
       the reader change it, because "the team without X" is a question about a
       specific X rather than about the team */
    const mins = new Map();
    st.forEach(s2 => (s2.player_ids || []).forEach(id =>
      mins.set(id, (mins.get(id) || 0) + ((s2.stats && s2.stats.dur) || 0))));
    const order = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    let subject = order[0];

    const pick = $('#wowyPick');
    order.forEach(id => {
      const b = el('button', 'ep-chip' + (id === subject ? ' on' : ''),
                   (meta[id] || {}).name || 'Player');
      b.type = 'button';
      b.addEventListener('click', () => {
        subject = id;
        pick.querySelectorAll('.ep-chip').forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        drawWowy();
      });
      pick.appendChild(b);
    });

    function drawWowy() {
      window.EpinoiaWowy.onOffTiles('#onoff', st, subject);
    }
    drawWowy();

    /* the combination matrix, seeded with the two most-used players. Without analytics it
       is the preview: wowy.js caps the subjects and adds its own teaser line. */
    window.EpinoiaWowy.render(Object.assign({
      host: '#wowy', stints: st, meta, max: 4,
      preselect: order.slice(0, 2)
    }, ACCESS.locked ? { preview: true, leagueSlug: ACCESS.slug } : {}));

    window.EpinoiaLineupUI.filterPanel({ host: '#lufilter', stints: st, meta });
    window.EpinoiaLineupUI.listPanel({ host: '#lulist', stints: st, meta });
  } catch (e) {
    /* A silent catch left three empty sections with no explanation — which is
       exactly what a reader saw when the scripts failed to load. Say what
       happened, in the sections themselves. */
    console.warn('[lineups]', e);
    ['#wowy', '#lufilter', '#lulist'].forEach(sel => {
      const h = $(sel);
      if (h && !h.children.length) {
        h.appendChild(el('div', 'empty', 'Could not load lineup data: ' + (e.message || e)));
      }
    });
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

  if (!rows.length && !canEdit) return;      // no staff on file, nothing to say

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
  const rows = await api(`roster_entries?team_id=eq.${team.id}&active=eq.true` +
    `&select=jersey,position,players(id,first_name,last_name,slug,is_minor,` +
    `height_cm,weight_kg,wingspan_cm,previous_club)&order=jersey`);
  const host = $('#roster'); host.textContent = '';

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

  const wrap = el('div', 'ft-wrap');
  const t = el('table', 'ft');
  const thead = el('thead'), hr = el('tr');
  ['#', 'PLAYER', 'POS'].forEach((h, i) => hr.appendChild(el('th', i < 2 ? 'stick c' + i : '', h)));
  MEASURES.forEach(m => {
    const th = el('th', null, m.l);
    th.style.width = m.w + 'px';
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

    MEASURES.forEach(m => {
      const td = el('td', 'meas');
      const val = p[m.k];

      if (!canEdit) {
        /* read-only: show it, with the imperial equivalent where it helps */
        if (val == null || val === '') td.appendChild(el('span', 'meas-none', '–'));
        else if (m.imperial) {
          td.appendChild(el('span', null, val + m.unit));
          td.appendChild(el('span', 'meas-alt', feetInches(val)));
        } else {
          td.appendChild(el('span', null, m.text ? String(val) : val + m.unit));
        }
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
  t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);

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
}

let TG = { comp: '', show: 'all', rows: [] };
async function games(team) {
  const gs = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` + inSeason() +
    `&select=id,tipoff_at,status,home_score,away_score,home_team_id,venue,competition_id,competitions(id,name,kind),` +
    `home:home_team_id(name,slug,short_name,colour,logo_path),away:away_team_id(name,slug,short_name,colour,logo_path)&order=tipoff_at.desc`);
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

  list.forEach(g => {
    const home = g.home_team_id === team.id;
    const opp = home ? (g.away || {}) : (g.home || {});
    const us = home ? g.home_score : g.away_score;
    const them = home ? g.away_score : g.home_score;
    const final = done(g.status);

    const row = el('div', 'fx');
    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    row.appendChild(el('div', 'd', when ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'TBC'));
    const o = el('div', 'o');
    if (window.epinoiaCrest) o.appendChild(window.epinoiaCrest(opp, { cls: 'fxcrest' }));
    o.appendChild(el('span', null, (home ? 'v ' : '@ ') + (opp.name || '\u2014')));
    if (g.competitions && g.competitions.name && comps.size > 1) o.appendChild(el('small', 'comp', g.competitions.name));
    row.appendChild(o);
    row.appendChild(el('div', 's', final ? `${us}\u2013${them}` : (g.status === 'live' ? 'LIVE' : '')));
    const res = final ? (us > them ? 'W' : 'L') : (g.status === 'live' ? 'LIVE' : (g.venue || 'SCHEDULED'));
    { const rd = el('div', 'r ' + (final ? (us > them ? 'w' : 'ls') : ''), res); rd.setAttribute('data-i18n-ctx', 'res'); row.appendChild(rd); }
    if (window.EpinoiaFollow && !final) row.appendChild(window.EpinoiaFollow.bell('game', g.id));
    else row.appendChild(el('span'));
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => location.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase');
    host.appendChild(row);
  });
}
