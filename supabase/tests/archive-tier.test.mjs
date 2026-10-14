// THE ARCHIVE TIER, READ BY THE PAGES (0262): an archived game has no rows in game_events; its log comes from
// snapshots/events/<id>.json as it always has, and - without that file - from feed/archive/<id>.json.gz, unpacked in
// the reader's session. Either way the rows are the ones the database held, in seq order, so nothing a page works out
// from a log changes.
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail) => { if (cond) { PASS++; console.log('  PASS  ' + name); } else { FAIL++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); } };

globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://db.example', supabaseAnonKey: 'anon' };
const D = require(path.join(ROOT, 'epinoia/data.js'));

const G = '0b0e7a1c-1111-4c2d-9e8f-000000000001';
const ROWS = Array.from({ length: 1200 }, (_, i) => ({ id: 9000 + i, game_id: G, seq: 1200 - i, t: 'shot', team: i % 2, pid: 7,
  period: 1, clock: 600000 - i, payload: { made: i % 3 === 0 }, created_at: '2025-03-01T19:00:00+00:00', created_by: null }));
const ARCHIVE = { v: 2, game: G, rows: ROWS, page: { games: [{ id: G }] }, meta: {}, extra: {} };

const asked = [];
let plainThere = false, dbRows = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  asked.push(u);
  if (u.includes('/snapshots/events/')) {
    if (!plainThere) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ v: 1, game: G, rows: ROWS.map(({ id, created_by, ...r }) => r).sort((a, b) => a.seq - b.seq) }), { status: 200 });
  }
  if (u.includes('/feed/archive/')) return new Response(gzipSync(Buffer.from(JSON.stringify(ARCHIVE))), { status: 200, headers: { 'content-type': 'application/gzip' } });
  if (u.includes('/rest/v1/game_events')) return new Response(JSON.stringify(dbRows), { status: 200, headers: { 'content-range': '0-0/0' } });
  return new Response('[]', { status: 200 });
};

console.log('\nan archived game read by a page');
const a = await D.archive(G);
ok('the archive is fetched and unpacked (gzip, in the session)', a && a.game === G && a.rows.length === 1200);
ok('...once per page: asked again, it is not fetched again', (await D.archive(G)) === a && asked.filter(u => u.includes('/feed/archive/')).length === 1);
const log = D.archiveLog(a);
ok("its log in the pages' columns, in seq order", log.length === 1200 && log[0].seq === 1 && log[1199].seq === 1200
   && Object.keys(log[0]).sort().join() === 'clock,created_at,game_id,payload,period,pid,seq,t,team');
const ev = await D.events([G]);
const flat = Array.isArray(ev[0]) ? ev[0] : ev;
ok('events() with no event file: the archive answers, every row', flat.length === 1200 && flat[0].seq === 1, String(flat.length));
ok('...and the database is never asked for its (absent) rows', !asked.some(u => u.includes('/rest/v1/game_events')));

console.log('\nwith the event file there, nothing changes');
plainThere = true; asked.length = 0;
const D2 = (() => { delete require.cache[require.resolve(path.join(ROOT, 'epinoia/data.js'))]; return require(path.join(ROOT, 'epinoia/data.js')); })();
const ev2 = await D2.events([G]);
const flat2 = Array.isArray(ev2[0]) ? ev2[0] : ev2;
ok('the file is read, as before', flat2.length === 1200 && asked.some(u => u.includes('/snapshots/events/')));
ok('...and the archive is not fetched at all', !asked.some(u => u.includes('/feed/archive/')));
ok('the same rows either way', JSON.stringify(flat2.map(r => [r.seq, r.t, r.team, r.pid, r.clock])) === JSON.stringify(flat.map(r => [r.seq, r.t, r.team, r.pid, r.clock])));

console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
