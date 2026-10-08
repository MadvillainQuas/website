-- ============================================================================
-- 0255 - WHICH OF THESE GAMES CAN BE WATCHED HERE: one read for a page of fixture cards (2026-10-08)
--
-- A fixture card shows its WATCH pill only for a league with a broadcaster entry (watch.js). A game the site itself has
-- a video for - its highlights, its whole game, its kept stream - in a league with no entry (the FIBA Europe Cup) had no
-- pill at all. The cards now ask, once for the page, which of their games have something to play, and give each such
-- game a pill that opens the site's own player on it (HOME's VIDEO view).
--
--   games_watchable(p_games uuid[]) -> (game uuid, kind text)   kind: live | full | highlights, the best one per game
--
-- The same videos as game_watch (0247), by the same rules - a channel's highlights or full game on the game, its source
-- not switched off and visible for the game; the game's own vetted YouTube stream - and the same reader's rights (a game
-- the reader may see, in a league they may see). No game JSON, no titles: a yes per game, cheap enough for every HOME
-- load. At most 200 games a call. Before this migration the cards simply show the pills they showed before.
-- ============================================================================
set local lock_timeout = '5s';

create or replace function public.games_watchable(p_games uuid[])
returns table (game uuid, kind text)
language sql stable security definer set search_path = public as $$
  with ok as (
    select g.id, g.status, g.stalled_since
      from games g
      join competitions co on co.id = g.competition_id
      join seasons se on se.id = co.season_id
     where g.id = any ((coalesce(p_games, '{}'::uuid[]))[1:200])
       and public.can_read_game(g.id) and public.league_visible(se.league_id)
  ),
  vids as (
    select i.game_id as game, i.video_kind as kind
      from news_items i
      join news_sources s on s.id = i.source_id
      join ok on ok.id = i.game_id
     where i.video_id is not null and i.video_kind in ('highlights', 'full')
       and s.video_mode <> 'off' and public.video_item_visible(s.id, i.game_id)
    union all
    select gv.game_id,
           case when ok.status in ('live', 'finalising') and ok.stalled_since is null then 'live' else 'full' end
      from game_videos gv
      join ok on ok.id = gv.game_id
     where gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$'
       and public.game_video_vetted(gv.id)
  )
  select v.game, (array_agg(v.kind order by case v.kind when 'live' then 0 when 'full' then 1 else 2 end))[1]
    from vids v
   group by v.game;
$$;

comment on function public.games_watchable(uuid[]) is
  '0255: which of these games (at most 200) have a video to play here, and the best kind (live | full | highlights) - '
  'game_watch''s videos and rules, without its game JSON; the fixture cards'' WATCH pill (watch.js site()).';

alter function public.games_watchable(uuid[]) owner to postgres;
revoke all on function public.games_watchable(uuid[]) from public;
grant execute on function public.games_watchable(uuid[]) to anon, authenticated, service_role;
