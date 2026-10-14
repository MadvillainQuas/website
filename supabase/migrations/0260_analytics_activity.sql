-- ============================================================================
-- 0260 - WHAT PEOPLE DO ON A PAGE (2026-10-14): time spent, how far they read, videos watched, files downloaded, links out,
-- sharing, page speed and script errors, and the site's widgets seen on other sites. Read by the console's Analytics tab.
--
-- STILL PERMANENTLY ANONYMOUS. A row carries the same per-tab token as a visit (random, in sessionStorage, gone when the tab
-- closes), the page and the league / club / player / game it is about, and one of:
--   time      seconds the page was in front of the reader and in use (visible, and touched / scrolled / typed within the
--             last half minute, or a video playing), and the furthest it was scrolled, in percent
--   video     a video's public id on its platform ('youtube:<id>', 'vimeo:<id>', 'twitch-live:<channel>' ...) and how far:
--             open (the player was put on the page), play, q25 / q50 / q75 / done, watch (seconds watched since the last)
--   download  WHAT was saved, as a key the page gives it ('report', 'season-stats', 'calendar' ...) and its format (pdf, csv ...)
--   out       the NAME of another site a link was followed to (host only, never the address)
--   share / copy   that the share sheet was used or something was copied, and which kind of thing (never what was copied)
--   speed     milliseconds until the page's main content was drawn
--   error     a script error in this site's own code, as file and line ('game.js:2163'), never its message
--   embed     one of the site's widgets drawn on another site: the widget, and that site's name
-- plus the visit's device class and app or browser. No account, email, IP address, user agent, cookie or text typed.
-- analytics_activity() is the only way in (validated per kind, at most 50 a call and 400 a visit in ten minutes);
-- analytics_activity_report(p_days) answers platform administrators only. Rows go after 400 days with the rest.
-- ============================================================================
set local lock_timeout = '5s';

create table if not exists public.site_activity (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  session text not null check (session ~ '^[A-Za-z0-9_-]{16,40}$'),
  kind    text not null check (kind in ('time', 'video', 'download', 'out', 'share', 'copy', 'speed', 'error', 'embed')),
  page    text not null check (page ~ '^[a-z0-9/-]{1,40}$'),
  league  text check (league is null or league ~ '^[a-z0-9-]{1,100}$'),
  team    text check (team is null or team ~ '^[a-z0-9-]{1,100}$'),
  player  text check (player is null or player ~ '^[a-z0-9-]{1,100}$'),
  game    uuid,
  what    text check (what is null or what ~ '^[A-Za-z0-9._:-]{1,80}$'),
  fmt     text check (fmt is null or fmt ~ '^[a-z0-9]{1,12}$'),
  step    text check (step is null or step in ('open', 'play', 'q25', 'q50', 'q75', 'done', 'watch')),
  secs    int check (secs is null or secs between 0 and 7200),
  depth   smallint check (depth is null or depth between 0 and 100),
  ms      int check (ms is null or ms between 0 and 120000),
  device  text check (device is null or device in ('phone', 'tablet', 'desktop')),
  app     text not null default 'web' check (app in ('web', 'android', 'ios'))
);
create index if not exists site_activity_at on public.site_activity (at);
create index if not exists site_activity_session_at on public.site_activity (session, at);
alter table public.site_activity enable row level security;
revoke all on public.site_activity from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- IN. A batch from track.js.
-- ----------------------------------------------------------------------------
create or replace function public.analytics_activity(p_session text, p_device text, p_app text, p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_room int;
  n      int := 0;
begin
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{16,40}$' or jsonb_typeof(p_events) is distinct from 'array' then
    return 0;
  end if;
  select 400 - count(*) into v_room
    from site_activity where session = p_session and at > now() - interval '10 minutes';
  if v_room <= 0 then
    return 0;
  end if;
  insert into site_activity (kind, page, league, team, player, game, what, fmt, step, secs, depth, ms, session, device, app)
  select e ->> 'kind',
         e ->> 'page',
         nullif(lower(e ->> 'league'), ''),
         nullif(lower(e ->> 'team'), ''),
         nullif(lower(e ->> 'player'), ''),
         case when (e ->> 'game') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e ->> 'game')::uuid end,
         case when e ->> 'kind' in ('video', 'download', 'out', 'share', 'copy', 'error', 'embed') then e ->> 'what' end,
         case when e ->> 'kind' in ('download', 'video') and lower(e ->> 'fmt') ~ '^[a-z0-9]{1,12}$' then lower(e ->> 'fmt') end,
         case when e ->> 'kind' = 'video' then e ->> 'step' end,
         case when e ->> 'kind' in ('time', 'video') and (e ->> 'secs') ~ '^[0-9]{1,6}$' then least((e ->> 'secs')::int, 7200) end,
         case when e ->> 'kind' = 'time' and (e ->> 'depth') ~ '^[0-9]{1,3}$' then least((e ->> 'depth')::int, 100) end,
         case when e ->> 'kind' = 'speed' and (e ->> 'ms') ~ '^[0-9]{1,6}$' then least((e ->> 'ms')::int, 120000) end,
         p_session,
         case when p_device in ('phone', 'tablet', 'desktop') then p_device end,
         case when p_app in ('web', 'android', 'ios') then p_app else 'web' end
    from jsonb_array_elements(p_events) with ordinality x(e, i)
   where x.i <= least(50, v_room)
     and jsonb_typeof(e) = 'object'
     and coalesce(e ->> 'page', '') ~ '^[a-z0-9/-]{1,40}$'
     and coalesce(lower(e ->> 'league'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'team'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'player'), '') ~ '^([a-z0-9-]{1,100})?$'
     and case e ->> 'kind'
           when 'time'     then (e ->> 'secs') ~ '^[0-9]{1,6}$'
           when 'video'    then coalesce(e ->> 'what', '') ~ '^[a-z-]{2,14}:[A-Za-z0-9._-]{1,64}$'
                                and e ->> 'step' in ('open', 'play', 'q25', 'q50', 'q75', 'done', 'watch')
           when 'download' then coalesce(e ->> 'what', '') ~ '^[a-z0-9_-]{1,40}$'
           when 'out'      then coalesce(e ->> 'what', '') ~ '^[a-z0-9.-]{1,80}$'
           when 'share'    then coalesce(e ->> 'what', '') ~ '^[a-z0-9_-]{1,40}$'
           when 'copy'     then coalesce(e ->> 'what', '') ~ '^[a-z0-9_-]{1,40}$'
           when 'speed'    then (e ->> 'ms') ~ '^[0-9]{1,6}$'
           when 'error'    then coalesce(e ->> 'what', '') ~ '^[a-z0-9._-]{1,60}(:[0-9]{1,6})?$'
           when 'embed'    then e ->> 'what' is null or (e ->> 'what') ~ '^[a-z0-9.-]{1,80}$'
           else false end;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.analytics_activity(text, text, text, jsonb) from public;
grant execute on function public.analytics_activity(text, text, text, jsonb) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- OUT. The report, a platform administrator only.
-- ----------------------------------------------------------------------------
create or replace function public.analytics_activity_build(p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
  out jsonb;
begin
  drop table if exists pg_temp._act;
  create temp table _act on commit drop as
    select * from site_activity where at >= v_from;

  -- one row per visit and page: time in use and the furthest scroll
  drop table if exists pg_temp._dwell;
  create temp table _dwell on commit drop as
    select session, page, sum(secs) as secs, max(depth) as depth
      from _act where kind = 'time' group by session, page;

  -- every page view in order, for bounces and exits
  drop table if exists pg_temp._pv;
  create temp table _pv on commit drop as
    select session, page, at,
           row_number() over (partition by session order by at desc) as from_end,
           count(*) over (partition by session) as views_in_visit
      from site_events where at >= v_from and kind = 'view';

  -- one row per visit and video, how far it got
  drop table if exists pg_temp._vid;
  create temp table _vid on commit drop as
    select session, what,
           bool_or(step = 'play') as played, bool_or(step = 'q25') as q25, bool_or(step = 'q50') as q50,
           bool_or(step = 'q75') as q75, bool_or(step = 'done') as done, coalesce(sum(secs) filter (where step = 'watch'), 0) as secs,
           min(page) as page, max(league) as league, max(game::text) as game
      from _act where kind = 'video' group by session, what;

  out := jsonb_build_object(
    'totals', jsonb_build_object(
        'visits_timed', (select count(distinct session) from _dwell),
        'engaged_hours', round(coalesce((select sum(secs) from _dwell), 0) / 3600.0, 1),
        'median_visit_secs', (select percentile_cont(0.5) within group (order by s) from (select sum(secs) as s from _dwell group by session) v),
        'median_page_secs', (select percentile_cont(0.5) within group (order by secs) from _dwell),
        'bounce_rate', (select round(100.0 * count(*) filter (where views_in_visit = 1) / nullif(count(*), 0), 1) from _pv where from_end = 1),
        'video_plays', (select count(*) filter (where played) from _vid),
        'video_hours', round(coalesce((select sum(secs) from _vid), 0) / 3600.0, 1),
        'downloads', (select count(*) from _act where kind = 'download'),
        'outbound', (select count(*) from _act where kind = 'out'),
        'shares', (select count(*) from _act where kind in ('share', 'copy')),
        'errors', (select count(*) from _act where kind = 'error'),
        'embeds', (select count(*) from _act where kind = 'embed'),
        'median_speed_ms', (select percentile_cont(0.5) within group (order by ms) from _act where kind = 'speed')),

    -- TIME ON EACH PAGE, with what happens around it
    'pages', coalesce((select jsonb_agg(x order by x.views desc) from (
        select v.page, v.views,
               d.timed, d.median_secs, d.p75_secs, d.avg_secs, d.quick, d.avg_depth, d.read_most,
               b.landings, b.bounces, b.exits,
               s.median_ms, s.p75_ms, s.speed_n,
               coalesce(er.errors, 0) as errors
          from (select page, count(*) as views from _pv group by page) v
          left join (select page, count(*) as timed,
                            percentile_cont(0.5) within group (order by secs) as median_secs,
                            percentile_cont(0.75) within group (order by secs) as p75_secs,
                            round(avg(secs)) as avg_secs,
                            round(100.0 * count(*) filter (where secs < 10) / count(*), 1) as quick,
                            round(avg(depth)) as avg_depth,
                            round(100.0 * count(*) filter (where depth >= 75) / nullif(count(depth), 0), 1) as read_most
                       from _dwell group by page) d on d.page = v.page
          left join (select f.page,
                            count(*) filter (where f.at = l.first_at) as landings,
                            count(*) filter (where f.at = l.first_at and f.views_in_visit = 1) as bounces,
                            count(*) filter (where f.from_end = 1) as exits
                       from _pv f join (select session, min(at) as first_at from _pv group by session) l on l.session = f.session
                      group by f.page) b on b.page = v.page
          left join (select page, percentile_cont(0.5) within group (order by ms) as median_ms,
                            percentile_cont(0.75) within group (order by ms) as p75_ms, count(*) as speed_n
                       from _act where kind = 'speed' group by page) s on s.page = v.page
          left join (select page, count(*) as errors from _act where kind = 'error' group by page) er on er.page = v.page
         order by v.views desc limit 60) x), '[]'::jsonb),

    -- time spent, league by league, on the pages about them
    'leagues', coalesce((select jsonb_agg(x order by x.secs desc) from (
        select a.league as slug, l.name, sum(a.secs) as secs, count(distinct a.session) as visits,
               percentile_cont(0.5) within group (order by a.secs) as median_secs
          from (select session, page, league, sum(secs) as secs from _act where kind = 'time' and league is not null group by 1, 2, 3) a
          left join leagues l on l.slug = a.league
         group by a.league, l.name order by sum(a.secs) desc limit 30) x), '[]'::jsonb),

    'video_funnel', (select jsonb_build_object(
        'opened', count(*), 'played', count(*) filter (where played), 'q25', count(*) filter (where q25),
        'q50', count(*) filter (where q50), 'q75', count(*) filter (where q75), 'done', count(*) filter (where done)) from _vid),
    'videos', coalesce((select jsonb_agg(x order by x.plays desc, x.opens desc) from (
        select v.what, split_part(v.what, ':', 1) as provider,
               count(*) as opens, count(*) filter (where v.played) as plays,
               count(*) filter (where v.q50) as half, count(*) filter (where v.done) as done,
               round(sum(v.secs) / 60.0) as minutes,
               mode() within group (order by v.page) as page,
               coalesce(
                 (select n.title from news_items n where n.video_id = split_part(v.what, ':', 2) order by n.published_at desc nulls last limit 1),
                 (select h.name || ' v ' || w.name from game_videos gv join games g on g.id = gv.game_id
                    join teams h on h.id = g.home_team_id join teams w on w.id = g.away_team_id
                   where gv.video_ref = split_part(v.what, ':', 2) limit 1)) as title,
               (select l.name from leagues l where l.slug = max(v.league) limit 1) as league
          from _vid v group by v.what order by count(*) filter (where v.played) desc, count(*) desc limit 50) x), '[]'::jsonb),
    'video_pages', coalesce((select jsonb_agg(x order by x.plays desc) from (
        select page, count(*) as opens, count(*) filter (where played) as plays, round(sum(secs) / 60.0) as minutes
          from _vid group by page order by 3 desc limit 20) x), '[]'::jsonb),
    'video_daily', coalesce((select jsonb_agg(x order by x.day) from (
        select (at at time zone 'UTC')::date as day, count(*) filter (where step = 'play') as plays,
               round(coalesce(sum(secs) filter (where step = 'watch'), 0) / 60.0) as minutes
          from _act where kind = 'video' group by 1) x), '[]'::jsonb),

    -- DOWNLOADS: what, in what format, from which page and about whom
    'downloads', coalesce((select jsonb_agg(x order by x.n desc) from (
        select a.what, a.fmt, a.page, count(*) as n, count(distinct a.session) as visits,
               coalesce(
                 (select trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) from players p where p.id::text = a.player limit 1),
                 (select h.name || ' v ' || w.name from games g join teams h on h.id = g.home_team_id join teams w on w.id = g.away_team_id where g.id = a.game),
                 (select t.name from teams t where t.slug = a.team limit 1),
                 (select l.name from leagues l where l.slug = a.league limit 1)) as about,
               case when a.player is not null then 'player' when a.game is not null then 'game'
                    when a.team is not null then 'club' when a.league is not null then 'league' end as about_kind
          from _act a where a.kind = 'download'
         group by a.what, a.fmt, a.page, a.player, a.game, a.team, a.league
         order by count(*) desc limit 100) x), '[]'::jsonb),
    'download_kinds', coalesce((select jsonb_agg(x order by x.n desc) from (
        select what, fmt, count(*) as n, count(distinct session) as visits
          from _act where kind = 'download' group by what, fmt order by 3 desc limit 40) x), '[]'::jsonb),

    'outbound', coalesce((select jsonb_agg(x order by x.n desc) from (
        select what as host, count(*) as n, count(distinct session) as visits, mode() within group (order by page) as page
          from _act where kind = 'out' group by what order by 2 desc limit 40) x), '[]'::jsonb),
    'shares', coalesce((select jsonb_agg(x order by x.n desc) from (
        select kind, what, page, count(*) as n from _act where kind in ('share', 'copy')
         group by kind, what, page order by 4 desc limit 40) x), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(x order by x.n desc) from (
        select page, what, count(*) as n, count(distinct session) as visits, max(at) as last_at
          from _act where kind = 'error' group by page, what order by 3 desc limit 40) x), '[]'::jsonb),
    'speed_devices', coalesce((select jsonb_agg(x order by x.device) from (
        select coalesce(device, 'unknown') as device, count(*) as n,
               percentile_cont(0.5) within group (order by ms) as median_ms, percentile_cont(0.75) within group (order by ms) as p75_ms
          from _act where kind = 'speed' group by 1) x), '[]'::jsonb),
    'embeds', coalesce((select jsonb_agg(x order by x.n desc) from (
        select page as widget, coalesce(what, '') as host, count(*) as n
          from _act where kind = 'embed' group by page, what order by 3 desc limit 40) x), '[]'::jsonb));
  return out;
end $$;
revoke all on function public.analytics_activity_build(int) from public, anon, authenticated;

create or replace function public.analytics_activity_report(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return public.analytics_activity_build(p_days);
end $$;
revoke all on function public.analytics_activity_report(int) from public, anon;
grant execute on function public.analytics_activity_report(int) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 400 days, like everything else counted
-- ----------------------------------------------------------------------------
create or replace function public.analytics_prune()
returns int language sql security definer set search_path = public as $$
  with a as (delete from site_events   where at < now() - interval '400 days' returning 1),
       b as (delete from site_searches where at < now() - interval '400 days' returning 1),
       c as (delete from site_activity where at < now() - interval '400 days' returning 1)
  select ((select count(*) from a) + (select count(*) from b) + (select count(*) from c))::int;
$$;
revoke all on function public.analytics_prune() from public, anon, authenticated;

alter table public.site_activity owner to postgres;
alter function public.analytics_activity(text, text, text, jsonb) owner to postgres;
alter function public.analytics_activity_build(integer) owner to postgres;
alter function public.analytics_activity_report(integer) owner to postgres;
alter function public.analytics_prune() owner to postgres;

-- ----------------------------------------------------------------------------
-- CHECKS: who may do what, and what a batch keeps (rolled back)
-- ----------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.site_activity', 'select') or has_table_privilege('authenticated', 'public.site_activity', 'select')
     or has_table_privilege('anon', 'public.site_activity', 'insert') or has_table_privilege('authenticated', 'public.site_activity', 'insert') then
    raise exception '0260: a browser role can reach site_activity directly';
  end if;
  if not has_function_privilege('anon', 'public.analytics_activity(text, text, text, jsonb)', 'execute') then
    raise exception '0260: a visitor cannot record activity';
  end if;
  if has_function_privilege('anon', 'public.analytics_activity_report(integer)', 'execute')
     or has_function_privilege('anon', 'public.analytics_activity_build(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.analytics_activity_build(integer)', 'execute') then
    raise exception '0260: the activity report is reachable by somebody who is not an administrator';
  end if;
end $$;

do $$
declare
  n int;
begin
  n := public.analytics_activity('Check0260Check0260Ab', 'phone', 'web', '[
    {"kind":"time","page":"game","secs":42,"depth":80},
    {"kind":"video","page":"home/video","what":"youtube:dQw4w9WgXcQ","step":"play"},
    {"kind":"download","page":"t","team":"london-lions","what":"report","fmt":"pdf"},
    {"kind":"out","page":"t","what":"tickets.example.com/seat/12"},
    {"kind":"download","page":"t","what":"Team Report.pdf"},
    {"kind":"error","page":"game","what":"TypeError: cannot read x of fan@example.org"},
    {"kind":"tab","page":"game","what":"box"}
  ]'::jsonb);
  if n <> 3 then
    raise exception '0260: a test batch kept % rows, expected 3 (an address, a free-text error and a file name must be refused)', n;
  end if;
  raise exception 'rollback-0260';
exception when raise_exception then
  if sqlerrm <> 'rollback-0260' then raise; end if;
end $$;

notify pgrst, 'reload schema';
