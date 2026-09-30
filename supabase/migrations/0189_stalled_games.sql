-- ============================================================================
-- 0189: A LIVE GAME WHOSE FEED HAS STOPPED IS NOT SHOWN AS LIVE (games.stalled_since)
--
-- A league's stats feed can stop in the middle of a game and never start again: the scorer's
-- console dies, or they carry on on paper. NBL Division One's Liverpool v Tees Valley Mohawks
-- (26 Sep 2026) stopped at Q1 7:15, 7-8, and the Kosovo Superliga's Vellaznimi v Sigal Prishtina
-- (27 Sep) at Q4 0:35 - and both sat on the front page as LIVE for days, a clock frozen on a game
-- nobody was playing any more.
--
-- The ingest's live lane now watches for it (scripts/ingest/run_ingest.py, stall_step): a live game
-- with no new play for 30 minutes is read again from scratch, and if that brings nothing new either
-- it is flagged here, with the time the feed last moved. The front page leaves a flagged game out
-- of LIVE, and the platform console lists it for somebody to fix (the reason is in
-- external_games.error). The flag is cleared the moment the feed moves again, and a game that is
-- finalised is not live whatever the flag says.
-- ============================================================================

alter table public.games add column if not exists stalled_since timestamptz;

comment on column public.games.stalled_since is
  'When a live game''s feed last brought a new play, set by the ingest once 30 minutes with nothing new and a fresh read '
  'with nothing new either have passed; null again as soon as a play arrives. A live game with this set is left out of '
  'the front page''s LIVE list and listed in the platform console for fixing.';

-- the console's list, and the front page's live read, both ask about live games only
create index if not exists games_live_stalled on public.games (stalled_since) where status = 'live';
