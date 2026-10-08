-- ============================================================================
-- 0254 - WHY EPINOIΛ LEANS: each pick's reasons, for the ⓘ on the win probability (winprob.js) (2026-10-08)
--
-- The model takes its margin apart into what a fan would call its reasons (epinoia/winodds.js reasons(): shooting, ball
-- security, rebounding, free throws, strength this season, recent form, rest and travel, line-ups and positions, half
-- court and transition, home court), worked out as the pick is made. The run (tools/build-odds.mjs) keeps the five
-- largest with each pick: [[reason, points of margin, home side +], ...]. The page shows the side each favours and how
-- strongly, never the numbers.
--   * model_picks.why  jsonb, written with the pick, frozen with it at tip-off (model_picks_freeze, 0253);
--   * game_forecast    returns it as `why` (null for a pick written before this migration); nothing else changes.
-- Before this migration the run writes its picks without the reasons and says so.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.model_picks add column if not exists why jsonb;
comment on column public.model_picks.why is
  '0254: the pick''s reasons, the five largest: [[reason, points of margin (home side +)], ...] (winodds.js reasons()).';

create or replace function public.game_forecast(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_league uuid; r record; v_right bigint; v_decided bigint;
begin
  select se.league_id into v_league
    from games g join competitions co on co.id = g.competition_id join seasons se on se.id = co.season_id
   where g.id = p_game;
  if v_league is null or not public.can_view_league(v_league) then return null; end if;
  if auth.uid() is null then return jsonb_build_object('locked', 'signin'); end if;
  if not public.gate_open('model', v_league) then return jsonb_build_object('locked', 'members'); end if;
  select * into r from model_picks mp where mp.game_id = p_game;
  if not found then return jsonb_build_object('none', true); end if;
  select count(*) filter (where mp.pick = case when g.home_score > g.away_score then 'home' else 'away' end), count(*)
    into v_right, v_decided
    from model_picks mp join games g on g.id = mp.game_id
   where mp.league_id = v_league and g.status = 'final' and g.home_score <> g.away_score;
  return jsonb_build_object('p_home', r.p_home, 'pick', r.pick, 'kind', r.kind, 'n', jsonb_build_array(r.n_home, r.n_away),
    'margin', r.margin, 'sigma', r.sigma, 'model', r.model, 'made_at', r.made_at, 'why', r.why,
    'record', jsonb_build_object('right', v_right, 'decided', v_decided));
end $$;
revoke all on function public.game_forecast(uuid) from public;
grant execute on function public.game_forecast(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
