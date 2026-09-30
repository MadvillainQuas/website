-- ============================================================================
-- 0205: THE CEBL'S CLUBS BY THEIR OWN ABBREVIATIONS
--
-- The CEBL's schedule names each club and the league's own team id, but no abbreviation. The importer keys a CEBL
-- club by that id ("CEBL24"), and a club's short_name is set once, when its first fixture creates it: so the key
-- became the short name, and the leaders tables (player_season_stats.team_short) read "CEBL24" for Winnipeg
-- (reported 2026-09-30). The importer now gives each club the code the league's LiveStats feed prints
-- (adapters/fiba_site_schedule.py CEBL_ABBR) and never takes a key made of an id for a short name
-- (feedplatform.py); this puts the ten clubs already created right.
--
-- Only a club whose short name is still its key changes: one an administrator has already renamed keeps theirs.
-- Re-runnable.
-- ============================================================================

update public.teams t
   set short_name = x.abbr
  from (values ('CEBL14', 'NRL'), ('CEBL16', 'VAN'), ('CEBL17', 'CGY'), ('CEBL18', 'EDM'), ('CEBL19', 'BHB'),
               ('CEBL20', 'OTT'), ('CEBL21', 'MTL'), ('CEBL22', 'SSS'), ('CEBL24', 'WPG'), ('CEBL56', 'SSK')) as x (code, abbr)
 where t.short_name = x.code
   and t.league_id in (select l.id from public.leagues l where l.slug = 'cebl');
