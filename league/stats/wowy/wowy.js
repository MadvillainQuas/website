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

let league = null, teams = [], loadToken = 0;

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
    `&status=eq.final&select=id,home_team_id,away_team_id,starters`);
  if (!gs.length) return { games: [] };

  const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
  const [st, evs] = await Promise.all([
    D.stints(gs.map(g => g.id), team.id, byGame),
    D.events(gs.map(g => g.id))
  ]);

  /* the on-court five is rebuilt by walking each game's log forward from its
     frozen starters, so every stat event knows the context it happened in */
  const recs = window.EpinoiaWith.index(gs.map(g => ({
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

  return { games: gs, stints: st, recs, roster, meta };
}

function paint(team, d) {
  document.documentElement.style.setProperty('--team-a', team.colour || '#93f2bf');
  $('#ctx').textContent = (league ? league.name + ' · ' : '') + team.name;
  document.title = team.name + ' WOWY · Epinoia';

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
  $('#comboNote').textContent = 'up to 5 players · 2⁵ arrangements';

  /* --- the subject picker ---------------------------------------------------
     The individual split needs one player as its subject and any number as his
     mates. Those are different roles, so they get different controls: a single
     rail here, a multi-select inside the panel. */
  let subject = d.roster[0];
  const bar = $('#subjbar');
  bar.textContent = '';
  const rail = el('div', 'lu-chips');
  rail.style.padding = '0';
  d.roster.forEach(id => {
    const m = d.meta[id] || {};
    const b = el('button', 'ep-chip' + (id === subject ? ' on' : ''), m.name || 'Player');
    b.type = 'button';
    if (m.jersey) b.title = '#' + m.jersey + ' ' + (m.position || '');
    b.addEventListener('click', () => {
      if (id === subject) return;
      subject = id;
      rail.querySelectorAll('.ep-chip').forEach(c => c.classList.remove('on'));
      b.classList.add('on');
      drawSubject();
    });
    rail.appendChild(b);
  });
  bar.appendChild(rail);

  function drawSubject() {
    /* teammates are whoever actually shared a stint with him — a roster listing
       would offer players he never played beside, which reads as a bug */
    const mates = new Set();
    d.stints.forEach(s => {
      const ids = s.player_ids || [];
      if (ids.indexOf(subject) === -1) return;
      ids.forEach(id => { if (id !== subject) mates.add(id); });
    });
    window.EpinoiaWithUI.render({
      host: '#withpanel', recs: d.recs, stints: d.stints,
      playerId: subject, meta: d.meta, teammates: [...mates]
    });
    window.EpinoiaWowy.onOffTiles('#onoff', d.stints, subject);
  }
  drawSubject();

  window.EpinoiaWowy.render({
    host: '#wowy', stints: d.stints, meta: d.meta,
    max: 5, preselect: d.roster.slice(0, 2)
  });
}

async function select(team) {
  const token = ++loadToken;
  $('#teamrail').querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.id === team.id));
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
    const ctx = await D.context(qp.get('l') || 'demo-league', qp.get('c'));
    league = ctx.league;
    window.__CS_LEAGUE_SLUG = league.slug;

    teams = await D.all(`teams?league_id=eq.${league.id}` +
      `&select=id,name,short_name,slug,colour&order=name`);
    if (!teams.length) {
      note('#withpanel', 'This league has no teams yet.');
      return;
    }

    const railHost = $('#teamrail');
    teams.forEach(t => {
      const b = el('button', 'ep-chip');
      b.type = 'button'; b.dataset.id = t.id;
      const sw = el('span', 'swatch');
      sw.style.background = t.colour || 'var(--lume)';
      b.append(sw, document.createTextNode(t.short_name || t.name));
      b.title = t.name;
      b.addEventListener('click', () => select(t));
      railHost.appendChild(b);
    });

    const wanted = qp.get('t');
    await select(teams.find(t => t.slug === wanted) || teams[0]);
  } catch (e) {
    console.warn('[wowy]', e);
    note('#withpanel', 'Could not load: ' + (e.message || e));
  }
})();
