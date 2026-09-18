-- ============================================================================
-- 0136 — THE PUBLIC READ PATH STOPS PAYING FOR CHECKS ABOUT WHO IS LOGGED IN.
--
-- "Best performing players" on HOME never loaded: the browser got a 500 from
-- player_game_stats, and behind it a plain Postgres statement timeout (57014).
-- Measured on the live database, 2026-09-18, signed out:
--
--     team_game_stats,   22 games,  44 rows   0.62 s   ok
--     player_game_stats,  8 games, 179 rows   0.63 s   ok
--     player_game_stats, 22 games, 528 rows   TIMEOUT  (~3 s budget)
--
-- The cost tracks the number of ROWS RETURNED, not the number of game ids asked
-- for, which is what a per-row policy looks like from the outside. 0118 gave
-- five row-heavy tables the same read policy: a correlated EXISTS that joins
-- games -> competitions -> seasons -> leagues and then, for EVERY row, may call
-- is_team_manager() twice, is_league_admin() once, and look in game_officials.
-- Those helpers are `stable`, which lets Postgres keep one answer per statement
-- but does NOT memoise them across rows, and each one is itself two or three
-- sub-selects (is_team_manager -> is_league_admin -> is_platform_admin, each a
-- lookup in memberships). Half a thousand rows times that is the three seconds.
--
-- WHAT CHANGES: nothing about who may read what. Every one of those identity
-- branches reduces to a membership held by auth.uid():
--
--     is_platform_admin() = exists(memberships where user_id = auth.uid() ...)
--     is_league_admin(l)  = is_platform_admin() or exists(memberships ... auth.uid())
--     is_team_manager(t)  = is_platform_admin() or exists(memberships ... auth.uid())
--                                              or is_league_admin(team's league)
--     the officials arm   = exists(game_officials where user_id = auth.uid())
--
-- With no session, auth.uid() is null and all four are false — so asking them at
-- all is pure waste on exactly the read the public site makes most. They now sit
-- behind `(select auth.uid()) is not null`, which Postgres evaluates once per
-- statement as an InitPlan rather than once per row. A signed-in reader still
-- runs every check exactly as before; a signed-out one skips a branch that could
-- only ever have answered false.
--
-- The members-only arm (can_view_league) is deliberately untouched: it is the
-- one identity check that is NOT about privilege but about access, it is already
-- reached only when memberships_enabled() is on and the league is not open, and
-- it must keep answering for a signed-in member.
--
-- Same rewrite, same reasoning, on all five tables 0118 wrote it to. game_events
-- is the sharpest case: one finished game is ~800 rows, so a single game page
-- could blow the budget on its own — which is why supabase/tests/rls.test.mjs
-- and livestats.roundtrip.mjs had both started failing in CI.
-- ============================================================================

set local lock_timeout = '5s';

-- the whole predicate, once, so the five policies below cannot drift apart:
-- `p_game` is the row's game, everything else is the same for every row.
create or replace function public.can_read_game_rows(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and case when l.id is null or l.access_mode = 'open'
                            or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            -- ONLY WHEN THERE IS SOMEBODY TO BE: see the note at the top. Each of
            -- these is false for auth.uid() = null, so a signed-out read skips them.
            or ( (select auth.uid()) is not null
                 and ( public.is_team_manager(g.home_team_id)
                       or public.is_team_manager(g.away_team_id)
                       or exists (select 1 from public.game_officials go
                                  where go.game_id = g.id and go.user_id = (select auth.uid()))
                       or (s.league_id is not null and public.is_league_admin(s.league_id)) ) ) )
  );
$$;

comment on function public.can_read_game_rows(uuid) is
  'May the caller read the per-game rows (events, state, box score, stints) of this game? 0118''s predicate, with the who-am-I half skipped for a caller with no session at all.';

grant execute on function public.can_read_game_rows(uuid) to anon, authenticated;

drop policy if exists events_read on public.game_events;
create policy events_read on public.game_events for select
using (public.can_read_game_rows(game_id));

drop policy if exists state_read on public.game_state;
create policy state_read on public.game_state for select
using (public.can_read_game_rows(game_id));

drop policy if exists pgs_read on public.player_game_stats;
create policy pgs_read on public.player_game_stats for select
using (public.can_read_game_rows(game_id));

drop policy if exists tgs_read on public.team_game_stats;
create policy tgs_read on public.team_game_stats for select
using (public.can_read_game_rows(game_id));

drop policy if exists ls_read on public.lineup_stints;
create policy ls_read on public.lineup_stints for select
using (public.can_read_game_rows(game_id));

-- ============================================================================
-- SELF-TEST: the rewrite answers exactly what 0118's predicate answered, for the
-- cases that decide whether a reader sees a game at all. Rolled back either way.
-- ============================================================================
do $test$
declare
  v_final uuid;
  v_sched uuid;
  n int;
begin
  select g.id into v_final
    from public.games g
    join public.competitions c on c.id = g.competition_id
    join public.seasons s on s.id = c.season_id
    join public.leagues l on l.id = s.league_id
   where g.status = 'final' and coalesce(l.access_mode, 'open') = 'open'
   limit 1;
  select id into v_sched from public.games where status = 'scheduled' limit 1;

  -- as a signed-out reader: a finished game in an open league is public...
  set local role anon;
  if v_final is not null and not public.can_read_game_rows(v_final) then
    raise exception '0136: a finished game in an open league must stay readable signed out';
  end if;
  -- ...and one that has not been played is not
  if v_sched is not null and public.can_read_game_rows(v_sched) then
    raise exception '0136: a scheduled game must not become readable signed out';
  end if;
  reset role;

  -- every policy is on the function, so none of them can drift from the others
  select count(*) into n
    from pg_policies
   where schemaname = 'public'
     and policyname in ('events_read', 'state_read', 'pgs_read', 'tgs_read', 'ls_read')
     and qual like '%can_read_game_rows%';
  if n <> 5 then
    raise exception '0136: expected five policies on can_read_game_rows, found %', n;
  end if;

  raise exception using errcode = 'P0004', message = '0136 self-test rollback';
exception when sqlstate 'P0004' then null;
end $test$;
