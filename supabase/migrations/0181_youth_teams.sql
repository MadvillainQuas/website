-- ============================================================================
-- 0181 — YOUTH TEAMS: a specification beside the women's indicator (follows 0178).
--
-- Liga U, the ABA U19 League, Espoirs ÉLITE, and the academy and junior sides that play inside senior leagues
-- (Seawolves Academy, SKYLINERS Juniors, PuHu Juniorit, Kataja Basket Academy) are youth teams. They are told the
-- way a women's side is (0178): by what the team, its slug and its league are called, with an age group where the
-- name has one (U19, "Under 21", "Sub-20"), and set by hand where the names do not say so. A youth side can be
-- linked into its club's group like any other side, and the team page and the switcher say so.
--
--   team_is_youth(team)     the hand flag, then teams.age_group (0119), then the names
--   team_age_group(team)    'U19' and the like, or null: the hand-set age, teams.age_group, or the name's own
--   team_traits(team)       { women, youth, age } in one public call, for the team page
--   platform_team_set_youth(team, youth, age)    the console's setter; null, null hands it back to the names
--
-- AND THE CLUB KEY NO LONGER SEES THE YOUTH WORDS, so "London Lions U18" and "Seawolves Academy" are suggested as the
-- club they belong to (medium: the spelling differs). That is a change to link_team_key, which an index is built on:
-- the index is rebuilt below, which is one small table.
--
-- Nothing else moves: 0178's tables gain two nullable columns on team_flags (women stops being required, since a row can
-- now say only "youth"), and the functions that draw cards, order a club's sides and name a new group are re-stated with
-- the youth fields and the youth-last order.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE FLAGS TABLE MAY SAY ONLY "YOUTH"
-- ----------------------------------------------------------------------------
alter table public.team_flags alter column women drop not null;
alter table public.team_flags add column if not exists youth boolean;
alter table public.team_flags add column if not exists age_group text;
do $$ begin
  alter table public.team_flags add constraint team_flags_age_ck check (age_group is null or age_group ~ '^U[0-9]{2}$');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. WHAT LOOKS LIKE A YOUTH SIDE, AND HOW OLD
-- ----------------------------------------------------------------------------

/* a name that says youth: the word in English and the leagues' own languages, an academy or a "junior" side, "Liga U",
   or an age like U19 / U-21 / Under 18 / Sub-20 (12 to 25, so a number that is not an age is not one). Folded first. */
create or replace function public.link_looks_youth(p_text text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(public.link_fold(p_text) ~
    '(^| )(youth|junior|juniors|juniorit|junioren|juvenil|juveniles|cadete|cadetes|infantil|academy|academia|akademie|nachwuchs|jugend|jeunes|espoirs|espoir|primavera|jong|liga u|((u|under|sub) ?(1[2-9]|2[0-5])))( |$)', false);
$$;

/* the age group a name states: 'U19' from "ABA U19 League", "U-21", "Under 18", "Sub-20"; null when it states none */
create or replace function public.link_youth_age(p_text text)
returns text language sql immutable set search_path = public as $$
  select case when m is null then null else 'U' || m[3] end
    from (select regexp_match(public.link_fold(p_text), '(^| )(u|under|sub) ?(1[2-9]|2[0-5])( |$)') m) x;
$$;

/* a club's name reduced to the club: folded, and the words that vary by feed dropped -- a gender word, the legal-form
   prefixes, and now the youth words and ages -- so "London Lions", "London Lions BC", "London Lions Women" and
   "London Lions U18" share a key. (Replaces 0178's; the index on it is rebuilt below.) */
create or replace function public.link_team_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(btrim(regexp_replace(regexp_replace(public.link_fold(p_name),
      '\m(women|womens|woman|female|ladies|feminin|feminine|femenina|femenino|femminile|damen|frauen|dames|vrouwen|fc|bc|bk|kk|kb|cb|bbc|bsc|sc|club|team|the|youth|junior|juniors|juniorit|junioren|juvenil|juveniles|cadete|cadetes|infantil|academy|academia|akademie|nachwuchs|jugend|jeunes|espoirs|espoir|primavera|jong|(u|under|sub) ?(1[2-9]|2[0-5]))\M', ' ', 'g'),
      '\s+', ' ', 'g')), ''),
    public.link_fold(p_name));
$$;
reindex index public.teams_link_key;

-- ----------------------------------------------------------------------------
-- 3. IS THIS A YOUTH SIDE, AND OF WHAT AGE (public, like team_is_women)
-- ----------------------------------------------------------------------------
create or replace function public.team_age_group(p_team uuid)
returns text language sql stable set search_path = public as $$
  select case
           when f.youth is false or t.age_group in ('senior', 'masters', 'open') then null
           else coalesce(f.age_group,
                         case when t.age_group ~ '^U[0-9]{1,2}$' then t.age_group end,
                         public.link_youth_age(concat_ws(' ', t.name, t.slug, l.name, l.slug)))
         end
    from public.teams t
    left join public.leagues l on l.id = t.league_id
    left join public.team_flags f on f.team_id = t.id
   where t.id = p_team;
$$;

create or replace function public.team_is_youth(p_team uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    f.youth,
    case when f.age_group is not null then true end,
    case when t.age_group ~ '^U[0-9]{1,2}$' then true when t.age_group in ('senior', 'masters', 'open') then false end,
    public.link_looks_youth(concat_ws(' ', t.name, t.slug, l.name, l.slug)),
    false)
    from public.teams t
    left join public.leagues l on l.id = t.league_id
    left join public.team_flags f on f.team_id = t.id
   where t.id = p_team;
$$;

/* everything a team page needs to badge a side, in one call */
create or replace function public.team_traits(p_team uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('women', public.team_is_women(p_team), 'youth', public.team_is_youth(p_team), 'age', public.team_age_group(p_team));
$$;

-- ----------------------------------------------------------------------------
-- 4. THE CARDS, A CLUB'S SIDES AND A NEW GROUP'S NAME, WITH THE YOUTH SIDES LAST
-- ----------------------------------------------------------------------------
create or replace function public.link_team_cards(p_ids uuid[])
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(c.card order by c.ord), '[]'::jsonb) from (
    select u.ord, jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'name', t.name, 'short', t.short_name,
        'league_id', t.league_id, 'league', l.name, 'league_slug', l.slug,
        'women', public.team_is_women(t.id),
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

create or replace function public.linked_teams(p_team uuid)
returns jsonb language sql stable set search_path = public as $$
  select case when m.group_id is null then null else jsonb_build_object(
    'group', g.name,
    'teams', public.link_team_cards(array(select gm.team_id from public.team_group_members gm
                                           join public.teams t on t.id = gm.team_id
                                          where gm.group_id = m.group_id
                                          order by (gm.team_id = p_team) desc, public.team_is_youth(t.id), public.team_is_women(t.id), t.name))) end
    from (select 1) one
    left join public.team_group_members m on m.team_id = p_team
    left join public.team_groups g on g.id = m.group_id;
$$;

create or replace function public.link_join_teams(p_ids uuid[], p_actor uuid, p_label text)
returns jsonb language plpgsql set search_path = public as $$
declare
  ids uuid[]; gids uuid[]; keep uuid; nm text := nullif(btrim(coalesce(p_label, '')), ''); n int;
begin
  select array_agg(distinct x) into ids from unnest(coalesce(p_ids, '{}')) x;
  if (select count(*) from public.teams where id = any(ids)) <> coalesce(cardinality(ids), 0) then
    raise exception 'one of those teams does not exist' using errcode = '22023';
  end if;
  select array_agg(distinct m.group_id) into gids from public.team_group_members m where m.team_id = any(ids);
  select g.id into keep from public.team_groups g where g.id = any(coalesce(gids, '{}')) order by g.created_at, g.id limit 1;
  if keep is null then
    if coalesce(cardinality(ids), 0) < 2 then raise exception 'link at least two teams' using errcode = '22023'; end if;
    insert into public.team_groups (name, created_by)
    values (coalesce(nm, (select t.name from public.teams t where t.id = any(ids) order by public.team_is_youth(t.id), public.team_is_women(t.id), t.name limit 1)), p_actor)
    returning id into keep;
  elsif nm is not null then
    update public.team_groups set name = nm where id = keep;
  end if;
  update public.team_group_members set group_id = keep where group_id = any(coalesce(gids, '{}')) and group_id <> keep;
  insert into public.team_group_members (team_id, group_id, linked_by)
  select x, keep, p_actor from unnest(ids) x on conflict (team_id) do nothing;
  delete from public.team_groups where id = any(coalesce(gids, '{}')) and id <> keep;
  select count(*) into n from public.team_group_members where group_id = keep;
  if n < 2 then raise exception 'link at least two teams' using errcode = '22023'; end if;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (p_actor, 'team_link', 'team_group', keep::text, jsonb_build_object('teams', ids, 'merged', coalesce(gids, '{}')));
  return jsonb_build_object('group_id', keep, 'members', n);
end $$;

/* the possible matches and the linked groups, restated for the youth words and the youth-last order */
create or replace function public.platform_link_suggestions(p_kind text, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  lim int := least(greatest(coalesce(p_limit, 25), 1), 60);
  out_rows jsonb;
  n_total int;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    with k as (
      select t.id, t.league_id, t.name, public.link_team_key(t.name) key, m.group_id
        from public.teams t left join public.team_group_members m on m.team_id = t.id),
    g as (
      select key, array_agg(id order by id) ids, count(distinct league_id) leagues,
             count(distinct public.link_fold(name)) spellings, count(distinct coalesce(group_id::text, id::text)) units
        from k where key is not null group by key having count(*) > 1),
    c as (
      select g.*, case when leagues > 1 and spellings = 1 then 'high' when leagues > 1 then 'medium' else 'low' end confidence,
             md5(array_to_string(ids, ',')) h
        from g where units > 1
         and not exists (select 1 from public.link_dismissals d where d.kind = 'team' and d.members_hash = md5(array_to_string(g.ids, ',')))),
    o as (
      select c.*, row_number() over (order by case confidence when 'high' then 0 when 'medium' then 1 else 2 end,
                                               cardinality(ids) desc, key) rn, count(*) over () total
        from c)
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', o.key, 'confidence', o.confidence, 'flag', 'possible',
             'reason', case o.confidence
                         when 'high' then 'the same name in ' || o.leagues || ' leagues'
                         when 'medium' then 'the same club once the legal-form, gender and youth words are set aside (' || o.leagues || ' leagues)'
                         else 'the same name twice in one league' end,
             'ids', to_jsonb(o.ids), 'cards', public.link_team_cards(o.ids)) order by o.rn), '[]'::jsonb),
           coalesce(max(o.total), 0)
      into out_rows, n_total from o where o.rn > greatest(coalesce(p_offset, 0), 0) and o.rn <= greatest(coalesce(p_offset, 0), 0) + lim;
    return jsonb_build_object('rows', out_rows, 'total', n_total);
  end if;

  with p as (
    select pl.id, pl.birth_year, m.group_id,
           public.link_person_key(pl.first_name, pl.last_name) xkey,
           public.link_person_core(pl.first_name, pl.last_name) ckey,
           public.link_person_short(pl.first_name, pl.last_name) skey,
           (public.link_person_tokens(pl.first_name, pl.last_name))[1] first_tok
      from public.players pl left join public.player_group_members m on m.player_id = pl.id),
  /* the clubs of every player, as club groups: two players at clubs that are one club is the strongest evidence there is */
  clubs as (
    select re.player_id, tm.group_id from public.roster_entries re join public.team_group_members tm on tm.team_id = re.team_id
     group by re.player_id, tm.group_id),
  ex as (
    select 0 prio, 'exact'::text kind, null::text note, xkey key, array_agg(id order by id) ids, count(*) n,
           count(distinct coalesce(group_id::text, id::text)) units,
           count(distinct birth_year) filter (where birth_year is not null) years,
           count(*) filter (where birth_year is not null) with_year
      from p where xkey is not null group by xkey having count(*) > 1),
  co as (
    /* first and last word alike, whatever is between them */
    select 1 prio, 'core'::text kind, null::text note, ckey key, array_agg(id order by id) ids, count(*) n,
           count(distinct coalesce(group_id::text, id::text)) units,
           count(distinct birth_year) filter (where birth_year is not null) years,
           count(*) filter (where birth_year is not null) with_year
      from p where ckey is not null group by ckey having count(*) > 1 and count(distinct xkey) > 1),
  sh as (
    /* a short key is only a candidate where its rows are not all one full name (an initial can be any first name):
       one full first name at most, the rest initials */
    select 2 prio, 'short'::text kind, null::text note, skey key, array_agg(id order by id) ids, count(*) n,
           count(distinct coalesce(group_id::text, id::text)) units,
           count(distinct birth_year) filter (where birth_year is not null) years,
           count(*) filter (where birth_year is not null) with_year
      from p where skey is not null
     group by skey
    having count(*) > 1 and count(distinct xkey) > 1
       and count(distinct first_tok) filter (where length(first_tok) > 1) <= 1),
  /* AN INITIAL THAT COULD BE SEVERAL PEOPLE ("J Smith" beside John and James Smith): one candidate per full first name, the
     initial rows with it, always low -- the console decides which, if any */
  s0 as (
    select id, skey, first_tok, (length(first_tok) = 1) is_init, xkey, group_id, birth_year from p where skey is not null),
  amb as (
    select 3 prio, 'ambiguous'::text kind,
           (select string_agg(distinct y.first_tok, ' or ' order by y.first_tok) from s0 y where y.skey = f.skey and not y.is_init) note,
           f.skey || ' > ' || f.first_tok key, array_agg(x.id order by x.id) ids, count(*) n,
           count(distinct coalesce(x.group_id::text, x.id::text)) units,
           count(distinct x.birth_year) filter (where x.birth_year is not null) years,
           count(*) filter (where x.birth_year is not null) with_year
      from (select distinct skey, first_tok from s0 where not is_init
             and skey in (select skey from s0 where not is_init group by skey having count(distinct first_tok) > 1)
             and skey in (select skey from s0 where is_init)) f
      join s0 x on x.skey = f.skey and (x.first_tok = f.first_tok or x.is_init)
     group by f.skey, f.first_tok
    having count(*) > 1),
  cand0 as (
    select row_number() over (order by prio, key) no, u.*
      from (select * from ex where units > 1 union all select * from co where units > 1
            union all select * from sh where units > 1 union all select * from amb where units > 1) u),
  /* A SET THAT IS INSIDE A BIGGER ONE (the same name twice, and a third spelling with a middle name) is shown once,
     as the bigger one; two equal sets are shown as the more exact kind */
  mem as (select no, unnest(ids) id from cand0),
  absorbed as (
    select m1.no from mem m1 join mem m2 on m2.id = m1.id and m2.no <> m1.no
      join cand0 c1 on c1.no = m1.no join cand0 c2 on c2.no = m2.no
     group by m1.no, m2.no, c1.n, c1.prio, c2.n, c2.prio
    having count(*) = c1.n and (c2.n > c1.n or c2.prio < c1.prio)),
  cand as (select * from cand0 where no not in (select no from absorbed)),
  ev as (
    select c.*, exists (select 1 from clubs a join clubs b on a.group_id = b.group_id and a.player_id < b.player_id
                         where a.player_id = any(c.ids) and b.player_id = any(c.ids)) same_club
      from cand c
     where not exists (select 1 from public.link_dismissals d where d.kind = 'player' and d.members_hash = md5(array_to_string(c.ids, ',')))),
  o as (
    select ev.*,
           case when kind = 'ambiguous' or years > 1 then 'low'
                when same_club or (years = 1 and with_year >= 2) then 'high'
                else 'medium' end confidence
      from ev),
  r as (
    select o.*, row_number() over (order by case confidence when 'high' then 0 when 'medium' then 1 else 2 end,
                                             prio, n desc, key) rn, count(*) over () total
      from o)
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', r.key, 'kind', r.kind, 'confidence', r.confidence, 'flag', 'possible',
           'reason', concat_ws(', ',
             case r.kind when 'exact' then 'the same name'
                         when 'core' then 'the same first and last name, with a middle name or particle in one of them'
                         when 'ambiguous' then 'an initial that could be ' || r.note || ': only this full name and the initials'
                         else 'the same surname and first initial (one feed abbreviates)' end,
             case when r.years > 1 then 'but the birth years differ'
                  when r.years = 1 and r.with_year >= 2 then 'the same birth year' end,
             case when r.same_club then 'at clubs that are already linked' end),
           'ids', to_jsonb(r.ids), 'cards', public.link_player_cards(r.ids, true)) order by r.rn), '[]'::jsonb),
         coalesce(max(r.total), 0)
    into out_rows, n_total from r where r.rn > greatest(coalesce(p_offset, 0), 0) and r.rn <= greatest(coalesce(p_offset, 0), 0) + lim;
  return jsonb_build_object('rows', out_rows, 'total', n_total);
end $$;

create or replace function public.platform_link_groups(p_kind text, p_q text default null, p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  qk text := public.link_fold(p_q);
  lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  out_rows jsonb;
  n_total int;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    with g as (
      select g.id, g.name, row_number() over (order by g.name, g.id) rn, count(*) over () total
        from public.team_groups g
       where qk is null or public.link_fold(g.name) like '%' || qk || '%'
          or exists (select 1 from public.team_group_members m join public.teams t on t.id = m.team_id
                      where m.group_id = g.id and (public.link_fold(t.name) like '%' || qk || '%' or public.link_fold(t.short_name) like '%' || qk || '%')))
    select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
             'members', public.link_team_cards(array(select m.team_id from public.team_group_members m join public.teams t on t.id = m.team_id
                                                       where m.group_id = g.id order by public.team_is_youth(t.id), public.team_is_women(t.id), t.name))) order by g.rn), '[]'::jsonb),
           coalesce(max(g.total), 0) into out_rows, n_total
      from g where g.rn > greatest(coalesce(p_offset, 0), 0) and g.rn <= greatest(coalesce(p_offset, 0), 0) + lim;
  else
    with g as (
      select g.id, g.name, row_number() over (order by g.name, g.id) rn, count(*) over () total
        from public.player_groups g
       where qk is null or public.link_fold(g.name) like '%' || qk || '%'
          or exists (select 1 from public.player_group_members m join public.players p on p.id = m.player_id
                      where m.group_id = g.id and public.link_fold(p.first_name || ' ' || coalesce(p.last_name, '')) like '%' || qk || '%'))
    select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
             'members', public.link_player_cards(array(select m.player_id from public.player_group_members m
                                                        where m.group_id = g.id order by m.linked_at), true)) order by g.rn), '[]'::jsonb),
           coalesce(max(g.total), 0) into out_rows, n_total
      from g where g.rn > greatest(coalesce(p_offset, 0), 0) and g.rn <= greatest(coalesce(p_offset, 0), 0) + lim;
  end if;
  return jsonb_build_object('rows', out_rows, 'total', n_total);
end $$;

-- ----------------------------------------------------------------------------
-- 5. THE CONSOLE'S SETTERS
-- ----------------------------------------------------------------------------

/* a women's team, or not, by hand where the name and the league do not say (null: back to what they say). A row that no
   longer says anything at all is removed. */
create or replace function public.platform_team_set_women(p_team uuid, p_women boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.link_require_admin();
  if not exists (select 1 from public.teams where id = p_team) then
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
  values (auth.uid(), 'team_women_flag', 'team', p_team::text, jsonb_build_object('women', p_women));
  return public.team_is_women(p_team);
end $$;

/* a youth team, by hand: (true, 'U18') a youth side of that age, (true, null) youth with no age stated, (false, null) not
   a youth side whatever it is called, (null, 'U16') the same as (true, 'U16'), (null, null) back to what the names say */
create or replace function public.platform_team_set_youth(p_team uuid, p_youth boolean, p_age text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  age text := nullif(upper(btrim(coalesce(p_age, ''))), '');
begin
  perform public.link_require_admin();
  if not exists (select 1 from public.teams where id = p_team) then
    raise exception 'that team does not exist' using errcode = '22023';
  end if;
  if age is not null and age !~ '^U[0-9]{2}$' then
    raise exception 'an age group is U and two digits, like U18' using errcode = '22023';
  end if;
  if p_youth is false then age := null; end if;
  if p_youth is null and age is null then
    update public.team_flags set youth = null, age_group = null, set_by = auth.uid(), set_at = now() where team_id = p_team;
  else
    insert into public.team_flags (team_id, women, youth, age_group, set_by) values (p_team, null, coalesce(p_youth, true), age, auth.uid())
    on conflict (team_id) do update set youth = excluded.youth, age_group = excluded.age_group, set_by = excluded.set_by, set_at = now();
  end if;
  delete from public.team_flags where team_id = p_team and women is null and youth is null and age_group is null;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'team_youth_flag', 'team', p_team::text, jsonb_build_object('youth', p_youth, 'age', age));
  return jsonb_build_object('youth', public.team_is_youth(p_team), 'age', public.team_age_group(p_team));
end $$;

-- ----------------------------------------------------------------------------
-- 6. GRANTS, AND A CHECK THAT THEY ARE AS DESCRIBED
-- ----------------------------------------------------------------------------
revoke all on function public.link_looks_youth(text), public.link_youth_age(text),
  public.team_age_group(uuid), public.team_is_youth(uuid), public.team_traits(uuid) from public;
grant execute on function public.link_looks_youth(text), public.link_youth_age(text),
  public.team_age_group(uuid), public.team_is_youth(uuid), public.team_traits(uuid) to anon, authenticated, service_role;

revoke all on function public.platform_team_set_youth(uuid, boolean, text) from public, anon;
grant execute on function public.platform_team_set_youth(uuid, boolean, text) to authenticated, service_role;
alter function public.platform_team_set_youth(uuid, boolean, text) owner to postgres;

do $$
begin
  if has_function_privilege('anon', 'public.platform_team_set_youth(uuid, boolean, text)', 'execute') then
    raise exception '0181: a signed-out visitor can set a youth flag';
  end if;
  if not has_function_privilege('anon', 'public.team_traits(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.team_is_youth(uuid)', 'execute') then
    raise exception '0181: the team page cannot read a team''s traits';
  end if;
  raise notice '0181 ok: youth sides are told by name and age, set by administrators only, and read by everybody through team_traits';
end $$;
