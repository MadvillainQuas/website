-- 0108  Light by default.
--
-- The site now opens light unless a fan chose dark. The profile's theme column follows: its
-- default becomes 'light', and the rows written so far -- test rows, none of them a choice of
-- dark -- are moved to light so nobody is pinned to the old default at their next sign-in.

alter table public.fan_prefs alter column theme set default 'light';
update public.fan_prefs set theme = 'light' where theme = 'dark';
