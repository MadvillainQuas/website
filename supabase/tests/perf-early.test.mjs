/* ============================================================================
   PAGES THAT ASK FOR THEIR DATA SOONER, AND NEVER WAIT TWICE FOR THE SAME FILE (2026-10-15).

   Measured on the live site: the box score asked four questions one after another (its game, the game's optional
   columns, its video, then the finished game's log file) and the league table five (the league, its seasons, their
   competitions, a games probe, the standings - and only then the ELO games); on a first visit, or the first after a
   deploy, a box score page also downloaded ~60 scripts before it asked for anything, and after any ten-minute break
   every page asked again for each of its stamped files. What this file holds:

     1. early.js asks for a finished game's log from the page's head, by the game's id, and game.js takes the answer
     2. game.js asks every question that needs only the game's id at once
     3. seasonbar.js reads a league's seasons, competitions and probes in ONE request (and falls back to three),
        context() and league.js read the league with them, and the answer is exactly the old one
     4. league.js asks for the ELO games beside the standings, not after them
     5. sw.js answers the site's stamped scripts and stylesheets from a cache of its own, re-checks them in the
        background every ten minutes, keeps the previous deploy's, and touches nothing else

     node supabase/tests/perf-early.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : '')); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const tick = () => new Promise(r => setTimeout(r, 0));

/* =================================================================== 1. early.js === */
console.log('\n1. early.js: a finished game\'s log, asked for from the head');
{
  const src = rd('epinoia', 'game', 'early.js');
  const cfgUrl = (/supabaseUrl:\s*'([^']+)'/.exec(rd('epinoia', 'config.js')) || [])[1];
  const own = (/var SUPABASE_URL = '([^']+)'/.exec(src) || [])[1];
  ok('the project address it writes is config.js\'s', !!own && own === cfgUrl, { own, cfgUrl });
  const run = search => {
    const asked = [];
    const win = {};
    const ctx = vm.createContext({ window: win, location: { search }, URLSearchParams,
      fetch: url => { asked.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ game: 'x' }) }); } });
    vm.runInContext(src, ctx);
    return { win, asked };
  };
  const g = '6f9b5fb7-731c-4beb-accc-36303283de36';
  const a = run('?g=' + g + '&tab=box');
  ok('a game id in the address: its log file is asked for at once',
     a.asked.length === 1 && a.asked[0] === cfgUrl + '/storage/v1/object/public/snapshots/events/' + g + '.json', a.asked);
  ok('...and left for game.js under that game\'s id', a.win.EPINOIA_EARLY_LOG && a.win.EPINOIA_EARLY_LOG.game === g
     && typeof a.win.EPINOIA_EARLY_LOG.p.then === 'function');
  for (const s of ['', '?g=', '?g=abc', '?g=../../x', '?mgr=1'])
    ok(`nothing asked for "${s}"`, run(s).asked.length === 0 && !run(s).win.EPINOIA_EARLY_LOG);
  const html = rd('epinoia', 'game', 'index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  const first = head.indexOf('<script');
  ok('the box score page loads it async, before every other script, from its own folder',
     first > 0 && /^<script src="early\.js\?v=\d+" async><\/script>/.test(head.slice(first)), head.slice(first, first + 60));
  ok('...after opening the connection to the data (preconnect, crossorigin)',
     head.indexOf('<link rel="preconnect" href="' + cfgUrl + '" crossorigin>') > 0
     && head.indexOf('<link rel="preconnect"') < first);
  for (const p of ['l', 'home', 'fixtures', 'stats', 't', 'p'])
    ok(`${p}/ opens the connection early too`, rd('epinoia', p, 'index.html').includes('<link rel="preconnect" href="' + cfgUrl + '" crossorigin>'));
}

/* ================================================================== 2. game.js === */
console.log('\n2. game.js: every question that needs only the game\'s id, at once');
{
  const g = rd('epinoia', 'game', 'game.js');
  const body = g.slice(g.indexOf('async function loadStored()'), g.indexOf('/* THE LEAGUE\'S CHANNEL, WHEN NOBODY HAS PASTED A LINK.'));
  const firstAwait = body.indexOf('await ');
  ok('the game, its optional columns, its video and the log file are all asked for before the first await',
     ['const gsP = api(', 'const extraP = api(', 'const videoP = api(', 'fileRows();'].every(s => { const i = body.indexOf(s); return i > 0 && i < firstAwait; }),
     body.slice(0, 400));
  ok('...and each still fails on its own (a refused column or video is no game lost)',
     /const extraP = api\([^;]*\)\.catch\(\(\) => \[\]\)/.test(body.replace(/\n\s*/g, ' ')) && /\.catch\(\(\) => \[\]\);\s*\/\/ no table, or none attached/.test(body));
  ok('fileRows() takes the head\'s answer only when it is this game\'s', /early && early\.game === gameId && early\.p/.test(g));
  ok('...asks once per page (the promise is kept)', /if \(fileRowsP\) return fileRowsP;/.test(g));
  ok('...and is used only for a final: fetchLog(final) -> fileLog() -> fileRows()',
     /async function fetchLog\(final\) \{\s*if \(final\) \{\s*const rows = await fileLog\(\);/.test(g) && /async function fileLog\(\) \{\s*const rows = await fileRows\(\);/.test(g));
}

/* ============================================================= 3. seasonbar.js === */
console.log('\n3. seasonbar.js: a league\'s seasons, competitions and probes in one request');
{
  const SB = require(path.join(ROOT, 'epinoia', 'seasonbar.js'));
  const S1 = { id: 's1', name: '2026-27', starts_on: '2026-09-01', ends_on: '2027-06-30' };
  const S0 = { id: 's0', name: '2025-26', starts_on: '2025-09-01', ends_on: '2026-06-30' };
  const S9 = { id: 's9', name: '2024-25', starts_on: '2024-09-01', ends_on: '2025-06-30' };
  const C = { c1: { id: 'c1', season_id: 's1', name: 'League', kind: 'league' }, c2: { id: 'c2', season_id: 's1', name: 'Cup', kind: 'cup' },
              c0: { id: 'c0', season_id: 's0', name: 'League', kind: 'league' }, c9: { id: 'c9', season_id: 's9', name: 'League', kind: 'league' } };
  const games = { c1: true, c2: false, c0: true, c9: false };
  const embedRows = [S1, S0, S9].map(s => Object.assign({}, s, {
    competitions: Object.values(C).filter(c => c.season_id === s.id).sort((a, b) => a.name.localeCompare(b.name))
      .map(c => Object.assign({}, c, { games: games[c.id] ? [{ id: 'g-' + c.id }] : [] })) }));
  const oldApi = calls => async q => {
    calls.push(q);
    if (q.startsWith('seasons?') && q.includes('competitions(')) throw new Error('400 embed refused');
    if (q.startsWith('seasons?')) return [S1, S0, S9];
    if (q.startsWith('competitions?')) return Object.values(C).sort((a, b) => a.name.localeCompare(b.name));
    if (q.startsWith('games?')) { const ids = /in\.\(([^)]*)\)/.exec(q)[1].split(','); return ids.some(i => games[i]) ? [{ id: 'g' }] : []; }
    throw new Error('unexpected ' + q);
  };
  const newApi = calls => async q => { calls.push(q); if (q.startsWith('seasons?') && q.includes('competitions(*,games(id))')) return embedRows; throw new Error('unexpected ' + q); };
  const c1 = [], c2 = [];
  const viaEmbed = await SB.load(newApi(c1), 'L1');
  const viaOld = await SB.load(oldApi(c2), 'L2');
  eq('one request when the embed is answered', c1.length, 1);
  ok('...asking for every competition\'s first game only (games.limit=1), newest season first',
     /competitions\.games\.limit=1/.test(c1[0]) && /order=starts_on\.desc/.test(c1[0]), c1[0]);
  ok('the embed refused: the three requests, as before', c2.length === 1 + 1 + 1 + 3 && c2[0].includes('competitions(') && c2[1].startsWith('seasons?'), c2);
  const shape = o => ({ all: o.all.map(s => [s.id, s.comps.map(c => c.id)]), list: o.list.map(s => s.id), current: o.current && o.current.id });
  eq('...and the answer is exactly the old one (seasons, competitions, which were played)', shape(viaEmbed), shape(viaOld));
  ok('a competition handed out carries no probe answer', viaEmbed.all.every(s => s.comps.every(c => !('games' in c)) && !('competitions' in s)));
  eq('a season none of whose competitions has a game is not offered', viaEmbed.list.map(s => s.id), ['s1', 's0']);
  const c3 = [];
  SB.prime('L3', embedRows.slice().reverse());
  const primed = await SB.load(newApi(c3), 'L3');
  ok('a league read with its seasons (prime): load() answers without a request', c3.length === 0 && shape(primed).list.join() === 's1,s0', c3);
  const c4 = [];
  const ctxApi = async q => {
    c4.push(q);
    if (q.startsWith('leagues?')) return [{ id: 'L4', slug: 'x', name: 'X', seasons: embedRows }];
    throw new Error('unexpected ' + q);
  };
  const cx = await SB.context(ctxApi, 'x', null);
  ok('context(): the league with everything, in one request', c4.length === 1 && c4[0].includes('seasons(id,name,starts_on,ends_on,competitions(*,games(id)))'), c4);
  ok('...the league handed back as its own row (no seasons on it)', !('seasons' in cx.league) && cx.season.id === 's1' && cx.comps.length === 2);
  const lg = rd('epinoia', 'l', 'league.js');
  ok('league.js reads its league with the seasons embedded, primes the season bar, and keeps a fallback',
     /SB0\.leagueSelect\(\)/.test(lg) && /SB0\.prime\(league\.id, league\.seasons\)/.test(lg) && /delete league\.seasons;/.test(lg)
     && /catch \(_\) \{\s*ls = await api\(`leagues\?slug=eq\.\$\{encodeURIComponent\(wantLeague\)\}&select=\*&limit=1`\);/.test(lg));

  /* ============================================================== 4. league.js === */
  console.log('\n4. league.js: the ELO games beside the standings');
  const st = lg.slice(lg.indexOf('async function renderStandingsInto('));
  const iElo = st.indexOf('const eloP = loadElo();'), iRows = st.indexOf('const rows = await api(');
  ok('loadElo() starts before the standings are awaited, and is awaited after', iElo > 0 && iElo < iRows && st.indexOf('ELO_NOW = await eloP;') > iRows);
}

/* ==================================================================== 5. sw.js === */
console.log('\n5. sw.js: the site\'s stamped files from a cache of its own');
{
  const swSrc = rd('epinoia', 'sw.js');
  const ORIGIN = 'https://site.test';
  function loadSW(netBody) {
    const clock = { t: 1_800_000_000_000 };
    class FakeDate extends Date { static now() { return clock.t; } }
    const store = new Map();
    const caches = {
      open: async n => {
        if (!store.has(n)) store.set(n, new Map());
        const m = store.get(n);
        return { match: async req => { const r = m.get(req.url); return r ? r.clone() : undefined; },
                 put: async (req, res) => { m.set(req.url, res); } };
      },
      keys: async () => [...store.keys()],
      delete: async n => store.delete(n)
    };
    const net = [];
    let down = false;
    const fetch = async (req, init) => {
      net.push({ url: req.url || req, cache: init && init.cache });
      if (down) throw new TypeError('Failed to fetch');
      const body = netBody(req.url || req, net.length);
      const r = new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } });
      return r;
    };
    const self = { addEventListener: (t, fn) => { self['on' + t] = fn; }, skipWaiting: () => {}, location: { origin: ORIGIN },
      registration: { showNotification: async () => {}, getNotifications: async () => [], pushManager: { subscribe: async () => null } },
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => ({}) } };
    const module = { exports: {} };
    const ctx = vm.createContext({ self, module, URL, atob, console, setTimeout, Date: FakeDate, caches, fetch, Response, Headers, Blob });
    vm.runInContext(swSrc, ctx, { filename: 'sw.js' });
    const fire = async (url, mode) => {
      const waits = [];
      let answer = null, answered = false;
      self.onfetch({ request: { url, method: 'GET', mode: mode || 'no-cors' },
        respondWith: p => { answered = true; answer = p; }, waitUntil: p => waits.push(p) });
      let res = null, err = null;
      if (answered) { try { res = await answer; } catch (e) { err = e; } }
      await Promise.all(waits);
      await tick();
      return { answered, res, err, text: res ? await res.clone().text() : null };
    };
    return { fire, net, store, clock, setDown: v => { down = v; } };
  }
  const A = ORIGIN + '/epinoia/game/game.js?v=821';
  {
    const W = loadSW((url, n) => 'body ' + n);
    const r1 = await W.fire(A);
    ok('a stamped script: answered by the worker, from the network the first time', r1.answered && r1.text === 'body 1' && W.net.length === 1);
    ok('...and kept, in the cache of its stamp', W.store.has('epinoia-assets-v821') && W.store.get('epinoia-assets-v821').has(A));
    const r2 = await W.fire(A);
    ok('asked again within ten minutes: the kept copy, no request at all', r2.text === 'body 1' && W.net.length === 1, W.net);
    W.clock.t += 11 * 60 * 1000;
    const r3 = await W.fire(A);
    ok('asked again after ten minutes: the kept copy at once...', r3.text === 'body 1');
    ok('...and the file asked for again behind it, as a conditional request', W.net.length === 2 && W.net[1].cache === 'no-cache', W.net);
    const r4 = await W.fire(A);
    ok('...whose answer is what the next page gets (a file changed without a new stamp still arrives)', r4.text === 'body 2' && W.net.length === 2);
    W.setDown(true);
    W.clock.t += 11 * 60 * 1000;
    const r5 = await W.fire(A);
    ok('offline, with a copy kept: the page still has its script', r5.text === 'body 2' && !r5.err);
    const r6 = await W.fire(ORIGIN + '/epinoia/never-seen.js?v=821');
    ok('offline, with no copy: a real network error, as without a worker', r6.answered && !!r6.err && !r6.res);
  }
  {
    const W = loadSW(() => 'x');
    for (const [u, why] of [
      [ORIGIN + '/epinoia/game/game.js', 'not stamped'],
      [ORIGIN + '/epinoia/game/game.js?v=821&x=1', 'more than its stamp in the address'],
      [ORIGIN + '/epinoia/game/game.js?v=abc', 'a stamp that is not a version'],
      [ORIGIN + '/epinoia/sw.js?v=821', 'the worker itself'],
      [ORIGIN + '/epinoia/livestats-clients.json?v=821', 'data, not code'],
      [ORIGIN + '/epinoia/brand/flags/gb.svg', 'an image'],
      [ORIGIN + '/other/app.js?v=821', 'outside /epinoia/'],
      ['https://hhvofgqqadtyvcjudhjx.supabase.co/rest/v1/games?id=eq.1', 'the data'],
      ['https://hhvofgqqadtyvcjudhjx.supabase.co/storage/v1/object/public/snapshots/events/x.json', 'a data file'],
      ['https://cdn.example/lib.js?v=821', 'another site\'s script']]) {
      const r = await W.fire(u);
      ok('left to the network: ' + why, !r.answered);
    }
    const nav = await W.fire(ORIGIN + '/epinoia/game/?g=1', 'navigate');
    ok('a page load is still answered by the network (never cached)', nav.answered && nav.text === 'x' && !W.store.size);
    W.setDown(true);
    const off = await W.fire(ORIGIN + '/epinoia/game/?g=1', 'navigate');
    ok('...and offline it is still the small offline page', off.answered && off.res.status === 200 && /Epinoia is offline/.test(off.text));
  }
  {
    const W = loadSW(() => 'y');
    for (const v of ['819', '820', '821']) await W.fire(ORIGIN + '/epinoia/nav.js?v=' + v);
    await W.fire(ORIGIN + '/epinoia/nav.js?v=822');
    eq('a new stamp\'s cache keeps the previous deploy\'s and deletes the ones before',
       [...W.store.keys()].sort(), ['epinoia-assets-v821', 'epinoia-assets-v822']);
  }
  ok('the worker\'s version moved, so phones take it', /const SW_VERSION = 'notifications-v2-2026-10-15-[a-z]+';/.test(swSrc));
  ok('no page, no data: the only things it puts in a cache are stamped .js / .css of its own origin',
     /if \(!\/\\\.\(\?:js\|css\)\$\/\.test\(u\.pathname\)\) return '';/.test(swSrc) && /u\.origin !== origin/.test(swSrc));
}

console.log('\n6. nav.js: the leagues panel\'s flags are lazy');
{
  const nav = rd('epinoia', 'nav.js');
  ok('a flag image is fetched when it is shown, not with the page',
     /i\.loading = 'lazy';\s*i\.decoding = 'async';\s*i\.src = root \+ 'brand\/flags\/'/.test(nav));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
