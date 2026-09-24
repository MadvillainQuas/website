-- ============================================================================
-- 0155 — THE NOTIFICATION TICK STOPS WORKING OUT ITS AUDIENCE EVERY MINUTE.
--
-- notify_tick runs every minute, all day, whether or not anybody is watching.
-- Measured on 2026-09-24 (ops_query_stats, 0154): 116 ms a run on average, the
-- single most expensive thing the database does on its own, and the steps it
-- calls cost about 14 ms for every game in a reminder window.
--
-- WHERE IT GOES. Every fan-out reads notify_audience, and notify_audience is a
-- view that works each subscriber out afresh, per statement, per game:
--   * a fan who follows a league has that league's clubs looked up
--     (`select array_agg(t.id) from teams t where t.league_id = any (...)`),
--     a full scan of teams, once for EVERY reference to fav_team_ids: the view
--     is inlined, so a query that names the column three times scans three
--     times. teams had been sequentially scanned 6.7 million times;
--   * every subscriber's time zone is re-validated by notify_valid_tz, a
--     PL/pgSQL call with an exception block (a subtransaction) per row.
-- The answers only change when a fan or device changes its preferences, or a
-- club joins or leaves a league.
--
-- WHAT CHANGES.
--   1. The view's definition moves, character for character, to
--      notify_audience_source: still the ONE statement of who hears about
--      what.
--   2. notify_audience_rows holds its answer, one row per fan and per device.
--      Triggers keep it exact: a fan's or device's row is rebuilt from the
--      source when their preferences change, and league followers' clubs when
--      a club joins, leaves or moves league. The tick also rebuilds the whole
--      table at seven minutes past every hour, which repairs anything a trigger
--      could not see (a time zone name dropped by a tzdata update, a truncate).
--   3. notify_audience becomes a plain view of that table, with the same
--      columns in the same order, so every fan-out reads it unchanged. No
--      fan-out function is redefined here.
--   4. notify_tick asks a fan-out only when there is a game it could act on:
--      a fixture in a reminder window, a game near tip-off with complete
--      starters, a live game paused in the last half hour. Each check is the
--      fan-out's own game filter without its joins, so it can only ever be
--      broader than the fan-out, never narrower.
--   5. pg_cron's own run history (cron.job_run_details) is trimmed to a week
--      each night. It gained a row per job run, ~1,700 a day, and was never
--      cleared.
--
-- Nothing about who is notified of what changes. The self-test at the end
-- proves the stored audience equals the source, row for row, and that the
-- triggers follow a device through insert, update and delete (rolled back).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE SOURCE: 0145's notify_audience, character for character.
-- ----------------------------------------------------------------------------
create or replace view public.notify_audience_source as
  select p.user_id, null::uuid as device_id, p.user_id as sub,
         case when cardinality(p.fav_league_ids) = 0 then p.fav_team_ids
              else array(select distinct y
                           from unnest(p.fav_team_ids ||
                                       coalesce((select array_agg(t.id) from teams t
                                                  where t.league_id = any (p.fav_league_ids)),
                                                '{}'::uuid[])) y)
         end as fav_team_ids,
         p.fav_player_ids, p.fav_game_ids,
         p.want_results, p.want_players, p.want_fixtures, p.want_announcements,
         p.want_fixture_2d, p.want_fixture_2h, p.want_lineups, p.want_player_games, p.want_halftime,
         p.fav_league_ids,
         public.notify_valid_tz(p.time_zone) as time_zone
    from public.fan_prefs p
  union all
  select null::uuid, d.id, d.id,
         d.fav_team_ids, d.fav_player_ids, d.fav_game_ids,
         d.want_results, d.want_players, true, d.want_announcements,
         d.want_fixture_2d, d.want_fixture_2h, d.want_lineups, true, d.want_halftime,
         '{}'::uuid[],
         public.notify_valid_tz(d.time_zone)
    from public.push_devices d;
revoke all on table public.notify_audience_source from public, anon, authenticated;
alter view public.notify_audience_source owner to postgres;

-- ----------------------------------------------------------------------------
-- 2. THE STORED ANSWER. Its columns are the source's, types included, because
--    it is made from it.
-- ----------------------------------------------------------------------------
create table if not exists public.notify_audience_rows as
  select * from public.notify_audience_source with no data;
alter table public.notify_audience_rows enable row level security;
revoke all on table public.notify_audience_rows from public, anon, authenticated;
alter table public.notify_audience_rows owner to postgres;
-- ONE ROW PER SUBSCRIBER, enforced: a fan is keyed by their user id, a device by its own id
-- (the second column keeps the two id spaces apart). Every write below is an upsert on it,
-- so a preference saved while the hourly rebuild runs can never leave two rows behind.
create unique index if not exists notify_audience_rows_key
  on public.notify_audience_rows (sub, (device_id is null));
create index if not exists notify_audience_rows_leagues
  on public.notify_audience_rows using gin (fav_league_ids);

-- the whole table, from the source (the tick, hourly; and this file, once): rows that
-- differ are rewritten, rows whose subscriber has gone are removed, the rest are left alone
create or replace function public.notify_audience_refresh()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into notify_audience_rows as r
  select s.* from notify_audience_source s
  on conflict (sub, (device_id is null)) do update
    set user_id = excluded.user_id, device_id = excluded.device_id,
        fav_team_ids = excluded.fav_team_ids, fav_player_ids = excluded.fav_player_ids,
        fav_game_ids = excluded.fav_game_ids, want_results = excluded.want_results,
        want_players = excluded.want_players, want_fixtures = excluded.want_fixtures,
        want_announcements = excluded.want_announcements, want_fixture_2d = excluded.want_fixture_2d,
        want_fixture_2h = excluded.want_fixture_2h, want_lineups = excluded.want_lineups,
        want_player_games = excluded.want_player_games, want_halftime = excluded.want_halftime,
        fav_league_ids = excluded.fav_league_ids, time_zone = excluded.time_zone
    where row(r.*) is distinct from row(excluded.*);
  delete from notify_audience_rows r
   where not exists (select 1 from notify_audience_source s
                      where s.sub = r.sub and (s.device_id is null) = (r.device_id is null));
  select count(*) into n from notify_audience_rows;
  return n;
end $$;
revoke all on function public.notify_audience_refresh() from public, anon, authenticated;
grant execute on function public.notify_audience_refresh() to service_role;
alter function public.notify_audience_refresh() owner to postgres;

-- one fan's or one device's row, when their preferences change
create or replace function public.notify_audience_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'fan_prefs' then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.user_id is distinct from new.user_id) then
      delete from notify_audience_rows r where r.device_id is null and r.sub = old.user_id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      insert into notify_audience_rows as r
      select s.* from notify_audience_source s where s.device_id is null and s.user_id = new.user_id
      on conflict (sub, (device_id is null)) do update
        set user_id = excluded.user_id, device_id = excluded.device_id,
            fav_team_ids = excluded.fav_team_ids, fav_player_ids = excluded.fav_player_ids,
            fav_game_ids = excluded.fav_game_ids, want_results = excluded.want_results,
            want_players = excluded.want_players, want_fixtures = excluded.want_fixtures,
            want_announcements = excluded.want_announcements, want_fixture_2d = excluded.want_fixture_2d,
            want_fixture_2h = excluded.want_fixture_2h, want_lineups = excluded.want_lineups,
            want_player_games = excluded.want_player_games, want_halftime = excluded.want_halftime,
            fav_league_ids = excluded.fav_league_ids, time_zone = excluded.time_zone;
    end if;
  else
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.id is distinct from new.id) then
      delete from notify_audience_rows r where r.device_id is not null and r.sub = old.id;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      insert into notify_audience_rows as r
      select s.* from notify_audience_source s where s.device_id = new.id
      on conflict (sub, (device_id is null)) do update
        set user_id = excluded.user_id, device_id = excluded.device_id,
            fav_team_ids = excluded.fav_team_ids, fav_player_ids = excluded.fav_player_ids,
            fav_game_ids = excluded.fav_game_ids, want_results = excluded.want_results,
            want_players = excluded.want_players, want_fixtures = excluded.want_fixtures,
            want_announcements = excluded.want_announcements, want_fixture_2d = excluded.want_fixture_2d,
            want_fixture_2h = excluded.want_fixture_2h, want_lineups = excluded.want_lineups,
            want_player_games = excluded.want_player_games, want_halftime = excluded.want_halftime,
            fav_league_ids = excluded.fav_league_ids, time_zone = excluded.time_zone;
    end if;
  end if;
  return null;
end $$;
revoke all on function public.notify_audience_sync() from public, anon, authenticated;
alter function public.notify_audience_sync() owner to postgres;

-- the league followers of a league a club joined, left or moved from
create or replace function public.notify_audience_clubs_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_leagues uuid[];
begin
  if tg_op = 'INSERT' then
    v_leagues := array[new.league_id];
  elsif tg_op = 'DELETE' then
    v_leagues := array[old.league_id];
  else
    v_leagues := array[old.league_id, new.league_id];
  end if;
  v_leagues := array_remove(v_leagues, null);
  if cardinality(v_leagues) = 0 then
    return null;
  end if;
  update notify_audience_rows r
     set fav_team_ids = s.fav_team_ids
    from notify_audience_source s
   where r.device_id is null and s.device_id is null and s.user_id = r.user_id
     and r.fav_league_ids && v_leagues;
  return null;
end $$;
revoke all on function public.notify_audience_clubs_sync() from public, anon, authenticated;
alter function public.notify_audience_clubs_sync() owner to postgres;

drop trigger if exists notify_audience_fans on public.fan_prefs;
create trigger notify_audience_fans
  after insert or update or delete on public.fan_prefs
  for each row execute function public.notify_audience_sync();

-- a push stamps last_push_* on the device; only the columns the audience reads rebuild it
drop trigger if exists notify_audience_devices on public.push_devices;
create trigger notify_audience_devices
  after insert or delete on public.push_devices
  for each row execute function public.notify_audience_sync();
drop trigger if exists notify_audience_devices_prefs on public.push_devices;
create trigger notify_audience_devices_prefs
  after update of fav_team_ids, fav_player_ids, fav_game_ids, want_results, want_players,
                  want_announcements, want_fixture_2d, want_fixture_2h, want_lineups, want_halftime,
                  time_zone
  on public.push_devices
  for each row execute function public.notify_audience_sync();

drop trigger if exists notify_audience_clubs on public.teams;
create trigger notify_audience_clubs
  after insert or delete on public.teams
  for each row execute function public.notify_audience_clubs_sync();
drop trigger if exists notify_audience_clubs_moved on public.teams;
create trigger notify_audience_clubs_moved
  after update of league_id on public.teams
  for each row when (old.league_id is distinct from new.league_id)
  execute function public.notify_audience_clubs_sync();

-- ----------------------------------------------------------------------------
-- 3. FILL IT, THEN POINT THE FAN-OUTS AT IT. Same columns, same order, so this
--    is a CREATE OR REPLACE (the grants and every function naming it stay).
-- ----------------------------------------------------------------------------
select public.notify_audience_refresh();

create or replace view public.notify_audience as
  select r.user_id, r.device_id, r.sub,
         r.fav_team_ids, r.fav_player_ids, r.fav_game_ids,
         r.want_results, r.want_players, r.want_fixtures, r.want_announcements,
         r.want_fixture_2d, r.want_fixture_2h, r.want_lineups, r.want_player_games, r.want_halftime,
         r.fav_league_ids, r.time_zone
    from public.notify_audience_rows r;
revoke all on table public.notify_audience from public, anon, authenticated;
alter view public.notify_audience owner to postgres;

-- ----------------------------------------------------------------------------
-- 4. notify_tick (latest: 0127), character for character but for the three
--    `if exists` guards and the hourly rebuild (both marked 0155).
-- ----------------------------------------------------------------------------
create or replace function public.notify_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fixtures int := 0;
  v_lineups  int := 0;
  v_halftime int := 0;
  v_audience int;
  v_cleared  int := 0;
  v_waiting  int := 0;
  v_net      boolean;
  v_called   boolean := false;
  v_request  bigint;
  v_errors   jsonb := '[]'::jsonb;
  v_result   jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('epinoia.notify_tick', 0)) then
    return jsonb_build_object('skipped', 'another tick is running');
  end if;

  -- 0155: the stored audience rebuilt whole once an hour
  if extract(minute from now())::int = 7 then
    begin
      v_audience := public.notify_audience_refresh();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'audience', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;

  -- 0155: notify_fixture_windows' own game filter
  if exists (select 1 from games g
              where g.status = 'scheduled'
                and (   (g.tipoff_at > now() + interval '44 hours' and g.tipoff_at <= now() + interval '48 hours')
                     or (g.tipoff_at > now() and g.tipoff_at <= now() + interval '2 hours'))) then
    begin
      v_fixtures := public.notify_fixture_windows();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'fixtures', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
  -- 0155: notify_lineups' own game filter
  if exists (select 1 from games gm
              where gm.status in ('scheduled', 'live')
                and gm.tipoff_at >= now() - interval '30 minutes'
                and gm.tipoff_at <= now() + interval '6 hours'
                and public.notif_starters_complete(gm.starters)) then
    begin
      v_lineups := public.notify_lineups();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'lineups', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
  -- 0155: notify_halftime's own game filter, without its joins and event checks
  if exists (select 1 from games gm
               join game_state gs on gs.game_id = gm.id
              where gm.status = 'live'
                and not gs.running
                and gs.updated_at >= now() - interval '30 minutes') then
    begin
      v_halftime := public.notify_halftime();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'halftime', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
  begin
    delete from notifications n where n.device_id is not null and n.created_at < now() - interval '7 days';
    get diagnostics v_cleared = row_count;
  exception when others then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'clear', 'sqlstate', sqlstate, 'message', sqlerrm));
  end;

  select count(*) into v_waiting
    from (select 1
            from notifications n
           where n.pushed_at is null
             and n.created_at >= now() - interval '3 days'
             and (n.expires_at is null or n.expires_at > now())
             and (n.device_id is not null
                  or exists (select 1 from fan_prefs p where p.user_id = n.user_id and p.notify_push))
           limit 1000) x;

  v_net := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
  if v_waiting > 0 and v_net then
    begin
      execute 'select net.http_post(url := $1, body := $2, params := $3, headers := $4, timeout_milliseconds := $5)'
         into v_request
        using 'https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/notify'::text,
              jsonb_build_object('source', 'tick'),
              '{}'::jsonb,
              jsonb_build_object('Content-Type', 'application/json',
                                 'apikey', 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO'),
              5000;
      v_called := true;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'call', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;

  v_result := jsonb_build_object('ran_at', now(), 'fixtures', v_fixtures, 'lineups', v_lineups, 'halftime', v_halftime,
                                 'cleared', v_cleared, 'waiting', v_waiting, 'net', v_net, 'called', v_called,
                                 'request_id', v_request, 'errors', v_errors)
              || case when v_audience is not null then jsonb_build_object('audience', v_audience) else '{}'::jsonb end;
  insert into notify_ticks (id, ran_at, called_at, request_id, result)
  values (1, now(), case when v_called then now() end, v_request, v_result)
  on conflict (id) do update
    set ran_at     = excluded.ran_at,
        called_at  = coalesce(excluded.called_at, notify_ticks.called_at),
        request_id = coalesce(excluded.request_id, notify_ticks.request_id),
        result     = excluded.result;
  return v_result;
end $$;
revoke all on function public.notify_tick() from public, anon, authenticated;
grant execute on function public.notify_tick() to service_role;
alter function public.notify_tick() owner to postgres;

-- ----------------------------------------------------------------------------
-- 5. pg_cron's run history, a week of it
-- ----------------------------------------------------------------------------
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-cron-history'::text;
    execute 'select cron.schedule($1, $2, $3)' into v_job
      using 'epinoia-cron-history'::text, '41 4 * * *'::text,
            'delete from cron.job_run_details where end_time < now() - interval ''7 days'''::text;
    raise notice '0155: pg_cron job epinoia-cron-history (job %) trims cron.job_run_details to a week, nightly', v_job;
  end if;
end $$;

-- ============================================================================
-- SELF-TEST. The stored audience is the source, row for row; and a device's row
-- follows it through insert, a preference change, a push stamp (no rebuild
-- needed) and delete. The device part ends by raising P0155, which only its own
-- handler swallows, so every row it touched is rolled back.
-- ============================================================================
do $test$
declare
  n    int;
  dev  uuid;
  fan  uuid;
  team uuid := gen_random_uuid();
begin
  select count(*) into n
    from ((select * from public.notify_audience except all select * from public.notify_audience_source)
          union all
          (select * from public.notify_audience_source except all select * from public.notify_audience)) d;
  if n <> 0 then
    raise exception '0155: the stored audience differs from its source by % rows', n;
  end if;

  begin
    insert into public.push_devices (endpoint, p256dh, auth, origin, time_zone)
    values ('https://push.example.invalid/0155-' || gen_random_uuid(), 'k', 'a', 'https://example.invalid', 'Not/AZone')
    returning id into dev;
    select count(*) into n from public.notify_audience a where a.device_id = dev and a.time_zone = 'Europe/London';
    if n <> 1 then
      raise exception '0155: a new device is not in the stored audience (or its bad zone was kept): % rows', n;
    end if;

    update public.push_devices set fav_team_ids = array[team] where id = dev;
    select count(*) into n from public.notify_audience a where a.device_id = dev and a.fav_team_ids = array[team];
    if n <> 1 then
      raise exception '0155: a device''s new club did not reach the stored audience';
    end if;

    update public.push_devices set last_push_at = now(), last_push_status = 201 where id = dev;
    select count(*) into n from public.notify_audience a where a.device_id = dev;
    if n <> 1 then
      raise exception '0155: a push stamp left % audience rows for the device', n;
    end if;

    delete from public.push_devices where id = dev;
    select count(*) into n from public.notify_audience a where a.device_id = dev;
    if n <> 0 then
      raise exception '0155: a deleted device is still in the stored audience';
    end if;

    -- a fan's saved preferences, on the first fan there is (rolled back with the rest)
    select p.user_id into fan from public.fan_prefs p
     where cardinality(p.fav_team_ids) < 20 order by p.user_id limit 1;
    if fan is not null then
      update public.fan_prefs set fav_team_ids = fav_team_ids || array[team] where user_id = fan;
      select count(*) into n from public.notify_audience a
       where a.device_id is null and a.user_id = fan and team = any (a.fav_team_ids);
      if n <> 1 then
        raise exception '0155: a fan''s new club did not reach the stored audience (% rows)', n;
      end if;
    end if;

    -- the club trigger's statement, run for a league nobody follows: it must plan and run
    update public.notify_audience_rows r
       set fav_team_ids = s.fav_team_ids
      from public.notify_audience_source s
     where r.device_id is null and s.device_id is null and s.user_id = r.user_id
       and r.fav_league_ids && array[gen_random_uuid()];

    raise exception using errcode = 'P0155', message = '0155 self-test passed; rolling its rows back';
  exception when sqlstate 'P0155' then
    null;
  end;
end $test$;
