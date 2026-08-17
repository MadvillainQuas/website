-- ============================================================================
-- "May this account rebuild that competition?"
--
-- The season awards are rebuilt whenever a game is finalised, which is right
-- for a season in progress and useless for one that has already ended. A
-- league that corrects a historic game — or, right now, one that wants its MVP
-- moved off the efficiency formula and onto box plus/minus — needs to be able
-- to ask for a rebuild without replaying anything.
--
-- The rebuild itself lives in the finalise Edge Function, because BPM is
-- computed by the same JavaScript the pages run rather than by a second
-- implementation in plpgsql (see supabase/functions/_shared/awards.ts for why).
-- What the database owes that function is an answer to ONE question: is the
-- caller an administrator of the league this competition belongs to.
--
-- A competition does not carry its league — it hangs off a season, which hangs
-- off a league — so this is the join, in one place, rather than three lines
-- repeated in every caller that will eventually need it.
-- ============================================================================
create or replace function public.is_league_admin_of_competition(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from competitions c
      join seasons s on s.id = c.season_id
     where c.id = p_competition
       and public.is_league_admin(s.league_id)
  );
$$;

revoke execute on function public.is_league_admin_of_competition(uuid) from anon, public;
grant  execute on function public.is_league_admin_of_competition(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Prove it: it must answer TRUE for an administrator and FALSE for a stranger.
-- A permission function that always says no is as broken as one that always
-- says yes, and only one of those is obvious.
-- ---------------------------------------------------------------------------
do $$
declare
  orig    text;
  v_user  uuid := gen_random_uuid();
  v_lg    uuid;
  v_ss    uuid;
  v_cp    uuid;
  failed  text[] := '{}';
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'awardtest@example.invalid', '', now(), now(), now());
  insert into leagues (slug, name) values ('award-test-league', 'Award Test')
    returning id into v_lg;
  insert into seasons (league_id, name, starts_on, ends_on)
    values (v_lg, 'Award', current_date, current_date + 1) returning id into v_ss;
  insert into competitions (season_id, name) values (v_ss, 'Award Div')
    returning id into v_cp;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (v_user, 'league_admin', 'league', v_lg);

  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  if public.is_league_admin_of_competition(v_cp) then
    failed := failed || 'a stranger was treated as an administrator';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  if not public.is_league_admin_of_competition(v_cp) then
    failed := failed || 'the league''s own administrator was refused';
  end if;
  if public.is_league_admin_of_competition(gen_random_uuid()) then
    failed := failed || 'a competition that does not exist answered true';
  end if;

  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  delete from memberships where user_id = v_user;
  delete from competitions where id = v_cp;
  delete from seasons where id = v_ss;
  delete from leagues where id = v_lg;
  delete from auth.users where id = v_user;

  if array_length(failed, 1) is not null then
    raise exception 'is_league_admin_of_competition: %', array_to_string(failed, ' | ');
  end if;
  raise notice 'is_league_admin_of_competition answers correctly for both an admin and a stranger';
end $$;
