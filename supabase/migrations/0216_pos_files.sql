-- ============================================================================
-- 0216 — EACH FINISHED GAME'S MINUTES AT EACH POSITION IS A FILE ON THE CDN.
--
-- A club page's depth chart (t/team.js, t/depth.js shareChart) is every player's
-- share of the minutes the club played at each position. To draw it a page read
-- both sides' lineups for the club's forty latest finals (lineup_stints, 334 KB for
-- a season) and the league's season line to rank each five by (D.season, 621 KB),
-- and the last ten games' box scores for who is missing now. It becomes, as the
-- event logs did in 0156, a file a game: snapshots/pos/<game id>.json in the
-- public 'snapshots' bucket, a few hundred bytes, holding for each side every
-- player's box-score seconds and his seconds at PG, SG, SF, PF and C.
--
-- THE SNAPSHOTS FUNCTION WRITES THEM, as a signed-out reader, for the games it
-- writes event logs for (final, in game_rows_public): it reads a batch of games'
-- lineups and box minutes through the page's own data.js and lays them out with
-- t/depth.js posFile() (its shared copy), ranking each five by depth.js
-- positionOf on the latest season line of the game's competition. A
-- members-only or private league's games never get a file; their pages read the
-- database as before. data.js posFiles() asks for the files, and the page reads
-- the long way for any game without one.
--
-- THIS FILE: the index of written files (which game, from which finalisation).
-- No trigger: a game's lineups and box score are only ever written by finalising
-- it (finalise-game deletes and writes lineup_stints, then stamps finalised_at),
-- so a new finalised_at is the only change a file has to follow, and the
-- function compares the two. snapshots_tick needs nothing new either: while
-- files are left to write the function does not mark its fingerprint done, so
-- the tick calls it again five minutes later, as it does for the event logs.
-- ============================================================================

create table if not exists public.pos_files (
  game_id      uuid primary key,          -- no foreign key: a deleted game's file is removed by the
                                          -- function, which needs the row to find it
  finalised_at timestamptz,               -- the games.finalised_at it was written from
  players      int not null default 0,    -- how many players it holds, both sides
  built_at     timestamptz not null default now()
);
alter table public.pos_files enable row level security;
revoke all on table public.pos_files from public, anon, authenticated;
grant all on table public.pos_files to service_role;
alter table public.pos_files owner to postgres;

-- ============================================================================
-- SELF-TEST: the index is the service role's alone. Neither a signed-out reader
-- nor a signed-in one may read or write it (the files themselves are public; the
-- index says only which exist).
-- ============================================================================
do $test$
begin
  if has_table_privilege('anon', 'public.pos_files', 'select')
     or has_table_privilege('authenticated', 'public.pos_files', 'select')
     or has_table_privilege('anon', 'public.pos_files', 'insert')
     or has_table_privilege('authenticated', 'public.pos_files', 'insert') then
    raise exception '0216: pos_files is readable or writable by a reader' using errcode = 'P0216';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.pos_files'::regclass) then
    raise exception '0216: pos_files has no row level security' using errcode = 'P0216';
  end if;
end $test$;
