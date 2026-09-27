// 0184: the secret date of birth and the age it gives, on a real Postgres (PGlite; skipped with a note when it is not installed -
// PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). Held here: an adult's date is kept and his year follows it; a minor's
// date is never kept (only the year); a hand-edited year with the date left alone clears the date; player_ages() returns ages only, for
// players with a date who are not withheld; and the date is not granted to the browser roles.
//
//   node supabase/tests/player-bio.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.players (id uuid primary key default gen_random_uuid(), slug text, first_name text not null, last_name text default '',
    birth_year int, height_cm int, weight_kg int, is_minor boolean default false, public_consent boolean default false);
  create function public.player_withheld(p_minor boolean, p_consent boolean) returns boolean language sql immutable as $$ select coalesce(p_minor, false) and not coalesce(p_consent, false) $$;
  revoke all on public.players from anon, authenticated;
  grant select (id, slug, first_name, last_name, birth_year, is_minor) on public.players to anon, authenticated;
`);
await db.exec(mig('0184_player_bio.sql'));
await db.exec(mig('0185_player_bio_rpc.sql'));

const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const ins = async (first, date, year, extra = '') => (await one(`insert into public.players (first_name, birth_date, birth_year ${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, $3 ${extra ? ', ' + extra.split('=')[1] : ''}) returning *`, [first, date, year]));
const yearsAgo = (y, m = 0, d = 0) => { const t = new Date(); t.setFullYear(t.getFullYear() - y); t.setMonth(t.getMonth() - m); t.setDate(t.getDate() - d); return t.toISOString().slice(0, 10); };

console.log('-- the guard');
const adult = await ins('Adult', '1996-03-14', null);
ok('an adult’s date is kept', String(adult.birth_date.toISOString ? adult.birth_date.toISOString().slice(0, 10) : adult.birth_date).slice(0, 10) === '1996-03-14', adult);
ok('...and his year follows it', adult.birth_year === 1996, adult);
const dateOnlyAdult = await ins('Wrong', '1996-03-14', 1990);
ok('a date wins over a year given with it', dateOnlyAdult.birth_year === 1996, dateOnlyAdult);
const minorDate = yearsAgo(16, 2);
const minor = await ins('Minor', minorDate, null);
ok('a minor’s date is never kept', minor.birth_date === null, minor);
ok('...only his year is', minor.birth_year === Number(minorDate.slice(0, 4)), minor);
const nearly = await ins('Nearly', yearsAgo(18, 0, -3), null);
ok('a player who turns 18 in three days is still a minor: no date', nearly.birth_date === null && nearly.birth_year !== null, nearly);
const just = await ins('Just', yearsAgo(18, 0, 1), null);
ok('a player who turned 18 yesterday keeps his date', just.birth_date !== null, just);
const absurd = await ins('Absurd', '1850-01-01', null);
ok('a date before 1930 is not a person’s: dropped', absurd.birth_date === null, absurd);

console.log('\n-- edits');
const e = await ins('Edit', '1994-07-01', null);
const yr = await one('update public.players set birth_year = 1995 where id = $1 returning *', [e.id]);
ok('a birth_year edited by hand with the date untouched clears the date (the date was wrong)', yr.birth_date === null && yr.birth_year === 1995, yr);
const back = await one("update public.players set birth_date = '1995-02-02' where id = $1 returning *", [e.id]);
ok('a new date after that sets the year again', back.birth_year === 1995 && back.birth_date !== null, back);
const both = await one("update public.players set birth_date = '1993-05-05', birth_year = 1993 where id = $1 returning *", [e.id]);
ok('date and year written together: the date stands', both.birth_date !== null && both.birth_year === 1993, both);
const other = await one("update public.players set first_name = 'Renamed' where id = $1 returning *", [e.id]);
ok('an update of something else leaves both alone', other.birth_date !== null && other.birth_year === 1993, other);

console.log('\n-- the age');
const A = await ins('Aged', '1990-01-01', null);
const W = await db.query("insert into public.players (first_name, birth_date, is_minor, public_consent) values ('Withheld', '1988-01-01', true, false) returning id");
const N = await ins('NoDate', null, 1999);
const ages = (await db.query('select * from public.player_ages($1::uuid[])', [[A.id, W.rows[0].id, N.id]])).rows;
const expected = new Date().getFullYear() - 1990 - ((new Date().getMonth() > 0 || new Date().getDate() >= 1) ? 0 : 1);
ok('a player with a date has an age, and it is today’s', ages.length === 1 && ages[0].player_id === A.id && ages[0].age === expected, ages);
ok('a withheld player has none, and neither has one with only a year', !ages.some(x => x.player_id === W.rows[0].id || x.player_id === N.id), ages);
ok('no ids: nothing', (await db.query('select * from public.player_ages(null)')).rows.length === 0);

console.log('\n-- player_bio: a page of players in one call');
{
  const B = await one("insert into public.players (first_name, birth_date, height_cm, weight_kg) values ('Bio', '1990-01-01', 198, 95) returning id");
  const H = await one("insert into public.players (first_name, height_cm) values ('HeightOnly', 201) returning id");
  const E = await one("insert into public.players (first_name) values ('Empty') returning id");
  const M = await one("insert into public.players (first_name, birth_date, height_cm, is_minor, public_consent) values ('Kid', '1988-01-01', 190, true, false) returning id");
  const rows = (await db.query('select * from public.player_bio($1::uuid[])', [[B.id, H.id, E.id, M.id]])).rows;
  const by = id => rows.find(r => r.player_id === id);
  ok('height, weight and the age worked out today, in one row', by(B.id) && by(B.id).height_cm === 198 && by(B.id).weight_kg === 95 && by(B.id).age === new Date().getFullYear() - 1990 - ((new Date().getMonth() > 0 || new Date().getDate() >= 1) ? 0 : 1), rows);
  ok('a player with only a height has that and no age', by(H.id) && by(H.id).height_cm === 201 && by(H.id).age === null);
  ok('a player with nothing is left out, and so is a withheld one', !by(E.id) && !by(M.id), rows);
  ok('the answer has no date of birth in it', !rows.some(r => 'birth_date' in r || 'birth_year' in r));
  ok('no ids: nothing', (await db.query('select * from public.player_bio(null)')).rows.length === 0);
  ok('executable by the browser roles', (await one("select has_function_privilege('anon', 'public.player_bio(uuid[])', 'execute') a")).a === true);
}

console.log('\n-- who can read what');
ok('the date is not granted to the browser roles', (await one("select has_column_privilege('anon', 'public.players', 'birth_date', 'select') a, has_column_privilege('authenticated', 'public.players', 'birth_date', 'select') b")).a === false
   && (await one("select has_column_privilege('authenticated', 'public.players', 'birth_date', 'select') b")).b === false);
ok('...while the year is', (await one("select has_column_privilege('anon', 'public.players', 'birth_year', 'select') a")).a === true);
ok('the age function is executable by the browser roles', (await one("select has_function_privilege('anon', 'public.player_ages(uuid[])', 'execute') a")).a === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
