/* ============================================================================
   Authenticated-but-unprivileged tests.

   rls.test.mjs covers the anonymous attacker. This covers the more dangerous
   one: somebody who has signed up — which anyone can do — and then reaches for
   things sign-up does not entitle them to.

   The escalation this exists to catch: game_officials used to accept any
   insert, and can_score() grants scoring rights to anyone holding a row there.
   An anonymous probe could never have found it, because anon is refused at the
   door. Only a signed-in account could.

     node supabase/tests/authed.test.mjs

   Uses one throwaway account, reused across runs so repeated runs do not
   litter auth.users. It is never granted anything — that is the whole point.
   If your project requires email confirmation, sign-up returns no session and
   the suite skips rather than reporting a false pass.
   ============================================================================ */
import fs from 'node:fs';

const cfg  = fs.readFileSync(new URL('../../league/config.js', import.meta.url), 'utf8');
const BASE = /supabaseUrl:\s*'([^']+)'/.exec(cfg)?.[1];
const KEY  = /supabaseAnonKey:\s*'([^']*)'/.exec(cfg)?.[1];

const PROBE_EMAIL = 'courtside-rls-probe@example.com';
const PROBE_PW    = 'probe-account-with-no-rights-9f3a2b';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const ZERO = '00000000-0000-0000-0000-000000000000';

async function auth(path, body) {
  const r = await fetch(`${BASE}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function main() {
  if (!BASE || !KEY) { console.error('config.js has no url/key'); process.exitCode = 1; return; }
  console.log('\nauthenticated-but-unprivileged tests —', BASE, '\n');

  /* Sign in only — never sign up. A signup attempt sends a confirmation email,
     and the project's email allowance is the same one the magic-link logins
     draw on: a test that quietly burned it would lock the owner out of their
     own portal for an hour. Create the probe account once, by hand, and
     confirm it; after that this runs freely. */
  const r = await auth('token?grant_type=password', { email: PROBE_EMAIL, password: PROBE_PW });
  const token = r.json.access_token || null;

  if (!token) {
    console.log('  SKIP  no session for the probe account —', r.json.error_description || r.json.msg || `HTTP ${r.status}`);
    console.log('');
    console.log('        To enable these checks, create ONE confirmed account with no roles:');
    console.log('          Supabase dashboard -> Authentication -> Users -> Add user');
    console.log(`          email:    ${PROBE_EMAIL}`);
    console.log(`          password: ${PROBE_PW}`);
    console.log('          tick "Auto Confirm User"');
    console.log('        Grant it nothing. Everything below asserts it stays powerless.\n');
    return;
  }
  console.log('  signed in as', PROBE_EMAIL, '(no roles)\n');

  const H = { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rest = (p, init = {}) =>
    fetch(`${BASE}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const rpc = async (fn, body) => {
    const res = await rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
    return { ok: res.ok, code: res.status, body: await res.json().catch(() => null) };
  };
  const insert = async (table, row) => {
    const res = await rest(table, { method: 'POST', body: JSON.stringify([row]) });
    return { allowed: res.ok, code: res.status };
  };

  /* -- whoami: reachable, and honest about having nothing ------------------ */
  const w = await rpc('whoami', {});
  ok('whoami is callable when signed in', w.ok, `HTTP ${w.code}`);
  ok('whoami reports no platform admin', w.ok && w.body?.is_platform_admin === false,
     JSON.stringify(w.body?.is_platform_admin));
  ok('whoami reports no leagues', w.ok && Array.isArray(w.body?.leagues) && w.body.leagues.length === 0);

  /* -- THE escalation (migration 0007) ------------------------------------ */
  console.log('\n  the escalation migration 0007 closed:');
  const live = await (await rest('games?select=id&status=in.(scheduled,live)&limit=1')).json()
                 .catch(() => []);
  const target = live?.[0]?.id;
  const meId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

  const esc = await insert('game_officials', { game_id: target || ZERO, user_id: meId });
  ok(`signed-in user cannot appoint itself statistician${target ? ' (real fixture)' : ' (no fixture to target)'}`,
     !esc.allowed, `HTTP ${esc.code}`);

  if (target) {
    const canScore = await rpc('can_score', { p_game: target });
    // can_score is not exposed to clients; a 404 here is itself correct
    ok('can_score is not client-callable', !canScore.ok, `HTTP ${canScore.code}`);
    const ev = await insert('game_events', { game_id: target, seq: 999999, t: 'p2_made', team: 0 });
    ok('signed-in user cannot write events to a game it does not staff',
       !ev.allowed, `HTTP ${ev.code}`);
  }

  /* -- fixture injection (migration 0007) --------------------------------- */
  console.log('\n  fixture injection:');
  const comp = await (await rest('competitions?select=id&limit=1')).json().catch(() => []);
  const someTeams = await (await rest('teams?select=id&limit=2')).json().catch(() => []);
  if (comp?.[0] && someTeams?.length === 2) {
    const g = await insert('games', {
      competition_id: comp[0].id,
      home_team_id: someTeams[0].id, away_team_id: someTeams[1].id
    });
    ok('signed-in user cannot schedule into a competition it does not run',
       !g.allowed, `HTTP ${g.code}`);
  } else {
    console.log('  SKIP  no competition/teams to target');
  }

  /* -- administration ------------------------------------------------------ */
  console.log('\n  administration:');
  const cl = await rpc('create_league', { p_name: 'Probe League', p_slug: 'probe-league-x' });
  ok('signed-in user cannot create a league', !cl.ok, `HTTP ${cl.code}`);

  const gr = await rpc('grant_role', { p_email: PROBE_EMAIL, p_role: 'platform_admin',
                                       p_scope_type: 'platform' });
  ok('signed-in user cannot make itself platform admin', !gr.ok, `HTTP ${gr.code}`);

  const lg = await (await rest('leagues?select=id&limit=1')).json().catch(() => []);
  if (lg?.[0]) {
    const gr2 = await rpc('grant_role', { p_email: PROBE_EMAIL, p_role: 'league_admin',
                                          p_scope_type: 'league', p_scope_id: lg[0].id });
    ok('signed-in user cannot make itself league admin', !gr2.ok, `HTTP ${gr2.code}`);

    const lm = await rpc('league_members', { p_league: lg[0].id });
    // definer function returns rows only when is_league_admin passes; empty is the refusal
    ok('signed-in user reads no member emails',
       !lm.ok || (Array.isArray(lm.body) && lm.body.length === 0),
       `HTTP ${lm.code}, ${Array.isArray(lm.body) ? lm.body.length : '?'} rows`);
  }

  const ms = await insert('memberships',
    { user_id: meId, role: 'platform_admin', scope_type: 'platform' });
  ok('signed-in user cannot insert its own membership row', !ms.allowed, `HTTP ${ms.code}`);

  /* -- safeguarding still holds when signed in ----------------------------- */
  console.log('\n  safeguarding:');
  const minors = await (await rest('players?select=id&is_minor=eq.true')).json().catch(() => []);
  ok('signed-in user sees no under-18 players',
     Array.isArray(minors) && minors.length === 0, `${minors?.length ?? '?'} rows`);

  const audit = await (await rest('audit_log?select=id&limit=1')).json().catch(() => null);
  ok('signed-in user reads no audit log',
     !Array.isArray(audit) || audit.length === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
}

await main();
