/* ============================================================================
   THE TRANSFER MATRIX'S UPLOAD (tools/upload-transfer.mjs), against a stand-in for the project's REST and Storage.

   A small build of the made-up sample (fixtures/transfer/sample.mjs) is written to a temporary folder, then uploaded
   to a fake project that keeps its objects and index rows in memory and records every request:
     * the files are checked against the manifest before anything is sent;
     * the key comes from the environment or worker.json and is never in what the tool prints;
     * a dry run writes nothing (and with no key sends nothing at all);
     * the database is asked first: before 0265 nothing is written;
     * the object is uploaded BEFORE the index row names it, gzipped, private, no-store;
     * the row: scope, league 'all', season 'current', team '', current, path <scope>/<token>.<ext>, token, bytes;
     * the same build again changes nothing; a new build keeps the copy the row named until now and deletes older ones;
     * a refused upload leaves the index as it was.

     node supabase/tests/transfer-upload.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sampleCSVs } from './fixtures/transfer/sample.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E = require(path.join(ROOT, 'epinoia', 'scouting', 'transfer', 'engine.js'));
const B = await import('../../tools/build-transfer.mjs');
const U = await import('../../tools/upload-transfer.mjs');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 600))); } };

/* a build in a temporary folder: {dir, manifest} */
const TEMPS = [];
function makeBuild(built) {
  const RAW = E.ingestCSV(sampleCSVs().files);
  const out = B.build(RAW, built);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-upload-'));
  TEMPS.push(dir);
  const manifest = { built,
    transfer: { file: B.FILES.transfer, token: B.tokenOf(out.transfer.gz), bytes: out.transfer.gz.length, raw: out.transfer.bin.length, layout: E.STORE_V },
    tscale: { file: B.FILES.tscale, token: B.tokenOf(out.tscale.gz), bytes: out.tscale.gz.length, raw: Buffer.byteLength(out.tscale.text), layout: 1 } };
  fs.writeFileSync(path.join(dir, B.FILES.transfer), out.transfer.gz);
  fs.writeFileSync(path.join(dir, B.FILES.tscale), out.tscale.gz);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return { dir, manifest };
}

const KEY = 'service-key-SECRET-0123456789', URL0 = 'https://example-project.supabase.co';
/* the fake project */
function project(o) {
  o = o || {};
  const st = { objects: new Map(Object.entries(o.objects || {})), rows: new Map(Object.entries(o.rows || {})), calls: [], verdict: o.verdict || 'signin' };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)) });
  st.fetch = async (url, init) => {
    init = init || {};
    const u = new URL(url), m = (init.method || 'GET').toUpperCase(), h = init.headers || {};
    const call = { m, path: u.pathname, q: u.search, h, auth: h.Authorization === 'Bearer ' + KEY && h.apikey === KEY };
    st.calls.push(call);
    if (u.origin !== URL0) return res(404, 'wrong host');
    if (u.pathname === '/rest/v1/rpc/analytics_check') { call.body = JSON.parse(init.body); return res(200, JSON.stringify(st.verdict)); }
    if (u.pathname === '/rest/v1/analytics_files' && m === 'GET') {
      const scope = u.searchParams.get('scope').replace(/^eq\./, '');
      call.filters = ['league_key', 'season_key', 'team_key'].map(k => k + '=' + u.searchParams.get(k));
      const r = st.rows.get(scope); return res(200, r ? [r] : []);
    }
    if (u.pathname === '/rest/v1/analytics_files' && m === 'POST') {
      const rows = JSON.parse(init.body); call.rows = rows;
      if (o.refuseIndex) return res(400, { code: '23514', message: 'new row violates check constraint "analytics_files_scope_check"' });
      rows.forEach(r => st.rows.set(r.scope, r)); return res(201, '');
    }
    if (u.pathname === '/storage/v1/object/list/analytics' && m === 'POST') {
      const prefix = JSON.parse(init.body).prefix;
      return res(200, Array.from(st.objects.keys()).filter(k => k.startsWith(prefix + '/')).map(k => ({ name: k.slice(prefix.length + 1) })));
    }
    if (u.pathname === '/storage/v1/object/analytics' && m === 'DELETE') {
      const p = JSON.parse(init.body).prefixes; call.prefixes = p; p.forEach(k => st.objects.delete(k)); return res(200, []);
    }
    if (u.pathname.startsWith('/storage/v1/object/analytics/') && m === 'POST') {
      const p = u.pathname.slice('/storage/v1/object/analytics/'.length);
      call.object = p;
      if (o.refuseUpload) return res(400, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type application/gzip is not supported' });
      st.objects.set(p, { body: Buffer.from(init.body), type: h['Content-Type'], cache: h['cache-control'] }); return res(200, { Key: 'analytics/' + p });
    }
    return res(404, 'no route ' + m + ' ' + u.pathname);
  };
  return st;
}
const env = { SUPABASE_URL: URL0, SUPABASE_SERVICE_KEY: KEY };
const quiet = () => { const lines = []; return { log: s => lines.push(String(s)), lines }; };
const writes = st => st.calls.filter(c => c.m !== 'GET' && c.path !== '/rest/v1/rpc/analytics_check');

const A = makeBuild('2026-10-15');
const tok = A.manifest.transfer.token, stok = A.manifest.tscale.token;

console.log('the local files');
{
  const b = U.readBuild(A.dir);
  ok('both files read and checked: hash, bytes, gzip, the TMS2 store, the version 1 scale', b.files.transfer.token === tok && b.files.tscale.token === stok &&
     b.files.transfer.path === 'transfer/' + tok + '.bin.gz' && b.files.tscale.path === 'tscale/' + stok + '.json.gz');
  const bad = makeBuild('2026-10-15');
  fs.writeFileSync(path.join(bad.dir, B.FILES.tscale), fs.readFileSync(path.join(A.dir, B.FILES.transfer)));
  let e1 = null; try { U.readBuild(bad.dir); } catch (e) { e1 = e.message; }
  ok('a file that is not the one the manifest describes is refused (rebuild)', /not the file manifest\.json describes/.test(e1 || ''), e1);
  let e2 = null; try { U.readBuild(path.join(os.tmpdir(), 'no-such-tm-build-' + Date.now())); } catch (e) { e2 = e.message; }
  ok('no build: says to run build-transfer first', /build-transfer\.mjs first/.test(e2 || ''), e2);
}

console.log('\nthe key');
{
  ok('from the environment', JSON.stringify(U.credentials(env, () => { throw new Error('unread'); })) === JSON.stringify({ url: URL0, key: KEY, from: 'environment' }));
  const c = U.credentials({}, () => ({ supabase_url: URL0 + '/', service_key: KEY }));
  ok('else from worker.json (supabase_url, service_key)', c && c.url === URL0 && c.key === KEY && c.from === 'worker.json', c && c.from);
  ok('none: null', U.credentials({}, () => { throw new Error('ENOENT'); }) === null);
}

console.log('\na dry run');
{
  const st = project(), q = quiet();
  const r = await U.run({ dir: A.dir, dry: true, env: { APPDATA: path.join(os.tmpdir(), 'no-appdata-' + Date.now()) }, fetch: st.fetch, log: q.log });
  ok('with no key: both planned and NOT ONE request', r.planned.join() === 'transfer,tscale' && st.calls.length === 0, st.calls);
  const st2 = project(), q2 = quiet();
  const r2 = await U.run({ dir: A.dir, dry: true, env, fetch: st2.fetch, log: q2.log });
  ok('with a key: reads only (the check and the two rows), writes nothing', r2.planned.join() === 'transfer,tscale' && writes(st2).length === 0 &&
     st2.calls.length === 3 && st2.calls.every(c => c.auth), st2.calls.map(c => c.m + ' ' + c.path));
  ok('...and the key is not in anything it printed', !q.lines.concat(q2.lines).some(l => l.includes(KEY)) && q2.lines.some(l => l.includes('example-project.supabase.co')));
}

console.log('\nbefore migration 0265');
{
  const st = project({ verdict: 'scope' }), q = quiet();
  let err = null; try { await U.run({ dir: A.dir, env, fetch: st.fetch, log: q.log }); } catch (e) { err = e.message; }
  ok('the database does not know the scopes: stops, says db push, has written nothing', /0265/.test(err || '') && writes(st).length === 0, err);
}

console.log('\nthe first upload');
const st1 = project();
{
  const q = quiet();
  const r = await U.run({ dir: A.dir, env, fetch: st1.fetch, log: q.log, now: () => Date.parse('2026-10-15T10:00:00Z') });
  ok('both uploaded and indexed', r.done.join() === 'transfer,tscale', r);
  const seq = st1.calls.map(c => c.object ? 'up:' + c.object.split('/')[0] : c.rows ? 'ix:' + c.rows[0].scope : c.prefixes ? 'rm' : null).filter(Boolean);
  ok('each object is uploaded BEFORE the row names it', seq.join() === 'up:transfer,ix:transfer,up:tscale,ix:tscale', seq);
  const o1 = st1.objects.get('transfer/' + tok + '.bin.gz'), o2 = st1.objects.get('tscale/' + stok + '.json.gz');
  ok('the objects: the gzipped bytes exactly, application/gzip, private no-store', o1 && o2 && o1.type === 'application/gzip' && o2.type === 'application/gzip' &&
     o1.cache === 'private, no-store' && Buffer.compare(o1.body, fs.readFileSync(path.join(A.dir, B.FILES.transfer))) === 0 &&
     Buffer.compare(o2.body, fs.readFileSync(path.join(A.dir, B.FILES.tscale))) === 0);
  const row = st1.rows.get('transfer');
  ok('the row: league all, season current, team \'\', no ids, current, its path, token, bytes and layout',
     JSON.stringify(row) === JSON.stringify({ scope: 'transfer', league_key: 'all', season_key: 'current', team_key: '', league_id: null, season_id: null, team_id: null,
       is_current: true, path: 'transfer/' + tok + '.bin.gz', token: tok, layout: E.STORE_V, fv: 0, bytes: A.manifest.transfer.bytes, n_games: null,
       built_at: '2026-10-15T10:00:00.000Z', ci_at: null }), row);
  ok('the rows are read on the platform-wide key (league all, season current, team \'\')',
     st1.calls.filter(c => c.filters).every(c => c.filters.join() === 'league_key=eq.all,season_key=eq.current,team_key=eq.'));
  ok('the check is asked for the transfer scope with no ids', JSON.stringify(st1.calls[0].body) === JSON.stringify({ p_scope: 'transfer', p_league: null, p_season: null, p_team: null }));
  ok('every request carries the key as the service role, and the key is never printed', st1.calls.every(c => c.auth) && !q.lines.some(l => l.includes(KEY)));
}

console.log('\nthe same build again');
{
  const before = st1.calls.length, q = quiet();
  const r = await U.run({ dir: A.dir, env, fetch: st1.fetch, log: q.log });
  ok('nothing new: both skipped, nothing written', r.skipped.join() === 'transfer,tscale' && writes({ calls: st1.calls.slice(before) }).length === 0);
}

console.log('\na new build');
{
  /* a third, older copy sits in the bucket from the build before last */
  st1.objects.set('transfer/00000000000000000000.bin.gz', { body: Buffer.from('old') });
  st1.objects.set('transfer/notes.txt', { body: Buffer.from('not ours') });
  const C2 = makeBuild('2026-10-22');            // the build date is in the store's header, so a new token
  const ntok = C2.manifest.transfer.token;
  ok('(the new build has a new token)', ntok !== tok, ntok);
  const q = quiet(), before = st1.calls.length;
  const r = await U.run({ dir: C2.dir, env, fetch: st1.fetch, log: q.log });
  ok('uploaded and indexed: the row names the new file', r.done.includes('transfer') && st1.rows.get('transfer').token === ntok &&
     st1.objects.has('transfer/' + ntok + '.bin.gz'));
  ok('the copy the row named until now is KEPT (a signed URL handed out for it still works)', st1.objects.has('transfer/' + tok + '.bin.gz'));
  ok('the older copy is deleted, after the row was written; what is not a store file is left alone',
     !st1.objects.has('transfer/00000000000000000000.bin.gz') && st1.objects.has('transfer/notes.txt') && r.deleted.includes('transfer/00000000000000000000.bin.gz'));
  const seq = st1.calls.slice(before).map(c => c.object ? 'up' : c.rows ? 'ix' : c.prefixes ? 'rm' : null).filter(Boolean);
  ok('...in that order: upload, index, delete', seq.slice(0, 3).join() === 'up,ix,rm', seq);
}

console.log('\nrefusals');
{
  const st = project({ refuseUpload: true }), q = quiet();
  let err = null; try { await U.run({ dir: A.dir, env, fetch: st.fetch, log: q.log }); } catch (e) { err = e.message; }
  ok('the bucket refuses the type: stops, names 0265, and the index was never written', /0265/.test(err || '') && !st.calls.some(c => c.rows) && st.rows.size === 0, err);
  const st2 = project({ refuseIndex: true }), q2 = quiet();
  let err2 = null; try { await U.run({ dir: A.dir, env, fetch: st2.fetch, log: q2.log }); } catch (e) { err2 = e.message; }
  ok('the index refuses the scope: stops, names 0265, deletes nothing', /0265/.test(err2 || '') && !st2.calls.some(c => c.prefixes), err2);
  let err3 = null; try { await U.run({ dir: A.dir, env: { APPDATA: path.join(os.tmpdir(), 'no-appdata-' + Date.now()) }, fetch: project().fetch, log: () => {} }); } catch (e) { err3 = e.message; }
  ok('no key and not a dry run: says where the key goes', /SUPABASE_SERVICE_KEY|worker\.json/.test(err3 || ''), err3);
}

console.log('\nthe tool itself');
{
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'upload-transfer.mjs'), 'utf8');
  ok('it never logs the key: the value is used in the request headers alone', !/(log|console\.\w+)\([^;]*(c\.key|\.service_key|SUPABASE_SERVICE_KEY\b(?! from))/.test(src) &&
     (src.match(/c\.key\b/g) || []).length === 2 && /const hdr = \{ apikey: c\.key, Authorization: 'Bearer ' \+ c\.key \}/.test(src));
  ok('it writes to the private bucket only', /BUCKET = 'analytics'/.test(src) && !/snapshots/.test(src));
}

for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* temp */ } }
console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
