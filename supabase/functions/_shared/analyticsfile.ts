// ============================================================================
// analytics-file, THE PURE HALF (docs/what-wins-model.md §10.1 and A.2). No imports: supabase/functions/analytics-file/
// index.ts wires supabase-js and Deno.serve around handle(), and supabase/tests/ww-function.test.mjs drives it in node
// (--experimental-strip-types) with stand-in clients.
//
//   POST {scope: 'wins'|'fo'|'club'|'pos', league?, season?, team?, refresh?}   (≤ 1 KB) with apikey and, signed in,
//   Authorization: Bearer <JWT>
//     200 {url (signed, 120 s), token, bytes, built_at, layout, expires_in: 120, n_games, pending, ci_at}
//     400 bad_request · 401 signin | jwt · 403 members | league | scope · 404 none · 429 rate (+ Retry-After) · 405
//
// THE DATABASE DECIDES, AT REQUEST TIME, WITH THE CALLER'S OWN TOKEN: analytics_check runs as whoever is asking, so
// a plan change or the master switch applies on the next request and nothing public ever needs purging. Then the
// limit (analytics_take, as the service role: 60 an hour signed in, 20 signed out), then the index row, then a signed
// URL that lives two minutes. The file never passes through here; the bucket has no policy at all.
//
// RECALCULATE (A.2, `refresh: true`): a signed-in caller who may have the unit's files asks for the few games finalised
// since its last build to be added now. One refresh per league-season per ten minutes for everybody (a press while one
// runs joins it, in this isolate by sharing its promise and across isolates by waiting on analytics_refresh), a
// per-user limit, a cap of 500 new games, and a time budget: past either, the unit is marked due for the next
// scheduled build and the answer says {queued: true}. The model's own update(store, delta) does the arithmetic; this
// only reads the delta (keyset after the store's watermark, never stats->sit, never a whole stats blob) and writes
// the new files beside the old ones, then the index, then deletes what the old index named.
//
// Logs carry the scope, the league, signed or not and the bytes: never a token, a URL or an address.
// ============================================================================

export const FILE_SCOPES = ['wins', 'fo', 'club', 'pos'];
export const FV = 1;                       // the feature layout the pending count is read at
export const MAX_BODY = 1024;
export const SIGNED_TTL = 120;
export const REFRESH_CAP = 500;            // new games a refresh may add; above it, the scheduled build does it
/* the unit a refresh may take on at all. update() re-sums the whole store (O(n)) and the store is read, parsed,
   re-encoded and written whole: measured in node 22 on the real stores, update alone is about 1.1 s wall and 1.7 s of
   process CPU cold at 256-275 games (positions and curves the largest steps), so 400 games would reach the Edge
   runtime's 2 s CPU limit before the parse, validate() and the stringify (PERF2-4). Past these the unit is left to the
   scheduled build ({queued: true, refresh_reason: 'size'}) BEFORE its store is downloaded. Raise them with
   ANALYTICS_REFRESH_MAX_GAMES / ANALYTICS_REFRESH_MAX_STORE_BYTES only after measuring on the hosted runtime; a refresh
   killed there anyway leaves its unit `due` (analytics_refresh_take's lease), never stuck 'running' without a flag. */
export const REFRESH_MAX_GAMES = 250;
export const REFRESH_MAX_STORE_BYTES = 1_600_000;
export const UPLOAD_LANES = 6;             // uploads in flight at once
export const UPLOAD_MS_EST = 300;          // a storage upload from the edge, for the budget check before the upload phase
export const BUCKET = 'analytics';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* a press while this isolate is already refreshing the unit shares that refresh */
const INFLIGHT: Map<string, Promise<any>> = new Map();

export interface Deps {
  callerClient: (auth: string | null) => any;      // supabase-js as the caller (anon key + their token, if any)
  admin: any;                                      // supabase-js with the service role
  env: { get(k: string): string | undefined } | Record<string, string | undefined>;
  sha256: (s: string) => Promise<string>;          // hex digest
  update?: (store: any, delta: any, opts: any) => any;   // EpinoiaWinModel.update (the shared copy)
  validate?: (file: any, scope: string, o: any) => string[];   // EpinoiaWinModel.validate: every file is checked before upload
  stintGaps?: (rows: any[], stints: any[]) => string[];        // EpinoiaWinModel.stintGaps: games whose stints need the row's own st
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (o: Record<string, unknown>) => void;
}

const envOf = (deps: Deps, k: string): string | undefined => {
  const e: any = deps.env || {};
  return typeof e.get === 'function' ? e.get(k) : e[k];
};
const corsOf = (deps: Deps) => ({
  'Access-Control-Allow-Origin': envOf(deps, 'ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
});

/* THE SIGNED-OUT CALLER'S ADDRESS, as the platform saw it, never what the client wrote (SEC2-2). EXACTLY ONE header is
   read, the one named by ANALYTICS_IP_HEADER (default x-forwarded-for), and in it the entry ANALYTICS_XFF_HOPS (1) from
   the right: proxies APPEND, so the left end is whatever the client sent and the right end is what the last trusted hop
   saw; a single-valued header the edge sets itself (cf-connecting-ip, x-real-ip) is its own right end. There is no list
   and no fallback to another header: a header the platform does not set is one the client can write, and a fallback
   would trust it whenever the configured one is absent. Set ANALYTICS_IP_HEADER after checking on the deployed function
   which header the edge overwrites. No address at all answers '' and the caller is asked to sign in (handle()), never
   put in a bucket every signed-out reader shares. The user agent is not part of it: rotating it would mint a new bucket
   on every request. */
export function clientAddress(req: Request, env: (k: string) => string | undefined): string {
  const name = (env('ANALYTICS_IP_HEADER') || 'x-forwarded-for').trim().toLowerCase();
  const list = (req.headers.get(name) || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!list.length) return '';
  const hops = Math.max(1, Math.floor(+(env('ANALYTICS_XFF_HOPS') || 1)) || 1);
  return list[Math.max(0, list.length - hops)];
}

/* the JWT's subject. PostgREST has just verified the token (analytics_check ran with it), so reading it is enough. */
export function jwtSub(jwt: string): string {
  try {
    const part = jwt.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = JSON.parse(atob(b64));
    return typeof json.sub === 'string' ? json.sub : '';
  } catch (_) { return ''; }
}

/* the file name a token gets: each non-alphanumeric run as '-' (§6.1) */
export const fileName = (v: number, token: string) => 'v' + v + '-' + String(token).replace(/[^A-Za-z0-9]+/g, '-') + '.json';

/* '<n>@<max finalised_at>' -> the watermark time (null for a pooled or unknown token) */
export function tokenAt(token: string): string | null {
  const m = /^(\d+)@(.+)$/.exec(String(token || ''));
  if (!m || /@o/.test(m[2])) return null;
  return isNaN(Date.parse(m[2])) ? null : m[2];
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = corsOf(deps);
  const now = deps.now || (() => Date.now());
  const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
  const log = (o: Record<string, unknown>) => { try { (deps.log || ((x) => console.log(JSON.stringify(x))))(o); } catch (_) { /* never fatal */ } };

  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: { ...cors, 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return reply(405, { reason: 'method' }, { Allow: 'POST, OPTIONS' });

  /* ---- 1. the body: small, an object, ids that are ids ---- */
  let body: any;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return reply(400, { reason: 'bad_request' });
    body = JSON.parse(text);
  } catch (_) { return reply(400, { reason: 'bad_request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.scope !== 'string' || body.scope.length > 16)
    return reply(400, { reason: 'bad_request' });
  const ids: Record<string, string | null> = {};
  for (const k of ['league', 'season', 'team']) {
    const v = body[k];
    if (v == null || v === '') { ids[k] = null; continue; }
    if (typeof v !== 'string' || !UUID.test(v)) return reply(400, { reason: 'bad_request' });
    ids[k] = v.toLowerCase();
  }
  if (body.refresh != null && typeof body.refresh !== 'boolean') return reply(400, { reason: 'bad_request' });
  const scope: string = body.scope, refresh = body.refresh === true;
  const { league, season, team } = ids;

  /* ---- 2. may this caller have it? asked as the caller ---- */
  const authz = req.headers.get('authorization') || '';
  const bm = /^Bearer\s+(\S+)$/i.exec(authz.trim());
  const jwt = bm && bm[1].split('.').length === 3 ? bm[1] : null;
  const caller = deps.callerClient(jwt ? 'Bearer ' + jwt : null);
  let verdict: string;
  try {
    const { data, error } = await caller.rpc('analytics_check', { p_scope: scope, p_league: league, p_season: season, p_team: team });
    if (error) {
      const jwtErr = !!jwt && (error.status === 401 || /^PGRST30/.test(String(error.code || '')) || /jwt|jws|token/i.test(String(error.message || '')));
      return jwtErr ? reply(401, { reason: 'jwt' }) : reply(503, { reason: 'unavailable' });
    }
    verdict = String(data);
  } catch (_) { return reply(503, { reason: 'unavailable' }); }
  if (verdict === 'signin') return reply(401, { reason: 'signin' });
  if (verdict === 'members' || verdict === 'league' || verdict === 'scope') return reply(403, { reason: verdict });
  if (verdict !== 'ok' || !FILE_SCOPES.includes(scope)) return reply(403, { reason: 'scope' });

  /* ---- 3. who to count it against ---- */
  const sub = jwt ? jwtSub(jwt) : '';
  let subject: string;
  if (sub) subject = 'u:' + sub;
  else {
    const ip = clientAddress(req, k => envOf(deps, k));
    /* no address the platform vouches for: sign in (never one bucket for every signed-out reader, never another header) */
    if (!ip) { log({ scope, league: league || 'all', signed: false, reason: 'no_address' }); return reply(401, { reason: 'signin' }); }
    const day = new Date(now()).toISOString().slice(0, 10);
    subject = 'ip:' + String(await deps.sha256([ip, day, envOf(deps, 'ANALYTICS_SALT') || ''].join('|'))).slice(0, 32);
  }
  const admin = deps.admin;

  /* ---- 4. the limit ---- */
  let rate: any;
  try {
    const { data, error } = await admin.rpc('analytics_take', { p_subject: subject, p_signed: !!sub, p_scope: scope, p_league: league || 'all' });
    if (error || !data) return reply(503, { reason: 'unavailable' });
    rate = data;
  } catch (_) { return reply(503, { reason: 'unavailable' }); }
  const rateHeaders = (r: any): Record<string, string> => ({
    'X-RateLimit-Limit': String(r.limit_hour ?? ''),
    'X-RateLimit-Remaining': String(Math.max(0, (r.limit_hour ?? 0) - (r.used_hour ?? 0)))
  });
  if (!rate.ok) {
    const ra = Math.max(1, Math.ceil(+rate.retry_after || 60));
    return reply(429, { reason: 'rate', retry_after: ra }, { 'Retry-After': String(ra), ...rateHeaders(rate) });
  }

  /* ---- A.2: RECALCULATE first, then answer with whatever file is now current ---- */
  let extra: Record<string, unknown> = {};
  if (refresh) {
    if (!sub) return reply(401, { reason: 'signin' });
    if (!league) return reply(403, { reason: 'scope' });
    const r = await refreshUnit(deps, { league, season, subject, now });
    if (r.rate) {
      const ra = Math.max(1, Math.ceil(+r.retry_after || 60));
      return reply(429, { reason: 'rate', retry_after: ra }, { 'Retry-After': String(ra) });
    }
    extra = { refreshed: !!r.refreshed, queued: !!r.queued, ...(r.reason ? { refresh_reason: r.reason } : {}),
              ...(r.joined ? { joined: true } : {}), ...(r.retry_after ? { retry_after: r.retry_after } : {}) };
  }

  /* ---- 5. the index row ---- */
  let row: any = null;
  try {
    let qb = admin.from('analytics_files').select('path,token,bytes,built_at,layout,fv,n_games,ci_at,league_id,season_id')
      .eq('scope', scope).eq('league_key', league || 'all').eq('team_key', team || '');
    qb = season ? qb.eq('season_key', season) : qb.eq('is_current', true);
    const { data, error } = await qb.order('built_at', { ascending: false }).limit(1);
    if (error) return reply(503, { reason: 'unavailable' });
    row = (data || [])[0] || null;
  } catch (_) { return reply(503, { reason: 'unavailable' }); }
  if (!row) return reply(404, { reason: 'none', ...extra }, rateHeaders(rate));

  /* ---- 6. a signed URL, two minutes ---- */
  const path = String(row.path).replace(/^analytics\//, '');
  let url: string | null = null;
  try {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
    if (error || !data || !data.signedUrl) return reply(404, { reason: 'none', ...extra }, rateHeaders(rate));
    url = data.signedUrl;
  } catch (_) { return reply(503, { reason: 'unavailable' }); }

  /* new games since the file's own watermark (a cheap HEAD count; null for the pooled file) */
  let pending: number | null = null;
  const at = tokenAt(row.token);
  if (at && row.league_id && row.season_id) {
    try {
      const { count, error } = await admin.from('game_features').select('game_id', { count: 'exact', head: true })
        .eq('league_id', row.league_id).eq('season_id', row.season_id).eq('fv', row.fv || FV).eq('team_idx', 0).gt('finalised_at', at);
      if (!error && typeof count === 'number') pending = count;
    } catch (_) { pending = null; }
  }

  log({ fn: 'analytics-file', scope, league: league || 'all', signed: !!sub, bytes: row.bytes ?? null, refresh: refresh || undefined });
  return reply(200, {
    url, token: row.token, bytes: row.bytes ?? null, built_at: row.built_at, layout: row.layout, expires_in: SIGNED_TTL,
    n_games: row.n_games ?? null, pending, ci_at: row.ci_at ?? null, ...extra
  }, rateHeaders(rate));
}

/* ------------------------------------------------------------------ RECALCULATE --- */
async function refreshUnit(deps: Deps, o: { league: string; season: string | null; subject: string; now: () => number }): Promise<any> {
  const admin = deps.admin;
  let season = o.season;
  if (!season) {
    const { data } = await admin.from('analytics_files').select('season_id').eq('scope', 'wins').eq('league_key', o.league)
      .eq('team_key', '').eq('is_current', true).limit(1);
    season = (data && data[0] && data[0].season_id) || null;
    if (!season) return { refreshed: false, queued: false, reason: 'none' };
  }
  const key = o.league + ':' + season;
  const running = INFLIGHT.get(key);
  if (running) { const r = await running; return { ...r, joined: true }; }
  const p = (async () => {
    let took: any;
    try {
      const { data, error } = await admin.rpc('analytics_refresh_take', { p_subject: o.subject, p_league: o.league, p_season: season });
      if (error || !data) return { refreshed: false, reason: 'unavailable' };
      took = data;
    } catch (_) { return { refreshed: false, reason: 'unavailable' }; }
    if (!took.ok) {
      if (took.state === 'rate') return { rate: true, retry_after: took.retry_after };
      if (took.state === 'recent') return { refreshed: false, reason: 'recent', retry_after: took.retry_after };
      /* somebody else's refresh of this unit, in another isolate: wait for it, briefly */
      const sleep = deps.sleep || ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
      const until = o.now() + (+(envOf(deps, 'ANALYTICS_JOIN_WAIT_MS') || 15000));
      while (o.now() < until) {
        await sleep(1000);
        const { data } = await admin.from('analytics_refresh').select('finished_at,status').eq('league_id', o.league).eq('season_id', season).limit(1);
        const r = data && data[0];
        if (r && r.finished_at) return { refreshed: r.status === 'done', queued: r.status === 'queued', joined: true };
      }
      return { refreshed: false, reason: 'running', joined: true };
    }
    let status = 'failed';
    try {
      const r = await runUpdate(deps, o.league, season as string, o.now);
      status = r.queued ? 'queued' : 'done';
      return r;
    } catch (e) {
      console.warn('[analytics-file] refresh failed:', String(e && (e as any).message || e).slice(0, 200));
      return { refreshed: false, reason: 'failed' };
    } finally {
      try { await admin.rpc('analytics_refresh_done', { p_league: o.league, p_season: season, p_status: status }); } catch (_) { /* logged by the table's state */ }
    }
  })();
  INFLIGHT.set(key, p);
  try { return await p; } finally { INFLIGHT.delete(key); }
}

const chunks = <T>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const PGS_SELECT = 'game_id,team_idx,player_uuid,player_id,min:stats->min,pts:stats->pts,p2a:stats->p2a,p2m:stats->p2m,p3a:stats->p3a,' +
  'p3m:stats->p3m,fta:stats->fta,ftm:stats->ftm,or:stats->or,dr:stats->dr,ast:stats->ast,stl:stats->stl,blk:stats->blk,to:stats->to,pf:stats->pf';
const STINT_SELECT = 'game_id,team_idx,player_ids,dur:stats->dur,pf:stats->pf,pa:stats->pa,off:stats->off,def:stats->def';
const GAME_SELECT = 'id,status,competition_id,home_team_id,away_team_id,home_score,away_score,tipoff_at,venue_id,starters';

async function runUpdate(deps: Deps, league: string, season: string, now: () => number): Promise<any> {
  const admin = deps.admin, t0 = now();
  const budget = +(envOf(deps, 'ANALYTICS_REFRESH_BUDGET_MS') || 20000);
  const late = (share: number) => now() - t0 > budget * share;
  if (typeof deps.update !== 'function') return { refreshed: false, queued: true, reason: 'model' };

  /* the unit's index rows, the store's among them */
  const { data: idx, error: idxErr } = await admin.from('analytics_files')
    .select('scope,league_key,season_key,team_key,league_id,season_id,team_id,is_current,path,token,layout,fv,ci_at,bytes,n_games')
    .eq('league_key', league).eq('season_key', season);
  if (idxErr) throw new Error(idxErr.message);
  const old = new Map<string, any>();
  (idx || []).forEach((r: any) => old.set(r.scope + '|' + (r.team_key || ''), r));
  const storeRow = old.get('store|');
  if (!storeRow) return { refreshed: false, queued: true, reason: 'store' };
  /* too big a unit for the function: left to the scheduled build before a byte of the store is read */
  const maxGames = +(envOf(deps, 'ANALYTICS_REFRESH_MAX_GAMES') || REFRESH_MAX_GAMES), maxBytes = +(envOf(deps, 'ANALYTICS_REFRESH_MAX_STORE_BYTES') || REFRESH_MAX_STORE_BYTES);
  if ((+storeRow.n_games || 0) > maxGames || (+storeRow.bytes || 0) > maxBytes) return { refreshed: false, queued: true, reason: 'size' };

  const dl = await admin.storage.from(BUCKET).download(String(storeRow.path).replace(/^analytics\//, ''));
  if (dl.error || !dl.data) throw new Error('the store could not be read');
  const store = JSON.parse(typeof dl.data === 'string' ? dl.data : await dl.data.text());
  if ((+store.n || 0) > maxGames) return { refreshed: false, queued: true, reason: 'size' };
  const fv = +store.fv || FV;
  const wm = store.wm || { at: '1970-01-01T00:00:00Z', id: '00000000-0000-0000-0000-000000000000' };
  const after = `finalised_at.gt.${wm.at},and(finalised_at.eq.${wm.at},game_id.gt.${wm.id})`;

  /* how many new games: above the cap, the scheduled build does it */
  const { count, error: cErr } = await admin.from('game_features').select('game_id', { count: 'exact', head: true })
    .eq('league_id', league).eq('season_id', season).eq('fv', fv).eq('team_idx', 0).or(after);
  if (cErr) throw new Error(cErr.message);
  if (!count) return { refreshed: false, reason: 'current' };
  if (count > REFRESH_CAP) return { refreshed: false, queued: true, reason: 'cap' };

  /* the delta, keyset after the watermark: the lines, their games, player lines and stints (§6.3) */
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    /* not st: about 1 KB a row the model reads only for a game without lineup_stints (fetched below for those) */
    const { data, error } = await admin.from('game_features').select('game_id,team_idx,f,q,finalised_at')
      .eq('league_id', league).eq('season_id', season).eq('fv', fv).or(after)
      .order('finalised_at').order('game_id').order('team_idx').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const gids = Array.from(new Set(rows.map(r => r.game_id)));
  const games: any[] = [], pgs: any[] = [], stints: any[] = [];
  for (const c of chunks(gids, 150)) {
    const { data, error } = await admin.from('games').select(GAME_SELECT).in('id', c);
    if (error) throw new Error(error.message);
    games.push(...(data || []).filter((g: any) => g.status === 'final'));
  }
  /* PostgREST answers at most 1000 rows a request (a game has 30-60 stints and 20-30 player lines): every read pages,
     in a fixed order, until a short page, or a chunk would come back cut and the store keep it */
  const paged = async (table: string, cols: string, ids: string[], order: string[]) => {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      let q = admin.from(table).select(cols).in('game_id', ids);
      for (const o of order) q = q.order(o);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) return out;
    }
  };
  for (const c of chunks(gids, 40)) {
    const [p, s] = await Promise.all([
      paged('player_game_stats', PGS_SELECT, c, ['game_id', 'team_idx', 'player_id']),
      paged('lineup_stints', STINT_SELECT, c, ['game_id', 'team_idx', 'id'])
    ]);
    pgs.push(...p); stints.push(...s);
  }
  /* the row's own stints (A.1) only for the games whose lineup_stints are missing or short */
  const gaps = typeof deps.stintGaps === 'function' ? deps.stintGaps(rows, stints) : gids.filter(g => !stints.some((x: any) => x.game_id === g));
  for (const c of chunks(gaps, 40)) {
    const { data, error } = await admin.from('game_features').select('game_id,team_idx,st').eq('fv', fv).in('game_id', c);
    if (error) throw new Error(error.message);
    const by = new Map((data || []).map((r: any) => [r.game_id + ':' + r.team_idx, r.st]));
    rows.forEach(r => { const v = by.get(r.game_id + ':' + r.team_idx); if (v) r.st = v; });
  }
  if (late(0.6)) return { refreshed: false, queued: true, reason: 'budget' };

  /* I6: every player the unit names is checked against the database NOW (a player who debuts in the delta, a consent
     withdrawn since the last full build), and the minors without public consent are left out of every file */
  const UUIDS = new Set<string>();
  ((store.pgs && store.pgs.players) || []).forEach((id: any) => { if (UUID.test(String(id))) UUIDS.add(String(id).toLowerCase()); });
  pgs.forEach((r: any) => { if (r.player_uuid && UUID.test(String(r.player_uuid))) UUIDS.add(String(r.player_uuid).toLowerCase()); });
  stints.forEach((r: any) => (r.player_ids || []).forEach((id: any) => { if (UUID.test(String(id))) UUIDS.add(String(id).toLowerCase()); }));
  const withheld: string[] = [];
  for (const c of chunks(Array.from(UUIDS).sort(), 150)) {
    const { data, error } = await admin.from('players').select('id,is_minor,public_consent').in('id', c);
    if (error) throw new Error(error.message);
    (data || []).forEach((r: any) => { if (r.is_minor && !r.public_consent) withheld.push(String(r.id)); });
  }

  const builtAt = new Date(now()).toISOString();
  const res = await deps.update(store, { rows, games, pgs, stints }, { now: builtAt, league, season, withheld });
  if (!res || !res.store) throw new Error('the model returned no store');
  if (late(0.85)) return { refreshed: false, queued: true, reason: 'budget' };

  /* what to write: {wins, fo, club: {team: file}, pos: {team: file}} or a single file */
  const nextStore = res.store;
  const token = String(res.token || (nextStore.n + '@' + (nextStore.wm && nextStore.wm.at)));
  const out: { scope: string; team: string; file: any }[] = [];
  const addMany = (scope: string, m: any) => {
    if (!m) return;
    const entries: [string, any][] = m instanceof Map ? Array.from(m.entries()) : Object.entries(m);
    entries.forEach(([t, f]) => out.push({ scope, team: t, file: f }));
  };
  /* the clubs whose games changed (and any club or pos file with no index row yet), as the builder does (§6.4): the
     others keep their rows and files until the next scheduled build */
  const changed = new Set<string>(Array.isArray(res.changed) ? res.changed.map(String) : games.flatMap((g: any) => [g.home_team_id, g.away_team_id]).filter(Boolean));
  if (res.files) {
    if (res.files.wins) out.push({ scope: 'wins', team: '', file: res.files.wins });
    if (res.files.fo) out.push({ scope: 'fo', team: '', file: res.files.fo });
    addMany('club', res.files.club || res.files.clubs);
    addMany('pos', res.files.pos);
  } else if (res.file) {
    out.push({ scope: res.file.scope && FILE_SCOPES.includes(res.file.scope) ? res.file.scope : 'wins', team: '', file: res.file });
  }
  const todo = out.filter(o => !o.team || changed.has(o.team) || !old.has(o.scope + '|' + o.team));

  /* every file checked as the builder checks it (I6: no withheld player; a club file only its own games; the budget)
     before anything is written: a problem leaves the unit to the scheduled build */
  if (typeof deps.validate === 'function') {
    const wh = new Set<string>(((nextStore.ctx && nextStore.ctx.withheld) || []).concat(withheld).map(String));
    const gidsOf = (t: string) => {
      const ok = new Set<string>();
      const G = nextStore.games, cols: string[] = (G && G.k) || [], rowsG: any[] = (G && G.v) || [];   // the store's packed game rows {k, v}
      const ci = cols.indexOf('id'), hi = cols.indexOf('h'), ai = cols.indexOf('a');
      if (ci >= 0 && hi >= 0 && ai >= 0) rowsG.forEach((r: any[]) => { if (r[hi] === t || r[ai] === t) ok.add(r[ci]); });
      return ok.size ? ok : null;
    };
    for (const o of todo) {
      const probs = deps.validate(o.file, o.scope, { withheld: wh, games: o.scope === 'club' ? gidsOf(o.team) : null });
      if (probs && probs.length) {
        console.warn('[analytics-file] refresh refused by validate:', o.scope, String(probs[0]).slice(0, 160));
        return { refreshed: false, queued: true, reason: 'validate' };
      }
    }
  }
  /* the upload phase only when it fits what is left of the budget (an estimate per file, UPLOAD_LANES at a time) */
  const estUp = Math.ceil((todo.length + 1) / UPLOAD_LANES) * UPLOAD_MS_EST;
  if (now() - t0 + estUp > budget) return { refreshed: false, queued: true, reason: 'budget' };

  /* members' files and the store: never kept by a browser's HTTP cache (supabase-js writes max-age=<cacheControl>) */
  const upload = async (path: string, text: string, upsert: boolean) => {
    const { error } = await admin.storage.from(BUCKET).upload(path, text, { contentType: 'application/json', cacheControl: '0', upsert });
    if (error && !/exist|duplicate|409/i.test(String(error.message || error.statusCode || ''))) throw new Error('upload: ' + error.message);
  };
  const indexRows: any[] = [];
  const stale: string[] = [];
  const jobs = todo.map(o => {
    const v = +(o.file && o.file.w) || 1;
    const path = o.scope + '/' + league + '/' + season + '/' + (o.team ? o.team + '/' : '') + fileName(v, token);
    return { o, v, path, text: JSON.stringify(o.file) };
  });
  for (const lane of chunks(jobs, UPLOAD_LANES)) await Promise.all(lane.map(j => upload(j.path, j.text, false)));
  for (const { o, v, path, text } of jobs) {
    const prev = old.get(o.scope + '|' + o.team);
    indexRows.push({ scope: o.scope, league_key: league, season_key: season, team_key: o.team, league_id: league, season_id: season,
      team_id: o.team || null, is_current: prev ? !!prev.is_current : !!storeRow.is_current, path, token, layout: v, fv,
      bytes: text.length, n_games: +nextStore.n || null, built_at: builtAt, ci_at: (prev && prev.ci_at) || (o.file && o.file.ci_at) || null });
    if (prev && prev.path && String(prev.path).replace(/^analytics\//, '') !== path) stale.push(String(prev.path).replace(/^analytics\//, ''));
  }
  const storeText = JSON.stringify(nextStore);
  const storePath = String(storeRow.path).replace(/^analytics\//, '');
  await upload(storePath, storeText, true);
  indexRows.push({ ...storeRow, path: storePath, token, bytes: storeText.length, n_games: +nextStore.n || null, built_at: builtAt });

  /* the index after the uploads, the deletes after the index: a reader never meets a row naming a missing file */
  const { error: upErr } = await admin.from('analytics_files').upsert(indexRows, { onConflict: 'scope,league_key,season_key,team_key' });
  if (upErr) throw new Error(upErr.message);
  if (stale.length) { try { await admin.storage.from(BUCKET).remove(stale); } catch (_) { /* the next build sweeps */ } }
  return { refreshed: true, added: count, files: todo.length };
}
