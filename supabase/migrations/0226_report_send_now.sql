-- 0226: SEND NEXT WEEK'S REPORTS NOW (2026-10-03). Every Sunday morning the report mailer (0221, scripts/report_mailer.mjs)
-- emails an address the reports on the clubs its club plays in the week ahead. This lets a platform administrator ask for
-- that email at once instead, for one address or for every active one, from the console's Reports by email.
--
--   report_mail_requests   one row a request: which address, where it stands (queued, running, then sent, nothing to
--                          send, or failed), and a line saying what went or why not. The mailer takes the queued
--                          rows at the start of its next run (every half hour; the console-kick function starts that
--                          run the moment the button is pressed, 0217's way), and the console follows each one.
--   request_report_send    queues a request for one address, or for every active address when none is named. An
--                          address with a request already open is left alone, so pressing twice sends once.
--
-- THE WEEK is the Monday-to-Sunday that begins next Monday at the address's own time, and the email counts as that
-- Sunday's: the mailer logs it as the Sunday before the week (report_mail_log kind 'sunday'), so Sunday morning's own
-- run sees it and does not send it again. The rest (which opponents, the club's own report every other Sunday) is
-- the mailer's, exactly as on a Sunday.
--
-- A request not done in three hours is given up (failed: "Not done within three hours"), here when the next one is
-- asked for and by the mailer when it starts, so a worker that never ran cannot hold an address shut for good.

create table if not exists public.report_mail_requests (
  id             uuid primary key default gen_random_uuid(),
  sub_id         uuid not null references public.report_mail_subs(id) on delete cascade,
  state          text not null default 'queued' check (state in ('queued', 'running', 'sent', 'nothing', 'failed')),
  requested_by   uuid default auth.uid(),
  requested_at   timestamptz not null default now(),
  dispatched_at  timestamptz,                       -- the worker was started for it (console-kick, 0217's pattern)
  started_at     timestamptz,
  finished_at    timestamptz,
  detail         text check (detail is null or char_length(detail) <= 400)
);
-- one open request an address: a second press while one is on its way asks for nothing more
create unique index if not exists report_mail_requests_open on public.report_mail_requests (sub_id) where state in ('queued', 'running');
create index if not exists report_mail_requests_sub on public.report_mail_requests (sub_id, requested_at desc);

alter table public.report_mail_requests enable row level security;
drop policy if exists report_mail_requests_admin on public.report_mail_requests;
create policy report_mail_requests_admin on public.report_mail_requests for select using (public.is_platform_admin());
grant select on public.report_mail_requests to authenticated;
grant all on public.report_mail_requests to service_role;

/* ask for the week-ahead email now: one address, or every active one. Answers how many were queued (an address already
   on its way, or paused, is not). Platform administrators only. */
create or replace function public.request_report_send(p_sub uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  update public.report_mail_requests
     set state = 'failed', finished_at = now(), detail = 'Not done within three hours: send it again.'
   where state in ('queued', 'running') and requested_at < now() - interval '3 hours';
  insert into public.report_mail_requests (sub_id)
    select s.id from public.report_mail_subs s where s.active and (p_sub is null or s.id = p_sub)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.request_report_send(uuid) from public;
grant execute on function public.request_report_send(uuid) to authenticated;
