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
  window.EpinoiaKeys.mount({ host: '#keysPanel', sb, league, say });
  window.EpinoiaWebhook.mount({ host: '#webhookPanel', sb, league, say });
  window.EpinoiaFeeds.mount({ host: '#feedsPanel', sb, league, say,
                                cfg: window.EPINOIA_CONFIG });
  window.EpinoiaMerchUI.mount({ host: '#merchPanel', sb, league, say,
                                cfg: window.EPINOIA_CONFIG,
                                season: season ? season.name : '' });
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
    .select('store_url,store_name').eq('id', league.id).maybeSingle();
  if (row) {
    league.store_url = row.store_url;
    league.store_name = row.store_name;
    $('#shopUrl').value = row.store_url || '';
    $('#shopName').value = row.store_name || '';
  }

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
    const b = el('button', 'ep-chip' + (season && s.id === season.id ? ' on' : ''), s.name);
    b.type = 'button';
    b.addEventListener('click', async () => { season = s; comp = null; renderSeasonPick(); await loadComps(); });
    host.appendChild(b);
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
}

/* ------------------------------------------------------------------ teams --- */
async function loadTeams() {
  const { data, error } = await sb.from('teams')
    .select('id,name,short_name,colour,slug').eq('league_id', league.id).order('name');
  if (error) return oops(error);
  teams = data || [];

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
async function loadFixtures() {
  fixtures = [];
  if (comp) {
    const { data, error } = await sb.from('games')
      .select('id,tipoff_at,venue,status,home_score,away_score,home_team_id,away_team_id,roster_snapshot')
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
    host.appendChild(row);
  });

  mountImport();
  mountFixtureGen();
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
  window.EpinoiaNewsUI.mount({ host: '#newsPanel', sb, league, say,
                               cfg: window.EPINOIA_CONFIG });
  window.EpinoiaAppearance.mount({ host: '#appearancePanel', sb, league, say });
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
      const { data, error } = await sb.rpc('approve_media', { p_media: m.id });
      if (error) { ok.disabled = false; return oops(error); }
      say(data + ' — ' + (m.subject || 'image'), 'ok');
      loadMediaQueue();
    });
    const no = el('button', 'ep-btn mini dgr', 'reject'); no.type = 'button';
    no.addEventListener('click', async () => {
      no.disabled = true;
      const { error } = await sb.rpc('reject_media', { p_media: m.id, p_reason: null });
      if (error) { no.disabled = false; return oops(error); }
      say('rejected — ' + (m.subject || 'image'), 'ok');
      loadMediaQueue();
    });
    ac.append(ok, no);
    row.appendChild(ac);
    host.appendChild(row);
  }
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
  say(data, /^no account/.test(data) ? 'err' : 'ok');
  if (!/^no account/.test(data)) { $('#grEmail').value = ''; loadMembers(); }
});

$('#shopGo').addEventListener('click', () =>
  saveShop($('#shopUrl').value.trim(), $('#shopName').value.trim()));
$('#shopClear').addEventListener('click', () => {
  if (!confirm('Clear the shop link? Every product on the league page stops ' +
               'linking anywhere and the section says the shop is not open.')) return;
  saveShop('', '');
});

boot();
