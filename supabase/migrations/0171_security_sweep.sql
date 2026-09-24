-- ============================================================================
-- 0171 — WHAT A SIGNED-IN STRANGER, OR ONE CLUB'S MANAGER, COULD REACH.
--
-- The 2026-09-24 security sweep read every policy and every SECURITY DEFINER
-- function as three visitors: signed out, signed in with no roles, and signed
-- in as one club's manager. Nothing below had been used (checked the same day:
-- no minors are flagged yet, no ad-hoc game was created by anybody but the
-- platform's own server, no league-wide club notice and no officials register
-- exist), so every one of these was a gap waiting for its first user.
--
--  1. CHILDREN'S NAMES. player_season_stats is an owner-rights view (0118), so
--     players' RLS never reaches it, and it printed first_name, last_name and
--     slug for every player, a withheld minor included. The names now come
--     back only to somebody players_read would show the row to.
--     games.roster_snapshot is a public column on every final game, and it is
--     written with the names the scorer sees. A withheld player is now stored
--     as "#<shirt>", the convention the notifications already use (0121).
--
--  2. FAKE RESULTS, AND OTHER PEOPLE'S EMAILS. games_create (0007) let any
--     account insert an ad-hoc game: any two clubs, any status, any score, so a
--     "final" appeared on real clubs' pages. Its creator then administered it
--     (can_manage_game), could add ANY account as its official, and
--     game_officials_list returned that account's email. Now a game is created
--     only by the administrators of its competition (or the platform), only as
--     a fixture, and an official's email is shown only to whoever assigned
--     them by that email (or to themselves, or the platform).
--
--  3. ANY PLAYER ONTO YOUR ROSTER. roster_write only asked whether you manage
--     the TEAM, so a club manager could attach a player from any league, and
--     players_write then let them rename, delete or re-consent that player.
--     Attaching a player now needs every club they are rostered at to be one
--     you manage (a new player has none), or the platform.
--
--  4. SMALLER THINGS, each named where it is fixed: the officials register and
--     licence numbers (0078), federation eligibility (0077), league-wide club
--     notices (0106), guardians' names on players (0049), whose GO photo is
--     whose (0167), the ingest schedule (0094), media rows arriving already
--     approved (0001), and a club seeing a sender's IP address (0038).
--
-- EVERY STATEMENT IS IDEMPOTENT: `db push` is not transactional (see
-- migration-lint.test.mjs), so a push stopped half way is finished by pushing
-- again.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1a. WHO MAY SEE A WITHHELD PLAYER: players_read (0049), as a function the
-- owner-rights views can ask. Signed out, never.
-- ----------------------------------------------------------------------------
create or replace function public.may_see_withheld_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select auth.uid()) is not null
     and ( public.is_platform_admin()
           or exists (select 1 from roster_entries re
                       where re.player_id = p_player
                         and public.is_team_manager(re.team_id)) );
$$;
revoke all on function public.may_see_withheld_player(uuid) from public;
grant execute on function public.may_see_withheld_player(uuid) to anon, authenticated, service_role;
alter function public.may_see_withheld_player(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 1b. player_season_stats (latest: 0147), with the three identifying columns
-- masked for a withheld player. Same columns, same order, so CREATE OR REPLACE
-- keeps the grants. The lateral is a CASE so may_see_withheld_player is only
-- asked about a withheld player, and never at all while none is flagged.
-- ----------------------------------------------------------------------------
create or replace view public.player_season_stats as
with vis as materialized (
  select l.id, (l.access_mode = 'open' or not (select public.memberships_enabled())
                or public.can_view_league(l.id))
               and coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)   -- 0147
               as ok
    from leagues l
),
base as (
  select
    g.competition_id,
    c.season_id,
    pgs.player_uuid as player_id,
    pgs.team_idx,
    case when pgs.team_idx = 0 then g.home_team_id else g.away_team_id end as team_id,
    (pgs.stats->>'min')::numeric   as min_ms,
    (pgs.stats->>'pts')::int       as pts,
    (pgs.stats->>'p2m')::int       as p2m,  (pgs.stats->>'p2a')::int as p2a,
    (pgs.stats->>'p3m')::int       as p3m,  (pgs.stats->>'p3a')::int as p3a,
    (pgs.stats->>'ftm')::int       as ftm,  (pgs.stats->>'fta')::int as fta,
    (pgs.stats->>'or')::int        as oreb, (pgs.stats->>'dr')::int  as dreb,
    (pgs.stats->>'ast')::int       as ast,  (pgs.stats->>'stl')::int as stl,
    (pgs.stats->>'blk')::int       as blk,  (pgs.stats->>'to')::int  as tov,
    (pgs.stats->>'pf')::int        as pf,   (pgs.stats->>'fd')::int  as fd,
    (pgs.stats->>'pm')::int        as pm,
    (pgs.stats->>'rimA')::int      as rim_a, (pgs.stats->>'rimM')::int as rim_m,
    (pgs.stats->>'midA')::int      as mid_a, (pgs.stats->>'midM')::int as mid_m
  from player_game_stats pgs
  join games g on g.id = pgs.game_id and g.status = 'final'
  left join competitions c on c.id = g.competition_id
  left join seasons s      on s.id = c.season_id
  left join vis            on vis.id = s.league_id
  where pgs.player_uuid is not null
    -- 0118: a members-only league's games count only for those who may see them
    and coalesce(vis.ok, true)
),
agg as (
  select
    season_id, competition_id, player_id, team_id,
    count(*)::int                 as gp,
    round(sum(min_ms)/60000.0, 1) as min,
    sum(pts) as pts, sum(ast) as ast, sum(stl) as stl, sum(blk) as blk,
    sum(tov) as tov, sum(pf) as pf, sum(fd) as fd, sum(pm) as pm,
    sum(oreb) as oreb, sum(dreb) as dreb, (sum(oreb) + sum(dreb)) as reb,
    sum(p2m) as p2m, sum(p2a) as p2a, sum(p3m) as p3m, sum(p3a) as p3a,
    sum(ftm) as ftm, sum(fta) as fta,
    (sum(p2m) + sum(p3m)) as fgm, (sum(p2a) + sum(p3a)) as fga,
    sum(rim_a) as rim_a, sum(rim_m) as rim_m, sum(mid_a) as mid_a, sum(mid_m) as mid_m,
    round(sum(pts)::numeric / nullif(count(*),0), 1)                     as ppg,
    round((sum(oreb)+sum(dreb))::numeric / nullif(count(*),0), 1)        as rpg,
    round(sum(ast)::numeric / nullif(count(*),0), 1)                     as apg,
    round(100 * (sum(p2m)+sum(p3m) + 0.5*sum(p3m))::numeric
          / nullif(sum(p2a)+sum(p3a),0), 1)                              as efg,
    round(100 * sum(pts)::numeric
          / nullif(2*((sum(p2a)+sum(p3a)) + 0.44*sum(fta)),0), 1)        as ts,
    round(100 * sum(p3m)::numeric / nullif(sum(p3a),0), 1)               as p3_pct,
    round(100 * sum(ftm)::numeric / nullif(sum(fta),0), 1)               as ft_pct,
    round(100 * sum(rim_m)::numeric / nullif(sum(rim_a),0), 1)           as rim_pct,
    round(sum(ast)::numeric / nullif(sum(tov),0), 2)                     as ast_to
  from base
  group by season_id, competition_id, player_id, team_id
)
select
  a.*,
  case when w.hide then null else p.first_name end as first_name,          -- 0171
  case when w.hide then null else p.last_name end as last_name,            -- 0171
  case when w.hide then null else p.slug end as player_slug,               -- 0171
  p.is_minor,
  t.name as team_name, t.short_name as team_short, t.slug as team_slug, t.colour as team_colour,
  re.jersey
from agg a
left join players p on p.id = a.player_id
left join lateral (                                                         -- 0171
  select case when public.player_withheld(p.is_minor, p.public_consent)     -- 0171
              then not public.may_see_withheld_player(a.player_id)          -- 0171
              else false end as hide                                        -- 0171
) w on true                                                                 -- 0171
left join teams   t on t.id = a.team_id
left join lateral (
  select r.jersey from roster_entries r
   where r.player_id = a.player_id and r.team_id = a.team_id
   order by r.created_at desc limit 1
) re on true;

alter view public.player_season_stats owner to postgres;

-- ----------------------------------------------------------------------------
-- 1c. games.roster_snapshot: a withheld player is stored as "#<shirt>".
--
-- Masked when the snapshot is WRITTEN, whoever writes it (the scorer, the
-- console importer, the ingest worker), because every public page reads the
-- column straight off the games row: the game page, the embed, the broadcast
-- screens and live.js. The id stays, so the event log still resolves to a
-- shirt number. The scorer shows "#7" for that player after a reload, which
-- is also what the scoresheet says.
--
-- And when a player BECOMES withheld (flagged a minor, or consent withdrawn),
-- the games they are already in are masked too.
-- ----------------------------------------------------------------------------
create or replace function public.mask_withheld_snapshot(p_snap jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hidden text[];
begin
  if p_snap is null or jsonb_typeof(p_snap -> 'teams') is distinct from 'array' then
    return p_snap;
  end if;

  select array_agg(p.id::text) into hidden
    from players p
   where public.player_withheld(p.is_minor, p.public_consent)
     and p.id = any (array(
           select (x ->> 'id')::uuid
             from jsonb_array_elements(p_snap -> 'teams') tm,
                  jsonb_array_elements(case when jsonb_typeof(tm -> 'players') = 'array'
                                            then tm -> 'players' else '[]'::jsonb end) x
            where (x ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
  if hidden is null then
    return p_snap;
  end if;

  return jsonb_set(p_snap, '{teams}', (
    select coalesce(jsonb_agg(
             case when jsonb_typeof(tm -> 'players') = 'array' then
               jsonb_set(tm, '{players}', (
                 select coalesce(jsonb_agg(
                          case when x ->> 'id' = any (hidden)
                               then x || jsonb_build_object('name', '#' || coalesce(nullif(x ->> 'num', ''), '?'))
                               else x end
                          order by i), '[]'::jsonb)
                   from jsonb_array_elements(tm -> 'players') with ordinality as px(x, i)))
             else tm end
             order by ti), '[]'::jsonb)
      from jsonb_array_elements(p_snap -> 'teams') with ordinality as tx(tm, ti)));
end $$;
revoke all on function public.mask_withheld_snapshot(jsonb) from public, anon, authenticated;
alter function public.mask_withheld_snapshot(jsonb) owner to postgres;

create or replace function public.games_mask_withheld()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.roster_snapshot is not distinct from old.roster_snapshot then
    return new;
  end if;
  new.roster_snapshot := public.mask_withheld_snapshot(new.roster_snapshot);
  return new;
end $$;
revoke all on function public.games_mask_withheld() from public, anon, authenticated;
alter function public.games_mask_withheld() owner to postgres;

drop trigger if exists games_mask_withheld on public.games;
create trigger games_mask_withheld before insert or update of roster_snapshot on public.games
  for each row execute function public.games_mask_withheld();

create or replace function public.players_mask_snapshots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update games g set roster_snapshot = public.mask_withheld_snapshot(g.roster_snapshot)
   where g.roster_snapshot is not null
     and g.roster_snapshot::text like '%' || new.id::text || '%';
  return new;
end $$;
revoke all on function public.players_mask_snapshots() from public, anon, authenticated;
alter function public.players_mask_snapshots() owner to postgres;

drop trigger if exists players_mask_snapshots on public.players;
create trigger players_mask_snapshots after update of is_minor, public_consent on public.players
  for each row
  when (public.player_withheld(new.is_minor, new.public_consent)
        and not public.player_withheld(old.is_minor, old.public_consent))
  execute function public.players_mask_snapshots();

-- any snapshot already holding a withheld player's name
do $$
declare n int;
begin
  if exists (select 1 from players where public.player_withheld(is_minor, public_consent)) then
    update games g set roster_snapshot = public.mask_withheld_snapshot(g.roster_snapshot)
     where g.roster_snapshot is not null
       and public.mask_withheld_snapshot(g.roster_snapshot) is distinct from g.roster_snapshot;
    get diagnostics n = row_count;
    raise notice '0171: % roster snapshot(s) named a withheld player, now masked', n;
  else
    raise notice '0171: no withheld players, so no roster snapshot to mask';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2a. A GAME IS CREATED BY ITS COMPETITION'S ADMINISTRATORS, AS A FIXTURE.
--
-- games_create (0007) kept ad-hoc games open to every account, "what the
-- scorer creates". Nothing creates them now: the only inserts in the clients
-- are the league console's fixture forms (admin.js, fixtures-ui.js), both into
-- a competition, both scheduled. Taking a game out of its competition is a
-- platform administrator's move already (0116). So the insert policy asks for
-- the competition's administrator, and a trigger that judges only the API
-- roles (0116's reasoning: SECURITY DEFINER functions and the service role
-- are not 'authenticated') refuses a new row that claims to be anything but a
-- fixture.
-- ----------------------------------------------------------------------------
drop policy if exists games_create on public.games;
create policy games_create on public.games for insert with check (
  public.is_platform_admin()
  or (competition_id is not null and public.is_competition_admin(competition_id))
);

create or replace function public.games_insert_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status is distinct from 'scheduled' then
    raise exception 'a game is created as a fixture: it goes live in the scorer and becomes a result through finalise-game'
      using errcode = '42501';
  end if;
  if coalesce(new.home_score, 0) <> 0 or coalesce(new.away_score, 0) <> 0
     or new.finalised_at is not null or new.finalised_by is not null then
    raise exception 'a new fixture has no score and is not finalised'
      using errcode = '42501';
  end if;
  return new;
end $$;
alter function public.games_insert_guard() owner to postgres;

drop trigger if exists games_insert_guard on public.games;
create trigger games_insert_guard before insert on public.games
  for each row execute function public.games_insert_guard();

-- ----------------------------------------------------------------------------
-- 2b. AN OFFICIAL'S EMAIL, ONLY TO WHOEVER ALREADY KNEW IT.
--
-- assign_official takes an email and writes it to the audit log; officials
-- added any other way (a direct insert, which officials_write allows the game's
-- administrators) were never typed by anybody, so their address is not the
-- administrator's to read. They are shown by username.
-- ----------------------------------------------------------------------------
create index if not exists audit_log_assign_official
  on public.audit_log (subject_id) where action = 'assign_official';

create or replace function public.game_officials_list(p_game uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public, auth as $$
  select go.user_id,
         case when public.is_platform_admin()
                   or go.user_id = auth.uid()
                   or exists (select 1 from audit_log a
                               where a.action = 'assign_official'
                                 and a.subject = 'game' and a.subject_id = p_game::text
                                 and lower(btrim(a.detail ->> 'email')) = lower(u.email::text))
              then u.email::text
              else coalesce('@' || un.username, 'an account with no username yet') end,
         go.role
    from game_officials go
    join auth.users u on u.id = go.user_id
    left join usernames un on un.user_id = go.user_id
   where go.game_id = p_game and public.can_manage_game(p_game)
   order by 2;
$$;
revoke all on function public.game_officials_list(uuid) from public, anon;
grant execute on function public.game_officials_list(uuid) to authenticated;
alter function public.game_officials_list(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 3. ATTACHING A PLAYER TO A ROSTER.
--
-- The clients only ever roster a player they have just created (app.js,
-- roster-csv.js), who is rostered nowhere. So: every club the player is
-- rostered at already must be one the caller manages. A league's
-- administrator manages every club in the league (is_team_manager), so moving
-- a player between two of their clubs still works; bringing one in from
-- another league is the platform's call. Changing a row's jersey or active flag
-- is unaffected, and a row cannot be repointed at a different player.
-- ----------------------------------------------------------------------------
create or replace function public.may_roster_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or not exists (select 1 from roster_entries re
                      where re.player_id = p_player
                        and not public.is_team_manager(re.team_id));
$$;
revoke all on function public.may_roster_player(uuid) from public, anon;
grant execute on function public.may_roster_player(uuid) to authenticated, service_role;
alter function public.may_roster_player(uuid) owner to postgres;

drop policy if exists roster_write on public.roster_entries;
drop policy if exists roster_insert on public.roster_entries;
create policy roster_insert on public.roster_entries for insert
  with check (public.is_team_manager(team_id) and public.may_roster_player(player_id));
drop policy if exists roster_update on public.roster_entries;
create policy roster_update on public.roster_entries for update
  using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));
drop policy if exists roster_delete on public.roster_entries;
create policy roster_delete on public.roster_entries for delete
  using (public.is_team_manager(team_id));

create or replace function public.roster_entries_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.player_id is distinct from old.player_id then
    raise exception 'a roster entry is not moved to another player: add the player instead'
      using errcode = '42501';
  end if;
  return new;
end $$;
alter function public.roster_entries_guard() owner to postgres;

drop trigger if exists roster_entries_guard on public.roster_entries;
create trigger roster_entries_guard before update on public.roster_entries
  for each row execute function public.roster_entries_guard();

-- ----------------------------------------------------------------------------
-- 4a. THE OFFICIALS REGISTER (0078). Its read was "any signed-in user", which
-- also meant every licence number and every private note to any account. The
-- console tab that edits it is the league's own; the scorer reads it through
-- officials_for_game, which was executable signed out and now answers only to
-- somebody who may score or run the game.
-- ----------------------------------------------------------------------------
drop policy if exists league_officials_read on public.league_officials;
create policy league_officials_read on public.league_officials for select
  using (public.is_platform_admin() or public.is_league_admin(league_id));

create or replace function public.officials_for_game(p_game uuid)
returns table (id uuid, name text, roles text[], licence text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.roles, o.licence
  from public.games g
  join public.competitions c on c.id = g.competition_id
  join public.seasons s      on s.id = c.season_id
  join public.league_officials o on o.league_id = s.league_id
  where g.id = p_game and o.active
    and public.game_visible(p_game)                                       -- 0118
    and (public.may_score_game(p_game) or public.can_manage_game(p_game)) -- 0171
  order by o.name;
$$;
revoke all on function public.officials_for_game(uuid) from public, anon;
grant execute on function public.officials_for_game(uuid) to authenticated, service_role;
alter function public.officials_for_game(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 4b. FEDERATION ELIGIBILITY (0077) answered any account about any player,
-- reasons included. No page asks it; the sync runner holds the service role.
-- ----------------------------------------------------------------------------
revoke all on function public.membership_status(uuid, date) from public, anon, authenticated;
grant execute on function public.membership_status(uuid, date) to service_role;

-- ----------------------------------------------------------------------------
-- 4c. A LEAGUE'S NOTICE TO ALL ITS CLUBS (0106: audience club_admins, no team)
-- was readable by everybody, signed out included. Now: the managers of that
-- league's clubs, and its administrators.
-- ----------------------------------------------------------------------------
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select using (
  (audience in ('fans', 'all') and team_id is null)
  or (audience in ('club_admins', 'all') and team_id is not null and public.is_team_manager(team_id))
  or (audience = 'club_admins' and team_id is null
      and exists (select 1 from memberships m
                    join teams t on t.id = m.scope_id
                   where m.user_id = auth.uid() and m.role = 'team_manager'
                     and m.scope_type = 'team' and t.league_id = announcements.league_id))
  or public.is_league_admin(league_id) or public.is_platform_admin()
);

-- ----------------------------------------------------------------------------
-- 4d. A GUARDIAN'S NAME (players.consent_guardian, 0049) and the account that
-- recorded consent (consent_by) were public columns. Column privileges cannot
-- be narrowed under a table-wide grant, so the table-wide SELECT goes and every
-- other column is granted by name. The staff screens read both through
-- portal_club and league_players, which are SECURITY DEFINER.
--
-- A COLUMN ADDED TO players LATER MUST BE GRANTED TOO, or a page selecting it
-- is refused (fail-closed). supabase/tests/security-sweep.test.mjs checks
-- every later migration that adds one.
-- ----------------------------------------------------------------------------
do $$
declare cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = 'public.players'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('consent_guardian', 'consent_by');
  revoke select on public.players from anon, authenticated;
  execute format('grant select (%s) on public.players to anon, authenticated', cols);
end $$;

-- ----------------------------------------------------------------------------
-- 4e. WHOSE GO PHOTO IS WHOSE. An approved photo's row carried its user_id to
-- anyone. Every page reads photos through go_photos_feed / go_photo /
-- go_my_photos, which are SECURITY DEFINER and name the author by username.
-- ----------------------------------------------------------------------------
drop policy if exists go_photos_read on public.go_photos;
create policy go_photos_read on public.go_photos for select
  using (user_id = auth.uid() or public.is_platform_admin());

-- ----------------------------------------------------------------------------
-- 4f. THE INGEST SCHEDULE (0094) kept PUBLIC's default EXECUTE, so it listed
-- every schedule source, its URL and its config to anyone. The worker holds
-- the service role.
-- ----------------------------------------------------------------------------
revoke all on function public.due_schedule_sources() from public, anon, authenticated;
grant execute on function public.due_schedule_sources() to service_role;

-- ----------------------------------------------------------------------------
-- 4g. A MEDIA ROW ARRIVES PENDING, FOR SOMETHING YOU MAY UPLOAD FOR (0001 let
-- any account insert one already 'approved', about anybody). The same test
-- storage applies to the file (may_upload_media, 0017), on the same path, and
-- the owner the row names must be the owner the path names. uploaded_by is
-- stamped, as games.created_by is.
-- ----------------------------------------------------------------------------
drop policy if exists media_insert on public.media;
create policy media_insert on public.media for insert with check (
  status = 'pending'
  and owner_type = split_part(storage_path, '/', 1)
  and owner_id::text = split_part(storage_path, '/', 2)
  and (public.may_upload_media(storage_path) or public.is_platform_admin())
);

create or replace function public.stamp_uploaded_by()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.uploaded_by := auth.uid();
  end if;
  return new;
end $$;
alter function public.stamp_uploaded_by() owner to postgres;

drop trigger if exists media_stamp_uploader on public.media;
create trigger media_stamp_uploader before insert on public.media
  for each row execute function public.stamp_uploaded_by();

-- ----------------------------------------------------------------------------
-- 4h. A CLUB READS ITS MESSAGES WITHOUT THE SENDER'S IP ADDRESS OR BROWSER
-- (0038). The platform console reads through its own SECURITY DEFINER function.
-- ----------------------------------------------------------------------------
do $$
declare cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = 'public.contact_messages'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('source_ip', 'user_agent');
  revoke select on public.contact_messages from anon, authenticated;
  execute format('grant select (%s) on public.contact_messages to authenticated', cols);
end $$;

-- ============================================================================
-- SELF-TEST. Asserts only about the leagues, clubs, players and accounts it
-- creates itself, and rolls all of them back.
-- ============================================================================
do $test$
declare
  orig text := current_user;
  lg uuid; lg2 uuid; sn uuid; cp uuid; ta uuid; tb uuid; tc uuid;
  mgr uuid; stranger uuid; ladmin uuid; offi uuid; offi2 uuid;
  kid uuid; adult uuid; far uuid; fresh uuid; gf uuid; gs uuid;
  n int; v text; snap jsonb;
begin
  begin
    perform set_config('request.jwt.claims', '', true);

    insert into leagues (slug, name) values ('zz-t171-lg', 'T171 League') returning id into lg;
    insert into leagues (slug, name) values ('zz-t171-lg2', 'T171 Other League') returning id into lg2;
    insert into seasons (league_id, name) values (lg, '0171') returning id into sn;
    insert into competitions (season_id, name) values (sn, 'T171 League') returning id into cp;
    insert into teams (league_id, slug, name) values (lg, 'zz-t171-a', 'T171 A') returning id into ta;
    insert into teams (league_id, slug, name) values (lg, 'zz-t171-c', 'T171 C') returning id into tc;
    insert into teams (league_id, slug, name) values (lg2, 'zz-t171-b', 'T171 B') returning id into tb;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            't0171-mgr@example.invalid', '', now(), now(), now()) returning id into mgr;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            't0171-stranger@example.invalid', '', now(), now(), now()) returning id into stranger;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            't0171-ladmin@example.invalid', '', now(), now(), now()) returning id into ladmin;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            't0171-offi@example.invalid', '', now(), now(), now()) returning id into offi;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            't0171-offi2@example.invalid', '', now(), now(), now()) returning id into offi2;
    insert into memberships (user_id, role, scope_type, scope_id)
    values (mgr, 'team_manager', 'team', ta), (ladmin, 'league_admin', 'league', lg);

    insert into players (slug, first_name, last_name, is_minor) values ('zz-t171-kid', 'T171', 'Kid', true)
      returning id into kid;
    insert into players (slug, first_name, last_name) values ('zz-t171-adult', 'T171', 'Adult')
      returning id into adult;
    insert into players (slug, first_name, last_name) values ('zz-t171-far', 'T171', 'Far')
      returning id into far;
    insert into roster_entries (team_id, player_id, season_id, jersey, active)
    values (ta, kid, sn, '7', true), (ta, adult, sn, '8', true), (tb, far, sn, '9', true);

    -- a final game with the kid's line in it (created live, finished as the owner)
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
    values (cp, ta, tc, now() - interval '2 days', 'live', 40, 30) returning id into gf;
    insert into player_game_stats (game_id, player_id, team_idx, stats)
    values (gf, kid::text, 0, '{"min":600000,"pts":5,"p2m":1,"p2a":2,"p3m":1,"p3a":1}'::jsonb);
    update games set status = 'final' where id = gf;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
    values (cp, ta, tc, now() + interval '1 day', 'scheduled') returning id into gs;

    -- ---- 1b. the season view names the kid to their club, and to nobody else
    set local role anon;
    select first_name into v from public.player_season_stats where player_id = kid and competition_id = cp;
    if v is not null then raise exception '0171: the season view named a withheld player signed out (%)', v; end if;
    execute format('set local role %I', orig);

    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    select first_name into v from public.player_season_stats where player_id = kid and competition_id = cp;
    if v is not null then raise exception '0171: the season view named a withheld player to a stranger'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    select first_name into v from public.player_season_stats where player_id = kid and competition_id = cp;
    if v is distinct from 'T171' then raise exception '0171: the season view hid a withheld player from their own club (%)', v; end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);

    -- ---- 1c. the snapshot stores the kid as a shirt number
    update games set roster_snapshot = jsonb_build_object('teams', jsonb_build_array(
             jsonb_build_object('name', 't171 a', 'players', jsonb_build_array(
               jsonb_build_object('id', kid::text, 'name', 't171 kid', 'num', '7'),
               jsonb_build_object('id', adult::text, 'name', 't171 adult', 'num', '8')))))
     where id = gs;
    select roster_snapshot into snap from games where id = gs;
    if snap -> 'teams' -> 0 -> 'players' -> 0 ->> 'name' <> '#7' then
      raise exception '0171: the snapshot kept a withheld player''s name (%)', snap;
    end if;
    if snap -> 'teams' -> 0 -> 'players' -> 1 ->> 'name' <> 't171 adult' then
      raise exception '0171: the snapshot masked a player who is not withheld (%)', snap;
    end if;

    -- ---- 2a. games: a stranger creates none, an administrator creates fixtures only
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    begin
      insert into games (home_team_id, away_team_id, status) values (ta, tb, 'scheduled');
      raise exception '0171: a stranger created an ad-hoc game';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into games (competition_id, home_team_id, away_team_id, status) values (cp, ta, tc, 'scheduled');
      raise exception '0171: a stranger created a fixture in somebody else''s league';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', ladmin, 'role', 'authenticated')::text, true);
    begin
      insert into games (competition_id, home_team_id, away_team_id, status, home_score, away_score)
      values (cp, ta, tc, 'final', 80, 70);
      raise exception '0171: an administrator inserted a result with no game behind it';
    exception when insufficient_privilege then null;
    end;
    insert into games (competition_id, home_team_id, away_team_id, status) values (cp, ta, tc, 'scheduled');

    -- ---- 2b. an official added by id shows no email; one assigned by email does
    insert into game_officials (game_id, user_id, role) values (gs, offi, 'statistician');
    v := public.assign_official(gs, 't0171-offi2@example.invalid', 'statistician');
    if exists (select 1 from public.game_officials_list(gs) where email = 't0171-offi@example.invalid') then
      raise exception '0171: game_officials_list gave away the email of an official nobody typed';
    end if;
    if not exists (select 1 from public.game_officials_list(gs) where email = 't0171-offi2@example.invalid') then
      raise exception '0171: game_officials_list hid the email its administrator typed';
    end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);

    -- ---- 3. a club manager rosters new players, not other clubs' players
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    begin
      insert into roster_entries (team_id, player_id, jersey) values (ta, far, '10');
      raise exception '0171: a club manager took another league''s player onto their roster';
    exception when insufficient_privilege then null;
    end;
    insert into players (slug, first_name, last_name, created_by) values ('zz-t171-fresh', 'T171', 'Fresh', mgr)
      returning id into fresh;
    insert into roster_entries (team_id, player_id, jersey) values (ta, fresh, '11');
    update roster_entries set jersey = '12' where team_id = ta and player_id = fresh;
    get diagnostics n = row_count;
    if n <> 1 then raise exception '0171: a club manager could not change their own player''s shirt'; end if;

    -- ---- 4g. a media row arrives pending, for your own club only
    begin
      insert into media (owner_type, owner_id, kind, storage_path, status)
      values ('team', ta, 'logo', 'team/' || ta || '/logo-t171.png', 'approved');
      raise exception '0171: a media row was inserted already approved';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into media (owner_type, owner_id, kind, storage_path, status)
      values ('team', tb, 'logo', 'team/' || tb || '/logo-t171.png', 'pending');
      raise exception '0171: a club manager recorded an upload for another club';
    exception when insufficient_privilege then null;
    end;
    insert into media (owner_type, owner_id, kind, storage_path, status)
    values ('team', ta, 'logo', 'team/' || ta || '/logo-t171.png', 'pending');
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);
    if not exists (select 1 from media where storage_path = 'team/' || ta || '/logo-t171.png' and uploaded_by = mgr) then
      raise exception '0171: the uploader was not stamped on the media row';
    end if;

    -- ---- 4c. a league's notice to its clubs reaches its clubs
    insert into announcements (league_id, title, audience) values (lg, 'T171 notice', 'club_admins');
    set local role anon;
    select count(*) into n from announcements where league_id = lg;
    if n <> 0 then raise exception '0171: a league''s notice to its clubs was readable signed out'; end if;
    execute format('set local role %I', orig);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    select count(*) into n from announcements where league_id = lg;
    if n <> 1 then raise exception '0171: a club in the league could not read its league''s notice'; end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);

    -- ---- 4d. a guardian's name is not a public column; a name still is
    set local role anon;
    begin
      execute 'select consent_guardian from public.players limit 1';
      raise exception '0171: consent_guardian is still readable signed out';
    exception when insufficient_privilege then null;
    end;
    execute 'select first_name, last_name, slug, birth_year from public.players limit 1';
    execute format('set local role %I', orig);

    -- ---- the grants
    if has_function_privilege('anon', 'public.officials_for_game(uuid)', 'execute') then
      raise exception '0171: officials_for_game is still executable signed out';
    end if;
    if has_function_privilege('authenticated', 'public.membership_status(uuid,date)', 'execute')
       or has_function_privilege('anon', 'public.membership_status(uuid,date)', 'execute') then
      raise exception '0171: membership_status is still executable by the API roles';
    end if;
    if has_function_privilege('anon', 'public.due_schedule_sources()', 'execute')
       or has_function_privilege('authenticated', 'public.due_schedule_sources()', 'execute') then
      raise exception '0171: due_schedule_sources is still executable by the API roles';
    end if;
    if has_column_privilege('authenticated', 'public.contact_messages', 'source_ip', 'select') then
      raise exception '0171: a club can still read a sender''s IP address';
    end if;

    raise exception using errcode = 'P0004', message = '0171 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);
  raise notice '0171: self-test passed';
end $test$;
