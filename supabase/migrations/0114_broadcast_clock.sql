-- ============================================================================
-- A CLOCK FROM A PHONE, WRITTEN DOWN.
--
-- The clock cam pushes its readings onto the game's live channel, which reaches
-- whoever happens to be listening at that moment and nobody else. Everything that
-- opens LATER -- a graphics layer added at the start of the third quarter, the
-- public game page, a club's own fixture strip, a ticker on somebody's website --
-- begins by reading game_state. For a game whose clock comes from a phone that
-- row was never written, so all of them started on a clock from whenever the
-- scorer last touched it, or on nothing at all.
--
-- The PC reader (scripts/worker/clock_cam.py) has always kept game_state up to
-- date, because it runs with the service key and may write anything. The phone
-- runs as the person holding it, and the state_write policy asks
-- can_publish_state -- which is the same WHO as scoring. That is deliberate and
-- should stay: a club manager may broadcast their own club's game, and a club
-- manager must never be able to write the SCORE of it.
--
-- So the phone does not get the policy widened. It gets a function that can only
-- ever set the clock. The period, the time and whether it is running, nothing
-- else -- the ON CONFLICT below names three columns and score_home, score_away,
-- possession, arrow and last_seq are not among them, so a caller who is entitled
-- to broadcast and not to score can move the clock and can reach nothing else
-- with it. Which is exactly the authority a camera pointed at a scoreboard has.
-- ============================================================================

create or replace function public.broadcast_clock(
  p_game uuid, p_period int, p_clock_ms int, p_running boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select id, status into g from games where id = p_game;
  if not found then raise exception 'no such game' using errcode = '22023'; end if;

  if not public.may_broadcast_game(p_game) then
    raise exception 'you may not broadcast that game' using errcode = '42501';
  end if;
  -- a finished game's clock is part of the record, not something a camera still
  -- pointed at an empty hall gets to keep nudging
  if g.status = 'final' then
    raise exception 'that game is over' using errcode = '22023';
  end if;

  insert into game_state as s (game_id, period, clock_ms, running, updated_at)
  values (p_game,
          greatest(1, least(12, coalesce(p_period, 1))),
          greatest(0, least(1200000, coalesce(p_clock_ms, 0))),
          coalesce(p_running, false),
          now())
  on conflict (game_id) do update
    set period = excluded.period,
        clock_ms = excluded.clock_ms,
        running = excluded.running,
        updated_at = excluded.updated_at;
  return true;
end; $$;

comment on function public.broadcast_clock(uuid, int, int, boolean) is
  'Sets ONLY the clock fields of game_state, for a caller entitled to broadcast '
  'the game (may_broadcast_game, which includes a manager of either club). The '
  'score and the sequence are deliberately out of reach: broadcasting a clock is '
  'not scoring a game.';

revoke all on function public.broadcast_clock(uuid, int, int, boolean) from public, anon;
grant execute on function public.broadcast_clock(uuid, int, int, boolean) to authenticated;

-- ============================================================================
-- SELF-TEST — under the policy, not over it.
--
-- A migration runs as the table owner and the owner bypasses row-level security,
-- so a plain insert here would prove nothing about who may call this. The checks
-- below switch to the authenticated role and forge the claim of a real person,
-- the way 0092 does, and assert the two things worth asserting:
--
--   1. somebody entitled to broadcast can move the clock through this function
--   2. and CANNOT reach the score with it -- the score survives the call
-- ============================================================================
-- IT PUTS BACK WHAT IT FOUND. This runs against whatever fixture the database
-- happens to be holding, which on a live deployment may be a game somebody is
-- part-way through. Testing a clock by moving one is only acceptable if the
-- original is restored, so the before-state is read first and written back at the
-- end, including on the way out of an error.
do $$
declare
  v_game uuid; v_actor uuid;
  v_home int; v_away int; v_per int; v_clk int; v_run boolean; v_ok boolean;
begin
  select g.id into v_game
    from games g join game_state gs on gs.game_id = g.id
   where g.status <> 'final'
   limit 1;
  if v_game is null then
    raise notice 'broadcast_clock: no unfinished fixture with a state row to test against; skipped';
    return;
  end if;

  select gs.score_home, gs.score_away, gs.period, gs.clock_ms, gs.running
    into v_home, v_away, v_per, v_clk, v_run
    from game_state gs where gs.game_id = v_game;

  -- somebody who may already score this game is by definition entitled to broadcast it
  select a.user_id into v_actor from game_officials a where a.game_id = v_game limit 1;
  if v_actor is null then
    raise notice 'broadcast_clock: no official on the sample fixture; permission path not exercised';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ok := public.broadcast_clock(v_game, 2, 123456, true);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if not v_ok then raise exception 'broadcast_clock: an entitled caller was refused'; end if;
  if (select clock_ms from game_state where game_id = v_game) <> 123456 then
    raise exception 'broadcast_clock: the clock was not written';
  end if;
  if (select score_home from game_state where game_id = v_game) is distinct from v_home
     or (select score_away from game_state where game_id = v_game) is distinct from v_away then
    raise exception 'broadcast_clock: the SCORE moved — this function must not be able to touch it';
  end if;

  update game_state set period = v_per, clock_ms = v_clk, running = v_run where game_id = v_game;
  raise notice 'broadcast_clock: entitled caller wrote the clock, could not reach the score, fixture restored';
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if v_game is not null and v_clk is not null then
    update game_state set period = v_per, clock_ms = v_clk, running = v_run where game_id = v_game;
  end if;
  raise;
end $$;
