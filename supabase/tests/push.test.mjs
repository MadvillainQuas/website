/* ============================================================================
   Notifications on the phone — epinoia/push.js, epinoia/sw.js, epinoia/follow.js
   (docs/notifications.md §5 and §6).

   What fails quietly here, and is pinned:
     * state() calling an iPhone Safari tab "unsupported" — it is one Home Screen
       install away from working, and the fan must be told how;
     * the follow sheet nagging somebody whose notifications are already on, who
       blocked them, whose browser cannot take them, who is signed out, or who said
       "not now" in the last fortnight;
     * the VAPID key decoded wrongly (subscribe() rejects it, and nothing says why);
     * enable() awaiting anything before the permission prompt (Safari and Firefox
       then refuse the prompt), or writing the subscription to the wrong URL, with
       the wrong headers or without the merge-duplicates upsert;
     * the worker throwing on a payload (renotify without a tag is a TypeError), so a
       push shows nothing; a lineups tap not landing on show=starters; a tap
       navigating a tab the worker does not control (navigate() rejects there);
     * pushsubscriptionchange swapping with the wrong body, or the worker's copies
       of the public URL, key and VAPID key drifting from config.js;
     * a follow that did not save still offering notifications.

   No network and no browser: push.js takes a stubbed browser through _test.env,
   sw.js runs in a vm context with a stubbed `self`, follow.js in another.
   Run: node supabase/tests/push.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const P = require(path.join(ROOT, 'epinoia', 'push.js'));
const T = P._test;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got  ' + g + '\n          want ' + w);
};

/* ---- the public values, as config.js publishes them ---- */
const configSrc = read('epinoia', 'config.js');
const CFG_URL = (/supabaseUrl:\s*'([^']+)'/.exec(configSrc) || [])[1];
const CFG_KEY = (/supabaseAnonKey:\s*'([^']+)'/.exec(configSrc) || [])[1];
const CFG_VAPID = (/window\.EPINOIA_VAPID\s*=\s*'([^']+)'/.exec(configSrc) || [])[1];

/* ---- a browser, as much of one as push.js touches ---- */
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  iphone17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphone15: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'
};
const REF = 'abcref';
const TOKEN_KEY = 'sb-' + REF + '-auth-token';
const DAY = 86400000;

function memStore(throwing) {
  const m = new Map();
  const guard = () => { if (throwing) throw new Error('SecurityError: storage is blocked'); };
  return {
    getItem: k => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: k => { guard(); m.delete(k); }
  };
}
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = sub => b64url({ alg: 'HS256' }) + '.' + b64url({ sub, role: 'authenticated' }) + '.sig';
function signIn(ls, o = {}) {
  const tok = o.tok || jwt(o.id || 'u1');
  const exp = Math.floor(Date.now() / 1000) + (o.expired ? -60 : (o.ttl || 3600));
  const s = { access_token: tok, expires_at: exp };
  if (!o.noUser) s.user = { id: o.id || 'u1', email: 'u1@example.org' };
  if (o.refresh) s.refresh_token = 'r1';
  ls.setItem(TOKEN_KEY, JSON.stringify(s));
  return tok;
}

/* o: ua platform touch standalone displayStandalone insecure noSW noPush noNotification
      permission answer (what the prompt returns) sub (an existing subscription: {endpoint, key})
      registered (false: no registration) registerThrows subscribeThrows
      respond(url, init, n) -> status | 'throw'   json(url) -> body   storage now */
function browser(o = {}) {
  const calls = { perm: 0, register: [], getRegistration: [], subscribe: [], unsubscribe: [], fetch: [] };
  const ls = o.storage || memStore();
  let permission = o.permission || 'default';
  let n = 0;
  let sub = null;
  const makeSub = (endpoint, key) => ({
    endpoint,
    options: { applicationServerKey: key ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) : null },
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256-' + endpoint.slice(-3), auth: 'AUTH-' + endpoint.slice(-3) } }),
    unsubscribe: async () => { calls.unsubscribe.push(endpoint); if (sub && sub.endpoint === endpoint) sub = null; return true; }
  });
  if (o.sub) sub = makeSub(o.sub.endpoint, o.sub.key);
  const pushManager = {
    getSubscription: async () => sub,
    subscribe: async opts => {
      calls.subscribe.push(opts);
      if (o.subscribeThrows) throw new Error('AbortError: Registration failed - push service error');
      sub = makeSub('https://push.example/ep' + (++n), opts.applicationServerKey);
      return sub;
    }
  };
  const reg = { active: { state: 'activated' }, scope: 'https://site.example/epinoia/', pushManager };
  const navigator = { userAgent: o.ua || UA.android, platform: o.platform || 'Linux armv8l', maxTouchPoints: o.touch || 0 };
  if (o.standalone !== undefined) navigator.standalone = o.standalone;
  const swListeners = new Set();
  if (!o.noSW) {
    navigator.serviceWorker = {
      register: async (url, opts) => { calls.register.push([url, opts]); if (o.registerThrows) throw new Error('SecurityError'); return reg; },
      getRegistration: async scope => { calls.getRegistration.push(scope); return o.registered === false ? undefined : reg; },
      ready: Promise.resolve(reg)
    };
    /* o.receipts: the worker says pushes arrive (the page's message listener) */
    if (o.receipts) {
      navigator.serviceWorker.addEventListener = (t, fn) => { if (t === 'message') swListeners.add(fn); };
      navigator.serviceWorker.removeEventListener = (t, fn) => { swListeners.delete(fn); };
    }
  }
  /* o.arrive(url, body) -> {tag, shown, error} | null: after a notify POST, what the worker reports */
  const deliver = (url, body) => {
    if (!o.arrive || !/\/functions\/v1\/notify$/.test(url)) return;
    const r = o.arrive(url, body);
    if (r) setTimeout(() => [...swListeners].forEach(fn => fn({ data: Object.assign({ type: 'epinoia-push', at: Date.parse('2026-09-19T15:04:05') }, r) })), 5);
  };
  const Notification = o.noNotification ? undefined : {
    get permission() { return permission; },
    requestPermission() { calls.perm++; permission = o.answer || permission; return Promise.resolve(permission); }
  };
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({ url, method: init.method || 'GET', headers: init.headers || {}, body });
    const st = o.respond ? o.respond(url, init, calls.fetch.length) : 200;
    if (st === 'throw') throw new TypeError('Failed to fetch');
    if (st >= 200 && st < 300) deliver(url, body);
    return { status: st, ok: st >= 200 && st < 300, json: async () => (o.json ? o.json(url, body) : {}) };
  };
  /* o.shell: what the Android app's launcher said (appmode.js keeps it in sessionStorage
     epinoia_shell); o.search: the page's query string */
  const ss = memStore();
  if (o.shell) ss.setItem('epinoia_shell', JSON.stringify(o.shell));
  const env = {
    navigator, Notification, PushManager: o.noPush ? undefined : function PushManager() {},
    localStorage: ls, sessionStorage: ss, location: { search: o.search || '' }, fetch, AbortController: undefined,
    matchMedia: q => ({ matches: !!(o.displayStandalone && /standalone/.test(q)) }),
    EPINOIA_CONFIG: { supabaseUrl: 'https://' + REF + '.supabase.co', supabaseAnonKey: 'sb_publishable_test' },
    EPINOIA_VAPID: o.vapid === undefined ? CFG_VAPID : o.vapid,
    isSecureContext: !o.insecure, document: o.referrer !== undefined ? { referrer: o.referrer } : undefined, EpinoiaAccess: undefined
  };
  /* o.twaSeen: appmode.js has seen the Android app's launcher on this phone before */
  if (o.twaSeen) ls.setItem('epinoia_twa_seen', String(o.twaSeen));
  if (o.now) env.now = o.now;
  T.env(env);
  return { calls, ls, ss, get sub() { return sub; }, makeSub };
}
/* the two kinds of browser the tests start from */
const android = (o = {}) => browser(Object.assign({ ua: UA.android }, o));
const iphoneTab = (o = {}) => browser(Object.assign({ ua: UA.iphone17, platform: 'iPhone', touch: 5, standalone: false, noPush: true, noNotification: true }, o));

/* ============================================================== the key === */
console.log('\nthe VAPID key');
{
  const k = T.keyBytes(CFG_VAPID);
  ok('config.js publishes a key', !!CFG_VAPID && CFG_VAPID.length > 80, CFG_VAPID);
  ok('it decodes to an uncompressed P-256 point: 65 bytes, starting 0x04', k && k.length === 65 && k[0] === 4, k && k.length);
  eq('...byte for byte what base64url says', Array.from(k), Array.from(Buffer.from(CFG_VAPID, 'base64url')));
  eq('the URL-safe characters are the other alphabet\'s + and /', Array.from(T.keyBytes('-_8')), [0xfb, 0xff]);
  eq('unpadded and padded read the same', Array.from(T.keyBytes('AQID')), Array.from(T.keyBytes('AQID==')));
  eq('...and read [1, 2, 3]', Array.from(T.keyBytes('AQID')), [1, 2, 3]);
  eq('an empty key is no key', T.keyBytes(''), null);
  eq('a key with characters outside the alphabet is no key', T.keyBytes('not a key!'), null);
  eq('a key of impossible length is no key', T.keyBytes('A'), null);
  ok('sameKey compares bytes, not objects', T.sameKey(T.keyBytes('AQID'), new Uint8Array([1, 2, 3]).buffer) && !T.sameKey(T.keyBytes('AQID'), T.keyBytes('AQIE')));
}

/* ============================================================ state() === */
console.log('\nstate(): where this browser stands');
{
  browser({ ua: UA.chrome, noSW: true });
  eq('no service worker: unsupported', await P.state(), 'unsupported');
  browser({ ua: UA.chrome, noPush: true });
  eq('no PushManager: unsupported', await P.state(), 'unsupported');
  browser({ ua: UA.chrome, noNotification: true });
  eq('no Notification: unsupported', await P.state(), 'unsupported');
  browser({ ua: UA.chrome, insecure: true, permission: 'granted' });
  eq('not a secure context: unsupported', await P.state(), 'unsupported');

  iphoneTab();
  eq('iPhone Safari in a tab (no PushManager there): ios-install, not unsupported', await P.state(), 'ios-install');
  browser({ ua: UA.ipadDesktop, platform: 'MacIntel', touch: 5, standalone: false, noPush: true, noNotification: true });
  eq('iPadOS with its desktop user agent is still an iPad: ios-install', await P.state(), 'ios-install');
  browser({ ua: UA.mac, platform: 'MacIntel', touch: 0, permission: 'default' });
  eq('a Mac with no touch screen is a Mac: off', await P.state(), 'off');
  iphoneTab({ ua: UA.iphone15 });
  eq('iOS 15 cannot take web push even installed: unsupported', await P.state(), 'unsupported');

  const inst = iphoneTab({ standalone: true, noPush: false, noNotification: false, permission: 'default' });
  eq('iPhone, opened from the Home Screen, permission not yet asked: off', await P.state(), 'off');
  ok('...and no registration was looked up for a browser that has not been asked', inst.calls.getRegistration.length === 0);
  iphoneTab({ standalone: false, displayStandalone: true, noPush: false, noNotification: false, permission: 'granted',
              sub: { endpoint: 'https://web.push.apple.com/abc', key: T.keyBytes(CFG_VAPID) } });
  eq('iPhone in display-mode standalone, granted and subscribed: on', await P.state(), 'on');

  android({ permission: 'denied' });
  eq('permission denied: denied', await P.state(), 'denied');
  android({ permission: 'default' });
  eq('permission not asked: off', await P.state(), 'off');
  const g1 = android({ permission: 'granted' });
  eq('granted but no subscription: off', await P.state(), 'off');
  eq('...looked up on the /epinoia/ registration', g1.calls.getRegistration, ['/epinoia/']);
  android({ permission: 'granted', registered: false });
  eq('granted but no worker registered: off', await P.state(), 'off');
  android({ permission: 'granted', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/x1', key: T.keyBytes(CFG_VAPID) } });
  eq('granted and subscribed: on', await P.state(), 'on');

  eq('iosVersion reads an iPhone user agent', T.iosVersion(UA.iphone17), [17, 4]);
  eq('...and iPadOS\'s desktop one', T.iosVersion(UA.ipadDesktop), [17, 4]);
}

/* ============================================================ offer() === */
console.log('\noffer(): when the follow sheet stays down');
{
  let b = android({ permission: 'default' });
  eq('signed out: never shown', await P.offer({ name: 'Reading Rockets', kind: 'team' }), { shown: false, why: 'signed-out' });

  b = android({ permission: 'granted', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/on', key: T.keyBytes(CFG_VAPID) } }); signIn(b.ls);
  eq('notifications already on: not shown', await P.offer({ name: 'Reading Rockets' }), { shown: false, why: 'on' });

  b = android({ permission: 'denied' }); signIn(b.ls);
  eq('blocked in the browser: not shown', await P.offer({ name: 'Reading Rockets' }), { shown: false, why: 'denied' });

  b = browser({ ua: UA.chrome, noPush: true }); signIn(b.ls);
  eq('a browser that cannot: not shown', await P.offer({ name: 'Reading Rockets' }), { shown: false, why: 'unsupported' });

  let clock = Date.now();
  b = android({ permission: 'default', now: () => clock }); signIn(b.ls, { ttl: 30 * 86400 });   // outlives the fake fortnight
  eq('signed in, notifications off: the ask (drawn in a browser; no document under node)',
     await P.offer({ name: 'Reading Rockets' }), { shown: false, why: 'no-document', view: 'ask' });
  T.snooze();
  ok('"Not now" is remembered under its key', Number(b.ls.getItem(T.SNOOZE_KEY)) === clock);
  clock += 3 * DAY;
  eq('three days after "Not now": not shown', await P.offer({ name: 'Reading Rockets' }), { shown: false, why: 'snoozed' });
  clock += 11 * DAY - 60000;
  eq('a minute short of fourteen days: still not shown', (await P.offer({ name: 'x' })).why, 'snoozed');
  clock += 120000;
  eq('fourteen days and a minute: asked again', (await P.offer({ name: 'x' })).view, 'ask');

  b = iphoneTab(); signIn(b.ls);
  eq('an iPhone tab gets the Home Screen steps instead', await P.offer({ name: 'Reading Rockets' }), { shown: false, why: 'no-document', view: 'install' });
  b.ls.setItem(T.SNOOZE_KEY, String(Date.now() - DAY));
  eq('...and "Got it" snoozes those too', (await P.offer({ name: 'x' })).why, 'snoozed');

  b = android({ permission: 'default' }); signIn(b.ls, { expired: true });
  eq('an expired sign-in with nothing to refresh it is signed out', (await P.offer({ name: 'x' })).why, 'signed-out');
  b = android({ permission: 'default' }); signIn(b.ls, { expired: true, refresh: true });
  eq('...one access.js can refresh is not', (await P.offer({ name: 'x' })).view, 'ask');

  b = android({ permission: 'default', storage: memStore(true) });
  let threw = false;
  try { T.snooze(); } catch (_) { threw = true; }
  ok('blocked storage: snoozing does not throw', !threw);
  eq('...and nobody is signed in as far as the sheet knows', (await P.offer({ name: 'x' })).why, 'signed-out');
}

/* =========================================================== enable() === */
console.log('\nenable(): permission, worker, subscription, the two writes');
{
  const b = android({ permission: 'default', answer: 'granted' });
  const tok = signIn(b.ls);
  const pending = P.enable();
  ok('the permission prompt is asked for before anything is awaited (the tap is still live)', b.calls.perm === 1, b.calls.perm);
  const r = await pending;
  eq('it works: ok, on, and a sentence', r, { ok: true, state: 'on', message: P.MESSAGES.on });
  eq('the worker is registered at the URL and scope nav.js uses', b.calls.register, [['/epinoia/sw.js', { scope: '/epinoia/' }]]);
  ok('subscribed with userVisibleOnly', b.calls.subscribe.length === 1 && b.calls.subscribe[0].userVisibleOnly === true);
  eq('...and the VAPID key as bytes', Array.from(b.calls.subscribe[0].applicationServerKey), Array.from(Buffer.from(CFG_VAPID, 'base64url')));
  eq('exactly two requests', b.calls.fetch.length, 2);
  const [up, pref] = b.calls.fetch;
  eq('the subscription is upserted on endpoint', [up.method, up.url], ['POST', 'https://' + REF + '.supabase.co/rest/v1/push_subscriptions?on_conflict=endpoint']);
  eq('...merging a duplicate rather than failing on it', up.headers.Prefer, 'resolution=merge-duplicates');
  eq('...with the apikey, the fan\'s token and JSON', [up.headers.apikey, up.headers.Authorization, up.headers['Content-Type']],
     ['sb_publishable_test', 'Bearer ' + tok, 'application/json']);
  eq('...and the row: who, where, both keys, which browser, which kind of client (0128)', up.body,
     { user_id: 'u1', endpoint: 'https://push.example/ep1', p256dh: 'P256-ep1', auth: 'AUTH-ep1', ua: UA.android, client: 'tab' });
  eq('then notify_push is switched on', [pref.method, pref.url, pref.body],
     ['POST', 'https://' + REF + '.supabase.co/rest/v1/rpc/set_fan_prefs', { p: { notify_push: true } }]);
  eq('...with the same credentials', [pref.headers.apikey, pref.headers.Authorization], ['sb_publishable_test', 'Bearer ' + tok]);
}
{
  const b = android({ permission: 'default', answer: 'granted' });
  signIn(b.ls, { id: 'from-jwt', noUser: true });
  await P.enable();
  eq('a stored session without its user object: user_id from the token', b.calls.fetch[0].body.user_id, 'from-jwt');
}
{
  /* THE CLIENT COLUMN BEFORE 0128: PostgREST answers 400 to a row naming a column it does not
     know, and the phone must still be saved */
  const b = android({ permission: 'default', answer: 'granted',
                      respond: (u, init) => (u.includes('push_subscriptions') && JSON.parse(init.body).client ? 400 : 201) });
  signIn(b.ls);
  const r = await P.enable();
  const saves = b.calls.fetch.filter(f => f.url.includes('push_subscriptions'));
  ok('before 0128 (a 400 for the client column): the row is sent again without it, and turning on works',
     r.ok && saves.length === 2 && saves[0].body.client === 'tab' && !('client' in saves[1].body) &&
     saves[1].body.endpoint === saves[0].body.endpoint && b.calls.fetch.length === 3, JSON.stringify(b.calls.fetch.map(f => f.body)));

  const b2 = android({ permission: 'default', answer: 'granted', respond: u => (u.includes('push_subscriptions') ? 400 : 201) });
  signIn(b2.ls);
  const r2 = await P.enable();
  ok('...a 400 that is not about the column still fails after the one retry, and notify_push stays as it was',
     !r2.ok && r2.message === P.MESSAGES.save && b2.calls.fetch.length === 2);

  android(); eq('client: a browser tab', T.clientKind(), 'tab');
  android({ displayStandalone: true }); eq('client: an installed web app', T.clientKind(), 'pwa');
  iphoneTab({ standalone: true }); eq('client: an iPhone Home Screen app is an installed web app too', T.clientKind(), 'pwa');
  android({ ua: UA.samsung, displayStandalone: true }); eq('client: Samsung Internet\'s installed web app', T.clientKind(), 'samsung-app');
  android({ ua: UA.samsung }); eq('client: a Samsung Internet tab', T.clientKind(), 'tab');
  android({ displayStandalone: true, shell: { shell: 1, notif: 1, chan: 4, at: 1 } }); eq('client: the Epinoia Android app', T.clientKind(), 'twa');
}
{
  const long = 'x'.repeat(260);
  const b = android({ permission: 'default', answer: 'granted', ua: long });
  signIn(b.ls);
  await P.enable();
  eq('the user agent is cut to 200 characters', b.calls.fetch[0].body.ua.length, 200);
}
{
  const b = android({ permission: 'granted', sub: { endpoint: 'https://push.example/kept', key: T.keyBytes(CFG_VAPID) } });
  signIn(b.ls);
  const r = await P.enable();
  ok('an existing subscription for our key is reused, not replaced', r.ok && b.calls.subscribe.length === 0 &&
     b.calls.unsubscribe.length === 0 && b.calls.fetch[0].body.endpoint === 'https://push.example/kept');
}
{
  const b = android({ permission: 'granted', sub: { endpoint: 'https://push.example/oldkey', key: T.keyBytes('AQID') } });
  signIn(b.ls);
  const r = await P.enable();
  ok('one made with another key (a rotated pair) is dropped and replaced', r.ok && b.calls.unsubscribe[0] === 'https://push.example/oldkey' &&
     b.calls.subscribe.length === 1 && b.calls.fetch[0].body.endpoint === 'https://push.example/ep1');
}
{
  let b = android({ permission: 'default', answer: 'denied' }); signIn(b.ls);
  let r = await P.enable();
  ok('the prompt answered Block: denied, a sentence, and nothing registered or written',
     !r.ok && r.state === 'denied' && r.message === P.MESSAGES.denied && !b.calls.register.length && !b.calls.fetch.length);

  b = android({ permission: 'default', answer: 'default' }); signIn(b.ls);
  r = await P.enable();
  ok('the prompt dismissed: off, and says to choose Allow', !r.ok && r.state === 'off' && r.message === P.MESSAGES.dismissed);

  b = android({ permission: 'denied' }); signIn(b.ls);
  r = await P.enable();
  ok('already blocked: no prompt at all (the browser would not show one)', !r.ok && r.state === 'denied' && b.calls.perm === 0);

  b = android({ permission: 'default', answer: 'granted' });
  r = await P.enable();
  ok('signed out: no prompt, and a sentence saying to sign in', !r.ok && b.calls.perm === 0 && r.message === P.MESSAGES.signedOut);

  b = iphoneTab(); signIn(b.ls);
  r = await P.enable();
  ok('an iPhone tab: the Home Screen explanation', !r.ok && r.state === 'ios-install' && r.message === P.MESSAGES.iosInstall);

  b = browser({ ua: UA.chrome, noSW: true }); signIn(b.ls);
  r = await P.enable();
  ok('a browser that cannot: unsupported', !r.ok && r.state === 'unsupported' && r.message === P.MESSAGES.unsupported);

  b = android({ permission: 'default', answer: 'granted', vapid: '' }); signIn(b.ls);
  r = await P.enable();
  ok('no VAPID key on the site: says so, asks nothing', !r.ok && r.message === P.MESSAGES.notConfigured && b.calls.perm === 0);

  b = android({ permission: 'default', answer: 'granted', registerThrows: true }); signIn(b.ls);
  r = await P.enable();
  ok('the worker will not register: a sentence', !r.ok && r.message === P.MESSAGES.worker);

  b = android({ permission: 'default', answer: 'granted', subscribeThrows: true }); signIn(b.ls);
  r = await P.enable();
  ok('the push service refuses the subscription: a sentence', !r.ok && r.message === P.MESSAGES.subscribe && !b.calls.fetch.length);

  b = android({ permission: 'default', answer: 'granted', respond: u => (u.includes('push_subscriptions') ? 500 : 200) }); signIn(b.ls);
  r = await P.enable();
  ok('the upsert fails: not ok, and notify_push is not switched on for a phone that was not saved',
     !r.ok && r.message === P.MESSAGES.save && b.calls.fetch.length === 1);

  b = android({ permission: 'default', answer: 'granted', respond: () => 'throw' }); signIn(b.ls);
  r = await P.enable();
  ok('no connection: the same sentence, nothing thrown', !r.ok && r.message === P.MESSAGES.save);

  b = android({ permission: 'default', answer: 'granted', respond: () => 401 }); signIn(b.ls);
  r = await P.enable();
  ok('a 401: sign in again', !r.ok && r.message === P.MESSAGES.expired);

  b = android({ permission: 'default', answer: 'granted', respond: u => (u.includes('set_fan_prefs') ? 500 : 201) }); signIn(b.ls);
  r = await P.enable();
  ok('saved but the preference write fails: says exactly that', !r.ok && r.state === 'on' && r.message === P.MESSAGES.prefs);

  b = android({ permission: 'default', answer: 'granted', respond: (u, i, n) => (n === 1 ? 403 : 201) }); signIn(b.ls);
  r = await P.enable();
  ok('the endpoint is another account\'s row (403): this browser takes a fresh subscription and saves that',
     r.ok && b.calls.unsubscribe[0] === 'https://push.example/ep1' && b.calls.subscribe.length === 2 &&
     b.calls.fetch[1].url.includes('push_subscriptions') && b.calls.fetch[1].body.endpoint === 'https://push.example/ep2',
     JSON.stringify(b.calls.fetch.map(f => f.body)));

  const bad = Object.entries(P.MESSAGES).filter(([, m]) => !/^[A-Z][^]*[.]$/.test(m) || /undefined|null|\[object/.test(m));
  ok('every message is a plain sentence', !bad.length, JSON.stringify(bad));
}

/* ============================================================ disable() === */
console.log('\ndisable(), test() and sync()');
{
  const EP = 'https://fcm.googleapis.com/fcm/send/a:b/c?d=1';
  let b = android({ permission: 'granted', sub: { endpoint: EP, key: T.keyBytes(CFG_VAPID) } });
  const tok = signIn(b.ls);
  let r = await P.disable();
  eq('the row is deleted by its endpoint', [b.calls.fetch[0].method, b.calls.fetch[0].url],
     ['DELETE', 'https://' + REF + '.supabase.co/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(EP)]);
  eq('...with the fan\'s token', b.calls.fetch[0].headers.Authorization, 'Bearer ' + tok);
  ok('...then the browser unsubscribes', b.calls.unsubscribe[0] === EP);
  ok('notify_push is left alone unless asked (other phones keep theirs)', b.calls.fetch.length === 1);
  eq('...and the answer', r, { ok: true, state: 'off', message: P.MESSAGES.off });

  b = android({ permission: 'granted', sub: { endpoint: EP, key: T.keyBytes(CFG_VAPID) } }); signIn(b.ls);
  await P.disable({ notifyPush: false });
  eq('asked by the profile page: notify_push goes off too', [b.calls.fetch[1].url.endsWith('/rpc/set_fan_prefs'), b.calls.fetch[1].body], [true, { p: { notify_push: false } }]);

  b = android({ permission: 'granted' }); signIn(b.ls);
  r = await P.disable();
  ok('nothing subscribed: nothing deleted, still ok', r.ok && !b.calls.fetch.length);

  b = android({ permission: 'granted', sub: { endpoint: EP, key: T.keyBytes(CFG_VAPID) }, respond: () => 500 }); signIn(b.ls);
  r = await P.disable();
  ok('the delete fails: the browser still unsubscribes, and says the row will clear itself',
     r.ok && b.calls.unsubscribe.length === 1 && r.message === P.MESSAGES.offKept);
}
{
  let b = android({ permission: 'granted', json: () => ({ sent: 1 }) });
  const tok = signIn(b.ls);
  let r = await P.test();
  eq('a test is one POST to the notify function', [b.calls.fetch.length, b.calls.fetch[0].method, b.calls.fetch[0].url],
     [1, 'POST', 'https://' + REF + '.supabase.co/functions/v1/notify']);
  eq('...saying {test: true} (and no endpoint: this browser holds no subscription)', b.calls.fetch[0].body, { test: true, endpoint: '' });
  eq('...with the apikey and the fan\'s token', [b.calls.fetch[0].headers.apikey, b.calls.fetch[0].headers.Authorization], ['sb_publishable_test', 'Bearer ' + tok]);
  eq('...and a sentence back', r, { ok: true, devices: [], message: P.MESSAGES.testSent });

  b = android({ json: () => ({ sent: 0 }) }); signIn(b.ls);
  eq('it reached nobody: says what to do', await P.test(), { ok: false, devices: [], message: P.MESSAGES.testNone });

  /* this phone holds a subscription: it is saved under the account first, named in the
     request, and the answer waits for this phone's worker */
  const EPT = 'https://fcm.googleapis.com/fcm/send/this-phone';
  const mineOk = { sent: 1, devices: [{ service: 'fcm', status: 201, ok: true, thisPhone: true, text: 'Google accepted it for this phone.' }] };
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: url => /notify$/.test(url) ? mineOk : {}, arrive: () => ({ tag: 'test', shown: true }) });
  signIn(b.ls);
  r = await P.test();
  eq('this phone: the subscription is re-saved, then the test names it', [b.calls.fetch.length, b.calls.fetch[0].url.includes('/rest/v1/push_subscriptions'), b.calls.fetch[1].body],
     [2, true, { test: true, endpoint: EPT }]);
  eq('...and when its worker says the test arrived and showed, it says so', r.message, P.MESSAGES.testArrived);
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: url => /notify$/.test(url) ? mineOk : {}, arrive: () => ({ tag: 'test', shown: false, error: 'not allowed' }) });
  signIn(b.ls);
  eq('arrived but not allowed to show: says so', (await P.test()).message, P.MESSAGES.testNotShown);
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) },
                json: url => /notify$/.test(url) ? mineOk : {} });
  signIn(b.ls);
  eq('accepted but no word from the worker: says it has not arrived', (await P.test()).message, P.MESSAGES.testNotArrived);
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) },
                json: url => /notify$/.test(url) ? { sent: 1, devices: [{ ok: true, thisPhone: false }] } : {} });
  signIn(b.ls);
  eq('the account\'s other phones got it, this one is not on the account: says so', (await P.test()).message, P.MESSAGES.testNotThisPhone);
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) },
                json: url => /notify$/.test(url) ? { sent: 0, devices: [{ ok: false, status: 403, thisPhone: true, text: 'Google refused it.' }] } : {} });
  signIn(b.ls);
  eq('this phone refused: the push service\'s reason, and the way to fix it', (await P.test()).message, 'Google refused it. ' + P.MESSAGES.runCheck);
  b = android({ respond: () => 401 }); signIn(b.ls);
  eq('401: sign in again', await P.test(), { ok: false, message: P.MESSAGES.expired });
  b = android({ respond: () => 500 }); signIn(b.ls);
  eq('500: try again later', await P.test(), { ok: false, message: P.MESSAGES.testFailed });
  b = android({ respond: () => 'throw' }); signIn(b.ls);
  eq('offline: check the connection', await P.test(), { ok: false, message: P.MESSAGES.testOffline });
  b = android();
  const r2 = await P.test();
  ok('signed out: nothing sent', !r2.ok && !b.calls.fetch.length && r2.message === P.MESSAGES.signedOut);

  /* THE LOCKED-PHONE TEST: the server waits, so the request says how long */
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: url => /notify$/.test(url) ? Object.assign({ delayed: 10 }, mineOk) : {}, arrive: () => ({ tag: 'test', shown: true }) });
  signIn(b.ls);
  r = await P.test({ delay: 10 });
  eq('test({delay: 10}) asks notify to wait 10 s', b.calls.fetch.find(f => /notify$/.test(f.url)).body, { test: true, endpoint: EPT, delay: 10 });
  eq('...and, answered with delayed by a notify that waited, still hears the receipt', r.message, P.MESSAGES.testArrived);
  /* a notify deployed before the delay: sent at once, answered without delayed */
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: url => /notify$/.test(url) ? mineOk : {}, arrive: () => ({ tag: 'test', shown: true }) });
  signIn(b.ls);
  r = await P.test({ delay: 10 });
  eq('an old notify (no delayed in its answer): not ok, says it could not wait, so nobody is asked whether it popped up',
     [r.ok, r.notDelayed, r.message], [false, true, P.MESSAGES.testNotDelayed]);
  b = android({ permission: 'granted', sub: { endpoint: EPT, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: url => /notify$/.test(url) ? mineOk : {}, arrive: () => ({ tag: 'test', shown: true }) });
  signIn(b.ls);
  eq('...a plain test from the same notify is unaffected', (await P.test()).message, P.MESSAGES.testArrived);
  b = android({ json: () => ({ sent: 1 }) }); signIn(b.ls);
  await P.test({ delay: 45 });
  eq('a longer delay is cut to 10', b.calls.fetch[0].body.delay, 10);
  b = android({ json: () => ({ sent: 1 }) }); signIn(b.ls);
  await P.test({ delay: 'soon' });
  eq('a delay that is not a number is no delay: the body is the plain test', b.calls.fetch[0].body, { test: true, endpoint: '' });
}
{
  let b = android({ permission: 'granted', sub: { endpoint: 'https://push.example/s', key: T.keyBytes(CFG_VAPID) } });
  signIn(b.ls, { id: 'u2' });
  let r = await P.sync();
  ok('sync re-saves this browser under whoever is signed in now, and nothing else',
     r.ok && b.calls.fetch.length === 1 && b.calls.fetch[0].body.user_id === 'u2' && b.calls.fetch[0].body.endpoint === 'https://push.example/s' && b.calls.perm === 0);
  b = android({ permission: 'default' }); signIn(b.ls);
  r = await P.sync();
  ok('...and never prompts or writes when permission is not granted', !r.ok && !b.calls.fetch.length && b.calls.perm === 0);
}

/* ============================================================== check() === */
console.log('\ncheck(): why nothing arrives');
{
  const ids = r => r.steps.map(s => s.id + ':' + (s.ok === true ? 'ok' : s.ok === false ? 'bad' : '?'));
  const EPC = 'https://fcm.googleapis.com/fcm/send/checked';

  let b = android({ ua: UA.android });
  eq('platform: Chrome on Android in a tab', T.platform(), 'android-chrome');
  b = android({ displayStandalone: true });
  eq('...the installed app', T.platform(), 'android-app');
  b = android({ ua: UA.android.replace('Chrome/128', 'SamsungBrowser/25.0 Chrome/128') });
  eq('...Samsung Internet', T.platform(), 'android-samsung');
  b = iphoneTab({ standalone: true, noPush: false, noNotification: false });
  eq('...an iPhone Home Screen app', T.platform(), 'ios-app');
  b = browser({ ua: UA.chrome });
  eq('...a computer', T.platform(), 'desktop');
  ok('every platform has settings to point at', ['android-app', 'android-chrome', 'android-samsung', 'ios-app', 'ios-safari', 'desktop']
     .every(k => Array.isArray(T.SETTINGS[k]) && T.SETTINGS[k].length > 0));
  ok('the installed Android app is sent to App info, a Chrome tab to Site settings',
     /App info/.test(T.SETTINGS['android-app'].join(' ')) && /Site settings/.test(T.SETTINGS['android-chrome'].join(' ')));

  b = android({ noPush: true });
  let r = await P.check();
  eq('a browser without push: one step, and where to go instead', [ids(r), r.ok, /Chrome or Samsung Internet/.test(r.advice.lines.join(' '))],
     [['browser:bad'], false, true]);

  b = android({ permission: 'denied' });
  r = await P.check();
  eq('blocked in a Chrome tab: the permission step fails, and Site settings is the fix',
     [ids(r), r.advice.lines.some(l => /Site settings/.test(l))], [['browser:ok', 'permission:bad'], true]);
  b = android({ permission: 'denied', displayStandalone: true });
  r = await P.check();
  ok('...blocked in the installed app: App info is the fix', r.advice.lines.some(l => /App info/.test(l)));
  b = android({ permission: 'default' });
  r = await P.check();
  ok('never asked: told to tap Turn on, and it did not prompt by itself', /Turn on/.test(r.advice.lines[0]) && b.calls.perm === 0);

  const rows = { row: [{ id: 'row1', last_push_at: null, last_push_status: null, last_push_error: null }] };
  const answers = (over = {}) => (url, body) => {
    if (/\/rest\/v1\/push_subscriptions\?select=/.test(url)) return (typeof over.rows === 'function' ? over.rows() : over.rows) || rows.row;
    if (/\/rest\/v1\/fan_prefs\?select=notify_push/.test(url)) return over.prefs || [{ notify_push: true }];
    if (/\/functions\/v1\/notify$/.test(url)) return (over.notify || (() => ({ ok: true, status: 201, service: 'fcm', text: 'Google accepted it for this phone.', saved: 'yours' })))(body);
    return {};
  };
  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: answers(), arrive: (url, body) => body && body.check ? { tag: 'check', shown: true } : null });
  signIn(b.ls);
  let seen = 0;
  r = await P.check(() => { seen++; });
  eq('everything works: every step passes, in the order a notification travels',
     ids(r), ['browser:ok', 'permission:ok', 'worker:ok', 'subscription:ok', 'account:ok', 'channel:ok', 'delivery:ok', 'arrival:ok']);
  ok('...onStep heard each step as it landed', seen === r.steps.length, seen);
  const checkCall = b.calls.fetch.find(f => /notify$/.test(f.url));
  eq('...the device check sends this phone\'s own subscription', checkCall.body, { check: { endpoint: EPC, keys: { p256dh: 'P256-ked', auth: 'AUTH-ked' } } });
  ok('...and the advice says what to look at if it still did not appear', r.ok && /Everything/.test(r.advice.title) && r.advice.lines.length > 1);
  ok('...never asking for permission, never unsubscribing', b.calls.perm === 0 && b.calls.unsubscribe.length === 0);

  /* the row appears once the check has saved it */
  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: answers({ rows: () => b.calls.fetch.some(f => f.method === 'POST' && /on_conflict=endpoint/.test(f.url)) ? rows.row : [] }),
                arrive: (url, body) => body && body.check ? { tag: 'check', shown: true } : null });
  signIn(b.ls);
  r = await P.check();
  const acct = r.steps.find(s => s.id === 'account');
  ok('a phone missing from the account is added, and the check says so',
     acct && b.calls.fetch.some(f => f.method === 'POST' && /push_subscriptions\?on_conflict=endpoint/.test(f.url)) && /added just now/.test(acct.detail));

  let n = 0;
  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: answers({ notify: () => (++n === 1 ? { ok: false, status: 410, fix: 'resubscribe', text: 'Google says this phone’s sign-up has expired.' }
                                                      : { ok: true, status: 201, service: 'fcm', text: 'ok' }) }),
                arrive: (url, body) => body && body.check && body.check.endpoint !== EPC ? { tag: 'check', shown: true } : null });
  signIn(b.ls);
  r = await P.check();
  ok('an expired sign-up is renewed on the spot and checked again',
     b.calls.unsubscribe.includes(EPC) && b.calls.subscribe.length >= 1 && r.steps.some(s => s.id === 'renewed' && s.ok) && r.ok, JSON.stringify(ids(r)));

  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, json: answers() });
  signIn(b.ls);
  const real = T.RECEIPT_MS;
  r = await P.check();
  eq('accepted but never heard from the worker: the arrival step fails with the background settings to check',
     [r.steps[r.steps.length - 1].id, r.steps[r.steps.length - 1].ok, r.advice.lines.some(l => /Battery/.test(l))], ['arrival', false, true]);
  ok('(no listener in this browser, so the wait ended at once rather than after ' + real + ' ms)', true);

  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, receipts: true, json: answers({ prefs: [{ notify_push: false }] }),
                arrive: (url, body) => body && body.check ? { tag: 'check', shown: true } : null });
  signIn(b.ls);
  r = await P.check();
  ok('the account\'s phone alerts switched off: named as the problem even though the test arrives',
     r.steps.some(s => s.id === 'channel' && s.ok === false) && !r.ok && /Phone and desktop alerts/.test(r.advice.title));

  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, receipts: true, json: answers(),
                arrive: (url, body) => body && body.check ? { tag: 'check', shown: true } : null });
  r = await P.check();
  eq('signed out: the phone works, the advice says to sign in (not that everything works)',
     [r.ok, r.steps.find(s => s.id === 'account').ok, /sign in/.test(r.advice.title), r.steps[r.steps.length - 1].id],
     [false, false, true, 'arrival']);

  b = android({ permission: 'granted', sub: { endpoint: EPC, key: T.keyBytes(CFG_VAPID) }, receipts: true,
                json: answers({ rows: [{ id: 'row1', last_push_at: '2026-09-19T14:00:00Z', last_push_status: 403, last_push_error: 'the VAPID credentials do not match' }] }),
                arrive: (url, body) => body && body.check ? { tag: 'check', shown: true } : null });
  signIn(b.ls);
  r = await P.check();
  const hist = r.steps.find(s => s.id === 'history');
  ok('an earlier refusal is shown for information, and a test that now works still reads as working',
     hist && hist.ok === null && /refused \(403\)/.test(hist.label) && r.ok && /Everything/.test(r.advice.title));
}

/* ======================================================= the Android app === */
console.log('\nthe Epinoia Android app (a Trusted Web Activity on Chrome)');
{
  const ids = r => r.steps.map(s => s.id + ':' + (s.ok === true ? 'ok' : s.ok === false ? 'bad' : '?'));
  const EPA = 'https://fcm.googleapis.com/fcm/send/in-the-app';
  const INTENT = 'intent://notification-settings#Intent;scheme=epinoia;package=uk.co.prophesyscouting.epinoia;end';
  /* the app: Chrome's user agent, display-mode standalone, and the launcher's report */
  const twa = (shell, o = {}) => android(Object.assign({ displayStandalone: true, shell }, o));
  const HIGH = { shell: 3, notif: 1, chan: 4, at: 1758300000000 };

  eq('settingsIntent is the native settings screen\'s intent link', P.settingsIntent, INTENT);
  eq('IMPORTANCE_HIGH is 4', T.IMPORTANCE_HIGH, 4);

  twa(HIGH);
  eq('platform: the launcher\'s report in this session makes it android-twa, not android-app', [T.platform(), P.inApp()], ['android-twa', true]);
  android({ search: '?source=twa&shell=3' });
  eq('...so does a launch with ?source=twa, before appmode.js has saved anything', [T.platform(), P.inApp()], ['android-twa', true]);
  android({ ua: UA.samsung, displayStandalone: true, shell: HIGH });
  eq('...never Samsung Internet, whatever its session holds (its web app is Samsung\'s to post)', [T.platform(), P.inApp()], ['android-samsung-app', false]);
  android({ displayStandalone: true });
  eq('...an installed web app without the launcher is still android-app', [T.platform(), P.inApp()], ['android-app', false]);
  /* a window a notification tap opened while the app was closed: a new session, no report */
  android({ displayStandalone: true, twaSeen: 3 });
  eq('...a standalone Chrome window on a phone that has run the app (epinoia_twa_seen) is the app', [T.platform(), P.inApp(), T.clientKind()], ['android-twa', true, 'twa']);
  android({ twaSeen: 3 });
  eq('...but a plain Chrome tab on that phone is not', [T.platform(), P.inApp(), T.clientKind()], ['android-chrome', false, 'tab']);
  android({ ua: UA.samsung, displayStandalone: true, twaSeen: 3 });
  eq('...nor Samsung Internet\'s web app, whatever localStorage holds', [P.inApp(), T.clientKind()], [false, 'samsung-app']);
  android({ referrer: 'android-app://uk.co.prophesyscouting.epinoia/' });
  eq('...the app\'s own android-app:// referrer is the app', [T.platform(), P.inApp()], ['android-twa', true]);
  android({ referrer: 'android-app://com.google.android.gm/' });
  eq('...another app\'s referrer (Gmail) is not', P.inApp(), false);
  browser({ ua: UA.chrome, shell: HIGH });
  ok('...and a computer is never the app', !P.inApp() && T.platform() === 'desktop');
  android({ shell: 'not json' });
  let threw = false;
  try { T.launchState(); } catch (_) { threw = true; }
  ok('a stored report that will not parse is no report, and nothing throws', !threw);

  twa(HIGH);
  const h = P.help();
  const words = h.steps.join(' ');
  ok('help(): Game alerts on Alert with pop-up, One UI\'s Detailed pop-up style, both batteries Unrestricted and never sleeping, Do Not Disturb',
     /Game alerts/.test(words) && /Alert rather than Silent/.test(words) && /pop-up/.test(words) && /Detailed/.test(words) &&
     /EPINOIΛ, then Battery/.test(words) && /Unrestricted/.test(words) && /Chrome/.test(words) && /Sleeping apps/.test(words) &&
     /Never sleeping apps/.test(words) && /Do Not Disturb/.test(words), words);
  eq('...and the Open notification settings action', [h.platform, h.action], ['android-twa', { label: 'Open notification settings', href: INTENT }]);
  android();
  ok('a Chrome tab\'s help carries no such action', !('action' in P.help()));
  ok('every platform, the app included, has settings to point at',
     ['android-twa', 'android-app', 'android-chrome', 'android-samsung', 'android-samsung-app', 'ios-app', 'ios-safari', 'desktop']
       .every(k => Array.isArray(T.SETTINGS[k]) && T.SETTINGS[k].length > 0 && Array.isArray(T.QUIET[k])));

  /* the check trusts what Android told the launcher, not the JavaScript permission */
  const answers = (url, body) => {
    if (/\/rest\/v1\/push_subscriptions\?select=/.test(url)) return [{ id: 'rowA', last_push_at: null, last_push_status: null, last_push_error: null }];
    if (/\/rest\/v1\/fan_prefs\?select=notify_push/.test(url)) return [{ notify_push: true }];
    if (/\/functions\/v1\/notify$/.test(url)) return { ok: true, status: 201, service: 'fcm', text: 'Google accepted it for this phone.', saved: 'yours' };
    return {};
  };
  const arrive = (url, body) => body && body.check ? { tag: 'check', shown: true } : null;

  let b = twa({ shell: 3, notif: 0, chan: 4, at: 1 }, { permission: 'granted', sub: { endpoint: EPA, key: T.keyBytes(CFG_VAPID) } });
  signIn(b.ls);
  let r = await P.check();
  let perm = r.steps.find(s => s.id === 'permission');
  ok('notifications off for the app (notif=0) fail the permission step even though the page says granted',
     perm && perm.ok === false && /turned off for the EPINOIΛ app/.test(perm.label) && /as of this launch/.test(perm.label) && !r.ok, JSON.stringify(ids(r)));
  ok('...the page\'s own permission is shown, for information only', /allowed/.test(perm.detail) && /app’s own setting is what counts/.test(perm.detail));
  ok('...the check stops there, with the settings button and a prompt to reopen the app',
     ids(r).join() === 'browser:ok,permission:bad' && r.advice.action && r.advice.action.href === INTENT &&
     r.advice.lines.some(l => /open it again/.test(l)) && /reopen/.test(r.advice.title));
  ok('...and nothing was asked, subscribed or sent', b.calls.perm === 0 && !b.calls.subscribe.length && !b.calls.fetch.length);

  b = twa({ shell: 3, notif: 1, chan: 3, at: 1 }, { permission: 'granted' });
  r = await P.check();
  perm = r.steps.find(s => s.id === 'permission');
  ok('Game alerts below HIGH (chan=3) fails: it sounds but does not pop up', perm.ok === false && /not to pop up/.test(perm.label) && /pop up/.test(r.advice.title));
  b = twa({ shell: 3, notif: 1, chan: 2, at: 1 }, { permission: 'granted' });
  ok('...Silent (chan=2) says Silent', /Silent/.test((await P.check()).steps.find(s => s.id === 'permission').label));
  b = twa({ shell: 3, notif: 1, chan: 0, at: 1 }, { permission: 'granted' });
  ok('...off (chan=0) says switched off', /switched off/.test((await P.check()).steps.find(s => s.id === 'permission').label));
  b = twa({ shell: 3, notif: 1, chan: -1, at: 1 }, { permission: 'granted' });
  r = await P.check();
  ok('...a channel not created yet (chan=-1) says reopen', r.steps.find(s => s.id === 'permission').ok === false && /Reopen/.test(r.advice.title));

  b = twa(HIGH, { permission: 'default', receipts: true, sub: { endpoint: EPA, key: T.keyBytes(CFG_VAPID) }, json: answers, arrive });
  signIn(b.ls);
  r = await P.check();
  perm = r.steps.find(s => s.id === 'permission');
  eq('on and HIGH at launch: the permission step passes although the page\'s permission reads "not asked", and the check goes on to the end',
     ids(r), ['browser:ok', 'permission:ok', 'worker:ok', 'subscription:ok', 'account:ok', 'channel:ok', 'delivery:ok', 'arrival:ok']);
  ok('...labelled as of this launch, with the page\'s permission beside it', /Game alerts pops up \(as of this launch\)/.test(perm.label) && /not asked/.test(perm.detail));
  ok('...the advice names the app\'s settings and carries the button', r.ok && r.advice.action && r.advice.action.href === INTENT &&
     r.advice.lines.some(l => /Game alerts/.test(l)));

  b = twa(HIGH, { permission: 'granted', sub: { endpoint: EPA, key: T.keyBytes(CFG_VAPID) }, json: answers });
  signIn(b.ls);
  r = await P.check();
  ok('accepted but never shown in the app: the arrival step fails with the app\'s battery and pop-up settings and the button',
     r.steps[r.steps.length - 1].id === 'arrival' && r.steps[r.steps.length - 1].ok === false &&
     r.advice.lines.some(l => /Chrome/.test(l) && /Unrestricted/.test(l)) && r.advice.action && r.advice.action.href === INTENT);

  b = android({ search: '?source=twa', permission: 'denied' });
  r = await P.check();
  ok('launched without the launcher\'s report: the page\'s permission decides, the fix is the app\'s settings, and the button is there',
     r.steps.find(s => s.id === 'permission').ok === false && /Game alerts/.test(r.advice.lines.join(' ')) && r.advice.action && r.advice.action.href === INTENT);

  b = twa(HIGH, { permission: 'default', answer: 'granted' });
  signIn(b.ls);
  await P.enable();
  eq('turning on in the app saves the row as client twa', b.calls.fetch[0].body.client, 'twa');

  /* THE LAUNCH REPORT GOING STALE (1): launched with notif=0 ("Not now" at first launch), then
     Turn on, and Android's own dialog allows it */
  const OFF = { shell: 3, notif: 0, chan: 4, at: 1000 };
  b = twa(OFF, { permission: 'default', answer: 'granted', receipts: true, json: answers, arrive,
                 now: () => 5000 });
  signIn(b.ls);
  ok('launched with notif=0: the card is told Android blocks pop-ups', !!P.appBlocked() && /turned off/.test(P.appBlocked().label));
  let en = await P.enable();
  const after = JSON.parse(b.ss.getItem('epinoia_shell'));
  eq('Turn on allowed through Android\'s dialog: the report now says notif=1, newer, channel and build kept',
     [en.ok, after.notif, after.at, after.chan, after.shell], [true, 1, 5000, 4, 3]);
  ok('...so the card no longer says blocked', P.appBlocked() === null);
  r = await P.check();
  eq('...and Check this phone goes on to the end instead of stopping at "turned off"',
     ids(r), ['browser:ok', 'permission:ok', 'worker:ok', 'subscription:ok', 'account:ok', 'channel:ok', 'delivery:ok', 'arrival:ok']);

  b = twa(OFF, { permission: 'granted', sub: { endpoint: EPA, key: T.keyBytes(CFG_VAPID) }, now: () => 5000 });
  signIn(b.ls);
  await P.enable();
  eq('a permission that already read granted (it can, while Android blocks) proves nothing: the report is left alone',
     JSON.parse(b.ss.getItem('epinoia_shell')).notif, 0);
  b = android({ permission: 'default', answer: 'granted', shell: OFF, ua: UA.samsung, now: () => 5000 });
  signIn(b.ls);
  await P.enable();
  ok('...and outside the app nothing is written', JSON.parse(b.ss.getItem('epinoia_shell')).notif === 0);

  /* (2): the settings screen opened from the button, fixed there, Back into the same session */
  let clockNow = 2000;
  b = twa({ shell: 3, notif: 1, chan: 2, at: 1000 }, { permission: 'granted', receipts: true, sub: { endpoint: EPA, key: T.keyBytes(CFG_VAPID) },
                                                       json: answers, arrive, now: () => clockNow });
  signIn(b.ls);
  ok('Game alerts Silent at launch: blocked, and not stale', !!P.appBlocked() && T.launchStale() === false);
  clockNow = 3000;
  P.settingsOpened();
  eq('settingsOpened() remembers the tap in this session', b.ss.getItem(T.SETTINGS_OPENED_KEY), '3000');
  ok('...the launch report is now stale, and the card stops saying blocked', T.launchStale() === true && P.appBlocked() === null);
  r = await P.check();
  perm = r.steps.find(s => s.id === 'permission');
  ok('...Check this phone marks the permission step neither pass nor fail, saying the settings may have changed',
     perm.ok === null && /may have changed since EPINOIΛ opened/.test(perm.label) && /test below decides/.test(perm.detail));
  eq('...and goes on, so the live test decides', ids(r),
     ['browser:ok', 'permission:?', 'worker:ok', 'subscription:ok', 'account:ok', 'channel:ok', 'delivery:ok', 'arrival:ok']);
  ok('...ending on the app\'s advice with the button, not "reopen"', r.ok && r.advice.action && !/reopen/i.test(r.advice.title));
  b.ss.setItem('epinoia_shell', JSON.stringify({ shell: 3, notif: 1, chan: 2, at: 4000 }));
  ok('a launch after the visit (a newer report) is believed again', T.launchStale() === false && !!P.appBlocked());
  b = android({ permission: 'granted', displayStandalone: true });
  ok('an installed web app (no launch report) is never "blocked" by this', P.appBlocked() === null);
}
T.env(null);

/* ============================================================== sw.js === */
console.log('\nthe service worker');
const swSrc = read('epinoia', 'sw.js');
const ORIGIN = 'https://prophesyscouting.co.uk';
function loadSW(st = {}) {
  const listeners = {};
  const calls = { show: [], open: [], subscribe: [], fetch: [], closed: 0 };
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => {},
    location: { origin: ORIGIN },
    registration: {
      showNotification: async (title, options) => {
        calls.show.push([title, options]);
        if (st.showThrowsOnce && calls.show.length === 1) throw new TypeError('Failed to execute showNotification');
      },
      pushManager: { subscribe: async opts => { calls.subscribe.push(opts); return st.newSub || null; } }
    },
    clients: {
      claim: async () => {},
      matchAll: async q => (q && q.includeUncontrolled ? (st.all || []) : (st.controlled || [])),
      openWindow: async url => { calls.open.push(url); return { url }; }
    }
  };
  const module = { exports: {} };
  const ctx = vm.createContext({
    self, module, URL, atob, console, setTimeout,
    fetch: async (url, init) => { calls.fetch.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
    Response: function Response() {}
  });
  vm.runInContext(swSrc, ctx, { filename: 'sw.js' });
  return { W: module.exports, listeners, calls };
}
const fire = async (fn, ev) => { const waits = []; ev.waitUntil = p => waits.push(p); fn(ev); await Promise.all(waits); };
const client = (url, o = {}) => {
  const c = { id: o.id || url, url, focused: !!o.focused, visibilityState: o.visible === false ? 'hidden' : 'visible', navigated: [], focusedCount: 0 };
  c.focus = async () => { c.focusedCount++; return c; };
  if (!o.noNavigate) c.navigate = async u => { if (o.navigateThrows) throw new TypeError('not controlled'); c.navigated.push(u); return c; };
  return c;
};
{
  const { W, listeners } = loadSW();
  ok('install, fetch, activate, push, notificationclick, pushsubscriptionchange and message are all handled',
     ['install', 'fetch', 'activate', 'push', 'notificationclick', 'pushsubscriptionchange', 'message'].every(t => typeof listeners[t] === 'function'));
  eq('the public URL, key and VAPID key are config.js\'s, character for character',
     [W.SUPABASE_URL, W.SUPABASE_KEY, W.VAPID_PUBLIC_KEY], [CFG_URL, CFG_KEY, CFG_VAPID]);
  ok('the icon and the badge are real files', fs.existsSync(path.join(ROOT, W.ICON.replace(/^\//, ''))) && fs.existsSync(path.join(ROOT, W.BADGE.replace(/^\//, ''))),
     W.ICON + ' ' + W.BADGE);
  eq('icon 192 is the app logo, and the badge is the white silhouette', [W.ICON, W.BADGE], ['/epinoia/brand/epinoia-app-192.png', '/epinoia/brand/epinoia-badge-96.png']);
  {
    /* Android draws a badge from its alpha alone: every pixel white, the ground transparent */
    const png = fs.readFileSync(path.join(ROOT, 'epinoia', 'brand', 'epinoia-badge-96.png'));
    const ihdr = png.indexOf('IHDR');
    eq('the badge is a 96x96 PNG with an alpha channel (RGBA)',
       [png.slice(1, 4).toString(), png.readUInt32BE(ihdr + 4), png.readUInt32BE(ihdr + 8), png[ihdr + 13]], ['PNG', 96, 96, 6]);
  }
  ok('it carries a version line, so a deploy is a new worker', /SW_VERSION = 'notifications-v2-/.test(swSrc));
  ok('...bumped for the app (the badge and the fetch handler changed)', W.SW_VERSION !== 'notifications-v2-2026-09-17-home', W.SW_VERSION);
  ok('fetch: nothing is ever cached', !/caches\./.test(swSrc));
}
{
  /* ONLY A FAILED PAGE LOAD GETS THE OFFLINE PAGE, and with status 200 */
  const swCtx = st => {
    const listeners = {};
    const self = { addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {}, location: { origin: ORIGIN },
                   registration: {}, clients: { claim: async () => {} } };
    const ctx = vm.createContext({
      self, module: { exports: {} }, URL, atob, console, setTimeout,
      fetch: async () => { if (st.offline) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, from: 'network' }; },
      Response: function Response(body, init) { this.body = body; this.status = init.status; this.headers = init.headers; }
    });
    vm.runInContext(swSrc, ctx, { filename: 'sw.js' });
    return listeners;
  };
  const respond = async (listeners, request) => {
    let p = null;
    listeners.fetch({ request, respondWith: x => { p = x; } });
    return p === null ? null : await p;
  };
  let L = swCtx({ offline: true });
  const page = await respond(L, { method: 'GET', mode: 'navigate', url: ORIGIN + '/epinoia/home/' });
  ok('fetch: a page load that fails offline gets the offline page, status 200, as HTML, never stored',
     page && page.status === 200 && /text\/html/.test(page.headers['Content-Type']) && /no-store/.test(page.headers['Cache-Control']) &&
     /EPINOIΛ is offline/.test(page.body), page && JSON.stringify({ status: page.status, headers: page.headers }));
  ok('...light by default, dark when the phone is', /background:#f3faf6/.test(page.body) && /prefers-color-scheme:dark/.test(page.body));
  eq('fetch: a failed JSON read (not a page load) is not answered by the worker, so its caller sees a real network error',
     await respond(L, { method: 'GET', mode: 'cors', url: 'https://abc.supabase.co/rest/v1/games?select=id' }), null);
  eq('fetch: nor is a script or image (no-cors)', await respond(L, { method: 'GET', mode: 'no-cors', url: ORIGIN + '/epinoia/nav.js?v=1' }), null);
  eq('fetch: a POST is not touched', await respond(L, { method: 'POST', mode: 'cors', url: ORIGIN + '/x' }), null);
  L = swCtx({ offline: false });
  const online = await respond(L, { method: 'GET', mode: 'navigate', url: ORIGIN + '/epinoia/home/' });
  ok('fetch: online, a page load is the network\'s own response, passed straight through', online && online.from === 'network');
}
{
  const { W } = loadSW();
  const G = '52bfe03b-d70e-4924-97c1-5f02c15cdf4e';
  const url = ORIGIN + '/epinoia/game/?g=' + G + '&mode=supabase&show=starters';
  const n = W.notificationFor({ title: 'Lineups are in: Rockets v Lions', body: 'Rockets: Baker, Salih, Cole, Diaz, Eze\nLions: …', url,
    tag: 'lineups:' + G, renotify: true, kind: 'lineups', timestamp: 1758301500000, actions: [{ action: 'starters', title: 'See lineups' }] });
  eq('a lineups payload becomes the notification the contract describes', JSON.parse(JSON.stringify(n)), {
    title: 'Lineups are in: Rockets v Lions',
    options: { body: 'Rockets: Baker, Salih, Cole, Diaz, Eze\nLions: …', icon: '/epinoia/brand/epinoia-app-192.png', badge: '/epinoia/brand/epinoia-badge-96.png',
      vibrate: [80, 40, 80], data: { url, kind: 'lineups', actions: { starters: url } },
      tag: 'lineups:' + G, renotify: true, timestamp: 1758301500000, actions: [{ action: 'starters', title: 'See lineups' }] } });

  eq('a league\'s crest in the payload is the icon (a notification button\'s subscriber)',
     W.notificationFor({ title: 'FT', icon: 'https://x.test/crest.png', tag: 't' }).options.icon, 'https://x.test/crest.png');
  eq('...but never one that is not https', W.notificationFor({ title: 'FT', icon: 'javascript:alert(1)', tag: 't' }).options.icon, '/epinoia/brand/epinoia-app-192.png');
  const bare = W.notificationFor({ title: 'x', renotify: true });
  ok('renotify without a tag is dropped (showNotification would throw)', !('renotify' in bare.options) && !('tag' in bare.options));
  const three = W.notificationFor({ tag: 't', actions: [{ action: 'a', title: 'A' }, { action: 'b', title: 'B' }, { action: 'c', title: 'C' }, { action: '', title: 'bad' }] });
  eq('at most two actions', JSON.parse(JSON.stringify(three.options.actions)).map(a => a.action), ['a', 'b']);
  const empty = W.notificationFor(null);
  eq('nothing at all still shows something, and opens HOME', [empty.title, empty.options.body, empty.options.data.url], ['EPINOIΛ', '', '/epinoia/home/']);
  eq('HOME is its own path; the site root stays /epinoia/', [W.HOME_PATH, W.SITE_PATH], ['/epinoia/home/', '/epinoia/']);
  ok('a bad timestamp is left out rather than passed through', !('timestamp' in W.notificationFor({ timestamp: 'soon' }).options));

  eq('"See lineups" on a link that lacks show=starters gains it', W.actionUrl('lineups', 'starters', ORIGIN + '/epinoia/game/?g=1'), ORIGIN + '/epinoia/game/?g=1&show=starters');
  eq('...before a fragment, and with ? when there is no query', W.actionUrl('lineups', 'starters', '/epinoia/game/#top'), '/epinoia/game/?show=starters#top');
  eq('...and is left alone when it already has it', W.actionUrl('lineups', 'starters', url), url);
  eq('"Box score" on a result opens the result\'s page on the box score tab (a final game otherwise opens on its report)',
     W.actionUrl('result', 'box', ORIGIN + '/epinoia/game/?g=1'), ORIGIN + '/epinoia/game/?g=1&tab=box');
  eq('...and a link that already names a tab is left alone', W.actionUrl('result', 'box', ORIGIN + '/epinoia/game/?g=1&tab=pbp'), ORIGIN + '/epinoia/game/?g=1&tab=pbp');
  eq('"Box score" on a half-time notice opens the box score too (tapped after full time, the game opens on its report)',
     W.actionUrl('halftime', 'box', ORIGIN + '/epinoia/game/?g=1&mode=supabase'), ORIGIN + '/epinoia/game/?g=1&mode=supabase&tab=box');

  eq('a text payload (not JSON) is shown as the body', W.readPayload({ json: () => { throw new SyntaxError('x'); }, text: () => 'plain words' }), { title: 'EPINOIΛ', body: 'plain words' });

  /* THE PAYLOAD THE NOTIFY FUNCTION ACTUALLY BUILDS, read by this worker: the keys
     cannot drift apart between the two files without this failing */
  let PL = null;
  try { PL = await import('../functions/_shared/pushpayload.js'); } catch (_) { PL = null; }
  if (PL && typeof PL.payloadFor === 'function') {
    const row = { id: 'n1', kind: 'result', ref: G, game_id: G, title: 'FT · Reading Rockets 96–95 London Lions', body: 'Division One',
                  link: 'game/?g=' + G + '&mode=supabase', created_at: '2026-09-19T21:05:00Z' };
    const out = W.notificationFor(PL.payloadFor(row, ORIGIN + '/epinoia/', Date.now()));
    ok('pushpayload.payloadFor -> notificationFor: title, body, tag, renotify, the Box score button and its page',
       out.title === row.title && out.options.body === 'Division One' && out.options.tag === 'result:' + G && out.options.renotify === true &&
       out.options.actions[0].action === 'box' && W.clickTarget(out.options.data, 'box', ORIGIN) === ORIGIN + '/epinoia/game/?g=' + G + '&mode=supabase&tab=box' &&
       W.clickTarget(out.options.data, '', ORIGIN) === ORIGIN + '/epinoia/game/?g=' + G + '&mode=supabase',
       JSON.stringify(out));
    const lu = W.notificationFor(PL.payloadFor({ id: 'n2', kind: 'lineups', ref: G + ':lineups', game_id: G, title: 'Lineups are in', body: '',
      link: 'game/?g=' + G + '&mode=supabase&show=starters', created_at: '2026-09-19T17:05:00Z' }, ORIGIN + '/epinoia/', Date.now()));
    eq('...and a lineups row\'s "See lineups" lands on the starting fives', W.clickTarget(lu.options.data, 'starters', ORIGIN),
       ORIGIN + '/epinoia/game/?g=' + G + '&mode=supabase&show=starters');
  } else {
    ok('pushpayload.js is there to check the worker against', false, 'supabase/functions/_shared/pushpayload.js did not import');
  }
}
{
  const { listeners, calls } = loadSW();
  await fire(listeners.push, { data: { json: () => ({ title: 'FT · Rockets 96–95 Lions', body: 'Division One', url: ORIGIN + '/epinoia/game/?g=1', tag: 'result:1', renotify: true, kind: 'result', actions: [{ action: 'box', title: 'Box score' }] }) } });
  ok('push: one notification, shown inside waitUntil', calls.show.length === 1 && calls.show[0][0] === 'FT · Rockets 96–95 Lions' && calls.show[0][1].tag === 'result:1');

  const second = loadSW({ showThrowsOnce: true });
  await fire(second.listeners.push, { data: { json: () => ({ title: 'T', body: 'B', tag: 'x', actions: [{ action: 'box', title: 'Box score' }] }) } });
  ok('a browser that rejects the options still gets the words (retried without actions or vibrate)',
     second.calls.show.length === 2 && second.calls.show[1][1].body === 'B' && !('actions' in second.calls.show[1][1]) && !('vibrate' in second.calls.show[1][1]));

  /* the receipt: every open page hears that a push arrived, and whether it showed */
  const heard = [];
  const page = { url: ORIGIN + '/epinoia/me/', postMessage: m => heard.push(m) };
  const third = loadSW({ all: [page, { url: ORIGIN + '/epinoia/', noPost: true }] });
  await fire(third.listeners.push, { data: { json: () => ({ title: 'This phone can get notifications', tag: 'check', kind: 'check' }) } });
  eq('push: the open page hears it arrived and was shown (a client without postMessage is skipped)',
     heard.map(m => [m.type, m.tag, m.kind, m.shown, typeof m.at, m.version]), [['epinoia-push', 'check', 'check', true, 'number', third.W.SW_VERSION]]);
  const heard2 = [];
  const failing = loadSW({ all: [{ url: ORIGIN + '/epinoia/me/', postMessage: m => heard2.push(m) }] });
  failing.W.receipt('test', 'test', false, 'no permission');
  await new Promise(res => setTimeout(res, 5));
  eq('...and hears when the browser refused to show it, with the reason', heard2.map(m => [m.shown, m.error]), [[false, 'no permission']]);

  /* the ping: which worker is running */
  const replies = [];
  third.listeners.message({ data: { type: 'epinoia-ping', id: 'p1' }, ports: [{ postMessage: m => replies.push(m) }] });
  third.listeners.message({ data: { type: 'something-else' }, ports: [{ postMessage: m => replies.push(m) }] });
  eq('message: a ping is answered on its port with the version, anything else is ignored', replies,
     [{ type: 'epinoia-pong', version: third.W.SW_VERSION, id: 'p1' }]);
}
{
  const { W } = loadSW();
  const data = { url: ORIGIN + '/epinoia/game/?g=1', actions: { starters: ORIGIN + '/epinoia/game/?g=1&show=starters' } };
  eq('a tap on a button opens the button\'s page', W.clickTarget(data, 'starters', ORIGIN), ORIGIN + '/epinoia/game/?g=1&show=starters');
  eq('a tap on the notice opens the notice\'s page', W.clickTarget(data, '', ORIGIN), ORIGIN + '/epinoia/game/?g=1');
  eq('an action it does not know opens the notice\'s page', W.clickTarget(data, 'mystery', ORIGIN), ORIGIN + '/epinoia/game/?g=1');
  eq('a relative link resolves under /epinoia/', W.clickTarget({ url: 'game/?g=2' }, '', ORIGIN), ORIGIN + '/epinoia/game/?g=2');
  eq('no data: HOME, never the splash', W.clickTarget(undefined, '', ORIGIN), ORIGIN + '/epinoia/home/');
  eq('an empty url: HOME', W.clickTarget({ url: '' }, '', ORIGIN), ORIGIN + '/epinoia/home/');
  eq('a javascript: link goes nowhere but HOME', W.clickTarget({ url: 'javascript:alert(1)' }, '', ORIGIN), ORIGIN + '/epinoia/home/');
  eq('a league link still resolves under /epinoia/, not under HOME', W.clickTarget({ url: '?l=bcb' }, '', ORIGIN), ORIGIN + '/epinoia/?l=bcb');
  /* the notify deployed before HOME sends link-less rows to the site root */
  eq('the old notify\'s root link (site + \'\'): HOME, never the splash', W.clickTarget({ url: ORIGIN + '/epinoia/' }, '', ORIGIN), ORIGIN + '/epinoia/home/');
  eq('...as index.html too', W.clickTarget({ url: ORIGIN + '/epinoia/index.html' }, '', ORIGIN), ORIGIN + '/epinoia/home/');
  eq('...keeping the query and the hash', W.clickTarget({ url: ORIGIN + '/epinoia/?from=digest#top' }, '', ORIGIN), ORIGIN + '/epinoia/home/?from=digest#top');
  eq('...an empty ?l= is still the splash, so HOME', W.clickTarget({ url: ORIGIN + '/epinoia/?l=' }, '', ORIGIN), ORIGIN + '/epinoia/home/?l=');
  eq('...a button\'s root link too', W.clickTarget({ actions: { open: ORIGIN + '/epinoia/' } }, 'open', ORIGIN), ORIGIN + '/epinoia/home/');
  eq('...but a league front page stays where it is', W.clickTarget({ url: ORIGIN + '/epinoia/?l=bcb' }, '', ORIGIN), ORIGIN + '/epinoia/?l=bcb');
  eq('...and another site\'s /epinoia/ is not rewritten', W.clickTarget({ url: 'https://elsewhere.example/epinoia/' }, '', ORIGIN), 'https://elsewhere.example/epinoia/');
  eq('...nor a deeper page', W.clickTarget({ url: ORIGIN + '/epinoia/fixtures/' }, '', ORIGIN), ORIGIN + '/epinoia/fixtures/');

  const other = client(ORIGIN + '/prophesy/', { focused: true });
  const hidden = client(ORIGIN + '/epinoia/fixtures/', { visible: false });
  const shown = client(ORIGIN + '/epinoia/l/?l=x');
  const focused = client(ORIGIN + '/epinoia/t/?t=y', { focused: true });
  ok('a focused Epinoia window is preferred, and never a window elsewhere on the site', W.pickClient([other, hidden, shown, focused], ORIGIN) === focused);
  ok('...then a visible one', W.pickClient([other, hidden, shown], ORIGIN) === shown);
  ok('...and no Epinoia window at all is null', W.pickClient([other], ORIGIN) === null && W.pickClient(undefined, ORIGIN) === null);
}
{
  const target = ORIGIN + '/epinoia/game/?g=1&show=starters';
  const note = () => ({ close() { note.closed = true; }, data: { url: ORIGIN + '/epinoia/game/?g=1', actions: { starters: target } } });

  let c = client(ORIGIN + '/epinoia/fixtures/');
  let sw = loadSW({ all: [c], controlled: [Object.assign({}, c)] });           // a different object for the same client
  let n = note();
  await fire(sw.listeners.notificationclick, { notification: n, action: 'starters' });
  ok('a controlled Epinoia tab is navigated to the target and focused; no new window',
     note.closed && c.navigated[0] === target && c.focusedCount >= 1 && sw.calls.open.length === 0, JSON.stringify({ nav: c.navigated, open: sw.calls.open }));

  c = client(ORIGIN + '/epinoia/fixtures/');
  sw = loadSW({ all: [c], controlled: [] });
  await fire(sw.listeners.notificationclick, { notification: note(), action: '' });
  ok('an Epinoia tab this worker does not control: a new window instead (navigate would reject)',
     c.navigated.length === 0 && sw.calls.open[0] === ORIGIN + '/epinoia/game/?g=1');

  c = client(ORIGIN + '/epinoia/fixtures/', { navigateThrows: true });
  sw = loadSW({ all: [c], controlled: [c] });
  await fire(sw.listeners.notificationclick, { notification: note(), action: 'starters' });
  ok('navigate() failing falls back to a new window', sw.calls.open[0] === target);

  c = client(ORIGIN + '/prophesy/');
  sw = loadSW({ all: [c], controlled: [c] });
  await fire(sw.listeners.notificationclick, { notification: note(), action: 'starters' });
  ok('a window elsewhere on the site is left alone', c.navigated.length === 0 && sw.calls.open[0] === target);

  sw = loadSW({ all: [], controlled: [] });
  await fire(sw.listeners.notificationclick, { notification: note(), action: 'starters' });
  ok('no window at all: opens one at the target', sw.calls.open[0] === target);
}
{
  const newSub = { endpoint: 'https://push.example/new', toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'NEWP', auth: 'NEWA' } }) };
  const oldKey = new Uint8Array([4, 1, 2, 3]).buffer;
  let sw = loadSW({ newSub });
  await fire(sw.listeners.pushsubscriptionchange, { oldSubscription: { endpoint: 'https://push.example/old', options: { applicationServerKey: oldKey } } });
  ok('a rotated subscription is replaced with the old one\'s key, userVisibleOnly',
     sw.calls.subscribe.length === 1 && sw.calls.subscribe[0].applicationServerKey === oldKey && sw.calls.subscribe[0].userVisibleOnly === true);
  const f = sw.calls.fetch[0] || {};
  eq('...and swapped in the database with the publishable key', [f.url, f.init && f.init.method, f.init && f.init.headers.apikey, f.init && f.init.headers['Content-Type']],
     [CFG_URL + '/rest/v1/rpc/swap_push_subscription', 'POST', CFG_KEY, 'application/json']);
  eq('...saying which row and what replaces it', f.body, { p_old: 'https://push.example/old', p_endpoint: 'https://push.example/new', p_p256dh: 'NEWP', p_auth: 'NEWA' });
  ok('...and no user token (the worker has none; the old endpoint is the credential)', f.init && !('Authorization' in f.init.headers));

  sw = loadSW({ newSub });
  await fire(sw.listeners.pushsubscriptionchange, { oldSubscription: { endpoint: 'https://push.example/old' } });
  eq('an old subscription without its options: subscribes with the VAPID key from config.js',
     Array.from(new Uint8Array(sw.calls.subscribe[0].applicationServerKey)), Array.from(Buffer.from(CFG_VAPID, 'base64url')));

  sw = loadSW({ newSub });
  await fire(sw.listeners.pushsubscriptionchange, { oldSubscription: null, newSubscription: null });
  ok('no old subscription (Chrome): still subscribes, but swaps nothing it cannot identify', sw.calls.subscribe.length === 1 && sw.calls.fetch.length === 0);

  sw = loadSW({ newSub: null });
  await fire(sw.listeners.pushsubscriptionchange, { oldSubscription: { endpoint: 'https://push.example/old' }, newSubscription: newSub });
  ok('the browser already handed over the new one: no second subscribe, one swap', sw.calls.subscribe.length === 0 && sw.calls.fetch.length === 1 &&
     sw.calls.fetch[0].body.p_endpoint === 'https://push.example/new');
  eq('swapBody refuses a subscription without keys', sw.W.swapBody('x', { endpoint: 'y', toJSON: () => ({ keys: {} }) }), null);
}

/* ========================================================== follow.js === */
console.log('\nfollow.js: the offer after a follow');
function loadFollow(o = {}) {
  const store = memStore();
  const tok = signIn(store);
  const offers = [], scripts = [], requests = [];
  const favs = o.favs || [];
  const document = {
    querySelectorAll: () => [],
    querySelector: sel => (sel.includes('follow.js') ? { getAttribute: () => '../follow.js?v=254' } : null),
    createElement: () => { const s = { listeners: {}, addEventListener(t, fn) { s.listeners[t] = fn; } }; return s; },
    head: { appendChild: s => scripts.push(s) }
  };
  const ctx = {
    console, localStorage: store, document, Date, JSON, setTimeout,
    EPINOIA_CONFIG: { supabaseUrl: 'https://' + REF + '.supabase.co', supabaseAnonKey: 'sb_publishable_test' },
    fetch: async (url, init = {}) => {
      requests.push({ url, init });
      if (url.includes('/rest/v1/fan_prefs?')) return { ok: true, status: 200, json: async () => [{ fav_game_ids: [], fav_team_ids: favs, fav_player_ids: [] }] };
      const st = o.saveStatus || 200;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
    }
  };
  ctx.window = ctx;
  if (!o.lazy) ctx.EpinoiaPush = { offer: async a => { offers.push(a); return { shown: true }; } };
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'follow.js'), ctx, { filename: 'follow.js' });
  return { F: ctx.EpinoiaFollow, ctx, offers, scripts, requests, tok };
}
const settle = () => new Promise(r => setTimeout(r, 0));
{
  let f = loadFollow();
  await f.F.toggle('team', 'T1', 'Reading Rockets'); await settle();
  eq('a follow that saved offers notifications about it, by name', f.offers, [{ name: 'Reading Rockets', kind: 'team' }]);
  await f.F.toggle('team', 'T1', 'Reading Rockets'); await settle();
  ok('an unfollow offers nothing', f.offers.length === 1);

  f = loadFollow();
  await f.F.toggle('player', 'P1'); await settle();
  eq('no name given: "this player"', f.offers, [{ name: 'this player', kind: 'player' }]);

  f = loadFollow({ saveStatus: 500 });
  await f.F.toggle('game', 'G1', 'Rockets v Lions'); await settle();
  ok('a follow that did not save offers nothing (and is put back)', f.offers.length === 0 && !f.F.has('game', 'G1'));

  f = loadFollow({ lazy: true });
  await f.F.toggle('team', 'T2', 'London Lions'); await settle();
  ok('push.js is loaded beside follow.js, with its version stamp', f.scripts.length === 1 && f.scripts[0].src === '../push.js?v=254', f.scripts[0] && f.scripts[0].src);
  const got = [];
  f.ctx.EpinoiaPush = { offer: async a => { got.push(a); } };
  f.scripts[0].listeners.load(); await settle();
  eq('...and asked for the offer once it has arrived', got, [{ name: 'London Lions', kind: 'team' }]);
  await f.F.toggle('team', 'T3', 'Leeds Force'); await settle();
  ok('...only once: the next follow uses the loaded module', f.scripts.length === 1 && got.length === 2);
}

/* ============================================================= wiring === */
console.log('\nwired into the pages');
{
  const nav = read('epinoia', 'nav.js');
  ok('nav.js registers the same worker push.js does: root + sw.js, scope root, no query string',
     /navigator\.serviceWorker\.register\(root \+ 'sw\.js', \{ scope: root \}\)/.test(nav) && P.SW_URL === '/epinoia/sw.js' && P.SCOPE === '/epinoia/');
  ok('the bell links a notification by root + link, so &show=starters survives', /a\.href = root \+ \(x\.link \|\| 'me\/'\)/.test(nav));

  const page = read('epinoia', 'me', 'index.html');
  const me = read('epinoia', 'me', 'me.js');
  ok('the profile page loads push.js, stamped, before me.js', /src="\.\.\/push\.js\?v=\d+"/.test(page) && page.indexOf('push.js?v=') < page.indexOf('src="me.js?v='));
  ok('...has the This phone card and its three buttons', ['id="phoneCard"', 'id="pushOn"', 'id="pushTest"', 'id="pushOff"'].every(s => page.includes(s)));
  const switches = ['wFixtures', 'wFix2d', 'wFix2h', 'wLineups', 'wHalftime', 'wResults', 'wPlayers', 'wPlayerGames', 'wAnn'];
  ok('...a switch for every moment in §1', switches.every(id => new RegExp('role="switch" class="sw" id="' + id + '"').test(page)));
  ok('...and keeps the three channels', ['id="nInapp"', 'id="nEmail"', 'id="nPush"'].every(s => page.includes(s)));
  ok('me.js saves the five new keys through collect()',
     ['want_fixture_2d', 'want_fixture_2h', 'want_lineups', 'want_player_games', 'want_halftime'].every(k => new RegExp(k + ': \\$\\(').test(me)));
  ok('...reads want_halftime back, on by default, and saves when it changes',
     /\$\('#wHalftime'\)\.checked = prefs\.want_halftime !== false/.test(me) && /'#wHalftime'\]\.forEach/.test(me));
  ok('the card has Check this phone and a place for its findings', page.includes('id="pushCheck"') && page.includes('id="phoneCheck"'));
  ok('...wired to push.js check(), drawn as each step lands, with text nodes only',
     /\$\('#pushCheck'\)\.onclick = \(\) => phoneAction\(/.test(me) && /P\.check\(steps => paintCheck/.test(me) &&
     /function paintCheck/.test(me) && !/innerHTML/.test(me.slice(me.indexOf('function paintCheck'), me.indexOf('function phoneAction'))));
  ok('...shown wherever the browser can take notifications, blocked included',
     /pushCheck: !!P && st !== 'unsupported' && st !== 'ios-install'/.test(me));
  ok('...and no longer subscribes by itself (push.js does)', !/enablePush|disablePush|serviceWorker\.register|pushManager/.test(me));

  /* the Android app on the profile page (roadmap Phase 7 and 8) */
  ok('the card has Open notification settings and the locked-phone test, both hidden until me.js shows them',
     /<a class="ep-btn hide" id="pushSettings"/.test(page) && /<button class="ep-btn hide" id="pushTestLocked"/.test(page));
  ok('...shown only in the app, the settings link taken from push.js',
     /pushSettings: app,/.test(me) && /pushTestLocked: app && st === 'on'/.test(me) && /\$\('#pushSettings'\)\.href = P\.settingsIntent/.test(me));
  ok('...the locked-phone test asks for a 10 s delay and ends on "did it pop up?"',
     /P\.test\(\{ delay: 10 \}\)/.test(me) && /pending\.then\(r => \{ if \(r && r\.ok\) askSeen\(\); \}\)/.test(me));
  ok('...the check\'s advice and "your phone is hiding it" draw the settings action when push.js gives one',
     /if \(r\.advice\.action\)/.test(me) && /if \(h\.action\) acts\.append\(settingsLink\(h\.action\)\)/.test(me));
  ok('the install button never shows in the app', /installBtn: !app && !standaloneApp\(\)/.test(me));
  ok('...on an Android browser it offers the Android app (nav.js\'s own decision), labelled so, and goes to ../android/',
     /const offerApp = !app && androidAppOffer\(\);/.test(me) && /S\.installOffer\(\{/.test(me) && /=== 'android-app'/.test(me) &&
     /installBtn: !app && !standaloneApp\(\) && \(offerApp \? st !== 'on'/.test(me) &&
     /android: 'Get the EPINOIΛ app for Android'/.test(me) && /\$\('#installBtn'\)\.textContent = offerApp \? INSTALL_WORDS\.android : INSTALL_WORDS\.web/.test(me) &&
     /if \(androidAppOffer\(\)\) \{ location\.href = '\.\.\/android\/'; return; \}/.test(me));
  ok('the other sign-ups: only in the app with this phone on, the fan\'s own rows, deleted by id',
     /if \(st !== 'on' \|\| !sb\) \{ box\.classList\.add\('hide'\); return; \}\r?\n\s*const others = await otherSignups\(\);/.test(me) &&
     /\.from\('push_subscriptions'\)\.delete\(\)\.in\('id', others\.map\(r => r\.id\)\)/.test(me) &&
     /r\.client === 'samsung-app'/.test(me) && page.includes('id="phoneDupes"'));
  ok('...read again without client before 0128', /select\('id,endpoint,client,ua'\);\s*if \(res\.error\) res = await sb\.from\('push_subscriptions'\)\.select\('id,endpoint,ua'\)/.test(me));
  {
    /* the filter itself, run on rows */
    const src = me.slice(me.indexOf('function endpointHost'), me.indexOf('/* THE OTHER SIDE OF IT'));
    const MINE = 'https://fcm.googleapis.com/fcm/send/app';
    const rows = [
      { id: 'self', endpoint: MINE, client: 'twa', ua: UA.android },
      { id: 'sam-app', endpoint: 'https://fcm.googleapis.com/fcm/send/1', client: 'samsung-app', ua: UA.samsung },
      { id: 'sam-tab', endpoint: 'https://fcm.googleapis.com/fcm/send/2', client: 'tab', ua: UA.samsung },
      { id: 'old-android', endpoint: 'https://fcm.googleapis.com/fcm/send/3', client: null, ua: UA.android },
      { id: 'chrome-tab', endpoint: 'https://fcm.googleapis.com/fcm/send/4', client: 'tab', ua: UA.android },
      { id: 'other-app', endpoint: 'https://fcm.googleapis.com/fcm/send/5', client: 'twa', ua: UA.android },
      { id: 'desktop', endpoint: 'https://fcm.googleapis.com/fcm/send/6', client: null, ua: UA.chrome },
      { id: 'firefox', endpoint: 'https://updates.push.services.mozilla.com/x', client: null, ua: UA.android }
    ];
    const ctx = vm.createContext({ URL, window: { EpinoiaPush: { endpoint: async () => MINE } },
      sb: { from: () => ({ select: async () => ({ data: rows, error: null }) }) } });
    vm.runInContext(src + '\nthis.otherSignups = otherSignups;', ctx);
    eq('the others offered: Samsung Internet rows however labelled and unlabelled Android rows on the same service; never this app, another app, a Chrome tab, a computer or another service',
       (await ctx.otherSignups()).map(r => r.id), ['sam-app', 'sam-tab', 'old-android']);
  }
  ok('in Samsung Internet, once the account has the app: no sync, and a button that unsubscribes this browser',
     /\.select\('client'\)\)/.test(me) && /r\.client === 'twa'/.test(me) && /if \(await accountHasApp\(\)\.catch\(\(\) => false\)\) return;\r?\n\s*window\.EpinoiaPush\.sync\(\)/.test(me) &&
     /\/\^android-samsung\/\.test\(window\.EpinoiaPush\.help\(\)\.platform\)/.test(me) &&
     /phoneAction\(off, 'Turning off…', \(\) => window\.EpinoiaPush\.disable\(\)\)/.test(me));
  ok('the card in the app says when Android blocks pop-ups, from push.js appBlocked',
     /const blocked = app && P && P\.appBlocked \? P\.appBlocked\(\) : null;/.test(me) && /as of this launch/.test(me));
  ok('the settings links (the card\'s and the advice\'s) and the follow sheet\'s tell push.js they were opened',
     /\$\('#pushSettings'\)\.addEventListener\('click', settingsTapped\)/.test(me) && /a\.addEventListener\('click', settingsTapped\)/.test(me) &&
     /EpinoiaPush\.settingsOpened\(\)/.test(me) && /a\.addEventListener\('click', settingsOpened\)/.test(read('epinoia', 'push.js')));
  const body = page.slice(page.indexOf('<div id="body"'), page.indexOf('<script src="../config.js'));
  ok('Delete my account links to the privacy page\'s erasure form, inside the signed-in body',
     /<a id="deleteAccount" href="\.\.\/privacy\/#delete"[^>]*>Delete my account<\/a>/.test(body));

  const Pv = require(path.join(ROOT, 'epinoia', 'game', 'preview.js'));
  const five = pre => [1, 2, 3, 4, 5].map(i => ({ id: pre + i, name: pre + i + ' Player', num: String(i) }));
  const ctx = { nameA: 'A', nameB: 'B', colourA: '#93f2bf', colourB: '#8ff5ff', startersA: five('a'), startersB: five('b'), tipoff: '2026-09-19T18:30:00Z' };
  ok('preview.js exports startersHTML', typeof Pv.startersHTML === 'function');
  ok('...whose section is id="starters", where the lineups link lands', /<section class="pv-sec" id="starters">/.test(Pv.startersHTML(ctx)));
  ok('...and the preview carries it', Pv.render(Object.assign({ competition: 'D1' }, ctx)).includes('id="starters"'));
  ok('on a game under way it says tipped off, not "tip-off is"', /Tipped off at/.test(Pv.startersHTML(Object.assign({ status: 'live' }, ctx))) &&
     /Tip-off is/.test(Pv.startersHTML(ctx)));
  eq('...and still draws nothing for an incomplete five', Pv.startersHTML(Object.assign({}, ctx, { startersB: five('b').slice(0, 4), status: 'final' })), '');

  const game = read('epinoia', 'game', 'game.js');
  ok('game.js reads show=starters', /get\('show'\) === 'starters'/.test(game));
  const previewFn = game.slice(game.indexOf('async function renderPreview'), game.indexOf('(async function boot()'));
  ok('...scrolls the preview to #starters', /revealStarters\(document\.getElementById\('starters'\)\)/.test(previewFn));
  ok('...and mounts the card from renderShell, above the tabs, with a close button',
     /shellBuilt = true;\s*mountStartersCard\(\);/.test(game) && /tabs\.parentNode\.insertBefore\(host, tabs\)/.test(game) && /className = 'pv-close'/.test(game));
  ok('...only for a live or final game, and only with both fives complete',
     /S\.status === 'scheduled'[\s\S]{0,200}return false/.test(game) && /five\[0\]\.length < 5 \|\| five\[1\]\.length < 5\) return false/.test(game));
  ok('...respecting reduced motion', /prefers-reduced-motion: reduce/.test(game) && /behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth'/.test(game));
  const gp = read('epinoia', 'game', 'index.html');
  ok('the game page loads preview.css, which styles the card', /href="preview\.css\?v=\d+"/.test(gp) && /\.pv-fives\{/.test(read('epinoia', 'game', 'preview.css')));
}

console.log('\nthe sheet points an Android browser at the app (nav.js EpinoiaAppPromo)');
{
  const promo = kind => ({ current: () => (kind ? { kind, href: 'android/' } : null), href: p => '../' + p.href });
  T.env({ EpinoiaAppPromo: promo('android') });
  eq('an Android browser with the app out: the app, at the rail\'s root', T.androidApp(), { href: '../android/' });
  T.env({ EpinoiaAppPromo: promo('ios') });
  eq('an iPhone: nothing (its sheet has the Home Screen steps)', T.androidApp(), null);
  T.env({ EpinoiaAppPromo: promo(null) });
  eq('no promo (desktop, in the app, not out yet): nothing', T.androidApp(), null);
  T.env({ EpinoiaAppPromo: undefined });
  eq('a page without nav.js (a league website\'s embed): nothing', T.androidApp(), null);
  T.env({ EpinoiaAppPromo: { current() { throw new Error('boom'); } } });
  eq('a broken promo: nothing, never a throw', T.androidApp(), null);
  T.env(null);
  const src = fs.readFileSync(path.join(ROOT, 'epinoia', 'push.js'), 'utf8');
  const fnBody = name => src.slice(src.indexOf('function ' + name + '('), src.indexOf('\n  }\n', src.indexOf('function ' + name + '(')));
  ok('the ask links the app when there is one', /const app = androidApp\(\);[\s\S]*Get the app[\s\S]*a\.href = app\.href/.test(fnBody('ask')));
  ok('"your phone is hiding it" offers the app as a way out', /const app = androidApp\(\);[\s\S]*'Get the EPINOIΛ app'[\s\S]*a\.href = app\.href/.test(fnBody('hidden')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
