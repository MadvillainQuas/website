-- ============================================================================
-- 0244 - THE VIDEO VIEW'S LEAGUES, ITS FULL GAMES AND ITS PRESS CONFERENCES (2026-10-07)
--
-- HOME's VIDEO view lists the newest videos under five buttons: ALL, HIGHLIGHTS, FULL GAMES, PRESS CONFERENCES and
-- VIDEOS.
--
-- 0. A PRESS CONFERENCE IS A KIND OF ITS OWN: news_items.video_kind 'press' (scripts/news/videos.py classify: "Press
--    conference", "Rueda de prensa", "Pressekonferenz", "記者会見" ...), and the video matcher puts one on the game it
--    is about (before or after it) instead of leaving it on no game. The ones already read are called press
--    conferences here, and those of the last ten days still on no game go back to the matcher.
--
-- 1. video_feed (0237) learns the new buttons: p_kind
--        null          every video
--        'highlights'  a game's highlights
--        'full'        a whole game: a broadcast, a stream kept after it ended ("LIVE: ...", "Full game", a channel in
--                      'seeking' mode's videos of a game)
--        'press'       a press conference
--        'video'       everything else (before this file 'video' meant every video but the highlights)
--    The same columns, the same order, the same visibility as before.
--
-- 1b. game_highlights (0237, the game page's videos) gives every video on the game - its highlights, its whole game,
--    its press conferences - for the game page's video tab to play as one list, in that order.
--
-- 2. video_full_games: FULL GAMES. The channels' full games (video_feed 'full') and the games' own streams, kept on
--    the game once it is over (game_videos: the stream the ingest found, the league's broadcast, the channel's video
--    the matcher put on the game): a finished game with a YouTube video, as a video of the feed (its clubs for a title,
--    its league for a source, its box score). A video in both is listed once, as the channel's.
--
-- 3. video_leagues: the strip of leagues over the videos, on HIGHLIGHTS and FULL GAMES: a button for each league that
--    has some (its logo, its name, how many); a press shows that league's alone. The page puts the reader's leagues
--    first (followed, then the ones they read most: feedrank.js on the device); this says which leagues there are, how
--    many videos each has, and when the newest went up. A video is its game's league's when it is on a game, else its
--    channel's league's (else the first league it is tagged with); of the last 120 days; only what may be seen.
--
-- 4. game_watch: WATCH HERE - what one game has to watch on the site's own player, for a fixture's where-to-watch
--    card and for HOME's VIDEO view opened on that game.
-- ============================================================================
set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------- 0. press conferences ---
alter table public.news_items drop constraint if exists news_items_video_kind_check;
alter table public.news_items add constraint news_items_video_kind_check
  check (video_kind is null or video_kind in ('highlights', 'full', 'press', 'video'));
update public.news_items
   set video_kind = 'press',
       matched_at = case when published_at > now() - interval '10 days' then null else matched_at end
 where video_id is not null and game_id is null and video_kind = 'video'
   and title ~* '(press ?conference|presser|post-?game press|pre-?game press|rueda de prensa|conferencia de prensa|conf[eé]rence de presse|pressekonferenz|conferenza stampa|konferencja prasowa|presskonferens|persconferentie|lehdistötilaisuus|記者会見|기자회견|发布会)';

-- ------------------------------------------------------------------------------------------ 1. video_feed ---
create or replace function public.video_feed(p_league uuid default null, p_kind text default null,
                                             p_before timestamptz default null, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb, video_id text, video_kind text, game jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before)
  select case when s.kind = 'creator' then 'channel' else 'outlet' end, i.id, i.title, i.summary, i.image_url, i.url,
         i.published_at, s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(gl.slug, l.slug, t.slug),
         coalesce(gl.name, l.name, t.name), null::text, null::text, 'youtube'::text, i.author,
         public.news_item_leagues(case when gl.id is null then i.league_ids else array_prepend(gl.id, i.league_ids) end,
                                  s.league_id),
         i.video_id, i.video_kind,
         case when i.game_id is not null then public.video_game_json(i.game_id) end
    from news_items i join news_sources s on s.id = i.source_id
         left join leagues l on l.id = s.league_id left join leagues t on t.id = i.league_ids[1]
         left join leagues gl on gl.id = public.game_league_id(i.game_id), lim
   where i.video_id is not null and s.video_mode <> 'off' and i.published_at < lim.before
     and (p_kind is null or (p_kind = 'highlights' and i.video_kind = 'highlights')
          or (p_kind = 'full' and i.video_kind = 'full') or (p_kind = 'press' and i.video_kind = 'press')
          or (p_kind = 'video' and coalesce(i.video_kind, 'video') = 'video'))
     and public.video_item_visible(s.id, i.game_id)
     and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids) or gl.id = p_league
                                or (s.league_id is null and p_league = any (s.assigned_leagues)))
                               and public.league_visible(p_league)))
   order by i.published_at desc, i.id
   limit (select n from lim);
$$;

-- ------------------------------------------------------------------------------------ 1b. game_highlights ---
create or replace function public.game_highlights(p_game uuid)
returns table (id uuid, title text, url text, video_id text, video_kind text, image_url text, published_at timestamptz,
               source_name text, source_logo text, source_slug text)
language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.url, i.video_id, i.video_kind, i.image_url, i.published_at, s.name, s.logo_url, s.slug
    from news_items i join news_sources s on s.id = i.source_id
   where i.game_id = p_game and i.video_id is not null and s.video_mode <> 'off'
     and public.video_item_visible(s.id, p_game)
   order by case i.video_kind when 'highlights' then 0 when 'full' then 1 when 'press' then 2 else 3 end, i.published_at
   limit 12;
$$;

-- ------------------------------------------------------------------------------------ 2. video_full_games ---
create or replace function public.video_full_games(p_league uuid default null, p_before timestamptz default null,
                                                   p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb, video_id text, video_kind text, game jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before),
  items as (
    select v.*, 0 as pref from public.video_feed(p_league, 'full', p_before, 60) v
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
     where gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$'
       and g.status = 'final' and coalesce(g.tipoff_at, gv.created_at) < lim.before
       and (p_league is null or l.id = p_league)
       and public.league_visible(l.id) and public.can_read_game(g.id)
     order by coalesce(g.tipoff_at, gv.created_at) desc
     limit 60
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

-- ---------------------------------------------------------------------------------------- 3. video_leagues ---
create or replace function public.video_leagues(p_kind text default 'highlights')
returns table (id uuid, slug text, name text, logo text, colour text, videos int, newest timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (
    select coalesce(public.game_league_id(i.game_id), s.league_id, i.league_ids[1]) as league_id, i.video_id, i.published_at
      from news_items i join news_sources s on s.id = i.source_id
     where i.video_id is not null and s.video_mode <> 'off'
       and i.published_at > now() - interval '120 days'
       and (p_kind is null or (p_kind = 'highlights' and i.video_kind = 'highlights')
            or (p_kind = 'full' and i.video_kind = 'full') or (p_kind = 'press' and i.video_kind = 'press')
            or (p_kind = 'video' and coalesce(i.video_kind, 'video') = 'video'))
       and public.video_item_visible(s.id, i.game_id)
    union all
    /* FULL GAMES: the finished games' own streams too (video_full_games) */
    select se.league_id, gv.video_ref, coalesce(g.tipoff_at, gv.created_at)
      from game_videos gv
      join games g on g.id = gv.game_id
      join competitions co on co.id = g.competition_id
      join seasons se on se.id = co.season_id
     where (p_kind is null or p_kind = 'full')
       and gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$'
       and g.status = 'final' and coalesce(g.tipoff_at, gv.created_at) > now() - interval '120 days'
       and public.can_read_game(g.id)
  )
  select l.id, l.slug, l.name, l.logo_path, l.colour_a, count(distinct v.video_id)::int, max(v.published_at)
    from v join leagues l on l.id = v.league_id
   where public.league_visible(l.id)
   group by l.id, l.slug, l.name, l.logo_path, l.colour_a
   order by max(v.published_at) desc
   limit 80;
$$;

-- ------------------------------------------------------------------------------------------ 4. game_watch ---
/* WATCH HERE: what one game has to watch on the site's own player - asked when a fixture's WHERE TO WATCH card opens
   (watch.js), and by HOME's VIDEO view opened on that game (?view=video&play=<game>). The game streaming now, or its
   best video: the whole game (its stream kept, a channel's full game), else its highlights; the channel's copy of a
   video before the game's own. Null for a game the reader may not see.
     { game, live, video: { id, video_id, kind: 'live'|'full'|'highlights', title, source_name, published_at } | null,
       game_json } */
create or replace function public.game_watch(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with ok as (
    select g.id, g.status, g.stalled_since, coalesce(h.name, 'Home') || ' v ' || coalesce(a.name, 'Away') as title, l.name as league_name
      from games g
      join competitions co on co.id = g.competition_id
      join seasons se on se.id = co.season_id
      join leagues l on l.id = se.league_id
      left join teams h on h.id = g.home_team_id
      left join teams a on a.id = g.away_team_id
     where g.id = p_game and public.can_read_game(g.id) and public.league_visible(l.id)
  ),
  vids as (
    select i.id, i.video_id, i.video_kind as kind, i.title, s.name as source_name, i.published_at, 0 as src
      from news_items i join news_sources s on s.id = i.source_id, ok
     where i.game_id = ok.id and i.video_id is not null and i.video_kind in ('highlights', 'full')
       and s.video_mode <> 'off' and public.video_item_visible(s.id, i.game_id)
    union all
    select gv.id, gv.video_ref,
           case when ok.status in ('live', 'finalising') and ok.stalled_since is null then 'live' else 'full' end,
           ok.title, ok.league_name, gv.created_at, 1
      from game_videos gv, ok
     where gv.game_id = ok.id and gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$'
  )
  select case when not exists (select 1 from ok) then null else jsonb_build_object(
    'game', p_game,
    'live', exists (select 1 from ok where ok.status in ('live', 'finalising') and ok.stalled_since is null)
            and (exists (select 1 from vids where kind = 'live') or exists (select 1 from public.league_channel_for_game(p_game))),
    'video', (select jsonb_build_object('id', v.id, 'video_id', v.video_id, 'kind', v.kind, 'title', v.title,
                                        'source_name', v.source_name, 'published_at', v.published_at)
                from vids v
               order by case v.kind when 'live' then 0 when 'full' then 1 else 2 end, v.src, v.published_at desc
               limit 1),
    'game_json', public.video_game_json(p_game)) end;
$$;

alter function public.video_feed(uuid, text, timestamptz, int) owner to postgres;
alter function public.game_highlights(uuid) owner to postgres;
alter function public.video_full_games(uuid, timestamptz, int) owner to postgres;
alter function public.video_leagues(text) owner to postgres;
alter function public.game_watch(uuid) owner to postgres;
revoke all on function public.video_full_games(uuid, timestamptz, int) from public;
revoke all on function public.video_leagues(text) from public;
revoke all on function public.game_watch(uuid) from public;
grant execute on function public.video_feed(uuid, text, timestamptz, int) to anon, authenticated;
grant execute on function public.game_highlights(uuid) to anon, authenticated;
grant execute on function public.video_full_games(uuid, timestamptz, int) to anon, authenticated;
grant execute on function public.video_leagues(text) to anon, authenticated;
grant execute on function public.game_watch(uuid) to anon, authenticated;
