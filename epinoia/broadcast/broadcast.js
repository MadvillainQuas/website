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
        id: p.id, number: p.num || '', name: p.name || '', pos: p.pos || '',
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
      tipoff: tipoffLabel()
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
  /* the snapshot is the truth once it exists */
  if (game.roster_snapshot && game.roster_snapshot.teams) return;
  const ids = [game.home_team_id, game.away_team_id].filter(Boolean);
  if (!ids.length) return;
  try {
    const re = await api('roster_entries?team_id=in.(' + ids.join(',') + ')' +
      '&active=eq.true&select=team_id,jersey,position,players(id,first_name,last_name)');
    [game.home_team_id, game.away_team_id].forEach((tid, t) => {
      const list = (re || [])
        .filter(r => r.team_id === tid && r.players)     // a withheld minor comes back null
        .map(r => ({
          id: r.players.id,
          name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim(),
          num: String(r.jersey || ''),
          pos: r.position || ''
        }))
        .sort((a, b) => (+a.num || 99) - (+b.num || 99));
      if (list.length) S.teams[t].players = list;
    });
  } catch (_) { /* a graphic with no squad shows no squad, and says so */ }
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
    (url ? '<img src="' + esc(url) + '" alt="" ' +
           'onload="this.parentNode.classList.add(\'hasface\')">' : '') +
    '</span>';
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
    ? '<img class="crest" src="' + esc(T.logo) + '" alt="" ' +
      'onload="this.parentNode.classList.add(\'hascrest\')">'
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
  ).filter(p => p.min > 0 || p.pts || p.reb || p.ast);
}

const SCENES = {
  /* ---- pre-game ----------------------------------------------------------
     ONE TEAM'S SQUAD, WITH FACES. Two of these — side=0 and side=1 — are the
     twenty minutes before tip. Numbers in shirt order, because that is how a
     commentator's notes are laid out and how the crowd will read the shirts. */
  lineup(st) {
    const T = side === 0 ? st.home : st.away;
    const men = T.squad.length ? T.squad : T.roster;
    if (!men.length) return '';
    const starters = new Set(st.starters[side === 0 ? 0 : 1] || []);
    return '<div class="card sq" style="--tc:' + esc(T.colour) + '">' +
      '<div class="sqhd">' + crestHTML(T, 'lg') +
        '<span class="nm">' + esc(T.name) + '</span>' +
        '<span class="lbl">' + (starters.size ? 'squad' : 'squad') + '</span></div>' +
      '<div class="sqgrid">' + men.slice(0, 14).map(p =>
        '<div class="pl' + (starters.has(p.id) ? ' start' : '') + '">' +
          faceHTML(p, T.colour) +
          '<span class="n">' + esc(p.number) + '</span>' +
          '<span class="nm">' + esc(shortName(p.name)) + '</span>' +
        '</div>').join('') + '</div></div>';
  },

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
    const dots = n => '<span class="dots">' +
      [1,2,3,4,5].map(i => '<i class="dot' + (i <= n ? ' on' : '') + '"></i>').join('') +
      '</span>';
    const sideHTML = (T, t) =>
      '<div class="side ' + (t === 0 ? 'home' : 'away') + '" style="--tc:' + esc(T.colour) + '">' +
        crestHTML(T) +
        '<span class="tag">' + esc(T.short) + '</span>' +
        '<span class="sc">' + T.score + '</span>' +
      '</div>';

    /* The possession arrow points at the team who has it. A triangle beside the
       clock is what every scoreboard in a hall does, and a viewer reads it
       without being told. */
    const arrow = st.possessionArrow === 0 ? '<i class="arw l"></i>'
                : st.possessionArrow === 1 ? '<i class="arw r"></i>' : '';

    return '<div class="bug">' +
      sideHTML(st.home, 0) +
      '<div class="mid">' + arrow +
        '<span class="clk' + (st.clock.running ? ' run' : '') + '">' + st.clock.display + '</span>' +
        '<span class="per">' + st.clock.periodLabel + '</span></div>' +
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
      if (frame.pos && POSITIONS.includes(frame.pos)) {
        stage.className = 'pos-' + frame.pos + (qp.get('safe') === '0' ? ' nosafe' : '');
      }
      lastJSON = '';                           // force the repaint
      render();
    });
  } catch (_) { /* the layer keeps showing whatever it had */ }
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
    const CORE = 'id,status,period,home_score,away_score,venue,tipoff_at,' +
      'home_team_id,away_team_id,roster_snapshot,starters,tip_winner,arrow_init,' +
      'home:home_team_id(name,short_name,colour,logo_path),' +
      'away:away_team_id(name,short_name,colour,logo_path),' +
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
    listenForScenes();

    /* Squads and faces are what the pre-game graphics are made of, and neither
       is needed to draw a scorebug — so they load after the first paint and
       the layer repaints when they arrive. A stream that is already on air
       gets its scorebug immediately either way. */
    loadRosters()
      .then(() => { lastJSON = ''; render(); return loadPhotos(); })
      .then(() => { lastJSON = ''; render(); });

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
