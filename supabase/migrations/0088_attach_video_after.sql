-- ============================================================================
-- ATTACHING A RECORDING TO A GAME THAT HAS ALREADY BEEN PLAYED.
--
-- set_game_video has been gated on can_score since 0082, and can_score says
-- "and never once the game is final" — deliberately, because it guards the
-- EVENT LOG, and a finished game's log is a record that nobody should be able
-- to rewrite.
--
-- A video link is not the event log. It is a pointer at a recording, and the
-- normal case for attaching one is the case that gate forbids: the game
-- finished on Saturday, somebody uploaded the footage on Sunday, and the
-- statistician who scored it wants to line it up. Under the old rule they
-- could not — not from the scorer, which refuses to open a finished game at
-- all, and not from anywhere else, because the only permission the function
-- accepted was one that had already expired.
--
-- So video gets its own permission, and it is deliberately WIDER IN TIME and
-- NO WIDER IN PEOPLE:
--
--   * a platform administrator
--   * an administrator of the league that owns the game
--   * anybody who was an official on that game — the statistician, the
--     commissioner, whoever was at the table
--
-- Exactly the same people as can_score, minus the status condition. Nobody
-- new is admitted; they simply stop losing the right at the final whistle.
--
-- WHAT THIS DOES NOT UNLOCK. game_events is untouched: it is append-only for
-- everyone, forever, and its insert policy still runs through can_score. This
-- permission reaches one table, game_videos, and one function. The worst a
-- former official can do with it is point a finished game at the wrong video,
-- which is visible on the page and fixable by the same people.
-- ============================================================================

create or replace function public.may_attach_video(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    where g.id = p_game
      and ( public.is_platform_admin()
            or exists (select 1 from public.game_officials go
                       where go.game_id = p_game and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$fn$;

comment on function public.may_attach_video(uuid) is
  'May the caller attach or adjust the VIDEO of this game? The same people as '
  'can_score, without the "not once it is final" condition — a recording is '
  'normally attached after the game. Grants nothing over game_events.';

grant execute on function public.may_attach_video(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The function and the table policy both move onto it.
-- ----------------------------------------------------------------------------
drop policy if exists game_videos_write on public.game_videos;
create policy game_videos_write on public.game_videos for all
  using (public.may_attach_video(game_id))
  with check (public.may_attach_video(game_id));

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
     stream_started_at, tip_at, tip_wall, trim_ms, is_live, is_primary, created_by)
  values
    (p_game, coalesce(nullif(btrim(p_url), ''), ''),
     coalesce(p_provider, 'youtube'), coalesce(p_ref, ''),
     coalesce(nullif(btrim(p_label), ''), 'Full game'),
     strt_final, tip_final, p_tip_wall, coalesce(p_trim_ms, 0),
     coalesce(p_is_live, false), true, auth.uid())
  on conflict (game_id) where is_primary do update set
    /* Against the PARAMETERS, not excluded — the insert substitutes defaults
       for arguments nobody passed, so merging from excluded would retitle a
       Twitch stream as YouTube whenever somebody adjusted the trim. See 0085. */
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
-- WHERE THE BALL WENT UP, FOR A GAME NOBODY IS SCORING ANY MORE.
--
-- Lining a recording up needs the tip's wall clock, and the scorer supplies it
-- live. A game finished last month has none stored — but its log does: the
-- first period_start carries the moment the clock was started, and 0082
-- already exposes exactly that as game_tip_wallclock.
--
-- This fills it in from the log so somebody attaching a recording afterwards
-- only has to say where the jump ball is in the footage, which is the one
-- thing no database can know.
-- ----------------------------------------------------------------------------
create or replace function public.anchor_video_from_log(p_game uuid)
returns public.game_videos
language plpgsql security definer set search_path = public as $fn$
declare
  v   public.game_videos;
  tip timestamptz;
begin
  if not public.may_attach_video(p_game) then
    raise exception 'not allowed to attach video to this game';
  end if;

  tip := public.game_tip_wallclock(p_game);
  if tip is null then
    raise exception 'this game has no recorded tip-off to line a video up with';
  end if;

  update public.game_videos
     set tip_at = tip, updated_at = now()
   where game_id = p_game and is_primary and tip_at is null
  returning * into v;

  if v.id is null then
    select * into v from public.game_videos
     where game_id = p_game and is_primary limit 1;
  end if;
  return v;
end $fn$;
grant execute on function public.anchor_video_from_log(uuid) to authenticated;

-- ============================================================================
-- SELF-TEST — the right people, for longer; the wrong people, never.
-- ============================================================================
do $test$
declare
  fin  uuid;
  src  text;
begin
  select prosrc into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'may_attach_video';

  /* The whole point is the ABSENCE of the status condition. If somebody
     re-copies can_score into here, this catches it. */
  if src like '%status in%' then
    raise exception '0088: may_attach_video still refuses a finished game';
  end if;
  /* And the whole risk is somebody widening it while they are in here. */
  if src not like '%game_officials%' or src not like '%is_league_admin%' then
    raise exception '0088: may_attach_video has lost one of its three routes';
  end if;
  if src like '%true%' and src not like '%is_platform_admin%' then
    raise exception '0088: may_attach_video looks unconditional';
  end if;

  /* game_events must not have gained anything.

     CHECKED AGAINST with_check, NOT qual. An INSERT policy has no USING
     clause, so pg_policies.qual is null for one — the first version of this
     required `qual is not null` and therefore could never fire, whatever the
     policy said. A test that cannot fail reads like reassurance and provides
     none, which is worse than not having written it.

     Both columns are examined now, and every command rather than only INSERT:
     the point is that this permission reaches the video table and nothing
     else, so any appearance of it on the event log is the failure. */
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'game_events'
                and (coalesce(qual, '') like '%may_attach_video%'
                     or coalesce(with_check, '') like '%may_attach_video%')) then
    raise exception '0088: video permission has reached the event log';
  end if;

  /* And the policy that guards writing events still runs through can_score,
     which is the thing that must not have moved. */
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'game_events'
                    and cmd = 'INSERT'
                    and coalesce(with_check, '') like '%can_score%') then
    raise exception '0088: the event log is no longer gated on can_score';
  end if;

  select id into fin from public.games where status = 'final' limit 1;
  if fin is null then
    raise notice '0088 ok: video may be attached after a game is final';
    return;
  end if;

  if public.can_score(fin) then
    raise exception '0088: can_score should still refuse a finished game';
  end if;

  raise notice '0088 ok: a finished game stays unscorable, and its recording '
               'can still be attached by the people who ran it';
end $test$;
