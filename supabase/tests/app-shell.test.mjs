/* ============================================================================
   THE APP SHELL ON THE WEBSITE (roadmap Phase 6, "Change").

   The Android app shows the live site, so the site has to know where it is
   being read and say the right thing there:

     1. window.EpinoiaAppShell (nav.js), the pure decisions: where the page is
        being read (the app, an iPhone, an Android browser, anything else),
        what the install banner offers, who gets HOME's app card, whether the
        launch's shell build is below version.json's minShell, and version.json
        fetched at most once a session;
     2. the rail's banners, nav.js run in node against a stub DOM:
          in the app                 no install banner, ever
          an Android browser         the Android app, linking to android/
          the download page          nothing (it is the offer)
          an iPhone                  Add to Home Screen, as it always was
          a desktop                  nothing without beforeinstallprompt
          the app, shell < minShell  "Update the Epinoia app", dismissible
     3. HOME's card (home/front.js paintApp): Android browsers only, with the
        version once version.json answers;
     4. the stylesheets carry what the markup needs, in both themes, and the
        club caption can no longer push a phone's page wider than the screen.

     node supabase/tests/app-shell.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const NAV = rd('epinoia', 'nav.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));
const tick = () => new Promise(r => setTimeout(r, 0));

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
};

class Store {
  constructor(init) { this.m = new Map(Object.entries(init || {})); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/* ------------------------------------------------------------------ 1 --- */
console.log('\n-- window.EpinoiaAppShell');

/* nav.js with a rail already on the page: it defines the shell API and returns. */
function shellApi() {
  const ctx = { console, JSON, Number, Promise, String, RegExp, Object, Array, Error,
    document: { querySelector: () => ({}) } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(NAV, ctx, { filename: 'nav.js' });
  return ctx.window.EpinoiaAppShell;
}
const S = shellApi();
ok('nav.js defines window.EpinoiaAppShell before its early returns', !!S && typeof S.installOffer === 'function');

const env = (ua, o = {}) => Object.assign({ ua, platform: '', maxTouchPoints: 0 }, o);
eq('where: Chrome on Android', S.where(env(UA.chromeAndroid)), 'android');
eq('where: Samsung Internet', S.where(env(UA.samsung)), 'android');
eq('where: Firefox on Android', S.where(env(UA.firefoxAndroid)), 'android');
eq('where: iPhone', S.where(env(UA.iphone)), 'ios');
eq('where: iPad asking for the desktop site (MacIntel with touch)', S.where(env(UA.ipadDesktop, { platform: 'MacIntel', maxTouchPoints: 5 })), 'ios');
eq('where: a Mac', S.where(env(UA.ipadDesktop, { platform: 'MacIntel', maxTouchPoints: 0 })), 'other');
eq('where: Windows desktop', S.where(env(UA.desktop)), 'other');
eq('where: window.epinoiaApp wins over an Android UA', S.where(env(UA.chromeAndroid, { app: true })), 'app');
eq('where: html.m-app wins over an Android UA', S.where(env(UA.samsung, { mApp: true })), 'app');
eq('where: nothing known', S.where(undefined), 'other');

eq('installOffer: Android browser, app released -> the Android app', S.installOffer(env(UA.chromeAndroid, { path: '/epinoia/stats/', released: true })), 'android-app');
eq('installOffer: Samsung Internet, app released -> the Android app', S.installOffer(env(UA.samsung, { path: '/epinoia/home/', released: true })), 'android-app');
eq('installOffer: Android browser, app not released yet -> the web app, as before', S.installOffer(env(UA.chromeAndroid, { path: '/epinoia/stats/' })), 'web');
eq('installOffer: Samsung Internet, released: false -> the web app', S.installOffer(env(UA.samsung, { path: '/epinoia/home/', released: false })), 'web');
eq('installOffer: a truthy non-boolean released does not count', S.installOffer(env(UA.samsung, { path: '/epinoia/home/', released: 'yes' })), 'web');
eq('installOffer: in the app -> none', S.installOffer(env(UA.chromeAndroid, { app: true, path: '/epinoia/home/' })), 'none');
eq('installOffer: installed iPhone web app -> none', S.installOffer(env(UA.iphone, { mApp: true })), 'none');
eq('installOffer: the download page itself -> none', S.installOffer(env(UA.chromeAndroid, { path: '/epinoia/android/' })), 'none');
eq('installOffer: the download page as index.html -> none', S.installOffer(env(UA.chromeAndroid, { path: '/epinoia/android/index.html' })), 'none');
eq('installOffer: iPhone -> Add to Home Screen, unchanged', S.installOffer(env(UA.iphone, { path: '/epinoia/android/' })), 'ios');
eq('installOffer: desktop -> web (only when the browser offers it)', S.installOffer(env(UA.desktop)), 'web');

eq('appCard: Android browser, no version yet -> null (not known to be out)', S.appCard(env(UA.chromeAndroid, { href: '../android/' }), null), null);
eq('appCard: version.json without released -> null', S.appCard(env(UA.samsung), { versionName: '1.2.0', minShell: 1 }), null);
eq('appCard: released: false -> null', S.appCard(env(UA.samsung), { versionName: '1.2.0', minShell: 1, released: false }), null);
eq('appCard: released: true', S.appCard(env(UA.samsung), { versionName: '1.2.0', minShell: 1, released: true }), { href: '../android/', versionName: '1.2.0' });
eq('appCard: a versionName that is not a version is dropped', S.appCard(env(UA.samsung), { versionName: '<b>1</b>', released: true }).versionName, '');
eq('appCard: in the app -> null', S.appCard(env(UA.chromeAndroid, { app: true }), { released: true }), null);
eq('appCard: iPhone -> null', S.appCard(env(UA.iphone), null), null);
eq('appCard: desktop -> null', S.appCard(env(UA.desktop), null), null);

eq('readShell: what appmode.js stored', S.readShell(new Store({ epinoia_shell: '{"shell":3,"notif":1,"chan":4,"at":1}' })), { shell: 3, notif: 1, chan: 4, at: 1 });
eq('readShell: nothing stored', S.readShell(new Store()), null);
eq('readShell: garbage', S.readShell(new Store({ epinoia_shell: '{nope' })), null);
eq('readShell: no storage at all', S.readShell(null), null);

const V = (minShell, versionName = '1.0.0') => ({ versionCode: 5, versionName, minShell });
ok('needsUpdate: shell 1, minShell 2 -> yes', S.needsUpdate({ shell: 1 }, V(2)));
ok('needsUpdate: shell 2, minShell 2 -> no', !S.needsUpdate({ shell: 2 }, V(2)));
ok('needsUpdate: shell 3, minShell 2 -> no', !S.needsUpdate({ shell: 3 }, V(2)));
ok('needsUpdate: shell as a string "1" (a hand-edited store) -> yes', S.needsUpdate({ shell: '1' }, V(2)));
ok('needsUpdate: no shell (not the Android app) -> no', !S.needsUpdate({ notif: 1 }, V(9)) && !S.needsUpdate(null, V(9)));
ok('needsUpdate: shell 0 or junk -> no', !S.needsUpdate({ shell: 0 }, V(9)) && !S.needsUpdate({ shell: 'x' }, V(9)));
ok('needsUpdate: version.json unknown -> no', !S.needsUpdate({ shell: 1 }, null));
ok('needsUpdate: minShell missing or not whole -> no', !S.needsUpdate({ shell: 1 }, { versionName: '1.0.0' }) && !S.needsUpdate({ shell: 1 }, { minShell: 1.5 }));

{
  const real = JSON.parse(rd('epinoia', 'android', 'version.json'));
  const v = S.cleanVersion(real);
  ok('cleanVersion reads the real epinoia/android/version.json', v && Number.isInteger(v.minShell) && /^\d+\.\d+\.\d+$/.test(v.versionName), JSON.stringify(v));
  eq('cleanVersion: only the trusted fields', S.cleanVersion({ versionCode: '2', versionName: '1.1.0', minShell: 1, apk: 'javascript:x' }),
     { versionCode: 2, versionName: '1.1.0', minShell: 1, released: false });
  eq('cleanVersion: released only when it is exactly true', [S.cleanVersion({ released: true }).released, S.cleanVersion({ released: 'true' }).released], [true, false]);
  ok('the real version.json says whether the app is out, as a boolean (false until the first signed build)', typeof real.released === 'boolean' && v.released === real.released, JSON.stringify(real));
  eq('cleanVersion: not an object', S.cleanVersion('1.0.0'), null);
}

/* version(): once a session */
{
  const store = new Store();
  let calls = 0;
  const f = async (url, init) => { calls++; return { ok: true, json: async () => ({ versionCode: 4, versionName: '1.3.0', minShell: 2, url, cache: init && init.cache }) }; };
  const [a, b] = await Promise.all([S.version('../android/version.json', { store, fetch: f }), S.version('../android/version.json', { store, fetch: f })]);
  ok('version: two callers on one page share one fetch', calls === 1 && a && b && a.minShell === 2 && b.minShell === 2, calls);
  ok('version: kept in sessionStorage epinoia_android_version', JSON.parse(store.getItem('epinoia_android_version') || 'null').versionName === '1.3.0');
  const S2 = shellApi();         // the next page load, same session
  let calls2 = 0;
  const c = await S2.version('../android/version.json', { store, fetch: async () => { calls2++; return { ok: false }; } });
  ok('version: the next page of the session reads the stored copy, no fetch', calls2 === 0 && c && c.versionName === '1.3.0');
}
{
  const S3 = shellApi();
  const store = new Store();
  let calls = 0;
  const bad = await S3.version('v.json', { store, fetch: async () => { calls++; throw new Error('offline'); } });
  ok('version: a failed fetch resolves null, never rejects', bad === null);
  ok('version: a failure is not stored', store.getItem('epinoia_android_version') === null);
  const good = await S3.version('v.json', { store, fetch: async () => { calls++; return { ok: true, json: async () => ({ minShell: 1, versionName: '1.0.0' }) }; } });
  ok('version: ...so the next call tries again', calls === 2 && good && good.minShell === 1);
  const S4 = shellApi();
  const store4 = new Store({ epinoia_android_version: '{broken' });
  const r4 = await S4.version('v.json', { store: store4, fetch: async () => ({ ok: true, json: async () => ({ minShell: 3, versionName: '2.0.0' }) }) });
  ok('version: a spoilt stored copy is fetched again', r4 && r4.minShell === 3);
  const S5 = shellApi();
  const r5 = await S5.version('v.json', { store: new Store(), fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('503 page'); } }) });
  ok('version: the service worker\'s HTML 503 page (not JSON) is null', r5 === null);
  const r6 = await shellApi().version('v.json', { store: null, fetch: async () => ({ ok: true, json: async () => ({ minShell: 1 }) }) });
  ok('version: no sessionStorage (private mode) still answers', r6 && r6.minShell === 1);
}

/* ------------------------------------------------------------------ 2 --- */
console.log('\n-- the rail\'s banners (nav.js in a stub DOM)');

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parent = null;
    this.cls = new Set(); this.dataset = {}; this.attrs = {}; this.hidden = false;
    this.ownText = ''; this.listeners = {};
    this.style = { setProperty() {}, transition: '', height: '' };
    this.offsetHeight = 0; this.offsetWidth = 0; this.scrollWidth = 0; this.clientWidth = 0; this.scrollTop = 0;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self.cls.add(x)),
      remove: (...c) => c.forEach(x => self.cls.delete(x)),
      contains: c => self.cls.has(c),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on;
        if (want) self.cls.add(c); else self.cls.delete(c); return want; }
    };
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.ownText + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.ownText = v == null ? '' : String(v); }
  set innerHTML(v) { this.textContent = ''; this.html = v; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? Object.assign(new El('#text'), { ownText: n }) : n)); }
  appendChild(n) { if (n.parent) n.remove(); n.parent = this; this.children.push(n); return n; }
  insertBefore(n, ref) { if (n.parent) n.remove(); n.parent = this; const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parent) { const p = this.parent; p.children = p.children.filter(c => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  querySelector() { return null; }
  querySelectorAll(sel) { return this.all().filter(n => sel === 'a.item' ? n.tagName === 'A' && n.cls.has('item') : sel === '.hm-skel' ? n.cls.has('hm-skel') : false); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest() { return null; }
  focus() {}
  click() { (this.listeners.click || []).forEach(f => f({ defaultPrevented: false, button: 0, preventDefault() {} })); }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
}
const byClass = (root, c) => root.all().filter(n => n.cls.has(c));

/* One page load of nav.js. o: ua, app (window.epinoiaApp + html.m-app), session (a Store,
   shared between loads to model one session), versionJson (what fetch answers for
   android/version.json, or an Error), width. Timers are held, and run by page.later(). */
function page(url, o = {}) {
  const u = new URL(url, 'https://prophesyscouting.co.uk');
  const body = new El('body');
  const htmlCls = new Set(o.app ? ['m-app'] : []);
  const local = new Store(o.local);
  const session = o.session || new Store();
  const timers = [];
  const winListeners = {};
  const fetches = [];
  const ctx = {
    URLSearchParams, URL, JSON, Number, Date, String, RegExp, Object, Promise, Math, Array, Error,
    console,
    location: { pathname: u.pathname, search: u.search, hash: u.hash, protocol: 'https:', origin: u.origin, href: u.href },
    navigator: { userAgent: o.ua || UA.desktop, platform: o.platform || 'Win32', maxTouchPoints: o.touch || 0 },
    localStorage: local,
    sessionStorage: session,
    innerWidth: o.width || 390,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false }),
    fetch: async (href, init) => {
      fetches.push(String(href));
      if (/android\/version\.json$/.test(String(href)) && o.versionJson !== undefined) {
        if (o.versionJson instanceof Error) throw o.versionJson;
        return { ok: true, status: 200, json: async () => o.versionJson };
      }
      throw new Error('offline');
    },
    addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
    document: {
      querySelector: () => null,
      getElementById: () => null,
      createElement: t => new El(t),
      documentElement: { classList: { contains: c => htmlCls.has(c) }, style: {}, setAttribute() {}, removeAttribute() {} },
      body,
      head: new El('head'),
      currentScript: { src: 'https://prophesyscouting.co.uk/epinoia/nav.js?v=272' },
      addEventListener() {},
      hidden: false
    }
  };
  ctx.window = ctx;
  if (o.app) ctx.epinoiaApp = true;
  vm.createContext(ctx);
  vm.runInContext(NAV, ctx, { filename: 'nav.js' });
  const banners = () => body.children.filter(n => n.cls.has('ep-install'));
  return {
    ctx, body, session, fetches, winListeners, banners,
    later: ms => timers.filter(t => ms == null || t.ms === ms).forEach(t => t.f()),
    fire: (t, e) => (winListeners[t] || []).forEach(f => f(e))
  };
}
const goOf = b => b && b.children.find(n => n.cls.has('go'));
const textOf = b => b ? b.textContent : '';

const OUT = { versionCode: 1, versionName: '1.0.0', minShell: 1, released: true };
const NOT_OUT = { versionCode: 1, versionName: '1.0.0', minShell: 1, released: false };
{
  const p = page('/epinoia/stats/?l=bcb', { ua: UA.chromeAndroid, versionJson: OUT });
  await tick(); await tick(); await tick();
  ok('Android browser: nothing before the delay', p.banners().length === 0);
  p.later(2500);
  const b = p.banners()[0];
  ok('Android browser: after 2.5 s, one banner offering the Android app', p.banners().length === 1 && b.cls.has('ep-app-offer')
     && /Get the Epinoia app for Android/.test(textOf(b)), textOf(b));
  ok('...its button is a link to /epinoia/android/ (from stats/: ../android/)', goOf(b) && goOf(b).tagName === 'A' && goOf(b).href === '../android/', goOf(b) && goOf(b).href);
  ok('...never the web app\'s "Add Epinoia to your home screen"', !/home screen/i.test(textOf(b)));
  const x = b.children.find(n => n.cls.has('x'));
  x.onclick();
  ok('...dismissed: gone, and remembered for the fortnight', p.banners().length === 0 && !!p.ctx.localStorage.getItem('epinoia_install_dismissed'));
}
{
  const p = page('/epinoia/home/', { ua: UA.samsung, versionJson: OUT });
  await tick(); await tick(); await tick();
  p.fire('beforeinstallprompt', { preventDefault() {}, prompt() {} });
  const b = p.banners()[0];
  ok('Samsung Internet firing beforeinstallprompt: the Android app, not the web app', !!b && b.cls.has('ep-app-offer')
     && goOf(b).href === '../android/', textOf(b));
  p.later(2500);
  ok('...and the timer does not add a second one', p.banners().length === 1);
}
{
  const p = page('/epinoia/home/', { ua: UA.chromeAndroid, versionJson: OUT, local: { epinoia_install_dismissed: String(Date.now()) } });
  await tick(); await tick(); await tick();
  p.later(2500);
  ok('Android browser, dismissed this fortnight: nothing', p.banners().length === 0);
  p.ctx.epinoiaInstall();
  ok('...but asked for from a page (epinoiaInstall): the Android app offer', p.banners().length === 1 && p.banners()[0].cls.has('ep-app-offer'));
}
for (const [name, versionJson] of [['says released: false', NOT_OUT], ['is unreachable', new Error('offline')], ['has no released at all', { versionCode: 1, versionName: '1.0.0', minShell: 1 }]]) {
  const p = page('/epinoia/home/', { ua: UA.samsung, versionJson });
  await tick(); await tick(); await tick();
  p.later(2500);
  ok('Android browser, version.json ' + name + ': no Android app banner on a timer', p.banners().length === 0, p.banners().map(textOf).join(' | '));
  p.fire('beforeinstallprompt', { preventDefault() {}, prompt() {} });
  const b = p.banners()[0];
  ok('...beforeinstallprompt: the web app\'s "Add Epinoia to your home screen", as before the app existed',
     p.banners().length === 1 && !b.cls.has('ep-app-offer') && /Add Epinoia to your home screen/.test(textOf(b)) && goOf(b).tagName === 'BUTTON', textOf(b));
  ok('...and nothing links to the download page', !p.banners().some(n => goOf(n) && goOf(n).href === '../android/'));
}
{
  const p = page('/epinoia/android/', { ua: UA.chromeAndroid, versionJson: OUT });
  await tick(); await tick();
  p.later(2500);
  p.fire('beforeinstallprompt', { preventDefault() {}, prompt() {} });
  p.ctx.epinoiaInstall();
  ok('the download page: no banner, not even when asked', p.banners().length === 0);
}
[
  ['the Android app (TWA)', { ua: UA.chromeAndroid, app: true }],
  ['the old Samsung home-screen web app', { ua: UA.samsung, app: true }],
  ['an installed iPhone web app', { ua: UA.iphone, app: true }],
  ['an installed desktop web app', { ua: UA.desktop, app: true }]
].forEach(([name, o]) => {
  const p = page('/epinoia/home/', Object.assign({}, o, { width: 390 }));
  p.later(2500);
  p.fire('beforeinstallprompt', { preventDefault() {}, prompt() {} });
  p.ctx.epinoiaInstall();
  ok('in the app (' + name + '): no install banner at all, not even when asked', p.banners().length === 0, p.banners().map(textOf).join(' | '));
});
{
  const p = page('/epinoia/home/', { ua: UA.iphone });
  p.later(2500);
  const b = p.banners()[0];
  ok('iPhone: Add to Home Screen, exactly as before', !!b && !b.cls.has('ep-app-offer') && /Add Epinoia to your home screen/.test(textOf(b))
     && /Add to Home Screen/.test(textOf(b)) && goOf(b).tagName === 'BUTTON', textOf(b));
}
{
  const p = page('/epinoia/home/', { ua: UA.desktop, width: 1400 });
  p.later(2500);
  ok('desktop: nothing on a timer', p.banners().length === 0);
  p.fire('beforeinstallprompt', { preventDefault() {}, prompt() {} });
  ok('desktop, wide, beforeinstallprompt: still nothing (over 900px)', p.banners().length === 0);
  const q = page('/epinoia/home/', { ua: UA.desktop, width: 800 });
  q.fire('beforeinstallprompt', { preventDefault() {}, prompt() {} });
  const b = q.banners()[0];
  ok('desktop, narrow window, beforeinstallprompt: the web app, as before', !!b && !b.cls.has('ep-app-offer') && /Add Epinoia to your home screen/.test(textOf(b)));
}
{
  const p = page('/epinoia/home/', { ua: UA.desktop });
  ok('a plain tab never fetches version.json', !p.fetches.some(f => /version\.json/.test(f)));
  const session = new Store();
  const q = page('/epinoia/home/', { ua: UA.chromeAndroid, session, versionJson: NOT_OUT });
  await tick(); await tick(); await tick();
  ok('an Android browser\'s rail asks version.json whether the app is out', q.fetches.filter(f => /version\.json$/.test(f)).length === 1 && q.fetches.includes('../android/version.json'), q.fetches.join());
  const r = page('/epinoia/stats/', { ua: UA.chromeAndroid, session, versionJson: NOT_OUT });
  await tick(); await tick(); await tick();
  ok('...once a session: the next page reads the stored answer', !r.fetches.some(f => /version\.json/.test(f)), r.fetches.join());
  const i = page('/epinoia/home/', { ua: UA.iphone, versionJson: OUT });
  await tick(); await tick();
  ok('an iPhone never asks', !i.fetches.some(f => /version\.json/.test(f)));
}

console.log('\n-- the update notice');
{
  const session = new Store({ epinoia_app: '1', epinoia_shell: '{"shell":1,"notif":1,"chan":4}' });
  const p = page('/epinoia/stats/?l=bcb', { ua: UA.chromeAndroid, app: true, session, versionJson: { versionCode: 3, versionName: '1.2.0', minShell: 2 } });
  await tick(); await tick(); await tick();
  const b = p.banners().find(n => n.cls.has('ep-update'));
  ok('the app, shell 1 < minShell 2: "Update the Epinoia app"', !!b && /Update the Epinoia app/.test(textOf(b)), p.banners().map(textOf).join(' | '));
  ok('...naming the version', /1\.2\.0/.test(textOf(b)));
  ok('...linking to /epinoia/android/', goOf(b) && goOf(b).tagName === 'A' && goOf(b).href === '../android/');
  ok('...fetched from /epinoia/android/version.json', p.fetches.filter(f => /version\.json$/.test(f)).length === 1 && p.fetches.includes('../android/version.json'), p.fetches.join());
  b.children.find(n => n.cls.has('x')).onclick();
  ok('...dismissed: gone', !p.banners().some(n => n.cls.has('ep-update')));

  const q = page('/epinoia/home/', { ua: UA.chromeAndroid, app: true, session, versionJson: { versionCode: 3, versionName: '1.2.0', minShell: 2 } });
  await tick(); await tick(); await tick();
  ok('next page, same launch: stays dismissed', !q.banners().some(n => n.cls.has('ep-update')));
  ok('...and version.json is not fetched again this session', !q.fetches.some(f => /version\.json/.test(f)), q.fetches.join());

  const raised = new Store({ epinoia_app: '1', epinoia_shell: '{"shell":1}', epinoia_update_dismissed: '2',
    epinoia_android_version: '{"versionCode":4,"versionName":"1.3.0","minShell":3}' });
  const r = page('/epinoia/home/', { ua: UA.chromeAndroid, app: true, session: raised });
  await tick(); await tick(); await tick();
  ok('dismissed for minShell 2, but minShell is now 3: shown again', r.banners().some(n => n.cls.has('ep-update')));
}
{
  const session = new Store({ epinoia_app: '1', epinoia_shell: '{"shell":2}' });
  const p = page('/epinoia/home/', { ua: UA.chromeAndroid, app: true, session, versionJson: { versionCode: 2, versionName: '1.1.0', minShell: 2 } });
  await tick(); await tick(); await tick();
  ok('the app, shell 2 = minShell 2: no notice', p.banners().length === 0, p.banners().map(textOf).join(' | '));
}
{
  const session = new Store({ epinoia_app: '1', epinoia_shell: '{"shell":1}' });
  const p = page('/epinoia/home/', { ua: UA.chromeAndroid, app: true, session, versionJson: new Error('offline') });
  await tick(); await tick(); await tick();
  ok('the app, version.json unreachable: no notice, no error', p.banners().length === 0);
}
{
  const session = new Store({ epinoia_app: '1' });
  const p = page('/epinoia/home/', { ua: UA.iphone, app: true, session, versionJson: { minShell: 99 } });
  await tick(); await tick();
  ok('an app with no shell= (the installed web app): nothing fetched, nothing shown',
     p.banners().length === 0 && !p.fetches.some(f => /version\.json/.test(f)));
}
{
  const session = new Store({ epinoia_shell: '{"shell":1}' });
  const p = page('/epinoia/home/', { ua: UA.chromeAndroid, session, versionJson: { minShell: 5 } });
  await tick(); await tick();
  ok('a browser tab with a stale epinoia_shell but no app signal: no update notice',
     !p.banners().some(n => n.cls.has('ep-update')));
}
{
  const session = new Store({ epinoia_app: '1', epinoia_shell: '{"shell":1}' });
  const p = page('/epinoia/android/', { ua: UA.chromeAndroid, app: true, session, versionJson: { minShell: 5 } });
  await tick(); await tick();
  ok('the download page in an outdated app: no banner (the page says it itself)', p.banners().length === 0);
}
{
  const session = new Store({ epinoia_app: '1', epinoia_shell: '{"shell":1}' });
  const p = page('/epinoia/stats/wowy/?l=bcb', { ua: UA.chromeAndroid, app: true, session, versionJson: { minShell: 2, versionName: '1.0.1' } });
  await tick(); await tick(); await tick();
  const b = p.banners().find(n => n.cls.has('ep-update'));
  ok('two folders down: the notice links to ../../android/', b && goOf(b).href === '../../android/' && p.fetches.includes('../../android/version.json'), p.fetches.join());
}

/* ------------------------------------------------------------------ 3 --- */
console.log('\n-- HOME\'s Android app card');
{
  const require = createRequire(import.meta.url);
  const FRONT = path.join(ROOT, 'epinoia', 'home', 'front.js');
  const Home = require(FRONT);
  ok('front.js exports paintApp', typeof Home.paintApp === 'function');

  const doc = { createElement: t => new El(t), documentElement: { classList: { contains: () => false } } };
  const draw = async (ua, o = {}) => {
    const host = new El('div');
    const store = o.store || new Store();
    let calls = 0;
    const shell = shellApi();
    const real = shell.version;
    const wrapped = Object.assign({}, shell, { version: (url, deps) => real(url, Object.assign({}, deps, {
      fetch: async u => { calls++; o.url = u; if (o.versionJson instanceof Error) throw o.versionJson;
        return { ok: true, json: async () => o.versionJson }; } })) });
    const done = await Home.paintApp({ host, doc, shell: wrapped, store,
      env: Object.assign({ ua, platform: o.platform || '', maxTouchPoints: o.touch || 0 }, o.env || {}) });
    const a = host.children[0];
    return { host, a, done, calls, url: o.url, store };
  };
  {
    const r = await draw(UA.chromeAndroid, { versionJson: { versionCode: 1, versionName: '1.0.0', minShell: 1, released: true } });
    ok('Chrome on Android: one card in #homeApp', r.host.children.length === 1 && r.a.cls.has('hm-app'));
    ok('...a link to ../android/', r.a.tagName === 'A' && r.a.href === '../android/', r.a.href);
    ok('..."Get the Android app"', /Get the Android app/.test(r.a.textContent), r.a.textContent);
    const v = byClass(r.a, 'v')[0];
    ok('...with the versionName from version.json', v && v.textContent === 'v1.0.0', v && v.textContent);
    ok('...from ../android/version.json', r.url === '../android/version.json', r.url);
  }
  {
    const r = await draw(UA.samsung, { versionJson: new Error('offline') });
    ok('Samsung Internet, version.json unreachable: no card (not known to be out)', r.host.children.length === 0 && r.done === null);
  }
  {
    const r = await draw(UA.samsung, { versionJson: { versionCode: 1, versionName: '1.0.0', minShell: 1, released: false } });
    ok('Samsung Internet, released: false: no card, the slot stays empty', r.host.children.length === 0 && r.done === null && r.calls === 1);
  }
  {
    const r = await draw(UA.samsung, { versionJson: JSON.parse(rd('epinoia', 'android', 'version.json')) });
    ok('the real version.json: a card exactly when it says released', (r.host.children.length === 1) === (JSON.parse(rd('epinoia', 'android', 'version.json')).released === true));
  }
  {
    const r = await draw(UA.firefoxAndroid, { store: new Store({ epinoia_android_version: '{"versionCode":2,"versionName":"1.1.0","minShell":1,"released":true}' }), versionJson: { versionName: '9.9.9' } });
    ok('another Android browser (Firefox): the card, the session\'s stored version, no fetch', r.a && byClass(r.a, 'v')[0].textContent === 'v1.1.0' && r.calls === 0);
  }
  for (const [name, ua, extra] of [
    ['iPhone', UA.iphone, {}],
    ['iPad (desktop mode)', UA.ipadDesktop, { platform: 'MacIntel', touch: 5 }],
    ['desktop', UA.desktop, {}],
    ['in the app (window.epinoiaApp)', UA.chromeAndroid, { env: { app: true } }],
    ['in the app (html.m-app)', UA.samsung, { env: { mApp: true } }]
  ]) {
    const r = await draw(ua, Object.assign({ versionJson: { versionName: '1.0.0' } }, extra));
    ok(name + ': no card, the slot stays empty, nothing fetched', r.host.children.length === 0 && r.calls === 0);
  }
  {
    const host = new El('div');
    const r = await Home.paintApp({ host, doc, shell: null, env: { ua: UA.chromeAndroid } });
    ok('no EpinoiaAppShell (nav.js missing): no card, no error', r === null && host.children.length === 0);
  }
  const html = rd('epinoia', 'home', 'index.html');
  ok('HOME still has the empty div#homeApp slot, and loads nav.js', /<div id="homeApp"><\/div>/.test(html) && /<script src="\.\.\/nav\.js\?v=\d+" defer><\/script>/.test(html));
  const src = rd('epinoia', 'home', 'front.js');
  ok('front.js paints the card at boot, guarded', /try \{ paintApp\(\); \} catch \(e\)/.test(src));
}

/* ------------------------------------------------------------------ 4 --- */
console.log('\n-- the stylesheets');
{
  const bare = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const home = bare(rd('epinoia', 'kit', 'home.css'));
  ok('home.css: .hm-app is styled', /\.hm-app\{[^}]*display:grid/.test(home));
  ok('home.css: .hm-app has a light-theme rule', /:root\[data-theme="light"\] \.hm-app\{/.test(home));
  ok('home.css: the empty slot still takes no room', /#homeApp:empty\{display:none\}/.test(home));
  ok('home.css: .hm-app uses kit tokens only (no hex outside the light rule)',
     !/#[0-9a-f]{3,6}/i.test((home.match(/[^{}]*\.hm-app[^{}]*\{[^}]*\}/g) || []).filter(r => !/data-theme/.test(r)).join('')));
  const nav = bare(rd('epinoia', 'kit', 'nav.css'));
  ok('nav.css: the banner\'s link button has no underline', /\.ep-install a\.go\{[^}]*text-decoration:none/.test(nav));
  ok('nav.css: on a phone the Android banners stand above the bottom bar',
     /@media \(max-width:820px\)\{\s*body\.has-nav \.ep-install\.ep-app-offer,\s*body\.has-nav \.ep-install\.ep-update\{ bottom:calc\(68px/.test(nav));
  const card = bare(rd('epinoia', 'kit', 'card.css'));
  const ed = (/\.club-ed\{([^}]*)\}/.exec(card) || [])[1] || '';
  ok('card.css: .club-ed can shrink inside a narrow card (min-width:0, overflow hidden, ellipsis)',
     /min-width:0/.test(ed) && /overflow:hidden/.test(ed) && /text-overflow:ellipsis/.test(ed) && /white-space:nowrap/.test(ed), ed);
  ok('card.css: .club-ed otherwise unchanged (margin-left:auto, 8px micro type)', /margin-left:auto/.test(ed) && /font-size:8px/.test(ed));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
