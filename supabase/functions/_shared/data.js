/* GENERATED from epinoia/data.js by supabase/tests/extract-shared.mjs — do not edit. */
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
  /* factory(root), as stars.js does it: the season cache below reaches localStorage through
     `root`, and a factory called with no argument leaves it undefined — every reference then
     throws inside the cache's own try/catch, which is a cache that silently never caches. */
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaData = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

function CFG() {
  /* root first: the snapshots Edge Function runs this file under Deno, where there is no window */
  const c = (root && root.EPINOIA_CONFIG) || (typeof window !== 'undefined' && window.EPINOIA_CONFIG) || null;
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
  /* THE KEY CARRIES WHO IS ASKING. A member's read of a members-only league goes
     out with their token and an anonymous one does not; sharing the two by path
     alone would hand whichever finished first to both, so a member could be shown
     the refused (empty) answer, or the reverse. Open leagues send no token, so
     their key is exactly the path it always was.

     Asked on every request, which is affordable: authHeaders() is one localStorage
     read (parsed only when the stored value changes) and a walk of the handful of
     league states this page loaded — no network, nothing awaited. It is asked in
     the same synchronous stretch as the first attempt's headers in fetchWithRetry,
     so the key and the request agree. The tail of the token is enough to tell two
     accounts apart and keeps the bearer itself out of the key. A throw, or anything
     that is not a string, reads as anonymous — what fetchWithRetry sends when the
     same call throws there.
     Written inline rather than as a helper because supabase/tests/transport.test.mjs
     lifts share and fetchWithRetry out of this file on their own; a helper beside
     them is a name the lifted copy does not have. */
  let who = '';
  try {
    const A = typeof window !== 'undefined' ? window.EpinoiaAccess : null;
    const h = (A && typeof A.authHeaders === 'function' && A.authHeaders()) || {};
    if (typeof h.Authorization === 'string' && h.Authorization) who = 'A:' + h.Authorization.slice(-16) + ':';
  } catch (_) { who = ''; }
  const key = (counted ? 'C:' : 'G:') + who + path;
  if (inFlight.has(key)) return inFlight.get(key);
  const job = fetchWithRetry(path, counted).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function fetchWithRetry(path, counted) {
  const c = CFG();
  let wait = 400;
  /* A MEMBERS-ONLY LEAGUE IS REFUSED BY ROW-LEVEL SECURITY, so a member's reads
     have to say who is asking. EpinoiaAccess (access.js) decides whether a token
     is worth sending — only for a members-only league this viewer may see — and
     hands back {} otherwise, so an open league's request is byte-for-byte what it
     was. Asked PER ATTEMPT, never cached at load: a sign-in, a sign-out or an
     access state that lands mid-page must change the very next request.
     Guarded by typeof because this file also runs under node in the tests, and
     because a page without access.js must keep working unchanged. */
  let dropAuth = false;
  for (let attempt = 0; ; attempt++) {
    const headers = counted
      ? { apikey: c.supabaseAnonKey, Accept: 'application/json',
          Prefer: 'count=exact' }
      : { apikey: c.supabaseAnonKey, Accept: 'application/json' };
    const A = typeof window !== 'undefined' ? window.EpinoiaAccess : null;
    if (!dropAuth && A && typeof A.authHeaders === 'function') {
      try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous, as before */ }
    }
    let r;
    try {
      r = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
        cache: 'no-store',
        headers
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
    /* A 401 WITH A TOKEN ON IT is a token the server no longer accepts (expired
       between the check and the request, or signed out elsewhere). That is not
       an answer about the rows, so it is asked once more anonymously — which is
       exactly what the page did before memberships existed — rather than turned
       into a broken page. Once only, and it does not spend a retry. */
    if (r.status === 401 && headers.Authorization && !dropAuth) {
      dropAuth = true; attempt--; continue;
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
/* ---------------------------------------------------- a trimmed player row ---
   WHAT EpinoiaSeason.players() READS FROM A PLAYER'S STATS, and nothing else.

   A player_game_stats row carries the scorer's whole per-game block, and more
   than half of it is `adv` -- the advanced line the box score draws -- which
   players() never reads (only teamLine reads an `adv`, and only from a TEAM row).
   Measured on 17 Sep: 447 rows, `adv` about 657 bytes of each 1.6 kB. A page that
   builds every league's season at once pays for that on every row, on a phone,
   over mobile data.

   So a trimmed read asks PostgREST for these keys by JSON path (`pts:stats->pts`)
   and puts `stats` back together from them. A key the row does not have comes back
   null and is left off, so the rebuilt object reads exactly as the stored one did:
   players() coerces a missing count to 0 and tests `dq`, `oc` and `sit` for
   presence. supabase/tests/global.test.mjs holds this list to every `s.<key>`
   players() reads, and checks the rows come out identical with and without `adv`.
   The Statistics page does not use it: it reads the whole row, as it always has. */
const PLAYER_STAT_KEYS = Object.freeze(['min', 'pts', 'p2m', 'p2a', 'p3m', 'p3a', 'ftm', 'fta',
  'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf', 'fd', 'pm', 'ptsAst',
  'rimA', 'rimM', 'midA', 'midM', 'paint', 'fast', 'sc', 'pot', 'dq', 'oc', 'sit']);
const TRIM_SELECT = 'game_id,player_uuid,player_id,team_idx,' +
  PLAYER_STAT_KEYS.map(k => k + ':stats->' + k).join(',');

/* --------------------------------------------- a season a reader already has ---
   THE SEASON LINE KEEPS; THE ROWS IT WAS SUMMED FROM DO NOT.

   Global scouting reads every league's whole finished season on every visit, and
   a season only changes when a game is finalised. So the SUMMED season is kept
   between visits and re-checked with one small request first:

     games?…&status=in.(final,finalising)&select=id,finalised_at
            &order=finalised_at.desc.nullslast&limit=1   with Prefer: count=exact

   which answers in 94 bytes with both halves of the token — how many games are
   finished, and when the most recent one was finalised. A game played, a game
   reverted or a game re-scored all move one of them, so the cache misses and the
   season is read again; nothing else can change the numbers.

   A TTL SITS BEHIND THE TOKEN ANYWAY. The token is an argument about what can
   change a season, and an argument is a weaker thing than a measurement: six
   hours bounds how wrong it can be if some path one day rewrites a box score
   without touching finalised_at.

   V IS PART OF THE KEY. The line is what players()/teams()/attachBPM computed,
   so a change to that maths has to invalidate everything cached under the old
   one — bump V in the same commit and every reader re-reads once.

   localStorage, not session: the point is the visit AFTER this one. It is
   wrapped in try/catch throughout (private mode, a full quota) and a write that
   fails clears this file's own keys and gives up — a page that cannot cache is
   only as slow as it was before caching existed. */
const SEASON_CACHE_V = 'epinoia_season_v1:';
const SEASON_CACHE_MS = 6 * 60 * 60 * 1000;

async function seasonToken(scope) {
  try {
    /* getCounted, not a bare fetch: it carries the retry and the member's token, so a
       members-only league is counted for the member exactly as its games are read. */
    const { rows, total } = await getCounted(`games?${scope}&status=in.(final,finalising)` +
      '&select=id,finalised_at&order=finalised_at.desc.nullslast&limit=1');
    if (total == null) return null;   // the server declined to count: do not risk a cache on it
    const last = (rows && rows[0] && rows[0].finalised_at) || '';
    return total + '@' + last;
  } catch (_) { return null; }        // no token, no cache: read it the long way
}

function seasonCacheGet(key, token) {
  if (!token) return null;
  try {
    const s = root.localStorage && root.localStorage.getItem(key);
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || j.tok !== token) return null;
    if (typeof j.at !== 'number' || Date.now() - j.at > SEASON_CACHE_MS || Date.now() < j.at) return null;
    const d = j.data || {};
    const byId = {};
    (d.games || []).forEach(g => { byId[g.id] = g; });
    return { games: d.games || [], byId, players: d.players || [], teams: d.teams || [],
             teamOfPlayer: new Map(d.teamOfPlayer || []) };
  } catch (_) { return null; }
}

function seasonCachePut(key, token, out) {
  if (!token) return;
  const body = JSON.stringify({ tok: token, at: Date.now(), data: {
    games: out.games, players: out.players, teams: out.teams,
    teamOfPlayer: [...(out.teamOfPlayer || new Map())]
  } });
  const ls = root && root.localStorage;
  if (!ls) return;
  try { ls.setItem(key, body); return; } catch (_) { /* full: make room below */ }

  /* FULL. Make room by dropping the seasons READ LONGEST AGO, not all of them: a platform
     with nineteen leagues cached is exactly when this happens, and throwing the other
     eighteen away to fit the nineteenth would have every visit evicting the last one's
     work. Oldest first, one at a time, and give up quietly if it still will not fit —
     a page that cannot cache is only as slow as it was before there was a cache. */
  try {
    const mine = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || k.indexOf(SEASON_CACHE_V) !== 0 || k === key) continue;
      let at = 0;
      try { at = (JSON.parse(ls.getItem(k)) || {}).at || 0; } catch (__) { at = 0; }
      mine.push({ k, at });
    }
    mine.sort((a, b) => a.at - b.at);
    for (const m of mine) {
      ls.removeItem(m.k);
      try { ls.setItem(key, body); return; } catch (__) { /* still full: drop the next one */ }
    }
  } catch (___) { /* nothing more to try */ }
}

/* A season's snapshot, as the season cache holds it, or null. `ids` is one competition id, or
   several sorted and comma-joined.

   A FILE ON THE CDN (0153), NAMED BY ITS TOKEN: snapshots/season/<ids>/<token>.json. Postgres
   serving the same seasons as jsonb took 11-13 s for global scouting's seventeen at once, with
   timeouts; the CDN serves files. The token was read from the database a moment ago, under
   every policy, so a league this reader may not read gives no games, no token and no file. A
   version is never rewritten, only replaced by a new name, so the browser and the CDN may keep
   it as long as they like. Missing (not built yet), or any blip: null, and the caller reads the
   rows as before. */
function snapFile(token) { return String(token).replace(/[^A-Za-z0-9]+/g, '-') + '.json'; }
async function seasonSnapshot(ids, token) {
  try {
    const c = CFG();
    const r = await fetch(`${c.supabaseUrl}/storage/v1/object/public/snapshots/season/${ids}/${snapFile(token)}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.token !== token || !j.data) return null;
    const d = j.data;
    const byId = {};
    (d.games || []).forEach(g => { byId[g.id] = g; });
    return { games: d.games || [], byId, players: d.players || [], teams: d.teams || [],
             teamOfPlayer: new Map(d.teamOfPlayer || []) };
  } catch (_) { return null; }
}

/* one trimmed row back into the shape the untrimmed read returns */
function untrim(r) {
  const stats = {};
  PLAYER_STAT_KEYS.forEach(k => { if (r[k] != null) stats[k] = r[k]; });
  return { game_id: r.game_id, player_uuid: r.player_uuid, player_id: r.player_id,
           team_idx: r.team_idx, stats };
}

/* opts.trim: read player rows without `adv` (see PLAYER_STAT_KEYS). Team rows are
   read whole either way, because teamLine takes the team's box from its `adv`.

   opts.rows === false: HAND BACK THE SEASON, NOT THE ROWS IT WAS BUILT FROM.

   A season's player rows are the biggest thing this file ever holds, and once
   players() and teams() have summed them nearly every caller is finished with
   them -- global scouting merges EVERY league's season at once and never looks
   at `.pgs` or `.tgs` again. Returning them anyway pinned the lot in memory for
   as long as the page was open: measured 808 bytes a row trimmed, 24 rows a
   game, so one league's finished season is ~4.6 MB of JSON parsed into ~6,000
   row objects (each with its own nested `stats`), and nineteen leagues at the
   same point would be ~88 MB and ~114,000 of them -- on a phone, for a table of
   a few hundred season lines that was already computed.

   The injury report is the one caller that genuinely re-reads `.pgs` (it works
   game by game, not on the season line), so rows are kept by DEFAULT and only
   an explicit `rows: false` drops them. Nothing about the numbers changes:
   players(), teams() and attachBPM have already run over exactly the same rows
   either way. */
async function season(competitionId, opts) {
  const trim = !!(opts && opts.trim);
  const keepRows = !(opts && opts.rows === false);
  const list = (Array.isArray(competitionId) ? competitionId : [competitionId]).filter(Boolean);
  if (!list.length) return { games: [], players: [], teams: [], byId: {} };
  const scope = list.length === 1
    ? `competition_id=eq.${list[0]}`
    : `competition_id=in.(${list.join(',')})`;

  /* THE SEASON A READER ALREADY HAS IS NOT WORTH SENDING AGAIN. Only for the callers that
     asked for the season line and not the rows (rows: false): the line is a few hundred
     small objects and keeps, the rows are megabytes and do not. See seasonToken(). */
  const ckey = keepRows ? null : SEASON_CACHE_V + list.slice().sort().join(',');
  let token = null;
  if (ckey) {
    token = await seasonToken(scope);
    const hit = seasonCacheGet(ckey, token);
    if (hit) return hit;
    /* THE SERVER'S COPY, when there is one that is current (0152). The snapshots function
       works a competition's season out once after each final, with THIS file and as a
       signed-out reader, and stores the same shape the cache above keeps. It is used only
       when its token is the one just read, so it is the season this read would have
       computed; anything else (no snapshot, an older one, no table yet) reads the rows as
       before. A season merged across competitions is its own sum, so it has its own snapshot,
       keyed by the sorted ids (the function builds each league's newest season whole, which is
       what global scouting and a league page's "all competitions" scope ask for).
       The function itself passes snapshot:false, since it is the one building it. */
    /* a season with nothing finished ("0@") has no file to look for */
    if (token && !/^0@/.test(token) && !(opts && opts.snapshot === false)) {
      const snap = await seasonSnapshot(list.slice().sort().join(','), token);
      if (snap) { seasonCachePut(ckey, token, snap); return snap; }
    }
  }

  const games = await all(`games?${scope}` +
    `&status=in.(final,finalising)&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at`);
  if (!games.length) return { games: [], players: [], teams: [], byId: {} };

  const ids = games.map(g => g.id);
  /* chunked so the `in.()` filter cannot outgrow a URL on a long season */
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));

  /* the player rows and the team rows together: neither needs the other to be
     asked for, and waiting for the first before sending the second was a whole
     round trip on every season (statsForGames below already asks for both at once) */
  const [pgsParts, tgsParts] = await Promise.all([
    Promise.all(chunks.map(c => trim
      ? all(`player_game_stats?game_id=in.(${c.join(',')})&select=${TRIM_SELECT}`)
          .then(rows => rows.map(untrim))
      : all(`player_game_stats?game_id=in.(${c.join(',')})` +
          `&select=game_id,player_uuid,player_id,team_idx,stats`))),
    Promise.all(chunks.map(c =>
      all(`team_game_stats?game_id=in.(${c.join(',')})&select=game_id,team_idx,stats`)))
  ]);

  const pgs = pgsParts.flat(), tgs = tgsParts.flat();
  const byId = {};
  games.forEach(g => { byId[g.id] = g; });

  const S = root.EpinoiaSeason;
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

  const out = { games, byId, players, teams: teamRows, teamOfPlayer };
  if (keepRows) { out.pgs = pgs; out.tgs = tgs; }
  else if (ckey) seasonCachePut(ckey, token, out);
  return out;
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

  const S = root.EpinoiaSeason;
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

  /* pgs comes back too: the injury report (epinoia/injuries.js) needs the per-game
     rows, not the season totals — who was on the sheet, game by game — and reading
     them a second time for the same games would be the same request twice. */
  return { players, teams: teamRows, byId, teamOfPlayer, games, pgs, tgs };
}

/* ------------------------------------------------------- who has been let go ---
   The releases for a league's clubs (player_releases, migration 0132). A row means
   the club has said the player has gone, which is the one thing the injury report
   cannot work out from the box scores. An older database has no such table, so a
   404 is an empty list rather than a broken page. */
async function releases(teamIds) {
  const list = (Array.isArray(teamIds) ? teamIds : [teamIds]).filter(Boolean);
  if (!list.length) return [];
  try {
    return await all(`player_releases?team_id=in.(${list.join(',')})&select=team_id,player_id,note,released_at`);
  } catch (_) { return []; }
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
   season where he scored 98.

   ONE GAME PER REQUEST, CONTINUED BY SEQ -- NEVER BY OFFSET. This read forty
   games at a time as one log, `in.(...)&order=game_id,seq`, through all(): a
   counted first page, then every OFFSET page at once. The (game_id, seq) index
   gave that order without a sort (the 2026-09-18 fix), but an offset is not
   free: to hand back rows 20000-20999 Postgres walks the 20000 before them, and
   every row it walks is put through game_events' read policy first. Measured on
   the live database on 23 Sep, one request at a time, for the 31 games (26,481
   events) a club profile's shot zones read: a page cost 0.21 s at offset 0,
   0.51 s at 4000 and 0.80 s at 12000, and the exact count cost 1.37 s on its
   own. The fan-out asked for all 27 pages together -- about fourteen logs' worth
   of work at once -- and every page past ~14000 ran into the 3 s statement
   timeout: up to 41 HTTP 500s in one load of Loughborough Riders' profile, the
   retries getting there twenty seconds after the page opened.

   A game is about 650 to 1000 events, so one request is nearly always the whole
   log. A longer one carries on from the last seq it got (`seq=gt.`), which the
   index goes to directly, so no page costs more than the rows it returns and no
   count is needed: a short page is the end, the same proof all() relies on.
   Measured the same way, all 31 logs took about a second with nothing refused.
   EVENT_LANES caps the games in flight, so a whole league's read queues in the
   browser rather than in the database's connection pool.

   THE RESULT IS THE ARRAY IT WAS, order included: each block of forty ids in
   uuid order, which is how `order=game_id,seq` sorted them, and every game's
   events in seq order. */
const EVENT_PAGE = 1000;
const EVENT_LANES = 8;

async function gameLog(id) {
  const rows = [];
  let after = null;
  for (;;) {
    const page = await get(`game_events?game_id=eq.${id}` + (after == null ? '' : `&seq=gt.${after}`) +
      `&select=game_id,seq,t,team,pid,period,clock,payload,created_at&order=seq&limit=${EVENT_PAGE}`);
    rows.push(...page);
    if (page.length < EVENT_PAGE) return rows;
    after = page[page.length - 1].seq;
  }
}

async function events(gameIds) {
  if (!gameIds || !gameIds.length) return [];
  const ids = [];
  for (let i = 0; i < gameIds.length; i += 40) ids.push(...[...new Set(gameIds.slice(i, i + 40))].sort());
  const logs = new Array(ids.length);
  let next = 0;
  /* a lane that fails stops the others taking new games: the read has already failed */
  const lane = async () => {
    while (next < ids.length) {
      const i = next++;
      try { logs[i] = await gameLog(ids[i]); } catch (e) { next = ids.length; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EVENT_LANES, ids.length) }, lane));
  return logs.flat().map(r => {
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

/* names, jerseys and colours for a set of player ids — the stats carry none.

   THE CHUNKS ARE ASKED FOR TOGETHER. They ran one after another, which on a
   league of 237 players was six round trips in a row and 1.55 s of a 3.4 s page;
   no chunk depends on another, so the wait is now the slowest one. The answers are
   still folded in chunk order, so the object comes out exactly as it did. */
/* NOT EVERY PLAYER IN A BOX SCORE IS ON THE REGISTER. A feed whose people could not be matched (CIBACOPA's,
   from Genius Sports) files them under "<side>:<shirt number>", e.g. "0:12". Asked for in an id=in.(...) list
   that is a 400 ("invalid input syntax for type uuid"), and the 400 fails the whole read, so every page
   built on it went blank ("could not load: 400 on players") and took the teams' names with it. Only real
   ids are asked for; the others get the name a box score can honestly give: "#12". */
const REGISTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function unregistered(id) {
  const shirt = String(id).split(':').pop();
  return { unregistered: true, name: /^\d+$/.test(shirt) ? 'Player #' + shirt : 'Player', slug: null, photo_url: null,
           jersey: /^\d+$/.test(shirt) ? shirt : '', position: '',
           teamId: null, teamName: '', teamFull: '', teamShort: '', teamSlug: '', colour: null, teamLogo: null };
}
async function playerMeta(allIds) {
  if (!allIds || !allIds.length) return {};
  const out = {};
  const ids = [];
  allIds.forEach(id => { if (REGISTER_ID.test(String(id))) ids.push(id); else if (id != null) out[id] = unregistered(id); });
  if (!ids.length) return out;
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
  const answers = await Promise.all(chunks.map(c => Promise.all([
    all(`players?id=in.(${c.join(',')})&select=id,first_name,last_name,slug,photo_url`),
    all(`roster_entries?player_id=in.(${c.join(',')})&active=eq.true` +
        `&select=player_id,jersey,position,teams(id,name,short_name,slug,colour,logo_path)`)
  ])));
  for (const [ps, re] of answers) {
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
        teamSlug: t.slug || '', colour: t.colour || null, teamLogo: t.logo_path || null
      };
    });
  }
  return out;
}

async function teamMeta(leagueId) {
  const ts = await all(`teams?league_id=eq.${leagueId}&select=id,name,short_name,slug,colour,logo_path`);
  const out = {};
  ts.forEach(t => { out[t.id] = { name: t.name, teamShort: t.short_name,
                                  slug: t.slug, colour: t.colour, logo: t.logo_path || null }; });
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
         releases, context, pickSeason, PLAYER_STAT_KEYS, untrim, seasonToken };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaData;
export const { get, all, season, statsForGames, playerMeta, teamMeta, seasonToken, PLAYER_STAT_KEYS, untrim } = __api;
export default __api;
