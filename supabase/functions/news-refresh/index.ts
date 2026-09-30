/* ============================================================================
   NEWS REFRESH - the "Load articles now" button's server side.

     POST /functions/v1/news-refresh      { source: "<slug>" }   one publisher
     POST /functions/v1/news-refresh      { all: true }          every publisher on (platform administrators)

   -> 200 { ok, slug, name, added, updated, total, fetched, last_error, took_ms }
      4xx/5xx { ok: false, code, error, retry_after? }   code: auth forbidden no_source bad_request off rate rate_caller
                                                              blocked unreachable not_feed too_big server

   WHY AN EDGE FUNCTION. The half-hourly reader needs the service key, which a browser must never hold, and a GitHub
   token to start that workflow would be no safer. This runs where the service key already lives, checks the caller's own
   JWT against the database's own rules (is_platform_admin, can_manage_news_sources: the console's), and reads only the
   address the database holds for the source. Everything it decides is in ../_shared/newsrefresh.js (and the parser, held to
   the same fixtures as scripts/news/fetch_feeds.py, in ../_shared/newsfeed.js): this file is the wiring.

   NEEDS: nothing new. It uses the project's own SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, and the
   tables and functions of migration 0194 (no migration of its own). Deploy: npx supabase functions deploy news-refresh
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHandler } from '../_shared/newsrefresh.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || SERVICE;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
/* the caller, as the caller: their own token on every question the database is asked about them */
const asUser = (token: string) => createClient(URL_, ANON, { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false } });

/* BELOW THE HANDLER'S DOOR ON PURPOSE (cors.test.mjs): OPTIONS is answered before anything that authenticates, and
   everything that authenticates is wired below it. */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try { return await handle(req); }
  catch (e) {
    return new Response(JSON.stringify({ ok: false, code: 'server', error: 'the refresh failed: ' + String((e as Error).message || e).slice(0, 200) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});

/* ------------------------------------------------------------------ wiring -- */
const SOURCE_COLS = 'id,slug,name,feed_url,league_id,enabled';

/* the addresses a name resolves to, to refuse one that resolves to a private address. Null: this runtime cannot say (the
   literal address checks and the redirect checks still hold); set NEWS_REFRESH_DNS_STRICT=1 to refuse then instead. */
async function resolve(host: string): Promise<string[] | null> {
  // deno-lint-ignore no-explicit-any
  const d: any = Deno;
  if (typeof d.resolveDns !== 'function') return null;
  try {
    const out: string[] = [];
    for (const type of ['A', 'AAAA']) {
      try { out.push(...(await d.resolveDns(host, type))); } catch (e) {
        if (/NotCapable|PermissionDenied|NotSupported|not implemented/i.test(String(e && (e.name || e.message || e)))) return null;
      }
    }
    return out;
  } catch (_) { return null; }
}

const handle = createHandler({
  cors: CORS,
  fetch: (u: string, init: RequestInit) => fetch(u, init),
  resolve,
  strictDns: Deno.env.get('NEWS_REFRESH_DNS_STRICT') === '1',
  isService: (token: string) => token === SERVICE,
  getUser: async (token: string) => {
    const { data: { user } } = await asUser(token).auth.getUser();
    return user ? { id: user.id } : null;
  },
  isPlatformAdmin: async (token: string) => {
    const { data, error } = await asUser(token).rpc('is_platform_admin');
    return !error && data === true;
  },
  canManage: async (token: string, leagueId: string) => {
    const { data, error } = await asUser(token).rpc('can_manage_news_sources', { p_league: leagueId });
    return !error && data === true;
  },
  db: {
    source: async (slug: string) => {
      const { data } = await admin.from('news_sources').select(SOURCE_COLS).eq('slug', slug).maybeSingle();
      return data || null;
    },
    sources: async () => {
      const { data } = await admin.from('news_sources').select(SOURCE_COLS).eq('enabled', true).order('name');
      return data || [];
    },
    existing: async (sourceId: string, guids: string[]) => {
      const { data, error } = await admin.from('news_items').select('guid,url,title,summary,image_url,author,tags')
        .eq('source_id', sourceId).in('guid', guids);
      if (error) throw new Error(error.message);
      // deno-lint-ignore no-explicit-any
      return new Map((data || []).map((r: any) => [r.guid, r]));
    },
    upsert: async (rows: unknown[]) => {
      const { error } = await admin.from('news_items').upsert(rows, { onConflict: 'source_id,guid' });
      if (error) throw new Error(error.message);
    },
    count: async (sourceId: string) => {
      const { count } = await admin.from('news_items').select('id', { count: 'exact', head: true }).eq('source_id', sourceId);
      return count || 0;
    },
    mark: async (sourceId: string, fields: Record<string, unknown>) => {
      const { error } = await admin.from('news_sources').update(fields).eq('id', sourceId);
      if (error) throw new Error(error.message);
    },
    lastRefresh: async (sourceId: string) => {
      const { data } = await admin.from('audit_log').select('created_at').eq('action', 'news_refresh').eq('subject', 'news_source')
        .eq('subject_id', sourceId).order('created_at', { ascending: false }).limit(1);
      return data && data[0] ? data[0].created_at : null;
    },
    callerCalls: async (userId: string, sinceIso: string) => {
      const { data } = await admin.from('audit_log').select('created_at').eq('action', 'news_refresh_call').eq('actor', userId)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(50);
      // deno-lint-ignore no-explicit-any
      return (data || []).map((r: any) => r.created_at);
    },
    audit: async (row: Record<string, unknown>) => {
      const { error } = await admin.from('audit_log').insert(row);
      if (error) throw new Error(error.message);
    }
  }
});

