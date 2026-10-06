-- ============================================================================
-- 0234 - WHERE A VISIT CAME FROM (2026-10-06): the page a visit landed on, the search engine or campaign that sent it, and a report.
--
-- What a search engine passes on is the site it came from and nothing else: Google no longer says WHAT was searched (that is in its own Search
-- Console, which is not this database's to read). What this keeps, for the first page of a visit only:
--   landing      true on the visit's first page view, so "which page do people arrive on, and from where" can be asked of it
--   engine       google, bing, duckduckgo, yahoo, baidu, yandex, ecosia, brave, qwant, or 'other' (a search engine not named), worked out
--                here from the referring site's name (which is all that is sent), never from anything the reader typed
--   utm_source / utm_medium / utm_campaign   the tags a link of ours (a newsletter, a post, an advert) carries; a Google advert's click id
--                alone is kept as medium 'cpc'
-- analytics_sources_report(p_days) reads it, for platform administrators only: totals, the engines, the pages arrived on from search (by
-- league, club or player name), campaigns, referring sites and the days. Nothing here can be tied to a person: the same per-tab token and the
-- same opt-outs as every other visit, and the same 300-events-in-ten-minutes cap.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.site_events
  add column if not exists landing boolean not null default false,
  add column if not exists engine text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text;
do $$ begin
  alter table public.site_events add constraint site_events_engine_ck check (engine is null or engine ~ '^[a-z]{2,20}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.site_events add constraint site_events_utm_ck check (
    (utm_source is null or utm_source ~ '^[a-z0-9_.-]{1,40}$') and (utm_medium is null or utm_medium ~ '^[a-z0-9_.-]{1,40}$')
    and (utm_campaign is null or utm_campaign ~ '^[a-z0-9_.-]{1,40}$'));
exception when duplicate_object then null; end $$;
create index if not exists site_events_landing_at on public.site_events (at) where landing;

-- the engine a referring site is: only the host name is ever sent, and only the well-known engines are named
create or replace function public.search_engine_of(p_ref text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_ref is null or p_ref = '' then null
    when lower(p_ref) ~ '(^|\.)google\.' then 'google'
    when lower(p_ref) ~ '(^|\.)bing\.com$' then 'bing'
    when lower(p_ref) ~ '(^|\.)duckduckgo\.com$' then 'duckduckgo'
    when lower(p_ref) ~ '(^|\.)(yahoo\.com|yahoo\.co\.jp|search\.yahoo\.)' then 'yahoo'
    when lower(p_ref) ~ '(^|\.)baidu\.com$' then 'baidu'
    when lower(p_ref) ~ '(^|\.)(yandex\.(com|ru)|ya\.ru)$' then 'yandex'
    when lower(p_ref) ~ '(^|\.)ecosia\.org$' then 'ecosia'
    when lower(p_ref) ~ '(^|\.)search\.brave\.com$' then 'brave'
    when lower(p_ref) ~ '(^|\.)qwant\.com$' then 'qwant'
    when lower(p_ref) ~ '(^|\.)(naver\.com|daum\.net|seznam\.cz|startpage\.com|ask\.com|aol\.com|sogou\.com)$' then 'other'
    else null end
$$;
revoke all on function public.search_engine_of(text) from public, anon, authenticated;
grant execute on function public.search_engine_of(text) to service_role;

create or replace function public.analytics_track(p_session text, p_signed_in boolean, p_device text,
                                                  p_lang text, p_app text, p_ref text, p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_room int;
  n      int := 0;
begin
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{16,40}$' or jsonb_typeof(p_events) is distinct from 'array' then
    return 0;
  end if;
  select 300 - count(*) into v_room
    from site_events where session = p_session and at > now() - interval '10 minutes';
  if v_room <= 0 then
    return 0;
  end if;
  insert into site_events (kind, page, league, team, player, game, tab, session, signed_in, device, lang, app, ref, landing, engine, utm_source, utm_medium, utm_campaign)
  select e ->> 'kind',
         e ->> 'page',
         nullif(lower(e ->> 'league'), ''),
         nullif(lower(e ->> 'team'), ''),
         nullif(lower(e ->> 'player'), ''),
         case when (e ->> 'game') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (e ->> 'game')::uuid end,
         case when e ->> 'kind' = 'tab' then lower(e ->> 'tab') end,
         p_session,
         coalesce(p_signed_in, false),
         case when p_device in ('phone', 'tablet', 'desktop') then p_device end,
         case when p_lang ~ '^[a-z]{2}$' then p_lang end,
         case when p_app in ('web', 'android', 'ios') then p_app else 'web' end,
         case when lower(p_ref) ~ '^[a-z0-9.-]{1,100}$' then lower(p_ref) end,
         coalesce((e ->> 'landing') = 'true', false) and e ->> 'kind' = 'view',
         case when coalesce((e ->> 'landing') = 'true', false) and e ->> 'kind' = 'view' then public.search_engine_of(p_ref) end,
         case when (e ->> 'landing') = 'true' and lower(e ->> 'utm_source') ~ '^[a-z0-9_.-]{1,40}$' then lower(e ->> 'utm_source') end,
         case when (e ->> 'landing') = 'true' and lower(e ->> 'utm_medium') ~ '^[a-z0-9_.-]{1,40}$' then lower(e ->> 'utm_medium') end,
         case when (e ->> 'landing') = 'true' and lower(e ->> 'utm_campaign') ~ '^[a-z0-9_.-]{1,40}$' then lower(e ->> 'utm_campaign') end
    from jsonb_array_elements(p_events) with ordinality x(e, i)
   where x.i <= least(50, v_room)
     and jsonb_typeof(e) = 'object'
     and e ->> 'kind' in ('view', 'tab')
     and coalesce(e ->> 'page', '') ~ '^[a-z0-9/-]{1,40}$'
     and coalesce(lower(e ->> 'league'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'team'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'player'), '') ~ '^([a-z0-9-]{1,100})?$'
     and (e ->> 'kind' = 'view' or coalesce(lower(e ->> 'tab'), '') ~ '^[a-z0-9_-]{1,40}$');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.analytics_track(text, boolean, text, text, text, text, jsonb) from public;
grant execute on function public.analytics_track(text, boolean, text, text, text, text, jsonb) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- OUT. The report: a platform administrator only.
-- ----------------------------------------------------------------------------
create or replace function public.analytics_sources_build(p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
  out jsonb;
begin
  drop table if exists pg_temp._src;
  create temp table _src on commit drop as
    select e.*,
           case when e.engine is not null then 'search'
                when e.utm_source is not null or e.utm_medium is not null or e.utm_campaign is not null then 'campaign'
                when e.ref is not null then 'site'
                else 'direct' end as via
      from site_events e
     where e.at >= v_from and e.landing;
  out := jsonb_build_object(
    'totals', (select jsonb_build_object(
        'landings', count(*), 'search', count(*) filter (where via = 'search'), 'google', count(*) filter (where engine = 'google'),
        'campaign', count(*) filter (where via = 'campaign'), 'site', count(*) filter (where via = 'site'), 'direct', count(*) filter (where via = 'direct'))
        from _src),
    'engines', coalesce((select jsonb_agg(x order by x.landings desc) from (
        select engine, count(*) as landings from _src where engine is not null group by engine limit 20) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(x order by x.landings desc) from (
        select s.page, s.engine, count(*) as landings,
               coalesce(case when s.player is not null then (select trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) from players p where p.id::text = s.player limit 1) end,
                        (select t.name from teams t where t.slug = s.team limit 1), (select l.name from leagues l where l.slug = s.league limit 1)) as name,
               case when s.player is not null then 'player' when s.team is not null then 'club' when s.league is not null then 'league' else null end as kind
          from _src s where s.engine is not null
         group by s.page, s.engine, s.player, s.team, s.league
         order by count(*) desc limit 100) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by x.landings desc) from (
        select utm_source as source, utm_medium as medium, utm_campaign as campaign, count(*) as landings
          from _src where utm_source is not null or utm_medium is not null or utm_campaign is not null
         group by 1, 2, 3 order by 4 desc limit 50) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(x order by x.landings desc) from (
        select ref as host, count(*) as landings from _src where ref is not null and engine is null group by ref order by 2 desc limit 30) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select (at at time zone 'UTC')::date as day, count(*) as landings,
               count(*) filter (where via = 'search') as search, count(*) filter (where engine = 'google') as google
          from _src group by 1) x), '[]'::jsonb));
  return out;
end $$;
revoke all on function public.analytics_sources_build(int) from public, anon, authenticated;

create or replace function public.analytics_sources_report(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return public.analytics_sources_build(p_days);
end $$;
revoke all on function public.analytics_sources_report(int) from public, anon;
grant execute on function public.analytics_sources_report(int) to authenticated, service_role;

notify pgrst, 'reload schema';
