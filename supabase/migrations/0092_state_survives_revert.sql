-- ============================================================================
-- A REVERTED FIXTURE MUST STILL BE ABLE TO SAY WHERE IT IS.
--
-- THE FAULT
--
-- A statistician opened a fixture, went to the bottom menu to attach the video,
-- and was told "the league database is refusing to save this game — new row
-- violates row-level security policy for table game_state". Nothing was wrong
-- with the row, the columns, or the statistician's permissions. The fixture had
-- been reverted on 18 August and not yet re-claimed.
--
-- can_score() answers TWO questions in one predicate: WHO may record this game,
-- and WHETHER the game is currently in a state that accepts recording. Its last
-- clause refuses a fixture that is 'scheduled' with reverted_at set, which is
-- correct and deliberate — a reverted game must not quietly accumulate more
-- events until somebody re-claims it.
--
-- game_state was judged by that same predicate, and that is the mistake.
-- game_state is not a record of anything. It is one row per game holding the
-- current score, clock, period, possession arrow and last sequence number,
-- overwritten several times a second and authoritative for exactly as long as
-- the next tick takes to arrive. Refusing to overwrite a snapshot protects
-- nothing. It only means that every fixture awaiting re-claim greets whoever
-- opens it with a database error, during pregame setup, before a ball is thrown.
--
-- And the fixture heals itself the moment it goes live — the games_clear_reverted
-- trigger nulls reverted_at on the way to 'live' — so the error appears ONLY in
-- the window before tip, which is precisely the window in which a statistician
-- is least able to judge whether something is seriously wrong.
--
-- THE FIX
--
-- Split the predicate. The append-only event log keeps can_score() exactly as it
-- is, revert guard and all, because that is what the guard is for. game_state
-- gets can_publish_state(): the same WHO, and the same refusal to write to a
-- finalised game, WITHOUT the revert clause.
--
-- What is deliberately NOT changed:
--   * game_events still refuses a reverted game. Re-claim remains meaningful.
--   * a finalised game still refuses state writes, so a published final score
--     cannot be overwritten by a stale scorer tab.
--   * can_score() itself is untouched; everything else that depends on it keeps
--     the behaviour it was written against.
-- ============================================================================

create or replace function public.can_publish_state(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.may_score_game(p_game)
     and exists (select 1 from games g
                  where g.id = p_game
                    and g.status in ('scheduled', 'live'));
$$;

comment on function public.can_publish_state(uuid) is
  'May this caller write the advisory game_state snapshot? Same WHO as '
  'can_score, and the same refusal on a finalised game, but WITHOUT the '
  'reverted-and-not-re-claimed guard: a snapshot is overwritten several times a '
  'second and refusing it protects nothing, while blocking it makes every '
  'fixture awaiting re-claim throw a database error during pregame setup.';

grant execute on function public.can_publish_state(uuid) to authenticated;

drop policy if exists state_write on public.game_state;
create policy state_write on public.game_state for all
  using (public.can_publish_state(game_id))
  with check (public.can_publish_state(game_id));

-- ============================================================================
-- SELF-TEST — AND THIS ONE ACTUALLY EXERCISES THE POLICY.
--
-- 0091 added the break_ms column and self-tested it with a plain INSERT. That
-- test passed and proved nothing about this bug, because a migration runs as the
-- table owner and the owner BYPASSES row-level security. A policy can only be
-- tested from under it.
--
-- So this switches to the authenticated role, forges the JWT claim of a real
-- official, and checks three things:
--   1. the state row is accepted on a reverted fixture   (the fix)
--   2. an event is still REFUSED on that fixture         (the guard preserved)
--   3. the state row is refused once the game is final   (nothing over-opened)
-- ============================================================================
do $test$
declare
  gid           uuid;
  uid           uuid;
  had_revert    timestamptz;
  old_status    text;
  state_ok      boolean := false;
  event_blocked boolean := false;
  final_blocked boolean := false;
begin
  select go.game_id, go.user_id into gid, uid
    from public.game_officials go
    join public.games g on g.id = go.game_id
   where g.status in ('scheduled', 'live')
   limit 1;

  if gid is null then
    raise notice '0092 ok: policy repointed (no official on a live/scheduled '
                 'game to test from under RLS — re-run this check when there is one)';
    return;
  end if;

  select reverted_at, status into had_revert, old_status
    from public.games where id = gid;

  -- Put the fixture into the exact state that was failing.
  update public.games set status = 'scheduled', reverted_at = now() where id = gid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text,
                     true);

  -- 1. the snapshot must now be accepted
  begin
    insert into public.game_state (game_id, period, clock_ms, running,
                                   score_home, score_away, last_seq, updated_at)
    values (gid, 1, 600000, false, 0, 0, 0, now())
    on conflict (game_id) do update set updated_at = excluded.updated_at;
    state_ok := true;
  exception when insufficient_privilege then
    state_ok := false;
  end;

  -- 2. the event log must STILL refuse it.
  --
  -- Caught ONLY insufficient_privilege, deliberately. The first draft of this
  -- test also caught `others`, and named a column that does not exist — so the
  -- undefined-column error was swallowed and reported as a successful policy
  -- block. The test would have passed while testing nothing. A test that cannot
  -- fail for the right reason is worse than no test, so any error that is not
  -- the policy refusing propagates and fails the migration.
  begin
    insert into public.game_events (game_id, seq, t, period, clock, payload)
    values (gid, 2147483600, 'period_start', 1, 600000, '{}'::jsonb);
    event_blocked := false;
  exception when insufficient_privilege then
    event_blocked := true;
  end;

  reset role;

  -- 3. a finalised game must still refuse a snapshot
  update public.games set status = 'final', reverted_at = null where id = gid;
  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text,
                     true);
  begin
    insert into public.game_state (game_id, period, clock_ms, running,
                                   score_home, score_away, last_seq, updated_at)
    values (gid, 4, 0, false, 99, 99, 999999, now())
    on conflict (game_id) do update set score_home = excluded.score_home;
    final_blocked := false;
  exception when insufficient_privilege then
    final_blocked := true;
  end;
  reset role;

  -- RESTORE BEFORE ASSERTING, so a failure cannot leave a real fixture parked
  -- in the wrong status. (The transaction would roll back anyway; this makes it
  -- true even if someone later runs these statements by hand.)
  update public.games set status = old_status, reverted_at = had_revert where id = gid;

  if not state_ok then
    raise exception '0092: a reverted fixture still refuses its state row — '
                    'the policy did not take';
  end if;
  if not event_blocked then
    raise exception '0092: a reverted fixture now ACCEPTS events — the revert '
                    'guard has been widened, which was not the intent';
  end if;
  if not final_blocked then
    raise exception '0092: a finalised game accepts a state row — a published '
                    'final score could be overwritten by a stale tab';
  end if;

  raise notice '0092 ok: snapshot accepted on a reverted fixture, events still '
               'refused, finalised games still closed';
end $test$;
