-- ============================================================================
-- Height, weight, wingspan and previous club.
--
-- Stored on the PLAYER rather than the roster entry: they describe the person,
-- not their registration with a club this season. Jersey lives on the roster
-- entry because it changes with the club; a wingspan does not.
--
-- SAFEGUARDING. players_read already hides an under-18 from the public
-- entirely, so these columns inherit that: nothing about a minor is readable
-- without being their team's manager. That is the right default and it is not
-- weakened here — but it is worth naming, because "height and weight of a
-- fourteen-year-old, on a public website" is exactly the shape of thing that
-- should never be added without someone having thought about it.
--
-- Units are stored in centimetres and kilograms and converted for display.
-- Storing "6'4" as text is how a database ends up unable to sort by height.
-- ============================================================================
alter table public.players
  add column if not exists height_cm    int,
  add column if not exists weight_kg    int,
  add column if not exists wingspan_cm  int,
  add column if not exists previous_club text;

do $$ begin
  alter table public.players
    add constraint players_height_sane   check (height_cm   is null or height_cm   between 100 and 260);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.players
    add constraint players_weight_sane   check (weight_kg   is null or weight_kg   between 30 and 250);
exception when duplicate_object then null; end $$;
do $$ begin
  /* a wingspan shorter than 120cm or longer than 280cm is a typo, not a
     player — the constraint is there to catch a slipped decimal rather than to
     police anatomy, so the bounds are generous */
  alter table public.players
    add constraint players_wingspan_sane check (wingspan_cm is null or wingspan_cm between 120 and 280);
exception when duplicate_object then null; end $$;

comment on column public.players.height_cm    is 'centimetres; converted for display';
comment on column public.players.weight_kg    is 'kilograms; converted for display';
comment on column public.players.wingspan_cm  is 'centimetres; converted for display';
comment on column public.players.previous_club is 'free text — the club they came from, not a foreign key';

-- Prove the write path a team manager will actually use is open to them and
-- shut to everybody else, because a column nobody can edit is a column that
-- looks broken.
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  lg uuid; ta uuid; tb uuid; pa uuid; n int;
  orig text;
  failed text[] := '{}';
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'meas-a@example.invalid', '', now(), now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'meas-b@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('meas-test', 'Measure Test') returning id into lg;
  insert into teams (league_id, slug, name) values (lg, 'meas-a', 'A') returning id into ta;
  insert into teams (league_id, slug, name) values (lg, 'meas-b', 'B') returning id into tb;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (ua, 'team_manager', 'team', ta), (ub, 'team_manager', 'team', tb);
  insert into players (slug, first_name, last_name) values ('meas-p', 'Meas', 'Ure')
    returning id into pa;
  insert into roster_entries (team_id, player_id, jersey) values (ta, pa, '4');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  update players set height_cm = 198, weight_kg = 95, wingspan_cm = 210,
                     previous_club = 'Old Town' where id = pa;
  get diagnostics n = row_count;
  if n <> 1 then failed := failed || 'a manager could not record their own player''s measurements'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  update players set height_cm = 150 where id = pa;
  get diagnostics n = row_count;
  if n <> 0 then failed := failed || 'ANOTHER CLUB''S MANAGER EDITED THESE MEASUREMENTS'; end if;

  -- and the constraints catch a slipped decimal rather than storing nonsense
  perform set_config('request.jwt.claims',
    json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin
    update players set height_cm = 1980 where id = pa;
    failed := failed || 'a 19.8-metre player was accepted';
  exception when check_violation then null;
  end;

  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  delete from roster_entries where player_id = pa;
  delete from players where id = pa;
  delete from memberships where user_id in (ua, ub);
  delete from teams where id in (ta, tb);
  delete from leagues where id = lg;
  delete from auth.users where id in (ua, ub);

  if array_length(failed, 1) is not null then
    raise exception 'MEASUREMENT PERMISSIONS: %', array_to_string(failed, ' | ');
  end if;
  raise notice 'measurements: own club may edit, another club may not, silly values refused';
end $$;
