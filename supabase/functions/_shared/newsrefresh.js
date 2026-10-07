/* ============================================================================
   NEWS REFRESH - "Load articles now": one publisher's feed read on demand, and what may and may not be read.

   The half-hourly reader (scripts/news/fetch_feeds.py) holds the service key in GitHub Actions. A browser can hold
   neither that nor a GitHub token, so the button calls the news-refresh Edge Function, which is this file wired to
   Supabase (functions/news-refresh/index.ts). Everything that decides anything is here, with its dependencies handed in
   (createHandler), so supabase/tests/news-refresh.test.mjs runs the whole of it - who is let in, what is read, what is
   written, how often - with a fake database and a fake network, and nothing in it is a mock of the rule.

   WHO. A signed-in caller. A platform administrator may load any source, or all of them ({ all: true }); a league's
   administrator only a source that is that league's own (news_sources.league_id; a platform source has none, so it is
   the platform's alone). Asked by the database itself: is_platform_admin() and can_manage_news_sources(league) (0194), as
   the console asks them. A caller who may not gets 403 whether or not the source exists (no probing for slugs).

   WHAT IS READ. The feed_url stored in news_sources for that source, and nothing from the request: the request names a
   source by its slug and no more (an address, a feed_url, a url in the body are ignored). https on the ordinary port to
   a public host; every redirect is followed by hand, at most three, each one checked again; a name that resolves to a
   private address is refused; 10 s for the whole read, 2 MB at the most.

   WHAT IS WRITTEN. The stories the feed carries, into news_items, by (source_id, guid) exactly as the Python reader does,
   through the parser held to the same fixtures (newsfeed.js): new ones inserted, changed ones corrected, unchanged ones
   left alone (so a second press adds nothing and writes nothing). Their league tags are NOT set here: a new story
   has none until the next half-hourly read tags it, and this clears the source's ETag when it added any, so that read
   fetches the feed afresh instead of taking a 304. The source's last_fetched_at, last_ok_at, last_error and item_count.

   HOW OFTEN. A source once in 60 s, whoever asks; a caller ten requests in 60 s. Both counted in audit_log (an
   in-process claim closes the gap between two requests arriving together), and every request that gets past them, and
   every source it reads, leaves a row: 'news_refresh_call' and 'news_refresh'.
   ============================================================================ */
import { KEEP_DAYS, checkFeedUrl, isPrivateIp, parseFeed } from './newsfeed.js';
import { CONSENT_COOKIE, apiChannel, apiItems, apiReason, channelFromPage, classify, feedOfLink, isYouTubeLink, playlistOf, videoIdOf } from './ytvideo.js';

export const FETCH_TIMEOUT_MS = 10000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const SOURCE_GAP_S = 60;          // one refresh of a source in this many seconds
export const CALLER_MAX = 10;            // requests from one caller in CALLER_WINDOW_S
export const CALLER_WINDOW_S = 60;
export const MAX_HOPS = 3;
export const PAGE_MAX_BYTES = 4 * 1024 * 1024;   // a YouTube channel's own page (1.6 MB in 2026), read only to find its channel
export const ALL_CONCURRENCY = 4;
export const ALL_BUDGET_MS = 100000;     // "all" starts no new source after this long
export const UA = 'EpinoiaNews/1.0 (+https://prophesyscouting.co.uk/epinoia/news/)';

const STATUS = { auth: 401, forbidden: 403, no_source: 404, bad_request: 400, method: 405, off: 409, rate: 429, rate_caller: 429,
  blocked: 422, unreachable: 502, not_feed: 502, too_big: 502, server: 500, pending: 409 };

export class RefreshError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ------------------------------------------------------------------------------------------- the read --- */
export function decodeBody(bytes, contentType) {
  let label = (/charset\s*=\s*"?([\w.:-]+)/i.exec(contentType || '') || [])[1];
  if (!label) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    label = (/^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) || [])[1];
  }
  try { return new TextDecoder(label || 'utf-8').decode(bytes); } catch (_) { return new TextDecoder('utf-8').decode(bytes); }
}

async function readCapped(res, max, signal, limit) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.length > max) throw new RefreshError('too_big', 'the feed is larger than ' + (max / 1048576) + ' MB');
    return b;
  }
  const len = Number(res.headers.get('content-length'));
  if (len > max) { try { await res.body.cancel(); } catch (_) { /* nothing */ } throw new RefreshError('too_big', 'the feed is larger than ' + (max / 1048576) + ' MB'); }
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    if (signal && signal.aborted) throw new RefreshError('unreachable', 'timed out after ' + (limit / 1000) + ' s');
    let step;
    try { step = await reader.read(); }
    catch (_) { throw new RefreshError('unreachable', signal && signal.aborted ? 'timed out after ' + (limit / 1000) + ' s' : 'the connection dropped'); }
    const { done, value } = step;
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch (_) { /* nothing */ } throw new RefreshError('too_big', 'the feed is larger than ' + (max / 1048576) + ' MB'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* THE FEED AT `start`: the stored address, checked, read by hand through at most MAX_HOPS redirects (each hop checked as the
   first was), 10 s in all, 2 MB at the most. -> { bytes, contentType, url } or throws a RefreshError.
   opts (the YouTube routes): headers added to the request (the consent cookie), maxBytes (a channel's page is larger than
   a feed), errorBody (an answer that is not 200 keeps up to 64 kB of its body on the error, for the API's own reason) */
export async function fetchFeed(deps, start, opts) {
  const o = opts || {};
  const ctl = new AbortController();
  const limit = deps.timeoutMs || FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ctl.abort(), limit);
  try {
    let url = start;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const chk = checkFeedUrl(url);
      if (!chk.ok) throw new RefreshError('blocked', hop ? 'it redirected somewhere that is not read: ' + chk.why : chk.why);
      const host = new URL(chk.url).hostname.replace(/^\[|\]$/g, '');
      if (!/^[0-9.]+$/.test(host) && host.indexOf(':') < 0) {
        let ips = null;
        try { ips = deps.resolve ? await deps.resolve(host) : null; } catch (_) { ips = null; }
        if (ips === null && deps.strictDns) throw new RefreshError('blocked', 'its host could not be checked');
        if (ips && ips.some(isPrivateIp)) throw new RefreshError('blocked', 'its host is on a private address');
      }
      let res;
      try {
        res = await deps.fetch(chk.url, {
          redirect: 'manual', signal: ctl.signal,
          headers: Object.assign({ 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.5' }, o.headers || {})
        });
      } catch (e) {
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw new RefreshError('unreachable', 'timed out after ' + (limit / 1000) + ' s');
        throw new RefreshError('unreachable', 'could not connect');
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        try { await res.body?.cancel(); } catch (_) { /* nothing */ }
        if (!loc) throw new RefreshError('unreachable', 'a redirect with nowhere to go');
        if (hop === MAX_HOPS) throw new RefreshError('unreachable', 'too many redirects');
        try { url = new URL(loc, chk.url).href; } catch (_) { throw new RefreshError('blocked', 'it redirected to something that is not an address'); }
        continue;
      }
      if (res.status !== 200) {
        let body = null;
        if (o.errorBody) { try { body = decodeBody(await readCapped(res, 65536, ctl.signal, limit), res.headers.get('content-type') || ''); } catch (_) { body = null; } }
        else { try { await res.body?.cancel(); } catch (_) { /* nothing */ } }
        const err = new RefreshError('unreachable', 'the site answered HTTP ' + res.status);
        err.status = res.status; err.body = body;
        throw err;
      }
      const bytes = await readCapped(res, o.maxBytes || MAX_BYTES, ctl.signal, limit);
      return { bytes, contentType: res.headers.get('content-type') || '', url: chk.url };
    }
    throw new RefreshError('unreachable', 'too many redirects');
  } finally { clearTimeout(timer); }
}

const same = (e, r) => e.url === r.url && e.title === r.title && e.summary === r.summary && (e.image_url || null) === (r.image_url || null) &&
  (e.author || null) === (r.author || null) && JSON.stringify(e.tags || []) === JSON.stringify(r.tags || []);

const sentence = e => String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 200);
const errLine = (code, msg) => ({ blocked: 'feed address not read: ', unreachable: 'feed unreachable: ', not_feed: 'not a feed: ', too_big: 'feed too large: ', server: 'could not save: ' }[code] || '') + msg;

/* ------------------------------------------------------------------------------------------ the handler --- */
export function createHandler(deps) {
  const db = deps.db;
  const now = () => (deps.now ? deps.now() : new Date());
  const claims = new Map();               // source id -> when this process last took it (two requests together)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...(deps.cors || {}), 'Content-Type': 'application/json' } });
  const fail = (code, message, extra) => json({ ok: false, code, error: message, ...extra }, STATUS[code] || 500);

  /* A JSON ANSWER FROM THE YOUTUBE DATA API, read under a feed's rules (https to a public host, 10 s, 2 MB). The address
     carries the key; no error made here repeats the address. */
  async function getJson(url) {
    let got;
    try { got = await fetchFeed(deps, url, { errorBody: true }); }
    catch (e) {
      /* the API's own reason, so a key it refuses (not enabled for the API, restricted, over its quota) says why */
      const why = e && e.body ? apiReason(e.body) : null;
      throw new RefreshError(e.code || 'unreachable', 'YouTube API: ' + (why || (e && e.message) || 'refused'));
    }
    try { return JSON.parse(decodeBody(got.bytes, got.contentType)); }
    catch (_) { throw new RefreshError('unreachable', 'YouTube answered with something that is not JSON'); }
  }

  /* A SOURCE ADDED BY ITS LINK (0198) holds the link in resolve_from until its feed is found. A YouTube link is found here at
     once, the first way that works: a /channel/ or playlist link is its own feed; else the Data API (with the key); else
     the channel's own page, read past the consent wall with YouTube's consent cookie (no key needed; the wall itself is
     what a plain read of the link met: "not a feed: bad tag"). Any other link waits for the half-hourly reader, which knows
     how to look for a site's feed. -> the fields to set on the source, with feed_url */
  async function findFeed(src) {
    if (!isYouTubeLink(src.resolve_from)) throw new RefreshError('pending', 'its feed is found at the next half-hourly read (within half an hour)');
    let ch = feedOfLink(src.resolve_from), why = null;
    if (!ch && deps.ytKey) {
      try { ch = await apiChannel(src.resolve_from, deps.ytKey, getJson); } catch (e) { why = e.message; }
    }
    if (!ch) {
      try {
        const got = await fetchFeed(deps, src.resolve_from, { headers: { Cookie: CONSENT_COOKIE, 'Accept-Language': 'en' }, maxBytes: PAGE_MAX_BYTES });
        ch = channelFromPage(decodeBody(got.bytes, got.contentType));
      } catch (e) { why = why || e.message; }
    }
    if (!ch) throw new RefreshError('not_feed', 'no YouTube channel found at that link' + (why ? ' (' + why + ')' : ''));
    const other = db.feedTaken ? await db.feedTaken(ch.feed_url, src.league_id || null, src.id) : null;
    if (other) throw new RefreshError('not_feed', 'the same feed as ' + other + ', which is a source here already');
    const set = { feed_url: ch.feed_url, site_url: ch.site_url || src.site_url || null, resolve_from: null, platform: 'youtube',
                  etag: null, last_modified: null };
    if (ch.logo && !src.logo_url) { set.logo_url = ch.logo; set.logo_checked_at = now().toISOString(); }
    if (src.name_auto && ch.name) { set.name = String(ch.name).slice(0, 80); set.name_auto = false; }
    return set;
  }

  /* ONE SOURCE, read and stored. Never throws: -> { ok, ... } with `code` when it did not work. */
  async function refreshOne(src, actor, all) {
    const t0 = now().getTime();
    const stamp = now();
    const took = () => now().getTime() - t0;
    let result;
    try {
      const found = src.resolve_from ? await findFeed(src) : null;
      const feedUrl = found ? found.feed_url : src.feed_url;
      let items = null, apiWhy = null;
      if (deps.ytKey && playlistOf(feedUrl)) {
        /* A YOUTUBE CHANNEL through the Data API, as the half-hourly reader reads one when it has the key: one quota unit,
           and it answers when the channel's RSS does not. Refused, the RSS is read instead. */
        try { items = await apiItems(feedUrl, deps.ytKey, getJson, stamp); } catch (e) { apiWhy = e.message; items = null; }
      }
      if (!items) {
        let got;
        try { got = await fetchFeed(deps, feedUrl); }
        catch (e) { if (apiWhy && e instanceof RefreshError) e.message += ' (and ' + apiWhy + ')'; throw e; }
        try { [, items] = parseFeed(decodeBody(got.bytes, got.contentType), feedUrl, stamp); }
        catch (e) { throw new RefreshError('not_feed', sentence(e).replace(/^not a feed:?\s*/i, '') || 'this address does not carry a feed'); }
      }
      const cutoff = stamp.getTime() - KEEP_DAYS * 86400000;
      items = items.filter(x => new Date(x.published_at).getTime() >= cutoff);
      const had = items.length ? await db.existing(src.id, items.map(x => x.guid)) : new Map();
      const fresh = [], changed = [];
      for (const x of items) {
        const e = had.get(x.guid);
        if (!e) fresh.push(x); else if (!same(e, x)) changed.push(x);
      }
      const rows = fresh.concat(changed).map(x => {
        const r = { source_id: src.id, guid: x.guid, url: x.url, title: x.title, summary: x.summary, image_url: x.image_url, author: x.author,
                    tags: x.tags, published_at: x.published_at, fetched_at: stamp.toISOString() };
        if (deps.videos) {
          /* THE VIDEO COLUMNS (0237), as the half-hourly reader writes them: every row the same keys (a bulk insert with
             mixed keys is refused). The game is the matcher's, at that reader's next pass. */
          r.video_id = videoIdOf(x.url, x.guid);
          r.video_kind = r.video_id ? classify(x.title) : null;
        }
        return r;
      });
      try {
        if (rows.length) await db.upsert(rows);
        const total = await db.count(src.id);
        const mark = Object.assign({}, found || {}, { last_fetched_at: stamp.toISOString(), last_ok_at: stamp.toISOString(), last_error: null, item_count: total });
        if (fresh.length) { mark.etag = null; mark.last_modified = null; }   // the next half-hourly read asks afresh, and tags what came in
        await db.mark(src.id, mark);
        result = { ok: true, slug: src.slug, name: mark.name || src.name, added: fresh.length, updated: changed.length, total, fetched: items.length,
                   found: !!found, last_error: null, took_ms: took() };
      } catch (e) { throw new RefreshError('server', sentence(e) || 'the database refused'); }
    } catch (e) {
      const code = e instanceof RefreshError ? e.code : 'unreachable';
      const msg = e instanceof RefreshError ? e.message : sentence(e);
      const line = errLine(code, msg).slice(0, 300);
      /* a link still waiting for the reader is left as it is: an error on it would hold that reader off for hours */
      if (code !== 'pending') {
        try { await db.mark(src.id, { last_fetched_at: stamp.toISOString(), last_error: line }); } catch (_) { /* the answer still goes */ }
      }
      result = { ok: false, slug: src.slug, name: src.name, code, error: line, message: msg, last_error: line, took_ms: took() };
    }
    try {
      await db.audit({
        actor, action: 'news_refresh', subject: 'news_source', subject_id: src.id,
        detail: { slug: src.slug, all: !!all, ok: result.ok, code: result.code || null, added: result.added || 0, updated: result.updated || 0,
                  total: result.total ?? null, took_ms: result.took_ms }
      });
    } catch (_) { /* a row that could not be written does not undo a read that was */ }
    return result;
  }

  /* TAKE A SOURCE for a read: null when it is free (and now held for the minute), or the seconds to wait. The claim is made
     before anything is awaited, so two requests arriving together cannot both take it; the log is the memory that outlives
     this process. */
  async function take(src) {
    const t = now().getTime();
    const c = claims.get(src.id);
    if (c && t - c < SOURCE_GAP_S * 1000) return Math.ceil(SOURCE_GAP_S - (t - c) / 1000);
    claims.set(src.id, t);
    const row = await db.lastRefresh(src.id);
    if (row) {
      const last = new Date(row).getTime(), left = Math.ceil(SOURCE_GAP_S - (t - last) / 1000);
      if (left > 0) { claims.set(src.id, last); return left; }
    }
    return null;
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: deps.cors || {} });
    if (req.method !== 'POST') return fail('method', 'POST only');

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return fail('auth', 'sign in first');
    const service = !!(deps.isService && deps.isService(token));
    let user = null;
    if (!service) {
      user = await deps.getUser(token);
      if (!user) return fail('auth', 'sign in again: this session is not accepted');
    }
    const actor = user ? user.id : null;

    let body = null;
    try { body = await req.json(); } catch (_) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('bad_request', 'send { "source": "<slug>" } or { "all": true }');
    const all = body.all === true;
    const slug = typeof body.source === 'string' ? body.source.trim() : '';
    if (!all && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(slug)) return fail('bad_request', 'send { "source": "<slug>" } or { "all": true }');

    const platform = service || await deps.isPlatformAdmin(token);
    let src = null;
    if (all) {
      if (!platform) return fail('forbidden', 'only a platform administrator can load every publisher');
    } else {
      src = await db.source(slug);
      if (!src) return platform ? fail('no_source', 'no publisher called ' + slug) : fail('forbidden', 'you may not load that publisher');
      if (!platform && !(src.league_id && await deps.canManage(token, src.league_id))) return fail('forbidden', 'you may not load that publisher');
    }

    /* how often: the caller first (a refusal costs the database nothing), then the source */
    if (actor) {
      const since = new Date(now().getTime() - CALLER_WINDOW_S * 1000).toISOString();
      const calls = (await db.callerCalls(actor, since)).map(x => new Date(x).getTime()).sort((a, b) => a - b);
      if (calls.length >= CALLER_MAX) {
        const retry = Math.max(1, Math.ceil(CALLER_WINDOW_S - (now().getTime() - calls[calls.length - CALLER_MAX]) / 1000));
        return fail('rate_caller', 'too many refreshes: try in ' + retry + ' s', { retry_after: retry });
      }
    }
    if (!all) {
      if (!src.enabled) return fail('off', src.name + ' is switched off: switch it on to load its articles');
      const w = await take(src);
      if (w) return fail('rate', src.name + ' was loaded a moment ago: try in ' + w + ' s', { retry_after: w });
    }
    try {
      await db.audit({ actor, action: 'news_refresh_call', subject: all ? 'news' : 'news_source', subject_id: all ? 'all' : src.id,
                       detail: { source: all ? null : src.slug, all } });
    } catch (_) { /* the read is not held up by its own log */ }

    if (!all) {
      const r = await refreshOne(src, actor, false);
      return r.ok ? json(r) : fail(r.code, r.error, { slug: r.slug, name: r.name, last_error: r.last_error, took_ms: r.took_ms, detail: r.message });
    }

    /* EVERY ENABLED SOURCE, four at a time, none started after the budget; each still holds to its own minute */
    const t0 = now().getTime();
    const list = await db.sources();
    const results = new Array(list.length);
    let next = 0;
    async function worker() {
      for (;;) {
        const k = next++;
        if (k >= list.length) return;
        const s = list[k];
        if (now().getTime() - t0 > ALL_BUDGET_MS) { results[k] = { ok: false, slug: s.slug, name: s.name, code: 'skipped', error: 'not reached in time: run it again' }; continue; }
        const w = await take(s);
        if (w) { results[k] = { ok: false, slug: s.slug, name: s.name, code: 'rate', retry_after: w, error: 'loaded a moment ago' }; continue; }
        results[k] = await refreshOne(s, actor, true);
      }
    }
    await Promise.all(Array.from({ length: Math.min(ALL_CONCURRENCY, list.length) }, worker));
    const sum = k => results.reduce((n, r) => n + (r && r[k] || 0), 0);
    return json({
      ok: true, all: true, sources: list.length,
      read: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok && r.code !== 'rate' && r.code !== 'skipped').length,
      waiting: results.filter(r => r.code === 'rate').length, skipped: results.filter(r => r.code === 'skipped').length,
      added: sum('added'), updated: sum('updated'), total: sum('total'), took_ms: now().getTime() - t0,
      results: results.map(r => ({ slug: r.slug, name: r.name, ok: r.ok, code: r.code || null, error: r.ok ? null : r.error, added: r.added || 0, updated: r.updated || 0, total: r.total ?? null, retry_after: r.retry_after || null }))
    });
  };
}
