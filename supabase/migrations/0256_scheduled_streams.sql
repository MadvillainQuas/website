-- ============================================================================
-- 0256  SCHEDULED STREAMS: a game to be streamed here is said before it starts, and its followers are told when it does
--
-- Louie, 2026-10-08: a channel publishes its stream days before the game ("LIVE SLB CHAMPIONSHIP ACTION: B. Braun
-- Sheffield Sharks vs Leicester Riders", out on the 8th for the 11th). The feed's matcher read "LIVE" as a full game and
-- put it on the fixture, so HOME's LATEST VIDEOS showed a FULL GAME of a game nobody had played. Instead it goes in the
-- VIDEO view's LIVE, under SCHEDULED (every game to be streamed here, by league), with a press to be told when it goes
-- live; and the fixture's WATCH pill says it will be streamed here from tip-off, with the same press.
--
--   1. game_stream_video(game)   a game's stream on the site: its own vetted video (game_videos, 0247's rule), else a
--                                channel's full-game video the matcher put on it (a stream published ahead). The one
--                                definition, read by everything below.
--   2. live_streams()            0247's, with (1) for the video: a stream known only from a channel's feed now plays in
--                                LIVE at tip-off, as the WATCH pill promised.
--   3. scheduled_streams(days)   every game still to come (the next `days`, at most 30) that has a stream to be played
--                                here, with its game JSON and the video: the VIDEO view's SCHEDULED.
--   4. games_watchable(games)    0255's, with a fourth kind: 'scheduled' - a game not yet played with a stream coming.
--                                (A channel's "LIVE" video on a game still to come was answered 'full'.) A live game's
--                                channel video is 'live', as its own stream was.
--   5. notifications kind 'live' and notify_stream_live(): a game that has gone live with a stream here tells the fans
--                                following that game (the press under SCHEDULED and in the WATCH card is the game's own
--                                follow bell) - once, by its ref '<game>:live' - with a link straight into the stream.
--                                Run by notify_tick (0155's, with the one step added).
--
-- Needs 0255 (games_watchable) before it, as db push applies them in order.
-- ============================================================================

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------- 1. a game's stream ---
create or replace function public.game_stream_video(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('provider', gv.provider, 'ref', gv.video_ref, 'url', gv.url, 'live', gv.is_live, 'from', 'game')
       from game_videos gv
      where gv.game_id = p_game and gv.is_primary and public.game_video_vetted(gv.id)
      order by gv.created_at desc
      limit 1),
    (select jsonb_build_object('provider', 'youtube', 'ref', i.video_id, 'url', i.url, 'live', true, 'from', 'channel',
                               'title', i.title, 'source', s.name)
       from news_items i
       join news_sources s on s.id = i.source_id
      where i.game_id = p_game and i.video_kind = 'full' and i.video_id ~ '^[A-Za-z0-9_-]{6,20}$'
        and s.video_mode <> 'off' and public.video_item_visible(s.id, i.game_id)
      order by i.published_at desc nulls last
      limit 1));
$$;

comment on function public.game_stream_video(uuid) is
  '0256: a game''s stream on the site - its own vetted video, else a channel''s full-game video the matcher put on it '
  '(a stream published ahead of the game). null when it has neither.';

-- ------------------------------------------------------------------------------------------- 2. live now ---
create or replace function public.live_streams()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.tipoff_at), '[]'::jsonb)
    from (
      select g.tipoff_at,
             public.video_game_json(g.id) || jsonb_build_object(
               'video', v.v, 'channel', c.c, 'chat', public.chat_open_league(g.id)) as j
        from games g
        join competitions co on co.id = g.competition_id
        join seasons se on se.id = co.season_id
        cross join lateral (select public.game_stream_video(g.id) as v) v
        left join lateral (select jsonb_build_object('platform', lc.platform, 'ref', lc.channel_ref) as c
                             from public.league_channel_for_game(g.id) lc limit 1) c on true
       where g.status in ('live', 'finalising') and g.stalled_since is null
         and g.tipoff_at > now() - interval '8 hours'
         and (v.v is not null or c.c is not null)
         and public.league_visible(se.league_id) and public.can_read_game(g.id)
       order by g.tipoff_at desc
       limit 24
    ) x;
$$;

-- ------------------------------------------------------------------------------------------- 3. still to come ---
create or replace function public.scheduled_streams(p_days int default 14)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.tipoff_at, x.id), '[]'::jsonb)
    from (
      select g.id, g.tipoff_at,
             public.video_game_json(g.id) || jsonb_build_object('video', v.v, 'league_id', se.league_id) as j
        from (select distinct c.id
                from (select gv.game_id as id from game_videos gv where gv.is_primary
                      union all
                      select i.game_id from news_items i where i.video_kind = 'full' and i.game_id is not null) c) c
        join games g on g.id = c.id
        join competitions co on co.id = g.competition_id
        join seasons se on se.id = co.season_id
        cross join lateral (select public.game_stream_video(g.id) as v) v
       where g.status = 'scheduled'
         and g.tipoff_at > now() - interval '3 hours'
         and g.tipoff_at < now() + make_interval(days => greatest(1, least(coalesce(p_days, 14), 30)))
         and v.v is not null
         and public.league_visible(se.league_id) and public.can_read_game(g.id)
       order by g.tipoff_at, g.id
       limit 200
    ) x;
$$;

comment on function public.scheduled_streams(int) is
  '0256: every game still to come (the next p_days, 1-30, default 14) with a stream to be played on the site - its game JSON, '
  'the video and its league id; HOME''s VIDEO view, LIVE > SCHEDULED.';

-- ------------------------------------------------------------------------------------------- 4. the WATCH pill ---
create or replace function public.games_watchable(p_games uuid[])
returns table (game uuid, kind text)
language sql stable security definer set search_path = public as $$
  with ok as (
    select g.id, g.status, g.stalled_since
      from games g
      join competitions co on co.id = g.competition_id
      join seasons se on se.id = co.season_id
     where g.id = any ((coalesce(p_games, '{}'::uuid[]))[1:200])
       and public.can_read_game(g.id) and public.league_visible(se.league_id)
  ),
  vids as (
    select i.game_id as game,
           case when ok.status = 'scheduled' then case when i.video_kind = 'full' then 'scheduled' end
                when i.video_kind = 'full' and ok.status in ('live', 'finalising') and ok.stalled_since is null then 'live'
                else i.video_kind end as kind
      from news_items i
      join news_sources s on s.id = i.source_id
      join ok on ok.id = i.game_id
     where i.video_id is not null and i.video_kind in ('highlights', 'full')
       and s.video_mode <> 'off' and public.video_item_visible(s.id, i.game_id)
    union all
    select gv.game_id,
           case when ok.status in ('live', 'finalising') and ok.stalled_since is null then 'live'
                when ok.status = 'scheduled' then 'scheduled'
                else 'full' end
      from game_videos gv
      join ok on ok.id = gv.game_id
     where gv.provider = 'youtube' and gv.is_primary and gv.video_ref ~ '^[A-Za-z0-9_-]{6,20}$'
       and public.game_video_vetted(gv.id)
  )
  select v.game, (array_agg(v.kind order by case v.kind when 'live' then 0 when 'scheduled' then 1 when 'full' then 2 else 3 end))[1]
    from vids v
   where v.kind is not null
   group by v.game;
$$;

comment on function public.games_watchable(uuid[]) is
  '0255/0256: which of these games (at most 200) have a video to play here, and the best kind (live | scheduled | full | '
  'highlights) - scheduled: a game still to come with a stream to be played here from tip-off; the fixture cards'' WATCH '
  'pill (watch.js site()).';

-- ------------------------------------------------------------------------------------------- 5. the notice ---
alter table public.notifications
  drop constraint if exists notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy', 'test',
                    'news', 'creator', 'live'));

create or replace function public.notify_stream_live()
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  n              int := 0;
  c              int;
  v_memberships  boolean := public.memberships_enabled();
  v_members_only boolean;
  v_private      boolean;
begin
  for g in
    select gm.id, gm.tipoff_at, gm.home_team_id, gm.away_team_id,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           public.notif_team_label(h.name, h.short_name) as home_label,
           public.notif_team_label(a.name, a.short_name) as away_label,
           s.league_id, l.access_mode, l.visibility
      from games gm
      join teams h on h.id = gm.home_team_id
      join teams a on a.id = gm.away_team_id
      left join competitions cp on cp.id = gm.competition_id
      left join seasons s       on s.id = cp.season_id
      left join leagues l       on l.id = s.league_id
     where gm.status in ('live', 'finalising') and gm.stalled_since is null
       and gm.tipoff_at >= now() - interval '3 hours'
       and gm.tipoff_at <= now() + interval '30 minutes'
       and (public.game_stream_video(gm.id) is not null
            or exists (select 1 from public.league_channel_for_game(gm.id)))
     order by gm.tipoff_at, gm.id
  loop
    begin
      v_members_only := coalesce(g.access_mode = 'members', false) and v_memberships;
      v_private := coalesce(g.visibility = 'private', false);
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, p.device_id, 'live',
             'Live now: ' || g.home_label || ' v ' || g.away_label,
             'The stream has started. Watch it on EPINOIΛ, with the box score and the chat.',
             'home/?view=video&play=' || g.id, g.league_id, g.id, g.id::text || ':live',
             jsonb_build_object('game', g.id,
                                'home', jsonb_build_object('id', g.home_team_id, 'name', g.home_name),
                                'away', jsonb_build_object('id', g.away_team_id, 'name', g.away_name),
                                'tipoff', g.tipoff_at),
             'high', g.tipoff_at + interval '4 hours'
        from notify_audience p
       where g.id = any (p.fav_game_ids)
         and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))
         and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))
      on conflict do nothing;
      get diagnostics c = row_count;
      n := n + c;
    exception when others then
      raise warning 'notify_stream_live: game % skipped (%: %)', g.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end $$;

comment on function public.notify_stream_live() is
  '0256: a game gone live in the last 3 hours with a stream on the site (game_stream_video, or its league''s channel) tells '
  'the fans following that game, once (ref <game>:live), linking into HOME''s VIDEO view on it. Run by notify_tick.';

-- notify_tick: 0155's, with the 'live' step (and its count in the result)
create or replace function public.notify_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fixtures int := 0;
  v_lineups  int := 0;
  v_halftime int := 0;
  v_live     int := 0;
  v_audience int;
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

  if extract(minute from now())::int = 7 then
    begin
      v_audience := public.notify_audience_refresh();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'audience', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;

  if exists (select 1 from games g
              where g.status = 'scheduled'
                and (   (g.tipoff_at > now() + interval '44 hours' and g.tipoff_at <= now() + interval '48 hours')
                     or (g.tipoff_at > now() and g.tipoff_at <= now() + interval '2 hours'))) then
    begin
      v_fixtures := public.notify_fixture_windows();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'fixtures', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
  if exists (select 1 from games gm
              where gm.status in ('scheduled', 'live')
                and gm.tipoff_at >= now() - interval '30 minutes'
                and gm.tipoff_at <= now() + interval '6 hours'
                and public.notif_starters_complete(gm.starters)) then
    begin
      v_lineups := public.notify_lineups();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'lineups', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
  if exists (select 1 from games gm
               join game_state gs on gs.game_id = gm.id
              where gm.status = 'live'
                and not gs.running
                and gs.updated_at >= now() - interval '30 minutes') then
    begin
      v_halftime := public.notify_halftime();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'halftime', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
  -- 0256: a game gone live with a stream here, to the fans following it
  if exists (select 1 from games gm
              where gm.status in ('live', 'finalising') and gm.stalled_since is null
                and gm.tipoff_at >= now() - interval '3 hours'
                and gm.tipoff_at <= now() + interval '30 minutes') then
    begin
      v_live := public.notify_stream_live();
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('step', 'live', 'sqlstate', sqlstate, 'message', sqlerrm));
    end;
  end if;
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
                                 'live', v_live, 'cleared', v_cleared, 'waiting', v_waiting, 'net', v_net, 'called', v_called,
                                 'request_id', v_request, 'errors', v_errors)
              || case when v_audience is not null then jsonb_build_object('audience', v_audience) else '{}'::jsonb end;
  insert into notify_ticks (id, ran_at, called_at, request_id, result)
  values (1, now(), case when v_called then now() end, v_request, v_result)
  on conflict (id) do update
    set ran_at     = excluded.ran_at,
        called_at  = coalesce(excluded.called_at, notify_ticks.called_at),
        request_id = coalesce(excluded.request_id, notify_ticks.request_id),
        result     = excluded.result;
  return v_result;
end $$;

-- ------------------------------------------------------------------------------------------- grants ---
alter function public.game_stream_video(uuid) owner to postgres;
alter function public.live_streams() owner to postgres;
alter function public.scheduled_streams(int) owner to postgres;
alter function public.games_watchable(uuid[]) owner to postgres;
alter function public.notify_stream_live() owner to postgres;
alter function public.notify_tick() owner to postgres;

revoke all on function public.game_stream_video(uuid) from public, anon, authenticated;
grant execute on function public.game_stream_video(uuid) to service_role;
revoke all on function public.scheduled_streams(int) from public;
grant execute on function public.scheduled_streams(int) to anon, authenticated, service_role;
revoke all on function public.games_watchable(uuid[]) from public;
grant execute on function public.games_watchable(uuid[]) to anon, authenticated, service_role;
revoke all on function public.notify_stream_live() from public, anon, authenticated;
grant execute on function public.notify_stream_live() to service_role;
revoke all on function public.notify_tick() from public, anon, authenticated;
grant execute on function public.notify_tick() to service_role;

-- ------------------------------------------------------------------------------------------- self-check ---
do $$
begin
  if not has_function_privilege('anon', 'public.scheduled_streams(int)', 'execute') then
    raise exception '0256: a signed-out reader cannot read the scheduled streams';
  end if;
  if has_function_privilege('anon', 'public.notify_stream_live()', 'execute')
     or has_function_privilege('authenticated', 'public.notify_stream_live()', 'execute') then
    raise exception '0256: anyone can send the live notices';
  end if;
  if has_function_privilege('anon', 'public.game_stream_video(uuid)', 'execute') then
    raise exception '0256: game_stream_video is open to readers (it skips the game rules the reads apply)';
  end if;
  perform public.scheduled_streams(14);
  perform public.live_streams();             -- (notify_stream_live is not run here: it would send real notices)
end $$;
