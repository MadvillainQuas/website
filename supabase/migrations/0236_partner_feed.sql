-- ============================================================================
-- 0236 - THE OFFICIAL PARTNERS' RECENT STORIES, FOR THE FEED'S POOL (2026-10-06)
--
-- For you ranks a pool of candidates, and that pool was the newest 60 stories of everything. With many publishers a partner's
-- story of a few days ago was not in it, so the partner boost (feedrank.js: in full for a week, gone after nine days) had
-- nothing to lift: a partner named today showed nowhere. news_feed_partners() gives the page the partners' stories of the boost's
-- window, which it adds to the pool. The same columns as news_feed (0209), the same visibility rules; only official partners
-- (news_sources.official_partner, creator_outlets.official_partner), whatever their pill says (0235's label changes nothing here).
-- ============================================================================
set local lock_timeout = '5s';

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
      where s.official_partner and s.enabled and i.published_at >= lim.since and i.published_at <= now()
        and (s.league_id is null or public.league_visible(s.league_id))
        and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids)
                                   or (s.league_id is null and p_league = any (s.assigned_leagues)))
                                  and public.league_visible(p_league)))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;
revoke all on function public.news_feed_partners(uuid, int, int) from public;
grant execute on function public.news_feed_partners(uuid, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
