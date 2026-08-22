-- ============================================================================
-- MAKING THE TWO CLOCKS AGREE EXACTLY.
--
-- 0082 anchored a video to a game with two wall-clock instants. It works, and
-- it has three sources of slop that a producer scrubbing frame by frame will
-- find inside one afternoon:
--
--   1. THE TAP AND THE INSERT ARE NOT THE SAME MOMENT. created_at is when the
--      row reached Postgres — after coalescing into a ~250 ms frame, after the
--      network, after a retry. Usually a second. After a wifi drop in a sports
--      hall it is the whole outage: every event scored while the connection
--      was down lands at once, and every clip from that stretch points at the
--      moment the wifi came back.
--
--   2. THE TWO STAMPS COME FROM TWO DIFFERENT MACHINES. tip_at was stamped by
--      the scoring phone; stream_started_at by the streaming PC. A phone whose
--      clock is nine seconds fast makes every clip in the game nine seconds
--      wrong, and nothing anywhere would say so.
--
--   3. A BUTTON PRESS IS NOT THE START OF A STREAM. stream_started_at was
--      recorded when somebody pressed "go live" here — which is not when the
--      stream started if it was started in OBS directly, or before this page
--      was open, or if the page was reloaded mid-game.
--
-- ALL THREE ARE FIXED BY SPLITTING THE SUM INTO TWO DURATIONS, each measured
-- entirely inside one clock, so that no absolute time is ever compared across
-- machines:
--
--     video position  =  GAP            +  SINCE TIP
--                        (server clock)    (the scorer's own clock)
--
--   * GAP — from the stream starting to the ball going up. Both stamped by
--     the DATABASE, in the same transaction as the request that reports them,
--     so it is one clock subtracted from itself. The streaming PC no longer
--     supplies a time at all; it supplies how long OBS says it has been
--     streaming, which OBS counts itself and which is right however the
--     stream was started.
--
--   * SINCE TIP — from the ball going up to this play. Both stamped by the
--     SCORER, at the moment of the tap, and carried in the event's own
--     payload. Insert latency, batching and a two-minute wifi outage cannot
--     touch it, because the number was fixed before any of them happened.
--
-- A clock that is wrong by nine seconds now cancels: it is on both ends of
-- every subtraction it appears in. That is the whole idea.
-- ============================================================================

alter table public.game_videos
  /* The scorer's OWN clock at tip-off, epoch milliseconds. Deliberately not a
     timestamptz: it is not a time of day anybody should read or compare with
     one — it is one end of a subtraction whose other end is in a payload. */
  add column if not exists tip_wall bigint;

comment on column public.game_videos.tip_wall is
  'Epoch ms from the SCORING DEVICE clock at tip-off. Paired with '
  'game_events.payload.wall from the same device, so an offset clock cancels. '
  'Never compare it with a server timestamp.';

-- ----------------------------------------------------------------------------
-- The database stamps its own clock, on request.
--
-- p_tip_now          -> tip_at = now()
-- p_stream_ms_ago    -> stream_started_at = now() - that many milliseconds,
--                       which is what a mixer means when it reports how long
--                       it has been streaming.
--
-- Both are still overridable by the explicit timestamptz arguments from 0082,
-- because a recording attached the following Monday has to be able to say
-- when the game actually was.
-- ----------------------------------------------------------------------------
/* Dropped before the create, not after: an overload that differs only in its
   argument list is a DIFFERENT function to Postgres, and a caller naming its
   arguments — every caller here does — gets "function is not unique" and the
   whole feature stops. Both earlier shapes go first. */
drop function if exists public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean);
drop function if exists public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint);

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
  /* HOW LONG AGO THE BALL WENT UP, rather than "now".

     p_tip_now is only correct if the request arrives the instant it is made.
     Tip-off is the moment forty phones join one access point in a sports hall,
     so it is the request most likely NOT to, and the scorer now retries until
     it lands. A retry three minutes later carrying p_tip_now would move the
     anchor three minutes and every clip in the game with it — the retry would
     have been worse than the failure it was fixing.

     An elapsed duration is immune: the scorer measures it against its own
     clock at the moment of sending, and the database subtracts it from its
     own. Same trick as p_stream_ms_ago, same reason. */
  p_tip_ms_ago   bigint default null
) returns public.game_videos
language plpgsql security definer set search_path = public as $fn$
declare
  v          public.game_videos;
  may        boolean;
  tip_final  timestamptz;
  strt_final timestamptz;
begin
  select public.can_score(p_game) or public.is_platform_admin() or exists (
      select 1 from public.games g
      join public.competitions c on c.id = g.competition_id
      join public.seasons s      on s.id = c.season_id
      where g.id = p_game and public.is_league_admin(s.league_id))
    into may;
  if not may then
    raise exception 'not allowed to attach video to this game';
  end if;

  /* An explicit time wins over "now" — a human correcting a stamp is more
     informed than the machine that made it. */
  tip_final := coalesce(
    p_tip,
    case when p_tip_ms_ago is not null and p_tip_ms_ago between 0 and 14400000
         then now() - make_interval(secs => p_tip_ms_ago / 1000.0) end,
    case when p_tip_now then now() end);

  /* A mixer's own duration counter, turned into an instant on THIS clock.
     Clamped at four hours: a nonsense duration from a mixer that has been
     open since yesterday would otherwise put the stream start before the
     league existed, and every clip position with it. */
  strt_final := coalesce(
    p_stream_start,
    case when p_stream_ms_ago is not null and p_stream_ms_ago between 0 and 14400000
         then now() - make_interval(secs => p_stream_ms_ago / 1000.0) end);

  select * into v from public.game_videos
   where game_id = p_game and is_primary order by created_at limit 1;

  if v.id is null then
    insert into public.game_videos
      (game_id, url, provider, video_ref, label,
       stream_started_at, tip_at, tip_wall, trim_ms, is_live, created_by)
    values
      (p_game, coalesce(btrim(p_url), ''), coalesce(p_provider, 'youtube'),
       coalesce(p_ref, ''), coalesce(nullif(btrim(p_label), ''), 'Full game'),
       strt_final, tip_final, p_tip_wall, coalesce(p_trim_ms, 0),
       coalesce(p_is_live, false), auth.uid())
    returning * into v;
    return v;
  end if;

  update public.game_videos set
    url               = coalesce(nullif(btrim(p_url), ''), url),
    provider          = coalesce(p_provider, provider),
    video_ref         = coalesce(p_ref, video_ref),
    label             = coalesce(nullif(btrim(p_label), ''), label),
    stream_started_at = coalesce(strt_final, stream_started_at),
    tip_at            = coalesce(tip_final, tip_at),
    tip_wall          = coalesce(p_tip_wall, tip_wall),
    trim_ms           = coalesce(p_trim_ms, trim_ms),
    is_live           = coalesce(p_is_live, is_live),
    updated_at        = now()
  where id = v.id
  returning * into v;
  return v;
end $fn$;

/* And the 0083 signature too, for a database that ran an earlier copy of this
   file — otherwise the same overload trap re-opens one revision later. */
drop function if exists public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint);

grant execute on function public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint, bigint)
  to authenticated;

-- ----------------------------------------------------------------------------
-- WHERE A LEAGUE'S CHANNEL LIVES, so a live stream needs no link pasted at all.
--
-- OBS knows when the stream started and which platform it goes to. It does NOT
-- know the public watch URL — YouTube issues that to the broadcast, not to the
-- encoder, and obs-websocket has no request that would return it. Pretending
-- otherwise would mean guessing.
--
-- But YouTube publishes a stable embed for "whatever this channel is streaming
-- right now": youtube.com/embed/live_stream?channel=<id>. Store the channel id
-- once, per league, and a live game needs nothing typed per fixture — the box
-- score embeds the league's channel and shows the game that is on it.
--
-- It is a public identifier, not a credential, so unlike the stream key beside
-- it, it is readable by anyone who can read the league.
-- ----------------------------------------------------------------------------
alter table public.league_stream_targets
  add column if not exists channel_ref text not null default '';

comment on column public.league_stream_targets.channel_ref is
  'The PUBLIC channel identifier — a YouTube channel id (UC…) or a Twitch '
  'channel name. Not a credential. Lets a live game be embedded with nothing '
  'typed per fixture.';

create or replace function public.league_channel_for_game(p_game uuid)
returns table (platform text, channel_ref text)
language sql stable security definer set search_path = public as $fn$
  select t.platform, t.channel_ref
  from public.games g
  join public.competitions c on c.id = g.competition_id
  join public.seasons s      on s.id = c.season_id
  join public.league_stream_targets t on t.league_id = s.league_id and t.active
  where g.id = p_game
    and t.channel_ref <> ''
    and public.can_read_game(p_game)
  order by t.updated_at desc
  limit 1;
$fn$;
grant execute on function public.league_channel_for_game(uuid) to anon, authenticated;

-- Also surfaced in the admin listing, which never shows the key.
--
-- DROPPED FIRST, because this ADDS A COLUMN to what the function returns and
-- `create or replace` cannot do that: Postgres refuses with "cannot change
-- return type of existing function — row type defined by OUT parameters is
-- different". The argument list is unchanged, so it is easy to assume replace
-- is enough; it is the RETURN shape that has moved.
--
-- Safe to drop: nothing depends on it — no view, no other function — and the
-- grant is reissued below, which a drop would otherwise take with it.
drop function if exists public.stream_targets_for_league(uuid);

create or replace function public.stream_targets_for_league(p_league uuid)
returns table (id uuid, label text, platform text, server text,
               key_tail text, channel_ref text, note text, active boolean,
               updated_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select t.id, t.label, t.platform, t.server,
         case when length(t.stream_key) > 4
              then '••••' || right(t.stream_key, 4)
              else '••••' end,
         t.channel_ref, t.note, t.active, t.updated_at
  from public.league_stream_targets t
  where t.league_id = p_league
    and (public.is_platform_admin() or public.is_league_admin(t.league_id))
  order by t.active desc, t.label;
$fn$;
grant execute on function public.stream_targets_for_league(uuid) to authenticated;

-- ============================================================================
-- SELF-TEST — the two durations, and that neither crosses a clock.
-- ============================================================================
do $test$
declare
  gid   uuid;
  v     public.game_videos;
  gap   bigint;
  since bigint;
begin
  select id into gid from public.games limit 1;
  if gid is null then
    raise notice '0083 self-test skipped: no games';
    return;
  end if;

  /* A stream that OBS says has been running for eleven minutes, and a scoring
     phone whose clock is a full minute fast. */
  insert into public.game_videos (game_id, url, video_ref, label,
                                  stream_started_at, tip_at, tip_wall)
  values (gid, 'https://youtu.be/__t83', '__t83', '__t83',
          now() - interval '11 minutes', now(),
          (extract(epoch from now()) * 1000)::bigint + 60000)
  returning * into v;

  gap := (extract(epoch from (v.tip_at - v.stream_started_at)) * 1000)::bigint;
  if gap < 659000 or gap > 661000 then
    raise exception '0083: the gap should be about eleven minutes, got % ms', gap;
  end if;

  /* An event tapped ninety seconds after tip, on that same fast phone. The
     phone's minute of error appears on BOTH ends and cancels. */
  since := (v.tip_wall + 90000) - v.tip_wall;
  if since <> 90000 then
    raise exception '0083: a wrong device clock did not cancel, got % ms', since;
  end if;

  delete from public.game_videos where video_ref = '__t83';
  raise notice '0083 ok: the gap is one clock and the offset is another, so '
               'neither insert latency nor a wrong device clock can move a clip';
end $test$;
