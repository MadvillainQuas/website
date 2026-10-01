// ============================================================================
// analytics-file — HANDS OUT ONE WHAT WINS FILE, IF THE DATABASE SAYS SO (docs/what-wins-model.md §10.1, A.2).
//
//   POST {scope: 'wins'|'fo'|'club'|'pos', league?, season?, team?, refresh?}
//     -> {url (signed, 120 s), token, bytes, built_at, layout, expires_in, n_games, pending, ci_at}
//
// Deployed with --no-verify-jwt (supabase/config.toml): the site's publishable key is not a JWT, so the gateway
// cannot be what guards this. The function guards itself, and the rules are all in _shared/analyticsfile.ts
// handle(), which this file only wires to supabase-js and Deno.serve:
//   * analytics_check runs with the CALLER's token (the anon key and, signed in, their JWT);
//   * analytics_take (service role) counts it: 60 an hour signed in, 20 signed out;
//   * the file comes from the private 'analytics' bucket as a 120-second signed URL, never through here.
// RECALCULATE runs EpinoiaWinModel.update on the new games: the model's shared copy, with the statistics it uses,
// imported for their side effect (features.js reads the engine and the calculators off globalThis when called;
// winstats.js before winsim.js, which finds EpinoiaWinStats on globalThis; bpm.js so positions, lineups and P2f
// match the builder's).
//
// Secrets: ANALYTICS_SALT (hashes a signed-out caller's address for the limit; never stored raw). Optional:
// ANALYTICS_IP_HEADER / ANALYTICS_XFF_HOPS (the ONE header, and its entry from the right, that carries the address the
// edge saw; default x-forwarded-for, last entry; a signed-out request without it is asked to sign in), ANALYTICS_REFRESH_BUDGET_MS,
// ANALYTICS_REFRESH_MAX_GAMES, ANALYTICS_REFRESH_MAX_STORE_BYTES.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handle } from '../_shared/analyticsfile.ts';
import '../_shared/engine.js';
import '../_shared/possessions.js';
import '../_shared/situations.js';
import '../_shared/shotclock.js';
import '../_shared/features.js';
import '../_shared/winstats.js';
import '../_shared/winsim.js';
import '../_shared/bpm.js';
import '../_shared/winmodel.js';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/* the same preflight handle() gives, stated here too so the function's own policy can be read (and checked by
   supabase/tests/cors.test.mjs) where every other function states it */
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve((req) => req.method === 'OPTIONS' ? new Response('ok', { headers: { ...cors, 'Cache-Control': 'no-store' } }) : handle(req, {
  callerClient: (auth) => createClient(URL_, ANON, {
    global: { headers: auth ? { Authorization: auth } : {} },
    auth: { persistSession: false }
  }),
  admin,
  env: Deno.env,
  sha256,
  update: (store, delta, opts) => (globalThis as any).EpinoiaWinModel.update(store, delta, opts),
  validate: (file, scope, o) => (globalThis as any).EpinoiaWinModel.validate(file, scope, o),
  stintGaps: (rows, stints) => (globalThis as any).EpinoiaWinModel.stintGaps(rows, stints)
}));
