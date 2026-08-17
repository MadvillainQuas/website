-- ============================================================================
-- 0054 — the demo league is played in Great Britain.
--
-- A one-line data change, through a migration rather than through the console,
-- because the demo league is seeded by migrations (0004 onwards) and its
-- country belongs with the rest of that seed: a fresh deployment of this schema
-- should come up with the demo filed under a flag rather than under "Not yet
-- filed", which is what the sidebar and the countries page show for a league
-- nobody has placed.
--
-- Guarded on the league existing, because a database that has never had the
-- demo seed is a legitimate state and not a reason to fail a push.
-- ============================================================================
do $$
declare n int;
begin
  update leagues set country = 'GB' where slug = 'demo-league';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'no demo-league on this database — nothing to file';
  else
    raise notice 'demo-league filed under GB';
  end if;
end $$;

-- And prove it, rather than trusting an UPDATE that matched nothing to have
-- done something: the constraint from 0053 only refuses a BADLY SHAPED code,
-- so a typo that happens to be two letters would pass silently.
do $$
declare v text;
begin
  select country into v from leagues where slug = 'demo-league';
  if v is null then
    raise notice 'demo-league is absent or unfiled; skipping the check';
  elsif v <> 'GB' then
    raise exception 'demo-league came out as "%" rather than GB', v;
  end if;
end $$;
