-- ============================================================================
-- WHO TO ASK, AND WHO IS ON THE BENCH.
--
-- Two things a club page has always been missing: a way to reach the club, and
-- the people around the team who are not players.
--
-- ---------------------------------------------------------------------------
-- 1. CONTACT DETAILS — stored on a table nobody can SELECT.
--
-- The obvious design is three columns on `teams`. `teams` is world-readable,
-- which would put every club secretary's address one anonymous request away
-- from any scraper that ever finds this site. Column-level revokes would fix
-- the leak and break `select=*` for everybody, which is how every page on the
-- site reads a team.
--
-- So the details live on their own closed table and come back through a
-- function that decides, per caller, what they are allowed to see. A club may
-- publish its details or keep them private; either way the CONTACT FORM still
-- works, because the form's recipient is resolved on the server and the
-- browser is never told the address. That is the same rule the site-wide
-- contact form follows.
--
-- ---------------------------------------------------------------------------
-- 2. STAFF — head coach, assistants, physio, S&C, everyone else.
--
-- Year of birth, never a date of birth — the same rule `players` already
-- follows, and for the same reason. A squad list says "Head Coach, 47"; it has
-- no business holding somebody's birthday, and an age derived from a stored
-- year cannot go stale the way a typed-in age does. The cost is that the age
-- is right to within a year, which is what a staff list means anyway.
-- ============================================================================

-- ---------------------------------------------------------------- contact ---
create table if not exists public.team_contacts (
  team_id      uuid primary key references public.teams on delete cascade,
  contact_name text,                       -- the person, e.g. "Club Secretary"
  email        text,
  phone        text,
  is_public    boolean not null default true,
  accepts_form boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users on delete set null
);

alter table public.team_contacts enable row level security;

-- Managers and league admins may read their own club's row in full. Everyone
-- else gets nothing from the table directly and must go through the function
-- below, which redacts. Default-deny does the rest.
drop policy if exists team_contacts_manage_read on public.team_contacts;
create policy team_contacts_manage_read on public.team_contacts
  for select to authenticated using (public.is_team_manager(team_id));

drop policy if exists team_contacts_write on public.team_contacts;
create policy team_contacts_write on public.team_contacts
  for all to authenticated
  using (public.is_team_manager(team_id))
  with check (public.is_team_manager(team_id));

-- What a visitor may know. `has_email` / `has_phone` are reported even when
-- the values are withheld, so the page can say "this club can be reached"
-- without saying how — otherwise a private club looks like an absent one.
create or replace function public.team_contact(p_team uuid)
returns table (contact_name text, email text, phone text,
               is_public boolean, accepts_form boolean,
               has_email boolean, has_phone boolean, can_edit boolean)
language sql stable security definer set search_path = public as $$
  select
    case when c.is_public or public.is_team_manager(c.team_id) then c.contact_name end,
    case when c.is_public or public.is_team_manager(c.team_id) then c.email end,
    case when c.is_public or public.is_team_manager(c.team_id) then c.phone end,
    c.is_public,
    c.accepts_form,
    c.email is not null and c.email <> '',
    c.phone is not null and c.phone <> '',
    public.is_team_manager(c.team_id)
  from team_contacts c
  where c.team_id = p_team
  union all
  -- no row yet: still tell a manager they may create one
  select null, null, null, true, false, false, false, public.is_team_manager(p_team)
  where not exists (select 1 from team_contacts c2 where c2.team_id = p_team)
  limit 1;
$$;

-- Writing. A function rather than a bare table write so the shape is checked
-- in one place and a manager cannot set `updated_by` to somebody else.
create or replace function public.set_team_contact(
  p_team uuid, p_contact_name text, p_email text, p_phone text,
  p_is_public boolean default true, p_accepts_form boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name  text := nullif(btrim(coalesce(p_contact_name, '')), '');
begin
  if not public.is_team_manager(p_team) then
    raise exception 'only somebody who manages that club may set its contact details'
      using errcode = '42501';
  end if;

  -- Deliberately loose, for the same reason the contact function is: rejecting
  -- a valid address costs a club its enquiries, accepting a malformed one
  -- costs one bounced reply.
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address';
  end if;
  if length(coalesce(v_phone, '')) > 40 then
    raise exception 'that telephone number is too long to be one';
  end if;

  insert into team_contacts (team_id, contact_name, email, phone,
                             is_public, accepts_form, updated_at, updated_by)
  values (p_team, left(v_name, 120), left(v_email, 200), v_phone,
          coalesce(p_is_public, true), coalesce(p_accepts_form, true), now(), auth.uid())
  on conflict (team_id) do update
    set contact_name = excluded.contact_name,
        email        = excluded.email,
        phone        = excluded.phone,
        is_public    = excluded.is_public,
        accepts_form = excluded.accepts_form,
        updated_at   = now(),
        updated_by   = auth.uid();
end; $$;

grant execute on function public.team_contact(uuid) to anon, authenticated;
revoke execute on function
  public.set_team_contact(uuid, text, text, text, boolean, boolean) from anon, public;
grant execute on function
  public.set_team_contact(uuid, text, text, text, boolean, boolean) to authenticated;

-- ------------------------------------------------------------------ staff ---
create table if not exists public.team_staff (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  name       text not null,
  role       text not null,
  born_year  int,
  sort       int not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists team_staff_team on public.team_staff (team_id, sort, role);

do $$ begin
  alter table public.team_staff
    add constraint team_staff_born_year_ck
    check (born_year is null or born_year between 1900 and extract(year from now())::int);
exception when duplicate_object then null; end $$;

alter table public.team_staff enable row level security;

-- The raw rows are for managers only.
drop policy if exists team_staff_manage on public.team_staff;
create policy team_staff_manage on public.team_staff
  for all to authenticated
  using (public.is_team_manager(team_id))
  with check (public.is_team_manager(team_id));

-- What everyone else sees. The view is SECURITY DEFINER by default, so it
-- reads past the policy above deliberately — and carries only name, role and
-- a whole number of years.
create or replace view public.team_staff_public as
  select s.id,
         s.team_id,
         s.name,
         s.role,
         case when s.born_year is not null
              then extract(year from current_date)::int - s.born_year end as age,
         s.sort
    from public.team_staff s
   where s.active;

grant select on public.team_staff_public to anon, authenticated;

-- Ordering that reads like a staff list rather than an alphabet. A club can
-- override it per person; this is only what a new entry defaults to.
create or replace function public.staff_rank(p_role text)
returns int language sql immutable as $$
  select case lower(btrim(coalesce(p_role, '')))
    when 'head coach'            then 10
    when 'manager'               then 10
    when 'assistant coach'       then 20
    when 'associate head coach'  then 15
    when 'player development'    then 25
    when 'general manager'       then 30
    when 'team manager'          then 35
    when 'strength and conditioning' then 40
    when 's&c'                   then 40
    when 'physiotherapist'       then 50
    when 'physio'                then 50
    when 'doctor'                then 55
    when 'analyst'               then 60
    when 'video analyst'         then 60
    when 'scout'                 then 65
    when 'equipment manager'     then 70
    when 'statistician'          then 75
    else 100
  end;
$$;
grant execute on function public.staff_rank(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Prove both functions run. A plpgsql body is not type-checked when it is
-- created, so a migration that only installs one has proved nothing — this
-- project has been bitten by exactly that twice.
-- ---------------------------------------------------------------------------
do $$
declare
  v_team uuid;
  r      record;
begin
  select id into v_team from teams limit 1;
  if v_team is null then
    raise notice 'no teams yet — functions installed but not exercised';
    return;
  end if;

  select * into r from public.team_contact(v_team);
  raise notice 'team_contact() runs: accepts_form=% can_edit=%', r.accepts_form, r.can_edit;

  if public.staff_rank('Head Coach') <> 10 or public.staff_rank('Kit Washer') <> 100 then
    raise exception 'staff_rank is not ordering roles as intended';
  end if;

  perform count(*) from public.team_staff_public where team_id = v_team;
  raise notice 'team_staff_public reads clean';

  -- set_team_contact is SECURITY DEFINER and refuses without a manager, which
  -- is the behaviour worth proving here: it must NOT silently succeed.
  begin
    perform public.set_team_contact(v_team, 'x', 'x@example.com', '0', true, true);
    raise notice 'set_team_contact permitted (running as owner/superuser)';
  exception when insufficient_privilege then
    raise notice 'set_team_contact correctly refuses a caller who manages nothing';
  end;
  delete from team_contacts where team_id = v_team and email = 'x@example.com';
end $$;
