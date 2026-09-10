-- 0110  The edit suite.
--
-- A finished reel opens in /epinoia/edit/, where the person who asked for it can trim it, crop
-- it and lay text over it. Export sends the same table a second kind of job: no clips, but a
-- source (the reel already rendered) and the edits to apply. The worker renders it with ffmpeg
-- and the result opens in the suite again, so edits can be stacked.

alter table public.highlight_jobs
  add column if not exists parent_id   uuid references public.highlight_jobs(id) on delete set null,
  add column if not exists source_path text,           -- media-public path of the reel being edited
  add column if not exists edits       jsonb;           -- {trim:{start,end}, crop:{x,y,w,h}, texts:[…]}

drop policy if exists highlight_jobs_ask on public.highlight_jobs;
create policy highlight_jobs_ask on public.highlight_jobs for insert
  with check (
    requested_by = auth.uid()
    and jsonb_typeof(clips) = 'array'
    and ((jsonb_array_length(clips) between 1 and 80 and source_path is null)
         or (source_path is not null and edits is not null and source_path like 'highlights/%'))
  );
