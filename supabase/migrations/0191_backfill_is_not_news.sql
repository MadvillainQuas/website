-- ============================================================================
-- 0191: A BACKFILL IS NOT NEWS - no match report and no "FT" alert for a game finalised long after it
--       was played.
--
-- finalise-game writes a match report for every game it closes (0069, when the league's auto_reports
-- is on) and tells every follower of either club (notify_game_final). That is right at the final
-- whistle and wrong for a backfill: loading a league's past season, or starting a league again
-- (0187), finalises every game it has ever played, which filed a report per game - a news page of
-- last season's results, newest first - and would push "FT" to every follower for each one.
--
-- Both are asked of the database first, so both answers change here and finalise-game needs no new
-- deploy: a game that tipped off more than 36 hours before it is finalised gets no report and no
-- alert. A game that already HAS a report keeps being given one - re-finalising after a correction
-- still rewrites the article it already has (the report is upserted by the game's own slug).
-- ============================================================================

create or replace function public.game_report_target(p_game uuid)
returns table (league_id uuid, league_name text, auto_reports boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.name,
         l.auto_reports
         and (g.tipoff_at is null
              or g.tipoff_at > now() - interval '36 hours'
              or exists (select 1 from news_articles a where a.game_id = g.id))
    from games g
    join competitions c on c.id = g.competition_id
    join seasons s      on s.id = c.season_id
    join leagues l      on l.id = s.league_id
   where g.id = p_game;
$$;
grant execute on function public.game_report_target(uuid) to authenticated, service_role;

-- 0147's body, unchanged but for the one guard marked 0191
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
  v_private      boolean;                                  -- 0147
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
  -- 0191: a result is news only while the game is - a backfill finalising last season tells nobody
  if g.tipoff_at is not null and g.tipoff_at < now() - interval '36 hours' then return 0; end if;
  select * into h from teams where id = g.home_team_id;
  select * into w from teams where id = g.away_team_id;
  lg := game_league(p_game);
  select l.access_mode = 'members' into v_members_only from leagues l where l.id = lg;
  v_members_only := coalesce(v_members_only, false) and public.memberships_enabled();
  v_private := coalesce((select l.visibility = 'private' from leagues l where l.id = lg), false);   -- 0147
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
     and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, lg)))          -- 0147
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
     and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, lg)))          -- 0147
     and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, lg)))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;
grant execute on function public.notify_game_final(uuid) to service_role;
