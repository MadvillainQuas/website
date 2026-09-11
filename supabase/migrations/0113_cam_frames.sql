-- ============================================================================
-- 0113  cam_frames -- the phone's boxed clock crop, for the league's PC to read.
--
-- The clock-cam phone app (epinoia/clockcam) points a phone at the hall's
-- scoreboard, lets the person draw a box round the clock digits, and reads them
-- on the phone. Where the phone's own reader struggles (a dim board, an odd
-- font) it can instead post the boxed crop here a few times a second and let
-- the PC's scoreboard model read it (scripts/worker/clock_cam.py --source phone).
--
-- One row per game, overwritten on every post: this is a mailbox, not a log.
-- A crop is a few kilobytes of JPEG as a data URL. Whoever may broadcast the
-- game may post; only the service role (the PC) and the poster read it back.
-- ============================================================================

create table if not exists public.cam_frames (
  game_id   uuid primary key references public.games on delete cascade,
  taken_at  timestamptz not null default now(),
  crop      text not null,
  kind      text not null default 'clock',
  posted_by uuid references auth.users
);
alter table public.cam_frames enable row level security;

drop policy if exists cam_frames_post on public.cam_frames;
create policy cam_frames_post on public.cam_frames for insert
  with check (auth.uid() = posted_by and public.may_broadcast_game(game_id) and length(crop) < 400000);
drop policy if exists cam_frames_repost on public.cam_frames;
create policy cam_frames_repost on public.cam_frames for update
  using (public.may_broadcast_game(game_id)) with check (auth.uid() = posted_by and length(crop) < 400000);
drop policy if exists cam_frames_mine on public.cam_frames;
create policy cam_frames_mine on public.cam_frames for select using (auth.uid() = posted_by);
grant select, insert, update on public.cam_frames to authenticated;
