-- ============================================================================
-- 0245 - A LEAGUE'S OWN CHANNEL, ITS VIDEOS ON ITS GAMES (2026-10-07)
--
-- A league's stream destination (0081 league_stream_targets) names the YouTube channel its games go out on
-- (channel_ref, 0083): a game on now embeds it live. What the channel keeps afterwards - each game's stream, its
-- highlight reels - was never read. Now each YouTube destination has a switch, as a channel added under Creators &
-- news sources has (0237 video_mode):
--     'none'        its videos are not read (as before this file)
--     'highlights'  a video of a game is that game's highlights: the league's Video tab, the game page, HOME's VIDEO
--     'seeking'     a video of a game is the whole game: the game's video, seeked to each play once the clock is read
--                   (a video titled highlights stays highlights)
-- Behind the switch is an ordinary news source of the league, the channel's feed: the reader (scripts/news, the
-- news-refresh function) and the video matcher (club names, 0240) treat it as any other channel. A channel the
-- league reads already is used, not added twice; 'none' switches that source off (its videos leave the pages; the
-- games keep a stream already put on them). The source is remembered on the destination (video_source_id).
-- ============================================================================
set local lock_timeout = '5s';

alter table public.league_stream_targets
  add column if not exists video_source_id uuid references public.news_sources(id) on delete set null;
comment on column public.league_stream_targets.video_source_id is
  '0245: the news source that reads this destination''s YouTube channel for its games'' videos, when its videos are on.';

/* THE CONSOLE'S READ: each YouTube destination of a league, what its videos are for, and how many it has */
create or replace function public.stream_target_videos(p_league uuid)
returns table (id uuid, video_mode text, source_slug text, videos int, matched int)
language sql stable security definer set search_path = public as $$
  select t.id,
         case when s.id is null or not s.enabled then 'none' else s.video_mode end,
         s.slug,
         coalesce((select count(*)::int from news_items i where i.source_id = s.id and i.video_id is not null), 0),
         coalesce((select count(*)::int from news_items i where i.source_id = s.id and i.game_id is not null), 0)
    from league_stream_targets t
    left join news_sources s on s.id = t.video_source_id
   where t.league_id = p_league and t.platform = 'youtube'
     and (public.is_platform_admin() or public.is_league_admin(t.league_id))
   order by t.created_at;
$$;

/* THE SWITCH. p_mode: 'none', 'highlights' or 'seeking'. -> { mode, source, slug } */
create or replace function public.set_stream_target_videos(p_target uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t    league_stream_targets%rowtype;
  src  uuid;
  feed text;
  site text;
  nm   text;
  sl   text;
  n    int := 1;
begin
  select * into t from league_stream_targets where id = p_target;
  if not found or not (public.is_platform_admin() or public.is_league_admin(t.league_id)) then
    raise exception 'you cannot change that destination' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('none', 'highlights', 'seeking') then
    raise exception 'a channel''s videos are none, highlights or seeking' using errcode = '22023';
  end if;
  if p_mode = 'none' then
    if t.video_source_id is not null then
      update news_sources set enabled = false where id = t.video_source_id;
    end if;
    insert into audit_log (actor, action, subject, subject_id, detail)
    values (auth.uid(), 'set_stream_target_videos', 'league_stream_target', t.id::text, jsonb_build_object('mode', p_mode));
    return jsonb_build_object('mode', 'none', 'source', t.video_source_id);
  end if;
  if t.platform <> 'youtube' or coalesce(t.channel_ref, '') !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'give this destination its YouTube channel id (it starts UC) first' using errcode = '22023';
  end if;

  feed := 'https://www.youtube.com/feeds/videos.xml?channel_id=' || t.channel_ref;
  site := 'https://www.youtube.com/channel/' || t.channel_ref;
  src := t.video_source_id;
  if src is not null and not exists (select 1 from news_sources where id = src) then src := null; end if;
  if src is null then
    /* the league reads this channel already (Creators & news sources): that source, not a second one */
    select s.id into src from news_sources s
     where s.league_id = t.league_id
       and (s.feed_url = feed or s.site_url = site or s.resolve_from = site
            or s.feed_url ~ ('[?&]channel_id=' || t.channel_ref || '($|&)'))
     order by s.created_at
     limit 1;
  end if;
  if src is null then
    select left(l.name, 68) || ' · YouTube' into nm from leagues l where l.id = t.league_id;
    nm := coalesce(nm, 'YouTube');
    sl := public.creator_slug(nm, 'source');
    while exists (select 1 from news_sources x where x.slug = sl) loop
      n := n + 1;
      sl := left(public.creator_slug(nm, 'source'), 55) || '-' || n;
    end loop;
    insert into news_sources (league_id, slug, name, site_url, feed_url, kind, platform, name_auto, added_by, video_mode, enabled)
    values (t.league_id, sl, nm, site, feed, 'creator', 'youtube', true, auth.uid(), p_mode, true)
    returning id into src;
  else
    update news_sources set video_mode = p_mode, enabled = true where id = src;
  end if;
  update league_stream_targets set video_source_id = src where id = t.id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_stream_target_videos', 'league_stream_target', t.id::text,
          jsonb_build_object('mode', p_mode, 'source', src));
  return jsonb_build_object('mode', p_mode, 'source', src, 'slug', (select slug from news_sources where id = src));
end $$;

alter function public.stream_target_videos(uuid) owner to postgres;
alter function public.set_stream_target_videos(uuid, text) owner to postgres;
revoke all on function public.stream_target_videos(uuid) from public, anon;
revoke all on function public.set_stream_target_videos(uuid, text) from public, anon;
grant execute on function public.stream_target_videos(uuid) to authenticated;
grant execute on function public.set_stream_target_videos(uuid, text) to authenticated;
