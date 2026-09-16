/* ============================================================================
   RLS policy tests — the refusals are the point.

   Row-level security is only as good as its tests, so this asserts what must be
   DENIED, not just what works. Run after applying 0001_init.sql:

     node supabase/tests/rls.test.mjs

   Uses only the publishable (anon) key and plain fetch — no service role, no
   dependencies. Anything this script can do, a random visitor can do.
   ============================================================================ */
import fs from 'node:fs';

const cfg  = fs.readFileSync(new URL('../../epinoia/config.js', import.meta.url), 'utf8');
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

  /* This used to be `game_events?select=id&limit=5` asserting zero rows, which
     passed only because the table was empty — it was testing an empty database,
     not a policy, and it started failing the moment real games existed. Worse,
     zero rows is the WRONG expectation: a finished game's log is public, and
     the box score is rebuilt from it.

     The actual rule is can_read_game_detail: a final game's events are public,
     an unfinished one's are not. Both halves are asserted. */
  /* ...EXCEPT A LIVE GAME IN A LEAGUE THAT PUBLISHES LIVE (leagues.public_live), whose
     log is public while it is played: that is how a fan follows it. The probe picking
     "any unfinished game" failed every evening a public league had a game on (2026-09-13,
     all night) while the policy was doing exactly what it says. So an unfinished game is
     sorted by its league's flag: hidden unless it is live in a public_live league, and
     one that is must be readable. */
  const finalIds = await (await rest('games?select=id&status=eq.final&limit=1')).json().catch(() => []);
  const openAll  = await (await rest('games?select=id,status,competitions(seasons(leagues(public_live)))&status=in.(scheduled,live)&limit=200')).json().catch(() => []);
  const liveIsPublic = g => g.status === 'live' && !!(g.competitions && g.competitions.seasons && g.competitions.seasons.leagues && g.competitions.seasons.leagues.public_live);
  const openIds  = (Array.isArray(openAll) ? openAll : []).filter(g => !liveIsPublic(g));
  const publicLive = (Array.isArray(openAll) ? openAll : []).find(liveIsPublic);

  if (finalIds?.[0]) {
    const pub = await rows(`game_events?game_id=eq.${finalIds[0].id}&select=id&limit=5`);
    ok('anon CAN read a finished game\'s events (the box score depends on it)',
       pub.ok && pub.n > 0, `rows=${pub.n}`);
  } else {
    console.log('  SKIP  no final game to read');
  }

  if (openIds?.[0]) {
    const hid = await rows(`game_events?game_id=eq.${openIds[0].id}&select=id&limit=5`);
    ok('anon reads no events of an unfinished game', hid.n === 0, `rows=${hid.n}`);
  } else {
    console.log('  SKIP  no unfinished game to probe');
  }
  if (publicLive) {
    const pl = await rows(`game_events?game_id=eq.${publicLive.id}&select=id&limit=5`);
    ok('...but anon CAN follow a live game in a public_live league', pl.ok, `status ok=${pl.ok} rows=${pl.n}`);
  }

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

  /* ---- memberships (migration 0117, docs/memberships.md) -------------------
     Skipped as a block until 0117 is applied: PostgREST answers 404 (PGRST202,
     no such function) for access_state until then, and every assertion below
     would pass or fail for the wrong reason against tables that do not exist. */
  console.log('\nmemberships (0117): what a signed-out visitor can and cannot reach:');
  const st = await rest('rpc/access_state', { method: 'POST', body: JSON.stringify({}) });
  const stBody = await st.json().catch(() => null);
  if (st.status === 404 || stBody?.code === 'PGRST202') {
    console.log('  SKIP  0117 not applied yet (access_state: HTTP ' + st.status +
                (stBody?.code ? ', ' + stBody.code : '') + ')');
  } else {
    ok('anon may call access_state, and it says signed out',
       st.ok && stBody && stBody.signed_in === false,
       `HTTP ${st.status} ${JSON.stringify(stBody)?.slice(0, 160)}`);

    // answers about somebody else: service role only
    const ff = await rpc('access_features_for', { p_user: ZERO, p_league: ZERO });
    ok('anon cannot call access_features_for', !ff.allowed, `HTTP ${ff.code}`);

    /* Refused outright (401/403, table privileges revoked) or zero rows: both
       mean nothing came back. A 404 here would mean the table is missing, which
       0117 being applied rules out, so it is not accepted as a pass. */
    for (const t of ['access_subscriptions', 'access_grants', 'access_customers',
                     'access_checkouts', 'billing_events', 'league_billing_accounts']) {
      const r = await rows(`${t}?select=*&limit=5`);
      ok(`anon reads no rows from ${t}`, r.code !== 404 && (!r.ok || r.n === 0),
         `HTTP ${r.code}, rows=${r.n}`);
    }

    const plans = await rows('access_plans?select=id,name,price_pennies&limit=5');
    ok('anon may read access_plans (the price list)', plans.ok, `HTTP ${plans.code}`);
  }

  /* ---- organisations (migration 0119, docs/replacement/foundations.md) ------
     Skipped as a block until 0119 is applied: PostgREST answers 404 (PGRST202)
     for org_tree until then, and the tables below would not exist. */
  console.log('\norganisations (0119): what a signed-out visitor can and cannot reach:');
  const tree = await rest('rpc/org_tree', { method: 'POST', body: JSON.stringify({}) });
  const treeBody = await tree.json().catch(() => null);
  if (tree.status === 404 || treeBody?.code === 'PGRST202') {
    console.log('  SKIP  0119 not applied yet (org_tree: HTTP ' + tree.status +
                (treeBody?.code ? ', ' + treeBody.code : '') + ')');
  } else {
    ok('anon may call org_tree, and it answers a list', tree.ok && Array.isArray(treeBody),
       `HTTP ${tree.status} ${JSON.stringify(treeBody)?.slice(0, 160)}`);
    /* the public sees "affiliated" and the level, never the record behind it */
    const leaked = (Array.isArray(treeBody) ? treeBody : [])
      .filter(o => ['reference', 'note', 'settings', 'created_by', 'visible'].some(k => k in o));
    ok('org_tree carries no affiliation number, note, tenant settings or author', leaked.length === 0,
       `${leaked.length} rows`);

    const orgRead = await rows('organisations?select=id,name,slug,kind,parent_id,path&limit=5');
    ok('anon may read organisations (names and structure, like leagues)', orgRead.ok, `HTTP ${orgRead.code}`);
    const hidden = await rows('organisations?select=id&visible=eq.false&limit=5');
    ok('anon reads no hidden organisation', hidden.code !== 404 && hidden.n === 0, `HTTP ${hidden.code}, rows=${hidden.n}`);

    /* refused outright (privileges revoked) or zero rows; a 404 would mean the
       table is missing, which a working org_tree rules out */
    const aff = await rows('org_affiliations?select=*&limit=5');
    ok('anon reads no rows from org_affiliations', aff.code !== 404 && (!aff.ok || aff.n === 0),
       `HTTP ${aff.code}, rows=${aff.n}`);

    const wOrg = await write('organisations',
      [{ kind: 'national_body', name: 'RLS probe', slug: 'rls-probe-' + Date.now() }]);
    ok('anon cannot create an organisation', !wOrg.allowed, `HTTP ${wOrg.code}`);
    const wAff = await write('org_affiliations', [{ org_id: ZERO, to_org_id: ZERO, kind: 'governing_body',
                                                   season_label: '2026/27', valid_from: '2026-09-01' }]);
    ok('anon cannot record an affiliation', !wAff.allowed, `HTTP ${wAff.code}`);

    /* against a real row when one is readable: a refusal and "matched nothing"
       are both quiet otherwise */
    const realOrg = (await (await rest('organisations?select=id&limit=1')).json().catch(() => []))[0]?.id || ZERO;
    const pOrg = await rest(`organisations?id=eq.${realOrg}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: 'RLS probe' }) });
    const changedOrg = pOrg.ok ? (await pOrg.json().catch(() => [])).length : 0;
    ok(`anon cannot rename an organisation${realOrg !== ZERO ? ' (real row)' : ' (none to target)'}`,
       !pOrg.ok || changedOrg === 0, `HTTP ${pOrg.status}, ${changedOrg} rows changed`);

    for (const [fn, body] of [
      ['organisation_admin', { p_org: null }],
      ['platform_save_organisation', { p: { kind: 'national_body', name: 'RLS probe' } }],
      ['platform_move_organisation', { p_org: ZERO, p_parent: ZERO }],
      ['set_league_organiser', { p_league: ZERO, p_org: ZERO }],
      ['set_team_club', { p_team: ZERO, p_club: ZERO, p_age_group: null, p_gender: null }],
      ['record_affiliation', { p: { org_id: ZERO, to_org_id: ZERO, kind: 'governing_body', season_label: '2026/27' } }],
      ['adopt_clubs', { p_league: ZERO, p_parent: null, p_pick: null }]]) {
      const r = await rpc(fn, body);
      ok(`anon cannot call ${fn}`, !r.allowed, `HTTP ${r.code}`);
    }

    const band = await rest('rpc/age_band_born',
      { method: 'POST', body: JSON.stringify({ p_band: 18, p_start_year: 2026 }) });
    const bandBody = await band.json().catch(() => null);
    ok('anon may call age_band_born, and U18 in 2026/27 is 2008-09-01 to 2010-08-31',
       band.ok && bandBody === '[2008-09-01,2010-09-01)', `HTTP ${band.status} ${JSON.stringify(bandBody)}`);

    /* the tables that gained columns: select=* still answers, and the new
       columns are readable like the rest of the row */
    for (const [t, cols] of [['leagues', 'organiser_id'], ['teams', 'club_id,age_group,gender'],
                             ['competitions', 'age_group,gender,level,born_from,born_to'],
                             ['competition_teams', 'id,competition_id,team_id']]) {
      const star = await rows(`${t}?select=*&limit=1`);
      const named = await rows(`${t}?select=${cols}&limit=1`);
      ok(`anon select=* on ${t} still works, and ${cols} can be read`, star.ok && named.ok,
         `HTTP ${star.code} / ${named.code}`);
    }

    const realTeam = (await (await rest('teams?select=id&limit=1')).json().catch(() => []))[0]?.id || ZERO;
    const pTeam = await rest(`teams?id=eq.${realTeam}`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ club_id: ZERO, gender: 'open' }) });
    const changedTeam = pTeam.ok ? (await pTeam.json().catch(() => [])).length : 0;
    ok(`anon cannot attach a team to a club${realTeam !== ZERO ? ' (real team)' : ' (no teams to target)'}`,
       !pTeam.ok || changedTeam === 0, `HTTP ${pTeam.status}, ${changedTeam} rows changed`);
  }

  /* ---- data rights (migration 0120, docs/replacement/foundations.md 3.3, 7.6) --
     Skipped as a block until 0120 is applied, told by the public dpo_contact
     setting it seeds: none of its RPCs is callable signed out, so there is no
     anonymous call whose 404 would say "not applied" rather than "refused".
     NOTHING HERE WRITES A REQUEST. A real one would sit in the live queue and
     email the platform owner every time this ran, so the signed-out path is
     proved by a submission the contact function must refuse for its kind, which
     only a function that knows about privacy requests says. */
  console.log('\ndata rights (0120): what a signed-out visitor can and cannot reach:');
  const dpo = await rest('platform_settings?select=key,value&key=eq.dpo_contact');
  const dpoBody = dpo.ok ? await dpo.json().catch(() => []) : [];
  if (!Array.isArray(dpoBody) || dpoBody.length === 0) {
    console.log('  SKIP  0120 not applied yet (no public dpo_contact setting: HTTP ' + dpo.status + ')');
  } else {
    ok('anon may read the dpo_contact setting (the privacy page shows it)', dpoBody.length === 1);

    /* the restricted tables: not in the API at all. Asked for by name in public
       (where they are not, or where the fallback's prefixed tables hold no
       privilege), and through the restricted profile, which PostgREST does not
       expose. Refused outright or zero rows; never rows. */
    for (const t of ['data_requests', 'retention_schedule', 'restricted_data_requests', 'restricted_retention_schedule']) {
      const r = await rows(`${t}?select=*&limit=5`);
      ok(`anon reads nothing from ${t} in the public API`, !r.ok || r.n === 0, `HTTP ${r.code}, rows=${r.n}`);
    }
    for (const t of ['data_requests', 'retention_schedule']) {
      const r = await rest(`${t}?select=*&limit=5`, { headers: { 'Accept-Profile': 'restricted' } });
      const body = r.ok ? await r.json().catch(() => []) : [];
      ok(`the restricted schema is not reachable through the API (${t})`,
         !r.ok || (Array.isArray(body) && body.length === 0), `HTTP ${r.status}`);
    }
    const wReq = await write('data_requests', [{ kind: 'access', requester_name: 'RLS probe', requester_email: 'rls@example.invalid' }]);
    ok('anon cannot insert a request into the table', !wReq.allowed, `HTTP ${wReq.code}`);

    /* the RPCs: submit is for the signed in, intake for the service role, the
       queue and its actions for platform admins, prune and the reminders for
       the service role */
    for (const [fn, body] of [
      ['submit_data_request', { p_kind: 'access', p_details: 'RLS probe', p_tenant: null }],
      ['my_data_requests', {}],
      ['intake_data_request', { p: { kind: 'access', name: 'RLS probe', email: 'rls@example.invalid' } }],
      ['privacy_queue', { p_tenant: null }],
      ['update_data_request', { p_id: ZERO, p_action: 'acknowledge', p: {} }],
      ['prune_audit_log', {}],
      ['notify_data_requests', {}]]) {
      const r = await rpc(fn, body);
      ok(`anon cannot call ${fn}`, !r.allowed, `HTTP ${r.code}`);
    }

    /* P0.4: an audit row with another account as its actor, or none */
    const wAudit = await write('audit_log', [{ actor: ZERO, action: 'privacy.request', subject: 'data_request' }]);
    ok('anon cannot write an audit row', !wAudit.allowed, `HTTP ${wAudit.code}`);

    /* signed out, a request goes through the contact function, which knows the
       kinds. An unknown one is refused before anything is stored. */
    const fnRes = await fetch(`${BASE}/functions/v1/contact`, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'RLS probe', email: 'rls@example.invalid', body: '',
                             privacy: { kind: 'rls-probe-not-a-kind', capacity: 'self' } })
    }).catch(() => null);
    const fnBody = fnRes ? await fnRes.json().catch(() => ({})) : {};
    if (!fnRes || fnRes.status === 404) {
      console.log('  SKIP  the contact function is not deployed (HTTP ' + (fnRes ? fnRes.status : 'unreachable') + ')');
    } else {
      ok('signed out, the contact function takes privacy requests (and refuses an unknown kind, storing nothing)',
         fnRes.status === 400 && /access, erasure, rectification/.test(fnBody.error || ''),
         `HTTP ${fnRes.status} ${JSON.stringify(fnBody).slice(0, 160)} (an older function answers "Say a little more")`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
}

await main();
