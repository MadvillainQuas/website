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
let scene    = (qp.get('scene') || 'scorebug').toLowerCase();
/* ?live=1 hands the choice of graphic to the control room. Without it the
   layer shows one scene for ever, which is the right behaviour for a
   production that would rather have one OBS source per graphic and never
   depend on a web page being open. */
const LIVE_SCENE = qp.get('live') === '1';
/* NOT const, because a single browser source has to be able to switch teams.

   A production with twelve sources picks the away five by making the away
   source visible. A production with ONE — which is the whole Wirecast path,
   and the recommended one for everything without a control API — has to be
   told, and the control room has always sent `side` on the wire. This layer
   simply never read it, so the one-source path could show the home five and
   nothing else and there was no way to tell from here. */
let side   = qp.get('side') === '1' ? 1 : 0;
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
/* BOTTOM CENTRE, because that is where a scoreboard goes.

   Bottom-left was the safe default for a lower third, and the scorebug is not
   one: it is the fixed furniture of the broadcast, and every hall board, every
   television graphic and every viewer's expectation puts it in the middle at
   the foot of the frame. A corner reads as an overlay somebody added; the
   centre reads as the score.

   Still overridable per source — a production with a permanent sponsor strip
   along the bottom wants it somewhere else, and ?pos= is how they say so. */
const pos = String(qp.get('pos') || 'bc').toLowerCase();
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
  const period  = (sub && sub.state && sub.state.period) || S.period || 1;
  /* BEFORE TIP THE CLOCK IS FULL, NOT ZERO. A fixture with no game_state row
     yet has clock_ms of nothing, and a scorebug laid out an hour before the
     game reading "0.0" looks broken to the person laying it out — which is
     exactly who is looking at it then. A period that has not started shows its
     own length, which is what the board in the hall shows. */
  let clockMs = sub ? sub.clockMs() : (S.clockMs || 0);
  const started = !!(sub && sub.state) || S.events.length > 0;
  if (!started && !clockMs && E.PLEN) clockMs = E.PLEN(period);

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
      logo: logoOf(t),
      /* EVERY player, not only the five on the floor. A "top scorers" graphic
         that silently excluded whoever had just been substituted would be
         wrong in the exact moment a director reaches for it. onCourt keeps its
         name and its meaning; squad is the whole bench. */
      onCourt: d ? d.onCourt[t].map(pid => playerCard(t, pid, d)) : [],
      squad: d ? (S.teams[t].players || []).map(p => playerCard(t, p.id, d)) : [],
      /* The named squad, with no statistics attached — this is what a pre-game
         graphic draws, and it exists before a single event does. */
      roster: (S.teams[t].players || []).map(p => ({
        id: p.id, number: p.num || '', name: p.name || '',
        pos: p.pos || '', height: p.height || null, weight: p.weight || null,
        photo: PHOTOS[p.id] || null
      })),
      totals: teamTotals(t, d)
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
      attendance: game.attendance != null ? game.attendance : null,
      capacity: game.capacity != null ? game.capacity : null,
      officials: game.officials || {},
      tipoff: tipoffLabel(),
      leagueLogo: leagueLogo(),
      leagueShort: leagueShort(),
      leagueInitials: leagueInitials()
    },
    clock: {
      period,
      /* A FINISHED GAME HAS NO CLOCK, and showing one stopped at zero is the
         worst of both answers: 0.0 in the fourth reads as a live game about to
         restart, and a viewer joining a rerun cannot tell it from one about to
         go to overtime. The hall's own board says FINAL at the buzzer and so
         does this.

         Kept short — the bug's clock slot is sized for 10:00, and "FINAL"
         across it would crowd the possession arrows either side. FIN is what
         the shorthand on a paper scoresheet says. */
      periodLabel: game.status === 'final' ? 'FINAL' : periodLabel(period),
      ms: clockMs,
      display: game.status === 'final' ? 'FIN' : mmss(clockMs),
      final: game.status === 'final',
      running: !!(sub && sub.state && sub.state.running)
    },
    possessionArrow: (sub && sub.state && sub.state.arrow != null)
      ? sub.state.arrow : (S.arrowInit != null ? S.arrowInit : null),
    home: teamOf(0),
    away: teamOf(1),
    starters: S.starters || [[], []],
    lineups: bestLineups(d),
    lastPlay: lastPlay(d)
  };
}

/* The club's published crest, if there is one. teams.logo_path is set only when
   a crest is live and cleared when it is removed, so a non-null value already
   means "approved" — no second request to find out. */
function logoOf(t) {
  const src = t === 0 ? game.home : game.away;
  if (!src || !src.logo_path || !CFG.supabaseUrl) return null;
  return CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + src.logo_path;
}

function teamTotals(t, d) {
  const z = { pts: 0, reb: 0, ast: 0, to: 0, stl: 0, blk: 0 };
  if (!d) return z;
  (S.teams[t].players || []).forEach(p => {
    const s = d.stats[p.id]; if (!s) return;
    z.pts += s.pts || 0; z.reb += (s.or || 0) + (s.dr || 0); z.ast += s.ast || 0;
    z.to += s.to || 0; z.stl += s.stl || 0; z.blk += s.blk || 0;
  });
  z.to += (d.team[t].teamTo || 0);
  z.reb += (d.team[t].teamRebO || 0) + (d.team[t].teamRebD || 0);
  return z;
}

/* A MINUTES FLOOR, NOT A TOP FOUR. A lineup that has played forty seconds and
   happens to be +6 is noise with a big number on it, and putting that on air is
   how a graphic loses the people who know the game. Below the floor there is
   simply nothing to show, which is the honest outcome in the first quarter. */
const LINEUP_MIN = 4;

/* PLUS/MINUS, NOT NET RATING, AND THAT IS A BROADCAST DECISION RATHER THAN AN
   ANALYTICAL ONE. Net rating is per hundred possessions, so a unit that has
   played four minutes and gone +6 comes out at +139 — true, and unreadable as
   anything but a mistake to a viewer who has been watching the same game. Raw
   plus/minus is the number a commentator says out loud, it cannot be inflated
   by a small sample, and it is on the same scale as the scoreboard beside it.

   Net rating is still carried in the document for anyone binding their own
   template against it; it is simply not what this graphic leads with. */
function bestLineups(d) {
  if (!d || !E.lineupAgg) return [];
  const out = [];
  [0, 1].forEach(t => {
    let rows = [];
    try { rows = E.lineupAgg(d, t) || []; } catch (_) { return; }
    rows.forEach(l => {
      const min = (l.dur || 0) / 60000;
      if (min < LINEUP_MIN) return;
      out.push({
        team: t, colour: colourOf(t), min: Math.round(min),
        pm: (l.pf || 0) - (l.pa || 0),
        net: (l.ortg || 0) - (l.drtg || 0),
        names: (l.ids || []).map(pid => {
          const p = (S.teams[t].players || []).find(x => x.id === pid);
          return p ? (p.num ? p.num + ' ' : '') + shortName(p.name) : '?';
        })
      });
    });
  });
  return out.sort((a, b) => b.pm - a.pm || b.min - a.min);
}

/* Five full names will not fit on one row of a lower third, and a surname is
   what a commentator says anyway. */
function shortName(n) {
  const parts = String(n || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
}

/* The tip-off, in the words a graphic uses — a time on the night, not an ISO
   string. Left null when the fixture has no time recorded rather than invented,
   because "19:30" on a card for a game with no confirmed time is a promise the
   graphic has no business making. */
function tipoffLabel() {
  if (!game.tipoff_at) return null;
  try {
    const d = new Date(game.tipoff_at);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short',
                                       hour: '2-digit', minute: '2-digit' });
  } catch (_) { return null; }
}

function playerCard(t, pid, d) {
  const p = (S.teams[t].players || []).find(x => x.id === pid) || {};
  const s = d.stats[pid] || {};
  return {
    id: pid, number: p.num || '', name: p.name || '', photo: PHOTOS[pid] || null,
    pts: s.pts || 0, reb: (s.or || 0) + (s.dr || 0), ast: s.ast || 0,
    stl: s.stl || 0, blk: s.blk || 0, pf: s.pf || 0, pm: s.pm || 0,
    fd: s.fd || 0, to: s.to || 0,
    fg: (s.p2m || 0) + (s.p3m || 0) + '-' + ((s.p2a || 0) + (s.p3a || 0)),
    tp: (s.p3m || 0) + '-' + (s.p3a || 0),
    ft: (s.ftm || 0) + '-' + (s.fta || 0),
    min: Math.round((s.min || 0)),
    index: pir(s)
  };
}

/* THE INDEX — what a European scoreboard leads with.

   FIBA's valuation, the same arithmetic EuroLeague prints as PIR and the
   national federations print as "Index". Everything that helped, minus
   everything that did not:

     (pts + reb + ast + stl + blk + fouls drawn)
   − (missed field goals + missed free throws + turnovers + fouls committed)

   It is worth having on air precisely because it disagrees with the points
   column. A guard with 22 points on 9-of-24 and four turnovers is behind a
   centre with 12, 11 rebounds and two blocks, and that is the graphic doing
   its job — the whole reason to show a second ranking is that it says
   something the first one does not.

   Fouls DRAWN is the part people forget, and leaving it out would quietly
   punish the player who spent the night getting hit. The scorer records it,
   so it is used. */
function pir(s) {
  if (!s) return 0;
  const fga = (s.p2a || 0) + (s.p3a || 0);
  const fgm = (s.p2m || 0) + (s.p3m || 0);
  const good = (s.pts || 0) + (s.or || 0) + (s.dr || 0) + (s.ast || 0) +
               (s.stl || 0) + (s.blk || 0) + (s.fd || 0);
  const bad  = (fga - fgm) + ((s.fta || 0) - (s.ftm || 0)) +
               (s.to || 0) + (s.pf || 0);
  return good - bad;
}

/* A letter per line once there are three, so the badge is filled rather than
   underlined. Two or fewer stay on one line: "EL" stacked is a column of two
   characters with air above and below it, which reads as a mistake. */
function initialsHTML(txt) {
  const s = String(txt || '');
  if (!s) return '';
  if (s.length < 3) return '<i class="ini2">' + esc(s) + '</i>';
  return '<i class="ini3">' +
    s.split('').map(ch => '<b>' + esc(ch) + '</b>').join('') + '</i>';
}

function lastPlay(d) {
  if (!d || !d.pbp || !d.pbp.length) return null;
  const e = d.pbp[d.pbp.length - 1];
  return { text: e.txt || '', period: e.period, clock: mmss(e.clock) };
}

/* The competition's own mark, where a football lineup card puts the league
   badge. Falls back to the wordmark, which is why the rail never has a hole in
   it for a league that has not uploaded one. */
function leagueLogo() {
  const l = ((game.competitions || {}).seasons || {}).leagues || {};
  return (l.logo_path && CFG.supabaseUrl)
    ? CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + l.logo_path
    : null;
}
function leagueShort() {
  const l = ((game.competitions || {}).seasons || {}).leagues || {};
  return l.name || '';
}

/* INITIALS, FOR WHERE A BADGE GOES.

   leagueShort is the league's NAME and is drawn as a wordmark; a scorebug has
   room for a badge and not for "Northern Counties Basketball League". So the
   name is reduced to letters the way a person would say it — first letter of
   each real word, three at most. Small words are dropped, because "NCBL" is
   what people call it and "NCBOTL" is not.

   THE LEAGUE'S OWN LETTERS WIN. leagues.initials (migration 0087) is checked
   first and used as given. Real competitions have acronyms their names do not
   produce, and a derived one is a guess.

   AND A DERIVED ACRONYM IS NEVER ALLOWED TO LAND ON ONE OF THESE.

   Three letters off the front of ordinary English words reach acronyms that
   belong to political organisations, and a scoreboard at a schools game is the
   last place any of them should appear. "Epinoia Demo League" derived EDL,
   which in Britain names a far-right street movement — nobody chose it, no
   reviewer would have caught it in a diff, and it would have gone out on every
   stream the league ever produced.

   The fallback is two letters, which is always harmless and always still a
   badge. A league that wants three sets them itself, deliberately, which is
   the difference between a name and an accident. */
const LEAGUE_NOISE = /^(of|the|and|for|a|an|de|du|la|le|el|des)$/i;
const NEVER_DERIVE = ['EDL', 'BNP', 'KKK', 'NSDAP', 'C18', 'SS', 'NF', 'BUF'];

function leagueInitials() {
  const l = ((game.competitions || {}).seasons || {}).leagues || {};
  /* Set by the league, used as set — including a three-letter one this would
     otherwise refuse to invent. Saying it on purpose is not the same act. */
  if (l.initials) return String(l.initials).toUpperCase().slice(0, 4);

  const name = leagueShort();
  if (!name) return '';
  const words = name.split(/[\s\-–—_/]+/).filter(w => w && !LEAGUE_NOISE.test(w));
  if (!words.length) return '';
  /* A name that is already an acronym — "NBL", "BBL" — is used as it stands
     rather than reduced to its own first letter. */
  const raw = words.length === 1
    ? words[0].slice(0, 3).toUpperCase()
    : words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return NEVER_DERIVE.includes(raw) ? raw.slice(0, 2) : raw;
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
/* ---- before a ball is thrown ------------------------------------------------
   PRE-GAME GRAPHICS ARE THE HALF-HOUR THE PLATFORM WAS NOT SERVING.

   A stream starts twenty minutes before tip and has nothing to show. That gap is
   where lineups, officials and the matchup card belong, and all of it exists in
   the database well before anybody touches a scoring app.

   Two things have to be fetched that an in-play graphic never needs:

     THE SQUADS. roster_snapshot is frozen at tip and does not exist yet, so
     before a game the rosters come from the clubs' own published lists. After
     tip the snapshot wins, because a roster edited on Tuesday must not rewrite
     who was available on Saturday.

     THE PHOTOGRAPHS. media rows are readable only once a league has approved
     them, and a minor's needs recorded consent — both enforced in the database
     rather than here. So if a photograph comes back, it is publishable, and if
     one does not, the graphic shows initials and nobody has to remember why. */

let PHOTOS = {};        // player id -> url, for whatever came back approved

async function loadRosters() {
  const snapped = !!(game.roster_snapshot && game.roster_snapshot.teams);
  /* THE SNAPSHOT FREEZES WHO WAS AVAILABLE, NOT HOW TALL THEY ARE. It is taken
     at tip so a roster edited on Tuesday cannot rewrite who could play on
     Saturday — which is exactly right for identity, and says nothing about a
     position or a height. Read from the snapshot, those come back empty and
     every played game loses the line under the name. So the squad still comes
     from the snapshot; the measurements are fetched and merged onto it. */
  if (snapped) return mergeMeasurements();
  const ids = [game.home_team_id, game.away_team_id].filter(Boolean);
  if (!ids.length) return;
  try {
    const re = await api('roster_entries?team_id=in.(' + ids.join(',') + ')' +
      '&active=eq.true&select=team_id,jersey,position,' +
      'players(id,first_name,last_name,height_cm,weight_kg)');
    [game.home_team_id, game.away_team_id].forEach((tid, t) => {
      const list = (re || [])
        .filter(r => r.team_id === tid && r.players)     // a withheld minor comes back null
        .map(r => ({
          id: r.players.id,
          name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim(),
          num: String(r.jersey || ''),
          pos: r.position || '',
          height: r.players.height_cm || null,
          weight: r.players.weight_kg || null
        }))
        .sort((a, b) => (+a.num || 99) - (+b.num || 99));
      if (list.length) S.teams[t].players = list;
    });
  } catch (_) { /* a graphic with no squad shows no squad, and says so */ }
}

/* Position, height and weight for whoever is already in the squad, whatever
   put them there. */
async function mergeMeasurements() {
  const ids = [];
  S.teams.forEach(tm => (tm.players || []).forEach(p => { if (p.id) ids.push(p.id); }));
  if (!ids.length) return;
  const tids = [game.home_team_id, game.away_team_id].filter(Boolean);
  try {
    const [people, entries] = await Promise.all([
      api('players?id=in.(' + ids.join(',') + ')&select=id,height_cm,weight_kg'),
      tids.length
        ? api('roster_entries?team_id=in.(' + tids.join(',') + ')&select=player_id,position')
        : Promise.resolve([])
    ]);
    const meas = {}, pos = {};
    (people || []).forEach(r => { meas[r.id] = r; });
    (entries || []).forEach(r => { if (r.position) pos[r.player_id] = r.position; });
    S.teams.forEach(tm => (tm.players || []).forEach(p => {
      const m = meas[p.id];
      if (m) { p.height = m.height_cm || null; p.weight = m.weight_kg || null; }
      if (pos[p.id]) p.pos = pos[p.id];
    }));
  } catch (_) { /* a name and a number is still a lineup card */ }
}

async function loadPhotos() {
  const ids = [];
  S.teams.forEach(tm => (tm.players || []).forEach(p => { if (p.id) ids.push(p.id); }));
  if (!ids.length) return;
  try {
    /* One request for both squads. media is embedded through the foreign key, so
       an unapproved or unconsented photograph simply is not in the answer —
       there is no filtering to get wrong on this side. */
    const rows = await api('players?id=in.(' + ids.join(',') + ')' +
      '&select=id,photo_url,media:photo_media_id(storage_path)');
    (rows || []).forEach(r => {
      const stored = r.media && r.media.storage_path
        ? CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + r.media.storage_path
        : null;
      /* An approved upload beats a pasted URL: it has been through moderation
         and the consent check, and it is served from our own storage rather
         than whatever host somebody linked to. */
      const url = stored || r.photo_url || null;
      if (url) PHOTOS[r.id] = url;
    });
  } catch (_) { /* initials all round */ }
}

/* A player's face, or their initials. Same rule as the crest: the fallback is
   painted first and the photograph loads on top, so a 404 leaves a portrait
   frame with initials in it rather than a hole in the graphic. */
function faceHTML(p, colour) {
  const url = PHOTOS[p.id];
  const ini = String(p.name || '?').trim().split(/\s+/)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return '<span class="face" style="--tc:' + esc(colour) + '">' +
    '<span class="ini">' + esc(ini) + '</span>' +
    (url ? '<img src="' + esc(url) + '" alt=""  data-fade="hasface">' : '') +
    '</span>';
}

/* One card, two readings of the squad. */
function rosterCard(st, mode) {
  const t = side === 0 ? 0 : 1;
  const T = side === 0 ? st.home : st.away;
  const men = T.roster.length ? T.roster : T.squad;
  if (!men.length) return '';

  const starters = new Set(st.starters[t] || []);
  let list, label;
  if (mode === 'bench') {
    /* A bench is defined by who is NOT starting, so it does not exist until
       somebody has said who is. Showing the squad here instead would be a
       graphic captioned "bench" listing the starting five. */
    if (starters.size < 5) return '';
    list = men.filter(p => !starters.has(p.id));
    label = 'bench';
    if (!list.length) return '';
  } else {
    list = men;
    label = 'squad';
  }

  return '<div class="fivecard" style="--tc:' + esc(T.colour) + '">' +
    railHTML(T, st, label) +
    '<div class="fivebody">' +
      '<div class="fivehead">' +
        '<span class="comp">' + esc(st.game.competition || '') + '</span>' +
        (st.game.tipoff ? '<span class="when">' + esc(st.game.tipoff) + '</span>' : '') +
      '</div>' +
      '<div class="benchrow' + (list.length <= 6 ? ' oneline' : '') + '">' +
        list.slice(0, 12).map(p =>
          '<div class="bp' + (starters.has(p.id) ? ' isstart' : '') + '">' +
            '<div class="bpcut">' + portraitHTML(p, T.colour) +
              '<span class="bpnum">' + esc(p.number || '') + '</span></div>' +
            '<div class="fpname">' +
              '<span class="last">' + esc(shortName(p.name)) + '</span>' +
              vitalsHTML(p) +
            '</div>' +
          '</div>').join('') + '</div>' +
    '</div></div>';
}

/* ONE RAIL, TWO CARDS. The starting five and the bench are the same document
   at different scales, and the rail is what makes that read — writing it twice
   is two places for the league mark, the crest and the club name to drift. */
function railHTML(T, st, label) {
  return '<div class="rail">' +
    '<div class="railtop">' +
      (st.game.leagueLogo
        ? '<img class="lgmark" src="' + esc(st.game.leagueLogo) + '" alt="">'
        : '<span class="lgword">' + esc(st.game.leagueShort || 'EPINOIΛ') + '</span>') +
      '<span class="railrule"></span>' +
      crestHTML(T, 'lg') +
    '</div>' +
    '<div class="railname">' + esc(T.name) + '</div>' +
    '<div class="raillabel">' + esc(label) + '</div>' +
  '</div>';
}

/* Head and shoulders, from the same approved cut-out. A full-body image
   cropped to a square is a chest; object-position pulls the frame up to where
   a face actually is, which is the same trick the profile photographs use. */
function portraitHTML(p, colour) {
  const url = CUTOUTS[p.id] || PHOTOS[p.id] || null;
  const ini = String(p.name || '?').trim().split(/\s+/)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return '<span class="port2' + (CUTOUTS[p.id] ? ' fromcut' : '') +
    '" style="--tc:' + esc(colour) + '">' +
    '<span class="ini">' + esc(ini) + '</span>' +
    (url ? '<img src="' + esc(url) + '" alt="" data-fade="hasface">' : '') +
    '</span>';
}

/* ---- the cut-out, and what stands in for one ----------------------------
   A BROADCAST IMAGE IS NOT A PROFILE PHOTOGRAPH. One is a full-body cut-out
   with the background removed; the other is a head-and-shoulders portrait in a
   circle. Stretching a head shot to the height of a lineup card looks like a
   mistake, so this asks only for kind='broadcast' and falls back to a drawing
   rather than to the wrong picture.

   THE SILHOUETTE IS DELIBERATE AND IT IS DRAWN, NOT AN IMAGE FILE. A lineup
   card where two of the five are missing has to still look like a lineup card:
   a gap reads as a fault, and a grey box reads as a fault that somebody noticed
   and did not fix. A figure in the club's colour reads as a player whose
   photograph has not been taken, which is what it is — and it costs no request,
   so it is already on screen while the real ones are still loading.

   Proportioned as a standing figure rather than the usual head-and-shoulders
   icon, because it stands where a standing figure will stand. */
function silhouetteSVG() {
  /* PRIMITIVES, NOT A HAND-WRITTEN PATH. The first version of this was one
     path through the torso, both arms and both legs, and it came out with a
     single tapering wedge where the legs should be — a figure that reads as a
     mistake, five times, across the front of a lineup card. Six rounded
     rectangles and a circle cannot be got wrong, cost nothing, and are legible
     at the size this is actually seen. */
  return '<svg class="sil" viewBox="0 0 120 300" xmlns="http://www.w3.org/2000/svg" ' +
    'preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
    '<circle cx="60" cy="30" r="22"/>' +
    '<rect x="37" y="56" width="46" height="116" rx="19"/>' +   /* torso   */
    '<rect x="19" y="64" width="15" height="94" rx="7.5"/>' +   /* arm     */
    '<rect x="86" y="64" width="15" height="94" rx="7.5"/>' +   /* arm     */
    '<rect x="41" y="158" width="17" height="142" rx="8.5"/>' + /* leg     */
    '<rect x="62" y="158" width="17" height="142" rx="8.5"/>' + /* leg     */
    '</svg>';
}

/* The cut-out if one has been approved, the figure if not. Same rule as the
   crest and the face: the fallback is painted first and the photograph fades in
   over it, so there is never a frame with nothing in it. */
function cutoutHTML(p, colour) {
  const url = CUTOUTS[p.id];
  return '<span class="cut" style="--tc:' + esc(colour) + '">' +
    silhouetteSVG() +
    (url ? '<img src="' + esc(url) + '" alt=""  data-fade="hascut">' : '') +
    '</span>';
}

/* POSITION, HEIGHT, WEIGHT — the three things a commentator reads off a team
   sheet, in that order, because the position is what they say first.

   ONLY WHAT IS RECORDED. A club that has filled in nothing gets a name and a
   number and no empty row of dashes; a club that has filled in everything gets
   the line. Height is shown in feet and inches as well, because that is the
   unit the game is talked about in even where it is measured in centimetres. */
function vitalsHTML(p) {
  const bits = [];
  if (p.pos) bits.push('<b>' + esc(p.pos) + '</b>');
  if (p.height) bits.push(esc(feetInches(p.height)));
  if (p.weight) bits.push(esc(p.weight + 'kg'));
  return bits.length
    ? '<span class="vitals">' + bits.join('<i>·</i>') + '</span>'
    : '';
}

/* 198cm as 6'6". Rounded to the nearest inch, and rolled up when that rounds to
   twelve — 6'12" is not a height anybody has ever been. */
function feetInches(cm) {
  const total = Math.round(cm / 2.54);
  let ft = Math.floor(total / 12), inch = total % 12;
  if (inch === 12) { ft += 1; inch = 0; }
  return ft + "'" + inch + '"';
}

/* First name for the light line, surname for the heavy one — the two are
   already separated by shortName(), which returns the last word. */
function firstName(n) {
  const parts = String(n || '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
}

/* The five to draw: the recorded starters once a statistician has picked them,
   otherwise the first five of the squad — and the caller is told which, so the
   graphic can label itself honestly rather than claiming a starting five it
   has invented. */
function fiveOf(st, t) {
  const T = t === 0 ? st.home : st.away;
  const ids = st.starters[t] || [];
  const pool = T.roster.length ? T.roster : T.squad;
  if (ids.length >= 5) {
    const byId = {};
    pool.forEach(p => { byId[p.id] = p; });
    const picked = ids.map(id => byId[id]).filter(Boolean);
    if (picked.length >= 5) return picked.slice(0, 5);
  }
  return pool.slice(0, 5);
}

let CUTOUTS = {};      // player id -> approved broadcast image

async function loadCutouts() {
  if (!CFG.supabaseUrl) return;
  try {
    /* One request for both squads — twenty-four round trips before the picture
       appears is the difference between a graphic ready at 19:25 and one ready
       at 19:31, on a laptop in a sports hall. */
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/broadcast_images', {
      method: 'POST', cache: 'no-store',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_game: gameId })
    });
    if (!r.ok) return;                       // an older database has no such function
    (await r.json() || []).forEach(row => {
      if (row.storage_path) {
        CUTOUTS[row.player_id] =
          CFG.supabaseUrl + '/storage/v1/object/public/media-public/' + row.storage_path;
      }
    });
  } catch (_) { /* silhouettes all round, which is a working graphic */ }
}

/* ---- the crest --------------------------------------------------------- */
/* THE CLUB'S OWN BADGE WHERE ITS INITIALS WERE, and the initials underneath it
   the whole time. A crest that 404s in a gallery must leave a badge behind
   rather than an empty square — on a results page that is untidy, on air it is
   a hole in the graphic. The monogram is painted first and the image loads on
   top of it, so there is no moment where the mark is missing. */
function crestHTML(T, cls) {
  const mono = '<span class="mono">' + esc(T.short) + '</span>';
  const img = T.logo
    ? '<img class="crest" src="' + esc(T.logo) + '" alt=""  data-fade="hascrest">'
    : '';
  return '<span class="badge ' + (cls || '') + '" style="--tc:' + esc(T.colour) + '">' +
         mono + img + '</span>';
}

/* Everyone who has played, both sides. A ranked graphic drawn from the five on
   the floor would omit whoever had just been substituted — which is exactly the
   moment a director reaches for "top scorers". */
function squadPool(st) {
  return [].concat(
    st.home.squad.map(p => Object.assign({ T: st.home }, p)),
    st.away.squad.map(p => Object.assign({ T: st.away }, p))
  /* Anybody who has been on the floor, or done anything at all. min > 0 covers
     almost everyone; the rest of the test catches a player subbed on and off
     inside the same minute who still managed a rebound. */
  ).filter(p => p.min > 0 || p.pts || p.reb || p.ast || p.index);
}

const SCENES = {
  /* ---- OFF AIR ----------------------------------------------------------
     A production with twelve browser sources goes clean by hiding all of them.
     A production with ONE cannot: there is no source to hide, only a page to
     change. Without this, the single-source path — the one recommended for
     Wirecast and for every mixer without a control API — could put a graphic
     up and never take it down, which makes it unusable for anything except a
     scorebug that lives on screen all game.

     It renders nothing at all rather than an empty box: a transparent frame
     with a plate in it is still a plate over somebody's camera. */
  blank: () => '',


  /* ---- THE STARTING FIVE, FULL FRAME ------------------------------------
     A different kind of graphic from everything else here. The scorebug and
     the ranked cards are overlays: small, cornered, sat on top of live video.
     This one IS the picture — it fills the frame while the teams are warming
     up and there is nothing to cut to yet.

     So it does not use the plate treatment at all. It is laid out like the
     league's own pages: a ruled left rail carrying the competition and the
     club, then the five, standing.

     WHY THE RAIL. The reference for this is every football lineup card ever
     broadcast, and they all do the same thing — the identity goes in a
     vertical band down one side so the horizontal space belongs entirely to
     the players. Putting a crest above the players instead costs a fifth of
     the height of the tallest thing on screen.

     NUMBERS ABOVE, NAMES BELOW, and the surname carries the weight: it is what
     the commentator says and what is on the back of the shirt. */
  five(st) {
    const T = side === 0 ? st.home : st.away;
    const men = fiveOf(st, side === 0 ? 0 : 1);
    if (!men.length) return '';
    const picked = (st.starters[side === 0 ? 0 : 1] || []).length >= 5;

    return '<div class="fivecard" style="--tc:' + esc(T.colour) + '">' +
      railHTML(T, st, picked ? 'starting five' : 'squad') +

      '<div class="fivebody">' +
        '<div class="fivehead">' +
          '<span class="comp">' + esc(st.game.competition || '') + '</span>' +
          (st.game.tipoff ? '<span class="when">' + esc(st.game.tipoff) + '</span>' : '') +
        '</div>' +
        '<div class="fiverow">' + men.map(p =>
          '<div class="fp">' +
            '<div class="fpnum">' + esc(p.number || '') + '</div>' +
            '<div class="fpcut">' + cutoutHTML(p, T.colour) + '</div>' +
            '<div class="fpname">' +
              '<span class="first">' + esc(firstName(p.name)) + '</span>' +
              '<span class="last">' + esc(shortName(p.name)) + '</span>' +
              vitalsHTML(p) +
            '</div>' +
          '</div>').join('') + '</div>' +
      '</div></div>';
  },

  /* ---- pre-game ----------------------------------------------------------
     ONE TEAM'S SQUAD, WITH FACES. Two of these — side=0 and side=1 — are the
     twenty minutes before tip. Numbers in shirt order, because that is how a
     commentator's notes are laid out and how the crowd will read the shirts. */
  /* ---- THE REST OF THE SQUAD ---------------------------------------------
     THE SAME CARD, AT A DIFFERENT SCALE. This is the graphic that follows the
     starting five, so it has to look like it belongs to it: the same frame, the
     same rail, the same header, the same floor. What changes is the portrait —
     head and shoulders in a rounded frame rather than a full-body cut-out,
     because twelve full-body figures across a 16:9 frame are forty pixels wide
     each and read as a barcode.

     Continuity is the point. A director cutting from the five to the bench
     should be showing the second page of one document, not a second design. */
  /* ---- the squad, and the bench ------------------------------------------
     TWO GRAPHICS, NOT ONE WITH A MOOD. They were the same scene deciding for
     itself whether to filter the starters out, which meant a director pressing
     "bench" before the fives were picked got the whole squad relabelled — a
     graphic that says one thing and shows another.

     So: SQUAD is everyone and always works, which is what a stream needs
     twenty minutes before tip. BENCH is strictly the players who are not
     starting, which is only knowable once somebody has picked the fives, and
     shows nothing until then rather than pretending.

     Both share the frame, the rail, the header and the floor with the starting
     five, because a director cutting between them is turning pages of one
     document rather than changing design. */
  squad(st) { return rosterCard(st, 'squad'); },
  bench(st) { return rosterCard(st, 'bench'); },

  /* BOTH STARTING FIVES, SIDE BY SIDE. The graphic every stream opens with —
     and it adapts rather than lying: until the statistician has picked the
     fives there are none recorded, so it shows the squads and says so. A
     graphic that invented a starting five from the first five shirt numbers
     would be wrong on air perhaps one game in three. */
  starters(st) {
    const picked = (st.starters[0] || []).length && (st.starters[1] || []).length;
    const col = (T, ids) => {
      const men = picked
        ? T.squad.concat(T.roster).filter((p, i, a) =>
            ids.includes(p.id) && a.findIndex(x => x.id === p.id) === i)
        : (T.squad.length ? T.squad : T.roster).slice(0, 5);
      return '<div class="fivecol" style="--tc:' + esc(T.colour) + '">' +
        '<div class="fh">' + crestHTML(T, 'sm') +
          '<span>' + esc(T.short) + '</span></div>' +
        men.slice(0, 5).map(p =>
          '<div class="pl">' + faceHTML(p, T.colour) +
            '<span class="n">' + esc(p.number) + '</span>' +
            '<span class="nm">' + esc(shortName(p.name)) + '</span>' +
          '</div>').join('') + '</div>';
    };
    if (!st.home.squad.length && !st.home.roster.length) return '';
    return '<div class="card five">' +
      '<div class="hd"><span>' + (picked ? 'starting fives' : 'squads') + '</span>' +
      '<i>' + esc(st.game.competition || '') + '</i></div>' +
      '<div class="fives">' + col(st.home, st.starters[0] || []) +
        '<span class="vs">v</span>' + col(st.away, st.starters[1] || []) + '</div></div>';
  },

  /* THE CREW. A federation prints the officials on the scoresheet and a
     broadcast names them before tip; both read the same four fields. Nothing
     is shown for a chair nobody filled in — an empty "commissioner —" row is
     a hole on screen and a question on air. */
  officials(st) {
    const named = OFFICIAL_ROLES.filter(([k]) => st.game.officials[k]);
    if (!named.length) return '';
    const court = named.filter(([k]) =>
      ['referee', 'umpire1', 'umpire2', 'commissioner'].includes(k));
    const table = named.filter(([k]) => !court.includes(k));
    const group = (title, rows) => rows.length
      ? '<div class="ogrp"><div class="ot">' + title + '</div>' +
        rows.map(([k, label]) =>
          '<div class="orow"><span class="r">' + label + '</span>' +
          '<span class="n">' + esc(st.game.officials[k]) + '</span></div>').join('') +
        '</div>'
      : '';
    return '<div class="card offs"><div class="hd"><span>match officials</span>' +
      '<i>' + esc(st.game.venue || st.game.competition || '') + '</i></div>' +
      '<div class="ogrps">' + group('court', court) + group('table', table) + '</div></div>';
  },

  /* THE FIXTURE CARD. What a stream sits on while people are still arriving:
     who, where, when, and how full the hall is expected to be. */
  fixture(st) {
    const side_ = (T) => '<div class="fx1" style="--tc:' + esc(T.colour) + '">' +
      crestHTML(T, 'lg') + '<span class="t">' + esc(T.name) + '</span></div>';
    const bits = [st.game.venue, st.game.tipoff].filter(Boolean);
    return '<div class="card fixcard">' +
      (st.game.competition ? '<div class="lbl">' + esc(st.game.competition) + '</div>' : '') +
      '<div class="row">' + side_(st.home) + '<span class="vs">v</span>' + side_(st.away) + '</div>' +
      (bits.length ? '<div class="meta">' + bits.map(esc).join('<span class="sep">·</span>') +
        '</div>' : '') + '</div>';
  },

  scorebug(st) {
    /* THE LEAGUE'S OWN MARK, ON THE LEFT OF THE BOARD.

       Where a televised game puts the competition badge, and the thing that
       stops a scorebug looking like a generic overlay: this is the Something
       League, not a scoreboard. The logo the league uploaded when it was set
       up, and when there is none, its initials — never a hole, and never a
       placeholder graphic, because a monogram in the right typeface reads as a
       deliberate mark and a broken image reads as a fault.

       Kept OUT of the plate's border rules so it sits against the frame rather
       than inside a box of its own — a badge with a panel behind it is a
       second graphic, and the whole point of this pass is that there is less
       of it. */
    /* Three letters stack into the square; one or two sit across it. A badge
       is a block of letters, not a line of them — "EBL" written along the
       bottom of a 5.4vmin square wastes most of the square and comes out
       smaller than it needs to be. */
    const mark = st.game.leagueLogo
      ? '<span class="lgm"><img src="' + esc(st.game.leagueLogo) + '" alt="" ' +
        'data-fade="haslgm">' + initialsHTML(st.game.leagueInitials) + '</span>'
      : (st.game.leagueInitials
          ? '<span class="lgm">' + initialsHTML(st.game.leagueInitials) + '</span>'
          : '');

    const dots = n => '<span class="dots">' +
      [1,2,3,4,5].map(i => '<i class="dot' + (i <= n ? ' on' : '') + '"></i>').join('') +
      '</span>';
    const sideHTML = (T, t) =>
      '<div class="side ' + (t === 0 ? 'home' : 'away') + '" style="--tc:' + esc(T.colour) + '">' +
        crestHTML(T) +
        '<span class="tag">' + esc(T.short) + '</span>' +
        '<span class="sc">' + figures(T.score) + '</span>' +
      '</div>';

    /* The possession arrow points at the team who has it. A triangle beside the
       clock is what every scoreboard in a hall does, and a viewer reads it
       without being told. */
    const arrow = st.possessionArrow === 0 ? '<i class="arw l"></i>'
                : st.possessionArrow === 1 ? '<i class="arw r"></i>' : '';

    return '<div class="bug">' + mark +
      sideHTML(st.home, 0) +
      '<div class="mid">' + arrow +
        '<span class="clk' + (st.clock.running && !st.clock.final ? ' run' : '') +
          (st.clock.final ? ' fin' : '') + '">' +
          /* FIN is a word, not a readout — the per-character cells exist to
             stop digits shuffling and would only space letters out oddly. */
          (st.clock.final ? 'FIN' : figures(st.clock.display)) + '</span>' +
        '<span class="per' + (st.clock.final ? ' fin' : '') + '">' +
          st.clock.periodLabel + '</span></div>' +
      sideHTML(st.away, 1) +
      '<div class="rail">' +
        '<span class="fl' + (st.home.bonus ? ' bonus' : '') + '">' +
          esc(st.home.short) + dots(st.home.periodFouls) +
          (st.home.bonus ? '<b>bonus</b>' : '') + '</span>' +
        '<span class="fl' + (st.away.bonus ? ' bonus' : '') + '">' +
          esc(st.away.short) + dots(st.away.periodFouls) +
          (st.away.bonus ? '<b>bonus</b>' : '') + '</span>' +
      '</div></div>';
  },

  lower(st) {
    const T = side === 0 ? st.home : st.away;
    const pick = wantPid
      ? T.onCourt.find(p => p.id === wantPid)
      : T.onCourt.slice().sort((a, b) => b.pts - a.pts)[0];
    if (!pick) return '';
    return '<div class="card l3" style="--tc:' + esc(T.colour) + '">' +
      '<div class="bar"></div>' +
      '<div class="who">' + crestHTML(T, 'sm') +
        '<span class="num">' + esc(pick.number) + '</span>' +
        '<span class="nm">' + esc(pick.name) + '</span>' +
        '<span class="tm">' + esc(T.name) + '</span></div>' +
      '<div class="line">' +
        ['pts','reb','ast'].map(k =>
          '<span class="st"><b>' + pick[k] + '</b><i>' + k + '</i></span>').join('') +
        '<span class="st"><b>' + pick.fg + '</b><i>fg</i></span>' +
        '<span class="st"><b>' + pick.tp + '</b><i>3pt</i></span>' +
      '</div></div>';
  },

  /* ---- the ones a director actually calls for ------------------------------
     A scorebug lives on screen all game. These are the graphics somebody takes
     during a stoppage, so each answers ONE question and answers it in the four
     seconds it will be on air. Five rows, never more: a table of twelve is a
     web page somebody pointed a camera at. */
  scorers(st) {
    const all = squadPool(st);
    return rankCard('top scorers', all.sort((a, b) => b.pts - a.pts).slice(0, 5),
      p => p.pts, 'pts');
  },

  plusminus(st) {
    const all = squadPool(st);
    return rankCard('plus / minus', all.sort((a, b) => b.pm - a.pm).slice(0, 5),
      p => (p.pm > 0 ? '+' : '') + p.pm, '+/-', true);
  },

  rebounds(st) {
    const all = squadPool(st);
    return rankCard('rebounds', all.sort((a, b) => b.reb - a.reb).slice(0, 5),
      p => p.reb, 'reb');
  },

  assists(st) {
    const all = squadPool(st);
    return rankCard('assists', all.sort((a, b) => b.ast - a.ast).slice(0, 5),
      p => p.ast, 'ast');
  },

  /* Signed, because an Index can be negative and hiding that would be the one
     dishonest thing this graphic could do — a bad night is exactly what the
     number is for. */
  index(st) {
    const all = squadPool(st);
    return rankCard('index', all.sort((a, b) => b.index - a.index).slice(0, 5),
      p => (p.index > 0 ? '+' : '') + p.index, 'idx', true);
  },

  /* The best five-man units, by net rating over the minutes they have played.
     Filtered by minutes on purpose: a lineup that has been on the floor for
     forty seconds and happens to be +6 is not a story, it is noise with a big
     number attached, and putting it on air is how a graphic loses its
     credibility with the people who know the game. */
  lineups(st) {
    const rows = st.lineups.slice(0, 4);
    if (!rows.length) return '';
    return '<div class="card rank wide"><div class="hd"><span>best lineups</span>' +
      '<i>' + LINEUP_MIN + '+ minutes together</i></div>' +
      rows.map(l =>
        '<div class="lu" style="--tc:' + esc(l.colour) + '">' +
          '<span class="who">' + l.names.map(n =>
            '<span class="p">' + esc(n) + '</span>').join('') + '</span>' +
          '<span class="mins">' + l.min + " min" + '</span>' +
          '<span class="net' + (l.pm >= 0 ? ' up' : ' down') + '">' +
            (l.pm > 0 ? '+' : '') + l.pm + '</span>' +
        '</div>').join('') + '</div>';
  },

  compare(st) {
    const rows = [
      ['points',   st.home.score,       st.away.score],
      ['rebounds', st.home.totals.reb,  st.away.totals.reb],
      ['assists',  st.home.totals.ast,  st.away.totals.ast],
      ['turnovers',st.home.totals.to,   st.away.totals.to],
      ['fouls',    st.home.periodFouls, st.away.periodFouls]
    ];
    return '<div class="card cmp">' +
      '<div class="hd"><span>' + crestHTML(st.home, 'sm') + esc(st.home.short) + '</span>' +
        '<i>team comparison</i>' +
        '<span>' + esc(st.away.short) + crestHTML(st.away, 'sm') + '</span></div>' +
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
    const won = st.home.score === st.away.score ? null
              : (st.home.score > st.away.score ? 0 : 1);
    const sideHTML = (T, t) => '<div class="fs' + (won === t ? ' won' : '') +
      '" style="--tc:' + esc(T.colour) + '">' + crestHTML(T, 'lg') +
      '<span class="t">' + esc(T.name) + '</span>' +
      '<span class="s">' + T.score + '</span></div>';
    return '<div class="card fin"><div class="lbl">' +
      (st.game.status === 'final' ? 'Final' : st.clock.periodLabel) + '</div>' +
      '<div class="row">' + sideHTML(st.home, 0) +
        '<span class="vs">v</span>' + sideHTML(st.away, 1) + '</div>' +
      (st.game.competition ? '<div class="comp">' + esc(st.game.competition) + '</div>' : '') +
      '</div>';
  }
};

/* One shape for every ranked graphic: crest, number, name, value. Written once
   because five near-identical scenes are five places for the design to drift. */
function rankCard(title, rows, val, unit, signed) {
  if (!rows.length) return '';
  const top = Math.max(1, Math.abs(Number(val(rows[0]))) || 1);
  return '<div class="card rank"><div class="hd"><span>' + title + '</span>' +
    '<i>' + unit + '</i></div>' +
    rows.map(p => {
      const v = val(p);
      const n = Math.abs(parseFloat(String(v))) || 0;
      return '<div class="rr" style="--tc:' + esc(p.T.colour) + '">' +
        crestHTML(p.T, 'sm') +
        '<span class="num">' + esc(p.number) + '</span>' +
        '<span class="nm">' + esc(p.name) + '</span>' +
        '<span class="bar"><i style="width:' + Math.round(100 * n / top) + '%"></i></span>' +
        '<span class="v' + (signed && parseFloat(String(v)) < 0 ? ' down' : '') + '">' +
          v + '</span></div>';
    }).join('') + '</div>';
}

/* ---- ONE ENTRANCE, NOT SEVERAL -------------------------------------------
   The graphic used to appear the moment the fixture row landed and then fill
   in: text first, then the squad, then the crests, then the portraits, each
   fading in as its request came back. On a web page that reads as loading. On
   air it reads as a fault — a caption assembling itself in front of an
   audience — and it is the sort of thing a director will not use twice.

   So nothing is shown until every request a scene depends on has come back.
   The page still RENDERS throughout, so the layout is settled and the fonts
   are resolved before anybody sees it; it is only revealed at the end.

   AND IT IS REVEALED REGARDLESS after a moment. A graphic that waits for ever
   on a slow photograph is worse than one that shows initials: the deadline is
   what turns "nothing appeared" into "one face is a monogram". */
let settled = false;
const REVEAL_MAX_MS = 2500;

function reveal() {
  if (settled) return;
  settled = true;
  lastJSON = '';                 // force one final paint, then show it
  render();
  stage.dataset.ready = '1';
}

/* ---- FIGURES THAT DO NOT MOVE ------------------------------------------
   The scorebug is set in Jersey, the face this platform uses for scores and
   headings everywhere else. It is a jersey-numeral face, which is exactly
   right for a scoreboard and carries one problem measured rather than assumed:
   ITS DIGITS ARE NOT THE SAME WIDTH. At 100px its "1" advances 31.7 and its
   "2" advances 48.8 — a third narrower.

   On a score that is fine; it changes every couple of minutes and sits in a
   centred box. On a CLOCK it is not: 8:31 to 8:30 would rewrap the whole
   readout, and a clock that shakes once a second is the first thing a director
   notices and the last thing they forgive. font-variant-numeric cannot help,
   because a face without tabular figures has none to switch to.

   So each character gets its own fixed box and is centred in it. That is what
   a real scoreboard does — every digit occupies a cell — and it means the
   readout is rigid whatever is in it.

   The separators get a narrower cell of their own: a colon given a digit's
   width leaves a visible hole either side of it. */
function figures(text) {
  return String(text == null ? '' : text).split('').map(ch =>
    /[0-9]/.test(ch)
      ? '<span class="fg">' + ch + '</span>'
      : '<span class="fg sep">' + esc(ch) + '</span>').join('');
}

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
    wireFades();
    if (settled) stage.dataset.ready = '1';
  }
  if (document.body.classList.contains('debug')) {
    diag.textContent = [
      'scene ' + scene, 'transport ' + (sub ? sub.transport : 'static'),
      'status ' + (sub ? sub.status : '—'), st.clock.periodLabel + ' ' + st.clock.display,
      st.home.short + ' ' + st.home.score + '–' + st.away.score + ' ' + st.away.short
    ].join('  ·  ');
  }
}

/* ---- the control room ---------------------------------------------------- */
/* rt.js, not the SDK: this is a receiver and rt.js is 4kB against 212. The
   control page is the only end that speaks.

   A scene change repaints immediately rather than waiting for the next state
   tick, because the gap between a director pressing take and the graphic
   appearing is the gap between it landing on the replay and landing after it. */
function listenForScenes() {
  if (!LIVE_SCENE || !CFG.supabaseUrl || !window.EpinoiaRT) return;
  try {
    const rt = window.EpinoiaRT.create({
      url: CFG.supabaseUrl.replace(/^http/, 'ws') + '/realtime/v1/websocket',
      key: CFG.supabaseAnonKey,
      WebSocket: window.WebSocket
    });
    rt.watch('bcast:' + gameId, (frame, event) => {
      if (event !== 'scene' || !frame || !frame.scene) return;
      if (!SCENES[frame.scene]) return;        // an unknown name leaves air alone
      scene = frame.scene;
      /* WHICH TEAM, which this never read. The control room has always sent it
         — two squad tiles are one scene with a different side — so a single
         source could be switched to the away five and would draw the home one.
         With twelve sources the mixer chose; with one, this is the only
         place the choice can land. */
      if (frame.side != null) side = String(frame.side) === '1' ? 1 : 0;
      if (frame.pos && POSITIONS.includes(frame.pos)) {
        stage.className = 'pos-' + frame.pos + (qp.get('safe') === '0' ? ' nosafe' : '');
      }
      if (frame.scale && isFinite(+frame.scale) && +frame.scale > 0) {
        document.documentElement.style.setProperty('--u', (+frame.scale) + 'vmin');
      }
      lastJSON = '';                           // force the repaint
      render();
    });
  } catch (_) { /* the layer keeps showing whatever it had */ }
}

/* THE FADE-IN IS WIRED HERE, NOT IN AN onload ATTRIBUTE.

   It was an inline handler, and this page sets script-src 'self' — so the
   browser refused to run it and every crest, every face and every cut-out
   stayed at opacity 0 behind its fallback. NOTHING LOOKED BROKEN: the monogram
   and the silhouette are the fallbacks, so each graphic rendered perfectly and
   simply never showed a photograph. It survived testing because the way to
   check the CSS is to add the class by hand, which is exactly what hides this.

   Doing it in script also fixes a second fault the attribute always had: a
   cached image is already complete before a handler can attach, so its load
   event never fires at all. Both cases are covered below. */
function wireFades() {
  stage.querySelectorAll('img[data-fade]').forEach(img => {
    const mark = () => { if (img.parentNode) img.parentNode.classList.add(img.dataset.fade); };
    if (img.complete && img.naturalWidth) mark();
    else img.addEventListener('load', mark, { once: true });
    /* a picture that 404s never marks, so the fallback stays — the point */
  });
}

/* ---- keeping up with the scorer, before a ball is thrown -----------------
   THE LIVE FEED CARRIES EVENTS, AND BEFORE TIP THERE ARE NONE.

   Everything the in-play graphics need arrives as game_events over a socket.
   Everything the PRE-GAME graphics need — the squads, the starting fives, the
   officials, the venue — is columns on the fixture row, which no event ever
   touches. So a director with the lineup card up watched the statistician pick
   the fives in the next seat and the graphic did not move.

   A poll, not a subscription, and deliberately: this is a handful of fields
   changing a handful of times in the half-hour before a game, and a Postgres
   change-feed subscription for that is machinery to maintain for the rest of
   the season. Eight seconds is well inside the time it takes anybody to walk
   from the scorer's table to the camera.

   It stops the moment the game is live, because from then on the event stream
   is both faster and complete. */
function watchPregame() {
  if (!gameId || !CFG.supabaseUrl) return;
  if (game.status === 'live' || game.status === 'final') return;

  const tick = async () => {
    if (!game || game.status === 'live' || game.status === 'final') {
      clearInterval(timer);
      return;
    }
    try {
      const rows = await api('games?id=eq.' + encodeURIComponent(gameId) +
        '&select=status,period,starters,roster_snapshot,venue,tipoff_at&limit=1');
      if (!rows.length) return;
      const g = rows[0];

      /* Only rebuild when something actually moved: replacing the squad on
         every tick would restart every portrait's fade-in, so the faces would
         blink at the audience every eight seconds. */
      const before = JSON.stringify([game.starters, S.teams.map(t => t.players.length)]);
      let touched = false;

      if (JSON.stringify(g.starters) !== JSON.stringify(game.starters)) {
        game.starters = g.starters;
        S.starters = g.starters || [[], []];
        touched = true;
      }
      if (g.roster_snapshot && g.roster_snapshot.teams &&
          JSON.stringify(g.roster_snapshot) !== JSON.stringify(game.roster_snapshot)) {
        game.roster_snapshot = g.roster_snapshot;
        S.teams = g.roster_snapshot.teams;
        await mergeMeasurements();
        await Promise.all([loadPhotos(), loadCutouts()]);
        touched = true;
      }
      if (g.status && g.status !== game.status) { game.status = g.status; touched = true; }
      if (g.venue !== game.venue) { game.venue = g.venue; touched = true; }

      /* the optional columns, still separately, still allowed to be absent */
      try {
        const extra = await api('games?id=eq.' + encodeURIComponent(gameId) +
          '&select=attendance,capacity,officials&limit=1');
        if (extra.length && JSON.stringify(extra[0]) !==
            JSON.stringify({ attendance: game.attendance, capacity: game.capacity,
                             officials: game.officials })) {
          Object.assign(game, extra[0]);
          touched = true;
        }
      } catch (_) { /* a database without 0076 simply has none */ }

      if (touched || before !== JSON.stringify([game.starters, S.teams.map(t => t.players.length)])) {
        lastJSON = '';
        render();
      }
    } catch (_) { /* the graphic keeps showing what it had */ }
  };

  const timer = setInterval(tick, 8000);
  tick();
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
    settled = true; stage.dataset.ready = '1';
    return;
  }
  if (!CFG.supabaseUrl) return;

  try {
    /* THE OPTIONAL COLUMNS ARE ASKED FOR SEPARATELY, and their absence is not
       an error. attendance and capacity arrived in a later migration, and a
       graphics layer that goes black because a column it does not need is
       missing is the worst possible way to discover a deployment is behind.
       Score, clock and fouls are the graphic; everything else is garnish. */
    const CORE = 'id,status,period,home_score,away_score,venue,tipoff_at,' +
      'home_team_id,away_team_id,roster_snapshot,starters,tip_winner,arrow_init,' +
      'home:home_team_id(name,short_name,colour,logo_path),' +
      'away:away_team_id(name,short_name,colour,logo_path),' +
      'competitions(name,seasons(name,leagues(name,logo_path)))';
    const gs = await api('games?id=eq.' + encodeURIComponent(gameId) +
      '&select=' + CORE + '&limit=1');
    if (!gs.length) return;
    game = gs[0];

    try {
      const extra = await api('games?id=eq.' + encodeURIComponent(gameId) +
        '&select=attendance,capacity,officials&limit=1');
      if (extra.length) Object.assign(game, extra[0]);
    } catch (_) { /* an older database simply has none of these */ }

    /* THE LEAGUE'S OWN BADGE LETTERS — asked for separately, and for exactly
       the reason written above CORE. leagues.initials arrives in migration
       0087, and a graphics layer that goes black on a database one migration
       behind is the worst possible way to find that out. Without it the badge
       derives its letters from the name, which is what it did before. */
    try {
      const lg = await api('games?id=eq.' + encodeURIComponent(gameId) +
        '&select=competitions(seasons(leagues(initials)))&limit=1');
      const got = (((lg[0] || {}).competitions || {}).seasons || {}).leagues || {};
      if (got.initials && game.competitions && game.competitions.seasons &&
          game.competitions.seasons.leagues) {
        game.competitions.seasons.leagues.initials = got.initials;
      }
    } catch (_) { /* pre-0087: the name still gives us letters */ }

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
    listenForScenes();
    watchPregame();

    /* Squads and faces are what the pre-game graphics are made of, and neither
       is needed to draw a scorebug — so they load after the first paint and
       the layer repaints when they arrive. A stream that is already on air
       gets its scorebug immediately either way. */
    /* Everything a pre-game scene needs, then one entrance. render() is called
       throughout so the layout and the fonts are settled before the reveal —
       what is deferred is only the moment it becomes visible. */
    const ready = loadRosters()
      .then(() => { lastJSON = ''; render(); return Promise.all([loadPhotos(), loadCutouts()]); })
      .then(() => { lastJSON = ''; render(); })
      .catch(() => {});
    /* whichever comes first: everything, or the deadline */
    Promise.race([ready, new Promise(r => setTimeout(r, REVEAL_MAX_MS))]).then(reveal);

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
      settled = true; stage.dataset.ready = '1';
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
