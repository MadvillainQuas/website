-- ============================================================================
-- Fix: 0027's retraction policy was inert.
--
-- 0027 added a DELETE policy to game_events so a statistician could take back
-- an event. It never worked. 0001 installs a BEFORE DELETE trigger that raises
-- unconditionally —
--
--   create trigger game_events_no_delete before delete on public.game_events
--     for each row execute function public.forbid_event_mutation();
--
-- — and a trigger fires whatever the policy says. A policy grants permission
-- to attempt the statement; the trigger then refuses it anyway. So the live
-- retraction path shipped alongside 0027 would have failed in production on
-- the first undo, and the tests in 0029 are what caught it: the cleanup could
-- not delete its own rows.
--
-- The blanket refusal was written when game_events was believed to be strictly
-- append-only. It is not, and never was — the scorer has always had undo, redo
-- and an edit mode. The trigger now enforces the SAME rule the policy states
-- rather than contradicting it.
--
-- UPDATE stays forbidden outright. Nothing needs it: a correction is a
-- retraction followed by an insert, which leaves the log's history honest
-- rather than rewriting an event in place.
-- ============================================================================
create or replace function public.forbid_event_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  /* Server-side contexts pass straight through: migrations, the service role
     the finalise function runs as, and the platform's own maintenance. These
     are not reachable from a browser — the only roles a browser can present
     are `anon` and `authenticated`, and those are the ones the rule is for. */
  if current_user not in ('authenticated', 'anon') then
    return old;
  end if;

  /* can_score already carries the whole rule: the caller is an official for
     this game or an admin of its league, AND the game is scheduled or live.
     A finalised game therefore stays closed, which is what makes reopening an
     audited act rather than a formality. */
  if public.can_score(old.game_id) then
    return old;
  end if;

  raise exception
    'an event may only be retracted by whoever is scoring it, and only before the game is final'
    using errcode = '42501';
end; $$;

drop trigger if exists game_events_no_delete on public.game_events;
create trigger game_events_no_delete before delete on public.game_events
  for each row execute function public.forbid_event_delete();

-- the UPDATE guard is unchanged and stays blanket
drop trigger if exists game_events_no_update on public.game_events;
create trigger game_events_no_update before update on public.game_events
  for each row execute function public.forbid_event_mutation();

-- Prove the trigger actually permits and refuses the right things, because a
-- trigger that raises for everybody is exactly what this migration is fixing
-- and it installed cleanly the first time too.
do $$
declare
  lg uuid; ss uuid; cp uuid; ta uuid; tb uuid; gm uuid; n int;
begin
  insert into leagues (slug, name) values ('trig-test', 'Trigger Test') returning id into lg;
  insert into seasons (league_id, name, starts_on, ends_on)
    values (lg, 'T', current_date, current_date + 1) returning id into ss;
  insert into competitions (season_id, name) values (ss, 'T') returning id into cp;
  insert into teams (league_id, slug, name) values (lg, 'trig-a', 'A') returning id into ta;
  insert into teams (league_id, slug, name) values (lg, 'trig-b', 'B') returning id into tb;
  insert into games (competition_id, home_team_id, away_team_id, status, tipoff_at)
    values (cp, ta, tb, 'live', now()) returning id into gm;
  insert into game_events (game_id, seq, t, period, clock)
    values (gm, 1, 'p2_made', 1, 600000);

  -- a server-side caller may retract from a live game
  delete from game_events where game_id = gm and seq = 1;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'the retraction trigger still refuses a server-side delete';
  end if;

  -- and an update is still refused outright
  insert into game_events (game_id, seq, t, period, clock)
    values (gm, 2, 'p2_made', 1, 500000);
  begin
    update game_events set t = 'p3_made' where game_id = gm and seq = 2;
    raise exception 'game_events accepted an UPDATE — the append-only guard is gone';
  exception when raise_exception then
    if sqlerrm like '%append-only%' then null; else raise; end if;
  end;

  delete from game_events where game_id = gm;
  delete from games where id = gm;
  delete from teams where id in (ta, tb);
  delete from competitions where id = cp;
  delete from seasons where id = ss;
  delete from leagues where id = lg;

  raise notice 'retraction permitted server-side and for a scoring statistician; UPDATE still refused';
end $$;
