-- 0268 U SPORTS FOLLOWED LIVE ON DEMAND, AS NCAA DIVISION II (Louie, 2026-10-15)
--
-- U SPORTS's schedule is large too (675 events in 2026-27), so its games are handled exactly as NCAA D2's (0264):
-- every game's score, period and clock from one scoreboard read (the season's RSS, adapters/usports.py scoreline),
-- a game in full only while somebody has it open and at its final whistle, then archived at once
-- (config/ingest-sources.json: live_on_demand, archive_on_final, season_refresh_s on the three USPORTS rows).
--
-- The source rows' league_rules say {"live": "on_demand"} too, but those are written only when a league is created,
-- and u-sports was created on 2026-09-23. This sets it on the existing league; the game page's watch_game and
-- live_frames_wanted read it from there. Only that one key is added: the league's other rules are left as they are.
-- Nothing to do on a database where the league does not exist yet (its first fixture creates it with the rule).

update public.leagues
   set rules = coalesce(rules, '{}'::jsonb) || '{"live": "on_demand"}'::jsonb
 where slug = 'u-sports'
   and coalesce(rules->>'live', '') <> 'on_demand';
