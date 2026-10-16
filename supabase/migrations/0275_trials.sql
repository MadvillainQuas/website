-- ============================================================================
-- 0275  FREE TRIALS: HOW LONG A REPORT ADDRESS OR AN ACCOUNT'S ACCESS LASTS
--
-- Louie, 2026-10-16: "When I add users, can I be able to add durations to add them for/edit the duration their
-- 'subscription' lasts, and then require them to start payment (when I set that up) after that subscription ends (like
-- a free trial)?" - for both the report addresses and the site's accounts; when a trial ends, it stops and says so.
--
--   report_mail_subs.trial_until       an address's club reports go until then (every club of the address carries the
--   report_mail_players.trial_until    same date); null: no end. Past it, the mailer sends nothing to it (scheduled or
--                                      "send now") and, once, an email saying the trial has ended - with the join page
--                                      to subscribe once memberships are switched on, else a reply to keep it
--   *.trial_notified_at                when that email went (cleared when the date is moved on, so a trial extended and
--                                      ended again is said again)
--   access_grants.ended_notified_at    the same for an account's access given by email (0117 grants, whose expires_at
--                                      already ends it): the email that it has ended, once
--   set_access_grant_expiry(grant, until)  a grant's end moved - extended, shortened, or taken off (null) - by whoever may
--                                      revoke it (0117's rule: a platform administrator for a platform-wide grant, the
--                                      league's administrators for a league's); audited
--
-- The report tables are platform administrators' only (0221, 0272), and so are their new columns.
-- ============================================================================

alter table public.report_mail_subs    add column if not exists trial_until timestamptz;
alter table public.report_mail_subs    add column if not exists trial_notified_at timestamptz;
alter table public.report_mail_players add column if not exists trial_until timestamptz;
alter table public.report_mail_players add column if not exists trial_notified_at timestamptz;
alter table public.access_grants       add column if not exists ended_notified_at timestamptz;

create or replace function public.set_access_grant_expiry(p_grant uuid, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_league  uuid;
  v_email   text;
  v_was     timestamptz;
  v_revoked timestamptz;
begin
  select g.league_id, g.email, g.expires_at, g.revoked_at into v_league, v_email, v_was, v_revoked
    from access_grants g where g.id = p_grant;
  if not found then
    raise exception 'no such grant' using errcode = '22023';
  end if;
  if v_league is null then
    if not public.is_platform_admin() then
      raise exception 'only a platform administrator may change a platform-wide grant' using errcode = '42501';
    end if;
  elsif not public.is_league_admin(v_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if v_revoked is not null then
    raise exception 'that access was taken away: give it again instead' using errcode = '22023';
  end if;
  if p_expires is not null and p_expires <= now() then
    raise exception 'that end has already passed' using errcode = '22023';
  end if;

  update access_grants set expires_at = p_expires, ended_notified_at = null where id = p_grant;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_access_grant_expiry', 'access_grant', p_grant::text,
          jsonb_build_object('league_id', v_league, 'email', v_email, 'was', v_was, 'expires_at', p_expires));
end; $$;

alter function public.set_access_grant_expiry(uuid, timestamptz) owner to postgres;
revoke execute on function public.set_access_grant_expiry(uuid, timestamptz) from public, anon;
grant execute on function public.set_access_grant_expiry(uuid, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
