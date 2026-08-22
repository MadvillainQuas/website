-- ============================================================================
-- THE LEAGUE'S OFFICIALS, ENTERED ONCE.
--
-- 0076 gave a fixture somewhere to record who refereed it, typed by hand on the
-- night. That is right for a friendly and wrong for a competition: the same
-- thirty people officiate all season, a statistician typing at 19:25 spells
-- them thirty different ways, and "A Shaw", "Shaw, A." and "Adam Shaw" become
-- three referees the moment anybody tries to count appearances.
--
-- So a league keeps a list, and the scorer picks from it. Typing stays
-- available — a late replacement who is not on the list must not stop a game
-- being scored, which is the failure mode of every system that made the
-- dropdown compulsory.
--
-- WHY NOT auth.users. Same reason as 0076: a referee is almost never a user of
-- this platform, and requiring an account before a name can appear on a
-- scoresheet means either inventing logins nobody signs into or leaving the
-- line blank. game_officials remains what it always was — who may WRITE to a
-- fixture.
-- ============================================================================

create table if not exists public.league_officials (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues on delete cascade,
  name       text not null,
  /* Which chairs this person can fill. A referee is usually also willing to sit
     at the table, and a league with eight people cannot afford two lists. The
     scorer filters the dropdown by the role being filled, so a timekeeper is
     not offered as a crew chief. */
  roles      text[] not null default '{referee}',
  licence    text,                                  -- their number, for the sheet
  active     boolean not null default true,         -- kept, not deleted: a name on
                                                    -- last season's scoresheets must
                                                    -- not vanish from history
  note       text not null default '',
  created_at timestamptz not null default now(),
  unique (league_id, name)
);
create index if not exists league_officials_league on public.league_officials (league_id, active);

comment on table public.league_officials is
  'The people a league can appoint to a fixture. Names, not accounts — see '
  'game_officials for who may write to a game.';

-- ----------------------------------------------------------------------------
-- WHO CAN SEE AND CHANGE THIS
--
-- Read is any signed-in user, and that is a deliberate, narrow decision rather
-- than laziness: these names are printed on the public scoresheet of every game
-- they officiate, so the list is not a secret from anybody who can already read
-- a results page. What it is NOT is anonymous — an unauthenticated scrape of
-- "every referee in this league, with their licence numbers" is a different
-- thing from a name on a match record, and there is no reason to offer it.
--
-- Write is the league's own administrators, and platform administrators.
-- ----------------------------------------------------------------------------
alter table public.league_officials enable row level security;

drop policy if exists league_officials_read on public.league_officials;
create policy league_officials_read on public.league_officials for select
  using (auth.uid() is not null);

drop policy if exists league_officials_write on public.league_officials;
create policy league_officials_write on public.league_officials for all
  using (public.is_platform_admin() or public.is_league_admin(league_id))
  with check (public.is_platform_admin() or public.is_league_admin(league_id));

-- ----------------------------------------------------------------------------
-- What the scorer asks for: the officials available to THIS fixture.
--
-- A fixture knows its competition, a competition knows its season, a season
-- knows its league — the scorer knows only a game id, and should not have to
-- learn that chain to fill a dropdown.
-- ----------------------------------------------------------------------------
create or replace function public.officials_for_game(p_game uuid)
returns table (id uuid, name text, roles text[], licence text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.roles, o.licence
  from public.games g
  join public.competitions c on c.id = g.competition_id
  join public.seasons s      on s.id = c.season_id
  join public.league_officials o on o.league_id = s.league_id
  where g.id = p_game and o.active
  order by o.name;
$$;
grant execute on function public.officials_for_game(uuid) to authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  lid uuid;
  n   int;
begin
  select id into lid from public.leagues limit 1;
  if lid is null then
    raise notice '0078 self-test skipped: no leagues';
    return;
  end if;

  insert into public.league_officials (league_id, name, roles)
  values (lid, '__selftest one', '{referee,timekeeper}');

  -- the same name twice in one league is a typo, not a second person
  begin
    insert into public.league_officials (league_id, name) values (lid, '__selftest one');
    raise exception '0078: a duplicate official name was accepted';
  exception when unique_violation then null; end;

  -- roles are queryable, which is what lets the dropdown filter by chair
  select count(*) into n from public.league_officials
   where league_id = lid and name = '__selftest one' and 'timekeeper' = any(roles);
  if n <> 1 then raise exception '0078: roles did not round-trip'; end if;

  delete from public.league_officials where name = '__selftest one';
  raise notice '0078 ok: one list per league, names unique, roles queryable';
end $$;
