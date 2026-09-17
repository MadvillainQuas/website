-- ============================================================================
-- 0127 — NOTIFICATION BUTTONS ON A LEAGUE'S OWN WEBSITE.
--
-- The contract is docs/notify-embed.md (§4 and §5 are this file). A league that
-- runs its own website on top of Epinoia puts a button on a club page, a player
-- page or a match page, and a visitor who taps it gets Epinoia's notifications for
-- exactly that, with no Epinoia account. The browser's push subscription is the
-- subscriber: a DEVICE.
--
--   push_devices       one row per browser subscription: what it follows, its switches
--   notify_embeds      per league: the sites that may save devices from their own
--                      domain, and where a tap on a notification opens
--   notify_audience    accounts (fan_prefs) and devices (push_devices) as one set of
--                      rows; every fan-out now writes from it
--   notifications      user_id becomes nullable and gains device_id: exactly one set
--   notify_device_get / _follow / _forget / _test, notify_embed_public
--                      callable signed out; the subscription's auth secret, which only
--                      the browser holding it knows, is the credential
--   set_notify_embed, notify_embed_stats
--                      the console's, for the league's admins
--
-- WHY ONE AUDIENCE AND NOT A SECOND SET OF FAN-OUTS. Five functions decide who is told
-- what (notify_fixture_windows, notify_lineups, notify_halftime, notify_game_final,
-- post_announcement), each with the rules that took three migrations to get right: one
-- notice per subscriber per game per moment, a club follower's notice winning over a
-- player follower's, minors never named, members-only leagues. A copy for devices
-- would drift from the original the first time either changed. So each statement now
-- reads notify_audience instead of fan_prefs, carries device_id beside user_id, and
-- asks can_view_league_for only of an account — a device has no membership, so a
-- members-only league tells it nothing while memberships are switched on, beyond the
-- fixtures it publishes. Everything else in the five functions is character for
-- character their latest definition (0121, 0124, 0106), and the self-test runs every
-- moment for an account and for devices side by side.
--
-- A DEVICE'S SWITCHES are the account's per-moment ones (2 days, 2 hours, lineups,
-- half-time, result, player lines, announcements). A device has no master switch for
-- fixtures and no separate one for a player's games: it followed that player to hear
-- about their games.
--
-- WHO MAY SAVE A DEVICE. The request's Origin header (PostgREST passes it as
-- request.headers) must be Epinoia's own — the window every button can open — or one
-- of the league's sites. A browser cannot lie about its Origin, so another website
-- cannot sign its visitors up under this league; a program can, and gains nothing a
-- visitor to Epinoia's window could not do. At most 60 changes in ten minutes come
-- from one network address (hashed; PT429 is HTTP 429 through PostgREST), and a device
-- follows at most 50 clubs, 100 players and 50 games.
--
-- WHAT IS KEPT. A device stores a push address, its keys and what it follows: no name,
-- no email. A device that unfollows its last thing is deleted, so is one whose push
-- service says it is gone (the notify function), and a device's notification rows go
-- after seven days (the tick).
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.push_devices (
  id                 uuid primary key default gen_random_uuid(),
  endpoint           text not null unique,
  p256dh             text not null,
  auth               text not null,
  origin             text not null,
  fav_team_ids       uuid[] not null default '{}',
  fav_player_ids     uuid[] not null default '{}',
  fav_game_ids       uuid[] not null default '{}',
  want_fixture_2d    boolean not null default true,
  want_fixture_2h    boolean not null default true,
  want_lineups       boolean not null default true,
  want_halftime      boolean not null default true,
  want_results       boolean not null default true,
  want_players       boolean not null default true,
  want_announcements boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_push_at       timestamptz,
  last_push_status   int,
  last_push_error    text,
  constraint push_devices_https check (endpoint ~ '^https://'),
  constraint push_devices_caps check (cardinality(fav_team_ids) <= 50 and cardinality(fav_player_ids) <= 100
                                      and cardinality(fav_game_ids) <= 50)
);
alter table public.push_devices enable row level security;
revoke all on table public.push_devices from public, anon, authenticated;
alter table public.push_devices owner to postgres;

create table if not exists public.notify_embeds (
  league_id  uuid primary key references public.leagues on delete cascade,
  sites      text[] not null default '{}',
  game_url   text,
  home_url   text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null,
  constraint notify_embeds_sites check (cardinality(sites) <= 20),
  constraint notify_embeds_game_url check (game_url is null
    or (game_url ~ '^https://[^\s]+$' and (strpos(game_url, '{game}') > 0 or strpos(game_url, '{external}') > 0))),
  constraint notify_embeds_home_url check (home_url is null or home_url ~ '^https://[^\s]+$')
);
alter table public.notify_embeds enable row level security;
revoke all on table public.notify_embeds from public, anon, authenticated;
grant select on table public.notify_embeds to authenticated;
drop policy if exists notify_embeds_admin_read on public.notify_embeds;
create policy notify_embeds_admin_read on public.notify_embeds for select to authenticated
  using (public.is_league_admin(league_id) or public.is_platform_admin());
alter table public.notify_embeds owner to postgres;

-- the throttle: one row per hashed address per ten-minute window
create table if not exists public.notify_device_calls (
  ip           text not null,
  window_start timestamptz not null,
  calls        int not null default 0,
  primary key (ip, window_start)
);
alter table public.notify_device_calls enable row level security;
revoke all on table public.notify_device_calls from public, anon, authenticated;
alter table public.notify_device_calls owner to postgres;

alter table public.notifications alter column user_id drop not null;
alter table public.notifications
  add column if not exists device_id uuid references public.push_devices on delete cascade;
alter table public.notifications
  drop constraint if exists notifications_one_audience,
  add constraint notifications_one_audience check (num_nonnulls(user_id, device_id) = 1);
alter table public.notifications
  drop constraint if exists notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy', 'test'));
create unique index if not exists notifications_device_ref on public.notifications (device_id, kind, ref) where device_id is not null;
create index if not exists notifications_device_created on public.notifications (created_at) where device_id is not null;

-- ----------------------------------------------------------------------------
-- 2. ONE AUDIENCE
-- ----------------------------------------------------------------------------
create or replace view public.notify_audience as
  select p.user_id, null::uuid as device_id, p.user_id as sub,
         p.fav_team_ids, p.fav_player_ids, p.fav_game_ids,
         p.want_results, p.want_players, p.want_fixtures, p.want_announcements,
         p.want_fixture_2d, p.want_fixture_2h, p.want_lineups, p.want_player_games, p.want_halftime
    from public.fan_prefs p
  union all
  select null::uuid, d.id, d.id,
         d.fav_team_ids, d.fav_player_ids, d.fav_game_ids,
         d.want_results, d.want_players, true, d.want_announcements,
         d.want_fixture_2d, d.want_fixture_2h, d.want_lineups, true, d.want_halftime
    from public.push_devices d;
revoke all on table public.notify_audience from public, anon, authenticated;
alter view public.notify_audience owner to postgres;

-- ----------------------------------------------------------------------------
-- 3. THE FIVE FAN-OUTS, READING THE AUDIENCE (see the header)
-- ----------------------------------------------------------------------------

-- notify_fixture_windows (latest: 0121)
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
  v_tip         text;
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
    v_tip     := to_char(w.tipoff_at at time zone 'Europe/London', 'HH24:MI');
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
           case when w.win = '2d' then 'In 2 days · ' || public.notif_when(w.tipoff_at)
                else v_until || ' · tip-off ' || v_tip end
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
      select p.sub, p.user_id, p.device_id, pl.id as player_id, btrim(pl.first_name || ' ' || pl.last_name) as name,
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
             || case when w.win = '2d' then public.notif_when(w.tipoff_at) else 'tip-off ' || v_tip end,
           v_link, w.league_id, w.id, v_ref,
           v_data || jsonb_build_object('players',
             jsonb_agg(jsonb_build_object('id', f.player_id, 'name', f.name)
                       order by f.last_name, f.first_name, f.player_id)),
           v_urgency, v_expires
      from fans f
     group by f.sub, f.user_id, f.device_id
    on conflict do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- notify_lineups (latest: 0121)
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
  v_tip          text;
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
      v_tip     := to_char(g.tipoff_at at time zone 'Europe/London', 'HH24:MI');
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
        select p.sub, p.user_id, p.device_id, sq.player_id, sq.name, sq.role, sq.side,
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
             g.home_name || ' v ' || g.away_name || ' · tip-off ' || v_tip
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

-- notify_halftime (latest: 0124)
create or replace function public.notify_halftime(p_game uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  n              int := 0;
  c              int;
  v_n            int;
  v_memberships  boolean := public.memberships_enabled();
  v_members_only boolean;
  v_score        text;
  v_link         text;
  v_ref          text;
  v_expires      timestamptz := now() + interval '20 minutes';
  v_lines        jsonb;
  v_leaders      jsonb;
  v_top          text;
  v_data         jsonb;
begin
  for g in
    select gm.id, gm.home_team_id, gm.away_team_id, gm.tipoff_at,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           coalesce(gs.score_home, 0) as score_home,
           coalesce(gs.score_away, 0) as score_away,
           nullif(btrim(cp.name), '') as comp,
           s.league_id,
           l.access_mode
      from games gm
      join game_state gs   on gs.game_id = gm.id
      join teams h         on h.id = gm.home_team_id
      join teams a         on a.id = gm.away_team_id
      join competitions cp on cp.id = gm.competition_id
      join seasons s       on s.id = cp.season_id
      join leagues l       on l.id = s.league_id
     where (p_game is null or gm.id = p_game)
       and gm.status = 'live'
       and coalesce(l.public_live, false)
       and not gs.running
       and gs.updated_at >= now() - interval '30 minutes'
       and ((gs.period = 2 and (gs.clock_ms <= 0 or gs.clock_ms >= 600000))
            or (gs.period = 3 and gs.clock_ms >= 600000))
       -- the second quarter was played, the third was not
       and exists (select 1 from game_events e
                    where e.game_id = gm.id and e.period = 2 and e.clock < 600000 and e.t <> 'period_start')
       and not exists (select 1 from game_events e
                        where e.game_id = gm.id and e.period >= 3 and coalesce(e.clock, 600000) < 600000
                          and e.t <> 'period_start')
       -- quiet for a minute: free throws at the buzzer are in
       and not exists (select 1 from game_events e
                        where e.game_id = gm.id
                          and e.t in ('ft_made', 'ft_miss', 'p2_made', 'p2_miss', 'p3_made', 'p3_miss',
                                      'reb', 'ast', 'stl', 'blk', 'to', 'foul', 'sub')
                          and e.created_at > now() - interval '1 minute')
     order by gm.tipoff_at, gm.id
  loop
    begin
      v_members_only := coalesce(g.access_mode = 'members', false) and v_memberships;   -- 0118
      v_score := g.home_name || ' ' || g.score_home || '–' || g.score_away || ' ' || g.away_name;
      v_link  := 'game/?g=' || g.id || '&mode=supabase';
      v_ref   := g.id::text || ':ht';

      -- every named player who has played, most points first
      select coalesce(jsonb_agg(jsonb_build_object(
                        'id', x.id, 'name', x.name, 'surname', x.surname, 'side', x.side, 'stats', x.stats)
                      order by public.notif_num(x.stats, 'pts') desc, x.name, x.id), '[]'::jsonb)
        into v_lines
        from (select pl.id, fh.team_idx as side, fh.stats,
                     btrim(pl.first_name || ' ' || pl.last_name) as name,
                     coalesce(nullif(btrim(pl.last_name), ''), nullif(btrim(pl.first_name), ''),
                              btrim(pl.first_name || ' ' || pl.last_name)) as surname
                from public.notif_first_half(g.id) fh
                join players pl
                  on pl.id = case when fh.player_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                  then fh.player_id::uuid end
               where fh.played
                 and not coalesce(public.player_withheld(pl.is_minor, pl.public_consent), false)
                 and nullif(btrim(pl.first_name || ' ' || pl.last_name), '') is not null) x;

      -- each side's top scorer, home first
      select coalesce(jsonb_agg(jsonb_build_object(
                        'id', t.v -> 'id', 'name', t.v -> 'name', 'side', t.side,
                        'pts', public.notif_num(t.v -> 'stats', 'pts')) order by t.side), '[]'::jsonb),
             case count(*)
               when 0 then null
               when 1 then 'Top scorer: '
               else 'Top scorers: ' end
             || string_agg((t.v ->> 'surname') || ' ' || round(public.notif_num(t.v -> 'stats', 'pts'))::int, ', ' order by t.side)
        into v_leaders, v_top
        from (select distinct on ((l.v ->> 'side')::int) (l.v ->> 'side')::int as side, l.v
                from jsonb_array_elements(v_lines) with ordinality l(v, ord)
               where l.v ->> 'side' in ('0', '1')
                 and public.notif_num(l.v -> 'stats', 'pts') > 0
               order by (l.v ->> 'side')::int, l.ord) t;

      v_data := jsonb_build_object(
                  'game', g.id,
                  'home', jsonb_build_object('id', g.home_team_id, 'name', g.home_name),
                  'away', jsonb_build_object('id', g.away_team_id, 'name', g.away_name),
                  'tipoff', g.tipoff_at,
                  'period', 2,
                  'score', jsonb_build_array(g.score_home, g.score_away),
                  'leaders', v_leaders);
      v_n := 0;

      -- the club and game followers: the score, their players' lines, the top scorers
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, p.device_id, 'halftime', 'HT · ' || v_score,
             coalesce(nullif(concat_ws(chr(10), mine.lines, v_top), ''), g.comp, 'Half-time'),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('audience', 'club', 'players', coalesce(mine.players, '[]'::jsonb)),
             'high', v_expires
        from notify_audience p
        cross join lateral (
          select string_agg((l.v ->> 'name') || ': ' || public.notif_statline(l.v -> 'stats'), chr(10) order by l.ord) as lines,
                 jsonb_agg(jsonb_build_object('id', l.v -> 'id', 'name', l.v -> 'name',
                                              'statline', public.notif_statline_data(l.v -> 'stats')) order by l.ord) as players
            from jsonb_array_elements(v_lines) with ordinality l(v, ord)
           where p.want_players and (l.v ->> 'id')::uuid = any (p.fav_player_ids)) mine
       where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
              or g.id = any (p.fav_game_ids))
         and p.want_halftime
         and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      -- everyone else who follows a player who has played: that player's line first
      with fans as (
        select p.sub, p.user_id, p.device_id, l.v,
               row_number() over (partition by p.sub order by l.ord) as rn
          from notify_audience p
          join lateral jsonb_array_elements(v_lines) with ordinality l(v, ord)
            on (l.v ->> 'id')::uuid = any (p.fav_player_ids)
         where p.want_players and p.want_halftime
           and not ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
                    or g.id = any (p.fav_game_ids))
           and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      )
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select f.user_id, f.device_id, 'halftime',
             (f.v ->> 'name') || ' at half-time: ' || public.notif_statline(f.v -> 'stats'),
             v_score || ' · HT' || coalesce(' · ' || nullif(public.notif_statline_more(f.v -> 'stats'), ''), '')
               || coalesce((select string_agg(chr(10) || (o.v ->> 'name') || ': ' || public.notif_statline(o.v -> 'stats'), '' order by o.rn)
                              from fans o
                             where o.sub = f.sub and o.rn > 1), ''),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('audience', 'player', 'players',
               (select jsonb_agg(jsonb_build_object('id', o.v -> 'id', 'name', o.v -> 'name',
                                                    'statline', public.notif_statline_data(o.v -> 'stats')) order by o.rn)
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
      raise warning 'notify_halftime: game % skipped (%: %)', g.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- notify_game_final (latest: 0121)
create or replace function public.notify_game_final(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  h              record;
  w              record;
  lg             uuid;
  n              int := 0;
  c              int;
  comp           text;
  v_members_only boolean;
  v_score        text;
  v_link         text;
  v_data         jsonb;
  v_expires      timestamptz := now() + interval '24 hours';
begin
  select * into g from games where id = p_game;
  if not found or g.status not in ('final', 'finalising') then return 0; end if;
  select * into h from teams where id = g.home_team_id;
  select * into w from teams where id = g.away_team_id;
  lg := game_league(p_game);
  select l.access_mode = 'members' into v_members_only from leagues l where l.id = lg;
  v_members_only := coalesce(v_members_only, false) and public.memberships_enabled();
  select name into comp from competitions where id = g.competition_id;
  v_score := coalesce(h.name, 'Home') || ' ' || coalesce(g.home_score, 0) || '–' || coalesce(g.away_score, 0)
             || ' ' || coalesce(w.name, 'Away');
  v_link  := 'game/?g=' || g.id || '&mode=supabase';
  v_data  := jsonb_build_object(
               'game', g.id,
               'home', jsonb_build_object('id', g.home_team_id, 'name', h.name),
               'away', jsonb_build_object('id', g.away_team_id, 'name', w.name),
               'tipoff', g.tipoff_at,
               'score', jsonb_build_array(coalesce(g.home_score, 0), coalesce(g.away_score, 0)));

  insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, p.device_id, 'result', 'FT · ' || v_score, coalesce(comp, 'Final score'), v_link, lg, g.id, g.id::text,
         v_data, 'high', v_expires
    from notify_audience p
   where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
          or g.id = any (p.fav_game_ids))
     and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, lg)))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, p.device_id, 'player',
         btrim(pl.first_name || ' ' || pl.last_name) || ': ' || public.notif_statline(s.stats),
         v_score || ' · FT' || coalesce(' · ' || nullif(public.notif_statline_more(s.stats), ''), ''),
         v_link || '&vp=' || pl.id, lg, g.id, g.id::text || ':' || pl.id,
         v_data || jsonb_build_object(
           'players', jsonb_build_array(jsonb_build_object('id', pl.id, 'name', btrim(pl.first_name || ' ' || pl.last_name))),
           'statline', jsonb_build_object(
             'pts', public.notif_num(s.stats, 'pts'),
             'reb', public.notif_num(s.stats, 'or') + public.notif_num(s.stats, 'dr'),
             'ast', public.notif_num(s.stats, 'ast'),
             'stl', public.notif_num(s.stats, 'stl'),
             'blk', public.notif_num(s.stats, 'blk'),
             'fgm', public.notif_num(s.stats, 'p2m') + public.notif_num(s.stats, 'p3m'),
             'fga', public.notif_num(s.stats, 'p2a') + public.notif_num(s.stats, 'p3a'),
             'min', round(public.notif_num(s.stats, 'min') / 60000))),
         'high', v_expires
    from notify_audience p
    join players pl on pl.id = any (p.fav_player_ids)
                   and not public.player_withheld(pl.is_minor, pl.public_consent)
    join player_game_stats s on s.game_id = g.id and s.player_id = pl.id::text
   where p.want_players
     and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, lg)))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- post_announcement (latest: 0106): the fans' half reads the audience
create or replace function public.post_announcement(p_league uuid, p_title text, p_body text, p_audience text, p_team uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a_id uuid; lname text;
begin
  if not (public.is_league_admin(p_league) or public.is_platform_admin()) then
    raise exception 'not your league' using errcode = '42501';
  end if;
  if p_audience not in ('fans', 'club_admins', 'all') then
    raise exception 'audience is fans, club_admins or all' using errcode = '22023';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'a title is needed' using errcode = '22023'; end if;
  select name into lname from leagues where id = p_league;
  insert into announcements (league_id, team_id, title, body, audience, created_by)
  values (p_league, p_team, trim(p_title), coalesce(p_body, ''), p_audience, auth.uid())
  returning id into a_id;

  if p_audience in ('fans', 'all') and p_team is null then
    insert into notifications (user_id, device_id, kind, title, body, link, league_id, ref)
    select distinct p.user_id, p.device_id, 'announcement', trim(p_title), left(coalesce(p_body, ''), 400),
           '?l=' || (select slug from leagues where id = p_league), p_league, a_id::text
      from notify_audience p
     where p.want_announcements
       and exists (select 1 from teams t where t.league_id = p_league and t.id = any(p.fav_team_ids))
    on conflict do nothing;
  end if;
  if p_audience in ('club_admins', 'all') then
    insert into notifications (user_id, kind, title, body, link, league_id, ref)
    select distinct m.user_id, 'message', 'From ' || coalesce(lname, 'the league') || ': ' || trim(p_title),
           left(coalesce(p_body, ''), 400), 'app/', p_league, a_id::text
      from memberships m
      join teams t on t.id = m.scope_id and t.league_id = p_league
     where m.role = 'team_manager' and m.scope_type = 'team'
       and (p_team is null or t.id = p_team)
    on conflict do nothing;
  end if;
  return a_id;
end $$;

-- ----------------------------------------------------------------------------
-- 4. THE BUTTON'S FUNCTIONS (signed out)
-- ----------------------------------------------------------------------------

-- the site asking: PostgREST's request headers, lower-cased, no trailing slash
create or replace function public.notify_request_origin()
returns text language sql stable set search_path = public as $$
  select coalesce(rtrim(lower(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'origin')), '/'), '');
$$;

create or replace function public.notify_origin_allowed(p_league uuid, p_origin text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_origin, '') in ('https://prophesyscouting.co.uk', 'https://www.prophesyscouting.co.uk')
      or exists (select 1 from notify_embeds e where e.league_id = p_league and p_origin = any (e.sites));
$$;

-- a subscription from a push service a browser uses: Google, Apple, Mozilla, Microsoft
-- (the same hosts as supabase/functions/_shared/pushcheck.js serviceOf)
create or replace function public.notify_endpoint_ok(p_endpoint text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(char_length(p_endpoint) <= 2000
     and p_endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)/', false);
$$;

-- at most 60 changes in ten minutes from one network address
create or replace function public.notify_device_throttle()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip    text;
  v_win   timestamptz := date_trunc('hour', now()) + make_interval(mins => (extract(minute from now())::int / 10) * 10);
  v_calls int;
begin
  v_ip := coalesce(btrim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)), '');
  if v_ip = '' then
    v_ip := coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip', 'unknown');
  end if;
  v_ip := encode(extensions.digest(v_ip, 'sha256'), 'hex');
  insert into notify_device_calls (ip, window_start, calls) values (v_ip, v_win, 1)
  on conflict (ip, window_start) do update set calls = notify_device_calls.calls + 1
  returning calls into v_calls;
  if v_calls > 60 then
    raise exception 'too many notification changes from this network; try again in a few minutes' using errcode = 'PT429';
  end if;
  delete from notify_device_calls c where c.window_start < now() - interval '1 hour';
end $$;

-- uuids from a jsonb list; anything else is refused
create or replace function public.notify_uuid_list(p jsonb)
returns uuid[] language plpgsql immutable set search_path = public as $$
declare v uuid[] := '{}'; x jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then return v; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 100 then
    raise exception 'a list of ids is expected' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'a list of ids is expected' using errcode = '22023';
    end if;
    if not ((x #>> '{}')::uuid = any (v)) then v := v || (x #>> '{}')::uuid; end if;
  end loop;
  return v;
end $$;

-- what a device follows and its switches, named
create or replace function public.notify_device_state(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'device', true,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'league', l.slug) order by t.name)
                         from teams t left join leagues l on l.id = t.league_id
                        where t.id = any (d.fav_team_ids)), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', btrim(p.first_name || ' ' || p.last_name))
                                          order by p.last_name, p.first_name)
                           from players p
                          where p.id = any (d.fav_player_ids)
                            and not public.player_withheld(p.is_minor, p.public_consent)), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'home', h.name, 'away', a.name, 'tipoff', g.tipoff_at)
                                        order by g.tipoff_at, g.id)
                         from games g join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id
                        where g.id = any (d.fav_game_ids)), '[]'::jsonb),
    'prefs', jsonb_build_object(
      'want_fixture_2d', d.want_fixture_2d, 'want_fixture_2h', d.want_fixture_2h, 'want_lineups', d.want_lineups,
      'want_halftime', d.want_halftime, 'want_results', d.want_results, 'want_players', d.want_players,
      'want_announcements', d.want_announcements))
    from push_devices d
   where d.id = p_id;
$$;

create or replace function public.notify_device_get(p_endpoint text, p_auth text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  select d.id into v_id from push_devices d where d.endpoint = p_endpoint and d.auth = p_auth;
  if v_id is null then return null; end if;
  return public.notify_device_state(v_id);
end $$;

create or replace function public.notify_device_follow(p_league text, p_endpoint text, p_p256dh text, p_auth text,
                                                       p_add jsonb default '{}'::jsonb, p_remove jsonb default '{}'::jsonb,
                                                       p_prefs jsonb default '{}'::jsonb)
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
    insert into push_devices (endpoint, p256dh, auth, origin)
    values (p_endpoint, p_p256dh, p_auth, coalesce(nullif(v_origin, ''), 'unknown'))
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

create or replace function public.notify_device_forget(p_endpoint text, p_auth text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_device_throttle();
  delete from push_devices d where d.endpoint = p_endpoint and d.auth = p_auth;
  return found;
end $$;

-- one test notification, written like every other and delivered the same way
create or replace function public.notify_device_test(p_endpoint text, p_auth text, p_league text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  d       push_devices%rowtype;
  v_lg    uuid;
  v_lname text;
begin
  perform public.notify_device_throttle();
  select * into d from push_devices x where x.endpoint = p_endpoint and x.auth = p_auth;
  if not found then return false; end if;
  if exists (select 1 from notifications n where n.device_id = d.id and n.kind = 'test'
               and n.created_at > now() - interval '1 minute') then
    return false;
  end if;
  select l.id, l.name into v_lg, v_lname from leagues l where l.slug = lower(btrim(coalesce(p_league, '')));
  if v_lg is null then
    select t.league_id, l.name into v_lg, v_lname
      from teams t join leagues l on l.id = t.league_id
     where t.id = any (d.fav_team_ids)
     order by t.name limit 1;
  end if;
  insert into notifications (device_id, kind, title, body, league_id, ref, urgency, expires_at)
  values (d.id, 'test', 'Notifications are on',
          'This is how ' || coalesce(v_lname || ' notifications', 'notifications') || ' will arrive on this device.',
          v_lg, 'test:' || floor(extract(epoch from clock_timestamp()))::bigint, 'high', now() + interval '10 minutes');
  return true;
end $$;

-- the league a button names, and whether the site asking may save devices itself
create or replace function public.notify_embed_public(p_league text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l        record;
  v_origin text := public.notify_request_origin();
begin
  select x.id, x.slug, x.name, x.logo_path into l from leagues x where x.slug = lower(btrim(coalesce(p_league, '')));
  if not found then return null; end if;
  return jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'logo_path', l.logo_path),
    'origin', v_origin,
    'epinoia', v_origin in ('https://prophesyscouting.co.uk', 'https://www.prophesyscouting.co.uk'),
    'site', exists (select 1 from notify_embeds e where e.league_id = l.id and v_origin = any (e.sites)));
end $$;

-- ----------------------------------------------------------------------------
-- 5. THE CONSOLE'S FUNCTIONS (a league's admins)
-- ----------------------------------------------------------------------------
create or replace function public.set_notify_embed(p_league uuid, p_sites text[], p_game_url text, p_home_url text)
returns public.notify_embeds language plpgsql security definer set search_path = public as $$
declare
  v_sites text[];
  r       notify_embeds%rowtype;
  s       text;
begin
  if not (public.is_league_admin(p_league) or public.is_platform_admin()) then
    raise exception 'not your league' using errcode = '42501';
  end if;
  v_sites := '{}';
  foreach s in array coalesce(p_sites, '{}'::text[]) loop
    s := lower(btrim(s));
    continue when s = '';
    if s !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?(/.*)?$' then
      raise exception '"%" is not a website address starting https://', s using errcode = '22023';
    end if;
    s := substring(s from '^(https://[^/]+)');
    if not (s = any (v_sites)) then v_sites := v_sites || s; end if;
  end loop;
  if cardinality(v_sites) > 20 then
    raise exception 'at most 20 websites' using errcode = '22023';
  end if;
  if nullif(btrim(p_game_url), '') is not null and (btrim(p_game_url) !~ '^https://[^\s]+$'
     or (strpos(p_game_url, '{game}') = 0 and strpos(p_game_url, '{external}') = 0)) then
    raise exception 'the match page link starts https:// and contains {game} or {external}' using errcode = '22023';
  end if;
  if nullif(btrim(p_home_url), '') is not null and btrim(p_home_url) !~ '^https://[^\s]+$' then
    raise exception 'the home page link starts https://' using errcode = '22023';
  end if;
  insert into notify_embeds (league_id, sites, game_url, home_url, updated_at, updated_by)
  values (p_league, v_sites, nullif(btrim(p_game_url), ''), nullif(btrim(p_home_url), ''), now(), auth.uid())
  on conflict (league_id) do update
    set sites = excluded.sites, game_url = excluded.game_url, home_url = excluded.home_url,
        updated_at = now(), updated_by = auth.uid()
  returning * into r;
  return r;
end $$;

create or replace function public.notify_embed_stats(p_league uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_league_admin(p_league) or public.is_platform_admin()) then
    raise exception 'not your league' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'devices', count(*),
      'clubs', count(*) filter (where exists (select 1 from teams t where t.league_id = p_league and t.id = any (d.fav_team_ids))),
      'players', count(*) filter (where exists (select 1 from roster_entries re join teams t on t.id = re.team_id
                                                 where t.league_id = p_league and re.player_id = any (d.fav_player_ids))),
      'games', count(*) filter (where exists (select 1 from games g join competitions cp on cp.id = g.competition_id
                                                join seasons s on s.id = cp.season_id
                                               where s.league_id = p_league and g.id = any (d.fav_game_ids))))
      from push_devices d
     where exists (select 1 from teams t where t.league_id = p_league and t.id = any (d.fav_team_ids))
        or exists (select 1 from roster_entries re join teams t on t.id = re.team_id
                    where t.league_id = p_league and re.player_id = any (d.fav_player_ids))
        or exists (select 1 from games g join competitions cp on cp.id = g.competition_id
                     join seasons s on s.id = cp.season_id
                    where s.league_id = p_league and g.id = any (d.fav_game_ids)));
end $$;

-- ----------------------------------------------------------------------------
-- 6. A ROTATED SUBSCRIPTION (latest: 0121), for a device too; THE TICK (latest:
-- 0124), counting a device's waiting rows and clearing a week-old device's rows.
-- ----------------------------------------------------------------------------
create or replace function public.swap_push_subscription(p_old text, p_endpoint text, p_p256dh text, p_auth text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_dev uuid;
  v_any boolean := false;
begin
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or char_length(p_p256dh) > 400
     or coalesce(p_auth, '') = '' or char_length(p_auth) > 200 then
    raise exception 'a push subscription is an https endpoint and its two keys' using errcode = '22023';
  end if;
  if coalesce(p_old, '') = '' then
    return false;
  end if;

  -- an account's subscription (0121)
  select s.id into v_id from push_subscriptions s where s.endpoint = p_old for update;
  if found then
    v_any := true;
    if p_endpoint <> p_old and exists (select 1 from push_subscriptions s where s.endpoint = p_endpoint) then
      delete from push_subscriptions s where s.id = v_id;
    else
      begin
        update push_subscriptions s
           set endpoint = p_endpoint, p256dh = p_p256dh, auth = p_auth
         where s.id = v_id;
      exception when unique_violation then
        delete from push_subscriptions s where s.id = v_id;
      end;
    end if;
  end if;

  -- a device's (0127): the same, and it keeps what it follows
  select d.id into v_dev from push_devices d where d.endpoint = p_old for update;
  if found then
    v_any := true;
    if p_endpoint <> p_old and exists (select 1 from push_devices d where d.endpoint = p_endpoint) then
      delete from push_devices d where d.id = v_dev;
    else
      begin
        update push_devices d
           set endpoint = p_endpoint, p256dh = p_p256dh, auth = p_auth, updated_at = now()
         where d.id = v_dev;
      exception when unique_violation then
        delete from push_devices d where d.id = v_dev;
      end;
    end if;
  end if;
  return v_any;
end $$;

create or replace function public.notify_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fixtures int;
  v_lineups  int;
  v_halftime int;
  v_cleared  int := 0;
  v_waiting  int := 0;
  v_net      boolean;
  v_called   boolean := false;
  v_request  bigint;
  v_errors   jsonb := '[]'::jsonb;
  v_result   jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('epinoia.notify_tick', 0)) then
    return jsonb_build_object('skipped', 'another tick is running');
  end if;

  begin
    v_fixtures := public.notify_fixture_windows();
  exception when others then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'fixtures', 'sqlstate', sqlstate, 'message', sqlerrm));
  end;
  begin
    v_lineups := public.notify_lineups();
  exception when others then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'lineups', 'sqlstate', sqlstate, 'message', sqlerrm));
  end;
  begin
    v_halftime := public.notify_halftime();
  exception when others then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'halftime', 'sqlstate', sqlstate, 'message', sqlerrm));
  end;
  begin
    delete from notifications n where n.device_id is not null and n.created_at < now() - interval '7 days';
    get diagnostics v_cleared = row_count;
  exception when others then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'clear', 'sqlstate', sqlstate, 'message', sqlerrm));
  end;

  select count(*) into v_waiting
    from (select 1
            from notifications n
           where n.pushed_at is null
             and n.created_at >= now() - interval '3 days'
             and (n.expires_at is null or n.expires_at > now())
             and (n.device_id is not null
                  or exists (select 1 from fan_prefs p where p.user_id = n.user_id and p.notify_push))
           limit 1000) x;

  v_net := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
  if v_waiting > 0 and v_net then
    begin
      execute 'select net.http_post(url := $1, body := $2, params := $3, headers := $4, timeout_milliseconds := $5)'
         into v_request
        using 'https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/notify'::text,
              jsonb_build_object('source', 'tick'),
              '{}'::jsonb,
              jsonb_build_object('Content-Type', 'application/json',
                                 'apikey', 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO'),
              5000;
      v_called := true;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'call', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;

  v_result := jsonb_build_object('ran_at', now(), 'fixtures', v_fixtures, 'lineups', v_lineups, 'halftime', v_halftime,
                                 'cleared', v_cleared, 'waiting', v_waiting, 'net', v_net, 'called', v_called,
                                 'request_id', v_request, 'errors', v_errors);
  insert into notify_ticks (id, ran_at, called_at, request_id, result)
  values (1, now(), case when v_called then now() end, v_request, v_result)
  on conflict (id) do update
    set ran_at     = excluded.ran_at,
        called_at  = coalesce(excluded.called_at, notify_ticks.called_at),
        request_id = coalesce(excluded.request_id, notify_ticks.request_id),
        result     = excluded.result;
  return v_result;
end $$;

-- ----------------------------------------------------------------------------
-- 7. GRANTS AND OWNERSHIP
-- ----------------------------------------------------------------------------
revoke all on function public.notify_request_origin() from public, anon, authenticated;
revoke all on function public.notify_origin_allowed(uuid, text) from public, anon, authenticated;
revoke all on function public.notify_endpoint_ok(text) from public, anon, authenticated;
revoke all on function public.notify_device_throttle() from public, anon, authenticated;
revoke all on function public.notify_uuid_list(jsonb) from public, anon, authenticated;
revoke all on function public.notify_device_state(uuid) from public, anon, authenticated;
revoke all on function public.notify_device_get(text, text) from public;
revoke all on function public.notify_device_follow(text, text, text, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.notify_device_forget(text, text) from public;
revoke all on function public.notify_device_test(text, text, text) from public;
revoke all on function public.notify_embed_public(text) from public;
grant execute on function public.notify_device_get(text, text) to anon, authenticated, service_role;
grant execute on function public.notify_device_follow(text, text, text, text, jsonb, jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.notify_device_forget(text, text) to anon, authenticated, service_role;
grant execute on function public.notify_device_test(text, text, text) to anon, authenticated, service_role;
grant execute on function public.notify_embed_public(text) to anon, authenticated, service_role;
revoke all on function public.set_notify_embed(uuid, text[], text, text) from public, anon;
revoke all on function public.notify_embed_stats(uuid) from public, anon;
grant execute on function public.set_notify_embed(uuid, text[], text, text) to authenticated;
grant execute on function public.notify_embed_stats(uuid) to authenticated;

revoke all on function public.notify_fixture_windows() from public, anon, authenticated;
revoke all on function public.notify_lineups(uuid) from public, anon, authenticated;
revoke all on function public.notify_halftime(uuid) from public, anon, authenticated;
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;
revoke all on function public.notify_tick() from public, anon, authenticated;
grant execute on function public.notify_fixture_windows() to service_role;
grant execute on function public.notify_lineups(uuid) to service_role;
grant execute on function public.notify_halftime(uuid) to service_role;
grant execute on function public.notify_game_final(uuid) to service_role;
grant execute on function public.notify_tick() to service_role;
revoke all on function public.post_announcement(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.post_announcement(uuid, text, text, text, uuid) to authenticated;
revoke all on function public.swap_push_subscription(text, text, text, text) from public;
grant execute on function public.swap_push_subscription(text, text, text, text) to anon, authenticated, service_role;

alter function public.notify_fixture_windows() owner to postgres;
alter function public.notify_lineups(uuid) owner to postgres;
alter function public.notify_halftime(uuid) owner to postgres;
alter function public.notify_game_final(uuid) owner to postgres;
alter function public.post_announcement(uuid, text, text, text, uuid) owner to postgres;
alter function public.notify_request_origin() owner to postgres;
alter function public.notify_origin_allowed(uuid, text) owner to postgres;
alter function public.notify_endpoint_ok(text) owner to postgres;
alter function public.notify_device_throttle() owner to postgres;
alter function public.notify_uuid_list(jsonb) owner to postgres;
alter function public.notify_device_state(uuid) owner to postgres;
alter function public.notify_device_get(text, text) owner to postgres;
alter function public.notify_device_follow(text, text, text, text, jsonb, jsonb, jsonb) owner to postgres;
alter function public.notify_device_forget(text, text) owner to postgres;
alter function public.notify_device_test(text, text, text) owner to postgres;
alter function public.notify_embed_public(text) owner to postgres;
alter function public.set_notify_embed(uuid, text[], text, text) owner to postgres;
alter function public.notify_embed_stats(uuid) owner to postgres;
alter function public.swap_push_subscription(text, text, text, text) owner to postgres;
alter function public.notify_tick() owner to postgres;

-- ============================================================================
-- SELF-TEST — rolled back (P0115 pattern).
--
-- An open league (Reading Rockets v London Lions: Ben Baker, a minor, two fives) and
-- a members-only one with private fixtures (Members Home v Members Away). Games:
--   g90   scheduled in 90 minutes                      (the 2-hour reminder)
--   glu   scheduled in 3 hours, fives confirmed         (lineups, by the trigger)
--   ght   live at half-time                              (half-time)
--   gft   final 90–80 with Ben Baker's line              (full time, statline)
--   gm90  members league, scheduled in 90 minutes        (members-only)
-- One account, U, follows Reading Rockets and is the open league's admin. Devices,
-- all saved through notify_device_follow signed out:
--   DT follows Reading Rockets        DP follows Ben Baker     DG follows ght
--   DX follows Reading Rockets with half-time and results off
--   DM follows Members Home
-- It proves, as whole sets of (who, ref, title, body): the reminder, the lineups, the
-- half-time notice, the result and statline and the announcement reach U and each
-- device exactly as the contract says; the members league tells DM nothing while
-- memberships are on and its fixture once they are off; and the button's functions
-- refuse what they must (a site not set up, a club of another league, a minor, a
-- stranger's key, a burst of calls), forget, test, swap and count.
-- ============================================================================
do $test$
declare
  who     text := current_user || ' (session ' || session_user || ')';
  orig    text := current_user;
  half    text := 'a fresh test account';
  u       uuid := gen_random_uuid();
  lg uuid; lgm uuid; se uuid; sem uuid; cp uuid; cpm uuid;
  t_h uuid; t_a uuid; t_mh uuid; t_ma uuid;
  pl_baker uuid; pl_cole uuid; pl_diaz uuid; pl_eze uuid; pl_fox uuid; pl_kid uuid;
  pl_ash uuid; pl_bell uuid; pl_cobb uuid; pl_dunn uuid; pl_east uuid;
  g90 uuid; glu uuid; ght uuid; gft uuid; gm90 uuid;
  t90   timestamptz := now() + interval '90 minutes';
  tlu   timestamptz := now() + interval '3 hours';
  v_h90 text; v_hlu text;
  e_dt text := 'https://fcm.googleapis.com/fcm/send/t127-dt';
  e_dp text := 'https://fcm.googleapis.com/fcm/send/t127-dp';
  e_d2 text := 'https://fcm.googleapis.com/fcm/send/t127-d2';
  e_dg text := 'https://web.push.apple.com/t127-dg';
  e_dx text := 'https://updates.push.services.mozilla.com/wpush/v2/t127-dx';
  e_dm text := 'https://wns2-par02p.notify.windows.com/w/?token=t127-dm';
  e_dr text := 'https://fcm.googleapis.com/fcm/send/t127-dr';
  e_dz text := 'https://fcm.googleapis.com/fcm/send/t127-dz';
  k_p  text := 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
  k_a  text := 'tBHItJI5svbpez7KI4CCXg';
  d_dt uuid; d_dp uuid; d_d2 uuid; d_dg uuid; d_dx uuid; d_dr uuid; d_dm uuid;
  v_labels jsonb;
  v_exp    jsonb;
  v_actual jsonb;
  v_txt    text;
  v_j      jsonb;
  v_b      boolean;
  v_n      int;
  i        int;
  hdr_epi  text := json_build_object('origin', 'https://prophesyscouting.co.uk', 'x-forwarded-for', '203.0.113.7')::text;
  v_rows_sql text := $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'who', $1 ->> coalesce(n.user_id, n.device_id)::text,
             'kind', n.kind,
             'ref', coalesce($1 ->> split_part(n.ref, ':', 1), split_part(n.ref, ':', 1))
                    || case when strpos(n.ref, ':') > 0 then ':' || split_part(n.ref, ':', 2) else '' end,
             'title', n.title, 'body', n.body)), '[]'::jsonb)
      from public.notifications n
     where (n.user_id = $2 or n.device_id = any ($3)) and n.kind <> 'test'
  $q$;
  v_diff_sql text := $q$
    select string_agg(z.d, '; ' order by z.d)
      from (select 'UNEXPECTED ' || x.value::text as d
              from (select value from jsonb_array_elements($1) except all select value from jsonb_array_elements($2)) x
            union all
            select 'MISSING ' || m.value::text
              from (select value from jsonb_array_elements($2) except all select value from jsonb_array_elements($1)) m) z
  $q$;
begin
  -- ---- the catalogue ---------------------------------------------------------------
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.push_devices'::regclass)
     or exists (select 1 from pg_policy pol where pol.polrelid = 'public.push_devices'::regclass)
     or has_table_privilege('anon', 'public.push_devices', 'select') or has_table_privilege('authenticated', 'public.push_devices', 'select')
     or has_table_privilege('anon', 'public.notify_audience', 'select') or has_table_privilege('authenticated', 'public.notify_audience', 'select')
     or has_table_privilege('anon', 'public.notify_device_calls', 'select') or has_table_privilege('authenticated', 'public.notify_device_calls', 'select')
     or has_table_privilege('anon', 'public.notify_embeds', 'select') then
    raise exception '0127: push_devices, notify_audience and notify_device_calls must be closed to both browser roles, notify_embeds to anon';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'notifications'
         and ((c.column_name = 'user_id' and c.is_nullable = 'YES') or (c.column_name = 'device_id'))) <> 2
     or not exists (select 1 from pg_constraint k where k.conrelid = 'public.notifications'::regclass and k.conname = 'notifications_one_audience')
     or not exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = 'notifications_device_ref') then
    raise exception '0127: notifications needs a nullable user_id, device_id, exactly one of them, and (device_id, kind, ref) unique';
  end if;
  foreach v_txt in array array['notify_device_get(text,text)', 'notify_device_follow(text,text,text,text,jsonb,jsonb,jsonb)',
                               'notify_device_forget(text,text)', 'notify_device_test(text,text,text)', 'notify_embed_public(text)',
                               'swap_push_subscription(text,text,text,text)'] loop
    if not has_function_privilege('anon', 'public.' || v_txt, 'execute') then
      raise exception '0127: % must be callable signed out', v_txt;
    end if;
  end loop;
  foreach v_txt in array array['notify_fixture_windows()', 'notify_lineups(uuid)', 'notify_halftime(uuid)', 'notify_game_final(uuid)',
                               'notify_tick()', 'notify_device_state(uuid)', 'notify_device_throttle()', 'notify_origin_allowed(uuid,text)'] loop
    if has_function_privilege('anon', 'public.' || v_txt, 'execute') or has_function_privilege('authenticated', 'public.' || v_txt, 'execute') then
      raise exception '0127: % is callable from a browser', v_txt;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.set_notify_embed(uuid,text[],text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_notify_embed(uuid,text[],text,text)', 'execute') then
    raise exception '0127: set_notify_embed is for signed-in admins only';
  end if;
  if not public.notify_endpoint_ok(e_dt) or not public.notify_endpoint_ok(e_dg) or not public.notify_endpoint_ok(e_dx)
     or not public.notify_endpoint_ok(e_dm)
     or public.notify_endpoint_ok('https://example.com/push') or public.notify_endpoint_ok('http://fcm.googleapis.com/fcm/send/x')
     or public.notify_endpoint_ok('https://fcm.googleapis.com.evil.test/x') or public.notify_endpoint_ok('https://fcm.googleapis.com:8443/x') then
    raise exception '0127: notify_endpoint_ok accepts exactly the push services browsers use';
  end if;

  begin
    -- ============================================================ seeded as the owner
    if public.memberships_enabled() then
      raise exception '0127: memberships are switched on before the self-test switched them on';
    end if;
    insert into leagues (slug, name, public_live) values ('zz-t127-open', '0127 Open', true) returning id into lg;
    insert into leagues (slug, name, public_live, access_mode, access_fixtures_public)
      values ('zz-t127-members', '0127 Members', true, 'members', false) returning id into lgm;
    insert into seasons (league_id, name) values (lg, '0127') returning id into se;
    insert into seasons (league_id, name) values (lgm, '0127') returning id into sem;
    insert into competitions (season_id, name) values (se, 'T127 Cup') returning id into cp;
    insert into competitions (season_id, name) values (sem, 'T127 Members') returning id into cpm;
    insert into teams (league_id, slug, name, short_name) values (lg, 'zz-t127-rockets', 'Reading Rockets', 'Rockets') returning id into t_h;
    insert into teams (league_id, slug, name, short_name) values (lg, 'zz-t127-lions', 'London Lions', 'Lions') returning id into t_a;
    insert into teams (league_id, slug, name, short_name) values (lgm, 'zz-t127-mhome', 'Members Home', '') returning id into t_mh;
    insert into teams (league_id, slug, name, short_name) values (lgm, 'zz-t127-maway', 'Members Away', '') returning id into t_ma;
    insert into players (slug, first_name, last_name) values ('zz-t127-baker', 'Ben', 'Baker') returning id into pl_baker;
    insert into players (slug, first_name, last_name) values ('zz-t127-cole', 'Tom', 'Cole') returning id into pl_cole;
    insert into players (slug, first_name, last_name) values ('zz-t127-diaz', 'Dan', 'Diaz') returning id into pl_diaz;
    insert into players (slug, first_name, last_name) values ('zz-t127-eze', 'Eli', 'Eze') returning id into pl_eze;
    insert into players (slug, first_name, last_name) values ('zz-t127-fox', 'Sam', 'Fox') returning id into pl_fox;
    insert into players (slug, first_name, last_name, is_minor) values ('zz-t127-kid', 'Kiddo', 'Younger', true) returning id into pl_kid;
    insert into players (slug, first_name, last_name) values ('zz-t127-ash', 'Al', 'Ash') returning id into pl_ash;
    insert into players (slug, first_name, last_name) values ('zz-t127-bell', 'Bo', 'Bell') returning id into pl_bell;
    insert into players (slug, first_name, last_name) values ('zz-t127-cobb', 'Cy', 'Cobb') returning id into pl_cobb;
    insert into players (slug, first_name, last_name) values ('zz-t127-dunn', 'Di', 'Dunn') returning id into pl_dunn;
    insert into players (slug, first_name, last_name) values ('zz-t127-east', 'Ed', 'East') returning id into pl_east;
    insert into roster_entries (team_id, player_id, season_id, jersey, active) values
      (t_h, pl_baker, se, '4', true), (t_h, pl_cole, se, '5', true), (t_h, pl_diaz, se, '6', true),
      (t_h, pl_eze, se, '7', true), (t_h, pl_fox, se, '9', true), (t_h, pl_kid, se, '12', true),
      (t_a, pl_ash, se, '4', true), (t_a, pl_bell, se, '5', true), (t_a, pl_cobb, se, '6', true),
      (t_a, pl_dunn, se, '7', true), (t_a, pl_east, se, '8', true);

    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, venue)
      values (cp, t_h, t_a, t90, 'scheduled', 'Archers Arena') returning id into g90;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp, t_h, t_a, tlu, 'scheduled') returning id into glu;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, starters)
      values (cp, t_h, t_a, now() - interval '1 hour', 'live',
              jsonb_build_array(jsonb_build_array(pl_baker, pl_cole, pl_diaz, pl_eze, pl_fox),
                                jsonb_build_array(pl_ash, pl_bell, pl_cobb, pl_dunn, pl_east)))
      returning id into ght;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp, t_h, t_a, now() - interval '3 hours', 'final', 90, 80) returning id into gft;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cpm, t_mh, t_ma, t90, 'scheduled') returning id into gm90;
    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (ght, 1, 'p2_made', 0, pl_baker::text, 1, 590000, '{}', now() - interval '5 minutes'),
      (ght, 2, 'p3_made', 1, pl_ash::text,   2, 300000, '{}', now() - interval '5 minutes');
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (ght, 2, 0, false, 2, 3);
    insert into player_game_stats (game_id, player_id, team_idx, stats) values
      (gft, pl_baker::text, 0, '{"pts":20,"or":1,"dr":4,"ast":3,"p2m":7,"p2a":12,"p3m":2,"p3a":5,"min":1800000}'::jsonb);
    v_h90 := to_char(t90 at time zone 'Europe/London', 'HH24:MI');
    v_hlu := to_char(tlu at time zone 'Europe/London', 'HH24:MI');

    -- ---- the account ---------------------------------------------------------------
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't127-u@example.invalid', '', now(), now(), now());
    exception when insufficient_privilege then
      select p.id into u from public.profiles p
       where not exists (select 1 from public.memberships m where m.user_id = p.id)
         and not exists (select 1 from public.league_writers lw where lw.user_id = p.id)
         and not exists (select 1 from public.game_officials go where go.user_id = p.id)
         and not exists (select 1 from public.access_subscriptions a where a.user_id = p.id)
       order by p.created_at limit 1;
      if u is null then raise exception '0127: no account to test with'; end if;
      half := 'a borrowed profile';
    end;
    insert into fan_prefs as fp (user_id, fav_team_ids, fav_player_ids, fav_game_ids, want_results, want_players, want_fixtures,
                                 want_announcements, want_fixture_2d, want_fixture_2h, want_lineups, want_player_games, want_halftime,
                                 notify_inapp, notify_email, notify_push)
    values (u, array[t_h], '{}', '{}', true, true, true, true, true, true, true, true, true, true, false, false)
    on conflict (user_id) do update
      set fav_team_ids = excluded.fav_team_ids, fav_player_ids = excluded.fav_player_ids, fav_game_ids = excluded.fav_game_ids,
          want_results = true, want_players = true, want_fixtures = true, want_announcements = true, want_fixture_2d = true,
          want_fixture_2h = true, want_lineups = true, want_player_games = true, want_halftime = true,
          notify_email = false, notify_push = false;
    insert into memberships (user_id, role, scope_type, scope_id) values (u, 'league_admin', 'league', lg);

    -- ---- the devices, signed out, from Epinoia's window ---------------------------
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', hdr_epi, true);
    set local role anon;
    v_j := public.notify_device_follow('zz-t127-open', e_dt, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)));
    if v_j -> 'teams' <> jsonb_build_array(jsonb_build_object('id', t_h, 'name', 'Reading Rockets', 'league', 'zz-t127-open'))
       or (v_j -> 'prefs' ->> 'want_halftime')::boolean is distinct from true then
      execute format('set local role %I', orig);
      raise exception '0127: following a club answered %', v_j;
    end if;
    perform public.notify_device_follow('zz-t127-open', e_dp, k_p, k_a, jsonb_build_object('players', jsonb_build_array(pl_baker)));
    perform public.notify_device_follow('zz-t127-open', e_d2, k_p, k_a, jsonb_build_object('players', jsonb_build_array(pl_baker, pl_ash)));
    perform public.notify_device_follow('zz-t127-open', e_dg, k_p, k_a, jsonb_build_object('games', jsonb_build_array(ght)));
    perform public.notify_device_follow('zz-t127-open', e_dx, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)),
                                        '{}'::jsonb, '{"want_halftime": false}'::jsonb);
    perform public.notify_device_follow('zz-t127-open', e_dr, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)),
                                        '{}'::jsonb, '{"want_results": false}'::jsonb);
    perform public.notify_device_follow('zz-t127-members', e_dm, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_mh)));

    -- what the button's functions refuse
    begin
      perform public.notify_device_follow('zz-t127-open', e_dz, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_ma)));
      execute format('set local role %I', orig);
      raise exception '0127: a club of another league was followed';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.notify_device_follow('zz-t127-open', e_dz, k_p, k_a, jsonb_build_object('players', jsonb_build_array(pl_kid)));
      execute format('set local role %I', orig);
      raise exception '0127: a minor was followed';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.notify_device_follow('zz-t127-open', e_dt, k_p, 'someoneElsesKey000', jsonb_build_object('teams', jsonb_build_array(t_a)));
      execute format('set local role %I', orig);
      raise exception '0127: a device was changed with a key that is not its own';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.notify_device_follow('zz-t127-open', 'https://example.com/push/1', k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)));
      execute format('set local role %I', orig);
      raise exception '0127: an endpoint that is no push service was saved';
    exception when invalid_parameter_value then null;
    end;
    if public.notify_device_get(e_dt, 'someoneElsesKey000') is not null or public.notify_device_get(e_dt, k_a) -> 'teams' -> 0 ->> 'name' <> 'Reading Rockets' then
      execute format('set local role %I', orig);
      raise exception '0127: notify_device_get must answer the key holder only';
    end if;
    perform set_config('request.headers', json_build_object('origin', 'https://club.example', 'x-forwarded-for', '203.0.113.8')::text, true);
    begin
      perform public.notify_device_follow('zz-t127-open', e_dz, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)));
      execute format('set local role %I', orig);
      raise exception '0127: a website that is not set up saved a device';
    exception when insufficient_privilege then null;
    end;
    v_j := public.notify_embed_public('zz-t127-open');
    if (v_j ->> 'site')::boolean or (v_j ->> 'epinoia')::boolean or v_j -> 'league' ->> 'name' <> '0127 Open' then
      execute format('set local role %I', orig);
      raise exception '0127: notify_embed_public for a site not set up answered %', v_j;
    end if;
    execute format('set local role %I', orig);
    insert into notify_embeds (league_id, sites) values (lg, array['https://club.example']);
    set local role anon;
    v_j := public.notify_device_follow('zz-t127-open', e_dz, k_p, k_a, jsonb_build_object('teams', jsonb_build_array(t_h)));
    if not (v_j ->> 'device')::boolean or not (public.notify_embed_public('zz-t127-open') ->> 'site')::boolean then
      execute format('set local role %I', orig);
      raise exception '0127: a website the league set up could not save a device: %', v_j;
    end if;
    v_j := public.notify_device_follow('zz-t127-open', e_dz, k_p, k_a, '{}'::jsonb, jsonb_build_object('teams', jsonb_build_array(t_h)));
    if (v_j ->> 'device')::boolean then
      execute format('set local role %I', orig);
      raise exception '0127: a device that unfollowed its last club was kept';
    end if;
    execute format('set local role %I', orig);
    if exists (select 1 from push_devices where endpoint = e_dz) then
      raise exception '0127: the emptied device is still stored';
    end if;

    select id into d_dt from push_devices where endpoint = e_dt;
    select id into d_dp from push_devices where endpoint = e_dp;
    select id into d_d2 from push_devices where endpoint = e_d2;
    select id into d_dg from push_devices where endpoint = e_dg;
    select id into d_dx from push_devices where endpoint = e_dx;
    select id into d_dr from push_devices where endpoint = e_dr;
    select id into d_dm from push_devices where endpoint = e_dm;
    if (select origin from push_devices where id = d_dt) <> 'https://prophesyscouting.co.uk' then
      raise exception '0127: a device does not record the site it was saved from';
    end if;
    v_labels := jsonb_build_object(u::text, 'U', d_dt::text, 'DT', d_dp::text, 'DP', d_d2::text, 'D2', d_dg::text, 'DG', d_dx::text, 'DX', d_dr::text, 'DR', d_dm::text, 'DM',
                                   g90::text, 'g90', glu::text, 'glu', ght::text, 'ght', gft::text, 'gft', gm90::text, 'gm90');

    -- ============================================================ every moment, memberships on
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
    perform public.notify_fixture_windows();
    update games set starters = jsonb_build_array(jsonb_build_array(pl_baker, pl_cole, pl_diaz, pl_eze, pl_fox),
                                                  jsonb_build_array(pl_ash, pl_bell, pl_cobb, pl_dunn, pl_east))
     where id = glu;
    perform public.notify_halftime(ght);
    perform public.notify_game_final(gft);

    v_exp := jsonb_build_array(
      jsonb_build_object('who', 'U',  'kind', 'fixture', 'ref', 'g90:2h', 'title', 'Reading Rockets v London Lions', 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
      jsonb_build_object('who', 'DT', 'kind', 'fixture', 'ref', 'g90:2h', 'title', 'Reading Rockets v London Lions', 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
      jsonb_build_object('who', 'DX', 'kind', 'fixture', 'ref', 'g90:2h', 'title', 'Reading Rockets v London Lions', 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
      jsonb_build_object('who', 'DR', 'kind', 'fixture', 'ref', 'g90:2h', 'title', 'Reading Rockets v London Lions', 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
      jsonb_build_object('who', 'DP', 'kind', 'fixture', 'ref', 'g90:2h', 'title', 'Ben Baker plays in 1 hour', 'body', 'Reading Rockets v London Lions · tip-off ' || v_h90),
      jsonb_build_object('who', 'D2', 'kind', 'fixture', 'ref', 'g90:2h', 'title', 'Al Ash and Ben Baker play in 1 hour', 'body', 'Reading Rockets v London Lions · tip-off ' || v_h90),
      jsonb_build_object('who', 'U',  'kind', 'lineups', 'ref', 'glu:lineups', 'title', 'Lineups are in: Rockets v Lions', 'body', 'Rockets: Baker, Cole, Diaz, Eze, Fox' || chr(10) || 'Lions: Ash, Bell, Cobb, Dunn, East'),
      jsonb_build_object('who', 'DT', 'kind', 'lineups', 'ref', 'glu:lineups', 'title', 'Lineups are in: Rockets v Lions', 'body', 'Rockets: Baker, Cole, Diaz, Eze, Fox' || chr(10) || 'Lions: Ash, Bell, Cobb, Dunn, East'),
      jsonb_build_object('who', 'DX', 'kind', 'lineups', 'ref', 'glu:lineups', 'title', 'Lineups are in: Rockets v Lions', 'body', 'Rockets: Baker, Cole, Diaz, Eze, Fox' || chr(10) || 'Lions: Ash, Bell, Cobb, Dunn, East'),
      jsonb_build_object('who', 'DR', 'kind', 'lineups', 'ref', 'glu:lineups', 'title', 'Lineups are in: Rockets v Lions', 'body', 'Rockets: Baker, Cole, Diaz, Eze, Fox' || chr(10) || 'Lions: Ash, Bell, Cobb, Dunn, East'),
      jsonb_build_object('who', 'DP', 'kind', 'lineups', 'ref', 'glu:lineups', 'title', 'Ben Baker starts for Reading Rockets', 'body', 'Reading Rockets v London Lions · tip-off ' || v_hlu),
      jsonb_build_object('who', 'D2', 'kind', 'lineups', 'ref', 'glu:lineups', 'title', 'Ben Baker starts for Reading Rockets', 'body', 'Reading Rockets v London Lions · tip-off ' || v_hlu || ' · Al Ash starts'),
      jsonb_build_object('who', 'U',  'kind', 'halftime', 'ref', 'ght:ht', 'title', 'HT · Reading Rockets 2–3 London Lions', 'body', 'Top scorers: Baker 2, Ash 3'),
      jsonb_build_object('who', 'DT', 'kind', 'halftime', 'ref', 'ght:ht', 'title', 'HT · Reading Rockets 2–3 London Lions', 'body', 'Top scorers: Baker 2, Ash 3'),
      jsonb_build_object('who', 'DG', 'kind', 'halftime', 'ref', 'ght:ht', 'title', 'HT · Reading Rockets 2–3 London Lions', 'body', 'Top scorers: Baker 2, Ash 3'),
      jsonb_build_object('who', 'DP', 'kind', 'halftime', 'ref', 'ght:ht', 'title', 'Ben Baker at half-time: 2 PTS · 0 REB · 0 AST', 'body', 'Reading Rockets 2–3 London Lions · HT · 1/1 FG · 20 MIN'),
      jsonb_build_object('who', 'D2', 'kind', 'halftime', 'ref', 'ght:ht', 'title', 'Al Ash at half-time: 3 PTS · 0 REB · 0 AST', 'body', 'Reading Rockets 2–3 London Lions · HT · 1/1 FG · 20 MIN' || chr(10) || 'Ben Baker: 2 PTS · 0 REB · 0 AST'),
      jsonb_build_object('who', 'U',  'kind', 'result', 'ref', 'gft', 'title', 'FT · Reading Rockets 90–80 London Lions', 'body', 'T127 Cup'),
      jsonb_build_object('who', 'DT', 'kind', 'result', 'ref', 'gft', 'title', 'FT · Reading Rockets 90–80 London Lions', 'body', 'T127 Cup'),
      jsonb_build_object('who', 'DX', 'kind', 'result', 'ref', 'gft', 'title', 'FT · Reading Rockets 90–80 London Lions', 'body', 'T127 Cup'),
      jsonb_build_object('who', 'DP', 'kind', 'player', 'ref', 'gft:' || pl_baker, 'title', 'Ben Baker: 20 PTS · 5 REB · 3 AST', 'body', 'Reading Rockets 90–80 London Lions · FT · 9/17 FG · 30 MIN'),
      jsonb_build_object('who', 'D2', 'kind', 'player', 'ref', 'gft:' || pl_baker, 'title', 'Ben Baker: 20 PTS · 5 REB · 3 AST', 'body', 'Reading Rockets 90–80 London Lions · FT · 9/17 FG · 30 MIN'));
    execute v_rows_sql into v_actual using v_labels, u, array[d_dt, d_dp, d_d2, d_dg, d_dx, d_dr, d_dm];
    execute v_diff_sql into v_txt using v_actual, v_exp;
    if v_txt is not null then
      raise exception '0127: every moment, memberships on: %', v_txt;
    end if;

    -- a second pass writes nothing
    if public.notify_fixture_windows() <> 0 then
      raise exception '0127: a second pass wrote the reminders again';
    end if;
    if public.notify_lineups(glu) <> 0 or public.notify_halftime(ght) <> 0 or public.notify_game_final(gft) <> 0 then
      raise exception '0127: a second pass wrote a moment again';
    end if;

    -- ============================================================ memberships off: the members league's fixture
    update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
    perform public.notify_fixture_windows();
    if not exists (select 1 from notifications n where n.device_id = d_dm and n.game_id = gm90 and n.title = 'Members Home v Members Away'
                     and n.body = 'In 1 hour · tip-off ' || v_h90) then
      raise exception '0127: with memberships off the members league''s fixture did not reach its device';
    end if;

    -- ============================================================ the announcement, from the league's admin
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.post_announcement(lg, 'Trophy draw', 'Live at 7', 'fans', null);
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);
    select coalesce(jsonb_agg(v_labels ->> coalesce(n.user_id, n.device_id)::text order by v_labels ->> coalesce(n.user_id, n.device_id)::text), '[]'::jsonb)
      into v_actual
      from notifications n
     where n.kind = 'announcement' and n.league_id = lg and n.title = 'Trophy draw' and n.body = 'Live at 7';
    if v_actual <> '["DR", "DT", "DX", "U"]'::jsonb then
      raise exception '0127: the announcement reached % (want DR, DT, DX and U)', v_actual;
    end if;

    -- ============================================================ test, swap, forget, the tick, the throttle
    perform set_config('request.headers', hdr_epi, true);
    set local role anon;
    v_b := public.notify_device_test(e_dt, k_a, 'zz-t127-open');
    if not v_b or public.notify_device_test(e_dt, k_a, 'zz-t127-open') or public.notify_device_test(e_dt, 'someoneElsesKey000') then
      execute format('set local role %I', orig);
      raise exception '0127: notify_device_test must write one test a minute, for the key holder only';
    end if;
    execute format('set local role %I', orig);
    if not exists (select 1 from notifications n where n.device_id = d_dt and n.kind = 'test' and n.league_id = lg
                     and n.body = 'This is how 0127 Open notifications will arrive on this device.' and n.urgency = 'high') then
      raise exception '0127: the test notification is not as written';
    end if;

    set local role anon;
    v_b := public.swap_push_subscription(e_dg, e_dg || '-rotated', k_p, 'rotatedAuthKey00');
    execute format('set local role %I', orig);
    if not v_b or not exists (select 1 from push_devices d where d.id = d_dg and d.endpoint = e_dg || '-rotated' and d.auth = 'rotatedAuthKey00'
                                and d.fav_game_ids = array[ght]) then
      raise exception '0127: a device''s rotated subscription did not keep what it follows';
    end if;

    insert into notifications (device_id, kind, title, ref, created_at) values (d_dm, 'announcement', 'old', 't127-old', now() - interval '8 days');
    v_j := public.notify_tick();
    if (v_j ->> 'cleared')::int < 1 or exists (select 1 from notifications where ref = 't127-old')
       or (v_j ->> 'waiting')::int < 1 or v_j -> 'errors' <> '[]'::jsonb then
      raise exception '0127: the tick must clear a week-old device row and count devices'' waiting rows: %', v_j;
    end if;

    set local role anon;
    v_b := public.notify_device_forget(e_dm, k_a);
    execute format('set local role %I', orig);
    if not v_b or exists (select 1 from push_devices where id = d_dm) or exists (select 1 from notifications where device_id = d_dm) then
      raise exception '0127: forgetting a device must delete it and its rows';
    end if;

    perform set_config('request.headers', json_build_object('origin', 'https://prophesyscouting.co.uk', 'x-forwarded-for', '198.51.100.99')::text, true);
    set local role anon;
    for i in 1..60 loop
      perform public.notify_device_forget('https://fcm.googleapis.com/fcm/send/t127-nobody', k_a);
    end loop;
    begin
      perform public.notify_device_forget('https://fcm.googleapis.com/fcm/send/t127-nobody', k_a);
      execute format('set local role %I', orig);
      raise exception '0127: the 61st change from one address in ten minutes went through';
    exception when sqlstate 'PT429' then null;
    end;
    execute format('set local role %I', orig);

    -- the console
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.set_notify_embed(lg, array['https://www.Club.example/fixtures', 'https://club.example', 'https://CLUB.example/', ''], 'https://club.example/match/{game}', 'https://club.example');
    v_j := public.notify_embed_stats(lg);
    begin
      perform public.set_notify_embed(lg, array['http://club.example'], null, null);
      execute format('set local role %I', orig);
      raise exception '0127: a site without https was accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.set_notify_embed(lgm, array['https://club.example'], null, null);
      execute format('set local role %I', orig);
      raise exception '0127: an admin of one league set another''s';
    exception when insufficient_privilege then null;
    end;
    execute format('set local role %I', orig);
    if (select sites from notify_embeds where league_id = lg) <> array['https://www.club.example', 'https://club.example']
       or v_j <> '{"devices": 6, "clubs": 3, "players": 2, "games": 1}'::jsonb then
      raise exception '0127: set_notify_embed / notify_embed_stats answered % and %', (select sites from notify_embeds where league_id = lg), v_j;
    end if;

    raise exception using errcode = 'P0127', message = '0127 passed; rolling its test rows back';
  exception
    when sqlstate 'P0127' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug like 'zz-t127-%') or exists (select 1 from push_devices where endpoint like '%t127-%') then
    raise exception '0127: the test rows outlived their rollback';
  end if;
  if public.memberships_enabled() then
    raise exception '0127: the self-test left memberships switched on';
  end if;
  raise notice '0127 ok: devices hear every moment exactly as an account does (reminder, lineups, half-time, result, statline, announcement), members-only leagues tell them only public fixtures, and the button''s functions refuse other leagues'' clubs, minors, strangers'' keys, sites not set up and bursts; test, swap, forget, the tick and the console work. Ran with %', half;
end $test$;
