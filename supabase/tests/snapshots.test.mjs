/* ============================================================================
   Pages read a snapshot only when it is current, and work it out themselves
   otherwise (migrations 0152 and 0153, supabase/functions/snapshots).

     node supabase/tests/snapshots.test.mjs

   data.js season(): a season's lines from its file on the CDN,
   snapshots/season/<ids>/<token>.json, named by the token the page just read
   from the database (then kept for the next visit); the rows read and summed
   exactly as before when there is no such file (not built yet, or built from
   an older token), and never for the snapshots function itself (snapshot:false).
   A season merged across competitions is looked up by its sorted ids.

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

/* ---------------------------------------------------------------- seasons --- */
console.log('\ndata.js season(): the file named by the current token, the rows when there is none');
const SNAP = { games: [{ id: 'g1', home_team_id: 't1', away_team_id: 't2', home_score: 80, away_score: 70, tipoff_at: '2026-09-01T18:00:00Z' }],
               players: [{ id: 'p1', gp: 1, pts: 20 }], teams: [{ id: 't1', gp: 1 }], teamOfPlayer: [['p1', 't1']] };
const T1 = '1@2026-09-02T00:00:00+00:00';
const F1 = 'v2-1-2026-09-02T00-00-00-00-00.json';   // layout 2, then the token (data.js snapFile, which the function calls)
const tokenRoute = (fin) => rest => (/finalised_at/.test(rest) && /limit=1/.test(rest)
  ? { body: [{ id: 'g1', finalised_at: fin }], total: 1 }
  : { body: [], total: 0 });                // the season's games: none, so a fallback read ends at once
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1/' + F1] = { token: T1, data: SNAP };
  const s = await D.season('c1', { trim: true, rows: false });
  ok('the file named by the current token is the season', s.players.length === 1 && s.players[0].id === 'p1' && s.games[0].id === 'g1');
  ok('...rebuilt whole: byId and teamOfPlayer as a Map', s.byId.g1 && s.teamOfPlayer instanceof Map && s.teamOfPlayer.get('p1') === 't1');
  ok('...two requests, the token from the database and the file from the CDN, and no box scores',
     calls.length === 2 && asked(/\/storage\/v1\/object\/public\/snapshots\/season\/c1\/v2-1-2026-09-02T00-00-00-00-00\.json$/).length === 1 &&
     !asked(/player_game_stats|team_game_stats/).length, calls);
  calls.length = 0;
  const again = await D.season('c1', { trim: true, rows: false });
  ok('kept for the next visit: one request, the token', calls.length === 1 && again.players[0].id === 'p1', calls);
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
  files['season/c1/' + F1] = { token: T1, data: SNAP };
  await D.season('c1', { trim: true, rows: false, snapshot: false });
  ok('snapshot:false (the function building it) never reads a file', !asked(/storage\/v1/).length, calls);
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };
  files['season/c1,c2/' + F1] = { token: T1, data: SNAP };
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
