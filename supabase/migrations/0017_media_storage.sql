-- ============================================================================
-- 0017 — image storage, with moderation and consent.
--
-- The plan's hard rule from loop 1: uploads never touch the repo. Pages is at
-- 652 MB against a ~1 GB soft ceiling, and a site must not grow because a club
-- added a team photo. Everything goes to Storage, which is CDN-backed.
--
-- TWO BUCKETS, AND APPROVAL MOVES THE OBJECT.
--   media-pending  private. A manager can write here and read their own.
--   media-public   world-readable. Nothing arrives except by approval.
-- A single bucket with a status column would leave unapproved images reachable
-- by anyone who guessed the path — the status would gate the row, not the file.
-- Moving the object is what makes "not approved" mean "not on the internet".
--
-- The consent rule from 0016 follows the image rather than the column: a
-- photograph of an under-18 player cannot be approved without recorded
-- guardian consent, whichever route it took.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-pending', 'media-pending', false, 2097152,
   array['image/webp','image/jpeg','image/png']),
  ('media-public',  'media-public',  true,  2097152,
   array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2 MB is deliberately tight. The client resizes to WebP before upload — a 4 MB
-- phone photo becomes ~60 KB — so anything approaching the limit means the
-- resize was skipped, and the limit is what makes that a failed upload rather
-- than a slow page for every future visitor.

-- ---------------------------------------------------------------- helpers ---
-- Paths are <owner_type>/<owner_id>/<filename>, so a policy can decide from
-- the path alone who is allowed to write there.
create or replace function public.media_path_owner(p_path text)
returns table (owner_type text, owner_id uuid)
language sql immutable as $$
  select split_part(p_path, '/', 1),
         nullif(split_part(p_path, '/', 2), '')::uuid;
$$;

create or replace function public.may_upload_media(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  t text; oid uuid;
begin
  select owner_type, owner_id into t, oid from public.media_path_owner(p_path);
  if oid is null then return false; end if;

  if t = 'team' then
    return public.is_team_manager(oid);
  elsif t = 'player' then
    -- whoever manages a team this player is currently on
    return exists (
      select 1 from roster_entries re
      where re.player_id = oid and re.active
        and public.is_team_manager(re.team_id));
  elsif t = 'league' then
    return public.is_league_admin(oid);
  end if;
  return false;
end; $$;

-- ------------------------------------------------------------- policies -----
-- storage.objects already has RLS enabled by Supabase.

drop policy if exists media_pending_write on storage.objects;
create policy media_pending_write on storage.objects for insert to authenticated
  with check (bucket_id = 'media-pending' and public.may_upload_media(name));

drop policy if exists media_pending_read on storage.objects;
create policy media_pending_read on storage.objects for select to authenticated
  using (bucket_id = 'media-pending'
         and (public.may_upload_media(name) or public.is_platform_admin()));

drop policy if exists media_pending_replace on storage.objects;
create policy media_pending_replace on storage.objects for update to authenticated
  using (bucket_id = 'media-pending' and public.may_upload_media(name))
  with check (bucket_id = 'media-pending' and public.may_upload_media(name));

drop policy if exists media_pending_delete on storage.objects;
create policy media_pending_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media-pending' and public.may_upload_media(name));

-- The public bucket is readable by everyone and writable by nobody through the
-- API. Objects arrive there only via approve_media() below, which runs as
-- definer — so "approved" is the only path onto the public internet.
drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects for select to public
  using (bucket_id = 'media-public');

-- ------------------------------------------------------------- moderation ---
create or replace function public.approve_media(p_media uuid)
returns text language plpgsql security definer set search_path = public, storage as $$
declare
  m record;
  league_of uuid;
  pl record;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such media' using errcode = 'P0002'; end if;

  -- who may approve: the league that owns the subject, or a platform admin
  if m.owner_type = 'team' then
    select league_id into league_of from teams where id = m.owner_id;
  elsif m.owner_type = 'league' then
    league_of := m.owner_id;
  elsif m.owner_type = 'player' then
    select t.league_id into league_of
      from roster_entries re join teams t on t.id = re.team_id
     where re.player_id = m.owner_id and re.active limit 1;
  end if;

  if not (public.is_platform_admin()
          or (league_of is not null and public.is_league_admin(league_of))) then
    raise exception 'only the league may approve its images' using errcode = '42501';
  end if;

  -- The safeguarding rule, enforced at the moment of publication rather than
  -- at upload: this is the step that puts an image on the open internet.
  if m.owner_type = 'player' then
    select * into pl from players where id = m.owner_id;
    if pl.is_minor and not pl.photo_consent then
      raise exception
        'this player is under 18 and has no recorded guardian consent'
        using errcode = '23514';
    end if;
  end if;

  -- move the object: copy into the public bucket, then drop the pending one
  update storage.objects
     set bucket_id = 'media-public'
   where bucket_id = 'media-pending' and name = m.storage_path;

  update media
     set status = 'approved', approved_by = auth.uid()
   where id = p_media;

  -- point the subject at it
  if m.owner_type = 'player' then
    update players set photo_media_id = p_media where id = m.owner_id;
  elsif m.owner_type = 'team' then
    update teams set logo_path = m.storage_path where id = m.owner_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'approve_media', m.owner_type, m.owner_id::text,
          jsonb_build_object('media', p_media, 'path', m.storage_path));

  return 'approved';
end; $$;

create or replace function public.reject_media(p_media uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public, storage as $$
declare m record; league_of uuid;
begin
  select * into m from media where id = p_media;
  if not found then return 'already gone'; end if;

  if m.owner_type = 'team' then
    select league_id into league_of from teams where id = m.owner_id;
  elsif m.owner_type = 'league' then league_of := m.owner_id;
  elsif m.owner_type = 'player' then
    select t.league_id into league_of from roster_entries re
      join teams t on t.id = re.team_id
     where re.player_id = m.owner_id and re.active limit 1;
  end if;

  if not (public.is_platform_admin()
          or (league_of is not null and public.is_league_admin(league_of))) then
    raise exception 'only the league may reject its images' using errcode = '42501';
  end if;

  delete from storage.objects
   where bucket_id in ('media-pending','media-public') and name = m.storage_path;
  update media set status = 'rejected', approved_by = auth.uid() where id = p_media;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'reject_media', m.owner_type, m.owner_id::text,
          jsonb_build_object('media', p_media, 'reason', p_reason));
  return 'rejected';
end; $$;

-- everything a league still has to look at
create or replace function public.media_queue(p_league uuid)
returns table (id uuid, owner_type text, owner_id uuid, subject text,
               storage_path text, uploaded_by uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.owner_type::text, m.owner_id,
         case m.owner_type
           when 'team'   then (select t.name from teams t where t.id = m.owner_id)
           when 'league' then (select l.name from leagues l where l.id = m.owner_id)
           when 'player' then (select trim(p.first_name || ' ' || p.last_name)
                                 from players p where p.id = m.owner_id)
         end,
         m.storage_path, m.uploaded_by, m.created_at
  from media m
  where m.status = 'pending'
    and public.is_league_admin(p_league)
    and (
      (m.owner_type = 'league' and m.owner_id = p_league)
      or (m.owner_type = 'team' and m.owner_id in
            (select id from teams where league_id = p_league))
      or (m.owner_type = 'player' and m.owner_id in
            (select re.player_id from roster_entries re
               join teams t on t.id = re.team_id
              where t.league_id = p_league and re.active))
    )
  order by m.created_at;
$$;

revoke all on function public.approve_media(uuid)        from public, anon;
revoke all on function public.reject_media(uuid,text)    from public, anon;
revoke all on function public.media_queue(uuid)          from public, anon;
grant execute on function public.approve_media(uuid)     to authenticated;
grant execute on function public.reject_media(uuid,text) to authenticated;
grant execute on function public.media_queue(uuid)       to authenticated;
