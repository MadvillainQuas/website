-- ============================================================================
-- 0190 -- THE EVENTS SPLITS BECOME A MEMBERS' TABLE, ENFORCED BY THE DATABASE.
--
-- Until now the "events" numbers (second chances, transition, off turnovers, after timeouts, half court,
-- assisted/unassisted baskets: the `sit` line of every player and team box-score row) sat inside the stats
-- jsonb that every visitor, and every script with the public key, can read. The membership lock hid them on
-- the screen only; the API handed them to anyone. This puts them where the database itself decides:
--
--   game_sit_lines    one row per (game, player or team side): the same `sit` line, nothing else. Its read policy is
--                     "may you read this game at all" AND "may you use analytics in this game's league", which is
--                     can_use_analytics (0117): open while memberships are switched off (the master switch), open
--                     for a league whose analytics are free, otherwise members only. League administrators read
--                     their own. The service role bypasses the policy, as it does everywhere.
--   game_sit_split()  a BEFORE INSERT/UPDATE trigger on player_game_stats and team_game_stats: whatever writes a
--                     `sit` inside `stats` (finalise-game, the situations backfill, anything else) has it filed
--                     in game_sit_lines and taken out of `stats`, so no writer needs to change and no path can put
--                     it back in the open table.
--   premium_sit_move  moves the lines that already exist, in batches (so a migration is not one enormous
--                     rewrite): select public.premium_sit_move(2000) until it returns 0. Service role only.
--                     Until it has run, an old row still carries its `sit` in `stats` and is still readable;
--                     the workflow "Move the events splits" (premium-move.yml) runs it to the end.
--
-- Nothing changes for anybody while memberships are off: every league's analytics are free, so the policy
-- lets everyone read the lines. The site reads them through data.js (season, statsForGames), which asks for
-- them with the reader's own session and simply gets none when the answer is no.
--
-- Not covered, and why: the play-by-play (game_events) stays public because the box score itself is built from
-- it, so a determined reader can still rebuild these splits from it; this closes the ready-made copy, which was
-- the one-request path. Bulk reads of the log are for the edge (rate limits), not for a row policy.
-- ============================================================================

create table if not exists public.game_sit_lines (
  game_id   uuid not null references public.games on delete cascade,
  kind      text not null check (kind in ('p', 't')),     -- p: a player's line, t: a team side's
  team_idx  int  not null,
  player_id text not null default '',                     -- '' for a team line; else player_game_stats.player_id
  sit       jsonb not null,
  primary key (game_id, kind, team_idx, player_id)
);
create index if not exists game_sit_lines_game on public.game_sit_lines (game_id);

alter table public.game_sit_lines enable row level security;

-- the league a game belongs to (null for a game with none)
create or replace function public.game_league_id(p_game uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.league_id
    from public.games g
    join public.competitions c on c.id = g.competition_id
    join public.seasons s on s.id = c.season_id
   where g.id = p_game
$$;

-- may the caller read this game's analytics? Same switch and the same lookup as the site's own analyticsOk.
create or replace function public.game_analytics_ok(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not public.memberships_enabled() then true
    else public.can_use_analytics(public.game_league_id(p_game))
         or coalesce(public.is_league_admin(public.game_league_id(p_game)), false)
  end
$$;

revoke all on function public.game_league_id(uuid) from public;
revoke all on function public.game_analytics_ok(uuid) from public;
grant execute on function public.game_league_id(uuid) to anon, authenticated, service_role;
grant execute on function public.game_analytics_ok(uuid) to anon, authenticated, service_role;

drop policy if exists sit_read on public.game_sit_lines;
create policy sit_read on public.game_sit_lines for select
using ( public.can_read_game_rows(game_id) and public.game_analytics_ok(game_id) );

revoke all on public.game_sit_lines from public;
grant select on public.game_sit_lines to anon, authenticated;
grant all on public.game_sit_lines to service_role;

-- ---------------------------------------------------------------------------- the trigger
create or replace function public.game_sit_split()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stats is not null and new.stats ? 'sit' then
    if tg_table_name = 'player_game_stats' then
      insert into public.game_sit_lines (game_id, kind, team_idx, player_id, sit)
      values (new.game_id, 'p', new.team_idx, new.player_id, new.stats->'sit')
      on conflict (game_id, kind, team_idx, player_id) do update set sit = excluded.sit;
    else
      insert into public.game_sit_lines (game_id, kind, team_idx, player_id, sit)
      values (new.game_id, 't', new.team_idx, '', new.stats->'sit')
      on conflict (game_id, kind, team_idx, player_id) do update set sit = excluded.sit;
    end if;
    new.stats := new.stats - 'sit';
  end if;
  return new;
end $$;

revoke all on function public.game_sit_split() from public;

drop trigger if exists pgs_sit_split on public.player_game_stats;
create trigger pgs_sit_split before insert or update of stats on public.player_game_stats
  for each row execute function public.game_sit_split();
drop trigger if exists tgs_sit_split on public.team_game_stats;
create trigger tgs_sit_split before insert or update of stats on public.team_game_stats
  for each row execute function public.game_sit_split();

-- ---------------------------------------------------------------------------- moving what already exists
create or replace function public.premium_sit_move(p_limit int default 2000)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n_p int := 0;
  n_t int := 0;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and auth.uid() is not null then
    raise exception 'premium_sit_move is for the service role' using errcode = '42501';
  end if;

  with batch as (
    select game_id, player_id, team_idx, stats->'sit' as sit
      from public.player_game_stats
     where stats ? 'sit'
     order by game_id, player_id
     limit greatest(1, p_limit)
       for update skip locked
  ), filed as (
    insert into public.game_sit_lines (game_id, kind, team_idx, player_id, sit)
    select game_id, 'p', team_idx, player_id, sit from batch
    on conflict (game_id, kind, team_idx, player_id) do update set sit = excluded.sit
    returning 1
  ), stripped as (
    update public.player_game_stats t
       set stats = t.stats - 'sit'
      from batch b
     where t.game_id = b.game_id and t.player_id = b.player_id
    returning 1
  )
  select (select count(*) from stripped) into n_p;

  with batch as (
    select game_id, team_idx, stats->'sit' as sit
      from public.team_game_stats
     where stats ? 'sit'
     order by game_id, team_idx
     limit greatest(1, p_limit)
       for update skip locked
  ), filed as (
    insert into public.game_sit_lines (game_id, kind, team_idx, player_id, sit)
    select game_id, 't', team_idx, '', sit from batch
    on conflict (game_id, kind, team_idx, player_id) do update set sit = excluded.sit
    returning 1
  ), stripped as (
    update public.team_game_stats t
       set stats = t.stats - 'sit'
      from batch b
     where t.game_id = b.game_id and t.team_idx = b.team_idx
    returning 1
  )
  select (select count(*) from stripped) into n_t;

  return n_p + n_t;
end $$;

revoke all on function public.premium_sit_move(int) from public;
revoke all on function public.premium_sit_move(int) from anon, authenticated;
grant execute on function public.premium_sit_move(int) to service_role;

-- how many rows still carry an open `sit` (the workflow reads this to know when it is done)
create or replace function public.premium_sit_remaining()
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*) from public.player_game_stats where stats ? 'sit')::int
       + (select count(*) from public.team_game_stats where stats ? 'sit')::int
$$;
revoke all on function public.premium_sit_remaining() from public;
revoke all on function public.premium_sit_remaining() from anon, authenticated;
grant execute on function public.premium_sit_remaining() to service_role;

-- ---------------------------------------------------------------------------- the copies built while it was free
-- The snapshots function (0152) builds each competition's season line once, as a signed-out reader, and stores it in
-- public.snapshots for everyone. A snapshot built while memberships were off holds the events figures computed from lines
-- that reader could still see; left in place after the switch it would keep serving them. So when the master switch (or
-- any platform setting that carries it) changes, the season snapshots are dropped and the next tick rebuilds them as
-- what a signed-out reader is allowed. The same function can be called by hand after a league's analytics plan changes.
create or replace function public.premium_snapshots_purge()
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.snapshots where key like 'season:%';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.premium_snapshots_purge() from public;
revoke all on function public.premium_snapshots_purge() from anon, authenticated;
grant execute on function public.premium_snapshots_purge() to service_role;

create or replace function public.platform_switch_purge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'memberships_enabled' and new.value is distinct from old.value then
    delete from public.snapshots where key like 'season:%';
  end if;
  return new;
end $$;
revoke all on function public.platform_switch_purge() from public;

drop trigger if exists platform_switch_purge on public.platform_settings;
create trigger platform_switch_purge after update on public.platform_settings
  for each row execute function public.platform_switch_purge();
