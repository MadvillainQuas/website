-- ============================================================================
-- 0052 — a league administrator may edit a player's profile too.
--
-- 0049 built set_player_profile() and set_player_previous_clubs() for the club
-- portal and gated them on is_team_manager(), which is correct for a club and
-- excludes the league. So the league console's player editor could change a
-- name (admin_update_player, 0045) and not a height — two editors for one
-- player, disagreeing about which fields exist, which is exactly the split the
-- portal work was meant to close.
--
-- The same rule the rest of the platform uses: a league administrator may do
-- anything a club in their league may do. Nothing is widened for anybody else.
-- ============================================================================

create or replace function public.may_edit_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (
        select 1 from roster_entries re
         where re.player_id = p_player
           and (public.is_team_manager(re.team_id)
                or exists (select 1 from teams t
                            where t.id = re.team_id and t.league_id is not null
                              and public.is_league_admin(t.league_id))));
$$;

create or replace function public.set_player_profile(
  p_player uuid,
  p_height int default null, p_weight int default null, p_wingspan int default null,
  p_previous_club text default null, p_position text default null,
  p_consent boolean default null, p_guardian text default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.may_edit_player(p_player) then
    raise exception 'you neither manage a club this player is registered with nor administer its league'
      using errcode = '42501';
  end if;

  if p_consent is true and coalesce(trim(coalesce(p_guardian, '')), '') = '' then
    raise exception 'record who gave consent before ticking it' using errcode = '22023';
  end if;

  update players set
    height_cm     = case when p_height   = 0 then null else coalesce(p_height,   height_cm) end,
    weight_kg     = case when p_weight   = 0 then null else coalesce(p_weight,   weight_kg) end,
    wingspan_cm   = case when p_wingspan = 0 then null else coalesce(p_wingspan, wingspan_cm) end,
    previous_club = case when p_previous_club = '' then null
                         else coalesce(p_previous_club, previous_club) end,
    public_consent   = coalesce(p_consent, public_consent),
    consent_guardian = case when p_consent is false then null
                            else coalesce(nullif(trim(coalesce(p_guardian, '')), ''),
                                          consent_guardian) end,
    consent_at       = case when p_consent is true then now()
                            when p_consent is false then null
                            else consent_at end,
    consent_by       = case when p_consent is true then auth.uid()
                            when p_consent is false then null
                            else consent_by end
  where id = p_player;

  if p_position is not null then
    /* The position lives on the ROSTER ENTRY, and a league admin is not a
       manager of the club — so the update cannot filter on is_team_manager the
       way 0049's did. It filters on the same right this function checked. */
    update roster_entries set position = nullif(trim(p_position), '')
     where player_id = p_player and active;
  end if;

  return 'saved';
end; $$;

create or replace function public.set_player_previous_clubs(p_player uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; v_name text;
begin
  if not public.may_edit_player(p_player) then
    raise exception 'you neither manage a club this player is registered with nor administer its league'
      using errcode = '42501';
  end if;

  delete from player_previous_clubs where player_id = p_player;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := trim(coalesce(r->>'club', ''));
    continue when v_name = '';
    i := i + 1;
    insert into player_previous_clubs (player_id, club_name, from_year, to_year, sort)
    values (p_player, left(v_name, 80),
            nullif(r->>'from', '')::int, nullif(r->>'to', '')::int, i);
  end loop;

  update players set previous_club = (
    select club_name from player_previous_clubs
     where player_id = p_player order by sort limit 1)
   where id = p_player;

  return i;
end; $$;

-- league_players is what the console's list reads; it never carried the
-- measurements, so the editor had nothing to show even once it could write.
--
-- DROPPED FIRST. `create or replace` cannot widen a function's OUT columns —
-- the row type is part of its identity — so adding nine of them is a drop and
-- a create, and the grants below have to be reapplied because they went with
-- the old function.
drop function if exists public.league_players(uuid, text);
create or replace function public.league_players(p_league uuid, p_search text default '')
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  is_minor boolean, photo_consent boolean,
  team_id uuid, team_name text, jersey text, suspended boolean,
  /* QUOTED. `position` is a reserved word — POSITION(x IN y) is a function in
     the SQL standard — and an unquoted one in a RETURNS TABLE list is a syntax
     error rather than a name clash, which is a better failure than most. The
     quoted identifier keeps the column called `position` for the caller. */
  "position" text, height_cm int, weight_kg int, wingspan_cm int,
  previous_club text, public_consent boolean, consent_guardian text,
  age int, previous_clubs jsonb
) language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(coalesce(trim(p_search), '')) || '%';
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
  select distinct on (p.id, t.id)
         p.id, p.first_name, p.last_name, p.birth_year, p.is_minor, p.photo_consent,
         t.id, t.name, r.jersey,
         exists (select 1 from public.player_ban(p.id) b where b.active),
         r.position, p.height_cm, p.weight_kg, p.wingspan_cm,
         p.previous_club, p.public_consent, p.consent_guardian,
         case when p.birth_year is not null
              then extract(year from current_date)::int - p.birth_year end,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'club', c.club_name, 'from', c.from_year, 'to', c.to_year)
                     order by c.sort)
                     from player_previous_clubs c where c.player_id = p.id), '[]'::jsonb)
    from players p
    join roster_entries r on r.player_id = p.id and r.active
    join teams t on t.id = r.team_id
   where t.league_id = p_league
     and (p_search is null or trim(p_search) = ''
          or lower(p.first_name || ' ' || p.last_name) like q)
   order by p.id, t.id, r.created_at desc;
end; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'may_edit_player(uuid)',
    'set_player_profile(uuid,int,int,int,text,text,boolean,text)',
    'set_player_previous_clubs(uuid,jsonb)',
    'league_players(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  lgadm uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid();
  out_ uuid := gen_random_uuid();
  lg uuid; ss uuid; tm uuid; pl uuid;
  orig text; failed text[] := '{}';
  n int; t text;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (lgadm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pp-lgadm@example.invalid', '', now(), now(), now()),
         (mgr,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pp-mgr@example.invalid', '', now(), now(), now()),
         (out_,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pp-out@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('pp-test', 'PP Test') returning id into lg;
  insert into seasons (league_id, name) values (lg, 'PP') returning id into ss;
  insert into teams (league_id, slug, name) values (lg, 'pp-club', 'PP Club') returning id into tm;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (lgadm, 'league_admin', 'league', lg),
           (mgr, 'team_manager', 'team', tm);
  insert into players (slug, first_name, last_name, birth_year)
    values ('pp-player', 'Pat', 'Player', 2000) returning id into pl;
  insert into roster_entries (team_id, player_id, season_id, jersey, active)
    values (tm, pl, ss, '4', true);

  set local role authenticated;

  -- ---- the LEAGUE ADMIN, which is what 0052 is for -------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', lgadm, 'role', 'authenticated')::text, true);

  t := public.set_player_profile(pl, 201, 96, 210, null, 'Centre', null, null);
  if (select height_cm from players where id = pl) <> 201 then
    failed := array_append(failed, 'a league admin could not set a height');
  end if;
  if (select position from roster_entries where player_id = pl and active) <> 'Centre' then
    failed := array_append(failed, 'a league admin could not set a position');
  end if;
  n := public.set_player_previous_clubs(pl, jsonb_build_array(
        jsonb_build_object('club', 'Old Town', 'from', 2018, 'to', 2021)));
  if n <> 1 then failed := array_append(failed, 'a league admin could not set a career'); end if;

  select height_cm, wingspan_cm into n, n from public.league_players(lg, 'Pat');
  select count(*) into n from public.league_players(lg, 'Pat')
   where height_cm = 201 and wingspan_cm = 210 and position = 'Centre'
     and jsonb_array_length(previous_clubs) = 1 and age is not null;
  if n <> 1 then
    failed := array_append(failed, 'league_players does not carry the profile the editor needs');
  end if;

  -- ---- the CLUB MANAGER still can ------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  t := public.set_player_profile(pl, 202);
  if (select height_cm from players where id = pl) <> 202 then
    failed := array_append(failed, 'the club manager lost the right to edit');
  end if;

  -- ---- and a stranger cannot ----------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  begin perform public.set_player_profile(pl, 150);
    failed := array_append(failed, 'a stranger edited a player profile');
  exception when insufficient_privilege then null; end;
  begin perform public.set_player_previous_clubs(pl, '[]'::jsonb);
    failed := array_append(failed, 'a stranger rewrote a career');
  exception when insufficient_privilege then null; end;
  begin perform * from public.league_players(lg, '');
    failed := array_append(failed, 'a stranger read the league roster');
  exception when insufficient_privilege then null; end;

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from player_previous_clubs where player_id = pl;
  delete from roster_entries where player_id = pl;
  delete from players where id = pl;
  delete from memberships where user_id in (lgadm, mgr);
  delete from teams where id = tm;
  delete from seasons where id = ss;
  delete from leagues where id = lg;
  delete from auth.users where id in (lgadm, mgr, out_);

  if array_length(failed, 1) > 0 then
    raise exception E'PLAYER PROFILE SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
