'use strict';
/* ============================================================================
   THE WOWY SUBPAGE — the full-width version, with a team picker.

   The team profile carries WOWY as one section among a dozen, so it is capped
   and compressed to stay in proportion. Here it is the whole page, which buys
   two things worth having: five players in the matrix instead of four, and a
   team picker, so the natural next question — "and how does the OTHER team's
   rotation work" — is one click rather than a fresh navigation.

   Three panels, narrowest question first:

     ON THE FLOOR WITH   one player's OWN box, split by who was beside him.
                         Derived by replaying the event log, because no table
                         stores an individual box broken down by teammate.
     ON / OFF            the team with that player on, against without him.
     COMBINATIONS        every ON/OFF arrangement of up to five players.

   The first is the one index_9's profile answers and the one people actually
   want: a team net rating tells you a pairing worked, but not whether the
   player shot more, passed more, or simply stood in a better place.
   ============================================================================ */

const D = window.EpinoiaData;
const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

let league = null, teams = [], loadToken = 0, current = null, seasonComps = null;

/* ---------------------------------------------------------------- memberships ---
   docs/memberships.md. This screen is the full WOWY, which is the members'; a
   non-member gets a PREVIEW rather than a closed door, because the parts that are
   already free elsewhere (the team rail, the subject chips and the on/off tiles,
   which both profiles show) are the best argument for the rest:

     01 On the floor with   a teaser in place of the individual split
     02 On / off            unchanged
     03 Combinations        capped at CATALOGUE.wowyPreviewMax players (wowy.js)

   Analytics fail open: `preview` is true only once access.js has loaded and said
   no. A members-only league the viewer may not see (a KNOWN answer) gets the
   paywall card instead of the page. Without access.js nothing here changes. */
let preview = false, walled = false;

function accessState() {
  const A = window.EpinoiaAccess;
  if (!A || !league || typeof A.get !== 'function') return { A: null, st: {} };
  return { A, st: A.get(league.id) || {} };
}

function showWall() {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.paywallHTML !== 'function') return false;
  walled = true;
  $('#wowyBody').classList.add('hide');
  const w = $('#accessWall');
  w.innerHTML = A.paywallHTML({ league });
  w.classList.remove('hide');
  return true;
}

function withTeaser() {
  const A = window.EpinoiaAccess;
  $('#withpanel').innerHTML = A.teaserHTML({
    leagueSlug: league && league.slug,
    title: 'On the floor with is for members',
    lines: [
      'One player’s own box score split by who shared the floor with him: his shooting, his creation and his mistakes, with any teammates you choose against without them.',
      'The full combinations table: every on/off arrangement of up to five players, with ratings and the four factors at both ends.'
    ]
  });
}

/* A sign-in or sign-out while the page is open. Only a KNOWN change of answer is
   acted on, so the state briefly reloading behind a sign-in costs nothing. */
function onAccessChange() {
  const { A, st } = accessState();
  if (!A || !st.known) return;
  const nowWalled = typeof A.canView === 'function' && !A.canView(league.id);
  if (nowWalled !== walled) { location.reload(); return; }
  const nowPreview = typeof A.analyticsOk === 'function' && !A.analyticsOk(league.id);
  if (nowPreview !== preview) {
    preview = nowPreview;
    if (current) select(current);           // a member now: panel 01 needs the event log it skipped
  }
}

/* a labelled dropdown, edged in a colour (the fixtures page's control) */
function pickSelect(label, opts, value, onChange, colour) {
  const f = el('label', 'fsel');
  if (colour) f.style.setProperty('--sc', colour);
  const s = el('select');
  opts.forEach(([v, t]) => { const op = el('option', null, t); op.value = v; if (v === value) op.selected = true; s.appendChild(op); });
  s.addEventListener('change', () => onChange(s.value, f));
  f.append(el('span', 'fl', label), el('span', 'fbox'));
  f.lastChild.appendChild(s);
  return f;
}

/* ON / OFF, as two cards and the swing between them: the team's net rating with the player on the
   floor and off it, the ratings and minutes under each, and the difference in the middle */
function onOffPanel(host, stints, playerId, name) {
  const L = window.EpinoiaLineups;
  const h = $(host);
  h.textContent = '';
  if (!L || !stints || !stints.length || !playerId) return;
  const oo = L.onOff(stints, playerId);
  const f1 = v => (v == null || !isFinite(v) ? '—' : (+v).toFixed(1));
  const sg = v => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(1));
  const cls = v => (v == null || !isFinite(v) ? '' : v > 0 ? ' pos' : v < 0 ? ' neg' : '');
  const card = (k, side, sub) => {
    const c = el('div', 'oo-card ' + k);
    c.append(el('div', 'oo-k', k === 'on' ? name + ' on the floor' : name + ' off the floor'),
             el('div', 'oo-v' + cls(side.net), sg(side.net)),
             el('div', 'oo-s', sub));
    const row = el('div', 'oo-row');
    [['off. rating', f1(side.ortg)], ['def. rating', f1(side.drtg)], ['minutes', f1(side.mins)]].forEach(([l, v]) => {
      const d = el('div'); d.append(el('b', null, v), el('i', null, l)); row.appendChild(d);
    });
    c.appendChild(row);
    return c;
  };
  const wrap = el('div', 'oo');
  const sw = el('div', 'oo-swing');
  sw.append(el('div', 'k', 'swing'), el('div', 'n', sg(oo.diff.net)), el('div', 'k', 'on minus off'));
  wrap.append(card('on', oo.on, 'team net rating per 100 possessions'), sw,
              card('off', oo.off, 'team net rating per 100 possessions'));
  h.appendChild(wrap);
}

function note(host, msg) {
  const h = $(host);
  h.textContent = '';
  h.appendChild(el('div', 'empty', msg));
}

/* Everything the three panels need for one team, fetched once.
   Kept out of the render path so switching teams is a single await and the
   panels cannot half-update. */
async function fetchTeam(team) {
  const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
    (seasonComps && seasonComps.length ? `&competition_id=in.(${seasonComps.join(',')})` : '') +
    `&status=eq.final&select=id,home_team_id,away_team_id,starters`);
  if (!gs.length) return { games: [] };

  const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
  /* THE EVENT LOG FEEDS PANEL 01 ONLY — EpinoiaWith.index below, read by
     EpinoiaWithUI. The on/off tiles, the matrix and the roster all come from the
     stints. A preview teases panel 01, so it skips the heaviest read on the page
     (a season of events for every game this team played). */
  const wantEvents = !preview;
  const [st, evs] = await Promise.all([
    D.stints(gs.map(g => g.id), team.id, byGame),
    wantEvents ? D.events(gs.map(g => g.id)) : Promise.resolve([])
  ]);

  /* the on-court five is rebuilt by walking each game's log forward from its
     frozen starters, so every stat event knows the context it happened in */
  const recs = !wantEvents ? [] : window.EpinoiaWith.index(gs.map(g => ({
    starters: g.starters,
    events: evs.filter(e => e.gameId === g.id)
  })));

  /* the roster is whoever actually took the floor, most-used first — the order
     someone scans for a name, and it puts the rotation at the top for free */
  const mins = new Map();
  st.forEach(s => (s.player_ids || []).forEach(id =>
    mins.set(id, (mins.get(id) || 0) + ((s.stats && s.stats.dur) || 0))));
  const roster = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const meta = await D.playerMeta(roster);

  return { games: gs, stints: st, recs, roster, meta, preview: !wantEvents };
}

function paint(team, d) {
  document.documentElement.style.setProperty('--team-a', team.colour || '#93f2bf');
  $('#ctx').textContent = (league ? league.name + ' · ' : '') + team.name;
  document.title = team.name + ' · WOWY / Lineups · Epinoia';

  if (!d.games.length || !d.stints.length) {
    $('#subjbar').textContent = '';
    $('#subjNote').textContent = '';
    $('#comboNote').textContent = '';
    const msg = !d.games.length
      ? 'No finalised games for this team yet — WOWY fills in once one is played.'
      : 'No lineup data for this team yet.';
    note('#withpanel', msg); note('#onoff', msg); note('#wowy', msg);
    return;
  }

  $('#subjNote').textContent = d.games.length + ' games · ' + d.stints.length +
    ' stints · ' + d.roster.length + ' players';
  /* d.preview, not the module flag: it is what THIS data was fetched for, so a
     set without the event log is never drawn as the full page */
  const A = window.EpinoiaAccess;
  const cap = d.preview ? ((A && A.CATALOGUE && A.CATALOGUE.wowyPreviewMax) || 1) : 5;
  $('#comboNote').textContent = d.preview
    ? 'preview · ' + cap + (cap === 1 ? ' player' : ' players') + ' · members get up to 5'
    : 'up to 5 players · 2⁵ arrangements';
  if (d.preview) withTeaser();

  /* --- the subject picker ---------------------------------------------------
     The individual split needs one player as its subject and any number as his
     mates. Those are different roles, so they get different controls: a single
     rail here, a multi-select inside the panel. */
  let subject = d.roster[0];
  const bar = $('#subjbar');
  bar.textContent = '';
  const nameOf = id => ((d.meta[id] || {}).name || 'Player');
  bar.appendChild(pickSelect('Player', d.roster.map(id => {
    const m = d.meta[id] || {};
    return [id, (m.jersey ? '#' + m.jersey + ' ' : '') + (m.name || 'Player')];
  }), subject, v => { if (v && v !== subject) { subject = v; drawSubject(); } }, team.colour));

  function drawSubject() {
    /* teammates are whoever actually shared a stint with him — a roster listing
       would offer players he never played beside, which reads as a bug */
    const mates = new Set();
    d.stints.forEach(s => {
      const ids = s.player_ids || [];
      if (ids.indexOf(subject) === -1) return;
      ids.forEach(id => { if (id !== subject) mates.add(id); });
    });
    /* in a preview panel 01 keeps its teaser; the subject still drives panel 02 */
    if (!d.preview) {
      window.EpinoiaWithUI.render({
        host: '#withpanel', recs: d.recs, stints: d.stints,
        playerId: subject, meta: d.meta, teammates: [...mates]
      });
    }
    onOffPanel('#onoff', d.stints, subject, nameOf(subject));

  }
  drawSubject();

  window.EpinoiaWowy.render({
    host: '#wowy', stints: d.stints, meta: d.meta,
    max: 5, preselect: d.roster.slice(0, 2),
    preview: d.preview, leagueSlug: league && league.slug
  });
}

async function select(team) {
  const token = ++loadToken;
  current = team;
  const ts = $('#teamrail select');
  if (ts) { ts.value = team.id; ts.closest('.fsel').style.setProperty('--sc', team.colour || 'var(--ink)'); }
  /* the URL carries the team, so a chosen view is linkable and survives a
     reload — the page is meant to be sent to someone */
  const u = new URL(location.href);
  u.searchParams.set('t', team.slug);
  history.replaceState(null, '', u);

  $('#subjNote').textContent = 'Loading…';
  note('#withpanel', 'Loading…'); $('#onoff').textContent = ''; $('#wowy').textContent = '';

  try {
    const d = await fetchTeam(team);
    if (token !== loadToken) return;   // a later click already won
    paint(team, d);
  } catch (e) {
    if (token !== loadToken) return;
    console.warn('[wowy]', e);
    $('#subjNote').textContent = '';
    const msg = 'Could not load: ' + (e.message || e);
    note('#withpanel', msg); note('#onoff', msg); note('#wowy', msg);
  }
}

(async function boot() {
  try {
    /* WHICH SEASON (seasonbar.js): the games every panel reads are the chosen season's. With one
       season on offer nothing is filtered, as before. The chips are links, so a pick reloads. */
    const SB = window.EpinoiaSeasonBar;
    const ctx = SB ? await SB.context(D.get, qp.get('l') || 'demo-league', qp.get('s'))
                   : await D.context(qp.get('l') || 'demo-league', qp.get('c'));
    league = ctx.league;
    if (SB && ctx.seasons.length > 1 && ctx.season) {
      seasonComps = (ctx.season.comps || []).map(c => c.id);
      SB.mount({ host: $('#seasonPick'), wrap: $('#seasonRow'), seasons: ctx.seasons, season: ctx.season });
    }
    window.__CS_LEAGUE_SLUG = league.slug;

    /* Awaited, unlike the analytics on a box score: whether panel 01 fetches a
       season of events at all depends on the answer, and access.js gives up after
       four seconds and fails open, so the wait is bounded. */
    const A = window.EpinoiaAccess;
    if (A && typeof A.load === 'function') {
      try { await A.load({ leagueId: league.id, leagueSlug: league.slug }); } catch (_) { /* fail open */ }
      const { st } = accessState();
      if (st.known && typeof A.canView === 'function' && !A.canView(league.id) && showWall()) {
        if (typeof A.onChange === 'function') A.onChange(onAccessChange);
        return;
      }
      preview = typeof A.analyticsOk === 'function' && !A.analyticsOk(league.id);
      if (typeof A.onChange === 'function') A.onChange(onAccessChange);
    }

    teams = await D.all(`teams?league_id=eq.${league.id}` +
      `&select=id,name,short_name,slug,colour&order=name`);
    if (!teams.length) {
      note('#withpanel', 'This league has no teams yet.');
      return;
    }

    const wanted = qp.get('t');
    const first = teams.find(t => t.slug === wanted) || teams[0];
    const railHost = $('#teamrail');
    railHost.appendChild(pickSelect('Team', teams.map(t => [t.id, t.name]), first.id, v => {
      const t = teams.find(x => x.id === v);
      if (t) select(t);
    }, first.colour));
    await select(first);
  } catch (e) {
    console.warn('[wowy]', e);
    note('#withpanel', 'Could not load: ' + (e.message || e));
  }
})();
