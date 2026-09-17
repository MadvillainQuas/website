-- ============================================================================
-- 0121 — NOTIFICATIONS V2: TIP-OFF REMINDERS, STARTING LINEUPS, RESULTS AND
-- STATLINES, ON THE PHONE.
--
-- The contract is docs/notifications.md; this file is its sections 1 to 3. The
-- notify Edge Function (4), the service worker and push.js (5) and the game
-- page's show=starters (6) are other files.
--
-- v1 stays underneath (0106, 0107, and 0118's members-only rule): a fan-out
-- writes one notifications row per person, the bell reads the rows, and the
-- notify function delivers them beyond the bell. v2 changes WHAT is written and
-- WHEN, FotMob-style: a notice says exactly what happened and when, and one tap
-- lands on the thing it talks about.
--
--   moment                         kind      ref               who
--   2 days before tip-off          fixture   <game>:2d         club / game followers; player-only followers
--   2 hours or less before         fixture   <game>:2h         the same
--   both starting fives confirmed  lineups   <game>:lineups    the same
--   full time                      result    <game>            club / game followers
--   a followed player's line       player    <game>:<player>   followers of that player
--
-- ONE NOTICE PER FAN PER GAME PER MOMENT. (user, kind, ref) has been unique
-- since 0106, so every fan-out is safe to run again and again: the minute tick
-- below does exactly that. The club-style notice and the player-style notice of
-- a moment share a ref, and the player-style query also leaves out anybody who
-- follows either club or the game, so a fan who follows a club and a player in
-- it gets the club notice only; the players a fan follows in one game are
-- grouped into one row. Result and statline are different kinds, so a club
-- follower who also follows a player gets both, as FotMob sends both.
--
-- MINORS ARE NEVER NAMED unless publication consent is recorded
-- (player_withheld, 0049): a withheld player never triggers a player-only
-- notice, and appears in a lineup as their shirt number.
--
-- MEMBERS-ONLY LEAGUES keep 0118's rule, decided once per game: a fan who may
-- not view the league is not told its lineups, results or statlines, and its
-- fixture reminders follow access_fixtures_public; while memberships are
-- switched off (0117) every league is open.
--
-- WHY A MINUTE TICK IN THE DATABASE. Until now reminders were written by the
-- ingest runner's passes, which run on GitHub's scheduler: minutes late on a
-- good day, and only while a pass runs at all. "In 2 hours" and "lineups are
-- in" are worth something only on time. So pg_cron runs notify_tick() every
-- minute: it writes both reminder windows and any lineups not yet sent, and when
-- rows are waiting for somebody who asked for phone notifications it calls the
-- notify function through pg_net. Both extensions are created only where they
-- are available (the local PGlite harness has neither), every function installs
-- and runs without them, and notify_health() says from outside what is there.
--
-- WHERE THIS FILE DECIDES WHAT THE CONTRACT DOES NOT SAY, each for the reason
-- given where it happens:
--   * THE SWITCHES. want_fixtures and want_results keep the meaning 0107 gave
--     them: they govern what a fan is told about the CLUBS they follow, and a
--     followed game is told regardless (the profile page still describes them
--     that way). The new per-moment switches (want_fixture_2d, want_fixture_2h,
--     want_lineups) apply to every audience, game followers included, because
--     each names one moment. want_player_games governs the player-only fixture
--     and lineup notices, want_players (as before) the statlines;
--   * THE SHORT TEAM NAME in a lineups notice is teams.short_name only when it
--     reads as a name (three or more characters, with a lower-case letter):
--     short_name is a scoreboard code on most clubs ("NC", "LON"), and
--     "Lineups are in: NC v SC" says less than the full names do;
--   * URGENCY AND EXPIRY: the 2-day reminder is normal and expires 24 hours
--     before tip-off (after that "in 2 days" is untrue); the 2-hour reminder is
--     high and expires at tip-off; lineups are high and expire an hour after
--     tip-off; the result and the statline are high and expire in 24 hours;
--   * notif_until rounds to the nearest minute, then to the nearest hour with a
--     half hour rounding DOWN ("In 1 hour" at 90 minutes: a fan told too little
--     time arrives early, not late), and says days from 36 hours;
--   * notif_statline_more leaves out FG with no attempts and MIN under a minute;
--   * four more small helpers (notif_num, notif_names, notif_team_label,
--     notif_starters_complete), so each rule is written once and tested with
--     fixed inputs;
--   * a player named in games.starters that is neither a string nor a number is
--     refused (22023) by notify_lineups for that game: the trigger ignores it,
--     and the minute sweep skips that one game with a warning rather than
--     stopping every other game's lineups;
--   * notify_tick takes an advisory lock, so two ticks (pg_cron and the ingest
--     runner's notify_fixtures) never write at once, and records each step's
--     error in notify_ticks instead of failing the whole tick;
--   * swap_push_subscription, when the new endpoint is already registered (the
--     page re-subscribed first), removes the old row and still answers true.
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- 0. LOCKS, FOR THE WHOLE FILE
--
-- Every lock is held until commit, self-test included, and each wait is capped
-- at five seconds, as 0119 and 0120 do: a busy moment fails the push with 55P03
-- and nothing applied. Taken up front, in the order live traffic takes them —
-- games first, then fan_prefs and notifications — because finalise-game updates
-- a game and then writes notifications through notify_game_final. Taking the
-- notifications lock first and the games lock later (create trigger) could
-- deadlock with a finalise in flight.
--   * games, SHARE ROW EXCLUSIVE (for the lineups trigger): game UPDATEs wait
--     until commit (sync.js's running score, a scorer claiming a fixture). Reads
--     and event inserts (their foreign key check) do not wait;
--   * fan_prefs, ACCESS EXCLUSIVE (four columns): the profile page and follow
--     buttons wait;
--   * notifications, ACCESS EXCLUSIVE (three columns, the kind and urgency
--     checks, one scan to validate them, and the partial index): the bell waits.
-- The extensions and the cron job come last, after the self-test.
-- ----------------------------------------------------------------------------
set local lock_timeout = '5s';

-- NO EXPLICIT LOCK TABLE. The Supabase CLI applies a migration's statements
-- outside a transaction block, and LOCK TABLE outside one is refused (25P01) —
-- the first push of this file stopped there, with nothing applied. The ALTERs
-- below take the same locks themselves, one statement at a time; at a quiet hour
-- the ordering above is not needed.

-- ----------------------------------------------------------------------------
-- 1. THE COLUMNS (contract 2 and 3)
--
-- data: what a phone or a page needs beyond the title and body (the game, the
-- clubs, the window, the starting fives, the followed players, the score, the
-- statline — only the keys relevant to the kind). expires_at: a push is not
-- sent after it; the bell still shows the row. urgency: Web Push's hint to the
-- phone. All three have constant defaults, so adding them rewrites nothing.
--
-- The kind check (0106, 0109, 0120) gains lineups and keeps every kind before
-- it. The partial index serves the delivery query and the tick's count: rows
-- nobody has pushed yet, newest first, which is a few days of rows at most.
-- ----------------------------------------------------------------------------
alter table public.notifications
  add column if not exists data       jsonb not null default '{}'::jsonb,
  add column if not exists expires_at timestamptz,
  add column if not exists urgency    text  not null default 'normal';

alter table public.notifications
  drop constraint if exists notifications_kind_check,
  drop constraint if exists notifications_urgency_check;
alter table public.notifications
  add constraint notifications_kind_check
    check (kind in ('result', 'player', 'fixture', 'lineups', 'announcement', 'message', 'highlights', 'privacy')),
  add constraint notifications_urgency_check
    check (urgency in ('very-low', 'low', 'normal', 'high'));

create index if not exists notifications_unpushed_idx
  on public.notifications (created_at) where pushed_at is null;

alter table public.fan_prefs
  add column if not exists want_fixture_2d   boolean not null default true,
  add column if not exists want_fixture_2h   boolean not null default true,
  add column if not exists want_lineups      boolean not null default true,
  add column if not exists want_player_games boolean not null default true;

-- ----------------------------------------------------------------------------
-- 2. set_fan_prefs (latest: 0107), with the four new keys.
--
-- Everything 0107 did is kept: a key that is missing or null keeps its value,
-- and an empty list arrives as [] and clears. Still SECURITY INVOKER, as it has
-- been since 0106: it writes only the caller's own row, through fan_prefs' own
-- policy, so it needs no rights of its own. The return type is the fan_prefs row,
-- which gains the four columns with the table.
-- ----------------------------------------------------------------------------
create or replace function public.set_fan_prefs(p jsonb)
returns public.fan_prefs language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update fan_prefs set
    theme              = coalesce(p->>'theme', theme),
    colour             = coalesce(p->>'colour', colour),
    fav_team_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_team_ids') x), fav_team_ids),
    fav_player_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_player_ids') x), fav_player_ids),
    fav_game_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_game_ids') x), fav_game_ids),
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
    updated_at = now()
   where user_id = auth.uid()
  returning * into r;
  if p ? 'fav_team_ids' and jsonb_array_length(p->'fav_team_ids') = 0 then
    update fan_prefs set fav_team_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_player_ids' and jsonb_array_length(p->'fav_player_ids') = 0 then
    update fan_prefs set fav_player_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_game_ids' and jsonb_array_length(p->'fav_game_ids') = 0 then
    update fan_prefs set fav_game_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- 3. THE WORDING HELPERS (contract 3)
--
-- Pure functions of their arguments (and of now(), for notif_until), so the
-- self-test can pin every phrase to fixed inputs. The times are London's,
-- whatever the session's time zone, because every league on the platform plays
-- in the UK. Only the fan-outs call them, and they run as their owner, so the
-- browser roles are not given them.
-- ----------------------------------------------------------------------------

-- 'Sat 19 Sep, 19:30'. Dy and Mon without TM are English whatever lc_time says.
create or replace function public.notif_when(p_at timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_at at time zone 'Europe/London', 'Dy FMDD Mon, HH24:MI');
$$;

-- 'In 2 hours' | 'In 1 hour' | 'In 35 minutes' (see the header for the rounding)
create or replace function public.notif_until(p_at timestamptz)
returns text language sql stable set search_path = public as $$
  select case
           when a.s is null then null
           when a.s <= 0 then 'Now'
           when b.m < 60 then 'In ' || b.m || case when b.m = 1 then ' minute' else ' minutes' end
           when b.m < 36 * 60 then 'In ' || c.h || case when c.h = 1 then ' hour' else ' hours' end
           else 'In ' || c.d || case when c.d = 1 then ' day' else ' days' end
         end
    from (select extract(epoch from (p_at - now())) as s) a
    cross join lateral (select greatest(1, round(a.s / 60))::int as m) b
    cross join lateral (select ceil(b.m / 60.0 - 0.5)::int as h,
                               ceil(b.m / 1440.0 - 0.5)::int as d) c;
$$;

-- a number from a box-score line, 0 when it is missing or not a number
create or replace function public.notif_num(p jsonb, k text)
returns numeric language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p -> k) = 'number' then (p ->> k)::numeric else 0 end;
$$;

-- '23 PTS · 6 REB · 5 AST', then STL and BLK when they are not zero
create or replace function public.notif_statline(p jsonb)
returns text language sql immutable set search_path = public as $$
  select concat_ws(' · ',
           round(public.notif_num(p, 'pts'))::int || ' PTS',
           round(public.notif_num(p, 'or') + public.notif_num(p, 'dr'))::int || ' REB',
           round(public.notif_num(p, 'ast'))::int || ' AST',
           case when public.notif_num(p, 'stl') > 0 then round(public.notif_num(p, 'stl'))::int || ' STL' end,
           case when public.notif_num(p, 'blk') > 0 then round(public.notif_num(p, 'blk'))::int || ' BLK' end);
$$;

-- '8/20 FG · 32 MIN': field goals are twos and threes, minutes come in milliseconds
create or replace function public.notif_statline_more(p jsonb)
returns text language sql immutable set search_path = public as $$
  select concat_ws(' · ',
           case when x.fga > 0 then round(x.fgm)::int || '/' || round(x.fga)::int || ' FG' end,
           case when x.mins >= 1 then x.mins::int || ' MIN' end)
    from (select public.notif_num(p, 'p2m') + public.notif_num(p, 'p3m') as fgm,
                 public.notif_num(p, 'p2a') + public.notif_num(p, 'p3a') as fga,
                 round(public.notif_num(p, 'min') / 60000) as mins) x;
$$;

-- 'A', 'A and B', 'A, B and C', 'A, B and 3 others'
create or replace function public.notif_names(p text[])
returns text language sql immutable set search_path = public as $$
  select case coalesce(cardinality(p), 0)
           when 0 then ''
           when 1 then p[1]
           when 2 then p[1] || ' and ' || p[2]
           when 3 then p[1] || ', ' || p[2] || ' and ' || p[3]
           else p[1] || ', ' || p[2] || ' and ' || (cardinality(p) - 2) || ' others'
         end;
$$;

-- the short name when it reads as a name, otherwise the full name (see the header)
create or replace function public.notif_team_label(p_name text, p_short text)
returns text language sql immutable set search_path = public as $$
  select case when char_length(btrim(coalesce(p_short, ''))) >= 3 and btrim(p_short) ~ '[a-z]'
              then btrim(p_short)
              else coalesce(nullif(btrim(p_name), ''), 'Team') end;
$$;

-- both starting fives confirmed: two lists of at least five. The CASE keeps
-- jsonb_array_length away from anything that is not a list.
create or replace function public.notif_starters_complete(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'array'
               and jsonb_typeof(p -> 0) = 'array'
               and jsonb_typeof(p -> 1) = 'array'
              then jsonb_array_length(p -> 0) >= 5 and jsonb_array_length(p -> 1) >= 5
              else false end;
$$;

-- ----------------------------------------------------------------------------
-- 4. THE TIP-OFF REMINDERS (contract 1, 3)
--
-- notify_fixture_windows() writes both windows for both audiences, and returns
-- how many rows it wrote. The windows are half-open on the far side, so a game
-- is in exactly one of them or neither: 2d while tip-off is more than 44 and at
-- most 48 hours away, 2h while it is at most 2 hours away and still ahead. A
-- tick every minute writes a reminder within a minute of its window opening;
-- a game created inside a window gets that window's reminder at once, and one
-- created after it closes never gets it.
--
-- For each game in a window, two statements:
--   * the club and game followers: "Home v Away", and "In 2 days · Sat 19 Sep,
--     19:30 · venue" or "In 2 hours · tip-off 19:30 · venue";
--   * the player-only followers: every followed, rostered, not-withheld player
--     of the two squads, grouped per fan into one row — "Ben Baker has a game in
--     2 days", "Ben Baker and Yusef Salih play in 35 minutes".
-- Fixtures of a members-only league follow access_fixtures_public, as 0118's
-- notify_fixtures did: a public fixture is public, a private one is told only to
-- a fan who may view the league.
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
    insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
    select p.user_id, 'fixture',
           w.home_name || ' v ' || w.away_name,
           case when w.win = '2d' then 'In 2 days · ' || public.notif_when(w.tipoff_at)
                else v_until || ' · tip-off ' || v_tip end
             || coalesce(' · ' || w.venue, ''),
           v_link, w.league_id, w.id, v_ref, v_data, v_urgency, v_expires
      from fan_prefs p
     where ((p.want_fixtures and (w.home_team_id = any (p.fav_team_ids) or w.away_team_id = any (p.fav_team_ids)))
            or w.id = any (p.fav_game_ids))
       and case when w.win = '2d' then p.want_fixture_2d else p.want_fixture_2h end
       and (w.fixtures_public or public.can_view_league_for(p.user_id, w.league_id))
    on conflict (user_id, kind, ref) do nothing;
    get diagnostics c = row_count; n := n + c;

    -- the player-only followers: neither club nor the game, grouped per fan
    with fans as (
      select p.user_id, pl.id as player_id, btrim(pl.first_name || ' ' || pl.last_name) as name,
             pl.last_name, pl.first_name
        from (select distinct re.player_id
                from roster_entries re
               where re.active and re.team_id in (w.home_team_id, w.away_team_id)) sq
        join players pl on pl.id = sq.player_id
                       and not public.player_withheld(pl.is_minor, pl.public_consent)
        join fan_prefs p on pl.id = any (p.fav_player_ids)
       where p.want_fixtures and p.want_player_games
         and case when w.win = '2d' then p.want_fixture_2d else p.want_fixture_2h end
         and not (w.home_team_id = any (p.fav_team_ids) or w.away_team_id = any (p.fav_team_ids)
                  or w.id = any (p.fav_game_ids))
         and (w.fixtures_public or public.can_view_league_for(p.user_id, w.league_id))
    )
    insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
    select f.user_id, 'fixture',
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
     group by f.user_id
    on conflict (user_id, kind, ref) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- Kept for the ingest runner (scripts/ingest/run_ingest.py calls it after every
-- pass). The v1 refs, <game>:soon and <game>:today, are retired: rows already
-- written with them stay in the bell.
create or replace function public.notify_fixtures()
returns int language plpgsql security definer set search_path = public as $$
begin
  return public.notify_fixture_windows();
end $$;

-- ----------------------------------------------------------------------------
-- 5. THE STARTING LINEUPS (contract 1, 3)
--
-- notify_lineups(p_game) writes the lineups notice for every game, or the one
-- game given, whose two fives are confirmed, still scheduled or live, tipping
-- off between 30 minutes ago and 6 hours ahead. Called by the trigger below the
-- moment a scorer confirms the fives, and by the minute tick, which catches a
-- game whose fives were confirmed long before its window opened.
--
-- THE LINEUP comes from games.starters ([[home ids], [away ids]]), named from
-- players (the snapshot's names are lower-cased by the importer), numbered from
-- the roster snapshot, else the club's active roster entry. The bench is the
-- snapshot's other players, or, with no snapshot for that side, the club's
-- other active roster entries. A withheld player is "#12" in the body and has
-- neither id nor name in data; an id nobody can name (an ad-hoc game with no
-- snapshot) is "#?".
--
-- A GAME THAT CANNOT BE READ (a starter that is not a string or a number) is
-- refused with 22023. Asked about that one game, this function raises, and the
-- trigger swallows it. Sweeping, it skips that game with a warning and carries
-- on: one bad row must not silence every other game's lineups for good.
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
      insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, 'lineups',
             'Lineups are in: ' || g.home_label || ' v ' || g.away_label,
             g.home_label || ': ' || v_home_line || chr(10) || g.away_label || ': ' || v_away_line,
             v_link, g.league_id, g.id, v_ref, v_data, 'high', v_expires
        from fan_prefs p
       where (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)
              or g.id = any (p.fav_game_ids))
         and p.want_lineups
         and (not v_members_only or public.can_view_league_for(p.user_id, g.league_id))   -- 0118
      on conflict (user_id, kind, ref) do nothing;
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
        select p.user_id, sq.player_id, sq.name, sq.role, sq.side,
               row_number() over (partition by p.user_id
                                  order by (sq.role = 'starter') desc, sq.side, sq.ord, sq.name) as rn
          from sq
          join fan_prefs p on sq.player_id = any (p.fav_player_ids)
         where p.want_lineups and p.want_player_games
           and not (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)
                    or g.id = any (p.fav_game_ids))
           and (not v_members_only or public.can_view_league_for(p.user_id, g.league_id))   -- 0118
      )
      insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select f.user_id, 'lineups',
             f.name || case when f.role = 'starter' then ' starts for ' else ' is on the bench for ' end
               || case when f.side = 0 then g.home_name else g.away_name end,
             g.home_name || ' v ' || g.away_name || ' · tip-off ' || v_tip
               || coalesce(' · ' || (select string_agg(o.name || case when o.role = 'starter' then ' starts'
                                                                      else ' on the bench' end,
                                                       ', ' order by o.rn)
                                       from fans o
                                      where o.user_id = f.user_id and o.rn > 1), ''),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('players',
               (select jsonb_agg(jsonb_build_object('id', o.player_id, 'name', o.name, 'role', o.role) order by o.rn)
                  from fans o
                 where o.user_id = f.user_id)),
             'high', v_expires
        from fans f
       where f.rn = 1
      on conflict (user_id, kind, ref) do nothing;
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

/* THE TRIGGER NEVER BLOCKS THE WRITE. The starting fives are saved by a scorer
   claiming or priming a fixture (0116's list), usually minutes before tip-off
   and sometimes offline-queued; a notice that failed must never turn that save
   into an error. Everything, the completeness check included, runs inside a
   block whose handler only warns, and the minute tick sweeps the game again.
   Security definer, because the scorer's own role may not write notifications. */
create or replace function public.games_notify_lineups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if public.notif_starters_complete(new.starters) then
      perform public.notify_lineups(new.id);
    end if;
  exception when others then
    raise warning 'lineups notice for game % not written (%: %)', new.id, sqlstate, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists games_notify_lineups on public.games;
create trigger games_notify_lineups
  after update of starters on public.games
  for each row
  when (new.starters is distinct from old.starters)
  execute function public.games_notify_lineups();

-- ----------------------------------------------------------------------------
-- 6. FULL TIME (latest: 0118), with the v2 titles, data, urgency and expiry.
--
-- 0118's members-only rule is kept exactly: decided once for the game, so an
-- open league, or any league while memberships are switched off, never looks
-- anybody up. A player is named only when player_withheld says so (0049), not
-- merely when is_minor is false: a minor with recorded consent is named, as on
-- their public page.
-- ----------------------------------------------------------------------------
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

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, 'result', 'FT · ' || v_score, coalesce(comp, 'Final score'), v_link, lg, g.id, g.id::text,
         v_data, 'high', v_expires
    from fan_prefs p
   where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
          or g.id = any (p.fav_game_ids))
     and (not v_members_only or public.can_view_league_for(p.user_id, lg))   -- 0118
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, 'player',
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
    from fan_prefs p
    join players pl on pl.id = any (p.fav_player_ids)
                   and not public.player_withheld(pl.is_minor, pl.public_consent)
    join player_game_stats s on s.game_id = g.id and s.player_id = pl.id::text
   where p.want_players
     and (not v_members_only or public.can_view_league_for(p.user_id, lg))   -- 0118
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- 7. THE MINUTE TICK, ITS RECORD, AND ITS HEALTH (contract 3)
--
-- notify_ticks is one row (id 1): when the tick last ran, when it last called
-- the notify function, and what the last run did. RLS on and no policy: nothing
-- in it is anybody's business but the database's; notify_health reads it.
--
-- notify_tick() writes the two reminder windows and any lineups not yet sent,
-- then counts the rows waiting for a phone: not pushed yet, written in the last
-- three days (the notify function ignores older rows), not past their expiry,
-- for a fan with notify_push on. Only when there are any does it call notify, so
-- an idle platform makes no request at all. The call goes through pg_net, which
-- queues it and sends it after commit; the URL and the publishable key are the
-- ones epinoia/config.js already publishes. Without pg_net (the local harness,
-- or a project where it could not be created) the tick still writes and
-- records, and says net: false.
--
-- It is written as dynamic SQL behind to_regprocedure, so it compiles and runs
-- where net.http_post does not exist. Each step has its own handler: a failure
-- in one is recorded and the rest still run, because the tick is the only thing
-- that calls notify every minute.
-- ----------------------------------------------------------------------------
create table if not exists public.notify_ticks (
  id         smallint primary key default 1 check (id = 1),
  ran_at     timestamptz,
  called_at  timestamptz,
  request_id bigint,
  result     jsonb not null default '{}'::jsonb
);
alter table public.notify_ticks enable row level security;
revoke all on table public.notify_ticks from public, anon, authenticated;
alter table public.notify_ticks owner to postgres;

create or replace function public.notify_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fixtures int;
  v_lineups  int;
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

  select count(*) into v_waiting
    from (select 1
            from notifications n
            join fan_prefs p on p.user_id = n.user_id and p.notify_push
           where n.pushed_at is null
             and n.created_at >= now() - interval '3 days'
             and (n.expires_at is null or n.expires_at > now())
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

  v_result := jsonb_build_object('ran_at', now(), 'fixtures', v_fixtures, 'lineups', v_lineups,
                                 'waiting', v_waiting, 'net', v_net, 'called', v_called,
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

/* From outside, signed out: is the job scheduled, can the database call out,
   and when did the tick last run and last call notify. Four keys and no
   personal data, so a deploy can be checked with the publishable key. */
create or replace function public.notify_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cron   boolean := false;
  v_tick   timestamptz;
  v_called timestamptz;
begin
  if to_regclass('cron.job') is not null then
    begin
      execute 'select exists (select 1 from cron.job j where j.jobname = $1 and j.active)'
         into v_cron using 'epinoia-notify-tick'::text;
    exception when others then
      v_cron := false;
    end;
  end if;
  select t.ran_at, t.called_at into v_tick, v_called from notify_ticks t where t.id = 1;
  return jsonb_build_object(
    'cron', coalesce(v_cron, false),
    'net', to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null,
    'last_tick', v_tick,
    'last_called', v_called);
end $$;

-- ----------------------------------------------------------------------------
-- 8. A ROTATED PHONE SUBSCRIPTION (contract 3, 5)
--
-- A browser may replace a push subscription at any time; the service worker's
-- pushsubscriptionchange handler then holds the old endpoint and the new
-- subscription, and often no signed-in session. Knowing the old endpoint (an
-- unguessable URL the push service issued to that browser) is the credential:
-- only the row with that endpoint changes, and it keeps its owner. An unknown
-- endpoint answers false and changes nothing. When the new endpoint is already
-- registered (the page re-subscribed first), the old row is removed and the
-- registered one is left exactly as it is, whoever owns it.
-- ----------------------------------------------------------------------------
create or replace function public.swap_push_subscription(p_old text, p_endpoint text, p_p256dh text, p_auth text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or char_length(p_p256dh) > 400
     or coalesce(p_auth, '') = '' or char_length(p_auth) > 200 then
    raise exception 'a push subscription is an https endpoint and its two keys' using errcode = '22023';
  end if;
  if coalesce(p_old, '') = '' then
    return false;
  end if;

  select s.id into v_id from push_subscriptions s where s.endpoint = p_old for update;
  if not found then
    return false;
  end if;

  if p_endpoint <> p_old and exists (select 1 from push_subscriptions s where s.endpoint = p_endpoint) then
    delete from push_subscriptions s where s.id = v_id;
    return true;
  end if;

  begin
    update push_subscriptions s
       set endpoint = p_endpoint, p256dh = p_p256dh, auth = p_auth
     where s.id = v_id;
  exception when unique_violation then
    -- registered by the page between the check and the update
    delete from push_subscriptions s where s.id = v_id;
  end;
  return true;
end $$;

-- ----------------------------------------------------------------------------
-- 9. GRANTS AND OWNERSHIP
--
-- Postgres grants EXECUTE to PUBLIC on every new function and Supabase adds
-- anon and authenticated by default privileges in public, so every function
-- says who may call it, and the self-test reads it back. Everything is pinned
-- to postgres: the CLI applies migrations through a temporary login role (0115).
-- ----------------------------------------------------------------------------
revoke all on function public.set_fan_prefs(jsonb) from public, anon;
grant execute on function public.set_fan_prefs(jsonb) to authenticated;

revoke all on function public.notif_when(timestamptz) from public, anon, authenticated;
revoke all on function public.notif_until(timestamptz) from public, anon, authenticated;
revoke all on function public.notif_num(jsonb, text) from public, anon, authenticated;
revoke all on function public.notif_statline(jsonb) from public, anon, authenticated;
revoke all on function public.notif_statline_more(jsonb) from public, anon, authenticated;
revoke all on function public.notif_names(text[]) from public, anon, authenticated;
revoke all on function public.notif_team_label(text, text) from public, anon, authenticated;
revoke all on function public.notif_starters_complete(jsonb) from public, anon, authenticated;
grant execute on function public.notif_when(timestamptz) to service_role;
grant execute on function public.notif_until(timestamptz) to service_role;
grant execute on function public.notif_num(jsonb, text) to service_role;
grant execute on function public.notif_statline(jsonb) to service_role;
grant execute on function public.notif_statline_more(jsonb) to service_role;
grant execute on function public.notif_names(text[]) to service_role;
grant execute on function public.notif_team_label(text, text) to service_role;
grant execute on function public.notif_starters_complete(jsonb) to service_role;

-- the fan-outs and the tick: the service role (finalise-game, the ingest runner) and pg_cron's postgres
revoke all on function public.notify_fixture_windows() from public, anon, authenticated;
revoke all on function public.notify_fixtures() from public, anon, authenticated;
revoke all on function public.notify_lineups(uuid) from public, anon, authenticated;
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;
revoke all on function public.notify_tick() from public, anon, authenticated;
revoke all on function public.games_notify_lineups() from public, anon, authenticated;
grant execute on function public.notify_fixture_windows() to service_role;
grant execute on function public.notify_fixtures() to service_role;
grant execute on function public.notify_lineups(uuid) to service_role;
grant execute on function public.notify_game_final(uuid) to service_role;
grant execute on function public.notify_tick() to service_role;

-- signed out as well as signed in
revoke all on function public.notify_health() from public;
grant execute on function public.notify_health() to anon, authenticated, service_role;
revoke all on function public.swap_push_subscription(text, text, text, text) from public;
grant execute on function public.swap_push_subscription(text, text, text, text) to anon, authenticated, service_role;

alter function public.set_fan_prefs(jsonb) owner to postgres;
alter function public.notif_when(timestamptz) owner to postgres;
alter function public.notif_until(timestamptz) owner to postgres;
alter function public.notif_num(jsonb, text) owner to postgres;
alter function public.notif_statline(jsonb) owner to postgres;
alter function public.notif_statline_more(jsonb) owner to postgres;
alter function public.notif_names(text[]) owner to postgres;
alter function public.notif_team_label(text, text) owner to postgres;
alter function public.notif_starters_complete(jsonb) owner to postgres;
alter function public.notify_fixture_windows() owner to postgres;
alter function public.notify_fixtures() owner to postgres;
alter function public.notify_lineups(uuid) owner to postgres;
alter function public.games_notify_lineups() owner to postgres;
alter function public.notify_game_final(uuid) owner to postgres;
alter function public.notify_tick() owner to postgres;
alter function public.notify_health() owner to postgres;
alter function public.swap_push_subscription(text, text, text, text) owner to postgres;

-- ============================================================================
-- SELF-TEST 1 — the catalogue, every phrase, and who can call what.
--
-- Always, whatever role runs this file: the columns, the two checks and the
-- partial index; the four switches default on; the trigger is AFTER UPDATE OF
-- starters, per row; notify_ticks has RLS, no policy, no browser privilege and
-- one row at most; every new function is owned by postgres with a pinned
-- search_path, the fan-outs and the tick are definers closed to both browser
-- roles (and to PUBLIC), notify_health and swap_push_subscription are open to
-- both, set_fan_prefs to signed-in callers only. Then the helpers against
-- fixed inputs, exactly. Then, rolled back: a tick as the owner returns its
-- keys and stamps notify_ticks; a signed-in caller is refused the tick; signed
-- out, notify_health returns exactly its four keys, and an unknown endpoint is
-- not swapped.
--
-- The rolled-back part is the P0115 pattern: switch back to the captured role
-- (never RESET ROLE), end by raising a private code the handler swallows.
-- ============================================================================
do $test$
declare
  who     text := current_user || ' (session ' || session_user || ')';
  orig    text := current_user;
  f       text;
  v_txt   text;
  v_j     jsonb;
  v_n     bigint;
  v_b     boolean;
begin
  -- ---- the columns, checks and index ------------------------------------------
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.notifications'::regclass and not a.attisdropped
         and ((a.attname = 'data' and a.atttypid = 'jsonb'::regtype and a.attnotnull)
           or (a.attname = 'expires_at' and a.atttypid = 'timestamptz'::regtype and not a.attnotnull)
           or (a.attname = 'urgency' and a.atttypid = 'text'::regtype and a.attnotnull))) <> 3 then
    raise exception '0121: notifications is missing data (jsonb not null), expires_at (timestamptz) or urgency (text not null)';
  end if;
  if (select count(*) from pg_constraint k
       where k.conrelid = 'public.notifications'::regclass and k.contype = 'c'
         and k.conname in ('notifications_kind_check', 'notifications_urgency_check') and k.convalidated) <> 2 then
    raise exception '0121: the kind or the urgency check is missing on notifications';
  end if;
  if not exists (select 1 from pg_index i
                  where i.indrelid = 'public.notifications'::regclass
                    and pg_get_expr(i.indpred, i.indrelid) = '(pushed_at IS NULL)') then
    raise exception '0121: no partial index on undelivered notifications (pushed_at is null)';
  end if;
  if (select count(*) from pg_attribute a
        join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'public.fan_prefs'::regclass and not a.attisdropped and a.attnotnull
         and a.atttypid = 'boolean'::regtype
         and a.attname in ('want_fixture_2d', 'want_fixture_2h', 'want_lineups', 'want_player_games')
         and pg_get_expr(d.adbin, d.adrelid) = 'true') <> 4 then
    raise exception '0121: fan_prefs needs want_fixture_2d, want_fixture_2h, want_lineups and want_player_games, boolean, not null, default true';
  end if;

  -- ---- the trigger ---------------------------------------------------------------
  if not exists (
       select 1 from pg_trigger tg
        where tg.tgrelid = 'public.games'::regclass and tg.tgname = 'games_notify_lineups' and not tg.tgisinternal
          and tg.tgfoid = 'public.games_notify_lineups()'::regprocedure
          and tg.tgenabled <> 'D'
          and (tg.tgtype & 1) = 1          -- per row
          and (tg.tgtype & 2) = 0          -- not before
          and (tg.tgtype & 64) = 0         -- not instead of
          and (tg.tgtype & 16) = 16        -- update
          and (tg.tgtype & (4 | 8 | 32)) = 0
          and (select a.attnum from pg_attribute a
                where a.attrelid = 'public.games'::regclass and a.attname = 'starters') = any (tg.tgattr::int2[])) then
    raise exception '0121: games has no AFTER UPDATE OF starters row trigger calling games_notify_lineups';
  end if;

  -- ---- notify_ticks ------------------------------------------------------------------
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.notify_ticks'::regclass)
     or exists (select 1 from pg_policy pol where pol.polrelid = 'public.notify_ticks'::regclass)
     or exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                 where c.oid = 'public.notify_ticks'::regclass
                   and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole))
     or (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.notify_ticks'::regclass) <> 'postgres' then
    raise exception '0121: notify_ticks must have RLS on, no policy, no PUBLIC or browser privilege, and postgres as owner';
  end if;

  -- ---- the functions ---------------------------------------------------------------
  foreach f in array array['notify_fixture_windows()', 'notify_fixtures()', 'notify_lineups(uuid)',
                           'notify_game_final(uuid)', 'notify_tick()', 'notify_health()',
                           'swap_push_subscription(text,text,text,text)', 'games_notify_lineups()'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = ('public.' || f)::regprocedure and p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'postgres'
                      and p.proconfig @> array['search_path=public']) then
      raise exception '0121: % must be security definer, owned by postgres, with search_path pinned to public', f;
    end if;
  end loop;
  foreach f in array array['notif_when(timestamptz)', 'notif_until(timestamptz)', 'notif_num(jsonb,text)',
                           'notif_statline(jsonb)', 'notif_statline_more(jsonb)', 'notif_names(text[])',
                           'notif_team_label(text,text)', 'notif_starters_complete(jsonb)', 'set_fan_prefs(jsonb)'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = ('public.' || f)::regprocedure and not p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'postgres'
                      and p.proconfig @> array['search_path=public']) then
      raise exception '0121: % must be owned by postgres, run as its caller, with search_path pinned to public', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p
              where p.oid in ('public.notif_when(timestamptz)'::regprocedure, 'public.notif_until(timestamptz)'::regprocedure,
                              'public.notif_num(jsonb,text)'::regprocedure, 'public.notif_statline(jsonb)'::regprocedure,
                              'public.notif_statline_more(jsonb)'::regprocedure, 'public.notif_names(text[])'::regprocedure,
                              'public.notif_team_label(text,text)'::regprocedure,
                              'public.notif_starters_complete(jsonb)'::regprocedure)
                and p.provolatile = 'v') then
    raise exception '0121: a wording helper is volatile; they are immutable or stable';
  end if;

  foreach f in array array['notify_fixture_windows()', 'notify_fixtures()', 'notify_lineups(uuid)',
                           'notify_game_final(uuid)', 'notify_tick()', 'games_notify_lineups()',
                           'notif_when(timestamptz)', 'notif_until(timestamptz)', 'notif_num(jsonb,text)',
                           'notif_statline(jsonb)', 'notif_statline_more(jsonb)', 'notif_names(text[])',
                           'notif_team_label(text,text)', 'notif_starters_complete(jsonb)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute')
       or has_function_privilege('authenticated', 'public.' || f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = ('public.' || f)::regprocedure and a.grantee = 0) then
      raise exception '0121: % is callable from a browser (or by PUBLIC)', f;
    end if;
  end loop;
  foreach f in array array['notify_fixture_windows()', 'notify_fixtures()', 'notify_lineups(uuid)',
                           'notify_game_final(uuid)', 'notify_tick()'] loop
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0121: the service role cannot call % (finalise-game and the ingest runner do)', f;
    end if;
  end loop;
  foreach f in array array['notify_health()', 'swap_push_subscription(text,text,text,text)'] loop
    if not has_function_privilege('anon', 'public.' || f, 'execute')
       or not has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0121: % must be callable signed out and signed in', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.set_fan_prefs(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_fan_prefs(jsonb)', 'execute') then
    raise exception '0121: set_fan_prefs is for signed-in callers only';
  end if;

  -- ---- the phrases, exactly ------------------------------------------------------------
  if public.notif_when(timestamptz '2026-09-19 19:30 Europe/London') is distinct from 'Sat 19 Sep, 19:30'
     or public.notif_when(timestamptz '2026-12-05 09:05 Europe/London') is distinct from 'Sat 5 Dec, 09:05'
     or public.notif_when(timestamptz '2026-03-29 18:00 Europe/London') is distinct from 'Sun 29 Mar, 18:00'
     or public.notif_when(null) is not null then
    raise exception '0121: notif_when says %, % and % (want Sat 19 Sep, 19:30 / Sat 5 Dec, 09:05 / Sun 29 Mar, 18:00, London time)',
      public.notif_when(timestamptz '2026-09-19 19:30 Europe/London'),
      public.notif_when(timestamptz '2026-12-05 09:05 Europe/London'),
      public.notif_when(timestamptz '2026-03-29 18:00 Europe/London');
  end if;

  select string_agg(format('%s -> %s (want %s)', x.gap, public.notif_until(now() + x.gap), x.want), '; ')
    into v_txt
    from (values (interval '2 hours',               'In 2 hours'),
                 (interval '119 minutes 40 seconds', 'In 2 hours'),
                 (interval '91 minutes',             'In 2 hours'),
                 (interval '90 minutes',             'In 1 hour'),
                 (interval '60 minutes',             'In 1 hour'),
                 (interval '59 minutes 40 seconds',  'In 1 hour'),
                 (interval '59 minutes 20 seconds',  'In 59 minutes'),
                 (interval '35 minutes',             'In 35 minutes'),
                 (interval '1 minute',               'In 1 minute'),
                 (interval '10 seconds',             'In 1 minute'),
                 (interval '5 hours',                'In 5 hours'),
                 (interval '47 hours',               'In 2 days'),
                 (interval '-1 minute',              'Now')) as x(gap, want)
   where public.notif_until(now() + x.gap) is distinct from x.want;
  if v_txt is not null then
    raise exception '0121: notif_until: %', v_txt;
  end if;

  select string_agg(format('%s -> [%s] (want [%s])', x.p, x.got, x.want), '; ')
    into v_txt
    from (select v.p, v.want, v.fn,
                 case v.fn when 'statline' then public.notif_statline(v.p)
                           else public.notif_statline_more(v.p) end as got
            from (values ('statline', '{"pts":23,"or":2,"dr":4,"ast":5,"stl":0,"blk":0}'::jsonb, '23 PTS · 6 REB · 5 AST'),
                         ('statline', '{"pts":23,"or":2,"dr":4,"ast":5,"stl":2}'::jsonb,         '23 PTS · 6 REB · 5 AST · 2 STL'),
                         ('statline', '{"pts":23,"or":2,"dr":4,"ast":5,"stl":2,"blk":3}'::jsonb, '23 PTS · 6 REB · 5 AST · 2 STL · 3 BLK'),
                         ('statline', '{"pts":0,"blk":1}'::jsonb,                                '0 PTS · 0 REB · 0 AST · 1 BLK'),
                         ('statline', '{}'::jsonb,                                               '0 PTS · 0 REB · 0 AST'),
                         ('statline', '{"pts":"23","ast":null}'::jsonb,                          '0 PTS · 0 REB · 0 AST'),
                         ('more', '{"p2m":6,"p2a":14,"p3m":2,"p3a":6,"ftm":5,"fta":6,"min":1920000}'::jsonb, '8/20 FG · 32 MIN'),
                         ('more', '{"p2m":0,"p2a":3,"min":20000}'::jsonb,                        '0/3 FG'),
                         ('more', '{"min":1950000}'::jsonb,                                      '33 MIN'),
                         ('more', '{"ftm":4,"fta":4}'::jsonb,                                    ''),
                         ('more', '{}'::jsonb,                                                   '')) as v(fn, p, want)) x
   where x.got is distinct from x.want;
  if v_txt is not null then
    raise exception '0121: notif_statline / notif_statline_more: %', v_txt;
  end if;

  if public.notif_names(array['Ben Baker']) is distinct from 'Ben Baker'
     or public.notif_names(array['Ben Baker', 'Yusef Salih']) is distinct from 'Ben Baker and Yusef Salih'
     or public.notif_names(array['A', 'B', 'C']) is distinct from 'A, B and C'
     or public.notif_names(array['A', 'B', 'C', 'D', 'E']) is distinct from 'A, B and 3 others'
     or public.notif_names('{}'::text[]) is distinct from '' then
    raise exception '0121: notif_names does not list names as "A", "A and B", "A, B and C", "A, B and 3 others"';
  end if;
  if public.notif_team_label('Reading Rockets', 'Rockets') is distinct from 'Rockets'
     or public.notif_team_label('Neon City', 'NC') is distinct from 'Neon City'
     or public.notif_team_label('London Lions', 'LON') is distinct from 'London Lions'
     or public.notif_team_label('East Dock', '') is distinct from 'East Dock'
     or public.notif_team_label('East Dock', null) is distinct from 'East Dock' then
    raise exception '0121: notif_team_label must use a short name that reads as a name, and the full name for a code or nothing';
  end if;

  select string_agg(format('%s -> %s', x.p, public.notif_starters_complete(x.p)), '; ')
    into v_txt
    from (values ('[["a","b","c","d","e"],["f","g","h","i","j"]]'::jsonb, true),
                 ('[["a","b","c","d","e","k"],["f","g","h","i","j"]]'::jsonb, true),
                 ('[[1,2,3,4,5],[6,7,8,9,10]]'::jsonb, true),
                 ('[["a","b","c","d"],["f","g","h","i","j"]]'::jsonb, false),
                 ('[["a","b","c","d","e"],["f","g","h","i"]]'::jsonb, false),
                 ('[["a","b","c","d","e"]]'::jsonb, false),
                 ('[[],[]]'::jsonb, false),
                 ('{"0":["a","b","c","d","e"],"1":["f","g","h","i","j"]}'::jsonb, false),
                 ('"abcde"'::jsonb, false),
                 (null::jsonb, false)) as x(p, want)
   where public.notif_starters_complete(x.p) is distinct from x.want;
  if v_txt is not null then
    raise exception '0121: notif_starters_complete: %', v_txt;
  end if;

  -- ---- rolled back: the tick, the health, a stranger's swap ------------------------------
  begin
    v_j := public.notify_tick();
    if jsonb_typeof(v_j) <> 'object'
       or not (v_j ?& array['ran_at', 'fixtures', 'lineups', 'waiting', 'net', 'called', 'request_id', 'errors'])
       or (v_j->>'net')::boolean is distinct from (to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null)
       or ((v_j->>'called')::boolean and not (v_j->>'net')::boolean)
       or v_j->'errors' is distinct from '[]'::jsonb then
      raise exception '0121: notify_tick returned %', v_j;
    end if;
    if not exists (select 1 from public.notify_ticks t where t.id = 1 and t.ran_at = now() and t.result = v_j) then
      raise exception '0121: notify_tick did not record its run in notify_ticks';
    end if;
    begin
      insert into public.notify_ticks (id) values (2);
      raise exception '0121: notify_ticks took a second row';
    exception when check_violation then null;
    end;

    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    foreach f in array array['select public.notify_tick()', 'select public.notify_fixture_windows()',
                             'select public.notify_fixtures()', 'select public.notify_lineups(null)',
                             format('select public.notify_game_final(%L::uuid)', gen_random_uuid()),
                             'select 1 from public.notify_ticks'] loop
      begin
        execute f;
        raise exception '0121: signed in, this ran: %', f;
      exception when insufficient_privilege then null;
      end;
    end loop;
    execute format('set local role %I', orig);

    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    v_j := public.notify_health();
    v_b := public.swap_push_subscription('https://push.example.invalid/t121/nobody',
                                         'https://push.example.invalid/t121/new', 'k', 'a');
    execute format('set local role %I', orig);
    if (select array_agg(k order by k) from jsonb_object_keys(v_j) k) is distinct from array['cron', 'last_called', 'last_tick', 'net']
       or (v_j->>'last_tick')::timestamptz is distinct from now()
       or (v_j->>'net')::boolean is distinct from (to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null) then
      raise exception '0121: signed out, notify_health returned %', v_j;
    end if;
    if v_b then
      raise exception '0121: an unknown endpoint was swapped';
    end if;

    raise exception using errcode = 'P0121', message = '0121 (1/2) rolled-back half done';
  exception
    when sqlstate 'P0121' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  raise notice '0121 ok (1/2): columns, checks, index, switches and trigger in place; notify_ticks closed; the fan-outs and the tick closed to browsers, notify_health and the swap open; every phrase exact (when, until, statline, names, team label, fives)';
end $test$;

-- ============================================================================
-- SELF-TEST 2 — every moment, for every kind of follower (contract 1).
--
-- Seeded with the migration's own rights: an open league (Reading Rockets v
-- London Lions, one withheld minor, a bench, an inactive roster entry) and a
-- members-only league with private fixtures (Members Home v Members Away), and
-- these games:
--   g47 +47h, g90 +90 min, g5h +5h, g150 +150 min, g43 +43h30, g49 +48h30   (reminders)
--   glu +3h with a roster snapshot, glive live since 20 min, gold live since 40 min,
--   glate +7h, g4 +3h (one four), gbad +3h (a starter that is not an id)      (lineups)
--   gfinal final 96-95 with box-score lines                                   (full time)
--   gm90 +90 min, gmlu +3h (no snapshot, ad-hoc ids), gmfinal final 70-60     (members only)
-- and eight fans:
--   T    follows Reading Rockets and Members Home (a stranger to the members league)
--   G    follows the games g47 g90 g5h glu gm90 gmlu gfinal gmfinal and the player Max
--        Member, and holds a subscription to the members league
--   D    follows Reading Rockets and Ben Baker
--   P    follows Ben Baker
--   P2   follows Ben Baker, Yusef Salih, the minor and Max Member
--   N2d  follows Reading Rockets, with want_fixture_2d off
--   NPG  follows Ben Baker, with want_player_games off
--   PM   follows the minor and a player whose roster entry is inactive
--
-- With memberships switched ON (0118's way), it proves, as whole sets of
-- (fan, ref, title, body) per kind — nothing missing and nothing extra:
--   * notify_fixture_windows writes exactly the reminders (club-style for T, G,
--     D, N2d; grouped player-style for P and P2; nothing for NPG, PM, the
--     private members fixture for T, or g5h, g150, g43, g49), with their data,
--     urgency, expiry and link; a second run writes 0; notify_fixtures too;
--   * confirming the fives (the trigger, one UPDATE each) writes exactly the
--     lineups, the minor as #12, surnames from players, the bench from the
--     snapshot or the roster; g4, glate and gold write nothing; gbad's UPDATE
--     commits while notify_lineups(gbad) itself raises 22023, and the sweep
--     skips it; a second sweep writes 0;
--   * notify_game_final writes "FT · Home h–a Away" and the statline, with
--     data, urgency and expiry; a second call writes 0;
-- then with memberships OFF, T and P2 are told the members league's fixture,
-- lineups, result and statline; the minor is never named anywhere; the kinds
-- and urgencies are checked by inserting them; set_fan_prefs takes the four
-- keys and still clears a list on []; notify_tick, without pg_net and then with
-- a stand-in net.http_post, calls out exactly when a push is waiting (not for
-- an expired row, nor one older than three days) with the right URL, headers
-- and body; signed out, notify_health reports the stand-in and the last call;
-- swap_push_subscription changes only the matching row.
--
-- Accounts are created fresh where this role may create auth.users rows, and
-- otherwise borrowed from profiles holding no role, writer seat, official's
-- seat or subscription (0117, 0118); a notice says which. All of it rolls back
-- (P0115 pattern); refusals are caught by SQLSTATE only.
-- ============================================================================
do $test$
declare
  who        text := current_user || ' (session ' || session_user || ')';
  orig       text := current_user;
  half       text := 'fresh test accounts';
  net_half   text := 'the stand-in net.http_post';
  have_users boolean := true;
  borrowed   uuid[];
  u_t   uuid := gen_random_uuid();  u_g   uuid := gen_random_uuid();
  u_d   uuid := gen_random_uuid();  u_p   uuid := gen_random_uuid();
  u_p2  uuid := gen_random_uuid();  u_n2d uuid := gen_random_uuid();
  u_npg uuid := gen_random_uuid();  u_pm  uuid := gen_random_uuid();
  lg_open uuid; lg_mem uuid; se_open uuid; se_mem uuid; cp_open uuid; cp_mem uuid;
  t_h uuid; t_a uuid; t_mh uuid; t_ma uuid;
  pl_baker uuid; pl_cole uuid; pl_diaz uuid; pl_eze uuid; pl_kid uuid; pl_fox uuid; pl_old uuid;
  pl_ash uuid; pl_bell uuid; pl_cobb uuid; pl_dunn uuid; pl_east uuid; pl_salih uuid;
  pl_max uuid; pl_one uuid; pl_two uuid; pl_three uuid; pl_four uuid;
  g47 uuid; g90 uuid; g5h uuid; g150 uuid; g43 uuid; g49 uuid;
  glu uuid; glive uuid; gold uuid; glate uuid; g4 uuid; gbad uuid; gfinal uuid;
  gm90 uuid; gmlu uuid; gmfinal uuid;
  t47 timestamptz := now() + interval '47 hours';
  t90 timestamptz := now() + interval '90 minutes';
  tlu timestamptz := now() + interval '3 hours';
  tlive timestamptz := now() - interval '20 minutes';
  v_users    uuid[];
  v_games    uuid[];
  v_labels   jsonb;
  v_exp      jsonb;
  v_actual   jsonb;
  v_stage    text;
  v_kind     text;
  v_txt      text;
  v_j        jsonb;
  v_n        bigint;
  v_m        bigint;
  v_b        boolean;
  v_bad      jsonb := '[["x",{"not":"an id"},"y","z","w"],["a","b","c","d","e"]]'::jsonb;
  v_five_h   jsonb;
  v_five_a   jsonb;
  v_club     text := 'Reading Rockets v London Lions';
  v_w47      text;
  v_h90      text;
  v_hlu      text;
  v_hlive    text;
  v_lu_title text := 'Lineups are in: Rockets v Lions';
  v_lu_body  text;
  v_ml_body  text;
  v_before   jsonb;
  v_after    jsonb;
  s_a uuid; s_b uuid; s_c uuid;
  v_rows_sql text := $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'who', $2 ->> n.user_id::text,
             'ref', coalesce($2 ->> split_part(n.ref, ':', 1), split_part(n.ref, ':', 1))
                    || case when strpos(n.ref, ':') > 0
                            then ':' || coalesce($2 ->> split_part(n.ref, ':', 2), split_part(n.ref, ':', 2))
                            else '' end,
             'title', n.title,
             'body', n.body)), '[]'::jsonb)
      from public.notifications n
     where n.user_id = any ($1) and n.kind = $3 and n.game_id = any ($4)
  $q$;
  v_diff_sql text := $q$
    select string_agg(z.d, '; ' order by z.d)
      from (select 'UNEXPECTED ' || u.value::text as d
              from (select value from jsonb_array_elements($1)
                    except all
                    select value from jsonb_array_elements($2)) u
            union all
            select 'MISSING ' || m.value::text
              from (select value from jsonb_array_elements($2)
                    except all
                    select value from jsonb_array_elements($1)) m) z
  $q$;
begin
  begin
    -- ============================================================ seeded as the owner
    insert into leagues (slug, name) values ('zz-t121-open', '0121 Open') returning id into lg_open;
    insert into leagues (slug, name, access_mode, access_fixtures_public)
      values ('zz-t121-members', '0121 Members', 'members', false) returning id into lg_mem;
    insert into seasons (league_id, name) values (lg_open, '0121') returning id into se_open;
    insert into seasons (league_id, name) values (lg_mem, '0121') returning id into se_mem;
    insert into competitions (season_id, name) values (se_open, 'T121 Cup') returning id into cp_open;
    insert into competitions (season_id, name) values (se_mem, 'T121 Members League') returning id into cp_mem;

    insert into teams (league_id, slug, name, short_name) values (lg_open, 'zz-t121-rockets', 'Reading Rockets', 'Rockets') returning id into t_h;
    insert into teams (league_id, slug, name, short_name) values (lg_open, 'zz-t121-lions', 'London Lions', 'Lions') returning id into t_a;
    insert into teams (league_id, slug, name, short_name) values (lg_mem, 'zz-t121-mhome', 'Members Home', '') returning id into t_mh;
    insert into teams (league_id, slug, name, short_name) values (lg_mem, 'zz-t121-maway', 'Members Away', 'MA') returning id into t_ma;

    insert into players (slug, first_name, last_name) values ('zz-t121-baker', 'Ben', 'Baker') returning id into pl_baker;
    insert into players (slug, first_name, last_name) values ('zz-t121-cole', 'Tom', 'Cole') returning id into pl_cole;
    insert into players (slug, first_name, last_name) values ('zz-t121-diaz', 'Dan', 'Diaz') returning id into pl_diaz;
    insert into players (slug, first_name, last_name) values ('zz-t121-eze', 'Eli', 'Eze') returning id into pl_eze;
    insert into players (slug, first_name, last_name, is_minor) values ('zz-t121-kid', 'Kiddo', 'Younger', true) returning id into pl_kid;
    insert into players (slug, first_name, last_name) values ('zz-t121-fox', 'Sam', 'Fox') returning id into pl_fox;
    insert into players (slug, first_name, last_name) values ('zz-t121-old', 'Olly', 'Gone') returning id into pl_old;
    insert into players (slug, first_name, last_name) values ('zz-t121-ash', 'Al', 'Ash') returning id into pl_ash;
    insert into players (slug, first_name, last_name) values ('zz-t121-bell', 'Bo', 'Bell') returning id into pl_bell;
    insert into players (slug, first_name, last_name) values ('zz-t121-cobb', 'Cy', 'Cobb') returning id into pl_cobb;
    insert into players (slug, first_name, last_name) values ('zz-t121-dunn', 'Di', 'Dunn') returning id into pl_dunn;
    insert into players (slug, first_name, last_name) values ('zz-t121-east', 'Ed', 'East') returning id into pl_east;
    insert into players (slug, first_name, last_name) values ('zz-t121-salih', 'Yusef', 'Salih') returning id into pl_salih;
    insert into players (slug, first_name, last_name) values ('zz-t121-max', 'Max', 'Member') returning id into pl_max;
    insert into players (slug, first_name, last_name) values ('zz-t121-one', 'Mo', 'One') returning id into pl_one;
    insert into players (slug, first_name, last_name) values ('zz-t121-two', 'Mo', 'Two') returning id into pl_two;
    insert into players (slug, first_name, last_name) values ('zz-t121-three', 'Mo', 'Three') returning id into pl_three;
    insert into players (slug, first_name, last_name) values ('zz-t121-four', 'Mo', 'Four') returning id into pl_four;

    insert into roster_entries (team_id, player_id, season_id, jersey, active) values
      (t_h, pl_baker, se_open, '4', true), (t_h, pl_cole, se_open, '5', true), (t_h, pl_diaz, se_open, '6', true),
      (t_h, pl_eze, se_open, '7', true), (t_h, pl_kid, se_open, '12', true), (t_h, pl_fox, se_open, '9', true),
      (t_h, pl_old, se_open, '15', false),
      (t_a, pl_ash, se_open, '4', true), (t_a, pl_bell, se_open, '5', true), (t_a, pl_cobb, se_open, '6', true),
      (t_a, pl_dunn, se_open, '7', true), (t_a, pl_east, se_open, '8', true), (t_a, pl_salih, se_open, '10', true),
      (t_mh, pl_max, se_mem, '1', true), (t_mh, pl_one, se_mem, '2', true), (t_mh, pl_two, se_mem, '3', true),
      (t_mh, pl_three, se_mem, '4', true), (t_mh, pl_four, se_mem, '5', true);

    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, venue)
      values (cp_open, t_h, t_a, t47, 'scheduled', 'Archers Arena') returning id into g47;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, venue)
      values (cp_open, t_h, t_a, t90, 'scheduled', 'Archers Arena') returning id into g90;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() + interval '5 hours', 'scheduled') returning id into g5h;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() + interval '150 minutes', 'scheduled') returning id into g150;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() + interval '43 hours 30 minutes', 'scheduled') returning id into g43;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() + interval '48 hours 30 minutes', 'scheduled') returning id into g49;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, roster_snapshot)
      values (cp_open, t_h, t_a, tlu, 'scheduled', jsonb_build_object('teams', jsonb_build_array(
        jsonb_build_object('name', 'reading rockets', 'color', '#93f2bf', 'players', jsonb_build_array(
          jsonb_build_object('id', pl_baker, 'name', 'ben baker', 'num', '4'),
          jsonb_build_object('id', pl_cole, 'name', 'tom cole', 'num', '5'),
          jsonb_build_object('id', pl_diaz, 'name', 'dan diaz', 'num', '6'),
          jsonb_build_object('id', pl_eze, 'name', 'eli eze', 'num', '7'),
          jsonb_build_object('id', pl_kid, 'name', 'kiddo younger', 'num', '12'),
          jsonb_build_object('id', pl_fox, 'name', 'sam fox', 'num', '9'))),
        jsonb_build_object('name', 'london lions', 'color', '#8ff5ff', 'players', jsonb_build_array(
          jsonb_build_object('id', pl_ash, 'name', 'al ash', 'num', '4'),
          jsonb_build_object('id', pl_bell, 'name', 'bo bell', 'num', '5'),
          jsonb_build_object('id', pl_cobb, 'name', 'cy cobb', 'num', '6'),
          jsonb_build_object('id', pl_dunn, 'name', 'di dunn', 'num', '7'),
          jsonb_build_object('id', pl_east, 'name', 'ed east', 'num', '8'),
          jsonb_build_object('id', pl_salih, 'name', 'yusef salih', 'num', '10'))))))
      returning id into glu;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, tlive, 'live') returning id into glive;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '40 minutes', 'live') returning id into gold;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() + interval '7 hours', 'scheduled') returning id into glate;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, tlu, 'scheduled') returning id into g4;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, tlu, 'scheduled') returning id into gbad;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp_open, t_h, t_a, now() - interval '2 hours', 'final', 96, 95) returning id into gfinal;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_mem, t_mh, t_ma, t90, 'scheduled') returning id into gm90;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_mem, t_mh, t_ma, tlu, 'scheduled') returning id into gmlu;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp_mem, t_mh, t_ma, now() - interval '3 hours', 'final', 70, 60) returning id into gmfinal;

    insert into player_game_stats (game_id, player_id, team_idx, stats) values
      (gfinal, pl_baker::text, 0, '{"pts":23,"or":2,"dr":4,"ast":5,"stl":0,"blk":0,"p2m":6,"p2a":14,"p3m":2,"p3a":6,"ftm":5,"fta":6,"min":1920000,"to":3,"pf":2}'::jsonb),
      (gfinal, pl_kid::text, 0, '{"pts":10,"or":1,"dr":1,"ast":2,"p2m":5,"p2a":8,"min":900000}'::jsonb),
      (gmfinal, pl_max::text, 0, '{"pts":12,"or":1,"dr":2,"ast":1,"stl":2,"blk":0,"p2m":4,"p2a":7,"p3m":1,"p3a":2,"min":1500000}'::jsonb);

    v_five_h := jsonb_build_array(pl_baker, pl_cole, pl_diaz, pl_kid, pl_eze);
    v_five_a := jsonb_build_array(pl_ash, pl_bell, pl_cobb, pl_dunn, pl_east);
    v_games  := array[g47, g90, g5h, g150, g43, g49, glu, glive, gold, glate, g4, gbad, gfinal, gm90, gmlu, gmfinal];
    v_w47    := to_char(t47 at time zone 'Europe/London', 'Dy FMDD Mon, HH24:MI');
    v_h90    := to_char(t90 at time zone 'Europe/London', 'HH24:MI');
    v_hlu    := to_char(tlu at time zone 'Europe/London', 'HH24:MI');
    v_hlive  := to_char(tlive at time zone 'Europe/London', 'HH24:MI');
    v_lu_body := 'Rockets: Baker, Cole, Diaz, #12, Eze' || chr(10) || 'Lions: Ash, Bell, Cobb, Dunn, East';
    v_ml_body := 'Members Home: Member, One, Two, Three, Four' || chr(10) || 'Members Away: #?, #?, #?, #?, #?';

    if public.memberships_enabled() then
      raise exception '0121: memberships are switched on before the self-test switched them on; 0117 ships them off';
    end if;
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
    if not found or not public.memberships_enabled() then
      raise exception '0121: could not switch memberships on for the self-test';
    end if;

    -- ---- the accounts: fresh, or borrowed ----------------------------------
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_t,   't121-t@example.invalid'),   (u_g,   't121-g@example.invalid'),
                     (u_d,   't121-d@example.invalid'),   (u_p,   't121-p@example.invalid'),
                     (u_p2,  't121-p2@example.invalid'),  (u_n2d, 't121-n2d@example.invalid'),
                     (u_npg, 't121-npg@example.invalid'), (u_pm,  't121-pm@example.invalid')) as x(id, email);
    exception when insufficient_privilege then
      have_users := false;
    end;

    if not have_users then
      /* borrowed for the length of a rolled-back block; nothing below is committed */
      select array_agg(x.id) into borrowed
        from (select p.id from public.profiles p
               where not exists (select 1 from public.memberships m where m.user_id = p.id)
                 and not exists (select 1 from public.league_writers lw where lw.user_id = p.id)
                 and not exists (select 1 from public.game_officials go where go.user_id = p.id)
                 and not exists (select 1 from public.access_subscriptions a where a.user_id = p.id)
               order by p.created_at
               limit 8) x;
      if coalesce(cardinality(borrowed), 0) = 8 then
        u_t := borrowed[1]; u_g := borrowed[2]; u_d := borrowed[3]; u_p := borrowed[4];
        u_p2 := borrowed[5]; u_n2d := borrowed[6]; u_npg := borrowed[7]; u_pm := borrowed[8];
        have_users := true;
        half := 'eight borrowed profiles';
      else
        half := 'NOT RUN: ' || who || ' may not create auth.users rows and only '
                || coalesce(cardinality(borrowed), 0) || ' of 8 clean profiles exist';
      end if;
    end if;

    if have_users then
      v_users  := array[u_t, u_g, u_d, u_p, u_p2, u_n2d, u_npg, u_pm];
      v_labels := jsonb_build_object(
        u_t::text, 'T', u_g::text, 'G', u_d::text, 'D', u_p::text, 'P', u_p2::text, 'P2',
        u_n2d::text, 'N2d', u_npg::text, 'NPG', u_pm::text, 'PM',
        g47::text, 'g47', g90::text, 'g90', g5h::text, 'g5h', g150::text, 'g150', g43::text, 'g43', g49::text, 'g49',
        glu::text, 'glu', glive::text, 'glive', gold::text, 'gold', glate::text, 'glate', g4::text, 'g4',
        gbad::text, 'gbad', gfinal::text, 'gfinal', gm90::text, 'gm90', gmlu::text, 'gmlu', gmfinal::text, 'gmfinal',
        pl_baker::text, 'baker', pl_kid::text, 'kid', pl_max::text, 'max', pl_salih::text, 'salih');

      insert into access_subscriptions (user_id, plan_id, league_id, features, status,
                                        stripe_subscription_id, stripe_customer_id, current_period_end)
      values (u_g, null, lg_mem, array['league'], 'active', 'sub_T121g', 'cus_T121g', now() + interval '20 days');

      insert into fan_prefs as fp (user_id, fav_team_ids, fav_player_ids, fav_game_ids,
                                   want_results, want_players, want_fixtures, want_announcements,
                                   want_fixture_2d, want_fixture_2h, want_lineups, want_player_games,
                                   notify_inapp, notify_email, notify_push)
      values
        (u_t,   array[t_h, t_mh], '{}', '{}', true, true, true, true, true, true, true, true, true, false, false),
        (u_g,   '{}', array[pl_max], array[g47, g90, g5h, glu, gm90, gmlu, gfinal, gmfinal],
                                          true, true, true, true, true, true, true, true, true, false, false),
        (u_d,   array[t_h], array[pl_baker], '{}', true, true, true, true, true, true, true, true, true, false, false),
        (u_p,   '{}', array[pl_baker], '{}', true, true, true, true, true, true, true, true, true, false, false),
        (u_p2,  '{}', array[pl_baker, pl_salih, pl_kid, pl_max], '{}',
                                          true, true, true, true, true, true, true, true, true, false, false),
        (u_n2d, array[t_h], '{}', '{}', true, true, true, true, false, true, true, true, true, false, false),
        (u_npg, '{}', array[pl_baker], '{}', true, true, true, true, true, true, true, false, true, false, false),
        (u_pm,  '{}', array[pl_kid, pl_old], '{}', true, true, true, true, true, true, true, true, true, false, false)
      on conflict (user_id) do update
        set fav_team_ids = excluded.fav_team_ids, fav_player_ids = excluded.fav_player_ids,
            fav_game_ids = excluded.fav_game_ids, want_results = excluded.want_results,
            want_players = excluded.want_players, want_fixtures = excluded.want_fixtures,
            want_announcements = excluded.want_announcements, want_fixture_2d = excluded.want_fixture_2d,
            want_fixture_2h = excluded.want_fixture_2h, want_lineups = excluded.want_lineups,
            want_player_games = excluded.want_player_games, notify_inapp = excluded.notify_inapp,
            notify_email = excluded.notify_email, notify_push = excluded.notify_push;

      -- ============================================ the kinds and the defaults
      foreach v_kind in array array['result', 'player', 'fixture', 'lineups', 'announcement', 'message', 'highlights', 'privacy'] loop
        insert into notifications (user_id, kind, title, ref) values (u_t, v_kind, '0121', 't121-kind:' || v_kind);
      end loop;
      if exists (select 1 from notifications n
                  where n.user_id = u_t and n.ref like 't121-kind:%'
                    and (n.data <> '{}'::jsonb or n.urgency <> 'normal' or n.expires_at is not null)) then
        raise exception '0121: a notification written without data, urgency or expiry did not get {}, normal and null';
      end if;
      begin
        insert into notifications (user_id, kind, title, ref) values (u_t, 'bogus', '0121', 't121-kind:bogus');
        raise exception '0121: the kind check took bogus';
      exception when check_violation then null;
      end;
      begin
        insert into notifications (user_id, kind, title, ref, urgency) values (u_t, 'result', '0121', 't121-urgent', 'urgent');
        raise exception '0121: the urgency check took urgent';
      exception when check_violation then null;
      end;
      insert into notifications (user_id, kind, title, ref, urgency) values (u_t, 'result', '0121', 't121-very-low', 'very-low');
      delete from notifications n where n.user_id = u_t and n.ref like 't121-%';

      -- =================================================== the reminders (memberships on)
      v_stage := 'the reminders';
      v_n := public.notify_fixture_windows();
      v_exp := jsonb_build_object(
        'fixture', jsonb_build_array(
          jsonb_build_object('who', 'T',   'ref', 'g47:2d', 'title', v_club, 'body', 'In 2 days · ' || v_w47 || ' · Archers Arena'),
          jsonb_build_object('who', 'G',   'ref', 'g47:2d', 'title', v_club, 'body', 'In 2 days · ' || v_w47 || ' · Archers Arena'),
          jsonb_build_object('who', 'D',   'ref', 'g47:2d', 'title', v_club, 'body', 'In 2 days · ' || v_w47 || ' · Archers Arena'),
          jsonb_build_object('who', 'P',   'ref', 'g47:2d', 'title', 'Ben Baker has a game in 2 days', 'body', v_club || ' · ' || v_w47),
          jsonb_build_object('who', 'P2',  'ref', 'g47:2d', 'title', 'Ben Baker and Yusef Salih have a game in 2 days', 'body', v_club || ' · ' || v_w47),
          jsonb_build_object('who', 'T',   'ref', 'g90:2h', 'title', v_club, 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
          jsonb_build_object('who', 'G',   'ref', 'g90:2h', 'title', v_club, 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
          jsonb_build_object('who', 'D',   'ref', 'g90:2h', 'title', v_club, 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
          jsonb_build_object('who', 'N2d', 'ref', 'g90:2h', 'title', v_club, 'body', 'In 1 hour · tip-off ' || v_h90 || ' · Archers Arena'),
          jsonb_build_object('who', 'P',   'ref', 'g90:2h', 'title', 'Ben Baker plays in 1 hour', 'body', v_club || ' · tip-off ' || v_h90),
          jsonb_build_object('who', 'P2',  'ref', 'g90:2h', 'title', 'Ben Baker and Yusef Salih play in 1 hour', 'body', v_club || ' · tip-off ' || v_h90),
          jsonb_build_object('who', 'G',   'ref', 'gm90:2h', 'title', 'Members Home v Members Away', 'body', 'In 1 hour · tip-off ' || v_h90)),
        'lineups', '[]'::jsonb, 'result', '[]'::jsonb, 'player', '[]'::jsonb);
      foreach v_kind in array array['fixture', 'lineups', 'result', 'player'] loop
        execute v_rows_sql into v_actual using v_users, v_labels, v_kind, v_games;
        execute v_diff_sql into v_txt using v_actual, v_exp -> v_kind;
        if v_txt is not null then
          raise exception '0121: % (%): %', v_stage, v_kind, v_txt;
        end if;
      end loop;
      if v_n < 12 then
        raise exception '0121: notify_fixture_windows said it wrote % rows, but 12 are there', v_n;
      end if;
      if public.notif_until(t90) is distinct from 'In 1 hour' then
        raise exception '0121: the reminder 90 minutes out does not use notif_until''s words';
      end if;

      select to_jsonb(x) into v_j from (
        select n.data, n.urgency, n.expires_at, n.link, n.league_id from notifications n
         where n.user_id = u_p2 and n.kind = 'fixture' and n.ref = g47::text || ':2d') x;
      if v_j is distinct from jsonb_build_object(
           'data', jsonb_build_object('game', g47,
                     'home', jsonb_build_object('id', t_h, 'name', 'Reading Rockets'),
                     'away', jsonb_build_object('id', t_a, 'name', 'London Lions'),
                     'tipoff', t47, 'window', '2d',
                     'players', jsonb_build_array(jsonb_build_object('id', pl_baker, 'name', 'Ben Baker'),
                                                  jsonb_build_object('id', pl_salih, 'name', 'Yusef Salih'))),
           'urgency', 'normal', 'expires_at', t47 - interval '24 hours',
           'link', 'game/?g=' || g47 || '&mode=supabase', 'league_id', lg_open) then
        raise exception '0121: the grouped 2-day reminder carries %', v_j;
      end if;
      select to_jsonb(x) into v_j from (
        select n.data, n.urgency, n.expires_at, n.link from notifications n
         where n.user_id = u_t and n.kind = 'fixture' and n.ref = g90::text || ':2h') x;
      if v_j is distinct from jsonb_build_object(
           'data', jsonb_build_object('game', g90,
                     'home', jsonb_build_object('id', t_h, 'name', 'Reading Rockets'),
                     'away', jsonb_build_object('id', t_a, 'name', 'London Lions'),
                     'tipoff', t90, 'window', '2h'),
           'urgency', 'high', 'expires_at', t90, 'link', 'game/?g=' || g90 || '&mode=supabase') then
        raise exception '0121: the club 2-hour reminder carries %', v_j;
      end if;

      v_n := public.notify_fixture_windows();
      if v_n <> 0 then
        raise exception '0121: a second run of notify_fixture_windows wrote % rows; it must write 0', v_n;
      end if;
      v_n := public.notify_fixtures();
      if v_n <> 0 then
        raise exception '0121: notify_fixtures wrote % rows after notify_fixture_windows had run; it must only call it', v_n;
      end if;
      if exists (select 1 from notifications n where n.game_id = any (v_games)
                  and (n.ref like '%:soon' or n.ref like '%:today')) then
        raise exception '0121: a retired :soon or :today reminder was written';
      end if;

      -- ====================================================== the lineups (memberships on)
      v_stage := 'the lineups';
      update games set starters = jsonb_build_array(v_five_h, v_five_a) where id = glu;
      update games set starters = jsonb_build_array(v_five_h, v_five_a) where id = glive;
      update games set starters = jsonb_build_array(v_five_h, v_five_a) where id = gold;
      update games set starters = jsonb_build_array(v_five_h, v_five_a) where id = glate;
      update games set starters = jsonb_build_array(jsonb_build_array(pl_baker, pl_cole, pl_diaz, pl_eze), v_five_a) where id = g4;
      update games set starters = jsonb_build_array(jsonb_build_array(pl_max, pl_one, pl_two, pl_three, pl_four),
                                                    '["a1","a2","a3","a4","a5"]'::jsonb) where id = gmlu;

      -- a starter that is not an id: the UPDATE still commits, and nothing is written
      update games set starters = v_bad where id = gbad;
      get diagnostics v_n = row_count;
      if v_n <> 1 or (select g.starters from games g where g.id = gbad) is distinct from v_bad then
        raise exception '0121: the starters UPDATE on a game whose lineups notice fails did not go through';
      end if;
      begin
        perform public.notify_lineups(gbad);
        raise exception '0121: notify_lineups accepted a starter that is not an id, so the trigger test proves nothing';
      exception when invalid_parameter_value then null;
      end;

      v_exp := v_exp || jsonb_build_object('lineups', jsonb_build_array(
        jsonb_build_object('who', 'T',   'ref', 'glu:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'G',   'ref', 'glu:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'D',   'ref', 'glu:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'N2d', 'ref', 'glu:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'P',   'ref', 'glu:lineups', 'title', 'Ben Baker starts for Reading Rockets',
                           'body', v_club || ' · tip-off ' || v_hlu),
        jsonb_build_object('who', 'P2',  'ref', 'glu:lineups', 'title', 'Ben Baker starts for Reading Rockets',
                           'body', v_club || ' · tip-off ' || v_hlu || ' · Yusef Salih on the bench'),
        jsonb_build_object('who', 'T',   'ref', 'glive:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'D',   'ref', 'glive:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'N2d', 'ref', 'glive:lineups', 'title', v_lu_title, 'body', v_lu_body),
        jsonb_build_object('who', 'P',   'ref', 'glive:lineups', 'title', 'Ben Baker starts for Reading Rockets',
                           'body', v_club || ' · tip-off ' || v_hlive),
        jsonb_build_object('who', 'P2',  'ref', 'glive:lineups', 'title', 'Ben Baker starts for Reading Rockets',
                           'body', v_club || ' · tip-off ' || v_hlive || ' · Yusef Salih on the bench'),
        jsonb_build_object('who', 'G',   'ref', 'gmlu:lineups', 'title', 'Lineups are in: Members Home v Members Away',
                           'body', v_ml_body)));
      foreach v_kind in array array['fixture', 'lineups', 'result', 'player'] loop
        execute v_rows_sql into v_actual using v_users, v_labels, v_kind, v_games;
        execute v_diff_sql into v_txt using v_actual, v_exp -> v_kind;
        if v_txt is not null then
          raise exception '0121: % (%): %', v_stage, v_kind, v_txt;
        end if;
      end loop;

      select to_jsonb(x) into v_j from (
        select n.data, n.urgency, n.expires_at, n.link from notifications n
         where n.user_id = u_t and n.kind = 'lineups' and n.ref = glu::text || ':lineups') x;
      if v_j is distinct from jsonb_build_object(
           'data', jsonb_build_object('game', glu,
                     'home', jsonb_build_object('id', t_h, 'name', 'Reading Rockets'),
                     'away', jsonb_build_object('id', t_a, 'name', 'London Lions'),
                     'tipoff', tlu,
                     'starters', jsonb_build_array(
                        jsonb_build_array(jsonb_build_object('id', pl_baker, 'name', 'Ben Baker', 'num', '4'),
                                          jsonb_build_object('id', pl_cole, 'name', 'Tom Cole', 'num', '5'),
                                          jsonb_build_object('id', pl_diaz, 'name', 'Dan Diaz', 'num', '6'),
                                          jsonb_build_object('id', null, 'name', null, 'num', '12'),
                                          jsonb_build_object('id', pl_eze, 'name', 'Eli Eze', 'num', '7')),
                        jsonb_build_array(jsonb_build_object('id', pl_ash, 'name', 'Al Ash', 'num', '4'),
                                          jsonb_build_object('id', pl_bell, 'name', 'Bo Bell', 'num', '5'),
                                          jsonb_build_object('id', pl_cobb, 'name', 'Cy Cobb', 'num', '6'),
                                          jsonb_build_object('id', pl_dunn, 'name', 'Di Dunn', 'num', '7'),
                                          jsonb_build_object('id', pl_east, 'name', 'Ed East', 'num', '8')))),
           'urgency', 'high', 'expires_at', tlu + interval '1 hour',
           'link', 'game/?g=' || glu || '&mode=supabase&show=starters') then
        raise exception '0121: the club lineups notice carries %', v_j;
      end if;
      select n.data -> 'players' into v_j from notifications n
       where n.user_id = u_p2 and n.kind = 'lineups' and n.ref = glu::text || ':lineups';
      if v_j is distinct from jsonb_build_array(
           jsonb_build_object('id', pl_baker, 'name', 'Ben Baker', 'role', 'starter'),
           jsonb_build_object('id', pl_salih, 'name', 'Yusef Salih', 'role', 'bench')) then
        raise exception '0121: the player lineups notice lists %', v_j;
      end if;

      -- the sweep: the bad game is skipped, not fatal, and nothing is written twice
      select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) into v_before
        from notifications n where n.user_id = any (v_users) and n.game_id = any (v_games);
      perform public.notify_lineups();
      v_n := public.notify_lineups();
      select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) into v_after
        from notifications n where n.user_id = any (v_users) and n.game_id = any (v_games);
      if v_n <> 0 or v_before is distinct from v_after then
        raise exception '0121: sweeping the lineups again wrote % rows (or changed the test fans'' rows)', v_n;
      end if;

      -- ============================================================ full time
      v_stage := 'full time';
      v_n := public.notify_game_final(gfinal);
      v_m := public.notify_game_final(gmfinal);
      v_exp := v_exp || jsonb_build_object(
        'result', jsonb_build_array(
          jsonb_build_object('who', 'T',   'ref', 'gfinal', 'title', 'FT · Reading Rockets 96–95 London Lions', 'body', 'T121 Cup'),
          jsonb_build_object('who', 'G',   'ref', 'gfinal', 'title', 'FT · Reading Rockets 96–95 London Lions', 'body', 'T121 Cup'),
          jsonb_build_object('who', 'D',   'ref', 'gfinal', 'title', 'FT · Reading Rockets 96–95 London Lions', 'body', 'T121 Cup'),
          jsonb_build_object('who', 'N2d', 'ref', 'gfinal', 'title', 'FT · Reading Rockets 96–95 London Lions', 'body', 'T121 Cup'),
          jsonb_build_object('who', 'G',   'ref', 'gmfinal', 'title', 'FT · Members Home 70–60 Members Away', 'body', 'T121 Members League')),
        'player', jsonb_build_array(
          jsonb_build_object('who', 'P',   'ref', 'gfinal:baker', 'title', 'Ben Baker: 23 PTS · 6 REB · 5 AST',
                             'body', 'Reading Rockets 96–95 London Lions · FT · 8/20 FG · 32 MIN'),
          jsonb_build_object('who', 'P2',  'ref', 'gfinal:baker', 'title', 'Ben Baker: 23 PTS · 6 REB · 5 AST',
                             'body', 'Reading Rockets 96–95 London Lions · FT · 8/20 FG · 32 MIN'),
          jsonb_build_object('who', 'D',   'ref', 'gfinal:baker', 'title', 'Ben Baker: 23 PTS · 6 REB · 5 AST',
                             'body', 'Reading Rockets 96–95 London Lions · FT · 8/20 FG · 32 MIN'),
          jsonb_build_object('who', 'NPG', 'ref', 'gfinal:baker', 'title', 'Ben Baker: 23 PTS · 6 REB · 5 AST',
                             'body', 'Reading Rockets 96–95 London Lions · FT · 8/20 FG · 32 MIN'),
          jsonb_build_object('who', 'G',   'ref', 'gmfinal:max', 'title', 'Max Member: 12 PTS · 3 REB · 1 AST · 2 STL',
                             'body', 'Members Home 70–60 Members Away · FT · 5/9 FG · 25 MIN')));
      foreach v_kind in array array['fixture', 'lineups', 'result', 'player'] loop
        execute v_rows_sql into v_actual using v_users, v_labels, v_kind, v_games;
        execute v_diff_sql into v_txt using v_actual, v_exp -> v_kind;
        if v_txt is not null then
          raise exception '0121: % (%): %', v_stage, v_kind, v_txt;
        end if;
      end loop;
      if v_n <> 8 or v_m <> 2 then
        raise exception '0121: notify_game_final said it wrote % and % rows (want 8 and 2)', v_n, v_m;
      end if;

      select to_jsonb(x) into v_j from (
        select n.data, n.urgency, n.expires_at, n.link, n.league_id from notifications n
         where n.user_id = u_t and n.kind = 'result' and n.ref = gfinal::text) x;
      if v_j is distinct from jsonb_build_object(
           'data', jsonb_build_object('game', gfinal,
                     'home', jsonb_build_object('id', t_h, 'name', 'Reading Rockets'),
                     'away', jsonb_build_object('id', t_a, 'name', 'London Lions'),
                     'tipoff', (select g.tipoff_at from games g where g.id = gfinal),
                     'score', jsonb_build_array(96, 95)),
           'urgency', 'high', 'expires_at', now() + interval '24 hours',
           'link', 'game/?g=' || gfinal || '&mode=supabase', 'league_id', lg_open) then
        raise exception '0121: the result carries %', v_j;
      end if;
      select to_jsonb(x) into v_j from (
        select n.data -> 'players' as players, n.data -> 'statline' as statline, n.data -> 'score' as score,
               n.urgency, n.expires_at, n.link from notifications n
         where n.user_id = u_p and n.kind = 'player' and n.ref = gfinal::text || ':' || pl_baker) x;
      if v_j is distinct from jsonb_build_object(
           'players', jsonb_build_array(jsonb_build_object('id', pl_baker, 'name', 'Ben Baker')),
           'statline', '{"pts":23,"reb":6,"ast":5,"stl":0,"blk":0,"fgm":8,"fga":20,"min":32}'::jsonb,
           'score', jsonb_build_array(96, 95),
           'urgency', 'high', 'expires_at', now() + interval '24 hours',
           'link', 'game/?g=' || gfinal || '&mode=supabase&vp=' || pl_baker) then
        raise exception '0121: the statline carries %', v_j;
      end if;
      v_n := public.notify_game_final(gfinal);
      if v_n <> 0 then
        raise exception '0121: a second notify_game_final wrote % rows; it must write 0', v_n;
      end if;

      -- ====================================== memberships off: every league is open
      v_stage := 'memberships switched off';
      update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
      perform public.notify_fixtures();         -- the ingest runner's name for the same thing
      perform public.notify_lineups(gmlu);
      perform public.notify_game_final(gmfinal);
      update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
      v_exp := jsonb_build_object(
        'fixture', (v_exp -> 'fixture') || jsonb_build_array(
          jsonb_build_object('who', 'T',  'ref', 'gm90:2h', 'title', 'Members Home v Members Away', 'body', 'In 1 hour · tip-off ' || v_h90),
          jsonb_build_object('who', 'P2', 'ref', 'gm90:2h', 'title', 'Max Member plays in 1 hour',
                             'body', 'Members Home v Members Away · tip-off ' || v_h90)),
        'lineups', (v_exp -> 'lineups') || jsonb_build_array(
          jsonb_build_object('who', 'T',  'ref', 'gmlu:lineups', 'title', 'Lineups are in: Members Home v Members Away', 'body', v_ml_body),
          jsonb_build_object('who', 'P2', 'ref', 'gmlu:lineups', 'title', 'Max Member starts for Members Home',
                             'body', 'Members Home v Members Away · tip-off ' || v_hlu)),
        'result', (v_exp -> 'result') || jsonb_build_array(
          jsonb_build_object('who', 'T',  'ref', 'gmfinal', 'title', 'FT · Members Home 70–60 Members Away', 'body', 'T121 Members League')),
        'player', (v_exp -> 'player') || jsonb_build_array(
          jsonb_build_object('who', 'P2', 'ref', 'gmfinal:max', 'title', 'Max Member: 12 PTS · 3 REB · 1 AST · 2 STL',
                             'body', 'Members Home 70–60 Members Away · FT · 5/9 FG · 25 MIN')));
      foreach v_kind in array array['fixture', 'lineups', 'result', 'player'] loop
        execute v_rows_sql into v_actual using v_users, v_labels, v_kind, v_games;
        execute v_diff_sql into v_txt using v_actual, v_exp -> v_kind;
        if v_txt is not null then
          raise exception '0121: % (%): %', v_stage, v_kind, v_txt;
        end if;
      end loop;

      -- ============================================================ the minor
      if exists (select 1 from notifications n
                  where n.user_id = any (v_users) and n.game_id = any (v_games)
                    and (n.title || ' ' || n.body || ' ' || n.data::text) ~* ('(kiddo|younger|' || pl_kid::text || ')')) then
        raise exception '0121: A WITHHELD MINOR WAS NAMED OR IDENTIFIED IN A NOTIFICATION';
      end if;

      -- ============================================================ set_fan_prefs
      perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select to_jsonb(r) into v_j
        from public.set_fan_prefs('{"want_fixture_2d":false,"want_fixture_2h":false,"want_lineups":false,"want_player_games":false}'::jsonb) r;
      if jsonb_build_object('a', v_j->'want_fixture_2d', 'b', v_j->'want_fixture_2h', 'c', v_j->'want_lineups',
                            'd', v_j->'want_player_games', 'e', v_j->'want_results', 'f', v_j->'fav_player_ids')
         is distinct from jsonb_build_object('a', false, 'b', false, 'c', false, 'd', false, 'e', true,
                                             'f', jsonb_build_array(pl_baker)) then
        execute format('set local role %I', orig);
        raise exception '0121: set_fan_prefs did not switch the four new keys off (or touched another): %', v_j;
      end if;
      select to_jsonb(r) into v_j from public.set_fan_prefs('{"want_lineups":true,"want_fixture_2h":null}'::jsonb) r;
      if jsonb_build_object('a', v_j->'want_fixture_2d', 'b', v_j->'want_fixture_2h', 'c', v_j->'want_lineups',
                            'd', v_j->'want_player_games')
         is distinct from jsonb_build_object('a', false, 'b', false, 'c', true, 'd', false) then
        execute format('set local role %I', orig);
        raise exception '0121: set_fan_prefs did not keep the keys it was not given (or given null): %', v_j;
      end if;
      select to_jsonb(r) into v_j from public.set_fan_prefs('{"fav_player_ids":[],"fav_game_ids":[],"fav_team_ids":[]}'::jsonb) r;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
      if jsonb_build_object('a', v_j->'fav_player_ids', 'b', v_j->'fav_game_ids', 'c', v_j->'fav_team_ids', 'd', v_j->'want_lineups')
         is distinct from jsonb_build_object('a', '[]'::jsonb, 'b', '[]'::jsonb, 'c', '[]'::jsonb, 'd', true) then
        raise exception '0121: set_fan_prefs no longer clears a list sent as []: %', v_j;
      end if;

      -- ============================================================ the tick
      update fan_prefs set notify_push = true where user_id = u_t;
      if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
        v_j := public.notify_tick();
        if (v_j->>'net')::boolean is distinct from false or (v_j->>'called')::boolean is distinct from false
           or coalesce((v_j->>'waiting')::int, 0) < 1
           or v_j->>'request_id' is not null or v_j->'errors' is distinct from '[]'::jsonb then
          raise exception '0121: without pg_net, with pushes waiting, notify_tick returned %', v_j;
        end if;
        if not exists (select 1 from notify_ticks t where t.id = 1 and t.ran_at = now() and t.called_at is null) then
          raise exception '0121: without pg_net the tick was not recorded, or was recorded as a call';
        end if;

        /* a stand-in for pg_net's net.http_post, same signature, recording each call */
        begin
          create schema net;
        exception when insufficient_privilege then
          net_half := 'NOT RUN: ' || who || ' may not create a schema for the stand-in net.http_post';
        end;
        if net_half not like 'NOT RUN%' then
          create table net.t121_calls (url text, body jsonb, params jsonb, headers jsonb, timeout_ms int);
          create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                        headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 2000)
          returns bigint language plpgsql as $f$
          begin
            insert into net.t121_calls values (url, body, params, headers, timeout_milliseconds);
            return 121;
          end $f$;

          v_j := public.notify_tick();
          if (v_j->>'net')::boolean is distinct from true or (v_j->>'called')::boolean is distinct from true
             or (v_j->>'request_id')::bigint is distinct from 121 or v_j->'errors' is distinct from '[]'::jsonb then
            raise exception '0121: with net.http_post there and pushes waiting, notify_tick did not call: %', v_j;
          end if;
          if (select count(*) from net.t121_calls) <> 1
             or not exists (select 1 from net.t121_calls c
                             where c.url = 'https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/notify'
                               and c.body = '{"source":"tick"}'::jsonb
                               and c.params = '{}'::jsonb
                               and c.headers = '{"Content-Type":"application/json","apikey":"sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO"}'::jsonb
                               and c.timeout_ms = 5000) then
            raise exception '0121: notify_tick called notify with %',
              (select jsonb_agg(to_jsonb(c)) from net.t121_calls c);
          end if;
          if not exists (select 1 from notify_ticks t where t.id = 1 and t.called_at = now() and t.request_id = 121) then
            raise exception '0121: the call was not recorded in notify_ticks';
          end if;

          -- nothing waiting but an expired row, then a row older than three days: no call
          select count(*) into v_m
            from notifications n join fan_prefs p on p.user_id = n.user_id and p.notify_push
           where n.pushed_at is null and n.user_id <> u_t;
          if v_m = 0 then
            select n.id::text into v_txt from notifications n
             where n.user_id = u_t and n.pushed_at is null order by n.created_at, n.id limit 1;
            update notifications n set pushed_at = now() where n.user_id = u_t and n.id::text <> v_txt;
            update notifications n set expires_at = now() - interval '1 minute' where n.id::text = v_txt;
            v_j := public.notify_tick();
            if (v_j->>'called')::boolean is distinct from false or (v_j->>'waiting')::int is distinct from 0
               or (select count(*) from net.t121_calls) <> 1 then
              raise exception '0121: notify_tick called notify for a row past its expiry: %', v_j;
            end if;
            update notifications n set expires_at = null, created_at = now() - interval '4 days' where n.id::text = v_txt;
            v_j := public.notify_tick();
            if (v_j->>'called')::boolean is distinct from false or (v_j->>'waiting')::int is distinct from 0
               or (select count(*) from net.t121_calls) <> 1 then
              raise exception '0121: notify_tick called notify for a row older than three days: %', v_j;
            end if;
            update notifications n set created_at = now() where n.id::text = v_txt;
            v_j := public.notify_tick();
            if (v_j->>'called')::boolean is distinct from true or (v_j->>'waiting')::int is distinct from 1
               or (select count(*) from net.t121_calls) <> 2 then
              raise exception '0121: notify_tick did not call notify for one fresh row waiting: %', v_j;
            end if;
          else
            net_half := net_half || ' (the no-call checks skipped: ' || v_m || ' real pushes are waiting)';
          end if;
        end if;
      else
        net_half := 'the installed pg_net (its queued request rolls back)';
        v_j := public.notify_tick();
        if (v_j->>'net')::boolean is distinct from true or (v_j->>'called')::boolean is distinct from true
           or v_j->'errors' is distinct from '[]'::jsonb then
          raise exception '0121: with pg_net installed and pushes waiting, notify_tick returned %', v_j;
        end if;
      end if;

      -- what notify_health must say about the job, read with this file's rights
      v_b := false;
      if to_regclass('cron.job') is not null then
        execute 'select exists (select 1 from cron.job j where j.jobname = $1 and j.active)'
           into v_b using 'epinoia-notify-tick'::text;
      end if;
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
      v_j := public.notify_health();
      execute format('set local role %I', orig);
      if (select array_agg(k order by k) from jsonb_object_keys(v_j) k) is distinct from array['cron', 'last_called', 'last_tick', 'net']
         or (v_j->>'cron')::boolean is distinct from v_b
         or (v_j->>'net')::boolean is distinct from (to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null)
         or (v_j->>'last_tick')::timestamptz is distinct from now()
         or (v_j->>'last_called')::timestamptz is distinct from (select t.called_at from notify_ticks t where t.id = 1) then
        raise exception '0121: signed out, notify_health returned %', v_j;
      end if;

      -- ============================================================ the swap
      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        (u_p, 'https://push.example.invalid/t121/a', 'pk-a', 'au-a') returning id into s_a;
      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        (u_p, 'https://push.example.invalid/t121/b', 'pk-b', 'au-b') returning id into s_b;
      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        (u_t, 'https://push.example.invalid/t121/c', 'pk-c', 'au-c') returning id into s_c;
      -- every subscription of the test fans (borrowed ones may hold real ones too)
      select jsonb_object_agg(s.id, to_jsonb(s)) into v_before from push_subscriptions s where s.user_id = any (v_users);

      perform set_config('request.jwt.claims', '', true);
      set local role anon;
      v_b := public.swap_push_subscription('https://push.example.invalid/t121/a', 'https://push.example.invalid/t121/a2', 'pk-a2', 'au-a2');
      execute format('set local role %I', orig);
      select jsonb_object_agg(s.id, to_jsonb(s)) into v_after from push_subscriptions s where s.user_id = any (v_users);
      if v_b is distinct from true
         or (v_after - s_a::text) is distinct from (v_before - s_a::text)
         or (v_after -> s_a::text) is distinct from
            ((v_before -> s_a::text) || '{"endpoint":"https://push.example.invalid/t121/a2","p256dh":"pk-a2","auth":"au-a2"}'::jsonb) then
        raise exception '0121: swapping endpoint a changed % rather than exactly its own row', v_after;
      end if;

      set local role anon;
      v_b := public.swap_push_subscription('https://push.example.invalid/t121/nope', 'https://push.example.invalid/t121/x', 'pk-x', 'au-x');
      execute format('set local role %I', orig);
      select jsonb_object_agg(s.id, to_jsonb(s)) into v_before from push_subscriptions s where s.user_id = any (v_users);
      if v_b is distinct from false or v_before is distinct from v_after then
        raise exception '0121: an unknown endpoint answered % or changed a row', v_b;
      end if;

      set local role anon;
      begin
        perform public.swap_push_subscription('https://push.example.invalid/t121/c', 'http://push.example.invalid/t121/c2', 'k', 'a');
        execute format('set local role %I', orig);
        raise exception '0121: a subscription was swapped to a plain http endpoint';
      exception when invalid_parameter_value then null;
      end;
      v_b := public.swap_push_subscription('https://push.example.invalid/t121/b', 'https://push.example.invalid/t121/c', 'pk-z', 'au-z');
      execute format('set local role %I', orig);
      select jsonb_object_agg(s.id, to_jsonb(s)) into v_after from push_subscriptions s where s.user_id = any (v_users);
      if v_b is distinct from true or v_after ? s_b::text
         or (v_after - s_b::text) is distinct from (v_before - s_b::text) then
        raise exception '0121: swapping b onto an endpoint already registered did not remove b alone: %', v_after;
      end if;
    end if;

    raise exception using errcode = 'P0121', message = '0121 passed; rolling its test rows back';
  exception
    when sqlstate 'P0121' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug like 'zz-t121-%')
     or exists (select 1 from players where slug like 'zz-t121-%')
     or exists (select 1 from push_subscriptions where endpoint like 'https://push.example.invalid/t121/%')
     or to_regclass('net.t121_calls') is not null then
    raise exception '0121: the test rows outlived their rollback';
  end if;
  if public.memberships_enabled()
     or (select s.value from platform_settings s where s.key = 'memberships_enabled') is distinct from 'false'::jsonb then
    raise exception '0121: the self-test left memberships switched on (%) — they ship off',
      (select s.value from platform_settings s where s.key = 'memberships_enabled');
  end if;

  raise notice '0121 ok (2/2): the 2-day and 2-hour reminders, the lineups (by trigger and by sweep) and the result and statline go to exactly the fans the contract names, club-style or grouped player-style, never twice; the switches suppress; the minor is never named; a failing lineups notice never blocks the starters update; members-only leagues are refused with memberships on and open with them off; set_fan_prefs takes the four keys; the tick calls notify exactly when a push is waiting; notify_health is four keys signed out; the swap changes only its own row';
  raise notice '0121: the scenario ran with %; the tick''s call-out ran with %', half, net_half;
end $test$;

-- ============================================================================
-- 10. THE EXTENSIONS AND THE JOB (contract 3), after the self-test.
--
-- pg_net and pg_cron are created only where pg_available_extensions lists them,
-- in the forms Supabase documents (pg_net in the extensions schema, pg_cron in
-- pg_catalog with the two grants to postgres). The job is unscheduled first by
-- name, so applying this file again replaces it rather than adding a second.
-- If either extension is listed but cannot be created, or the job cannot be
-- scheduled, the file still applies and says so in a WARNING: reminders are
-- then written by the ingest runner's passes, as before, and notify_health()
-- reports cron or net false.
--
-- pg_cron runs a job as the user that scheduled it. The job must belong to
-- postgres (the owner of everything it calls); if this file is applied as
-- another role, a WARNING names it.
-- ============================================================================
do $ext$
declare
  v_job   bigint;
  v_owner text;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions e where e.name = 'pg_net') then
    begin
      create extension if not exists pg_net with schema extensions;
    exception when others then
      raise warning '0121: pg_net is available but was not created (%: %). Reminders and lineups are still written every minute, but nothing calls the notify function from the database; notify_health() says net: false', sqlstate, sqlerrm;
    end;
  end if;

  if to_regclass('cron.job') is null
     and exists (select 1 from pg_available_extensions e where e.name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
      grant usage on schema cron to postgres;
      grant all privileges on all tables in schema cron to postgres;
    exception when others then
      raise warning '0121: pg_cron is available but was not created (%: %). notify_tick() is installed but nothing runs it; notify_health() says cron: false', sqlstate, sqlerrm;
    end;
  end if;

  if to_regclass('cron.job') is not null then
    begin
      execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-notify-tick'::text;
      execute 'select cron.schedule($1, $2, $3)' into v_job
        using 'epinoia-notify-tick'::text, '* * * * *'::text, 'select public.notify_tick()'::text;
      execute 'select j.username::text from cron.job j where j.jobid = $1' into v_owner using v_job;
      if v_owner is distinct from 'postgres' then
        raise warning '0121: the job epinoia-notify-tick runs as %, not postgres: if that role is dropped the tick stops. Reschedule it as postgres', v_owner;
      end if;
      raise notice '0121: pg_cron job epinoia-notify-tick (job %) runs select public.notify_tick() every minute as %', v_job, v_owner;
    exception when others then
      raise warning '0121: pg_cron is installed but epinoia-notify-tick was not scheduled (%: %); notify_health() says cron: false', sqlstate, sqlerrm;
    end;
  else
    raise notice '0121: pg_cron is not installed here, so nothing runs notify_tick() every minute; every function is installed, and notify_health() says cron: false';
  end if;

  raise notice '0121: notify_health() = %', public.notify_health();
end $ext$;
