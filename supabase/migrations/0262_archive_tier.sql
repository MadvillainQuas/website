-- 0262 THE ARCHIVE TIER (2026-10-14)
--
-- A season that is over keeps everything its tables, profiles, careers and records are made of - the game rows, each
-- player's and club's line, the lineup stints, the standings - and gives up its play-by-play ROWS, which are three
-- quarters of the database: ~775 rows a game, 2.8 million in all. The play-by-play itself is not lost. Each archived
-- game keeps:
--   snapshots/events/<game>.json        the event log every page already reads first (0156), untouched
--   snapshots/archive/<game>.json.gz    the whole game, gzipped: every event row as stored (select *) and every row
--                                       the box score page reads for it - enough to rebuild the page, and to put the
--                                       rows back exactly (scripts/ingest/archive.py --restore)
-- and its raw feed copy is gzipped beside where it was (external_games.raw_ref follows).
--
-- games.archived_at says a game is in that state. Nothing that READS a game changes: its log comes from the file, as it
-- already did. What must not happen is a game being finalised again while its rows are gone - finalise-game rebuilds
-- every line from the log it reads, and would rebuild them from nothing. So an archived game's status and
-- finalised_at cannot change: re-finalising one means restoring it first (the ingest does that by itself when it
-- writes a game's events again, which clears archived_at in the same breath).
alter table public.games add column if not exists archived_at timestamptz;

comment on column public.games.archived_at is
  'When this game''s play-by-play rows were moved to snapshots/archive/<id>.json.gz (scripts/ingest/archive.py). '
  'Null: the rows are in game_events.';

create or replace function public.games_archive_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.archived_at is not null and new.archived_at is not null
     and (new.status is distinct from old.status or new.finalised_at is distinct from old.finalised_at) then
    raise exception 'game % is archived: its play-by-play is in snapshots/archive - restore it before finalising it again', old.id
      using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists games_archive_guard on public.games;
create trigger games_archive_guard before update on public.games
  for each row execute function public.games_archive_guard();

-- the archive job's question: finished games not archived yet (a partial index, a few KB)
create index if not exists games_not_archived on public.games (competition_id) where status = 'final' and archived_at is null;
