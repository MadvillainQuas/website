-- ============================================================================
-- 0124 — HALF-TIME: THE SCORE FOR A CLUB'S FOLLOWERS, THE FIRST-HALF LINE FOR A
-- PLAYER'S.
--
-- The contract is docs/notifications.md (§1 gains the moment, §2 the switch, §3
-- the functions, §4 the lock-screen slot). 0121 is underneath and unchanged
-- except where this file redefines set_fan_prefs and notify_tick.
--
--   moment      kind      ref         who
--   half-time   halftime  <game>:ht   club / game followers: "HT · Home 41–38 Away",
--                                     top scorers, and the lines of any followed
--                                     players who have played
--                                     player-only followers: "Ben Baker at half-time:
--                                     12 PTS · 3 REB · 2 AST", grouped
--
-- ONE NOTICE PER FAN PER GAME, as 0121: both audiences share the ref, so a fan
-- who follows a club and a player in it gets the club notice with the player's
-- line in it, one buzz instead of two. A fan counts as a club follower here
-- exactly as at full time (want_results for a followed club, or a followed game);
-- everyone else who follows a player who has played is a player follower.
--
-- WHEN IS IT HALF-TIME. Nothing in the log says so: the event vocabulary has
-- period_start and game_end, no period end. The scorer (epinoia/score/sync.js)
-- holds the second quarter at 0:00 through the interval and says so with
-- break_ms, and a fed game's state is the feed's last period and its clock. So a
-- live game is at half-time when its state is not running and reads:
--   * period 2 at 0:00 (the buzzer; the scorer and FIBA's snapshot), or
--   * period 2 or 3 with a full clock (a clock already set for the third quarter
--     that has not started),
-- and the log shows a second quarter that was PLAYED (an event in period 2 with
-- time off the clock: the subs and the period_start logged at 10:00 of the second
-- quarter do not count, or the break after the FIRST quarter would qualify) and a
-- third quarter that was not (no event in period 3 or later with time off the
-- clock). The engine and the scorer both fix four ten-minute quarters (engine.js
-- PLEN), so "the half" is the second quarter everywhere.
--
-- Three guards against telling fans something untrue:
--   * QUIET FOR A MINUTE. A foul at the buzzer leaves free throws to shoot at 0:00.
--     No play is sent until no play event has been written for a minute, so the
--     score and the lines include them. Descriptor edits (tags, shot types,
--     locations) do not count as play: a statistician tidying up at the interval
--     must not hold the notice back;
--   * FRESH STATE. The game's state was written in the last 30 minutes, so a game
--     abandoned at 0:00 of the second quarter is not announced days later;
--   * LIVE MEANS PUBLIC. A live game is readable by the public only where the
--     league has public_live (0084, 0118's can_read_game); a half-time score from
--     any other league is not written at all. 0118's members-only rule applies on
--     top, decided once per game as everywhere else.
--
-- THE FIRST-HALF LINE is replayed from game_events by notif_first_half(), in the
-- engine's terms exactly (engine.js derive): points 1/2/3 for ft/p2/p3 made, a
-- rebound offensive when payload.off is truthy, minutes from the starting fives
-- (on at 0:00) and substitutions read IN GAME ORDER (elapsed time from the event's
-- own period and clock, ties in sequence order: engine.js inGameOrder), a player
-- on court at the half credited to 20:00. player_game_stats only exists after
-- finalise-game, so this is the only first-half box the database has. Its keys are
-- player_game_stats' own, so notif_statline and notif_statline_more (0121) word it.
--
-- WHERE THIS FILE DECIDES WHAT THE CONTRACT DOES NOT SAY:
--   * want_halftime (default on) governs both audiences; want_results still
--     decides who counts as a club follower, want_players whether player lines
--     are sent at all (in a club notice as well as a player one);
--   * a player who has not played in the first half (no minutes, no counted
--     event) is not in anybody's notice; the minor rule is 0121's (never named, not
--     a trigger, not a top scorer);
--   * top scorers: each side's highest-scoring named player with points, home
--     first, surname and points ("Top scorers: Baker 14, Salih 12"); ties go to
--     the name. A side with nobody on the scoresheet is left out;
--   * the player-only notice leads with the followed player with most points;
--   * urgency high, expiring 20 minutes after it is written: a half-time score
--     arriving in the third quarter is noise;
--   * the lock-screen slot (pushpayload.js): the club notice takes the result's
--     slot and the player notice the first player's statline slot, so the
--     full-time notice REPLACES the half-time one on the phone.
-- ============================================================================

set local lock_timeout = '5s';

-- The Supabase CLI applies these statements one at a time, outside a transaction
-- (see 0121): each ALTER takes its own lock, and every statement here is safe to
-- apply again if a later one fails.

-- ----------------------------------------------------------------------------
-- 1. THE KIND AND THE SWITCH
-- ----------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy'));

alter table public.fan_prefs
  add column if not exists want_halftime boolean not null default true;

-- ----------------------------------------------------------------------------
-- 2. set_fan_prefs (latest: 0121), with want_halftime. Unchanged otherwise.
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
    want_halftime      = coalesce((p->>'want_halftime')::boolean, want_halftime),
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
-- 3. THE FIRST HALF, REPLAYED (see the header)
--
-- One row per player the first half knows: a starter, anyone substituted in or
-- out, anyone with a counted event. played is true for minutes on court or a
-- counted event. Ids are lower-cased on both sides, as notify_lineups does.
-- Security invoker: it reads game_events with its caller's rights, and its only
-- callers are the fan-outs, which run as postgres.
-- ----------------------------------------------------------------------------
create or replace function public.notif_first_half(p_game uuid)
returns table (player_id text, team_idx int, played boolean, stats jsonb)
language plpgsql stable set search_path = public as $$
declare
  v_starters jsonb;
  v_on       jsonb := '{}'::jsonb;   -- on court now: player -> elapsed ms when they came on
  v_ms       jsonb := '{}'::jsonb;   -- player -> ms played
  v_side     jsonb := '{}'::jsonb;   -- player -> 0 | 1
  e          record;
  k          text;
begin
  select gm.starters into v_starters from games gm where gm.id = p_game;

  for e in
    select sd.side, lower(x.v #>> '{}') as id
      from (values (0), (1)) sd(side)
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(v_starters -> sd.side) = 'array' then v_starters -> sd.side
                  else '[]'::jsonb end) x(v)
     where jsonb_typeof(x.v) in ('string', 'number')
  loop
    v_on   := v_on   || jsonb_build_object(e.id, 0);
    v_side := v_side || jsonb_build_object(e.id, e.side);
  end loop;

  -- engine.js: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN), ten-minute quarters
  for e in
    select s.p_in, s.p_out, s.team, s.at_ms
      from (select lower(nullif(ev.payload ->> 'in', ''))  as p_in,
                   lower(nullif(ev.payload ->> 'out', '')) as p_out,
                   ev.team, ev.seq,
                   (coalesce(nullif(ev.period, 0), 1) - 1) * 600000 + 600000 - coalesce(ev.clock, 600000) as at_ms
              from game_events ev
             where ev.game_id = p_game
               and ev.t = 'sub'
               and coalesce(nullif(ev.period, 0), 1) <= 2) s
     order by s.at_ms, s.seq
  loop
    if e.p_out is not null and (v_on ? e.p_out) then
      v_ms := v_ms || jsonb_build_object(e.p_out,
                coalesce((v_ms ->> e.p_out)::bigint, 0) + greatest(0, e.at_ms - (v_on ->> e.p_out)::bigint));
      v_on := v_on - e.p_out;
    end if;
    if e.p_in is not null then
      v_on := v_on || jsonb_build_object(e.p_in, e.at_ms);
    end if;
    if e.team in (0, 1) then
      if e.p_in is not null and not (v_side ? e.p_in) then
        v_side := v_side || jsonb_build_object(e.p_in, e.team);
      end if;
      if e.p_out is not null and not (v_side ? e.p_out) then
        v_side := v_side || jsonb_build_object(e.p_out, e.team);
      end if;
    end if;
  end loop;

  -- on court at the half: credited to the end of the second quarter (20:00 elapsed)
  for k in select jsonb_object_keys(v_on) loop
    v_ms := v_ms || jsonb_build_object(k, coalesce((v_ms ->> k)::bigint, 0) + greatest(0, 1200000 - (v_on ->> k)::bigint));
  end loop;

  return query
  with ev as (
    select lower(g.pid) as id, g.team, g.t,
           case jsonb_typeof(g.payload -> 'off')        -- JavaScript truthiness, as `ev.off ?` reads it
             when 'boolean' then (g.payload ->> 'off')::boolean
             when 'number'  then (g.payload ->> 'off')::numeric <> 0
             when 'string'  then (g.payload ->> 'off') <> ''
             when 'object'  then true
             when 'array'   then true
             else false end as off
      from game_events g
     where g.game_id = p_game
       and coalesce(nullif(g.period, 0), 1) <= 2
       and coalesce(g.pid, '') <> ''
       and g.t in ('ft_made', 'ft_miss', 'p2_made', 'p2_miss', 'p3_made', 'p3_miss', 'reb', 'ast', 'stl', 'blk', 'to')
  ),
  box as (
    select ev.id,
           min(ev.team) filter (where ev.team in (0, 1))              as team,
           count(*)                                                    as n,
           count(*) filter (where ev.t = 'ft_made')                    as ftm,
           count(*) filter (where ev.t in ('ft_made', 'ft_miss'))      as fta,
           count(*) filter (where ev.t = 'p2_made')                    as p2m,
           count(*) filter (where ev.t in ('p2_made', 'p2_miss'))      as p2a,
           count(*) filter (where ev.t = 'p3_made')                    as p3m,
           count(*) filter (where ev.t in ('p3_made', 'p3_miss'))      as p3a,
           count(*) filter (where ev.t = 'reb' and ev.off)             as orb,
           count(*) filter (where ev.t = 'reb' and not ev.off)         as drb,
           count(*) filter (where ev.t = 'ast')                        as ast,
           count(*) filter (where ev.t = 'stl')                        as stl,
           count(*) filter (where ev.t = 'blk')                        as blk,
           count(*) filter (where ev.t = 'to')                         as tov
      from ev
     group by ev.id
  ),
  ids as (
    select b.id from box b
    union
    select x.k from jsonb_object_keys(v_ms) x(k)
    union
    select x.k from jsonb_object_keys(v_side) x(k)
  )
  select i.id,
         coalesce((v_side ->> i.id)::int, b.team),
         coalesce((v_ms ->> i.id)::bigint, 0) > 0 or coalesce(b.n, 0) > 0,
         jsonb_build_object(
           'pts', coalesce(b.ftm + 2 * b.p2m + 3 * b.p3m, 0),
           'p2m', coalesce(b.p2m, 0), 'p2a', coalesce(b.p2a, 0),
           'p3m', coalesce(b.p3m, 0), 'p3a', coalesce(b.p3a, 0),
           'ftm', coalesce(b.ftm, 0), 'fta', coalesce(b.fta, 0),
           'or',  coalesce(b.orb, 0), 'dr',  coalesce(b.drb, 0),
           'ast', coalesce(b.ast, 0), 'stl', coalesce(b.stl, 0), 'blk', coalesce(b.blk, 0),
           'to',  coalesce(b.tov, 0),
           'min', coalesce((v_ms ->> i.id)::bigint, 0))
    from ids i
    left join box b on b.id = i.id
   order by 2, 1;
end $$;

-- the statline a phone or a page can read from data, in 0121's full-time shape
create or replace function public.notif_statline_data(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
           'pts', public.notif_num(p, 'pts'),
           'reb', public.notif_num(p, 'or') + public.notif_num(p, 'dr'),
           'ast', public.notif_num(p, 'ast'),
           'stl', public.notif_num(p, 'stl'),
           'blk', public.notif_num(p, 'blk'),
           'fgm', public.notif_num(p, 'p2m') + public.notif_num(p, 'p3m'),
           'fga', public.notif_num(p, 'p2a') + public.notif_num(p, 'p3a'),
           'min', round(public.notif_num(p, 'min') / 60000));
$$;

-- ----------------------------------------------------------------------------
-- 4. THE HALF-TIME NOTICE (contract 1, 3)
--
-- notify_halftime(p_game) writes the notice for every live game at half-time,
-- or the one game given if it is. The minute tick sweeps; the rows are unique per
-- (fan, kind, ref), so sweeping every minute of the interval writes each once.
-- Sweeping, a game that fails is skipped with a warning; asked about one game,
-- the error is raised.
-- ----------------------------------------------------------------------------
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
      insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, 'halftime', 'HT · ' || v_score,
             coalesce(nullif(concat_ws(chr(10), mine.lines, v_top), ''), g.comp, 'Half-time'),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('audience', 'club', 'players', coalesce(mine.players, '[]'::jsonb)),
             'high', v_expires
        from fan_prefs p
        cross join lateral (
          select string_agg((l.v ->> 'name') || ': ' || public.notif_statline(l.v -> 'stats'), chr(10) order by l.ord) as lines,
                 jsonb_agg(jsonb_build_object('id', l.v -> 'id', 'name', l.v -> 'name',
                                              'statline', public.notif_statline_data(l.v -> 'stats')) order by l.ord) as players
            from jsonb_array_elements(v_lines) with ordinality l(v, ord)
           where p.want_players and (l.v ->> 'id')::uuid = any (p.fav_player_ids)) mine
       where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
              or g.id = any (p.fav_game_ids))
         and p.want_halftime
         and (not v_members_only or public.can_view_league_for(p.user_id, g.league_id))   -- 0118
      on conflict (user_id, kind, ref) do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      -- everyone else who follows a player who has played: that player's line first
      with fans as (
        select p.user_id, l.v,
               row_number() over (partition by p.user_id order by l.ord) as rn
          from fan_prefs p
          join lateral jsonb_array_elements(v_lines) with ordinality l(v, ord)
            on (l.v ->> 'id')::uuid = any (p.fav_player_ids)
         where p.want_players and p.want_halftime
           and not ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
                    or g.id = any (p.fav_game_ids))
           and (not v_members_only or public.can_view_league_for(p.user_id, g.league_id))   -- 0118
      )
      insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select f.user_id, 'halftime',
             (f.v ->> 'name') || ' at half-time: ' || public.notif_statline(f.v -> 'stats'),
             v_score || ' · HT' || coalesce(' · ' || nullif(public.notif_statline_more(f.v -> 'stats'), ''), '')
               || coalesce((select string_agg(chr(10) || (o.v ->> 'name') || ': ' || public.notif_statline(o.v -> 'stats'), '' order by o.rn)
                              from fans o
                             where o.user_id = f.user_id and o.rn > 1), ''),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('audience', 'player', 'players',
               (select jsonb_agg(jsonb_build_object('id', o.v -> 'id', 'name', o.v -> 'name',
                                                    'statline', public.notif_statline_data(o.v -> 'stats')) order by o.rn)
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
      raise warning 'notify_halftime: game % skipped (%: %)', g.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- 5. THE MINUTE TICK (latest: 0121), with the half-time sweep between the lineups
-- and the count. Everything else exactly as 0121: the advisory lock, a handler per
-- step, the call only when a push is waiting, the record in notify_ticks.
-- ----------------------------------------------------------------------------
create or replace function public.notify_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fixtures int;
  v_lineups  int;
  v_halftime int;
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

  v_result := jsonb_build_object('ran_at', now(), 'fixtures', v_fixtures, 'lineups', v_lineups, 'halftime', v_halftime,
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

-- ----------------------------------------------------------------------------
-- 6. GRANTS AND OWNERSHIP (0121's rules)
-- ----------------------------------------------------------------------------
revoke all on function public.set_fan_prefs(jsonb) from public, anon;
grant execute on function public.set_fan_prefs(jsonb) to authenticated;

revoke all on function public.notif_first_half(uuid) from public, anon, authenticated;
revoke all on function public.notif_statline_data(jsonb) from public, anon, authenticated;
revoke all on function public.notify_halftime(uuid) from public, anon, authenticated;
revoke all on function public.notify_tick() from public, anon, authenticated;
grant execute on function public.notif_first_half(uuid) to service_role;
grant execute on function public.notif_statline_data(jsonb) to service_role;
grant execute on function public.notify_halftime(uuid) to service_role;
grant execute on function public.notify_tick() to service_role;

alter function public.set_fan_prefs(jsonb) owner to postgres;
alter function public.notif_first_half(uuid) owner to postgres;
alter function public.notif_statline_data(jsonb) owner to postgres;
alter function public.notify_halftime(uuid) owner to postgres;
alter function public.notify_tick() owner to postgres;

-- ============================================================================
-- SELF-TEST — the catalogue, the first-half replay, and every audience.
--
-- Seeded with the migration's own rights, all rolled back (P0115 pattern):
--   an open league with public_live, a league without it, a members-only league;
--   ght   at 0:00 of the second quarter, a log with a buzzer foul, a substitution
--         logged out of order, a minor with a steal, a descriptor written just now
--   gp3   period 3 with a full clock and a substitution logged before the restart
--   gq2   a timeout in the second quarter (2:05 left)          -> nothing
--   gq3   the state still says 0:00 but the third quarter has plays  -> nothing
--   gq1   the break after the FIRST quarter (Q2 at 10:00, subs logged) -> nothing
--   gnew  at 0:00, but a free throw written seconds ago        -> nothing
--   gold  at 0:00, state last written two hours ago            -> nothing
--   grun  at 0:00 with the clock running                        -> nothing
--   gpriv at half-time in the league without public_live        -> nothing
--   gmem  at half-time in the members-only league
-- and eight fans:
--   T    follows Reading Rockets, Quiet Home and Members Home
--   G    follows Members Home and holds a subscription to the members league
--   D    follows Reading Rockets and Ben Baker
--   P    follows Ben Baker
--   P2   follows Ben Baker, Yusef Salih and the minor
--   PM   follows the minor and a bench player who has not played
--   NHT  follows Reading Rockets and Yusef Salih, with want_halftime off
--   NR   follows Reading Rockets and Ben Baker, with want_results off
-- ============================================================================
do $test$
declare
  who        text := current_user || ' (session ' || session_user || ')';
  orig       text := current_user;
  half       text := 'fresh test accounts';
  f          text;
  have_users boolean := true;
  borrowed   uuid[];
  u_t   uuid := gen_random_uuid();  u_g   uuid := gen_random_uuid();
  u_d   uuid := gen_random_uuid();  u_p   uuid := gen_random_uuid();
  u_p2  uuid := gen_random_uuid();  u_pm  uuid := gen_random_uuid();
  u_nht uuid := gen_random_uuid();  u_nr  uuid := gen_random_uuid();
  lg_open uuid; lg_priv uuid; lg_mem uuid; se_open uuid; se_priv uuid; se_mem uuid;
  cp_open uuid; cp_priv uuid; cp_mem uuid;
  t_h uuid; t_a uuid; t_ph uuid; t_pa uuid; t_mh uuid; t_ma uuid;
  pl_baker uuid; pl_cole uuid; pl_diaz uuid; pl_eze uuid; pl_kid uuid; pl_fox uuid; pl_old uuid;
  pl_ash uuid; pl_bell uuid; pl_cobb uuid; pl_dunn uuid; pl_east uuid; pl_salih uuid;
  ght uuid; gp3 uuid; gq2 uuid; gq3 uuid; gq1 uuid; gnew uuid; gold uuid; grun uuid; gpriv uuid; gmem uuid;
  ago    timestamptz := now() - interval '5 minutes';
  v_users  uuid[];
  v_games  uuid[];
  v_labels jsonb;
  v_exp    jsonb;
  v_actual jsonb;
  v_txt    text;
  v_j      jsonb;
  v_n      bigint;
  v_r      record;
  v_score  text := 'Reading Rockets 5–7 London Lions';
  v_baker  text := '3 PTS · 2 REB · 0 AST · 1 BLK';
begin
  -- ---- the catalogue ------------------------------------------------------------
  if not exists (select 1 from pg_attribute a
                   join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = 'public.fan_prefs'::regclass and a.attname = 'want_halftime'
                    and not a.attisdropped and a.attnotnull and a.atttypid = 'boolean'::regtype
                    and pg_get_expr(d.adbin, d.adrelid) = 'true') then
    raise exception '0124: fan_prefs.want_halftime must be boolean, not null, default true';
  end if;
  if not exists (select 1 from pg_constraint k
                  where k.conrelid = 'public.notifications'::regclass and k.conname = 'notifications_kind_check'
                    and k.convalidated and pg_get_constraintdef(k.oid) like '%''halftime''%'
                    and pg_get_constraintdef(k.oid) like '%''privacy''%' and pg_get_constraintdef(k.oid) like '%''lineups''%') then
    raise exception '0124: the kind check must take halftime and keep every kind before it';
  end if;
  foreach f in array array['notify_halftime(uuid)', 'notify_tick()'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = ('public.' || f)::regprocedure and p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'postgres'
                      and p.proconfig @> array['search_path=public']) then
      raise exception '0124: % must be security definer, owned by postgres, with search_path pinned to public', f;
    end if;
  end loop;
  foreach f in array array['notif_first_half(uuid)', 'notif_statline_data(jsonb)', 'set_fan_prefs(jsonb)'] loop
    if not exists (select 1 from pg_proc p
                    where p.oid = ('public.' || f)::regprocedure and not p.prosecdef
                      and pg_get_userbyid(p.proowner) = 'postgres'
                      and p.proconfig @> array['search_path=public']) then
      raise exception '0124: % must be owned by postgres, run as its caller, with search_path pinned to public', f;
    end if;
  end loop;
  foreach f in array array['notify_halftime(uuid)', 'notify_tick()', 'notif_first_half(uuid)', 'notif_statline_data(jsonb)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute')
       or has_function_privilege('authenticated', 'public.' || f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = ('public.' || f)::regprocedure and a.grantee = 0) then
      raise exception '0124: % is callable from a browser (or by PUBLIC)', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0124: the service role cannot call %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.set_fan_prefs(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_fan_prefs(jsonb)', 'execute') then
    raise exception '0124: set_fan_prefs is for signed-in callers only';
  end if;
  if public.notif_statline_data('{"pts":12,"or":1,"dr":2,"ast":3,"stl":1,"p2m":3,"p2a":6,"p3m":2,"p3a":4,"min":870000}'::jsonb)
     is distinct from '{"pts":12,"reb":3,"ast":3,"stl":1,"blk":0,"fgm":5,"fga":10,"min":15}'::jsonb then
    raise exception '0124: notif_statline_data says %',
      public.notif_statline_data('{"pts":12,"or":1,"dr":2,"ast":3,"stl":1,"p2m":3,"p2a":6,"p3m":2,"p3a":4,"min":870000}'::jsonb);
  end if;

  begin
    -- ============================================================ seeded as the owner
    insert into leagues (slug, name, public_live) values ('zz-t124-open', '0124 Open', true) returning id into lg_open;
    insert into leagues (slug, name, public_live) values ('zz-t124-private', '0124 Private', false) returning id into lg_priv;
    insert into leagues (slug, name, public_live, access_mode, access_fixtures_public)
      values ('zz-t124-members', '0124 Members', true, 'members', false) returning id into lg_mem;
    insert into seasons (league_id, name) values (lg_open, '0124') returning id into se_open;
    insert into seasons (league_id, name) values (lg_priv, '0124') returning id into se_priv;
    insert into seasons (league_id, name) values (lg_mem, '0124') returning id into se_mem;
    insert into competitions (season_id, name) values (se_open, 'T124 Cup') returning id into cp_open;
    insert into competitions (season_id, name) values (se_priv, 'T124 Private') returning id into cp_priv;
    insert into competitions (season_id, name) values (se_mem, 'T124 Members League') returning id into cp_mem;

    insert into teams (league_id, slug, name, short_name) values (lg_open, 'zz-t124-rockets', 'Reading Rockets', 'Rockets') returning id into t_h;
    insert into teams (league_id, slug, name, short_name) values (lg_open, 'zz-t124-lions', 'London Lions', 'Lions') returning id into t_a;
    insert into teams (league_id, slug, name, short_name) values (lg_priv, 'zz-t124-qhome', 'Quiet Home', '') returning id into t_ph;
    insert into teams (league_id, slug, name, short_name) values (lg_priv, 'zz-t124-qaway', 'Quiet Away', '') returning id into t_pa;
    insert into teams (league_id, slug, name, short_name) values (lg_mem, 'zz-t124-mhome', 'Members Home', '') returning id into t_mh;
    insert into teams (league_id, slug, name, short_name) values (lg_mem, 'zz-t124-maway', 'Members Away', '') returning id into t_ma;

    insert into players (slug, first_name, last_name) values ('zz-t124-baker', 'Ben', 'Baker') returning id into pl_baker;
    insert into players (slug, first_name, last_name) values ('zz-t124-cole', 'Tom', 'Cole') returning id into pl_cole;
    insert into players (slug, first_name, last_name) values ('zz-t124-diaz', 'Dan', 'Diaz') returning id into pl_diaz;
    insert into players (slug, first_name, last_name) values ('zz-t124-eze', 'Eli', 'Eze') returning id into pl_eze;
    insert into players (slug, first_name, last_name, is_minor) values ('zz-t124-kid', 'Kiddo', 'Younger', true) returning id into pl_kid;
    insert into players (slug, first_name, last_name) values ('zz-t124-fox', 'Sam', 'Fox') returning id into pl_fox;
    insert into players (slug, first_name, last_name) values ('zz-t124-old', 'Olly', 'Bench') returning id into pl_old;
    insert into players (slug, first_name, last_name) values ('zz-t124-ash', 'Al', 'Ash') returning id into pl_ash;
    insert into players (slug, first_name, last_name) values ('zz-t124-bell', 'Bo', 'Bell') returning id into pl_bell;
    insert into players (slug, first_name, last_name) values ('zz-t124-cobb', 'Cy', 'Cobb') returning id into pl_cobb;
    insert into players (slug, first_name, last_name) values ('zz-t124-dunn', 'Di', 'Dunn') returning id into pl_dunn;
    insert into players (slug, first_name, last_name) values ('zz-t124-east', 'Ed', 'East') returning id into pl_east;
    insert into players (slug, first_name, last_name) values ('zz-t124-salih', 'Yusef', 'Salih') returning id into pl_salih;

    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, starters)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live',
              jsonb_build_array(jsonb_build_array(pl_baker, pl_cole, pl_diaz, pl_kid, pl_eze),
                                jsonb_build_array(pl_ash, pl_bell, pl_cobb, pl_dunn, pl_east)))
      returning id into ght;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live') returning id into gp3;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live') returning id into gq2;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live') returning id into gq3;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live') returning id into gq1;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live') returning id into gnew;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '3 hours', 'live') returning id into gold;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_h, t_a, now() - interval '1 hour', 'live') returning id into grun;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_priv, t_ph, t_pa, now() - interval '1 hour', 'live') returning id into gpriv;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_mem, t_mh, t_ma, now() - interval '1 hour', 'live') returning id into gmem;

    -- ght: the half, out of order where it matters
    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (ght,  1, 'p2_made', 0, pl_baker::text, 1, 590000, '{}', ago),
      (ght,  2, 'p3_made', 1, pl_ash::text,   1, 560000, '{}', ago),
      (ght,  3, 'reb',     0, pl_baker::text, 1, 400000, '{"off": true}', ago),
      (ght,  4, 'ft_made', 0, pl_baker::text, 1, 300000, '{}', ago),
      (ght,  5, 'ft_miss', 0, pl_baker::text, 1, 300000, '{}', ago),
      (ght,  6, 'sub',     1, null,           1, 200000, jsonb_build_object('in', pl_salih, 'out', pl_ash), ago),
      (ght,  7, 'period_start', null, null,   2, 600000, '{}', ago),
      (ght,  8, 'p3_made', 1, pl_salih::text, 2, 480000, '{}', ago),
      (ght,  9, 'stl',     0, pl_kid::text,   2, 480000, '{}', ago),
      (ght, 10, 'ft_made', 1, pl_salih::text, 2, 300000, '{}', ago),
      (ght, 11, 'sub',     1, null,           2, 100000, jsonb_build_object('in', pl_ash, 'out', pl_salih), ago),
      (ght, 12, 'p2_made', 0, pl_diaz::text,  2,  50000, '{}', ago),
      (ght, 13, 'blk',     0, pl_baker::text, 1, 500000, '{}', ago),
      (ght, 14, 'reb',     0, pl_baker::text, 1, 450000, '{"off": false}', ago),
      (ght, 15, 'ast',     0, pl_diaz::text,  1, 520000, '{}', ago),
      (ght, 16, 'foul',    0, pl_cole::text,  2,      0, '{"kind": "shooting"}', ago),
      (ght, 17, 'sub',     0, null,           2, 540000, jsonb_build_object('in', pl_eze, 'out', pl_fox), ago),
      (ght, 18, 'sub',     0, null,           2, 550000, jsonb_build_object('in', pl_fox, 'out', pl_eze), ago),
      (ght, 19, 'tag',     null, null,        1, 250000, '{"ref": 2, "tag": "transition"}', now());
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away, updated_at)
      values (ght, 2, 0, false, 5, 7, now());

    -- gp3: the clock set for the third quarter, a substitution logged before the restart
    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gp3, 1, 'p2_made', 0, pl_cole::text, 2, 300000, '{}', ago),
      (gp3, 2, 'period_start', null, null,  3, 600000, '{}', ago),
      (gp3, 3, 'sub', 0, null, 3, 600000, jsonb_build_object('in', pl_fox, 'out', pl_cole), ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away)
      values (gp3, 3, 600000, false, 2, 0);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gq2, 1, 'p2_made', 0, pl_baker::text, 2, 300000, '{}', ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (gq2, 2, 125000, false, 2, 0);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gq3, 1, 'p2_made', 0, pl_baker::text, 2, 300000, '{}', ago),
      (gq3, 2, 'p2_made', 1, pl_ash::text,   3, 500000, '{}', ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (gq3, 2, 0, false, 2, 2);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gq1, 1, 'p2_made', 0, pl_baker::text, 1, 300000, '{}', ago),
      (gq1, 2, 'period_start', null, null,   2, 600000, '{}', ago),
      (gq1, 3, 'sub', 0, null, 2, 600000, jsonb_build_object('in', pl_fox, 'out', pl_baker), ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (gq1, 2, 600000, false, 2, 0);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gnew, 1, 'p2_made', 0, pl_baker::text, 2, 300000, '{}', ago),
      (gnew, 2, 'ft_made', 0, pl_baker::text, 2,      0, '{}', now());
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (gnew, 2, 0, false, 3, 0);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gold, 1, 'p2_made', 0, pl_baker::text, 2, 300000, '{}', now() - interval '2 hours');
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away, updated_at)
      values (gold, 2, 0, false, 2, 0, now() - interval '2 hours');

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (grun, 1, 'p2_made', 0, pl_baker::text, 2, 300000, '{}', ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (grun, 2, 0, true, 2, 0);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gpriv, 1, 'p2_made', 0, null, 2, 300000, '{}', ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (gpriv, 2, 0, false, 2, 0);

    insert into game_events (game_id, seq, t, team, pid, period, clock, payload, created_at) values
      (gmem, 1, 'p2_made', 0, null, 2, 300000, '{}', ago);
    insert into game_state (game_id, period, clock_ms, running, score_home, score_away) values (gmem, 2, 0, false, 2, 0);

    v_games := array[ght, gp3, gq2, gq3, gq1, gnew, gold, grun, gpriv, gmem];

    -- ============================================================ the first half, replayed
    select coalesce(jsonb_agg(jsonb_build_object('p', x.player_id, 'side', x.team_idx, 'played', x.played, 'stats', x.stats)
                              order by x.team_idx, x.player_id), '[]'::jsonb)
      into v_actual
      from public.notif_first_half(ght) x;
    select coalesce(jsonb_agg(jsonb_build_object('p', e.p, 'side', e.side, 'played', true, 'stats',
                              jsonb_build_object('pts', e.pts, 'p2m', e.p2m, 'p2a', e.p2m, 'p3m', e.p3m, 'p3a', e.p3m,
                                                 'ftm', e.ftm, 'fta', e.fta, 'or', e.orb, 'dr', e.drb, 'ast', e.ast,
                                                 'stl', e.stl, 'blk', e.blk, 'to', 0, 'min', e.ms))
                              order by e.side, e.p), '[]'::jsonb)
      into v_exp
      from (values (pl_baker::text, 0, 3, 1, 0, 1, 2, 1, 1, 0, 0, 1, 1200000),
                   (pl_cole::text,  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200000),
                   (pl_diaz::text,  0, 2, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1200000),
                   (pl_kid::text,   0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1200000),
                   (pl_eze::text,   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1190000),
                   (pl_fox::text,   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   10000),
                   (pl_ash::text,   1, 3, 0, 1, 0, 0, 0, 0, 0, 0, 0,  500000),
                   (pl_bell::text,  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200000),
                   (pl_cobb::text,  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200000),
                   (pl_dunn::text,  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200000),
                   (pl_east::text,  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200000),
                   (pl_salih::text, 1, 4, 0, 1, 1, 1, 0, 0, 0, 0, 0,  700000))
             as e(p, side, pts, p2m, p3m, ftm, fta, orb, drb, ast, stl, blk, ms);
    if v_actual is distinct from v_exp then
      raise exception '0124: notif_first_half(ght) replayed % but the engine gives %', v_actual, v_exp;
    end if;
    select count(*) into v_n from public.notif_first_half(gp3) x
     where x.player_id = pl_cole::text and x.team_idx = 0 and x.played
       and x.stats = '{"pts":2,"p2m":1,"p2a":1,"p3m":0,"p3a":0,"ftm":0,"fta":0,"or":0,"dr":0,"ast":0,"stl":0,"blk":0,"to":0,"min":0}'::jsonb;
    if v_n <> 1 or (select count(*) from public.notif_first_half(gp3)) <> 1 then
      raise exception '0124: notif_first_half(gp3) must be Cole alone, 2 points and no minutes (the third-quarter substitution is not the first half)';
    end if;

    -- ============================================================ the accounts
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_t,   't124-t@example.invalid'),   (u_g,   't124-g@example.invalid'),
                     (u_d,   't124-d@example.invalid'),   (u_p,   't124-p@example.invalid'),
                     (u_p2,  't124-p2@example.invalid'),  (u_pm,  't124-pm@example.invalid'),
                     (u_nht, 't124-nht@example.invalid'), (u_nr,  't124-nr@example.invalid')) as x(id, email);
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
        u_p2 := borrowed[5]; u_pm := borrowed[6]; u_nht := borrowed[7]; u_nr := borrowed[8];
        have_users := true;
        half := 'eight borrowed profiles';
      else
        half := 'NOT RUN: ' || who || ' may not create auth.users rows and only '
                || coalesce(cardinality(borrowed), 0) || ' of 8 clean profiles exist';
      end if;
    end if;

    if have_users then
      v_users  := array[u_t, u_g, u_d, u_p, u_p2, u_pm, u_nht, u_nr];
      v_labels := jsonb_build_object(
        u_t::text, 'T', u_g::text, 'G', u_d::text, 'D', u_p::text, 'P', u_p2::text, 'P2',
        u_pm::text, 'PM', u_nht::text, 'NHT', u_nr::text, 'NR',
        ght::text, 'ght', gp3::text, 'gp3', gq2::text, 'gq2', gq3::text, 'gq3', gq1::text, 'gq1',
        gnew::text, 'gnew', gold::text, 'gold', grun::text, 'grun', gpriv::text, 'gpriv', gmem::text, 'gmem');

      insert into access_subscriptions (user_id, plan_id, league_id, features, status,
                                        stripe_subscription_id, stripe_customer_id, current_period_end)
      values (u_g, null, lg_mem, array['league'], 'active', 'sub_T124g', 'cus_T124g', now() + interval '20 days');

      insert into fan_prefs as fp (user_id, fav_team_ids, fav_player_ids, fav_game_ids,
                                   want_results, want_players, want_halftime, notify_inapp, notify_email, notify_push)
      values
        (u_t,   array[t_h, t_ph, t_mh], '{}', '{}', true, true, true, true, false, false),
        (u_g,   array[t_mh], '{}', '{}', true, true, true, true, false, false),
        (u_d,   array[t_h], array[pl_baker], '{}', true, true, true, true, false, false),
        (u_p,   '{}', array[pl_baker], '{}', true, true, true, true, false, false),
        (u_p2,  '{}', array[pl_baker, pl_salih, pl_kid], '{}', true, true, true, true, false, false),
        (u_pm,  '{}', array[pl_kid, pl_old], '{}', true, true, true, true, false, false),
        (u_nht, array[t_h], array[pl_salih], '{}', true, true, false, true, false, false),
        (u_nr,  array[t_h], array[pl_baker], '{}', false, true, true, true, false, false)
      on conflict (user_id) do update
        set fav_team_ids = excluded.fav_team_ids, fav_player_ids = excluded.fav_player_ids,
            fav_game_ids = excluded.fav_game_ids, want_results = excluded.want_results,
            want_players = excluded.want_players, want_halftime = excluded.want_halftime,
            notify_inapp = excluded.notify_inapp, notify_email = excluded.notify_email,
            notify_push = excluded.notify_push;

      -- the kind
      insert into notifications (user_id, kind, title, ref) values (u_t, 'halftime', '0124', 't124-kind');
      delete from notifications n where n.user_id = u_t and n.ref = 't124-kind';

      -- ============================================================ memberships on
      if public.memberships_enabled() then
        raise exception '0124: memberships are switched on before the self-test switched them on; 0117 ships them off';
      end if;
      update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
      if not found or not public.memberships_enabled() then
        raise exception '0124: could not switch memberships on for the self-test';
      end if;

      perform public.notify_halftime();

      v_exp := jsonb_build_array(
        jsonb_build_object('who', 'T',  'ref', 'ght:ht', 'title', 'HT · ' || v_score, 'body', 'Top scorers: Baker 3, Salih 4'),
        jsonb_build_object('who', 'D',  'ref', 'ght:ht', 'title', 'HT · ' || v_score,
                           'body', 'Ben Baker: ' || v_baker || chr(10) || 'Top scorers: Baker 3, Salih 4'),
        jsonb_build_object('who', 'P',  'ref', 'ght:ht', 'title', 'Ben Baker at half-time: ' || v_baker,
                           'body', v_score || ' · HT · 1/1 FG · 20 MIN'),
        jsonb_build_object('who', 'NR', 'ref', 'ght:ht', 'title', 'Ben Baker at half-time: ' || v_baker,
                           'body', v_score || ' · HT · 1/1 FG · 20 MIN'),
        jsonb_build_object('who', 'P2', 'ref', 'ght:ht', 'title', 'Yusef Salih at half-time: 4 PTS · 0 REB · 0 AST',
                           'body', v_score || ' · HT · 1/1 FG · 12 MIN' || chr(10) || 'Ben Baker: ' || v_baker),
        jsonb_build_object('who', 'T',  'ref', 'gp3:ht', 'title', 'HT · Reading Rockets 2–0 London Lions', 'body', 'Top scorer: Cole 2'),
        jsonb_build_object('who', 'D',  'ref', 'gp3:ht', 'title', 'HT · Reading Rockets 2–0 London Lions', 'body', 'Top scorer: Cole 2'),
        jsonb_build_object('who', 'G',  'ref', 'gmem:ht', 'title', 'HT · Members Home 2–0 Members Away', 'body', 'T124 Members League'));

      select coalesce(jsonb_agg(jsonb_build_object(
               'who', v_labels ->> n.user_id::text,
               'ref', (v_labels ->> split_part(n.ref, ':', 1)) || ':' || split_part(n.ref, ':', 2),
               'title', n.title, 'body', n.body)), '[]'::jsonb)
        into v_actual
        from notifications n
       where n.user_id = any (v_users) and n.game_id = any (v_games);
      select string_agg(z.d, '; ' order by z.d) into v_txt
        from (select 'UNEXPECTED ' || u.value::text as d
                from (select value from jsonb_array_elements(v_actual)
                      except all select value from jsonb_array_elements(v_exp)) u
              union all
              select 'MISSING ' || m.value::text
                from (select value from jsonb_array_elements(v_exp)
                      except all select value from jsonb_array_elements(v_actual)) m) z;
      if v_txt is not null then
        raise exception '0124: the half-time notices: %', v_txt;
      end if;

      select * into v_r from notifications n where n.user_id = u_p and n.game_id = ght;
      if v_r.kind <> 'halftime' or v_r.urgency <> 'high' or v_r.expires_at <> now() + interval '20 minutes'
         or v_r.link <> 'game/?g=' || ght || '&mode=supabase' or v_r.league_id <> lg_open
         or v_r.data -> 'score' <> '[5, 7]'::jsonb or v_r.data ->> 'period' <> '2' or v_r.data ->> 'audience' <> 'player'
         or v_r.data -> 'players' <> jsonb_build_array(jsonb_build_object('id', pl_baker, 'name', 'Ben Baker',
              'statline', '{"pts":3,"reb":2,"ast":0,"stl":0,"blk":1,"fgm":1,"fga":1,"min":20}'::jsonb))
         or v_r.data -> 'leaders' <> jsonb_build_array(
              jsonb_build_object('id', pl_baker, 'name', 'Ben Baker', 'side', 0, 'pts', 3),
              jsonb_build_object('id', pl_salih, 'name', 'Yusef Salih', 'side', 1, 'pts', 4))
         or v_r.data ->> 'game' <> ght::text then
        raise exception '0124: P''s notice carries %', to_jsonb(v_r);
      end if;
      select * into v_r from notifications n where n.user_id = u_d and n.game_id = ght;
      if v_r.data ->> 'audience' <> 'club' or jsonb_array_length(v_r.data -> 'players') <> 1
         or v_r.data -> 'players' -> 0 ->> 'id' <> pl_baker::text then
        raise exception '0124: D''s club notice carries %', v_r.data;
      end if;
      select * into v_r from notifications n where n.user_id = u_t and n.game_id = ght;
      if v_r.data -> 'players' <> '[]'::jsonb or v_r.data ->> 'audience' <> 'club' then
        raise exception '0124: T''s club notice carries players %', v_r.data;
      end if;
      if exists (select 1 from notifications n
                  where n.game_id = any (v_games) and n.kind = 'halftime'
                    and (n.title || coalesce(n.body, '') || n.data::text) ~ '(Younger|Kiddo)') then
        raise exception '0124: the minor was named in a half-time notice';
      end if;

      v_n := public.notify_halftime();
      if v_n <> 0 then
        raise exception '0124: a second sweep wrote % half-time rows', v_n;
      end if;
      v_n := public.notify_halftime(ght);
      if v_n <> 0 then
        raise exception '0124: notify_halftime(ght) wrote % rows a second time', v_n;
      end if;
      foreach f in array array[gq2, gq3, gq1, gnew, gold, grun, gpriv]::text[] loop
        if public.notify_halftime(f::uuid) <> 0 then
          raise exception '0124: % is not at half-time, or not public, and was announced', v_labels ->> f;
        end if;
      end loop;

      -- ============================================================ memberships off
      update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
      v_n := public.notify_halftime(gmem);
      if v_n <> 1 or not exists (select 1 from notifications n where n.user_id = u_t and n.game_id = gmem
                                    and n.title = 'HT · Members Home 2–0 Members Away') then
        raise exception '0124: with memberships off, the members league''s half-time went to % rather than T alone', v_n;
      end if;

      -- ============================================================ the tick and the switch
      -- the tick must sweep half-time itself: take P's notice away and let it write it back
      delete from notifications n where n.user_id = u_p and n.game_id = ght and n.kind = 'halftime';
      v_j := public.notify_tick();
      if not (v_j ? 'halftime') or v_j -> 'errors' <> '[]'::jsonb or coalesce((v_j ->> 'halftime')::int, 0) < 1
         or not exists (select 1 from notifications n where n.user_id = u_p and n.game_id = ght and n.kind = 'halftime'
                          and n.title = 'Ben Baker at half-time: ' || v_baker) then
        raise exception '0124: notify_tick did not write the half-time notice it should have swept: %', v_j;
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.set_fan_prefs('{"want_halftime": false}'::jsonb);
      perform public.set_fan_prefs('{"want_results": true}'::jsonb);
      begin
        perform public.notify_halftime();
        execute format('set local role %I', orig);
        raise exception '0124: signed in, notify_halftime ran';
      exception when insufficient_privilege then null;
      end;
      execute format('set local role %I', orig);
      if (select p.want_halftime from fan_prefs p where p.user_id = u_t) is distinct from false then
        raise exception '0124: set_fan_prefs did not keep want_halftime off';
      end if;
    end if;

    raise exception using errcode = 'P0124', message = '0124 passed; rolling its test rows back';
  exception
    when sqlstate 'P0124' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug like 'zz-t124-%')
     or exists (select 1 from players where slug like 'zz-t124-%') then
    raise exception '0124: the test rows outlived their rollback';
  end if;
  if public.memberships_enabled()
     or (select s.value from platform_settings s where s.key = 'memberships_enabled') is distinct from 'false'::jsonb then
    raise exception '0124: the self-test left memberships switched on';
  end if;

  raise notice '0124 ok: halftime kind and switch in place, closed to browsers; the first half replays in the engine''s terms (points, rebounds, minutes in game order); the notice goes to exactly the fans and games the contract names, once, the minor never named; the members-only rule holds; the tick sweeps it; set_fan_prefs takes want_halftime. Ran with %', half;
end $test$;
