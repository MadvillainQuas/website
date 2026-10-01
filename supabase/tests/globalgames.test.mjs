/* ============================================================================
   GAMES ACROSS EVERY LEAGUE: WHAT HOME'S DAILY FIXTURES AND /epinoia/games/ SHOW.

   epinoia/globalgames.js is loaded as the real file (UMD, node's require) and
   run against synthetic rows only; nothing touches the network. The two
   cursors behind the global page run against a fake games table that applies
   the same filters and keyset order PostgREST would.

     ordering by distance, a fixture before a result on a tie · a league's next
     game beyond the time-ordered 40 still gets a card at 14 days, and no
     reserved slot at 15 · live games pinned above both cursors · a scheduled
     game an hour past tip-off still listed · inside a group, next soonest then
     results newest · de-duplication, a game turning final between pages, a game
     dropping out while it is finalised, running out · the league badge escaped ·
     the query shape (inner joins, quoted keyset) · per-page caches · the card ·
     the page wiring (scripts, CSP, registration)

     node supabase/tests/globalgames.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, 'epinoia', 'globalgames.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const section = s => console.log('\n' + s);

const H = 3600e3, D = 24 * H;
const NOW = Date.parse('2026-09-17T12:00:00Z');
const at = off => new Date(NOW + off).toISOString();

const L = {
  bcb: { id: 'l-bcb', slug: 'bcb', name: 'BCB', country: 'GB', colour_source: 'default' },
  slbm: { id: 'l-slbm', slug: 'slb-men', name: 'Super League Basketball', country: 'GB', colour_source: 'logo', colour_a: '#f2594c', colour_b: '#000000' },
  slbw: { id: 'l-slbw', slug: 'slb-women', name: 'Super League Basketball Women', country: 'GB', colour_source: 'logo' }
};
function game(id, league, off, status, extra) {
  return Object.assign({
    id, tipoff_at: at(off), status: status || 'scheduled', home_score: null, away_score: null,
    home: { id: 'h-' + id, name: 'Home ' + id, short_name: 'H' + id, colour: '#123456' },
    away: { id: 'a-' + id, name: 'Away ' + id },
    competitions: { id: 'c-' + league.id, name: 'Championship', seasons: { id: 's-' + league.id, leagues: league } }
  }, extra || {});
}
const ids = rows => rows.map(g => g.id);

/* ------------------------------------------------------------------------- */
section('query shape');
ok('SEL embeds competitions, seasons and leagues with !inner (test games with no competition drop out)',
   /competitions!inner\(/.test(G.SEL) && /seasons!inner\(/.test(G.SEL) && /leagues!inner\(/.test(G.SEL));
ok('SEL carries both clubs with crest and colour fields',
   /home:home_team_id\([^)]*logo_path/.test(G.SEL) && /away:away_team_id\([^)]*colour/.test(G.SEL));
ok('leagueOf reads the embedded league, object or one-element array', G.leagueOf(game('x', L.bcb, 0)).slug === 'bcb'
   && G.leagueOf({ competitions: [{ seasons: [{ leagues: [L.slbm] }] }] }).slug === 'slb-men'
   && G.leagueOf({}) === null);

/* ------------------------------------------------------------------------- */
section('distance from now');
{
  const fix = game('f', L.bcb, 10 * H), res = game('r', L.bcb, -10 * H, 'final');
  const nearRes = game('r2', L.bcb, -2 * H, 'final'), far = game('f2', L.bcb, 3 * D);
  const m = G.mergeNearest([fix, far], [res, nearRes], NOW, 10);
  ok('nearest first, either side of now', ids(m).join() === 'r2,f,r,f2', ids(m).join());
  const tie = G.mergeNearest([], [res], NOW).concat([]);
  ok('on a tie the fixture comes before the result', ids(G.mergeNearest([fix], [res], NOW)).join() === 'f,r');
  const within = game('r3', L.bcb, -(10 * H + 30e3), 'final');
  ok('within a minute counts as a tie (fixture first)', ids(G.mergeNearest([], [within, fix], NOW)).join() === 'f,r3');
  ok('de-duplicates by id, first copy wins', ids(G.mergeNearest([fix, fix], [Object.assign({}, fix, { status: 'final' })], NOW)).join() === 'f'
     && G.mergeNearest([fix], [Object.assign({}, fix, { status: 'final' })], NOW)[0].status === 'scheduled');
  ok('n limits the list', G.mergeNearest([fix, far], [res, nearRes], NOW, 2).length === 2 && tie.length === 1);
}

/* ------------------------------------------------------------------------- */
section('daily fixtures (pickDaily)');
{
  /* the time-ordered 40 is all BCB, from a day ahead */
  const bcb40 = Array.from({ length: 40 }, (_, i) => game('b' + String(i).padStart(2, '0'), L.bcb, D + i * 2 * H));
  const slbm = game('m1', L.slbm, 30 * H);                       // inside the 40's time range, but not in the 40
  const slbw14 = game('w1', L.slbw, 14 * D - H);
  const slbw15 = game('w1', L.slbw, 15 * D);
  const pick = G.pickDaily([], bcb40, [bcb40[0], slbm, slbw14], NOW, 8);
  ok('8 cards', pick.length === 8, pick.length);
  ok('a league whose next game lies beyond the time-ordered 40 gets a card within 14 days', ids(pick).includes('w1'));
  ok('every league with a game inside 14 days is on a card', new Set(pick.map(g => G.leagueOf(g).id)).size === 3);
  const pick15 = G.pickDaily([], bcb40, [bcb40[0], slbm, slbw15], NOW, 8);
  ok('no reserved slot when that league\'s next game is 15 days out', !ids(pick15).includes('w1') && pick15.length === 8);
  ok('the rest fill by tip-off', ids(pick15).join() === ['b00', 'b01', 'b02', 'b03', 'm1', 'b04', 'b05', 'b06'].join() ||
     ids(pick15).filter(i => i[0] === 'b').join() === 'b00,b01,b02,b03,b04,b05,b06', ids(pick15).join());
  ok('cards after the live ones are in tip-off order', pick.every((g, i) => i === 0 || Date.parse(pick[i - 1].tipoff_at) <= Date.parse(g.tipoff_at)));

  const live1 = game('L1', L.bcb, -H, 'live'), live2 = game('L2', L.slbm, -30 * 60e3, 'live');
  const withLive = G.pickDaily([live2, live1], bcb40, { a: bcb40[0], b: slbm, c: slbw14 }, NOW, 8);
  ok('every live game first, soonest tip-off first', ids(withLive).slice(0, 2).join() === 'L1,L2', ids(withLive).join());
  ok('a league already on a live card is not given a second reserved slot', !ids(withLive).includes('m1') && ids(withLive).includes('w1'));
  ok('still 8 with live games', withLive.length === 8);
  const tenLive = Array.from({ length: 10 }, (_, i) => game('LL' + i, L.bcb, -i * 60e3, 'live'));
  ok('more live games than cards: every live game is shown, nothing else', G.pickDaily(tenLive, bcb40, [], NOW, 8).length === 10);

  const stale = game('s1', L.bcb, -H);
  ok('a scheduled game one hour past tip-off is still listed', ids(G.pickDaily([], [stale].concat(bcb40), [], NOW, 8))[0] === 's1');
  ok('a game in both the live list and the upcoming list is shown once, as live',
     G.pickDaily([live1], [Object.assign({}, live1, { status: 'scheduled' })], [], NOW, 8).length === 1);

  /* more leagues qualify than there are slots: nearest first */
  const many = Array.from({ length: 10 }, (_, i) => game('n' + i, { id: 'lg' + i, name: 'League ' + i }, (10 - i) * D));
  const pm = G.pickDaily([], [], many, NOW, 3);
  ok('more qualifying leagues than cards: the nearest leagues\' games win', ids(pm).sort().join() === 'n7,n8,n9', ids(pm).join());
  ok('null entries (a league with nothing coming) are ignored', G.pickDaily([], [], [null, slbm, null], NOW, 8).length === 1);
  ok('nothing at all gives no cards', G.pickDaily([], [], new Map(), NOW, 8).length === 0);
}

/* ------------------------------------------------------------------------- */
section('groups (groupOrder)');
{
  const rows = [
    game('b-next2', L.bcb, 5 * D), game('b-res1', L.bcb, -D, 'final'), game('b-next1', L.bcb, 3 * D),
    game('b-res2', L.bcb, -2 * H, 'final'),
    game('m-next', L.slbm, 20 * H), game('m-res', L.slbm, -6 * D, 'final'),
    game('w-next', L.slbw, 16 * D), game('w-next', L.slbw, 16 * D)
  ];
  const gs = G.groupOrder(rows, NOW);
  ok('one group per league', gs.length === 3);
  ok('groups ordered by their most imminent game', gs.map(g => g.league.slug).join() === 'bcb,slb-men,slb-women', gs.map(g => g.league.slug).join());
  const b = gs[0];
  ok('inside a group, next soonest first', ids(b.next).join() === 'b-next1,b-next2');
  ok('then results newest first', ids(b.results).join() === 'b-res2,b-res1');
  ok('counts are per group and de-duplicated', b.count === 4 && gs[2].count === 1);
  const withLive = G.groupOrder(rows.concat([game('w-live', L.slbw, -3 * H, 'live')]), NOW);
  ok('a live game makes its league the most imminent group', withLive[0].league.slug === 'slb-women');
}

/* ------------------------------------------------------------------------- */
section('two cursors (feed)');

/* A fake games table: the same filters, order and keyset the real reads use. */
function table(games) {
  const calls = [];
  const T = g => Date.parse(g.tipoff_at);
  const fetch = async (side, after, limit, counted) => {
    calls.push({ side, after, limit, counted });
    let list;
    if (side === 'up') {
      list = games.filter(g => g.status === 'scheduled' && T(g) >= NOW - 2 * H)
        .sort((a, b) => T(a) - T(b) || (a.id < b.id ? -1 : 1));
      const total = list.length;
      if (after) list = list.filter(g => T(g) > after.t || (T(g) === after.t && g.id > after.id));
      return { rows: list.slice(0, limit), total: counted ? total : null };
    }
    list = games.filter(g => g.status === 'final' && T(g) < NOW)
      .sort((a, b) => T(b) - T(a) || (a.id < b.id ? 1 : -1));
    const total = list.length;
    if (after) list = list.filter(g => T(g) < after.t || (T(g) === after.t && g.id < after.id));
    return { rows: list.slice(0, limit), total: counted ? total : null };
  };
  return { fetch, calls };
}

function season() {
  const out = [];
  for (let i = 0; i < 70; i++) out.push(game('u' + String(i).padStart(3, '0'), [L.bcb, L.slbm, L.slbw][i % 3], 3 * H + i * 5 * H + i * 60e3 * 7));
  for (let i = 0; i < 45; i++) out.push(game('r' + String(i).padStart(3, '0'), [L.bcb, L.slbm][i % 2], -(4 * H + i * 11 * H), 'final',
    { home_score: 80, away_score: 70 }));
  out.push(game('stale1h', L.bcb, -H));                          // scheduled, an hour past tip-off
  out.push(game('stale3h', L.bcb, -3 * H));                      // scheduled, three hours past: matches neither query
  out.push(game('live1', L.slbm, -40 * 60e3, 'live'));
  return out;
}

{
  const db = season();
  const t = table(db);
  const live = db.filter(g => g.status === 'live');
  const f = G.feed({ now: NOW, fetch: t.fetch, exclude: live, batch: 30 });
  const p1 = await f.next(30);
  const eligible = db.filter(g => (g.status === 'scheduled' && Date.parse(g.tipoff_at) >= NOW - 2 * H) ||
    (g.status === 'final' && Date.parse(g.tipoff_at) < NOW));
  const expected = G.mergeNearest(eligible.filter(g => g.status !== 'final'), eligible.filter(g => g.status === 'final'), NOW);
  ok('page one is the 30 nearest to now, exactly', ids(p1.rows).join() === ids(expected.slice(0, 30)).join(),
     ids(p1.rows).slice(0, 8).join() + ' vs ' + ids(expected.slice(0, 8)).join());
  ok('the count reads 30 of N with N exact', p1.shown === 30 && p1.total === eligible.length && !p1.done, p1.shown + ' of ' + p1.total);
  ok('a scheduled game one hour past tip-off is listed', ids(p1.rows).includes('stale1h'));
  ok('live games are pinned above both cursors, never in the pages', !ids(p1.rows).includes('live1'));
  ok('each side\'s first read is counted, later reads are not',
     t.calls.filter(c => c.counted).length === 2 && t.calls.filter(c => c.counted).map(c => c.side).sort().join() === 'res,up');

  const all = p1.rows.slice();
  let res = p1, pages = 1;
  while (!res.done && pages < 20) { res = await f.next(30); all.push(...res.rows); pages++; }
  ok('Show more adds 30 until the list runs out', pages === Math.ceil(eligible.length / 30), pages + ' pages for ' + eligible.length);
  ok('the whole list comes out in nearest-first order, each game once',
     ids(all).join() === ids(expected).join() && new Set(ids(all)).size === all.length);
  ok('then "all N shown"', res.done && res.total === eligible.length && res.shown === eligible.length);
  ok('a scheduled game three hours past tip-off matches neither cursor', !ids(all).includes('stale3h'));
  const after = await f.next(30);
  ok('asking again after the end returns nothing, still done', after.rows.length === 0 && after.done);
}

{
  /* a game turns final between pages, one goes live, one is being finalised */
  const db = season();
  const t = table(db);
  const f = G.feed({ now: NOW, fetch: t.fetch, exclude: db.filter(g => g.status === 'live'), batch: 30 });
  const p1 = await f.next(30);
  const shownUp = p1.rows.find(g => g.status === 'scheduled' && g.id !== 'stale1h');
  /* the stale game is played: it becomes a result */
  db.find(g => g.id === 'stale1h').status = 'final';
  /* a game already shown as a fixture turns up again as a result further down the other cursor
     (what a game that turns final between pages looks like to a keyset that has not reached it) */
  db.push(Object.assign({}, shownUp, { status: 'final', tipoff_at: at(-600 * H), home_score: 60, away_score: 61 }));
  /* games no read has reached yet (beyond both buffers): one goes live and leaves the upcoming
     side, one is being finalised again and anonymous reads cannot see it */
  const unseen = db.filter(g => g.status === 'scheduled').sort((a, b) => Date.parse(b.tipoff_at) - Date.parse(a.tipoff_at))[0];
  unseen.status = 'live';
  const unseenRes = db.filter(g => g.status === 'final' && g.id !== shownUp.id)
    .sort((a, b) => Date.parse(a.tipoff_at) - Date.parse(b.tipoff_at))[0];
  unseenRes.status = 'finalising';
  const all = p1.rows.slice();
  let res = p1;
  while (!res.done) { res = await f.next(30); all.push(...res.rows); }
  const counts = {};
  all.forEach(g => { counts[g.id] = (counts[g.id] || 0) + 1; });
  ok('a game that turns final between pages is not listed twice',
     counts[shownUp.id] === 1 && counts.stale1h === 1 && Object.values(counts).every(c => c === 1));
  ok('a game going live between pages skips nothing else (keyset, not offsets)',
     db.filter(g => g.status === 'scheduled' && Date.parse(g.tipoff_at) >= NOW - 2 * H).every(g => counts[g.id] === 1));
  ok('a game hidden while it is finalised is simply missing', !counts[unseenRes.id] && !counts[unseen.id] && !!shownUp);
  ok('when the list runs out the count is what was actually shown (counts never assumed to grow)',
     res.done && res.total === all.length && all.length === p1.total - 2, res.total + ' / ' + all.length + ' / ' + p1.total);
}

{
  const t = table([]);
  const f = G.feed({ now: NOW, fetch: t.fetch, batch: 30 });
  const r = await f.next(30);
  ok('no games: done at once, "all 0 shown"', r.rows.length === 0 && r.done && r.total === 0 && r.shown === 0);
  const t2 = table([game('only', L.bcb, 2 * D), game('old', L.bcb, -2 * D, 'final')]);
  const r2 = await G.feed({ now: NOW, fetch: t2.fetch, batch: 30 }).next(30);
  ok('a short list: both games, done, fixture first at equal distance', ids(r2.rows).join() === 'only,old' && r2.done && r2.total === 2);
  /* small batches exercise the bound: many reads, same order */
  const db = season();
  const t3 = table(db);
  const f3 = G.feed({ now: NOW, fetch: t3.fetch, exclude: ['live1'], batch: 4 });
  const got = [];
  let x;
  do { x = await f3.next(7); got.push(...x.rows); } while (!x.done);
  const f4 = G.feed({ now: NOW, fetch: table(season()).fetch, exclude: ['live1'], batch: 30 });
  const ref = [];
  do { x = await f4.next(30); ref.push(...x.rows); } while (!x.done);
  ok('the order does not depend on how many rows each read asks for', ids(got).join() === ids(ref).join());
  const f5 = G.feed({ now: NOW, fetch: table(season()).fetch, exclude: [{ id: 'u000' }, 'live1'], batch: 30 });
  const p5 = await f5.next(200);
  ok('exclude takes rows or ids', !ids(p5.rows).includes('u000'));
  const stuck = Array.from({ length: 5 }, (_, i) => game('k' + i, L.bcb, (i + 1) * H));
  let reads = 0;
  const f6 = G.feed({ now: NOW, batch: 5, fetch: async side => { reads++; return { rows: side === 'up' ? stuck : [], total: 5 }; } });
  const p6 = await f6.next(30);
  ok('a read that does not move the cursor ends that side instead of looping', ids(p6.rows).join() === 'k0,k1,k2,k3,k4' && p6.done && reads < 6, reads);
}

/* ------------------------------------------------------------------------- */
section('reads: URLs and per-page caches (stubbed fetch, no network)');
{
  const seen = [];
  let answer = () => [];
  const sandbox = {
    EPINOIA_CONFIG: { supabaseUrl: 'https://ref.supabase.co', supabaseAnonKey: 'anon' },
    fetch: async (url, o) => {
      seen.push({ url, headers: o.headers });
      const body = answer(url);
      // {__status: 404} stands for a relation the database does not have
      if (body && body.__status) return { ok: false, status: body.__status, json: async () => ({}), headers: { get: () => null } };
      return { ok: true, status: 200, json: async () => body,
        headers: { get: k => (k === 'content-range' ? '0-29/484' : null) } };
    },
    setTimeout, clearTimeout, Date, Promise, JSON, Math, Map, Set, encodeURIComponent, isFinite, parseInt, String, Array, Object
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'globalgames.js'), sandbox);
  const W = sandbox.EpinoiaGlobalGames;

  answer = () => [L.bcb, L.slbm];
  await W.leagues(); await W.leagues();
  ok('leagues() is read once per page', seen.filter(s => /\/leagues\?/.test(s.url)).length === 1);

  /* WHERE THE DATABASE HAS NO league_next_games YET (0152 not pushed): the view
     answers 404 once, and every league is asked on its own, exactly as before. */
  seen.length = 0;
  answer = u => (/league_next_games/.test(u) ? { __status: 404 } : []);
  ok('without the view, nextAll answers null (league by league from here)', (await W.nextAll()) === null);
  await W.nextAll();
  ok('...and the missing view is asked about once per page', seen.filter(s => /league_next_games/.test(s.url)).length === 1);

  seen.length = 0;
  /* dates far from the real clock: nextFor compares a cached game with Date.now() */
  answer = () => [game('nx', L.bcb, 400 * D)];
  const n1 = await W.nextFor('l-bcb'); await W.nextFor('l-bcb');
  ok('nextFor(league) is cached per page', seen.length === 1 && n1.id === 'nx');
  ok('nextFor filters on the embedded league and asks for one scheduled game',
     /competitions\.seasons\.leagues\.id=eq\.l-bcb/.test(seen[0].url) && /status=eq\.scheduled/.test(seen[0].url) && /limit=1$/.test(seen[0].url));
  seen.length = 0;
  answer = () => [game('past', L.slbm, -400 * D)];
  await W.nextFor('l-slbm');
  answer = () => [game('nx2', L.slbm, 400 * D)];
  const again = await W.nextFor('l-slbm');
  ok('a cached next game whose tip-off has passed is asked for again', seen.length === 2 && again.id === 'nx2');

  seen.length = 0;
  answer = url => (/status=eq\.final/.test(url) ? []
    : /or=/.test(url) ? [] : Array.from({ length: 30 }, (_, i) => game('p' + i, L.bcb, D + i * H)));
  const f = W.feed({ now: NOW, batch: 30 });
  await f.next(1);
  const up = seen.find(s => /status=eq\.scheduled/.test(s.url));
  ok('the upcoming cursor starts two hours before now, ascending, counted',
     up && up.url.includes('tipoff_at=gte.' + encodeURIComponent(new Date(NOW - 2 * H).toISOString())) &&
     /order=tipoff_at\.asc,id\.asc/.test(up.url) && up.headers.Prefer === 'count=exact');
  const res = seen.find(s => /status=eq\.final/.test(s.url));
  ok('the result cursor reads before now, descending', res && res.url.includes('tipoff_at=lt.' + encodeURIComponent(new Date(NOW).toISOString())) &&
     /order=tipoff_at\.desc,id\.desc/.test(res.url));
  ok('every games read goes through SEL (inner joins)', seen.filter(s => /\/games\?/.test(s.url)).every(s => s.url.includes(encodeURIComponent('competitions!inner') ) || s.url.includes('competitions!inner')));
  seen.length = 0;
  await f.next(40);
  const keyset = seen.find(s => /or=/.test(s.url) && /status=eq\.scheduled/.test(s.url));
  ok('later reads use a quoted keyset, not an offset',
     keyset && decodeURIComponent(keyset.url).includes('(tipoff_at.gt."' + new Date(NOW + D + 29 * H).toISOString() + '",and(tipoff_at.eq."') &&
     !/offset=/.test(keyset.url) && !keyset.headers.Prefer, keyset && decodeURIComponent(keyset.url).slice(-160));
}

/* ------------------------------------------------------------------------- */
section('every league\'s next game in two reads (0152 league_next_games)');
{
  /* HOME asked for each league's next game on its own: 26 queries, two seconds
     before the first card. The view answers the first scheduled game per league
     and one read fetches those games in full. */
  const seen = [];
  let answer = () => [];
  /* the page's clock, moved by the test: a game tips off when the test says so */
  let clock = NOW;
  class Clock extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
  const sandbox = {
    EPINOIA_CONFIG: { supabaseUrl: 'https://ref.supabase.co', supabaseAnonKey: 'anon' },
    fetch: async (url, o) => {
      seen.push({ url, headers: o.headers });
      const body = answer(url);
      return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
    },
    setTimeout, clearTimeout, Date: Clock, Promise, JSON, Math, Map, Set, encodeURIComponent, isFinite, parseInt, String, Array, Object
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'globalgames.js'), sandbox);
  const W = sandbox.EpinoiaGlobalGames;

  const heads = [{ league_id: 'l-bcb', game_id: 'nb' }, { league_id: 'l-slbm', game_id: 'ns' }];
  let games = [game('nb', L.bcb, 400 * D), game('ns', L.slbm, 401 * D)];
  answer = u => (/league_next_games/.test(u) ? heads : games);
  const m = await W.nextAll();
  ok('two reads: the view, then those games by id through SEL',
     seen.length === 2 && /league_next_games\?select=league_id,game_id/.test(seen[0].url) &&
     /\/games\?/.test(seen[1].url) && /id=in\.\(nb,ns\)/.test(seen[1].url) && seen[1].url.includes('competitions!inner'),
     seen.map(s => s.url.slice(0, 90)));
  ok('...keyed by league', m.get('l-bcb').id === 'nb' && m.get('l-slbm').id === 'ns');
  seen.length = 0;
  const a = await W.nextFor('l-bcb'), b = await W.nextFor('l-slbm'), c = await W.nextFor('l-none');
  ok('nextFor is answered from it, with no request of its own', seen.length === 0 && a.id === 'nb' && b.id === 'ns');
  ok('...and a league with nothing coming is null, not asked for', c === null && seen.length === 0);
  await W.nextAll();
  ok('kept between calls', seen.length === 0);
  /* a scheduled game stays its league's next for two hours after its tip-off (the view's own rule), so one read
     after it had tipped off is the answer a new read would give */
  games = [game('nb', L.bcb, -30 * 60 * 1000), game('ns', L.slbm, 401 * D)];
  await W.nextAll({ fresh: true });
  seen.length = 0;
  const herd = await Promise.all(Array.from({ length: 69 }, () => W.nextFor('l-bcb')));
  ok('a game that had tipped off when it was read is no reason to read again: 69 leagues asking, no request',
     seen.length === 0 && herd.every(g => g.id === 'nb'), seen.length);
  /* a game that tips off AFTER the read: its league's next game may be somebody else now */
  games = [game('nb', L.bcb, -30 * 60 * 1000), game('ns', L.slbm, 60 * 1000)];
  await W.nextAll({ fresh: true });
  seen.length = 0;
  clock = NOW + 2 * 60 * 1000;
  games = [game('nb', L.bcb, -30 * 60 * 1000), game('ns2', L.slbm, 402 * D)];
  heads[1].game_id = 'ns2';
  const again = await Promise.all(Array.from({ length: 69 }, (_, i) => W.nextFor(i % 2 ? 'l-slbm' : 'l-bcb')));
  ok('read again once one of its games has tipped off since: once, however many ask at the same moment',
     seen.length === 2 && again.filter((g, i) => i % 2).every(g => g.id === 'ns2'), seen.length);
  seen.length = 0;
  await W.nextFor('l-slbm');
  ok('...and that new read is kept', seen.length === 0);
}

/* ------------------------------------------------------------------------- */
section('the league badge (config.js)');
{
  const attrs = {};
  const sandbox = {
    localStorage: { getItem: () => null },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] },
      querySelector: () => null, createElement: () => ({ setAttribute() {} }), head: { appendChild() {} } },
    location: { search: '' }, URLSearchParams, fetch: () => {}, setTimeout, clearTimeout
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'config.js'), sandbox);
  sandbox.EPINOIA_CONFIG.crestSizes = true;          /* the shipped config has sizing off (quota); this exercises the sized path */
  const B = sandbox.epinoiaLeagueBadge;
  ok('epinoiaLeagueBadge is defined', typeof B === 'function');
  const withLogo = B({ name: 'Super League', logo_path: 'league/1/logo-a.webp', colour_source: 'logo', colour_a: '#f2594c', colour_b: '#000000' });
  /* at the size it is drawn, through Storage's image transformation (0158) */
  ok('a logo from the bucket, on a tile, then the name', /^<span class="lgb"><span class="lgb-tile" data-mono="SL" style="--lgb-a:#f2594c;--lgb-b:#000000"><img src="https:\/\/hhvofgqqadtyvcjudhjx\.supabase\.co\/storage\/v1\/render\/image\/public\/media-public\/league\/1\/logo-a\.webp\?width=128&amp;height=128&amp;resize=contain" alt=""/.test(withLogo)
     && withLogo.includes('<span class="lgb-name">Super League</span>'), withLogo);
  const noLogo = B({ name: 'Basketball <b>Club</b> "B"', colour_source: 'default', colour_a: '#93f2bf' });
  ok('the name is escaped', noLogo.includes('Basketball &lt;b&gt;Club&lt;/b&gt; &quot;B&quot;') && !noLogo.includes('<b>'));
  ok('no logo: the monogram', /<span class="lgb-mono">B/.test(noLogo));
  ok('a default colour is not painted as the league\'s own', !noLogo.includes('style='));
  ok('bad colours are not written into the style', !B({ name: 'X', colour_source: 'manual', colour_a: 'red;x:y' }).includes('style='));
  ok('options: small, extra class, no name', /class="lgb sm lg"/.test(B({ name: 'A B' }, { small: true, cls: 'lg' }))
     && !B({ name: 'A B' }, { noName: true }).includes('lgb-name') && B({ name: 'A B' }, { noName: true }).includes('title="A B"'));
  ok('no league at all still draws a badge', B(null).includes('League'));
}

/* ------------------------------------------------------------------------- */
section('the card (a small DOM stub)');
{
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.className = ''; this._text = '';
      this.style = { props: {}, setProperty: (k, v) => { this.style.props[k] = v; } }; this.innerHTML = ''; }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    querySelectorAll() { return []; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
    get classList() { return { add: c => { this.className += ' ' + c; } }; }
  }
  const sandbox = {
    document: { createElement: t => new Node(t), createTextNode: s => ({ textContent: s }) },
    setTimeout, clearTimeout, Date, Promise, JSON, Math, Map, Set, encodeURIComponent, isFinite, parseInt, String, Array, Object
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  sandbox.epinoiaLeagueBadge = l => '<span class="lgb">' + l.name + '</span>';
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'globalgames.js'), sandbox);
  const W = sandbox.EpinoiaGlobalGames;
  const find = (n, cls) => { if ((' ' + n.className + ' ').includes(' ' + cls + ' ')) return n;
    for (const c of n.children || []) { const f = find(c, cls); if (f) return f; } return null; };

  const up = W.card(game('g1', L.bcb, 30 * H), { base: '../', now: NOW });
  ok('links to the game in supabase mode', up.href === '../game/?g=g1&mode=supabase');
  ok('an upcoming card is .fxc.is-upcoming with a tip-off column', /\bfxc is-upcoming\b/.test(up.className) && !!find(up, 'fxc-when'));
  ok('the league badge is on the card', find(up, 'fxc-lg').innerHTML.includes('BCB'));
  ok('club colours reach the card', up.style.props['--h'] === '#123456' && up.style.props['--a'] === undefined);
  ok('full and short club names', find(up, 'full').textContent === 'Home g1' && find(up, 'short').textContent === 'Hg1'
     && find(find(up, 'a'), 'short').textContent === 'Away');
  /* THE SCORE SITS BETWEEN THE TWO CLUBS, not inside one of them: the card puts them side by
     side either side of a middle column, so fxc-mid is where the numbers are and the win mark
     is on the number rather than on the whole side. */
  const mid = n => { const m = find(n, 'fxc-mid'); return m ? m.children.map(c => c.textContent).join('') : null; };
  const fin = W.card(game('g2', L.bcb, -D, 'final', { home_score: 71, away_score: 88 }), { base: '../', now: NOW, badge: false });
  ok('a final card shows both scores between the clubs, the winner marked, no tip-off row',
     /is-final/.test(fin.className) && !find(fin, 'fxc-when') && !find(fin, 'fxc-lg') &&
     mid(fin) === '71–88' && find(fin, 'fxc-sc a').className.includes('win'));
  ok('...and the loser\'s number is dimmed, not its whole side',
     find(fin, 'fxc-sc h').className.includes('lose'));
  const lv = W.card(game('g3', L.slbm, -H, 'live', { home_score: 10, away_score: 12 }), { now: NOW, state: { period: 3, score_home: 50, score_away: 48 } });
  ok('a live card takes the scorer\'s score and quarter', /is-live/.test(lv.className) &&
     mid(lv) === '50–48' && find(lv, 'fxc-st').textContent.includes('Q3'));
  ok('an upcoming card has a "v" there instead', mid(up) === 'v');

  /* THE GAME CLOCK UNDER THE SCORE of a live game */
  const T0 = Date.parse('2026-09-26T12:00:00Z');
  const S = (o) => Object.assign({ period: 1, score_home: 13, score_away: 10, clock_ms: 255000, running: false, updated_at: '2026-09-26T12:00:00Z' }, o);
  ok('a stopped clock reads as it stands, m:ss (4:15)', W.clockText(S({}), T0) === '4:15' && W.clockText(S({ clock_ms: 600000 }), T0) === '10:00');
  ok('a running clock is the reading less the time since it was written (4:15 written 20 s ago: 3:55)', W.clockText(S({ running: true }), T0 + 20000) === '3:55');
  ok('...counted in whole seconds, rounded up as a scoreboard does', W.clockText(S({ running: true, clock_ms: 61000 }), T0 + 500) === '1:01' && W.clockText(S({ clock_ms: 900 }), T0) === '0:01');
  ok('a running clock never goes below nothing, and a clock that has run out says the period ended', W.clockText(S({ running: true, clock_ms: 5000 }), T0 + 60000) === 'End Q1'
     && W.clockText(S({ clock_ms: 0, period: 4 }), T0) === 'End Q4' && W.clockText(S({ clock_ms: 0, period: 5 }), T0) === 'End OT');
  ok('half-time says so', W.clockText(S({ period: 2, clock_ms: 0, break_ms: 600000 }), T0) === 'Half-time');
  ok('no clock in the state, no clock text', W.clockText(null, T0) === '' && W.clockText({ period: 2 }, T0) === '' && W.clockText({ clock_ms: null }, T0) === '');
  const lc = W.card(game('g4', L.slbm, -H, 'live', {}), { now: NOW, state: S({}) });
  ok('a live card carries the clock under the score, in its own element beside the middle column (the score line is unchanged)',
     find(lc, 'fxc-clk') && find(lc, 'fxc-clk').textContent === '4:15' && find(lc, 'fxc-body').className.includes('has-clk') && mid(lc) === '13–10', find(lc, 'fxc-clk') && find(lc, 'fxc-clk').textContent);
  ok('a stopped clock is not ticked: it has no run marker', !find(lc, 'fxc-clk').attrs['data-run'] && !find(lc, 'fxc-clk').className.includes(' run'));
  const rc = W.card(game('g5', L.slbm, -H, 'live', {}), { now: NOW, state: S({ running: true, updated_at: new Date().toISOString() }) });
  ok('a running clock carries the reading it was drawn from, for the ticker (ms, when written, the period)',
     find(rc, 'fxc-clk').attrs['data-run'] === '1' && find(rc, 'fxc-clk').attrs['data-ms'] === '255000' && !!find(rc, 'fxc-clk').attrs['data-at'] && find(rc, 'fxc-clk').attrs['data-p'] === '1');
  ok('a live game with no state, a final and an upcoming card have no clock', !find(W.card(game('g6', L.slbm, -H, 'live', {}), { now: NOW }), 'fxc-clk')
     && !find(fin, 'fxc-clk') && !find(up, 'fxc-clk') && !find(W.card(game('g7', L.slbm, -H, 'live', {}), { now: NOW, state: { period: 2 } }), 'fxc-clk'));
}

/* ------------------------------------------------------------------------- */
section('pages');
{
  const home = rd('epinoia', 'home', 'index.html');
  const gi = home.indexOf('../globalgames.js'), ri = home.indexOf('../rt.js'), fi = home.indexOf('front.js?v'), di = home.indexOf('daily.js?v');
  ok('HOME loads rt.js and globalgames.js before front.js, and daily.js after it', ri > 0 && gi > ri && fi > gi && di > fi);
  ok('HOME links kit/fxc.css and its heading links to ../games/', home.includes('../kit/fxc.css?v=') && /<a class="showall" href="\.\.\/games\/">all fixtures →<\/a>/.test(home));

  const registered = {};
  const sandbox = { EpinoiaHome: { register: (n, fn) => { registered[n] = fn; }, fadeIn: e => e }, document: {}, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'home', 'daily.js'), sandbox);
  ok('daily.js registers the fixtures section', typeof registered.fixtures === 'function');
  const daily = rd('epinoia', 'home', 'daily.js');
  ok('daily.js refreshes at 15 s live and 30 s idle and listens on epinoia:live',
     /LIVE_MS = 15000/.test(daily) && /IDLE_MS = 30000/.test(daily) && daily.includes("'epinoia:live'"));

  /* A FAILED FIRST READ STILL SETS UP THE REFRESH: the launch rejects (front.js's quiet state),
     but the visibility listener and a poll timer exist, and the next good read replaces the
     error message, even on a day with no games at all (the empty key is '') */
  {
    const reg = {};
    const timers = [];
    const docListeners = {};
    let fail = true;
    const mk = () => ({ className: '', textContent: '', children: [],
      appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, querySelector() { return null; } });
    const host = mk();
    host.appendChild = function (c) { this.children.push(c); return c; };
    Object.defineProperty(host, 'textContent', { get() { return ''; }, set() { this.children = []; } });
    const box = {
      EpinoiaHome: { register: (n, fn) => { reg[n] = fn; }, fadeIn: e => e },
      EpinoiaGlobalGames: {
        STALE_MS: 7200000,
        leagues: async () => [], live: async () => [], nextFor: async () => null, liveState: async () => ({}),
        upcoming: async () => { if (fail) throw new Error('offline'); return []; },
        pickDaily: () => [], pickLive: G.pickLive, pickUpcoming: G.pickUpcoming, pickResults: G.pickResults,
        dailyTab: G.dailyTab, moreStep: G.moreStep
      },
      document: { visibilityState: 'visible', createElement: () => mk(),
        addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); } },
      setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
      clearTimeout: () => {},
      Date, Math, Promise, Error
    };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(rd('epinoia', 'home', 'daily.js'), box);
    let threw = false;
    try { await reg.fixtures({ host, base: '../', now: new Date(), fadeIn: e => e }); } catch (_) { threw = true; }
    ok('daily.js: a failed first read still rejects (front.js shows its quiet state)', threw);
    ok('daily.js: ...but a poll is scheduled and the visibility listener is set', timers.length > 0 && (docListeners.visibilitychange || []).length === 1);
    host.children = [{ className: 'empty', textContent: 'Fixtures could not be loaded just now.' }];
    fail = false;
    await timers[timers.length - 1].f();
    ok('daily.js: the next good read replaces the error, even with no games',
       host.children.length === 1 && /No games in the next few days/.test(host.children[0].textContent), JSON.stringify(host.children));
  }

  const games = rd('epinoia', 'games', 'index.html').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, ''); // JSON-LD (search-engine data, not code) is not a script for this rule

  const head = games.slice(0, games.indexOf('</head>'));
  ok('games/ loads ../appmode.js first in <head>', head.indexOf('<script') > 0 && head.slice(head.indexOf('<script')).startsWith('<script src="../appmode.js?v='));
  ok('games/ links the manifest and a strict CSP', head.includes('/epinoia/manifest.webmanifest') && /script-src 'self'/.test(head));
  ok('games/ links the kit, nav and fxc stylesheets', ['../kit/epinoia-kit.css?v=', '../kit/nav.css?v=', '../kit/fxc.css?v='].every(s => head.includes(s)));
  const order = ['../config.js', '../data.js', '../globalgames.js', 'games.js?v', '../nav.js', '../xscroll.js'].map(s => games.indexOf(s));
  /* all deferred but the two that must run in <head> before the page paints: appmode.js and
     i18n.js (the language, docs/i18n.md) */
  ok('games/ scripts: config, data, globalgames, games, nav, xscroll, in order, all deferred',
     order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])) &&
     (games.match(/<script src="[^"]+" defer><\/script>/g) || []).length === (games.match(/<script /g) || []).length - 2 &&
     /<script src="\.\.\/i18n\.js\?v=\d+"><\/script>/.test(games));
  ok('games/ has no inline script or inline handler', !/<script>(?!<)/.test(games) && !/<script(?![^>]*src=)[^>]*>/.test(games) && !/\son[a-z]+="/i.test(games));
  ok('games/ carries the heading, a Show more button and the count', games.includes('Global fixtures') &&
     /<button type="button" class="ep-btn more" id="gmMore" hidden>/.test(games) && games.includes('id="gmCount"'));
  const stamps = new Set((games.match(/\?v=(\d+)/g) || []));
  ok('games/ uses one ?v= stamp throughout', stamps.size === 1, [...stamps].join());
  const gjs = rd('epinoia', 'games', 'games.js');
  ok('games.js pages 30 at a time and reads "of" / "all N shown"', /PAGE = 30/.test(gjs) && gjs.includes("' of '") && gjs.includes("'all '"));
}

/* ------------------------------------------------------------------------- */
/* ------------------------------------------------------------------------- */
section('daily fixtures: what the reader follows comes first');
{
  const live = (id, league, off) => game(id, league, off, 'live');
  /* six live games across three leagues, the followed league's spread through the tip-off order */
  const lives = [live('b1', L.bcb, -50 * 60e3), live('m1', L.slbm, -45 * 60e3), live('w1', L.slbw, -40 * 60e3),
                 live('b2', L.bcb, -30 * 60e3), live('m2', L.slbm, -20 * 60e3), live('b3', L.bcb, -10 * 60e3)];
  const none = ids(G.pickDaily(lives, [], [], NOW, 8));
  ok('nothing followed: the order is everybody\'s (tip-off order), whether the argument is missing, empty or null',
     none.join() === 'b1,m1,w1,b2,m2,b3' && ids(G.pickDaily(lives, [], [], NOW, 8, null)).join() === none.join()
     && ids(G.pickDaily(lives, [], [], NOW, 8, { leagues: [], teams: [] })).join() === none.join());
  ok('a followed LEAGUE with several games live: all of its games are pulled to the front, in tip-off order, then the rest',
     ids(G.pickDaily(lives, [], [], NOW, 8, { leagues: ['l-bcb'], teams: [] })).join() === 'b1,b2,b3,m1,w1,m2');
  ok('a followed CLUB (either side of the game): its game leads',
     ids(G.pickDaily(lives, [], [], NOW, 8, { leagues: [], teams: ['a-w1'] })).join() === 'w1,b1,m1,b2,m2,b3'
     && ids(G.pickDaily(lives, [], [], NOW, 8, { leagues: [], teams: ['h-m2'] }))[0] === 'm2');
  ok('a league and a club together: both come first, the followed club\'s game among them by tip-off',
     ids(G.pickDaily(lives, [], [], NOW, 8, { leagues: ['l-slbm'], teams: ['h-b3'] })).join() === 'm1,m2,b3,b1,w1,b2');
  ok('following changes the order, never the games: the same set, every live game shown even past the eight cards',
     [...ids(G.pickDaily(lives, [], [], NOW, 8, { leagues: ['l-bcb'], teams: [] }))].sort().join() === [...none].sort().join());
  const many = [];
  for (let i = 0; i < 11; i++) many.push(live('x' + i, i % 2 ? L.slbm : L.bcb, -(60 - i) * 60e3));
  const manyPick = ids(G.pickDaily(many, [], [], NOW, 8, { leagues: ['l-slbm'], teams: [] }));
  ok('more live games than cards: the followed league\'s are still all there, and first',
     manyPick.length === 11 && manyPick.slice(0, 5).every(id => Number(id.slice(1)) % 2 === 1), manyPick.join());

  /* and the next games: each followed league's and each followed club's, before anybody else's */
  const ups = [game('u-b', L.bcb, 1 * H), game('u-m', L.slbm, 2 * H), game('u-w', L.slbw, 3 * H)];
  const nextsAll = [ups[0], ups[1], ups[2]];
  const withFollow = ids(G.pickDaily([], ups, nextsAll, NOW, 2, { leagues: ['l-slbw'], teams: [] }));
  ok('with room for two cards, a followed league\'s next game takes one before the nearer ones, and leads',
     withFollow.join() === 'u-w,u-b', withFollow.join());
  const byTeam = ids(G.pickDaily([], ups, nextsAll, NOW, 2, { leagues: [], teams: ['a-u-m'] }));
  ok('...so does a followed club\'s (the away side counts)', byTeam[0] === 'u-m' && byTeam.length === 2, byTeam.join());
  const extra = game('u-w2', L.slbw, 5 * H);
  ok('only the NEXT game of a followed league is pulled forward, not the whole league: a league with a card already (live) is not given a second',
     ids(G.pickDaily([live('w-live', L.slbw, -10 * 60e3)], ups.concat([extra]), nextsAll, NOW, 3, { leagues: ['l-slbw'], teams: [] })).filter(id => id.startsWith('u-w')).length === 0);
  ok('a followed game more than 14 days away does not jump the queue (the same window as everybody\'s): with one card, the nearer game keeps it',
     ids(G.pickDaily([], [game('near', L.bcb, 2 * H), game('far', L.slbw, 20 * D)], [], NOW, 1, { leagues: ['l-slbw'], teams: [] })).join() === 'near');
  ok('followSets / isFollowed: a league or either club; nothing followed follows nothing',
     G.isFollowed(ups[0], G.followSets({ leagues: ['l-bcb'] })) && G.isFollowed(ups[1], G.followSets({ teams: ['h-u-m'] }))
     && !G.isFollowed(ups[2], G.followSets({ leagues: ['l-bcb'], teams: ['h-u-m'] })) && !G.isFollowed(ups[0], G.followSets(null)));
  const dj = rd('epinoia', 'home', 'daily.js');
  ok('the home rail asks follow.js (never access.js), hands the lists to pickDaily, and re-orders when a follow is saved',
     /F\.load\(\)/.test(dj) && /fav_league_ids/.test(dj) && /fav_team_ids/.test(dj) && !/EpinoiaAccess/.test(dj)
     && /G\.pickUpcoming\(liveRaw, ups, nexts, now, N, limit\.up \+ 1, fol\)/.test(dj) && /G\.pickLive\(liveRaw, now, fol\)/.test(dj) && /addEventListener\('epinoia:follows', \(\) => schedule\(0\)\)/.test(dj)
     && /<script src="\.\.\/follow\.js\?v=\d+" defer><\/script>\s*<script src="front\.js/.test(rd('epinoia', 'home', 'index.html')));
}

section('one dropdown per league: the leagues with a game this week, and a feed of one league');
{
  const seen = [];
  const week = [
    { id: 'g1', tipoff_at: '2026-10-03T18:00:00Z', competitions: { seasons: { league_id: 'LB' } } },
    { id: 'g2', tipoff_at: '2026-10-03T14:00:00Z', competitions: { seasons: { league_id: 'LA' } } },
    { id: 'g3', tipoff_at: '2026-10-04T14:00:00Z', competitions: { seasons: { league_id: 'LA' } } },
    { id: 'g4', tipoff_at: '2026-10-05T14:00:00Z', competitions: { seasons: { league_id: 'LC' } } },
    { id: 'gx', tipoff_at: '2026-10-05T14:00:00Z', competitions: null }
  ];
  const sandbox = {
    EPINOIA_CONFIG: { supabaseUrl: 'https://ref.supabase.co', supabaseAnonKey: 'anon' },
    fetch: async url => { seen.push(decodeURIComponent(url)); return { ok: true, status: 200, json: async () => (/status=eq\.scheduled/.test(url) && /select=id,tipoff_at,competitions/.test(url) ? week : []), headers: { get: () => null } }; },
    setTimeout, clearTimeout, Date, Promise, JSON, Math, Map, Set, encodeURIComponent, decodeURIComponent, isFinite, parseInt, String, Array, Object
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(rd('epinoia', 'globalgames.js'), sandbox);
  const W = sandbox.EpinoiaGlobalGames;
  const NOWW = Date.parse('2026-10-03T12:00:00Z');

  const lw = await W.weekLeagues(NOWW, 7);
  ok('weekLeagues counts each league\'s scheduled games in the next seven days, soonest league first, and skips a row with no league',
     JSON.stringify(lw.map(x => [x.id, x.n])) === JSON.stringify([['LA', 2], ['LB', 1], ['LC', 1]]) && lw[0].first === Date.parse('2026-10-03T14:00:00Z'), lw);
  const q = seen.find(u => /select=id,tipoff_at,competitions/.test(u));
  ok('...one light read: ids and tip-offs, scheduled only, from two hours ago to seven days on, inner-joined to the league',
     /status=eq\.scheduled/.test(q) && /tipoff_at=gte\.2026-10-03T10:00:00\.000Z/.test(q) && /tipoff_at=lt\.2026-10-10T12:00:00\.000Z/.test(q)
     && /competitions!inner\(seasons!inner\(league_id\)\)/.test(q) && /limit=1000/.test(q), q);
  ok('...and a different number of days moves the far edge', (await W.weekLeagues(NOWW, 3), /tipoff_at=lt\.2026-10-06T12:00:00\.000Z/.test(seen[seen.length - 1])), seen[seen.length - 1]);

  const LG = '3f4858ce-a146-4acc-aa36-53af617d3fdb';
  seen.length = 0;
  await W.feed({ now: NOWW, batch: 5, league: LG }).next(5);
  const reads = seen.filter(u => /\/games\?/.test(u));
  ok('a league\'s feed reads that league alone, on both sides (upcoming and results)',
     reads.length >= 2 && reads.every(u => u.includes('&competitions.seasons.league_id=eq.' + LG)) && reads.some(u => /status=eq\.scheduled/.test(u)) && reads.some(u => /status=eq\.final/.test(u)), reads);
  seen.length = 0;
  await W.feed({ now: NOWW, batch: 5 }).next(5);
  ok('...and the global feed still reads every league', seen.filter(u => /\/games\?/.test(u)).every(u => !/league_id=eq\./.test(u)));
  seen.length = 0;
  await W.feed({ now: NOWW, batch: 5, league: "x'); drop table games; --" }).next(5);
  seen.length = 0;
  await W.feed({ now: NOWW, batch: 5, league: [LG, 'not-an-id', '11111111-2222-3333-4444-555555555555'] }).next(5);
  ok('a list of leagues is one filter over them all (an id that is not one is left out)',
     seen.filter(u => /\/games\?/.test(u)).length >= 2 && seen.filter(u => /\/games\?/.test(u)).every(u => u.includes('&competitions.seasons.league_id=in.(' + LG + ',11111111-2222-3333-4444-555555555555)') && !/not-an-id/.test(u)));
  seen.length = 0;
  await W.feed({ now: NOWW, batch: 5, league: "x'); drop table games; --" }).next(5);
  ok('...a league that is not an id is not put in the address', seen.filter(u => /\/games\?/.test(u)).every(u => !/league_id/.test(u) && !/drop table/.test(u)));
}

section('one side of one league: Show more upcoming / Show more results');
{
  const T0 = Date.parse('2026-10-03T12:00:00Z');
  const hr = h => new Date(T0 + h * 3600000).toISOString();
  const table = [];
  for (let i = 1; i <= 14; i++) table.push({ id: 'u' + String(i).padStart(2, '0'), tipoff_at: hr(i), status: 'scheduled' });
  for (let i = 1; i <= 10; i++) table.push({ id: 'r' + String(i).padStart(2, '0'), tipoff_at: hr(-i * 5), status: 'final' });
  const calls = [];
  /* the same filters and keyset order the real query applies: up = scheduled from two hours ago, asc; res = finals before now, desc */
  const fetchSide = async (side, after, limit) => {
    calls.push({ side, after });
    let rows = table.filter(g => side === 'up' ? g.status === 'scheduled' && Date.parse(g.tipoff_at) >= T0 - 7200000 : g.status === 'final' && Date.parse(g.tipoff_at) < T0);
    rows.sort((a, b) => side === 'up' ? (Date.parse(a.tipoff_at) - Date.parse(b.tipoff_at)) || a.id.localeCompare(b.id) : (Date.parse(b.tipoff_at) - Date.parse(a.tipoff_at)) || b.id.localeCompare(a.id));
    if (after) rows = rows.filter(g => side === 'up' ? (Date.parse(g.tipoff_at) > after.t || (Date.parse(g.tipoff_at) === after.t && g.id > after.id))
      : (Date.parse(g.tipoff_at) < after.t || (Date.parse(g.tipoff_at) === after.t && g.id < after.id)));
    return { rows: rows.slice(0, limit), total: null };
  };
  const up = G.sideFeed({ now: T0, side: 'up', batch: 5, fetch: fetchSide });
  const p1 = await up.next(5), p2 = await up.next(5), p3 = await up.next(5);
  ok('upcoming: the next games, soonest first, five at a time, until the side runs out', ids(p1.rows).join() === 'u01,u02,u03,u04,u05' && ids(p2.rows).join() === 'u06,u07,u08,u09,u10'
     && ids(p3.rows).join() === 'u11,u12,u13,u14' && p3.done && !p1.done, [ids(p1.rows), ids(p2.rows), ids(p3.rows), p3.done]);
  const res = G.sideFeed({ now: T0, side: 'res', batch: 4, fetch: fetchSide });
  const r1 = await res.next(4), r2 = await res.next(4);
  ok('results: the latest first, going back in time, never touching the upcoming side', ids(r1.rows).join() === 'r01,r02,r03,r04' && ids(r2.rows).join() === 'r05,r06,r07,r08' && calls.filter(c => c.side === 'res').length >= 2);
  const up2 = G.sideFeed({ now: T0, side: 'up', batch: 3, fetch: fetchSide, after: { t: Date.parse(hr(4)), id: 'u04' } });
  ok('a cursor that starts after what the page already shows reads on from there, and never repeats it', ids((await up2.next(3)).rows).join() === 'u05,u06,u07');
  up2.advance({ t: Date.parse(hr(10)), id: 'u10' });
  ok('...and advance() moves it past what another Show more has since put on the page (never backwards)', ids((await up2.next(3)).rows).join() === 'u11,u12,u13' && (up2.advance({ t: Date.parse(hr(1)), id: 'u01' }), ids((await up2.next(3)).rows).join() === 'u14'));
  const res2 = G.sideFeed({ now: T0, side: 'res', batch: 3, fetch: fetchSide, after: { t: Date.parse(hr(-15)), id: 'r03' } });
  res2.advance({ t: Date.parse(hr(-5)), id: 'r01' });
  ok('...for results, further means older', ids((await res2.next(3)).rows).join() === 'r04,r05,r06');
}

section('/epinoia/games/: nearest first, only the week\'s leagues, a Show more of its own in each');
{
  const gjs2 = rd('epinoia', 'games', 'games.js'), ghtml = rd('epinoia', 'games', 'index.html');
  ok('the leagues on the page are the ones with a game in the next 7 days (and any with a game live) - and both cursors are scoped to them',
     /gg\.weekLeagues\(NOW, WEEK_DAYS\)/.test(gjs2) && /WEEK_DAYS = 7/.test(gjs2) && /week\.forEach\(w => \{ if \(byId\.has\(w\.id\)\) addGroup\(/.test(gjs2)
     && /feed = gg\.feed\(\{ now: NOW, exclude: live, batch: PAGE, league: scope \}\)/.test(gjs2));
  ok('the page still starts with the 30 nearest to now, page-wide, and its Show more reads 30 more across every league',
     /const PAGE = 30, LEAGUE_PAGE = 6/.test(gjs2) && /const res = await pull\(feed, PAGE\);/.test(gjs2) && /id="gmMore"/.test(ghtml));
  ok('each league has ONE button in two halves - "Show more upcoming in this league" and "Show more results in this league" - each half its own cursor of that league, beginning after what the page already shows for that side',
     /'Show more upcoming in this league'/.test(gjs2) && /'Show more results in this league'/.test(gjs2) && /const split = el\('div', 'gm-split'\)/.test(gjs2)
     && /G\(\)\.sideFeed\(\{ now: NOW, league: rec\.id, side, batch: n, exclude: liveIds \}\)/.test(gjs2) && /st\.feed\.advance\(edgeOf\(rec, side\)\)/.test(gjs2)
     && /\.gm-split\{display:flex/.test(ghtml) && /\.gm-split \.ep-btn\.more\{flex:1 1 50%/.test(ghtml));
  ok('...a press adds games and never repeats one, a half goes when its side has no more, and a league with nothing on the page yet is read on both sides when opened',
     /if \(!rows\.has\(g\.id\)\) fresh\+\+;/.test(gjs2) && /\} while \(fresh < n && !res\.done\);/.test(gjs2) && /up\.btn\.hidden = up\.done;/.test(gjs2) && /res\.btn\.hidden = res\.done;/.test(gjs2)
     && /if \(det\.open && !rec\.opened\) \{ rec\.opened = true; if \(!leagueRows\(rec\.id\)\.length\) readBoth\(rec\); \}/.test(gjs2));
  ok('the order, in code: leagues by the game (or result) closest to now; inside one, next soonest first then results newest first',
     /const dist = rec => Math\.min\(/.test(gjs2) && /G\(\)\.groupOrder\(Array\.from\(rows\.values\(\)\), NOW\)/.test(gjs2)
     && /section\('Next games, soonest first'/.test(gjs2) && /section\('Latest results, newest first'/.test(gjs2));
  ok('...and in words, at the top, in one sentence: nearest to now first, the week\'s leagues, next games then results, Show more goes further out',
     ghtml.includes('<p class="gm-lede">Nearest to now first: leagues with a game in the next 7 days, each showing next games (soonest first) then latest results; Show more goes further out.</p>')
     && !/gm-rules/.test(ghtml));
  ok('...translated: the sentence, the sub-headings and the league button, in Japanese and Spanish',
     ['ja', 'es'].every(code => { const c = rd('epinoia', 'i18n', code + '.js');
       return ['Nearest to now first: leagues with a game in the next 7 days, each showing next games (soonest first) then latest results; Show more goes further out.',
         'Next games, soonest first', 'Latest results, newest first', 'Show more upcoming in this league', 'Show more results in this league']
         .every(k => c.includes("'" + k + "'")); }));
  ok('live games are still pinned above every group and a game that goes live leaves its league\'s list',
     /if \(rows\.has\(g\.id\)\) \{ rows\.delete\(g\.id\); return true; \}/.test(gjs2) && /id="gmLive"/.test(ghtml));
}

section('a game live for eight hours after tip-off is not a live card (26-30 Sep 2026: four sat on HOME for days)');
{
  const stuck = [game('oak', L.slbw, -340 * D, 'live'), game('cz', L.bcb, -5 * D, 'live'), game('kos', L.slbm, -3 * D, 'live')];
  const fine = game('now', L.bcb, -90 * 60e3, 'live'), late = game('ot', L.bcb, -3.5 * H, 'live');
  const got = G.pickDaily(stuck.concat([fine, late]), [], [], NOW, 8);
  ok('only the games being played are live cards', ids(got).join() === 'ot,now', ids(got).join());
  ok('overdue() says which', stuck.every(g => G.overdue(g, NOW)) && !G.overdue(fine, NOW) && !G.overdue(game('s', L.bcb, -9 * H, 'scheduled'), NOW));
  ok('a game the ingest flagged stalled is not a live card either', G.pickDaily([Object.assign({}, fine, { stalled_since: at(-H) })], [], [], NOW, 8).length === 0);
  ok('the live read is bounded to the last eight hours of tip-offs', /status=eq\.live&tipoff_at=gte\./.test(rd('epinoia', 'globalgames.js')));
}

/* ------------------------------------------------------------------------- */
section('HOME: LIVE | UPCOMING | RESULTS, and SHOW MORE');
{
  const live = (id, league, off, extra) => game(id, league, off, 'live', extra);
  const fin = (id, league, off) => game(id, league, off, 'final');
  /* ---- the split: each tab one kind of game ---- */
  const lives = [live('l1', L.bcb, -30 * 60e3), live('l2', L.slbm, -90 * 60e3), live('stuck', L.bcb, -9 * H), live('stall', L.slbw, -20 * 60e3, { stalled_since: at(-5 * 60e3) })];
  ok('pickLive: only games in progress, oldest tip-off first; the overdue (8 h) and the stalled are left off',
     ids(G.pickLive(lives, NOW)).join() === 'l2,l1', ids(G.pickLive(lives, NOW)).join());
  ok('pickLive: a followed league\'s live game leads', ids(G.pickLive(lives, NOW, { leagues: ['l-bcb'], teams: [] })).join() === 'l1,l2');
  ok('pickLive: a scheduled or final row is never LIVE', G.pickLive([game('s', L.bcb, H), fin('f', L.bcb, -H)], NOW).length === 0);

  const ups = [];
  for (let i = 0; i < 30; i++) ups.push(game('u' + String(i).padStart(2, '0'), [L.bcb, L.slbm, L.slbw][i % 3 === 0 ? 0 : i % 7 === 0 ? 2 : 1], (i + 1) * H));
  /* a game the upcoming read held as scheduled has since tipped off: the live read says so */
  const wentLive = Object.assign({}, ups[0], { status: 'live' });
  const up8 = G.pickUpcoming([wentLive], ups, [], NOW, 8, 8);
  ok('pickUpcoming: no live game on UPCOMING, even one the held upcoming read still calls scheduled',
     up8.length === 8 && !ids(up8).includes('u00') && up8.every(g => g.status === 'scheduled'), ids(up8).join());
  ok('pickUpcoming: the first eight are pickDaily\'s (each league\'s next game within a fortnight first)',
     ids(up8).join() === ids(G.pickDaily([], ups.slice(1), [], NOW, 8)).join());
  const nextFar = game('far-w', L.slbw, 10 * D);
  ok('pickUpcoming: a league\'s next game from nextAll beyond the forty still takes a card',
     ids(G.pickUpcoming([], ups.slice(0, 3).map(g => Object.assign({}, g, { competitions: game('x', L.bcb, 0).competitions })), new Map([['l-slbw', nextFar]]), NOW, 8, 8)).includes('far-w'));
  const up24 = G.pickUpcoming([], ups, [], NOW, 8, 24);
  ok('SHOW MORE never moves a card: the first eight of 24 are the eight, the new ones come after them, by tip-off',
     ids(up24.slice(0, 8)).join() === ids(G.pickUpcoming([], ups, [], NOW, 8, 8)).join()
     && up24.slice(8).every((g, i, a) => i === 0 || Date.parse(g.tipoff_at) >= Date.parse(a[i - 1].tipoff_at))
     && new Set(ids(up24)).size === 24, ids(up24).join());

  const res = [];
  for (let i = 0; i < 20; i++) res.push(fin('r' + String(i).padStart(2, '0'), i < 12 ? L.bcb : (i % 2 ? L.slbm : L.slbw), -(i + 1) * H));
  const r8 = G.pickResults(res.concat([game('sched', L.bcb, -H / 2), live('lv', L.bcb, -H / 3)]), 8, 8, 3);
  ok('pickResults: finals only, newest first within the league cap, no league more than three of the first eight',
     r8.every(g => g.status === 'final') && ids(r8).filter(id => Number(id.slice(1)) < 12).length === 3 && r8.length === 8, ids(r8).join());
  const r20 = G.pickResults(res, 8, 20, 3);
  ok('pickResults: SHOW MORE keeps the eight and adds the next newest after them (no cap past the first eight)',
     ids(r20.slice(0, 8)).join() === ids(G.pickResults(res, 8, 8, 3)).join() && r20.length === 20
     && r20.slice(8).every((g, i, a) => i === 0 || Date.parse(g.tipoff_at) <= Date.parse(a[i - 1].tipoff_at)));

  /* ---- which tab ---- */
  const T = o => G.dailyTab(o);
  ok('default: LIVE when anything is live, else UPCOMING', T({ live: 3 }).tab === 'live' && T({ live: 0 }).tab === 'up' && T({}).tab === 'up');
  ok('the reader\'s pick of the visit wins on arrival (RESULTS with games live is RESULTS; UPCOMING is UPCOMING)',
     T({ live: 2, chosen: 'res' }).tab === 'res' && T({ live: 2, chosen: 'up' }).tab === 'up');
  ok('...but a pick of LIVE with nothing live opens UPCOMING, quietly (nothing fell: nothing was shown)',
     T({ live: 0, chosen: 'live' }).tab === 'up' && T({ live: 0, chosen: 'live' }).fell === false);
  ok('a game tipping off while the reader is on UPCOMING or RESULTS does not move them',
     T({ live: 1, current: 'up' }).tab === 'up' && T({ live: 5, current: 'res', chosen: 'res' }).tab === 'res');
  ok('LIVE emptying while it is shown falls back to UPCOMING, and says so',
     T({ live: 0, current: 'live' }).tab === 'up' && T({ live: 0, current: 'live' }).fell === true && T({ live: 1, current: 'live' }).tab === 'live');
  ok('a stored value that is not a tab is ignored', T({ live: 0, chosen: 'bogus' }).tab === 'up' && T({ live: 1, chosen: 'bogus' }).tab === 'live');

  /* ---- the batches ---- */
  const M = (a, b) => G.moreStep(a, b, 8, 40);
  ok('moreStep: eight a press while there is more', M(8, 30).next === 16 && M(8, 30).more && M(16, 30).next === 24);
  ok('moreStep: no SHOW MORE when the first eight are all there is', !M(8, 8).more && !M(5, 5).more);
  ok('moreStep: never past the cap; at the cap the button is the link to the fixtures page',
     M(32, 99).next === 40 && M(40, 99).more === false && M(40, 99).atCap && M(36, 99).next === 40);
  ok('moreStep: data running out before the cap ends it too', M(24, 24).more === false && !M(24, 24).atCap);

  /* ---- daily.js in a small stand-in DOM: the default tab, the fallback, the badge, SHOW MORE / LESS, the lazy page, motion ---- */
  function matches(el, sel) {
    return sel.split(',').some(one => {
      const m = one.trim().match(/^([a-z]+)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
      if (!m) return false;
      if (m[1] && el.tag !== m[1].toLowerCase()) return false;
      return (m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []).every(p => {
        if (p[0] === '.') return (' ' + el.className + ' ').includes(' ' + p.slice(1) + ' ');
        if (p[0] === '#') return el.id === p.slice(1);
        const a = p.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
        const v = el.getAttribute(a[1]);
        return a[2] == null ? v != null : v === a[2];
      });
    });
  }
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this.id = ''; this._text = '';
      this.listeners = {}; this.hidden = false; this.anims = []; this.style = {}; this.parent = null; this.dataset = {}; this.tabIndex = 0; }
    get classList() { const e = this; return {
      add: c => { if (!(' ' + e.className + ' ').includes(' ' + c + ' ')) e.className = (e.className + ' ' + c).trim(); },
      remove: c => { e.className = e.className.split(' ').filter(x => x && x !== c).join(' '); },
      contains: c => (' ' + e.className + ' ').includes(' ' + c + ' ') }; }
    set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = String(v); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
    getAttribute(k) { if (k === 'id') return this.id || null; if (k === 'class') return this.className; if (k === 'hidden') return this.hidden ? '' : null;
      return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    click() { const ev = { target: this, preventDefault() {} }; for (let x = this; x; x = x.parent) (x.listeners.click || []).forEach(f => f(ev)); }
    all() { return this.children.flatMap(c => [c].concat(c.all())); }
    querySelectorAll(sel) { return this.all().filter(e => matches(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    contains(e) { for (let x = e; x; x = x.parent) if (x === this) return true; return false; }
    closest(sel) { for (let x = this; x; x = x.parent) if (matches(x, sel)) return x; return null; }
    focus() { doc.activeElement = this; }
    get offsetHeight() { return 100 * this.all().filter(e => matches(e, '.fxc')).length + 40; }
    getBoundingClientRect() { return { top: 10 }; }
    scrollIntoView() {}
    animate(frames, opts) { const a = { frames, opts, finish() {} }; this.anims.push(a); anims.push(a); return a; }
  }
  let doc, anims;
  function page(o) {
    anims = [];
    const timers = [];
    const seg = new El('div'); seg.id = 'fxSeg';
    const tab = (fx, id) => { const b = new El('button'); b.setAttribute('data-fx', fx); b.id = id; seg.appendChild(b); return b; };
    const lb = tab('live', 'fxTabLive'); lb.hidden = true; const n = new El('b'); n.className = 'fx-n'; lb.appendChild(n);
    tab('up', 'fxTabUp'); tab('res', 'fxTabRes');
    const sayEl = new El('span'); sayEl.id = 'fxSay';
    const section = new El('section');
    const host = new El('div'); section.appendChild(host);
    doc = { visibilityState: 'visible', activeElement: null, createElement: t => new El(t),
      getElementById: id => (id === 'fxSeg' ? seg : id === 'fxSay' ? sayEl : null), addEventListener() {} };
    const calls = { up: [], res: [] };
    const store = Object.assign({}, o.session || {});
    const box = {
      EpinoiaHome: { register: (k, f) => { box.reg = f; }, fadeIn: e => e },
      EpinoiaGlobalGames: Object.assign({}, G, {
        STALE_MS: G.STALE_MS,
        live: async () => o.live(),
        upcoming: async (from, lim) => { calls.up.push(from); const all = o.ups.filter(g => g.tipoff_at >= from); return all.slice(0, lim); },
        recent: async (before, off, lim) => { calls.res.push(off); return o.res.slice(off, off + lim); },
        nextAll: async () => new Map(), liveState: async () => ({}),
        card: g => { const a = new El('a'); a.className = 'fxc ' + (g.status === 'live' ? 'is-live' : 'is-upcoming'); a.setAttribute('href', '/g/' + g.id); a.gid = g.id; return a; }
      }),
      sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
      matchMedia: q => ({ matches: /reduce/.test(q) && !!o.reduce }),
      document: doc,
      setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
      Date: { now: () => NOW, parse: Date.parse }, Math, Promise, Error, Map, Set, Array, Object, String, Number, JSON
    };
    box.Date = new Proxy(Date, { get: (t, k) => (k === 'now' ? () => NOW : t[k]) });
    box.window = box;
    vm.createContext(box);
    vm.runInContext(rd('epinoia', 'home', 'daily.js'), box);
    return { box, host, seg, lb, sayEl, calls, store, timers, start: () => box.reg({ host, base: '../' }),
      tick: async () => { const t = timers.filter(x => x.ms >= 15000).pop(); timers.length = 0; await t.f(); },
      sel: () => seg.querySelector('button[aria-selected="true"]').dataset.fx,
      cards: () => host.querySelectorAll('.fxc').map(c => c.gid) };
  }
  const flush = () => new Promise(r => setTimeout(r, 0));
  const someUps = [];
  for (let i = 0; i < 60; i++) someUps.push(game('p' + String(i).padStart(2, '0'), [L.bcb, L.slbm, L.slbw][i % 3], (i + 1) * 30 * 60e3));
  const someRes = [];
  for (let i = 0; i < 60; i++) someRes.push(fin('q' + String(i).padStart(2, '0'), [L.bcb, L.slbm, L.slbw][i % 3], -(i + 1) * H));

  let liveNow = [live('a1', L.bcb, -20 * 60e3), live('a2', L.slbm, -40 * 60e3)];
  let P = page({ live: () => liveNow, ups: someUps, res: someRes });
  await P.start();
  ok('daily.js: with games live a visit opens on LIVE, its tab shown with the count, and only the live games on it',
     P.sel() === 'live' && !P.lb.hidden && P.lb.querySelector('.fx-n').textContent === '2' && P.cards().join() === 'a2,a1', P.cards().join());
  ok('...the LIVE tab has no SHOW MORE with 20 or fewer live (every live game is on it)', !P.host.querySelector('[data-act="more"]'));
  {
    /* ABOVE 20 LIVE: the first 20, then SHOW MORE adds 20 a press from what is already read; no ALL FIXTURES at the end */
    const many = [];
    for (let i = 0; i < 30; i++) many.push(live('m' + String(i).padStart(2, '0'), [L.bcb, L.slbm, L.slbw][i % 3], -(i + 1) * 60e3));
    const Q = page({ live: () => many, ups: someUps, res: someRes });
    await Q.start();
    ok('daily.js: above 20 live, LIVE shows the first 20 and a SHOW MORE', Q.sel() === 'live' && Q.cards().length === 20 && !!Q.host.querySelector('[data-act="more"]'), Q.cards().length);
    const liveReads = Q.calls.live ? Q.calls.live.length : null;
    Q.host.querySelector('[data-act="more"]').click(); await flush(); await flush();
    ok('...SHOW MORE brings in the rest (30), with SHOW LESS and no ALL FIXTURES link',
       Q.cards().length === 30 && !!Q.host.querySelector('[data-act="less"]') && !Q.host.querySelector('[data-act="more"]') && !Q.host.querySelector('.fx-all'), Q.cards().length);
    ok('...and it read nothing new to do it', liveReads === null || (Q.calls.live && Q.calls.live.length === liveReads));
    Q.host.querySelector('[data-act="less"]').click();
    ok('...SHOW LESS goes back to 20', Q.cards().length === 20, Q.cards().length);
  }
  liveNow = [];
  await P.tick();
  ok('daily.js: LIVE emptying while shown falls back to UPCOMING with a line saying why, and the LIVE tab goes',
     P.sel() === 'up' && P.lb.hidden && !!P.host.querySelector('.fx-note') && P.cards().length === 8 && P.cards().every(id => id[0] === 'p'));
  liveNow = [live('a3', L.slbw, -5 * 60e3)];
  await P.tick();
  ok('daily.js: a game going live while the reader is on UPCOMING lights the LIVE tab and its count, and leaves them on UPCOMING',
     P.sel() === 'up' && !P.lb.hidden && P.lb.querySelector('.fx-n').textContent === '1' && P.cards().every(id => id[0] === 'p')
     && /1 live/.test(P.sayEl.textContent) && !P.host.querySelector('.fx-note'));

  liveNow = [];
  P = page({ live: () => liveNow, ups: someUps, res: someRes });
  await P.start();
  ok('daily.js: nothing live opens on UPCOMING, the LIVE tab hidden, eight cards and a SHOW MORE that controls the list',
     P.sel() === 'up' && P.lb.hidden && P.cards().length === 8 && P.host.querySelector('[data-act="more"]').getAttribute('aria-controls') === 'fxList'
     && P.host.querySelector('[data-act="more"]').getAttribute('aria-expanded') === 'false');
  const first8 = P.cards().join();
  P.host.querySelector('[data-act="more"]').click(); await flush(); await flush();
  ok('SHOW MORE: eight more, the first eight unmoved, the list open (a grid on a phone), SHOW LESS beside it, focus on the first new card',
     P.cards().length === 16 && P.cards().slice(0, 8).join() === first8 && /is-open/.test(P.host.querySelector('#fxList').className)
     && !!P.host.querySelector('[data-act="less"]') && doc.activeElement && doc.activeElement.gid === P.cards()[8]);
  const wiped = anims.filter(a => a.frames[0].clipPath);
  ok('...the new cards wipe in one after another (fade, rise, a top-down wipe, 50 ms apart) and the height follows',
     wiped.length === 8 && wiped[1].opts.delay - wiped[0].opts.delay === 50 && anims.some(a => a.frames[0].height));
  ok('...one read of the first page so far: the forty held cover sixteen', P.calls.up.length === 1);
  for (let i = 0; i < 3; i++) { P.host.querySelector('[data-act="more"]').click(); await flush(); await flush(); }
  ok('SHOW MORE to the cap: forty cards, then no SHOW MORE but the link to the fixtures page, and SHOW LESS',
     P.cards().length === 40 && !P.host.querySelector('[data-act="more"]') && !!P.host.querySelector('a.fx-all') && !!P.host.querySelector('[data-act="less"]'));
  ok('...the next page was read only when forty-one were needed, from the last tip-off held (a keyset)',
     P.calls.up.length === 2 && P.calls.up[1] === someUps[39].tipoff_at, P.calls.up.join(' | '));
  P.host.querySelector('[data-act="less"]').click();
  ok('SHOW LESS folds back to the eight, focus on SHOW MORE', P.cards().join() === first8 && doc.activeElement === P.host.querySelector('[data-act="more"]'));

  const stale = P.host.querySelector('[data-act="more"]');
  P.seg.querySelector('button[data-fx="res"]').click();
  stale.click(); await flush(); await flush();
  ok('a press on the old tab\'s SHOW MORE while the new tab loads does nothing (the new tab opens on its eight)',
     P.sel() === 'res' && P.cards().length === 8 && stale.disabled === true, P.cards().length);
  ok('RESULTS: finals newest first, chosen for the visit, and SHOW MORE there too',
     P.sel() === 'res' && P.store.epinoia_home_fixtures === 'res' && P.cards()[0] === 'q00' && !!P.host.querySelector('[data-act="more"]'));
  for (let i = 0; i < 4; i++) { P.host.querySelector('[data-act="more"]').click(); await flush(); await flush(); }
  ok('...forty results, the second forty read (same query, the next offset) only for the last press', P.cards().length === 40 && P.calls.res.join() === '0,40', P.calls.res.join());

  liveNow = [live('a1', L.bcb, -20 * 60e3)];
  P = page({ live: () => liveNow, ups: someUps, res: someRes, session: { epinoia_home_fixtures: 'res' }, reduce: true });
  await P.start();
  ok('the reader\'s pick of the visit wins over LIVE on arrival', P.sel() === 'res' && !P.lb.hidden);
  P.host.querySelector('[data-act="more"]').click(); await flush(); await flush();
  ok('reduced motion: SHOW MORE reveals at once, nothing animated', P.cards().length === 16 && anims.length === 0);
  const css = rd('epinoia', 'kit', 'home.css');
  ok('reduced motion in the stylesheet: the live dot does not pulse, the LIVE tab does not slide',
     /@media \(prefers-reduced-motion:reduce\)\{\s*\.hm \.sec-h \.hm-seg \.fx-dot\{animation:none\}\s*\.hm \.sec-h \.hm-seg button\.is-new\{animation:none\}/.test(css));
  const home = rd('epinoia', 'home', 'index.html');
  ok('HOME\'s switch is a tablist: LIVE (hidden until something is live), UPCOMING, RESULTS, each a tab controlling the panel, and a polite announcer',
     /<div class="hm-seg" id="fxSeg" role="tablist"/.test(home) && /data-fx="live"[^>]*hidden>/.test(home)
     && (home.match(/role="tab" /g) || []).length === 3 && /id="homeDaily" role="tabpanel"/.test(home) && /id="fxSay" aria-live="polite"/.test(home));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
