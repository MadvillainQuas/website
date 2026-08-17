-- ============================================================================
-- One invented staff name turned out to already belong to a player.
--
-- 0038 gave Harbour Bay a strength and conditioning coach called Femi Adeyemi.
-- There is a Femi Adeyemi playing for Neon City, and the same person appearing
-- on two clubs in two roles makes the demo look broken rather than invented —
-- and would send a playtester chasing a bug that is not there.
--
-- Rather than rename this one by hand and leave the next collision to be found
-- by somebody else, this renames ANY staff member whose name matches a player,
-- so re-seeding onto a different roster cannot reintroduce the problem.
-- ============================================================================
do $$
declare
  r record;
  alt text[] := array[
    'Kwame Boateng', 'Ffion Meredith', 'Stellan Vikander', 'Nadia Halloran',
    'Bertie Ashcombe', 'Leila Farhadi', 'Ogden Slack', 'Marisol Vento'
  ];
  i int := 1;
  n int := 0;
begin
  for r in
    select s.id, s.name
      from team_staff s
     where exists (
       select 1 from players p
        where lower(btrim(p.first_name || ' ' || p.last_name)) = lower(btrim(s.name)))
     order by s.name
  loop
    -- keep walking the list until a name nobody is already using turns up
    while i <= array_length(alt, 1)
      and (exists (select 1 from players p
                    where lower(btrim(p.first_name || ' ' || p.last_name)) = lower(alt[i]))
           or exists (select 1 from team_staff s2 where lower(s2.name) = lower(alt[i])))
    loop
      i := i + 1;
    end loop;

    if i > array_length(alt, 1) then
      raise notice 'ran out of replacement names — % left as it was', r.name;
      exit;
    end if;

    update team_staff set name = alt[i] where id = r.id;
    raise notice 'staff "%" renamed to "%" — a player already had that name', r.name, alt[i];
    i := i + 1;
    n := n + 1;
  end loop;

  if n = 0 then
    raise notice 'no staff member shares a name with a player';
  end if;
end $$;
