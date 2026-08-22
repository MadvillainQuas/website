/* ============================================================================
   MEMBERSHIP SYNC — pull a federation's register into the platform.

   The awkward half of any federation integration is confined to an adapter in
   _shared/membership.js; this is the half that talks to our own database, and
   it is deliberately dull.

   WHY IT RUNS HERE AND NOT IN A BROWSER. Three reasons, and any one of them
   would be enough:

     · a federation's API key must never reach a browser, and a league
       administrator's laptop is a browser
     · it writes to tables no browser session has a policy for — creating a
       player because a register says so is not a thing a signed-in user may do
     · a nightly run has nobody sitting in front of it

   DRY RUN IS THE DEFAULT SHAPE OF THE FIRST CONVERSATION. Nothing about a
   federation's data is knowable in advance — how their names are cased, whether
   the club id in their export matches the one the league uses, how many of
   their members this league has never heard of. `?dry=1` produces exactly the
   report a real run would, and writes nothing at all, which is what makes the
   first run of an integration a discussion rather than a cleanup.

     POST /functions/v1/membership-sync
       { source: 'basketball-england',
         leagueId?: uuid,
         clubs?: ['1234','5678'],      // omit to use every linked team
         since?: '2026-08-01',
         dry?: true }

   Authorisation is the service role key, or a platform administrator's JWT.
   A league administrator cannot run this: a sync writes to the player register
   itself, which is platform-wide, and a body that governs one league should
   not be able to rename a player who also turns out in another.
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runSync, restAdapter, tableAdapter } from '../_shared/membership.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2),
    { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/* --------------------------------------------------------------- adapter -- */
/* Built from what the source row says about itself, so adding a federation is
   a row and a config object rather than a deploy — until one of them needs a
   shape none of these cover, at which point it gets a file of its own and this
   switch gains a case. */
function buildAdapter(source: any, body: any) {
  const cfg = source.config || {};
  const kind = cfg.adapter || (source.base_url ? 'rest' : 'table');

  if (kind === 'rest') {
    if (!source.base_url) throw new Error('this source has no base_url');
    const secret = cfg.secret_env ? Deno.env.get(cfg.secret_env) : null;
    if (cfg.secret_env && !secret) {
      throw new Error('the secret ' + cfg.secret_env + ' is not set on this project');
    }
    return restAdapter({
      id: source.id, label: source.label, baseUrl: source.base_url,
      headers: secret ? { [cfg.auth_header || 'Authorization']:
        (cfg.auth_prefix ?? 'Bearer ') + secret } : {},
      memberPath: (eid: string) =>
        (cfg.member_path || '/members/{id}').replace('{id}', encodeURIComponent(eid)),
      clubPath: (cid: string) =>
        (cfg.club_path || '/clubs/{id}/members').replace('{id}', encodeURIComponent(cid)),
      /* field_map turns their names into ours without a line of code per
         federation: {"externalId":"membershipNo","lastName":"surname"} */
      map: (x: any) => {
        const fm = cfg.field_map || {};
        const out: any = { raw: x };
        for (const [ours, theirs] of Object.entries(fm)) out[ours] = x[theirs as string];
        return Object.keys(fm).length ? out : x;
      }
    });
  }

  if (kind === 'table') {
    /* A register that arrives as a spreadsheet. The rows come in the request,
       already parsed, because a file upload belongs to the admin page and this
       function should not learn to read CSV as well. */
    if (!Array.isArray(body.rows)) throw new Error('a table source needs rows in the request');
    return tableAdapter({ id: source.id, label: source.label, rows: body.rows });
  }

  throw new Error('unknown adapter kind: ' + kind);
}

/* ----------------------------------------------------------------- store -- */
/* The one place this function touches our own tables. Kept behind the same
   interface the runner is written against, so the runner has no idea it is
   talking to Postgres and can be tested against a plain object. */
function makeStore(db: any) {
  return {
    async playerByExternalId(sourceId: string, externalId: string) {
      const { data } = await db.from('external_identities')
        .select('entity_id, players:entity_id(id, first_name, last_name, birth_year)')
        .eq('source_id', sourceId).eq('entity_type', 'player')
        .eq('external_id', externalId).maybeSingle();
      return data?.players ?? null;
    },

    async playerByName(first: string, last: string, birthYear: number | null) {
      /* Narrow on purpose: name AND birth year. Matching on a name alone would
         merge two players called J Smith the first time a register is
         connected, and unpicking that afterwards means unpicking their
         statistics too. */
      if (!last || birthYear == null) return null;
      const { data } = await db.from('players')
        .select('id, first_name, last_name, birth_year')
        .ilike('last_name', last).ilike('first_name', first)
        .eq('birth_year', birthYear).limit(2);
      /* Two matches is not a match. It is a question for a person. */
      return (data && data.length === 1) ? data[0] : null;
    },

    async createPlayer(fields: any) {
      const { data, error } = await db.from('players').insert(fields)
        .select('id, first_name, last_name, birth_year').single();
      if (error) throw new Error('create player: ' + error.message);
      return data;
    },

    async updatePlayer(id: string, fields: any) {
      const { error } = await db.from('players').update(fields).eq('id', id);
      if (error) throw new Error('update player: ' + error.message);
    },

    async linkIdentity(sourceId: string, entityType: string, entityId: string,
                       externalId: string, payload: any) {
      const { error } = await db.from('external_identities').upsert({
        source_id: sourceId, entity_type: entityType, entity_id: entityId,
        external_id: externalId, payload: payload ?? {}, synced_at: new Date().toISOString()
      }, { onConflict: 'source_id,entity_type,external_id' });
      if (error) throw new Error('link identity: ' + error.message);
    },

    async setEligibility(sourceId: string, playerId: string, e: any) {
      const { error } = await db.from('membership_eligibility').upsert({
        source_id: sourceId, player_id: playerId,
        status: e.status, valid_from: e.validFrom, valid_to: e.validTo,
        reason: e.reason || '', checked_at: new Date().toISOString()
      }, { onConflict: 'source_id,player_id' });
      if (error) throw new Error('eligibility: ' + error.message);
    }
  };
}

/* ------------------------------------------------------------------ main -- */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const gate = await permitted(req);
  if (!gate.ok) return json({ error: gate.why }, 403);

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* an empty body is a valid ask */ }
  if (!body.source) return json({ error: 'which source? pass {"source":"..."}' }, 400);

  const db = createClient(URL_, SERVICE);

  const { data: source, error: srcErr } = await db.from('external_sources')
    .select('*').eq('id', body.source).maybeSingle();
  if (srcErr) return json({ error: srcErr.message }, 500);
  if (!source) return json({ error: 'no such source: ' + body.source }, 404);
  if (!source.enabled) return json({ error: 'that source is disabled' }, 409);

  const dry = body.dry === true || body.dry === 1;

  /* Which clubs to ask about. Given explicitly, or every team that already
     carries an identity from this source — which is what a nightly run wants,
     and which quietly means a league that has linked nothing syncs nothing
     rather than pulling an entire national register. */
  let clubs: string[] = Array.isArray(body.clubs) ? body.clubs.map(String) : [];
  if (!clubs.length) {
    const { data } = await db.from('external_identities')
      .select('external_id').eq('source_id', source.id).eq('entity_type', 'team');
    clubs = (data || []).map((r: any) => r.external_id);
  }
  if (!clubs.length) {
    return json({ error: 'no clubs to sync — link a team to this source first, ' +
                         'or pass {"clubs":["..."]}' }, 400);
  }

  const started = new Date().toISOString();
  let runId: string | null = null;
  if (!dry) {
    const { data } = await db.from('membership_syncs').insert({
      source_id: source.id, league_id: body.leagueId ?? null,
      started_at: started, run_by: gate.userId ?? null
    }).select('id').single();
    runId = data?.id ?? null;
  }

  try {
    const adapter = buildAdapter(source, body);
    const report = await runSync({
      adapter, store: makeStore(db), clubExternalIds: clubs,
      since: body.since || null, config: source.config || {}, dryRun: dry
    });

    if (runId) {
      await db.from('membership_syncs').update({
        finished_at: new Date().toISOString(), ok: report.errors.length === 0,
        seen: report.seen, created: report.created, updated: report.updated,
        skipped: report.skipped, conflicts: report.conflicts,
        error: report.errors.length ? JSON.stringify(report.errors).slice(0, 4000) : null
      }).eq('id', runId);
    }

    return json({ source: source.id, label: source.label, dryRun: dry,
                  clubs: clubs.length, runId, ...report });
  } catch (err) {
    const message = String((err as Error)?.message || err);
    if (runId) {
      await db.from('membership_syncs').update({
        finished_at: new Date().toISOString(), ok: false, error: message.slice(0, 4000)
      }).eq('id', runId);
    }
    return json({ error: message, runId }, 500);
  }
});

/* ------------------------------------------------------------------ auth -- */
/* BELOW THE HANDLER ON PURPOSE. A function declaration hoists, so this is in
   scope where it is called — and cors.test.mjs asserts that no authentication
   code appears in the file above the OPTIONS branch. That is a blunt rule and
   a good one: a preflight answered after an auth check is a browser refusing
   the request with "Failed to fetch" and no clue why, which is exactly how
   finalise-game was broken for a week. Keeping every function in the same
   order keeps the rule checkable by reading. */
/* Either the caller holds the service role key — a cron job, another server —
   or they are a signed-in platform administrator. Anything else is refused
   before a single row is read, because the failure mode of getting this wrong
   is somebody rewriting the player register. */
async function permitted(req: Request): Promise<{ ok: boolean; userId?: string; why?: string }> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, why: 'no credentials' };
  if (token === SERVICE) return { ok: true };

  const sb = createClient(URL_, token, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, why: 'not signed in' };
  const { data, error } = await sb.rpc('is_platform_admin');
  if (error || !data) return { ok: false, why: 'platform administrators only' };
  return { ok: true, userId: user.id };
}
