-- ============================================================================
-- 0123 — AN APPROVED IMAGE CAN LEAVE THE PRIVATE BUCKET.
--
-- Reported 2026-09-17 approving a league logo from the platform console:
--
--     Could not publish the file: new row violates row-level security policy
--
-- Approving an image moves its file from media-pending to media-public through
-- the Storage API (0064), and the Storage API's move is an UPDATE of the
-- object's row: bucket_id changes from media-pending to media-public. Supabase
-- requires SELECT and UPDATE on the object for a move. The only UPDATE policy
-- on these buckets is 0017's media_pending_replace, whose WITH CHECK pins the
-- row to media-pending, so the new row was refused every time. 0064 and 0065
-- added policies for INSERTING into media-public, which a move never does.
--
-- This refused every approval from a queue since approvals started moving
-- files, player photographs included. Club crests stopped using the queue
-- (0065 writes them straight into the public bucket), which is why it went
-- unseen until a league logo went through the queue.
--
-- Two policies:
--
--   media_publish_move    UPDATE from media-pending to media-public, for
--                         somebody who could approve the image
--                         (may_approve_media: a platform admin, or the league's
--                         admin for anything under that league).
--   media_pending_read    the approver may also READ the pending object. A move
--                         reads before it updates, and a league admin
--                         approving a player photograph is not the one who
--                         uploaded it (may_upload_media is the club's manager).
--
-- The consoles also copy the bytes when a move is refused
-- (epinoia/upload.js publishPending), so approvals work on a database without
-- this migration.
-- ============================================================================

drop policy if exists media_publish_move on storage.objects;
create policy media_publish_move on storage.objects for update to authenticated
  using (bucket_id = 'media-pending' and public.may_approve_media(name))
  with check (bucket_id = 'media-public' and public.may_approve_media(name));

drop policy if exists media_pending_read on storage.objects;
create policy media_pending_read on storage.objects for select to authenticated
  using (bucket_id = 'media-pending'
         and (public.may_upload_media(name) or public.may_approve_media(name)
              or public.is_platform_admin()));

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'media_publish_move' and cmd = 'UPDATE') then
    raise exception 'ASSERT media_publish_move missing — an approval could not move its file';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'media_pending_read' and qual ilike '%may_approve_media%') then
    raise exception 'ASSERT media_pending_read does not let an approver read what they approve';
  end if;
end $$;
