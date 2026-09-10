-- 0107  Follow one game.
--
-- A fan can follow a club or a player (0106); this lets them follow a single fixture from the
-- bell beside it -- the reminder three days out and on the day, and the final score -- without
-- following either club. fav_game_ids joins the other two lists; set_fan_prefs accepts it and
-- the two fan-outs include it.

alter table public.fan_prefs add column if not exists fav_game_ids uuid[] not null default '{}';

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
    notify_inapp       = coalesce((p->>'notify_inapp')::boolean, notify_inapp),
    notify_email       = coalesce((p->>'notify_email')::boolean, notify_email),
    notify_push        = coalesce((p->>'notify_push')::boolean, notify_push),
    want_results       = coalesce((p->>'want_results')::boolean, want_results),
    want_players       = coalesce((p->>'want_players')::boolean, want_players),
    want_fixtures      = coalesce((p->>'want_fixtures')::boolean, want_fixtures),
    want_announcements = coalesce((p->>'want_announcements')::boolean, want_announcements),
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

create or replace function public.notify_game_final(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare g record; h record; w record; lg uuid; n int := 0; c int; title text; link text; comp text;
begin
  select * into g from games where id = p_game;
  if not found or g.status not in ('final', 'finalising') then return 0; end if;
  select * into h from teams where id = g.home_team_id;
  select * into w from teams where id = g.away_team_id;
  lg := game_league(p_game);
  select name into comp from competitions where id = g.competition_id;
  title := coalesce(h.name, 'Home') || ' ' || coalesce(g.home_score, 0) || '–' || coalesce(g.away_score, 0) || ' ' || coalesce(w.name, 'Away');
  link := 'game/?g=' || g.id || '&mode=supabase';

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'result', title, coalesce(comp, 'Final score'), link, lg, g.id, g.id::text
    from fan_prefs p
   where (p.want_results and (g.home_team_id = any(p.fav_team_ids) or g.away_team_id = any(p.fav_team_ids)))
      or g.id = any(p.fav_game_ids)
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'player',
         trim(pl.first_name || ' ' || pl.last_name) || ': ' ||
           coalesce((s.stats->>'pts')::int, 0) || ' pts, ' ||
           (coalesce((s.stats->>'or')::int, 0) + coalesce((s.stats->>'dr')::int, 0)) || ' reb, ' ||
           coalesce((s.stats->>'ast')::int, 0) || ' ast',
         title, link || '&vp=' || pl.id, lg, g.id, g.id::text || ':' || pl.id
    from fan_prefs p
    join players pl on pl.id = any(p.fav_player_ids) and not pl.is_minor
    join player_game_stats s on s.game_id = g.id and s.player_id = pl.id::text
   where p.want_players
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;

create or replace function public.notify_fixtures()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'fixture',
         coalesce(h.name, 'Home') || ' v ' || coalesce(w.name, 'Away'),
         to_char(g.tipoff_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || coalesce(' · ' || g.venue, ''),
         'game/?g=' || g.id || '&mode=supabase', game_league(g.id), g.id,
         g.id::text || case when g.tipoff_at < now() + interval '26 hours' then ':today' else ':soon' end
    from games g
    join teams h on h.id = g.home_team_id
    join teams w on w.id = g.away_team_id
    join fan_prefs p on (p.want_fixtures and (g.home_team_id = any(p.fav_team_ids) or g.away_team_id = any(p.fav_team_ids)))
                     or g.id = any(p.fav_game_ids)
   where g.status = 'scheduled' and g.tipoff_at > now() and g.tipoff_at < now() + interval '3 days'
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_fixtures() from public, anon, authenticated;
