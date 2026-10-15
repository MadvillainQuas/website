-- 0269 U SPORTS: "TMU" MERGED INTO TORONTO METROPOLITAN (Louie, 2026-10-16)
--
-- The first import of U SPORTS's 2026-27 season (15 Oct 2026) made two clubs of one: the site names Toronto
-- Metropolitan "TMU" on most of its schedule rows and in full on the rest, under one team id, and the adapter keyed
-- clubs by name - "TMU" (23 fixtures) and "Toronto Metropolitan" (6). The adapter now reads both as Toronto
-- Metropolitan (scripts/ingest/adapters/usports.py CLUB_NAMES); this puts the rows already written together, with the
-- platform's own club merge (0188/0192 team_merge_run): the fixtures, competition entries and rosters move to the club
-- that stays, "TMU" is kept among its aliases and its feed code among its external ids, nothing is deleted but the
-- emptied row. The two have never played each other, so the merge's rules allow it.
--
-- Only in the u-sports league, and only when both rows are there; a database without them (or where it was done by
-- hand) is left as it is. A merge the rules refuse is reported and the rows are left apart.

do $$
declare keep_id uuid; other_id uuid;
begin
  select t.id into keep_id
    from public.teams t join public.leagues l on l.id = t.league_id
   where l.slug = 'u-sports' and lower(btrim(t.name)) = 'toronto metropolitan'
   order by t.id limit 1;
  select t.id into other_id
    from public.teams t join public.leagues l on l.id = t.league_id
   where l.slug = 'u-sports' and lower(btrim(t.name)) = 'tmu'
   order by t.id limit 1;
  if keep_id is null or other_id is null then
    raise notice '0269: nothing to merge (Toronto Metropolitan %, TMU %)', coalesce(keep_id::text, 'absent'), coalesce(other_id::text, 'absent');
    return;
  end if;
  begin
    perform public.team_merge_run(keep_id, other_id, null);
    raise notice '0269: merged "TMU" into "Toronto Metropolitan"';
  exception when others then
    raise notice '0269: left "TMU" and "Toronto Metropolitan" apart: %', sqlerrm;
  end;
end $$;
