'use strict';
/* ============================================================================
   GAMES ACROSS EVERY LEAGUE — HOME's daily fixtures and /epinoia/games/
   (roadmap Phase 2).

   Every other fixtures query on the platform is scoped to one league. These
   are not, which brings two traps with them:

     * TEST GAMES. The live database holds games with no competition, some of
       them "finals" dated weeks ahead. An unscoped query picks them up and puts
       them at the top of every list. SEL embeds the competition, its season
       and its league with !inner, so a game that belongs to no league is not a
       row at all. Nothing downstream has to remember to filter.

     * "RECENT" IS BOTH WAYS. With hundreds of fixtures still to play, the
       newest tip-offs are next spring's. So nothing here is one descending
       list: upcoming games are read forwards from just before now, results
       backwards from now, and the two are merged by distance from now.

   ANONYMOUS READS NEVER SEE 'finalising'. A game vanishes from both lists for
   the minute finalise-game runs and comes back as a result. Everything below
   de-duplicates by id and never assumes a count only grows.

   Pure functions (pickDaily, mergeNearest, groupOrder, nearer, feed with an
   injected fetch) run under node in supabase/tests/globalgames.test.mjs; the
   rest needs config.js and a browser.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGlobalGames = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const TEAM = 'id,slug,name,short_name,colour,colour_2,logo_path';
const LEAGUE = 'id,slug,name,country,colour_a,colour_b,colour_source,logo_path,access_mode,access_fixtures_public';
const SEL = 'id,tipoff_at,status,home_score,away_score,venue,competition_id,' +
  'home:home_team_id(' + TEAM + '),away:away_team_id(' + TEAM + '),' +
  'competitions!inner(id,name,kind,seasons!inner(id,name,leagues!inner(' + LEAGUE + ')))';

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
/* A scheduled game stays listed until two hours after its tip-off: a game that
   tipped late, or whose scorer has not pressed start, is still tonight's game. */
const STALE_MS = 2 * HOUR;
/* how far ahead a league's next game still earns it a card of its own on HOME */
const LEAGUE_WINDOW_MS = 14 * DAY;
/* a fixture and a result this close to the same distance from now are a tie */
const TIE_MS = 60 * 1000;

const t = g => { const v = Date.parse((g && g.tipoff_at) || ''); return isFinite(v) ? v : 0; };
const ms = d => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d));
const iso = v => new Date(v).toISOString();

/* ------------------------------------------------------------ the league ---
   PostgREST returns a to-one embed as an object; an older client or a view
   could return a one-element array. Both read the same. */
const one = v => (Array.isArray(v) ? v[0] : v) || null;
function leagueOf(g) {
  const c = one(g && g.competitions);
  const s = one(c && c.seasons);
  return one(s && s.leagues);
}
const leagueId = g => { const l = leagueOf(g); return l ? l.id : null; };

/* ============================================================ transport ===
   One fetch with the same manners as data.js: the anon key, a member's token
   when access.js says one is worth sending, bounded retries on 429/5xx. It is
   its own because the global page needs an EXACT COUNT (Content-Range) and
   data.js does not export its counted request. */
const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = n => new Promise(r => setTimeout(r, n));

async function request(path, counted) {
  const c = root.EPINOIA_CONFIG;
  if (!c || !c.supabaseUrl) throw new Error('config.js has not loaded');
  let wait = 400;
  for (let attempt = 0; ; attempt++) {
    const headers = { apikey: c.supabaseAnonKey, Accept: 'application/json' };
    if (counted) headers.Prefer = 'count=exact';
    try {
      const A = root.EpinoiaAccess;
      if (A && typeof A.authHeaders === 'function') Object.assign(headers, A.authHeaders() || {});
    } catch (_) { /* anonymous */ }
    let r;
    try { r = await fetch(c.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers }); }
    catch (e) { if (attempt >= 3) throw e; await sleep(wait); wait *= 2; continue; }
    if (r.ok) {
      const rows = await r.json();
      if (!counted) return rows;
      const tail = (r.headers.get('content-range') || '').split('/')[1];
      return { rows, total: tail && tail !== '*' ? parseInt(tail, 10) : null };
    }
    if (!RETRY.has(r.status) || attempt >= 3) throw new Error(r.status + ' on ' + path.split('?')[0]);
    await sleep(wait); wait = Math.min(8000, wait * 2);
  }
}

/* ============================================================== queries === */

let leaguesP = null;
/* Every league a reader may see, once per page. */
function leagues() {
  if (!leaguesP) {
    leaguesP = request('leagues?select=' + LEAGUE + '&order=name.asc', false)
      .catch(e => { leaguesP = null; throw e; });
  }
  return leaguesP.then(r => r.slice());
}

/* Every live game. Rarely more than a handful anywhere on the platform. */
function live() {
  return request('games?select=' + SEL + '&status=eq.live&order=tipoff_at.asc,id.asc&limit=40', false);
}

/* Scheduled games from fromISO onwards, soonest first. */
function upcoming(fromISO, limit, offset) {
  return request('games?select=' + SEL + '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(fromISO) +
    '&order=tipoff_at.asc,id.asc&limit=' + (limit || 40) + (offset ? '&offset=' + offset : ''), false);
}

/* Results before beforeISO, newest first. */
function recent(beforeISO, offset, limit) {
  return request('games?select=' + SEL + '&status=eq.final&tipoff_at=lt.' + encodeURIComponent(beforeISO) +
    '&order=tipoff_at.desc,id.desc&limit=' + (limit || 30) + (offset ? '&offset=' + offset : ''), false);
}

/* EACH LEAGUE'S NEXT GAME, on its own query, because the time-ordered list of
   forty can be all one busy league's. Cached per page, but a cached game whose
   tip-off has passed is asked for again: it has gone live or been played, and
   the next one is somebody else. */
const nextCache = new Map();
function nextFor(id, opts) {
  const fresh = opts && opts.fresh;
  const held = nextCache.get(id);
  if (held && !fresh) {
    const stillAhead = held.then(g => !g || t(g) > Date.now(), () => false);
    return stillAhead.then(ok => (ok ? held : refetchNext(id)));
  }
  return refetchNext(id);
}
function refetchNext(id) {
  const from = iso(Date.now() - STALE_MS);
  const p = request('games?select=' + SEL + '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(from) +
    '&competitions.seasons.leagues.id=eq.' + encodeURIComponent(id) +
    '&order=tipoff_at.asc,id.asc&limit=1', false).then(r => r[0] || null);
  nextCache.set(id, p);
  p.catch(() => nextCache.delete(id));
  return p;
}

/* THE SCOREBOARD OF A LIVE GAME: period and the score the scorer last wrote.
   games.home_score is kept current too; this adds the quarter. Never fatal. */
async function liveState(ids) {
  if (!ids || !ids.length) return {};
  try {
    const rows = await request('game_state?select=game_id,period,score_home,score_away,updated_at' +
      '&game_id=in.(' + ids.map(encodeURIComponent).join(',') + ')', false);
    const out = {};
    rows.forEach(r => { out[r.game_id] = r; });
    return out;
  } catch (_) { return {}; }
}

/* ======================================================= pure: choosing === */

/* Nearer to now first. Between a fixture and a result the same distance away
   (within a minute), the fixture: a reader is deciding what to watch. Then
   soonest fixture, newest result, and the id so the order never flickers. */
function nearer(a, b, now) {
  const n = ms(now);
  const ta = t(a), tb = t(b);
  const da = Math.abs(ta - n), db = Math.abs(tb - n);
  if (Math.abs(da - db) > TIE_MS) return da - db;
  const fa = a.status === 'final', fb = b.status === 'final';
  if (fa !== fb) return fa ? 1 : -1;
  if (ta !== tb) return fa ? tb - ta : ta - tb;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

function dedupe(rows) {
  const seen = new Set(), out = [];
  (rows || []).forEach(g => { if (g && g.id != null && !seen.has(g.id)) { seen.add(g.id); out.push(g); } });
  return out;
}

/* The n games nearest to now from both sides, each game once (the first copy
   wins, so a fixture listed on both sides reads as the fixture). */
function mergeNearest(up, rec, now, n) {
  const all = dedupe([].concat(up || [], rec || []));
  all.sort((a, b) => nearer(a, b, now));
  return n == null ? all : all.slice(0, n);
}

/* DAILY FIXTURES: n cards.
     1. every live game;
     2. each league not already on a card gets its next game, when that is
        within 14 days, nearest first while slots last (BCB would otherwise take
        six of the next eight);
     3. the rest by tip-off.
   Shown live first, then by tip-off. nextByLeague is a Map, a plain object or
   an array of games; a null entry is a league with nothing coming. */
function pickDaily(liveRows, upRows, nextByLeague, now, n) {
  const N = n == null ? 8 : n;
  const at = ms(now);
  const lives = dedupe(liveRows).filter(g => g.status === 'live').sort((a, b) => t(a) - t(b));
  const liveIds = new Set(lives.map(g => g.id));
  const ups = dedupe(upRows).filter(g => !liveIds.has(g.id) && g.status !== 'final' && g.status !== 'live')
    .sort((a, b) => t(a) - t(b) || (String(a.id) < String(b.id) ? -1 : 1));

  let nexts = [];
  if (nextByLeague instanceof Map) nexts = Array.from(nextByLeague.values());
  else if (Array.isArray(nextByLeague)) nexts = nextByLeague.slice();
  else if (nextByLeague) nexts = Object.keys(nextByLeague).map(k => nextByLeague[k]);
  nexts = dedupe(nexts.filter(Boolean)).filter(g => !liveIds.has(g.id) && g.status === 'scheduled');

  const chosen = lives.slice();
  const ids = new Set(liveIds);
  const shown = new Set(lives.map(leagueId));
  const room = () => Math.max(chosen.length, N) - chosen.length;

  /* each league's first game from either source */
  const firstOf = new Map();
  ups.concat(nexts).forEach(g => {
    const id = leagueId(g);
    if (id == null) return;
    const held = firstOf.get(id);
    if (!held || t(g) < t(held)) firstOf.set(id, g);
  });
  const reserved = Array.from(firstOf.entries())
    .filter(([id, g]) => !shown.has(id) && t(g) - at <= LEAGUE_WINDOW_MS)
    .map(e => e[1])
    .sort((a, b) => nearer(a, b, at));
  reserved.forEach(g => {
    if (room() <= 0 || ids.has(g.id)) return;
    chosen.push(g); ids.add(g.id); shown.add(leagueId(g));
  });
  ups.forEach(g => {
    if (room() <= 0 || ids.has(g.id)) return;
    chosen.push(g); ids.add(g.id);
  });

  const rest = chosen.slice(lives.length).sort((a, b) => t(a) - t(b));
  return lives.concat(rest);
}

/* THE GLOBAL PAGE'S GROUPS: one per league, ordered by its most imminent game
   (a live game is as imminent as it gets). Inside each, 'next' (anything not
   yet a result) soonest first, then 'results' newest first. */
function groupOrder(rows, now) {
  const at = ms(now);
  const map = new Map();
  dedupe(rows).forEach(g => {
    const l = leagueOf(g);
    const key = l ? l.id : '';
    if (!map.has(key)) map.set(key, { key, league: l, next: [], results: [], imminent: Infinity });
    const grp = map.get(key);
    (g.status === 'final' ? grp.results : grp.next).push(g);
    const d = g.status === 'live' ? 0 : Math.abs(t(g) - at);
    if (d < grp.imminent) grp.imminent = d;
  });
  const groups = Array.from(map.values());
  groups.forEach(grp => {
    grp.next.sort((a, b) => ((a.status === 'live') !== (b.status === 'live') ? (a.status === 'live' ? -1 : 1) : t(a) - t(b)));
    grp.results.sort((a, b) => t(b) - t(a));
    grp.count = grp.next.length + grp.results.length;
  });
  groups.sort((a, b) => a.imminent - b.imminent ||
    String((a.league && a.league.name) || '').localeCompare(String((b.league && b.league.name) || '')));
  return groups;
}

/* =================================================== the two cursors ===
   feed({ now, fetch, exclude, batch }) -> { next(n) -> Promise<{ rows, done, total, shown }> }

   Two sides, each read with a KEYSET cursor (after the last tip-off and id it
   returned), never an offset: a game that goes live or final between two pages
   would shift an offset by one and silently skip a fixture. Upcoming is
   scheduled games from now-2h forwards; results are finals before now,
   backwards.

   HOW 30 NEAREST ARE EMITTED WITHOUT READING EVERYTHING. The nearest buffered
   game is only safe to show when no unread game could be nearer. For results
   the unread ones are all older than the last read, so no nearer than it. For
   upcoming the unread ones are all later than the last read, which bounds them
   by (last - now) once the cursor has passed now — and by nothing before that,
   which is why the first page of upcoming (the stale two hours) is always read
   through. A side whose bound is within a minute of the candidate (the tie
   window of nearer()) is read further first, so the order is exact, not
   approximately right; a side that returned less than it asked for is finished.

   fetch(side, after, limit, counted) -> Promise<{ rows, total }>, side 'up' or
   'res', after null or { t (ms), id }. The first read of each side is counted;
   total is live games' ids excluded (exclude) plus both counts, and when both
   sides are finished it becomes what was actually shown, because games do
   drop out. */
function feed(opts) {
  const o = opts || {};
  const at = ms(o.now == null ? Date.now() : o.now);
  const batch = o.batch || 30;
  const fetchSide = o.fetch || defaultFetch(at);
  const seen = new Set((o.exclude || []).map(g => (g && g.id != null ? g.id : g)));
  const sides = {
    up: { buf: [], after: null, done: false, total: null, started: false },
    res: { buf: [], after: null, done: false, total: null, started: false }
  };
  let shown = 0;

  function bound(name) {
    const s = sides[name];
    if (s.done) return Infinity;
    if (!s.started || !s.after) return 0;
    return name === 'up' ? Math.max(0, s.after.t - at) : Math.max(0, at - s.after.t);
  }

  async function read(name) {
    const s = sides[name];
    const res = await fetchSide(name, s.after, batch, !s.started);
    const rows = (res && res.rows) || [];
    if (!s.started) { s.total = res && res.total != null ? res.total : null; s.started = true; }
    if (rows.length) {
      const last = rows[rows.length - 1];
      /* A READ THAT DID NOT MOVE THE CURSOR ENDS THE SIDE. It cannot happen with the keyset
         above; if a proxy or a changed query ever made it happen, the page would otherwise ask
         for the same rows until the loop guard. */
      if (s.after && s.after.t === t(last) && s.after.id === last.id) s.done = true;
      s.after = { t: t(last), id: last.id };
    }
    if (rows.length < batch) s.done = true;
    rows.forEach(g => { if (!seen.has(g.id) && !s.buf.some(b => b.id === g.id)) s.buf.push(g); });
  }

  function candidate() {
    let best = null, from = null;
    ['up', 'res'].forEach(name => {
      sides[name].buf.forEach(g => {
        if (!best || nearer(g, best, at) < 0) { best = g; from = name; }
      });
    });
    return best ? { g: best, side: from } : null;
  }

  async function next(n) {
    const want = n || 30;
    const out = [];
    let guard = 0;
    while (out.length < want && guard++ < 10000) {
      const c = candidate();
      const d = c ? Math.abs(t(c.g) - at) : Infinity;
      /* A side that could still hold something that sorts first, nearest bound first. The
         minute's tie is included, since a fixture that far off still beats a result. */
      const pending = ['up', 'res'].filter(name => !sides[name].done && bound(name) <= d + TIE_MS)
        .sort((a, b) => bound(a) - bound(b));
      if (pending.length) { await read(pending[0]); continue; }
      if (!c) break;
      const s = sides[c.side];
      s.buf.splice(s.buf.indexOf(c.g), 1);
      if (seen.has(c.g.id)) continue;
      seen.add(c.g.id);
      out.push(c.g);
    }
    shown += out.length;
    const done = sides.up.done && sides.res.done && !sides.up.buf.length && !sides.res.buf.length;
    let total = (sides.up.total == null || sides.res.total == null) ? null : sides.up.total + sides.res.total;
    if (done || (total != null && total < shown)) total = shown;
    return { rows: out, done, total, shown };
  }

  return { next };
}

/* The real reads behind feed(): quoted timestamps inside or=(), because an
   ISO time is full of the dots and colons PostgREST's grammar splits on. */
function defaultFetch(at) {
  const fromUp = iso(at - STALE_MS), before = iso(at);
  return function (side, after, limit, counted) {
    let q = 'games?select=' + SEL;
    if (side === 'up') {
      q += '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(fromUp) + '&order=tipoff_at.asc,id.asc';
      if (after) q += '&or=' + encodeURIComponent('(tipoff_at.gt."' + iso(after.t) + '",and(tipoff_at.eq."' +
        iso(after.t) + '",id.gt.' + after.id + '))');
    } else {
      q += '&status=eq.final&tipoff_at=lt.' + encodeURIComponent(before) + '&order=tipoff_at.desc,id.desc';
      if (after) q += '&or=' + encodeURIComponent('(tipoff_at.lt."' + iso(after.t) + '",and(tipoff_at.eq."' +
        iso(after.t) + '",id.lt.' + after.id + '))');
    }
    q += '&limit=' + limit;
    return request(q, !!counted).then(r => (Array.isArray(r) ? { rows: r, total: null } : r));
  };
}

/* ================================================================ cards ===
   One fixture card, shared by HOME and the global page (kit/fxc.css).
   The league badge on top, home and away as two rows with their crests, and on
   the right the score (live, final) or the tip-off. Links to the game. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);

function periodLabel(p) {
  if (!p) return '';
  return p <= 4 ? 'Q' + p : p === 5 ? 'OT' : 'OT' + (p - 4);
}
function dayLabel(v, now) {
  const d = new Date(v), n = new Date(ms(now == null ? Date.now() : now));
  const key = x => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
  const tmw = new Date(n.getTime()); tmw.setDate(tmw.getDate() + 1);
  const yst = new Date(n.getTime()); yst.setDate(yst.getDate() - 1);
  if (key(d) === key(n)) return 'Today';
  if (key(d) === key(tmw)) return 'Tomorrow';
  if (key(d) === key(yst)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function timeLabel(v) {
  return new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function shortName(team, fallback) {
  const s = String((team && team.short_name) || '').trim();
  if (s) return s;
  const n = String((team && team.name) || fallback || '').trim();
  /* the first word carries a club ("Leeds Rhinos" -> Leeds); a first word of two letters or
     fewer is a prefix ("BC Oxford"), so the next one does */
  const w = n.split(/\s+/).filter(Boolean);
  return (w.length > 1 && w[0].length <= 2 ? w[1] : w[0]) || n;
}

function node(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* A logo that fails to load becomes the league's monogram, not a broken image.
   The CSP forbids onerror="", so the listener is attached here. */
function wireBadges(scope) {
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('.lgb-tile img:not([data-wired])').forEach(img => {
    img.setAttribute('data-wired', '1');
    img.addEventListener('error', () => {
      const tile = img.parentNode;
      const m = node('span', 'lgb-mono', (tile && tile.getAttribute('data-mono')) || '');
      img.replaceWith(m);
    }, { once: true });
  });
}

function badge(league, opts) {
  if (typeof root.epinoiaLeagueBadge === 'function') return root.epinoiaLeagueBadge(league, opts);
  return '<span class="lgb"><span class="lgb-name">' + esc((league && league.name) || 'League') + '</span></span>';
}

/* card(g, { base, now, state, badge:false }) -> <a class="fxc"> */
function card(g, opts) {
  const o = opts || {};
  const base = o.base == null ? '../' : o.base;
  const st = o.state || null;
  const isLive = g.status === 'live', isFinal = g.status === 'final';
  const a = node('a', 'fxc ' + (isLive ? 'is-live' : isFinal ? 'is-final' : 'is-upcoming'));
  a.href = base + 'game/?g=' + encodeURIComponent(g.id) + '&mode=supabase';
  a.setAttribute('data-game', g.id);
  const hc = hex(g.home && g.home.colour), ac = hex(g.away && g.away.colour);
  if (hc) a.style.setProperty('--h', hc);
  if (ac) a.style.setProperty('--a', ac);

  const hs = isLive && st && st.score_home != null ? st.score_home : g.home_score;
  const as = isLive && st && st.score_away != null ? st.score_away : g.away_score;
  const home = (g.home && (g.home.name || g.home.short_name)) || 'Home';
  const away = (g.away && (g.away.name || g.away.short_name)) || 'Away';
  a.setAttribute('aria-label', home + ' v ' + away + ', ' +
    (isLive ? 'live, ' + (hs || 0) + '–' + (as || 0)
      : isFinal ? 'final, ' + (hs || 0) + '–' + (as || 0)
        : dayLabel(g.tipoff_at, o.now) + ' ' + timeLabel(g.tipoff_at)));

  /* the top line: the league, and the state */
  const top = node('span', 'fxc-top');
  if (o.badge !== false) {
    const holder = node('span', 'fxc-lg');
    holder.innerHTML = badge(leagueOf(g), { small: true });
    top.appendChild(holder);
  }
  const state = node('span', 'fxc-st');
  if (isLive) {
    state.appendChild(node('span', 'dot'));
    state.appendChild(document.createTextNode('Live' + (st && st.period ? ' · ' + periodLabel(st.period) : '')));
  } else if (isFinal) state.textContent = 'Final';
  else {
    /* the time rides on the state line only when the card is too narrow for its own column */
    state.appendChild(node('span', null, dayLabel(g.tipoff_at, o.now)));
    state.appendChild(node('span', 'fxc-st-t', ' · ' + timeLabel(g.tipoff_at)));
  }
  top.appendChild(state);
  a.appendChild(top);

  const winH = isFinal && hs != null && as != null && hs > as;
  const winA = isFinal && hs != null && as != null && as > hs;
  const side = (team, name, score, cls, win, lose) => {
    const row = node('span', 'fxc-tm ' + cls + (win ? ' win' : lose ? ' lose' : ''));
    const crest = root.epinoiaCrest ? root.epinoiaCrest(team || {}, { cls: 'fxc-crest' }) : node('span', 'fxc-crest');
    row.appendChild(crest);
    /* the full name, and the club's letters for a card too narrow to hold it (fxc.css picks).
       The letters are the league's own unique initials (initials.js) once they have loaded;
       until then, and on a page without initials.js, the club's short name stands in. */
    const nm = node('span', 'fxc-nm');
    nm.title = name;
    nm.appendChild(node('span', 'full', name));
    const I = root.EpinoiaInitials;
    const short = node('span', 'short', (I && team && I.code(team)) || shortName(team, name));
    if (I && team && team.id) {
      short.setAttribute('data-initials-team', team.id);
      if (I.code(team)) short.classList.add('is-code');
      const lg = leagueOf(g);
      if (lg && lg.id) I.want(lg.id);
    }
    nm.appendChild(short);
    row.appendChild(nm);
    if (isLive || isFinal) row.appendChild(node('span', 'fxc-sc', score == null ? '0' : String(score)));
    return row;
  };
  const body = node('span', 'fxc-body');
  body.appendChild(side(g.home, home, hs, 'h', winH, winA));
  body.appendChild(side(g.away, away, as, 'a', winA, winH));
  if (!isLive && !isFinal) {
    const when = node('span', 'fxc-when');
    when.appendChild(node('b', null, timeLabel(g.tipoff_at)));
    when.appendChild(node('span', null, 'tip-off'));
    body.appendChild(when);
  }
  a.appendChild(body);

  const foot = node('span', 'fxc-foot');
  foot.appendChild(node('span', 'fxc-vn', g.venue || (one(g.competitions) || {}).name || ''));
  foot.appendChild(node('span', 'fxc-go', isLive ? 'watch →' : isFinal
    ? dayLabel(g.tipoff_at, o.now) : 'preview →'));
  a.appendChild(foot);

  wireBadges(a);
  return a;
}

return {
  SEL, STALE_MS, LEAGUE_WINDOW_MS,
  leagues, live, upcoming, recent, nextFor, liveState, leagueOf, request,
  pickDaily, mergeNearest, groupOrder, nearer, feed, dedupe,
  card, wireBadges, dayLabel, timeLabel, esc
};
}));
