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

/* ------------------------------------------------------------------ save --- */
function collect() {
  return {
    theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    colour: prefs.colour,
    fav_team_ids: prefs.fav_team_ids || [],
    fav_player_ids: prefs.fav_player_ids || [],
    notify_inapp: $('#nInapp').checked, notify_email: $('#nEmail').checked, notify_push: $('#nPush').checked,
    want_results: $('#wResults').checked, want_players: $('#wPlayers').checked,
    want_fixtures: $('#wFixtures').checked, want_announcements: $('#wAnn').checked
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

/* ----------------------------------------------------------------- push --- */
async function enablePush() {
  const note = $('#nPushNote');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { note.textContent = 'this browser cannot receive pushes'; return false; }
  const key = window.EPINOIA_VAPID;
  if (!key) { note.textContent = 'push is not configured on this site yet'; return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { note.textContent = 'permission was not given; allow notifications for this site and try again'; return false; }
  const reg = await navigator.serviceWorker.register('/epinoia/sw.js', { scope: '/epinoia/' });
  await navigator.serviceWorker.ready;
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='));
  const appKey = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: user.id, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200)
  }, { onConflict: 'endpoint' });
  if (error) { note.textContent = 'could not save this browser: ' + error.message; return false; }
  note.textContent = 'this browser will receive pushes';
  return true;
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/epinoia/');
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch (_) { /* nothing to undo */ }
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
  document.querySelectorAll('#body > section.sec').forEach(sec => {
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
  const b = el('button', 'ep-btn', text);
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
                    notify_push: false, want_results: true, want_players: true, want_fixtures: true, want_announcements: true };
  if (!data) await sb.rpc('set_fan_prefs', { p: {} });

  $('#nInapp').checked = !!prefs.notify_inapp; $('#nEmail').checked = !!prefs.notify_email; $('#nPush').checked = !!prefs.notify_push;
  $('#wResults').checked = !!prefs.want_results; $('#wPlayers').checked = !!prefs.want_players;
  $('#wFixtures').checked = !!prefs.want_fixtures; $('#wAnn').checked = !!prefs.want_announcements;
  ['#nInapp', '#nEmail', '#wResults', '#wPlayers', '#wFixtures', '#wAnn'].forEach(s => { $(s).onchange = save; });
  $('#nPush').onchange = async () => {
    if ($('#nPush').checked) { const ok = await enablePush(); if (!ok) $('#nPush').checked = false; }
    else await disablePush();
    save();
  };
  $('#installBtn').onclick = () => { if (window.epinoiaInstall) window.epinoiaInstall(); };
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
  await paintLeagues();
  await Promise.all([paintTeams(), paintMine(), paintRecent()]);
})();
