-- ============================================================================
-- TWO KINDS OF VIDEO, AND THEY ARE NOT THE SAME PROBLEM.
--
-- 0082 anchored a video with two wall-clock instants: when the stream started
-- and when the ball went up. That is exactly right for the case it was written
-- for — the platform starts a stream through OBS, knows the moment it began,
-- and the gap falls out.
--
-- It is a fiction for the other case. A finished game on YouTube has no stream
-- start. What somebody has is a scrub bar and a jump ball on it: "tip-off is at
-- 7:45". Storing that as stream_started_at = tip − 7:45 reverse-engineers an
-- instant that never happened, purely so one piece of arithmetic could serve
-- both, and it costs three things:
--
--   * A row for a YouTube recording claims a "stream started at" time that is
--     meaningless, and anyone reading the table has no way to know that.
--   * The two paths overwrite one another. Go live from the control room, then
--     paste a recording with an offset, and whichever wrote last decides —
--     with nothing recording which was meant to be authoritative.
--   * The recording path had to do clock arithmetic at all. It was subtracting
--     a device clock from a server one, which is the single thing 0083 exists
--     to prevent, and it only worked because a sentinel converted it back to a
--     duration on the way out.
--
-- So the recording path gets the number it actually has. tip_offset_ms is how
-- far into the footage the ball goes up — a plain integer, measured against
-- nothing, immune to every clock on the platform being wrong.
--
--   LIVE      stream_started_at + tip_at   -> gap  (both stamped by the server)
--   RECORDING tip_offset_ms                -> gap  (just the number)
--
-- WHICH WINS WHEN BOTH ARE SET. The offset. A stream start is inferred from a
-- mixer's own duration counter; an offset was typed by somebody looking at the
-- footage everyone will actually watch. The person with the video in front of
-- them is better informed than the encoder.
-- ============================================================================

alter table public.game_videos
  add column if not exists tip_offset_ms int;

do $$ begin
  /* Twelve hours. Long enough for a broadcast that opens hours before tip and
     a scrub bar with a whole tournament on it; short enough that a fat finger
     is refused rather than stored. */
  alter table public.game_videos add constraint game_videos_tip_offset_ck
    check (tip_offset_ms is null or tip_offset_ms between 0 and 43200000);
exception when duplicate_object then null; end $$;

comment on column public.game_videos.tip_offset_ms is
  'How far into THIS RECORDING the ball goes up, in milliseconds. Set for a '
  'video somebody attached after the fact; null for one the platform streamed '
  'itself, where the gap comes from stream_started_at and tip_at instead. When '
  'both are present this wins — it was typed against the actual footage.';

-- ----------------------------------------------------------------------------
-- The RPC learns the second kind, and the two never touch each other.
-- ----------------------------------------------------------------------------
/* The 0088 signature is a different function to Postgres — thirteen arguments
   against fourteen — so it is dropped rather than left as an overload that a
   named call would find ambiguous. BEFORE the create, not after: dropping afterwards happens to work here, but
   the convention across these migrations is drop-first and one convention is
   worth more than one exception. supabase/tests/migrations.test.mjs enforces it. */
drop function if exists public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint, bigint);

create or replace function public.set_game_video(
  p_game         uuid,
  p_url          text default null,
  p_provider     text default null,
  p_ref          text default null,
  p_label        text default null,
  p_stream_start timestamptz default null,
  p_tip          timestamptz default null,
  p_trim_ms      int default null,
  p_is_live      boolean default null,
  p_tip_now      boolean default null,
  p_stream_ms_ago bigint default null,
  p_tip_wall     bigint default null,
  p_tip_ms_ago   bigint default null,
  -- the recording path, and the only argument it needs
  p_tip_offset_ms int default null
) returns public.game_videos
language plpgsql security definer set search_path = public as $fn$
declare
  v          public.game_videos;
  tip_final  timestamptz;
  strt_final timestamptz;
begin
  if not public.may_attach_video(p_game) then
    raise exception 'not allowed to attach video to this game';
  end if;

  tip_final := coalesce(
    p_tip,
    case when p_tip_ms_ago is not null and p_tip_ms_ago between 0 and 14400000
         then now() - make_interval(secs => p_tip_ms_ago / 1000.0) end,
    case when p_tip_now then now() end);

  strt_final := coalesce(
    p_stream_start,
    case when p_stream_ms_ago is not null and p_stream_ms_ago between 0 and 14400000
         then now() - make_interval(secs => p_stream_ms_ago / 1000.0) end);

  insert into public.game_videos
    (game_id, url, provider, video_ref, label,
     stream_started_at, tip_at, tip_wall, tip_offset_ms,
     trim_ms, is_live, is_primary, created_by)
  values
    (p_game, coalesce(nullif(btrim(p_url), ''), ''),
     coalesce(p_provider, 'youtube'), coalesce(p_ref, ''),
     coalesce(nullif(btrim(p_label), ''), 'Full game'),
     strt_final, tip_final, p_tip_wall, p_tip_offset_ms,
     coalesce(p_trim_ms, 0), coalesce(p_is_live, false), true, auth.uid())
  on conflict (game_id) where is_primary do update set
    /* Against the PARAMETERS, not excluded — the insert substitutes defaults
       for arguments nobody passed. See 0085. */
    url               = coalesce(nullif(btrim(p_url), ''), game_videos.url),
    provider          = coalesce(p_provider, game_videos.provider),
    video_ref         = coalesce(nullif(p_ref, ''), game_videos.video_ref),
    label             = coalesce(nullif(btrim(p_label), ''), game_videos.label),
    stream_started_at = coalesce(strt_final, game_videos.stream_started_at),
    tip_at            = coalesce(tip_final, game_videos.tip_at),
    tip_wall          = coalesce(p_tip_wall, game_videos.tip_wall),
    tip_offset_ms     = coalesce(p_tip_offset_ms, game_videos.tip_offset_ms),
    trim_ms           = coalesce(p_trim_ms, game_videos.trim_ms),
    is_live           = coalesce(p_is_live, game_videos.is_live),
    updated_at        = now()
  returning * into v;

  return v;
end $fn$;

grant execute on function public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint, bigint, int)
  to authenticated;

-- ============================================================================
-- SELF-TEST — the two anchors are independent, and the offset wins.
-- ============================================================================
do $test$
declare
  gid   uuid;
  v     public.game_videos;
  gap   bigint;
begin
  select g.id into gid
  from public.games g
  where not exists (select 1 from public.game_videos w where w.game_id = g.id)
  limit 1;
  if gid is null then
    raise notice '0090 self-test skipped: no game without a video to test on';
    return;
  end if;

  /* A recording: an offset and nothing else. No stream start is invented. */
  insert into public.game_videos (game_id, url, video_ref, label, tip_offset_ms)
  values (gid, 'https://youtu.be/__t90', '__t90', '__t90', 465000)
  returning * into v;

  if v.stream_started_at is not null then
    raise exception '0090: a recording should not carry a stream start';
  end if;
  if v.tip_offset_ms <> 465000 then
    raise exception '0090: the offset was not stored, got %', v.tip_offset_ms;
  end if;

  /* A live stream on the same row: both anchors present, and they do not
     corrupt one another. */
  update public.game_videos
     set stream_started_at = now() - interval '11 minutes', tip_at = now()
   where id = v.id
  returning * into v;

  gap := (extract(epoch from (v.tip_at - v.stream_started_at)) * 1000)::bigint;
  if gap < 659000 or gap > 661000 then
    raise exception '0090: the live gap is wrong, got % ms', gap;
  end if;
  if v.tip_offset_ms <> 465000 then
    raise exception '0090: writing the live anchor destroyed the offset';
  end if;

  /* The constraint refuses nonsense rather than storing it. */
  begin
    update public.game_videos set tip_offset_ms = -1 where id = v.id;
    raise exception '0090: a negative offset was accepted';
  exception when check_violation then
    null;
  end;

  delete from public.game_videos where video_ref = '__t90';
  raise notice '0090 ok: a recording carries an offset, a stream carries two '
               'instants, and neither paths writes over the other';
end $test$;
