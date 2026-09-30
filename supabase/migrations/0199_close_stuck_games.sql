-- ============================================================================
-- 0199: A GAME THAT IS STILL 'LIVE' LONG AFTER IT COULD HAVE BEEN PLAYED IS CLOSED (close_stuck_games)
--
-- Four games sat on the front page as LIVE for days (26-30 Sep 2026): a game whose feed the scorer
-- never closed (Vellaznimi v Sigal Prishtina, Q4 0:35), one whose feed stopped in the first quarter
-- (Liverpool v Tees Valley Mohawks, Q1 7:15), and two the feed had called final that finalise-game
-- refused (a roster sheet naming one person on both sides; a fouled-out player "still on court").
-- 0196 flagged the first kind so the front page hid it, and each fix since only stopped the NEXT game
-- doing the same. Nothing ever ended a game that was already stuck, and nothing anywhere said how long
-- 'live' may last.
--
-- This is that rule, in the database, where it needs nobody's runner: a game still live (or
-- 'finalising') more than p_hard_hours after its tip-off has been over for longer than any basketball
-- game runs, whatever its feed says. It is closed one of two ways, on what it last showed:
--   FINAL  the fourth period or a later one was over (0:00) or as good as decided (the lead is more than
--          3 points a 12 s of clock left could still swing), or the feed itself had called it final and
--          only finalise-game refused. The last score stands, as it was last written; there is no box
--          score, because there is no log complete enough to make one. The ingest gets the first go at
--          finalising it properly (run_ingest.py --repair-stalled re-reads the feed at 4 hours); this only
--          runs later, on the ones that are still open.
--   VOID   anything else - a game that stopped in the first half, or level in the last minute. Nobody can
--          say who won, and a made-up result is worse than none: 'void' leaves every listing and every
--          table (the console can reinstate it, set_game_status).
-- The row's external_games entry is closed too, with the reason in error, so no lane reads it again and
-- writes it back to 'live'. Idempotent: a closed game is not stuck. Standings are rebuilt for every
-- competition touched.
--
-- pg_cron runs it hourly with a 24 h cap (the ingest has until then). The ingest's repair calls it with a
-- shorter one (6 h) once its own re-read and finalise have had their turn.
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
  v_verdict text;  v_reason text;
  v_comps  uuid[] := '{}';
begin
  for g in
    select ga.id, ga.status::text as st, ga.competition_id, ga.tipoff_at,
           ga.home_score as g_hs, ga.away_score as g_as, ga.period as g_per,
           s.score_home, s.score_away, s.period as s_per, s.clock_ms,
           (select e.external_status from external_games e where e.game_id = ga.id order by e.ingested_at desc nulls last limit 1) as feed
      from games ga
      left join game_state s on s.game_id = ga.id
     where ga.status::text in ('live', 'finalising')
       and ga.tipoff_at < now() - make_interval(secs => greatest(coalesce(p_hard_hours, 24), 1) * 3600)
       and (p_ids is null or ga.id = any (p_ids))
     order by ga.tipoff_at
  loop
    v_hs   := coalesce(g.score_home, g.g_hs, 0);
    v_as   := coalesce(g.score_away, g.g_as, 0);
    v_per  := coalesce(g.s_per, g.g_per, 0);
    v_ms   := coalesce(g.clock_ms, 0);
    v_lead := abs(v_hs - v_as);

    if v_hs <> v_as and v_per >= 4 and (v_ms = 0 or v_lead > 3 * ceil(v_ms / 12000.0)) then
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
        raise warning '0199: standings of % not rebuilt: %', g.cid, sqlerrm;
      end;
    end loop;
  end if;
end $$;

alter function public.close_stuck_games(numeric, uuid[], boolean) owner to postgres;
revoke all on function public.close_stuck_games(numeric, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.close_stuck_games(numeric, uuid[], boolean) to service_role;

comment on function public.close_stuck_games(numeric, uuid[], boolean) is
  'Closes every game still live (or finalising) more than p_hard_hours after its tip-off: FINAL on its last score when '
  'the fourth period or later was over or decided, or the feed had called it final; otherwise VOID. p_dry only reports. '
  'Returns one row per game it looked at. See 0199.';

-- the schedule: hourly, at minute 17 (pg_cron came with 0121)
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-close-stuck-games'::text;
    execute 'select cron.schedule($1, $2, $3)' into v_job
      using 'epinoia-close-stuck-games'::text, '17 * * * *'::text, 'select * from public.close_stuck_games(24)'::text;
    raise notice '0199: pg_cron job epinoia-close-stuck-games (job %) closes games live more than 24 h after tip-off, hourly', v_job;
  else
    raise warning '0199: pg_cron is not installed here, so nothing closes stuck games on a timer; run_ingest.py --repair-stalled still does';
  end if;
end $$;
