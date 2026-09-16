-- ============================================================================
-- 0120 — DATA RIGHTS: THE REQUESTS AND COMPLAINTS QUEUE, AND THE RESTRICTED SCHEMA.
--
-- The contract is docs/replacement/foundations.md: section 3.3 (the restricted
-- schema), 3.8 (the data protection tables), 7.2 (retention), 7.6 (the queue),
-- 7.7 (audit) and the 0120 slice in section 9.
--
-- WHAT IT IS FOR. Somebody asks what Epinoia holds about them, asks for it to be
-- corrected or erased, objects, or complains about how their data was handled.
-- Each of those has a clock: a month for a subject-rights request (UK GDPR
-- Art. 12(3)), stopped while identity or scope is being clarified (the Data
-- (Use and Access) Act 2025), and extendable by at most two further months with
-- a reason; a complaint must be acknowledged within 30 days (in force since
-- 19 June 2026). Today Epinoia is the controller for fan accounts, so the queue
-- starts with tenant_id null, and each organisation that later becomes a data
-- controller (a tenant, 0119) gets its own queue in the same table.
--
-- AS SHIPPED NOTHING CHANGES FOR ANY PAGE THAT EXISTS. The queue starts empty;
-- the retention schedule is seeded but unapproved, so it acts on nothing; the
-- audit log gains two empty columns; the bell may carry a new kind, privacy,
-- which only platform administrators receive. Three things do change on purpose:
--   * an audit row written from a browser must now name its own account as the
--     actor (P0.4). No browser code writes audit rows (foundations 0.3): every
--     one is written by a security definer function or by finalise-game with
--     the service role, and neither is judged by the policy;
--   * deleting an account no longer fails because the account appears in the
--     audit log: the actor becomes null instead (P0.7);
--   * pruning the audit log keeps the accountability classes (person, role,
--     org, privacy, merge, credential) for six years rather than two.
--
-- THE RESTRICTED SCHEMA is created here, in the smallest slice, to settle
-- whether the CLI's push role may create one (foundations 3.3, open question
-- 7). anon and authenticated have no USAGE on it, so PostgREST and GraphQL
-- cannot reach a row even if a policy were written wrong later. If the push role
-- may not create it, this file stops at its preflight with nothing applied,
-- and section 1 says exactly how to switch to the prefixed-table fallback.
--
-- WHERE THIS FILE GOES BEYOND THE LETTER OF THE CONTRACT, each for a reason
-- given where it happens:
--   * audit_insert also refuses, from a browser, the six accountability action
--     namespaces and any tenant_id or person_id. Otherwise a signed-in user could
--     still write a "privacy.erase" row about somebody (with their own name on
--     it), and this slice would keep it for six years; and from 0123/0124 a
--     person_id row lands in that person's subject-access export. (Left for 0120
--     by 0119's report.) For the same reason a browser's action must be plain
--     lower-case dotted words (" privacy.erase" is not a new namespace) and its
--     created_at must be now, give or take five minutes: a back-dated row would
--     be pruned out of order, and a future-dated one would top the Audit tab and
--     never be pruned;
--   * platform_prune_audit (the console's Maintenance button, 0044) keeps the
--     same six-year classes as prune_audit_log, or the button would undo 7.2;
--   * prune_audit_log is no longer callable signed out or signed in: it always
--     was (0001 never revoked it), nothing calls it, and it deletes;
--   * the timer trigger also refuses a change of kind or received_at (the clock
--     runs from them), and confirming identity discards pause days counted
--     before it, because the clock restarts at confirmation and those days would
--     otherwise count twice;
--   * my_data_requests() lets a signed-in person read their own requests (the
--     self-test's "can read only their own request through the RPC", and what
--     the privacy page shows them); data_request_clock is the one place the
--     dates are computed, shared by the trigger and the console;
--   * the signed-in path is limited too (the contract names the limit for intake
--     only): three requests per account in 24 hours. The signed-out limit, three
--     per email address, counts only signed-out requests, so nobody can use
--     somebody's address on the form to block that person's own requests;
--   * a hidden organisation (0119's visible = false) is not a controller anybody
--     can file a request against, on either path;
--   * the privacy.request audit row names no actor on either path: requester_user
--     already says who asked, and from 0123 org_audit shows a tenant's rows to
--     anyone at the tenant with audit.read;
--   * the Epinoia-as-controller DPO contact is a public platform setting,
--     dpo_contact, beside the tenant setting of the same name (0119, 4.4);
--   * run_retention is named by 0124, but 0120's self-test calls it, so it is
--     built here in report mode only: asked to apply, it refuses until 0124
--     builds erasure and holds;
--   * the "names and statistics in the sporting record" row of 7.2 is not
--     seeded: it is not a retention rule (it is kept, and anonymised by erasure);
--   * the reminders (7.6) go to every platform administrator when a request has
--     no assignee, or its assignee no longer holds the role, so an unassigned
--     request cannot go overdue in silence; and a request whose clock is stopped
--     is not reminded of a due date that moves when the clock restarts.
--
-- THE NIGHTLY RUNNER (7.6) is the ingest runner, as foundations 5.2 has it for
-- the daily tick: scripts/ingest/run_ingest.py calls notify_data_requests()
-- after each discovery pass, as it calls notify_fixtures, and asks the notify
-- function to deliver. Each reminder is written once, however often it runs.
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- 0. LOCKS, FOR THE WHOLE FILE
--
-- Every lock this file takes is held until it commits, self-test included, so
-- from the first statement on, the wait for each is capped at five seconds, as
-- 0119 does: a busy moment fails the push with 55P03 and nothing applied. In
-- order:
--   * creating restricted.data_requests takes SHARE ROW EXCLUSIVE on auth.users
--     and organisations (its keys): writes to auth.users (a sign-up, a sign-in
--     stamping last_sign_in_at) wait until commit, reads do not;
--   * audit_log's columns, indexes and policy take ACCESS EXCLUSIVE on it: every
--     read and write of the audit log waits until commit (set_game_status,
--     revert_game, upsert_fixture and finalise-game write it);
--   * the notifications kind swap takes ACCESS EXCLUSIVE on notifications: the
--     bell's reads and the fan-outs' writes wait until commit;
--   * the actor key swap (section 12) takes ACCESS EXCLUSIVE on auth.users,
--     because dropping a foreign key locks the table it references: from then
--     every read of auth.users waits (a sign-in, a token refresh, auth.getUser
--     in an Edge Function). So it is the LAST thing in the file, after the
--     self-test, and holds that lock only for the key's validation, its own
--     short test and the commit.
-- ----------------------------------------------------------------------------
set local lock_timeout = '5s';

-- >>> SCHEMA MODE BEGINS ------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 1. THE RESTRICTED SCHEMA (foundations 3.3)
--
-- First a preflight, so a push role that may not create a schema is told what
-- to do rather than handed "permission denied for database".
--
-- THE FALLBACK (foundations 3.3, open question 7). If the preflight refuses,
-- nothing has been applied. To use the prefixed-table fallback instead:
--   1. delete everything from the ">>> SCHEMA MODE BEGINS" line above to the
--      "<<< SCHEMA MODE ENDS" line below (the preflight and the four schema
--      statements; nothing else in the file depends on them);
--   2. replace every occurrence of the text `restricted.` with
--      `public.restricted_` in the rest of the file (comments may be left or
--      changed, it makes no difference). The tables become
--      public.restricted_data_requests and public.restricted_retention_schedule,
--      and the functions public.restricted_data_requests_timers,
--      public.restricted_data_request_clock and public.restricted_run_retention;
--   3. push. Every table and function already revokes everything from public,
--      anon and authenticated, which is the whole of the fallback's protection,
--      and the self-test switches by itself: without the schema it checks the
--      prefix (the tables' privileges, no policy, and no policy or view naming
--      them) instead of USAGE on the schema.
-- That exact transformation was applied to this file and run, self-test and
-- all, on the local PGlite harness.
-- ----------------------------------------------------------------------------
do $pre$
begin
  if to_regnamespace('restricted') is null
     and not has_database_privilege(current_user, current_database(), 'CREATE') then
    raise exception using
      errcode = '42501',
      message = format('0120: %s may not create a schema in database %s, so the restricted schema cannot be made. '
                       'Nothing has been applied. Use the prefixed-table fallback described in section 1 of '
                       '0120_data_rights.sql (foundations 3.3, open question 7).', current_user, current_database());
  end if;
end $pre$;

create schema if not exists restricted;
alter schema restricted owner to postgres;
revoke all on schema restricted from public, anon, authenticated;
grant usage on schema restricted to service_role;
-- <<< SCHEMA MODE ENDS --------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2. THE REQUESTS AND COMPLAINTS QUEUE (foundations 3.8, 7.6)
--
-- One row per request or complaint. tenant_id null means Epinoia is the
-- controller (fan accounts); otherwise it is the tenant organisation the request
-- is about. The requester is named and addressed here and nowhere else: audit
-- rows and notifications carry the id, the kind and the dates, never the name,
-- the address or the details.
-- ----------------------------------------------------------------------------
create table if not exists restricted.data_requests (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references public.organisations on delete restrict,   -- null = Epinoia is the controller
  kind                  text not null check (kind in ('access','erasure','rectification','restriction',
                          'objection','portability','complaint')),
  requester_user        uuid references auth.users on delete set null,
  requester_name        text not null check (char_length(btrim(requester_name)) between 1 and 120),
  requester_email       text not null check (requester_email = lower(btrim(requester_email))),
  capacity              text not null default 'self' check (capacity in ('self','guardian','representative')),
  details               text not null default '' check (char_length(details) <= 4000),
  received_at           timestamptz not null default now(),
  ack_due_at            timestamptz,                -- complaints: received_at + 30 days
  acknowledged_at       timestamptz,
  identity_confirmed_at timestamptz,
  paused_at             timestamptz,                -- "stop the clock" while identity or scope is clarified
  paused_days           int not null default 0 check (paused_days >= 0),
  extended_until        timestamptz,
  extension_reason      text check (char_length(extension_reason) <= 400),
  due_at                timestamptz not null,       -- trigger
  status                text not null default 'received' check (status in ('received','awaiting_identity',
                          'awaiting_clarification','in_progress','completed','refused','withdrawn')),
  assigned_to           uuid references auth.users on delete set null,
  outcome               text check (char_length(outcome) <= 2000),
  export_path           text,                       -- private bucket object; signed URL only
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists data_requests_queue on restricted.data_requests (tenant_id, status, due_at);

/* THE DATES, IN ONE PLACE. Called by the timer trigger for every write, and by
   the console's calls to show the latest date an extension may reach. Month
   arithmetic runs on London wall-clock time, so "a month" is the corresponding
   calendar date whatever the session's time zone, and 31 January runs to
   28 February (29 in a leap year), as the ICO counts it.

     a complaint:  acknowledge by received + 30 days; the internal target is
                   received + 3 months; an extension may reach 5 months.
     a request:    due coalesce(identity confirmed, received) + 1 month + the
                   whole days the clock was stopped; an extension may reach
                   3 months + those days (UK GDPR Art. 12(3): two further). */
create or replace function restricted.data_request_clock(
  p_kind text, p_received_at timestamptz, p_identity_confirmed_at timestamptz, p_paused_days int,
  out ack_due_at timestamptz, out base_due_at timestamptz, out latest_extension timestamptz)
language sql stable set search_path = public, restricted as $$
  select case when p_kind = 'complaint'
              then ((p_received_at at time zone 'Europe/London') + interval '30 days') at time zone 'Europe/London'
         end,
         case when p_kind = 'complaint'
              then ((p_received_at at time zone 'Europe/London') + interval '3 months') at time zone 'Europe/London'
              else ((coalesce(p_identity_confirmed_at, p_received_at) at time zone 'Europe/London')
                    + interval '1 month' + make_interval(days => coalesce(p_paused_days, 0))) at time zone 'Europe/London'
         end,
         case when p_kind = 'complaint'
              then ((p_received_at at time zone 'Europe/London') + interval '5 months') at time zone 'Europe/London'
              else ((coalesce(p_identity_confirmed_at, p_received_at) at time zone 'Europe/London')
                    + interval '3 months' + make_interval(days => coalesce(p_paused_days, 0))) at time zone 'Europe/London'
         end;
$$;

/* THE TIMERS (foundations 7.6), on every insert and update:
     * moving into awaiting_identity or awaiting_clarification sets paused_at;
       leaving adds the whole days since then to paused_days and clears it;
     * confirming identity restarts the clock from that moment, so the pause
       days counted before it are discarded (they are inside the restart), and a
       pause still running is counted from the confirmation;
     * a closed status (completed, refused, withdrawn) stamps closed_at;
     * ack_due_at and due_at are always recomputed, so neither can be written
       by hand; an extension needs a reason, must end after the date it extends
       and no later than data_request_clock's latest_extension, and is checked
       only when it or its reason changes (a later pause may carry the base date
       past it, and then the base date wins);
     * kind and received_at never change: the clock runs from them.
   Security definer and pinned to postgres, so it computes the same dates
   whichever role's write fired it. */
create or replace function restricted.data_requests_timers()
returns trigger language plpgsql security definer set search_path = public, restricted as $$
declare
  v_was_paused boolean := false;
  v_is_paused  boolean;
  v_clock      record;
begin
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind or new.received_at is distinct from old.received_at then
      raise exception 'a request''s kind and the moment it was received never change: its clock runs from them'
        using errcode = '23514';
    end if;
    v_was_paused := old.status in ('awaiting_identity', 'awaiting_clarification');
    new.updated_at := now();
  end if;
  new.received_at := coalesce(new.received_at, now());
  new.paused_days := coalesce(new.paused_days, 0);
  v_is_paused := new.status in ('awaiting_identity', 'awaiting_clarification');

  if new.identity_confirmed_at is not null and new.identity_confirmed_at < new.received_at then
    raise exception 'identity cannot be confirmed before the request was received' using errcode = '23514';
  end if;
  if new.identity_confirmed_at is not null
     and (tg_op = 'INSERT' or old.identity_confirmed_at is null) then
    new.paused_days := 0;
    if new.paused_at is not null then
      new.paused_at := greatest(new.paused_at, new.identity_confirmed_at);
    end if;
  end if;

  if v_is_paused and not v_was_paused then
    new.paused_at := now();
  elsif v_is_paused then
    new.paused_at := coalesce(new.paused_at, old.paused_at, now());
  else
    if v_was_paused and new.paused_at is not null then
      new.paused_days := new.paused_days
        + greatest(0, floor(extract(epoch from (now() - new.paused_at)) / 86400))::int;
    end if;
    new.paused_at := null;
  end if;

  if new.status in ('completed', 'refused', 'withdrawn') then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
  end if;

  select * into v_clock
    from restricted.data_request_clock(new.kind, new.received_at, new.identity_confirmed_at, new.paused_days);
  new.ack_due_at := v_clock.ack_due_at;

  if new.extended_until is null then
    new.due_at := v_clock.base_due_at;
  else
    if tg_op = 'INSERT' or new.extended_until is distinct from old.extended_until
       or new.extension_reason is distinct from old.extension_reason then
      if coalesce(btrim(new.extension_reason), '') = '' then
        raise exception 'an extension needs its reason: the requester must be told why (UK GDPR Art. 12(3))'
          using errcode = '23514';
      end if;
      if new.extended_until <= v_clock.base_due_at then
        raise exception 'an extension must end after the date it extends (%)',
          to_char(v_clock.base_due_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')
          using errcode = '23514';
      end if;
      if new.extended_until > v_clock.latest_extension then
        raise exception 'an extension may add at most two further months: the latest date for this % is %',
          case when new.kind = 'complaint' then 'complaint' else 'request' end,
          to_char(v_clock.latest_extension at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')
          using errcode = '23514';
      end if;
    end if;
    new.due_at := greatest(new.extended_until, v_clock.base_due_at);
  end if;
  return new;
end; $$;

drop trigger if exists data_requests_timers on restricted.data_requests;
create trigger data_requests_timers
  before insert or update on restricted.data_requests
  for each row execute function restricted.data_requests_timers();

-- ----------------------------------------------------------------------------
-- 3. THE RETENTION SCHEDULE (foundations 3.8, 7.2)
--
-- Proposals, seeded with approved_by null: run_retention ignores a row until
-- the controller's DPO approves it (ground rule 8). Platform defaults here
-- (tenant_id null); a tenant may later hold its own row for a class.
-- ----------------------------------------------------------------------------
create table if not exists restricted.retention_schedule (
  id           serial primary key,
  tenant_id    uuid references public.organisations on delete cascade,   -- null = platform default
  record_class text not null,
  keep_for     interval not null,
  anchor       text not null check (anchor in ('last_active','ended','closed','created','expires','released','applied')),
  action       text not null check (action in ('delete','anonymise','null_fields','review')),
  basis        text not null,
  approved_by  text,                                -- null = proposed; run_retention ignores it
  approved_on  date
);
create unique index if not exists retention_one on restricted.retention_schedule
  (record_class, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));

insert into restricted.retention_schedule (record_class, keep_for, anchor, action, basis) values
  ('person_contacts',           interval '24 months', 'last_active', 'delete',
     'contract / legitimate interests (address, email, mobile)'),
  ('person_contacts.emergency', interval '90 days',   'ended',       'null_fields',
     'vital interests while active: 90 days after the last registration ends'),
  ('persons.identity',          interval '6 years',   'last_active', 'anonymise',
     'Limitation Act: 6 years contract; injury 3 years from 18, so not before the 22nd birthday. Names cleared, date of birth null, status erased'),
  ('registrations',             interval '6 years',   'ended',       'review',
     'contract, insurance: kept, pointing at the anonymised person'),
  ('org_roles',                 interval '6 years',   'ended',       'delete',
     'accountability, safeguarding audit (with the role audit rows)'),
  ('guardianships',             interval '12 months', 'ended',       'delete',
     'ended guardianships; consent evidence is kept separately'),
  ('consent_records',           interval '6 years',   'ended',       'delete',
     'Art. 7(1) accountability: 6 years after being superseded or the person anonymised'),
  ('person_sensitive',          interval '24 months', 'last_active', 'delete',
     'consent / DPA 2018 Sch. 1 para. 8; deleted at once on withdrawal'),
  ('credentials',               interval '2 years',   'expires',     'delete',
     'safer-recruitment audit (DPO to confirm)'),
  ('person_claims',             interval '90 days',   'created',     'delete',
     'claims are short-lived'),
  ('person_merges.snapshot',    interval '90 days',   'created',     'null_fields',
     'the undo window'),
  ('person_merges',             interval '6 years',   'created',     'delete',
     'accountability'),
  ('data_requests',             interval '6 years',   'closed',      'delete',
     'defence of claims'),
  ('legal_holds',               interval '6 years',   'released',    'delete',
     'released holds'),
  ('import_rows.fields',        interval '14 days',   'created',     'null_fields',
     'minimisation (also nulled at apply)'),
  ('import_batches',            interval '90 days',   'created',     'delete',
     'minimisation (batches and their rows)'),
  ('export_files',              interval '7 days',    'created',     'delete',
     'subject-access export files in the private bucket (bucket lifecycle)'),
  ('audit_log',                 interval '2 years',   'created',     'delete',
     'security, accountability'),
  ('audit_log.accountability',  interval '6 years',   'created',     'delete',
     'person.*, role.*, org.*, privacy.*, merge.*, credential.* rows: accountability')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY AND PRIVILEGES on the restricted tables (3.3):
-- RLS on with no policy, nothing for public, anon or authenticated, owned by
-- postgres. The service role reaches them only through the public RPCs below.
-- ----------------------------------------------------------------------------
alter table restricted.data_requests      enable row level security;
alter table restricted.retention_schedule enable row level security;
revoke all on table restricted.data_requests, restricted.retention_schedule from public, anon, authenticated;
revoke all on sequence restricted.retention_schedule_id_seq from public, anon, authenticated;
alter table restricted.data_requests      owner to postgres;
alter table restricted.retention_schedule owner to postgres;

-- ----------------------------------------------------------------------------
-- 5. THE AUDIT LOG (foundations 3.8, 7.7; roadmap P0.4 and part of P0.7)
--
-- Two new columns for the organisation and person audits that read them later
-- (org_audit 0123, the subject-access export 0124). Both start null everywhere.
-- The actor's key becomes ON DELETE SET NULL in section 12, at the end of the
-- file, for the lock it takes (section 0).
-- ----------------------------------------------------------------------------
alter table public.audit_log
  add column if not exists tenant_id uuid,
  add column if not exists person_id uuid;
create index if not exists audit_log_person on public.audit_log (person_id, created_at desc) where person_id is not null;
create index if not exists audit_log_tenant on public.audit_log (tenant_id, created_at desc) where tenant_id is not null;

/* P0.4: AN AUDIT ROW WRITTEN FROM A BROWSER NAMES ITS OWN ACCOUNT. It was "any
   signed-in user", with any actor. Definer functions (owned by postgres) and
   the service role are not judged by the policy, and they are the only writers.
   Beyond the contract (see the header): a browser may not write into the six
   accountability namespaces kept for six years, nor set tenant_id or person_id,
   which the organisation audit and the subject-access export read. Its action
   is lower-case words joined by dots, so neither "Privacy.erase" nor
   " privacy.erase" passes for an official row, and its created_at is now, give
   or take five minutes, so it can neither be back-dated nor dated ahead. */
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert
  with check (actor = auth.uid()
              and tenant_id is null and person_id is null
              and action ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'
              and action !~* '^(person|role|org|privacy|merge|credential)\.'
              and created_at between now() - interval '5 minutes' and now() + interval '5 minutes');

/* The retention classes (7.2): two years, and six for the accountability
   namespaces. Nothing calls this yet; it deletes, so it is the service role's. */
create or replace function public.prune_audit_log()
returns void language sql security definer set search_path = public as $$
  delete from audit_log
   where created_at < now() - interval '2 years'
     and (action !~ '^(person|role|org|privacy|merge|credential)\.'
          or created_at < now() - interval '6 years');
$$;

/* The console's Maintenance button (0044) keeps the same classes: however few
   days it is asked to keep, an accountability row goes only after six years. */
create or replace function public.platform_prune_audit(p_days int default 730)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) < 30 then
    raise exception 'keep at least 30 days' using errcode = '22023';
  end if;
  delete from audit_log
   where created_at < now() - make_interval(days => p_days)
     and (action !~ '^(person|role|org|privacy|merge|credential)\.'
          or created_at < now() - interval '6 years');
  get diagnostics n = row_count;
  return 'removed ' || n || ' entries (person, role, organisation, privacy, merge and credential entries are kept six years)';
end; $$;

-- ----------------------------------------------------------------------------
-- 6. THE DPO CONTACT for Epinoia as controller, shown on /epinoia/privacy/.
-- A public platform setting, seeded empty, so the console's Settings tab edits
-- it (platform_set_setting refuses keys that do not exist, 0044). A tenant's own
-- DPO contact is its dpo_contact setting (0119, foundations 4.4).
-- ----------------------------------------------------------------------------
insert into public.platform_settings (key, value, is_public)
values ('dpo_contact', '""'::jsonb, true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 7. INTAKE (foundations 7.6)
--
-- submit_data_request   signed in: the account is the requester, answered at
--                       the account's own email address.
-- intake_data_request   the service role, called by the contact Edge Function
--                       for somebody without an account (or not signed in).
-- my_data_requests      signed in: that account's own requests, status and
--                       dates only.
--
-- BOTH INTAKE PATHS ARE LIMITED to three requests in any 24 hours, counted under
-- a lock so two at once cannot both pass: signed in, per account; signed out, per
-- email address, counting only signed-out requests. A stranger who types
-- somebody's address into the form three times blocks only more signed-out
-- requests for that address, never that person's own requests from their
-- account, and the refusal says to sign in. Every request is kept; the fourth
-- is refused with 54000 and the page says the earlier ones are being handled.
--
-- A CONTROLLER is a visible root organisation (0119). A hidden one is not
-- offered, and is refused on both paths as if it did not exist.
--
-- NOTHING IS EMAILED TO THE REQUESTER from here. A signed-out form that sent a
-- receipt to whatever address it was given would let anybody send mail to
-- anybody; the acknowledgement is the handler's (update_data_request).
-- ----------------------------------------------------------------------------
create or replace function public.submit_data_request(p_kind text, p_details text, p_tenant uuid default null)
returns jsonb language plpgsql security definer set search_path = public, restricted as $$
declare
  v_uid     uuid := auth.uid();
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  v_details text := coalesce(p_details, '');
  v_email   text;
  v_name    text;
  r         record;   -- a row of the requests table (record, so pglast's plpgsql parser can read the body)
begin
  if v_uid is null then
    raise exception 'sign in to make a request this way, or use the privacy form signed out' using errcode = '42501';
  end if;
  if v_kind not in ('access', 'erasure', 'rectification', 'restriction', 'objection', 'portability', 'complaint') then
    raise exception 'a request is one of: access, erasure, rectification, restriction, objection, portability or complaint'
      using errcode = '22023';
  end if;
  if char_length(v_details) > 4000 then
    raise exception 'the details can be at most 4,000 characters' using errcode = '22023';
  end if;
  if p_tenant is not null
     and not exists (select 1 from organisations o where o.id = p_tenant and o.parent_id is null and o.visible) then
    raise exception 'that organisation is not a data controller on Epinoia' using errcode = '22023';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if coalesce(v_email, '') = '' then
    raise exception 'this account has no email address to answer to: use the privacy form signed out' using errcode = '22023';
  end if;
  select btrim(left(btrim(p.display_name), 120)) into v_name from profiles p where p.id = v_uid;
  v_name := coalesce(nullif(v_name, ''), btrim(left(split_part(v_email, '@', 1), 120)));
  if coalesce(v_name, '') = '' then
    v_name := 'Epinoia account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('epinoia.data_request:user:' || v_uid::text, 0));
  if (select count(*) from restricted.data_requests d
       where d.requester_user = v_uid and d.received_at > now() - interval '24 hours') >= 3 then
    raise exception 'three requests from this account in the last 24 hours: each one is being handled, and the reply will come to the account''s address'
      using errcode = '54000';
  end if;

  insert into restricted.data_requests (tenant_id, kind, requester_user, requester_name, requester_email, capacity, details)
  values (p_tenant, v_kind, v_uid, v_name, v_email, 'self', v_details)
  returning * into r;

  /* no actor: requester_user says who asked, and a tenant's audit readers
     (org_audit, 0123) are not told which account complained */
  insert into audit_log (actor, action, subject, subject_id, tenant_id, detail)
  values (null, 'privacy.request', 'data_request', r.id::text, r.tenant_id,
          jsonb_build_object('kind', r.kind, 'capacity', r.capacity, 'via', 'signed_in',
                             'ack_due_at', r.ack_due_at, 'due_at', r.due_at));

  return jsonb_build_object('id', r.id, 'reference', upper(left(r.id::text, 8)), 'kind', r.kind,
                            'status', r.status, 'received_at', r.received_at,
                            'ack_due_at', r.ack_due_at, 'due_at', r.due_at);
end; $$;

create or replace function public.intake_data_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, restricted as $$
declare
  v_kind     text;
  v_name     text;
  v_email    text;
  v_capacity text;
  v_details  text;
  v_tenant   uuid;
  r          record;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'a request is a JSON object' using errcode = '22023';
  end if;
  v_kind     := lower(btrim(coalesce(p->>'kind', '')));
  v_name     := btrim(coalesce(p->>'name', ''));
  v_email    := lower(btrim(coalesce(p->>'email', '')));
  v_capacity := lower(btrim(coalesce(nullif(p->>'capacity', ''), 'self')));
  v_details  := coalesce(p->>'details', '');

  if v_kind not in ('access', 'erasure', 'rectification', 'restriction', 'objection', 'portability', 'complaint') then
    raise exception 'a request is one of: access, erasure, rectification, restriction, objection, portability or complaint'
      using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'a name of 1 to 120 characters, so the reply knows who it is to' using errcode = '22023';
  end if;
  if char_length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' then
    raise exception 'that email address does not look right, and the reply goes to it' using errcode = '22023';
  end if;
  if v_capacity not in ('self', 'guardian', 'representative') then
    raise exception 'a request is made for yourself, as a parent or guardian, or as a representative' using errcode = '22023';
  end if;
  if char_length(v_details) > 4000 then
    raise exception 'the details can be at most 4,000 characters' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p->>'tenant_id', '')), '') is not null then
    begin
      v_tenant := btrim(p->>'tenant_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'that organisation is not a data controller on Epinoia' using errcode = '22023';
    end;
    if not exists (select 1 from organisations o where o.id = v_tenant and o.parent_id is null and o.visible) then
      raise exception 'that organisation is not a data controller on Epinoia' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('epinoia.data_request:email:' || v_email, 0));
  if (select count(*) from restricted.data_requests d
       where d.requester_email = v_email and d.requester_user is null
         and d.received_at > now() - interval '24 hours') >= 3 then
    raise exception 'three requests from this address in the last 24 hours: each one is being handled, and the reply will come to that address. If you have an account, sign in to make another'
      using errcode = '54000';
  end if;

  insert into restricted.data_requests (tenant_id, kind, requester_name, requester_email, capacity, details)
  values (v_tenant, v_kind, v_name, v_email, v_capacity, v_details)
  returning * into r;

  insert into audit_log (actor, action, subject, subject_id, tenant_id, detail)
  values (null, 'privacy.request', 'data_request', r.id::text, r.tenant_id,
          jsonb_build_object('kind', r.kind, 'capacity', r.capacity, 'via', 'form',
                             'ack_due_at', r.ack_due_at, 'due_at', r.due_at));

  return jsonb_build_object('id', r.id, 'reference', upper(left(r.id::text, 8)), 'kind', r.kind,
                            'status', r.status, 'received_at', r.received_at,
                            'ack_due_at', r.ack_due_at, 'due_at', r.due_at);
end; $$;

/* What a signed-in person may see of their own requests: the kind, where it
   stands and its dates, and an extension's reason (they are owed it). Not the
   handler, not the outcome notes, and nothing made signed out under the same
   address, which nobody verified. */
create or replace function public.my_data_requests()
returns jsonb language plpgsql stable security definer set search_path = public, restricted as $$
begin
  if auth.uid() is null then
    raise exception 'sign in to see your requests' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'reference', upper(left(d.id::text, 8)), 'kind', d.kind, 'status', d.status,
             'organisation', o.name, 'received_at', d.received_at, 'acknowledged_at', d.acknowledged_at,
             'ack_due_at', d.ack_due_at, 'due_at', d.due_at, 'extended_until', d.extended_until,
             'extension_reason', d.extension_reason, 'closed_at', d.closed_at)
           order by d.received_at desc)
      from restricted.data_requests d
      left join organisations o on o.id = d.tenant_id
     where d.requester_user = auth.uid()), '[]'::jsonb);
end; $$;

-- ----------------------------------------------------------------------------
-- 8. HANDLING (foundations 7.6)
--
-- privacy_queue(p_tenant)   the queue for one controller: null is Epinoia.
-- update_data_request(...)  acknowledge, confirm_identity, pause, resume,
--                           extend, assign, close.
-- Platform administrators only until the data_protection_officer role exists
-- (0123 widens both to data_rights.handle in the request's tenant). Every
-- action leaves a privacy.* audit row naming the request, its tenant, its kind
-- and its dates, never the requester.
-- ----------------------------------------------------------------------------
create or replace function public.privacy_queue(p_tenant uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, restricted as $$
declare
  v_now   timestamptz := now();
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only: the privacy queue is handled by the platform until organisation roles arrive (0123)'
      using errcode = '42501';
  end if;
  if p_tenant is not null
     and not exists (select 1 from organisations o where o.id = p_tenant and o.parent_id is null) then
    raise exception 'that organisation is not a data controller on Epinoia' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'now', v_now,
    'today', v_today,
    'tenant', (select jsonb_build_object('id', o.id, 'name', o.name) from organisations o where o.id = p_tenant),
    'platform_open', (select count(*) from restricted.data_requests d where d.tenant_id is null and d.closed_at is null),
    'tenants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'name', o.name,
               'open', (select count(*) from restricted.data_requests d where d.tenant_id = o.id and d.closed_at is null))
             order by o.name)
        from organisations o where o.parent_id is null), '[]'::jsonb),
    'handlers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email) order by u.email)
        from auth.users u
       where exists (select 1 from memberships m where m.user_id = u.id and m.role = 'platform_admin')), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
               'open',        count(*) filter (where d.closed_at is null),
               'overdue',     count(*) filter (where d.closed_at is null and d.due_at < v_now),
               'due_7d',      count(*) filter (where d.closed_at is null and d.due_at >= v_now
                                                 and d.due_at < v_now + interval '7 days'),
               'ack_overdue', count(*) filter (where d.closed_at is null and d.acknowledged_at is null
                                                 and d.ack_due_at < v_now),
               'ack_due_7d',  count(*) filter (where d.closed_at is null and d.acknowledged_at is null
                                                 and d.ack_due_at >= v_now and d.ack_due_at < v_now + interval '7 days'),
               'paused',      count(*) filter (where d.status in ('awaiting_identity', 'awaiting_clarification')),
               'unassigned',  count(*) filter (where d.closed_at is null and d.assigned_to is null),
               'closed',      count(*) filter (where d.closed_at is not null))
        from restricted.data_requests d
       where d.tenant_id is not distinct from p_tenant),
    'requests', coalesce((
      select jsonb_agg(x.j order by x.rn)
        from (select row_number() over (order by (d.closed_at is not null),
                                                 case when d.closed_at is null then d.due_at end,
                                                 d.closed_at desc) as rn,
                     jsonb_build_object(
                       'id', d.id, 'reference', upper(left(d.id::text, 8)), 'kind', d.kind, 'status', d.status,
                       'open', d.closed_at is null,
                       'requester_name', d.requester_name, 'requester_email', d.requester_email,
                       'requester_has_account', d.requester_user is not null, 'capacity', d.capacity,
                       'details', d.details,
                       'received_at', d.received_at, 'acknowledged_at', d.acknowledged_at, 'ack_due_at', d.ack_due_at,
                       'identity_confirmed_at', d.identity_confirmed_at,
                       'paused_at', d.paused_at, 'paused_days', d.paused_days,
                       'paused_days_now', d.paused_days + case when d.paused_at is null then 0
                         else greatest(0, floor(extract(epoch from (v_now - d.paused_at)) / 86400))::int end,
                       'extended_until', d.extended_until, 'extension_reason', d.extension_reason,
                       'latest_extension', c.latest_extension,
                       'due_at', d.due_at,
                       'days_left', (d.due_at at time zone 'Europe/London')::date - v_today,
                       'ack_days_left', (d.ack_due_at at time zone 'Europe/London')::date - v_today,
                       'overdue', d.closed_at is null and d.due_at < v_now,
                       'ack_overdue', d.closed_at is null and d.acknowledged_at is null and d.ack_due_at < v_now,
                       'assigned_to', d.assigned_to,
                       'assigned_email', (select u.email from auth.users u where u.id = d.assigned_to),
                       'outcome', d.outcome, 'closed_at', d.closed_at, 'updated_at', d.updated_at) as j
                from restricted.data_requests d
                cross join lateral restricted.data_request_clock(d.kind, d.received_at, d.identity_confirmed_at,
                                                                 d.paused_days) c
               where d.tenant_id is not distinct from p_tenant
               order by (d.closed_at is not null), case when d.closed_at is null then d.due_at end, d.closed_at desc
               limit 500) x), '[]'::jsonb));
end; $$;

create or replace function public.update_data_request(p_id uuid, p_action text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, restricted as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_p      jsonb := coalesce(p, '{}'::jsonb);
  r        record;
  v_clock  record;
  v_text   text;
  v_until  timestamptz;
  v_user   uuid;
  v_status text;
  v_msg    text;
  v_detail jsonb := '{}'::jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only: the privacy queue is handled by the platform until organisation roles arrive (0123)'
      using errcode = '42501';
  end if;
  if jsonb_typeof(v_p) <> 'object' then
    raise exception 'the action''s details are a JSON object' using errcode = '22023';
  end if;
  if v_action not in ('acknowledge', 'confirm_identity', 'pause', 'resume', 'extend', 'assign', 'close') then
    raise exception 'an action is one of: acknowledge, confirm_identity, pause, resume, extend, assign, close'
      using errcode = '22023';
  end if;

  select * into r from restricted.data_requests d where d.id = p_id for update;
  if not found then
    raise exception 'no such request' using errcode = '22023';
  end if;
  if r.closed_at is not null then
    raise exception 'this request was closed (%) on %: nothing more can be recorded on it',
      r.status, to_char(r.closed_at at time zone 'Europe/London', 'DD Mon YYYY')
      using errcode = '22023';
  end if;

  if v_action = 'acknowledge' then
    if r.acknowledged_at is not null then
      raise exception 'acknowledged already, on %', to_char(r.acknowledged_at at time zone 'Europe/London', 'DD Mon YYYY')
        using errcode = '22023';
    end if;
    update restricted.data_requests d
       set acknowledged_at = now(),
           status = case when d.status = 'received' then 'in_progress' else d.status end
     where d.id = r.id returning * into r;

  elsif v_action = 'confirm_identity' then
    if r.identity_confirmed_at is not null then
      raise exception 'identity was confirmed already, on %',
        to_char(r.identity_confirmed_at at time zone 'Europe/London', 'DD Mon YYYY')
        using errcode = '22023';
    end if;
    update restricted.data_requests d
       set identity_confirmed_at = now(),
           status = case when d.status in ('received', 'awaiting_identity') then 'in_progress' else d.status end
     where d.id = r.id returning * into r;

  elsif v_action = 'pause' then
    v_text := lower(btrim(coalesce(v_p->>'reason', '')));
    if v_text not in ('identity', 'clarification') then
      raise exception 'the clock stops while waiting for identity or for clarification: say which' using errcode = '22023';
    end if;
    if v_text = 'identity' and r.identity_confirmed_at is not null then
      raise exception 'identity is already confirmed, so the clock cannot stop for it' using errcode = '22023';
    end if;
    v_status := 'awaiting_' || v_text;
    if r.status = v_status then
      raise exception 'the clock is already stopped for %', v_text using errcode = '22023';
    end if;
    update restricted.data_requests d set status = v_status where d.id = r.id returning * into r;
    v_detail := jsonb_build_object('reason', v_text);

  elsif v_action = 'resume' then
    if r.status not in ('awaiting_identity', 'awaiting_clarification') then
      raise exception 'the clock is not stopped' using errcode = '22023';
    end if;
    update restricted.data_requests d set status = 'in_progress' where d.id = r.id returning * into r;

  elsif v_action = 'extend' then
    v_text := btrim(coalesce(v_p->>'reason', ''));
    if v_text = '' or char_length(v_text) > 400 then
      raise exception 'an extension needs its reason, in at most 400 characters: the requester must be told why'
        using errcode = '22023';
    end if;
    select * into v_clock
      from restricted.data_request_clock(r.kind, r.received_at, r.identity_confirmed_at, r.paused_days);
    begin
      if coalesce(v_p->>'until', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        /* a date means that day, at the same London time as the date it extends,
           so the latest date the console offers is exactly the latest allowed */
        v_until := ((v_p->>'until')::date + ((v_clock.base_due_at at time zone 'Europe/London')::time))
                   at time zone 'Europe/London';
      else
        v_until := (v_p->>'until')::timestamptz;
      end if;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception 'the extension needs the date it runs to' using errcode = '22023';
    end;
    if v_until is null then
      raise exception 'the extension needs the date it runs to' using errcode = '22023';
    end if;
    begin
      update restricted.data_requests d
         set extended_until = v_until, extension_reason = v_text
       where d.id = r.id returning * into r;
    exception when check_violation then
      get stacked diagnostics v_msg = message_text;
      raise exception '%', v_msg using errcode = '22023';
    end;
    v_detail := jsonb_build_object('extended_until', r.extended_until);

  elsif v_action = 'assign' then
    if nullif(btrim(coalesce(v_p->>'user_id', '')), '') is not null then
      begin
        v_user := btrim(v_p->>'user_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'no such account' using errcode = '22023';
      end;
    elsif nullif(btrim(coalesce(v_p->>'email', '')), '') is not null then
      select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(v_p->>'email'));
      if v_user is null then
        raise exception 'no account with that address' using errcode = '22023';
      end if;
    end if;
    if v_user is not null
       and not exists (select 1 from memberships m where m.user_id = v_user and m.role = 'platform_admin') then
      raise exception 'only a platform administrator can handle requests until organisation roles arrive (0123)'
        using errcode = '22023';
    end if;
    update restricted.data_requests d set assigned_to = v_user where d.id = r.id returning * into r;
    v_detail := jsonb_build_object('assigned_to', r.assigned_to);

  elsif v_action = 'close' then
    v_status := lower(btrim(coalesce(v_p->>'status', '')));
    v_text := btrim(coalesce(v_p->>'outcome', ''));
    if v_status not in ('completed', 'refused', 'withdrawn') then
      raise exception 'a request closes as completed, refused or withdrawn' using errcode = '22023';
    end if;
    if v_status in ('completed', 'refused') and v_text = '' then
      raise exception 'record the outcome: what was done, or why the request was refused' using errcode = '22023';
    end if;
    if char_length(v_text) > 2000 then
      raise exception 'the outcome can be at most 2,000 characters' using errcode = '22023';
    end if;
    update restricted.data_requests d
       set status = v_status, outcome = coalesce(nullif(v_text, ''), d.outcome)
     where d.id = r.id returning * into r;
  end if;

  insert into audit_log (actor, action, subject, subject_id, tenant_id, detail)
  values (auth.uid(), 'privacy.' || v_action, 'data_request', r.id::text, r.tenant_id,
          jsonb_build_object('kind', r.kind, 'status', r.status, 'ack_due_at', r.ack_due_at,
                             'due_at', r.due_at, 'paused_days', r.paused_days) || v_detail);

  return jsonb_build_object('id', r.id, 'status', r.status, 'acknowledged_at', r.acknowledged_at,
                            'identity_confirmed_at', r.identity_confirmed_at, 'paused_at', r.paused_at,
                            'paused_days', r.paused_days, 'extended_until', r.extended_until,
                            'ack_due_at', r.ack_due_at, 'due_at', r.due_at,
                            'assigned_to', r.assigned_to, 'closed_at', r.closed_at);
end; $$;

-- ----------------------------------------------------------------------------
-- 9. RETENTION, IN REPORT MODE (foundations 7.2; completed by 0124)
--
-- For every schedule row: how many records its rule would reach today, whether
-- the row is approved, and that nothing was done. One privacy.retention audit
-- row per row, with counts and never names. Only the classes whose tables exist
-- are counted (data_requests and the two audit classes); the rest say not built.
-- A tenant's own row for a class takes that tenant's records out of the
-- platform default's count. Legal holds arrive in 0122.
--
-- Asked to apply, it refuses: 0120 has no erasure, no holds and nothing to act
-- with, and ground rule 8 is easiest to keep by not having the code yet.
-- ----------------------------------------------------------------------------
create or replace function restricted.run_retention(p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public, restricted as $$
declare
  s        record;
  v_cutoff timestamptz;
  v_built  boolean;
  v_n      bigint;
  v_entry  jsonb;
  v_report jsonb := '[]'::jsonb;
begin
  if coalesce(p_apply, false) then
    raise exception 'retention applies nothing before 0124 builds erasure and legal holds: run it in report mode'
      using errcode = '0A000';
  end if;

  for s in select * from restricted.retention_schedule order by record_class, tenant_id nulls first loop
    v_cutoff := now() - s.keep_for;
    v_built := true;
    v_n := null;
    if s.record_class = 'data_requests' then
      select count(*) into v_n from restricted.data_requests d
       where d.closed_at < v_cutoff
         and case when s.tenant_id is null
                  then d.tenant_id is null
                       or not exists (select 1 from restricted.retention_schedule t
                                       where t.record_class = s.record_class and t.tenant_id = d.tenant_id)
                  else d.tenant_id = s.tenant_id end;
    elsif s.record_class in ('audit_log', 'audit_log.accountability') then
      select count(*) into v_n from audit_log a
       where a.created_at < v_cutoff
         and (a.action ~ '^(person|role|org|privacy|merge|credential)\.') = (s.record_class = 'audit_log.accountability')
         and case when s.tenant_id is null
                  then a.tenant_id is null
                       or not exists (select 1 from restricted.retention_schedule t
                                       where t.record_class = s.record_class and t.tenant_id = a.tenant_id)
                  else a.tenant_id = s.tenant_id end;
    else
      v_built := false;
    end if;

    v_entry := jsonb_build_object('record_class', s.record_class, 'tenant_id', s.tenant_id,
                                  'keep_for', s.keep_for::text, 'anchor', s.anchor, 'action', s.action,
                                  'approved', s.approved_by is not null, 'built', v_built,
                                  'eligible', v_n, 'acted', 0);
    v_report := v_report || jsonb_build_array(v_entry);
    insert into audit_log (actor, action, subject, subject_id, tenant_id, detail)
    values (auth.uid(), 'privacy.retention', 'retention_schedule', s.record_class, s.tenant_id,
            v_entry || jsonb_build_object('mode', 'report'));
  end loop;

  return jsonb_build_object('mode', 'report', 'ran_at', now(), 'holds_checked', false, 'classes', v_report);
end; $$;

-- ----------------------------------------------------------------------------
-- 10. THE REMINDERS (foundations 7.6)
--
-- notify_data_requests() writes a bell row, of kind privacy, for each reminder
-- due now and returns how many it wrote; the notify function then delivers bell
-- rows by email or push to whoever asked for that on their profile. The ingest
-- runner calls it after each discovery pass (see the header). Each reminder has
-- its own ref and (user, kind, ref) is unique, so running it again writes
-- nothing new:
--   * SOON: seven days or less before a complaint's acknowledgement date (while
--     it is unacknowledged) or before a due date, once for that date. An
--     extension, or a pause that moves the date, gives the new date a reminder
--     of its own when it comes within seven days;
--   * OVERDUE: once on each London day after the date has passed.
-- A request whose clock is stopped (awaiting identity or clarification) is not
-- reminded of its due date, which moves when the clock restarts. A complaint's
-- dates do not stop (data_request_clock ignores pauses for complaints).
-- TO WHOM: the assignee while they are a platform administrator; otherwise
-- every platform administrator (0123 widens this with the queue). A reminder
-- says the reference, the kind, the controller and the date, never the
-- requester, their address or their words, and links to the Privacy tab.
--
-- The bell's kinds are a check constraint (0106, then 0109); privacy joins
-- them. Swapping it locks notifications (section 0).
-- ----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('result', 'player', 'fixture', 'announcement', 'message', 'highlights', 'privacy'));

create or replace function public.notify_data_requests()
returns int language plpgsql security definer set search_path = public, restricted as $$
declare
  v_now   timestamptz := now();
  v_today text := to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM-DD');
  n       int;
begin
  insert into notifications (user_id, kind, title, body, link, ref)
  select distinct on (w.user_id, q.ref)
         w.user_id, 'privacy', q.title, q.body, 'admin/platform/#priv', q.ref
    from (
      select d.assigned_to,
             format('privacy:%s:%s:%s', d.id, c.clock,
                    case when c.at < v_now then 'overdue:' || v_today
                         else 'soon:' || to_char(c.at at time zone 'Europe/London', 'YYYY-MM-DD"T"HH24:MI') end) as ref,
             format('Privacy %s %s: %s %s',
                    case when d.kind = 'complaint' then 'complaint' else d.kind || ' request' end,
                    upper(left(d.id::text, 8)),
                    case when c.clock = 'ack' and c.at < v_now then 'acknowledgement overdue since'
                         when c.clock = 'ack' then 'acknowledge by'
                         when c.at < v_now then 'overdue since'
                         when d.kind = 'complaint' then 'resolve by'
                         else 'reply due by' end,
                    to_char(c.at at time zone 'Europe/London', 'FMDD Mon YYYY')) as title,
             case when d.tenant_id is null then 'Epinoia is the controller.'
                  else 'For ' || coalesce(o.name, 'an organisation') || ', the controller.' end
               || ' Open the Privacy tab of the platform console.' as body
        from restricted.data_requests d
        left join organisations o on o.id = d.tenant_id
        cross join lateral (values
          ('ack', case when d.acknowledged_at is null then d.ack_due_at end),
          ('due', case when d.kind = 'complaint'
                         or d.status not in ('awaiting_identity', 'awaiting_clarification') then d.due_at end)
        ) as c(clock, at)
       where d.closed_at is null
         and c.at is not null
         and c.at < v_now + interval '7 days'
    ) q
    join lateral (
      select m.user_id from memberships m
       where m.role = 'platform_admin'
         and (m.user_id = q.assigned_to
              or not exists (select 1 from memberships a
                              where a.user_id = q.assigned_to and a.role = 'platform_admin'))
    ) w on true
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end; $$;

-- ----------------------------------------------------------------------------
-- 11. GRANTS AND OWNERSHIP
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase adds
-- anon and authenticated by default privileges in public, so every function
-- says who may call it and the self-test reads it back. Everything is pinned
-- to postgres: the CLI applies migrations through a temporary login role (0115).
-- ----------------------------------------------------------------------------
revoke all on function restricted.data_request_clock(text, timestamptz, timestamptz, int) from public, anon, authenticated;
grant execute on function restricted.data_request_clock(text, timestamptz, timestamptz, int) to service_role;
revoke all on function restricted.data_requests_timers() from public, anon, authenticated;
revoke all on function restricted.run_retention(boolean) from public, anon, authenticated;
grant execute on function restricted.run_retention(boolean) to service_role;

-- signed in; each checks its own caller inside
revoke all on function public.submit_data_request(text, text, uuid) from public, anon;
grant execute on function public.submit_data_request(text, text, uuid) to authenticated;
revoke all on function public.my_data_requests() from public, anon;
grant execute on function public.my_data_requests() to authenticated;
revoke all on function public.privacy_queue(uuid) from public, anon;
grant execute on function public.privacy_queue(uuid) to authenticated;
revoke all on function public.update_data_request(uuid, text, jsonb) from public, anon;
grant execute on function public.update_data_request(uuid, text, jsonb) to authenticated;

-- the service role only
revoke all on function public.intake_data_request(jsonb) from public, anon, authenticated;
grant execute on function public.intake_data_request(jsonb) to service_role;
revoke all on function public.prune_audit_log() from public, anon, authenticated;
grant execute on function public.prune_audit_log() to service_role;
revoke all on function public.notify_data_requests() from public, anon, authenticated;
grant execute on function public.notify_data_requests() to service_role;

alter function restricted.data_request_clock(text, timestamptz, timestamptz, int) owner to postgres;
alter function restricted.data_requests_timers() owner to postgres;
alter function restricted.run_retention(boolean) owner to postgres;
alter function public.submit_data_request(text, text, uuid) owner to postgres;
alter function public.intake_data_request(jsonb) owner to postgres;
alter function public.my_data_requests() owner to postgres;
alter function public.privacy_queue(uuid) owner to postgres;
alter function public.update_data_request(uuid, text, jsonb) owner to postgres;
alter function public.prune_audit_log() owner to postgres;
alter function public.platform_prune_audit(int) owner to postgres;
alter function public.notify_data_requests() owner to postgres;

-- ============================================================================
-- SELF-TEST — the queue, its clock, the audit rules and who can reach what, as
-- the roles that will reach them (foundations section 9, 0120).
--
-- Always, whatever role runs this file:
--   * the catalogue: anon and authenticated have no USAGE on the restricted
--     schema (or, in the fallback, no privilege on the prefixed tables); every
--     restricted table has RLS on, no policy, no browser or PUBLIC privilege
--     and postgres as owner; every restricted function is closed to browsers;
--     who may call each public RPC; that no policy or public view reads the
--     restricted tables or the organisation tree (ground rule 2); the audit
--     log's two columns, their indexes, one INSERT policy and no other write
--     policy; that every function writing audit_log is security definer (the
--     policy judges nobody else); the seeded, unapproved schedule; the public
--     dpo_contact setting (the actor's key is checked in section 12);
--   * the clock itself: 31 January runs to 28 February, a complaint's 30 days
--     cross the clock change at the same London time, identity and pauses move
--     the base date, and the latest extension is three months out;
--   * as the owner: a complaint gets ack_due_at exactly 30 days out; hand-written
--     dates are recomputed; a pause of 5 days (and an hour) moves due_at exactly
--     5 days, a pause under a day moves nothing; confirming identity restarts
--     the clock; an extension past three months, one without a reason and one
--     that ends before the date it extends are refused, and one to exactly three
--     months is not; kind and received_at never change; closing stamps
--     closed_at; run_retention(false) reports on every schedule row (an approved
--     one and a tenant's own among them) and changes 0 rows, run_retention(true)
--     is refused; prune_audit_log keeps privacy rows past two years and drops
--     them at six;
--   * signed out: every restricted table and function, and every RPC but none,
--     is refused; an audit row is refused;
--   * a signed-in stranger: the restricted tables, the queue, the handling, the
--     intake, the reminders and both prunes are refused; an audit row naming
--     another actor, or in an accountability namespace (in any case, or with a
--     leading space), or carrying a tenant or person, or dated years back or a
--     day ahead, is refused (42501); submitting without an address is refused.
-- As the service role, where this role may become it: intake stores a
-- signed-out request, refuses bad input, a hidden organisation and a fourth
-- signed-out request from one address.
-- With real accounts (fresh where this role may create auth.users rows, and
-- otherwise borrowed from profiles that hold no role, inside the same
-- rolled-back block, as 0117 and 0119 do):
--   * a league admin who is also a team manager can neither read the queue nor
--     handle a request;
--   * a signed-in user whose address three signed-out requests have already
--     used still submits, reads only their own requests (not those), cannot
--     read the queue or handle one, cannot file against a hidden organisation,
--     can still write their own ordinary audit row but none of the forgeries,
--     and is refused a fourth request of their own in 24 hours; the audit row
--     of their request names no actor;
--   * a platform admin reads each controller's queue and handles a request
--     through every action and every refusal the console can meet, each
--     leaving a privacy.* row that names neither the requester nor their
--     address, which the console's audit reader still returns; the console's
--     prune keeps privacy rows;
--   * the reminders, with two platform admins: a request due within seven days
--     reminds its assignee alone, once; an unacknowledged complaint past its
--     date, and a request whose assignee is no platform admin, remind every
--     platform admin; a date eight days out, a stopped clock, an acknowledged
--     complaint and a closed request remind nobody; no reminder names the
--     requester; running again writes nothing.
-- Section 12 then swaps the actor's key and proves, with fresh accounts, that
-- deleting an account in the audit log and the queue works (P0.7).
--
-- EVERYTHING HAPPENS INSIDE A BLOCK THAT IS ALWAYS ROLLED BACK (the P0115
-- pattern): rows seeded with the migration's own rights first, roles switched
-- with SET LOCAL ROLE and a forged request.jwt.claims, back to the captured role
-- (never RESET ROLE), and the block ends by raising P0120, which its handler
-- swallows. Refusals are caught by SQLSTATE only, never `others`. Afterwards the
-- test rows are gone and the schedule is as seeded.
-- ============================================================================
do $test$
declare
  who          text := current_user || ' (session ' || session_user || ')';
  orig         text := current_user;
  v_mode       text;
  half         text := 'fresh test accounts';
  service_half text := 'ran';
  have_users   boolean := true;
  have_service boolean := true;
  borrowed     uuid[];
  u_admin      uuid := gen_random_uuid();
  u_a          uuid := gen_random_uuid();
  u_b          uuid := gen_random_uuid();
  u_out        uuid := gen_random_uuid();   -- signed in, nothing else, and never needs a row
  e_a          text;
  e_b          text;
  e_admin      text;
  o_body       uuid;
  o_region     uuid;
  o_hidden     uuid;
  t_league     uuid;
  t_team       uuid;
  r_soon       uuid;
  r_ack        uuid;
  r_stopped    uuid;
  r_closed     uuid;
  r_stray      uuid;
  r_acked      uuid;
  r_later      uuid;
  q_c          record;
  q_x          record;
  q_old        uuid;
  q_ten        uuid;
  a1           uuid;
  a2           uuid;
  b1           uuid;
  i1           uuid;
  i2           uuid;
  v_rel        regclass;
  v_proc       regprocedure;
  v_clock      record;
  v_due        timestamptz;
  v_latest     timestamptz;
  rt           record;
  j            jsonb;
  e            jsonb;
  f            text;
  calls_all    text[];
  calls_anon   text[];
  v_txt        text;
  v_n          bigint;
  v_n2         bigint;
  v_sched      bigint;
  v_rows       bigint;
  v_admins     bigint;
begin
  -- ---- the schema, or in the fallback the prefix -------------------------------
  if to_regnamespace('restricted') is not null then
    v_mode := 'the restricted schema';
    if has_schema_privilege('anon', 'restricted', 'usage') or has_schema_privilege('authenticated', 'restricted', 'usage')
       or has_schema_privilege('anon', 'restricted', 'create') or has_schema_privilege('authenticated', 'restricted', 'create') then
      raise exception '0120: A BROWSER ROLE HOLDS USAGE OR CREATE ON THE RESTRICTED SCHEMA';
    end if;
    if exists (select 1 from pg_namespace ns, aclexplode(coalesce(ns.nspacl, acldefault('n', ns.nspowner))) a
                where ns.nspname = 'restricted' and a.grantee = 0) then
      raise exception '0120: PUBLIC holds a privilege on the restricted schema';
    end if;
    if not has_schema_privilege('service_role', 'restricted', 'usage') then
      raise exception '0120: the service role has no USAGE on the restricted schema';
    end if;
    if (select pg_get_userbyid(ns.nspowner) from pg_namespace ns where ns.nspname = 'restricted') <> 'postgres' then
      raise exception '0120: the restricted schema is not owned by postgres';
    end if;
    /* every relation and function in it, including whatever a later slice adds */
    select string_agg(c.relname, ', ') into v_txt
      from pg_class c
     where c.relnamespace = to_regnamespace('restricted') and c.relkind in ('r', 'p')
       and (not c.relrowsecurity or pg_get_userbyid(c.relowner) <> 'postgres'
            or exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
            or exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                        where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)));
    if v_txt is not null then
      raise exception '0120: a restricted table lacks RLS, has a policy, has a browser or PUBLIC privilege, or is not owned by postgres: %', v_txt;
    end if;
    select string_agg(p.oid::regprocedure::text, ', ') into v_txt
      from pg_proc p
     where p.pronamespace = to_regnamespace('restricted')
       and (pg_get_userbyid(p.proowner) <> 'postgres'
            or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)));
    if v_txt is not null then
      raise exception '0120: a restricted function is callable from a browser or not owned by postgres: %', v_txt;
    end if;
  else
    v_mode := 'the prefixed-table fallback';
  end if;

  -- ---- the two tables and three functions, in either mode ----------------------
  foreach f in array array['data_requests', 'retention_schedule'] loop
    v_rel := to_regclass('restricted.' || f);
    if v_rel is null then
      raise exception '0120: the % table is missing', f;
    end if;
    select c.relrowsecurity as rls, pg_get_userbyid(c.relowner) as owner,
           exists (select 1 from pg_policy pol where pol.polrelid = c.oid) as has_policy,
           exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                    where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)) as browser
      into rt from pg_class c where c.oid = v_rel;
    if not rt.rls or rt.has_policy or rt.owner <> 'postgres' then
      raise exception '0120: % must have RLS on, no policy and postgres as owner (rls %, policy %, owner %)',
        v_rel, rt.rls, rt.has_policy, rt.owner;
    end if;
    if rt.browser then
      raise exception '0120: % GRANTS A PRIVILEGE TO PUBLIC, ANON OR AUTHENTICATED', v_rel;
    end if;
  end loop;
  foreach f in array array['restricted.data_request_clock(text,timestamptz,timestamptz,integer)',
                           'restricted.data_requests_timers()', 'restricted.run_retention(boolean)'] loop
    v_proc := to_regprocedure(f);
    if v_proc is null then
      raise exception '0120: the function % is missing', f;
    end if;
    if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = v_proc) <> 'postgres'
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = v_proc and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)) then
      raise exception '0120: % is callable from a browser or not owned by postgres', v_proc;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger tg where tg.tgrelid = to_regclass('restricted.data_requests')
                  and tg.tgname = 'data_requests_timers' and not tg.tgisinternal) then
    raise exception '0120: the timer trigger is missing, so due_at would never be set';
  end if;

  -- ---- who may call the public RPCs --------------------------------------------
  foreach f in array array['submit_data_request(text,text,uuid)', 'my_data_requests()', 'privacy_queue(uuid)',
                           'update_data_request(uuid,text,jsonb)', 'platform_prune_audit(integer)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception '0120: % is callable signed out', f;
    end if;
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0120: % is not callable signed in, so its page cannot reach it', f;
    end if;
  end loop;
  foreach f in array array['intake_data_request(jsonb)', 'prune_audit_log()', 'notify_data_requests()'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute')
       or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0120: % is the service role''s, but a browser role can call it', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0120: the service role cannot call %', f;
    end if;
  end loop;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('submit_data_request', 'intake_data_request', 'my_data_requests', 'privacy_queue',
                           'update_data_request', 'prune_audit_log', 'platform_prune_audit', 'notify_data_requests')
         and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') <> 8 then
    raise exception '0120: every public function of this slice must be security definer and owned by postgres, once each';
  end if;

  -- ---- ground rule 2: no policy or public view reads restricted or the tree ----
  select string_agg(format('%s.%s (%s)', p.schemaname, p.tablename, p.policyname), ', ') into v_txt
    from pg_policies p
   where coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
         ~* '\mrestricted[._]|\m(data_requests|retention_schedule|organisations|org_affiliations)\M';
  if v_txt is not null then
    raise exception '0120: a table policy reads the restricted tables or the organisation tree: %', v_txt;
  end if;
  select string_agg(format('%s.%s', v.schemaname, v.viewname), ', ') into v_txt
    from pg_views v
   where v.schemaname = 'public'
     and v.definition ~* '\mrestricted[._]|\m(data_requests|retention_schedule|organisations|org_affiliations)\M';
  if v_txt is not null then
    raise exception '0120: a public view reads the restricted tables or the organisation tree: %', v_txt;
  end if;

  -- ---- the audit log -----------------------------------------------------------
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.audit_log'::regclass and not a.attisdropped
         and a.attname in ('tenant_id', 'person_id') and a.atttypid = 'uuid'::regtype) <> 2
     or to_regclass('public.audit_log_person') is null or to_regclass('public.audit_log_tenant') is null then
    raise exception '0120: audit_log is missing tenant_id or person_id, or their indexes';
  end if;
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'audit_log'
        and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) <> 1
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'audit_log'
                     and p.policyname = 'audit_insert' and p.cmd = 'INSERT') then
    raise exception '0120: audit_log must have exactly one write policy, audit_insert, for INSERT';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_txt
    from pg_proc p
   where p.pronamespace in ('public'::regnamespace, coalesce(to_regnamespace('restricted'), 'public'::regnamespace))
     and position('audit_log' in p.prosrc) > 0
     and p.prosrc ~* 'insert\s+into\s+(public\.)?audit_log'
     and not p.prosecdef;
  if v_txt is not null then
    raise exception '0120: these write audit_log as their caller, and audit_insert would now judge them: %', v_txt;
  end if;

  -- ---- the schedule and the setting ------------------------------------------
  if (select count(*) from restricted.retention_schedule s where s.tenant_id is null) <> 19
     or exists (select 1 from restricted.retention_schedule s where s.approved_by is not null or s.approved_on is not null) then
    raise exception '0120: the retention schedule must be the 19 proposals of foundations 7.2, none approved';
  end if;
  if not exists (select 1 from platform_settings ps where ps.key = 'dpo_contact' and ps.is_public) then
    raise exception '0120: the public dpo_contact setting is missing, so the privacy page has no contact to show';
  end if;

  -- ---- the clock, as arithmetic ------------------------------------------------
  select * into v_clock from restricted.data_request_clock('access', timestamptz '2026-01-31 10:00 Europe/London', null, 0);
  if v_clock.base_due_at <> timestamptz '2026-02-28 10:00 Europe/London'
     or v_clock.latest_extension <> timestamptz '2026-04-30 10:00 Europe/London'
     or v_clock.ack_due_at is not null then
    raise exception '0120: a request received on 31 January is due %, extendable to % (want 28 February and 30 April, 10:00)',
      v_clock.base_due_at, v_clock.latest_extension;
  end if;
  select * into v_clock from restricted.data_request_clock('complaint', timestamptz '2026-03-20 09:00 Europe/London', null, 0);
  if v_clock.ack_due_at <> timestamptz '2026-04-19 09:00 Europe/London'
     or v_clock.base_due_at <> timestamptz '2026-06-20 09:00 Europe/London' then
    raise exception '0120: a complaint of 20 March 09:00 must be acknowledged by 19 April 09:00 (across the clock change) and closed by 20 June: % and %',
      v_clock.ack_due_at, v_clock.base_due_at;
  end if;
  select * into v_clock from restricted.data_request_clock('erasure', timestamptz '2026-02-01 08:00 Europe/London',
                                                           timestamptz '2026-02-10 12:00 Europe/London', 5);
  if v_clock.base_due_at <> timestamptz '2026-03-15 12:00 Europe/London'
     or v_clock.latest_extension <> timestamptz '2026-05-15 12:00 Europe/London' then
    raise exception '0120: identity confirmed 10 February 12:00 with 5 days stopped is due % and extendable to % (want 15 March and 15 May)',
      v_clock.base_due_at, v_clock.latest_extension;
  end if;

  begin
    -- ===================================================== the queue, as the owner
    insert into organisations (kind, name, slug)
      values ('national_body', '0120 Body', 'zz-t120-body') returning id into o_body;
    insert into organisations (parent_id, kind, name, slug)
      values (o_body, 'region', '0120 Region', 'zz-t120-region') returning id into o_region;
    insert into organisations (kind, name, slug, visible)
      values ('national_body', '0120 Hidden', 'zz-t120-hidden', false) returning id into o_hidden;

    -- a complaint: acknowledge within 30 days, to the London minute
    insert into restricted.data_requests (kind, requester_name, requester_email)
      values ('complaint', '0120 Owner', 't120-owner@example.invalid') returning * into q_c;
    if q_c.ack_due_at is distinct from ((q_c.received_at at time zone 'Europe/London') + interval '30 days') at time zone 'Europe/London'
       or (q_c.ack_due_at at time zone 'Europe/London')::date - (q_c.received_at at time zone 'Europe/London')::date <> 30
       or (q_c.ack_due_at at time zone 'Europe/London')::time <> (q_c.received_at at time zone 'Europe/London')::time then
      raise exception '0120: a complaint received % must be acknowledged by exactly 30 days later, not %', q_c.received_at, q_c.ack_due_at;
    end if;
    if q_c.due_at is distinct from ((q_c.received_at at time zone 'Europe/London') + interval '3 months') at time zone 'Europe/London'
       or q_c.status <> 'received' or q_c.paused_days <> 0 or q_c.closed_at is not null then
      raise exception '0120: a new complaint is not received, due three months out, unpaused and open: %', to_jsonb(q_c);
    end if;

    -- a request: a month, no acknowledgement date, and dates nobody can write by hand
    insert into restricted.data_requests (kind, requester_name, requester_email, due_at, ack_due_at)
      values ('access', '0120 Owner', 't120-owner@example.invalid', now() + interval '9 years', now())
      returning * into q_x;
    if q_x.due_at is distinct from ((q_x.received_at at time zone 'Europe/London') + interval '1 month') at time zone 'Europe/London'
       or q_x.ack_due_at is not null then
      raise exception '0120: a request''s dates were taken from the writer, or are wrong: due %, acknowledge by %', q_x.due_at, q_x.ack_due_at;
    end if;
    v_due := q_x.due_at;
    update restricted.data_requests d set due_at = now() + interval '9 years', ack_due_at = now()
     where d.id = q_x.id returning * into q_x;
    if q_x.due_at <> v_due or q_x.ack_due_at is not null then
      raise exception '0120: a hand-written due date survived an update';
    end if;

    -- a pause of five days and an hour moves the due date exactly five days
    update restricted.data_requests d set status = 'awaiting_identity' where d.id = q_x.id returning * into q_x;
    if q_x.paused_at is null or q_x.due_at <> v_due then
      raise exception '0120: stopping the clock did not stamp paused_at, or moved the date at once';
    end if;
    update restricted.data_requests d set paused_at = d.paused_at - interval '5 days 1 hour'
     where d.id = q_x.id returning * into q_x;
    update restricted.data_requests d set status = 'awaiting_clarification' where d.id = q_x.id returning * into q_x;
    if q_x.paused_at > now() - interval '5 days' then
      raise exception '0120: moving from waiting for identity to waiting for clarification restarted the pause';
    end if;
    update restricted.data_requests d set status = 'in_progress' where d.id = q_x.id returning * into q_x;
    if q_x.paused_days <> 5 or q_x.paused_at is not null
       or (q_x.due_at at time zone 'Europe/London')::date - (v_due at time zone 'Europe/London')::date <> 5
       or (q_x.due_at at time zone 'Europe/London')::time <> (v_due at time zone 'Europe/London')::time then
      raise exception '0120: a pause of 5 days moved due_at from % to % (% days counted)', v_due, q_x.due_at, q_x.paused_days;
    end if;
    v_due := q_x.due_at;
    update restricted.data_requests d set status = 'awaiting_clarification' where d.id = q_x.id;
    update restricted.data_requests d set paused_at = d.paused_at - interval '23 hours' where d.id = q_x.id;
    update restricted.data_requests d set status = 'in_progress' where d.id = q_x.id returning * into q_x;
    if q_x.paused_days <> 5 or q_x.due_at <> v_due then
      raise exception '0120: a pause of under a day moved the due date';
    end if;

    -- confirming identity restarts the clock, and the days before it no longer count
    update restricted.data_requests d set identity_confirmed_at = now() where d.id = q_x.id returning * into q_x;
    if q_x.paused_days <> 0
       or q_x.due_at is distinct from ((q_x.identity_confirmed_at at time zone 'Europe/London') + interval '1 month') at time zone 'Europe/London' then
      raise exception '0120: confirming identity did not restart the clock from the confirmation: due %, % days', q_x.due_at, q_x.paused_days;
    end if;

    -- extensions: at most two further months, with a reason, after the date they extend
    select * into v_clock from restricted.data_request_clock(q_x.kind, q_x.received_at, q_x.identity_confirmed_at, q_x.paused_days);
    foreach f in array array[
      format('update restricted.data_requests set extended_until = %L::timestamptz + interval ''1 minute'', extension_reason = ''complex'' where id = %L',
             v_clock.latest_extension, q_x.id),
      format('update restricted.data_requests set extended_until = %L::timestamptz, extension_reason = null where id = %L',
             v_clock.latest_extension, q_x.id),
      format('update restricted.data_requests set extended_until = %L::timestamptz, extension_reason = '' '' where id = %L',
             v_clock.latest_extension, q_x.id),
      format('update restricted.data_requests set extended_until = %L::timestamptz, extension_reason = ''complex'' where id = %L',
             v_clock.base_due_at, q_x.id),
      format('update restricted.data_requests set kind = ''erasure'' where id = %L', q_x.id),
      format('update restricted.data_requests set received_at = received_at - interval ''1 day'' where id = %L', q_x.id),
      format('update restricted.data_requests set identity_confirmed_at = received_at - interval ''1 day'' where id = %L', q_x.id)] loop
      begin
        execute f;
        raise exception '0120: this was accepted: %', f;
      exception when check_violation then null;
      end;
    end loop;
    update restricted.data_requests d
       set extended_until = v_clock.latest_extension, extension_reason = 'several systems to search'
     where d.id = q_x.id returning * into q_x;
    if q_x.due_at <> v_clock.latest_extension
       or (q_x.due_at at time zone 'Europe/London')::date <> ((q_x.identity_confirmed_at at time zone 'Europe/London') + interval '3 months')::date then
      raise exception '0120: an extension to exactly three months was not taken as the due date: %', q_x.due_at;
    end if;

    -- closing stamps closed_at, and only a closed status carries one
    update restricted.data_requests d set status = 'completed', outcome = 'sent' where d.id = q_x.id returning * into q_x;
    if q_x.closed_at is null then
      raise exception '0120: a completed request has no closed_at';
    end if;
    update restricted.data_requests d set status = 'in_progress' where d.id = q_x.id returning * into q_x;
    if q_x.closed_at is not null then
      raise exception '0120: an open request kept its closed_at';
    end if;

    -- ============================================== retention: report, change nothing
    insert into restricted.data_requests (kind, requester_name, requester_email)
      values ('erasure', '0120 Owner', 't120-owner@example.invalid') returning id into q_old;
    update restricted.data_requests d set status = 'completed', outcome = 'erased', closed_at = now() - interval '7 years'
     where d.id = q_old;
    insert into restricted.data_requests (tenant_id, kind, requester_name, requester_email)
      values (o_body, 'objection', '0120 Owner', 't120-owner@example.invalid') returning id into q_ten;
    update restricted.data_requests d set status = 'refused', outcome = 'no', closed_at = now() - interval '7 years'
     where d.id = q_ten;
    insert into restricted.retention_schedule (tenant_id, record_class, keep_for, anchor, action, basis)
      values (o_body, 'data_requests', interval '1 day', 'closed', 'delete', '0120 self-test');
    update restricted.retention_schedule s set approved_by = '0120 self-test', approved_on = current_date
     where s.record_class = 'data_requests' and s.tenant_id is null;
    insert into audit_log (actor, action, subject, subject_id, created_at) values
      (null, 't120.old',     't120', 'old',     now() - interval '3 years'),
      (null, 'privacy.t120', 't120', 'privacy', now() - interval '3 years'),
      (null, 'org.t120',     't120', 'org',     now() - interval '7 years'),
      (null, 't120.recent',  't120', 'recent',  now() - interval '1 year');

    select count(*) into v_n from restricted.data_requests;
    select count(*) into v_sched from restricted.retention_schedule;
    select count(*) into v_n2 from audit_log a where a.action <> 'privacy.retention';
    j := restricted.run_retention(false);
    if j->>'mode' <> 'report' or jsonb_array_length(j->'classes') <> v_sched then
      raise exception '0120: run_retention(false) did not report once per schedule row: %', left(j::text, 300);
    end if;
    if exists (select 1 from jsonb_array_elements(j->'classes') x where (x->>'acted')::int <> 0) then
      raise exception '0120: run_retention(false) says it acted';
    end if;
    select x into e from jsonb_array_elements(j->'classes') x
     where x->>'record_class' = 'data_requests' and x->>'tenant_id' is null;
    if e is null or not (e->>'approved')::boolean or not (e->>'built')::boolean or (e->>'eligible')::int < 1 then
      raise exception '0120: the approved platform rule for data_requests did not count the seven-year-old request: %', e;
    end if;
    /* the test body is the only tenant with a rule of its own, so the platform
       default counts every old closed request except the test body's */
    if (select count(*) from restricted.data_requests d
         where d.closed_at < now() - interval '6 years' and d.tenant_id is distinct from o_body)
       <> (e->>'eligible')::int then
      raise exception '0120: the platform rule counted % requests, including a tenant''s that its own rule governs', e->>'eligible';
    end if;
    select x into e from jsonb_array_elements(j->'classes') x
     where x->>'record_class' = 'data_requests' and x->>'tenant_id' = o_body::text;
    if e is null or (e->>'eligible')::int <> 1 or (e->>'approved')::boolean then
      raise exception '0120: a tenant''s own rule did not count exactly its own two-day-old request: %', e;
    end if;
    select x into e from jsonb_array_elements(j->'classes') x where x->>'record_class' = 'audit_log.accountability';
    if (e->>'eligible')::int < 1 then
      raise exception '0120: the accountability class did not count a seven-year-old org row';
    end if;
    select x into e from jsonb_array_elements(j->'classes') x where x->>'record_class' = 'person_contacts';
    if (e->>'built')::boolean or e->>'eligible' is not null then
      raise exception '0120: a class whose table is not built yet reported a count: %', e;
    end if;
    if (select count(*) from restricted.data_requests) <> v_n
       or (select count(*) from restricted.retention_schedule) <> v_sched
       or (select count(*) from audit_log a where a.action <> 'privacy.retention') <> v_n2
       or not exists (select 1 from restricted.data_requests d where d.id = q_old)
       or not exists (select 1 from audit_log a where a.subject = 't120' and a.subject_id = 'org') then
      raise exception '0120: RUN_RETENTION(FALSE) CHANGED ROWS';
    end if;
    if (select count(*) from audit_log a where a.action = 'privacy.retention' and a.created_at = now()) <> v_sched
       or exists (select 1 from audit_log a where a.action = 'privacy.retention' and a.created_at = now()
                   and a.detail::text like '%t120-owner%') then
      raise exception '0120: run_retention did not leave one privacy.retention row per schedule row, without names';
    end if;
    begin
      perform restricted.run_retention(true);
      raise exception '0120: run_retention(true) ran before 0124';
    exception when feature_not_supported then null;
    end;

    -- ================================================= prune_audit_log's classes
    perform public.prune_audit_log();
    select string_agg(a.subject_id, ',' order by a.subject_id) into v_txt from audit_log a where a.subject = 't120';
    if v_txt is distinct from 'privacy,recent' then
      raise exception '0120: prune_audit_log left [%]; it should keep the three-year-old privacy row and the recent one only', v_txt;
    end if;

    -- every call, for the refusals below
    calls_all := array[
      'select 1 from restricted.data_requests limit 1',
      'select 1 from restricted.retention_schedule limit 1',
      'insert into restricted.data_requests (kind, requester_name, requester_email) values (''access'', ''0120 x'', ''t120-x@example.invalid'')',
      'select restricted.run_retention(false)',
      'select restricted.data_request_clock(''access'', now(), null, 0)',
      'select public.privacy_queue(null)',
      format('select public.update_data_request(%L::uuid, ''acknowledge'', ''{}''::jsonb)', q_c.id),
      format('select public.intake_data_request(%L::jsonb)',
             jsonb_build_object('kind', 'access', 'name', '0120 Browser', 'email', 't120-browser@example.invalid')),
      'select public.prune_audit_log()',
      'select public.platform_prune_audit(3650)',
      'select public.notify_data_requests()'];
    calls_anon := array[
      'select public.submit_data_request(''access'', ''0120'', null)',
      'select public.my_data_requests()',
      format('insert into public.audit_log (actor, action, subject) values (%L, ''t120.anon'', ''t120'')', u_admin),
      'insert into public.audit_log (actor, action, subject) values (null, ''t120.anon'', ''t120'')'];

    -- ========================================================== signed out
    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    foreach f in array calls_all || calls_anon loop
      begin
        execute f;
        raise exception '0120: signed out, this ran: %', f;
      exception when insufficient_privilege then null;
      end;
    end loop;
    execute format('set local role %I', orig);

    -- ========================================================== a signed-in stranger
    perform set_config('request.jwt.claims',
      json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
    set local role authenticated;
    foreach f in array calls_all || array[
      format('insert into public.audit_log (actor, action, subject) values (%L, ''t120.forged'', ''t120'')', u_admin),
      'insert into public.audit_log (actor, action, subject) values (null, ''t120.forged'', ''t120'')',
      format('insert into public.audit_log (actor, action, subject) values (%L, ''privacy.erase'', ''t120'')', u_out),
      format('insert into public.audit_log (actor, action, subject) values (%L, ''org.create'', ''t120'')', u_out),
      format('insert into public.audit_log (actor, action, subject) values (%L, ''Person.read_contacts'', ''t120'')', u_out),
      format('insert into public.audit_log (actor, action, subject) values (%L, '' privacy.erase'', ''t120'')', u_out),
      format('insert into public.audit_log (actor, action, subject, tenant_id) values (%L, ''t120.note'', ''t120'', %L)', u_out, o_body),
      format('insert into public.audit_log (actor, action, subject, person_id) values (%L, ''t120.note'', ''t120'', %L)', u_out, gen_random_uuid()),
      format('insert into public.audit_log (actor, action, subject, created_at) values (%L, ''t120.note'', ''t120'', now() - interval ''9 years'')', u_out)] loop
      begin
        execute f;
        raise exception '0120: a signed-in stranger ran: %', f;
      exception
        when insufficient_privilege then null;
        when foreign_key_violation then
          raise exception '0120: A SIGNED-IN STRANGER GOT AS FAR AS WRITING AN AUDIT ROW; only the actor''s key stopped it: %', f;
      end;
    end loop;
    begin
      perform public.submit_data_request('access', '0120', null);
      raise exception '0120: an account with no address submitted a request';
    exception when invalid_parameter_value then null;
    end;
    if public.my_data_requests() <> '[]'::jsonb then
      raise exception '0120: a signed-in stranger sees requests: %', public.my_data_requests();
    end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);

    -- ========================================================== the service role
    begin
      perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
      set local role service_role;
    exception when insufficient_privilege then
      have_service := false;
      service_half := 'NOT RUN: ' || who || ' may not set role service_role';
    end;

    if have_service then
      j := public.intake_data_request(jsonb_build_object(
             'kind', 'Erasure', 'name', '  0120 Form  ', 'email', ' T120-Form@Example.invalid ',
             'capacity', 'guardian', 'details', 'please remove my child''s profile'));
      i1 := (j->>'id')::uuid;
      if j->>'reference' <> upper(left(i1::text, 8)) or j->>'kind' <> 'erasure' or j->>'ack_due_at' is not null then
        raise exception '0120: intake answered %', j;
      end if;
      foreach f in array array[
        jsonb_build_object('kind', 'gossip', 'name', '0120 Form', 'email', 't120-form2@example.invalid')::text,
        jsonb_build_object('kind', 'access', 'name', '0120 Form', 'email', 'not-an-address')::text,
        jsonb_build_object('kind', 'access', 'name', '   ', 'email', 't120-form2@example.invalid')::text,
        jsonb_build_object('kind', 'access', 'name', '0120 Form', 'email', 't120-form2@example.invalid', 'capacity', 'friend')::text,
        jsonb_build_object('kind', 'access', 'name', '0120 Form', 'email', 't120-form2@example.invalid', 'tenant_id', o_region)::text,
        jsonb_build_object('kind', 'access', 'name', '0120 Form', 'email', 't120-form2@example.invalid', 'tenant_id', o_hidden)::text,
        jsonb_build_object('kind', 'access', 'name', '0120 Form', 'email', 't120-form2@example.invalid', 'tenant_id', 'nope')::text,
        jsonb_build_object('kind', 'access', 'name', '0120 Form', 'email', 't120-form2@example.invalid', 'details', repeat('x', 4001))::text,
        '[]'] loop
        begin
          perform public.intake_data_request(f::jsonb);
          raise exception '0120: intake accepted %', left(f, 160);
        exception when invalid_parameter_value then null;
        end;
      end loop;
      j := public.intake_data_request(jsonb_build_object(
             'kind', 'complaint', 'name', '0120 Form', 'email', 't120-form@example.invalid', 'tenant_id', o_body));
      i2 := (j->>'id')::uuid;
      perform public.intake_data_request(jsonb_build_object(
             'kind', 'access', 'name', '0120 Form', 'email', 't120-form@example.invalid'));
      begin
        perform public.intake_data_request(jsonb_build_object(
               'kind', 'access', 'name', '0120 Form', 'email', 'T120-FORM@example.invalid'));
        raise exception '0120: a fourth signed-out request from one address in 24 hours was taken';
      exception when program_limit_exceeded then null;
      end;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      select * into q_x from restricted.data_requests d where d.id = i1;
      if q_x.requester_email <> 't120-form@example.invalid' or q_x.requester_name <> '0120 Form'
         or q_x.requester_user is not null or q_x.capacity <> 'guardian' or q_x.tenant_id is not null
         or q_x.status <> 'received'
         or q_x.due_at is distinct from ((q_x.received_at at time zone 'Europe/London') + interval '1 month') at time zone 'Europe/London' then
        raise exception '0120: the signed-out request was stored as %', to_jsonb(q_x);
      end if;
      if (select d.tenant_id from restricted.data_requests d where d.id = i2) is distinct from o_body
         or not exists (select 1 from audit_log a where a.action = 'privacy.request' and a.subject_id = i1::text
                         and a.actor is null and a.detail->>'via' = 'form' and a.tenant_id is null
                         and a.detail::text not like '%t120-form%' and a.detail::text not like '%0120 Form%') then
        raise exception '0120: intake did not keep the tenant, or left no nameless privacy.request row';
      end if;
    end if;

    -- ======================================================= the accounts: fresh, or borrowed
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_admin, 't120-admin@example.invalid'),
                     (u_a,     't120-a@example.invalid'),
                     (u_b,     't120-b@example.invalid')) as x(id, email);
    exception when insufficient_privilege then
      have_users := false;
    end;

    if not have_users then
      /* Real people, borrowed for the length of a rolled-back block: nothing
         below is ever committed. Only accounts that hold no role, no writer
         seat and no official's seat, so every expectation is the same as for a
         fresh account. */
      select array_agg(x.id) into borrowed
        from (select p.id from public.profiles p
                join auth.users u on u.id = p.id and coalesce(u.email, '') <> ''
               where not exists (select 1 from public.memberships m where m.user_id = p.id)
                 and not exists (select 1 from public.league_writers w where w.user_id = p.id)
                 and not exists (select 1 from public.game_officials go where go.user_id = p.id)
               order by p.created_at
               limit 3) x;
      if coalesce(cardinality(borrowed), 0) = 3 then
        u_admin := borrowed[1];
        u_a     := borrowed[2];
        u_b     := borrowed[3];
        have_users := true;
        half := 'three borrowed profiles';
      else
        half := 'NOT RUN: ' || who || ' may not create auth.users rows and only '
                || coalesce(cardinality(borrowed), 0) || ' of 3 clean profiles exist';
      end if;
    end if;

    if have_users then
      insert into memberships (user_id, role, scope_type, scope_id) values (u_admin, 'platform_admin', 'platform', null);
      select lower(btrim(u.email)) into e_a from auth.users u where u.id = u_a;
      select lower(btrim(u.email)) into e_b from auth.users u where u.id = u_b;
      select lower(btrim(u.email)) into e_admin from auth.users u where u.id = u_admin;
      insert into audit_log (actor, action, subject, subject_id, created_at) values
        (null, 'privacy.t120b', 't120', 'privacy-1y', now() - interval '1 year'),
        (null, 't120.old2',     't120', 'old-1y',     now() - interval '1 year');
      /* three signed-out requests somebody else made with u_a's address today:
         not u_a's to read, and no bar to u_a's own requests */
      insert into restricted.data_requests (kind, requester_name, requester_email)
        select 'objection', '0120 Somebody else', e_a from generate_series(1, 3);

      -- ======================================================== a league admin who manages a team
      insert into leagues (slug, name) values ('zz-t120-league', '0120 League') returning id into t_league;
      insert into teams (league_id, slug, name) values (t_league, 'zz-t120-team', '0120 Team') returning id into t_team;
      insert into memberships (user_id, role, scope_type, scope_id) values
        (u_b, 'league_admin', 'league', t_league), (u_b, 'team_manager', 'team', t_team);
      perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
      set local role authenticated;
      foreach f in array array[
        'select public.privacy_queue(null)',
        format('select public.privacy_queue(%L::uuid)', o_body),
        format('select public.update_data_request(%L::uuid, ''acknowledge'', ''{}''::jsonb)', q_c.id),
        'select public.platform_prune_audit(3650)'] loop
        begin
          execute f;
          raise exception '0120: A LEAGUE ADMIN AND TEAM MANAGER RAN: %', f;
        exception when insufficient_privilege then null;
        end;
      end loop;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
      delete from memberships m where m.user_id = u_b and m.scope_id in (t_league, t_team);

      -- ======================================================== a signed-in user
      perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
      set local role authenticated;

      begin
        j := public.submit_data_request('access', 'What do you hold about me?', null);
      exception when program_limit_exceeded then
        raise exception '0120: SOMEBODY ELSE''S SIGNED-OUT REQUESTS UNDER THIS ADDRESS BLOCKED THE ACCOUNT''S OWN REQUEST';
      end;
      a1 := (j->>'id')::uuid;
      if j->>'reference' <> upper(left(a1::text, 8)) or j->>'status' <> 'received' or j->>'ack_due_at' is not null
         or (j->>'due_at')::timestamptz is distinct from
            (((j->>'received_at')::timestamptz at time zone 'Europe/London') + interval '1 month') at time zone 'Europe/London' then
        raise exception '0120: a signed-in access request answered %', j;
      end if;
      j := public.submit_data_request(' Complaint ', 'You published my photo', o_body);
      a2 := (j->>'id')::uuid;
      if (j->>'ack_due_at')::timestamptz is distinct from
         (((j->>'received_at')::timestamptz at time zone 'Europe/London') + interval '30 days') at time zone 'Europe/London' then
        raise exception '0120: a signed-in complaint is not acknowledged within exactly 30 days: %', j;
      end if;
      foreach f in array array[
        'select public.submit_data_request(''gossip'', '''', null)',
        format('select public.submit_data_request(''access'', '''', %L::uuid)', o_region),
        format('select public.submit_data_request(''access'', '''', %L::uuid)', o_hidden),
        format('select public.submit_data_request(''access'', '''', %L::uuid)', gen_random_uuid()),
        format('select public.submit_data_request(''access'', %L, null)', repeat('x', 4001))] loop
        begin
          execute f;
          raise exception '0120: a signed-in user''s bad request was accepted: %', left(f, 120);
        exception when invalid_parameter_value then null;
        end;
      end loop;

      j := public.my_data_requests();
      if jsonb_array_length(j) <> 2
         or (select count(*) from jsonb_array_elements(j) x where x->>'id' in (a1::text, a2::text)) <> 2 then
        raise exception '0120: a user''s own requests read back as %', j;
      end if;
      if exists (select 1 from jsonb_array_elements(j) x
                  where x ? 'requester_email' or x ? 'details' or x ? 'outcome' or x ? 'assigned_to') then
        raise exception '0120: my_data_requests shows handler fields';
      end if;
      if (select x->>'organisation' from jsonb_array_elements(j) x where x->>'id' = a2::text) <> '0120 Body' then
        raise exception '0120: my_data_requests does not name the controller';
      end if;

      foreach f in array calls_all loop
        begin
          execute f;
          raise exception '0120: a signed-in user ran: %', f;
        exception when insufficient_privilege then null;
        end;
      end loop;
      execute format('insert into public.audit_log (actor, action, subject, subject_id) values (%L, ''t120.note'', ''t120'', ''own'')', u_a);
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception '0120: a signed-in user could not write an ordinary audit row as themselves';
      end if;
      /* the same forgeries as the stranger's, by an account that exists, so the
         only thing that can refuse them is the policy (not the actor's key) */
      foreach f in array array[
        format('insert into public.audit_log (actor, action, subject) values (%L, ''t120.forged'', ''t120'')', u_b),
        format('insert into public.audit_log (actor, action, subject) values (%L, ''privacy.close'', ''t120'')', u_a),
        format('insert into public.audit_log (actor, action, subject) values (%L, ''Privacy.Close'', ''t120'')', u_a),
        format('insert into public.audit_log (actor, action, subject) values (%L, '' privacy.erase'', ''t120'')', u_a),
        format('insert into public.audit_log (actor, action, subject) values (%L, ''T120.note'', ''t120'')', u_a),
        format('insert into public.audit_log (actor, action, subject, tenant_id) values (%L, ''t120.note'', ''t120'', %L)', u_a, o_body),
        format('insert into public.audit_log (actor, action, subject, person_id) values (%L, ''t120.note'', ''t120'', %L)', u_a, gen_random_uuid()),
        format('insert into public.audit_log (actor, action, subject, created_at) values (%L, ''t120.note'', ''t120'', now() - interval ''9 years'')', u_a),
        format('insert into public.audit_log (actor, action, subject, created_at) values (%L, ''t120.note'', ''t120'', now() + interval ''1 day'')', u_a)] loop
        begin
          execute f;
          raise exception '0120: A SIGNED-IN USER FORGED AN AUDIT ROW: %', f;
        exception when insufficient_privilege then null;
        end;
      end loop;

      perform public.submit_data_request('objection', '', null);
      begin
        perform public.submit_data_request('access', '', null);
        raise exception '0120: a fourth signed-in request in 24 hours was taken';
      exception when program_limit_exceeded then null;
      end;

      -- ======================================================== another user
      perform set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
      j := public.submit_data_request('portability', '', null);
      b1 := (j->>'id')::uuid;
      j := public.my_data_requests();
      if jsonb_array_length(j) <> 1 or j->0->>'id' <> b1::text then
        raise exception '0120: A USER READS ANOTHER USER''S REQUESTS: %', j;
      end if;
      execute format('insert into public.audit_log (actor, action, subject, subject_id) values (%L, ''t120.note'', ''t120'', ''b'')', u_b);

      -- ======================================================== the platform admin
      perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);

      j := public.privacy_queue(null);
      if (select count(*) from jsonb_array_elements(j->'requests') x where x->>'id' in (a1::text, b1::text)) <> 2
         or exists (select 1 from jsonb_array_elements(j->'requests') x where x->>'id' = a2::text) then
        raise exception '0120: Epinoia''s queue does not hold exactly its own requests';
      end if;
      select x into e from jsonb_array_elements(j->'requests') x where x->>'id' = a1::text;
      if e->>'requester_email' <> e_a or not (e->>'requester_has_account')::boolean or e->>'kind' <> 'access'
         or e->>'latest_extension' is null or not (e->>'open')::boolean or (e->>'overdue')::boolean then
        raise exception '0120: the queue shows a1 as %', e;
      end if;
      if (j->'counts'->>'open')::int < 2
         or not exists (select 1 from jsonb_array_elements(j->'handlers') x where x->>'user_id' = u_admin::text)
         or not exists (select 1 from jsonb_array_elements(j->'tenants') x
                         where x->>'id' = o_body::text and (x->>'open')::int >= 1)
         or exists (select 1 from jsonb_array_elements(j->'tenants') x where x->>'id' = o_region::text) then
        raise exception '0120: the queue''s counts, handlers or tenants are wrong: %', left(j::text, 400);
      end if;
      j := public.privacy_queue(o_body);
      if not exists (select 1 from jsonb_array_elements(j->'requests') x where x->>'id' = a2::text)
         or exists (select 1 from jsonb_array_elements(j->'requests') x where x->>'id' = a1::text)
         or j->'tenant'->>'name' <> '0120 Body' then
        raise exception '0120: a tenant''s queue does not hold exactly its own requests';
      end if;

      foreach f in array array[
        format('select public.privacy_queue(%L::uuid)', o_region),
        format('select public.update_data_request(%L::uuid, ''delete'', ''{}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''acknowledge'', ''{}''::jsonb)', gen_random_uuid()),
        format('select public.update_data_request(%L::uuid, ''acknowledge'', ''[]''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''pause'', ''{}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''resume'', ''{}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''extend'', ''{"until": "2099-01-01"}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''extend'', ''{"until": "soon", "reason": "x"}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''extend'', ''{"reason": "x"}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''assign'', %L::jsonb)', a1, jsonb_build_object('user_id', u_b)),
        format('select public.update_data_request(%L::uuid, ''assign'', ''{"user_id": "nope"}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''assign'', ''{"email": "t120-nobody@example.invalid"}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''close'', ''{"status": "completed"}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''close'', ''{"status": "done", "outcome": "x"}''::jsonb)', a1)] loop
        begin
          execute f;
          raise exception '0120: the console''s bad call was accepted: %', f;
        exception when invalid_parameter_value then null;
        end;
      end loop;

      j := public.update_data_request(a1, 'acknowledge', '{}');
      if j->>'acknowledged_at' is null or j->>'status' <> 'in_progress' then
        raise exception '0120: acknowledging answered %', j;
      end if;
      j := public.update_data_request(a1, 'pause', '{"reason": "identity"}');
      if j->>'status' <> 'awaiting_identity' or j->>'paused_at' is null then
        raise exception '0120: pausing for identity answered %', j;
      end if;
      v_due := (j->>'due_at')::timestamptz;
      foreach f in array array[
        format('select public.update_data_request(%L::uuid, ''acknowledge'', ''{}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''pause'', ''{"reason": "identity"}''::jsonb)', a1)] loop
        begin
          execute f;
          raise exception '0120: this was accepted twice: %', f;
        exception when invalid_parameter_value then null;
        end;
      end loop;

      execute format('set local role %I', orig);
      update restricted.data_requests d set paused_at = d.paused_at - interval '5 days 1 hour' where d.id = a1;
      set local role authenticated;

      j := public.update_data_request(a1, 'resume', '{}');
      if (j->>'paused_days')::int <> 5 or j->>'status' <> 'in_progress'
         or ((j->>'due_at')::timestamptz at time zone 'Europe/London')::date - (v_due at time zone 'Europe/London')::date <> 5 then
        raise exception '0120: through the console, a 5-day pause moved due_at from % to %', v_due, j->>'due_at';
      end if;

      execute format('set local role %I', orig);
      select c.latest_extension into v_latest
        from restricted.data_requests d,
             restricted.data_request_clock(d.kind, d.received_at, d.identity_confirmed_at, d.paused_days) c
       where d.id = a1;
      set local role authenticated;
      begin
        perform public.update_data_request(a1, 'extend', jsonb_build_object(
          'until', to_char((v_latest at time zone 'Europe/London')::date + 1, 'YYYY-MM-DD'), 'reason', 'complex'));
        raise exception '0120: AN EXTENSION BEYOND THREE MONTHS WAS ACCEPTED';
      exception when invalid_parameter_value then null;
      end;
      j := public.update_data_request(a1, 'extend', jsonb_build_object(
        'until', to_char((v_latest at time zone 'Europe/London')::date, 'YYYY-MM-DD'), 'reason', 'several systems to search'));
      if (j->>'extended_until')::timestamptz <> v_latest or (j->>'due_at')::timestamptz <> v_latest then
        raise exception '0120: extending to the last allowed day gave %, not %', j->>'extended_until', v_latest;
      end if;

      j := public.update_data_request(a1, 'confirm_identity', '{}');
      if j->>'identity_confirmed_at' is null or (j->>'paused_days')::int <> 0 or j->>'status' <> 'in_progress' then
        raise exception '0120: confirming identity answered %', j;
      end if;
      foreach f in array array[
        format('select public.update_data_request(%L::uuid, ''confirm_identity'', ''{}''::jsonb)', a1),
        format('select public.update_data_request(%L::uuid, ''pause'', ''{"reason": "identity"}''::jsonb)', a1)] loop
        begin
          execute f;
          raise exception '0120: accepted after identity was confirmed: %', f;
        exception when invalid_parameter_value then null;
        end;
      end loop;
      j := public.update_data_request(a1, 'pause', '{"reason": "clarification"}');
      j := public.update_data_request(a1, 'resume', '{}');

      j := public.update_data_request(a1, 'assign', jsonb_build_object('email', upper(e_admin)));
      if j->>'assigned_to' <> u_admin::text then
        raise exception '0120: assigning by address answered %', j;
      end if;
      j := public.update_data_request(a1, 'close', '{"status": "completed", "outcome": "Copy of the data sent by email."}');
      if j->>'closed_at' is null or j->>'status' <> 'completed' then
        raise exception '0120: closing answered %', j;
      end if;
      begin
        perform public.update_data_request(a1, 'assign', '{}');   -- would succeed on an open request
        raise exception '0120: a closed request took another action';
      exception when invalid_parameter_value then null;
      end;
      j := public.update_data_request(b1, 'close', '{"status": "withdrawn"}');

      j := public.privacy_queue(null);
      select x into e from jsonb_array_elements(j->'requests') x where x->>'id' = a1::text;
      if (e->>'open')::boolean or e->>'outcome' <> 'Copy of the data sent by email.' or e->>'assigned_email' is null
         or (j->'counts'->>'closed')::int < 2 then
        raise exception '0120: the queue does not show the closed request: %', e;
      end if;

      -- the trail: every action, each naming the request, never the requester
      select count(distinct a.action) into v_n from audit_log a
       where a.subject = 'data_request' and a.subject_id = a1::text and a.actor = u_admin
         and a.action in ('privacy.acknowledge', 'privacy.pause', 'privacy.resume', 'privacy.extend',
                          'privacy.confirm_identity', 'privacy.assign', 'privacy.close');
      if v_n <> 7 then
        raise exception '0120: % of the 7 handling actions left an audit row', v_n;
      end if;
      if exists (select 1 from audit_log a
                  where a.subject = 'data_request' and a.subject_id in (a1::text, a2::text, b1::text)
                    and (a.detail::text ilike '%' || e_a || '%' or a.detail::text ilike '%' || e_b || '%'
                         or a.detail::text like '%What do you hold%' or a.detail ? 'requester_name')) then
        raise exception '0120: an audit row names the requester, their address or their words';
      end if;
      if (select a.tenant_id from audit_log a where a.action = 'privacy.request' and a.subject_id = a2::text) is distinct from o_body then
        raise exception '0120: a tenant''s request was audited without its tenant';
      end if;
      if (select count(*) from audit_log a
           where a.action = 'privacy.request' and a.subject_id in (a1::text, a2::text, b1::text)
             and a.actor is null and a.detail->>'via' = 'signed_in') <> 3 then
        raise exception '0120: a signed-in request''s audit row is missing, or names the account that made it';
      end if;
      -- the console's Audit tab still reads the log, new columns and all (0044)
      select count(*) into v_n from public.platform_audit('privacy.close', 50, 0) x where x.subject_id = a1::text;
      if v_n <> 1 then
        raise exception '0120: platform_audit no longer reads the privacy.close row (% rows)', v_n;
      end if;

      -- the console's prune keeps the accountability classes
      v_txt := public.platform_prune_audit(30);
      if not exists (select 1 from audit_log a where a.subject = 't120' and a.subject_id = 'privacy-1y')
         or exists (select 1 from audit_log a where a.subject = 't120' and a.subject_id = 'old-1y') then
        raise exception '0120: platform_prune_audit(30) removed a privacy row or kept an ordinary one: %', v_txt;
      end if;

      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      -- ======================================================== the reminders
      /* as the owner, u_a becomes a second platform admin, so "every platform
         admin" and "the assignee" differ; then seven requests with dates in the
         past (received_at may be given on insert): due within seven days and
         assigned to u_admin; due in eight days or more; a complaint
         unacknowledged past its 30 days and unassigned; the same complaint
         acknowledged; overdue with its clock stopped; overdue and closed;
         overdue and assigned to u_b, who holds no platform role */
      insert into memberships (user_id, role, scope_type, scope_id) values (u_a, 'platform_admin', 'platform', null);
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at, assigned_to)
        values ('access', '0120 Remind', 't120-remind@example.invalid', now() - interval '26 days', u_admin)
        returning id into r_soon;
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at, assigned_to)
        values ('access', '0120 Remind', 't120-remind@example.invalid', now() - interval '20 days', u_admin)
        returning id into r_later;
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at)
        values ('complaint', '0120 Remind', 't120-remind@example.invalid', now() - interval '32 days')
        returning id into r_ack;
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at, acknowledged_at, status)
        values ('complaint', '0120 Remind', 't120-remind@example.invalid', now() - interval '32 days',
                now() - interval '31 days', 'in_progress')
        returning id into r_acked;
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at, assigned_to, status)
        values ('erasure', '0120 Remind', 't120-remind@example.invalid', now() - interval '40 days', u_admin,
                'awaiting_clarification')
        returning id into r_stopped;
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at, assigned_to, status, outcome)
        values ('access', '0120 Remind', 't120-remind@example.invalid', now() - interval '40 days', u_admin,
                'completed', 'sent')
        returning id into r_closed;
      insert into restricted.data_requests (kind, requester_name, requester_email, received_at, assigned_to)
        values ('rectification', '0120 Remind', 't120-remind@example.invalid', now() - interval '40 days', u_b)
        returning id into r_stray;
      select count(distinct m.user_id) into v_admins from memberships m where m.role = 'platform_admin';

      if have_service then
        perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        set local role service_role;
      end if;
      v_n := public.notify_data_requests();
      v_n2 := public.notify_data_requests();
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      if v_admins < 2 then
        raise exception '0120: the reminder test needs two platform admins, and has %', v_admins;
      end if;
      if v_n2 <> 0 or v_n < 1 + 2 * v_admins then
        raise exception '0120: the reminders wrote % and then % more (want at least % and then none)', v_n, v_n2, 1 + 2 * v_admins;
      end if;
      if (select count(*) from notifications nt where nt.ref like 'privacy:' || r_soon || ':%') <> 1
         or not exists (select 1 from notifications nt, restricted.data_requests d
                         where d.id = r_soon and nt.user_id = u_admin and nt.kind = 'privacy'
                           and nt.ref = format('privacy:%s:due:soon:%s', r_soon,
                                               to_char(d.due_at at time zone 'Europe/London', 'YYYY-MM-DD"T"HH24:MI'))
                           and nt.link = 'admin/platform/#priv'
                           and nt.title like '%' || upper(left(r_soon::text, 8)) || '%') then
        raise exception '0120: a request due within seven days did not remind its assignee, once';
      end if;
      if (select count(*) from notifications nt where nt.ref like 'privacy:' || r_ack || ':%') <> v_admins
         or not exists (select 1 from notifications nt
                         where nt.user_id = u_admin
                           and nt.ref = format('privacy:%s:ack:overdue:%s', r_ack,
                                               to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM-DD'))) then
        raise exception '0120: an unassigned complaint past its acknowledgement date did not remind every platform admin, once today';
      end if;
      if (select count(*) from notifications nt where nt.ref like 'privacy:' || r_stray || ':due:overdue:%') <> v_admins
         or exists (select 1 from notifications nt where nt.ref like 'privacy:' || r_stray || ':%' and nt.user_id = u_b) then
        raise exception '0120: a request assigned to somebody without the platform role did not go to the platform admins instead';
      end if;
      if exists (select 1 from notifications nt
                  where nt.ref like 'privacy:' || r_stopped || ':%' or nt.ref like 'privacy:' || r_closed || ':%'
                     or nt.ref like 'privacy:' || r_acked || ':%' or nt.ref like 'privacy:' || r_later || ':%') then
        raise exception '0120: a stopped clock, a closed request, an acknowledged complaint or a date more than seven days out sent a reminder';
      end if;
      if exists (select 1 from notifications nt
                  where nt.kind = 'privacy'
                    and (nt.title || ' ' || nt.body) ~* '(0120 remind|t120-remind|example\.invalid)') then
        raise exception '0120: a reminder names the requester or their address';
      end if;

      half := half || ' (a league admin and team manager refused, the queue, all seven actions and their refusals, '
                   || 'own-request reads, the audit trail, the reminders)';
    end if;

    raise exception using errcode = 'P0120', message = '0120 passed; rolling its test rows back';
  exception
    when sqlstate 'P0120' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  -- ---- afterwards ---------------------------------------------------------------
  if exists (select 1 from restricted.data_requests d
              where d.requester_email like 't120-%@example.invalid' or d.requester_name like '0120 %')
     or exists (select 1 from organisations o where o.slug like 'zz-t120-%')
     or exists (select 1 from leagues l where l.slug like 'zz-t120-%')
     or exists (select 1 from audit_log a where a.subject = 't120')
     or exists (select 1 from audit_log a where a.created_at = now() and a.action like 'privacy.%')
     or exists (select 1 from notifications nt where nt.kind = 'privacy' and nt.created_at = now())
     or exists (select 1 from restricted.retention_schedule s where s.tenant_id is not null or s.approved_by is not null) then
    raise exception '0120: the test rows outlived their rollback';
  end if;

  raise notice '0120 ok (%): anon and authenticated cannot reach the restricted tables or functions; no policy or view reads them; '
               'a complaint is acknowledged within exactly 30 days; a 5-day pause moves due_at 5 days; identity restarts the clock; '
               'an extension past three months is refused; run_retention(false) reports and changes 0 rows', v_mode;
  raise notice '0120 ok: a forged audit row (another actor, an accountability action, a look-alike or re-dated action, a tenant '
               'or person) gets 42501; a league admin cannot reach the queue; one account''s requests cannot be blocked from '
               'another address; prune keeps privacy rows six years; the schedule is seeded and unapproved';
  raise notice '0120: the catalogue, the clock, the owner''s queue, anon and the signed-in stranger ran; the signed-in and admin half '
               'ran with %; the service-role half %', half, service_half;
end $test$;

-- ============================================================================
-- 12. THE ACTOR'S KEY (foundations 7.7, roadmap P0.7), LAST ON PURPOSE
--
-- The audit log's actor key becomes ON DELETE SET NULL. It was a plain
-- reference (0001), so deleting an account that had ever done anything audited
-- failed, and 0067/0068's self-tests had to delete their own audit rows first.
-- Found by what it is rather than by name, dropped, added NOT VALID and then
-- validated, as the contract says.
--
-- DROPPING A FOREIGN KEY TAKES ACCESS EXCLUSIVE ON THE TABLE IT REFERENCES, here
-- auth.users, so from this statement until commit every read of auth.users
-- waits. Everything else in the file, the self-test included, has already run:
-- what remains under that lock is the validation (one pass of audit_log against
-- auth.users), the short test below and the commit.
-- ============================================================================
do $fk$
declare
  v_attnum smallint;
  c record;
begin
  select a.attnum into v_attnum from pg_attribute a
   where a.attrelid = 'public.audit_log'::regclass and a.attname = 'actor' and not a.attisdropped;
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'public.audit_log'::regclass and con.contype = 'f'
              and con.confrelid = 'auth.users'::regclass and con.conkey = array[v_attnum]
              and con.confdeltype <> 'n' loop
    execute format('alter table public.audit_log drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint con
                  where con.conrelid = 'public.audit_log'::regclass and con.contype = 'f'
                    and con.confrelid = 'auth.users'::regclass and con.conkey = array[v_attnum]) then
    alter table public.audit_log
      add constraint audit_log_actor_fkey foreign key (actor) references auth.users (id)
      on delete set null not valid;
  end if;
end $fk$;
alter table public.audit_log validate constraint audit_log_actor_fkey;

/* ITS SELF-TEST: exactly one validated ON DELETE SET NULL key from the actor to
   auth.users; then, where this role may create auth.users rows, a fresh account
   that wrote an audit row, made a request and was assigned it is deleted through
   the console's platform_delete_account by a fresh platform admin, and its audit
   row and its request stay, without it. A borrowed account is never deleted,
   even in a rolled-back block. Rolled back by P0120, as above. */
do $p07$
declare
  who     text := current_user || ' (session ' || session_user || ')';
  orig    text := current_user;
  u_admin uuid := gen_random_uuid();
  u_gone  uuid := gen_random_uuid();
  q_gone  uuid;
  v_n     bigint;
  v_n2    bigint;
  v_txt   text;
  half    text := 'ran with fresh test accounts: deleting an account in the audit log and the queue keeps both, without it';
begin
  select count(*) filter (where con.confdeltype = 'n' and con.convalidated), count(*) into v_n, v_n2
    from pg_constraint con
   where con.conrelid = 'public.audit_log'::regclass and con.contype = 'f'
     and con.confrelid = 'auth.users'::regclass;
  if v_n <> 1 or v_n2 <> 1 then
    raise exception '0120: audit_log.actor must have exactly one validated ON DELETE SET NULL key to auth.users (% of %)', v_n, v_n2;
  end if;

  begin
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_admin, 't120-keyadmin@example.invalid'),
                     (u_gone,  't120-gone@example.invalid')) as x(id, email);
    exception when insufficient_privilege then
      half := 'NOT RUN: ' || who || ' may not create auth.users rows, and a borrowed account is never deleted';
      raise exception using errcode = 'P0120', message = '0120 key test not run';
    end;
    insert into memberships (user_id, role, scope_type, scope_id) values (u_admin, 'platform_admin', 'platform', null);
    insert into audit_log (actor, action, subject, subject_id) values (u_gone, 't120.note', 't120', 'gone');
    insert into restricted.data_requests (kind, requester_user, requester_name, requester_email, assigned_to)
      values ('access', u_gone, '0120 Gone', 't120-gone@example.invalid', u_gone)
      returning id into q_gone;

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_txt := public.platform_delete_account(u_gone, 't120-gone@example.invalid');
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);

    if exists (select 1 from auth.users u where u.id = u_gone) then
      raise exception '0120: platform_delete_account left the account behind: %', v_txt;
    end if;
    if not exists (select 1 from audit_log a where a.subject = 't120' and a.subject_id = 'gone' and a.actor is null)
       or not exists (select 1 from restricted.data_requests d
                       where d.id = q_gone and d.requester_user is null and d.assigned_to is null) then
      raise exception '0120: deleting an account did not keep its audit row and its request without it';
    end if;

    raise exception using errcode = 'P0120', message = '0120 key test passed; rolling its rows back';
  exception
    when sqlstate 'P0120' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from restricted.data_requests d where d.requester_email like 't120-%@example.invalid')
     or exists (select 1 from audit_log a where a.subject = 't120')
     or exists (select 1 from memberships m where m.user_id in (u_admin, u_gone)) then
    raise exception '0120: the key test''s rows outlived their rollback';
  end if;

  raise notice '0120 ok (the actor''s key, last): one validated ON DELETE SET NULL key to auth.users; the account-deletion test %', half;
end $p07$;
