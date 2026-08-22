-- ============================================================================
-- THE INTERVAL, ON THE ROW EVERY VIEWER READS.
--
-- The scorer publishes break_ms and break_running with every state tick so a
-- ticker, a strip and a scorebug can say "half-time, 12:40" instead of showing
-- 0:00 in the second quarter with no sign that anything is coming back.
--
-- The columns were never added. Postgres refused the whole row, so the score,
-- the clock, the period, the possession arrow and the last sequence number all
-- stopped being written — over two fields that decorate a caption. A
-- statistician saw "the league database is refusing to save this game" for the
-- length of a fixture.
--
-- The client half of this is the more important fix and is in epinoia/live.js:
-- an unknown column now costs the garnish rather than the game. This adds the
-- columns so there is no garnish to lose.
-- ============================================================================

alter table public.game_state
  add column if not exists break_ms      int     not null default 0,
  add column if not exists break_running boolean not null default false;

comment on column public.game_state.break_ms is
  'Milliseconds left of the interval between halves, or 0 when play is live. '
  'Advisory: nothing waits for it, and the third quarter starts when the '
  'statistician starts it.';

-- ============================================================================
-- SELF-TEST — the row the scorer actually sends must be insertable.
-- ============================================================================
do $test$
declare
  gid uuid;
begin
  select id into gid from public.games limit 1;
  if gid is null then
    raise notice '0091 ok: columns added (no games to write a state row for)';
    return;
  end if;

  /* Every field stateOf() sends, in one statement — which is the shape that
     was failing. A column added but misspelled would pass a "does it exist"
     check and fail here, which is the point. */
  insert into public.game_state
    (game_id, period, clock_ms, running, break_ms, break_running,
     score_home, score_away, possession, arrow, last_seq, updated_at)
  values (gid, 2, 0, false, 900000, true, 41, 38, 0, 1, 123, now())
  on conflict (game_id) do update set
    break_ms = excluded.break_ms, break_running = excluded.break_running;

  if not exists (select 1 from public.game_state
                  where game_id = gid and break_ms = 900000 and break_running) then
    raise exception '0091: the interval did not survive the write';
  end if;

  /* Put it back to something harmless rather than leaving a fixture parked at
     half-time with a made-up score. */
  update public.game_state
     set break_ms = 0, break_running = false
   where game_id = gid;

  raise notice '0091 ok: the state row the scorer sends is accepted whole';
end $test$;
