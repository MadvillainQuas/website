'use strict';
/* ============================================================================
   NEWS REFRESH, THE BROWSER'S SIDE - the "Load now" button (the news-refresh Edge Function; docs/news-and-creators.md).

   A publisher's articles arrive on the site every half hour (news-feeds.yml). This is the button that does not wait: the
   console's News tab (a "Load now" on every source and a "Load all" for the platform), and the public News page's
   publisher view and Publishers filter - shown ONLY to a signed-in administrator who may use it (access(): the platform's
   administrators any source, a league's its own; the function asks the same of the database, so a button that shows is
   a button that works and one that is hidden was never a security measure).

   What it says, under the button, in words: "+7 new · 12 total · 1.2 s", "No new articles · 12 total · 0.9 s",
   "rate limited, try in 42 s" (counting down, the button back when it reaches nought), "feed unreachable: the site
   answered HTTP 503", "not a feed", and "needs the news-refresh function deployed" when the function is not there
   (a 404 from the gateway, or no answer at all): never an exception, never a broken page.

   No markup is built from text: everything is textContent. No storage; nothing about the reader leaves the browser but
   the slug of the source asked for.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsRefresh = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const FN = 'news-refresh';
const secs = ms => (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + ' s';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ------------------------------------------------------------------------------- what came back, in words --- */
/* (an HTTP status, the JSON the function sent or null) -> { ok, kind, text, retry, added, updated, total, raw }
   kind: 'ok' | 'wait' | 'missing' | 'err' */
function normalise(status, j) {
  const b = j && typeof j === 'object' ? j : {};
  if (status === 200 && b.ok) {
    if (b.all) {
      const bits = [plural(b.read || 0, 'publisher', 'publishers') + ' read', (b.added ? '+' + b.added + ' new' : 'no new articles')];
      if (b.updated) bits.push(b.updated + ' updated');
      bits.push(b.total + ' total', secs(b.took_ms));
      if (b.failed) bits.push(b.failed + ' failed');
      if (b.waiting) bits.push(b.waiting + ' loaded a moment ago');
      if (b.skipped) bits.push(b.skipped + ' not reached: press again');
      return { ok: true, kind: b.failed ? 'err' : 'ok', text: bits.join(' · '), added: b.added || 0, updated: b.updated || 0, total: b.total, raw: b };
    }
    const bits = [b.added ? '+' + b.added + ' new' : 'No new articles'];
    if (b.updated) bits.push(b.updated + ' updated');
    bits.push((b.total || 0) + ' total', secs(b.took_ms));
    return { ok: true, kind: 'ok', text: bits.join(' · '), added: b.added || 0, updated: b.updated || 0, total: b.total, raw: b };
  }
  const code = b.code;
  if (code === 'rate' || code === 'rate_caller' || status === 429) {
    const n = Math.max(1, Math.ceil(Number(b.retry_after) || 60));
    return { ok: false, kind: 'wait', retry: n, text: (code === 'rate_caller' ? 'too many refreshes, try in ' : 'rate limited, try in ') + n + ' s', raw: b };
  }
  if (code === 'unreachable') return { ok: false, kind: 'err', text: 'feed unreachable' + (b.detail ? ': ' + b.detail : ''), raw: b };
  if (code === 'not_feed') return { ok: false, kind: 'err', text: 'not a feed' + (b.detail ? ': ' + b.detail : ''), raw: b };
  if (code === 'too_big') return { ok: false, kind: 'err', text: 'feed too large (over 2 MB)', raw: b };
  if (code === 'blocked') return { ok: false, kind: 'err', text: 'feed address not allowed' + (b.detail ? ': ' + b.detail : ''), raw: b };
  if (code === 'off') return { ok: false, kind: 'err', text: 'switched off: switch it on first', raw: b };
  if (code === 'auth' || status === 401) return { ok: false, kind: 'err', text: 'sign in again to load articles', raw: b };
  if (code === 'forbidden' || status === 403) return { ok: false, kind: 'err', text: 'you may not load this publisher', raw: b };
  if (code === 'no_source') return { ok: false, kind: 'err', text: 'that publisher is not on the site any more', raw: b };
  /* the gateway's own 404 (no such function), or nothing answering at all */
  if (status === 404 || status === 0 || status === undefined) return { ok: false, kind: 'missing', text: 'needs the news-refresh function deployed', raw: b };
  if (status >= 500) return { ok: false, kind: 'err', text: (b.error || 'the refresh failed') + ' (HTTP ' + status + ')', raw: b };
  return { ok: false, kind: 'err', text: b.error || 'could not load (HTTP ' + status + ')', raw: b };
}

/* ------------------------------------------------------------------------------------------ the call --- */
/* opts: { source: 'slug' } or { all: true }, and how to reach the function: { sb } (the console's supabase-js client) or
   { cfg, token } (the public page: EPINOIA_CONFIG and the reader's token). Never rejects: a normalised outcome. */
async function call(opts) {
  const body = opts.all ? { all: true } : { source: String(opts.source || '') };
  try {
    if (opts.sb && opts.sb.functions && typeof opts.sb.functions.invoke === 'function') {
      const r = await opts.sb.functions.invoke(FN, { body });
      if (!r.error) return normalise(200, r.data);
      const ctx = r.error.context;
      const status = ctx && typeof ctx.status === 'number' ? ctx.status : 0;
      let j = null;
      try { j = ctx && typeof ctx.json === 'function' ? await ctx.json() : null; } catch (_) { j = null; }
      return normalise(status, j);
    }
    if (!opts.cfg || !opts.token) return normalise(401, { code: 'auth' });
    const res = await fetch(opts.cfg.supabaseUrl + '/functions/v1/news-refresh', {
      method: 'POST', cache: 'no-store',
      headers: { apikey: opts.cfg.supabaseAnonKey, Authorization: 'Bearer ' + opts.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let j = null;
    try { j = await res.json(); } catch (_) { j = null; }
    return normalise(res.status, j);
  } catch (_) {
    return normalise(0, null);
  }
}

/* SEVERAL SOURCES, one after the other (a league's administrator loading every publisher of theirs): each is its own request, so
   each keeps its own minute. One outcome in the shape of "all"; it stops at once when the function is missing, and at the
   caller's own limit (the rest are counted as not reached). */
async function callMany(opts, slugs) {
  const t0 = Date.now();
  const sum = { ok: true, all: true, read: 0, failed: 0, waiting: 0, skipped: 0, added: 0, updated: 0, total: 0 };
  for (let k = 0; k < slugs.length; k++) {
    const r = await call(Object.assign({}, opts, { source: slugs[k], all: false }));
    if (r.kind === 'missing' || (r.raw && r.raw.code === 'auth') || (r.raw && r.raw.code === 'forbidden' && k === 0 && slugs.length === 1)) return r;
    if (r.ok) { sum.read++; sum.added += r.added; sum.updated += r.updated; sum.total += r.total || 0; }
    else if (r.raw && r.raw.code === 'rate') sum.waiting++;
    else if (r.raw && r.raw.code === 'rate_caller') { sum.skipped += slugs.length - k; break; }
    else sum.failed++;
  }
  sum.took_ms = Date.now() - t0;
  return normalise(200, sum);
}

/* ------------------------------------------------------------------------------------- who may use it --- */
/* a reader's part, asked of the database through the same two functions the console uses (0194):
   rpc(fn, args) -> the answer (null when signed out), leagueIdOf(slug) -> the league's id. Answers are kept for the page. */
function access(o) {
  let platform = null;
  const leagues = new Map();
  const yes = v => v === true;
  const isPlatform = () => platform || (platform = Promise.resolve().then(() => o.rpc('is_platform_admin', {})).then(yes, () => false));
  return {
    platform: isPlatform,
    /* may this reader load a source of that league (slug), or a platform source (null / '')? */
    can: async leagueSlug => {
      if (await isPlatform()) return true;
      if (!leagueSlug) return false;
      if (!leagues.has(leagueSlug)) {
        leagues.set(leagueSlug, Promise.resolve().then(async () => {
          const id = await o.leagueIdOf(leagueSlug);
          return id ? yes(await o.rpc('can_manage_news_sources', { p_league: id })) : false;
        }).catch(() => false));
      }
      return leagues.get(leagueSlug);
    }
  };
}

/* ---------------------------------------------------------------------------------------- the control --- */
/* A button and its status line: o = { label, title, run: () => Promise<outcome>, onDone(outcome) (it worked), onEnd(outcome)
   (whatever came of it), tag }.
   -> { box, button, status, press } */
function control(o) {
  const mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const box = mk('span', 'nr' + (o.tag ? ' ' + o.tag : ''));
  const button = mk('button', 'ep-btn mini nr-btn', o.label || 'Load now');
  button.type = 'button';
  if (o.title) button.title = o.title;
  const status = mk('span', 'nr-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  box.append(button, status);
  let timer = null, running = false;

  const say = (kind, text) => { status.className = 'nr-status' + (kind ? ' ' + kind : ''); status.textContent = text; };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  async function press() {
    if (running || button.disabled) return null;
    running = true; stop();
    button.disabled = true;
    say('busy', '');
    const spin = mk('span', 'nr-spin'); spin.setAttribute('aria-hidden', 'true');
    status.append(spin, ' Loading…');
    let out;
    try { out = await o.run(); } catch (_) { out = normalise(0, null); }
    running = false;
    say(out.kind === 'ok' ? 'ok' : out.kind === 'wait' ? 'wait' : 'err', out.text);
    if (out.kind === 'wait') {
      /* the button comes back when the wait is over, the words counting down */
      let left = out.retry;
      timer = setInterval(() => {
        left--;
        if (left <= 0) { stop(); button.disabled = false; say('', ''); return; }
        say('wait', out.text.replace(/\d+ s$/, left + ' s'));
      }, 1000);
    } else button.disabled = false;
    if (o.onEnd) { try { o.onEnd(out); } catch (_) { /* the page's own trouble */ } }
    if (out.ok && o.onDone) { try { o.onDone(out); } catch (_) { /* the page's own trouble */ } }
    return out;
  }
  button.addEventListener('click', press);
  return { box, button, status, press };
}

return { normalise, call, callMany, access, control, FN };
}));
