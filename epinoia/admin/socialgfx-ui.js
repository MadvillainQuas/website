'use strict';
/* ============================================================================
   GRAPHICS FOR SOCIALS - the DATA side: what the league's week has earned, ready for socialcard.js to draw.
   (The Graphics tab, admin/graphics-ui.js, is the screen over it.)

   Nobody asks for these. It reads the season the console is looking at and lays out what there is to post:

     THE WEEK      the week's results, the table after it, and the week coming up (each competition's own),
                   and a player of the week when there were several games
     EACH GAME     a final score and a player of the game for every game finished in the week

   in the shape chosen (square, portrait or story), each with the words to post it with, and each tagged with a
   content TYPE (results / stars / table / ahead / roundup) so the tab can filter and count them. Every graphic
   is drawn in this browser from the rows read here, so a game corrected in the console is a corrected graphic
   the next time it is read; nothing is stored.

   THE WEEK is the seven days to now (offset 0: with the seven days ahead for the fixtures), or, for a week
   picked from the past (offset -1, -2, ...), the seven days ending that many weeks ago: its finals and their
   players. The table is only ever today's (standings are not kept by week), so an earlier week has none.

   WHAT IT READS, and only that: the season's competitions (admin.js), their games in the window, the clubs in
   them, the finished games' quarter scores (team_game_stats.stats->perQ) and eleven numbers of each player line
   (never the whole stats blob: a round of games would be megabytes), the standings, and the league's Instagram
   handle for the footer.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSocialGfx = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const DAY = 86400000;
const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* the eleven numbers a graphic uses, read out of the stats blob by PostgREST (aliases avoid "or" and "to") */
const PLAYER_COLS = 'game_id,team_idx,' + [['pts', 'pts'], ['p2m', 'p2m'], ['p2a', 'p2a'], ['p3m', 'p3m'], ['p3a', 'p3a'],
  ['fta', 'fta'], ['ftm', 'ftm'], ['oreb', 'or'], ['dreb', 'dr'], ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['tov', 'to'],
  ['pf', 'pf'], ['pm', 'pm'], ['min', 'min']].map(([a, k]) => a + ':stats->' + k).join(',') + ',name:stats->adv->>name,num:stats->adv->>num';

/* a player row as socialcard.js reads it ({ team_idx, stats: {..., adv: {name, num}} }) */
function playerRow(r) {
  const s = { pts: r.pts, p2m: r.p2m, p2a: r.p2a, p3m: r.p3m, p3a: r.p3a, fta: r.fta, ftm: r.ftm, or: r.oreb, dr: r.dreb,
              ast: r.ast, stl: r.stl, blk: r.blk, to: r.tov, pf: r.pf, pm: r.pm, min: r.min, adv: { name: r.name || '', num: r.num } };
  return { game_id: r.game_id, team_idx: r.team_idx, stats: s };
}

const handleOf = v => {
  const s = String(v || '').trim();
  const m = /instagram\.com\/([A-Za-z0-9_.]+)/i.exec(s);
  return (m ? m[1] : s.replace(/^@/, '')).replace(/[^A-Za-z0-9_.]/g, '') || '';
};

function rangeLabel(a, b) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = x => x.getUTCDate(), mo = x => M[x.getUTCMonth()], y = x => x.getUTCFullYear();
  if (y(a) !== y(b)) return d(a) + ' ' + mo(a) + ' ' + y(a) + ' – ' + d(b) + ' ' + mo(b) + ' ' + y(b);
  if (mo(a) !== mo(b)) return d(a) + ' ' + mo(a) + ' – ' + d(b) + ' ' + mo(b) + ' ' + y(b);
  return d(a) + '–' + d(b) + ' ' + mo(b) + ' ' + y(b);
}

/* ---------------------------------------------------------------- reading --- */
/* Everything the graphics need, in five reads (and one more per thousand games). Pure of the DOM: the test
   drives it with a stub client. */
async function read(sb, league, comps, now, offset) {
  const off = Math.min(0, Math.round(+offset || 0));            // weeks back from now: 0 is this week, -1 last week
  const t = new Date((now || new Date()).getTime() + off * 7 * DAY);
  const since = new Date(t.getTime() - 7 * DAY), until = off < 0 ? t : new Date(t.getTime() + 7 * DAY);
  const ids = comps.map(c => c.id);
  const out = { league: null, comps, finals: [], upcoming: [], teams: new Map(), perQ: new Map(), players: new Map(), standings: [],
                since, until, now: t, offset: off };
  const lg = await sb.from('leagues').select('id,name,slug,timezone,country,colour_a,colour_b,logo_path').eq('id', league.id).maybeSingle();
  const L = lg && lg.data || league;
  let handle = '';
  try {
    const so = await sb.rpc('league_socials_admin', { p_league: league.id });
    const row = Array.isArray(so && so.data) ? so.data[0] : so && so.data;
    handle = handleOf(row && row.instagram);
  } catch (_) { /* no handle: the footer names the league */ }
  /* the league's own colours and logo: the graphics are the league's, not the platform's */
  out.league = { id: L.id, name: L.name || league.name, slug: L.slug || league.slug, timezone: L.timezone || null, country: L.country || null,
                 colour: L.colour_a || null, colour2: L.colour_b || null, logoPath: L.logo_path || null, handle };
  if (!ids.length) return out;
  const games = await sb.from('games')
    .select('id,competition_id,tipoff_at,venue,status,home_score,away_score,home_team_id,away_team_id')
    .in('competition_id', ids).gte('tipoff_at', since.toISOString()).lt('tipoff_at', until.toISOString())
    .order('tipoff_at', { ascending: true }).limit(1000);
  if (games.error) throw games.error;
  (games.data || []).forEach(g => {
    if (g.status === 'final' && new Date(g.tipoff_at) <= t) out.finals.push(g);
    else if ((g.status === 'scheduled' || !g.status) && new Date(g.tipoff_at) > t) out.upcoming.push(g);
  });
  if (off === 0) {
    const st = await sb.from('standings').select('competition_id,team_id,rank,gp,w,l,league_points,diff,streak,group_name,pts_for,pts_against')
      .in('competition_id', ids);
    out.standings = (st && st.data) || [];
  }
  const teamIds = [...new Set(out.finals.concat(out.upcoming).flatMap(g => [g.home_team_id, g.away_team_id])
    .concat(out.standings.map(s => s.team_id)).filter(Boolean))];
  for (let i = 0; i < teamIds.length; i += 200) {
    const tm = await sb.from('teams').select('id,name,short_name,colour,colour_2,logo_path').in('id', teamIds.slice(i, i + 200));
    ((tm && tm.data) || []).forEach(x => out.teams.set(x.id, x));
  }
  const fin = out.finals.map(g => g.id);
  for (let i = 0; i < fin.length; i += 100) {
    const chunk = fin.slice(i, i + 100);
    const [q, p] = await Promise.all([
      sb.from('team_game_stats').select('game_id,team_idx,perQ:stats->perQ').in('game_id', chunk),
      sb.from('player_game_stats').select(PLAYER_COLS).in('game_id', chunk)
    ]);
    ((q && q.data) || []).forEach(r => {
      if (!out.perQ.has(r.game_id)) out.perQ.set(r.game_id, [null, null]);
      out.perQ.get(r.game_id)[r.team_idx] = r.perQ || null;
    });
    ((p && p.data) || []).forEach(r => {
      if (!out.players.has(r.game_id)) out.players.set(r.game_id, []);
      out.players.get(r.game_id).push(playerRow(r));
    });
  }
  return out;
}

/* ---------------------------------------------------------------- the list --- */
/* What there is to post, for one shape: [{ group, title, model }] */
/* the league (with its logo's address) and a club by id (with its crest's), as socialcard.js's models take them */
function frame(data, crestOf) {
  const L = Object.assign({}, data.league, { logoUrl: crestOf && data.league.logoPath ? crestOf({ logo_path: data.league.logoPath }) : null });
  /* a club's record (from the standings) and its ELO (data.extras, read when a graphic asks for it) ride on the club */
  const rec = new Map();
  (data.standings || []).forEach(x => { if (!rec.has(x.team_id)) rec.set(x.team_id, (x.w || 0) + '-' + (x.l || 0)); });
  const ex = data.extras || null;
  const team = id => {
    const t = data.teams.get(id) || { name: '?' };
    return Object.assign({}, t, { crestUrl: crestOf ? crestOf(t) : null, record: rec.get(id) || '', elo: ex && ex.elo.has(id) ? ex.elo.get(id) : null });
  };
  return { L, team };
}

/* ------------------------------------------------- what the games say beyond the table --- */
/* The table columns the standings do not hold - the ELO rating, the last five games, the home and away records - worked
   from every finished game of the competitions (their scores only: one bounded read, a thousand at a time). ELO is
   sos.js's own, the rating the league page's table shows (1500 the average). Read only when a graphic asks. */
async function readExtras(sb, comps) {
  const out = { elo: new Map(), l5: new Map(), home: new Map(), away: new Map(), games: 0 };
  const ids = (comps || []).map(c => c.id);
  if (!ids.length) return out;
  const games = [];
  for (let from = 0; from < 10000; from += 1000) {
    const r = await sb.from('games').select('id,home_team_id,away_team_id,home_score,away_score,tipoff_at')
      .in('competition_id', ids).in('status', ['final', 'finalising']).order('tipoff_at', { ascending: true }).range(from, from + 999);
    if (r && r.error) throw r.error;
    const rows = (r && r.data) || [];
    rows.forEach(g => games.push(g));
    if (rows.length < 1000) break;
  }
  out.games = games.length;
  if (root.EpinoiaSOS && root.EpinoiaSOS.eloRatings && games.length) {
    try { root.EpinoiaSOS.eloRatings(games).forEach((r, id) => out.elo.set(id, r.elo)); } catch (_) { /* no ELO: the column reads a dash */ }
  }
  const results = new Map(), homeRec = new Map(), awayRec = new Map();
  const add = (m, id, won) => { const c = m.get(id) || [0, 0]; c[won ? 0 : 1]++; m.set(id, c); };
  games.slice().sort((a, b) => String(a.tipoff_at).localeCompare(String(b.tipoff_at))).forEach(g => {
    if (g.home_score == null || g.away_score == null || g.home_score === g.away_score) return;
    const hw = g.home_score > g.away_score;
    [[g.home_team_id, hw, homeRec], [g.away_team_id, !hw, awayRec]].forEach(([id, won, rm]) => {
      if (!results.has(id)) results.set(id, []);
      results.get(id).push(won);
      add(rm, id, won);
    });
  });
  results.forEach((r, id) => { const last = r.slice(-5); out.l5.set(id, last.filter(Boolean).length + '-' + last.filter(x => !x).length); });
  homeRec.forEach((c, id) => out.home.set(id, c[0] + '-' + c[1]));
  awayRec.forEach((c, id) => out.away.set(id, c[0] + '-' + c[1]));
  return out;
}

function items(data, size, crestOf) {
  const SC = root.EpinoiaSocialCard;
  const { L, team } = frame(data, crestOf);
  const out0 = [];
  const out = { push(x) { x.type = TYPE_OF[x.model.kind]; out0.push(x); } };
  const range = rangeLabel(data.since, data.now), ahead = rangeLabel(data.now, data.until);
  const asOf = rangeLabel(data.now, data.now).replace(/^\d+–/, '');
  data.comps.forEach(c => {
    const fin = data.finals.filter(g => g.competition_id === c.id);
    const up = data.upcoming.filter(g => g.competition_id === c.id);
    const stand = data.standings.filter(s => s.competition_id === c.id);
    const comp = data.comps.length > 1 ? c.name : (c.name || L.name);
    if (fin.length) {
      SC.week({ games: fin.map(g => Object.assign({}, g, { home: team(g.home_team_id), away: team(g.away_team_id), perQ: data.perQ.get(g.id) })), league: L, comp, range }, size)
        .forEach(m => out.push({ group: 'week', title: 'Results' + (m.pages > 1 ? ' ' + m.page + '/' + m.pages : '') + (data.comps.length > 1 ? ' · ' + c.name : ''), model: m }));
    }
    if (stand.length && (!c.kind || c.kind === 'league' || c.kind === 'group')) {
      SC.table({ standings: stand.map(s => Object.assign({}, s, { team: team(s.team_id) })), league: L, comp, asOf }, size)
        .forEach(m => out.push({ group: 'week', title: (m.group ? m.group + ' · ' : '') + 'The table' + (m.pages > 1 ? ' ' + m.page + '/' + m.pages : '') +
          (data.comps.length > 1 ? ' · ' + c.name : ''), model: m }));
    }
    if (up.length) {
      SC.fixtures({ games: up.map(g => Object.assign({}, g, { home: team(g.home_team_id), away: team(g.away_team_id) })), league: L, comp, range: ahead }, size)
        .forEach(m => out.push({ group: 'week', title: 'Coming up' + (m.pages > 1 ? ' ' + m.page + '/' + m.pages : '') + (data.comps.length > 1 ? ' · ' + c.name : ''), model: m }));
    }
  });
  data.finals.slice().reverse().forEach(g => {
    const c = data.comps.find(x => x.id === g.competition_id) || {};
    const comp = data.comps.length > 1 ? c.name : (c.name || L.name);
    const base = { game: g, home: team(g.home_team_id), away: team(g.away_team_id), players: data.players.get(g.id) || [],
                   perQ: data.perQ.get(g.id), league: L, comp };
    const r = SC.result(base);
    out.push({ group: 'games', title: r.home.name + ' ' + r.home.score + '–' + r.away.score + ' ' + r.away.name, model: r });
    const p = SC.performer(base);
    if (p) out.push({ group: 'games', title: 'Player of the game · ' + p.player.name, model: p });
  });
  /* the player of the week: the best game score of the week's players of the game, when there was more than a game */
  const stars = out0.filter(x => x.model.kind === 'performer');
  if (stars.length > 1) {
    const best = stars.slice().sort((a, b) => b.model.gameScore - a.model.gameScore)[0].model;
    const g = data.finals.find(x => x.id === best.gameId);
    if (g) {
      const c = data.comps.find(x => x.id === g.competition_id) || {};
      const w = SC.performer({ game: g, home: team(g.home_team_id), away: team(g.away_team_id), players: data.players.get(g.id) || [],
                               league: L, comp: data.comps.length > 1 ? c.name : (c.name || L.name), label: 'Player of the week' });
      if (w) out.push({ group: 'week', title: 'Player of the week · ' + w.player.name, model: w });
    }
  }
  return out0;
}

/* ------------------------------------------------------------- the builder --- */
/* ONE graphic on the builder's terms. sel: { tpl: result | star | table | fixtures | week, gameId, player (an index
   into `players`, or null for the player of the game), compId, page }. Returns { model, reason, ... }: `model` is
   null, with the reason, when the week has nothing for it. A result or a star is about one finished game (the newest
   when none is named) and `players` is that game's lines, best first; the lists are one competition's, cut into
   `pages` graphics for the shape. */
function builderModel(data, sel, size, crestOf) {
  const SC = root.EpinoiaSocialCard, { L, team } = frame(data, crestOf);
  const s = sel || {}, tpl = s.tpl || 'result';
  const compOf = id => data.comps.find(c => c.id === id) || {};
  const nameOf = c => (data.comps.length > 1 ? c.name : (c.name || L.name));
  if (tpl === 'result' || tpl === 'star') {
    const g = data.finals.find(x => x.id === s.gameId) || data.finals[data.finals.length - 1];
    if (!g) return { model: null, reason: 'No game has finished in this week.' };
    const players = (data.players.get(g.id) || []).slice().sort((a, b) => SC.gameScore(b.stats) - SC.gameScore(a.stats));
    const base = { game: g, home: team(g.home_team_id), away: team(g.away_team_id), players, perQ: data.perQ.get(g.id), league: L,
                   comp: nameOf(compOf(g.competition_id)) };
    if (tpl === 'result') return { model: SC.result(base), game: g, players, reason: '' };
    const pick = s.player != null && players[s.player] ? players[s.player] : null;
    const m = SC.performer(pick ? Object.assign({}, base, { pick }) : base);
    return { model: m, game: g, players, reason: m ? '' : 'This game has no player lines to build a star from.' };
  }
  const c = data.comps.find(x => x.id === s.compId) || data.comps[0];
  if (!c) return { model: null, reason: 'This league has no competition in the season on screen.' };
  const comp = nameOf(c), range = rangeLabel(data.since, data.now), ahead = rangeLabel(data.now, data.until);
  const asOf = rangeLabel(data.now, data.now).replace(/^\d+–/, '');
  const games = list => list.filter(g => g.competition_id === c.id).map(g => Object.assign({}, g, { home: team(g.home_team_id), away: team(g.away_team_id), perQ: data.perQ.get(g.id) }));
  const ex = data.extras || null;
  const withExtras = x => Object.assign({}, x, { team: team(x.team_id) }, ex ? { elo: ex.elo.get(x.team_id), l5: ex.l5.get(x.team_id), home: ex.home.get(x.team_id), away: ex.away.get(x.team_id) } : {});
  const models0 = tpl === 'week' ? SC.week({ games: games(data.finals), league: L, comp, range }, size)
    : tpl === 'fixtures' ? SC.fixtures({ games: games(data.upcoming), league: L, comp, range: ahead }, size)
    : SC.table({ standings: data.standings.filter(x => x.competition_id === c.id).map(withExtras), league: L, comp, asOf }, size);
  const models = models0.filter(m => m.rows.length);          // a list with no rows is an empty page, not a graphic
  const page = Math.max(0, Math.min(models.length - 1, +s.page || 0));
  const none = tpl === 'week' ? 'No game finished in this competition in this week.' : tpl === 'fixtures'
    ? 'Nothing is scheduled in this competition in the week ahead.' : (data.offset < 0 ? 'The table is only kept as it stands today, so an earlier week has none.' : 'This competition has no table yet.');
  return { model: models[page] || null, pages: models.length, page, comp: c, reason: models.length ? '' : none };
}

/* ------------------------------------------------------- types and filters --- */
/* The kinds of post, as the Graphics tab sorts them. `stars` is the players of the game and the player of the week. */
const TYPES = [
  { id: 'results', label: 'Game results' }, { id: 'stars', label: 'Stars' }, { id: 'table', label: 'Table' },
  { id: 'ahead', label: 'Week ahead' }, { id: 'roundup', label: 'Results roundup' }
];
const TYPE_OF = { result: 'results', performer: 'stars', table: 'table', fixtures: 'ahead', week: 'roundup' };
/* [{ id, label, n }] for the chips: "all" first, then every type that has anything (a type with none is not offered) */
function counts(list) {
  const rows = [{ id: 'all', label: 'All', n: list.length }];
  TYPES.forEach(t => { const n = list.filter(x => x.type === t.id).length; if (n) rows.push({ id: t.id, label: t.label, n }); });
  return rows;
}
function filterBy(list, type) { return !type || type === 'all' ? list : list.filter(x => x.type === type); }
/* the data as one competition sees it (id '' or 'all': every one) */
function scope(data, compId) {
  if (!compId || compId === 'all') return data;
  const only = a => a.filter(x => x.competition_id === compId);
  return Object.assign({}, data, { comps: data.comps.filter(c => c.id === compId), finals: only(data.finals), upcoming: only(data.upcoming),
    standings: only(data.standings) });
}
/* the week picker's words: "This week", "Last week", "2 weeks ago", and the days it covers */
function weekLabel(offset) {
  const o = Math.min(0, Math.round(+offset || 0));
  return o === 0 ? 'This week' : o === -1 ? 'Last week' : Math.abs(o) + ' weeks ago';
}
const stepWeek = (offset, dir) => Math.max(-52, Math.min(0, (Math.round(+offset || 0)) + dir));

return { read, readExtras, items, builderModel, frame, playerRow, handleOf, rangeLabel, PLAYER_COLS, TYPES, TYPE_OF, counts, filterBy, scope, weekLabel, stepWeek };
}));
