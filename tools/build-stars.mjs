/* ============================================================================
   build-stars.mjs - HOME'S PODIUMS (the 'stars_global' snapshot), built in GitHub Actions.

     node tools/build-stars.mjs [--dry-run]        SUPABASE_URL, SUPABASE_SERVICE_KEY

   WHY HERE AND NOT IN THE SNAPSHOTS FUNCTION. The function built them first in every call until
   2026-10-08, when HOME's podiums over every league - EpinoiaStars.global(), the very function HOME runs -
   took 3.5 s of CPU and ~300 MB of memory (measured in Node on 8 Oct 2026, 2,725 finished games). An Edge
   Function has about 2 s of CPU and 256 MB, so every call since 3 October died there with
   WORKER_RESOURCE_LIMIT, before the event logs, the position files and the crests it builds after them.
   Built here, as the big seasons are (tools/build-seasons.mjs, big-seasons.yml, hourly).

   THE SAME ROW AS BEFORE: public.snapshots key 'stars_global', token = the anchor (the latest finished
   game's tip-off), data = { week, month, anchor } with each podium row's window as its key. Built as a
   signed-out visitor through the page's own data.js and stars.js, so it holds only what anybody could
   read; written with the service key. Rebuilt when the anchor moves or after an hour, as the function did.
   HOME uses it only when its token is the anchor HOME reads itself, and works the podiums out the old way
   otherwise, so between two builds a page is slower, never wrong.
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
const STARS_MAX_AGE_MS = 60 * 60 * 1000;                                 // as the function: an hour, anchor or not

/* the page's own modules, as a browser loads them: globals first, then the files */
function load(url) {
  globalThis.window = globalThis;
  globalThis.EPINOIA_CONFIG = { supabaseUrl: url, supabaseAnonKey: PUBLISHABLE };
  globalThis.EpinoiaBPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
  globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
  const D = require(path.join(ROOT, 'epinoia', 'data.js'));
  globalThis.EpinoiaData = D;
  const ST = require(path.join(ROOT, 'epinoia', 'stars.js'));
  globalThis.EpinoiaStars = ST;
  return { D, ST };
}

/* a podium row's window back to its key (the function's unrevive): the page revives it */
const unrevive = row => (row ? { ...row, w: row.w && row.w.key ? row.w.key : row.w } : null);

/* opts: { url, serviceKey, fetch, dryRun, log, now } - resolves to what was done */
export async function run(opts) {
  const o = opts || {};
  const log = o.log || (m => console.log(m));
  const url = String(o.url || '').replace(/\/+$/, '');
  if (!url || !o.serviceKey) { log('no SUPABASE_URL / SUPABASE_SERVICE_KEY: nothing to do'); return { skipped: 'no keys' }; }
  if (o.fetch) globalThis.fetch = o.fetch;
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const { D, ST } = load(url);
  const svc = { apikey: o.serviceKey, Authorization: 'Bearer ' + o.serviceKey };
  const rest = async (p, init) => {
    const r = await fetch(url + '/rest/v1/' + p, Object.assign({}, init, { headers: Object.assign({ Accept: 'application/json' }, svc, (init || {}).headers || {}) }));
    if (!r.ok) throw new Error(p.split('?')[0] + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };

  /* the anchor, as a signed-out visitor reads it (the function's own query) */
  const anchorRows = await D.get('games?select=tipoff_at&status=eq.final&competition_id=not.is.null' +
    '&tipoff_at=lte.' + encodeURIComponent(new Date(now()).toISOString()) + '&order=tipoff_at.desc&limit=1');
  const anchor = anchorRows && anchorRows[0] && anchorRows[0].tipoff_at;
  if (!anchor) { log('stars: no finals'); return { stars: 'no finals' }; }
  const held = ((await rest('snapshots?key=eq.stars_global&select=token,built_at')) || [])[0];
  if (held && held.token === anchor && now() - Date.parse(held.built_at) < STARS_MAX_AGE_MS) {
    log(`stars: current (anchor ${anchor}, built ${held.built_at})`);
    return { stars: 'current', anchor };
  }
  const t0 = Date.now();
  const res = await ST.global({ now: new Date(now()), snapshot: false });
  if (!res || res.anchor !== anchor) { log('stars: the anchor moved while building; the next run builds it'); return { stars: 'anchor moved', anchor }; }
  const data = { week: unrevive(res.week), month: unrevive(res.month), anchor };
  const counts = ['week', 'month'].map(k => `${k} ${((data[k] || {}).top || []).length}`).join(', ');
  if (o.dryRun) { log(`stars: would write the podiums for anchor ${anchor} (${counts}; ${Date.now() - t0} ms)`); return { stars: 'dry run', anchor }; }
  await rest('snapshots?on_conflict=key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: 'stars_global', competition_id: null, token: anchor, data, built_at: new Date(now()).toISOString() })
  });
  log(`stars: built for anchor ${anchor} (${counts}; ${Date.now() - t0} ms)`);
  return { stars: 'built', anchor };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY, dryRun: process.argv.includes('--dry-run') })
    .catch(e => { console.error('stars: ' + (e && e.message || e)); process.exit(1); });
}
