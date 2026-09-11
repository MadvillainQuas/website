-- ============================================================================
-- 0112  THE BROADCAST HEARTBEAT, for games a federation feed is scoring.
--
-- A game scored in the Epinoia app reaches the graphics layer the moment the
-- statistician taps; a game scored in FIBA LiveStats reaches it only when the
-- ingest worker next reads the feed, which is every ten seconds -- fine for a
-- box score, visibly late on a scorebug. So a game can be ARMED for broadcast:
-- while games.broadcast_until is in the future the worker reads that feed every
-- couple of seconds, and the layer polls the store at the same cadence.
--
-- Who may arm it: whoever may score the game (platform admin, league admin of
-- the owning league, an assigned official) OR a manager of either club --
-- streaming is usually a club's own doing, and the club portal already knows
-- who they are. Arming lasts four hours and the control room re-arms while it
-- stays open, so a stream that overruns never goes quiet, and a stream that
-- ends stops costing the worker anything by itself.
-- ============================================================================

alter table public.games add column if not exists broadcast_until timestamptz;
create index if not exists games_broadcast_until_idx on public.games (broadcast_until) where broadcast_until is not null;

create or replace function public.may_broadcast_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.may_score_game(p_game)
      or exists (select 1 from games g where g.id = p_game
                   and (public.is_team_manager(g.home_team_id) or public.is_team_manager(g.away_team_id)));
$$;
grant execute on function public.may_broadcast_game(uuid) to authenticated;

create or replace function public.arm_broadcast(p_game uuid, p_minutes int default 240)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare g record; until_ timestamptz;
begin
  select * into g from games where id = p_game;
  if not found then raise exception 'no such game' using errcode = '22023'; end if;
  if not public.may_broadcast_game(p_game) then
    raise exception 'you may not broadcast that game' using errcode = '42501';
  end if;
  if g.status = 'final' then
    raise exception 'that game is over' using errcode = '22023';
  end if;
  until_ := now() + make_interval(mins => greatest(5, least(720, coalesce(p_minutes, 240))));
  update games set broadcast_until = until_ where id = p_game;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'arm_broadcast', 'game', p_game::text, jsonb_build_object('until', until_));
  return until_;
end; $$;
revoke all on function public.arm_broadcast(uuid, int) from public, anon;
grant execute on function public.arm_broadcast(uuid, int) to authenticated;

create or replace function public.disarm_broadcast(p_game uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.may_broadcast_game(p_game) then
    raise exception 'you may not broadcast that game' using errcode = '42501';
  end if;
  update games set broadcast_until = null where id = p_game;
  return true;
end; $$;
revoke all on function public.disarm_broadcast(uuid) from public, anon;
grant execute on function public.disarm_broadcast(uuid) to authenticated;

-- the worker (service role) reads broadcast_until through the games policies it already has;
-- the public game page may read it too, to say "armed" -- it is not a secret
