// ============================================================================
// share — makes a game linkable to somebody who has no account.
//
//   POST { gameId, payload, note? }  -> { id, url }   create a share
//   GET  ?g=<id>                     -> { meta, payload }   read one back
//
// THE FUNCTION IS THE ONLY DOOR. public.game_shares has RLS on and no policy,
// so neither anon nor an authenticated user can touch it directly. Everything
// here runs on the service role and reads exactly one row by primary key. That
// is deliberate: a `select ... using (true)` read policy would have let anyone
// ask PostgREST for the whole table, and the unguessable id would have stopped
// meaning anything. See the migration for the longer version.
//
// WHY THE ID IS GENERATED HERE. 18 bytes from crypto.getRandomValues, base64url
// — 144 bits, so guessing one is not a thing that happens. It is generated in
// one place rather than defaulted in SQL because the id IS the access control,
// and access control belongs somewhere a person can read it.
//
// WRITES ARE CHECKED, NOT TRUSTED. An unauthenticated endpoint that accepts
// arbitrary JSON and stores it is a free file host with someone else's bill
// attached. So: an anon-key header is required (weak — the key is public in
// the page — but it stops drive-by scripted abuse), the body is capped, and
// the payload has to actually look like a Genius Sports feed. None of that is
// authentication; it is the difference between a door and an open field.
//
// verify_jwt = false in config.toml, because the GET must work for a coach who
// has no account and never will.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }
  });

// A data.json for a full game runs ~400 KB. 4 MB leaves room for a long
// overtime with a fat play-by-play and still refuses anything being used as
// storage for something that is not a basketball game.
const MAX_BYTES = 4 * 1024 * 1024;

const SITE = Deno.env.get('SHARE_SITE_ORIGIN') ?? 'https://prophesyscouting.co.uk';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

function newId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const clip = (v: unknown, n: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, n) : null;
};

/** Does this look like a Genius Sports LiveStats feed? Cheap structural check —
 *  two teams each with a player map, and a play-by-play array. Enough to refuse
 *  arbitrary documents without pretending to validate the whole schema. */
function looksLikeFeed(p: any): string | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'payload must be an object';
  const tm = p.tm;
  if (!tm || typeof tm !== 'object') return 'payload has no tm (teams) object';
  for (const side of ['1', '2']) {
    const t = tm[side];
    if (!t || typeof t !== 'object') return `payload has no tm.${side}`;
    if (!t.pl || typeof t.pl !== 'object') return `tm.${side} has no player map`;
  }
  if (!Array.isArray(p.pbp)) return 'payload has no pbp array';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);

  // ------------------------------------------------------------------ read ---
  if (req.method === 'GET') {
    const id = (url.searchParams.get('g') || url.searchParams.get('id') || '').trim();
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) {
      return json({ error: 'pass ?g=<share id>' }, 400);
    }

    const { data, error } = await admin
      .from('game_shares')
      .select('id, game_id, payload, home_name, away_name, home_score, away_score, competition, venue, is_final, created_at, note')
      .eq('id', id)
      .maybeSingle();

    if (error) return json({ error: 'lookup failed', detail: error.message }, 500);
    if (!data) return json({ error: 'no such share' }, 404);

    const { payload, ...meta } = data as any;
    // A share is immutable once written, so it can be cached hard. This is the
    // one response here worth caching: it is the 400 KB one, and a coach who
    // reloads or reopens the link should not re-download it.
    return json({ meta, payload }, 200, { 'Cache-Control': 'public, max-age=300' });
  }

  // ---------------------------------------------------------------- create ---
  if (req.method !== 'POST') return json({ error: 'GET or POST only' }, 405);

  // Weak by construction — the anon key is public in the page — but it is the
  // difference between "someone deliberately abused this" and "a scanner found
  // an open write endpoint".
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const presented = req.headers.get('apikey')
    || (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!anon || presented !== anon) {
    return json({ error: 'missing or wrong project key' }, 401);
  }

  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return json({ error: 'payload too large', bytes: raw.length, max: MAX_BYTES }, 413);
  }

  let body: any;
  try { body = JSON.parse(raw); } catch (_) { return json({ error: 'expected JSON' }, 400); }

  const gameId = String(body.gameId ?? '').trim();
  if (!/^\d{4,12}$/.test(gameId)) return json({ error: 'gameId must be a numeric match id' }, 400);

  const payload = body.payload;
  const shapeProblem = looksLikeFeed(payload);
  if (shapeProblem) return json({ error: 'payload does not look like a LiveStats feed', detail: shapeProblem }, 400);

  const t1 = payload.tm['1'] ?? {};
  const t2 = payload.tm['2'] ?? {};
  // The feed says nothing explicit about being finished; a fourth (or later)
  // period with the clock at zero is what "final" means here. Recorded rather
  // than derived at render so the page can be honest about sharing a game that
  // was still being played.
  const clock = String(payload.clock ?? '').trim();
  const period = Number(payload.period ?? 0);
  const isFinal = period >= 4 && (clock === '00:00' || clock === '0:00' || clock === '');

  const id = newId();
  const { error } = await admin.from('game_shares').insert({
    id,
    game_id: gameId,
    payload,
    home_name: clip(t1.name, 120),
    away_name: clip(t2.name, 120),
    home_score: Number.isFinite(+t1.score) ? +t1.score : null,
    away_score: Number.isFinite(+t2.score) ? +t2.score : null,
    competition: clip(body.competition, 160),
    venue: clip(body.venue, 160),
    is_final: isFinal,
    note: clip(body.note, 500)
  });

  if (error) return json({ error: 'could not save share', detail: error.message }, 500);

  return json({
    id,
    url: `${SITE}/share/?g=${id}`,
    isFinal,
    score: `${t1.name ?? 'Home'} ${t1.score ?? 0} - ${t2.score ?? 0} ${t2.name ?? 'Away'}`
  }, 201);
});
