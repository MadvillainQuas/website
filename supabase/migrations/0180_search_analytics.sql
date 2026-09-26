-- ============================================================================
-- 0180 - WHAT PEOPLE SEARCH FOR, in the console's Analytics tab (the rail's search box, 0179).
--
-- The tab shows what people type into the search box: the searches made, the most common, the ones that found
-- nothing (what the site is missing, or how it is spelled), and what gets picked.
--
-- STILL ANONYMOUS, and stricter than a page view, because this one holds WORDS somebody typed:
--   * the words are FOLDED (lower case, accents off, punctuation dropped, 0179's site_fold), at least 2 and at
--     most 60 characters, so "Diggins" and "diggins" are one search;
--   * anything that looks like personal data is never stored: an address (an @), six or more digits (a phone
--     number), a web address;
--   * there is NO session token, no account, no email, no IP address, no cookie: not even the random per-tab
--     token a page view carries, so a search cannot be joined to a visit's rows or to another search;
--   * what else is kept: when; how many results the box showed; the kind of thing picked (a league, a club, a
--     player) and its page name (a public slug); and the same three facts as a visit - phone / tablet /
--     desktop, the language, the app or the browser;
--   * a browser that sends Global Privacy Control or Do Not Track, or whose owner switched counting off,
--     sends nothing (epinoia/track.js), and 400 days later a row is deleted with the visits.
--   The privacy page says the same in plain words ("Visit counts").
--
--   site_searches               one row per search; no browser role can read it
--   analytics_search()          the only way in: validates and inserts one (anon, authenticated)
--   analytics_search_report()   platform administrators only: every figure the tab draws
--   analytics_prune()           (0173's) now deletes old searches too
-- ============================================================================

set local lock_timeout = '5s';

create table if not exists public.site_searches (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  q       text not null check (char_length(q) between 2 and 60),
  results integer not null check (results between 0 and 30),
  picked  text check (picked in ('league', 'team', 'player')),
  ref     text check (ref ~ '^[a-z0-9-]{1,100}$'),
  device  text check (device in ('phone', 'tablet', 'desktop')),
  lang    text check (lang ~ '^[a-z]{2}$'),
  app     text check (app in ('web', 'android', 'ios'))
);
create index if not exists site_searches_at on public.site_searches (at);
alter table public.site_searches enable row level security;
revoke all on table public.site_searches from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- IN. One search per call, when the box is done with it (a result picked, or it closed). What fails a rule is
-- dropped, not stored and not an error, so a stale page never breaks. With no identifier to count per visitor, the
-- whole table takes at most 200 a minute: a script cannot flood it.
-- ----------------------------------------------------------------------------
create or replace function public.analytics_search(p_q text, p_results integer, p_picked text, p_ref text,
                                                   p_device text, p_lang text, p_app text)
returns integer language plpgsql security definer set search_path = public as $$
declare v text := public.site_fold(left(coalesce(p_q, ''), 100));
begin
  if char_length(v) < 2 or char_length(v) > 60 then return 0; end if;
  -- never personal data: an address, a phone number, a web address
  if coalesce(p_q, '') ~ '@'
     or char_length(regexp_replace(v, '[^0-9]', '', 'g')) >= 6
     or coalesce(p_q, '') ~* '(https?:|www\.|\.(com|net|org|edu|gov|io)(\M|/))' then
    return 0;
  end if;
  if (select count(*) from site_searches where at > now() - interval '1 minute') >= 200 then return 0; end if;
  insert into site_searches (q, results, picked, ref, device, lang, app)
  values (v, greatest(0, least(coalesce(p_results, 0), 30)),
          case when p_picked in ('league', 'team', 'player') then p_picked end,
          case when p_picked in ('league', 'team', 'player') and coalesce(p_ref, '') ~ '^[a-z0-9-]{1,100}$' then p_ref end,
          case when p_device in ('phone', 'tablet', 'desktop') then p_device end,
          case when coalesce(p_lang, '') ~ '^[a-z]{2}$' then p_lang end,
          case when p_app in ('web', 'android', 'ios') then p_app end);
  return 1;
end $$;
revoke all on function public.analytics_search(text, integer, text, text, text, text, text) from public;
grant execute on function public.analytics_search(text, integer, text, text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- OUT. Every list stops at a fixed number of rows (100, the picked list 50), as the visits report does.
-- ----------------------------------------------------------------------------
create or replace function public.analytics_search_build(p_days integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 400));
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
begin
  return (
    with s as (select * from site_searches where at >= v_from)
    select jsonb_build_object(
      'range', jsonb_build_object('days', v_days, 'from', v_from, 'to', now()),
      'totals', (select jsonb_build_object(
          'searches', count(*),
          'queries', count(distinct q),
          'picked', count(*) filter (where picked is not null),
          'no_results', count(*) filter (where results = 0))
        from s),
      'daily', coalesce((select jsonb_agg(d order by d.day) from (
          select (at at time zone 'UTC')::date as day, count(*) as searches,
                 count(*) filter (where picked is not null) as picked,
                 count(*) filter (where results = 0) as no_results
            from s group by 1) d), '[]'::jsonb),
      'top', coalesce((select jsonb_agg(t) from (
          select q, count(*) as searches, round(avg(results), 1) as results,
                 count(*) filter (where picked is not null) as picked,
                 count(*) filter (where results = 0) as no_results
            from s group by q order by count(*) desc, q limit 100) t), '[]'::jsonb),
      'nothing', coalesce((select jsonb_agg(t) from (
          select q, count(*) as searches from s where results = 0
           group by q order by count(*) desc, q limit 100) t), '[]'::jsonb),
      'picked_kinds', coalesce((select jsonb_agg(t) from (
          select picked as kind, count(*) as n from s where picked is not null
           group by picked order by count(*) desc) t), '[]'::jsonb),
      'picked', coalesce((select jsonb_agg(t) from (
          select s2.picked as kind, s2.ref, count(*) as n,
                 coalesce(l.name, tm.name,
                          case when pl.id is not null and not public.player_withheld(pl.is_minor, pl.public_consent)
                               then btrim(pl.first_name || ' ' || pl.last_name) end) as name
            from s s2
            left join leagues l  on s2.picked = 'league' and l.slug = s2.ref
            left join teams tm   on s2.picked = 'team'   and tm.slug = s2.ref
            left join players pl on s2.picked = 'player' and pl.slug = s2.ref
           where s2.picked is not null
           group by s2.picked, s2.ref, l.name, tm.name, pl.id, pl.first_name, pl.last_name, pl.is_minor, pl.public_consent
           order by count(*) desc, s2.ref limit 50) t), '[]'::jsonb),
      'devices', coalesce((select jsonb_agg(t) from (select coalesce(device, 'unknown') as k, count(*) as n from s group by 1 order by 2 desc) t), '[]'::jsonb),
      'langs',   coalesce((select jsonb_agg(t) from (select coalesce(lang, 'unknown') as k, count(*) as n from s group by 1 order by 2 desc limit 20) t), '[]'::jsonb),
      'apps',    coalesce((select jsonb_agg(t) from (select coalesce(app, 'unknown') as k, count(*) as n from s group by 1 order by 2 desc) t), '[]'::jsonb)
    ));
end $$;
revoke all on function public.analytics_search_build(integer) from public, anon, authenticated;
grant execute on function public.analytics_search_build(integer) to service_role;

create or replace function public.analytics_search_report(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return public.analytics_search_build(p_days);
end $$;
revoke all on function public.analytics_search_report(integer) from public, anon;
grant execute on function public.analytics_search_report(integer) to authenticated, service_role;

-- the daily prune (0173) takes the searches too
create or replace function public.analytics_prune()
returns int language sql security definer set search_path = public as $$
  with a as (delete from site_events   where at < now() - interval '400 days' returning 1),
       b as (delete from site_searches where at < now() - interval '400 days' returning 1)
  select ((select count(*) from a) + (select count(*) from b))::int;
$$;
revoke all on function public.analytics_prune() from public, anon, authenticated;

alter table public.site_searches owner to postgres;
alter function public.analytics_search(text, integer, text, text, text, text, text) owner to postgres;
alter function public.analytics_search_build(integer) owner to postgres;
alter function public.analytics_search_report(integer) owner to postgres;
alter function public.analytics_prune() owner to postgres;

-- ----------------------------------------------------------------------------
-- A READ-ONLY CHECK of who may do what
-- ----------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.site_searches', 'select') or has_table_privilege('authenticated', 'public.site_searches', 'select')
     or has_table_privilege('anon', 'public.site_searches', 'insert') or has_table_privilege('authenticated', 'public.site_searches', 'insert') then
    raise exception '0180: a browser role can reach site_searches directly';
  end if;
  if not has_function_privilege('anon', 'public.analytics_search(text, integer, text, text, text, text, text)', 'execute') then
    raise exception '0180: a visitor cannot record a search';
  end if;
  if has_function_privilege('anon', 'public.analytics_search_report(integer)', 'execute')
     or has_function_privilege('anon', 'public.analytics_search_build(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.analytics_search_build(integer)', 'execute') then
    raise exception '0180: the search report is reachable by somebody who is not an administrator';
  end if;
  begin
    perform public.analytics_search_report(30);
    raise exception '0180: analytics_search_report answered someone who is not a platform administrator';
  exception when insufficient_privilege then null;
  end;
  raise notice '0180 ok: searches are recorded anonymously and reported to platform administrators only';
end $$;
