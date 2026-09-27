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
async function topBy(D, comps, key, n) {
  const rows = await D.get('player_game_stats?select=game_id,player_id,player_uuid,team_idx,' +
    'v_or:stats->or,v_dr:stats->dr,v:stats->' + key + ',games!inner(tipoff_at)' + joinFilter(comps) +
    '&stats->' + key + '=not.is.null&order=stats->' + key + '.desc.nullslast,game_id.asc&limit=' + n);
  return (rows || []).map(r => ({
    game_id: r.game_id, pid: r.player_uuid || r.player_id, team_idx: r.team_idx,
    at: r.games && r.games.tipoff_at, v: num(r.v), or: num(r.v_or), dr: num(r.v_dr)
  })).filter(r => r.v != null && r.pid);
}

/* REBOUNDS, EXACTLY: the best offensive and defensive lines, widened until the
   best total found cannot be beaten by a line outside both lists */
async function topRebounds(D, comps) {
  for (const n of [24, 120, 600]) {
    const [o, d] = await Promise.all([topBy(D, comps, 'or', n), topBy(D, comps, 'dr', n)]);
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

  const games = await D.all('games?competition_id=' + inList(comps) + '&status=eq.final' +
    '&select=id,tipoff_at,home_team_id,away_team_id,home_score,away_score&order=tipoff_at.asc,id.asc');
  if (!games.length) return null;
  const byId = new Map(games.map(g => [g.id, g]));

  const [player, team] = await Promise.all([
    playerRecords(D, comps, byId).catch(() => []),
    teamRecords(D, comps, games).catch(() => [])
  ]);
  return { player, team, games: games.length };
}

async function playerRecords(D, comps, byId) {
  const lists = await Promise.all(PLAYER.map(c =>
    (c.parts ? topRebounds(D, comps) : topBy(D, comps, c.k, 12)).catch(() => [])));
  const ids = [...new Set(lists.flat().map(r => r.pid))];
  if (!ids.length) return [];
  let meta = {};
  try { meta = await D.playerMeta(ids); } catch (_) { meta = {}; }
  const named = r => { const m = meta[r.pid]; return !!(m && m.slug && m.name && m.name !== 'Player'); };

  const out = [];
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
const shortName = t => (t && (t.short_name || t.name)) || '';

/* THE RECORD IS THE MARK: the number printed where a club's monogram goes, the
   category across the band, and underneath who set it, against whom and when.
   The whole card opens the game it was set in. */
function card(r, kind, o) {
  const ST = root.EpinoiaStars;
  const team = teamOf(o.teamsById, r.teamId) || {};
  const opp = teamOf(o.teamsById, r.oppId) || {};
  const m = r.meta || {};
  const ink = team.colour || m.colour || '#93f2bf';
  const val = (r.cat.signed && r.v > 0 ? '+' : '') + r.v;
  const date = when(r.game.tipoff_at);
  const score = r.pts != null && r.opp != null ? r.pts + '–' + r.opp : '';

  const a = el('a', 'club star rec rec-' + kind);
  a.href = (o.base || '') + 'game/?g=' + encodeURIComponent(r.game.id);
  if (ST && ST.paintCard) ST.paintCard(a, ink, team.colour_2);
  const who = kind === 'player' ? (m.name || 'Player') : (team.name || 'Team');
  a.setAttribute('aria-label', r.cat.label + ' record: ' + val + ', ' + who +
    (kind === 'player' && team.name ? ' (' + team.name + ')' : '') +
    (opp.name ? ' against ' + opp.name : '') + (score ? ' ' + score : '') +
    ', ' + whenLong(r.game.tipoff_at) + (r.shared > 1 ? ', shared by ' + r.shared : ''));

  const plate = el('div', 'club-plate');
  plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));
  const mark = el('div', 'club-mark');
  mark.append(el('span', 'club-mono ghost', val), el('span', 'club-mono', val));
  plate.appendChild(mark);
  const band = el('div', 'club-band');
  band.appendChild(el('span', null, r.cat.band));
  plate.appendChild(band);
  plate.appendChild(el('div', 'club-grain'));
  if (r.shared > 1) {
    const j = el('span', 'rec-joint', 'JOINT ×' + r.shared);
    j.title = 'Shared by ' + r.shared + (kind === 'player' ? ' players' : ' teams') + '; the first to set it is shown';
    plate.appendChild(j);
  }

  const foot = el('div', 'club-foot star-foot');
  const w = el('div', 'star-who');
  let sub;
  if (kind === 'player') {
    sub = (shortName(team) ? shortName(team) + ' ' : '') + 'v ' + (shortName(opp) || 'opponent');
  } else {
    const won = r.pts != null && r.opp != null && r.pts > r.opp;
    sub = (won ? 'beat ' : 'v ') + (shortName(opp) || 'opponent') + (score ? ' ' + score : '');
  }
  w.append(el('span', 'star-name', who), el('span', 'star-team', sub));
  foot.append(w, el('span', 'club-ed', date.toUpperCase()));
  a.append(plate, foot);
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
  const grid = el('div', 'stargrid recgrid');
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

return { PLAYER, TEAM, load, render, card, settle, when };
}));
