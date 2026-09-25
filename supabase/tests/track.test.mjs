/* ============================================================================
   VISIT COUNTS ARE ANONYMOUS (epinoia/track.js, migration 0173).

   What this pins, because each one would quietly break the promise on the privacy page:
     * the request carries exactly the documented fields and nothing that identifies
       anyone: no user id, email, token, user agent, full referrer URL or path beyond
       the site's own page key;
     * the session token is random, per tab (sessionStorage), never localStorage;
     * nothing is sent when config.js has analytics off, or the browser sends Global
       Privacy Control / Do Not Track, or the privacy page's switch is off;
     * a tab is recorded by its key (data-tab / data-p), never by its (translated) words;
     * staff tools and embeds are never counted;
     * the referrer is a host name only, sent once per visit, never this site itself.

     node supabase/tests/track.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, 'epinoia', 'track.js'));
const X = T._test;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + JSON.stringify(detail) : '')); }
};
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const URL_ = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; }
class Cls { constructor(list) { this.list = new Set(list || []); } contains(c) { return this.list.has(c); } }

function browser(o = {}) {
  const calls = [];
  const listeners = {};
  const ls = o.ls || mem(), ss = o.ss || mem();
  if (o.signedIn) ls.setItem('sb-hhvofgqqadtyvcjudhjx-auth-token', JSON.stringify({ access_token: 'secret-jwt', user: { id: 'u-123', email: 'fan@example.org' } }));
  const doc = {
    documentElement: { lang: o.lang || 'en', classList: new Cls(o.htmlClass) },
    referrer: o.referrer || '', visibilityState: 'visible',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  };
  const env = {
    EPINOIA_CONFIG: { supabaseUrl: URL_, supabaseAnonKey: 'sb_publishable_test', analytics: o.analytics !== false },
    location: { pathname: o.path || '/epinoia/game/', search: o.search || '', hostname: 'prophesyscouting.co.uk' },
    navigator: Object.assign({ userAgent: 'Mozilla/5.0 (Secret Device Model)' }, o.nav || {}),
    localStorage: ls, sessionStorage: ss, document: doc, innerWidth: o.width || 390,
    matchMedia: () => ({ matches: !!o.coarse }), crypto: globalThis.crypto,
    setTimeout: (f, ms) => setTimeout(f, 0), clearTimeout: t => clearTimeout(t),
    addEventListener: (t, fn) => { (listeners['w:' + t] = listeners['w:' + t] || []).push(fn); },
    fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: o.status ? o.status < 300 : true, status: o.status || 200 }; }
  };
  X.env(env);
  return { calls, ls, ss, doc, listeners, env };
}
const GAME = '569d4acb-6a79-439f-95a0-1f208b63e557';

console.log('\nwhere a page is');
ok('the page key is the path below /epinoia/', X.pageKey('/epinoia/stats/wowy/') === 'stats/wowy' && X.pageKey('/epinoia/game/index.html') === 'game');
ok('...the splash is "splash", and a page outside /epinoia/ is nothing', X.pageKey('/epinoia/') === 'splash' && X.pageKey('/index.html') === null);

console.log('\nwhat one view sends');
{
  const B = browser({ path: '/epinoia/game/', search: '?g=' + GAME + '&mode=supabase&email=x@y.z', signedIn: true,
                      referrer: 'https://www.google.com/search?q=private+words', lang: 'ja', htmlClass: ['m-app'], width: 390 });
  T.boot();
  await T.flush(false);
  const c = B.calls[0];
  ok('one request, to analytics_track', B.calls.length === 1 && /\/rest\/v1\/rpc\/analytics_track$/.test(c.url), B.calls.map(x => x.url));
  ok('it carries exactly the documented fields',
     JSON.stringify(Object.keys(c.body).sort()) === JSON.stringify(['p_app', 'p_device', 'p_events', 'p_lang', 'p_ref', 'p_session', 'p_signed_in']), Object.keys(c.body));
  ok('...and each event exactly its own', JSON.stringify(Object.keys(c.body.p_events[0]).sort()) === JSON.stringify(['game', 'kind', 'league', 'page', 'team']), c.body.p_events[0]);
  const text = JSON.stringify(c.body) + JSON.stringify(c.init.headers);
  ok('nothing that identifies anyone: no user id, email, token or user agent',
     !/u-123|fan@example|secret-jwt|Secret Device|x@y\.z/.test(text), text);
  ok('signed in travels as yes/no only', c.body.p_signed_in === true);
  ok('the referrer is the other site’s host only — never its path or search words', c.body.p_ref === 'google.com' && !/private|search/.test(text));
  ok('the game comes from the address; unrelated query parameters do not travel', c.body.p_events[0].game === GAME && c.body.p_events[0].page === 'game');
  ok('device, language and app are the coarse classes', c.body.p_device === 'phone' && c.body.p_lang === 'ja' && c.body.p_app === 'android');
  ok('the session token is random, 24 characters, kept in sessionStorage and never localStorage',
     /^[A-Za-z0-9_-]{24}$/.test(c.body.p_session) && B.ss.getItem('epinoia_visit') === c.body.p_session &&
     !Object.values(B.ls._m).includes(c.body.p_session));
  ok('...sent with the public key only, no account token', c.init.headers.apikey === 'sb_publishable_test' && !('Authorization' in c.init.headers));
}

console.log('\nthe referrer, once');
{
  const ss = mem();
  let B = browser({ ss, referrer: 'https://t.co/abc' }); T.boot(); await T.flush(false);
  const first = B.calls[0].body.p_ref, firstTok = B.calls[0].body.p_session;
  B = browser({ ss, referrer: 'https://t.co/abc' }); T.boot(); await T.flush(false);
  ok('sent on the visit’s first page, not again', first === 't.co' && B.calls[0].body.p_ref === null, [first, B.calls[0].body.p_ref]);
  B = browser({ referrer: 'https://prophesyscouting.co.uk/epinoia/home/' }); T.boot(); await T.flush(false);
  ok('moving within the site is not a referrer', B.calls[0].body.p_ref === null);
  ok('the next tab is a new visit with a new token', B.calls[0].body.p_session !== firstTok && B.calls[0].body.p_session.length === 24);
}

console.log('\nnothing is sent when');
for (const [name, o] of [
  ['config.js has analytics off (0173 not applied)', { analytics: false }],
  ['the browser sends Global Privacy Control', { nav: { globalPrivacyControl: true } }],
  ['the browser sends Do Not Track', { nav: { doNotTrack: '1' } }],
  ['the privacy page’s switch is off', { ls: (() => { const m = mem(); m.setItem('epinoia_no_count', '1'); return m; })() }],
  ['the page is a staff tool (admin console)', { path: '/epinoia/admin/platform/' }],
  ['the page is the statistician’s scorer', { path: '/epinoia/score/' }],
  ['the page is an embed on another site', { path: '/epinoia/embed/table/' }]
]) {
  const B = browser(o); T.boot(); await T.flush(false); await tick(5);
  ok(name, B.calls.length === 0, B.calls.length);
}
{
  const B = browser({}); T.setCounting(false); T.boot(); await T.flush(false);
  ok('switching counting off from the privacy page stops it at once and remembers it',
     B.calls.length === 0 && B.ls.getItem('epinoia_no_count') === '1' && T.counting() === false);
  T.setCounting(true);
  ok('...and switching it on again clears the setting', B.ls.getItem('epinoia_no_count') === null && T.counting() === true);
}

console.log('\ntabs');
{
  const B = browser({ path: '/epinoia/game/', search: '?g=' + GAME });
  T.boot();
  const btn = (attrs, text, cls) => ({
    dataset: attrs, className: cls || '', textContent: text,
    getAttribute: k => (k === 'role' ? attrs.role || null : null),
    hasAttribute: k => (k === 'data-tab' ? 'tab' in attrs : false),
    closest() { return this; }
  });
  const click = t => X.onClick({ target: t });
  click(btn({ tab: 'shotclock' }, 'ショットクロック分析', 'tabbtn'));
  click(btn({ p: 'Box' }, 'box score', 'ep-tab'));
  click(btn({ key: 'fixtures' }, 'fixtures', 'rail-item'));
  click(btn({ tab: 'drop table;' }, 'x', 'tabbtn'));
  await T.flush(false);
  const tabs = B.calls[0].body.p_events.filter(e => e.kind === 'tab');
  ok('a tab is recorded by its key, not its translated words', tabs.some(e => e.tab === 'shotclock') && !JSON.stringify(tabs).includes('ショット'), tabs);
  ok('...keys are lower-cased; a link with a data-key that is not a tab is not a tab', tabs.some(e => e.tab === 'box') && !tabs.some(e => e.tab === 'fixtures'), tabs);
  ok('...a key that is not a key is dropped', !tabs.some(e => /drop/.test(e.tab)), tabs);
  ok('...and the tab carries its page and game', tabs.every(e => e.page === 'game' && e.game === GAME));
}

console.log('\nwhen the database is not ready');
{
  const B = browser({ status: 404 });
  T.boot(); await T.flush(false);
  X.queue.push({ kind: 'view', page: 'home' });
  await T.flush(false);
  ok('a refused call (0173 not applied) stops this page sending again', B.calls.length === 1, B.calls.length);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
