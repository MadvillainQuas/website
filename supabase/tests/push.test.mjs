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
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
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
  if (!o.noSW) {
    navigator.serviceWorker = {
      register: async (url, opts) => { calls.register.push([url, opts]); if (o.registerThrows) throw new Error('SecurityError'); return reg; },
      getRegistration: async scope => { calls.getRegistration.push(scope); return o.registered === false ? undefined : reg; },
      ready: Promise.resolve(reg)
    };
  }
  const Notification = o.noNotification ? undefined : {
    get permission() { return permission; },
    requestPermission() { calls.perm++; permission = o.answer || permission; return Promise.resolve(permission); }
  };
  const fetch = async (url, init = {}) => {
    calls.fetch.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    const st = o.respond ? o.respond(url, init, calls.fetch.length) : 200;
    if (st === 'throw') throw new TypeError('Failed to fetch');
    return { status: st, ok: st >= 200 && st < 300, json: async () => (o.json ? o.json(url) : {}) };
  };
  const env = {
    navigator, Notification, PushManager: o.noPush ? undefined : function PushManager() {},
    localStorage: ls, fetch, AbortController: undefined,
    matchMedia: q => ({ matches: !!(o.displayStandalone && /standalone/.test(q)) }),
    EPINOIA_CONFIG: { supabaseUrl: 'https://' + REF + '.supabase.co', supabaseAnonKey: 'sb_publishable_test' },
    EPINOIA_VAPID: o.vapid === undefined ? CFG_VAPID : o.vapid,
    isSecureContext: !o.insecure, document: undefined, EpinoiaAccess: undefined
  };
  if (o.now) env.now = o.now;
  T.env(env);
  return { calls, ls, get sub() { return sub; }, makeSub };
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
  eq('...and the row: who, where, both keys, which browser', up.body,
     { user_id: 'u1', endpoint: 'https://push.example/ep1', p256dh: 'P256-ep1', auth: 'AUTH-ep1', ua: UA.android });
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
  eq('...saying {test: true}', b.calls.fetch[0].body, { test: true });
  eq('...with the apikey and the fan\'s token', [b.calls.fetch[0].headers.apikey, b.calls.fetch[0].headers.Authorization], ['sb_publishable_test', 'Bearer ' + tok]);
  eq('...and a sentence back', r, { ok: true, message: P.MESSAGES.testSent });

  b = android({ json: () => ({ sent: 0 }) }); signIn(b.ls);
  eq('it reached nobody: says what to do', await P.test(), { ok: false, message: P.MESSAGES.testNone });
  b = android({ respond: () => 401 }); signIn(b.ls);
  eq('401: sign in again', await P.test(), { ok: false, message: P.MESSAGES.expired });
  b = android({ respond: () => 500 }); signIn(b.ls);
  eq('500: try again later', await P.test(), { ok: false, message: P.MESSAGES.testFailed });
  b = android({ respond: () => 'throw' }); signIn(b.ls);
  eq('offline: check the connection', await P.test(), { ok: false, message: P.MESSAGES.testOffline });
  b = android();
  const r2 = await P.test();
  ok('signed out: nothing sent', !r2.ok && !b.calls.fetch.length && r2.message === P.MESSAGES.signedOut);
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
  ok('install, fetch, activate, push, notificationclick and pushsubscriptionchange are all handled',
     ['install', 'fetch', 'activate', 'push', 'notificationclick', 'pushsubscriptionchange'].every(t => typeof listeners[t] === 'function'));
  eq('the public URL, key and VAPID key are config.js\'s, character for character',
     [W.SUPABASE_URL, W.SUPABASE_KEY, W.VAPID_PUBLIC_KEY], [CFG_URL, CFG_KEY, CFG_VAPID]);
  ok('the icon and the badge are real files', fs.existsSync(path.join(ROOT, W.ICON.replace(/^\//, ''))) && fs.existsSync(path.join(ROOT, W.BADGE.replace(/^\//, ''))),
     W.ICON + ' ' + W.BADGE);
  eq('icon 192, badge 32', [W.ICON, W.BADGE], ['/epinoia/brand/epinoia-mark-192.png', '/epinoia/brand/epinoia-mark-32.png']);
  ok('it carries a version line, so a deploy is a new worker', /SW_VERSION = 'notifications-v2-/.test(swSrc));
  let responded = null;
  listeners.fetch({ request: { method: 'POST' }, respondWith: p => { responded = p; } });
  ok('fetch: a POST is not touched', responded === null);
  ok('fetch: a GET is still passed straight through (never cached)', /e\.respondWith\(fetch\(e\.request\)\.catch/.test(swSrc) && !/caches\./.test(swSrc));
}
{
  const { W } = loadSW();
  const G = '52bfe03b-d70e-4924-97c1-5f02c15cdf4e';
  const url = ORIGIN + '/epinoia/game/?g=' + G + '&mode=supabase&show=starters';
  const n = W.notificationFor({ title: 'Lineups are in: Rockets v Lions', body: 'Rockets: Baker, Salih, Cole, Diaz, Eze\nLions: …', url,
    tag: 'lineups:' + G, renotify: true, kind: 'lineups', timestamp: 1758301500000, actions: [{ action: 'starters', title: 'See lineups' }] });
  eq('a lineups payload becomes the notification the contract describes', JSON.parse(JSON.stringify(n)), {
    title: 'Lineups are in: Rockets v Lions',
    options: { body: 'Rockets: Baker, Salih, Cole, Diaz, Eze\nLions: …', icon: '/epinoia/brand/epinoia-mark-192.png', badge: '/epinoia/brand/epinoia-mark-32.png',
      vibrate: [80, 40, 80], data: { url, kind: 'lineups', actions: { starters: url } },
      tag: 'lineups:' + G, renotify: true, timestamp: 1758301500000, actions: [{ action: 'starters', title: 'See lineups' }] } });

  const bare = W.notificationFor({ title: 'x', renotify: true });
  ok('renotify without a tag is dropped (showNotification would throw)', !('renotify' in bare.options) && !('tag' in bare.options));
  const three = W.notificationFor({ tag: 't', actions: [{ action: 'a', title: 'A' }, { action: 'b', title: 'B' }, { action: 'c', title: 'C' }, { action: '', title: 'bad' }] });
  eq('at most two actions', JSON.parse(JSON.stringify(three.options.actions)).map(a => a.action), ['a', 'b']);
  const empty = W.notificationFor(null);
  eq('nothing at all still shows something', [empty.title, empty.options.body, empty.options.data.url], ['Epinoia', '', '/epinoia/']);
  ok('a bad timestamp is left out rather than passed through', !('timestamp' in W.notificationFor({ timestamp: 'soon' }).options));

  eq('"See lineups" on a link that lacks show=starters gains it', W.actionUrl('lineups', 'starters', ORIGIN + '/epinoia/game/?g=1'), ORIGIN + '/epinoia/game/?g=1&show=starters');
  eq('...before a fragment, and with ? when there is no query', W.actionUrl('lineups', 'starters', '/epinoia/game/#top'), '/epinoia/game/?show=starters#top');
  eq('...and is left alone when it already has it', W.actionUrl('lineups', 'starters', url), url);
  eq('"Box score" on a result opens the result\'s page on the box score tab (a final game otherwise opens on its report)',
     W.actionUrl('result', 'box', ORIGIN + '/epinoia/game/?g=1'), ORIGIN + '/epinoia/game/?g=1&tab=box');
  eq('...and a link that already names a tab is left alone', W.actionUrl('result', 'box', ORIGIN + '/epinoia/game/?g=1&tab=pbp'), ORIGIN + '/epinoia/game/?g=1&tab=pbp');

  eq('a text payload (not JSON) is shown as the body', W.readPayload({ json: () => { throw new SyntaxError('x'); }, text: () => 'plain words' }), { title: 'Epinoia', body: 'plain words' });

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
}
{
  const { W } = loadSW();
  const data = { url: ORIGIN + '/epinoia/game/?g=1', actions: { starters: ORIGIN + '/epinoia/game/?g=1&show=starters' } };
  eq('a tap on a button opens the button\'s page', W.clickTarget(data, 'starters', ORIGIN), ORIGIN + '/epinoia/game/?g=1&show=starters');
  eq('a tap on the notice opens the notice\'s page', W.clickTarget(data, '', ORIGIN), ORIGIN + '/epinoia/game/?g=1');
  eq('an action it does not know opens the notice\'s page', W.clickTarget(data, 'mystery', ORIGIN), ORIGIN + '/epinoia/game/?g=1');
  eq('a relative link resolves under /epinoia/', W.clickTarget({ url: 'game/?g=2' }, '', ORIGIN), ORIGIN + '/epinoia/game/?g=2');
  eq('no data: the front page', W.clickTarget(undefined, '', ORIGIN), ORIGIN + '/epinoia/');
  eq('a javascript: link goes nowhere but home', W.clickTarget({ url: 'javascript:alert(1)' }, '', ORIGIN), ORIGIN + '/epinoia/');

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
  const switches = ['wFixtures', 'wFix2d', 'wFix2h', 'wLineups', 'wResults', 'wPlayers', 'wPlayerGames', 'wAnn'];
  ok('...a switch for every moment in §1', switches.every(id => new RegExp('role="switch" class="sw" id="' + id + '"').test(page)));
  ok('...and keeps the three channels', ['id="nInapp"', 'id="nEmail"', 'id="nPush"'].every(s => page.includes(s)));
  ok('me.js saves the four new keys through collect()',
     ['want_fixture_2d', 'want_fixture_2h', 'want_lineups', 'want_player_games'].every(k => new RegExp(k + ': \\$\\(').test(me)));
  ok('...and no longer subscribes by itself (push.js does)', !/enablePush|disablePush|serviceWorker\.register|pushManager/.test(me));

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
