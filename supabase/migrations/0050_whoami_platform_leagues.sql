-- ============================================================================
-- 0050 — whoami() has to tell a PLATFORM admin what they can administer.
--
-- THE BUG. 0009 built the caller's league list from memberships:
--
--     where m.user_id = auth.uid() and m.role = 'league_admin'
--
-- which is right for a league administrator and wrong for the person who runs
-- the platform. is_league_admin() has returned true for a platform admin since
-- 0001 — every RPC would have let them act — but whoami() reported an empty
-- list, the console read that as "you administer nothing", and the entire
-- workspace stayed hidden. So the owner of the site could see "PLATFORM ADMIN"
-- at the top of the page and no league picker underneath it.
--
-- It is worth being precise about what went wrong, because the shape recurs:
-- AUTHORISATION AND ENUMERATION ARE DIFFERENT QUESTIONS. "May I act on this?"
-- was answered correctly everywhere. "What may I act on?" was answered by a
-- query that had quietly encoded a narrower rule, and nothing connected the
-- two. A platform admin never hit a refusal — they hit an empty list, which
-- looks like a broken page rather than a permissions problem, which is why it
-- was reported as "I am an admin and cannot select a league".
--
-- The fix makes the enumeration read from the same rule the authorisation
-- does, and carries HOW each league is held so a page can say so.
-- ============================================================================

create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email',   (select u.email::text from auth.users u where u.id = auth.uid()),
    'is_platform_admin', public.is_platform_admin(),

    /* A platform admin administers every league that exists; anybody else
       administers the ones they hold a membership for. `via` distinguishes
       them, so a console can show "all leagues, as platform admin" rather
       than implying forty memberships nobody granted. */
    'leagues', case when public.is_platform_admin() then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', l.id, 'slug', l.slug, 'name', l.name, 'via', 'platform')
                 order by l.name)
          from leagues l
      ), '[]'::jsonb) else coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', l.id, 'slug', l.slug, 'name', l.name, 'via', 'membership')
                 order by l.name)
          from memberships m join leagues l on l.id = m.scope_id
         where m.user_id = auth.uid() and m.role = 'league_admin'
           and m.scope_type = 'league'
      ), '[]'::jsonb) end,

    /* The same asymmetry applies to clubs: is_team_manager() is true for a
       platform admin, so the portal was in exactly the same position. */
    'teams', case when public.is_platform_admin() then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'slug', t.slug, 'name', t.name, 'via', 'platform')
                 order by t.name)
          from teams t
      ), '[]'::jsonb) else coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'slug', t.slug, 'name', t.name, 'via', 'membership')
                 order by t.name)
          from memberships m join teams t on t.id = m.scope_id
         where m.user_id = auth.uid() and m.role = 'team_manager'
           and m.scope_type = 'team'
      ), '[]'::jsonb) end,

    'scoring', coalesce((
      select jsonb_agg(jsonb_build_object('game_id', g.id, 'status', g.status)
                        order by g.tipoff_at)
      from game_officials go join games g on g.id = go.game_id
      where go.user_id = auth.uid() and g.status in ('scheduled','live')
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;

-- ============================================================================
-- SELF-TEST — the exact case that was broken.
-- ============================================================================
do $$
declare
  plat uuid := gen_random_uuid();
  lgadm uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  lg1 uuid; lg2 uuid; tm uuid;
  orig text; failed text[] := '{}';
  j jsonb; n int;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (plat,   '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'who-plat@example.invalid',  '', now(), now(), now()),
         (lgadm,  '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'who-lg@example.invalid',    '', now(), now(), now()),
         (nobody, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'who-none@example.invalid',  '', now(), now(), now());

  insert into leagues (slug, name) values ('who-a', 'Who League A') returning id into lg1;
  insert into leagues (slug, name) values ('who-b', 'Who League B') returning id into lg2;
  insert into teams (league_id, slug, name) values (lg1, 'who-club', 'Who Club')
    returning id into tm;

  insert into memberships (user_id, role, scope_type, scope_id)
  values (plat,  'platform_admin', 'platform', null),
         (lgadm, 'league_admin',   'league',   lg1);

  set local role authenticated;

  -- ---- the platform admin, holding NO league membership --------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', plat, 'role', 'authenticated')::text, true);
  j := public.whoami();

  if not (j->>'is_platform_admin')::boolean then
    failed := array_append(failed, 'the platform admin does not read as one');
  end if;
  /* The whole point: at least the two leagues created above, without either
     of them having been granted to this account. */
  if jsonb_array_length(j->'leagues') < 2 then
    failed := array_append(failed,
      'a platform admin was offered only ' || jsonb_array_length(j->'leagues') ||
      ' leagues — this is the bug 0050 exists to fix');
  end if;
  select count(*) into n from jsonb_array_elements(j->'leagues') e
   where e->>'id' in (lg1::text, lg2::text);
  if n <> 2 then
    failed := array_append(failed, 'the platform admin cannot see both new leagues');
  end if;
  select count(*) into n from jsonb_array_elements(j->'leagues') e
   where e->>'via' <> 'platform';
  if n > 0 then
    failed := array_append(failed, 'a platform admin''s leagues are not marked as such');
  end if;
  select count(*) into n from jsonb_array_elements(j->'teams') e where e->>'id' = tm::text;
  if n <> 1 then
    failed := array_append(failed, 'a platform admin cannot see the clubs either');
  end if;

  -- ---- a league admin still sees exactly their own ------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', lgadm, 'role', 'authenticated')::text, true);
  j := public.whoami();
  if (j->>'is_platform_admin')::boolean then
    failed := array_append(failed, 'a league admin reads as a platform admin');
  end if;
  if jsonb_array_length(j->'leagues') <> 1 then
    failed := array_append(failed,
      'a league admin was offered ' || jsonb_array_length(j->'leagues') || ' leagues, not 1');
  end if;
  if (j->'leagues'->0->>'id') <> lg1::text then
    failed := array_append(failed, 'a league admin was offered the wrong league');
  end if;
  if (j->'leagues'->0->>'via') <> 'membership' then
    failed := array_append(failed, 'a membership league is not marked as one');
  end if;
  if jsonb_array_length(j->'teams') <> 0 then
    failed := array_append(failed, 'a league admin was handed clubs they do not manage');
  end if;

  -- ---- somebody with nothing gets nothing ---------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', nobody, 'role', 'authenticated')::text, true);
  j := public.whoami();
  if jsonb_array_length(j->'leagues') <> 0 or jsonb_array_length(j->'teams') <> 0 then
    failed := array_append(failed, 'an account with no roles was offered something');
  end if;

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from memberships where user_id in (plat, lgadm);
  delete from teams where id = tm;
  delete from leagues where id in (lg1, lg2);
  delete from auth.users where id in (plat, lgadm, nobody);

  if array_length(failed, 1) > 0 then
    raise exception E'WHOAMI SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
