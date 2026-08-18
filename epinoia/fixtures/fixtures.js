'use strict';
/* ============================================================================
   FIXTURES — the whole season, one row at a time.

   The splash shows the last week and the next few; this is the list you come
   to when you want the season. So the row is allowed to be tall: a badge and a
   name each side, a scoreboard between them, and underneath, the things you
   would otherwise have to open the box score for — who led it, and where it
   was played.

   THE LEADERS ARE THE POINT of the extra height. A fixture list of scores
   tells you what happened; "Ashworth 24, Nakamura 12 boards" tells you
   something about the game. They are fetched for the games ON SCREEN rather
   than for the season, because a season of player_game_stats is a lot of rows
   to download so somebody can skim a list.

   A scheduled game shows its tip-off time in the same place the score would
   be, so the column means "the number you care about" either way.
   ============================================================================ */

const D = window.EpinoiaData;
const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

let LEAGUE = null, TEAMS = new Map(), GAMES = [], LOGOS = new Map();
let teamFilter = qp.get('t') || '';        // team slug, or empty for all
let stateFilter = qp.get('show') || 'all'; // all | results | upcoming

const STATES = [
  ['all', 'Everything'],
  ['results', 'Results'],
  ['upcoming', 'Upcoming']
];

const at = g => new Date(g.tipoff_at || 0).getTime();
const dayKey = g => (g.tipoff_at || '').slice(0, 10);

const fmtDay = iso => {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) { return iso; }
};
const fmtTime = iso => {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
};

/* the initials a club is known by, same rule the screenprint cards use */
function monogram(t) {
  const s = (t.short_name || '').trim();
  if (s) return s.slice(0, 3).toUpperCase();
  const w = (t.name || '').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return (t.name || '?').slice(0, 2).toUpperCase();
}

function badge(team) {
  const b = el('div', 'badge');
  b.style.setProperty('--ink-c', (team && team.colour) || '#93f2bf');
  b.append(el('div', 'bflood'), el('div', 'btone'));
  const url = team && LOGOS.get(team.id);
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = ''; img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.remove(); b.appendChild(el('span', 'bmono', monogram(team || {})));
    });
    b.appendChild(img);
  } else {
    b.appendChild(el('span', 'bmono', monogram(team || {})));
  }
  return b;
}

/* --------------------------------------------------------------- filters --- */
function syncUrl() {
  const u = new URL(location.href);
  if (LEAGUE) u.searchParams.set('l', LEAGUE.slug);
  if (teamFilter) u.searchParams.set('t', teamFilter); else u.searchParams.delete('t');
  if (stateFilter !== 'all') u.searchParams.set('show', stateFilter); else u.searchParams.delete('show');
  history.replaceState(null, '', u);
}

function renderFilters() {
  const tp = $('#teamPick'); tp.textContent = '';
  const mk = (label, on, click, colour) => {
    const b = el('button', 'ep-chip teamchip' + (on ? ' on' : ''));
    b.type = 'button';
    if (colour) {
      const sw = el('span', 'sw'); sw.style.background = colour; b.appendChild(sw);
    }
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', click);
    return b;
  };
  tp.appendChild(mk('All clubs', !teamFilter, () => { teamFilter = ''; syncUrl(); renderFilters(); render(); }));
  [...TEAMS.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(t => {
    tp.appendChild(mk(t.name, teamFilter === t.slug, () => {
      teamFilter = t.slug; syncUrl(); renderFilters(); render();
    }, t.colour));
  });

  const sp = $('#statePick'); sp.textContent = '';
  STATES.forEach(([k, label]) => {
    const b = el('button', 'ep-chip' + (stateFilter === k ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { stateFilter = k; syncUrl(); renderFilters(); render(); });
    sp.appendChild(b);
  });
}

/* ----------------------------------------------------------------- rows --- */
function scoreboard(g) {
  const board = el('div', 'board');
  const final = g.status === 'final', live = g.status === 'live';

  if (final || live) {
    const sc = el('div', 'bscore');
    const h = el('span', final ? (g.home_score > g.away_score ? 'win' : 'lose') : '',
                 String(g.home_score ?? 0));
    const a = el('span', final ? (g.away_score > g.home_score ? 'win' : 'lose') : '',
                 String(g.away_score ?? 0));
    sc.append(h, el('span', 'bdash', '–'), a);
    board.appendChild(sc);

    const st = el('div', 'bstate ' + (live ? 'live' : 'final'));
    if (live) { st.appendChild(el('span', 'pulse')); st.appendChild(document.createTextNode('LIVE')); }
    else st.textContent = 'Final';
    board.appendChild(st);
  } else {
    board.appendChild(el('div', 'btime', g.tipoff_at ? fmtTime(g.tipoff_at) : 'TBC'));
    board.appendChild(el('div', 'bstate', 'Tip-off'));
  }
  return board;
}

/* who led the game. Only points, rebounds and assists — a fixture list is
   skimmed, and five categories is a table, not a glance. */
const LEADER_KEYS = [
  ['pts', 'Points', s => s.pts],
  ['reb', 'Rebounds', s => (s.or || 0) + (s.dr || 0)],
  ['ast', 'Assists', s => s.ast]
];

function leaders(perGame, names) {
  const wrap = el('div', 'leaders');
  if (!perGame || !perGame.length) return wrap;

  LEADER_KEYS.forEach(([key, label, get]) => {
    let best = null;
    perGame.forEach(r => {
      const v = get(r.stats || {}) || 0;
      if (v <= 0) return;
      if (!best || v > best.v) best = { v, id: r.player_uuid || r.player_id };
    });
    if (!best) return;
    const d = el('div', 'ldr');
    d.append(el('div', 'lk', label),
             el('div', 'ln', (names.get(best.id) || 'Player')),
             el('div', 'lv', String(best.v)));
    wrap.appendChild(d);
  });
  return wrap;
}

function venueBlock(g) {
  const v = el('div', 'venue');
  if (g.venue) v.appendChild(el('span', 'vn', g.venue));
  if (g.venue_address) v.appendChild(document.createTextNode(g.venue_address));
  if (g.tipoff_at) {
    v.appendChild(el('span', 'vt',
      new Date(g.tipoff_at).toLocaleDateString('en-GB',
        { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fmtTime(g.tipoff_at)));
  }
  if (!v.childNodes.length) v.appendChild(el('span', 'vn', 'Venue to be confirmed'));
  return v;
}

function fixtureRow(g, stats, names) {
  const final = g.status === 'final', live = g.status === 'live';
  /* EVERY FIXTURE IS A LINK, including one that has not been played.

     A scheduled game used to be an inert div, which made the most useful thing
     about a fixture list — tap the game you care about — work for two thirds of
     the rows and silently not for the rest. The game page already renders a
     scheduled fixture properly: the two clubs, the tip-off, the venue, and an
     empty box score waiting for it. That is a page worth reaching, and it is
     also where somebody who is going to score the game now starts from. */
  const row = el('a', 'fixture');
  row.href = '../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';

  const home = TEAMS.get(g.home_team_id) || {};
  const away = TEAMS.get(g.away_team_id) || {};

  const top = el('div', 'fxtop');

  const hs = el('div', 'side home');
  const hn = el('div');
  hn.append(el('div', 'sname', home.name || '—'), el('div', 'srec', 'Home'));
  hs.append(badge(home), hn);

  const as = el('div', 'side away');
  const an = el('div');
  an.append(el('div', 'sname', away.name || '—'), el('div', 'srec', 'Away'));
  as.append(badge(away), an);

  top.append(hs, scoreboard(g), as);
  row.appendChild(top);

  const foot = el('div', 'fxfoot');
  if (final) foot.appendChild(leaders(stats, names));
  foot.appendChild(venueBlock(g));
  /* A played game's footer carries its leaders; an unplayed one carried only
     the venue and gave no sign that the row led anywhere worth going. It now
     does — the preview behind it has the map, the tip-off and a written read
     on the two clubs — so the row says so. */
  if (!final && !live) {
    const flag = el('div', 'fxpreview');
    flag.append(el('span', 'fxpvdot'), document.createTextNode('preview & info'));
    foot.appendChild(flag);
  }
  row.appendChild(foot);
  return row;
}

/* ---------------------------------------------------------------- render --- */
async function render() {
  const host = $('#list');
  host.textContent = '';

  let list = GAMES.slice();
  if (teamFilter) {
    const t = [...TEAMS.values()].find(x => x.slug === teamFilter);
    if (t) list = list.filter(g => g.home_team_id === t.id || g.away_team_id === t.id);
  }
  if (stateFilter === 'results') list = list.filter(g => g.status === 'final' || g.status === 'live');
  if (stateFilter === 'upcoming') list = list.filter(g => g.status === 'scheduled');

  /* EVERY VIEW IS IN DATE ORDER; only the direction changes, and only where
     the direction is the point. Results alone read newest first, because a
     results feed is about what just happened. Everything else — the whole
     season, or the fixtures still to play — runs forwards, so round one is at
     the top and the reader scrolls towards games that have not happened.

     Showing everything used to use the results direction, which put next
     May above last September and read as no order at all. */
  /* A GAME BEING PLAYED GOES TO THE TOP, whatever the view is sorted by.

     Date order is right for everything else, but a live game is not really an
     item in a schedule — it is the thing the page is for at that moment, and
     somebody opening this page during a game should not have to find it among
     the fixtures either side of it. So live games are lifted out and the date
     ordering applies within each group. */
  const isLive = g => g.status === 'live';
  list.sort((a, b) => {
    const l = (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0);
    if (l) return l;
    /* among live games, the one that started first is furthest along */
    if (isLive(a)) return at(a) - at(b);
    return stateFilter === 'results' ? at(b) - at(a) : at(a) - at(b);
  });

  $('#count').textContent = list.length +
    (list.length === 1 ? ' fixture' : ' fixtures') +
    (teamFilter ? ' · ' + (([...TEAMS.values()].find(x => x.slug === teamFilter) || {}).name || '') : '');

  if (!list.length) {
    host.appendChild(el('div', 'empty', 'Nothing matches that. Try another club, or show everything.'));
    return;
  }

  /* Box scores only for the finished games actually on screen. A season of
     player_game_stats is a lot of rows to pull so somebody can skim. */
  const finals = list.filter(g => g.status === 'final').map(g => g.id);
  const byGame = new Map();
  const names = new Map();
  if (finals.length) {
    try {
      const chunks = [];
      for (let i = 0; i < finals.length; i += 40) chunks.push(finals.slice(i, i + 40));
      const parts = await Promise.all(chunks.map(c =>
        D.all(`player_game_stats?game_id=in.(${c.join(',')})` +
              `&select=game_id,player_uuid,player_id,stats`)));
      parts.flat().forEach(r => {
        if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
        byGame.get(r.game_id).push(r);
      });
      const ids = [...new Set(parts.flat().map(r => r.player_uuid || r.player_id).filter(Boolean))];
      const meta = await D.playerMeta(ids);
      Object.keys(meta).forEach(k => names.set(k, meta[k].name));
    } catch (_) { /* the list still stands without leaders */ }
  }

  let lastDay = null;
  list.forEach(g => {
    const d = dayKey(g);
    if (d && d !== lastDay) {
      lastDay = d;
      host.appendChild(el('div', 'day', fmtDay(d)));
    }
    host.appendChild(fixtureRow(g, byGame.get(g.id), names));
  });
}

/* ------------------------------------------------------------------ boot --- */
/* A GAME STARTING SHOULD NOT NEED A RELOAD. The page is often left open
   through an evening — a club's supporters open it before a game and leave it
   there — so the statuses are re-read on a timer and the list redrawn if any of
   them moved. Only the games are re-fetched, not the teams or the season: those
   cannot change while somebody is watching.

   Tight while something is live, relaxed otherwise, for the same reason the
   strip does it. setTimeout rather than setInterval so a slow response cannot
   queue a second request behind the first. */
/* Ninety seconds was too long for a page somebody leaves open through an
   evening: a game could finish, or start, and the list carry on showing the
   old state for a minute and a half. Thirty is the outside case now, and the
   usual case is not a timer at all — see the announcement below. */
const LIVE_MS = 15000, IDLE_MS = 30000;
let liveTimer = null;

/* ---------------------------------------------------------------------------
   THE ANNOUNCEMENT, so a game starting does not wait for the next beat.

   The scorer publishes every status change on one fixed topic. This joins it
   for as long as the page is open and re-reads when it hears one, which turns
   "within thirty seconds" into "as it happens" for the transition people
   actually care about. The timer stays as the floor: it covers a blocked
   websocket, a fixture added or rescheduled from the admin console, and a game
   finalised by somebody other than the scorer.

   NOTHING ON THE PAGE COMES FROM THE MESSAGE. It is a nudge to look; the
   fixtures table still decides what is shown, so anything forged on the topic
   costs one query and changes nothing. */
const ANNOUNCE_TOPIC = 'epinoia:live';
let rt = null;
function watchAnnouncements() {
  if (rt || !window.EpinoiaRT || !window.EPINOIA_CONFIG) return;
  rt = window.EpinoiaRT.create({ url: window.EPINOIA_CONFIG.supabaseUrl,
                                 key: window.EPINOIA_CONFIG.supabaseAnonKey });
  if (!rt) return;
  let soon = null;
  rt.watch(ANNOUNCE_TOPIC, () => {
    clearTimeout(soon);
    soon = setTimeout(() => { clearTimeout(liveTimer); watchLive(0); }, 80);
  });
}

function watchLive(delay) {
  clearTimeout(liveTimer);
  const anyLive = GAMES.some(g => g.status === 'live');
  liveTimer = setTimeout(async () => {
    try {
      const ids = GAMES.map(g => g.id);
      if (ids.length) {
        const fresh = await D.all('games?id=in.(' + ids.join(',') + ')' +
          '&select=id,status,home_score,away_score');
        const by = new Map(fresh.map(g => [g.id, g]));
        let moved = false;
        GAMES.forEach(g => {
          const f = by.get(g.id);
          if (!f) return;
          if (f.status !== g.status || f.home_score !== g.home_score ||
              f.away_score !== g.away_score) {
            g.status = f.status; g.home_score = f.home_score; g.away_score = f.away_score;
            moved = true;
          }
        });
        if (moved) await render();
      }
    } catch (_) { /* a blip must not stop the watch */ }
    watchLive();
  }, delay != null ? delay : (anyLive ? LIVE_MS : IDLE_MS));
}

(async function boot() {
  try {
    const ctx = await D.context(qp.get('l') || 'demo-league', qp.get('c'), qp.get('s'));
    LEAGUE = ctx.league;
    window.__CS_LEAGUE_SLUG = LEAGUE.slug;
    $('#ctx').textContent = LEAGUE.name + (ctx.season ? ' · ' + ctx.season.name : '');
    $('#foot').textContent = 'Epinoia Network · ' + LEAGUE.name;
    document.title = 'Fixtures · ' + LEAGUE.name;
    if (LEAGUE.colour_a) document.documentElement.style.setProperty('--team-a', LEAGUE.colour_a);

    (await D.all(`teams?league_id=eq.${LEAGUE.id}&select=id,name,short_name,slug,colour`))
      .forEach(t => TEAMS.set(t.id, t));

    try {
      const ids = [...TEAMS.keys()];
      if (ids.length) {
        (await D.all('media?owner_type=eq.team&kind=eq.logo&status=eq.approved' +
          '&owner_id=in.(' + ids.join(',') + ')&select=owner_id,storage_path'))
          .forEach(r => {
            if (!LOGOS.has(r.owner_id)) {
              LOGOS.set(r.owner_id, window.EPINOIA_CONFIG.supabaseUrl +
                '/storage/v1/object/public/media-public/' + r.storage_path);
            }
          });
      }
    } catch (_) { /* monograms all round */ }

    const comps = (ctx.comps || []).map(c => c.id);
    if (!comps.length) {
      $('#list').textContent = '';
      $('#list').appendChild(el('div', 'empty', 'This season has no competitions yet.'));
      return;
    }
    GAMES = await D.all('games?competition_id=in.(' + comps.join(',') + ')' +
      '&select=id,tipoff_at,status,home_score,away_score,venue,venue_address,' +
      'home_team_id,away_team_id&order=tipoff_at.desc');

    renderFilters();
    await render();
    watchLive();
    watchAnnouncements();
  } catch (e) {
    $('#list').textContent = '';
    $('#list').appendChild(el('div', 'empty', 'Could not load the fixtures: ' + (e.message || e)));
  }
})();
