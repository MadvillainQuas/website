-- ============================================================================
-- 0062 — PUBLISHING A CREST MUST NOT DELETE FROM storage.objects.
--
-- Reported as:
--
--     Crest uploaded, but publishing it was refused: Direct deletion from
--     storage tables is not allowed. Use the Storage API instead.
--
-- 0061 removed a club's previous crest by deleting the row from
-- storage.objects. Supabase now refuses that outright, from any role — the
-- storage service owns those rows and expects deletions to go through its own
-- API so the object in the backing store goes with them.
--
-- Probed rather than guessed, because the answer decides the design. Running as
-- the definer does:
--
--     INSERT into storage.objects        ok
--     UPDATE bucket_id  (the move)       ok
--     DELETE                             refused
--
-- So the move that publishes an image — the same one approve_media has made
-- since 0017 — is fine and stays. Only the tidying-up of the old file has to
-- leave SQL.
--
-- WHAT THIS DOES INSTEAD. The function deletes the previous crest's media ROW,
-- which is what actually governs what gets displayed, and hands back the
-- storage paths it has orphaned. The caller removes those through the Storage
-- API, where deletion belongs. That cleanup is best-effort by design: an
-- orphaned file is a few kilobytes nobody points at, and failing a publish
-- because a tidy-up failed would be getting the priorities backwards.
--
-- THE RETURN TYPE CHANGES, so the function is dropped first. `create or
-- replace` cannot change what a function returns, and the error when it tries
-- names the return type rather than the reason.
-- ============================================================================
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

  /* the previous crest's ROW goes; its file is handed back to be removed
     through the Storage API, because SQL may not do it */
  for old in select * from media
              where owner_type = 'team' and owner_id = m.owner_id
                and kind = 'logo' and id <> p_media loop
    orphans := array_append(orphans, old.storage_path);
    delete from media where id = old.id;
    n_old := n_old + 1;
  end loop;

  update storage.objects
     set bucket_id = 'media-public'
   where bucket_id = 'media-pending' and name = m.storage_path;

  update media
     set status = 'approved', approved_by = auth.uid()
   where id = p_media;

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

comment on function public.publish_team_logo(uuid) is
  'A club manager publishes their own crest without review. Club crests only. '
  'Returns {message, orphans[]} — the caller removes the orphaned files through '
  'the Storage API, which is the only thing allowed to delete them.';

-- ---------------------------------------------------------------- storage ---
-- Nothing could remove a file from media-public: 0017 gave that bucket a read
-- policy and no delete policy, so a superseded crest would have sat there for
-- ever with nothing able to reach it.
--
-- The rule is the one that was already being applied to uploads, used in the
-- other direction: whoever may PUBLISH an image for a subject may REMOVE one.
-- may_upload_media derives the subject from the path, so a club manager can
-- clear their own club's old crest and nobody else's — and removal is the safe
-- direction anyway, the safeguarding rule in 0017 being about publication.
drop policy if exists media_public_delete on storage.objects;
create policy media_public_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media-public' and public.may_upload_media(name));

-- ------------------------------------------------------------- assertions ---
do $$
declare r record; pa uuid; tm uuid; mid uuid; pmid uuid; out_j jsonb; refused boolean;
begin
  -- the narrowing from 0061 still holds after the rewrite
  select id into tm from teams limit 1;
  if tm is null then raise notice '0062: no teams to test against'; return; end if;

  insert into media (owner_type, owner_id, kind, storage_path, status)
  values ('player', gen_random_uuid(), 'photo', 'zz/probe-face.webp', 'pending')
  returning id into pmid;
  begin
    out_j := public.publish_team_logo(pmid);
    delete from media where id = pmid;
    raise exception 'ASSERT a player photograph was published as a crest';
  exception
    when sqlstate '42501' then null;                    -- refused, as it must be
    when others then
      delete from media where id = pmid;
      raise;
  end;
  delete from media where id = pmid;

  -- and the delete policy exists on the public bucket
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'media_public_delete') then
    raise exception 'ASSERT media_public_delete was not created';
  end if;

  raise notice '0062: publish_team_logo no longer deletes from storage; '
               'media-public has a delete policy';
end $$;
