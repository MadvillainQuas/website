-- 0111  A bucket for the reels.
--
-- media-public admits images only (its allowed MIME types), so a rendered MP4 had nowhere to
-- land. The reels get their own public bucket, video only, half a gigabyte a file; the worker
-- writes with the service role, the world reads. The edit suite's source check follows.

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('highlights', 'highlights', true, array['video/mp4'], 524288000)
on conflict (id) do update set public = true, allowed_mime_types = array['video/mp4'], file_size_limit = 524288000;

drop policy if exists highlights_public_read on storage.objects;
create policy highlights_public_read on storage.objects for select using (bucket_id = 'highlights');

drop policy if exists highlight_jobs_ask on public.highlight_jobs;
create policy highlight_jobs_ask on public.highlight_jobs for insert
  with check (
    requested_by = auth.uid()
    and jsonb_typeof(clips) = 'array'
    and ((jsonb_array_length(clips) between 1 and 80 and source_path is null)
         or (source_path is not null and edits is not null))
  );
