-- 0138_notify_result_league_audience.sql
--
-- THE RESULT NOTIFICATION FORGOT WHAT A LEAGUE FOLLOW MEANS.
--
-- 0133 taught every fan-out to read notify_audience instead of fan_prefs directly: the view
-- expands a fan's fav_team_ids to include every club in any league they follow whole
-- (fav_league_ids), and unions in push_devices so a phone that pressed a league's own
-- notification button (0127) counts as an audience member too, with no account at all.
-- notify_game_final was one of the fan-outs that migration already covered -- 0127 (the
-- migration before 0133) had it reading `from notify_audience p` with `p.device_id` in its
-- insert list, same as every other fan-out.
--
-- 0137 then reintroduced the result row's body (top scorers) by copying "notify_game_final
-- (0121), unchanged except the body" -- 0121, not 0127. That silently reverted the audience
-- source back to plain `fan_prefs` and dropped device_id, undoing 0127's fix two migrations
-- before 0133 even shipped. The result: a fan who follows an entire league (rather than
-- picking Bristol Flyers and London Lions individually) correctly gets that game's fixture,
-- lineups and half-time notices -- all three still read notify_audience -- and then never
-- gets told who won (reported 2026-09-19, a league-follower's dropdown showing HT but no FT
-- for Bristol Flyers 78-80 London Lions). Anyone following by push_devices was silently
-- dropped from results the same way.
--
-- The fix is exactly 0127's shape again, with 0137's top-scorer body kept. Nothing about the
-- SCHEMA changed since 0127 (notify_audience.device_id already exists, notifications.device_id
-- already exists), so this is a pure regression fix: swap the audience source and the two
-- notification kinds' insert columns back, no migration of existing rows needed.
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
  v_home_top     text;
  v_away_top     text;
  v_body         text;
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

  v_home_top := public.notif_top_scorers(p_game, 0, 3);
  v_away_top := public.notif_top_scorers(p_game, 1, 3);
  v_body := concat_ws(' · ', comp,
              case when v_home_top is not null then coalesce(h.short_name, h.name) || ': ' || v_home_top end,
              case when v_away_top is not null then coalesce(w.short_name, w.name) || ': ' || v_away_top end);

  -- the club, league and game followers (notify_audience: fan_prefs expanded by fav_league_ids,
  -- unioned with push_devices) -- restored from notify_audience back to plain fan_prefs by 0137
  insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, p.device_id, 'result', 'FT · ' || v_score, coalesce(nullif(v_body, ''), 'Final score'), v_link, lg, g.id, g.id::text,
         v_data, 'high', v_expires
    from notify_audience p
   where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
          or g.id = any (p.fav_game_ids))
     and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, lg)))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- fans of a player who played, wherever they follow him from
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

revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;
grant execute on function public.notify_game_final(uuid) to service_role;
alter function public.notify_game_final(uuid) owner to postgres;

-- Prove the regression is actually gone: notify_audience's device_id column belongs in the
-- insert list, and the function body must mention notify_audience rather than reading
-- fan_prefs directly for either insert -- the same shape check 0127 could have used to
-- catch 0137's copy-from-the-wrong-baseline before it shipped.
do $$
declare def text;
begin
  select pg_get_functiondef('public.notify_game_final(uuid)'::regprocedure) into def;
  if def !~ 'from notify_audience p' or (select count(*) from regexp_matches(def, 'from notify_audience p', 'g')) < 2 then
    raise exception '0138: notify_game_final must read notify_audience for both the result and player inserts';
  end if;
  if def !~ 'p\.device_id' then
    raise exception '0138: notify_game_final dropped device_id again -- push_devices followers would stop getting results';
  end if;
  if def ~ 'from fan_prefs p' then
    raise exception '0138: notify_game_final still reads fan_prefs directly somewhere -- league-follow and device audiences would be skipped';
  end if;
  raise notice '0138 ok: notify_game_final reads notify_audience (league expansion + push_devices) for both result and player rows again';
end $$;

-- Louie's own report (2026-09-19): Bristol Flyers 78-80 London Lions, game
-- 4669f4e8-ef1e-44ab-986e-690134ebcd2c, already finalised under the broken version, so its
-- 'result' rows were already written for the fans this bug did not skip. The insert above is
-- `on conflict do nothing` keyed on (user_id, kind, ref) (0121) -- for a user_id that was never
-- inserted the first time, there is nothing to conflict against, so calling notify_game_final
-- for this one already-final game again is a precise backfill of exactly the rows this bug
-- skipped, with no risk of duplicating or touching anyone already notified. Left to a
-- follow-up call rather than baked into this migration, since it is a one-off data repair for
-- one specific game rather than a schema change.
