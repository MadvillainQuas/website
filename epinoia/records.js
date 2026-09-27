'use strict';
/* ============================================================================
   EPINOIA RECORDS — the season's single-game bests, on a league's front page
   under the Stars. Two sets behind one switch:

     PLAYER  most points, rebounds, assists, steals, blocks and threes made by
             one player in one game
     TEAM    most points, the widest winning margin, most threes made, most
             assists and the widest rebound margin in one game

   THE SERVER DOES THE SORTING. A season of player lines is thousands of rows;
   each player record is one request ordered by that key in the stats JSON and
   cut to a dozen, so the page reads a few kilobytes rather than the season.
   Rebounds are the one total the line does not store (it keeps offensive and
   defensive apart), so they are found from the best offensive and the best
   defensive lines: any line in neither list can have no more than the two
   cut-off values added together, and the list is widened until the best found
   beats that, which makes the answer exact rather than likely.

   The team records need both sides of every game (a margin is a difference),
   so the team lines are read whole, four numbers each, with the scores.

   A TIE IS A SHARED RECORD. The card names whoever set it first and says how
   many share it. A player whose club has not consented to showing a minor has
   no name for an anonymous reader, so the record passes to the next line
   rather than drawing a nameless card.

   Needs data.js (get, all, playerMeta) and, for the card's colours,
   teamcolour.js through stars.js's paintCard.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaRecords = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const PLAYER = [
  { k: 'pts', label: 'Points',   band: 'POINTS' },
  { k: 'reb', label: 'Rebounds', band: 'REBOUNDS', parts: ['or', 'dr'] },
  { k: 'ast', label: 'Assists',  band: 'ASSISTS' },
  { k: 'stl', label: 'Steals',   band: 'STEALS' },
  { k: 'blk', label: 'Blocks',   band: 'BLOCKS' },
  { k: 'p3m', label: '3PT made', band: '3PT MADE' }
];
const TEAM = [
  { k: 'pts',    label: 'Points',         band: 'POINTS' },
  { k: 'margin', label: 'Winning margin', band: 'WINNING MARGIN', signed: true },
  { k: 'p3m',    label: '3PT made',       band: '3PT MADE' },
  { k: 'ast',    label: 'Assists',        band: 'ASSISTS' },
  { k: 'reb',    label: 'Rebound margin', band: 'REBOUND MARGIN', signed: true }
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(iso) {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()];
}
function whenLong(iso) {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}
const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
const inList = ids => 'in.(' + ids.join(',') + ')';

/* the season's finals, through the competitions: the inner join keeps a line
   only when its game is one of them */
function joinFilter(comps) {
  return '&games.competition_id=' + inList(comps) + '&games.status=eq.final';
}

/* one key's best lines, highest first, with the game's date for the tie-break */
/* U22 narrows the lines on the server by the birth year (the player's row, embedded): nobody born
   before this can be under 22; the exact ages then settle the borderline year on this side */
const youngJoin = born => born ? ',players!inner(birth_year)' : '';
const youngFilter = born => born ? '&players.birth_year=gte.' + born : '';
async function topBy(D, comps, key, n, born) {
  const rows = await D.get('player_game_stats?select=game_id,player_id,player_uuid,team_idx,' +
    'v_or:stats->or,v_dr:stats->dr,v:stats->' + key + ',games!inner(tipoff_at)' + youngJoin(born) +
    joinFilter(comps) + youngFilter(born) +
    '&stats->' + key + '=not.is.null&order=stats->' + key + '.desc.nullslast,game_id.asc&limit=' + n);
  return (rows || []).map(r => ({
    game_id: r.game_id, pid: r.player_uuid || r.player_id, team_idx: r.team_idx,
    at: r.games && r.games.tipoff_at, v: num(r.v), or: num(r.v_or), dr: num(r.v_dr)
  })).filter(r => r.v != null && r.pid);
}

/* REBOUNDS, EXACTLY: the best offensive and defensive lines, widened until the
   best total found cannot be beaten by a line outside both lists */
async function topRebounds(D, comps, born) {
  for (const n of [24, 120, 600]) {
    const [o, d] = await Promise.all([topBy(D, comps, 'or', n, born), topBy(D, comps, 'dr', n, born)]);
    const seen = new Map();
    o.concat(d).forEach(r => {
      const k = r.game_id + '|' + r.pid;
      if (!seen.has(k)) seen.set(k, Object.assign({}, r, { v: (r.or || 0) + (r.dr || 0) }));
    });
    const rows = [...seen.values()].sort((a, b) => b.v - a.v);
    const full = o.length < n && d.length < n;        // every line with a rebound is in hand
    const bound = (o.length ? o[o.length - 1].v : 0) + (d.length ? d[d.length - 1].v : 0);
    if (full || (rows.length && rows[0].v > bound) || n === 600) return rows;
  }
  return [];
}

/* The record in a list of lines: the top value, the lines that share it (in
   the order they were set), and the first of them the reader can be shown. */
function settle(rows, shown) {
  const ok = (rows || []).filter(r => r.v != null && r.v > 0 && (!shown || shown(r)));
  if (!ok.length) return null;
  const best = ok.reduce((m, r) => Math.max(m, r.v), -Infinity);
  const tied = ok.filter(r => r.v === best)
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.game_id).localeCompare(String(b.game_id)));
  return { v: best, holder: tied[0], shared: tied.length };
}

/* ------------------------------------------------------------ the loads ---
   load({comps, teamsById}) -> {player: [...], team: [...], games}
   Each record: {cat, v, shared, holder, game, side, opp, meta?}. */
async function load(opts) {
  const D = root.EpinoiaData;
  const comps = (opts && opts.comps) || [];
  if (!D || !comps.length) return null;

  const games = opts.games || await D.all('games?competition_id=' + inList(comps) + '&status=eq.final' +
    '&select=id,tipoff_at,home_team_id,away_team_id,home_score,away_score&order=tipoff_at.asc,id.asc');
  if (!games.length) return null;
  const byId = new Map(games.map(g => [g.id, g]));

  /* U22 is a player's filter: a team has no age, so there are no team records under it */
  const u22 = opts.filter === 'u22';
  const born = u22 ? (opts.now instanceof Date ? opts.now : new Date()).getFullYear() - 22 : null;
  const [player, team] = await Promise.all([
    playerRecords(D, comps, byId, born).catch(() => []),
    u22 ? [] : teamRecords(D, comps, games).catch(() => [])
  ]);
  return { player, team, games: games.length };
}

async function playerRecords(D, comps, byId, born) {
  const lists = await Promise.all(PLAYER.map(c =>
    (c.parts ? topRebounds(D, comps, born) : topBy(D, comps, c.k, born ? 30 : 12, born)).catch(() => [])));
  const ids = [...new Set(lists.flat().map(r => r.pid))];
  if (!ids.length) return [];
  let meta = {}, young = null;
  const ST = root.EpinoiaStars;
  await Promise.all([
    D.playerMeta(ids).then(m => { meta = m || {}; }).catch(() => null),
    born && ST && ST.under22 ? ST.under22(ids).then(y => { young = y; }).catch(() => null) : null
  ]);
  if (born && !young) return [];
  const named = r => { const m = meta[r.pid]; return !!(m && m.slug && m.name && m.name !== 'Player') && (!young || young.has(r.pid)); };

  const out = [];
  const photos = {};
  PLAYER.forEach((c, i) => {
    const rec = settle(lists[i], named);
    if (!rec) return;
    const g = byId.get(rec.holder.game_id);
    if (!g) return;
    const side = rec.holder.team_idx === 0 ? 0 : 1;
    out.push({ cat: c, v: rec.v, shared: rec.shared, holder: rec.holder, meta: meta[rec.holder.pid],
               game: g, teamId: side === 0 ? g.home_team_id : g.away_team_id,
               oppId: side === 0 ? g.away_team_id : g.home_team_id, side });
  });
  /* THE HOLDERS' PHOTOGRAPHS, in one request. The media row is embedded through the foreign
     key, so an unapproved or unconsented photograph is simply not in the answer; an approved
     upload beats a pasted address, and an insecure address is never drawn. */
  const holders = [...new Set(out.map(r => r.holder.pid))];
  if (holders.length) {
    try {
      const cfg = root.EPINOIA_CONFIG || {};
      const U = root.EpinoiaUpload;
      (await D.get('players?id=' + inList(holders) + '&select=id,photo_url,media:photo_media_id(storage_path)') || []).forEach(p => {
        const path = p.media && p.media.storage_path;
        const stored = path ? (U && U.publicUrl ? U.publicUrl(cfg, path)
          : (cfg.supabaseUrl || '') + '/storage/v1/object/public/media-public/' + path) : null;
        const url = stored || p.photo_url || null;
        if (url && /^https:\/\//i.test(url)) photos[p.id] = url;
      });
    } catch (_) { /* initials all round */ }
  }
  out.forEach(r => { r.photo = photos[r.holder.pid] || null; });
  return out;
}

async function teamRecords(D, comps, games) {
  let lines = [];
  try {
    lines = await D.all('team_game_stats?select=game_id,team_idx,' +
      't_pts:stats->adv->pts,t_p3m:stats->adv->fg3m,t_ast:stats->adv->ast,' +
      't_oreb:stats->adv->oreb,t_dreb:stats->adv->dreb,games!inner(id)' + joinFilter(comps));
  } catch (_) { lines = []; }
  const byGame = new Map();
  lines.forEach(r => {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id)[r.team_idx === 0 ? 0 : 1] = r;
  });

  /* every side of every game, with the counts the records read */
  const sides = [];
  games.forEach(g => {
    const L = byGame.get(g.id) || [];
    [0, 1].forEach(s => {
      const me = L[s] || null, them = L[1 - s] || null;
      const pts = num(s === 0 ? g.home_score : g.away_score) ?? num(me && me.t_pts);
      const opp = num(s === 0 ? g.away_score : g.home_score) ?? num(them && them.t_pts);
      const reb = x => x ? (num(x.t_oreb) || 0) + (num(x.t_dreb) || 0) : null;
      const hasReb = me && them && (me.t_oreb != null || me.t_dreb != null) && (them.t_oreb != null || them.t_dreb != null);
      sides.push({
        game_id: g.id, at: g.tipoff_at, game: g, side: s,
        teamId: s === 0 ? g.home_team_id : g.away_team_id,
        oppId: s === 0 ? g.away_team_id : g.home_team_id,
        pts, opp,
        vals: {
          pts,
          margin: pts != null && opp != null ? pts - opp : null,
          p3m: me ? num(me.t_p3m) : null,
          ast: me ? num(me.t_ast) : null,
          reb: hasReb ? reb(me) - reb(them) : null
        }
      });
    });
  });

  const out = [];
  TEAM.forEach(c => {
    const rows = sides.filter(x => x.teamId).map(x => Object.assign({}, x, { v: x.vals[c.k] }));
    const rec = settle(rows);
    if (!rec) return;
    const h = rec.holder;
    out.push({ cat: c, v: rec.v, shared: rec.shared, holder: h, game: h.game,
               teamId: h.teamId, oppId: h.oppId, side: h.side, pts: h.pts, opp: h.opp });
  });
  return out;
}

/* ------------------------------------------------------------- the card --- */
function el(t, c, x) {
  const n = root.document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n;
}
function teamOf(teamsById, id) {
  if (!teamsById || id == null) return null;
  return (typeof teamsById.get === 'function' ? teamsById.get(id) : teamsById[id]) || null;
}
/* a club's short name, unless it stops on a joining word ("Rayos de"): then its name */
const DANGLING = /\s(de|del|da|do|la|las|los|le|of|the|and|y|e|di|van|von)$/i;
const shortName = t => {
  if (!t) return '';
  const sh = String(t.short_name || '').trim();
  return (sh && !DANGLING.test(sh) ? sh : '') || t.name || '';
};
function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : (w[0][1] || ''))).toUpperCase();
}
/* a club's crest: the approved upload the clubs grid already found, else the feed's logo */
function crestOf(t) {
  if (!t) return null;
  if (t.__logo) return t.__logo;
  return t.logo_path && typeof root.epinoiaLogoUrl === 'function' ? root.epinoiaLogoUrl(t.logo_path) : null;
}

/* THE RECORD CARD. Its own card, not the stars' plate: a disc on the left with the player's
   photograph (initials in the club's colours when there is none) or the club's crest, the record
   in the middle in the scoreboard face with what it counts stacked beside it, and a teletext
   strip along the foot naming who set it, against whom and when. The club's two colours run
   down the left edge and wash in behind the number. The whole card opens the game. */
function card(r, kind, o) {
  const TC = root.EpinoiaTeamColour;
  const team = teamOf(o.teamsById, r.teamId) || {};
  const opp = teamOf(o.teamsById, r.oppId) || {};
  const m = r.meta || {};
  const val = (r.cat.signed && r.v > 0 ? '+' : '') + r.v;
  const date = when(r.game.tipoff_at);
  const score = r.pts != null && r.opp != null ? r.pts + '–' + r.opp : '';
  const who = kind === 'player' ? (m.name || 'Player') : (team.name || 'Team');

  const a = el('a', 'rc rc-' + kind);
  a.href = (o.base || '') + 'game/?g=' + encodeURIComponent(r.game.id);
  const colour = team.colour || m.colour || '#93f2bf';
  if (TC && TC.card) TC.card(a, colour, team.colour_2);
  else a.style.setProperty('--ink-c', colour);
  a.setAttribute('aria-label', r.cat.label + ' record: ' + val + ', ' + who +
    (kind === 'player' && team.name ? ' (' + team.name + ')' : '') +
    (opp.name ? ' against ' + opp.name : '') + (score ? ' ' + score : '') +
    ', ' + whenLong(r.game.tipoff_at) + (r.shared > 1 ? ', shared by ' + r.shared : ''));

  const body = el('span', 'rc-body');
  body.appendChild(el('span', 'rc-edge'));

  /* the disc */
  const av = el('span', 'rc-av' + (kind === 'team' ? ' crest' : ''));
  av.setAttribute('aria-hidden', 'true');
  const pic = kind === 'player' ? r.photo : crestOf(team);
  const letters = el('span', 'rc-ini', kind === 'player' ? initials(m.name) : (shortName(team) || initials(team.name)).slice(0, 3).toUpperCase());
  av.appendChild(letters);
  if (pic) {
    const img = el('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.src = pic;
    img.addEventListener('load', () => av.classList.add('has-img'));
    img.addEventListener('error', () => img.remove());
    av.appendChild(img);
  }
  body.appendChild(av);

  /* the number, and what it counts beside it */
  const fig = el('span', 'rc-fig');
  fig.appendChild(el('span', 'rc-n' + (String(val).length > 2 ? ' long' : ''), val));
  const k = el('span', 'rc-k');
  const words = r.cat.band.split(' ');
  /* two words stack, so the label stays narrow beside the number */
  (words.length > 1 ? [words[0], words.slice(1).join(' ')] : words).forEach(t => k.append(el('span', 'rc-stat', t)));
  k.append(el('span', 'rc-blocks'));
  fig.appendChild(k);
  body.appendChild(fig);

  if (r.shared > 1) {
    const j = el('span', 'rc-joint', 'JOINT ×' + r.shared);
    j.title = 'Shared by ' + r.shared + (kind === 'player' ? ' players' : ' teams') + '; the first to set it is shown';
    body.appendChild(j);
  }

  /* the strip */
  const foot = el('span', 'rc-foot');
  let sub;
  if (kind === 'player') sub = (shortName(team) ? shortName(team) + ' ' : '') + 'v ' + (shortName(opp) || 'opponent');
  else {
    const won = r.pts != null && r.opp != null && r.pts > r.opp;
    sub = (won ? 'beat ' : 'v ') + (shortName(opp) || 'opponent') + (score ? ' ' + score : '');
  }
  const w = el('span', 'rc-who');
  w.append(el('span', 'rc-name', who), el('span', 'rc-sub', sub));
  /* across every league (HOME) the strip says which one, over the date */
  const meta = el('span', 'rc-meta');
  if (r.league) {
    const ST = root.EpinoiaStars;
    const lg = el('span', 'rc-lg', ST && ST.leagueShort ? ST.leagueShort(r.league) : (r.league.name || ''));
    lg.title = r.league.name || '';
    meta.appendChild(lg);
  }
  meta.appendChild(el('span', 'rc-date', date.toUpperCase()));
  foot.append(w, meta);
  a.append(body, foot);
  return a;
}

/* ------------------------------------------------------------ the rows ---
   render(host, data, {teamsById, base, season}): the head with the switch,
   then the set that is switched on. The choice is remembered for the reader. */
const PREF = 'epinoia.records.kind';
function render(host, data, opts) {
  const o = opts || {};
  host.textContent = '';
  const kinds = [['player', 'Player', data.player], ['team', 'Team', data.team]].filter(k => k[2] && k[2].length);
  if (!kinds.length) return false;
  let kind = 'player';
  try { const s = root.localStorage.getItem(PREF); if (s) kind = s; } catch (_) { /* default */ }
  if (!kinds.some(k => k[0] === kind)) kind = kinds[0][0];

  const head = el('div', 'starrow-h rec-h');
  const title = el('span', 'starrow-t');
  head.append(title,
              el('span', 'starrow-s', (o.season ? o.season + ' · ' : '') + data.games +
                 (data.games === 1 ? ' game' : ' games')));
  const sw = el('div', 'rec-sw');
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', 'Records for');
  const grid = el('div', 'recgrid');
  grid.setAttribute('aria-live', 'polite');
  const btns = kinds.map(([k, label]) => {
    const b = el('button', 'rec-b', label);
    b.type = 'button'; b.dataset.k = k;
    sw.appendChild(b);
    return b;
  });
  const draw = () => {
    btns.forEach(b => { const on = b.dataset.k === kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    title.textContent = kind === 'team' ? 'TEAM RECORDS' : 'PLAYER RECORDS';
    grid.textContent = '';
    const set = (kinds.find(k => k[0] === kind) || kinds[0])[2];
    set.forEach(r => grid.appendChild(card(r, kind, o)));
    grid.dataset.kind = kind;
  };
  sw.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.rec-b');
    if (!b || b.dataset.k === kind) return;
    kind = b.dataset.k;
    try { root.localStorage.setItem(PREF, kind); } catch (_) { /* this visit only */ }
    draw();
  });
  if (kinds.length > 1) head.appendChild(sw);
  host.append(head, grid);
  draw();
  return true;
}

/* ------------------------------------------------------ across leagues ---
   global() -> {data, teamsById, leagues} | null, for HOME's Global Records.

   THIS SEASON IS EACH LEAGUE'S OWN: the newest season of every league the reader
   can see that has a finished game, which is the season its front page opens
   on. Leagues run to different calendars, so one date range would cut one
   league's season in half and reach back into another's last.

   Every finished game on the platform is one small read (id, date, clubs,
   scores, competition), which is what decides the seasons; the records
   themselves are then load()'s, over those seasons' competitions. Cached for
   ten minutes in sessionStorage, keyed by the newest final, so a result
   anywhere misses the cache. */
const CACHE_KEY = 'epinoia_records_global:';
const CACHE_MS = 10 * 60 * 1000;
function cacheGet(key) {
  try {
    const s = root.sessionStorage && root.sessionStorage.getItem(key);
    const j = s ? JSON.parse(s) : null;
    if (!j || typeof j.at !== 'number' || Date.now() - j.at > CACHE_MS || Date.now() < j.at) return null;
    return j.data;
  } catch (_) { return null; }
}
function cachePut(key, data) {
  try { root.sessionStorage && root.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); }
  catch (_) { /* full or private: asked again next time */ }
}
const chunk = (a, n) => { const c = []; for (let i = 0; i < a.length; i += n) c.push(a.slice(i, i + n)); return c; };

async function global(opts) {
  const o = opts || {};
  const ST = root.EpinoiaStars;
  const filter = ST && ST.cleanFilter ? ST.cleanFilter(o.filter) : 'all';
  const D = root.EpinoiaData;
  if (!D) return null;
  const G = root.EpinoiaGlobalGames;
  const lgs = G && typeof G.leagues === 'function' ? await G.leagues()
    : await D.get('leagues?select=id,slug,name,gender&order=name.asc');
  if (!lgs || !lgs.length) return null;
  const fits = l => (ST && ST.leagueFits ? ST.leagueFits(l, filter) : true);
  const leagueById = new Map(lgs.filter(fits).map(l => [l.id, l]));
  if (!leagueById.size) return null;

  const finals = await D.all('games?status=eq.final&competition_id=not.is.null' +
    '&select=id,tipoff_at,home_team_id,away_team_id,home_score,away_score,competition_id&order=tipoff_at.asc,id.asc');
  if (!finals.length) return null;
  const anchor = finals[finals.length - 1].tipoff_at + '|' + finals.length;
  const key = CACHE_KEY + filter + ':' + anchor;
  const hit = cacheGet(key);
  if (hit) return hit;

  const seasons = [];
  for (const ids of chunk([...leagueById.keys()], 40)) {
    seasons.push(...await D.get('seasons?league_id=' + inList(ids) +
      '&select=id,name,league_id,starts_on,competitions(id)&order=starts_on.desc.nullslast'));
  }
  /* which season each competition is in, and each league's newest season with a final */
  const seasonOfComp = new Map();
  seasons.forEach(se => (se.competitions || []).forEach(c => seasonOfComp.set(c.id, se)));
  const played = new Set(finals.map(g => (seasonOfComp.get(g.competition_id) || {}).id).filter(Boolean));
  const current = new Map();                                     // league id -> season
  seasons.forEach(se => {
    if (!played.has(se.id) || current.has(se.league_id)) return;
    current.set(se.league_id, se);                               // newest first, so the first played one
  });
  const comps = [...current.values()].flatMap(se => (se.competitions || []).map(c => c.id));
  if (!comps.length) return null;
  const compSet = new Set(comps);
  const games = finals.filter(g => compSet.has(g.competition_id));

  const data = await load({ comps, games, filter });
  if (!data || (!data.player.length && !data.team.length)) return null;
  const leagueOfGame = g => {
    const se = seasonOfComp.get(g.competition_id);
    const l = se && leagueById.get(se.league_id);
    return l ? { id: l.id, slug: l.slug, name: l.name } : null;
  };
  data.player.concat(data.team).forEach(r => { r.league = leagueOfGame(r.game); });

  /* the clubs on the cards, with their crests: an approved upload first, as the clubs grid does */
  const teamIds = [...new Set(data.player.concat(data.team).flatMap(r => [r.teamId, r.oppId]).filter(Boolean))];
  const teamsById = {};
  if (teamIds.length) {
    const [ts, crests] = await Promise.all([
      D.get('teams?id=' + inList(teamIds) + '&select=id,name,short_name,slug,colour,colour_2,logo_path').catch(() => []),
      D.get('media?owner_type=eq.team&kind=eq.logo&status=eq.approved&owner_id=' + inList(teamIds) +
        '&select=owner_id,storage_path&order=created_at.desc').catch(() => [])
    ]);
    const crest = {};
    (crests || []).forEach(m => { if (!crest[m.owner_id] && typeof root.epinoiaLogoUrl === 'function') crest[m.owner_id] = root.epinoiaLogoUrl(m.storage_path); });
    (ts || []).forEach(t => { teamsById[t.id] = Object.assign({}, t, { __logo: crest[t.id] || null }); });
  }
  const out = { data, teamsById, leagues: current.size };
  cachePut(key, out);
  return out;
}

return { PLAYER, TEAM, load, render, card, settle, when, global };
}));
