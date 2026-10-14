-- 0261 THE SEASON BEING PLAYED CAN BE BACKFILLED (2026-10-14)
--
-- 0135/0187 refused the season being played ("filled in by the ordinary pass"), and a calendar-year league's this
-- year with it. That holds only while the ordinary pass reads it - and NBL1's source starts at 2027 (first_season),
-- so its 2026 season, played and finished, could neither arrive by itself nor be asked for. A league joining mid-season
-- is the same: the ordinary pass reads from the day it was connected, never the weeks before.
--
-- So the season being played is accepted. The worker reads only its games that finished more than four hours ago
-- (run_ingest.py backfill_is_current): a game in progress keeps one writer, the live lane. A season not begun yet is
-- still refused.
create or replace function public.season_backfills_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  live text := public.current_season_name();
  this_year int := extract(year from (now() at time zone 'utc'))::int;
begin
  new.season := btrim(coalesce(new.season, ''));
  if new.season ~ '^[0-9]{4}$' then
    if new.season::int > this_year then
      raise exception '% has not been played yet', new.season using errcode = '22023';
    end if;
  elsif new.season ~ '^[0-9]{4}-[0-9]{2}$' then
    if left(new.season, 4)::int > left(live, 4)::int then
      raise exception '% has not been played yet', new.season using errcode = '22023';
    end if;
  else
    raise exception 'a season is written like 2024-25 (or 2025 for a calendar-year league)' using errcode = '22023';
  end if;
  new.state         := 'queued';
  new.requested_by  := coalesce(auth.uid(), new.requested_by);
  new.requested_at  := now();
  new.claimed_at    := null;
  new.heartbeat_at  := null;
  new.finished_at   := null;
  new.worker        := null;
  new.sources_run   := 0;
  new.games_seen    := 0;
  new.games_written := 0;
  new.error         := null;
  new.step          := null;
  new.detail        := '{}'::jsonb;
  return new;
end $$;
