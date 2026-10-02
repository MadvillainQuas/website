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
    /* anybody but the league's administrators (the creator hub): the league's public accounts */
    if (!handle) {
      const pub = await sb.rpc('league_socials_public', { p_league: league.id });
      const r2 = Array.isArray(pub && pub.data) ? pub.data[0] : pub && pub.data;
      handle = handleOf(r2 && r2.instagram);
    }
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

/* every player line of the week's finals, ready for socialcard.js's weekstars() to rank */
function starEntries(data, team) {
  const out = [];
  data.finals.forEach(g => {
    (data.players.get(g.id) || []).forEach(p => {
      const mine = p.team_idx === 0 ? 0 : 1;
      const name = (p.stats.adv && p.stats.adv.name) || '';
      out.push({ key: g.id + ':' + mine + ':' + name, stats: p.stats, name, gameId: g.id,
        team: team(mine ? g.away_team_id : g.home_team_id), opp: team(mine ? g.home_team_id : g.away_team_id),
        teamScore: mine ? g.away_score : g.home_score, oppScore: mine ? g.home_score : g.away_score });
    });
  });
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
  /* the stars of the week: a card of its own (five, ranked), when there were two games or more and three players to rank */
  if (data.finals.length > 1) {
    const w = SC.weekstars({ entries: starEntries(data, team), league: L, comp: data.comps.length > 1 ? 'All competitions' : (data.comps[0] || {}).name || L.name, range });
    if (w.rows.length >= 3) out.push({ group: 'week', title: 'Stars of the week', model: w });
  }
  return out0;
}

/* ---------------------------------------------- the season's lines, and the site's own numbers --- */
/* Every finished game of the competitions (the newest `cap`), with each player's and each side's full stats blob, so the
   site's own engine (season.js, through statcat.js) can work out any column of the catalogue for one game, a week, a month or
   the season. Read with the console's own session (a private league too), forty games to a request. Games first, oldest first;
   `truncated` says the season had more than `cap` finished games and the oldest are not here. */
async function readLines(sb, comps, o) {
  const cap = (o && o.cap) || 800;
  const out = { games: [], pgs: [], tgs: [], teams: new Map(), truncated: false, cap };
  const ids = (comps || []).map(c => c.id);
  if (!ids.length) { out.teamName = () => ''; return out; }
  const g = await sb.from('games').select('id,competition_id,tipoff_at,status,home_score,away_score,home_team_id,away_team_id')
    .in('competition_id', ids).in('status', ['final', 'finalising']).order('tipoff_at', { ascending: false }).range(0, cap);
  if (g && g.error) throw g.error;
  let games = (g && g.data) || [];
  if (games.length > cap) { out.truncated = true; games = games.slice(0, cap); }
  out.games = games.slice().reverse();
  const tids = [...new Set(out.games.flatMap(x => [x.home_team_id, x.away_team_id]).filter(Boolean))];
  for (let i = 0; i < tids.length; i += 200) {
    const tm = await sb.from('teams').select('id,name,short_name,colour,colour_2,logo_path').in('id', tids.slice(i, i + 200));
    ((tm && tm.data) || []).forEach(x => out.teams.set(x.id, x));
  }
  out.teamName = id => (out.teams.get(id) || {}).name || '';
  const chunks = [];
  for (let i = 0; i < out.games.length; i += 40) chunks.push(out.games.slice(i, i + 40).map(x => x.id));
  for (let i = 0; i < chunks.length; i += 4) {
    const parts = await Promise.all(chunks.slice(i, i + 4).map(c => Promise.all([
      sb.from('player_game_stats').select('game_id,player_uuid,player_id,team_idx,stats').in('game_id', c),
      sb.from('team_game_stats').select('game_id,team_idx,stats').in('game_id', c)])));
    parts.forEach(([p, t]) => {
      if (p && p.error) throw p.error;
      ((p && p.data) || []).forEach(r => out.pgs.push(r));
      ((t && t.data) || []).forEach(r => out.tgs.push(r));
    });
  }
  return out;
}

/* THE MONTH, in a zone: the calendar month `offset` months back from now's (0 this month, at most twelve back), from its first
   midnight to the next, both worked in `zone` (the league's own, or the clock the person chose) - so a game late on the 31st in UTC
   is the 1st, and the next month's, in Sydney. { start, end, label, y, m } with start / end as instants. */
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function zoneOffsetMs(t, zone) {
  const p = root.EpinoiaSocialCard.local(new Date(t).toISOString(), zone);
  return Date.UTC(p.y, p.mo, p.d, +p.hh, +p.mm) - Math.floor(t / 60000) * 60000;
}
function zonedMidnight(y, m, d, zone) {
  const guess = Date.UTC(y, m, d), t1 = guess - zoneOffsetMs(guess, zone);
  return guess - zoneOffsetMs(t1, zone);
}
function monthBounds(now, offset, zone) {
  const z = root.EpinoiaSocialCard.validZone(zone) || 'UTC';
  const off = Math.max(-12, Math.min(0, Math.round(+offset || 0)));
  const p = root.EpinoiaSocialCard.local((now || new Date()).toISOString(), z);
  const idx = p.y * 12 + p.mo + off, y = Math.floor(idx / 12), m = ((idx % 12) + 12) % 12;
  const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
  return { start: new Date(zonedMidnight(y, m, 1, z)), end: new Date(zonedMidnight(ny, nm, 1, z)), label: MONTHS_LONG[m] + ' ' + y, y, m, zone: z, offset: off };
}
const stepMonth = (offset, dir) => Math.max(-12, Math.min(0, (Math.round(+offset || 0)) + dir));
/* the ids of the finished games in [start, end) */
function gameSet(lines, start, end) {
  const a = start ? +start : -Infinity, b = end ? +end : Infinity;
  return new Set(lines.games.filter(g => { const t = +new Date(g.tipoff_at); return t >= a && t < b; }).map(g => g.id));
}

/* what the catalogue keys of a model say, as `cat` for socialcard.js: { 'c:ppg': { l: 'PPG', low: false } } */
function catLabels(byId, keys) {
  const cat = {};
  (keys || []).forEach(k => { const c = byId.get(k); if (c) cat[k] = { l: c.label, low: root.EpinoiaStatCat.isLow(c) }; });
  return cat;
}

/* Put the site's own numbers on a model, for the catalogue keys asked (a star's stat lines, a table's columns, a final's team stats,
   a leader's lines): each worked from the game's or the season's lines by season.js, printed as the site prints it. */
function decorate(model, lines, keys, opts) {
  const X = root.EpinoiaStatCat, ks = (keys || []).filter(k => /^c:/.test(k));
  if (!model || !ks.length || !lines || !X) return model;
  const pl = X.byId('player', opts), tm = X.byId('team', opts);
  const cat = Object.assign({}, model.cat), tcat = Object.assign({}, model.tcat);
  const fill = (obj, row, map) => ks.forEach(k => { const c = map.get(k); if (c && row) { obj[k] = X.text(c, row); cat[k] = { l: c.label, low: X.isLow(c) }; } });
  if (model.kind === 'performer') fill(model.stats, X.gameRow(lines, model.gameId, model.player.name, model.idx), pl);
  if (model.kind === 'weekstars') model.rows.forEach(r => { const m = /^(.*?):(\d):/.exec(r.key || ''); if (m && !r.sub) fill(r.stats, X.gameRow(lines, r.gameId, r.name, +m[2]), pl); });
  if (model.kind === 'result' && model.teamStats && model.gameId) {
    const g = lines.games.find(x => x.id === model.gameId), rows = X.rowsOf(lines, new Set([model.gameId])).teams;
    if (g) [['home', g.home_team_id], ['away', g.away_team_id]].forEach(([side, id]) => {
      const row = rows.find(t => t.id === id);
      ks.forEach(k => { const c = tm.get(k); if (c && row) { model.teamStats[side][k] = { v: X.text(c, row), n: X.value(c, row) == null ? -1 : X.value(c, row) }; tcat[k] = { l: c.label, low: X.isLow(c) }; } });
    });
    model.tcat = tcat;               // the team stats' own labels: a key the leaders use too is a player's column there (c:fast is TRANS for a player, FAST for a club)
  }
  /* a final's leaders: each side's leader and top scorers carry the site's numbers for that night too (their stat lines may be any
     column of the catalogue: without this they were drawn as a label with no figure, "27 PTS · PPG") */
  if (model.kind === 'result' && model.gameId) {
    [['top', 'home', 0], ['top', 'away', 1]].forEach(([, side, idx]) => { const t = model.top && model.top[side]; if (t && t.stats) fill(t.stats, X.gameRow(lines, model.gameId, t.name, idx), pl); });
    [['home', 0], ['away', 1]].forEach(([side, idx]) => ((model.scorers && model.scorers[side]) || []).forEach(p => { if (p.stats) fill(p.stats, X.gameRow(lines, model.gameId, p.name, idx), pl); }));
  }
  model.cat = cat;
  return model;
}
/* the season's numbers on a table's standings rows (one row a club, worked over `only`, the games of the season shown) */
function decorateStandings(standings, lines, keys, opts, only) {
  const X = root.EpinoiaStatCat, ks = (keys || []).filter(k => /^c:/.test(k));
  if (!ks.length || !lines) return { standings, cat: {} };
  const tm = X.byId('team', opts), rows = X.rowsOf(lines, only || null).teams, cat = {};
  const out = standings.map(s => { const row = rows.find(t => t.id === s.team_id), x = Object.assign({}, s);
    ks.forEach(k => { const c = tm.get(k); if (c) { x[k] = row ? X.text(c, row) : '—'; cat[k] = { l: c.label, low: X.isLow(c) }; } }); return x; });
  return { standings: out, cat };
}

/* The month's stars. Each player's month worked out by the site's engine over the month's games; ranked by average game score
   (the default), by points a game, by one column of the catalogue (`stat`), or by the person's pick; `minGames` keeps out a
   player who played too little to be a star (0 or 'auto': two fifths of the most anyone played, at least one). Each is shown with the
   catalogue keys asked (per game unless another is chosen) and his best game under his name. Returns the model. */
function monthStars(data, lines, sel, crestOf) {
  const SC = root.EpinoiaSocialCard, X = root.EpinoiaStatCat, { L, team } = frame(data, crestOf);
  const b = sel.bounds, only = gameSet(lines, b.start, b.end);
  const empty = { model: null, reason: 'No game finished in ' + b.label + '.', games: only.size, pool: [] };
  if (!only.size) return empty;
  const pl = X.byId('player', sel.opts), rows = X.rowsOf(lines, only).players;
  const gsOf = new Map(), best = new Map();
  lines.pgs.forEach(r => {
    if (!only.has(r.game_id)) return;
    const id = r.player_uuid || r.player_id, s = r.stats || {};
    if (!id || !(+s.min > 0)) return;
    const gs = SC.gameScore({ pts: s.pts, p2m: s.p2m, p2a: s.p2a, p3m: s.p3m, p3a: s.p3a, fta: s.fta, ftm: s.ftm, or: s.or, dr: s.dr, stl: s.stl, ast: s.ast, blk: s.blk, pf: s.pf, to: s.to });
    const a = gsOf.get(id) || { sum: 0, n: 0 }; a.sum += gs; a.n++; gsOf.set(id, a);
    if (!best.has(id) || gs > best.get(id).gs) best.set(id, { gs, r, s });
  });
  const most = rows.reduce((a, r) => Math.max(a, r.gp || 0), 0);
  const min = sel.minGames > 0 ? +sel.minGames : Math.max(1, Math.ceil(most * 0.4));
  const keys = sel.keys && sel.keys.length ? sel.keys : ['c:ppg', 'c:rpg', 'c:apg'];
  const by = sel.by || 'gs', rankCol = pl.get(sel.stat || 'c:ppg') || pl.get('c:ppg');
  const eligible = rows.filter(r => (r.gp || 0) >= min);
  const teamOf = r => team(r.teamId);
  const entries = eligible.map(r => {
    const bst = best.get(r.id), g = bst && lines.games.find(x => x.id === bst.r.game_id);
    const oppId = g ? (bst.r.team_idx === 0 ? g.away_team_id : g.home_team_id) : null;
    const out = {}; keys.forEach(k => { const c = pl.get(k); if (c) out[k] = X.text(c, r); });
    const score = by === 'stat' ? X.value(rankCol, r) : by === 'pts' ? (r.ppg == null ? null : r.ppg) : (gsOf.get(r.id) ? gsOf.get(r.id).sum / gsOf.get(r.id).n : null);
    return { key: r.id, name: r.name || '', stats: { adv: { name: r.name || '', num: r.jersey } }, out, score, low: by === 'stat' && X.isLow(rankCol),
      team: teamOf(r), sub: 'GP ' + r.gp + (bst ? ' · best ' + bst.s.pts + ' pts v ' + ((data.teams.get(oppId) || lines.teams.get(oppId) || {}).name || '?') : '') };
  }).filter(e => e.score != null);
  const pool = entries.slice().sort((a, c) => c.score - a.score).slice(0, 30).map(e => ({ key: e.key, name: e.name, team: e.team.name, pts: '' }));
  const use = by === 'pick' ? 'pick' : 'score';
  const lowSort = by === 'stat' && X.isLow(rankCol);
  const model = SC.weekstars({ entries, league: L, comp: sel.compLabel || '', range: b.label, by: use, picks: sel.picks, low: lowSort, period: 'month',
    cat: catLabels(pl, keys) });
  return { model: model.rows.length ? model : null, reason: by === 'pick' ? 'Pick up to five players from the month.' : 'No player played ' + min + ' games or more in ' + b.label + '.', games: only.size, pool, min };
}

/* THE LEADERS: the site's league leaders in the categories chosen (any column of the catalogue), players or clubs, over a week, a
   month or the season (`only`: the game ids, or null for every game read). Each board is the top of the column with the site's own
   formatting and direction (lowest first for a lower-is-better column), ties sharing a rank; players under `minGames` are out
   (0 or 'auto': two fifths of the most anyone played). */
function leadersModel(data, lines, sel, crestOf) {
  const SC = root.EpinoiaSocialCard, X = root.EpinoiaStatCat, { L, team } = frame(data, crestOf);
  const teams = sel.subject === 'teams', kind = teams ? 'team' : 'player';
  const only = sel.only || null;
  const rowsAll = X.rowsOf(lines, only), rows = teams ? rowsAll.teams : rowsAll.players;
  const cats = X.byId(kind, sel.opts);
  const keys = (sel.keys && sel.keys.length ? sel.keys : ['c:ppg', 'c:rpg', 'c:apg', 'c:spg', 'c:bpg']).filter(k => cats.has(k)).slice(0, 6);
  const most = rows.reduce((a, r) => Math.max(a, r.gp || 0), 0);
  const min = teams ? 0 : (sel.minGames > 0 ? +sel.minGames : Math.max(1, Math.ceil(most * 0.4)));
  const per = sel.rows > 0 ? sel.rows : (keys.length === 1 ? 10 : 5);
  const boards = keys.map(k => {
    const c = cats.get(k), ranked = X.rank(rows, c, { minGames: min });
    return { key: k, label: c.title && c.title.length <= 26 ? c.title : c.label, low: X.isLow(c),
      rows: ranked.slice(0, Math.max(per, 10)).map(x => ({ rank: x.rank, tie: x.tie, name: x.row.name || '', team: teams ? team(x.row.id) : team(x.row.teamId), value: X.text(c, x.row) })) };
  }).filter(b => b.rows.length);
  return { model: boards.length ? SC.leaders({ boards, league: L, comp: sel.compLabel || '', range: sel.range || '', title: sel.title || 'Leaders', subject: teams ? 'teams' : 'players',
    cat: catLabels(cats, keys) }) : null, reason: 'No games in this scope have these stats yet.', min, games: rowsAll.players.length };
}

/* ------------------------------------------------------------- the builder --- */
/* ONE graphic on the builder's terms. sel: { tpl: result | star | table | fixtures | week, gameId, player (an index
   into `players`, or null for the player of the game), compId, page }. Returns { model, reason, ... }: `model` is
   null, with the reason, when the week has nothing for it. A result or a star is about one finished game (the newest
   when none is named) and `players` is that game's lines, best first; the lists are one competition's, cut into
   `pages` graphics for the shape. */
function builderModel(data, sel, size, crestOf) {
  const r = builderModel0(data, sel, size, crestOf), s = sel || {}, lines = s.lines || data.lines || null;
  /* the site's own numbers for the catalogue keys the modules ask for (a star's lines, a table's columns, a final's team stats) */
  if (r.model && lines && s.need && s.need.length) {
    decorate(r.model, lines, s.need, s.opts);
    if (r.model.kind === 'table') {
      const X = root.EpinoiaStatCat, tm = X.byId('team', s.opts), tr = X.rowsOf(lines, null).teams, cat = Object.assign({}, r.model.cat);
      r.model.rows.forEach(row => { const t = tr.find(x => x.id === row.tid); s.need.forEach(k => { const c = tm.get(k); if (c) { row[k] = t ? X.text(c, t) : '—'; cat[k] = { l: c.label, low: X.isLow(c) }; } }); });
      r.model.cat = cat;
    }
  }
  return r;
}
function builderModel0(data, sel, size, crestOf) {
  const SC = root.EpinoiaSocialCard;
  const s = sel || {}, tpl = s.tpl || 'result';
  const lines = s.lines || data.lines || null;
  if (lines && lines.teams) lines.teams.forEach((t, id) => { if (!data.teams.has(id)) data.teams.set(id, t); });
  const { L, team } = frame(data, crestOf);
  if (tpl === 'monthstars' || tpl === 'leaders') {
    if (!lines) return { model: null, reason: 'Reading the season\'s games…', needsLines: true };
    const compLabel = data.comps.length > 1 ? 'All competitions' : (data.comps[0] || {}).name || L.name;
    if (tpl === 'monthstars') return monthStars(data, lines, Object.assign({}, s, { compLabel }), crestOf);
    const scope = s.scope || 'season';
    const only = scope === 'week' ? new Set(data.finals.map(g => g.id)) : scope === 'month' ? gameSet(lines, s.bounds && s.bounds.start, s.bounds && s.bounds.end) : null;
    const range = scope === 'week' ? rangeLabel(data.since, data.now) : scope === 'month' ? (s.bounds && s.bounds.label) || '' : (s.seasonName || 'Season');
    const title = scope === 'week' ? 'Leaders of the week' : scope === 'month' ? (s.bounds ? MONTHS_LONG[s.bounds.m] : 'Month') + ' leaders' : 'Season leaders';
    return leadersModel(data, lines, Object.assign({}, s, { compLabel, only, range, title }), crestOf);
  }
  if (tpl === 'weekstars') {
    const entries = starEntries(data, team);
    const comp = data.comps.length > 1 ? 'All competitions' : (data.comps[0] || {}).name || L.name;
    const model = SC.weekstars({ entries, league: L, comp, range: rangeLabel(data.since, data.now), by: s.by, picks: s.picks });
    /* the week's players to pick from, best first (a player once, his best game) */
    const cands = SC.weekstars({ entries, league: L, by: 'gs' });
    const all = entries.slice().sort((a, b) => SC.gameScore(b.stats) - SC.gameScore(a.stats)), seen = new Set(), pool = [];
    all.forEach(e => { const k = e.name + '|' + e.team.name; if (!seen.has(k)) { seen.add(k); pool.push({ key: e.key, name: e.name, team: e.team.name, pts: e.stats.pts }); } });
    void cands;
    return { model: model.rows.length ? model : null, pool: pool.slice(0, 20), reason: s.by === 'pick' ? 'Pick up to five players from the week.' : 'No player lines in this week.' };
  }
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
    : SC.table({ standings: data.standings.filter(x => x.competition_id === c.id).map(withExtras), league: L, comp, asOf, order: s.order === 'official' ? 'official' : 'pct' }, size);
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
  { id: 'ahead', label: 'Week ahead' }, { id: 'roundup', label: 'Results roundup' }, { id: 'leaders', label: 'Leaders' }
];
const TYPE_OF = { result: 'results', performer: 'stars', weekstars: 'stars', leaders: 'leaders', table: 'table', fixtures: 'ahead', week: 'roundup' };
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

return { read, readExtras, readLines, monthBounds, stepMonth, gameSet, decorate, decorateStandings, monthStars, leadersModel, catLabels, items, builderModel, frame, playerRow, handleOf, rangeLabel, PLAYER_COLS, TYPES, TYPE_OF, counts, filterBy, scope, weekLabel, stepWeek };
}));
