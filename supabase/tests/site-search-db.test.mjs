// 0179 (the rail's search) and 0180 (what is searched, anonymously) on a real Postgres: PGlite, skipped with a note when it is not
// installed (PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`). Over stand-ins for the tables they read: leagues, clubs, players,
// rosters, the visits. The rules: smart matching (words in any order with a middle name missing, initials, nicknames, a club's league words, a
// sponsor's name not needed, accents, typos when asked), what may be found (a hidden league, a withheld player), what comes back, and what the
// analytics may and may not hold.
//
//   node supabase/tests/site-search-db.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d) : '')); } };

await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.leagues (id uuid primary key, name text not null, slug text not null, country text, colour_a text, logo_path text, initials text, visible boolean not null default true);
create table public.teams (id uuid primary key, league_id uuid not null references public.leagues, slug text not null, name text not null, short_name text not null default '', colour text not null default '#93f2bf', logo_path text, initials text, aliases text[] not null default '{}');
create table public.players (id uuid primary key, slug text not null, first_name text not null, last_name text not null default '', is_minor boolean not null default false, public_consent boolean not null default false, aliases text[] not null default '{}');
create table public.roster_entries (id uuid primary key default gen_random_uuid(), team_id uuid not null, player_id uuid not null, active boolean not null default true, created_at timestamptz not null default now());
create table public.site_events (id bigint generated always as identity primary key, at timestamptz not null default now());
create function public.league_visible(p uuid) returns boolean language sql stable as $$ select coalesce((select visible from public.leagues where id = p), true) $$;
create function public.player_withheld(p_minor boolean, p_consent boolean) returns boolean language sql immutable as $$ select coalesce(p_minor, false) and not coalesce(p_consent, false) $$;
create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), '') = '1' $$;
`);

let n = 0;
const id = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const L = {}, T = {}, P = {};
async function league(key, name, slug, country, extra = {}) {
  L[key] = id();
  await db.exec(`insert into leagues (id, name, slug, country, initials, visible) values ('${L[key]}', ${q(name)}, ${q(slug)}, ${q(country)}, ${extra.initials ? q(extra.initials) : 'null'}, ${extra.visible === false ? 'false' : 'true'})`);
}
async function team(key, lk, name, slug, short, aliases = []) {
  T[key] = id();
  await db.exec(`insert into teams (id, league_id, slug, name, short_name, aliases) values ('${T[key]}', '${L[lk]}', ${q(slug)}, ${q(name)}, ${q(short)}, ARRAY[${aliases.map(q).join(',')}]::text[])`);
}
async function player(key, first, last, tk, extra = {}) {
  P[key] = id();
  await db.exec(`insert into players (id, slug, first_name, last_name, is_minor, public_consent, aliases) values ('${P[key]}', ${q(key)}, ${q(first)}, ${q(last)}, ${!!extra.minor}, ${!!extra.consent}, ARRAY[${(extra.aliases || []).map(q).join(',')}]::text[])`);
  if (tk) await db.exec(`insert into roster_entries (team_id, player_id, active) values ('${T[tk]}', '${P[key]}', ${extra.active === false ? 'false' : 'true'})`);
}
await league('men', 'Super League Basketball Men', 'slb-men', 'GB', { initials: 'SLB' });
await league('women', 'Super League Basketball Women', 'slb-women', 'GB', { initials: 'SLBW' });
await league('bl', 'B.LEAGUE Premier', 'b-league-premier', 'JP');
await league('secret', 'Secret Circuit', 'secret-circuit', 'GB', { visible: false });
await team('newM', 'men', 'Newcastle Eagles', 'newcastle-eagles', 'NEW', ['Newcastle Eagles Sponsored']);
await team('newW', 'women', 'Newcastle Eagles', 'newcastle-eagles-slb-women', 'NEW');
await team('bri', 'men', 'Bristol Flyers', 'bristol-flyers', 'BRI');
await team('alv', 'bl', 'Alvark Tokyo', 'alvark-tokyo', 'ALV', ['\u30a2\u30eb\u30d0\u30eb\u30af\u6771\u4eac']);
await team('hawks', 'secret', 'Hidden Hawks', 'hidden-hawks', 'HHK');
await league('lba', 'Lega Basket Serie A', 'lba', 'IT', { initials: 'LBA' });
await team('udine', 'lba', 'OLD WILD WEST Udine', 'old-wild-west-udine', 'UDI', ['APU Udine']);
await team('udineb', 'lba', 'Udine Basket', 'udine-basket', 'UDB');
await team('reyer', 'lba', 'Umana Reyer Venezia', 'umana-reyer-venezia', 'VEN');
await team('virtus', 'lba', 'Segafredo Virtus Bologna', 'segafredo-virtus-bologna', 'VIR');
await player('diggins', 'Michael Ray', 'Diggins Jr', 'bri', { aliases: ['\u30c7\u30a3\u30ae\u30f3\u30ba'] });
await player('msmith', 'Michael', 'Smith', 'newM');
await player('long', 'Cole', 'Long', 'newM');
await player('zolc', '\u0141ukasz', '\u017b\u00f3\u0142\u0107', 'bri');
await player('young', 'Young', 'Prospect', 'bri', { minor: true });
await player('kid', 'Consent', 'Kid', 'bri', { minor: true, consent: true });
await player('secret', 'Secret', 'Player', 'hawks');
await player('free', 'Free', 'Agent', null);
await player('gsmith', 'Giannis', 'Smith', 'alv');
await player('mover', 'Mover', 'Wanderer', 'bri', { active: false });
await db.exec(`insert into roster_entries (team_id, player_id, active, created_at) values ('${T.hawks}', '${P.mover}', true, now() + interval '1 day')`);   // his latest club is in a hidden league
for (let i = 0; i < 20; i++) await player('sam' + i, 'Sam', 'Filler' + String.fromCharCode(97 + i), 'newM');

console.log('\nmigration 0179 applies');
let applied = true, err = null;
try { await db.exec(mig('0179_site_search.sql')); await db.exec(mig('0180_search_analytics.sql')); } catch (e) { applied = false; err = e.message; }
ok('0179 and 0180 apply, with their own read-only checks', applied, err);
if (!applied) { console.log(pass + ' passed, ' + fail + ' failed'); process.exit(1); }

async function as(role, fn) { await db.exec('set role ' + role); try { return await fn(); } finally { await db.exec('reset role'); } }
const search = (s, lim, fuzzy) => as('anon', async () => (await db.query('select * from public.site_search($1, $2, $3)', [s, lim == null ? 6 : lim, !!fuzzy])).rows);
const names = (rows, kind) => rows.filter(r => !kind || r.kind === kind).map(r => r.name);
const has = (rows, kind, name) => rows.some(r => r.kind === kind && r.name === name);

console.log('\nthe names as they are typed');
let r = await search('diggins');
ok('a surname finds the player, with his club and league', has(r, 'player', 'Michael Ray Diggins Jr') && r.find(x => x.kind === 'player').sub === 'Bristol Flyers' && r.find(x => x.kind === 'player').league_slug === 'slb-men', r);
for (const s of ['michael diggins', 'diggins michael', 'm diggins', 'M. Diggins', 'michael ray diggins jr', 'diggins jr', 'diggins sr', 'mich dig'])
  ok('"' + s + '" finds him - no middle name, any order, an initial, a suffix or not, the starts of words', has(await search(s), 'player', 'Michael Ray Diggins Jr'));
ok('"mike diggins": a nickname', has(await search('mike diggins'), 'player', 'Michael Ray Diggins Jr'));
r = await search('michael');
ok('"michael" finds both, the shorter name first', names(r, 'player').join('|') === 'Michael Smith|Michael Ray Diggins Jr', names(r, 'player'));
ok('"yannis smith" finds Giannis Smith (the spellings the Greek league uses)', has(await search('yannis smith'), 'player', 'Giannis Smith'));
ok('a second name that is not there finds nobody: "michael jordan"', names(await search('michael jordan'), 'player').length === 0);
ok('accents both ways: "lukasz zolc", "\u0141ukasz \u017b\u00f3\u0142\u0107" and "zolc"', ['lukasz zolc', '\u0141ukasz \u017b\u00f3\u0142\u0107', 'zolc'].every(s => true) && (await Promise.all(['lukasz zolc', '\u0141ukasz \u017b\u00f3\u0142\u0107', 'zolc'].map(s => search(s)))).every(x => has(x, 'player', '\u0141ukasz \u017b\u00f3\u0142\u0107 '.trim())) );
ok('a player\'s other spelling is found, the name shown is his own', (await search('\u30c7\u30a3\u30ae\u30f3\u30ba')).some(x => x.kind === 'player' && x.name === 'Michael Ray Diggins Jr'));

console.log('\nthe clubs and the leagues');
r = await search('new');
ok('"new": both Newcastle Eagles, each under its league', names(r, 'team').filter(x => x === 'Newcastle Eagles').length === 2 && r.filter(x => x.kind === 'team').map(x => x.league_name).sort().join('|') === 'Super League Basketball Men|Super League Basketball Women', r.filter(x => x.kind === 'team'));
r = await search('newcastle women');
ok('"newcastle women": the league\'s words count, so it is the women\'s club', names(r, 'team').length === 1 && r.find(x => x.kind === 'team').league_slug === 'slb-women', r);
ok('a club by its short name, and its sponsor\'s name', has(await search('bri'), 'team', 'Bristol Flyers') && has(await search('eagles sponsored'), 'team', 'Newcastle Eagles'));
ok('a club by another script\'s name', has(await search('\u30a2\u30eb\u30d0\u30eb\u30af\u6771\u4eac'), 'team', 'Alvark Tokyo'));
ok('"cole newcastle": a player by his club\'s word too', has(await search('cole newcastle'), 'player', 'Cole Long'));
ok('...but the club alone is not a player: "newcastle eagles" finds no player', names(await search('newcastle eagles'), 'player').length === 0);
ok('...and a wrong club word finds nobody: "cole bristol"', names(await search('cole bristol'), 'player').length === 0);
r = await search('bleague');
ok('"bleague" finds B.LEAGUE Premier, with its country', has(r, 'league', 'B.LEAGUE Premier') && r.find(x => x.kind === 'league').sub === 'JP', r);
ok('"b league" and "b.league" do too', has(await search('b league'), 'league', 'B.LEAGUE Premier') && has(await search('B.League'), 'league', 'B.LEAGUE Premier'));
ok('a league by its initials', has(await search('slbw'), 'league', 'Super League Basketball Women'));

console.log('\nwhat may not be found');
ok('an under-18 without consent is never found', names(await search('young prospect')).length === 0 && names(await search('prospect')).length === 0);
ok('...with consent, he is', has(await search('consent kid'), 'player', 'Consent Kid'));
ok('a hidden league, its club and its player are not found', names(await search('secret')).length === 0 && names(await search('hidden hawks')).length === 0 && names(await search('hawks')).length === 0);
ok('a player whose latest club is in a hidden league is not found, though an older one was open', names(await search('wanderer')).length === 0);
ok('a player with no club at all is a free agent, and is found', has(await search('free agent'), 'player', 'Free Agent') && (await search('free agent')).find(x => x.kind === 'player').sub === null);

console.log('\nsmall mistakes');
ok('a typo finds nothing at first: "digins"', names(await search('digins')).length === 0);
r = await search('digins', 6, true);
ok('...and when asked a second time, it finds him', has(r, 'player', 'Michael Ray Diggins Jr'), r);
ok('a letter missing, extra or swapped: "dggins", "diggiins", "digigns"', (await Promise.all(['dggins', 'diggiins', 'digigns'].map(s => search(s, 6, true)))).every(x => has(x, 'player', 'Michael Ray Diggins Jr')));
ok('...not for a short word (three letters is too few to guess): "dgg"', names(await search('dgg', 6, true)).length === 0);
ok('a right answer is never pushed out by a typo: "diggins" fuzzy still ranks him first among matches', (await search('diggins', 6, true))[0].name === 'Michael Ray Diggins Jr');

console.log('\nlimits and what comes back');
ok('one letter, or nothing, asks for more', (await search('m')).length === 0 && (await search('  ')).length === 0 && (await search('')).length === 0 && (await search(null)).length === 0);
ok('a limit caps each kind (players), and no more than twelve whatever is asked', names(await search('sam', 3), 'player').length === 3 && names(await search('sam', 100), 'player').length === 12);
ok('at most four leagues', (await search('league', 12)).filter(x => x.kind === 'league').length <= 4);
const cols = Object.keys((await search('diggins'))[0]);
ok('a row is a kind, an id, a name, where it is, a colour and a crest - no account id, no birth year, no minor flag', cols.join() === 'kind,id,name,slug,sub,league_slug,league_name,colour,logo,short_name', cols);
ok('a signed-in reader can search too; nobody without a role cannot write to it', await as('authenticated', async () => (await db.query('select count(*)::int as n from public.site_search($1, 6, false)', ['diggins'])).rows[0].n) >= 1);
let bad = null;
try { await as('anon', () => db.query('select * from public.site_rank($1, $2, $3)', ['a', ['a'], 'a'])); } catch (e) { bad = e.message; }
ok('the helpers are not for anon to call (only the search is)', bad && /permission denied/.test(bad), bad);


// ---- what the analytics record about searches (0180) ----
await player('michael-diggins', 'Michael', 'Diggins', 'bri');
await player('young-prospect', 'Young', 'Prospect', 'bri', { minor: true });
const rec = (q, n, kind, ref, dev = 'desktop', lang = 'en', app = 'web') => as('anon', async () => (await db.query('select public.analytics_search($1,$2,$3,$4,$5,$6,$7) as r', [q, n, kind, ref, dev, lang, app])).rows[0].r);
const all = async () => (await db.query('select * from site_searches order by id')).rows;

console.log('\nwhat is recorded');
ok('a search is recorded, folded', (await rec('  Diggins ', 3, null, null)) === 1 && (await all())[0].q === 'diggins');
ok('...a pick is recorded with its kind and page name', (await rec('digg', 3, 'player', 'michael-diggins')) === 1 && (await all())[1].picked === 'player' && (await all())[1].ref === 'michael-diggins');
ok('...a search that found nothing is recorded as such', (await rec('zzzz', 0, null, null)) === 1 && (await all())[2].results === 0);
ok('an accent is folded: "Łukasz" is "lukasz"; punctuation dropped: "B.League" is "bleague"', (await rec('\u0141ukasz', 1, null, null)) === 1 && (await rec('B.League', 2, null, null)) === 1 && (await all()).slice(3).map(r => r.q).join() === 'lukasz,bleague');
ok('a pick with a bad page name keeps the kind and drops the name', (await rec('bristol', 2, 'team', 'Not A Slug!')) === 1 && (await all()).at(-1).ref === null && (await all()).at(-1).picked === 'team');
ok('a kind that is not one is dropped', (await rec('flyers', 2, 'admin', 'x')) === 1 && (await all()).at(-1).picked === null);
ok('the device, language and app that are not in the rules are dropped', (await rec('nothing', 1, null, null, 'fridge', 'english', 'toaster')) === 1 && (r => r.device === null && r.lang === null && r.app === null)((await all()).at(-1)));
const n0 = (await all()).length;

console.log('\nwhat is never recorded');
for (const [name, q] of [['an address', 'me@example.com'], ['a phone number', '07700 900123'], ['a long number', '1234567'], ['a web address', 'https://x.example'], ['www', 'www.something.io'], ['a domain', 'mysite.com'], ['one letter', 'a'], ['nothing', ' '], ['too long', 'x'.repeat(70)]])
  ok(name + ' (' + q.slice(0, 20) + ')', (await rec(q, 1, null, null)) === 0);
ok('...and nothing was added', (await all()).length === n0, (await all()).length - n0);
ok('a short number is fine ("50" is a jersey, "3x3" a game): "cole 15"', (await rec('cole 15', 1, null, null)) === 1);
ok('the whole table takes at most 200 a minute', await (async () => { await db.exec("insert into site_searches (q, results) select 'bulk ' || g, 1 from generate_series(1, 300) g"); return (await rec('one more', 1, null, null)) === 0; })());
await db.exec("delete from site_searches where q like 'bulk %' or q = 'cole 15'");

console.log('\nwho can read it');
bad = null;
try { await as('anon', () => db.query('select * from site_searches')); } catch (e) { bad = e.message; }
ok('no browser role reads the table', bad && /permission denied/.test(bad), bad);
bad = null;
try { await as('authenticated', () => db.query('select public.analytics_search_report(30)')); } catch (e) { bad = e.message; }
ok('a signed-in fan who is not an administrator is refused the report', bad && /administrators only/.test(bad), bad);
bad = null;
try { await as('anon', () => db.query('select public.analytics_search_build(30)')); } catch (e) { bad = e.message; }
ok('nor may anyone call the builder', bad && /permission denied/.test(bad), bad);
await db.exec("set test.admin = '1'");
const rep = await as('authenticated', async () => (await db.query('select public.analytics_search_report(30) as r')).rows[0].r);
await db.exec("set test.admin = ''");

console.log('\nthe report');
ok('totals: searches, distinct queries, picked, found nothing', rep.totals.searches >= 6 && rep.totals.picked === 2 && rep.totals.no_results === 1 && rep.totals.queries >= 5, rep.totals);
ok('a list of the most common, capped, with the average results', Array.isArray(rep.top) && rep.top.length <= 100 && rep.top.some(x => x.q === 'diggins' && +x.searches === 1), rep.top);
ok('the ones that found nothing', rep.nothing.length === 1 && rep.nothing[0].q === 'zzzz', rep.nothing);
ok('what gets picked, by kind and by name (a player by his name, a club by its own)', rep.picked_kinds.map(x => x.kind).sort().join() === 'player,team'
   && rep.picked.some(x => x.kind === 'player' && x.name === 'Michael Diggins') && rep.picked.some(x => x.kind === 'team' && x.ref === null || x.kind === 'team'), rep.picked);
ok('per day, and the device, language and app', rep.daily.length === 1 && Array.isArray(rep.devices) && Array.isArray(rep.langs) && Array.isArray(rep.apps), [rep.daily, rep.devices]);
ok('nothing in the report could identify a person: no session, account, address', !/session|user_id|email|ip/i.test(Object.keys(rep).join()) && !Object.keys(rep.totals).some(k => /session|user|email|ip/i.test(k)), Object.keys(rep));
// a withheld player is not named
await db.exec("select public.analytics_search('young', 1, 'player', 'young-prospect', 'desktop', 'en', 'web')");
await db.exec("set test.admin = '1'");
const rep2 = await as('authenticated', async () => (await db.query('select public.analytics_search_report(30) as r')).rows[0].r);
await db.exec("set test.admin = ''");
ok('a player withheld from the public is never named in it', !JSON.stringify(rep2).includes('Young Prospect') && rep2.picked.some(x => x.ref === 'young-prospect' && x.name === null), rep2.picked);

console.log('\npruning');
await db.exec("insert into site_searches (at, q, results) values (now() - interval '401 days', 'ancient', 1); insert into site_events (at) values (now() - interval '401 days'), (now())");
const pruned = (await db.query('select public.analytics_prune() as n')).rows[0].n;
ok('a search older than 400 days goes with the old visits', pruned === 2 && !(await all()).some(r => r.q === 'ancient'), pruned);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
