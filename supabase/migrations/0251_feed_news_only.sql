-- ============================================================================
-- 0251 - THE FEED IS NEWS; THE VIDEOS ARE THE VIDEO SECTION'S (2026-10-07)
--
-- HOME's feed, a league's front-page news and the News page listed a YouTube channel's videos among the stories (a
-- creator's as video cards, a publisher's channel as plain stories). They have their own places now - HOME's VIDEO
-- view, a league's Video tab, a club's Video tab, the game page - so the news reads leave them out: no item with a
-- video id, none from a YouTube source, none whose address is YouTube's. Everything else about the three reads is as
-- it was (each copied from its last migration, 0209 and 0236, with that one condition).
-- ============================================================================
set local lock_timeout = '5s';

create or replace function public.news_feed(p_league uuid default null, p_before timestamptz default null, p_limit int default 30,
                                            p_kinds text[] default null)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before)
  select * from (
    (select 'league'::text, a.id, a.title, a.standfirst, a.cover_path, null::text, a.published_at,
            l.name, l.logo_path, l.colour_a, null::text, null::text, l.slug, l.name, null::text, a.slug, null::text, a.author_name,
            '[]'::jsonb
       from news_articles a join leagues l on l.id = a.league_id, lim
      where a.status = 'published' and a.published_at < lim.before and (p_kinds is null or 'league' = any (p_kinds))
        and (p_league is null or a.league_id = p_league) and public.league_visible(a.league_id)
      order by a.published_at desc limit (select n from lim))
    union all
    (select 'creator'::text, p.id, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at,
            o.name, o.logo_url, o.colour, null::text, null::text, l.slug, l.name, o.slug, p.slug, p.kind, p.author_name,
            jsonb_build_array(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
       from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = p.league_id, lim
      where p.status = 'published' and not p.hidden and o.status = 'active' and p.published_at < lim.before
        and (p_kinds is null or 'creator' = any (p_kinds))
        and (p_league is null or p.league_id = p_league) and public.creators_shown(p.league_id)
      order by p.published_at desc limit (select n from lim))
    union all
    (select case when s.kind = 'creator' then 'channel' else 'outlet' end, i.id, i.title, i.summary, i.image_url, i.url, i.published_at,
            s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(l.slug, t.slug), coalesce(l.name, t.name),
            null::text, null::text, case when s.kind = 'creator' then s.platform end, i.author,
            public.news_item_leagues(i.league_ids, s.league_id)
       from news_items i join news_sources s on s.id = i.source_id left join leagues l on l.id = s.league_id
            left join leagues t on t.id = i.league_ids[1], lim
      where s.enabled and i.published_at < lim.before
        and i.video_id is null and coalesce(s.platform, '') <> 'youtube'
        and coalesce(i.url, '') !~* '^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/'     -- 0251: news, not videos
        and (p_kinds is null or (case when s.kind = 'creator' then 'channel' else 'outlet' end) = any (p_kinds))
        and (s.league_id is null or public.league_visible(s.league_id))
        and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids)
                                   or (s.league_id is null and p_league = any (s.assigned_leagues)))     -- 0209
                                  and public.league_visible(p_league)))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

create or replace function public.news_feed_mine(p_before timestamptz default null, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select f.fav_league_ids || coalesce((select array_agg(distinct t.league_id) from teams t
                                          where t.id = any (f.fav_team_ids) and t.league_id is not null), '{}') as leagues,
           f.fav_outlet_ids as outlets, f.fav_source_ids as sources
      from fan_prefs f where f.user_id = auth.uid()
  ), lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n, coalesce(p_before, 'infinity'::timestamptz) as before)
  select * from (
    (select 'league'::text, a.id, a.title, a.standfirst, a.cover_path, null::text, a.published_at,
            l.name, l.logo_path, l.colour_a, null::text, null::text, l.slug, l.name, null::text, a.slug, null::text, a.author_name,
            '[]'::jsonb
       from news_articles a join leagues l on l.id = a.league_id, me, lim
      where a.status = 'published' and a.published_at < lim.before and a.league_id = any (me.leagues)
        and public.league_visible(a.league_id)
      order by a.published_at desc limit (select n from lim))
    union all
    (select 'creator'::text, p.id, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at,
            o.name, o.logo_url, o.colour, null::text, null::text, l.slug, l.name, o.slug, p.slug, p.kind, p.author_name,
            jsonb_build_array(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
       from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = p.league_id, me, lim
      where p.status = 'published' and not p.hidden and o.status = 'active' and p.published_at < lim.before
        and (o.id = any (me.outlets) or p.league_id = any (me.leagues)) and public.creators_shown(p.league_id)
      order by p.published_at desc limit (select n from lim))
    union all
    (select case when s.kind = 'creator' then 'channel' else 'outlet' end, i.id, i.title, i.summary, i.image_url, i.url, i.published_at,
            s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(l.slug, t.slug), coalesce(l.name, t.name),
            null::text, null::text, case when s.kind = 'creator' then s.platform end, i.author,
            public.news_item_leagues(i.league_ids, s.league_id)
       from news_items i join news_sources s on s.id = i.source_id left join leagues l on l.id = s.league_id
            left join leagues t on t.id = i.league_ids[1], me, lim
      where s.enabled and i.published_at < lim.before
        and i.video_id is null and coalesce(s.platform, '') <> 'youtube'
        and coalesce(i.url, '') !~* '^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/'     -- 0251: news, not videos
        and (s.id = any (me.sources) or s.league_id = any (me.leagues) or i.league_ids && me.leagues
             or (s.league_id is null and s.assigned_leagues && me.leagues))                            -- 0209
        and (s.league_id is null or public.league_visible(s.league_id))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

create or replace function public.news_feed_partners(p_league uuid default null, p_days int default 9, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      now() - make_interval(days => greatest(1, least(coalesce(p_days, 9), 14))) as since)
  select * from (
    (select 'creator'::text, p.id, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at,
            o.name, o.logo_url, o.colour, null::text, null::text, l.slug, l.name, o.slug, p.slug, p.kind, p.author_name,
            jsonb_build_array(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
       from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = p.league_id, lim
      where o.official_partner and p.status = 'published' and not p.hidden and o.status = 'active'
        and p.published_at >= lim.since and p.published_at <= now()
        and (p_league is null or p.league_id = p_league) and public.creators_shown(p.league_id)
      order by p.published_at desc limit (select n from lim))
    union all
    (select case when s.kind = 'creator' then 'channel' else 'outlet' end, i.id, i.title, i.summary, i.image_url, i.url, i.published_at,
            s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(l.slug, t.slug), coalesce(l.name, t.name),
            null::text, null::text, case when s.kind = 'creator' then s.platform end, i.author,
            public.news_item_leagues(i.league_ids, s.league_id)
       from news_items i join news_sources s on s.id = i.source_id left join leagues l on l.id = s.league_id
            left join leagues t on t.id = i.league_ids[1], lim
      where s.official_partner and s.enabled and i.video_id is null and coalesce(s.platform, '') <> 'youtube'
        and coalesce(i.url, '') !~* '^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/' and     -- 0251: news, not videos
            i.published_at >= lim.since and i.published_at <= now()
        and (s.league_id is null or public.league_visible(s.league_id))
        and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids)
                                   or (s.league_id is null and p_league = any (s.assigned_leagues)))
                                  and public.league_visible(p_league)))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;
