/* ============================================================================
   FREE TRIALS (0275; Louie, 2026-10-16): how long a report address or an account's access given by email lasts, the end moved
   on in the console, and what happens when it ends - nothing more goes, and one email says so.

     node supabase/tests/trials.test.mjs        (the database half SKIPS where PGlite is not installed: PGLITE_DIR)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '\n          ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 900))); } };

/* ------------------------------------------------------------------ the migration --- */
const mig = read('supabase', 'migrations', '0275_trials.sql');
console.log('the migration');
ok('a trial\'s end and its email on both report tables, the email on the grants',
   /report_mail_subs\s+add column if not exists trial_until timestamptz/.test(mig) && /report_mail_players add column if not exists trial_until timestamptz/.test(mig) &&
   /report_mail_subs\s+add column if not exists trial_notified_at timestamptz/.test(mig) && /access_grants\s+add column if not exists ended_notified_at timestamptz/.test(mig));
ok('set_access_grant_expiry: for the signed in only, never anon', /revoke execute on function public\.set_access_grant_expiry\(uuid, timestamptz\) from public, anon;/.test(mig) &&
   /grant execute on function public\.set_access_grant_expiry\(uuid, timestamptz\) to authenticated, service_role;/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed: the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0275 among them', !failed || failed.length === 0, failed);
  const as = async uid => {
    await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : {})}', false)`);
    await db.exec(uid ? 'set role authenticated' : 'set role anon');
  };
  const root = async () => { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`); };
  const call = async (uid, sql, params) => { await as(uid); try { return { r: await q(sql, params) }; } catch (e) { return { e: e.message }; } finally { await root(); } };
  const user = async email => (await one(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [email])).id;
  const boss = await user('boss@epinoia.test'), fan = await user('fan@epinoia.test');
  await db.exec(`insert into memberships (user_id, role, scope_type) values ('${boss}', 'platform_admin', 'platform')`);
  const g = (await one(`insert into access_grants (email, features, expires_at) values ('coach@club.test', '{club_report}', now() + interval '3 days') returning id`)).id;
  const later = new Date(Date.now() + 40 * 864e5).toISOString();

  console.log('\nan account\'s access given by email: its end moved');
  let x = await call(fan, `select public.set_access_grant_expiry($1, $2)`, [g, later]);
  ok('somebody who is not a platform administrator cannot move a platform-wide grant\'s end', /only a platform administrator/.test(x.e || ''), x);
  x = await call(null, `select public.set_access_grant_expiry($1, $2)`, [g, later]);
  ok('...nor anybody signed out', !!x.e, x);
  await db.exec(`update access_grants set ended_notified_at = now() where id = '${g}'`);
  x = await call(boss, `select public.set_access_grant_expiry($1, $2)`, [g, later]);
  let row = await one(`select expires_at, ended_notified_at from access_grants where id = $1`, [g]);
  ok('a platform administrator moves it on: the new end, and its ended email cleared (a trial extended and ended again is said again)',
     !x.e && Math.abs(new Date(row.expires_at).getTime() - Date.parse(later)) < 1000 && row.ended_notified_at === null, [x, row]);
  ok('...audited', (await one(`select count(*)::int n from audit_log where action = 'set_access_grant_expiry' and subject_id = $1`, [g])).n === 1);
  x = await call(boss, `select public.set_access_grant_expiry($1, null)`, [g]);
  ok('...or takes the end off', !x.e && (await one(`select expires_at from access_grants where id = $1`, [g])).expires_at === null, x);
  x = await call(boss, `select public.set_access_grant_expiry($1, now() - interval '1 day')`, [g]);
  ok('...never to a day already gone', /already passed/.test(x.e || ''), x);
  await db.exec(`update access_grants set expires_at = now() - interval '2 days' where id = '${g}'`);
  x = await call(boss, `select public.set_access_grant_expiry($1, $2)`, [g, later]);
  ok('an access whose trial has ended is given back by moving its end on', !x.e && new Date((await one(`select expires_at from access_grants where id = $1`, [g])).expires_at).getTime() > Date.now(), x);
  await db.exec(`update access_grants set revoked_at = now() where id = '${g}'`);
  x = await call(boss, `select public.set_access_grant_expiry($1, $2)`, [g, later]);
  ok('...but one taken away is given again, not moved', /taken away/.test(x.e || ''), x);
  x = await call(boss, `update report_mail_players set trial_until = now() where false`);
  ok('the report addresses\' columns are there', !x.e, x);
}

/* ------------------------------------------------------------------ the mailer --- */
console.log('\nthe mailer');
process.env.SUPABASE_URL = 'https://db.example'; process.env.SUPABASE_SERVICE_KEY = 'k'; process.env.RESEND_API_KEY = 're_test';
delete process.env.ONLY; delete process.env.DRY;
const M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'report_mailer.mjs')).href);
const NOW = new Date('2026-11-02T09:00:00Z');
ok('a trial is over from its end on; none, or one still to come, is not', M.trialOver({ trial_until: '2026-11-01T23:59:59Z' }, NOW) && !M.trialOver({ trial_until: null }, NOW) &&
   !M.trialOver({ trial_until: '2026-11-30T23:59:59Z' }, NOW) && !M.trialOver({}, NOW));
let E = M.trialEndedEmail({ name: 'Sam', what: 'Leeds Force reports', until: '2026-11-01T23:59:59Z', join: null });
ok('the email: "Your free trial of Leeds Force reports has ended", the day, and - memberships off - a reply to keep them',
   E.subject === 'Your free trial of Leeds Force reports has ended' && /ended on 1 November 2026/.test(E.html) && /simply reply to this email/.test(E.html) && /Hi Sam,/.test(E.html), E.subject);
E = M.trialEndedEmail({ name: null, what: 'the analytics on Epinoia', until: '2026-11-01T23:59:59Z', join: 'https://prophesyscouting.co.uk/epinoia/join/' });
ok('...with memberships on, the join page to subscribe', /href="https:\/\/prophesyscouting\.co\.uk\/epinoia\/join\/"/.test(E.html) && !/simply reply to this email and we will set it up/.test(E.html));

/* a stand-in database and Resend */
const W = { sent: [], patched: [], grants: [], live: [], members: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url), body = opt.body ? JSON.parse(opt.body) : null;
  const res = x => ({ ok: true, status: 200, text: async () => JSON.stringify(x), json: async () => x });
  if (u.startsWith('https://api.resend.com/')) { W.sent.push(body); return res({ id: 'm' }); }
  const p = u.replace('https://db.example/rest/v1/', '');
  if (p.startsWith('platform_settings?key=eq.memberships_enabled')) return res([{ value: W.members }]);
  if (p.startsWith('access_grants?revoked_at=is.null&ended_notified_at=is.null')) return res(W.grants);
  if (p.startsWith('access_grants?revoked_at=is.null&email=in.')) return res(W.live);
  if ((opt.method || 'GET') === 'PATCH') { W.patched.push([p, body]); return res(null); }
  if (p.startsWith('report_mail_players?active=eq.true')) return res(W.players || []);
  return res([]);
};
W.grants = [{ id: 'g1', email: 'coach@club.test', features: ['club_report', 'player_report'], expires_at: '2026-11-01T23:59:59Z', league_id: null },
            { id: 'g2', email: 'scout@club.test', features: ['analytics'], expires_at: '2026-11-01T23:59:59Z', league_id: null }];
W.live = [{ email: 'scout@club.test', features: ['analytics', 'club_report'], league_id: null }];
M.newRun();
const told = await M.grantEnds(NOW);
ok('an account\'s access that has ended: told once, what it was ("the club reports and the player reports on Epinoia")',
   told === 1 && W.sent.length === 1 && W.sent[0].to[0] === 'coach@club.test' && /the club reports and the player reports on Epinoia/.test(W.sent[0].subject), W.sent.map(s => s.subject));
ok('...one still given the same by another grant (a trial followed by a longer one) is not told',
   !W.sent.some(s => s.to[0] === 'scout@club.test'));
ok('...and both marked, so neither is asked about again', W.patched.filter(([p, b]) => /^access_grants\?id=eq\.g[12]$/.test(p) && b.ended_notified_at).length === 2, W.patched);

/* the players' round: a trial over, nothing sent and told once */
W.sent = []; W.patched = [];
W.players = [{ id: 'pp1', email: 'sam@example.com', name: 'Sam', player_id: 'pl1', tz: 'Europe/London', active: true, send_now_at: null, trial_until: '2026-11-01T23:59:59Z', trial_notified_at: null,
  players: { id: 'pl1', first_name: 'Sam', last_name: 'Smith', slug: 'sam-smith' } }];
M.newRun();
await M.playerRound(new Date('2026-11-02T09:30:00Z'));
ok('a player\'s address whose trial has ended: no report on the Monday, the email that it has ended, and it is marked',
   W.sent.length === 1 && W.sent[0].subject === 'Your free trial of Sam Smith player report has ended' && W.sent[0].attachments.length === 0 &&
   W.patched.some(([p, b]) => /^report_mail_players\?id=in\.\(pp1\)$/.test(p) && b.trial_notified_at), [W.sent.map(s => s.subject), W.patched]);
W.sent = [];
W.players[0].trial_notified_at = '2026-11-02T08:30:00Z';
W.players[0].send_now_at = '2026-11-02T09:00:00Z';
await M.playerRound(new Date('2026-11-02T10:00:00Z'));
ok('...told once only; and a "send now" for it sends nothing, the console told to extend it', !W.sent.length &&
   W.patched.some(([p, b]) => /^report_mail_players\?id=eq\.pp1$/.test(p) && b.send_now_at === null && /free trial ended on 1 November 2026/.test(b.last_detail)), W.patched);
globalThis.fetch = realFetch;

/* the code paths */
const MJ = read('scripts', 'report_mailer.mjs');
ok('the clubs\' round: an address told once for all its clubs, and none of its clubs\' reports sent',
   /const over = subs\.filter\(s => trialOver\(s\)/.test(MJ) && /if \(trialOver\(s\)\) continue;\s*try \{ failed \+= \(await one\(s,/.test(MJ));
ok('...and a club\'s "send now" for it sends nothing, saying why', /if \(trialOver\(s, now\)\) \{ await mark\('nothing', 'Their free trial ended on '/.test(MJ));
const PJ = read('epinoia', 'admin', 'platform', 'platform.js'), RJ = read('epinoia', 'admin', 'platform', 'reports-manager.js');
ok('the console: one set of controls (a length when adding; once added, moved on from today or the end, to a day, or taken off)',
   /const TRIAL = \(\(\) => \{/.test(PJ) && /\['14', 'free trial: 2 weeks'\], \['30', 'free trial: 1 month'\], \['91', 'free trial: 3 months'\]/.test(PJ) &&
   /const from = Math\.max\(now, base \? Date\.parse\(base\) \|\| now : now\);/.test(PJ) && /trial: TRIAL \}, which\)/.test(PJ));
ok('...on access given by email (set_access_grant_expiry), a club address (all its clubs) and a player\'s address',
   /sb\.rpc\('set_access_grant_expiry', \{ p_grant: g\.id, p_expires: end \}\)/.test(PJ) &&
   /from\('report_mail_subs'\)\.update\(\{ trial_until: end, trial_notified_at: null \}\)\.in\('id', list\.map\(r => r\.id\)\)/.test(RJ) &&
   /from\('report_mail_players'\)\.update\(\{ trial_until: end, trial_notified_at: null \}\)\.eq\('id', x\.id\)/.test(RJ));
ok('...an address whose trial has ended offers no "send now"', /const live = ended \? \[\] : list\.filter\(r => r\.active\);/.test(RJ) && /if \(x\.active && !\(H\.trial && H\.trial\.over\(x\.trial_until\)\)\)/.test(RJ));

if (fail) { console.log(`\n${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\nfree trials: ${pass} passed`);
