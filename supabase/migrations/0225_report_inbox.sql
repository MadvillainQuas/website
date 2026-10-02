-- 0225: REPORTS IN THE DASHBOARD (2026-10-02). Every report the mailer (0221, scripts/report_mailer.mjs) sends is also
-- kept, so the account it was sent to can open it or download it again from its PROFILE dashboard: what kind of report
-- it is, the day it was made, and whether it has been opened yet (NEW until it has).
--
--   bucket 'reports'   PRIVATE. The mailer writes with the service key; an account reads a file only through a
--                      signed URL, which storage gives only for a file of its own (the policy below).
--   report_files       one row a report: the address it was made for (report_mail_subs), its kind (game analysis,
--                      scouting report on an opponent, the club's own report), a title and a line, the stored file,
--                      when it was made, when it was first opened.
--   report_mail_subs.user_id   AN ACCOUNT HOOKED UP to an address. Empty, the reports belong to whichever account signs
--                      in with that address (a confirmed email, any case); set, to that account alone, whatever its
--                      address. A platform administrator sets it in the console.
--
--   my_reports()       the caller's: whether any address is theirs, its clubs, and the files, newest first
--   report_seen(ids)   marks the caller's own as opened

alter table public.report_mail_subs add column if not exists user_id uuid references auth.users on delete set null;

create table if not exists public.report_files (
  id        uuid primary key default gen_random_uuid(),
  sub_id    uuid not null references public.report_mail_subs(id) on delete cascade,
  kind      text not null check (kind in ('game', 'opp', 'team')),
  ref       text not null check (char_length(ref) between 1 and 120),   -- the game, or the Sunday and the club
  title     text not null check (char_length(title) between 1 and 200),
  subtitle  text check (subtitle is null or char_length(subtitle) <= 300),
  path      text not null unique check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]{1,200}\.pdf$'),
  bytes     int check (bytes is null or bytes >= 0),
  made_at   timestamptz not null default now(),
  seen_at   timestamptz,
  unique (sub_id, kind, ref)
);
create index if not exists report_files_sub_made on public.report_files (sub_id, made_at desc);

alter table public.report_files enable row level security;
drop policy if exists report_files_admin on public.report_files;
create policy report_files_admin on public.report_files for select using (public.is_platform_admin());
grant select on public.report_files to authenticated;
grant all on public.report_files to service_role;

/* is this address the caller's: the account hooked up to it, or, with none, the account signed in with it */
create or replace function public.report_sub_mine(p_sub uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.report_mail_subs s
     where s.id = p_sub
       and (s.user_id = auth.uid()
            or (s.user_id is null and lower(s.email) = (
                  select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null))));
$$;
revoke all on function public.report_sub_mine(uuid) from public;
grant execute on function public.report_sub_mine(uuid) to authenticated, service_role;

/* is this stored file the caller's (the storage policy asks it: report_files itself is not readable by fans) */
create or replace function public.report_path_mine(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.report_files f where f.path = p_path and public.report_sub_mine(f.sub_id));
$$;
revoke all on function public.report_path_mine(text) from public;
grant execute on function public.report_path_mine(text) to authenticated;

/* the dashboard's one read */
create or replace function public.my_reports(p_limit int default 120)
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select s.id, s.team_id, s.active from public.report_mail_subs s where public.report_sub_mine(s.id)
  )
  select jsonb_build_object(
    'linked', exists (select 1 from mine),
    'clubs', coalesce((select jsonb_agg(distinct jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'colour', t.colour,
                                                                     'logo_path', t.logo_path, 'active', m.active))
                         from mine m join public.teams t on t.id = m.team_id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(x order by x.made_at desc) from (
                         select f.id, f.kind, f.title, f.subtitle, f.path, f.bytes, f.made_at, f.seen_at, t.name as club
                           from public.report_files f join mine m on m.id = f.sub_id
                           left join public.teams t on t.id = m.team_id
                          order by f.made_at desc
                          limit greatest(1, least(coalesce(p_limit, 120), 500))) x), '[]'::jsonb));
$$;
revoke all on function public.my_reports(int) from public;
grant execute on function public.my_reports(int) to authenticated;

/* opened: the first time only, the caller's own only; answers how many it marked */
create or replace function public.report_seen(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update public.report_files f set seen_at = now()
   where f.id = any (coalesce(p_ids, '{}'::uuid[])) and f.seen_at is null and public.report_sub_mine(f.sub_id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.report_seen(uuid[]) from public;
grant execute on function public.report_seen(uuid[]) to authenticated;

/* the files: private, PDFs only, 50 MB at most; read by their own account (a signed URL) and by platform administrators */
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('reports', 'reports', false, array['application/pdf'], 52428800)
on conflict (id) do update set public = false, allowed_mime_types = array['application/pdf'], file_size_limit = 52428800;

drop policy if exists reports_read_own on storage.objects;
create policy reports_read_own on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (public.is_platform_admin() or public.report_path_mine(name)));

notify pgrst, 'reload schema';
