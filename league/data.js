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
  return {
    games, byId, pgs, tgs,
    players: S.players(pgs, tgs),
    teams: S.teams(tgs, byId)
  };
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

/* resolve ?l= and ?c= into a league / season / competition once */
async function context(leagueSlug, compId) {
  const lgs = await get(`leagues?slug=eq.${encodeURIComponent(leagueSlug)}&select=*&limit=1`);
  if (!lgs.length) throw new Error(`no league "${leagueSlug}"`);
  const league = lgs[0];
  const ss = await get(`seasons?league_id=eq.${league.id}&select=*&order=starts_on.desc&limit=1`);
  const seasonRow = ss[0] || null;
  let comps = [];
  if (seasonRow) comps = await get(`competitions?season_id=eq.${seasonRow.id}&select=*&order=name`);
  const comp = comps.find(c => c.id === compId) || comps[0] || null;
  return { league, season: seasonRow, comps, comp };
}

return { get, all, season, playerMeta, teamMeta, context };
}));
