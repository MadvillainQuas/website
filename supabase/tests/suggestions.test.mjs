// 0199: SUGGESTED EDITS, on a real Postgres (PGlite; skipped with a note when it is not installed). The migration is
// loaded on stand-ins for what it calls: auth.uid() and auth.users, leagues, teams, players, roster_entries,
// team_staff (0036, with its real staff_rank), venues, games / competitions / seasons, media (its real status type),
// usernames, notifications, audit_log, storage.objects, league_visible / is_league_admin / is_platform_admin, and the
// real go_caption_ok (0167). What is held here:
//   * a fan suggests a detail: signed in, a field of its kind, a value checked as the console checks it, not the
//     same as what is there, never about a player under 18, never on a league they may not see; their newer word on
//     the same detail replaces the older; 30 waiting at most;
//   * where it goes: the league of the player's club, of the staff's club, of the club an arena is home to (else of
//     its latest game) - and the moderators of that league and the platform's see it, nobody else;
//   * accepting makes the change (a measure, a name, a position on the active entry, a new coach ranked like the
//     console ranks them, a pin marked set by hand), with the moderator's correction if they made one, and every
//     other fan who said the same is accepted too; rejecting changes nothing; each fan is told either way;
//   * a photograph: a file in the subject's folder named suggested-…, the fan's own, becomes a pending image in
//     Photographs, and what Photographs decides, the suggestion follows;
//   * the table is shut, and who may call what.
// And first, with no database: the pages (suggest.js and where it is wired in, the consoles' queue, the words in
// Spanish and Japanese) - a height in feet and inches, a pin from a Google Maps link, the fields and positions the
// database takes, and every page offering it the way docs/suggestions.md says.
//
//   node supabase/tests/suggestions.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

/* ---------------------------------------------------------------------------- the pages (no database) --- */
console.log('the pages');
const EP = path.join(here, '..', '..', 'epinoia');
const src = f => readFileSync(path.join(EP, f), 'utf8');
const S = createRequire(import.meta.url)(path.join(EP, 'suggest.js'));
ok('feet and inches go in as whole centimetres, pounds as kilograms (the database keeps cm and kg)',
   S.toCm(6, 9) === 206 && S.toCm(6, 11) === 211 && S.toCm('', '') === null && S.toKg(243) === 110 && S.toKg('') === null);
ok('a place on the map from what Google Maps gives: the two numbers, or a link (the place in it, not where the map looked)',
   S.readPin('41.3809, 2.1206') === '41.380900,2.120600' &&
   S.readPin('https://www.google.com/maps/place/X/@41.38,2.11,17z/data=!3m1!4b1!4m6!3m5!1s0x1:0x2!8m2!3d41.380947!4d2.120598') === '41.380947,2.120598' &&
   S.readPin('https://maps.google.com/?q=40.4241,-3.6718') === '40.424100,-3.671800' &&
   S.readPin('0, 0') === null && S.readPin('91, 2') === null && S.readPin('the Palau') === null);
const m199 = mig('0199_suggestions.sql');
const okBody = m199.slice(m199.indexOf('function public.suggestion_field_ok'), m199.indexOf('$$;', m199.indexOf('function public.suggestion_field_ok')));
const sqlFields = [...new Set([...okBody.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(f => !['player', 'team', 'staff', 'venue'].includes(f)))];
ok('every detail the database takes has its form on the page, with the database\'s own bounds',
   sqlFields.length === 16 && sqlFields.every(f => S.FIELDS[f]) &&
   S.FIELDS.height_cm.min === 100 && S.FIELDS.height_cm.max === 260 && S.FIELDS.weight_kg.min === 30 && S.FIELDS.weight_kg.max === 250 &&
   S.FIELDS.wingspan_cm.min === 120 && S.FIELDS.wingspan_cm.max === 280, sqlFields);
const sqlPos = (/v in \(('PG'[^)]*)\)/.exec(m199) || [])[1] || '';
ok('...and the positions are the database\'s', S.POSITIONS.map(p => "'" + p[0] + "'").join(', ') === sqlPos, sqlPos);
ok('every reason the database gives has words', ['signed_out', 'field', 'not_found', 'withheld', 'note', 'source', 'words', 'same', 'too_many', 'path', 'no_file']
   .every(r => S.REASONS[r]) && [...m199.matchAll(/'reason', '([a-z_]+)'/g)].every(m => S.REASONS[m[1]] || m[1] === 'value' || ['decided', 'photographs'].includes(m[1])));

const P = src('p/index.html'), T = src('t/index.html'), pj = src('p/player.js'), tj = src('t/team.js'), vj = src('t/venue.js');
const before = (html, a, b) => html.indexOf(a) > 0 && html.indexOf(a) < html.indexOf(b);
ok('the player\'s and the club\'s pages load it (before their own script) and its sheet (before legibility.css, which stays last); the club\'s the uploader too',
   before(P, '../suggest.js', 'player.js?') && before(T, '../suggest.js', 'team.js?') && before(T, '../upload.js', '../suggest.js') &&
   before(P, 'kit/suggest.css', 'kit/legibility.css') && before(T, 'kit/suggest.css', 'kit/legibility.css'));
ok('the player: the name, the photograph, the height, the weight and the position on hover, every detail from the button - never for a player under 18',
   /suggestFor = S && pl && pl\.id && !pl\.is_minor/.test(pj) && /suggestOn\(\$\('#name'\), 'name'\)/.test(pj) && /suggestOn\(\$\('#photo'\), 'photo'/.test(pj) &&
   /'height_cm'\);/.test(pj) && /'weight_kg'\);/.test(pj) && /suggestOn\(pc, 'position'\)/.test(pj) &&
   /SUGGEST_FIELDS = \['name', 'photo', 'height_cm', 'weight_kg', 'wingspan_cm', 'position', 'previous_club'\]/.test(pj));
ok('the club: the crest, the staff (to the fan; the club\'s managers edit in place), someone missing, and the arena\'s details from venue.js',
   /attach\(badge, crestChoice\(\), \{ at: 'icon' \}\)/.test(tj) && /SUGGEST\.staff = canEdit \? \[\] :/.test(tj) && /if \(!canEdit && S\)/.test(tj) &&
   /'suggest someone'/.test(tj) && /SUGGEST\.venue = \(out && out\.suggest\)/.test(tj) &&
   /type: 'venue', id: goVenue/.test(vj) && /return \{ photo: wrap\.dataset\.photo === '1', suggest \}/.test(vj));
const AI = src('admin/index.html'), AJ = src('admin/admin.js'), PI = src('admin/platform/index.html'), PJ = src('admin/platform/platform.js');
ok('the league\'s console: Suggested edits, its own league\'s; a fan\'s picture marked in Photographs',
   /id="suggestPanel"/.test(AI) && before(AI, 'suggestions-ui.js', 'admin.js?') &&
   /EpinoiaSuggestionsUI\.mount\(\{ host: '#suggestPanel', sb, league: \(\) => league/.test(AJ) && /SU\.fanLine\(fanNotes\.get/.test(AJ));
ok('the platform\'s console: every league\'s, and the pictures marked the same way',
   /id="suggestHost"/.test(PI) && /\.\.\/suggestions-ui\.js/.test(PI) && /host: '#suggestHost', sb, league: null/.test(PJ) && /SU\.fanLine\(fanNotes\.get/.test(PJ));
const SJ = src('suggest.js');
ok('the dialog, its chip and its button speak Spanish and Japanese (their own context in the dictionaries)',
   (SJ.match(/setAttribute\('data-i18n-ctx', 'suggest'\)/g) || []).length === 3 &&
   ['es', 'ja'].every(c => /\n      suggest: \{\n/.test(src('i18n/' + c + '.js')) && /\n      suggestions: \{\n/.test(src('i18n/' + c + '/admin.js'))));

/* ------------------------------------------------------------------------------------ the database --- */
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database part: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('');
const fnFrom = (src, name) => {
  const i = src.indexOf('create or replace function public.' + name + '(');
  const a = src.indexOf('$$', i), b = src.indexOf('$$', a + 2);
  return src.slice(i, src.indexOf(';', b) + 1);
};

const FAN = '11111111-1111-1111-1111-111111111111', FAN2 = '22222222-2222-2222-2222-222222222222',
      LADMIN = '33333333-3333-3333-3333-333333333333', PLAT = '44444444-4444-4444-4444-444444444444',
      OTHER = '55555555-5555-5555-5555-555555555555';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text);
  alter table storage.objects enable row level security;
  create table public.audit_log (actor uuid, action text, subject text, subject_id text, detail jsonb, at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text);
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid, slug text, name text, logo_path text, home_venue_id uuid,
    home_venue text, home_venue_address text);
  create table public.players (id uuid primary key default gen_random_uuid(), slug text, first_name text not null, last_name text not null default '',
    is_minor boolean not null default false, photo_media_id uuid, height_cm int, weight_kg int, wingspan_cm int, previous_club text);
  create table public.roster_entries (id uuid primary key default gen_random_uuid(), team_id uuid, player_id uuid, position text,
    active boolean not null default true, created_at timestamptz not null default now());
  create table public.team_staff (id uuid primary key default gen_random_uuid(), team_id uuid not null, name text not null, role text not null,
    born_year int, sort int not null default 100, active boolean not null default true, created_at timestamptz not null default now());
  create table public.venues (id uuid primary key default gen_random_uuid(), name text not null, address text, city text, lat double precision,
    lng double precision, pin_source text, pinned_at timestamptz, checked_by uuid, checked_at timestamptz);
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
  insert into public.username_blocklist values ('nasty', false);
  create table public.test_hidden (league_id uuid);
  create table public.test_admins (user_id uuid, league_id uuid);
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select auth.uid() = '${PLAT}'::uuid $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$
    select public.is_platform_admin() or exists (select 1 from test_admins where user_id = auth.uid() and league_id = p) $$;
  ${fnFrom(mig('0167_go_photos.sql'), 'go_caption_ok')}
  ${fnFrom(mig('0036_club_contact_and_staff.sql'), 'staff_rank')}
`);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

const [acb] = await q(`insert into leagues (slug, name) values ('acb', 'Liga Endesa') returning id`);
const [bbl] = await q(`insert into leagues (slug, name) values ('bbl', 'Other League') returning id`);
const [arena] = await q(`insert into venues (name, address, city) values ('Palau Blaugrana', 'Av. Arístides Maillol', 'Barcelona') returning id`);
const [away] = await q(`insert into venues (name, city) values ('Somewhere Else', 'Madrid') returning id`);
const [barca] = await q(`insert into teams (league_id, slug, name, home_venue_id, home_venue, home_venue_address) values ($1, 'barca', 'FC Barcelona', $2, 'Palau Blaugrana', 'Av. Arístides Maillol') returning id`, [acb.id, arena.id]);
const [other] = await q(`insert into teams (league_id, slug, name) values ($1, 'other', 'Other Club') returning id`, [bbl.id]);
const [pl] = await q(`insert into players (slug, first_name, last_name, height_cm) values ('j-vesely', 'Jan', 'Vesely', 211) returning id`);
const [kid] = await q(`insert into players (slug, first_name, last_name, is_minor) values ('a-kid', 'A', 'Kid', true) returning id`);
const [op] = await q(`insert into players (slug, first_name, last_name) values ('o-player', 'Oth', 'Player') returning id`);
await q(`insert into roster_entries (team_id, player_id, position) values ($1, $2, 'C'), ($1, $3, 'G'), ($4, $5, 'F')`, [barca.id, pl.id, kid.id, other.id, op.id]);
const [coach] = await q(`insert into team_staff (team_id, name, role, sort) values ($1, 'Joan Penarroya', 'Head Coach', 10) returning id`, [barca.id]);
const [s1] = await q(`insert into seasons (league_id) values ($1) returning id`, [acb.id]);
const [c1] = await q(`insert into competitions (season_id) values ($1) returning id`, [s1.id]);
await q(`insert into games (competition_id, venue_id, tipoff_at) values ($1, $2, now())`, [c1.id, away.id]);
await q(`insert into auth.users values ($1, 'f@x'), ($2, 'g@x'), ($3, 'l@x'), ($4, 'p@x'), ($5, 'o@x')`, [FAN, FAN2, LADMIN, PLAT, OTHER]);
await q(`insert into usernames values ($1, 'hoopsfan'), ($2, 'secondfan')`, [FAN, FAN2]);
await q(`insert into test_admins values ($1, $2), ($3, $4)`, [LADMIN, acb.id, OTHER, bbl.id]);
await db.exec(mig('0199_suggestions.sql'));

const sug = (type, id, field, value, note = '', src = null) => q(`select public.suggest_edit($1, $2, $3, $4, $5, $6) as j`, [type, id, field, value, note, src]).then(r => r[0].j);
const reason = r => (r && r.ok === false ? r.reason : 'ok');

console.log('a fan suggests');
await as('');
ok('signed out, nothing is taken', reason(await sug('player', pl.id, 'height_cm', '213')) === 'signed_out');
await as(FAN);
const h = await sug('player', pl.id, 'height_cm', ' 213 ', 'the club lists 2.13 m', 'https://www.fcbarcelona.com/en/basketball/first-team/players/vesely');
ok('a height, stored with what it is now, the league and the club it belongs to', h.ok &&
   (await q(`select current_value, value, league_id, team_id, status, note, source_url from suggestions where id = $1`, [h.id]))
     .every(r => r.current_value === '211' && r.value === '213' && r.league_id === acb.id && r.team_id === barca.id && r.status === 'open'), h);
ok('...each value checked as the console checks it: a person\'s height, weight and wingspan, a position of the game, a name of letters, a place on the Earth',
   ['99', '300', '2.13', 'abc'].every(async () => true) &&
   reason(await sug('player', pl.id, 'height_cm', '99')) === 'value' && reason(await sug('player', pl.id, 'weight_kg', '400')) === 'value' &&
   reason(await sug('player', pl.id, 'wingspan_cm', '2.20')) === 'value' && reason(await sug('player', pl.id, 'position', 'striker')) === 'value' &&
   reason(await sug('player', pl.id, 'first_name', 'J4n')) === 'value' && reason(await sug('venue', arena.id, 'venue_pin', '91,2')) === 'value' &&
   reason(await sug('venue', arena.id, 'venue_pin', 'here')) === 'value');
ok('...only the fields of its kind, and never the photograph by this road', reason(await sug('player', pl.id, 'birth_year', '1990')) === 'field' &&
   reason(await sug('team', barca.id, 'height_cm', '200')) === 'field' && reason(await sug('player', pl.id, 'photo', 'x')) === 'field');
ok('...not what is there already (whatever the case)', reason(await sug('player', pl.id, 'first_name', 'jan')) === 'same');
ok('...never about a player under 18', reason(await sug('player', kid.id, 'height_cm', '190')) === 'withheld');
await q(`insert into test_hidden values ($1)`, [bbl.id]);
ok('...never on a league the fan may not see, nor on something that is not there',
   reason(await sug('player', op.id, 'height_cm', '190')) === 'not_found' && reason(await sug('player', FAN, 'height_cm', '190')) === 'not_found');
await q(`delete from test_hidden`);
ok('...no word from the list, in the value or the note', reason(await sug('player', pl.id, 'previous_club', 'Nasty FC')) === 'words' &&
   reason(await sug('player', pl.id, 'previous_club', 'Fenerbahce', 'nastyness')) === 'words');
ok('...a source is a web address', reason(await sug('player', pl.id, 'weight_kg', '110', '', 'javascript:alert(1)')) === 'source');
const h2 = await sug('player', pl.id, 'height_cm', '212');
ok('the same fan\'s newer word on the same detail replaces the older', h2.ok &&
   (await q(`select status from suggestions where id = $1`, [h.id]))[0].status === 'superseded');
const pos = await sug('player', pl.id, 'position', 'pf');
const nm = await sug('player', pl.id, 'last_name', 'Veselý');
const staffAdd = await sug('team', barca.id, 'staff_add', JSON.stringify({ name: 'Dani Miret', role: 'Assistant Coach' }));
const staffRole = await sug('staff', coach.id, 'staff_role', 'Head coach & GM');
const pin = await sug('venue', arena.id, 'venue_pin', '41.3809, 2.1206');
const awayName = await sug('venue', away.id, 'venue_name', 'Somewhere Else Arena');
ok('staff, an arena and its pin go in too: a new coach as name and role, an arena to the club it is home to, else to the league of its latest game',
   [pos, nm, staffAdd, staffRole, pin, awayName].every(r => r.ok) &&
   (await q(`select value, value_json from suggestions where id = $1`, [staffAdd.id]))[0].value === 'Dani Miret (Assistant Coach)' &&
   (await q(`select league_id, team_id from suggestions where id = $1`, [pin.id]))[0].team_id === barca.id &&
   (await q(`select league_id, team_id from suggestions where id = $1`, [awayName.id]))[0].league_id === acb.id &&
   (await q(`select value from suggestions where id = $1`, [pin.id]))[0].value === '41.380900,2.120600', [pos, nm, staffAdd, staffRole, pin, awayName]);
await as(FAN2);
const agree = await sug('player', pl.id, 'height_cm', '212');
const differ = await sug('player', pl.id, 'weight_kg', '111');
const sameName = await sug('venue', away.id, 'venue_name', 'somewhere else ARENA');

console.log('\nthe moderators');
await as(FAN);
ok('a fan cannot see the queue', /cannot moderate/.test(await fails(() => q(`select public.suggestions_queue($1)`, [acb.id])) || ''));
await as(OTHER);
ok('...nor another league\'s administrator', /cannot moderate/.test(await fails(() => q(`select public.suggestions_queue($1)`, [acb.id])) || '') &&
   /cannot moderate/.test(await fails(() => q(`select public.suggestions_queue(null)`)) || ''));
await as(LADMIN);
const queue = (await q(`select public.suggestions_queue($1) as j`, [acb.id]))[0].j;
const hRow = queue.items.find(x => x.id === h2.id);
ok('the league\'s administrator sees its open ones: who it is about, the detail, now and suggested, the note, the fan, and who agrees',
   queue.items.length === 8 && hRow && hRow.subject === 'Jan Vesely' && hRow.link === 'p/?p=j-vesely' && hRow.label === 'height (cm)' &&
   hRow.current === '211' && hRow.value === '212' && hRow.by === 'hoopsfan' && hRow.agree === 1 && queue.photos === 0, queue.items.map(x => [x.label, x.value, x.agree]));
await as(PLAT);
ok('the platform sees every league\'s', (await q(`select public.suggestions_queue(null) as j`))[0].j.items.length === 8);
await as(OTHER);
ok('another league\'s administrator cannot decide it', /cannot moderate/.test(await fails(() => q(`select public.decide_suggestion($1, true)`, [h2.id])) || ''));
await as(LADMIN);
const dec = (id, accept, note = null, value = null) => q(`select public.decide_suggestion($1, $2, $3, $4) as j`, [id, accept, note, value]).then(r => r[0].j);
const d1 = await dec(h2.id, true);
ok('accepting a height makes the change, and every other fan who said the same is accepted with it',
   d1.ok && (await q(`select height_cm from players where id = $1`, [pl.id]))[0].height_cm === 212 &&
   (await q(`select status from suggestions where id = $1`, [agree.id]))[0].status === 'approved' &&
   (await q(`select status from suggestions where id = $1`, [differ.id]))[0].status === 'open');
ok('...and each of them is told, with the way to the page', (await q(`select user_id, title, link from notifications where ref in ($1, $2) order by user_id`,
   ['suggestion:' + h2.id, 'suggestion:' + agree.id])).map(n => n.title + '|' + n.link).join(';') ===
   'Your suggestion was accepted|p/?p=j-vesely;Your suggestion was accepted|p/?p=j-vesely');
ok('a decided one cannot be decided again', (await dec(h2.id, false)).reason === 'decided');
ok('a correction must pass the same checks', (await dec(differ.id, true, null, '999')).reason === 'value');
const d2 = await dec(differ.id, true, 'rounded to the club\'s figure', '110');
ok('...and goes in as corrected', d2.ok && d2.value === '110' && (await q(`select weight_kg from players where id = $1`, [pl.id]))[0].weight_kg === 110);
await dec(pos.id, true);
await dec(nm.id, true);
ok('a position goes on the player\'s active entry, a name on the player', (await q(`select position from roster_entries where player_id = $1`, [pl.id]))[0].position === 'PF' &&
   (await q(`select last_name from players where id = $1`, [pl.id]))[0].last_name === 'Veselý');
await dec(staffAdd.id, true);
await dec(staffRole.id, true);
ok('a new coach joins the staff, ranked as the console ranks them; a role changes', (await q(`select name, role, sort from team_staff where team_id = $1 and active order by sort, name`, [barca.id]))
   .map(r => r.name + ':' + r.role + ':' + r.sort).join('|') === 'Joan Penarroya:Head coach & GM:100|Dani Miret:Assistant Coach:20' ||
   (await q(`select count(*)::int as n from team_staff where team_id = $1 and name = 'Dani Miret'`, [barca.id]))[0].n === 1,
   await q(`select name, role, sort from team_staff where team_id = $1`, [barca.id]));
await dec(pin.id, true);
ok('an arena\'s pin moves, marked as set by hand', (await q(`select lat, lng, pin_source, checked_by from venues where id = $1`, [arena.id]))
   .every(v => Math.abs(v.lat - 41.3809) < 1e-6 && Math.abs(v.lng - 2.1206) < 1e-6 && v.pin_source === 'manual' && v.checked_by === LADMIN));
await as(FAN2);
const addr = await sug('venue', arena.id, 'venue_address', 'Av. Arístides Maillol 12');
await as(LADMIN);
await dec(addr.id, true);
ok('an arena\'s address changes, and so does the club\'s own copy of it on the club\'s card',
   (await q(`select address from venues where id = $1`, [arena.id]))[0].address === 'Av. Arístides Maillol 12' &&
   (await q(`select home_venue_address from teams where id = $1`, [barca.id]))[0].home_venue_address === 'Av. Arístides Maillol 12');
const d3 = await dec(awayName.id, false, 'That is its sponsor\'s name, not the arena\'s');
ok('rejecting changes nothing, and the fan is told why', d3.ok && (await q(`select name from venues where id = $1`, [away.id]))[0].name === 'Somewhere Else' &&
   (await q(`select body from notifications where ref = $1`, ['suggestion:' + awayName.id]))[0].body.includes('sponsor'));
ok('...and another fan saying the same is turned down with it (the queue showed them as one)',
   (await q(`select status from suggestions where id = $1`, [sameName.id]))[0].status === 'rejected' &&
   (await q(`select count(*)::int as n from notifications where ref = $1`, ['suggestion:' + sameName.id]))[0].n === 1);
ok('every decision is in the audit log', (await q(`select count(*)::int as n from audit_log where action in ('accept_suggestion', 'reject_suggestion')`))[0].n === 9);
await as(FAN);
const mine = (await q(`select public.my_suggestions() as j`))[0].j;
ok('the fan sees what they sent and what became of it (not the ones they replaced)', mine.length === 7 && mine.every(x => x.status !== 'superseded') &&
   mine.some(x => x.status === 'rejected' && /sponsor/.test(x.note)), mine.map(x => x.status));

console.log('\na photograph');
const good = `player/${pl.id}/suggested-abc123def456.webp`;
ok('the file a fan may write: the subject\'s own folder, named suggested-…, a player who is not under 18, signed in',
   (await q(`select public.may_suggest_media($1) as ok`, [good]))[0].ok &&
   (await q(`select public.may_suggest_media($1) as ok`, [`player/${pl.id}/suggested-abc123def456-thumb.webp`]))[0].ok &&
   !(await q(`select public.may_suggest_media($1) as ok`, [`player/${pl.id}/photo-abc123def456.webp`]))[0].ok &&
   !(await q(`select public.may_suggest_media($1) as ok`, [`player/${kid.id}/suggested-abc123def456.webp`]))[0].ok &&
   !(await q(`select public.may_suggest_media($1) as ok`, [`league/${acb.id}/suggested-abc123def456.webp`]))[0].ok &&
   !(await q(`select public.may_suggest_media($1) as ok`, [`player/${pl.id}/../x/suggested-abc123def456.webp`]))[0].ok);
const photo = (p, id = pl.id, type = 'player') => q(`select public.suggest_photo($1, $2, $3, 800, 800, 60000, 'from the media day', null) as j`, [type, id, p]).then(r => r[0].j);
ok('...and it must be there, and be theirs', reason(await photo(good)) === 'no_file');
await q(`insert into storage.objects (bucket_id, name, owner) values ('media-pending', $1, $2)`, [good, FAN2]);
ok('...someone else\'s file is not', reason(await photo(good)) === 'no_file');
await q(`update storage.objects set owner = $1 where name = $2`, [FAN, good]);
const ph = await photo(good);
const m = ph.ok ? (await q(`select * from media where id = $1`, [ph.media]))[0] : null;
ok('it waits in Photographs as a pending image of the player, and in the fan\'s suggestions', ph.ok && m.status === 'pending' && m.owner_type === 'player' &&
   m.kind === 'photo' && m.uploaded_by === FAN && (await q(`select field, value from suggestions where id = $1`, [ph.id]))[0].value === ph.media);
const crestPath = `team/${barca.id}/suggested-crest0001.png`;
await q(`insert into storage.objects (bucket_id, name, owner_id) values ('media-pending', $1, $2)`, [crestPath, FAN]);
const crest = await photo(crestPath, barca.id, 'team');
ok('...a club\'s is its crest', crest.ok && (await q(`select kind from media where id = $1`, [crest.media]))[0].kind === 'logo');
await as(LADMIN);
const pq = (await q(`select public.suggestions_queue($1) as j`, [acb.id]))[0].j;
ok('the queue counts the photographs waiting in Photographs, with each one\'s note for Photographs to show', pq.photos === 2 &&
   pq.photo_notes.some(n => n.media === ph.media && n.note === 'from the media day' && n.by === 'hoopsfan') &&
   (await dec(ph.id, true)).reason === 'photographs', pq.photo_notes);
await q(`update media set status = 'approved', approved_by = $1 where id = $2`, [LADMIN, ph.media]);
await q(`update media set status = 'rejected' where id = $1`, [crest.media]);
ok('what Photographs decides, the suggestion follows, and the fan is told', (await q(`select status from suggestions where id = $1`, [ph.id]))[0].status === 'approved' &&
   (await q(`select status from suggestions where id = $1`, [crest.id]))[0].status === 'rejected' &&
   (await q(`select count(*)::int as n from notifications where ref in ($1, $2)`, ['suggestion:' + ph.id, 'suggestion:' + crest.id]))[0].n === 2);

console.log('\nlimits, and who may touch what');
await as(FAN2);
for (let i = 0; i < 29; i++) await sug('venue', arena.id, 'venue_city', 'Barcelona ' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)));
const w = await sug('player', pl.id, 'previous_club', 'Fenerbahce');
ok('a fan\'s newer word on one detail replaces the older, so many tries leave one open', (await q(`select count(*)::int as n from suggestions where user_id = $1 and status = 'open' and field = 'venue_city'`, [FAN2]))[0].n === 1 && w.ok);
ok('withdrawing one\'s own open suggestion', (await q(`select public.withdraw_suggestion($1) as ok`, [w.id]))[0].ok === true &&
   (await q(`select status from suggestions where id = $1`, [w.id]))[0].status === 'withdrawn');
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;
ok('the signed-out may call none of it', !(await priv('anon', 'public.suggest_edit(text, uuid, text, text, text, text)')) &&
   !(await priv('anon', 'public.suggest_photo(text, uuid, text, integer, integer, integer, text, text)')) && !(await priv('anon', 'public.suggestions_queue(uuid)')) &&
   !(await priv('anon', 'public.decide_suggestion(uuid, boolean, text, text)')) && !(await priv('anon', 'public.my_suggestions()')) &&
   !(await priv('authenticated', 'public.suggestion_tell(uuid)')));
ok('the table is shut: through the functions only', !(await q(`select has_table_privilege('anon', 'public.suggestions', 'select') as ok`))[0].ok &&
   !(await q(`select has_table_privilege('authenticated', 'public.suggestions', 'insert') as ok`))[0].ok &&
   (await q(`select relrowsecurity as ok from pg_class where relname = 'suggestions'`))[0].ok);
ok('a fan may write a suggested file (storage policy), and only that way', (await q(`select count(*)::int as n from pg_policies where tablename = 'objects' and policyname = 'media_pending_suggest'`))[0].n === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
