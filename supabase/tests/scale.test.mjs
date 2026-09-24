/* ============================================================================
   READY FOR A LEAGUE, NOT A DEMO.

   Everything here is about what happens when the numbers get bigger: a club
   with a season behind it, a table with a hundred thousand events, six tabs
   left open on a phone. Each check exists because the thing it tests was
   measured against the live database and found wanting, or because getting it
   wrong produces an answer that LOOKS right.

   The one that matters most is the first. A paging scheme that returns a fifth
   of a log and reports success is not a slow page, it is a wrong one — this
   codebase has already shipped a player credited with 17 points in a season he
   scored 98 in. So all() is not read here, it is RUN, against a fake server
   that behaves the way PostgREST actually behaves.

     node supabase/tests/scale.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const datajs  = rd('epinoia', 'data.js');
const gamejs  = rd('epinoia', 'game', 'game.js');
const tabjs   = rd('epinoia', 'game', 'video.js');
const playerjs = rd('epinoia', 'p', 'player.js');
const sql84   = rd('supabase', 'migrations', '0084_events_read_scale.sql');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* Lift a function out of a source file by matching its braces. Slicing on a
   line that "looks like the end" cuts a function with nested blocks in half. */
function lift(src, signature) {
  const from = src.indexOf(signature);
  if (from === -1) throw new Error('cannot find ' + signature);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(from, j + 1); }
  }
  throw new Error('unbalanced ' + signature);
}

/* ---- 1. paging returns the whole log, whatever the server says ----------- */
console.log('\na log comes back complete or not at all');

/* A server that behaves like the real one, including the part that caused the
   bug: PostgREST reports a total in Content-Range ONLY when it had to truncate
   — so a request for exactly the page size comes back "0-999/*", with no count
   and an HTTP 200 that reads as complete. */
function fakeServer(total, maxRows = 1000) {
  const calls = [];
  const rows = (off, lim) => {
    const n = Math.max(0, Math.min(Math.min(lim, maxRows), total - off));
    return Array.from({ length: n }, (_, i) => ({ seq: off + i }));
  };
  const parse = p => ({
    off: +(p.match(/offset=(\d+)/) || [0, 0])[1],
    lim: +(p.match(/limit=(\d+)/) || [0, maxRows])[1]
  });
  return {
    calls,
    get: async p => { const { off, lim } = parse(p); calls.push(p); return rows(off, lim); },
    getCounted: async p => {
      const { off, lim } = parse(p);
      calls.push(p);
      const r = rows(off, lim);
      /* the count arrives only when the answer had to be cut short */
      const truncated = lim > maxRows && total > maxRows;
      return { rows: r, total: truncated ? total : null };
    }
  };
}

const allSrc = lift(datajs, 'async function all(path, page = 1000)');
function makeAll(server) {
  return new Function('get', 'getCounted', 'MAX_PAGES', 'console',
    'return ' + allSrc)(server.get, server.getCounted, 40,
      { warn() {} });
}

for (const total of [0, 1, 999, 1000, 1001, 2370, 10358, 24000]) {
  const srv = fakeServer(total);
  const out = await makeAll(srv)('game_events?select=seq');
  ok('a log of ' + total + ' rows comes back whole',
     out.length === total, 'got ' + out.length + ' after ' + srv.calls.length + ' requests');
}

/* The exact-multiple case is the one that was wrong: 1000 of 2370 returned and
   reported as complete. Asserted on its own so a future edit cannot quietly
   reintroduce "<= page". */
{
  const srv = fakeServer(2370);
  const out = await makeAll(srv)('game_events?select=seq');
  ok('a full first page is never mistaken for the end',
     out.length === 2370, 'got ' + out.length);
  ok('...and the pages after it were asked for at once, not in a queue',
     srv.calls.filter(c => /offset=(1000|2000)/.test(c)).length === 2,
     srv.calls.join('\n          '));
}

/* And a server that never reports a total at all — an older PostgREST, a proxy
   that drops the header — must still get the whole thing, just slowly. */
{
  const srv = fakeServer(2370);
  const blind = { calls: srv.calls, get: srv.get,
                  getCounted: async p => ({ rows: (await srv.get(p)).slice(0, 1000), total: null }) };
  const out = await makeAll(blind)('game_events?select=seq');
  ok('no count at all still returns everything, by walking',
     out.length === 2370, 'got ' + out.length);
}

ok('the count is asked for as exact, never as the planner\'s guess',
   /Prefer: 'count=exact'/.test(datajs) && !/count=planned'/.test(datajs));
ok('...and one row more than a page is requested, or no count comes back',
   /offset=0&limit=\$\{page \+ 1\}/.test(datajs));

/* ---- 1b. an event log is read game by game, never by offset -------------- */
console.log('\nan event log is read game by game, and no page walks the rows before it');

/* A season of logs was read forty games at a time through all(), and every OFFSET page paid
   for the rows it skipped, each one put through game_events' read policy, so the fan-out ran
   into the statement timeout from about the fourteenth page (23 Sep: 41 HTTP 500s on one club
   profile). events() is RUN here against a server that answers the way PostgREST does: one
   game per request, a 1000-row cap, and `seq=gt.` picking up where the last page ended. */
const EVENT_LANES = +(datajs.match(/const EVENT_LANES = (\d+);/) || [])[1];
const EVENT_PAGE = +(datajs.match(/const EVENT_PAGE = (\d+);/) || [])[1];
const eventsSrc = lift(datajs, 'async function gameLog(id)') + '\n' +
                  lift(datajs, 'async function events(gameIds)');
const makeEvents = get => new Function('get', 'EVENT_PAGE', 'EVENT_LANES',
  eventsSrc + '\nreturn events;')(get, EVENT_PAGE, EVENT_LANES);

function fakeLogs(sizes, failOn) {
  const calls = [];
  let open = 0, peak = 0;
  const row = (id, s) => ({ game_id: id, seq: s, t: 'p2_made', team: s % 2, pid: s % 3 ? 'p' + s : null,
                            period: 1, clock: 600000 - s, payload: { x: s }, created_at: 'at' + s });
  const get = async p => {
    calls.push(p);
    open++; peak = Math.max(peak, open);
    await new Promise(r => setTimeout(r, 2));
    open--;
    const id = (p.match(/game_id=eq\.([^&]+)/) || [])[1];
    if (id === failOn) throw new Error('500 on game_events');
    const after = +((p.match(/seq=gt\.(\d+)/) || [])[1] || 0);
    const lim = Math.min(+((p.match(/limit=(\d+)/) || [])[1] || 1000), 1000);
    const out = [];
    for (let s = after + 1; s <= (sizes[id] || 0) && out.length < lim; s++) out.push(row(id, s));
    return out;
  };
  return { get, calls, peak: () => peak, row };
}

{
  const sizes = { g5: 2370, g1: 0, g3: 1000, g2: 1, g6: 999, g4: 1001 };
  const srv = fakeLogs(sizes);
  const out = await makeEvents(srv.get)(Object.keys(sizes));
  const per = {};
  out.forEach(e => { (per[e.gameId] = per[e.gameId] || []).push(e.seq); });
  ok('every game comes back whole, at 0, 1, 999, 1000, 1001 and 2370 events',
     Object.keys(sizes).every(id => (per[id] || []).length === sizes[id] &&
                                    (per[id] || []).every((s, i) => s === i + 1)),
     JSON.stringify(Object.fromEntries(Object.keys(sizes).map(id => [id, (per[id] || []).length]))));
  ok('...a full page is never mistaken for the end',
     srv.calls.filter(c => /game_id=eq\.g3&/.test(c)).length === 2);
  ok('...and a long game carries on from the last seq it got',
     srv.calls.some(c => /game_id=eq\.g5&seq=gt\.1000&/.test(c)) &&
     srv.calls.some(c => /game_id=eq\.g5&seq=gt\.2000&/.test(c)));
  ok('no request pages by offset or asks for a count',
     srv.calls.length > 0 && !srv.calls.some(c => /offset=|limit=1001/.test(c)));
  ok('every request is one game, in seq order',
     srv.calls.every(c => /^game_events\?game_id=eq\.[^&,]+&/.test(c) && /&order=seq&/.test(c)),
     srv.calls.find(c => !/^game_events\?game_id=eq\.[^&,]+&/.test(c)));
}

{
  /* THE SAME ARRAY AS BEFORE, order included. The in.() read returned each block of forty ids
     once each, in id order, and each game in seq order -- so a repeat inside a block came back
     once, and the same game in two blocks came back twice. Built here from the same rows. */
  const ids = Array.from({ length: 45 }, (_, i) => 'g' + String((i * 37) % 45).padStart(2, '0'));
  ids[7] = ids[3];
  ids[42] = ids[3];
  const sizes = {};
  ids.forEach((id, i) => { sizes[id] = 3 + (i % 4); });
  const srv = fakeLogs(sizes);
  const got = await makeEvents(srv.get)(ids);
  const want = [];
  for (let i = 0; i < ids.length; i += 40) {
    [...new Set(ids.slice(i, i + 40))].sort().forEach(id => {
      for (let s = 1; s <= sizes[id]; s++) want.push(id + ':' + s);
    });
  }
  const have = got.map(e => e.gameId + ':' + e.seq);
  ok('the events come back in the order the in.() read gave them',
     have.join() === want.join(), have.length + ' events against ' + want.length);
  const e1 = got.find(e => e.gameId === ids[0] && e.seq === 1);
  const e3 = got.find(e => e.gameId === ids[0] && e.seq === 3);
  ok('...and each event keeps its shape',
     JSON.stringify(e1) === JSON.stringify({ t: 'p2_made', id: 1, seq: 1, gameId: ids[0], created_at: 'at1',
                                             period: 1, clock: 599999, x: 1, team: 1, pid: 'p1' }) &&
     !('pid' in e3), JSON.stringify(e1));
}

{
  const sizes = {};
  for (let i = 0; i < 20; i++) sizes['g' + String(i).padStart(2, '0')] = 5;
  const srv = fakeLogs(sizes);
  await makeEvents(srv.get)(Object.keys(sizes));
  ok('games are read ' + EVENT_LANES + ' at a time: in parallel, but never all at once',
     EVENT_LANES > 1 && srv.peak() === EVENT_LANES, 'peak ' + srv.peak());
}

{
  const sizes = {};
  for (let i = 0; i < 30; i++) sizes['g' + String(i).padStart(2, '0')] = 5;
  const srv = fakeLogs(sizes, 'g01');
  let threw = false;
  try { await makeEvents(srv.get)(Object.keys(sizes)); } catch (_) { threw = true; }
  await new Promise(r => setTimeout(r, 50));
  ok('a game that cannot be read fails the read, as a failed page did', threw);
  ok('...and no new game is asked for once it has', srv.calls.length < 30, srv.calls.length + ' requests');
}

/* ---- 2. the profile asks for a bounded amount of work -------------------- */
console.log('\nthe cost of a page does not grow with the league');

ok('the profile reads a bounded number of games',
   /const RECENT_GAMES = 40;/.test(playerjs) &&
   /order=tipoff_at\.desc&limit=\$\{RECENT_GAMES\}/.test(playerjs));
ok('...and says so where the numbers are, rather than silently sampling',
   /last ' \+ RECENT_GAMES \+ ' games/.test(playerjs));
ok('every in.() list is chunked, because a URL has a length',
   /const inChunks = async \(ids, build\)/.test(playerjs) &&
   /i \+= 40/.test(playerjs));

/* ---- 3. cost per viewer -------------------------------------------------- */
console.log('\na tab nobody is looking at asks for nothing');

ok('the status poll stops while the tab is hidden',
   /if \(document\.hidden\) \{ missedWhileHidden = true; return; \}/.test(gamejs));
ok('...and catches up the moment it is looked at again',
   /if \(!document\.hidden && missedWhileHidden\)/.test(gamejs));
ok('the video poll does the same', /if \(document\.hidden\) return;/.test(gamejs));

/* ---- 4. the document does not hold a whole game -------------------------- */
console.log('\nthe play list builds a screenful, not four hundred rows');

ok('the list is windowed', /list\.slice\(0, st\.shown\)/.test(tabjs));
ok('...with a way to ask for more', /id="vidMore"/.test(tabjs));
ok('...and the window follows a jump past its edge',
   /if \(i >= st\.shown\) st\.shown = Math\.ceil/.test(tabjs));
ok('...while the count still reports every match, not the window',
   /'<div class="vidcount">' \+ list\.length/.test(tabjs));
ok('a new filter starts a new window',
   /st\.filter = b\.dataset\.f; st\.shown = PAGE;/.test(tabjs));

/* ---- 4b. writes that race --------------------------------------------------- */
console.log('\ntwo people doing the same thing at the same time');

const bootstrap = rd('epinoia', 'score', 'bootstrap.js');
const sql85     = rd('supabase', 'migrations', '0085_concurrency_and_indexes.sql');

ok('publishing stops when the server holds more actions than this device',
   /if \(count <= mine\) return;/.test(bootstrap) &&
   /EpinoiaSync\.halt\(\)/.test(bootstrap.slice(bootstrap.indexOf('guardAgainstOverwrite'))));
ok('...and says so rather than failing quietly',
   /not publishing — another device is scoring/.test(bootstrap));
ok('...with a way out that is not "give up"',
   /Load the recorded game/.test(bootstrap) && /Leave it alone/.test(bootstrap));
ok('the check is polled, because the scorer reaches a live game several ways',
   /guardAgainstOverwrite\(\); \} catch/.test(bootstrap));

ok('only one primary video row per game is possible',
   /create unique index if not exists game_videos_one_primary/.test(sql85) &&
   /on public\.game_videos \(game_id\) where is_primary/.test(sql85));
ok('...and the two halves of an anchor merge instead of racing',
   /on conflict \(game_id\) where is_primary do update set/.test(sql85));
ok('the merge reads the PARAMETERS, not excluded, so injected defaults cannot overwrite',
   /provider          = coalesce\(p_provider, game_videos\.provider\)/.test(sql85) &&
   !/provider *= *coalesce\(nullif\(excluded\.provider/.test(sql85));
ok('a database that already lost the race is repaired rather than left broken',
   /update public\.game_videos v set is_primary = false/.test(sql85));
ok('the self-test cannot corrupt a real row',
   /where not exists \(select 1 from public\.game_videos v where v\.game_id = g\.id\)/.test(sql85));

ok('the columns every club page filters on are indexed',
   /games_home_team on public\.games \(home_team_id, tipoff_at desc\)/.test(sql85) &&
   /games_away_team on public\.games \(away_team_id, tipoff_at desc\)/.test(sql85));
/* COMMENTS OUT FIRST. The note in 0084 explains the duplicate index by QUOTING
   the statement it warns against, which reads to a regex exactly like the
   statement itself — the same trap touchscroll.test.mjs already documents for
   CSS. Stripping SQL line comments is what makes this assertion mean what it
   says rather than the opposite. */
const noComments = sql => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
ok('and no duplicate index is left on the busiest table',
   !/create index[^\n]*game_events/.test(noComments(sql84)) &&
   /drop index if exists public\.game_events_game_seq/.test(noComments(sql85)));

/* ---- 4c. a read survives a crowd ------------------------------------------- */
console.log('\na busy service is a "not now", not an answer');

ok('reads retry on the statuses a loaded service actually returns',
   /const RETRY_STATUS = new Set\(\[429, 500, 502, 503, 504\]\)/.test(datajs));
ok('...and the box score, which is the busiest read, does the same',
   /const API_RETRY = new Set\(\[429, 500, 502, 503, 504\]\)/.test(gamejs));
ok('Retry-After is obeyed when the service sends one',
   /retry-after/.test(datajs) && /Math\.min\(10000, secs\)/.test(datajs));
ok('a 4xx that is not 429 is reported rather than repeated',
   /if \(!RETRY_STATUS\.has\(r\.status\) \|\| attempt >= RETRIES\)/.test(datajs));
ok('identical concurrent reads cost one request',
   /const inFlight = new Map\(\)/.test(datajs) && /function share\(path, counted\)/.test(datajs));
ok('...but each caller still gets its own array',
   /return rows\.slice\(\);/.test(datajs));

/* ---- 4d. one announcement must not move the whole platform ---------------- */
console.log('\na game going live is not everybody\'s business');

const stripjs = rd('epinoia', 'embed', 'strip', 'strip.js');
const syncjs2 = rd('epinoia', 'score', 'sync.js');
const rtjs    = rd('epinoia', 'rt.js');
const homejs  = rd('epinoia', 'home.js');
const fixjs   = rd('epinoia', 'fixtures', 'fixtures.js');

ok('the announcement says whose game it is',
   /select\('home:home_team_id\(slug\),away:away_team_id\(slug\),'/.test(syncjs2) &&
   /Object\.assign\(\s*\n?\s*\{ gameId: gameId, status: status, at: Date\.now\(\) \},\s*\n?\s*scope \|\| \{\}\)/
     .test(syncjs2.replace(/\r/g, '')));
ok('...read once per game, not once per announcement',
   /if \(scopeAsked/.test(syncjs2) && /scopeAsked = true;/.test(syncjs2));

/* The filter itself is RUN, not read: it is the piece that decides whether a
   few hundred embedded strips query or stay quiet. */
const concernsUs = new Function('ROWS', 'wantLeague', 'wantTeam',
  lift(stripjs, 'function concernsUs(msg)') + '\nreturn concernsUs;');

const noRows = { has: () => false };
{
  const f = concernsUs(noRows, 'demo-league', '');
  ok('a game in another league is ignored',
     f({ gameId: 'x', league: 'other', home: 'a', away: 'b' }) === false);
  ok('a game in our league is not',
     f({ gameId: 'x', league: 'demo-league', home: 'a', away: 'b' }) === true);
}
{
  const f = concernsUs(noRows, '', 'east-dock');
  ok('a club strip hears its own club, whatever league it is in',
     f({ gameId: 'x', league: 'other', home: 'east-dock', away: 'b' }) === true);
  ok('...and away as well as home',
     f({ gameId: 'x', league: 'other', home: 'b', away: 'east-dock' }) === true);
  ok('...and nothing else',
     f({ gameId: 'x', league: 'other', home: 'p', away: 'q' }) === false);
}
{
  const f = concernsUs({ has: id => id === 'mine' }, 'demo-league', '');
  ok('a game already on the strip is always ours, whatever it claims',
     f({ gameId: 'mine', league: 'somewhere-else', home: 'p', away: 'q' }) === true);
}
{
  const f = concernsUs(noRows, '', '');
  ok('a strip with no scope at all shows the platform, so everything is its business',
     f({ gameId: 'x', league: 'other', home: 'p', away: 'q' }) === true);
}
{
  const f = concernsUs(noRows, 'demo-league', 'east-dock');
  ok('an UNSCOPED announcement is treated as ours — an older scorer must not go unheard',
     f({ gameId: 'x', status: 'live' }) === true);
}

ok('and the strips that do care do not all ask in the same millisecond',
   /60 \+ Math\.random\(\) \* 1500/.test(stripjs));
ok('nor do the first-party pages',
   /80 \+ Math\.random\(\) \* 1200/.test(homejs) && /80 \+ Math\.random\(\) \* 1200/.test(fixjs));
ok('the fixtures page ignores a scoped announcement about a game it is not showing',
   /!GAMES\.some\(g => g\.id === msg\.gameId\)/.test(fixjs));

/* Reconnection is the other lockstep: everybody is disconnected in the same
   instant when the socket server restarts. */
ok('a repeated reconnect is scattered',
   /const wait = first \? retry : retry \* \(1 \+ Math\.random\(\) \* 0\.5\);/.test(rtjs));
ok('...but the FIRST one is not, because one phone changing network is not a herd',
   /const first = retry === BACKOFF_MIN;/.test(rtjs));

/* ---- 4e. six games finishing at once --------------------------------------- */
console.log('\nSaturday teatime is the normal shape of a league, not an edge case');

const sql45 = rd('supabase', 'migrations', '0045_league_governance.sql');
const sql86 = rd('supabase', 'migrations', '0086_recompute_serialised.sql');

/* NORMALISED FIRST. readFileSync does not translate line endings, so a file
   checked out with CRLF matches a begin followed by LF and never matches two
   LFs in a row — the comparison then reports a difference that exists only in
   the whitespace the editor chose. Python's universal newlines hid this while
   the migration was being generated, so the two sides disagreed for a reason
   that had nothing to do with the SQL. */
const lf = t => String(t).split(String.fromCharCode(13)).join('');
const fnOf = sql => {
  const src = lf(sql);
  const a = src.indexOf('create or replace function public.recompute_standings');
  if (a === -1) return null;
  return src.slice(a, src.indexOf('end; $$;', a) + 8);
};

ok('recompute_standings is serialised per competition',
   /perform pg_advisory_xact_lock\(hashtextextended\(p_competition::text, 0\)\)/.test(sql86));
ok('...transaction-scoped, so a failure cannot leak a lock onto a pooled connection',
   /pg_advisory_xact_lock/.test(sql86) && !/pg_advisory_lock\(/.test(sql86));
ok('...and taken before the delete it protects',
   sql86.indexOf('pg_advisory_xact_lock') < sql86.indexOf('delete from standings'));
ok('...keyed on the competition, so different divisions still run side by side',
   /hashtextextended\(p_competition::text, 0\)/.test(sql86));

/* THE ARITHMETIC MUST NOT HAVE MOVED. This file was first written by retyping
   the function from memory, and the retyped version had different column
   names, a different streak algorithm and no sanctions pass at all — it would
   have silently rewritten every league table on the platform. So the bodies
   are compared, with only the added lock removed. */
const stripLock = fn => {
  const i = fn.indexOf('begin\n') + 'begin\n'.length;
  const j = fn.indexOf('perform pg_advisory_xact_lock');
  if (j === -1) return fn;
  return fn.slice(0, i) + fn.slice(fn.indexOf('\n\n', j) + 2);
};
const before = fnOf(sql45), after = fnOf(sql86);
ok('both files define the function', !!before && !!after);
ok('and 0086 changes NOTHING but the lock — not a column, not the streak, not the sanctions',
   stripLock(after) === before,
   after && before ? 'lengths ' + stripLock(after).length + ' vs ' + before.length : 'missing');

/* Spot-checks that would each have failed against the retyped version, so the
   comparison above cannot be weakened without one of these going red. */
for (const clause of ['deducted_points', 'deducted_wins',
                      'l = st.l + least(st.w, d.wns)',
                      'count(*)::int            as gp',
                      'from competition_teams ct']) {
  ok('the real body keeps: ' + clause.slice(0, 42), after.includes(clause));
}

ok('the migration refuses rather than proceeding if the lock is missing',
   /raise exception '0086: recompute_standings is not serialised'/.test(sql86));
ok('...and checks the lock is not taken after the write',
   /the lock is taken after the write it protects/.test(sql86));

/* ---- 5. the policy that runs per row ------------------------------------- */
console.log('\nthe five per-row read policies: a fast path, then the rule');

/* THE LIVE POLICY, NOT A HISTORICAL ONE. This section used to read 0084 and check
   that events_read was an inlined EXISTS. 0118 inlined it again, then 0136 put all
   five tables back on a function call per row (can_read_game_rows: security
   definer, a SET clause and a sub-select, so never inlined), and those checks
   kept passing for a week because they only ever read 0084's file. Measured on
   2026-09-23, that cost ~0.04 ms for every row a read walked. So this section
   reads whichever migration LAST set each policy, and whichever LAST defined
   each piece of the rule, and checks those. */
const MIG = path.join(ROOT, 'supabase', 'migrations');
const migs = readdirSync(MIG).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
  .map(f => ({ f, n: +f.slice(0, 4), sql: readFileSync(path.join(MIG, f), 'utf8').replace(/\r/g, '') }));
const lastWith = re => [...migs].reverse().find(m => re.test(m.sql));
const norm = t => t.replace(/\s+/g, ' ').trim();

const READS = [['game_events', 'events_read'], ['game_state', 'state_read'],
               ['player_game_stats', 'pgs_read'], ['team_game_stats', 'tgs_read'],
               ['lineup_stints', 'ls_read']];
const fast = lastWith(/create or replace view public\.game_rows_public\b/);
ok('the fast path exists (a view of the games whose rows are public)', !!fast);
const fsql = fast ? fast.sql : '';

for (const [tbl, pol] of READS) {
  const setter = lastWith(new RegExp(`(create|alter) policy (${pol}\\b|%I on public\\.%I)`));
  ok(`${pol} was last set by the migration that proves the fast path (${setter && setter.f})`,
     setter && fast && setter.f === fast.f && fsql.includes(`'${tbl}'`) && fsql.includes(`'${pol}'`));
}
const tablesArr = /tables\s+text\[\] := array\[([^\]]*)\]/.exec(fsql);
const polsArr = /policies\s+text\[\] := array\[([^\]]*)\]/.exec(fsql);
ok('...each policy paired with its own table, in order',
   tablesArr && polsArr &&
   JSON.stringify(tablesArr[1].match(/'[^']+'/g)) === JSON.stringify(READS.map(r => `'${r[0]}'`)) &&
   JSON.stringify(polsArr[1].match(/'[^']+'/g)) === JSON.stringify(READS.map(r => `'${r[1]}'`)));

/* THE TEXT THAT IS ATTACHED. One template, proved and then attached; this is the
   whole of the security argument, so it is compared exactly: a fast path OR the
   rule itself, never anything else. */
const tplLit = /expr_tpl\s+text\s*:=\s*((?:'[^']*'\s*)+);/.exec(fsql);
const tpl = tplLit ? tplLit[1].match(/'([^']*)'/g).map(s => s.slice(1, -1)).join('') : '';
ok('the policy is "fast path OR can_read_game_rows", exactly',
   tpl === 'coalesce((select true from public.game_rows_public p where p.id = %1$s), false) '
         + 'or public.can_read_game_rows(%1$s)', tpl);
ok('...attached with each table\'s own game_id, from that same text',
   /format\('alter policy %I on public\.%I using \(%s\)',\s*policies\[i\], tables\[i\], format\(expr_tpl, format\('%I\.game_id', tables\[i\]\)\)\)/.test(fsql));
ok('...and ALTERed, so no moment passes with no read policy at all',
   !/drop policy[^\n]*(events_read|state_read|pgs_read|tgs_read|ls_read)/.test(fsql));

/* A SCALAR SUB-SELECT, NOT EXISTS OR IN. Written either of those ways the planner
   may hash the whole view once per statement: every public game on the platform,
   enumerated for every read. Measured with 40,000 finished games that is ~110 ms
   even for one row; the scalar form is one primary-key probe per row. */
ok('the fast path cannot be hashed into a per-statement scan of every game',
   !/exists|\bin \(/i.test(tpl) && /coalesce\(\(select true from/.test(tpl));

/* SOUND BY CONSTRUCTION, AND KEPT THAT WAY. The fast path may only ever be
   narrower than can_read_game_rows' public half: the same statuses, the same
   league condition letter for letter, plus a public league. Compared against
   the LATEST definition of the rule, so a later change to the rule shows up here. */
const viewBody = norm((/create or replace view public\.game_rows_public as([\s\S]*?);/.exec(fsql) || [, ''])[1]);
ok('the fast path admits finished games, and live ones only through the live list',
   viewBody.includes("g.status = 'final' and ( g.competition_id is null or g.competition_id in (select public.game_rows_open_competitions(false)) )") &&
   viewBody.includes("g.status = 'live' and g.competition_id in (select public.game_rows_open_competitions(true))") &&
   !/scheduled|finalising|void/.test(viewBody), viewBody);
const compsFn = lastWith(/create or replace function public\.game_rows_open_competitions\(/);
const compsBody = compsFn ? norm(compsFn.sql.slice(compsFn.sql.indexOf('create or replace function public.game_rows_open_competitions('))
                                           .split('$fn$')[1] || '') : '';
ok('...only in PUBLIC leagues, and only live where the league publishes live',
   compsBody.includes("where l.visibility = 'public' and (not p_live or l.public_live)"), compsBody);
const rule = lastWith(/create or replace function public\.can_read_game_rows\(/);
const ruleCase = rule ? norm((/case when l\.id is null or l\.access_mode = 'open'[\s\S]*?end/.exec(
  rule.sql.slice(rule.sql.indexOf('create or replace function public.can_read_game_rows('))) || [''])[0]) : '';
const fastCase = norm((/case when l\.access_mode = 'open'[\s\S]*?end/.exec(compsBody) || [''])[0]);
ok(`...and the league condition is the rule's own (${rule && rule.f})`,
   ruleCase !== '' && ruleCase === fastCase.replace('case when ', 'case when l.id is null or '),
   `rule: ${ruleCase}\n          fast: ${fastCase}`);

/* A LATER CHANGE TO THE RULE MUST PROVE THE FAST PATH AGAIN. If can_read_game_rows
   is tightened (a private league, a hidden season), a fast path written against
   the old rule could admit what the new one refuses. So the migration that last
   defines the rule must be no newer than the one that last proved the fast path,
   or must carry the proof itself: copy 0151's section 2. */
ok('the rule has not changed since the fast path was last proved',
   rule && fast && (rule.n <= fast.n || /the fast path admits % games that can_read_game_rows refuses/.test(rule.sql)),
   rule && fast ? `${rule.f} changes can_read_game_rows after ${fast.f} proved the fast path` : '');

/* THE VIEW WRITES AS ITS OWNER. It is one table with no aggregate, so it is
   automatically updatable, and Supabase's default privileges give every browser
   role ALL on a new relation. SELECT only, granted inside the same statement that
   creates it, and never security_invoker (that would put games' own per-row
   policy back inside the fast path). */
const iRev = fsql.indexOf('revoke all on public.game_rows_public from public, anon, authenticated, service_role;');
const iGrant = fsql.indexOf('grant select on public.game_rows_public to anon, authenticated;');
const iProof = fsql.indexOf('2. THE PROOF');
ok('the view is SELECT-only for browsers, before anything reads it',
   iRev > 0 && iGrant > iRev && iProof > iGrant && !/grant (all|insert|update|delete)[^;]*game_rows_public/.test(fsql));
ok('...owner-rights on purpose',
   !/create or replace view public\.game_rows_public with/.test(fsql) &&
   /alter view public\.game_rows_public owner to postgres/.test(fsql));

/* PROVED ON THE DATABASE IT CHANGES, IN ONE STATEMENT. A push has not always
   been one transaction (0140 stopped half way; CLI 2.117 rolled 0145's failed
   push back whole), so the migration is a single DO block: a proof that fails
   takes the helpers and the swap down with it on any CLI. */
const body = fsql.replace(/--[^\n]*\n/g, '\n').trim();
ok('the migration is one statement, so a failed proof leaves nothing behind',
   /^do \$mig\$/.test(body) && /end \$mig\$;$/.test(body) && body.split('$mig$').length === 3);
ok('...which proves soundness on every game, for every kind of reader, before the swap',
   /the fast path admits % games that can_read_game_rows refuses/.test(fsql) &&
   /if passes <> 22 then/.test(fsql) &&
   fsql.indexOf('the fast path admits % games') < fsql.indexOf("format('alter policy"));
ok('...and never RESET ROLE (the push connects through a temporary login role)',
   !/reset role/i.test(fsql.replace(/--[^\n]*\n/g, '\n')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
