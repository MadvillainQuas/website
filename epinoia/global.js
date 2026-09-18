'use strict';
/* ============================================================================
   GLOBAL — every league's season rows in one list.          window.EpinoiaGlobal

   Global scouting (docs/epinoia-home-and-app-roadmap.md, Phase 5) is the
   Statistics table over every league on the platform. The rows it shows are the
   rows the Statistics page shows, built the same way, one league at a time, and
   then put side by side. Three things make that harder than it sounds.

   ONE LEAGUE AT A TIME, NEVER ALL AT ONCE. EpinoiaSeason.players() keys its
   running totals by player id, so a player with games in two leagues handed to
   one D.season call comes back as one blended row -- and BPM measures a player
   against his own league's average offensive rating (bpm.js forLeague), which a
   blended call would take across leagues. So each league gets its own D.season
   over its newest season with all its competitions, exactly the Statistics
   page's "the whole season" scope, and the answers are merged afterwards.

   THE SAME PLAYER IN TWO LEAGUES IS TWO ROWS. Percentiles, position groups and
   the heat map are keyed by r.id, so a merged row's id is leagueId + ':' +
   playerId -- unique across the platform -- and playerId keeps the person, for
   the link to his profile.

   WHAT THIS VIEWER MAY SEE, ASKED BEFORE ANY ROW. The access states are loaded
   first, in one request (EpinoiaAccess.loadMany), for two reasons: a league the
   viewer cannot see is skipped and said to be skipped rather than drawn as an
   empty table, and a member's reads only carry their token once a members-only
   league they may see is loaded (access.js authHeaders) -- ask for rows first and
   a member's own league comes back empty.

   The rest of the rules:
   - the team is the club he played his games for (the last one, as the
     Statistics page's BPM already takes it), named from that league's teams --
     never the roster's first active entry, which is arbitrary across leagues,
     and whose short names repeat between SLB men and women;
   - names come from playerMeta, and A ROW WITH NO NAME IS DROPPED. Row-level
     security withholds a minor without public consent from `players` but not
     from the stats, so the Statistics page's "Player" fallback would rank, and
     let a stranger pick, an anonymous child;
   - `qualified` is gp >= ceil(teamGp / 3) and min >= max(30, 5 * teamGp), with
     teamGp the finished games of his team this season (the league's median
     team when his team has no row), so a thin sample does not top a table of
     every league;
   - player rows are read without their `adv` block (data.js PLAYER_STAT_KEYS),
     which players() never reads and is over half of every row.

   THE API
     players({ onAccess(access, leagues, excluded), onLeague(rows, league), signal })
       -> Promise<{ rows, leagues, excluded, failed, access }>
          rows      every league's rows, in league order
          leagues   the included leagues: {id, slug, name, short, country,
                    colour, logoPath, seasonId, seasonName, competitionIds, count}
          excluded  [{id, name, reason: 'members'}] leagues this viewer cannot see
          failed    [{id, name, error}] leagues whose rows could not be read (the
                    others still arrive; if every league fails, players() rejects)
          access    Map<leagueId, state> from EpinoiaAccess.loadMany
       onLeague is called as each league's rows arrive, with that league's rows
       (an empty list for a league with no finished games, never for a failed one).
       An aborted signal rejects with an AbortError and calls onLeague no more.
       onAccess is called once, after the access states and the included leagues
       are known and before any league's rows are read (the page's lock).
     lockedColumns(accessStates, keys?) -> Set of column keys locked on this page
     leagueShort(league)   'BCB', 'SLB M', 'SLB W'
     mergeLeague(league, S, meta, teams)   one league's rows, pure (the tests)
     qualifies(row, teamGp)

   UMD, like data.js, so node can require it for supabase/tests/global.test.mjs.
   It reads EpinoiaData and EpinoiaAccess off the global object when it runs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGlobal = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------ the league --- */
/* A LEAGUE'S SHORT NAME FOR A COLUMN, as broadcast.js already reasons about it:
   the league's own initials win, used as given. Otherwise the initials of its
   name, without the little words, and a men's or women's league named as such
   gets M or W after them -- "Super League Basketball Women" is SLB W, because
   SLB alone is two leagues. A derived acronym that lands on a political
   organisation's is refused and the first two letters are used instead (the
   reason is written up at broadcast.js leagueInitials). */
const NOISE = /^(of|the|and|for|a|an|de|du|la|le|el|des)$/i;
const NEVER_DERIVE = ['EDL', 'BNP', 'KKK', 'NSDAP', 'C18', 'SS', 'NF', 'BUF'];
const GENDER = [[/^(women|womens|women's|female|ladies|w)$/i, 'W'], [/^(men|mens|men's|male|m)$/i, 'M']];

function leagueShort(league) {
  const l = league || {};
  if (l.initials && String(l.initials).trim()) return String(l.initials).trim().toUpperCase().slice(0, 6);
  const words = String(l.name || l.slug || '').split(/[\s\-–—_/]+/).filter(w => w && !NOISE.test(w));
  let tail = '';
  if (words.length > 1) {
    const last = words[words.length - 1];
    const g = GENDER.find(x => x[0].test(last));
    if (g) { tail = g[1]; words.pop(); }
  }
  let letters = words.map(w => w.charAt(0)).join('').toUpperCase();
  if (NEVER_DERIVE.indexOf(letters) !== -1) letters = words.join('').slice(0, 2).toUpperCase();
  if (!letters) return tail;
  return tail ? letters + ' ' + tail : letters;
}

/* ------------------------------------------------------------- qualified --- */
function qualifies(row, teamGp) {
  const tg = Number(teamGp) > 0 ? Number(teamGp) : 0;
  const gp = Number(row && row.gp) || 0, min = Number(row && row.min) || 0;
  if (!tg) return gp > 0 && min >= 30;
  return gp >= Math.ceil(tg / 3) && min >= Math.max(30, 5 * tg);
}

function median(nums) {
  const v = nums.filter(n => typeof n === 'number' && isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* ----------------------------------------------------------------- merge ---
   One league's D.season answer as rows for the global table. Pure: S is
   {players, teams, teamOfPlayer}, meta is playerMeta's answer, teams is
   teamMeta's. The season row is copied, never changed in place. */
const PLAYER_KEYS = ['name', 'slug', 'photo_url', 'position'];

function mergeLeague(league, S, meta, teams) {
  const L = league || {};
  const players = (S && S.players) || [];
  const teamRows = (S && S.teams) || [];
  const tOf = S && S.teamOfPlayer;
  const M = meta || {}, T = teams || {};
  const gpOfTeam = new Map(teamRows.map(t => [t.id, t.gp]));
  const leagueGp = median(teamRows.map(t => t.gp));
  const short = L.short || leagueShort(L);
  const out = [];
  players.forEach(p => {
    const pid = p.id;
    const m = M[pid];
    /* no name, no row: a withheld minor (see the top), or a player nobody named */
    if (!m || !m.name || m.name === 'Player') return;
    const teamId = p._teamId || (tOf && (tOf.get ? tOf.get(pid) : tOf[pid])) || null;
    const t = (teamId && T[teamId]) || {};
    const teamGp = (teamId && gpOfTeam.has(teamId)) ? gpOfTeam.get(teamId) : leagueGp;
    const row = Object.assign({}, p);
    /* the person: the same whichever league he is listed in (the listed position
       included -- a guard in one league is not a centre in the next) */
    PLAYER_KEYS.forEach(k => { row[k] = m[k]; });
    row.position = m.position || '';
    /* the squad number only where the roster entry is for the club he played for */
    row.jersey = (m.teamId && m.teamId === teamId) ? (m.jersey || '') : '';
    Object.assign(row, {
      id: L.id + ':' + pid,
      playerId: pid,
      leagueId: L.id, leagueSlug: L.slug || '', leagueName: L.name || '', leagueShort: short,
      teamId,
      teamName: t.teamShort || t.name || '',
      teamFull: t.name || '', teamShort: t.teamShort || '', teamSlug: t.slug || '',
      colour: t.colour || null, teamLogo: t.logo || null,
      teamGp,
      qualified: qualifies(p, teamGp)
    });
    out.push(row);
  });
  return out;
}

/* --------------------------------------------------------- locked columns ---
   THE PAID COLUMNS ARE LOCKED FOR EVERYONE ON THIS PAGE IF ANY INCLUDED LEAGUE
   LOCKS THEM. Hiding only the locked league's cells would still leak its order
   through the sort and the filters, so the whole column goes. A league the
   viewer cannot see is not on the page and locks nothing. No state, or no
   access.js, locks nothing: analytics fail open (access.js, at the top).
   accessStates is loadMany's Map, an array of states, or an object of them;
   keys defaults to the player table's column keys. */
function lockedColumns(accessStates, keys) {
  const A = root.EpinoiaAccess;
  const S = accessStates;
  const list = !S ? [] : (S instanceof Map ? [...S.values()] : Array.isArray(S) ? S : Object.values(S));
  const locks = list.some(st => st && st.canView !== false && st.analyticsOk === false);
  if (!locks || !A || typeof A.isPremiumColumn !== 'function') return new Set();
  const cat = Array.isArray(keys) ? keys
    : ((root.EpinoiaTable && root.EpinoiaTable.PLAYER_COLS) || []).map(c => c && c.k);
  return new Set(cat.filter(k => k && A.isPremiumColumn(k)));
}

/* --------------------------------------------------------------- loading --- */
function aborted(signal) {
  if (!signal || !signal.aborted) return;
  let e;
  try { e = new DOMException('Aborted', 'AbortError'); } catch (_) { e = new Error('Aborted'); e.name = 'AbortError'; }
  throw e;
}

/* ids into URL-sized groups, for an in.() filter */
function groups(ids, n) {
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

async function players(opts) {
  const o = opts || {};
  const signal = o.signal || null;
  const onLeague = typeof o.onLeague === 'function' ? o.onLeague : null;
  const D = root.EpinoiaData;
  const A = root.EpinoiaAccess;
  if (!D || typeof D.season !== 'function') throw new Error('data.js has not loaded');
  aborted(signal);

  /* 1. the leagues.

     `gender` is asked for but not depended on (0131): a browser holding this
     file from cache against a database that has not taken the migration yet
     would otherwise get a 400 and an empty scouting page, so the column is
     dropped and the request repeated. Everything else here works without it —
     a league with no stated gender simply shows under "all". */
  const LEAGUE_COLS = 'id,slug,name,initials,country,access_mode,colour_a,logo_path';
  let all;
  try {
    all = await D.get('leagues?select=' + LEAGUE_COLS + ',gender&order=name');
  } catch (_) {
    all = await D.get('leagues?select=' + LEAGUE_COLS + '&order=name');
  }
  aborted(signal);

  /* 2. what this viewer may see, before any row is read */
  let access = new Map();
  if (A && typeof A.loadMany === 'function') {
    try { access = await A.loadMany({ leagueIds: all.map(l => l.id) }); } catch (_) { access = new Map(); }
  }
  aborted(signal);
  const excluded = [];
  const visible = all.filter(l => {
    const shut = A && typeof A.canView === 'function' && !A.canView(l.id);
    if (shut) excluded.push({ id: l.id, name: l.name, reason: 'members' });
    return !shut;
  });

  /* 3. each league's newest season, and every competition in it. The newest is
     the first by starts_on descending -- data.js pickSeason's rule, over the same
     ordering context() asks for -- and its competitions ride along embedded, so
     this is one request rather than two in a row. */
  const ids = visible.map(l => l.id);
  const seasons = ids.length
    ? (await Promise.all(groups(ids, 40).map(g =>
        D.all(`seasons?league_id=in.(${g.join(',')})` +
              `&select=id,league_id,name,starts_on,competitions(id,name,kind)&order=starts_on.desc`)))).flat()
    : [];
  aborted(signal);
  const newest = new Map();
  seasons.forEach(s => { if (!newest.has(s.league_id)) newest.set(s.league_id, s); });

  const leagues = visible.map(l => {
    const s = newest.get(l.id) || null;
    return {
      id: l.id, slug: l.slug, name: l.name, short: leagueShort(l), country: l.country || '',
      gender: l.gender || '',
      colour: l.colour_a || null, logoPath: l.logo_path || null,
      seasonId: s ? s.id : null, seasonName: s ? s.name : '',
      competitionIds: s && Array.isArray(s.competitions) ? s.competitions.map(c => c.id).filter(Boolean) : [],
      count: 0
    };
  });

  /* THE WHOLE PICTURE BEFORE ANY ROW. Every included league's access state is known here, so
     a page can settle what is locked once, over all of them, and never draw premium columns a
     slower league then takes away. */
  if (typeof o.onAccess === 'function' && !(signal && signal.aborted)) {
    try { o.onAccess(access, leagues, excluded); } catch (e) { if (root.console) console.warn('[global] onAccess', e); }
  }

  /* 4. every league at once, each drawn as it lands */
  const failed = [];
  const byLeague = new Map();
  /* every league is announced, an empty one too, so a page can tell "still coming"
     from "nothing there" */
  const arrived = (L, rows) => {
    L.count = rows.length;
    byLeague.set(L.id, rows);
    if (!onLeague || (signal && signal.aborted)) return;
    try { onLeague(rows, L); } catch (e) { if (root.console) console.warn('[global] onLeague', e); }
  };
  const one = async L => {
    if (!L.competitionIds.length) { arrived(L, []); return; }
    try {
      /* opts.trim === false reads player rows whole: only the tests ask, to prove
         the trimmed read changes nothing */
      /* rows: false — this file wants the season LINE, never the game rows it was summed
         from, and it holds every league's at once. See season()'s own note: keeping them
         would pin ~88 MB and ~114,000 row objects on a full platform, for nothing. */
      const [S, teams] = await Promise.all([
        D.season(L.competitionIds, { trim: o.trim !== false, rows: false }),
        D.teamMeta(L.id)
      ]);
      if (signal && signal.aborted) return;
      const meta = S.players && S.players.length ? await D.playerMeta(S.players.map(p => p.id)) : {};
      if (signal && signal.aborted) return;
      arrived(L, mergeLeague(L, S, meta, teams));
    } catch (e) {
      failed.push({ id: L.id, name: L.name, error: (e && e.message) || String(e) });
    }
  };
  await Promise.all(leagues.map(one));
  aborted(signal);

  const withComps = leagues.filter(L => L.competitionIds.length);
  if (withComps.length && failed.length === withComps.length) {
    throw new Error('Could not load any league: ' + failed[0].error);
  }
  const rows = [];
  leagues.forEach(L => { (byLeague.get(L.id) || []).forEach(r => rows.push(r)); });
  return { rows, leagues, excluded, failed, access };
}

return { players, lockedColumns, leagueShort, mergeLeague, qualifies };
}));
