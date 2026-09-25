// 0175 and arena-place: moving an arena's pin moves its place - no network.
//
//   node supabase/tests/arena-place.test.mjs
//
// Part 1 is pure: which place Google's answer names for a pin (supabase/functions/_shared/arenaplace.js).
// Part 2 runs 0162, 0164 and 0175 on a real Postgres (PGlite; skipped with a note when the package is
// not installed: `npm i --no-save @electric-sql/pglite`, or PGLITE_DIR=<its folder>).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ARENA_TYPES, REACH_M, languageFor, metres, pickPlace, sameName } from '../functions/_shared/arenaplace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

console.log('-- which place a pin names');
const SAGA = { lat: 33.2766, lng: 130.29267 };
const place = (id, name, lat, lng, types, extra = {}) => ({
  id, displayName: { text: name }, location: { latitude: lat, longitude: lng }, types,
  formattedAddress: extra.addr || name + ' address',
  addressComponents: extra.components || [
    { types: ['locality'], longText: extra.city || 'Saga' }, { types: ['country'], shortText: extra.cc || 'JP', longText: 'Japan' }]
});
const arena = place('ChIJarena', 'SAGAアリーナ', 33.27664, 130.29270, ['stadium', 'point_of_interest'], { addr: '日本、〒840-0000 佐賀県佐賀市日の出', city: '佐賀市' });
let p = pickPlace([arena], SAGA);
ok('the arena at the pin: its name, address, town, country and place', p && p.name === 'SAGAアリーナ' && p.place_id === 'ChIJarena' && p.city === '佐賀市' && p.country === 'JP' && /佐賀県/.test(p.address), p);
ok('...and how far it was from the pin', p && p.distance_m < 10, p && p.distance_m);
const far = place('ChIJfar', 'Other Hall', 33.2790, 130.2927, ['sports_complex']);
p = pickPlace([far, arena], SAGA);
ok('the nearest arena wins', p.place_id === 'ChIJarena', p);
ok('one beyond reach is nobody', pickPlace([far], SAGA) === null && metres(SAGA, { lat: 33.2790, lng: 130.2927 }) > REACH_M);
ok('a bakery beside the pin is not an arena, however close', pickPlace([place('b', 'Bakery', 33.27661, 130.29267, ['bakery', 'store'])], SAGA) === null);
ok('a place with no name, or nothing at all, is nobody', pickPlace([{ id: 'x', location: { latitude: 1, longitude: 1 }, types: ['stadium'] }], SAGA) === null && pickPlace([], SAGA) === null && pickPlace(null, SAGA) === null);
const noComp = place('ChIJnc', 'Hall', 33.2766, 130.29267, ['arena'], { components: [] });
p = pickPlace([noComp], SAGA);
ok('a result with no address components still names the arena, with no town or country', p && p.name === 'Hall' && p.city === null && p.country === null, p);
ok('the town falls back through postal_town and the administrative levels', pickPlace([place('t', 'Hall', 33.2766, 130.29267, ['arena'], { components: [{ types: ['postal_town'], longText: 'Luton' }, { types: ['country'], shortText: 'GB' }] })], SAGA).city === 'Luton');
ok('an arena kind is asked for', ARENA_TYPES.includes('arena') && ARENA_TYPES.includes('stadium') && ARENA_TYPES.includes('sports_complex'));
ok('names are asked for in the country\'s own language', languageFor('JP') === 'ja' && languageFor('gr') === 'el' && languageFor('GB') === 'en' && languageFor(null) === 'en');
ok('the same name in another case is the same name', sameName(' Uber Arena', 'UBER ARENA ') && !sameName('Sアリ', 'SAGAアリーナ'));

console.log('-- the database: moving a pin drops the place it described');
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('  SKIP  @electric-sql/pglite is not installed - the database half did not run'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.is_platform_admin() returns boolean language sql as $$ select true $$;
  create table public.audit_log (id bigserial primary key, actor uuid, action text, subject text, subject_id text, detail jsonb, created_at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), country text);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons);
  create table public.teams (id uuid primary key default gen_random_uuid(), name text);
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    home_team_id uuid references public.teams, away_team_id uuid references public.teams, venue text);
  insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa');
`);
await db.exec(mig('0162_venues.sql'));
await db.exec(mig('0164_arena_editor.sql'));
await db.exec(mig('0175_pin_moves_the_place.sql'));

const q = async (sql, params) => (await db.query(sql, params)).rows;
const person = async fn => {                          // run as a signed-in person (auth.uid() is set)
  await db.exec(`select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false)`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const newVenue = async () => (await q(`insert into venues (name, country, city, address, lat, lng, place_id, pin_source)
  values ('Sアリ', 'JP', 'Wembley', 'Arena Square, Wembley', 51.5560, -0.2796, 'ChIJwembley', 'google') returning id`))[0].id;
const row = async id => (await q(`select city, address, place_id, lat, name from venues where id = $1`, [id]))[0];

let v = await newVenue();
await person(() => q(`update venues set lat = 33.2766, lng = 130.29267, place_id = null, pin_source = 'manual' where id = $1`, [v]));
let r = await row(v);
ok('a person moves the pin to Saga: the Wembley town and address go', r.city === null && r.address === null && r.lat === 33.2766, r);
ok('...and the move is in the audit log with what it dropped', (await q(`select detail->'before'->>'city' b, detail->'after'->>'city' a from audit_log where action = 'venue_edit' order by id desc limit 1`))[0].b === 'Wembley');

v = await newVenue();
await person(() => q(`update venues set lat = 51.5562, lng = -0.2794 where id = $1`, [v]));
r = await row(v);
ok('a nudge within the building (about 30 m) keeps its address', r.city === 'Wembley' && r.address === 'Arena Square, Wembley', r);

v = await newVenue();
await person(() => q(`update venues set lat = 33.2766, lng = 130.29267, city = '佐賀市', address = '佐賀県佐賀市日の出' where id = $1`, [v]));
r = await row(v);
ok('a person who writes the new address with the new pin keeps theirs', r.city === '佐賀市' && r.address === '佐賀県佐賀市日の出', r);

v = (await q(`insert into venues (name, city, address) values ('Unpinned', 'Old Town', 'Somewhere') returning id`))[0].id;
await person(() => q(`update venues set lat = 10, lng = 10 where id = $1`, [v]));
ok('a first pin has no old place to drop', (await row(v)).city === 'Old Town');

v = await newVenue();
await q(`update venues set lat = 33.2766, lng = 130.29267 where id = $1`, [v]);
r = await row(v);
ok('the pinning script (no person) is untouched: it writes its own place', r.city === 'Wembley', r);

v = await newVenue();
await person(() => q(`update venues set name = 'Renamed' where id = $1`, [v]));
ok('an edit that does not move the pin drops nothing', (await row(v)).city === 'Wembley');

console.log('-- the daily lookup allowance');
const take = async cap => (await q(`select public.google_lookup_take($1) t`, [cap]))[0].t;
ok('under the cap: taken', (await take(2)) === true && (await take(2)) === true);
ok('at the cap: refused, and stays refused', (await take(2)) === false && (await take(2)) === false);
ok('the count stopped at the cap', Number((await q(`select n from google_lookups`))[0].n) === 2);
ok('a higher cap the same day opens it again', (await take(3)) === true);
const priv = async (role, fn) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p;
ok('no browser role can spend lookups; the service role can',
   !(await priv('anon', 'public.google_lookup_take(integer)')) && !(await priv('authenticated', 'public.google_lookup_take(integer)')) && (await priv('service_role', 'public.google_lookup_take(integer)')));
ok('nobody reads the counter table from a browser',
   !(await q(`select has_table_privilege('authenticated', 'public.google_lookups', 'select') p`))[0].p && !(await q(`select has_table_privilege('anon', 'public.google_lookups', 'select') p`))[0].p);
ok('the distance is real: Saga to Wembley is about 9,600 km', Math.abs((await q(`select venue_metres(33.2766, 130.29267, 51.556, -0.2796) m`))[0].m - 9.6e6) < 3e5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
