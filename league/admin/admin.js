'use strict';
/* ============================================================================
   League administration.

   Every privileged action here is an RPC that authorises its own caller in the
   database (migration 0007). This page decides what to *render*, never what is
   *allowed* — it asks whoami() and hides what you cannot do, but hiding a
   button is a courtesy, not a control. Pressing one you should not have is
   refused by Postgres.
   ============================================================================ */

/* The admin console must never be framed: a clickjacked "revoke role" or
   "schedule fixture" is a real risk and GitHub Pages cannot send X-Frame-Options. */
if (window.top !== window.self) {
  try { window.top.location = window.self.location; } catch (_) {}
  document.documentElement.innerHTML = '';
  throw new Error('framed');
}

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const show = (id, on) => $(id).classList.toggle('hide', !on);

let sb = null, me = null, who = null;
let league = null, season = null, comp = null;
let seasons = [], comps = [], teams = [], fixtures = [];

function say(text, kind) {
  const m = $('#msg');
  m.textContent = text || '';
  m.className = 'msg ' + (kind || '');
  m.classList.toggle('hide', !text);
  if (text) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* Postgres speaks plainly enough that dressing its errors up loses information.
   Pass the message through, and only translate the codes that are opaque. */
function oops(e, fallback) {
  if (!e) return say(fallback || 'Something went wrong.', 'err');
  const msg = e.message || String(e);
  if (e.code === '42501' || /permission denied/i.test(msg))
    return say('Refused: you do not have rights for that.', 'err');
  if (e.code === 'PGRST202' || /schema cache/i.test(msg))
    return say('That function is not on the server yet — run `npx supabase db push`.', 'err');
  say(msg, 'err');
}

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '').slice(0, 40);

/* ------------------------------------------------------------------- boot --- */
async function boot() {
  sb = window.courtsideClient && courtsideClient();
  if (!sb) { say('No Supabase key in config.js — administration needs one.', 'err'); return; }

  const { data: { session } } = await sb.auth.getSession();
  me = session && session.user;
  sb.auth.onAuthStateChange((_e, s) => { me = s && s.user; render(); });
  render();
}

async function render() {
  show('#signin', !me);
  show('#out', !!me);
  show('#idsec', !!me);
  $('#who').textContent = me ? me.email : '';
  if (!me) { show('#newlg', false); show('#ws', false); return; }

  const { data, error } = await sb.rpc('whoami');
  if (error) { show('#ws', false); return oops(error); }
  who = data || {};

  renderAccess();
  show('#newlg', !!who.is_platform_admin);

  const admin = who.leagues || [];
  show('#ws', admin.length > 0);
  if (!admin.length) return;

  if (!league || !admin.some(l => l.id === league.id)) league = admin[0];
  renderLeaguePick(admin);
  await loadLeague();
}

function renderAccess() {
  const host = $('#access'); host.textContent = '';
  const bits = [];
  if (who.is_platform_admin) bits.push('platform admin');
  const nL = (who.leagues || []).length, nT = (who.teams || []).length;
  if (nL) bits.push(nL + ' league' + (nL === 1 ? '' : 's'));
  if (nT) bits.push(nT + ' team' + (nT === 1 ? '' : 's'));
  const nS = (who.scoring || []).length;
  if (nS) bits.push(nS + ' game' + (nS === 1 ? '' : 's') + ' to score');
  $('#accessNote').textContent = bits.join(' · ') || 'no roles yet';

  if (!bits.length) {
    host.appendChild(el('div', 'empty',
      'Your account has no administrative roles. Ask a league administrator to ' +
      'grant you one — they will need this exact address: ' + (me.email || '')));
    return;
  }

  (who.scoring || []).forEach(g => {
    const row = el('div', 'item');
    row.append(el('div', 'nm', 'Game to score'), el('div', 'mt', g.status));
    const sp = el('div', 'sp');
    const go = el('a', 'cs-btn mini pri', 'open scorer');
    go.href = '../score/?g=' + encodeURIComponent(g.game_id) + '&mode=supabase';
    sp.appendChild(go); row.appendChild(sp);
    host.appendChild(row);
  });
}

function renderLeaguePick(admin) {
  const host = $('#lgPick'); host.textContent = '';
  admin.forEach(l => {
    const b = el('button', 'cs-chip' + (league && l.id === league.id ? ' on' : ''), l.name);
    b.type = 'button';
    b.addEventListener('click', async () => {
      league = l; season = null; comp = null;
      renderLeaguePick(admin); await loadLeague();
    });
    host.appendChild(b);
  });
  const view = el('a', 'cs-chip', 'view public page ↗');
  view.href = '../l/?l=' + encodeURIComponent(league.slug);
  view.target = '_blank'; view.rel = 'noopener';
  host.appendChild(view);
  $('#lgNote').textContent = league ? league.slug : '';
}

/* ------------------------------------------------------------ league load --- */
async function loadLeague() {
  const { data, error } = await sb.from('seasons')
    .select('id,name,starts_on,ends_on').eq('league_id', league.id).order('starts_on', { ascending: false });
  if (error) return oops(error);
  seasons = data || [];
  if (!season || !seasons.some(s => s.id === season.id)) season = seasons[0] || null;
  renderSeasonPick();
  await loadComps();
  await loadTeams();
}

function renderSeasonPick() {
  const host = $('#snPick'); host.textContent = '';
  if (!seasons.length) {
    host.appendChild(el('div', 'empty', 'No seasons yet — add one above to begin.'));
    return;
  }
  seasons.forEach(s => {
    const b = el('button', 'cs-chip' + (season && s.id === season.id ? ' on' : ''), s.name);
    b.type = 'button';
    b.addEventListener('click', async () => { season = s; comp = null; renderSeasonPick(); await loadComps(); });
    host.appendChild(b);
  });
}

async function loadComps() {
  comps = [];
  if (season) {
    const { data, error } = await sb.from('competitions')
      .select('id,name,kind').eq('season_id', season.id).order('name');
    if (error) return oops(error);
    comps = data || [];
  }
  if (!comp || !comps.some(c => c.id === comp.id)) comp = comps[0] || null;
  renderCompPick();
  await loadFixtures();
  await loadMembers();
}

function renderCompPick() {
  const host = $('#cpPick'); host.textContent = '';
  if (!season) return;
  if (!comps.length) {
    host.appendChild(el('div', 'empty',
      'No competitions in this season. A competition is what holds a table and a fixture list.'));
    return;
  }
  comps.forEach(c => {
    const b = el('button', 'cs-chip' + (comp && c.id === comp.id ? ' on' : ''), c.name);
    b.type = 'button';
    b.addEventListener('click', async () => { comp = c; renderCompPick(); await loadTeams(); await loadFixtures(); });
    host.appendChild(b);
  });
}

/* ------------------------------------------------------------------ teams --- */
async function loadTeams() {
  const { data, error } = await sb.from('teams')
    .select('id,name,short_name,colour,slug').eq('league_id', league.id).order('name');
  if (error) return oops(error);
  teams = data || [];

  let entered = new Set();
  if (comp) {
    const { data: ct } = await sb.from('competition_teams')
      .select('team_id').eq('competition_id', comp.id);
    entered = new Set((ct || []).map(r => r.team_id));
  }

  $('#tmNote').textContent = comp
    ? entered.size + ' of ' + teams.length + ' entered in ' + comp.name
    : teams.length + ' in league';

  const host = $('#tmList'); host.textContent = '';
  if (!teams.length) {
    host.appendChild(el('div', 'empty', 'No teams in this league yet.'));
  }
  teams.forEach(t => {
    const inComp = entered.has(t.id);
    const row = el('div', 'item' + (inComp ? ' on' : ''));
    const dot = el('span'); dot.style.cssText =
      `width:14px;height:14px;border-radius:3px;flex:none;background:${t.colour || '#93f2bf'}`;
    const nm = el('div');
    nm.append(el('div', 'nm', t.name), el('div', 'mt', t.short_name || t.slug));
    row.append(dot, nm);

    const sp = el('div', 'sp');
    if (comp) {
      const b = el('button', 'cs-btn mini' + (inComp ? ' dgr' : ''),
                   inComp ? 'withdraw' : 'enter');
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        const q = inComp
          ? sb.from('competition_teams').delete().eq('competition_id', comp.id).eq('team_id', t.id)
          : sb.from('competition_teams').insert({ competition_id: comp.id, team_id: t.id });
        const { error } = await q;
        if (error) { b.disabled = false; return oops(error); }
        say(inComp ? t.name + ' withdrawn' : t.name + ' entered', 'ok');
        await loadTeams(); await loadFixtures();
      });
      sp.appendChild(b);
    }
    const view = el('a', 'cs-btn mini', 'page ↗');
    view.href = '../t/?t=' + encodeURIComponent(t.slug);
    view.target = '_blank'; view.rel = 'noopener';
    sp.appendChild(view);
    row.appendChild(sp);
    host.appendChild(row);
  });

  fillTeamSelects(entered);
}

/* Only teams entered in the competition can be given a fixture in it — a
   fixture between two teams that are not in the table would produce standings
   rows for teams nobody expected. */
function fillTeamSelects(entered) {
  const pool = teams.filter(t => entered.has(t.id));
  [['#fxHome', 'home'], ['#fxAway', 'away']].forEach(([sel, side]) => {
    const s = $(sel); const keep = s.value;
    s.textContent = '';
    if (!pool.length) {
      s.appendChild(el('option', null, comp ? 'enter teams first' : 'pick a competition'));
      s.disabled = true; return;
    }
    s.disabled = false;
    s.appendChild(el('option', null, side + ' team…')).value = '';
    pool.forEach(t => { const o = el('option', null, t.name); o.value = t.id; s.appendChild(o); });
    if (pool.some(t => t.id === keep)) s.value = keep;
  });
}

/* --------------------------------------------------------------- fixtures --- */
async function loadFixtures() {
  fixtures = [];
  if (comp) {
    const { data, error } = await sb.from('games')
      .select('id,tipoff_at,venue,status,home_score,away_score,home_team_id,away_team_id')
      .eq('competition_id', comp.id).order('tipoff_at');
    if (error) return oops(error);
    fixtures = data || [];
  }
  const host = $('#fxList'); host.textContent = '';
  $('#fxNote').textContent = comp ? fixtures.length + ' scheduled' : 'pick a competition';
  if (!comp) return;
  if (!fixtures.length) {
    host.appendChild(el('div', 'empty', 'No fixtures yet.'));
    return;
  }

  const byId = new Map(teams.map(t => [t.id, t]));
  fixtures.forEach(g => {
    const row = el('div', 'fxrow');
    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    row.appendChild(el('div', 'd', when
      ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
        when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : 'TBC'));
    row.appendChild(el('div', 'tn h', (byId.get(g.home_team_id) || {}).name || '—'));
    row.appendChild(el('div', 'v', g.status === 'final'
      ? `${g.home_score}–${g.away_score}` : (g.status === 'live' ? 'LIVE' : 'v')));
    row.appendChild(el('div', 'tn', (byId.get(g.away_team_id) || {}).name || '—'));

    const ac = el('div', 'ac');
    if (g.status === 'scheduled' || g.status === 'live') {
      const sc = el('a', 'cs-btn mini pri', 'score');
      sc.href = '../score/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
      sc.target = '_blank'; sc.rel = 'noopener';
      ac.appendChild(sc);
      const st = el('button', 'cs-btn mini', 'staff');
      st.type = 'button';
      st.addEventListener('click', () => officials(g, row));
      ac.appendChild(st);
    } else {
      const v = el('a', 'cs-btn mini', 'box ↗');
      v.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
      v.target = '_blank'; v.rel = 'noopener';
      ac.appendChild(v);
    }
    row.appendChild(ac);
    host.appendChild(row);
  });
}

/* Statisticians for one fixture, opened inline under its row so the context
   (who is playing, when) stays on screen while you assign someone. */
async function officials(game, afterRow) {
  const existing = afterRow.nextElementSibling;
  if (existing && existing.dataset.panelFor === game.id) { existing.remove(); return; }
  document.querySelectorAll('[data-panel-for]').forEach(n => n.remove());

  const panel = el('div');
  panel.dataset.panelFor = game.id;
  panel.style.cssText = 'padding:11px 0 13px;border-bottom:1px solid var(--rule)';
  afterRow.after(panel);

  const head = el('div', 'mt', 'Statisticians for this fixture');
  head.style.marginBottom = '8px';
  panel.appendChild(head);

  const listHost = el('div');
  panel.appendChild(listHost);

  const add = el('div', 'row');
  const email = el('input', 'cs-input grow');
  email.type = 'email'; email.placeholder = 'statistician@club.org';
  const go = el('button', 'cs-btn mini pri', 'assign'); go.type = 'button';
  add.append(email, go);
  panel.appendChild(add);

  async function refresh() {
    const { data, error } = await sb.rpc('game_officials_list', { p_game: game.id });
    listHost.textContent = '';
    if (error) return oops(error);
    if (!data || !data.length) {
      listHost.appendChild(el('div', 'empty',
        'Nobody assigned. Without a statistician, only a league admin can score this game.'));
      return;
    }
    data.forEach(o => {
      const r = el('div', 'item');
      r.append(el('div', 'nm', o.email), el('div', 'mt', o.role));
      const sp = el('div', 'sp');
      const rm = el('button', 'cs-btn mini dgr', 'remove'); rm.type = 'button';
      rm.addEventListener('click', async () => {
        rm.disabled = true;
        const { error } = await sb.rpc('remove_official', { p_game: game.id, p_user: o.user_id });
        if (error) { rm.disabled = false; return oops(error); }
        say('removed ' + o.email, 'ok'); refresh();
      });
      sp.appendChild(rm); r.appendChild(sp);
      listHost.appendChild(r);
    });
  }

  go.addEventListener('click', async () => {
    const v = email.value.trim();
    if (!v) return say('Enter the email address of the account to assign.', 'err');
    go.disabled = true;
    const { data, error } = await sb.rpc('assign_official', { p_game: game.id, p_email: v });
    go.disabled = false;
    if (error) return oops(error);
    // the function reports "no account yet" as a value, not an error
    say(data, /^no account/.test(data) ? 'err' : 'ok');
    if (!/^no account/.test(data)) { email.value = ''; refresh(); }
  });

  refresh();
}

/* ----------------------------------------------------------------- people --- */
async function loadMembers() {
  const host = $('#grList'); host.textContent = '';
  const { data, error } = await sb.rpc('league_members', { p_league: league.id });
  if (error) return oops(error);
  if (!data || !data.length) {
    host.appendChild(el('div', 'empty', 'No one else has a role in this league yet.'));
    return;
  }
  data.forEach(m => {
    const r = el('div', 'item');
    r.append(el('div', 'nm', m.email),
             el('div', 'mt', m.role.replace('_', ' ') + ' · ' + m.scope_type));
    const sp = el('div', 'sp');
    const rm = el('button', 'cs-btn mini dgr', 'revoke'); rm.type = 'button';
    rm.addEventListener('click', async () => {
      rm.disabled = true;
      const { data: res, error: e2 } = await sb.rpc('revoke_role', { p_membership: m.membership_id });
      if (e2) { rm.disabled = false; return oops(e2); }
      say(res + ' — ' + m.email, 'ok'); loadMembers();
    });
    sp.appendChild(rm); r.appendChild(sp);
    host.appendChild(r);
  });
}

/* ----------------------------------------------------------------- actions --- */
$('#send').addEventListener('click', async () => {
  const v = $('#email').value.trim();
  if (!v) return say('Enter your email address.', 'err');
  const { error } = await sb.auth.signInWithOtp({
    email: v, options: { emailRedirectTo: location.href }
  });
  if (error) return oops(error);
  say('Link sent to ' + v + '. It expires shortly — open it on this device.', 'ok');
});

$('#out').addEventListener('click', async () => {
  await sb.auth.signOut();
  league = season = comp = null;
  say('');
  render();
});

$('#lgName').addEventListener('input', () => {
  // only autofill while the slug is untouched, so a deliberate one is never clobbered
  const s = $('#lgSlug');
  if (!s.dataset.touched) s.value = slugify($('#lgName').value);
});
$('#lgSlug').addEventListener('input', () => { $('#lgSlug').dataset.touched = '1'; });

$('#lgGo').addEventListener('click', async () => {
  const name = $('#lgName').value.trim();
  const s = $('#lgSlug').value.trim() || slugify(name);
  if (!name) return say('Give the league a name.', 'err');
  $('#lgGo').disabled = true;
  const { data, error } = await sb.rpc('create_league', {
    p_name: name, p_slug: s,
    p_colour_a: $('#lgCa').value, p_colour_b: $('#lgCb').value,
    p_public_live: $('#lgLive').checked, p_youth_protected: $('#lgYouth').checked
  });
  $('#lgGo').disabled = false;
  if (error) return oops(error);
  say('Created ' + name + '. You administer it.', 'ok');
  $('#lgName').value = ''; $('#lgSlug').value = ''; delete $('#lgSlug').dataset.touched;
  league = { id: data, slug: s, name };
  await render();
});

$('#snGo').addEventListener('click', async () => {
  const name = $('#snName').value.trim();
  if (!name) return say('Name the season, e.g. 2026-27.', 'err');
  const { error } = await sb.from('seasons').insert({
    league_id: league.id, name,
    starts_on: $('#snFrom').value || null, ends_on: $('#snTo').value || null
  });
  if (error) return oops(error);
  say('Season ' + name + ' added.', 'ok');
  $('#snName').value = '';
  await loadLeague();
});

$('#cpGo').addEventListener('click', async () => {
  if (!season) return say('Add a season first — competitions live inside one.', 'err');
  const name = $('#cpName').value.trim();
  if (!name) return say('Name the competition.', 'err');
  const { error } = await sb.from('competitions')
    .insert({ season_id: season.id, name, kind: $('#cpKind').value });
  if (error) return oops(error);
  say('Competition ' + name + ' added.', 'ok');
  $('#cpName').value = '';
  await loadComps();
});

$('#tmGo').addEventListener('click', async () => {
  const name = $('#tmName').value.trim();
  if (!name) return say('Name the team.', 'err');
  const short = ($('#tmShort').value.trim() || name.slice(0, 3)).toUpperCase();
  const { data, error } = await sb.from('teams').insert({
    league_id: league.id, name, short_name: short,
    colour: $('#tmCol').value,
    slug: slugify(name) + '-' + Math.random().toString(36).slice(2, 6)
  }).select('id').single();
  if (error) return oops(error);

  // creating a team inside a competition almost always means entering it
  if (comp && data) {
    const { error: e2 } = await sb.from('competition_teams')
      .insert({ competition_id: comp.id, team_id: data.id });
    if (e2) oops(e2);
  }
  say(name + (comp ? ' created and entered in ' + comp.name : ' created'), 'ok');
  $('#tmName').value = ''; $('#tmShort').value = '';
  await loadTeams();
});

$('#fxGo').addEventListener('click', async () => {
  if (!comp) return say('Pick a competition first.', 'err');
  const h = $('#fxHome').value, a = $('#fxAway').value;
  if (!h || !a) return say('Choose both teams.', 'err');
  if (h === a) return say('A team cannot play itself.', 'err');
  const when = $('#fxWhen').value;
  const { error } = await sb.from('games').insert({
    competition_id: comp.id, home_team_id: h, away_team_id: a,
    tipoff_at: when ? new Date(when).toISOString() : null,
    venue: $('#fxVenue').value.trim() || null
  });
  if (error) return oops(error);
  say('Fixture scheduled.', 'ok');
  $('#fxVenue').value = '';
  await loadFixtures();
});

$('#grGo').addEventListener('click', async () => {
  const v = $('#grEmail').value.trim();
  if (!v) return say('Enter the email address of the account to grant.', 'err');
  const { data, error } = await sb.rpc('grant_role', {
    p_email: v, p_role: $('#grRole').value,
    p_scope_type: 'league', p_scope_id: league.id
  });
  if (error) return oops(error);
  say(data, /^no account/.test(data) ? 'err' : 'ok');
  if (!/^no account/.test(data)) { $('#grEmail').value = ''; loadMembers(); }
});

boot();
