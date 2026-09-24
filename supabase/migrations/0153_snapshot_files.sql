-- ============================================================================
-- 0153 — SEASON SNAPSHOTS AS FILES, SERVED BY THE CDN.
--
-- 0152 kept each competition's season lines as jsonb in public.snapshots. A
-- season line has several hundred numbers per player, so a snapshot runs to
-- 0.3-2 MB, and Postgres has to decompress and re-serialise every one it
-- serves. Global scouting asks for every league's at once: measured on
-- 2026-09-24, seventeen reads in parallel took 11-13 s each, and some were
-- cancelled by the statement timeout (the page then fell back to reading the
-- box scores, so it worked, but slowly).
--
-- So the snapshots function now writes each season to Storage instead, one file
-- per version: snapshots/season/<competition id(s)>/<token>.json. A version is
-- never overwritten, only replaced by a new path, so the CDN may keep a file as
-- long as it likes and a reader never sees an old season under a new token.
-- Postgres is not involved in serving them at all.
--
-- A page still reads its token from the database first, under every policy, and
-- asks only for the file named by that token: a league a reader may no longer
-- read gives it no games, so no token that names a file. The function removes
-- the files of a competition a signed-out reader can no longer see on its next
-- run (a final, or within the hour). public.snapshots keeps HOME's small
-- 'stars_global' and a one-line index per season (its token and file).
-- ============================================================================
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('snapshots', 'snapshots', true, array['application/json'], 52428800)
on conflict (id) do update
  set public = true, allowed_mime_types = array['application/json'], file_size_limit = 52428800;
