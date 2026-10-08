-- ============================================================================
-- 0258 - EVERY STAMP ON THE FEED, AND THE LATEST ON HOME (EPINOIA GO) (Louie, 2026-10-08)
--
-- "It all needs to go into the feed and show on the home page when stamped." Until now the feed (0177) carried the
-- photographs and the stamps of the fans who went public; every other stamp was private. Now EVERY stamp is on it:
--   * a fan who went public (public, stamps shown, 18 or over: 0177's rule) is named, as before - "@user";
--   * everybody else's stamp is there WITHOUT a name: "a fan". No username, no account id, no link to a person,
--     never the note, never a location - the game, the arena and the time only. A search by a username (the
--     fan page, the wall's "this fan") finds only that fan's named stamps: an unnamed stamp is never matched by the
--     name it hides;
--   * a youth league's stamps are never shown (leagues.go_photos, 0167) and a private league's only to those who
--     may see it, as before. On 2026-10-08 no stamp had been made yet, so nobody's stamp becomes visible that they
--     made under the old rule.
--
--   go_feed()           the feed, as 0177 (photographs first, then the stamps), now with every stamp
--   go_stamps_latest()  the newest stamps first, named or not, for HOME's "just stamped" row; `mine` tells the
--                       reader which are their own (never anybody else's)
-- The privacy notice says the same (privacy/: "What a stamp keeps", "Going public").
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE FEED: every stamp, named only where the fan went public
-- ----------------------------------------------------------------------------
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
             0, false, s.stamped_at, n.shown, s.game_id, g.tipoff_at, ht.name, awt.name,
             s.venue_id, v.name, v.city, s.league_id, l.name, l.slug,
             l.timezone, ht.short_name, ht.colour, ht.logo_path, awt.short_name, awt.colour, awt.logo_path,
             1
        from stamps s
        cross join lateral (
          /* the name shown: the fan's username only where they went public (0177's rule), else none */
          select (select u.username from usernames u join go_settings gs on gs.user_id = u.user_id
                   where u.user_id = s.user_id and gs.public and gs.stamps_public and gs.adult_confirmed_at is not null) as shown
        ) n
        join venues v on v.id = s.venue_id
        left join games g on g.id = s.game_id
        left join teams ht on ht.id = g.home_team_id
        left join teams awt on awt.id = g.away_team_id
        left join leagues l on l.id = s.league_id
       where (s.league_id is null or (public.league_visible(s.league_id) and coalesce(l.go_photos, true)))
         and (p_league is null or s.league_id = p_league)
         and (p_venue is null or s.venue_id = p_venue)
         and (p_game is null or s.game_id = p_game)
         -- a name searched for finds only what is shown under it: never an unnamed stamp
         and (p_username is null or (n.shown is not null and lower(n.shown) = lower(p_username)))
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
-- 2. THE LATEST STAMPS, NEWEST FIRST (HOME's "just stamped")
-- ----------------------------------------------------------------------------
create or replace function public.go_stamps_latest(p_limit integer default 12)
returns table (id uuid, created_at timestamptz, username text, mine boolean, game_id uuid, tipoff_at timestamptz,
               home text, away text, venue_id uuid, venue text, city text, league_id uuid, league text,
               league_slug text, tz text, home_short text, home_colour text, home_logo text,
               away_short text, away_colour text, away_logo text)
language sql stable security definer set search_path = public as $$
  select s.id, s.stamped_at,
         (select u.username from usernames u join go_settings gs on gs.user_id = u.user_id
           where u.user_id = s.user_id and gs.public and gs.stamps_public and gs.adult_confirmed_at is not null),
         (auth.uid() is not null and s.user_id = auth.uid()),
         s.game_id, g.tipoff_at, ht.name, awt.name, s.venue_id, v.name, v.city, s.league_id, l.name, l.slug,
         l.timezone, ht.short_name, ht.colour, ht.logo_path, awt.short_name, awt.colour, awt.logo_path
    from stamps s
    join venues v on v.id = s.venue_id
    left join games g on g.id = s.game_id
    left join teams ht on ht.id = g.home_team_id
    left join teams awt on awt.id = g.away_team_id
    left join leagues l on l.id = s.league_id
   where (s.league_id is null or (public.league_visible(s.league_id) and coalesce(l.go_photos, true)))
   order by s.stamped_at desc, s.id
   limit greatest(1, least(coalesce(p_limit, 12), 48));
$$;
revoke all on function public.go_stamps_latest(integer) from public;
grant execute on function public.go_stamps_latest(integer) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('go_feed', 'go_stamps_latest')
                and pg_get_function_result(p.oid) ~ '(^|[ (,])user_id ') then
    raise exception '0258: a feed names an account id';
  end if;
  if not has_function_privilege('anon', 'public.go_stamps_latest(integer)', 'execute')
     or not has_function_privilege('anon', 'public.go_feed(uuid, uuid, uuid, text, text, integer, integer)', 'execute') then
    raise exception '0258: the feed is public and anon may not read it';
  end if;
end $$;

notify pgrst, 'reload schema';
