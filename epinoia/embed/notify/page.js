/* ============================================================================
   The window a notification button opens (docs/notify-embed.md §2).

   /epinoia/embed/notify/?l=<league>&team=|player=|game=<id>&from=<the site's origin>

   The visitor allows notifications here, on Epinoia's own domain, so a button works on
   any website. The browser's subscription is saved as a DEVICE following the one thing
   the button named (a button naming nothing lists the league's clubs), with the
   switches for which moments it hears about, a test, and a way to stop. Each change is
   reported to the page that opened the window — only to the origin it named — so its
   button can say "Following".

   UMD so node can require() it for supabase/tests/notify-embed.test.mjs; tests swap
   the browser in with _test.env({...}).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaNotifyWindow = api; api.boot(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
'use strict';

const SW_URL = '/epinoia/sw.js';
const SCOPE = '/epinoia/';
const RECEIPT_MS = 20000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const PLURAL = { team: 'teams', player: 'players', game: 'games' };
const SWITCHES = [
  ['want_fixture_2d', '2 days before'],
  ['want_fixture_2h', '2 hours before'],
  ['want_lineups', 'Starting lineups'],
  ['want_halftime', 'Half-time'],
  ['want_results', 'Full-time result'],
  ['want_players', 'Player lines at half-time and full time'],
  ['want_announcements', 'League news']
];

let ENV = null;
const g = k => (ENV && Object.prototype.hasOwnProperty.call(ENV, k)) ? ENV[k] : root[k];
const cfg = () => g('EPINOIA_CONFIG') || {};

/* this browser's own IANA zone (0144), through g() like every other global so the test
   harness can stub it; never throws — a browser with nothing to say just sends no p_tz,
   and notify_device_follow leaves the device's zone exactly as it was. */
function myTimeZone() {
  try { const I = g('Intl'); return I && I.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) { return null; }
}

/* ---------------------------------------------------------------- the ask --- */
function params(search) {
  const q = new URLSearchParams(String(search || ''));
  const out = { league: '', kind: 'league', id: '', from: '' };
  const l = String(q.get('l') || '').trim().toLowerCase();
  if (SLUG.test(l)) out.league = l;
  for (const k of ['game', 'player', 'team']) {
    const v = String(q.get(k) || '').trim().toLowerCase();
    if (UUID.test(v)) { out.kind = k; out.id = v; break; }
  }
  const from = String(q.get('from') || '').trim();
  if (/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(from)) out.from = from.toLowerCase();
  return out;
}

async function rest(path) {
  const f = g('fetch');
  const r = await f.call(root, cfg().supabaseUrl + '/rest/v1/' + path, { headers: { apikey: cfg().supabaseAnonKey, Accept: 'application/json' } });
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
  const r = await f.call(root, cfg().supabaseUrl + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: cfg().supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  let data = null;
  try { data = await r.json(); } catch (_) { data = null; }
  if (!r.ok) { const e = new Error((data && data.message) || ('refused ' + r.status)); e.status = r.status; throw e; }
  return data;
}

async function describe(p) {
  const info = await rpc('notify_embed_public', { p_league: p.league });
  if (!info || !info.league) throw new Error('unknown league');
  const out = { league: info.league, kind: p.kind, id: p.id, name: '', teams: [] };
  const enc = encodeURIComponent;
  if (p.kind === 'team') {
    const rows = await rest('teams?select=id,name&league_id=eq.' + enc(info.league.id) + '&id=eq.' + enc(p.id));
    if (!rows[0]) throw new Error('unknown club');
    out.name = rows[0].name;
  } else if (p.kind === 'player') {
    const rows = await rest('players?select=id,first_name,last_name&id=eq.' + enc(p.id));
    if (!rows[0]) throw new Error('unknown player');
    out.name = [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' ');
  } else if (p.kind === 'game') {
    const rows = await rest('games?select=id,home_team_id,away_team_id&id=eq.' + enc(p.id));
    if (!rows[0]) throw new Error('unknown game');
    const teams = await rest('teams?select=id,name&id=in.(' + enc(rows[0].home_team_id) + ',' + enc(rows[0].away_team_id) + ')');
    const nm = tid => (teams.find(t => t.id === tid) || {}).name || '';
    out.name = [nm(rows[0].home_team_id), nm(rows[0].away_team_id)].filter(Boolean).join(' v ');
  } else {
    out.teams = await rest('teams?select=id,name&league_id=eq.' + enc(info.league.id) + '&order=name');
  }
  return out;
}

function words(info) {
  const n = info.name, lg = info.league.name;
  if (info.kind === 'team') return { title: 'Notifications for ' + n, lead: 'Tip-off reminders, lineups, the half-time and full-time scores and league news for ' + n + ', on this device.' };
  if (info.kind === 'player') return { title: 'Notifications for ' + n, lead: 'Reminders before ' + n + ' plays, whether they start, and their line at half-time and full time, on this device.' };
  if (info.kind === 'game') return { title: 'Notifications for ' + n, lead: 'The reminders, the lineups, and the half-time and final score of ' + n + ', on this device.' };
  return { title: 'Notifications from ' + lg, lead: 'Choose the clubs you want to hear about. Reminders, lineups and scores arrive on this device.' };
}

/* ---------------------------------------------------------- the browser --- */
function isIOS(nav) {
  const ua = String((nav && nav.userAgent) || '');
  return /iPhone|iPad|iPod/.test(ua) || (!!nav && nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1);
}
function standalone() {
  const nav = g('navigator') || {};
  if (nav.standalone === true) return true;
  const mm = g('matchMedia');
  try { return typeof mm === 'function' && !!mm.call(root, '(display-mode: standalone)').matches; } catch (_) { return false; }
}
function support() {
  const nav = g('navigator');
  if (!nav || g('isSecureContext') === false) return 'unsupported';
  if (isIOS(nav) && !standalone()) return 'ios-install';
  if (!nav.serviceWorker || !g('PushManager') || !g('Notification')) return 'unsupported';
  return g('Notification').permission === 'denied' ? 'denied' : 'ok';
}
function keyBytes(k) {
  const s = String(k || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = g('atob')(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function askPermission() {
  const N = g('Notification');
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
async function currentSub() {
  const sw = g('navigator').serviceWorker;
  try {
    const reg = await sw.getRegistration(SCOPE);
    return reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
  } catch (_) { return null; }
}
async function subscribe() {
  const sw = g('navigator').serviceWorker;
  const reg = await sw.register(SW_URL, { scope: SCOPE });
  if (!reg.active && sw.ready) await Promise.race([sw.ready, new Promise(r => setTimeout(r, 10000))]);
  return (await reg.pushManager.getSubscription()) ||
         reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(g('EPINOIA_VAPID')) });
}
function subKeys(sub) {
  const j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
  return { endpoint: sub.endpoint || j.endpoint, p256dh: (j.keys || {}).p256dh, auth: (j.keys || {}).auth };
}
function waitForReceipt(prefix, ms) {
  const sw = (g('navigator') || {}).serviceWorker;
  return new Promise(resolve => {
    if (!sw || typeof sw.addEventListener !== 'function') { resolve(null); return; }
    const on = ev => { const d = ev && ev.data; if (d && d.type === 'epinoia-push' && String(d.tag || '').indexOf(prefix) === 0) { done(d); } };
    const t = setTimeout(() => done(null), ms);
    function done(v) { clearTimeout(t); try { sw.removeEventListener('message', on); } catch (_) { /* gone */ } resolve(v); }
    sw.addEventListener('message', on);
  });
}
const follows = (state, kind, id) => !!(state && state.device && (state[PLURAL[kind]] || []).some(x => x.id === id));

/* ------------------------------------------------------------- the page --- */
function boot() {
  const doc = g('document');
  if (!doc || !doc.getElementById('card')) return null;
  const $ = id => doc.getElementById(id);
  const p = params((g('location') || {}).search);
  const st = { p, info: null, state: null, sub: null, busy: false };
  const show = (id, on) => $(id).classList.toggle('hide', !on);
  const say = (t, kind) => { $('msg').textContent = t || ''; $('msg').className = 'msg' + (kind ? ' ' + kind : '') + (t ? '' : ' hide'); };

  function report() {
    const opener = g('opener');
    if (!opener || !p.from || typeof opener.postMessage !== 'function') return;
    const following = st.info.kind === 'league' ? !!(st.state && st.state.device) : follows(st.state, st.info.kind, st.info.id);
    try { opener.postMessage({ type: 'epinoia-notify', league: p.league, kind: st.info.kind, id: st.info.kind === 'league' ? '' : st.info.id, following }, p.from); } catch (_) { /* closed */ }
  }

  function paint() {
    const on = st.info.kind === 'league' ? !!(st.state && st.state.device) : follows(st.state, st.info.kind, st.info.id);
    show('on', !on && st.info.kind !== 'league');
    show('stop', on && st.info.kind !== 'league');
    show('test', !!(st.state && st.state.device));
    show('close', !!g('opener') && on);
    $('stop').textContent = 'Stop notifications for ' + st.info.name;
    $('on').disabled = $('stop').disabled = $('test').disabled = st.busy;
    show('optsH', !!(st.state && st.state.device));
    show('opts', !!(st.state && st.state.device));
    $('opts').textContent = '';
    if (st.state && st.state.device) {
      SWITCHES.forEach(([k, label]) => {
        const row = doc.createElement('label'); row.className = 'opt';
        const box = doc.createElement('input'); box.type = 'checkbox'; box.className = 'sw'; box.setAttribute('role', 'switch');
        box.checked = st.state.prefs ? st.state.prefs[k] !== false : true;
        box.addEventListener('change', () => change({}, {}, { [k]: box.checked }));
        const text = doc.createElement('span'); text.textContent = label;
        row.append(text, box);
        $('opts').appendChild(row);
      });
    }
    if (st.info.kind === 'league') {
      show('teams', true);
      $('teams').textContent = '';
      st.info.teams.forEach(t => {
        const row = doc.createElement('label'); row.className = 'opt';
        const box = doc.createElement('input'); box.type = 'checkbox'; box.className = 'sw'; box.setAttribute('role', 'switch');
        box.checked = follows(st.state, 'team', t.id);
        box.addEventListener('change', () => box.checked ? turnOn({ teams: [t.id] }) : change({}, { teams: [t.id] }, {}));
        const text = doc.createElement('span'); text.textContent = t.name;
        text.setAttribute('translate', 'no');                  // a club's name
        row.append(text, box);
        $('teams').appendChild(row);
      });
    }
  }

  async function change(add, remove, prefs) {
    if (!st.sub) return;
    const k = subKeys(st.sub);
    st.busy = true; paint();
    try {
      st.state = await followRpc({ p_league: p.league, p_endpoint: k.endpoint, p_p256dh: k.p256dh, p_auth: k.auth,
                                                     p_add: add, p_remove: remove, p_prefs: prefs, p_tz: myTimeZone() });
      report();
      say(st.state && st.state.device ? 'Saved.' : 'Notifications are off. You can close this window.', 'ok');
    } catch (_) {
      say('That could not be saved just now. Try again in a minute.', 'bad');
    }
    st.busy = false; paint();
  }

  /* the permission is asked here, inside the tap, before anything is awaited */
  function turnOn(add) {
    const sup = support();
    if (sup !== 'ok') { say(sup === 'denied' ? 'Notifications are blocked for Epinoia in this browser’s settings. Allow them there, then try again.' : 'This browser cannot receive notifications.', 'bad'); return Promise.resolve(); }
    const asked = askPermission();
    st.busy = true; say(''); paint();
    return asked.then(async perm => {
      if (perm !== 'granted') { say('Notifications were not allowed. Try again and choose Allow when the browser asks.', 'bad'); return; }
      st.sub = await subscribe();
      const k = subKeys(st.sub);
      st.state = await followRpc({ p_league: p.league, p_endpoint: k.endpoint, p_p256dh: k.p256dh, p_auth: k.auth,
                                                     p_add: add, p_remove: {}, p_prefs: {}, p_tz: myTimeZone() });
      report();
      say('Notifications are on.' + (g('opener') ? ' You can close this window.' : ''), 'ok');
    }).catch(() => say('Notifications could not be turned on just now. Try again in a minute.', 'bad'))
      .then(() => { st.busy = false; paint(); });
  }

  $('on').addEventListener('click', () => { if (!st.busy) turnOn({ [PLURAL[st.info.kind]]: [st.info.id] }); });
  $('stop').addEventListener('click', () => { if (!st.busy) change({}, { [PLURAL[st.info.kind]]: [st.info.id] }, {}); });
  $('close').addEventListener('click', () => { const w = g('window'); if (w && typeof w.close === 'function') w.close(); });
  $('test').addEventListener('click', async () => {
    if (st.busy || !st.sub) return;
    const k = subKeys(st.sub);
    const arrival = waitForReceipt('test:', RECEIPT_MS);
    try {
      const ok = await rpc('notify_device_test', { p_endpoint: k.endpoint, p_auth: k.auth, p_league: p.league });
      if (!ok) { say('A test was sent a moment ago. Try again in a minute.'); return; }
      const f = g('fetch');
      f.call(root, cfg().supabaseUrl + '/functions/v1/notify', { method: 'POST', headers: { apikey: cfg().supabaseAnonKey, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      say('A test is on its way…');
      const got = await arrival;
      say(got && got.shown ? 'The test reached this device.' : got ? 'The test reached this device but was not allowed to show: check this browser’s notification settings.'
                           : 'The test has not arrived yet. It can take up to a minute.', got && got.shown ? 'ok' : '');
    } catch (_) { say('The test could not be sent just now.', 'bad'); }
  });

  const ready = (async () => {
    if (!p.league) { $('lead').textContent = 'This link does not name a league.'; return; }
    try {
      st.info = await describe(p);
    } catch (_) {
      $('lead').textContent = 'This link names something Epinoia does not know.';
      return;
    }
    const w = words(st.info);
    $('league').textContent = st.info.league.name;
    $('title').textContent = w.title;
    $('lead').textContent = w.lead;
    const crest = g('epinoiaLogoUrl') ? g('epinoiaLogoUrl')(st.info.league.logo_path) : null;
    if (crest) { $('crest').src = crest; show('crest', true); }
    const doc2 = g('document'); if (doc2) doc2.title = w.title + ' · Epinoia';
    const sup = support();
    if (sup === 'ios-install') {
      say('On iPhone and iPad, notifications from a website need it on your Home Screen. Open prophesyscouting.co.uk/epinoia in Safari, tap Share, then Add to Home Screen, and follow ' +
          (st.info.name || st.info.league.name) + ' from there.', 'bad');
      return;
    }
    if (sup === 'unsupported') { say('This browser cannot receive notifications. On a phone, use Chrome, Samsung Internet or Firefox.', 'bad'); return; }
    st.sub = await currentSub();
    if (st.sub) {
      const k = subKeys(st.sub);
      st.state = await rpc('notify_device_get', { p_endpoint: k.endpoint, p_auth: k.auth }).catch(() => null);
    }
    paint();
    if (sup === 'denied') say('Notifications are blocked for Epinoia in this browser’s settings. Allow them there, then reload this window.', 'bad');
  })();
  return { st, ready, turnOn, change };
}

return {
  boot,
  _test: { env(e) { ENV = e || null; }, params, words, support, follows, SWITCHES }
};
}));
