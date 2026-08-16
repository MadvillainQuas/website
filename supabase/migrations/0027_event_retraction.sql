-- ============================================================================
-- Let a statistician take an event back.
--
-- game_events had SELECT and INSERT policies and no DELETE, so deletion was
-- refused by default-deny. That was fine while the log was believed to be
-- append-only — but the scorer has always had undo, redo, and an edit mode
-- that inserts an event earlier in the log. Those corrections were never
-- reaching the database, so:
--
--   * the public page kept showing a basket the statistician had taken back,
--   * and finalise rebuilt the game from that row too, meaning the FINAL box
--     score preserved the mistake permanently.
--
-- The scorer is the authority on what happened. If it says an event did not
-- happen, the log must agree. So retraction is allowed — narrowly:
--
--   * only whoever may score the game (the same authority that wrote it),
--   * and only while the game is not final. A finished game's log is closed;
--     correcting one means reopening it, which is audited.
-- ============================================================================
drop policy if exists events_delete on public.game_events;
create policy events_delete on public.game_events for delete
  using (
    public.can_score(game_id)
    and exists (
      select 1 from public.games g
       where g.id = game_events.game_id
         and g.status <> 'final'
    )
  );

-- Prove the policy is shaped as intended rather than merely present: a policy
-- that exists but never matches is indistinguishable from no policy at all
-- until somebody needs it mid-game.
do $$
declare
  v_cmd text;
  v_qual text;
begin
  select cmd, qual into v_cmd, v_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'game_events'
     and policyname = 'events_delete';

  if v_cmd is null then
    raise exception 'events_delete was not created';
  end if;
  if v_cmd <> 'DELETE' then
    raise exception 'events_delete applies to %, not DELETE', v_cmd;
  end if;
  if v_qual not like '%can_score%' then
    raise exception 'events_delete does not check can_score — it would let anyone retract';
  end if;
  if v_qual not like '%final%' then
    raise exception 'events_delete does not exclude finalised games';
  end if;
  raise notice 'events_delete: DELETE, gated on can_score and an unfinished game';
end $$;
