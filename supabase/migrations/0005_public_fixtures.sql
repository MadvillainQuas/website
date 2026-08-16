-- ============================================================================
-- Fix: upcoming fixtures were invisible to the public.
--
-- can_read_game() allowed only final games, live-with-opt-in, and participants.
-- That makes a fixtures page impossible — who plays whom, when and where is the
-- most ordinary public information a league site has.
--
-- But the same function also guarded game_events, game_state and the derived
-- tables, so opening it wholesale would have exposed a part-scored game's event
-- log. The two concerns are now separate:
--
--   can_read_game        -> the fixture ROW (scheduled fixtures are public)
--   can_read_game_detail -> events, clock state, derived stats (unchanged rules)
-- ============================================================================

-- the fixture row: scheduled and final are public; live needs the league's opt-in
create or replace function public.can_read_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    left join leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( g.status in ('scheduled','final')                          -- fixtures & results
            or (g.status = 'live' and coalesce(l.public_live,false))
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- the detail: a part-scored game's play-by-play is NOT public unless the league
-- opted into live, or you are involved in the game
create or replace function public.can_read_game_detail(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    left join leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( g.status = 'final'
            or (g.status = 'live' and coalesce(l.public_live,false))
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- repoint everything that reads game CONTENT at the stricter function
drop policy if exists events_read on public.game_events;
create policy events_read on public.game_events for select
  using (public.can_read_game_detail(game_id));

drop policy if exists state_read on public.game_state;
create policy state_read on public.game_state for select
  using (public.can_read_game_detail(game_id));

drop policy if exists pgs_read on public.player_game_stats;
create policy pgs_read on public.player_game_stats for select
  using (public.can_read_game_detail(game_id));

drop policy if exists tgs_read on public.team_game_stats;
create policy tgs_read on public.team_game_stats for select
  using (public.can_read_game_detail(game_id));

drop policy if exists ls_read on public.lineup_stints;
create policy ls_read on public.lineup_stints for select
  using (public.can_read_game_detail(game_id));

-- games.select keeps the looser rule so fixtures list publicly
drop policy if exists games_read on public.games;
create policy games_read on public.games for select using (public.can_read_game(id));
