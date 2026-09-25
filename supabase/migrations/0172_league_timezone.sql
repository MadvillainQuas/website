-- ----------------------------------------------------------------------------
-- 0172: leagues.timezone -- the venue clock for a match report's dateline
-- ----------------------------------------------------------------------------
-- WHY. The report's "on Saturday evening" was read off the machine's clock: the reader's in
-- the browser, UTC in the Edge Function. A 19:30 tip in Melbourne read "Saturday morning" to
-- a UK reader. story.js now formats day and part of day in this IANA zone.
--
-- NULL means "no single zone" (U SPORTS spans five; NBL1 spans three) and the dateline falls
-- back to the machine clock exactly as before. Nothing is defaulted, on purpose: a wrong zone
-- is worse than the old behaviour, a missing one is only as wrong as it was.
-- Apply BEFORE the client that selects leagues(timezone) ships, or that select 400s.
-- ----------------------------------------------------------------------------
alter table public.leagues add column if not exists timezone text;

update public.leagues set timezone = 'Australia/Melbourne' where slug in ('nbl', 'wnbl') and timezone is null;
update public.leagues set timezone = 'Asia/Tokyo'          where slug like 'b-league%' and timezone is null;
update public.leagues set timezone = 'Europe/London'        where slug in ('bcb', 'slb-men', 'slb-women') and timezone is null;
update public.leagues set timezone = 'Europe/Berlin'       where slug in ('bbl', 'proa', 'prob') and timezone is null;
update public.leagues set timezone = 'Europe/Paris'        where slug like 'lnb-%' and timezone is null;
update public.leagues set timezone = 'Europe/Madrid'       where slug = 'liga-endesa' and timezone is null;
update public.leagues set timezone = 'Europe/Rome'         where slug = 'lega-basket-serie-a' and timezone is null;
update public.leagues set timezone = 'Europe/Warsaw'       where slug = 'orlen-basket-liga' and timezone is null;
update public.leagues set timezone = 'Europe/Prague'       where slug in ('czech-nbl', 'slovak-sbl') and timezone is null;
update public.leagues set timezone = 'Europe/Stockholm'    where slug in ('basketligan', 'basketligan-dam') and timezone is null;
