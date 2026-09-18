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
  const B = sandbox.epinoiaLeagueBadge;
  ok('epinoiaLeagueBadge is defined', typeof B === 'function');
  const withLogo = B({ name: 'Super League', logo_path: 'league/1/logo-a.webp', colour_source: 'logo', colour_a: '#f2594c', colour_b: '#000000' });
  ok('a logo from the bucket, on a tile, then the name', /^<span class="lgb"><span class="lgb-tile" data-mono="SL" style="--lgb-a:#f2594c;--lgb-b:#000000"><img src="https:\/\/hhvofgqqadtyvcjudhjx\.supabase\.co\/storage\/v1\/object\/public\/media-public\/league\/1\/logo-a\.webp" alt=""/.test(withLogo)
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
        pickDaily: () => []
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

  const games = rd('epinoia', 'games', 'index.html');
  const head = games.slice(0, games.indexOf('</head>'));
  ok('games/ loads ../appmode.js first in <head>', head.indexOf('<script') > 0 && head.slice(head.indexOf('<script')).startsWith('<script src="../appmode.js?v='));
  ok('games/ links the manifest and a strict CSP', head.includes('/epinoia/manifest.webmanifest') && /script-src 'self'/.test(head));
  ok('games/ links the kit, nav and fxc stylesheets', ['../kit/epinoia-kit.css?v=', '../kit/nav.css?v=', '../kit/fxc.css?v='].every(s => head.includes(s)));
  const order = ['../config.js', '../data.js', '../globalgames.js', 'games.js?v', '../nav.js', '../xscroll.js'].map(s => games.indexOf(s));
  ok('games/ scripts: config, data, globalgames, games, nav, xscroll, in order, all deferred',
     order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])) &&
     (games.match(/<script src="[^"]+" defer><\/script>/g) || []).length === (games.match(/<script /g) || []).length - 1);
  ok('games/ has no inline script or inline handler', !/<script>(?!<)/.test(games) && !/<script(?![^>]*src=)[^>]*>/.test(games) && !/\son[a-z]+="/i.test(games));
  ok('games/ carries the heading, a Show more button and the count', games.includes('Global fixtures') &&
     /<button type="button" class="ep-btn more" id="gmMore" hidden>/.test(games) && games.includes('id="gmCount"'));
  const stamps = new Set((games.match(/\?v=(\d+)/g) || []));
  ok('games/ uses one ?v= stamp throughout', stamps.size === 1, [...stamps].join());
  const gjs = rd('epinoia', 'games', 'games.js');
  ok('games.js pages 30 at a time and reads "of" / "all N shown"', /PAGE = 30/.test(gjs) && gjs.includes("' of '") && gjs.includes("'all '"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
