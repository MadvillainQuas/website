-- ============================================================================
-- 0272  WEEKLY PLAYER REPORTS BY EMAIL
--
-- Louie, 2026-10-16: "a 'player email report' service similar to the one for coaches and teams, that allow me to insert a
-- player's email, and they then get a weekly player report sent to them updated". Answered the same day: it goes on Monday
-- morning (8 am at the address's time), the week just played, Monday to Sunday; a week the player played no game goes
-- unsent.
--
--   report_mail_players       an address and a player: the time zone its Monday morning is, paused or not, and "send now"
--                             (send_now_at, set by the console: the week of the player's latest game goes at the next run).
--                             last_at / last_detail: what the mailer last did for it, for the console to show.
--   report_mail_player_log    one row a week sent (sub, the week's Monday), so a rerun or a catch-up never sends it twice.
--
-- Platform administrators only, as the clubs' addresses are (0221): an address is somebody's, and the reports are the
-- platform's to send. The mailer (scripts/report_mailer.mjs, the service key) reads them and writes the log.
-- ============================================================================

create table if not exists public.report_mail_players (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name         text,                                   -- how the email greets them ("Hi Sam"); blank: "Hello"
  player_id    uuid not null references public.players(id) on delete cascade,
  tz           text not null default 'UTC',            -- an IANA zone: the Monday morning is theirs
  active       boolean not null default true,
  send_now_at  timestamptz,                            -- asked for at once; the mailer clears it when it has run it
  last_at      timestamptz,
  last_detail  text check (last_detail is null or length(last_detail) <= 400),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (email, player_id)
);

create table if not exists public.report_mail_player_log (
  id       bigserial primary key,
  sub_id   uuid not null references public.report_mail_players(id) on delete cascade,
  week     date not null,                              -- the Monday of the week the report covers
  sent_at  timestamptz not null default now(),
  detail   text,
  unique (sub_id, week)
);

alter table public.report_mail_players    enable row level security;
alter table public.report_mail_player_log enable row level security;

drop policy if exists report_mail_players_admin on public.report_mail_players;
create policy report_mail_players_admin on public.report_mail_players
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists report_mail_player_log_admin on public.report_mail_player_log;
create policy report_mail_player_log_admin on public.report_mail_player_log
  for select using (public.is_platform_admin());

grant select, insert, update, delete on public.report_mail_players to authenticated;
grant select on public.report_mail_player_log to authenticated;
grant all on public.report_mail_players, public.report_mail_player_log to service_role;
grant usage, select on sequence public.report_mail_player_log_id_seq to service_role;
