-- ============================================================================
-- 0097 — CONNECT A LEAGUE TO A FEED FROM THE EPINOIA CONSOLE.
--
-- A league administrator pastes the league site's schedule URL (or the Genius
-- hosted URL) once. That creates the schedule_sources row the worker polls and
-- the feed_competitions row index_9 lists — both tables are otherwise
-- service-role-only, so the console goes through a definer function that
-- checks league admin rights (same shape as every other admin RPC).
-- From then on the worker bootstraps clubs / players / rosters / fixtures for
-- that league from the feed and turns every finished game into a scored one.
-- ============================================================================

create or replace function public.register_feed_source(
  p_league     uuid,
  p_url        text,
  p_code       text,                       -- short code, e.g. 'SLB' (the feed's client code)
  p_label      text default null,
  p_adapter    text default 'fiba_livestats',
  p_poll       int  default 30
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid  uuid;
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9_-]', '', 'g'));
  lbl  text := coalesce(nullif(trim(p_label), ''), (select name from leagues where id = p_league));
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if code = '' then raise exception 'a competition code is required' using errcode = '22023'; end if;
  if p_url !~ '^https?://' then raise exception 'schedule URL must start with http(s)://' using errcode = '22023'; end if;

  insert into schedule_sources (league_id, label, adapter, schedule_url, adapter_config, poll_minutes, enabled, created_by)
  values (p_league, lbl, p_adapter, trim(p_url),
          jsonb_build_object('code', code, 'archive_raw', true, 'auto_create', true),
          greatest(5, coalesce(p_poll, 30)), true, auth.uid())
  on conflict (league_id, schedule_url) do update
    set label = excluded.label, adapter = excluded.adapter, adapter_config = excluded.adapter_config,
        poll_minutes = excluded.poll_minutes, enabled = true, last_error = null
  returning id into sid;

  insert into feed_competitions (code, label, adapter, league_id, updated_at)
  values (code, lbl, p_adapter, p_league, now())
  on conflict (code) do update set label = excluded.label, adapter = excluded.adapter, league_id = excluded.league_id, updated_at = now();

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'register_feed_source', 'league', p_league::text, jsonb_build_object('url', p_url, 'code', code));
  return sid;
end $$;
grant execute on function public.register_feed_source(uuid, text, text, text, text, int) to authenticated;

-- What the console shows: every source for the league with its health.
create or replace function public.list_feed_sources(p_league uuid)
returns table (id uuid, label text, adapter text, schedule_url text, code text, poll_minutes int, enabled boolean,
               last_polled_at timestamptz, last_ok_at timestamptz, last_error text,
               games int, games_final int, last_run_status text, last_run_at timestamptz)
language sql security definer set search_path = public as $$
  select s.id, s.label, s.adapter, s.schedule_url, s.adapter_config->>'code', s.poll_minutes, s.enabled,
         s.last_polled_at, s.last_ok_at, s.last_error,
         (select count(*)::int from external_games e where e.adapter = s.adapter and e.competition_code = s.adapter_config->>'code'),
         (select count(*)::int from external_games e where e.adapter = s.adapter and e.competition_code = s.adapter_config->>'code' and e.external_status = 'final'),
         (select r.status from ingest_runs r where r.source_id = s.id order by r.started_at desc limit 1),
         (select r.started_at from ingest_runs r where r.source_id = s.id order by r.started_at desc limit 1)
  from schedule_sources s
  where s.league_id = p_league and public.is_league_admin(p_league)
  order by s.created_at;
$$;
grant execute on function public.list_feed_sources(uuid) to authenticated;

-- Pause / resume / "poll on the next run" from the console.
create or replace function public.set_feed_source(p_source uuid, p_enabled boolean, p_poll_now boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare lg uuid;
begin
  select league_id into lg from schedule_sources where id = p_source;
  if lg is null or not public.is_league_admin(lg) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  update schedule_sources set enabled = coalesce(p_enabled, enabled),
         last_polled_at = case when p_poll_now then null else last_polled_at end
   where id = p_source;
end $$;
grant execute on function public.set_feed_source(uuid, boolean, boolean) to authenticated;
