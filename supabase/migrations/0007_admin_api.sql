-- ============================================================================
-- 0007 — league administration API, and two authorisation fixes that the
--        admin UI work exposed.
--
-- FIX 1 (privilege escalation, serious).
--   game_officials had:  for all using (<manager check>) with check (auth.uid() is not null)
--   A FOR ALL policy applies USING to select/update/delete and WITH CHECK to
--   insert. So the manager check never ran on INSERT: any signed-in user could
--   insert (game_id = <someone else's live game>, user_id = self). can_score()
--   grants scoring rights to anyone holding a game_officials row, so that was a
--   one-request path to writing events into a stranger's game. Both clauses now
--   run the same check.
--
-- FIX 2 (fixture injection).
--   games_create was `with check (auth.uid() is not null)`, so any signed-in
--   user could insert a game into any competition. Those rows render on the
--   public league page as real fixtures. Insert into a competition now requires
--   league admin; competition-less ad-hoc games (what the scorer creates) stay
--   open, and created_by is stamped server-side so ownership can't be forged.
--
-- Then the API the portal needs. Leagues could not be created through the API
-- at all — leagues_write checks is_league_admin(id) on a row that does not yet
-- exist, so INSERT could never pass. That is why the demo league had to be
-- seeded in SQL. create_league() closes that loop by creating the league and
-- granting the caller admin of it in one transaction.
-- ============================================================================

-- ---------------------------------------------------------------- helpers ---

-- may this user administer this game (schedule it, assign its statisticians)?
-- Distinct from can_score, which is about writing events during play.
create or replace function public.can_manage_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons     s on s.id = c.season_id
    where g.id = p_game
      and ( (s.league_id is not null and public.is_league_admin(s.league_id))
            -- an ad-hoc game belongs to whoever created it
            or (g.competition_id is null and g.created_by = auth.uid()) ));
$$;

-- may this user administer this competition?
create or replace function public.is_competition_admin(p_comp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from competitions c join seasons s on s.id = c.season_id
                 where c.id = p_comp and public.is_league_admin(s.league_id));
$$;

-- created_by must reflect who actually inserted the row, not what the client
-- claimed. Ad-hoc game ownership is an authorisation input, so it can't be
-- client-supplied. auth.uid() is null under the service role, where the
-- caller's value is kept (the finalise function replays real rows).
create or replace function public.stamp_created_by()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end; $$;

drop trigger if exists games_stamp_creator on public.games;
create trigger games_stamp_creator before insert on public.games
  for each row execute function public.stamp_created_by();

drop trigger if exists teams_stamp_creator on public.teams;
create trigger teams_stamp_creator before insert on public.teams
  for each row execute function public.stamp_created_by();

-- ------------------------------------------------------------ fixed RLS ---

drop policy if exists officials_write on public.game_officials;
create policy officials_write on public.game_officials for all
  using       (public.can_manage_game(game_id))
  with check  (public.can_manage_game(game_id));

drop policy if exists games_create on public.games;
create policy games_create on public.games for insert with check (
  auth.uid() is not null
  and (competition_id is null or public.is_competition_admin(competition_id))
);

-- a team may be created by anyone, but attaching it to a league is the
-- league's decision, not the creator's.
drop policy if exists teams_create on public.teams;
create policy teams_create on public.teams for insert with check (
  auth.uid() is not null
  and (league_id is null or public.is_league_admin(league_id))
);

-- moving a team between leagues is likewise the league's call. The old policy
-- let any team manager set league_id to anything.
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for update
  using (public.is_team_manager(id))
  with check (
    public.is_team_manager(id)
    and (league_id is null or public.is_league_admin(league_id))
  );

-- ----------------------------------------------------------- league setup ---

create or replace function public.create_league(
  p_name text,
  p_slug text,
  p_colour_a text default '#93f2bf',
  p_colour_b text default '#8ff5ff',
  p_public_live boolean default true,
  p_youth_protected boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  s text := lower(trim(p_slug));
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin may create a league'
      using errcode = '42501';
  end if;
  if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slug must be lower-case words separated by single hyphens'
      using errcode = '22023';
  end if;
  if exists (select 1 from leagues where slug = s) then
    raise exception 'the slug "%" is already taken', s using errcode = '23505';
  end if;

  insert into leagues (slug, name, colour_a, colour_b, public_live, youth_protected)
  values (s, trim(p_name), p_colour_a, p_colour_b, p_public_live, p_youth_protected)
  returning id into new_id;

  -- the creator administers what they created, so they are not locked out if
  -- platform admin is later removed
  insert into memberships (user_id, role, scope_type, scope_id)
  values (auth.uid(), 'league_admin', 'league', new_id)
  on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'create_league', 'league', new_id::text,
          jsonb_build_object('slug', s, 'name', p_name));

  return new_id;
end; $$;

-- ------------------------------------------------------------- role grants ---
-- Clients cannot read auth.users, so roles are granted by email through a
-- definer function. Each branch checks the caller against the scope being
-- granted; platform_admin can only ever be granted by a platform admin.

create or replace function public.grant_role(
  p_email      text,
  p_role       text,
  p_scope_type text,
  p_scope_id   uuid default null
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
  r public.role_kind := p_role::public.role_kind;
  st public.scope_kind := p_scope_type::public.scope_kind;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  if r = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'only a platform admin may grant platform admin'
        using errcode = '42501';
    end if;
  elsif st = 'league' then
    if p_scope_id is null or not public.is_league_admin(p_scope_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  elsif st = 'team' then
    if p_scope_id is null or not public.is_team_manager(p_scope_id) then
      raise exception 'you do not manage that team' using errcode = '42501';
    end if;
  else
    raise exception 'platform scope is reserved for platform_admin'
      using errcode = '42501';
  end if;

  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    -- deliberately explicit: the caller is an authenticated administrator who
    -- needs to know the invitation has not been accepted yet
    return 'no account for ' || p_email || ' yet — ask them to sign in once at /league/app/, then grant again';
  end if;

  insert into memberships (user_id, role, scope_type, scope_id)
  values (uid, r, st, p_scope_id)
  on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_role', 'membership', uid::text,
          jsonb_build_object('email', p_email, 'role', p_role,
                             'scope_type', p_scope_type, 'scope_id', p_scope_id));

  return 'granted ' || p_role || ' to ' || p_email;
end; $$;

create or replace function public.revoke_role(p_membership uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  select * into m from memberships where id = p_membership;
  if not found then return 'already revoked'; end if;

  if m.role = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'only a platform admin may revoke platform admin' using errcode = '42501';
    end if;
    -- never leave the platform with no administrator
    if (select count(*) from memberships where role = 'platform_admin') <= 1 then
      raise exception 'this is the only platform admin — grant another one first'
        using errcode = '23514';
    end if;
  elsif m.scope_type = 'league' then
    if not public.is_league_admin(m.scope_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  elsif m.scope_type = 'team' then
    if not public.is_team_manager(m.scope_id) then
      raise exception 'you do not manage that team' using errcode = '42501';
    end if;
  end if;

  delete from memberships where id = p_membership;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'revoke_role', 'membership', m.user_id::text,
          jsonb_build_object('role', m.role::text, 'scope_id', m.scope_id));

  return 'revoked';
end; $$;

-- who administers this league, with emails, for the portal's people list
create or replace function public.league_members(p_league uuid)
returns table (membership_id uuid, email text, role text, scope_type text, scope_id uuid)
language sql stable security definer set search_path = public, auth as $$
  select m.id, u.email::text, m.role::text, m.scope_type::text, m.scope_id
  from memberships m
  join auth.users u on u.id = m.user_id
  where public.is_league_admin(p_league)
    and ( (m.scope_type = 'league' and m.scope_id = p_league)
          or (m.scope_type = 'team' and m.scope_id in
              (select t.id from teams t where t.league_id = p_league)) )
  order by m.role, u.email;
$$;

-- ------------------------------------------------------ statistician assign ---

create or replace function public.assign_official(
  p_game uuid, p_email text, p_role text default 'statistician'
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
begin
  if not public.can_manage_game(p_game) then
    raise exception 'you do not administer that game' using errcode = '42501';
  end if;

  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return 'no account for ' || p_email || ' yet — ask them to sign in once at /league/app/, then assign again';
  end if;

  insert into game_officials (game_id, user_id, role)
  values (p_game, uid, coalesce(nullif(trim(p_role), ''), 'statistician'))
  on conflict (game_id, user_id) do update set role = excluded.role;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'assign_official', 'game', p_game::text,
          jsonb_build_object('email', p_email, 'role', p_role));

  return 'assigned ' || p_email;
end; $$;

-- the officials list for a game, with emails, for the schedule builder
create or replace function public.game_officials_list(p_game uuid)
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public, auth as $$
  select go.user_id, u.email::text, go.role
  from game_officials go join auth.users u on u.id = go.user_id
  where go.game_id = p_game and public.can_manage_game(p_game)
  order by u.email;
$$;

create or replace function public.remove_official(p_game uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_game(p_game) then
    raise exception 'you do not administer that game' using errcode = '42501';
  end if;
  delete from game_officials where game_id = p_game and user_id = p_user;
  return 'removed';
end; $$;

-- ------------------------------------------------------------------ grants ---
-- Every function above authorises its own caller, so exposing them to
-- authenticated users is the point. anon gets none of them.
revoke all on function public.create_league(text,text,text,text,boolean,boolean) from public, anon;
revoke all on function public.grant_role(text,text,text,uuid)                     from public, anon;
revoke all on function public.revoke_role(uuid)                                   from public, anon;
revoke all on function public.league_members(uuid)                                from public, anon;
revoke all on function public.assign_official(uuid,text,text)                     from public, anon;
revoke all on function public.game_officials_list(uuid)                           from public, anon;
revoke all on function public.remove_official(uuid,uuid)                          from public, anon;

grant execute on function public.create_league(text,text,text,text,boolean,boolean) to authenticated;
grant execute on function public.grant_role(text,text,text,uuid)                    to authenticated;
grant execute on function public.revoke_role(uuid)                                  to authenticated;
grant execute on function public.league_members(uuid)                               to authenticated;
grant execute on function public.assign_official(uuid,text,text)                    to authenticated;
grant execute on function public.game_officials_list(uuid)                          to authenticated;
grant execute on function public.remove_official(uuid,uuid)                         to authenticated;
