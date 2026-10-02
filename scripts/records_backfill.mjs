/* ============================================================================
   THE RECORDS BACKFILL, PACED (migration 0219, docs/performance-audit.md "Backfill").

   Calls rpc/records_backfill_step with the service key: each call builds ONE competition's records (never waiting
   for a finalise's lock), then this waits a moment and asks for the next, until the database answers "left": 0, or
   the time budget is spent (a second run carries on: a built competition is skipped). One line a step:

     step 12  built 1 (CIBA… 256 games) in 214 ms  ·  41 left  ·  busy 0

     node scripts/records_backfill.mjs                       # pause 1.5 s between steps, stop after 20 minutes
     node scripts/records_backfill.mjs --pause 3 --max-minutes 10
     node scripts/records_backfill.mjs --once                # one step, and say what is left

   Env SUPABASE_URL and SUPABASE_SERVICE_KEY (sent as apikey and Authorization: Bearer). Nothing else is read or
   written. Before 0219 is pushed the function is not there: it says so and exits 0 (the nightly run stays quiet).
   A failed call is retried twice (after 5 and 15 s); a third failure stops the run with exit code 1.

   Importable without side effects: run() takes its fetch, sleep and clock, and main() runs only when this file is
   the one node was asked to execute.
   ============================================================================ */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const a = { pause: 1.5, maxMinutes: 20, once: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--pause') a.pause = Math.max(0.2, Number(argv[++i]) || a.pause);
    else if (x === '--max-minutes') a.maxMinutes = Math.max(0.1, Number(argv[++i]) || a.maxMinutes);
    else if (x === '--once') a.once = true;
    else throw new Error('unknown argument: ' + x);
  }
  return a;
}

/* run({ url, key, pause, maxMinutes, once }, { fetch, sleep, now, log }) -> { steps, built, left, ready, stopped }
   stopped: 'done' | 'budget' | 'once' | 'missing' | 'failed' */
export async function run(o, io) {
  const { fetch, sleep, now, log } = io;
  const t0 = now();
  const budget = o.maxMinutes * 60000;
  const endpoint = o.url.replace(/\/+$/, '') + '/rest/v1/rpc/records_backfill_step';
  const headers = { apikey: o.key, Authorization: 'Bearer ' + o.key, 'Content-Type': 'application/json' };
  const out = { steps: 0, built: 0, left: null, ready: false, stopped: null };
  for (;;) {
    let r = null, err = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) { log(`  retrying in ${attempt === 1 ? 5 : 15} s (${err})`); await sleep(attempt === 1 ? 5000 : 15000); }
      try {
        const res = await fetch(endpoint, { method: 'POST', headers, body: '{}' });
        const text = await res.text();
        if (res.status === 404 && /PGRST202|records_backfill_step/.test(text)) {
          log('records_backfill_step is not in the database yet: push the migrations (0219) first. Nothing done.');
          out.stopped = 'missing'; return out;
        }
        if (!res.ok) { err = 'HTTP ' + res.status + ' ' + text.slice(0, 200); continue; }
        r = JSON.parse(text); break;
      } catch (e) { err = String(e && e.message || e); }
    }
    if (!r) { log('stopped: ' + err); out.stopped = 'failed'; return out; }
    out.steps++;
    out.built += r.built || 0;
    if (r.left != null) out.left = r.left;
    out.ready = !!r.ready;
    log(`step ${out.steps}  ` + (r.built ? `built 1 (${String(r.competition).slice(0, 8)}…, ${r.games} games) in ${r.ms} ms` : `built nothing (${r.ms} ms)`) +
        `  ·  ${r.left == null ? '?' : r.left} left  ·  busy ${r.busy || 0}` + (r.ready ? '  ·  ready' : ''));
    if (r.left === 0) { out.stopped = 'done'; return out; }
    if (o.once) { out.stopped = 'once'; return out; }
    /* a step that found every candidate busy (a finalise at work there) waits a little longer */
    const wait = Math.round(o.pause * 1000 * (r.built ? 1 : 2));
    if (now() - t0 + wait > budget) { log(`time budget (${o.maxMinutes} min) spent: run again to carry on`); out.stopped = 'budget'; return out; }
    await sleep(wait);
  }
}

async function main() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed'); process.exit(2); }
  const a = parseArgs(process.argv.slice(2));
  console.log(`records backfill: one competition a step, ${a.pause} s between steps, at most ${a.maxMinutes} min`);
  const r = await run({ url, key, ...a }, {
    fetch: globalThis.fetch, sleep: ms => new Promise(f => setTimeout(f, ms)), now: () => Date.now(),
    log: s => console.log(s)
  });
  console.log(`${r.steps} step(s), ${r.built} competition(s) built, ${r.left == null ? '?' : r.left} left` +
              (r.ready ? ', records ready: the pages read the kept records' : '') + ` (${r.stopped})`);
  if (r.stopped === 'failed') process.exitCode = 1;
}

/* run only when executed, never when imported by a test */
const isMain = (() => {
  if (!process.argv[1]) return false;
  const norm = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  try { return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]); } catch (_) { return false; }
})();
if (isMain) await main();
