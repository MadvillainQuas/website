/* ============================================================================
   Notification buttons on a league's own website (docs/notify-embed.md):
   epinoia/embed/notify/notify.js (the button), page.js (Epinoia's window),
   sw.js (the worker a league's site imports), embed.js's notify kind, and the
   console's snippet maker. No network and no browser: each file runs against a
   stubbed one.

   What fails quietly here, and is pinned:
     * a button that asks for permission after an await (Safari and Firefox then
       refuse), or registers the site's worker at the site's root scope, taking over
       a service worker the site already has;
     * the window's "Following" message believed from any origin, or sent to any
       origin;
     * the imported worker intercepting the site's own requests, or showing a link or
       an icon that is not https;
     * the public URL, key or VAPID key drifting from config.js in any of the copies;
     * embed.js loading the button's script once per snippet, or the snippet maker
       writing an attribute the button does not read;
     * a function the button calls that the migration does not define.
   Run: node supabase/tests/notify-embed.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const configSrc = read('epinoia', 'config.js');
const CFG_URL = (/supabaseUrl:\s*'([^']+)'/.exec(configSrc) || [])[1];
const CFG_KEY = (/supabaseAnonKey:\s*'([^']+)'/.exec(configSrc) || [])[1];
const CFG_VAPID = (/window\.EPINOIA_VAPID\s*=\s*'([^']+)'/.exec(configSrc) || [])[1];

/* ------------------------------------------------------------ a fake page --- */
class Ev { constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); this.target = null; Object.assign(this, init || {}); } }
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false;
    this.checked = false; this.value = ''; this.type = ''; this.id = ''; this._html = '';
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: k => props[k], cssText: '' };
  }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      contains: c => list().includes(c),
      add: c => { if (!list().includes(c)) self.className = list().concat(c).join(' '); },
      remove: c => { self.className = list().filter(x => x !== c).join(' '); },
      toggle: (c, on) => { const has = list().includes(c); const want = on === undefined ? !has : !!on;
        if (want && !has) self.className = list().concat(c).join(' '); if (!want && has) self.className = list().filter(x => x !== c).join(' '); return want; }
    };
  }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n);
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(ev) { if (!ev.target) ev.target = this; let n = this; while (n) { (n.listeners[ev.type] || []).slice().forEach(fn => fn(ev)); n = ev.bubbles ? n.parentNode : null; } return true; }
  click() { this.dispatchEvent(new Ev('click', { bubbles: true })); }
  attachShadow() { const s = new El('#shadow', this.ownerDocument); s.host = this; this.shadow = s; return s; }
  matches(sel) {
    const m = /^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/i.exec(sel.trim());
    if (!m) throw new Error('fake DOM cannot match ' + sel);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !m[2].split('.').filter(Boolean).every(c => this.classList.contains(c))) return false;
    if (m[3] && !(m[3] in this.attrs)) return false;
    return true;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { if (c.matches(sel)) out.push(c); walk(c); if (c.shadow) walk(c.shadow); } });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function fakeDocument() {
  const doc = { currentScript: null };
  doc.createElement = t => new El(t, doc);
  doc.createTextNode = t => new Text(t);
  doc.head = new El('head', doc);
  doc.body = new El('body', doc);
  doc.documentElement = new El('html', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.getElementById = id => {
    let hit = null;
    const walk = n => (n.children || []).forEach(c => { if (hit || !(c instanceof El)) return; if (c.id === id) hit = c; else walk(c); });
    walk(doc.documentElement);
    return hit;
  };
  return doc;
}
const walkText = n => n.textContent.replace(/\s+/g, ' ').trim();

/* ================================================================ sw.js === */
console.log('\nthe worker a league\'s site imports (embed/notify/sw.js)');
const swSrc = read('epinoia', 'embed', 'notify', 'sw.js');
function loadEmbedSW(st = {}) {
  const listeners = {};
  const calls = { show: [], open: [], fetch: [], focus: 0, posted: [] };
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => {},
    location: { origin: 'https://club.example' },
    registration: {
      showNotification: async (title, options) => { calls.show.push([title, options]); },
      pushManager: { subscribe: async () => st.newSub || null }
    },
    clients: {
      claim: async () => {},
      matchAll: async () => st.clients || [],
      openWindow: async url => { calls.open.push(url); return { url }; }
    }
  };
  const module = { exports: {} };
  const ctx = vm.createContext({
    self, module, URL, atob, console, setTimeout,
    fetch: async (url, init) => { calls.fetch.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; }
  });
  vm.runInContext(swSrc, ctx, { filename: 'embed-sw.js' });
  return { W: module.exports, listeners, calls };
}
const fire = async (fn, ev) => { const waits = []; ev.waitUntil = p => waits.push(p); fn(ev); await Promise.all(waits); };
{
  const { W, listeners, calls } = loadEmbedSW({ clients: [{ url: 'https://club.example/fixtures', postMessage: m => calls.posted.push(m) }] });
  eq('the public URL, key and VAPID key are config.js\'s', [W.EMBED_SUPABASE_URL, W.EMBED_SUPABASE_KEY, W.EMBED_VAPID_PUBLIC_KEY], [CFG_URL, CFG_KEY, CFG_VAPID]);
  ok('a guest on the site\'s domain: push, click, rotation, ping — and no fetch handler, no cache',
     ['install', 'activate', 'push', 'notificationclick', 'pushsubscriptionchange', 'message'].every(t => typeof listeners[t] === 'function') &&
     !listeners.fetch && !/caches\./.test(swSrc) && !/localStorage|indexedDB/.test(swSrc));
  ok('its default icon and badge are Epinoia\'s, absolute, and real files',
     W.EMBED_ICON === 'https://prophesyscouting.co.uk/epinoia/brand/epinoia-mark-192.png' && fs.existsSync(path.join(ROOT, 'epinoia', 'brand', 'epinoia-mark-32.png')));

  await fire(listeners.push, { data: { json: () => ({ title: 'FT · Lions 90–80 Eagles', body: 'Trophy', url: 'https://club.example/match/1', icon: 'https://x.test/crest.png',
                                                      tag: 'result:1', renotify: true, kind: 'result' }) } });
  const [title, opts] = calls.show[0];
  eq('a push shows the title, the league\'s crest, Epinoia\'s badge and the slot', [title, opts.icon, opts.badge, opts.tag, opts.renotify, opts.data.url],
     ['FT · Lions 90–80 Eagles', 'https://x.test/crest.png', W.EMBED_BADGE, 'result:1', true, 'https://club.example/match/1']);
  eq('...and every open page of the site hears it arrived', calls.posted.map(m => [m.type, m.tag, m.shown]), [['epinoia-push', 'result:1', true]]);
  const bad = W.embedNotificationFor({ title: 'x', url: 'javascript:alert(1)', icon: 'http://x.test/c.png' });
  eq('a link or an icon that is not https is never used', [bad.options.data.url, bad.options.icon], ['', W.EMBED_ICON]);

  await fire(listeners.notificationclick, { notification: { close: () => {}, data: { url: 'https://club.example/match/1' } } });
  eq('a tap opens the notice\'s page', calls.open, ['https://club.example/match/1']);
  await fire(listeners.notificationclick, { notification: { close: () => {}, data: { url: 'javascript:alert(1)' } } });
  eq('...and a notice without a safe link opens the site\'s front page', calls.open[1], 'https://club.example/');

  const newSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }) };
  await fire(listeners.pushsubscriptionchange, { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old' }, newSubscription: newSub });
  eq('a rotated subscription is swapped by its old endpoint, with the publishable key', [calls.fetch[0].url, calls.fetch[0].init.headers.apikey, calls.fetch[0].body],
     [CFG_URL + '/rest/v1/rpc/swap_push_subscription', CFG_KEY, { p_old: 'https://fcm.googleapis.com/fcm/send/old', p_endpoint: 'https://fcm.googleapis.com/fcm/send/new', p_p256dh: 'P', p_auth: 'A' }]);
  const replies = [];
  listeners.message({ data: { type: 'epinoia-ping', id: 'x' }, ports: [{ postMessage: m => replies.push(m) }] });
  eq('a ping is answered with the version', replies, [{ type: 'epinoia-pong', version: W.EMBED_SW_VERSION, id: 'x' }]);
}

/* ============================================================ notify.js === */
console.log('\nthe button (embed/notify/notify.js)');
const NB = require(path.join(ROOT, 'epinoia', 'embed', 'notify', 'notify.js'));
const T = NB._test;
eq('its public URL, key and VAPID key are config.js\'s', [T.SUPABASE_URL, T.SUPABASE_KEY, T.VAPID_PUBLIC_KEY], [CFG_URL, CFG_KEY, CFG_VAPID]);
{
  const el = d => ({ dataset: d });
  const TEAM = '2b30f3ae-e3e5-4d2c-80db-b9b983441aa8';
  eq('a club by slug', [T.optionsFrom(el({ league: 'slb-men', team: 'London-Lions' })).kind, T.optionsFrom(el({ league: 'slb-men', team: 'London-Lions' })).ref], ['team', 'london-lions']);
  eq('a club by id', T.optionsFrom(el({ league: 'slb-men', team: TEAM.toUpperCase() })).ref, TEAM);
  eq('a game only by id', [T.optionsFrom(el({ league: 'slb-men', game: 'not-an-id' })).kind, T.optionsFrom(el({ league: 'slb-men', game: TEAM })).kind], ['league', 'game']);
  eq('a player beats a club when a snippet names both', T.optionsFrom(el({ league: 'x', team: 'a', player: 'b' })).kind, 'player');
  eq('an accent must be #rrggbb', [T.optionsFrom(el({ league: 'x', accent: '#A1B2C3' })).accent, T.optionsFrom(el({ league: 'x', accent: 'red;x:y' })).accent], ['#a1b2c3', '']);
  eq('the site\'s worker must be a .js path on the site itself',
     ['/epinoia-sw.js', '//evil.example/x.js', 'https://evil.example/x.js', '/a/../b.js', '/x.php'].map(s => T.optionsFrom(el({ league: 'x', sw: s })).sw),
     ['/epinoia-sw.js', '', '', '', '']);
  eq('a league slug is required', T.optionsFrom(el({ league: 'Bad League!' })).league, '');
  eq('the window\'s address names the league, the thing and the site to report back to',
     T.windowUrl({ league: 'slb-men' }, { kind: 'team', id: TEAM }, 'https://club.example'),
     'https://prophesyscouting.co.uk/epinoia/embed/notify/?l=slb-men&team=' + TEAM + '&from=https%3A%2F%2Fclub.example');
  ok('...and never a site that is not an https origin', !/from=/.test(T.windowUrl({ league: 'x' }, { kind: 'league' }, 'http://club.example')));
}

/* a browser for the button: the page, the network, and (optionally) push */
function buttonBrowser(o = {}) {
  const doc = fakeDocument();
  const calls = { fetch: [], open: [], perm: 0, register: [], subscribe: [], storage: {}, permAt: [] };
  const win = new El('window', doc);
  win.open = (url, name, feats) => { calls.open.push(url); return o.popupBlocked ? null : {}; };
  let permission = o.permission || 'default';
  let sub = o.sub || null;
  const reg = { active: {}, pushManager: {
    getSubscription: async () => sub,
    subscribe: async opts => { calls.subscribe.push(opts); sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/site', toJSON: () => ({ keys: { p256dh: 'PKEY', auth: 'AKEY' } }) }; return sub; }
  } };
  const env = {
    document: doc, window: win, location: { origin: o.origin || 'https://club.example' },
    localStorage: { getItem: k => (k in calls.storage ? calls.storage[k] : null), setItem: (k, v) => { calls.storage[k] = String(v); }, removeItem: k => { delete calls.storage[k]; } },
    atob, isSecureContext: true,
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.fetch.push({ url, method: init.method || 'GET', body });
      const r = o.respond ? o.respond(url, body) : null;
      return { ok: !(r && r.status >= 400), status: (r && r.status) || 200, json: async () => (r ? r.json : null) };
    }
  };
  if (!o.noPush) {
    env.PushManager = function () {};
    env.Notification = { get permission() { return permission; },
      requestPermission() { calls.perm++; calls.permAt.push(calls.fetch.length); permission = o.answer || 'granted'; return Promise.resolve(permission); } };
    env.navigator = { serviceWorker: {
      register: async (url, opts) => { calls.register.push([url, opts]); return reg; },
      getRegistration: async scope => (o.registered ? reg : undefined)
    } };
  } else {
    env.navigator = {};
  }
  T.env(env);
  return { doc, win, calls, setSub: s => { sub = s; } };
}
const LEAGUE = { id: 'lg-1', slug: 'slb-men', name: 'Super League Basketball Men', logo_path: null };
const LIONS = { id: '11111111-2222-3333-4444-555555555555', name: 'London Lions' };
const answers = (over = {}) => (url, body) => {
  if (/rpc\/notify_embed_public$/.test(url)) return { json: { league: LEAGUE, site: !!over.site, epinoia: false } };
  if (/rest\/v1\/teams\?select=id,name&league_id=eq\.lg-1&slug=eq\.london-lions/.test(url)) return { json: [LIONS] };
  if (/rest\/v1\/teams\?select=id,name&league_id=eq\.lg-1&order=name/.test(url)) return { json: [LIONS, { id: '99999999-2222-3333-4444-555555555555', name: 'Newcastle Eagles' }] };
  if (/rpc\/notify_device_get$/.test(url)) return { json: over.state || null };
  if (/rpc\/notify_device_follow$/.test(url)) return { json: over.follow ? over.follow(body) : { device: true, teams: [LIONS], players: [], games: [] } };
  if (/rpc\/notify_device_test$/.test(url)) return { json: true };
  return { json: null };
};
function plant(doc, data) {
  const s = new El('script', doc);
  Object.assign(s.dataset, data);
  doc.body.appendChild(s);
  return s;
}
const labelOf = b => walkText(b.main);

{
  /* through Epinoia: the window */
  const B = buttonBrowser({ respond: answers() });
  const s = plant(B.doc, { league: 'slb-men', team: 'london-lions' });
  const b = NB.mount(s);
  await b.ready;
  ok('the button goes right after its snippet, in a closed shadow root', s.nextSibling === b.el && !!b.el.shadow);
  eq('it names the club it follows', [labelOf(b), b.main.getAttribute('aria-label'), b.main.getAttribute('aria-pressed')],
     ['Get notifications', 'Get notifications for London Lions', 'false']);
  eq('...found by the club\'s slug within the league', B.calls.fetch.map(f => f.url.replace(CFG_URL, '')).slice(0, 2),
     ['/rest/v1/rpc/notify_embed_public', '/rest/v1/teams?select=id,name&league_id=eq.lg-1&slug=eq.london-lions&limit=1']);
  eq('without a worker on the site, it is window mode', b.state.mode, 'window');
  b.main.click();
  eq('a tap opens Epinoia\'s window for that club', B.calls.open, [T.windowUrl({ league: 'slb-men' }, { kind: 'team', id: LIONS.id }, 'https://club.example')]);
  B.win.dispatchEvent(new Ev('message', { origin: 'https://evil.example', data: { type: 'epinoia-notify', league: 'slb-men', kind: 'team', id: LIONS.id, following: true } }));
  eq('a "following" message from any other origin is ignored', labelOf(b), 'Get notifications');
  B.win.dispatchEvent(new Ev('message', { origin: 'https://prophesyscouting.co.uk', data: { type: 'epinoia-notify', league: 'slb-men', kind: 'team', id: 'someone-else', following: true } }));
  eq('...and so is one about another club', labelOf(b), 'Get notifications');
  B.win.dispatchEvent(new Ev('message', { origin: 'https://prophesyscouting.co.uk', data: { type: 'epinoia-notify', league: 'slb-men', kind: 'team', id: LIONS.id, following: true } }));
  eq('Epinoia\'s window saying so turns it to Following, and remembers', [labelOf(b), b.main.getAttribute('aria-pressed'), B.calls.storage['epinoia-notify:slb-men:team:' + LIONS.id]],
     ['Following', 'true', '1']);
  const again = NB.mount(plant(B.doc, { league: 'slb-men', team: 'london-lions' }));
  await again.ready;
  eq('...so the button says Following on the next page load', labelOf(again), 'Following');
  ok('no notification permission is asked for on the site in window mode', B.calls.perm === 0 && B.calls.register.length === 0);

  const blocked = buttonBrowser({ respond: answers(), popupBlocked: true });
  const bb = NB.mount(plant(blocked.doc, { league: 'slb-men', team: 'london-lions' }));
  await bb.ready;
  bb.main.click();
  ok('a blocked pop-up says how to fix it', /Allow pop-ups/.test(walkText(bb.msg)) && !bb.msg.hidden);
}

{
  /* on the site's own domain */
  const B = buttonBrowser({ respond: answers({ site: true }) });
  const s = plant(B.doc, { league: 'slb-men', team: 'london-lions', sw: '/epinoia-sw.js', theme: 'light', accent: '#ffcc00' });
  const b = NB.mount(s);
  await b.ready;
  eq('a site set up with its worker file is site mode', b.state.mode, 'site');
  ok('light theme and the accent are applied, with a readable colour on it',
     b.el.shadow.querySelector('div').classList.contains('light') && T.onColour('#ffcc00') === '#04100b' && T.onColour('#0c3b7a') === '#ffffff');
  const before = B.calls.fetch.length;
  b.main.click();
  ok('the permission is asked inside the tap, before any request', B.calls.perm === 1 && B.calls.permAt[0] === before);
  await tick(5); await tick(5);
  eq('the site\'s own worker file is registered under /epinoia-push/, never the root', B.calls.register, [['/epinoia-sw.js', { scope: '/epinoia-push/' }]]);
  ok('...subscribed with Epinoia\'s VAPID key', B.calls.subscribe.length === 1 && Buffer.from(B.calls.subscribe[0].applicationServerKey).equals(Buffer.from(CFG_VAPID, 'base64url')));
  const follow = B.calls.fetch.find(f => /notify_device_follow$/.test(f.url));
  eq('...and saved as a device following that one club', follow && follow.body,
     { p_league: 'slb-men', p_endpoint: 'https://fcm.googleapis.com/fcm/send/site', p_p256dh: 'PKEY', p_auth: 'AKEY', p_add: { teams: [LIONS.id] }, p_remove: {}, p_prefs: {} });
  eq('it says Following', labelOf(b), 'Following');
  b.main.click();
  ok('tapped again: stop and test', !b.menu.hidden);
  b.test.click();
  await tick(5);
  ok('"Send a test" writes one and asks for it to be delivered now',
     B.calls.fetch.some(f => /notify_device_test$/.test(f.url) && f.body.p_auth === 'AKEY') && B.calls.fetch.some(f => /functions\/v1\/notify$/.test(f.url)));
  b.stop.click();
  await tick(5);
  const stop = B.calls.fetch.filter(f => /notify_device_follow$/.test(f.url)).pop();
  eq('"Stop" removes that club', stop.body.p_remove, { teams: [LIONS.id] });
}
{
  const B = buttonBrowser({ respond: answers({ site: false }) });
  const b = NB.mount(plant(B.doc, { league: 'slb-men', team: 'london-lions', sw: '/epinoia-sw.js' }));
  await b.ready;
  eq('a worker file on a site the league has not set up falls back to the window', b.state.mode, 'window');
  const D = buttonBrowser({ respond: answers({ site: true }), answer: 'denied' });
  const d = NB.mount(plant(D.doc, { league: 'slb-men', team: 'london-lions', sw: '/epinoia-sw.js' }));
  await d.ready;
  d.main.click();
  await tick(5);
  ok('permission refused: says notifications are blocked, registers nothing', /blocked/.test(walkText(d.msg)) && D.calls.register.length === 0);
  const R = buttonBrowser({ respond: answers({ site: true, state: { device: true, teams: [LIONS], players: [], games: [] } }), registered: true,
                            sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/site', toJSON: () => ({ keys: { p256dh: 'PKEY', auth: 'AKEY' } }) } });
  const r = NB.mount(plant(R.doc, { league: 'slb-men', team: 'london-lions', sw: '/epinoia-sw.js' }));
  await r.ready;
  eq('on the next visit it reads what this browser follows, and says Following', labelOf(r), 'Following');
  const P = buttonBrowser({ respond: answers({ site: true }) });
  const pk = NB.mount(plant(P.doc, { league: 'slb-men', sw: '/epinoia-sw.js' }));
  await pk.ready;
  pk.main.click();
  const boxes = pk.pick.querySelectorAll('input');
  ok('a button naming nothing lists the league\'s clubs to tick', !pk.pick.hidden && boxes.length === 2);
  boxes[1].checked = true;
  pk.pick.querySelector('button').click();
  await tick(5); await tick(5);
  eq('...and follows the ones ticked', (P.calls.fetch.find(f => /notify_device_follow$/.test(f.url)) || {}).body.p_add, { teams: ['99999999-2222-3333-4444-555555555555'] });
}
{
  /* the queue embed.js fills */
  const B = buttonBrowser({ respond: answers() });
  const a = plant(B.doc, { league: 'slb-men', team: 'london-lions' });
  globalThis.EpinoiaNotifyButtons = [a];
  NB.boot();
  await tick(10);
  ok('boot mounts what embed.js queued, and later snippets mount at once', !!a.nextSibling && typeof globalThis.EpinoiaNotifyButtons.push === 'function');
  delete globalThis.EpinoiaNotifyButtons;
}
T.env(null);

/* ============================================================== page.js === */
console.log('\nEpinoia\'s window (embed/notify/page.js)');
const NW = require(path.join(ROOT, 'epinoia', 'embed', 'notify', 'page.js'));
{
  const P = NW._test;
  const TEAM = '11111111-2222-3333-4444-555555555555';
  eq('the window reads the league, the thing and the site', P.params('?l=slb-men&team=' + TEAM + '&from=https://Club.example'),
     { league: 'slb-men', kind: 'team', id: TEAM, from: 'https://club.example' });
  eq('...ignoring a thing that is not an id and a site that is not an https origin', P.params('?l=slb-men&team=lions&from=javascript:alert(1)'),
     { league: 'slb-men', kind: 'league', id: '', from: '' });
  ok('it has a switch for each moment a device can hear about',
     JSON.stringify(P.SWITCHES.map(s => s[0])) === JSON.stringify(['want_fixture_2d', 'want_fixture_2h', 'want_lineups', 'want_halftime', 'want_results', 'want_players', 'want_announcements']));
  const lead = P.words({ kind: 'player', name: 'Ben Baker', league: { name: 'SLB' } });
  ok('the words name the thing', /Ben Baker plays/.test(lead.lead) && lead.title === 'Notifications for Ben Baker');
}
{
  /* the window, booted on a page like index.html */
  const html = read('epinoia', 'embed', 'notify', 'index.html');
  const doc = fakeDocument();
  const ids = [...html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)];
  ids.forEach(([, tag, id]) => { const e = new El(tag, doc); e.id = id; e.setAttribute('id', id); if (/class="[^"]*hide/.test(html.split('id="' + id + '"')[0].split('<').pop())) e.className = 'hide'; doc.body.appendChild(e); });
  const calls = { fetch: [], posted: [], perm: 0, register: [], permAt: [] };
  let permission = 'default';
  const reg = { active: {}, pushManager: { getSubscription: async () => null,
    subscribe: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/win', toJSON: () => ({ keys: { p256dh: 'WPK', auth: 'WAU' } }) }) } };
  let following = false;
  NW._test.env({
    document: doc, atob, isSecureContext: true, PushManager: function () {},
    location: { search: '?l=slb-men&team=' + LIONS.id + '&from=https://club.example' },
    EPINOIA_CONFIG: { supabaseUrl: CFG_URL, supabaseAnonKey: CFG_KEY }, EPINOIA_VAPID: CFG_VAPID,
    opener: { postMessage: (m, origin) => calls.posted.push([m, origin]) },
    Notification: { get permission() { return permission; }, requestPermission() { calls.perm++; calls.permAt.push(calls.fetch.length); permission = 'granted'; return Promise.resolve('granted'); } },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/128', serviceWorker: {
      register: async (u, opts) => { calls.register.push([u, opts]); return reg; }, getRegistration: async () => undefined, ready: Promise.resolve(reg) } },
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.fetch.push({ url, body });
      let json = null;
      if (/notify_embed_public$/.test(url)) json = { league: LEAGUE, site: false, epinoia: true };
      else if (/rest\/v1\/teams\?select=id,name&league_id=eq\.lg-1&id=eq\./.test(url)) json = [LIONS];
      else if (/notify_device_follow$/.test(url)) {
        following = !(body.p_remove && body.p_remove.teams);
        json = following ? { device: true, teams: [LIONS], players: [], games: [], prefs: { want_halftime: true } } : { device: false };
      }
      return { ok: true, status: 200, json: async () => json };
    }
  });
  const w = NW.boot();
  await w.ready;
  const byId = id => doc.getElementById(id);
  eq('the window names the club and offers to turn notifications on', [walkText(byId('title')), byId('on').classList.contains('hide')], ['Notifications for London Lions', false]);
  const before = calls.fetch.length;
  byId('on').dispatchEvent(new Ev('click'));
  ok('the permission is asked inside the tap, before any request', calls.perm === 1 && calls.permAt[0] === before);
  await tick(5); await tick(5); await tick(5);
  eq('Epinoia\'s own worker is registered, at Epinoia\'s scope', calls.register, [['/epinoia/sw.js', { scope: '/epinoia/' }]]);
  const f = calls.fetch.find(x => /notify_device_follow$/.test(x.url));
  eq('...and the device follows that club', f && f.body.p_add, { teams: [LIONS.id] });
  eq('the page that opened the window is told, at its own origin only', calls.posted[0],
     [{ type: 'epinoia-notify', league: 'slb-men', kind: 'team', id: LIONS.id, following: true }, 'https://club.example']);
  ok('the switches and the stop button appear', !byId('stop').classList.contains('hide') && !byId('opts').classList.contains('hide'));
  byId('stop').dispatchEvent(new Ev('click'));
  await tick(5); await tick(5);
  eq('stopping tells the page too', calls.posted[calls.posted.length - 1][0].following, false);
  NW._test.env(null);
}
{
  const P = NW._test;
  P.env({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, standalone: false },
          isSecureContext: true, matchMedia: () => ({ matches: false }) });
  eq('an iPhone outside the Home Screen is told how to install instead', P.support(), 'ios-install');
  P.env(null);
}

/* ============================================================= embed.js === */
console.log('\nembed.js\'s notify kind');
{
  const src = read('epinoia', 'embed.js');
  const doc = fakeDocument();
  const win = { addEventListener: () => {} };
  const run = data => {
    const me = new El('script', doc);
    me.src = 'https://prophesyscouting.co.uk/epinoia/embed.js';
    Object.assign(me.dataset, data);
    doc.body.appendChild(me);
    doc.currentScript = me;
    const ctx = vm.createContext({ document: doc, window: win, URL, console });
    vm.runInContext(src, ctx);
    return me;
  };
  const a = run({ epinoia: 'notify', league: 'slb-men', team: 'london-lions' });
  const b = run({ epinoia: 'notify', league: 'slb-men', player: 'ben-baker' });
  const loaders = doc.querySelectorAll('script[data-epinoia-notify-loader]');
  ok('two buttons on a page: both queued, the button\'s script loaded once',
     Array.isArray(win.EpinoiaNotifyButtons) && win.EpinoiaNotifyButtons.length === 2 && win.EpinoiaNotifyButtons[0] === a && win.EpinoiaNotifyButtons[1] === b &&
     loaders.length === 1 && loaders[0].src === 'https://prophesyscouting.co.uk/epinoia/embed/notify/notify.js');
  ok('...and no frame is made for a notification button', doc.querySelectorAll('iframe').length === 0);
}

/* ======================================================= the console === */
console.log('\nthe console\'s snippet maker');
{
  const E = require(path.join(ROOT, 'epinoia', 'admin', 'embeds-ui.js'));
  eq('a club page\'s snippet', E.notifySnippet({ league: 'slb-men', kind: 'team', team: 'london-lions', theme: 'dark' }),
     '<script src="https://prophesyscouting.co.uk/epinoia/embed.js" data-epinoia="notify" data-league="slb-men" data-team="london-lions"></script>');
  eq('a player page\'s, light, on the site\'s own domain, with its words escaped',
     E.notifySnippet({ league: 'slb-men', kind: 'player', player: 'abc', theme: 'light', sw: true, label: 'Follow "Ben"' }),
     '<script src="https://prophesyscouting.co.uk/epinoia/embed.js" data-epinoia="notify" data-league="slb-men" data-player="abc" data-label="Follow &quot;Ben&quot;" data-theme="light" data-sw="/epinoia-sw.js"></script>');
  const S = src => fs.readFileSync(path.join(ROOT, src), 'utf8');
  const button = S('epinoia/embed/notify/notify.js');
  ok('every attribute the snippet maker writes is one the button reads',
     ['league', 'team', 'player', 'game', 'label', 'theme', 'sw'].every(a => new RegExp('d\\.' + a + '\\b').test(button)));
  const admin = S('epinoia/admin/admin.js');
  const page = S('epinoia/admin/index.html');
  ok('the console mounts it under Embeds', /EpinoiaEmbedsUI\.mountNotify\(\{ host: '#notifyEmbedPanel'/.test(admin) && page.includes('id="notifyEmbedPanel"'));
}

/* ============================================= the functions exist === */
console.log('\nwhat the button calls, the migration defines');
{
  const mig = read('supabase', 'migrations', '0127_notify_embed.sql');
  const used = new Set();
  ['epinoia/embed/notify/notify.js', 'epinoia/embed/notify/page.js', 'epinoia/admin/embeds-ui.js'].forEach(f => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    [...s.matchAll(/rpc\(\s*'(\w+)'/g), ...s.matchAll(/\.rpc\(\s*'(\w+)'/g)].forEach(m => used.add(m[1]));
  });
  const all = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql'))
    .map(f => read('supabase', 'migrations', f)).join('\n');
  const defined = n => new RegExp('create (or replace )?function (public\\.)?' + n + '\\(').test(all);
  const missing = [...used].filter(n => !defined(n));
  ok('every function the button, the window and the console call (' + [...used].sort().join(', ') + ') exists', used.size >= 6 && !missing.length, missing.join(', '));
  const ours = [...used].filter(n => /^notify_|^set_notify_embed$/.test(n));
  ok('...and the notification ones are 0127\'s', ours.length >= 5 && ours.every(n => new RegExp('create or replace function public\\.' + n + '\\(').test(mig)), ours.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
