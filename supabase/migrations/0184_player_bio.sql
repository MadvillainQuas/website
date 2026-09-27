-- ============================================================================
-- 0184: PLAYER BIO FROM THE FEEDS - a secret date of birth, and the age it gives
--
-- height_cm, weight_kg and birth_year were already on players (0033, 0002) and shown on the pages; nothing ever filled them but a person
-- typing. The ingest now does (scripts/ingest/bio_sync.py). The site shows a player's AGE and BIRTH YEAR, never the date:
--
--   players.birth_date   the full date of birth, so that age moves by itself on the day. NOT public: it is a new column and
--                        players has no table-wide SELECT (0171), so it is granted to nobody by name. Service role and the
--                        platform's own functions read it; the browser never can.
--   player_ages(ids)     the current age of each player who has a date and is not withheld. This is the ONLY way an age reaches
--                        a page; the date itself never leaves the database.
--
-- UNDER 18: the date is never kept. Only the birth year is (a trigger drops a date that would make him a minor, whoever writes it:
-- the ingest, the console, a hand edit). When he turns 18 the next bio pass can store it.
-- THE YEAR FOLLOWS THE DATE: with a date, birth_year is that date's year. A hand-edited birth_year with the date left alone means the
-- date was wrong: it is cleared, and the year the person typed stands.
-- ============================================================================

-- SECRET-COLUMN: birth_date   (players has no table-wide SELECT since 0171, so a new column is unreadable to the browser until it is granted by name; this one never is)
alter table public.players add column if not exists birth_date date;
comment on column public.players.birth_date is
  'SECRET full date of birth, adults only (players_bio_guard drops it for under-18s). Never granted to anon/authenticated; the age is public through player_ages(), the date is not.';

create or replace function public.players_bio_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- a birth_year edited by hand while the date stayed as it was: the date was wrong, the year the person typed stands
  if tg_op = 'UPDATE' and new.birth_date is not distinct from old.birth_date
     and new.birth_year is distinct from old.birth_year then
    new.birth_date := null;
  end if;
  -- a date that would make him a minor (or is not a person's) is never kept; his year is
  if new.birth_date is not null
     and (new.birth_date > (current_date - interval '18 years')::date or new.birth_date < date '1930-01-01') then
    new.birth_year := coalesce(new.birth_year, extract(year from new.birth_date)::int);
    new.birth_date := null;
  end if;
  -- the date is the truth: the year is its year
  if new.birth_date is not null then
    new.birth_year := extract(year from new.birth_date)::int;
  end if;
  return new;
end $$;

drop trigger if exists players_bio_guard on public.players;
create trigger players_bio_guard before insert or update of birth_date, birth_year on public.players
  for each row execute function public.players_bio_guard();

-- the age, and only the age ------------------------------------------------------------------------------------------------------
create or replace function public.player_ages(p_ids uuid[])
returns table (player_id uuid, age int)
language sql stable security definer set search_path = public as $$
  select p.id, date_part('year', age(current_date, p.birth_date))::int
    from public.players p
   where p.id = any ((coalesce(p_ids, '{}'::uuid[]))[1:500])
     and p.birth_date is not null
     and not public.player_withheld(p.is_minor, p.public_consent)
$$;
revoke all on function public.player_ages(uuid[]) from public;
grant execute on function public.player_ages(uuid[]) to anon, authenticated, service_role;
