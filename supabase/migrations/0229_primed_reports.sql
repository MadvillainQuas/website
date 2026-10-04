-- 0229: PRIMED REPORTS, STORED FOR SENDING (2026-10-04). PRIME REPORT (report.js, a platform administrator, on a club's or a
-- player's Report tab, or from the reports manager) no longer downloads the report: it draws it at email weight and keeps the
-- PDF here. The mailer (scripts/report_mailer.mjs) sends that file in place of drawing its own - as long as no game of its club
-- has been finalised since it was primed - and deletes it once the run has emailed it. One a report: a new PRIME replaces it.
--
--   primed_reports    kind ('team' | 'player'), ref_id (the club or the player), path (in the bucket), title, bytes, primed_at,
--                     primed_by. Platform administrators read and write it (the report page writes it, the reports manager
--                     reads it); the mailer with the service key.
--   bucket 'primed'   PRIVATE, PDFs only: platform administrators write, replace and delete; the mailer reads and deletes
--                     with the service key.

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('primed', 'primed', false, array['application/pdf'], 52428800)
on conflict (id) do update set public = false, allowed_mime_types = array['application/pdf'], file_size_limit = 52428800;

create table if not exists public.primed_reports (
  kind       text not null check (kind in ('team', 'player')),
  ref_id     uuid not null,
  path       text not null check (char_length(path) between 1 and 200),
  title      text check (title is null or char_length(title) <= 200),
  bytes      int check (bytes is null or bytes >= 0),
  primed_at  timestamptz not null default now(),
  primed_by  uuid default auth.uid() references auth.users on delete set null,
  primary key (kind, ref_id)
);
alter table public.primed_reports enable row level security;
drop policy if exists primed_reports_admin on public.primed_reports;
create policy primed_reports_admin on public.primed_reports
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on public.primed_reports to authenticated;
grant all on public.primed_reports to service_role;

/* the files: a platform administrator's alone (an upload that replaces one is a select, an insert and an update) */
drop policy if exists primed_admin_read on storage.objects;
create policy primed_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'primed' and public.is_platform_admin());
drop policy if exists primed_admin_write on storage.objects;
create policy primed_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'primed' and public.is_platform_admin());
drop policy if exists primed_admin_replace on storage.objects;
create policy primed_admin_replace on storage.objects for update to authenticated
  using (bucket_id = 'primed' and public.is_platform_admin()) with check (bucket_id = 'primed' and public.is_platform_admin());
drop policy if exists primed_admin_delete on storage.objects;
create policy primed_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'primed' and public.is_platform_admin());

notify pgrst, 'reload schema';
