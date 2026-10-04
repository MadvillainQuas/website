-- 0231: PREVIEWS FOR A SIGNED-OUT READER (2026-10-04). What needs an account (access.js signinFirst: a club's lineups and
-- shot zones, a league's statistics views past MISC / TOTALS, the club and player reports, the CSV...) can be PREVIEWED
-- without one: ten things a week, so a curious reader can see what an account opens before making one.
--
-- REPORTS ARE COUNTED ON THEIR OWN: one player report and one club report a week, each apart from the ten and from
-- each other ('preview_report_limit', 1). The game's report is open to every reader for the time being, so nothing
-- asks for one; it is counted apart here too, for the day it is not.
--
-- One preview opens one locked feature on one page (the page names it: '/epinoia/t/#<club>'), in that browser tab, for
-- thirty minutes (access.js). Opening the same thing again that week costs nothing. The ten are counted HERE, so
-- clearing the browser does not give ten more: against a one-way code made from the reader's network (request_ip,
-- 0230: the IPv4 address or the IPv6 /64), hashed with a secret salt. The address itself is never kept, and a use is
-- forgotten after a week.
--
--   preview_take(feature, subject)   use one (or none, when this network already opened it this week)
--                                    -> { ok, left, limit, again?, next_at? } (a report's: its own kind's)
--   preview_left()                   -> { left, limit, next_at, reports: { playerReport, clubReport, gameReport } }
--   platform_settings 'preview_limit'          how many previews a week (10)
--   platform_settings 'preview_report_limit'   how many reports of each kind a week (1)
--
-- A signed-in reader never needs one (ok, signed_in). A request with no address to count against is let through.

create table if not exists public.preview_salt (
  id   int primary key default 1 check (id = 1),
  salt text not null
);
insert into public.preview_salt (id, salt) values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;
alter table public.preview_salt enable row level security;
revoke all on public.preview_salt from anon, authenticated;

create table if not exists public.preview_uses (
  net_hash text not null,
  feature  text not null check (char_length(feature) between 1 and 40),
  subject  text not null check (char_length(subject) between 1 and 200),
  used_at  timestamptz not null default now(),
  primary key (net_hash, feature, subject)
);
create index if not exists preview_uses_at on public.preview_uses (used_at);
alter table public.preview_uses enable row level security;
revoke all on public.preview_uses from anon, authenticated;
grant all on public.preview_uses to service_role;

insert into public.platform_settings (key, value, is_public) values
  ('preview_limit', '10'::jsonb, true), ('preview_report_limit', '1'::jsonb, true)
on conflict (key) do nothing;

/* THE GAME'S REPORT IS A SECTION OF ITS OWN (access.js CATALOGUE.locks.gameReport): it followed the club report's gate, and
   starts with whatever gate the platform gave that one, so nothing moves today */
insert into public.access_gates (key, gate)
select 'gameReport', coalesce((select g.gate from public.access_gates g where g.key = 'clubReport'), 'club_report')
on conflict (key) do nothing;

/* the network's code: salted, one way, the same for a whole IPv6 /64 */
create or replace function public.preview_net() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_ip inet := public.request_ip(); s text;
begin
  if v_ip is null then return null; end if;
  select p.salt into s from preview_salt p where p.id = 1;
  return encode(extensions.digest(coalesce(s, '') || public.ip_net(v_ip)::text, 'sha256'), 'hex');
end $$;

/* the reports, each counted on its own */
create or replace function public.preview_report(p_feature text) returns boolean
language sql immutable set search_path = public as $$
  select p_feature in ('playerReport', 'clubReport', 'gameReport')
$$;

/* how many a week: the previews' (10), or a report kind's (1) */
create or replace function public.preview_limit(p_report boolean default false) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, least(100, coalesce(
    (select (s.value #>> '{}')::int from platform_settings s where s.key = case when p_report then 'preview_report_limit' else 'preview_limit' end),
    case when p_report then 1 else 10 end)))
$$;

create or replace function public.preview_left() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare net text := public.preview_net(); lim int := public.preview_limit(false); rl int := public.preview_limit(true);
        used int; oldest timestamptz; reports jsonb;
begin
  if auth.uid() is not null or net is null then
    return jsonb_build_object('signed_in', auth.uid() is not null, 'left', lim, 'limit', lim, 'report_limit', rl,
      'reports', jsonb_build_object('playerReport', rl, 'clubReport', rl, 'gameReport', rl));
  end if;
  select count(*)::int, min(u.used_at) into used, oldest
    from preview_uses u where u.net_hash = net and u.used_at > now() - interval '7 days' and not public.preview_report(u.feature);
  select jsonb_object_agg(k, greatest(rl - (select count(*)::int from preview_uses u
                                             where u.net_hash = net and u.feature = k and u.used_at > now() - interval '7 days'), 0))
    into reports from unnest(array['playerReport', 'clubReport', 'gameReport']) k;
  return jsonb_build_object('left', greatest(lim - used, 0), 'limit', lim, 'report_limit', rl, 'reports', reports,
                            'next_at', case when used >= lim then oldest + interval '7 days' end);
end $$;

create or replace function public.preview_take(p_feature text, p_subject text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare net text; rep boolean := public.preview_report(p_feature); lim int := public.preview_limit(public.preview_report(p_feature));
        used int; oldest timestamptz;
begin
  if p_feature is null or p_feature !~ '^[A-Za-z]{1,40}$'
     or p_subject is null or char_length(p_subject) not between 1 and 200 then
    raise exception 'a feature and a page' using errcode = '22023';
  end if;
  if auth.uid() is not null then return jsonb_build_object('ok', true, 'signed_in', true); end if;
  net := public.preview_net();
  if net is null then return jsonb_build_object('ok', true, 'left', null, 'limit', lim); end if;
  perform pg_advisory_xact_lock(hashtext('preview:' || net));
  delete from preview_uses u where u.net_hash = net and u.used_at <= now() - interval '7 days';
  /* a report kind against its own week, a preview against the previews' */
  select count(*)::int, min(u.used_at) into used, oldest from preview_uses u
   where u.net_hash = net and (case when rep then u.feature = p_feature else not public.preview_report(u.feature) end);
  if exists (select 1 from preview_uses u where u.net_hash = net and u.feature = p_feature and u.subject = p_subject) then
    return jsonb_build_object('ok', true, 'again', true, 'left', greatest(lim - used, 0), 'limit', lim);
  end if;
  if used >= lim then
    return jsonb_build_object('ok', false, 'left', 0, 'limit', lim, 'next_at', oldest + interval '7 days');
  end if;
  insert into preview_uses (net_hash, feature, subject) values (net, p_feature, p_subject);
  return jsonb_build_object('ok', true, 'left', lim - used - 1, 'limit', lim);
end $$;

create or replace function public.preview_uses_prune() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from preview_uses where used_at < now() - interval '8 days';
  get diagnostics n = row_count;
  return n;
end $$;
do $cron$
begin
  if to_regclass('cron.job') is not null then
    begin
      execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-preview-uses-prune'::text;
      execute 'select cron.schedule($1, $2, $3)'
        using 'epinoia-preview-uses-prune'::text, '47 4 * * *'::text, 'select public.preview_uses_prune()'::text;
    exception when others then
      raise warning '0231: the prune job was not scheduled (%: %); run select public.preview_uses_prune() now and then', sqlstate, sqlerrm;
    end;
  end if;
end $cron$;

revoke all on function public.preview_take(text, text) from public;
revoke all on function public.preview_left() from public;
grant execute on function public.preview_take(text, text) to anon, authenticated, service_role;
grant execute on function public.preview_left() to anon, authenticated, service_role;
revoke all on function public.preview_net() from public, anon, authenticated;
revoke all on function public.preview_limit(boolean) from public, anon, authenticated;
revoke all on function public.preview_uses_prune() from public, anon, authenticated;
grant execute on function public.preview_net(), public.preview_limit(boolean), public.preview_uses_prune() to service_role;

notify pgrst, 'reload schema';
