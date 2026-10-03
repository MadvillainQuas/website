/* ============================================================================
   A PERSON DELETES THEIR OWN ACCOUNT (0227), ON A REAL POSTGRES (PGlite), EVERY MIGRATION APPLIED.

   Before this, the console's delete failed for any account that had ever made a club, a player, a game or a play
   (eleven keys to auth.users with no ON DELETE rule, and an append-only event log that refused to clear its
   created_by), and "Delete my account" only opened the erasure request form. Here:
     * no key from public to auth.users blocks a deletion any more;
     * an account that made things (a row in each of the eleven tables) is deleted and the things stay, nameless;
     * delete_my_account: the person's own account and no other, only with the address typed, never signed out,
       never an administrator's, never with a membership still running; the same call twice is harmless;
     * what is keyed to the address (grants, invitations, report emails) goes with the account; what is not theirs stays;
     * their open erasure request, about themselves, is closed as completed; a guardian's, and everyone else's, are not;
     * the audit row names the account and never the address; the console's delete goes through the same door and now
       works for a scorer;
     * the event log is still append-only for everything but the erasure's one change.
   Then the page: the link to the request form is a section with a typed confirmation, the photographs' files are
   removed first, the session ends locally, the privacy page points signed-in people to it.

     node supabase/tests/delete-my-account.test.mjs        (skipped, and passing, where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '\n          ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 900))); } };

const mig = read('supabase', 'migrations', '0227_delete_my_account.sql');
console.log('the migration');
ok('it asks for no more than five seconds of any lock (in the swap itself too, if a push sends statements one at a time), and adds the keys NOT VALID (no table scanned on games or game_events)',
   /set local lock_timeout = '5s'/.test(mig) && /perform set_config\('lock_timeout', '5s', true\)/.test(mig) && /on delete set null not valid/.test(mig));
ok('the event log\'s one more exception needs the erasure\'s own flag, a cleared created_by and nothing else changed', /epinoia\.account_erasure/.test(mig) && /new\.created_by is null/.test(mig) && /\(to_jsonb\(new\) - 'created_by'\) = \(to_jsonb\(old\) - 'created_by'\)/.test(mig) && /epinoia\.player_merge/.test(mig));
ok('erase_account is for no browser; delete_my_account is for the signed in and never for anon',
   /revoke all on function public\.erase_account\(uuid, uuid\) from public, anon, authenticated;/.test(mig) && /revoke all on function public\.delete_my_account\(text\) from public, anon;/.test(mig) && /grant execute on function public\.delete_my_account\(text\) to authenticated;/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0227 among them', !failed || failed.length === 0, failed);

  /* ------------------------------------------------------------------ helpers --- */
  const as = async (uid, role = 'authenticated') => {
    await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(uid ? { sub: uid, role } : {})}', false)`);
    if (uid) await db.exec(`set role ${role}`); else await db.exec(`set role anon`);
  };
  const root = async () => { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`); };
  const user = async email => (await one(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [email])).id;
  const gone = async id => (await one(`select count(*)::int n from auth.users where id = $1`, [id])).n === 0;
  const call = async (uid, sql, params) => { await as(uid); try { return { r: (await q(sql, params)) }; } catch (e) { return { e: e.message }; } finally { await root(); } };
  const del = async (uid, confirm) => { const x = await call(uid, `select public.delete_my_account($1) r`, [confirm]); return x.e ? { error: x.e } : x.r[0].r; };

  /* a row in a table with every required column filled with something that passes its checks (keys are not checked while
     the row goes in: the rows are about who made them, not about what they hang from) */
  const enums = {};
  const dummy = async c => {
    const t = c.udt_name;
    if (c.data_type === 'USER-DEFINED') { if (!(t in enums)) enums[t] = (await one(`select e.enumlabel l from pg_enum e join pg_type y on y.oid = e.enumtypid where y.typname = $1 order by e.enumsortorder limit 1`, [t])).l; return `'${enums[t]}'`; }
    if (c.data_type === 'ARRAY') return `'{}'`;
    if (t === 'uuid') return 'gen_random_uuid()';
    if (/^(text|varchar|citext|bpchar|name)$/.test(t)) return `'x'`;
    if (/^(int2|int4|int8|numeric|float4|float8)$/.test(t)) return '1';
    if (t === 'bool') return 'false';
    if (/^timestamp/.test(t)) return 'now()';
    if (t === 'date') return 'current_date';
    if (/^json/.test(t)) return `'{}'`;
    return `'x'`;
  };
  const seed = async (table, over) => {
    const cols = await q(`select column_name, data_type, udt_name, column_default, is_nullable, is_generated, identity_generation from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table]);
    const names = [], vals = [];
    for (const c of cols) {
      if (c.column_name in over) { names.push(`"${c.column_name}"`); vals.push(over[c.column_name]); continue; }
      if (c.is_nullable === 'YES' || c.column_default != null || c.is_generated === 'ALWAYS' || c.identity_generation) continue;
      names.push(`"${c.column_name}"`); vals.push(await dummy(c));
    }
    await db.exec(`insert into public.${table} (${names.join(',')}) values (${vals.join(',')})`);
  };

  console.log('\nthe keys');
  const blocking = await q(`select c.conrelid::regclass::text t, a.attname c from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype in ('a', 'r') and c.connamespace = 'public'::regnamespace`);
  ok('no key from a public table to auth.users blocks a deletion', blocking.length === 0, blocking);

  /* ------------------------------------------------- an account that made things --- */
  console.log('\nan account that made things is deleted, and the things stay without its name');
  const maker = await user('maker@example.invalid');
  const keep = await user('keep@example.invalid');
  await db.exec(`set session_replication_role = replica`);
  const made = [['announcements', 'created_by', { audience: `'all'` }], ['cam_frames', 'posted_by', {}], ['game_events', 'created_by', {}], ['games', 'created_by', {}], ['games', 'finalised_by', {}],
    ['league_invites', 'created_by', { token: `'abcdefghijklmnopqrstuv'` }], ['media', 'approved_by', {}], ['media', 'uploaded_by', {}], ['player_releases', 'released_by', {}],
    ['players', 'created_by', { slug: `'maker-p'` }], ['teams', 'created_by', { slug: `'maker-t'` }]];
  const seedErr = [];
  for (const [t, c, over] of made) {
    try { await seed(t, Object.assign({ [c]: `'${maker}'` }, over)); } catch (e) { seedErr.push(t + '.' + c + ': ' + e.message); }
  }
  await db.exec(`set session_replication_role = origin`);
  ok('a row is made by the account in each of the eleven tables', seedErr.length === 0, seedErr);
  const before = await one(`select (select count(*)::int from games) g, (select count(*)::int from game_events) e, (select count(*)::int from teams) t`);

  const refused = await del(maker, 'nope@example.invalid');
  ok('with another address typed, nothing happens', refused.error && /type the address you sign in with/.test(refused.error) && !(await gone(maker)), refused);
  const done = await del(maker, '  MAKER@example.invalid ');
  ok('with the address typed (any case, spaces round it), the account is deleted', done.ok === true && (await gone(maker)), done);
  const after = await one(`select (select count(*)::int from games) g, (select count(*)::int from game_events) e, (select count(*)::int from teams) t`);
  ok('the games, the plays and the club are all still there', JSON.stringify(after) === JSON.stringify(before), { before, after });
  const stillNamed = [];
  for (const [t, c] of made) { const n = (await one(`select count(*)::int n from public.${t} where ${c} = $1`, [maker])).n; if (n) stillNamed.push(t + '.' + c); }
  const nameless = [];
  for (const [t, c] of made) { const n = (await one(`select count(*)::int n from public.${t} where ${c} is null`)).n; if (!n) nameless.push(t + '.' + c); }
  ok('...and none names the account (created_by, finalised_by, uploaded_by and the rest are null)', stillNamed.length === 0 && nameless.length === 0, { stillNamed, nameless });
  const audit = await q(`select actor, action, subject, subject_id, detail::text d from audit_log where action = 'privacy.erase' and subject_id = $1`, [maker]);
  ok('one audit row, privacy.erase, for the account\'s id, with no actor and no address', audit.length === 1 && audit[0].actor === null && !/@/.test(audit[0].d) && /the account holder/.test(audit[0].d), audit);
  const again = await del(maker, 'maker@example.invalid');
  ok('the same call again (a token that outlived its account) is harmless', again.ok === true && again.already === true, again);
  ok('the other account is untouched', !(await gone(keep)));

  console.log('\nthe event log is append-only still');
  await db.exec(`set session_replication_role = replica`);
  const who = await user('author@example.invalid');
  await seed('game_events', { created_by: `'${who}'`, payload: `'{"a":1}'::jsonb` });
  await db.exec(`set session_replication_role = origin`);
  const ev = (await one(`select id from game_events where created_by = $1`, [who])).id;
  const upd = async sql => { try { await db.exec(sql); return 'allowed'; } catch (e) { return e.message; } };
  ok('an update of its payload is refused', /append-only/.test(await upd(`update game_events set payload = '{"a":2}'::jsonb where id = ${ev}`)));
  ok('clearing created_by by hand, outside an erasure, is refused too', /append-only/.test(await upd(`update game_events set created_by = null where id = ${ev}`)));
  ok('and the flag alone changes nothing else: a payload edit under it is refused',
     /append-only/.test(await upd(`select set_config('epinoia.account_erasure', 'on', false); update game_events set payload = '{"a":3}'::jsonb, created_by = null where id = ${ev}`)));
  await db.exec(`select set_config('epinoia.account_erasure', '', false)`);

  /* ------------------------------------------------------------------ the guards --- */
  console.log('\nwho may, and when not');
  const signedOut = await call(null, `select public.delete_my_account('x') r`);
  ok('signed out (anon) cannot call it', signedOut.e && /permission denied/.test(signedOut.e), signedOut);
  const noSub = await call(who, `select public.erase_account($1) r`, [keep]);
  ok('a signed-in person cannot call erase_account, and so cannot name another account', noSub.e && /permission denied/.test(noSub.e) && !(await gone(keep)), noSub);
  ok('delete_my_account takes the confirmation and nothing else: nobody\'s id can be passed', (await one(`select pronargs from pg_proc where proname = 'delete_my_account'`)).pronargs === 1);
  ok('without a session\'s sub it refuses', (await (async () => { await db.exec(`reset role; select set_config('request.jwt.claims', '', false); set role authenticated`); try { await q(`select public.delete_my_account('x')`); return 'allowed'; } catch (e) { return e.message; } finally { await root(); } })()).includes('sign in'));

  const boss = await user('boss@example.invalid');
  await db.exec(`insert into memberships (user_id, role, scope_type) values ('${boss}', 'platform_admin', 'platform')`);
  const bossTry = await del(boss, 'boss@example.invalid');
  ok('a platform administrator is told to have another remove the role first, and is not deleted', bossTry.error && /another administrator/.test(bossTry.error) && !(await gone(boss)), bossTry);

  const payer = await user('payer@example.invalid');
  await db.exec(`insert into access_subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end, features) values ('${payer}', 'active', 'sub_t1', 'cus_t1', now() + interval '20 days', '{}')`).catch(async () => {
    await seed('access_subscriptions', { user_id: `'${payer}'`, status: `'active'`, current_period_end: `now() + interval '20 days'` });
  });
  const payTry = await del(payer, 'payer@example.invalid');
  ok('a membership still running: refused, with the way out, and the account stays', payTry.error && /membership that is still running/.test(payTry.error) && /Cancel membership/.test(payTry.error) && !(await gone(payer)), payTry);
  await db.exec(`update access_subscriptions set status = 'canceled', ended_at = now() where user_id = '${payer}'`);
  const payDone = await del(payer, 'payer@example.invalid');
  ok('once it has ended, the account is deleted, its billing rows with it', payDone.ok === true && (await gone(payer)) && (await one(`select count(*)::int n from access_subscriptions where user_id = $1`, [payer])).n === 0, payDone);

  const nobody = await user('nobody@example.invalid');
  await db.exec(`update auth.users set email = null where id = '${nobody}'`);        // (a sign-in with no address: the new-user trigger needs one to make the profile)
  const noTyped = await del(nobody, 'whatever');
  ok('an account with no address types DELETE', noTyped.error && /type DELETE/.test(noTyped.error) && !(await gone(nobody)), noTyped);
  const noDone = await del(nobody, ' delete');
  ok('...and is deleted by it', noDone.ok === true && (await gone(nobody)), noDone);

  /* ------------------------------------------------ what is keyed to the address --- */
  console.log('\nwhat is keyed to the address goes with the account, and only theirs');
  const fan = await user('Fan.Person@Example.invalid');
  const other = await user('other.person@example.invalid');
  const team = (await one(`insert into teams (slug, name) values ('addr-t', 'T') returning id`)).id;
  await db.exec(`set session_replication_role = replica`);
  await seed('access_grants', { email: `'fan.person@example.invalid'`, features: `'{analytics}'` });
  await seed('access_grants', { email: `'other.person@example.invalid'`, features: `'{analytics}'` });
  await seed('platform_scouts', { email: `'fan.person@example.invalid'` });
  await seed('front_office_grants', { email: `'fan.person@example.invalid'`, team_id: `'${team}'` });
  await seed('creator_members', { email: `'fan.person@example.invalid'` });
  await seed('pending_roles', { email: `'fan.person@example.invalid'`, role: `'statistician'`, scope_type: `'league'`, scope_id: 'gen_random_uuid()' });
  await seed('pending_roles', { email: `'other.person@example.invalid'`, role: `'statistician'`, scope_type: `'league'`, scope_id: 'gen_random_uuid()' });
  await seed('report_mail_subs', { email: `'fan.person@example.invalid'`, team_id: `'${team}'` });
  await seed('report_mail_subs', { email: `'linked@example.invalid'`, team_id: `'${team}'`, user_id: `'${fan}'` });
  await seed('report_mail_subs', { email: `'other.person@example.invalid'`, team_id: `'${team}'`, created_by: `'${fan}'` });
  await seed('notify_audience_rows', { user_id: `'${fan}'` });
  await db.exec(`set session_replication_role = origin`);
  const seededAudience = (await one(`select count(*)::int n from notify_audience_rows where user_id = $1`, [fan])).n;
  const subs = (await one(`select id from report_mail_subs where lower(email) = 'fan.person@example.invalid'`)).id;
  await db.exec(`set session_replication_role = replica`);
  await seed('report_files', { sub_id: `'${subs}'`, kind: `'team'`, path: `'${subs}/2026-10-03/x.pdf'` });
  await db.exec(`set session_replication_role = origin`);
  const fanDone = await del(fan, 'fan.person@example.invalid');
  ok('the account is deleted', fanDone.ok === true && (await gone(fan)), fanDone);
  const left = async t => (await one(`select count(*)::int n from public.${t} where lower(email) = 'fan.person@example.invalid'`)).n;
  const kept = {};
  for (const t of ['access_grants', 'platform_scouts', 'front_office_grants', 'creator_members', 'pending_roles', 'report_mail_subs']) kept[t] = await left(t);
  ok('every grant, seat, invitation and report email for the address is gone', Object.values(kept).every(n => n === 0), kept);
  ok('...and so is the one linked to the account under another address, with its files', (await one(`select count(*)::int n from report_mail_subs where email = 'linked@example.invalid'`)).n === 0 && (await one(`select count(*)::int n from report_files`)).n === 0);
  ok('someone else\'s grant and invitation stay, and the report email another person had made for another address stays, nameless',
     (await one(`select count(*)::int n from access_grants where email = 'other.person@example.invalid'`)).n === 1 && (await one(`select count(*)::int n from pending_roles where email = 'other.person@example.invalid'`)).n === 1
     && (await one(`select count(*)::int n from report_mail_subs where email = 'other.person@example.invalid' and created_by is null`)).n === 1);
  ok('the stored audience has no row for the account (there was one)', seededAudience === 1 && (await one(`select count(*)::int n from notify_audience_rows where user_id = $1`, [fan])).n === 0);

  /* ----------------------------------------------------- their erasure request --- */
  console.log('\ntheir own open erasure request is closed as done; nobody else\'s is touched');
  const asker = await user('asker@example.invalid');
  const lone = await user('lone@example.invalid');
  const request = async (uid, email, kind, capacity) => (await one(`insert into restricted.data_requests (kind, requester_user, requester_name, requester_email, capacity, due_at)
      values ($1, $2, 'Name', $3, $4, now() + interval '1 month') returning id`, [kind, uid, email, capacity])).id;
  const mine = await request(asker, 'asker@example.invalid', 'erasure', 'self');
  const guardians = await request(asker, 'asker@example.invalid', 'erasure', 'guardian');
  const access = await request(asker, 'asker@example.invalid', 'access', 'self');
  const others = await request(lone, 'lone@example.invalid', 'erasure', 'self');
  const askDone = await del(asker, 'asker@example.invalid');
  ok('the account is deleted and says it closed one request', askDone.ok === true && askDone.closed_requests === 1 && (await gone(asker)), askDone);
  const st = async id => await one(`select status, closed_at is not null closed, outcome, requester_user from restricted.data_requests where id = $1`, [id]);
  const m = await st(mine);
  ok('theirs is completed, closed, and says who did it and that statistics stay', m.status === 'completed' && m.closed && /deleted the account themselves/.test(m.outcome) && /statistics they entered stay/.test(m.outcome), m);
  ok('...its requester is cleared with the account, the name and address stay on the request (the record that it was asked for)', m.requester_user === null && (await one(`select requester_email e from restricted.data_requests where id = $1`, [mine])).e === 'asker@example.invalid');
  ok('a request made as a guardian (about somebody else) stays open', (await st(guardians)).status === 'received' && !(await st(guardians)).closed);
  ok('an access request of theirs stays open too', (await st(access)).status === 'received');
  ok('someone else\'s erasure request is not touched', (await st(others)).status === 'received');
  const closeAudit = await q(`select detail::text d, actor from audit_log where action = 'privacy.close' and subject_id = $1`, [mine]);
  ok('the close is audited as the console\'s close is, naming the request and no one', closeAudit.length === 1 && closeAudit[0].actor === null && !/@/.test(closeAudit[0].d), closeAudit);

  /* ------------------------------------------------------- the console's delete --- */
  console.log('\nthe console\'s delete goes through the same door');
  const maker2 = await user('maker2@example.invalid');
  await db.exec(`set session_replication_role = replica`);
  await seed('players', { created_by: `'${maker2}'`, slug: `'maker2-p'` });
  await seed('teams', { created_by: `'${maker2}'`, slug: `'maker2-t'` });
  await db.exec(`set session_replication_role = origin`);
  const adminCall = async (sql, params) => { await as(boss); try { return (await q(sql, params))[0]; } catch (e) { return { e: e.message }; } finally { await root(); } };
  const wrong = await adminCall(`select platform_delete_account($1, 'wrong@example.invalid') r`, [maker2]);
  ok('with the wrong address, refused', wrong.e && /type the account address exactly/.test(wrong.e) && !(await gone(maker2)), wrong);
  const right = await adminCall(`select platform_delete_account($1, 'Maker2@example.invalid') r`, [maker2]);
  ok('with the right one, an account that made a player and a club is deleted (it was a foreign-key error)', right.r === 'deleted maker2@example.invalid' && (await gone(maker2)), right);
  const adm = await q(`select actor, detail::text d from audit_log where action = 'privacy.erase' and subject_id = $1`, [maker2]);
  ok('the audit row names the administrator who did it, and not the address', adm.length === 1 && adm[0].actor === boss && !/@/.test(adm[0].d) && /a platform administrator/.test(adm[0].d), adm);
  const self = await adminCall(`select platform_delete_account($1, 'boss@example.invalid') r`, [boss]);
  ok('an administrator cannot delete their own account there, nor another administrator\'s', self.e && /your own account/.test(self.e));
  const boss2 = await user('boss2@example.invalid');
  await db.exec(`insert into memberships (user_id, role, scope_type) values ('${boss2}', 'platform_admin', 'platform')`);
  const bossBoss = await adminCall(`select platform_delete_account($1, 'boss2@example.invalid') r`, [boss2]);
  ok('...another administrator\'s: revoke the role first', bossBoss.e && /revoke the role first/.test(bossBoss.e) && !(await gone(boss2)), bossBoss);
  const fanReq = await user('adminfan@example.invalid');
  const fanOpen = await request(fanReq, 'adminfan@example.invalid', 'erasure', 'self');
  await adminCall(`select platform_delete_account($1, 'adminfan@example.invalid') r`, [fanReq]);
  ok('an administrator deleting the account leaves the request open for them to close with their own words', (await st(fanOpen)).status === 'received' && !(await st(fanOpen)).closed);

  /* --------------------------------------------------- an account with roles --- */
  console.log('\nan account that holds roles (league administrator, club manager, statistician) is deleted too');
  const staff = await user('staff@example.invalid');
  const lg = (await one(`insert into leagues (slug, name) values ('role-league', 'Role League') returning id`)).id;
  const tm = (await one(`insert into teams (slug, name, league_id) values ('role-team', 'Role Team', $1) returning id`, [lg])).id;
  await db.exec(`insert into memberships (user_id, role, scope_type, scope_id) values ('${staff}', 'league_admin', 'league', '${lg}'), ('${staff}', 'team_manager', 'team', '${tm}'), ('${staff}', 'statistician', 'league', '${lg}')`);
  await db.exec(`insert into game_officials (game_id, user_id) select g.id, '${staff}' from games g limit 1`).catch(() => {});
  const staffDone = await del(staff, 'staff@example.invalid');
  ok('deleted, with the roles', staffDone.ok === true && (await gone(staff)) && (await one(`select count(*)::int n from memberships where user_id = $1`, [staff])).n === 0, staffDone);
  ok('...and the league and the club are still there', (await one(`select count(*)::int n from leagues where id = $1`, [lg])).n === 1 && (await one(`select count(*)::int n from teams where id = $1`, [tm])).n === 1);
  const roleAudit = await q(`select action, actor from audit_log where actor is not null and actor = $1`, [staff]);
  ok('no audit row is left naming the account as its actor', roleAudit.length === 0, roleAudit);

  /* ---------------------------------------------- what a fan has, and loses --- */
  console.log('\nand a plain fan loses what the privacy page says');
  const plain = await user('plain@example.invalid');
  await as(plain);
  await q(`select public.set_fan_prefs('{"theme":"dark"}'::jsonb)`).catch(() => {});
  await root();
  await db.exec(`insert into usernames (user_id, username) values ('${plain}', 'plainfan')`).catch(() => {});
  const has = async () => (await one(`select (select count(*)::int from fan_prefs where user_id = $1) prefs, (select count(*)::int from usernames where user_id = $1) names, (select count(*)::int from profiles where id = $1) prof`, [plain]));
  const hadBefore = await has();
  const plainDone = await del(plain, 'plain@example.invalid');
  const hadAfter = await has();
  ok('preferences, username and profile existed, and are gone', (hadBefore.prefs + hadBefore.names + hadBefore.prof) > 0 && hadAfter.prefs === 0 && hadAfter.names === 0 && hadAfter.prof === 0 && plainDone.ok === true, { hadBefore, hadAfter, plainDone });
}

/* ------------------------------------------------------------------- the page --- */
console.log('\nthe account page');
{
  const html = read('epinoia', 'me', 'index.html'), js = read('epinoia', 'me', 'me.js'), pv = read('epinoia', 'privacy', 'privacy.js'), pi = read('epinoia', 'privacy', 'index.html');
  ok('the link to the request form is gone from the account page, and a section with the confirmation is in its place',
     !/id="deleteAccount" href="\.\.\/privacy\/#delete"/.test(html) && /id="delSec"/.test(html) && /id="delConfirm"/.test(html) && /id="delGo"/.test(html) && /<section class="sec" id="delSec">/.test(html));
  ok('it says what goes and what stays, and where the form is for the cases it cannot do', /What goes/.test(html) && /What stays/.test(html) && /href="\.\.\/privacy\/#delete"/.test(html));
  ok('the button asks the database (delete_my_account), with what was typed, after the photographs\' files are removed', /rpc\('delete_my_account', \{ p_confirm:/.test(js) && /await removeMyPhotos\(\);/.test(js) && js.indexOf('await removeMyPhotos();') < js.indexOf("rpc('delete_my_account'"));
  ok('the photographs: listed with go_my_photos, files removed (go-public for an approved one, go-pending for the rest, none for a rejected one), the row removed with delete_go_photo',
     /rpc\('go_my_photos'\)/.test(js) && /'go-public' : 'go-pending'/.test(js) && /rpc\('delete_go_photo'/.test(js) && /status !== 'rejected'/.test(js));
  ok('the pending folder is swept for strays, so no file of theirs is left', /\.from\('go-pending'\)\.list\(/.test(js));
  ok('afterwards the session ends on this browser alone (the server one has no account to end), its stored choices are cleared and the page says it is done',
     /window\.epinoiaSignOut\(sb\)/.test(js) && /scope: 'local'/.test(js) && /Your account has been deleted/.test(js));
  ok('the privacy page tells a signed-in person they can do it themselves', /Delete my account/.test(pi) && /\.\.\/me\/#delete/.test(pi));
  ok('the request form is still there for whoever cannot', /id="delete"/.test(pi) && /chooseDelete/.test(pv));
  const docs = read('docs', 'ios-app.md');
  ok('the iOS notes say 5.1.1(v) is met by the self-service function', /5\.1\.1\(v\)[\s\S]{0,400}delete_my_account/.test(docs));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
