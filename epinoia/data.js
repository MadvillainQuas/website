'use strict';
/* ============================================================================
   One place that fetches, one place that aggregates.

   Every page used to run its own PostgREST query against a slightly different
   view, which is how the leaders board and the season page ended up able to
   disagree. Now they all pull the same per-game rows and hand them to
   epinoia/season.js, so a column means the same thing everywhere and there is
   one place to fix a mistake.

   Rows are paged: PostgREST caps a response, and a full season of
   player_game_stats runs past the default limit. A silent truncation would
   produce a season table that is quietly short of games, which is worse than
   one that fails.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaData = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

function CFG() {
  const c = (typeof window !== 'undefined' && window.EPINOIA_CONFIG) || null;
  if (!c) throw new Error('config.js has not loaded');
  return c;
}

/* ============================================================================
   READING WHEN EVERYBODY ARRIVES AT ONCE.

   A link goes out and four hundred people open the same box score inside a
   minute. Two things happen that never happen in testing:

     * THE SERVICE PUSHES BACK. A 429, or a 503 from the pooler while it opens
       connections. Every one of these was fatal: the fetch threw, the page
       said "Could not load", and a reader who arrived a second later saw a
       working page. A transient refusal is not an answer, and treating it as
       one turns a busy minute into a wave of broken pages.

     * THE SAME PAGE ASKS TWICE. A profile fires half a dozen queries and some
       overlap; a redraw can reissue one already in flight. Sending it again
       costs a round trip and a row scan for an answer we are already waiting
       for.

   Retrying is bounded and it backs off. RETRY-AFTER IS OBEYED WHEN IT IS SENT,
   because a service telling us when to come back is more informed than any
   schedule of ours — and ignoring it is how a retry storm makes an overloaded
   database worse rather than better.

   A 4xx that is not 429 is NOT retried. Those are answers: a bad filter, a
   missing table, a refusal. Repeating them just makes the same mistake more
   often. */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRIES = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Identical requests in flight share one answer. Keyed on the whole path, so
   two callers asking different questions never collide. */
const inFlight = new Map();

async function get(path) {
  const rows = await share(path, false);
  /* EACH CALLER GETS ITS OWN ARRAY. Sharing one promise means sharing one
     resolved value, and two callers holding the same array is a bug waiting
     for the first one that sorts it in place. The row objects are still
     shared — nothing here mutates them, everything maps them into new shapes —
     but the container is cheap to copy and is the part that gets reordered. */
  return rows.slice();
}

/* The counted variant of the same request, used to open a paged read. It goes
   through the identical retry: the first page of a big fetch is exactly the
   request a busy service is most likely to refuse. */
async function getCounted(path) {
  return share(path, true);
}

function share(path, counted) {
  const key = (counted ? 'C:' : 'G:') + path;
  if (inFlight.has(key)) return inFlight.get(key);
  const job = fetchWithRetry(path, counted).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function fetchWithRetry(path, counted) {
  const c = CFG();
  let wait = 400;
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
        cache: 'no-store',
        headers: counted
          ? { apikey: c.supabaseAnonKey, Accept: 'application/json',
              Prefer: 'count=exact' }
          : { apikey: c.supabaseAnonKey, Accept: 'application/json' }
      });
    } catch (netErr) {
      /* A dropped connection is exactly the case retrying is for — a phone
         changing cell, a hall's wifi blinking. */
      if (attempt >= RETRIES) throw netErr;
      await sleep(wait); wait *= 2; continue;
    }

    if (r.ok) {
      const rows = await r.json();
      if (!counted) return rows;
      /* "0-999/2370" — and "0-999/*" when the server declines to count, which
         is a real answer meaning "walk it". */
      const tail = (r.headers.get('content-range') || '').split('/')[1];
      return { rows, total: (tail && tail !== '*') ? parseInt(tail, 10) : null };
    }
    if (!RETRY_STATUS.has(r.status) || attempt >= RETRIES) {
      throw new Error(`${r.status} on ${path.split('?')[0]}`);
    }
    /* Seconds, per the HTTP spec — and a date is also legal, so both are read.
       Capped at ten seconds: a page that hangs for a minute obeying a header
       is worse for the reader than one that gives up and says so. */
    const ra = r.headers.get('retry-after');
    let hold = wait;
    if (ra) {
      const secs = /^\d+$/.test(ra.trim()) ? +ra * 1000 : (Date.parse(ra) - Date.now());
      if (isFinite(secs) && secs > 0) hold = Math.min(10000, secs);
    }
    await sleep(hold);
    wait = Math.min(8000, wait * 2);
  }
}

/* ---------------------------------------------------------------------------
   PAGING THAT DOES NOT GROW A QUEUE.

   PostgREST caps a response at 1000 rows, so anything larger is several
   requests. This walked them ONE AT A TIME, waiting for each before asking for
   the next — which is invisible on the demo league and is the single slowest
   thing on the platform once a league has a season behind it. A club that has
   played thirty games has about 24,000 events; that is twenty-four round trips
   in a row, and measured against the live database each one costs between a
   third and four fifths of a second. Eight seconds of staring at a profile.

   The first page is asked for WITH A COUNT, which PostgREST returns in
   Content-Range and which costs nothing extra — it is the same scan. Knowing
   the total, every remaining page is requested at once. Twenty-four trips
   become one plus a fan-out, and the wall-clock cost becomes the slowest single
   page rather than the sum of all of them.

   The cap is deliberate. Beyond forty pages — forty thousand rows — the answer
   is not "fan out harder", it is that the caller is asking for too much, and
   forty parallel requests is already more than a browser will open at once. */
const MAX_PAGES = 40;

async function all(path, page = 1000) {
  const sep = path.includes('?') ? '&' : '?';

  /* ONE MORE THAN A PAGE, and that single extra row is the whole trick.

     PostgREST reports a total in Content-Range only when it KNOWS the response
     is partial — which means only when the request asked for more rows than it
     is willing to return. Asking for exactly 1000 gets 1000 rows, HTTP 200 and
     "0-999/*": a complete answer, as far as the protocol is concerned, and no
     count at all. Asking for 1001 gets the same 1000 rows, HTTP 206, and
     "0-999/2370".

     Found in a browser after curl had said otherwise, which is the reason the
     walk below exists at all rather than being deleted as redundant. */
  const first = await getCounted(`${path}${sep}offset=0&limit=${page + 1}`);

  /* STRICTLY FEWER, and the difference is a truncated season.

     We asked for page+1 and the server returns at most `page`, so getting
     exactly `page` back is ambiguous: it means either "here is everything,
     which happened to be a round number" or "this is all I will give you".
     Treating it as complete — which is what "<=" did here for one measured
     run, returning 1000 rows of a 2370-row log — is the truncation this whole
     function exists to prevent. Fewer than a page is the only unambiguous
     proof of the end, so it is the only thing accepted as one.

     The cost of being strict is one extra request on a log whose length is an
     exact multiple of a thousand. The cost of being loose is a box score that
     is quietly wrong. */
  if (first.rows.length < page) return first.rows;

  let out = first.rows.slice(0, page);
  let from = page;

  /* THE FAN-OUT IS AN OPTIMISATION. THE WALK IS THE CONTRACT.

     With a total, every remaining page is requested at once — twenty-four
     round trips in a row become one and a fan-out, which on a real profile
     measured 1.6 seconds against 4.1 sequential. Without one, this does
     nothing and the loop below walks exactly as it always did.

     Correctness never depends on the count. That matters more than the speed:
     a paging scheme that trusts a number it did not verify is how a season's
     log comes back a fifth complete, reports success, and credits a player
     with 17 points in a season he scored 98 in. This codebase has already had
     that bug once. */
  if (first.total != null) {
    const pages = Math.min(MAX_PAGES, Math.ceil(first.total / page));
    const offsets = [];
    for (let i = 1; i < pages; i++) offsets.push(i * page);
    const chunks = await Promise.all(offsets.map(off =>
      get(`${path}${sep}offset=${off}&limit=${page}`)));
    out = out.concat(...chunks);
    from = pages * page;
    /* A short page anywhere in the fan-out means the end arrived early; there
       is nothing after it to walk to. */
    if (chunks.length && chunks[chunks.length - 1].length < page) return out;
  }

  /* Walk until a short page proves the end — whatever any count said. */
  for (;;) {
    if (from >= MAX_PAGES * page) {
      console.warn('[data] ' + path.split('?')[0] + ': stopped at ' + out.length +
        ' rows (page cap) — there are more');
      return out;
    }
    const more = await get(`${path}${sep}offset=${from}&limit=${page}`);
    out = out.concat(more);
    if (more.length < page) return out;
    from += page;
  }
}

/* ------------------------------------------------------------- a season ---- */
/* Returns everything the pages need for one competition, aggregated once. */
/* ONE COMPETITION OR SEVERAL — a season is a scope, not a statistic.

   This took a single competition id, so every stats surface on the league page
   showed one phase at a time and a reader looking at "team stats" after a
   playoff had been played saw two teams and one game. A league season is
   normally the league phase PLUS its cup PLUS its playoffs, and that is what
   somebody means by the season's numbers.

   Passing a list rather than adding a second function keeps one aggregation
   path: statsForGames below already sums an arbitrary set of games, and the
   note there is the reason — the same code has to decide what a rebound is
   whoever asks, or two pages disagree. */
async function season(competitionId) {
  const list = (Array.isArray(competitionId) ? competitionId : [competitionId]).filter(Boolean);
  if (!list.length) return { games: [], players: [], teams: [], byId: {} };
  const scope = list.length === 1
    ? `competition_id=eq.${list[0]}`
    : `competition_id=in.(${list.join(',')})`;
  const games = await all(`games?${scope}` +
    `&status=in.(final,finalising)&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at`);
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

  const S = window.EpinoiaSeason;
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

  const S = window.EpinoiaSeason;
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
        `&select=game_id,seq,t,team,pid,period,clock,payload,created_at&order=seq`)));
  return parts.flat().map(r => {
    /* created_at rides along because it is the only axis the log shares with a
       video of the game — see epinoia/video.js. Everything else here ignores
       it, and re-fetching the whole log to get it back would be the alternative. */
    const e = Object.assign({ t: r.t, id: r.seq, seq: r.seq, gameId: r.game_id,
                              created_at: r.created_at,
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
