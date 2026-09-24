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
let seasons = [], comps = [], teams = [], fixtures = [], enteredRows = [];

function say(text, kind) {
  const m = $('#msg');
  m.setAttribute('data-i18n-ctx', 'msg');
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

/* "To be determined", "TBC", "Winner of QF1": a cup draw's side that is not known yet
   is never a club. The same patterns, character for character, as
   scripts/ingest/placeholders.py and public.is_placeholder_team_name (0126), all tested
   against supabase/tests/fixtures/placeholder_teams.json. */
const PLACEHOLDER_PATTERNS = [
  '^(team )?t ?b ?[dca]( ?[0-9]+)?( ?\\(.*\\))?$',
  '^to be (determined|confirmed|decided|announced|named|assigned|agreed)( .*)?$',
  '^(winners?|losers?) (of )?(the )?(qf|sf|semi|quarter|final|game|match|round|tie|r[0-9]|g[0-9]|m[0-9]|#)',
  '^(qf|sf|semi ?-?final|quarter ?-?final|game|match|round|tie) ?[0-9]* (winners?|losers?)$',
  '^(bye|unknown( team)?|placeholder|not yet (known|determined|decided))$',
  '^t ?b ?[dca] vs?\\.? t ?b ?[dca]$'
];
const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PATTERNS.map(p => '(?:' + p + ')').join('|'));
function isPlaceholderTeam(name) {
  const s = String(name == null ? '' : name).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return !!s && PLACEHOLDER_RE.test(s);
}

/* ------------------------------------------------------------------- boot --- */
async function boot() {
  sb = window.epinoiaClient && epinoiaClient();
  if (!sb) { say('No Supabase key in config.js — administration needs one.', 'err'); return; }

  const { data: { session } } = await sb.auth.getSession();
  me = session && session.user;

  /* RE-RENDER ONLY WHEN THE PERSON CHANGES.

     This is why typed Instagram links vanished after a couple of seconds. The
     Supabase client fires onAuthStateChange for INITIAL_SESSION on
     subscription and again for TOKEN_REFRESHED a moment later — neither of
     which is a different user — and each one re-ran render(), which rebuilds
     every panel on the page from the database. Anything half-typed went with
     them, a second or two after the page settled, with nothing on screen to
     explain it.

     Comparing the id rather than the object because the client hands back a
     fresh object each time; the identity is the only thing worth reacting to. */
  sb.auth.onAuthStateChange((_e, sess) => {
    const next = sess && sess.user;
    if ((next && next.id) === (me && me.id)) { me = next; return; }
    me = next;
    render();
  });
  render();
}

async function render() {
  show('#signin', !me);
  show('#out', !!me);
  show('#idsec', !!me);
  $('#who').textContent = me ? me.email : '';
  if (!me) { show('#ws', false); return; }

  const { data, error } = await sb.rpc('whoami');
  if (error) { show('#ws', false); return oops(error); }
  who = data || {};

  renderAccess();
  /* CREATING A LEAGUE IS NOT LEAGUE ADMINISTRATION. A league administrator
     administers one competition; the platform console is where leagues come
     into existence, and it is where deleting one already lives. Having the
     form here as well meant the most consequential button on the platform
     appeared on the page forty people use for fixtures. The RPC has always
     refused anybody but a platform admin — this is the UI catching up. */
  show('#platLink', !!who.is_platform_admin);

  const admin = who.leagues || [];
  show('#ws', admin.length > 0);
  if (!admin.length) return;

  if (!league || !admin.some(l => l.id === league.id)) league = admin[0];
  renderLeaguePick(admin);
  /* The season and the competitions are read through functions rather than
     passed by value: this panel is mounted once and the operator changes
     season underneath it, and a captured `season` would keep exporting the
     one that happened to be selected when the page loaded. */
  window.EpinoiaStreamUI.mount({ host: '#streamPanel', sb, say,
    league: () => league });
  window.EpinoiaBcastImg.mount({ host: '#bcastImgPanel', sb, say,
    league: () => league });
  window.EpinoiaOfficials.mount({ host: '#officialsPanel', sb, say,
    league: () => league });
  window.EpinoiaExportUI.mount({ host: '#exportPanel', sb, say,
    season: () => season, competitions: () => comps });
  if (window.EpinoiaFeedUI) window.EpinoiaFeedUI.mount({ host: '#feedPanel', sb, say, league: () => league, isPlatformAdmin: () => !!who.is_platform_admin });
  window.EpinoiaKeys.mount({ host: '#keysPanel', sb, league, say });
  window.EpinoiaWebhook.mount({ host: '#webhookPanel', sb, league, say });
  window.EpinoiaFeeds.mount({ host: '#feedsPanel', sb, league, say,
                                cfg: window.EPINOIA_CONFIG });
  /* Seasons & competitions, part two: asking for an OLDER season to be read in.
     Mounted once with getters, and redrawn from loadLeague() — the season list
     it marks up is the one that has just been loaded for this league. */
  window.EpinoiaBackfill.mount({ host: '#backfillPanel', sb, say,
                                league: () => league, seasons: () => seasons });
  window.EpinoiaMerchUI.mount({ host: '#merchPanel', sb, league, say,
                                cfg: window.EPINOIA_CONFIG,
                                season: season ? season.name : '' });
  await loadLeague();
  /* ARRIVING ON #fixtures FROM A LEAGUE PAGE. A league page with nothing
     scheduled sends its admin straight here (home.js offerSchedule). The
     browser's own jump happens at parse time, long before the seasons, the
     competitions and the fixture list have loaded and moved everything down the
     page, so by now it is pointing somewhere else entirely. Done once, after
     the load, and only for the one anchor that is linked to from outside. */
  if (location.hash === '#fixtures') {
    const sec = document.getElementById('fixtures');
    if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
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
    const go = el('a', 'ep-btn mini pri', 'open scorer');
    go.href = '../score/?g=' + encodeURIComponent(g.game_id) + '&mode=supabase';
    sp.appendChild(go); row.appendChild(sp);
    host.appendChild(row);
  });
}

function renderLeaguePick(admin) {
  const host = $('#lgPick'); host.textContent = '';
  admin.forEach(l => {
    const b = el('button', 'ep-chip' + (league && l.id === league.id ? ' on' : ''), l.name);
    b.type = 'button';
    b.addEventListener('click', async () => {
      league = l; season = null; comp = null;
      renderLeaguePick(admin); await loadLeague();
    });
    host.appendChild(b);
  });
  const view = el('a', 'ep-chip', 'view public page ↗');
  view.href = '../l/?l=' + encodeURIComponent(league.slug);
  view.target = '_blank'; view.rel = 'noopener';
  host.appendChild(view);
  /* whoami() marks how a league is held (migration 0050). A platform admin
     is offered every league on the platform, and being told that beats
     wondering why forty of them are listed. */
  const via = (admin[0] || {}).via;
  $('#lgNote').textContent = (league ? league.slug : '') +
    (via === 'platform' ? ' · all leagues, as platform admin' : '');

  /* the shop the merchandise section points at — public, unlike the feed
     endpoints, because a shop link is meant to be found */
  $('#shopUrl').value = league.store_url || '';
  $('#shopName').value = league.store_name || '';
}

async function saveShop(url, name) {
  const { error } = await sb.rpc('set_league_store',
    { p_league: league.id, p_url: url || null, p_name: name || null });
  if (error) return oops(error);
  league.store_url = url || null;
  league.store_name = url ? (name || null) : null;
  $('#shopUrl').value = league.store_url || '';
  $('#shopName').value = league.store_name || '';
  say(url ? 'Shop saved — the merchandise section now links to it.'
          : 'Shop link cleared.', 'ok');
}

/* ------------------------------------------------------------ league load --- */
async function loadLeague() {
  /* whoami() returns a league's identity, not its settings, so the shop link
     is read here rather than assumed absent — an empty box that silently means
     "not loaded" would have an administrator wipe a working link by pressing
     save on a form they never filled in. */
  const { data: row } = await sb.from('leagues')
    .select('store_url,store_name,gender,visibility').eq('id', league.id).maybeSingle();
  if (row) {
    league.store_url = row.store_url;
    league.store_name = row.store_name;
    league.gender = row.gender || '';
    league.visibility = row.visibility || 'public';
    $('#shopUrl').value = row.store_url || '';
    $('#shopName').value = row.store_name || '';
    $('#lgGender').value = league.gender;
  }
  /* The invitation panel exists only for a private league (0139). Whether this
     league is private is the platform's decision and cannot be changed from
     here, so this reads the column and draws accordingly rather than offering
     a switch it would be refused for using. */
  if (league.visibility === 'private') { $('#invSec').classList.remove('hide'); loadInvites(); }

  const { data, error } = await sb.from('seasons')
    .select('id,name,starts_on,ends_on').eq('league_id', league.id).order('starts_on', { ascending: false });
  if (error) return oops(error);
  seasons = data || [];
  if (!season || !seasons.some(s => s.id === season.id)) season = seasons[0] || null;
  renderSeasonPick();
  if (window.EpinoiaBackfill) window.EpinoiaBackfill.refresh();
  await loadComps();
  await loadTeams();
}

/* ------------------------------------------- editing what is already there ---
   A SEASON AND A COMPETITION COULD ONLY BE ADDED. Every other thing in this
   console can be corrected, and these two could not: a season named "2026-27"
   when the league runs on calendar years, a competition called "League" that
   should say "Division One", a start date typed into the wrong box. The only
   way out was a second one beside it, which is worse than the typo.

   The editor opens under the picker, on the one that is PICKED, rather than
   putting controls on every chip: the chips are how you choose which season you
   are working in, and hanging a pencil and a bin off each of them turns a row
   of choices into a row of hazards.

   WHAT DELETING ACTUALLY DOES is spelled out at the moment of asking, because
   it is not what people assume. Games are NOT deleted — games.competition_id is
   `on delete set null` (0001), so every played game survives with its events
   intact. It becomes an ad-hoc game: out of the table, out of the fixture list,
   out of every season statistic, and reachable only by its own link. That is
   recoverable-in-principle and invisible-in-practice, which is exactly the kind
   of thing somebody needs told before they press it, not after. */
function editorRow() {
  const r = el('div', 'gv-edit');
  r.style.marginTop = 'calc(var(--u)*1.5)';
  return r;
}

/* How much a delete would take out of the tables. Asked at the moment of the
   press rather than kept up to date, because it is one query and it is the
   number the sentence turns on. */
async function gamesUnder(compIds) {
  if (!compIds.length) return 0;
  const { count, error } = await sb.from('games')
    .select('id', { count: 'exact', head: true }).in('competition_id', compIds);
  return error ? -1 : (count || 0);
}

function describeLoss(n) {
  if (n < 0) return 'Any games in it stay on Epinoia but leave the table and the fixture list.';
  if (n === 0) return 'Nothing has been played in it, so nothing is lost.';
  return n + (n === 1 ? ' game' : ' games') + ' stay on Epinoia with their box scores, but ' +
         'leave the table, the fixture list and the season statistics — they become ad-hoc ' +
         'games, reachable only by their own link.';
}

function renderSeasonPick() {
  const host = $('#snPick'); host.textContent = '';
  $('#snEdit').textContent = '';
  if (!seasons.length) {
    host.appendChild(el('div', 'empty', 'No seasons yet — add one above to begin.'));
    return;
  }
  seasons.forEach(s => {
    const b = el('button', 'ep-chip' + (season && s.id === season.id ? ' on' : ''), s.name);
    b.type = 'button';
    b.addEventListener('click', async () => { season = s; comp = null; renderSeasonPick(); await loadComps(); });
    host.appendChild(b);
  });
  if (!season) return;
  const edit = el('button', 'ep-chip', 'edit ' + season.name);
  edit.type = 'button';
  edit.addEventListener('click', () => {
    const box = $('#snEdit');
    if (box.textContent) { box.textContent = ''; return; }
    openSeasonEditor(box);
  });
  host.appendChild(edit);
}

function openSeasonEditor(box) {
  box.textContent = '';
  const r = editorRow();
  const row = el('div', 'row');
  const name = el('input', 'ep-input'); name.value = season.name; name.maxLength = 60;
  const from = el('input', 'ep-input'); from.type = 'date'; from.value = season.starts_on || '';
  from.title = 'starts on';
  const to = el('input', 'ep-input'); to.type = 'date'; to.value = season.ends_on || '';
  to.title = 'ends on';
  const save = el('button', 'ep-btn mini pri', 'save'); save.type = 'button';
  const del = el('button', 'ep-btn mini dgr', 'delete season'); del.type = 'button';
  const sp = el('span'); sp.style.marginLeft = 'auto';
  row.append(name, from, to, save, sp, del);
  r.appendChild(row);
  box.appendChild(r);

  save.addEventListener('click', async () => {
    const v = name.value.trim();
    if (!v) return say('A season needs a name.', 'err');
    save.disabled = true;
    const { error } = await sb.from('seasons').update({
      name: v, starts_on: from.value || null, ends_on: to.value || null }).eq('id', season.id);
    save.disabled = false;
    if (error) return oops(error);
    say('Saved ' + v + '.', 'ok');
    box.textContent = '';
    await loadLeague();
  });

  del.addEventListener('click', async () => {
    const ids = comps.map(c => c.id);
    const n = await gamesUnder(ids);
    const what = comps.length === 1
      ? 'Its one competition goes with it.'
      : comps.length ? 'Its ' + comps.length + ' competitions go with it.'
                     : 'It has no competitions in it.';
    if (!confirm('Delete the season "' + season.name + '"?\n\n' +
                 what + ' ' + describeLoss(n) + '\n\nThis cannot be undone.')) return;
    const { error } = await sb.from('seasons').delete().eq('id', season.id);
    if (error) return oops(error);
    say('Deleted ' + season.name + '.', 'ok');
    season = null; comp = null;
    await loadLeague();
  });
}

function openCompEditor(box) {
  box.textContent = '';
  const r = editorRow();
  const row = el('div', 'row');
  const name = el('input', 'ep-input'); name.value = comp.name; name.maxLength = 60;
  const kind = el('select', 'ep-input'); kind.style.flex = '0 0 auto';
  ['league', 'cup', 'playoff'].forEach(k => kind.append(new Option(k, k)));
  kind.value = comp.kind || 'league';
  const save = el('button', 'ep-btn mini pri', 'save'); save.type = 'button';
  const del = el('button', 'ep-btn mini dgr', 'delete competition'); del.type = 'button';
  const sp = el('span'); sp.style.marginLeft = 'auto';
  row.append(name, kind, save, sp, del);
  r.appendChild(row);
  box.appendChild(r);

  save.addEventListener('click', async () => {
    const v = name.value.trim();
    if (!v) return say('A competition needs a name.', 'err');
    save.disabled = true;
    const { error } = await sb.from('competitions').update({ name: v, kind: kind.value })
      .eq('id', comp.id);
    save.disabled = false;
    if (error) return oops(error);
    say('Saved ' + v + '.', 'ok');
    box.textContent = '';
    await loadComps();
  });

  del.addEventListener('click', async () => {
    const n = await gamesUnder([comp.id]);
    if (!confirm('Delete the competition "' + comp.name + '"?\n\n' +
                 describeLoss(n) + '\n\nThis cannot be undone.')) return;
    const { error } = await sb.from('competitions').delete().eq('id', comp.id);
    if (error) return oops(error);
    say('Deleted ' + comp.name + '.', 'ok');
    comp = null;
    await loadComps();
  });
}

async function loadComps() {
  comps = [];
  if (season) {
    const { data, error } = await sb.from('competitions')
      .select('id,name,kind,format,qualifiers').eq('season_id', season.id).order('name');
    if (error) return oops(error);
    comps = data || [];
  }
  if (!comp || !comps.some(c => c.id === comp.id)) comp = comps[0] || null;
  renderCompPick();
  await loadFixtures();
  await loadMembers();
  await loadMediaQueue();
}

function renderCompPick() {
  const host = $('#cpPick'); host.textContent = '';
  $('#cpEdit').textContent = '';
  if (!season) return;
  if (!comps.length) {
    host.appendChild(el('div', 'empty',
      'No competitions in this season. A competition is what holds a table and a fixture list.'));
    return;
  }
  comps.forEach(c => {
    const b = el('button', 'ep-chip' + (comp && c.id === comp.id ? ' on' : ''), c.name);
    b.type = 'button';
    b.addEventListener('click', async () => { comp = c; renderCompPick(); await loadTeams(); await loadFixtures(); });
    host.appendChild(b);
  });
  if (!comp) return;
  const edit = el('button', 'ep-chip', 'edit ' + comp.name);
  edit.type = 'button';
  edit.addEventListener('click', () => {
    const box = $('#cpEdit');
    if (box.textContent) { box.textContent = ''; return; }
    openCompEditor(box);
  });
  host.appendChild(edit);
}

/* ---------------------------------------------------------- announcements --- */
/* A NOTICE TO THE FANS, A MESSAGE TO THE CLUBS. post_announcement (0106) writes the notice and
   fans it out as notifications -- to everyone following a club in this league, to the managers
   of every club or of one club -- and the notify function then emails and pushes to those who
   asked for that on their profile. */
async function loadAnnouncements() {
  const host = $('#anList'); if (!host || !league) return;
  host.textContent = '';
  const { data } = await sb.from('announcements').select('id,title,body,audience,team_id,created_at')
    .eq('league_id', league.id).order('created_at', { ascending: false }).limit(20);
  (data || []).forEach(a => {
    const row = document.createElement('div'); row.className = 'item';
    const t = teams.find(x => x.id === a.team_id);
    row.innerHTML = '<b>' + esc(a.title) + '</b> <span class="ep-micro" data-i18n-ctx="audience">' +
      esc(a.audience === 'fans' ? 'fans' : a.audience === 'club_admins' ? ('managers' + (t ? ' of ' + t.name : '')) : 'fans + managers') +
      ' · ' + new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</span>' +
      (a.body ? '<div class="ep-micro" style="margin-top:3px">' + esc(a.body).slice(0, 200) + '</div>' : '');
    host.appendChild(row);
  });
  const sel = $('#anTeam');
  if (sel) {
    sel.innerHTML = '<option value="">every club</option>' + teams.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
  }
}
async function deliverNow() {
  /* the notify function delivers what was just written, by email and push, to those who asked */
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    await fetch(window.EPINOIA_CONFIG.supabaseUrl + '/functions/v1/notify', {
      method: 'POST', headers: { apikey: window.EPINOIA_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch (_) { /* the ingest's next pass delivers it anyway */ }
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ teams --- */
async function loadTeams() {
  const { data, error } = await sb.from('teams')
    .select('id,name,short_name,colour,slug').eq('league_id', league.id).order('name');
  if (error) return oops(error);
  teams = data || [];
  loadAnnouncements().catch(() => {});

  let entered = new Set();
  enteredRows = [];
  if (comp) {
    const { data: ct } = await sb.from('competition_teams')
      .select('team_id,group_name').eq('competition_id', comp.id);
    enteredRows = ct || [];
    entered = new Set(enteredRows.map(r => r.team_id));
  }
  mountFormats();
  /* MOUNTED HERE, NOT AT THE END OF loadFixtures(). That function returns
     early when no competition is picked — which is the normal state on a
     fresh league — so suspensions, the club and player record, awards and the
     socials panel never appeared at all. Each of them puts up its own "pick a
     competition" line when it needs one, and three of them never do. */
  mountGovernance();

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
      const b = el('button', 'ep-btn mini' + (inComp ? ' dgr' : ''),
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
    const view = el('a', 'ep-btn mini', 'page ↗');
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

  /* SAY WHAT IS MISSING, AND WHERE IT IS.

     A league page sends its admin straight to this section (home.js
     offerSchedule), and two disabled dropdowns reading "enter teams first" is
     the whole of what the page used to tell them — with the thing to do about
     it in a section ABOVE, which they have just been scrolled past. A fixture
     needs a competition and two clubs entered in it; this names whichever is
     missing and links to the section that fixes it, so the answer is one press
     rather than a hunt.

     Nothing is said once it can work: a note that stays up after it stops being
     true is a note people learn to read past. */
  const note = $('#fxNote');
  if (!note) return;
  note.textContent = '';
  const need = (text, href) => {
    note.append(document.createTextNode(text + ' '));
    const a = el('a', null, href === '#fixtures' ? '' : 'go there →');
    a.href = href;
    a.style.color = 'var(--lume)';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const el2 = document.querySelector(href);
      if (el2) el2.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    note.appendChild(a);
  };
  if (!season) need('A fixture lives in a season — add one first.', '#seasons');
  else if (!comp) need('A fixture lives in a competition — add one first.', '#seasons');
  else if (pool.length < 2) {
    need(pool.length === 1
      ? 'One club is entered in ' + comp.name + '. A fixture needs two.'
      : 'No clubs are entered in ' + comp.name + ' yet.', '#teams');
  }
}

/* The format controls need the competition, the clubs entered in it and their
   groups — all of which loadTeams has just read, so it rebuilds them from there
   rather than fetching the same rows a second time. */
function mountFormats() {
  const byId = {};
  teams.forEach(t => { byId[t.id] = t; });
  $('#fmtNote').textContent = comp ? (comp.format || 'table') : '';
  window.EpinoiaFormats.mount({
    host: '#formatPanel', sb, comp, comps, teams: byId,
    entered: enteredRows, say, cfg: window.EPINOIA_CONFIG,
    onDone: () => { loadTeams(); loadFixtures(); }
  });
}

/* --------------------------------------------------------------- fixtures --- */
/* THE FIXTURE LIST.

   Three ways it used to come out wrong, each fixed here:
     * two loads overlapping (a move, an edit and the competition picker all reload
       it, none of them waiting) both cleared the list BEFORE their query and both
       drew AFTER it, so every game appeared twice. Only the newest load draws now,
       and it clears the list at the moment it draws;
     * a competition with no fixtures returned before the import and "Generate a
       season" panels were rebuilt, so they stayed bound to the competition picked
       before — the one moment they are most needed, pointed at the wrong place;
     * a club from another league (a cup tie) was drawn as "—": the list only knew
       this league's clubs. Their names are fetched with the fixtures.
   A season can be 200+ games, so the list is folded away in one row that starts
   closed on every visit, keeps whatever state it was left in when it reloads, and
   builds its rows only when it is opened. Games are read a thousand at a time, the
   most one request returns. */
let fxSeq = 0;
let fxOpen = false;
let fxShow = 'all';          // all | toplay | played
let fxOtherTeams = [];

async function loadFixtures() {
  const seq = ++fxSeq;
  let rows = [], others = [];
  if (comp) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('games')
        .select('id,tipoff_at,venue,status,home_score,away_score,home_team_id,away_team_id,roster_snapshot')
        .eq('competition_id', comp.id).order('tipoff_at', { ascending: true, nullsFirst: false }).order('id')
        .range(from, from + 999);
      if (seq !== fxSeq) return;
      if (error) return oops(error);
      rows = rows.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const known = new Set(teams.map(t => t.id));
    const missing = [...new Set(rows.flatMap(g => [g.home_team_id, g.away_team_id]))].filter(id => id && !known.has(id));
    if (missing.length) {
      const { data } = await sb.from('teams').select('id,name,short_name,colour,slug').in('id', missing);
      if (seq !== fxSeq) return;
      others = data || [];
    }
  }
  fixtures = rows;
  fxOtherTeams = others;
  drawFixtures();
  /* always, and after the list: an empty competition is exactly when these are needed */
  mountImport();
  mountFixtureGen();
}

const fxPlayed = g => !(g.status === 'scheduled' || g.status === 'live');
/* Opened, the list draws thirty games and a button for thirty more. How far down it
   has been opened survives a reload (a move or an edit reloads the list); another
   competition, or another filter, starts from the first thirty again. */
const FX_PAGE = 30;
let fxLimit = FX_PAGE;
let fxCompId = null;

function drawFixtures() {
  const host = $('#fxList');
  host.textContent = '';
  if (!comp) { $('#fxNote').textContent = 'pick a competition'; return; }
  if (fxCompId !== comp.id) { fxCompId = comp.id; fxLimit = FX_PAGE; fxShow = 'all'; }
  const live = fixtures.filter(g => g.status === 'live').length;
  const toPlay = fixtures.filter(g => g.status === 'scheduled').length;
  const played = fixtures.length - live - toPlay;
  const parts = [toPlay + ' to play', live ? live + ' live' : '', played + ' played'].filter(Boolean);
  $('#fxNote').textContent = fixtures.length ? fixtures.length + ' fixture' + (fixtures.length === 1 ? '' : 's') + ' · ' + parts.join(' · ') : 'no fixtures yet';
  if (!fixtures.length) {
    host.appendChild(el('div', 'empty', 'No fixtures yet. Schedule one above, generate a season or import a game below.'));
    return;
  }

  const box = document.createElement('details');
  box.className = 'fxbox';
  box.open = fxOpen;
  const sum = document.createElement('summary');
  sum.append(el('b', null, 'All ' + fixtures.length + ' fixtures'), el('span', 'n', parts.join(' · ')),
             el('span', 'hint', box.open ? 'hide' : 'show'));
  box.appendChild(sum);
  const inner = el('div', 'fxinner');
  box.appendChild(inner);
  let built = false;
  const build = () => { if (!built) { built = true; buildFixtureRows(inner); } };
  box.addEventListener('toggle', () => {
    fxOpen = box.open;
    sum.querySelector('.hint').textContent = box.open ? 'hide' : 'show';
    if (box.open) build();
  });
  host.appendChild(box);
  if (box.open) build();
}

function buildFixtureRows(host) {
  const byId = new Map(teams.concat(fxOtherTeams).map(t => [t.id, t]));
  const pool = () => fixtures.filter(g => fxShow === 'toplay' ? !fxPlayed(g) : fxShow === 'played' ? fxPlayed(g) : true);

  /* which games are shown: every one, the ones still to play, or the ones played */
  const filter = el('div', 'fxfilter');
  filter.setAttribute('data-i18n-ctx', 'chip');
  const chips = [['all', 'all'], ['toplay', 'to play'], ['played', 'played']].map(([k, label]) => {
    const b = el('button', 'ep-chip' + (fxShow === k ? ' on' : ''), label);
    b.type = 'button';
    b.dataset.k = k;
    b.setAttribute('aria-pressed', String(fxShow === k));
    b.addEventListener('click', () => {
      if (fxShow === k) return;
      fxShow = k;
      fxLimit = FX_PAGE;
      chips.forEach(c => { const on = c.dataset.k === k; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
      renderRows();
    });
    return b;
  });
  filter.append(el('span', 'note', 'show'), ...chips);
  host.appendChild(filter);
  let resetBulk = () => {};

  /* BLOCK DESIGNATION. A whole round of cup ties entered under the league, or a
     feed that could only file everything under one phase: tick the games and
     move them together, before or after they are played. Same move as the
     per-row control — one update per game, both tables rebuilt afterwards.
     Only offered when there is somewhere to move them TO. */
  if (comps.length > 1) {
    const bar = el('div', 'fxbulk');
    const all = el('label', 'fxbulk-all');
    const allBox = document.createElement('input'); allBox.type = 'checkbox'; allBox.title = 'tick every game shown';
    all.append(allBox, document.createTextNode(' select all shown'));
    const sel = el('select', 'ep-input mini');
    sel.appendChild(el('option', null, 'move ticked games to…')).value = '';
    comps.filter(c => c.id !== comp.id).forEach(c => {
      const o = el('option', null, c.name + (c.kind && c.kind !== 'league' ? ' (' + c.kind + ')' : ''));
      o.value = c.id; sel.appendChild(o);
    });
    const count = el('span', 'note', '');
    const ticked = () => [...host.querySelectorAll('input.fxpick:checked')].map(i => i.value);
    const refresh = () => { const n = ticked().length; count.textContent = n ? n + ' ticked' : ''; sel.disabled = !n; };
    /* "shown" is the rows drawn so far: games further down are not ticked by it */
    allBox.addEventListener('change', () => {
      host.querySelectorAll('input.fxpick').forEach(i => { i.checked = allBox.checked; });
      refresh();
    });
    host.addEventListener('change', e => { if (e.target && e.target.classList && e.target.classList.contains('fxpick')) refresh(); });
    resetBulk = () => { allBox.checked = false; refresh(); };
    sel.addEventListener('change', async () => {
      const to = comps.find(c => c.id === sel.value);
      const ids = ticked();
      if (!to || !ids.length) { sel.value = ''; return; }
      if (!confirm('Move ' + ids.length + ' game' + (ids.length === 1 ? '' : 's') + ' to ' + to.name + '? Both tables will be rebuilt.')) { sel.value = ''; return; }
      sel.disabled = true;
      let moved = 0, failed = 0;
      for (const id of ids) {
        const { error } = await sb.from('games').update({ competition_id: to.id, tie_id: null, leg: null }).eq('id', id);
        if (error) failed++; else moved++;
      }
      for (const cid of [comp.id, to.id]) {
        await sb.rpc('recompute_standings', { p_competition: cid });
        await sb.rpc('compute_season_awards', { p_competition: cid });
        await sb.rpc('advance_bracket', { p_competition: cid });
      }
      say(moved + ' moved to ' + to.name + (failed ? ', ' + failed + ' refused' : '') + '.', failed ? 'warn' : 'ok');
      loadFixtures(); loadStandingsDependents();
    });
    bar.append(all, sel, count);
    host.appendChild(bar);
    refresh();
  }

  const list = el('div', 'fxrows');
  const foot = el('div', 'fxfoot');
  const more = el('button', 'ep-btn fxmore');
  more.type = 'button';
  const shown = el('span', 'note', '');
  foot.append(more, shown);
  host.append(list, foot);

  let drawn = 0, month = null;
  function renderRows() {
    list.textContent = '';
    drawn = 0;
    month = null;
    drawUpTo(fxLimit);
    resetBulk();
  }
  function drawUpTo(limit) {
    const games = pool();
    if (!games.length) {
      list.appendChild(el('div', 'empty', fxShow === 'toplay' ? 'Nothing left to play.' : fxShow === 'played' ? 'Nothing played yet.' : 'No fixtures.'));
    }
    const stop = Math.min(limit, games.length);
    for (; drawn < stop; drawn++) {
      const g = games[drawn];
      const at = g.tipoff_at ? new Date(g.tipoff_at) : null;
      const m = at ? at.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Date to be confirmed';
      if (m !== month) { month = m; list.appendChild(el('div', 'fxmonth', m)); }
      list.appendChild(fixtureRow(g, byId));
    }
    const left = games.length - drawn;
    more.textContent = 'Show ' + Math.min(FX_PAGE, left) + ' more';
    more.classList.toggle('hide', left <= 0);
    shown.textContent = games.length ? drawn + ' of ' + games.length + ' shown' : '';
  }
  more.addEventListener('click', () => { fxLimit = drawn + FX_PAGE; drawUpTo(fxLimit); });
  renderRows();
}

/* one fixture's row: when, who, the score, and what can be done with it */
function fixtureRow(g, byId) {
  const row = el('div', 'fxrow');
  if (comps.length > 1) {
    const pick = document.createElement('input'); pick.type = 'checkbox'; pick.className = 'fxpick'; pick.value = g.id;
    pick.title = 'tick to move with the others';
    row.appendChild(pick);
  }
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
    const sc = el('a', 'ep-btn mini pri', 'score');
    sc.href = '../score/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
    sc.target = '_blank'; sc.rel = 'noopener';
    ac.appendChild(sc);
    const st = el('button', 'ep-btn mini', 'staff');
    st.type = 'button';
    st.addEventListener('click', () => officials(g, row));
    ac.appendChild(st);
  } else {
    const v = el('a', 'ep-btn mini', 'box ↗');
    v.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
    v.target = '_blank'; v.rel = 'noopener';
    ac.appendChild(v);
  }
  /* Move a fixture to another phase or into the cup.

     A game's phase is its competition — there is no second flag to keep in
     step, which is what stops a game being a league game on one page and a
     cup tie on another. Moving it is therefore a real move, and it changes
     both tables, so both are rebuilt afterwards. Only offered when there is
     somewhere to move it TO. */
  if (comps.length > 1) {
    const mv = el('select', 'ep-input mini fxmove');
    comps.forEach(c => {
      const o = el('option', null, c.name + (c.kind === 'cup' ? ' (cup)' : ''));
      o.value = c.id; mv.appendChild(o);
    });
    mv.value = comp.id;
    mv.title = 'move this fixture to another phase';
    mv.addEventListener('change', async () => {
      const to = comps.find(c => c.id === mv.value);
      if (!to || to.id === comp.id) return;
      if (!confirm('Move this fixture to ' + to.name + '? Both tables will be rebuilt.')) {
        mv.value = comp.id; return;
      }
      mv.disabled = true;
      const { error } = await sb.from('games')
        .update({ competition_id: to.id, tie_id: null, leg: null }).eq('id', g.id);
      if (error) { mv.disabled = false; mv.value = comp.id; return oops(error); }
      /* a played game counts towards a table, so BOTH ends have to be redone */
      for (const cid of [comp.id, to.id]) {
        await sb.rpc('recompute_standings', { p_competition: cid });
        await sb.rpc('compute_season_awards', { p_competition: cid });
        await sb.rpc('advance_bracket', { p_competition: cid });
      }
      say('Fixture moved to ' + to.name + '.', 'ok');
      loadFixtures();
    });
    ac.appendChild(mv);
  }

  /* Edit, delete, void — the surgery a secretary does all season. Supplied
     by governance-ui rather than built here so the rules about what a
     PLAYED game will accept live in one place beside the RPC that
     enforces them. */
  window.EpinoiaGovernance.fixtureActions({
    sb, game: g, comp, teams: byIdObj(), say, row,
    onDone: () => { loadFixtures(); loadStandingsDependents(); }
  }).forEach(n => ac.appendChild(n));

  row.appendChild(ac);
  return row;
}

/* teams is an array here and the governance module wants a lookup; one place
   to convert rather than four. */
function byIdObj() {
  const o = {};
  teams.forEach(t => { o[t.id] = t; });
  return o;
}

/* Standings, awards and the bracket all follow from the games, so anything
   that changes a result rebuilds all three rather than leaving two of them
   quietly disagreeing with the third. */
async function loadStandingsDependents() {
  if (!comp) return;
  await sb.rpc('compute_season_awards', { p_competition: comp.id });
  await sb.rpc('advance_bracket', { p_competition: comp.id });
}

/* The league-scoped panels are rebuilt only when the LEAGUE changes.
   loadTeams() runs on every competition change too, and rebuilding the
   socials, news and appearance panels from the database each time would throw
   away whatever was being typed into them for a reason that has nothing to do
   with them. */
let mountedFor = null;

function mountGovernance() {
  const G = window.EpinoiaGovernance;
  G.mountDiscipline({ host: '#disciplinePanel', sb, comp, teams: byIdObj(), say,
                      onDone: loadStandingsDependents });
  G.mountSuspensions({ host: '#suspensionPanel', sb, league, comps, say });
  G.mountRecords({ host: '#recordsPanel', sb, league, teams: byIdObj(), say,
                   onDone: () => loadTeams() });

  const A = window.EpinoiaAwards;
  A.mountOverrides({ host: '#awardsPanel', sb, comp, league, teams: byIdObj(), say });
  A.mountToty({ host: '#totyPanel', sb, comp, league, say });

  fillGrantTeams();

  /* league-scoped: once per league, not once per competition */
  if (mountedFor === league.id) return;
  mountedFor = league.id;
  window.EpinoiaSocialsUI.mount({ host: '#socialsPanel', sb, league, say,
                                  cfg: window.EPINOIA_CONFIG });
  /* the weekly fans' vote (0150): read-only tallies. Guarded like the newest
     panels, so a script that did not load cannot take the block down with it. */
  if (window.EpinoiaFanVoteUI) window.EpinoiaFanVoteUI.mount({ host: '#fanvotePanel', sb, league, say });
  window.EpinoiaNewsUI.mount({ host: '#newsPanel', sb, league, say,
                               cfg: window.EPINOIA_CONFIG });
  window.EpinoiaAppearance.mount({ host: '#appearancePanel', sb, league, say });
  window.EpinoiaEmbedsUI.mount({ host: '#embedsPanel', sb, league,
                                 teams: byIdObj(), say });
  if (window.EpinoiaEmbedsUI.mountNotify) {
    window.EpinoiaEmbedsUI.mountNotify({ host: '#notifyEmbedPanel', sb, league, teams: byIdObj(), say });
  }
  /* MEMBERSHIPS & ACCESS gets the league as a function, not the object. The
     keys, webhook and merch panels in render() were handed the value and kept
     acting on the first league after a chip switched it; this one reads the
     current league on every call and refuses a write if it no longer matches
     the league it drew. Guarded because it is the newest script on the page
     and a panel that did not load should not take the rest of this block
     down with it. */
  if (window.EpinoiaAccessUI) {
    window.EpinoiaAccessUI.mount({ host: '#paidAccessPanel', sb, league: () => league,
                                   say, oops, cfg: window.EPINOIA_CONFIG,
                                   isPlatformAdmin: () => !!(who && who.is_platform_admin) });
  }
}

/* The club picker beside the People form, which only means anything for the
   club-scoped role. A league admin can now appoint a club's manager
   (migration 0051) — before that, the one person with a list of who runs each
   club was the only one who could not hand out the role. */
function fillGrantTeams() {
  const sel = $('#grTeam');
  if (!sel) return;
  sel.textContent = '';
  teams.forEach(t => {
    const o = el('option', null, t.name);
    o.value = t.id; sel.appendChild(o);
  });
  if (!teams.length) sel.appendChild(el('option', null, 'no clubs in this league yet'));
  syncGrantScope();
}

function syncGrantScope() {
  const isTeam = $('#grRole').value === 'team_manager';
  $('#grTeam').classList.toggle('hide', !isTeam);
}

/* The generator needs the entered teams and their groups, plus what is already
   scheduled so a second run can say what it will replace. loadTeams has the
   first two and loadFixtures the third, so it is mounted from here where both
   are current. */
function mountFixtureGen() {
  const byId = {};
  teams.forEach(t => { byId[t.id] = t; });
  window.EpinoiaFixtureGen.mount({
    host: '#fixtureGen', sb, comp, teams: byId,
    entered: enteredRows, existing: fixtures, say,
    onDone: () => { loadFixtures(); }
  });
}

/* The import panel needs the fixtures and the clubs, so it is rebuilt whenever
   they are — a fixture scheduled a moment ago should be importable at once. */
function mountImport() {
  const byId = {};
  teams.forEach(t => { byId[t.id] = t; });
  $('#imNote').textContent = fixtures.length
    ? fixtures.length + ' fixture' + (fixtures.length === 1 ? '' : 's') + ' to choose from'
    : '';
  window.EpinoiaImportUI.mount({
    host: '#importPanel', sb, leagueId: league && league.id,
    games: fixtures, teams: byId, say,
    onDone: loadFixtures
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
  const email = el('input', 'ep-input grow');
  email.type = 'email'; email.placeholder = 'statistician@club.org';
  const go = el('button', 'ep-btn mini pri', 'assign'); go.type = 'button';
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
      const rm = el('button', 'ep-btn mini dgr', 'remove'); rm.type = 'button';
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

/* ----------------------------------------------------------- photographs --- */
/* The moderation queue. Approving is the moment an image reaches the open
   internet — it moves the object from the private bucket to the public one —
   so it is a deliberate act by a league admin, not a side effect of uploading.

   A pending image is fetched through a signed URL: it is not public yet, and
   showing it any other way would mean it was. */
async function loadMediaQueue() {
  const host = $('#mediaQueue'); host.textContent = '';
  let rows = [];
  try { const { data, error } = await sb.rpc('media_queue', { p_league: league.id });
        if (error) throw error; rows = data || []; }
  catch (e) { return oops(e); }

  $('#mqNote').textContent = rows.length
    ? rows.length + (rows.length === 1 ? ' waiting' : ' waiting') : 'nothing waiting';
  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No photographs are waiting for approval.'));
    return;
  }

  for (const m of rows) {
    const row = el('div', 'mq');

    /* a signed URL, because the object is deliberately not public yet */
    let src = null;
    try {
      const { data } = await sb.storage.from('media-pending')
        .createSignedUrl(m.storage_path, 300);
      src = data && data.signedUrl;
    } catch (_) {}
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.alt = m.subject || 'pending image'; img.loading = 'lazy';
      row.appendChild(img);
    } else {
      row.appendChild(el('div', null, ''));
    }

    const who = el('div');
    who.append(el('div', 'who', m.subject || '(unnamed)'),
               el('div', 'mt', m.owner_type + ' · uploaded ' +
                  new Date(m.created_at).toLocaleDateString('en-GB',
                    { day: '2-digit', month: 'short' })));
    row.appendChild(who);

    const ac = el('div', 'ac');
    const ok = el('button', 'ep-btn mini pri', 'approve'); ok.type = 'button';
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      /* THE FILE MOVES FIRST, and approve_media no longer tries to. A SQL
         update of storage.objects.bucket_id moved the row and left the bytes
         in the pending bucket, so an approved image 404'd — the state that had
         to be found by fetching one. Only the Storage API moves an object, so
         it happens here, and the row is marked approved only if it worked.

         "already exists" counts as done: the file is where it needs to be. */
      /* upload.js publishPending: the move, or a copy when storage refuses the move (it
         refused every one until 0123 — see the note there) */
      const pub = await window.EpinoiaUpload.publishPending(sb, m.storage_path);
      if (!pub.ok) {
        ok.disabled = false;
        return oops(new Error('could not publish the file: ' + pub.error.message));
      }
      const { data, error } = await sb.rpc('approve_media', { p_media: m.id });
      if (error) { ok.disabled = false; return oops(error); }
      say(data + ' — ' + (m.subject || 'image'), 'ok');
      loadMediaQueue();
    });
    const no = el('button', 'ep-btn mini dgr', 'reject'); no.type = 'button';
    no.addEventListener('click', async () => {
      no.disabled = true;
      /* The row first, the bytes after — see the note in the platform console.
         reject_media no longer deletes the object, because Supabase refuses a
         SQL delete on storage tables from any role, and that was failing every
         rejection on both consoles. */
      const { error } = await sb.rpc('reject_media', { p_media: m.id, p_reason: null });
      if (error) { no.disabled = false; return oops(error); }
      const gone = await Promise.all([
        sb.storage.from('media-pending').remove([m.storage_path]),
        sb.storage.from('media-public').remove([m.storage_path])
      ]);
      const stuck = gone.map(x => x && x.error)
        .filter(e => e && !/not found|does not exist/i.test(e.message || ''));
      no.disabled = false;
      say(stuck.length
        ? 'rejected, but the file is still there: ' + stuck[0].message
        : 'rejected — ' + (m.subject || 'image'), stuck.length ? 'err' : 'ok');
      loadMediaQueue();
    });
    ac.append(ok, no);
    row.appendChild(ac);
    host.appendChild(row);
  }
}

/* ---------------------------------------------- a private league's door --- */
/* Only a platform admin may mint a link that hands the league over
   (0139 refuses it here), so this page offers the one kind a league runs
   itself: a link that lets people SEE it. That is what a secretary needs
   twenty times a season and Epinoia needs to be asked for none of them. */
const inviteLink = tok => new URL('../invite/?i=' + encodeURIComponent(tok), location.href).href;

async function loadInvites() {
  const host = $('#invList'); host.textContent = '';
  const { data, error } = await sb.rpc('league_invites_list', { p_league: league.id });
  if (error) return oops(error);

  const live = (data || []).filter(i => !i.spent).length;
  $('#invNote').textContent = live
    ? 'private — ' + live + ' live link' + (live === 1 ? '' : 's')
    : 'private — no live link, so nobody new can get in';

  if (!data || !data.length) {
    host.appendChild(el('div', 'empty', 'No links yet. Make one above and send it.'));
  } else data.forEach(i => {
    const r = el('div', 'item');
    if (i.spent) r.style.opacity = '.45';
    const url = inviteLink(i.token);
    const nm = el('div', 'nm', url);
    nm.style.cssText = 'overflow-wrap:anywhere;font-family:var(--f-mono,monospace);font-size:11px';
    r.append(nm, el('div', 'mt',
      (i.role === 'league_admin' ? 'runs the league' : 'can see the league') +
      (i.label ? ' · ' + i.label : '') +
      /* "permanent" said out loud: it is the default, and a link that will keep
         working is the thing somebody wants to be sure of before pasting it
         into a group they cannot take it back out of. */
      ' · ' + (i.max_uses ? 'used ' + i.uses + ' of ' + i.max_uses
                          : 'permanent, used ' + i.uses) +
      (i.expires_at ? ' · until ' + new Date(i.expires_at).toLocaleDateString('en-GB',
                        { day: '2-digit', month: 'short', year: 'numeric' }) : '') +
      (i.revoked_at ? ' · revoked' : i.spent ? ' · finished' : '')));
    const sp = el('div', 'sp');
    const copy = el('button', 'ep-btn mini', 'copy'); copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); copy.textContent = 'copied'; }
      catch (_) { say(url, 'ok'); copy.textContent = 'shown above'; }
      setTimeout(() => { copy.textContent = 'copy'; }, 1600);
    });
    sp.appendChild(copy);
    if (!i.spent) {
      const kill = el('button', 'ep-btn mini dgr', 'revoke'); kill.type = 'button';
      kill.addEventListener('click', async () => {
        if (!confirm('Revoke this link?\n\nIt stops working straight away. Everybody who ' +
                     'already used it keeps their access — remove them below if that is ' +
                     'what you meant.')) return;
        const { data: res, error: e2 } = await sb.rpc('league_invite_revoke', { p_invite: i.id });
        if (e2) return oops(e2);
        say(res, 'ok'); loadInvites();
      });
      sp.appendChild(kill);
    }
    r.appendChild(sp);
    host.appendChild(r);
  });

  const gh = $('#invGuests'); gh.textContent = '';
  const { data: gs, error: ge } = await sb.rpc('league_guests_list', { p_league: league.id });
  if (ge) return oops(ge);
  if (!gs || !gs.length) {
    gh.appendChild(el('div', 'empty', 'Nobody has used a link yet.'));
    return;
  }
  gs.forEach(g => {
    const r = el('div', 'item');
    r.append(el('div', 'nm', g.email),
             el('div', 'mt', (g.role === 'league_admin' ? 'runs the league' : 'can see it') +
                             (g.label ? ' · came in on “' + g.label + '”' : '') +
                             ' · ' + new Date(g.joined_at).toLocaleDateString('en-GB',
                               { day: '2-digit', month: 'short', year: 'numeric' })));
    const sp = el('div', 'sp');
    const rm = el('button', 'ep-btn mini dgr', 'remove'); rm.type = 'button';
    rm.addEventListener('click', async () => {
      if (!confirm('Remove ' + g.email + ' from ' + league.name + '?\n\n' +
                   'They stop being able to open it. They can be let back in with ' +
                   'another link.')) return;
      const { data: res, error: e3 } = await sb.rpc('league_guest_remove',
        { p_league: league.id, p_user: g.user_id });
      if (e3) return oops(e3);
      say(res + ' — ' + g.email, 'ok'); loadInvites();
    });
    sp.appendChild(rm); r.appendChild(sp);
    gh.appendChild(r);
  });
}

/* ----------------------------------------------------------------- people --- */
async function loadMembers() {
  const host = $('#grList'); host.textContent = '';
  const { data, error } = await sb.rpc('league_members', { p_league: league.id });
  if (error) return oops(error);
  if (!data || !data.length) {
    /* ...but an invitation that has not landed yet still counts as somebody
       appointed, so the waiting list is drawn before giving up on the "nobody"
       line — otherwise a league whose only appointment is pending reads as a
       league where the grant did not work. */
    await loadPendingMembers(host);
    if (!host.children.length)
      host.appendChild(el('div', 'empty', 'No one else has a role in this league yet.'));
    return;
  }
  data.forEach(m => {
    const r = el('div', 'item');
    r.append(el('div', 'nm', m.email),
             el('div', 'mt', m.role.replace('_', ' ') + ' · ' + m.scope_type));
    r.lastChild.setAttribute('data-i18n-ctx', 'role');
    const sp = el('div', 'sp');
    const rm = el('button', 'ep-btn mini dgr', 'revoke'); rm.type = 'button';
    rm.addEventListener('click', async () => {
      rm.disabled = true;
      const { data: res, error: e2 } = await sb.rpc('revoke_role', { p_membership: m.membership_id });
      if (e2) { rm.disabled = false; return oops(e2); }
      say(res + ' — ' + m.email, 'ok'); loadMembers();
    });
    sp.appendChild(rm); r.appendChild(sp);
    host.appendChild(r);
  });
  await loadPendingMembers(host);
}

/* APPOINTMENTS THAT HAVE NOT FOUND THEIR PERSON YET (0140).

   Granting a role to an address with no account used to be refused, so this
   state did not exist; now it waits and lands by itself when they sign up. It
   is drawn in the same list as the real roles, dimmed and labelled, because the
   question a secretary is asking when they look here is "has Dan got access?" —
   and "invited, not signed up yet" is the answer to that question, while an
   empty space is not. */
async function loadPendingMembers(host) {
  const { data, error } = await sb.rpc('pending_roles_list', { p_league: league.id });
  if (error || !data || !data.length) return;
  data.forEach(p => {
    const r = el('div', 'item');
    r.style.opacity = '.68';
    r.append(el('div', 'nm', p.email),
             el('div', 'mt', p.role.replace(/_/g, ' ') + ' · waiting — no account on that ' +
                             'address yet, so it applies when they sign up'));
    r.lastChild.setAttribute('data-i18n-ctx', 'role');
    const sp = el('div', 'sp');
    const rm = el('button', 'ep-btn mini dgr', 'take back'); rm.type = 'button';
    rm.addEventListener('click', async () => {
      if (!confirm('Take back the invitation to ' + p.email + '?')) return;
      rm.disabled = true;
      const { data: res, error: e2 } = await sb.rpc('pending_role_cancel', { p_id: p.id });
      if (e2) { rm.disabled = false; return oops(e2); }
      say(res, 'ok'); loadMembers();
    });
    sp.appendChild(rm); r.appendChild(sp);
    host.appendChild(r);
  });
}

/* >>> THE CODE FROM THE EMAIL, INSIDE THE APP (roadmap Phase 6).

   A magic link's first stop is *.supabase.co, which no App Link covers, so a
   link tapped in Gmail finishes in the phone's default browser: that browser
   ends up signed in and the app does not. The same email also carries a code
   (the Magic Link template's {{ .Token }}), so inside the app (appmode.js:
   window.epinoiaApp, html.m-app) the form offers a field for it once the email
   has gone, and verifyOtp puts the session in the app that asked for it. The
   link still works, and outside the app none of this is ever drawn.

   Built from script rather than markup because one block serves all four
   sign-in forms. Kept character for character the same in signin/signin.js,
   app/app.js, admin/admin.js and admin/platform/platform.js; app-signin.test.mjs
   checks that and then runs it. The names are long on purpose: these files are
   classic scripts sharing one global scope with a dozen others.

   A code sign-in fires onAuthStateChange exactly as the link does, so each page
   carries on down its own post-sign-in path. Nothing here renders the page.

   NOT UNTIL THE EMAIL CARRIES THE CODE. The field is only drawn once config.js
   sets EPINOIA_CONFIG.emailOtp: true, which the owner does with the template
   change. Until then the same place in the app says plainly that the link
   signs in the phone's browser, not the app, and points to Google sign-in. */
let emailCodeResend = null;

function emailCodeInApp() {
  return !!window.epinoiaApp || document.documentElement.classList.contains('m-app');
}

function emailCodeInEmail() {
  const c = window.EPINOIA_CONFIG;
  return !!c && c.emailOtp === true;
}

/* Called after a send succeeds. Outside the app it returns null and the page
   says what it always said; inside, it shows the field (once) after `after`
   and returns it. `resend(email)` is the page's own send, rate limits and all. */
function offerEmailCode(after, email, resend) {
  if (!emailCodeInApp() || !after || !after.parentNode) return null;
  emailCodeResend = resend;
  let box = document.getElementById('emailCodeBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'emailCodeBox';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', 'emailCodeHint');
    box.style.cssText = 'flex-direction:column;gap:10px;margin:14px 0;max-width:360px';

    const hint = document.createElement('p');
    hint.id = 'emailCodeHint';
    hint.style.cssText = 'margin:0;font-size:14px;line-height:1.6;color:var(--ink-2)';

    const lab = document.createElement('label');
    lab.id = 'emailCodeLab';
    lab.htmlFor = 'emailCodeIn';
    lab.textContent = 'Code from the email';
    lab.style.cssText = 'font-family:var(--f-micro);font-size:9px;letter-spacing:.12em;' +
      'text-transform:uppercase;color:var(--ink-3)';

    /* 16px or a phone zooms the page on focus; numeric so the keypad is
       digits; one-time-code so the keyboard can offer the code it saw */
    const input = document.createElement('input');
    input.id = 'emailCodeIn';
    input.className = 'ep-input';
    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'one-time-code');
    input.setAttribute('pattern', '[0-9]*');
    input.setAttribute('maxlength', '12');
    input.setAttribute('aria-describedby', 'emailCodeHint');
    input.style.cssText = 'font-size:16px;letter-spacing:.3em;max-width:220px';

    const row = document.createElement('div');
    row.id = 'emailCodeRow';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    const go = document.createElement('button');
    go.id = 'emailCodeGo';
    go.type = 'button';
    go.className = 'ep-btn pri';
    go.textContent = 'Verify';
    const again = document.createElement('button');
    again.id = 'emailCodeAgain';
    again.type = 'button';
    again.className = 'ep-btn';
    again.textContent = 'Send a new code';
    row.append(go, again);
    box.append(hint, lab, input, row);

    go.addEventListener('click', () => verifyEmailCode(box));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') verifyEmailCode(box); });
    again.addEventListener('click', async () => {
      if (typeof emailCodeResend !== 'function' || again.disabled) return;
      again.disabled = true;
      try { await emailCodeResend(box.getAttribute('data-email') || ''); }
      finally { again.disabled = false; }
    });
    after.parentNode.insertBefore(box, after.nextSibling);
  }
  box.setAttribute('data-email', email);
  const withCode = emailCodeInEmail();
  box.querySelector('#emailCodeLab').style.display = withCode ? '' : 'none';
  box.querySelector('#emailCodeIn').style.display = withCode ? '' : 'none';
  box.querySelector('#emailCodeRow').style.display = withCode ? 'flex' : 'none';
  box.querySelector('#emailCodeHint').textContent = withCode
    ? 'Enter the 6-digit code from the email, or open the link on this phone. ' +
      'It went to ' + email + '.'
    : 'It went to ' + email + '. Its link opens in this phone’s browser and signs ' +
      'you in there, not in this app. To sign in inside the app, use Google sign-in ' +
      'where it is offered.';
  box.style.display = 'flex';
  return box;
}

async function verifyEmailCode(box) {
  const input = box.querySelector('#emailCodeIn');
  const go = box.querySelector('#emailCodeGo');
  const email = box.getAttribute('data-email') || '';
  /* a code pasted as "123 456" is still the code */
  const token = String(input.value || '').replace(/\D/g, '');
  if (!/^[0-9]{6,10}$/.test(token)) {
    input.focus();
    return say('Enter the 6-digit code from the email, or open the link on this phone.', 'warn');
  }
  if (go.disabled) return;
  go.disabled = true;
  const label = go.textContent;
  go.textContent = 'checking…';
  let error = null;
  try {
    const res = await sb.auth.verifyOtp({ email, token, type: 'email' });
    error = res && res.error;
  } catch (e) {
    error = e || new Error('The code could not be checked.');
  }
  go.disabled = false;
  go.textContent = label;
  if (error) {
    const m = String(error.message || error);
    /* Supabase says "Token has expired or is invalid" for both, and an older
       email's code is refused the same way once a newer one has been sent */
    if (/expired|invalid|not found/i.test(m)) {
      return say('That code is wrong or has expired. Use the code in the newest ' +
                 'email, or send a new one.', 'err');
    }
    if (/rate|limit|too many/i.test(m)) {
      return say('Too many tries for now. Wait a minute, then try again.', 'err');
    }
    return say(m, 'err');
  }
  input.value = '';
  box.style.display = 'none';
  say('Signed in.', 'ok');
}
/* <<< THE CODE FROM THE EMAIL */

/* ----------------------------------------------------------------- actions --- */
/* The resend under the code field passes the address the code went to. */
async function sendAdminLink(to) {
  const v = typeof to === 'string' ? to : $('#email').value.trim();
  if (!v) return say('Enter your email address.', 'err');
  const { error } = await sb.auth.signInWithOtp({
    email: v, options: { emailRedirectTo: location.href }
  });
  if (error) return oops(error);
  if (offerEmailCode($('#send').parentNode, v, sendAdminLink)) {
    return say('Email sent to ' + v + '. What to do next is below.', 'ok');
  }
  say('Link sent to ' + v + '. It expires shortly — open it on this device.', 'ok');
}
$('#send').addEventListener('click', () => sendAdminLink());

$('#out').addEventListener('click', async () => {
  await (window.epinoiaSignOut ? window.epinoiaSignOut(sb) : sb.auth.signOut());
  league = season = comp = null;
  say('');
  render();
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

$('#anGo').addEventListener('click', async () => {
  if (!league) return say('Pick a league first.', 'err');
  const title = $('#anTitle').value.trim();
  if (!title) return say('Give the notice a title.', 'err');
  const audience = $('#anAudience').value, team = $('#anTeam').value || null;
  if (team && audience === 'fans') return say('A message to one club goes to its managers: choose "to club managers".', 'err');
  $('#anGo').disabled = true;
  const { data, error } = await sb.rpc('post_announcement', {
    p_league: league.id, p_title: title, p_body: $('#anBody').value.trim(), p_audience: audience, p_team: team
  });
  $('#anGo').disabled = false;
  if (error) return oops(error);
  say('Sent.' + (audience === 'fans' ? ' Every fan following a club in ' + league.name + ' has it.' : ''), 'ok');
  $('#anTitle').value = ''; $('#anBody').value = '';
  deliverNow();
  await loadAnnouncements();
});

/* ------------------------------------------------------- creating a club ---
   A SECOND ROW FOR A CLUB THAT IS ALREADY THERE IS THE EXPENSIVE MISTAKE. It
   does not announce itself: the league simply has two Bristol Hurricanes, each
   holding half a season, and nothing goes wrong until somebody looks at the
   table in March. Everything below is aimed at that — the duplicate name, the
   duplicate abbreviation, and the double-press that makes one out of thin air.

   The abbreviation matters more than it looks. It is the scoreboard, the
   standings column and the key a LiveStats feed is matched on
   ("<code>:<pno>"), so two clubs sharing one is two clubs sharing an identity
   somewhere downstream. It was defaulted to the first three letters of the name
   and never checked, which for Bristol Hurricanes and Bristol Flyers is the
   same three letters.

   And the slug: this appended four random characters to EVERY club, so a
   league's first and only Gloucester City Kings lived at
   /t/gloucester-city-kings-k3f9 for ever. The clean slug is taken when it is
   free, which it almost always is. */
$('#tmGo').addEventListener('click', async () => {
  const btn = $('#tmGo');
  if (btn.disabled) return;                 // an impatient second press is not a second club
  const name = $('#tmName').value.trim().replace(/\s+/g, ' ');
  if (!name) return say('Name the team.', 'err');
  if (isPlaceholderTeam(name)) {
    return say('“' + name + '” stands for a side that is not known yet, not a club. Schedule the tie once both teams are known.', 'err');
  }

  const fold = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const clash = teams.find(t => fold(t.name) === fold(name));
  if (clash && !confirm(
        league.name + ' already has a club called “' + clash.name + '”.\n\n' +
        'Creating a second one gives you two clubs with the same name, each holding ' +
        'part of the season, and they cannot be merged from this page.\n\n' +
        'Create it anyway?')) return;

  /* An abbreviation nobody typed is derived, and then made unique inside the
     league: BRI, BRI2, BRI3. Four characters is the column's limit. */
  let short = ($('#tmShort').value.trim() || name.slice(0, 3)).toUpperCase().slice(0, 4);
  const taken = new Set(teams.map(t => (t.short_name || '').toUpperCase()));
  if (taken.has(short)) {
    if ($('#tmShort').value.trim()) {
      const who = teams.find(t => (t.short_name || '').toUpperCase() === short);
      return say('“' + short + '” is already ' + who.name + '’s abbreviation. It is what ' +
                 'the scoreboard and the table show, so two clubs cannot share one.', 'err');
    }
    const base = short.slice(0, 3);
    for (let n = 2; n < 100; n++) { short = (base + n).slice(0, 4); if (!taken.has(short)) break; }
  }

  /* The plain slug first; a suffix only if the platform already has it (clubs
     are unique platform-wide, not per league — another league's Titans holds
     /t/titans). */
  const base = slugify(name);
  let slug = base;
  const { data: used } = await sb.from('teams').select('slug').like('slug', base + '%');
  const seen = new Set((used || []).map(r => r.slug));
  if (seen.has(slug)) {
    for (let n = 2; n < 50; n++) { slug = base + '-' + n; if (!seen.has(slug)) break; }
  }

  btn.disabled = true;
  try {
    const { data, error } = await sb.from('teams').insert({
      league_id: league.id, name, short_name: short,
      colour: $('#tmCol').value,
      /* a colour the admin changed from the default is theirs; the ingest's crest reader never
         writes over a manual choice (left at default, the crest decides) */
      colour_source: $('#tmCol').value.toLowerCase() !== '#93f2bf' ? 'manual' : 'default',
      slug
    }).select('id').single();
    if (error) return oops(error);

    // creating a team inside a competition almost always means entering it
    if (comp && data) {
      const { error: e2 } = await sb.from('competition_teams')
        .insert({ competition_id: comp.id, team_id: data.id });
      if (e2) oops(e2);
    }
    say(name + ' (' + short + ')' + (comp ? ' created and entered in ' + comp.name : ' created'), 'ok');
    $('#tmName').value = ''; $('#tmShort').value = '';
    $('#tmName').focus();                   // a secretary adding a club is adding several
    await loadTeams();
  } finally { btn.disabled = false; }
});

/* ---------------------------------------------------- scheduling a fixture ---
   BUILT FOR SOMEBODY ENTERING A WHOLE ROUND, which is how this form is
   actually used: six or seven games, same evening, one after another. So the
   date and the venue STAY between fixtures (they are nearly always the same
   for the next one) and the two clubs are cleared, which is the only part that
   changes. Before this, every field survived — so pressing schedule twice in a
   row, which is exactly what entering a round feels like, silently made the
   same fixture again.

   The duplicate check is the other half of that. Same two clubs in the same
   competition on the same day is a mistake every time; the same pairing on a
   different day is the return fixture and is waved through. Reversed clubs on
   the same day is asked about rather than refused — a double-header at a
   tournament is a real thing, just a rare one. */
$('#fxGo').addEventListener('click', async () => {
  const btn = $('#fxGo');
  if (btn.disabled) return;
  if (!comp) return say('Pick a competition first.', 'err');
  const h = $('#fxHome').value, a = $('#fxAway').value;
  if (!h || !a) return say('Choose both teams.', 'err');
  if (h === a) return say('A team cannot play itself.', 'err');
  const nameOf = id => (teams.find(t => t.id === id) || {}).name || 'that club';
  const when = $('#fxWhen').value;

  const day = iso => (iso || '').slice(0, 10);
  const sameDay = when ? day(new Date(when).toISOString()) : null;
  const clash = (fixtures || []).find(f =>
    ((f.home_team_id === h && f.away_team_id === a) ||
     (f.home_team_id === a && f.away_team_id === h)) &&
    (sameDay ? day(f.tipoff_at) === sameDay : !f.tipoff_at));
  if (clash) {
    const reversed = clash.home_team_id === a;
    const wording = sameDay
      ? nameOf(h) + ' v ' + nameOf(a) + ' is already in ' + comp.name + ' on that date' +
        (reversed ? ', the other way round (' + nameOf(a) + ' at home)' : '')
      : 'There is already an undated ' + nameOf(h) + ' v ' + nameOf(a) + ' in ' + comp.name;
    if (!reversed && sameDay)
      return say(wording + '. Change the date, or edit the one that is there.', 'err');
    if (!confirm(wording + '.\n\nSchedule this one as well?')) return;
  }

  btn.disabled = true;
  try {
    const { error } = await sb.from('games').insert({
      competition_id: comp.id, home_team_id: h, away_team_id: a,
      tipoff_at: when ? new Date(when).toISOString() : null,
      venue: $('#fxVenue').value.trim() || null
    });
    if (error) return oops(error);
    /* Named, and dated. "Fixture scheduled." said nothing about WHICH, which
       on the fifth game of a round is the only thing worth confirming — and an
       undated fixture is easy to create by accident and invisible afterwards
       (it sorts to the end of a 200-game list), so it says so out loud. */
    say(nameOf(h) + ' v ' + nameOf(a) +
        (when ? ' scheduled for ' + new Date(when).toLocaleString('en-GB',
                  { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
              : ' added with no date yet — it will sit at the end of the list until one is set'),
        when ? 'ok' : 'warn');
    $('#fxHome').value = ''; $('#fxAway').value = '';
    $('#fxHome').focus();
    await loadFixtures();
  } finally { btn.disabled = false; }
});

/* the count only makes sense once "a set number" is chosen */
$('#invLimit').addEventListener('change', () => {
  $('#invUses').style.display = $('#invLimit').value === 'n' ? '' : 'none';
});

$('#invGo').addEventListener('click', async () => {
  const btn = $('#invGo');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const uses = $('#invUses').value;
    const capped = $('#invLimit').value === 'n' && uses;
    const { data, error } = await sb.rpc('league_invite_create', {
      p_league: league.id, p_role: 'viewer',
      p_label: $('#invLabel').value.trim(),
      p_max_uses: capped ? Number(uses) : null });
    if (error) return oops(error);
    const row = Array.isArray(data) ? data[0] : data;    // a table-returning RPC is an array of one
    $('#invLabel').value = '';
    const url = inviteLink(row.token);
    try { await navigator.clipboard.writeText(url);
          say('Link made and copied — paste it wherever you are sending it.', 'ok'); }
    catch (_) { say('Link made: ' + url, 'ok'); }
    await loadInvites();
  } finally { btn.disabled = false; }
});

$('#grRole').addEventListener('change', syncGrantScope);
$('#grGo').addEventListener('click', async () => {
  const v = $('#grEmail').value.trim();
  if (!v) return say('Enter the email address of the account to grant.', 'err');
  const role = $('#grRole').value;
  const toTeam = role === 'team_manager';
  if (toTeam && !$('#grTeam').value) return say('Choose the club.', 'err');
  const { data, error } = await sb.rpc('grant_role', {
    p_email: v, p_role: role,
    p_scope_type: toTeam ? 'team' : 'league',
    p_scope_id: toTeam ? $('#grTeam').value : league.id
  });
  if (error) return oops(error);
  /* "invited" is the answer for an address with no account yet (0140): the role
     is stored and applies by itself when they sign up. That is a success with
     something to know, not a failure — it used to come back as "no account …
     then grant again" and was drawn red, which is why nobody ever did the
     second half. Either way the field clears and the list reloads, because
     either way the appointment is made. */
  say(data, /^invited/.test(data) ? 'warn' : 'ok');
  $('#grEmail').value = '';
  loadMembers();
});

/* WHOSE COMPETITION THIS IS (0131). One value, saved on its own button rather
   than on change, because a select that writes as it opens is a select that
   writes when somebody is only looking. */
$('#lgGenderGo').addEventListener('click', async () => {
  const v = $('#lgGender').value || null;
  const { data, error } = await sb.rpc('set_league_gender',
    { p_league: league.id, p_gender: v });
  if (error) return oops(error);
  league.gender = v || '';
  say('Saved: ' + data + '.', 'ok');
});

$('#shopGo').addEventListener('click', () =>
  saveShop($('#shopUrl').value.trim(), $('#shopName').value.trim()));
$('#shopClear').addEventListener('click', () => {
  if (!confirm('Clear the shop link? Every product on the league page stops ' +
               'linking anywhere and the section says the shop is not open.')) return;
  saveShop('', '');
});

boot();
