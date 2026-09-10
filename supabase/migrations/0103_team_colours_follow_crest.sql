-- 0103  A new crest means new colours.
--
-- The ingest colours a team from its crest once and marks colour_source='logo'; after that
-- it leaves the row alone, so it is not re-reading twenty-one images every half hour. When
-- the crest itself changes (a club uploads a new one, the feed swaps its URL) the colours
-- read from the OLD crest are stale: this trigger puts colour_source back to 'default' so
-- the next ingest pass reads the new crest. A colour an admin chose ('manual') is never
-- touched -- they may well have chosen it because the crest gave the wrong answer.

create or replace function public.teams_colour_follows_crest()
returns trigger language plpgsql as $$
begin
  if new.colour_source = 'logo'
     and coalesce(new.logo_path, '') is distinct from coalesce(old.logo_path, '') then
    new.colour_source := 'default';
  end if;
  return new;
end $$;

drop trigger if exists teams_colour_follows_crest on public.teams;
create trigger teams_colour_follows_crest
  before update of logo_path on public.teams
  for each row execute function public.teams_colour_follows_crest();
