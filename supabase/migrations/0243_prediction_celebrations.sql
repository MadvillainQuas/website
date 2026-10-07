-- ============================================================================
-- 0243 - A RIGHT PICK IS CELEBRATED, ONCE (Louie, 2026-10-07).
--
-- When a game a fan picked (0239) ends the way they said, the site fires confetti in the corner with "you got it
-- right" - the next time they open any page, or while they are on one as the game finishes (epinoia/celebrate.js asks
-- every minute and a half while the page is in view). Once shown it is marked, so it is shown once, on whichever device
-- the fan is on first.
--
--   game_predictions.celebrated_at   when the fan was shown it (null: not yet)
--   prediction_unseen_wins()         the caller's right picks of the last fortnight not yet shown, newest first
--   prediction_mark_celebrated()     mark some of them shown
-- ============================================================================
set local lock_timeout = '5s';

alter table public.game_predictions add column if not exists celebrated_at timestamptz;

/* the caller's right picks not yet celebrated: a final game with a winner, picked that way, finished in the last
   fortnight (an old one would be a surprise, not a celebration); twenty at most */
create or replace function public.prediction_unseen_wins()
returns table (game_id uuid, pick text, home_name text, away_name text, home_short text, away_short text,
               home_score int, away_score int, finished_at timestamptz, league text)
language sql stable security definer set search_path = public as $$
  select p.game_id, p.pick, h.name, a.name, h.short_name, a.short_name, g.home_score, g.away_score,
         coalesce(g.finalised_at, g.tipoff_at), l.name
    from game_predictions p
    join games g on g.id = p.game_id
    join teams h on h.id = g.home_team_id
    join teams a on a.id = g.away_team_id
    left join leagues l on l.id = p.league_id
   where auth.uid() is not null and p.user_id = auth.uid() and p.celebrated_at is null
     and g.status = 'final' and g.home_score <> g.away_score
     and p.pick = case when g.home_score > g.away_score then 'home' else 'away' end
     and coalesce(g.finalised_at, g.tipoff_at) > now() - interval '14 days'
   order by coalesce(g.finalised_at, g.tipoff_at) desc
   limit 20;
$$;
revoke all on function public.prediction_unseen_wins() from public, anon;
grant execute on function public.prediction_unseen_wins() to authenticated;

create or replace function public.prediction_mark_celebrated(p_games uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update game_predictions set celebrated_at = now()
   where user_id = auth.uid() and celebrated_at is null and game_id = any ((coalesce(p_games, '{}'::uuid[]))[1:50]);
  get diagnostics n = row_count;
  return n;
end; $$;
alter function public.prediction_mark_celebrated(uuid[]) owner to postgres;
revoke all on function public.prediction_mark_celebrated(uuid[]) from public, anon;
grant execute on function public.prediction_mark_celebrated(uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.prediction_unseen_wins()', 'execute')
     or has_function_privilege('anon', 'public.prediction_mark_celebrated(uuid[])', 'execute') then
    raise exception '0243: a signed-out browser may ask for or mark celebrations';
  end if;
  raise notice '0243 ok: right picks are celebrated once';
end $$;

notify pgrst, 'reload schema';
