-- ============================================================================
-- 0141 — WHO IS THIS PERSON, AND WHO LOOKS AFTER THIS CLUB.
--
-- Two readers, and nothing else. Every WRITE the console does with them already
-- exists — grant_role, revoke_role, grant_league_writer, revoke_league_writer —
-- so this adds no new way to change anybody's rights and no new authorisation
-- surface to get wrong. It only makes the existing ones reachable from where a
-- platform admin is actually looking.
--
-- WHY. Appointing somebody has had exactly one shape: go to one form, type an
-- address from memory, choose a role, choose a scope out of a list of every
-- league or every club on the platform. That is backwards for the two things
-- anybody actually does:
--
--   * "what does this account have, and fix it" — the accounts table showed a
--     row of pills and nothing else. There was no view of one person, so
--     anything beyond a membership (a news writer, a private league they were
--     let into, an invitation still waiting on their address) was invisible
--     from here.
--   * "give Dan the Gloucester league" — the league is on screen, in the
--     leagues tab, and the only way to act on it was to leave, scroll to the
--     grant form, and find Gloucester again in a dropdown.
--
--   platform_account(user)  everything about one account, in one call
--   team_members(team)      who looks after one club
--
-- league_members(p_league) already existed (0007) and covers a league AND the
-- clubs in it, so the leagues tab needs nothing new.
--
-- Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. ONE ACCOUNT, WHOLE.
--
-- Four different things can attach a person to a league, and until now the
-- console could only see the first:
--
--   memberships   platform admin, league admin, club manager, statistician
--   writers       league_writers (0051) — not a membership; writing for a
--                 league is not a degree of administering one
--   guests        league_guests (0139) — a private league they opened a link to
--   pending       pending_roles (0140) — an appointment made to this address
--                 before the account existed, still waiting
--
-- All four in one object because the question is "what does this person have",
-- and four round trips to answer it is four chances to draw half an answer.
-- ----------------------------------------------------------------------------
create or replace function public.platform_account(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, auth as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'user_id',         u.id,
    'email',           u.email::text,
    'display_name',    coalesce(pr.display_name, ''),
    'created_at',      u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'confirmed',       u.email_confirmed_at is not null,
    'banned',          u.banned_until is not null and u.banned_until > now(),
    'provider',        coalesce(u.raw_app_meta_data ->> 'provider', 'email'),

    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'membership_id', ms.id,
               'role',     ms.role::text,
               'scope',    ms.scope_type::text,
               'scope_id', ms.scope_id,
               'label',    case ms.scope_type
                             when 'platform' then 'the platform'
                             when 'league'   then (select l.name from leagues l where l.id = ms.scope_id)
                             when 'team'     then (select t.name from teams t where t.id = ms.scope_id)
                           end)
             order by ms.role, ms.created_at)
        from memberships ms where ms.user_id = u.id), '[]'::jsonb),

    'writers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'league_id', w.league_id,
               'label', (select l.name from leagues l where l.id = w.league_id))
             order by w.created_at)
        from league_writers w where w.user_id = u.id), '[]'::jsonb),

    'guests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'league_id', g.league_id,
               'label',     (select l.name from leagues l where l.id = g.league_id),
               'private',   (select l.visibility = 'private' from leagues l where l.id = g.league_id),
               'joined_at', g.joined_at,
               'via',       coalesce((select i.label from league_invites i where i.id = g.invite_id), ''))
             order by g.joined_at desc)
        from league_guests g where g.user_id = u.id), '[]'::jsonb),

    /* Matched on the ADDRESS, not the id, because that is the whole point of a
       pending row: it was written when there was no account to point at. An
       account that exists should normally have none — 0140 applies and deletes
       them on confirmation — so one showing here means the address was invited
       and has not confirmed itself yet, which is worth seeing on this screen. */
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pe.id, 'role', pe.role,
               'scope', pe.scope_type, 'scope_id', pe.scope_id,
               'label', case pe.scope_type
                          when 'platform' then 'the platform'
                          when 'league'   then (select l.name from leagues l where l.id = pe.scope_id)
                          when 'team'     then (select t.name from teams t where t.id = pe.scope_id)
                        end,
               'created_at', pe.created_at)
             order by pe.created_at)
        from pending_roles pe where pe.email = lower(u.email::text)), '[]'::jsonb)
  ) into v
    from auth.users u
    left join profiles pr on pr.id = u.id
   where u.id = p_user;

  if v is null then
    raise exception 'no account with id %', p_user using errcode = '42704';
  end if;
  return v;
end; $$;

-- ----------------------------------------------------------------------------
-- 2. ONE CLUB'S PEOPLE.
--
-- The mirror of league_members (0007), which answers for a league and the clubs
-- in it but cannot be asked about a club on its own — the clubs tab lists clubs
-- across every league, including clubs with no league at all, so it has nothing
-- to pass it.
--
-- Gated on is_team_manager, which is already "the club's own managers, its
-- league's admins, or the platform" (0001). So a league admin opening their own
-- club's people sees them, and nobody else's.
-- ----------------------------------------------------------------------------
create or replace function public.team_members(p_team uuid)
returns table (membership_id uuid, email text, role text, confirmed boolean)
language sql stable security definer set search_path = public, auth as $$
  select m.id, u.email::text, m.role::text, u.email_confirmed_at is not null
    from memberships m
    join auth.users u on u.id = m.user_id
   where public.is_team_manager(p_team)
     and m.scope_type = 'team' and m.scope_id = p_team
   order by m.role, u.email;
$$;

-- ----------------------------------------------------------------------------
-- 3. GRANTS.
-- ----------------------------------------------------------------------------
revoke all on function public.platform_account(uuid) from public, anon;
revoke all on function public.team_members(uuid) from public, anon;
grant execute on function public.platform_account(uuid) to authenticated;
grant execute on function public.team_members(uuid) to authenticated;
alter function public.platform_account(uuid) owner to postgres;
alter function public.team_members(uuid) owner to postgres;

-- ============================================================================
-- SELF-TEST. Asserts only about the league, club and accounts it creates
-- itself — the live platform has real ones and this must not have an opinion
-- about them (0140 learned that the expensive way).
-- ============================================================================
do $test$
declare
  orig text := current_user;
  lg uuid; tm uuid; boss uuid; hand uuid; nobody uuid;
  v jsonb; n int;
begin
  begin
    insert into leagues (slug, name) values ('t0141-lg', 'Test 0141 League') returning id into lg;
    insert into teams (slug, name, league_id) values ('t0141-club', 'Test 0141 Club', lg)
      returning id into tm;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0141-boss@example.invalid', '', now(), now(), now())
      returning id into boss;
    insert into memberships (user_id, role, scope_type, scope_id)
    values (boss, 'platform_admin', 'platform', null);

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0141-hand@example.invalid', '', now(), now(), now())
      returning id into hand;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0141-nobody@example.invalid', '', now(), now(), now())
      returning id into nobody;

    -- everything the dashboard can show, one of each
    insert into memberships (user_id, role, scope_type, scope_id)
    values (hand, 'league_admin', 'league', lg), (hand, 'team_manager', 'team', tm);
    insert into league_writers (league_id, user_id, created_by) values (lg, hand, boss);
    insert into league_guests (league_id, user_id) values (lg, hand);
    insert into pending_roles (email, role, scope_type, scope_id, invited_by)
    values ('t0141-hand@example.invalid', 'statistician', 'league', lg, boss);

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', boss, 'role', 'authenticated')::text, true);

    v := public.platform_account(hand);
    if v->>'email' <> 't0141-hand@example.invalid' then
      raise exception '0141: the wrong account came back (%)', v->>'email';
    end if;
    if jsonb_array_length(v->'memberships') <> 2 then
      raise exception '0141: % membership(s), expected 2', jsonb_array_length(v->'memberships');
    end if;
    if jsonb_array_length(v->'writers') <> 1 then
      raise exception '0141: the news writer row is missing from the dashboard';
    end if;
    if jsonb_array_length(v->'guests') <> 1 then
      raise exception '0141: the private-league guest row is missing from the dashboard';
    end if;
    if jsonb_array_length(v->'pending') <> 1 then
      raise exception '0141: the waiting appointment is missing from the dashboard';
    end if;
    -- the scope is NAMED, or the screen shows a uuid
    if not (v->'memberships'->0->>'label' = 'Test 0141 League'
         or v->'memberships'->1->>'label' = 'Test 0141 League') then
      raise exception '0141: a membership came back without its league name (%)', v->'memberships';
    end if;

    -- the club's own people
    select count(*) into n from public.team_members(tm);
    if n <> 1 then raise exception '0141: team_members returned % rows, expected 1', n; end if;
    if not exists (select 1 from public.team_members(tm) where role = 'team_manager') then
      raise exception '0141: team_members did not name the club manager';
    end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    -- and an account with no standing is refused, and sees no club either
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', nobody, 'role', 'authenticated')::text, true);
    begin
      v := public.platform_account(hand);
      raise exception '0141: a stranger read somebody else''s account';
    exception when insufficient_privilege then null;
    end;
    select count(*) into n from public.team_members(tm);
    if n <> 0 then raise exception '0141: a stranger read a club''s people'; end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    raise exception using errcode = 'P0004', message = '0141 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
