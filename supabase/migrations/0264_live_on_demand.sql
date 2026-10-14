-- 0264 LIVE ON DEMAND (2026-10-14)
--
-- A league with hundreds of games a night (NCAA Division II: ~140 men's and ~140 women's on a Saturday) cannot have
-- every game's play-by-play written as it happens: that is the database's whole write budget, and nobody is watching
-- most of them. So a league whose rules say {"live": "on_demand"} is followed in two depths:
--
--   every game        its score, period and clock, from one scoreboard read for all of them (the ingest writes
--                     game_state and the game's status) - enough for every card, list and table on the site
--   a watched game    in full, exactly as any other league's live game: the play-by-play written as it happens and
--                     pushed to the page, for as long as somebody has it open
--   every game, at    in full once, finalised (every player's and club's line, the season's numbers), and moved into
--   the final whistle the archive tier at once (run_ingest archive_on_final) - so the play-by-play of the whole season
--                     exists, as files, and is rebuilt in the reader's session when opened
--
-- A game page keeps its game watched by calling watch_game every 30 s while it is open; the ingest reads game_watch
-- for the games it is following. And a game nobody watches broadcasts nothing: live_frames_wanted (0157) now says no
-- for an on-demand league's unwatched games, so a scoreboard pass over 300 games is not 300 frames and 300 "status"
-- announcements to every open HOME page (which reads the scores on its own 15-second poll).
--
-- Additive: a table, two functions, and live_frames_wanted re-stated with only the lines tagged 0264 added.

create table if not exists public.game_watch (
  game_id uuid primary key references public.games (id) on delete cascade,
  until   timestamptz not null
);
comment on table public.game_watch is
  'Live games somebody has open, for leagues followed on demand (leagues.rules->>''live'' = ''on_demand''): '
  'kept by watch_game from the game page, read by the ingest (0264).';
alter table public.game_watch enable row level security;
revoke all on table public.game_watch from public, anon, authenticated;
grant all on table public.game_watch to service_role;

-- whether a game's league is followed on demand
create or replace function public.live_on_demand(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select l.rules->>'live' = 'on_demand'
                     from public.games g
                     join public.competitions c on c.id = g.competition_id
                     join public.seasons s      on s.id = c.season_id
                     join public.leagues l      on l.id = s.league_id
                    where g.id = p_game), false);
$$;
revoke all on function public.live_on_demand(uuid) from public;
grant execute on function public.live_on_demand(uuid) to anon, authenticated, service_role;
alter function public.live_on_demand(uuid) owner to postgres;

-- "I am watching this game": from the game page, every 30 s while it is open. True when the game is now watched (a
-- live game, or one due within half an hour, of an on-demand league); false for any other game, which needs nothing.
-- A renewal within 30 s of the last writes nothing.
create or replace function public.watch_game(p_game uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or not public.live_on_demand(p_game) or not exists (
       select 1 from public.games g
        where g.id = p_game
          and (g.status = 'live' or (g.status = 'scheduled' and g.tipoff_at < now() + interval '30 minutes'))) then
    return false;
  end if;
  insert into public.game_watch (game_id, until) values (p_game, now() + interval '90 seconds')
  on conflict (game_id) do update set until = excluded.until
   where public.game_watch.until < now() + interval '60 seconds';
  return true;
end $$;
revoke all on function public.watch_game(uuid) from public;
grant execute on function public.watch_game(uuid) to anon, authenticated, service_role;
alter function public.watch_game(uuid) owner to postgres;

-- 0157's gate, with an on-demand league's unwatched games left out
create or replace function public.live_frames_wanted(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.external_games x where x.game_id = p_game)
     and exists (
           select 1
             from public.games g
             join public.competitions c on c.id = g.competition_id
             join public.seasons s      on s.id = c.season_id
             join public.leagues l      on l.id = s.league_id
            where g.id = p_game
              and l.visibility = 'public'
              and (l.access_mode = 'open' or not public.memberships_enabled())
              and (g.status = 'final' or (g.status = 'live' and coalesce(l.public_live, false)))
              and (coalesce(l.rules->>'live', '') <> 'on_demand'                                              -- 0264
                   or exists (select 1 from public.game_watch w where w.game_id = g.id and w.until > now())));  -- 0264
$$;
revoke all on function public.live_frames_wanted(uuid) from public, anon, authenticated;
alter function public.live_frames_wanted(uuid) owner to postgres;
