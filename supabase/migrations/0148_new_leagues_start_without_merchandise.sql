-- ============================================================================
-- 0148 — A NEW LEAGUE STARTS WITHOUT ITS MERCHANDISE SHELF.
--
-- The league page's sections are switched off in leagues.sections (0053): a key set to false is
-- hidden, and a league with `{}` shows everything. Merchandise is the one section a new league
-- is never ready for — it needs artwork, a print provider and prices — so every league created
-- since has had its shelf on and empty, and its admin has had to open Appearance and turn it off
-- before the first visitor arrived.
--
-- The default changes, not any creator: leagues.sections is `{}` unless a caller says otherwise,
-- so one column default covers the platform console, the feed ingest and the bootstrap scripts.
-- Existing leagues are untouched (a default applies to rows inserted from now on), and turning
-- Merchandise back on stays what it always was: the checkbox in the league console's Appearance,
-- which removes the false.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.leagues
  alter column sections set default '{"merch": false}'::jsonb;

comment on column public.leagues.sections is
  'Sections of the league front page: a key set to false is hidden. New leagues start with merch: false (0148); the league console''s Appearance turns it on.';

-- Exercise it: a league inserted with no sections has merchandise off and nothing else, and one
-- that names its sections keeps exactly what it named.
do $$
declare
  a uuid; b uuid; sa jsonb; sb jsonb;
begin
  insert into leagues (slug, name) values ('zz-t148-a', '0148 A') returning id into a;
  insert into leagues (slug, name, sections) values ('zz-t148-b', '0148 B', '{"news": false}') returning id into b;
  select sections into sa from leagues where id = a;
  select sections into sb from leagues where id = b;
  delete from leagues where id in (a, b);
  if sa is distinct from '{"merch": false}'::jsonb then
    raise exception '0148: a new league did not start with merchandise off';
  end if;
  if sb is distinct from '{"news": false}'::jsonb then
    raise exception '0148: a league that named its sections had them changed';
  end if;
end $$;
