'use strict';
/* ============================================================================
   One place that fetches, one place that aggregates.

   Every page used to run its own PostgREST query against a slightly different
   view, which is how the leaders board and the season page ended up able to
   disagree. Now they all pull the same per-game rows and hand them to
   league/season.js, so a column means the same thing everywhere and there is
   one place to fix a mistake.

   Rows are paged: PostgREST caps a response, and a full season of
   player_game_stats runs past the default limit. A silent truncation would
   produce a season table that is quietly short of games, which is worse than
   one that fails.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideData = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

function CFG() {
  const c = (typeof window !== 'undefined' && window.COURTSIDE_CONFIG) || null;
  if (!c) throw new Error('config.js has not loaded');
  return c;
}

async function get(path) {
  const c = CFG();
  const r = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    cache: 'no-store',
    headers: { apikey: c.supabaseAnonKey, Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`${r.status} on ${path.split('?')[0]}`);
  return r.json();
}

/* PostgREST returns at most `limit` rows; walk until a short page comes back */
async function all(path, page = 1000) {
  let out = [], from = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const chunk = await get(`${path}${sep}offset=${from}&limit=${page}`);
    out = out.concat(chunk);
    if (chunk.length < page) return out;
    from += page;
  }
}

/* ------------------------------------------------------------- a season ---- */
/* Returns everything the pages need for one competition, aggregated once. */
async function season(competitionId) {
  const games = await all(`games?competition_id=eq.${competitionId}` +
    `&status=eq.final&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at`);
  if (!games.length) return { games: [], players: [], teams: [], byId: {} };

  const ids = games.map(g => g.id);
  /* chunked so the `in.()` filter cannot outgrow a URL on a long season */
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));

  const pgsParts = await Promise.all(chunks.map(c =>
    all(`player_game_stats?game_id=in.(${c.join(',')})` +
        `&select=game_id,player_uuid,player_id,team_idx,stats`)));
  const tgsParts = await Promise.all(chunks.map(c =>
    all(`team_game_stats?game_id=in.(${c.join(',')})&select=game_id,team_idx,stats`)));

  const pgs = pgsParts.flat(), tgs = tgsParts.flat();
  const byId = {};
  games.forEach(g => { byId[g.id] = g; });

  const S = window.CourtsideSeason;
  const players = S.players(pgs, tgs);
  const teamRows = S.teams(tgs, byId);

  /* Which club each player belongs to, taken from the games they actually
     played — a season row has no side of its own, because a side is a property
     of a game. Last one wins, so a player who transferred is attributed to
     where they finished, which is what a season table shows. */
  const teamOfPlayer = new Map();
  pgs.forEach(r => {
    const g = byId[r.game_id];
    const pid = r.player_uuid || r.player_id;
    if (!g || !pid) return;
    teamOfPlayer.set(pid, r.team_idx === 0 ? g.home_team_id : g.away_team_id);
  });

  S.attachBPM(players, teamRows, teamOfPlayer);

  return { games, byId, pgs, tgs, players, teams: teamRows, teamOfPlayer };
}

/* ------------------------------------------------------ a window of games ---
   The same aggregation as season(), over an arbitrary set of games. This is
   what "form over the last month" is: not a different statistic, the same one
   over fewer games, so it goes through the same code and cannot disagree with
   the season table about what a rebound is.
   ============================================================================ */
async function statsForGames(games) {
  if (!games || !games.length) return { players: [], teams: [], byId: {} };
  const ids = games.map(g => g.id);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));

  const [pgsParts, tgsParts] = await Promise.all([
    Promise.all(chunks.map(c => all(`player_game_stats?game_id=in.(${c.join(',')})` +
      `&select=game_id,player_uuid,player_id,team_idx,stats`))),
    Promise.all(chunks.map(c => all(`team_game_stats?game_id=in.(${c.join(',')})` +
      `&select=game_id,team_idx,stats`)))
  ]);
  const pgs = pgsParts.flat(), tgs = tgsParts.flat();
  const byId = {};
  games.forEach(g => { byId[g.id] = g; });

  const S = window.CourtsideSeason;
  const players = S.players(pgs, tgs);
  const teamRows = S.teams(tgs, byId);

  const teamOfPlayer = new Map();
  pgs.forEach(r => {
    const g = byId[r.game_id];
    const pid = r.player_uuid || r.player_id;
    if (!g || !pid) return;
    teamOfPlayer.set(pid, r.team_idx === 0 ? g.home_team_id : g.away_team_id);
  });
  S.attachBPM(players, teamRows, teamOfPlayer);

  return { players, teams: teamRows, byId, teamOfPlayer, games };
}

/* Every stint for a team's games. This is what WOWY, the lineup filter and the
   lineup list all read — each row carries the five on the floor and what
   happened while they were, which is the only shape those questions can be
   answered from. */
async function stints(gameIds, teamId, byId) {
  if (!gameIds || !gameIds.length) return [];
  const chunks = [];
  for (let i = 0; i < gameIds.length; i += 40) chunks.push(gameIds.slice(i, i + 40));
  const parts = await Promise.all(chunks.map(c =>
    all(`lineup_stints?game_id=in.(${c.join(',')})&select=game_id,team_idx,player_ids,stats`)));
  let rows = parts.flat();
  if (teamId && byId) {
    /* team_idx is a side of a game, not a team — resolve it through the game */
    rows = rows.filter(r => {
      const g = byId[r.game_id];
      if (!g) return false;
      return (r.team_idx === 0 ? g.home_team_id : g.away_team_id) === teamId;
    });
  }
  return rows;
}

/* The raw event log for a set of games, flattened into the scorer's shape.

   Paged, and that matters more here than anywhere: PostgREST caps a response
   at 1000 rows whatever `limit` says, and six games is nearly 5000 events. A
   one-shot query returns a fifth of the log and looks completely successful —
   the first time this was tested it reported a player scoring 17 points in a
   season where he scored 98. */
async function events(gameIds) {
  if (!gameIds || !gameIds.length) return [];
  const chunks = [];
  for (let i = 0; i < gameIds.length; i += 40) chunks.push(gameIds.slice(i, i + 40));
  const parts = await Promise.all(chunks.map(c =>
    all(`game_events?game_id=in.(${c.join(',')})` +
        `&select=game_id,seq,t,team,pid,period,clock,payload&order=seq`)));
  return parts.flat().map(r => {
    const e = Object.assign({ t: r.t, id: r.seq, gameId: r.game_id,
                              period: r.period, clock: r.clock }, r.payload || {});
    if (r.team != null) e.team = r.team;
    if (r.pid != null) e.pid = r.pid;
    return e;
  });
}

/* names, jerseys and colours for a set of player ids — the stats carry none */
async function playerMeta(ids) {
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 40) {
    const c = ids.slice(i, i + 40);
    const [ps, re] = await Promise.all([
      all(`players?id=in.(${c.join(',')})&select=id,first_name,last_name,slug,photo_url`),
      all(`roster_entries?player_id=in.(${c.join(',')})&active=eq.true` +
          `&select=player_id,jersey,position,teams(id,name,short_name,slug,colour)`)
    ]);
    const byPlayer = {};
    re.forEach(r => { if (!byPlayer[r.player_id]) byPlayer[r.player_id] = r; });
    ps.forEach(p => {
      const r = byPlayer[p.id] || {};
      const t = r.teams || {};
      out[p.id] = {
        name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Player',
        slug: p.slug, photo_url: p.photo_url,
        jersey: r.jersey || '', position: r.position || '',
        teamId: t.id || null, teamName: t.short_name || t.name || '',
        teamFull: t.name || '', teamShort: t.short_name || '',
        teamSlug: t.slug || '', colour: t.colour || null
      };
    });
  }
  return out;
}

async function teamMeta(leagueId) {
  const ts = await all(`teams?league_id=eq.${leagueId}&select=id,name,short_name,slug,colour`);
  const out = {};
  ts.forEach(t => { out[t.id] = { name: t.name, teamShort: t.short_name,
                                  slug: t.slug, colour: t.colour }; });
  return out;
}

/* Resolve ?l=, ?s= and ?c= into a league / season / competition once.

   Every season is fetched, not only the newest. Asking for one was the cheap
   thing to do when no league had a second, but it meant a league's history was
   unreachable rather than merely unlinked — there was no parameter that could
   get you there. `seasons` comes back so a page can offer the choice, and ?s=
   selects by slug or by name so the URL of a past season is legible and
   shareable rather than a uuid. */
async function context(leagueSlug, compId, seasonRef) {
  const lgs = await get(`leagues?slug=eq.${encodeURIComponent(leagueSlug)}&select=*&limit=1`);
  if (!lgs.length) throw new Error(`no league "${leagueSlug}"`);
  const league = lgs[0];

  const seasons = await all(`seasons?league_id=eq.${league.id}` +
    `&select=id,name,starts_on,ends_on&order=starts_on.desc`);
  const seasonRow = pickSeason(seasons, seasonRef);

  let comps = [];
  if (seasonRow) comps = await get(`competitions?season_id=eq.${seasonRow.id}&select=*&order=name`);
  const comp = comps.find(c => c.id === compId) || comps[0] || null;
  return { league, season: seasonRow, seasons, comps, comp };
}

/* A season is named like "2026-27", which is what a person would put in a URL,
   so match on the name loosely before falling back to the id. Anything
   unrecognised gives the newest rather than nothing — a mistyped season should
   land you somewhere useful, not on an error. */
function pickSeason(seasons, ref) {
  if (!seasons || !seasons.length) return null;
  if (!ref) return seasons[0];
  const key = String(ref).toLowerCase().replace(/[^a-z0-9]/g, '');
  return seasons.find(s => s.id === ref) ||
         seasons.find(s => String(s.name).toLowerCase().replace(/[^a-z0-9]/g, '') === key) ||
         seasons[0];
}

return { get, all, season, statsForGames, stints, events, playerMeta, teamMeta,
         context, pickSeason };
}));
