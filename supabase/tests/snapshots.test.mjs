/* ============================================================================
   Pages read a snapshot only when it is current, and work it out themselves
   otherwise (migration 0152, supabase/functions/snapshots).

     node supabase/tests/snapshots.test.mjs

   data.js season(): a competition's season lines from 'season:<id>' when the
   snapshot's token is the token the page just read (then kept for the next visit),
   and the rows read and summed exactly as before when it is not: an older token,
   no table yet (404), a season merged across competitions, or the snapshots
   function itself asking (snapshot:false).

   stars.js global(): HOME's podiums from 'stars_global' when it was built from the
   same anchor, every league on it is one the reader can see, and the reader is
   signed out; the month of box scores read and summed otherwise.
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

/* ---- a fake PostgREST: every request recorded, answers set per test ---- */
const calls = [];
let routes = {};
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  calls.push(u);
  const rest = u.split('/rest/v1/')[1] || '';
  const table = rest.split('?')[0];
  const r = typeof routes[table] === 'function' ? routes[table](rest) : routes[table];
  if (r === undefined) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ message: 'no ' + table }) };
  const { body, total } = Array.isArray(r) ? { body: r, total: r.length } : r;
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)),
           headers: { get: h => (String(h).toLowerCase() === 'content-range' ? `0-${Math.max(0, body.length - 1)}/${total}` : null) } };
};
const reset = () => { calls.length = 0; LS.clear(); SS.clear(); };
const asked = re => calls.filter(u => re.test(u));

/* ---------------------------------------------------------------- seasons --- */
console.log('\ndata.js season(): the snapshot when it is current, the rows when it is not');
const SNAP = { games: [{ id: 'g1', home_team_id: 't1', away_team_id: 't2', home_score: 80, away_score: 70, tipoff_at: '2026-09-01T18:00:00Z' }],
               players: [{ id: 'p1', gp: 1, pts: 20 }], teams: [{ id: 't1', gp: 1 }], teamOfPlayer: [['p1', 't1']] };
const tokenRoute = (tok) => rest => (/finalised_at/.test(rest) && /limit=1/.test(rest)
  ? { body: [{ id: 'g1', finalised_at: tok }], total: 1 }
  : { body: [], total: 0 });                // the season's games: none, so a fallback read ends at once
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00'),
             snapshots: [{ token: '1@2026-09-02T00:00:00+00:00', data: SNAP }] };
  const s = await D.season('c1', { trim: true, rows: false });
  ok('a current snapshot is the season', s.players.length === 1 && s.players[0].id === 'p1' && s.games[0].id === 'g1');
  ok('...rebuilt whole: byId and teamOfPlayer as a Map', s.byId.g1 && s.teamOfPlayer instanceof Map && s.teamOfPlayer.get('p1') === 't1');
  ok('...two small requests, the token and the snapshot, and no box scores',
     calls.length === 2 && asked(/snapshots\?key=eq\.season:c1/).length === 1 && !asked(/player_game_stats|team_game_stats/).length,
     calls);
  calls.length = 0;
  const again = await D.season('c1', { trim: true, rows: false });
  ok('kept for the next visit: one request, the token', calls.length === 1 && again.players[0].id === 'p1', calls);
}
{
  reset();
  routes = { games: tokenRoute('2026-09-03T00:00:00+00:00'),
             snapshots: [{ token: '1@2026-09-02T00:00:00+00:00', data: SNAP }] };
  const s = await D.season('c1', { trim: true, rows: false });
  ok('an older snapshot is not used: the season is read', asked(/status=in\.\(final,finalising\)&select=id,home_team_id/).length === 1 && s.players.length === 0, calls);
}
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00') };   // no snapshots table: 404
  const s = await D.season('c1', { trim: true, rows: false });
  ok('no snapshots table yet (404): the season is read as before',
     asked(/snapshots/).length === 1 && asked(/select=id,home_team_id/).length === 1 && Array.isArray(s.players), calls);
}
{
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00'), snapshots: [{ token: '1@2026-09-02T00:00:00+00:00', data: SNAP }] };
  await D.season('c1', { trim: true, rows: false, snapshot: false });
  ok('snapshot:false (the function building it) never reads a snapshot', !asked(/snapshots/).length, calls);
  reset();
  routes = { games: tokenRoute('2026-09-02T00:00:00+00:00'),
             snapshots: rest => (/season:c1,c2/.test(rest) ? [{ token: '1@2026-09-02T00:00:00+00:00', data: SNAP }] : []) };
  const m = await D.season(['c2', 'c1'], { trim: true, rows: false });
  ok('a season merged across competitions has its own snapshot, keyed by the sorted ids',
     asked(/snapshots\?key=eq\.season:c1,c2&/).length === 1 && m.players[0].id === 'p1' &&
     !asked(/player_game_stats|team_game_stats/).length, calls);
  reset();
  await D.season('c1', { trim: true });
  ok('a read that keeps the rows reads the rows', !asked(/snapshots/).length && asked(/select=id,home_team_id/).length === 1, calls);
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
