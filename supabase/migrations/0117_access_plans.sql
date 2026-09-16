-- ============================================================================
-- 0117 — WHAT A FAN CAN BUY, AND THE ONE PLACE THAT DECIDES WHETHER THEY HAVE.
--
-- The contract is docs/memberships.md. This file is §2 and §4.1–4.3 of it: the
-- per-league switches, the plan / subscription / grant tables, and the rules
-- that turn "who is this and where are they looking" into a list of features.
-- 0118 is the other half — it points the existing tables, views and RPCs at
-- these rules. Nothing here hides a single row that was visible before.
-- (0116, which applies first, guards direct writes to games; nothing here
-- touches what it defines.)
--
-- AS SHIPPED NOTHING CHANGES FOR ANYONE. Every league defaults to 'open', the
-- platform analytics default is 'free', and no plan exists. The framework is
-- switched on one league at a time, or for analytics by flipping one setting,
-- and only once there is something to buy.
--
-- AND OVER ALL OF IT, ONE MASTER SWITCH. The platform setting
-- memberships_enabled ships FALSE, and while it is false nothing is gated
-- anywhere, whatever a league's access_mode or analytics_access says: every
-- league can be seen and the analytics are free. Leagues and plans can still be
-- set up in the meantime — the settings are kept, and the consoles show what
-- will apply — and a platform administrator switches the whole thing on, once,
-- with platform_set_setting (0044), when there is something to buy.
--
-- THE NAMES. "Membership" already means a person's ROLE (public.memberships)
-- and a FEDERATION REGISTER (membership_eligibility, membership-sync). A third
-- meaning in the same schema is how somebody grants a role while meaning to
-- sell a season pass. So everything new is access_*, and the Edge Function
-- that talks to Stripe is `billing`.
--
-- WHY THE DECISION LIVES IN ONE FUNCTION. access_features_for(user, league) is
-- the only code that knows what counts: staff, a live subscription, a grant.
-- can_view_league, can_use_analytics, access_state and 0118's policies all ask
-- it, so "a past-due card still works for seven days" is written once and a
-- page, a policy and a notification fan-out can never disagree about it.
--
-- WHY OPEN IS DECIDED FIRST. can_view_league is about to sit inside the policy
-- on game_events, the busiest table on the platform. For an open league it
-- must cost one primary-key read of `leagues` and never reach the feature
-- lookup — which is what every league is today.
--
-- AND WHY SECTION 0 COMES BEFORE ANY OF IT. From this file on, being a platform
-- administrator is worth every members-only league and Epinoia's fee, and the
-- memberships table has let a league administrator write that role for
-- themselves since 0001. That is closed first, so nothing below is built on it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PLATFORM ADMIN IS A PLATFORM-SCOPED ROW, AND ONLY A PLATFORM ADMIN WRITES ONE.
--
-- memberships_admin_write (0001) let a league admin write ANY row scoped to
-- their league — including {role: 'platform_admin', scope_type: 'league'} for
-- themselves — and is_platform_admin() never looked at the scope, so that row
-- made them one. Three locks, each enough on its own:
--
--   * the policy: a league admin writes only league_admin and statistician
--     rows in a league they administer. Nothing legitimate writes the table
--     through the API at all — both consoles grant and revoke through
--     grant_role / revoke_role (SECURITY DEFINER, which RLS does not see), and
--     the feed ingest writes with the service role — so this narrows only the
--     path the hole used;
--   * is_platform_admin() and access_features_for's platform branch require
--     scope_type = 'platform';
--   * a check constraint pairs the role with the scope, whoever writes.
--
-- THE CONSTRAINT IS NOT ADDED OVER BAD ROWS. A row that breaks it is either
-- somebody who used the hole or a data error, and a migration cannot tell
-- which: it refuses, names the count, and says how to look.
-- ----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.memberships
   where (role = 'platform_admin') <> (scope_type = 'platform');
  if n > 0 then
    raise exception '0117: % memberships row(s) pair platform_admin with a scope other than platform, or the platform scope with another role. Each is an escalation through memberships_admin_write or a data error, and this migration will not guess which: look with  select * from memberships where (role = ''platform_admin'') <> (scope_type = ''platform'');  fix or delete them by hand, then push again', n
      using errcode = '23514';
  end if;
end $$;

do $$ begin
  alter table public.memberships add constraint memberships_platform_scope_ck
    check ((role = 'platform_admin') = (scope_type = 'platform'));
exception when duplicate_object then null; end $$;

drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships for all
  using (public.is_platform_admin()
         or (scope_type = 'league' and role in ('league_admin', 'statistician')
             and public.is_league_admin(scope_id)))
  with check (public.is_platform_admin()
              or (scope_type = 'league' and role in ('league_admin', 'statistician')
                  and public.is_league_admin(scope_id)));

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.user_id = auth.uid() and m.role = 'platform_admin'
                   and m.scope_type = 'platform');
$$;
/* Nothing revoked: it has always been callable by PUBLIC and dozens of
   policies call it as whichever role is querying. Stated, not changed. */
grant execute on function public.is_platform_admin() to anon, authenticated, service_role;
alter function public.is_platform_admin() owner to postgres;

-- ----------------------------------------------------------------------------
-- 1. WHAT EACH LEAGUE DECIDES
--
-- Columns on leagues rather than a side table, because every page that shows
-- a league already reads its row and the paywall needs to know before it draws
-- anything. Public like the rest of the row: that a league is members-only is
-- the first thing its landing page has to say.
-- ----------------------------------------------------------------------------
alter table public.leagues
  add column if not exists access_mode            text    not null default 'open',
  add column if not exists access_fixtures_public boolean not null default true,
  add column if not exists analytics_access       text    not null default 'inherit';

do $$ begin
  alter table public.leagues add constraint leagues_access_mode_ck
    check (access_mode in ('open', 'members'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leagues add constraint leagues_analytics_access_ck
    check (analytics_access in ('inherit', 'free', 'members'));
exception when duplicate_object then null; end $$;

comment on column public.leagues.access_mode is
  'open (default) or members: members hides everything that happened on court from '
  'anyone without the league feature. Changed only through set_league_access. See 0117.';
comment on column public.leagues.access_fixtures_public is
  'In members mode, whether upcoming (scheduled) fixtures stay public. Changed only '
  'through set_league_access.';
comment on column public.leagues.analytics_access is
  'inherit / free / members — overrides the platform analytics default for this league. '
  'Epinoia''s decision, not the league''s: changed only through platform_set_league_analytics.';

/* THE GUARD. leagues_write (0001) is FOR ALL using is_league_admin(id), so a
   league admin can PATCH any column of their own league straight through the
   REST API — including, without this, analytics_access, which is the
   platform's product and not theirs to give away. A trigger is the only thing
   that can tell a column change made by the two setter RPCs from the same
   change made by hand, and it tells them apart by a transaction-local setting
   that only those RPCs set, immediately around their own UPDATE.

   Refused only when a value actually CHANGES. A console that PATCHes a whole
   row back with the same values is not trying to change anybody's access, and
   refusing it would break an unrelated save. */
create or replace function public.leagues_access_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.access_mode is distinct from old.access_mode
      or new.access_fixtures_public is distinct from old.access_fixtures_public
      or new.analytics_access is distinct from old.analytics_access)
     and coalesce(current_setting('epinoia.access_rpc', true), '') <> 'on' then
    raise exception 'a league''s access is changed through set_league_access (or, for analytics, '
                    'platform_set_league_analytics), not by editing the league row'
      using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists leagues_access_guard on public.leagues;
create trigger leagues_access_guard
  before update of access_mode, access_fixtures_public, analytics_access on public.leagues
  for each row execute function public.leagues_access_guard();

-- The platform default for every league on 'inherit'. Seeded here because
-- platform_set_setting (0044) refuses keys that do not already exist, which is
-- what lets the platform console flip it without a migration.
insert into public.platform_settings (key, value, is_public)
values ('analytics_access', '"free"'::jsonb, true)
on conflict (key) do nothing;

-- The master switch (see the header), seeded OFF for the same reason. Public,
-- like analytics_access: a signed-out page is allowed to know whether anything
-- is gated, and access_state tells it anyway.
insert into public.platform_settings (key, value, is_public)
values ('memberships_enabled', 'false'::jsonb, true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. THE TABLES
-- ----------------------------------------------------------------------------

/* A PLAN is a price for a set of features. A platform plan (league_id null) is
   sold by Epinoia everywhere and can never carry 'league': a league that closes
   its doors does so for its own members, and Epinoia does not sell its way past
   that. The constraints say so as well as the RPC, because the billing
   function writes with the service role and a rule that only an RPC enforces
   is a rule the next writer does not know about.

   The same goes the other way for analytics, which are EPINOIA'S product: a
   plan a league sells on its own account may include them, but never for
   nothing — a free league plan carrying analytics would be a league handing
   out Epinoia's analytics to anyone who clicks. A free pass to analytics is a
   grant, and only a platform administrator issues one. */
create table if not exists public.access_plans (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid references public.leagues on delete cascade,
  name            text not null,
  blurb           text,
  features        text[] not null,
  price_pennies   int not null,
  currency        text not null default 'gbp',
  "interval"      text not null,
  stripe_price_id text,                                -- null = not yet purchasable
  seller          text not null default 'platform',    -- whose Stripe account takes the money
  active          boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint access_plans_name_ck check (char_length(btrim(name)) between 1 and 60),
  constraint access_plans_blurb_ck check (blurb is null or char_length(blurb) <= 400),
  constraint access_plans_features_ck
    check (cardinality(features) > 0 and features <@ array['analytics', 'league']::text[]),
  constraint access_plans_platform_no_league_ck
    check (league_id is not null or not ('league' = any (features))),
  constraint access_plans_platform_seller_ck
    check (league_id is not null or seller = 'platform'),
  constraint access_plans_league_analytics_paid_ck
    check (seller <> 'league' or not ('analytics' = any (features)) or price_pennies > 0),
  constraint access_plans_price_ck check (price_pennies >= 0),
  constraint access_plans_currency_ck check (currency ~ '^[a-z]{3}$'),
  constraint access_plans_interval_ck check ("interval" in ('month', 'year')),
  constraint access_plans_stripe_price_ck
    check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint access_plans_seller_ck check (seller in ('platform', 'league'))
);
create index if not exists access_plans_league_idx
  on public.access_plans (league_id, active, sort);

/* A Stripe customer is per ACCOUNT: a league selling on its own connected
   account has its own customer object for the same person. '' is Epinoia's
   own account, so the pair can be a primary key without a nullable column. */
create table if not exists public.access_customers (
  user_id            uuid not null references auth.users on delete cascade,
  stripe_account_id  text not null default '',
  stripe_customer_id text not null,
  created_at         timestamptz not null default now(),
  primary key (user_id, stripe_account_id)
);

/* The evidence the Consumer Contracts Regulations 2013 (regs 14, 16, 37) ask
   for — which wording the buyer agreed to, that they asked for access to start
   at once knowing they lose the 14-day right, and that they are an adult —
   written BEFORE the redirect to Stripe, so it exists even if the webhook
   never arrives. */
create table if not exists public.access_checkouts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  plan_id           uuid references public.access_plans on delete set null,
  stripe_session_id text unique,
  stripe_account_id text,
  consent_version   text not null,
  acknowledged_at   timestamptz not null,
  adult_confirmed   boolean not null,
  created_at        timestamptz not null default now()
);
create index if not exists access_checkouts_user_idx
  on public.access_checkouts (user_id, created_at desc);

/* One row per Stripe subscription, OVERWRITTEN by the webhook from a fresh
   fetch rather than patched from event payloads, so a missed or reordered
   event heals on the next one. Written only through billing_apply_subscription
   (below), which is where the plan's features and league are copied in on
   every sync and where an older fetch is refused.

   status holds Stripe's own words and is deliberately NOT constrained. Stripe
   adds statuses; a check constraint would turn that into a webhook that fails
   on every delivery, and access_active() already treats any word it does not
   know as "no access".

   The bookkeeping columns, each for one question the webhook cannot answer
   from Stripe alone:
     cancel_at       a flexible-billing cancellation (the default for Checkout
                     since 2025-09-30) sets this and leaves
                     cancel_at_period_end false; the pages show it as the end
     livemode        a test-mode purchase, so switch-on can find and remove them
     synced_at       when the fetch behind this row STARTED: the compare-and-set
     past_due_since  when the card first failed, which is what the seven days
                     of grace are counted from
     welcomed_at     the welcome email has been decided on, once */
create table if not exists public.access_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users on delete cascade,
  plan_id                uuid references public.access_plans on delete set null,
  league_id              uuid references public.leagues on delete cascade,
  features               text[] not null,
  status                 text not null,
  stripe_subscription_id text not null unique,
  stripe_customer_id     text not null,
  stripe_account_id      text,                  -- null = Epinoia's account; else the league's
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  cancel_at              timestamptz,
  trial_end              timestamptz,
  ended_at               timestamptz,
  cooling_off_waived_at  timestamptz,
  livemode               boolean not null default true,
  synced_at              timestamptz,
  past_due_since         timestamptz,
  welcomed_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint access_subscriptions_features_ck
    check (features <@ array['analytics', 'league']::text[])
);
create index if not exists access_subscriptions_user_idx
  on public.access_subscriptions (user_id);
create index if not exists access_subscriptions_league_idx
  on public.access_subscriptions (league_id, status);

/* A GRANT is access without payment — a press pass, a club official, a
   sponsor's guest — keyed on an EMAIL so it can be issued before the person has
   ever signed in and takes effect the moment they do.

   A platform-wide grant (league_id null) may not carry 'league', for the same
   reason a platform plan may not: only a league lets people into a league. */
create table if not exists public.access_grants (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid references public.leagues on delete cascade,
  email       text not null,
  features    text[] not null,
  note        text,
  granted_by  uuid references auth.users on delete set null,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint access_grants_email_ck
    check (email = lower(btrim(email)) and position('@' in email) > 1),
  constraint access_grants_features_ck
    check (cardinality(features) > 0 and features <@ array['analytics', 'league']::text[]),
  constraint access_grants_platform_no_league_ck
    check (league_id is not null or not ('league' = any (features))),
  constraint access_grants_note_ck check (note is null or char_length(note) <= 400)
);
create index if not exists access_grants_email_idx on public.access_grants (lower(email));
create index if not exists access_grants_league_idx on public.access_grants (league_id);

-- Stripe event ids already handled. A redelivery is acknowledged and skipped.
create table if not exists public.billing_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

/* A league's connected Stripe account. The same secret-table shape as
   merch_providers (0043): RLS on and NO policy, so it is unreadable from any
   browser; status comes out through league_access_admin / platform_access_admin,
   and the fee only goes in through platform_set_league_fee. */
create table if not exists public.league_billing_accounts (
  league_id          uuid primary key references public.leagues on delete cascade,
  stripe_account_id  text unique,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  fee_percent        numeric(5,2) not null default 10,
  updated_at         timestamptz not null default now(),
  constraint league_billing_fee_ck check (fee_percent between 0 and 100),
  constraint league_billing_account_ck
    check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$')
);

/* updated_at, kept honest whoever writes. There is no house helper for this —
   the existing RPCs set it by hand — but three different writers will touch
   these rows (the console RPCs, the billing webhook, the Connect refresh), and
   a column that is right only when every writer remembers it is not a column
   anybody can rely on. */
create or replace function public.access_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists access_plans_touch on public.access_plans;
create trigger access_plans_touch before update on public.access_plans
  for each row execute function public.access_touch_updated_at();
drop trigger if exists access_subscriptions_touch on public.access_subscriptions;
create trigger access_subscriptions_touch before update on public.access_subscriptions
  for each row execute function public.access_touch_updated_at();
drop trigger if exists league_billing_accounts_touch on public.league_billing_accounts;
create trigger league_billing_accounts_touch before update on public.league_billing_accounts
  for each row execute function public.access_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY, and the table privileges behind it.
--
-- Default deny, as everywhere. The explicit REVOKEs are belt and braces over
-- RLS: a table nobody should read through the API is refused outright rather
-- than answered with zero rows, so a policy added by mistake later still
-- cannot open it (the game_shares pattern, 0093).
-- ----------------------------------------------------------------------------
alter table public.access_plans            enable row level security;
alter table public.access_customers        enable row level security;
alter table public.access_checkouts        enable row level security;
alter table public.access_subscriptions    enable row level security;
alter table public.access_grants           enable row level security;
alter table public.billing_events          enable row level security;
alter table public.league_billing_accounts enable row level security;

-- Active plans are the shop window. Archived ones stay visible to whoever can
-- edit them, so the console can show what existing subscribers are on.
drop policy if exists access_plans_read on public.access_plans;
create policy access_plans_read on public.access_plans for select
  using (active
         or public.is_platform_admin()
         or (league_id is not null and public.is_league_admin(league_id)));

drop policy if exists access_subscriptions_read on public.access_subscriptions;
create policy access_subscriptions_read on public.access_subscriptions
  for select to authenticated
  using (user_id = auth.uid()
         or public.is_platform_admin()
         or (league_id is not null and public.is_league_admin(league_id)));

drop policy if exists access_grants_read on public.access_grants;
create policy access_grants_read on public.access_grants
  for select to authenticated
  using (lower(email) = lower(auth.email())
         or public.is_platform_admin()
         or (league_id is not null and public.is_league_admin(league_id)));

-- access_customers, access_checkouts, billing_events, league_billing_accounts:
-- RLS on and NO policy at all. The service role (the billing function) only.

revoke all on table public.access_plans from anon, authenticated;
grant select on table public.access_plans to anon, authenticated;
revoke all on table public.access_subscriptions, public.access_grants from anon, authenticated;
grant select on table public.access_subscriptions, public.access_grants to authenticated;
revoke all on table public.access_customers, public.access_checkouts,
                    public.billing_events, public.league_billing_accounts
  from anon, authenticated;
grant all on table public.access_plans, public.access_customers, public.access_checkouts,
                   public.access_subscriptions, public.access_grants,
                   public.billing_events, public.league_billing_accounts
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. THE RULES
-- ----------------------------------------------------------------------------

/* THE MASTER SWITCH. True only when the memberships_enabled platform setting
   is the JSON boolean true. Missing, null, a string, anything else: false —
   the switch fails OFF, because off means "nothing is gated", and a typo in
   the console must never close every members-only league at once.

   Every rule below that could refuse somebody asks this first (after the
   cheapest answer it already had), and 0118's policies ask it once per
   statement. Security definer so a signed-out caller reads it without the
   settings table's policy; executable by anon because 0118 calls it inside
   table policies, which run as the querying role. */
create or replace function public.memberships_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.value = 'true'::jsonb
                     from platform_settings s
                    where s.key = 'memberships_enabled'), false);
$$;

/* Is a subscription in this state worth anything?

   active and trialing: yes — until SEVEN DAYS after the period they paid for,
   if Stripe has not told us anything since. A subscription whose events stopped
   arriving (a test-mode purchase once the live signing secret is in, a webhook
   switched off, a connected account disconnected) then expires on its own
   instead of granting access for good. Stripe moves the period end forward at
   every renewal, so a healthy subscription never gets near it.

   past_due: for seven days FROM WHEN IT WENT PAST DUE (past_due_since, stamped
   by billing_apply_subscription). Stripe retries a failed card over several
   days, and a fan whose bank declined a renewal overnight should not find the
   league locked at breakfast while the retry is still pending. Not from the
   period end: Stripe moves that forward when it raises the renewal invoice,
   before the payment has failed, so counting from it would give a whole
   unpaid period away. Not stamped yet means it has only just happened.

   Anything else — canceled, unpaid, incomplete, paused, or a word Stripe has
   not invented yet — is no.

   The two-argument version counted past_due from the period end; it is dropped
   so nothing can keep calling it. */
drop function if exists public.access_active(text, timestamptz);
create or replace function public.access_active(
  p_status text, p_period_end timestamptz, p_past_due_since timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_status in ('active', 'trialing')
      then p_period_end is null or p_period_end + interval '7 days' > now()
    when p_status = 'past_due'
      then coalesce(p_past_due_since, now()) + interval '7 days' > now()
    else false
  end;
$$;

/* THE decision. Everything else asks this.

   Staff first, because staff never pay for their own league: a platform admin
   (a PLATFORM-scoped row — see section 0), or in this league an admin, a
   statistician or a writer, holds every feature.

   The manager of one of the league's clubs is let INTO the league — they run a
   team in it — but not given its analytics. grant_role lets an existing club
   manager appoint another, so counting managers as full staff would let any
   club hand Epinoia's analytics to anyone with an email address. Whatever they
   bought or were granted is added on top.

   It reads memberships, league_writers and teams DIRECTLY for p_user rather
   than calling is_league_admin and friends, because those answer for
   auth.uid() — the caller — and this is asked about somebody else too (the
   notification fan-outs ask it for every follower of a club).

   Otherwise the union of what they bought and what they were given:
     * live subscriptions — platform plans with 'league' stripped out (the row
       is copied from a plan that cannot carry it, but this does not trust a
       row to have been copied correctly), and this league's own plans;
     * live grants — not revoked, not expired, for this league or platform-wide,
       matched on the account's REAL email from auth.users, not a claim.

   Service role only. A browser that could call it could ask about anybody. */
create or replace function public.access_features_for(p_user uuid, p_league uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then '{}'::text[]
    when exists (select 1 from memberships m
                  where m.user_id = p_user and m.role = 'platform_admin'
                    and m.scope_type = 'platform')
      or (p_league is not null and (
            exists (select 1 from memberships m
                     where m.user_id = p_user
                       and m.role in ('league_admin', 'statistician')
                       and m.scope_type = 'league' and m.scope_id = p_league)
         or exists (select 1 from league_writers w
                     where w.user_id = p_user and w.league_id = p_league)))
      then array['analytics', 'league']::text[]
    else coalesce((
      select array_agg(distinct x.f order by x.f)
        from (
          select 'league'::text as f
           where p_league is not null
             and exists (select 1 from memberships m
                           join teams t on t.id = m.scope_id
                          where m.user_id = p_user and m.role = 'team_manager'
                            and m.scope_type = 'team' and t.league_id = p_league)
          union all
          select unnest(case when s.league_id is null
                             then array_remove(s.features, 'league')
                             else s.features end)
            from access_subscriptions s
           where s.user_id = p_user
             and (s.league_id is null or s.league_id = p_league)
             and public.access_active(s.status, s.current_period_end, s.past_due_since)
          union all
          select unnest(case when g.league_id is null
                             then array_remove(g.features, 'league')
                             else g.features end)
            from access_grants g
           where g.revoked_at is null
             and (g.expires_at is null or g.expires_at > now())
             and (g.league_id is null or g.league_id = p_league)
             and lower(g.email) = (select lower(u.email) from auth.users u where u.id = p_user)
        ) x), '{}'::text[])
  end;
$$;

-- The caller's own features. Signed out is simply nothing.
create or replace function public.access_features(p_league uuid default null)
returns text[] language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then '{}'::text[]
              else public.access_features_for(auth.uid(), p_league) end;
$$;

/* 'free' or 'members', AS CONFIGURED: the league's own override unless it
   inherits; then the platform setting; then 'free'. Any value in the setting
   other than "members" reads as free, because the setting is a jsonb the
   console can put anything in, and a typo must fail open for analytics (see
   the contract, §3).

   This is what WILL apply once memberships are switched on, which is what the
   two consoles show and edit. What applies NOW is access_analytics_mode, below.
   Internal: only the definer functions in this file call it. */
create or replace function public.access_analytics_configured(p_league uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l.analytics_access from leagues l
      where l.id = p_league and l.analytics_access in ('free', 'members')),
    (select case when (s.value #>> '{}') = 'members' then 'members' else 'free' end
       from platform_settings s where s.key = 'analytics_access'),
    'free');
$$;

/* 'free' or 'members', as it applies right now: the configured mode while
   memberships are switched on, and 'free' everywhere while they are off. */
create or replace function public.access_analytics_mode(p_league uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when public.memberships_enabled()
              then public.access_analytics_configured(p_league)
              else 'free' end;
$$;

/* May the caller see what happened on court in this league?

   The order is the point. No league, a league that does not exist, or an open
   league: yes, after one primary-key read and without ever reaching the
   feature lookup — this sits inside 0118's game_events policy. Then the master
   switch: while memberships are off, a members-only league is open too. It is
   asked after the open check, so an open league still costs the one read.

   THE SERVICE ROLE SEES EVERYTHING, and that is one line the contract does not
   spell out. The service role already bypasses RLS on every table; what it
   does NOT bypass is a condition written inside an owner-rights view or a
   definer function, and 0118 puts this function in both. Without the line,
   finalise-game (service role, no auth.uid()) would compute a members-only
   league's season awards from an empty player_season_stats and delete the
   real ones, and the JSON API would hand a league its own players as an empty
   list. It reads the role claim, which only a holder of the service key can
   set; an anonymous caller's claim says anon. */
create or replace function public.can_view_league(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null then true
    else coalesce((
      select case
               when l.access_mode = 'open' then true
               when not public.memberships_enabled() then true
               when auth.role() = 'service_role' then true
               else 'league' = any (public.access_features(l.id))
             end
        from leagues l
       where l.id = p_league), true)
  end;
$$;

-- The same question about somebody else, for the fan-outs. Service role only.
create or replace function public.can_view_league_for(p_user uuid, p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null then true
    else coalesce((
      select case
               when l.access_mode = 'open' then true
               when not public.memberships_enabled() then true
               else 'league' = any (public.access_features_for(p_user, l.id))
             end
        from leagues l
       where l.id = p_league), true)
  end;
$$;

-- May the caller see the premium analytics here? Free analytics never look
-- the caller up at all — and while memberships are switched off every league's
-- analytics are free (access_analytics_mode), so nobody is looked up.
create or replace function public.can_use_analytics(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.access_analytics_mode(p_league) = 'free' then true
    else 'analytics' = any (public.access_features(p_league))
  end;
$$;

/* Everything a page needs to decide what to draw, in one round trip, signed in
   or not (§4.3). Each league is named once, in the order asked, and at most
   fifty of them: a page asks about the league it is showing and perhaps the
   ones in its rail, and an anonymous caller must not be able to make one
   request cost a thousand feature lookups.

   analytics_ok at the top is the answer for a page with no league at all (the
   platform-wide tables). has_plans says whether anything applies here, a
   platform analytics plan included; has_league_plans whether THIS league sells
   its own way in, which is what a members-only paywall card has to know before
   it offers a join button.

   memberships_enabled is the master switch. While it is false every league
   answers can_view and analytics_ok true and analytics 'free' (the rules say
   so, not this function), but access_mode is still the league's STORED mode:
   a page or a console can say what will apply once the switch is on. */
create or replace function public.access_state(p_leagues uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'signed_in', auth.uid() is not null,
    'memberships_enabled', public.memberships_enabled(),
    'analytics_default', public.access_analytics_mode(null),
    'analytics_ok', public.can_use_analytics(null),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'slug', l.slug,
               'name', l.name,
               'access_mode', l.access_mode,
               'fixtures_public', l.access_fixtures_public,
               'analytics', public.access_analytics_mode(l.id),
               'features', to_jsonb(public.access_features(l.id)),
               'can_view', public.can_view_league(l.id),
               'analytics_ok', public.can_use_analytics(l.id),
               'has_plans', exists (select 1 from access_plans p
                                     where p.active
                                       and (p.league_id is null or p.league_id = l.id)),
               'has_league_plans', exists (select 1 from access_plans p
                                            where p.active and p.league_id = l.id
                                              and 'league' = any (p.features)))
             order by q.ord)
        from (select u.id, min(u.ord) as ord
                from unnest(p_leagues) with ordinality as u(id, ord)
               where u.id is not null
               group by u.id
               order by min(u.ord)
               limit 50) q
        join leagues l on l.id = q.id), '[]'::jsonb),
    'subscriptions', case when auth.uid() is null then 0 else (
      select count(*)::int from access_subscriptions s
       where s.user_id = auth.uid()
         and public.access_active(s.status, s.current_period_end, s.past_due_since)) end
  );
$$;

-- The price list: platform plans and, when asked, one league's. Public.
create or replace function public.access_plans_public(p_league uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'league_id', p.league_id,
           'name', p.name,
           'blurb', p.blurb,
           'features', to_jsonb(p.features),
           'price_pennies', p.price_pennies,
           'currency', p.currency,
           'interval', p."interval",
           'purchasable', p.stripe_price_id is not null)
         order by p.league_id nulls first, p.sort, p.price_pennies), '[]'::jsonb)
    from access_plans p
   where p.active
     and (p.league_id is null or p.league_id = p_league);
$$;

/* The signed-in person's own memberships, for the account page. Every
   subscription they have ever had, live ones first, so a lapsed one can say
   when it ended; only their LIVE grants, matched on the account's real email.
   The grant's note is shown to its holder — it is how a press pass says whose
   it is. cancel_at is returned beside cancel_at_period_end because a
   flexible-billing cancellation sets only cancel_at: the page shows
   cancel_at, or else the period end, as the end date. */
create or replace function public.my_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  return jsonb_build_object(
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'plan_id', s.plan_id,
               'plan_name', p.name,
               'league_id', s.league_id,
               'league_name', l.name,
               'league_slug', l.slug,
               'features', to_jsonb(s.features),
               'status', s.status,
               'active', public.access_active(s.status, s.current_period_end, s.past_due_since),
               'current_period_end', s.current_period_end,
               'cancel_at_period_end', s.cancel_at_period_end,
               'cancel_at', s.cancel_at,
               'livemode', s.livemode)
             order by public.access_active(s.status, s.current_period_end, s.past_due_since) desc,
                      s.created_at desc)
        from access_subscriptions s
        left join access_plans p on p.id = s.plan_id
        left join leagues l on l.id = s.league_id
       where s.user_id = v_uid), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'league_id', g.league_id,
               'league_name', l.name,
               'features', to_jsonb(g.features),
               'expires_at', g.expires_at,
               'note', g.note)
             order by g.created_at desc)
        from access_grants g
        left join leagues l on l.id = g.league_id
       where g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
         and lower(g.email) = v_email), '[]'::jsonb),
    'has_customer', exists (select 1 from access_customers c where c.user_id = v_uid)
  );
end; $$;

-- ----------------------------------------------------------------------------
-- 5. THE SETTERS
-- ----------------------------------------------------------------------------

/* A league admin opens or closes their league. It WARNS rather than refuses
   when there is nothing to buy: a league may reasonably close its doors to
   everyone but staff and press passes while it sorts its prices out, but it
   should know that is what it has done.

   It also works, and warns, while memberships are switched off for the whole
   platform: a league can be set up ahead of the switch, and should be told that
   members only does nothing yet. Only for 'members' — an open league is open
   either way, and telling it so would suggest the switch could close it. */
create or replace function public.set_league_access(
  p_league uuid, p_mode text, p_fixtures_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old_mode     text;
  v_old_fixtures boolean;
  v_mode         text;
  v_fixtures     boolean;
  v_warnings     text[] := '{}';
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  select l.access_mode, l.access_fixtures_public into v_old_mode, v_old_fixtures
    from leagues l where l.id = p_league;
  if not found then
    raise exception 'no such league' using errcode = '22023';
  end if;

  v_mode := coalesce(nullif(lower(btrim(p_mode)), ''), v_old_mode);
  if v_mode not in ('open', 'members') then
    raise exception 'a league is either open to everyone or for members only, so the mode is "open" or "members", not "%"', p_mode
      using errcode = '22023';
  end if;
  v_fixtures := coalesce(p_fixtures_public, v_old_fixtures);

  if v_mode = 'members' and not public.memberships_enabled() then
    v_warnings := v_warnings ||
      'Memberships are switched off for the whole platform, so this league stays open until a platform admin switches them on.'::text;
  end if;

  if v_mode = 'members' and not exists (
       select 1 from access_plans p
        where p.league_id = p_league and p.active
          and p.stripe_price_id is not null
          and 'league' = any (p.features)) then
    v_warnings := v_warnings ||
      'Nobody can join yet: this league has no active plan with a price that includes the league. Until one exists only staff and people you have granted access can see its games.'::text;
  end if;

  /* On for exactly one statement. Left on, it would let a direct PATCH later
     in the same transaction through the guard. */
  perform set_config('epinoia.access_rpc', 'on', true);
  update leagues
     set access_mode = v_mode, access_fixtures_public = v_fixtures
   where id = p_league;
  perform set_config('epinoia.access_rpc', 'off', true);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_access', 'league', p_league::text,
          jsonb_build_object('from', v_old_mode, 'to', v_mode,
                             'fixtures_public_from', v_old_fixtures,
                             'fixtures_public', v_fixtures));

  return jsonb_build_object('ok', true, 'access_mode', v_mode,
                            'fixtures_public', v_fixtures,
                            'warnings', to_jsonb(v_warnings));
end; $$;

-- Epinoia's decision about Epinoia's product, per league.
create or replace function public.platform_set_league_analytics(p_league uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old  text;
  v_mode text := lower(btrim(coalesce(p_mode, '')));
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if v_mode not in ('inherit', 'free', 'members') then
    raise exception 'a league''s analytics are "inherit" (follow the platform), "free" or "members", not "%"', p_mode
      using errcode = '22023';
  end if;

  select l.analytics_access into v_old from leagues l where l.id = p_league;
  if not found then
    raise exception 'no such league' using errcode = '22023';
  end if;

  perform set_config('epinoia.access_rpc', 'on', true);
  update leagues set analytics_access = v_mode where id = p_league;
  perform set_config('epinoia.access_rpc', 'off', true);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_analytics', 'league', p_league::text,
          jsonb_build_object('from', v_old, 'to', v_mode));

  return jsonb_build_object('ok', true, 'analytics_access', v_mode);
end; $$;

/* Create a plan (no id) or change one (id). A key that is absent is left
   alone; stripe_price_id sent as '' (or null) clears the price, which is how a
   plan is taken off sale without archiving it.

   WHO MAY TOUCH WHAT:
     * a platform plan — platform admins only;
     * a league plan — that league's admins, but a league admin only ever
       creates or edits plans the LEAGUE sells (seller 'league'). Making
       Epinoia the seller of a league's plan, or editing one Epinoia sells, is
       a platform admin's call, because it decides whose Stripe account the
       money lands in.
   A plan's league never changes after creation: subscribers bought access to
   THAT league, and moving the plan would move what they bought.

   A plan the league sells that includes analytics costs something (the
   constraint in section 2 says why), whoever saves it. */
create or replace function public.save_access_plan(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uuid_re    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_platform boolean := public.is_platform_admin();
  v_old      public.access_plans;
  v_id       uuid;
  v_league   uuid;
  v_txt      text;
  v_name     text;
  v_blurb    text;
  v_features text[];
  v_price    int;
  v_currency text;
  v_interval text;
  v_price_id text;
  v_seller   text;
  v_active   boolean;
  v_sort     int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'a plan is sent as an object of its fields' using errcode = '22023';
  end if;

  -- ---- which plan, and which league ----------------------------------------
  v_txt := nullif(btrim(coalesce(p->>'id', '')), '');
  if v_txt is not null then
    if v_txt !~ uuid_re then
      raise exception 'that plan id is not an id' using errcode = '22023';
    end if;
    v_id := v_txt::uuid;
    select * into v_old from access_plans where id = v_id;
    if not found then
      raise exception 'no such plan' using errcode = '22023';
    end if;
    v_league := v_old.league_id;
    if p ? 'league_id' then
      v_txt := nullif(btrim(coalesce(p->>'league_id', '')), '');
      if (v_txt is null) <> (v_league is null)
         or (v_txt is not null and (v_txt !~ uuid_re or v_txt::uuid <> v_league)) then
        raise exception 'a plan stays in the league it was created for; archive it and create a new one instead'
          using errcode = '22023';
      end if;
    end if;
  else
    v_txt := nullif(btrim(coalesce(p->>'league_id', '')), '');
    if v_txt is not null then
      if v_txt !~ uuid_re then
        raise exception 'that league id is not an id' using errcode = '22023';
      end if;
      v_league := v_txt::uuid;
    end if;
  end if;

  -- ---- rights ---------------------------------------------------------------
  if v_league is null then
    if not v_platform then
      raise exception 'only a platform administrator may create or change a platform plan'
        using errcode = '42501';
    end if;
  else
    if not public.is_league_admin(v_league) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
    if not exists (select 1 from leagues l where l.id = v_league) then
      raise exception 'no such league' using errcode = '22023';
    end if;
    if not v_platform and v_old.id is not null and v_old.seller <> 'league' then
      raise exception 'Epinoia sells this plan, so only a platform administrator may change it'
        using errcode = '42501';
    end if;
  end if;

  -- ---- the fields: present keys win, absent keys keep ----------------------
  v_name := case when p ? 'name' then btrim(coalesce(p->>'name', '')) else v_old.name end;
  if v_name is null or char_length(v_name) not between 1 and 60 then
    raise exception 'a plan needs a name of 1 to 60 characters' using errcode = '22023';
  end if;

  v_blurb := case when p ? 'blurb' then nullif(btrim(coalesce(p->>'blurb', '')), '')
                  else v_old.blurb end;
  if v_blurb is not null and char_length(v_blurb) > 400 then
    raise exception 'a plan''s description is at most 400 characters' using errcode = '22023';
  end if;

  if p ? 'features' then
    if jsonb_typeof(p->'features') <> 'array' then
      raise exception 'features are a list, such as ["analytics"]' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}'::text[])
      into v_features
      from jsonb_array_elements_text(p->'features') as x
     where btrim(x) <> '';
  else
    v_features := v_old.features;
  end if;
  if v_features is null or cardinality(v_features) = 0 then
    raise exception 'a plan unlocks at least one thing: analytics, the league, or both'
      using errcode = '22023';
  end if;
  if not v_features <@ array['analytics', 'league']::text[] then
    raise exception 'a plan can unlock "analytics" and "league", and nothing else' using errcode = '22023';
  end if;
  if v_league is null and 'league' = any (v_features) then
    raise exception 'a platform plan cannot unlock a members-only league: each league decides who gets in, so the league is sold only on that league''s own plans'
      using errcode = '22023';
  end if;

  if p ? 'price_pennies' then
    v_txt := btrim(coalesce(p->>'price_pennies', ''));
    if v_txt !~ '^[0-9]{1,9}$' then
      raise exception 'the price is a whole number of pennies, 0 or more' using errcode = '22023';
    end if;
    v_price := v_txt::int;
  else
    v_price := v_old.price_pennies;
  end if;
  if v_price is null then
    raise exception 'a plan needs a price in pennies' using errcode = '22023';
  end if;

  v_currency := case when p ? 'currency' then lower(btrim(coalesce(p->>'currency', '')))
                     else coalesce(v_old.currency, 'gbp') end;
  if v_currency !~ '^[a-z]{3}$' then
    raise exception 'the currency is a three-letter code, such as gbp' using errcode = '22023';
  end if;

  v_interval := case when p ? 'interval' then lower(btrim(coalesce(p->>'interval', '')))
                     else v_old."interval" end;
  if v_interval is null or v_interval not in ('month', 'year') then
    raise exception 'a plan renews every "month" or every "year"' using errcode = '22023';
  end if;

  if p ? 'stripe_price_id' then
    v_price_id := nullif(btrim(coalesce(p->>'stripe_price_id', '')), '');
    if v_price_id is not null and v_price_id !~ '^price_[A-Za-z0-9]+$' then
      raise exception 'a Stripe price id looks like price_1AbC2dE; copy it from the price''s page in Stripe'
        using errcode = '22023';
    end if;
  else
    v_price_id := v_old.stripe_price_id;
  end if;

  v_txt := nullif(lower(btrim(coalesce(p->>'seller', ''))), '');
  v_seller := coalesce(v_txt, v_old.seller,
                       case when v_league is null then 'platform' else 'league' end);
  if v_seller not in ('platform', 'league') then
    raise exception 'a plan is sold by "platform" or by "league"' using errcode = '22023';
  end if;
  if v_league is null and v_seller <> 'platform' then
    raise exception 'a platform plan is always sold by Epinoia' using errcode = '22023';
  end if;
  if v_league is not null and v_seller = 'platform' and not v_platform then
    raise exception 'only a platform administrator may make Epinoia the seller of a league''s plan'
      using errcode = '42501';
  end if;
  if v_seller = 'league' and 'analytics' = any (v_features) and v_price = 0 then
    raise exception 'the analytics are Epinoia''s, so a plan the league sells cannot include them for nothing: set a price, or take analytics out of the plan'
      using errcode = '22023';
  end if;

  if p ? 'active' then
    if jsonb_typeof(p->'active') <> 'boolean' then
      raise exception 'active is true or false' using errcode = '22023';
    end if;
    v_active := (p->>'active')::boolean;
  else
    v_active := coalesce(v_old.active, true);
  end if;

  if p ? 'sort' then
    v_txt := btrim(coalesce(p->>'sort', ''));
    if v_txt !~ '^-?[0-9]{1,6}$' then
      raise exception 'sort is a whole number' using errcode = '22023';
    end if;
    v_sort := v_txt::int;
  else
    v_sort := coalesce(v_old.sort, 0);
  end if;

  -- ---- write ----------------------------------------------------------------
  if v_old.id is null then
    insert into access_plans (league_id, name, blurb, features, price_pennies, currency,
                              "interval", stripe_price_id, seller, active, sort)
    values (v_league, v_name, v_blurb, v_features, v_price, v_currency,
            v_interval, v_price_id, v_seller, v_active, v_sort)
    returning id into v_id;
  else
    update access_plans
       set name = v_name, blurb = v_blurb, features = v_features,
           price_pennies = v_price, currency = v_currency, "interval" = v_interval,
           stripe_price_id = v_price_id, seller = v_seller, active = v_active,
           sort = v_sort, updated_at = now()
     where id = v_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'save_access_plan', 'access_plan', v_id::text,
          jsonb_build_object('created', v_old.id is null, 'league_id', v_league,
                             'name', v_name, 'features', to_jsonb(v_features),
                             'price_pennies', v_price, 'currency', v_currency,
                             'interval', v_interval, 'seller', v_seller,
                             'active', v_active, 'has_price', v_price_id is not null));
  return v_id;
end; $$;

-- Epinoia's cut of a league's own sales.
create or replace function public.platform_set_league_fee(p_league uuid, p_fee numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_fee is null or p_fee < 0 or p_fee > 100 then
    raise exception 'the fee is a percentage from 0 to 100' using errcode = '22023';
  end if;
  if not exists (select 1 from leagues l where l.id = p_league) then
    raise exception 'no such league' using errcode = '22023';
  end if;

  insert into league_billing_accounts (league_id, fee_percent, updated_at)
  values (p_league, round(p_fee, 2), now())
  on conflict (league_id) do update
    set fee_percent = excluded.fee_percent, updated_at = now();

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_fee', 'league', p_league::text,
          jsonb_build_object('fee_percent', round(p_fee, 2)));
end; $$;

/* Take a plan off sale. Existing subscribers keep what they bought: archiving
   changes only `active`, and billing_apply_subscription copies features from
   the plan as it stands, which archiving does not touch. Deleting a plan
   leaves each subscription with what it last had, and loses only the name
   their account page shows. */
create or replace function public.archive_access_plan(p_plan uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old public.access_plans;
begin
  select * into v_old from access_plans where id = p_plan;
  if not found then
    raise exception 'no such plan' using errcode = '22023';
  end if;

  if v_old.league_id is null then
    if not public.is_platform_admin() then
      raise exception 'only a platform administrator may change a platform plan'
        using errcode = '42501';
    end if;
  else
    if not public.is_league_admin(v_old.league_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
    if v_old.seller <> 'league' and not public.is_platform_admin() then
      raise exception 'Epinoia sells this plan, so only a platform administrator may change it'
        using errcode = '42501';
    end if;
  end if;

  update access_plans set active = false, updated_at = now() where id = p_plan;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'archive_access_plan', 'access_plan', p_plan::text,
          jsonb_build_object('league_id', v_old.league_id, 'name', v_old.name));
end; $$;

/* Access without payment, by email. A league admin grants THE LEAGUE in their
   league; analytics are Epinoia's product, so a grant that includes them —
   in one league or across the platform — is a platform admin's to give. A
   platform-wide grant carries analytics only, for the same reason a platform
   plan cannot carry the league. An expiry in the past is refused rather than
   stored, because a grant that never worked is a support question waiting to
   happen. */
create or replace function public.grant_access(
  p_league uuid, p_email text, p_features text[], p_expires timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_features text[];
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_id       uuid;
begin
  if p_league is null then
    if not public.is_platform_admin() then
      raise exception 'only a platform administrator may grant access across the whole platform'
        using errcode = '42501';
    end if;
  else
    if not public.is_league_admin(p_league) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
    if not exists (select 1 from leagues l where l.id = p_league) then
      raise exception 'no such league' using errcode = '22023';
    end if;
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(btrim(f)) order by lower(btrim(f))), '{}'::text[])
    into v_features
    from unnest(coalesce(p_features, '{}'::text[])) as f
   where btrim(f) <> '';
  if cardinality(v_features) = 0 then
    raise exception 'a grant gives at least one thing: analytics, the league, or both'
      using errcode = '22023';
  end if;
  if not v_features <@ array['analytics', 'league']::text[] then
    raise exception 'a grant can give "analytics" and "league", and nothing else' using errcode = '22023';
  end if;
  if 'analytics' = any (v_features) and not public.is_platform_admin() then
    raise exception 'the analytics are Epinoia''s to give away, so only a platform administrator may grant them; a league grants its league'
      using errcode = '42501';
  end if;
  if p_league is null and 'league' = any (v_features) then
    raise exception 'a platform-wide grant cannot open members-only leagues; grant the league from that league instead'
      using errcode = '22023';
  end if;
  if p_expires is not null and p_expires <= now() then
    raise exception 'that expiry has already passed' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 400 then
    raise exception 'a note is at most 400 characters' using errcode = '22023';
  end if;

  insert into access_grants (league_id, email, features, note, granted_by, expires_at)
  values (p_league, v_email, v_features, v_note, auth.uid(), p_expires)
  returning id into v_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_access', 'access_grant', v_id::text,
          jsonb_build_object('league_id', p_league, 'email', v_email,
                             'features', to_jsonb(v_features), 'expires_at', p_expires));
  return v_id;
end; $$;

create or replace function public.revoke_access_grant(p_grant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_league uuid;
  v_email  text;
begin
  select g.league_id, g.email into v_league, v_email from access_grants g where g.id = p_grant;
  if not found then
    raise exception 'no such grant' using errcode = '22023';
  end if;

  if v_league is null then
    if not public.is_platform_admin() then
      raise exception 'only a platform administrator may revoke a platform-wide grant'
        using errcode = '42501';
    end if;
  elsif not public.is_league_admin(v_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  -- revoked, not deleted: who had access, and until when, stays answerable
  update access_grants set revoked_at = now() where id = p_grant and revoked_at is null;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'revoke_access_grant', 'access_grant', p_grant::text,
          jsonb_build_object('league_id', v_league, 'email', v_email));
end; $$;

/* The league console's whole Memberships section in one call.

   counts: active = active or trialing; past_due = past_due (some of whom are
   still inside their seven days); ended = canceled, unpaid or
   incomplete_expired; grants = live grants. members and grants are capped at
   the thousand most recent, which is more than a page can usefully draw — the
   counts are exact whatever the cap.

   memberships_enabled is the master switch, so the panel can say that nothing
   it sets is enforced yet; analytics_mode is the CONFIGURED mode, what will
   apply once the switch is on (while it is off, every league's is free). */
create or replace function public.league_access_admin(p_league uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_league record;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  select l.id, l.slug, l.name, l.access_mode, l.access_fixtures_public, l.analytics_access
    into v_league
    from leagues l where l.id = p_league;
  if not found then
    raise exception 'no such league' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'memberships_enabled', public.memberships_enabled(),
    'league', jsonb_build_object(
      'id', v_league.id, 'slug', v_league.slug, 'name', v_league.name,
      'access_mode', v_league.access_mode,
      'fixtures_public', v_league.access_fixtures_public,
      'analytics_access', v_league.analytics_access,
      'analytics_mode', public.access_analytics_configured(p_league)),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'league_id', p.league_id, 'name', p.name, 'blurb', p.blurb,
               'features', to_jsonb(p.features), 'price_pennies', p.price_pennies,
               'currency', p.currency, 'interval', p."interval", 'seller', p.seller,
               'active', p.active, 'sort', p.sort,
               'has_price', p.stripe_price_id is not null,
               'stripe_price_id', p.stripe_price_id,
               'created_at', p.created_at, 'updated_at', p.updated_at)
             order by p.active desc, p.sort, p.price_pennies)
        from access_plans p
       where p.league_id = p_league), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(m.j order by m.act desc, m.created_at desc)
        from (select jsonb_build_object(
                       'email', u.email, 'plan_name', p.name,
                       'features', to_jsonb(s.features), 'status', s.status,
                       'active', public.access_active(s.status, s.current_period_end, s.past_due_since),
                       'current_period_end', s.current_period_end,
                       'cancel_at_period_end', s.cancel_at_period_end,
                       'cancel_at', s.cancel_at,
                       'livemode', s.livemode,
                       'created_at', s.created_at) as j,
                     public.access_active(s.status, s.current_period_end, s.past_due_since) as act,
                     s.created_at
                from access_subscriptions s
                left join auth.users u on u.id = s.user_id
                left join access_plans p on p.id = s.plan_id
               where s.league_id = p_league
               order by 2 desc, s.created_at desc
               limit 1000) m), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(x.j order by x.created_at desc)
        from (select jsonb_build_object(
                       'id', g.id, 'email', g.email, 'features', to_jsonb(g.features),
                       'expires_at', g.expires_at, 'revoked_at', g.revoked_at,
                       'note', g.note, 'created_at', g.created_at) as j,
                     g.created_at
                from access_grants g
               where g.league_id = p_league
               order by g.created_at desc
               limit 1000) x), '[]'::jsonb),
    'counts', jsonb_build_object(
      'active', (select count(*)::int from access_subscriptions s
                  where s.league_id = p_league and s.status in ('active', 'trialing')),
      'past_due', (select count(*)::int from access_subscriptions s
                    where s.league_id = p_league and s.status = 'past_due'),
      'ended', (select count(*)::int from access_subscriptions s
                 where s.league_id = p_league
                   and s.status in ('canceled', 'unpaid', 'incomplete_expired')),
      'grants', (select count(*)::int from access_grants g
                  where g.league_id = p_league and g.revoked_at is null
                    and (g.expires_at is null or g.expires_at > now()))),
    'payouts', (
      select jsonb_build_object(
               'connected', b.stripe_account_id is not null,
               'charges_enabled', coalesce(b.charges_enabled, false),
               'payouts_enabled', coalesce(b.payouts_enabled, false),
               -- 10 is the column default: a league with no row yet pays the default fee
               'fee_percent', coalesce(b.fee_percent, 10))
        from (select 1) as one
        left join league_billing_accounts b on b.league_id = p_league)
  );
end; $$;

-- The platform console's Plans tab in one call. Each league's fee is here so
-- the tab can show and set it without a second read. memberships_enabled is the
-- master switch the tab draws at its top; analytics_default is the CONFIGURED
-- default (the setting the tab edits, and what applies once the switch is on).
create or replace function public.platform_access_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'memberships_enabled', public.memberships_enabled(),
    'analytics_default', public.access_analytics_configured(null),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'league_id', p.league_id, 'league_name', l.name,
               'name', p.name, 'blurb', p.blurb, 'features', to_jsonb(p.features),
               'price_pennies', p.price_pennies, 'currency', p.currency,
               'interval', p."interval", 'seller', p.seller, 'active', p.active,
               'sort', p.sort, 'has_price', p.stripe_price_id is not null,
               'stripe_price_id', p.stripe_price_id,
               'created_at', p.created_at, 'updated_at', p.updated_at)
             order by p.league_id nulls first, l.name, p.active desc, p.sort, p.price_pennies)
        from access_plans p
        left join leagues l on l.id = p.league_id), '[]'::jsonb),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'slug', l.slug, 'name', l.name,
               'access_mode', l.access_mode,
               'fixtures_public', l.access_fixtures_public,
               'analytics_access', l.analytics_access,
               -- 10 is the column default: a league with no row yet pays the default fee
               'fee_percent', coalesce(b.fee_percent, 10),
               'active_members', (select count(*)::int from access_subscriptions s
                                   where s.league_id = l.id
                                     and public.access_active(s.status, s.current_period_end,
                                                              s.past_due_since)),
               'plans', (select count(*)::int from access_plans p
                          where p.league_id = l.id and p.active))
             order by l.name)
        from leagues l
        left join league_billing_accounts b on b.league_id = l.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'active_subscriptions', (select count(*)::int from access_subscriptions s
                                where s.status in ('active', 'trialing')),
      'past_due', (select count(*)::int from access_subscriptions s
                    where s.status = 'past_due'),
      'grants', (select count(*)::int from access_grants g
                  where g.revoked_at is null
                    and (g.expires_at is null or g.expires_at > now())))
  );
end; $$;

-- ----------------------------------------------------------------------------
-- 5b. THE WEBHOOK'S WRITE
-- ----------------------------------------------------------------------------

/* The only way the billing function writes a subscription (docs/memberships.md
   §5). It re-fetches the subscription from Stripe on every event and hands the
   result here with the moment it STARTED that fetch. Four things are decided in
   the database rather than in the function, because each needs the stored row
   and the write in one step:

   * AN OLDER FETCH NEVER OVERWRITES A NEWER ONE. Two deliveries for one
     subscription can overlap — Checkout's opening burst, a cancel and a resume
     a second apart — and each fetched at a different moment. The row is
     locked, and a fetch no newer than the one already stored changes nothing
     and says so ({applied: false}). PostgREST cannot put that condition on an
     upsert, which is why this is a function at all.

   * WHAT IT UNLOCKS COMES FROM THE PLAN, every time: the plan row is the
     authority for features and league, not whatever the caller sends (keys
     other than those listed below are ignored). A row copied wrongly is put
     right by the next event. A plan that has since been deleted leaves the row
     with what it last had — a member who paid keeps what they paid for until
     Stripe says otherwise.

   * WHEN THE CARD WENT PAST DUE is stamped the first time Stripe says so, kept
     while it stays past due, and cleared when it recovers: access_active counts
     the seven days of grace from it.

   * WHICH ONE-OFF EMAILS ARE DUE is answered from the row as it was UNDER THE
     LOCK, so two racing deliveries cannot both welcome somebody:
       first_active    now active or trialing and never welcomed — welcomed_at
                       is stamped in the same write, so it is true once;
       ending_started  before, neither cancel_at_period_end nor cancel_at was
                       set; now one is;
       ended           before, not canceled / incomplete_expired / unpaid; now
                       it is (a brand-new row only if it arrives ended).

   p_row keys: user_id, plan_id, status, stripe_subscription_id,
   stripe_customer_id, stripe_account_id (null = Epinoia's account),
   current_period_end, cancel_at_period_end, cancel_at, trial_end, ended_at,
   livemode, cooling_off_waived_at (kept once stored: it is evidence of what
   was agreed, and a later event cannot un-agree it).

   Who owns a subscription, and on which Stripe account, does not change once
   the row exists: an update keeps the stored user_id and stripe_account_id
   (the billing function checks the account before it calls this). A new row
   needs user_id, stripe_customer_id and a plan that exists.

   Service role only. */
create or replace function public.billing_apply_subscription(p_row jsonb, p_fetched_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uuid_re      constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  ended_words  constant text[] := array['canceled', 'incomplete_expired', 'unpaid'];
  v_sub_id     text;
  v_status     text;
  v_customer   text;
  v_txt        text;
  v_plan_id    uuid;
  v_user       uuid;
  v_plan       public.access_plans;
  v_old        public.access_subscriptions;
  v_new        public.access_subscriptions;
  v_created    boolean := false;
  v_cancelling boolean := false;
  v_was_ended  boolean := false;
  v_welcomed   boolean := false;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'a subscription is sent as an object of its fields' using errcode = '22023';
  end if;
  if p_fetched_at is null then
    raise exception 'say when the subscription was fetched: without it an older fetch could overwrite a newer one'
      using errcode = '22023';
  end if;

  v_sub_id := btrim(coalesce(p_row->>'stripe_subscription_id', ''));
  if v_sub_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'that is not a Stripe subscription id' using errcode = '22023';
  end if;
  v_status := btrim(coalesce(p_row->>'status', ''));
  if v_status = '' then
    raise exception 'a subscription always has a status' using errcode = '22023';
  end if;
  v_customer := nullif(btrim(coalesce(p_row->>'stripe_customer_id', '')), '');

  v_txt := nullif(btrim(coalesce(p_row->>'plan_id', '')), '');
  if v_txt is not null then
    if v_txt !~ uuid_re then
      raise exception 'that plan id is not an id' using errcode = '22023';
    end if;
    v_plan_id := v_txt::uuid;
  end if;

  -- the stored row, LOCKED: a second delivery for this subscription waits here
  select * into v_old from access_subscriptions
   where stripe_subscription_id = v_sub_id
     for update;

  if not found then
    v_txt := nullif(btrim(coalesce(p_row->>'user_id', '')), '');
    if v_txt is null or v_txt !~ uuid_re then
      raise exception 'a new subscription needs the user it belongs to' using errcode = '22023';
    end if;
    v_user := v_txt::uuid;
    if v_customer is null then
      raise exception 'a new subscription needs its Stripe customer' using errcode = '22023';
    end if;
    select * into v_plan from access_plans where id = v_plan_id;
    if not found then
      raise exception 'the plan named in the subscription does not exist, so it grants nothing'
        using errcode = '22023';
    end if;

    begin
      insert into access_subscriptions (
        user_id, plan_id, league_id, features, status, stripe_subscription_id,
        stripe_customer_id, stripe_account_id, current_period_end, cancel_at_period_end,
        cancel_at, trial_end, ended_at, livemode, cooling_off_waived_at,
        past_due_since, welcomed_at, synced_at)
      values (
        v_user, v_plan.id, v_plan.league_id, v_plan.features, v_status, v_sub_id,
        v_customer,
        nullif(btrim(coalesce(p_row->>'stripe_account_id', '')), ''),
        (p_row->>'current_period_end')::timestamptz,
        coalesce((p_row->>'cancel_at_period_end')::boolean, false),
        (p_row->>'cancel_at')::timestamptz,
        (p_row->>'trial_end')::timestamptz,
        (p_row->>'ended_at')::timestamptz,
        coalesce((p_row->>'livemode')::boolean, true),
        (p_row->>'cooling_off_waived_at')::timestamptz,
        case when v_status = 'past_due' then now() end,
        case when v_status in ('active', 'trialing') then now() end,
        p_fetched_at)
      returning * into v_new;
      v_created := true;
    exception when unique_violation then
      /* another delivery created it between the read and this insert: wait for
         its lock and carry on as an update, compared against what it wrote */
      select * into v_old from access_subscriptions
       where stripe_subscription_id = v_sub_id
         for update;
      if not found then
        raise exception 'subscription % was created and removed while this delivery saved it; try again', v_sub_id
          using errcode = '40001';
      end if;
    end;
  end if;

  if not v_created then
    if v_old.synced_at is not null and v_old.synced_at >= p_fetched_at then
      return jsonb_build_object('applied', false, 'id', v_old.id);
    end if;

    v_cancelling := v_old.cancel_at_period_end or v_old.cancel_at is not null;
    v_was_ended  := v_old.status = any (ended_words);
    v_welcomed   := v_old.welcomed_at is not null;

    -- no row found leaves every field of v_plan null, which the CASEs read as "keep"
    select * into v_plan from access_plans where id = coalesce(v_plan_id, v_old.plan_id);

    update access_subscriptions s
       set plan_id               = coalesce(v_plan.id, s.plan_id),
           league_id             = case when v_plan.id is not null then v_plan.league_id else s.league_id end,
           features              = case when v_plan.id is not null then v_plan.features else s.features end,
           status                = v_status,
           stripe_customer_id    = coalesce(v_customer, s.stripe_customer_id),
           current_period_end    = (p_row->>'current_period_end')::timestamptz,
           cancel_at_period_end  = coalesce((p_row->>'cancel_at_period_end')::boolean, false),
           cancel_at             = (p_row->>'cancel_at')::timestamptz,
           trial_end             = (p_row->>'trial_end')::timestamptz,
           ended_at              = (p_row->>'ended_at')::timestamptz,
           livemode              = coalesce((p_row->>'livemode')::boolean, s.livemode),
           cooling_off_waived_at = coalesce(s.cooling_off_waived_at,
                                            (p_row->>'cooling_off_waived_at')::timestamptz),
           past_due_since        = case when v_status = 'past_due'
                                        then coalesce(s.past_due_since, now()) end,
           welcomed_at           = case when v_status in ('active', 'trialing')
                                        then coalesce(s.welcomed_at, now())
                                        else s.welcomed_at end,
           synced_at             = p_fetched_at
     where s.id = v_old.id
    returning * into v_new;
  end if;

  return jsonb_build_object(
    'applied', true,
    'id', v_new.id,
    'first_active', v_new.status in ('active', 'trialing') and not v_welcomed,
    'ending_started', not v_cancelling
                      and (v_new.cancel_at_period_end or v_new.cancel_at is not null),
    'ended', not v_was_ended and v_new.status = any (ended_words));
end; $$;

-- ----------------------------------------------------------------------------
-- 6. GRANTS AND OWNERSHIP
--
-- Postgres grants EXECUTE to PUBLIC on every new function and Supabase adds
-- anon and authenticated by default privileges, so a revoke from PUBLIC alone
-- leaves the function callable. Every function says who may call it, and the
-- self-test below reads the result back with has_function_privilege rather
-- than trusting this list.
-- ----------------------------------------------------------------------------

-- service role only: answers about other people, or plumbing
revoke all on function public.access_active(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.access_active(text, timestamptz, timestamptz) to service_role;
revoke all on function public.access_features_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.access_features_for(uuid, uuid) to service_role;
revoke all on function public.can_view_league_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_view_league_for(uuid, uuid) to service_role;
revoke all on function public.billing_apply_subscription(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_subscription(jsonb, timestamptz) to service_role;
revoke all on function public.access_analytics_configured(uuid) from public, anon, authenticated;
grant execute on function public.access_analytics_configured(uuid) to service_role;
revoke all on function public.leagues_access_guard() from public, anon, authenticated;
revoke all on function public.access_touch_updated_at() from public, anon, authenticated;

/* signed out as well as in. can_view_league MUST stay executable by anon:
   0118 calls it from table policies and views, and a policy runs as the
   querying role — revoking it would turn every anonymous read of game_events
   into "permission denied for function" (the lesson 0051 records for
   is_league_writer). The service role is named too: the API and finalise-game
   read the same views. memberships_enabled likewise: 0118's inlined policies
   ask it as the querying role. */
revoke all on function public.memberships_enabled() from public;
grant execute on function public.memberships_enabled() to anon, authenticated, service_role;
revoke all on function public.access_features(uuid) from public;
grant execute on function public.access_features(uuid) to anon, authenticated, service_role;
revoke all on function public.access_analytics_mode(uuid) from public;
grant execute on function public.access_analytics_mode(uuid) to anon, authenticated, service_role;
revoke all on function public.can_view_league(uuid) from public;
grant execute on function public.can_view_league(uuid) to anon, authenticated, service_role;
revoke all on function public.can_use_analytics(uuid) from public;
grant execute on function public.can_use_analytics(uuid) to anon, authenticated, service_role;
revoke all on function public.access_state(uuid[]) from public;
grant execute on function public.access_state(uuid[]) to anon, authenticated, service_role;
revoke all on function public.access_plans_public(uuid) from public;
grant execute on function public.access_plans_public(uuid) to anon, authenticated, service_role;

-- signed in; each checks its own rights inside
do $$
declare f text;
begin
  foreach f in array array[
    'my_access()',
    'set_league_access(uuid,text,boolean)',
    'platform_set_league_analytics(uuid,text)',
    'save_access_plan(jsonb)',
    'platform_set_league_fee(uuid,numeric)',
    'archive_access_plan(uuid)',
    'grant_access(uuid,text,text[],timestamptz,text)',
    'revoke_access_grant(uuid)',
    'league_access_admin(uuid)',
    'platform_access_admin()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

/* A security definer function runs with its OWNER's rights. The CLI applies
   migrations through a temporary login role (see 0115), so every function here
   is pinned to postgres: whichever role ran this file, the rules can still read
   memberships, auth.users and the access tables. */
alter function public.leagues_access_guard() owner to postgres;
alter function public.access_touch_updated_at() owner to postgres;
alter function public.access_active(text, timestamptz, timestamptz) owner to postgres;
alter function public.access_features_for(uuid, uuid) owner to postgres;
alter function public.access_features(uuid) owner to postgres;
alter function public.memberships_enabled() owner to postgres;
alter function public.access_analytics_configured(uuid) owner to postgres;
alter function public.access_analytics_mode(uuid) owner to postgres;
alter function public.can_view_league(uuid) owner to postgres;
alter function public.can_view_league_for(uuid, uuid) owner to postgres;
alter function public.can_use_analytics(uuid) owner to postgres;
alter function public.access_state(uuid[]) owner to postgres;
alter function public.access_plans_public(uuid) owner to postgres;
alter function public.my_access() owner to postgres;
alter function public.set_league_access(uuid, text, boolean) owner to postgres;
alter function public.platform_set_league_analytics(uuid, text) owner to postgres;
alter function public.save_access_plan(jsonb) owner to postgres;
alter function public.platform_set_league_fee(uuid, numeric) owner to postgres;
alter function public.archive_access_plan(uuid) owner to postgres;
alter function public.grant_access(uuid, text, text[], timestamptz, text) owner to postgres;
alter function public.revoke_access_grant(uuid) owner to postgres;
alter function public.league_access_admin(uuid) owner to postgres;
alter function public.platform_access_admin() owner to postgres;
alter function public.billing_apply_subscription(jsonb, timestamptz) owner to postgres;

-- ============================================================================
-- SELF-TEST — the rules, called as the roles that will call them.
--
-- A migration has no auth.uid() and runs as the table owner, who bypasses RLS,
-- so a test that simply calls these functions proves nothing about a fan. This
-- seeds two leagues and eight people, then impersonates each of them the way
-- 0031 and 0115 do (SET LOCAL ROLE plus a forged request.jwt.claims) and asks
-- every question a page, a policy or the console will ask:
--
--   subscriber      an active subscription to the members league's plan
--   in grace        past_due since two days ago                -> still in
--   lapsed          past_due since ten days ago                -> out, plus a
--                   platform subscription whose row claims the league
--                   (it must be stripped: platform plans never open a league)
--   grant holder    an EXPIRED grant of analytics, a LIVE grant of the league,
--                   and an "active" subscription whose events stopped nine
--                   days after its period ended       -> the league, no more
--   club manager    manages a club in the members league   -> the league only
--   league admin    a memberships row — staff never pay; and every refusal
--   platform admin  the fee, analytics grants, and a platform_admin row that
--                   is NOT platform-scoped counting for nothing
--   stranger        signed in, nothing
--   anon            signed out
-- and then the webhook's write, billing_apply_subscription, delivery by
-- delivery: an older fetch refused, the grace stamped once and cleared, the
-- welcome decided once, a cancellation and an ending each noticed once.
--
-- THE MASTER SWITCH SHIPS OFF, and while it is off nothing above is refused to
-- anybody. So the block switches memberships ON first — every expectation of a
-- refusal below is an expectation about memberships switched on — and then
-- proves the other half with it OFF: anon and the stranger see the members
-- league and get its analytics for free even with the platform default at
-- members, access_state says so while still naming the stored mode, the
-- league admin can still close the league and is warned that it stays open,
-- the consoles report the switch and the configured modes, and only a platform
-- admin flips it, through platform_set_setting, audited. After the rollback
-- the setting must be the seeded false.
--
-- THE STRANGER AND ANON ALWAYS RUN: a forged claim with a random sub needs no
-- account row. The others need real accounts (their rows reference
-- auth.users). If this role may not create auth.users rows — the live push —
-- they are borrowed from existing profiles that hold no role, no writer seat
-- and no subscription, inside the same rolled-back block, so the live push
-- proves them too. A notice says which half ran.
--
-- EVERYTHING HAPPENS INSIDE A BLOCK THAT IS ALWAYS ROLLED BACK (the P0115
-- pattern). Rows are seeded with the migration's own rights before any role
-- switch; switching back goes to the captured role, never RESET ROLE, which
-- under the CLI's login role lands somewhere without table rights. The block
-- ends by raising a private code its handler swallows, which undoes the rows,
-- the roles and the forged claims together. Any other error — every assertion
-- below — fails the migration with its own message.
--
-- Refusals are caught by their SQLSTATE only (insufficient_privilege,
-- invalid_parameter_value, check_violation), never `others`: 0092 once
-- swallowed an undefined-column error as a passing refusal.
-- ============================================================================
do $test$
declare
  who        text := current_user || ' (session ' || session_user || ')';
  orig       text := current_user;
  u_sub      uuid := gen_random_uuid();
  u_grace    uuid := gen_random_uuid();
  u_lapsed   uuid := gen_random_uuid();
  u_grant    uuid := gen_random_uuid();
  u_admin    uuid := gen_random_uuid();
  u_mgr      uuid := gen_random_uuid();
  u_padmin   uuid := gen_random_uuid();
  u_out      uuid := gen_random_uuid();   -- signed in, nothing else, and never needs a row
  e_grant    text := 't117-grant@example.invalid';
  half       text := 'fresh test accounts';
  borrowed   uuid[];
  have_users boolean := true;
  lg_open    uuid;
  lg_mem     uuid;
  t_mem      uuid;
  plan_lg    uuid;
  plan_plat  uuid;
  plan_new   uuid;
  plan_apply uuid;
  grant_new  uuid;
  sub_id     uuid;
  rs         public.access_subscriptions;
  t0         timestamptz := now() - interval '10 minutes';
  f          text;
  j          jsonb;
  e          jsonb;
  n          int;
begin
  -- ---- who can reach what, read back from the catalogue ---------------------
  if to_regprocedure('public.access_active(text,timestamptz)') is not null then
    raise exception '0117: the two-argument access_active, which counted past_due from the period end, still exists';
  end if;

  foreach f in array array['access_active(text,timestamptz,timestamptz)',
                           'access_features_for(uuid,uuid)',
                           'can_view_league_for(uuid,uuid)',
                           'access_analytics_configured(uuid)',
                           'billing_apply_subscription(jsonb,timestamptz)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute')
       or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0117: % is for the service role only, but a browser role can call it', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0117: the service role cannot call %', f;
    end if;
  end loop;

  foreach f in array array['memberships_enabled()',
                           'access_features(uuid)', 'access_analytics_mode(uuid)',
                           'can_view_league(uuid)', 'can_use_analytics(uuid)',
                           'access_state(uuid[])', 'access_plans_public(uuid)',
                           'is_platform_admin()'] loop
    if not has_function_privilege('anon', 'public.' || f, 'execute')
       or not has_function_privilege('authenticated', 'public.' || f, 'execute')
       or not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0117: % must be callable signed out, signed in and by the service role', f;
    end if;
  end loop;

  foreach f in array array['my_access()', 'set_league_access(uuid,text,boolean)',
                           'platform_set_league_analytics(uuid,text)', 'save_access_plan(jsonb)',
                           'platform_set_league_fee(uuid,numeric)', 'archive_access_plan(uuid)',
                           'grant_access(uuid,text,text[],timestamptz,text)',
                           'revoke_access_grant(uuid)', 'league_access_admin(uuid)',
                           'platform_access_admin()'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception '0117: % is callable signed out', f;
    end if;
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0117: % is not callable signed in', f;
    end if;
  end loop;

  -- ---- the memberships write policy, as the catalogue has it ----------------
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.memberships'::regclass
                    and conname = 'memberships_platform_scope_ck' and contype = 'c') then
    raise exception '0117: memberships has no constraint pairing platform_admin with the platform scope';
  end if;

  -- ---- how long a subscription is worth anything -----------------------------
  if not public.access_active('active', null, null)
     or not public.access_active('trialing', null, null)
     or not public.access_active('active', now() + interval '20 days', null)
     or not public.access_active('active', now() - interval '6 days', null) then
    raise exception '0117: an active or trialing subscription inside its period, or its seven days after, was not active';
  end if;
  if public.access_active('active', now() - interval '8 days', null)
     or public.access_active('trialing', now() - interval '8 days', null) then
    raise exception '0117: an "active" subscription whose period ended eight days ago still has access — one whose events stopped never expires';
  end if;
  if not public.access_active('past_due', now() - interval '40 days', now() - interval '6 days')
     or not public.access_active('past_due', null, null) then
    raise exception '0117: a card that failed six days ago, or one only just marked past due, lost access inside the grace week';
  end if;
  if public.access_active('past_due', now() + interval '300 days', now() - interval '8 days') then
    raise exception '0117: past due for eight days still has access — the grace was counted from the period end, not from when the card failed';
  end if;
  if public.access_active('canceled', now() + interval '9 days', null)
     or public.access_active('unpaid', now() + interval '9 days', now())
     or public.access_active('incomplete', now() + interval '9 days', null)
     or public.access_active('something_new', now() + interval '9 days', null)
     or public.access_active(null, now() + interval '9 days', null) then
    raise exception '0117: a status that is not active, trialing or past_due counted as active';
  end if;

  begin
    -- ======================================================= seeded as the owner
    insert into leagues (slug, name) values ('zz-t117-open', '0117 Open') returning id into lg_open;
    insert into leagues (slug, name, access_mode)
      values ('zz-t117-members', '0117 Members', 'members') returning id into lg_mem;
    insert into teams (league_id, slug, name)
      values (lg_mem, 'zz-t117-club', '0117 Club') returning id into t_mem;

    -- the platform default as shipped, whatever a console has done since
    update platform_settings set value = '"free"'::jsonb where key = 'analytics_access';
    if not found then
      raise exception '0117: the analytics_access platform setting was not seeded';
    end if;

    -- ---- the master switch: seeded off, public, and read strictly ------------
    if not exists (select 1 from platform_settings s
                    where s.key = 'memberships_enabled' and s.is_public
                      and s.value = 'false'::jsonb) then
      raise exception '0117: the memberships_enabled platform setting was not seeded as a public false';
    end if;
    if public.memberships_enabled() then
      raise exception '0117: memberships_enabled() says on with the setting seeded off';
    end if;
    update platform_settings set value = '"true"'::jsonb where key = 'memberships_enabled';
    if public.memberships_enabled() then
      raise exception '0117: the STRING "true" switched memberships on; only the boolean may';
    end if;
    update platform_settings set value = 'null'::jsonb where key = 'memberships_enabled';
    if public.memberships_enabled() then
      raise exception '0117: a null memberships_enabled switched memberships on';
    end if;
    delete from platform_settings where key = 'memberships_enabled';
    if public.memberships_enabled() then
      raise exception '0117: with no memberships_enabled setting at all, memberships read as on';
    end if;
    insert into platform_settings (key, value, is_public) values ('memberships_enabled', 'false'::jsonb, true);

    /* ON, for everything below that expects a refusal. The OFF half is tested
       further down, each time inside this same rolled-back block. */
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
    if not public.memberships_enabled() then
      raise exception '0117: memberships_enabled() says off with the setting true';
    end if;

    -- the guard refuses even the owner without the setting...
    begin
      update leagues set analytics_access = 'members' where id = lg_mem;
      raise exception '0117: the leagues guard let a direct change to analytics_access through';
    exception when insufficient_privilege then null;
    end;
    -- ...and lets the change through with it
    perform set_config('epinoia.access_rpc', 'on', true);
    update leagues set analytics_access = 'members' where id = lg_mem;
    perform set_config('epinoia.access_rpc', 'off', true);

    insert into access_plans (league_id, name, features, price_pennies, "interval", stripe_price_id, seller)
    values (lg_mem, '0117 season pass', array['analytics', 'league'], 499, 'month', 'price_T117members', 'league')
    returning id into plan_lg;
    insert into access_plans (league_id, name, features, price_pennies, "interval", stripe_price_id)
    values (null, '0117 platform analytics', array['analytics'], 299, 'month', 'price_T117platform')
    returning id into plan_plat;

    -- the constraints, which hold whoever writes
    begin
      insert into access_plans (league_id, name, features, price_pennies, "interval")
      values (null, '0117 bad', array['league'], 100, 'month');
      raise exception '0117: a platform plan carrying the league was accepted';
    exception when check_violation then null;
    end;
    begin
      insert into access_plans (league_id, name, features, price_pennies, "interval", seller)
      values (null, '0117 bad', array['analytics'], 100, 'month', 'league');
      raise exception '0117: a platform plan sold by a league was accepted';
    exception when check_violation then null;
    end;
    begin
      insert into access_plans (league_id, name, features, price_pennies, "interval", seller)
      values (lg_mem, '0117 bad', array['analytics', 'league'], 0, 'month', 'league');
      raise exception '0117: a league sold Epinoia''s analytics for nothing';
    exception when check_violation then null;
    end;
    begin
      insert into access_plans (league_id, name, features, price_pennies, "interval", stripe_price_id)
      values (lg_mem, '0117 bad', array['analytics'], 100, 'month', 'prod_T117');
      raise exception '0117: a product id was accepted as a price id';
    exception when check_violation then null;
    end;
    begin
      insert into access_plans (league_id, name, features, price_pennies, "interval")
      values (lg_mem, '0117 bad', '{}'::text[], 100, 'month');
      raise exception '0117: a plan that unlocks nothing was accepted';
    exception when check_violation then null;
    end;
    begin
      insert into access_plans (league_id, name, features, price_pennies, currency, "interval")
      values (lg_mem, '0117 bad', array['analytics'], 100, 'GBP', 'month');
      raise exception '0117: an upper-case currency was stored';
    exception when check_violation then null;
    end;
    begin
      insert into league_billing_accounts (league_id, fee_percent) values (lg_mem, 101);
      raise exception '0117: a fee above 100 percent was accepted';
    exception when check_violation then null;
    end;
    /* the role/scope pairing — refused before the account's foreign key is
       ever checked, so a random id is enough */
    begin
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_out, 'platform_admin', 'league', lg_mem);
      raise exception '0117: a platform_admin row scoped to a league was stored';
    exception when check_violation then null;
    end;
    begin
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_out, 'league_admin', 'platform', null);
      raise exception '0117: a platform-scoped row for a role other than platform_admin was stored';
    exception when check_violation then null;
    end;

    -- ---- the accounts: fresh, or borrowed ----------------------------------
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_sub,    't117-sub@example.invalid'),
                     (u_grace,  't117-grace@example.invalid'),
                     (u_lapsed, 't117-lapsed@example.invalid'),
                     (u_grant,  't117-grant@example.invalid'),
                     (u_admin,  't117-admin@example.invalid'),
                     (u_mgr,    't117-mgr@example.invalid'),
                     (u_padmin, 't117-padmin@example.invalid')) as x(id, email);
    exception when insufficient_privilege then
      have_users := false;
    end;

    if not have_users then
      /* Real people, borrowed for the length of a rolled-back block: nothing
         below is ever committed. Only accounts that hold no role, no writer
         seat, no official's seat and no subscription, so every expectation is
         the same as for a fresh account. */
      select array_agg(x.id) into borrowed
        from (select p.id from public.profiles p
               where not exists (select 1 from public.memberships m where m.user_id = p.id)
                 and not exists (select 1 from public.league_writers w where w.user_id = p.id)
                 and not exists (select 1 from public.game_officials go where go.user_id = p.id)
                 and not exists (select 1 from public.access_subscriptions s where s.user_id = p.id)
               order by p.created_at
               limit 7) x;
      if coalesce(cardinality(borrowed), 0) = 7 then
        u_sub := borrowed[1];  u_grace := borrowed[2]; u_lapsed := borrowed[3];
        u_grant := borrowed[4]; u_admin := borrowed[5]; u_mgr := borrowed[6];
        u_padmin := borrowed[7];
        -- a grant matches the account's real email; without it that one check is skipped
        begin
          select lower(u.email) into e_grant from auth.users u where u.id = u_grant;
        exception when insufficient_privilege then
          e_grant := null;
        end;
        have_users := true;
        half := 'seven borrowed profiles' ||
                case when e_grant is null then ' (grant holder skipped: auth.users email unreadable)' else '' end;
      else
        half := 'NOT RUN: ' || who || ' may not create auth.users rows and only '
                || coalesce(cardinality(borrowed), 0) || ' of 7 clean profiles exist';
      end if;
    end if;

    if have_users then
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_admin,  'league_admin',   'league',   lg_mem),
             (u_mgr,    'team_manager',   'team',     t_mem),
             (u_padmin, 'platform_admin', 'platform', null);

      insert into access_subscriptions (user_id, plan_id, league_id, features, status,
                                        stripe_subscription_id, stripe_customer_id,
                                        current_period_end, past_due_since)
      values (u_sub,    plan_lg, lg_mem, array['analytics', 'league'], 'active',
              'sub_T117sub',    'cus_T117sub',    now() + interval '20 days', null),
             (u_grace,  plan_lg, lg_mem, array['analytics', 'league'], 'past_due',
              'sub_T117grace',  'cus_T117grace',  now() + interval '28 days', now() - interval '2 days'),
             (u_lapsed, plan_lg, lg_mem, array['analytics', 'league'], 'past_due',
              'sub_T117lapsed', 'cus_T117lapsed', now() + interval '20 days', now() - interval '10 days'),
             (u_lapsed, null,    null,   array['analytics', 'league'], 'active',
              'sub_T117plat',   'cus_T117lapsed', now() + interval '20 days', null),
             (u_grant,  plan_lg, lg_mem, array['analytics', 'league'], 'active',
              'sub_T117stale',  'cus_T117grant',  now() - interval '9 days', null);

      if e_grant is not null then
        insert into access_grants (league_id, email, features, expires_at)
        values (lg_mem, e_grant, array['analytics'], now() - interval '1 day'),
               (lg_mem, e_grant, array['league'],    now() + interval '30 days');
      end if;

      insert into access_customers (user_id, stripe_customer_id) values (u_sub, 'cus_T117sub');
      insert into access_checkouts (user_id, plan_id, consent_version, acknowledged_at, adult_confirmed)
      values (u_sub, plan_lg, '0117-test', now(), true);
    end if;
    insert into billing_events (id, type) values ('evt_T117', 'test.event');
    insert into league_billing_accounts (league_id, stripe_account_id, fee_percent)
    values (lg_mem, 'acct_T117', 12.5);

    -- ========================================================== signed out
    perform set_config('request.jwt.claims', '', true);
    set local role anon;

    if public.access_features(lg_mem) <> '{}'::text[] then
      raise exception '0117: anon holds features in the members league (%)', public.access_features(lg_mem);
    end if;
    if not public.can_view_league(lg_open) then
      raise exception '0117: anon cannot view an open league';
    end if;
    if public.can_view_league(lg_mem) then
      raise exception '0117: ANON CAN VIEW A MEMBERS-ONLY LEAGUE';
    end if;
    if not public.can_view_league(null) or not public.can_view_league(gen_random_uuid()) then
      raise exception '0117: no league, or a league that does not exist, was refused — there is nothing there to hide';
    end if;
    if public.access_analytics_mode(lg_open) <> 'free' or public.access_analytics_mode(lg_mem) <> 'members' then
      raise exception '0117: analytics modes read % / %, expected free / members',
        public.access_analytics_mode(lg_open), public.access_analytics_mode(lg_mem);
    end if;
    if not public.can_use_analytics(lg_open) then
      raise exception '0117: free analytics in an open league were refused';
    end if;
    if public.can_use_analytics(lg_mem) then
      raise exception '0117: anon was given members-only analytics';
    end if;

    j := public.access_state(array[lg_mem, lg_open, lg_mem]);
    if (j->>'signed_in')::boolean or j->>'analytics_default' <> 'free'
       or not (j->>'analytics_ok')::boolean or (j->>'subscriptions')::int <> 0
       or not (j->>'memberships_enabled')::boolean then
      raise exception '0117: access_state for anon is wrong at the top level: %', j;
    end if;
    if jsonb_array_length(j->'leagues') <> 2 then
      raise exception '0117: access_state should name each league once, got %', j->'leagues';
    end if;
    e := j->'leagues'->0;
    if e->>'id' <> lg_mem::text or e->>'access_mode' <> 'members' or (e->>'can_view')::boolean
       or (e->>'analytics_ok')::boolean or not (e->>'has_plans')::boolean
       or not (e->>'has_league_plans')::boolean
       or e->'features' <> '[]'::jsonb or e->>'analytics' <> 'members' then
      raise exception '0117: access_state for anon in the members league is wrong: %', e;
    end if;
    e := j->'leagues'->1;
    if e->>'id' <> lg_open::text or not (e->>'can_view')::boolean or not (e->>'analytics_ok')::boolean
       or not (e->>'fixtures_public')::boolean then
      raise exception '0117: access_state for anon in the open league is wrong: %', e;
    end if;
    -- the platform analytics plan applies in the open league; it does not sell that league
    if not (e->>'has_plans')::boolean or (e->>'has_league_plans')::boolean then
      raise exception '0117: in the open league has_plans should be true (the platform plan) and has_league_plans false: %', e;
    end if;
    if jsonb_array_length(public.access_state()->'leagues') <> 0 then
      raise exception '0117: access_state with no leagues asked still named some';
    end if;

    j := public.access_plans_public(lg_mem);
    if not exists (select 1 from jsonb_array_elements(j) x
                    where x->>'id' = plan_lg::text and (x->>'purchasable')::boolean
                      and x->>'interval' = 'month') then
      raise exception '0117: the members league''s plan is not in its public price list: %', j;
    end if;
    select count(*) into n from access_plans where id = plan_lg;
    if n <> 1 then
      raise exception '0117: anon cannot read an active plan';
    end if;

    foreach f in array array['access_subscriptions', 'access_grants', 'access_customers',
                             'access_checkouts', 'billing_events', 'league_billing_accounts'] loop
      begin
        execute format('select count(*) from public.%I', f) into n;
        if n > 0 then
          raise exception '0117: ANON READ % ROWS FROM %', n, f;
        end if;
      exception when insufficient_privilege then null;
      end;
    end loop;

    begin
      perform public.access_features_for(u_sub, lg_mem);
      raise exception '0117: anon asked access_features_for about somebody else';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.billing_apply_subscription(jsonb_build_object('stripe_subscription_id', 'sub_T117anon'), now());
      raise exception '0117: anon reached the webhook''s write';
    exception when insufficient_privilege then null;
    end;

    execute format('set local role %I', orig);

    -- with the platform default at members, a page with no league asks too
    update platform_settings set value = '"members"'::jsonb where key = 'analytics_access';
    set local role anon;
    if (public.access_state()->>'analytics_ok')::boolean then
      raise exception '0117: with platform analytics for members, access_state told anon analytics_ok';
    end if;
    execute format('set local role %I', orig);
    update platform_settings set value = '"free"'::jsonb where key = 'analytics_access';

    -- ============================================== stranger (always runs)
    perform set_config('request.jwt.claims', json_build_object(
      'sub', u_out, 'role', 'authenticated', 'email', 't117-out@example.invalid')::text, true);
    set local role authenticated;
    if public.can_view_league(lg_mem) or public.access_features(lg_mem) <> '{}'::text[]
       or public.can_use_analytics(lg_mem) then
      raise exception '0117: A SIGNED-IN STRANGER GOT INTO THE MEMBERS LEAGUE';
    end if;
    if not public.can_view_league(lg_open) then
      raise exception '0117: a signed-in stranger was refused an open league';
    end if;
    if public.is_platform_admin() then
      raise exception '0117: a signed-in stranger is a platform administrator';
    end if;
    select count(*) into n from access_subscriptions;
    if n <> 0 then raise exception '0117: a stranger reads % subscriptions', n; end if;
    select count(*) into n from access_grants;
    if n <> 0 then raise exception '0117: a stranger reads % grants', n; end if;
    begin
      perform public.league_access_admin(lg_mem);
      raise exception '0117: a stranger opened the league''s membership console';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.save_access_plan(jsonb_build_object(
        'league_id', lg_mem, 'name', 'hijack', 'features', jsonb_build_array('league'),
        'price_pennies', 0, 'interval', 'month'));
      raise exception '0117: a stranger created a plan in somebody else''s league';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.grant_access(lg_mem, 't117-out@example.invalid', array['league'], null, null);
      raise exception '0117: a stranger granted themselves the members league';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_out, 'league_admin', 'league', lg_mem);
      raise exception '0117: a stranger wrote themselves a league_admin row';
    exception when insufficient_privilege then null;
    end;
    if (public.access_state(array[lg_mem])->'leagues'->0->>'can_view')::boolean then
      raise exception '0117: access_state told a stranger they can view the members league';
    end if;
    begin
      perform public.platform_set_setting('memberships_enabled', 'false'::jsonb);
      raise exception '0117: A SIGNED-IN STRANGER FLIPPED THE MEMBERSHIPS MASTER SWITCH';
    exception when insufficient_privilege then null;
    end;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', '', true);

    /* ================================ MEMBERSHIPS SWITCHED OFF (always runs)
       The same members league — access_mode members, its own analytics set to
       members — with the platform analytics default at members too. Nothing
       of it is gated: anon and the stranger see the league and its analytics,
       and access_state says so while still naming the stored mode. */
    update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
    update platform_settings set value = '"members"'::jsonb where key = 'analytics_access';
    if (select l.access_mode from leagues l where l.id = lg_mem) <> 'members'
       or (select l.analytics_access from leagues l where l.id = lg_mem) <> 'members' then
      raise exception '0117: the switched-off checks need the members league still members only, with members analytics';
    end if;
    -- the fan-outs' question, about somebody who holds nothing
    if not public.can_view_league_for(u_out, lg_mem) then
      raise exception '0117: with memberships switched off, can_view_league_for still refused a follower the members league';
    end if;

    for n in 1..2 loop
      if n = 1 then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object(
          'sub', u_out, 'role', 'authenticated', 'email', 't117-out@example.invalid')::text, true);
        set local role authenticated;
      end if;
      f := case when n = 1 then 'anon' else 'the signed-in stranger' end;

      if not public.can_view_league(lg_mem) then
        raise exception '0117: WITH MEMBERSHIPS SWITCHED OFF, % WAS REFUSED A MEMBERS-ONLY LEAGUE', f;
      end if;
      if public.access_analytics_mode(lg_mem) <> 'free' or public.access_analytics_mode(lg_open) <> 'free'
         or public.access_analytics_mode(null) <> 'free' then
        raise exception '0117: with memberships switched off the analytics modes read % / % / % for %, expected free everywhere',
          public.access_analytics_mode(lg_mem), public.access_analytics_mode(lg_open),
          public.access_analytics_mode(null), f;
      end if;
      if not public.can_use_analytics(lg_mem) or not public.can_use_analytics(lg_open)
         or not public.can_use_analytics(null) then
        raise exception '0117: WITH MEMBERSHIPS SWITCHED OFF, % WAS REFUSED THE ANALYTICS (platform default and league set to members)', f;
      end if;
      if public.access_features(lg_mem) <> '{}'::text[] then
        raise exception '0117: switching memberships off gave % features (%) — it should open things, not hand out features',
          f, public.access_features(lg_mem);
      end if;

      j := public.access_state(array[lg_mem, lg_open]);
      if (j->>'memberships_enabled')::boolean is distinct from false
         or not (j->>'analytics_ok')::boolean or j->>'analytics_default' <> 'free' then
        raise exception '0117: with memberships switched off, access_state for % is wrong at the top level: %', f, j;
      end if;
      e := j->'leagues'->0;
      if e->>'id' <> lg_mem::text or e->>'access_mode' <> 'members'
         or not (e->>'can_view')::boolean or not (e->>'analytics_ok')::boolean
         or e->>'analytics' <> 'free' then
        raise exception '0117: with memberships switched off, access_state for % in the members league should say can_view and analytics_ok true, analytics free, and the stored mode members: %', f, e;
      end if;
      e := j->'leagues'->1;
      if not (e->>'can_view')::boolean or not (e->>'analytics_ok')::boolean then
        raise exception '0117: with memberships switched off, access_state for % in the open league is wrong: %', f, e;
      end if;

      execute format('set local role %I', orig);
    end loop;
    perform set_config('request.jwt.claims', '', true);

    -- and back ON, as the rest of the test expects
    update platform_settings set value = '"free"'::jsonb where key = 'analytics_access';
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';

    if have_users then
      -- ======================================================== the subscriber
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_sub, 'role', 'authenticated', 'email', 't117-sub@example.invalid')::text, true);
      set local role authenticated;

      if public.access_features(lg_mem) <> array['analytics', 'league']::text[] then
        raise exception '0117: the subscriber holds % in their league', public.access_features(lg_mem);
      end if;
      if not public.can_view_league(lg_mem) or not public.can_use_analytics(lg_mem) then
        raise exception '0117: a paying subscriber was refused their own league';
      end if;
      if public.access_features(lg_open) <> '{}'::text[] then
        raise exception '0117: a league subscription leaked into another league (%)', public.access_features(lg_open);
      end if;
      j := public.access_state(array[lg_mem]);
      if not (j->>'signed_in')::boolean or (j->>'subscriptions')::int <> 1
         or not (j->'leagues'->0->>'can_view')::boolean
         or j->'leagues'->0->'features' <> '["analytics", "league"]'::jsonb then
        raise exception '0117: access_state for the subscriber is wrong: %', j;
      end if;
      select count(*) into n from access_subscriptions;
      if n <> 1 then
        raise exception '0117: a subscriber can read % subscription rows, expected only their own', n;
      end if;
      j := public.my_access();
      if jsonb_array_length(j->'subscriptions') <> 1
         or not (j->'subscriptions'->0->>'active')::boolean
         or j->'subscriptions'->0->>'league_slug' <> 'zz-t117-members'
         or not (j->'subscriptions'->0 ? 'cancel_at')
         or not (j->'subscriptions'->0->>'livemode')::boolean
         or not (j->>'has_customer')::boolean
         or jsonb_array_length(j->'grants') <> 0 then
        raise exception '0117: my_access for the subscriber is wrong: %', j;
      end if;
      execute format('set local role %I', orig);

      -- ============================================================= in grace
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_grace, 'role', 'authenticated', 'email', 't117-grace@example.invalid')::text, true);
      set local role authenticated;
      if not public.can_view_league(lg_mem)
         or public.access_features(lg_mem) <> array['analytics', 'league']::text[] then
        raise exception '0117: a card that failed two days ago lost the league inside the grace week';
      end if;
      execute format('set local role %I', orig);

      -- =============================================================== lapsed
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_lapsed, 'role', 'authenticated', 'email', 't117-lapsed@example.invalid')::text, true);
      set local role authenticated;
      if public.can_view_league(lg_mem) then
        raise exception '0117: A LAPSED SUBSCRIBER (OR A PLATFORM PLAN) OPENED A MEMBERS-ONLY LEAGUE';
      end if;
      if public.access_features(lg_mem) <> array['analytics']::text[]
         or public.access_features(lg_open) <> array['analytics']::text[] then
        raise exception '0117: the platform plan should give analytics everywhere and nothing else, got % / %',
          public.access_features(lg_mem), public.access_features(lg_open);
      end if;
      if not public.can_use_analytics(lg_mem) then
        raise exception '0117: a platform analytics plan did not unlock members-only analytics';
      end if;
      if (public.access_state()->>'subscriptions')::int <> 1 then
        raise exception '0117: the lapsed subscription was counted as active';
      end if;
      execute format('set local role %I', orig);
      update platform_settings set value = '"members"'::jsonb where key = 'analytics_access';
      set local role authenticated;
      if not (public.access_state()->>'analytics_ok')::boolean then
        raise exception '0117: a platform analytics subscriber was told analytics_ok false on a page with no league';
      end if;
      execute format('set local role %I', orig);
      update platform_settings set value = '"free"'::jsonb where key = 'analytics_access';

      -- ========================================================= grant holder
      if e_grant is not null then
        perform set_config('request.jwt.claims', json_build_object(
          'sub', u_grant, 'role', 'authenticated', 'email', e_grant)::text, true);
        set local role authenticated;
        if public.access_features(lg_mem) <> array['league']::text[] then
          raise exception '0117: the grant holder holds %, expected only the live grant''s league (their subscription stopped nine days after its period)',
            public.access_features(lg_mem);
        end if;
        if not public.can_view_league(lg_mem) then
          raise exception '0117: a live grant did not open the league';
        end if;
        if public.can_use_analytics(lg_mem) then
          raise exception '0117: an EXPIRED grant, or a subscription whose events stopped, still unlocked analytics';
        end if;
        select count(*) into n from access_grants;
        if n <> 2 then
          raise exception '0117: a grant holder reads % grant rows, expected their own two', n;
        end if;
        j := public.my_access();
        if jsonb_array_length(j->'grants') <> 1 or j->'grants'->0->'features' <> '["league"]'::jsonb then
          raise exception '0117: my_access should list only the live grant: %', j->'grants';
        end if;
        execute format('set local role %I', orig);
      end if;

      -- ========================================================= club manager
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_mgr, 'role', 'authenticated', 'email', 't117-mgr@example.invalid')::text, true);
      set local role authenticated;
      if public.access_features(lg_mem) <> array['league']::text[] then
        raise exception '0117: a club manager holds % in their club''s league, expected the league and not its analytics',
          public.access_features(lg_mem);
      end if;
      if not public.can_view_league(lg_mem) or public.can_use_analytics(lg_mem) then
        raise exception '0117: a club manager should see the league (%) but not its members'' analytics (%)',
          public.can_view_league(lg_mem), public.can_use_analytics(lg_mem);
      end if;
      if public.access_features(lg_open) <> '{}'::text[] then
        raise exception '0117: managing a club in one league gave something in another';
      end if;
      execute format('set local role %I', orig);

      -- ========================================================= league admin
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_admin, 'role', 'authenticated', 'email', 't117-admin@example.invalid')::text, true);
      set local role authenticated;

      if public.access_features(lg_mem) <> array['analytics', 'league']::text[]
         or not public.can_view_league(lg_mem) or not public.can_use_analytics(lg_mem) then
        raise exception '0117: a league admin was asked to pay for their own league';
      end if;
      if public.access_features(lg_open) <> '{}'::text[] then
        raise exception '0117: being staff in one league made somebody staff in another';
      end if;
      select count(*) into n from access_subscriptions;
      if n <> 4 then
        raise exception '0117: a league admin reads % subscriptions, expected the league''s four', n;
      end if;

      j := public.league_access_admin(lg_mem);
      if not (j->>'memberships_enabled')::boolean
         or (j->'counts'->>'active')::int <> 2 or (j->'counts'->>'past_due')::int <> 2
         or (j->'counts'->>'grants')::int <> (case when e_grant is null then 0 else 1 end)
         or jsonb_array_length(j->'members') <> 4
         or not (j->'members'->0 ? 'cancel_at') or not (j->'members'->0 ? 'livemode')
         or j->'league'->>'analytics_mode' <> 'members'
         or not (j->'payouts'->>'connected')::boolean
         or (j->'payouts'->>'fee_percent')::numeric <> 12.5 then
        raise exception '0117: league_access_admin is wrong: %', j;
      end if;

      /* THE HOLE IN SECTION 0: a league admin writing the platform role for
         themselves, in their league's scope and in the platform's. Refused by
         the policy — the constraint would refuse the first too, but RLS is
         checked before constraints, so insufficient_privilege is the policy. */
      begin
        insert into memberships (user_id, role, scope_type, scope_id)
        values (u_admin, 'platform_admin', 'league', lg_mem);
        raise exception '0117: A LEAGUE ADMIN WROTE THEMSELVES A PLATFORM_ADMIN ROW IN THEIR LEAGUE';
      exception
        when insufficient_privilege then null;
        when check_violation then
          raise exception '0117: THE MEMBERSHIPS POLICY LET A LEAGUE ADMIN WRITE THEMSELVES A PLATFORM_ADMIN ROW; only the constraint stopped it';
      end;
      begin
        insert into memberships (user_id, role, scope_type, scope_id)
        values (u_admin, 'platform_admin', 'platform', null);
        raise exception '0117: A LEAGUE ADMIN WROTE THEMSELVES A PLATFORM_ADMIN ROW';
      exception when insufficient_privilege then null;
      end;
      begin
        insert into memberships (user_id, role, scope_type, scope_id)
        values (u_sub, 'team_manager', 'league', lg_mem);
        raise exception '0117: a league admin wrote a role other than league_admin or statistician into their league';
      exception when insufficient_privilege then null;
      end;
      -- ...while the rows a league admin does write still go in, and come out
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_sub, 'statistician', 'league', lg_mem);
      delete from memberships where user_id = u_sub and role = 'statistician' and scope_id = lg_mem;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0117: a league admin could not remove a statistician they appointed (% rows)', n;
      end if;
      if public.is_platform_admin() then
        raise exception '0117: the league admin became a platform administrator';
      end if;

      -- the guard: a direct PATCH by the admin is refused...
      begin
        update leagues set access_mode = 'open' where id = lg_mem;
        get diagnostics n = row_count;
        raise exception '0117: THE GUARD LET A LEAGUE ADMIN CHANGE access_mode DIRECTLY (% rows)', n;
      exception when insufficient_privilege then null;
      end;
      -- ...the RPC is not...
      j := public.set_league_access(lg_mem, 'members', false);
      if not (j->>'ok')::boolean or j->>'access_mode' <> 'members' or (j->>'fixtures_public')::boolean
         or jsonb_array_length(j->'warnings') <> 0 then
        raise exception '0117: set_league_access returned %', j;
      end if;
      if (select l.access_fixtures_public from leagues l where l.id = lg_mem) then
        raise exception '0117: set_league_access did not store fixtures_public';
      end if;
      -- ...and it did not leave the door open behind it
      if coalesce(current_setting('epinoia.access_rpc', true), '') = 'on' then
        raise exception '0117: set_league_access left epinoia.access_rpc switched on';
      end if;
      begin
        update leagues set access_fixtures_public = true where id = lg_mem;
        raise exception '0117: a direct PATCH got through straight after set_league_access';
      exception when insufficient_privilege then null;
      end;

      /* MEMBERSHIPS SWITCHED OFF: the league can still be closed, ahead of the
         switch, and is told it stays open until a platform admin switches
         memberships on. Opening it says nothing about the switch. The console
         shows the switch, and the analytics mode it will get. */
      execute format('set local role %I', orig);
      update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
      set local role authenticated;
      j := public.set_league_access(lg_mem, 'members', false);
      if not (j->>'ok')::boolean or j->>'access_mode' <> 'members'
         or j->'warnings' <> jsonb_build_array('Memberships are switched off for the whole platform, so this league stays open until a platform admin switches them on.') then
        raise exception '0117: with memberships switched off, set_league_access to members should work and warn only that the league stays open: %', j;
      end if;
      j := public.set_league_access(lg_mem, 'open', null);
      if j->>'access_mode' <> 'open' or jsonb_array_length(j->'warnings') <> 0 then
        raise exception '0117: with memberships switched off, opening a league warned about the switch: %', j;
      end if;
      j := public.set_league_access(lg_mem, 'members', false);
      if (select l.access_mode from leagues l where l.id = lg_mem) <> 'members' then
        raise exception '0117: with memberships switched off, set_league_access did not store members';
      end if;
      j := public.league_access_admin(lg_mem);
      if (j->>'memberships_enabled')::boolean is distinct from false
         or j->'league'->>'access_mode' <> 'members'
         or j->'league'->>'analytics_mode' <> 'members' then
        raise exception '0117: with memberships switched off, league_access_admin should report the switch off and the configured modes (members / members): %', j;
      end if;
      begin
        perform public.platform_set_setting('memberships_enabled', 'true'::jsonb);
        raise exception '0117: A LEAGUE ADMIN SWITCHED MEMBERSHIPS ON FOR THE WHOLE PLATFORM';
      exception when insufficient_privilege then null;
      end;
      execute format('set local role %I', orig);
      update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
      set local role authenticated;

      begin
        perform public.set_league_access(lg_mem, 'secret', null);
        raise exception '0117: set_league_access accepted a mode that does not exist';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.platform_set_league_analytics(lg_mem, 'free');
        raise exception '0117: a league admin set the analytics mode, which is Epinoia''s decision';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.platform_set_league_fee(lg_mem, 0);
        raise exception '0117: a league admin set their own fee';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.platform_access_admin();
        raise exception '0117: a league admin opened the platform''s plans console';
      exception when insufficient_privilege then null;
      end;

      -- plans: a league admin creates a LEAGUE-sold plan, whatever case they type
      plan_new := public.save_access_plan(jsonb_build_object(
        'league_id', lg_mem, 'name', '0117 analytics year', 'features', jsonb_build_array('Analytics'),
        'price_pennies', 2999, 'currency', 'GBP', 'interval', 'year'));
      if not exists (select 1 from access_plans p where p.id = plan_new and p.seller = 'league'
                       and p.currency = 'gbp' and p.features = array['analytics']::text[]
                       and p.stripe_price_id is null) then
        raise exception '0117: save_access_plan did not store the plan as the league''s, lower-cased';
      end if;
      perform public.save_access_plan(jsonb_build_object('id', plan_new, 'stripe_price_id', 'price_T117year'));
      if (select p.stripe_price_id from access_plans p where p.id = plan_new) is distinct from 'price_T117year' then
        raise exception '0117: save_access_plan did not set the price id';
      end if;
      perform public.save_access_plan(jsonb_build_object('id', plan_new, 'stripe_price_id', ''));
      if (select p.stripe_price_id from access_plans p where p.id = plan_new) is not null then
        raise exception '0117: an empty stripe_price_id did not clear the price';
      end if;
      if (select p.name from access_plans p where p.id = plan_new) <> '0117 analytics year' then
        raise exception '0117: a save without a name lost the name';
      end if;
      begin
        perform public.save_access_plan(jsonb_build_object('id', plan_new, 'price_pennies', 0));
        raise exception '0117: a league admin made their analytics plan free';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.save_access_plan(jsonb_build_object('id', plan_new, 'league_id', lg_open));
        raise exception '0117: a plan was moved to another league';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.save_access_plan(jsonb_build_object('id', plan_new, 'stripe_price_id', 'prod_T117'));
        raise exception '0117: save_access_plan accepted a product id as a price';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.save_access_plan(jsonb_build_object(
          'league_id', lg_mem, 'name', '0117 bad', 'features', jsonb_build_array('league', 'bogus'),
          'price_pennies', 100, 'interval', 'month'));
        raise exception '0117: save_access_plan accepted a feature that does not exist';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.save_access_plan(jsonb_build_object(
          'league_id', lg_mem, 'name', '0117 bad', 'features', jsonb_build_array('league'),
          'price_pennies', 100, 'interval', 'month', 'seller', 'platform'));
        raise exception '0117: a league admin made Epinoia the seller of a league plan';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.save_access_plan(jsonb_build_object(
          'name', '0117 bad', 'features', jsonb_build_array('analytics'),
          'price_pennies', 100, 'interval', 'month'));
        raise exception '0117: a league admin created a platform plan';
      exception when insufficient_privilege then null;
      end;

      -- grants: the league, yes; Epinoia's analytics, no
      grant_new := public.grant_access(lg_mem, '  T117-Press@Example.invalid ', array['league'], null, 'press');
      if (select g.email from access_grants g where g.id = grant_new) <> 't117-press@example.invalid' then
        raise exception '0117: grant_access did not lower-case the email';
      end if;
      begin
        perform public.grant_access(lg_mem, 't117-press@example.invalid', array['analytics'], null, null);
        raise exception '0117: A LEAGUE ADMIN GAVE AWAY EPINOIA''S ANALYTICS';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.grant_access(lg_mem, 't117-press@example.invalid', array['league', 'analytics'], null, null);
        raise exception '0117: a league admin gave away analytics alongside the league';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.grant_access(null, 't117-press@example.invalid', array['analytics'], null, null);
        raise exception '0117: a league admin granted access across the whole platform';
      exception when insufficient_privilege then null;
      end;
      begin
        perform public.grant_access(lg_mem, 'not an email', array['league'], null, null);
        raise exception '0117: grant_access accepted something that is not an email';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.grant_access(lg_mem, 't117-press@example.invalid', array['league'], now() - interval '1 hour', null);
        raise exception '0117: grant_access stored a grant that had already expired';
      exception when invalid_parameter_value then null;
      end;
      perform public.revoke_access_grant(grant_new);
      if (select g.revoked_at from access_grants g where g.id = grant_new) is null then
        raise exception '0117: revoke_access_grant did not revoke';
      end if;

      -- archive the only plan that sells the league, and switching now warns.
      -- The analytics plan made above is archived too, so that the league is
      -- left with no active plan of its own for the has_league_plans check.
      perform public.archive_access_plan(plan_lg);
      perform public.archive_access_plan(plan_new);
      j := public.set_league_access(lg_mem, 'members', true);
      if jsonb_array_length(j->'warnings') <> 1 then
        raise exception '0117: closing a league with nothing to buy did not warn: %', j;
      end if;
      select count(*) into n from access_plans where id = plan_lg;
      if n <> 1 then
        raise exception '0117: a league admin cannot see their own archived plan';
      end if;
      execute format('set local role %I', orig);

      -- an archived plan leaves the shop window
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
      select count(*) into n from access_plans where id = plan_lg;
      if n <> 0 then
        raise exception '0117: an archived plan is still public';
      end if;
      e := public.access_state(array[lg_mem])->'leagues'->0;
      if (e->>'has_league_plans')::boolean or not (e->>'has_plans')::boolean then
        raise exception '0117: with the league''s plans archived, has_league_plans should be false and has_plans true (the platform plan): %', e;
      end if;
      execute format('set local role %I', orig);

      -- ======================================================= platform admin
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_padmin, 'role', 'authenticated', 'email', 't117-padmin@example.invalid')::text, true);
      set local role authenticated;
      if not public.is_platform_admin() then
        raise exception '0117: a platform-scoped platform_admin row is not a platform administrator';
      end if;
      if public.access_features(lg_mem) <> array['analytics', 'league']::text[] then
        raise exception '0117: a platform administrator holds % in a members league', public.access_features(lg_mem);
      end if;
      j := public.platform_access_admin();
      if not (j->>'memberships_enabled')::boolean or j->>'analytics_default' <> 'free' then
        raise exception '0117: platform_access_admin should report memberships on and the default free: %',
          jsonb_build_object('memberships_enabled', j->'memberships_enabled', 'analytics_default', j->'analytics_default');
      end if;
      select x into e from jsonb_array_elements(j->'leagues') x where x->>'id' = lg_mem::text;
      if e is null or (e->>'fee_percent')::numeric <> 12.5 then
        raise exception '0117: platform_access_admin does not show the members league''s fee of 12.5: %', e;
      end if;
      select x into e from jsonb_array_elements(j->'leagues') x where x->>'id' = lg_open::text;
      if e is null or (e->>'fee_percent')::numeric <> 10 then
        raise exception '0117: a league with no billing row should show the default fee of 10: %', e;
      end if;

      /* THE MASTER SWITCH IS THE PLATFORM ADMIN'S, through the console's own
         setter (0044), which audits it. Off: the Plans tab still shows the
         CONFIGURED analytics default, while what applies is free. */
      if public.platform_set_setting('memberships_enabled', 'false'::jsonb) is distinct from 'saved' then
        raise exception '0117: platform_set_setting did not save memberships_enabled';
      end if;
      perform public.platform_set_setting('analytics_access', '"members"'::jsonb);
      if public.memberships_enabled() then
        raise exception '0117: a platform admin switched memberships off and they stayed on';
      end if;
      j := public.platform_access_admin();
      if (j->>'memberships_enabled')::boolean is distinct from false or j->>'analytics_default' <> 'members' then
        raise exception '0117: with memberships switched off, platform_access_admin should report the switch off and the configured default members: %',
          jsonb_build_object('memberships_enabled', j->'memberships_enabled', 'analytics_default', j->'analytics_default');
      end if;
      if public.access_analytics_mode(null) <> 'free' then
        raise exception '0117: with memberships switched off the platform analytics default applied (%)', public.access_analytics_mode(null);
      end if;
      perform public.platform_set_setting('memberships_enabled', 'true'::jsonb);
      if not public.memberships_enabled() or public.access_analytics_mode(null) <> 'members' then
        raise exception '0117: switching memberships back on did not bring back the configured analytics default';
      end if;
      perform public.platform_set_setting('analytics_access', '"free"'::jsonb);
      if (select count(*) from audit_log a
           where a.actor = u_padmin and a.action = 'platform_setting'
             and a.subject_id = 'memberships_enabled') <> 2 then
        raise exception '0117: flipping the memberships master switch was not audited, both times';
      end if;
      -- analytics are a platform admin's to give, in a league or everywhere
      perform public.grant_access(lg_mem, 't117-sponsor@example.invalid', array['analytics'], null, 'sponsor');
      perform public.grant_access(null, 't117-sponsor@example.invalid', array['analytics'], null, null);
      begin
        perform public.save_access_plan(jsonb_build_object(
          'league_id', lg_mem, 'name', '0117 bad', 'features', jsonb_build_array('analytics'),
          'price_pennies', 0, 'interval', 'month'));
        raise exception '0117: a free league-sold analytics plan was saved, even by a platform admin';
      exception when invalid_parameter_value then null;
      end;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      /* ================ a platform_admin row NOT scoped to the platform
         The constraint makes such a row impossible, so to prove that
         is_platform_admin and access_features_for would ignore one anyway the
         constraint is lifted inside a nested block that is itself always rolled
         back ('P117S'), taking the row, the claims and the constraint's absence
         with it. */
      begin
        alter table public.memberships drop constraint memberships_platform_scope_ck;
        insert into memberships (user_id, role, scope_type, scope_id)
        values (u_admin, 'platform_admin', 'league', lg_mem);
        perform set_config('request.jwt.claims', json_build_object(
          'sub', u_admin, 'role', 'authenticated')::text, true);
        set local role authenticated;
        if public.is_platform_admin() then
          raise exception '0117: A PLATFORM_ADMIN ROW SCOPED TO A LEAGUE MADE SOMEBODY A PLATFORM ADMINISTRATOR';
        end if;
        if public.access_features(lg_open) <> '{}'::text[] then
          raise exception '0117: a platform_admin row scoped to a league gave % in every other league',
            public.access_features(lg_open);
        end if;
        execute format('set local role %I', orig);
        raise exception using errcode = 'P117S', message = 'scope check passed; rolling it back';
      exception when sqlstate 'P117S' then null;
      end;
      if not exists (select 1 from pg_constraint
                      where conrelid = 'public.memberships'::regclass
                        and conname = 'memberships_platform_scope_ck') then
        raise exception '0117: the nested scope test did not put the constraint back';
      end if;

      -- ================================================ and all of it audited
      foreach f in array array['set_league_access', 'save_access_plan', 'grant_access',
                               'revoke_access_grant', 'archive_access_plan'] loop
        if not exists (select 1 from audit_log a where a.actor = u_admin and a.action = f) then
          raise exception '0117: % was not written to the audit log', f;
        end if;
      end loop;

      /* ========================= the webhook's write, delivery by delivery
         As the migration's own role, which holds execute through ownership;
         who else may call it is asserted from the catalogue above. Each fetch
         is a minute later than the last unless the point is that it is not. */
      insert into access_plans (league_id, name, features, price_pennies, "interval", stripe_price_id, seller)
      values (lg_mem, '0117 apply pass', array['league'], 300, 'month', 'price_T117apply', 'league')
      returning id into plan_apply;

      -- a new row: features and league from the PLAN, not from what was sent
      j := public.billing_apply_subscription(jsonb_build_object(
        'user_id', u_sub, 'plan_id', plan_apply, 'status', 'incomplete',
        'stripe_subscription_id', 'sub_T117apply', 'stripe_customer_id', 'cus_T117sub',
        'stripe_account_id', 'acct_T117', 'current_period_end', now() + interval '30 days',
        'cancel_at_period_end', false, 'livemode', false, 'cooling_off_waived_at', t0,
        'features', jsonb_build_array('analytics', 'league'), 'league_id', lg_open), t0);
      sub_id := (j->>'id')::uuid;
      select * into rs from access_subscriptions where id = sub_id;
      if not (j->>'applied')::boolean or (j->>'first_active')::boolean
         or (j->>'ending_started')::boolean or (j->>'ended')::boolean then
        raise exception '0117: the first delivery (incomplete) answered %', j;
      end if;
      if rs.features <> array['league']::text[] or rs.league_id <> lg_mem or rs.synced_at <> t0
         or rs.welcomed_at is not null or rs.livemode or rs.stripe_account_id <> 'acct_T117' then
        raise exception '0117: the first delivery stored features %, league %, synced %, welcomed %, livemode %',
          rs.features, rs.league_id, rs.synced_at, rs.welcomed_at, rs.livemode;
      end if;

      -- paid: welcomed, once
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'active', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'current_period_end', now() + interval '30 days',
        'livemode', false), t0 + interval '2 minutes');
      if not (j->>'applied')::boolean or not (j->>'first_active')::boolean then
        raise exception '0117: the delivery that made it active did not ask for the welcome: %', j;
      end if;
      if (select s.welcomed_at from access_subscriptions s where s.id = sub_id) is null then
        raise exception '0117: first_active was answered without stamping welcomed_at';
      end if;

      -- AN OLDER FETCH, arriving late, changes nothing; neither does the same one again
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'canceled', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub'), t0 + interval '1 minute');
      select * into rs from access_subscriptions where id = sub_id;
      if (j->>'applied')::boolean or rs.status <> 'active' or rs.synced_at <> t0 + interval '2 minutes' then
        raise exception '0117: AN OLDER FETCH OVERWROTE A NEWER ONE: answered %, row is % synced at %',
          j, rs.status, rs.synced_at;
      end if;
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'canceled', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub'), t0 + interval '2 minutes');
      if (j->>'applied')::boolean or (select s.status from access_subscriptions s where s.id = sub_id) <> 'active' then
        raise exception '0117: a fetch no newer than the stored one was applied: %', j;
      end if;

      -- past due: stamped once, kept, and counted from
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'past_due', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'current_period_end', now() + interval '30 days'),
        t0 + interval '3 minutes');
      if not (j->>'applied')::boolean or (j->>'first_active')::boolean
         or (select s.past_due_since from access_subscriptions s where s.id = sub_id) is null then
        raise exception '0117: going past due was not stamped (or asked for a second welcome): %', j;
      end if;
      -- as though it had failed three days ago: a later past_due delivery keeps that
      update access_subscriptions set past_due_since = now() - interval '3 days' where id = sub_id;
      perform public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'past_due', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'current_period_end', now() + interval '30 days'),
        t0 + interval '4 minutes');
      select * into rs from access_subscriptions where id = sub_id;
      if rs.past_due_since <> now() - interval '3 days' then
        raise exception '0117: a second past_due delivery restarted the grace (past_due_since %)', rs.past_due_since;
      end if;
      if not public.access_active(rs.status, rs.current_period_end, rs.past_due_since)
         or public.access_active(rs.status, rs.current_period_end, now() - interval '8 days') then
        raise exception '0117: the grace is not counted from past_due_since on the stored row';
      end if;

      -- recovered, and cancelled the flexible-billing way (cancel_at, not cancel_at_period_end)
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'active', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'current_period_end', now() + interval '30 days',
        'cancel_at_period_end', false, 'cancel_at', now() + interval '30 days',
        'cooling_off_waived_at', t0 + interval '1 hour'), t0 + interval '5 minutes');
      select * into rs from access_subscriptions where id = sub_id;
      if not (j->>'ending_started')::boolean or (j->>'first_active')::boolean or (j->>'ended')::boolean
         or rs.past_due_since is not null or rs.cancel_at is null then
        raise exception '0117: a cancellation by cancel_at was not noticed, or recovery did not clear the grace: % / past_due_since % cancel_at %',
          j, rs.past_due_since, rs.cancel_at;
      end if;
      if rs.cooling_off_waived_at <> t0 then
        raise exception '0117: a later delivery rewrote the stored consent evidence (% -> %)', t0, rs.cooling_off_waived_at;
      end if;
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'active', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'cancel_at_period_end', true,
        'cancel_at', now() + interval '30 days'), t0 + interval '6 minutes');
      if not (j->>'applied')::boolean or (j->>'ending_started')::boolean then
        raise exception '0117: a cancellation already stored was announced again: %', j;
      end if;

      -- ended, once
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'canceled', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'ended_at', now()), t0 + interval '7 minutes');
      if not (j->>'ended')::boolean or (j->>'ending_started')::boolean then
        raise exception '0117: the delivery that ended it did not say so: %', j;
      end if;
      j := public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'canceled', 'stripe_subscription_id', 'sub_T117apply',
        'stripe_customer_id', 'cus_T117sub', 'ended_at', now()), t0 + interval '8 minutes');
      if not (j->>'applied')::boolean or (j->>'ended')::boolean then
        raise exception '0117: an ending already stored was announced again: %', j;
      end if;

      -- the plan is the authority while it exists...
      update access_plans set features = array['analytics', 'league'] where id = plan_apply;
      perform public.billing_apply_subscription(jsonb_build_object(
        'status', 'canceled', 'stripe_subscription_id', 'sub_T117apply',
        'cancel_at', now() + interval '30 days'), t0 + interval '9 minutes');
      if (select s.features from access_subscriptions s where s.id = sub_id) <> array['analytics', 'league']::text[] then
        raise exception '0117: a plan''s features did not reach its subscription on the next delivery';
      end if;
      -- ...and once deleted, the row keeps what it last had
      delete from access_plans where id = plan_apply;
      perform public.billing_apply_subscription(jsonb_build_object(
        'plan_id', plan_apply, 'status', 'canceled', 'stripe_subscription_id', 'sub_T117apply',
        'cancel_at', now() + interval '30 days'), t0 + interval '10 minutes');
      select * into rs from access_subscriptions where id = sub_id;
      if rs.features <> array['analytics', 'league']::text[] or rs.league_id <> lg_mem or rs.plan_id is not null then
        raise exception '0117: a deleted plan changed its subscription: features %, league %, plan %',
          rs.features, rs.league_id, rs.plan_id;
      end if;

      -- brand-new rows: one that arrives ended, one that arrives trialing
      j := public.billing_apply_subscription(jsonb_build_object(
        'user_id', u_grace, 'plan_id', plan_lg, 'status', 'canceled',
        'stripe_subscription_id', 'sub_T117gone', 'stripe_customer_id', 'cus_T117grace'), t0);
      if not (j->>'applied')::boolean or not (j->>'ended')::boolean or (j->>'first_active')::boolean then
        raise exception '0117: a subscription that arrived already ended answered %', j;
      end if;
      j := public.billing_apply_subscription(jsonb_build_object(
        'user_id', u_grace, 'plan_id', plan_lg, 'status', 'trialing',
        'stripe_subscription_id', 'sub_T117fresh', 'stripe_customer_id', 'cus_T117grace'), t0);
      if not (j->>'first_active')::boolean or (j->>'ended')::boolean then
        raise exception '0117: a subscription that arrived trialing answered %', j;
      end if;

      begin
        perform public.billing_apply_subscription(jsonb_build_object(
          'plan_id', plan_lg, 'status', 'active', 'stripe_subscription_id', 'sub_T117nouser',
          'stripe_customer_id', 'cus_T117x'), t0);
        raise exception '0117: a new subscription with nobody to belong to was stored';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.billing_apply_subscription(jsonb_build_object(
          'user_id', u_sub, 'plan_id', gen_random_uuid(), 'status', 'active',
          'stripe_subscription_id', 'sub_T117noplan', 'stripe_customer_id', 'cus_T117x'), t0);
        raise exception '0117: a new subscription to a plan that does not exist was stored';
      exception when invalid_parameter_value then null;
      end;
      begin
        perform public.billing_apply_subscription(jsonb_build_object(
          'status', 'active', 'stripe_subscription_id', 'sub_T117apply'), null);
        raise exception '0117: a delivery that did not say when it fetched was applied';
      exception when invalid_parameter_value then null;
      end;

      -- and the account page can say how it ends, and that it was a test
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_sub, 'role', 'authenticated', 'email', 't117-sub@example.invalid')::text, true);
      set local role authenticated;
      select x into e from jsonb_array_elements(public.my_access()->'subscriptions') x
       where x->>'id' = sub_id::text;
      if e is null or e->>'cancel_at' is null or (e->>'livemode')::boolean then
        raise exception '0117: my_access does not show the test subscription''s cancel_at and livemode: %', e;
      end if;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
    end if;

    raise exception using errcode = 'P0117', message = '0117 passed; rolling its test rows back';
  exception
    when sqlstate 'P0117' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug like 'zz-t117-%')
     or exists (select 1 from access_plans where name like '0117 %')
     or exists (select 1 from billing_events where id = 'evt_T117') then
    raise exception '0117: the test rows outlived their rollback';
  end if;
  if coalesce(current_setting('epinoia.access_rpc', true), '') = 'on' then
    raise exception '0117: the self-test left epinoia.access_rpc switched on';
  end if;
  -- as shipped: memberships switched OFF, whatever the self-test switched on
  if public.memberships_enabled()
     or (select s.value from platform_settings s where s.key = 'memberships_enabled') is distinct from 'false'::jsonb then
    raise exception '0117: after the self-test memberships_enabled is % — it must be the seeded false',
      (select s.value from platform_settings s where s.key = 'memberships_enabled');
  end if;

  raise notice '0117 ok: a league admin cannot make themselves platform admin; open leagues cost one read, members '
               'leagues need the league feature, grace is seven days from the failed payment, a subscription '
               'whose events stop expires, platform plans never open a league, club managers get the league '
               'but not analytics, analytics are the platform''s to give, grants expire, staff never pay, '
               'access is changed only through the RPCs, and the webhook''s write refuses an older fetch';
  raise notice '0117 ok: the memberships master switch ships off; while it is off every league is visible and the '
               'analytics are free whatever the settings say, leagues can still be set up (with a warning), and only '
               'a platform admin flips it, audited';
  raise notice '0117: the signed-in stranger and anon ran; the signed-in half ran with %', half;
end $test$;
