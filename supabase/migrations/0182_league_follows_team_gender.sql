-- ============================================================================
-- 0182 — SETTING ONE CLUB TO WOMEN'S (OR MEN'S) SETS ITS WHOLE LEAGUE (follows 0178, 0181).
--
-- In the console's Links tab a club's side has a "is this a women's side?" setting. It set that one team, so a league
-- whose names say nothing (a women's league with "Aces", "Comets", "Sparks") had to be flagged club by club. Now the
-- setting is the LEAGUE's: leagues.gender (0131), the column the rail's W chip, HOME's league cards, the favourites and the
-- scouting filter already read. Set one club to women's and every team in its league counts as women's; set it to men's and
-- every team counts as men's. A league is one or the other in the console, so this is the same edit made from a club.
--
--   team_is_women(team)             a hand flag on the team, then its own recorded gender (0119), THEN ITS LEAGUE'S GENDER
--                                   (women / men; "mixed" or none says nothing), then the names. New: the league step.
--   platform_team_set_women(team, women, whole_league default true)
--                                   true / false: the team's flag and (whole_league) the league's gender, women / men.
--                                   Hand flags on OTHER teams of that league that say the opposite are handed back
--                                   (they would keep those teams out of the league they now belong to). null: the team's
--                                   flag alone goes back to the names/league - a league is never unset from a club.
--                                   Returns what happened, as json, for the console to say.
--   link_team_cards(ids)            the cards gain league_gender and women_from ('team' | 'team_gender' | 'league' |
--                                   'names') so the console can say where a team's answer comes from.
--
-- The old two-argument function returned a boolean; a function cannot change its return type, so it is dropped and
-- re-created. A call with two arguments works as before (the league goes along); pass false as the third for "this team only".
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. IS THIS A WOMEN'S SIDE: the league's gender joins the answer
-- ----------------------------------------------------------------------------
create or replace function public.team_is_women(p_team uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select f.women from public.team_flags f where f.team_id = t.id),
    case when t.gender in ('women', 'girls') then true when t.gender in ('men', 'boys') then false end,
    case when l.gender = 'women' then true when l.gender = 'men' then false end,
    public.link_looks_women(concat_ws(' ', t.name, t.slug, l.name, l.slug)),
    false)
  from public.teams t left join public.leagues l on l.id = t.league_id
 where t.id = p_team;
$$;

-- ----------------------------------------------------------------------------
-- 2. THE CARDS SAY WHERE THE ANSWER COMES FROM (0181's cards, plus two keys)
-- ----------------------------------------------------------------------------
create or replace function public.link_team_cards(p_ids uuid[])
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(c.card order by c.ord), '[]'::jsonb) from (
    select u.ord, jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'name', t.name, 'short', t.short_name,
        'league_id', t.league_id, 'league', l.name, 'league_slug', l.slug, 'league_gender', l.gender,
        'women', public.team_is_women(t.id),
        'women_from', case when exists (select 1 from public.team_flags f where f.team_id = t.id and f.women is not null) then 'team'
                           when t.gender in ('women', 'girls', 'men', 'boys') then 'team_gender'
                           when l.gender in ('women', 'men') then 'league'
                           else 'names' end,
        'youth', public.team_is_youth(t.id), 'age', public.team_age_group(t.id),
        'youth_set', exists (select 1 from public.team_flags f where f.team_id = t.id and (f.youth is not null or f.age_group is not null)),
        'women_set', exists (select 1 from public.team_flags f where f.team_id = t.id and f.women is not null),
        'competitions', coalesce((select jsonb_agg(jsonb_build_object('season', x.season, 'name', x.name, 'kind', x.kind)
                                                    order by x.season desc, x.name)
                                   from (select distinct s.name season, c.name, c.kind
                                           from public.competition_teams ct
                                           join public.competitions c on c.id = ct.competition_id
                                           join public.seasons s on s.id = c.season_id
                                          where ct.team_id = t.id) x), '[]'::jsonb),
        'group_id', m.group_id, 'group', g.name,
        'namesakes', (select count(*) from public.teams o
                       where public.link_team_key(o.name) = public.link_team_key(t.name) and o.id <> t.id)
      ) card
      from unnest(p_ids) with ordinality u(id, ord)
      join public.teams t on t.id = u.id
      left join public.leagues l on l.id = t.league_id
      left join public.team_group_members m on m.team_id = t.id
      left join public.team_groups g on g.id = m.group_id
  ) c;
$$;

-- ----------------------------------------------------------------------------
-- 3. THE CONSOLE'S SETTER: one club, its whole league
-- ----------------------------------------------------------------------------
drop function if exists public.platform_team_set_women(uuid, boolean);

/* true = women's, false = men's (a league is one or the other here), null = hand the team back to the league and the names.
   whole_league (the default) makes the same statement for every team of the league. Hand flags on other teams of that league
   that say the opposite are cleared, and the answer says how many teams still read otherwise (a team's own recorded gender
   outranks its league's). A team with no league is only ever set alone. */
create or replace function public.platform_team_set_women(p_team uuid, p_women boolean, p_league boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_league uuid;
  v_gender text;
  n_teams  int := 1;
  n_clear  int := 0;
  n_kept   int := 0;
  lg       record;
begin
  perform public.link_require_admin();
  select t.league_id into v_league from public.teams t where t.id = p_team;
  if not found then
    raise exception 'that team does not exist' using errcode = '22023';
  end if;

  if p_women is null then
    update public.team_flags set women = null, set_by = auth.uid(), set_at = now() where team_id = p_team;
    delete from public.team_flags where team_id = p_team and women is null and youth is null and age_group is null;
  else
    insert into public.team_flags (team_id, women, set_by) values (p_team, p_women, auth.uid())
    on conflict (team_id) do update set women = excluded.women, set_by = excluded.set_by, set_at = now();
  end if;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'team_women_flag', 'team', p_team::text, jsonb_build_object('women', p_women, 'whole_league', coalesce(p_league, true) and p_women is not null));

  if p_women is not null and coalesce(p_league, true) and v_league is not null then
    v_gender := case when p_women then 'women' else 'men' end;
    update public.leagues set gender = v_gender where id = v_league;

    update public.team_flags f set women = null, set_by = auth.uid(), set_at = now()
      from public.teams t
     where t.id = f.team_id and t.league_id = v_league and t.id <> p_team and f.women is not null and f.women <> p_women;
    get diagnostics n_clear = row_count;
    delete from public.team_flags f using public.teams t
     where t.id = f.team_id and t.league_id = v_league and f.women is null and f.youth is null and f.age_group is null;

    select count(*) into n_teams from public.teams where league_id = v_league;
    select count(*) into n_kept from public.teams t where t.league_id = v_league and public.team_is_women(t.id) is distinct from p_women;

    insert into public.audit_log (actor, action, subject, subject_id, detail)
    values (auth.uid(), 'set_league_gender', 'league', v_league::text,
            jsonb_build_object('gender', v_gender, 'via_team', p_team, 'teams', n_teams, 'flags_cleared', n_clear, 'kept', n_kept));
  end if;

  select l.id, l.name, l.slug, l.gender into lg from public.leagues l where l.id = v_league;
  return jsonb_build_object(
    'women', public.team_is_women(p_team),
    'whole_league', p_women is not null and coalesce(p_league, true) and v_league is not null,
    'league', case when lg.id is null then null else jsonb_build_object('id', lg.id, 'name', lg.name, 'slug', lg.slug, 'gender', lg.gender) end,
    'teams', n_teams, 'cleared', n_clear, 'kept', n_kept);
end $$;

-- ----------------------------------------------------------------------------
-- 4. GRANTS, AND A CHECK THAT THEY ARE AS DESCRIBED
-- ----------------------------------------------------------------------------
revoke all on function public.platform_team_set_women(uuid, boolean, boolean) from public, anon;
grant execute on function public.platform_team_set_women(uuid, boolean, boolean) to authenticated, service_role;
alter function public.platform_team_set_women(uuid, boolean, boolean) owner to postgres;

do $$
begin
  if has_function_privilege('anon', 'public.platform_team_set_women(uuid, boolean, boolean)', 'execute') then
    raise exception '0182: a signed-out visitor can set a team or league to women''s';
  end if;
  if not has_function_privilege('anon', 'public.team_is_women(uuid)', 'execute') then
    raise exception '0182: the team page cannot read the women indicator';
  end if;
  if exists (select 1 from pg_proc p where p.proname = 'platform_team_set_women' and pronamespace = 'public'::regnamespace and pronargs = 2) then
    raise exception '0182: the old two-argument setter is still there';
  end if;
  raise notice '0182 ok: a club''s women''s / men''s setting reaches its whole league, and the league''s gender is part of the women indicator';
end $$;
