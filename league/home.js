'use strict';
/* Courtside home — what's on now, and every league on the platform.
   Anonymous reads only; RLS decides what comes back. A scheduled fixture is
   readable but its detail is not, which is why this page shows fixtures
   without ever asking for a box score. */

const CFG = window.COURTSIDE_CONFIG;
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* This page is two pages. Without ?l= it is the platform hub: every game, every
   league. With ?l= it is that league's SPLASH — the same shape, narrowed to one
   league, with the league directory replaced by that league's own table and
   leaders. One file, because the two differ by a filter and a section, and
   maintaining a near-copy is how they drift. */
const WANT = new URLSearchParams(location.search).get('l') || '';
let LEAGUE = null;              // resolved when WANT is set

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}

function fail(host, msg) {
  const h = $(host); h.textContent = ''; h.appendChild(el('div', 'empty', msg));
}

/* ------------------------------------------------------------------ games --- */
async function games() {
  let gs;
  try {
    let scope = '';
    if (LEAGUE) {
      /* A game belongs to a competition, which belongs to a season, which
         belongs to a league — so the league's competitions are resolved first
         and the games filtered by them. Two round trips, and no dependence on
         PostgREST resolving a three-deep embedded filter. */
      const comps = await leagueCompetitions(LEAGUE.id);
      if (!comps.length) {
        const host = $('#games'); host.textContent = '';
        host.appendChild(el('div', 'empty', 'No fixtures in this league yet.'));
        return;
      }
      scope = '&competition_id=in.(' + comps.join(',') + ')';
    }
    gs = await api('games?select=id,tipoff_at,status,home_score,away_score,venue,' +
      'home:home_team_id(name,short_name,colour),away:away_team_id(name,short_name,colour)' +
      '&status=in.(live,final,scheduled)' + scope + '&order=tipoff_at.desc&limit=12');
  } catch (e) {
    return fail('#games', 'Could not reach the server. ' + e.message);
  }

  const host = $('#games'); host.textContent = '';
  if (!gs.length) {
    host.appendChild(el('div', 'empty',
      'No games yet. A fixture appears here as soon as a league schedules one.'));
    return;
  }

  // live first regardless of date — that is what someone is here for
  const rank = { live: 0, scheduled: 1, final: 2 };
  gs.sort((a, b) => (rank[a.status] - rank[b.status]) ||
                    (new Date(b.tipoff_at || 0) - new Date(a.tipoff_at || 0)));

  const liveCount = gs.filter(g => g.status === 'live').length;
  $('#gamesNote').textContent = liveCount
    ? liveCount + ' live now'
    : gs.length + ' recent';

  gs.forEach(g => {
    const final = g.status === 'final', live = g.status === 'live';
    const row = el(final || live ? 'a' : 'div', 'fx');
    if (final || live) {
      row.href = 'game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
    }

    const h = el('div', 'tn h', (g.home || {}).name || '—');
    const a = el('div', 'tn', (g.away || {}).name || '—');
    if (final) {
      if (g.home_score > g.away_score) h.style.color = 'var(--lume)';
      if (g.away_score > g.home_score) a.style.color = 'var(--lume)';
    }

    const when = g.tipoff_at ? new Date(g.tipoff_at) : null;
    const st = el('div', 'st ' + (live ? 'live' : final ? 'final' : 'sched'));
    if (live) { st.appendChild(el('span', 'pulse')); st.appendChild(document.createTextNode('LIVE')); }
    else if (final) st.textContent = 'FINAL';
    else st.textContent = when
      ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      : 'TBC';

    row.append(h, el('div', 'sc', final || live ? `${g.home_score}–${g.away_score}` : 'v'), a, st);
    host.appendChild(row);
  });
}

/* ---------------------------------------------------------------- leagues --- */
async function leagues() {
  let ls;
  try { ls = await api('leagues?select=id,slug,name,colour_a&order=name'); }
  catch (e) { return fail('#leagues', 'Could not reach the server. ' + e.message); }

  const host = $('#leagues'); host.textContent = '';
  if (!ls.length) {
    host.appendChild(el('div', 'empty', 'No leagues yet.'));
    return;
  }

  // one request for every league's season count rather than one per league
  let seasons = [];
  try {
    seasons = await api('seasons?select=league_id,name,starts_on&order=starts_on.desc');
  } catch (_) { /* the list still renders without it */ }
  const latest = new Map();
  seasons.forEach(s => { if (!latest.has(s.league_id)) latest.set(s.league_id, s.name); });

  ls.forEach(l => {
    const row = el('a', 'lg');
    row.href = 'l/?l=' + encodeURIComponent(l.slug);
    const cr = el('div', 'cr', (l.name || '?').slice(0, 2).toUpperCase());
    cr.style.background = l.colour_a || 'var(--lume)';
    const mid = el('div');
    mid.append(el('div', 'nm', l.name),
               el('div', 'sub', latest.get(l.id) || 'No season yet'));
    row.append(cr, mid, el('div', 'go', '›'));
    host.appendChild(row);
  });
}

/* which competitions belong to a league, newest season first */
async function leagueCompetitions(leagueId) {
  const seasons = await api('seasons?league_id=eq.' + leagueId +
    '&select=id&order=starts_on.desc');
  if (!seasons.length) return [];
  const comps = await api('competitions?season_id=in.(' +
    seasons.map(s => s.id).join(',') + ')&select=id');
  return comps.map(c => c.id);
}

/* ------------------------------------------------------------ the splash ---
   A league's own front page: its table and its leaders, side by side, each a
   real embed rather than a bespoke copy — the same widget other sites get, so
   the thing shipped to other people's pages is the thing seen most often on
   this one and cannot quietly rot.

   Both are CLICKABLE AS A WHOLE. An iframe swallows clicks, so the card gets a
   transparent link laid over it. That also makes the embed purely a picture
   here, which is what a summary should be: the reader either glances and moves
   on, or clicks through to the page where the thing is actually interactive. */
function splash() {
  const host = $('#leagues'); host.textContent = '';
  const slug = encodeURIComponent(LEAGUE.slug);
  const table = 'l/?l=' + slug;

  const grid = el('div', 'splitgrid');
  [['Table', 'embed/table/?l=' + slug + '&kind=standings&n=12', table],
   ['Leaders', 'embed/table/?l=' + slug + '&kind=leaders&stat=ppg&n=10', table + '#leaders']]
    .forEach(([title, src, href]) => {
      const card = el('div', 'embedcard');
      const h = el('div', 'embedhead');
      h.append(el('span', null, title), el('span', 'embedgo', 'open ›'));
      card.appendChild(h);

      const f = document.createElement('iframe');
      f.className = 'embedframe';
      f.src = src;
      f.loading = 'lazy';
      f.scrolling = 'no';
      f.title = LEAGUE.name + ' ' + title.toLowerCase();
      card.appendChild(f);

      /* the whole card is the link; the iframe is decoration under it */
      const a = el('a', 'embedhit');
      a.href = href;
      a.setAttribute('aria-label', 'Open the ' + LEAGUE.name + ' ' + title.toLowerCase());
      card.appendChild(a);

      grid.appendChild(card);
    });
  host.appendChild(grid);
}

/* ------------------------------------------------------------------- boot --- */
(async function boot() {
  $('#mode').textContent = 'transport: ' +
    (window.courtsideMode ? window.courtsideMode() : 'local');

  if (WANT) {
    try {
      const ls = await api('leagues?slug=eq.' + encodeURIComponent(WANT) +
        '&select=id,slug,name,colour_a,colour_b&limit=1');
      LEAGUE = ls[0] || null;
    } catch (_) { /* fall through to the hub */ }
  }

  if (LEAGUE) {
    window.__CS_LEAGUE_SLUG = LEAGUE.slug;      // the rail marks it as current
    document.title = LEAGUE.name + ' · Courtside';
    const wm = document.querySelector('.wordmark');
    if (wm) wm.textContent = LEAGUE.name;
    const tag = document.querySelector('.tagline');
    if (tag) {
      tag.textContent = 'Live box scores, standings and season statistics for ' +
        LEAGUE.name + '. Every number is rebuilt from the game’s own event log, ' +
        'so what you see here and what the statistician recorded cannot drift apart.';
    }
    if (LEAGUE.colour_a) {
      document.documentElement.style.setProperty('--team-a', LEAGUE.colour_a);
    }
    /* the strip narrows to this league too */
    const strip = document.querySelector('#strip');
    if (strip) strip.src = 'embed/strip/?n=24&l=' + encodeURIComponent(LEAGUE.slug);

    const head = document.querySelector('#leaguesHead');
    if (head) head.textContent = 'This season';

    await games();
    splash();
  } else {
    if (WANT) {
      /* asked for a league that is not there — say so rather than silently
         showing the hub, which looks like the link worked */
      fail('#leagues', 'No league called "' + WANT + '". Every league is listed below.');
    }
    await games();
    await leagues();
  }
})();

/* ---------------------------------------------------------------- strip --- */
/* The fixture strip is the same iframe other sites embed, so the widget
   shipped outward is the one seen most often here and cannot quietly rot.

   It posts its height out; apply it, checked against our own origin AND that
   specific frame, because a page can hold other frames and any of them can
   post. The number is range-checked too — a posted value is never trusted.

   This lives here rather than inline because the page's CSP is script-src
   'self', which blocks inline script. That is the policy working, not an
   obstacle to route around. */
window.addEventListener('message', ev => {
  if (ev.origin !== location.origin) return;
  const f = document.getElementById('strip');
  if (!f || ev.source !== f.contentWindow) return;
  const d = ev.data;
  if (!d || d.courtsideEmbed !== 'height') return;
  const h = Number(d.height);
  if (!isFinite(h) || h < 60 || h > 400) return;
  f.style.height = Math.ceil(h) + 'px';
});
