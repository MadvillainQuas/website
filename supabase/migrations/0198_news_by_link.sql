-- ============================================================================
-- 0198: ADD A PUBLISHER OR A CREATOR BY ITS LINK.
--
-- 0194 took a news source as its site and its feed, typed in. Most people know neither: they know the
-- YouTube channel, the podcast, the website. So a console now takes one link - whatever the person has -
-- and the reader (scripts/news/fetch_feeds.py) works out the feed behind it on its next read, then carries
-- on as for any source: every new post, every half hour, onto the News page and the followers' phones.
--
--   a feed (RSS, Atom, JSON Feed)        itself
--   a website                            the feed it names in its head, or the usual places (/feed, /rss…)
--   a YouTube channel or playlist        YouTube's own feed for it
--   an Apple Podcasts show               the show's feed, from Apple's public lookup
--   Substack, Medium, Bluesky, Mastodon  each one's public feed
--
-- Instagram, TikTok, X, Threads, Facebook and Spotify publish no feed that anyone may read without the
-- account owner's permission, so they are refused here with the reason (the console says what can be
-- done instead). Nothing is ever scraped.
--
-- PUBLISHER OR CREATOR. A source is now one or the other (news_sources.kind): a news site, or a person's
-- or a show's channel. A creator's posts come out of the News page's feeds as kind 'channel' - under
-- "Creators" rather than "Publishers" - and play on the site where they can (a video, an episode).
--
-- A SOURCE WAITING FOR ITS FIRST READ keeps the address it was given (resolve_from) and a stand-in name
-- (name_auto); the reader replaces both with the real feed and the feed's own name.
-- ============================================================================

alter table public.news_sources add column if not exists kind text not null default 'publisher';
alter table public.news_sources add column if not exists platform text;
alter table public.news_sources add column if not exists resolve_from text;
alter table public.news_sources add column if not exists name_auto boolean not null default false;
do $$ begin
  alter table public.news_sources add constraint news_sources_kind_ck check (kind in ('publisher', 'creator'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.news_sources add constraint news_sources_platform_ck
    check (platform is null or platform in ('feed', 'website', 'youtube', 'podcast', 'substack', 'medium', 'bluesky', 'mastodon'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.news_sources add constraint news_sources_resolve_ck
    check (resolve_from is null or (resolve_from ~* '^https?://[^\s<>"]+$' and char_length(resolve_from) <= 500));
exception when duplicate_object then null; end $$;
comment on column public.news_sources.kind is '0198: publisher (a news site) or creator (a person''s or a show''s channel).';
comment on column public.news_sources.resolve_from is '0198: the link it was added by, until the reader has found the feed behind it.';

/* THE PLATFORMS WITH NO FEED ANYONE MAY READ: the reason, for the console and for a refusal */
create or replace function public.news_link_refusal(p_url text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_url ~* '^https?://([a-z0-9-]+\.)?instagram\.com(/|$)' then 'Instagram'
    when p_url ~* '^https?://([a-z0-9-]+\.)?tiktok\.com(/|$)' then 'TikTok'
    when p_url ~* '^https?://([a-z0-9-]+\.)?(x|twitter)\.com(/|$)' then 'X'
    when p_url ~* '^https?://([a-z0-9-]+\.)?threads\.(net|com)(/|$)' then 'Threads'
    when p_url ~* '^https?://([a-z0-9-]+\.)?(facebook|fb)\.com(/|$)' then 'Facebook'
    when p_url ~* '^https?://open\.spotify\.com(/|$)' then 'Spotify'
  end;
$$;

/* ADD ONE BY ITS LINK. p_kind: 'publisher' or 'creator'. p_name: optional - without one, a stand-in from the
   address (@handle, or the site's name) until the first read gives the feed's own. */
create or replace function public.add_news_link(p_league uuid, p_url text, p_kind text default 'publisher', p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u   text := btrim(coalesce(p_url, ''));
  k   text := lower(btrim(coalesce(p_kind, 'publisher')));
  nm  text := btrim(coalesce(p_name, ''));
  auto boolean := false;
  no  text;
  hst text; handle text; v uuid; sl text; n int := 1;
begin
  if not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot add news sources here' using errcode = '42501';
  end if;
  if u !~* '^https?://[^\s<>"]+$' or char_length(u) > 500 then
    raise exception 'paste the whole link, starting https://' using errcode = '22023';
  end if;
  no := public.news_link_refusal(u);
  if no is not null then
    raise exception '% publishes no feed that can be read without the account owner''s permission', no using errcode = '22023';
  end if;
  if k not in ('publisher', 'creator') then raise exception 'a source is a publisher or a creator' using errcode = '22023'; end if;
  if char_length(nm) > 80 then raise exception 'a name is 80 characters at most' using errcode = '22023'; end if;
  if exists (select 1 from news_sources s where s.league_id is not distinct from p_league
               and (s.feed_url = u or s.resolve_from = u or s.site_url = u)) then
    raise exception 'that link is a source here already' using errcode = '23505';
  end if;
  if nm = '' then
    auto := true;
    hst := regexp_replace(lower(substring(u from '^https?://([^/:?#]+)')), '^(www|m)\.', '');
    handle := coalesce(substring(u from '^https?://bsky\.app/profile/([A-Za-z0-9_.:-]{1,60})'),
                       substring(u from '^https?://[^/]+/@([A-Za-z0-9_.-]{1,60})'));
    nm := left(case when handle is not null then '@' || handle else coalesce(hst, 'source') end, 80);
  end if;
  sl := public.creator_slug(nm, 'source');
  while exists (select 1 from news_sources x where x.slug = sl) loop
    n := n + 1;
    sl := left(public.creator_slug(nm, 'source'), 55) || '-' || n;
  end loop;
  begin
    insert into news_sources (league_id, slug, name, site_url, feed_url, kind, resolve_from, name_auto, added_by)
    values (p_league, sl, nm, u, u, k, u, auto, auth.uid()) returning id into v;
  exception when unique_violation then
    raise exception 'that link is a source here already' using errcode = '23505';
  end;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'add_news_link', 'news_source', v::text, jsonb_build_object('league', p_league, 'link', u, 'kind', k));
  return jsonb_build_object('id', v, 'slug', sl, 'name', nm);
end $$;

/* A PUBLISHER OR A CREATOR: the console's switch on each source */
create or replace function public.set_news_source_kind(p_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid; found_ boolean;
begin
  select league_id, true into v_league, found_ from news_sources where id = p_id;
  if not coalesce(found_, false) or not public.can_manage_news_sources(v_league) then
    raise exception 'you cannot change that source' using errcode = '42501';
  end if;
  if p_kind not in ('publisher', 'creator') then raise exception 'a source is a publisher or a creator' using errcode = '22023'; end if;
  update news_sources set kind = p_kind where id = p_id;
end $$;

/* THE CONSOLE'S LIST, with what a source is and whether it is still waiting for its first read */
drop function if exists public.news_sources_admin(uuid);
create or replace function public.news_sources_admin(p_league uuid)
returns table (id uuid, slug text, name text, site_url text, feed_url text, logo_url text, colour text, enabled boolean,
               last_fetched_at timestamptz, last_ok_at timestamptz, last_error text, item_count integer,
               kind text, platform text, resolve_from text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot see the news sources here' using errcode = '42501';
  end if;
  return query
    select s.id, s.slug, s.name, s.site_url, s.feed_url, s.logo_url, s.colour, s.enabled,
           s.last_fetched_at, s.last_ok_at, s.last_error, s.item_count, s.kind, s.platform, s.resolve_from
      from news_sources s
     where s.league_id is not distinct from p_league
     order by s.name;
end $$;

/* THE NEWS PAGE (0194's), a creator's posts told from a publisher's: kind 'channel', with its platform in
   piece_kind. A source still waiting for its first read has no items, so nothing else changes. */
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
        and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids)) and public.league_visible(p_league)))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

/* THE READER'S OWN FEED (0194's), the same way */
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
        and (s.id = any (me.sources) or s.league_id = any (me.leagues) or i.league_ids && me.leagues)
        and (s.league_id is null or public.league_visible(s.league_id))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

/* A SOURCE'S PAGE and ONE STORY (0194's), saying which it is: a publisher or a creator, and on what */
create or replace function public.news_source_public(p_slug text, p_before timestamptz default null, p_limit int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'name', s.name, 'site_url', s.site_url, 'logo_url', s.logo_url, 'colour', s.colour,
      'kind', s.kind, 'platform', s.platform,
      'league', (select jsonb_build_object('slug', l.slug, 'name', l.name) from leagues l where l.id = s.league_id),
      'items', coalesce((select jsonb_agg(x order by x->>'published_at' desc) from (
          select jsonb_build_object('id', i.id, 'title', i.title, 'summary', i.summary, 'image_url', i.image_url, 'url', i.url,
                                    'author', i.author, 'tags', to_jsonb(i.tags), 'published_at', i.published_at,
                                    'leagues', public.news_item_leagues(i.league_ids, s.league_id)) as x
            from news_items i
           where i.source_id = s.id and i.published_at < coalesce(p_before, 'infinity'::timestamptz)
           order by i.published_at desc limit greatest(1, least(coalesce(p_limit, 30), 60))) q), '[]'::jsonb))
    from news_sources s
   where s.slug = p_slug and s.enabled and (s.league_id is null or public.league_visible(s.league_id));
$$;

create or replace function public.news_item_public(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'title', i.title, 'summary', i.summary, 'image_url', i.image_url, 'url', i.url,
                            'author', i.author, 'tags', to_jsonb(i.tags), 'published_at', i.published_at,
                            'source', jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'site_url', s.site_url,
                                                         'logo_url', s.logo_url, 'colour', s.colour, 'kind', s.kind,
                                                         'platform', s.platform),
                            'leagues', public.news_item_leagues(i.league_ids, s.league_id))
    from news_items i join news_sources s on s.id = i.source_id
   where i.id = p_id and s.enabled and (s.league_id is null or public.league_visible(s.league_id));
$$;

/* THE ROW OF THEM on the News page, each saying which it is */
drop function if exists public.news_sources_public(uuid);
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
                                or exists (select 1 from news_items i where i.source_id = s.id and p_league = any (i.league_ids)))
                               and public.league_visible(p_league)))
   order by 10 desc nulls last, s.name;
$$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.add_news_link(uuid, text, text, text) from public, anon;
revoke all on function public.set_news_source_kind(uuid, text) from public, anon;
revoke all on function public.news_sources_admin(uuid) from public, anon;
grant execute on function public.news_link_refusal(text) to anon, authenticated;
grant execute on function public.add_news_link(uuid, text, text, text) to authenticated;
grant execute on function public.set_news_source_kind(uuid, text) to authenticated;
grant execute on function public.news_sources_admin(uuid) to authenticated;
grant execute on function public.news_feed(uuid, timestamptz, int, text[]) to anon, authenticated;
revoke all on function public.news_feed_mine(timestamptz, int) from public, anon;
grant execute on function public.news_feed_mine(timestamptz, int) to authenticated;
grant execute on function public.news_source_public(text, timestamptz, int) to anon, authenticated;
grant execute on function public.news_item_public(uuid) to anon, authenticated;
grant execute on function public.news_sources_public(uuid) to anon, authenticated;
