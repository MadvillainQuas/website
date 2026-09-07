-- ============================================================================
-- 0101 — THE WORKER DASHBOARD: order and pause.
--
-- A desktop app on the processing PC (scripts/worker/ai_dashboard.py) lists
-- the queue, moves jobs up and down, cancels, retries, and pauses the worker.
-- It writes with the service key, so what it needs from the database is only
-- vocabulary: a priority the claim respects, and a paused flag the claim obeys.
-- ============================================================================

alter table public.video_jobs
  add column if not exists priority int not null default 0;
comment on column public.video_jobs.priority is
  'Higher is claimed first; equal priority is oldest first. The dashboard renumbers the queue.';

alter table public.video_workers
  add column if not exists paused boolean not null default false;
comment on column public.video_workers.paused is
  'A paused worker finishes what it is doing and claims nothing more until resumed.';

alter table public.video_jobs drop constraint if exists video_jobs_requested_via_check;
alter table public.video_jobs add constraint video_jobs_requested_via_check
  check (requested_via in ('page','ingest','worker','dashboard'));

create index if not exists video_jobs_claim_idx on public.video_jobs (priority desc, requested_at)
  where status = 'queued';

create or replace function public.claim_video_job(p_worker text)
returns public.video_jobs
language plpgsql security definer set search_path = public as $fn$
declare
  j public.video_jobs;
begin
  /* a machine that died mid-job: give its job back after an hour of silence */
  update public.video_jobs
     set status = 'queued', worker = null, claimed_at = null, heartbeat_at = null,
         progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object('stage', 'requeued after a silent worker')
   where status in ('claimed','running')
     and coalesce(heartbeat_at, claimed_at, requested_at) < now() - interval '1 hour';

  /* the heartbeat, whether or not there is work */
  insert into public.video_workers (id, last_seen) values (p_worker, now())
  on conflict (id) do update set last_seen = now();

  if exists (select 1 from public.video_workers where id = p_worker and paused) then
    return null;                                   -- paused: nothing is claimed
  end if;

  select * into j from public.video_jobs
   where status = 'queued'
   order by priority desc, requested_at
   for update skip locked
   limit 1;
  if j.id is null then
    return null;
  end if;
  update public.video_jobs
     set status = 'claimed', worker = p_worker, claimed_at = now(), heartbeat_at = now()
   where id = j.id
   returning * into j;
  update public.video_workers set busy_job = j.id where id = p_worker;
  return j;
end $fn$;
revoke execute on function public.claim_video_job(text) from anon, public, authenticated;
