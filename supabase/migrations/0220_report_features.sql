-- 0220_report_features.sql
-- ============================================================================
-- MEMBERSHIP TIERS FOR THE REPORTS (2026-10-02). Two more features beside 'analytics' and 'league':
--
--   club_report    the club profile's Report tab (the A4 scouting report of a club: report.js, report-teampages.js)
--   player_report  the player profile's Report tab (report-playerpages.js)
--
-- A feature is what a plan bundles, a subscription carries and a grant gives (docs/memberships.md §1), so the
-- tiers are the platform administrator's to make: a plan with any mix of the four (a platform plan never with
-- 'league'), and a grant by email for any of them. Like the analytics, the reports are Epinoia's product:
--   * only a platform administrator may grant them (a league grants its league);
--   * a plan a league sells on its own account may include them only at a price;
--   * staff of a league (platform admins, its league admins, statisticians and writers) hold every feature there;
--     club managers still hold 'league' only.
-- Whether a report is locked is decided by the page (EpinoiaAccess.featureLocked, CATALOGUE.locks), on the
-- caller's features from access_state, and only while memberships are switched on (the master switch).
--
-- What changes: the three features check constraints, access_features_for (the staff list), save_access_plan and
-- grant_access (copied from 0117, the latest definitions, with only their feature lists and the "Epinoia's to give"
-- rules widened). Nothing else reads the feature names. Self-tested at the end.
-- ============================================================================

alter table public.access_plans drop constraint if exists access_plans_features_ck;
alter table public.access_plans add constraint access_plans_features_ck
  check (cardinality(features) > 0 and features <@ array['analytics', 'league', 'club_report', 'player_report']::text[]);
alter table public.access_plans drop constraint if exists access_plans_league_reports_paid_ck;
alter table public.access_plans add constraint access_plans_league_reports_paid_ck
  check (seller <> 'league' or not (features && array['club_report', 'player_report']::text[]) or price_pennies > 0);

alter table public.access_subscriptions drop constraint if exists access_subscriptions_features_ck;
alter table public.access_subscriptions add constraint access_subscriptions_features_ck
  check (features <@ array['analytics', 'league', 'club_report', 'player_report']::text[]);

alter table public.access_grants drop constraint if exists access_grants_features_ck;
alter table public.access_grants add constraint access_grants_features_ck
  check (cardinality(features) > 0 and features <@ array['analytics', 'league', 'club_report', 'player_report']::text[]);

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
      then array['analytics', 'league', 'club_report', 'player_report']::text[]
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
    raise exception 'a plan unlocks at least one thing: analytics, the league, the club report or the player report'
      using errcode = '22023';
  end if;
  if not v_features <@ array['analytics', 'league', 'club_report', 'player_report']::text[] then
    raise exception 'a plan can unlock "analytics", "league", "club_report" and "player_report", and nothing else' using errcode = '22023';
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
  if v_seller = 'league' and v_features && array['analytics', 'club_report', 'player_report']::text[] and v_price = 0 then
    raise exception 'the analytics and the reports are Epinoia''s, so a plan the league sells cannot include them for nothing: set a price, or take them out of the plan'
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
    raise exception 'a grant gives at least one thing: analytics, the league, the club report or the player report'
      using errcode = '22023';
  end if;
  if not v_features <@ array['analytics', 'league', 'club_report', 'player_report']::text[] then
    raise exception 'a grant can give "analytics", "league", "club_report" and "player_report", and nothing else' using errcode = '22023';
  end if;
  if v_features && array['analytics', 'club_report', 'player_report']::text[] and not public.is_platform_admin() then
    raise exception 'the analytics and the reports are Epinoia''s to give away, so only a platform administrator may grant them; a league grants its league'
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

revoke all on function public.access_features_for(uuid, uuid) from public, anon, authenticated;
alter function public.access_features_for(uuid, uuid) owner to postgres;
alter function public.save_access_plan(jsonb) owner to postgres;
alter function public.grant_access(uuid, text, text[], timestamptz, text) owner to postgres;

-- ---- self-test: the constraints take the new features and refuse others; the functions carry them ----
do $$
declare
  v_lg uuid;
begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'access_grants_features_ck')) !~ 'player_report' then
    raise exception 'P0220: access_grants_features_ck does not carry player_report';
  end if;
  if pg_get_functiondef('public.access_features_for(uuid, uuid)'::regprocedure) !~ 'club_report' then
    raise exception 'P0220: access_features_for does not give staff the club report';
  end if;
  if pg_get_functiondef('public.save_access_plan(jsonb)'::regprocedure) !~ 'player_report' then
    raise exception 'P0220: save_access_plan does not take the player report';
  end if;
  if pg_get_functiondef('public.grant_access(uuid, text, text[], timestamptz, text)'::regprocedure) !~ 'club_report' then
    raise exception 'P0220: grant_access does not take the club report';
  end if;
  -- a grant row with the new features is taken, one with an unknown feature is refused; neither is kept
  begin
    insert into public.access_grants (league_id, email, features) values (null, 'p0220@example.test', array['club_report', 'player_report']);
    raise exception 'P0220-ROLLBACK';
  exception when others then
    if sqlerrm <> 'P0220-ROLLBACK' then raise exception 'P0220: a grant of the reports was refused: %', sqlerrm; end if;
  end;
  begin
    insert into public.access_grants (league_id, email, features) values (null, 'p0220@example.test', array['scouting']);
    raise exception 'P0220: a grant of an unknown feature was taken';
  exception when check_violation then null;
  end;
  -- a league's own plan may carry a report only at a price
  select id into v_lg from public.leagues limit 1;
  if v_lg is not null then
    begin
      insert into public.access_plans (league_id, name, features, price_pennies, "interval", seller)
      values (v_lg, 'P0220 free report', array['club_report'], 0, 'month', 'league');
      raise exception 'P0220: a free league-sold report plan was taken';
    exception when check_violation then null;
    end;
  end if;
end $$;
