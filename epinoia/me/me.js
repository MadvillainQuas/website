'use strict';
/* ============================================================================
   Your profile — a fan's side of Epinoia.

   Membership first (what you pay for or were given, Manage billing, Cancel membership; my_access,
   0117), then favourite clubs and players, a colour, light or dark, and how the platform should
   keep you posted. Preferences save as you change them (set_fan_prefs, 0106); the bell on every
   page and the notify function read the same row.
   ============================================================================ */
const CFG = window.EPINOIA_CONFIG;
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const SWATCHES = ['#93f2bf', '#8ff5ff', '#ffd166', '#ff7ab8', '#b7a8ff', '#ff5f6b', '#63ffa0', '#ffffff', '#ff9f43', '#5ab8ff'];
let sb = null, user = null, prefs = null, league = null, teams = [], playersMine = [];
let saveTimer = null;

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`, { headers: { apikey: CFG.supabaseAnonKey } });
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}
function status(t) { $('#status').textContent = t; }

/* the browser's own IANA zone (0144): a fact about this device, sent with every save so a
   reminder reads the reader's own clock rather than always London's. Never throws — an
   unsupported or blocked Intl just means this save carries no time_zone key, and the row
   keeps whatever it already had. */
function myTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) { return null; }
}

/* ------------------------------------------------------------------ save --- */
function collect() {
  const tz = myTimeZone();
  return {
    theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    colour: prefs.colour,
    fav_team_ids: prefs.fav_team_ids || [],
    fav_player_ids: prefs.fav_player_ids || [],
    notify_inapp: $('#nInapp').checked, notify_email: $('#nEmail').checked, notify_push: $('#nPush').checked,
    want_results: $('#wResults').checked, want_players: $('#wPlayers').checked,
    want_fixtures: $('#wFixtures').checked, want_announcements: $('#wAnn').checked,
    /* notifications v2 (0121); a database without them ignores the keys */
    want_fixture_2d: $('#wFix2d').checked, want_fixture_2h: $('#wFix2h').checked,
    want_lineups: $('#wLineups').checked, want_player_games: $('#wPlayerGames').checked,
    /* half-time (0124) */
    want_halftime: $('#wHalftime').checked,
    /* the reminder clock (0144); omitted rather than sent empty when Intl has nothing to say */
    ...(tz ? { time_zone: tz } : {})
  };
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    status('saving…');
    const { data, error } = await sb.rpc('set_fan_prefs', { p: collect() });
    if (error) { status('not saved: ' + error.message); return; }
    prefs = Object.assign(prefs, data || {});
    status('saved ' + new Date().toLocaleTimeString());
  }, 350);
}

/* ------------------------------------------------------------- the clubs --- */
async function paintLeagues() {
  const ls = await api('leagues?select=id,slug,name&order=name');
  const host = $('#leaguePick'); host.textContent = '';
  if (!league) {
    /* the league of the first club followed, else the first league */
    if ((prefs.fav_team_ids || []).length) {
      try {
        const t = await api('teams?id=eq.' + prefs.fav_team_ids[0] + '&select=league_id');
        league = ls.find(l => l.id === (t[0] || {}).league_id) || null;
      } catch (_) { /* fall through */ }
    }
    league = league || ls[0] || null;
  }
  ls.forEach(l => {
    const b = el('button', 'chip' + (league && league.id === l.id ? ' on' : ''), l.name);
    b.type = 'button';
    b.onclick = () => { league = l; paintLeagues(); paintTeams(); };
    host.appendChild(b);
  });
}
async function paintTeams() {
  const host = $('#teamPick'); host.textContent = '';
  if (!league) return;
  teams = await api('teams?league_id=eq.' + league.id + '&select=id,name,short_name,colour,logo_path&order=name');
  const mine = new Set(prefs.fav_team_ids || []);
  teams.forEach(t => {
    const b = el('button', 'chip' + (mine.has(t.id) ? ' on' : ''));
    b.type = 'button';
    if (window.epinoiaCrest) b.appendChild(window.epinoiaCrest(t));
    b.appendChild(el('span', null, t.name));
    b.onclick = () => {
      const s = new Set(prefs.fav_team_ids || []);
      if (s.has(t.id)) s.delete(t.id); else s.add(t.id);
      prefs.fav_team_ids = [...s];
      paintTeams(); save();
    };
    host.appendChild(b);
  });
  $('#clubNote').textContent = mine.size ? mine.size + (mine.size === 1 ? ' club followed' : ' clubs followed') : 'none followed yet';
}

/* ----------------------------------------------------------- the players --- */
async function paintMine() {
  const host = $('#plMine'); host.textContent = '';
  const ids = prefs.fav_player_ids || [];
  if (!ids.length) { host.appendChild(el('div', 'note', 'No players followed yet. Search above.')); return; }
  const rows = await api('players?id=in.(' + ids.join(',') + ')&select=id,first_name,last_name');
  rows.forEach(p => {
    const r = el('div', 'pl');
    r.append(el('b', null, ((p.first_name || '') + ' ' + (p.last_name || '')).trim()));
    const x = el('button', 'ep-chip', 'unfollow'); x.type = 'button';
    x.onclick = () => { prefs.fav_player_ids = ids.filter(i => i !== p.id); paintMine(); save(); };
    r.appendChild(x); host.appendChild(r);
  });
}
let qTimer = null;
async function search(q) {
  const host = $('#plResults'); host.textContent = '';
  if (!league || !q || q.length < 2) return;
  const { data, error } = await sb.rpc('fan_player_search', { p_league: league.id, p_q: q });
  if (error || !data) return;
  const mine = new Set(prefs.fav_player_ids || []);
  data.filter(p => !mine.has(p.id)).slice(0, 12).forEach(p => {
    const r = el('div', 'pl');
    r.append(el('b', null, p.name), el('small', null, p.team_name || ''));
    const b = el('button', 'ep-chip', 'follow'); b.type = 'button';
    b.onclick = () => { prefs.fav_player_ids = [...mine, p.id]; $('#plq').value = ''; host.textContent = ''; paintMine(); save(); };
    r.appendChild(b); host.appendChild(r);
  });
  if (!host.childElementCount) host.appendChild(el('div', 'note', 'Nobody by that name in ' + league.name + '.'));
}

/* ------------------------------------------------------------ appearance --- */
function paintColour() {
  document.documentElement.style.setProperty('--team-a', prefs.colour || '#93f2bf');
  $('#colour').value = /^#[0-9a-f]{6}$/i.test(prefs.colour || '') ? prefs.colour : '#93f2bf';
  const host = $('#swatches'); host.textContent = '';
  SWATCHES.forEach(c => {
    const s = el('button', 'swatch' + ((prefs.colour || '').toLowerCase() === c ? ' on' : ''));
    s.type = 'button'; s.style.background = c; s.title = c;
    s.onclick = () => { prefs.colour = c; paintColour(); save(); };
    host.appendChild(s);
  });
}
function applyTheme(t) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  if (window.epinoiaColourScheme) window.epinoiaColourScheme(t === 'light');
  try { localStorage.setItem('epinoia_theme', t === 'light' ? 'light' : 'dark'); } catch (_) { /* private mode */ }
  $('#themeDark').classList.toggle('on', t !== 'light');
  $('#themeLight').classList.toggle('on', t === 'light');
}

/* ----------------------------------------------------------------- push ---
   THIS PHONE, through push.js (docs/notifications.md §5) — the same module the
   follow sheet uses, so the profile and the sheet can never disagree about what
   "on" means. The card says where this browser stands in plain words and offers
   only the buttons that make sense from there.

   Two switches, deliberately different:
     the card's Turn on / Turn off   this browser only (a subscription row);
     the "Phone and desktop alerts"  the account's notify_push, every device.
   Turning the card on also switches the account on (push.js does both), and the box
   is ticked to match, so the next save does not quietly send notify_push:false. */
const PHONE_WORDS = {
  on: 'On. What you choose below arrives on this phone, even when Epinoia is closed.',
  off: 'Off on this phone.',
  denied: 'Blocked. Notifications are switched off for this site in this browser’s settings; allow them there, then come back to this page.',
  unsupported: 'This browser cannot receive notifications. On a phone, use Chrome or Samsung Internet on Android, or EPINOIΛ from the Home Screen on an iPhone.',
  'ios-install': 'On iPhone and iPad, notifications only arrive through EPINOIΛ on your Home Screen. Tap Share, then Add to Home Screen, then open EPINOIΛ from there and turn them on.'
};
let phoneBusy = false;

function phoneSay(text, kind) {
  const m = $('#phoneMsg');
  m.textContent = text || '';
  m.className = 'msg ' + (kind || '');
  m.classList.toggle('hide', !text);
}
function standaloneApp() {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (_) { return false; }
}
/* inside the Epinoia Android app (push.js decides: the launcher's report, never Samsung Internet) */
const inAndroidApp = () => { try { return !!(window.EpinoiaPush && window.EpinoiaPush.inApp && window.EpinoiaPush.inApp()); } catch (_) { return false; } };
/* inside the EPINOIΛ iPhone app (push.js: window.EpinoiaNative), which has iOS's own settings */
const inIOSApp = () => { try { return !!(window.EpinoiaPush && window.EpinoiaPush.inIOSApp && window.EpinoiaPush.inIOSApp()); } catch (_) { return false; } };
/* A link styled as the card's buttons, into the app's own notification settings screen. An
   intent: link only opens from a tap, and only the app's package answers it. */
function settingsLink(action) {
  const a = document.createElement('a');
  a.className = 'ep-btn';
  a.textContent = action.label;
  a.href = action.href;
  a.style.textDecoration = 'none';
  a.addEventListener('click', settingsTapped);
  return a;
}
/* after a visit to the settings screen, Back returns to this session with the launch report
   unchanged, so push.js stops believing it (the check then lets its live test decide) */
function settingsTapped() { try { if (window.EpinoiaPush && window.EpinoiaPush.settingsOpened) window.EpinoiaPush.settingsOpened(); } catch (_) { /* a courtesy */ } }
/* AN ANDROID BROWSER IS OFFERED THE ANDROID APP, not the web app (roadmap Phase 6), by the
   same decision as nav.js's banner (EpinoiaAppShell.installOffer), so the two never disagree.
   ONLY ONCE THE APP IS OUT: version.json's released (asked once a session, shared with nav.js)
   sets meAppReleased and repaints the card; until then the button offers the web app. */
let meAppReleased = false;
/* THE SAME FOR AN IPHONE AND THE IPHONE APP (epinoia/ios/version.json): an iPhone is offered the
   iPhone app once it is out, and never the Android one */
let meIosReleased = false;
/* 'android-app', 'ios-app' or null: the app this phone's browser is offered instead of the web app */
function appOffer() {
  const S = window.EpinoiaAppShell;
  if (!S || typeof S.installOffer !== 'function') return null;
  try {
    const o = S.installOffer({
      app: window.epinoiaApp === true, mApp: document.documentElement.classList.contains('m-app'),
      ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, path: location.pathname,
      released: meAppReleased, iosReleased: meIosReleased
    });
    return o === 'android-app' || o === 'ios-app' ? o : null;
  } catch (_) { return null; }
}
function askAppReleased() {
  const S = window.EpinoiaAppShell;
  if (!S || typeof S.version !== 'function' || typeof S.where !== 'function') return;
  try {
    const w = S.where({ app: window.epinoiaApp === true, mApp: document.documentElement.classList.contains('m-app'),
      ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
    if (w !== 'android' && w !== 'ios') return;
    let store = null;
    try { store = window.sessionStorage; } catch (_) { store = null; }
    const ask = w === 'ios' && typeof S.iosVersion === 'function'
      ? S.iosVersion('../ios/version.json', { store })
      : w === 'android' ? S.version('../android/version.json', { store }) : Promise.resolve(null);
    ask.then(ver => {
      if (!ver || ver.released !== true) return;
      if (w === 'ios') meIosReleased = true; else meAppReleased = true;
      if (!phoneBusy) paintPhone();
    }, () => {});
  } catch (_) { /* no offer is the safe answer */ }
}
const INSTALL_WORDS = { web: 'Add EPINOIΛ to your Home Screen', android: 'Get the EPINOIΛ app for Android', ios: 'Get the EPINOIΛ app for iPhone' };
async function paintPhone() {
  const P = window.EpinoiaPush;
  const st = P ? await P.state() : 'unsupported';
  const app = inAndroidApp();
  const iosApp = inIOSApp();
  const offer = app || iosApp ? null : appOffer();
  const offerApp = !!offer;
  $('#phoneCard').dataset.state = st;
  $('#phoneState').textContent = P ? PHONE_WORDS[st] : 'Notifications could not be loaded on this page. Reload to try again.';
  /* IN THE APP, "ON" IS ONLY THIS BROWSER'S SIDE. The JavaScript permission can read granted
     while Android blocks the app, so what Android said at launch is shown beside it (push.js
     appBlocked, which stops believing the launch once the settings have been opened) */
  const blocked = app && P && P.appBlocked ? P.appBlocked() : null;
  if (blocked && st !== 'unsupported') {
    $('#phoneState').textContent = (st === 'on' ? 'On for this page, but Android is not' : PHONE_WORDS[st] + ' Android is also not') +
      ' letting EPINOIΛ pop up notifications (as of this launch). Tap Open notification settings to allow them.';
  }
  if (app || iosApp) $('#pushSettings').href = P.settingsIntent;
  $('#installBtn').textContent = offer === 'ios-app' ? INSTALL_WORDS.ios : offer === 'android-app' ? INSTALL_WORDS.android : INSTALL_WORDS.web;
  const show = {
    /* THE ANDROID APP: its own settings screen is always one tap away, and a test can be
       sent after a wait, so it arrives with the phone locked (roadmap Phase 7). The iPhone
       app has the settings link too (iOS's own notification settings for EPINOIΛ). */
    pushSettings: app || iosApp,
    pushTestLocked: app && st === 'on',
    pushOn: st === 'off',
    pushTest: st === 'on',
    pushOff: st === 'on',
    /* everywhere a browser can take notifications at all, blocked included: the check
       says what is wrong and what to change */
    pushCheck: !!P && st !== 'unsupported' && st !== 'ios-install',
    /* the Home Screen is the whole answer on an iPhone, and an offer worth making
       wherever the browser says it can install; an Android browser is offered the Android
       app instead, whether or not it fired beforeinstallprompt */
    installBtn: !app && !iosApp && !standaloneApp() && (offerApp ? st !== 'on'
      : (st === 'ios-install' || (st !== 'on' && !!(window.epinoiaCanInstall && window.epinoiaCanInstall()))))
  };
  Object.keys(show).forEach(id => $('#' + id).classList.toggle('hide', !show[id]));
  $('#phoneCard .phone-acts').classList.toggle('hide', !Object.values(show).some(Boolean));
  paintDupes(st, app).catch(() => $('#phoneDupes').classList.add('hide'));
  return st;
}

/* TWO SIGN-UPS ON ONE PHONE, TWO OF EVERY NOTIFICATION. A fan who used the Samsung Internet
   web app before installing the Android app still has its subscription, and notify pushes to
   every subscription on the account. Inside the app, with this phone on, the others that may
   be on this phone are named with a way to turn them off: Samsung Internet web app rows
   (client samsung-app, 0128), any Samsung Internet row on the same push service however it
   was labelled, and rows saved before 0128 said which client made them that came from an
   Android phone on the same push service. Another app row ('twa') is never offered. The fan's own rows only: push_own
   (0106) lets a fan read and delete theirs and nobody else's. Before 0128 there is no client
   column, and the read is made again without it. */
function endpointHost(e) { try { return new URL(String(e)).hostname; } catch (_) { return ''; } }
async function otherSignups() {
  const P = window.EpinoiaPush;
  const mine = P && P.endpoint ? await P.endpoint() : '';
  if (!mine) return [];
  let res = await sb.from('push_subscriptions').select('id,endpoint,client,ua');
  if (res.error) res = await sb.from('push_subscriptions').select('id,endpoint,ua');
  if (res.error || !Array.isArray(res.data)) return [];
  const host = endpointHost(mine);
  /* any Samsung Internet row on the same push service counts, whatever it was labelled: a
     Samsung Internet tab saves 'tab', and so does its web app when the display-mode test fails */
  return res.data.filter(r => r && r.endpoint !== mine && r.client !== 'twa' &&
    (r.client === 'samsung-app' || (endpointHost(r.endpoint) === host && /Android/i.test(r.ua || '') &&
                                    (!r.client || /SamsungBrowser/i.test(r.ua || '')))));
}
/* THE OTHER SIDE OF IT, IN SAMSUNG INTERNET. Turning the others off from the app only deletes
   rows: the Samsung Internet web app keeps its subscription, and its profile page used to save
   it again on the next visit (sync), bringing every notification back twice. So in Samsung
   Internet, once the account has the Android app (a 'twa' row, 0128), this page does not save
   itself again and says why, with a button that unsubscribes this browser for good. Before
   0128 the client read fails and nothing changes. Read once per page. */
const samsungHere = () => { try { return /^android-samsung/.test(window.EpinoiaPush.help().platform); } catch (_) { return false; } };
let appOnAccount = null;
function accountHasApp() {
  if (!sb || inAndroidApp() || !samsungHere()) return Promise.resolve(false);
  if (!appOnAccount) {
    appOnAccount = Promise.resolve(sb.from('push_subscriptions').select('client'))
      .then(res => !res.error && Array.isArray(res.data) && res.data.some(r => r && r.client === 'twa'), () => false);
  }
  return appOnAccount;
}
async function paintDupes(st, app) {
  const box = $('#phoneDupes');
  if (!app) {
    if (st !== 'on' || !(await accountHasApp())) { box.classList.add('hide'); return; }
    box.textContent = '';
    box.append('Your account has the EPINOIΛ Android app. If it is on this phone, notifications come through it, and ' +
               'with them on here as well every notification arrives twice. ');
    const off = document.createElement('button');
    off.type = 'button'; off.className = 'ep-btn'; off.textContent = 'Turn off notifications here';
    off.style.marginTop = '8px'; off.style.display = 'block';
    off.onclick = () => phoneAction(off, 'Turning off…', () => window.EpinoiaPush.disable());
    box.appendChild(off);
    box.className = 'msg warn';
    return;
  }
  if (st !== 'on' || !sb) { box.classList.add('hide'); return; }
  const others = await otherSignups();
  box.textContent = '';
  if (!others.length) { box.classList.add('hide'); return; }
  const samsung = others.some(r => r.client === 'samsung-app' || /SamsungBrowser/i.test(r.ua || ''));
  box.append((others.length === 1 ? 'Your account has another notification sign-up from an Android phone'
                                  : 'Your account has ' + others.length + ' other notification sign-ups from Android phones') +
             (samsung ? ', including Samsung Internet' : '') +
             '. If they are on this phone, every notification arrives more than once. ');
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ep-btn'; b.textContent = 'Turn off the others';
  b.style.marginTop = '8px'; b.style.display = 'block';
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Turning off…';
    const { error } = await sb.from('push_subscriptions').delete().in('id', others.map(r => r.id));
    box.className = 'msg ' + (error ? 'err' : 'ok');
    box.textContent = error
      ? 'The others could not be turned off just now. Try again in a minute.'
      : 'Done: those sign-ups are off, and this app keeps its own. If you open Epinoia in Samsung Internet again, its profile page offers to turn notifications off there for good.';
  };
  box.appendChild(b);
  box.className = 'msg warn';
}
/* The check's findings (push.js check): a mark and a sentence per step, then what to
   do. Built from text nodes only; nothing the network said is parsed as markup. */
function paintCheck(r) {
  const box = $('#phoneCheck');
  box.textContent = '';
  box.classList.remove('hide');
  const list = document.createElement('ol');
  (r.steps || []).forEach(s => {
    const li = document.createElement('li');
    li.className = s.ok === true ? 'ok' : s.ok === false ? 'bad' : '';
    const mark = document.createElement('i');
    mark.textContent = s.ok === true ? '✓' : s.ok === false ? '✕' : '·';
    mark.setAttribute('aria-label', s.ok === true ? 'OK' : s.ok === false ? 'Problem' : 'Checking');
    const text = document.createElement('div');
    text.textContent = s.label;
    if (s.detail) { const d = document.createElement('small'); d.textContent = s.detail; text.appendChild(d); }
    li.append(mark, text);
    list.appendChild(li);
  });
  if (r.running) {
    const li = document.createElement('li');
    const mark = document.createElement('i'); mark.textContent = '·';
    const text = document.createElement('div');
    text.textContent = (r.steps || []).some(s => s.id === 'delivery') ? 'Waiting for the test to reach this phone…' : 'Checking…';
    li.append(mark, text);
    list.appendChild(li);
  }
  box.appendChild(list);
  if (r.advice && !r.running) {
    const adv = document.createElement('div');
    adv.className = 'adv ' + (r.ok ? 'ok' : 'bad');
    const b = document.createElement('b'); b.textContent = r.advice.title;
    adv.appendChild(b);
    if (r.advice.lines && r.advice.lines.length) {
      const ol = document.createElement('ol');
      r.advice.lines.forEach(line => { const li = document.createElement('li'); li.textContent = line; ol.appendChild(li); });
      adv.appendChild(ol);
    }
    /* in the Android app, the button into its own notification settings (push.js check) */
    if (r.advice.action) {
      const acts = document.createElement('div'); acts.className = 'phone-acts';
      acts.appendChild(settingsLink(r.advice.action));
      adv.appendChild(acts);
    }
    box.appendChild(adv);
  }
}
/* one action at a time; `run` is called synchronously so a permission prompt
   still has the tap behind it */
function phoneAction(btn, busyText, run) {
  if (phoneBusy) return;
  phoneBusy = true;
  const pending = run();
  const label = btn.textContent;
  const buttons = [...document.querySelectorAll('#phoneCard button')];
  buttons.forEach(b => { b.disabled = true; });
  btn.textContent = busyText;
  phoneSay('');
  /* resolves with the action's result once the card is usable again, so a caller can
     start the next action (the test after turning on) without finding it busy */
  return Promise.resolve(pending)
    .then(r => { if (r && r.message) phoneSay(r.message, r.ok ? 'ok' : 'err'); return r; },
          () => { phoneSay('Something went wrong. Reload the page and try again.', 'err'); return null; })
    .then(r => {
      buttons.forEach(b => { b.disabled = false; });
      btn.textContent = label;
      phoneBusy = false;
      return paintPhone().then(() => r, () => r);
    });
}
/* DID IT POP UP? The browser only knows it handed the test to the phone; a phone setting can
   still hide it, and nothing tells the page. So every test ends with the question, and a no
   gets this phone's own settings to change (push.js help) and another test straight away. */
function phoneButton(text, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = fn;
  return b;
}
function askSeen() {
  const box = $('#phoneCheck');
  box.textContent = '';
  box.classList.remove('hide');
  const adv = document.createElement('div'); adv.className = 'adv';
  const q = document.createElement('b'); q.textContent = 'Did a notification from Epinoia just pop up on this phone?';
  const acts = document.createElement('div'); acts.className = 'phone-acts';
  acts.append(phoneButton('Yes, it did', 'ep-btn pri', () => {
    box.classList.add('hide');
    phoneSay('Notifications work on this phone.', 'ok');
  }), phoneButton('No', 'ep-btn', showHidden));
  adv.append(q, acts);
  box.appendChild(adv);
}
function showHidden() {
  const P = window.EpinoiaPush;
  const box = $('#phoneCheck');
  box.textContent = '';
  const adv = document.createElement('div'); adv.className = 'adv bad';
  const t = document.createElement('b'); t.textContent = 'Your phone is hiding it';
  const p = document.createElement('div');
  p.textContent = 'It reached this phone, but a phone setting stopped it popping up. Change these, then send another:';
  const ol = document.createElement('ol');
  const h = (P && P.help && P.help()) || {};
  (h.steps || []).forEach(s => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
  const acts = document.createElement('div'); acts.className = 'phone-acts';
  acts.append(phoneButton('Send another test', 'ep-btn pri', () => $('#pushTest').click()));
  /* in the Android app, straight into its own notification settings */
  if (h.action) acts.append(settingsLink(h.action));
  if (!$('#nEmail').checked) {
    acts.append(phoneButton('Email me them as well', 'ep-btn', ev => {
      $('#nEmail').checked = true; save();
      ev.target.remove();
      phoneSay('Notifications will also come by email, so nothing is missed while the phone is sorted.', 'ok');
    }));
  }
  adv.append(t, p, ol, acts);
  box.appendChild(adv);
}
function wirePhone() {
  const P = window.EpinoiaPush;
  /* turning on is followed by a test at once: on is not done until one has been seen */
  $('#pushOn').onclick = () => phoneAction($('#pushOn'), 'Turning on…', () => P.enable().then(r => {
    if (r.ok) { $('#nPush').checked = true; prefs.notify_push = true; }
    return r;
  })).then(r => { if (r && r.ok) $('#pushTest').click(); });
  $('#pushTest').onclick = () => {
    $('#phoneCheck').classList.add('hide');
    return phoneAction($('#pushTest'), 'Sending…', () => P.test()).then(r => { if (r && r.ok) askSeen(); });
  };
  /* THE LOCKED-PHONE TEST (the Android app): the server waits 10 s before sending, the fan
     locks the phone meanwhile, and a heads-up on the lock screen is the proof that Game alerts
     pops up. The answer comes back once the phone is unlocked, and asks whether it popped up. */
  $('#pushTestLocked').onclick = () => {
    if (phoneBusy) return;
    $('#phoneCheck').classList.add('hide');
    const pending = phoneAction($('#pushTestLocked'), 'Lock the phone now…', () => P.test({ delay: 10 }));
    phoneSay(P.MESSAGES.testDelayed, 'ok');
    return pending.then(r => { if (r && r.ok) askSeen(); });
  };
  $('#pushOff').onclick = () => phoneAction($('#pushOff'), 'Turning off…', () => P.disable());
  $('#pushCheck').onclick = () => phoneAction($('#pushCheck'), 'Checking…', () => {
    paintCheck({ steps: [], running: true });
    return P.check(steps => paintCheck({ steps, running: true })).then(r => {
      paintCheck(r);
      return { ok: r.ok, message: '' };
    });
  });
  $('#installBtn').onclick = () => {
    const o = appOffer();
    if (o === 'android-app') { location.href = '../android/'; return; }
    if (o === 'ios-app') { location.href = '../ios/'; return; }
    if (window.epinoiaInstall) window.epinoiaInstall();
  };
  $('#pushSettings').addEventListener('click', settingsTapped);
  /* the account's channel: ticking it turns this browser on too (a tap, so the
     permission prompt can appear); unticking stops pushes on every device */
  $('#nPush').onchange = () => {
    const box = $('#nPush');
    if (!P || phoneBusy) { box.checked = !box.checked; return; }
    if (box.checked) {
      phoneAction($('#pushOn'), 'Turning on…', () => P.enable().then(r => {
        if (!r.ok && r.state !== 'on') box.checked = false;
        save();
        return r;
      }));
    } else {
      phoneAction($('#pushOff'), 'Turning off…', () => P.disable({ notifyPush: false }).then(r => {
        save();
        return { ok: true, message: 'Phone and desktop alerts are off everywhere.' };
      }));
    }
  };
  /* back from the browser's settings, or from installing: say where things stand now */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !phoneBusy) paintPhone(); });
  window.addEventListener('beforeinstallprompt', () => setTimeout(paintPhone, 0));
  askAppReleased();
}
/* the fixture reminders sit under their master switch */
function paintFixtureSubs() {
  const on = $('#wFixtures').checked;
  ['#wFix2d', '#wFix2h'].forEach(s => { $(s).disabled = !on; });
  ['#oFix2d', '#oFix2h'].forEach(s => { $(s).classList.toggle('off', !on); });
}

/* ----------------------------------------------------------------- recent --- */
async function paintRecent() {
  const host = $('#recent'); host.textContent = '';
  const { data } = await sb.from('notifications').select('id,kind,title,body,link,created_at,read_at').order('created_at', { ascending: false }).limit(40);
  if (!data || !data.length) { host.appendChild(el('div', 'note', 'Nothing yet. Follow a club and its next result lands here.')); return; }
  data.forEach(n => {
    const a = el('a', 'ntf' + (n.read_at ? '' : ' unread'));
    a.href = '../' + (n.link || '');
    a.append(el('span', 'k', n.kind), (() => { const d = el('div'); d.append(el('b', null, n.title), el('small', null, n.body || '')); return d; })(),
             el('time', null, new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
    host.appendChild(a);
  });
}

/* ------------------------------------------------------------ membership --- */
/* The fan's own memberships, from my_access (0117): each plan with where it
   applies and what happens next, what a league has given them, and the two
   buttons the join page's summary promises — Manage billing and Cancel
   membership. Both open Stripe's Customer Portal through the billing function
   (cancel:true deep-links straight to the cancel step), so no card detail and no
   Stripe script ever touches this page. Before 0117 is applied the RPC does not
   exist; the section then leaves quietly and the others close up their numbers.
   Nothing here reads or writes fan_prefs. */
const FEATURE_WORDS = { analytics: 'Advanced analytics', league: 'Members-only league' };
const BILLING_NEXT = '/epinoia/me/';

function renumberSections() {
  let n = 0;
  /* Scoped to the profile pane since the rail went in (it was `#body > section`).
     Your leagues numbers itself and has no section that hides. */
  document.querySelectorAll('#pane-profile > section.sec').forEach(sec => {
    if (sec.classList.contains('hide')) return;
    const idx = sec.querySelector('.ep-hdr .idx');
    if (idx) idx.textContent = String(++n).padStart(2, '0');
  });
}
function longDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function featureWords(fs) {
  return (Array.isArray(fs) ? fs : []).map(f => FEATURE_WORDS[f] || f).join(' and ') || 'Membership';
}
function memSay(text, kind, link) {
  const m = $('#memMsg');
  m.textContent = text || '';
  if (text && link) { m.append(' '); const a = el('a', null, link.text); a.href = link.href; m.appendChild(a); }
  m.className = 'msg ' + (kind || '');
  m.classList.toggle('hide', !text);
}

/* What happens next, in the words a fan uses. `live` is whether the plan still
   gives access; `cancellable` whether a cancel step makes sense (Stripe's cancel
   flow wants a subscription that is still running and not already ending).

   ENDING IS EITHER FLAG. A cancellation made in Stripe's portal on flexible
   billing — the default for every subscription Checkout creates — sets only
   cancel_at and leaves cancel_at_period_end false. Reading the one flag said
   "Renews on" about a membership that was ending and offered Cancel again, which
   Stripe then refuses. The end date is cancel_at when there is one. */
function subState(s) {
  const ending = !!s.cancel_at_period_end || !!s.cancel_at;
  const iso = ending ? (s.cancel_at || s.current_period_end) : s.current_period_end;
  const end = iso ? longDate(iso) : '';
  if (s.status === 'active' || s.status === 'trialing') {
    if (ending) {
      return { text: end ? 'Cancelled. Your access ends on ' + end + '.' : 'Cancelled. Your access ends at the end of this period.', cls: 'end', live: true, cancellable: false };
    }
    if (s.status === 'trialing') {
      return { text: end ? 'Free trial. The first payment is on ' + end + '.' : 'Free trial.', cls: '', live: true, cancellable: true };
    }
    return { text: end ? 'Renews on ' + end + '.' : 'Active.', cls: '', live: true, cancellable: true };
  }
  if (s.status === 'past_due' || s.status === 'unpaid' || s.status === 'incomplete') {
    return { text: 'Payment problem: update your card in Manage billing.' + (ending && end ? ' It is set to end on ' + end + '.' : ''),
             cls: 'bad', live: true, cancellable: s.status === 'past_due' && !ending };
  }
  if (s.status === 'paused') return { text: 'Paused.', cls: 'end', live: true, cancellable: false };
  return { text: 'Ended.', cls: 'end', live: false, cancellable: false };
}

async function openBilling(subscriptionId, cancel, button) {
  const buttons = [...document.querySelectorAll('#memberSec button')];
  const label = button.textContent;
  buttons.forEach(b => { b.disabled = true; });
  button.textContent = 'Opening…';
  memSay('');
  const done = () => { buttons.forEach(b => { b.disabled = false; }); button.textContent = label; };

  let token = '';
  try { const { data } = await sb.auth.getSession(); token = (data && data.session && data.session.access_token) || ''; } catch (_) { token = ''; }
  if (!token) {
    done();
    memSay('Your sign-in has expired. Sign in again and you will come straight back here.', 'err',
           { text: 'Sign in', href: '../signin/?next=' + encodeURIComponent(BILLING_NEXT) });
    return;
  }

  const body = { action: 'portal', cancel: !!cancel, next: BILLING_NEXT };
  if (subscriptionId) body.subscriptionId = subscriptionId;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
  let status = 0, data = {};
  try {
    const r = await fetch(CFG.supabaseUrl + '/functions/v1/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    });
    status = r.status;
    try { data = (await r.json()) || {}; } catch (_) { data = {}; }
  } catch (_) {
    status = 0;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (status === 200 && typeof data.url === 'string' && /^https:\/\//.test(data.url)) {
    location.assign(data.url);            // Stripe's page; it sends them back here
    return;
  }
  done();
  const why = typeof data.error === 'string' ? data.error.replace(/[.\s]+$/, '') : '';
  /* 503: Stripe is not switched on. A 404 without the function's own {error}:
     the function is not deployed. Either way nothing has changed. */
  if (status === 503 || (status === 404 && !why)) {
    memSay('Billing is not open yet, so there is nothing to change. Your membership is exactly as it was.', 'warn');
  } else if (status === 401) {
    memSay('Your sign-in has expired. Sign in again and you will come straight back here.', 'err',
           { text: 'Sign in', href: '../signin/?next=' + encodeURIComponent(BILLING_NEXT) });
  } else if (status === 0) {
    memSay('The billing page could not be reached. Check your connection and try again. Nothing has changed.', 'err');
  } else {
    memSay((cancel ? 'Cancelling' : 'Billing') + ' could not open: ' + (why || 'the payment service refused (' + status + ')') + '. Nothing has changed.', 'err');
  }
}

function billingButton(text, subscriptionId, cancel) {
  const b = el('button', 'ep-btn billing-btn', text);
  /* the iPhone app opens no payment pages (App Store guideline 3.1.1; kit/access.css says the same for paywalls) */
  if (document.documentElement.classList.contains('m-ios-app')) b.style.display = 'none';
  b.type = 'button';
  b.addEventListener('click', () => openBilling(subscriptionId, cancel, b));
  return b;
}

async function paintMembership() {
  const sec = $('#memberSec'), host = $('#mem');
  let res;
  try { res = await sb.rpc('my_access'); } catch (e) { res = { error: { message: String((e && e.message) || e) }, status: 0 }; }
  const err = res && res.error;
  if (err && (err.code === 'PGRST202' || res.status === 404)) {
    sec.classList.add('hide');            // 0117 not applied: no section at all
    renumberSections();
    return;
  }
  host.textContent = '';
  if (err || !res.data || typeof res.data !== 'object') {
    host.appendChild(el('p', 'mem-intro', 'Your membership could not be loaded just now. Reload the page to try again.'));
    const foot = el('div', 'mem-foot');
    const plans = el('a', 'ep-btn', 'See membership plans'); plans.href = '../join/';
    foot.appendChild(plans);
    host.appendChild(foot);
    return;
  }

  const mine = res.data;
  const subs = (Array.isArray(mine.subscriptions) ? mine.subscriptions : []).filter(Boolean);
  const now = Date.now();
  const grants = (Array.isArray(mine.grants) ? mine.grants : [])
    .filter(g => g && !(g.expires_at && new Date(g.expires_at).getTime() <= now));
  let anyLive = false;

  subs.forEach(s => {
    const st = subState(s);
    if (st.live) anyLive = true;
    const row = el('div', 'mem');
    const tx = el('div');
    tx.append(
      el('b', null, s.plan_name || 'Membership'),
      el('small', null, (s.league_id ? (s.league_name || 'One league') + ' only' : 'Every league') + ' · ' + featureWords(s.features)),
      el('span', 'st' + (st.cls ? ' ' + st.cls : ''), st.text));
    row.appendChild(tx);
    if (st.live) {
      const acts = el('div', 'mem-acts');
      acts.appendChild(billingButton('Manage billing', s.id, false));
      if (st.cancellable) acts.appendChild(billingButton('Cancel membership', s.id, true));
      row.appendChild(acts);
    }
    host.appendChild(row);
  });

  grants.forEach(g => {
    const row = el('div', 'mem');
    const tx = el('div');
    tx.append(
      el('b', null, featureWords(g.features)),
      el('small', null, 'Given by ' + (g.league_id ? (g.league_name || 'your league') : 'Epinoia') + (g.note ? ' · ' + g.note : '')),
      el('span', 'st', g.expires_at ? 'Until ' + longDate(g.expires_at) + '.' : 'No end date.'));
    row.appendChild(tx);
    host.appendChild(row);
  });

  if (!subs.length && !grants.length) {
    host.appendChild(el('p', 'mem-intro',
      'You are not a member. Box scores, tables and player pages are free for everyone. ' +
      'Membership adds the advanced analytics, and opens the leagues that keep their games for members.'));
  }

  const foot = el('div', 'mem-foot');
  /* receipts and card details stay reachable after a plan has ended; the
     function finds the right account from the most recent subscription */
  if (!anyLive && (subs.length || mine.has_customer)) {
    foot.appendChild(billingButton('Manage billing', subs.length ? subs[0].id : null, false));
  }
  const plans = el('a', 'ep-btn', subs.length || grants.length ? 'See all plans' : 'See membership plans');
  plans.href = '../join/';
  foot.appendChild(plans);
  host.appendChild(foot);
}

/* =========================================================== your leagues ===
   THREE WAYS AN ACCOUNT IS ATTACHED TO A LEAGUE, and they are different enough
   to be worth keeping apart: one you run, one you were let into, one you chose
   to follow. A merged list would answer "which leagues do I see?" and lose the
   only question anybody actually arrives with, which is "why do I see this one,
   and can I get rid of it?".

   NOTHING NEW IS NEEDED TO READ ANY OF IT. whoami already returns the leagues
   this account administers; league_guests is readable by the guest themselves
   (0139's guests_read); fan_prefs carries the follows (0133). And a private
   league's own row is visible to whoever was let in, so the embedded
   leagues(...) below resolves for exactly the people it should and returns
   nothing for anybody else — the same policy that keeps it off the front page.

   LEAVING IS THE POINT OF THE MIDDLE SECTION. A league admin can remove a guest
   from their console; this is the other side of that, and it is the only place
   somebody can get a private league they no longer want out of their account.
   0139's guests_leave policy allows exactly this row and no other.
   ============================================================================ */
let leaguesPainted = false;

/* status() writes into the notifications section, which is in the OTHER pane —
   an error reported there while this one is open is an error nobody sees. */
function oops(host, text) {
  const n = el('div', 'note', text);
  n.style.color = 'var(--flare)';
  host.appendChild(n);
}

/* Built on this page's own row (.pl: a name, a note, an action pushed right),
   not the admin console's .item/.nm/.mt — those classes do not exist here and
   the rows would have come out as three stacked unstyled divs. */
function leagueRow(l, note, action) {
  const r = el('div', 'pl');
  const b = el('b');
  const a = el('a', null, l.name);
  a.href = '../?l=' + encodeURIComponent(l.slug);
  a.style.color = l.colour_a || 'var(--lume)';
  a.style.textDecoration = 'none';
  b.appendChild(a);
  r.append(b, el('small', null, note));
  if (action) { action.style.marginLeft = 'auto'; r.appendChild(action); }
  return r;
}

async function paintMyLeagues() {
  if (leaguesPainted) return;
  leaguesPainted = true;

  /* ---- leagues you run ---- */
  const run = $('#runList'); run.textContent = 'Loading…';
  let who = null;
  try { who = (await sb.rpc('whoami')).data; } catch (_) { /* drawn as none */ }
  run.textContent = '';
  const mine = (who && who.leagues) || [];
  $('#runNote').textContent = who && who.is_platform_admin ? 'you administer the platform' : '';
  if (!mine.length) {
    run.appendChild(el('div', 'note',
      who && who.is_platform_admin
        ? 'You administer the platform, so every league is yours to run — they are in the platform console rather than listed here.'
        : 'You do not run a league. A league administrator is appointed by Epinoia or by whoever already runs the league.'));
  } else {
    mine.forEach(l => {
      const open = el('a', 'ep-chip', 'console');
      open.href = '../admin/'; open.style.textDecoration = 'none';
      run.appendChild(leagueRow(l, 'you are an administrator', open));
    });
  }

  /* ---- private leagues you were let into ---- */
  const priv = $('#privList'); priv.textContent = 'Loading…';
  let guests = [];
  try {
    const { data } = await sb.from('league_guests')
      .select('league_id,joined_at,leagues(id,slug,name,colour_a,visibility)')
      .eq('user_id', user.id);
    guests = (data || []).filter(g => g.leagues);
  } catch (_) { /* drawn as none */ }
  priv.textContent = '';
  if (!guests.length) {
    priv.appendChild(el('div', 'note',
      'None. A private league is not listed anywhere on Epinoia and does not appear in ' +
      'search — the only way into one is a link somebody sends you. Open a link and the ' +
      'league appears here.'));
  } else guests.forEach(g => {
    const l = g.leagues;
    /* An admin can also revoke this from their side, so say which it is rather
       than implying this is the only way it can end. */
    const leave = el('button', 'ep-chip', 'leave');
    leave.type = 'button';
    leave.addEventListener('click', async () => {
      if (!confirm('Leave ' + l.name + '?\n\nIt disappears from your account and you will ' +
                   'not be able to open it again without a new link.')) return;
      leave.disabled = true;
      const { error } = await sb.from('league_guests').delete()
        .eq('league_id', g.league_id).eq('user_id', user.id);
      if (error) { leave.disabled = false; return oops(priv, 'could not leave: ' + error.message); }
      leaguesPainted = false; paintMyLeagues();
    });
    priv.appendChild(leagueRow(l,
      'you were let in on ' + new Date(g.joined_at).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric' }) +
      (l.visibility === 'private' ? '' : ' — it is a public league now'), leave));
  });

  /* ---- leagues you follow ---- */
  const fol = $('#followList'); fol.textContent = 'Loading…';
  const ids = (prefs && prefs.fav_league_ids) || [];
  let followed = [];
  if (ids.length) {
    /* Read through the client, not api(), which sends the anon key alone: a
       league you follow can be a PRIVATE one you were let into, and anonymously
       its row does not exist. Same trap the scorer's picker had. */
    const { data } = await sb.from('leagues')
      .select('id,slug,name,colour_a').in('id', ids).order('name');
    followed = data || [];
  }
  fol.textContent = '';
  if (!followed.length) {
    fol.appendChild(el('div', 'note',
      'None yet. Following a league tells you about every game in it, including clubs that ' +
      'join later — press the bell on a league page.'));
  } else followed.forEach(l => {
    const off = el('button', 'ep-chip', 'unfollow');
    off.type = 'button';
    off.addEventListener('click', async () => {
      off.disabled = true;
      const keep = ids.filter(x => x !== l.id);
      const { data, error } = await sb.rpc('set_fan_prefs', { p: { fav_league_ids: keep } });
      if (error) { off.disabled = false; return oops(fol, 'not saved: ' + error.message); }
      prefs = Object.assign(prefs, data || {});
      leaguesPainted = false; paintMyLeagues();
    });
    fol.appendChild(leagueRow(l, 'every game in this league', off));
  });
}

/* The rail. The pane is drawn the first time it is opened rather than at boot:
   it is three more requests, and most visits to this page are about the bell. */
function wireTabs() {
  const panes = { profile: $('#pane-profile'), leagues: $('#pane-leagues') };
  document.querySelectorAll('.ep-tab[data-p]').forEach(tab => {
    tab.addEventListener('click', () => {
      const want = tab.dataset.p;
      document.querySelectorAll('.ep-tab[data-p]').forEach(t => {
        const on = t === tab;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.keys(panes).forEach(k => panes[k].classList.toggle('hide', k !== want));
      if (want === 'leagues') paintMyLeagues();
      /* so a reload, or a link sent to somebody, lands on the same pane */
      try { history.replaceState(null, '', want === 'leagues' ? '#leagues' : location.pathname); }
      catch (_) { /* a browser that refuses is not a reason to fail the click */ }
    });
  });
  if (location.hash === '#leagues') $('#tabLeagues').click();
}

/* ----------------------------------------------------------------- boot --- */
(async function boot() {
  sb = window.epinoiaClient && window.epinoiaClient();
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  if (!session) { $('#signedout').classList.remove('hide'); return; }
  user = session.user;
  $('#email').textContent = user.email || '';
  $('#nEmailTo').textContent = 'to ' + (user.email || 'the address you sign in with');
  $('#body').classList.remove('hide');
  /* not awaited: the membership read never holds up (or breaks) the rest */
  paintMembership().catch(() => { $('#memberSec').classList.add('hide'); renumberSections(); });

  const { data } = await sb.from('fan_prefs').select('*').maybeSingle();
  prefs = data || { theme: 'light', colour: '#93f2bf', fav_team_ids: [], fav_player_ids: [], notify_inapp: true, notify_email: false,
                    notify_push: false, want_results: true, want_players: true, want_fixtures: true, want_announcements: true,
                    want_fixture_2d: true, want_fixture_2h: true, want_lineups: true, want_player_games: true, want_halftime: true };
  if (!data) await sb.rpc('set_fan_prefs', { p: {} });

  $('#nInapp').checked = !!prefs.notify_inapp; $('#nEmail').checked = !!prefs.notify_email; $('#nPush').checked = !!prefs.notify_push;
  $('#wResults').checked = !!prefs.want_results; $('#wPlayers').checked = !!prefs.want_players;
  $('#wFixtures').checked = !!prefs.want_fixtures; $('#wAnn').checked = !!prefs.want_announcements;
  /* the v2 switches default on (0121), including on a row written before they existed */
  $('#wFix2d').checked = prefs.want_fixture_2d !== false; $('#wFix2h').checked = prefs.want_fixture_2h !== false;
  $('#wLineups').checked = prefs.want_lineups !== false; $('#wPlayerGames').checked = prefs.want_player_games !== false;
  $('#wHalftime').checked = prefs.want_halftime !== false;
  paintFixtureSubs();
  ['#nInapp', '#nEmail', '#wResults', '#wPlayers', '#wFixtures', '#wAnn',
   '#wFix2d', '#wFix2h', '#wLineups', '#wPlayerGames', '#wHalftime'].forEach(s => { $(s).onchange = () => { paintFixtureSubs(); save(); }; });
  wirePhone();
  /* not awaited: the card fills in while the rest of the page does. With
     notifications on, this browser's subscription is saved again under whoever is
     signed in now (push.js sync), which heals a rotated or inherited one. */
  /* Not in Samsung Internet once the account has the Android app (accountHasApp): saving
     it again is what brought back every notification twice. */
  paintPhone().then(async st => {
    if (st !== 'on' || !window.EpinoiaPush) return;
    if (await accountHasApp().catch(() => false)) return;
    window.EpinoiaPush.sync().catch(() => {});
  });
  applyTheme(prefs.theme === 'dark' ? 'dark' : 'light');
  $('#themeDark').onclick = () => { applyTheme('dark'); save(); };
  $('#themeLight').onclick = () => { applyTheme('light'); save(); };
  paintColour();
  $('#colour').oninput = () => { prefs.colour = $('#colour').value; paintColour(); save(); };
  $('#plq').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(() => search($('#plq').value.trim()), 250); };
  $('#readAll').onclick = async () => {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    paintRecent();
  };
  wireTabs();
  await paintLeagues();
  await Promise.all([paintTeams(), paintMine(), paintRecent()]);
})();
