-- ============================================================================
-- 0246 - A SOURCE'S TITLE FILTER: KEEP ONLY, AND NEVER (2026-10-07)
--
-- A channel that shows many sports (DAZN France: football, rugby, boxing ... and the Betclic ELITE) should give the
-- site its basketball alone. Each source now has two lists of words, set in the console beside it (Creators & news
-- sources), as a channel's own names for clubs are (0240):
--     title_include   KEEP ONLY a post whose title has one of these ("Betclic Elite"); empty: every post
--     title_exclude   NEVER a post whose title has one of these ("Espoirs", "Pro B")
-- A word or a phrase is found as words, whatever the case and the accents ("betclic elite" finds "Betclic ÉLITE |
-- Paris - Monaco", never "elitebasket"). The readers (scripts/news/fetch_feeds.py, the news-refresh function) leave
-- a post that fails it unread; set here, the source's posts already read that fail it are taken off (a video put on
-- a game by hand is kept). news_title_passes is the rule, the readers' title_passes / titlePasses its twins.
--
-- And no YouTube Shorts, from any channel: the readers leave them unread; the ones already read go (below).
-- ============================================================================
set local lock_timeout = '5s';

alter table public.news_sources add column if not exists title_include text[] not null default '{}';
alter table public.news_sources add column if not exists title_exclude text[] not null default '{}';
comment on column public.news_sources.title_include is '0246: keep only a post whose title has one of these words or phrases (empty: every post).';
comment on column public.news_sources.title_exclude is '0246: never a post whose title has one of these words or phrases.';

/* a title as words: lower case, the accents off, anything not a letter or a digit a space */
create or replace function public.news_fold(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'àáâäãåāăąèéêëēėęěìíîïīįòóôöõōőùúûüūůűçćčñńňšśşžźżýÿťďŕřøłđæœ', 'aaaaaaaaaeeeeeeeeiiiiiiooooooouuuuuuucccnnnssszzzyytdrroldao'), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.news_title_passes(p_title text, p_include text[], p_exclude text[])
returns boolean language sql immutable set search_path = public as $$
  select (coalesce(cardinality(p_include), 0) = 0
          or exists (select 1 from unnest(p_include) w
                      where public.news_fold(w) <> '' and (' ' || public.news_fold(p_title) || ' ') like ('% ' || public.news_fold(w) || ' %')))
     and not exists (select 1 from unnest(coalesce(p_exclude, '{}')) w
                      where public.news_fold(w) <> '' and (' ' || public.news_fold(p_title) || ' ') like ('% ' || public.news_fold(w) || ' %'));
$$;

/* THE CONSOLE'S READ: the filters of the sources on its list that the reader may manage */
create or replace function public.news_source_filters(p_ids uuid[])
returns table (id uuid, title_include text[], title_exclude text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.title_include, s.title_exclude
    from news_sources s
   where s.id = any (coalesce(p_ids, '{}')) and public.can_manage_news_sources(s.league_id)
     and (s.league_id is not null or public.is_platform_admin());
$$;

/* THE CONSOLE'S WRITE: each list tidied (trimmed, a phrase once, 2 to 60 characters, 20 at most); the source's posts
   already read that fail it taken off, but a video put on a game by hand. -> { include, exclude, removed } */
create or replace function public.set_news_source_filter(p_id uuid, p_include text[], p_exclude text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg uuid; found_ boolean;
  inc text[]; exc text[]; gone int;
begin
  select league_id, true into lg, found_ from news_sources where id = p_id;
  if not coalesce(found_, false) or not public.can_manage_news_sources(lg) or (lg is null and not public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(array_agg(w order by o), '{}') into inc
    from (select distinct on (public.news_fold(x)) btrim(x) as w, o
            from unnest(coalesce(p_include, '{}')) with ordinality as u(x, o)
           where public.news_fold(x) <> '' order by public.news_fold(x), o) t;
  select coalesce(array_agg(w order by o), '{}') into exc
    from (select distinct on (public.news_fold(x)) btrim(x) as w, o
            from unnest(coalesce(p_exclude, '{}')) with ordinality as u(x, o)
           where public.news_fold(x) <> '' order by public.news_fold(x), o) t;
  if exists (select 1 from unnest(inc || exc) w where char_length(w) not between 2 and 60) then
    raise exception 'a word or a phrase is 2 to 60 characters' using errcode = '22023';
  end if;
  if cardinality(inc) > 20 or cardinality(exc) > 20 then
    raise exception 'twenty words or phrases at most in each list' using errcode = '22023';
  end if;
  update news_sources set title_include = inc, title_exclude = exc where id = p_id;
  with d as (delete from news_items i
              where i.source_id = p_id and not coalesce(i.game_locked, false)
                and not public.news_title_passes(i.title, inc, exc)
              returning 1)
  select count(*)::int into gone from d;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_news_source_filter', 'news_source', p_id::text,
          jsonb_build_object('include', inc, 'exclude', exc, 'removed', gone));
  return jsonb_build_object('include', inc, 'exclude', exc, 'removed', gone);
end $$;

/* NO SHORTS. A YouTube Short (a vertical clip) is not for the site: the readers leave every one unread from now on
   (videos.py is_short / shorts_of: a feed's /shorts/ link, the API's Shorts playlist), and the ones read before
   by their feed's /shorts/ link are taken off here - a video put on a game by hand is kept. */
delete from public.news_items
 where url ~* '^https?://(www\.|m\.)?youtube\.com/shorts/' and not coalesce(game_locked, false);

alter function public.news_fold(text) owner to postgres;
alter function public.news_title_passes(text, text[], text[]) owner to postgres;
alter function public.news_source_filters(uuid[]) owner to postgres;
alter function public.set_news_source_filter(uuid, text[], text[]) owner to postgres;
revoke all on function public.news_source_filters(uuid[]) from public, anon;
revoke all on function public.set_news_source_filter(uuid, text[], text[]) from public, anon;
grant execute on function public.news_fold(text) to anon, authenticated;
grant execute on function public.news_title_passes(text, text[], text[]) to anon, authenticated;
grant execute on function public.news_source_filters(uuid[]) to authenticated;
grant execute on function public.set_news_source_filter(uuid, text[], text[]) to authenticated;
