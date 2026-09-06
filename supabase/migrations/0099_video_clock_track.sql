-- ============================================================================
-- 0099 — THE GAME CLOCK, READ OFF THE FOOTAGE.
--
-- A play-by-play event is stamped with the game clock (period, seconds left).
-- If the broadcast's clock overlay can be read at points through the video —
-- by the page's own scoreboard reader, or by a computer-vision model run
-- afterwards — then every event can be placed in the footage by its clock
-- rather than by wall-clock arithmetic, exactly, stoppages and all.
--
-- The track is a list of readings, monotone within a period:
--   {"format":"epinoia-clock-track/1",
--    "samples":[{"t":1287.5,"period":1,"clock_ms":598000}, …]}
-- where t is seconds into the video. Written by whoever may attach the video.
-- ============================================================================

alter table public.game_videos
  add column if not exists clock_track jsonb;

comment on column public.game_videos.clock_track is
  'Readings of the game clock at points in the footage (epinoia-clock-track/1): '
  '{samples:[{t: seconds into the video, period, clock_ms}]}. When present the '
  'page places every play by its game clock instead of by wall clock.';

create or replace function public.set_video_clock_track(p_game uuid, p_track jsonb)
returns public.game_videos
language plpgsql security definer set search_path = public as $fn$
declare
  v public.game_videos;
  n int;
begin
  if not public.may_attach_video(p_game) then
    raise exception 'not allowed to attach video to this game';
  end if;
  if p_track is not null then
    if jsonb_typeof(p_track -> 'samples') <> 'array' then
      raise exception 'a clock track is {samples:[{t, period, clock_ms}, …]}';
    end if;
    n := jsonb_array_length(p_track -> 'samples');
    if n > 20000 then
      raise exception 'a clock track holds at most 20000 readings (got %)', n;
    end if;
  end if;
  update public.game_videos
     set clock_track = p_track, updated_at = now()
   where game_id = p_game and is_primary
  returning * into v;
  if v.id is null then
    raise exception 'this game has no video to attach a clock track to';
  end if;
  return v;
end $fn$;
grant execute on function public.set_video_clock_track(uuid, jsonb) to authenticated;
