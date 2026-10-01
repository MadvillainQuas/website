-- ============================================================================
-- 0209: A LEAGUE PICKS FROM THE PLATFORM'S PUBLISHERS AND CREATORS
--
-- The platform's console reads publishers and creators for every reader (news sources with no league: a site
-- that covers everything, a YouTube channel, a podcast...), and since 0207 gives each creator the leagues it
-- covers. A league's administrators could only add sources of their own, by link: the same feed read twice, and
-- every story of it twice in every reader's News. Now the league's console lists the platform's sources too,
-- and a league picks the ones it wants:
--
--   news_sources_offered(league)          the platform's sources, for a league's administrators (and the
--                                         platform's): every one that is on, and any the league has picked even
--                                         if the platform has since switched it off (so it can be taken off),
--                                         each saying whether the league has it (picked), the ones it has first.
--   set_league_news_source(league, id, on)
--                                         puts the league into the source's assigned_leagues (0207), or takes it
--                                         out: that league only, never another's. A source for every reader
--                                         only (a league's own is its league's already); one the platform has
--                                         switched off is not picked. Audit-logged when it changes. Returns
--                                         whether the league has it now.
--
-- ONE LIST, TWO HANDS. assigned_leagues is the list the platform's COVERS row writes (0207), whole, and the one a
-- league writes, its own league only. Whoever put a league there, a source in it reads on that league's pages
-- as one of the league's own:
--
--   news_feed(league)                     every story of it under "Around the league" on the league's news
--                                         page (news/?l=), not only the ones that name the league   -- 0209
--   news_sources_public(league)           in the row of the league's sources there                   -- 0209
--   news_feed_mine                        in the feed of everyone who follows the league             -- 0209
--   league_creator_feed(league)           a creator's posts under Content creators on the league's Community
--                                         page (0207's, unchanged; a publisher never)
--
-- Those three are 0198's (latest) with the one line tagged "-- 0209"; same signatures, same grants. A story's
-- league tags (news_item_leagues) are not changed: a site that covers everything does not wear the badge of
-- every league that picked it. Nothing new is fetched and nobody new is notified (notify_news_items tells a
-- source's own followers only). Re-runnable.
-- ============================================================================

/* THE PLATFORM'S SOURCES, as a league's console offers them */
create or replace function public.news_sources_offered(p_league uuid)
returns table (id uuid, slug text, name text, site_url text, feed_url text, resolve_from text, logo_url text, colour text,
               kind text, platform text, enabled boolean, item_count integer, last_at timestamptz, picked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_league is null or not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot pick news sources for that league' using errcode = '42501';
  end if;
  return query
    select s.id, s.slug, s.name, s.site_url, s.feed_url, s.resolve_from, s.logo_url, s.colour, s.kind, s.platform, s.enabled,
           s.item_count, (select max(i.published_at) from news_items i where i.source_id = s.id),
           p_league = any (s.assigned_leagues)
      from news_sources s
     where s.league_id is null and (s.enabled or p_league = any (s.assigned_leagues))
     order by (p_league = any (s.assigned_leagues)) desc, lower(s.name), s.id;
end $$;

/* A LEAGUE PICKS ONE, or puts it back: its own league only, one source at a time */
create or replace function public.set_league_news_source(p_league uuid, p_id uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_own uuid; v_enabled boolean; v_had boolean; found_ boolean; v_now boolean;
begin
  if p_league is null or not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot pick news sources for that league' using errcode = '42501';
  end if;
  if not exists (select 1 from leagues l where l.id = p_league) then
    raise exception 'there is no such league here' using errcode = '22023';
  end if;
  select s.league_id, s.enabled, p_league = any (s.assigned_leagues), true into v_own, v_enabled, v_had, found_
    from news_sources s where s.id = p_id for update;
  if not coalesce(found_, false) then
    raise exception 'there is no such source here' using errcode = '22023';
  end if;
  if v_own is not null then
    raise exception 'a league''s own source is its league''s already: only one of the platform''s is picked' using errcode = '22023';
  end if;
  if coalesce(p_on, false) and not v_had and not v_enabled then
    raise exception 'the platform has switched that source off: it cannot be picked' using errcode = '22023';
  end if;
  update news_sources s
     set assigned_leagues = case when coalesce(p_on, false)
                                 then case when p_league = any (s.assigned_leagues) then s.assigned_leagues else s.assigned_leagues || p_league end
                                 else array_remove(s.assigned_leagues, p_league) end
   where s.id = p_id
  returning p_league = any (s.assigned_leagues) into v_now;
  if v_now is distinct from v_had then
    insert into audit_log (actor, action, subject, subject_id, detail)
    values (auth.uid(), 'set_league_news_source', 'news_source', p_id::text, jsonb_build_object('league', p_league, 'on', v_now));
  end if;
  return v_now;
end $$;

/* ------------------------------------------------------- 0198's readers, a picked source as the league's own --- */

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
        and (s.id = any (me.sources) or s.league_id = any (me.leagues) or i.league_ids && me.leagues
             or (s.league_id is null and s.assigned_leagues && me.leagues))                            -- 0209
        and (s.league_id is null or public.league_visible(s.league_id))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

create or replace function public.news_sources_public(p_league uuid default null)
returns table (id uuid, slug text, name text, site_url text, logo_url text, colour text,
               league_slug text, league_name text, items bigint, last_at timestamptz, kind text, platform text)
language sql stable security definer set search_path = public as $$
  select s.id, s.slug, s.name, s.site_url, s.logo_url, s.colour, l.slug, l.name,
         (select count(*) from news_items i where i.source_id = s.id),
         (select max(i.published_at) from news_items i where i.source_id = s.id),
         s.kind, s.platform
    from news_sources s left join leagues l on l.id = s.league_id
   where s.enabled and exists (select 1 from news_items i where i.source_id = s.id)
     and (s.league_id is null or public.league_visible(s.league_id))
     and (p_league is null or ((s.league_id = p_league
                                or (s.league_id is null and p_league = any (s.assigned_leagues))                -- 0209
                                or exists (select 1 from news_items i where i.source_id = s.id and p_league = any (i.league_ids)))
                               and public.league_visible(p_league)))
   order by 10 desc nulls last, s.name;
$$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.news_sources_offered(uuid) from public, anon;
grant execute on function public.news_sources_offered(uuid) to authenticated;
revoke all on function public.set_league_news_source(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_league_news_source(uuid, uuid, boolean) to authenticated;
grant execute on function public.news_feed(uuid, timestamptz, int, text[]) to anon, authenticated;
revoke all on function public.news_feed_mine(timestamptz, int) from public, anon;
grant execute on function public.news_feed_mine(timestamptz, int) to authenticated;
grant execute on function public.news_sources_public(uuid) to anon, authenticated;
