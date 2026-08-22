-- ============================================================================
-- TWO PEOPLE DOING THE SAME THING AT THE SAME TIME.
--
-- Everything on this platform that races, races in the twenty seconds around
-- tip-off: the control room stamps the stream start, the scorer stamps the
-- ball going up, a second statistician opens the game to help, and a hundred
-- people load the box score because a link just went out. This migration is
-- about the writes among those, and about the reads that were doing a
-- sequential scan because nobody had indexed the column they filter on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ONE PRIMARY VIDEO PER GAME, ENFORCED RATHER THAN ASSUMED.
--
-- set_game_video looks for the primary row and inserts one if it finds none.
-- Between the look and the insert there is a gap, and the two callers most
-- likely to be in it are the two halves of this feature: the control room
-- recording when the stream started, and the scorer recording when the ball
-- went up. They fire seconds apart, from different machines, at exactly the
-- moment the game begins.
--
-- Lose that race and there are two primary rows: one holding stream_started_at
-- and one holding tip_at. Every reader takes `is_primary=true … limit 1`, so it
-- gets one of them — never both — and gapMs() returns null for the rest of the
-- game. The video is silently unanchorable, and the only symptom is that the
-- play list never appears.
--
-- A partial unique index makes the race impossible to lose: the second insert
-- cannot succeed, so the function can be told to merge into the winner instead.
-- ----------------------------------------------------------------------------

-- Any database that already lost the race keeps its OLDEST primary row — the
-- one other rows may already reference — and demotes the rest rather than
-- deleting them, because a URL somebody pasted is not ours to throw away.
update public.game_videos v set is_primary = false
where v.is_primary
  and exists (
    select 1 from public.game_videos w
    where w.game_id = v.game_id and w.is_primary and w.created_at < v.created_at
  );

create unique index if not exists game_videos_one_primary
  on public.game_videos (game_id) where is_primary;

-- ----------------------------------------------------------------------------
-- And the function stops racing at all: one statement, decided by the database.
--
-- on conflict do update rather than select-then-insert, so two callers arriving
-- together produce one row holding BOTH their contributions — which is exactly
-- what the two halves of an anchor need. coalesce keeps null meaning
-- "leave it alone" on the update side, unchanged from 0083.
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
  p_is_live      boolean default null,
  p_tip_now      boolean default null,
  p_stream_ms_ago bigint default null,
  p_tip_wall     bigint default null,
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
     stream_started_at, tip_at, tip_wall, trim_ms, is_live, is_primary, created_by)
  values
    (p_game, coalesce(nullif(btrim(p_url), ''), ''),
     coalesce(p_provider, 'youtube'), coalesce(p_ref, ''),
     coalesce(nullif(btrim(p_label), ''), 'Full game'),
     strt_final, tip_final, p_tip_wall, coalesce(p_trim_ms, 0),
     coalesce(p_is_live, false), true, auth.uid())
  on conflict (game_id) where is_primary do update set
    /* The loser of the race merges into the winner: every field keeps what it
       had unless THIS CALLER supplied a value.

       Written against the PARAMETERS, not against `excluded`, and that is not
       a style choice. The insert above substitutes defaults for the arguments
       nobody passed — provider becomes 'youtube', label becomes 'Full game' —
       so excluded carries those inventions rather than nulls. Merging from
       excluded would therefore retitle somebody's Twitch stream as YouTube and
       rename their second-camera feed to "Full game", purely because a
       different caller happened to be updating the trim. */
    url               = coalesce(nullif(btrim(p_url), ''), game_videos.url),
    provider          = coalesce(p_provider, game_videos.provider),
    video_ref         = coalesce(nullif(p_ref, ''), game_videos.video_ref),
    label             = coalesce(nullif(btrim(p_label), ''), game_videos.label),
    stream_started_at = coalesce(strt_final, game_videos.stream_started_at),
    tip_at            = coalesce(tip_final, game_videos.tip_at),
    tip_wall          = coalesce(p_tip_wall, game_videos.tip_wall),
    trim_ms           = coalesce(p_trim_ms, game_videos.trim_ms),
    is_live           = coalesce(p_is_live, game_videos.is_live),
    updated_at        = now()
  returning * into v;

  return v;
end $fn$;
grant execute on function public.set_game_video(uuid, text, text, text, text,
  timestamptz, timestamptz, int, boolean, boolean, bigint, bigint, bigint)
  to authenticated;

-- ----------------------------------------------------------------------------
-- THE COLUMNS EVERY CLUB PAGE FILTERS ON, WHICH NOTHING INDEXED.
--
-- games carries indexes on competition_id, status and tipoff_at. Every team
-- page, every player profile and every "this club's fixtures" query asks a
-- different question:
--
--   or=(home_team_id.eq.X, away_team_id.eq.X) & status=eq.final
--   & order=tipoff_at.desc & limit=40
--
-- With nothing on the two team columns that is a sequential scan of the whole
-- games table, per request, on the pages people open most. It costs nothing on
-- a demo league with twenty-two rows and it is the profile page's dominant
-- cost once a platform is carrying several leagues and several seasons.
--
-- Two separate indexes rather than one composite: an OR over two columns is
-- served by a bitmap OR of two index scans, and a composite on (home, away)
-- cannot answer "away = X" at all. tipoff_at rides along so the ORDER BY and
-- the LIMIT are satisfied from the index instead of sorting the match set.
-- ----------------------------------------------------------------------------
create index if not exists games_home_team on public.games (home_team_id, tipoff_at desc);
create index if not exists games_away_team on public.games (away_team_id, tipoff_at desc);

-- ----------------------------------------------------------------------------
-- And a defensive tidy-up: an earlier draft of 0084 created a second, identical
-- index on game_events (game_id, seq) under its own name. `if not exists` tests
-- the NAME, so it did not collide with the one 0001 made — it simply doubled
-- the write cost of the busiest table on the platform. Dropped if present.
-- ----------------------------------------------------------------------------
drop index if exists public.game_events_game_seq;

-- ============================================================================
-- SELF-TEST — the race is now unlosable, and the merge keeps both halves.
-- ============================================================================
do $test$
declare
  gid    uuid;
  a      public.game_videos;
  b      public.game_videos;
  n      int;
  dupes  int;
begin
  /* A GAME NOBODY HAS ATTACHED A VIDEO TO.

     The test inserts with the same on-conflict clause the function uses, so
     running it against a game that already HAS a primary row would not create
     a test row — it would quietly update somebody's real one. A self-test that
     can corrupt the data it is checking is worse than no self-test. */
  select g.id into gid
  from public.games g
  where not exists (select 1 from public.game_videos v where v.game_id = g.id)
  limit 1;
  if gid is null then
    raise notice '0085 self-test skipped: no game without a video to test on';
    return;
  end if;

  /* Nobody may hold two primaries any more — including any database that
     already had them before the update above. */
  select count(*) into dupes from (
    select game_id from public.game_videos where is_primary
    group by game_id having count(*) > 1) x;
  if dupes > 0 then
    raise exception '0085: % games still have more than one primary video', dupes;
  end if;

  /* The two halves of an anchor, arriving as two separate inserts — which is
     what the control room and the scorer actually do. */
  insert into public.game_videos (game_id, url, video_ref, label, stream_started_at)
  values (gid, '', '__t85', '__t85', now() - interval '11 minutes')
  on conflict (game_id) where is_primary do update
    set stream_started_at = excluded.stream_started_at
  returning * into a;

  insert into public.game_videos (game_id, url, video_ref, label, tip_at, tip_wall)
  values (gid, '', '__t85', '__t85', now(), 1700000000000)
  on conflict (game_id) where is_primary do update
    set tip_at = excluded.tip_at, tip_wall = excluded.tip_wall
  returning * into b;

  select count(*) into n from public.game_videos where game_id = gid and is_primary;
  if n <> 1 then
    raise exception '0085: the second insert made a second primary row (% found)', n;
  end if;
  if b.stream_started_at is null or b.tip_at is null then
    raise exception '0085: the merge lost half the anchor (start %, tip %)',
      b.stream_started_at, b.tip_at;
  end if;

  delete from public.game_videos where video_ref = '__t85';
  raise notice '0085 ok: one primary video per game, both halves of the anchor '
               'survive a race, and club fixtures are indexed';
end $test$;
