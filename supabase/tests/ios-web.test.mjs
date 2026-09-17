/* ============================================================================
   The website's side of the EPINOIΛ iPhone app (ios/, docs/ios-app.md).

   What fails quietly without these checks:
     * an iPhone offered the Android download: the Android page not swapped for
       the iPhone page before it paints, or a link still pointing at
       android/#iosSec;
     * the iPhone page calling the app "out" before version.json says so, or
       turning a typo in version.json into a link that is not the App Store;
     * the iPhone app not recognised as an app (a water splash, install banners,
       Google's button that Google refuses inside an app);
     * a checkout or billing portal reachable inside the iPhone app (App Store
       guideline 3.1.1);
     * a universal-links file that names the wrong app or sends the embeds and
       broadcast overlays into the app;
     * the privacy notice saying nothing about the iPhone app.

   Run: node supabase/tests/ios-web.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { association, BUNDLE_ID } from '../../tools/ios-team.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EpinoiaApp-iOS/3',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
};

/* ---- appmode.js, run as a page would run it ---- */
function appmode(url, o = {}) {
  const u = new URL(url, 'https://prophesyscouting.co.uk');
  const rootCls = new Set();
  const replaced = [];
  const style = {};
  const ctx = {
    URLSearchParams, URL, JSON, Number, String, isFinite, Date,
    location: { pathname: u.pathname, search: u.search, hash: u.hash, replace: h => replaced.push(h) },
    navigator: { userAgent: o.ua || UA.iphone, platform: o.platform || 'iPhone', maxTouchPoints: o.touch == null ? 5 : o.touch },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
    document: {
      documentElement: { classList: { add: c => rootCls.add(c), contains: c => rootCls.has(c) }, setAttribute() {}, style },
      querySelector: () => null, referrer: '', currentScript: { getAttribute: () => null }, addEventListener() {}
    }
  };
  ctx.window = ctx;
  if (o.native) ctx.EpinoiaNative = o.native;
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'appmode.js'), ctx);
  return { app: ctx.epinoiaApp, rootCls, replaced, hidden: style.display === 'none' };
}

console.log('\nappmode.js: the iPhone app, and an iPhone on the Android page');
{
  const nat = { platform: 'ios', build: 3, call: async () => ({}) };
  const a = appmode('/epinoia/stats/?l=bcb', { ua: UA.iphoneApp, native: nat });
  ok('window.EpinoiaNative makes the page the app, with html.m-app and html.m-ios-app', a.app === true && a.rootCls.has('m-app') && a.rootCls.has('m-ios-app'));
  const b = appmode('/epinoia/stats/?l=bcb', { ua: UA.iphoneApp });
  ok('...so does the app\'s user agent alone (a page read before the object exists)', b.app === true && b.rootCls.has('m-ios-app'));
  const c = appmode('/epinoia/home/?source=ios', { ua: UA.iphone });
  ok('...and ?source=ios is an app launch, though only the real app is m-ios-app', c.app === true && !c.rootCls.has('m-ios-app'));
  const d = appmode('/epinoia/stats/', { ua: UA.iphone });
  ok('Safari on an iPhone is not the app', d.app === false && !d.rootCls.has('m-ios-app'));
  const e = appmode('/epinoia/stats/', { ua: UA.android.replace('Mobile', 'Mobile EpinoiaApp-iOS/3') });
  ok('the app token on an Android user agent is not the iPhone app', !e.rootCls.has('m-ios-app'));
  const f = appmode('/epinoia/stats/', { ua: UA.iphone, native: { platform: 'android', call() {} } });
  ok('an EpinoiaNative that is not platform ios is not the iPhone app', !f.rootCls.has('m-ios-app'));

  const g = appmode('/epinoia/android/', { ua: UA.iphone });
  eq('an iPhone on /epinoia/android/ is sent to /epinoia/ios/ before paint', [g.replaced, g.hidden], [['/epinoia/ios/'], true]);
  eq('...the old Home Screen anchor lands on the same steps', appmode('/epinoia/android/#iosSec', { ua: UA.iphone }).replaced, ['/epinoia/ios/#homeScreen']);
  eq('...index.html too', appmode('/epinoia/android/index.html', { ua: UA.iphone }).replaced, ['/epinoia/ios/']);
  eq('...an iPad asking for the desktop site too', appmode('/epinoia/android/', { ua: UA.mac, platform: 'MacIntel', touch: 5 }).replaced, ['/epinoia/ios/']);
  eq('...inside the iPhone app too', appmode('/epinoia/android/', { ua: UA.iphoneApp, native: nat }).replaced, ['/epinoia/ios/']);
  eq('an Android phone stays on the Android page', appmode('/epinoia/android/', { ua: UA.android, platform: 'Linux', touch: 5 }).replaced, []);
  eq('a Mac with no touch screen stays', appmode('/epinoia/android/', { ua: UA.mac, platform: 'MacIntel', touch: 0 }).replaced, []);
  eq('an iPhone elsewhere is never moved', appmode('/epinoia/stats/', { ua: UA.iphone }).replaced, []);
}

console.log('\nepinoia/ios/: the iPhone page');
{
  const v = JSON.parse(read('epinoia', 'ios', 'version.json'));
  ok('version.json: a whole build, an x.y.z version and a minShell', Number.isInteger(v.build) && v.build > 0 && /^\d+\.\d+\.\d+$/.test(v.version) && Number.isInteger(v.minShell));
  ok('...released is a boolean, and only true with an App Store id', typeof v.released === 'boolean' && (!v.released || /^\d{6,12}$/.test(String(v.appStoreId))));

  const html = read('epinoia', 'ios', 'index.html');
  ok('the page loads appmode.js first and blocking', /<script src="\.\.\/appmode\.js\?v=\d+"><\/script>/.test(html) && html.indexOf('appmode.js') < html.indexOf('stylesheet'));
  ok('...loads no gate and no topnav', !/<script[^>]+src=["'][^"']*(gate|topnav)\.js/.test(html));
  ok('...has the Home Screen steps under #homeScreen', /id="homeScreen"/.test(html) && /Add to Home Screen/.test(html));
  ok('...never offers an Android download, only a link for an Android phone that lands here',
     !/\.apk|Download for Android/.test(html) && /android-only[\s\S]{0,200}href="\.\.\/android\/"/.test(html));
  ok('...the in-app block opens iOS\'s notification settings through the app', /href="epinoia:\/\/notification-settings"/.test(html));

  /* ios.js with a stub page */
  const run = async (o) => {
    const nodes = {};
    const node = id => nodes[id] || (nodes[id] = { id, textContent: '', href: '', classList: (() => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: c => s.has(c), s }; })() });
    ['page', 'storeLink', 'updBtn', 'ver', 'verWrap', 'appBuild', 'alerts'].forEach(node);
    const ctx = {
      URL, JSON, Number, String, Promise, Set,
      location: { href: 'https://prophesyscouting.co.uk/epinoia/ios/' },
      navigator: { userAgent: o.ua || UA.iphone, platform: o.platform || 'iPhone', maxTouchPoints: 5, standalone: !!o.standalone },
      sessionStorage: { getItem: () => null },
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      fetch: async () => (o.versionJson instanceof Error ? Promise.reject(o.versionJson) : { ok: true, json: async () => o.versionJson }),
      document: { getElementById: id => nodes[id] || null, currentScript: { src: 'https://prophesyscouting.co.uk/epinoia/ios/ios.js?v=1' },
                  documentElement: { classList: { contains: c => !!(o.mApp && c === 'm-app') } } }
    };
    ctx.window = ctx;
    if (o.native) ctx.EpinoiaNative = o.native;
    vm.createContext(ctx);
    vm.runInContext(read('epinoia', 'ios', 'ios.js'), ctx);
    await new Promise(r => setTimeout(r, 10));
    return { cls: nodes.page.classList.s, nodes };
  };
  const OUT = { build: 2, version: '1.0.1', minShell: 1, appStoreId: '6700000001', released: true };
  let r = await run({ versionJson: OUT });
  ok('released with an id: .released, the store link to apps.apple.com/app/id…', r.cls.has('released') && r.nodes.storeLink.href === 'https://apps.apple.com/app/id6700000001' && r.cls.has('ios'));
  r = await run({ versionJson: Object.assign({}, OUT, { appStoreId: null }) });
  ok('released but no id yet: not released (nowhere to send anyone)', !r.cls.has('released'));
  r = await run({ versionJson: Object.assign({}, OUT, { appStoreId: 'https://evil.example/' }) });
  ok('an id that is not digits never becomes the link', !r.cls.has('released') && r.nodes.storeLink.href === '');
  r = await run({ versionJson: new Error('offline') });
  ok('version.json unreachable: "coming soon", which is safe', !r.cls.has('released'));
  r = await run({ versionJson: OUT, ua: UA.android, platform: 'Linux' });
  ok('an Android phone: .android (its link to the Android app shows, the store button does not)', r.cls.has('android') && !r.cls.has('ios'));
  r = await run({ versionJson: Object.assign({}, OUT, { minShell: 3 }), mApp: true, native: { platform: 'ios', build: 2, version: '1.0.1', permission: 'denied' } });
  ok('in the iPhone app: in-app and native, never webapp', r.cls.has('in-app') && r.cls.has('native') && !r.cls.has('webapp'));
  ok('...build 2 below minShell 3: update, to the store', r.cls.has('update') && r.nodes.updBtn.href === 'https://apps.apple.com/app/id6700000001');
  ok('...its build and iOS\'s answer about alerts', /build 2/.test(r.nodes.appBuild.textContent) && r.nodes.alerts.textContent === 'Turned off');
  r = await run({ versionJson: OUT, mApp: true, standalone: true });
  ok('EPINOIΛ from the Home Screen (not the app): webapp, so it is offered the real app', r.cls.has('webapp') && !r.cls.has('in-app'));

  const css = read('epinoia', 'ios', 'ios.css');
  ok('ios.css only hides: released-only, soon-only, android-only, native-only',
     /\.ad:not\(\.released\) \.released-only\{ display:none \}/.test(css) && /\.ad\.released \.soon-only\{ display:none \}/.test(css) &&
     /\.ad:not\(\.android\) \.android-only\{ display:none \}/.test(css) && /\.ad:not\(\.native\) \.native-only\{ display:none \}/.test(css));
}

console.log('\nno Android app for an iPhone, anywhere a page links it');
{
  const nav = read('epinoia', 'nav.js');
  ok('nav.js: no link to android/#iosSec is left', !/android\/#iosSec/.test(nav));
  ok('nav.js: the iPhone banner, row and update notice point at ios/', /go\.href = root \+ 'ios\/'/.test(nav) && /href: 'ios\/'/.test(nav) && /href: 'ios\/#homeScreen'/.test(nav));
  const front = read('epinoia', 'home', 'front.js');
  ok('HOME: an iPhone reads ios/version.json for its card', /shell\.iosVersion\(BASE \+ 'ios\/version\.json'/.test(front));
  const android = read('epinoia', 'android', 'index.html');
  ok('the Android page still loads appmode.js first, which does the swap', /<script src="\.\.\/appmode\.js\?v=\d+"><\/script>/.test(android));
}

console.log('\nwhat the iPhone app does not offer');
{
  const signin = read('epinoia', 'signin', 'signin.js');
  ok('sign-in: no Google button in the iPhone app (Google refuses app web views; guideline 4.8)',
     /if \(googleInIOSApp\(\) \|\| !\(await googleAvailable\(\)\)\)/.test(signin) && /classList\.contains\('m-ios-app'\)/.test(signin));
  const join = read('epinoia', 'join', 'join.js');
  const boot = join.slice(join.indexOf('async function boot()'));
  ok('join: in the iPhone app, no plans and no checkout, before anything is loaded',
     /if \(document\.documentElement\.classList\.contains\('m-ios-app'\)\)[\s\S]{0,400}Memberships are not available in the iPhone app\.[\s\S]{0,120}return;/.test(boot)
     && boot.indexOf("m-ios-app") < boot.indexOf("billing({ action: 'status' })"));
  ok('...and it never says where else to buy', !/website|prophesyscouting|browser/i.test((/Memberships are not available in the iPhone app\.[^']*/.exec(boot) || [''])[0]));
  const me = read('epinoia', 'me', 'me.js');
  ok('profile: Manage billing and Cancel membership are hidden in the iPhone app', /function billingButton[\s\S]{0,300}m-ios-app'\)\) b\.style\.display = 'none'/.test(me));
  const access = read('epinoia', 'kit', 'access.css');
  ok('paywalls: "See membership" is hidden in the iPhone app', /html\.m-ios-app \.ep-lock-go, html\.m-ios-app \.billing-btn\{ display:none !important \}/.test(access));
}

console.log('\nuniversal links: .well-known/apple-app-site-association');
{
  const a = association('ABCDE12345');
  eq('the app is named by Team ID and bundle id', a.applinks.details[0].appIDs, ['ABCDE12345.' + BUNDLE_ID]);
  eq('the bundle id is the Android package\'s', BUNDLE_ID, 'uk.co.prophesyscouting.epinoia');
  const comps = a.applinks.details[0].components;
  ok('embeds, broadcast overlays, API docs and the dev feed stay in the browser, before the /epinoia/* catch-all',
     ['/epinoia/embed/*', '/epinoia/broadcast/*', '/epinoia/api/*', '/epinoia/devfeed.html'].every(p => comps.some(c => c['/'] === p && c.exclude === true))
     && comps[comps.length - 1]['/'] === '/epinoia/*' && !comps[comps.length - 1].exclude);
  ok('nothing outside /epinoia/ opens the app', comps.every(c => c['/'].startsWith('/epinoia/')));
  let threw = 0;
  for (const bad of ['', 'abcde12345', 'ABCDE1234', 'ABCDE123456', 'ABCDE-2345']) { try { association(bad); } catch (_) { threw++; } }
  eq('a Team ID must be 10 capitals and digits', threw, 5);
  const file = path.join(ROOT, '.well-known', 'apple-app-site-association');
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const id = j.applinks.details[0].appIDs[0];
    ok('the committed file is the script\'s output for its own Team ID', /^[A-Z0-9]{10}\.uk\.co\.prophesyscouting\.epinoia$/.test(id)
       && JSON.stringify(j) === JSON.stringify(association(id.split('.')[0])), id);
  } else {
    ok('no file yet (written once the Team ID exists): nothing half-made is served', true);
  }
}

console.log('\nthe privacy notice');
{
  const p = read('epinoia', 'privacy', 'index.html');
  ok('has an iPhone section (#iosSec) naming Apple Push Notification service and the device token',
     /id="iosSec"/.test(p) && /Apple Push Notification service/.test(p) && /device token/.test(p));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
