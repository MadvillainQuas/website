'use strict';
/* ============================================================================
   WHICH SEASONS A READER MAY GO TO, AND THE ONE ROW OF CHIPS THAT OFFERS THEM.

   The database has had seasons since 0001 — one row per league per season,
   named the way a person writes one ("2026-27"; scripts/ingest/feedplatform.py
   season_name_for is the rule) — and the site barely admitted it. data.js
   context() resolves a ?s= when a page thinks to send one, and only the
   fixtures page did. No page OFFERED the choice, so last season was reachable
   only by somebody who already knew the parameter existed, and the season a
   page was showing was simply "the newest row", stated nowhere.

   One module, because a season control that behaves differently on four pages
   is four controls. It holds three things:

     THE RULE   which seasons are worth offering, and which one is the default
     THE READ   a league's seasons and their competitions, asked for once
     THE ROW    the chips, in the .gpick / .ep-chip idiom the games section and
                the fixtures filters already use — not a new control

   A SEASON WITH NO GAMES AT ALL IS NOT OFFERED. A competition row is created
   before a ball goes up and sometimes instead of one: BCB carries a duplicate
   "British Championship Basketball" with twenty entries and no fixtures, left
   by an earlier feed, and a season built only of those is a chip leading to a
   page that can only say "nothing here". Comps.js draws the same line one
   level down — entries say WHO, fixtures say WHETHER — and this is that rule
   applied to the season above them. A SCHEDULED fixture counts: an unplayed
   season that has been drawn is a real place to look, which is the whole of
   what several leagues have today.

   THE DEFAULT IS THE NEWEST OFFERED SEASON, AND TODAY'S DATE DOES NOT DECIDE
   IT. On 18 September 2026 several leagues have a full fixture list and not
   one result. A rule that asked which season contains today, or which has
   already started, would open every one of those leagues on LAST season for
   the whole of September — the reader would have to go and find the season
   they are actually in. A season row exists because somebody filed that
   season's fixtures, so the newest one with any is the one being played next.

   THE CHIPS ARE LINKS FIRST. A season is a place: the choice goes in ?s= so it
   can be copied, sent, opened in a new tab and reloaded into. A page that can
   honestly redraw itself passes onPick and the plain click is intercepted; a
   page that cannot — the league's front page is eight sections with their own
   caches — lets the link do what a link does. Either way the URL is the state
   and nothing is remembered anywhere else.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSeasonBar = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ------------------------------------------------------------- the rule --- */

const day = s => String((s && s.starts_on) || '').slice(0, 10);

/* Newest first. ISO dates compare as strings, which is the point of ISO dates;
   a season without a start date falls back to its name so a league whose rows
   predate starts_on still comes out in the order a reader expects. */
function newestFirst(a, b) {
  const A = day(a), B = day(b);
  if (A && B) { if (A !== B) return A < B ? 1 : -1; }
  else if (A) return -1;
  else if (B) return 1;
  return String(b.name || '').localeCompare(String(a.name || ''));
}

/* seasons: the league's season rows (each may carry its own `comps`)
   played:  the ids that have at least one game — an array or a Set */
function offer(o) {
  const all = ((o && o.seasons) || []).slice().sort(newestFirst);
  const p = (o && o.played) || [];
  const has = typeof p.has === 'function' ? (id => p.has(id)) : (id => p.indexOf(id) >= 0);
  const played = all.filter(s => has(s.id));
  /* NOTHING PLAYED ANYWHERE still has to leave the page a season to name — its
     heading, its footer and its statistics scope all read one. So the newest
     is kept and the control hides itself (one season is not a choice), which
     is also what a members-only league looks like from outside: the games are
     refused, so every season reads as empty and the page stays exactly as it
     was before this file existed. */
  const list = played.length ? played : all.slice(0, 1);
  return { all, list, current: list[0] || null };
}

/* ?s= may be a name or an id, and data.js pickSeason owns that matching rule —
   it is the one the fixtures page has been using since ?s= existed. Kept there
   rather than copied here: two spellings of "which season did they mean" is
   how a link opens one season on one page and another on the next. */
function pick(list, ref) {
  if (!list || !list.length) return null;
  const D = (typeof window !== 'undefined' && window.EpinoiaData) || null;
  if (D && typeof D.pickSeason === 'function') return D.pickSeason(list, ref);
  /* Without data.js on the page only an exact id can match — the one form that
     cannot be ambiguous — and anything else lands on the newest, as it does there. */
  return (ref && list.find(s => s.id === ref)) || list[0];
}

/* ------------------------------------------------------------- the read ---
   `api` is the page's own reader: a function taking a PostgREST path and
   returning rows (data.js `get`, or the plain helper the league and home pages
   keep). NOT data.js `all` — it appends its own offset and limit, and the
   games probe below carries a limit of its own.

   Three requests for a whole league's history, and the fan-out is the point:
   the seasons, then every season's competitions in ONE `in.()`, then one
   cheapest-possible probe per season asked all at once. Called once per page
   and shared — the league page, its games list, its clubs grid and its team of
   the year all want the same answer, and each of them used to fetch the
   seasons and the competitions for itself. */
const loading = new Map();

function load(api, leagueId) {
  if (loading.has(leagueId)) return loading.get(leagueId);
  const p = read(api, leagueId);
  /* A failure must not be remembered: a section that retries later deserves a
     real attempt, not a cached rejection from a blip. */
  p.catch(() => loading.delete(leagueId));
  loading.set(leagueId, p);
  return p;
}

async function read(api, leagueId) {
  const seasons = await api('seasons?league_id=eq.' + leagueId +
    '&select=id,name,starts_on,ends_on&order=starts_on.desc');
  if (!seasons.length) return offer({ seasons: [], played: [] });

  /* `select=*`, because this is the row the league page has always handed to
     its phase picker and its bracket — kind, format and whatever a later
     migration adds. A handful of rows; naming columns here would be a list to
     keep in step with three other files. */
  const comps = await api('competitions?season_id=in.(' +
    seasons.map(s => s.id).join(',') + ')&select=*&order=name');

  const bySeason = new Map();
  seasons.forEach(s => bySeason.set(s.id, []));
  comps.forEach(c => { const l = bySeason.get(c.season_id); if (l) l.push(c); });
  const rows = seasons.map(s => Object.assign({}, s, { comps: bySeason.get(s.id) || [] }));

  const played = await Promise.all(rows.map(async s => {
    if (!s.comps.length) return false;
    try {
      /* One row is the whole question. `select=id&limit=1` is a single index
         hit whatever the season's length — asking for the games themselves to
         count them would download a season per season. */
      const g = await api('games?competition_id=in.(' + s.comps.map(c => c.id).join(',') +
        ')&select=id&limit=1');
      return !!(g && g.length);
    } catch (_) {
      /* A refused or dropped probe is not evidence that a season is empty, and
         hiding a real season because one request blinked is the worse mistake. */
      return true;
    }
  }));

  return offer({ seasons: rows, played: rows.filter((s, i) => played[i]).map(s => s.id) });
}

/* league slug in, everything a page needs out — data.js context()'s shape with
   the seasons filtered down to the ones a reader can actually go to, and the
   default named. Pages that already hold their league row call load() instead. */
async function context(api, leagueSlug, seasonRef) {
  const lgs = await api('leagues?slug=eq.' + encodeURIComponent(leagueSlug) + '&select=*&limit=1');
  if (!lgs.length) throw new Error('no league "' + leagueSlug + '"');
  const league = lgs[0];
  const o = await load(api, league.id);
  const season = pick(o.list, seasonRef);
  return { league, season, seasons: o.list, all: o.all, current: o.current,
           comps: (season && season.comps) || [] };
}

/* --------------------------------------------------------------- the URL ---
   ?s= carries the season's NAME, not its id: "2026-27" is what a person would
   type and what makes a link to an old season readable. ?c= goes with it,
   because a competition id belongs to exactly one season — carried across it
   asks for a phase the new season does not have. */
function href(season, base) {
  const name = (season && season.name) || '';
  const loc = typeof location !== 'undefined' ? location : null;
  if (!base && !loc) return '?s=' + encodeURIComponent(name);
  const u = new URL(base || loc.href, base ? undefined : loc.href);
  u.searchParams.set('s', name);
  u.searchParams.delete('c');
  return u.pathname + u.search + u.hash;
}

/* what a page that redraws itself calls instead of navigating */
function syncUrl(season) {
  try { history.replaceState(null, '', href(season)); } catch (_) { /* the page is still right */ }
}

/* --------------------------------------------------------------- the row ---
   opts: host     the element the chips go in (the page owns its layout class)
         wrap     shown and hidden with them; the host by default
         seasons  what to offer, newest first (offer().list)
         season   the chosen row, or its id
         onPick   optional: a page that can redraw itself in place
   Returns whether anything was drawn, so a caller can hide a label of its own. */
function mount(o) {
  const host = o && o.host;
  if (!host) return false;
  const wrap = o.wrap || host;
  const doc = host.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const seasons = o.seasons || [];
  host.textContent = '';

  /* ONE SEASON IS NOT A CHOICE, and a control offering it is noise — the same
     line the phase and cup pickers draw on the league page. */
  if (seasons.length < 2 || !doc) {
    if (wrap.style) wrap.style.display = 'none';
    if ('hidden' in wrap) wrap.hidden = true;
    return false;
  }
  if (wrap.style) wrap.style.display = '';
  if ('hidden' in wrap) wrap.hidden = false;

  const onId = (o.season && o.season.id) || o.season || '';
  seasons.forEach(sn => {
    const a = doc.createElement('a');
    a.className = 'ep-chip' + (sn.id === onId ? ' on' : '');
    a.textContent = sn.name;
    a.href = href(sn, o.base);
    if (sn.id === onId) a.setAttribute('aria-current', 'true');
    if (typeof o.onPick === 'function') {
      a.addEventListener('click', ev => {
        /* A MODIFIED CLICK IS THE READER ASKING FOR A NEW TAB, and swallowing
           it would be this control taking away the one thing a link is for. */
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button) return;
        if (ev.preventDefault) ev.preventDefault();
        if (sn.id === onId) return;
        o.onPick(sn);
      });
    }
    host.appendChild(a);
  });
  return true;
}

return { offer, pick, load, context, mount, href, syncUrl, newestFirst };
}));
