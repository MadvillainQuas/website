/* ============================================================================
   THE TRANSFER MATRIX'S LOADER (epinoia/transferdata.js, window.EpinoiaTransferData).

   In a vm sandbox per "page", with a mocked transport, a stand-in EpinoiaAccess and an in-memory stand-in for the
   device's IndexedDB copy that outlives a page, on a small real build (the made-up sample, fixtures/transfer/):
     * signed out: rejected 'signin' and NOT ONE request;
     * the requests: POST analytics-file {scope} with the publishable key and the session's own bearer; the signed URL
       with no headers and cache: 'no-store';
     * the answers: the store's bytes (TMS2, as built) and the scale parsed; every refusal as its reason (signin,
       members, scope, none, rate with retryAfter, network, layout, unsupported);
     * one request per scope at a time, then memory for the page's life;
     * a repeat visit with the same token downloads nothing; a new token downloads and replaces the copy;
     * a refusal deletes that account's copy; another account's copies are removed; an account change mid-load keeps
       nothing; a damaged copy is downloaded again; a cache that fails everywhere (a private window) still loads;
     * a signed URL that ran out is asked for once more, and only once;
     * sign-out (config.js) deletes the database.

     node supabase/tests/transfer-data.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sampleCSVs } from './fixtures/transfer/sample.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'epinoia', 'transferdata.js'), 'utf8');
const E = require(path.join(ROOT, 'epinoia', 'scouting', 'transfer', 'engine.js'));
const B = await import('../../tools/build-transfer.mjs');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 500))); } };

/* the files */
const built = B.build(E.ingestCSV(sampleCSVs().files), '2026-10-15');
const BIN = built.transfer.bin, GZ = built.transfer.gz, SGZ = built.tscale.gz;
const TOK = B.tokenOf(GZ), STOK = B.tokenOf(SGZ);
const same = (a, b) => a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

const URL_ = 'https://proj.supabase.co', ANON = 'sb_publishable_test', JWT = 'eyJ.user-1.sig';
const SIGNED = (scope, t) => URL_ + '/storage/v1/object/sign/analytics/' + scope + '/' + t + '.gz?token=SIG';
const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
});
/* the device's copy: survives the page (pass the same one to the next sandbox) */
function memCache(o = {}) {
  const m = new Map(Object.entries(o.seed || {})), log = [];
  const boom = () => { throw new Error('storage blocked'); };
  return {
    m, log,
    get: async k => { log.push(['get', k]); if (o.broken) boom(); return m.has(k) ? m.get(k) : null; },
    put: async (k, v) => { log.push(['put', k]); if (o.broken) boom(); m.set(k, v); },
    del: async k => { log.push(['del', k]); if (o.broken) boom(); m.delete(k); },
    keys: async () => { log.push(['keys']); if (o.broken) boom(); return Array.from(m.keys()); },
    drop: async () => { log.push(['drop']); if (o.broken) boom(); m.clear(); }
  };
}
/* the function and storage: {scope: {status, body, token}} or a route fn */
function standard(o = {}) {
  const tokens = Object.assign({ transfer: TOK, tscale: STOK }, o.tokens || {});
  const files = Object.assign({ transfer: GZ, tscale: SGZ }, o.files || {});
  return (r) => {
    if (r.init.method === 'POST') {
      const scope = JSON.parse(r.init.body).scope;
      return res(200, { url: SIGNED(scope, tokens[scope]), token: tokens[scope], bytes: files[scope].length, built_at: '2026-10-15T09:00:00Z', layout: 1, expires_in: 120, pending: null });
    }
    const scope = /analytics\/(\w+)\//.exec(r.url)[1];
    return res(200, files[scope]);
  };
}
/* the clock every page shares (the device's copy outlives a page; its ten minutes are counted on this) */
const CLOCK = { now: Date.parse('2026-10-15T12:00:00Z') };
const later = ms => { CLOCK.now += ms; };
class FakeDate extends Date { static now() { return CLOCK.now; } }
function page(o = {}) {
  const reqs = [], listeners = [];
  const state = { session: o.session === undefined ? { token: JWT, userId: 'u-1' } : o.session };
  const ctx = {
    Date: FakeDate,
    EPINOIA_CONFIG: { supabaseUrl: URL_, supabaseAnonKey: ANON },
    EpinoiaAccess: { session: () => state.session, sessionReady: async () => state.session, onChange: fn => { listeners.push(fn); return () => {}; } },
    DecompressionStream: o.noDS ? undefined : DecompressionStream, Response, Blob, TextDecoder,
    console, setTimeout, clearTimeout
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const T = ctx.EpinoiaTransferData;
  const route = o.route || standard();
  T._setTransport(async (url, init) => { const r = { url, init: init || {} }; reqs.push(r); return route(r, reqs, state); });
  if (o.cache !== undefined) T._setCache(o.cache);
  return { T, reqs, state, fire: () => listeners.forEach(f => f({})) };
}
const reason = p => p.then(() => 'resolved', e => e && e.reason);
const posts = b => b.reqs.filter(r => r.init.method === 'POST'), gets = b => b.reqs.filter(r => r.init.method === 'GET');

/* ------------------------------------------------------------------ signed out --- */
console.log('signed out');
{
  const c = memCache({ seed: { 'u-1|transfer': { token: TOK, gz: GZ } } });
  const b = page({ session: null, cache: c });
  ok('load(\'transfer\') is refused \'signin\' and NOT ONE request is made', (await reason(b.T.load('transfer'))) === 'signin' && b.reqs.length === 0);
  ok('...nor for the scale', (await reason(b.T.load('tscale'))) === 'signin' && b.reqs.length === 0);
  ok('...and the device\'s copy is not read, nor anything written', !c.log.some(x => x[0] === 'get' || x[0] === 'put'), c.log);
  ok('an unknown scope: \'scope\', no request', (await reason(b.T.load('wins'))) === 'scope' && b.reqs.length === 0);
}

/* ------------------------------------------------------------- the first visit --- */
console.log('\nthe first visit');
const dev = memCache();
{
  const b = page({ cache: dev });
  const stages = [];
  const bytes = await b.T.load('transfer', { onProgress: p => stages.push(p.stage) });
  const [p, g] = b.reqs;
  ok('POST to the analytics-file function, the body {scope} alone', p.url === URL_ + '/functions/v1/analytics-file' && p.init.method === 'POST' && p.init.body === '{"scope":"transfer"}');
  ok('...with the publishable key as apikey and the session\'s own bearer', p.init.headers.apikey === ANON && p.init.headers.Authorization === 'Bearer ' + JWT);
  ok('the signed URL: GET, no headers of ours, cache no-store', g.url === SIGNED('transfer', TOK) && g.init.method === 'GET' && !g.init.headers && g.init.cache === 'no-store');
  ok('resolves with the store\'s bytes exactly as built (TMS2), which the engine decodes', same(bytes, BIN) && E.decodeStore(bytes).allTransfers.length === E.decodeStore(BIN).allTransfers.length);
  ok('the stages: check, download, unzip, done', stages.join() === 'check,download,unzip,done', stages);
  ok('meta: the token, built, bytes, not from the cache', JSON.stringify(b.T.meta('transfer')) === JSON.stringify({ token: TOK, built: '2026-10-15T09:00:00Z', bytes: GZ.length, cached: false, asked: true }), b.T.meta('transfer'));
  await new Promise(r => setTimeout(r, 0));
  const kept = dev.m.get('u-1|transfer');
  ok('the gzipped file is kept on the device under the account and scope, with its token', kept && kept.token === TOK && same(new Uint8Array(kept.gz), GZ) &&
     [...dev.m.keys()].join() === 'u-1|transfer,u-1|transfer#ok', [...dev.m.keys()]);
  const s = await b.T.load('tscale');
  ok('load(\'tscale\') resolves with the scale, parsed', s && s.version === 1 && s.built === '2026-10-15' && Object.keys(s.leagues).length === Object.keys(built.S.leagues).length &&
     JSON.stringify(s.pairs) === JSON.stringify(JSON.parse(built.tscale.text).pairs));
  const n = b.reqs.length;
  const again = await b.T.load('transfer');
  ok('a second load on the same page: the same answer, no request at all', again === bytes && b.reqs.length === n);
}
{
  const b = page({ cache: memCache() });
  const [x, y, z] = await Promise.all([b.T.load('transfer'), b.T.load('transfer'), b.T.load('tscale')]);
  ok('loads at once share one request per scope', posts(b).length === 2 && gets(b).length === 2 && x === y && z.version === 1, b.reqs.map(r => r.init.method + ' ' + r.url));
}

/* ------------------------------------------------------------- a repeat visit --- */
console.log('\na repeat visit');
{
  ok('(the function\'s yes is kept beside the copy: its token and when)', dev.m.get('u-1|transfer#ok') && dev.m.get('u-1|transfer#ok').token === TOK && dev.m.get('u-1|transfer#ok').at === CLOCK.now);
  later(5 * 60 * 1000);
  const b = page({ cache: dev });
  const bytes = await b.T.load('transfer');
  ok('within ten minutes of the function\'s yes: the copy, and NOT ONE request (a reader going page to page is not counted each time)',
     b.reqs.length === 0 && same(bytes, BIN) && b.T.meta('transfer').cached === true && b.T.meta('transfer').asked === false && b.T.REUSE_MS === 600000, b.reqs.length);
}
{
  later(6 * 60 * 1000);
  const b = page({ cache: dev });
  const stages = [];
  const bytes = await b.T.load('transfer', { onProgress: p => stages.push(p.stage + (p.cached ? '(cached)' : '')) });
  ok('past ten minutes, the same token: the function is asked again (the gate) and NOTHING is downloaded', posts(b).length === 1 && gets(b).length === 0, b.reqs.map(r => r.init.method));
  ok('...the copy is the file, exactly', same(bytes, BIN));
  ok('...meta says cached and asked; the stages say so', b.T.meta('transfer').cached === true && b.T.meta('transfer').asked === true && stages.join() === 'check,unzip(cached),done(cached)', stages);
  await new Promise(r => setTimeout(r, 0));
  ok('...and the yes is renewed', dev.m.get('u-1|transfer#ok').at === CLOCK.now);
}
{
  later(11 * 60 * 1000);
  const NEW = 'ffffffffffffffffffff';
  const b = page({ cache: dev, route: standard({ tokens: { transfer: NEW } }) });
  await b.T.load('transfer');
  await new Promise(r => setTimeout(r, 0));
  ok('a new token: downloaded, and the copy replaced (one entry for the store, the new token)', gets(b).length === 1 && dev.m.get('u-1|transfer').token === NEW &&
     dev.m.get('u-1|transfer#ok').token === NEW && [...dev.m.keys()].filter(k => /\|transfer$/.test(k)).length === 1, [...dev.m.keys()]);
  dev.m.get('u-1|transfer').token = TOK; dev.m.delete('u-1|transfer#ok');
}
{
  const c = memCache({ seed: { 'u-1|transfer': { token: TOK, gz: GZ }, 'u-1|transfer#ok': { token: TOK, at: CLOCK.now } } });
  const b = page({ cache: c, session: { token: 'eyJ.user-2.sig', userId: 'u-2' } });
  await b.T.load('transfer');
  await new Promise(r => setTimeout(r, 0));
  ok('another account never rides on the first one\'s yes: asked, downloaded, and the first one\'s entries removed', posts(b).length === 1 && gets(b).length === 1 &&
     !c.m.has('u-1|transfer') && !c.m.has('u-1|transfer#ok') && c.m.has('u-2|transfer'), [...c.m.keys()]);
}

/* ---------------------------------------------------------------- refusals --- */
console.log('\nrefusals');
const refuse = (status, body, headers) => r => (r.init.method === 'POST' ? res(status, body, headers) : res(500, ''));
for (const [status, body, want, h] of [[401, { reason: 'signin' }, 'signin'], [401, { reason: 'jwt' }, 'signin'], [403, { reason: 'members' }, 'members'],
  [403, { reason: 'scope' }, 'scope'], [404, { reason: 'none' }, 'none'], [503, { reason: 'unavailable' }, 'network'], [429, { reason: 'rate', retry_after: 90 }, 'rate'],
  [429, { reason: 'rate' }, 'rate', { 'Retry-After': '30' }]]) {
  const c = memCache({ seed: { 'u-1|transfer': { token: TOK, gz: GZ } } });
  const b = page({ cache: c, route: refuse(status, body, h) });
  let err = null;
  try { await b.T.load('transfer'); } catch (e) { err = e; }
  await new Promise(r => setTimeout(r, 0));
  const dropped = !c.m.has('u-1|transfer');
  const extra = want === 'rate' ? err.retryAfter === (body.retry_after || 30) : true;
  ok(`${status} ${body.reason}: '${want}'${want === 'signin' || want === 'members' ? ', and this account\'s copy is deleted' : ', the copy kept'}${want === 'rate' ? ', retryAfter ' + (body.retry_after || 30) : ''}; nothing downloaded`,
     err && err.reason === want && extra && dropped === (want === 'signin' || want === 'members') && gets(b).length === 0, err && { reason: err.reason, retryAfter: err.retryAfter });
}
{
  const b = page({ cache: null, route: r => { throw new Error('offline'); } });
  ok('no network: \'network\'', (await reason(b.T.load('tscale'))) === 'network');
}

/* -------------------------------------------------------- the signed URL ran out --- */
console.log('\nthe signed URL');
{
  let n = 0;
  const b = page({ cache: null, route: r => (r.init.method === 'POST' ? standard()(r) : (++n === 1 ? res(400, 'expired') : standard()(r))) });
  const bytes = await b.T.load('transfer');
  ok('ran out between the two (400): asked once more, then downloaded', same(bytes, BIN) && posts(b).length === 2 && gets(b).length === 2);
  const b2 = page({ cache: null, route: r => (r.init.method === 'POST' ? standard()(r) : res(403, 'expired')) });
  ok('...and only once: \'network\' after the second', (await reason(b2.T.load('transfer'))) === 'network' && posts(b2).length === 2 && gets(b2).length === 2);
}

/* ----------------------------------------------------------- the device's copy --- */
console.log('\nthe device\'s copy');
{
  const c = memCache({ seed: { 'u-2|transfer': { token: TOK, gz: GZ }, 'u-2|tscale': { token: STOK, gz: SGZ }, 'u-1|tscale': { token: STOK, gz: SGZ } } });
  const b = page({ cache: c });
  await b.T.load('tscale');
  await new Promise(r => setTimeout(r, 0));
  ok('the first load removes every other account\'s copies and keeps this one\'s', [...c.m.keys()].join() === 'u-1|tscale,u-1|tscale#ok' && gets(b).length === 0, [...c.m.keys()]);
}
{
  const c = memCache({ seed: { 'u-1|transfer': { token: TOK, gz: new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6]).buffer } } });
  const b = page({ cache: c });
  const bytes = await b.T.load('transfer');
  await new Promise(r => setTimeout(r, 0));
  ok('a damaged copy with the right token: downloaded again and replaced', same(bytes, BIN) && gets(b).length === 1 && same(new Uint8Array(c.m.get('u-1|transfer').gz), GZ));
}
{
  const c = memCache({ broken: true });
  const b = page({ cache: c });
  const bytes = await b.T.load('transfer');
  ok('a cache that fails everywhere (a private window, storage blocked): the file still loads', same(bytes, BIN) && gets(b).length === 1);
  const b2 = page({});                         // no adapter and no indexedDB in this sandbox: no cache at all
  ok('...and with no IndexedDB at all', same(await b2.T.load('transfer'), BIN));
}
{
  const c = memCache();
  let release;
  const gate = new Promise(r => { release = r; });
  const b = page({ cache: c, route: async r => { if (r.init.method === 'GET') await gate; return standard()(r); } });
  const p = b.T.load('transfer');
  await new Promise(r => setTimeout(r, 5));
  b.state.session = { token: 'eyJ.user-2.sig', userId: 'u-2' }; b.fire();
  release();
  ok('another account signs in while it downloads: \'aborted\', and nothing is kept', (await reason(p)) === 'aborted' && c.m.size === 0, [...c.m.keys()]);
  const q = await b.T.load('transfer');
  ok('...the next load is the new account\'s own, with its own bearer', same(q, BIN) && posts(b).slice(-1)[0].init.headers.Authorization === 'Bearer eyJ.user-2.sig');
}
{
  const c = memCache({ seed: { 'u-1|transfer': { token: TOK, gz: GZ } } });
  const b = page({ cache: c });
  await b.T.load('transfer');
  await b.T.clear();
  ok('clear(): the device\'s copy dropped, and the next load asks again', c.log.some(x => x[0] === 'drop') && c.m.size === 0);
  const n = posts(b).length;
  await b.T.load('transfer');
  ok('...one more request, after clear()', posts(b).length === n + 1);
}

/* ---------------------------------------------------------------- the files --- */
console.log('\nthe files');
{
  const b = page({ cache: null, route: standard({ files: { transfer: zlib.gzipSync(Buffer.from('{"not":"a store"}')) } }) });
  ok('a file that is not a TMS2 store: \'layout\'', (await reason(b.T.load('transfer'))) === 'layout');
  const b2 = page({ cache: null, route: standard({ files: { tscale: zlib.gzipSync(Buffer.from('{"version":2,"leagues":{}}')) } }) });
  ok('a scale that is not version 1: \'layout\'', (await reason(b2.T.load('tscale'))) === 'layout');
  const b3 = page({ cache: memCache(), route: standard({ files: { transfer: Buffer.from(BIN) } }) });
  ok('a file the network already unzipped (a Content-Encoding) is read as it is', same(await b3.T.load('transfer'), BIN));
  const b4 = page({ cache: null, noDS: true });
  ok('a browser with no DecompressionStream: \'unsupported\'', (await reason(b4.T.load('transfer'))) === 'unsupported');
}

/* ------------------------------------------------------------------ sign-out --- */
console.log('\nsign-out');
{
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'epinoia', 'config.js'), 'utf8');
  const so = cfgSrc.slice(cfgSrc.indexOf('window.epinoiaSignOut'), cfgSrc.indexOf("dispatchEvent(new Event('epinoia:auth'))"));
  ok('config.js epinoiaSignOut deletes the database (through the loader where it is loaded, else by name)',
     /EpinoiaTransferData\.clear\(\)/.test(so) && /deleteDatabase\('epinoia_transfer'\)/.test(so) && page({}).T.DB_NAME === 'epinoia_transfer');
  ok('the loader never writes localStorage or sessionStorage, and fetches the signed URL with no-store', !/localStorage|sessionStorage/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')) && /cache: 'no-store'/.test(SRC));
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
