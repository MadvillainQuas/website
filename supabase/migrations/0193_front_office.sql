-- 0193: THE FRONT OFFICE, IN YOUR HUB.
--
-- A club's Front office tab (the projected depth chart, each position against the league, the GM's view) is on
-- every team profile. The people who work for a club want it one press away, so the rail's hub ("your hub",
-- formerly "your profile") lists a Front office button for every club the signed-in person is attached to:
--
--   BY A ROLE     a team-scoped role in the console's roles and admin controls (memberships: team_manager or
--                 statistician with scope_type 'team') - the club's own officials;
--   BY A GRANT    a club official gave them the control: front_office_grants, keyed on an EMAIL like
--                 access_grants (0117) so an analyst or a scout can be added before they have ever signed in,
--                 and it takes effect the moment they do.
--
-- AND A MEMBERSHIP. Each club comes back with members_ok = can_use_analytics(its league) for the caller: true
-- everywhere while memberships are switched off (0117's master switch), and afterwards only for a member (or
-- anyone the league's analytics are free to). The hub shows the button where it is true.
--
-- Who may grant: is_team_manager(team) - the club's managers, its league's administrators and platform
-- administrators, the same people who may edit the club. The table has row-level security on and no policy:
-- it is read and written only through the four functions below.

create table if not exists public.front_office_grants (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams on delete cascade,
  email       text not null,
  note        text,
  granted_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  constraint front_office_grants_email_ck check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint front_office_grants_note_ck check (note is null or char_length(note) <= 200)
);
-- one live grant per club and address; a revoked one stays as the record of who had it
create unique index if not exists front_office_grants_live on public.front_office_grants (team_id, email) where revoked_at is null;
create index if not exists front_office_grants_email_idx on public.front_office_grants (email) where revoked_at is null;
alter table public.front_office_grants enable row level security;
revoke all on public.front_office_grants from anon, authenticated;

comment on table public.front_office_grants is
  '0193: a club official gives an email address its Front office (depth chart, positions, GM view) in the rail''s hub. Through grant_front_office / revoke_front_office / front_office_grants_for / my_front_offices only.';

/* GIVE AN ADDRESS THE CLUB'S FRONT OFFICE. Idempotent: the same address twice is the same grant. */
create or replace function public.grant_front_office(p_team uuid, p_email text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  v uuid;
begin
  if auth.uid() is null or p_team is null or not public.is_team_manager(p_team) then
    raise exception 'only the club''s own officials can share its front office' using errcode = '42501';
  end if;
  if position('@' in e) < 2 or e ~ '\s' then
    raise exception 'that is not an email address' using errcode = '22023';
  end if;
  select g.id into v from front_office_grants g where g.team_id = p_team and g.email = e and g.revoked_at is null;
  if v is not null then return v; end if;
  insert into front_office_grants (team_id, email, note, granted_by)
  values (p_team, e, nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid())
  returning id into v;
  return v;
end $$;

/* TAKE IT BACK. The row stays (revoked_at), so the club can see who had it; the hub drops the button at once. */
create or replace function public.revoke_front_office(p_team uuid, p_email text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or p_team is null or not public.is_team_manager(p_team) then
    raise exception 'only the club''s own officials can change who has its front office' using errcode = '42501';
  end if;
  update front_office_grants set revoked_at = now()
   where team_id = p_team and email = lower(btrim(coalesce(p_email, ''))) and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

/* WHO HAS IT: the club's live grants, for its officials only. */
create or replace function public.front_office_grants_for(p_team uuid)
returns table (email text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or p_team is null or not public.is_team_manager(p_team) then
    raise exception 'only the club''s own officials can see who has its front office' using errcode = '42501';
  end if;
  return query
    select g.email, g.note, g.created_at from front_office_grants g
     where g.team_id = p_team and g.revoked_at is null
     order by g.created_at;
end $$;

/* THE HUB'S LIST: every club the caller is attached to, by a team role or a grant to their address, with whether
   their membership opens its front office. A role wins over a grant for the same club (it says more). Signed out,
   or attached to nothing: no rows. */
create or replace function public.my_front_offices()
returns table (team_id uuid, slug text, name text, short_name text, colour text, logo_path text,
               league_id uuid, league_slug text, league_name text, via text, members_ok boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid, (select lower(u.email) from auth.users u where u.id = auth.uid()) as email
  ), mine as (
    select m.scope_id as team_id, 'role'::text as via
      from memberships m, me
     where me.uid is not null and m.user_id = me.uid
       and m.role in ('team_manager', 'statistician') and m.scope_type = 'team' and m.scope_id is not null
    union all
    select g.team_id, 'grant'::text
      from front_office_grants g, me
     where me.email is not null and g.email = me.email and g.revoked_at is null
  )
  select distinct on (t.id) t.id, t.slug, t.name, t.short_name, t.colour, t.logo_path,
         l.id, l.slug, l.name, x.via, public.can_use_analytics(t.league_id)
    from mine x
    join teams t on t.id = x.team_id
    left join leagues l on l.id = t.league_id
   order by t.id, (x.via = 'role') desc;
$$;

revoke all on function public.grant_front_office(uuid, text, text) from public, anon;
revoke all on function public.revoke_front_office(uuid, text) from public, anon;
revoke all on function public.front_office_grants_for(uuid) from public, anon;
revoke all on function public.my_front_offices() from public, anon;
grant execute on function public.grant_front_office(uuid, text, text) to authenticated;
grant execute on function public.revoke_front_office(uuid, text) to authenticated;
grant execute on function public.front_office_grants_for(uuid) to authenticated;
grant execute on function public.my_front_offices() to authenticated;
