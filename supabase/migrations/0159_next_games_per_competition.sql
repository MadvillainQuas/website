-- ============================================================================
-- 0159 — EACH LEAGUE'S NEXT GAME WITHOUT WALKING EVERY FIXTURE ON THE PLATFORM.
--
-- league_next_games (0152) is HOME's one read of every league's next game. It
-- is security_invoker, so games' read policy applies, and it was written as a
-- DISTINCT ON over every scheduled game from two hours ago on: every fixture of
-- every league's full season, several thousand rows, each put through
-- can_read_game() (a SECURITY DEFINER function with a four-table join) before
-- DISTINCT ON kept one per league. Measured on 2026-09-24: 787 ms a read.
--
-- Now each competition gives its own first scheduled game, from a partial index
-- in tip-off order (LIMIT 1 in a LATERAL), and DISTINCT ON keeps each league's
-- earliest of those. The policy still applies to every row read, and before the
-- LIMIT, so a game the reader may not see is skipped and the next one taken,
-- exactly as before; it is just asked about a few dozen rows instead of every
-- fixture. Same columns, same rows, same rights: the self-test compares the two
-- formulations for every league.
-- ============================================================================
create index if not exists games_competition_scheduled
  on public.games (competition_id, tipoff_at, id) where status = 'scheduled';

create or replace view public.league_next_games with (security_invoker = true) as
  select distinct on (s.league_id)
         s.league_id, n.game_id, n.tipoff_at
    from public.seasons s
    join public.competitions c on c.season_id = s.id
    cross join lateral (
      select g.id as game_id, g.tipoff_at
        from public.games g
       where g.competition_id = c.id
         and g.status = 'scheduled'
         and g.tipoff_at >= now() - interval '2 hours'
       order by g.tipoff_at, g.id
       limit 1) n
   order by s.league_id, n.tipoff_at, n.game_id;

comment on view public.league_next_games is
  'The first scheduled game of each league (tip-off from two hours ago on), read with the caller''s own rights: each competition''s first from games_competition_scheduled, then each league''s earliest (0152, 0159). HOME reads it once instead of once per league.';
revoke all on public.league_next_games from public, anon, authenticated;
grant select on public.league_next_games to anon, authenticated, service_role;

-- ============================================================================
-- SELF-TEST: as this role (the tables' owner, so no policy on either side), the
-- view answers exactly what 0152's single DISTINCT ON answered, league by league.
-- ============================================================================
do $test$
declare n int;
begin
  with old as (
    select distinct on (s.league_id) s.league_id, g.id as game_id, g.tipoff_at
      from public.games g
      join public.competitions c on c.id = g.competition_id
      join public.seasons s      on s.id = c.season_id
     where g.status = 'scheduled' and g.tipoff_at >= now() - interval '2 hours'
     order by s.league_id, g.tipoff_at, g.id
  ), cur as (
    select league_id, game_id, tipoff_at from public.league_next_games
  )
  select count(*) into n
    from ((select * from old except select * from cur)
          union all
          (select * from cur except select * from old)) d;
  if n <> 0 then
    raise exception '0159: the per-competition view differs from 0152''s by % rows', n;
  end if;
end $test$;
