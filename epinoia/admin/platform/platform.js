'use strict';
/* ============================================================================
   THE PLATFORM CONSOLE.

   The league console (../admin.js) is one administrator acting inside one
   league. This is the other half: the person who runs EPINOIA, acting across
   all of them — accounts, leagues, the organisations above them, clubs,
   moderation, the privacy queue, keys, the audit trail and the site-wide
   switches.

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
let hashTabOpened = false;            // a #tab link has been followed this visit
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
  /* THE DATABASE ALREADY SAID WHY. This turned every permission error into
     "Refused: platform administrators only", which is actively misleading
     when the person reading it IS a platform admin — and it hid which of the
     dozen calls on the page had failed. Half of these refusals are not about
     platform rights at all: approving an image needs the file moved first,
     granting a role needs the league, publishing needs consent recorded.

     The server's own sentence is the useful one, so it is shown, with the
     code beside it because that is what makes it searchable. */
  if (e.code === '42501' || /permission denied|administrators only/i.test(msg)) {
    return say('Refused: ' + msg + (e.code ? ' [' + e.code + ']' : ''), 'err');
  }
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
  /* A link to one tab opens it, once per visit (gate runs again on every auth
     event): the privacy reminders in the bell link to #priv (migration 0120). */
  if (!hashTabOpened) {
    const asked = (location.hash || '').replace(/^#/, '');
    const tab = asked && [...document.querySelectorAll('.ep-tab')].find(t => t.dataset.p === asked);
    if (tab) { hashTabOpened = true; tab.click(); }
  }
  await Promise.all([loadOverview(), loadLeagues(), loadPrivacyAttention()]);
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
                     keys: loadKeys, audit: loadAudit, set: loadSettings,
                     plans: loadPlans, orgs: loadOrgs, priv: loadPrivacy };
      if (load[t.dataset.p]) load[t.dataset.p]();
    });
  });

  $('#send').addEventListener('click', sendLink);
  $('#email').addEventListener('keydown', e => { if (e.key === 'Enter') sendLink(); });
  $('#out').addEventListener('click', async () => {
    await (window.epinoiaSignOut ? window.epinoiaSignOut(sb) : sb.auth.signOut());
  });

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

  $('#plNew').addEventListener('click', () => openPlanForm(null));

  $('#orgNewKind').addEventListener('change', () => { if (orgs) fillOrgNew(); });
  $('#orgNewName').addEventListener('input', () => {
    if (!$('#orgNewSlug').dataset.touched) $('#orgNewSlug').value = orgSlugify($('#orgNewName').value);
  });
  $('#orgNewSlug').addEventListener('input', () => { $('#orgNewSlug').dataset.touched = '1'; });
  $('#orgNewGo').addEventListener('click', newOrg);
  $('#orgQ').addEventListener('input', () => { if (orgs) drawOrgTree(); });
  $('#adGo').addEventListener('click', proposeClubs);

  $('#prTenant').addEventListener('change', () => {
    privTenant = $('#prTenant').value; privOpenId = null; $('#prDetail').textContent = ''; loadPrivacy(); });
  $('#prClosed').addEventListener('change', () => { if (priv) drawPrivList(); });
  $('#prGo').addEventListener('click', loadPrivacy);

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
  /* A LEAGUE APPOINTS ITS OWN OFFICIALS AND ITS OWN WRITERS.

     league_admin, news_writer and a league-wide statistician all scope to a
     league. The statistician is the one that changed: it was offered as a CLUB
     role only, which does not describe the job — a league sends a table
     official to whichever fixture needs covering, and tying one to a single
     club meant a second grant for every other ground. The club-scoped variant
     is still available below for a club's own scorer. */
  if (role === 'league_admin' || role === 'news_writer' ||
      role === 'statistician_league') {
    leagues.forEach(l => sel.appendChild(new Option(l.name, l.id)));
    if (!leagues.length) sel.appendChild(new Option('no leagues yet', ''));
    return;
  }
  /* team_manager and a club's own statistician are team-scoped. The club list
     can be long, so it is loaded lazily rather than on every boot. */
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
  const picked = $('#grRole').value;
  const scopeId = $('#grScope').value || null;
  if (!email) return say('Enter the address of the account to grant.', 'err');

  /* THE NEWS WRITER IS NOT A MEMBERSHIP. It lives in league_writers with its
     own grant function, because writing for a league is not a degree of
     administering one — a club's press officer should be able to publish a
     match report without also being able to reschedule fixtures. It was
     therefore missing from this page entirely and could only be granted from
     inside a league's own console. */
  if (picked === 'news_writer') {
    if (!scopeId) return say('Choose the league they write for.', 'err');
    const out = await rpc('grant_league_writer', { p_league: scopeId, p_email: email });
    if (out) { say(out, /^no account/.test(out) ? 'err' : 'ok');
               $('#grEmail').value = ''; loadAccounts(); }
    return;
  }

  /* Two statistician entries, one role: the picker distinguishes the SCOPE,
     which is the only thing that differs. */
  const role = picked === 'statistician_league' ? 'statistician' : picked;
  const scopeType = role === 'platform_admin' ? 'platform'
                  : (picked === 'league_admin' || picked === 'statistician_league')
                    ? 'league' : 'team';
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
        ok.disabled = true;
        /* THE FILE MOVES FIRST. approve_media stopped moving it two migrations
           ago — only the Storage API can move an object, a SQL update of
           storage.objects left the bytes behind — so the league console does
           this and this console never learned to. Approving here marked the
           row approved and left the image in the pending bucket, so every
           crest approved from the platform page 404'd on the public site.

           "already exists" counts as done: the file is where it needs to be. */
        const mv = await sb.storage.from('media-pending')
          .move(m.storage_path, m.storage_path, { destinationBucket: 'media-public' });
        if (mv.error && !/exists/i.test(mv.error.message || '')) {
          ok.disabled = false;
          return say('Could not publish the file: ' + mv.error.message, 'err');
        }
        const r = await rpc('approve_media', { p_media: m.id });
        ok.disabled = false;
        if (r !== null) { say('Approved.', 'ok'); loadModeration(); loadOverview(); }
      });
      const no = el('button', 'ep-btn mini danger', 'reject'); no.type = 'button';
      no.addEventListener('click', async () => {
        const why = prompt('Why is it rejected? (optional, shown to the uploader)') ;
        if (why === null) return;
        no.disabled = true;
        /* THE DECISION IS RECORDED FIRST, THE BYTES GO AFTER.

           reject_media used to delete the object itself, which Supabase now
           refuses from any role — "Direct deletion from storage tables is not
           allowed" — so every rejection failed, and the console reported it as
           a permission problem with the ACCOUNT rather than with the
           statement. Removing an object is the Storage API's job, so it
           happens here.

           This order is deliberate. A rejected image sits in media-pending,
           which is private and served to nobody, so the row is the urgent
           half: a storage hiccup must not be able to leave a photograph
           un-rejected. Cleanup failing is worth saying, not worth undoing. */
        const r = await rpc('reject_media', { p_media: m.id, p_reason: why });
        if (r === null) { no.disabled = false; return; }
        const gone = await Promise.all([
          sb.storage.from('media-pending').remove([m.storage_path]),
          sb.storage.from('media-public').remove([m.storage_path])
        ]);
        const stuck = gone.map(x => x && x.error)
          .filter(e => e && !/not found|does not exist/i.test(e.message || ''));
        no.disabled = false;
        say(stuck.length
          ? 'Rejected, but the file could not be removed: ' + stuck[0].message
          : 'Rejected.', stuck.length ? 'err' : 'ok');
        loadModeration(); loadOverview();
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

/* ----------------------------------------------------------------- plans --- */
/* MEMBERSHIPS ACROSS THE PLATFORM (docs/memberships.md). One read,
   platform_access_admin(), and five things drawn from it: the master switch,
   the analytics default, Epinoia's own plans, every league's access and
   analytics override, and the totals.

   THE MASTER SWITCH (memberships_enabled, shipped off). While it is off the
   database gates nothing: every league is visible and the analytics are free,
   whatever is configured below. Everything below can still be set up, and shows
   what WILL apply — platform_access_admin() reports the configured analytics
   default, not the effective one — so the words here say "when memberships are
   on" rather than "straight away" while it is off. It is written through
   platform_set_setting, the same audited setter the default uses.

   The plan form is not built here. It is the same form the league console
   uses (../access-ui.js), because the rules in it are the same wherever a plan
   is written — pennies from pounds, the shape of a Stripe price id — and two
   copies of a price parser is how a penny goes missing. The SAVE stays here,
   so a refusal reads the way every other refusal on this page does. */
let plans = null;

const PLAN_MISSING = e => !!e && (e.code === 'PGRST202' ||
  /schema cache|could not find the function/i.test(e.message || ''));
const planPriced = p => p.has_price != null ? !!p.has_price : !!p.stripe_price_id;
const planMoney = p => window.EpinoiaAccessUI
  ? window.EpinoiaAccessUI.money(p.price_pennies, p.currency) + ' ' + window.EpinoiaAccessUI.per(p.interval)
  : String(p.price_pennies) + 'p / ' + p.interval;
const planFeatures = list => window.EpinoiaAccessUI
  ? window.EpinoiaAccessUI.featureWords(list) : (list || []).join(' + ');

/* The void RPCs (archive, fee) answer null on success, which rpc() above
   cannot tell from a failure — so these report through the error instead. */
async function wrote(call) {
  const { error } = await call;
  if (error) { oops(error); return false; }
  return true;
}

async function loadPlans() {
  const { data, error } = await sb.rpc('platform_access_admin');
  if (error) {
    const missing = PLAN_MISSING(error);
    $('#plMissing').classList.toggle('hide', !missing);
    $('#plWrap').classList.toggle('hide', missing);
    if (!missing) oops(error);
    return;
  }
  $('#plMissing').classList.add('hide');
  $('#plWrap').classList.remove('hide');
  const d = data || {};
  plans = {
    /* false is off. A server older than the switch leaves the key out, and
       that server gates by the league settings alone — which is "on" — so a
       missing key reads as on */
    membershipsEnabled: d.memberships_enabled !== false,
    analyticsDefault: d.analytics_default === 'members' ? 'members' : 'free',
    plans: d.plans || [],
    leagues: d.leagues || [],
    totals: d.totals || {}
  };
  drawMasterSwitch();
  drawPlanTiles();
  drawAnalyticsDefault();
  drawPlatformPlans();
  drawLeagueAccess();
  drawLeaguePlans();
}

/* platform plans somebody could actually buy today: active, priced, analytics */
const buyablePlatformPlans = () => plans.plans.filter(p => !p.league_id &&
  p.active !== false && planPriced(p) && (p.features || []).includes('analytics'));

/* "Alpha, Beta and 3 more" — for a confirm that has to say who it affects */
const someNames = (list, max = 8) => list.slice(0, max).map(l => l.name).join(', ') +
  (list.length > max ? ' and ' + (list.length - max) + ' more' : '');
const leagueCount = n => n + ' league' + (n === 1 ? '' : 's');

function drawMasterSwitch() {
  const host = $('#plSwitch'); host.textContent = '';
  const on = plans.membershipsEnabled;
  const closed = plans.leagues.filter(l => l.access_mode === 'members');
  const inherit = plans.leagues.filter(l => (l.analytics_access || 'inherit') === 'inherit');
  const memberAnalytics = plans.leagues.filter(l => l.analytics_access === 'members');
  const defaultMembers = plans.analyticsDefault === 'members';
  const buyable = buyablePlatformPlans();

  const box = el('div', 'ms' + (on ? ' on' : ''));
  const head = el('div', 'ms-h');
  head.append(el('span', 'ms-k', 'Memberships:'), el('span', 'ms-v', on ? 'on' : 'off'));
  box.appendChild(head);

  box.appendChild(el('p', 'ms-d', on
    ? 'Enforced across the platform. Members-only leagues hide what they play from ' +
      'anyone who is not a member, given access or staff, and the analytics follow ' +
      'the settings below.'
    : 'Nothing is gated anywhere: every league is open to everyone and the advanced ' +
      'analytics are free, whatever is set below or in a league’s console. Leagues ' +
      'and plans can be set up now; it all applies once memberships are switched on. ' +
      'Switch on last, once a plan can be bought and payments are live.'));

  /* what applies now (on), or what would apply (off) */
  const ul = el('ul');
  ul.appendChild(el('li', null, leagueCount(closed.length) + ' set to members only' +
    (closed.length ? ' (' + someNames(closed) + ')' : '') + '.'));
  ul.appendChild(el('li', null, 'Analytics by default: ' +
    (defaultMembers ? 'members only, in ' + leagueCount(inherit.length) + ' on inherit.' : 'free.')));
  if (memberAnalytics.length) {
    ul.appendChild(el('li', null, leagueCount(memberAnalytics.length) +
      ' with the analytics set to members only by Epinoia (' + someNames(memberAnalytics) + ').'));
  }
  box.appendChild(ul);

  const row = el('div', 'row');
  const btn = el('button', 'ep-btn' + (on ? '' : ' pri'),
    on ? 'switch memberships off' : 'switch memberships on');
  btn.type = 'button';
  row.appendChild(btn);
  box.appendChild(row);
  host.appendChild(box);

  btn.addEventListener('click', async () => {
    const value = !on;
    const gatedAnalytics = defaultMembers || memberAnalytics.length > 0;
    const q = value
      ? 'Switch memberships ON for the whole platform?\n\n' +
        'Everything configured starts being enforced, straight away:\n' +
        '• ' + leagueCount(closed.length) + ' set to members only' +
        (closed.length ? ' (' + someNames(closed) + ') will hide their results, box scores, live ' +
          'games, statistics, standings, awards, news and video from anyone who is not a ' +
          'member, given access, or the league’s staff.' : ': no league is closed yet.') + '\n' +
        '• The analytics default is ' + (defaultMembers
          ? 'MEMBERS ONLY: ' + leagueCount(inherit.length) + ' on inherit will show the advanced ' +
            'analytics only to fans with an analytics plan, and a teaser to everyone else.'
          : 'free: the analytics stay free in every league on inherit.') + '\n' +
        (memberAnalytics.length ? '• ' + leagueCount(memberAnalytics.length) +
          ' with members-only analytics set by Epinoia lock them too.\n' : '') +
        (gatedAnalytics && !buyable.length ? '\nNO PLATFORM PLAN CAN BE BOUGHT YET: fans would ' +
          'be shown a teaser with nothing to buy.\n' : '') +
        '\nSwitch on only once a plan can be bought and payments are live.'
      : 'Switch memberships OFF for the whole platform?\n\n' +
        'Everything opens straight away: every league’s results, box scores and ' +
        'statistics are visible to everyone, and the advanced analytics are free everywhere.\n\n' +
        'Every setting is kept — ' + leagueCount(closed.length) + ' stay set to members only, the ' +
        'analytics default stays ' + (defaultMembers ? 'members only' : 'free') + ', plans and ' +
        'grants stay as they are — and applies again when memberships are switched back on.\n\n' +
        'People paying keep paying until they cancel: decide in Stripe whether to pause, ' +
        'cancel or refund them.';
    if (!confirm(q)) return;
    btn.disabled = true;
    const out = await rpc('platform_set_setting', { p_key: 'memberships_enabled', p_value: value });
    btn.disabled = false;
    if (!out) return;
    say(value
      ? 'Memberships are on. Members-only leagues and the analytics settings are enforced from now.'
      : 'Memberships are off. Every league is open and the analytics are free; the settings are kept.', 'ok');
    loadPlans();
  });
}

function drawPlanTiles() {
  const t = plans.totals;
  const host = $('#plTiles'); host.textContent = '';
  [
    [t.active_subscriptions, 'paying members', ''],
    [t.past_due, 'payment failing', 'warn'],
    [t.grants, 'complimentary', ''],
    [plans.leagues.filter(l => l.access_mode === 'members').length, 'members-only leagues', ''],
    [buyablePlatformPlans().length, 'platform plans on sale', '']
  ].forEach(([v, label, tone]) => {
    const n = Number(v || 0);
    const tile = el('div', 'tile');
    const num = el('div', 'n', String(n));
    if (n && tone) num.classList.add(tone);
    else if (!n) num.classList.add('dim');
    tile.append(num, el('div', 'k', label));
    host.appendChild(tile);
  });
}

function drawAnalyticsDefault() {
  const host = $('#plDefault'); host.textContent = '';
  const cur = plans.analyticsDefault;
  const on = plans.membershipsEnabled;
  const inherit = plans.leagues.filter(l => (l.analytics_access || 'inherit') === 'inherit');
  const buyable = buyablePlatformPlans();
  /* while memberships are off a change here applies later, not now */
  const when = on ? 'straight away' : 'once memberships are switched on';

  host.appendChild(el('p', 'lead',
    'Whether the advanced analytics — the events splits, zone shot charts, the game ' +
    'flow, connections and events tabs, and the full WOWY screen — need a plan. It ' +
    'applies to every league set to inherit: ' + inherit.length + ' of ' +
    plans.leagues.length + ' right now. It is set to ' + (cur === 'members' ? 'members only' : 'free') +
    (on ? '.' : ', but memberships are switched off, so the analytics are free everywhere until ' +
      'they are switched on.') +
    ' The analytics are drawn in the browser, so members only hides the ' +
    'analysis, not the play-by-play it is built from.'));

  const choice = el('div', 'ax-choice');
  const radio = (value, title, words) => {
    const lab = el('label');
    const r = el('input'); r.type = 'radio'; r.name = 'plDefault'; r.value = value;
    r.checked = cur === value;
    const txt = el('span', null, title);
    txt.appendChild(el('small', null, words));
    lab.append(r, txt);
    choice.appendChild(lab);
    return r;
  };
  radio('free', 'Free', 'Every fan sees the advanced analytics in every league on inherit.');
  const members = radio('members', 'Members',
    'Fans need a plan that includes analytics. Everyone else sees a short teaser in ' +
    'place of each one. Each league’s own staff still see everything.');
  host.appendChild(choice);

  if (!buyable.length) {
    host.appendChild(el('div', 'note bad', cur === 'members'
      ? 'The analytics are members only and no platform plan can be bought: none is ' +
        'on sale with a Stripe price. Fans are shown a teaser with nothing to buy.'
      : 'No platform plan can be bought yet. Create one with a Stripe price below ' +
        'before switching to members, or fans get a teaser with nothing to buy.'));
  }

  const row = el('div', 'row');
  const save = el('button', 'ep-btn pri', 'save default'); save.type = 'button';
  row.appendChild(save);
  host.appendChild(row);

  save.addEventListener('click', async () => {
    const value = members.checked ? 'members' : 'free';
    if (value === cur) return say('The default is already ' + value + '. Nothing changed.', 'ok');
    const names = inherit.slice(0, 8).map(l => l.name).join(', ') +
      (inherit.length > 8 ? ' and ' + (inherit.length - 8) + ' more' : '');
    const q = value === 'members'
      ? 'Make the advanced analytics members only by default?\n\n' +
        inherit.length + ' league' + (inherit.length === 1 ? '' : 's') + ' on inherit' +
        (names ? ' (' + names + ')' : '') + ' will show the events splits, zone shot ' +
        'charts, game flow, connections and events tabs, and the full WOWY only to fans ' +
        'with an analytics plan and to each league’s staff. Everyone else sees a teaser ' +
        'instead, ' + when + '.\n\nLeagues set to free stay free.' +
        (buyable.length ? '' : '\n\nNO PLATFORM PLAN CAN BE BOUGHT YET: fans would be ' +
          'shown a teaser with nothing to buy.')
      : 'Make the advanced analytics free by default?\n\n' + inherit.length + ' league' +
        (inherit.length === 1 ? '' : 's') + ' on inherit ' +
        (on ? 'show them to everyone again, straight away'
            : 'will keep showing them to everyone when memberships are switched on') +
        '. People paying for analytics keep paying until they cancel: ' +
        'decide in Stripe whether to cancel or refund them.';
    if (!confirm(q)) return;
    save.disabled = true;
    const out = await rpc('platform_set_setting', { p_key: 'analytics_access', p_value: value });
    save.disabled = false;
    if (!out) return;
    say((value === 'members'
      ? 'The advanced analytics are now members only in every league on inherit.'
      : 'The advanced analytics are now free in every league on inherit.') +
      (on ? '' : ' Memberships are switched off, so this applies once they are switched on.'), 'ok');
    loadPlans();
  });
}

function openPlanForm(plan) {
  const host = $('#plForm'); host.textContent = '';
  const A = window.EpinoiaAccessUI;
  if (!A) return say('access-ui.js did not load, so plans cannot be edited. Reload the page.', 'err');
  const form = A.planForm({
    plan, leagueId: null, features: ['analytics'], seller: 'platform', say,
    cancel: () => { host.textContent = ''; },
    save: async payload => {
      payload.league_id = null;
      payload.seller = 'platform';
      payload.features = ['analytics'];
      const id = await rpc('save_access_plan', { p: payload });
      if (!id) return false;
      host.textContent = '';
      say(payload.id
        ? '“' + payload.name + '” saved.' + (payload.active ? '' : ' It is not on sale.')
        : '“' + payload.name + '” created.' +
          (payload.stripe_price_id ? '' : ' Add its Stripe price id to put it on sale.'), 'ok');
      loadPlans();
      return true;
    }
  });
  host.appendChild(form);
  form.focusFirst();
  form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function planStateWords(p) {
  if (p.active === false) return 'off sale';
  if (!planPriced(p)) return 'no Stripe price — cannot be bought';
  return 'on sale';
}

function drawPlatformPlans() {
  const host = $('#plList'); host.textContent = '';
  const rows = plans.plans.filter(p => !p.league_id);
  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No platform plans yet.'));
    return;
  }
  const wrap = el('div', 'scroll');
  const t = el('table', 'tbl');
  const hr = t.createTHead().insertRow();
  ['Plan', 'Price', 'Stripe price', 'State', ''].forEach(h => hr.appendChild(el('th', null, h)));
  const body = t.createTBody();
  rows.forEach(p => {
    const tr = body.insertRow();
    if (p.active === false) tr.style.opacity = '.55';
    const c0 = tr.insertCell();
    c0.appendChild(el('div', 'nm', p.name));
    c0.appendChild(el('div', 'mt', 'unlocks ' + planFeatures(p.features) +
      ' · order ' + (p.sort || 0) + (p.blurb ? ' · ' + p.blurb : '')));
    tr.insertCell().appendChild(el('span', 'mt', planMoney(p)));
    tr.insertCell().appendChild(el('span', 'mt', p.stripe_price_id || '—'));
    tr.insertCell().appendChild(el('span', 'pill' + (p.active === false ? '' :
      planPriced(p) ? ' la' : ' pa'), planStateWords(p)));
    const ac = tr.insertCell(); ac.className = 'ac';
    const edit = el('button', 'ep-btn mini', 'edit'); edit.type = 'button';
    edit.addEventListener('click', () => openPlanForm(p));
    ac.appendChild(edit);
    if (p.active !== false) {
      const arch = el('button', 'ep-btn mini danger', 'take off sale'); arch.type = 'button';
      arch.addEventListener('click', async () => {
        const buyable = buyablePlatformPlans();
        const last = plans.analyticsDefault === 'members' && buyable.length === 1 &&
          buyable[0].id === p.id;
        if (!confirm('Take “' + p.name + '” off sale?\n\nNobody new can buy it. People ' +
                     'who already pay for it keep it until they cancel.' +
                     (last ? '\n\nIt is the last platform plan on sale and the analytics are ' +
                      'members only: fans will be shown a teaser with nothing to buy.' : ''))) return;
        arch.disabled = true;
        const done = await wrote(sb.rpc('archive_access_plan', { p_plan: p.id }));
        arch.disabled = false;
        if (!done) return;
        say('“' + p.name + '” is off sale. People who already pay for it keep it.', 'ok');
        loadPlans();
      });
      ac.appendChild(arch);
    }
  });
  wrap.appendChild(t);
  host.appendChild(wrap);
}

function drawLeagueAccess() {
  const body = $('#plLeagues'); body.textContent = '';
  if (!plans.leagues.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 6;
    td.appendChild(el('div', 'empty', 'No leagues yet.'));
    return;
  }
  plans.leagues.forEach(l => {
    const tr = body.insertRow();
    const c0 = tr.insertCell();
    c0.appendChild(el('div', 'nm', l.name));
    c0.appendChild(el('div', 'mt', l.slug));

    const c1 = tr.insertCell();
    const membersOnly = l.access_mode === 'members';
    c1.appendChild(el('span', 'pill' + (membersOnly ? ' pa' : ''), membersOnly ? 'members only' : 'open'));
    if (membersOnly) {
      c1.appendChild(el('div', 'mt', l.fixtures_public === false ? 'fixtures private' : 'fixtures public'));
      if (!plans.membershipsEnabled) c1.appendChild(el('div', 'mt', 'not enforced: memberships are off'));
    }

    const c2 = tr.insertCell();
    const sel = el('select', 'ep-input');
    [['inherit', 'inherit (' + plans.analyticsDefault + ')'], ['free', 'free'], ['members', 'members']]
      .forEach(([v, label]) => sel.appendChild(new Option(label, v)));
    const was = l.analytics_access || 'inherit';
    sel.value = was;
    sel.addEventListener('change', async () => {
      const mode = sel.value;
      const effective = mode === 'inherit' ? plans.analyticsDefault : mode;
      const wasEffective = was === 'inherit' ? plans.analyticsDefault : was;
      if (effective === 'members' && wasEffective !== 'members' &&
          !confirm('Make the advanced analytics in ' + l.name + ' members only?\n\n' +
                   'Fans without an analytics plan see a teaser in their place, ' +
                   (plans.membershipsEnabled ? 'straight away.' : 'once memberships are switched on.') +
                   (buyablePlatformPlans().length ? '' : '\n\nNo platform plan can be bought yet.'))) {
        sel.value = was; return;
      }
      sel.disabled = true;
      const out = await rpc('platform_set_league_analytics', { p_league: l.id, p_mode: mode });
      sel.disabled = false;
      if (!out) { sel.value = was; return; }
      say('Analytics in ' + l.name + (mode === 'inherit'
        ? ' now follow the platform default (' + plans.analyticsDefault + ').'
        : ' are now ' + (mode === 'members' ? 'members only' : 'free') +
          ', whatever the platform default.'), 'ok');
      loadPlans();
    });
    c2.appendChild(sel);

    const c3 = tr.insertCell(); c3.className = 'num'; c3.textContent = Number(l.active_members || 0);
    const c4 = tr.insertCell(); c4.className = 'num';
    c4.textContent = Array.isArray(l.plans) ? l.plans.length : Number(l.plans || 0);

    /* platform_access_admin() carries each league's fee_percent, already
       defaulted to 10 for a league that has never had one set, so the box
       shows the fee that applies now — an empty box read as "no fee". The
       placeholder only matters against a server older than that. */
    const c5 = tr.insertCell();
    const wrap = el('div', 'fee');
    const fee = el('input', 'ep-input');
    fee.type = 'number'; fee.min = '0'; fee.max = '100'; fee.step = '0.5';
    fee.placeholder = '10';
    const feeNow = l.fee_percent != null && isFinite(Number(l.fee_percent)) ? Number(l.fee_percent) : null;
    if (feeNow != null) fee.value = String(feeNow);
    fee.setAttribute('aria-label', 'Epinoia’s fee in ' + l.name + ', percent');
    const go = el('button', 'ep-btn mini', 'save'); go.type = 'button';
    go.addEventListener('click', async () => {
      const n = Number(fee.value);
      if (fee.value === '' || !isFinite(n) || n < 0 || n > 100) {
        return say('A fee is a percentage from 0 to 100.', 'err');
      }
      go.disabled = true;
      const done = await wrote(sb.rpc('platform_set_league_fee', { p_league: l.id, p_fee: n }));
      go.disabled = false;
      if (!done) return;
      say('Epinoia’s fee in ' + l.name + ' is now ' + n + '%. It applies to checkouts ' +
          'from now on; existing subscriptions keep the fee they started with.', 'ok');
      loadPlans();
    });
    wrap.append(fee, go);
    c5.appendChild(wrap);
  });
}

function drawLeaguePlans() {
  const host = $('#plLeaguePlans'); host.textContent = '';
  const rows = plans.plans.filter(p => p.league_id);
  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No league sells a plan of its own yet.'));
    return;
  }
  const wrap = el('div', 'scroll');
  const t = el('table', 'tbl');
  const hr = t.createTHead().insertRow();
  ['League', 'Plan', 'Price', 'Sold by', 'State'].forEach(h => hr.appendChild(el('th', null, h)));
  const body = t.createTBody();
  rows.forEach(p => {
    const tr = body.insertRow();
    if (p.active === false) tr.style.opacity = '.55';
    tr.insertCell().appendChild(el('span', 'nm', p.league_name || '—'));
    const c1 = tr.insertCell();
    c1.appendChild(el('div', 'nm', p.name));
    c1.appendChild(el('div', 'mt', 'unlocks ' + planFeatures(p.features)));
    tr.insertCell().appendChild(el('span', 'mt', planMoney(p)));
    tr.insertCell().appendChild(el('span', 'mt',
      p.seller === 'league' ? 'the league' : 'Epinoia'));
    tr.insertCell().appendChild(el('span', 'pill' + (p.active === false ? '' :
      planPriced(p) ? ' la' : ' pa'), planStateWords(p)));
  });
  wrap.appendChild(t);
  host.appendChild(wrap);
}

/* --------------------------------------------------------- organisations --- */
/* THE ORGANISATION TREE (migration 0119; docs/replacement/foundations.md
   sections 3.1, 3.2, 4 and 9). National bodies, regions, local league bodies
   (associations), clubs, schools and partners, and what hangs on them: who runs
   each league, which club or school each team belongs to with its age group and
   gender, and each club's affiliations and accreditation.

   One read, organisation_admin(), draws the whole tree; opening an organisation
   reads it again with that id for its detail. NOTHING HERE GRANTS ANYBODY
   ANYTHING yet (organisation roles are 0123).

   THE RULES ARE THE DATABASE'S. Which kind sits under which, that nothing leaves
   or joins a tenant, what an age group or a season label looks like: the pickers
   below only offer what it will accept, so a refusal is rare, and when one comes
   it is shown in the database's own words through rpc(). ORG_PARENT_KINDS is a
   copy of org_kind_may_parent for the pickers, never a check. */
let orgs = null;          // organisation_admin() as last read, with an index by id
let orgOpenId = null;     // the organisation whose detail card is drawn
let adoptFor = null;      // { league, parent } the drawn proposal was made for

const ORG_KINDS = { national_body: 'national body', region: 'region', association: 'association',
                    club: 'club', school: 'school', partner: 'partner' };
const ORG_PARENT_KINDS = {
  national_body: [null], region: ['national_body'], association: [null, 'national_body', 'region'],
  club: ['national_body', 'region', 'association'], school: ['national_body', 'region', 'association'],
  partner: ['national_body']
};
const ORGANISER_KINDS = ['national_body', 'region', 'association', 'partner'];
const CLUB_KINDS = ['club', 'school'];
const AFFILIATING_KINDS = ['association', 'club', 'school', 'partner'];
const AFFILIATED_TO_KINDS = ['national_body', 'region', 'association'];
const ORG_STATUSES = ['pending', 'active', 'suspended', 'lapsed', 'dissolved', 'merged'];
const ORG_DEAD = ['dissolved', 'merged'];
const AFF_KINDS = { governing_body: 'governing body (annual affiliation)', league_member: 'league member',
                    season_invite: 'season invite' };
const AFF_STATUSES = ['pending', 'active', 'lapsed', 'suspended', 'refused', 'withdrawn'];
const ACCREDITATION = { none: 'none', level_1: 'Level 1', level_2: 'Level 2' };
const AGE_GROUPS = [''].concat(Array.from({ length: 16 }, (_, i) => 'U' + (i + 8)), ['senior', 'masters', 'open']);
const TEAM_GENDERS = ['', 'men', 'women', 'boys', 'girls', 'mixed', 'open'];
const ADOPT_SKIPPED = {
  not_a_team: 'not a team', not_in_league: 'no longer in this league',
  already_linked: 'already belongs to a club', name_length: 'the name must be 2 to 120 characters',
  bad_slug: 'the address is not valid', slug_taken: 'the address belongs to something that is not a club in this tenant'
};

/* The address the database would make from a name (org_slug_from), so the
   create form shows it before it is saved. */
const orgSlugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
const orgIndented = o => '  '.repeat(o.depth || 0) + o.name + ' (' + (ORG_KINDS[o.kind] || o.kind) + ')';
const orgTrail = o => (o.path || []).slice(0, -1).map(id => orgs.byId[id] ? orgs.byId[id].name : '?').join(' › ');
/* The season a date falls in, written 2026/27: BE's seasons turn on 1 September. */
const seasonOf = iso => {
  const d = iso ? new Date(iso + 'T12:00:00') : new Date();
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return y + '/' + String((y + 1) % 100).padStart(2, '0');
};

function orgInput(value, max, placeholder, type) {
  const i = el('input', 'ep-input');
  if (type) i.type = type;          // before the value: a date input sanitises what it is given
  i.value = value == null ? '' : String(value);
  if (max) i.maxLength = max;
  if (placeholder) i.placeholder = placeholder;
  i.autocomplete = 'off';
  return i;
}
function orgSelect(pairs, value) {
  const s = el('select', 'ep-input');
  pairs.forEach(([v, label]) => s.appendChild(new Option(label, v)));
  s.value = value == null ? '' : value;
  return s;
}
function orgField(label, input) {
  const l = el('label', 'f');
  l.append(el('span', null, label), input);
  return l;
}
function orgSection(title, hint) {
  const box = el('div', 'org-sec');
  box.appendChild(el('div', 'ax-sub', title));
  if (hint) box.appendChild(el('p', 'ax-hint', hint));
  return box;
}
function orgButton(text, cls) {
  const b = el('button', 'ep-btn mini' + (cls ? ' ' + cls : ''), text);
  b.type = 'button';
  return b;
}

async function loadOrgs() {
  const { data, error } = await sb.rpc('organisation_admin', { p_org: null });
  if (error) {
    const missing = PLAN_MISSING(error);
    $('#orgMissing').classList.toggle('hide', !missing);
    $('#orgWrap').classList.toggle('hide', missing);
    if (!missing) oops(error);
    return;
  }
  $('#orgMissing').classList.add('hide');
  $('#orgWrap').classList.remove('hide');
  const d = data || {};
  const list = d.organisations || [];
  orgs = {
    list,
    byId: Object.fromEntries(list.map(o => [o.id, o])),
    leagues: d.leagues || [],
    counts: d.counts || {},
    today: d.today || null
  };
  drawOrgTiles();
  fillOrgNew();
  fillAdopt();
  if (orgOpenId && !orgs.byId[orgOpenId]) { orgOpenId = null; $('#orgDetail').textContent = ''; }
  drawOrgTree();
  if (orgOpenId) await openOrg(orgOpenId);
}

function drawOrgTiles() {
  const c = orgs.counts;
  const host = $('#orgTiles'); host.textContent = '';
  [
    [c.organisations, 'organisations'], [c.tenants, 'tenants'], [c.clubs, 'clubs and schools'],
    [c.leagues_linked, 'leagues with an organiser', 'of ' + Number(c.leagues || 0)],
    [c.teams_linked, 'teams with a club', 'of ' + Number(c.teams || 0)],
    [c.affiliated, 'affiliated today'], [c.hidden, 'hidden from the public']
  ].forEach(([v, label, sub]) => {
    const n = Number(v || 0);
    const tile = el('div', 'tile');
    tile.append(el('div', 'n' + (n ? '' : ' dim'), String(n)), el('div', 'k', label));
    if (sub) tile.appendChild(el('div', 'sub', sub));
    host.appendChild(tile);
  });
}

/* The parent picker offers only what the chosen kind may sit under. */
function fillOrgNew() {
  const kind = $('#orgNewKind').value;
  const allowed = ORG_PARENT_KINDS[kind] || [];
  const sel = $('#orgNewParent');
  const was = sel.value;
  sel.textContent = '';
  if (allowed.includes(null)) sel.appendChild(new Option('— none: a tenant (data controller) of its own —', ''));
  orgs.list.filter(o => allowed.includes(o.kind) && !ORG_DEAD.includes(o.status))
    .forEach(o => sel.appendChild(new Option(orgIndented(o), o.id)));
  if (!sel.options.length) {
    sel.appendChild(new Option('nothing it can sit under yet: create a ' +
      allowed.map(k => ORG_KINDS[k]).join(' or ') + ' first', ''));
  }
  if ([...sel.options].some(op => op.value === was)) sel.value = was;
}

async function newOrg() {
  const kind = $('#orgNewKind').value;
  const parent = $('#orgNewParent').value || null;
  const name = ($('#orgNewName').value || '').trim();
  const slug = ($('#orgNewSlug').value || '').trim();
  if (name.length < 2) return say('An organisation needs a name of at least two characters.', 'err');
  if (!parent && !(ORG_PARENT_KINDS[kind] || []).includes(null)) {
    return say('Choose the organisation a ' + ORG_KINDS[kind] + ' sits under.', 'err');
  }
  if (!parent && !confirm('Create “' + name + '” as a tenant of its own?\n\n' +
      'A tenant is a data controller: the people registered anywhere below it will be ' +
      'its members, and it cannot later be moved inside another tenant from this page.')) return;
  const payload = { kind, name };
  if (parent) payload.parent_id = parent;
  if (slug) payload.slug = slug;
  $('#orgNewGo').disabled = true;
  const id = await rpc('platform_save_organisation', { p: payload });
  $('#orgNewGo').disabled = false;
  if (!id) return;
  say('Created ' + name + '.', 'ok');
  $('#orgNewName').value = ''; $('#orgNewSlug').value = '';
  delete $('#orgNewSlug').dataset.touched;
  await loadOrgs();
  openOrg(id);
}

function drawOrgTree() {
  const q = ($('#orgQ').value || '').trim().toLowerCase();
  const rows = q
    ? orgs.list.filter(o => o.name.toLowerCase().includes(q) || o.slug.includes(q))
    : orgs.list;
  $('#orgCount').textContent = (q ? rows.length + ' of ' : '') + orgs.list.length +
    ' organisation' + (orgs.list.length === 1 ? '' : 's');

  const body = $('#orgBody'); body.textContent = '';
  if (!rows.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 7;
    td.appendChild(el('div', 'empty', q ? 'Nothing matches “' + q + '”.'
      : 'No organisations yet. Start with the national body (or an independent league’s association) above.'));
    return;
  }
  rows.forEach(o => {
    const tr = body.insertRow();
    if (ORG_DEAD.includes(o.status)) tr.style.opacity = '.55';
    if (o.id === orgOpenId) tr.classList.add('org-on');

    const c0 = tr.insertCell();
    const indent = q ? 0 : (o.depth || 0) * 14;
    const nm = el('div', 'nm');
    if (indent) nm.appendChild(el('span', 'org-ind', '└ '));
    nm.appendChild(document.createTextNode(o.name));
    nm.style.paddingLeft = indent + 'px';
    const meta = [o.slug];
    if (!o.visible) meta.push('hidden');
    if (q && o.depth) meta.push(orgTrail(o));
    const mt = el('div', 'mt', meta.join(' · '));
    mt.style.paddingLeft = indent + 'px';
    c0.append(nm, mt);

    tr.insertCell().appendChild(el('span', 'pill' + (o.parent_id ? '' : ' pa'),
      (ORG_KINDS[o.kind] || o.kind) + (o.parent_id ? '' : ' · tenant')));
    tr.insertCell().appendChild(el('span', 'pill' + (o.status === 'active' ? ' la'
      : o.status === 'pending' ? '' : ' off'), o.status));

    const c3 = tr.insertCell();
    if (AFFILIATING_KINDS.includes(o.kind)) {
      c3.appendChild(el('span', 'pill' + (o.affiliated ? ' la' : ''), o.affiliated
        ? 'affiliated' + (o.accreditation && o.accreditation !== 'none' ? ' · ' + ACCREDITATION[o.accreditation] : '')
        : 'not affiliated'));
    } else {
      c3.appendChild(el('span', 'mt', '—'));
    }
    const c4 = tr.insertCell(); c4.className = 'num'; c4.textContent = Number(o.leagues || 0);
    const c5 = tr.insertCell(); c5.className = 'num'; c5.textContent = Number(o.teams || 0);

    const ac = tr.insertCell(); ac.className = 'ac';
    const open = orgButton(o.id === orgOpenId ? 'refresh' : 'open');
    open.addEventListener('click', () => openOrg(o.id));
    ac.appendChild(open);
  });
}

async function openOrg(id) {
  const d = await rpc('organisation_admin', { p_org: id });
  if (!d) return;
  const first = orgOpenId !== id;
  orgOpenId = id;
  drawOrgTree();
  drawOrgDetail(d, first);
}

function drawOrgDetail(d, scroll) {
  const o = d.organisation;
  const host = $('#orgDetail'); host.textContent = '';
  const card = el('div', 'org-card');

  const head = el('div', 'row');
  const title = el('div');
  title.style.minWidth = '0';
  title.append(
    el('div', 'org-crumbs', (d.ancestors || []).length
      ? (d.ancestors || []).map(a => a.name).join(' › ')
      : 'a tenant: the top of its own tree, and the data controller for everything below it'),
    el('div', 'org-title', o.name));
  const sp = el('span'); sp.style.marginLeft = 'auto';
  const close = orgButton('close');
  close.addEventListener('click', () => { orgOpenId = null; host.textContent = ''; drawOrgTree(); });
  head.append(title, sp, close);
  card.appendChild(head);

  card.appendChild(orgDetailsSection(o));
  if (o.parent_id) card.appendChild(orgMoveSection(o));
  if ((d.children || []).length) card.appendChild(orgChildrenSection(d.children));
  if (ORGANISER_KINDS.includes(o.kind)) card.appendChild(orgLeaguesSection(o, d.leagues || []));
  if (CLUB_KINDS.includes(o.kind)) card.appendChild(orgTeamsSection(o, d.teams || []));
  if (AFFILIATING_KINDS.includes(o.kind) || (d.affiliations || []).length) {
    card.appendChild(orgAffiliationsSection(o, d.affiliations || [], d.today || orgs.today));
  }

  host.appendChild(card);
  if (scroll) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function orgDetailsSection(o) {
  const box = orgSection('Details');
  const parentKind = o.parent_id && orgs.byId[o.parent_id] ? orgs.byId[o.parent_id].kind : null;

  const name = orgInput(o.name, 120);
  const short = orgInput(o.short_name, 40);
  const slug = orgInput(o.slug, 80);
  /* only the kinds that may sit where it sits; what already sits below it is
     the database's to check */
  const kind = orgSelect(Object.keys(ORG_KINDS)
    .filter(k => (ORG_PARENT_KINDS[k] || []).includes(parentKind))
    .map(k => [k, ORG_KINDS[k]]), o.kind);
  const status = orgSelect(ORG_STATUSES.map(s => [s, s]), o.status);
  const merged = orgSelect([['', '— merged into —']].concat(orgs.list
    .filter(x => x.tenant_id === o.tenant_id && x.id !== o.id && !(x.path || []).includes(o.id)
                 && !ORG_DEAD.includes(x.status))
    .map(x => [x.id, orgIndented(x)])), o.merged_into || '');
  const mergedField = orgField('MERGED INTO', merged);
  const syncMerged = () => mergedField.classList.toggle('hide', status.value !== 'merged');
  status.addEventListener('change', syncMerged);
  syncMerged();

  const visLabel = el('label', 'sw');
  const visible = el('input'); visible.type = 'checkbox'; visible.checked = o.visible !== false;
  visLabel.append(visible, document.createTextNode(' shown to the public (a directory, org_tree)'));

  const website = orgInput(o.website, 300, 'https://…');
  const nation = orgSelect([['', '—'], ['ENG', 'England'], ['SCO', 'Scotland'], ['WAL', 'Wales'],
                            ['NIR', 'Northern Ireland']], o.home_nation || '');
  const country = orgInput(o.country || 'GB', 2);
  const tz = orgInput(o.time_zone || 'Europe/London', 60);
  const regno = orgInput(o.registered_no, 40, 'company, charity or CASC number');
  const logo = orgInput(o.logo_path, 500);

  const r1 = el('div', 'row');
  r1.append(orgField('NAME', name), orgField('SHORT NAME', short), orgField('ADDRESS (SLUG)', slug));
  const r2 = el('div', 'row');
  r2.append(orgField('KIND', kind), orgField('STATUS', status), mergedField);
  const r3 = el('div', 'row');
  r3.append(orgField('WEBSITE', website), orgField('HOME NATION', nation), orgField('COUNTRY', country));
  const r4 = el('div', 'row');
  r4.append(orgField('TIME ZONE', tz), orgField('REGISTERED NUMBER', regno), orgField('LOGO PATH', logo));
  box.append(r1, r2, r3, r4, visLabel);

  let settings = null;
  if (!o.parent_id) {
    settings = el('textarea', 'ep-input');
    settings.rows = 5;
    settings.value = JSON.stringify(o.settings || {}, null, 2);
    box.appendChild(orgField('TENANT SETTINGS (JSON)', settings));
    box.appendChild(el('p', 'ax-hint',
      'Only a tenant has settings. Allowed: minor_age (18), own_login_min_age (13), ' +
      'publication_consent_age (16), age_cutoff ("09-01"), merge_min_fields (3), ' +
      'import_special_category (false), sensitive_fields ([]), equality_condition ' +
      '("explicit_consent"), dpo_contact. A key left out takes the default in brackets.'));
  }

  const row = el('div', 'row');
  const save = orgButton('save details', 'pri');
  row.appendChild(save);
  box.appendChild(row);

  save.addEventListener('click', async () => {
    const payload = {
      id: o.id, name: name.value, short_name: short.value, slug: slug.value, kind: kind.value,
      status: status.value, visible: visible.checked, website: website.value,
      home_nation: nation.value, country: country.value, time_zone: tz.value,
      registered_no: regno.value, logo_path: logo.value
    };
    if (status.value === 'merged') {
      if (!merged.value) return say('Choose the organisation it merged into.', 'err');
      payload.merged_into = merged.value;
    }
    if (settings) {
      try { payload.settings = JSON.parse(settings.value.trim() || '{}'); }
      catch (_) { return say('The tenant settings are not valid JSON.', 'err'); }
    }
    if (slug.value.trim() !== o.slug &&
        !confirm('Change the address of “' + o.name + '” from ' + o.slug + ' to ' +
                 slug.value.trim() + '? Links to the old address stop working.')) return;
    if (ORG_DEAD.includes(status.value) && status.value !== o.status &&
        !confirm('Mark “' + o.name + '” as ' + status.value + '? Nothing new can be put under it, ' +
                 'and a club that is ' + status.value + ' takes no teams.')) return;
    save.disabled = true;
    const id = await rpc('platform_save_organisation', { p: payload });
    save.disabled = false;
    if (!id) return;
    say('Saved ' + payload.name.trim() + '.', 'ok');
    loadOrgs();
  });
  return box;
}

function orgMoveSection(o) {
  const box = orgSection('Where it sits',
    'Moves it, and everything below it, under another organisation in the same tenant. ' +
    'Leaving the tenant, or becoming one, changes who controls its data, and is not done here.');
  const allowed = ORG_PARENT_KINDS[o.kind] || [];
  const sel = orgSelect(orgs.list
    .filter(x => x.tenant_id === o.tenant_id && allowed.includes(x.kind) && x.id !== o.id
                 && !(x.path || []).includes(o.id) && (!ORG_DEAD.includes(x.status) || x.id === o.parent_id))
    .map(x => [x.id, orgIndented(x)]), o.parent_id);
  sel.style.flex = '1 1 240px';
  const go = orgButton('move');
  const row = el('div', 'row');
  row.append(sel, go);
  box.appendChild(row);
  go.addEventListener('click', async () => {
    if (!sel.value || sel.value === o.parent_id) return say('It already sits there.', 'ok');
    const to = orgs.byId[sel.value];
    const below = orgs.list.filter(x => x.id !== o.id && (x.path || []).includes(o.id)).length;
    if (!confirm('Move “' + o.name + '”' + (below ? ' and the ' + below + ' organisation' +
        (below === 1 ? '' : 's') + ' below it' : '') + ' under “' + (to ? to.name : '?') + '”?')) return;
    go.disabled = true;
    const r = await rpc('platform_move_organisation', { p_org: o.id, p_parent: sel.value });
    go.disabled = false;
    if (!r) return;
    say('Moved ' + o.name + (r.descendants ? ', with ' + r.descendants + ' below it' : '') + '.', 'ok');
    loadOrgs();
  });
  return box;
}

function orgChildrenSection(children) {
  const box = orgSection('Directly below it');
  const row = el('div', 'row');
  children.forEach(c => {
    const b = orgButton(c.name + ' · ' + (ORG_KINDS[c.kind] || c.kind) + (ORG_DEAD.includes(c.status) ? ' · ' + c.status : ''));
    b.addEventListener('click', () => openOrg(c.id));
    row.appendChild(b);
  });
  box.appendChild(row);
  return box;
}

function orgLeaguesSection(o, list) {
  const box = orgSection('Leagues it runs',
    'Which organisation runs each league. It changes nobody’s rights yet; once organisation roles ' +
    'arrive, the officers of an organisation that runs a league administer it.');
  if (!list.length) box.appendChild(el('div', 'empty', 'It runs no league yet.'));
  list.forEach(l => {
    const row = el('div', 'row');
    const t = el('div');
    t.append(el('div', 'nm', l.name), el('div', 'mt', l.slug));
    const sp = el('span'); sp.style.marginLeft = 'auto';
    const un = orgButton('no longer runs it', 'danger');
    un.addEventListener('click', async () => {
      if (!confirm('Record that “' + o.name + '” no longer runs ' + l.name + '?')) return;
      const r = await rpc('set_league_organiser', { p_league: l.id, p_org: null });
      if (r) { say(l.name + ' has no organiser recorded now.', 'ok'); loadOrgs(); }
    });
    row.append(t, sp, un);
    box.appendChild(row);
  });

  if (!ORG_DEAD.includes(o.status)) {
    const others = orgs.leagues.filter(l => l.organiser_id !== o.id);
    const sel = orgSelect([['', '— a league it runs —']].concat(others.map(l => [l.id,
      l.name + (l.organiser_id ? ' (now run by ' + (orgs.byId[l.organiser_id] ? orgs.byId[l.organiser_id].name : '?') + ')' : '')])), '');
    sel.style.flex = '1 1 240px';
    const add = orgButton('runs this league');
    const row = el('div', 'row');
    row.append(sel, add);
    box.appendChild(row);
    add.addEventListener('click', async () => {
      const l = others.find(x => x.id === sel.value);
      if (!l) return say('Choose the league.', 'err');
      if (l.organiser_id && !confirm(l.name + ' is recorded as run by “' +
          (orgs.byId[l.organiser_id] ? orgs.byId[l.organiser_id].name : '?') + '”. Record “' + o.name + '” instead?')) return;
      add.disabled = true;
      const r = await rpc('set_league_organiser', { p_league: l.id, p_org: o.id });
      add.disabled = false;
      if (r) { say(l.name + ' is run by ' + o.name + '.', 'ok'); loadOrgs(); }
    });
  }
  return box;
}

function orgTeamsSection(o, teams) {
  const box = orgSection('Teams',
    'A team is one side in one league. A club with a side in the NBL and another in a local league ' +
    'has two teams here, with the same age group and gender.');
  const ageOptions = AGE_GROUPS.map(a => [a, a || '— age group —']);
  const genderOptions = TEAM_GENDERS.map(g => [g, g || '— gender —']);

  if (!teams.length) {
    box.appendChild(el('div', 'empty', 'No team belongs to it yet.'));
  } else {
    const wrap = el('div', 'scroll');
    const t = el('table', 'tbl');
    const hr = t.createTHead().insertRow();
    ['Team', 'League', 'Age group', 'Gender', ''].forEach(h => hr.appendChild(el('th', null, h)));
    const body = t.createTBody();
    teams.forEach(tm => {
      const tr = body.insertRow();
      const c0 = tr.insertCell();
      c0.append(el('div', 'nm', tm.name), el('div', 'mt', tm.slug));
      tr.insertCell().appendChild(el('span', 'mt', tm.league_name || '— no league —'));
      const age = orgSelect(ageOptions, tm.age_group || '');
      const gender = orgSelect(genderOptions, tm.gender || '');
      tr.insertCell().appendChild(age);
      tr.insertCell().appendChild(gender);
      const ac = tr.insertCell(); ac.className = 'ac';
      const save = orgButton('save');
      save.addEventListener('click', async () => {
        save.disabled = true;
        const r = await rpc('set_team_club', { p_team: tm.id, p_club: o.id,
          p_age_group: age.value || null, p_gender: gender.value || null });
        save.disabled = false;
        if (r) { say(tm.name + ' saved.', 'ok'); loadOrgs(); }
      });
      const un = orgButton('unlink', 'danger');
      un.addEventListener('click', async () => {
        if (!confirm('Unlink ' + tm.name + ' from “' + o.name + '”? Its age group and gender are kept.')) return;
        const r = await rpc('set_team_club', { p_team: tm.id, p_club: null,
          p_age_group: tm.age_group || null, p_gender: tm.gender || null });
        if (r) { say(tm.name + ' no longer belongs to ' + o.name + '.', 'ok'); loadOrgs(); }
      });
      ac.append(save, un);
    });
    wrap.appendChild(t);
    box.appendChild(wrap);
  }

  if (ORG_DEAD.includes(o.status)) return box;
  /* finding a team to add: the existing platform_teams search (0044) */
  const find = el('div', 'row');
  find.style.marginTop = '10px';
  const q = orgInput('', 80, 'find a team to add');
  q.classList.add('grow');
  const go = orgButton('search');
  find.append(q, go);
  const results = el('div');
  box.append(find, results);
  const search = async () => {
    const rows = await rpc('platform_teams', { p_search: q.value.trim() });
    results.textContent = '';
    if (!rows) return;
    const mine = new Set(teams.map(x => x.id));
    const list = rows.filter(r => !mine.has(r.id)).slice(0, 25);
    if (!list.length) { results.appendChild(el('div', 'empty', 'No other team matches that.')); return; }
    list.forEach(r => {
      const row = el('div', 'row');
      const t = el('div');
      t.style.flex = '1 1 200px';
      t.append(el('div', 'nm', r.name), el('div', 'mt', r.league_name + ' · ' + r.slug));
      const age = orgSelect(ageOptions, '');
      const gender = orgSelect(genderOptions, '');
      age.style.flex = gender.style.flex = '0 1 130px';
      const link = orgButton('add to ' + (o.short_name || o.name));
      link.addEventListener('click', async () => {
        link.disabled = true;
        const out = await rpc('set_team_club', { p_team: r.id, p_club: o.id,
          p_age_group: age.value || null, p_gender: gender.value || null });
        link.disabled = false;
        if (out) { say(r.name + ' now belongs to ' + o.name + '.', 'ok'); loadOrgs(); }
      });
      row.append(t, age, gender, link);
      results.appendChild(row);
    });
  };
  go.addEventListener('click', search);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  return box;
}

function affiliationWords(r) {
  return (r.warnings || []).length ? ' ' + r.warnings.join(' ') : '';
}

function orgAffiliationsSection(o, affs, today) {
  const box = orgSection('Affiliations',
    'Records, not rights. The annual affiliation to the governing body carries the Level 1 or 2 ' +
    'accreditation; a league membership and a season invite are its relationships with local ' +
    'leagues. The public sees only whether it is affiliated today, and at what level.');

  /* a national body's list holds every club affiliated to it; a page of
     editable rows that long helps nobody, so the newest seasons come first
     (organisation_admin's order) and the rest are counted */
  const SHOWN = 200;
  if (!affs.length) {
    box.appendChild(el('div', 'empty', 'No affiliation recorded.'));
  } else {
    if (affs.length > SHOWN) {
      box.appendChild(el('p', 'ax-hint', 'Showing the first ' + SHOWN + ' of ' + affs.length +
        ' affiliations; open a club to see or change one of the others.'));
    }
    const wrap = el('div', 'scroll');
    const t = el('table', 'tbl');
    const hr = t.createTHead().insertRow();
    ['Season', 'Affiliation', 'Status', 'Accreditation', 'From', 'To', 'Number', '']
      .forEach(h => hr.appendChild(el('th', null, h)));
    const body = t.createTBody();
    affs.slice(0, SHOWN).forEach(a => {
      const tr = body.insertRow();
      tr.insertCell().appendChild(el('span', 'nm', a.season_label));
      const c1 = tr.insertCell();
      c1.appendChild(el('div', 'nm', (AFF_KINDS[a.kind] || a.kind)));
      c1.appendChild(el('div', 'mt', (a.direction === 'out' ? 'to ' + a.to_org_name : 'from ' + a.org_name) +
        (a.season_name ? ' · ' + (a.league_name ? a.league_name + ' ' : '') + a.season_name : '') +
        (a.in_force ? ' · in force today' : '')));
      const status = orgSelect(AFF_STATUSES.map(s => [s, s]), a.status);
      tr.insertCell().appendChild(status);
      const c3 = tr.insertCell();
      let accred = null;
      if (a.kind === 'governing_body') {
        accred = orgSelect(Object.entries(ACCREDITATION), a.accreditation);
        c3.appendChild(accred);
      } else {
        c3.appendChild(el('span', 'mt', '—'));
      }
      const from = orgInput(a.valid_from, null, null, 'date');
      const to = orgInput(a.valid_to, null, null, 'date');
      const ref = orgInput(a.reference, 40);
      ref.style.width = '96px';
      tr.insertCell().appendChild(from);
      tr.insertCell().appendChild(to);
      tr.insertCell().appendChild(ref);
      const ac = tr.insertCell(); ac.className = 'ac';
      const save = orgButton('save');
      save.addEventListener('click', async () => {
        const p = { id: a.id, status: status.value, valid_from: from.value, valid_to: to.value || null,
                    reference: ref.value };
        if (accred) p.accreditation = accred.value;
        save.disabled = true;
        const r = await rpc('record_affiliation', { p });
        save.disabled = false;
        if (r) { say('Affiliation saved.' + affiliationWords(r), (r.warnings || []).length ? 'err' : 'ok'); loadOrgs(); }
      });
      ac.appendChild(save);
    });
    wrap.appendChild(t);
    box.appendChild(wrap);
  }

  if (!AFFILIATING_KINDS.includes(o.kind) || ORG_DEAD.includes(o.status)) return box;

  /* a new one */
  box.appendChild(el('div', 'ax-sub', 'Record an affiliation'));
  const toOrg = orgSelect([['', '— affiliated to —']].concat(orgs.list
    .filter(x => AFFILIATED_TO_KINDS.includes(x.kind) && x.id !== o.id && !ORG_DEAD.includes(x.status))
    .map(x => [x.id, orgIndented(x) + (x.tenant_id !== o.tenant_id ? ' · another tenant' : '')])), '');
  const kind = orgSelect(Object.entries(AFF_KINDS), 'governing_body');
  const label = orgInput(seasonOf(today), 7, '2026/27');
  const season = orgSelect([['', '— the season —']], '');
  const seasonField = orgField('SEASON INVITED TO', season);
  const from = orgInput(today || '', null, null, 'date');
  const to = orgInput('', null, null, 'date');
  const status = orgSelect(AFF_STATUSES.map(s => [s, s]), 'active');
  const accred = orgSelect(Object.entries(ACCREDITATION), 'none');
  const accredField = orgField('ACCREDITATION', accred);
  const ref = orgInput('', 40, 'affiliation number');
  const note = orgInput('', 400);

  const r1 = el('div', 'row');
  r1.append(orgField('AFFILIATED TO', toOrg), orgField('KIND', kind), orgField('SEASON', label));
  const r2 = el('div', 'row');
  r2.append(seasonField, orgField('STATUS', status), accredField, orgField('NUMBER', ref));
  const r3 = el('div', 'row');
  r3.append(orgField('FROM', from), orgField('TO (OPTIONAL)', to), orgField('NOTE', note));
  const r4 = el('div', 'row');
  const add = orgButton('record', 'pri');
  r4.appendChild(add);
  box.append(r1, r2, r3, r4);

  /* a season invite names a season of a league the organisation it is to runs;
     if that organisation runs none yet, every league's seasons are offered and
     the database says so when it is saved */
  const fillSeasons = async () => {
    season.textContent = '';
    season.appendChild(new Option('— the season —', ''));
    if (kind.value !== 'season_invite') return;
    const runs = orgs.leagues.filter(l => toOrg.value && l.organiser_id === toOrg.value);
    const pool = runs.length ? runs : orgs.leagues;
    const names = Object.fromEntries(orgs.leagues.map(l => [l.id, l.name]));
    let query = sb.from('seasons').select('id,name,league_id').order('name', { ascending: false }).limit(500);
    if (runs.length) query = query.in('league_id', pool.map(l => l.id));
    const { data, error } = await query;
    if (error) return oops(error);
    (data || []).forEach(s => season.appendChild(new Option((names[s.league_id] || '?') + ' · ' + s.name, s.id)));
  };
  const sync = () => {
    seasonField.classList.toggle('hide', kind.value !== 'season_invite');
    accredField.classList.toggle('hide', kind.value !== 'governing_body');
    if (kind.value !== 'governing_body') accred.value = 'none';
    fillSeasons();
  };
  kind.addEventListener('change', sync);
  toOrg.addEventListener('change', () => { if (kind.value === 'season_invite') fillSeasons(); });
  sync();

  add.addEventListener('click', async () => {
    if (!toOrg.value) return say('Choose the organisation it is affiliated to.', 'err');
    if (kind.value === 'season_invite' && !season.value) return say('Choose the season it was invited to.', 'err');
    const p = {
      org_id: o.id, to_org_id: toOrg.value, kind: kind.value, season_label: label.value.trim(),
      status: status.value, accreditation: accred.value, reference: ref.value, note: note.value,
      valid_from: from.value, valid_to: to.value || null
    };
    if (kind.value === 'season_invite') p.season_id = season.value;
    add.disabled = true;
    const r = await rpc('record_affiliation', { p });
    add.disabled = false;
    if (!r) return;
    say((r.created ? 'Affiliation recorded.' : 'That affiliation was already recorded for the season, and is updated.') +
        affiliationWords(r), (r.warnings || []).length ? 'err' : 'ok');
    loadOrgs();
  });
  return box;
}

/* ---- adopting a league's teams as clubs ----------------------------------- */
function fillAdopt() {
  const lg = $('#adLeague');
  const wasL = lg.value;
  lg.textContent = '';
  lg.appendChild(new Option('— the league whose teams become clubs —', ''));
  orgs.leagues.forEach(l => lg.appendChild(new Option(l.name +
    (l.organiser_id && orgs.byId[l.organiser_id] ? ' (run by ' + orgs.byId[l.organiser_id].name + ')' : ''), l.id)));
  if ([...lg.options].some(op => op.value === wasL)) lg.value = wasL;

  const pa = $('#adParent');
  const wasP = pa.value;
  pa.textContent = '';
  pa.appendChild(new Option('— the new clubs sit under —', ''));
  orgs.list.filter(o => AFFILIATED_TO_KINDS.includes(o.kind) && !ORG_DEAD.includes(o.status))
    .forEach(o => pa.appendChild(new Option(orgIndented(o), o.id)));
  if ([...pa.options].some(op => op.value === wasP)) pa.value = wasP;
}

async function proposeClubs() {
  const league = $('#adLeague').value;
  if (!league) return say('Choose the league whose teams become clubs.', 'err');
  const parent = $('#adParent').value || null;
  const r = await rpc('adopt_clubs', { p_league: league, p_parent: parent, p_pick: null });
  if (!r) return;
  adoptFor = { league, parent };
  drawAdopt(r.proposals || []);
}

function drawAdopt(proposals) {
  const host = $('#adList'); host.textContent = '';
  if (!proposals.length) {
    host.appendChild(el('div', 'empty', 'Every team in this league already belongs to a club.'));
    return;
  }
  const wrap = el('div', 'scroll');
  const t = el('table', 'tbl');
  const hr = t.createTHead().insertRow();
  ['', 'Team', 'Club name', 'Address', 'What happens'].forEach(h => hr.appendChild(el('th', null, h)));
  const body = t.createTBody();
  const picks = [];
  proposals.forEach(p => {
    const tr = body.insertRow();
    const tick = el('input'); tick.type = 'checkbox'; tick.checked = p.action !== 'conflict';
    tr.insertCell().appendChild(tick);
    const c1 = tr.insertCell();
    c1.append(el('div', 'nm', p.team_name), el('div', 'mt', p.team_slug));
    const name = orgInput(p.name, 120);
    const slug = orgInput(p.slug, 80);
    tr.insertCell().appendChild(name);
    tr.insertCell().appendChild(slug);
    const what = el('span', 'mt', p.action === 'create' ? 'a new club'
      : p.action === 'link' ? 'joins ' + (p.existing ? p.existing.name : 'the club at that address')
      : 'that address is ' + (p.existing ? p.existing.name + ' (' + (ORG_KINDS[p.existing.kind] || p.existing.kind) + ')' : 'taken') +
        ': change it');
    slug.addEventListener('input', () => { what.textContent = 'decided when applied: a club already at that address is joined'; });
    tr.insertCell().appendChild(what);
    picks.push({ tick, name, slug, team: p.team_id });
  });
  wrap.appendChild(t);
  host.appendChild(wrap);

  const row = el('div', 'row');
  row.style.marginTop = '10px';
  const apply = el('button', 'ep-btn pri', 'create and link the ticked teams');
  apply.type = 'button';
  row.appendChild(apply);
  host.appendChild(row);

  apply.addEventListener('click', async () => {
    const chosen = picks.filter(x => x.tick.checked)
      .map(x => ({ team_id: x.team, name: x.name.value.trim(), slug: x.slug.value.trim() }));
    if (!chosen.length) return say('Tick the teams to adopt.', 'err');
    const parent = $('#adParent').value || null;
    if (!parent) return say('Choose the national body, region or association the new clubs sit under.', 'err');
    const under = orgs.byId[parent];
    if (!confirm('Adopt ' + chosen.length + ' team' + (chosen.length === 1 ? '' : 's') +
        ' as clubs under “' + (under ? under.name : '?') + '”?\n\nA team whose address matches a club ' +
        'already in that tenant joins it; the rest become new clubs.')) return;
    apply.disabled = true;
    const r = await rpc('adopt_clubs', { p_league: adoptFor ? adoptFor.league : $('#adLeague').value,
                                         p_parent: parent, p_pick: chosen });
    apply.disabled = false;
    if (!r) return;
    const created = (r.created || []).length, linked = (r.linked || []).length, skipped = r.skipped || [];
    say(created + ' club' + (created === 1 ? '' : 's') + ' created, ' + linked + ' team' +
        (linked === 1 ? '' : 's') + ' joined an existing club' +
        (skipped.length ? '; ' + skipped.length + ' skipped: ' + skipped.map(s =>
          ADOPT_SKIPPED[s.reason] || s.reason).join('; ') : '') + '.', skipped.length ? 'err' : 'ok');
    await loadOrgs();
    proposeClubs();
  });
}

/* --------------------------------------------------------------- privacy --- */
/* THE DATA-RIGHTS QUEUE (migration 0120; docs/replacement/foundations.md 7.6).
   Requests to see, correct, erase, restrict, object to or take away personal
   data, and complaints, each with its clock. One read, privacy_queue(tenant),
   draws a controller's queue (null is Epinoia, the controller for fan
   accounts); every action is update_data_request(id, action, details), which
   audits it without the requester's name.

   THE DATES ARE THE DATABASE'S. due_at, ack_due_at, the days left and the latest
   date an extension may reach all come back computed (data_request_clock), so
   this page never does month arithmetic of its own: the date picker's maximum
   is the latest_extension it was given, and a refusal is shown in the
   database's words through rpc(). Platform administrators only until the data
   protection officer role arrives (0123). */
let priv = null;          // privacy_queue() as last read
let privOpenId = null;    // the request whose card is drawn
let privTenant = '';      // '' is Epinoia

const PRIV_KINDS = { access: 'access', rectification: 'correction', erasure: 'erasure', restriction: 'restriction',
                     objection: 'objection', portability: 'portability', complaint: 'complaint' };
const PRIV_STATUS = { received: 'received', awaiting_identity: 'waiting: identity', awaiting_clarification: 'waiting: clarification',
                      in_progress: 'in progress', completed: 'completed', refused: 'refused', withdrawn: 'withdrawn' };
const PRIV_CAPACITY = { self: 'about themselves', guardian: 'as a parent or guardian', representative: 'as a representative' };
const PRIV_PAUSED = ['awaiting_identity', 'awaiting_clarification'];

const londonDay = iso => iso ? new Date(iso).toLocaleDateString('en-GB',
  { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const londonIsoDate = iso => {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return p.year + '-' + p.month + '-' + p.day;
};
const daysWords = n => n == null ? '' : n < 0 ? Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' overdue'
  : n === 0 ? 'due today' : n + ' day' + (n === 1 ? '' : 's') + ' left';
const daysClass = n => n == null ? '' : n < 0 ? 'pr-late' : n <= 7 ? 'pr-soon' : '';

/* On the Overview: a line when anything in any queue is due within a week or
   late. Quiet when 0120 is not on the server, or nothing needs doing. */
async function loadPrivacyAttention() {
  const host = $('#privAttention');
  host.textContent = '';
  const { data, error } = await sb.rpc('privacy_queue', { p_tenant: null });
  if (error || !data) return;
  const c = data.counts || {};
  const inTenants = (data.tenants || []).reduce((n, t) => n + Number(t.open || 0), 0);
  const bits = [];
  if (c.ack_overdue) bits.push(c.ack_overdue + ' complaint' + (c.ack_overdue === 1 ? '' : 's') + ' not acknowledged in time');
  if (c.overdue) bits.push(c.overdue + ' request' + (c.overdue === 1 ? '' : 's') + ' overdue');
  if (c.ack_due_7d) bits.push(c.ack_due_7d + ' to acknowledge within a week');
  if (c.due_7d) bits.push(c.due_7d + ' due within a week');
  if (!bits.length && !c.open && !inTenants) return;
  const note = el('div', 'note' + (c.overdue || c.ack_overdue ? ' bad' : ''),
    'Privacy: ' + Number(c.open || 0) + ' open request' + (c.open === 1 ? '' : 's') + ' for Epinoia' +
    (bits.length ? ' (' + bits.join(', ') + ')' : '') +
    (inTenants ? '; ' + inTenants + ' open for other controllers' : '') + '. See the Privacy tab.');
  host.appendChild(note);
}

async function loadPrivacy() {
  const { data, error } = await sb.rpc('privacy_queue', { p_tenant: privTenant || null });
  if (error) {
    const missing = PLAN_MISSING(error);
    $('#prMissing').classList.toggle('hide', !missing);
    $('#prWrap').classList.toggle('hide', missing);
    if (!missing) oops(error);
    return;
  }
  $('#prMissing').classList.add('hide');
  $('#prWrap').classList.remove('hide');
  priv = data || {};
  fillPrivTenants();
  drawPrivTiles();
  drawPrivList();
  const open = privOpenId && (priv.requests || []).find(r => r.id === privOpenId);
  if (open) drawPrivDetail(open, false);
  else { privOpenId = null; $('#prDetail').textContent = ''; }
  loadPrivacyAttention();
}

function fillPrivTenants() {
  const sel = $('#prTenant');
  sel.textContent = '';
  sel.appendChild(new Option('Epinoia (fan accounts and this site) · ' + Number(priv.platform_open || 0) + ' open', ''));
  (priv.tenants || []).forEach(t => sel.appendChild(new Option(t.name + ' · ' + Number(t.open || 0) + ' open', t.id)));
  sel.value = privTenant;
  if (sel.value !== privTenant) { privTenant = ''; sel.value = ''; }
}

function drawPrivTiles() {
  const c = priv.counts || {};
  const host = $('#prTiles'); host.textContent = '';
  [
    ['open', 'open', false], ['overdue', 'overdue', true], ['due_7d', 'due within 7 days', true],
    ['ack_overdue', 'not acknowledged in time', true], ['ack_due_7d', 'to acknowledge within 7 days', true],
    ['paused', 'clock stopped', false], ['unassigned', 'open, nobody assigned', true], ['closed', 'closed', false]
  ].forEach(([k, label, urgent]) => {
    const n = Number(c[k] || 0);
    const tile = el('div', 'tile');
    tile.append(el('div', 'n' + (!n ? ' dim' : urgent ? ' warn' : ''), String(n)), el('div', 'k', label));
    host.appendChild(tile);
  });
}

function drawPrivList() {
  const all = priv.requests || [];
  const showClosed = $('#prClosed').checked;
  const rows = all.filter(r => showClosed || r.open);
  $('#prCount').textContent = rows.length + ' of ' + all.length + ' request' + (all.length === 1 ? '' : 's');

  const body = $('#prBody'); body.textContent = '';
  if (!rows.length) {
    const td = body.insertRow().insertCell(); td.colSpan = 7;
    td.appendChild(el('div', 'empty', all.length
      ? 'Nothing open. Tick “show closed” to see the requests already dealt with.'
      : 'No requests or complaints for this controller yet.'));
    return;
  }
  rows.forEach(r => {
    const tr = body.insertRow();
    if (!r.open) tr.style.opacity = '.6';
    if (r.id === privOpenId) tr.classList.add('org-on');

    const c0 = tr.insertCell();
    c0.append(el('div', 'nm', (PRIV_KINDS[r.kind] || r.kind) + ' · ' + r.reference),
              el('div', 'mt', 'received ' + londonDay(r.received_at)));
    const c1 = tr.insertCell();
    c1.append(el('div', null, r.requester_name),
              el('div', 'mt', r.requester_email + (r.requester_has_account ? ' · has an account' : '') +
                 (r.capacity !== 'self' ? ' · ' + (PRIV_CAPACITY[r.capacity] || r.capacity) : '')));
    tr.insertCell().appendChild(el('span', 'pill' + (PRIV_PAUSED.includes(r.status) ? ' pa'
      : r.status === 'in_progress' ? ' la' : r.open ? '' : ' st'), PRIV_STATUS[r.status] || r.status));

    const c3 = tr.insertCell(); c3.className = 'num';
    if (!r.ack_due_at) c3.textContent = '—';
    else if (r.acknowledged_at) c3.append(el('div', null, londonDay(r.ack_due_at)), el('div', 'mt', 'acknowledged'));
    else c3.append(el('div', r.open ? daysClass(r.ack_days_left) : '', londonDay(r.ack_due_at)),
                   el('div', 'mt', r.open ? daysWords(r.ack_days_left) : ''));

    const c4 = tr.insertCell(); c4.className = 'num';
    c4.append(el('div', r.open ? daysClass(r.days_left) : '', londonDay(r.due_at)),
              el('div', 'mt', !r.open ? 'closed ' + londonDay(r.closed_at)
                : PRIV_PAUSED.includes(r.status) ? 'clock stopped' : daysWords(r.days_left) +
                  (r.extended_until ? ' · extended' : '')));

    tr.insertCell().appendChild(el('span', 'mt', r.assigned_email || 'nobody'));
    const ac = tr.insertCell(); ac.className = 'ac';
    const open = orgButton(r.id === privOpenId ? 'refresh' : 'open');
    open.addEventListener('click', () => {
      privOpenId = r.id;
      drawPrivList();
      drawPrivDetail(r, true);
    });
    ac.appendChild(open);
  });
}

/* One call per action, then the queue is read again so every date on the page
   is the database's answer to what just changed. */
async function privAct(r, action, p, done) {
  const out = await rpc('update_data_request', { p_id: r.id, p_action: action, p: p || {} });
  if (!out) return false;
  say(done + ' (' + (PRIV_STATUS[out.status] || out.status) + ', due ' + londonDay(out.due_at) + ').', 'ok');
  privOpenId = r.id;
  await loadPrivacy();
  return true;
}

function drawPrivDetail(r, scroll) {
  const host = $('#prDetail'); host.textContent = '';
  const card = el('div', 'org-card');

  const head = el('div', 'row');
  const title = el('div'); title.style.minWidth = '0';
  title.append(el('div', 'org-crumbs', (priv.tenant ? priv.tenant.name : 'Epinoia') + ' · ' + (r.open ? 'open' : 'closed')),
               el('div', 'org-title', (PRIV_KINDS[r.kind] || r.kind) + ' · ' + r.reference));
  const sp = el('span'); sp.style.marginLeft = 'auto';
  const close = orgButton('close');
  close.addEventListener('click', () => { privOpenId = null; host.textContent = ''; drawPrivList(); });
  head.append(title, sp, close);
  card.appendChild(head);

  const dl = (pairs) => {
    const d = el('dl', 'pr-dl');
    pairs.filter(Boolean).forEach(([k, v, cls]) => { d.append(el('dt', null, k), el('dd', cls || null, v)); });
    return d;
  };

  /* the request */
  const who = orgSection('The request', 'Only here and in the queue: audit rows and emails carry the reference, never these.');
  who.appendChild(dl([
    ['From', r.requester_name],
    ['Reply to', r.requester_email + (r.requester_has_account ? ' (signed in when asking)' : ' (not signed in: the address is not verified)')],
    ['Made', PRIV_CAPACITY[r.capacity] || r.capacity],
    ['Status', PRIV_STATUS[r.status] || r.status]
  ]));
  const words = el('div', 'body-x', r.details || '(no details given)');
  words.style.marginTop = '10px';
  who.appendChild(words);
  card.appendChild(who);

  /* the clock */
  const clock = orgSection('The clock');
  const stopped = PRIV_PAUSED.includes(r.status);
  clock.appendChild(dl([
    ['Received', londonDay(r.received_at)],
    r.ack_due_at ? ['Acknowledge by', londonDay(r.ack_due_at) + (r.acknowledged_at ? ' · acknowledged ' + londonDay(r.acknowledged_at)
      : r.open ? ' · ' + daysWords(r.ack_days_left) : ''), r.acknowledged_at || !r.open ? '' : daysClass(r.ack_days_left)]
      : ['Acknowledged', r.acknowledged_at ? londonDay(r.acknowledged_at) : 'not yet'],
    ['Identity confirmed', r.identity_confirmed_at ? londonDay(r.identity_confirmed_at) + ' (the month runs from here)' : 'not yet'],
    ['Clock stopped', stopped ? 'since ' + londonDay(r.paused_at) + ', ' + r.paused_days_now + ' whole day' +
      (r.paused_days_now === 1 ? '' : 's') + ' in all so far' : r.paused_days ? r.paused_days + ' day' + (r.paused_days === 1 ? '' : 's') + ' in all' : 'never'],
    r.extended_until ? ['Extended to', londonDay(r.extended_until) + ': ' + (r.extension_reason || '')] : null,
    ['Due', londonDay(r.due_at) + (r.open ? ' · ' + (stopped ? 'moves on while the clock is stopped' : daysWords(r.days_left)) : ''),
      r.open && !stopped ? daysClass(r.days_left) : ''],
    !r.open ? ['Closed', londonDay(r.closed_at) + ' as ' + (PRIV_STATUS[r.status] || r.status)] : null,
    !r.open && r.outcome ? ['Outcome', r.outcome] : null
  ]));
  card.appendChild(clock);

  if (r.open) card.appendChild(privActions(r, stopped));
  host.appendChild(card);
  if (scroll) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function privActions(r, stopped) {
  const box = orgSection('Handle it', 'Each action is recorded in the audit log with the date and who did it.');

  /* acknowledging, identity, and the clock */
  const row = el('div', 'row');
  if (!r.acknowledged_at) {
    const b = orgButton('acknowledge', 'pri');
    b.addEventListener('click', async () => { b.disabled = true; if (!await privAct(r, 'acknowledge', {}, 'Acknowledged')) b.disabled = false; });
    row.appendChild(b);
  }
  if (!r.identity_confirmed_at) {
    const b = orgButton('identity confirmed');
    b.addEventListener('click', async () => {
      if (!confirm('Record that the requester’s identity is confirmed?\n\nThe month starts again from today.')) return;
      b.disabled = true; if (!await privAct(r, 'confirm_identity', {}, 'Identity confirmed')) b.disabled = false;
    });
    row.appendChild(b);
  }
  if (!r.identity_confirmed_at && r.status !== 'awaiting_identity') {
    const b = orgButton('stop the clock: need identity');
    b.addEventListener('click', async () => { b.disabled = true; if (!await privAct(r, 'pause', { reason: 'identity' }, 'Clock stopped for identity')) b.disabled = false; });
    row.appendChild(b);
  }
  if (r.status !== 'awaiting_clarification') {
    const b = orgButton('stop the clock: need clarification');
    b.addEventListener('click', async () => { b.disabled = true; if (!await privAct(r, 'pause', { reason: 'clarification' }, 'Clock stopped for clarification')) b.disabled = false; });
    row.appendChild(b);
  }
  if (stopped) {
    const b = orgButton('restart the clock', 'pri');
    b.addEventListener('click', async () => { b.disabled = true; if (!await privAct(r, 'resume', {}, 'Clock restarted')) b.disabled = false; });
    row.appendChild(b);
  }
  box.appendChild(row);

  /* extending: to a date no later than the database says */
  const ext = el('div', 'row');
  const until = orgInput(r.extended_until ? londonIsoDate(r.extended_until) : londonIsoDate(r.latest_extension), 10, null, 'date');
  until.max = londonIsoDate(r.latest_extension);
  const reason = orgInput(r.extension_reason || '', 400, 'why it needs longer: this is what the requester is told');
  reason.classList.add('grow');
  const extend = orgButton(r.extended_until ? 'change the extension' : 'extend');
  extend.addEventListener('click', async () => {
    if (!until.value) return say('Choose the date the extension runs to.', 'err');
    if (!reason.value.trim()) return say('An extension needs its reason: the requester must be told why.', 'err');
    extend.disabled = true;
    if (!await privAct(r, 'extend', { until: until.value, reason: reason.value.trim() }, 'Extended to ' + until.value)) extend.disabled = false;
  });
  ext.append(orgField('EXTEND TO (LATEST ' + londonDay(r.latest_extension).toUpperCase() + ')', until), reason, extend);
  box.appendChild(ext);

  /* assigning */
  const as = el('div', 'row');
  const handler = orgSelect([['', '— nobody —']].concat((priv.handlers || []).map(h => [h.user_id, h.email])), r.assigned_to || '');
  handler.style.flex = '1 1 220px';
  const assign = orgButton('assign');
  assign.addEventListener('click', async () => {
    assign.disabled = true;
    if (!await privAct(r, 'assign', { user_id: handler.value || null },
        handler.value ? 'Assigned to ' + handler.options[handler.selectedIndex].text : 'Unassigned')) assign.disabled = false;
  });
  as.append(handler, assign);
  box.appendChild(as);

  /* closing */
  const cl = el('div');
  cl.style.marginTop = '6px';
  const status = orgSelect([['completed', 'completed: done what was asked, or answered the complaint'],
                            ['refused', 'refused: with the reasons given to the requester'],
                            ['withdrawn', 'withdrawn by the requester']], 'completed');
  const outcome = el('textarea', 'ep-input');
  outcome.rows = 3; outcome.maxLength = 2000;
  outcome.placeholder = 'The outcome: what was sent, corrected or erased, or why it was refused. Needed for completed and refused.';
  const shut = orgButton('close the request', 'danger');
  shut.addEventListener('click', async () => {
    const text = outcome.value.trim();
    if (status.value !== 'withdrawn' && !text) return say('Record the outcome before closing it.', 'err');
    if (!confirm('Close ' + r.reference + ' as ' + status.value + '?\n\nNothing more can be recorded on it afterwards.')) return;
    shut.disabled = true;
    if (!await privAct(r, 'close', { status: status.value, outcome: text }, 'Closed as ' + status.value)) shut.disabled = false;
  });
  cl.append(orgField('CLOSE AS', status), outcome);
  const clRow = el('div', 'row'); clRow.style.marginTop = '8px';
  clRow.appendChild(shut);
  cl.appendChild(clRow);
  box.appendChild(cl);
  return box;
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
  contact_enabled: 'Off hides the contact form and refuses submissions.',
  dpo_contact:     'Epinoia’s data protection contact, shown on the public privacy page ' +
                   '(an address or a line of text). Empty: the page says its form reaches the right person.',
  analytics_access: 'free or members: whether the advanced analytics need a plan in ' +
                    'every league set to inherit. Changed on the Plans tab.',
  memberships_enabled: 'The memberships master switch. Off: nothing is gated anywhere, ' +
                       'whatever the leagues and the analytics default say. Changed on the Plans tab.'
};

/* Settings with a consequence, edited on the Plans tab with a confirm that
   says what they do rather than by a bare control here. The words for the
   current value, keyed by setting. */
const PLANS_TAB_SETTINGS = {
  analytics_access: v => v === 'members' ? 'members' : 'free',
  memberships_enabled: v => v === true ? 'on' : 'off'
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
    /* THE EXCEPTIONS TO "THE CONTROL FOLLOWS THE TYPE". analytics_access is
       a string, so the rule below would give it a free text box — which would
       store "member" as happily as "members", and flip the analytics for every
       league on inherit without the confirm that says so. memberships_enabled
       is a boolean, so it would get a bare checkbox that opens or closes every
       members-only league on the platform in one click. Each has two legal
       values and a consequence, and both live on the Plans tab. */
    if (Object.prototype.hasOwnProperty.call(PLANS_TAB_SETTINGS, s.key)) {
      const row = el('div', 'row'); row.style.margin = '4px 0 0';
      row.appendChild(el('span', 'mt', 'now ' + PLANS_TAB_SETTINGS[s.key](v)));
      const go = el('button', 'ep-btn mini', 'change on the Plans tab'); go.type = 'button';
      go.addEventListener('click', () => {
        const tab = document.querySelector('.ep-tab[data-p="plans"]');
        if (tab) tab.click();
      });
      row.appendChild(go);
      cell.appendChild(row);
    } else if (typeof v === 'boolean') {
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
