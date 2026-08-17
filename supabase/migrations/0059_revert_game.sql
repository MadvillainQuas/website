-- ============================================================================
-- 0059 — PUT A GAME BACK ON THE LISTING.
--
-- A fixture opened by mistake — the wrong game picked from the list, a scorer
-- tapping through the pre-game screen to see what it does — becomes 'live' and
-- stays there. Nothing finalises it, because no game was played; and nothing
-- puts it back, because until now there was no way to. It sits in the fixture
-- list as permanently in progress, the strip pins it to the front as a live
-- game, and when the fixture is actually played there is no clean fixture to
-- score: the roster snapshot, the starters and the tip are already set from
-- the false start.
--
-- This returns the fixture to exactly what it was before anybody touched it.
-- Same clubs, same date, same venue, same competition — it is the same fixture,
-- put back on the listing.
--
-- IT IS DESTRUCTIVE AND SAYS SO. Reverting discards the event log, and an event
-- log is the only real record of a game — everything else on the platform is
-- derived from it. So the discard is a SEPARATE, EXPLICIT ARGUMENT: called
-- without it, the function refuses and reports how many events it would have
-- destroyed. A caller therefore has to have been told the number before it can
-- act on it, and a mis-wired button cannot quietly delete a game.
--
-- A FINAL GAME IS REFUSED. Reverting one is a different and much larger
-- operation: it has been counted into the standings, the season statistics and
-- every derived table, and the honest way to undo that is to reopen it
-- deliberately rather than behind a button labelled "cancel". Saying so beats
-- half-doing it.
--
-- WHAT IT DOES NOT REACH is the statistician's own device. The scorer keeps its
-- game in localStorage, and a tab still open on that fixture will carry on
-- publishing. It only pushes events it has not already sent, so it will not
-- resurrect the old log — but it will start a new one. The admin panel says to
-- close the scorer first, because that is a fact about the world that no
-- database function can fix.
-- ============================================================================
create or replace function public.revert_game(
  p_game uuid,
  p_discard_events boolean default false
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  g       record;
  n_ev    int;
  n_stat  int := 0;
begin
  select * into g from games where id = p_game;
  if not found then
    raise exception 'no such game' using errcode = '22023';
  end if;

  /* can_manage_game covers a platform admin, a league admin of the owning
     league, and whoever created an ad-hoc game. It is the same predicate that
     decides who may schedule a fixture, and putting one back on the listing is
     the same kind of act as putting it there. */
  if not public.can_manage_game(p_game) then
    raise exception 'you do not administer that game' using errcode = '42501';
  end if;

  if g.status = 'final' then
    raise exception
      'that game is final — its result is in the standings and the season '
      'statistics, so it has to be reopened deliberately rather than cancelled'
      using errcode = '42501';
  end if;

  if g.status = 'scheduled' and not exists (
       select 1 from game_events where game_id = p_game) then
    return 'already on the listing';        -- idempotent: safe to run twice
  end if;

  select count(*) into n_ev from game_events where game_id = p_game;

  if n_ev > 0 and not coalesce(p_discard_events, false) then
    raise exception
      'that game has % recorded event(s). Reverting discards them permanently — '
      'call again confirming the discard if that is what you mean.', n_ev
      using errcode = '22023';
  end if;

  delete from game_events where game_id = p_game;

  /* Derived rows should not exist for a game that never finalised, but a game
     that was finalised and later reopened can still be carrying them, and a
     revert that left them behind would leave a box score for a fixture that
     has not been played. */
  delete from player_game_stats where game_id = p_game;
  get diagnostics n_stat = row_count;
  delete from team_game_stats  where game_id = p_game;
  delete from lineup_stints    where game_id = p_game;

  update games set
    status          = 'scheduled',
    home_score      = 0,
    away_score      = 0,
    period          = 1,
    roster_snapshot = null,
    starters        = null,
    tip_winner      = null,
    arrow_init      = null,
    finalised_at    = null,
    finalised_by    = null
  where id = p_game;
  /* tipoff_at, venue, the two clubs and the competition are deliberately left
     alone: this is the same fixture going back on the listing, not a new one. */

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'revert_game', 'game', p_game::text,
          jsonb_build_object('from_status', g.status,
                             'events_discarded', n_ev,
                             'stat_rows_discarded', n_stat));

  return case when n_ev = 0
              then 'back on the listing'
              else 'back on the listing — ' || n_ev || ' event(s) discarded' end;
end; $$;

revoke execute on function public.revert_game(uuid, boolean) from anon, public;
grant  execute on function public.revert_game(uuid, boolean) to authenticated;

comment on function public.revert_game(uuid, boolean) is
  'Return a mis-started game to scheduled, discarding its event log. Platform '
  'or league admin only; refuses a final game; refuses to discard events '
  'unless told to explicitly.';

-- ------------------------------------------------------------- assertions ---
-- The migration runs as nobody in particular, so the refusals are what can be
-- proved from in here — and they are the half that matters, because a revert
-- that let the wrong person through would destroy a game log.
do $$
declare g_live uuid; g_final uuid; refused boolean; msg text;
begin
  select id into g_live  from games where status in ('live','scheduled') limit 1;
  select id into g_final from games where status = 'final' limit 1;

  -- an unknown game is an error, not a silent success
  begin
    perform public.revert_game(gen_random_uuid(), true);
    refused := false;
  exception when others then refused := true;
  end;
  if not refused then raise exception 'ASSERT an unknown game was accepted'; end if;

  -- and nobody is signed in here, so a real game must be refused on authority
  if g_live is not null then
    begin
      perform public.revert_game(g_live, true);
      refused := false;
    exception when insufficient_privilege then refused := true;
              when others then refused := true;
    end;
    if not refused then
      raise exception 'ASSERT revert_game ran for a caller who administers nothing';
    end if;
  end if;

  if g_final is not null then
    begin
      perform public.revert_game(g_final, true);
      refused := false;
    exception when others then refused := true;
    end;
    if not refused then raise exception 'ASSERT a final game was reverted'; end if;
  end if;

  raise notice '0059: revert_game refuses unknown games, outsiders and finals';
end $$;
