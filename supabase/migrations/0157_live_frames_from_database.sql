-- ============================================================================
-- 0157 — A FED GAME'S CHANGES ARE BROADCAST FROM THE DATABASE.
--
-- A game scored in the app reaches its viewers over a Realtime broadcast: the
-- statistician's browser publishes a frame on `game:<uuid>` for every play. A
-- FED game (the ingest writes it from a league's feed) had nobody to publish,
-- so every viewer's page polled: three requests every three seconds, and the
-- whole log every thirty (epinoia/live.js subscriber). The database's work grew
-- with the audience: a hundred people on one game was about a hundred requests
-- a second, for the same few rows.
--
-- Now the database publishes. Triggers on the tables the ingest writes send a
-- frame to the game's topic with Realtime's broadcast-from-database
-- (realtime.send), in the shape the page's own poll produced:
--
--   game_events inserted  {gameId, src:'db', events:[...]}      scorer-shaped, in seq order,
--                                                                  at most 100 to a frame
--   game_events deleted   {gameId, src:'db', events:[], removed:[seq...]}
--   game_state written    {gameId, src:'db', events:[], state:<the row>}
--   games: status, starters, roster or period changed
--                         {gameId, src:'db', events:[], game:{status, starters, period, ...roster}}
--
-- and, when a fed game goes live or final, the same announcement on
-- 'epinoia:live' the scoring app makes (score/sync.js), so the fixture lists
-- refresh at once. One write, one frame, however many are watching. live.js
-- stops polling a game whose frames come from here (src 'db') and keeps a slow
-- poll only for a silence longer than a feed ever keeps.
--
-- ONLY GAMES EVERYBODY MAY WATCH. The topics are public, so a frame goes out
-- only for a fed game in a public league that is open (or has memberships
-- switched off), live where the league publishes live, or final. That is
-- decided here from the league row alone, never from who is writing: a sound
-- subset of what the read policies show a signed-out reader (the fast path of
-- 0151 without its can_view_league branch). A members-only or private league's
-- viewers keep polling exactly as before.
--
-- realtime.send catches its own errors (a warning, never a raise), so a
-- broadcast that cannot be sent never fails the write that caused it; and it
-- runs inside the writing transaction, so a rolled-back write sends nothing.
-- ============================================================================

-- whether a game's changes are broadcast from here
create or replace function public.live_frames_wanted(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.external_games x where x.game_id = p_game)
     and exists (
           select 1
             from public.games g
             join public.competitions c on c.id = g.competition_id
             join public.seasons s      on s.id = c.season_id
             join public.leagues l      on l.id = s.league_id
            where g.id = p_game
              and l.visibility = 'public'
              and (l.access_mode = 'open' or not public.memberships_enabled())
              and (g.status = 'final' or (g.status = 'live' and coalesce(l.public_live, false))));
$$;
revoke all on function public.live_frames_wanted(uuid) from public, anon, authenticated;
alter function public.live_frames_wanted(uuid) owner to postgres;

-- events written: the new ones, scorer-shaped as live.js delta() builds them, 100 to a frame
create or replace function public.live_frames_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g  record;
  ch record;
begin
  for g in select distinct c.game_id from changed c loop
    continue when not public.live_frames_wanted(g.game_id);
    for ch in
      select jsonb_agg(x.e order by x.seq) as evs
        from (select c.seq,
                     jsonb_build_object('id', c.seq, 'seq', c.seq, 't', c.t, 'team', c.team, 'pid', c.pid,
                                        'period', c.period, 'clock', c.clock)
                       || case when jsonb_typeof(c.payload) = 'object' then c.payload else '{}'::jsonb end as e,
                     (row_number() over (order by c.seq) - 1) / 100 as k
                from changed c
               where c.game_id = g.game_id) x
       group by x.k
       order by x.k
    loop
      perform realtime.send(jsonb_build_object('gameId', g.game_id, 'src', 'db', 'events', ch.evs),
                            'frame', 'game:' || g.game_id, false);
    end loop;
  end loop;
  return null;
end $$;
revoke all on function public.live_frames_events() from public, anon, authenticated;
alter function public.live_frames_events() owner to postgres;

-- events removed (a feed rewriting its log): their seqs, which are the ids a page holds
create or replace function public.live_frames_removed()
returns trigger language plpgsql security definer set search_path = public as $$
declare g record;
begin
  for g in select c.game_id, jsonb_agg(c.seq order by c.seq) as seqs from changed c group by c.game_id loop
    continue when not public.live_frames_wanted(g.game_id);
    perform realtime.send(jsonb_build_object('gameId', g.game_id, 'src', 'db', 'events', '[]'::jsonb, 'removed', g.seqs),
                          'frame', 'game:' || g.game_id, false);
  end loop;
  return null;
end $$;
revoke all on function public.live_frames_removed() from public, anon, authenticated;
alter function public.live_frames_removed() owner to postgres;

-- the state row: clock, period, score, last_seq. `events: []` makes it count as the feed being
-- alive (live.js counts a frame with events as traffic; a state-only frame would not be)
create or replace function public.live_frames_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.live_frames_wanted(new.game_id) then
    perform realtime.send(jsonb_build_object('gameId', new.game_id, 'src', 'db', 'events', '[]'::jsonb,
                                             'state', to_jsonb(new)),
                          'frame', 'game:' || new.game_id, false);
  end if;
  return null;
end $$;
revoke all on function public.live_frames_state() from public, anon, authenticated;
alter function public.live_frames_state() owner to postgres;

-- the fixture's own fields, as delta() reads them; and the announcement when it goes live or final
create or replace function public.live_frames_game()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_scope jsonb;
begin
  if not public.live_frames_wanted(new.id) then
    return null;
  end if;
  perform realtime.send(jsonb_build_object('gameId', new.id, 'src', 'db', 'events', '[]'::jsonb,
                          'game', jsonb_build_object('status', new.status, 'starters', new.starters, 'period', new.period)
                                  || case when jsonb_typeof(new.roster_snapshot) = 'object'
                                          then new.roster_snapshot else '{}'::jsonb end),
                        'frame', 'game:' || new.id, false);
  if old.status is distinct from new.status and new.status in ('live', 'final') then
    select jsonb_build_object('league', l.slug, 'home', h.slug, 'away', a.slug)
      into v_scope
      from public.games g
      left join public.teams h        on h.id = g.home_team_id
      left join public.teams a        on a.id = g.away_team_id
      left join public.competitions c on c.id = g.competition_id
      left join public.seasons s      on s.id = c.season_id
      left join public.leagues l      on l.id = s.league_id
     where g.id = new.id;
    perform realtime.send(jsonb_build_object('gameId', new.id, 'status', new.status,
                                             'at', (extract(epoch from clock_timestamp()) * 1000)::bigint)
                            || jsonb_strip_nulls(coalesce(v_scope, '{}'::jsonb)),
                          'status', 'epinoia:live', false);
  end if;
  return null;
end $$;
revoke all on function public.live_frames_game() from public, anon, authenticated;
alter function public.live_frames_game() owner to postgres;

-- ----------------------------------------------------------------------------
-- THE TRIGGERS, only where Realtime's broadcast-from-database exists
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    raise warning '0157: realtime.send is not installed here; fed games keep being polled';
    return;
  end if;
  drop trigger if exists live_frames_events on public.game_events;
  create trigger live_frames_events after insert on public.game_events
    referencing new table as changed for each statement execute function public.live_frames_events();
  drop trigger if exists live_frames_removed on public.game_events;
  create trigger live_frames_removed after delete on public.game_events
    referencing old table as changed for each statement execute function public.live_frames_removed();
  drop trigger if exists live_frames_state on public.game_state;
  create trigger live_frames_state after insert or update on public.game_state
    for each row execute function public.live_frames_state();
  drop trigger if exists live_frames_game on public.games;
  create trigger live_frames_game after update of status, starters, roster_snapshot, period on public.games
    for each row
    when (old.status is distinct from new.status or old.starters is distinct from new.starters
          or old.roster_snapshot is distinct from new.roster_snapshot or old.period is distinct from new.period)
    execute function public.live_frames_game();
end $$;

-- ============================================================================
-- SELF-TEST, inside a block that ends by raising P0157 (only its own handler
-- swallows it), so nothing it writes, frames included, is ever sent:
--   * a game the rule must refuse (not fed) is refused, and a fed public final
--     game, if there is one, is wanted;
--   * writing that game's state row puts one frame on its topic, and removing
--     one of its events puts a `removed` frame there (read back from
--     realtime.messages where this role may read it).
-- ============================================================================
do $test$
declare
  g    uuid;
  s    bigint;
  n    int;
begin
  if public.live_frames_wanted(gen_random_uuid()) then
    raise exception '0157: a game that does not exist was wanted';
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return;
  end if;

  select gm.id into g
    from games gm
   where gm.status = 'final'
     and exists (select 1 from external_games x where x.game_id = gm.id)
     and exists (select 1 from game_state st where st.game_id = gm.id)
     and exists (select 1 from game_events e where e.game_id = gm.id)
     and public.live_frames_wanted(gm.id)
   order by gm.finalised_at desc nulls last
   limit 1;
  if g is null then
    return;                                      -- no fed public final game to try it on
  end if;

  begin
    update game_state set updated_at = updated_at where game_id = g;
    select max(e.seq) into s from game_events e where e.game_id = g;
    delete from game_events where game_id = g and seq = s;
    begin
      select count(*) into n from realtime.messages m
       where m.topic = 'game:' || g and m.event = 'frame' and m.inserted_at >= current_date;
      if n < 2 then
        raise exception '0157: expected a state frame and a removed frame on game:%, found %', g, n;
      end if;
    exception when insufficient_privilege then
      null;                                      -- this role cannot read the queue; the sends ran
    end;
    raise exception using errcode = 'P0157', message = '0157 self-test passed; rolling its rows back';
  exception when sqlstate 'P0157' then
    null;
  end;
end $test$;
