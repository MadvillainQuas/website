/* ============================================================================
   RLS policy tests — the refusals are the point.

   Row-level security is only as good as its tests, so this asserts what must be
   DENIED, not just what works. Run after applying 0001_init.sql:

     node supabase/tests/rls.test.mjs

   Uses only the publishable (anon) key and plain fetch — no service role, no
   dependencies. Anything this script can do, a random visitor can do.
   ============================================================================ */
import fs from 'node:fs';

const cfg  = fs.readFileSync(new URL('../../league/config.js', import.meta.url), 'utf8');
const BASE = /supabaseUrl:\s*'([^']+)'/.exec(cfg)?.[1];
const KEY  = /supabaseAnonKey:\s*'([^']*)'/.exec(cfg)?.[1];

const H = { apikey: KEY, 'Content-Type': 'application/json' };
const rest = (path, init = {}) =>
  fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  -> ' + extra : ''}`);
}
async function rows(path) {
  const r = await rest(path);
  if (!r.ok) return { ok: false, n: 0, code: r.status };
  const j = await r.json().catch(() => []);
  return { ok: true, n: Array.isArray(j) ? j.length : 0, code: r.status };
}
async function write(table, body) {
  const r = await rest(table, { method: 'POST', body: JSON.stringify(body) });
  return { allowed: r.ok, code: r.status };
}

async function main() {
  if (!BASE || !KEY) { console.error('config.js has no url/key'); process.exitCode = 1; return; }
  console.log('\nRLS policy tests —', BASE, '\n');

  const probe = await rest('teams?select=id&limit=1');
  if (probe.status === 404) {
    console.log('  SKIP  schema not applied yet — run supabase/migrations/0001_init.sql first\n');
    return;
  }

  console.log('reads the public should have:');
  ok('anon may list leagues',        (await rows('leagues?select=id&limit=1')).ok);
  ok('anon may list teams',          (await rows('teams?select=id&limit=1')).ok);
  ok('anon may list roster entries', (await rows('roster_entries?select=id&limit=1')).ok);

  console.log('\nreads that must be refused:');
  const minors = await rows('players?select=id,is_minor&is_minor=eq.true&limit=5');
  ok('anon sees NO under-18 players', minors.n === 0, `returned ${minors.n} rows`);

  const prof = await rows('profiles?select=id&limit=5');
  ok('anon reads no profiles', prof.n === 0 || !prof.ok, `rows=${prof.n}`);

  const audit = await rows('audit_log?select=id&limit=5');
  ok('anon reads no audit log', audit.n === 0 || !audit.ok, `rows=${audit.n}`);

  const pend = await rows('media?select=id&status=eq.pending&limit=5');
  ok('anon reads no unapproved media', pend.n === 0, `rows=${pend.n}`);

  const ev = await rows('game_events?select=id&limit=5');
  ok('anon reads no events of non-final games', ev.n === 0 || !ev.ok, `rows=${ev.n}`);

  console.log('\nwrites that must be refused:');
  const ZERO = '00000000-0000-0000-0000-000000000000';
  const w1 = await write('game_events', [{ game_id: ZERO, seq: 1, t: 'p2_made', team: 0 }]);
  ok('anon cannot insert a game event', !w1.allowed, `HTTP ${w1.code}`);

  const w2 = await write('teams', [{ name: 'rls probe', slug: 'rls-probe-' + Date.now() }]);
  ok('anon cannot create a team', !w2.allowed, `HTTP ${w2.code}`);

  const w3 = await write('players', [{ slug: 'rls-probe-' + Date.now(), first_name: 'probe' }]);
  ok('anon cannot create a player', !w3.allowed, `HTTP ${w3.code}`);

  const w4 = await write('memberships',
    [{ user_id: ZERO, role: 'platform_admin', scope_type: 'platform' }]);
  ok('anon cannot grant itself a role', !w4.allowed, `HTTP ${w4.code}`);

  /* Aim these at a row that really exists. Against a nonexistent id a refusal
     and "matched nothing" are both 204, so the test would pass without proving
     anything. Falls back to the zero uuid only if the table is empty. */
  const realGame = (await (await rest('games?select=id&status=eq.final&limit=1')).json()
                    .catch(() => []))[0]?.id || ZERO;
  const targeted = realGame !== ZERO;

  const w5 = await rest(`games?id=eq.${realGame}`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ home_score: 999 }) });
  const changed5 = w5.ok ? (await w5.json().catch(() => [])).length : 0;
  ok(`anon cannot rewrite a score${targeted ? ' (real final game)' : ' (no games to target)'}`,
     !w5.ok || changed5 === 0, `HTTP ${w5.status}, ${changed5} rows changed`);

  const realEvent = (await (await rest('game_events?select=id&limit=1')).json()
                     .catch(() => []))[0]?.id;
  const w6 = await rest(realEvent ? `game_events?id=eq.${realEvent}` : 'game_events?id=gt.0',
    { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  const deleted6 = w6.ok ? (await w6.json().catch(() => [])).length : 0;
  ok(`anon cannot delete events${realEvent ? ' (real event)' : ' (none readable)'}`,
     !w6.ok || deleted6 === 0, `HTTP ${w6.status}, ${deleted6} rows deleted`);

  /* ---- administration RPCs are execute-revoked from anon (migration 0007) --- */
  console.log('\nadministration RPCs must be unreachable anonymously:');
  const rpc = async (fn, body) => {
    const r = await rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
    return { allowed: r.ok, code: r.status };
  };

  const r1 = await rpc('create_league', { p_name: 'RLS Probe', p_slug: 'rls-probe-league' });
  ok('anon cannot create a league', !r1.allowed, `HTTP ${r1.code}`);

  const r2 = await rpc('grant_role', { p_email: 'probe@example.com', p_role: 'platform_admin',
                                       p_scope_type: 'platform' });
  ok('anon cannot grant a role', !r2.allowed, `HTTP ${r2.code}`);

  const r3 = await rpc('assign_official', { p_game: ZERO, p_email: 'probe@example.com' });
  ok('anon cannot assign itself as statistician', !r3.allowed, `HTTP ${r3.code}`);

  const r4 = await rpc('whoami', {});
  ok('anon cannot call whoami', !r4.allowed, `HTTP ${r4.code}`);

  const r5 = await rpc('league_members', { p_league: ZERO });
  ok('anon cannot list league members (emails)', !r5.allowed, `HTTP ${r5.code}`);

  /* The escalation that migration 0007 closed: game_officials used to accept
     any insert, and holding a row there grants can_score(). Anonymously this
     was always refused, but the assertion belongs here permanently. */
  const w7 = await write('game_officials', [{ game_id: ZERO, user_id: ZERO }]);
  ok('anon cannot make itself a game official', !w7.allowed, `HTTP ${w7.code}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
}

await main();
