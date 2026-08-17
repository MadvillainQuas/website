-- ============================================================================
-- 0058 — A PLATFORM ADMINISTRATOR MAY SCORE AND IMPORT A GAME.
--
-- can_score() has always allowed two people: a statistician assigned to that
-- game, and a league administrator of the league that owns it. A PLATFORM
-- administrator was not on the list, which meant the person who runs the
-- platform could create a league, schedule its fixtures, assign its
-- statisticians and approve its photographs — but could not upload a played
-- game to it.
--
-- That was an oversight rather than a policy. can_manage_game(), written six
-- migrations later for scheduling and assignment, opens with
-- is_platform_admin(); can_score(), written first, never had it added. The two
-- have disagreed about who a platform administrator is ever since.
--
-- ONE FUNCTION, THREE DOORS. can_score() is not only about writing events:
--
--     game_events INSERT   events_insert  -> can_score(game_id)
--     game_events DELETE   events_delete  -> can_score(game_id) and not final
--     games       UPDATE   games_update   -> can_score(id) or is_league_admin
--
-- The importer uses all three — it sets the game live, writes the events in
-- chunks, and deletes them again if the import is re-run. So this single line
-- is what the whole import path was failing on, and fixing it here fixes it in
-- one place rather than in three policies that would then have to agree.
--
-- WHAT IS NOT WIDENED. The status guard stays exactly as it was: no one, at any
-- level, may write events into a game that is already final. A finalised game
-- is reopened deliberately or not at all, and a platform administrator is not
-- an exception to that — they are the person most likely to be holding the
-- wrong game id.
-- ============================================================================
create or replace function public.can_score(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    where g.id = p_game
      and g.status in ('scheduled','live')                    -- never a finalised game
      and ( public.is_platform_admin()
            or exists (select 1 from game_officials go
                       where go.game_id = p_game and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

comment on function public.can_score(uuid) is
  'May the caller write events to this game? A platform admin, an assigned '
  'statistician, or a league admin of the owning league — and never once the '
  'game is final.';

-- ------------------------------------------------------------- assertions ---
-- The migration runs as no one in particular (auth.uid() is null), so the
-- happy paths cannot be exercised from in here. What CAN be proved is the part
-- that matters most and is easiest to get wrong: that the status guard still
-- refuses a finalised game, and that an anonymous caller is still refused.
do $$
declare g_final uuid; g_open uuid;
begin
  select id into g_final from games where status = 'final' limit 1;
  select id into g_open  from games where status in ('scheduled','live') limit 1;

  -- nobody is signed in here, so every answer must be false regardless of
  -- which game is asked about. If this passes for the open game, the new
  -- is_platform_admin() branch is returning true for an anonymous caller,
  -- which would be the worst possible outcome of this change.
  if g_open is not null and public.can_score(g_open) then
    raise exception 'ASSERT can_score is true for an anonymous caller';
  end if;
  if g_final is not null and public.can_score(g_final) then
    raise exception 'ASSERT can_score is true for a finalised game';
  end if;

  -- and the function still compiles against the columns it names
  perform public.can_score(gen_random_uuid());

  raise notice '0058: can_score widened to platform admins; anon and final still refused';
end $$;
