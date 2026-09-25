-- ============================================================================
-- 0173 — SITE ANALYTICS, PERMANENTLY ANONYMOUS.
--
-- The platform console's Analytics tab: which leagues and clubs are read, which box-score
-- tabs are opened, how each league page (table, statistics, WOWY, fixtures...) is used,
-- how many people are on the site now and per day, the signed-in share, EPINOIA GO's use,
-- devices, languages, the app against the browser, and where visitors arrive from.
--
-- ANONYMOUS BY CONSTRUCTION, not by policy. A row holds what the page was (its path and the
-- league / club / game in its address), a tab key when one was clicked, and four facts about
-- the visit that describe no one: signed in yes/no, phone / tablet / desktop, the language
-- the site was shown in, and the app or the browser. The referring SITE is kept as a host
-- name alone ("google.com") — never its path or query. There is NO account id, NO email, NO
-- IP address, NO user-agent string, NO cookie and NO identifier that outlives a browser tab:
-- `session` is a random token the page makes and keeps in sessionStorage, which the browser
-- deletes when the tab closes, and nothing in the database links it to anything else. So no
-- row can be tied back to a person, today or later — there is nothing to tie it with. The
-- privacy page says the same in plain words (docs: privacy/index.html, "Visit counts").
--
-- A browser that sends Global Privacy Control or Do Not Track, or whose owner switches
-- counting off on the privacy page, sends nothing at all (epinoia/track.js).
--
--   site_events           one row per page view or tab click; no browser role can read it
--   analytics_track()     the only way in: validates a batch and inserts it (anon, authed)
--   analytics_report()    platform administrators only: every figure the tab draws
--   analytics_prune()     raw rows older than 400 days go, daily (pg_cron where present)
-- ============================================================================

set local lock_timeout = '5s';

create table if not exists public.site_events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  kind      text not null check (kind in ('view', 'tab')),
  page      text not null check (page ~ '^[a-z0-9/-]{1,40}$'),
  league    text check (league ~ '^[a-z0-9-]{1,100}$'),
  team      text check (team ~ '^[a-z0-9-]{1,100}$'),
  game      uuid,
  tab       text check (tab ~ '^[a-z0-9_-]{1,40}$'),
  session   text not null check (session ~ '^[A-Za-z0-9_-]{16,40}$'),
  signed_in boolean not null default false,
  device    text check (device in ('phone', 'tablet', 'desktop')),
  lang      text check (lang ~ '^[a-z]{2}$'),
  app       text check (app in ('web', 'android', 'ios')),
  ref       text check (ref ~ '^[a-z0-9.-]{1,100}$')
);
create index if not exists site_events_at on public.site_events (at);
create index if not exists site_events_session_at on public.site_events (session, at);

alter table public.site_events enable row level security;
revoke all on table public.site_events from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- IN. One call carries a batch (the page flushes every few seconds and when it is hidden).
-- Every field is checked against the table's own rules and anything that fails is dropped,
-- not stored and not an error, so a stale page can never break. At most 50 events a call and
-- 300 per session in ten minutes: a script replaying one token cannot flood the table.
-- ----------------------------------------------------------------------------
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
  insert into site_events (kind, page, league, team, game, tab, session, signed_in, device, lang, app, ref)
  select e ->> 'kind',
         e ->> 'page',
         nullif(lower(e ->> 'league'), ''),
         nullif(lower(e ->> 'team'), ''),
         case when (e ->> 'game') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (e ->> 'game')::uuid end,
         case when e ->> 'kind' = 'tab' then lower(e ->> 'tab') end,
         p_session,
         coalesce(p_signed_in, false),
         case when p_device in ('phone', 'tablet', 'desktop') then p_device end,
         case when p_lang ~ '^[a-z]{2}$' then p_lang end,
         case when p_app in ('web', 'android', 'ios') then p_app else 'web' end,
         case when lower(p_ref) ~ '^[a-z0-9.-]{1,100}$' then lower(p_ref) end
    from jsonb_array_elements(p_events) with ordinality x(e, i)
   where x.i <= least(50, v_room)
     and jsonb_typeof(e) = 'object'
     and e ->> 'kind' in ('view', 'tab')
     and coalesce(e ->> 'page', '') ~ '^[a-z0-9/-]{1,40}$'
     and coalesce(lower(e ->> 'league'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'team'), '') ~ '^([a-z0-9-]{1,100})?$'
     and (e ->> 'kind' = 'view' or coalesce(lower(e ->> 'tab'), '') ~ '^[a-z0-9_-]{1,40}$');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.analytics_track(text, boolean, text, text, text, text, jsonb) from public;
grant execute on function public.analytics_track(text, boolean, text, text, text, text, jsonb) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- OUT. Everything the tab draws, for the last p_days days (1 = the last 24 hours), in one
-- call. A league is credited with a view when the page's address names it, names one of its
-- clubs, or names one of its games — so a club page and a box score count for their league.
-- analytics_build does the work and no browser role may call it; analytics_report is the
-- door, and only a platform administrator gets through.
-- ----------------------------------------------------------------------------
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
          from _an where kind = 'view' group by page) p), '[]'::jsonb),

    'leagues', coalesce((select jsonb_agg(x order by x.views desc) from (
        select l.slug, l.name, count(*) as views, count(distinct a.session) as sessions,
               count(distinct a.session) filter (where a.signed_in) as signed_in
          from _an a join leagues l on l.id = a.league_id
         where a.kind = 'view' group by l.slug, l.name
         order by views desc limit 40) x), '[]'::jsonb),

    -- how each league's own pages are used, for the most read leagues
    'league_pages', coalesce((select jsonb_agg(x) from (
        select l.slug, a.page, count(*) as views
          from _an a join leagues l on l.id = a.league_id
         where a.kind = 'view'
           and a.league_id in (select league_id from _an where kind = 'view' and league_id is not null
                                group by league_id order by count(*) desc limit 12)
         group by l.slug, a.page) x), '[]'::jsonb),

    'teams', coalesce((select jsonb_agg(x order by x.views desc) from (
        select t.slug, t.name, l.name as league, count(*) as views, count(distinct a.session) as sessions
          from _an a join teams t on t.slug = a.team left join leagues l on l.id = t.league_id
         where a.kind = 'view' group by t.slug, t.name, l.name
         order by views desc limit 40) x), '[]'::jsonb),

    'games', coalesce((select jsonb_agg(x order by x.views desc) from (
        select g.id, h.name as home, w.name as away, g.tipoff_at, l.name as league,
               count(*) as views, count(distinct a.session) as sessions
          from _an a join games g on g.id = a.game
          join teams h on h.id = g.home_team_id join teams w on w.id = g.away_team_id
          left join leagues l on l.id = a.league_id
         where a.kind = 'view' group by g.id, h.name, w.name, g.tipoff_at, l.name
         order by views desc limit 20) x), '[]'::jsonb),

    'game_tabs', coalesce((select jsonb_agg(x order by x.clicks desc) from (
        select tab, count(*) as clicks, count(distinct session) as sessions
          from _an where kind = 'tab' and page = 'game' group by tab) x), '[]'::jsonb),

    'tabs', coalesce((select jsonb_agg(x order by x.clicks desc) from (
        select page, tab, count(*) as clicks, count(distinct session) as sessions
          from _an where kind = 'tab' and page <> 'game' group by page, tab
         order by clicks desc limit 60) x), '[]'::jsonb),

    'go', (select jsonb_build_object(
        'views',    count(*) filter (where kind = 'view' and (page = 'go' or page like 'go/%')),
        'sessions', count(distinct session) filter (where page = 'go' or page like 'go/%'),
        'signed_in_sessions', count(distinct session) filter (where (page = 'go' or page like 'go/%') and signed_in),
        'pages', coalesce((select jsonb_agg(x order by x.views desc) from (
            select page, count(*) as views from _an
             where kind = 'view' and (page = 'go' or page like 'go/%') group by page) x), '[]'::jsonb),
        'tabs', coalesce((select jsonb_agg(x order by x.clicks desc) from (
            select tab, count(*) as clicks from _an
             where kind = 'tab' and (page = 'go' or page like 'go/%') group by tab) x), '[]'::jsonb))
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
         order by sessions desc limit 20) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.analytics_build(int) from public, anon, authenticated;
grant execute on function public.analytics_build(int) to service_role;

create or replace function public.analytics_report(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return public.analytics_build(p_days);
end $$;
revoke all on function public.analytics_report(int) from public, anon;
grant execute on function public.analytics_report(int) to authenticated, service_role;

create or replace function public.analytics_prune()
returns int language sql security definer set search_path = public as $$
  with gone as (delete from site_events where at < now() - interval '400 days' returning 1)
  select count(*)::int from gone;
$$;
revoke all on function public.analytics_prune() from public, anon, authenticated;

alter table public.site_events owner to postgres;
alter function public.analytics_track(text, boolean, text, text, text, text, jsonb) owner to postgres;
alter function public.analytics_build(int) owner to postgres;
alter function public.analytics_report(int) owner to postgres;
alter function public.analytics_prune() owner to postgres;

-- ----------------------------------------------------------------------------
-- The daily prune, where pg_cron exists (0121 created it on this project).
-- ----------------------------------------------------------------------------
do $cron$
begin
  if to_regclass('cron.job') is not null then
    begin
      execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-analytics-prune'::text;
      execute 'select cron.schedule($1, $2, $3)'
        using 'epinoia-analytics-prune'::text, '17 4 * * *'::text, 'select public.analytics_prune()'::text;
      raise notice '0173: pg_cron job epinoia-analytics-prune deletes raw rows over 400 days old, daily at 04:17 UTC';
    exception when others then
      raise warning '0173: the prune job was not scheduled (%: %); run select public.analytics_prune() by hand now and then', sqlstate, sqlerrm;
    end;
  else
    raise notice '0173: pg_cron is not installed here; run select public.analytics_prune() by hand now and then';
  end if;
end $cron$;

-- ============================================================================
-- SELF-TEST — rolled back. As a signed-out browser: a valid batch goes in, every malformed
-- field is dropped rather than stored, and the table cannot be read. The report builds with
-- a league credited through a club and through a game, and refuses anyone who is not a
-- platform administrator.
-- ============================================================================
do $test$
declare
  who  text := current_user || ' (session ' || session_user || ')';
  orig text := current_user;
  lg uuid; se uuid; cp uuid; t_h uuid; t_a uuid; g uuid;
  n int; r jsonb; tok text := 'zzt173' || replace(gen_random_uuid()::text, '-', '');
begin
  begin
    insert into leagues (slug, name, public_live) values ('zz-t173-open', '0173 Open', true) returning id into lg;
    insert into seasons (league_id, name) values (lg, '0173') returning id into se;
    insert into competitions (season_id, name) values (se, 'T173 League') returning id into cp;
    insert into teams (league_id, slug, name, short_name) values (lg, 'zz-t173-home', 'Home Club', 'HOM') returning id into t_h;
    insert into teams (league_id, slug, name, short_name) values (lg, 'zz-t173-away', 'Away Club', 'AWY') returning id into t_a;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp, t_h, t_a, now(), 'final') returning id into g;

    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    n := public.analytics_track(tok, true, 'phone', 'ja', 'android', 'Google.com', jsonb_build_array(
      jsonb_build_object('kind', 'view', 'page', 'l', 'league', 'zz-t173-open'),
      jsonb_build_object('kind', 'view', 'page', 't', 'team', 'zz-t173-home'),
      jsonb_build_object('kind', 'view', 'page', 'game', 'game', g),
      jsonb_build_object('kind', 'tab',  'page', 'game', 'game', g, 'tab', 'shotclock'),
      jsonb_build_object('kind', 'view', 'page', 'go'),
      jsonb_build_object('kind', 'view', 'page', 'Bad Page!'),
      jsonb_build_object('kind', 'tab',  'page', 'game', 'tab', 'drop table x;'),
      jsonb_build_object('kind', 'buy',  'page', 'l')));
    if n <> 5 then
      execute format('set local role %I', orig);
      raise exception '0173: a batch of 5 good and 3 malformed events stored %, not 5', n;
    end if;
    if public.analytics_track('short', false, 'phone', 'en', 'web', null, '[{"kind":"view","page":"home"}]') <> 0 then
      execute format('set local role %I', orig);
      raise exception '0173: a malformed session token was accepted';
    end if;
    begin
      perform count(*) from public.site_events;
      execute format('set local role %I', orig);
      raise exception '0173: a signed-out browser can read site_events';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.analytics_report(30);
      execute format('set local role %I', orig);
      raise exception '0173: analytics_report answered someone who is not a platform administrator';
    exception when insufficient_privilege then null;
    end;
    execute format('set local role %I', orig);

    if exists (select 1 from site_events where session = tok and (ref <> 'google.com' or lang <> 'ja' or app <> 'android')) then
      raise exception '0173: the visit facts were not stored as sent (host lower-cased)';
    end if;

    r := public.analytics_build(1);
    if (select (x ->> 'views')::int from jsonb_array_elements(r -> 'leagues') x where x ->> 'slug' = 'zz-t173-open') is distinct from 3 then
      raise exception '0173: the league was not credited with its own page, its club''s and its game''s (%)', r -> 'leagues';
    end if;
    if not exists (select 1 from jsonb_array_elements(r -> 'game_tabs') x where x ->> 'tab' = 'shotclock') then
      raise exception '0173: the box-score tab click is missing from game_tabs';
    end if;
    if coalesce((r -> 'go' ->> 'views')::int, 0) < 1 then
      raise exception '0173: the EPINOIA GO view is missing';
    end if;

    raise exception using errcode = 'P0173', message = '0173 passed; rolling its test rows back';
  exception
    when sqlstate 'P0173' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;
  if exists (select 1 from leagues where slug like 'zz-t173-%') or exists (select 1 from site_events where session like 'zzt173%') then
    raise exception '0173: the test rows outlived their rollback';
  end if;
  raise notice '0173 ok: anonymous events go in through analytics_track only, malformed fields are dropped, browsers cannot read them, the report credits leagues through clubs and games and answers platform administrators only';
end $test$;
