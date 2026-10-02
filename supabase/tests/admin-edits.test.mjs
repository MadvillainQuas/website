// 0214: EDITING FROM THE PAGE (docs/suggestions.md, "Editing directly"). First, with no database: the pages
// (adminedit.js, where it is wired in, how suggest.js hands over to it, and its words in Spanish and Japanese). Then
// on a real Postgres (PGlite; skipped with a note when it is not installed), the migration loaded on stand-ins for
// what it calls - auth.uid(), the tables, is_platform_admin / is_league_admin / is_team_manager as 0001 defines them,
// and the real suggestion_value / suggestion_owner (0199), approve_media (0122) and publish_team_logo (0073):
//   * who may edit: the platform's administrators anything; a league's administrators their league's clubs, players
//     and arenas and nobody else's; a club's manager their club and its players, never an arena; a fan or a signed-out
//     visitor nothing;
//   * only the listed columns, the whole patch refused for any other; every value checked; nothing written on a refusal;
//   * a crest and a photograph: only a pending row this caller uploaded, of this subject, published by the existing
//     doors; a club manager's photograph is refused (it waits for the league);
//   * an audit_log row for every edit, with who, as whom, and before and after; none for an edit that changed nothing.
//
//   node supabase/tests/admin-edits.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const M = mig('0214_admin_edits.sql');

/* ---------------------------------------------------------------------------- the pages (no database) --- */
console.log('the pages');
const EP = path.join(here, '..', '..', 'epinoia');
const src = f => readFileSync(path.join(EP, f), 'utf8');
const AE = createRequire(import.meta.url)(path.join(EP, 'adminedit.js'));
const P = src('p/index.html'), T = src('t/index.html'), pj = src('p/player.js'), tj = src('t/team.js'), SJ = src('suggest.js'), AJ = src('adminedit.js');
const before = (html, a, b) => html.indexOf(a) > 0 && html.indexOf(a) < html.indexOf(b);
ok('both pages load the editor after suggest.js and before their own script, and its sheet before legibility.css',
   before(P, '../suggest.js', '../adminedit.js') && before(P, '../adminedit.js', 'player.js?') &&
   before(T, '../suggest.js', '../adminedit.js') && before(T, '../adminedit.js', 'team.js?') &&
   before(P, 'kit/adminedit.css', 'kit/legibility.css') && before(T, 'kit/adminedit.css', 'kit/legibility.css'));
ok('the pages hand it their subject; the player page even for a player under 18 (the league edits him)',
   /EpinoiaAdminEdit\.mount\(\{ type: 'team'/.test(tj) && /EpinoiaAdminEdit\.mount\(\{ type: 'player'/.test(pj) &&
   pj.indexOf('EpinoiaAdminEdit.mount') < pj.indexOf('suggestFor = S && pl && pl.id && !pl.is_minor'));
ok('suggest.js hands a chip or the button to the editor only when it covers the detail, and otherwise opens the suggestion as before',
   /function setEditor\(/.test(SJ) && /editor && editor\.covers\(/.test(SJ) && /return \{ open, attach, button, setEditor,/.test(SJ));
ok('the editor asks the database first (admin_edit_rights), and saves through the three functions alone',
   /rpc\('admin_edit_rights'/.test(AJ) && /'admin_edit_team'/.test(AJ) && /'admin_edit_player'/.test(AJ) && /'admin_edit_venue'/.test(AJ) &&
   !/\/rest\/v1\/(teams|players|venues)\b[^'"`]*['"`],\s*\{\s*method:\s*'(PATCH|POST)'/.test(AJ));
const fields = (re) => [...new Set([...(re.exec(M) || ['', ''])[1].matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]))].sort().join(',');
ok('what the editor sends is what each function takes',
   AE.FIELDS.team.slice().sort().join(',') === fields(/k not in \(('name', 'short_name'[^)]*)\)/) &&
   AE.FIELDS.player.slice().sort().join(',') === fields(/k not in \(('first_name'[^)]*)\)/) &&
   AE.FIELDS.venue.slice().sort().join(',') === fields(/k not in \(('name', 'address'[^)]*)\)/), AE.FIELDS);
ok('a patch carries only what changed', JSON.stringify(AE.diff({ name: 'A', short_name: 'B', colour: '#112233' }, { name: 'A', short_name: 'C', colour: '#112233' })) === '{"short_name":"C"}' &&
   JSON.stringify(AE.diff({ height_cm: 206 }, { height_cm: '206' })) === '{}' && JSON.stringify(AE.diff({ colour_2: null }, { colour_2: '' })) === '{}');
ok('a crop keeps the frame\'s shape and stays on the picture', (() => {
  const c = AE.cropRect(1000, 600, 4 / 5, 1, 0.5, 0.5);
  const z = AE.cropRect(1000, 600, 4 / 5, 2, 1, 0);
  return Math.abs(c.w / c.h - 0.8) < 0.01 && c.h === 600 && c.x === 260 && z.h === 300 && z.x + z.w <= 1000 && z.y === 0;
})());
ok('the editor\'s words are in Spanish and Japanese (its own context in the dictionaries)',
   ['es', 'ja'].every(c => /\n      adminedit: \{\n/.test(src('i18n/' + c + '.js'))) && /setAttribute\('data-i18n-ctx', 'adminedit'\)/.test(AJ));

/* ------------------------------------------------------------------------------------ the database --- */
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database part: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('');
const fnFrom = (s, name) => {
  const i = s.indexOf('create or replace function public.' + name + '(');
  const a = s.indexOf('$$', i), b = s.indexOf('$$', a + 2);
  return s.slice(i, s.indexOf(';', b) + 1);
};

const PLAT = '44444444-4444-4444-4444-444444444444', LADMIN = '33333333-3333-3333-3333-333333333333',
      BADMIN = '55555555-5555-5555-5555-555555555555', MGR = '66666666-6666-6666-6666-666666666666',
      FAN = '11111111-1111-1111-1111-111111111111';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text);
  create table public.audit_log (id bigserial primary key, actor uuid, action text not null, subject text not null, subject_id text,
    detail jsonb not null default '{}', created_at timestamptz not null default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, logo_path text);
  create table public.venues (id uuid primary key default gen_random_uuid(), name text not null, address text, city text, lat double precision,
    lng double precision, pin_source text, pinned_at timestamptz, checked_by uuid, checked_at timestamptz);
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid, slug text, name text not null, short_name text not null default '',
    colour text not null default '#93f2bf', colour_2 text, colour_source text not null default 'default' check (colour_source in ('default','logo','manual')),
    initials text check (initials is null or initials ~ '^[A-Z0-9]{2,4}$'), logo_path text, aliases text[] not null default '{}',
    home_venue_id uuid, home_venue text, home_venue_address text);
  create unique index teams_league_initials_key on public.teams (league_id, initials) where initials is not null;
  create table public.players (id uuid primary key default gen_random_uuid(), slug text, first_name text not null, last_name text not null default '',
    is_minor boolean not null default false, photo_consent boolean not null default false, photo_media_id uuid, height_cm int, weight_kg int,
    wingspan_cm int, previous_club text, aliases text[] not null default '{}');
  create table public.roster_entries (id uuid primary key default gen_random_uuid(), team_id uuid, player_id uuid, position text,
    active boolean not null default true, created_at timestamptz not null default now());
  create table public.team_staff (id uuid primary key default gen_random_uuid(), team_id uuid not null, name text not null, role text not null,
    born_year int, sort int not null default 100, active boolean not null default true, created_at timestamptz not null default now());
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid, venue_id uuid, tipoff_at timestamptz);
  create type public.media_status as enum ('pending', 'approved', 'rejected');
  create table public.media (id uuid primary key default gen_random_uuid(), owner_type text not null, owner_id uuid not null, kind text not null default 'photo',
    storage_path text not null, width int, height int, bytes int, status public.media_status not null default 'pending', uploaded_by uuid, approved_by uuid,
    created_at timestamptz not null default now());
  create table public.usernames (user_id uuid primary key, username text not null);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, kind text not null, title text not null,
    body text not null default '', link text, league_id uuid, ref text not null, data jsonb not null default '{}', urgency text not null default 'normal',
    expires_at timestamptz, created_at timestamptz default now(), unique (user_id, kind, ref));
  create table public.username_blocklist (word text primary key, whole boolean not null default false);
  create table public.memberships (user_id uuid, role text, scope_type text, scope_id uuid);
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select true $$;
  /* 0001's three, on memberships */
  create function public.is_platform_admin() returns boolean language sql stable as $$
    select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'platform_admin' and m.scope_type = 'platform') $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$
    select public.is_platform_admin() or exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'league_admin'
      and m.scope_type = 'league' and m.scope_id = p) $$;
  create function public.is_team_manager(p uuid) returns boolean language sql stable as $$
    select public.is_platform_admin()
        or exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'team_manager' and m.scope_type = 'team' and m.scope_id = p)
        or exists (select 1 from teams t where t.id = p and t.league_id is not null and public.is_league_admin(t.league_id)) $$;
  ${fnFrom(mig('0167_go_photos.sql'), 'go_caption_ok')}
  ${fnFrom(mig('0036_club_contact_and_staff.sql'), 'staff_rank')}
`);
await db.exec(mig('0199_suggestions.sql'));
await db.exec(fnFrom(mig('0122_league_logo_colours.sql'), 'approve_media'));
await db.exec('drop function if exists public.publish_team_logo(uuid);' + fnFrom(mig('0073_reject_no_sql_delete.sql'), 'publish_team_logo'));
await db.exec(M);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

const [la] = await q(`insert into leagues (slug, name) values ('a', 'League A') returning id`);
const [lb] = await q(`insert into leagues (slug, name) values ('b', 'League B') returning id`);
const [arena] = await q(`insert into venues (name, address, city, lat, lng) values ('Old Hall', '1 High St', 'Town', 51.5, -0.1) returning id`);
const [ta] = await q(`insert into teams (league_id, slug, name, short_name, colour, home_venue_id, home_venue) values ($1, 'ta', 'Alpha Club', 'Alpha', '#112233', $2, 'Old Hall') returning id`, [la.id, arena.id]);
const [ta2] = await q(`insert into teams (league_id, slug, name, initials) values ($1, 'ta2', 'Another Alpha', 'ANA') returning id`, [la.id]);
const [tb] = await q(`insert into teams (league_id, slug, name) values ($1, 'tb', 'Beta Club') returning id`, [lb.id]);
const [pa] = await q(`insert into players (slug, first_name, last_name, height_cm) values ('pa', 'Jan', 'Vesely', 211) returning id`);
const [pb] = await q(`insert into players (slug, first_name, last_name) values ('pb', 'Bea', 'Other') returning id`);
const [kid] = await q(`insert into players (slug, first_name, last_name, is_minor) values ('kid', 'A', 'Kid', true) returning id`);
await q(`insert into roster_entries (team_id, player_id, position) values ($1, $2, 'C'), ($3, $4, 'G'), ($1, $5, 'G')`, [ta.id, pa.id, tb.id, pb.id, kid.id]);
await q(`insert into memberships values ($1, 'platform_admin', 'platform', null), ($2, 'league_admin', 'league', $3), ($4, 'league_admin', 'league', $5),
         ($6, 'team_manager', 'team', $7)`, [PLAT, LADMIN, la.id, BADMIN, lb.id, MGR, ta.id]);

const call = (fn, id, patch) => q(`select public.${fn}($1, $2::jsonb) as j`, [id, JSON.stringify(patch)]).then(r => r[0].j);
const rights = (type, id) => q(`select public.admin_edit_rights($1, $2) as j`, [type, id]).then(r => r[0].j);
const audits = async () => Number((await q(`select count(*)::int as n from audit_log where action = 'admin_edit'`))[0].n);

console.log('who may edit');
await as(LADMIN);
ok('a league\'s administrator: its club, its player and its arena, the photograph at once',
   (r => r.edit === true && r.role === 'league' && r.photo === 'direct')(await rights('team', ta.id)) &&
   (await rights('player', pa.id)).photo === 'direct' && (await rights('venue', arena.id)).edit === true);
ok('...and nothing in another league', (await rights('team', tb.id)).edit === false && (await rights('player', pb.id)).edit === false);
await as(MGR);
ok('a club\'s manager: the club and its players (a photograph waits for the league), never the arena',
   (await rights('team', ta.id)).role === 'club' && (await rights('player', pa.id)).photo === 'review' &&
   (await rights('venue', arena.id)).edit === false && (await rights('team', ta2.id)).edit === false);
await as(PLAT);
ok('the platform\'s administrators: everything', (await rights('team', tb.id)).role === 'platform' && (await rights('player', pb.id)).role === 'platform');
await as(FAN);
ok('a fan: nothing', (await rights('team', ta.id)).edit === false && (await rights('player', pa.id)).edit === false);

console.log('the refusals');
const n0 = await audits();
await as('');
ok('signed out: refused, and nothing written', /sign in/.test(await fails(() => call('admin_edit_team', ta.id, { name: 'X Club' }))));
await as(FAN);
ok('a fan: refused by the database, whatever the page shows', /cannot edit this club/.test(await fails(() => call('admin_edit_team', ta.id, { name: 'Fan Club' }))) &&
   /cannot edit this player/.test(await fails(() => call('admin_edit_player', pa.id, { height_cm: 200 }))) &&
   /cannot edit this arena/.test(await fails(() => call('admin_edit_venue', arena.id, { name: 'Fan Arena' }))));
await as(LADMIN);
ok('league A\'s administrator cannot edit league B\'s club or player', /cannot edit/.test(await fails(() => call('admin_edit_team', tb.id, { name: 'Taken Over' }))) &&
   /cannot edit/.test(await fails(() => call('admin_edit_player', pb.id, { first_name: 'Hacked' }))));
await as(MGR);
ok('a club\'s manager cannot edit another club, nor the arena', /cannot edit/.test(await fails(() => call('admin_edit_team', ta2.id, { short_name: 'Mine' }))) &&
   /cannot edit/.test(await fails(() => call('admin_edit_venue', arena.id, { city: 'Elsewhere' }))));
await as(LADMIN);
const bad = await call('admin_edit_team', ta.id, { name: 'Alpha Renamed', league_id: lb.id });
ok('a column outside the list refuses the whole patch (the good part is not written either)', bad.ok === false && bad.reason === 'field' && bad.field === 'league_id' &&
   (await q(`select name, league_id from teams where id = $1`, [ta.id]))[0].name === 'Alpha Club');
ok('...the same for a player (no slug, no consent, no minor flag) and an arena',
   (await call('admin_edit_player', pa.id, { is_minor: true })).reason === 'field' && (await call('admin_edit_player', pa.id, { slug: 'x' })).reason === 'field' &&
   (await call('admin_edit_venue', arena.id, { lat: 1 })).reason === 'field');
ok('every value checked: a name, a colour, initials, a height, a position, a pin',
   (await call('admin_edit_team', ta.id, { name: '<b>' })).field === 'name' && (await call('admin_edit_team', ta.id, { colour: 'red' })).field === 'colour' &&
   (await call('admin_edit_team', ta.id, { colour: '#12345' })).field === 'colour' && (await call('admin_edit_team', ta.id, { initials: 'TOOLONG' })).field === 'initials' &&
   (await call('admin_edit_player', pa.id, { height_cm: 300 })).field === 'height_cm' && (await call('admin_edit_player', pa.id, { position: 'striker' })).field === 'position' &&
   (await call('admin_edit_player', pa.id, { first_name: '' })).field === 'first_name' && (await call('admin_edit_player', pa.id, { first_name: 'J4n' })).field === 'first_name' &&
   (await call('admin_edit_venue', arena.id, { pin: '0,0' })).field === 'pin' && (await call('admin_edit_venue', arena.id, { name: '' })).field === 'name');
ok('a patch that is not an object is refused', (await call('admin_edit_team', ta.id, [1])).reason === 'patch');
ok('initials another club of the league has chosen: refused, and nothing of the patch kept',
   (await call('admin_edit_team', ta.id, { initials: 'ana', short_name: 'Kept?' })).reason === 'taken' &&
   (await q(`select short_name, initials from teams where id = $1`, [ta.id]))[0].short_name === 'Alpha');
ok('no audit row for any refusal', await audits() === n0);

console.log('the edits');
await as(LADMIN);
const e1 = await call('admin_edit_team', ta.id, { name: '  Alpha   Basket ', short_name: 'Alpha B', initials: 'alb', colour: '#AA0000', colour_2: '' });
const t1 = (await q(`select * from teams where id = $1`, [ta.id]))[0];
ok('a club: the name (spaces folded), short name, initials, colours, marked chosen by hand; the old name kept as an alias',
   e1.ok && t1.name === 'Alpha Basket' && t1.short_name === 'Alpha B' && t1.initials === 'ALB' && t1.colour === '#aa0000' && t1.colour_2 === null &&
   t1.colour_source === 'manual' && t1.aliases.includes('Alpha Club') && e1.team.name === 'Alpha Basket', e1);
const a1 = (await q(`select * from audit_log where action = 'admin_edit' order by id desc limit 1`))[0];
ok('...audited: who, as whom, before and after, only what changed (colour_2 was empty already)',
   a1.actor === LADMIN && a1.subject === 'team' && a1.subject_id === ta.id && a1.detail.as === 'league' &&
   a1.detail.before.name === 'Alpha Club' && a1.detail.after.name === 'Alpha Basket' && a1.detail.after.colour === '#aa0000' &&
   !('colour_2' in a1.detail.after) && e1.changed.length === 4, a1);
const nSame = await audits();
const same = await call('admin_edit_team', ta.id, { name: 'Alpha Basket' });
ok('an edit that changes nothing writes nothing', same.ok && same.changed.length === 0 && await audits() === nSame);

const e2 = await call('admin_edit_player', pa.id, { first_name: 'Jan', last_name: 'Veselý', height_cm: '213', weight_kg: 110, position: 'pf', previous_club: '' });
const p2 = (await q(`select * from players where id = $1`, [pa.id]))[0];
ok('a player: his name, measures and position (on his squad entry); the old name kept as an alias',
   e2.ok && p2.last_name === 'Veselý' && p2.height_cm === 213 && p2.weight_kg === 110 && p2.aliases.includes('Jan Vesely') &&
   (await q(`select position from roster_entries where player_id = $1`, [pa.id]))[0].position === 'PF' && e2.player.position === 'PF' &&
   JSON.stringify(e2.changed.sort()) === JSON.stringify(['height_cm', 'last_name', 'position', 'weight_kg']), e2);
const a2 = (await q(`select detail from audit_log where action = 'admin_edit' and subject = 'player' order by id desc limit 1`))[0].detail;
ok('...audited with before and after', a2.before.height_cm === 211 && a2.after.height_cm === 213 && a2.before.position === 'C' && a2.after.position === 'PF', a2);
ok('...a player known by one name may have no last name; a measure may be cleared',
   (await call('admin_edit_player', pa.id, { last_name: '', weight_kg: null })).ok &&
   (await q(`select last_name, weight_kg from players where id = $1`, [pa.id])).every(r => r.last_name === '' && r.weight_kg === null));
await as(MGR);
ok('a club\'s manager edits his own player', (await call('admin_edit_player', pa.id, { last_name: 'Vesely' })).ok);
await as(LADMIN);
ok('the league edits a player under 18 too (his details are the league\'s)', (await call('admin_edit_player', kid.id, { height_cm: 190 })).ok);

const e3 = await call('admin_edit_venue', arena.id, { name: 'New Hall', city: 'Bigtown', pin: '41.3809, 2.1206', address: '1 High St' });
const v3 = (await q(`select * from venues where id = $1`, [arena.id]))[0];
ok('an arena: its name (and the club\'s typed copy of it), city and pin, marked set by hand; an unchanged address untouched',
   e3.ok && v3.name === 'New Hall' && v3.city === 'Bigtown' && Math.abs(v3.lat - 41.3809) < 1e-9 && v3.pin_source === 'manual' && v3.checked_by === LADMIN &&
   (await q(`select home_venue from teams where id = $1`, [ta.id]))[0].home_venue === 'New Hall' && !e3.changed.includes('address'), e3);

console.log('pictures');
const crestPath = `team/${ta.id}/logo-k3x9abcd.webp`;
await q(`insert into storage.objects (bucket_id, name) values ('media-public', $1)`, [crestPath]);
await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('team', $1, 'logo', $2, $3)`, [ta.id, `team/${ta.id}/logo-oldone12.webp`, LADMIN]);
const [old] = await q(`select id from media where storage_path like '%oldone12%'`);
await q(`update media set status = 'approved' where id = $1`, [old.id]);
await q(`update teams set logo_path = $1 where id = $2`, [`team/${ta.id}/logo-oldone12.webp`, ta.id]);
const [crest] = await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('team', $1, 'logo', $2, $3) returning id`, [ta.id, crestPath, MGR]);
await as(LADMIN);
ok('a crest someone else uploaded is refused', (await call('admin_edit_team', ta.id, { logo_media: crest.id })).reason === 'media');
await as(MGR);
const e4 = await call('admin_edit_team', ta.id, { logo_media: crest.id });
ok('the club\'s manager publishes his own crest: the club shows it, the old row goes and its file is handed back to delete',
   e4.ok && (await q(`select logo_path from teams where id = $1`, [ta.id]))[0].logo_path === crestPath && JSON.stringify(e4.orphans) === JSON.stringify([`team/${ta.id}/logo-oldone12.webp`]) &&
   (await q(`select status from media where id = $1`, [crest.id]))[0].status === 'approved', e4);
const a4 = (await q(`select detail from audit_log where action = 'admin_edit' and subject = 'team' order by id desc limit 1`))[0].detail;
ok('...audited, the old crest before and the new after', a4.before.logo_path === `team/${ta.id}/logo-oldone12.webp` && a4.after.logo_path === crestPath && a4.as === 'club', a4);
ok('a crest of another club, or a path that is not a crest, is refused', await (async () => {
  const [x] = await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('team', $1, 'logo', $2, $3) returning id`, [ta.id, `team/${tb.id}/logo-zzzzzzzz.webp`, MGR]);
  const [y] = await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('team', $1, 'logo', $2, $3) returning id`, [ta.id, `team/${ta.id}/../logo-zzzz.webp`, MGR]);
  return (await call('admin_edit_team', ta.id, { logo_media: x.id })).reason === 'media' && (await call('admin_edit_team', ta.id, { logo_media: y.id })).reason === 'media' &&
         (await call('admin_edit_team', ta.id, { logo_media: 'not-a-uuid' })).reason === 'media';
})());
const photoPath = `player/${pa.id}/photo-p0p0p0p0.webp`;
await q(`insert into storage.objects (bucket_id, name) values ('media-public', $1)`, [photoPath]);
const [ph] = await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('player', $1, 'photo', $2, $3) returning id`, [pa.id, photoPath, MGR]);
ok('a club manager\'s photograph is refused here: it waits in the league\'s Photographs', (await call('admin_edit_player', pa.id, { photo_media: ph.id })).reason === 'photo_review');
const nostore = `player/${pa.id}/photo-nofile11.webp`;
await as(LADMIN);
const [ph2] = await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('player', $1, 'photo', $2, $3) returning id`, [pa.id, nostore, LADMIN]);
ok('a photograph whose file is not in the public bucket is refused', (await call('admin_edit_player', pa.id, { photo_media: ph2.id })).reason === 'media');
await q(`insert into storage.objects (bucket_id, name) values ('media-public', $1)`, [nostore]);
const e5 = await call('admin_edit_player', pa.id, { photo_media: ph2.id });
ok('the league\'s administrator publishes his photograph at once (approve_media), audited',
   e5.ok && e5.player.photo_path === nostore && (await q(`select photo_media_id from players where id = $1`, [pa.id]))[0].photo_media_id === ph2.id &&
   (await q(`select detail from audit_log where action = 'admin_edit' and subject = 'player' order by id desc limit 1`))[0].detail.after.photo === nostore, e5);
const kidPath = `player/${kid.id}/photo-kidkid11.webp`;
await q(`insert into storage.objects (bucket_id, name) values ('media-public', $1)`, [kidPath]);
const [ph3] = await q(`insert into media (owner_type, owner_id, kind, storage_path, uploaded_by) values ('player', $1, 'photo', $2, $3) returning id`, [kid.id, kidPath, LADMIN]);
ok('...but never of a player under 18 without a guardian\'s consent (approve_media\'s own check)',
   /guardian consent/.test(await fails(() => call('admin_edit_player', kid.id, { photo_media: ph3.id }))) &&
   (await q(`select photo_media_id from players where id = $1`, [kid.id]))[0].photo_media_id === null);

console.log('grants');
const grant = (role, sig) => q(`select has_function_privilege($1, $2, 'execute') as g`, [role, sig]).then(r => r[0].g);
ok('a signed-out visitor can call none of them; a signed-in one the four, never the internal checks',
   !(await grant('anon', 'public.admin_edit_team(uuid, jsonb)')) && !(await grant('anon', 'public.admin_edit_player(uuid, jsonb)')) &&
   !(await grant('anon', 'public.admin_edit_venue(uuid, jsonb)')) && !(await grant('anon', 'public.admin_edit_rights(text, uuid)')) &&
   await grant('authenticated', 'public.admin_edit_team(uuid, jsonb)') && await grant('authenticated', 'public.admin_edit_rights(text, uuid)') &&
   !(await grant('authenticated', 'public.admin_edit_role(text, uuid)')) && !(await grant('authenticated', 'public.admin_edit_media(uuid, text, uuid, text)')));
ok('every one is a security definer with search_path = public', (await q(`select count(*)::int as n from pg_proc where proname like 'admin_edit_%' and prosecdef
   and array_to_string(proconfig, ',') = 'search_path=public'`))[0].n === 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
