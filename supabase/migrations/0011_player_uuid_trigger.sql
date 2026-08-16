-- ============================================================================
-- 0011 — populate player_game_stats.player_uuid automatically.
--
-- 0002 added player_uuid and the season views filter on it
-- (`where pgs.player_uuid is not null`), but nothing ever set it. The
-- finalise-game Edge Function writes player_id — the scorer's pid — and stops
-- there. So even a game finalised correctly through the app produced zero
-- season rows: empty leaders board, empty full table, empty player pages.
--
-- Doing it in a trigger rather than in the Edge Function means every writer
-- gets it right, including a re-finalise, a backfill, or a future importer.
--
-- On a platform game the pid IS the players.id uuid, so this is a cast. On an
-- ad-hoc game the pid is a local label like 'p0_3', which is not a uuid and
-- must stay NULL — those games are deliberately excluded from season totals.
-- The existence check keeps a uuid that is not a real player out too, so the
-- FK can never abort a finalise.
-- ============================================================================
create or replace function public.stamp_player_uuid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.player_uuid is null
     and new.player_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and exists (select 1 from players p where p.id = new.player_id::uuid)
  then
    new.player_uuid := new.player_id::uuid;
  end if;
  return new;
end; $$;

drop trigger if exists pgs_stamp_player_uuid on public.player_game_stats;
create trigger pgs_stamp_player_uuid
  before insert or update on public.player_game_stats
  for each row execute function public.stamp_player_uuid();

-- backfill anything already written by the Edge Function
update public.player_game_stats
   set player_uuid = player_id::uuid
 where player_uuid is null
   and player_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and exists (select 1 from players p where p.id = player_game_stats.player_id::uuid);
