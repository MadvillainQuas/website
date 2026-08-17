// ============================================================================
// feeds — everything a league admin needs to do to a partner feed by hand.
//
//   POST { action: 'preview', feedId, gameId? }  -> the exact bytes we would send
//   POST { action: 'test',    feedId, gameId? }  -> actually send them, recorded
//   POST { action: 'retry',   leagueId }         -> resend everything still owed
//
// PREVIEW IS THE POINT OF THIS FUNCTION. Configuring a feed is guesswork
// otherwise: an admin picks CSV, types a field map, and finds out three weeks
// later that RealGM has been rejecting every delivery. Being able to read the
// literal payload before anyone depends on it turns a support thread into a
// button.
//
// The caller's own JWT decides what they may touch — never the service role.
// The service role is used only to read the feed's secrets, which is the whole
// reason this runs on a server: `data_feeds` has no SELECT policy, so the
// endpoint and the signing secret are unreachable from any browser, including
// the admin's own.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { loadGame, shapeGame, render, dispatchGame, post, type Feed }
  from '../_shared/feeds.ts';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  // who is asking — their token, their permissions
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  );
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'sign in first' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: 'expected JSON' }, 400); }
  const action = String(body.action || 'preview');

  /* Is this person an administrator of that league? Asked of the DATABASE,
     through the caller's own token, so this function and the RLS policies can
     never disagree about it. */
  const mayAdminister = async (leagueId: string) => {
    const { data, error } = await caller.rpc('is_league_admin', { p_league: leagueId });
    return !error && data === true;
  };

  // ------------------------------------------------------------- retry ---
  if (action === 'retry') {
    const leagueId = String(body.leagueId || '');
    if (!leagueId) return json({ error: 'leagueId is required' }, 400);
    if (!await mayAdminister(leagueId)) {
      return json({ error: 'you do not administer that league' }, 403);
    }

    const { data: feeds } = await admin.from('data_feeds')
      .select('id').eq('league_id', leagueId);
    const ids = (feeds || []).map((f: any) => f.id);
    if (!ids.length) return json({ ok: true, games: 0, results: [] });

    const { data: owed } = await admin.from('feed_deliveries')
      .select('game_id').in('feed_id', ids).in('status', ['pending', 'failed'])
      .not('game_id', 'is', null).order('queued_at').limit(200);

    const games = [...new Set((owed || []).map((r: any) => r.game_id))];
    const results: any[] = [];
    for (const gid of games) {
      try { results.push({ game: gid, deliveries: await dispatchGame(admin, gid) }); }
      catch (e) { results.push({ game: gid, error: String(e).slice(0, 200) }); }
    }
    return json({ ok: true, games: games.length, results });
  }

  // ------------------------------------------------- preview / test send ---
  const feedId = String(body.feedId || '');
  if (!feedId) return json({ error: 'feedId is required' }, 400);

  const { data: feed } = await admin.from('data_feeds')
    .select('*').eq('id', feedId).maybeSingle();
  if (!feed) return json({ error: 'no such feed' }, 404);
  if (!await mayAdminister(feed.league_id)) {
    return json({ error: 'you do not administer that league' }, 403);
  }

  /* Which game to render. Whatever was asked for, else the most recent
     finalised game in the league — an empty preview teaches nobody
     anything. */
  let gameId = String(body.gameId || '');
  if (!gameId) {
    const { data: comps } = await admin.from('competitions')
      .select('id,seasons!inner(league_id)').eq('seasons.league_id', feed.league_id);
    const compIds = (comps || []).map((c: any) => c.id);
    if (compIds.length) {
      const { data: g } = await admin.from('games')
        .select('id').in('competition_id', compIds).eq('status', 'final')
        .order('tipoff_at', { ascending: false }).limit(1);
      gameId = g?.[0]?.id || '';
    }
  }
  if (!gameId) {
    return json({ error: 'this league has no finalised game to render yet' }, 404);
  }

  let built: { body: string; contentType: string };
  try {
    const want: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(feed.sections || {})) if (v) want[k] = true;
    built = render(shapeGame(await loadGame(admin, gameId, want), feed as Feed), feed as Feed);
  } catch (e) {
    return json({ error: 'could not build the payload: ' + String(e).slice(0, 300) }, 500);
  }

  if (action === 'preview') {
    /* The bytes, and nothing that would let the browser learn the endpoint.
       A preview is a read; it must not be able to become a send. */
    return json({
      ok: true, game_id: gameId, format: feed.format,
      content_type: built.contentType,
      bytes: new TextEncoder().encode(built.body).length,
      signed: !!feed.signing_secret,
      body: built.body.slice(0, 200_000)
    });
  }

  if (action !== 'test') return json({ error: 'unknown action' }, 400);
  if (!feed.endpoint_url) {
    return json({ error: 'this feed has no endpoint yet — there is nowhere to send it' }, 400);
  }

  /* A test send is a real send, so it is recorded like one. Anything else and
     the delivery log stops being the answer to "did they get it". */
  const { data: row } = await admin.from('feed_deliveries').upsert({
    feed_id: feed.id, game_id: gameId, kind: 'game',
    status: 'pending', attempts: 0, queued_at: new Date().toISOString(),
    http_status: null, error: null, delivered_at: null
  }, { onConflict: 'feed_id,game_id,kind' }).select('id,attempts').single();

  const r = await post(feed as Feed, built.body, built.contentType, row?.id || 'test');
  const ok = r.status >= 200 && r.status < 300;
  const bytes = new TextEncoder().encode(built.body).length;

  if (row?.id) {
    await admin.from('feed_deliveries').update({
      status: ok ? 'sent' : 'failed', attempts: (row.attempts || 0) + 1,
      http_status: r.status || null, error: r.error, bytes,
      delivered_at: ok ? new Date().toISOString() : null
    }).eq('id', row.id);
  }
  await admin.from('data_feeds').update({
    last_sent_at: new Date().toISOString(), last_status: r.status || null, last_error: r.error
  }).eq('id', feed.id);

  return json({ ok, status: r.status, bytes, error: r.error, game_id: gameId });
});
