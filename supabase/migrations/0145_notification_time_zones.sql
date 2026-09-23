-- ============================================================================
-- 0145 — A TIP-OFF TIME IN THE READER'S OWN CLOCK, NOT ALWAYS LONDON'S.
--
-- 0121 said, of notif_when and the reminder text: "the times are London's, whatever the
-- session's time zone, because every league on the platform plays in the UK." That stopped
-- being true once B.LEAGUE, ACB and the rest joined ([[epinoia-league-feeds]]): a fan in
-- Japan following Nagasaki Velca got "tip-off 11:05" for a game that tips off at 19:05
-- where they are, nine hours out, because notify_fixture_windows and notify_lineups both
-- format the game's timestamp "at time zone 'Europe/London'" once per game and hand every
-- recipient the same string.
--
-- WHAT THIS ADDS. fan_prefs.time_zone and push_devices.time_zone: an IANA name, captured
-- from the subscriber's own browser (Intl.DateTimeFormat().resolvedOptions().timeZone),
-- with 'Europe/London' the default for a row that has not told us yet — so nobody's
-- reminders change until their own browser says otherwise. notify_valid_tz falls back to
-- that default for anything pg_timezone_names does not recognise, so a malformed or stale
-- string from a browser can never break a write; it only means that one row keeps reading
-- London's clock until it sends a real one.
--
-- WHAT MOVES. notify_audience (0127) gains time_zone, validated, beside its other columns,
-- so both fan-outs that print a time of day already have it wherever they read the
-- audience. notif_when takes the zone as its second argument now (default kept, so any
-- caller this migration missed still behaves exactly as before). notify_fixture_windows and
-- notify_lineups stop computing one v_tip per game and format the hour inside the same
-- per-recipient SELECT instead — the only structural change either function makes.
-- notify_halftime and notify_game_final print no time of day (half-time state, a final
-- score) and are untouched. set_fan_prefs and notify_device_follow gain the same field, so
-- the profile page and the league-website notification button can both send it.
--
-- WHAT THIS DOES NOT TOUCH. The calendar feed (_shared/icsfeed.js) already avoids this
-- trap on purpose: DTSTART/DTEND end in Z, so any calendar app converts to the phone's own
-- zone on its own, and X-WR-TIMEZONE is left as the display hint it always was. The website
-- itself formats every tip-off with the browser's own toLocaleTimeString, no zone pinned
-- (fixtures.js, game.js, league.js, team.js, home/leagues.js, seo.js) — also already right.
-- The one place the platform ever wrote a fixed clock into a fan's day was these two
-- functions and the string they hand every recipient alike.
--
-- Re-running this file changes nothing beyond the two functions and the two columns.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE COLUMN, AND A VALIDATOR EVERY WRITER SHARES.
--
-- Free text, not a foreign key to pg_timezone_names: that catalogue can differ between
-- Postgres versions and is not something a migration should pin a constraint to. Validity
-- is instead checked, best-effort, at the moment anything is written — never at read, so a
-- name that stops being recognised after an upgrade degrades to the London default rather
-- than making an old row unreadable.
-- ----------------------------------------------------------------------------
alter table public.fan_prefs    add column if not exists time_zone text not null default 'Europe/London';
alter table public.push_devices add column if not exists time_zone text not null default 'Europe/London';

create or replace function public.notify_valid_tz(p_tz text)
returns text language sql stable set search_path = public as $$
  select coalesce((select name from pg_timezone_names where name = p_tz), 'Europe/London');
$$;

-- ----------------------------------------------------------------------------
-- 2. THE AUDIENCE, WITH A ZONE ON EVERY ROW (latest: 0127).
-- ----------------------------------------------------------------------------
create or replace view public.notify_audience as
  select p.user_id, null::uuid as device_id, p.user_id as sub,
         p.fav_team_ids, p.fav_player_ids, p.fav_game_ids,
         p.want_results, p.want_players, p.want_fixtures, p.want_announcements,
         p.want_fixture_2d, p.want_fixture_2h, p.want_lineups, p.want_player_games, p.want_halftime,
         public.notify_valid_tz(p.time_zone) as time_zone
    from public.fan_prefs p
  union all
  select null::uuid, d.id, d.id,
         d.fav_team_ids, d.fav_player_ids, d.fav_game_ids,
         d.want_results, d.want_players, true, d.want_announcements,
         d.want_fixture_2d, d.want_fixture_2h, d.want_lineups, true, d.want_halftime,
         public.notify_valid_tz(d.time_zone) as time_zone
    from public.push_devices d;
revoke all on table public.notify_audience from public, anon, authenticated;
alter view public.notify_audience owner to postgres;

-- ----------------------------------------------------------------------------
-- 3. notif_when TAKES THE ZONE (latest: 0121). p_tz defaults to London so a caller this
--    migration missed keeps its old answer rather than erroring.
-- ----------------------------------------------------------------------------
create or replace function public.notif_when(p_at timestamptz, p_tz text default 'Europe/London')
returns text language sql stable set search_path = public as $$
  select to_char(p_at at time zone public.notify_valid_tz(p_tz), 'Dy FMDD Mon, HH24:MI');
$$;

-- ----------------------------------------------------------------------------
-- 4. notify_fixture_windows (latest: 0127) — v_tip moves from a once-per-game session
--    variable into the SELECT that already reads notify_audience, so it reads p.time_zone
--    instead of a fixed one. Character for character 0127's copy otherwise.
-- ----------------------------------------------------------------------------
create or replace function public.notify_fixture_windows()
returns int language plpgsql security definer set search_path = public as $$
declare
  w             record;
  n             int := 0;
  c             int;
  v_memberships boolean := public.memberships_enabled();
  v_data        jsonb;
  v_ref         text;
  v_link        text;
  v_until       text;
  v_urgency     text;
  v_expires     timestamptz;
begin
  for w in
    select g.id, g.home_team_id, g.away_team_id, g.tipoff_at,
           nullif(btrim(g.venue), '') as venue,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           s.league_id,
           (l.id is null or l.access_mode = 'open' or l.access_fixtures_public   -- 0118
            or not v_memberships) as fixtures_public,
           case when g.tipoff_at > now() + interval '44 hours' then '2d' else '2h' end as win
      from games g
      join teams h on h.id = g.home_team_id
      join teams a on a.id = g.away_team_id
      left join competitions cp on cp.id = g.competition_id
      left join seasons s       on s.id = cp.season_id
      left join leagues l       on l.id = s.league_id
     where g.status = 'scheduled'
       and (   (g.tipoff_at > now() + interval '44 hours' and g.tipoff_at <= now() + interval '48 hours')
            or (g.tipoff_at > now() and g.tipoff_at <= now() + interval '2 hours'))
     order by g.tipoff_at, g.id
  loop
    v_ref     := w.id::text || ':' || w.win;
    v_link    := 'game/?g=' || w.id || '&mode=supabase';
    v_until   := public.notif_until(w.tipoff_at);
    v_urgency := case when w.win = '2h' then 'high' else 'normal' end;
    v_expires := case when w.win = '2d' then w.tipoff_at - interval '24 hours' else w.tipoff_at end;
    v_data    := jsonb_build_object(
                   'game', w.id,
                   'home', jsonb_build_object('id', w.home_team_id, 'name', w.home_name),
                   'away', jsonb_build_object('id', w.away_team_id, 'name', w.away_name),
                   'tipoff', w.tipoff_at,
                   'window', w.win);

    -- the club and game followers
    insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
    select p.user_id, p.device_id, 'fixture',
           w.home_name || ' v ' || w.away_name,
           case when w.win = '2d' then 'In 2 days · ' || public.notif_when(w.tipoff_at, p.time_zone)
                else v_until || ' · tip-off ' || to_char(w.tipoff_at at time zone p.time_zone, 'HH24:MI') end
             || coalesce(' · ' || w.venue, ''),
           v_link, w.league_id, w.id, v_ref, v_data, v_urgency, v_expires
      from notify_audience p
     where ((p.want_fixtures and (w.home_team_id = any (p.fav_team_ids) or w.away_team_id = any (p.fav_team_ids)))
            or w.id = any (p.fav_game_ids))
       and case when w.win = '2d' then p.want_fixture_2d else p.want_fixture_2h end
       and (w.fixtures_public or (p.user_id is not null and public.can_view_league_for(p.user_id, w.league_id)))
    on conflict do nothing;
    get diagnostics c = row_count; n := n + c;

    -- the player-only followers: neither club nor the game, grouped per subscriber
    with fans as (
      select p.sub, p.user_id, p.device_id, p.time_zone, pl.id as player_id,
             btrim(pl.first_name || ' ' || pl.last_name) as name,
             pl.last_name, pl.first_name
        from (select distinct re.player_id
                from roster_entries re
               where re.active and re.team_id in (w.home_team_id, w.away_team_id)) sq
        join players pl on pl.id = sq.player_id
                       and not public.player_withheld(pl.is_minor, pl.public_consent)
        join notify_audience p on pl.id = any (p.fav_player_ids)
       where p.want_fixtures and p.want_player_games
         and case when w.win = '2d' then p.want_fixture_2d else p.want_fixture_2h end
         and not (w.home_team_id = any (p.fav_team_ids) or w.away_team_id = any (p.fav_team_ids)
                  or w.id = any (p.fav_game_ids))
         and (w.fixtures_public or (p.user_id is not null and public.can_view_league_for(p.user_id, w.league_id)))
    )
    insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
    select f.user_id, f.device_id, 'fixture',
           public.notif_names(array_agg(f.name order by f.last_name, f.first_name, f.player_id))
             || case when w.win = '2d'
                     then case when count(*) = 1 then ' has a game in 2 days' else ' have a game in 2 days' end
                     else case when count(*) = 1 then ' plays ' else ' play ' end
                          || lower(left(v_until, 1)) || substr(v_until, 2)
                end,
           w.home_name || ' v ' || w.away_name || ' · '
             || case when w.win = '2d' then public.notif_when(w.tipoff_at, f.time_zone)
                     else 'tip-off ' || to_char(w.tipoff_at at time zone f.time_zone, 'HH24:MI') end,
           v_link, w.league_id, w.id, v_ref,
           v_data || jsonb_build_object('players',
             jsonb_agg(jsonb_build_object('id', f.player_id, 'name', f.name)
                       order by f.last_name, f.first_name, f.player_id)),
           v_urgency, v_expires
      from fans f
     group by f.sub, f.user_id, f.device_id, f.time_zone
    on conflict do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- 5. notify_lineups (latest: 0127) — same move: the one place it prints a time of day is
--    the player-only followers' body, so time_zone joins that CTE and nowhere else. The
--    club/game followers' body names no time at all and is unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.notify_lineups(p_game uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  n              int := 0;
  c              int;
  v_n            int;
  v_memberships  boolean := public.memberships_enabled();
  v_members_only boolean;
  v_squad        jsonb;
  v_home_line    text;
  v_away_line    text;
  v_starters     jsonb;
  v_data         jsonb;
  v_link         text;
  v_ref          text;
  v_expires      timestamptz;
begin
  for g in
    select gm.id, gm.home_team_id, gm.away_team_id, gm.tipoff_at, gm.starters, gm.roster_snapshot,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           public.notif_team_label(h.name, h.short_name) as home_label,
           public.notif_team_label(a.name, a.short_name) as away_label,
           s.league_id,
           l.access_mode
      from games gm
      join teams h on h.id = gm.home_team_id
      join teams a on a.id = gm.away_team_id
      left join competitions cp on cp.id = gm.competition_id
      left join seasons s       on s.id = cp.season_id
      left join leagues l       on l.id = s.league_id
     where (p_game is null or gm.id = p_game)
       and gm.status in ('scheduled', 'live')
       and gm.tipoff_at >= now() - interval '30 minutes'
       and gm.tipoff_at <= now() + interval '6 hours'
       and public.notif_starters_complete(gm.starters)
     order by gm.tipoff_at, gm.id
  loop
    begin
      if exists (select 1
                   from (values (0), (1)) sd(side)
                   cross join lateral jsonb_array_elements(g.starters -> sd.side) e(v)
                  where jsonb_typeof(e.v) not in ('string', 'number')) then
        raise exception 'games.starters of game % is not two lists of player ids', g.id
          using errcode = '22023';
      end if;

      -- 0118, decided once for the game
      v_members_only := coalesce(g.access_mode = 'members', false) and v_memberships;
      v_link    := 'game/?g=' || g.id || '&mode=supabase&show=starters';
      v_ref     := g.id::text || ':lineups';
      v_expires := g.tipoff_at + interval '1 hour';

      with st as (
        select sd.side, e.ord::int as ord, lower(e.v #>> '{}') as pid
          from (values (0), (1)) sd(side)
          cross join lateral jsonb_array_elements(g.starters -> sd.side) with ordinality e(v, ord)
      ),
      snap as (
        select sd.side, lower(sp.v ->> 'id') as pid,
               nullif(btrim(sp.v ->> 'name'), '') as name,
               nullif(btrim(sp.v ->> 'num'), '') as num
          from (values (0), (1)) sd(side)
          cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(g.roster_snapshot #> array['teams', sd.side::text, 'players']) = 'array'
                      then g.roster_snapshot #> array['teams', sd.side::text, 'players']
                      else '[]'::jsonb end) sp(v)
         where jsonb_typeof(sp.v) = 'object' and coalesce(sp.v ->> 'id', '') <> ''
      ),
      squad as (
        select st.side, st.ord, st.pid, 'starter'::text as role
          from st
        union all
        select sn.side, 1000, sn.pid, 'bench'
          from snap sn
         where not exists (select 1 from st where st.side = sn.side and st.pid = sn.pid)
        union all
        select distinct sd.side, 1000, re.player_id::text, 'bench'
          from (values (0), (1)) sd(side)
          join roster_entries re
            on re.active and re.team_id = case when sd.side = 0 then g.home_team_id else g.away_team_id end
         where not exists (select 1 from snap sn where sn.side = sd.side)
           and not exists (select 1 from st where st.side = sd.side and st.pid = re.player_id::text)
      ),
      lineup as (
        select q.side, q.ord, q.role, pl.id,
               coalesce(public.player_withheld(pl.is_minor, pl.public_consent), false) as withheld,
               coalesce(sn.num,
                        (select nullif(btrim(re.jersey), '')
                           from roster_entries re
                          where re.player_id = pl.id and re.active
                            and re.team_id = case when q.side = 0 then g.home_team_id else g.away_team_id end
                          order by re.created_at desc
                          limit 1)) as num,
               case when pl.id is not null then nullif(btrim(pl.first_name || ' ' || pl.last_name), '')
                    else initcap(sn.name) end as name,
               case when pl.id is not null then coalesce(nullif(btrim(pl.last_name), ''), nullif(btrim(pl.first_name), ''))
                    else initcap(reverse(split_part(reverse(sn.name), ' ', 1))) end as surname
          from squad q
          left join players pl
            on pl.id = case when q.pid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            then q.pid::uuid end
          left join lateral (select x.name, x.num from snap x
                              where x.side = q.side and x.pid = q.pid
                              limit 1) sn on true
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'side', lu.side, 'ord', lu.ord, 'role', lu.role, 'id', lu.id, 'withheld', lu.withheld,
               'num', lu.num, 'name', lu.name,
               'label', case when lu.withheld or lu.surname is null
                             then '#' || coalesce(lu.num, '?') else lu.surname end)
             order by lu.side, lu.ord, lu.name), '[]'::jsonb)
        into v_squad
        from lineup lu;

      select coalesce(string_agg(x ->> 'label', ', ' order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 0 and x ->> 'role' = 'starter'), ''),
             coalesce(string_agg(x ->> 'label', ', ' order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 1 and x ->> 'role' = 'starter'), ''),
             jsonb_build_array(
               coalesce(jsonb_agg(jsonb_build_object(
                          'id',   case when (x ->> 'withheld')::boolean then null else x -> 'id' end,
                          'name', case when (x ->> 'withheld')::boolean then null else x -> 'name' end,
                          'num',  x -> 'num') order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 0 and x ->> 'role' = 'starter'), '[]'::jsonb),
               coalesce(jsonb_agg(jsonb_build_object(
                          'id',   case when (x ->> 'withheld')::boolean then null else x -> 'id' end,
                          'name', case when (x ->> 'withheld')::boolean then null else x -> 'name' end,
                          'num',  x -> 'num') order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 1 and x ->> 'role' = 'starter'), '[]'::jsonb))
        into v_home_line, v_away_line, v_starters
        from jsonb_array_elements(v_squad) x;

      v_data := jsonb_build_object(
                  'game', g.id,
                  'home', jsonb_build_object('id', g.home_team_id, 'name', g.home_name),
                  'away', jsonb_build_object('id', g.away_team_id, 'name', g.away_name),
                  'tipoff', g.tipoff_at,
                  'starters', v_starters);
      v_n := 0;

      -- the club and game followers: both fives, by surname
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, p.device_id, 'lineups',
             'Lineups are in: ' || g.home_label || ' v ' || g.away_label,
             g.home_label || ': ' || v_home_line || chr(10) || g.away_label || ': ' || v_away_line,
             v_link, g.league_id, g.id, v_ref, v_data, 'high', v_expires
        from notify_audience p
       where (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)
              or g.id = any (p.fav_game_ids))
         and p.want_lineups
         and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      -- the player-only followers: the first followed player (starters first)
      -- in the title, the others appended to the body
      with sq as (
        select (x ->> 'id')::uuid as player_id, x ->> 'name' as name, x ->> 'role' as role,
               (x ->> 'side')::int as side, (x ->> 'ord')::int as ord
          from jsonb_array_elements(v_squad) x
         where x ->> 'id' is not null and not (x ->> 'withheld')::boolean
      ),
      fans as (
        select p.sub, p.user_id, p.device_id, p.time_zone, sq.player_id, sq.name, sq.role, sq.side,
               row_number() over (partition by p.sub
                                  order by (sq.role = 'starter') desc, sq.side, sq.ord, sq.name) as rn
          from sq
          join notify_audience p on sq.player_id = any (p.fav_player_ids)
         where p.want_lineups and p.want_player_games
           and not (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)
                    or g.id = any (p.fav_game_ids))
           and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      )
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select f.user_id, f.device_id, 'lineups',
             f.name || case when f.role = 'starter' then ' starts for ' else ' is on the bench for ' end
               || case when f.side = 0 then g.home_name else g.away_name end,
             g.home_name || ' v ' || g.away_name || ' · tip-off ' || to_char(g.tipoff_at at time zone f.time_zone, 'HH24:MI')
               || coalesce(' · ' || (select string_agg(o.name || case when o.role = 'starter' then ' starts'
                                                                      else ' on the bench' end,
                                                       ', ' order by o.rn)
                                       from fans o
                                      where o.sub = f.sub and o.rn > 1), ''),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('players',
               (select jsonb_agg(jsonb_build_object('id', o.player_id, 'name', o.name, 'role', o.role) order by o.rn)
                  from fans o
                 where o.sub = f.sub)),
             'high', v_expires
        from fans f
       where f.rn = 1
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      n := n + v_n;
    exception when others then
      if p_game is not null then
        raise;
      end if;
      raise warning 'notify_lineups: game % skipped (%: %)', g.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- 6. set_fan_prefs (latest: 0133) gains time_zone. Missing or blank keeps the row's
--    existing value, exactly like every other key here; a real string is validated.
-- ----------------------------------------------------------------------------
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
-- 7. notify_device_follow (latest: 0127) gains p_tz, trailing so every existing positional
--    or named call keeps working unchanged. null (the default) leaves the device's zone as
--    it was — a follow that only adds or removes a club must not reset it.
-- ----------------------------------------------------------------------------
create or replace function public.notify_device_follow(p_league text, p_endpoint text, p_p256dh text, p_auth text,
                                                       p_add jsonb default '{}'::jsonb, p_remove jsonb default '{}'::jsonb,
                                                       p_prefs jsonb default '{}'::jsonb, p_tz text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_league   uuid;
  v_lname    text;
  v_origin   text := public.notify_request_origin();
  d          push_devices%rowtype;
  a_teams    uuid[];
  a_players  uuid[];
  a_games    uuid[];
  r_teams    uuid[];
  r_players  uuid[];
  r_games    uuid[];
  k          text;
begin
  perform public.notify_device_throttle();

  select l.id, l.name into v_league, v_lname from leagues l where l.slug = lower(btrim(coalesce(p_league, '')));
  if v_league is null then
    raise exception 'there is no league called %', coalesce(p_league, '(none)') using errcode = '22023';
  end if;
  if not public.notify_origin_allowed(v_league, v_origin) then
    raise exception 'this website is not set up for % notifications', v_lname using errcode = '42501',
      hint = 'The league adds its website in the Epinoia console, under Embeds: notification buttons.';
  end if;
  if not public.notify_endpoint_ok(p_endpoint)
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{20,200}={0,2}$'
     or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{8,100}={0,2}$' then
    raise exception 'not a push subscription from a browser Epinoia knows' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_add, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_remove, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_prefs, '{}'::jsonb)) <> 'object' then
    raise exception 'add, remove and prefs are objects' using errcode = '22023';
  end if;

  a_teams   := public.notify_uuid_list(p_add -> 'teams');
  a_players := public.notify_uuid_list(p_add -> 'players');
  a_games   := public.notify_uuid_list(p_add -> 'games');
  r_teams   := public.notify_uuid_list(p_remove -> 'teams');
  r_players := public.notify_uuid_list(p_remove -> 'players');
  r_games   := public.notify_uuid_list(p_remove -> 'games');

  if exists (select 1 from unnest(a_teams) x(id)
              where not exists (select 1 from teams t where t.id = x.id and t.league_id = v_league)) then
    raise exception 'that club is not in %', v_lname using errcode = '22023';
  end if;
  if exists (select 1 from unnest(a_players) x(id)
              where not exists (select 1 from roster_entries re join teams t on t.id = re.team_id
                                 where re.player_id = x.id and t.league_id = v_league)) then
    raise exception 'that player is not in %', v_lname using errcode = '22023';
  end if;
  if exists (select 1 from unnest(a_players) x(id) join players p on p.id = x.id
              where public.player_withheld(p.is_minor, p.public_consent)) then
    raise exception 'notifications about that player are not public' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(a_games) x(id)
              where not exists (select 1 from games g join competitions cp on cp.id = g.competition_id
                                  join seasons s on s.id = cp.season_id
                                 where g.id = x.id and s.league_id = v_league)) then
    raise exception 'that game is not in %', v_lname using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(coalesce(p_prefs, '{}'::jsonb)) loop
    if k not in ('want_fixture_2d', 'want_fixture_2h', 'want_lineups', 'want_halftime', 'want_results', 'want_players', 'want_announcements')
       or jsonb_typeof(p_prefs -> k) <> 'boolean' then
      raise exception 'unknown switch %', k using errcode = '22023';
    end if;
  end loop;

  select * into d from push_devices x where x.endpoint = p_endpoint for update;
  if found then
    if d.auth <> p_auth then
      raise exception 'this browser''s notifications are held under another key' using errcode = '42501';
    end if;
  else
    if cardinality(a_teams) + cardinality(a_players) + cardinality(a_games) = 0 then
      return jsonb_build_object('device', false);
    end if;
    insert into push_devices (endpoint, p256dh, auth, origin, time_zone)
    values (p_endpoint, p_p256dh, p_auth, coalesce(nullif(v_origin, ''), 'unknown'), public.notify_valid_tz(p_tz))
    returning * into d;
  end if;

  update push_devices x set
    p256dh             = p_p256dh,
    fav_team_ids       = array(select distinct y from unnest(x.fav_team_ids || a_teams) y where not (y = any (r_teams))),
    fav_player_ids     = array(select distinct y from unnest(x.fav_player_ids || a_players) y where not (y = any (r_players))),
    fav_game_ids       = array(select distinct y from unnest(x.fav_game_ids || a_games) y where not (y = any (r_games))),
    want_fixture_2d    = coalesce((p_prefs ->> 'want_fixture_2d')::boolean, x.want_fixture_2d),
    want_fixture_2h    = coalesce((p_prefs ->> 'want_fixture_2h')::boolean, x.want_fixture_2h),
    want_lineups       = coalesce((p_prefs ->> 'want_lineups')::boolean, x.want_lineups),
    want_halftime      = coalesce((p_prefs ->> 'want_halftime')::boolean, x.want_halftime),
    want_results       = coalesce((p_prefs ->> 'want_results')::boolean, x.want_results),
    want_players       = coalesce((p_prefs ->> 'want_players')::boolean, x.want_players),
    want_announcements = coalesce((p_prefs ->> 'want_announcements')::boolean, x.want_announcements),
    time_zone          = case when p_tz is not null then public.notify_valid_tz(p_tz) else x.time_zone end,
    updated_at         = now()
   where x.id = d.id
  returning * into d;

  if cardinality(d.fav_team_ids) > 50 or cardinality(d.fav_player_ids) > 100 or cardinality(d.fav_game_ids) > 50 then
    raise exception 'a browser can follow at most 50 clubs, 100 players and 50 games' using errcode = '22023';
  end if;
  if cardinality(d.fav_team_ids) + cardinality(d.fav_player_ids) + cardinality(d.fav_game_ids) = 0 then
    delete from push_devices x where x.id = d.id;
    return jsonb_build_object('device', false);
  end if;
  return public.notify_device_state(d.id);
end $$;

alter function public.notify_valid_tz(text) owner to postgres;
alter function public.notif_when(timestamptz, text) owner to postgres;
alter function public.notify_fixture_windows() owner to postgres;
alter function public.notify_lineups(uuid) owner to postgres;
alter function public.notify_device_follow(text, text, text, text, jsonb, jsonb, jsonb, text) owner to postgres;

-- ============================================================================
-- SELF-TEST — rolled back (0143's P0-per-migration pattern).
--
-- One league, two clubs (Reading Rockets home, London Lions away), one player (Ben Baker,
-- starting), one game tipping off within the 2-day reminder window. London and Tokyo are
-- 8 or 9 hours apart depending on the date, so the same instant's HH24:MI can never print
-- the same string in both -- no need to chase a particular calendar day to prove the two
-- differ. One account with no time_zone set (keeps the 'Europe/London' default) follows
-- the club; one device that registered with time_zone 'Asia/Tokyo' follows the same club; a
-- second device follows only the player. It proves: the account's reminder still reads
-- London's hour, the Tokyo device's reads Tokyo's, the '2d' window's notif_when carries
-- each one's own hour, the player-only lineups notice picks up the follower's own device
-- zone, an invalid zone offered to notify_device_follow or set_fan_prefs is swallowed
-- rather than breaking the write, and a device that never sent a zone keeps the London
-- default.
-- ============================================================================
do $test$
declare
  who      text := current_user || ' (session ' || session_user || ')';
  orig     text := current_user;
  half     text := 'a fresh test account';
  u        uuid := gen_random_uuid();
  lg uuid; se uuid; cp uuid;
  t_h uuid; t_a uuid;
  pl_baker uuid;
  g_fix uuid; g_lu uuid;
  t_tip    timestamptz := date_trunc('hour', now()) + interval '46 hours' + interval '30 minutes';
  t_lutip  timestamptz := now() + interval '3 hours';
  e_dj text := 'https://fcm.googleapis.com/fcm/send/t145-dj';
  e_dp text := 'https://fcm.googleapis.com/fcm/send/t145-dp';
  k_p  text := 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
  k_a  text := 'tBHItJI5svbpez7KI4CCXg';
  d_dj uuid;
  v_j      jsonb;
  v_body_u text;
  v_body_j text;
  v_exp_u  text;
  v_exp_j  text;
  v_lu_body text;
begin
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '{}', true);
    set local role postgres;

    insert into leagues (slug, name, country, access_mode) values ('zz-t145-open', 'ZZ T144 League', 'GB', 'open') returning id into lg;
    insert into seasons (league_id, name, starts_on) values (lg, '2026-27', current_date) returning id into se;
    insert into competitions (league_id, season_id, name, kind) values (lg, se, 'League', 'league') returning id into cp;
    insert into teams (league_id, slug, name, short_name) values (lg, 'zz-t145-home', 'Reading Rockets', 'RR') returning id into t_h;
    insert into teams (league_id, slug, name, short_name) values (lg, 'zz-t145-away', 'London Lions', 'LON') returning id into t_a;
    insert into players (slug, first_name, last_name) values ('zz-t145-baker', 'Ben', 'Baker') returning id into pl_baker;
    insert into roster_entries (team_id, player_id, season_id, jersey, active) values (t_h, pl_baker, se, '4', true);

    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp, t_h, t_a, t_tip, 'scheduled') returning id into g_fix;
    -- notif_starters_complete wants both fives named; only Ben Baker needs to be a real
    -- player row, the rest exist only to make the array five long
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, starters)
      values (cp, t_h, t_a, t_lutip, 'scheduled',
              jsonb_build_array(
                jsonb_build_array(pl_baker, gen_random_uuid()::text, gen_random_uuid()::text,
                                   gen_random_uuid()::text, gen_random_uuid()::text),
                jsonb_build_array(gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                                   gen_random_uuid()::text, gen_random_uuid()::text)))
      returning id into g_lu;

    -- the account: default zone, never set
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't145-u@example.invalid', '', now(), now(), now());
    exception when insufficient_privilege then
      select p.id into u from public.profiles p
       where not exists (select 1 from public.memberships m where m.user_id = p.id)
         and not exists (select 1 from public.league_writers lw where lw.user_id = p.id)
         and not exists (select 1 from public.game_officials go where go.user_id = p.id)
         and not exists (select 1 from public.access_subscriptions a where a.user_id = p.id)
       order by p.created_at limit 1;
      if u is null then raise exception '0145: no account to test with'; end if;
      half := 'a borrowed profile';
    end;
    insert into fan_prefs as fp (user_id, fav_team_ids, want_fixtures, want_fixture_2d, want_fixture_2h, notify_inapp)
    values (u, array[t_h], true, true, true, true)
    on conflict (user_id) do update
      set fav_team_ids = excluded.fav_team_ids, want_fixtures = true, want_fixture_2d = true, want_fixture_2h = true,
          time_zone = 'Europe/London';

    -- a Tokyo device following the same club, and a second following only the player. Its
    -- own x-forwarded-for (0127's own test-net address plus 1) so this self-test's calls
    -- never share notify_device_throttle's ten-minute bucket with another migration's.
    perform set_config('request.headers',
      json_build_object('origin', 'https://prophesyscouting.co.uk', 'x-forwarded-for', '203.0.113.8')::text, true);
    set local role anon;
    v_j := public.notify_device_follow('zz-t145-open', e_dj, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)),
                                        '{}'::jsonb, '{}'::jsonb, 'Asia/Tokyo');
    -- its own third zone, distinct from London and from d_dj's Tokyo, so the assertion below
    -- cannot pass by accident of the player-only path happening to keep the default
    perform public.notify_device_follow('zz-t145-open', e_dp, k_p, k_a, jsonb_build_object('players', jsonb_build_array(pl_baker)),
                                        '{}'::jsonb, '{}'::jsonb, 'America/New_York');
    set local role postgres;
    select id into d_dj from push_devices where endpoint = e_dj;
    if (select time_zone from push_devices where id = d_dj) <> 'Asia/Tokyo' then
      raise exception '0145: notify_device_follow did not save a valid zone';
    end if;

    -- an invalid zone is swallowed, not stored, on both writers
    set local role anon;
    perform public.notify_device_follow('zz-t145-open', e_dj, k_p, k_a, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'Not/AZone');
    set local role postgres;
    if (select time_zone from push_devices where id = d_dj) <> 'Europe/London' then
      raise exception '0145: an invalid zone from notify_device_follow was not swallowed to the default';
    end if;
    -- put Tokyo back for the rest of the test
    update push_devices set time_zone = 'Asia/Tokyo' where id = d_dj;

    -- notif_when prints different text for different zones
    if public.notif_when(t_tip, 'Europe/London') = public.notif_when(t_tip, 'Asia/Tokyo') then
      raise exception '0145: notif_when gave the same text for London and Tokyo';
    end if;

    perform public.notify_fixture_windows();
    select body into v_body_u from notifications where user_id = u and ref = g_fix::text || ':2d';
    select body into v_body_j from notifications where device_id = d_dj and ref = g_fix::text || ':2d';
    v_exp_u := to_char(t_tip at time zone 'Europe/London', 'HH24:MI');
    v_exp_j := to_char(t_tip at time zone 'Asia/Tokyo', 'HH24:MI');
    if v_body_u is null or v_body_j is null then
      raise exception '0145: the 2-day reminder did not reach the account or the Tokyo device';
    end if;
    if v_body_u = v_body_j then
      raise exception '0145: the account and the Tokyo device read the same reminder text — % vs %', v_body_u, v_body_j;
    end if;
    if position(v_exp_j in v_body_j) = 0 then
      raise exception '0145: the Tokyo device''s reminder did not carry Tokyo''s calendar day/time (%, wanted %)', v_body_j, v_exp_j;
    end if;

    perform public.notify_lineups(g_lu);
    select body into v_lu_body from notifications where device_id is not null
      and ref = g_lu::text || ':lineups' and title like 'Ben Baker%';
    if v_lu_body is null or position(to_char(t_lutip at time zone 'America/New_York', 'HH24:MI') in v_lu_body) = 0 then
      raise exception '0145: the player-only lineups notice did not carry its follower''s own zone (%)', v_lu_body;
    end if;

    -- set_fan_prefs: a blank string leaves the zone alone, a real one is saved, a bad one falls back
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.set_fan_prefs(jsonb_build_object('time_zone', ''));
    set local role postgres;
    if (select time_zone from fan_prefs where user_id = u) <> 'Europe/London' then
      raise exception '0145: an empty time_zone in set_fan_prefs changed the row';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.set_fan_prefs(jsonb_build_object('time_zone', 'Asia/Tokyo'));
    set local role postgres;
    if (select time_zone from fan_prefs where user_id = u) <> 'Asia/Tokyo' then
      raise exception '0145: set_fan_prefs did not save a valid time_zone';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.set_fan_prefs(jsonb_build_object('time_zone', 'Not/AZone'));
    set local role postgres;
    if (select time_zone from fan_prefs where user_id = u) <> 'Europe/London' then
      raise exception '0145: an invalid time_zone from set_fan_prefs was not swallowed to the default';
    end if;

    raise exception using errcode = 'P0145', message = '0145 passed; rolling its test rows back';
  exception
    when sqlstate 'P0145' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug like 'zz-t145-%') or exists (select 1 from push_devices where endpoint like '%t145-%') then
    raise exception '0145: the test rows outlived their rollback';
  end if;
  raise notice '0145 ok: a tip-off is read in each subscriber''s own zone (account and device alike), an unset row keeps London, an invalid zone from either writer is swallowed to the default, and the player-only lineups notice carries its own follower''s zone. Ran with %', half;
end $test$;
