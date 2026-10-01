-- ============================================================================
-- 0207: A LEAGUE'S CONTENT CREATORS - the creators the platform assigns to a league, on its Community page
--
-- A creator added for every reader (a news source of kind 'creator' with no league of its own, 0198: a YouTube
-- channel, a podcast, a Substack...) reached a league's pages only through the tags its posts earn by naming the
-- league (news_items.league_ids, read from the words). The platform now says which leagues each creator covers, in
-- its console, and the league's Community page (community/?l=) shows the newest from them under CONTENT CREATORS:
--
--   news_sources.assigned_leagues           the leagues the platform assigned it to; empty for none (the default)
--   set_news_source_leagues(id, leagues)    a platform administrator only, and a source for every reader only (a
--                                           league's own source is its league's already). The leagues are kept once
--                                           each, in the order given; one that does not exist is dropped. Audit-
--                                           logged. Returns what is now stored.
--   news_sources_admin(league)              0198's console list, with assigned_leagues: [{id, slug, name}] (dropped
--                                           and made again: its table gains a column)
--   league_creator_feed(league, before, n)  PUBLIC: the newest from the league's content creators, in news_feed's
--                                           rows (newscard.js fromFeed draws them):
--       'channel'  the posts of the creators assigned to the league, and of the league's own creators (a source of
--                  kind 'creator' the league added itself, 0198);
--       'creator'  the pieces of the league's creator outlets (0194), where the league shows its creators.
--
-- Only creators: a publisher is never in it, assigned or not. Switch one to a creator (set_news_source_kind) and it
-- is; its assignment is kept across the switch. A source that is off, an outlet that is suspended, a piece that is
-- hidden, a league the reader may not see: nothing. news_feed and news_feed_mine are not changed, so the News page
-- and HOME's feed read as they did.
--
-- Re-runnable.
-- ============================================================================

alter table public.news_sources add column if not exists assigned_leagues uuid[] not null default '{}';
comment on column public.news_sources.assigned_leagues is
  '0207: the leagues the platform assigned this creator to (set_news_source_leagues): its posts show under Content creators on each one''s Community page.';

/* ASSIGN A CREATOR TO LEAGUES, or to none: the whole list each time, as the console holds it */
create or replace function public.set_news_source_leagues(p_id uuid, p_leagues uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare v_own uuid; found_ boolean; v uuid[];
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can assign a creator to leagues' using errcode = '42501';
  end if;
  select s.league_id, true into v_own, found_ from news_sources s where s.id = p_id;
  if not coalesce(found_, false) then
    raise exception 'there is no such source here' using errcode = '22023';
  end if;
  if v_own is not null then
    raise exception 'a league''s own source is its league''s already: only a source for every reader is assigned to leagues' using errcode = '22023';
  end if;
  select coalesce(array_agg(x.id order by x.at), '{}'::uuid[]) into v
    from (select l.id, min(u.at) as at
            from unnest(coalesce(p_leagues, '{}'::uuid[])) with ordinality as u (id, at)
            join leagues l on l.id = u.id
           group by l.id) x;
  update news_sources set assigned_leagues = v where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_news_source_leagues', 'news_source', p_id::text, jsonb_build_object('leagues', to_jsonb(v)));
  return v;
end $$;

/* THE CONSOLE'S LIST (0198's), with the leagues each source is assigned to, by name, in the order they were given */
drop function if exists public.news_sources_admin(uuid);
create or replace function public.news_sources_admin(p_league uuid)
returns table (id uuid, slug text, name text, site_url text, feed_url text, logo_url text, colour text, enabled boolean,
               last_fetched_at timestamptz, last_ok_at timestamptz, last_error text, item_count integer,
               kind text, platform text, resolve_from text, assigned_leagues jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot see the news sources here' using errcode = '42501';
  end if;
  return query
    select s.id, s.slug, s.name, s.site_url, s.feed_url, s.logo_url, s.colour, s.enabled,
           s.last_fetched_at, s.last_ok_at, s.last_error, s.item_count, s.kind, s.platform, s.resolve_from,
           coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name) order by u.at)
                       from unnest(s.assigned_leagues) with ordinality as u (id, at) join leagues l on l.id = u.id), '[]'::jsonb)
      from news_sources s
     where s.league_id is not distinct from p_league
     order by s.name;
end $$;

/* THE COMMUNITY PAGE'S CONTENT CREATORS: news_feed's rows, newest first, a page at a time (p_before: the last one's
   published_at), 60 at most */
create or replace function public.league_creator_feed(p_league uuid, p_before timestamptz default null, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb)
language sql stable security definer set search_path = public as $$
  with lg as (select l.id, l.slug, l.name, l.colour_a, l.logo_path from leagues l
               where l.id = p_league and public.league_visible(l.id)),
       lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before)
  select * from (
    (select 'creator'::text, p.id, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at,
            o.name, o.logo_url, o.colour, null::text, null::text, lg.slug, lg.name, o.slug, p.slug, p.kind, p.author_name,
            jsonb_build_array(jsonb_build_object('slug', lg.slug, 'name', lg.name, 'colour', lg.colour_a, 'logo', lg.logo_path))
       from creator_posts p join creator_outlets o on o.id = p.outlet_id, lg, lim
      where p.league_id = lg.id and p.status = 'published' and not p.hidden and o.status = 'active'
        and p.published_at < lim.before and public.creators_shown(lg.id)
      order by p.published_at desc limit (select n from lim))
    union all
    (select 'channel'::text, i.id, i.title, i.summary, i.image_url, i.url, i.published_at,
            s.name, s.logo_url, s.colour, s.site_url, s.slug, lg.slug, lg.name,
            null::text, null::text, s.platform, i.author,
            public.news_item_leagues(i.league_ids, s.league_id)
       from news_items i join news_sources s on s.id = i.source_id, lg, lim
      where s.enabled and s.kind = 'creator' and i.published_at < lim.before
        and (s.league_id = lg.id or (s.league_id is null and s.assigned_leagues @> array[lg.id]))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.set_news_source_leagues(uuid, uuid[]) from public, anon;
grant execute on function public.set_news_source_leagues(uuid, uuid[]) to authenticated;
revoke all on function public.news_sources_admin(uuid) from public, anon;
grant execute on function public.news_sources_admin(uuid) to authenticated;
revoke all on function public.league_creator_feed(uuid, timestamptz, int) from public;
grant execute on function public.league_creator_feed(uuid, timestamptz, int) to anon, authenticated;
