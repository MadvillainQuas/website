// 0188: merging two rows of one club (platform_team_merge_preview / platform_team_merge), and the
// "Senior Men (I)" suggestion key (link_team_key), on a real Postgres (PGlite; skipped with a note
// when it is not installed - PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`).
// The migration is loaded on the minimum schema it reads, one table per foreign key it moves, so
// what is held here is the interesting part: that a merge moves everything that named the
// merged-away club into a place the surviving club does not already hold one, that a real second
// team (Senior Men II) is never suggested as its club's first team, and that every case which
// would be a mistake (two clubs that have played each other, one with a game not yet over, two
// different leagues) is refused.
//
//   node supabase/tests/team-merge.test.mjs
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
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), 'on') = 'on' $$;
  create function public.link_fold(p_name text) returns text language sql immutable as $$
    select nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')), '');
  $$;
  create function public.link_require_admin() returns void language plpgsql stable as $$
  begin if not public.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if; end $$;
  create table public.audit_log (id bigserial primary key, actor uuid, action text, subject text, subject_id text, detail jsonb, created_at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text);
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues, slug text unique, name text not null,
    short_name text not null default '', colour text not null default '#93f2bf', colour_2 text, colour_source text not null default 'default',
    logo_path text, aliases text[] not null default '{}', external_ids jsonb not null default '{}');
  create table public.competitions (id uuid primary key default gen_random_uuid(), league_id uuid, name text);
  create table public.competition_teams (competition_id uuid references public.competitions, team_id uuid references public.teams, primary key (competition_id, team_id));
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid, status text not null default 'final',
    home_team_id uuid references public.teams, away_team_id uuid references public.teams);
  create table public.bracket_ties (id uuid primary key default gen_random_uuid(), home_team_id uuid references public.teams,
    away_team_id uuid references public.teams, winner_team_id uuid references public.teams);
  create table public.seasons (id uuid primary key default gen_random_uuid());
  create table public.players (id uuid primary key default gen_random_uuid(), slug text unique, first_name text not null, last_name text default '');
  create table public.roster_entries (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams,
    player_id uuid not null references public.players on delete cascade, season_id uuid references public.seasons);
  create table public.standings (competition_id uuid, team_id uuid references public.teams, wins int default 0, primary key (competition_id, team_id));
  create table public.feed_team_season (competition_id uuid, team_id uuid references public.teams, points int default 0, primary key (competition_id, team_id));
  create table public.player_releases (team_id uuid references public.teams, player_id uuid not null references public.players on delete cascade, primary key (team_id, player_id));
  create table public.merch_designs (id uuid primary key default gen_random_uuid(), league_id uuid, team_id uuid references public.teams, kind text, unique (league_id, team_id, kind));
  create table public.team_contacts (team_id uuid primary key references public.teams on delete cascade, email text);
  create table public.team_socials (team_id uuid primary key references public.teams on delete cascade, instagram text);
  create table public.team_flags (team_id uuid primary key references public.teams on delete cascade, women boolean);
  create table public.season_awards (competition_id uuid, code text, team_id uuid references public.teams, primary key (competition_id, code));
  create table public.season_award_overrides (id uuid primary key default gen_random_uuid(), competition_id uuid, code text, team_id uuid references public.teams);
  create table public.toty_candidates (id uuid primary key default gen_random_uuid(), ballot_id uuid, team_id uuid references public.teams);
  create table public.toty_results (id uuid primary key default gen_random_uuid(), ballot_id uuid, team_id uuid references public.teams);
  create table public.team_staff (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, role text);
  create table public.team_sanctions (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, reason text);
  create table public.player_suspensions (id uuid primary key default gen_random_uuid(), player_id uuid references public.players, team_id uuid references public.teams);
  create table public.contact_messages (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, body text);
  create table public.embed_sites (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, host text);
  create table public.announcements (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams, body text);
  create table public.media (id uuid primary key default gen_random_uuid(), owner_type text, owner_id uuid, storage_path text);
  create table public.team_groups (id uuid primary key default gen_random_uuid(), name text, created_at timestamptz default now(), created_by uuid);
  create table public.team_group_members (team_id uuid primary key references public.teams on delete cascade, group_id uuid not null references public.team_groups on delete cascade, linked_by uuid);
  create table public.fan_prefs (user_id uuid primary key default gen_random_uuid(), fav_team_ids uuid[] not null default '{}');
  create table public.fanvote_candidates (round_id uuid, kind text, subject_id uuid, team_id uuid, rank int default 1, primary key (round_id, kind, subject_id));
`);
await db.exec(mig('0188_team_merge.sql'));

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const asAdmin = on => db.exec(`select set_config('test.admin', '${on ? 'on' : 'off'}', false); select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

console.log('-- the suggestion key: "Senior Men (I)" names nobody, "Senior Men II" a real second team');
ok('a club and its own Genius full name share a key', (await one(`select link_team_key('London Elite Senior Men I') k`)).k === (await one(`select link_team_key('London Elite') k`)).k);
ok('...the trailing "s" too', (await one(`select link_team_key('Barnet Bulldogs Senior Mens') k`)).k === (await one(`select link_team_key('Barnet Bulldogs') k`)).k);
ok('...no numeral at all', (await one(`select link_team_key('Barnet Bulldogs Senior Men') k`)).k === (await one(`select link_team_key('Barnet Bulldogs') k`)).k);
ok('a genuine second team keeps a different key', (await one(`select link_team_key('London Lions Senior Men II') k`)).k !== (await one(`select link_team_key('London Lions') k`)).k);

/* ------------------------------------------------------------------------------------------------------ the data --- */
const KEEP = 'aaaaaaaa-0000-0000-0000-000000000001', OTHER = 'bbbbbbbb-0000-0000-0000-000000000002',
  RIVAL = 'cccccccc-0000-0000-0000-000000000003', OTHER_LEAGUE = 'dddddddd-0000-0000-0000-000000000004';
const LG1 = '15000000-0000-0000-0000-000000000001', LG2 = '15000000-0000-0000-0000-000000000002';
const C1 = '20000000-0000-0000-0000-000000000001', S1 = '40000000-0000-0000-0000-000000000001';
const P1 = '30000000-0000-0000-0000-000000000001', P2 = '30000000-0000-0000-0000-000000000002';
const G1 = '10000000-0000-0000-0000-000000000001',
  GRIVAL = '10000000-0000-0000-0000-000000000003', GLIVE = '10000000-0000-0000-0000-0000000000f1';
const ROUND = '60000000-0000-0000-0000-000000000001', GRP = '70000000-0000-0000-0000-000000000001', GRP2 = '70000000-0000-0000-0000-000000000002';

async function seed() {
  await db.exec(`truncate public.teams, public.leagues, public.competitions, public.games, public.players, public.seasons,
    public.team_groups, public.fan_prefs, public.audit_log, public.team_merges, public.media, public.fanvote_candidates,
    public.bracket_ties, public.merch_designs restart identity cascade`);
  await q(`insert into public.leagues (id, slug, name) values ($1, 'nbl-d1', 'NBL Division One'), ($2, 'weabl', 'WEABL')`, [LG1, LG2]);
  await q(`insert into public.teams (id, league_id, slug, name, short_name, colour, colour_source, logo_path, aliases, external_ids) values
    ($1, $3, 'london-elite', 'London Elite', 'LON', '#93f2bf', 'default', null, '{}', '{"fiba_livestats":"london-elite"}'),
    ($2, $3, 'london-elite-senior-men-i', 'London Elite Senior Men I', '', '#e2643b', 'logo', 'crest.png', '{}', '{"fiba_livestats":"london-elite-senior-men-i"}'),
    ($4, $3, 'greenwich-titans', 'Greenwich Titans', 'GTI', '#93f2bf', 'default', null, '{}', '{}'),
    ($5, $6, 'other-league-club', 'A Different League''s Club', '', '#93f2bf', 'default', null, '{}', '{}')`,
    [KEEP, OTHER, LG1, RIVAL, OTHER_LEAGUE, LG2]);
  await q(`insert into public.competitions (id, league_id, name) values ($1, $2, 'NBL Division One 2026-27')`, [C1, LG1]);
  await q(`insert into public.competition_teams values ($1, $2), ($1, $3)`, [C1, KEEP, RIVAL]);   // KEEP already entered; OTHER is not
  await q(`insert into public.seasons (id) values ($1)`, [S1]);
  await q(`insert into public.players (id, slug, first_name, last_name) values ($1, 'a-player', 'A', 'Player'), ($2, 'b-player', 'B', 'Player')`, [P1, P2]);
  await q(`insert into public.roster_entries (team_id, player_id, season_id) values ($1, $3, $5), ($2, $4, $5)`, [KEEP, OTHER, P1, P2, S1]);
  await q(`insert into public.games (id, competition_id, status, home_team_id, away_team_id) values
    ($1, $2, 'final', $3, $4), ($5, $2, 'final', $6, $3)`, [GRIVAL, C1, RIVAL, KEEP, G1, OTHER]);   // GRIVAL: RIVAL v KEEP; G1 (OTHER's one game): OTHER v RIVAL
  await q(`insert into public.team_contacts (team_id, email) values ($1, 'other@x.example')`, [OTHER]);
  await q(`insert into public.team_socials (team_id, instagram) values ($1, '@other')`, [OTHER]);
  await q(`insert into public.team_flags (team_id, women) values ($1, false)`, [OTHER]);
  await q(`insert into public.season_awards (competition_id, code, team_id) values ($1, 'fair-play', $2)`, [C1, OTHER]);
  await q(`insert into public.media (owner_type, owner_id, storage_path) values ('team', $1, 'team/other.webp')`, [OTHER]);
  await q(`insert into public.team_groups (id, name) values ($1, 'London Elite'), ($2, 'Some Other Group')`, [GRP, GRP2]);
  await q(`insert into public.team_group_members (team_id, group_id) values ($1, $2), ($3, $4)`, [KEEP, GRP2, OTHER, GRP]);
  await q(`insert into public.fan_prefs (fav_team_ids) values (array[$1::uuid, $2::uuid]), (array[$1::uuid])`, [OTHER, KEEP]);
  await q(`insert into public.fanvote_candidates (round_id, kind, subject_id) values ($1, 'team', $2), ($1, 'team', $3)`, [ROUND, OTHER, KEEP]);
}
await asAdmin(true);
await seed();

console.log('\n-- the preview');
const pv = (await one(`select public.platform_team_merge_preview($1, $2) r`, [KEEP, OTHER])).r;
ok('it names both clubs and what would move', pv.keep.name === 'London Elite' && pv.other.name === 'London Elite Senior Men I'
   && pv.counts.games === 1 && pv.counts.rosters === 1 && pv.counts.photos === 1 && pv.counts.followers === 2, pv);
ok('no blockers for a genuine same-club pair', pv.blockers.length === 0, pv.blockers);

console.log('\n-- refused');
ok('two clubs in different leagues', /different leagues/.test(await fails(() => q(`select public.platform_team_merge($1, $2)`, [KEEP, OTHER_LEAGUE]))));
ok('two clubs that have played each other', /played each other/.test(await fails(() => q(`select public.platform_team_merge($1, $2)`, [KEEP, RIVAL]))));
ok('one of them has a game not yet final', await (async () => {
  await q(`insert into public.games (id, competition_id, status, home_team_id, away_team_id) values ($1, $2, 'live', $3, $4)`, [GLIVE, C1, OTHER, RIVAL]);
  const msg = await fails(() => q(`select public.platform_team_merge($1, $2)`, [KEEP, OTHER]));
  await q(`delete from public.games where id = $1`, [GLIVE]);
  return /not finished/.test(msg || '');
})());
ok('the same club twice', /two different clubs/.test(await fails(() => q(`select public.platform_team_merge($1, $2)`, [KEEP, KEEP]))));
ok('a signed-out visitor cannot call it', await (async () => {
  await asAdmin(false); await db.exec(`select set_config('test.uid', '', false)`);
  const msg = await fails(() => q(`select public.platform_team_merge($1, $2)`, [KEEP, OTHER]));
  await asAdmin(true);
  return /administrators only/.test(msg || '');
})());

console.log('\n-- the merge');
const r = (await one(`select public.platform_team_merge($1, $2) r`, [KEEP, OTHER])).r;
ok('it says what moved', r.competitions === 0 && r.games === 1 && r.rosters === 1 && r.photos === 1 && r.followers === 2, r);

ok('the merged-away row is gone', (await q(`select 1 from public.teams where id = $1`, [OTHER])).length === 0);
ok('everything that pointed at it now points at the survivor', await (async () => {
  const g = await q(`select 1 from public.games where home_team_id = $1`, [KEEP]);           // G1's home was OTHER
  const re = await q(`select 1 from public.roster_entries where team_id = $1 and player_id = $2`, [KEEP, P2]);
  const tc = await q(`select email from public.team_contacts where team_id = $1`, [KEEP]);
  const ts = await q(`select instagram from public.team_socials where team_id = $1`, [KEEP]);
  const tf = await q(`select women from public.team_flags where team_id = $1`, [KEEP]);
  const sa = await q(`select 1 from public.season_awards where team_id = $1 and code = 'fair-play'`, [KEEP]);
  const md = await q(`select owner_id from public.media where storage_path = 'team/other.webp'`);
  return g.length === 1 && re.length === 1 && tc[0]?.email === 'other@x.example' && ts[0]?.instagram === '@other'
    && tf[0]?.women === false && sa.length === 1 && md[0]?.owner_id === KEEP;
})());
ok('a competition row already on the survivor is not duplicated (OTHER never entered it anyway, so the survivor still holds its own one row)',
   (await q(`select 1 from public.competition_teams where competition_id = $1 and team_id = $2`, [C1, KEEP])).length === 1);
ok('the surviving row adopted the crest and the stronger colour_source, since it had neither',
   await (async () => { const t = await one(`select logo_path, colour, colour_source from public.teams where id = $1`, [KEEP]);
                        return t.logo_path === 'crest.png' && t.colour === '#e2643b' && t.colour_source === 'logo'; })());
ok('the merged-away name became an alias, its feed code kept under external_ids', await (async () => {
  const t = await one(`select aliases, external_ids from public.teams where id = $1`, [KEEP]);
  return t.aliases.includes('London Elite Senior Men I') && JSON.stringify(t.external_ids).includes('london-elite-senior-men-i');
})());
ok('both groups became one, the survivor kept in its own (a group left with one member is not a link any more)', await (async () => {
  const gm = await q(`select group_id from public.team_group_members where team_id = $1`, [KEEP]);
  const left = await q(`select 1 from public.team_groups where id = $1`, [GRP]);
  return gm[0].group_id === GRP2 && left.length === 0;
})());
ok('a fan who already favourited both now favourites the survivor once, not twice', await (async () => {
  const fp = await q(`select fav_team_ids from public.fan_prefs order by fav_team_ids`);
  return fp.every(r => r.fav_team_ids.filter(x => x === KEEP).length === 1 && !r.fav_team_ids.includes(OTHER));
})());
ok('the fan-vote candidate collision was dropped, not duplicated (one row per round already existed for the survivor)',
   (await q(`select 1 from public.fanvote_candidates where round_id = $1 and subject_id = $2`, [ROUND, KEEP])).length === 1);
ok('the old address still resolves', await (async () => {
  const m = await one(`select into_id from public.team_merges where old_id = $1`, [OTHER]);
  return m.into_id === KEEP;
})());
ok('an audit row was written', (await q(`select 1 from public.audit_log where action = 'team_merge'`)).length === 1);

// ---- 0192: the pairs merged by the migration, and a fixture ahead no longer blocks a merge ----------------------
console.log('\n-- 0192: every "X" / "X Senior Men (I)" pair in one league, merged');
{
  await seed();
  const T = n => '00000000-0000-0000-0000-0000000019' + String(n).padStart(2, '0');
  await q(`insert into public.teams (id, league_id, slug, name, short_name, colour, colour_source, logo_path, aliases, external_ids) values
    ($1, $7, 'barnet-bulldogs', 'Barnet Bulldogs', '', '#93f2bf', 'default', null, '{}', '{}'),
    ($2, $7, 'barnet-bulldogs-senior-mens', 'Barnet Bulldogs Senior Mens', '', '#93f2bf', 'default', null, '{}', '{}'),
    ($3, $7, 'tees-valley-mohawks-senior-men-i', 'Tees Valley Mohawks Senior Men I', '', '#93f2bf', 'default', null, '{}', '{}'),
    ($4, $7, 'london-lions-senior-men-ii', 'London Lions Senior Men II', '', '#93f2bf', 'default', null, '{}', '{}'),
    ($5, $8, 'worcester-wolves', 'Worcester Wolves', '', '#93f2bf', 'default', null, '{}', '{}'),
    ($6, $7, 'worcester-wolves-senior-women-i', 'Worcester Wolves Senior Women I', '', '#93f2bf', 'default', null, '{}', '{}')`,
    [T(1), T(2), T(3), T(4), T(5), T(6), LG1, LG2]);
  // a fixture still to play on the twin that is merged away: it must move, not block
  await q(`insert into public.games (id, competition_id, status, home_team_id, away_team_id) values ($1, $2, 'scheduled', $3, $4)`,
          [T(90), C1, T(2), RIVAL]);
  await db.exec(mig('0192_merge_senior_twins.sql'));
  const names = (await q(`select id, name, aliases from public.teams order by name`));
  const byId = id => names.find(t => t.id === id);
  ok('the twin in the same league was merged into the plain-named row', !byId(T(2)) && !!byId(T(1)),
     names.map(t => t.name).join(' | '));
  ok('...and the fixture it still had to play moved with it', (await one(`select home_team_id from public.games where id = $1`, [T(90)])).home_team_id === T(1));
  ok('...its name kept as an alias', byId(T(1)).aliases.includes('Barnet Bulldogs Senior Mens'));
  ok('the London Elite pair from the seed was merged too', !byId(OTHER) && !!byId(KEEP));
  ok('a club with no plain twin keeps its row and takes the plain name, the full one an alias',
     byId(T(3)).name === 'Tees Valley Mohawks' && byId(T(3)).aliases.includes('Tees Valley Mohawks Senior Men I'));
  ok('a club\'s "II" side is another squad: untouched', byId(T(4)).name === 'London Lions Senior Men II');
  ok('two leagues are never merged: the women\'s side is only renamed in its own league',
     !!byId(T(5)) && byId(T(6)).name === 'Worcester Wolves');
  ok('the merges are on the record, by nobody (the platform itself)',
     (await q(`select 1 from public.team_merges where old_id = $1 and merged_by is null`, [T(2)])).length === 1);
}
console.log('\n-- 0192: the administrators\' door');
{
  await seed();
  await q(`insert into public.games (id, competition_id, status, home_team_id, away_team_id) values
           ('00000000-0000-0000-0000-000000001991', $1, 'scheduled', $2, $3)`, [C1, OTHER, RIVAL]);
  await asAdmin(false); await db.exec(`select set_config('test.uid', '', false)`);
  let refused = false;
  try { await q(`select public.platform_team_merge($1, $2)`, [KEEP, OTHER]); } catch (e) { refused = true; }
  ok('platform_team_merge still refuses anybody but an administrator', refused);
  await asAdmin(true);
  const r = await one(`select public.platform_team_merge($1, $2) r`, [KEEP, OTHER]);
  ok('a club with a fixture still to play can be merged now', r.r && r.r.kept === KEEP, JSON.stringify(r.r));
  ok('...and its merged_by is the administrator', (await one(`select merged_by from public.team_merges where old_id = $1`, [OTHER])).merged_by === '11111111-1111-1111-1111-111111111111');
  let direct = false;
  try { await db.exec(`set role authenticated; select public.team_merge_run('${KEEP}', '${RIVAL}', null);`); } catch (e) { direct = true; }
  await db.exec('reset role');
  ok('team_merge_run cannot be called by a signed-in user directly', direct);
}

if (fail) { console.log(`\n${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\nteam merge: ${pass} passed - two rows of one club become one, and 'Senior Men (I)' is not mistaken for a second team`);
