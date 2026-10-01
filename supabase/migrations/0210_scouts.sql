-- ============================================================================
-- 0210: THE SCOUT ROLE - who may use global scouting's Imports tab (scouting/imports.js)
--
-- The Imports tab turns the files a scout's browser extension saves (fa_results_<date>.csv: players on teams'
-- rosters, their agents and their last season) into one table to sort and filter. It is for the platform's own
-- scouts and its administrators, so the platform names its scouts:
--
--   platform_scouts            a scout, by EMAIL, like a club's front office grant (0193): it can be given before
--                              the person has ever signed in, and holds from the moment they do (on a CONFIRMED
--                              address: somebody who signed up with an address they do not own is not a scout).
--                              One live grant per address; a revoked one stays, as the record of who had it.
--   is_scout()                 the caller is a scout, or a platform administrator (every one of them is a scout)
--   scout_access()             for the page: {scout, platform}. Signed-in callers only; nothing for anybody else
--   grant_scout(email, note)   a platform administrator only. Idempotent: the same address twice is one grant.
--                              Audit-logged. Says whether it holds now or waits for them to sign in.
--   revoke_scout(email)        a platform administrator only. Audit-logged. Returns how many it ended (0 or 1).
--   scouts_list()              a platform administrator only: every live grant, with whether the address has a
--                              confirmed account yet, and when it was last seen
--
-- THE ROLE GUARDS A TOOL, NOT DATA. The tab reads the scout's own files in their browser and keeps them there
-- (IndexedDB): nothing of them is sent to Epinoia, so there is no table of imports here to protect. The table
-- below has row-level security on and no policy: it is read and written through these functions only.
--
-- Re-runnable.
-- ============================================================================

create table if not exists public.platform_scouts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  note        text,
  granted_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  constraint platform_scouts_email_ck check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint platform_scouts_note_ck check (note is null or char_length(note) <= 200)
);
create unique index if not exists platform_scouts_live on public.platform_scouts (email) where revoked_at is null;
alter table public.platform_scouts enable row level security;
revoke all on public.platform_scouts from anon, authenticated;

comment on table public.platform_scouts is
  '0210: the platform''s scouts, by email (global scouting''s Imports tab). Through grant_scout / revoke_scout / scouts_list / is_scout / scout_access only.';

/* THE CALLER IS A SCOUT: a platform administrator, or a live grant on their own confirmed address */
create or replace function public.is_scout()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null and (
    public.is_platform_admin()
    or exists (select 1
                 from auth.users u
                 join platform_scouts s on s.email = lower(u.email::text) and s.revoked_at is null
                where u.id = auth.uid() and u.email_confirmed_at is not null));
$$;

/* WHAT THE PAGE ASKS: may this person see the Imports tab, and are they the platform's */
create or replace function public.scout_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('scout', public.is_scout(),
                            'platform', auth.uid() is not null and public.is_platform_admin());
$$;

/* NAME A SCOUT, by address: now, or the moment they sign in with it */
create or replace function public.grant_scout(p_email text, p_note text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  v uuid;
  has_account boolean;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can name a scout' using errcode = '42501';
  end if;
  if position('@' in e) < 2 or e ~ '\s' or char_length(e) > 320 then
    raise exception 'that is not an email address' using errcode = '22023';
  end if;
  select exists (select 1 from auth.users u where lower(u.email::text) = e and u.email_confirmed_at is not null) into has_account;
  select s.id into v from platform_scouts s where s.email = e and s.revoked_at is null;
  if v is not null then
    return 'already a scout: ' || e;
  end if;
  insert into platform_scouts (email, note, granted_by)
  values (e, nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid())
  returning id into v;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_scout', 'platform_scout', v::text, jsonb_build_object('email', e));
  return case when has_account then 'granted: ' || e || ' is a scout'
              else 'invited: ' || e || ' is a scout from the moment they sign in with that address' end;
end $$;

/* TAKE IT BACK: the row stays (revoked_at), the tab goes at their next visit */
create or replace function public.revoke_scout(p_email text)
returns integer language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, ''))); n integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can change who is a scout' using errcode = '42501';
  end if;
  update platform_scouts set revoked_at = now() where email = e and revoked_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_log (actor, action, subject, subject_id, detail)
    values (auth.uid(), 'revoke_scout', 'platform_scout', e, jsonb_build_object('email', e));
  end if;
  return n;
end $$;

/* EVERY SCOUT, for the platform's console: the address, the note, since when, and whether they have signed in yet */
create or replace function public.scouts_list()
returns table (email text, note text, created_at timestamptz, has_account boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can see the scouts' using errcode = '42501';
  end if;
  return query
    select s.email, s.note, s.created_at,
           exists (select 1 from auth.users u where lower(u.email::text) = s.email and u.email_confirmed_at is not null),
           (select max(u.last_sign_in_at) from auth.users u where lower(u.email::text) = s.email)
      from platform_scouts s
     where s.revoked_at is null
     order by s.created_at desc, s.email;
end $$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.is_scout() from public, anon;
revoke all on function public.scout_access() from public, anon;
revoke all on function public.grant_scout(text, text) from public, anon;
revoke all on function public.revoke_scout(text) from public, anon;
revoke all on function public.scouts_list() from public, anon;
grant execute on function public.is_scout() to authenticated;
grant execute on function public.scout_access() to authenticated;
grant execute on function public.grant_scout(text, text) to authenticated;
grant execute on function public.revoke_scout(text) to authenticated;
grant execute on function public.scouts_list() to authenticated;
