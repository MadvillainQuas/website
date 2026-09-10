-- 0102  Team colours taken from the crest.
--
-- A club's colour used to be whatever the admin typed when the team was made — and for
-- every fed club (the BCB, FIBA LiveStats) nobody typed anything, so twenty-one clubs were
-- all the site's own mint green. The crest already says what colour a club is; the ingest
-- reads it (scripts/ingest/team_colours.py: colour frequency over the opaque pixels of the
-- logo) and writes the two strongest brand colours here.
--
--   colour         the primary, as before (every page that reads teams.colour keeps working)
--   colour_2       the secondary, or null when the crest is one colour
--   colour_source  who chose it: 'default' (nobody), 'logo' (read from the crest, and
--                  re-read whenever the crest changes), 'manual' (an admin picked it — the
--                  ingest never overwrites a manual choice)

alter table public.teams
  add column if not exists colour_2 text,
  add column if not exists colour_source text not null default 'default';

alter table public.teams drop constraint if exists teams_colour_source_check;
alter table public.teams add constraint teams_colour_source_check
  check (colour_source in ('default', 'logo', 'manual'));

-- a team already carrying a non-default colour was coloured by hand
update public.teams set colour_source = 'manual'
 where colour_source = 'default' and colour is not null and lower(colour) <> '#93f2bf';

comment on column public.teams.colour_2 is 'secondary brand colour (#rrggbb), read from the crest or set by an admin';
comment on column public.teams.colour_source is 'default | logo | manual — the ingest only writes over default/logo';
