'use strict';
/* Courtside home — what's on now, and every league on the platform.
   Anonymous reads only; RLS decides what comes back. A scheduled fixture is
   readable but its detail is not, which is why this page shows fixtures
   without ever asking for a box score. */

const CFG = window.COURTSIDE_CONFIG;
const D = window.CourtsideData;      // shared loader + aggregation
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
    gs = await api('games?select=id,tipoff_at,status,home_score,away_score,venue,venue_address,' +
      'home:home_team_id(name,short_name,colour),away:away_team_id(name,short_name,colour)' +
      '&status=in.(live,final,scheduled)' + scope + '&order=tipoff_at.desc&limit=120');
  } catch (e) {
    return fail('#games', 'Could not reach the server. ' + e.message);
  }

  const host = $('#games'); host.textContent = '';
  if (!gs.length) {
    host.appendChild(el('div', 'empty',
      'No games yet. A fixture appears here as soon as a league schedules one.'));
    return;
  }

  /* The splash answers "what just happened and what is next", not "show me
     the season" — that is what the fixtures page is for. So: anything live,
     results from the past week, and the next fixtures up, capped at fifteen.

     The week is measured from NOW rather than from the last game played,
     because this list is explicitly about recency; a league that has not
     played for a month should show an empty result set and a run of upcoming
     fixtures, which is the truth. */
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const at = g => new Date(g.tipoff_at || 0).getTime();

  const live = gs.filter(g => g.status === 'live');
  /* Both ends matter. Without the upper bound a finalised game dated in the
     future counts as "this week" — which is not hypothetical: the demo season
     carries finals dated months ahead, and they filled the recent list. */
  const recent = gs.filter(g => g.status === 'final' && at(g) >= weekAgo && at(g) <= now)
                   .sort((a, b) => at(b) - at(a));
  const upcoming = gs.filter(g => g.status === 'scheduled' && at(g) >= now)
                     .sort((a, b) => at(a) - at(b));

  /* Anything finalised but dated ahead is neither "this week" nor "upcoming".
     Rather than drop it silently it rides after the rest, so a mis-dated
     fixture is visible on the page it belongs to instead of only in the
     database. */
  const odd = gs.filter(g => g.status === 'final' && at(g) > now)
                .sort((a, b) => at(a) - at(b));

  const CAP = 15;
  const shown = live.concat(recent, upcoming, odd).slice(0, CAP);
  const total = gs.length;

  if (!shown.length) {
    host.appendChild(el('div', 'empty',
      'Nothing in the last week and nothing scheduled. The full fixture list is ' +
      'still there — see all fixtures.'));
    showAllLink(total);
    return;
  }

  $('#gamesNote').textContent = live.length
    ? live.length + ' live now'
    : recent.length + ' this week · ' + upcoming.length + ' upcoming' +
      (odd.length ? ' · ' + odd.length + ' dated ahead' : '');
  showAllLink(total);
  gs = shown;

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

    /* Where and when, on a line of its own. A fixture list without a venue is
       a list you have to ask somebody about. */
    const bits = [];
    if (when) {
      bits.push(when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
                ' · ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }
    if (g.venue) bits.push(g.venue);
    if (bits.length) row.appendChild(el('div', 'fxwhere', bits.join('  ·  ')));

    host.appendChild(row);
  });
}

/* the way through to the whole list, next to the heading rather than at the
   bottom — somebody who wants everything decides that before reading fifteen */
function showAllLink(total) {
  const head = $('#gamesHead');
  if (!head) return;
  head.textContent = '';
  const a = el('a', 'showall', 'show all' + (total ? ' (' + total + ')' : '') + ' →');
  a.href = 'fixtures/' + (LEAGUE ? '?l=' + encodeURIComponent(LEAGUE.slug) : '');
  head.appendChild(a);
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

/* ------------------------------------------------------------- the clubs ---
   Every club in the league, each card a print rather than a tile.

   A logo goes in the middle where one exists. None do yet, so the MONOGRAM has
   to be the artwork and not an apology for a missing image — which is why it
   is set in the scoreboard face at plate size, printed twice with the second
   pass out of register, over a halftone in the club's own ink.

   The initials come from the club's short name where it has one, because that
   is what the club calls itself, and are derived only as a fallback. */
function monogram(t) {
  const s = (t.short_name || '').trim();
  if (s) return s.slice(0, 3).toUpperCase();
  const words = (t.name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (t.name || '?').slice(0, 2).toUpperCase();
}

async function clubs() {
  const sec = $('#clubsSec');
  if (!sec || !LEAGUE) return;

  let ts = [];
  try {
    ts = await api('teams?league_id=eq.' + LEAGUE.id +
      '&select=id,name,short_name,slug,colour&order=name');
  } catch (e) {
    return;                       // a league page without clubs is still a page
  }
  if (!ts.length) return;

  /* an approved logo, if the club has one. Nothing unapproved is ever shown —
     that decision belongs to the moderation queue, not to this page. */
  const logos = new Map();
  try {
    const rows = await api('media?owner_type=eq.team&kind=eq.logo&status=eq.approved' +
      '&owner_id=in.(' + ts.map(t => t.id).join(',') + ')&select=owner_id,storage_path');
    rows.forEach(r => {
      if (!logos.has(r.owner_id)) {
        logos.set(r.owner_id, CFG.supabaseUrl + '/storage/v1/object/public/' + r.storage_path);
      }
    });
  } catch (_) { /* monograms all round */ }

  sec.classList.remove('hide');
  $('#clubsNote').textContent = ts.length + (ts.length === 1 ? ' club' : ' clubs');

  const grid = el('div', 'clubgrid');
  ts.forEach((t, i) => {
    const a = el('a', 'club');
    a.href = 't/?t=' + encodeURIComponent(t.slug || '');
    a.style.setProperty('--ink-c', t.colour || '#93f2bf');
    a.setAttribute('aria-label', t.name);

    const plate = el('div', 'club-plate');
    plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
    ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

    const mark = el('div', 'club-mark');
    const url = logos.get(t.id);
    if (url) {
      const img = document.createElement('img');
      img.className = 'club-logo';
      img.src = url; img.alt = '';
      img.loading = 'lazy';
      /* a logo that fails to load must fall back to the monogram rather than
         leaving a hole where the club's identity should be */
      img.addEventListener('error', () => {
        img.remove();
        mark.append(el('span', 'club-mono ghost', monogram(t)),
                    el('span', 'club-mono', monogram(t)));
      });
      mark.appendChild(img);
    } else {
      mark.append(el('span', 'club-mono ghost', monogram(t)),
                  el('span', 'club-mono', monogram(t)));
    }
    plate.appendChild(mark);

    const band = el('div', 'club-band');
    band.appendChild(el('span', null, LEAGUE.name));
    plate.appendChild(band);
    plate.appendChild(el('div', 'club-grain'));

    const foot = el('div', 'club-foot');
    foot.append(el('span', 'club-name', t.name),
                el('span', 'club-ed', 'no ' + String(i + 1).padStart(2, '0') +
                                      '/' + String(ts.length).padStart(2, '0')));

    a.append(plate, foot);
    grid.appendChild(a);
  });
  sec.querySelector('#clubs').textContent = '';
  sec.querySelector('#clubs').appendChild(grid);
}

/* -------------------------------------------------------------- the stars ---
   Who has actually been playing well lately, by BPM over a window.

   BPM rather than points because points reward volume and a star section that
   is really a shot-attempt leaderboard is worse than no star section. BPM asks
   what a player added per 100 possessions and is adjusted to how their team
   actually performed, which is as close as a box score gets to the question.

   THE WINDOW IS ANCHORED TO THE LAST GAME PLAYED, not to today. A league that
   last played in April should show April's stars in May, rather than an empty
   panel that looks broken — and the heading says which dates it covers so the
   reader is never guessing how fresh it is.

   A MINIMUM IS ENFORCED and stated. BPM over one quiet half is noise, and a
   podium built from noise is worse than an empty one, so a week needs a game
   and twenty minutes, a month two games and sixty. */
const STAR_WINDOWS = [
  { key: 'month', label: 'Monthly stars', days: 30, minGames: 2, minMinutes: 60 },
  { key: 'week',  label: 'Weekly stars',  days: 7,  minGames: 1, minMinutes: 20 }
];

const dayMs = 86400000;
const shortDate = iso => { try { return new Date(iso).toLocaleDateString('en-GB',
  { day: 'numeric', month: 'short' }); } catch (_) { return ''; } };

async function stars() {
  const sec = $('#starsSec');
  if (!sec || !LEAGUE) return;

  const comps = await leagueCompetitions(LEAGUE.id);
  if (!comps.length) return;

  let played = [];
  try {
    played = await api('games?competition_id=in.(' + comps.join(',') + ')' +
      '&status=eq.final&select=id,tipoff_at,home_team_id,away_team_id&order=tipoff_at.desc');
  } catch (_) { return; }
  if (!played.length) return;

  const latest = new Date(played[0].tipoff_at || Date.now()).getTime();

  /* names and clubs, resolved once for every window */
  const teamsById = new Map();
  try {
    (await api('teams?league_id=eq.' + LEAGUE.id + '&select=id,name,short_name,slug,colour'))
      .forEach(t => teamsById.set(t.id, t));
  } catch (_) { /* the podium still works with a colourless card */ }

  const rows = [];
  for (const w of STAR_WINDOWS) {
    const from = latest - w.days * dayMs;
    const inWindow = played.filter(g => {
      const t = new Date(g.tipoff_at || 0).getTime();
      return t >= from && t <= latest;
    });
    if (!inWindow.length) continue;

    let agg;
    try { agg = await D.statsForGames(inWindow); } catch (_) { continue; }

    const eligible = (agg.players || [])
      .filter(p => p.bpm != null && (p.gp || 0) >= w.minGames && (p.min || 0) >= w.minMinutes)
      .sort((a, b) => b.bpm - a.bpm)
      .slice(0, 3);
    if (!eligible.length) continue;

    const ids = eligible.map(p => p.id);
    let meta = {};
    try { meta = await D.playerMeta(ids); } catch (_) { meta = {}; }

    rows.push({
      w, top: eligible, meta, teamOf: agg.teamOfPlayer, teamsById,
      games: inWindow.length,
      span: shortDate(inWindow[inWindow.length - 1].tipoff_at) + ' – ' + shortDate(inWindow[0].tipoff_at)
    });
  }

  if (!rows.length) return;
  sec.classList.remove('hide');
  const host = sec.querySelector('#stars');
  host.textContent = '';

  rows.forEach(r => {
    const head = el('div', 'starrow-h');
    head.append(el('span', 'starrow-t', r.w.label.toUpperCase()),
                el('span', 'starrow-s', r.span + ' · ' + r.games +
                   (r.games === 1 ? ' game' : ' games') +
                   ' · min ' + r.w.minGames + 'g/' + r.w.minMinutes + 'min'));
    host.appendChild(head);

    const grid = el('div', 'stargrid');
    r.top.forEach((p, i) => {
      const m = r.meta[p.id] || {};
      const team = r.teamsById.get(r.teamOf && r.teamOf.get(p.id)) || {};
      const ink = team.colour || m.colour || '#93f2bf';

      const a = el('a', 'club star');
      a.href = 'p/?p=' + encodeURIComponent(m.slug || '');
      a.style.setProperty('--ink-c', ink);
      a.setAttribute('aria-label', (m.name || 'Player') + ', ' + (team.name || ''));

      const plate = el('div', 'club-plate');
      plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
      ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

      /* the rank is the mark, printed like the club monogram */
      const mark = el('div', 'club-mark');
      const rank = String(i + 1);
      mark.append(el('span', 'club-mono ghost', rank), el('span', 'club-mono', rank));
      plate.appendChild(mark);

      /* BPM across the band, because it is why this player is on the podium */
      const band = el('div', 'club-band');
      band.appendChild(el('span', null,
        (p.bpm > 0 ? '+' : '') + Number(p.bpm).toFixed(1) + ' BPM'));
      plate.appendChild(band);
      plate.appendChild(el('div', 'club-grain'));

      const foot = el('div', 'club-foot star-foot');
      const who = el('div', 'star-who');
      who.append(el('span', 'star-name', m.name || 'Player'),
                 el('span', 'star-team', team.name || m.teamFull || ''));
      foot.appendChild(who);
      foot.appendChild(el('span', 'club-ed',
        (p.ppg != null ? p.ppg + 'p' : '') +
        (p.rpg != null ? ' ' + p.rpg + 'r' : '') +
        (p.apg != null ? ' ' + p.apg + 'a' : '')));

      a.append(plate, foot);
      grid.appendChild(a);
    });
    host.appendChild(grid);
  });
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

/* The section numbers are a reading aid, so they must count what is actually
   on the page. The hub hides Clubs and Stars — both need a league — and a hub
   whose first heading is "02" looks like something failed to load. */
function renumber() {
  let n = 0;
  document.querySelectorAll('.sec').forEach(sec => {
    if (sec.classList.contains('hide') || sec.offsetParent === null && sec.classList.contains('hide')) return;
    const idx = sec.querySelector('.idx');
    if (!idx) return;
    idx.textContent = String(n).padStart(2, '0');
    n++;
  });
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
        LEAGUE.name + '.';
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
    await clubs();
    await stars();
    renumber();
  } else {
    if (WANT) {
      /* asked for a league that is not there — say so rather than silently
         showing the hub, which looks like the link worked */
      fail('#leagues', 'No league called "' + WANT + '". Every league is listed below.');
    }
    await games();
    await leagues();
    renumber();
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
