-- ============================================================================
-- ONE CLOCK FOR THE GAME AND THE VIDEO OF IT.
--
-- Every event in game_events already carries created_at — the instant the
-- statistician's tap reached the database. A video of the same game is a
-- second timeline over the same afternoon. Line the two up ONCE and every
-- play in the log gains a position in the footage, for free, for ever: "show
-- me all his three-pointers" stops being an editing job and becomes a filter
-- over a list the platform already has.
--
-- LINING THEM UP IS ONE NUMBER, and it is the number a producer already knows:
-- the gap between the stream starting and the ball going up. A stream is
-- started five, ten, twenty minutes before tip so the pre-game graphics have
-- somewhere to live; that dead air at the front is the whole offset.
--
--     video position of an event  =  gap  +  (event's wall clock − tip-off's)
--
-- So this table stores the two instants that gap is made of rather than the
-- gap itself:
--
--   * stream_started_at — when the video began. Stamped automatically the
--     moment the control room starts the stream, because the control room is
--     already on this platform and already knows what time it is. Nobody
--     should have to write this down.
--   * tip_at           — when the ball went up. Stamped automatically by the
--     scorer at the first period_start, for the same reason.
--   * trim_ms          — the human correction, in milliseconds. Automatic
--     stamps land within a second or two, which is fine for a highlight with
--     eight seconds of run-up and not fine for somebody scrubbing frame by
--     frame; and a video uploaded on Monday has no automatic stamp at all. So
--     there is a knob, and it is the ONLY knob: one number to nudge, in one
--     place, rather than an offset per event.
--
-- The gap is therefore derived, never stored — which matters, because a stored
-- gap goes stale the moment somebody corrects the tip-off time and nothing
-- would tell you it had.
--
-- WHY NOT MAP THE GAME CLOCK INSTEAD? Because the game clock stops. Ten
-- minutes of fourth quarter is twenty-five minutes of video, and the ratio is
-- different in every game and every quarter of it. Wall clock is the only axis
-- the two timelines actually share.
-- ============================================================================

create table if not exists public.game_videos (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games on delete cascade,

  provider    text not null default 'youtube'
              check (provider in ('youtube','twitch','facebook','vimeo','mp4','other')),
  /* What was pasted, kept verbatim. The platform-specific id is extracted into
     video_ref for embedding, but the original is what a human recognises and
     what to fall back to if our reading of some future URL shape is wrong. */
  url         text not null,
  video_ref   text not null default '',
  label       text not null default 'Full game',

  -- ---- the two instants, and the one knob ----
  stream_started_at timestamptz,
  tip_at            timestamptz,
  trim_ms           int not null default 0
                    check (trim_ms between -7200000 and 7200000),

  /* A live stream and the archived recording of it are usually the same URL on
     YouTube, but not everywhere, and a highlight reel is neither. */
  is_live     boolean not null default false,
  /* The one the box score embeds. A game can carry several — a second camera,
     a commentary feed — and exactly one is the default. */
  is_primary  boolean not null default true,

  created_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists game_videos_game on public.game_videos (game_id, is_primary desc);

comment on table public.game_videos is
  'Video of a game, anchored to wall clock so play-by-play events map onto '
  'positions in the footage. Public wherever the game itself is public.';

alter table public.game_videos enable row level security;

/* Readable exactly where the game is. A link to a public YouTube stream is not
   a secret — but a game inside a private competition is, and the fixture list
   is where that has already been decided. */
drop policy if exists game_videos_read on public.game_videos;
create policy game_videos_read on public.game_videos for select
  using (public.can_read_game(game_id));

/* Written by whoever may score the game — the statistician in the hall is the
   person who knows when the ball went up — or by an administrator of the
   league, who is the one attaching a recording uploaded on Monday. */
drop policy if exists game_videos_write on public.game_videos;
create policy game_videos_write on public.game_videos for all
  using (
    public.can_score(game_id) or public.is_platform_admin() or exists (
      select 1 from public.games g
      join public.competitions c on c.id = g.competition_id
      join public.seasons s      on s.id = c.season_id
      where g.id = game_videos.game_id and public.is_league_admin(s.league_id))
  )
  with check (
    public.can_score(game_id) or public.is_platform_admin() or exists (
      select 1 from public.games g
      join public.competitions c on c.id = g.competition_id
      join public.seasons s      on s.id = c.season_id
      where g.id = game_videos.game_id and public.is_league_admin(s.league_id))
  );

-- ----------------------------------------------------------------------------
-- ONE CALL THAT DOES THE WHOLE THING, because the scorer is a phone in a sports
-- hall and every extra round trip is a chance for the wifi to lose one.
--
-- Upsert on the primary row: pasting the link twice replaces rather than
-- duplicates, which is what "paste it again" means to the person doing it.
-- NULL means "leave that field alone" for every argument, so the scorer can
-- stamp tip_at without knowing or resending the URL, and the control room can
-- stamp stream_started_at without knowing either.
-- ----------------------------------------------------------------------------
create or replace function public.set_game_video(
  p_game         uuid,
  p_url          text default null,
  p_provider     text default null,
  p_ref          text default null,
  p_label        text default null,
  p_stream_start timestamptz default null,
  p_tip          timestamptz default null,
  p_trim_ms      int default null,
  p_is_live      boolean default null
) returns public.game_videos
language plpgsql security definer set search_path = public as $fn$
declare
  v   public.game_videos;
  may boolean;
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

  select * into v from public.game_videos
   where game_id = p_game and is_primary order by created_at limit 1;

  if v.id is null then
    /* NO URL YET IS A PERFECTLY GOOD FIRST CALL, and refusing it was wrong.
       The control room stamps the moment the stream starts — which is the
       perishable half of the anchor, gone the instant it passes — whereas
       YouTube does not hand out the public watch link until the broadcast is
       already up. Demanding the link first would throw away the one fact that
       cannot be recovered later in order to wait for one that can. */
    insert into public.game_videos
      (game_id, url, provider, video_ref, label,
       stream_started_at, tip_at, trim_ms, is_live, created_by)
    values
      (p_game, coalesce(btrim(p_url), ''), coalesce(p_provider, 'youtube'), coalesce(p_ref, ''),
       coalesce(nullif(btrim(p_label), ''), 'Full game'),
       p_stream_start, p_tip, coalesce(p_trim_ms, 0),
       coalesce(p_is_live, false), auth.uid())
    returning * into v;
    return v;
  end if;

  update public.game_videos set
    url               = coalesce(nullif(btrim(p_url), ''), url),
    provider          = coalesce(p_provider, provider),
    video_ref         = coalesce(p_ref, video_ref),
    label             = coalesce(nullif(btrim(p_label), ''), label),
    stream_started_at = coalesce(p_stream_start, stream_started_at),
    tip_at            = coalesce(p_tip, tip_at),
    trim_ms           = coalesce(p_trim_ms, trim_ms),
    is_live           = coalesce(p_is_live, is_live),
    updated_at        = now()
  where id = v.id
  returning * into v;
  return v;
end $fn$;
grant execute on function public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- STAMPING TIP-OFF WITHOUT ASKING ANYBODY.
--
-- The first period_start of a game IS the tip. Its created_at is the wall clock
-- of the moment the statistician started the first quarter, which is within a
-- second or two of the ball leaving the referee's hands — comfortably inside
-- the run-up every clip gets anyway. So a video attached after the fact needs
-- no manual tip time at all, and one attached before it gets corrected.
--
-- Left as a function rather than a trigger deliberately: a trigger on
-- game_events would run inside the scorer's own insert, and nothing about
-- attaching video is worth putting in the path of recording a basket.
-- ----------------------------------------------------------------------------
create or replace function public.game_tip_wallclock(p_game uuid)
returns timestamptz language sql stable security definer set search_path = public as $fn$
  select min(e.created_at)
  from public.game_events e
  where e.game_id = p_game
    and e.t = 'period_start'
    and coalesce(e.period, 1) = 1
    and public.can_read_game(p_game);
$fn$;
grant execute on function public.game_tip_wallclock(uuid) to anon, authenticated;

-- ============================================================================
-- SELF-TEST — the arithmetic the whole feature rests on.
-- ============================================================================
do $test$
declare
  gid    uuid;
  v      public.game_videos;
  gap_ms bigint;
begin
  select id into gid from public.games limit 1;
  if gid is null then
    raise notice '0082 self-test skipped: no games';
    return;
  end if;

  insert into public.game_videos (game_id, url, video_ref, label,
                                  stream_started_at, tip_at, trim_ms)
  values (gid, 'https://youtu.be/__selftest', '__selftest', '__selftest',
          timestamptz '2026-01-01 13:45:00Z', timestamptz '2026-01-01 14:00:00Z', 2000)
  returning * into v;

  -- fifteen minutes of pre-game, plus a two second trim
  gap_ms := (extract(epoch from (v.tip_at - v.stream_started_at)) * 1000)::bigint + v.trim_ms;
  if gap_ms <> 902000 then
    raise exception '0082: the gap should be 902000 ms, got %', gap_ms;
  end if;

  delete from public.game_videos where video_ref = '__selftest';
  raise notice '0082 ok: a video anchors to the game by wall clock, and the gap '
               'is derived from the stream start and the tip';
end $test$;
