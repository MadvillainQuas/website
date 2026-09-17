-- ============================================================================
-- 0131 — A LEAGUE SAYS WHOSE GAME IT IS.
--
-- The global scouting page puts every league's players in one table. Nobody
-- scouts across that line: a recruiter working a women's roster does not want
-- SLB Men and BCB in the same ranking, and until now had no way to say so,
-- because nothing in the data knew the difference. Two leagues whose names
-- happen to end in "Men" and "Women" is not knowledge, it is a coincidence
-- this code should not be reading.
--
-- So it is a column. `men`, `women`, or `mixed` — and null, which is the
-- honest answer for a league nobody has said yet and is why the filter offers
-- "all" as its resting state rather than guessing.
--
-- WHY NOT A LOOKUP TABLE. There are three values and there will be three
-- values; a table would buy a join on every page that lists leagues and a
-- migration the first time somebody typed 'Women' with a capital.
--
-- WHO MAY SET IT: the league's own administrators and the platform, which is
-- exactly is_league_admin (0001 — it returns true for platform admins too).
-- Reading is public: leagues_read (0001) already exposes every column, and the
-- browser tolerates this one being absent, so a page loaded from a cache older
-- than this migration still works.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.leagues
  add column if not exists gender text;

do $c$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.leagues'::regclass
                    and conname = 'leagues_gender_ck') then
    alter table public.leagues
      add constraint leagues_gender_ck
      check (gender is null or gender in ('men', 'women', 'mixed'));
  end if;
end $c$;

comment on column public.leagues.gender is
  'men | women | mixed — whose competition this is, for the global scouting '
  'filter. null = not stated, which every filter treats as "show it under all".';

-- ---------------------------------------------------------------- the write --
create or replace function public.set_league_gender(
  p_league uuid,
  p_gender text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(btrim(lower(coalesce(p_gender, ''))), '');
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if v is not null and v not in ('men', 'women', 'mixed') then
    raise exception 'a league is men, women or mixed' using errcode = '22023';
  end if;

  update public.leagues set gender = v where id = p_league;
  if not found then
    raise exception 'no such league' using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_gender', 'league', p_league::text,
          jsonb_build_object('gender', v));

  return coalesce(v, 'not stated');
end $$;

-- ----------------------------------------------------------- the three now --
-- The platform has three leagues and all three are unambiguous, so they are
-- filled in here rather than left for somebody to find in a console: the
-- filter is useful the moment this runs. ONLY where nothing has been said —
-- re-running this never overwrites an administrator's own answer — and only
-- these exact slugs, because "it has Women in the name" is not a rule this
-- file is allowed to invent for leagues it has not been told about.
update public.leagues set gender = 'men'
  where gender is null and slug in ('bcb', 'slb-men');
update public.leagues set gender = 'women'
  where gender is null and slug = 'slb-women';

-- ------------------------------------------------------------- self-test ----
-- Re-running this file must be safe, and a check constraint that lets 'Women'
-- through would be found by the first league to type it rather than here.
do $t$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.leagues'::regclass
                    and conname = 'leagues_gender_ck') then
    raise exception '0131: the gender check constraint is missing';
  end if;
  if exists (select 1 from public.leagues
              where gender is not null and gender not in ('men','women','mixed')) then
    raise exception '0131: a league holds a gender outside the three allowed';
  end if;
end $t$;

revoke all on function public.set_league_gender(uuid, text) from public;
grant execute on function public.set_league_gender(uuid, text) to authenticated;

comment on function public.set_league_gender(uuid, text) is
  'Set a league to men, women or mixed (null clears it). League admins and the '
  'platform only; audited as league.gender.';
