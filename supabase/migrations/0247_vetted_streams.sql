-- ============================================================================
-- 0247 - ONLY VETTED STREAMS ON LIVE (2026-10-07)
--
-- HOME's LIVE showed "KP Brno Women vs Slovanka Women Live Score" from a channel nobody had registered - an animated
-- scoreboard, not the game. The ingest's broadcast finder (scripts/ingest/auto_video.py) searched the whole of YouTube
-- for a fixture's two clubs when the league's own channel had nothing, and attached whatever matched. It searches the
-- registered channels alone from now on; and what is already attached is shown only when it is VETTED:
--     * a person put it on the game (game_videos.created_by: the game page's attach, the console), or
--     * it is from a channel the league registered (game_videos.channel_ref, written by the ingest from now on, among
--       vetted_channels: the ingest's own channel for the league - schedule_sources.adapter_config.youtube_channel -,
--       the league's stream destinations - league_stream_targets.channel_ref -, and its YouTube sources under
--       Creators & news sources, the platform's assigned to it among them), or
--     * it is a video of a registered source that the video matcher put on the game (news_items.video_id).
-- An unvetted stream is not deleted: the game page still has it for the league's people to judge; LIVE, the league's
-- Live tab, FULL GAMES and WATCH HERE pass it over. The league's channel itself, live (league_channel_for_game), is the
-- league's own registration and stays.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.game_videos add column if not exists channel_ref text;
comment on column public.game_videos.channel_ref is
  '0247: the YouTube channel (UC...) the video is on, as the ingest found it; a stream is vetted when this is one of its league''s registered channels (vetted_channels).';

/* THE CHANNELS A LEAGUE HAS REGISTERED: its ingest's channel, its stream destinations, its YouTube sources */
create or replace function public.vetted_channels(p_league uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c), '{}')
    from (select s.adapter_config->>'youtube_channel' as c from schedule_sources s where s.league_id = p_league
          union all
          select t.channel_ref from league_stream_targets t
           where t.league_id = p_league and t.active and t.platform = 'youtube'
          union all
          select substring(n.feed_url from '[?&]channel_id=(UC[A-Za-z0-9_-]{22})') from news_sources n
           where n.enabled and n.video_mode <> 'off'
             and (n.league_id = p_league or (n.league_id is null and p_league = any (n.assigned_leagues)))) x
   where c ~ '^UC[A-Za-z0-9_-]{22}$';
$$;

/* the same, for one game's league: what the ingest searches, and nothing else */
create or replace function public.vetted_channels_for_game(p_game uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select public.vetted_channels(se.league_id)
    from games g join competitions co on co.id = g.competition_id join seasons se on se.id = co.season_id
   where g.id = p_game;
$$;

/* IS THIS STREAM VETTED? A person put it there, or it is on a registered channel, or a registered source's video */
create or replace function public.game_video_vetted(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from game_videos gv
      join games g on g.id = gv.game_id
      join competitions co on co.id = g.competition_id
      join seasons se on se.id = co.season_id
     where gv.id = p_id
       and (gv.created_by is not null
            or (gv.channel_ref is not null and gv.channel_ref = any (public.vetted_channels(se.league_id)))
            or (gv.provider = 'youtube' and gv.video_ref <> '' and exists (
                  select 1 from news_items i join news_sources s on s.id = i.source_id
                   where i.video_id = gv.video_ref and s.enabled and s.video_mode <> 'off'))));
$$;

-- ------------------------------------------------------------- the reads, each its own definition and the one rule ---
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
                             from game_videos gv where gv.game_id = g.id and gv.is_primary and public.game_video_vetted(gv.id) limit 1) v on true
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


create or replace function public.league_media(p_league uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'highlights', exists (select 1 from public.league_videos(p_league, 'highlights', null, 1)),
    'live', coalesce((
      select jsonb_agg(public.video_game_json(g.id) || jsonb_build_object(
               'video', (select jsonb_build_object('provider', v.provider, 'ref', v.video_ref, 'url', v.url, 'live', v.is_live)
                           from game_videos v where v.game_id = g.id and v.is_primary and public.game_video_vetted(v.id) limit 1),
               'channel', (select jsonb_build_object('platform', c.platform, 'ref', c.channel_ref)
                             from public.league_channel_for_game(g.id) c limit 1))
             order by g.tipoff_at)
        from games g join competitions co on co.id = g.competition_id join seasons se on se.id = co.season_id
       where se.league_id = p_league and g.status in ('live', 'finalising') and g.stalled_since is null
         and g.tipoff_at > now() - interval '8 hours' and public.can_read_game(g.id)), '[]'::jsonb),
    'chat', exists (select 1 from leagues l where l.id = p_league and l.chat_enabled and coalesce(l.go_photos, true)
                     and l.visibility = 'public' and l.access_mode = 'open'))
  where public.league_visible(p_league);
$$;


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
     where gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$' and public.game_video_vetted(gv.id)
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
       and gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$' and public.game_video_vetted(gv.id)
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
     where gv.game_id = ok.id and gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$' and public.game_video_vetted(gv.id)
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

alter function public.vetted_channels(uuid) owner to postgres;
alter function public.vetted_channels_for_game(uuid) owner to postgres;
alter function public.game_video_vetted(uuid) owner to postgres;
revoke all on function public.vetted_channels(uuid) from public, anon, authenticated;
revoke all on function public.vetted_channels_for_game(uuid) from public, anon, authenticated;
revoke all on function public.game_video_vetted(uuid) from public;
grant execute on function public.vetted_channels(uuid) to service_role;
grant execute on function public.vetted_channels_for_game(uuid) to service_role;
grant execute on function public.game_video_vetted(uuid) to anon, authenticated, service_role;
