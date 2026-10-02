-- 0223: FREE TRIALS (2026-10-02). A new member's first months free: three by default (the public platform setting
-- trial_months, 0 switches trials off), a plan of its own length or none (access_plans.trial_months, null = the
-- platform's). One trial a person a seller: a fan who has ever held a plan sold by the same seller in the same
-- league (Epinoia's own plans, or one league's) pays from the first day. The billing function decides at checkout
-- (trial_months_for), the join page and the membership window show the same answer beforehand (my_trial_offers),
-- and every prompt promotes it from access_wall()'s trial_months. A trial subscription is 'trialing', which has
-- always counted as a member (0117 access_active), so nothing else changes.

alter table public.access_plans add column if not exists trial_months smallint
  check (trial_months is null or trial_months between 0 and 12);

insert into public.platform_settings (key, value, is_public)
values ('trial_months', '3'::jsonb, true)
on conflict (key) do nothing;

/* the platform's trial length, 0..12: a whole number, or one written as text ("3", as a settings box saves it);
   anything else reads as none */
create or replace function public.trial_months_default()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(s.value) in ('number', 'string') and btrim(s.value #>> '{}') ~ '^\d{1,3}$'
                              then least(12, (btrim(s.value #>> '{}'))::int) end
                     from public.platform_settings s where s.key = 'trial_months'), 0);
$$;

/* the months free this person gets on this plan: the plan's length (or the platform's), and none for whoever has
   held any plan from the same seller in the same league before -- whatever became of it */
create or replace function public.trial_months_for(p_user uuid, p_plan uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when p.id is null or not p.active then 0
    when p_user is not null and exists (
      select 1 from public.access_subscriptions s join public.access_plans q on q.id = s.plan_id
       where s.user_id = p_user and q.seller = p.seller and q.league_id is not distinct from p.league_id) then 0
    else coalesce(p.trial_months, public.trial_months_default())
  end
  from (select 1) one left join public.access_plans p on p.id = p_plan;
$$;
revoke all on function public.trial_months_default() from public;
revoke all on function public.trial_months_for(uuid, uuid) from public;
grant execute on function public.trial_months_default() to anon, authenticated, service_role;
grant execute on function public.trial_months_for(uuid, uuid) to service_role;

/* the caller's offer on every plan on sale for a league (and Epinoia's own): { plan id: months }. A signed-out fan is
   offered what a new member would be. */
create or replace function public.my_trial_offers(p_league uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.id::text, public.trial_months_for(auth.uid(), p.id)), '{}'::jsonb)
    from public.access_plans p
   where p.active and (p.league_id is null or p.league_id = p_league);
$$;
revoke all on function public.my_trial_offers(uuid) from public;
grant execute on function public.my_trial_offers(uuid) to anon, authenticated, service_role;

/* the public plan list carries each plan's trial length (0117's, with trial_months) */
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
           'purchasable', p.stripe_price_id is not null,
           'trial_months', coalesce(p.trial_months, public.trial_months_default()))
         order by p.league_id nulls first, p.sort, p.price_pennies), '[]'::jsonb)
    from access_plans p
   where p.active
     and (p.league_id is null or p.league_id = p_league);
$$;

/* a plan's own trial: whoever may change the plan (save_access_plan's rights): null puts the platform's back */
create or replace function public.set_plan_trial(p_plan uuid, p_months int)
returns text language plpgsql security definer set search_path = public as $$
declare v public.access_plans;
begin
  select * into v from public.access_plans where id = p_plan;
  if not found then raise exception 'no such plan' using errcode = '22023'; end if;
  if v.league_id is null or v.seller <> 'league' then
    if not public.is_platform_admin() then
      raise exception 'Epinoia sells this plan, so only a platform administrator may change it' using errcode = '42501';
    end if;
  elsif not (public.is_platform_admin() or public.is_league_admin(v.league_id)) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if p_months is not null and (p_months < 0 or p_months > 12) then
    raise exception 'a free trial is 0 to 12 months' using errcode = '22023';
  end if;
  update public.access_plans set trial_months = p_months where id = p_plan;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'plan_trial', 'plan', p_plan::text, jsonb_build_object('trial_months', p_months));
  return 'saved';
end $$;
revoke all on function public.set_plan_trial(uuid, int) from public;
grant execute on function public.set_plan_trial(uuid, int) to authenticated;

/* each plan's own setting as stored (null = the platform's), for the plans the caller may change: every plan for a
   platform administrator, a league's own for its administrators. The consoles' plan forms read it. */
create or replace function public.plan_trials()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.id::text, to_jsonb(p.trial_months)), '{}'::jsonb)
    from public.access_plans p
   where public.is_platform_admin()
      or (p.league_id is not null and p.seller = 'league' and coalesce(public.is_league_admin(p.league_id), false));
$$;
revoke all on function public.plan_trials() from public;
grant execute on function public.plan_trials() to authenticated;

/* the prompts promote it: access_wall() (0222) with the platform's trial length */
create or replace function public.access_wall()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gates', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'gate', g.gate, 'title', g.title, 'lines', to_jsonb(g.lines)) order by g.key)
                         from public.access_gates g), '[]'::jsonb),
    'copy', coalesce((select s.value from public.platform_settings s where s.key = 'access_copy' and s.is_public), '{}'::jsonb),
    'trial_months', public.trial_months_default());
$$;

notify pgrst, 'reload schema';
