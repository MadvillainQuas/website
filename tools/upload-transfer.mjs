#!/usr/bin/env node
/* ============================================================================
   THE TRANSFER MATRIX'S DATA, INTO THE PRIVATE BUCKET: transfermatrix/build/ -> the 'analytics' bucket + its index.

     node tools/upload-transfer.mjs --dry-run      check the files and say what would be done (reads only, writes nothing)
     node tools/upload-transfer.mjs                upload them, index them, tidy the older copies
     node tools/upload-transfer.mjs --dir <dir>    the build folder, if not transfermatrix/build/
     node tools/upload-transfer.mjs --force        upload even when the index already names the same file

   Run tools/build-transfer.mjs first (it writes the files and manifest.json), and apply migration 0265 before the first
   upload (supabase db push): until then the bucket refuses a gzipped file and the index refuses the two scopes. The
   tool checks that before it writes anything (analytics_check answers 'scope' for 'transfer' until 0265 is in).

   THE KEY: SUPABASE_URL and SUPABASE_SERVICE_KEY from the environment, else supabase_url and service_key from
   %APPDATA%\epinoia\worker.json (the worker's own config). The key is sent to the project's REST and Storage endpoints
   only, and is never printed, logged or written anywhere.

   WHAT IT DOES, for each of the two files (scope 'transfer': transfer/<token>.bin.gz, scope 'tscale':
   tscale/<token>.json.gz; the token is the first 20 hex digits of the SHA-256 of the gzipped bytes, so the same data
   always has the same name and a reader's cached copy stays good):
     1. checks the local file against the manifest (bytes and hash) and that it opens (gzip; the store's TMS2 magic,
        the scale's JSON);
     2. reads the scope's current index row (analytics_files: scope, league_key 'all', season_key 'current', team_key '');
        the same token and path there already: nothing to do (unless --force);
     3. uploads the object (Content-Type application/gzip, cache-control private, no-store; upsert);
     4. ONLY THEN writes the index row, so the function never names a file that is not there yet;
     5. deletes the scope's OLDER objects, but keeps the one the row named until now: a reader handed a two-minute signed
        URL to it a moment ago still gets it. The bucket holds at most two copies of each file.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_DEFAULT = path.join(ROOT, 'transfermatrix', 'build');
export const BUCKET = 'analytics';
export const SCOPES = {
  transfer: { file: 'transfer.bin.gz', ext: '.bin.gz', what: 'the player store' },
  tscale: { file: 'tscale.json.gz', ext: '.json.gz', what: 'the league scale' }
};
export const objectPath = (scope, token) => scope + '/' + token + SCOPES[scope].ext;
const TOKEN = /^[0-9a-f]{20}$/;

/* ------------------------------------------------------------------------------------------------- the key --- */
/* {url, key, from}; from names where they came from, never the key itself */
export function credentials(env, readConfig) {
  let url = env.SUPABASE_URL || '', key = env.SUPABASE_SERVICE_KEY || '', from = 'environment';
  if (!url || !key) {
    try {
      const cfg = readConfig();
      url = url || cfg.supabase_url || ''; key = key || cfg.service_key || '';
      from = env.SUPABASE_URL || env.SUPABASE_SERVICE_KEY ? 'environment + worker.json' : 'worker.json';
    } catch (_) { /* no config */ }
  }
  return url && key ? { url: String(url).replace(/\/+$/, ''), key: String(key), from } : null;
}
const readWorkerConfig = env => () => JSON.parse(fs.readFileSync(path.join(env.APPDATA || '', 'epinoia', 'worker.json'), 'utf8'));
const host = u => { try { return new URL(u).host; } catch (_) { return '?'; } };

/* ----------------------------------------------------------------------------------------- the local files --- */
/* the manifest and both files, checked; throws with what is wrong */
export function readBuild(dir) {
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) throw new Error('no ' + mf + ': run node tools/build-transfer.mjs first');
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const out = { built: manifest.built || null, files: {} };
  for (const scope of Object.keys(SCOPES)) {
    const m = manifest[scope];
    if (!m || !TOKEN.test(String(m.token || ''))) throw new Error('manifest.json has no ' + scope + ' file');
    const p = path.join(dir, m.file || SCOPES[scope].file);
    if (!fs.existsSync(p)) throw new Error('missing ' + p);
    const gz = fs.readFileSync(p);
    const token = crypto.createHash('sha256').update(gz).digest('hex').slice(0, 20);
    if (token !== m.token || gz.length !== m.bytes) throw new Error(scope + ': ' + p + ' is not the file manifest.json describes (rebuild)');
    if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error(scope + ': not gzipped');
    let raw;
    try { raw = zlib.gunzipSync(gz); } catch (e) { throw new Error(scope + ': does not unzip (' + e.message + ')'); }
    if (scope === 'transfer' && String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'TMS2') throw new Error('transfer: not a TMS2 store');
    if (scope === 'tscale') {
      let j; try { j = JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('tscale: not JSON'); }
      if (!j || j.version !== 1 || !j.leagues) throw new Error('tscale: not a version 1 scale');
    }
    out.files[scope] = { scope, local: p, gz, token, bytes: gz.length, raw: raw.length, layout: m.layout || 1, path: objectPath(scope, token) };
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------- the API --- */
export function client(c, f) {
  const hdr = { apikey: c.key, Authorization: 'Bearer ' + c.key };
  const call = async (p, init, what) => {
    const r = await f(c.url + p, Object.assign({}, init, { headers: Object.assign({}, hdr, (init || {}).headers || {}) }));
    const t = await r.text();
    if (!r.ok) { const e = new Error(what + ': ' + r.status + ' ' + String(t).slice(0, 200)); e.status = r.status; e.body = String(t); throw e; }
    try { return t ? JSON.parse(t) : null; } catch (_) { return t; }
  };
  return {
    check: scope => call('/rest/v1/rpc/analytics_check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_scope: scope, p_league: null, p_season: null, p_team: null }) }, 'analytics_check'),
    row: scope => call(`/rest/v1/analytics_files?scope=eq.${scope}&league_key=eq.all&season_key=eq.current&team_key=eq.&select=path,token,bytes,built_at,layout`,
      { headers: { Accept: 'application/json' } }, 'read the index').then(rows => (Array.isArray(rows) && rows[0]) || null),
    upload: (p, body) => call('/storage/v1/object/' + BUCKET + '/' + p, { method: 'POST', body,
      headers: { 'Content-Type': 'application/gzip', 'x-upsert': 'true', 'cache-control': 'private, no-store' } }, 'upload ' + p),
    index: row => call('/rest/v1/analytics_files?on_conflict=scope,league_key,season_key,team_key', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) }, 'write the index'),
    list: prefix => call('/storage/v1/object/list/' + BUCKET, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000 }) }, 'list ' + prefix),
    remove: paths => call('/storage/v1/object/' + BUCKET, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }) }, 'delete')
  };
}

/* the index row for a file: one for the whole platform, current */
export const indexRow = (file, builtAt) => ({
  scope: file.scope, league_key: 'all', season_key: 'current', team_key: '', league_id: null, season_id: null, team_id: null,
  is_current: true, path: file.path, token: file.token, layout: file.layout, fv: 0, bytes: file.bytes, n_games: null,
  built_at: builtAt, ci_at: null
});
const strip = p => String(p || '').replace(/^analytics\//, '');
const kb = n => (n / 1024).toFixed(0) + ' KB';

/* ------------------------------------------------------------------------------------------------- the run --- */
/* o: {dir, dry, force, fetch, env, readConfig, log, now}; returns {done: [...], skipped: [...], planned: [...]} */
export async function run(o) {
  const log = o.log || (s => console.log(s));
  const env = o.env || process.env;
  const build = readBuild(o.dir || DIR_DEFAULT);
  const res = { done: [], skipped: [], planned: [], deleted: [] };
  log(`the build of ${build.built || '?'}:`);
  for (const f of Object.values(build.files)) log(`  ${f.scope.padEnd(8)} ${f.local}  ${kb(f.bytes)} gzipped (${kb(f.raw)} raw)  -> ${BUCKET}/${f.path}`);

  const c = credentials(env, o.readConfig || readWorkerConfig(env));
  if (!c) {
    if (!o.dry) throw new Error('no key: set SUPABASE_URL and SUPABASE_SERVICE_KEY, or put supabase_url and service_key in %APPDATA%\\epinoia\\worker.json');
    log('\n(dry run with no key: the index was not read)');
    for (const f of Object.values(build.files)) { res.planned.push(f.scope); log(`  would upload ${f.path}, then index it, then delete any older copy but the one named now`); }
    return res;
  }
  const f = o.fetch || globalThis.fetch;
  const api = client(c, f);
  log(`\nthe project: ${host(c.url)} (key from ${c.from})`);

  /* the database must know the scopes before anything is written (0265) */
  const verdict = await api.check('transfer');
  if (verdict === 'scope') throw new Error('the database does not know the transfer scopes yet: apply migration 0265 (supabase db push) first');

  const at = new Date((o.now || Date.now)()).toISOString();
  for (const file of Object.values(build.files)) {
    const prev = await api.row(file.scope);
    const prevPath = prev ? strip(prev.path) : null;
    log(`\n${file.scope}: now ${prev ? prevPath + ' (' + (prev.token || '?') + ', ' + (prev.built_at || '?') + ')' : 'none'}`);
    if (prev && prev.token === file.token && prevPath === file.path && !o.force) {
      log('  the same file is already current: nothing to do'); res.skipped.push(file.scope); continue;
    }
    if (o.dry) {
      log(`  would upload ${file.path} (${kb(file.bytes)}), index it${prevPath && prevPath !== file.path ? ', keep ' + prevPath + ' one more round' : ''}, delete any older copy`);
      res.planned.push(file.scope); continue;
    }
    try { await api.upload(file.path, file.gz); }
    catch (e) {
      if (e.status === 400 || e.status === 415 || /mime|content.?type/i.test(e.body || '')) throw new Error(file.scope + ': the bucket refused the file (' + e.status + '): is migration 0265 applied?');
      throw e;
    }
    log('  uploaded ' + file.path);
    try { await api.index(indexRow(file, at)); }
    catch (e) {
      if (/23514|check constraint/i.test(e.body || '')) throw new Error(file.scope + ': the index refused the scope: apply migration 0265 first');
      throw e;
    }
    log('  indexed: the analytics-file function now hands out ' + file.token);
    /* the older copies, but never the new one or the one the row named until a moment ago */
    try {
      const listed = await api.list(file.scope);
      const old = (Array.isArray(listed) ? listed : []).map(x => x && x.name).filter(Boolean).map(n => file.scope + '/' + n)
        .filter(p => p !== file.path && p !== prevPath && p.endsWith(SCOPES[file.scope].ext));
      if (old.length) { await api.remove(old); res.deleted.push(...old); log('  deleted ' + old.length + ' older cop' + (old.length === 1 ? 'y' : 'ies')); }
      if (prevPath && prevPath !== file.path) log('  kept ' + prevPath + ' (signed URLs handed out for it still work); the next upload deletes it');
    } catch (e) { log('  (tidying the older copies failed, harmless: ' + String(e.message).slice(0, 120) + ')'); }
    res.done.push(file.scope);
  }
  log(o.dry ? '\ndry run: nothing written' : `\ndone: ${res.done.length} uploaded, ${res.skipped.length} unchanged`);
  return res;
}

/* ---------------------------------------------------------------------------------------------- the command --- */
const isMain = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch (_) { return false; } })();
if (isMain) {
  const a = process.argv.slice(2);
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  run({ dir: val('--dir') ? path.resolve(val('--dir')) : DIR_DEFAULT, dry: a.includes('--dry-run') || a.includes('--dry'), force: a.includes('--force') })
    .catch(e => { console.error('upload-transfer: ' + String(e && e.message || e)); process.exit(1); });
}
