-- 0109  Export highlights.
--
-- From the video tab a signed-in person picks a player and the kinds of play they want and
-- asks for a vertical highlights reel. The page already knows where every play sits in the
-- footage (the clock track), so it sends the clips -- start, end, label -- and the worker on
-- Louie's PC does the rest: fetches the stream, cuts each clip, follows the ball (the vision
-- skill's detector) so the action stays inside a 9:16 frame, joins them, and uploads an MP4
-- to media-public. The requester's bell says when it is ready.

create table if not exists public.highlight_jobs (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  requested_by  uuid not null references auth.users(id) on delete cascade,
  player_id     text,                                   -- null: the whole side / everything asked for
  player_name   text,
  kinds         text[] not null default '{}',
  orientation   text not null default 'portrait' check (orientation in ('portrait', 'landscape')),
  clips         jsonb not null,                         -- [{start_ms, end_ms, label, kind}]
  status        text not null default 'queued' check (status in ('queued', 'claimed', 'running', 'done', 'failed', 'cancelled')),
  progress      jsonb,
  output_path   text,                                   -- media-public path once rendered
  error         text,
  worker        text,
  requested_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz
);
create index if not exists highlight_jobs_queue_idx on public.highlight_jobs (status, requested_at);
create index if not exists highlight_jobs_user_idx on public.highlight_jobs (requested_by, requested_at desc);
alter table public.highlight_jobs enable row level security;
drop policy if exists highlight_jobs_own on public.highlight_jobs;
create policy highlight_jobs_own on public.highlight_jobs for select using (requested_by = auth.uid());
drop policy if exists highlight_jobs_ask on public.highlight_jobs;
create policy highlight_jobs_ask on public.highlight_jobs for insert
  with check (requested_by = auth.uid() and jsonb_typeof(clips) = 'array' and jsonb_array_length(clips) between 1 and 80);
grant select, insert on public.highlight_jobs to authenticated;

-- the worker takes the oldest queued job; a job whose worker went quiet for an hour is re-queued
create or replace function public.claim_highlight_job(p_worker text)
returns public.highlight_jobs language plpgsql security definer set search_path = public as $$
declare j public.highlight_jobs;
begin
  update highlight_jobs set status = 'queued', worker = null, claimed_at = null, heartbeat_at = null
   where status in ('claimed', 'running') and coalesce(heartbeat_at, claimed_at, requested_at) < now() - interval '1 hour';
  update highlight_jobs set status = 'claimed', worker = p_worker, claimed_at = now(), heartbeat_at = now()
   where id = (select id from highlight_jobs where status = 'queued' order by requested_at limit 1 for update skip locked)
  returning * into j;
  return j;
end $$;
revoke all on function public.claim_highlight_job(text) from public, anon, authenticated;

-- the bell may say "your highlights are ready"
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('result', 'player', 'fixture', 'announcement', 'message', 'highlights'));
