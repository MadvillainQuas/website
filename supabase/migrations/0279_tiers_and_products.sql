-- ============================================================================
-- 0279  MEMBERSHIP TIERS AS A MATRIX, AND THINGS SOLD ON THEIR OWN
--
-- Louie, 2026-10-16: "lock each player report in the player report tab behind a paywall for £15 (or adjustable), team
-- report for an adjustable amount, and also lock off front office only for paying team personnel with a specific team
-- analytics suite membership ... an option for Manager mode to be paid (preset is 1 pound per month) ... each gated
-- section have an organised tickbox matrix and addable membership tiers ... (starting with 'free' column and ending with
-- the highest tier)"; then "beyond just free ... being logged in is another tier to add to the matrix", and "can
-- purchasing report subscriptions for example also add a membership tier with it too". Answered the same day: the £15 is
-- ONE PDF DOWNLOAD of the report as it stands that day; a report subscription is THE REPORT EMAILS (self-service);
-- setting up a league is a MONTHLY subscription, and a lapsed one leaves the league private and without its admin.
--
-- THE MATRIX. Every lockable section (access_gates, 0222) is a row; the columns are Free (everyone, signed out too),
-- Signed in (any free account) and the platform's tiers (access_plans kind 'tier', league_id null), in their order. A
-- row is
--     gate 'free'     Free ticked: open to everyone
--     gate 'signin'   Signed in ticked: open to any account
--     gate 'tiers'    open to the tiers whose privileges name the row's key
-- (a tick in a column ticks every column to its right; the console draws it so). The old gates ('analytics',
-- 'club_report', 'player_report') are still understood, and converted once, below: each plan's privileges become the
-- sections its features opened, and every section then follows the matrix. A section that was 'free' asked for an
-- account all the same (2026-10-04, signed in first), so it becomes 'signin'.
--
-- THINGS SOLD ON THEIR OWN (access_plans.kind), Epinoia's only (platform plans):
--     tier          a membership tier: a column of the matrix (and every plan before this one)
--     manager       Manager mode: the 'manager' section, a pass of its own (£1 a month to start)
--     player_mail   a player's report emails (report_mail_players, 0272): mail_kinds 'weekly', 'matchups' (0274)
--     team_mail     a club's report emails (report_mail_subs, 0221): mail_kinds 'games', 'opponents', 'own', 'zip'
--     league_setup  a private league of their own, built when paid, the buyer its administrator (monthly)
--     player_pdf    one PDF of a player's report, once (£15 to start)
--     club_pdf      one PDF of a club's report, once
-- Any of them may come WITH A TIER (includes_tier): while the subscription runs its holder has that tier's privileges
-- too. A tier's or a pass's privileges are read from the plan when access is asked, never copied, so a tick moved in
-- the console moves every member at once.
--
-- THE ONE-OFF PDF (access_purchases): paid once (Checkout in payment mode), then DRAWN BY THE SERVER, never unlocked in
-- the buyer's browser (Louie, 2026-10-16: "make certain that the preview isn't bypassable at all to grab the rest of the
-- pdf"): the purchase is a render job the report worker takes (pdf_render_claim), draws headless (its page unlocked only
-- by a ticket the database made for it, report_bot_ok), keeps in the private 'reports' bucket as a file of the buyer's
-- own (report_files.user_id, read only through a signed URL by that account) and emails. A locked report shows its
-- first pages only, and nothing of the rest is computed in the reader's browser.
--
-- THE SUBSCRIPTIONS THAT BUILD SOMETHING (player_mail, team_mail, league_setup): what to build is written with the
-- consent evidence before payment (access_checkouts.details), copied onto the subscription when it is first written,
-- and built by billing_provision whenever billing_apply_subscription writes the row: an address added (or switched
-- back on), a league created. When the subscription ends: the address is paused; the league's buyer stops
-- administering it and it stays private (leagues.setup_lapsed_at). Building never fails the webhook: a problem is kept
-- on the row (provision_error) for the console.
--
-- FRONT OFFICE (front_office_access): for the club's own people (team managers, statisticians and whoever they share
-- it with, 0193) holding a tier that ticks 'frontOffice'; league and platform administrators always. Off while
-- memberships are switched off, as everything.
--
-- MANAGER MODE: a fan's clubs are written only while the 'manager' section is open to them (a trigger on
-- manager_teams); 'free' to start, so nothing changes until the Free tick is taken off its row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE PLANS
-- ----------------------------------------------------------------------------
alter table public.access_plans add column if not exists kind text not null default 'tier';
alter table public.access_plans add column if not exists privileges text[] not null default '{}'::text[];
alter table public.access_plans add column if not exists mail_kinds text[] not null default '{}'::text[];
alter table public.access_plans add column if not exists includes_tier uuid references public.access_plans(id) on delete set null;

alter table public.access_plans drop constraint if exists access_plans_kind_ck;
alter table public.access_plans add constraint access_plans_kind_ck
  check (kind in ('tier', 'manager', 'player_mail', 'team_mail', 'league_setup', 'player_pdf', 'club_pdf'));
alter table public.access_plans drop constraint if exists access_plans_interval_ck;
alter table public.access_plans add constraint access_plans_interval_ck check ("interval" in ('month', 'year', 'once'));
alter table public.access_plans drop constraint if exists access_plans_once_ck;
alter table public.access_plans add constraint access_plans_once_ck
  check (("interval" = 'once') = (kind in ('player_pdf', 'club_pdf')));
/* a platform tier may start with nothing ticked (it is then ticked in the matrix); a league's plan still opens something */
alter table public.access_plans drop constraint if exists access_plans_features_ck;
alter table public.access_plans add constraint access_plans_features_ck
  check (features <@ array['analytics', 'league', 'club_report', 'player_report']::text[]
         and (cardinality(features) > 0 or league_id is null));
alter table public.access_plans drop constraint if exists access_plans_privileges_ck;
alter table public.access_plans add constraint access_plans_privileges_ck
  check (cardinality(privileges) <= 60 and array_to_string(privileges, ',') ~ '^([a-zA-Z][a-zA-Z0-9_]{1,40}(,[a-zA-Z][a-zA-Z0-9_]{1,40})*)?$');
alter table public.access_plans drop constraint if exists access_plans_mail_kinds_ck;
alter table public.access_plans add constraint access_plans_mail_kinds_ck
  check (mail_kinds <@ array['games', 'opponents', 'own', 'zip', 'weekly', 'matchups']::text[]
         and (kind = 'team_mail' or not (mail_kinds && array['games', 'opponents', 'own', 'zip']::text[]))
         and (kind = 'player_mail' or not (mail_kinds && array['weekly', 'matchups']::text[])));
alter table public.access_plans drop constraint if exists access_plans_products_platform_ck;
alter table public.access_plans add constraint access_plans_products_platform_ck
  check (kind = 'tier' or (league_id is null and seller = 'platform'));
alter table public.access_plans drop constraint if exists access_plans_includes_ck;
alter table public.access_plans add constraint access_plans_includes_ck check (includes_tier is null or includes_tier <> id);

-- ----------------------------------------------------------------------------
-- 2. THE ROWS OF THE MATRIX
-- ----------------------------------------------------------------------------
alter table public.access_gates drop constraint if exists access_gates_gate_check;
alter table public.access_gates drop constraint if exists access_gates_gate_ck;
alter table public.access_gates add constraint access_gates_gate_ck
  check (gate in ('free', 'signin', 'tiers', 'analytics', 'club_report', 'player_report'));
alter table public.access_gates add column if not exists category text not null default 'analytics';
alter table public.access_gates drop constraint if exists access_gates_category_ck;
alter table public.access_gates add constraint access_gates_category_ck check (category in ('analytics', 'reports', 'club', 'manager'));
alter table public.access_gates add column if not exists sort int not null default 100;

update public.access_gates set category = 'reports' where key in ('clubReport', 'playerReport', 'gameReport');
insert into public.access_gates (key, gate, category, sort) values
  ('frontOffice', 'tiers', 'club', 300),
  ('manager', 'free', 'manager', 400)
on conflict (key) do nothing;
update public.access_gates set sort = case key
  when 'events' then 10 when 'shotZones' then 11 when 'shotClock' then 12 when 'rotations' then 13 when 'lineups' then 14
  when 'wowy' then 15 when 'splits' then 16 when 'statColumns' then 17 when 'csv' then 18 when 'model' then 19
  when 'transferMatrix' then 20 when 'gameFlow' then 21 when 'gameConnections' then 22 when 'gameAdvanced' then 23
  when 'videoRuns' then 24 when 'playerReport' then 200 when 'clubReport' then 201 when 'gameReport' then 202
  else sort end
 where sort = 100;

/* THE CONVERSION, ONCE: while no section of the old ones follows the matrix yet. Each plan's privileges are the
   sections its features opened; then every section follows the matrix. */
do $$
begin
  if not exists (select 1 from public.access_gates where gate in ('signin', 'tiers') and key not in ('frontOffice', 'manager')) then
    update public.access_plans p
       set privileges = coalesce((select array_agg(g.key order by g.key) from public.access_gates g
                                   where g.gate <> 'free' and g.gate = any (p.features)), '{}'::text[])
     where cardinality(p.privileges) = 0;
    update public.access_gates
       set gate = case when gate = 'free' then 'signin' else 'tiers' end
     where key not in ('frontOffice', 'manager') and gate not in ('signin', 'tiers');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. GRANTS OF A TIER, CHECKOUTS THAT CARRY WHAT TO BUILD, SUBSCRIPTIONS THAT BUILT IT
-- ----------------------------------------------------------------------------
alter table public.access_grants add column if not exists plan_id uuid references public.access_plans(id) on delete cascade;
alter table public.access_grants drop constraint if exists access_grants_features_ck;
alter table public.access_grants add constraint access_grants_features_ck
  check (features <@ array['analytics', 'league', 'club_report', 'player_report']::text[]
         and (cardinality(features) > 0 or plan_id is not null));

alter table public.access_checkouts add column if not exists details jsonb;
alter table public.access_checkouts drop constraint if exists access_checkouts_details_ck;
alter table public.access_checkouts add constraint access_checkouts_details_ck
  check (details is null or (jsonb_typeof(details) = 'object' and pg_column_size(details) < 4000));

alter table public.access_subscriptions add column if not exists details jsonb;
alter table public.access_subscriptions add column if not exists provision jsonb;
alter table public.access_subscriptions add column if not exists provision_error text;
alter table public.access_subscriptions add column if not exists provisioned_at timestamptz;

alter table public.report_mail_subs add column if not exists access_subscription_id uuid references public.access_subscriptions(id) on delete set null;
alter table public.report_mail_players add column if not exists access_subscription_id uuid references public.access_subscriptions(id) on delete set null;
alter table public.report_mail_players add column if not exists user_id uuid references auth.users on delete set null;

alter table public.leagues add column if not exists setup_lapsed_at timestamptz;

/* ONE PDF, PAID ONCE: a credit for one download of one player's or club's report */
create table if not exists public.access_purchases (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users on delete cascade,
  plan_id               uuid references public.access_plans on delete set null,
  kind                  text not null check (kind in ('player_pdf', 'club_pdf')),
  subject_id            uuid not null,
  subject_name          text check (subject_name is null or char_length(subject_name) <= 120),
  amount_pennies        int not null check (amount_pennies >= 0),
  currency              text not null default 'gbp' check (currency ~ '^[a-z]{3}$'),
  stripe_session_id     text not null unique check (stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_payment_intent text,
  checkout_id           uuid,
  livemode              boolean not null default true,
  status                text not null default 'paid' check (status in ('paid', 'refunded')),
  paid_at               timestamptz not null default now(),
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists access_purchases_user_idx on public.access_purchases (user_id, kind, subject_id);
alter table public.access_purchases enable row level security;
drop policy if exists access_purchases_read on public.access_purchases;
create policy access_purchases_read on public.access_purchases for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
revoke all on table public.access_purchases from anon, authenticated;
grant select on table public.access_purchases to authenticated;
grant all on table public.access_purchases to service_role;

-- ----------------------------------------------------------------------------
-- 4. WHO HOLDS WHAT
-- ----------------------------------------------------------------------------

/* a plan's privileges with the tier it comes with */
create or replace function public.access_plan_privileges(p_plan uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(distinct k order by k) from (
      select unnest(p.privileges) k from access_plans p where p.id = p_plan
      union all
      select unnest(t.privileges) from access_plans p join access_plans t on t.id = p.includes_tier where p.id = p_plan
    ) x), '{}'::text[]);
$$;

/* the sections an old feature opened (a subscription or a grant made before the matrix, or a league's own plan) */
create or replace function public.access_feature_keys(p_features text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(distinct g.key order by g.key) from access_gates g
                    where ('analytics' = any (p_features) and g.category = 'analytics')
                       or ('club_report' = any (p_features) and g.key in ('clubReport', 'gameReport'))
                       or ('player_report' = any (p_features) and g.key = 'playerReport')), '{}'::text[]);
$$;

/* THE SECTIONS SOMEBODY HOLDS IN A LEAGUE (null: Epinoia's own, in no league). Staff every one: a platform
   administrator; a league's administrators, statisticians and writers there. Everyone else: what their live
   subscriptions' plans and their live grants' tiers name (with the tiers those come with), what their old features
   opened, and in a league that keeps its analytics free (its own setting) the analytics sections there. */
create or replace function public.access_privileges_for(p_user uuid, p_league uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then '{}'::text[]
    when exists (select 1 from memberships m where m.user_id = p_user and m.role = 'platform_admin' and m.scope_type = 'platform')
      or (p_league is not null and (
            exists (select 1 from memberships m
                     where m.user_id = p_user and m.role in ('league_admin', 'statistician')
                       and m.scope_type = 'league' and m.scope_id = p_league)
         or exists (select 1 from league_writers w where w.user_id = p_user and w.league_id = p_league)))
      then coalesce((select array_agg(g.key order by g.key) from access_gates g), '{}'::text[])
    else coalesce((
      select array_agg(distinct x.k order by x.k) from (
        /* a plan's ticks are what it opens; a plan with none (a league's own, or one older than the matrix) opens what
           its features opened */
        select unnest(case when cardinality(public.access_plan_privileges(s.plan_id)) > 0 then public.access_plan_privileges(s.plan_id)
                           else public.access_feature_keys(s.features) end) as k
          from access_subscriptions s
         where s.user_id = p_user
           and (s.league_id is null or s.league_id = p_league)
           and public.access_active(s.status, s.current_period_end, s.past_due_since)
        union all
        select unnest(case when g.plan_id is not null then public.access_plan_privileges(g.plan_id)
                           else public.access_feature_keys(g.features) end)
          from access_grants g
         where g.revoked_at is null
           and (g.expires_at is null or g.expires_at > now())
           and (g.league_id is null or g.league_id = p_league)
           and lower(g.email) = (select lower(u.email) from auth.users u where u.id = p_user)
        union all
        select g.key from access_gates g join leagues l on l.id = p_league
         where l.analytics_access = 'free' and g.category = 'analytics'
      ) x), '{}'::text[])
  end;
$$;

create or replace function public.access_privileges(p_league uuid default null)
returns text[] language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then '{}'::text[] else public.access_privileges_for(auth.uid(), p_league) end;
$$;

/* IS THE SECTION OPEN TO THE CALLER, HERE. Free first (open whatever the switch); then the master switch (off: open);
   an account for 'signin'; a league's administrators; the matrix for 'tiers'; the old gates as 0222 answered them. */
create or replace function public.gate_open(p_key text, p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case
    when public.gate_of(p_key) = 'free' then true
    when not public.memberships_enabled() then true
    when public.gate_of(p_key) = 'signin' then auth.uid() is not null
    when p_league is not null and coalesce(public.is_league_admin(p_league), false) then true
    when public.gate_of(p_key) = 'tiers' then p_key = any (public.access_privileges(p_league))
    when public.gate_of(p_key) = 'analytics' then public.can_use_analytics(p_league)
    else public.gate_of(p_key) = any (coalesce(public.access_features(p_league), '{}'::text[]))
  end, false);
$$;

/* the page's one call (0117's), with the sections held: at the top for no league, and in each league */
create or replace function public.access_state(p_leagues uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'signed_in', auth.uid() is not null,
    'memberships_enabled', public.memberships_enabled(),
    'analytics_default', public.access_analytics_mode(null),
    'analytics_ok', public.can_use_analytics(null),
    'privileges', to_jsonb(public.access_privileges(null)),
    'platform_admin', auth.uid() is not null and coalesce(public.is_platform_admin(), false),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id,
               'slug', l.slug,
               'name', l.name,
               'access_mode', l.access_mode,
               'fixtures_public', l.access_fixtures_public,
               'analytics', public.access_analytics_mode(l.id),
               'features', to_jsonb(public.access_features(l.id)),
               'privileges', to_jsonb(public.access_privileges(l.id)),
               'can_view', public.can_view_league(l.id),
               'analytics_ok', public.can_use_analytics(l.id),
               'has_plans', exists (select 1 from access_plans p
                                     where p.active and p.kind = 'tier'
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

/* can a plan be bought: a Stripe price of its own, or (Epinoia's) a price the checkout states itself */
create or replace function public.access_plan_purchasable(p_plan public.access_plans)
returns boolean language sql immutable as $$
  select p_plan.active and (p_plan.stripe_price_id is not null or (p_plan.seller = 'platform' and p_plan.price_pennies > 0));
$$;

/* the price list (0223's), with what each thing is and opens */
create or replace function public.access_plans_public(p_league uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'league_id', p.league_id,
           'kind', p.kind,
           'name', p.name,
           'blurb', p.blurb,
           'features', to_jsonb(p.features),
           'privileges', to_jsonb(public.access_plan_privileges(p.id)),
           'mail_kinds', to_jsonb(p.mail_kinds),
           'includes_tier', p.includes_tier,
           'includes_tier_name', (select t.name from access_plans t where t.id = p.includes_tier),
           'price_pennies', p.price_pennies,
           'currency', p.currency,
           'interval', p."interval",
           'sort', p.sort,
           'purchasable', public.access_plan_purchasable(p),
           'trial_months', case when p.kind = 'tier' then coalesce(p.trial_months, public.trial_months_default()) else 0 end)
         order by p.league_id nulls first, p.sort, p.price_pennies), '[]'::jsonb)
    from access_plans p
   where p.active
     and (p.league_id is null or p.league_id = p_league);
$$;

/* a free trial is a membership tier's (0223), never a pass's, a report subscription's or a league's */
create or replace function public.trial_months_for(p_user uuid, p_plan uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when p.id is null or not p.active or p.kind <> 'tier' then 0
    when p_user is not null and exists (
      select 1 from public.access_subscriptions s join public.access_plans q on q.id = s.plan_id
       where s.user_id = p_user and q.seller = p.seller and q.league_id is not distinct from p.league_id and q.kind = 'tier') then 0
    else coalesce(p.trial_months, public.trial_months_default())
  end
  from (select 1) one left join public.access_plans p on p.id = p_plan;
$$;

/* what every page reads (0223's): the rows with their place in the matrix, the shared words, the trial, the tiers on
   sale (each with what it opens) and the things sold on their own (the cheapest of each kind) */
create or replace function public.access_wall()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gates', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'gate', g.gate, 'category', g.category, 'sort', g.sort,
                                                           'title', g.title, 'lines', to_jsonb(g.lines)) order by g.sort, g.key)
                         from public.access_gates g), '[]'::jsonb),
    'copy', coalesce((select s.value from public.platform_settings s where s.key = 'access_copy' and s.is_public), '{}'::jsonb),
    'trial_months', public.trial_months_default(),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price_pennies', p.price_pennies,
                                                           'currency', p.currency, 'interval', p."interval",
                                                           'privileges', to_jsonb(public.access_plan_privileges(p.id)),
                                                           'purchasable', public.access_plan_purchasable(p))
                                        order by p.sort, p.price_pennies)
                         from public.access_plans p where p.active and p.kind = 'tier' and p.league_id is null), '[]'::jsonb),
    'products', coalesce((select jsonb_object_agg(x.kind, x.v) from (
                  select distinct on (p.kind) p.kind,
                         jsonb_build_object('id', p.id, 'name', p.name, 'price_pennies', p.price_pennies, 'currency', p.currency,
                                            'interval', p."interval", 'purchasable', public.access_plan_purchasable(p),
                                            'includes_tier_name', (select t.name from public.access_plans t where t.id = p.includes_tier)) v
                    from public.access_plans p
                   where p.active and p.kind <> 'tier' and p.league_id is null
                   order by p.kind, p.sort, p.price_pennies) x), '{}'::jsonb));
$$;

-- ----------------------------------------------------------------------------
-- 5. THE CONSOLE
-- ----------------------------------------------------------------------------

/* A PLAN, as 0220 saved one, with what it is (kind), the sections it opens (privileges), the emails it sends
   (mail_kinds), the tier it comes with (includes_tier) and a price paid once for a PDF ('once') */
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
  v_kind     text;
  v_features text[];
  v_privs    text[];
  v_mail     text[];
  v_incl     uuid;
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

  v_txt := nullif(btrim(coalesce(p->>'id', '')), '');
  if v_txt is not null then
    if v_txt !~ uuid_re then raise exception 'that plan id is not an id' using errcode = '22023'; end if;
    v_id := v_txt::uuid;
    select * into v_old from access_plans where id = v_id;
    if not found then raise exception 'no such plan' using errcode = '22023'; end if;
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
      if v_txt !~ uuid_re then raise exception 'that league id is not an id' using errcode = '22023'; end if;
      v_league := v_txt::uuid;
    end if;
  end if;

  if v_league is null then
    if not v_platform then
      raise exception 'only a platform administrator may create or change a platform plan' using errcode = '42501';
    end if;
  else
    if not public.is_league_admin(v_league) then raise exception 'you do not administer that league' using errcode = '42501'; end if;
    if not exists (select 1 from leagues l where l.id = v_league) then raise exception 'no such league' using errcode = '22023'; end if;
    if not v_platform and v_old.id is not null and v_old.seller <> 'league' then
      raise exception 'Epinoia sells this plan, so only a platform administrator may change it' using errcode = '42501';
    end if;
  end if;

  v_kind := case when p ? 'kind' then lower(btrim(coalesce(p->>'kind', ''))) else coalesce(v_old.kind, 'tier') end;
  if v_kind not in ('tier', 'manager', 'player_mail', 'team_mail', 'league_setup', 'player_pdf', 'club_pdf') then
    raise exception 'a plan is a tier, a manager pass, player or club report emails, a league, or a player or club PDF' using errcode = '22023';
  end if;
  if v_old.id is not null and v_old.kind <> v_kind then
    raise exception 'a plan stays the kind of thing it was created as; archive it and create a new one instead' using errcode = '22023';
  end if;
  if v_kind <> 'tier' and v_league is not null then
    raise exception 'only a membership tier can belong to one league; everything else is Epinoia''s' using errcode = '22023';
  end if;

  v_name := case when p ? 'name' then btrim(coalesce(p->>'name', '')) else v_old.name end;
  if v_name is null or char_length(v_name) not between 1 and 60 then
    raise exception 'a plan needs a name of 1 to 60 characters' using errcode = '22023';
  end if;
  v_blurb := case when p ? 'blurb' then nullif(btrim(coalesce(p->>'blurb', '')), '') else v_old.blurb end;
  if v_blurb is not null and char_length(v_blurb) > 400 then
    raise exception 'a plan''s description is at most 400 characters' using errcode = '22023';
  end if;

  if p ? 'features' then
    if jsonb_typeof(p->'features') <> 'array' then raise exception 'features are a list, such as ["analytics"]' using errcode = '22023'; end if;
    select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}'::text[]) into v_features
      from jsonb_array_elements_text(p->'features') as x where btrim(x) <> '';
  else
    v_features := coalesce(v_old.features, '{}'::text[]);
  end if;
  if not v_features <@ array['analytics', 'league', 'club_report', 'player_report']::text[] then
    raise exception 'a plan can unlock "analytics", "league", "club_report" and "player_report", and nothing else' using errcode = '22023';
  end if;
  if v_league is null and 'league' = any (v_features) then
    raise exception 'a platform plan cannot unlock a members-only league: each league decides who gets in, so the league is sold only on that league''s own plans'
      using errcode = '22023';
  end if;
  if v_league is not null and cardinality(v_features) = 0 then
    raise exception 'a plan unlocks at least one thing: analytics, the league, the club report or the player report' using errcode = '22023';
  end if;
  if v_kind <> 'tier' and cardinality(v_features) > 0 then
    raise exception 'only a membership tier carries features; a pass or a product opens sections through its privileges' using errcode = '22023';
  end if;

  if p ? 'privileges' then
    if jsonb_typeof(p->'privileges') <> 'array' then raise exception 'privileges are a list of section keys' using errcode = '22023'; end if;
    select coalesce(array_agg(distinct btrim(x) order by btrim(x)), '{}'::text[]) into v_privs
      from jsonb_array_elements_text(p->'privileges') as x where btrim(x) <> '';
  else
    v_privs := coalesce(v_old.privileges, case when v_kind = 'manager' then array['manager'] else '{}'::text[] end);
  end if;
  if exists (select 1 from unnest(v_privs) k where not exists (select 1 from access_gates g where g.key = k)) then
    raise exception 'privileges name the sections of the matrix (access_gates), and one of these is not one' using errcode = '22023';
  end if;
  if v_kind in ('player_pdf', 'club_pdf') and cardinality(v_privs) > 0 then
    raise exception 'a PDF bought once opens one download, not a section' using errcode = '22023';
  end if;

  if p ? 'mail_kinds' then
    if jsonb_typeof(p->'mail_kinds') <> 'array' then raise exception 'mail_kinds are a list' using errcode = '22023'; end if;
    select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}'::text[]) into v_mail
      from jsonb_array_elements_text(p->'mail_kinds') as x where btrim(x) <> '';
  else
    v_mail := coalesce(v_old.mail_kinds, case when v_kind = 'player_mail' then array['weekly'] when v_kind = 'team_mail'
                                              then array['games', 'opponents', 'own', 'zip'] else '{}'::text[] end);
  end if;
  if v_kind = 'player_mail' and not (v_mail <@ array['weekly', 'matchups']::text[] and 'weekly' = any (v_mail)) then
    raise exception 'a player''s report emails send the weekly report, and may add the match-up reports' using errcode = '22023';
  end if;
  if v_kind = 'team_mail' and not (v_mail <@ array['games', 'opponents', 'own', 'zip']::text[] and cardinality(v_mail) > 0) then
    raise exception 'a club''s report emails send any of: the game analyses, the opponents'' scouting reports, its own report, the players'' ZIP' using errcode = '22023';
  end if;
  if v_kind not in ('player_mail', 'team_mail') and cardinality(v_mail) > 0 then
    raise exception 'only report emails send emails' using errcode = '22023';
  end if;

  if p ? 'includes_tier' then
    v_txt := nullif(btrim(coalesce(p->>'includes_tier', '')), '');
    if v_txt is not null and v_txt !~ uuid_re then raise exception 'that tier id is not an id' using errcode = '22023'; end if;
    v_incl := v_txt::uuid;
  else
    v_incl := v_old.includes_tier;
  end if;
  if v_incl is not null then
    if not v_platform then raise exception 'only a platform administrator may give a tier with something' using errcode = '42501'; end if;
    if v_old.id is not null and v_incl = v_old.id then raise exception 'a plan cannot come with itself' using errcode = '22023'; end if;
    if not exists (select 1 from access_plans t where t.id = v_incl and t.kind = 'tier' and t.league_id is null) then
      raise exception 'a plan comes with one of Epinoia''s membership tiers' using errcode = '22023';
    end if;
  end if;

  if p ? 'price_pennies' then
    v_txt := btrim(coalesce(p->>'price_pennies', ''));
    if v_txt !~ '^[0-9]{1,9}$' then raise exception 'the price is a whole number of pennies, 0 or more' using errcode = '22023'; end if;
    v_price := v_txt::int;
  else
    v_price := v_old.price_pennies;
  end if;
  if v_price is null then raise exception 'a plan needs a price in pennies' using errcode = '22023'; end if;

  v_currency := case when p ? 'currency' then lower(btrim(coalesce(p->>'currency', ''))) else coalesce(v_old.currency, 'gbp') end;
  if v_currency !~ '^[a-z]{3}$' then raise exception 'the currency is a three-letter code, such as gbp' using errcode = '22023'; end if;

  v_interval := case when v_kind in ('player_pdf', 'club_pdf') then 'once'
                     when p ? 'interval' then lower(btrim(coalesce(p->>'interval', ''))) else coalesce(v_old."interval", 'month') end;
  if v_kind not in ('player_pdf', 'club_pdf') and v_interval not in ('month', 'year') then
    raise exception 'a plan renews every "month" or every "year"' using errcode = '22023';
  end if;

  if p ? 'stripe_price_id' then
    v_price_id := nullif(btrim(coalesce(p->>'stripe_price_id', '')), '');
    if v_price_id is not null and v_price_id !~ '^price_[A-Za-z0-9]+$' then
      raise exception 'a Stripe price id looks like price_1AbC2dE; copy it from the price''s page in Stripe' using errcode = '22023';
    end if;
  else
    v_price_id := v_old.stripe_price_id;
  end if;

  v_txt := nullif(lower(btrim(coalesce(p->>'seller', ''))), '');
  v_seller := coalesce(v_txt, v_old.seller, case when v_league is null then 'platform' else 'league' end);
  if v_seller not in ('platform', 'league') then raise exception 'a plan is sold by "platform" or by "league"' using errcode = '22023'; end if;
  if v_league is null and v_seller <> 'platform' then raise exception 'a platform plan is always sold by Epinoia' using errcode = '22023'; end if;
  if v_league is not null and v_seller = 'platform' and not v_platform then
    raise exception 'only a platform administrator may make Epinoia the seller of a league''s plan' using errcode = '42501';
  end if;
  if v_seller = 'league' and v_features && array['analytics', 'club_report', 'player_report']::text[] and v_price = 0 then
    raise exception 'the analytics and the reports are Epinoia''s, so a plan the league sells cannot include them for nothing: set a price, or take them out of the plan'
      using errcode = '22023';
  end if;

  if p ? 'active' then
    if jsonb_typeof(p->'active') <> 'boolean' then raise exception 'active is true or false' using errcode = '22023'; end if;
    v_active := (p->>'active')::boolean;
  else
    v_active := coalesce(v_old.active, true);
  end if;
  if p ? 'sort' then
    v_txt := btrim(coalesce(p->>'sort', ''));
    if v_txt !~ '^-?[0-9]{1,6}$' then raise exception 'sort is a whole number' using errcode = '22023'; end if;
    v_sort := v_txt::int;
  else
    v_sort := coalesce(v_old.sort, 0);
  end if;

  if v_old.id is null then
    insert into access_plans (league_id, kind, name, blurb, features, privileges, mail_kinds, includes_tier, price_pennies, currency,
                              "interval", stripe_price_id, seller, active, sort)
    values (v_league, v_kind, v_name, v_blurb, v_features, v_privs, v_mail, v_incl, v_price, v_currency,
            v_interval, v_price_id, v_seller, v_active, v_sort)
    returning id into v_id;
  else
    update access_plans
       set name = v_name, blurb = v_blurb, features = v_features, privileges = v_privs, mail_kinds = v_mail,
           includes_tier = v_incl, price_pennies = v_price, currency = v_currency, "interval" = v_interval,
           stripe_price_id = v_price_id, seller = v_seller, active = v_active, sort = v_sort, updated_at = now()
     where id = v_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'save_access_plan', 'access_plan', v_id::text,
          jsonb_build_object('created', v_old.id is null, 'league_id', v_league, 'kind', v_kind,
                             'name', v_name, 'features', to_jsonb(v_features), 'privileges', to_jsonb(v_privs),
                             'mail_kinds', to_jsonb(v_mail), 'includes_tier', v_incl,
                             'price_pennies', v_price, 'currency', v_currency,
                             'interval', v_interval, 'seller', v_seller,
                             'active', v_active, 'has_price', v_price_id is not null));
  return v_id;
end; $$;

/* THE MATRIX, SAVED AT ONCE: { "gates": { key: "free" | "signin" | "tiers" }, "tiers": { plan id: [keys] } }. Only
   rows that exist; only Epinoia's tiers; audited. */
create or replace function public.platform_save_matrix(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  k text; v text; t text; keys text[];
begin
  if not public.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'the matrix is sent as an object' using errcode = '22023'; end if;
  if p ? 'gates' then
    if jsonb_typeof(p->'gates') <> 'object' then raise exception 'gates are { key: free | signin | tiers }' using errcode = '22023'; end if;
    for k, v in select key, value #>> '{}' from jsonb_each(p->'gates') loop
      if not exists (select 1 from access_gates g where g.key = k) then raise exception 'no such section: %', k using errcode = '22023'; end if;
      if v not in ('free', 'signin', 'tiers') then raise exception 'a section is free, for accounts, or for the tiers ticked' using errcode = '22023'; end if;
      update access_gates set gate = v, updated_at = now(), updated_by = auth.uid() where key = k and gate is distinct from v;
    end loop;
  end if;
  if p ? 'tiers' then
    if jsonb_typeof(p->'tiers') <> 'object' then raise exception 'tiers are { plan id: [keys] }' using errcode = '22023'; end if;
    for t in select key from jsonb_each(p->'tiers') loop
      if t !~ '^[0-9a-fA-F-]{36}$' or not exists (select 1 from access_plans q where q.id = t::uuid and q.league_id is null and q.kind in ('tier', 'manager')) then
        raise exception 'a column of the matrix is one of Epinoia''s tiers' using errcode = '22023';
      end if;
      if jsonb_typeof(p->'tiers'->t) <> 'array' then raise exception 'a tier''s sections are a list' using errcode = '22023'; end if;
      select coalesce(array_agg(distinct x order by x), '{}'::text[]) into keys from jsonb_array_elements_text(p->'tiers'->t) x;
      if exists (select 1 from unnest(keys) x where not exists (select 1 from access_gates g where g.key = x)) then
        raise exception 'a tier opens sections of the matrix, and one of these is not one' using errcode = '22023';
      end if;
      update access_plans set privileges = keys, updated_at = now() where id = t::uuid;
    end loop;
  end if;
  insert into audit_log (actor, action, subject, subject_id, detail) values (auth.uid(), 'access_matrix', 'matrix', 'platform', p);
  return 'saved';
end $$;

/* a section's teaser words (0222's platform_set_gate), with the matrix's gates: the console saves the words with the
   gate the matrix gave the row */
create or replace function public.platform_set_gate(p_key text, p_gate text, p_title text default null, p_lines text[] default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_lines text[];
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.access_gates where key = p_key) then
    raise exception 'no such section: %', p_key using errcode = '22023';
  end if;
  if p_gate is null or p_gate not in ('free', 'signin', 'tiers', 'analytics', 'club_report', 'player_report') then
    raise exception 'a section is free, for accounts, or for the tiers ticked' using errcode = '22023';
  end if;
  select array_agg(btrim(l)) into v_lines from unnest(coalesce(p_lines, '{}'::text[])) l where btrim(l) <> '';
  update public.access_gates
     set gate = p_gate, title = nullif(btrim(coalesce(p_title, '')), ''), lines = v_lines,
         updated_at = now(), updated_by = auth.uid()
   where key = p_key;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'access_gate', 'gate', p_key, jsonb_build_object('gate', p_gate, 'title', p_title, 'lines', to_jsonb(v_lines)));
  return 'saved';
end $$;

/* A TIER GIVEN BY EMAIL, as grant_access gives features (0117): whoever signs in with the address holds it until it
   expires or is revoked. Platform administrators only. */
create or replace function public.grant_tier(p_email text, p_plan uuid, p_expires timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_id    uuid;
begin
  if not public.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address' using errcode = '22023';
  end if;
  if not exists (select 1 from access_plans q where q.id = p_plan and q.league_id is null and q.kind in ('tier', 'manager')) then
    raise exception 'grant one of Epinoia''s tiers' using errcode = '22023';
  end if;
  if p_expires is not null and p_expires <= now() then raise exception 'that expiry has already passed' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 400 then raise exception 'a note is at most 400 characters' using errcode = '22023'; end if;
  insert into access_grants (league_id, email, features, plan_id, note, granted_by, expires_at)
  values (null, v_email, '{}'::text[], p_plan, v_note, auth.uid(), p_expires)
  returning id into v_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_tier', 'access_grant', v_id::text, jsonb_build_object('email', v_email, 'plan_id', p_plan, 'expires_at', p_expires));
  return v_id;
end $$;

/* the Plans tab (0117's) with every plan's kind, privileges, emails and tier, each section's row of the matrix, and
   what each subscription that builds something built */
create or replace function public.platform_access_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'platform administrators only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'memberships_enabled', public.memberships_enabled(),
    'analytics_default', public.access_analytics_configured(null),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'league_id', p.league_id, 'league_name', l.name, 'kind', p.kind,
               'name', p.name, 'blurb', p.blurb, 'features', to_jsonb(p.features),
               'privileges', to_jsonb(p.privileges), 'mail_kinds', to_jsonb(p.mail_kinds), 'includes_tier', p.includes_tier,
               'price_pennies', p.price_pennies, 'currency', p.currency,
               'interval', p."interval", 'seller', p.seller, 'active', p.active,
               'sort', p.sort, 'has_price', p.stripe_price_id is not null,
               'purchasable', public.access_plan_purchasable(p),
               'stripe_price_id', p.stripe_price_id, 'trial_months', p.trial_months,
               'holders', (select count(*)::int from access_subscriptions s where s.plan_id = p.id
                            and public.access_active(s.status, s.current_period_end, s.past_due_since))
                        + (select count(*)::int from access_purchases u where u.plan_id = p.id and u.status = 'paid'),
               'created_at', p.created_at, 'updated_at', p.updated_at)
             order by p.league_id nulls first, l.name, p.kind, p.active desc, p.sort, p.price_pennies)
        from access_plans p
        left join leagues l on l.id = p.league_id), '[]'::jsonb),
    'gates', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'gate', g.gate, 'category', g.category, 'sort', g.sort,
                                                           'title', g.title, 'lines', to_jsonb(g.lines)) order by g.sort, g.key)
                         from access_gates g), '[]'::jsonb),
    'built', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'kind', p.kind, 'plan_name', p.name, 'status', s.status,
               'active', public.access_active(s.status, s.current_period_end, s.past_due_since),
               'details', s.details, 'provision', s.provision, 'error', s.provision_error,
               'email', (select u.email from auth.users u where u.id = s.user_id), 'created_at', s.created_at)
             order by s.created_at desc)
        from access_subscriptions s join access_plans p on p.id = s.plan_id
       where p.kind in ('player_mail', 'team_mail', 'league_setup')), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'subject_id', u.subject_id, 'subject_name', u.subject_name,
               'amount_pennies', u.amount_pennies, 'currency', u.currency, 'status', u.status, 'paid_at', u.paid_at,
               'used_at', u.used_at, 'livemode', u.livemode,
               'email', (select x.email from auth.users x where x.id = u.user_id)) order by u.paid_at desc)
        from (select * from access_purchases order by paid_at desc limit 200) u), '[]'::jsonb),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'slug', l.slug, 'name', l.name,
               'access_mode', l.access_mode,
               'fixtures_public', l.access_fixtures_public,
               'analytics_access', l.analytics_access,
               'fee_percent', coalesce(b.fee_percent, 10),
               'active_members', (select count(*)::int from access_subscriptions s
                                   where s.league_id = l.id
                                     and public.access_active(s.status, s.current_period_end, s.past_due_since)),
               'plans', (select count(*)::int from access_plans p where p.league_id = l.id and p.active))
             order by l.name)
        from leagues l
        left join league_billing_accounts b on b.league_id = l.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'active_subscriptions', (select count(*)::int from access_subscriptions s where s.status in ('active', 'trialing')),
      'past_due', (select count(*)::int from access_subscriptions s where s.status = 'past_due'),
      'grants', (select count(*)::int from access_grants g
                  where g.revoked_at is null and (g.expires_at is null or g.expires_at > now())),
      'pdfs_sold', (select count(*)::int from access_purchases u where u.status = 'paid'))
  );
end; $$;

-- ----------------------------------------------------------------------------
-- 6. WHAT A SUBSCRIPTION BUILDS
-- ----------------------------------------------------------------------------

/* Builds (or switches back on) what a live subscription of a building kind is for, and takes it away when it is not
   live. Idempotent: run on every write of the row. Never raises: a problem is kept on the row (provision_error), and
   the payment stands. Service role only. */
create or replace function public.billing_provision(p_sub uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        public.access_subscriptions;
  p        public.access_plans;
  d        jsonb;
  v_live   boolean;
  v_prov   jsonb;
  v_email  text;
  v_id     uuid;
  v_slug   text;
  v_name   text;
  v_tz     text;
begin
  select * into s from access_subscriptions where id = p_sub for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no such subscription'); end if;
  select * into p from access_plans where id = s.plan_id;
  if not found or p.kind not in ('player_mail', 'team_mail', 'league_setup') then return jsonb_build_object('ok', true, 'built', false); end if;
  d := coalesce(s.details, '{}'::jsonb);
  v_prov := coalesce(s.provision, '{}'::jsonb);
  v_live := public.access_active(s.status, s.current_period_end, s.past_due_since);
  begin
    v_email := lower(btrim(coalesce(nullif(d->>'email', ''), (select u.email from auth.users u where u.id = s.user_id))));
    v_tz := coalesce(nullif(btrim(coalesce(d->>'tz', '')), ''), 'UTC');
    if v_tz !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' then v_tz := 'UTC'; end if;
    v_name := nullif(btrim(coalesce(d->>'name', '')), '');
    if v_name is not null then v_name := left(v_name, 60); end if;

    if p.kind = 'player_mail' then
      if v_live then
        if (d->>'player_id') is null or not exists (select 1 from players x where x.id = (d->>'player_id')::uuid) then
          raise exception 'the player to send the reports of is not there';
        end if;
        insert into report_mail_players (email, name, player_id, tz, active, send_matchups, user_id, access_subscription_id)
        values (v_email, v_name, (d->>'player_id')::uuid, v_tz, true, 'matchups' = any (p.mail_kinds), s.user_id, s.id)
        on conflict (email, player_id) do update
          set active = true, tz = excluded.tz, name = coalesce(excluded.name, report_mail_players.name),
              send_matchups = excluded.send_matchups, user_id = excluded.user_id,
              access_subscription_id = excluded.access_subscription_id, trial_until = null
        returning id into v_id;
        v_prov := jsonb_build_object('mail_player_id', v_id);
      elsif v_prov ? 'mail_player_id' then
        update report_mail_players set active = false where id = (v_prov->>'mail_player_id')::uuid and access_subscription_id = s.id;
      end if;

    elsif p.kind = 'team_mail' then
      if v_live then
        if (d->>'team_id') is null or not exists (select 1 from teams x where x.id = (d->>'team_id')::uuid) then
          raise exception 'the club to send the reports of is not there';
        end if;
        insert into report_mail_subs (email, name, team_id, tz, active, user_id, send_games, send_opponents, send_own, player_zip, access_subscription_id)
        values (v_email, v_name, (d->>'team_id')::uuid, v_tz, true, s.user_id,
                'games' = any (p.mail_kinds), 'opponents' = any (p.mail_kinds), 'own' = any (p.mail_kinds), 'zip' = any (p.mail_kinds), s.id)
        on conflict (email, team_id) do update
          set active = true, tz = excluded.tz, name = coalesce(excluded.name, report_mail_subs.name), user_id = excluded.user_id,
              send_games = excluded.send_games, send_opponents = excluded.send_opponents, send_own = excluded.send_own,
              player_zip = excluded.player_zip, access_subscription_id = excluded.access_subscription_id, trial_until = null
        returning id into v_id;
        v_prov := jsonb_build_object('mail_sub_id', v_id);
      elsif v_prov ? 'mail_sub_id' then
        update report_mail_subs set active = false where id = (v_prov->>'mail_sub_id')::uuid and access_subscription_id = s.id;
      end if;

    else  -- league_setup
      if v_live then
        if v_prov ? 'league_id' and exists (select 1 from leagues l where l.id = (v_prov->>'league_id')::uuid) then
          v_id := (v_prov->>'league_id')::uuid;
        else
          v_name := btrim(coalesce(d->>'league_name', ''));
          if char_length(v_name) not between 2 and 60 then raise exception 'the league needs a name of 2 to 60 characters'; end if;
          v_slug := lower(btrim(coalesce(d->>'slug', '')));
          if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 40 then
            v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
          end if;
          if v_slug = '' then v_slug := 'league'; end if;
          while exists (select 1 from leagues l where l.slug = v_slug) loop
            v_slug := left(v_slug, 34) || '-' || substr(md5(random()::text), 1, 5);
          end loop;
          insert into leagues (slug, name, colour_a, colour_b, public_live, youth_protected, visibility)
          values (v_slug, v_name,
                  case when coalesce(d->>'colour', '') ~ '^#[0-9a-fA-F]{6}$' then d->>'colour' else '#93f2bf' end, '#8ff5ff',
                  true, true, 'private')
          returning id into v_id;
          perform public.ensure_first_competition(v_id);
          insert into audit_log (actor, action, subject, subject_id, detail)
          values (s.user_id, 'create_league', 'league', v_id::text,
                  jsonb_build_object('slug', v_slug, 'name', v_name, 'paid', true, 'subscription', s.id));
        end if;
        insert into memberships (user_id, role, scope_type, scope_id)
        values (s.user_id, 'league_admin', 'league', v_id)
        on conflict do nothing;
        update leagues set setup_lapsed_at = null where id = v_id and setup_lapsed_at is not null;
        v_prov := jsonb_build_object('league_id', v_id);
      elsif v_prov ? 'league_id' then
        v_id := (v_prov->>'league_id')::uuid;
        delete from memberships m
         where m.user_id = s.user_id and m.role = 'league_admin' and m.scope_type = 'league' and m.scope_id = v_id;
        perform set_config('epinoia.visibility_rpc', 'on', true);
        update leagues set visibility = 'private', setup_lapsed_at = coalesce(setup_lapsed_at, now()) where id = v_id;
        perform set_config('epinoia.visibility_rpc', '', true);
      end if;
    end if;

    update access_subscriptions set provision = v_prov, provision_error = null, provisioned_at = now() where id = s.id;
    return jsonb_build_object('ok', true, 'built', v_live, 'provision', v_prov);
  exception when others then
    update access_subscriptions set provision_error = left(sqlerrm, 400) where id = s.id;
    return jsonb_build_object('ok', false, 'why', sqlerrm);
  end;
end $$;

/* THE WEBHOOK'S WRITE (0117's), with what to build: the checkout's details copied onto a new row (only a checkout of
   this member's, for this plan), and billing_provision run after every write. Everything else as 0117. */
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
  v_checkout   uuid;
  v_details    jsonb;
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
  v_txt := nullif(btrim(coalesce(p_row->>'checkout_id', '')), '');
  if v_txt is not null and v_txt ~ uuid_re then v_checkout := v_txt::uuid; end if;

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
    select c.details into v_details from access_checkouts c
     where c.id = v_checkout and c.user_id = v_user and c.plan_id = v_plan.id;

    begin
      insert into access_subscriptions (
        user_id, plan_id, league_id, features, status, stripe_subscription_id,
        stripe_customer_id, stripe_account_id, current_period_end, cancel_at_period_end,
        cancel_at, trial_end, ended_at, livemode, cooling_off_waived_at,
        past_due_since, welcomed_at, synced_at, details)
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
        p_fetched_at,
        v_details)
      returning * into v_new;
      v_created := true;
    exception when unique_violation then
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

    select * into v_plan from access_plans where id = coalesce(v_plan_id, v_old.plan_id);
    if v_old.details is null and v_checkout is not null then
      select c.details into v_details from access_checkouts c
       where c.id = v_checkout and c.user_id = v_old.user_id and c.plan_id = v_old.plan_id;
    end if;

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
           synced_at             = p_fetched_at,
           details               = coalesce(s.details, v_details)
     where s.id = v_old.id
    returning * into v_new;
  end if;

  /* what it is for, built or taken away (never raises) */
  perform public.billing_provision(v_new.id);

  return jsonb_build_object(
    'applied', true,
    'id', v_new.id,
    'first_active', v_new.status in ('active', 'trialing') and not v_welcomed,
    'ending_started', not v_cancelling
                      and (v_new.cancel_at_period_end or v_new.cancel_at is not null),
    'ended', not v_was_ended and v_new.status = any (ended_words));
end; $$;

-- ----------------------------------------------------------------------------
-- 7. A PDF PAID FOR ONCE
-- ----------------------------------------------------------------------------

/* the webhook's write for a paid one-off checkout: once per Stripe session. Service role only. */
create or replace function public.billing_record_purchase(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_plan public.access_plans;
  v_id   uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'a purchase is sent as an object' using errcode = '22023'; end if;
  if coalesce(p->>'user_id', '') !~ uuid_re or coalesce(p->>'subject_id', '') !~ uuid_re or coalesce(p->>'plan_id', '') !~ uuid_re then
    raise exception 'a purchase names its buyer, its plan and what it is of' using errcode = '22023';
  end if;
  select * into v_plan from access_plans where id = (p->>'plan_id')::uuid;
  if not found or v_plan.kind not in ('player_pdf', 'club_pdf') then
    raise exception 'that plan is not a PDF sold once' using errcode = '22023';
  end if;
  insert into access_purchases (user_id, plan_id, kind, subject_id, subject_name, amount_pennies, currency, stripe_session_id,
                                stripe_payment_intent, checkout_id, livemode)
  values ((p->>'user_id')::uuid, v_plan.id, v_plan.kind, (p->>'subject_id')::uuid, left(nullif(p->>'subject_name', ''), 120),
          coalesce((p->>'amount_pennies')::int, v_plan.price_pennies), coalesce(nullif(p->>'currency', ''), v_plan.currency),
          p->>'stripe_session_id', nullif(p->>'stripe_payment_intent', ''),
          case when coalesce(p->>'checkout_id', '') ~ uuid_re then (p->>'checkout_id')::uuid end,
          coalesce((p->>'livemode')::boolean, true))
  on conflict (stripe_session_id) do nothing
  returning id into v_id;
  return jsonb_build_object('recorded', v_id is not null, 'id', v_id);
end $$;

/* a refund (charge.refunded): the credit goes, used or not */
create or replace function public.billing_refund_purchase(p_payment_intent text)
returns int language sql security definer set search_path = public as $$
  with r as (update access_purchases set status = 'refunded' where stripe_payment_intent = p_payment_intent and status = 'paid' returning 1)
  select count(*)::int from r;
$$;

/* THE PDF, DRAWN BY THE SERVER: each paid purchase a render job */
alter table public.access_purchases add column if not exists render_state text not null default 'queued';
alter table public.access_purchases drop constraint if exists access_purchases_render_ck;
alter table public.access_purchases add constraint access_purchases_render_ck check (render_state in ('queued', 'running', 'done', 'failed'));
alter table public.access_purchases add column if not exists render_attempts int not null default 0;
alter table public.access_purchases add column if not exists render_error text;
alter table public.access_purchases add column if not exists render_started_at timestamptz;
alter table public.access_purchases add column if not exists rendered_at timestamptz;
-- when the live lane last started the report worker for it (scripts/ingest/console_kick.py, kind pdf), so it is not started again
-- every two minutes while a run is on its way
alter table public.access_purchases add column if not exists dispatched_at timestamptz;

/* ...kept as a file of the buyer's own (0225's report_files took an address's files only) */
alter table public.report_files alter column sub_id drop not null;
alter table public.report_files add column if not exists user_id uuid references auth.users on delete cascade;
alter table public.report_files add column if not exists purchase_id uuid references public.access_purchases(id) on delete cascade;
alter table public.report_files drop constraint if exists report_files_kind_check;
alter table public.report_files drop constraint if exists report_files_kind_ck;
alter table public.report_files add constraint report_files_kind_ck check (kind in ('game', 'opp', 'team', 'player_pdf', 'club_pdf'));
alter table public.report_files drop constraint if exists report_files_owner_ck;
alter table public.report_files add constraint report_files_owner_ck check (sub_id is not null or user_id is not null);
create unique index if not exists report_files_purchase_uq on public.report_files (purchase_id) where purchase_id is not null;

/* the caller's latest PDF of this report, as it stands: { id, state, paid_at, rendered_at, ready }, or null */
create or replace function public.my_pdf_purchase(p_kind text, p_subject uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select (select jsonb_build_object('id', u.id, 'state', u.render_state, 'paid_at', u.paid_at, 'rendered_at', u.rendered_at,
                                    'ready', u.render_state = 'done')
            from access_purchases u
           where u.user_id = auth.uid() and u.kind = p_kind and u.subject_id = p_subject and u.status = 'paid'
           order by u.paid_at desc limit 1);
$$;

/* THE REPORT WORKER TAKES THE JOBS: queued ones, and one left running half an hour (a worker that died), each at most
   three times; answers what to draw and where to send it. Service role only. */
create or replace function public.pdf_render_claim(p_limit int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with c as (
    select u.id from access_purchases u
     where u.status = 'paid' and u.render_attempts < 3
       and (u.render_state = 'queued' or (u.render_state = 'running' and u.render_started_at < now() - interval '30 minutes'))
     order by u.paid_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  ), t as (
    update access_purchases u set render_state = 'running', render_started_at = now(), render_attempts = u.render_attempts + 1
      from c where u.id = c.id
    returning u.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'kind', t.kind, 'subject_id', t.subject_id,
           'subject_name', t.subject_name, 'paid_at', t.paid_at, 'attempt', t.render_attempts,
           'email', (select x.email from auth.users x where x.id = t.user_id),
           'slug', case when t.kind = 'player_pdf' then (select pl.slug from players pl where pl.id = t.subject_id)
                        else (select tm.slug from teams tm where tm.id = t.subject_id) end)), '[]'::jsonb)
    into v from t;
  return v;
end $$;

/* drawn and kept: the file is the buyer's (their dashboard), the job done */
create or replace function public.pdf_render_done(p_id uuid, p_path text, p_bytes int, p_title text, p_subtitle text)
returns boolean language plpgsql security definer set search_path = public as $$
declare u public.access_purchases;
begin
  select * into u from access_purchases where id = p_id for update;
  if not found then return false; end if;
  insert into report_files (sub_id, user_id, purchase_id, kind, ref, title, subtitle, path, bytes)
  values (null, u.user_id, u.id, u.kind, u.id::text, left(coalesce(nullif(p_title, ''), 'Report'), 200), left(p_subtitle, 300), p_path, p_bytes)
  on conflict (purchase_id) where purchase_id is not null do update set path = excluded.path, bytes = excluded.bytes, made_at = now();
  update access_purchases set render_state = 'done', rendered_at = now(), render_error = null where id = p_id;
  return true;
end $$;

/* not drawn: queued again for the next run while it has tries left, else failed (the console lists it) */
create or replace function public.pdf_render_failed(p_id uuid, p_error text)
returns text language sql security definer set search_path = public as $$
  update access_purchases set render_state = case when render_attempts >= 3 then 'failed' else 'queued' end,
         render_error = left(p_error, 400) where id = p_id
  returning render_state;
$$;

/* THE WORKER'S PAGE IS UNLOCKED BY A TICKET THE DATABASE MADE FOR IT (a flag a reader could set in their own browser
   unlocked nothing ever since): the worker asks for one with the service key, its page asks whether it is good */
create table if not exists public.report_bot_tickets (
  ticket  text primary key,
  made_at timestamptz not null default now()
);
alter table public.report_bot_tickets enable row level security;
revoke all on table public.report_bot_tickets from anon, authenticated;
grant all on table public.report_bot_tickets to service_role;
create or replace function public.report_bot_ticket()
returns text language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  delete from report_bot_tickets where made_at < now() - interval '1 day';
  insert into report_bot_tickets (ticket) values (v);
  return v;
end $$;
create or replace function public.report_bot_ok(p_ticket text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(char_length(p_ticket) = 64 and exists (select 1 from report_bot_tickets t where t.ticket = p_ticket and t.made_at > now() - interval '6 hours'), false);
$$;

/* the dashboard's files (0225's), with the account's own: the PDFs it bought */
create or replace function public.report_path_mine(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.report_files f
                  where f.path = p_path
                    and ((f.sub_id is not null and public.report_sub_mine(f.sub_id)) or (f.user_id is not null and f.user_id = auth.uid())));
$$;
create or replace function public.my_reports(p_limit int default 120)
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select s.id, s.team_id, s.active from public.report_mail_subs s where public.report_sub_mine(s.id)
  ), files as (
    select f.id, f.kind, f.title, f.subtitle, f.path, f.bytes, f.made_at, f.seen_at, t.name as club
      from public.report_files f join mine m on m.id = f.sub_id
      left join public.teams t on t.id = m.team_id
    union all
    select f.id, f.kind, f.title, f.subtitle, f.path, f.bytes, f.made_at, f.seen_at, null
      from public.report_files f
     where auth.uid() is not null and f.user_id = auth.uid()
  )
  select jsonb_build_object(
    'linked', exists (select 1 from mine) or exists (select 1 from public.report_files f where auth.uid() is not null and f.user_id = auth.uid()),
    'clubs', coalesce((select jsonb_agg(distinct jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'colour', t.colour,
                                                                     'logo_path', t.logo_path, 'active', m.active))
                         from mine m join public.teams t on t.id = m.team_id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(x order by x.made_at desc) from (
                         select * from files order by made_at desc
                          limit greatest(1, least(coalesce(p_limit, 120), 500))) x), '[]'::jsonb));
$$;
create or replace function public.report_seen(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update public.report_files f set seen_at = now()
   where f.id = any (coalesce(p_ids, '{}'::uuid[])) and f.seen_at is null
     and ((f.sub_id is not null and public.report_sub_mine(f.sub_id)) or f.user_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- 8. THE BUYER'S OWN PAGES
-- ----------------------------------------------------------------------------

/* the account page's list (0117's), with what each subscription is and built, and the PDFs paid for */
create or replace function public.my_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  return jsonb_build_object(
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'plan_id', s.plan_id,
               'plan_name', p.name,
               'kind', coalesce(p.kind, 'tier'),
               'includes_tier_name', (select t.name from access_plans t where t.id = p.includes_tier),
               'league_id', s.league_id,
               'league_name', l.name,
               'league_slug', l.slug,
               'features', to_jsonb(s.features),
               'status', s.status,
               'active', public.access_active(s.status, s.current_period_end, s.past_due_since),
               'current_period_end', s.current_period_end,
               'cancel_at_period_end', s.cancel_at_period_end,
               'cancel_at', s.cancel_at,
               'livemode', s.livemode,
               'details', s.details,
               'built', s.provision,
               'built_league', (select jsonb_build_object('slug', bl.slug, 'name', bl.name) from leagues bl
                                 where s.provision ? 'league_id' and bl.id = (s.provision->>'league_id')::uuid),
               'problem', s.provision_error)
             order by public.access_active(s.status, s.current_period_end, s.past_due_since) desc, s.created_at desc)
        from access_subscriptions s
        left join access_plans p on p.id = s.plan_id
        left join leagues l on l.id = s.league_id
       where s.user_id = v_uid), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'league_id', g.league_id, 'league_name', l.name,
               'features', to_jsonb(g.features), 'plan_name', (select t.name from access_plans t where t.id = g.plan_id),
               'expires_at', g.expires_at, 'note', g.note)
             order by g.created_at desc)
        from access_grants g
        left join leagues l on l.id = g.league_id
       where g.revoked_at is null and (g.expires_at is null or g.expires_at > now()) and lower(g.email) = v_email), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'subject_id', u.subject_id, 'subject_name', u.subject_name,
               'amount_pennies', u.amount_pennies, 'currency', u.currency, 'status', u.status, 'paid_at', u.paid_at,
               'used_at', u.used_at) order by u.paid_at desc)
        from access_purchases u where u.user_id = v_uid), '[]'::jsonb),
    'has_customer', exists (select 1 from access_customers c where c.user_id = v_uid)
  );
end; $$;

/* the leagues the caller set up and pays for, with how each stands */
create or replace function public.my_paid_leagues()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'subscription_id', s.id, 'status', s.status,
           'active', public.access_active(s.status, s.current_period_end, s.past_due_since),
           'asked', s.details->>'league_name', 'problem', s.provision_error,
           'league_id', l.id, 'slug', l.slug, 'name', l.name, 'lapsed_at', l.setup_lapsed_at)
         order by s.created_at desc), '[]'::jsonb)
    from access_subscriptions s
    join access_plans p on p.id = s.plan_id and p.kind = 'league_setup'
    left join leagues l on s.provision ? 'league_id' and l.id = (s.provision->>'league_id')::uuid
   where s.user_id = auth.uid();
$$;

/* is a league address free (the set-up page asks as it is typed) */
create or replace function public.league_slug_free(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(btrim(coalesce(p_slug, ''))) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     and char_length(btrim(p_slug)) between 2 and 40
     and not exists (select 1 from leagues l where l.slug = lower(btrim(p_slug)));
$$;

-- ----------------------------------------------------------------------------
-- 9. FRONT OFFICE AND MANAGER MODE
-- ----------------------------------------------------------------------------

/* the club's own people: its team managers and statisticians, and whoever the club shared the front office with */
create or replace function public.front_office_personnel(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from memberships m where m.user_id = auth.uid() and m.role in ('team_manager', 'statistician')
             and m.scope_type = 'team' and m.scope_id = p_team)
    or exists (select 1 from front_office_grants g
                where g.team_id = p_team and g.revoked_at is null
                  and g.email = (select lower(u.email) from auth.users u where u.id = auth.uid())));
$$;

/* may the caller open this club's front office: 'ok', 'signin' (signed out), 'staff' (not one of the club's people),
   'members' (one of them, without a tier that opens it). Everything open while memberships are off. */
create or replace function public.front_office_access(p_team uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_league uuid; v_gate text := public.gate_of('frontOffice');
begin
  if not public.memberships_enabled() or v_gate = 'free' then return 'ok'; end if;
  select t.league_id into v_league from teams t where t.id = p_team;
  if auth.uid() is null then return 'signin'; end if;
  if public.is_platform_admin() or (v_league is not null and coalesce(public.is_league_admin(v_league), false)) then return 'ok'; end if;
  if not public.front_office_personnel(p_team) then return 'staff'; end if;
  if v_gate = 'signin' then return 'ok'; end if;
  if 'frontOffice' = any (public.access_privileges(v_league)) then return 'ok'; end if;
  return 'members';
end $$;

/* a fan's Manager clubs are written only while Manager mode is open to them ('free' to start) */
create or replace function public.manager_teams_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.gate_open('manager', null) then
    raise exception 'Manager mode is for members: see the membership page to play' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists manager_teams_gate on public.manager_teams;
create trigger manager_teams_gate before insert or update on public.manager_teams
  for each row execute function public.manager_teams_gate();

-- ----------------------------------------------------------------------------
-- 10. WHAT IS FOR SALE TO START WITH (each priced as Louie said, or not on sale until he prices it)
-- ----------------------------------------------------------------------------
insert into public.access_plans (kind, name, blurb, features, privileges, price_pennies, currency, "interval", seller, active, sort)
select 'player_pdf', 'Player report PDF', 'One PDF of a player''s scouting report, as it stands the day it is bought.',
       '{}'::text[], '{}'::text[], 1500, 'gbp', 'once', 'platform', true, 0
 where not exists (select 1 from public.access_plans where kind = 'player_pdf');
insert into public.access_plans (kind, name, blurb, features, privileges, price_pennies, currency, "interval", seller, active, sort)
select 'club_pdf', 'Club report PDF', 'One PDF of a club''s scouting report, as it stands the day it is bought.',
       '{}'::text[], '{}'::text[], 2000, 'gbp', 'once', 'platform', true, 0
 where not exists (select 1 from public.access_plans where kind = 'club_pdf');
insert into public.access_plans (kind, name, blurb, features, privileges, price_pennies, currency, "interval", seller, active, sort)
select 'manager', 'Manager pass', 'EPINOIA Manager: build a club from the league''s real players and play the season.',
       '{}'::text[], array['manager'], 100, 'gbp', 'month', 'platform', true, 0
 where not exists (select 1 from public.access_plans where kind = 'manager');
insert into public.access_plans (kind, name, blurb, features, privileges, price_pennies, currency, "interval", seller, active, sort)
select 'tier', 'Team analytics suite', 'For a club''s staff: the front office, every analytics section and the reports.',
       '{}'::text[], coalesce((select array_agg(g.key order by g.key) from public.access_gates g where g.key <> 'manager'), '{}'::text[]),
       0, 'gbp', 'month', 'platform', false, 90
 where not exists (select 1 from public.access_plans where kind = 'tier' and name = 'Team analytics suite');
insert into public.access_plans (kind, name, blurb, features, mail_kinds, price_pennies, currency, "interval", seller, active, sort)
select 'player_mail', 'Weekly player report', 'Your player report every Monday morning, with the week''s games.',
       '{}'::text[], array['weekly'], 0, 'gbp', 'month', 'platform', false, 0
 where not exists (select 1 from public.access_plans where kind = 'player_mail');
insert into public.access_plans (kind, name, blurb, features, mail_kinds, price_pennies, currency, "interval", seller, active, sort)
select 'team_mail', 'Club reports by email', 'Each game''s analysis, the week ahead''s scouting reports, the club''s own report and the players'' reports.',
       '{}'::text[], array['games', 'opponents', 'own', 'zip'], 0, 'gbp', 'month', 'platform', false, 0
 where not exists (select 1 from public.access_plans where kind = 'team_mail');
insert into public.access_plans (kind, name, blurb, features, price_pennies, currency, "interval", seller, active, sort)
select 'league_setup', 'Your own league', 'A private league built for you on EPINOIA, with you as its administrator.',
       '{}'::text[], 0, 'gbp', 'month', 'platform', false, 0
 where not exists (select 1 from public.access_plans where kind = 'league_setup');

-- ----------------------------------------------------------------------------
-- 11. WHO MAY CALL WHAT
-- ----------------------------------------------------------------------------
revoke all on function public.access_plan_privileges(uuid) from public;
revoke all on function public.access_feature_keys(text[]) from public;
revoke all on function public.access_privileges_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.access_privileges(uuid) from public;
revoke all on function public.access_plan_purchasable(public.access_plans) from public;
revoke all on function public.platform_save_matrix(jsonb) from public, anon;
revoke all on function public.grant_tier(text, uuid, timestamptz, text) from public, anon;
revoke all on function public.billing_provision(uuid) from public, anon, authenticated;
revoke all on function public.billing_record_purchase(jsonb) from public, anon, authenticated;
revoke all on function public.billing_refund_purchase(text) from public, anon, authenticated;
revoke all on function public.my_pdf_purchase(text, uuid) from public, anon;
revoke all on function public.pdf_render_claim(int) from public, anon, authenticated;
revoke all on function public.pdf_render_done(uuid, text, int, text, text) from public, anon, authenticated;
revoke all on function public.pdf_render_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.report_bot_ticket() from public, anon, authenticated;
revoke all on function public.report_bot_ok(text) from public;
revoke all on function public.my_paid_leagues() from public, anon;
revoke all on function public.league_slug_free(text) from public;
revoke all on function public.front_office_personnel(uuid) from public;
revoke all on function public.front_office_access(uuid) from public;
revoke all on function public.manager_teams_gate() from public, anon, authenticated;

grant execute on function public.access_plan_privileges(uuid) to anon, authenticated, service_role;
grant execute on function public.access_feature_keys(text[]) to anon, authenticated, service_role;
grant execute on function public.access_privileges_for(uuid, uuid) to service_role;
grant execute on function public.access_privileges(uuid) to anon, authenticated, service_role;
grant execute on function public.access_plan_purchasable(public.access_plans) to anon, authenticated, service_role;
grant execute on function public.platform_save_matrix(jsonb) to authenticated;
grant execute on function public.grant_tier(text, uuid, timestamptz, text) to authenticated;
grant execute on function public.billing_provision(uuid) to service_role;
grant execute on function public.billing_record_purchase(jsonb) to service_role;
grant execute on function public.billing_refund_purchase(text) to service_role;
grant execute on function public.my_pdf_purchase(text, uuid) to authenticated;
grant execute on function public.pdf_render_claim(int) to service_role;
grant execute on function public.pdf_render_done(uuid, text, int, text, text) to service_role;
grant execute on function public.pdf_render_failed(uuid, text) to service_role;
grant execute on function public.report_bot_ticket() to service_role;
grant execute on function public.report_bot_ok(text) to anon, authenticated, service_role;
grant execute on function public.my_paid_leagues() to authenticated;
grant execute on function public.league_slug_free(text) to anon, authenticated;
grant execute on function public.front_office_personnel(uuid) to anon, authenticated, service_role;
grant execute on function public.front_office_access(uuid) to anon, authenticated, service_role;

alter function public.access_privileges_for(uuid, uuid) owner to postgres;
alter function public.billing_provision(uuid) owner to postgres;
alter function public.billing_apply_subscription(jsonb, timestamptz) owner to postgres;
alter function public.billing_record_purchase(jsonb) owner to postgres;
alter function public.save_access_plan(jsonb) owner to postgres;

-- ---- self-test ----
do $$
begin
  if exists (select 1 from public.access_gates where gate not in ('free', 'signin', 'tiers')) then
    raise exception 'P0279: a section still follows an old gate after the conversion';
  end if;
  if not exists (select 1 from public.access_gates where key = 'frontOffice') or not exists (select 1 from public.access_gates where key = 'manager') then
    raise exception 'P0279: the front office and Manager mode rows are missing';
  end if;
  if (select price_pennies from public.access_plans where kind = 'player_pdf' order by created_at limit 1) is null then
    raise exception 'P0279: no player PDF price';
  end if;
  if has_function_privilege('anon', 'public.billing_provision(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_record_purchase(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.access_privileges_for(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.pdf_render_claim(int)', 'execute')
     or has_function_privilege('anon', 'public.report_bot_ticket()', 'execute') then
    raise exception 'P0279: a service-role function is callable from a browser';
  end if;
end $$;

notify pgrst, 'reload schema';
