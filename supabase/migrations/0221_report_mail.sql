-- 0221: REPORTS BY EMAIL (2026-10-02). A platform admin names an address and a club; the mailer
-- (scripts/report_mailer.mjs, .github/workflows/report-mail.yml, every half hour) then sends that
-- address, as soon as each of the club's games is final, the game analysis PDF from the club's side;
-- every other Sunday morning, at the address's own local time, the club's own report; and every
-- Sunday morning the report on each opponent the club plays in the coming week, all in one email.
-- report_mail_log keeps what went, so nothing is sent twice. Platform admins only: the mailer
-- reads and writes with the service key.

create table if not exists public.report_mail_subs (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name        text,                                   -- how the email greets them ("Hi Sam"); blank: "Hello"
  team_id     uuid not null references public.teams(id) on delete cascade,
  tz          text not null default 'UTC',            -- an IANA zone: the Sunday morning is theirs
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (email, team_id)
);

create table if not exists public.report_mail_log (
  id       bigserial primary key,
  sub_id   uuid not null references public.report_mail_subs(id) on delete cascade,
  kind     text not null check (kind in ('game', 'sunday', 'team', 'opp')),
  ref      text not null,                           -- the game id, or the Sunday's date
  sent_at  timestamptz not null default now(),
  detail   text,
  unique (sub_id, kind, ref)
);

alter table public.report_mail_subs enable row level security;
alter table public.report_mail_log  enable row level security;

drop policy if exists report_mail_subs_admin on public.report_mail_subs;
create policy report_mail_subs_admin on public.report_mail_subs
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists report_mail_log_admin on public.report_mail_log;
create policy report_mail_log_admin on public.report_mail_log
  for select using (public.is_platform_admin());

grant select, insert, update, delete on public.report_mail_subs to authenticated;
grant select on public.report_mail_log to authenticated;
