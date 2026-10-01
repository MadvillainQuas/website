/* ============================================================================
   WHAT WINS 2 — THE LOADER (epinoia/winfile.js, docs/what-wins-model.md §10.2, A.2; §16 WP1).

   In a vm sandbox with a mocked transport, a stand-in EpinoiaAccess and recording storages:
     * the headers: apikey always, the session's own bearer only when signed in, nothing at all on the signed URL;
     * every reason: signin, jwt, members, league, scope, none, rate (with retryAfter), network, layout;
     * a signed URL that ran out (400/403) is asked for once more, and only once;
     * ten minutes' reuse without a request, then a request that downloads only if the token moved;
     * the cache keyed by the user, cleared when another account signs in; never a localStorage write; the legacy
       epinoia_winning_v1 removed on load;
     * the teaser from the public snapshot; RECALCULATE surfacing pending, built, ci_at, refreshed and queued; the
       progress stages.

     node supabase/tests/ww-winfile.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = readFileSync(path.join(ROOT, 'epinoia', 'winfile.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 500))); } };

const URL_ = 'https://proj.supabase.co', ANON = 'sb_publishable_test';
const L = '0a000000-0000-4000-8000-000000000001', S = '0b000000-0000-4000-8000-000000000002';

function storage(log, name) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: i => Array.from(m.keys())[i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { log.push([name, 'set', k]); m.set(k, String(v)); },
    removeItem: k => { log.push([name, 'remove', k]); m.delete(k); },
    _m: m
  };
}
const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});

function sandbox(o = {}) {
  const log = [], reqs = [], listeners = [];
  const state = { session: o.session === undefined ? null : o.session, clock: Date.parse('2026-10-01T12:00:00Z') };
  const ls = storage(log, 'local'), ss = storage(log, 'session');
  if (o.legacy) ls._m.set('epinoia_winning_v1', '{"huge":true}');
  if (o.ss) Object.entries(o.ss).forEach(([k, v]) => ss._m.set(k, v));
  class FakeDate extends Date { static now() { return state.clock; } }
  const ctx = {
    EPINOIA_CONFIG: { supabaseUrl: URL_, supabaseAnonKey: ANON },
    EpinoiaAccess: { session: () => state.session, onChange: fn => { listeners.push(fn); return () => {}; } },
    localStorage: ls, sessionStorage: ss, Date: FakeDate, console, JSON, Promise, setTimeout
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const W = ctx.EpinoiaWinFile;
  const route = o.route || (() => res(500, {}));
  W._setTransport(async (url, init) => { const r = { url, init: init || {} }; reqs.push(r); return route(r, reqs, state); });
  return { W, log, reqs, state, ls, ss, access: ctx.EpinoiaAccess, fire: () => listeners.forEach(f => f({})) };
}
const FILE = (w = 1) => ({ w, fv: 1, scope: 'wins', token: '12@x', built: '2026-09-30T11:00:00Z', n: { games: 12 } });
const META = (extra = {}) => Object.assign({ url: 'https://proj.supabase.co/storage/v1/object/sign/analytics/wins/a.json?token=T1', token: '12@2026-09-30T10:00:00Z',
  bytes: 4321, built_at: '2026-09-30T11:00:00Z', layout: 1, expires_in: 120, pending: 2, ci_at: '2026-09-28T03:40:00Z' }, extra);
const standard = (meta = META(), file = FILE()) => (r) => (r.init.method === 'POST' ? res(200, meta) : res(200, file));

/* ------------------------------------------------------------- headers --- */
console.log('\nthe requests');
{
  const b = sandbox({ route: standard() });
  const out = await b.W.get({ scope: 'wins', league: L, season: S });
  const [p, g] = b.reqs;
  ok('a members\' file: POST to the analytics-file function', p.url === URL_ + '/functions/v1/analytics-file' && p.init.method === 'POST');
  ok('...with the publishable key as apikey and no Authorization when signed out', p.init.headers.apikey === ANON && !('Authorization' in p.init.headers));
  ok('...the body names the scope and ids, nothing else', p.init.body === JSON.stringify({ scope: 'wins', league: L, season: S }));
  ok('then GET the signed URL with no headers of ours', g.url === META().url && g.init.method === 'GET' && !g.init.headers);
  ok('the answer: ok, the data, its token, built, pending and ci_at', out.ok && out.data.w === 1 && out.token === '12@2026-09-30T10:00:00Z' &&
     out.built === '2026-09-30T11:00:00Z' && out.pending === 2 && out.ci_at === '2026-09-28T03:40:00Z' && out.cached === false, out);
}
{
  const b = sandbox({ session: { token: 'eyJ.a.b', userId: 'u-1' }, route: standard() });
  await b.W.get({ scope: 'fo', league: L });
  ok('signed in: Authorization is the session\'s own bearer (not authHeaders())', b.reqs[0].init.headers.Authorization === 'Bearer eyJ.a.b' && b.reqs[0].init.headers.apikey === ANON);
}

/* ------------------------------------------------------------- reasons --- */
console.log('\nthe reasons');
const cases = [
  ['signin', 401, { reason: 'signin' }], ['jwt', 401, { reason: 'jwt' }], ['members', 403, { reason: 'members' }],
  ['league', 403, { reason: 'league' }], ['scope', 403, { reason: 'scope' }], ['none', 404, { reason: 'none' }], ['network', 500, { error: 'x' }]
];
for (const [want, status, body] of cases) {
  const b = sandbox({ route: () => res(status, body) });
  const out = await b.W.get({ scope: 'wins', league: L });
  ok(`HTTP ${status} ${JSON.stringify(body)} -> '${want}'`, out.ok === false && out.reason === want && b.reqs.length === 1, out);
}
{
  const b = sandbox({ route: () => res(429, { reason: 'rate', retry_after: 1200 }, { 'Retry-After': '1200' }) });
  const out = await b.W.get({ scope: 'wins', league: L });
  ok('429 -> \'rate\' with retryAfter in seconds', out.reason === 'rate' && out.retryAfter === 1200, out);
  const b2 = sandbox({ route: () => { throw new Error('offline'); } });
  ok('a request that never answers -> \'network\'', (await b2.W.get({ scope: 'wins', league: L })).reason === 'network');
  const b3 = sandbox({ route: standard(META(), FILE(2)) });
  ok('a file of another layout (w 2) -> \'layout\'', (await b3.W.get({ scope: 'wins', league: L })).reason === 'layout');
  const b4 = sandbox({ route: standard() });
  ok('an unknown scope is refused without a request', (await b4.W.get({ scope: 'store', league: L })).reason === 'scope' && b4.reqs.length === 0);
}

/* ----------------------------------------------------- the expired URL --- */
console.log('\nan expired signed URL');
{
  let gets = 0;
  const b = sandbox({ route: (r) => {
    if (r.init.method === 'POST') return res(200, META({ url: 'https://s/sign?n=' + r.url.length + Math.random() }));
    gets++; return gets === 1 ? res(400, { error: 'InvalidJWT' }) : res(200, FILE());
  } });
  const out = await b.W.get({ scope: 'wins', league: L });
  ok('a 400 from storage: the function is asked once more and the new URL works', out.ok && b.reqs.filter(r => r.init.method === 'POST').length === 2 && gets === 2);
  let g2 = 0;
  const b2 = sandbox({ route: (r) => (r.init.method === 'POST' ? res(200, META()) : (g2++, res(403, {}))) });
  const o2 = await b2.W.get({ scope: 'wins', league: L });
  ok('...and only once: a second refusal is \'network\', not a loop', !o2.ok && o2.reason === 'network' && g2 === 2 && b2.reqs.length === 4, b2.reqs.length);
}

/* --------------------------------------------------------------- reuse --- */
console.log('\nten minutes\' reuse');
{
  let token = '12@2026-09-30T10:00:00Z';
  const b = sandbox({ route: (r) => (r.init.method === 'POST' ? res(200, META({ token })) : res(200, FILE())) });
  await b.W.get({ scope: 'wins', league: L, season: S });
  const n0 = b.reqs.length;
  b.state.clock += 9 * 60 * 1000;
  const again = await b.W.get({ scope: 'wins', league: L, season: S });
  ok('within ten minutes: answered from the cache, no request', again.ok && again.cached === true && b.reqs.length === n0);
  b.state.clock += 2 * 60 * 1000;
  const later = await b.W.get({ scope: 'wins', league: L, season: S });
  ok('after ten minutes: the function is asked, the token has not moved, nothing is downloaded', later.ok && later.cached === true &&
     b.reqs.length === n0 + 1 && b.reqs[n0].init.method === 'POST');
  token = '13@2026-10-01T12:00:00Z';
  b.state.clock += 11 * 60 * 1000;
  const moved = await b.W.get({ scope: 'wins', league: L, season: S });
  ok('...and when it has moved, the new file is downloaded', moved.ok && moved.cached === false && moved.token === token && b.reqs[b.reqs.length - 1].init.method === 'GET');
  const [x, y] = await Promise.all([b.W.get({ scope: 'fo', league: L }), b.W.get({ scope: 'fo', league: L })]);
  ok('two asks at once for one file: one request pair', x.ok && y.ok && b.reqs.filter(r => r.init.method === 'POST').length === 4);
}

/* --------------------------------------------------------- the storage --- */
console.log('\nwhere it is kept');
{
  const b = sandbox({ legacy: true, session: { token: 'eyJ.a.b', userId: 'u-1' }, route: standard() });
  ok('the old page\'s localStorage copy (epinoia_winning_v1) is removed on load', !b.ls._m.has('epinoia_winning_v1') &&
     b.log.some(e => e[0] === 'local' && e[1] === 'remove' && e[2] === 'epinoia_winning_v1'));
  await b.W.get({ scope: 'wins', league: L, season: S });
  await b.W.get({ scope: 'club', league: L, season: S, team: S });
  const keys = Array.from(b.ss._m.keys());
  ok('sessionStorage holds it under the user\'s key', keys.includes('epinoia_ww:u-1:wins:' + L + ':' + S + ':-') && keys.includes('epinoia_ww:u-1:club:' + L + ':' + S + ':' + S), keys);
  ok('...the stored entry has the token, the time and the data', (() => { const j = JSON.parse(b.ss._m.get(keys[0])); return j.token && j.at && j.data && j.data.w === 1; })());
  ok('nothing is ever written to localStorage', !b.log.some(e => e[0] === 'local' && e[1] === 'set'));
  b.state.session = { token: 'eyJ.c.d', userId: 'u-2' };
  b.fire();
  ok('another account signs in: every epinoia_ww: key is cleared', !Array.from(b.ss._m.keys()).some(k => k.startsWith('epinoia_ww:')));
  const n = b.reqs.length;
  const o = await b.W.get({ scope: 'wins', league: L, season: S });
  ok('...and the next file is asked for afresh, as the new account', o.ok && b.reqs.length === n + 2 && b.reqs[n].init.headers.Authorization === 'Bearer eyJ.c.d');
  b.state.session = null;
  const n2 = b.reqs.length;
  await b.W.get({ scope: 'wins', league: L, season: S });
  ok('signing out without the event firing is caught on the next ask (anon key, no reuse of u-2\'s file)', b.reqs.length === n2 + 2 &&
     !('Authorization' in b.reqs[n2].init.headers) && Array.from(b.ss._m.keys()).every(k => k.startsWith('epinoia_ww:anon:')));
  b.W.clear();
  ok('clear() empties memory and sessionStorage', b.ss._m.size === 0 && b.W.cached({ scope: 'wins', league: L, season: S }) === null);
}
{
  const big = Object.assign(FILE(), { pad: 'x'.repeat(2.1 * 1024 * 1024) });
  const b = sandbox({ route: standard(META(), big) });
  const o = await b.W.get({ scope: 'wins', league: L });
  ok('a file over 2 MB is kept in memory only', o.ok && b.ss._m.size === 0 && b.W.cached({ scope: 'wins', league: L }) !== null);
}

/* -------------------------------------------- sign-out mid-download, expiry, the HTTP cache --- */
console.log('\nsign-out during a download, an expired token, the browser cache');
{
  /* the account signs out while the file is on its way: clear() runs, and the late answer is never written back */
  let release;
  const gate = new Promise(r => { release = r; });
  const b = sandbox({ session: { token: 'eyJ.a.b', userId: 'userA' }, route: async (r) => (r.init.method === 'POST' ? res(200, META()) : (await gate, res(200, FILE()))) });
  const pend = b.W.get({ scope: 'wins', league: L });
  await new Promise(r => setTimeout(r, 5));
  b.state.session = null; b.fire();
  const right = Array.from(b.ss._m.keys()).filter(k => k.startsWith('epinoia_ww:'));
  release();
  const late = await pend;
  const after = Array.from(b.ss._m.keys()).filter(k => k.startsWith('epinoia_ww:'));
  ok('signing out mid-download: the file that lands afterwards is dropped, nothing written back (I7)', right.length === 0 && after.length === 0 && late.ok === false &&
     b.W.cached({ scope: 'wins', league: L }) === null, { right, after, late: late.reason });
}
{
  let readies = 0;
  const b = sandbox({ session: { token: 'eyJ.old', userId: 'u-9' }, route: standard() });
  await b.W.get({ scope: 'wins', league: L });
  const keys0 = Array.from(b.ss._m.keys());
  b.state.session = null;                                          // expired: session() is null until refreshed
  b.access.sessionReady = async () => { readies++; b.state.session = { token: 'eyJ.new', userId: 'u-9' }; return b.state.session; };
  b.state.clock += 11 * 60 * 1000;
  const n = b.reqs.length;
  const o = await b.W.refresh({ league: L });
  ok('an expired token is refreshed (sessionReady) before RECALCULATE: sent as the member, the cache kept', readies >= 1 && o.ok &&
     b.reqs[n].init.headers.Authorization === 'Bearer eyJ.new' && keys0.every(k => b.ss._m.has(k)), { readies, auth: b.reqs[n] && b.reqs[n].init.headers.Authorization });
}
{
  const b = sandbox({ route: standard() });
  await b.W.get({ scope: 'wins', league: L });
  const g = b.reqs.find(r => r.init.method === 'GET');
  ok('a members\' file is fetched with cache: \'no-store\' (never kept in the browser\'s HTTP cache)', g && g.init.cache === 'no-store', g && g.init);
}

/* --------------------------------------------------------------- teaser --- */
console.log('\nthe teaser');
{
  const b = sandbox({ route: (r) => (/index\.json$/.test(r.url) ? res(200, { file: 'whatwins/v1-40-abc.json', token: '40@abc', built: 'b' })
    : res(200, { w: 1, scope: 'teaser', token: '40@abc', n: 400 })) });
  const o = await b.W.get({ scope: 'teaser' });
  ok('the public index, then the file it names, both GETs on the public snapshots path', o.ok && o.data.scope === 'teaser' &&
     b.reqs[0].url === URL_ + '/storage/v1/object/public/snapshots/whatwins/index.json' && b.reqs[1].url === URL_ + '/storage/v1/object/public/snapshots/whatwins/v1-40-abc.json' &&
     b.reqs.every(r => r.init.method === 'GET' && !r.init.headers));
  const b2 = sandbox({ route: () => res(404, {}) });
  ok('...no teaser yet is \'none\'', (await b2.W.get({ scope: 'teaser' })).reason === 'none');
}

/* ----------------------------------------------------------- RECALCULATE --- */
console.log('\nRECALCULATE');
{
  const stages = [];
  const b = sandbox({ session: { token: 'eyJ.a.b', userId: 'u-1' }, route: (r) => (r.init.method === 'POST'
    ? res(200, META(JSON.parse(r.init.body).refresh ? { token: '15@2026-10-01T02:00:00Z', pending: 0, refreshed: true, queued: false } : {}))
    : res(200, FILE())) });
  await b.W.get({ scope: 'wins', league: L, season: S });
  const out = await b.W.refresh({ league: L, season: S }, { onProgress: s => stages.push(s.stage) });
  const p = b.reqs.filter(r => r.init.method === 'POST').pop();
  ok('refresh() POSTs {scope: wins, league, season, refresh: true} with the bearer', JSON.parse(p.init.body).refresh === true && JSON.parse(p.init.body).scope === 'wins' &&
     p.init.headers.Authorization === 'Bearer eyJ.a.b');
  ok('...and answers with the new file, pending 0, refreshed', out.ok && out.token === '15@2026-10-01T02:00:00Z' && out.pending === 0 && out.refreshed === true && out.queued === false &&
     out.built === '2026-09-30T11:00:00Z' && out.ci_at === '2026-09-28T03:40:00Z', out);
  ok('...reporting its stages: check, update, download, done', ['check', 'update', 'download', 'done'].every(s => stages.includes(s)), stages);
  const next = await b.W.get({ scope: 'wins', league: L, season: S });
  ok('...and the cache now holds the refreshed file', next.cached === true && next.token === '15@2026-10-01T02:00:00Z');
  const b2 = sandbox({ session: { token: 'eyJ.a.b', userId: 'u-1' }, route: (r) => (r.init.method === 'POST' ? res(200, META({ queued: true, refresh_reason: 'cap' })) : res(200, FILE())) });
  const q = await b2.W.refresh({ league: L, season: S, scope: 'fo' });
  ok('a refresh left for the scheduled build says queued, with the current file', q.ok && q.queued === true && q.refreshReason === 'cap');
  const b3 = sandbox({ route: () => res(401, { reason: 'signin' }) });
  ok('signed out, RECALCULATE is \'signin\'', (await b3.W.refresh({ league: L })).reason === 'signin');
  ok('...and without a league it is not asked at all', (await b3.W.refresh({})).reason === 'scope');
}

console.log('\nleft over from another account, and one key a unit (SEC2-3, PERF2-1)');
{
  /* user A signed out on a page without this loader (the sign-in page, the app shell): his members-only file is still in
     the tab's sessionStorage when the next page loads, signed out or as user B */
  const entry = JSON.stringify({ token: '12@x', data: FILE(), at: Date.parse('2026-10-01T11:59:00Z') });
  const keyA = 'epinoia_ww:user-A:wins:' + L + ':current:-';
  const b = sandbox({ ss: { [keyA]: entry, 'other_key': 'kept' }, route: () => res(403, { reason: 'members' }) });
  const out = await b.W.get({ scope: 'wins', league: L });
  ok('a signed-out page load removes another account\'s epinoia_ww: keys on its first request (the answer was members)', out.reason === 'members' &&
     !b.ss._m.has(keyA) && b.ss._m.get('other_key') === 'kept', Array.from(b.ss._m.keys()));
  const keyB = 'epinoia_ww:user-B:fo:' + L + ':current:-';
  const b2 = sandbox({ session: { token: 'eyJ.b.b', userId: 'user-B' }, ss: { [keyA]: entry, [keyB]: entry }, route: standard() });
  await b2.W.get({ scope: 'wins', league: L, season: S });
  ok('...signed in as B: A\'s keys go, B\'s own stay (swept after sessionReady, so an expired member keeps his)', !b2.ss._m.has(keyA) && b2.ss._m.has(keyB), Array.from(b2.ss._m.keys()));
  const cfgSrc = readFileSync(path.join(ROOT, 'epinoia', 'config.js'), 'utf8');
  const so = cfgSrc.slice(cfgSrc.indexOf('window.epinoiaSignOut'), cfgSrc.indexOf('window.epinoiaSignOut') + 2500);
  ok('...and epinoiaSignOut (config.js), on any page, removes every epinoia_ww: key from sessionStorage', /sessionStorage\.removeItem/.test(so) && /'epinoia_ww:'/.test(so));
}
{
  /* the page reads the current season (no season: ...:current:) and RECALCULATE names the season by its id */
  const posts = [];
  let next = { token: '12@2026-09-30T10:00:00Z', refresh_reason: 'recent', refreshed: false };
  const file = tok => Object.assign(FILE(), { token: tok, season: { id: S, name: '2026' } });
  const b = sandbox({ session: { token: 'eyJ.a.b', userId: 'u-1' }, route: (r) => {
    if (r.init.method === 'POST') { const body = JSON.parse(r.init.body); posts.push(body); return res(200, META(body.refresh ? next : {})); }
    return res(200, file(r.url.includes('T2') ? '15@x' : '12@x'));
  } });
  await b.W.get({ scope: 'wins', league: L });
  const gets0 = b.reqs.filter(r => r.init.method === 'GET').length;
  const noop = await b.W.refresh({ league: L, season: S });
  ok('a RECALCULATE answered \'recent\' with the token the page holds downloads nothing (the current-season entry is found)', noop.ok && noop.cached === true &&
     b.reqs.filter(r => r.init.method === 'GET').length === gets0, b.reqs.map(r => r.init.method).join());
  next = { token: '15@2026-10-01T02:00:00Z', refreshed: true, url: 'https://proj.supabase.co/storage/v1/object/sign/analytics/wins/b.json?token=T2' };
  const done = await b.W.refresh({ league: L, season: S });
  const winsKeys = Array.from(b.ss._m.keys()).filter(k => k.includes(':wins:'));
  ok('...a real one overwrites that entry: one copy of the unit in sessionStorage, not two', done.ok && done.token === '15@2026-10-01T02:00:00Z' && winsKeys.length === 1 &&
     winsKeys[0].endsWith(':current:-'), winsKeys);
  const again = await b.W.get({ scope: 'wins', league: L });
  ok('...so the page\'s next load (within the ten minutes) shows the new model, from the cache', again.cached === true && again.token === '15@2026-10-01T02:00:00Z', again.token);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
