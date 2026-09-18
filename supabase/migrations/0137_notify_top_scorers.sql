-- 0137_notify_top_scorers.sql
--
-- THE RESULT NOTIFICATION SAYS WHO DID IT, NOT JUST WHO WON. notify_game_final's 'result'
-- row (0121) read "FT · Denain 82–70 Fos-sur-Mer" with the competition name underneath and
-- nothing else -- every fan following either club got the score and had to open the game to
-- find out who actually put it up. The three players who scored most for each side answer
-- that in the one line a phone actually shows.
--
-- notif_top_scorers mirrors notif_statline's shape exactly: SQL, immutable-safe (STABLE, since
-- it reads tables), one job, reused wherever a scoreline needs its scorers. A player withheld
-- from a personal statline (0121's player_withheld — a minor without published consent) is
-- withheld here too: this line goes out to everyone following either club, which is a wider
-- audience than the one player-specific notification already guards for.
create or replace function public.notif_top_scorers(p_game uuid, p_team_idx int, p_n int default 3)
returns text language sql stable set search_path = public as $$
  select string_agg(x.line, ', ' order by x.pts desc, x.line)
    from (
      select btrim(coalesce(left(pl.first_name, 1) || '. ', '') || pl.last_name)
             || ' ' || round(public.notif_num(s.stats, 'pts'))::int as line,
             public.notif_num(s.stats, 'pts') as pts
        from player_game_stats s
        join players pl on pl.id::text = s.player_id
       where s.game_id = p_game and s.team_idx = p_team_idx
         and not public.player_withheld(pl.is_minor, pl.public_consent)
         and public.notif_num(s.stats, 'pts') > 0
       order by public.notif_num(s.stats, 'pts') desc
       limit greatest(1, p_n)
    ) x;
$$;

revoke all on function public.notif_top_scorers(uuid, int, int) from public, anon, authenticated;
grant execute on function public.notif_top_scorers(uuid, int, int) to service_role;
alter function public.notif_top_scorers(uuid, int, int) owner to postgres;

-- notify_game_final (0121), unchanged except the 'result' row's body: the competition name,
-- then each side's scorers, home first. A side with nobody eligible (an U-consent roster, or
-- a game with no stat line yet) drops out of the join cleanly rather than leaving a stray '·'.
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

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, 'result', 'FT · ' || v_score, coalesce(nullif(v_body, ''), 'Final score'), v_link, lg, g.id, g.id::text,
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

revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;
grant execute on function public.notify_game_final(uuid) to service_role;
alter function public.notify_game_final(uuid) owner to postgres;

-- No self-test here. 0121's self-test inserts and deletes a whole fixture (league, competition,
-- teams, players, a game) in one DO block, and this project's `db push` is NON-TRANSACTIONAL
-- (see epinoia-fans-notifications memory) -- a raised exception here does not guarantee the
-- inserts above it are rolled back, so a failing self-test could leave a "0137 test league"
-- sitting in the production tables it just wrote to. notif_top_scorers is instead checked
-- read-only, after this deploys, against a real finished game already in the database
-- (`select notif_top_scorers(<a real final game id>, 0)`), which proves the same thing without
-- writing anything.
