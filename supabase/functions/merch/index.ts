// ============================================================================
// merch — takes finished artwork and creates the product in the league's store.
//
//   POST { action: 'publish', leagueId }   push everything with artwork ready
//   POST { action: 'dryrun',  leagueId }   show exactly what WOULD be sent
//
// WHY THIS IS A SERVER AND NOT THE CONSOLE. The artwork is built in the browser
// — rasterising needs a canvas and the console has one — but the store's API
// key must never reach a page. `merch_providers` has no SELECT policy at all,
// so the key is unreadable even to the administrator who set it; only the
// service role, here, can read it. Same rule as the feed endpoints and the
// Discord webhook.
//
// DRY RUN IS NOT A LUXURY. Creating a product is not undoable from here — it
// appears in somebody's real shop, possibly on sale. So the exact requests can
// be read before anything is sent, with the key redacted, and the catalogue
// gaps are named in sentences rather than discovered as a 422 three products
// later.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  requestsFor, readCreated, readUpload, withImageId, missing
} from '../_shared/merchstore.js';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const redact = (h: Record<string, string>) => {
  const o: Record<string, string> = { ...h };
  if (o.Authorization) o.Authorization = 'Bearer ****';
  return o;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } });

  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'sign in first' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: 'expected JSON' }, 400); }
  const leagueId = String(body.leagueId || '');
  const action = String(body.action || 'dryrun');
  if (!leagueId) return json({ error: 'leagueId is required' }, 400);

  // authorisation is the database's answer, asked with the caller's own token
  const { data: mayAdminister } = await caller.rpc('is_league_admin', { p_league: leagueId });
  if (mayAdminister !== true) return json({ error: 'you do not administer that league' }, 403);

  const { data: prov } = await admin.from('merch_providers')
    .select('*').eq('league_id', leagueId).maybeSingle();
  const provider = prov?.provider || 'manual';
  const cfg = {
    apiKey: prov?.api_key || '', hasKey: !!prov?.api_key,
    storeId: prov?.store_id || '', currency: prov?.currency || 'GBP',
    catalogue: prov?.catalogue || {}
  };

  if (provider === 'manual') {
    return json({
      ok: true, provider, published: 0, results: [],
      note: 'This league has no store connected, so there is nothing to publish to. ' +
            'The print files are built and downloadable either way — that is what ' +
            '"manual" means, not that something failed.'
    });
  }
  if (prov && prov.enabled === false) {
    return json({ ok: true, provider, published: 0, results: [],
                  note: 'The store connection is switched off.' });
  }

  const { data: ready } = await admin.from('merch_designs')
    .select('id,kind,team_id,artwork_path,teams(name,short_name)')
    .eq('league_id', leagueId).eq('status', 'artwork').limit(60);
  if (!ready || !ready.length) {
    return json({ ok: true, provider, published: 0, results: [],
                  note: 'Nothing has artwork waiting. Build the designs first.' });
  }

  const base = Deno.env.get('SUPABASE_URL') + '/storage/v1/object/public/merch-print/';
  const results: any[] = [];
  let published = 0;

  for (const d of ready as any[]) {
    const team = d.teams || {};
    const design = {
      kind: d.kind,
      teamName: team.name || 'Club',
      artworkUrl: base + d.artwork_path,
      fileName: (team.short_name || 'club') + '-' + d.kind + '.png'
    };

    const gaps = missing(provider, d.kind, cfg);
    if (gaps.length) {
      results.push({ design: d.id, kind: d.kind, team: design.teamName,
                     skipped: true, missing: gaps });
      if (action === 'publish') {
        await admin.rpc('merch_published', {
          p_design: d.id, p_external_id: null, p_external_url: null,
          p_price: null, p_currency: null,
          p_error: 'not published — still needs: ' + gaps.join('; ')
        });
      }
      continue;
    }

    const steps = requestsFor(provider, design, cfg);

    if (action === 'dryrun') {
      results.push({
        design: d.id, kind: d.kind, team: design.teamName,
        requests: steps.map((s: any) => ({
          step: s.step, method: s.method, url: s.url,
          headers: redact(s.headers), body: s.body
        }))
      });
      continue;
    }

    // ---- for real ----
    let imageId: string | null = null;
    let created: { id: string | null; url: string | null } = { id: null, url: null };
    let failure: string | null = null;

    for (const s of steps as any[]) {
      const payload = imageId ? withImageId(s.body, imageId) : s.body;
      let res: Response, text = '';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25_000);
        res = await fetch(s.url, {
          method: s.method, headers: s.headers,
          body: JSON.stringify(payload), signal: ctrl.signal, redirect: 'error'
        });
        clearTimeout(timer);
        text = await res.text();
      } catch (e) {
        failure = s.step + ': ' + String(e).slice(0, 200);
        break;
      }
      if (!res.ok) {
        failure = s.step + ': HTTP ' + res.status + ' ' + text.slice(0, 260);
        break;
      }
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch (_) { /* some steps answer empty */ }
      if (s.yields === 'imageId') {
        imageId = readUpload(parsed);
        if (!imageId) { failure = 'the image upload returned no id'; break; }
      }
      if (s.step === 'create') {
        created = readCreated(provider, parsed);
        /* A 200 with nothing usable in it is a failure. Recording it as a
           success would fill the catalogue with rows pointing nowhere, which
           is worse than an error somebody can see. */
        if (!created.id) { failure = 'the store accepted the product but returned no id'; break; }
      }
    }

    const c = (cfg.catalogue as any)[d.kind] || {};
    await admin.rpc('merch_published', {
      p_design: d.id,
      p_external_id: created.id, p_external_url: created.url,
      p_price: failure ? null : Math.round(c.price || 0),
      p_currency: cfg.currency, p_error: failure
    });
    if (!failure) published++;
    results.push({ design: d.id, kind: d.kind, team: design.teamName,
                   ok: !failure, external: created, error: failure });
  }

  if (action === 'publish') {
    await admin.from('merch_providers').update({
      last_run_at: new Date().toISOString(),
      last_error: results.find((r) => r.error)?.error || null
    }).eq('league_id', leagueId);
  }

  return json({ ok: true, provider, action, considered: ready.length, published, results });
});
