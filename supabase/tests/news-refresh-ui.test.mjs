// The "Load now" button, the browser's side: epinoia/newsrefresh.js, the console's rows (admin/creators-ui.js), and the
// News page's wiring (news/news-page.js) - no network.
//
//   node supabase/tests/news-refresh-ui.test.mjs
//
// What it holds: the words under the button ("+7 new · 12 total · 1.2 s", "rate limited, try in 42 s" counting down,
// "feed unreachable", "not a feed", "needs the news-refresh function deployed" for a 404 or no answer at all - never an
// exception); the two ways to reach the function (the console's supabase-js, the public page's fetch with the reader's
// token); who is shown a button (a platform administrator any publisher and "all", a league's administrators their own
// league's, everybody else nothing and asked nothing more); the console's "Load now" on every source and "Load all" on the
// platform's list only; and that the pages carry the script and the style, and stay inside the CSP.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
const read = p => readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw)?.slice(0, 400))); } };

class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = ''; this.className = ''; this.attrs = {}; this.listeners = {}; this.style = {}; this.disabled = false; this.title = ''; this.type = ''; this.value = ''; this.checked = false; }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  replaceWith() {}
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  click() { return Promise.all((this.listeners.click || []).map(f => f())); }
}
globalThis.document = { createElement: t => new El(t), querySelector: () => null };
const timers = [];
globalThis.setInterval = fn => { timers.push(fn); return timers.length; };
globalThis.clearInterval = id => { if (timers[id - 1]) timers[id - 1] = null; };
const tick = () => new Promise(r => setTimeout(r, 5));

const NR = require(path.join(root, 'epinoia', 'newsrefresh.js'));
globalThis.EpinoiaNewsRefresh = NR;

console.log('-- the words under the button');
{
  const n = NR.normalise;
  ok('a load that found stories: "+7 new · 12 total · 1.2 s"', n(200, { ok: true, added: 7, updated: 0, total: 12, took_ms: 1234 }).text === '+7 new · 12 total · 1.2 s');
  ok('...corrections counted when there are some', n(200, { ok: true, added: 1, updated: 2, total: 12, took_ms: 800 }).text === '+1 new · 2 updated · 12 total · 0.8 s');
  ok('...nothing new says so', n(200, { ok: true, added: 0, updated: 0, total: 12, took_ms: 900 }).text === 'No new articles · 12 total · 0.9 s' && n(200, { ok: true, added: 0, total: 0, took_ms: 0 }).ok === true);
  ok('all: publishers read, new, total, time, and what failed or waited', n(200, { ok: true, all: true, read: 12, added: 23, updated: 0, total: 340, took_ms: 14200, failed: 2, waiting: 3, skipped: 1 }).text === '12 publishers read · +23 new · 340 total · 14.2 s · 2 failed · 3 loaded a moment ago · 1 not reached: press again');
  ok('rate limited: the seconds to wait', n(429, { ok: false, code: 'rate', retry_after: 42 }).text === 'rate limited, try in 42 s' && n(429, { code: 'rate', retry_after: 42 }).kind === 'wait' && n(429, { code: 'rate_caller', retry_after: 9 }).text === 'too many refreshes, try in 9 s' && n(429, null).text === 'rate limited, try in 60 s');
  ok('a feed that cannot be reached, is not a feed, is too big, or is not allowed', n(502, { code: 'unreachable', detail: 'the site answered HTTP 503' }).text === 'feed unreachable: the site answered HTTP 503' && n(502, { code: 'not_feed' }).text === 'not a feed' && /too large/.test(n(502, { code: 'too_big' }).text) && /not allowed/.test(n(422, { code: 'blocked', detail: 'only https addresses are read' }).text));
  ok('signed out, not allowed, gone, off', /sign in again/.test(n(401, { code: 'auth' }).text) && /may not/.test(n(403, { code: 'forbidden' }).text) && /not on the site/.test(n(404, { code: 'no_source' }).text) && /switched off/.test(n(409, { code: 'off' }).text));
  ok('THE FUNCTION NOT DEPLOYED: the gateway\'s own 404, or no answer, is "needs the news-refresh function deployed"', n(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }).text === 'needs the news-refresh function deployed' && n(404, null).kind === 'missing' && n(0, null).text === 'needs the news-refresh function deployed');
  ok('a 500 says what failed', /the refresh failed \(HTTP 500\)/.test(n(500, null).text) && /boom \(HTTP 500\)/.test(n(500, { error: 'boom' }).text));
}

console.log('-- reaching the function');
{
  const asked = [];
  let out = { data: { ok: true, added: 2, total: 5, took_ms: 500 }, error: null };
  const sb = { functions: { invoke: async (fn, o) => { asked.push([fn, o]); return typeof out === 'function' ? out() : out; } } };
  let r = await NR.call({ sb, source: 'eurohoops' });
  ok('the console\'s client: invoke("news-refresh", { body: { source } })', asked[0][0] === 'news-refresh' && JSON.stringify(asked[0][1]) === '{"body":{"source":"eurohoops"}}' && r.ok && r.text === '+2 new · 5 total · 0.5 s', [asked, r]);
  await NR.call({ sb, all: true });
  ok('...all is { all: true }, and no address ever goes with either', JSON.stringify(asked[1][1]) === '{"body":{"all":true}}');
  const httpErr = (status, json) => ({ data: null, error: { name: 'FunctionsHttpError', context: { status, json: async () => json } } });
  out = httpErr(429, { code: 'rate', retry_after: 42 });
  ok('a refusal comes back through the client\'s error, in words', (await NR.call({ sb, source: 'x' })).text === 'rate limited, try in 42 s');
  out = httpErr(404, { code: 'NOT_FOUND' });
  ok('a function that is not there (the client\'s 404) is said so', (await NR.call({ sb, source: 'x' })).kind === 'missing');
  out = () => { throw new Error('Failed to fetch'); };
  ok('a client that throws is "not deployed", not an exception', (await NR.call({ sb, source: 'x' })).kind === 'missing');
  out = { data: null, error: { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') } };
  ok('...and one whose error has no response (no network, or CORS refused by a missing function) too', (await NR.call({ sb, source: 'x' })).text === 'needs the news-refresh function deployed');
  out = httpErr(502, null);
  ok('...an answer that is not JSON does not throw', (await NR.call({ sb, source: 'x' })).kind === 'err');

  const reqs = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => { reqs.push([u, init]); return globalThis.__reply(); };
  globalThis.__reply = () => new Response(JSON.stringify({ ok: true, added: 1, total: 3, took_ms: 100 }), { status: 200 });
  const cfg = { supabaseUrl: 'https://p.supabase.co', supabaseAnonKey: 'anon' };
  r = await NR.call({ cfg, token: 'jwt', source: 'eurohoops' });
  ok('the public page: POST to /functions/v1/news-refresh with the anon key, the reader\'s token and the slug', reqs[0][0] === 'https://p.supabase.co/functions/v1/news-refresh' && reqs[0][1].method === 'POST' && reqs[0][1].headers.Authorization === 'Bearer jwt' && reqs[0][1].headers.apikey === 'anon' && reqs[0][1].body === '{"source":"eurohoops"}' && r.ok, reqs[0]);
  globalThis.__reply = () => new Response('<html>Not Found</html>', { status: 404 });
  ok('...a 404 with no JSON is "needs the function deployed"', (await NR.call({ cfg, token: 'jwt', source: 'x' })).kind === 'missing');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  ok('...no network, or a preflight the missing function never answered, is the same', (await NR.call({ cfg, token: 'jwt', source: 'x' })).text === 'needs the news-refresh function deployed');
  ok('...with no token there is nothing to send', (await NR.call({ cfg, token: '', source: 'x' })).kind === 'err');
  globalThis.fetch = real;

  const seq = [];
  globalThis.fetch = async (u, init) => { const s = JSON.parse(init.body).source; seq.push(s); return new Response(JSON.stringify(s === 'bad' ? { ok: false, code: 'not_feed' } : s === 'wait' ? { ok: false, code: 'rate', retry_after: 30 } : { ok: true, added: 2, total: 10, took_ms: 1 }), { status: s === 'bad' ? 502 : s === 'wait' ? 429 : 200 }); };
  const m = await NR.callMany({ cfg, token: 'jwt' }, ['a', 'bad', 'wait', 'c']);
  ok('several sources for a league\'s administrator: one request each, in turn, the answers added up', seq.join() === 'a,bad,wait,c' && m.text.startsWith('2 publishers read · +4 new · 20 total') && /1 failed/.test(m.text) && /1 loaded a moment ago/.test(m.text), m);
  globalThis.fetch = real;
}

console.log('-- the button and its line');
{
  const run = outs => { const it = outs[Symbol.iterator](); return async () => it.next().value; };
  const done = [], ended = [];
  const c = NR.control({ label: 'Load now', run: run([NR.normalise(200, { ok: true, added: 7, total: 12, took_ms: 1200 })]), onDone: o => done.push(o), onEnd: o => ended.push(o) });
  ok('a button (type button, the kit\'s classes) and a polite status line', c.button.tagName === 'BUTTON' && c.button.type === 'button' && /ep-btn/.test(c.button.className) && c.button.textContent === 'Load now' && c.status.attrs.role === 'status' && c.status.attrs['aria-live'] === 'polite' && c.status.textContent === '');
  let seen = null;
  const c2 = NR.control({ run: async () => { seen = { text: c2.status.textContent, disabled: c2.button.disabled, cls: c2.status.className }; return NR.normalise(200, { ok: true, added: 7, total: 12, took_ms: 1200 }); }, onDone: o => done.push(o), onEnd: o => ended.push(o) });
  await c2.button.click();
  ok('pressed: it is disabled and says "Loading…" (with a spinner) while it works', seen.disabled === true && /Loading/.test(seen.text) && /busy/.test(seen.cls), seen);
  ok('...then the outcome, in the ok colour, the button back, and the page told (onDone, onEnd)', c2.status.textContent === '+7 new · 12 total · 1.2 s' && /ok/.test(c2.status.className) && c2.button.disabled === false && done.length === 1 && done[0].added === 7 && ended.length === 1);
  const c3 = NR.control({ run: async () => NR.normalise(502, { code: 'unreachable' }), onDone: o => done.push(o), onEnd: o => ended.push(o) });
  await c3.button.click();
  ok('a failure: the words in the error colour, the button back at once, onEnd told and onDone not', c3.status.textContent === 'feed unreachable' && /err/.test(c3.status.className) && c3.button.disabled === false && done.length === 1 && ended.length === 2);
  const c4 = NR.control({ run: async () => NR.normalise(404, null) });
  await c4.button.click();
  ok('a missing function: said, and the button stays usable (the function may be deployed a minute later)', c4.status.textContent === 'needs the news-refresh function deployed' && c4.button.disabled === false);
  const c5 = NR.control({ run: async () => { throw new Error('anything'); } });
  await c5.button.click();
  ok('a run that throws is the same as no answer, never an exception', c5.status.textContent === 'needs the news-refresh function deployed');
  timers.length = 0;
  const c6 = NR.control({ run: async () => NR.normalise(429, { code: 'rate', retry_after: 3 }) });
  await c6.button.click();
  ok('RATE LIMITED: "rate limited, try in 3 s", the button held', c6.status.textContent === 'rate limited, try in 3 s' && c6.button.disabled === true && /wait/.test(c6.status.className));
  timers[0]();
  ok('...counting down each second', c6.status.textContent === 'rate limited, try in 2 s' && c6.button.disabled === true);
  timers[0](); timers[0]();
  ok('...and the button comes back, the line cleared, when the wait is over', c6.button.disabled === false && c6.status.textContent === '' && timers[0] === null);
  let n = 0, release;
  const c7 = NR.control({ run: () => { n++; return new Promise(r => { release = r; }); } });
  const p1 = c7.button.click(); c7.button.click(); c7.button.click();
  release(NR.normalise(200, { ok: true, added: 0, total: 1, took_ms: 1 }));
  await p1;
  ok('pressed three times at once it asks once', n === 1);
}

console.log('-- who is shown the button');
{
  const calls = [];
  const mk = (platform, managed, ids = { kbl: 'L-kbl', acb: 'L-acb' }, signedIn = true) => NR.access({
    rpc: async (fn, args) => { calls.push([fn, args]); if (!signedIn) return null; if (fn === 'is_platform_admin') return platform; if (fn === 'can_manage_news_sources') return managed.has(args.p_league); return null; },
    leagueIdOf: async slug => ids[slug] || null
  });
  let a = mk(true, new Set());
  ok('a platform administrator: any source, a platform one and a league\'s, and "all"', await a.platform() === true && await a.can(null) === true && await a.can('kbl') === true);
  calls.length = 0;
  a = mk(false, new Set(['L-kbl']));
  ok('a league\'s administrator (KBL): their league\'s source, not another\'s, not a platform source, not "all"', await a.can('kbl') === true && await a.can('acb') === false && await a.can(null) === false && await a.platform() === false);
  ok('...asked of the database\'s own functions, once each (kept for the page)', calls.filter(c => c[0] === 'is_platform_admin').length === 1 && calls.filter(c => c[0] === 'can_manage_news_sources').length === 2, calls);
  a = mk(false, new Set());
  ok('an ordinary reader: nothing, and a league that cannot be found is nothing', await a.can('kbl') === false && await a.can('nowhere') === false && await a.platform() === false);
  a = mk(false, new Set(), undefined, false);
  ok('signed out: the rpc answers nothing, and that is no', await a.can('kbl') === false && await a.platform() === false);
  a = NR.access({ rpc: async () => { throw new Error('offline'); }, leagueIdOf: async () => { throw new Error('offline'); } });
  ok('a database that errors is no, never a thrown error and never a button', await a.can('kbl') === false && await a.platform() === false);
}

console.log('-- the console: a button on every source, "Load all" on the platform\'s list');
{
  const C = require(path.join(root, 'epinoia', 'admin', 'creators-ui.js'));
  const SRC = [
    { id: 's1', slug: 'eurohoops', name: 'Eurohoops', site_url: 'https://e.example', feed_url: 'https://e.example/feed', logo_url: null, colour: null, enabled: true, last_fetched_at: null, last_ok_at: null, last_error: null, item_count: 3 },
    { id: 's2', slug: 'basketnews', name: 'BasketNews', site_url: 'https://b.example', feed_url: 'https://b.example/feed', logo_url: null, colour: null, enabled: true, last_fetched_at: null, last_ok_at: null, last_error: 'ECONNRESET', item_count: 0 },
    { id: 's3', slug: 'off', name: 'Off Site', site_url: 'https://o.example', feed_url: 'https://o.example/feed', logo_url: null, colour: null, enabled: false, last_fetched_at: null, last_ok_at: null, last_error: null, item_count: 1 }
  ];
  const invoked = [];
  let reply = async (fn, o) => ({ data: { ok: true, added: 7, updated: 0, total: 12, took_ms: 1200 }, error: null });
  const sb = { rpc: async fn => (fn === 'news_sources_admin' ? { data: SRC.map(s => ({ ...s })), error: null } : { data: null, error: null }), functions: { invoke: async (fn, o) => { invoked.push([fn, o]); return reply(fn, o); } } };
  const said = [];
  const mount = async league => { const host = new El('div'); C.mountSources({ host, sb, say: (m, k) => said.push([m, k]), league }); await tick(); return host; };
  const buttons = (host, label) => host.all().filter(n => n.tagName === 'BUTTON' && n.textContent === label);

  const plat = await mount(null);
  ok('THE PLATFORM\'S LIST: a "Load now" on every source and a "Load all now" above them', buttons(plat, 'Load now').length === 3 && buttons(plat, 'Load all now').length === 1);
  ok('...a switched-off source\'s button is disabled (it would be refused), the others are not', buttons(plat, 'Load now').map(b => b.disabled).join() === 'false,false,true');
  await buttons(plat, 'Load now')[0].click();
  const rowText = plat.textContent;
  ok('pressing one calls news-refresh for THAT source (the slug only), and says what came, on its row', invoked.length === 1 && invoked[0][0] === 'news-refresh' && JSON.stringify(invoked[0][1]) === '{"body":{"source":"eurohoops"}}' && rowText.includes('+7 new · 12 total · 1.2 s'), invoked);
  ok('...and the row\'s own line now says it was read, with the new count', /read .* · 12 stories · https:\/\/e\.example\/feed/.test(rowText) && !/failing: ECONNRESET.*eurohoops/.test(rowText), rowText.slice(0, 500));
  reply = async () => ({ data: null, error: { context: { status: 502, json: async () => ({ ok: false, code: 'unreachable', detail: 'the site answered HTTP 503', last_error: 'feed unreachable: the site answered HTTP 503' }) } } });
  await buttons(plat, 'Load now')[1].click();
  ok('a failure is readable on the row, and its line shows the failing feed', plat.textContent.includes('feed unreachable: the site answered HTTP 503') && /failing: feed unreachable/.test(plat.textContent));
  reply = async () => ({ data: { ok: true, all: true, read: 2, added: 9, updated: 0, total: 15, took_ms: 3000, failed: 0, waiting: 0, skipped: 0 }, error: null });
  invoked.length = 0;
  await buttons(plat, 'Load all now')[0].click();
  await tick();
  ok('"Load all now" calls { all: true }, and its words survive the list being drawn again', JSON.stringify(invoked[0][1]) === '{"body":{"all":true}}' && plat.textContent.includes('2 publishers read · +9 new · 15 total · 3.0 s') && buttons(plat, 'Load all now').length === 1, plat.textContent.slice(0, 300));

  const lg = await mount({ id: 'L-kbl', slug: 'kbl', name: 'KBL' });
  ok('A LEAGUE\'S LIST: a "Load now" on each source and no "Load all"', buttons(lg, 'Load now').length === 3 && buttons(lg, 'Load all now').length === 0);
  globalThis.EpinoiaNewsRefresh = undefined;
  const bare = await mount(null);
  ok('without newsrefresh.js the list is exactly what it was: no buttons, nothing broken', buttons(bare, 'Load now').length === 0 && bare.textContent.includes('Eurohoops') && /switch off/.test(bare.textContent));
  globalThis.EpinoiaNewsRefresh = NR;
}

console.log('-- the News page carries it, for the administrators who may use it');
{
  const page = read('epinoia/news/news-page.js'), html = read('epinoia/news/index.html');
  ok('the page loads newsrefresh.js before news-page.js, and its style before legibility.css (last)', html.indexOf('newsrefresh.js?v') > 0 && html.indexOf('newsrefresh.js?v') < html.indexOf('news-page.js?v') && html.indexOf('newsrefresh.css') < html.indexOf('legibility.css'));
  ok('a control is built only for a signed-in reader ("nrToken") whom access says may ("who.can"): nobody else is given one', /async function loadControl[\s\S]{0,400}!\(await nrToken\(\)\)\) return null;[\s\S]{0,200}!\(await who\.can\(leagueSlug \|\| null\)\)\) return null;/.test(page));
  ok('the Publishers filter\'s button needs a token and either the platform, or a league the reader may manage: otherwise there is none', /async function publishersBar[\s\S]{0,700}!\(await nrToken\(\)\)\) return;[\s\S]{0,400}who\.platform\(\)[\s\S]{0,300}who\.can\(x\.league_slug \|\| null\)[\s\S]{0,200}if \(!mine\.length\) return;/.test(page));
  ok('the publisher\'s page draws the list again with what came (feed.reset), the Publishers filter reloads its feed (load(true))', /loadControl\(src, src\.league && src\.league\.slug, \(\) => feed\.reset\(\)\)/.test(page) && /onDone: \(\) => load\(true\)/.test(page));
  ok('the bar is drawn only under the Publishers switch', /loadHost\.classList\.toggle\('hide', cur\.k !== 'press'/.test(page));
  ok('a failure of any of it never breaks the page (every path is caught)', /\}, \(\) => \{ \/\* the page stands without it \*\/ \}\);/.test(page) && /catch \(_\) \{ \/\* the page stands without it \*\/ \}/.test(page));
  ok('no inline script or handler, and the CSP is unchanged (self scripts, supabase connections)', !/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')) && /script-src 'self'/.test(html) && !/\son(click|load|error)=/.test(read('epinoia/newsrefresh.js')));
  const css = read('epinoia/kit/newsrefresh.css');
  ok('the style: no pixel-face tracking above .2em, the sentence in the readable face, a phone layout, reduced motion respected', !/letter-spacing:\s*\.(2[1-9]|[3-9])/.test(css) && /\.nr-status\{font-family:var\(--f-ui\)/.test(css) && /max-width:820px/.test(css) && /prefers-reduced-motion/.test(css));
  for (const p of ['epinoia/admin/index.html', 'epinoia/admin/platform/index.html']) {
    const h = read(p);
    ok(p + ' carries the script before creators-ui.js and the style before legibility.css', h.indexOf('newsrefresh.js') > 0 && h.indexOf('newsrefresh.js') < h.indexOf('creators-ui.js?v') && h.indexOf('newsrefresh.css') < h.indexOf('legibility.css'));
  }
}

console.log('-- the function is documented, and run in CI');
{
  const doc = read('docs/news-and-creators.md'), guard = read('.github/workflows/guard.yml');
  ok('the docs name the deploy command and the button', /npx supabase functions deploy news-refresh/.test(doc) && /Load now/.test(doc));
  ok('guard.yml runs the function\'s test, the button\'s, the Python fixtures and the CORS check', /news-refresh\.test\.mjs/.test(guard) && /news-refresh-ui\.test\.mjs/.test(guard) && /fetch_feeds_test\.py/.test(guard) && /cors\.test\.mjs/.test(guard));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
