/* ============================================================================
   THE LEAGUE NEWSDESK, BUILT (epinoia/narrative.js). I/O only: every judgement is the module's.

     SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node tools/build-narratives.mjs        the hourly run (.github/workflows/narratives.yml)
     … --dry-run                    read and build, write nothing
     … --league <slug>              that league only, whether it is due or not
     node tools/build-narratives.mjs --local --league <slug> [--print] [--out <file>]
                                    REAL data, read-only, with the publishable key: the build printed (or written to a
                                    file), nothing uploaded

   WHAT IT READS. Everything with the PUBLISHABLE key - exactly what a signed-out reader may read, so a private or a
   members-only league never reaches a public file - and the service key only to write (the public file and the index)
   and to keep its own cache (the private bucket):
     the leagues, their newest season and competitions, the table           a few small reads
     the season's finished games and the games to come                       light columns
     every finished game's player lines and team lines                       named keys only, never the stats blob
     the names of the players in them                                         players, a hundred at a time
     the league's What Wins weights                                           the public file (CDN)
     the fans' picks for the games to come                                     one prediction_tally
     the recaps: each finished game of the last week is replayed once from its events file (the CDN) through the match
     report engine (engine.js -> story.js -> report.js) and kept in the cache, so a game is never replayed twice
     the last build                                                           the public file it is about to replace

   WHEN A LEAGUE IS BUILT. Not every league every hour: one read finds the games finished since the last run, and a
   league is due when it has one, when its file is six hours old (the slate and the briefing move with the clock), or
   when it has none. A run stops cleanly past its budget; what is left is due next hour.

   WHAT IT WRITES. snapshots/narrative/<league id>.json (public, ten minutes in a browser) and
   snapshots/narrative/index.json (every built league: slug, built, token). The cache:
   analytics/narrative-cache/<league id>.json (service role only).
   ============================================================================ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
const DEFAULT_URL = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
const PUBLIC_BUCKET = 'snapshots', PRIVATE_BUCKET = 'analytics';
const HOUR = 3600000, DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

/* the page's own modules, as a browser loads them */
export function load(url) {
  globalThis.window = globalThis;
  globalThis.EPINOIA_CONFIG = { supabaseUrl: url || DEFAULT_URL, supabaseAnonKey: PUBLISHABLE };
  const g = (name, file) => { globalThis[name] = require(path.join(ROOT, 'epinoia', file)); return globalThis[name]; };
  g('EpinoiaSeason', 'season.js');
  try { g('EpinoiaData', 'data.js'); } catch (_) { /* the season file is a nicety: names and BPM */ }
  g('EpinoiaEngine', 'engine.js'); g('EpinoiaPossessions', 'possessions.js'); g('EpinoiaSituations', 'situations.js');
  try { g('EpinoiaShotClock', 'shotclock.js'); } catch (_) { /* no shot clock here */ }
  try { g('EpinoiaConnections', path.join('game', 'connections.js')); } catch (_) { /* no connections here */ }
  g('EpinoiaGamePctData', 'gamepct-data.js'); g('EpinoiaGamePct', 'gamepct.js'); g('EpinoiaBPM', 'bpm.js');
  g('EpinoiaLanguage', path.join('game', 'language.js')); g('EpinoiaStory', path.join('game', 'story.js'));
  g('EpinoiaReport', path.join('game', 'report.js')); g('EpinoiaContext', path.join('game', 'context.js'));
  return g('EpinoiaNarrative', 'narrative.js');
}

/* PostgREST and Storage: reads with the publishable key, writes with the service key */
function client(url, readKey, writeKey, f) {
  const base = String(url).replace(/\/+$/, '');
  const hdr = k => ({ apikey: k, Authorization: 'Bearer ' + k });
  const rest = async (p, init) => {
    for (let attempt = 0; ; attempt++) {
      const r = await f(base + '/rest/v1/' + p, Object.assign({}, init, { headers: Object.assign({ Accept: 'application/json' }, hdr(readKey), (init || {}).headers || {}) }));
      if (r.ok) { const t = await r.text(); return t ? JSON.parse(t) : null; }
      /* a statement timeout is not retried: it is load, and asking again is more of it */
      const body = String(await r.text()).slice(0, 200);
      if (attempt < 2 && (r.status === 502 || r.status === 503 || r.status === 504) && !/57014/.test(body)) { await new Promise(res => setTimeout(res, 800 * (attempt + 1))); continue; }
      throw new Error(p.split('?')[0] + ': ' + r.status + ' ' + body);
    }
  };
  const restAll = async (p, page) => {
    const n = page || 1000, out = [];
    for (let off = 0; ; off += n) {
      const rows = await rest(p + (p.includes('?') ? '&' : '?') + 'limit=' + n + '&offset=' + off);
      out.push(...(rows || []));
      if (!rows || rows.length < n) return out;
    }
  };
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const publicJson = async p => {
    const r = await f(base + '/storage/v1/object/public/' + enc(p));
    if (!r.ok) return null;
    try { return await r.json(); } catch (_) { return null; }
  };
  const upload = async (bucket, p, body, maxAge) => {
    if (!writeKey) throw new Error('no service key to write with');
    const r = await f(base + '/storage/v1/object/' + bucket + '/' + enc(p), { method: 'POST', body,
      headers: Object.assign({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': maxAge ? 'max-age=' + maxAge : 'private, no-store' }, hdr(writeKey)) });
    if (!r.ok) throw new Error('upload ' + p + ': ' + r.status + ' ' + String(await r.text()).slice(0, 200));
  };
  const download = async (bucket, p) => {
    if (!writeKey) return null;
    const r = await f(base + '/storage/v1/object/' + bucket + '/' + enc(p), { headers: hdr(writeKey) });
    if (!r.ok) return null;
    try { return await r.json(); } catch (_) { return null; }
  };
  return { rest, restAll, publicJson, upload, download, base };
}

/* --------------------------------------------------------------------------------------------- one league --- */
const ADV_KEYS = ['efg', 'tovp', 'orebp', 'ftr', 'possessions', 'fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm', 'oreb', 'dreb', 'tov', 'rimA', 'rimM', 'midA', 'midM', 'pace'];
const TL_SELECT = 'game_id,team_idx,' + ADV_KEYS.map(k => k + ':stats->adv->' + k).join(',');
const PL_SELECT = 'game_id,team_idx,player_uuid,player_id,min:stats->min,pts:stats->pts,or:stats->or,dr:stats->dr,ast:stats->ast,stl:stats->stl,blk:stats->blk,p3m:stats->p3m';
const GAME_SELECT = 'id,home_team_id,away_team_id,home_score,away_score,tipoff_at,attendance,competition_id,finalised_at';

async function readLeague(api, lg, o) {
  const log = o.log;
  const seasons = await api.rest(`seasons?league_id=eq.${lg.id}&select=id,name,starts_on&order=starts_on.desc&limit=1`);
  const season = seasons && seasons[0];
  if (!season) return null;
  const comps = (await api.rest(`competitions?season_id=eq.${season.id}&select=*&order=name`)) || [];
  if (!comps.length) return null;
  const ids = comps.map(c => c.id);
  const leagueComp = comps.find(c => (c.kind || 'league') === 'league') || comps[0];
  const games = await api.restAll(`games?competition_id=in.(${ids.join(',')})&status=eq.final&select=${GAME_SELECT}&order=tipoff_at`);
  const nowIso = new Date(o.nowMs).toISOString(), until = new Date(o.nowMs + 21 * DAY).toISOString();
  const fixtures = (await api.rest(`games?competition_id=in.(${ids.join(',')})&status=eq.scheduled&tipoff_at=gte.${encodeURIComponent(nowIso)}` +
    `&tipoff_at=lte.${encodeURIComponent(until)}&select=id,home_team_id,away_team_id,tipoff_at,competition_id&order=tipoff_at&limit=300`)) || [];
  const table = await api.rest(`standings?competition_id=eq.${leagueComp.id}&select=team_id,rank,gp,w,l,pts_for,pts_against,diff,league_points,group_name&order=group_name.asc.nullsfirst,rank.asc.nullslast`).catch(() => []);
  const teamIds = [...new Set(games.concat(fixtures).flatMap(g => [g.home_team_id, g.away_team_id]).concat((table || []).map(r => r.team_id)).filter(Boolean))];
  const teams = {};
  for (const c of chunks(teamIds, 100)) ((await api.rest(`teams?id=in.(${c.join(',')})&select=id,name,short_name,slug`)) || []).forEach(t => { teams[t.id] = t; });
  const gids = games.map(g => g.id);
  const lines = [], teamLines = [];
  for (const c of chunks(gids, 40)) {
    (await api.restAll(`player_game_stats?game_id=in.(${c.join(',')})&select=${PL_SELECT}`)).forEach(r => {
      const pid = r.player_uuid || r.player_id;
      if (pid) lines.push({ game_id: r.game_id, team_idx: r.team_idx, pid, min: r.min, pts: r.pts, reb: (r.or || 0) + (r.dr || 0), ast: r.ast, stl: r.stl, blk: r.blk, p3m: r.p3m });
    });
    ((await api.rest(`team_game_stats?game_id=in.(${c.join(',')})&select=${TL_SELECT}`)) || []).forEach(r => {
      const adv = {};
      ADV_KEYS.forEach(k => { if (r[k] != null) adv[k] = r[k]; });
      teamLines.push({ game_id: r.game_id, team_idx: r.team_idx, adv });
    });
  }
  /* THE SEASON FILE (the latest built: data.js latestSeason): every player's season line with his BPM, and the names of
     everybody on it, so the players are not asked for one by one */
  let season0 = null;
  try { season0 = globalThis.EpinoiaData && globalThis.EpinoiaData.latestSeason ? await globalThis.EpinoiaData.latestSeason(ids) : null; } catch (_) { season0 = null; }
  const names = {};
  const meta = season0 && season0.meta ? season0.meta : null;
  if (meta) (meta instanceof Map ? [...meta.entries()] : Object.entries(meta)).forEach(([id, m]) => { if (m && m.name && !m.unregistered) names[id] = { name: m.name, slug: m.slug || null }; });
  /* the rest: a register id the file did not name (a feed's own "side:shirt" ids have no name to ask for) */
  const pids = [...new Set(lines.map(l => l.pid))].filter(id => UUID.test(id) && !names[id]);
  for (const c of chunks(pids, 100)) ((await api.rest(`players?id=in.(${c.join(',')})&select=id,first_name,last_name,slug`)) || []).forEach(p => {
    const n = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (n) names[p.id] = { name: n, slug: p.slug || null };
  });
  const players = season0 && Array.isArray(season0.players) ? season0.players : [];
  const model = await api.publicJson('snapshots/whatwins-explain/' + lg.id + '.json').then(m => (m && m.b && String(m.league) === String(lg.id) ? m : null)).catch(() => null);
  /* the fans' picks: for the games to come (the slate) and the last three weeks' results (the fans' record) */
  let tallies = {};
  const recent = games.filter(g => Date.parse(g.tipoff_at) >= o.nowMs - 21 * DAY).map(g => g.id).slice(-100);
  const pickIds = fixtures.slice(0, 100).map(f => f.id).concat(recent);
  if (pickIds.length) {
    try {
      const rows = await api.rest('rpc/prediction_tally', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_games: pickIds }) });
      (rows || []).forEach(r => { tallies[r.game_id] = { home: +r.home || 0, away: +r.away || 0 }; });
    } catch (_) { tallies = {}; }
  }
  log && log('  ' + lg.slug + ': ' + games.length + ' games, ' + fixtures.length + ' to come, ' + lines.length + ' player lines, ' + (model ? 'the league’s model' : 'fixed weights'));
  return { season, comps, leagueComp, games, fixtures, table: { comp: leagueComp, rows: table || [] }, teams, lines, teamLines, names, model, tallies, players };
}

/* ONE GAME, REPLAYED: the match report's headline, standfirst, shape, decisive facet and moment, from the events file */
async function recapOf(api, g, D, lg, o) {
  const E = globalThis.EpinoiaEngine, R = globalThis.EpinoiaReport, St = globalThis.EpinoiaStory, Cx = globalThis.EpinoiaContext;
  const [row] = (await api.rest(`games?id=eq.${g.id}&select=roster_snapshot,starters,tip_winner,arrow_init,period,venue,attendance,tipoff_at`)) || [];
  if (!row || !row.roster_snapshot || !row.roster_snapshot.teams) return null;
  const file = await api.publicJson('snapshots/events/' + g.id + '.json');
  if (!file || file.game !== g.id || !Array.isArray(file.rows) || !file.rows.length) return null;
  const events = file.rows.map(r => Object.assign({ t: r.t, id: r.seq, seq: r.seq, period: r.period, clock: r.clock }, r.payload || {},
    r.team != null ? { team: r.team } : {}, r.pid != null ? { pid: r.pid } : {}));
  const S = { teams: row.roster_snapshot.teams, starters: row.starters || [[], []], events, period: row.period || 4, clockMs: 0, phase: 'final',
    tipWinner: row.tip_winner, arrowInit: row.arrow_init };
  const d = E.deriveGame(S);
  const players = [], byId = {};
  S.teams.forEach((tm, t) => (tm.players || []).forEach(p => {
    const s = d.stats[p.id] || {};
    const fga = (s.p2a || 0) + (s.p3a || 0), den = 2 * (fga + 0.44 * (s.fta || 0));
    const r = Object.assign({}, s, { id: p.id, name: p.name, num: p.num, team: t, ts: den ? (s.pts || 0) / den * 100 : null });
    players.push(r); byId[p.id] = r;
  }));
  let periods = 1;
  events.forEach(e => { if (e.period > periods) periods = e.period; });
  const tabs = globalThis.EpinoiaGameFacts && globalThis.EpinoiaGameFacts.tabInputs ? globalThis.EpinoiaGameFacts.tabInputs(S) : {};
  const brief = { names: [S.teams[0].name, S.teams[1].name], score: d.score.slice(), players, byId, team: [d.team[0], d.team[1]],
    adv: [E.teamAdv(S, d, 0), E.teamAdv(S, d, 1)], lineups: [E.lineupAgg(d, 0), E.lineupAgg(d, 1)], stints: [d.lineups[0] || [], d.lineups[1] || []],
    perQ: d.perQ, periods, events, reg: (d.format && d.format.periods) || 4, starters: S.starters,
    sits: tabs.sits || null, assists: tabs.assists || null, sitPlayers: tabs.sitPlayers || null, connections: tabs.connections || null, clock: tabs.clock || null, atop: tabs.atop || null,
    meta: { venue: row.venue, attendance: row.attendance, tipoff_at: row.tipoff_at, competition: null, league: lg.name, leagueSlug: lg.slug, timezone: lg.timezone || null },
    model: D.model || null };
  /* the game in its season, from what the league read already holds */
  try {
    brief.ctx = Cx.build({ gameId: g.id, tipoff: g.tipoff_at, home: g.home_team_id, away: g.away_team_id, score: brief.score,
      games: D.games, pgs: D.lines.map(l => ({ game_id: l.game_id, team_idx: l.team_idx, player_uuid: l.pid, stats: { pts: l.pts, min: l.min, or: l.reb, dr: 0, ast: l.ast, stl: l.stl, blk: l.blk, p3m: l.p3m } })),
      tgs: D.teamLines.map(t => ({ game_id: t.game_id, team_idx: t.team_idx, stats: { adv: t.adv } })), table: D.table, fixtures: D.fixtures,
      teamNames: D.teams, model: D.model, competitionId: g.competition_id, attendance: g.attendance });
  } catch (_) { brief.ctx = null; }
  const rep = R.report(brief);
  const fs0 = rep.facts || St.facts(brief);
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const arc = fs0.find(f => f.kind === 'arc');
  const L = fs0.find(f => f.kind === 'ledger');
  const mo = fs0.find(f => f.kind === 'gameWinner') || fs0.find(f => f.kind === 'goAhead' && f.data.left <= 300000);
  const dec = L && L.data.decisive ? { key: L.data.decisive.key, label: L.data.decisive.label, pts: Math.round(Math.abs(L.data.decisive.pts) * 10) / 10 } : null;
  return { headline: strip(rep.headline), standfirst: strip(rep.standfirst), arc: arc ? arc.data.kind : null, decisive: dec,
           moment: mo && mo.data.p ? { kind: mo.kind, name: mo.data.p.name, clock: mo.data.clock } : null, v: 1 };
}

/* ----------------------------------------------------------------------------------------------- one build --- */
export async function buildLeague(api, lg, o) {
  const N = globalThis.EpinoiaNarrative;
  const D = await readLeague(api, lg, o);
  if (!D) return null;
  const cache = (o.cache && o.cache.league === lg.id ? o.cache : null) || { league: lg.id, recaps: {} };
  /* the recaps: the last week's games, each replayed once */
  const week = D.games.filter(g => Date.parse(g.tipoff_at) >= o.nowMs - 8 * DAY);
  let replayed = 0;
  for (const g of week.slice().reverse()) {
    const key = g.id + '@' + (g.finalised_at || '');
    if (cache.recaps[g.id] && cache.recaps[g.id].key === key) continue;
    if (replayed >= (o.maxReplays || 24)) break;
    try {
      const r = await recapOf(api, g, D, lg, o);
      if (r) { cache.recaps[g.id] = Object.assign(r, { key }); replayed++; }
    } catch (e) { o.log && o.log('    recap ' + g.id.slice(0, 8) + ' failed: ' + String(e.message || e).slice(0, 120)); }
  }
  /* the cache keeps a fortnight */
  Object.keys(cache.recaps).forEach(id => { if (!D.games.some(g => g.id === id && Date.parse(g.tipoff_at) >= o.nowMs - 15 * DAY)) delete cache.recaps[id]; });
  const recaps = {};
  Object.keys(cache.recaps).forEach(id => { const r = cache.recaps[id]; recaps[id] = { headline: r.headline, standfirst: r.standfirst, arc: r.arc, decisive: r.decisive, moment: r.moment }; });
  const previous = o.previous !== undefined ? o.previous : await api.publicJson('snapshots/narrative/' + lg.id + '.json').catch(() => null);
  const out = N.build({ now: new Date(o.nowMs), league: { id: lg.id, slug: lg.slug, name: lg.name, timezone: lg.timezone || null },
    season: { id: D.season.id, name: D.season.name }, comp: D.leagueComp, table: D.table, teams: D.teams, games: D.games, fixtures: D.fixtures,
    lines: D.lines, teamLines: D.teamLines, names: D.names, players: D.players, recaps, model: D.model, tallies: D.tallies, previous });
  out.token = D.games.length + '@' + D.games.reduce((m, g) => (g.finalised_at && g.finalised_at > m ? g.finalised_at : m), '');
  o.log && o.log('    ' + out.stories.length + ' storylines, ' + replayed + ' games replayed, top: ' + (out.stories[0] ? out.stories[0].head : '(none)'));
  return { out, cache };
}

/* =============================================================================================== run === */
export async function run(opts) {
  const o = opts || {};
  const log = o.log || (m => console.log(m));
  const url = String(o.url || DEFAULT_URL).replace(/\/+$/, '');
  const f = o.fetch || globalThis.fetch;
  const nowMs = o.now ? Date.parse(o.now) : Date.now();
  load(url);
  const api = client(url, PUBLISHABLE, o.local ? null : o.serviceKey, f);
  const runStart = Date.now(), deadline = runStart + (o.budgetMin != null ? +o.budgetMin : 30) * 60000;
  const write = !o.local && !o.dryRun;
  if (!o.local && !o.serviceKey && !o.dryRun) { log('no SUPABASE_SERVICE_KEY: nothing to write with (use --local or --dry-run)'); return { built: [] }; }

  /* the leagues a signed-out reader may read */
  const leagues = (await api.rest('leagues?select=id,slug,name,timezone&order=slug')) || [];
  const index = (await api.publicJson('snapshots/narrative/index.json').catch(() => null)) || { v: 1, leagues: {} };
  let due = [];
  if (o.league) due = leagues.filter(l => l.slug === o.league || l.id === o.league);
  else {
    /* the games finished since the last run, mapped to their leagues: one read of the games, one of the competitions */
    const since = new Date(Math.min(nowMs - 2 * HOUR, Date.parse(index.built || 0) - HOUR || nowMs - 2 * HOUR)).toISOString();
    const fresh = (await api.rest(`games?status=eq.final&finalised_at=gte.${encodeURIComponent(since)}&select=competition_id&limit=2000`)) || [];
    const compIds = [...new Set(fresh.map(g => g.competition_id).filter(Boolean))];
    const leagueOf = new Map();
    for (const c of chunks(compIds, 100)) ((await api.rest(`competitions?id=in.(${c.join(',')})&select=id,seasons(league_id)`)) || []).forEach(r => leagueOf.set(r.id, r.seasons && r.seasons.league_id));
    const changed = new Set(compIds.map(id => leagueOf.get(id)).filter(Boolean));
    /* a league is active when it has a game in the last 45 days or the next 21 */
    const lo = new Date(nowMs - 45 * DAY).toISOString(), hi = new Date(nowMs + 21 * DAY).toISOString();
    const activeGames = (await api.restAll(`games?tipoff_at=gte.${encodeURIComponent(lo)}&tipoff_at=lte.${encodeURIComponent(hi)}&select=competition_id`)) || [];
    const activeComps = [...new Set(activeGames.map(g => g.competition_id).filter(Boolean))].filter(id => !leagueOf.has(id));
    for (const c of chunks(activeComps, 100)) ((await api.rest(`competitions?id=in.(${c.join(',')})&select=id,seasons(league_id)`)) || []).forEach(r => leagueOf.set(r.id, r.seasons && r.seasons.league_id));
    const active = new Set(activeGames.map(g => leagueOf.get(g.competition_id)).filter(Boolean));
    due = leagues.filter(l => active.has(l.id)).map(l => {
      const at = index.leagues && index.leagues[l.id] ? Date.parse(index.leagues[l.id].built) : 0;
      const why = changed.has(l.id) ? 'new results' : !at ? 'never built' : nowMs - at > 6 * HOUR ? 'six hours' : null;
      return why ? Object.assign({ why, at }, l) : null;
    }).filter(Boolean).sort((a, b) => (a.why === 'new results' ? 0 : 1) - (b.why === 'new results' ? 0 : 1) || a.at - b.at);
  }
  log('narratives: ' + due.length + ' league(s) due' + (due.length ? ': ' + due.map(l => l.slug + (l.why ? ' (' + l.why + ')' : '')).join(', ') : ''));

  const built = [], failed = [];
  for (const lg of due) {
    if (Date.now() > deadline) { log('budget reached: the rest stay due'); break; }
    try {
      const cache = write ? await api.download(PRIVATE_BUCKET, 'narrative-cache/' + lg.id + '.json') : null;
      const res = await buildLeague(api, lg, { nowMs, log, cache, maxReplays: o.maxReplays, previous: o.local ? (o.previous || null) : undefined });
      if (!res) { log('  ' + lg.slug + ': no season'); continue; }
      const body = JSON.stringify(res.out);
      if (write) {
        await api.upload(PUBLIC_BUCKET, 'narrative/' + lg.id + '.json', body, 600);
        await api.upload(PRIVATE_BUCKET, 'narrative-cache/' + lg.id + '.json', JSON.stringify(res.cache), 0);
        index.leagues = index.leagues || {};
        index.leagues[lg.id] = { slug: lg.slug, built: res.out.built, token: res.out.token, stories: res.out.stories.length };
      }
      if (o.out) fs.writeFileSync(o.out, body);
      if (o.print) printBuild(res.out, log);
      built.push({ league: lg.slug, bytes: body.length, stories: res.out.stories.length });
    } catch (e) {
      failed.push({ league: lg.slug, error: String(e.message || e).slice(0, 200) });
      log('  ' + lg.slug + ' FAILED: ' + String(e.message || e).slice(0, 200));
    }
  }
  if (write && built.length) {
    index.v = 1; index.built = new Date(nowMs).toISOString();
    await api.upload(PUBLIC_BUCKET, 'narrative/index.json', JSON.stringify(index), 300);
  }
  const summary = 'narratives: built ' + built.length + ', failed ' + failed.length + ' in ' + Math.round((Date.now() - runStart) / 1000) + ' s';
  log(summary);
  if (process.env.GITHUB_STEP_SUMMARY && !o.fetch) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n'); } catch (_) { /* not in Actions */ } }
  return { built, failed, summary };
}

/* the build, as text, to read */
function printBuild(b, log) {
  log('\n' + '='.repeat(78) + '\n' + (b.league ? b.league.name : '') + ' — ' + (b.season ? b.season.name : '') + '   built ' + b.built);
  log('\nBRIEFING\n  ' + b.briefing.lines.join('\n  '));
  log('\nSTORYLINES');
  b.stories.slice(0, 14).forEach(s => {
    log('\n  #' + s.rank + ' [' + s.kind + ' · ' + s.status + ' v' + s.version + ' · ' + s.score + ']  ' + s.kicker.toUpperCase());
    log('  ' + s.head);
    if (s.dek) log('    ' + s.dek);
    if (s.why) log('    Why it matters: ' + s.why);
    if (s.numbers && s.numbers.length) log('    By the numbers: ' + s.numbers.map(n => n.label + ' ' + n.value).join(' | '));
    if (s.counter) log('    Yes, but: ' + s.counter);
    if (s.next) log('    What’s next: ' + s.next);
    if (s.change) log('    (' + s.change + ')');
  });
  const c = b.coverage;
  log('\nCOVERAGE — the big picture\n  ' + c.bigPicture.join('\n  '));
  log('\nCOVERAGE — the slate');
  c.slate.slice(0, 8).forEach(s => log('  ' + s.day + ': ' + s.title + ' [stakes ' + s.stakes + ']' + (s.angle ? ' — ' + s.angle : '') + (s.expect ? ' — expected ' + s.expect.margin : '') + ' — ' + s.plan.join(', ')));
  log('\nCOVERAGE — recaps worth writing');
  c.recaps.slice(0, 6).forEach(r => log('  [' + r.score + '] ' + r.headline + (r.angle ? ' — ' + r.angle : '')));
  log('\nCOVERAGE — data notes');
  c.notes.forEach(n => log('  ' + n.head + ': ' + n.line));
  log('\nCOVERAGE — calendar');
  c.calendar.forEach(d => log('  ' + d.day + ': ' + d.items.map(i => i.what).join(' | ')));
  log('\nstats ' + JSON.stringify(b.stats));
}

/* ------------------------------------------------------------------------------------------------- the CLI --- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const flag = k => a.indexOf(k) >= 0;
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const env = k => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : null);
  run({ url: env('SUPABASE_URL') || DEFAULT_URL, serviceKey: env('SUPABASE_SERVICE_KEY'), local: flag('--local'), dryRun: flag('--dry-run'),
        league: val('--league'), print: flag('--print') || flag('--local'), out: val('--out'), budgetMin: val('--budget-min'), maxReplays: val('--max-replays') ? +val('--max-replays') : undefined })
    .then(r => { if (r && r.failed && r.failed.length && !r.built.length) process.exitCode = 1; })
    .catch(e => { console.error(e); process.exitCode = 1; });
}
