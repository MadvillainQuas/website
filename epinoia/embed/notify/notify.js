/* ============================================================================
   EPINOIA NOTIFICATION BUTTON — one line on a league's own page
   (docs/notify-embed.md §1–§3).

     <script src="https://prophesyscouting.co.uk/epinoia/embed.js"
             data-epinoia="notify" data-league="slb-men" data-team="london-lions"></script>

   A club page's button follows that club; a player page's, that player; a match
   page's, that game; a button naming nothing lets the visitor pick clubs.

   DRAWN INTO THE PAGE, NOT A FRAME. Browsers refuse to ask for notification
   permission from a frame on another site, so the button lives in the page itself,
   inside a closed shadow root: the site's CSS cannot reach it and its CSS cannot leak
   out.

   TWO WAYS TO SUBSCRIBE:
     through Epinoia (default)  the button opens Epinoia's window, where the visitor
                                allows notifications; it works on any website
     on the site's own domain   with data-sw="/epinoia-sw.js" and the site set up in
                                the console, the button asks right here, registers that
                                file under /epinoia-push/ and notifications come from
                                the site itself
   A browser's subscription is the subscriber: Epinoia stores its push address and
   what it follows, and nothing about the person.

   NOTHING ELSE IS STORED: one localStorage hint per button in window mode, so it can
   say "Following" after the window closes (the window's subscription belongs to
   Epinoia's domain, which this page cannot read).

   UMD so node can require() it for supabase/tests/notify-embed.test.mjs; tests swap
   the browser in with _test.env({...}).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaNotifyButton = api; api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
'use strict';

const EPINOIA_ORIGIN = 'https://prophesyscouting.co.uk';
const EPINOIA = EPINOIA_ORIGIN + '/epinoia/';
/* PUBLIC VALUES, COPIED FROM epinoia/config.js; the test fails if they drift. */
const SUPABASE_URL = 'https://hhvofgqqadtyvcjudhjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';
const VAPID_PUBLIC_KEY = 'BLskwAuRGoAJnRcYe0gyLE5R0otKhcvu8fL5UxE06ep_VGzxfbirqziIS4uu3N6BmQob4Vl9vSiokUuVKpa7toM';
const SCOPE = '/epinoia-push/';
const HINT = 'epinoia-notify:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const PLURAL = { team: 'teams', player: 'players', game: 'games' };

const WORDS = Object.freeze({
  get: 'Get notifications',
  following: 'Following',
  busy: 'Just a moment…',
  blocked: 'Notifications are blocked for this site in your browser’s settings.',
  unsupported: 'This browser cannot receive notifications. On iPhone, add the site to your Home Screen first.',
  failed: 'Notifications could not be turned on just now. Try again in a minute.',
  popup: 'Allow pop-ups for this site, then try again.',
  stop: 'Stop notifications',
  test: 'Send a test',
  tested: 'A test is on its way.',
  stopped: 'Notifications are off.'
});

/* ------------------------------------------------------------ environment --- */
let ENV = null;
const g = k => (ENV && Object.prototype.hasOwnProperty.call(ENV, k)) ? ENV[k] : root[k];

/* this browser's own IANA zone (0144), through g() like every other global so the test
   harness can stub it; never throws — a browser with nothing to say just sends no p_tz,
   and notify_device_follow leaves the device's zone exactly as it was. */
function myTimeZone() {
  try { const I = g('Intl'); return I && I.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) { return null; }
}

/* ---------------------------------------------------------------- options --- */
function optionsFrom(el) {
  const d = (el && el.dataset) || {};
  const id = v => {
    const s = String(v == null ? '' : v).trim();
    return UUID.test(s) ? s.toLowerCase() : (SLUG.test(s.toLowerCase()) ? s.toLowerCase() : '');
  };
  const o = {
    league: SLUG.test(String(d.league || '').trim().toLowerCase()) ? String(d.league).trim().toLowerCase() : '',
    kind: 'league', ref: '',
    label: typeof d.label === 'string' ? d.label.trim().slice(0, 60) : '',
    theme: d.theme === 'light' ? 'light' : 'dark',
    accent: /^#[0-9a-f]{6}$/i.test(String(d.accent || '')) ? String(d.accent).toLowerCase() : '',
    into: typeof d.into === 'string' ? d.into : '',
    /* a path on the site itself: not protocol-relative (//host/x.js), no climbing (..) */
    sw: /^\/(?!\/)[A-Za-z0-9._/-]{1,100}\.js$/.test(String(d.sw || '')) && String(d.sw).indexOf('..') < 0 ? String(d.sw) : ''
  };
  if (d.game && UUID.test(String(d.game).trim())) { o.kind = 'game'; o.ref = String(d.game).trim().toLowerCase(); }
  else if (d.player && id(d.player)) { o.kind = 'player'; o.ref = id(d.player); }
  else if (d.team && id(d.team)) { o.kind = 'team'; o.ref = id(d.team); }
  return o;
}

/* --------------------------------------------------------------- the wire --- */
async function rest(path) {
  const f = g('fetch');
  const r = await f.call(root, SUPABASE_URL + '/rest/v1/' + path, { headers: { apikey: SUPABASE_KEY, Accept: 'application/json' } });
  if (!r.ok) throw new Error('read ' + r.status);
  return r.json();
}
/* p_tz (0145) is refused by a database without 0145: PostgREST finds no notify_device_follow
   taking it and answers 404 (PGRST202) for the whole call, so every follow failed from 257ae292
   until the migration lands. One retry without it; once 0145 is applied the first call works. */
async function followRpc(body) {
  try { return await rpc('notify_device_follow', body); }
  catch (e) {
    if (!(e && e.status === 404 && body && 'p_tz' in body)) throw e;
    const rest = Object.assign({}, body); delete rest.p_tz;
    return rpc('notify_device_follow', rest);
  }
}

async function rpc(name, body) {
  const f = g('fetch');
  const r = await f.call(root, SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  let data = null;
  try { data = await r.json(); } catch (_) { data = null; }
  if (!r.ok) {
    const e = new Error((data && data.message) || ('refused ' + r.status));
    e.status = r.status;
    throw e;
  }
  return data;
}
const enc = encodeURIComponent;

/* the league, and the one thing the button names, by name */
async function resolve(o) {
  const info = await rpc('notify_embed_public', { p_league: o.league });
  if (!info || !info.league) throw new Error('unknown league');
  const lid = info.league.id;
  const out = { league: info.league, site: !!info.site, kind: o.kind, id: '', name: info.league.name, teams: [] };
  if (o.kind === 'team') {
    const rows = await rest('teams?select=id,name&league_id=eq.' + enc(lid) + '&' + (UUID.test(o.ref) ? 'id' : 'slug') + '=eq.' + enc(o.ref) + '&limit=1');
    if (!rows || !rows[0]) throw new Error('unknown club');
    out.id = rows[0].id; out.name = rows[0].name;
  } else if (o.kind === 'player') {
    const rows = await rest('players?select=id,first_name,last_name&' + (UUID.test(o.ref) ? 'id' : 'slug') + '=eq.' + enc(o.ref) + '&limit=1');
    if (!rows || !rows[0]) throw new Error('unknown player');
    out.id = rows[0].id; out.name = [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' ');
  } else if (o.kind === 'game') {
    const rows = await rest('games?select=id,home_team_id,away_team_id&id=eq.' + enc(o.ref) + '&limit=1');
    if (!rows || !rows[0]) throw new Error('unknown game');
    const teams = await rest('teams?select=id,name&id=in.(' + enc(rows[0].home_team_id) + ',' + enc(rows[0].away_team_id) + ')');
    const nm = tid => ((teams || []).find(t => t.id === tid) || {}).name || '';
    out.id = rows[0].id; out.name = [nm(rows[0].home_team_id), nm(rows[0].away_team_id)].filter(Boolean).join(' v ');
  } else {
    out.teams = await rest('teams?select=id,name&league_id=eq.' + enc(lid) + '&order=name');
  }
  return out;
}

/* ---------------------------------------------------------- the browser --- */
function supported() {
  const nav = g('navigator');
  return !!(nav && nav.serviceWorker && g('PushManager') && g('Notification') && g('isSecureContext') !== false);
}
function keyBytes(k) {
  const s = String(k || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = g('atob')(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* called synchronously inside the tap: Safari and Firefox refuse a prompt once the tap
   has been spent on a network round trip */
function askPermission() {
  const N = g('Notification');
  if (!N) return Promise.resolve('denied');
  if (N.permission === 'granted' || N.permission === 'denied') return Promise.resolve(N.permission);
  return new Promise(resolve => {
    let done = false;
    const fin = p => { if (!done) { done = true; resolve(p); } };
    try {
      const pr = N.requestPermission(fin);
      if (pr && typeof pr.then === 'function') pr.then(fin, () => fin(N.permission));
    } catch (_) { fin(N.permission); }
  });
}
async function activeRegistration(swPath) {
  const sw = g('navigator').serviceWorker;
  const reg = await sw.register(swPath, { scope: SCOPE });
  if (reg.active) return reg;
  const w = reg.installing || reg.waiting;
  await new Promise(resolve => {
    const t = setTimeout(resolve, 10000);
    if (w && typeof w.addEventListener === 'function') {
      w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(t); resolve(); } });
    } else { clearTimeout(t); resolve(); }
  });
  return reg;
}
async function siteSubscription() {
  const sw = g('navigator').serviceWorker;
  if (!sw || typeof sw.getRegistration !== 'function') return null;
  try {
    const reg = await sw.getRegistration(SCOPE);
    return reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
  } catch (_) { return null; }
}
function subKeys(sub) {
  const j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : (sub || {});
  return { endpoint: sub.endpoint || j.endpoint, p256dh: (j.keys || {}).p256dh, auth: (j.keys || {}).auth };
}
const follows = (state, kind, id) => !!(state && state.device && (state[PLURAL[kind]] || []).some(x => x.id === id));

/* the window's address: the league, the thing, and this site's origin to report back to */
function windowUrl(o, info, origin) {
  const u = new URL('embed/notify/', EPINOIA);
  u.searchParams.set('l', o.league);
  if (info.kind !== 'league' && info.id) u.searchParams.set(info.kind, info.id);
  if (/^https:\/\/[^\s/]+$/.test(String(origin || ''))) u.searchParams.set('from', origin);
  return u.href;
}
const hintKey = (o, info) => HINT + o.league + ':' + info.kind + ':' + (info.id || 'league');
function hint(o, info, on) {
  let ls = null;
  try { ls = g('localStorage'); } catch (_) { ls = null; }
  if (!ls) return false;
  try {
    if (on === undefined) return ls.getItem(hintKey(o, info)) === '1';
    if (on) ls.setItem(hintKey(o, info), '1'); else ls.removeItem(hintKey(o, info));
  } catch (_) { /* private mode */ }
  return !!on;
}

/* -------------------------------------------------------------- drawing --- */
const CSS = [
  ':host{all:initial;display:inline-block;vertical-align:middle}',
  '.w{--bg:#04100b;--ink:#e6fff1;--line:rgba(147,242,191,.45);--accent:#93f2bf;--on:#04100b;--bad:#ff8a93;',
  'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:inline-flex;flex-direction:column;align-items:flex-start;gap:6px;position:relative}',
  '.w.light{--bg:#ffffff;--ink:#0d1f17;--line:rgba(13,31,23,.35);--accent:#0c7a54;--on:#ffffff;--bad:#b3261e}',
  'button{-webkit-appearance:none;appearance:none;font:600 14px/1.2 inherit;cursor:pointer;border-radius:999px;min-height:40px;padding:8px 16px;',
  'display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}',
  'button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
  'button[disabled]{cursor:default;opacity:.7}',
  '.main.on{background:var(--accent);border-color:var(--accent);color:var(--on)}',
  'svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}',
  '.menu{display:flex;flex-wrap:wrap;gap:6px}',
  '.menu[hidden],.msg[hidden],.pick[hidden]{display:none}',
  '.menu button{min-height:36px;padding:6px 12px;font-size:13px}',
  '.msg{font:13px/1.45 inherit;color:var(--ink);max-width:36ch}',
  '.msg.bad{color:var(--bad)}',
  '.pick{display:grid;gap:4px;max-height:260px;overflow:auto;padding:8px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);min-width:220px}',
  '.pick label{display:flex;align-items:center;gap:8px;font:14px/1.4 inherit;min-height:32px}',
  '@media (prefers-reduced-motion:reduce){button{transition:none}}'
].join('');
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';

function onColour(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? '#04100b' : '#ffffff';
}

/* one button: the element the snippet planted, its options, and everything it does */
function mount(el) {
  const doc = g('document');
  const o = optionsFrom(el);
  if (!o.league || !doc) return null;
  const hostEl = doc.createElement('span');
  hostEl.className = 'epinoia-notify';
  const target = o.into ? doc.querySelector(o.into) : null;
  if (target) target.appendChild(hostEl);
  else if (el.parentNode) el.parentNode.insertBefore(hostEl, el.nextSibling);
  const sr = typeof hostEl.attachShadow === 'function' ? hostEl.attachShadow({ mode: 'closed' }) : hostEl;

  const style = doc.createElement('style'); style.textContent = CSS;
  const wrap = doc.createElement('div'); wrap.className = 'w' + (o.theme === 'light' ? ' light' : '');
  if (o.accent) { wrap.style.setProperty('--accent', o.accent); wrap.style.setProperty('--on', onColour(o.accent)); }
  const main = doc.createElement('button'); main.type = 'button'; main.className = 'main';
  const icon = doc.createElement('span'); icon.innerHTML = BELL;              // a fixed icon, no data in it
  const text = doc.createElement('span');
  main.append(icon, text);
  const menu = doc.createElement('div'); menu.className = 'menu'; menu.hidden = true;
  const stop = doc.createElement('button'); stop.type = 'button'; stop.textContent = WORDS.stop;
  const test = doc.createElement('button'); test.type = 'button'; test.textContent = WORDS.test;
  menu.append(stop, test);
  const pick = doc.createElement('div'); pick.className = 'pick'; pick.hidden = true;
  const msg = doc.createElement('div'); msg.className = 'msg'; msg.hidden = true; msg.setAttribute('role', 'status');
  wrap.append(main, menu, pick, msg);
  sr.append(style, wrap);

  const st = { o, info: null, mode: 'window', on: false, busy: false, sub: null };
  const say = (t, bad) => { msg.textContent = t || ''; msg.hidden = !t; msg.className = 'msg' + (bad ? ' bad' : ''); };
  function paint() {
    const thing = st.info && st.info.kind !== 'league' ? st.info.name : '';
    text.textContent = st.busy ? WORDS.busy : (o.label || (st.on ? WORDS.following : WORDS.get));
    main.classList.toggle('on', st.on);
    main.setAttribute('aria-pressed', String(st.on));
    main.setAttribute('aria-label', (st.on ? 'Following ' : 'Get notifications for ') + (thing || (st.info ? st.info.name : 'this league')));
    main.disabled = st.busy || !st.info;
  }
  paint();

  async function refreshSite() {
    const sub = await siteSubscription();
    st.sub = sub;
    if (!sub) { st.on = false; return; }
    const k = subKeys(sub);
    const state = await rpc('notify_device_get', { p_endpoint: k.endpoint, p_auth: k.auth }).catch(() => null);
    st.on = st.info.kind === 'league' ? !!(state && state.device) : follows(state, st.info.kind, st.info.id);
  }

  const ready = resolve(o).then(async info => {
    st.info = info;
    st.mode = o.sw && info.site && supported() ? 'site' : 'window';
    if (st.mode === 'site') await refreshSite();
    else st.on = hint(o, info);
    paint();
  }).catch(() => { main.disabled = true; say(''); });

  /* window mode: Epinoia's window reports back; only Epinoia's origin is believed */
  const win = g('window');
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('message', ev => {
      if (!ev || ev.origin !== EPINOIA_ORIGIN || !st.info) return;
      const d = ev.data;
      if (!d || d.type !== 'epinoia-notify' || d.league !== o.league) return;
      if (st.info.kind !== 'league' && (d.kind !== st.info.kind || d.id !== st.info.id)) return;
      st.on = !!d.following;
      hint(o, st.info, st.on);
      paint();
    });
  }

  function openWindow() {
    const loc = g('location');
    const url = windowUrl(o, st.info, loc && loc.origin);
    const w = win && typeof win.open === 'function' ? win.open(url, 'epinoia-notify', 'popup=yes,width=460,height=720') : null;
    if (!w) say(WORDS.popup, true);
  }

  async function siteFollow(add, remove) {
    const sub = st.sub || await siteSubscription();
    if (!sub) throw new Error('no subscription');
    const k = subKeys(sub);
    return followRpc({ p_league: o.league, p_endpoint: k.endpoint, p_p256dh: k.p256dh, p_auth: k.auth,
                       p_add: add || {}, p_remove: remove || {}, p_prefs: {}, p_tz: myTimeZone() });
  }

  /* site mode: permission here, in the tap; then the site's worker, the subscription, the follow */
  function siteTurnOn(add) {
    const asked = askPermission();
    st.busy = true; say(''); paint();
    return asked.then(async perm => {
      if (perm !== 'granted') { say(WORDS.blocked, true); return; }
      const reg = await activeRegistration(o.sw);
      const sub = (await reg.pushManager.getSubscription()) ||
                  await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
      st.sub = sub;
      const state = await siteFollow(add, null);
      st.on = st.info.kind === 'league' ? !!(state && state.device) : follows(state, st.info.kind, st.info.id);
    }).catch(() => { say(WORDS.failed, true); })
      .then(() => { st.busy = false; paint(); });
  }

  function drawPicker() {
    pick.textContent = '';
    (st.info.teams || []).forEach(t => {
      const lab = doc.createElement('label');
      const box = doc.createElement('input'); box.type = 'checkbox'; box.value = t.id;
      lab.append(box, doc.createTextNode(t.name));
      pick.appendChild(lab);
    });
    const go = doc.createElement('button'); go.type = 'button'; go.textContent = 'Turn on for the clubs ticked';
    go.addEventListener('click', () => {
      const ids = [...pick.querySelectorAll('input')].filter(i => i.checked).map(i => i.value);
      if (!ids.length) return;
      pick.hidden = true;
      siteTurnOn({ teams: ids });
    });
    pick.appendChild(go);
    pick.hidden = false;
  }

  main.addEventListener('click', () => {
    if (st.busy || !st.info) return;
    if (st.mode === 'window') { openWindow(); return; }
    if (!supported()) { say(WORDS.unsupported, true); return; }
    if (st.on) { menu.hidden = !menu.hidden; return; }
    if (st.info.kind === 'league') { drawPicker(); return; }
    siteTurnOn({ [PLURAL[st.info.kind]]: [st.info.id] });
  });

  stop.addEventListener('click', () => {
    if (st.busy) return;
    st.busy = true; paint();
    const remove = st.info.kind === 'league'
      ? { teams: (st.info.teams || []).map(t => t.id) }
      : { [PLURAL[st.info.kind]]: [st.info.id] };
    siteFollow(null, remove).then(state => {
      st.on = st.info.kind === 'league' ? !!(state && state.device) : follows(state, st.info.kind, st.info.id);
      menu.hidden = true; say(WORDS.stopped);
    }).catch(() => say(WORDS.failed, true))
      .then(() => { st.busy = false; paint(); });
  });

  test.addEventListener('click', () => {
    if (st.busy || !st.sub) return;
    const k = subKeys(st.sub);
    rpc('notify_device_test', { p_endpoint: k.endpoint, p_auth: k.auth, p_league: o.league })
      .then(ok => {
        say(ok ? WORDS.tested : 'A test was sent a moment ago. Try again in a minute.');
        if (ok) {
          /* delivered straight away rather than at the next minute's tick */
          const f = g('fetch');
          f.call(root, SUPABASE_URL + '/functions/v1/notify', { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: '{}' })
            .catch(() => {});
        }
      })
      .catch(() => say(WORDS.failed, true));
  });

  return { el: hostEl, state: st, ready, main, menu, stop, test, pick, msg };
}

/* the buttons embed.js queued before this file arrived, the ones queued after, and a
   snippet that loads this file directly */
function boot() {
  const doc = g('document');
  if (!doc) return;
  const q = root.EpinoiaNotifyButtons;
  const list = Array.isArray(q) ? q.splice(0) : [];
  const push = el => { try { mount(el); } catch (_) { /* one broken snippet never stops the others */ } };
  list.forEach(push);
  root.EpinoiaNotifyButtons = { push };
  const me = doc.currentScript;
  if (me && me.dataset && me.dataset.league && !me.dataset.epinoiaNotifyLoader) push(me);
}

return {
  mount, boot, WORDS, SCOPE,
  _test: {
    env(e) { ENV = e || null; },
    optionsFrom, windowUrl, hintKey, follows, keyBytes, onColour, resolve,
    SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, EPINOIA_ORIGIN
  }
};
}));
