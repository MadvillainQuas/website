-- ============================================================================
-- 0253 - EPINOIΛ'S PICKS: the model of who wins (epinoia/winodds.js, run by tools/build-odds.mjs) (2026-10-08)
--
-- One model for every game in every league - What wins' four factors (as they stand and adjusted for the schedule), Elo,
-- form, positions, who is playing and the home court molded into one, learning from each result and from its own wins
-- and losses - gives each fixture a win probability once both clubs have played three games this season. Its picks:
--   * kind 'fixture': written by every run until the game tips off, then FROZEN (model_picks_freeze): the pick that
--     counts is the one made before the game;
--   * kind 'record':  a game the model only met after it was played (its first run walked the whole database), its pick
--     worked out from the games before it alone - only ever added, never replacing a fixture pick.
-- Read through two functions:
--   * game_forecast(game): the probability, for the preview card and the game's preview. Signed in to see it, and - when
--     memberships gate the What wins model (gate_open 'model', 0222) - a member; otherwise it says which;
--   * prediction_model(league, since): its record as a competitor beside the fans' board (0239), open to all: right,
--     decided, the hit rate, and how many of the fans with five decided picks or more it is ahead of.
-- The table itself is the service role's (the run writes it); nobody reads it directly.
-- ============================================================================
set local lock_timeout = '5s';

/* compact: the pick is the probability's side (generated, never written, never at odds with it); made_at moves with
   every rewrite before tip-off, so it is the time the standing pick was made */
create table if not exists public.model_picks (
  game_id    uuid primary key references public.games on delete cascade,
  league_id  uuid references public.leagues on delete set null,
  p_home     real not null check (p_home >= 0 and p_home <= 1),
  pick       text generated always as (case when p_home >= 0.5 then 'home' else 'away' end) stored,
  kind       text not null check (kind in ('fixture', 'record')),
  n_home     smallint,
  n_away     smallint,
  margin     real,
  sigma      real,
  model      text not null default 'epinoia-2',
  made_at    timestamptz not null default now()
);
create index if not exists model_picks_league on public.model_picks (league_id);
comment on table public.model_picks is
  '0253: EPINOIA''s pick of every game it can judge (tools/build-odds.mjs). A fixture pick is rewritten until tip-off and frozen from then on; a record pick (a game met after it was played) is only ever added.';

alter table public.model_picks enable row level security;
revoke all on public.model_picks from public, anon, authenticated;
grant all on public.model_picks to service_role;

/* FROZEN AT TIP-OFF: a pick already there is never changed once its game has tipped off (the update is dropped); a pick
   first written after tip-off is a record, whatever the writer called it */
create or replace function public.model_picks_freeze()
returns trigger language plpgsql set search_path = public as $$
declare v_tip timestamptz;
begin
  select g.tipoff_at into v_tip from games g where g.id = new.game_id;
  if tg_op = 'UPDATE' then
    if v_tip is not null and v_tip <= now() then return null; end if;
    new.made_at := now();
    return new;
  end if;
  if new.kind = 'fixture' and v_tip is not null and v_tip <= now() then new.kind := 'record'; end if;
  return new;
end $$;
drop trigger if exists model_picks_freeze on public.model_picks;
create trigger model_picks_freeze before insert or update on public.model_picks
  for each row execute function public.model_picks_freeze();

/* THE PROBABILITY, for one game: who may see it, then the pick and how the model has done in this league */
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
    'margin', r.margin, 'sigma', r.sigma, 'model', r.model, 'made_at', r.made_at,
    'record', jsonb_build_object('right', v_right, 'decided', v_decided));
end $$;
revoke all on function public.game_forecast(uuid) from public;
grant execute on function public.game_forecast(uuid) to anon, authenticated;

/* THE MODEL ON THE BOARD: its record over the board's games (the fans' prediction_numbers' rules: a league, games since a
   date, a draw or a void game left out), and how many fans with five decided picks or more it is ahead of */
create or replace function public.prediction_model(p_league uuid default null, p_since timestamptz default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with m as (
    select count(*) filter (where g.status = 'final' and g.home_score <> g.away_score
                              and mp.pick = case when g.home_score > g.away_score then 'home' else 'away' end) as correct,
           count(*) filter (where g.status = 'final' and g.home_score <> g.away_score) as decided,
           count(*) filter (where g.status in ('scheduled', 'live', 'finalising')) as pending
      from model_picks mp join games g on g.id = mp.game_id
     where (p_league is null or mp.league_id = p_league)
       and (p_since is null or g.tipoff_at >= p_since)
       and g.status <> 'void'
       and mp.league_id is not null and public.league_visible(mp.league_id)
  ), fans as (
    select x.correct, x.decided from public.prediction_numbers(p_league, p_since) x where x.decided >= 5
  )
  select case when p_league is not null and not public.league_visible(p_league) then null else
    jsonb_build_object('name', 'EPINOIA', 'correct', m.correct, 'decided', m.decided, 'pending', m.pending,
      'pct', case when m.decided > 0 then round(100.0 * m.correct / m.decided, 1) end,
      'fans', (select count(*) from fans),
      'ahead', (select count(*) from fans f where m.decided > 0 and f.correct::numeric / f.decided < m.correct::numeric / m.decided)) end
    from m;
$$;
revoke all on function public.prediction_model(uuid, timestamptz) from public;
grant execute on function public.prediction_model(uuid, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
