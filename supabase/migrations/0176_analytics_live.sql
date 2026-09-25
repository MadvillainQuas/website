-- ============================================================================
-- 0176 - THE ANALYTICS TAB: EVERY LIST CAPPED, AND A LIVE-NOW VIEW.
--
-- 1. analytics_build (0173's, replaced) had lists that could only grow: the pages table had no limit
--    at all, and the games, clubs and leagues lists were short (20, 40) or unbounded in the browser.
--    Every list now stops at a fixed number of rows (100; league-by-league pages 600, referrers and the
--    GO lists 50) so one report can never balloon, and the console shows a fixed height of them at a time
--    and scrolls. The body below is 0173's own text with only those limits changed.
--
-- 2. analytics_live(p_window_s): what the people on the site are doing RIGHT NOW - which page each is on
--    (and which box-score tab), what is being watched, where they are by league, and the last few things
--    that happened. Platform administrators only, like the report.
--
-- STILL ANONYMOUS, and no less so: it reads the same site_events rows (no account, no email, no IP address,
-- no cookie, no identifier that outlives a tab). The session token that groups a tab's rows is used INSIDE
-- the query to find each visitor's latest page and is never returned: a "visitor" in the answer is a line
-- (page, tab, device, language, app, signed in yes/no, seconds since it moved) with nothing that could be
-- followed from one refresh to the next or tied to anyone. The feed carries no session at all.
--
-- "Live" is the last five minutes of activity (the window is a parameter, one to thirty minutes): the tracker
-- sends an event when a page opens and when a tab is clicked, so somebody reading one page for longer than
-- the window falls out of "now" until they do something.
-- ============================================================================

set local lock_timeout = '5s';

create or replace function public.analytics_build(p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 400));
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
  out    jsonb;
begin
  -- the range, joined once to the league each row counts for; every figure below reads this
  drop table if exists pg_temp._an;
  create temp table _an on commit drop as
  select e.*, coalesce(l.id, t.league_id, s.league_id) as league_id
    from site_events e
    left join leagues l      on l.slug = e.league
    left join teams t        on t.slug = e.team
    left join games g        on g.id = e.game
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
   where e.at >= v_from;

  select jsonb_build_object(
    'range', jsonb_build_object('days', v_days, 'from', v_from, 'to', now()),

    'totals', (select jsonb_build_object(
        'views',       count(*) filter (where kind = 'view'),
        'tab_clicks',  count(*) filter (where kind = 'tab'),
        'sessions',    count(distinct session),
        'signed_in_sessions', count(distinct session) filter (where signed_in))
      from _an),

    -- the moment, whatever the range: the last five minutes
    'live', (select jsonb_build_object(
        'sessions',  count(distinct session),
        'signed_in', count(distinct session) filter (where signed_in),
        'views',     count(*) filter (where kind = 'view'))
      from site_events where at > now() - interval '5 minutes'),

    'daily', coalesce((select jsonb_agg(d order by d.day) from (
        select date_trunc('day', at)::date as day,
               count(*) filter (where kind = 'view') as views,
               count(distinct session) as sessions,
               count(distinct session) filter (where signed_in) as signed_in
          from _an group by 1) d), '[]'::jsonb),

    'hourly', coalesce((select jsonb_agg(h order by h.hour) from (
        select extract(hour from at)::int as hour, count(*) as views
          from _an where kind = 'view' group by 1) h), '[]'::jsonb),

    'pages', coalesce((select jsonb_agg(p order by p.views desc) from (
        select page, count(*) as views, count(distinct session) as sessions
          from _an where kind = 'view' group by page
         order by views desc limit 100) p), '[]'::jsonb),

    'leagues', coalesce((select jsonb_agg(x order by x.views desc) from (
        select l.slug, l.name, count(*) as views, count(distinct a.session) as sessions,
               count(distinct a.session) filter (where a.signed_in) as signed_in
          from _an a join leagues l on l.id = a.league_id
         where a.kind = 'view' group by l.slug, l.name
         order by views desc limit 100) x), '[]'::jsonb),

    -- how each league's own pages are used, for the most read leagues
    'league_pages', coalesce((select jsonb_agg(x) from (
        select l.slug, a.page, count(*) as views
          from _an a join leagues l on l.id = a.league_id
         where a.kind = 'view'
           and a.league_id in (select league_id from _an where kind = 'view' and league_id is not null
                                group by league_id order by count(*) desc limit 12)
         group by l.slug, a.page
         order by views desc limit 600) x), '[]'::jsonb),

    'teams', coalesce((select jsonb_agg(x order by x.views desc) from (
        select t.slug, t.name, l.name as league, count(*) as views, count(distinct a.session) as sessions
          from _an a join teams t on t.slug = a.team left join leagues l on l.id = t.league_id
         where a.kind = 'view' group by t.slug, t.name, l.name
         order by views desc limit 100) x), '[]'::jsonb),

    'games', coalesce((select jsonb_agg(x order by x.views desc) from (
        select g.id, h.name as home, w.name as away, g.tipoff_at, l.name as league,
               count(*) as views, count(distinct a.session) as sessions
          from _an a join games g on g.id = a.game
          join teams h on h.id = g.home_team_id join teams w on w.id = g.away_team_id
          left join leagues l on l.id = a.league_id
         where a.kind = 'view' group by g.id, h.name, w.name, g.tipoff_at, l.name
         order by views desc limit 100) x), '[]'::jsonb),

    'game_tabs', coalesce((select jsonb_agg(x order by x.clicks desc) from (
        select tab, count(*) as clicks, count(distinct session) as sessions
          from _an where kind = 'tab' and page = 'game' group by tab
         order by clicks desc limit 50) x), '[]'::jsonb),

    'tabs', coalesce((select jsonb_agg(x order by x.clicks desc) from (
        select page, tab, count(*) as clicks, count(distinct session) as sessions
          from _an where kind = 'tab' and page <> 'game' group by page, tab
         order by clicks desc limit 100) x), '[]'::jsonb),

    'go', (select jsonb_build_object(
        'views',    count(*) filter (where kind = 'view' and (page = 'go' or page like 'go/%')),
        'sessions', count(distinct session) filter (where page = 'go' or page like 'go/%'),
        'signed_in_sessions', count(distinct session) filter (where (page = 'go' or page like 'go/%') and signed_in),
        'pages', coalesce((select jsonb_agg(x order by x.views desc) from (
            select page, count(*) as views from _an
             where kind = 'view' and (page = 'go' or page like 'go/%') group by page
             order by views desc limit 50) x), '[]'::jsonb),
        'tabs', coalesce((select jsonb_agg(x order by x.clicks desc) from (
            select tab, count(*) as clicks from _an
             where kind = 'tab' and (page = 'go' or page like 'go/%') group by tab
             order by clicks desc limit 50) x), '[]'::jsonb))
      from _an),

    -- per SESSION, not per view: a phone that reads twenty pages is still one phone
    'devices', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select coalesce(device, 'unknown') as k, count(distinct session) as sessions
          from _an group by 1) x), '[]'::jsonb),
    'langs', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select coalesce(lang, 'unknown') as k, count(distinct session) as sessions
          from _an group by 1) x), '[]'::jsonb),
    'apps', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select coalesce(app, 'web') as k, count(distinct session) as sessions
          from _an group by 1) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select ref as host, count(distinct session) as sessions
          from _an where ref is not null group by ref
         order by sessions desc limit 50) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;

revoke all on function public.analytics_build(int) from public, anon, authenticated;
grant execute on function public.analytics_build(int) to service_role;
alter function public.analytics_build(int) owner to postgres;

-- ----------------------------------------------------------------------------
-- LIVE. One row per tab active in the window (its latest page view, and the tab clicked on it since), joined
-- once to the names; every figure reads that. site_events_session_at makes each latest-row lookup an index read.
-- ----------------------------------------------------------------------------
create or replace function public.analytics_live_build(p_window_s int default 300)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_secs int := greatest(60, least(coalesce(p_window_s, 300), 1800));
  v_now  timestamptz := now();
  out    jsonb;
begin
  drop table if exists pg_temp._lv;
  create temp table _lv on commit drop as
  with seen as (
    select session, max(at) as at from site_events
     where at > v_now - make_interval(secs => v_secs) group by session
  )
  select v.page, tb.tab, v.league as league_slug,
         coalesce(l.id, t.league_id, cs.league_id) as league_id,
         lg.name as league_name, t.name as club, g.id as game_id,
         h.name as home, w.name as away, g.status as game_status, g.tipoff_at,
         v.signed_in, v.device, v.lang, v.app,
         s.at as seen_at, v.at as view_at
    from seen s
    join lateral (select * from site_events x where x.session = s.session and x.kind = 'view'
                   order by x.at desc limit 1) v on true
    left join lateral (select y.tab from site_events y where y.session = s.session and y.kind = 'tab'
                        and y.at >= v.at order by y.at desc limit 1) tb on true
    left join leagues l       on l.slug = v.league
    left join teams t         on t.slug = v.team
    left join games g         on g.id = v.game
    left join teams h         on h.id = g.home_team_id
    left join teams w         on w.id = g.away_team_id
    left join competitions c  on c.id = g.competition_id
    left join seasons cs      on cs.id = c.season_id
    left join leagues lg      on lg.id = coalesce(l.id, t.league_id, cs.league_id);

  select jsonb_build_object(
    'at', v_now,
    'window_s', v_secs,
    'sessions', (select count(*) from _lv),
    'signed_in', (select count(*) from _lv where signed_in),
    'last_30m', (select count(distinct session) from site_events where at > v_now - interval '30 minutes'),

    'devices', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select coalesce(device, 'unknown') as k, count(*) as sessions from _lv group by 1) x), '[]'::jsonb),
    'apps', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select coalesce(app, 'web') as k, count(*) as sessions from _lv group by 1) x), '[]'::jsonb),
    'langs', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select coalesce(lang, 'unknown') as k, count(*) as sessions from _lv group by 1) x), '[]'::jsonb),

    -- where they are: the page each is on now
    'where', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select page, count(*) as sessions from _lv group by page order by sessions desc limit 30) x), '[]'::jsonb),

    'leagues', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select league_name as name, count(*) as sessions from _lv
         where league_name is not null group by league_name order by sessions desc limit 20) x), '[]'::jsonb),

    -- what is being watched: games open right now, and the box-score tab each visitor is on
    'games', coalesce((select jsonb_agg(x order by x.sessions desc, x.tipoff_at desc) from (
        select game_id as id, home, away, league_name as league, game_status as status, tipoff_at, count(*) as sessions
          from _lv where game_id is not null
         group by game_id, home, away, league_name, game_status, tipoff_at
         order by sessions desc, tipoff_at desc limit 20) x), '[]'::jsonb),
    'tabs', coalesce((select jsonb_agg(x order by x.sessions desc) from (
        select tab, count(*) as sessions from _lv where page = 'game' and tab is not null
         group by tab order by sessions desc limit 20) x), '[]'::jsonb),

    -- each visitor as a line, most recently active first; nothing in it identifies or can be followed
    'visitors', coalesce((select jsonb_agg(x) from (
        select page, tab, league_name as league, club, home, away, game_status as status,
               device, lang, app, signed_in,
               extract(epoch from (v_now - seen_at))::int as idle_s,
               extract(epoch from (v_now - view_at))::int as on_page_s
          from _lv order by seen_at desc limit 60) x), '[]'::jsonb),

    -- the last things that happened, newest first; no session on any line
    'feed', coalesce((select jsonb_agg(x order by x.ago_s) from (
        select extract(epoch from (v_now - e.at))::int as ago_s, e.kind, e.page, e.tab,
               lg.name as league, t.name as club, h.name as home, w.name as away
          from site_events e
          left join leagues l on l.slug = e.league
          left join teams t   on t.slug = e.team
          left join games g   on g.id = e.game
          left join teams h   on h.id = g.home_team_id
          left join teams w   on w.id = g.away_team_id
          left join competitions c on c.id = g.competition_id
          left join seasons cs on cs.id = c.season_id
          left join leagues lg on lg.id = coalesce(l.id, t.league_id, cs.league_id)
         where e.at > v_now - interval '30 minutes'
         order by e.at desc limit 40) x), '[]'::jsonb),

    -- views a minute over the last half hour, minute 0 = now
    'per_minute', coalesce((select jsonb_agg(m order by m.ago_min desc) from (
        select gs.i as ago_min,
               count(e.id) filter (where e.kind = 'view') as views,
               count(distinct e.session) as sessions
          from generate_series(0, 29) gs(i)
          left join site_events e on e.at > v_now - make_interval(mins => gs.i + 1)
                                 and e.at <= v_now - make_interval(mins => gs.i)
         group by gs.i) m), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.analytics_live_build(int) from public, anon, authenticated;
grant execute on function public.analytics_live_build(int) to service_role;
alter function public.analytics_live_build(int) owner to postgres;

create or replace function public.analytics_live(p_window_s int default 300)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return public.analytics_live_build(p_window_s);
end $$;
revoke all on function public.analytics_live(int) from public, anon;
grant execute on function public.analytics_live(int) to authenticated, service_role;
alter function public.analytics_live(int) owner to postgres;

-- ----------------------------------------------------------------------------
-- A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.analytics_live(int)', 'execute')
     or has_function_privilege('anon', 'public.analytics_live_build(int)', 'execute')
     or has_function_privilege('authenticated', 'public.analytics_live_build(int)', 'execute') then
    raise exception '0176: a browser role can reach the live analytics';
  end if;
  if not has_function_privilege('authenticated', 'public.analytics_live(int)', 'execute') then
    raise exception '0176: a signed-in administrator cannot call analytics_live';
  end if;
  raise notice '0176 ok: the analytics lists are capped, and analytics_live answers platform administrators only';
end $$;
