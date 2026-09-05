// ============================================================================
// livestats — a CORS shim in front of the Genius Sports LiveStats feeds.
//
// THE PROBLEM THIS SOLVES. fibalivestats.dcd.shared.geniussports.com serves
// /data/<matchId>/data.json to anyone who asks, but sends no
// Access-Control-Allow-Origin header, so a browser on prophesyscouting.co.uk
// is refused before it ever sees the body. gamevis.html worked around that
// through public CORS proxies (codetabs, allorigins, corsproxy.io). All of
// them failed at once on 2026-09-05 — codetabs and allorigins with Cloudflare
// 522s, corsproxy.io with a 403 on free traffic — and because a proxy's ERROR
// page carries no CORS header either, the browser reported the failure as
// "No 'Access-Control-Allow-Origin' header", which reads like a config
// mistake on our side rather than someone else's outage. Free proxies are not
// infrastructure; this function is.
//
// NOT AN OPEN PROXY. Two shapes, nothing else:
//     GET ?game=<digits>   -> that match's data.json
//     GET ?url=<encoded>   -> one allow-listed Genius Sports host
// GET only, no request headers forwarded, no cookies, no credentials, and the
// host allow-list is matched on the parsed hostname rather than a substring
// (`?url=https://evil.test/#fibalivestats.dcd.shared.geniussports.com` must
// not pass). An open proxy on our project ref would be someone else's abuse
// traffic billed to us.
//
// ERRORS CARRY CORS HEADERS TOO. Every response, including refusals and
// upstream failures, goes out through json()/withCors so the page sees a real
// status and message. Returning a bare error here would reproduce exactly the
// opaque failure that made the public proxies so hard to diagnose.
//
// No JWT: declared verify_jwt = false in supabase/config.toml. The upstream
// data is public, the function reads nothing from the database and holds no
// secret, so requiring the anon key would only add a CORS preflight to every
// live-mode poll.
// ============================================================================

const ALLOWED_HOSTS = new Set([
  'fibalivestats.dcd.shared.geniussports.com', // data.json + bs/pbp/sc pages
  'livestats.dcd.shared.geniussports.com',     // webcast shell
  'hosted.dcd.shared.geniussports.com'         // server-rendered schedules
]);

const FIBA_DATA = (id: string) =>
  `https://fibalivestats.dcd.shared.geniussports.com/data/${id}/data.json`;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

// Live scores. A minute-old box score presented as current is worse than a
// slow one, so the window is short enough that nobody reads a stale lead —
// but non-zero, because live mode polls every 30s per viewer and the pre-warm
// asks for several games at once.
const CACHE = 'public, max-age=5, stale-while-revalidate=10';

const UPSTREAM_TIMEOUT_MS = 15_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);

  const qs = new URL(req.url).searchParams;
  const game = (qs.get('game') || qs.get('matchId') || '').trim();
  const raw = (qs.get('url') || '').trim();

  let target: string;

  if (game) {
    // A match id is digits. Anything else is someone probing.
    if (!/^\d{4,12}$/.test(game)) {
      return json({ error: 'game must be a numeric FIBA match id' }, 400);
    }
    target = FIBA_DATA(game);
  } else if (raw) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch (_) {
      return json({ error: 'url is not a valid absolute URL' }, 400);
    }
    if (u.protocol !== 'https:') return json({ error: 'https only' }, 400);
    if (!ALLOWED_HOSTS.has(u.hostname)) {
      return json(
        { error: 'host not allowed', host: u.hostname, allowed: [...ALLOWED_HOSTS] },
        403
      );
    }
    target = u.toString();
  } else {
    return json({ error: 'pass ?game=<matchId> or ?url=<genius sports url>' }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // Identify ourselves rather than arriving as a bare Deno fetch, and ask
      // the CDN for a fresh copy — this function is the thing that is allowed
      // to cache, one layer up.
      headers: {
        'User-Agent': 'prophesyscouting-livestats/1.0 (+https://prophesyscouting.co.uk)',
        'Accept': '*/*'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (e) {
    // Upstream unreachable or too slow. Say so with a status the page can act
    // on, not a dead connection.
    return json({ error: 'upstream fetch failed', detail: String(e), target }, 504);
  }

  if (!upstream.ok) {
    return json(
      { error: 'upstream returned ' + upstream.status, status: upstream.status, target },
      upstream.status === 404 ? 404 : 502
    );
  }

  const body = await upstream.arrayBuffer();
  const type = upstream.headers.get('Content-Type')
    || (target.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8');

  return new Response(body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': type,
      'Cache-Control': CACHE,
      // Lets the page tell a proxied response apart from a direct one when
      // something looks wrong, without reading the body.
      'X-Livestats-Source': target
    }
  });
});
