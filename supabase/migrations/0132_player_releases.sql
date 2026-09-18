-- ============================================================================
-- 0132 — RELEASED: the one thing the injury report cannot work out for itself.
--
-- epinoia/injuries.js reads who is missing straight out of the box scores: a player the club was
-- playing, who has no minutes in the games since, is out. That is right for an injury and right
-- for a suspension, and it is wrong exactly once — when the player has simply gone. A transfer
-- the report can see (he turns out for somebody else and drops off), but a release it cannot:
-- nothing happens, and a player who will never appear again sits on the wire and on every
-- preview's question marks forever.
--
-- So a club says so. One row per club and player; its presence means released. A team manager
-- or their league's administrator may add and remove it (is_team_manager, 0001), through
-- set_player_released, which writes the audit_log entry with it. Deleting the row un-releases:
-- a player who comes back is just a player again, and the report picks him up the moment he
-- records a minute.
--
-- Read by anybody who may see the league — a members-only league's wire is behind its wall like
-- everything else (can_view_league, 0117).
--
-- Nothing else changes. Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

create table if not exists public.player_releases (
  team_id     uuid not null references public.teams   on delete cascade,
  player_id   uuid not null references public.players on delete cascade,
  season_id   uuid references public.seasons on delete set null,
  note        text not null default '',
  released_at timestamptz not null default now(),
  released_by uuid references auth.users,
  primary key (team_id, player_id)
);

create index if not exists player_releases_player_idx on public.player_releases (player_id);

comment on table public.player_releases is
  'A club has released this player: the row''s presence removes them from the injury report / waiver wire (epinoia/injuries.js) and from the question marks on a game preview. Written through set_player_released; deleting the row un-releases.';

alter table public.player_releases enable row level security;

drop policy if exists player_releases_read  on public.player_releases;
drop policy if exists player_releases_write on public.player_releases;

-- readable wherever the league is
create policy player_releases_read on public.player_releases
  for select using (
    exists (select 1 from public.teams t
             where t.id = player_releases.team_id
               and public.can_view_league(t.league_id)));

-- and written only by the club (or its league's administrator)
create policy player_releases_write on public.player_releases
  for all using (public.is_team_manager(team_id))
       with check (public.is_team_manager(team_id));

-- A NEW TABLE IN public ARRIVES WITH EVERY PRIVILEGE FOR anon, from Supabase's default
-- privileges, so the grant that matters is the revoke: row-level security would have stopped a
-- signed-out write anyway, but a table nobody may write is better than a table everybody may
-- attempt to.
revoke all on public.player_releases from anon;
grant select on public.player_releases to anon, authenticated;
grant insert, delete, update on public.player_releases to authenticated;

-- ----------------------------------------------------------------------------
-- One call, one answer — and the audit row with it. The browser sends the club,
-- the player and whether they are released; it gets back 'released' or 'active'.
-- ----------------------------------------------------------------------------
create or replace function public.set_player_released(
  p_team uuid, p_player uuid, p_released boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare
  t record;
  s uuid;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;
  if not exists (select 1 from players where id = p_player) then
    raise exception 'no such player' using errcode = '22023';
  end if;
  if not public.is_team_manager(p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  if coalesce(p_released, false) then
    -- the season the club is in now, for the audit trail; the row is keyed by club and player
    select se.id into s
      from seasons se
      join competitions c on c.season_id = se.id
      join games g on g.competition_id = c.id
     where g.home_team_id = p_team or g.away_team_id = p_team
     order by g.tipoff_at desc nulls last
     limit 1;

    insert into player_releases (team_id, player_id, season_id, note, released_by)
    values (p_team, p_player, s, left(coalesce(p_note, ''), 400), auth.uid())
    on conflict (team_id, player_id) do update
      set note = excluded.note, released_at = now(), released_by = excluded.released_by;
  else
    delete from player_releases where team_id = p_team and player_id = p_player;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_player_released', 'player', p_player::text,
          jsonb_build_object('team', p_team, 'released', coalesce(p_released, false)));

  return case when coalesce(p_released, false) then 'released' else 'active' end;
end; $$;

alter function public.set_player_released(uuid, uuid, boolean, text) owner to postgres;
revoke all on function public.set_player_released(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_player_released(uuid, uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- WHICH OF THESE CLUBS DO I MANAGE? One question, one answer, in the spirit of
-- may_manage_team (0080): the wire draws every club in a league at once, and
-- asking per club would be a round trip each for a boolean the page needs before
-- it can decide whether to offer a Released button on any of them.
-- ----------------------------------------------------------------------------
create or replace function public.teams_i_manage(p_teams uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select t from unnest(coalesce(p_teams, '{}'::uuid[])) t where public.is_team_manager(t);
$$;

alter function public.teams_i_manage(uuid[]) owner to postgres;
revoke all on function public.teams_i_manage(uuid[]) from public, anon;
grant execute on function public.teams_i_manage(uuid[]) to authenticated;

-- ============================================================================
-- SELF-TEST: the table and its key, who may read it, who may write it, and that
-- the setter refuses a stranger. Everything it makes is rolled back.
-- ============================================================================
do $test$
declare
  lg uuid;
  tm uuid;
  pl uuid;
  mgr  uuid := gen_random_uuid();
  them uuid := gen_random_uuid();
  orig text := current_user;
  n    int;
begin
  if to_regclass('public.player_releases') is null then
    raise exception '0132: player_releases was not created';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.player_releases'::regclass and contype = 'p'
                    and array_length(conkey, 1) = 2) then
    raise exception '0132: player_releases must be keyed by the club and the player together';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.player_releases'::regclass) then
    raise exception '0132: player_releases must have row-level security on';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'player_releases') <> 2 then
    raise exception '0132: player_releases needs exactly its read and write policies';
  end if;
  if not has_table_privilege('anon', 'public.player_releases', 'select') then
    raise exception '0132: a signed-out reader must be able to read the wire';
  end if;
  if has_table_privilege('anon', 'public.player_releases', 'insert') then
    raise exception '0132: a signed-out visitor must not be able to release anybody';
  end if;
  if not has_function_privilege('authenticated', 'public.set_player_released(uuid, uuid, boolean, text)', 'execute') then
    raise exception '0132: a signed-in user must be able to call set_player_released';
  end if;
  if has_function_privilege('anon', 'public.set_player_released(uuid, uuid, boolean, text)', 'execute') then
    raise exception '0132: set_player_released must not be callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.teams_i_manage(uuid[])', 'execute') then
    raise exception '0132: a signed-in user must be able to ask which clubs they manage';
  end if;

  select id into lg from public.leagues order by created_at limit 1;
  if lg is null then return; end if;

  begin
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg, 't0132-a', '0132 Test A', 'TA', '#93f2bf') returning id into tm;
    insert into public.players (slug, first_name, last_name)
    values ('p0132-a', '0132', 'Tester') returning id into pl;

    insert into public.player_releases (team_id, player_id) values (tm, pl);
    begin
      insert into public.player_releases (team_id, player_id) values (tm, pl);
      raise exception '0132: a club released the same player twice';
    exception when unique_violation then null;
    end;
    delete from public.player_releases where team_id = tm and player_id = pl;

    -- the setter refuses somebody who does not manage the club (nobody is signed in here)
    begin
      perform public.set_player_released(tm, pl, true);
      raise exception '0132: set_player_released let a stranger release a player';
    exception when insufficient_privilege then null;
    end;

    -- ------------------------------------------------------------------------
    -- AND THE POLICY ITSELF, not only the grants: as postgres every check above
    -- is bypassed, so the club's manager and a signed-in stranger are actually
    -- impersonated (the pattern 0031 uses). Both accounts are rolled back.
    -- ------------------------------------------------------------------------
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (mgr,  'authenticated', 'authenticated', '0132-mgr@example.invalid',  now(), now()),
           (them, 'authenticated', 'authenticated', '0132-them@example.invalid', now(), now());
    insert into public.memberships (user_id, role, scope_type, scope_id)
    values (mgr, 'team_manager', 'team', tm);

    set local role authenticated;

    -- the stranger
    perform set_config('request.jwt.claims',
      json_build_object('sub', them, 'role', 'authenticated')::text, true);
    if public.is_team_manager(tm) then
      raise exception '0132: a stranger is treated as managing the club';
    end if;
    begin
      insert into public.player_releases (team_id, player_id) values (tm, pl);
      raise exception '0132: A SIGNED-IN STRANGER RELEASED A PLAYER';
    exception when insufficient_privilege then null;
    end;

    if exists (select 1 from public.teams_i_manage(array[tm])) then
      raise exception '0132: teams_i_manage named a club the stranger does not manage';
    end if;

    -- the club's manager
    perform set_config('request.jwt.claims',
      json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    if not exists (select 1 from public.teams_i_manage(array[tm])) then
      raise exception '0132: teams_i_manage left out a club the caller does manage';
    end if;
    if public.set_player_released(tm, pl, true, 'left the club') <> 'released' then
      raise exception '0132: the club''s manager could not release a player';
    end if;
    select count(*) into n from public.player_releases where team_id = tm and player_id = pl;
    if n <> 1 then raise exception '0132: the release was not written'; end if;

    -- ...which the stranger may read, and may not take away
    perform set_config('request.jwt.claims',
      json_build_object('sub', them, 'role', 'authenticated')::text, true);
    select count(*) into n from public.player_releases where team_id = tm and player_id = pl;
    if n <> 1 then raise exception '0132: the wire must be readable by anybody who sees the league'; end if;
    delete from public.player_releases where team_id = tm and player_id = pl;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0132: A SIGNED-IN STRANGER UN-RELEASED A PLAYER'; end if;

    -- and the club takes it back: the row goes, and the player is in the report again
    perform set_config('request.jwt.claims',
      json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    if public.set_player_released(tm, pl, false) <> 'active' then
      raise exception '0132: the club''s manager could not un-release a player';
    end if;
    select count(*) into n from public.player_releases where team_id = tm and player_id = pl;
    if n <> 0 then raise exception '0132: un-releasing left the row behind'; end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    raise exception using errcode = 'P0004', message = '0132 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
