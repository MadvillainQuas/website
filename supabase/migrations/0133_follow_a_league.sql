-- ============================================================================
-- 0133 — FOLLOWING A WHOLE LEAGUE.
--
-- A fan could follow a club, a player or one game. Somebody who wants EVERY game in a league
-- had to find each club and press each bell, and a club joining the league next season would
-- then be missed — the follow was a list of clubs, not "this league".
--
-- fan_prefs.fav_league_ids holds it. The notifications themselves need no new code at all:
-- notify_audience, the one view all five fan-outs read, expands a followed league into the
-- clubs playing in it, so every predicate that already asks "is either side a club this fan
-- follows?" answers yes for every game in the league — including a club that joins later,
-- because the view is read when the notices are made, not when the follow was saved.
--
-- IT IS EXPANSION, NOT REPLACEMENT. The fan's own club list is untouched and still theirs to
-- edit; unfollowing the league takes the league's clubs back out and leaves their own behind.
-- The want_* switches still apply, so following a league does not override a fan who has
-- turned results off, and the "player-only" fan-outs still exclude a league follower from the
-- duplicate notice about a game they are already being told about.
--
-- SIGNED IN ONLY. push_devices — a phone following a league's own notification button
-- (0127) — is already scoped to one league by the embed it came from, so there is nothing
-- there for this to mean. Its branch of the view carries an empty list.
--
-- Nothing else changes. Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.fan_prefs
  add column if not exists fav_league_ids uuid[] not null default '{}';

do $c$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.fan_prefs'::regclass and conname = 'fan_prefs_leagues_cap') then
    -- a cap, because each one expands into every club in it and nobody follows twenty leagues
    alter table public.fan_prefs
      add constraint fan_prefs_leagues_cap check (cardinality(fav_league_ids) <= 20);
  end if;
end $c$;

comment on column public.fan_prefs.fav_league_ids is
  'Leagues this fan follows whole. notify_audience expands each into the clubs playing in it, so every game in the league reaches them — including clubs that join later.';

-- ----------------------------------------------------------------------------
-- The setter takes it like the other three lists, including the empty array that
-- means "clear" (jsonb cannot tell an empty array from an absent key in coalesce).
-- ----------------------------------------------------------------------------
create or replace function public.set_fan_prefs(p jsonb)
returns public.fan_prefs language plpgsql security invoker set search_path = public as $$
declare r public.fan_prefs;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update fan_prefs set
    theme              = coalesce(p->>'theme', theme),
    colour             = coalesce(p->>'colour', colour),
    fav_team_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_team_ids') x), fav_team_ids),
    fav_player_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_player_ids') x), fav_player_ids),
    fav_game_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_game_ids') x), fav_game_ids),
    fav_league_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_league_ids') x), fav_league_ids),
    notify_inapp       = coalesce((p->>'notify_inapp')::boolean, notify_inapp),
    notify_email       = coalesce((p->>'notify_email')::boolean, notify_email),
    notify_push        = coalesce((p->>'notify_push')::boolean, notify_push),
    want_results       = coalesce((p->>'want_results')::boolean, want_results),
    want_players       = coalesce((p->>'want_players')::boolean, want_players),
    want_fixtures      = coalesce((p->>'want_fixtures')::boolean, want_fixtures),
    want_announcements = coalesce((p->>'want_announcements')::boolean, want_announcements),
    want_fixture_2d    = coalesce((p->>'want_fixture_2d')::boolean, want_fixture_2d),
    want_fixture_2h    = coalesce((p->>'want_fixture_2h')::boolean, want_fixture_2h),
    want_lineups       = coalesce((p->>'want_lineups')::boolean, want_lineups),
    want_player_games  = coalesce((p->>'want_player_games')::boolean, want_player_games),
    want_halftime      = coalesce((p->>'want_halftime')::boolean, want_halftime),
    updated_at         = now()
  where user_id = auth.uid()
  returning * into r;

  -- an empty array is a real instruction, and array_agg over nothing is null
  if p ? 'fav_team_ids' and jsonb_array_length(p->'fav_team_ids') = 0 then
    update fan_prefs set fav_team_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_player_ids' and jsonb_array_length(p->'fav_player_ids') = 0 then
    update fan_prefs set fav_player_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_game_ids' and jsonb_array_length(p->'fav_game_ids') = 0 then
    update fan_prefs set fav_game_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_league_ids' and jsonb_array_length(p->'fav_league_ids') = 0 then
    update fan_prefs set fav_league_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- ONE AUDIENCE, one change. Every fan-out reads this view and asks whether either
-- side of a game is a club the subscriber follows; a followed league answers yes
-- for all of them by being the clubs that play in it.
--
-- The subquery is guarded on cardinality = 0, which is almost every row: a fan who
-- follows no league costs exactly what they cost before.
-- ----------------------------------------------------------------------------
create or replace view public.notify_audience as
  select p.user_id, null::uuid as device_id, p.user_id as sub,
         case when cardinality(p.fav_league_ids) = 0 then p.fav_team_ids
              else array(select distinct y
                           from unnest(p.fav_team_ids ||
                                       coalesce((select array_agg(t.id) from teams t
                                                  where t.league_id = any (p.fav_league_ids)),
                                                '{}'::uuid[])) y)
         end as fav_team_ids,
         p.fav_player_ids, p.fav_game_ids,
         p.want_results, p.want_players, p.want_fixtures, p.want_announcements,
         p.want_fixture_2d, p.want_fixture_2h, p.want_lineups, p.want_player_games, p.want_halftime,
         p.fav_league_ids
    from public.fan_prefs p
  union all
  select null::uuid, d.id, d.id,
         d.fav_team_ids, d.fav_player_ids, d.fav_game_ids,
         d.want_results, d.want_players, true, d.want_announcements,
         d.want_fixture_2d, d.want_fixture_2h, d.want_lineups, true, d.want_halftime,
         '{}'::uuid[]
    from public.push_devices d;
revoke all on table public.notify_audience from public, anon, authenticated;
alter view public.notify_audience owner to postgres;

-- ============================================================================
-- SELF-TEST: the column and its cap, the setter's two directions, and — the point
-- of the whole file — that a league follower is in the audience for a game between
-- two clubs they have never followed by name, and stops being when they unfollow.
-- Everything it makes is rolled back.
-- ============================================================================
do $test$
declare
  lg   uuid;
  lg2  uuid;
  tz   uuid;
  ta   uuid;
  tb   uuid;
  se   uuid;
  cp   uuid;
  gm   uuid;
  fan  uuid := gen_random_uuid();
  orig text := current_user;
  n    int;
  arr  uuid[];
begin
  if not exists (select 1 from pg_attribute att
                  where att.attrelid = 'public.fan_prefs'::regclass and att.attname = 'fav_league_ids'
                    and not att.attisdropped and att.atttypid = 'uuid[]'::regtype) then
    raise exception '0133: fan_prefs needs a uuid[] column fav_league_ids';
  end if;
  if not exists (select 1 from pg_attribute att
                  where att.attrelid = 'public.notify_audience'::regclass and att.attname = 'fav_league_ids') then
    raise exception '0133: notify_audience must carry fav_league_ids';
  end if;

  begin
    insert into public.leagues (slug, name) values ('l0133', '0133 Test League') returning id into lg;
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg, 't0133-a', '0133 A', 'TA', '#93f2bf') returning id into ta;
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg, 't0133-b', '0133 B', 'TB', '#8ff5ff') returning id into tb;
    insert into public.seasons (league_id, name) values (lg, '0133') returning id into se;
    insert into public.competitions (season_id, name, kind) values (se, '0133 Cup', 'league') returning id into cp;
    insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at)
    values (cp, ta, tb, 'scheduled', now() + interval '1 day') returning id into gm;

    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (fan, 'authenticated', 'authenticated', '0133-fan@example.invalid', now(), now());
    insert into public.fan_prefs (user_id) values (fan);

    -- following nothing: not in this game's audience
    select count(*) into n from public.notify_audience p
     where p.sub = fan and (ta = any (p.fav_team_ids) or tb = any (p.fav_team_ids));
    if n <> 0 then raise exception '0133: a fan following nothing was already in the audience'; end if;

    -- following the league: in it, for both clubs, without either being named
    update public.fan_prefs set fav_league_ids = array[lg] where user_id = fan;
    select count(*) into n from public.notify_audience p
     where p.sub = fan and ta = any (p.fav_team_ids) and tb = any (p.fav_team_ids);
    if n <> 1 then raise exception '0133: following the league did not reach its clubs'; end if;

    -- a club that joins later is reached without the follow being touched
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg, 't0133-c', '0133 C', 'TC', '#8ff5ff');
    select count(*) into n from public.notify_audience p
     where p.sub = fan
       and (select id from teams where slug = 't0133-c') = any (p.fav_team_ids);
    if n <> 1 then raise exception '0133: a club that joined later was not reached'; end if;

    -- a club in ANOTHER league is not
    if exists (select 1 from public.notify_audience p
                where p.sub = fan
                  and exists (select 1 from teams t
                               where t.league_id is distinct from lg and t.id = any (p.fav_team_ids))) then
      raise exception '0133: following one league reached another league''s clubs';
    end if;

    -- THE FAN'S OWN CLUBS SURVIVE THE EXPANSION. A club they follow by name in a
    -- different league must still be in the audience while this league is followed:
    -- the league adds to their list, it does not become it.
    insert into public.leagues (slug, name) values ('l0133b', '0133 Other League') returning id into lg2;
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg2, 't0133-z', '0133 Z', 'TZ', '#93f2bf') returning id into tz;
    update public.fan_prefs set fav_team_ids = array[tz] where user_id = fan;
    select p.fav_team_ids into arr from public.notify_audience p where p.sub = fan;
    if not (tz = any (arr)) then
      raise exception '0133: the expansion replaced the fan''s own clubs instead of adding to them (%)', arr;
    end if;
    if not (ta = any (arr)) then
      raise exception '0133: the fan''s own club pushed the league''s clubs out (%)', arr;
    end if;

    -- and the league follow outlives nothing: taking it off leaves their own list behind
    update public.fan_prefs set fav_league_ids = '{}' where user_id = fan;
    select p.fav_team_ids into arr from public.notify_audience p where p.sub = fan;
    if not (arr = array[tz]) then
      raise exception '0133: unfollowing the league did not leave the fan''s own clubs alone (%)', arr;
    end if;

    -- and the cap is real
    begin
      update public.fan_prefs set fav_league_ids = array(select gen_random_uuid() from generate_series(1, 21))
       where user_id = fan;
      raise exception '0133: a fan followed more leagues than the cap allows';
    exception when check_violation then null;
    end;

    -- the setter, as the fan themselves: it sets, and an empty array clears
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', fan, 'role', 'authenticated')::text, true);
    perform public.set_fan_prefs(jsonb_build_object('fav_league_ids', jsonb_build_array(lg::text)));
    select fav_league_ids into arr from public.fan_prefs where user_id = fan;
    if not (arr = array[lg]) then raise exception '0133: set_fan_prefs did not save the league'; end if;
    perform public.set_fan_prefs('{"fav_league_ids":[]}'::jsonb);
    select fav_league_ids into arr from public.fan_prefs where user_id = fan;
    if cardinality(arr) <> 0 then raise exception '0133: an empty array did not clear the leagues'; end if;
    -- and it leaves the other lists alone
    select fav_team_ids into arr from public.fan_prefs where user_id = fan;
    if not (arr = array[tz]) then raise exception '0133: clearing the leagues disturbed the clubs'; end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    raise exception using errcode = 'P0004', message = '0133 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
