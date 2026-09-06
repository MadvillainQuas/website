'use strict';
/* ============================================================================
   Team profile — identity, record, team statistics, roster, results.

   The statistics table is the same component the leaders board and the season
   page use, so a column means the same thing wherever you read it. Minors are
   filtered by RLS, not here: a U18 player never comes back from the players
   join, so this page cannot leak one by forgetting a check.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const T = window.EpinoiaTable;
const want = new URLSearchParams(location.search).get('t') || '';
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want);

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = (v, d = '—') => (v == null ? d : Number(v).toFixed(1));

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

function oops(msg) {
  ['#roster', '#games', '#teamstats'].forEach(s => { const h = $(s); if (h) h.textContent = ''; });
  $('#games').appendChild(el('div', 'empty', msg));
}

(async function boot() {
  if (!want) return oops('No team specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    const ts = await api(`teams?${key}=eq.${encodeURIComponent(want)}&select=*,leagues(id,name,slug,country)&limit=1`);
    if (!ts.length) return oops('Team not found.');
    const team = ts[0];
    const colour = team.colour || '#93f2bf';
    document.documentElement.style.setProperty('--team-a', colour);

    /* THE CLUB'S CREST WHERE ITS INITIALS WERE.

       teams.logo_path is the right source rather than a query against media:
       it is set only when a crest is actually published and cleared when one is
       removed, so a non-null value already means "live", and it arrives with
       the team row that has just been fetched — no second request to decide
       whether to draw a badge.

       The initials stay as the fallback, and stay in the DOM until the image
       has actually loaded: a crest that 404s must leave a badge behind rather
       than an empty square where the club should be. */
    const badge = $('#badge');
    badge.style.background = colour;
    badge.textContent = team.short_name || (team.name || '?').slice(0, 2).toUpperCase();
    const crestUrl = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(team.logo_path) : null;
    if (crestUrl) {
      const crest = document.createElement('img');
      /* resolved by the shared helper: a club's uploaded crest lives in the
         media-public bucket, a fed club's comes from FIBA LiveStats as a URL */
      crest.src = crestUrl;
      crest.alt = '';
      crest.addEventListener('load', () => {
        /* the initials are only cleared once the crest is actually on screen */
        [...badge.childNodes].forEach(n => { if (n !== crest) n.remove(); });
        badge.classList.add('has-crest');
      });
      crest.addEventListener('error', () => crest.remove());
      badge.appendChild(crest);
    }
    $('#tname').textContent = team.name;
    $('#tname').style.color = colour;
    const lg = team.leagues || {};
    $('#tsub').textContent = lg.name || 'Independent';
    $('#ctx').textContent = lg.name ? lg.name + ' · ' + team.name : team.name;
    if (lg.slug) $('#leagueLink').href = '../l/?l=' + encodeURIComponent(lg.slug);
    else $('#leagueLink').style.display = 'none';
    document.title = team.name + ' · Epinoia';

    await Promise.all([record(team), teamStats(team), venue(team),
                       roster(team), games(team)]);
    await lineupPanels(team);
  } catch (e) { oops('Could not load: ' + e.message); }
})();

async function record(team) {
  const st = await api(`standings?team_id=eq.${team.id}` +
    `&select=gp,w,l,pts_for,pts_against,diff,league_points,rank,streak&limit=1`);
  const wrap = $('#rec'); wrap.textContent = '';
  const s = st[0];
  const cells = s
    ? [['rank', s.rank ?? '—'], ['record', `${s.w}-${s.l}`], ['played', s.gp],
       ['pts for', s.pts_for], ['pts against', s.pts_against],
       ['diff', (s.diff > 0 ? '+' : '') + s.diff], ['streak', s.streak || '—']]
    : [['record', '0-0'], ['played', 0]];
  cells.forEach(([l, v]) => {
    const d = el('div'); d.append(el('div', 'v', v), el('div', 'l', l)); wrap.appendChild(d);
  });
}

/* ------------------------------------------------------------ team stats --- */
/* Two readings of the same season: the team's own line, and every player on it
   through the full table. The team line is shown as tiles because there is
   only one row of it — a one-row table is a worse way to read a single line. */
async function teamStats(team) {
  const host = $('#teamstats'); host.textContent = '';
  const D = window.EpinoiaData;
  let S = null;
  try {
    const g = await D.get(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
                          `&status=eq.final&select=competition_id&limit=1`);
    if (g[0] && g[0].competition_id) S = await D.season(g[0].competition_id);
  } catch (e) {
    host.appendChild(el('div', 'empty', 'Could not load: ' + e.message)); return;
  }
  const mine = S && S.teams.find(t => t.id === team.id);
  if (!mine) {
    host.appendChild(el('div', 'empty',
      'No team statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }

  /* The four factors first and labelled as such: they are the four things that
     decide a basketball game, and both ends of each are shown because a
     defence is only describable relative to what it faced. */
  const ff = el('div');
  ff.appendChild(el('div', 'ffhead', 'four factors'));
  const grid = el('div', 'ffgrid');
  [['shooting', 'eFG%', mine.ff_efg, mine.dff_efg, false],
   ['turnovers', 'TOV%', mine.ff_tov, mine.dff_tov, true],
   ['rebounding', 'OREB%', mine.ff_oreb, mine.dff_oreb, false],
   ['free throws', 'FTr', mine.ff_ftr, mine.dff_ftr, false]]
    .forEach(([label, unit, off, def, lowGood]) => {
      const card = el('div', 'ffcard');
      card.appendChild(el('div', 'ffl', label + ' · ' + unit));
      const pair = el('div', 'ffpair');
      const o = el('div', 'ffside');
      o.append(el('div', 'ffv', n1(off)), el('div', 'ffk', 'own'));
      const d = el('div', 'ffside');
      d.append(el('div', 'ffv', n1(def)), el('div', 'ffk', 'allowed'));
      /* Green marks an ADVANTAGE TO THIS TEAM, never simply the larger number.
         Opponents shooting a better eFG% than you is a weakness; colouring
         "allowed" green because 49.1 > 48.1 would read as a strength and say
         the opposite of what happened. So the edge is computed in the team's
         favour, and a deficit is marked as such rather than dressed up. */
      const edge = (off == null || def == null) ? null
        : (lowGood ? def - off : off - def);          // positive = this team ahead
      if (edge != null && Math.abs(edge) >= 0.05) {
        (edge > 0 ? o : d).classList.add(edge > 0 ? 'win' : 'lose');
      }
      pair.append(o, d); card.appendChild(pair);
      grid.appendChild(card);
    });
  ff.appendChild(grid);
  host.appendChild(ff);

  const tiles = el('div', 'tiles');
  [['ppg', n1(mine.ppg), true], ['opp ppg', n1(mine.papg), false],
   ['diff', mine.diffpg == null ? '—' : (mine.diffpg > 0 ? '+' : '') + n1(mine.diffpg), true],
   ['ortg', n1(mine.ortg), true], ['drtg', n1(mine.drtg), false],
   ['net', mine.net == null ? '—' : (mine.net > 0 ? '+' : '') + n1(mine.net), true],
   ['pace', n1(mine.pace), false], ['ts%', n1(mine.ts), false],
   ['ast/to', mine.ast_to == null ? '—' : Number(mine.ast_to).toFixed(2), false],
   ['reb', mine.reb, false], ['ast', mine.ast, false], ['stl', mine.stl, false],
   ['blk', mine.blk, false], ['paint', mine.paint, false], ['fast', mine.fast, false],
   ['2nd chance', mine.second_chance, false], ['off turnovers', mine.pts_off_to, false],
   ['bench', mine.bench, false]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v == null ? '—' : v), el('div', 'l', l));
      tiles.appendChild(d);
    });
  host.appendChild(tiles);

  /* every player on the roster, ranked within their own team */
  const meta = await D.playerMeta(S.players.map(p => p.id));
  S.players.forEach(p => Object.assign(p, meta[p.id] || {}));
  const squad = S.players.filter(p => p.teamId === team.id);
  if (squad.length) {
    const sub = el('div');
    host.appendChild(sub);
    T.render({
      host: sub, kind: 'player', sortKey: 'ppg', showMinGames: false,
      filename: (team.slug || 'team') + '-players',
      rows: squad,
      playerHref: r => '../p/?p=' + encodeURIComponent(r.id)
    });
  }
}

/* ------------------------------------------------------- lineups & WOWY --- */
/* All three panels read the same stints, fetched once. */
async function lineupPanels(team) {
  const D = window.EpinoiaData;
  try {
    const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
      `&status=eq.final&select=id,home_team_id,away_team_id`);
    if (!gs.length) {
      ['#wowy', '#lufilter', '#lulist'].forEach(sel =>
        $(sel).appendChild(el('div', 'empty',
          'No finalised games yet — lineups appear once one is played.')));
      return;
    }
    const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
    const st = await D.stints(gs.map(g => g.id), team.id, byGame);
    if (!st.length) {
      ['#wowy', '#lufilter', '#lulist'].forEach(sel =>
        $(sel).appendChild(el('div', 'empty', 'No lineup data yet.')));
      return;
    }

    const ids = [...new Set(st.flatMap(r => r.player_ids))];
    const meta = await D.playerMeta(ids);
    $('#wowyNote').textContent = st.length + ' stints · ' + ids.length + ' players';

    /* the team WOWY needs a subject; default to the most-used player and let
       the reader change it, because "the team without X" is a question about a
       specific X rather than about the team */
    const mins = new Map();
    st.forEach(s2 => (s2.player_ids || []).forEach(id =>
      mins.set(id, (mins.get(id) || 0) + ((s2.stats && s2.stats.dur) || 0))));
    const order = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    let subject = order[0];

    const pick = $('#wowyPick');
    order.forEach(id => {
      const b = el('button', 'ep-chip' + (id === subject ? ' on' : ''),
                   (meta[id] || {}).name || 'Player');
      b.type = 'button';
      b.addEventListener('click', () => {
        subject = id;
        pick.querySelectorAll('.ep-chip').forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        drawWowy();
      });
      pick.appendChild(b);
    });

    function drawWowy() {
      window.EpinoiaWowy.onOffTiles('#onoff', st, subject);
    }
    drawWowy();

    /* the combination matrix, seeded with the two most-used players */
    window.EpinoiaWowy.render({
      host: '#wowy', stints: st, meta, max: 4,
      preselect: order.slice(0, 2)
    });

    window.EpinoiaLineupUI.filterPanel({ host: '#lufilter', stints: st, meta });
    window.EpinoiaLineupUI.listPanel({ host: '#lulist', stints: st, meta });
  } catch (e) {
    /* A silent catch left three empty sections with no explanation — which is
       exactly what a reader saw when the scripts failed to load. Say what
       happened, in the sections themselves. */
    console.warn('[lineups]', e);
    ['#wowy', '#lufilter', '#lulist'].forEach(sel => {
      const h = $(sel);
      if (h && !h.children.length) {
        h.appendChild(el('div', 'empty', 'Could not load lineup data: ' + (e.message || e)));
      }
    });
  }
}

/* the home venue panel lives in its own module — it is a self-contained
   piece of page with its own illustration and its own privacy rule */
async function venue(team) {
  /* THE HOME VENUE, READ OFF THE FIXTURES when nobody has typed one in. Every
     home fixture the feed (or a league admin) files carries a venue, and the
     one that appears most is the club's hall. A recorded venue still wins —
     this only fills the gap, and a league administrator or the club can
     overwrite it from their own settings. */
  if (!team.home_venue && !team.home_venue_address) {
    try {
      const rows = await api('games?home_team_id=eq.' + team.id + '&venue=not.is.null&select=venue&order=tipoff_at.desc&limit=60');
      const count = new Map();
      (rows || []).forEach(g => { const v = String(g.venue || '').trim(); if (v) count.set(v, (count.get(v) || 0) + 1); });
      let best = null, n = 0;
      count.forEach((c, v) => { if (c > n) { best = v; n = c; } });
      if (best) { team.home_venue_auto = best; team.home_venue_auto_n = n; }
    } catch (_) { /* no fixtures, no guess */ }
  }
  const out = await window.EpinoiaVenue.render({
    host: '#venue', team, api, cfg: CFG
  });
  const note = $('#venueNote');
  if (note) note.textContent = (out && out.photo) ? '' : 'illustrated';
}

/* ------------------------------------------------------------------ roster ---
   The squad, with the measurements a scout actually asks for.

   EDITABLE IN PLACE for whoever manages the club. A separate edit screen for
   four numbers is a screen nobody opens, so the cells become inputs when the
   viewer has the right and stay plain text when they do not. Nothing here
   decides who may edit — it asks the database, and a save that should not
   happen is refused by RLS whatever this page believes.

   Height and wingspan are entered and shown in centimetres because that is
   what a tape measure in a British sports hall reads, with feet and inches
   alongside since that is how people talk about it. */
const MEASURES = [
  { k: 'height_cm',     l: 'HT',   w: 74, unit: 'cm', imperial: true,  min: 100, max: 260 },
  { k: 'weight_kg',     l: 'WT',   w: 66, unit: 'kg', imperial: false, min: 30,  max: 250 },
  { k: 'wingspan_cm',   l: 'WING', w: 74, unit: 'cm', imperial: true,  min: 120, max: 280 },
  { k: 'previous_club', l: 'PREVIOUS CLUB', w: 160, text: true }
];

const feetInches = cm => {
  if (!cm) return '';
  const total = Math.round(cm / 2.54);
  return Math.floor(total / 12) + "'" + String(total % 12) + '"';
};

/* ------------------------------------------------------------------ staff ---
   The bench, above the squad — head coach first, then whatever order a
   programme would print.

   AGE, NOT DATE OF BIRTH. `team_staff_public` computes it from a year of
   birth, which is all that is stored: the same rule `players` follows, and an
   age derived from a year cannot go stale the way a typed-in age does. The
   cost is that it is right to within a year, which is what a staff list means
   anyway.

   Ordering comes from the database's `sort`, seeded from the role, so a club
   that adds a physio before an assistant coach still gets a list that reads
   correctly without anybody having to reorder it. */
const ROLE_SUGGESTIONS = [
  'Head Coach', 'Assistant Coach', 'Associate Head Coach', 'Player Development',
  'General Manager', 'Team Manager', 'Strength and Conditioning', 'Physiotherapist',
  'Doctor', 'Video Analyst', 'Analyst', 'Scout', 'Equipment Manager', 'Statistician'
];

/* The same ordering the database seeds a new row with (staff_rank in 0036),
   repeated here so an EDITED role re-sorts too. Two copies of a rule is one
   too many, but the alternative is a round trip on every keystroke; if this
   list grows it should become an RPC. */
const ROLE_RANK = {
  'head coach': 10, 'manager': 10, 'associate head coach': 15,
  'assistant coach': 20, 'player development': 25, 'general manager': 30,
  'team manager': 35, 'strength and conditioning': 40, 's&c': 40,
  'physiotherapist': 50, 'physio': 50, 'doctor': 55,
  'analyst': 60, 'video analyst': 60, 'scout': 65,
  'equipment manager': 70, 'statistician': 75
};
const roleRank = r => ROLE_RANK[String(r || '').trim().toLowerCase()] ?? 100;

async function staff(team, canEdit, sb) {
  const host = $('#roster');

  /* A manager needs the year of birth to edit it; everyone else gets the view,
     which carries an age and nothing else. Two reads because they are two
     different things, not one read with a flag. */
  let rows = [];
  try {
    rows = canEdit
      ? (await sb.from('team_staff').select('id,name,role,born_year,sort,active')
           .eq('team_id', team.id).eq('active', true).order('sort').order('role')).data || []
      : await api(`team_staff_public?team_id=eq.${team.id}&select=id,name,role,age,sort` +
                  `&order=sort,role`);
  } catch (_) { rows = []; }

  if (!rows.length && !canEdit) return;      // no staff on file, nothing to say

  const head = el('div', 'staffhead');
  head.appendChild(el('div', 'sh', 'Coaching & support staff'));
  if (rows.length) head.appendChild(el('div', 'sn', rows.length + ' listed'));
  host.appendChild(head);

  const grid = el('div', 'staffgrid');
  host.appendChild(grid);

  const thisYear = new Date().getFullYear();

  const readOnlyCard = (s) => {
    const c = el('div', 'staffcard');
    c.appendChild(el('div', 'staffrole', s.role || 'Staff'));
    c.appendChild(el('div', 'staffname', s.name || '—'));
    if (s.age != null) {
      const a = el('div', 'staffage', String(s.age));
      a.appendChild(el('span', null, 'years'));
      c.appendChild(a);
    }
    return c;
  };

  const editCard = (s) => {
    const c = el('div', 'staffcard edit');

    const mk = (cls, value, ph, onSave, attrs) => {
      const i = el('input', cls);
      i.value = value == null ? '' : String(value);
      i.placeholder = ph;
      /* `list` is a READ-ONLY property on HTMLInputElement — it returns the
         datalist element, it does not set one. Object.assign onto it throws
         in strict mode, which took the whole roster down and, through the
         boot catch, printed "cannot set property list" where the fixtures
         should have been. Anything that is only ever an attribute goes
         through setAttribute; the rest can be assigned. */
      Object.entries(attrs || {}).forEach(([k, v]) => {
        if (k === 'list' || k === 'min' || k === 'max') i.setAttribute(k, v);
        else i[k] = v;
      });
      let last = i.value;
      const save = async () => {
        if (i.value === last) return;
        const out = onSave(i.value.trim());
        if (out === false) { i.classList.add('bad'); return; }
        i.classList.remove('bad');
        const patch = out;
        /* A row that has never been saved has no id yet — the first edit
           creates it, so a half-typed card is never left in the database. */
        if (s.id) {
          const { error } = await sb.from('team_staff').update(patch).eq('id', s.id);
          if (error) { i.classList.add('bad'); i.title = error.message; i.value = last; return; }
        } else {
          const seed = { team_id: team.id, name: s.name || 'New name',
                         role: s.role || 'Staff', ...patch };
          seed.sort = roleRank(seed.role);
          const { data, error } = await sb.from('team_staff')
            .insert(seed).select('id').single();
          if (error) { i.classList.add('bad'); i.title = error.message; i.value = last; return; }
          s.id = data.id;
        }
        Object.assign(s, patch);
        last = i.value;
      };
      i.addEventListener('blur', save);
      i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
      return i;
    };

    /* Changing the role also moves the card, because "Head Coach" belongs at
       the top wherever it was typed. The new position takes effect on the next
       load rather than jumping the card out from under the cursor. */
    c.appendChild(mk('role', s.role, 'ROLE', v =>
      v ? { role: v, sort: roleRank(v) } : false, { maxLength: 60, list: 'staffroles' }));

    c.appendChild(mk('nm', s.name, 'Full name', v =>
      v ? { name: v } : false, { maxLength: 90 }));

    const row = el('div', 'srow');
    row.appendChild(mk('yr', s.born_year, 'Born', v => {
      if (v === '') return { born_year: null };
      const y = parseInt(v, 10);
      if (!isFinite(y) || y < 1900 || y > thisYear) return false;
      return { born_year: y };
    }, { type: 'number', min: '1900', max: String(thisYear) }));

    const del = el('button', 'staffdel', 'remove');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!s.id) { c.remove(); return; }
      del.disabled = true;
      /* Deactivated, not deleted. A club that removes the wrong person can be
         put back, and a hard delete of a named individual is not something to
         hang on a single mis-click. */
      const { error } = await sb.from('team_staff').update({ active: false }).eq('id', s.id);
      del.disabled = false;
      if (error) { del.title = error.message; del.classList.add('bad'); return; }
      c.remove();
    });
    row.appendChild(del);
    c.appendChild(row);
    return c;
  };

  rows.forEach(s => grid.appendChild(canEdit ? editCard(s) : readOnlyCard(s)));

  if (canEdit) {
    /* the role suggestions, shared by every card */
    if (!document.getElementById('staffroles')) {
      const dl = el('datalist'); dl.id = 'staffroles';
      ROLE_SUGGESTIONS.forEach(r => { const o = el('option'); o.value = r; dl.appendChild(o); });
      document.body.appendChild(dl);
    }
    const add = el('div', 'staffcard add');
    const btn = el('button', null, '+ add somebody');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const blank = { id: null, name: '', role: '', born_year: null };
      grid.insertBefore(editCard(blank), add);
    });
    add.appendChild(btn);
    grid.appendChild(add);

    if (!rows.length) {
      host.appendChild(el('div', 'empty',
        'No staff listed yet. Add the head coach and anyone else who should be ' +
        'on the club\'s page — the list orders itself by role.'));
    }
  }
}

async function roster(team) {
  const rows = await api(`roster_entries?team_id=eq.${team.id}&active=eq.true` +
    `&select=jersey,position,players(id,first_name,last_name,slug,is_minor,` +
    `height_cm,weight_kg,wingspan_cm,previous_club)&order=jersey`);
  const host = $('#roster'); host.textContent = '';

  /* May this viewer edit? The database is asked, not assumed — and a viewer
     who is not signed in never even makes the request. */
  let canEdit = false;
  const sb = window.epinoiaClient && window.epinoiaClient();
  if (sb) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data } = await sb.rpc('is_team_manager', { p_team: team.id });
        canEdit = !!data;
      }
    } catch (_) { canEdit = false; }
  }

  /* Staff first — a squad list starts with who picks it. */
  await staff(team, canEdit, sb);

  if (!rows.length) { host.appendChild(el('div', 'empty', 'No players listed yet.')); return; }

  /* Suggestions for the position box. A datalist rather than a select, because
     a league that plays "Combo" or "Point Forward" must be able to write it. */
  if (!document.getElementById('posOptions')) {
    const dl = el('datalist'); dl.id = 'posOptions';
    ['Guard', 'Point Guard', 'Shooting Guard', 'Wing', 'Forward',
     'Small Forward', 'Power Forward', 'Centre', 'Guard/Forward', 'Forward/Centre']
      .forEach(v => { const o = el('option'); o.value = v; dl.appendChild(o); });
    document.body.appendChild(dl);
  }

  const wrap = el('div', 'ft-wrap');
  const t = el('table', 'ft');
  const thead = el('thead'), hr = el('tr');
  ['#', 'PLAYER', 'POS'].forEach((h, i) => hr.appendChild(el('th', i < 2 ? 'stick c' + i : '', h)));
  MEASURES.forEach(m => {
    const th = el('th', null, m.l);
    th.style.width = m.w + 'px';
    hr.appendChild(th);
  });
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.sort((a, b) => (+a.jersey || 99) - (+b.jersey || 99)).forEach(r => {
    const p = r.players || {};
    const tr = el('tr');
    tr.appendChild(el('td', 'stick c0', r.jersey || '–'));

    const nd = el('td', 'stick c1');
    const cell = el('div', 'ft-name');
    const name = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (p.slug) { const a = el('a', null, name); a.href = '../p/?p=' + encodeURIComponent(p.slug); cell.appendChild(a); }
    else cell.appendChild(el('span', null, name || 'Player'));
    nd.appendChild(cell); tr.appendChild(nd);
    /* POSITION, EDITABLE WHERE THE ROSTER IS READ.
       It has always been settable — several clicks into a per-player card in
       the team portal — and read-only here, which is the page a club secretary
       actually opens. Same inline treatment as the measurements beside it, and
       the same permission: the club's own manager, a league administrator over
       that club, or a platform administrator. */
    if (!canEdit) {
      tr.appendChild(el('td', null, r.position || ''));
    } else {
      const td = el('td', 'meas');
      const inp = el('input', 'meas-in pos-in');
      inp.value = r.position || '';
      inp.placeholder = '—';
      inp.maxLength = 24;
      /* the vocabulary a basketball roster actually uses, offered rather than
         enforced: a league that writes "Combo" or "Point Forward" must not be
         told it is wrong by a dropdown */
      inp.setAttribute('list', 'posOptions');
      let last = inp.value;
      const save = async () => {
        const raw = inp.value.trim();
        if (raw === last) return;
        inp.classList.remove('bad'); inp.title = '';
        inp.classList.add('saving');
        const { error } = await sb.from('roster_entries')
          .update({ position: raw || null })
          .eq('team_id', team.id).eq('player_id', p.id);
        inp.classList.remove('saving');
        if (error) {
          inp.classList.add('bad'); inp.title = error.message;
          inp.value = last; return;
        }
        last = inp.value;
        inp.classList.add('saved');
        setTimeout(() => inp.classList.remove('saved'), 1200);
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      td.appendChild(inp);
      tr.appendChild(td);
    }

    MEASURES.forEach(m => {
      const td = el('td', 'meas');
      const val = p[m.k];

      if (!canEdit) {
        /* read-only: show it, with the imperial equivalent where it helps */
        if (val == null || val === '') td.appendChild(el('span', 'meas-none', '–'));
        else if (m.imperial) {
          td.appendChild(el('span', null, val + m.unit));
          td.appendChild(el('span', 'meas-alt', feetInches(val)));
        } else {
          td.appendChild(el('span', null, m.text ? String(val) : val + m.unit));
        }
        tr.appendChild(td);
        return;
      }

      const inp = el('input', 'meas-in');
      inp.value = val == null ? '' : String(val);
      inp.placeholder = m.text ? '—' : m.unit;
      if (!m.text) { inp.type = 'number'; inp.min = String(m.min); inp.max = String(m.max); }
      else inp.maxLength = 80;

      let last = inp.value;
      const save = async () => {
        const raw = inp.value.trim();
        if (raw === last) return;
        let out = raw === '' ? null : (m.text ? raw : parseInt(raw, 10));
        if (!m.text && out != null && (!isFinite(out) || out < m.min || out > m.max)) {
          inp.classList.add('bad');
          inp.title = m.l + ' must be between ' + m.min + ' and ' + m.max + m.unit;
          return;
        }
        inp.classList.remove('bad'); inp.title = '';
        inp.classList.add('saving');
        const patch = {}; patch[m.k] = out;
        const { error } = await sb.from('players').update(patch).eq('id', p.id);
        inp.classList.remove('saving');
        if (error) {
          inp.classList.add('bad');
          inp.title = error.message;
          inp.value = last;                 // put back what was there
          return;
        }
        last = inp.value;
        inp.classList.add('saved');
        setTimeout(() => inp.classList.remove('saved'), 1200);
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      td.appendChild(inp);
      tr.appendChild(td);
    });

    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);

  if (canEdit) {
    host.appendChild(el('div', 'empty',
      'You manage this club, so the position and the measurements are editable — ' +
      'they save when you leave the box. Heights and wingspans are in centimetres, ' +
      'and the position appears on the broadcast lineup graphics.'));
  }
}


async function games(team) {
  const gs = await api(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
    `&select=id,tipoff_at,status,home_score,away_score,home_team_id,venue,` +
    `home:home_team_id(name,slug),away:away_team_id(name,slug)&order=tipoff_at.desc`);
  const host = $('#games'); host.textContent = '';
  if (!gs.length) { host.appendChild(el('div', 'empty', 'No games yet.')); return; }

  gs.forEach(g => {
    const home = g.home_team_id === team.id;
    const opp = home ? (g.away || {}) : (g.home || {});
    const us = home ? g.home_score : g.away_score;
    const them = home ? g.away_score : g.home_score;
    const final = g.status === 'final';

    const row = el('div', 'fx');
    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    row.appendChild(el('div', 'd', when ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'TBC'));
    row.appendChild(el('div', 'o', (home ? 'v ' : '@ ') + (opp.name || '—')));
    row.appendChild(el('div', 's', final ? `${us}–${them}` : (g.status === 'live' ? 'LIVE' : '')));
    const res = final ? (us > them ? 'W' : 'L') : (g.status === 'live' ? 'LIVE' : (g.venue || 'SCHEDULED'));
    row.appendChild(el('div', 'r ' + (final ? (us > them ? 'w' : 'ls') : ''), res));
    if (final || g.status === 'live') {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => location.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase');
    }
    host.appendChild(row);
  });
}
