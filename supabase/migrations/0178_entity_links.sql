-- ============================================================================
-- 0178 — LINKS: ONE CLUB, ONE PERSON, ACROSS COMPETITIONS, LEAGUES AND SEASONS.
--
-- London Lions in the SLB, London Lions in the EuroCup and London Lions Women are three team rows: one
-- per league, because that is how the feeds bring them. Cameron Christon in one feed and "C Christon" in
-- another are two player rows. This file adds the LINK between rows -- a group of teams that are one
-- club, a group of players that are one person -- without merging or repointing anything: every game,
-- stat line and roster entry stays on the row it was written against, so a link can be made, moved and
-- undone at any size and nothing has to be re-scraped.
--
--   team_groups / team_group_members       a club and the team rows that are it (women's sides too)
--   player_groups / player_group_members   a person and the player rows that are them
--   team_flags                             "this side is a women's team" (or is not), by hand, where the
--                                          name and the league do not say so (team_is_women)
--   link_dismissals                        a possible match somebody said is NOT one
--
-- THE PLATFORM CONSOLE'S LINKS TAB MAKES THEM (platform_link_* below, all platform administrators only):
--   * platform_link_suggestions   the POSSIBLE MATCHES, flagged with how sure the data is and why: the same
--                                 club name in several leagues (women's sides included), the same player name,
--                                 the same surname and first initial where a feed abbreviates, at clubs that
--                                 are already linked
--   * platform_link_search        type-ahead over thousands of rows, filtered by league and season
--   * platform_link_apply / _remove / _rename / _dismiss, platform_link_groups, platform_link_filters
--
-- AND WHEN CLUBS ARE LINKED, THEIR PLAYERS ARE LINKED FOR THEM (link_auto_players): a player row at one of the linked
-- clubs and a player row at another whose names match (the same first and last name whatever is between them, or a
-- surname with an initial for the first name where a feed abbreviates), with no birth year that disagrees and no
-- other row that could equally be the one, becomes one person, marked `auto` so the console can show it and one
-- click can undo it (an undone one is not made again). The console's link button runs it for the group just made;
-- the ingest runs it after each discovery pass, so a roster that arrives later is linked too. Anything doubtful is
-- left for the flagged possible matches.
--
-- AND THE PUBLIC PAGES READ THEM: linked_teams(team) and linked_players(player) say which other rows are
-- the same club or person, in which leagues and seasons, so a team page can offer a switcher between its
-- competitions and a player's career can run across them. team_is_women(team) is the women indicator.
--
-- WHAT THE PUBLIC CAN SEE. The tables are readable like teams and players are: a team group only names
-- public teams; a player group row is visible only when the player row is (a minor's stays hidden, through
-- players' own row-level security). Nothing here can be written by a browser: the writers are the
-- security-definer functions below, each of which checks is_platform_admin() first.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE KEYS: what makes two spellings the same
-- ----------------------------------------------------------------------------

/* lower case, the Latin diacritics of the leagues' languages folded (no unaccent extension is assumed, as
   in 0119 and 0162), punctuation and runs of space made one space; other scripts keep their own letters */
create or replace function public.link_fold(p_name text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(
           translate(lower(coalesce(p_name, '')),
                     'àáâãäåāăąçćčĉċďđèéêëēėęěĕğģĝġĥħìíîïīįıĩĵķłľĺļñńňņòóôõöøōőŏŕřŗśšşșŝßťţțùúûüūůűųũŭýÿŷźżžŵ',
                     'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiijkllllnnnnooooooooorrrsssssstttuuuuuuuuuuyyyzzzw'),
           '[[:space:][:punct:]“”„‘’«»‹›・「」『』（）［］【】、。，：；！？—–]+', ' ', 'g')), '');
$$;

/* a club's name reduced to the club: folded, and the words that vary by feed dropped (a gender word, the
   legal-form prefixes), so "London Lions", "London Lions BC" and "London Lions Women" share a key */
create or replace function public.link_team_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(btrim(regexp_replace(regexp_replace(public.link_fold(p_name),
      '\m(women|womens|woman|female|ladies|feminin|feminine|femenina|femenino|femminile|damen|frauen|dames|vrouwen|fc|bc|bk|kk|kb|cb|bbc|bsc|sc|club|team|the)\M', ' ', 'g'),
      '\s+', ' ', 'g')), ''),
    public.link_fold(p_name));
$$;

/* the words of a person's name, folded, without the generational suffix */
create or replace function public.link_person_tokens(p_first text, p_last text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array(select t from unnest(string_to_array(coalesce(
           public.link_fold(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), ''), ' ')) with ordinality u(t, i)
         where t <> '' and t not in ('jr', 'sr', 'ii', 'iii', 'iv') order by i), '{}');
$$;

/* the same words in any order: "John Smith" and "Smith John" */
create or replace function public.link_person_key(p_first text, p_last text)
returns text language sql immutable set search_path = public as $$
  select nullif(array_to_string(array(select t from unnest(public.link_person_tokens(p_first, p_last)) t order by t), ' '), '');
$$;

/* first initial | last word: where one feed writes "L Adekeye" and another "Lewis Adekeye" */
create or replace function public.link_person_short(p_first text, p_last text)
returns text language sql immutable set search_path = public as $$
  select case when cardinality(t) >= 2 then left(t[1], 1) || '|' || t[cardinality(t)] end
    from (select public.link_person_tokens(p_first, p_last) t) x;
$$;

/* first word | last word, the words between dropped: "Juan Carlos Perez" = "Juan Perez", "Troy J Baxter" = "Troy Baxter",
   "Anne-Marie de la Cruz" = "Anne Cruz" (a candidate, not a certainty: the console asks) */
create or replace function public.link_person_core(p_first text, p_last text)
returns text language sql immutable set search_path = public as $$
  select case when cardinality(t) >= 2 then t[1] || '|' || t[cardinality(t)] end
    from (select public.link_person_tokens(p_first, p_last) t) x;
$$;

/* a side that looks like a women's team by what it and its league are called (English and the leagues'
   own languages); a manual flag (team_flags) and the team's own gender column outrank this */
create or replace function public.link_looks_women(p_text text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(public.link_fold(p_text) ~
    '(^| )(women|womens|woman|female|ladies|feminin|feminine|femenina|femenino|femminile|damen|frauen|dames|vrouwen|wnba|wnbl|wjbl|lfb|kadinlar|kobiet|w league)( |$)', false);
$$;

create index if not exists teams_link_key on public.teams (public.link_team_key(name));
create index if not exists players_link_key on public.players (public.link_person_key(first_name, last_name));
create index if not exists players_link_short on public.players (public.link_person_short(first_name, last_name));
create index if not exists players_link_core on public.players (public.link_person_core(first_name, last_name));

-- ----------------------------------------------------------------------------
-- 2. THE TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.team_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.team_group_members (
  team_id   uuid primary key references public.teams on delete cascade,
  group_id  uuid not null references public.team_groups on delete cascade,
  linked_by uuid,
  linked_at timestamptz not null default now()
);
create index if not exists team_group_members_group on public.team_group_members (group_id);

create table if not exists public.player_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.player_group_members (
  player_id uuid primary key references public.players on delete cascade,
  group_id  uuid not null references public.player_groups on delete cascade,
  linked_by uuid,
  linked_at timestamptz not null default now(),
  auto        boolean not null default false,     -- made by link_auto_players, because the clubs are linked
  auto_reason text
);
create index if not exists player_group_members_group on public.player_group_members (group_id);

create table if not exists public.team_flags (
  team_id uuid primary key references public.teams on delete cascade,
  women   boolean not null,
  set_by  uuid,
  set_at  timestamptz not null default now()
);

create table if not exists public.link_dismissals (
  kind         text not null check (kind in ('team', 'player')),
  members_hash text not null,                 -- md5 of the candidate's ids, sorted: a new member makes it a new candidate
  dismissed_by uuid,
  dismissed_at timestamptz not null default now(),
  primary key (kind, members_hash)
);

alter table public.team_groups         enable row level security;
alter table public.team_group_members  enable row level security;
alter table public.player_groups       enable row level security;
alter table public.player_group_members enable row level security;
alter table public.team_flags          enable row level security;
alter table public.link_dismissals     enable row level security;

drop policy if exists team_groups_read on public.team_groups;
create policy team_groups_read on public.team_groups for select using (true);
drop policy if exists team_group_members_read on public.team_group_members;
create policy team_group_members_read on public.team_group_members for select using (true);
drop policy if exists player_groups_read on public.player_groups;
create policy player_groups_read on public.player_groups for select
  using (exists (select 1 from public.player_group_members m where m.group_id = player_groups.id));
drop policy if exists player_group_members_read on public.player_group_members;
create policy player_group_members_read on public.player_group_members for select
  using (exists (select 1 from public.players p where p.id = player_group_members.player_id));
drop policy if exists team_flags_read on public.team_flags;
create policy team_flags_read on public.team_flags for select using (true);
/* link_dismissals: no policy at all -- nobody but the definer functions below reads or writes it */

revoke all on public.team_groups, public.team_group_members, public.player_groups, public.player_group_members,
              public.team_flags, public.link_dismissals from anon, authenticated;
grant select on public.team_groups, public.team_group_members, public.player_groups, public.player_group_members,
                public.team_flags to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. READING: the women indicator and the cards both the console and the public pages draw
-- ----------------------------------------------------------------------------

/* IS THIS A WOMEN'S SIDE. A hand-set flag first, then the team's own gender if the organisation tree set one,
   then what the team, its slug and its league are called. Public: it is what the team page's badge asks. */
create or replace function public.team_is_women(p_team uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select f.women from public.team_flags f where f.team_id = t.id),
    case when t.gender in ('women', 'girls') then true when t.gender in ('men', 'boys') then false end,
    public.link_looks_women(concat_ws(' ', t.name, t.slug, l.name, l.slug)),
    false)
  from public.teams t left join public.leagues l on l.id = t.league_id
 where t.id = p_team;
$$;

/* the cards for some teams, in the order asked: what an administrator (or a switcher) needs to tell them apart.
   competitions: every competition the team has entered, newest season first. */
create or replace function public.link_team_cards(p_ids uuid[])
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(c.card order by c.ord), '[]'::jsonb) from (
    select u.ord, jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'name', t.name, 'short', t.short_name,
        'league_id', t.league_id, 'league', l.name, 'league_slug', l.slug,
        'women', public.team_is_women(t.id),
        'women_set', exists (select 1 from public.team_flags f where f.team_id = t.id),
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

/* the same for players. p_private adds the birth year -- the console shows it, it is the evidence -- but only
   for a platform administrator: for anybody else the flag changes nothing, so the public pages can call this too.
   One line per (club, league, season) he has a roster entry for. */
create or replace function public.link_player_cards(p_ids uuid[], p_private boolean default false)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(c.card order by c.ord), '[]'::jsonb) from (
    select u.ord, jsonb_strip_nulls(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'name', btrim(p.first_name || ' ' || coalesce(p.last_name, '')),
        'birth_year', case when p_private and public.is_platform_admin() then p.birth_year end,
        'spells', coalesce((select jsonb_agg(jsonb_build_object('team', x.team, 'team_slug', x.team_slug, 'league', x.league,
                                                                'league_slug', x.league_slug, 'season', x.season, 'women', x.women)
                                             order by x.season desc nulls last, x.team)
                             from (select distinct t.name team, t.slug team_slug, l.name league, l.slug league_slug, s.name season,
                                          public.team_is_women(t.id) women
                                     from public.roster_entries re
                                     join public.teams t on t.id = re.team_id
                                     left join public.leagues l on l.id = t.league_id
                                     left join public.seasons s on s.id = re.season_id
                                    where re.player_id = p.id) x), '[]'::jsonb),
        'group_id', m.group_id, 'group', g.name, 'auto', m.auto, 'auto_reason', m.auto_reason)) card
      from unnest(p_ids) with ordinality u(id, ord)
      join public.players p on p.id = u.id
      left join public.player_group_members m on m.player_id = p.id
      left join public.player_groups g on g.id = m.group_id
  ) c;
$$;

/* WHO ELSE IS THIS CLUB, for a team page: null when the team is linked to nothing */
create or replace function public.linked_teams(p_team uuid)
returns jsonb language sql stable set search_path = public as $$
  select case when m.group_id is null then null else jsonb_build_object(
    'group', g.name,
    'teams', public.link_team_cards(array(select gm.team_id from public.team_group_members gm
                                           join public.teams t on t.id = gm.team_id
                                          where gm.group_id = m.group_id
                                          order by (gm.team_id = p_team) desc, public.team_is_women(t.id), t.name))) end
    from (select 1) one
    left join public.team_group_members m on m.team_id = p_team
    left join public.team_groups g on g.id = m.group_id;
$$;

/* WHO ELSE IS THIS PERSON, for a profile: null when the player is linked to nothing */
create or replace function public.linked_players(p_player uuid)
returns jsonb language sql stable set search_path = public as $$
  select case when m.group_id is null then null else jsonb_build_object(
    'group', g.name,
    'players', public.link_player_cards(array(select gm.player_id from public.player_group_members gm
                                                where gm.group_id = m.group_id
                                                order by (gm.player_id = p_player) desc, gm.linked_at), false)) end
    from (select 1) one
    left join public.player_group_members m on m.player_id = p_player
    left join public.player_groups g on g.id = m.group_id;
$$;

revoke all on function public.link_fold(text), public.link_team_key(text), public.link_person_tokens(text, text),
  public.link_person_key(text, text), public.link_person_short(text, text), public.link_person_core(text, text),
  public.link_looks_women(text) from public;
grant execute on function public.link_fold(text), public.link_team_key(text), public.link_person_tokens(text, text),
  public.link_person_key(text, text), public.link_person_short(text, text), public.link_person_core(text, text),
  public.link_looks_women(text) to anon, authenticated, service_role;
revoke all on function public.team_is_women(uuid), public.link_team_cards(uuid[]), public.link_player_cards(uuid[], boolean),
  public.linked_teams(uuid), public.linked_players(uuid) from public;
grant execute on function public.team_is_women(uuid), public.link_team_cards(uuid[]), public.link_player_cards(uuid[], boolean),
  public.linked_teams(uuid), public.linked_players(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. THE CONSOLE'S FUNCTIONS (platform administrators only)
-- ----------------------------------------------------------------------------
create or replace function public.link_require_admin()
returns void language plpgsql stable set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.link_require_admin() from public, anon;
grant execute on function public.link_require_admin() to authenticated, service_role;

create or replace function public.link_require_kind(p_kind text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if p_kind not in ('team', 'player') then
    raise exception 'kind is team or player, not "%"', coalesce(p_kind, 'null') using errcode = '22023';
  end if;
  return p_kind;
end $$;
revoke all on function public.link_require_kind(text) from public, anon;
grant execute on function public.link_require_kind(text) to authenticated, service_role;

/* the drop-downs: every league, and every season name, so a search can be narrowed before it is typed */
create or replace function public.platform_link_filters()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.link_require_admin();
  return jsonb_build_object(
    'leagues', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'slug', l.slug) order by l.name)
                          from public.leagues l), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(x.name order by x.name desc) from (select distinct s.name from public.seasons s) x), '[]'::jsonb),
    'teams',   (select count(*) from public.teams),
    'players', (select count(*) from public.players),
    'team_groups',   (select count(*) from public.team_groups),
    'player_groups', (select count(*) from public.player_groups));
end $$;

/* TYPE-AHEAD. Names are matched folded (diacritics, case, punctuation), best matches first: the exact name,
   then names that begin with what was typed, then names that contain it. A team also matches its short name,
   its aliases and its league; a player his aliases. `namesakes` on a card is how many OTHER rows share its
   key, so a name with a twin somewhere shows it in the list. Fetches one row more than asked to say if more remain. */
create or replace function public.platform_link_search(
  p_kind text, p_q text default null, p_league uuid default null, p_season text default null,
  p_limit int default 20, p_offset int default 0, p_exclude uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  qk text := public.link_fold(p_q);
  lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  ids uuid[];
  more boolean;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    select array_agg(h.id order by h.rank, h.name), count(*) > lim into ids, more from (
      select t.id, t.name,
             case when qk is null then 2 when public.link_fold(t.name) = qk then 0 when public.link_fold(t.name) like qk || '%' then 1 else 2 end rank
        from public.teams t left join public.leagues l on l.id = t.league_id
       where (qk is null
              or public.link_fold(t.name) like '%' || qk || '%'
              or public.link_fold(t.short_name) like '%' || qk || '%'
              or public.link_team_key(t.name) like '%' || qk || '%'
              or public.link_fold(l.name) like '%' || qk || '%'
              or exists (select 1 from unnest(t.aliases) a where public.link_fold(a) like '%' || qk || '%'))
         and (p_league is null or t.league_id = p_league)
         and (p_season is null or exists (select 1 from public.competition_teams ct
                                            join public.competitions c on c.id = ct.competition_id
                                            join public.seasons s on s.id = c.season_id
                                           where ct.team_id = t.id and s.name = p_season))
         and not (t.id = any(coalesce(p_exclude, '{}')))
       order by 3, t.name offset greatest(coalesce(p_offset, 0), 0) limit lim + 1) h;
    return jsonb_build_object('rows', public.link_team_cards(coalesce(ids[1:lim], '{}')), 'more', coalesce(more, false));
  end if;
  select array_agg(h.id order by h.rank, h.name), count(*) > lim into ids, more from (
    select p.id, btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as name,
           case when qk is null then 2 when public.link_fold(p.first_name || ' ' || coalesce(p.last_name, '')) = qk then 0
                when public.link_fold(p.first_name || ' ' || coalesce(p.last_name, '')) like qk || '%' then 1 else 2 end rank
      from public.players p
     where (qk is null
            or public.link_fold(p.first_name || ' ' || coalesce(p.last_name, '')) like '%' || qk || '%'
            or public.link_fold(coalesce(p.last_name, '') || ' ' || p.first_name) like '%' || qk || '%'
            or (select bool_and(exists (select 1 from unnest(public.link_person_tokens(p.first_name, p.last_name)) nt where nt like qt || '%'))
                  from unnest(string_to_array(qk, ' ')) qt)
            or exists (select 1 from unnest(p.aliases) a where public.link_fold(a) like '%' || qk || '%'))
       and (p_league is null or exists (select 1 from public.roster_entries re join public.teams t on t.id = re.team_id
                                         where re.player_id = p.id and t.league_id = p_league))
       and (p_season is null or exists (select 1 from public.roster_entries re join public.seasons s on s.id = re.season_id
                                         where re.player_id = p.id and s.name = p_season))
       and not (p.id = any(coalesce(p_exclude, '{}')))
     order by 3, 2 offset greatest(coalesce(p_offset, 0), 0) limit lim + 1) h;
  return jsonb_build_object('rows', public.link_player_cards(coalesce(ids[1:lim], '{}'), true), 'more', coalesce(more, false));
end $$;

/* THE POSSIBLE MATCHES, flagged. Each row: the ids that look like one club / one person, why, and how sure.
     teams    'high'    the same name in more than one league    'medium' the same club once the legal-form and
                        gender words are set aside (women's sides come up here)    'low' the same league twice
     players  'high'    the same name and birth year, or at clubs already linked    'medium' the same name (or the
                        same first and last name whatever is between them, or surname + first initial where a feed
                        abbreviates), no birth year to check with    'low'     the birth years disagree
   Sets somebody dismissed are left out until a member is added; sets already all in one group are left out. */
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
                         when 'medium' then 'the same club once the legal-form and gender words are set aside (' || o.leagues || ' leagues)'
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

/* THE PART OF LINKING THAT THE CONSOLE AND THE AUTOMATIC PASS SHARE: put these rows in one group, bringing along the
   groups any of them are already in (two groups that turn out to be one are merged). The surviving group keeps the
   name given, else the oldest group's, else a row's. Not callable by a browser: the definer functions below are. */
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
    values (coalesce(nm, (select t.name from public.teams t where t.id = any(ids) order by (public.team_is_women(t.id)), t.name limit 1)), p_actor)
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

create or replace function public.link_join_players(p_ids uuid[], p_actor uuid, p_label text, p_auto boolean default false, p_reason text default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  ids uuid[]; gids uuid[]; keep uuid; nm text := nullif(btrim(coalesce(p_label, '')), ''); n int;
begin
  select array_agg(distinct x) into ids from unnest(coalesce(p_ids, '{}')) x;
  if (select count(*) from public.players where id = any(ids)) <> coalesce(cardinality(ids), 0) then
    raise exception 'one of those players does not exist' using errcode = '22023';
  end if;
  select array_agg(distinct m.group_id) into gids from public.player_group_members m where m.player_id = any(ids);
  select g.id into keep from public.player_groups g where g.id = any(coalesce(gids, '{}')) order by g.created_at, g.id limit 1;
  if keep is null then
    if coalesce(cardinality(ids), 0) < 2 then raise exception 'link at least two players' using errcode = '22023'; end if;
    insert into public.player_groups (name, created_by)
    values (coalesce(nm, (select btrim(p.first_name || ' ' || coalesce(p.last_name, '')) from public.players p
                           where p.id = any(ids) order by length(p.first_name || coalesce(p.last_name, '')) desc, p.id limit 1)), p_actor)
    returning id into keep;
  elsif nm is not null then
    update public.player_groups set name = nm where id = keep;
  end if;
  update public.player_group_members set group_id = keep where group_id = any(coalesce(gids, '{}')) and group_id <> keep;
  insert into public.player_group_members (player_id, group_id, linked_by, auto, auto_reason)
  select x, keep, p_actor, coalesce(p_auto, false), case when p_auto then p_reason end from unnest(ids) x on conflict (player_id) do nothing;
  delete from public.player_groups where id = any(coalesce(gids, '{}')) and id <> keep;
  select count(*) into n from public.player_group_members where group_id = keep;
  if n < 2 then raise exception 'link at least two players' using errcode = '22023'; end if;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (p_actor, case when p_auto then 'player_auto_link' else 'player_link' end, 'player_group', keep::text,
          jsonb_build_object('players', ids, 'merged', coalesce(gids, '{}'), 'reason', p_reason));
  return jsonb_build_object('group_id', keep, 'members', n);
end $$;
revoke all on function public.link_join_teams(uuid[], uuid, text), public.link_join_players(uuid[], uuid, text, boolean, text)
  from public, anon, authenticated;

/* THE PLAYERS OF LINKED CLUBS, LINKED. For every group of linked teams (or the one given): the players on their rosters
   are read as identities -- everyone with the same first and last word of the name (a middle name or a particle in one
   feed does not matter) -- and an identity written with just an initial ("L Adekeye") joins the ONE full identity it
   can be ("Lewis Adekeye"). Left alone, for the flagged possible matches, whatever is doubtful:
     * two rows on the SAME team with the same name are two people, so the identity is skipped
     * birth years that disagree
     * an initial that could be two different full names (James and John Smith)
     * a set that would merge two groups somebody made by hand
     * a set somebody undid (it is in link_dismissals)
   Returns { sets, players }: how many sets were linked and how many players were newly linked. */
create or replace function public.link_auto_players(p_group uuid default null, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  srt uuid[];
  n_sets int := 0;
  n_players int := 0;
  n_have int;
  n_groups int;
begin
  for s in
    with pp as (
      select tm.group_id tg, re.player_id pid, re.team_id, p.birth_year,
             public.link_person_core(p.first_name, p.last_name) ckey,
             public.link_person_short(p.first_name, p.last_name) skey,
             (public.link_person_tokens(p.first_name, p.last_name))[1] first_tok
        from public.roster_entries re
        join public.team_group_members tm on tm.team_id = re.team_id
        join public.players p on p.id = re.player_id
       where p_group is null or tm.group_id = p_group
       group by tm.group_id, re.player_id, re.team_id, p.birth_year, p.first_name, p.last_name),
    idn as (
      select pp.tg, pp.ckey, min(pp.skey) skey, (min(length(pp.first_tok)) = 1) initial,
             array_agg(distinct pp.pid) pids, array_agg(distinct pp.team_id) teams,
             coalesce(array_agg(distinct pp.birth_year) filter (where pp.birth_year is not null), '{}'::int[]) years,
             (select max(k) from (select count(distinct x.pid) k from pp x where x.tg = pp.tg and x.ckey = pp.ckey group by x.team_id) t) per_team
        from pp where pp.ckey is not null group by pp.tg, pp.ckey),
    good as (select * from idn where cardinality(years) <= 1 and per_team <= 1),
    att as (
      select i.tg, i.ckey ikey, array_agg(f.ckey) fkeys, count(*) n
        from good i
        join good f on f.tg = i.tg and i.initial and not f.initial and f.skey = i.skey and not (i.teams && f.teams)
                   and cardinality(array(select distinct y from unnest(i.years || f.years) y)) <= 1
       group by i.tg, i.ckey),
    sets as (
      select f.tg, f.pids || coalesce(i.pids, '{}'::uuid[]) pids,
             case when i.ckey is null then 'the same first and last name at linked clubs'
                  else 'the same surname, an initial for the first name, at linked clubs' end why
        from good f
        left join att a on a.tg = f.tg and a.n = 1 and a.fkeys[1] = f.ckey
        left join good i on i.tg = a.tg and i.ckey = a.ikey
       where not f.initial and (cardinality(f.pids) >= 2 or i.ckey is not null)
      union all
      select i.tg, i.pids, 'the same first and last name at linked clubs' from good i
       where i.initial and cardinality(i.pids) >= 2
         and not exists (select 1 from att a where a.tg = i.tg and a.ikey = i.ckey and a.n = 1))
    select pids, min(why) why from sets group by pids
  loop
    srt := array(select x from unnest(s.pids) x order by x);
    if exists (select 1 from public.link_dismissals d where d.kind = 'player' and d.members_hash = md5(array_to_string(srt, ','))) then
      continue;                                                    -- somebody said these are not the same person
    end if;
    select count(*), count(distinct m.group_id) into n_have, n_groups from public.player_group_members m where m.player_id = any(srt);
    if n_groups > 1 then continue; end if;                         -- it would merge two groups made by hand
    if n_groups = 1 and n_have = cardinality(srt) then continue; end if;   -- already one person
    perform public.link_join_players(srt, p_actor, null, true, s.why);
    n_sets := n_sets + 1;
    n_players := n_players + (cardinality(srt) - n_have);
  end loop;
  return jsonb_build_object('sets', n_sets, 'players', n_players);
end $$;

/* the console's button: the same pass, for one linked club or all of them */
create or replace function public.platform_link_auto(p_group uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.link_require_admin();
  return public.link_auto_players(p_group, auth.uid());
end $$;

/* LINK THEM: these rows are one. Linking clubs links their players too (link_auto_players): the answer says how many. */
create or replace function public.platform_link_apply(p_kind text, p_ids uuid[], p_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r jsonb;
  a jsonb;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    r := public.link_join_teams(p_ids, me, p_label);
    a := public.link_auto_players((r ->> 'group_id')::uuid, me);
    return r || jsonb_build_object('auto_sets', (a ->> 'sets')::int, 'auto_players', (a ->> 'players')::int);
  end if;
  return public.link_join_players(p_ids, me, p_label, false, null);
end $$;

/* TAKE ONE OUT. A group left with fewer than two rows is not a link any more and goes. */
create or replace function public.platform_link_remove(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  gid uuid;
  n int;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    delete from public.team_group_members where team_id = p_id returning group_id into gid;
    if gid is null then return jsonb_build_object('removed', false); end if;
    select count(*) into n from public.team_group_members where group_id = gid;
    if n < 2 then delete from public.team_groups where id = gid; end if;
    insert into public.audit_log (actor, action, subject, subject_id, detail)
    values (me, 'team_unlink', 'team_group', gid::text, jsonb_build_object('team', p_id, 'left', n));
  else
    /* an AUTOMATIC link that is undone is remembered as "not the same": the pass would otherwise make it again */
    if exists (select 1 from public.player_group_members m where m.player_id = p_id and m.auto) then
      insert into public.link_dismissals (kind, members_hash, dismissed_by)
      select 'player', md5(array_to_string(array(select y.player_id from public.player_group_members y
                                                   where y.group_id = m.group_id order by y.player_id), ',')), me
        from public.player_group_members m where m.player_id = p_id
      on conflict do nothing;
    end if;
    delete from public.player_group_members where player_id = p_id returning group_id into gid;
    if gid is null then return jsonb_build_object('removed', false); end if;
    select count(*) into n from public.player_group_members where group_id = gid;
    if n < 2 then delete from public.player_groups where id = gid; end if;
    insert into public.audit_log (actor, action, subject, subject_id, detail)
    values (me, 'player_unlink', 'player_group', gid::text, jsonb_build_object('player', p_id, 'left', n));
  end if;
  return jsonb_build_object('removed', true, 'left', n);
end $$;

create or replace function public.platform_link_rename(p_kind text, p_group uuid, p_label text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := nullif(btrim(coalesce(p_label, '')), '');
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if nm is null or char_length(nm) > 120 then raise exception 'a name of 1 to 120 characters' using errcode = '22023'; end if;
  if p_kind = 'team' then update public.team_groups set name = nm where id = p_group;
  else update public.player_groups set name = nm where id = p_group; end if;
end $$;

/* "NOT THE SAME": this set of rows stops being suggested (until one is added to it) */
create or replace function public.platform_link_dismiss(p_kind text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if coalesce(cardinality(p_ids), 0) < 2 then raise exception 'a set of at least two rows' using errcode = '22023'; end if;
  insert into public.link_dismissals (kind, members_hash, dismissed_by)
  values (p_kind, md5(array_to_string(array(select x from unnest(p_ids) x order by x), ',')), auth.uid())
  on conflict do nothing;
end $$;

/* every group, with its members' cards, for the "linked" list (the name or any member's name filters) */
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
                                                       where m.group_id = g.id order by public.team_is_women(t.id), t.name))) order by g.rn), '[]'::jsonb),
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

/* a women's team, or not, by hand where the name and the league do not say (null: back to what they say) */
create or replace function public.platform_team_set_women(p_team uuid, p_women boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.link_require_admin();
  if not exists (select 1 from public.teams where id = p_team) then
    raise exception 'that team does not exist' using errcode = '22023';
  end if;
  if p_women is null then
    delete from public.team_flags where team_id = p_team;
  else
    insert into public.team_flags (team_id, women, set_by) values (p_team, p_women, auth.uid())
    on conflict (team_id) do update set women = excluded.women, set_by = excluded.set_by, set_at = now();
  end if;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'team_women_flag', 'team', p_team::text, jsonb_build_object('women', p_women));
  return public.team_is_women(p_team);
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'platform_link_filters()', 'platform_link_search(text, text, uuid, text, int, int, uuid[])',
    'platform_link_suggestions(text, int, int)', 'platform_link_apply(text, uuid[], text)',
    'platform_link_remove(text, uuid)', 'platform_link_rename(text, uuid, text)',
    'platform_link_dismiss(text, uuid[])', 'platform_link_groups(text, text, int, int)',
    'platform_team_set_women(uuid, boolean)', 'platform_link_auto(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
    execute format('alter function public.%s owner to postgres', f);
  end loop;
end $grants$;

/* the automatic pass by itself: the ingest (the service role) calls it after each discovery pass */
revoke all on function public.link_auto_players(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_auto_players(uuid, uuid) to service_role;
alter function public.link_auto_players(uuid, uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 5. A CHECK THAT THE GRANTS ARE AS DESCRIBED
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.platform_link_apply(text, uuid[], text)', 'execute')
     or has_function_privilege('anon', 'public.platform_link_suggestions(text, int, int)', 'execute')
     or has_function_privilege('anon', 'public.platform_link_search(text, text, uuid, text, int, int, uuid[])', 'execute') then
    raise exception '0178: a signed-out visitor can reach the link tools';
  end if;
  if not has_function_privilege('anon', 'public.linked_teams(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.linked_players(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.team_is_women(uuid)', 'execute') then
    raise exception '0178: the public pages cannot read the links';
  end if;
  if has_function_privilege('anon', 'public.link_auto_players(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.link_auto_players(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.link_join_players(uuid[], uuid, text, boolean, text)', 'execute') then
    raise exception '0178: a browser can run the automatic link pass or the join helpers';
  end if;
  if has_table_privilege('anon', 'public.team_group_members', 'insert') or has_table_privilege('authenticated', 'public.player_group_members', 'update')
     or has_table_privilege('anon', 'public.link_dismissals', 'select') then
    raise exception '0178: a browser role can write a link, or read the dismissals';
  end if;
  raise notice '0178 ok: links are written by platform administrators only and read by everybody through linked_teams / linked_players';
end $$;
