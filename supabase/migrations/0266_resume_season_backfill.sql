-- 0266: CONTINUE A BACKFILL THAT STOPPED (Louie 2026-10-15). A season backfill's worker can die mid-season: killed at its
-- job's time limit, cancelled, a runner lost. 0135 puts such a request back in the queue only after 90 minutes of silence,
-- and only when the next worker claims. This lets an administrator of the league (or the platform) put it back at once:
-- the next run goes on from where it stopped, since every game already written is skipped.
--
-- Only a request the worker has gone quiet on: "running" and not heard from for ten minutes (a live worker writes at least
-- once a minute, scripts/ingest/run_ingest.py beat()). A request being read now is refused - two workers on one season is
-- what the lease exists to prevent. A failed or finished one is asked for again with queue_season_backfill, as before.

create or replace function public.resume_season_backfill(p_id uuid)
returns public.season_backfills language plpgsql security definer set search_path = public as $$
declare r public.season_backfills;
begin
  select * into r from season_backfills where id = p_id for update;
  if not found then
    raise exception 'no such request' using errcode = 'P0002';
  end if;
  if not public.is_league_admin(r.league_id) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if r.state <> 'running' then
    raise exception 'only a request that was being read can be continued (this one is %)', r.state using errcode = '22023';
  end if;
  if coalesce(r.heartbeat_at, r.claimed_at, r.requested_at) > now() - interval '10 minutes' then
    raise exception 'the worker was heard from in the last ten minutes: it is still reading this season' using errcode = '55006';
  end if;
  update season_backfills
     set state = 'queued', worker = null, claimed_at = null, heartbeat_at = null, dispatched_at = null,
         step = 'continued by hand: the next run goes on from where it stopped'
   where id = p_id
  returning * into r;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'resume_season_backfill', 'league', r.league_id::text, jsonb_build_object('season', r.season, 'backfill', r.id));
  return r;
end $$;

alter function public.resume_season_backfill(uuid) owner to postgres;
revoke all on function public.resume_season_backfill(uuid) from public, anon;
grant execute on function public.resume_season_backfill(uuid) to authenticated;
