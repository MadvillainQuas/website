'use strict';
/* ============================================================================
   GOVERNANCE — the parts of running a league that are not statistics.

   Discipline, suspensions, fixture surgery and correcting the record. Four
   panels that share one idea: THE DERIVED TABLES STAY DERIVED. A points
   deduction is a stored sanction that recompute_standings subtracts every time
   it runs (migration 0045), never an edit to a standings row — so pressing
   "recompute" cannot quietly forgive a penalty, which is what would happen if
   the number had been typed into the table.

   Every write is an RPC that authorises its own caller. This file decides what
   to draw, never what is permitted.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGovernance = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const opt = (v, l) => { const o = document.createElement('option'); o.value = v;
  o.textContent = l; return o; };

/* datetime-local wants local wall-clock with no zone; toISOString gives UTC,
   which silently shifts a 19:30 tip-off by an hour for half the year. */
const forInput = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         'T' + p(d.getHours()) + ':' + p(d.getMinutes());
};

/* ==========================================================================
   1. FIXTURE ROW ACTIONS — edit, delete, void, reopen.

   Returned as nodes rather than rendered here, so admin.js keeps ownership of
   the row and this file only adds to it. What is offered depends on the
   game's status, because the database will refuse the rest anyway and a
   button that is always refused is a worse button than one that is absent.
   ========================================================================== */
function fixtureActions(o) {
  const { sb, game, comp, teams, say, onDone } = o;
  const out = [];

  const edit = el('button', 'ep-btn mini', 'edit');
  edit.type = 'button';
  edit.title = game.status === 'scheduled'
    ? 'change the clubs, the date or the venue'
    : 'this game has been played — its date and venue can still be corrected';
  edit.addEventListener('click', () => openEditor(o));
  out.push(edit);

  if (game.status === 'scheduled') {
    const del = el('button', 'ep-btn mini', '×');
    del.type = 'button';
    del.title = 'delete this fixture';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this fixture? Nothing has been scored on it.')) return;
      const { data, error } = await sb.rpc('delete_fixture', { p_game: game.id });
      if (error) return say(error.message, 'err');
      say(data, 'ok'); onDone && onDone();
    });
    out.push(del);
  }

  if (game.status === 'final' || game.status === 'void') {
    const isVoid = game.status === 'void';
    const v = el('button', 'ep-btn mini', isVoid ? 'reinstate' : 'void');
    v.type = 'button';
    v.title = isVoid
      ? 'count this result again'
      : 'stop this result counting — the events are kept';
    v.addEventListener('click', async () => {
      if (!isVoid && !confirm(
        'Void this game?\n\nThe event log is kept, so nothing is lost and it ' +
        'can be reinstated. It stops counting towards the table, which is ' +
        'rebuilt straight away.')) return;
      const { data, error } = await sb.rpc('set_game_status',
        { p_game: game.id, p_status: isVoid ? 'scheduled' : 'void' });
      if (error) return say(error.message, 'err');
      say(data, 'ok'); onDone && onDone();
    });
    out.push(v);
  }
  return out;
}

function openEditor(o) {
  const { sb, game, comp, teams, say, onDone } = o;
  const played = game.status !== 'scheduled';
  const list = Object.values(teams || {});

  const wrap = el('div', 'gv-edit');
  const r1 = el('div', 'row');
  const home = el('select', 'ep-input grow');
  const away = el('select', 'ep-input grow');
  list.forEach(t => { home.appendChild(opt(t.id, t.name)); away.appendChild(opt(t.id, t.name)); });
  home.value = game.home_team_id; away.value = game.away_team_id;
  if (played) {
    /* The event log names the clubs. Swapping them here would leave every
       derived figure — box score, standings, plus/minus — pointing at the
       wrong one, so the database refuses it and the control says why. */
    home.disabled = away.disabled = true;
    home.title = away.title = 'a played game keeps its clubs';
  }
  r1.append(home, el('span', 'ep-micro', 'v'), away);

  const r2 = el('div', 'row');
  const when = el('input', 'ep-input'); when.type = 'datetime-local';
  when.value = forInput(game.tipoff_at);
  const venue = el('input', 'ep-input'); venue.placeholder = 'Venue';
  venue.value = game.venue || '';
  const save = el('button', 'ep-btn mini pri', 'save');
  save.type = 'button';
  const cancel = el('button', 'ep-btn mini', 'cancel');
  cancel.type = 'button';
  r2.append(when, venue, save, cancel);
  wrap.append(r1, r2);

  const row = o.row;
  row.after(wrap);
  cancel.addEventListener('click', () => wrap.remove());

  save.addEventListener('click', async () => {
    save.disabled = true;
    const { error } = await sb.rpc('upsert_fixture', {
      p_game: game.id, p_competition: comp.id,
      p_home: home.value, p_away: away.value,
      p_tipoff: when.value ? new Date(when.value).toISOString() : null,
      p_venue: venue.value
    });
    save.disabled = false;
    if (error) return say(error.message, 'err');
    say('Fixture saved.', 'ok');
    wrap.remove();
    onDone && onDone();
  });
}

/* ==========================================================================
   2. DISCIPLINE — docking points and wins.
   ========================================================================== */
function mountDiscipline(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';
  if (!o.comp) {
    host.appendChild(el('div', 'empty', 'Pick a competition above to record a sanction.'));
    return;
  }

  host.appendChild(el('p', 'empty',
    'A deduction is stored against the competition and subtracted every time ' +
    'the table is rebuilt, so it cannot be lost by pressing recompute. ' +
    'Docking a win turns it into a loss rather than deleting the game, ' +
    'because games played still has to equal wins plus losses.'));

  const list = Object.values(o.teams || {});
  const r = el('div', 'row');
  const team = el('select', 'ep-input grow');
  list.forEach(t => team.appendChild(opt(t.id, t.name)));
  const pts = el('input', 'ep-input'); pts.type = 'number'; pts.value = '0';
  pts.style.flex = '0 0 92px'; pts.title = 'league points to dock';
  const wins = el('input', 'ep-input'); wins.type = 'number'; wins.value = '0';
  wins.style.flex = '0 0 92px'; wins.title = 'wins to dock';
  const when = el('input', 'ep-input'); when.type = 'date';
  when.value = new Date().toISOString().slice(0, 10);
  when.style.flex = '0 0 140px';
  const why = el('input', 'ep-input grow'); why.placeholder = 'Reason (published)';
  why.maxLength = 200;
  const go = el('button', 'ep-btn pri', 'dock');
  go.type = 'button';

  const lp = el('label', 'f'); lp.style.flex = '0 0 92px';
  lp.append(el('span', null, 'POINTS'), pts);
  const lw = el('label', 'f'); lw.style.flex = '0 0 92px';
  lw.append(el('span', null, 'WINS'), wins);
  const ld = el('label', 'f'); ld.style.flex = '0 0 140px';
  ld.append(el('span', null, 'EFFECTIVE'), when);

  r.append(team, lp, lw, ld);
  const r2 = el('div', 'row'); r2.append(why, go);
  host.append(r, r2);

  const listHost = el('div', 'list');
  host.appendChild(listHost);

  go.addEventListener('click', async () => {
    const p = Number(pts.value || 0), w = Number(wins.value || 0);
    if (!p && !w) return o.say('A sanction has to dock points, wins, or both.', 'err');
    if (!confirm('Dock ' + (p ? p + ' point' + (p === 1 ? '' : 's') : '') +
                 (p && w ? ' and ' : '') + (w ? w + ' win' + (w === 1 ? '' : 's') : '') +
                 ' from ' + (o.teams[team.value] || {}).name + '?\n\nThe table rebuilds now.')) return;
    go.disabled = true;
    const { error } = await o.sb.rpc('add_sanction', {
      p_competition: o.comp.id, p_team: team.value, p_points: p, p_wins: w,
      p_reason: why.value, p_effective: when.value || null });
    go.disabled = false;
    if (error) return o.say(error.message, 'err');
    o.say('Sanction recorded and the table rebuilt.', 'ok');
    why.value = ''; pts.value = '0'; wins.value = '0';
    load();
    o.onDone && o.onDone();
  });

  async function load() {
    const { data, error } = await o.sb.from('team_sanctions')
      .select('id,team_id,points,wins,reason,effective_on')
      .eq('competition_id', o.comp.id).order('effective_on', { ascending: false });
    listHost.textContent = '';
    if (error) return o.say(error.message, 'err');
    if (!data || !data.length) {
      listHost.appendChild(el('div', 'empty', 'No sanctions in this competition.'));
      return;
    }
    data.forEach(s => {
      const row = el('div', 'item');
      const bits = [];
      if (s.points) bits.push('−' + s.points + ' pts');
      if (s.wins) bits.push('−' + s.wins + ' win' + (s.wins === 1 ? '' : 's'));
      row.append(el('div', 'nm', (o.teams[s.team_id] || {}).name || '—'),
                 el('div', 'mt', bits.join(' · ') + ' · ' + s.effective_on +
                    (s.reason ? ' · ' + s.reason : '')));
      const sp = el('div', 'sp');
      const rm = el('button', 'ep-btn mini', 'remove'); rm.type = 'button';
      rm.addEventListener('click', async () => {
        if (!confirm('Remove this sanction and rebuild the table?')) return;
        const { error } = await o.sb.rpc('remove_sanction', { p_id: s.id });
        if (error) return o.say(error.message, 'err');
        o.say('Sanction removed.', 'ok'); load(); o.onDone && o.onDone();
      });
      sp.appendChild(rm); row.appendChild(sp);
      listHost.appendChild(row);
    });
  }
  load();
}

/* ==========================================================================
   3. SUSPENSIONS.

   A ban is a number of games, a date window, or both. Games are counted
   against fixtures the club actually plays, so a postponement does not
   shorten a ban and a voided game gives its match back — which is why
   "served" is read from the database on every render rather than being a
   counter this page decrements.
   ========================================================================== */
function mountSuspensions(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  host.appendChild(el('p', 'empty',
    'Bans are served against games the club actually plays, so a postponement ' +
    'does not shorten one and a voided game hands the match back. The reason ' +
    'is recorded for the league and is not published.'));

  const r1 = el('div', 'row');
  const search = el('input', 'ep-input grow');
  search.placeholder = 'find a player';
  const player = el('select', 'ep-input grow');
  r1.append(search, player);

  const r2 = el('div', 'row');
  const compSel = el('select', 'ep-input');
  compSel.appendChild(opt('', 'every competition'));
  (o.comps || []).forEach(c => compSel.appendChild(opt(c.id, c.name)));
  const games = el('input', 'ep-input'); games.type = 'number'; games.min = '1';
  games.placeholder = 'games';
  const from = el('input', 'ep-input'); from.type = 'date';
  from.value = new Date().toISOString().slice(0, 10);
  const to = el('input', 'ep-input'); to.type = 'date';

  const lg = el('label', 'f'); lg.style.flex = '0 0 100px';
  lg.append(el('span', null, 'GAMES'), games);
  const lf = el('label', 'f'); lf.style.flex = '0 0 150px';
  lf.append(el('span', null, 'FROM'), from);
  const lt = el('label', 'f'); lt.style.flex = '0 0 150px';
  lt.append(el('span', null, 'UNTIL (OPTIONAL)'), to);
  r2.append(compSel, lg, lf, lt);

  const r3 = el('div', 'row');
  const why = el('input', 'ep-input grow');
  why.placeholder = 'Reason (kept by the league, not published)';
  why.maxLength = 300;
  const go = el('button', 'ep-btn pri', 'suspend'); go.type = 'button';
  r3.append(why, go);

  const listHost = el('div', 'list');
  host.append(r1, r2, r3, listHost);

  let roster = [];
  async function findPlayers() {
    const { data, error } = await o.sb.rpc('league_players',
      { p_league: o.league.id, p_search: search.value || '' });
    if (error) return o.say(error.message, 'err');
    roster = data || [];
    player.textContent = '';
    if (!roster.length) { player.appendChild(opt('', 'nobody found')); return; }
    roster.forEach(p => player.appendChild(opt(
      p.player_id + '|' + p.team_id,
      p.first_name + ' ' + p.last_name + ' · ' + p.team_name +
      (p.jersey ? ' #' + p.jersey : '') + (p.suspended ? ' · BANNED' : ''))));
  }
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(findPlayers, 250); });

  go.addEventListener('click', async () => {
    if (!player.value) return o.say('Choose a player.', 'err');
    const [pid, tid] = player.value.split('|');
    if (!games.value && !to.value)
      return o.say('A ban needs a number of games, an end date, or both.', 'err');
    go.disabled = true;
    const { error } = await o.sb.rpc('suspend_player', {
      p_player: pid, p_team: tid, p_competition: compSel.value || null,
      p_games: games.value ? Number(games.value) : null,
      p_starts: from.value || null, p_ends: to.value || null,
      p_reason: why.value });
    go.disabled = false;
    if (error) return o.say(error.message, 'err');
    o.say('Suspension recorded.', 'ok');
    why.value = ''; games.value = ''; to.value = '';
    load(); findPlayers();
  });

  async function load() {
    const { data, error } = await o.sb.rpc('suspension_list', { p_league: o.league.id });
    listHost.textContent = '';
    if (error) return o.say(error.message, 'err');
    if (!data || !data.length) {
      listHost.appendChild(el('div', 'empty', 'Nobody is suspended.'));
      return;
    }
    data.forEach(s => {
      const row = el('div', 'item');
      if (s.active) row.classList.add('on');
      const bits = [];
      if (s.games) bits.push(s.served + ' of ' + s.games + ' served');
      if (s.ends_on) bits.push('until ' + s.ends_on);
      if (s.lifted_at) bits.push('LIFTED');
      else if (!s.active) bits.push('complete');
      row.append(el('div', 'nm', s.player_name),
                 el('div', 'mt', [s.team_name, s.competition_name, bits.join(' · '),
                                  s.reason].filter(Boolean).join(' · ')));
      if (!s.lifted_at) {
        const sp = el('div', 'sp');
        const lift = el('button', 'ep-btn mini', 'lift'); lift.type = 'button';
        lift.title = 'rescind, e.g. on appeal';
        lift.addEventListener('click', async () => {
          if (!confirm('Lift the ban on ' + s.player_name + '?')) return;
          const { error } = await o.sb.rpc('lift_suspension', { p_id: s.id });
          if (error) return o.say(error.message, 'err');
          o.say('Lifted.', 'ok'); load(); findPlayers();
        });
        sp.appendChild(lift); row.appendChild(sp);
      }
      listHost.appendChild(row);
    });
  }

  findPlayers();
  load();
}

/* ==========================================================================
   4. THE RECORD — clubs and players.

   The club portal already lets a club edit itself. This is the league's own
   copy, for the secretary who has to fix a surname on a Sunday night without
   waiting for somebody at the club to do it.
   ========================================================================== */
function mountRecords(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  /* BOTH LISTS FOLD, AND THE LONG ONE STARTS FOLDED.

     A league of twelve clubs has around a hundred and eighty players in it,
     and each one is a three-row card — so the panel below was some four
     thousand pixels tall, and everything after it on the page (discipline,
     bans, awards) sat below all of it. Scrolling past a list you are not
     using to reach a button you are is not a small annoyance; it is the
     difference between a page you can work on and one you fight.

     Folded by default, and the count is on the tab, so the shape of the
     league is legible without opening anything. A search opens it — typing a
     name is an unambiguous request to see people. */
  const clubs = el('div', 'list');
  host.appendChild(fold('Clubs', clubs, true));
  Object.values(o.teams || {}).forEach(t => {
    const row = el('div', 'row');
    const name = el('input', 'ep-input grow'); name.value = t.name; name.maxLength = 80;
    const short = el('input', 'ep-input'); short.value = t.short_name || '';
    short.maxLength = 6; short.placeholder = 'ABC'; short.style.flex = '0 0 84px';
    short.title = 'the three or four letters used on the scoreboard';
    const colour = el('input', 'ep-input'); colour.type = 'color';
    colour.value = t.colour || '#93f2bf'; colour.style.cssText = 'flex:0 0 46px;padding:3px';
    const slug = el('input', 'ep-input'); slug.value = t.slug;
    slug.style.flex = '0 0 170px'; slug.title = 'the club’s public address — changing it breaks saved links';
    const save = el('button', 'ep-btn mini', 'save'); save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      const { error } = await o.sb.rpc('admin_update_team', {
        p_team: t.id, p_name: name.value, p_short: short.value,
        p_colour: colour.value, p_slug: slug.value });
      save.disabled = false;
      if (error) return o.say(error.message, 'err');
      o.say('Saved ' + name.value + '.', 'ok');
      o.onDone && o.onDone();
    });
    row.append(name, short, colour, slug, save);
    clubs.appendChild(row);
  });

  const pbody = el('div');
  pbody.appendChild(el('p', 'empty',
    'Birth year is held for eligibility and is never published. Under-18 ' +
    'marks a player as a minor, which withholds their name and photograph ' +
    'from every public page, the API and every partner feed — the database ' +
    'enforces that, not this page.'));

  const sr = el('div', 'row');
  const search = el('input', 'ep-input grow'); search.placeholder = 'find a player';
  sr.appendChild(search);
  pbody.appendChild(sr);
  const plist = el('div', 'list');
  pbody.appendChild(plist);

  const pfold = fold('Players', pbody, false);
  host.appendChild(pfold);

  async function load() {
    const { data, error } = await o.sb.rpc('league_players',
      { p_league: o.league.id, p_search: search.value || '' });
    plist.textContent = '';
    if (error) return o.say(error.message, 'err');
    if (!data || !data.length) {
      pfold.count(search.value ? 'none found' : '0');
      plist.appendChild(el('div', 'empty', 'Nobody found.'));
      return;
    }
    /* The count says what is being SHOWN when that is not everything, because
       a bare "180" over a list of 120 cards is a page quietly lying about
       where the rest went. */
    pfold.count(data.length > 120 ? '120 of ' + data.length : String(data.length));
    /* THE SAME FIELDS THE CLUB PORTAL MAINTAINS. Two editors for one player
       that disagree about which fields exist is how a club fills in a
       wingspan that a league administrator then cannot see — so this is the
       portal's card laid out as rows, writing through the same RPCs, which
       migration 0052 relaxed to accept a league admin. */
    data.slice(0, 120).forEach(p => {
      const card = el('div', 'gv-player');

      const r1 = el('div', 'row');
      const first = el('input', 'ep-input'); first.value = p.first_name;
      first.style.flex = '1 1 120px';
      const last = el('input', 'ep-input'); last.value = p.last_name;
      last.style.flex = '1 1 140px';
      const yr = el('input', 'ep-input'); yr.type = 'number'; yr.min = '1900'; yr.max = '2100';
      yr.value = p.birth_year || ''; yr.style.flex = '0 0 88px'; yr.placeholder = 'born';
      const who = el('span', 'mt', p.team_name + (p.jersey ? ' #' + p.jersey : '') +
                                  (p.age != null ? ' · ' + p.age : '') +
                                  (p.suspended ? ' · BANNED' : ''));
      who.style.marginLeft = 'auto';
      r1.append(first, last, yr, who);
      card.appendChild(r1);

      const r2 = el('div', 'row');
      const h = el('input', 'ep-input'); h.type = 'number'; h.placeholder = 'ht cm';
      h.value = p.height_cm || ''; h.style.flex = '0 0 88px';
      const w = el('input', 'ep-input'); w.type = 'number'; w.placeholder = 'wt kg';
      w.value = p.weight_kg || ''; w.style.flex = '0 0 88px';
      const ws = el('input', 'ep-input'); ws.type = 'number'; ws.placeholder = 'wing cm';
      ws.value = p.wingspan_cm || ''; ws.style.flex = '0 0 96px';
      const pos = el('input', 'ep-input'); pos.placeholder = 'position';
      pos.value = p.position || ''; pos.style.flex = '1 1 120px';
      const prev = el('input', 'ep-input'); prev.placeholder = 'previous club';
      prev.value = (p.previous_clubs && p.previous_clubs[0] && p.previous_clubs[0].club)
                   || p.previous_club || '';
      prev.style.flex = '1 1 150px';
      r2.append(h, w, ws, pos, prev);
      card.appendChild(r2);

      const r3 = el('div', 'row');
      const minor = el('label', 'sw');
      const mb = el('input'); mb.type = 'checkbox'; mb.checked = p.is_minor;
      minor.append(mb, document.createTextNode(' protected'));
      const cons = el('label', 'sw');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = p.photo_consent;
      cons.append(cb, document.createTextNode(' photo consent'));
      const pubc = el('label', 'sw');
      const pb = el('input'); pb.type = 'checkbox'; pb.checked = !!p.public_consent;
      pubc.append(pb, document.createTextNode(' publication consent'));
      const guard = el('input', 'ep-input'); guard.placeholder = 'who gave consent';
      guard.value = p.consent_guardian || ''; guard.style.flex = '1 1 170px';
      const save = el('button', 'ep-btn mini pri', 'save'); save.type = 'button';
      r3.append(minor, cons, pubc, guard, save);
      card.appendChild(r3);

      save.addEventListener('click', async () => {
        if (pb.checked && !guard.value.trim()) {
          return o.say('Record who gave consent before ticking it.', 'err');
        }
        save.disabled = true;
        try {
          /* TWO CALLS, because they are two different rights. A league may
             correct a spelling on any player in it; recording a guardian's
             permission is the narrower one, and keeping them apart means the
             refusal, when it comes, names which of the two was refused. */
          let r = await o.sb.rpc('admin_update_player', {
            p_player: p.player_id, p_first: first.value, p_last: last.value,
            p_birth_year: yr.value ? Number(yr.value) : null,
            p_is_minor: mb.checked, p_photo_consent: cb.checked });
          if (r.error) throw r.error;

          /* 0 clears a measurement, null leaves it alone — an untouched box
             must not wipe what a club typed in. */
          const num = v => v.value === '' ? 0 : Number(v.value);
          r = await o.sb.rpc('set_player_profile', {
            p_player: p.player_id, p_height: num(h), p_weight: num(w),
            p_wingspan: num(ws), p_previous_club: prev.value,
            p_position: pos.value, p_consent: pb.checked, p_guardian: guard.value });
          if (r.error) throw r.error;

          o.say('Saved ' + first.value + ' ' + last.value + '.', 'ok');
        } catch (e) {
          o.say(e.message || 'That was refused.', 'err');
        }
        save.disabled = false;
      });

      plist.appendChild(card);
    });
  }
  let t = null;
  search.addEventListener('input', () => {
    pfold.open(true);                    // typing a name means: show me people
    clearTimeout(t); t = setTimeout(load, 250);
  });
  load();                                // counts the list without unfolding it
}

/* ---------------------------------------------------------------------------
   A FOLD. A button that owns a region, standard disclosure semantics so a
   screen reader announces the state, and hidden with the `hidden` attribute
   rather than display:none so nothing inside is focusable while it is shut —
   tabbing into an invisible list of two hundred inputs is the version of this
   that looks fixed and is not.
   ------------------------------------------------------------------------- */
function fold(label, body, openAt) {
  const wrap = el('div', 'gv-fold');
  const btn = el('button', 'gv-fold-h'); btn.type = 'button';
  const tw = el('span', 'tw', '\u25B8');
  const nm = el('span', 'nm', label);
  const ct = el('span', 'ct', '');
  btn.append(tw, nm, ct);
  wrap.append(btn, body);

  let on = null;
  function set(v) {
    if (on === v) return;
    on = v;
    body.hidden = !v;
    btn.setAttribute('aria-expanded', v ? 'true' : 'false');
    tw.textContent = v ? '\u25BE' : '\u25B8';
    wrap.classList.toggle('on', v);
  }
  btn.addEventListener('click', () => set(!on));
  set(!!openAt);

  wrap.open = set;
  wrap.count = v => { ct.textContent = v == null ? '' : String(v); };
  return wrap;
}

return { fixtureActions, mountDiscipline, mountSuspensions, mountRecords };
}));
