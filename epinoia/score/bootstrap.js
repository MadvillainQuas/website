'use strict';
/* ============================================================================
   Wires the scorer to the live transport and shows where to watch it.

   The scorer builds its state lazily — S is null until a game is actually set
   up — so this waits for a game rather than attaching on load, and attaches
   exactly once.

   Game id comes from ?g=. With none supplied it invents one and forces local
   mode: BroadcastChannel needs no database row, so the whole publish/subscribe
   loop is testable in two tabs with nothing configured. A real fixture is
   scored by opening this page with the game's uuid, which is what the portal's
   "score this game" link does.
   ============================================================================ */
(function () {
  const qp = new URLSearchParams(location.search);
  const ROOM_KEY = 'epinoia.scratchGame';

  let gameId = qp.get('g');
  let mode = qp.get('mode');

  /* ------------------------------------------------------------ training ---
     ?train=1 is the door from the splash for somebody who has never seen the
     app. No account, no fixture, nothing written anywhere — a scratch room in
     local mode with two invented squads already on the sheet, so the first
     thing they see is the scoring screen rather than a form.

     It is driven through the SETUP UI rather than by reaching into the
     scorer's state: filling the same inputs a person would fill and pressing
     the same button means training cannot drift away from the real thing, and
     there is no second code path to keep working. */
  const TRAINING = qp.get('train') === '1';
  if (TRAINING) mode = 'local';


  if (!gameId) {
    // a scratch room, stable across reloads so the viewer tab keeps working
    gameId = sessionStorage.getItem(ROOM_KEY);
    if (!gameId) {
      gameId = 'scratch-' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8)
                                               : Math.floor(Math.random() * 1e9).toString(36));
      sessionStorage.setItem(ROOM_KEY, gameId);
    }
    mode = 'local';   // no row exists for a scratch id, so never try Supabase
  }
  mode = mode || (window.epinoiaMode ? window.epinoiaMode() : 'local');

  // the distinctive tail, not the prefix — "scratch-" identifies nothing
  const shortId = gameId.replace(/^scratch-/, '').slice(0, 8);

  const viewerUrl = new URL('../game/', location.href);
  viewerUrl.searchParams.set('g', gameId);
  viewerUrl.searchParams.set('mode', mode);

  /* ---------------------------------------------------------------- badge --- */
  /* Deliberately unobtrusive and out of the way of every control: the scorer's
     buttons reach the screen edges on mobile, and a mis-tap here costs a stat. */
  const bar = document.createElement('div');
  bar.id = 'ep-livebar';
  bar.style.cssText = [
    'position:fixed', 'left:6px', 'bottom:6px', 'z-index:2147483000',
    'display:flex', 'align-items:center', 'gap:7px',
    'padding:5px 8px', 'border-radius:7px',
    'background:rgba(4,16,11,.86)', 'border:1px solid rgba(147,242,191,.30)',
    'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
    'font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:.06em', 'text-transform:uppercase',
    'color:#e6fff1', 'user-select:none', 'max-width:min(92vw,320px)'
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#ffd166;flex:none';
  const label = document.createElement('span');
  label.textContent = 'connecting';
  label.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  const watch = document.createElement('a');
  watch.href = viewerUrl.href;
  watch.target = '_blank';
  watch.rel = 'noopener';
  watch.textContent = 'watch ↗';
  watch.style.cssText = 'color:#8ff5ff;text-decoration:none;white-space:nowrap;flex:none';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'copy';
  copy.style.cssText = 'all:unset;cursor:pointer;color:#93f2bf;white-space:nowrap;flex:none';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(viewerUrl.href); copy.textContent = 'copied'; }
    catch (_) { copy.textContent = 'copy failed'; }
    setTimeout(() => { copy.textContent = 'copy'; }, 1600);
  });

  const hide = document.createElement('button');
  hide.type = 'button';
  hide.textContent = '×';
  hide.title = 'hide';
  hide.style.cssText = 'all:unset;cursor:pointer;color:rgba(230,255,241,.5);padding:0 2px;flex:none';
  hide.addEventListener('click', () => bar.remove());

  bar.append(dot, label, watch, copy, hide);
  const mount = () => document.body.appendChild(bar);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function say(text, colour) { label.textContent = text; dot.style.background = colour; }

  /* ------------------------------------------------------- publishing state --- */
  /* Watching is public and always works: Realtime accepts an anonymous
     subscriber, and the scorer broadcasts a full snapshot every ten seconds,
     so anyone can open the page at any point and have the whole game without
     credentials. Nothing here gates that.

     What signing out does cost is DURABILITY. Every write to game_events is
     refused by RLS, so the game is live to whoever is watching and gone the
     moment they refresh — no log to rebuild from, nothing to finalise, no
     season statistics. That is worth saying plainly rather than leaving to be
     discovered at half-time, so it is checked on load and the badge stays
     amber until it is fixed. */
  let authOk = null;

  async function checkPublishing() {
    if (!isFixture) return true;
    const sb = window.epinoiaClient && epinoiaClient();
    if (!sb) { authOk = false; return false; }
    const { data: { session } } = await sb.auth.getSession();
    authOk = !!session;
    if (!authOk) {
      say('live to viewers · NOT being saved', '#ffd166');
      bar.style.borderColor = 'rgba(255,209,102,.7)';
      bar.style.background = 'rgba(40,30,6,.94)';
      /* a link straight to the fix, since the statistician is mid-setup */
      if (!document.getElementById('ep-signin')) {
        const a = document.createElement('a');
        a.id = 'ep-signin';
        a.href = '../app/'; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'sign in ↗';
        a.style.cssText = 'color:#ffd166;text-decoration:underline;white-space:nowrap;flex:none';
        bar.insertBefore(a, watch);
      }
    }
    return authOk;
  }
  setTimeout(checkPublishing, 1200);

  /* ------------------------------------------------------------- tip-off --- */
  /* Nothing was ever written when a game started. The fixture stayed
     'scheduled' with a null roster_snapshot, so a viewer opening the public
     page got a game row with no squads and no log — the clock ticked locally
     against a stale state row and nothing else ever appeared. That is the
     "live games don't feed the public side" fault.

     At tip the scorer now claims the fixture: status live, the squads frozen
     as they were at tip, and the starting five. The snapshot is what lets the
     public page name a player, and freezing it means a roster edited later
     never rewrites a game that has already been played.

     This needs a signed-in statistician, because writing to someone's fixture
     should. If the write is refused the badge says so out loud rather than
     letting a whole game be scored into a void. */
  let claimed = false;

  async function claimFixture() {
    if (claimed || !isFixture) return;
    if (typeof S === 'undefined' || !S || S.phase !== 'game') return;
    claimed = true;                                   // one attempt per load

    if (!(await checkPublishing())) { claimed = false; return; }
    const sb = epinoiaClient();

    const snapshot = {
      teams: S.teams.map(t => ({
        name: t.name, color: t.color,
        players: t.players.map(p => ({ id: p.id, name: p.name, num: p.num }))
      }))
    };
    const patch = {
      status: 'live',
      roster_snapshot: snapshot,
      starters: S.starters,
      period: S.period
    };
    if (S.tipWinner != null) patch.tip_winner = S.tipWinner;
    if (S.arrowInit != null) patch.arrow_init = S.arrowInit;

    const { error } = await sb.from('games').update(patch).eq('id', gameId);
    if (error) {
      say('cannot publish: ' + (error.message || 'refused'), '#ff5f6b');
      console.warn('[tip-off]', error);
      claimed = false;                                // let a retry happen
      return;
    }
    say('live · ' + shortId, '#93f2bf');
  }

  /* --------------------------------------------------------- escape hatch --- */
  /* The scorer gets a hover bar rather than the sidebar every other page has.

     A statistician's screen has gesture targets at every edge — a rail that
     expanded under a thumb mid-drag would cost a stat, and that is the one
     thing this app must never do. So this is a 4px lip at the very top that
     opens only on deliberate hover, and on touch only after a press and hold
     on the lip itself. It cannot be opened by any gesture used to score.

     Leaving mid-game is also confirmed, because the game lives in
     localStorage and a mis-tap that navigates away mid-quarter is alarming
     even when nothing is actually lost. */
  (function escapeHatch() {
    const lip = document.createElement('div');
    lip.id = 'ep-exitlip';
    lip.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'height:4px',
      'z-index:2147482000', 'background:linear-gradient(90deg,#93f2bf,#8ff5ff)',
      'opacity:.28', 'transition:opacity .18s', 'cursor:pointer'
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'transform:translateY(-100%)', 'transition:transform .2s var(--ease,ease)',
      'z-index:2147482001', 'display:flex', 'align-items:center', 'gap:14px',
      'padding:calc(env(safe-area-inset-top) + 7px) 14px 7px',
      'background:rgba(4,16,11,.95)', 'border-bottom:1px solid rgba(147,242,191,.3)',
      'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
      'font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:.08em', 'text-transform:uppercase', 'color:#e6fff1'
    ].join(';');

    const link = (label, href, colour) => {
      const a = document.createElement('a');
      a.textContent = label; a.href = href;
      a.style.cssText = 'color:' + colour + ';text-decoration:none;white-space:nowrap';
      a.addEventListener('click', ev => {
        const live = (typeof S !== 'undefined' && S && S.phase === 'game');
        if (!live) return;
        ev.preventDefault();
        const go = () => { location.href = href; };
        if (typeof askConfirm === 'function') {
          askConfirm('leave the game? it is saved and will be here when you return', go);
        } else if (confirm('Leave the game? It is saved.')) go();
      });
      return a;
    };

    bar.append(
      link('← Epinoia', '../', '#93f2bf'),
      link('league', '../l/', '#8ff5ff'),
      link('box scores', '../', '#8ff5ff'),
      link('Prophesy Scouting', '/index.html', 'rgba(230,255,241,.6)')
    );

    const note = document.createElement('span');
    note.textContent = 'the game is saved as you score';
    note.style.cssText = 'margin-left:auto;color:rgba(230,255,241,.4);white-space:nowrap';
    bar.appendChild(note);

    let open = false, hold = null;
    const show = v => {
      open = v;
      bar.style.transform = v ? 'translateY(0)' : 'translateY(-100%)';
      lip.style.opacity = v ? '0' : '.28';
    };
    lip.addEventListener('mouseenter', () => show(true));
    bar.addEventListener('mouseleave', () => show(false));
    /* touch: press and hold the lip, so a swipe from the top edge does nothing */
    lip.addEventListener('touchstart', () => { hold = setTimeout(() => show(true), 450); },
                         { passive: true });
    ['touchend', 'touchcancel', 'touchmove'].forEach(e =>
      lip.addEventListener(e, () => { clearTimeout(hold); }, { passive: true }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) show(false); });

    const mountNav = () => { document.body.append(lip, bar); };
    if (document.body) mountNav(); else document.addEventListener('DOMContentLoaded', mountNav);
  })();

  /* ------------------------------------------------------- fixture loading --- */
  /* Typing two rosters by hand before every game is the wrong workflow for a
     league that already knows who is playing — and it is also why season stats
     stayed empty: a hand-typed player gets a local id like 'p0_3', which cannot
     be aggregated across games. Loading a fixture uses the real players.id
     uuid as the scorer's pid, so the totals land on the right person.

     Injected into the setup screen rather than built into it, so the scorer
     itself is unchanged and still works standalone. */
  const CFGx = window.EPINOIA_CONFIG || {};
  const sbApi = async p => {
    const r = await fetch(CFGx.supabaseUrl + '/rest/v1/' + p,
      { cache: 'no-store', headers: { apikey: CFGx.supabaseAnonKey, Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
    return r.json();
  };

  const rosterOfTeam = async (teamId) => {
    const re = await sbApi('roster_entries?team_id=eq.' + teamId +
      '&active=eq.true&select=jersey,position,players(id,first_name,last_name)');
    return re
      .filter(r => r.players)                       // a minor withheld by RLS comes back null
      .map(r => ({
        id: r.players.id,
        name: ((r.players.first_name || '') + ' ' + (r.players.last_name || '')).trim().toLowerCase(),
        num: String(r.jersey || '')
      }))
      .sort((a, b) => (+a.num || 99) - (+b.num || 99));
  };

  /* The two clubs in this fixture, remembered when it loads. The pre-game
     screen lets a statistician pull a late arrival off the club's published
     roster, and it can only do that if it knows which clubs are playing. */
  let sides = null;

  /* ?g=<uuid> means "score this fixture": pull both squads and go straight to
     the starting-five picker, which is the first decision that is actually the
     statistician's to make. */
  async function loadFixture(id) {
    const gs = await sbApi('games?id=eq.' + encodeURIComponent(id) +
      '&select=id,status,home_team_id,away_team_id,roster_snapshot,' +
      'home:home_team_id(name,colour),away:away_team_id(name,colour)&limit=1');
    if (!gs.length) throw new Error('that fixture is not visible to you');
    const g = gs[0];
    if (g.status === 'final') throw new Error('that game is already final');

    sides = [g.home_team_id, g.away_team_id];

    /* a resumed game keeps the squad frozen at tip, so a roster edited
       mid-game never rewrites who was available */
    if (g.roster_snapshot && g.roster_snapshot.teams) return g.roster_snapshot.teams;

    const [hp, ap] = await Promise.all([
      rosterOfTeam(g.home_team_id), rosterOfTeam(g.away_team_id)
    ]);
    return [
      { name: ((g.home || {}).name || 'home').toLowerCase(),
        color: (g.home || {}).colour || '#93f2bf', players: hp },
      { name: ((g.away || {}).name || 'away').toLowerCase(),
        color: (g.away || {}).colour || '#8ff5ff', players: ap }
    ];
  }

  function injectFixturePicker() {
    const setup = document.getElementById('setup');
    if (!setup || document.getElementById('csFixturePick')) return;
    if (!CFGx.supabaseUrl || !CFGx.supabaseAnonKey) return;   // standalone use

    const card = document.createElement('div');
    card.id = 'csFixturePick';
    card.className = 'glass';
    card.style.cssText = 'padding:14px;display:flex;flex-direction:column;gap:9px;margin-bottom:4px';

    const h = document.createElement('div');
    h.style.cssText = 'font-family:var(--f-head);font-size:13px;letter-spacing:.06em;' +
                      'text-transform:uppercase;color:var(--lume)';
    h.textContent = 'score a league fixture';

    const sub = document.createElement('div');
    sub.style.cssText = 'font-family:var(--f-mono);font-size:10px;line-height:1.7;color:var(--dim)';
    sub.textContent = 'Loads both squads with their real identities, so the stats count ' +
                      'towards the season. Or ignore this and set up a one-off below.';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';

    const mkSel = () => {
      const s = document.createElement('select');
      s.style.cssText = 'flex:1 1 150px;min-width:0;background:var(--bg-elevated);color:var(--txt);' +
        'border:1px solid var(--line);border-radius:10px;padding:9px 10px;' +
        'font-family:var(--f-mono);font-size:12px';
      return s;
    };
    const lgSel = mkSel(), fxSel = mkSel();

    const go = document.createElement('button');
    go.className = 'yes';
    go.textContent = 'load';
    go.disabled = true;
    go.style.cssText = 'flex:0 0 auto;padding:9px 18px';

    const note = document.createElement('div');
    note.style.cssText = 'font-family:var(--f-mono);font-size:10px;color:var(--dim);line-height:1.7';

    row.append(lgSel, fxSel, go);
    card.append(h, sub, row, note);
    setup.insertBefore(card, setup.firstChild);

    let fixtures = [];

    const loadFixtures = async (leagueId) => {
      fxSel.innerHTML = '';
      go.disabled = true;
      try {
        const comps = await sbApi('competitions?select=id,name,seasons!inner(league_id)' +
          '&seasons.league_id=eq.' + leagueId);
        if (!comps.length) { fxSel.append(new Option('no competitions yet', '')); return; }
        const ids = comps.map(c => c.id).join(',');
        fixtures = await sbApi('games?competition_id=in.(' + ids + ')&status=in.(scheduled,live)' +
          '&select=id,tipoff_at,status,venue,home:home_team_id(name),away:away_team_id(name)' +
          '&order=tipoff_at');
        if (!fixtures.length) {
          fxSel.append(new Option('no fixtures to score', ''));
          note.textContent = 'Every game in this league is finished. Schedule one in the ' +
                             'league admin page, or set up a one-off below.';
          return;
        }
        fixtures.forEach(f => {
          const when = f.tipoff_at
            ? new Date(f.tipoff_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
            : 'TBC';
          const label = when + '  ' + ((f.home || {}).name || '?') + ' v ' +
                        ((f.away || {}).name || '?') + (f.status === 'live' ? '  (live)' : '');
          fxSel.append(new Option(label, f.id));
        });
        go.disabled = false;
        note.textContent = '';
      } catch (e) {
        fxSel.append(new Option('could not load fixtures', ''));
        note.textContent = e.message;
      }
    };

    (async () => {
      try {
        const lgs = await sbApi('leagues?select=id,name,slug&order=name');
        if (!lgs.length) { note.textContent = 'No leagues on the platform yet.'; return; }
        lgs.forEach(l => lgSel.append(new Option(l.name, l.id)));
        lgSel.addEventListener('change', () => loadFixtures(lgSel.value));
        await loadFixtures(lgs[0].id);
      } catch (e) {
        note.textContent = 'Could not reach the league: ' + e.message;
      }
    })();

    /* Reload rather than set up in place: the game id is read once at load and
       drives the live transport and the finalise button, so it has to be in the
       URL for those to point at the right fixture. */
    go.addEventListener('click', () => {
      if (!fxSel.value) return;
      location.search = '?g=' + encodeURIComponent(fxSel.value) + '&mode=supabase';
    });
  }

  /* If we arrived with a fixture id, skip the setup screen entirely. */
  async function autoLoadFixture() {
    if (!isFixture) return;
    if (typeof showStarterPick !== 'function') return;
    if (S && S.phase && S.phase !== 'setup') return;    // a game is already in progress

    say('loading the fixture…', '#ffd166');
    try {
      const teams = await loadFixture(gameId);
      const thin = teams.filter(t => t.players.length < 5);
      showStarterPick(teams);
      if (thin.length) {
        say('a squad has fewer than five listed', '#ffd166');
      }
    } catch (e) {
      say(e.message, '#ff5f6b');
      console.warn('[fixture]', e);
    }
  }

  /* WHAT THE PRE-GAME SCREEN NEEDS FROM HERE.

     Squad editing lives in the scorer, where the game state is; the club's
     published roster lives out here, where the fixture and the credentials
     are. This is the seam between them, and it is deliberately two functions
     and no state: available() says whether there is a club to ask about, and
     roster() answers for one side. Nothing about the game crosses it. */
  window.EpinoiaSquads = {
    available: () => !!(sides && sides[0] && sides[1]),
    roster: (t) => {
      if (!sides || !sides[t]) return Promise.reject(new Error('no club for that side'));
      return rosterOfTeam(sides[t]);
    }
  };

  /* =========================================================== squad picker ===
     A CLUB PER SIDE, ON THE CARD ITSELF.

     The fixture picker above handles the common case: a scheduled game, both
     squads, straight into it. This is for everything that is not that — a
     friendly, a pre-season game, a tournament nobody has entered into the
     schedule, a cup tie between two clubs from different leagues. The names
     were typed in by hand, every time, for clubs whose rosters the platform
     was already holding.

     TWO INDEPENDENT PICKERS, one per card, and that is the point rather than a
     convenience: the two sides do not have to come from the same league. A
     card picks a league, then a club, and takes that club's published roster,
     its name and its colour. The other card can do something completely
     different, or nothing at all.

     MANUAL ENTRY IS UNTOUCHED. The name field stays editable after a pick, the
     + player button still works, the scan still works, and rows can still be
     deleted. Picking a club fills the card in; it does not take it over. A
     club with two players registered and nine turning up is an ordinary
     Saturday, and the card has to survive it.

     WHY THE ROWS ARE CLEARED FIRST. Filling over the top of what is already
     there is how you end up with the last club's ninth player still in the
     sheet when the new one has eight. Picking a club replaces that card's
     roster outright — which is also what somebody means when they change their
     mind about which club is playing.

     Minors are absent by RLS rather than by anything here: rosterOfTeam drops
     the rows the database returned as null, which is what a withheld player
     looks like from out here. A youth club will come back short, and that is
     the protection working rather than a fault to route around. */
  const teamsOfLeague = (leagueId) =>
    sbApi('teams?league_id=eq.' + encodeURIComponent(leagueId) +
          '&select=id,name,slug,colour&order=name');

  function injectSquadPickers() {
    if (!CFGx.supabaseUrl || !CFGx.supabaseAnonKey) return;     // standalone use
    const cards = document.querySelectorAll('#setup .team-card');
    if (cards.length < 2) return;
    if (document.querySelector('.csSquadPick')) return;         // already mounted

    const SEL = 'flex:1 1 120px;min-width:0;background:var(--bg-elevated);color:var(--txt);' +
                'border:1px solid var(--line);border-radius:9px;padding:7px 8px;' +
                'font-family:var(--f-mono);font-size:11px';

    let leagues = null;                       // fetched once, shared by both cards

    cards.forEach((card) => {
      const bar = document.createElement('div');
      bar.className = 'csSquadPick';
      bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;' +
                          'margin:0 0 9px';

      const lg = document.createElement('select'); lg.style.cssText = SEL;
      const tm = document.createElement('select'); tm.style.cssText = SEL;
      tm.disabled = true;
      const note = document.createElement('div');
      note.style.cssText = 'flex:1 1 100%;font-family:var(--f-mono);font-size:10px;' +
                           'color:var(--dim);line-height:1.6';
      note.textContent = 'or just type the names below';

      lg.append(new Option('league…', ''));
      tm.append(new Option('club…', ''));
      bar.append(lg, tm, note);

      /* above the name field, because it is the thing that fills the name
         field — reading downwards it goes league, club, name, roster */
      card.insertBefore(bar, card.firstChild);

      const fillClubs = async (leagueId) => {
        tm.innerHTML = ''; tm.disabled = true;
        tm.append(new Option('club…', ''));
        if (!leagueId) return;
        try {
          const ts = await teamsOfLeague(leagueId);
          if (!ts.length) { note.textContent = 'no clubs in that league yet'; return; }
          ts.forEach(t => {
            const o = new Option(t.name, t.id);
            o.dataset.colour = t.colour || '';
            o.dataset.name = t.name;
            tm.append(o);
          });
          tm.disabled = false;
          note.textContent = 'or just type the names below';
        } catch (e) {
          note.textContent = 'could not load the clubs: ' + e.message;
        }
      };

      const applySquad = async (teamId, label, colour) => {
        note.textContent = 'loading the squad…';
        let roster;
        try { roster = await rosterOfTeam(teamId); }
        catch (e) { note.textContent = 'could not load that squad: ' + e.message; return; }

        const nameIn = card.querySelector('.tname');
        if (nameIn) {
          nameIn.value = label;
          nameIn.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (colour) card.dataset.color = colour;   // startGame reads this

        /* out with whatever was there, in with this club's squad */
        card.querySelectorAll('.rrow').forEach(r => r.remove());
        const add = card.querySelector('.addP');
        roster.forEach((pl) => {
          add && add.click();
          const rows = card.querySelectorAll('.rrow');
          const row = rows[rows.length - 1];
          if (!row) return;
          const n = row.querySelector('.rname'), num = row.querySelector('.rnum');
          if (n) { n.value = pl.name; n.dispatchEvent(new Event('input', { bubbles: true })); }
          if (num) { num.value = pl.num || ''; num.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        note.textContent = roster.length
          ? roster.length + ' registered — add or remove anybody below'
          : 'that club has nobody registered yet — type the names below';
      };

      lg.addEventListener('change', () => fillClubs(lg.value));
      tm.addEventListener('change', () => {
        const o = tm.selectedOptions[0];
        if (!tm.value || !o) return;
        applySquad(tm.value, o.dataset.name || o.textContent, o.dataset.colour);
      });

      /* the league list is fetched once and reused by the second card */
      (async () => {
        try {
          if (!leagues) leagues = await sbApi('leagues?select=id,name&order=name');
          if (!leagues.length) { note.textContent = 'no leagues on the platform yet'; return; }
          leagues.forEach(l => lg.append(new Option(l.name, l.id)));
        } catch (e) {
          note.textContent = 'could not reach the leagues: ' + e.message;
        }
      })();
    });
  }

  /* ------------------------------------------------------ legend clearance --- */
  /* #cols reserves a flat 52px for the fixed gesture legend, but the legend is
     150px tall on a narrow phone once its text wraps — so the bottom of the
     player columns ends up underneath it. Measuring the element is the only
     way to reserve the right amount, because the height depends on wrapping.
     Its top 96px is a transparent gradient, so only the remainder hides
     anything. Publishes --ep-legend-h for the stylesheet to use. */
  (function trackLegend() {
    const mount = () => {
      const el = document.getElementById('ctrlHelp');
      if (!el) return false;
      const apply = () => {
        const h = el.offsetHeight;                       // 0 when display:none (desktop)
        const opaque = h > 0 ? Math.max(0, h - 96) : 0;  // minus the gradient lead-in
        document.documentElement.style.setProperty('--ep-legend-h', opaque + 'px');

        /* The slide-up sheet also sits over the bottom of the columns — only
           its 40px handle when closed, but that handle still covers a player
           row. Measured rather than assumed, for the same reason. */
        const sh = document.getElementById('sheet');
        if (sh) {
          const peek = Math.min(sh.offsetHeight || 40, 40);
          document.documentElement.style.setProperty('--ep-sheet-h', peek + 'px');
        }
      };
      apply();
      if (window.ResizeObserver) new ResizeObserver(apply).observe(el);
      window.addEventListener('resize', apply, { passive: true });
      window.addEventListener('orientationchange', () => setTimeout(apply, 250));

      /* The legend lives inside #game, which is display:none until tip-off, so
         the first measurement is always 0 and a ResizeObserver does not fire
         for that transition. Re-measure whenever the scorer changes screen —
         same global-wrapping approach as everything else here. */
      const wrapShowScreen = () => {
        if (typeof window.showScreen !== 'function' || window.showScreen.__csWrapped) return false;
        const inner = window.showScreen;
        const wrapped = function () {
          const r = inner.apply(this, arguments);
          /* A timer, not requestAnimationFrame: rAF does not fire while the tab
             is backgrounded or otherwise not compositing, and the reservation
             would then stay at whatever it was when the legend was hidden.
             Two passes — one for the immediate layout, one after any transition. */
          setTimeout(apply, 0);
          setTimeout(apply, 260);
          /* tip-off is a screen change: setup -> game. Claim the fixture the
             moment that happens, so the public page has a roster from the
             first possession rather than from the final whistle. */
          setTimeout(() => { try { claimFixture(); } catch (e) { console.warn('[tip]', e); } }, 400);
          return r;
        };
        wrapped.__csWrapped = true;
        window.showScreen = wrapped;
        return true;
      };
      if (!wrapShowScreen()) {
        const t2 = setInterval(() => { if (wrapShowScreen()) clearInterval(t2); }, 300);
        setTimeout(() => clearInterval(t2), 15000);
      }
      return true;
    };
    if (!mount()) {
      const t = setInterval(() => { if (mount()) clearInterval(t); }, 300);
      setTimeout(() => clearInterval(t), 15000);
    }
  })();

  /* ------------------------------------------------------------ finalise --- */
  /* A real fixture has a uuid; a scratch room does not, and there is nothing
     on the server to finalise for one. */
  const isFixture = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId);

  async function finaliseGame(btn, note) {
    const CFG = window.EPINOIA_CONFIG;
    const sb = window.epinoiaClient && epinoiaClient();
    if (!sb) { note('No Supabase client — cannot finalise.', '#ff5f6b'); return; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      note('Sign in first — open /epinoia/app/ in another tab, then try again.', '#ffd166');
      return;
    }

    btn.disabled = true;
    note('pushing the event log…', '#ffd166');

    /* Push whatever the buffer still holds, then give the upserts a moment to
       land. Finalising against a partial log would produce a box score that
       silently disagrees with what was scored. */
    try { window.EpinoiaSync && window.EpinoiaSync.flush(); } catch (_) {}
    await new Promise(r => setTimeout(r, 1200));

    /* Confirm the server actually has every event before asking it to close
       the game — the flush is fire-and-forget by design. */
    try {
      const { count, error } = await sb.from('game_events')
        .select('seq', { count: 'exact', head: true }).eq('game_id', gameId);
      if (error) throw error;
      const local = (S.events || []).length;
      if (count == null || count < local) {
        note(`server has ${count == null ? '?' : count} of ${local} events — retrying…`, '#ffd166');
        try { window.EpinoiaSync && window.EpinoiaSync.flush(); } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      btn.disabled = false;
      note('could not verify the log: ' + (e.message || e), '#ff5f6b');
      return;
    }

    note('finalising…', '#ffd166');
    try {
      const r = await fetch(CFG.supabaseUrl + '/functions/v1/finalise-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: CFG.supabaseAnonKey,
          Authorization: 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ gameId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        btn.disabled = false;
        note('refused: ' + (j.error || r.status), '#ff5f6b');
        return;
      }
      note('final — the box score is public', '#93f2bf');
      btn.textContent = 'finalised ✓';
      try { window.EpinoiaSync && window.EpinoiaSync.finalise(); } catch (_) {}
    } catch (e) {
      btn.disabled = false;
      note('network error: ' + (e.message || e), '#ff5f6b');
    }
  }

  /* renderFinal() rebuilds #finalview wholesale, so the button is re-injected
     after every render rather than added once. Wrapping the global is the same
     approach sync.js takes with addEvent: the scorer's own code is untouched. */
  function injectFinalise() {
    const host = document.getElementById('finalview');
    if (!host || host.querySelector('#csFinalise')) return;
    const row = host.querySelector('.mbtns');
    if (!row) return;

    const wrap = document.createElement('div');
    wrap.className = 'mbtns';
    wrap.style.cssText = 'padding:10px 0 0;flex-direction:column;gap:8px;align-items:stretch';

    const btn = document.createElement('button');
    btn.id = 'csFinalise';
    btn.className = 'yes';
    btn.type = 'button';

    const msg = document.createElement('div');
    msg.style.cssText = 'font-family:var(--f-mono);font-size:10px;line-height:1.7;text-align:center;' +
                        'color:var(--dim);padding:0 4px';
    const note = (t, c) => { msg.textContent = t; msg.style.color = c || 'var(--dim)'; };

    if (!isFixture) {
      btn.textContent = 'finalise to the league';
      btn.disabled = true;
      note('This is a practice game, so there is nothing to publish. Open a real ' +
           'fixture from the league admin page to score one that counts.');
    } else {
      btn.textContent = 'finalise to the league';
      note('Publishes the box score, updates the table and the season statistics. ' +
           'A finalised game stops accepting events.');
      btn.onclick = () => {
        if (typeof askConfirm === 'function') {
          askConfirm('finalise this game? the log is closed afterwards',
                     () => finaliseGame(btn, note));
        } else finaliseGame(btn, note);
      };
    }

    wrap.append(btn, msg);
    row.parentNode.insertBefore(wrap, row);

    if (isFixture) {
      const view = document.createElement('a');
      view.className = 'mini';
      view.textContent = 'open the public box score ↗';
      view.href = '../game/?g=' + encodeURIComponent(gameId) + '&mode=supabase';
      view.target = '_blank'; view.rel = 'noopener';
      view.style.cssText = 'display:block;text-align:center;font-family:var(--f-mono);' +
                           'font-size:10px;color:var(--aqua);text-decoration:none;padding-top:2px';
      wrap.appendChild(view);
    }
  }

  /* wrap once the scorer's own script has defined it */
  const wrapRenderFinal = () => {
    if (typeof window.renderFinal !== 'function' || window.renderFinal.__csWrapped) return false;
    const inner = window.renderFinal;
    const wrapped = function () {
      const r = inner.apply(this, arguments);
      try { injectFinalise(); } catch (e) { console.warn('[finalise]', e); }
      return r;
    };
    wrapped.__csWrapped = true;
    window.renderFinal = wrapped;
    return true;
  };
  if (!wrapRenderFinal()) {
    const t = setInterval(() => { if (wrapRenderFinal()) clearInterval(t); }, 300);
    setTimeout(() => clearInterval(t), 20000);
  }

  /* --------------------------------------------------------------- attach --- */
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    /* Not just "is there state" — the scorer builds S as soon as the setup
       screen opens, and the bridge publishes status 'live' for anything that
       is not final. Attaching here would put an empty 0–0 phantom game on the
       public page the moment someone opened the scorer. Wait for a real tip. */
    if (typeof S === 'undefined' || !S || S.phase === 'setup') {
      if (tries === 1) say('waiting for tip-off', '#ffd166');
      if (tries > 1800) { clearInterval(timer); say('not attached', '#ff5f6b'); }  // ~15 min
      return;
    }
    clearInterval(timer);

    if (!window.EpinoiaSync) { say('sync.js missing', '#ff5f6b'); return; }
    const sb = (mode === 'supabase' && window.epinoiaClient) ? window.epinoiaClient() : null;
    if (mode === 'supabase' && !sb) {
      say('no supabase client — local only', '#ff5f6b');
      mode = 'local';
    }

    try {
      window.EpinoiaSync.attach({ gameId, mode, supabase: sb });
      say((mode === 'local' ? 'local · ' : 'live · ') + shortId, '#93f2bf');
    } catch (e) {
      console.error('[bootstrap]', e);
      say('attach failed', '#ff5f6b');
    }

    /* pending count is the honest health signal: if frames stop draining the
       scorer keeps working but the viewer is behind, and that must be visible */
    setInterval(() => {
      const st = window.EpinoiaSync.status();
      if (authOk === false) return;                 // already saying the real problem
      if (st.pending > 12) {
        /* a backlog that will not drain is a refused write, not a slow one */
        say('live · not saved (' + st.pending + ' held)', '#ffd166');
      } else {
        say((mode === 'local' ? 'local · ' : 'live · ') + shortId, '#93f2bf');
      }
    }, 3000);
  }, 500);

  /* ------------------------------------------------------------- wire up --- */
  /* Both run after the scorer's own script has defined its globals — the
     picker only needs the DOM, the auto-load needs showStarterPick(). */
  function start() {
    try { injectFixturePicker(); } catch (e) { console.warn('[picker]', e); }
    try { injectSquadPickers(); } catch (e) { console.warn('[squads]', e); }
    try { autoLoadFixture(); } catch (e) { console.warn('[fixture]', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* ---------------------------------------------------------------------- */
  if (TRAINING) setUpTraining();

  function setUpTraining() {
    /* TEN A SIDE. Five is a starting five and nothing else — a training game
       with six players cannot be substituted, which is half of what somebody
       is here to try. */
    const HOME = ['Ada Shaw', 'Kit Brand', 'Sol Maddox', 'Rae Fenwick', 'Ivo Marsh',
                  'Bea Okoro', 'Tam Sowerby', 'Niamh Blackwood', 'Rafe Underhill',
                  'Cleo Danforth'];
    const AWAY = ['Cass Vernon', 'Dane Hollis', 'Eli Barrow', 'Wren Castell',
                  'Otto Lynch', 'Juno Pike', 'Milo Ferrers', 'Sasha Quill',
                  'Bram Ashdown', 'Vita Crowe'];
    const NAMES = [HOME, AWAY];
    const LABELS = ['harbour blues', 'marble whites'];

    /* THE SETUP IS NOT A PLACE THIS MODE CAN GO. Training exists so somebody
       can see the scoring screen without an account; leaving a route back to
       the rosters turns it into a general-purpose scoring app with no fixture
       behind it, which is the branch that has to stay closed. So the back
       button on the starter picker is removed as it appears, and the setup
       screen is never shown again once the game has started. */
    const seal = () => {
      const back = document.getElementById('spBack');
      if (back) back.remove();
    };

    const fill = () => {
      const cards = document.querySelectorAll('.team-card');
      if (cards.length < 2) return false;
      cards.forEach((card, t) => {
        const nameIn = card.querySelector('.tname');
        if (!nameIn) return;
        nameIn.value = LABELS[t];
        /* The card opens with five empty rows. Filling those first and only
           then adding more leaves exactly ten — the earlier version added ten
           on top and left five blanks behind, which startGame() skips but
           which are still five rows of nothing sitting in the sheet. */
        const add = card.querySelector('.addP');
        NAMES[t].forEach((who, i) => {
          let rows = card.querySelectorAll('.rrow');
          let row = rows[i];
          if (!row) {
            add && add.click();
            rows = card.querySelectorAll('.rrow');
            row = rows[rows.length - 1];
          }
          if (!row) return;
          const n = row.querySelector('.rname'), num = row.querySelector('.rnum');
          if (n) { n.value = who; n.dispatchEvent(new Event('input', { bubbles: true })); }
          if (num) { num.value = String(4 + i); num.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      });
      const go = document.getElementById('goGame');
      if (!go) return false;
      go.click();
      return true;
    };

    /* STRAIGHT TO THE GAME. Pressing "go into game" lands on the starting-five
       picker, which is a screen about a decision somebody has not been asked
       to make yet. The first five of ten are already selected by the picker
       itself, so the sensible default is one more click — and this makes it,
       rather than leaving a stranger on a screen whose purpose they have to
       work out. Driven through the real buttons, so training cannot drift
       away from the live app the way a second code path would. */
    const enter = () => {
      seal();
      const go = document.getElementById('spGo');
      if (!go) return false;
      go.click();
      return !document.getElementById('startersview') ||
             document.getElementById('startersview').classList.contains('hidden');
    };

    /* The setup screen is built by the page's own script, which may not have
       run yet. Poll briefly for each step, then stop rather than spin. */
    let tries = 0;
    const step = (fn, next) => {
      const tick = () => {
        if (fn()) { if (next) next(); return; }
        if (++tries > 60) return;
        setTimeout(tick, 80);
      };
      tick();
    };
    step(fill, () => { tries = 0; step(enter, seal); });

    /* and if anything ever puts the setup screen back, it does not stay */
    const guard = new MutationObserver(() => {
      seal();
      const setup = document.getElementById('setup');
      if (setup && !setup.classList.contains('hidden') &&
          document.getElementById('game') &&
          !document.getElementById('game').classList.contains('hidden')) {
        setup.classList.add('hidden');
      }
    });
    if (document.body) guard.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded',
      () => guard.observe(document.body, { childList: true, subtree: true }));
  }
})();
