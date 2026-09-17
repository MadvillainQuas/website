/* ============================================================================
   THE APP NEVER SHOWS THE WATER, AND A TAB ALWAYS CAN.

   epinoia/appmode.js runs blocking in <head> on every page that links the
   manifest. It decides whether the page is inside the installed app or the
   Android app, applies the saved theme before paint, stores what the Android
   shell said about itself, and on the splash document (data-water="front")
   inside the app leaves for HOME before the pool can paint.

   This runs the real file in node's vm against a stub window, document,
   location, storage and matchMedia, one fresh context per case:

     plain tab · ?source=pwa · ?source=twa · android-app:// referrer ·
     display-mode standalone · the stored flag · ?l=bcb · empty ?l= ·
     #access_token and ?code= kept · shell/notif/chan stored ·
     the news archive not redirected · HOME not redirected · theme ·
     in the app, links outside /epinoia/ opened in a browser tab (and
     everything that must be left alone left alone)

     node supabase/tests/appmode.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const SRC = rd('epinoia', 'appmode.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

class Store {
  constructor(init) { this.m = new Map(Object.entries(init || {})); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/* One page load. url is path + query + hash on prophesyscouting.co.uk. */
function load(url, o = {}) {
  const u = new URL(url, 'https://prophesyscouting.co.uk');
  const cls = new Set();
  const attrs = {};
  const root = {
    classList: { add: c => cls.add(c), contains: c => cls.has(c), remove: c => cls.delete(c) },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    style: {}
  };
  const meta = { content: o.metaColour || '#04100b', setAttribute(k, v) { if (k === 'content') this.content = v; } };
  const tagAttrs = Object.assign({}, o.tag || {});
  if (o.water != null) tagAttrs['data-water'] = o.water;
  const script = { getAttribute: k => (k in tagAttrs ? tagAttrs[k] : null) };
  const replaced = [];
  const ss = new Store(o.session);
  const ls = new Store(o.local);
  const listeners = {};
  const ctx = {
    URLSearchParams, URL,
    JSON, Number, Date, isFinite, String,
    document: {
      documentElement: root,
      referrer: o.referrer || '',
      currentScript: script,
      querySelector: sel => (sel === 'meta[name="theme-color"]' && !o.noMeta ? meta : null),
      addEventListener: (t, f, opt) => { (listeners[t] = listeners[t] || []).push({ f, opt }); }
    },
    location: {
      href: u.href, origin: u.origin,
      pathname: u.pathname, search: u.search, hash: u.hash,
      replace: to => { replaced.push({ to, hiddenFirst: root.style.display === 'none' }); }
    },
    navigator: { standalone: o.iosStandalone === true ? true : undefined, userAgent: o.ua || '' },
    sessionStorage: ss,
    localStorage: ls,
    matchMedia: q => ({ matches: (o.media || []).includes(q) })
  };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx, { filename: 'appmode.js' });
  return { ctx, cls, attrs, root, meta, replaced, ss, ls, listeners };
}

/* A link, and a click on it (or on a child of it) as the document's listeners see it. */
function link(href, attrs = {}) {
  const a = { tagName: 'A', nodeType: 1, attrs: Object.assign({}, href == null ? {} : { href }, attrs) };
  a.getAttribute = k => (k in a.attrs ? a.attrs[k] : null);
  a.setAttribute = (k, v) => { a.attrs[k] = String(v); };
  a.hasAttribute = k => k in a.attrs;
  a.closest = sel => (sel === 'a[href]' && 'href' in a.attrs ? a : null);
  return a;
}
function click(r, target, ev = {}) {
  const e = Object.assign({ type: 'click', target, button: 0, defaultPrevented: false,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, ev);
  (r.listeners.click || []).forEach(l => l.f(e));
  return target;
}

/* ---------------------------------------------------------------- a tab --- */
{
  const r = load('/epinoia/', { water: 'front' });
  ok('plain tab: not the app', r.ctx.window.epinoiaApp === false && !r.cls.has('m-app'));
  ok('plain tab: the splash stays (no redirect, root shown)', r.replaced.length === 0 && r.root.style.display !== 'none');
  ok('plain tab: no flag stored', r.ss.getItem('epinoia_app') === null);
  ok('plain tab: no ground painted on the root', !r.root.style.background);
}

/* ------------------------------------------------------------ detection --- */
{
  const r = load('/epinoia/?source=pwa', { water: 'front' });
  ok('?source=pwa: the app', r.ctx.window.epinoiaApp === true && r.cls.has('m-app'));
  ok('?source=pwa: flag saved for the session', r.ss.getItem('epinoia_app') === '1');
  ok('?source=pwa on the splash: replaced with HOME, query kept',
     r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/?source=pwa', JSON.stringify(r.replaced));
  ok('the root is hidden BEFORE location.replace (no pool paint, no pool-*.jpg)', r.replaced[0] && r.replaced[0].hiddenFirst);
  ok('in the app the ground colour is on the root', r.root.style.background === '#f3faf6', r.root.style.background);
}
{
  const r = load('/epinoia/?source=twa', { water: 'front' });
  ok('?source=twa: the app, and off the splash', r.ctx.window.epinoiaApp === true
     && r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/?source=twa');
}
{
  const r = load('/epinoia/', { water: 'front', referrer: 'android-app://uk.co.prophesyscouting.epinoia/' });
  ok('android-app:// referrer: the app, and off the splash', r.cls.has('m-app') && r.replaced.length === 1
     && r.replaced[0].to === '/epinoia/home/');
}
{
  const r = load('/epinoia/', { water: 'front', referrer: 'https://www.google.com/' });
  ok('an ordinary referrer is not the app', !r.cls.has('m-app') && r.replaced.length === 0);
}
{
  const r = load('/epinoia/', { water: 'front', media: ['(display-mode: standalone)'] });
  ok('display-mode standalone: the app, and off the splash', r.cls.has('m-app') && r.replaced.length === 1);
}
{
  /* a desktop browser in F11 full screen matches this too: it must stay an ordinary tab */
  const r = load('/epinoia/', { water: 'front', media: ['(display-mode: fullscreen)'] });
  ok('display-mode fullscreen alone is NOT the app (F11 browser tab keeps the splash, no flag)',
     !r.cls.has('m-app') && r.replaced.length === 0 && r.ss.getItem('epinoia_app') === null);
}
{
  const r = load('/epinoia/score/', { tag: { 'data-no-ground': '' }, session: { epinoia_app: '1' } });
  ok('data-no-ground (the always-dark scorer): the app, but no ground on the root',
     r.cls.has('m-app') && !r.root.style.background, r.root.style.background);
  const score = rd('epinoia', 'score', 'index.html');
  ok('score/index.html loads appmode.js with data-no-ground',
     /<script src="\.\.\/appmode\.js\?v=\d+" data-no-ground><\/script>/.test(score));
}
{
  const r = load('/epinoia/', { water: 'front', iosStandalone: true });
  ok('navigator.standalone (iOS home screen): the app', r.cls.has('m-app') && r.replaced.length === 1);
}
{
  const r = load('/epinoia/', { water: 'front', session: { epinoia_app: '1' } });
  ok('stored flag (an in-app link to /epinoia/ with no ?source=): the app, and off the splash',
     r.ctx.window.epinoiaApp === true && r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/');
}
{
  const r = load('/epinoia/index.html', { water: 'front', session: { epinoia_app: '1' } });
  ok('/epinoia/index.html is the splash too', r.replaced.length === 1);
}

/* -------------------------------------------------------------- leagues --- */
{
  const r = load('/epinoia/?l=bcb&source=pwa', { water: 'front' });
  ok('?l=bcb in the app: the league front page stays', r.cls.has('m-app') && r.replaced.length === 0
     && r.root.style.display !== 'none');
}
{
  const r = load('/epinoia/?l=&source=pwa', { water: 'front' });
  ok('empty ?l= in the app is the splash (as mode.js says): off to HOME',
     r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/?l=&source=pwa', JSON.stringify(r.replaced));
}

/* --------------------------------------------------------- sign-in tokens --- */
{
  const r = load('/epinoia/?source=pwa#access_token=abc.def&refresh_token=xyz&type=magiclink', { water: 'front' });
  ok('#access_token survives the redirect',
     r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/?source=pwa#access_token=abc.def&refresh_token=xyz&type=magiclink',
     JSON.stringify(r.replaced));
}
{
  const r = load('/epinoia/?code=123-456', { water: 'front', session: { epinoia_app: '1' } });
  ok('?code= survives the redirect', r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/?code=123-456');
}

/* ---------------------------------------------------------- Android shell --- */
{
  const r = load('/epinoia/home/?source=twa&shell=3&notif=1&chan=4');
  const s = JSON.parse(r.ss.getItem('epinoia_shell') || 'null');
  ok('shell/notif/chan stored in sessionStorage epinoia_shell',
     s && s.shell === 3 && s.notif === 1 && s.chan === 4, r.ss.getItem('epinoia_shell'));
  ok('HOME is never redirected, even in the app', r.replaced.length === 0 && r.root.style.display !== 'none');
}
{
  const r = load('/epinoia/home/?source=twa&notif=0', { session: { epinoia_shell: '{"shell":3,"chan":4}' } });
  const s = JSON.parse(r.ss.getItem('epinoia_shell') || 'null');
  ok('a later launch updates only what it carries', s && s.shell === 3 && s.chan === 4 && s.notif === 0, r.ss.getItem('epinoia_shell'));
}
{
  const r = load('/epinoia/home/?shell=3&notif=1&chan=4');
  ok('shell params in a plain tab (no app signal) are not stored', r.ss.getItem('epinoia_shell') === null);
}
{
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const SAMSUNG = 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';

  /* an App Link (the digest email's root link) launches with the report but no ?source=twa */
  const r = load('/epinoia/?shell=3&notif=1&chan=4', { water: 'front', ua: CHROME_ANDROID });
  ok('the launcher\'s shell=, notif= and chan= in Chrome on Android: the app, even without ?source=twa',
     r.ctx.window.epinoiaApp === true && r.cls.has('m-app') && r.ss.getItem('epinoia_app') === '1');
  ok('...so an App Link to the root never shows the water: replaced with HOME, query kept',
     r.replaced.length === 1 && r.replaced[0].to === '/epinoia/home/?shell=3&notif=1&chan=4' && r.replaced[0].hiddenFirst, JSON.stringify(r.replaced));
  ok('...the report stored', JSON.parse(r.ss.getItem('epinoia_shell') || '{}').shell === 3);
  ok('...and the app remembered beyond this session (localStorage epinoia_twa_seen)', r.ls.getItem('epinoia_twa_seen') === '3');

  const s = load('/epinoia/?shell=3&notif=1&chan=4', { water: 'front', ua: SAMSUNG });
  ok('the same URL in Samsung Internet: not the app, the splash stays', s.ctx.window.epinoiaApp === false && s.replaced.length === 0);
  const t = load('/epinoia/home/?source=twa&shell=3&notif=1&chan=4', { ua: SAMSUNG });
  ok('...and a Samsung Internet app session never marks the phone as having run the app', t.ls.getItem('epinoia_twa_seen') === null);

  const lone = load('/epinoia/?shell=3', { water: 'front', ua: CHROME_ANDROID });
  ok('a lone ?shell= (a pasted link) is not the app', lone.ctx.window.epinoiaApp === false && lone.replaced.length === 0);
  const junk = load('/epinoia/?shell=abc&notif=1&chan=4', { water: 'front', ua: CHROME_ANDROID });
  ok('a shell= that is not a build number is not the app', junk.ctx.window.epinoiaApp === false);
  const desk = load('/epinoia/?shell=3&notif=1&chan=4', { water: 'front', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36' });
  ok('the report on a desktop browser is not the app', desk.ctx.window.epinoiaApp === false && desk.replaced.length === 0);
}

/* ----------------------------------------------------- pages that stay put --- */
{
  const r = load('/epinoia/news/?source=pwa', { session: { epinoia_app: '1' } });
  ok('the news archive (no league, no data-water) is not redirected', r.cls.has('m-app') && r.replaced.length === 0
     && r.root.style.display !== 'none');
}
{
  const r = load('/epinoia/news/', { water: 'front', session: { epinoia_app: '1' } });
  ok('the news archive is not redirected even if its tag wrongly said data-water="front"', r.replaced.length === 0);
}
{
  const r = load('/epinoia/home/', { session: { epinoia_app: '1' }, media: ['(display-mode: standalone)'] });
  ok('HOME in the installed app: not redirected', r.cls.has('m-app') && r.replaced.length === 0);
}

/* ---------------------------------------------------------------- theme --- */
{
  const r = load('/epinoia/home/', { metaColour: '#f3faf6' });
  ok('no saved theme: light, theme-color #f3faf6', r.attrs['data-theme'] === 'light' && r.meta.content === '#f3faf6');
}
{
  const r = load('/epinoia/home/', { metaColour: '#f3faf6', local: { epinoia_theme: 'dark' } });
  ok('saved dark: no light attribute, theme-color #04100b', !('data-theme' in r.attrs) && r.meta.content === '#04100b', r.meta.content);
}
{
  const r = load('/epinoia/stats/', { local: { epinoia_theme: 'light' } });
  ok('saved light on a dark-headed page: theme-color #f3faf6', r.attrs['data-theme'] === 'light' && r.meta.content === '#f3faf6');
}
{
  const r = load('/epinoia/home/?source=pwa', { local: { epinoia_theme: 'dark' } });
  ok('dark reader in the app: dark ground on the root', r.root.style.background === '#04100b');
}
{
  const r = load('/epinoia/home/', { noMeta: true });
  ok('a page with no theme-color meta does not throw', r.attrs['data-theme'] === 'light');
}

/* --------------------------------------------- links out of /epinoia/ in the app --- */
{
  const tab = load('/epinoia/stats/?l=bcb');
  ok('a plain tab attaches no click listener (nothing changes for a website visitor)', !(tab.listeners.click || []).length);

  const r = load('/epinoia/stats/?l=bcb', { session: { epinoia_app: '1' } });
  ok('in the app: exactly one document click listener', (r.listeners.click || []).length === 1, (r.listeners.click || []).length);

  const out = click(r, link('/index_9.html'));
  ok('in the app: a same-origin link outside /epinoia/ gets target=_blank rel=noopener',
     out.attrs.target === '_blank' && out.attrs.rel === 'noopener', JSON.stringify(out.attrs));
  const abs = click(r, link('https://prophesyscouting.co.uk/allstats.html'));
  ok('...written as an absolute URL too', abs.attrs.target === '_blank');
  const up = click(r, link('../../'));
  ok('...and a relative climb out of /epinoia/ (../../ from stats/ is the site root)', up.attrs.target === '_blank', JSON.stringify(up.attrs));
  const relKept = click(r, link('/', { rel: 'nofollow' }));
  ok('...an existing rel keeps its tokens and gains noopener', relKept.attrs.rel === 'nofollow noopener', relKept.attrs.rel);

  const child = link('/index_9.html');
  const span = { nodeType: 1, closest: sel => child.closest(sel) };
  click(r, span);
  ok('a click on an element inside the link is handled', child.attrs.target === '_blank');
  const txt = link('/index_9.html');
  click(r, { nodeType: 3, parentNode: { nodeType: 1, closest: sel => txt.closest(sel) } });
  ok('a click whose target is a text node is handled', txt.attrs.target === '_blank');

  [
    ['an /epinoia/ link', link('/epinoia/home/')],
    ['a relative link inside /epinoia/', link('../games/')],
    ['/epinoia with no slash', link('/epinoia')],
    ['a same-page anchor', link('#leagues')],
    ['a download', link('/files/report.pdf', { download: '' })],
    ['a link that already has a target', link('/index_9.html', { target: '_self' })],
    ['another origin', link('https://example.com/')],
    ['mailto:', link('mailto:hello@example.com')],
    ['javascript:', link('javascript:void(0)')],
    ['an <a> with no href', link(null)]
  ].forEach(([name, a]) => {
    const before = JSON.stringify(a.attrs);
    click(r, a);
    ok('left alone: ' + name, JSON.stringify(a.attrs) === before, JSON.stringify(a.attrs));
  });
  [
    ['ctrl-click', { ctrlKey: true }], ['cmd-click', { metaKey: true }], ['shift-click', { shiftKey: true }],
    ['alt-click', { altKey: true }], ['middle click', { button: 1 }], ['a click a page script prevented', { defaultPrevented: true }]
  ].forEach(([name, ev]) => {
    const a = link('/index_9.html');
    click(r, a, ev);
    ok('left alone: ' + name, !('target' in a.attrs));
  });

  const onSplash = load('/epinoia/?source=twa', { water: 'front' });
  ok('the splash redirect still attaches the listener (it is harmless) and still redirects',
     onSplash.replaced.length === 1 && (onSplash.listeners.click || []).length === 1);
  ok('appmode.js adds no other listener', Object.keys(r.listeners).join() === 'click', Object.keys(r.listeners).join());
}

/* ------------------------------------------------------------ the markup --- */
{
  const front = rd('epinoia', 'index.html');
  const a = front.indexOf('<script src="appmode.js?v=');
  const m = front.indexOf('<script src="mode.js?v=');
  ok('index.html loads appmode.js with data-water="front" immediately before mode.js',
     a > 0 && m > a && /<script src="appmode\.js\?v=\d+" data-water="front"><\/script>\s*<script src="mode\.js/.test(front));
  const home = rd('epinoia', 'home', 'index.html');
  const head = home.slice(0, home.indexOf('</head>'));
  const firstScript = head.indexOf('<script');
  ok('HOME loads ../appmode.js first in <head>, without data-water',
     firstScript > 0 && head.slice(firstScript).startsWith('<script src="../appmode.js?v=')
     && !/appmode\.js[^>]*data-water/.test(head));
  ok('HOME never loads mode.js or splash.css', !/mode\.js/.test(home.replace(/appmode\.js/g, '')) && !/splash\.css/.test(home));
  const news = rd('epinoia', 'news', 'index.html');
  ok('the news archive carries appmode.js without data-water', /<script src="\.\.\/appmode\.js\?v=\d+"><\/script>/.test(news)
     && !/appmode\.js[^>]*data-water/.test(news));
  const manifest = JSON.parse(rd('epinoia', 'manifest.webmanifest'));
  ok('manifest start_url is HOME with ?source=pwa, id and scope unchanged',
     manifest.start_url === '/epinoia/home/?source=pwa' && manifest.id === '/epinoia/' && manifest.scope === '/epinoia/');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
