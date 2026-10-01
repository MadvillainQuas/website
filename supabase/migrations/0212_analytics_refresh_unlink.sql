-- 0212: analytics_refresh (0211) is keyed (league_id, season_id) with a foreign key on each, so the API read it as a
-- many-to-many link between seasons and leagues. Every `seasons(leagues(...))` embed - HOME's fixtures, the games page,
-- every league page - then failed as ambiguous (PGRST201). The league key needs no foreign key of its own: a season
-- belongs to one league, and deleting a league deletes its seasons, which still clears these rows through season_id.
alter table public.analytics_refresh drop constraint if exists analytics_refresh_league_id_fkey;
notify pgrst, 'reload schema';
