-- ============================================================================
-- 0206: NCAA D2 / D3 READY - GAMES IN TWO HALVES, AND THE INDEXES A COLLEGE SEASON NEEDS
--         (docs/ncaa-readiness.md)
--
-- NCAA MEN PLAY TWO 20-MINUTE HALVES. Three database rules assumed four 10-minute quarters:
--
--   close_stuck_games (0203)  a game stuck live is FINAL only when "the fourth period or later was over or
--                             decided": a game in halves never reaches period 4, so every stuck NCAA men's
--                             game would have been VOID, its result thrown away;
--   notify_halftime (0147)    half-time is "period 2 at 0:00, or period 3 before a play": in halves that is
--                             the END of the game (or overtime), so the half-time notice never went at the
--                             half and could go at full time;
--   notif_first_half (0124)   the first-half lines (period <= 2, ten-minute periods): in halves, the whole
--                             game, with minutes measured on a ten-minute clock.
--
-- Each is re-stated from its latest definition with ONLY the lines tagged "-- 0206" changed: the period that
-- ends the half (h) and a period's length (pl) come from public.game_in_halves(game, league rules), which
-- says halves when the league's rules say periods = 2 OR the game's own log shows a first- or second-period
-- clock above 10:00 (no quarter ever starts above 10:00: not one of the 1.15 million events on the live
-- database on 2026-10-01 has one; epinoia/engine.js formatOf reads the log the same way). Every game the
-- platform held before NCAA is in quarters by both tests, so for them h = 2, pl = 600000 and all three
-- functions do exactly what they did. The privacy and paywall gates of 0147 are untouched (one of each per
-- audience, as privateleagues.test.mjs checks).
--
-- AND THE INDEXES. ~1,460 more clubs and 30-35k more games a season (several hundred on one US evening):
--   games (competition_id, tipoff_at)          a league's fixtures and results, in order, without a sort of
--                                              its whole season (an NCAA division is ~5,000 games);
--   external_games (competition_code, tipoff_at) where external_status <> 'final'
--                                              the live lane's and the catch-up's question, every pass: the
--                                              games of these sources around now that are not final;
--   competition_teams (team_id)                a club's competitions (its page), where the key leads with
--                                              the competition;
--   standings (team_id)                        the same for its table rows;
--   game_events (game_id) where period <= 2 and clock > 600000
--                                              game_in_halves' own question, answered from an index that only
--                                              ever holds the first ten minutes of games played in halves.
-- All "if not exists" and additive. NOT CONCURRENTLY: a migration runs in a transaction, where CREATE INDEX
-- CONCURRENTLY is refused. On today's tables each builds in well under a second (games 12.8k rows,
-- external_games 12.9k, game_events 1.15M - the partial one reads the table once but writes almost nothing).
-- Pushed in the morning UTC, when no league is live, the brief lock is not noticed.
-- ============================================================================

-- ---------------------------------------------------------------------------- the format question
create or replace function public.game_in_halves(p_game uuid, p_rules jsonb default null)
returns boolean language sql stable set search_path = public as $$
  select coalesce(p_rules ->> 'periods', '') = '2'
      or exists (select 1 from public.game_events e
                  where e.game_id = p_game and e.period <= 2 and e.clock > 600000);
$$;
alter function public.game_in_halves(uuid, jsonb) owner to postgres;
revoke all on function public.game_in_halves(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.game_in_halves(uuid, jsonb) to service_role;
comment on function public.game_in_halves(uuid, jsonb) is
  'True for a game played in two halves (NCAA men): the league rules say periods = 2, or its log shows a first- or '
  'second-period clock above 10:00. Quarters otherwise. epinoia/engine.js formatOf asks the same. See 0206.';

create index if not exists game_events_halves on public.game_events (game_id) where period <= 2 and clock > 600000;

-- ---------------------------------------------------------------------------- a stuck game in halves (latest: 0203)
create or replace function public.close_stuck_games(
  p_hard_hours numeric default 24,
  p_ids        uuid[]  default null,
  p_dry        boolean default false
) returns table (game_id uuid, was text, verdict text, reason text, home_score int, away_score int)
language plpgsql security definer set search_path = public as $$
declare
  g        record;
  v_hs     int;  v_as int;  v_per int;  v_ms int;  v_lead int;
  v_reg    int;                                                            -- 0206: regulation periods, 4 or 2
  v_verdict text;  v_reason text;
  v_comps  uuid[] := '{}';
begin
  for g in
    select ga.id, ga.status::text as st, ga.competition_id, ga.tipoff_at,
           ga.home_score as g_hs, ga.away_score as g_as, ga.period as g_per,
           s.score_home, s.score_away, s.period as s_per, s.clock_ms,
           (select e.external_status from external_games e where e.game_id = ga.id order by e.ingested_at desc nulls last limit 1) as feed,
           (select l.rules from competitions c join seasons se on se.id = c.season_id join leagues l on l.id = se.league_id
             where c.id = ga.competition_id) as rules                                                            -- 0206
      from games ga
      left join game_state s on s.game_id = ga.id
     where ga.status::text in ('live', 'finalising')
       and ga.tipoff_at < now() - make_interval(secs => greatest(coalesce(p_hard_hours, 24), 1) * 3600)
       and (p_ids is null or ga.id = any (p_ids))
     order by ga.tipoff_at
  loop
    v_hs   := coalesce(g.score_home, g.g_hs, 0);
    v_as   := coalesce(g.score_away, g.g_as, 0);
    v_per  := coalesce(g.s_per, g.g_per, 0);
    v_ms   := coalesce(g.clock_ms, 0);
    v_lead := abs(v_hs - v_as);
    v_reg  := case when public.game_in_halves(g.id, g.rules) then 2 else 4 end;                                   -- 0206

    -- 0206: the last regulation period (the fourth quarter, or the second half) or later
    if v_hs <> v_as and v_per >= v_reg and (v_ms = 0 or v_lead > 3 * ceil(v_ms / 12000.0)) then
      v_verdict := 'final';
      v_reason  := format('period %s, %s left, %s-%s: over or decided when the feed stopped',
                          v_per, to_char(make_interval(secs => v_ms / 1000.0), 'MI:SS'), v_hs, v_as);
    elsif v_hs <> v_as and g.feed = 'final' then
      v_verdict := 'final';
      v_reason  := format('the feed called it final (%s-%s); finalise-game never accepted it', v_hs, v_as);
    else
      v_verdict := 'void';
      v_reason  := format('the feed stopped in period %s with %s left at %s-%s: no result to stand on',
                          v_per, to_char(make_interval(secs => v_ms / 1000.0), 'MI:SS'), v_hs, v_as);
    end if;

    game_id := g.id; was := g.st; verdict := v_verdict; reason := v_reason; home_score := v_hs; away_score := v_as;

    if not p_dry then
      if v_verdict = 'final' then
        update games set status = 'final', home_score = v_hs, away_score = v_as, period = greatest(v_per, 1),
                         finalised_at = coalesce(finalised_at, now()), stalled_since = null
         where id = g.id;
      else
        update games set status = 'void', stalled_since = null where id = g.id;
      end if;
      update external_games set external_status = 'final',
             error = left('reconciled (' || v_verdict || '): ' || v_reason, 500)
       where external_games.game_id = g.id;
      insert into audit_log (actor, action, subject, subject_id, detail)
      values (null, 'close_stuck_game', 'game', g.id::text,
              jsonb_build_object('was', g.st, 'verdict', v_verdict, 'reason', v_reason,
                                 'period', v_per, 'clock_ms', v_ms, 'home', v_hs, 'away', v_as,
                                 'tipoff_at', g.tipoff_at));
      if g.competition_id is not null and not (g.competition_id = any (v_comps)) then
        v_comps := v_comps || g.competition_id;
      end if;
    end if;
    return next;
  end loop;

  -- the tables count final games only: rebuilt once per competition touched
  if array_length(v_comps, 1) is not null then
    for g in select unnest(v_comps) as cid loop
      begin
        perform public.recompute_standings(g.cid);
      exception when others then
        raise warning '0203: standings of % not rebuilt: %', g.cid, sqlerrm;
      end;
    end loop;
  end if;
end $$;

alter function public.close_stuck_games(numeric, uuid[], boolean) owner to postgres;
revoke all on function public.close_stuck_games(numeric, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.close_stuck_games(numeric, uuid[], boolean) to service_role;

-- ---------------------------------------------------------------------------- the first half's lines (latest: 0124)
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
  v_h        int := 2;          -- 0206: the period that ends the half (2 of 4 quarters, 1 of 2 halves)
  v_pl       int := 600000;     -- 0206: its length
begin
  select gm.starters into v_starters from games gm where gm.id = p_game;
  if public.game_in_halves(p_game, (select l.rules from games gm join competitions c on c.id = gm.competition_id   -- 0206
                                       join seasons s on s.id = c.season_id join leagues l on l.id = s.league_id      -- 0206
                                      where gm.id = p_game)) then                                                    -- 0206
    v_h := 1; v_pl := 1200000;                                                                                       -- 0206
  end if;                                                                                                            -- 0206

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

  -- engine.js: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN), ten-minute quarters or twenty-minute halves
  for e in
    select s.p_in, s.p_out, s.team, s.at_ms
      from (select lower(nullif(ev.payload ->> 'in', ''))  as p_in,
                   lower(nullif(ev.payload ->> 'out', '')) as p_out,
                   ev.team, ev.seq,
                   (coalesce(nullif(ev.period, 0), 1) - 1) * v_pl + v_pl - coalesce(ev.clock, v_pl) as at_ms   -- 0206
              from game_events ev
             where ev.game_id = p_game
               and ev.t = 'sub'
               and coalesce(nullif(ev.period, 0), 1) <= v_h) s   -- 0206
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

  -- on court at the half: credited to its end (20:00 elapsed, in quarters or in halves)
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
       and coalesce(nullif(g.period, 0), 1) <= v_h   -- 0206
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

alter function public.notif_first_half(uuid) owner to postgres;
revoke all on function public.notif_first_half(uuid) from public, anon, authenticated;
grant execute on function public.notif_first_half(uuid) to service_role;

-- ---------------------------------------------------------------------------- the half-time notice (latest: 0147)
create or replace function public.notify_halftime(p_game uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  n              int := 0;
  c              int;
  v_n            int;
  v_memberships  boolean := public.memberships_enabled();
  v_members_only boolean;
  v_private      boolean;                                  -- 0147
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
           l.access_mode,
           f.h                                                                     -- 0206
      from games gm
      join game_state gs   on gs.game_id = gm.id
      join teams h         on h.id = gm.home_team_id
      join teams a         on a.id = gm.away_team_id
      join competitions cp on cp.id = gm.competition_id
      join seasons s       on s.id = cp.season_id
      join leagues l       on l.id = s.league_id
      -- 0206: the half ends with period h (the second quarter, or the first of two halves) of pl ms
      cross join lateral (select case when public.game_in_halves(gm.id, l.rules) then 1 else 2 end as h,          -- 0206
                                 case when public.game_in_halves(gm.id, l.rules) then 1200000 else 600000 end as pl) f   -- 0206
     where (p_game is null or gm.id = p_game)
       and gm.status = 'live'
       and coalesce(l.public_live, false)
       and not gs.running
       and gs.updated_at >= now() - interval '30 minutes'
       and ((gs.period = f.h and (gs.clock_ms <= 0 or gs.clock_ms >= f.pl))                                  -- 0206
            or (gs.period = f.h + 1 and gs.clock_ms >= f.pl))                                                   -- 0206
       -- the period that ends the half was played, the one after it was not
       and exists (select 1 from game_events e
                    where e.game_id = gm.id and e.period = f.h and e.clock < f.pl and e.t <> 'period_start')     -- 0206
       and not exists (select 1 from game_events e
                        where e.game_id = gm.id and e.period >= f.h + 1 and coalesce(e.clock, f.pl) < f.pl       -- 0206
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
      v_private := coalesce((select l.visibility = 'private' from leagues l where l.id = g.league_id), false);   -- 0147
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
                  'period', g.h,                                                          -- 0206
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
         and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))          -- 0147
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
           and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))          -- 0147
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

revoke all on function public.notify_halftime(uuid) from public, anon, authenticated;
grant execute on function public.notify_halftime(uuid) to service_role;
alter function public.notify_halftime(uuid) owner to postgres;

-- ---------------------------------------------------------------------------- the indexes
create index if not exists games_competition_tipoff on public.games (competition_id, tipoff_at);
create index if not exists external_games_open_code_tipoff on public.external_games (competition_code, tipoff_at)
  where external_status <> 'final';
create index if not exists competition_teams_team on public.competition_teams (team_id);
create index if not exists standings_team on public.standings (team_id);

-- ---------------------------------------------------------------------------- self-test
do $$
begin
  if public.game_in_halves(gen_random_uuid(), '{"periods": 4}'::jsonb) then
    raise exception '0206: a game with no events in a quarters league must be in quarters';
  end if;
  if not public.game_in_halves(gen_random_uuid(), '{"periods": 2}'::jsonb) then
    raise exception '0206: a league whose rules say two periods plays halves';
  end if;
  if public.game_in_halves(gen_random_uuid(), null) then
    raise exception '0206: no rules and no log is quarters';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.notify_halftime(uuid)'::regprocedure and p.prosecdef
                   and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig @> array['search_path=public']) then
    raise exception '0206: notify_halftime must stay security definer, owned by postgres, search_path pinned';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.notif_first_half(uuid)'::regprocedure and not p.prosecdef
                   and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig @> array['search_path=public']) then
    raise exception '0206: notif_first_half must stay an invoker function, owned by postgres, search_path pinned';
  end if;
end $$;
