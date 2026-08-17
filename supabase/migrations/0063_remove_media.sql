-- ============================================================================
-- 0063 — TAKING AN IMAGE DOWN.
--
-- Three places could put an image up — a player's photograph and a club's crest
-- in the portal, a league's logo in the admin console — and none of them could
-- take one down. A club could publish a crest instantly (0061) and then be
-- stuck with it; a player photograph could only be removed by anonymising the
-- whole player, which is a safeguarding action and not a way to change a
-- picture.
--
-- One function for all three, because "whose image is this" is the same
-- question in every case and answering it three times is how the three answers
-- drift apart.
--
-- WHO MAY REMOVE. The rule that governs uploading, applied in the same shape,
-- plus one addition:
--
--   team    the club's manager, OR an administrator of the league it plays in
--   player  a manager of a team the player is currently on
--   league  the league's administrator
--   and a platform administrator throughout
--
-- THE LEAGUE ADMIN IS THE ADDITION, and it matters now rather than in the
-- abstract: since 0061 a club publishes its crest without anybody reviewing it,
-- so the league whose name it appears under needs to be able to take one down.
-- Giving them that is what makes publishing-without-review reasonable.
--
-- REMOVAL IS THE SAFE DIRECTION. Publication is the step 0017 guards, because
-- that is what puts a face on the open internet. Taking an image down needs a
-- looser hand than putting one up, not a tighter one.
--
-- AND IT CANNOT DELETE THE FILE ITSELF, for the reason 0062 found the hard way:
-- Supabase refuses a direct delete from storage.objects from any role. So this
-- removes the rows and the pointers, and hands the paths back for the caller to
-- clear through the Storage API.
-- ============================================================================
create or replace function public.may_manage_media(p_owner_type text, p_owner_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_platform_admin() then return true; end if;

  if p_owner_type = 'team' then
    return public.is_team_manager(p_owner_id)
        or exists (select 1 from teams t
                    where t.id = p_owner_id and t.league_id is not null
                      and public.is_league_admin(t.league_id));

  elsif p_owner_type = 'player' then
    return exists (select 1 from roster_entries re
                    where re.player_id = p_owner_id and re.active
                      and (public.is_team_manager(re.team_id)
                           or exists (select 1 from teams t
                                       where t.id = re.team_id
                                         and t.league_id is not null
                                         and public.is_league_admin(t.league_id))));

  elsif p_owner_type = 'league' then
    return public.is_league_admin(p_owner_id);
  end if;
  return false;
end; $$;

create or replace function public.remove_media(
  p_owner_type text, p_owner_id uuid, p_kind text default null
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare m record; orphans text[] := '{}'; n int := 0;
begin
  if p_owner_type not in ('team','player','league') then
    raise exception 'unknown owner type' using errcode = '22023';
  end if;
  if not public.may_manage_media(p_owner_type, p_owner_id) then
    raise exception 'you may not change that image' using errcode = '42501';
  end if;

  for m in select * from media
            where owner_type = p_owner_type and owner_id = p_owner_id
              and (p_kind is null or kind = p_kind) loop
    orphans := array_append(orphans, m.storage_path);
    delete from media where id = m.id;
    n := n + 1;
  end loop;

  /* the pointers go with the rows, or a club keeps rendering a crest whose
     record has gone */
  if p_owner_type = 'team' and (p_kind is null or p_kind = 'logo') then
    update teams set logo_path = null where id = p_owner_id;
  elsif p_owner_type = 'player' and (p_kind is null or p_kind = 'photo') then
    update players set photo_media_id = null where id = p_owner_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'remove_media', p_owner_type, p_owner_id::text,
          jsonb_build_object('kind', p_kind, 'removed', n));

  return jsonb_build_object('removed', n, 'orphans', to_jsonb(orphans));
end; $$;

revoke all on function public.remove_media(text, uuid, text) from public, anon;
grant execute on function public.remove_media(text, uuid, text) to authenticated;
revoke all on function public.may_manage_media(text, uuid) from public, anon;
grant execute on function public.may_manage_media(text, uuid) to authenticated;

comment on function public.remove_media(text, uuid, text) is
  'Take a subject''s image(s) down. Returns {removed, orphans[]} — the caller '
  'clears the orphaned files through the Storage API, which is the only thing '
  'permitted to delete them.';

-- The pending bucket already let an owner delete their own uploads; the public
-- one gained that in 0062. Both are needed now that removal is a real action:
-- an image can be taken down before it is published or after.

-- ------------------------------------------------------------- assertions ---
do $$
declare tm uuid; mid uuid; out_j jsonb; refused boolean;
begin
  if public.may_manage_media('nonsense', gen_random_uuid()) then
    raise exception 'ASSERT an unknown owner type was accepted';
  end if;

  -- nobody is signed in in a migration, so every real call must be refused
  select id into tm from teams limit 1;
  if tm is not null then
    begin
      out_j := public.remove_media('team', tm, 'logo');
      refused := false;
    exception when insufficient_privilege then refused := true;
              when others then refused := true;
    end;
    if not refused then
      raise exception 'ASSERT remove_media ran for a caller who manages nothing';
    end if;
  end if;

  -- and a bad owner type is refused before the permission question
  begin
    out_j := public.remove_media('sandwich', gen_random_uuid(), null);
    refused := false;
  exception when others then refused := true;
  end;
  if not refused then raise exception 'ASSERT a bad owner type was accepted'; end if;

  raise notice '0063: remove_media refuses outsiders and unknown owner types';
end $$;
