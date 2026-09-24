/* ============================================================================
   GLOBAL SCOUTING'S ROWS — epinoia/global.js, and what it leans on in
   access.js (loadMany), data.js (the trimmed season read, playerMeta) and
   season.js (percentiles by binary search).

   What goes wrong quietly on a table of every league is never a crash:
   - the same player in two leagues becomes ONE row (blended totals, one
     league's BPM baseline), or two rows sharing one id, so one overwrites the
     other's percentiles and position group;
   - an anonymous minor ranks in a public table as "Player";
   - a league whose analytics are locked leaves the paid columns open for
     everybody, because the table only knows about one league;
   - a member's own members-only league comes back empty because the rows were
     read before the access answer that puts their token on the request;
   - the trimmed read (player rows without `adv`) drops a key players() reads,
     and every season number that used it goes to zero without an error;
   - a faster percentile gives a slightly different rank.
   Each is pinned below. No network: a fake PostgREST answers the same URLs the
   page sends, including the JSON-path select the trimmed read uses.

     node supabase/tests/global.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got  ' + g + '\n          want ' + w);
};
/* rows compared key by key whatever order the keys were written in */
const canon = rows => JSON.stringify(rows.map(r => { const o = {}; Object.keys(r).sort().forEach(k => { o[k] = r[k]; }); return o; }));

/* ---- a browser's worth of globals, before any module loads ---- */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }, clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null, get length() { return m.size; }
  };
}
const LS = memStore(), SS = memStore();
Object.defineProperty(globalThis, 'localStorage', { value: LS, configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: SS, configurable: true, writable: true });
globalThis.window = globalThis;
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://abcref.supabase.co', supabaseAnonKey: 'sb_publishable_test' };

globalThis.EpinoiaBPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
const Season = require(path.join(ROOT, 'epinoia', 'season.js'));
globalThis.EpinoiaSeason = Season;
const D = require(path.join(ROOT, 'epinoia', 'data.js'));
globalThis.EpinoiaData = D;
const A = require(path.join(ROOT, 'epinoia', 'access.js'));
globalThis.EpinoiaAccess = A;
const Table = require(path.join(ROOT, 'epinoia', 'fulltable.js'));
globalThis.EpinoiaTable = Table;
const G = require(path.join(ROOT, 'epinoia', 'global.js'));

const TOKEN_KEY = 'sb-abcref-auth-token';
const signIn = id => LS.setItem(TOKEN_KEY, JSON.stringify({
  access_token: 'tok-' + id, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: id + '@example.org' } }));
const signOut = () => LS.removeItem(TOKEN_KEY);

/* ============================================================================
   A SMALL PLATFORM. Three leagues:
     L1 'British Championship Basketball'  open
     L2 'Super League Basketball Women'    open; analytics for members (locked)
     L3 'Members Cup'                      members-only
   Player P-SHARED plays in L1 AND L2. Player P-MINOR plays in L1 but is
   withheld from `players` (as row-level security withholds a minor). Every
   player row carries a fat `adv` block and one key stored as null.
   ============================================================================ */
const L1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const L2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const L3 = 'aaaaaaaa-0000-0000-0000-000000000003';
const LEAGUES = [
  { id: L1, slug: 'bcb', name: 'British Championship Basketball', initials: null, country: 'GB', access_mode: 'open', colour_a: '#111', logo_path: null },
  { id: L3, slug: 'members-cup', name: 'Members Cup', initials: null, country: 'GB', access_mode: 'members', colour_a: null, logo_path: null },
  { id: L2, slug: 'slb-women', name: 'Super League Basketball Women', initials: null, country: 'GB', access_mode: 'open', colour_a: null, logo_path: null }
];

/* REAL PLAYER IDS ARE UUIDS, and playerMeta only asks the database for those (a feed's "0:12" is a 400
   there, unregistered-players.test.mjs). The fixtures' ids are made uuid-shaped, so this suite exercises
   the path a register id takes. */
import { createHash } from 'node:crypto';
const uid = name => { const h = createHash('md5').update(name).digest('hex'); return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32); };
const P_SHARED = uid('P-SHARED'), P_MINOR = uid('P-MINOR');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* one league's season: two teams, three final games, six players a side */
function buildLeague(lid, tag, sharedAt, extra) {
  const rnd = seeded(tag.charCodeAt(0) * 97 + tag.length);
  const T = ['t-' + tag + '-home', 't-' + tag + '-away'];
  const comp = 'c-' + tag, season = 's-' + tag, oldSeason = 's-' + tag + '-old';
  const squads = [[], []];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 6; i++) squads[side].push(uid('p-' + tag + '-' + side + '-' + i));
  }
  if (sharedAt) squads[sharedAt.side][sharedAt.slot] = P_SHARED;
  (extra || []).forEach(x => { squads[x.side][x.slot] = x.id; });
  const games = [], pgs = [], tgs = [];
  for (let g = 0; g < 3; g++) {
    const gid = 'g-' + tag + '-' + g;
    const box = [0, 1].map(side => {
      const rows = squads[side].map((pid, i) => {
        const p2a = 2 + Math.floor(rnd() * 8), p2m = Math.floor(p2a * rnd());
        const p3a = Math.floor(rnd() * 6), p3m = Math.floor(p3a * rnd());
        const fta = Math.floor(rnd() * 5), ftm = Math.floor(fta * rnd());
        const stats = {
          min: (8 + Math.floor(rnd() * 26)) * 60000, pts: 2 * p2m + 3 * p3m + ftm,
          p2m, p2a, p3m, p3a, ftm, fta, or: Math.floor(rnd() * 3), dr: Math.floor(rnd() * 6),
          ast: Math.floor(rnd() * 6), stl: Math.floor(rnd() * 3), blk: Math.floor(rnd() * 2) + (i === 5 ? 2 : 0),
          to: Math.floor(rnd() * 3), pf: Math.floor(rnd() * 4), fd: Math.floor(rnd() * 3), pm: Math.floor(rnd() * 21) - 10,
          ptsAst: Math.floor(rnd() * 8), rimA: Math.floor(rnd() * 4), rimM: 1, midA: 2, midM: Math.floor(rnd() * 2),
          paint: 4, fast: Math.floor(rnd() * 3), sc: 1, pot: 2, dq: false, t: 1, u: 'x',
          fg3pct: null,                                   /* stored as null: must read the same trimmed */
          oc: { tFGA: 40, tFGM: 18, t3M: 5, tFTA: 10, tTOV: 7, tOR: 5, tDR: 18, tPTS: 50,
                oFGA: 42, oFGM: 17, o3M: 6, oFTA: 9, oTOV: 8, oOR: 6, oDR: 17, oPTS: 48 },
          sit: g === 0 ? { v: 1, all: [4, 2, 4, 0, 1, 1, 1, 1, 2, 0, 0, 0], ast: [1, 2, 0, 1, 0], unast: [1, 2, 0, 0, 1] } : undefined,
          adv: { efg: 51.2, ts: 55.5, usg: 22.1, note: 'x'.repeat(400) }
        };
        if (stats.sit === undefined) delete stats.sit;
        return { game_id: gid, player_uuid: pid, player_id: null, team_idx: side, stats };
      });
      const sum = k => rows.reduce((a, r) => a + (r.stats[k] || 0), 0);
      const fgm = sum('p2m') + sum('p3m'), fga = sum('p2a') + sum('p3a');
      const adv = { pts: sum('pts'), fgm, fga, fg3m: sum('p3m'), fg3a: sum('p3a'), ftm: sum('ftm'), fta: sum('fta'),
        oreb: sum('or'), dreb: sum('dr'), ast: sum('ast'), stl: sum('stl'), blk: sum('blk'), tov: sum('to'),
        minutes: 200, possessions: fga + 0.44 * sum('fta') + sum('to') - sum('or'),
        rimA: sum('rimA'), rimM: sum('rimM'), midA: sum('midA'), midM: sum('midM') };
      const line = { game_id: gid, team_idx: side, stats: { adv, pts: adv.pts, paint: 20, fast: 6, sc: 8, pot: 9, bench: 15, foulTot: sum('pf'),
        sit: g === 0 ? { v: 1, all: [20, 8, 18, 3, 9, 4, 6, 3, 6, 1, 2, 3, 30] } : undefined } };
      if (line.stats.sit === undefined) delete line.stats.sit;
      return { rows, side: line };
    });
    games.push({ id: gid, competition_id: comp, status: 'final', home_team_id: T[0], away_team_id: T[1],
      home_score: box[0].side.stats.pts, away_score: box[1].side.stats.pts, tipoff_at: '2026-09-0' + (g + 1) + 'T19:00:00Z' });
    box.forEach(b => { pgs.push(...b.rows); tgs.push(b.side); });
  }
  const teams = T.map((id, i) => ({ id, league_id: lid, name: tag.toUpperCase() + ' Club ' + i, short_name: 'LEI', slug: tag + '-' + i, colour: '#0' + i + '0', logo_path: null }));
  const seasons = [
    { id: oldSeason, league_id: lid, name: '2025-26', starts_on: '2025-09-01', competitions: [{ id: 'c-' + tag + '-old', name: 'old', kind: 'league' }] },
    { id: season, league_id: lid, name: '2026-27', starts_on: '2026-09-01', competitions: [{ id: comp, name: 'League', kind: 'league' }] }
  ];
  return { lid, tag, games, pgs, tgs, teams, seasons, squads };
}

const W1 = buildLeague(L1, 'bcb', { side: 0, slot: 2 }, [{ side: 1, slot: 4, id: P_MINOR }]);
const W2 = buildLeague(L2, 'slbw', { side: 1, slot: 0 });
const W3 = buildLeague(L3, 'mem', null);
const WORLD = [W1, W2, W3];

const allPlayers = new Set();
WORLD.forEach(w => w.squads.flat().forEach(p => allPlayers.add(p)));
const PLAYERS = [...allPlayers].filter(p => p !== P_MINOR).map(id => ({
  id, first_name: id === P_SHARED ? 'Sam' : 'First', last_name: id === P_SHARED ? 'Shared' : id, slug: id.toLowerCase(), photo_url: null }));
/* rosters: the shared player's only active entry is with the L2 club -- so a row
   that took its team from the roster would be wrong in L1 */
const ROSTERS = [];
WORLD.forEach(w => w.squads.forEach((sq, side) => sq.forEach((pid, i) => {
  if (pid === P_SHARED && w !== W2) return;
  const t = w.teams[side];
  ROSTERS.push({ player_id: pid, jersey: String(i + 4), position: i < 2 ? 'G' : i < 4 ? 'F' : 'C', active: true,
    teams: { id: t.id, name: t.name, short_name: t.short_name, slug: t.slug, colour: t.colour, logo_path: null } });
})));

/* ---- a fake PostgREST: the filters and selects the pages use, nothing more ---- */
const inList = (q, key) => { const m = new RegExp('(?:^|&)' + key + '=in\\.\\(([^)]*)\\)').exec(q); return m ? m[1].split(',') : null; };
const eqOf = (q, key) => { const m = new RegExp('(?:^|&)' + key + '=eq\\.([^&]*)').exec(q); return m ? decodeURIComponent(m[1]) : null; };
function selectRows(rows, select) {
  /* the JSON-path form "alias:stats->key"; anything else is taken as the row */
  const parts = select.split(',');
  if (!parts.some(p => p.includes('->'))) return rows;
  return rows.map(r => {
    const o = {};
    parts.forEach(p => {
      const m = /^(\w+):(\w+)->(\w+)$/.exec(p);
      if (m) { const v = r[m[2]] ? r[m[2]][m[3]] : undefined; o[m[1]] = v === undefined ? null : v; }
      else o[p] = r[p];
    });
    return o;
  });
}
const net = { calls: [], accessBodies: [], fail: new Set() };
function server(opts) {
  const o = opts || {};
  return async (url, init = {}) => {
    const u = String(url);
    net.calls.push({ url: u, headers: init.headers || {} });
    /* `total` is what PostgREST answers with when the caller sent Prefer: count=exact --
       "0-0/20" in the content-range. data.js's paged read and its season freshness token
       both read it, so a fake that always answered null could not exercise either. */
    const json = (status, body, total) => ({ ok: status >= 200 && status < 300, status,
      headers: { get: h => (String(h).toLowerCase() === 'content-range' && total != null)
        ? `0-${Math.max(0, (Array.isArray(body) ? body.length : 1) - 1)}/${total}` : null },
      json: async () => JSON.parse(JSON.stringify(body)) });
    const authed = (init.headers || {}).Authorization || '';
    if (u.includes('/rest/v1/rpc/access_state')) {
      const body = JSON.parse(init.body);
      net.accessBodies.push(body.p_leagues);
      if (o.accessDown) return json(503, { message: 'down' });
      const want = body.p_leagues || [];
      return json(200, {
        signed_in: !!authed, analytics_ok: true, subscriptions: 0, analytics_default: 'free', memberships_enabled: true,
        leagues: LEAGUES.filter(l => want.includes(l.id)).map(l => {
          const member = l.id === L3 && authed === 'Bearer tok-member';
          return { id: l.id, slug: l.slug, name: l.name, access_mode: l.access_mode, features: member ? ['league', 'analytics'] : [],
            analytics: l.id === L2 || l.id === L3 ? 'members' : 'free',
            can_view: l.access_mode === 'open' || member,
            analytics_ok: l.id === L1 || member || (l.id === L2 && !!o.l2Unlocked),
            fixtures_public: true, has_plans: false, has_league_plans: false };
        })
      });
    }
    const rest = u.split('/rest/v1/')[1];
    const [table, q] = [rest.split('?')[0], rest.split('?')[1] || ''];
    const select = decodeURIComponent((/(?:^|&)select=([^&]*)/.exec(q) || [])[1] || '');
    const lim = +((/(?:^|&)limit=(\d+)/.exec(q) || [])[1] || 1000);
    const page = rows => json(200, rows.slice(0, Math.min(lim, 1000)), rows.length);
    /* row-level security for the members-only league: its rows need the member */
    const visibleWorld = WORLD.filter(w => w !== W3 || authed === 'Bearer tok-member');
    if (net.fail.has(table)) return json(500, { message: 'boom' });
    if (table === 'leagues') return page(LEAGUES.slice().sort((a, b) => a.name.localeCompare(b.name)));
    if (table === 'seasons') {
      const ids = inList(q, 'league_id') || [];
      return page(WORLD.flatMap(w => w.seasons).filter(s => ids.includes(s.league_id))
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
    }
    if (table === 'games') {
      const ids = inList(q, 'competition_id') || [eqOf(q, 'competition_id')];
      return page(visibleWorld.flatMap(w => w.games).filter(g => ids.includes(g.competition_id)));
    }
    if (table === 'player_game_stats') {
      const ids = inList(q, 'game_id');
      return page(selectRows(visibleWorld.flatMap(w => w.pgs).filter(r => ids.includes(r.game_id)), select));
    }
    if (table === 'team_game_stats') {
      const ids = inList(q, 'game_id');
      return page(visibleWorld.flatMap(w => w.tgs).filter(r => ids.includes(r.game_id)));
    }
    if (table === 'teams') return page(WORLD.flatMap(w => w.teams).filter(t => t.league_id === eqOf(q, 'league_id')));
    if (table === 'players') { const ids = inList(q, 'id'); return page(PLAYERS.filter(p => ids.includes(p.id))); }
    if (table === 'roster_entries') { const ids = inList(q, 'player_id'); return page(ROSTERS.filter(r => ids.includes(r.player_id))); }
    return json(404, { message: 'no route ' + table });
  };
}
function fresh(opts) {
  A._test.reset(); A._test.deadline(4000); SS.clear(); LS.removeItem('epinoia_access_sim'); signOut();
  /* a clean browser has no season cached either -- data.js keeps a summed season in
     localStorage between visits (see seasonToken), and a test that means "first visit"
     has to start without one. A WARM reader deliberately survives a server failure that
     a cold one reports, so leaving these behind made the every-league-fails test pass
     for the wrong reason. */
  for (let i = LS.length - 1; i >= 0; i--) {
    const k = LS.key(i);
    if (k && k.indexOf('epinoia_season_v1:') === 0) LS.removeItem(k);
  }
  net.calls = []; net.accessBodies = []; net.fail = new Set();
  const f = server(opts);
  A._test.transport(f);
  globalThis.fetch = f;
}

/* ============================================================================ */
console.log('\npercentiles: the binary search ranks exactly as the walk did');
{
  /* the old walk, copied from season.js as it stood before this change */
  function walk(rows, keys, lowerIsBetter, groupOf) {
    const low = new Set(lowerIsBetter || []); const out = new Map(); const pools = new Map();
    rows.forEach(r => { const g = groupOf ? groupOf(r) : ''; if (g == null) return; if (!pools.has(g)) pools.set(g, []); pools.get(g).push(r); });
    keys.forEach(k => {
      const table = new Map();
      pools.forEach(pool => {
        const vals = pool.map(r => r[k]).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
        if (vals.length < 3) return;
        pool.forEach(r => {
          const v = r[k]; if (v == null || !isFinite(v)) return;
          let below = 0; for (let i = 0; i < vals.length; i++) if (vals[i] < v) below++; else break;
          let p = 100 * below / (vals.length - 1 || 1); if (low.has(k)) p = 100 - p;
          table.set(r.id, Math.max(0, Math.min(100, p)));
        });
      });
      if (table.size) out.set(k, table);
    });
    return out;
  }
  const flat = m => JSON.stringify([...m.entries()].map(([k, t]) => [k, [...t.entries()]]));
  const rnd = seeded(7);
  let same = true, cases = 0;
  for (let n of [0, 1, 2, 3, 4, 7, 50, 333]) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const pick = rnd();
      rows.push({ id: 'r' + i, lg: i % 3 === 0 ? 'x' : i % 3 === 1 ? 'y' : null,
        a: Math.round(rnd() * 10),                               /* heavy ties */
        b: pick < 0.1 ? null : pick < 0.15 ? NaN : pick < 0.2 ? Infinity : pick < 0.25 ? -0 : rnd() * 100 - 50,
        c: pick < 0.5 ? 0 : 1 });
    }
    for (const g of [null, r => r.lg]) {
      cases++;
      if (flat(Season.percentiles(rows, ['a', 'b', 'c'], ['b'], g)) !== flat(walk(rows, ['a', 'b', 'c'], ['b'], g))) same = false;
    }
  }
  ok('identical to the linear walk over ' + cases + ' pools (ties, nulls, NaN, Infinity, -0, low keys, groups)', same);
  const shared = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'season.js'), 'utf8');
  ok('the Edge copy carries the same search (run extract-shared.mjs)', /\(lo \+ hi\) >>> 1/.test(shared));
}

console.log('\nthe trimmed read: every key players() reads, and nothing lost');
{
  const src = fs.readFileSync(path.join(ROOT, 'epinoia', 'season.js'), 'utf8');
  const body = src.slice(src.indexOf('function players(pgs, tgs, meta)'), src.indexOf('function blankPlayer('));
  const read = [...new Set([...body.matchAll(/\bs\.(\w+)/g)].map(m => m[1]))].sort();
  const missing = read.filter(k => !D.PLAYER_STAT_KEYS.includes(k));
  ok('PLAYER_STAT_KEYS covers every s.<key> players() reads (' + read.length + ' keys)', read.length > 20 && missing.length === 0, 'missing ' + missing.join(', '));
  ok('and never asks for adv', !D.PLAYER_STAT_KEYS.includes('adv'));
  const slim = W1.pgs.map(r => D.untrim(Object.assign({ game_id: r.game_id, player_uuid: r.player_uuid, player_id: r.player_id, team_idx: r.team_idx },
    Object.fromEntries(D.PLAYER_STAT_KEYS.map(k => [k, r.stats[k] === undefined ? null : r.stats[k]])))));
  ok('an untrimmed row carries adv, the rebuilt one does not', !!W1.pgs[0].stats.adv && !('adv' in slim[0].stats));
  eq('players() over rebuilt rows equals players() over whole rows', canon(Season.players(slim, W1.tgs)), canon(Season.players(W1.pgs, W1.tgs)));
}

console.log('\ndata.js season({trim}) and playerMeta against the fake server');
{
  fresh();
  const whole = await D.season(['c-bcb'], { trim: false });
  const wholeCalls = net.calls.filter(c => c.url.includes('player_game_stats'));
  const slim = await D.season(['c-bcb'], { trim: true });
  const slimCalls = net.calls.filter(c => c.url.includes('player_game_stats')).slice(wholeCalls.length);
  ok('untrimmed asks for stats whole', wholeCalls.every(c => /select=game_id,player_uuid,player_id,team_idx,stats(&|$)/.test(c.url)));
  ok('trimmed asks by JSON path and never for adv', slimCalls.length > 0 && slimCalls.every(c => /pts:stats->pts/.test(c.url) && !/adv/.test(c.url)));
  ok('team rows are read whole either way (teamLine needs their adv)',
    net.calls.filter(c => c.url.includes('team_game_stats')).every(c => /select=game_id,team_idx,stats/.test(c.url)));
  eq('the season rows are identical', canon(slim.players), canon(whole.players));
  eq('and the team rows', canon(slim.teams), canon(whole.teams));
  const plain = await D.season(['c-bcb']);
  eq('season(ids) with no options is the untrimmed read, as the Statistics page calls it', canon(plain.players), canon(whole.players));
}

console.log('\ndata.js season({rows:false}): the line without the rows, and kept between visits');
{
  /* the stub mirrors the DOM API (length + key(i)), which is what data.js itself walks */
  const seasonKeys = () => Array.from({ length: LS.length }, (_, i) => LS.key(i))
    .filter(k => k && k.startsWith('epinoia_season_v1:'));
  const clearSeasonCache = () => seasonKeys().forEach(k => LS.removeItem(k));

  fresh(); clearSeasonCache();
  const withRows = await D.season(['c-bcb'], { trim: true });
  fresh(); clearSeasonCache();
  const noRows = await D.season(['c-bcb'], { trim: true, rows: false });

  ok('rows are kept by default — the injury report reads season().pgs game by game',
     Array.isArray(withRows.pgs) && withRows.pgs.length > 0 && Array.isArray(withRows.tgs));
  ok('rows: false hands back no pgs/tgs at all, so they can be collected',
     !('pgs' in noRows) && !('tgs' in noRows));
  eq('...and the season line is the same either way', canon(noRows.players), canon(withRows.players));
  eq('...including the team rows', canon(noRows.teams), canon(withRows.teams));

  /* the visit after this one */
  net.calls = [];
  const again = await D.season(['c-bcb'], { trim: true, rows: false });
  const box = net.calls.filter(c => /player_game_stats|team_game_stats/.test(c.url));
  eq('a second read of an unchanged season asks for no box score rows at all', box.length, 0);
  ok('...it spends one small request checking the season has not moved',
     net.calls.length === 1 && /finalised_at/.test(net.calls[0].url) && /limit=1/.test(net.calls[0].url),
     net.calls.map(c => c.url).join('\n'));
  eq('...and answers with the same season line', canon(again.players), canon(noRows.players));
  ok('...rebuilt whole: byId and teamOfPlayer come back too',
     !!again.byId && Object.keys(again.byId).length === again.games.length
     && again.teamOfPlayer instanceof Map && again.teamOfPlayer.size === noRows.teamOfPlayer.size);

  /* a game finalised since moves the token, and the cache misses */
  const bumped = W1.games[0].finalised_at;
  W1.games[0].finalised_at = '2099-01-01T00:00:00Z';
  net.calls = [];
  const after = await D.season(['c-bcb'], { trim: true, rows: false });
  ok('a game finalised since is a different season, and it is read again',
     net.calls.some(c => /player_game_stats/.test(c.url)));
  eq('...to the same numbers, the world being otherwise unchanged', canon(after.players), canon(noRows.players));
  W1.games[0].finalised_at = bumped;

  /* nothing is cached for the callers that take the rows: there is no room for them */
  clearSeasonCache();
  fresh();
  await D.season(['c-bcb'], { trim: true });
  ok('a rows-keeping read caches nothing', seasonKeys().length === 0);
  clearSeasonCache();

  /* A FULL localStorage drops the season read longest ago, not every season. Nineteen
     leagues cached is exactly when a quota bites, and evicting the lot to fit one would
     make every visit throw away the last one's work. */
  {
    fresh();
    const realSet = LS.setItem;
    let budget = 0;                       // 0 = refuse everything, then allow after eviction
    LS.setItem = function (k, v) {
      if (String(k).startsWith('epinoia_season_v1:') && budget <= 0) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      if (String(k).startsWith('epinoia_season_v1:')) budget--;
      return realSet.call(LS, k, v);
    };
    realSet.call(LS, 'epinoia_season_v1:old-a', JSON.stringify({ tok: 'x', at: 1000, data: {} }));
    realSet.call(LS, 'epinoia_season_v1:old-b', JSON.stringify({ tok: 'x', at: 9000, data: {} }));
    budget = 1;                           // room appears once ONE old season is dropped
    let refusals = 0;
    LS.setItem = function (k, v) {
      if (String(k).startsWith('epinoia_season_v1:') && k !== 'epinoia_season_v1:old-a' && k !== 'epinoia_season_v1:old-b') {
        if (!LS.getItem('epinoia_season_v1:old-a')) return realSet.call(LS, k, v);   // the oldest went: it fits
        refusals++; const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
      }
      return realSet.call(LS, k, v);
    };
    await D.season(['c-bcb'], { trim: true, rows: false });
    LS.setItem = realSet;
    ok('the season read longest ago is the one dropped', !LS.getItem('epinoia_season_v1:old-a'));
    ok('...and a newer one is kept', !!LS.getItem('epinoia_season_v1:old-b'));
    ok('...and this season is stored once room is made',
       !!LS.getItem('epinoia_season_v1:c-bcb') && refusals > 0, 'refusals=' + refusals);
    clearSeasonCache();
  }

  const ids = [...allPlayers];
  fresh();
  const meta = await D.playerMeta(ids.concat(Array.from({ length: 85 }, (_, i) => uid('nobody-' + i))));
  ok('playerMeta: the withheld player has no entry, the others do', !meta[P_MINOR] && ids.filter(p => p !== P_MINOR).every(p => meta[p] && meta[p].name));
  ok('playerMeta: chunks of 40 (3 chunks, 6 requests)', net.calls.length === 6, String(net.calls.length));
}

console.log('\nloadMany: one request for many leagues, cached, shared, never rejects');
{
  fresh();
  const m = await A.loadMany({ leagueIds: [L1, L2, L3, L1, '', null] });
  eq('one access_state request with the list', net.accessBodies, [[L1, L2, L3]]);
  eq('a Map in the order asked, duplicates and blanks dropped', [...m.keys()], [L1, L2, L3]);
  ok('each state is the league\'s own answer', m.get(L1).analyticsOk === true && m.get(L2).analyticsOk === false && m.get(L3).canView === false && m.get(L3).known);
  ok('and the sync answers agree', A.analyticsOk(L2) === false && A.canView(L3) === false && A.canView(L1) === true);
  await A.loadMany({ leagueIds: [L1, L2] });
  await A.load({ leagueId: L3 });
  eq('asked again (loadMany or load): no new request', net.accessBodies.length, 1);

  fresh();
  const [single, many] = await Promise.all([A.load({ leagueId: L2 }), A.loadMany({ leagueIds: [L1, L2] })]);
  ok('a league load() is already asking about is waited for, not asked twice',
    net.accessBodies.length === 2 && JSON.stringify(net.accessBodies).split(L2).length === 2 && many.get(L2).analyticsOk === single.analyticsOk);

  fresh();
  const ids = Array.from({ length: 120 }, (_, i) => 'lg-' + i);
  const big = await A.loadMany({ leagueIds: ids });
  eq('120 leagues go out as 50 + 50 + 20', net.accessBodies.map(b => b.length), [50, 50, 20]);
  ok('a league the server leaves out is unknown and fails open', big.size === 120 && !big.get('lg-3').known && A.analyticsOk('lg-3') && A.canView('lg-3'));

  fresh({ accessDown: true });
  let threw = false, down;
  try { down = await A.loadMany({ leagueIds: [L1, L2] }); } catch (_) { threw = true; }
  ok('a 503 does not reject, and every league fails open', !threw && down.size === 2 && [...down.values()].every(s => !s.known && s.analyticsOk && s.canView));

  fresh();
  eq('no ids: an empty Map and no request', [(await A.loadMany({ leagueIds: [] })).size, net.accessBodies.length], [0, 0]);
}

console.log('\nlockedColumns: one locked league locks the paid columns for the page');
{
  const premium = Table.PLAYER_COLS.map(c => c.k).filter(k => A.isPremiumColumn(k));
  const open = { known: true, canView: true, analyticsOk: true };
  const locked = { known: true, canView: true, analyticsOk: false };
  const closed = { known: true, canView: false, analyticsOk: false };
  ok('the player table has premium columns to lock', premium.length > 10, String(premium.length));
  eq('every league open: nothing locked', G.lockedColumns(new Map([[L1, open], [L2, open]])).size, 0);
  const set = G.lockedColumns(new Map([[L1, open], [L2, locked]]));
  ok('one league locked: exactly the premium columns', set.size === premium.length && premium.every(k => set.has(k)) && !set.has('ppg') && !set.has('gp'));
  eq('a league this viewer cannot see (not on the page) locks nothing', G.lockedColumns([open, closed]).size, 0);
  eq('no states (access.js failed): fail open', G.lockedColumns(null).size, 0);
  eq('given keys are filtered the same way', [...G.lockedColumns({ a: locked }, ['ppg', 'ev_all_ppg', 'z_rim_pct', 'morey'])], ['ev_all_ppg', 'z_rim_pct', 'morey']);
}

console.log('\nleague short names and the qualified rule');
{
  eq('BCB, SLB M, SLB W', [G.leagueShort({ name: 'British Championship Basketball' }), G.leagueShort({ name: 'Super League Basketball Men' }),
    G.leagueShort({ name: 'Super League Basketball Women' })], ['BCB', 'SLB M', 'SLB W']);
  eq('the league\'s own initials win', G.leagueShort({ name: 'Super League Basketball Women', initials: 'wbbl' }), 'WBBL');
  eq('a derived acronym never lands on one of the refused ones', G.leagueShort({ name: 'Epinoia Demo League' }), 'EP');
  eq('teamGp 9: gp >= 3 and min >= 45', [G.qualifies({ gp: 3, min: 45 }, 9), G.qualifies({ gp: 2, min: 90 }, 9), G.qualifies({ gp: 3, min: 44.9 }, 9)], [true, false, false]);
  eq('teamGp 3: gp >= 1 and min >= 30 (the floor)', [G.qualifies({ gp: 1, min: 30 }, 3), G.qualifies({ gp: 1, min: 29 }, 3)], [true, false]);
}

console.log('\nplayers(): every visible league, merged, as an anonymous viewer');
{
  fresh();
  const arrivals = [];
  let announced = null;
  const out = await G.players({
    onAccess: (access, leagues, excluded) => { announced = { access, leagues: leagues.map(l => l.short), excluded: excluded.length,
      arrivedBefore: arrivals.length, statCallsBefore: net.calls.filter(c => /player_game_stats/.test(c.url)).length }; },
    onLeague: (rows, L) => arrivals.push([L.short, rows.length]) });
  ok('onAccess comes once, with every included league and the access map, before any row is read or handed over',
     announced && announced.access instanceof Map && announced.arrivedBefore === 0 && announced.statCallsBefore === 0 &&
     JSON.stringify(announced.leagues) === JSON.stringify(['BCB', 'SLB W']) && announced.excluded === 1, JSON.stringify(announced));
  const first = net.calls.findIndex(c => /player_game_stats|games\?/.test(c.url));
  const accessAt = net.calls.findIndex(c => c.url.includes('access_state'));
  ok('access is asked (once, for every league) before any game or stat is read', accessAt !== -1 && accessAt < first && net.accessBodies.length === 1 && net.accessBodies[0].length === 3);
  eq('the members-only league is excluded and said to be', out.excluded, [{ id: L3, name: 'Members Cup', reason: 'members' }]);
  ok('none of its rows were asked for', !net.calls.some(c => c.url.includes('c-mem')));
  eq('included leagues, newest season each', out.leagues.map(l => [l.short, l.seasonName, l.competitionIds]), [['BCB', '2026-27', ['c-bcb']], ['SLB W', '2026-27', ['c-slbw']]]);
  eq('onLeague once per league, with its rows', arrivals.map(a => a[0]).sort(), ['BCB', 'SLB W']);
  eq('onLeague rows add up to the total', arrivals.reduce((a, x) => a + x[1], 0), out.rows.length);

  const ids = out.rows.map(r => r.id);
  ok('ids are unique across leagues', new Set(ids).size === ids.length && ids.every(id => /^aaaaaaaa-0000-0000-0000-00000000000[12]:/.test(id)));
  const shared = out.rows.filter(r => r.playerId === P_SHARED);
  eq('the same player in two leagues is two rows', shared.map(r => [r.id, r.leagueShort]), [[L1 + ':' + P_SHARED, 'BCB'], [L2 + ':' + P_SHARED, 'SLB W']]);
  const s1 = shared[0], s2 = shared[1];
  const onlyL1 = Season.players(W1.pgs, W1.tgs).find(p => p.id === P_SHARED);
  ok('...each with only its own league\'s games (not blended)', s1.pts === onlyL1.pts && s1.gp === 3 && s1.pts !== s2.pts);
  ok('...the team from the games, named from that league\'s teams, not the roster', s1.teamId === 't-bcb-home' && s1.teamFull === 'BCB Club 0' && s2.teamId === 't-slbw-away');
  ok('...the jersey only where the roster entry is for that club', s1.jersey === '' && s2.jersey === '4');
  ok('...and the person the same in both', s1.name === 'Sam Shared' && s2.name === 'Sam Shared' && s1.playerId === s2.playerId);
  ok('the withheld minor is dropped', !out.rows.some(r => r.playerId === P_MINOR) && out.rows.filter(r => r.leagueId === L1).length === 11);
  ok('every row names its league', out.rows.every(r => r.leagueId && r.leagueSlug && r.leagueName && r.leagueShort));
  ok('qualified follows the rule on every row', out.rows.every(r => r.qualified === G.qualifies(r, r.teamGp)) && out.rows.some(r => r.qualified) && out.rows.every(r => r.teamGp === 3));
  ok('BPM is attached per league', out.rows.every(r => typeof r.bpm === 'number'));

  /* ranked within league, by the composite id: the shared player keeps two ranks */
  const pct = Season.percentiles(out.rows, ['ppg'], [], r => r.leagueId);
  const own = lid => Season.percentiles(out.rows.filter(r => r.leagueId === lid), ['ppg'], []);
  ok('within-league percentiles: each of his rows ranks against its own league only',
    pct.get('ppg').get(s1.id) === own(L1).get('ppg').get(s1.id) && pct.get('ppg').get(s2.id) === own(L2).get('ppg').get(s2.id) && pct.get('ppg').size === out.rows.length);
  const posAll = new Map();
  [L1, L2].forEach(lid => Season.positionGroups(out.rows.filter(r => r.leagueId === lid)).forEach((g, id) => posAll.set(id, g)));
  ok('position groups per league keep a group for both of his rows', posAll.has(s1.id) && posAll.has(s2.id) && posAll.size === out.rows.length);

  const slimCalls = net.calls.filter(c => c.url.includes('player_game_stats'));
  fresh();
  const whole = await G.players({ trim: false });
  eq('identical rows with and without stats->adv on player rows', canon(whole.rows), canon(out.rows));
  ok('(the default read was the trimmed one, the other the whole row)',
    slimCalls.length > 0 && slimCalls.every(c => /pts:stats->pts/.test(c.url)) &&
    net.calls.filter(c => c.url.includes('player_game_stats')).every(c => /team_idx,stats(&|$)/.test(c.url)));
  eq('lockedColumns over the answer: SLB W locks analytics, so the page does',
    G.lockedColumns(out.access).size, Table.PLAYER_COLS.filter(c => A.isPremiumColumn(c.k)).length);
}

console.log('\nplayers(): a member of the members-only league');
{
  fresh();
  signIn('member');                                    /* token tok-member */
  const out = await G.players({});
  eq('nothing excluded', out.excluded, []);
  ok('their league\'s rows arrive, because its reads carried the token', out.rows.some(r => r.leagueId === L3) &&
    net.calls.filter(c => c.url.includes('player_game_stats')).some(c => c.headers.Authorization === 'Bearer tok-member'));
  signOut();
}

console.log('\nplayers(): failures and cancelling');
{
  fresh();
  const ac = new AbortController();
  let calls = 0, err = null;
  const p = G.players({ signal: ac.signal, onLeague: () => { calls++; } });
  ac.abort();
  try { await p; } catch (e) { err = e; }
  ok('an aborted signal rejects with an AbortError and draws nothing', err && err.name === 'AbortError' && calls === 0, err && err.name);

  fresh();
  net.fail.add('team_game_stats');
  let threw = null;
  try { await G.players({}); } catch (e) { threw = e; }
  ok('every league failing rejects, so the page can say so', !!threw && /Could not load/.test(threw.message));

  fresh();
  const realServer = globalThis.fetch;
  globalThis.fetch = (u, i) => (String(u).includes('c-slbw') ? Promise.resolve({ ok: false, status: 400, headers: { get: () => null }, json: async () => ({}) }) : realServer(u, i));
  const part = await G.players({});
  ok('one league failing leaves the others, and names the failure',
    part.failed.length === 1 && part.failed[0].id === L2 && part.rows.length === 11 && part.rows.every(r => r.leagueId === L1));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
