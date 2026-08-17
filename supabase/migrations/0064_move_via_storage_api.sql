-- ============================================================================
-- 0064 — PUBLISHING MOVES THE FILE, NOT JUST THE ROW.
--
-- Reported as crests uploading successfully and then showing nowhere. The rows
-- were right — status 'approved', teams.logo_path set — and the file was
-- unreachable:
--
--     GET .../object/public/media-public/team/<id>/logo-….webp
--     {"statusCode":"404","error":"Not found","code":"NoSuchKey"}
--
-- Because `update storage.objects set bucket_id = 'media-public'` moves the
-- DATABASE ROW and nothing else. The storage service keys the actual object by
-- bucket, so the file stayed physically where it was uploaded, under the
-- pending bucket, while its row claimed to be public. Probed: the rows were in
-- media-public and the bytes were not.
--
-- THIS HAS ALWAYS BEEN WRONG, and not only for crests. approve_media has made
-- that same update since 0017, so approving a player photograph never published
-- one either. It went unnoticed because uploads themselves were refused until
-- yesterday — the media table had nought rows, so nothing had ever reached the
-- step that was broken. One bug was hiding the other.
--
-- THE FIX IS TO STOP MOVING FILES FROM SQL. Only the Storage API can move an
-- object, because only it can move the bytes. So both functions now leave the
-- file alone and the CALLER moves it first, through the API, and only calls the
-- function if that succeeded. If the move fails nothing is marked published,
-- which is the important half: a row that says published while the file 404s is
-- exactly the state being fixed.
--
-- That needs one new storage permission — writing into media-public — which
-- until now no policy allowed at all, because nothing was ever supposed to
-- write there directly.
-- ============================================================================

/* The same question may_manage_media answers, asked with a path instead of a
   subject, because storage policies only ever see a name. */
create or replace function public.may_publish_media(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text; oid uuid;
begin
  select owner_type, owner_id into t, oid from public.media_path_owner(p_path);
  if oid is null then return false; end if;
  return public.may_manage_media(t, oid);
end; $$;

grant execute on function public.may_publish_media(text) to authenticated;

-- Writing into the public bucket. Nothing could, so a move into it failed on
-- the insert half and left the file where it started.
drop policy if exists media_public_write on storage.objects;
create policy media_public_write on storage.objects for insert to authenticated
  with check (bucket_id = 'media-public' and public.may_publish_media(name));

-- Reading it back while signed in — the move copies, and a copy reads the
-- source. The bucket is public to anonymous readers already.
drop policy if exists media_public_read_auth on storage.objects;
create policy media_public_read_auth on storage.objects for select to authenticated
  using (bucket_id = 'media-public');

-- 0062 gave media-public a delete policy keyed to may_upload_media, which does
-- not include a league administrator. Removal should follow the same rule as
-- publication, so it is restated in terms of may_publish_media.
drop policy if exists media_public_delete on storage.objects;
create policy media_public_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media-public' and public.may_publish_media(name));

-- ------------------------------------------------------- the two functions ---
drop function if exists public.publish_team_logo(uuid);

create function public.publish_team_logo(p_media uuid)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare m record; old record; orphans text[] := '{}'; n_old int := 0;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such image' using errcode = 'P0002'; end if;

  if m.owner_type <> 'team' or m.kind <> 'logo' then
    raise exception 'this publishes club crests only — everything else goes '
                    'through the league''s approval queue'
      using errcode = '42501';
  end if;
  if not public.is_team_manager(m.owner_id) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;
  if m.status = 'approved' then
    return jsonb_build_object('message', 'already published', 'orphans', '[]'::jsonb);
  end if;

  for old in select * from media
              where owner_type = 'team' and owner_id = m.owner_id
                and kind = 'logo' and id <> p_media loop
    orphans := array_append(orphans, old.storage_path);
    delete from media where id = old.id;
    n_old := n_old + 1;
  end loop;

  /* THE FILE IS NOT TOUCHED HERE. The caller has already moved it through the
     Storage API and only reaches this line because that worked. */
  update media set status = 'approved', approved_by = auth.uid() where id = p_media;
  update teams set logo_path = m.storage_path where id = m.owner_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'publish_team_logo', 'team', m.owner_id::text,
          jsonb_build_object('media', p_media, 'path', m.storage_path,
                             'replaced', n_old, 'reviewed', false));

  return jsonb_build_object(
    'message', case when n_old > 0 then 'published, replacing the previous crest'
                    else 'published' end,
    'orphans', to_jsonb(orphans));
end; $$;

revoke all on function public.publish_team_logo(uuid) from public, anon;
grant execute on function public.publish_team_logo(uuid) to authenticated;

/* approve_media, with the same line taken out and everything else — including
   the under-18 consent check, which is the whole point of the queue — kept
   exactly as it was. */
create or replace function public.approve_media(p_media uuid)
returns text language plpgsql security definer set search_path = public, storage as $$
declare m record; league_of uuid; pl record;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such media' using errcode = 'P0002'; end if;

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

  if m.owner_type = 'player' then
    select * into pl from players where id = m.owner_id;
    if pl.is_minor and not pl.photo_consent then
      raise exception
        'this player is under 18 and has no recorded guardian consent'
        using errcode = '23514';
    end if;
  end if;

  -- the file has already been moved by the caller, through the Storage API
  update media set status = 'approved', approved_by = auth.uid() where id = p_media;

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

-- ------------------------------------------------------------------ repair ---
-- The crests already uploaded are in the broken state this migration is about:
-- their storage rows say media-public and their bytes are in media-pending. Put
-- the rows back where the files actually are and mark the media pending, so the
-- portal can publish them properly rather than leaving two crests that look
-- live and are not.
update storage.objects
   set bucket_id = 'media-pending'
 where bucket_id = 'media-public'
   and name in (select storage_path from public.media
                 where status = 'approved' and kind = 'logo');

update public.media set status = 'pending', approved_by = null
 where status = 'approved' and kind = 'logo';

update public.teams set logo_path = null
 where logo_path is not null;

-- ------------------------------------------------------------- assertions ---
do $$
declare n int;
begin
  foreach n in array array[1] loop null; end loop;   -- keep the block simple

  if not exists (select 1 from pg_policies where schemaname='storage'
                   and tablename='objects' and policyname='media_public_write') then
    raise exception 'ASSERT media_public_write missing — a move into the bucket would fail';
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage'
                   and tablename='objects' and policyname='media_public_delete') then
    raise exception 'ASSERT media_public_delete missing';
  end if;

  -- no function may still be moving files in SQL
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public'
                and p.proname in ('approve_media','publish_team_logo')
                and pg_get_functiondef(p.oid) like '%set bucket_id%') then
    raise exception 'ASSERT a function still moves storage.objects in SQL';
  end if;

  select count(*) into n from public.media where status = 'approved' and kind = 'logo';
  if n <> 0 then raise exception 'ASSERT the broken crests were not reset (% left)', n; end if;

  raise notice '0064: files move through the Storage API; the stranded crests are reset';
end $$;
