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

console.log('\nvisits that are not fans are not counted');
{
  const UA = {
    claudeApp: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.9939.2 Chrome/152.0.7977.130 Safari/537.36',
    headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
    googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    playwright: 'Mozilla/5.0 (Windows NT 10.0) Playwright/1.45 Chrome/126',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    cubot: 'Mozilla/5.0 (Linux; Android 12; CUBOT KingKong 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
  };
  for (const [name, o] of [
    ['the Claude app\u2019s browser (its user agent says Claude)', { nav: { userAgent: UA.claudeApp, webdriver: false } }],
    ['a browser an automation tool reports as driven (navigator.webdriver)', { nav: { userAgent: UA.chrome, webdriver: true } }],
    ['a headless browser', { nav: { userAgent: UA.headless } }],
    ['Playwright by name', { nav: { userAgent: UA.playwright } }],
    ['a crawler', { nav: { userAgent: UA.googlebot } }]
  ]) {
    const B = browser(o); T.boot(); await T.flush(false); await tick(5);
    ok(name + ' is not counted', B.calls.length === 0 && X.automated() === true, B.calls.length);
  }
  for (const [name, o] of [
    ['an iPhone', { nav: { userAgent: UA.iphone } }],
    ['a desktop Chrome', { nav: { userAgent: UA.chrome, webdriver: false } }],
    ['a phone whose maker\u2019s name ends in \u201cbot\u201d (Cubot)', { nav: { userAgent: UA.cubot } }]
  ]) {
    const B = browser(o); T.boot(); await T.flush(false); await tick(5);
    ok(name + ' is counted', B.calls.length === 1 && X.automated() === false, B.calls.length);
  }
  { const B = browser({ nav: { userAgent: UA.iphone } }); T.boot(); await T.flush(false);
    ok('...and the user agent is decided on here and never sent', !JSON.stringify(B.calls).includes('iPhone') && !JSON.stringify(B.calls).includes('Mozilla')); }

  const staff = () => { const m = mem(); m.setItem('epinoia_staff', '1'); return m; };
  { const B = browser({ signedIn: true, ls: (() => { const m = staff(); m.setItem('sb-hhvofgqqadtyvcjudhjx-auth-token', JSON.stringify({ user: { id: 'u' } })); return m; })() });
    T.boot(); await T.flush(false); await tick(5);
    ok('the site\u2019s staff, signed in, are not counted', B.calls.length === 0 && X.staffSignedIn() === true, B.calls.length); }
  { const B = browser({ ls: staff() }); T.boot(); await T.flush(false);
    ok('...but the same browser signed out is a visitor like any other', B.calls.length === 1 && X.staffSignedIn() === false, B.calls.length); }
  { const B = browser({ signedIn: true }); T.boot(); await T.flush(false);
    ok('an ordinary signed-in fan is still counted (as \u201csigned in\u201d)', B.calls.length === 1 && B.calls[0].body.p_signed_in === true, B.calls.length); }
  { const B = browser({ signedIn: true }); T.boot();
    B.ls.setItem('epinoia_staff', '1');            // whoami() answers after the page view was queued
    await T.flush(false); await tick(5);
    ok('a page view queued before whoami() said this is staff is dropped, not sent', B.calls.length === 0 && X.queue.length === 0, [B.calls.length, X.queue.length]); }
  { const B = browser({ signedIn: true, ls: (() => { const m = staff(); m.setItem('sb-hhvofgqqadtyvcjudhjx-auth-token', JSON.stringify({ user: { id: 'u' } })); return m; })() });
    const r = await T.search({ q: 'brisbane', n: 3, kind: 'team', ref: 'brisbane-bullets' });
    ok('staff searches are not counted either', B.calls.length === 0 && r === 0, B.calls.length); }
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

console.log('\nthe search box (0180)');
{
  const B = browser({ signedIn: true, lang: 'es', width: 1400 });
  const r = await T.search({ q: 'Michael Diggins', n: 3, kind: 'player', ref: 'Bristol-Flyers-Michael-Diggins' });
  const c = B.calls[0];
  ok('a finished search goes to analytics_search, and to nothing else', r === 1 && B.calls.length === 1 && /\/rest\/v1\/rpc\/analytics_search$/.test(c.url), B.calls.map(x => x.url));
  ok('it carries exactly the documented fields', JSON.stringify(Object.keys(c.body).sort()) === JSON.stringify(['p_app', 'p_device', 'p_lang', 'p_picked', 'p_q', 'p_ref', 'p_results']), Object.keys(c.body));
  ok('NO SESSION TOKEN, no account, no email, no user agent: a search is tied to nothing', !('p_session' in c.body) && !/u-123|fan@example|secret-jwt|Secret Device/.test(JSON.stringify(c.body) + JSON.stringify(c.init.headers) ), c.body);
  ok('...and no sign-in flag either (a search does not say whether you are signed in)', !('p_signed_in' in c.body));
  ok('the page name of what was picked is a lower-case slug, the kind one of three', c.body.p_ref === 'bristol-flyers-michael-diggins' && c.body.p_picked === 'player' && c.body.p_results === 3);
  ok('device, language and app are the coarse classes', c.body.p_device === 'desktop' && c.body.p_lang === 'es' && c.body.p_app === 'web');
  ok('sent with the public key only', c.init.headers.apikey === 'sb_publishable_test' && !('Authorization' in c.init.headers));
}
{
  for (const [what, o] of [['an email address', { q: 'me@example.com' }], ['a phone number', { q: '+44 7700 900123' }], ['a web address', { q: 'https://example.org/x' }],
                          ['www', { q: 'www.site.io' }], ['a domain', { q: 'mysite.com' }], ['one letter', { q: 'a' }], ['nothing', { q: '   ' }], ['no object', null]]) {
    const B = browser();
    const r = await T.search(o);
    ok('a query that is ' + what + ' is never sent', r === 0 && B.calls.length === 0, B.calls.length);
  }
  let B = browser();
  await T.search({ q: 'cole 15', n: 1 });
  ok('a short number is a search like any other ("cole 15")', B.calls.length === 1);
  B = browser();
  await T.search({ q: 'x'.repeat(300), n: 999, kind: 'admin', ref: 'x' });
  ok('a long query is cut, the count capped, a kind that is not one dropped with its name', B.calls[0].body.p_q.length === 100 && B.calls[0].body.p_results === 30 && B.calls[0].body.p_picked === null && B.calls[0].body.p_ref === null, B.calls[0].body);
  B = browser({ ref: undefined });
  await T.search({ q: 'diggins', n: 1, kind: 'team', ref: 'Not A Slug!' });
  ok('a page name that is not a slug is dropped, the kind stays', B.calls[0].body.p_picked === 'team' && B.calls[0].body.p_ref === null);
}
{
  const off = [['config.js has analytics off', { analytics: false }], ['Global Privacy Control', { nav: { globalPrivacyControl: true } }], ['Do Not Track', { nav: { doNotTrack: '1' } }]];
  for (const [what, o] of off) { const B = browser(o); await T.search({ q: 'diggins', n: 1 }); ok('nothing is sent when ' + what, B.calls.length === 0); }
  const ls = mem(); ls.setItem('epinoia_no_count', '1');
  const B = browser({ ls });
  await T.search({ q: 'diggins', n: 1 });
  ok('...or when the privacy page\'s switch is off', B.calls.length === 0);
}
{
  const B = browser({ status: 404 });
  await T.search({ q: 'diggins', n: 1 });
  await T.search({ q: 'newcastle', n: 1 });
  ok('a refused call (0180 not applied) stops the search reports, and only those (a page view still goes)', B.calls.length === 1);
  T.boot(); await T.flush(false);
  ok('...the page views are their own switch', B.calls.length === 2 && /analytics_track$/.test(B.calls[1].url), B.calls.map(x => x.url));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
