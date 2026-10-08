-- ============================================================================
-- 0257 - EPINOIΛ GO: A STAMP FROM UP TO 1,000 M OF THE ARENA (Louie, 2026-10-08)
--
-- The stamp's range was 300 m from the arena's pin (0162 venues.radius_m, its default), plus the phone's own stated
-- doubt up to 200 m (0165 stamp_venue). A fan in a car park, a queue round the block, or on a phone whose fix lands
-- on the far side of a big venue was too far. The range is now 1,000 m:
--   * venues.radius_m defaults to 1000 for an arena added from now on;
--   * every arena on the old default (300) moves to 1000. One set by hand to anything else keeps its own (the arena
--     editor still sets 50 - 3000 m per arena). On 2026-10-08 all 828 were on the default.
-- stamp_venue() reads the arena's radius, so nothing else changes: the 200 m allowance for the phone's doubt, the
-- window (two hours before tip-off to an hour after the end), the six-a-minute limit and the no-faster-than-a-plane
-- check all stay. The update is made without a signed-in person, so the arena editor's trigger (venues_by_hand)
-- records no edit and moves nothing.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.venues alter column radius_m set default 1000;
update public.venues set radius_m = 1000 where radius_m = 300;
comment on column public.venues.radius_m is
  'How near the arena''s pin a phone must be for a stamp (metres, 50 - 3000; 1000 by default since 0257), before the phone''s own stated doubt (up to 200 m) is allowed for.';

/* the new default in force, and no arena left on the old one */
do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'venues' and column_name = 'radius_m') is distinct from '1000' then
    raise exception '0257: venues.radius_m does not default to 1000';
  end if;
  if exists (select 1 from public.venues where radius_m = 300) then
    raise exception '0257: an arena is still on the old 300 m default';
  end if;
end $$;

notify pgrst, 'reload schema';
