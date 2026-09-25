-- ============================================================================
-- 0177 - ONE FEED OF EVERYBODY'S STAMPS, AND GOING PUBLIC IN ONE TAP (EPINOIA GO).
--
-- Until now the feed was the photographs (0167) and a stamp was private. The feed becomes every stamp
-- the fans have chosen to show, photographs first:
--
--   1. the stamps that have an approved photograph (shown as the photograph),
--   2. then the stamps of the fans who chose to show them, newest first.
--
-- A stamp is private (0165) and a fan who joined the leaderboards was told they show "never which
-- arenas" (0166), so nobody's stamps are shown because of an earlier choice. Showing your stamps is its
-- own switch, go_settings.stamps_public, and one tap - set_go_profile() - turns on all of it together: the
-- leaderboards, the stamps in the feed and, later, a public profile. A fan already on the leaderboards is
-- asked once whether to show their stamps too. What is shown of a stamp is the username, the game, the
-- arena and the date; never the note (private, 0168), never the email, never an account id.
--
--   go_settings.stamps_public   the fan's choice to show their stamps (needs public)
--   set_go_profile(on, adult)   one call: public + stamps public together (username and 18+ as before)
--   set_go_public()             as before, and taking a fan off the leaderboards takes their stamps off too
--   go_my_settings()            now also says whether the fan's stamps are shown
--   go_feed()                   the feed: photographs first, then the stamps fans chose to show
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A FAN'S CHOICE TO SHOW THEIR STAMPS
-- ----------------------------------------------------------------------------
alter table public.go_settings add column if not exists stamps_public boolean not null default false;
comment on column public.go_settings.stamps_public is
  '0177: this fan''s stamps (game, arena, date, under their username) appear in the feed. Off unless the fan chose it; only with public.';
alter table public.go_settings drop constraint if exists go_settings_stamps_need_public;
alter table public.go_settings add constraint go_settings_stamps_need_public check (not stamps_public or public);
create index if not exists go_settings_stamps_public on public.go_settings (user_id) where stamps_public;

/* the leaderboard switch as it was, except that coming off it takes the stamps off the feed as well */
create or replace function public.set_go_public(p_public boolean, p_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cur go_settings;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  select * into cur from go_settings where user_id = me;
  if coalesce(p_public, false) then
    if not exists (select 1 from usernames where user_id = me) then
      return jsonb_build_object('ok', false, 'reason', 'username');
    end if;
    if not coalesce(p_adult, false) and cur.adult_confirmed_at is null then
      return jsonb_build_object('ok', false, 'reason', 'adult');
    end if;
  end if;
  insert into go_settings (user_id, public, adult_confirmed_at, updated_at)
  values (me, coalesce(p_public, false),
          case when coalesce(p_public, false) or coalesce(p_adult, false) then coalesce(cur.adult_confirmed_at, now()) end,
          now())
  on conflict (user_id) do update
     set public = excluded.public,
         stamps_public = case when excluded.public then go_settings.stamps_public else false end,
         adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, excluded.adult_confirmed_at),
         updated_at = now();
  return jsonb_build_object('ok', true, 'public', coalesce(p_public, false));
end; $$;
alter function public.set_go_public(boolean, boolean) owner to postgres;
revoke all on function public.set_go_public(boolean, boolean) from public, anon;
grant execute on function public.set_go_public(boolean, boolean) to authenticated;

/* GOING PUBLIC IN ONE TAP: on = the leaderboards and the stamps in the feed; off = neither. The reasons
   it can refuse are set_go_public's: signed_out, username (choose one first), adult (confirm 18 or over). */
create or replace function public.set_go_profile(p_on boolean, p_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cur go_settings;
  want boolean := coalesce(p_on, false);
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  select * into cur from go_settings where user_id = me;
  if want then
    if not exists (select 1 from usernames where user_id = me) then
      return jsonb_build_object('ok', false, 'reason', 'username');
    end if;
    if not coalesce(p_adult, false) and cur.adult_confirmed_at is null then
      return jsonb_build_object('ok', false, 'reason', 'adult');
    end if;
  end if;
  insert into go_settings (user_id, public, stamps_public, adult_confirmed_at, updated_at)
  values (me, want, want,
          case when want or coalesce(p_adult, false) then coalesce(cur.adult_confirmed_at, now()) end,
          now())
  on conflict (user_id) do update
     set public = excluded.public,
         stamps_public = excluded.stamps_public,
         adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, excluded.adult_confirmed_at),
         updated_at = now();
  return jsonb_build_object('ok', true, 'public', want, 'stamps', want);
end; $$;
alter function public.set_go_profile(boolean, boolean) owner to postgres;
revoke all on function public.set_go_profile(boolean, boolean) from public, anon;
grant execute on function public.set_go_profile(boolean, boolean) to authenticated;

create or replace function public.go_my_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'public', coalesce((select public from go_settings where user_id = auth.uid()), false),
    'stamps', coalesce((select stamps_public from go_settings where user_id = auth.uid()), false),
    'adult', (select adult_confirmed_at is not null from go_settings where user_id = auth.uid()) is true,
    'username', (select username from usernames where user_id = auth.uid())) end;
$$;
revoke all on function public.go_my_settings() from public, anon;
grant execute on function public.go_my_settings() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. THE FEED
-- ----------------------------------------------------------------------------
/* Photographs first (every approved one: a fan chose to post it), then the stamps of the fans who chose to
   show them - a stamp that has an approved photograph is the photograph, not shown twice. Newest first, or
   most liked first (a stamp has no likes: it follows the photographs). One league, arena, game or fan
   (by username) narrows it; p_offset pages it. A private league's stamps only for those who may see it,
   and a league with players under 18 (go_photos false, 0167) shows no stamps. The row has no account id
   and never the note. It carries what a stamp's card is drawn from: the two clubs' short names, colours and
   crests (the club's own, as everywhere), and the league's time zone for the tip-off's day and hour. */
create or replace function public.go_feed(p_league uuid default null, p_venue uuid default null,
                                          p_game uuid default null, p_username text default null,
                                          p_sort text default 'new', p_offset integer default 0,
                                          p_limit integer default 48)
returns table (kind text, id uuid, path text, thumb_path text, width integer, height integer, caption text,
               likes integer, liked boolean, created_at timestamptz, username text, game_id uuid,
               tipoff_at timestamptz, home text, away text, venue_id uuid, venue text, city text,
               league_id uuid, league text, league_slug text, tz text,
               home_short text, home_colour text, home_logo text, away_short text, away_colour text, away_logo text)
language sql stable security definer set search_path = public as $$
  select f.kind, f.id, f.path, f.thumb_path, f.width, f.height, f.caption, f.likes, f.liked, f.created_at,
         f.username, f.game_id, f.tipoff_at, f.home, f.away, f.venue_id, f.venue, f.city, f.league_id,
         f.league, f.league_slug, f.tz, f.home_short, f.home_colour, f.home_logo,
         f.away_short, f.away_colour, f.away_logo
    from (
      select 'photo'::text as kind, ph.id, ph.path, ph.thumb_path, ph.width, ph.height, ph.caption,
             ph.likes,
             exists (select 1 from go_photo_likes lk where lk.photo_id = ph.id and lk.user_id = auth.uid()) as liked,
             ph.created_at, u.username, ph.game_id, g.tipoff_at, ht.name as home, awt.name as away,
             ph.venue_id, v.name as venue, v.city, ph.league_id, l.name as league, l.slug as league_slug,
             l.timezone as tz, ht.short_name as home_short, ht.colour as home_colour, ht.logo_path as home_logo,
             awt.short_name as away_short, awt.colour as away_colour, awt.logo_path as away_logo,
             0 as grp
        from go_photos ph
        join usernames u on u.user_id = ph.user_id
        left join games g on g.id = ph.game_id
        left join teams ht on ht.id = g.home_team_id
        left join teams awt on awt.id = g.away_team_id
        left join venues v on v.id = ph.venue_id
        left join leagues l on l.id = ph.league_id
       where ph.status = 'approved'
         and (ph.league_id is null or public.league_visible(ph.league_id))
         and (p_league is null or ph.league_id = p_league)
         and (p_venue is null or ph.venue_id = p_venue)
         and (p_game is null or ph.game_id = p_game)
         and (p_username is null or lower(u.username) = lower(p_username))
      union all
      select 'stamp'::text, s.id, null::text, null::text, null::integer, null::integer, null::text,
             0, false, s.stamped_at, u.username, s.game_id, g.tipoff_at, ht.name, awt.name,
             s.venue_id, v.name, v.city, s.league_id, l.name, l.slug,
             l.timezone, ht.short_name, ht.colour, ht.logo_path, awt.short_name, awt.colour, awt.logo_path,
             1
        from stamps s
        join go_settings gs on gs.user_id = s.user_id and gs.public and gs.stamps_public
                           and gs.adult_confirmed_at is not null
        join usernames u on u.user_id = s.user_id
        join venues v on v.id = s.venue_id
        left join games g on g.id = s.game_id
        left join teams ht on ht.id = g.home_team_id
        left join teams awt on awt.id = g.away_team_id
        left join leagues l on l.id = s.league_id
       where (s.league_id is null or (public.league_visible(s.league_id) and coalesce(l.go_photos, true)))
         and (p_league is null or s.league_id = p_league)
         and (p_venue is null or s.venue_id = p_venue)
         and (p_game is null or s.game_id = p_game)
         and (p_username is null or lower(u.username) = lower(p_username))
         and not exists (select 1 from go_photos ph
                          where ph.user_id = s.user_id and ph.game_id = s.game_id and ph.status = 'approved')
    ) f
   order by f.grp,
            case when p_sort = 'liked' then f.likes end desc nulls last,
            f.created_at desc, f.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 48), 96));
$$;
revoke all on function public.go_feed(uuid, uuid, uuid, text, text, integer, integer) from public;
grant execute on function public.go_feed(uuid, uuid, uuid, text, text, integer, integer) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.set_go_profile(boolean, boolean)', 'execute') then
    raise exception '0177: anon may call set_go_profile';
  end if;
  if has_table_privilege('authenticated', 'public.go_settings', 'update') then
    raise exception '0177: a fan may write go_settings directly';
  end if;
  if not has_function_privilege('anon', 'public.go_feed(uuid, uuid, uuid, text, text, integer, integer)', 'execute') then
    raise exception '0177: the feed is public and anon may not read it';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'go_feed'
                and pg_get_function_result(p.oid) ~ '(^|[ (,])user_id ') then
    raise exception '0177: go_feed names an account id';
  end if;
  if exists (select 1 from public.go_settings where stamps_public and not public) then
    raise exception '0177: a fan shows their stamps without being public';
  end if;
  raise notice '0177 ok';
end $$;
