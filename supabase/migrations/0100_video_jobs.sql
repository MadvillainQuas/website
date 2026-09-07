-- ============================================================================
-- 0100 — "AI PROCESS GAME": THE QUEUE.
--
-- An admin presses one button on a game page and walks away. The footage has
-- to be decoded somewhere with a normal internet connection and a GPU — YouTube
-- refuses downloads from datacenter ranges, and the embedded player's pixels
-- cannot be read in the browser — so the website is the control plane, this
-- table is the queue, and a small worker on a PC (scripts/worker/ai_worker.py)
-- is the muscle. It downloads the stream, reads the clock or the score off the
-- picture, and writes the readings onto game_videos.clock_track exactly as the
-- page's own "import a clock track" would. The page watches the job row over
-- realtime and re-derives itself when the track lands.
--
-- Jobs are readable by anyone (they hold nothing but a game id, a status and a
-- progress counter — the same facts the page shows); requested by whoever may
-- attach the video; claimed and advanced only by the worker's service key.
-- ============================================================================

create table if not exists public.video_jobs (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games on delete cascade,
  kind            text not null default 'clock_track'
                  check (kind in ('clock_track')),
  video_url       text not null,
  status          text not null default 'queued'
                  check (status in ('queued','claimed','running','done','failed','cancelled')),
  /* what was asked for, and what the reader decided the picture held */
  mode_requested  text not null default 'auto'
                  check (mode_requested in ('auto','clock','score')),
  mode_used       text
                  check (mode_used is null or mode_used in ('clock','score','clock+score','none')),
  /* {stage, i, n, accepted, last:{…}} — written every few seconds by the worker */
  progress        jsonb,
  /* {samples, periods, matched, seen, harvest:{…}} once done */
  result          jsonb,
  error           text,
  cancel_requested boolean not null default false,
  requested_by    uuid references auth.users on delete set null,
  requested_via   text not null default 'page'
                  check (requested_via in ('page','ingest','worker')),
  requested_at    timestamptz not null default now(),
  worker          text,
  claimed_at      timestamptz,
  heartbeat_at    timestamptz,
  finished_at     timestamptz
);

create index if not exists video_jobs_game_idx   on public.video_jobs (game_id, requested_at desc);
create index if not exists video_jobs_queue_idx  on public.video_jobs (status, requested_at)
  where status in ('queued','claimed','running');

comment on table public.video_jobs is
  'One row per "AI process game" request: the worker on a PC downloads the footage, reads '
  'the clock/score, and writes game_videos.clock_track. Public read; admins insert via '
  'request_video_job; only the service key claims and advances.';

/* The machines. One row each, touched every pass, so a page can say honestly
   whether anything is listening ("worker last seen 3 min ago"). */
create table if not exists public.video_workers (
  id          text primary key,
  last_seen   timestamptz not null default now(),
  busy_job    uuid references public.video_jobs on delete set null,
  note        text
);

alter table public.video_jobs    enable row level security;
alter table public.video_workers enable row level security;

drop policy if exists video_jobs_read on public.video_jobs;
create policy video_jobs_read on public.video_jobs for select using (true);
drop policy if exists video_workers_read on public.video_workers;
create policy video_workers_read on public.video_workers for select using (true);
/* no insert/update/delete policies: writes go through the functions below or the service key */

-- ---------------------------------------------------------------------------
-- request: the button.
-- ---------------------------------------------------------------------------
create or replace function public.request_video_job(p_game uuid, p_mode text default 'auto')
returns public.video_jobs
language plpgsql security definer set search_path = public as $fn$
declare
  v_url text;
  j public.video_jobs;
begin
  if not public.may_attach_video(p_game) then
    raise exception 'not allowed to process video for this game';
  end if;
  if p_mode not in ('auto','clock','score') then
    raise exception 'mode is auto, clock or score';
  end if;
  select url into v_url from public.game_videos
   where game_id = p_game and is_primary and coalesce(url, '') <> ''
   limit 1;
  if v_url is null then
    raise exception 'attach the video link first — the reader needs footage to read';
  end if;
  select * into j from public.video_jobs
   where game_id = p_game and status in ('queued','claimed','running')
   order by requested_at desc limit 1;
  if j.id is not null then
    return j;                                -- already on its way; hand back the live row
  end if;
  insert into public.video_jobs (game_id, video_url, mode_requested, requested_by, requested_via)
  values (p_game, v_url, p_mode, auth.uid(), 'page')
  returning * into j;
  return j;
end $fn$;
grant execute on function public.request_video_job(uuid, text) to authenticated;

create or replace function public.cancel_video_job(p_job uuid)
returns public.video_jobs
language plpgsql security definer set search_path = public as $fn$
declare
  j public.video_jobs;
begin
  select * into j from public.video_jobs where id = p_job;
  if j.id is null then
    raise exception 'no such job';
  end if;
  if not public.may_attach_video(j.game_id) then
    raise exception 'not allowed to cancel this job';
  end if;
  if j.status = 'queued' then
    update public.video_jobs set status = 'cancelled', finished_at = now() where id = p_job returning * into j;
  elsif j.status in ('claimed','running') then
    update public.video_jobs set cancel_requested = true where id = p_job returning * into j;
  end if;
  return j;
end $fn$;
grant execute on function public.cancel_video_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- claim: the worker's side. Service key only.
-- ---------------------------------------------------------------------------
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

  select * into j from public.video_jobs
   where status = 'queued'
   order by requested_at
   for update skip locked
   limit 1;
  if j.id is null then
    return null;
  end if;
  update public.video_jobs
     set status = 'claimed', worker = p_worker, claimed_at = now(), heartbeat_at = now()
   where id = j.id
   returning * into j;
  insert into public.video_workers (id, last_seen, busy_job) values (p_worker, now(), j.id)
  on conflict (id) do update set last_seen = now(), busy_job = j.id;
  return j;
end $fn$;
revoke execute on function public.claim_video_job(text) from anon, public, authenticated;

-- the page watches jobs and workers live
do $$
begin
  begin
    alter publication supabase_realtime add table public.video_jobs;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.video_workers;
  exception when duplicate_object then null; end;
end $$;
