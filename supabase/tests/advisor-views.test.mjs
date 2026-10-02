/* ============================================================================
   NO OWNER-RIGHTS VIEW WHERE THE API CAN REACH IT, AND NOBODY SEES ANYTHING
   DIFFERENT FOR IT (0218).

   Supabase's security advisor (lint 0010) flagged player_season_stats,
   team_season_stats, team_staff_public and game_rows_public: owner-rights views
   in public. 0218 makes team_staff_public a real invoker view over column
   grants and a read policy, and moves the other three queries, letter for
   letter, to the private schema (not served by PostgREST) behind public
   security_invoker views; the six read policies read the fast path from there.

   The files first (no database): the latest definition of each public name
   says security_invoker, and the latest owner-rights queries keep what made
   them owner-rights (0171's masking, 0147's privacy line, 0151's fast path).

   Then on a real Postgres (PGlite; skipped with a note when it is not
   installed): EVERY migration before 0218 applied, a fixture of every kind of
   league the rules tell apart (open; publishing live; members-only; private;
   private and members-only; a game in no league; a cup tie across two), a
   withheld minor, active and retired staff, box scores and events; then, as
   thirteen readers (signed out, a fan, a platform admin, a league admin, a
   private league's admin, a club manager, a game official, a private league's
   guest, a subscriber, an access grant, a statistician, the service role) with
   memberships switched off and on, every row and column of the four views, the
   six tables whose read policy uses the fast path, and season_leaders(),
   recorded; 0218 applied; all of it read again and compared, exactly.
   Plus: lint 0010 as Supabase runs it finds nothing; 0218 refuses (and changes
   nothing) when a public view is no longer the query it copies; it applies
   twice; the plans of the reads are the plans they were, and the box-score
   reads still take 0151's fast path (a primary-key probe of games through a
   scalar sub-select, never a hashed scan of every public game).

     node supabase/tests/advisor-views.test.mjs
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { allMigrations, applyMigration, migrationText } from './pg-all-migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGDIR = path.join(here, '..', 'migrations');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '\n          ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 1500))); } };

const files = readdirSync(MIGDIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
const F = files.find(f => /^\d{4}_advisor_views\.sql$/.test(f));
const NUM = F ? F.slice(0, 4) : '9999';
const sqlOf = f => readFileSync(path.join(MIGDIR, f), 'utf8');
const M = F ? sqlOf(F) : '';

/* ------------------------------------------------------------------ the files --- */
console.log('the files');
ok('the migration is there (' + F + ')', !!F);
const VIEWS = ['player_season_stats', 'team_season_stats', 'team_staff_public', 'game_rows_public'];
for (const v of VIEWS) {
  /* the last file that (re)defines public.<v>; a CREATE OR REPLACE without the option turns it back into owner-rights */
  let last = null;
  for (const f of files) {
    const re = new RegExp('create\\s+(?:or\\s+replace\\s+)?view\\s+public\\.' + v + '\\b([^;]*?)\\bas\\b', 'gi');
    let m; while ((m = re.exec(sqlOf(f)))) last = { f, opts: m[1] };
  }
  ok('the latest public.' + v + ' (' + (last && last.f.slice(0, 4)) + ') is security_invoker',
     !!last && /security_invoker\s*=\s*(true|on)/i.test(last.opts), last);
}
{
  const lastPriv = name => [...files].reverse().find(f => new RegExp('create or replace view private\\.' + name + ' as').test(sqlOf(f)));
  const p = lastPriv('player_season_stats'), t = lastPriv('team_season_stats'), g = lastPriv('game_rows_public');
  ok('private.player_season_stats still masks a withheld player\'s name (0171)', !!p && /may_see_withheld_player\(/.test(sqlOf(p)) && /when w\.hide then null else p\.first_name/.test(sqlOf(p)));
  const PRIV = "coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)";
  ok('...and both season queries still ask about privacy (0147)', !!p && !!t && sqlOf(p).split(PRIV).length >= 3 && sqlOf(t).includes(PRIV));
  ok('private.game_rows_public is 0151\'s fast path', !!g && /game_rows_open_competitions\(false\)/.test(sqlOf(g)) && /game_rows_open_competitions\(true\)/.test(sqlOf(g)));
  ok('...owner-rights there, and SELECT only', !/create or replace view private\.\w+ with/.test(M) &&
     /alter view private\.game_rows_public owner to postgres;/.test(M) &&
     /revoke all on private\.game_rows_public from public, anon, authenticated, service_role;/.test(M) &&
     /grant select on private\.game_rows_public to anon, authenticated;/.test(M) && !/grant (all|insert|update|delete)[^;]*private\./.test(M));
}
ok('the read policies take the fast path from private, the same scalar sub-select',
   /'coalesce\(\(select true from private\.game_rows_public p '\s*'where p\.id = %1\$s\), false\) '\s*'or public\.can_read_game_rows\(%1\$s\)'/.test(M));
ok('...it refuses to move a query some later file changed (compared as Postgres prints it)',
   /pg_get_viewdef\(format\('public\.%I', v_view\)::regclass\)/.test(M) && /is no longer the query this file copies/.test(M));
ok('...one statement, all or nothing, and never RESET ROLE',
   /^do \$mig\$/m.test(M.replace(/--[^\n]*\n/g, '\n').trim()) && /end \$mig\$;$/.test(M.replace(/--[^\n]*\n/g, '\n').trim()) && M.split('$mig$').length === 3 && !/reset role/i.test(M.replace(/--[^\n]*\n/g, '\n')));
ok('team_staff: the browser roles read only the columns the view shows, the active rows',
   /revoke select on public\.team_staff from anon, authenticated;\s*grant select \(id, team_id, name, role, born_year, sort, active\) on public\.team_staff to anon, authenticated;/.test(M) &&
   /create policy team_staff_active_read on public\.team_staff\s+for select to anon, authenticated\s+using \(active\);/.test(M));
/* no later file grants team_staff wholesale again, or adds a column without saying whether it is public */
for (const f of files.filter(f => F && f > F)) {
  const s = sqlOf(f);
  ok(f + ' does not give the browser roles all of team_staff again', !/grant select on (table )?public\.team_staff\b(?!_)[^;]*to[^;]*(anon|authenticated)/i.test(s));
}

/* --------------------------------------------------------------- the database --- */
const T0 = Date.now();
const built = await allMigrations({ before: NUM });
if (!built) { console.log('\nSKIP  the database part: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const { db, failed } = built;
console.log(`\nevery migration before ${NUM} on PGlite (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
ok('they all apply', failed.length === 0, failed);
const q = async (sql, params) => (await db.query(sql, params)).rows;

async function fx(sql) { try { await db.exec(sql); } catch (e) { console.log('fixture failed: ' + e.message + ' / ' + (e.where || '')); process.exit(1); } }
/* ---- the fixture: 0151's kinds of league, with box scores, events, players and staff ---- */
const OPEN_EXTRA = 60;     // more finished games in the open league, for the plans and the timings
await fx(`
create table public.zz_fx (k text primary key, id uuid not null);
do $fx$
declare
  kinds    text[] := array['open', 'live', 'members', 'private', 'private_members', 'none'];
  statuses text[] := array['scheduled', 'live', 'finalising', 'final', 'void'];
  kd text; st text; gid uuid; lid uuid; sid uuid; cid uuid; th uuid; ta uuid; pid uuid; i int; j int; side int; tm uuid;
begin
  perform set_config('epinoia.access_rpc', 'on', true);
  perform set_config('epinoia.visibility_rpc', 'on', true);
  foreach kd in array kinds loop
    lid := null; cid := null; sid := null;
    if kd <> 'none' then
      insert into public.leagues (slug, name, public_live, access_mode, visibility)
      values ('zz-av-' || replace(kd, '_', '-'), 'AV ' || kd, kd in ('live', 'members', 'private'),
              case when kd in ('members', 'private_members') then 'members' else 'open' end,
              case when kd in ('private', 'private_members') then 'private' else 'public' end)
      returning id into lid;
      insert into public.seasons (league_id, name) values (lid, 'AV') returning id into sid;
      insert into public.competitions (season_id, name) values (sid, 'AV League') returning id into cid;
      insert into zz_fx values ('lg/' || kd, lid), ('cp/' || kd, cid);
    end if;
    insert into public.teams (league_id, slug, name, short_name) values (lid, 'zz-av-' || replace(kd, '_', '-') || '-h', 'AV ' || kd || ' home', 'H' || left(kd, 3)) returning id into th;
    insert into public.teams (league_id, slug, name, short_name) values (lid, 'zz-av-' || replace(kd, '_', '-') || '-a', 'AV ' || kd || ' away', 'A' || left(kd, 3)) returning id into ta;
    insert into zz_fx values ('th/' || kd, th), ('ta/' || kd, ta);
    -- three players a side: an adult, a withheld minor (home only), a minor with consent
    foreach tm in array array[th, ta] loop
      for i in 0 .. 2 loop
        insert into public.players (slug, first_name, last_name, is_minor, public_consent)
        values ('zz-av-' || replace(kd, '_', '-') || '-' || (case when tm = th then 'h' else 'a' end) || i,
                'P' || i, kd || (case when tm = th then 'H' else 'A' end),
                i > 0, not (i = 1 and tm = th))
        returning id into pid;
        insert into zz_fx values ('pl/' || kd || '/' || (case when tm = th then 'h' else 'a' end) || i, pid);
        insert into public.roster_entries (team_id, player_id, season_id, jersey) values (tm, pid, sid, (10 + i)::text);
      end loop;
      insert into public.team_staff (team_id, name, role, born_year, sort) values
        (tm, 'Coach ' || kd, 'Head Coach', 1980, 10), (tm, 'Assistant ' || kd, 'Assistant Coach', null, 20);
      insert into public.team_staff (team_id, name, role, born_year, sort, active) values (tm, 'Gone ' || kd, 'Physio', 1990, 50, false);
    end loop;
    foreach st in array statuses loop
      for j in 1 .. (case when kd = 'open' and st = 'final' then 1 + ${OPEN_EXTRA} else 1 end) loop
        insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
        values (cid, th, ta, now() - make_interval(days => j), 'live', 70 + j % 13, 65 + j % 11)
        returning id into gid;
        if j = 1 then insert into zz_fx values ('g/' || kd || '/' || st, gid); end if;
        if st <> 'scheduled' then
          for side in 0 .. 1 loop
            for i in 0 .. 2 loop
              insert into public.player_game_stats (game_id, player_id, player_uuid, team_idx, stats)
              select gid, 'p' || side || i, z.id, side,
                     jsonb_build_object('pts', 5 + i * 3 + j % 7, 'ast', i + j % 3, 'or', 1, 'dr', 2 + i, 'stl', j % 2, 'blk', i % 2, 'to', 1,
                                        'pf', 2, 'p2m', 2, 'p2a', 4, 'p3m', i, 'p3a', 3, 'ftm', 1, 'fta', 2, 'min', 600000 * (i + 1), 'pm', side - i)
                from zz_fx z where z.k = 'pl/' || kd || '/' || (case when side = 0 then 'h' else 'a' end) || i;
            end loop;
            insert into public.team_game_stats (game_id, team_idx, stats)
            values (gid, side, jsonb_build_object('pts', 70 + side, 'paint', 30, 'fast', 8, 'sc', 6, 'pot', 9, 'bench', 12, 'toTot', 11, 'foulTot', 18,
                    'adv', jsonb_build_object('possessions', 71.5, 'efg', 0.51, 'ts', 0.55, 'ortg', 101.2, 'pace', 70.1, 'astTo', 1.4, 'tovp', 13.2,
                                              'orebp', 25.0, 'ftr', 0.22, 'fgm', 27, 'fga', 60, 'fg3m', 8 + side, 'fg3a', 25, 'ftm', 10, 'fta', 14,
                                              'oreb', 9, 'dreb', 25 + side, 'ast', 15, 'stl', 6, 'blk', 3)));
          end loop;
          insert into public.game_events (game_id, seq, t, team, period, clock) values (gid, 1, 'p2_made', 0, 1, 500000), (gid, 2, 'p3_made', 1, 1, 480000);
          insert into public.game_state (game_id) values (gid);
          insert into public.lineup_stints (game_id, team_idx, player_ids, stats) values (gid, 0, array['p00', 'p01'], '{}'::jsonb);
        end if;
        if st <> 'live' then update public.games set status = st::public.game_status where id = gid; end if;
      end loop;
    end loop;
  end loop;
  -- a cup tie in the private members-only league, at home to the OPEN league's club (0151)
  insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
  select (select id from zz_fx where k = 'cp/private_members'), (select id from zz_fx where k = 'th/open'), (select id from zz_fx where k = 'ta/private_members'),
         now() - interval '2 days', 'live', 80, 77
  returning id into gid;
  insert into zz_fx values ('g/cup', gid);
  for side in 0 .. 1 loop
    insert into public.player_game_stats (game_id, player_id, player_uuid, team_idx, stats)
    select gid, 'c' || side, z.id, side, jsonb_build_object('pts', 31, 'ast', 2, 'or', 1, 'dr', 1, 'min', 1800000)
      from zz_fx z where z.k = case when side = 0 then 'pl/open/h1' else 'pl/private_members/a0' end;
    insert into public.team_game_stats (game_id, team_idx, stats) values (gid, side, jsonb_build_object('pts', 80, 'adv', jsonb_build_object('oreb', 5, 'dreb', 20, 'ast', 9)));
  end loop;
  update public.games set status = 'final' where id = gid;
  perform set_config('epinoia.access_rpc', '', true);
  perform set_config('epinoia.visibility_rpc', '', true);
end
$fx$;

do $who$
declare r record; gid uuid;
begin
  for r in select * from (values ('platform_admin'), ('league_admin'), ('private_admin'), ('manager'), ('official'),
                                 ('guest'), ('subscriber'), ('grant'), ('statistician'), ('fan')) v(label) loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'av-' || replace(r.label, '_', '-') || '@example.invalid', '', now(), now(), now())
    returning id into gid;
    insert into zz_fx values ('u/' || r.label, gid);
  end loop;
  insert into public.memberships (user_id, role, scope_type, scope_id) values
    ((select id from zz_fx where k = 'u/platform_admin'), 'platform_admin', 'platform', null),
    ((select id from zz_fx where k = 'u/league_admin'),   'league_admin',   'league', (select id from zz_fx where k = 'lg/members')),
    ((select id from zz_fx where k = 'u/private_admin'),  'league_admin',   'league', (select id from zz_fx where k = 'lg/private_members')),
    ((select id from zz_fx where k = 'u/manager'),        'team_manager',   'team',   (select id from zz_fx where k = 'th/open')),
    ((select id from zz_fx where k = 'u/statistician'),   'statistician',   'league', (select id from zz_fx where k = 'lg/private'));
  insert into public.game_officials (game_id, user_id, role) values
    ((select id from zz_fx where k = 'g/open/scheduled'), (select id from zz_fx where k = 'u/official'), 'statistician'),
    ((select id from zz_fx where k = 'g/private/live'),   (select id from zz_fx where k = 'u/official'), 'statistician'),
    ((select id from zz_fx where k = 'g/members/final'),  (select id from zz_fx where k = 'u/official'), 'statistician');
  insert into public.league_guests (league_id, user_id) values ((select id from zz_fx where k = 'lg/private'), (select id from zz_fx where k = 'u/guest'));
  insert into public.access_subscriptions (user_id, plan_id, league_id, features, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  values ((select id from zz_fx where k = 'u/subscriber'), null, (select id from zz_fx where k = 'lg/members'), array['league'], 'active',
          'sub_av', 'cus_av', now() + interval '20 days');
  insert into public.access_grants (league_id, email, features)
  values ((select id from zz_fx where k = 'lg/private_members'), 'av-grant@example.invalid', array['league']);
end
$who$;
`);
/* a platform's worth of other games (fixtures, no box scores), so the planner reads games the way it does live */
await fx(`insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status)
          select (select id from zz_fx where k = 'cp/open'), (select id from zz_fx where k = 'th/open'), (select id from zz_fx where k = 'ta/open'),
                 now() + make_interval(hours => g), 'scheduled' from generate_series(1, 4000) g;
          analyze;`);
const FX = Object.fromEntries((await q('select k, id from zz_fx')).map(r => [r.k, r.id]));
const counts = (await q(`select (select count(*) from games)::int g, (select count(*) from player_game_stats)::int pgs, (select count(*) from record_lines)::int rl,
                                (select count(*) from team_staff)::int staff, (select count(*) from players where is_minor and not public_consent)::int withheld`))[0];
ok('the fixture is there: games, box scores, record lines, staff (one retired a club), a withheld minor a home club',
   counts.g > 4000 && counts.pgs > 100 && counts.rl > 0 && counts.staff >= 36 && counts.withheld === 6, counts);

const READERS = ['anon', 'fan', 'platform_admin', 'league_admin', 'private_admin', 'manager', 'official', 'guest',
                 'subscriber', 'grant', 'statistician', 'service_role'];
async function as(label, fn) {
  const role = label === 'anon' ? 'anon' : label === 'service_role' ? 'service_role' : 'authenticated';
  const claims = label === 'anon' || label === 'service_role' ? { role }
    : { sub: FX['u/' + label], role: 'authenticated', email: 'av-' + label.replace(/_/g, '-') + '@example.invalid' };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
async function memberships(on) {
  await db.query(`insert into public.platform_settings (key, value) values ('memberships_enabled', to_jsonb($1::boolean))
                  on conflict (key) do update set value = excluded.value`, [on]);
}
const READS = {
  player_season_stats: 'select * from public.player_season_stats order by competition_id, player_id, team_id',
  team_season_stats: 'select * from public.team_season_stats order by competition_id, team_id',
  team_staff_public: 'select * from public.team_staff_public order by id',
  game_rows_public: 'select id from public.game_rows_public order by id',
  season_leaders: `select l.* from public.competitions c cross join lateral public.season_leaders(c.id, 1) l order by 1, 2, 3`,
};
for (const t of ['game_events', 'game_state', 'player_game_stats', 'team_game_stats', 'lineup_stints', 'record_lines'])
  READS[t] = `select game_id, count(*)::int n from public.${t} group by 1 order by 1`;

async function snapshot() {
  const out = {};
  for (const on of [false, true]) {
    await memberships(on);
    for (const who of READERS) {
      for (const [name, sql] of Object.entries(READS)) {
        let v; try { v = await as(who, () => q(sql)); } catch (e) { v = 'ERROR ' + e.message; }
        out[`${on ? 'on' : 'off'}/${who}/${name}`] = JSON.stringify(v);
      }
    }
  }
  await memberships(false);
  return out;
}

const PLANS = {
  'a season\'s player lines': `select * from public.player_season_stats where competition_id = '${FX['cp/open']}'`,
  'a player\'s season lines': `select * from public.player_season_stats where player_id = '${FX['pl/open/h0']}'`,
  'a season\'s club totals': `select * from public.team_season_stats where competition_id = '${FX['cp/open']}'`,
  'one game\'s events': `select count(*) from public.game_events where game_id = '${FX['g/open/final']}'`,
  'one game\'s box score': `select * from public.player_game_stats where game_id = '${FX['g/open/final']}'`,
  'every public game': `select id from public.game_rows_public`,
  'a season\'s record lines': `select * from public.record_lines where competition_id = '${FX['cp/open']}'`,
};
async function plans() {
  const out = {};
  for (const [k, sql] of Object.entries(PLANS)) out[k] = await as('anon', async () => (await q('explain (costs off) ' + sql)).map(r => r['QUERY PLAN']).join('\n'));
  return out;
}
async function timings(n = 25) {
  const out = {};
  for (const [k, sql] of Object.entries(PLANS)) {
    out[k] = await as('anon', async () => { await q(sql); const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); await q(sql); ts.push(performance.now() - t); }
      ts.sort((a, b) => a - b); return ts[Math.floor(n / 2)]; });
  }
  return out;
}
/* 0151's shape: the policy's COALESCE((SubPlan n), false), that SubPlan one primary-key probe of games; never the view
   hashed once a statement (every public game enumerated: `= ANY (... (hashed SubPlan n)` on game_id) or a scan of games */
const fastPathPlan = p => /COALESCE\(\(SubPlan \d+\), false\) OR can_read_game_rows\(game_id\)/.test(p) &&
  /Index (Only )?Scan using games_pkey on games g/.test(p) && !/Seq Scan on games/.test(p) && !/game_id = \(hashed SubPlan/.test(p);

/* ---- 0218 refuses to move a query a later file changed, and changes nothing ---- */
console.log('\n' + F + ' refuses to move a query that is no longer the one it copies');
{
  const orig = (await q(`select pg_get_viewdef('public.team_season_stats'::regclass) d`))[0].d;
  await db.exec(`create or replace view public.team_season_stats as ${orig.replace(/;\s*$/, '').replace('round(avg(poss), 1) AS poss', 'round(avg(poss), 2) AS poss')}`);
  let err = '';
  try { await applyMigration(db, F); } catch (e) { err = e.message; }
  ok('it raises, naming the view', /public\.team_season_stats is no longer the query this file copies/.test(err), err);
  const left = (await q(`select to_regnamespace('private') is null as no_schema,
                                 (select count(*) from pg_policies where qual like '%private.game_rows_public%')::int as moved,
                                 (select count(*) from pg_policies where tablename = 'team_staff' and policyname = 'team_staff_active_read')::int as staff_pol`))[0];
  ok('...and nothing is left changed (no schema, no policy moved, no staff policy)', left.no_schema && left.moved === 0 && left.staff_pol === 0, left);
  await db.exec(`create or replace view public.team_season_stats as ${orig.replace(/;\s*$/, '')}`);
  await db.exec(`alter view public.team_season_stats owner to postgres`);
}

console.log('\nbefore ' + F + ': every reader, memberships off and on');
const before = await snapshot();
const plansBefore = await plans();
const timeBefore = await timings();
ok('the readers read something (anon sees public season lines; the private admin sees the private league\'s)',
   JSON.parse(before['off/anon/player_season_stats']).length > 0 &&
   JSON.parse(before['off/private_admin/player_season_stats']).length > JSON.parse(before['off/anon/player_season_stats']).length);
ok('...and a withheld minor\'s name is masked for anon, shown to his club\'s manager',
   JSON.parse(before['off/anon/player_season_stats']).some(r => r.player_id === FX['pl/open/h1'] && r.first_name === null) &&
   JSON.parse(before['off/manager/player_season_stats']).some(r => r.player_id === FX['pl/open/h1'] && r.first_name === 'P1'));

const lint = async () => q(`
  select n.nspname || '.' || c.relname as view
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname in ('public', 'graphql_public')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
     and not (lower(coalesce(c.reloptions::text, '{}'))::text[]
              && array['security_invoker=1', 'security_invoker=true', 'security_invoker=yes', 'security_invoker=on'])
   order by 1`);
ok('lint 0010 before: the four views the advisor named', JSON.stringify((await lint()).map(r => r.view)) ===
   JSON.stringify(['public.game_rows_public', 'public.player_season_stats', 'public.team_season_stats', 'public.team_staff_public']), await lint());

console.log('\n' + F + ' applied');
let applyErr = '';
const T1 = performance.now();
try { await applyMigration(db, F); } catch (e) { applyErr = e.message; }
ok('it applies, self-test and all (' + (performance.now() - T1).toFixed(0) + ' ms)', !applyErr, applyErr);
let again = '';
try { await applyMigration(db, F); } catch (e) { again = e.message; }
ok('...and applies again, unchanged (a push stopped half way is pushed again)', !again, again);

ok('lint 0010 after: no view the API roles can read runs with its owner\'s rights', (await lint()).length === 0, await lint());
const rel = await q(`select n.nspname || '.' || c.relname as v, c.reloptions::text as o, pg_get_userbyid(c.relowner) as owner
                       from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where c.relname in ('player_season_stats', 'team_season_stats', 'team_staff_public', 'game_rows_public') order by 1`);
ok('the three owner-rights queries live in private, owned by the tables\' owner; the public names are invoker views',
   JSON.stringify(rel.map(r => [r.v, /security_invoker=true/.test(r.o || ''), r.owner])) === JSON.stringify([
     ['private.game_rows_public', false, 'postgres'], ['private.player_season_stats', false, 'postgres'], ['private.team_season_stats', false, 'postgres'],
     ['public.game_rows_public', true, 'postgres'], ['public.player_season_stats', true, 'postgres'], ['public.team_season_stats', true, 'postgres'],
     ['public.team_staff_public', true, 'postgres']]), rel);
const exposedPriv = await q(`select c.relname, has_table_privilege('anon', c.oid, 'insert') i, has_table_privilege('anon', c.oid, 'update') u
                               from pg_class c where c.relnamespace = 'private'::regnamespace`);
ok('private holds those three and nothing else, SELECT only', exposedPriv.length === 3 && exposedPriv.every(r => !r.i && !r.u), exposedPriv);

console.log('\nafter ' + F + ': the same readers, the same reads');
const after = await snapshot();
const diffs = Object.keys(before).filter(k => before[k] !== after[k]);
ok(`every reader sees exactly what they saw (${Object.keys(before).length} reads: 12 readers x 11 reads x memberships off and on)`, diffs.length === 0,
   diffs.slice(0, 6).map(k => k + '\n            before ' + before[k].slice(0, 300) + '\n            after  ' + after[k].slice(0, 300)).join('\n          '));
ok('...and no read errored, before or after', !Object.values(before).concat(Object.values(after)).some(v => v.startsWith('ERROR')),
   Object.entries(after).filter(([, v]) => v.startsWith('ERROR')).slice(0, 4));

/* team_staff is now readable straight off the table, as the view showed it: active rows, no created_at */
{
  const raw = await as('anon', () => q(`select id, team_id, name, role, born_year, sort, active from public.team_staff order by id`));
  const view = JSON.parse(after['off/anon/team_staff_public']);
  ok('signed out, team_staff itself shows the view\'s rows (the active ones) and its columns, born_year for the age',
     raw.length === view.length && raw.every(r => r.active) && raw.every(r => { const v = view.find(x => x.id === r.id);
       return v && v.name === r.name && v.role === r.role && v.sort === r.sort && v.age === (r.born_year == null ? null : new Date().getUTCFullYear() - r.born_year); }));
  let refused = '';
  try { await as('anon', () => q(`select created_at from public.team_staff limit 1`)); } catch (e) { refused = e.message; }
  ok('...and not created_at', /permission denied/.test(refused), refused);
  let star = '';
  try { await as('fan', () => q(`select * from public.team_staff limit 1`)); } catch (e) { star = e.message; }
  ok('...nor select=* for a fan', /permission denied/.test(star), star);
  const mgr = await as('manager', () => q(`select id, name, role, born_year, sort, active from public.team_staff where team_id = $1 order by id`, [FX['th/open']]));
  ok('a club manager still reads every row of his club, the retired one too (the page edits them)', mgr.length === 3 && mgr.some(r => !r.active), mgr);
  const upd = await as('manager', async () => { await q(`update public.team_staff set role = 'Head Coach' where id = $1`, [mgr[0].id]); return q(`insert into public.team_staff (team_id, name, role) values ($1, 'New', 'Scout') returning id`, [FX['th/open']]); });
  ok('...and still adds and edits them (insert ... returning id, as team.js does)', upd.length === 1);
  let fanWrite = '';
  try { await as('fan', () => q(`update public.team_staff set name = 'x' where team_id = $1 returning id`, [FX['th/open']])).then(r => { if (r.length) fanWrite = 'updated ' + r.length; }); } catch (e) { fanWrite = ''; }
  ok('...while a fan still changes nothing', fanWrite === '', fanWrite);
}

console.log('\nthe plans and the speed');
const plansAfter = await plans();
const timeAfter = await timings();
for (const k of Object.keys(PLANS)) {
  ok(`${k}: the same plan after as before`, plansBefore[k] === plansAfter[k], '\nBEFORE\n' + plansBefore[k] + '\nAFTER\n' + plansAfter[k]);
}
for (const k of ['one game\'s events', 'one game\'s box score', 'a season\'s record lines']) {
  ok(`${k}: 0151's fast path, a primary-key probe of games through a scalar sub-select (no hashed scan of every game)`, fastPathPlan(plansAfter[k]), plansAfter[k]);
}
for (const k of Object.keys(PLANS)) {
  const b = timeBefore[k], a = timeAfter[k];
  console.log(`        ${k.padEnd(28)} median ${b.toFixed(2)} ms before, ${a.toFixed(2)} ms after (signed out, PGlite)`);
  ok(`${k}: no slower (within noise: ${a.toFixed(2)} ms vs ${b.toFixed(2)} ms)`, a <= b * 1.5 + 0.5);
}
/* the same query with and without the public layer, interleaved (what 0217 read is what private now holds) */
for (const [k, pub] of [['a season\'s player lines', 'public.player_season_stats'], ['a season\'s club totals', 'public.team_season_stats']]) {
  const sql = PLANS[k], priv = sql.replace(pub, pub.replace('public.', 'private.'));
  const r = await as('anon', async () => { const a = [], b = [];
    for (let i = 0; i < 60; i++) { let t = performance.now(); await q(priv); a.push(performance.now() - t); t = performance.now(); await q(sql); b.push(performance.now() - t); }
    a.sort((x, y) => x - y); b.sort((x, y) => x - y); return { direct: a[30], wrapped: b[30] }; });
  console.log(`        ${k.padEnd(28)} interleaved medians: the owner-rights query read directly ${r.direct.toFixed(2)} ms, through the public invoker view ${r.wrapped.toFixed(2)} ms`);
  ok(`${k}: the public layer costs nothing measurable`, r.wrapped <= r.direct * 1.25 + 0.3, r);
}
{
  const sp = await as('anon', async () => (await q(`explain (costs off) select * from public.team_staff_public where team_id = '${FX['th/open']}'`)).map(r => r['QUERY PLAN']).join('\n'));
  ok('team_staff_public reads one club\'s rows (no function a row signed out)', !/is_team_manager/.test(sp), sp);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
