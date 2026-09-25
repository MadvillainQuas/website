/* ============================================================================
   ARENA PLACE - read what is at an arena's pin, and put it on the arena.

   The platform console's Arenas tab lets an administrator move an arena's pin. The pin is then
   right and the name, address, town, country and Google place stored beside it still describe
   the old spot (Saga's arena read "Wembley" until this existed). After a pin is saved the
   console calls this, and the arena takes on what Google finds at the new spot.

     POST /functions/v1/arena-place      { venueId: uuid }

   WHY IT RUNS HERE. The Google key must never reach a browser, and what is written is the
   arena's public identity - so the caller is checked as a platform administrator, and the
   coordinates are read from the DATABASE, never from the request: a caller can only ask "look
   at where this arena's pin already is".

   BILLING. Every call is one Places lookup; each is taken from a daily allowance in the
   database first (google_lookup_take, 0175), so a stuck loop or a curious click cannot run up
   a bill. The key is the function's secret GOOGLE_MAPS_KEY: `supabase secrets set
   GOOGLE_MAPS_KEY=...`.

   WHAT IT NEVER DOES. It never moves the pin (the person's pin wins), and finds nothing rather
   than guess: an arena is only taken from a result of an arena kind within 150 m of the pin.
   Every change is written to the audit log with what it replaced.
   ============================================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ARENA_TYPES, REACH_M, languageFor, pickPlace, sameName } from '../_shared/arenaplace.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DAY_CAP = 300;               // lookups a day from the console, whatever is asked
const NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const who = await permitted(req);
  if (!who.ok) return json({ error: who.why }, 403);
  const key = Deno.env.get('GOOGLE_MAPS_KEY');
  if (!key) return json({ error: 'GOOGLE_MAPS_KEY is not set on this project (supabase secrets set GOOGLE_MAPS_KEY=...)' }, 500);

  const { venueId } = await req.json().catch(() => ({}));
  if (!venueId || !/^[0-9a-f-]{36}$/i.test(String(venueId))) return json({ error: 'venueId required' }, 400);

  const admin = createClient(URL_, SERVICE);
  const { data: v, error: readErr } = await admin.from('venues')
    .select('id,name,country,city,address,lat,lng,place_id').eq('id', venueId).maybeSingle();
  if (readErr || !v) return json({ error: 'no such arena' }, 404);
  if (v.lat == null || v.lng == null) return json({ error: 'this arena has no pin yet' }, 422);

  const { data: taken } = await admin.rpc('google_lookup_take', { p_cap: DAY_CAP });
  if (taken !== true) return json({ error: 'today\'s Google lookups are used up; try again tomorrow' }, 429);

  const pin = { lat: v.lat, lng: v.lng };
  let places: any[] = [];
  try {
    const r = await fetch(NEARBY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({
        includedTypes: ARENA_TYPES, maxResultCount: 10, rankPreference: 'DISTANCE',
        languageCode: languageFor(v.country),
        locationRestriction: { circle: { center: { latitude: pin.lat, longitude: pin.lng }, radius: REACH_M } }
      })
    });
    if (!r.ok) {
      const t = (await r.text().catch(() => '')).slice(0, 200);
      return json({ error: 'Google answered ' + r.status, detail: t }, 502);
    }
    places = (await r.json()).places || [];
  } catch (e) {
    return json({ error: 'Google could not be reached', detail: String(e).slice(0, 200) }, 502);
  }

  const found = pickPlace(places, pin);
  if (!found) {
    /* nothing of an arena kind within reach: leave what is there. The stale address and town were
       already cleared when the pin moved (0175's trigger), so the arena simply shows its name. */
    return json({ ok: true, found: false, reach_m: REACH_M });
  }

  const before = { name: v.name, address: v.address, city: v.city, country: v.country, place_id: v.place_id };
  const patch: Record<string, unknown> = {
    address: found.address, city: found.city, place_id: found.place_id,
    ...(found.country ? { country: found.country } : {}),
    ...(sameName(found.name, v.name) ? {} : { name: found.name })
  };
  const { error: upErr } = await admin.from('venues').update(patch).eq('id', v.id);
  if (upErr) return json({ error: 'the arena could not be updated', detail: upErr.message }, 500);

  /* the old name stays an alias, so the feed that still writes it keeps finding this arena; and the
     new one becomes an alias too, unless it already belongs to another arena (then a person merges) */
  let aliasNote: string | null = null;
  if (patch.name) {
    const { data: k } = await admin.rpc('venue_key', { p_name: found.name });
    if (k) {
      const { data: has } = await admin.from('venue_aliases').select('venue_id').eq('key', k).maybeSingle();
      if (!has) await admin.from('venue_aliases').insert({ key: k, venue_id: v.id, spelling: found.name });
      else if (has.venue_id !== v.id) aliasNote = 'another arena already carries the name "' + found.name + '" - they may be one arena, and can be merged';
    }
  }
  await admin.from('audit_log').insert({
    actor: who.userId ?? null, action: 'venue_place', subject: 'venue', subject_id: v.id,
    detail: { before, after: { ...before, ...patch }, distance_m: found.distance_m }
  });
  return json({ ok: true, found: true, applied: patch, before, distance_m: found.distance_m, aliasNote });
});

/* ------------------------------------------------------------------ auth -- */
/* BELOW THE HANDLER ON PURPOSE (cors.test.mjs: no authentication code above the OPTIONS branch).
   Only a signed-in platform administrator, or the service role. */
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
