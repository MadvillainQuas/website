-- ============================================================================
-- 0115 — A NEW VIDEO DOES NOT INHERIT THE OLD ONE'S CLOCK.
--
-- set_game_video upserts the game's one primary video row, and every column of
-- the update is coalesce(parameter, what the row already held). That is the
-- right reading of "I did not say" (0085) for as long as the row describes the
-- same footage. It is the wrong one the moment the LINK changes.
--
-- Paste a different video over an attached one — the right broadcast after
-- auto_video found the wrong one, a re-upload, a club's own recording instead of
-- the league stream — and leave the jump-ball box empty. The row took the new
-- url and video_ref and KEPT:
--
--   * tip_offset_ms   — how far into the OLD recording the ball went up, which
--                       video.js prefers over every other anchor, unconditionally;
--   * stream_started_at — the old stream's start, for footage that is not it;
--   * trim_ms, is_live — facts about the old video;
--   * clock_track     — a thousand readings of the OLD footage's scoreboard,
--                       which the page prefers even to the offset.
--
-- So every play was placed at the second it occupied in a different video, and
-- the page said so with full confidence: nothing about the row looked wrong.
--
-- WHAT IS KEPT. tip_at and tip_wall are facts about the GAME — when the ball went
-- up, on the server's clock and on the log's — not about any video of it, and
-- they stay. Everything that is a fact about the footage starts again from what
-- this call supplies.
--
-- WHAT COUNTS AS A DIFFERENT VIDEO. The provider's own id when one is given:
-- youtu.be/X and youtube.com/watch?v=X are the same video and keep their anchors.
-- Without an id (a file link), the link itself. A call that passes no link at
-- all is adjusting the anchors of the video already there.
-- ============================================================================

create or replace function public.video_is_same(
  p_old_url text, p_old_provider text, p_old_ref text,
  p_url text, p_provider text, p_ref text)
returns boolean language sql immutable set search_path = public as $fn$
  select case
    when nullif(btrim(p_url), '') is null and nullif(btrim(p_ref), '') is null
      then true
    when nullif(btrim(p_ref), '') is not null
      then coalesce(nullif(btrim(p_ref), '') = nullif(btrim(p_old_ref), ''), false)
           and coalesce(p_provider, p_old_provider) is not distinct from p_old_provider
    else coalesce(nullif(btrim(p_url), '') = nullif(btrim(p_old_url), ''), false)
  end;
$fn$;

comment on function public.video_is_same(text, text, text, text, text, text) is
  'Does a set_game_video call describe the footage the row already holds? Same '
  'provider id (or, without one, the same link), or no link passed at all. When '
  'it does not, the footage anchors are not carried across. See 0115.';

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
  p_tip_offset_ms int default null
) returns public.game_videos
language plpgsql security definer set search_path = public as $fn$
declare
  v          public.game_videos;
  old        public.game_videos;
  same       boolean;
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

  select * into old from public.game_videos where game_id = p_game and is_primary;
  same := old.id is null
          or public.video_is_same(old.url, old.provider, old.video_ref, p_url, p_provider, p_ref);

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
    -- facts about the game: kept whatever video this is
    tip_at            = coalesce(tip_final, game_videos.tip_at),
    tip_wall          = coalesce(p_tip_wall, game_videos.tip_wall),
    -- facts about the footage: carried only while it is the same footage
    stream_started_at = case when same then coalesce(strt_final, game_videos.stream_started_at) else strt_final end,
    tip_offset_ms     = case when same then coalesce(p_tip_offset_ms, game_videos.tip_offset_ms) else p_tip_offset_ms end,
    trim_ms           = case when same then coalesce(p_trim_ms, game_videos.trim_ms) else coalesce(p_trim_ms, 0) end,
    is_live           = case when same then coalesce(p_is_live, game_videos.is_live) else coalesce(p_is_live, false) end,
    clock_track       = case when same then game_videos.clock_track else null end,
    updated_at        = now()
  returning * into v;

  return v;
end $fn$;

grant execute on function public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint, bigint, int)
  to authenticated;

/* A security definer function runs with its OWNER's rights. The CLI now applies
   migrations through a temporary login role; pin both functions to postgres so
   whichever role ran this file, the RPC can still read and write game_videos. */
alter function public.video_is_same(text, text, text, text, text, text) owner to postgres;
alter function public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint, bigint, int) owner to postgres;

-- ============================================================================
-- SELF-TEST — through the real function, as a real admin, on a game with no video.
--
-- A migration has no auth.uid(), and may_attach_video refuses a caller it cannot
-- name, so the claim of an existing platform admin is forged for the calls (the
-- way 0092 and 0114 do).
--
-- EVERYTHING HAPPENS INSIDE A BLOCK THAT IS ALWAYS ROLLED BACK. The first version
-- of this test switched to the authenticated role, then used RESET ROLE to get
-- the table owner's rights back for the setup and the clean-up. Under the CLI's
-- temporary login role RESET ROLE lands on that login role, not on postgres, and
-- it may not touch game_videos: the push failed with "permission denied", and the
-- clean-up in the handler would have hidden any real failure behind the same
-- error. So the row is seeded BEFORE the switch, and the block ends by raising a
-- private code that its own handler swallows. Rolling back that subtransaction
-- undoes the rows, the SET LOCAL ROLE and the forged claim together, with no
-- privilege needed. Any other error, including every assertion below, is not
-- caught and fails the migration with its own message.
-- ============================================================================
do $test$
declare
  gid   uuid;
  actor uuid;
  v     public.game_videos;
  who   text := current_user || ' (session ' || session_user || ')';
begin
  if not public.video_is_same('https://youtu.be/AAAAAAAAAAA', 'youtube', 'AAAAAAAAAAA',
                              'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'youtube', 'AAAAAAAAAAA') then
    raise exception '0115: two links to the same YouTube video were called different';
  end if;
  if public.video_is_same('https://youtu.be/AAAAAAAAAAA', 'youtube', 'AAAAAAAAAAA',
                          'https://youtu.be/BBBBBBBBBBB', 'youtube', 'BBBBBBBBBBB') then
    raise exception '0115: two different YouTube videos were called the same';
  end if;
  if not public.video_is_same('https://youtu.be/AAAAAAAAAAA', 'youtube', 'AAAAAAAAAAA', null, null, null) then
    raise exception '0115: a call with no link was treated as a new video';
  end if;
  if public.video_is_same('https://x.test/a.mp4', 'other', '', 'https://x.test/b.mp4', 'other', '') then
    raise exception '0115: two different file links were called the same';
  end if;
  if public.video_is_same('https://youtu.be/AAAAAAAAAAA', 'youtube', '', 'https://youtu.be/AAAAAAAAAAA', 'youtube', 'AAAAAAAAAAA') then
    raise exception '0115: an id against a row with none was called the same, which cannot be known';
  end if;

  /* a finished game first: nothing here is ever committed, but a finished game
     is the one nobody is watching while the migration runs */
  select g.id into gid from public.games g
   where not exists (select 1 from public.game_videos w where w.game_id = g.id)
   order by (g.status = 'final') desc
   limit 1;
  select m.user_id into actor from public.memberships m where m.role = 'platform_admin' limit 1;
  if gid is null or actor is null then
    raise notice '0115: no video-less game or no platform admin to test the function with; truth table only';
    return;
  end if;

  begin
    /* a recording with an offset, a stream start, a trim and a track read off it,
       seeded with the migration's own rights before anything switches role */
    insert into public.game_videos (game_id, url, provider, video_ref, label,
                                    stream_started_at, tip_at, tip_wall, tip_offset_ms, trim_ms, clock_track)
    values (gid, 'https://youtu.be/__t115aaaaa', 'youtube', '__t115aaaaa', '__t115',
            now() - interval '20 minutes', now(), 1789238080000, 465000, 1500,
            '{"samples":[{"t":1,"period":1,"clock_ms":600000}]}'::jsonb);

    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    set local role authenticated;

    /* the same video by another spelling of its link: everything is kept */
    v := public.set_game_video(p_game => gid, p_url => 'https://www.youtube.com/watch?v=__t115aaaaa',
                               p_provider => 'youtube', p_ref => '__t115aaaaa');
    if v.tip_offset_ms is distinct from 465000 or v.clock_track is null
       or v.stream_started_at is null or v.trim_ms <> 1500 then
      raise exception '0115: re-pasting the same video lost its anchors';
    end if;

    /* a different video with the jump-ball box left empty: the footage anchors go */
    v := public.set_game_video(p_game => gid, p_url => 'https://youtu.be/__t115bbbbb', p_provider => 'youtube',
                               p_ref => '__t115bbbbb', p_trim_ms => 0);
    if v.tip_offset_ms is not null then
      raise exception '0115: a different video kept the old recording''s offset (%)', v.tip_offset_ms;
    end if;
    if v.clock_track is not null then
      raise exception '0115: a different video kept a clock track read off the old footage';
    end if;
    if v.stream_started_at is not null then
      raise exception '0115: a different video kept the old stream''s start';
    end if;
    if v.tip_wall is distinct from 1789238080000 then
      raise exception '0115: the tip-off, a fact about the game, was lost with the video';
    end if;

    /* and a different video WITH an offset takes the new one */
    v := public.set_game_video(p_game => gid, p_url => 'https://youtu.be/__t115ccccc', p_provider => 'youtube',
                               p_ref => '__t115ccccc', p_tip_offset_ms => 90000);
    if v.tip_offset_ms is distinct from 90000 then
      raise exception '0115: a new video''s own offset was not stored (%)', v.tip_offset_ms;
    end if;

    raise exception using errcode = 'P0115', message = '0115 passed; rolling its test rows back';
  exception
    when sqlstate 'P0115' then
      null;
    when others then
      /* rolled back all the same; say which role it ran as, since that is what
         the first version of this test tripped over */
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from public.game_videos where video_ref like '\_\_t115%') then
    raise exception '0115: the test rows outlived their rollback';
  end if;
  raise notice '0115 ok: the same video keeps its anchors, a different one starts clean, the tip-off stays';
end $test$;
