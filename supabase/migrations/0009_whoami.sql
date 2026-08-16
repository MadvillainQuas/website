-- ============================================================================
-- 0009 — whoami(), and a hard check that 0008 actually landed.
--
-- The portal has to know which controls to render before it can render them,
-- and a client cannot read memberships for other users. whoami() returns the
-- caller's own roles, resolved through the same helpers RLS uses, so the UI and
-- the database can never disagree about what someone is allowed to do.
--
-- The assertion at the end is deliberate. 0008 degrades to a NOTICE when the
-- account has never signed in, and the CLI does not print notices — so a silent
-- no-op would look identical to success. This turns that case into a failed
-- migration with an instruction. Sign in once, re-run `supabase db push`, and
-- it applies.
-- ============================================================================

create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email',   (select u.email::text from auth.users u where u.id = auth.uid()),
    'is_platform_admin', public.is_platform_admin(),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name)
                        order by l.name)
      from memberships m join leagues l on l.id = m.scope_id
      where m.user_id = auth.uid() and m.role = 'league_admin' and m.scope_type = 'league'
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name)
                        order by t.name)
      from memberships m join teams t on t.id = m.scope_id
      where m.user_id = auth.uid() and m.role = 'team_manager' and m.scope_type = 'team'
    ), '[]'::jsonb),
    -- games this user is assigned to score that have not finished
    'scoring', coalesce((
      select jsonb_agg(jsonb_build_object('game_id', g.id, 'status', g.status)
                        order by g.tipoff_at)
      from game_officials go join games g on g.id = go.game_id
      where go.user_id = auth.uid() and g.status in ('scheduled','live')
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;

-- ---------------------------------------------------------------------------
do $$
declare
  target text := 'britishbasketballscout@gmail.com';
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(target) limit 1;

  if uid is null then
    raise exception E'\n\n  % has never signed in, so there is no account to make an admin.\n  Open /league/app/, sign in with that address once, then re-run:\n      npx supabase db push\n', target
      using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.memberships
                 where user_id = uid and role = 'platform_admin') then
    raise exception 'found % but the platform_admin grant is missing — 0008 did not apply', target
      using errcode = 'P0002';
  end if;

  raise notice 'confirmed: % is a platform admin', target;
end $$;
