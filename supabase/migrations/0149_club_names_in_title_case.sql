-- ============================================================================
-- 0149 — "ABEJAS DE LEON" IS A FEED'S HABIT, NOT A CLUB'S NAME.
--
-- The LNBP and the CIBACOPA (and a few BBL and ProB clubs) send their clubs in capitals, and the
-- ingest stored them that way, so a fixture read "ABEJAS DE LEON v Fresas de Irapuato" and a whole
-- league's table shouted. Players were already fine: names.person() rebuilds a shouted name.
-- scripts/ingest/names.py team_name() now does the same for a club that is in capitals
-- THROUGHOUT (a name with any lower-case letter is somebody's own spelling and is left alone);
-- this applies the same rule to the clubs already stored, keeping the old spelling as an alias
-- so nothing that could be searched before is lost. Slugs do not change, so no link breaks.
--
-- The rule, mirrored from names.py _cap_club: particles (de, del, la…) stay lower case unless
-- they open the name; a word with no vowel (BC, MBC) or a digit is an abbreviation and stays; a
-- short list of initials and clubs' own capitals (UAT, ASVEL, CSKA…) stays; everything else takes
-- a capital, and after a hyphen or apostrophe as well. A one-word name of four letters or fewer
-- (CSKA, PAOK) is left alone. Re-running changes nothing: a title-cased name is not shouted.
-- ============================================================================

set local lock_timeout = '5s';

create or replace function public.club_title_case(p text)
returns text language plpgsql immutable set search_path = public as $$
declare
  acronyms text[] := array['uat','uanl','uag','uach','udg','uabc','unam','itson','iteso','itesm',
                           'asvel','cska','aek','paok','unics','ewe','ldlc','jl','sig','ucam',
                           'cbc','usa','uk','ii','iii','iv'];
  particles text[] := array['de','del','della','der','di','da','das','dos','du','van','von','vander',
                            'den','ter','te','la','le','el','al','bin','ibn','af','av','y','e',
                            'of','the','and','los','las','do'];
  w    text;
  bare text;
  i    int := 0;
  out  text[] := '{}';
begin
  -- not shouted: no letters at all, or a lower-case letter somewhere, is left exactly as written
  if p is null or p = '' or p <> upper(p) or p = lower(p) then return p; end if;
  if position(' ' in btrim(p)) = 0 and char_length(btrim(p)) <= 4 then return p; end if;
  foreach w in array regexp_split_to_array(regexp_replace(btrim(p), '\s+', ' ', 'g'), ' ') loop
    i := i + 1;
    bare := regexp_replace(lower(w), '[^a-z0-9]', '', 'g');
    if bare = '' or bare = any (acronyms)
       or (bare ~ '^[a-z]+$' and bare !~ '[aeiouy]') or bare ~ '[0-9]' then
      out := out || w;
    elsif lower(w) = any (particles) and i > 1 then
      out := out || lower(w);
    else
      out := out || initcap(lower(w));          -- a capital after a hyphen or apostrophe too
    end if;
  end loop;
  return array_to_string(out, ' ');
end $$;

comment on function public.club_title_case(text) is
  'A club name in capitals throughout, written as a name (Abejas de Leon). Anything with a lower-case letter is returned as it is. Mirrors scripts/ingest/names.py team_name().';

grant execute on function public.club_title_case(text) to anon, authenticated;

-- the old spelling stays findable
update public.teams
   set aliases = case when name = any (aliases) then aliases else array_append(aliases, name) end,
       name = public.club_title_case(name)
 where name <> public.club_title_case(name);

-- a short name cut from the club's name ("RAYOS DE") follows it; a printed code (AGS, MBC) is
-- four characters or fewer and is not touched
update public.teams
   set short_name = public.club_title_case(short_name)
 where char_length(short_name) > 4 and short_name <> public.club_title_case(short_name);

-- Exercise it against the clubs that were actually shouting, and the ones that must not move.
do $$
declare
  cases text[][] := array[
    ['ABEJAS DE LEON',              'Abejas de Leon'],
    ['DIABLOS ROJOS DEL MEXICO',    'Diablos Rojos del Mexico'],
    ['EL CALOR DE CANCUN',          'El Calor de Cancun'],
    ['CORRECAMINOS UAT VICTORIA',   'Correcaminos UAT Victoria'],
    ['SYNTAINICS MBC',              'Syntainics MBC'],
    ['ASTROS',                      'Astros'],
    ['CSKA',                        'CSKA'],
    ['BC SLOVAN Bratislava',        'BC SLOVAN Bratislava'],
    ['Panteras de Aguascalientes',  'Panteras de Aguascalientes'],
    ['AGS',                         'AGS']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    if public.club_title_case(cases[i][1]) is distinct from cases[i][2] then
      raise exception '0149: club_title_case did not write the club as its name';
    end if;
  end loop;
  if public.club_title_case(public.club_title_case('ABEJAS DE LEON')) <> 'Abejas de Leon' then
    raise exception '0149: club_title_case is not stable when run twice';
  end if;
end $$;
