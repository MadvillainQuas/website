-- ============================================================================
-- 0068 — A REVERT ACTUALLY STOPS THE GAME.
--
-- SUPERSEDES 0067. This migration contains the complete, final revert_game, so
-- applying this one alone is enough; applying 0067 first is harmless.
--
-- THE HOLE 0067 LEFT. can_score() permits a game whose status is 'scheduled':
--
--     and g.status in ('scheduled','live')      -- never a finalised game
--
-- which is correct for a fixture that has not tipped off yet, and quietly
-- wrong for one that has just been put BACK to 'scheduled' by revert_game. A
-- statistician's tab left open on that fixture is still authorised, still
-- holds the whole game in localStorage, and still has a 2-second publish loop
-- running — so within seconds of an administrator reverting a game, the tab
-- re-inserts the very events the revert deleted. The fixture then sits at
-- 'scheduled' while accumulating a fresh event log: reverted in name, still
-- being scored in fact, and the next revert has something to delete again.
--
-- The dialog has always told the administrator to "close the scorer first",
-- which is an instruction to go and do by hand the thing this should be
-- enforcing. A rule that depends on remembering to close a browser tab on
-- another device is not a rule.
--
-- THE FIX IS TO SPLIT can_score IN TWO, because it was answering two different
-- questions with one predicate:
--
--     may_score_game(g)  WHO — a platform administrator, a statistician
--                        assigned to this game, an administrator of its
--                        league. Nothing about the game's state.
--     can_score(g)       WHO **and** WHETHER THE GAME IS OPEN TO WRITES —
--                        may_score_game, and not final, and not sitting in
--                        the reverted state.
--
-- Events and clock state are gated on can_score, so a reverted fixture takes
-- no more writes. The games row itself is gated on may_score_game, so the
-- same people can still RE-CLAIM it — setting it live again is exactly how a
-- reverted fixture is meant to come back, and gating that on can_score would
-- have made the revert permanent for everyone except a league administrator.
--
-- reverted_at is cleared the moment a game goes live again, by trigger rather
-- than by remembering to write it at every call site: claimFixture in the
-- scorer, the importer, and set_game_status all reach 'live' by their own
-- routes and none of them should have to know this column exists.
-- ============================================================================

alter table public.games add column if not exists reverted_at timestamptz;

comment on column public.games.reverted_at is
  'Set by revert_game; cleared by trigger when the game goes live again. While '
  'it is set on a scheduled game, can_score() refuses event and clock writes, '
  'so a scorer left open on the fixture cannot rebuild the log that was just '
  'discarded.';

-- ---------------------------------------------------------------- who -------
create or replace function public.may_score_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    where g.id = p_game
      and ( public.is_platform_admin()
            or exists (select 1 from game_officials go
                       where go.game_id = p_game and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

grant execute on function public.may_score_game(uuid) to authenticated;

-- ------------------------------------------------------- who AND when -------
create or replace function public.can_score(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.may_score_game(p_game)
     and exists (
       select 1 from games g
       where g.id = p_game
         and g.status in ('scheduled','live')     -- never a finalised game
         -- ...and never one that has been reverted and not yet re-claimed
         and not (g.status = 'scheduled' and g.reverted_at is not null));
$$;

-- Re-claiming has to stay possible for everyone who may score, or a revert
-- would be undoable only by a league administrator. The row itself is
-- therefore judged on WHO, not on the state the row is currently in.
drop policy if exists games_update on public.games;
create policy games_update on public.games for update
  using (public.may_score_game(id)
         or exists (select 1 from competitions c join seasons s on s.id=c.season_id
                    where c.id = competition_id and public.is_league_admin(s.league_id)))
  with check (true);

-- Going live is what un-reverts a game, whichever route gets it there.
create or replace function public.clear_reverted_on_live()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'live' then new.reverted_at := null; end if;
  return new;
end; $$;

drop trigger if exists games_clear_reverted on public.games;
create trigger games_clear_reverted before update on public.games
  for each row execute function public.clear_reverted_on_live();

-- ------------------------------------------------------------ the revert ----
create or replace function public.revert_game(
  p_game uuid,
  p_discard_events boolean default false
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  g       record;
  n_ev    int;
  n_stat  int := 0;
begin
  -- Locked for the rest of this transaction. Two administrators can press
  -- "back to listing" at the same moment — the box score and the admin console
  -- are two front doors to this one function — and without the lock both read
  -- the same status, both count the same events, and both report having
  -- discarded them. The second one waits here instead, and finds the game
  -- already reverted.
  select * into g from games where id = p_game for update;
  if not found then
    raise exception 'no such game' using errcode = '22023';
  end if;

  if not public.can_manage_game(p_game) then
    raise exception 'you do not administer that game' using errcode = '42501';
  end if;

  if g.status = 'final' then
    raise exception
      'that game is final — its result is in the standings and the season '
      'statistics, so it has to be reopened deliberately rather than cancelled'
      using errcode = '42501';
  end if;

  if g.status = 'scheduled' and g.reverted_at is not null and not exists (
       select 1 from game_events where game_id = p_game) then
    return 'already on the listing';        -- idempotent: safe to run twice
  end if;

  select count(*) into n_ev from game_events where game_id = p_game;

  -- The count travels in DETAIL as well as in the sentence. DETAIL is where a
  -- client should read it from; the sentence is what a person reads. Both are
  -- populated so neither the database nor the client has to ship first.
  if n_ev > 0 and not coalesce(p_discard_events, false) then
    raise exception
      'that game has % recorded event(s). Reverting discards them permanently — '
      'call again confirming the discard if that is what you mean.', n_ev
      using errcode = '22023', detail = n_ev::text;
  end if;

  delete from game_events where game_id = p_game;

  delete from player_game_stats where game_id = p_game;
  get diagnostics n_stat = row_count;
  delete from team_game_stats  where game_id = p_game;
  delete from lineup_stints    where game_id = p_game;

  -- game_state is the clock and the running score the live transport reconnects
  -- to. Leaving it behind meant a fixture reverted at 9-4 in the second quarter
  -- handed the OLD clock and the OLD score to anyone watching, for the seconds
  -- between a fresh tip-off and the new scorer's first frame.
  delete from game_state where game_id = p_game;

  update games set
    status          = 'scheduled',
    reverted_at     = now(),
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
  -- tipoff_at, venue, the two clubs and the competition are deliberately left
  -- alone: this is the same fixture going back on the listing, not a new one.

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
  'Return a mis-started game to scheduled: discards its event log, its derived '
  'stat rows and its game_state, and stamps reverted_at so a scorer still open '
  'on the fixture is refused further writes until it is deliberately '
  're-claimed. Platform or league admin only; refuses a final game; refuses to '
  'discard events unless told to explicitly (the count travels in the '
  'exception DETAIL as well as its message). Row-locked against a concurrent '
  'revert of the same game.';

-- ============================================================================
-- SELF-TEST — the zombie is the point, so it is what is actually simulated:
-- score, revert, then try to keep scoring the way a tab left open would.
-- ============================================================================
do $$
declare
  admin_ uuid := gen_random_uuid();
  home   uuid; away uuid; g_id uuid;
  orig   text; failed text[] := '{}';
  det    text; msg text; res text; ok boolean;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (admin_, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'revert68@example.invalid', '', now(), now(), now());

  insert into teams (slug, name) values ('rev68-home', 'Rev68 Home') returning id into home;
  insert into teams (slug, name) values ('rev68-away', 'Rev68 Away') returning id into away;

  -- ad-hoc game: can_manage_game via created_by, may_score_game via the
  -- officials row, which is the pair a real statistician-administrator has
  insert into games (home_team_id, away_team_id, status, created_by)
  values (home, away, 'live', admin_) returning id into g_id;
  insert into game_officials (game_id, user_id) values (g_id, admin_);

  insert into game_state (game_id, score_home, score_away, running)
  values (g_id, 9, 4, true);
  insert into game_events (game_id, seq, t, period, clock)
  values (g_id, 1, 'made2', 1, 590000), (g_id, 2, 'made2', 1, 540000);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_, 'role', 'authenticated')::text, true);

  -- ---- while live, scoring works. If this fails the test proves nothing. ----
  if not public.can_score(g_id) then
    failed := array_append(failed, 'can_score was false for a live game the caller is an official for');
  end if;

  -- ---- the refusal carries the count in DETAIL *and* in the sentence -------
  begin
    perform public.revert_game(g_id, false);
    failed := array_append(failed, 'reverted without discard confirmation');
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    if det is distinct from '2' then
      failed := array_append(failed,
        'refusal DETAIL should be the event count "2", got ' || coalesce(det, '<null>'));
    end if;
    if msg !~ 'has 2 recorded event' then
      failed := array_append(failed, 'refusal sentence no longer carries the count');
    end if;
  end;

  -- ---- the revert itself ---------------------------------------------------
  select public.revert_game(g_id, true) into res;
  if res !~ '2 event' then
    failed := array_append(failed, 'revert did not report discarding 2 events: ' || res);
  end if;
  if exists (select 1 from game_events where game_id = g_id) then
    failed := array_append(failed, 'game_events survived the revert');
  end if;
  if exists (select 1 from game_state where game_id = g_id) then
    failed := array_append(failed, 'game_state survived the revert');
  end if;
  if (select status from games where id = g_id) <> 'scheduled' then
    failed := array_append(failed, 'the game was not put back to scheduled');
  end if;
  if (select reverted_at from games where id = g_id) is null then
    failed := array_append(failed, 'reverted_at was not stamped');
  end if;

  -- ---- THE ZOMBIE. A tab still open would do exactly this. -----------------
  if public.can_score(g_id) then
    failed := array_append(failed, 'can_score is STILL true after a revert — a scorer left open would rebuild the log');
  end if;
  begin
    insert into game_events (game_id, seq, t, period, clock)
    values (g_id, 3, 'made2', 1, 500000);
    failed := array_append(failed, 'a reverted game accepted a new event');
  exception when insufficient_privilege then null;
            when others then null;   -- refused by policy, which is the point
  end;
  if exists (select 1 from game_events where game_id = g_id) then
    failed := array_append(failed, 'an event landed on a reverted game');
  end if;

  -- ---- and it is not a one-way door: re-claiming brings it back ------------
  update games set status = 'live' where id = g_id;
  if (select reverted_at from games where id = g_id) is not null then
    failed := array_append(failed, 'reverted_at was not cleared when the game went live again');
  end if;
  if not public.can_score(g_id) then
    failed := array_append(failed, 'a re-claimed game still refuses scoring');
  end if;
  begin
    insert into game_events (game_id, seq, t, period, clock)
    values (g_id, 4, 'made2', 1, 480000);
  exception when others then
    failed := array_append(failed, 're-claimed game refused an event: ' || sqlerrm);
  end;

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from game_events where game_id = g_id;
  delete from game_officials where game_id = g_id;
  delete from games where id = g_id;
  delete from teams where id in (home, away);
  /* revert_game writes an audit_log row stamped with whoever called it, and
     audit_log.actor is a foreign key onto auth.users — so the test account
     cannot be removed while the row it wrote still points at it. The audit
     trail is deliberately not cascaded from users (an action should survive
     the account that took it), which is right for real rows and means a test
     has to clear up after itself. Matched on the game as well as the actor,
     so nothing from this block is left behind either way. */
  delete from audit_log where actor = admin_ or subject_id = g_id::text;
  delete from auth.users where id = admin_;

  if array_length(failed, 1) > 0 then
    raise exception E'REVERT 0068 SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
  raise notice '0068: a reverted game refuses scorer writes until it is re-claimed';
end $$;
