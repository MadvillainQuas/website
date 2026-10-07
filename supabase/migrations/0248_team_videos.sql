-- ============================================================================
-- 0248 - A CLUB'S VIDEOS, ON ITS PAGE (2026-10-07)
--
-- The club page's Video tab opens on HOME's VIDEO dashboard in the club's own version (home/videohub.js, club mode):
-- LIVE while the club is playing, and under it the club's videos under the same five buttons - ALL, HIGHLIGHTS, FULL
-- GAMES, PRESS CONFERENCES, VIDEOS - played in the cinema player as one list. What is the club's:
--     * a channel's video on one of its games (news_items.game_id: the video matcher's, or a person's), of any kind;
--     * a channel's video whose title names it (news_items.match_clubs, 0240: the clubs the matcher found in the title)
--       - a press conference, an interview, a feature;
--     * FULL GAMES: its finished games' own streams too, when vetted (0247 game_video_vetted), as video_full_games.
-- In video_feed's columns (newscard.js, media.js take the rows as they are), newest first; a video in both is listed
-- once, as the channel's. Only what the reader may see, as video_feed and video_full_games.
-- ============================================================================
set local lock_timeout = '5s';

create or replace function public.team_videos(p_team uuid, p_kind text default null, p_before timestamptz default null,
                                              p_limit int default 40)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb, video_id text, video_kind text, game jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 40), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before),
  items as (
    select case when s.kind = 'creator' then 'channel' else 'outlet' end as kind, i.id, i.title, i.summary, i.image_url,
           i.url, i.published_at, s.name as source_name, s.logo_url as source_logo, s.colour as source_colour,
           s.site_url as source_url, s.slug as source_slug, coalesce(gl.slug, l.slug, t.slug) as league_slug,
           coalesce(gl.name, l.name, t.name) as league_name, null::text as outlet_slug, null::text as slug,
           'youtube'::text as piece_kind, i.author,
           public.news_item_leagues(case when gl.id is null then i.league_ids else array_prepend(gl.id, i.league_ids) end,
                                    s.league_id) as leagues,
           i.video_id, i.video_kind, case when i.game_id is not null then public.video_game_json(i.game_id) end as game,
           0 as pref
      from news_items i join news_sources s on s.id = i.source_id
           left join leagues l on l.id = s.league_id left join leagues t on t.id = i.league_ids[1]
           left join leagues gl on gl.id = public.game_league_id(i.game_id)
           left join games g on g.id = i.game_id, lim
     where i.video_id is not null and s.video_mode <> 'off' and i.published_at < lim.before
       and (g.home_team_id = p_team or g.away_team_id = p_team or p_team = any (coalesce(i.match_clubs, '{}'::uuid[])))
       and (p_kind is null or (p_kind = 'highlights' and i.video_kind = 'highlights')
            or (p_kind = 'full' and i.video_kind = 'full') or (p_kind = 'press' and i.video_kind = 'press')
            or (p_kind = 'video' and coalesce(i.video_kind, 'video') = 'video'))
       and public.video_item_visible(s.id, i.game_id)
     order by i.published_at desc
     limit 60
  ),
  streams as (
    select 'channel'::text as kind, gv.id, left(coalesce(h.name, 'Home') || ' v ' || coalesce(a.name, 'Away'), 200) as title,
           co.name as summary, null::text as image_url,
           coalesce(nullif(gv.url, ''), 'https://www.youtube.com/watch?v=' || gv.video_ref) as url,
           coalesce(g.tipoff_at, gv.created_at) as published_at,
           l.name as source_name, l.logo_path as source_logo, l.colour_a as source_colour, null::text as source_url,
           null::text as source_slug, l.slug as league_slug, l.name as league_name, null::text as outlet_slug, null::text as slug,
           'youtube'::text as piece_kind, null::text as author, public.news_item_leagues(array[l.id], l.id) as leagues,
           gv.video_ref as video_id, 'full'::text as video_kind, public.video_game_json(g.id) as game, 1 as pref
      from game_videos gv
      join games g on g.id = gv.game_id
      join competitions co on co.id = g.competition_id
      join seasons se on se.id = co.season_id
      join leagues l on l.id = se.league_id
      left join teams h on h.id = g.home_team_id
      left join teams a on a.id = g.away_team_id, lim
     where (p_kind is null or p_kind = 'full') and (g.home_team_id = p_team or g.away_team_id = p_team)
       and gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$'
       and public.game_video_vetted(gv.id)
       and g.status = 'final' and coalesce(g.tipoff_at, gv.created_at) < lim.before
       and public.league_visible(l.id) and public.can_read_game(g.id)
     order by coalesce(g.tipoff_at, gv.created_at) desc
     limit 40
  ),
  one as (
    select distinct on (u.video_id) u.*
      from (select * from items union all select * from streams) u
     order by u.video_id, u.pref
  )
  select o.kind, o.id, o.title, o.summary, o.image_url, o.url, o.published_at, o.source_name, o.source_logo, o.source_colour,
         o.source_url, o.source_slug, o.league_slug, o.league_name, o.outlet_slug, o.slug, o.piece_kind, o.author, o.leagues,
         o.video_id, o.video_kind, o.game
    from one o
   order by o.published_at desc, o.id
   limit (select n from lim);
$$;

alter function public.team_videos(uuid, text, timestamptz, int) owner to postgres;
revoke all on function public.team_videos(uuid, text, timestamptz, int) from public;
grant execute on function public.team_videos(uuid, text, timestamptz, int) to anon, authenticated;
