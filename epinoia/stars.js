'use strict';
/* ============================================================================
   EPINOIA STARS — who has actually been playing well lately, by BPM over a
   window. One module for the league front page (home.js) and for HOME's best
   performing players across every league (home/stars-home.js).

   BPM rather than points because points reward volume and a star section that
   is really a shot-attempt leaderboard is worse than no star section. BPM asks
   what a player added per 100 possessions and is adjusted to how their team
   actually performed, which is as close as a box score gets to the question.

   MOVED, NOT REWRITTEN. The windows, the eligibility rule, the card and the
   top-10 toggle are home.js's, lifted as they were; the league page's output is
   held identical by supabase/tests/stars.test.mjs against rows and markup saved
   from the page before the move (fixtures/stars-bcb.json).

   PER LEAGUE, THEN MERGED. Players belong to no league and a team's BPM
   adjustment and the league offensive rating are only right inside one league,
   so the rows are split by league before season.js aggregates them. A player
   who qualifies in two leagues appears once, with his best row and its league.

   Needs season.js and bpm.js (the arithmetic) and, to fetch, data.js; the card
   uses teamcolour.js when it is on the page.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStars = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* THE WINDOW IS ANCHORED TO THE LAST GAME PLAYED, not to today. A league that
   last played in April should show April's stars in May, rather than an empty
   panel that looks broken — and the heading says which dates it covers so the
   reader is never guessing how fresh it is.

   A MINIMUM IS ENFORCED and stated. BPM over one quiet half is noise, and a
   podium built from noise is worse than an empty one, so a week needs a game
   and twenty minutes, a month two games and sixty. */
const WINDOWS = [
  { key: 'month', label: 'Monthly stars', days: 30, minGames: 2, minMinutes: 60 },
  { key: 'week',  label: 'Weekly stars',  days: 7,  minGames: 1, minMinutes: 20 }
];

const dayMs = 86400000;
const shortDate = iso => { try { return new Date(iso).toLocaleDateString('en-GB',
  { day: 'numeric', month: 'short' }); } catch (_) { return ''; } };

/* ONLY THE BOX-SCORE KEYS THE STARS READ. A player line's stats JSON has 32 keys
   (the advanced block, the situations, the on-court context); BPM and the card
   need these fifteen, and picking them out by JSON path cut the month's payload
   from 827 kB to 212 kB, measured. A team line keeps its adv block, which is where
   the possessions and minutes BPM's team adjustment needs live, and the three
   top-level counts teamLine falls back on. The test proves the trimmed rows give
   the same numbers as the whole ones. */
const PLAYER_KEYS = ['min', 'pts', 'p2m', 'p2a', 'p3m', 'p3a', 'ftm', 'fta',
  'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf'];
const TEAM_KEYS = ['adv', 'pts', 'toTot', 'foulTot'];
/* aliased with s_, because `or` and `to` are PostgREST words and a column that
   shares a name with the row's own fields would be a trap */
const PLAYER_SEL = 'game_id,player_uuid,player_id,team_idx,' +
  PLAYER_KEYS.map(k => 's_' + k + ':stats->' + k).join(',');
const TEAM_SEL = 'game_id,team_idx,' + TEAM_KEYS.map(k => 's_' + k + ':stats->' + k).join(',');

/* folds the aliased columns back into the {stats:{…}} shape season.js reads;
   a key the line does not have comes back null, and is left out as it would be */
function unpick(row, keys) {
  const out = {}, stats = {};
  Object.keys(row).forEach(k => { if (k.slice(0, 2) !== 's_') out[k] = row[k]; });
  keys.forEach(k => { const v = row['s_' + k]; if (v != null) stats[k] = v; });
  out.stats = stats;
  return out;
}

const chunk40 = ids => { const c = []; for (let i = 0; i < ids.length; i += 40) c.push(ids.slice(i, i + 40)); return c; };

/* Box scores for a set of games, in chunks of 40 so the in.() filter cannot
   outgrow a URL. Through data.js, so a busy service is retried and a member's
   token rides along exactly as it does for the season tables. */
async function boxScores(gameIds) {
  const D = root.EpinoiaData;
  const ids = (gameIds || []).filter(Boolean);
  if (!ids.length) return { pgs: [], tgs: [] };
  const chunks = chunk40(ids);
  const [pParts, tParts] = await Promise.all([
    Promise.all(chunks.map(c => D.all('player_game_stats?game_id=in.(' + c.join(',') + ')&select=' + PLAYER_SEL))),
    Promise.all(chunks.map(c => D.all('team_game_stats?game_id=in.(' + c.join(',') + ')&select=' + TEAM_SEL)))
  ]);
  return {
    pgs: pParts.flat().map(r => unpick(r, PLAYER_KEYS)),
    tgs: tParts.flat().map(r => unpick(r, TEAM_KEYS))
  };
}

/* ------------------------------------------------------------- the maths ---
   computeWindow(pgs, tgs, games, {leagueOf})

   The aggregation data.js statsForGames runs, over the rows whose game is in
   `games` — so a week can be cut from a month's rows without asking the server
   again. With leagueOf(game) the games, and the rows with them, are split by
   league first and each league is aggregated on its own; every player row is
   tagged with its league as `_league`. Without it the games are one league,
   which is the league page. */
function computeWindow(pgs, tgs, games, opts) {
  const S = root.EpinoiaSeason;
  const leagueOf = opts && typeof opts.leagueOf === 'function' ? opts.leagueOf : null;
  const parts = new Map();                     // league key -> {league, byId, pgs, tgs}
  const partOf = new Map();                    // game id -> part
  (games || []).forEach(g => {
    if (!g || !g.id) return;
    const lg = leagueOf ? leagueOf(g) : null;
    if (leagueOf && !lg) return;               // a game in no league belongs to no podium
    const key = lg ? (lg.id || lg.slug || '') : '';
    if (!parts.has(key)) parts.set(key, { league: lg, byId: {}, pgs: [], tgs: [] });
    const P = parts.get(key);
    P.byId[g.id] = g;
    partOf.set(g.id, P);
  });
  (pgs || []).forEach(r => { const P = partOf.get(r.game_id); if (P) P.pgs.push(r); });
  (tgs || []).forEach(r => { const P = partOf.get(r.game_id); if (P) P.tgs.push(r); });

  const players = [];
  const teamOfPlayer = new Map();
  parts.forEach(P => {
    const rows = S.players(P.pgs, P.tgs);
    const teamRows = S.teams(P.tgs, P.byId);
    const teamOf = new Map();
    P.pgs.forEach(r => {
      const g = P.byId[r.game_id];
      const pid = r.player_uuid || r.player_id;
      if (!g || !pid) return;
      teamOf.set(pid, r.team_idx === 0 ? g.home_team_id : g.away_team_id);
    });
    S.attachBPM(rows, teamRows, teamOf);
    rows.forEach(p => { if (P.league) p._league = P.league; players.push(p); });
    teamOf.forEach((v, k) => teamOfPlayer.set(k, v));
  });
  return { players, teamOfPlayer };
}

/* THE PODIUM'S RULE: BPM known, the window's minimum met, best first, each
   player once (his best row, when he qualifies in two leagues), n of them. */
function pick(rows, w, n) {
  const seen = new Set();
  return (rows || [])
    .filter(p => p.bpm != null && (p.gp || 0) >= w.minGames && (p.min || 0) >= w.minMinutes)
    .sort((a, b) => b.bpm - a.bpm)
    .filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .slice(0, n == null ? 10 : n);
}

/* "5 Sept – 13 Sept", from games newest first */
function span(gamesDesc) {
  if (!gamesDesc || !gamesDesc.length) return '';
  return shortDate(gamesDesc[gamesDesc.length - 1].tipoff_at) + ' – ' + shortDate(gamesDesc[0].tipoff_at);
}

/* ------------------------------------------------------------- the card --- */
function el(t, c, x) {
  const n = root.document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n;
}

/* the card in the club's two colours, with text-safe inks (teamcolour.js); the one-colour
   fallback when the helper is not on the page */
function paintCard(a, colour, colour2) {
  const TC = root.EpinoiaTeamColour;
  if (TC && TC.card) TC.card(a, colour || '#93f2bf', colour2);
  else a.style.setProperty('--ink-c', colour || '#93f2bf');
}

/* The initials come from the club's short name where it has one, because that
   is what the club calls itself, and are derived only as a fallback. */
function monogram(t) {
  const s = (t.short_name || '').trim();
  if (s) return s.slice(0, 3).toUpperCase();
  const words = (t.name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (t.name || '?').slice(0, 2).toUpperCase();
}

/* A LEAGUE'S NAME AT CARD SIZE. "British Championship Basketball" does not fit
   under a player's name on a 136px card, and there is no short-name column, so a
   long name goes by its initials (BCB, SLB) and the full name stays in the
   card's label for a screen reader. */
function leagueShort(l) {
  const name = String((l && (l.name || l.slug)) || '').trim();
  if (name.length <= 14) return name;
  const words = name.split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  return words.length >= 2 ? words.map(w => w[0]).join('').toUpperCase() : name;
}

/* the club: the row's own team map (a Map on the league page, a plain object in
   HOME's cached rows), found through the player's side in these games */
function teamFor(r, p) {
  const tid = (r.teamOf && typeof r.teamOf.get === 'function' ? r.teamOf.get(p.id) : null) || p._teamId;
  const T = r.teamsById;
  if (!T || tid == null) return undefined;
  return typeof T.get === 'function' ? T.get(tid) : T[tid];
}

/* One star card: rank as the mark, BPM across the band, name and club below. `small` is the
   size ranks four to ten are drawn at under the podium. opts.base is the path from the page to
   /epinoia/ ('' on the league page, '../' on HOME); opts.league adds the league to the club
   line, 'Club · League'. */
function card(r, p, i, small, opts) {
      const o = opts || {};
      const league = o.league || null;
      const m = r.meta[p.id] || {};
      const team = teamFor(r, p) || {};
      const ink = team.colour || m.colour || '#93f2bf';

      const a = el('a', 'club star' + (small ? ' small' : ''));
      a.href = (o.base || '') + 'p/?p=' + encodeURIComponent(m.slug || '');
      paintCard(a, ink, team.colour_2);
      a.setAttribute('aria-label', (m.name || 'Player') + ', ' + (team.name || '') +
        (league ? ', ' + (league.name || league.slug || '') : ''));

      const plate = el('div', 'club-plate');
      plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
      ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

      /* the rank is the mark, printed like the club monogram */
      const mark = el('div', 'club-mark');
      const rank = String(i + 1);
      mark.append(el('span', 'club-mono ghost', rank), el('span', 'club-mono', rank));
      plate.appendChild(mark);

      /* BPM across the band, because it is why this player is on the podium */
      const band = el('div', 'club-band');
      band.appendChild(el('span', null,
        (p.bpm > 0 ? '+' : '') + Number(p.bpm).toFixed(1) + ' BPM'));
      plate.appendChild(band);
      plate.appendChild(el('div', 'club-grain'));

      const foot = el('div', 'club-foot star-foot');
      const who = el('div', 'star-who');
      const club = team.name || m.teamFull || '';
      who.append(el('span', 'star-name', m.name || 'Player'),
                 el('span', 'star-team', league
                   ? (club ? club + ' · ' : '') + leagueShort(league)
                   : club));
      foot.appendChild(who);
      foot.appendChild(el('span', 'club-ed',
        (p.ppg != null ? p.ppg + 'p' : '') +
        (p.rpg != null ? ' ' + p.rpg + 'r' : '') +
        (p.apg != null ? ' ' + p.apg + 'a' : '')));

      a.append(plate, foot);
      return a;
}

/* ------------------------------------------------------------ the rows ---
   render(host, rows, {base}): each row is { w, top, meta, teamOf?, teamsById,
   games, span, leagues? } and draws a head, the podium, and ranks four to ten
   behind the toggle. Replaces whatever the host held. */
function render(host, rows, opts) {
  const o = opts || {};
  host.textContent = '';

  rows.forEach(r => {
    const head = el('div', 'starrow-h');
    head.append(el('span', 'starrow-t', r.w.label.toUpperCase()),
                el('span', 'starrow-s', r.span + ' · ' + r.games +
                   (r.games === 1 ? ' game' : ' games') +
                   (r.leagues > 1 ? ' · ' + r.leagues + ' leagues' : '') +
                   ' · min ' + r.w.minGames + 'g/' + r.w.minMinutes + 'min'));
    /* THE PODIUM OPENS TO A TOP TEN. The three cards are the glance; the head row, or the
       button on it, opens the rest of the list underneath -- rank, name, club, BPM and the
       line -- and closes it again. */
    const more = r.top.length > 3;
    const xb = el('button', 'starrow-x', 'top 10');
    xb.type = 'button'; xb.setAttribute('aria-expanded', 'false');
    if (more) head.appendChild(xb);
    host.appendChild(head);

    const cardOpts = p => ({ base: o.base || '', league: p._league || null });
    const grid = el('div', 'stargrid');
    r.top.slice(0, 3).forEach((p, i) => grid.appendChild(card(r, p, i, false, cardOpts(p))));
    host.appendChild(grid);


    if (more) {
      /* ranks four to ten: the same card, smaller, under the podium. Hidden by the attribute
         and by a rule that says so (a class with display:grid beats [hidden] on its own,
         which is how the list once refused to close). */
      const list = el('div', 'stargrid starmore'); list.hidden = true;
      r.top.slice(3).forEach((p, i) => list.appendChild(card(r, p, i + 3, true, cardOpts(p))));
      host.appendChild(list);
      const toggle = () => {
        const open = list.hidden;
        list.hidden = !open;
        head.classList.toggle('open', open);
        xb.setAttribute('aria-expanded', String(open));
        xb.textContent = open ? 'top 3' : 'top 10';
      };
      head.classList.add('can-open');
      head.addEventListener('click', toggle);
    }
  });
}

/* ------------------------------------------------------ across leagues ---
   global({base, now}) -> {week, month, anchor}, for HOME.

   THE ANCHOR IS THE LATEST FINAL IN ANY LEAGUE, at or before now, so "weekly"
   means the same week everywhere on the page. Both filters matter: test games
   with no competition include finals dated weeks ahead, and either one alone
   would let one of them become the anchor.

   Names are asked for twenty and ten are kept. A minor whose club has not
   consented is hidden from an anonymous read, so playerMeta returns nothing for
   him — cutting to ten first would draw a nameless card with a broken link.

   CACHED FOR TEN MINUTES in sessionStorage, keyed by the anchor: a new final
   moves the anchor and misses the cache, and a second visit inside ten minutes
   asks only for the anchor. The rows are stored plain (no Maps), which is why
   render and card read the team through teamFor. */
const CACHE_KEY = 'epinoia_stars_global:';
const CACHE_MS = 10 * 60 * 1000;
const LEAGUE_SEL = 'id,slug,name,country,colour_a,colour_b,colour_source,logo_path';

function cacheGet(key) {
  try {
    const s = root.sessionStorage && root.sessionStorage.getItem(key);
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || typeof j.at !== 'number' || Date.now() - j.at > CACHE_MS || Date.now() < j.at) return null;
    return j.data;
  } catch (_) { return null; }
}
function cachePut(key, data) {
  try { root.sessionStorage && root.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); }
  catch (_) { /* private mode or full: the page works, it just asks again next time */ }
}

function signedIn() {
  try {
    const A = root.EpinoiaAccess;
    return !!(A && typeof A.session === 'function' && A.session());
  } catch (_) { return false; }
}

/* The stored podiums for this anchor, or null. EVERY LEAGUE ON THEM MUST STILL BE ONE THE
   READER CAN SEE: a league made private after the build would otherwise keep its players
   on HOME until the next one (the function rebuilds at least hourly). The visible list is
   globalgames.js's, cached for the page and already asked for by HOME. */
async function starsSnapshot(anchor, D) {
  try {
    const rows = await D.get('snapshots?key=eq.stars_global&select=token,data');
    const r = rows && rows[0];
    if (!r || r.token !== anchor || !r.data) return null;
    const G = root.EpinoiaGlobalGames;
    const lgs = G && typeof G.leagues === 'function' ? await G.leagues() : await D.get('leagues?select=id');
    const visible = new Set((lgs || []).map(l => l.id));
    const onPodium = WINDOWS.flatMap(w => ((r.data[w.key] || {}).top || []))
      .map(p => p && p._league && p._league.id).filter(Boolean);
    if (onPodium.some(id => !visible.has(id))) return null;
    return r.data;
  } catch (_) { return null; }   // no table yet (404), or a blip: work it out as before
}

/* a cached row's window is stored by key and restored to the WINDOWS entry */
function revive(row) {
  if (!row) return null;
  const w = WINDOWS.find(x => x.key === row.w) || null;
  return w ? Object.assign({}, row, { w }) : null;
}

async function global(opts) {
  const o = opts || {};
  const D = root.EpinoiaData;
  const now = o.now instanceof Date ? o.now : new Date();

  const anchorRows = await D.get('games?select=tipoff_at&status=eq.final&competition_id=not.is.null' +
    '&tipoff_at=lte.' + encodeURIComponent(now.toISOString()) + '&order=tipoff_at.desc&limit=1');
  if (!anchorRows.length || !anchorRows[0].tipoff_at) return { week: null, month: null, anchor: null };
  const anchor = anchorRows[0].tipoff_at;
  const at = new Date(anchor).getTime();

  const hit = cacheGet(CACHE_KEY + anchor);
  if (hit) return { week: revive(hit.week), month: revive(hit.month), anchor };

  /* THE SERVER'S PODIUMS (0152), when they were built from this same anchor. The snapshots
     function runs this very function once after each final, as a signed-out reader, and
     stores the `out` below; every visitor shares it instead of reading a month of box
     scores across every league (1.44 MB and eight queries on 2026-09-24) and running BPM.
     A signed-in reader may see leagues a signed-out one cannot, so they work it out
     themselves; o.snapshot === false is the function itself. */
  if (o.snapshot !== false && !signedIn()) {
    const snap = await starsSnapshot(anchor, D);
    if (snap) {
      cachePut(CACHE_KEY + anchor, snap);
      return { week: revive(snap.week), month: revive(snap.month), anchor };
    }
  }

  const widest = Math.max.apply(null, WINDOWS.map(w => w.days));
  const from = new Date(at - widest * dayMs).toISOString();
  /* competitions!inner drops the test games; the league rides along on each game */
  const games = await D.all('games?select=id,tipoff_at,home_team_id,away_team_id,competition_id,' +
    'competitions!inner(seasons!inner(leagues!inner(' + LEAGUE_SEL + ')))' +
    '&status=eq.final&competition_id=not.is.null' +
    '&tipoff_at=gte.' + encodeURIComponent(from) + '&tipoff_at=lte.' + encodeURIComponent(anchor) +
    '&order=tipoff_at.desc,id.asc');
  const leagueOf = g => (g && g.competitions && g.competitions.seasons && g.competitions.seasons.leagues) || null;

  const out = { week: null, month: null, anchor };
  if (!games.length) { cachePut(CACHE_KEY + anchor, out); return out; }

  const teamIds = [...new Set(games.flatMap(g => [g.home_team_id, g.away_team_id]).filter(Boolean))];
  const [box, teamParts] = await Promise.all([
    boxScores(games.map(g => g.id)),
    Promise.all(chunk40(teamIds).map(c =>
      D.all('teams?id=in.(' + c.join(',') + ')&select=id,name,short_name,slug,colour,colour_2')))
  ]);
  const teams = {};
  teamParts.flat().forEach(t => { teams[t.id] = t; });

  /* twenty candidates a window, named in one pass */
  const cands = WINDOWS.map(w => {
    const inWindow = games.filter(g => new Date(g.tipoff_at || 0).getTime() >= at - w.days * dayMs);
    if (!inWindow.length) return { w, inWindow, top: [] };
    const agg = computeWindow(box.pgs, box.tgs, inWindow, { leagueOf });
    return { w, inWindow, top: pick(agg.players, w, 20) };
  });
  const ids = [...new Set(cands.flatMap(c => c.top.map(p => p.id)))];
  let meta = {};
  if (ids.length) { try { meta = await D.playerMeta(ids); } catch (_) { meta = {}; } }

  const named = m => !!(m && m.slug && m.name && m.name !== 'Player');
  cands.forEach(c => {
    const top = c.top.filter(p => named(meta[p.id])).slice(0, 10);
    if (!top.length) return;
    const rowMeta = {};
    top.forEach(p => { rowMeta[p.id] = meta[p.id]; });
    const lgs = new Set(c.inWindow.map(g => (leagueOf(g) || {}).id));
    out[c.w.key] = {
      w: c.w.key,
      top: top.map(p => ({ id: p.id, bpm: p.bpm, gp: p.gp, min: p.min, ppg: p.ppg, rpg: p.rpg, apg: p.apg,
                           _teamId: p._teamId || null, _league: p._league || null })),
      meta: rowMeta, teamsById: teams,
      games: c.inWindow.length, leagues: lgs.size, span: span(c.inWindow)
    };
  });
  cachePut(CACHE_KEY + anchor, out);
  return { week: revive(out.week), month: revive(out.month), anchor };
}

return { WINDOWS, PLAYER_KEYS, TEAM_KEYS, PLAYER_SEL, TEAM_SEL, unpick, boxScores,
         computeWindow, pick, span, card, render, global, monogram, paintCard, leagueShort };
}));
