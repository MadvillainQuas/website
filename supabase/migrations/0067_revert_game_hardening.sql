-- ============================================================================
-- 0067 — REVERT_GAME, HARDENED.
--
-- Three gaps, found by walking every way "back to listing" and "score this
-- game" can go wrong rather than just the way they're meant to go right.
--
-- 1. NO ROW LOCK. Two admins pressing "back to listing" at the same moment —
--    the box score page and the admin console are two different UIs for the
--    same button — both read the game's status before either had committed,
--    so both could count the same events, both delete them (harmlessly, the
--    second delete is a no-op) and both report having discarded them. Never
--    destructive twice over, but the second caller's own report of "N events
--    discarded" would be describing events the first caller already took.
--    `select ... for update` serialises the two: whichever commits first is
--    the one whose count is real, and the second sees the reverted, empty
--    game and takes the idempotent path instead.
--
-- 2. GAME_STATE WAS NEVER CLEANED UP. game_state holds the clock and running
--    score for the realtime transport — what a viewer's socket reconnects to.
--    revert_game deleted the event log and every derived stat table but left
--    this one behind, so a fixture reverted at 9-4 in the second quarter and
--    then properly re-scored from a fresh tip-off would have a viewer's
--    subscriber resync to the OLD clock and score for the seconds before the
--    new scorer publishes its first frame. It is deleted here too, now that
--    epinoia/score/sync.js also mirrors the live score onto games.home_score
--    — the same class of staleness this migration is closing, in the row
--    that made it visible.
--
-- 3. THE CLIENT PARSED THE REFUSAL'S PROSE. Both callers — the box score page
--    and the admin console — pulled the event count for the confirmation
--    dialog out of the human-readable message with a regex,
--    /has (\d+) recorded event/, matched against error.message. Correct
--    today, and silently wrong the day anyone rewords that sentence: the
--    regex stops matching, both dialogs quietly fall back to the raw refusal
--    alert, and nothing in CI would catch it because a string literal changed,
--    not a type. The count now travels in the exception's DETAIL field too —
--    a place meant for exactly this, and not prose anyone would edit for
--    tone — and both clients read that instead.
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
  -- locked for the rest of this transaction: a second concurrent revert on
  -- the same game waits here rather than racing the checks below
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

  if g.status = 'scheduled' and not exists (
       select 1 from game_events where game_id = p_game) then
    return 'already on the listing';        -- idempotent: safe to run twice
  end if;

  select count(*) into n_ev from game_events where game_id = p_game;

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
  delete from game_state       where game_id = p_game;

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
  'Return a mis-started game to scheduled, discarding its event log and its '
  'game_state row. Platform or league admin only; refuses a final game; '
  'refuses to discard events unless told to explicitly (the count travels in '
  'the exception DETAIL, not just the message). Row-locked against a '
  'concurrent revert of the same game.';

-- ============================================================================
-- SELF-TEST — the success path this time, not only the refusals.
-- ============================================================================
do $$
declare
  admin_ uuid := gen_random_uuid();
  out_   uuid := gen_random_uuid();
  home   uuid; away uuid; g_id uuid;
  orig   text; failed text[] := '{}';
  det    text; msg text; res text;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (admin_, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'revert-admin@example.invalid', '', now(), now(), now()),
         (out_,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'revert-stranger@example.invalid', '', now(), now(), now());

  insert into teams (slug, name) values ('revert-home', 'Revert Home') returning id into home;
  insert into teams (slug, name) values ('revert-away', 'Revert Away') returning id into away;

  -- ad-hoc: no competition, owned by whoever created it — the other half of
  -- can_manage_game, and the cheapest fixture that satisfies it
  insert into games (home_team_id, away_team_id, status, created_by)
  values (home, away, 'live', admin_) returning id into g_id;

  insert into game_state (game_id, score_home, score_away, running)
  values (g_id, 9, 4, true);
  insert into game_events (game_id, seq, t, period, clock)
  values (g_id, 1, 'made2', 1, 590000), (g_id, 2, 'made2', 1, 540000);

  set local role authenticated;

  -- ---- a stranger may not touch it -----------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  begin
    perform public.revert_game(g_id, true);
    failed := array_append(failed, 'a stranger reverted a game they do not administer');
  exception when insufficient_privilege then null;
            when others then failed := array_append(failed,
              'a stranger''s refusal raised the wrong error: ' || sqlerrm);
  end;

  -- ---- the creator does, and the count arrives in DETAIL, not just prose --
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_, 'role', 'authenticated')::text, true);

  begin
    perform public.revert_game(g_id, false);
    failed := array_append(failed, 'reverted without discard confirmation');
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    if det is distinct from '2' then
      failed := array_append(failed,
        'refusal DETAIL should carry the event count "2", got ' || coalesce(det, '<null>'));
    end if;
    if msg !~ 'has 2 recorded event' then
      failed := array_append(failed, 'refusal message no longer mentions the count in prose either');
    end if;
  end;

  select public.revert_game(g_id, true) into res;
  if res !~ '2 event' then
    failed := array_append(failed, 'confirmed revert did not report discarding 2 events: ' || res);
  end if;
  if exists (select 1 from game_events where game_id = g_id) then
    failed := array_append(failed, 'game_events survived a confirmed revert');
  end if;
  if exists (select 1 from game_state where game_id = g_id) then
    failed := array_append(failed, 'game_state survived a revert — the next tip-off would resync stale');
  end if;
  if (select status from games where id = g_id) <> 'scheduled' then
    failed := array_append(failed, 'the game was not put back to scheduled');
  end if;
  if (select home_score from games where id = g_id) <> 0
     or (select away_score from games where id = g_id) <> 0 then
    failed := array_append(failed, 'the score was not reset to 0-0 on revert');
  end if;

  -- ---- idempotent: a second call on the now-empty, scheduled game is a no-op
  select public.revert_game(g_id, true) into res;
  if res <> 'already on the listing' then
    failed := array_append(failed, 'a second revert on an already-reverted game was not idempotent: ' || res);
  end if;

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from games where id = g_id;
  delete from teams where id in (home, away);
  /* audit_log.actor references auth.users with no cascade — deliberately, an
     action should outlive the account that took it — so the row revert_game
     wrote has to go before the test account can. Superseded by 0068, which
     carries the same teardown; fixed here so this file is not left in the
     repository as a migration that cannot run. */
  delete from audit_log where actor in (admin_, out_) or subject_id = g_id::text;
  delete from auth.users where id in (admin_, out_);

  if array_length(failed, 1) > 0 then
    raise exception E'REVERT_GAME SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
  raise notice '0067: revert_game locks the row, cleans up game_state, and reports the event count in DETAIL';
end $$;
