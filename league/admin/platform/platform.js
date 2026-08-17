'use strict';
/* ============================================================================
   THE PLATFORM CONSOLE.

   The league console (../admin.js) is one administrator acting inside one
   league. This is the other half: the person who runs EPINOIA, acting across
   all of them — accounts, leagues, clubs, moderation, keys, the audit trail
   and the site-wide switches.

   IT DECIDES WHAT TO RENDER, NEVER WHAT IS ALLOWED. Every call is an RPC that
   authorises its own caller in the database (migration 0044), so hiding this
   page from a non-admin is a courtesy and the refusal underneath it is the
   control. Type the address in without the role and every panel comes back
   empty with a permission error, which is the correct outcome and is what the
   migration's self-test asserts.
   ============================================================================ */

/* Never framed. A clickjacked "delete league" on this page is not a bug
   report, and GitHub Pages cannot send X-Frame-Options. */
if (window.top !== window.self) {
  try { window.top.location = window.self.location; } catch (_) {}
  document.documentElement.innerHTML = '';
  throw new Error('framed');
}

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

let sb = null, me = null, isAdmin = false;
let leagues = [];                     // cached for the scope pickers
const PAGE = 40;
let acctOffset = 0, acctTotal = 0, acctQuery = '';
let auOffset = 0, auTotal = 0, auAction = '';

function say(text, kind) {
  const m = $('#msg');
  m.textContent = text || '';
  m.className = 'msg ' + (kind || '');
  m.classList.toggle('hide', !text);
  if (text) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function oops(e, fallback) {
  if (!e) return say(fallback || 'Something went wrong.', 'err');
  const msg = e.message || String(e);
  if (e.code === '42501' || /permission denied|administrators only/i.test(msg))
    return say('Refused: platform administrators only.', 'err');
  if (e.code === 'PGRST202' || /schema cache/i.test(msg))
    return say('That function is not on the server yet — run `npx supabase db push`.', 'err');
  say(msg, 'err');
}

const fmtDate = s => s ? new Date(s).toLocaleDateString(undefined,
  { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const fmtWhen = s => s ? new Date(s).toLocaleString(undefined,
  { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '').slice(0, 40);

/* One place that calls an RPC and reports. Every panel goes through it, so a
   refusal reads the same wherever it happens. */
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) { oops(error); return null; }
  return data;
}

/* ------------------------------------------------------------------ boot --- */
async function boot() {
  sb = window.epinoiaClient && epinoiaClient();
  if (!sb) {
    $('#lockedWhy').textContent =
      'No Supabase key in config.js — the platform console needs one.';
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  me = session && session.user;
  sb.auth.onAuthStateChange((_e, s) => { me = s && s.user; gate(); });
  wire();
  gate();
}

async function gate() {
  $('#who').textContent = me ? me.email : '';
  $('#out').classList.toggle('hide', !me);

  if (!me) {
    isAdmin = false;
    $('#console').classList.add('hide');
    $('#locked').classList.add('on');
    $('#lockedWhy').textContent =
      'Sign in with the account that administers the platform. It is a magic ' +
      'link — there is no password to lose.';
    $('#signinRow').style.display = '';
    return;
  }

  const who = await rpc('whoami');
  isAdmin = !!(who && who.is_platform_admin);
  $('#signinRow').style.display = 'none';

  if (!isAdmin) {
    $('#console').classList.add('hide');
    $('#locked').classList.add('on');
    $('#lockedWhy').textContent =
      'This account is signed in but is not a platform administrator. ' +
      (who && (who.leagues || []).length
        ? 'It does administer a league — the league console is linked at the top right.'
        : 'It holds no administrative roles at all.');
    return;
  }

  $('#locked').classList.remove('on');
  $('#console').classList.remove('hide');
  say('');
  await Promise.all([loadOverview(), loadLeagues()]);
}

/* ------------------------------------------------------------------ tabs --- */
function wire() {
  document.querySelectorAll('.ep-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.ep-tab').forEach(x => x.classList.toggle('on', x === t));
      document.querySelectorAll('#console .pane')
        .forEach(p => p.classList.toggle('on', p.id === 'pane-' + t.dataset.p));
      /* Loaded on first sight rather than all at boot: the audit log and the
         account list are the two big queries here and most visits touch
         neither. */
      const load = { acct: loadAccounts, clubs: loadClubs, mod: loadModeration,
                     keys: loadKeys, audit: loadAudit, set: loadSettings };
      if (load[t.dataset.p]) load[t.dataset.p]();
    });
  });

  $('#send').addEventListener('click', sendLink);
  $('#email').addEventListener('keydown', e => { if (e.key === 'Enter') sendLink(); });
  $('#out').addEventListener('click', async () => { await sb.auth.signOut(); });

  $('#acctGo').addEventListener('click', () => { acctOffset = 0; loadAccounts(); });
  $('#acctQ').addEventListener('keydown', e => {
    if (e.key === 'Enter') { acctOffset = 0; loadAccounts(); } });
  $('#acctPrev').addEventListener('click', () => {
    acctOffset = Math.max(0, acctOffset - PAGE); loadAccounts(); });
  $('#acctNext').addEventListener('click', () => {
    if (acctOffset + PAGE < acctTotal) { acctOffset += PAGE; loadAccounts(); } });
  $('#grGo').addEventListener('click', grant);
  $('#grRole').addEventListener('change', fillScopePicker);

  $('#nlName').addEventListener('input', () => {
    if (!$('#nlSlug').dataset.touched) $('#nlSlug').value = slugify($('#nlName').value);
  });
  $('#nlSlug').addEventListener('input', () => { $('#nlSlug').dataset.touched = '1'; });
  $('#nlGo').addEventListener('click', newLeague);

  $('#clubGo').addEventListener('click', loadClubs);
  $('#clubQ').addEventListener('keydown', e => { if (e.key === 'Enter') loadClubs(); });

  $('#msgGo').addEventListener('click', loadModeration);

  $('#auGo').addEventListener('click', () => { auOffset = 0; loadAudit(); });
  $('#auAction').addEventListener('change', () => {
    auAction = $('#auAction').value; auOffset = 0; loadAudit(); });
  $('#auPrev').addEventListener('click', () => {
    auOffset = Math.max(0, auOffset - 100); loadAudit(); });
  $('#auNext').addEventListener('click', () => {
    if (auOffset + 100 < auTotal) { auOffset += 100; loadAudit(); } });

  $('#recompute').addEventListener('click', async e => {
    e.target.disabled = true;
    const r = await rpc('platform_recompute_all');
    e.target.disabled = false;
    if (r) { say(r, 'ok'); loadOverview(); }
  });
  $('#pruneGo').addEventListener('click', async () => {
    const d = Number($('#pruneDays').value || 730);
    if (!confirm('Remove audit entries older than ' + d + ' days?')) return;
    const r = await rpc('platform_prune_audit', { p_days: d });
    if (r) { say(r, 'ok'); loadAudit(); }
  });
}

async function sendLink() {
  const v = ($('#email').value || '').trim();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) return say('That address does not look right.', 'err');
  $('#send').disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email: v, options: { emailRedirectTo: location.href } });
  $('#send').disabled = false;
  if (error) return oops(error);
  say('Link sent. It is single use and expires in an hour.', 'ok');
}

/* -------------------------------------------------------------- overview --- */
const TILES = [
  ['leagues', 'leagues'], ['teams', 'clubs'], ['players', 'players'],
  ['games', 'games'], ['games_live', 'live now'], ['events', 'logged events'],
  ['accounts', 'accounts'], ['accounts_active_30d', 'active 30d'],
  ['platform_admins', 'platform admins'], ['league_admins', 'league admins'],
  ['team_managers', 'team managers'], ['statisticians', 'statisticians'],
  ['media_pending', 'photos queued'], ['messages_open', 'open messages'],
  ['api_keys', 'live api keys'], ['api_calls_24h', 'api calls 24h'],
  ['feeds', 'partner feeds'], ['audit_30d', 'audited actions 30d']
];

async function loadOverview() {
  const o = await rpc('platform_overview');
  if (!o) return;
  const host = $('#tiles'); host.textContent = '';

  TILES.forEach(([k, label]) => {
    const t = el('div', 'tile');
    const n = el('div', 'n', String(o[k] ?? 0));
    /* Amber is not decoration: it marks the tiles that mean somebody has to do
       something. A zero in either is the resting state. */
    if ((k === 'media_pending' || k === 'messages_open') && (o[k] || 0) > 0) n.classList.add('warn');
    else if (!o[k]) n.classList.add('dim');
    t.append(n, el('div', 'k', label));
    if (k === 'players' && o.minors) t.appendChild(el('div', 'sub', o.minors + ' under 18'));
    if (k === 'games') t.appendChild(el('div', 'sub', (o.games_final || 0) + ' final'));
    if (k === 'accounts' && o.accounts_7d) t.appendChild(el('div', 'sub', '+' + o.accounts_7d + ' this week'));
    if (k === 'events' && o.events_24h) t.appendChild(el('div', 'sub', o.events_24h + ' in 24h'));
    host.appendChild(t);
  });

  const att = $('#attention'); att.textContent = '';
  const items = [];
  if (o.media_pending) items.push(o.media_pending + ' photograph' +
    (o.media_pending === 1 ? '' : 's') + ' waiting for approval.');
  if (o.messages_open) items.push(o.messages_open + ' message' +
    (o.messages_open === 1 ? '' : 's') + ' nobody has marked handled.');
  if (o.messages_failed) items.push(o.messages_failed + ' message' +
    (o.messages_failed === 1 ? '' : 's') + ' failed to deliver in the last 30 days — ' +
    'check RESEND_API_KEY and CONTACT_TO in the Edge Function secrets.');
  if (o.platform_admins < 2) items.push(
    'There is only one platform administrator. If that account is lost there is ' +
    'no way back in through the site — grant a second one.');
  if (!items.length) return;
  items.forEach(t => att.appendChild(el('div', 'note', t)));
}

/* -------------------------------------------------------------- accounts --- */
async function loadAccounts() {
  acctQuery = ($('#acctQ').value || '').trim();
  const rows = await rpc('platform_accounts',
    { p_search: acctQuery, p_limit: PAGE, p_offset: acctOffset });
  if (!rows) return;
  acctTotal = rows.length ? Number(rows[0].total) : 0;

  const body = $('#acctBody'); body.textContent = '';
  if (!rows.length) {
    const tr = body.insertRow();
    const td = tr.insertCell(); td.colSpan = 5;
    td.appendChild(el('div', 'empty', acctQuery
      ? 'No account matches “' + acctQuery + '”.'
      : 'No accounts yet.'));
  }

  rows.forEach(r => {
    const tr = body.insertRow();

    const c0 = tr.insertCell();
    c0.appendChild(el('div', 'nm', r.email));
    const bits = [r.provider || 'email'];
    if (!r.confirmed) bits.push('unconfirmed');
    if (r.banned) bits.push('DISABLED');
    if (r.display_name) bits.unshift(r.display_name);
    c0.appendChild(el('div', 'mt', bits.join(' · ')));

    const c1 = tr.insertCell();
    const roles = r.roles || [];
    if (!roles.length) c1.appendChild(el('span', 'mt', 'none'));
    roles.forEach(m => {
      const cls = { platform_admin: 'pa', league_admin: 'la',
                    team_manager: 'tm', statistician: 'st' }[m.role] || '';
      const label = m.role.replace('_', ' ') +
                    (m.scope === 'platform' ? '' : ' · ' + (m.label || '?'));
      const p = el('span', 'pill x ' + cls, label);
      p.title = 'click to revoke';
      p.addEventListener('click', () => revoke(m, r.email, label));
      c1.appendChild(p);
    });

    tr.insertCell().appendChild(el('span', 'mt', fmtDate(r.created_at)));
    tr.insertCell().appendChild(el('span', 'mt', fmtDate(r.last_sign_in_at)));

    const ac = tr.insertCell(); ac.className = 'ac';
    if (r.user_id !== (me && me.id)) {
      const ban = el('button', 'ep-btn mini', r.banned ? 'enable' : 'disable');
      ban.type = 'button';
      ban.addEventListener('click', async () => {
        const r2 = await rpc('platform_set_account_banned',
          { p_user: r.user_id, p_banned: !r.banned });
        if (r2) { say(r2 + ' — ' + r.email, 'ok'); loadAccounts(); }
      });
      const del = el('button', 'ep-btn mini danger', 'delete');
      del.type = 'button';
      del.addEventListener('click', () => deleteAccount(r));
      ac.append(ban, del);
    } else {
      ac.appendChild(el('span', 'mt', 'you'));
    }
  });

  const from = acctTotal ? acctOffset + 1 : 0;
  const to = Math.min(acctOffset + PAGE, acctTotal);
  $('#acctPage').textContent = from + '–' + to + ' of ' + acctTotal;
  $('#acctCount').textContent = acctTotal + ' account' + (acctTotal === 1 ? '' : 's');
  $('#acctPrev').disabled = acctOffset === 0;
  $('#acctNext').disabled = acctOffset + PAGE >= acctTotal;
}

async function deleteAccount(r) {
  /* Typing the address is the confirmation, and the DATABASE checks it — this
     prompt only saves a round trip. A dialog with an OK button is one
     mis-click, and there is no undo on the other side of this. */
  const typed = prompt(
    'Deleting ' + r.email + ' removes the account and every role it holds.\n' +
    'Games it scored and rows it created are kept, with the name detached.\n\n' +
    'Type the address exactly to confirm:');
  if (typed == null) return;
  const out = await rpc('platform_delete_account',
    { p_user: r.user_id, p_confirm_email: typed });
  if (out) { say(out, 'ok'); loadAccounts(); loadOverview(); }
}

async function revoke(m, email, label) {
  if (!confirm('Revoke ' + label + ' from ' + email + '?')) return;
  const out = await rpc('revoke_role', { p_membership: m.membership_id });
  if (out) { say(out + ' — ' + label, 'ok'); loadAccounts(); loadOverview(); }
}

function fillScopePicker() {
  const role = $('#grRole').value;
  const sel = $('#grScope'); sel.textContent = '';
  if (role === 'platform_admin') {
    sel.appendChild(new Option('the whole platform', ''));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  if (role === 'league_admin') {
    leagues.forEach(l => sel.appendChild(new Option(l.name, l.id)));
    if (!leagues.length) sel.appendChild(new Option('no leagues yet', ''));
    return;
  }
  /* team_manager and statistician are both team-scoped in the schema. The club
     list can be long, so it is loaded lazily rather than on every boot. */
  sel.appendChild(new Option('loading clubs…', ''));
  rpc('platform_teams', { p_search: '' }).then(rows => {
    sel.textContent = '';
    (rows || []).forEach(t => sel.appendChild(
      new Option(t.name + ' (' + t.league_name + ')', t.id)));
    if (!rows || !rows.length) sel.appendChild(new Option('no clubs yet', ''));
  });
}

async function grant() {
  const email = ($('#grEmail').value || '').trim();
  const role = $('#grRole').value;
  const scopeId = $('#grScope').value || null;
  if (!email) return say('Enter the address of the account to grant.', 'err');
  const scopeType = role === 'platform_admin' ? 'platform'
                  : role === 'league_admin' ? 'league' : 'team';
  if (scopeType !== 'platform' && !scopeId)
    return say('Choose what that role applies to.', 'err');
  if (role === 'platform_admin' &&
      !confirm('A platform admin can do everything on this page, to every ' +
               'league, including removing you.\n\nGrant it to ' + email + '?')) return;

  const out = await rpc('grant_role', {
    p_email: email, p_role: role, p_scope_type: scopeType, p_scope_id: scopeId });
  if (out) { say(out, /^no account/.test(out) ? 'err' : 'ok'); $('#grEmail').value = '';
             loadAccounts(); loadOverview(); }
}

/* --------------------------------------------------------------- leagues --- */
async function loadLeagues() {
  const rows = await rpc('platform_leagues');
  if (!rows) return;
  leagues = rows.map(l => ({ id: l.id, name: l.name, slug: l.slug }));
  fillScopePicker();

  const host = $('#lgList'); host.textContent = '';
  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No leagues yet. Create the first one below.'));
    return;
  }

  rows.forEach(l => {
    const box = el('div', 'sw-cell');
    box.style.border = '1px solid var(--rule)';
    box.style.marginBottom = '9px';

    const head = el('div', 'row');
    head.style.marginBottom = '4px';
    const name = el('input', 'ep-input grow'); name.value = l.name; name.maxLength = 80;
    const slug = el('input', 'ep-input'); slug.value = l.slug; slug.style.flex = '0 0 190px';
    const ca = el('input', 'ep-input'); ca.type = 'color'; ca.value = l.colour_a;
    ca.style.cssText = 'flex:0 0 46px;padding:3px';
    const cb = el('input', 'ep-input'); cb.type = 'color'; cb.value = l.colour_b;
    cb.style.cssText = 'flex:0 0 46px;padding:3px';
    head.append(name, slug, ca, cb);
    box.appendChild(head);

    const opts = el('div', 'row');
    opts.style.marginBottom = '4px';
    const live = el('label', 'sw'); const liveIn = el('input'); liveIn.type = 'checkbox';
    liveIn.checked = l.public_live; live.append(liveIn, document.createTextNode(' live scores public'));
    const youth = el('label', 'sw'); const youthIn = el('input'); youthIn.type = 'checkbox';
    youthIn.checked = l.youth_protected;
    youth.append(youthIn, document.createTextNode(' under-18 protection'));

    const stats = el('span', 'mt', [
      l.n_teams + ' clubs', l.n_players + ' players', l.n_games + ' games',
      l.n_admins + ' admins', l.n_keys + ' keys'
    ].join(' · '));
    stats.style.marginLeft = 'auto';
    opts.append(live, youth, stats);
    box.appendChild(opts);

    const acts = el('div', 'row');
    acts.style.marginBottom = '0';
    const view = el('a', 'ep-btn mini', 'open league');
    view.href = '../../?l=' + encodeURIComponent(l.slug);
    const save = el('button', 'ep-btn mini pri', 'save'); save.type = 'button';
    save.addEventListener('click', async () => {
      const out = await rpc('platform_update_league', {
        p_league: l.id, p_name: name.value, p_slug: slug.value,
        p_colour_a: ca.value, p_colour_b: cb.value,
        p_public_live: liveIn.checked, p_youth_protected: youthIn.checked });
      if (out) { say('Saved ' + name.value, 'ok'); loadLeagues(); }
    });
    const del = el('button', 'ep-btn mini danger', 'delete league'); del.type = 'button';
    del.addEventListener('click', () => deleteLeague(l));
    const sp = el('span'); sp.style.marginLeft = 'auto';
    acts.append(view, save, sp, del);
    box.appendChild(acts);

    host.appendChild(box);
  });
}

async function deleteLeague(l) {
  const typed = prompt(
    'Deleting ' + l.name + ' removes its seasons, competitions, ' + l.n_games +
    ' games and every event in them. This cannot be undone.\n\n' +
    'Its ' + l.n_teams + ' clubs are NOT deleted — they are left without a ' +
    'league and can be moved to another one.\n\n' +
    'Type the slug (' + l.slug + ') to confirm:');
  if (typed == null) return;
  const out = await rpc('platform_delete_league',
    { p_league: l.id, p_confirm_slug: typed });
  if (out) { say(out, 'ok'); loadLeagues(); loadOverview(); }
}

async function newLeague() {
  const name = ($('#nlName').value || '').trim();
  const slug = ($('#nlSlug').value || '').trim() || slugify(name);
  if (!name || !slug) return say('A league needs a name.', 'err');
  const out = await rpc('create_league', {
    p_name: name, p_slug: slug,
    p_colour_a: '#93f2bf', p_colour_b: '#8ff5ff',
    p_public_live: $('#nlLive').checked, p_youth_protected: $('#nlYouth').checked });
  if (out) {
    say('Created ' + name, 'ok');
    $('#nlName').value = ''; $('#nlSlug').value = ''; delete $('#nlSlug').dataset.touched;
    loadLeagues(); loadOverview();
  }
}

/* ----------------------------------------------------------------- clubs --- */
async function loadClubs() {
  const rows = await rpc('platform_teams', { p_search: ($('#clubQ').value || '').trim() });
  if (!rows) return;
  const body = $('#clubBody'); body.textContent = '';
  $('#clubCount').textContent = rows.length + ' club' + (rows.length === 1 ? '' : 's');

  if (!rows.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 6;
    td.appendChild(el('div', 'empty', 'No club matches that.'));
    return;
  }

  rows.forEach(t => {
    const tr = body.insertRow();
    const c0 = tr.insertCell();
    c0.appendChild(el('div', 'nm', t.name));
    c0.appendChild(el('div', 'mt', t.slug));

    const c1 = tr.insertCell();
    const sel = el('select', 'ep-input');
    sel.style.cssText = 'font-size:11px;padding:4px 6px';
    sel.appendChild(new Option('— no league —', ''));
    leagues.forEach(l => sel.appendChild(new Option(l.name, l.id)));
    sel.value = t.league_id || '';
    if (!t.league_id) sel.style.borderColor = 'var(--amber)';
    sel.addEventListener('change', async () => {
      const out = await rpc('platform_move_team',
        { p_team: t.id, p_league: sel.value || null });
      if (out) { say(t.name + ' moved.', 'ok'); loadClubs(); loadLeagues(); }
      else sel.value = t.league_id || '';
    });
    c1.appendChild(sel);

    [t.n_players, t.n_games, t.n_managers].forEach(v => {
      const c = tr.insertCell(); c.className = 'num'; c.textContent = v;
    });

    const ac = tr.insertCell(); ac.className = 'ac';
    const view = el('a', 'ep-btn mini', 'open');
    const lg = leagues.find(l => l.id === t.league_id);
    view.href = '../../t/?l=' + encodeURIComponent(lg ? lg.slug : '') +
                '&t=' + encodeURIComponent(t.slug);
    ac.appendChild(view);
  });
}

/* ------------------------------------------------------------ moderation --- */
async function loadModeration() {
  const media = await rpc('platform_media_queue', { p_limit: 100 });
  const host = $('#mediaList'); host.textContent = '';
  if (!media || !media.length) {
    host.appendChild(el('div', 'empty', 'Nothing waiting. Every uploaded photograph has been dealt with.'));
  } else {
    media.forEach(m => {
      const row = el('div', 'row');
      row.style.borderBottom = '1px solid var(--rule)';
      row.style.paddingBottom = '9px';
      const t = el('div');
      t.appendChild(el('div', 'nm', m.owner_name + ' · ' + m.kind));
      t.appendChild(el('div', 'mt', m.owner_type + ' · ' + (m.uploader || '—') +
        ' · ' + fmtWhen(m.created_at) +
        (m.bytes ? ' · ' + Math.round(m.bytes / 1024) + ' KB' : '')));
      const sp = el('span'); sp.style.marginLeft = 'auto';
      const ok = el('button', 'ep-btn mini pri', 'approve'); ok.type = 'button';
      ok.addEventListener('click', async () => {
        const r = await rpc('approve_media', { p_media: m.id });
        if (r !== null) { say('Approved.', 'ok'); loadModeration(); loadOverview(); }
      });
      const no = el('button', 'ep-btn mini danger', 'reject'); no.type = 'button';
      no.addEventListener('click', async () => {
        const why = prompt('Why is it rejected? (optional, shown to the uploader)') ;
        if (why === null) return;
        const r = await rpc('reject_media', { p_media: m.id, p_reason: why });
        if (r !== null) { say('Rejected.', 'ok'); loadModeration(); loadOverview(); }
      });
      row.append(t, sp, ok, no);
      host.appendChild(row);
    });
  }

  const msgs = await rpc('platform_messages',
    { p_open_only: $('#msgOpen').checked, p_limit: 100 });
  const mh = $('#msgList'); mh.textContent = '';
  if (!msgs || !msgs.length) {
    mh.appendChild(el('div', 'empty', $('#msgOpen').checked
      ? 'No unhandled messages.' : 'No messages at all yet.'));
    return;
  }
  msgs.forEach(m => {
    const box = el('div', 'sw-cell');
    box.style.cssText = 'border:1px solid var(--rule);margin-bottom:9px';
    const head = el('div', 'row'); head.style.marginBottom = '2px';
    head.appendChild(el('div', 'nm', (m.subject || '(no subject)')));
    const sp = el('span'); sp.style.marginLeft = 'auto';
    const mark = el('button', 'ep-btn mini', m.handled_at ? 'reopen' : 'mark handled');
    mark.type = 'button';
    mark.addEventListener('click', async () => {
      const r = await rpc('platform_handle_message',
        { p_id: m.id, p_done: !m.handled_at });
      if (r) { say(r, 'ok'); loadModeration(); loadOverview(); }
    });
    head.append(sp, mark);
    box.appendChild(head);
    box.appendChild(el('div', 'mt', m.name + ' <' + m.email + '> · ' +
      fmtWhen(m.created_at) + ' · ' + m.league_name +
      (m.delivered ? '' : ' · NOT DELIVERED' + (m.delivery_note ? ': ' + m.delivery_note : ''))));
    box.appendChild(el('div', 'body-x', m.body));
    mh.appendChild(box);
  });
}

/* ------------------------------------------------------------------ keys --- */
async function loadKeys() {
  const rows = await rpc('platform_api_keys');
  if (!rows) return;
  const body = $('#keyBody'); body.textContent = '';
  if (!rows.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 6;
    td.appendChild(el('div', 'empty',
      'No API keys issued. They are created per league in the league console.'));
    return;
  }
  rows.forEach(k => {
    const tr = body.insertRow();
    if (k.revoked_at) tr.style.opacity = '.5';
    const c0 = tr.insertCell();
    c0.appendChild(el('div', 'nm', k.name));
    c0.appendChild(el('div', 'mt', k.prefix + '…' +
      (k.revoked_at ? ' · revoked ' + fmtDate(k.revoked_at) : '')));
    tr.insertCell().appendChild(el('span', 'mt', k.league_name));
    const l = tr.insertCell(); l.className = 'num'; l.textContent = k.rate_limit;
    const u = tr.insertCell(); u.className = 'num'; u.textContent = k.calls_24h;
    tr.insertCell().appendChild(el('span', 'mt', fmtWhen(k.last_used_at)));
    const ac = tr.insertCell(); ac.className = 'ac';
    if (!k.revoked_at) {
      const rev = el('button', 'ep-btn mini danger', 'revoke'); rev.type = 'button';
      rev.addEventListener('click', async () => {
        if (!confirm('Revoke “' + k.name + '”? Anything using it stops immediately.')) return;
        const r = await rpc('revoke_api_key', { p_key_id: k.id });
        if (r) { say('Revoked.', 'ok'); loadKeys(); loadOverview(); }
      });
      ac.appendChild(rev);
    }
  });
}

/* ----------------------------------------------------------------- audit --- */
async function loadAudit() {
  if (!$('#auAction').options.length) {
    const acts = await rpc('platform_audit_actions');
    const sel = $('#auAction');
    sel.appendChild(new Option('every action', ''));
    (acts || []).forEach(a => sel.appendChild(
      new Option(a.action + ' (' + a.n + ')', a.action)));
  }

  const rows = await rpc('platform_audit',
    { p_action: auAction, p_limit: 100, p_offset: auOffset });
  if (!rows) return;
  auTotal = rows.length ? Number(rows[0].total) : 0;

  const body = $('#auBody'); body.textContent = '';
  if (!rows.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 5;
    td.appendChild(el('div', 'empty', 'Nothing logged for that filter.'));
  }
  rows.forEach(a => {
    const tr = body.insertRow();
    tr.insertCell().appendChild(el('span', 'mt', fmtWhen(a.created_at)));
    tr.insertCell().appendChild(el('span', 'mt', a.actor_email));
    tr.insertCell().appendChild(el('span', 'nm', a.action));
    tr.insertCell().appendChild(el('span', 'mt',
      a.subject + (a.subject_id ? ' · ' + String(a.subject_id).slice(0, 8) : '')));
    const d = a.detail && Object.keys(a.detail).length
      ? JSON.stringify(a.detail) : '';
    tr.insertCell().appendChild(el('div', 'det', d));
  });

  const from = auTotal ? auOffset + 1 : 0;
  $('#auPage').textContent = from + '–' + Math.min(auOffset + 100, auTotal) + ' of ' + auTotal;
  $('#auCount').textContent = auTotal + ' entr' + (auTotal === 1 ? 'y' : 'ies');
  $('#auPrev').disabled = auOffset === 0;
  $('#auNext').disabled = auOffset + 100 >= auTotal;
}

/* -------------------------------------------------------------- settings --- */
const SETTING_TEXT = {
  site_name:       'The name in the tab title and the wordmark alt text.',
  banner:          'Shown across the top of every public page. Empty means no banner.',
  banner_level:    'info, warn or down — decides the banner’s colour.',
  signups_open:    'Off refuses new accounts. Existing ones still sign in.',
  public_scoring:  'Off hides Score a Game from the splash for everybody.',
  training_open:   'Off closes the training game the splash offers without a login.',
  merch_enabled:   'Off hides the merchandise section on every league page.',
  feeds_enabled:   'Off stops every partner feed delivering. Nothing is lost; it resumes.',
  contact_enabled: 'Off hides the contact form and refuses submissions.'
};

async function loadSettings() {
  const rows = await rpc('platform_settings_all');
  if (!rows) return;
  const host = $('#setGrid'); host.textContent = '';

  rows.forEach(s => {
    const cell = el('div', 'sw-cell');
    const head = el('div', 'row'); head.style.marginBottom = '2px';
    head.appendChild(el('span', 'k', s.key.replace(/_/g, ' ')));
    if (s.is_public) {
      const p = el('span', 'pill la', 'public'); p.style.marginLeft = 'auto';
      head.appendChild(p);
    }
    cell.appendChild(head);
    cell.appendChild(el('div', 'd', SETTING_TEXT[s.key] || ''));

    const v = s.value;
    /* The value is jsonb, so the control follows the TYPE that is stored
       rather than a per-key table that would drift from the database. */
    if (typeof v === 'boolean') {
      const lab = el('label', 'sw');
      const box = el('input'); box.type = 'checkbox'; box.checked = v;
      box.addEventListener('change', () => save(s.key, box.checked));
      lab.append(box, document.createTextNode(v ? ' on' : ' off'));
      cell.appendChild(lab);
    } else {
      const row = el('div', 'row'); row.style.margin = '4px 0 0';
      const inp = el('input', 'ep-input grow');
      inp.value = typeof v === 'string' ? v : JSON.stringify(v);
      const btn = el('button', 'ep-btn mini', 'save'); btn.type = 'button';
      btn.addEventListener('click', () => save(s.key, inp.value));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(s.key, inp.value); });
      row.append(inp, btn);
      cell.appendChild(row);
    }
    host.appendChild(cell);
  });

  async function save(key, value) {
    const out = await rpc('platform_set_setting', { p_key: key, p_value: value });
    if (out) { say('Saved ' + key.replace(/_/g, ' ') + '.', 'ok'); loadSettings(); }
  }
}

boot();
