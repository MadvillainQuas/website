'use strict';
/* ============================================================================
   Your profile — a fan's side of Epinoia.

   Favourite clubs and players, a colour, light or dark, and how the platform should keep you
   posted. Everything saves as you change it (set_fan_prefs, 0106); the bell on every page and
   the notify function read the same row.
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

/* ----------------------------------------------------------------- boot --- */
(async function boot() {
  sb = window.epinoiaClient && window.epinoiaClient();
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  if (!session) { $('#signedout').classList.remove('hide'); return; }
  user = session.user;
  $('#email').textContent = user.email || '';
  $('#nEmailTo').textContent = 'to ' + (user.email || 'the address you sign in with');
  $('#body').classList.remove('hide');

  const { data } = await sb.from('fan_prefs').select('*').maybeSingle();
  prefs = data || { theme: 'dark', colour: '#93f2bf', fav_team_ids: [], fav_player_ids: [], notify_inapp: true, notify_email: false,
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
  applyTheme(prefs.theme);
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
