-- ============================================================================
-- 0242 - EVERY GAME STREAMING NOW, ACROSS THE LEAGUES (2026-10-07)
--
-- HOME's VIDEO view opens on LIVE: every game on now that has a stream to watch, whichever league it is in. A stream is
-- what the league's Live tab (0237 league_media) already plays: the game's own video (game_videos, the primary one: a
-- broadcast the ingest found, or a channel's video the video matcher put on the game in 'seeking' mode), or else the
-- league's channel, live (league_channel_for_game). A game with neither is not listed: there is nothing to watch.
--
-- Each game comes as league_media's do (video_game_json: the clubs, the score, the league) with its video, its channel
-- and whether its chat is open (chat_open_league), newest tip-off last. Only what the reader may see: a game they can
-- read, in a league they can see. One small read, made when HOME's VIDEO view opens and every minute while it is open
-- and looked at, and once when HOME is idle (the LIVE mark on the VIDEO tab).
-- ============================================================================
set local lock_timeout = '5s';

create or replace function public.live_streams()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.tipoff_at), '[]'::jsonb)
    from (
      select g.tipoff_at,
             public.video_game_json(g.id) || jsonb_build_object(
               'video', v.v, 'channel', c.c, 'chat', public.chat_open_league(g.id)) as j
        from games g
        join competitions co on co.id = g.competition_id
        join seasons se on se.id = co.season_id
        left join lateral (select jsonb_build_object('provider', gv.provider, 'ref', gv.video_ref, 'url', gv.url, 'live', gv.is_live) as v
                             from game_videos gv where gv.game_id = g.id and gv.is_primary limit 1) v on true
        left join lateral (select jsonb_build_object('platform', lc.platform, 'ref', lc.channel_ref) as c
                             from public.league_channel_for_game(g.id) lc limit 1) c on true
       where g.status in ('live', 'finalising') and g.stalled_since is null
         and g.tipoff_at > now() - interval '8 hours'
         and (v.v is not null or c.c is not null)
         and public.league_visible(se.league_id) and public.can_read_game(g.id)
       order by g.tipoff_at desc
       limit 24
    ) x;
$$;

alter function public.live_streams() owner to postgres;
revoke all on function public.live_streams() from public;
grant execute on function public.live_streams() to anon, authenticated;
