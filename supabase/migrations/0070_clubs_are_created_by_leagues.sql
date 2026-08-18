-- ============================================================================
-- 0070 — A CLUB IS CREATED BY THE LEAGUE IT BELONGS TO.
--
-- teams_create has read, since 0007:
--
--     auth.uid() is not null
--     and (league_id is null or public.is_league_admin(league_id))
--
-- The first half of that disjunction is the hole. Creating a club INSIDE a
-- league correctly needs an administrator of it; creating one with no league
-- at all needed nothing but an account. So any signed-in stranger could insert
-- clubs indefinitely, and the club portal offered them a form to do it with —
-- on the same screen that told them no clubs were assigned to their account.
--
-- WHAT A LEAGUE-LESS CLUB ACTUALLY IS. Not much: it appears in no table, no
-- fixture list and no statistics, because every one of those is reached
-- through a competition and a season. It is a row with a name, a colour and a
-- membership making its creator the manager of something that does not play.
-- The portal then listed it under "my teams", which is how a stray row starts
-- looking like a feature.
--
-- Nothing legitimate is lost. The league console creates clubs with a
-- league_id, which this still allows for that league's administrators, and a
-- platform administrator may create anything anywhere as before.
-- ============================================================================
drop policy if exists teams_create on public.teams;
create policy teams_create on public.teams for insert with check (
  public.is_platform_admin()
  or (league_id is not null and public.is_league_admin(league_id))
);

comment on policy teams_create on public.teams is
  'A club belongs to a league and is created by somebody who administers that '
  'league. League-less clubs are no longer insertable: they appeared in no '
  'table, fixture list or statistic, and the only thing that could create one '
  'was an account with no roles at all.';

-- ------------------------------------------------------------- assertions ---
do $$
declare stranger uuid := gen_random_uuid(); orig text; refused boolean; n int;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (stranger, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'club-stranger@example.invalid', '', now(), now(), now());

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', stranger, 'role', 'authenticated')::text, true);

  -- the exact thing the portal's form used to do
  begin
    insert into teams (slug, name, short_name, colour, created_by)
    values ('stray-club-0070', 'Stray Club', 'SC', '#93f2bf', stranger);
    refused := false;
  exception when others then refused := true;
  end;
  if not refused then
    raise exception 'ASSERT an account with no roles created a league-less club';
  end if;

  -- and it cannot smuggle one into a league it does not administer
  begin
    insert into teams (slug, name, league_id, created_by)
    values ('stray-club-0070b', 'Stray Club B',
            (select id from leagues limit 1), stranger);
    refused := false;
  exception when others then refused := true;
  end;
  if not refused then
    raise exception 'ASSERT a stranger created a club inside a league';
  end if;

  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into n from teams where slug like 'stray-club-0070%';
  if n <> 0 then
    delete from teams where slug like 'stray-club-0070%';
    raise exception 'ASSERT % stray club(s) were actually written', n;
  end if;

  delete from memberships where user_id = stranger;
  delete from auth.users where id = stranger;

  raise notice '0070: clubs are created by league administrators only';
end $$;
