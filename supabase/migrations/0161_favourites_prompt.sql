-- ============================================================================
-- 0161 - THE FAVOURITES PROMPT ("Who's your favourite?", HOME).
--
-- Once, for anybody signed in who follows no club (a first sign-in, or an account that was already
-- there), HOME unrolls a panel under the daily fixtures asking which leagues they prefer to watch and
-- which clubs they back (home/favourites.js, docs/favourites.md). What they pick is followed:
-- fan_prefs.fav_league_ids and fav_team_ids, the lists every bell already writes. Nothing about
-- following is new.
--
-- What IS new is "don't show this again", which for a signed-in fan belongs to the ACCOUNT rather
-- than the browser, exactly as the fans' vote's does (want_fanvote, 0150): one switch, on the profile
-- page, that holds on every device. It is on unless the fan said otherwise. The browser keeps its own
-- note as well (localStorage epinoia.favourites), which is what a database without this migration
-- falls back on: the page asks for the column tolerantly and set_fan_prefs, which reads only the keys
-- it knows, simply ignores the one it has not been taught.
--
-- set_fan_prefs (latest: 0150) is its predecessor plus the line tagged -- 0161.
-- ============================================================================

alter table public.fan_prefs add column if not exists want_favourites boolean not null default true;
comment on column public.fan_prefs.want_favourites is
  'HOME''s "Who''s your favourite?" panel may open by itself (0161). False once the fan said "don''t show this again"; the profile turns it back on.';

create or replace function public.set_fan_prefs(p jsonb)
returns public.fan_prefs language plpgsql security invoker set search_path = public as $$
declare r public.fan_prefs;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update fan_prefs set
    theme              = coalesce(p->>'theme', theme),
    colour             = coalesce(p->>'colour', colour),
    fav_team_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_team_ids') x), fav_team_ids),
    fav_player_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_player_ids') x), fav_player_ids),
    fav_game_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_game_ids') x), fav_game_ids),
    fav_league_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_league_ids') x), fav_league_ids),
    notify_inapp       = coalesce((p->>'notify_inapp')::boolean, notify_inapp),
    notify_email       = coalesce((p->>'notify_email')::boolean, notify_email),
    notify_push        = coalesce((p->>'notify_push')::boolean, notify_push),
    want_results       = coalesce((p->>'want_results')::boolean, want_results),
    want_players       = coalesce((p->>'want_players')::boolean, want_players),
    want_fixtures      = coalesce((p->>'want_fixtures')::boolean, want_fixtures),
    want_announcements = coalesce((p->>'want_announcements')::boolean, want_announcements),
    want_fixture_2d    = coalesce((p->>'want_fixture_2d')::boolean, want_fixture_2d),
    want_fixture_2h    = coalesce((p->>'want_fixture_2h')::boolean, want_fixture_2h),
    want_lineups       = coalesce((p->>'want_lineups')::boolean, want_lineups),
    want_player_games  = coalesce((p->>'want_player_games')::boolean, want_player_games),
    want_halftime      = coalesce((p->>'want_halftime')::boolean, want_halftime),
    want_fanvote       = coalesce((p->>'want_fanvote')::boolean, want_fanvote),         -- 0150
    want_favourites    = coalesce((p->>'want_favourites')::boolean, want_favourites),   -- 0161
    time_zone          = case when nullif(btrim(coalesce(p->>'time_zone', '')), '') is not null
                               then public.notify_valid_tz(p->>'time_zone') else time_zone end,
    updated_at         = now()
  where user_id = auth.uid()
  returning * into r;

  -- an empty array is a real instruction, and array_agg over nothing is null
  if p ? 'fav_team_ids' and jsonb_array_length(p->'fav_team_ids') = 0 then
    update fan_prefs set fav_team_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_player_ids' and jsonb_array_length(p->'fav_player_ids') = 0 then
    update fan_prefs set fav_player_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_game_ids' and jsonb_array_length(p->'fav_game_ids') = 0 then
    update fan_prefs set fav_game_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_league_ids' and jsonb_array_length(p->'fav_league_ids') = 0 then
    update fan_prefs set fav_league_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- A read-only check, so a push that did not take either half says so instead of leaving the profile
-- switch writing to nowhere.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fan_prefs' and column_name = 'want_favourites') then
    raise exception '0161: fan_prefs.want_favourites is missing';
  end if;
  if position('want_favourites' in pg_get_functiondef('public.set_fan_prefs(jsonb)'::regprocedure)) = 0 then
    raise exception '0161: set_fan_prefs does not take want_favourites';
  end if;
end $$;
