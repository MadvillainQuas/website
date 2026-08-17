-- ============================================================================
-- Messages addressed to a CLUB rather than to the platform, and something for
-- the new club panels to show.
--
-- The site-wide contact form already stores every message before it tries to
-- send it, because email is the least reliable part of any stack. A message to
-- a club needs the same treatment and one addition: the club has to be able to
-- READ it. A volunteer secretary whose inbox filtered our notification into
-- spam should still find the enquiry, and "it was definitely sent" is not an
-- answer anyone can act on.
-- ============================================================================
alter table public.contact_messages
  add column if not exists team_id uuid references public.teams on delete set null;
create index if not exists contact_team on public.contact_messages (team_id, created_at desc);

-- A club may read what was addressed to it, and nothing else. Platform admins
-- keep the blanket policy from 0032; this is additive.
drop policy if exists contact_read_own_club on public.contact_messages;
create policy contact_read_own_club on public.contact_messages
  for select to authenticated
  using (team_id is not null and public.is_team_manager(team_id));

-- ---------------------------------------------------------------------------
-- Demo content, so the new panels have something to show and can be tested.
--
-- The addresses are on example.invalid, which is reserved by RFC 2606 and can
-- never route anywhere — a fake address that turns out to be somebody's real
-- one is a small disaster, and "we made it up" is not a defence.
--
-- The staff are invented people on invented clubs. Years of birth, not dates:
-- the same rule `players` follows.
-- ---------------------------------------------------------------------------
do $$
declare
  v_league uuid;
  t        record;
  n        int := 0;
begin
  select id into v_league from leagues where slug = 'demo-league';
  if v_league is null then
    raise notice 'no demo league — nothing to fill in';
    return;
  end if;

  for t in select id, slug, name from teams where league_id = v_league order by slug loop
    insert into team_contacts (team_id, contact_name, email, phone, is_public, accepts_form)
    values (t.id,
            'Club Secretary',
            replace(t.slug, '-', '') || '@example.invalid',
            case t.slug
              when 'east-dock'   then '020 7946 0101'
              when 'neon-city'   then '0141 496 0102'
              when 'harbour-bay' then '0114 496 0103'
              else '01905 960104' end,
            true, true)
    on conflict (team_id) do nothing;

    -- one bench per club, in the order a programme would print them
    insert into team_staff (team_id, name, role, born_year, sort)
    select t.id, x.nm, x.rl, x.yr, public.staff_rank(x.rl)
      from (values
        (case t.slug when 'east-dock'   then 'Rowan Alderly'
                     when 'neon-city'   then 'Priya Chandra'
                     when 'harbour-bay' then 'Dermot Quaile'
                     else 'Ines Bogdan' end,            'Head Coach',               1974),
        (case t.slug when 'east-dock'   then 'Marcus Ilori'
                     when 'neon-city'   then 'Sandy Buchan'
                     when 'harbour-bay' then 'Nia Ferreira'
                     else 'Callum Reith' end,           'Assistant Coach',          1986),
        (case t.slug when 'east-dock'   then 'Beth Okonkwo'
                     when 'neon-city'   then 'Tomas Vrba'
                     when 'harbour-bay' then 'Aled Prentice'
                     else 'Suri Tanaka' end,            'Assistant Coach',          1991),
        (case t.slug when 'east-dock'   then 'Joel Marsden'
                     when 'neon-city'   then 'Ruth Ellery'
                     when 'harbour-bay' then 'Femi Adeyemi'
                     else 'Greta Lindqvist' end,        'Strength and Conditioning',1989),
        (case t.slug when 'east-dock'   then 'Hana Delacroix'
                     when 'neon-city'   then 'Owen Pryce'
                     when 'harbour-bay' then 'Marta Kovacs'
                     else 'Danny Ruthven' end,          'Physiotherapist',          1983),
        (case t.slug when 'east-dock'   then 'Silas Bramwell'
                     when 'neon-city'   then 'Ada Nwosu'
                     when 'harbour-bay' then 'Iain Torrance'
                     else 'Yusuf Barka' end,            'Video Analyst',            1997)
      ) as x(nm, rl, yr)
     where not exists (select 1 from team_staff s where s.team_id = t.id);
    n := n + 1;
  end loop;

  raise notice 'contacts and staff seeded for % demo clubs', n;
end $$;
