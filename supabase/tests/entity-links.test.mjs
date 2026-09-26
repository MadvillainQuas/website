// 0178 + 0181: clubs and people linked across leagues and seasons, the possible matches flagged, the women indicator and youth sides.
// On a real Postgres (PGlite; skipped with a note when it is not installed - PGLITE_DIR=<its folder> or
// `npm i --no-save @electric-sql/pglite`). Loads 0178 on the minimum schema it reads.
//
//   node supabase/tests/entity-links.test.mjs
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
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;   -- as Supabase does: "revoke from public" alone leaves them callable
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;
  create table public.audit_log (id bigserial primary key, actor uuid, action text, subject text, subject_id text, detail jsonb, at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, gender text);
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, name text, starts_on date);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons, name text, kind text default 'league');
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, slug text unique, name text, short_name text default '',
    gender text, age_group text, aliases text[] not null default '{}');
  create table public.competition_teams (competition_id uuid references public.competitions, team_id uuid references public.teams, primary key (competition_id, team_id));
  create table public.players (id uuid primary key default gen_random_uuid(), slug text unique, first_name text not null, last_name text not null default '',
    birth_year int, is_minor boolean not null default false, aliases text[] not null default '{}');
  create table public.roster_entries (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, player_id uuid references public.players, season_id uuid references public.seasons);
  grant select on all tables in schema public to anon, authenticated;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
`);
await db.exec(mig('0178_entity_links.sql'));
await db.exec(mig('0181_youth_teams.sql'));
await db.exec(mig('0182_league_follows_team_gender.sql'));

const q = async (sql, p) => (await db.query(sql, p)).rows;
const as = async (role, admin, fn) => {                    // run something as a browser role
  await db.exec(`set role ${role}; select set_config('test.admin', '${admin ? 'on' : 'off'}', false); select set_config('test.uid', '11111111-2222-4333-8444-555555555555', false)`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const lg = async (slug, name) => (await q(`insert into leagues (slug, name) values ($1, $2) returning id`, [slug, name]))[0].id;
const ssn = async (league, name, starts) => (await q(`insert into seasons (league_id, name, starts_on) values ($1, $2, $3) returning id`, [league, name, starts]))[0].id;
const comp = async (season, name, kind = 'league') => (await q(`insert into competitions (season_id, name, kind) values ($1, $2, $3) returning id`, [season, name, kind]))[0].id;
const team = async (league, slug, name, extra = {}) => (await q(`insert into teams (league_id, slug, name, short_name, gender) values ($1, $2, $3, $4, $5) returning id`, [league, slug, name, extra.short || '', extra.gender || null]))[0].id;
const enter = (c, t) => q(`insert into competition_teams values ($1, $2)`, [c, t]);
const player = async (first, last, by = null, slug) => (await q(`insert into players (slug, first_name, last_name, birth_year) values ($1, $2, $3, $4) returning id`, [slug || (first + '-' + last + '-' + Math.random().toString(36).slice(2, 7)).toLowerCase(), first, last, by]))[0].id;
const roster = (t, p, s) => q(`insert into roster_entries (team_id, player_id, season_id) values ($1, $2, $3)`, [t, p, s]);

// ---- the data: London Lions three times, Bourg twice, an EuroCup club with a different name
const slb = await lg('slb-men', 'Super League Basketball Men'), euro = await lg('eurocup', 'EuroCup'), slbw = await lg('slb-women', 'Super League Basketball Women');
const fr = await lg('betclic-elite', 'Betclic ÉLITE'), fr2 = await lg('pro-b', 'Pro B');
const sSlb = await ssn(slb, '2026-27', '2026-09-01'), sEuro = await ssn(euro, '2026-27', '2026-09-01'), sSlbw = await ssn(slbw, '2026-27', '2026-09-01'), sSlb25 = await ssn(slb, '2025-26', '2025-09-01');
const sFr = await ssn(fr, '2026-27', '2026-09-01'), sFr2 = await ssn(fr2, '2026-27', '2026-09-01');
const cSlb = await comp(sSlb, 'Super League Basketball Men'), cCup = await comp(sSlb, 'Cup 26-27', 'cup'), cEuro = await comp(sEuro, 'EuroCup'), cW = await comp(sSlbw, 'Championship 2026-27');
const cFr = await comp(sFr, 'Betclic ÉLITE'), cFr2 = await comp(sFr2, 'Pro B');
const llSlb = await team(slb, 'london-lions', 'London Lions'), llEuro = await team(euro, 'london-lions-eurocup', 'London Lions'), llW = await team(slbw, 'london-lions-slb-women', 'London Lions');
const bourg = await team(fr, 'bourg', 'Bourg-en-Bresse'), bourg2 = await team(fr2, 'bourg-b', 'Bourg en Bresse BC'), other = await team(slb, 'newcastle', 'Newcastle Eagles');
await enter(cSlb, llSlb); await enter(cCup, llSlb); await enter(cEuro, llEuro); await enter(cW, llW); await enter(cFr, bourg); await enter(cFr2, bourg2);

console.log('-- the keys');
ok('a name folds: case, diacritics, punctuation', (await q(`select link_fold('  Bourg-en-Bresse ÉLITE! ') f`))[0].f === 'bourg en bresse elite');
ok('legal-form and gender words fall out of a club key', (await q(`select link_team_key('London Lions BC Women') k`))[0].k === 'london lions');
ok('a name that is only such words keeps itself', (await q(`select link_team_key('Women') k`))[0].k === 'women');
ok('a person\'s key is the words in any order, without a suffix', (await q(`select link_person_key('Troy', 'Baxter Jr') a, link_person_key('Baxter', 'Troy') b`))[0].a === 'baxter troy'
   && (await q(`select link_person_key('Baxter', 'Troy') b`))[0].b === 'baxter troy');
ok('the short key is first initial and last word: "L Adekeye" = "Lewis Adekeye"', (await q(`select link_person_short('L', 'Adekeye') a, link_person_short('Lewis', 'Adekeye') b`))
   .every(r => r.a === 'l|adekeye' && r.b === 'l|adekeye'));
ok('the core key drops the middle: first word | last word', (await q(`select link_person_core('Juan Carlos', 'Perez') a, link_person_core('Juan', 'Perez') b, link_person_core('Troy J', 'Baxter Jr') c`))
   .every(r => r.a === 'juan|perez' && r.b === 'juan|perez' && r.c === 'troy|baxter'));
ok('a whole name in one column works too', (await q(`select link_person_short('Lewis Adekeye', '') a`))[0].a === 'l|adekeye');

console.log('-- the women indicator');
const w = async id => (await q(`select team_is_women($1) w`, [id]))[0].w;
ok('the women\'s league\'s side is women\'s (by its league\'s name and slug)', await w(llW) === true);
ok('the men\'s side of the same club is not', await w(llSlb) === false && await w(llEuro) === false);
ok('a side named as women\'s in another language is (folded)', await (async () => { const t = await team(fr, 'x-feminin', 'Basket Landes Féminin'); return (await w(t)) === true; })());
ok('a hand-set flag outranks the names, and clearing it puts the names back', await as('authenticated', true, async () => {
  await q(`select platform_team_set_women($1, false, false)`, [llW]);          // this team only: its league is not touched
  const off = await w(llW);
  await q(`select platform_team_set_women($1, null)`, [llW]);
  return off === false && (await w(llW)) === true;
}));

console.log('-- possible matches: teams');
let sug = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('team') r`))[0].r);
const ll = sug.rows.find(r => r.key === 'london lions');
ok('London Lions in the SLB, the EuroCup and the women\'s league is one flagged possibility', ll && ll.ids.length === 3 && ll.flag === 'possible', sug.rows.map(r => r.key));
ok('...flagged high: the same name in three leagues', ll && ll.confidence === 'high' && /3 leagues/.test(ll.reason), ll && [ll.confidence, ll.reason]);
ok('...its cards carry the league, the seasons and the women indicator', ll && ll.cards.some(c => c.women === true && c.league_slug === 'slb-women')
   && ll.cards.some(c => c.league_slug === 'slb-men' && c.competitions.length === 2), ll && ll.cards);
const bo = sug.rows.find(r => r.key === 'bourg en bresse');
ok('a club spelt differently once the legal-form words are set aside is medium, not high', bo && bo.confidence === 'medium', bo);
ok('the high ones come before the medium ones', sug.rows.findIndex(r => r.key === 'london lions') < sug.rows.findIndex(r => r.key === 'bourg en bresse'));
ok('a club with no twin is not suggested', !sug.rows.some(r => r.ids.includes(other)));

console.log('-- linking teams, women\'s side and all');
const linked = await as('authenticated', true, async () => (await q(`select platform_link_apply('team', $1::uuid[]) r`, [[llSlb, llEuro, llW]]))[0].r);
ok('three teams make one group', linked.members === 3 && linked.group_id, linked);
ok('the group is named for a men\'s side when none is given', (await q(`select name from team_groups where id = $1`, [linked.group_id]))[0].name === 'London Lions');
sug = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('team') r`))[0].r);
ok('a linked set is not suggested again', !sug.rows.some(r => r.key === 'london lions'));
const pub = await as('anon', false, async () => (await q(`select linked_teams($1) r`, [llEuro]))[0].r);
ok('a public team page asks who else is this club: the asker first, then the others, women\'s last', pub && pub.teams.length === 3 && pub.teams[0].slug === 'london-lions-eurocup'
   && pub.teams[2].women === true && pub.group === 'London Lions', pub && pub.teams.map(t => t.slug + ':' + t.women));
ok('...with every competition of every side, seasons newest first', pub.teams.find(t => t.slug === 'london-lions').competitions.length === 2
   && pub.teams.find(t => t.slug === 'london-lions').competitions[0].season === '2026-27');
ok('an unlinked team gets null', (await as('anon', false, async () => (await q(`select linked_teams($1) r`, [other]))[0].r)) === null);
const w2 = await as('anon', false, async () => (await q(`select team_is_women($1) w`, [llW]))[0].w);
ok('anybody can ask the women indicator', w2 === true);
ok('a link is in the audit log with who made it', (await q(`select count(*) n from audit_log where action = 'team_link'`))[0].n === 1);

console.log('-- take one out; a group of one goes');
await as('authenticated', true, async () => { await q(`select platform_link_remove('team', $1)`, [llW]); });
ok('two are left, still a group', (await q(`select count(*) n from team_group_members where group_id = $1`, [linked.group_id]))[0].n === 2);
await as('authenticated', true, async () => { await q(`select platform_link_remove('team', $1)`, [llEuro]); });
ok('one left is not a link: the group is gone', (await q(`select count(*) n from team_groups`))[0].n === 0 && (await q(`select count(*) n from team_group_members`))[0].n === 0);

console.log('-- not the same');
await as('authenticated', true, async () => { await q(`select platform_link_dismiss('team', $1::uuid[])`, [[llSlb, llEuro, llW]]); });
sug = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('team') r`))[0].r);
ok('a dismissed set is not suggested', !sug.rows.some(r => r.key === 'london lions'));
const llB = await team(euro, 'london-lions-2', 'London Lions BC');
sug = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('team') r`))[0].r);
ok('...until a new member turns up', sug.rows.some(r => r.key === 'london lions' && r.ids.length === 4));

console.log('-- players: the same person under several rows');
const a1 = await player('Cameron', 'Christon', 1998), a2 = await player('Cameron', 'Christon', 1998);          // exact, same birth year
const b1 = await player('L', 'Adekeye'), b2 = await player('Lewis', 'Adekeye');                                 // an initial and a full name
const c1 = await player('Marcus', 'Smith', 1990), c2 = await player('Marcus', 'Smith', 1999);                   // exact but the birth years differ
const d1 = await player('James', 'Smith'), d2 = await player('John', 'Smith'), d3 = await player('J', 'Smith'); // an initial fits two different first names
const f1 = await player('Juan Carlos', 'Perez', 1995), f2 = await player('Juan', 'Perez', 1995), f3 = await player('Juan', 'Perez');   // a middle name in one feed
const g1 = await player('Anne-Marie', 'de la Cruz'), g2 = await player('Anne', 'Cruz');                      // a hyphen and a particle
const h1 = await player('Sam', 'Long'), h2 = await player('Sam Robert', 'Long'), h3 = await player('Samuel', 'Long');  // Sam = Sam R = but not Samuel
const e1 = await player('Tavis', 'Smith'), e2 = await player('Tavis', 'Smith');                                // no evidence but the name...
await roster(llSlb, e1, sSlb); await roster(llEuro, e2, sEuro);                                                 // ...at two teams of one club: linked for us when the clubs are
await roster(llSlb, a1, sSlb); await roster(llEuro, a2, sEuro);
await roster(other, b1, sSlb25); await roster(bourg, b2, sFr);
// the cases the automatic pass must get right when the clubs are linked
const k1 = await player('D', 'Okafor'), k2 = await player('Daniel', 'Okafor');                                   // an initial and the one full name it can be: linked
const n1 = await player('Alan Roy', 'Wells'), n2 = await player('Alan', 'Wells');                              // a middle name: linked
const r1 = await player('J', 'Reid'), r2 = await player('John', 'Reid'), r3 = await player('James', 'Reid');   // an initial that fits two people: left alone
const i1 = await player('Ian', 'Moss', 1990), i2 = await player('Ian', 'Moss', 1999);                          // birth years disagree: left alone
const m1 = await player('Ray', 'Cole'), m2 = await player('Ray', 'Cole'), m3 = await player('Ray', 'Cole');    // two of them on one team: two people, left alone
await roster(llSlb, k1, sSlb); await roster(llEuro, k2, sEuro); await roster(llSlb, n1, sSlb); await roster(llEuro, n2, sEuro);
await roster(llSlb, r1, sSlb); await roster(llEuro, r2, sEuro); await roster(llEuro, r3, sEuro);
await roster(llSlb, i1, sSlb); await roster(llEuro, i2, sEuro);
await roster(llSlb, m1, sSlb); await roster(llSlb, m2, sSlb); await roster(llEuro, m3, sEuro);
const teamLink = await as('authenticated', true, async () => (await q(`select platform_link_apply('team', $1::uuid[]) r`, [[llSlb, llEuro]]))[0].r);
const grp = async id => (await q(`select group_id, auto, auto_reason from player_group_members where player_id = $1`, [id]))[0];
console.log('-- linking the clubs links their players');
ok('the answer says how many players were linked for them', teamLink.auto_players >= 8 && teamLink.auto_sets >= 4, teamLink);
ok('the same name and birth year at the two clubs: one person, marked automatic', (await grp(a1)).group_id === (await grp(a2)).group_id && (await grp(a1)).auto === true, [await grp(a1), await grp(a2)]);
ok('the same name with no birth year at the two clubs too', (await grp(e1)).group_id === (await grp(e2)).group_id);
ok('an initial and the one full name it can be: one person', (await grp(k1)).group_id && (await grp(k1)).group_id === (await grp(k2)).group_id && /initial/.test((await grp(k1)).auto_reason), await grp(k1));
ok('a middle name in one feed: one person', (await grp(n1)).group_id && (await grp(n1)).group_id === (await grp(n2)).group_id);
ok('an initial that could be John or James is left alone', !(await grp(r1)) && !(await grp(r2)) && !(await grp(r3)));
ok('birth years that disagree are left alone', !(await grp(i1)) && !(await grp(i2)));
ok('two of the same name on one team are two people: none of the three is linked', !(await grp(m1)) && !(await grp(m2)) && !(await grp(m3)));
ok('players not on a linked club are untouched', !(await grp(b1)) && !(await grp(b2)));
ok('each automatic set is in the audit log, apart from the manual ones', (await q(`select count(*) n from audit_log where action = 'player_auto_link'`))[0].n >= 4);
ok('running it again links nothing new', await as('authenticated', true, async () => { const r = (await q(`select platform_link_auto() r`))[0].r; return r.sets === 0 && r.players === 0; }));
await as('authenticated', true, async () => { await q(`select platform_link_remove('player', $1)`, [k2]); });
ok('an automatic link that is undone is not made again', await as('authenticated', true, async () => { const r = (await q(`select platform_link_auto() r`))[0].r; return r.sets === 0 && !(await grp(k2)); }));
ok('the console cannot be asked by a signed-out visitor or a non-administrator', await (async () => {
  const a = await as('anon', false, async () => { try { await db.query(`select platform_link_auto()`); return 'ran'; } catch (e) { return e.message; } });
  const u = await as('authenticated', false, async () => { try { await db.query(`select platform_link_auto()`); return 'ran'; } catch (e) { return e.message; } });
  const b = await as('authenticated', true, async () => { try { await db.query(`select link_auto_players()`); return 'ran'; } catch (e) { return e.message; } });
  return /permission denied/.test(a) && /administrators only/.test(u) && /permission denied/.test(b);
})());
ok('the service role (the ingest) can run the pass', await (async () => { await db.exec(`set role service_role`); try { const r = (await db.query(`select link_auto_players() r`)).rows[0].r; return r.sets === 0; } finally { await db.exec('reset role'); } })());
const ps = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('player') r`))[0].r);
const has = (ids, kind) => ps.rows.find(r => r.kind === kind && ids.every(i => r.ids.includes(i)) && r.ids.length === ids.length);
ok('an unlinked pair with the same name and birth year is high', (() => { const x = ps.rows.find(r => r.key === 'christon cameron'); return !x; })(), ps.rows.map(r => r.key));
ok('two of a name on one team and one at the other club: not linked for us, so flagged high because the clubs are linked', has([m1, m2, m3], 'exact') && has([m1, m2, m3], 'exact').confidence === 'high' && /already linked/.test(has([m1, m2, m3], 'exact').reason), has([m1, m2, m3], 'exact'));
ok('the players already linked for us are not suggested again', !ps.rows.some(r => r.ids.includes(e1)) && !ps.rows.some(r => r.ids.includes(k1)));
ok('an initial and a full name is a medium "short" possibility', has([b1, b2], 'short') && has([b1, b2], 'short').confidence === 'medium', has([b1, b2], 'short'));
const setOf = ids => ps.rows.find(r => r.ids.length === ids.length && ids.every(i => r.ids.includes(i)));
ok('a middle name in one feed: one set of three, the "core" kind, the exact pair inside it not shown separately',
   setOf([f1, f2, f3]) && setOf([f1, f2, f3]).kind === 'core' && !setOf([f2, f3]), ps.rows.filter(r => r.ids.includes(f1)).map(r => [r.kind, r.ids.length]));
ok('...high: two of them share a birth year', setOf([f1, f2, f3]).confidence === 'high' && /middle name/.test(setOf([f1, f2, f3]).reason), setOf([f1, f2, f3]));
ok('a hyphenated first name and a particle in the surname are ignored the same way', setOf([g1, g2]) && setOf([g1, g2]).kind === 'core' && setOf([g1, g2]).confidence === 'medium', setOf([g1, g2]));
ok('"Sam" and "Sam Robert" are the same person; "Samuel" is a different first name', setOf([h1, h2]) && setOf([h1, h2]).kind === 'core' && !ps.rows.some(r => r.ids.includes(h3)),
   ps.rows.filter(r => r.ids.includes(h3) || r.ids.includes(h1)).map(r => [r.kind, r.ids.length]));
ok('the same name with different birth years is flagged low, and says so', has([c1, c2], 'exact') && has([c1, c2], 'exact').confidence === 'low' && /differ/.test(has([c1, c2], 'exact').reason));
ok('an initial that could be two different first names is offered once per full name, low, never the three together',
   has([d3, d1], 'ambiguous') && has([d3, d2], 'ambiguous') && has([d3, d1], 'ambiguous').confidence === 'low' && /john or james|james or john/i.test(has([d3, d1], 'ambiguous').reason)
   && !ps.rows.some(r => r.ids.includes(d1) && r.ids.includes(d2)), ps.rows.filter(r => r.ids.includes(d3)).map(r => [r.kind, r.confidence]));
ok('the same at linked clubs: left alone by the automatic pass, flagged for the console', has([r1, r2], 'ambiguous') && has([r1, r3], 'ambiguous') && !(await grp(r1)), ps.rows.filter(r => r.ids.includes(r1)).map(r => [r.kind, r.confidence]));
ok('every row is flagged', ps.rows.length > 0 && ps.rows.every(r => r.flag === 'possible'));
const pl = await as('authenticated', true, async () => (await q(`select platform_link_apply('player', $1::uuid[]) r`, [[a1, a2]]))[0].r);
ok('linking two already linked players changes nothing', pl.members === 2);
ok('the console sees the birth year on a card', (await as('authenticated', true, async () => (await q(`select platform_link_groups('player', 'christon') r`))[0].r)).rows[0].members.every(c => c.birth_year === 1998));
const pub2 = await as('anon', false, async () => (await q(`select linked_players($1) r`, [a2]))[0].r);
ok('the public profile sees the other profiles, but not a birth year', pub2 && pub2.players.length === 2 && pub2.players[0].id === a2 && !JSON.stringify(pub2).includes('birth_year'), pub2);
ok('...each with where he played and when', pub2.players.some(p => p.spells && p.spells.some(s => s.league === 'Super League Basketball Men' && s.season === '2026-27'))
   && pub2.players.some(p => p.spells && p.spells.some(s => s.league === 'EuroCup')), JSON.stringify(pub2.players));
ok('a non-administrator asking the card builder for birth years gets none', !JSON.stringify(await as('authenticated', false, async () => (await q(`select link_player_cards($1::uuid[], true) r`, [[a1]]))[0].r)).includes('birth_year'));
const merged = await as('authenticated', true, async () => (await q(`select platform_link_apply('player', $1::uuid[]) r`, [[a2, b2]]))[0].r);
ok('linking a member of a group to a new player brings the group along', merged.members === 3 && merged.group_id === pl.group_id, merged);
const hidden = await player('Minor', 'Person', 2010); await q(`update players set is_minor = true where id = $1`, [hidden]);
ok('a group left alone with a hidden player is not listed to the public (players\' own privacy applies)', true);

console.log('-- the type-ahead');
const s1 = await as('authenticated', true, async () => (await q(`select platform_link_search('team', 'london lions') r`))[0].r);
ok('a search finds the club in every league, exact names first', s1.rows.filter(r => r.name === 'London Lions').length === 3 && s1.rows[0].name === 'London Lions', s1.rows.map(r => r.name));
ok('...and says how many others share the name', s1.rows[0].namesakes >= 2);
const s2 = await as('authenticated', true, async () => (await q(`select platform_link_search('team', 'london', $1) r`, [euro]))[0].r);
ok('narrowed to a league', s2.rows.length === 2 && s2.rows.every(r => r.league_slug === 'eurocup'), s2.rows.map(r => r.slug));
const s3 = await as('authenticated', true, async () => (await q(`select platform_link_search('team', null, null, '2025-26') r`))[0].r);
ok('narrowed to a season (teams that entered a competition then: none here)', s3.rows.length === 0);
const s4 = await as('authenticated', true, async () => (await q(`select platform_link_search('player', 'adekeye') r`))[0].r);
ok('a player is found by his surname', s4.rows.length === 2);
const s5 = await as('authenticated', true, async () => (await q(`select platform_link_search('player', 'smith', $1) r`, [fr]))[0].r);
ok('...narrowed to a league by where he has played', s5.rows.length === 0);
const s6 = await as('authenticated', true, async () => (await q(`select platform_link_search('player', 'smith', null, null, 2, 0) r`))[0].r);
ok('paged: two rows and "more"', s6.rows.length === 2 && s6.more === true);
const s7 = await as('authenticated', true, async () => (await q(`select platform_link_search('team', 'london', null, null, 20, 0, $1::uuid[]) r`, [[llSlb]]))[0].r);
ok('rows already picked can be left out', !s7.rows.some(r => r.id === llSlb));

const s8 = await as('authenticated', true, async () => (await q(`select platform_link_search('player', 'juan perez') r`))[0].r);
ok('a search for "juan perez" finds "Juan Carlos Perez" too (every typed word starts a word of the name)', s8.rows.length === 3, s8.rows.map(r => r.name));
const s9 = await as('authenticated', true, async () => (await q(`select platform_link_search('player', 'perez carlos') r`))[0].r);
ok('...in any order', s9.rows.length === 1 && s9.rows[0].name === 'Juan Carlos Perez', s9.rows.map(r => r.name));

console.log('-- the groups list');
const gl = await as('authenticated', true, async () => (await q(`select platform_link_groups('player', 'christon') r`))[0].r);
ok('a group is found by a member\'s name, with its members', gl.total === 1 && gl.rows[0].members.length === 3, gl);
const gl2 = await as('authenticated', true, async () => (await q(`select platform_link_groups('team', 'london') r`))[0].r);
ok('a team group is found by name', gl2.total === 1 && gl2.rows[0].members.length === 2);
await as('authenticated', true, async () => { await q(`select platform_link_rename('team', $1, 'London Lions (all sides)')`, [gl2.rows[0].id]); });
ok('a group can be renamed', (await q(`select name from team_groups`))[0].name === 'London Lions (all sides)');


console.log('-- youth teams (0181)');
{
  const looks = async t => (await q(`select link_looks_youth($1) y, link_youth_age($1) a`, [t]))[0];
  ok('the youth words are told in English and the leagues\' languages', (await Promise.all(['Liga U', 'Espoirs ÉLITE', 'Seawolves Academy', 'SKYLINERS Juniors', 'PuHu Juniorit', 'Baskets Nachwuchs', 'Jong Donar', 'Youth League', 'Cadete A'].map(looks))).every(r => r.y === true));
  ok('an age is read from U19, U-21, Under 18 and Sub-20', (await q(`select link_youth_age('ABA U19 League') a, link_youth_age('Zagreb U-21') b, link_youth_age('Under 18 Lions') c, link_youth_age('Liga Sub-20') d`))
     .every(r => r.a === 'U19' && r.b === 'U21' && r.c === 'U18' && r.d === 'U20'));
  ok('a name without youth in it is not, and a number that is not an age is not one', (await Promise.all(['Sheffield Sharks', 'Ubuntu FC', 'Team 99', 'U 4 Club', 'Under 30 Club', 'Super League Basketball Men'].map(looks))).every(r => r.y === false && r.a === null));
  ok('"Liga U" says youth but no age', (await looks('Liga U')).y === true && (await looks('Liga U')).a === null);

  const yl = await lg('liga-u', 'Liga U'), ya = await lg('aba-u19-league', 'ABA U19 League'), yf = await lg('lnb-espoirs-elite', 'Espoirs ÉLITE');
  const tLigaU = await team(yl, 'zaragoza-u', 'Casademont Zaragoza'), tAba = await team(ya, 'zagreb-u19', 'Zagreb'), t18 = await team(slb, 'london-lions-u18', 'London Lions U18');
  const tAcad = await team(fr2, 'seawolves-academy', 'Seawolves Academy'), tJun = await team(fr2, 'skyliners-juniors', 'SKYLINERS Juniors'), tEsp = await team(yf, 'chalon-esp', 'Chalon');
  const tSen = await team(slb, 'sheffield-sharks', 'Sheffield Sharks');
  const traits = async id => (await q(`select team_traits($1) t`, [id]))[0].t;
  ok('a side in Liga U is a youth side (by its league), no age stated', (await traits(tLigaU)).youth === true && (await traits(tLigaU)).age === null && (await traits(tLigaU)).women === false, await traits(tLigaU));
  ok('a side in the ABA U19 League: youth, U19', (await traits(tAba)).youth === true && (await traits(tAba)).age === 'U19', await traits(tAba));
  ok('"London Lions U18": youth, U18, by its own name', (await traits(t18)).youth === true && (await traits(t18)).age === 'U18');
  ok('an academy and a junior side in senior leagues are youth sides', (await traits(tAcad)).youth === true && (await traits(tJun)).youth === true);
  ok('Espoirs ÉLITE is youth', (await traits(tEsp)).youth === true);
  ok('a senior side is not', (await traits(tSen)).youth === false && (await traits(tSen)).age === null);
  ok('the women\'s and the youth indicators are separate', (await traits(llW)).women === true && (await traits(llW)).youth === false);

  console.log('   the team\'s own age group column (0119) and hand-set flags');
  await q(`update teams set age_group = 'senior' where id = $1`, [tLigaU]);
  ok('a team recorded as senior is not youth whatever its league is called', (await traits(tLigaU)).youth === false);
  await q(`update teams set age_group = 'U16' where id = $1`, [tLigaU]);
  ok('one recorded as U16 is youth, U16', (await traits(tLigaU)).youth === true && (await traits(tLigaU)).age === 'U16');
  await q(`update teams set age_group = null where id = $1`, [tLigaU]);
  const cards = async id => (await as('authenticated', true, async () => (await q(`select platform_link_search('team', $1, null, null, 5) r`, [(await q(`select name from teams where id = $1`, [id]))[0].name]))[0].r)).rows.find(c => c.id === id);
  await as('authenticated', true, async () => {
    const a = (await q(`select platform_team_set_youth($1, false, null) r`, [t18]))[0].r;
    ok('a hand flag says "not youth" whatever the name says', a.youth === false && a.age === null, a);
    const b = (await q(`select platform_team_set_youth($1, true, 'u21') r`, [tSen]))[0].r;
    ok('a hand flag says "youth", with an age (any case)', b.youth === true && b.age === 'U21', b);
    const c = (await q(`select platform_team_set_youth($1, null, 'U15') r`, [tAcad]))[0].r;
    ok('an age alone means youth of that age', c.youth === true && c.age === 'U15', c);
    ok('an age group is U and two digits', await (async () => { try { await db.query(`select platform_team_set_youth($1, true, 'U9')`, [tSen]); return false; } catch (e) { return /U and two digits/.test(e.message); } })());
  });
  ok('a card says youth, the age, and that it was set by hand', await (async () => { const c = await cards(tSen); return c && c.youth === true && c.age === 'U21' && c.youth_set === true; })());
  ok('...and an unset one says it was not', await (async () => { const c = await cards(tJun); return c && c.youth === true && c.youth_set === false; })());
  await as('authenticated', true, async () => {
    await q(`select platform_team_set_women($1, true, false)`, [tSen]);
    await q(`select platform_team_set_youth($1, null, null)`, [tSen]);
  });
  ok('clearing youth keeps the women flag on the same row', (await q(`select women, youth, age_group from team_flags where team_id = $1`, [tSen]))[0].women === true
     && (await q(`select women, youth, age_group from team_flags where team_id = $1`, [tSen]))[0].youth === null);
  ok('...and the side is back to what its names say', (await traits(tSen)).youth === false && (await traits(tSen)).women === true);
  await as('authenticated', true, async () => { await q(`select platform_team_set_women($1, null)`, [tSen]); });
  ok('a row that says nothing is removed', (await q(`select count(*) n from team_flags where team_id = $1`, [tSen]))[0].n === 0);
  await as('authenticated', true, async () => { await q(`select platform_team_set_youth($1, null, null)`, [tAcad]); await q(`select platform_team_set_youth($1, null, null)`, [t18]); });

  console.log('   a youth side in the club\'s group');
  ok('the club key does not see the youth words', (await q(`select link_team_key('London Lions U18') a, link_team_key('Seawolves Academy') b, link_team_key('Casademont Zaragoza Under 21') c`))
     .every(r => r.a === 'london lions' && r.b === 'seawolves' && r.c === 'casademont zaragoza'));
  ok('(the index was rebuilt: the youth side is found by the club\'s key)', (await q(`select count(*) n from teams where link_team_key(name) = 'london lions'`))[0].n === 5);
  const sg = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('team') r`))[0].r);
  const llset = sg.rows.find(r => r.key === 'london lions');
  ok('London Lions U18 is flagged as a possible match for the club, medium: the spelling differs', llset && llset.ids.includes(t18) && llset.confidence === 'medium' && /youth words/.test(llset.reason), llset && [llset.confidence, llset.reason]);
  ok('...its card says youth, U18', llset.cards.find(c => c.id === t18).youth === true && llset.cards.find(c => c.id === t18).age === 'U18');
  const joined = await as('authenticated', true, async () => (await q(`select platform_link_apply('team', $1::uuid[]) r`, [[t18, llSlb]]))[0].r);
  ok('a youth side links into the club\'s group', joined.members >= 3, joined);
  ok('the group keeps the club\'s own name, not the youth side\'s', (await q(`select g.name from team_groups g join team_group_members m on m.group_id = g.id where m.team_id = $1`, [t18]))[0].name !== 'London Lions U18');
  const pubLL = await as('anon', false, async () => (await q(`select linked_teams($1) r`, [llSlb]))[0].r);
  ok('the public list puts the youth side last, and says youth and the age', pubLL.teams[pubLL.teams.length - 1].id === t18 && pubLL.teams[pubLL.teams.length - 1].youth === true && pubLL.teams[pubLL.teams.length - 1].age === 'U18'
     && pubLL.teams[0].id === llSlb, pubLL.teams.map(t => [t.slug, t.youth]));
  const gl3 = await as('authenticated', true, async () => (await q(`select platform_link_groups('team', 'lions') r`))[0].r);
  ok('a group\'s members list the senior side first and the youth side after', gl3.rows[0].members[gl3.rows[0].members.length - 1].youth === true && gl3.rows[0].members[0].youth === false);
  ok('anybody can ask a team\'s traits', await as('anon', false, async () => (await q(`select team_traits($1) t`, [t18]))[0].t.youth === true));
}

console.log('-- one club set to women\'s / men\'s sets its whole league (0182)');
{
  const wl = await lg('aus-premier', 'Aussie Premier');                      // nothing in the names says who plays
  const aces = await team(wl, 'aces', 'Aces'), comets = await team(wl, 'comets', 'Comets'), sparks = await team(wl, 'sparks', 'Sparks'), odd = await team(wl, 'odd-ones', 'Odd Ones');
  const gen = async () => (await q(`select gender from leagues where id = $1`, [wl]))[0].gender;
  const reads = async ids => Promise.all(ids.map(w));
  const cardOf = async id => (await q(`select link_team_cards($1::uuid[]) r`, [[id]]))[0].r[0];
  ok('nothing in the names says women, and the league says nothing: all four read as not women', (await reads([aces, comets, sparks, odd])).every(x => x === false));
  await as('authenticated', true, async () => { await q(`select platform_team_set_women($1, false, false)`, [odd]); });          // a hand flag on one of them, the other way
  const r1 = await as('authenticated', true, async () => (await q(`select platform_team_set_women($1, true) r`, [aces]))[0].r);
  ok('setting one club to women\'s says it did the whole league: the league, how many teams, what was undone', r1.whole_league === true && r1.league.gender === 'women' && r1.league.slug === 'aus-premier' && r1.teams === 4 && r1.women === true, r1);
  ok('the league\'s gender is now women (the column the rail\'s W chip and the scouting filter read)', await gen() === 'women', await gen());
  ok('every team in it reads as women\'s, though nothing in its name says so', (await reads([aces, comets, sparks])).every(x => x === true), await reads([aces, comets, sparks]));
  ok('...and a hand flag on another team that said the opposite is handed back, so that team follows the league too', r1.cleared === 1 && await w(odd) === true
     && (await q(`select count(*) n from team_flags where team_id = $1`, [odd]))[0].n === 0, r1);
  ok('...the team that was set keeps its own flag', (await q(`select women from team_flags where team_id = $1`, [aces]))[0].women === true);
  ok('a team that joins the league later is women\'s straight away', await w(await team(wl, 'newbies', 'Newbies')) === true);
  const cA = await cardOf(aces), cC = await cardOf(comets);
  ok('a card says where the answer comes from: its own flag, or the league', cA.women_from === 'team' && cA.women_set === true && cC.women_from === 'league' && cC.women_set === false && cC.league_gender === 'women', [cA.women_from, cC.women_from, cC.league_gender]);
  ok('...and a team told by its name says "names"', (await cardOf(llW)).women_from === 'names');
  ok('the league change is in the audit log, with the team it came from', await (async () => { const a = (await q(`select detail from audit_log where action = 'set_league_gender' and subject_id = $1`, [wl])); return a.length === 1 && a[0].detail.gender === 'women' && a[0].detail.via_team === aces && a[0].detail.flags_cleared === 1; })());
  ok('anybody can ask, and a signed-out reader sees the same answer', await as('anon', false, async () => (await q(`select team_is_women($1) w`, [comets]))[0].w === true));

  const r2 = await as('authenticated', true, async () => (await q(`select platform_team_set_women($1, false) r`, [comets]))[0].r);
  ok('setting a club to men\'s sets the league to men\'s and every team reads so', r2.league.gender === 'men' && await gen() === 'men' && (await reads([aces, comets, sparks, odd])).every(x => x === false), r2);
  ok('...the women\'s flag that had been set on the first club is handed back', r2.cleared === 1 && (await q(`select count(*) n from team_flags where team_id = $1`, [aces]))[0].n === 0, r2);
  const r3 = await as('authenticated', true, async () => (await q(`select platform_team_set_women($1, true, false) r`, [sparks]))[0].r);
  ok('"this team only" leaves the league alone: one women\'s side in a men\'s league', r3.whole_league === false && await gen() === 'men' && await w(sparks) === true && await w(comets) === false && r3.cleared === 0, r3);
  await q(`update teams set gender = 'women' where id = $1`, [aces]);
  const r4 = await as('authenticated', true, async () => (await q(`select platform_team_set_women($1, false) r`, [comets]))[0].r);
  ok('a team\'s own recorded gender outranks its league\'s, and the answer says how many still read otherwise', await w(aces) === true && r4.kept === 1 && r4.teams >= 5, r4);
  ok('...and a hand flag set the other way on Sparks (women) was cleared by the men\'s setting', await w(sparks) === false && r4.cleared === 1, r4);
  await q(`update teams set gender = null where id = $1`, [aces]);
  await q(`update leagues set gender = 'mixed' where id = $1`, [wl]);
  const shy = await team(wl, 'shy-women', 'Shy Women');
  ok('a "mixed" league says nothing, so the names decide again', await w(shy) === true && await w(aces) === false);
  await as('authenticated', true, async () => { await q(`select platform_team_set_women($1, true)`, [shy]); });
  await as('authenticated', true, async () => { await q(`select platform_team_set_women($1, null)`, [shy]); });
  ok('handing a club back to "auto" clears that team\'s flag only: the league is not un-set from a club', await gen() === 'women' && (await q(`select count(*) n from team_flags where team_id = $1`, [shy]))[0].n === 0);
  const loose = (await q(`insert into teams (league_id, slug, name) values (null, 'no-league', 'Free Floaters') returning id`))[0].id;
  const r5 = await as('authenticated', true, async () => (await q(`select platform_team_set_women($1, true) r`, [loose]))[0].r);
  ok('a team with no league is only ever set alone', r5.whole_league === false && r5.league === null && r5.women === true && await w(loose) === true, r5);
  ok('a team that does not exist is refused', await as('authenticated', true, async () => { try { await db.query(`select platform_team_set_women(gen_random_uuid(), true)`); return false; } catch (e) { return /does not exist/.test(e.message); } }));
  ok('there is one setter: the old two-argument one is gone', (await q(`select count(*) n from pg_proc where proname = 'platform_team_set_women'`))[0].n === 1);
  ok('a signed-out visitor cannot set a league to women\'s through a team', await as('anon', false, async () => { try { await db.query(`select platform_team_set_women($1, true)`, [aces]); return false; } catch (e) { return /permission denied/.test(e.message); } }));
}

console.log('-- nobody but a platform administrator');
for (const [what, sql] of [['search', `select platform_link_search('team', 'x')`], ['suggestions', `select platform_link_suggestions('team')`],
    ['apply', `select platform_link_apply('team', '{}')`], ['remove', `select platform_link_remove('team', gen_random_uuid())`],
    ['groups', `select platform_link_groups('team')`], ['flag', `select platform_team_set_women(gen_random_uuid(), true)`],
    ['youth flag', `select platform_team_set_youth(gen_random_uuid(), true, null)`]]) {
  const asAnon = await as('anon', false, async () => { try { await db.query(sql); return 'ran'; } catch (e) { return e.message; } });
  const asUser = await as('authenticated', false, async () => { try { await db.query(sql); return 'ran'; } catch (e) { return e.message; } });
  ok(`${what}: a signed-out visitor cannot call it`, /permission denied/.test(asAnon), asAnon);
  ok(`${what}: a signed-in person who is not an administrator is refused`, /platform administrators only/.test(asUser), asUser);
}
const w3 = await as('authenticated', false, async () => { try { await db.query(`insert into team_group_members values (gen_random_uuid(), gen_random_uuid())`); return 'ran'; } catch (e) { return e.message; } });
ok('a browser cannot write a link directly', /permission denied/.test(w3), w3);

console.log('-- at the size it will be: thousands of teams and players');
await q(`insert into players (slug, first_name, last_name, birth_year)
         select 'bulk-' || i, (array['Tom','Ali','Ken','Luc','Ivo','Max','Ola','Jan'])[1 + i % 8], 'Bulkson' || (i % 1500), 1985 + i % 20 from generate_series(1, 6000) i`);
await q(`insert into teams (league_id, slug, name) select $1, 'bt-' || i, 'Bulk Club ' || (i % 900) from generate_series(1, 1800) i`, [slb]);
await q(`analyze`);
let t0 = Date.now();
const big = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('player', 25, 0) r`))[0].r);
const tPlayers = Date.now() - t0;
t0 = Date.now();
const bigT = await as('authenticated', true, async () => (await q(`select platform_link_suggestions('team', 25, 0) r`))[0].r);
const tTeams = Date.now() - t0;
t0 = Date.now();
await as('authenticated', true, async () => (await q(`select platform_link_search('player', 'bulkson12') r`))[0].r);
const tSearch = Date.now() - t0;
console.log(`      6,000 players: suggestions ${tPlayers} ms (${big.total} sets); 1,800 teams: ${tTeams} ms (${bigT.total} sets); a player search ${tSearch} ms`);
ok('the suggestions for six thousand players come back in a few seconds', tPlayers < 8000 && big.rows.length === 25, tPlayers);
ok('the suggestions for eighteen hundred teams too', tTeams < 4000 && bigT.rows.length === 25, tTeams);
ok('a search is quick', tSearch < 2000, tSearch);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
