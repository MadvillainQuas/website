-- ============================================================================
-- AUTHENTICATED RLS TESTS — manager A against manager B.
--
-- The existing suites cover the attacker who is anonymous, and the one who is
-- signed in with no roles. Neither covers the case that actually matters in a
-- league: somebody with a LEGITIMATE account reaching into somebody else's
-- team. That is the realistic insider, and it was untested.
--
-- Testing it needs two accounts with different memberships. Signing them up
-- would send two emails from the same allowance the magic-link logins use,
-- which locks the owner out for an hour — so instead this impersonates them in
-- the database, which is what the policies actually read:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"…","role":"authenticated"}';
--
-- auth.uid() resolves from that claim, so every policy behaves exactly as it
-- would for a real signed-in caller.
--
-- IT LEAVES NOTHING BEHIND. Everything is created, asserted against, and
-- deleted. If any assertion fails the exception rolls the whole migration back,
-- so the database is clean whether this passes or fails — the only difference
-- is whether the push succeeds.
-- ============================================================================
do $$
declare
  ua uuid := gen_random_uuid();          -- manager of team A
  ub uuid := gen_random_uuid();          -- manager of team B
  lg uuid;
  ss uuid;
  cp uuid;
  ta uuid;
  tb uuid;
  gm uuid;
  pa uuid;
  n  int;
  failed text[] := '{}';
  orig text;                             -- the role this migration runs as

begin
  /* `reset role` returns to the SESSION role, which is not necessarily the one
     this migration is running as — and that role turned out to have no rights
     on game_officials at all, which surfaced as a bare "permission denied"
     rather than anything to do with the policies under test. Capture the
     current role and go back to it explicitly. */
  select current_user into orig;

  -- ---------------------------------------------------------------- set-up ---
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'rlstest-a@example.invalid', '', now(), now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'rlstest-b@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('rls-test-league', 'RLS Test League')
    returning id into lg;
  insert into seasons (league_id, name, starts_on, ends_on)
    values (lg, 'RLS', current_date, current_date + 1) returning id into ss;
  insert into competitions (season_id, name) values (ss, 'RLS Div') returning id into cp;

  insert into teams (league_id, slug, name) values (lg, 'rls-team-a', 'RLS A')
    returning id into ta;
  insert into teams (league_id, slug, name) values (lg, 'rls-team-b', 'RLS B')
    returning id into tb;

  insert into memberships (user_id, role, scope_type, scope_id)
    values (ua, 'team_manager', 'team', ta),
           (ub, 'team_manager', 'team', tb);

  insert into games (competition_id, home_team_id, away_team_id, status, tipoff_at)
    values (cp, ta, tb, 'scheduled', now()) returning id into gm;

  insert into players (slug, first_name, last_name)
    values ('rls-test-player', 'RLS', 'Player') returning id into pa;
  insert into roster_entries (team_id, player_id, jersey) values (ta, pa, '4');

  -- ------------------------------------------------------- impersonate A ----
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  if auth.uid() <> ua then
    raise exception 'impersonation did not take: auth.uid() is %', auth.uid();
  end if;

  -- A manages team A
  if not public.is_team_manager(ta) then
    failed := failed || 'A is not recognised as manager of their own team';
  end if;
  -- and NOT team B
  if public.is_team_manager(tb) then
    failed := failed || 'A is treated as manager of B''s team';
  end if;

  -- A may rename their own team
  update teams set name = 'RLS A renamed' where id = ta;
  get diagnostics n = row_count;
  if n <> 1 then failed := failed || 'A could not rename their own team'; end if;

  -- and their kit colour, which is the other thing the portal offers
  update teams set colour = '#123456' where id = ta;
  get diagnostics n = row_count;
  if n <> 1 then failed := failed || 'A could not change their own kit colour'; end if;

  -- A may NOT rename B's team. RLS makes this a silent no-op rather than an
  -- error, which is exactly why it needs asserting: nothing raises.
  update teams set name = 'hijacked' where id = tb;
  get diagnostics n = row_count;
  if n <> 0 then failed := failed || 'A RENAMED B''S TEAM'; end if;

  -- A may not walk their team out of the league, which is what 0007 was
  -- protecting and 0028 moved into a trigger
  begin
    update teams set league_id = null where id = ta;
    failed := failed || 'A MOVED THEIR TEAM OUT OF THE LEAGUE';
  exception when insufficient_privilege then null;
  end;

  -- A may not put a player on B's roster
  begin
    insert into roster_entries (team_id, player_id, jersey) values (tb, pa, '99');
    failed := failed || 'A ADDED A PLAYER TO B''S ROSTER';
  exception when insufficient_privilege then null;
  end;

  -- A is not an official for the game, so may not write events to it
  if public.can_score(gm) then
    failed := failed || 'A can score a game they are not assigned to';
  end if;
  begin
    insert into game_events (game_id, seq, t, period, clock)
      values (gm, 1, 'p2_made', 1, 600000);
    failed := failed || 'A WROTE AN EVENT TO A GAME THEY DO NOT SCORE';
  exception when insufficient_privilege then null;
  end;

  -- nor grant themselves the right to
  begin
    insert into game_officials (game_id, user_id, role)
      values (gm, ua, 'statistician');
    failed := failed || 'A APPOINTED THEMSELVES STATISTICIAN';
  exception when insufficient_privilege then null;
  end;

  -- nor make themselves a league admin
  begin
    insert into memberships (user_id, role, scope_type, scope_id)
      values (ua, 'league_admin', 'league', lg);
    failed := failed || 'A GRANTED THEMSELVES LEAGUE ADMIN';
  exception when insufficient_privilege then null;
  end;

  -- nor rename the league
  update leagues set name = 'hijacked' where id = lg;
  get diagnostics n = row_count;
  if n <> 0 then failed := failed || 'A RENAMED THE LEAGUE'; end if;

  -- ------------------------------------------------------- impersonate B ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', ub, 'role', 'authenticated')::text, true);

  if public.is_team_manager(ta) then
    failed := failed || 'B is treated as manager of A''s team';
  end if;
  if not public.is_team_manager(tb) then
    failed := failed || 'B is not recognised as manager of their own team';
  end if;

  -- B may not remove A's player from A's roster
  delete from roster_entries where team_id = ta;
  get diagnostics n = row_count;
  if n <> 0 then failed := failed || 'B DELETED A''S ROSTER ENTRY'; end if;

  -- ------------------------------------- a statistician, scoped to one game --
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
  insert into game_officials (game_id, user_id, role)
    values (gm, ub, 'statistician');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', ub, 'role', 'authenticated')::text, true);

  if not public.can_score(gm) then
    failed := failed || 'an appointed statistician cannot score their game';
  end if;
  insert into game_events (game_id, seq, t, period, clock)
    values (gm, 1, 'p2_made', 1, 600000);
  get diagnostics n = row_count;
  if n <> 1 then failed := failed || 'an appointed statistician could not write an event'; end if;

  -- being a statistician does NOT make them a team manager
  if public.is_team_manager(ta) then
    failed := failed || 'appointing a statistician made them a team manager';
  end if;

  -- ------------------------------------- a finalised game closes to writes --
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
  update games set status = 'final' where id = gm;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', ub, 'role', 'authenticated')::text, true);

  if public.can_score(gm) then
    failed := failed || 'a finalised game is still scoreable';
  end if;
  /* A finalised game is defended twice: the RLS policy refuses with 42501, and
     a trigger refuses with its own message. Either is a correct refusal, so
     both are accepted — what must not happen is the write succeeding. */
  begin
    insert into game_events (game_id, seq, t, period, clock)
      values (gm, 2, 'p3_made', 1, 500000);
    failed := failed || 'AN EVENT WAS WRITTEN TO A FINALISED GAME';
  exception
    when insufficient_privilege then null;
    when raise_exception then null;
  end;

  -- and 0027's retraction policy must respect that too. RLS makes a refused
  -- delete a silent no-op; the trigger makes it an exception. Both are fine.
  begin
    delete from game_events where game_id = gm and seq = 1;
    get diagnostics n = row_count;
    if n <> 0 then failed := failed || 'AN EVENT WAS RETRACTED FROM A FINALISED GAME'; end if;
  exception
    when insufficient_privilege then null;
    when raise_exception then null;
  end;

  -- ------------------------------------------------------------- clean up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  delete from game_events where game_id = gm;
  delete from game_officials where game_id = gm;
  delete from games where id = gm;
  delete from roster_entries where team_id in (ta, tb);
  delete from players where id = pa;
  delete from memberships where user_id in (ua, ub);
  delete from teams where id in (ta, tb);
  delete from competitions where id = cp;
  delete from seasons where id = ss;
  delete from leagues where id = lg;
  delete from auth.users where id in (ua, ub);

  -- ---------------------------------------------------------------- verdict --
  if array_length(failed, 1) is not null then
    raise exception 'AUTHENTICATED RLS FAILURES (% of them): %',
      array_length(failed, 1), array_to_string(failed, ' | ');
  end if;

  raise notice 'authenticated RLS: manager A cannot reach team B, an unassigned '
               'manager cannot score, a statistician is scoped to their game, '
               'and a finalised game is closed to both writes and retractions';
end $$;
