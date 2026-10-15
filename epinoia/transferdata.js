'use strict';
/* ============================================================================
   THE TRANSFER MATRIX'S DATA: window.EpinoiaTransferData, the one way a page gets the Transfer matrix's two files.

   Neither file is public. Each lives in the private 'analytics' bucket; a page asks the analytics-file function, the
   database decides with the reader's own session (analytics_check, scopes 'transfer' and 'tscale', migration 0265: an
   account always, then the 'transferMatrix' gate), and the answer is a URL that works for two minutes.

     load(scope, opts?) -> Promise
        load('transfer')  the player store: a Uint8Array ('TMS2'), for EpinoiaTransferEngine.decodeStore(bytes)
        load('tscale')    the league scale, parsed: {version: 1, built, seasons, settings, stats, meta, leagues, pairs}
                          (tools/build-transfer.mjs documents it, and the rule for adjusting a stat with it)
        rejects with an Error whose .reason says why:
          'signin'       no account: NOTHING IS ASKED while signed out; or the function refused the session
          'members'      signed in, and the section is for members
          'rate'         too many requests for now: .retryAfter (seconds)
          'none'         nothing uploaded yet; 'scope' the server does not know the files (not deployed yet)
          'unsupported'  this browser cannot unzip a file (no DecompressionStream: every browser the site supports has it)
          'layout'       the file is not one this page reads; 'network' anything else; 'aborted' the account changed
        opts.onProgress({stage: 'check'|'download'|'unzip'|'done', loaded?, total?, cached?}) as it goes
     meta(scope)   {token, built, bytes, cached, asked} of the last load on this page, or null (asked: the function
                   was asked this time, false within the ten minutes below)
     clear()       forget every copy, in memory and on this device -> Promise
     DB_NAME; _setTransport(fn) and _setCache(adapter|null) for tests

   ONE REQUEST AT A TIME: a second load() of a scope while one is in flight shares it; once loaded, the page keeps the
   answer in memory for its life (the same account).

   A COPY ON THE DEVICE, BY TOKEN: the gzipped file is kept in IndexedDB (database epinoia_transfer, one entry per account
   and scope, "<user>|<scope>", and beside it "<user>|<scope>#ok", when the function last confirmed that token for that
   account). A load asks the function first; when the token it answers with is the one kept, the copy is used and
   NOTHING IS DOWNLOADED; a new token downloads the new file and replaces the copy. Within ten minutes of the function's
   last yes (REUSE_MS, What wins' own window) the copy is used without asking, so a reader going from profile to profile
   is not counted against the function's hourly limit at every page; a membership that ends is honoured on that device
   within those ten minutes. The database is the site's only record of it:
     * only a signed-in reader's copy is kept, under that account; the first load on a page removes every other
       account's entries;
     * the function refusing the session or the membership removes that account's copy of that file;
     * signing out (config.js epinoiaSignOut) deletes the database, from whichever page it happens on;
     * IndexedDB that will not open (a private window, storage blocked or full) is no cache at all: the file is
       downloaded each visit, nothing fails.
   The signed URL is fetched with cache: 'no-store' and no headers of ours, so the browser's own HTTP cache never holds a
   copy that sign-out cannot clear.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTransferData = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SCOPES = ['transfer', 'tscale'];
const DB_NAME = 'epinoia_transfer', DB_STORE = 'files', DB_V = 1, DB_OPEN_MS = 2500;
const REUSE_MS = 10 * 60 * 1000;

let transport = null;
let cacheOverride;                       // undefined: IndexedDB; null: no cache; an object: a test's adapter
const done = new Map();                  // "<user>|<scope>" -> {data, meta}, this page's life
const inflight = new Map();              // "<user>|<scope>" -> the load in flight
const metas = new Map();                 // scope -> meta of the last load
let gen = 0, lastUser = null, subscribed = false, swept = false;

const cfg = () => root.EPINOIA_CONFIG || {};
const base = () => String(cfg().supabaseUrl || '').replace(/\/$/, '');
const access = () => root.EpinoiaAccess || null;
const sess = () => { try { const A = access(); return A && typeof A.session === 'function' ? A.session() : null; } catch (_) { return null; } };
const userOf = s => (s && s.token ? String(s.userId || 'user') : '');
const send = (url, init) => (transport || ((u, i) => root.fetch(u, i)))(url, init);
const note = (opts, stage, extra) => { try { if (opts && typeof opts.onProgress === 'function') opts.onProgress(Object.assign({ stage }, extra || {})); } catch (_) { /* a progress line never breaks a load */ } };
function fail(reason, extra) { const e = new Error('transfer data: ' + reason); e.reason = reason; return Object.assign(e, extra || {}); }
/* the session after an expired token has been refreshed (access.js); never rejects */
async function ready() {
  const A = access();
  if (A && typeof A.sessionReady === 'function') { try { await A.sessionReady(); } catch (_) { /* the stored session stands */ } }
}

/* ---------------------------------------------------------- the device's copy --- */
/* IndexedDB, every call failing safe to "nothing kept": {get, put, del, keys, drop}, all promises that never reject */
function indexedCache() {
  let IDB = null;
  try { IDB = root.indexedDB || null; } catch (_) { IDB = null; }
  let dbP = null;
  function open() {
    if (!IDB) return Promise.resolve(null);
    if (dbP) return dbP;
    dbP = new Promise(resolve => {
      let over = false, t = null;
      const end = db => {
        if (t != null) { try { root.clearTimeout(t); } catch (_) { /* no timer */ } }
        if (!over) { over = true; resolve(db); } else if (db) { try { db.close(); } catch (_) { /* closed */ } }
      };
      try { t = root.setTimeout(() => end(null), DB_OPEN_MS); } catch (_) { t = null; }
      let rq;
      try { rq = IDB.open(DB_NAME, DB_V); } catch (_) { end(null); return; }
      rq.onupgradeneeded = () => { try { const db = rq.result; if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE); } catch (_) { /* no store */ } };
      rq.onsuccess = () => {
        const db = rq.result;
        /* a sign-out deleting the database (another page, another tab): let it */
        try { db.onversionchange = () => { try { db.close(); } catch (_) { /* closed */ } dbP = null; }; } catch (_) { /* old browser */ }
        end(db);
      };
      rq.onerror = () => end(null);
    }).then(db => { if (!db) dbP = null; return db; });
    return dbP;
  }
  function run(mode, fn) {
    return open().then(db => (db ? new Promise(resolve => {
      try {
        const tx = db.transaction(DB_STORE, mode), rq = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(rq && rq.result !== undefined ? rq.result : null);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch (_) { resolve(null); }
    }) : null)).catch(() => null);
  }
  return {
    get: k => run('readonly', s => s.get(k)),
    put: (k, v) => run('readwrite', s => s.put(v, k)),
    del: k => run('readwrite', s => s.delete(k)),
    keys: () => run('readonly', s => (typeof s.getAllKeys === 'function' ? s.getAllKeys() : null)).then(x => (Array.isArray(x) ? x.map(String) : [])),
    drop: () => Promise.resolve(dbP).then(db => {
      try { if (db) db.close(); } catch (_) { /* closed */ }
      dbP = null;
      if (!IDB) return null;
      return new Promise(resolve => {
        try { const rq = IDB.deleteDatabase(DB_NAME); rq.onsuccess = rq.onerror = rq.onblocked = () => resolve(null); } catch (_) { resolve(null); }
      });
    }).catch(() => null)
  };
}
let idbCache = null;
const cache = () => (cacheOverride !== undefined ? cacheOverride : (idbCache || (idbCache = indexedCache())));
const safe = p => Promise.resolve(p).catch(() => null);
const cacheGet = k => { const c = cache(); return c ? safe(c.get(k)) : Promise.resolve(null); };
const cachePut = (k, v) => { const c = cache(); return c ? safe(c.put(k, v)) : Promise.resolve(null); };
const cacheDel = k => { const c = cache(); return c ? safe(c.del(k)) : Promise.resolve(null); };
/* every entry that is not this account's: what another account left in this browser */
function tidy(u) {
  const c = cache();
  if (!c || !u) return Promise.resolve(null);
  return safe(Promise.resolve(c.keys()).then(ks => Promise.all((ks || []).filter(k => String(k).indexOf(u + '|') !== 0).map(k => safe(c.del(k))))));
}
/* another account on this page: nothing of the last one's may be reused. A sign-out is the sign-out's to clear
   (epinoiaSignOut deletes the database); a moment with no session (a token being refreshed) clears memory only. */
function checkUser(afterReady) {
  const u = userOf(sess());
  if (lastUser !== null && u !== lastUser) { gen++; done.clear(); inflight.clear(); metas.clear(); if (u) tidy(u); }
  lastUser = u;
  if (afterReady && !swept && u) { swept = true; tidy(u); }
  if (!subscribed) {
    const A = access();
    if (A && typeof A.onChange === 'function') { subscribed = true; try { A.onChange(() => checkUser()); } catch (_) { subscribed = false; } }
  }
  return u;
}

/* ------------------------------------------------------------------ the function --- */
async function ask(scope) {
  const c = cfg(), s = sess();
  const headers = { apikey: c.supabaseAnonKey || '', 'Content-Type': 'application/json' };
  if (s && s.token) headers.Authorization = 'Bearer ' + s.token;
  let r;
  try { r = await send(base() + '/functions/v1/analytics-file', { method: 'POST', headers, body: JSON.stringify({ scope }) }); }
  catch (_) { throw fail('network'); }
  let j = null;
  try { j = await r.json(); } catch (_) { j = null; }
  const st = r.status;
  if (st === 200 && j && j.url && j.token) return j;
  if (st === 401) throw fail('signin', { detail: (j && j.reason) || 'signin' });
  if (st === 403) throw fail(j && j.reason === 'scope' ? 'scope' : 'members');
  if (st === 404) throw fail('none');
  if (st === 429) {
    const h = r.headers && typeof r.headers.get === 'function' ? +r.headers.get('Retry-After') : NaN;
    throw fail('rate', { retryAfter: (j && +j.retry_after) || (isFinite(h) && h > 0 ? h : 60) });
  }
  throw fail('network', { status: st });
}
/* the signed URL, with no headers of ours (storage checks the URL's own token), never into the HTTP cache */
async function download(url) {
  let r;
  try { r = await send(url, { method: 'GET', cache: 'no-store' }); } catch (_) { return { status: 0 }; }
  if (!r || r.status < 200 || r.status >= 300) return { status: r ? r.status : 0 };
  try { return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) }; } catch (_) { return { status: 0 }; }
}
const gzipped = b => !!b && b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
async function gunzip(b) {
  if (!gzipped(b)) return b;                                   // unzipped on the way (a Content-Encoding): as it is
  if (typeof root.DecompressionStream !== 'function' || typeof root.Response !== 'function' || typeof root.Blob !== 'function') throw fail('unsupported');
  try {
    const out = await new root.Response(new root.Blob([b]).stream().pipeThrough(new root.DecompressionStream('gzip'))).arrayBuffer();
    return new Uint8Array(out);
  } catch (_) { throw fail('layout'); }
}
function parse(scope, raw) {
  if (scope === 'transfer') {
    if (!(raw && raw.length > 8 && raw[0] === 84 && raw[1] === 77 && raw[2] === 83 && raw[3] === 50)) throw fail('layout');   // TMS2
    return raw;
  }
  let j = null;
  try { j = JSON.parse(new root.TextDecoder('utf-8').decode(raw)); } catch (_) { throw fail('layout'); }
  if (!j || j.version !== 1 || !j.leagues || typeof j.leagues !== 'object') throw fail('layout');
  return j;
}

/* the kept copy, opened: data, or null when it is missing or damaged (a damaged one is removed) */
async function openCopy(scope, k, hit, opts) {
  if (!hit || !hit.gz) return null;
  try { const d = parse(scope, await gunzip(new Uint8Array(hit.gz))); note(opts, 'unzip', { cached: true }); return d; }
  catch (e) { if (e.reason === 'unsupported') throw e; cacheDel(k); cacheDel(k + '#ok'); return null; }
}
async function fetchOne(scope, k, g0, opts) {
  let data = null, gz = null, cached = false;
  const hit = await cacheGet(k), ok = await cacheGet(k + '#ok');
  /* the function said yes to this copy for this account less than ten minutes ago: no request at all */
  if (hit && ok && ok.token === hit.token && typeof ok.at === 'number' && Date.now() - ok.at >= 0 && Date.now() - ok.at < REUSE_MS) {
    data = await openCopy(scope, k, hit, opts);
    if (g0 !== gen) throw fail('aborted');
    if (data) {
      const m = { token: hit.token, built: hit.built || null, bytes: hit.bytes || null, cached: true, asked: false };
      done.set(k, { data, meta: m }); metas.set(scope, m);
      note(opts, 'done', { cached: true });
      return data;
    }
  }
  note(opts, 'check');
  let meta;
  try { meta = await ask(scope); }
  catch (e) {
    /* refused: this account's copy of the file goes too */
    if (e.reason === 'signin' || e.reason === 'members') { cacheDel(k); cacheDel(k + '#ok'); }
    throw e;
  }
  if (g0 !== gen) throw fail('aborted');
  data = null;
  if (hit && hit.token === meta.token) { data = await openCopy(scope, k, hit, opts); cached = !!data; }
  if (!data) {
    note(opts, 'download', { loaded: 0, total: meta.bytes || null });
    let got = await download(meta.url);
    if (got.status === 400 || got.status === 403) {          // the two minutes ran out between the two requests: once more
      meta = await ask(scope);
      got = await download(meta.url);
    }
    if (g0 !== gen) throw fail('aborted');
    if (!got.bytes) throw fail(got.status === 404 ? 'none' : 'network', { status: got.status });
    gz = got.bytes;
    note(opts, 'unzip', { loaded: gz.length, total: gz.length, cached: false });
    data = parse(scope, await gunzip(gz));
  }
  if (g0 !== gen) throw fail('aborted');                       // the account changed meanwhile: neither kept nor answered
  const m = { token: meta.token, built: meta.built_at || null, bytes: meta.bytes || (gz ? gz.length : null), cached, asked: true };
  if (gz && gzipped(gz)) cachePut(k, { token: meta.token, gz: gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength), built: m.built, bytes: gz.length, at: Date.now() });
  if (cached || (gz && gzipped(gz))) cachePut(k + '#ok', { token: meta.token, at: Date.now() });
  done.set(k, { data, meta: m });
  metas.set(scope, m);
  note(opts, 'done', { cached });
  return data;
}

/* ----------------------------------------------------------------------- the API --- */
function load(scope, opts) {
  if (SCOPES.indexOf(scope) < 0) return Promise.reject(fail('scope'));
  return (async () => {
    await ready();
    const u = checkUser(true);
    if (!u) throw fail('signin');                              // signed out: nothing is asked for
    const k = u + '|' + scope;
    if (done.has(k)) { note(opts, 'done', { cached: true }); return done.get(k).data; }
    if (inflight.has(k)) return inflight.get(k);
    const p = fetchOne(scope, k, gen, opts);
    inflight.set(k, p);
    const forget = () => { if (inflight.get(k) === p) inflight.delete(k); };
    p.then(forget, forget);
    return p;
  })();
}
function meta(scope) { const m = metas.get(scope); return m ? Object.assign({}, m) : null; }
function clear() {
  gen++; done.clear(); inflight.clear(); metas.clear();
  const c = cache();
  return c ? safe(c.drop()) : Promise.resolve(null);
}
function _setTransport(fn) { transport = typeof fn === 'function' ? fn : null; }
function _setCache(adapter) { cacheOverride = adapter === undefined ? undefined : adapter; idbCache = null; }

return { SCOPES, DB_NAME, REUSE_MS, load, meta, clear, _setTransport, _setCache };
}));
