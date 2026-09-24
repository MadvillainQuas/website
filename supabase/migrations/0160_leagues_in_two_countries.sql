-- ============================================================================
-- 0160 — A LEAGUE CAN BE PLAYED IN MORE THAN ONE COUNTRY.
--
-- leagues.country was one ISO code (0053: '^[A-Z]{2}$'), and the BNXT League is Belgium's and the
-- Netherlands' at once - filed under Belgium alone, half its clubs were in the wrong country. A
-- league now names up to four codes joined by '+', in the order it wants them shown: 'BE+NL' reads
-- "Belgium + Netherlands" on the site, each flag beside its own name (epinoia/country.js parts()).
-- One code stays exactly what it was, so every existing league is untouched.
--
-- league_countries() groups by the stored value, so 'BE+NL' is a group of its own - which is the
-- point: the rail and HOME show "Belgium + Netherlands" as one entry rather than the league under
-- two countries, twice. set_league_appearance already upper-cases and trims what it is given, and
-- the console strips the spaces from "be + nl" before sending it.
--
-- fanvote_zone read the whole value as one code, so 'BE+NL' fell through to London; it reads the
-- first code now (a league's first country is its clock - Brussels and Amsterdam share one anyway).
-- ============================================================================

set local lock_timeout = '5s';

alter table public.leagues drop constraint if exists leagues_country_ck;
alter table public.leagues add constraint leagues_country_ck
  check (country is null or country ~ '^[A-Z]{2}(\+[A-Z]{2}){0,3}$');

comment on column public.leagues.country is
  'ISO 3166-1 alpha-2, or up to four joined by + for a league played in several countries (BE+NL, 0160); the flags are derived from the letters, never stored';

create or replace function public.fanvote_zone(p_country text)
returns text language sql stable set search_path = public as $$
  select public.notify_valid_tz(case split_part(upper(btrim(coalesce(p_country, ''))), '+', 1)
    when 'GB' then 'Europe/London'      when 'IE' then 'Europe/Dublin'
    when 'FR' then 'Europe/Paris'       when 'ES' then 'Europe/Madrid'
    when 'PT' then 'Europe/Lisbon'      when 'DE' then 'Europe/Berlin'
    when 'IT' then 'Europe/Rome'        when 'NL' then 'Europe/Amsterdam'
    when 'BE' then 'Europe/Brussels'    when 'LU' then 'Europe/Luxembourg'
    when 'CH' then 'Europe/Zurich'      when 'AT' then 'Europe/Vienna'
    when 'DK' then 'Europe/Copenhagen'  when 'NO' then 'Europe/Oslo'
    when 'SE' then 'Europe/Stockholm'   when 'FI' then 'Europe/Helsinki'
    when 'IS' then 'Atlantic/Reykjavik' when 'EE' then 'Europe/Tallinn'
    when 'LV' then 'Europe/Riga'        when 'LT' then 'Europe/Vilnius'
    when 'PL' then 'Europe/Warsaw'      when 'CZ' then 'Europe/Prague'
    when 'SK' then 'Europe/Bratislava'  when 'HU' then 'Europe/Budapest'
    when 'SI' then 'Europe/Ljubljana'   when 'HR' then 'Europe/Zagreb'
    when 'BA' then 'Europe/Sarajevo'    when 'RS' then 'Europe/Belgrade'
    when 'ME' then 'Europe/Podgorica'   when 'MK' then 'Europe/Skopje'
    when 'AL' then 'Europe/Tirane'      when 'XK' then 'Europe/Belgrade'
    when 'BG' then 'Europe/Sofia'       when 'RO' then 'Europe/Bucharest'
    when 'GR' then 'Europe/Athens'      when 'CY' then 'Asia/Nicosia'
    when 'TR' then 'Europe/Istanbul'    when 'UA' then 'Europe/Kiev'
    when 'IL' then 'Asia/Jerusalem'     when 'JP' then 'Asia/Tokyo'
    when 'KR' then 'Asia/Seoul'         when 'CN' then 'Asia/Shanghai'
    when 'TW' then 'Asia/Taipei'        when 'PH' then 'Asia/Manila'
    when 'AU' then 'Australia/Sydney'   when 'NZ' then 'Pacific/Auckland'
    when 'CA' then 'America/Toronto'    when 'US' then 'America/New_York'
    when 'MX' then 'America/Mexico_City' when 'BR' then 'America/Sao_Paulo'
    when 'AR' then 'America/Argentina/Buenos_Aires'
    else 'Europe/London' end);
$$;

-- the BNXT League is Belgium's and the Netherlands'
update public.leagues set country = 'BE+NL' where slug = 'bnxt-league' and country is distinct from 'BE+NL';

-- Exercise it: two codes and one are both a country, a malformed value is refused, and a
-- two-country league keeps its first country's clock.
do $$
declare
  a uuid;
  refused int := 0;
  v text;
begin
  insert into leagues (slug, name, country) values ('zz-t160-a', '0160 A', 'BE+NL') returning id into a;
  update leagues set country = 'GB' where id = a;
  update leagues set country = 'FR+DE+IT+ES' where id = a;
  foreach v in array array['BENL', 'BE+', '+NL', 'BE+NL+FR+DE+IT', 'be+nl', 'BE NL'] loop
    begin
      update leagues set country = v where id = a;
    exception when check_violation then
      refused := refused + 1;
    end;
  end loop;
  delete from leagues where id = a;
  if refused <> 6 then
    raise exception '0160: a malformed country value was accepted';
  end if;
  if public.fanvote_zone('BE+NL') <> 'Europe/Brussels' or public.fanvote_zone('NL') <> 'Europe/Amsterdam' then
    raise exception '0160: a two-country league did not keep its first country''s clock';
  end if;
end $$;
