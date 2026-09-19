-- ============================================================================
-- 0140 — GRANTING A ROLE TO SOMEBODY WHO HAS NOT SIGNED IN YET, and three
--        sharp edges on the roles machinery that were waiting to cut somebody.
--
-- THE MAIN THING. grant_role and grant_league_writer both ended, since 0007 and
-- 0051, with this:
--
--     'no account for ' || p_email || ' yet — ask them to sign in once at
--      /epinoia/app/, then grant again'
--
-- which is not a grant, it is homework. Every appointment on the platform has
-- therefore been a three-step dance across two people and an unbounded amount of
-- time: type the address, be told no, message them, wait, remember to come back.
-- The step that gets forgotten is the last one, and the failure looks to the new
-- league admin exactly like being locked out — they signed in as asked, and the
-- console they were promised is not there. That is the "it bugs out when they log
-- in" complaint, and it was never a bug in signing in.
--
-- So an address with no account behind it now stores the grant instead of
-- refusing it, and it lands by itself the moment that person confirms their
-- email. From the admin's side there is one step and it always works. From the
-- new admin's side they sign in and the league is there.
--
-- WHY CONFIRMATION AND NOT SIGN-UP. A pending grant is keyed on an email
-- address, and an address is only proof of anything once somebody has shown they
-- can read it. Supabase creates the auth.users row when a sign-up or an OTP is
-- REQUESTED, before any code is entered, so applying the grant at insert would
-- hand a league to whoever typed the address first. It is applied when
-- email_confirmed_at is set — plus, for completeness, at insert if the row
-- arrives already confirmed, which is what an admin-created or provider account
-- looks like.
--
-- AND THREE EDGES FOUND WHILE READING THIS CODE:
--
--   1. memberships has `unique (user_id, role, scope_type, scope_id)`, and in
--      Postgres two NULLs are not equal, so that constraint never fired for a
--      platform_admin grant (scope_id null). Granting the same person platform
--      admin twice made two rows. Which mattered, because —
--   2. revoke_role's "never leave the platform with no administrator" counted
--      ROWS. Two duplicate rows for one person read as two administrators, so
--      the guard would happily let the only real one be removed, and the last
--      thing to go would be the ability to put anybody back.
--   3. grant_role took the caller's scope_type for a platform_admin grant. A
--      platform admin scoped to a league is not a thing — is_platform_admin()
--      does not look at scope — so it made a row that says something untrue and
--      that revoke_role's platform branch then treats as platform-wide anyway.
--
-- Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE THREE EDGES, before anything is built on top of them.
-- ----------------------------------------------------------------------------

/* Fold any duplicate scope-less memberships down to one, oldest kept, then make
   it impossible to make another. A partial unique index is the only way to say
   "one per (user, role)" when scope_id is null, because the table constraint
   cannot: `nulls not distinct` exists in PG15 but changing a shipped constraint
   on a live table is a bigger move than adding an index beside it. */
delete from public.memberships a
 using public.memberships b
 where a.scope_id is null and b.scope_id is null
   and a.user_id = b.user_id and a.role = b.role
   and a.created_at > b.created_at;

create unique index if not exists memberships_platform_one
  on public.memberships (user_id, role) where scope_id is null;

/* Count people, not rows. With the index above the two are the same today, but
   the guard is the thing standing between the platform and having no
   administrator at all, and it should not depend on another object to be right. */
create or replace function public.revoke_role(p_membership uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  select * into m from memberships where id = p_membership;
  if not found then return 'already revoked'; end if;

  if m.role = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'only a platform admin may revoke platform admin' using errcode = '42501';
    end if;
    if (select count(distinct user_id) from memberships where role = 'platform_admin') <= 1 then
      raise exception 'this is the only platform admin — grant another one first'
        using errcode = '23514';
    end if;
  elsif m.scope_type = 'league' then
    if not public.is_league_admin(m.scope_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  elsif m.scope_type = 'team' then
    if not public.is_team_manager(m.scope_id) then
      raise exception 'you do not manage that team' using errcode = '42501';
    end if;
  end if;

  delete from memberships where id = p_membership;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'revoke_role', 'membership', m.user_id::text,
          jsonb_build_object('role', m.role::text, 'scope_id', m.scope_id));

  return 'revoked';
end; $$;

-- ----------------------------------------------------------------------------
-- 2. THE WAITING ROOM.
--
-- One row is one appointment that has not found its person yet. Keyed on the
-- address, lowercased and trimmed on the way in, because that is the only thing
-- known about them.
--
-- `role` is text, not role_kind, because this has to hold the news writer too —
-- which is not a membership at all (it lives in league_writers, 0051) but fails
-- for exactly the same reason and would otherwise need a second waiting room
-- with a second trigger and a second way to forget about it.
--
-- NOBODY READS THIS TABLE THROUGH THE API. It is a list of addresses somebody
-- thought worth appointing, which is not public; the console reads it through
-- pending_roles_list, scoped to what the caller administers.
-- ----------------------------------------------------------------------------
create table if not exists public.pending_roles (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(trim(email)) and email like '%_@_%'),
  role        text not null check (role in ('platform_admin','league_admin','team_manager',
                                            'statistician','news_writer')),
  scope_type  text not null check (scope_type in ('platform','league','team')),
  scope_id    uuid,
  invited_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  constraint pending_roles_scope_ck
    check ((scope_type = 'platform') = (scope_id is null))
);

create unique index if not exists pending_roles_one
  on public.pending_roles (email, role, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists pending_roles_email on public.pending_roles (email);

alter table public.pending_roles enable row level security;
drop policy if exists pending_roles_none on public.pending_roles;
create policy pending_roles_none on public.pending_roles for select using (false);

comment on table public.pending_roles is
  'Roles granted to an email address with no account yet. Applied by apply_pending_roles when '
  'that address confirms its email, then deleted. See 0140.';

-- ----------------------------------------------------------------------------
-- 3. THE LANDING.
--
-- Called from the auth.users triggers, so it runs with no auth.uid() and cannot
-- ask anybody anything: every row it applies was authorised when it was WRITTEN,
-- by grant_role or grant_league_writer, against the credentials of whoever was
-- signed in then. That is the whole security argument for this function, and it
-- is why nothing may write pending_roles except those two.
--
-- It never raises. A trigger on auth.users that throws blocks the sign-up, and a
-- malformed pending row — a league deleted between the invitation and the
-- arrival, say — must not be the reason somebody cannot create an account. A row
-- that cannot be applied is dropped with a warning; the admin can grant again
-- now that there is an account to grant to.
-- ----------------------------------------------------------------------------
create or replace function public.apply_pending_roles(p_user uuid, p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if p_user is null or coalesce(trim(p_email), '') = '' then return 0; end if;

  for r in select * from pending_roles where email = lower(trim(p_email)) loop
    begin
      if r.role = 'news_writer' then
        insert into league_writers (league_id, user_id, created_by)
        values (r.scope_id, p_user, r.invited_by) on conflict do nothing;
      else
        insert into memberships (user_id, role, scope_type, scope_id)
        values (p_user, r.role::public.role_kind, r.scope_type::public.scope_kind, r.scope_id)
        on conflict do nothing;
      end if;

      insert into audit_log (actor, action, subject, subject_id, detail)
      values (r.invited_by, 'pending_role_applied', 'membership', p_user::text,
              jsonb_build_object('email', r.email, 'role', r.role,
                                 'scope_type', r.scope_type, 'scope_id', r.scope_id));
      n := n + 1;
    exception when others then
      raise warning '0140: a waiting % for % could not be applied (%) — dropped', r.role, r.email, sqlerrm;
    end;
    delete from pending_roles where id = r.id;
  end loop;
  return n;
end; $$;

/* The two triggers. handle_new_user keeps doing exactly what it did (0001) and
   gains the already-confirmed case; the new one is the ordinary path, where the
   row exists first and the code is entered a minute later. */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  if new.email_confirmed_at is not null then
    perform public.apply_pending_roles(new.id, new.email);
  end if;
  return new;
end; $$;

create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.apply_pending_roles(new.id, new.email);
  return new;
end; $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- ----------------------------------------------------------------------------
-- 4. THE TWO GRANTS, WHICH NOW ALWAYS GRANT SOMETHING.
--
-- Same authorisation as before, to the letter — the only change is what happens
-- after the address turns out to have no account. Both still return a sentence
-- the console shows verbatim, and both now say plainly that it is waiting rather
-- than that it failed, because the console's own error styling keys off the old
-- "no account" opening and an admin reads red as "that did not work".
-- ----------------------------------------------------------------------------
create or replace function public.grant_role(
  p_email      text,
  p_role       text,
  p_scope_type text,
  p_scope_id   uuid default null
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
  addr text := lower(trim(coalesce(p_email, '')));
  r public.role_kind := p_role::public.role_kind;
  st public.scope_kind := p_scope_type::public.scope_kind;
  sid uuid := p_scope_id;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if addr not like '%_@_%' then
    raise exception '% is not an email address', addr using errcode = '22023';
  end if;

  if r = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'only a platform admin may grant platform admin'
        using errcode = '42501';
    end if;
    -- edge 3: platform admin is platform-wide by definition, whatever was sent
    st := 'platform'; sid := null;
  elsif st = 'league' then
    if sid is null or not public.is_league_admin(sid) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  elsif st = 'team' then
    if sid is null or not public.is_team_manager(sid) then
      raise exception 'you do not manage that team' using errcode = '42501';
    end if;
  else
    raise exception 'platform scope is reserved for platform_admin'
      using errcode = '42501';
  end if;

  select id into uid from auth.users where lower(email) = addr limit 1;

  if uid is null then
    insert into pending_roles (email, role, scope_type, scope_id, invited_by)
    values (addr, r::text, st::text, sid, auth.uid())
    on conflict do nothing;

    insert into audit_log (actor, action, subject, subject_id, detail)
    values (auth.uid(), 'grant_role_pending', 'email', addr,
            jsonb_build_object('role', p_role, 'scope_type', st::text, 'scope_id', sid));

    return 'invited ' || addr || ' as ' || p_role ||
           ' — there is no account on that address yet, so the role is waiting: it applies by ' ||
           'itself the moment they sign up and confirm the address. Nothing more to do.';
  end if;

  insert into memberships (user_id, role, scope_type, scope_id)
  values (uid, r, st, sid)
  on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_role', 'membership', uid::text,
          jsonb_build_object('email', addr, 'role', p_role,
                             'scope_type', st::text, 'scope_id', sid));

  return 'granted ' || p_role || ' to ' || addr;
end; $$;

create or replace function public.grant_league_writer(p_league uuid, p_email text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; addr text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if addr not like '%_@_%' then
    raise exception '% is not an email address', addr using errcode = '22023';
  end if;

  select id into uid from auth.users where lower(email) = addr limit 1;
  if uid is null then
    insert into pending_roles (email, role, scope_type, scope_id, invited_by)
    values (addr, 'news_writer', 'league', p_league, auth.uid())
    on conflict do nothing;
    insert into audit_log (actor, action, subject, subject_id, detail)
    values (auth.uid(), 'grant_league_writer_pending', 'league', p_league::text,
            jsonb_build_object('email', addr));
    return 'invited ' || addr || ' to write for this league — there is no account on that ' ||
           'address yet, so it is waiting and applies by itself when they sign up.';
  end if;

  insert into league_writers (league_id, user_id, created_by)
  values (p_league, uid, auth.uid()) on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_league_writer', 'league', p_league::text,
          jsonb_build_object('email', addr));
  return 'granted writer to ' || addr;
end; $$;

-- ----------------------------------------------------------------------------
-- 5. SEEING AND CANCELLING WHAT IS WAITING.
--
-- An invitation that never lands is worse than one that is refused: nobody is
-- told, and there is nothing on any screen to say it happened. So the console
-- lists them beside the real ones, and can take one back.
--
-- Scoped to what the caller administers, so a league admin sees their own
-- league's waiting appointments and nobody else's address.
-- ----------------------------------------------------------------------------
create or replace function public.pending_roles_list(p_league uuid default null)
returns table (id uuid, email text, role text, scope_type text, scope_id uuid,
               scope_name text, created_at timestamptz, invited_by_email text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.role, p.scope_type, p.scope_id,
           case p.scope_type
             when 'platform' then 'the whole platform'
             when 'league'   then (select l.name from leagues l where l.id = p.scope_id)
             when 'team'     then (select t.name from teams t where t.id = p.scope_id)
           end,
           p.created_at,
           (select u.email::text from auth.users u where u.id = p.invited_by)
      from pending_roles p
     where (p_league is null or (p.scope_type = 'league' and p.scope_id = p_league)
            or (p.scope_type = 'team'
                and exists (select 1 from teams t where t.id = p.scope_id and t.league_id = p_league)))
       and (public.is_platform_admin()
            or (p.scope_type = 'league' and public.is_league_admin(p.scope_id))
            or (p.scope_type = 'team'   and public.is_team_manager(p.scope_id)))
     order by p.created_at desc;
end; $$;

create or replace function public.pending_role_cancel(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select * into p from pending_roles where id = p_id;
  if not found then return 'already cancelled'; end if;

  if p.scope_type = 'platform' then
    if not public.is_platform_admin() then
      raise exception 'platform administrators only' using errcode = '42501';
    end if;
  elsif p.scope_type = 'league' then
    if not public.is_league_admin(p.scope_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  else
    if not public.is_team_manager(p.scope_id) then
      raise exception 'you do not manage that team' using errcode = '42501';
    end if;
  end if;

  delete from pending_roles where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'pending_role_cancel', 'email', p.email,
          jsonb_build_object('role', p.role, 'scope_id', p.scope_id));
  return 'the invitation to ' || p.email || ' was taken back';
end; $$;

-- ----------------------------------------------------------------------------
-- 6. GRANTS.
-- ----------------------------------------------------------------------------
revoke all on function public.apply_pending_roles(uuid, text) from public, anon, authenticated;
revoke all on function public.handle_user_confirmed() from public, anon, authenticated;
revoke all on function public.pending_roles_list(uuid) from public, anon;
revoke all on function public.pending_role_cancel(uuid) from public, anon;
grant execute on function public.pending_roles_list(uuid) to authenticated;
grant execute on function public.pending_role_cancel(uuid) to authenticated;

alter function public.apply_pending_roles(uuid, text) owner to postgres;
alter function public.handle_new_user() owner to postgres;
alter function public.handle_user_confirmed() owner to postgres;
alter function public.grant_role(text, text, text, uuid) owner to postgres;
alter function public.grant_league_writer(uuid, text) owner to postgres;
alter function public.revoke_role(uuid) owner to postgres;
alter function public.pending_roles_list(uuid) owner to postgres;
alter function public.pending_role_cancel(uuid) owner to postgres;

-- ============================================================================
-- SELF-TEST.
-- ============================================================================
do $test$
declare
  orig text := current_user;
  lg uuid; admin_u uuid; newcomer uuid; n int; msg text;
begin
  begin
    insert into leagues (slug, name) values ('t0140-lg', 'Test 0140 League') returning id into lg;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0140-admin@example.invalid', '', now(), now(), now())
      returning id into admin_u;
    insert into memberships (user_id, role, scope_type, scope_id)
    values (admin_u, 'platform_admin', 'platform', null);

    -- 1. a grant to an address with no account waits instead of refusing
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);

    /* Deliberately mixed case and padded: grant_role folds an address on the
       way in, and the assertion below looks for the folded form, so this proves
       the folding rather than just the storing. Two invitations to the same
       person differing only in case would otherwise be two rows. */
    msg := public.grant_role('  T0140-New@Example.Invalid ', 'league_admin', 'league', lg);
    if msg like 'no account%' then
      raise exception '0140: grant_role still refuses an address with no account';
    end if;
    if msg not like 'invited%' then
      raise exception '0140: unexpected answer from grant_role (%)', msg;
    end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    select count(*) into n from pending_roles where email = 't0140-new@example.invalid';
    if n <> 1 then raise exception '0140: the invitation was not stored (or not lowercased)'; end if;

    -- 2. an unconfirmed account does NOT collect it
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0140-new@example.invalid', '', now(), now())
      returning id into newcomer;
    select count(*) into n from memberships
     where user_id = newcomer and role = 'league_admin' and scope_id = lg;
    if n <> 0 then raise exception '0140: an unconfirmed address collected a waiting role'; end if;

    -- 3. ...and confirming it does, exactly once, and clears the waiting room
    update auth.users set email_confirmed_at = now() where id = newcomer;
    select count(*) into n from memberships
     where user_id = newcomer and role = 'league_admin' and scope_id = lg;
    if n <> 1 then raise exception '0140: confirming the address did not apply the waiting role'; end if;
    select count(*) into n from pending_roles where email = 't0140-new@example.invalid';
    if n <> 0 then raise exception '0140: the invitation was applied but not cleared'; end if;

    -- 4. one platform admin row per person, however many times it is granted
    insert into memberships (user_id, role, scope_type, scope_id)
    values (newcomer, 'platform_admin', 'platform', null);
    begin
      insert into memberships (user_id, role, scope_type, scope_id)
      values (newcomer, 'platform_admin', 'platform', null);
      raise exception '0140: a second platform_admin row was allowed for one person';
    exception when unique_violation then null;
    end;

    -- 5. a platform_admin grant is platform-scoped whatever the caller sent
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    perform public.grant_role('t0140-admin@example.invalid', 'platform_admin', 'league', lg);
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);
    select count(*) into n from memberships
     where user_id = admin_u and role = 'platform_admin' and scope_type = 'league';
    if n <> 0 then raise exception '0140: a platform admin was scoped to a league'; end if;

    -- 6. the last administrator cannot be removed, counted by person
    delete from memberships where user_id = newcomer and role = 'platform_admin';
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
    begin
      perform public.revoke_role((select id from memberships
                                   where user_id = admin_u and role = 'platform_admin'));
      raise exception '0140: the only platform admin was revoked';
    exception when check_violation then null;
    end;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    raise exception using errcode = 'P0004', message = '0140 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
