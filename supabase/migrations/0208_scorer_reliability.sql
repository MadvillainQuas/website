-- ============================================================================
-- 0208: A STUCK-GAME CLEAN-UP THAT DOES NOT CLOSE A GAME BEING PLAYED (close_stuck_games)
--
-- 0203 closes a game still live long after its tip-off: FINAL on its last score when the last regulation
-- period was over or decided, VOID otherwise. Its clock is the fixture's tip-off, and a fixture can be played
-- long after it - a postponed game scored weeks later on the same row, a tournament day running hours late.
-- Such a game was closed MID-PLAY: void in the first half, final on its running score with no box score. The
-- scorer then stopped publishing (its watchdog saw final or void), so the rest of the game went nowhere. And a
-- game scored in the app whose finalise was refused at the whistle - a fouled-out player still on court, a
-- level score - and corrected the next morning was found already final with no box score, its finalise
-- answered "already final".
--
-- Two guards, tagged "-- 0208" below; every other line is 0206's (latest), unchanged:
--
--   MOVED IN THE LAST 30 MINUTES: not stuck, whatever the tip-off says. "Moved" is read per source, because
--   the obvious column is the wrong one for a feed: game_state.updated_at is rewritten by the ingest on EVERY
--   pass of a feed that says live (scripts/ingest/run_ingest.py: a live bundle is never skipped, and
--   write_event_log upserts game_state with updated_at = now()), so a feed frozen at Q1 7:15 - 0203's own
--   Liverpool v Tees Valley - would look as fresh as a game in progress, and nothing would ever close it. For a
--   game with a feed, moved means a NEW PLAY (the newest game_events.created_at - the ingest leaves rows that
--   have not changed untouched). For a game scored in the app it is either that or the scorer's state row,
--   which the scorer writes every five seconds while a tab holds the game, half-time included.
--
--   SCORED IN THE APP (no external_games row): closed only after 24 h with nothing from it at all. There is no
--   feed to re-read, and the statistician's own finalise is the right way for it to end; the clean-up is for a
--   game that nobody is ever coming back to.
--
-- scripts/ingest/stuck.py (keep_open) is the Python twin, used when this function is not there - change one,
-- change both (scripts/ingest/stuck_test.py, supabase/tests/scorer-stuck.test.mjs). Same signature, same
-- grants, `create or replace`: re-runnable.
-- ============================================================================

create or replace function public.close_stuck_games(
  p_hard_hours numeric default 24,
  p_ids        uuid[]  default null,
  p_dry        boolean default false
) returns table (game_id uuid, was text, verdict text, reason text, home_score int, away_score int)
language plpgsql security definer set search_path = public as $$
declare
  g        record;
  v_hs     int;  v_as int;  v_per int;  v_ms int;  v_lead int;
  v_reg    int;                                                            -- 0206: regulation periods, 4 or 2
  v_moved  timestamptz;                                                    -- 0208: when the game last moved
  v_verdict text;  v_reason text;
  v_comps  uuid[] := '{}';
begin
  for g in
    select ga.id, ga.status::text as st, ga.competition_id, ga.tipoff_at,
           ga.home_score as g_hs, ga.away_score as g_as, ga.period as g_per,
           s.score_home, s.score_away, s.period as s_per, s.clock_ms,
           (select e.external_status from external_games e where e.game_id = ga.id order by e.ingested_at desc nulls last limit 1) as feed,
           (select l.rules from competitions c join seasons se on se.id = c.season_id join leagues l on l.id = se.league_id
             where c.id = ga.competition_id) as rules,                                                           -- 0206
           exists (select 1 from external_games x where x.game_id = ga.id) as fed,                               -- 0208
           (select max(ev.created_at) from game_events ev where ev.game_id = ga.id) as last_play,                 -- 0208
           s.updated_at as state_at                                                                               -- 0208
      from games ga
      left join game_state s on s.game_id = ga.id
     where ga.status::text in ('live', 'finalising')
       and ga.tipoff_at < now() - make_interval(secs => greatest(coalesce(p_hard_hours, 24), 1) * 3600)
       and (p_ids is null or ga.id = any (p_ids))
     order by ga.tipoff_at
  loop
    -- 0208: a game that moved in the last half hour is being played, whatever its tip-off says. For a game with
    -- 0208: a feed, moving is a new play - the ingest rewrites game_state on every pass of a live feed, moving or
    -- 0208: not, so that row's updated_at says nothing about it. For a game scored in the app it is either the
    -- 0208: scorer's state heartbeat or a new play.
    v_moved := case when g.fed then g.last_play else greatest(g.last_play, g.state_at) end;                       -- 0208
    if v_moved is not null and v_moved > now() - interval '30 minutes' then continue; end if;                     -- 0208
    -- 0208: a game scored in the app has nobody's feed to re-read and a statistician who finalises it: it is
    -- 0208: closed only after a day with nothing from it at all.
    if not g.fed and coalesce(v_moved, g.tipoff_at) > now() - interval '24 hours' then continue; end if;          -- 0208

    v_hs   := coalesce(g.score_home, g.g_hs, 0);
    v_as   := coalesce(g.score_away, g.g_as, 0);
    v_per  := coalesce(g.s_per, g.g_per, 0);
    v_ms   := coalesce(g.clock_ms, 0);
    v_lead := abs(v_hs - v_as);
    v_reg  := case when public.game_in_halves(g.id, g.rules) then 2 else 4 end;                                   -- 0206

    -- 0206: the last regulation period (the fourth quarter, or the second half) or later
    if v_hs <> v_as and v_per >= v_reg and (v_ms = 0 or v_lead > 3 * ceil(v_ms / 12000.0)) then
      v_verdict := 'final';
      v_reason  := format('period %s, %s left, %s-%s: over or decided when the feed stopped',
                          v_per, to_char(make_interval(secs => v_ms / 1000.0), 'MI:SS'), v_hs, v_as);
    elsif v_hs <> v_as and g.feed = 'final' then
      v_verdict := 'final';
      v_reason  := format('the feed called it final (%s-%s); finalise-game never accepted it', v_hs, v_as);
    else
      v_verdict := 'void';
      v_reason  := format('the feed stopped in period %s with %s left at %s-%s: no result to stand on',
                          v_per, to_char(make_interval(secs => v_ms / 1000.0), 'MI:SS'), v_hs, v_as);
    end if;

    game_id := g.id; was := g.st; verdict := v_verdict; reason := v_reason; home_score := v_hs; away_score := v_as;

    if not p_dry then
      if v_verdict = 'final' then
        update games set status = 'final', home_score = v_hs, away_score = v_as, period = greatest(v_per, 1),
                         finalised_at = coalesce(finalised_at, now()), stalled_since = null
         where id = g.id;
      else
        update games set status = 'void', stalled_since = null where id = g.id;
      end if;
      update external_games set external_status = 'final',
             error = left('reconciled (' || v_verdict || '): ' || v_reason, 500)
       where external_games.game_id = g.id;
      insert into audit_log (actor, action, subject, subject_id, detail)
      values (null, 'close_stuck_game', 'game', g.id::text,
              jsonb_build_object('was', g.st, 'verdict', v_verdict, 'reason', v_reason,
                                 'period', v_per, 'clock_ms', v_ms, 'home', v_hs, 'away', v_as,
                                 'tipoff_at', g.tipoff_at));
      if g.competition_id is not null and not (g.competition_id = any (v_comps)) then
        v_comps := v_comps || g.competition_id;
      end if;
    end if;
    return next;
  end loop;

  -- the tables count final games only: rebuilt once per competition touched
  if array_length(v_comps, 1) is not null then
    for g in select unnest(v_comps) as cid loop
      begin
        perform public.recompute_standings(g.cid);
      exception when others then
        raise warning '0203: standings of % not rebuilt: %', g.cid, sqlerrm;
      end;
    end loop;
  end if;
end $$;

alter function public.close_stuck_games(numeric, uuid[], boolean) owner to postgres;
revoke all on function public.close_stuck_games(numeric, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.close_stuck_games(numeric, uuid[], boolean) to service_role;

comment on function public.close_stuck_games(numeric, uuid[], boolean) is
  'Closes every game still live (or finalising) more than p_hard_hours after its tip-off: FINAL on its last score when '
  'the last regulation period was over or decided, or the feed had called it final; otherwise VOID. Never a game that '
  'moved in the last 30 minutes (a new play; for an app-scored game also the scorer''s state row), and an app-scored '
  'game (no external_games row) only after 24 h of silence. p_dry only reports. See 0203, 0206, 0208.';
