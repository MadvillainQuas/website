// 0224 (the dashboard's head) and 0225 (reports in the dashboard), on a real Postgres (PGlite; skipped with a note when
// it is not installed - PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). 0221, 0224 and 0225 are
// loaded on the minimum schema they read. What is held here:
//   * a fan sets their own title and banner, trimmed to one line, 40 characters, five banners, blank = the page's;
//   * an address's reports are its account's: the account signed in with it (confirmed, any case), or the account
//     hooked up to it, and then that one alone; nobody else's, signed out nothing;
//   * my_reports: linked or not, the clubs, the files newest first; report_seen marks the caller's own, once;
//   * the stored file is readable only by its own account (the storage policy) and platform administrators;
//   * all three run twice.
//
//   node supabase/tests/dashboard.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw !== undefined ? '  (saw ' + JSON.stringify(saw) + ')' : '')); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const M21 = mig('0221_report_mail.sql'), M24 = mig('0224_dashboard.sql'), M25 = mig('0225_report_inbox.sql');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, allowed_mime_types text[], file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated; grant select on storage.objects to authenticated;
  create table public.teams (id uuid primary key, name text, slug text, colour text, logo_path text);
  create table public.fan_prefs (user_id uuid primary key references auth.users on delete cascade, theme text not null default 'dark',
    colour text not null default '#93f2bf', fav_team_ids uuid[] not null default '{}', updated_at timestamptz not null default now());
  alter table public.fan_prefs enable row level security;
  create policy fan_prefs_own on public.fan_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.padmin', true), 'no') = 'yes' $$;
  grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
  grant select, insert, update on public.fan_prefs to authenticated; grant select on public.teams to anon, authenticated;
`);
for (let i = 0; i < 2; i++) { await db.exec(M21); await db.exec(M24); await db.exec(M25); }
ok('0221, 0224 and 0225 each run twice', true);

const U1 = '00000000-0000-0000-0000-0000000000e1', U2 = '00000000-0000-0000-0000-0000000000e2', U3 = '00000000-0000-0000-0000-0000000000e3', U4 = '00000000-0000-0000-0000-0000000000e4';
const T1 = '00000000-0000-0000-0000-0000000000a1', T2 = '00000000-0000-0000-0000-0000000000a2';
const S1 = '00000000-0000-0000-0000-0000000000b1', S2 = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`
  insert into auth.users values ('${U1}', 'Coach@Example.com', now()), ('${U2}', 'fan@example.com', now()),
    ('${U3}', 'scout@example.com', null), ('${U4}', 'other@example.com', now());
  insert into public.teams values ('${T1}', 'Illawarra Hawks', 'hawks', '#e01837', null), ('${T2}', 'Sydney Kings', 'kings', '#4b2a83', null);
  insert into public.report_mail_subs (id, email, team_id) values ('${S1}', 'coach@example.com', '${T1}'), ('${S2}', 'scout@example.com', '${T2}');
  insert into public.report_files (sub_id, kind, ref, title, subtitle, path, bytes, made_at) values
    ('${S1}', 'game', 'g1', 'Game analysis: Illawarra Hawks 114–94 Adelaide 36ers', 'NBL · Fri 2 Oct', '${S1}/2026-10-02/game-analysis.pdf', 900000, '2026-10-02T12:00Z'),
    ('${S1}', 'opp', '2026-10-04:kings', 'Scouting report: Sydney Kings', 'Week of Mon 5 Oct', '${S1}/2026-10-04/scouting-report-sydney-kings.pdf', 1200000, '2026-10-04T08:00Z'),
    ('${S1}', 'team', '2026-10-04', 'Team report: Illawarra Hawks', null, '${S1}/2026-10-04/team-report-illawarra-hawks.pdf', 1500000, '2026-10-04T08:00Z'),
    ('${S2}', 'opp', '2026-10-04:hawks', 'Scouting report: Illawarra Hawks', null, '${S2}/2026-10-04/scouting-report-illawarra-hawks.pdf', 1100000, '2026-10-04T08:00Z');
  insert into storage.objects (bucket_id, name) select 'reports', path from public.report_files;
`);
const as = async (uid, sql, o = {}) => {
  await db.exec(`reset role; set test.uid = '${uid || ''}'; set test.padmin = '${o.padmin || 'no'}';` + (o.role === false ? '' : ' set role authenticated;'));
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const err = async (uid, sql) => { try { await as(uid, sql); return null; } catch (e) { return e.message; } };

console.log('\nthe head');
{
  const r = (await as(U2, `select public.set_dashboard('  Sam''s   corner\n ', 'stripes') v`))[0].v;
  ok('a fan sets a title of their own, folded onto one line and trimmed, and a banner', r.title === "Sam's corner" && r.banner === 'stripes', r);
  const row = (await as(U2, `select dash_title, dash_banner from public.fan_prefs where user_id = '${U2}'`))[0];
  ok('...on their own row, read with the rest of it', row && row.dash_title === "Sam's corner" && row.dash_banner === 'stripes', row);
  ok('a blank title puts the page\'s back, the banner kept', (await as(U2, `select public.set_dashboard('   ') v`))[0].v.title === null &&
     (await as(U2, `select dash_banner b from public.fan_prefs`))[0].b === 'stripes');
  ok('more than 40 characters is refused', /40 characters/.test(await err(U2, `select public.set_dashboard(repeat('x', 41), null)`)));
  ok('a banner that does not exist is refused', /plain, glow, stripes, grid or club/.test(await err(U2, `select public.set_dashboard('A', 'neon')`)));
  ok('signed out, nothing', /sign in first/.test(await err(null, `select public.set_dashboard('A', 'grid')`)));
  ok('a new fan\'s banner is the glow', (await as(U4, `select public.set_dashboard('Mine') v`))[0].v.banner === 'glow');
  ok('the table refuses a line break written past the function', /check/.test(await err(U4, `update public.fan_prefs set dash_title = e'a\\nb' where user_id = '${U4}'`) || ''));
}

console.log('\nwhose reports');
{
  const mine = async uid => (await as(uid, `select public.my_reports() v`))[0].v;
  const c = await mine(U1);
  ok('the account signed in with the address (any case) has its reports, newest first', c.linked === true && c.files.length === 3 &&
     c.files[0].made_at >= c.files[2].made_at && c.files.every(f => f.club === 'Illawarra Hawks'), c.files.map(f => f.title));
  ok('...with its club', c.clubs.length === 1 && c.clubs[0].name === 'Illawarra Hawks' && c.clubs[0].colour === '#e01837');
  ok('...each with its kind, title, line, date, size and opened state', c.files.some(f => f.kind === 'game' && f.subtitle === 'NBL · Fri 2 Oct' && f.bytes === 900000 && f.seen_at === null));
  const s = await mine(U3);
  ok('an address not yet confirmed is nobody\'s', s.linked === false && s.files.length === 0, s);
  const o = await mine(U4);
  ok('another account sees none of them', o.linked === false && o.files.length === 0 && o.clubs.length === 0);
  ok('signed out, the function is not there to call', /permission denied/.test(await err(null, `select public.my_reports() v`) || '') ||
     (await as(null, `select public.my_reports() v`))[0].v.linked === false);
  await db.exec(`update public.report_mail_subs set user_id = '${U4}' where id = '${S2}'`);
  ok('hooked up to an account: that account has them, whatever its address', (await mine(U4)).files.length === 1 && (await mine(U4)).files[0].title === 'Scouting report: Illawarra Hawks');
  await db.exec(`update auth.users set email_confirmed_at = now() where id = '${U3}'`);
  ok('...and the account with the address does not', (await mine(U3)).files.length === 0);
  ok('the files are not readable as a table but through the function', (await as(U1, `select count(*)::int n from public.report_files`))[0].n === 0 &&
     (await as(U1, `select count(*)::int n from public.report_files`, { padmin: 'yes' }))[0].n === 4);
}

console.log('\nopened');
{
  const ids = (await as(U1, `select public.my_reports() v`))[0].v.files.map(f => f.id);
  const theirs = (await as(U4, `select public.my_reports() v`))[0].v.files.map(f => f.id);
  ok('report_seen marks the caller\'s own', (await as(U1, `select public.report_seen(array['${ids[0]}', '${theirs[0]}']::uuid[]) n`))[0].n === 1);
  const after = (await as(U1, `select public.my_reports() v`))[0].v.files;
  ok('...it is no longer new, and the others still are', after.filter(f => f.seen_at).length === 1 && after.find(f => f.id === ids[0]).seen_at);
  ok('...not someone else\'s', (await as(U4, `select public.my_reports() v`))[0].v.files[0].seen_at === null);
  const first = after.find(f => f.id === ids[0]).seen_at;
  ok('opening it again keeps the first time', (await as(U1, `select public.report_seen(array['${ids[0]}']::uuid[]) n`))[0].n === 0 &&
     (await as(U1, `select public.my_reports() v`))[0].v.files.find(f => f.id === ids[0]).seen_at === first);
}

console.log('\nthe stored files');
{
  const see = async (uid, o) => (await as(uid, `select name from storage.objects where bucket_id = 'reports' order by name`, o)).map(r => r.name);
  ok('an account reads its own files', (await see(U1)).length === 3 && (await see(U1)).every(n => n.startsWith(S1)));
  ok('...and only its own', (await see(U4)).length === 1 && (await see(U4))[0].startsWith(S2) && (await see(U3)).length === 0);
  ok('a platform administrator reads them all', (await see(U3, { padmin: 'yes' })).length === 4);
  const b = (await as(null, `select public, allowed_mime_types from storage.buckets where id = 'reports'`, { role: false }))[0];
  ok('the bucket is private and takes PDFs only', b.public === false && JSON.stringify(b.allowed_mime_types) === '["application/pdf"]');
  let bad = null;
  try { await db.query(`insert into public.report_files (sub_id, kind, ref, title, path) values ('${S1}', 'game', 'x', 'X', '../../etc/passwd')`); } catch (e) { bad = e.message; }
  ok('a stored path names its address and ends .pdf', /check/.test(bad || ''), bad);
  ok('...and a fan cannot write one at all', /permission denied/.test(await err(U1, `insert into public.report_files (sub_id, kind, ref, title, path) values ('${S1}', 'game', 'y', 'Y', '${S1}/x.pdf')`) || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
