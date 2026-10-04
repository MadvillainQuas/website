// 0232: the search answers in time and gives the SAME answers as 0179's. On a real Postgres (PGlite; skipped with a note when it is not
// installed - PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). 0179 is loaded on the minimum schema it reads, a few
// hundred made-up players and a few dozen clubs go in, the answers to a battery of searches are taken, 0232 is applied, and every
// answer is taken again and compared: same rows, same order, exact and forgiving. Then what 0232 adds is held to what it promises:
// the folded names are kept and follow a rename, what is typed is taken literally (it is turned into a regular expression), the
// browser cannot read the new columns or call the helpers, and the search is still the browser's to call.
//
//   node supabase/tests/site-search-fast.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, country text, colour_a text, logo_path text, initials text, access_mode text default 'open');
  create table public.teams (id uuid primary key default gen_random_uuid(), slug text, name text, short_name text, initials text, aliases text[] default '{}', colour text, logo_path text, league_id uuid);
  create table public.players (id uuid primary key default gen_random_uuid(), slug text, first_name text, last_name text, aliases text[] default '{}', is_minor boolean default false, public_consent boolean default false);
  create table public.roster_entries (id bigserial primary key, player_id uuid, team_id uuid, active boolean default true, created_at timestamptz default now());
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select true $$;
  create function public.player_withheld(m boolean, c boolean) returns boolean language sql immutable as $$ select coalesce(m,false) and not coalesce(c,false) $$;
  revoke all on public.players from anon, authenticated;
  grant select (id, slug, first_name, last_name) on public.players to anon, authenticated;
`);

/* made-up data: names with accents, nicknames, particles, suffixes, a Cyrillic and a Greek one, duplicates, clubs that share words */
const lg = [['slb', 'Super League Basketball Men', 'GB', 'SLB'], ['slbw', 'Super League Basketball Women', 'GB', 'SLBW'], ['nbl', 'NBL', 'AU', 'NBL'],
  ['liga', 'Liga Endesa', 'ES', 'ACB'], ['bl', 'B.LEAGUE Premier', 'JP', 'BLJ'], ['lkl', 'LKL', 'LT', 'LKL']];
const lid = {};
for (const [slug, name, country, initials] of lg) lid[slug] = (await db.query('insert into public.leagues (slug, name, country, initials) values ($1,$2,$3,$4) returning id', [slug, name, country, initials])).rows[0].id;
const clubs = [['slb', 'Newcastle Eagles', 'Eagles', 'NEW'], ['slb', 'Sheffield Sharks', 'Sharks', 'SHE'], ['slb', 'Leicester Riders', 'Riders', 'LEI'], ['slbw', 'Newcastle Eagles Women', 'Eagles W', 'NEW'],
  ['nbl', 'Adelaide 36ers', '36ers', 'ADL'], ['nbl', 'Melbourne United', 'United', 'MEL'], ['nbl', 'Illawarra Hawks', 'Hawks', 'ILL'], ['liga', 'Real Madrid', 'Madrid', 'RMA'],
  ['liga', 'Barça', 'Barca', 'FCB'], ['bl', 'Sendai 89ers', '89ers', 'SEN'], ['lkl', 'Žalgiris Kaunas', 'Zalgiris', 'ZAL'], ['slb', 'London Lions', 'Lions', 'LON']];
const cid = [];
for (const [l, name, short, ini] of clubs) cid.push((await db.query('insert into public.teams (slug, name, short_name, initials, league_id, aliases) values ($1,$2,$3,$4,$5,$6) returning id',
  [name.toLowerCase().replace(/\W+/g, '-'), name, short, ini, lid[l], name.startsWith('Sheffield') ? ['B. Braun Sheffield Sharks'] : []])).rows[0].id);
const first = ['James', 'Mike', 'Michael', 'Jim', 'Liz', 'Elizabeth', 'Giannis', 'Yannis', 'Łukasz', 'Zoltán', 'Mitch', 'Sam', 'Jaylon', 'Bernard', 'Thomas', 'Cole', 'Li', 'Jo', 'Max', 'Alex', 'Aleksandar', 'Dmitri', 'Дмитрий', 'Γιάννης', 'A.J.', 'Ty', 'Kai', 'De\'Aaron'];
const last = ['Smith', 'Jones', 'O\'Brien', 'Müller', 'Diggins', 'Long', 'Creek', 'White', 'Pelote', 'Hurley', 'Antetokounmpo', 'Żółć', 'Nagy', 'Ivanov', 'Mackey', 'Todd', 'van Berg', 'de la Cruz', 'Brown-Jones', 'Li', 'Fall', 'James', 'Johnson Jr', 'Smith III'];
let n = 0;
for (let i = 0; i < first.length; i++) for (let j = 0; j < last.length; j++) {
  if ((i * 7 + j * 3) % 3 !== 0) continue;
  const p = (await db.query('insert into public.players (slug, first_name, last_name, aliases, is_minor, public_consent) values ($1,$2,$3,$4,$5,false) returning id',
    ['p' + (++n), first[i], last[j], n % 17 === 0 ? ['Nickname ' + last[j]] : [], n % 29 === 0])).rows[0].id;
  if (n % 11 !== 0) await db.query('insert into public.roster_entries (player_id, team_id, active) values ($1,$2,$3)', [p, cid[n % cid.length], n % 5 !== 0]);
  if (n % 13 === 0) await db.query('insert into public.roster_entries (player_id, team_id, active) values ($1,$2,true)', [p, cid[(n + 4) % cid.length]]);
}
await db.exec(mig('0179_site_search.sql'));

const BATTERY = ['james', 'mike james', 'jim', 'mike', 'michael diggins', 'diggins michael', 'm diggins', 'digg', 'digins', 'dggins', 'li', 'li fall', 'jo', 'a j', 'a.j.', 'aj', 'ab',
  'sheffield', 'sheff sharks', 'sharks', 'b braun sheffield sharks', 'newcastle', 'newcastle women', 'eagles new', 'cole newcastle', 'cole eagles', 'barca', 'barça', 'zalgiris', 'žalgiris',
  'lukasz', 'łukasz zolc', 'zoltan nagy', 'giannis', 'yannis ioannis', 'dmitri', 'дмитрий', 'γιάννης', 'de la cruz', 'van berg', 'berg', 'smith jr', 'smith iii', 'johnson jr', 'jr', 'de',
  'liga', 'league', 'slb', 'nbl', 'bleague', 'super league', 'madrid', 'rma', 'ill hawks', 'adelaide 36', '36ers', 'brown jones', 'brown-jones', 'o\'brien', 'obrien', 'muller', 'müller',
  'mitch creek', 'creek mitch', 'sam', 'sa', 'x', 'zz', 'zzzz', 'nickname', 'nickname white', 'james james', 'j j', 'm j', 'mike j', 'a b c d e f', 'the', 'new', 'united men',
  'jaylon white', 'jaylon', 'bernard p', 'thomas hurley lions', 'hurley riders', 'ty', 'kai', '3', '36'];
const answers = async () => {
  const out = {};
  for (const q of BATTERY) for (const fz of [false, true]) {
    const r = await db.query('select kind, name, slug, sub, league_slug, league_name, short_name from public.site_search($1, 8, $2)', [q, fz]);
    out[q + '|' + fz] = r.rows;
  }
  return out;
};
const before = await answers();
ok('the battery finds things (the made-up data is not empty of answers)', Object.values(before).filter(r => r.length).length > 60, Object.values(before).filter(r => r.length).length);

await db.exec(mig('0232_site_search_fast.sql'));
const after = await answers();
const diffs = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
ok('every search gives the same rows in the same order as 0179\'s, exact and forgiving (' + Object.keys(before).length + ' of them)', diffs.length === 0,
   diffs.slice(0, 4).map(k => ({ q: k, was: before[k].map(r => r.name), now: after[k].map(r => r.name) })));

/* what 0232 adds */
const miss = (await db.query("select (select count(*) from public.players where search_hay is null) p, (select count(*) from public.teams where search_hay is null) t")).rows[0];
ok('every player and club has its folded name kept', Number(miss.p) === 0 && Number(miss.t) === 0, miss);
await db.query("insert into public.players (slug, first_name, last_name) values ('acc1', 'Łukasz', 'Żółć')");
const one = (await db.query("select first_name, last_name, search_hay from public.players where slug = 'acc1'")).rows[0];
ok('...folded as the search folds it (accents off, lower case)', one && one.search_hay === 'lukasz zolc', one);

await db.query("insert into public.players (slug, first_name, last_name) values ('new1', 'Zebulon', 'Quimby')");
ok('a new player is findable at once (the trigger folds the name)', (await db.query("select name from public.site_search('zebulon quimby', 5, false)")).rows.length === 1);
await db.query("update public.players set first_name = 'Ezekiel' where slug = 'new1'");
ok('...and a rename is followed: the new name finds him, the old no longer does',
   (await db.query("select name from public.site_search('ezekiel quimby', 5, false)")).rows.length === 1 && (await db.query("select name from public.site_search('zebulon quimby', 5, false)")).rows.length === 0);
await db.query("update public.players set aliases = array['Zed Q'] where slug = 'new1'");
ok('...and so is another spelling (found as that spelling, as 0179 does: one name at a time)', (await db.query("select name from public.site_search('zed q', 5, false)")).rows.length === 1);
await db.query("update public.teams set short_name = 'Zzyzx' where name = 'London Lions'");
ok('a club’s rename is followed too', (await db.query("select name from public.site_search('zzyzx', 5, false)")).rows.some(r => r.name === 'London Lions'));

/* what is typed is part of a regular expression now: none of it may be read as one */
const rough = ['(', ')', '(a', 'a+', 'a*', '[', ']', '[a-z]', '.', '.*', '^', '$', 'a|b', '\\', '\\d', '{2}', 'a{2,}', '?', '(?=x)', '(?!)', 'x)(y', 'mike ('];
let broke = null;
for (const q of rough) for (const fz of [false, true]) { try { await db.query('select * from public.site_search($1, 8, $2)', [q, fz]); } catch (e) { broke = broke || { q, why: String(e.message).slice(0, 120) }; } }
ok('what is typed is taken literally: brackets, stars, pipes, backslashes and lookaheads typed in the box never break the search', broke === null, broke);
ok('...and a typed star is not a wildcard (a* does not find everyone)', (await db.query("select * from public.site_search('a*', 8, false)")).rows.length === 0);
ok('...nor a typed dot (j.m finds nobody, as 0179’s folding reads a dot out of a name, not as a letter)', (await db.query("select name from public.site_search('j.m', 8, false)")).rows.every(r => /j/i.test(r.name)));
ok('site_rx escapes every regex character', (await db.query('select public.site_rx($1) r', ['a.b*(c)[d]\\'])).rows[0].r === 'a\\.b\\*\\(c\\)\\[d\\]\\\\');

/* who can do what */
const can = async (role, fn) => (await db.query(`select has_function_privilege('${role}', '${fn}', 'execute') c`)).rows[0].c;
ok('the browser can still search', await can('anon', 'public.site_search(text, integer, boolean)') && await can('authenticated', 'public.site_search(text, integer, boolean)'));
ok('...and cannot call the helpers or the triggers’ functions', !(await can('anon', 'public.site_musts_re(text[])')) && !(await can('anon', 'public.site_rx(text)')) && !(await can('authenticated', 'public.players_search_hay()')) &&
   !(await can('anon', 'public.site_rank(text, text[], text, text, boolean)')));
const col = async (role, t, c) => (await db.query(`select has_column_privilege('${role}', 'public.${t}', '${c}', 'select') c`)).rows[0].c;
ok('the kept names are not readable by the browser (players has no table-wide select)', !(await col('anon', 'players', 'search_hay')) && !(await col('authenticated', 'players', 'search_hay')));
ok('...but a name an editor changes is still folded for him (the trigger runs as its owner, who may call site_fold)',
   (await db.query("select prosecdef from pg_proc where proname = 'players_search_hay'")).rows[0].prosecdef === true);

/* the cost no longer grows with the words typed: a many-word search that matches nothing is not slower than a one-word one (on this small data, by a wide margin) */
const time = async q => { const s = Date.now(); await db.query('select * from public.site_search($1, 8, false)', [q]); return Date.now() - s; };
await time('warm up');
const t1 = await time('zzzz'), t6 = await time('zq xw yv ut sr pq');
ok('six words that match nothing cost about what one does (' + t6 + ' ms against ' + t1 + ' ms)', t6 < t1 * 4 + 150, [t1, t6]);

/* the page: a busy database is a retry, then the tables, and only then the error (never "Nothing matches" for a search that did not run) */
const page = readFileSync(path.join(here, '..', '..', 'epinoia', 'search.js'), 'utf8');
ok('search.js asks the function twice before giving up on it, and does not mark it missing for being slow',
   /rows = await askRpc\(cfg, q, false, signal\); \}/.test(page) && /rows = null; failed = e;/.test(page));
ok('...then tries the tables, and shows the failure when they have nothing too',
   /const some = await askTables\(cfg, q, signal, part\);\s*if \(!some\.length\) throw failed;/.test(page));
ok('...and the forgiving second look is optional: if it fails, the first answer stands', /try \{ more = await askRpc\(cfg, q, true, signal\); \} catch/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
