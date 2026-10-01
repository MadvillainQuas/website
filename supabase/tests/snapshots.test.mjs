/* ============================================================================
   Pages read a snapshot only when it is current, and work it out themselves
   otherwise (migrations 0152 and 0153, supabase/functions/snapshots).

     node supabase/tests/snapshots.test.mjs

   data.js season(): a season's lines from its file on the CDN,
   snapshots/season/<ids>/<token>.json, named by the token the page just read
   from the database (then kept for the next visit); the rows read and summed
   exactly as before when there is no such file (not built yet, or built from
   an older token), and never for the snapshots function itself (snapshot:false).
   A season merged across competitions is looked up by its sorted ids. A file
   is packed (data.js packSeason: the rows as columns), and its name carries the
   version of the line that summed it (season.js version()): a file summed by other
   code - the layout before (v2), or a function deployed before a statistic existed -
   is never read, and the rows are summed instead. The packing gives back exactly the
   rows it was given.

   stars.js global(): HOME's podiums from the 'stars_global' row when it was
   built from the same anchor, every league on it is one the reader can see, and
   the reader is signed out; the month of box scores read and summed otherwise.
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); }
};

function memStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
           removeItem: k => { m.delete(k); }, clear: () => m.clear(),
           key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const LS = memStore(), SS = memStore();
Object.defineProperty(globalThis, 'localStorage', { value: LS, configurable: true, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: SS, configurable: true, writable: true });
globalThis.window = globalThis;
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://abcref.supabase.co', supabaseAnonKey: 'sb_publishable_test' };
globalThis.EpinoiaBPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
const D = require(path.join(ROOT, 'epinoia', 'data.js'));
globalThis.EpinoiaData = D;
const ST = require(path.join(ROOT, 'epinoia', 'stars.js'));

/* ---- a fake Supabase: every request recorded, answers set per test ---- */
const calls = [];
let routes = {};                        // PostgREST table -> rows, or a function of the query
let files = {};                         // Storage path under snapshots/ -> JSON body
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  calls.push(u);
  const sp = u.split('/storage/v1/object/public/snapshots/')[1];
  if (sp !== undefined) {
    const body = files[sp];
    return body === undefined
      ? { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: 'not found' }) }
      : { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(body)) };
  }
  const rest = u.split('/rest/v1/')[1] || '';
  const table = rest.split('?')[0];
  const r = typeof routes[table] === 'function' ? routes[table](rest) : routes[table];
  if (r === undefined) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'no ' + table }) };
  const { body, total } = Array.isArray(r) ? { body: r, total: r.length } : r;
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)),
           headers: { get: h => (String(h).toLowerCase() === 'content-range' ? `0-${Math.max(0, body.length - 1)}/${total}` : null) } };
};
const reset = () => { calls.length = 0; LS.clear(); SS.clear(); files = {}; };
const asked = re => calls.filter(u => re.test(u));

/* ------------------------------------------------------- the packed layout --- */
console.log('\ndata.js packSeason: the rows as columns, and exactly the rows back');
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const wire = x => JSON.parse(JSON.stringify(x));
  const rows = [{ a: 1, b: 'x', c: null, d: [1, 2], e: { f: 1 } }, { a: 2, c: 3 }, { a: 3, b: undefined, c: 0, d: [], e: null }];
  const p = D.pack(rows);
  ok('the names once, the values in their order', same(p.k, ['a', 'b', 'c', 'd', 'e']) && same(p.v[0], [1, 'x', null, [1, 2], { f: 1 }]), p);
  const back = D.unpack(wire(p));
  ok('back as the same rows: a null stays a null, a key a row did not have (or held undefined) stays missing, and the key order holds',
     same(back, wire(rows)) && !('b' in back[1]) && !('b' in back[2]) && back[0].c === null && same(Object.keys(back[1]), ['a', 'c']), back);
  ok('rows whose keys come in different orders are not packed, and stay rows', Array.isArray(D.pack([{ a: 1, b: 2 }, { b: 3, a: 4 }])));
  ok('no rows: nothing, both ways; rows already rows pass through', same(D.unpack(D.pack([])), []) && D.unpack(rows) === rows && same(D.unpack(null), []));
  const m = { 'id-1': { name: 'A', n: 1 }, 'id-2': { name: 'B' } };
  ok('an object of rows by id the same way, and the one from before as it is', same(D.unpackMap(wire(D.packMap(m))), m) && D.unpackMap(m) === m);

  /* A SEASON THROUGH THE REAL MATHS: four clubs, six games, some with the events splits and some without,
     on-court blocks, and a player on every sheet who never got on the floor (no BPM: the keys are missing) */
  const S = globalThis.EpinoiaSeason;
  let seed = 11;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * n); };
  const games = [], pgs = [], tgs = [], teamOfPlayer = new Map(), meta = {};
  const clubs = ['ta', 'tb', 'tc', 'td'];
  const pairs = [['ta', 'tb'], ['tc', 'td'], ['ta', 'tc'], ['tb', 'td'], ['ta', 'td'], ['tb', 'tc']];
  const sitOf = () => ({ v: 1, all: Array.from({ length: 13 }, () => rnd(9)), second: [rnd(5), rnd(3), rnd(4)], transition: [rnd(6), rnd(3), rnd(5)],
                         ast: [rnd(4), rnd(8), rnd(2)], unast: [rnd(3), rnd(6)], ftAst: rnd(2) });
  pairs.forEach(([h, a], gi) => {
    const id = 'g' + gi, covered = gi % 2 === 0;
    games.push({ id, home_team_id: h, away_team_id: a, home_score: 70 + rnd(30), away_score: 70 + rnd(30), tipoff_at: '2026-09-0' + (gi + 1) + 'T18:00:00Z' });
    [h, a].forEach((club, side) => {
      const adv = { pts: 70 + rnd(30), fgm: 25 + rnd(10), fga: 60 + rnd(15), fg3m: 7 + rnd(6), fg3a: 20 + rnd(10), ftm: 10 + rnd(8), fta: 15 + rnd(8),
                    oreb: 8 + rnd(6), dreb: 22 + rnd(8), ast: 12 + rnd(10), stl: 5 + rnd(5), blk: 2 + rnd(4), tov: 10 + rnd(8), minutes: 200,
                    possessions: 70 + rnd(8), rimA: 20 + rnd(8), rimM: 12 + rnd(5), midA: 10 + rnd(6), midM: 4 + rnd(4) };
      tgs.push({ game_id: id, team_idx: side, stats: { adv, paint: 30 + rnd(10), fast: rnd(15), sc: rnd(12), pot: rnd(15), bench: rnd(30), foulTot: 15 + rnd(8),
                                                        sit: covered ? sitOf() : undefined } });
      for (let k = 0; k < 9; k++) {
        const pid = club + '-p' + k, min = k === 8 ? 0 : (8 + rnd(28)) * 60000;
        teamOfPlayer.set(pid, club);
        meta[pid] = { name: 'Player ' + pid, jersey: String(k), teamId: club, teamLogo: null };
        pgs.push({ game_id: id, player_uuid: pid, team_idx: side, stats: {
          min, pts: rnd(25), p2m: rnd(6), p2a: 6 + rnd(6), p3m: rnd(4), p3a: 3 + rnd(5), ftm: rnd(5), fta: 5 + rnd(3), or: rnd(4), dr: rnd(8),
          ast: rnd(8), stl: rnd(3), blk: rnd(3), to: rnd(4), pf: rnd(5), fd: rnd(5), pm: rnd(20) - 10, rimA: rnd(5), rimM: rnd(3), midA: rnd(4), midM: rnd(2),
          oc: { tFGA: 40 + rnd(10), tFGM: 18 + rnd(6), t3M: 4 + rnd(4), tFTA: 8 + rnd(6), tTOV: 6 + rnd(4), tOR: 4 + rnd(4), tDR: 14 + rnd(6), tPTS: 50 + rnd(20),
                oFGA: 40 + rnd(10), oFGM: 17 + rnd(6), o3M: 4 + rnd(4), oFTA: 8 + rnd(6), oTOV: 6 + rnd(4), oOR: 4 + rnd(4), oDR: 14 + rnd(6), oPTS: 48 + rnd(20) },
          sit: covered && k < 6 ? sitOf() : undefined } });
      }
    });
  });
  const byId = {}; games.forEach(g => { byId[g.id] = g; });
  const players = S.players(pgs, tgs), teams = S.teams(tgs, byId);
  S.attachBPM(players, teams, teamOfPlayer);
  const season = { games, players, teams, teamOfPlayer, meta };
  const rowsFile = JSON.stringify({ games, players, teams, teamOfPlayer: [...teamOfPlayer], meta });
  const packedFile = JSON.stringify(D.packSeason(season));
  const again = D.unpackSeason(JSON.parse(packedFile));
  const benchman = players.find(x => x.id === 'ta-p8');
  ok('a generated season (' + players.length + ' players of ' + Object.keys(players[0]).length + ' numbers, ' + teams.length + ' clubs) comes back exactly: every value and every key in its order',
     same(again.players, wire(players)) && same(again.teams, wire(teams)) && same(again.games, games) && same(again.meta, meta) &&
     same([...again.teamOfPlayer], [...teamOfPlayer]) && again.byId.g3 === again.games[3]);
  ok('...the man who never played has no BPM before, and none after (missing, not null)', benchman && !('bpm' in benchman) &&
     !('bpm' in again.players.find(x => x.id === 'ta-p8')) && 'bpm' in again.players.find(x => x.id === 'ta-p0'));
  ok('...in under half the room (' + Math.round(packedFile.length / 1024) + ' KB against ' + Math.round(rowsFile.length / 1024) + ' KB)', packedFile.length < 0.5 * rowsFile.length);
}

/* ---------------------------------------------------------------- seasons --- */
console.log('\ndata.js season(): the file named by the current token, the rows when there is none');
const SNAP = { games: [{ id: 'g1', home_team_id: 't1', away_team_id: 't2', home_score: 80, away_score: 70, tipoff_at: '2026-09-01T18:00:00Z' }],
               players: [{ id: 'p1', gp: 1, pts: 20 }], teams: [{ id: 't1', gp: 1 }], teamOfPlayer: [['p1', 't1']] };
const T1 = '1@2026-09-02T00:00:00+00:00';
const VER = globalThis.EpinoiaSeason.version();     // which code sums the line (season.js)
const F1 = 'v3-' + VER + '-1-2026-09-02T00-00-00-00-00.json';   // layout 3, the line's version, the token (data.js snapFile, which the function calls)
const F2 = 'v2-1-2026-09-02T00-00-00-00-00.json';   // the layout before, written by a function deployed before
const F0 = 'v3-1-2026-09-02T00-00-00-00-00.json';   // this layout, from code that put no version in the name
const KEY = c => 'epinoia_season_v3:' + VER + ':' + c;   // this browser's copy
ok('the file is named by layout, then the line\'s version, then the token', D.snapFile(T1) === F1 && /^s\d+\.[0-9a-f]{8}$/.test(VER), D.snapFile(T1));
const PACKED = D.packSeason(SNAP);
const tokenRoute = (fin) => rest => (/finalised_at/.test(rest) && /limit=1/.test(rest)
  ? { body: [{ id: 'g1', finalised_at: fin }], total: 1 }
  : { body: [], total: 0 });                // the season's games: none, so a fallback read ends at once
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1/' + F1] = { token: T1, data: PACKED };
  const s = await D.season('c1', { trim: true, rows: false });
  ok('the file named by the current token is the season, unpacked', s.players.length === 1 && s.players[0].id === 'p1' && s.players[0].pts === 20 &&
     s.teams[0].id === 't1' && s.games[0].id === 'g1', s.players);
  ok('...rebuilt whole: byId and teamOfPlayer as a Map', s.byId.g1 && s.teamOfPlayer instanceof Map && s.teamOfPlayer.get('p1') === 't1');
  ok('...two requests, the token from the database and the file from the CDN, and no box scores',
     calls.length === 2 && asked(new RegExp('/storage/v1/object/public/snapshots/season/c1/' + F1.replace(/\./g, '\\.') + '$')).length === 1 &&
     !asked(/player_game_stats|team_game_stats/).length, calls);
  calls.length = 0;
  const again = await D.season('c1', { trim: true, rows: false });
  ok('kept for the next visit: one request, the token', calls.length === 1 && again.players[0].id === 'p1' && again.players[0].pts === 20, calls);
  const kept = JSON.parse(LS.getItem(KEY('c1')));
  ok('...kept packed, as columns', kept && kept.data && Array.isArray(kept.data.players.k) && kept.data.players.v[0][kept.data.players.k.indexOf('pts')] === 20,
     kept && kept.data && kept.data.players);
}
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1/' + F2] = { token: T1, data: SNAP };              // written by the function as deployed before
  files['season/c1/' + F0] = { token: T1, data: PACKED };            // ...and in this layout, by code that named no version
  const s = await D.season('c1', { trim: true, rows: false });
  ok('a file summed by other code is never the season: neither the layout before nor a name without this line\'s version is asked for, ' +
     'and the season is summed from the rows instead',
     !asked(/\/v2-1-/).length && !asked(new RegExp('/' + F0.replace(/\./g, '\\.') + '$')).length && asked(/select=id,home_team_id/).length === 1 &&
     s.players.length === 0, calls);
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  LS.setItem('epinoia_season_v1:c9', JSON.stringify({ tok: 'x', at: Date.now(), data: SNAP }));
  LS.setItem('epinoia_season_v2:c8', JSON.stringify({ tok: 'x', at: Date.now(), data: SNAP }));
  LS.setItem('epinoia_season_v3:s0.00000000:c7', JSON.stringify({ tok: 'x', at: Date.now(), data: SNAP }));   // other code's line
  LS.setItem('someone_else', '1');
  LS.setItem('epinoia_season_view', 'screenshot');                    // the player page's own setting, not a copy
  files['season/c1/' + F1] = { token: T1, data: PACKED };
  await D.season('c1', { trim: true, rows: false });
  ok('the copies an older layout or other code kept are thrown away on the first write, and nothing else is',
     LS.getItem('epinoia_season_v1:c9') === null && LS.getItem('epinoia_season_v2:c8') === null &&
     LS.getItem('epinoia_season_v3:s0.00000000:c7') === null &&
     LS.getItem('someone_else') === '1' && LS.getItem('epinoia_season_view') === 'screenshot' &&
     !!LS.getItem(KEY('c1')));
}
{
  reset();
  routes = { games: tokenRoute('2026-09-03T00:00:00+00:00') };        // a game finalised since
  files['season/c1/' + F1] = { token: T1, data: SNAP };
  const s = await D.season('c1', { trim: true, rows: false });
  ok('a newer token names a file that is not there yet: the season is read',
     asked(/select=id,home_team_id/).length === 1 && s.players.length === 0, calls);
}
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1/' + F1] = { token: '9@elsewhere', data: SNAP };   // a file whose own token disagrees
  const s = await D.season('c1', { trim: true, rows: false });
  ok('a file whose own token is not the one read is not used', asked(/select=id,home_team_id/).length === 1 && s.players.length === 0, calls);
}
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1/' + F1] = { token: T1, data: PACKED };
  await D.season('c1', { trim: true, rows: false, snapshot: false });
  ok('snapshot:false (the function building it) never reads a file', !asked(/storage\/v1/).length, calls);
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1,c2/' + F1] = { token: T1, data: PACKED };
  const m = await D.season(['c2', 'c1'], { trim: true, rows: false });
  ok('a season merged across competitions has its own file, under the sorted ids',
     asked(/snapshots\/season\/c1,c2\//).length === 1 && m.players[0].id === 'p1' && !asked(/player_game_stats/).length, calls);
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  await D.season('c1', { trim: true });
  ok('a read that keeps the rows reads the rows', !asked(/storage\/v1/).length && asked(/select=id,home_team_id/).length === 1, calls);
}

{
  /* THE NAMES RIDE WITH THE SEASON: a file's meta seeds playerMeta(), which then asks only for
     the players the file did not name */
  reset();
  routes = {
    games: tokenRoute('2026-09-02T00:00:00+00:00'),
    players: rest => [{ id: '00000000-0000-4000-8000-000000000002', first_name: 'Fresh', last_name: 'Read', slug: 'fresh-read', photo_url: null }],
    roster_entries: []
  };
  const P1 = '00000000-0000-4000-8000-000000000001', P2 = '00000000-0000-4000-8000-000000000002';
  files['season/c7/' + F1] = { token: T1, data: Object.assign({}, SNAP, {
    meta: { [P1]: { name: 'From The File', slug: 'from-the-file', photo_url: null, jersey: '9', position: 'G',
                    teamId: 't1', teamName: 'T1', teamFull: 'Team One', teamShort: 'T1', teamSlug: 't1', colour: null, teamLogo: null } } }) };
  await D.season('c7', { trim: true, rows: false });
  calls.length = 0;
  const m1 = await D.playerMeta([P1]);
  ok('a player the season file names is answered from it, with no request',
     m1[P1] && m1[P1].name === 'From The File' && calls.length === 0, calls);
  const m2 = await D.playerMeta([P1, P2]);
  ok('...and only the players it does not name are asked for',
     m2[P1].name === 'From The File' && m2[P2] && m2[P2].name === 'Fresh Read' &&
     asked(/players\?id=in\./).length === 1 && asked(/players\?id=in\.\([^)]*0001/).length === 0, calls);
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c7/' + F1] = { token: T1, data: SNAP };
  const kept = await D.season('c7', { trim: true, rows: false });
  calls.length = 0;
  const again = await D.season('c7', { trim: true, rows: false });
  ok('the season cache keeps what the file had (no meta here, and nothing breaks for it)',
     again.players[0].id === 'p1' && kept.meta === null && calls.length === 1, calls);
}

/* ------------------------------------------------------------------ stars --- */
console.log('\nstars.js global(): the stored podiums when they are current and all visible');
const PODIUM = { w: 'week', top: [{ id: 'p1', bpm: 9.5, gp: 2, min: 60, _league: { id: 'L1', slug: 'l1' } }],
                 meta: { p1: { name: 'A Player', slug: 'a-player' } }, teamsById: {}, games: 3, leagues: 1, span: '1 Sept – 7 Sept' };
const starsRoutes = (visible) => ({
  games: rest => (/limit=1/.test(rest) ? [{ tipoff_at: '2026-09-07T18:00:00+00:00' }] : []),
  snapshots: [{ token: '2026-09-07T18:00:00+00:00', data: { week: PODIUM, month: null, anchor: '2026-09-07T18:00:00+00:00' } }],
  leagues: visible.map(id => ({ id }))
});
{
  reset(); routes = starsRoutes(['L1']);
  const r = await ST.global({ now: new Date('2026-09-08T00:00:00Z') });
  ok('the stored podiums, revived: the week window is the WINDOWS entry again',
     r.week && r.week.w && r.week.w.key === 'week' && r.week.top[0].id === 'p1' && r.month === null, r.week && r.week.w);
  ok('...with no month of games or box scores read',
     !asked(/player_game_stats|team_game_stats/).length && !asked(/tipoff_at=gte/).length, calls);
}
{
  reset(); routes = starsRoutes(['L2']);
  await ST.global({ now: new Date('2026-09-08T00:00:00Z') });
  ok('a podium naming a league the reader cannot see is not used: the month is read', asked(/tipoff_at=gte/).length === 1, calls);
}
{
  reset(); routes = starsRoutes(['L1']);
  routes.snapshots = [{ token: '2026-09-01T18:00:00+00:00', data: { week: PODIUM, month: null } }];
  await ST.global({ now: new Date('2026-09-08T00:00:00Z') });
  ok('podiums built from an older anchor are not used', asked(/tipoff_at=gte/).length === 1, calls);
}
{
  reset(); routes = starsRoutes(['L1']);
  globalThis.EpinoiaAccess = { session: () => ({ token: 't', userId: 'u' }) };
  await ST.global({ now: new Date('2026-09-08T00:00:00Z') });
  ok('a signed-in reader works them out (they may see leagues a signed-out one cannot)',
     !asked(/snapshots/).length && asked(/tipoff_at=gte/).length === 1, calls);
  delete globalThis.EpinoiaAccess;
  reset(); routes = starsRoutes(['L1']);
  await ST.global({ now: new Date('2026-09-08T00:00:00Z'), snapshot: false });
  ok('snapshot:false (the function building it) never reads one', !asked(/snapshots/).length, calls);
}

/* ---------------------------------------------------- the line's version --- */
console.log('\nseason.js version(): which code summed a season, in every name it is kept under');
{
  const S = globalThis.EpinoiaSeason;
  const { readFileSync } = await import('node:fs');
  /* the same probe and hash as season.js, worked out here, so a constant cannot pass for it */
  const probeP = S.finishPlayers(S.addPlayers(new Map(), [{ game_id: 'g', player_id: 'p', team_idx: 0, stats: { min: 60000 } }], []))[0];
  const probeT = S.finishTeams(S.addTeams(new Map(), [{ game_id: 'g', team_idx: 0, stats: {} }],
                                          { g: { id: 'g', home_team_id: 'h', away_team_id: 'a' } }))[0];
  const fnv = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
                     return ('0000000' + h.toString(16)).slice(-8); };
  const keyed = (pk, tk) => 's' + S.MATHS + '.' + fnv('p:' + pk.slice().sort().join(',') + '|t:' + tk.slice().sort().join(','));
  const pk = Object.keys(probeP), tk = Object.keys(probeT);
  ok('it is the keys a player\'s and a club\'s line carry, and MATHS', S.version() === keyed(pk, tk) && S.version() === S.version(), S.version());
  ok('...so a line without one of them - LNBP\'s file of 1 October, with no shot volumes - is another version',
     keyed(pk.filter(k => !/_a100$|^team_spacing$/.test(k)), tk) !== S.version());
  /* every statistic the player profile draws a bar for is in the version, so a file without one is never its season */
  const prof = readFileSync(path.join(ROOT, 'epinoia', 'p', 'player.js'), 'utf8');
  const sec = prof.slice(prof.indexOf('const BAR_SECTIONS = ['), prof.indexOf('const BAR_GROUPS'));
  const drawn = [...sec.matchAll(/\['([a-z0-9_]+)','/g)].map(m => m[1]);
  /* box plus/minus is put on by attachBPM, not by the line: a new key there is a MATHS bump (season.js says so) */
  const fromBpm = new Set(['bpm', 'obpm', 'dbpm', 'vorp']);
  const missing = drawn.filter(k => !fromBpm.has(k) && !(k in probeP));
  ok('every bar on the player profile (' + drawn.length + ') is a key of the line, or box plus/minus', drawn.length > 30 && !missing.length, missing);
  ok('...the four shot volumes and TEAM SPACING among them',
     ['rim_a100', 'mid_a100', 'p3_a100', 'ft_a100', 'team_spacing'].every(k => drawn.includes(k) && k in probeP));
  /* whoever builds a file names it with this, and builds it again when the name is not the one it holds */
  const fnSrc = readFileSync(path.join(ROOT, 'supabase', 'functions', 'snapshots', 'index.ts'), 'utf8');
  const bsSrc = readFileSync(path.join(ROOT, 'tools', 'build-seasons.mjs'), 'utf8');
  ok('the snapshots function and the big-season builder both name files with snapFile, and rebuild when the held name differs',
     /h\.file === 'season\/' \+ unit \+ '\/' \+ snapFile\(tok\)/.test(fnSrc) && /const name = snapFile\(tok\);/.test(fnSrc) &&
     /const name = D\.snapFile\(tok\), file = 'season\/' \+ unit \+ '\/' \+ name;/.test(bsSrc) && /h\.file === file/.test(bsSrc));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
