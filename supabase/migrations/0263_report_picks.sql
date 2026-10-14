-- 0263: TICK WHAT GOES (Louie 2026-10-14). The reports by email (0221, 0226, 0228, scripts/report_mailer.mjs) sent every kind to
-- every address. Now the console's Reports by email ticks what goes, three ways:
--
--   report_mail_subs.send_games / send_opponents / send_own
--                          the address's standing kinds: the game analysis after each game, the scouting reports on the week's
--                          opponents, the club's own fortnightly report (with 0228's player_zip, the players' ZIP). All on, as before.
--   report_mail_picks      the ticks of one week's email (the Sunday it counts as): an opponent left out (skip_opps), the own
--                          report forced (true) or held back (false), the players' ZIP on or off; null = as the address has it.
--   report_mail_requests.pick
--                          "send now"'s own ticks: { "opps": [team ids] | null, "own": true | false | null, "players": true | false | null }.
--                          opps null = every opponent the address takes; for every address at once only own and players are ticked.
--
-- The mailer reads each as it can: before this is applied every kind goes, as before.

alter table public.report_mail_subs add column if not exists send_games     boolean not null default true;
alter table public.report_mail_subs add column if not exists send_opponents boolean not null default true;
alter table public.report_mail_subs add column if not exists send_own       boolean not null default true;

create table if not exists public.report_mail_picks (
  sub_id     uuid not null references public.report_mail_subs(id) on delete cascade,
  sunday     date not null,                         -- the Sunday the email counts as (the day before its week)
  skip_opps  uuid[] not null default '{}',
  own        boolean,
  players    boolean,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (sub_id, sunday)
);
alter table public.report_mail_picks enable row level security;
drop policy if exists report_mail_picks_admin on public.report_mail_picks;
create policy report_mail_picks_admin on public.report_mail_picks for all using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on public.report_mail_picks to authenticated;
grant all on public.report_mail_picks to service_role;

alter table public.report_mail_requests add column if not exists pick jsonb
  check (pick is null or (jsonb_typeof(pick) = 'object' and pg_column_size(pick) < 8000));

/* ask for the week-ahead email now, with its ticks: one address, or every active one. As 0226, and the pick goes with each request. */
drop function if exists public.request_report_send(uuid);
create or replace function public.request_report_send(p_sub uuid default null, p_pick jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_pick is not null and jsonb_typeof(p_pick) <> 'object' then
    raise exception 'pick must be an object' using errcode = '22023';
  end if;
  update public.report_mail_requests
     set state = 'failed', finished_at = now(), detail = 'Not done within three hours: send it again.'
   where state in ('queued', 'running') and requested_at < now() - interval '3 hours';
  insert into public.report_mail_requests (sub_id, pick)
    select s.id, p_pick from public.report_mail_subs s where s.active and (p_sub is null or s.id = p_sub)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.request_report_send(uuid, jsonb) from public;
grant execute on function public.request_report_send(uuid, jsonb) to authenticated;
