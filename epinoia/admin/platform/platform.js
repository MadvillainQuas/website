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
                     keys: loadKeys, audit: loadAudit, set: loadSettings,
                     plans: loadPlans };
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
