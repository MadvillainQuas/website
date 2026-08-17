/* ============================================================================
   SOCIALS REFRESH — the four newest Instagram posts for one league, or all.

   WHY THIS IS A SERVER FUNCTION and not a fetch from the page: the Graph API
   needs a long-lived access token, and a token in a browser is a token
   anybody can read and use until it expires. It lives in league_socials,
   which has no public read policy at all, and only this function — running
   with the service role — ever sees it.

   TWO WAYS IN:
     POST { leagueId }   an administrator pressing "fetch the newest now".
                         Their JWT is checked against is_league_admin.
     POST { all: true }  a scheduled run, authorised by the cron secret.
                         Every league with a token, failures isolated.

   A FAILURE IS RECORDED, NOT THROWN AWAY. An expired token is the normal way
   this breaks and it breaks silently — the page keeps showing the pinned
   four — so the reason is written to refresh_error where the console shows
   it, rather than only existing in a log nobody opens.
   ============================================================================ */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s,
    headers: { ...CORS, 'Content-Type': 'application/json' } });

/* Instagram returns a permalink like https://www.instagram.com/p/CODE/ — the
   embed address is built from the CODE, so it is extracted here rather than
   the whole URL being stored and trusted later. */
function shortcode(permalink: string): string | null {
  const m = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(permalink || '');
  return m ? m[1] : null;
}

async function fetchNewest(igUserId: string, token: string) {
  const u = new URL(`https://graph.instagram.com/${igUserId}/media`);
  u.searchParams.set('fields', 'id,permalink,caption,media_type,timestamp');
  u.searchParams.set('limit', '8');       // over-fetch: stories and some types are not embeddable
  u.searchParams.set('access_token', token);

  const r = await fetch(u.toString());
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const m of (j.data || [])) {
    const code = shortcode(m.permalink);
    if (!code) continue;
    out.push({ code, permalink: m.permalink, caption: (m.caption || '').slice(0, 200),
               type: m.media_type, ts: m.timestamp });
    if (out.length === 4) break;
  }
  return out;
}

async function refreshOne(admin: ReturnType<typeof createClient>, row: any) {
  try {
    if (!row.access_token || !row.ig_user_id) {
      throw new Error('no access token or IG user id stored');
    }
    const posts = await fetchNewest(row.ig_user_id, row.access_token);
    await admin.rpc('store_socials_cache',
      { p_league: row.league_id, p_posts: posts, p_error: null });
    return posts.length;
  } catch (e) {
    /* The cache is deliberately NOT cleared. Last month's four beat an empty
       section, and the page already labels how old they are. */
    await admin.rpc('store_socials_cache',
      { p_league: row.league_id, p_posts: null, p_error: String((e as Error).message).slice(0, 300) });
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const body = await req.json().catch(() => ({}));
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // ---- the scheduled sweep ------------------------------------------------
  if (body.all) {
    const secret = req.headers.get('x-cron-secret') || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'refused' }, 401);

    const { data: rows } = await admin.from('league_socials')
      .select('league_id,access_token,ig_user_id')
      .not('access_token', 'is', null).eq('auto', true);

    let ok = 0; const failed: string[] = [];
    for (const row of (rows || [])) {
      /* One league's expired token must not stop the rest, which is the whole
         reason this loop catches rather than awaiting a Promise.all. */
      try { await refreshOne(admin, row); ok++; }
      catch (e) { failed.push(row.league_id + ': ' + (e as Error).message); }
    }
    return json({ refreshed: ok, failed });
  }

  // ---- one league, pressed by its administrator ---------------------------
  const leagueId = body.leagueId;
  if (!leagueId) return json({ error: 'leagueId required' }, 400);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'sign in first' }, 401);

  /* Authorised as the CALLER, not as the service role: a client made with the
     user's JWT runs is_league_admin against them, so this function cannot be
     used to refresh somebody else's league. */
  const asUser = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: 'Bearer ' + jwt } },
    auth: { persistSession: false }
  });
  const { data: allowed, error: whoErr } =
    await asUser.rpc('is_league_admin', { p_league: leagueId });
  if (whoErr || !allowed) return json({ error: 'you do not administer that league' }, 403);

  const { data: rows } = await admin.from('league_socials')
    .select('league_id,access_token,ig_user_id')
    .eq('league_id', leagueId).limit(1);
  const row = (rows || [])[0];
  if (!row) return json({ error: 'no socials set up for that league' }, 404);

  try {
    const n = await refreshOne(admin, row);
    return json({ count: n });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
