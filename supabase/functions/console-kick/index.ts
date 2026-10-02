// ============================================================================
// console-kick — STARTS THE CONSOLE'S WORKER THE MOMENT A JOB IS QUEUED (2026-10-02, migration 0217).
//
//   POST {}   a signed-in administrator's console, right after it queues "fill in an older season" (league console)
//             or "start a league again" (platform console)
//     -> { started: true, at } | { started: false, why[, at] }
//
// The worker is .github/workflows/console-jobs.yml. Without this function the live lane starts it within two
// minutes of a request (scripts/ingest/console_kick.py), and its own cron is the floor; with it, the press of the
// button does. A console that cannot reach it (not deployed, not set up) says the worker will be started shortly,
// which is still true.
//
// WHAT IT TRUSTS. The caller's own token decides what they may see: their client reads the queued requests, and row
// level security answers (a league's administrators see their league's backfills, the platform's every reset). With
// nothing visible, nothing is started. The GitHub token is this function's secret alone:
//   GITHUB_DISPATCH_TOKEN   a fine-grained token with "Actions: read and write" on the repository, nothing else
//   GITHUB_REPO             owner/name of the repository (e.g. MadvillainQuas/website)
//   GITHUB_REF              the branch the workflow runs from (default main)
// The service role writes one thing: dispatched_at on the queued requests, so every console says when.
//
// SAFE TO PRESS ANY NUMBER OF TIMES: requests started in the last three minutes are not started again.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const TOKEN = Deno.env.get('GITHUB_DISPATCH_TOKEN') || '';
const REPO = Deno.env.get('GITHUB_REPO') || '';
const REF = Deno.env.get('GITHUB_REF') || 'main';
const WORKFLOW = 'console-jobs.yml';
const AGAIN_MS = 3 * 60 * 1000;
const TABLES = ['season_backfills', 'league_resets'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ started: false, why: 'POST only' }, 405);
  if (!TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) return json({ started: false, why: 'not set up' });
  try {
    /* what this caller may see is what they may start */
    const caller = createClient(URL_, ANON, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      auth: { persistSession: false }
    });
    const seen: { table: string, id: string, dispatched_at: string | null }[] = [];
    for (const table of TABLES) {
      const { data } = await caller.from(table).select('id,dispatched_at').eq('state', 'queued');
      (data || []).forEach((r: any) => seen.push({ table, id: r.id, dispatched_at: r.dispatched_at || null }));
    }
    if (!seen.length) return json({ started: false, why: 'nothing queued' });
    const now = Date.now();
    const recent = seen.map(r => (r.dispatched_at ? Date.parse(r.dispatched_at) : 0)).filter(t => t && now - t < AGAIN_MS);
    if (recent.length) return json({ started: false, why: 'already started', at: new Date(Math.max(...recent)).toISOString() });

    const gh = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
                 'User-Agent': 'epinoia-console-kick', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: REF })
    });
    if (gh.status !== 204) return json({ started: false, why: 'GitHub answered ' + gh.status }, 502);

    const at = new Date().toISOString();
    const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    for (const table of TABLES) {
      const ids = seen.filter(r => r.table === table).map(r => r.id);
      if (ids.length) await admin.from(table).update({ dispatched_at: at }).in('id', ids).eq('state', 'queued');
    }
    return json({ started: true, at });
  } catch (e) {
    return json({ started: false, why: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
