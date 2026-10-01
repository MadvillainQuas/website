'use strict';
/* ============================================================================
   THE WHAT WINS LOADER (docs/what-wins-model.md §10.2, A.2): window.EpinoiaWinFile.

   The only way a page gets a What wins file. A members' file is never public: the page asks the analytics-file
   function, the database decides with the reader's own session (analytics_check), and the answer is a URL that
   works for two minutes. The public preview (the teaser) is a public snapshot.

     get({scope: 'wins'|'fo'|'club'|'pos'|'teaser', league?, season?, team?}, {onProgress?, signal?})
        -> {ok: true, data, token, built, pending, ci_at, bytes, cached}
         | {ok: false, reason: 'signin'|'members'|'league'|'scope'|'none'|'rate'|'layout'|'jwt'|'network'|'aborted', retryAfter?}
     refresh({league, season, team?, scope?}, {onProgress?, signal?})   RECALCULATE: the function adds the new games
        -> get()'s answer + {refreshed, queued, joined, refreshReason}
     cached(o)   what the cache holds for o, without a request (null when nothing)
     clear()     forget every file (memory and sessionStorage)
     FILE_V = 1; _setTransport(fn) for tests (fn(url, init) -> Promise of a fetch Response)

   A members' file: POST <supabaseUrl>/functions/v1/analytics-file with apikey and, ONLY when signed in, the session's
   own bearer (EpinoiaAccess.session().token; never authHeaders(), which would send the anon key as a bearer), then GET
   the signed URL with no headers at all. A 400/403 from the storage URL means it ran out between the two: asked once
   more. data.w other than FILE_V is 'layout' (the model is being rebuilt).

   CACHED IN MEMORY AND sessionStorage, KEYED BY THE USER, NEVER IN localStorage (I7): epinoia_ww:<user|anon>:<scope>:
   <league|all>:<season|current>:<team|->. Reused without a request for ten minutes, then asked again and downloaded
   only if the token moved. Another account signing in on this tab clears every epinoia_ww: key. The old page's
   localStorage copy (epinoia_winning_v1, up to 1.9 MB of somebody's analysis) is removed the first time this loads.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinFile = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const FILE_V = 1;
const PREFIX = 'epinoia_ww:';
const LEGACY = 'epinoia_winning_v1';
const REUSE_MS = 10 * 60 * 1000;
const MAX_CACHE = 2 * 1024 * 1024;
const SCOPES = ['wins', 'fo', 'club', 'pos', 'teaser'];

let transport = null;
const mem = new Map();
const inflight = new Map();
let lastUser = null, subscribed = false;

const cfg = () => root.EPINOIA_CONFIG || {};
const base = () => String(cfg().supabaseUrl || '').replace(/\/$/, '');
const access = () => root.EpinoiaAccess || null;
const sess = () => { try { const A = access(); return A && typeof A.session === 'function' ? A.session() : null; } catch (_) { return null; } };
const userOf = s => (s && s.token ? String(s.userId || 'user') : 'anon');
const store = () => { try { return root.sessionStorage || null; } catch (_) { return null; } };
const send = (url, init) => (transport || ((u, i) => root.fetch(u, i)))(url, init);
const note = (opts, stage, extra) => { try { if (opts && typeof opts.onProgress === 'function') opts.onProgress(Object.assign({ stage }, extra || {})); } catch (_) { /* a progress bar never breaks a load */ } };
const aborted = opts => !!(opts && opts.signal && opts.signal.aborted);

/* ------------------------------------------------------------- the old copy --- */
try { if (root.localStorage) root.localStorage.removeItem(LEGACY); } catch (_) { /* storage blocked: nothing kept there either */ }

/* ---------------------------------------------------------------- the cache --- */
function keyOf(o) {
  return PREFIX + userOf(sess()) + ':' + o.scope + ':' + (o.league || 'all') + ':' + (o.season || 'current') + ':' + (o.team || '-');
}
function readSS(k) {
  const S = store();
  if (!S) return null;
  try { const raw = S.getItem(k); if (!raw) return null; const j = JSON.parse(raw); return j && j.data && j.token ? j : null; } catch (_) { return null; }
}
function keep(k, e) {
  mem.set(k, e);
  const S = store();
  if (!S) return;
  try {
    const raw = JSON.stringify(e);
    if (raw.length < MAX_CACHE) S.setItem(k, raw); else S.removeItem(k);
  } catch (_) { /* full or blocked: memory still has it */ }
}
function clear() {
  mem.clear(); inflight.clear();
  const S = store();
  if (!S) return;
  try {
    const gone = [];
    for (let i = 0; i < S.length; i++) { const k = S.key(i); if (k && k.indexOf(PREFIX) === 0) gone.push(k); }
    gone.forEach(k => S.removeItem(k));
  } catch (_) { /* nothing to clear */ }
}
/* a different account on this tab: nothing of the last one's may be reused */
function checkUser() {
  const u = userOf(sess());
  if (lastUser !== null && u !== lastUser) clear();
  lastUser = u;
  if (!subscribed) {
    const A = access();
    if (A && typeof A.onChange === 'function') { subscribed = true; try { A.onChange(() => checkUser()); } catch (_) { subscribed = false; } }
  }
}
const answer = (e, cached) => ({ ok: true, data: e.data, token: e.token, built: e.built || (e.data && e.data.built) || null,
  pending: e.pending == null ? null : e.pending, ci_at: e.ci_at || (e.data && e.data.ci_at) || null, bytes: e.bytes || null, cached: !!cached });
function cached(o) {
  if (!o || SCOPES.indexOf(o.scope) < 0) return null;
  checkUser();
  const k = keyOf(o), e = mem.get(k) || readSS(k);
  return e ? answer(e, true) : null;
}

/* ------------------------------------------------------------ the function --- */
const REASONS = { 401: ['signin', 'jwt'], 403: ['members', 'league', 'scope'] };
async function ask(o, refresh, opts) {
  const c = cfg();
  const headers = { apikey: c.supabaseAnonKey || '', 'Content-Type': 'application/json' };
  const s = sess();
  if (s && s.token) headers.Authorization = 'Bearer ' + s.token;
  const body = { scope: o.scope };
  ['league', 'season', 'team'].forEach(k => { if (o[k]) body[k] = o[k]; });
  if (refresh) body.refresh = true;
  let r;
  try { r = await send(base() + '/functions/v1/analytics-file', { method: 'POST', headers, body: JSON.stringify(body), signal: opts && opts.signal }); }
  catch (_) { return { ok: false, reason: aborted(opts) ? 'aborted' : 'network' }; }
  let j = null;
  try { j = await r.json(); } catch (_) { j = null; }
  const st = r.status;
  if (st === 200 && j && j.url) return Object.assign({ ok: true }, j);
  if (st === 401 || st === 403) {
    const allowed = REASONS[st], why = j && allowed.indexOf(j.reason) >= 0 ? j.reason : allowed[0];
    return { ok: false, reason: why };
  }
  if (st === 404) return { ok: false, reason: 'none' };
  if (st === 429) {
    const h = r.headers && typeof r.headers.get === 'function' ? +r.headers.get('Retry-After') : NaN;
    return { ok: false, reason: 'rate', retryAfter: (j && +j.retry_after) || (isFinite(h) && h > 0 ? h : 60) };
  }
  return { ok: false, reason: 'network' };
}

/* the signed URL, with no headers of ours: storage checks the URL's own token */
async function download(url, opts) {
  let r;
  try { r = await send(url, { method: 'GET', signal: opts && opts.signal }); }
  catch (_) { return { status: 0 }; }
  if (r.status < 200 || r.status >= 300) return { status: r.status };
  try {
    const total = r.headers && typeof r.headers.get === 'function' ? +r.headers.get('Content-Length') || null : null;
    if (opts && typeof opts.onProgress === 'function' && r.body && typeof r.body.getReader === 'function' && typeof TextDecoder === 'function') {
      const rd = r.body.getReader(), dec = new TextDecoder();
      let text = '', loaded = 0;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        loaded += value.length; text += dec.decode(value, { stream: true });
        note(opts, 'download', { loaded, total });
      }
      text += dec.decode();
      return { status: r.status, data: JSON.parse(text), bytes: loaded };
    }
    const text = await r.text();
    note(opts, 'download', { loaded: text.length, total: total || text.length });
    return { status: r.status, data: JSON.parse(text), bytes: text.length };
  } catch (_) { return { status: aborted(opts) ? -1 : 0 }; }
}

/* what the function said, turned into a file: the cached one when the token has not moved */
async function settle(o, k, hit, meta, opts) {
  const fresh = e => Object.assign(e, { at: Date.now(), pending: meta.pending == null ? null : meta.pending,
    built: meta.built_at || e.built || null, ci_at: meta.ci_at || e.ci_at || null });
  if (hit && hit.token === meta.token) { const e = fresh(hit); keep(k, e); return answer(e, true); }
  note(opts, 'download', { loaded: 0, total: meta.bytes || null });
  let got = await download(meta.url, opts);
  if (got.status === 400 || got.status === 403) {             // the URL ran out between the two requests: once more
    const again = await ask(o, false, opts);
    if (!again.ok) return again;
    meta = again;
    got = await download(meta.url, opts);
  }
  if (aborted(opts)) return { ok: false, reason: 'aborted' };
  if (!got.data) return { ok: false, reason: 'network' };
  if (got.data.w !== FILE_V) return { ok: false, reason: 'layout' };
  const e = fresh({ token: meta.token, data: got.data, bytes: meta.bytes || got.bytes || null });
  keep(k, e);
  note(opts, 'done');
  return answer(e, false);
}

/* --------------------------------------------------------------- the teaser --- */
async function teaser(k, hit, opts) {
  const pub = base() + '/storage/v1/object/public/snapshots/';
  let r;
  try { r = await send(pub + 'whatwins/index.json', { method: 'GET', signal: opts && opts.signal }); }
  catch (_) { return { ok: false, reason: 'network' }; }
  if (r.status === 404 || r.status === 400) return { ok: false, reason: 'none' };
  if (r.status < 200 || r.status >= 300) return { ok: false, reason: 'network' };
  let ix;
  try { ix = await r.json(); } catch (_) { return { ok: false, reason: 'network' }; }
  if (!ix || !ix.file) return { ok: false, reason: 'none' };
  if (hit && hit.token === ix.token) { hit.at = Date.now(); keep(k, hit); return answer(hit, true); }
  const f = String(ix.file);
  const url = /^https?:/.test(f) ? f : pub + (f.indexOf('/') >= 0 ? f.replace(/^snapshots\//, '') : 'whatwins/' + f);
  const got = await download(url, opts);
  if (!got.data) return { ok: false, reason: got.status === 404 ? 'none' : 'network' };
  if (got.data.w !== FILE_V) return { ok: false, reason: 'layout' };
  const e = { token: ix.token || got.data.token, data: got.data, built: ix.built || got.data.built || null, at: Date.now(), bytes: got.bytes || null };
  keep(k, e);
  return answer(e, false);
}

/* ------------------------------------------------------------------ the API --- */
function get(o, opts) {
  o = o || {};
  if (SCOPES.indexOf(o.scope) < 0) return Promise.resolve({ ok: false, reason: 'scope' });
  checkUser();
  const k = keyOf(o);
  const hit = mem.get(k) || readSS(k);
  if (hit && Date.now() - hit.at < REUSE_MS && !(opts && opts.force)) { mem.set(k, hit); return Promise.resolve(answer(hit, true)); }
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    note(opts, 'check');
    if (o.scope === 'teaser') return teaser(k, hit, opts);
    const meta = await ask(o, false, opts);
    if (!meta.ok) return meta;
    return settle(o, k, hit, meta, opts);
  })().catch(() => ({ ok: false, reason: 'network' }));
  inflight.set(k, p);
  p.then(() => { if (inflight.get(k) === p) inflight.delete(k); });
  return p;
}

/* RECALCULATE (A.2): the function adds the games finalised since the file's build and answers with the new file */
async function refresh(o, opts) {
  o = Object.assign({ scope: 'wins' }, o || {});
  if (['wins', 'fo', 'club', 'pos'].indexOf(o.scope) < 0 || !o.league) return { ok: false, reason: 'scope' };
  checkUser();
  const k = keyOf(o);
  note(opts, 'check');
  note(opts, 'update');
  const meta = await ask(o, true, opts);
  if (!meta.ok) return meta;
  if (aborted(opts)) return { ok: false, reason: 'aborted' };
  const hit = mem.get(k) || readSS(k);
  const out = await settle(o, k, hit, meta, opts);
  return out.ok ? Object.assign(out, { refreshed: !!meta.refreshed, queued: !!meta.queued, joined: !!meta.joined,
                                       refreshReason: meta.refresh_reason || null }) : out;
}

function _setTransport(fn) { transport = typeof fn === 'function' ? fn : null; }

return { FILE_V, get, refresh, cached, clear, _setTransport };
}));
