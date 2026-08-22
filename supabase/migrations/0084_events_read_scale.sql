-- ============================================================================
-- READING A SEASON'S WORTH OF PLAY-BY-PLAY.
--
-- events_read has always been `using (public.can_read_game_detail(game_id))`.
-- That is correct, it is readable, and it is a FUNCTION CALL PER ROW.
--
-- The function is marked stable, so Postgres may reuse its answer within a
-- statement for the same argument — but the argument is the row's own game_id,
-- so it varies, and a select spanning thirty games evaluates a four-table join
-- once for every one of ~24,000 rows. Measured against the live database
-- before this migration: 0.82s to answer a 1000-row page of game_events with
-- an exact count, against 0.23s for the same page with the count suppressed.
-- Most of that difference is the policy, and it grows with the league.
--
-- THE PREDICATE IS NOT CHANGING. Not one condition is added, removed or
-- reordered. It is the same test written inline, so that the planner sees a
-- join it can hash rather than a black box it must call. The self-test at the
-- bottom proves the equivalence against every game actually in the database,
-- for the current role, rather than asserting it in a comment.
--
-- WHY NOT JUST DROP THE FUNCTION. Because it is the readable statement of the
-- rule and eleven other things call it. It stays exactly as it is and remains
-- the definition; this inlines it in the ONE place that is evaluated per row of
-- the largest table on the platform.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- game_events — the big one. ~800 rows per game, and every public box score,
-- every player profile and every season aggregation reads it.
-- ----------------------------------------------------------------------------
drop policy if exists events_read on public.game_events;
create policy events_read on public.game_events for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = game_events.game_id
      and ( g.status = 'final'
            or (g.status = 'live' and coalesce(l.public_live, false))
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

-- ----------------------------------------------------------------------------
-- game_state — one row per game rather than eight hundred, so the win here is
-- small. It is changed anyway because two policies over the same rule that
-- drift apart is a security bug waiting to happen, and the drift starts the
-- day one of them is edited and the other is not.
-- ----------------------------------------------------------------------------
drop policy if exists state_read on public.game_state;
create policy state_read on public.game_state for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = game_state.game_id
      and ( g.status = 'final'
            or (g.status = 'live' and coalesce(l.public_live, false))
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

-- ----------------------------------------------------------------------------
-- NO INDEX IS CREATED HERE, and an earlier draft of this file created one.
--
-- 0001 already has `create index on public.game_events (game_id, seq)`, which
-- Postgres named game_events_game_id_seq_idx. Adding a differently-NAMED index
-- over the same columns does not collide — `if not exists` checks the name, not
-- the definition — so it would have been created, silently, as a second
-- identical btree on the busiest table on the platform. Every event a
-- statistician records would then cost two index writes instead of one, for no
-- read benefit whatsoever.
--
-- The existing index covers the fan-out this migration is about: game_id IN
-- (forty of them) ORDER BY seq is the same access path as one game in order.
-- Left here as a note so the next person does not add it again.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- SELF-TEST — the predicate is identical, proved against real rows.
--
-- For every game in the database, the inlined test must agree with the
-- function it replaces. Run as whoever applies the migration, so it proves
-- equivalence for that role; the predicate contains no role-specific branch
-- that could agree for one caller and differ for another, which is exactly why
-- an inline copy is safe here and would not be if it did.
-- ============================================================================
do $test$
declare
  g          record;
  inline_ok  boolean;
  fn_ok      boolean;
  checked    int := 0;
  disagreed  int := 0;
begin
  for g in select id from public.games loop
    select exists (
      select 1
      from public.games gg
      left join public.competitions c on c.id = gg.competition_id
      left join public.seasons s      on s.id = c.season_id
      left join public.leagues  l     on l.id = s.league_id
      where gg.id = g.id
        and ( gg.status = 'final'
              or (gg.status = 'live' and coalesce(l.public_live, false))
              or public.is_team_manager(gg.home_team_id)
              or public.is_team_manager(gg.away_team_id)
              or exists (select 1 from public.game_officials go
                         where go.game_id = gg.id and go.user_id = auth.uid())
              or (s.league_id is not null and public.is_league_admin(s.league_id)) )
    ) into inline_ok;

    select public.can_read_game_detail(g.id) into fn_ok;

    checked := checked + 1;
    if inline_ok is distinct from fn_ok then
      disagreed := disagreed + 1;
      raise warning '0084: game % — inline says %, function says %',
        g.id, inline_ok, fn_ok;
    end if;
  end loop;

  if disagreed > 0 then
    raise exception '0084: the inlined policy is NOT the same rule (% of % games disagree)',
      disagreed, checked;
  end if;

  raise notice '0084 ok: same rule, inlined, agreed on all % games — the planner '
               'can now join instead of calling a function per row', checked;
end $test$;
