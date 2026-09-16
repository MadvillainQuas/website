-- ============================================================================
-- 0119 — ORGANISATIONS: THE TREE A GOVERNING BODY IS, AND WHERE COMPETITIONS HANG ON IT.
--
-- The contract is docs/replacement/foundations.md: section 3.1 and 3.2 (the
-- tables and columns), section 4 (hierarchy and tenancy) and the 0119 slice in
-- section 9. It is the first of the native foundations (0119-0128) that let
-- Epinoia replace PlayHQ as Basketball England's membership and competition
-- system: the national body, its regions, the local league bodies, the clubs,
-- and which leagues and teams belong to which of them.
--
-- AS SHIPPED NOTHING CHANGES FOR ANYONE. There are no organisations until a
-- platform administrator builds some. Every new column is null, and null is
-- today's behaviour: a league with no organiser, a team with no club, a
-- competition with no age group. competition_teams gains an id that nothing
-- reads yet.
--
-- NOTHING HERE GRANTS ANYTHING. The tree decides nobody's rights until 0123
-- projects organisation roles into memberships. Until then every write below
-- is a platform administrator's (foundations section 9), and the tab that
-- makes them is on the platform console.
--
-- THE HOT PATH NEVER READS IT (ground rule 2). No policy on any other table
-- and no view mentions organisations or org_affiliations, and the self-test
-- proves it against pg_policies and pg_views. The two new foreign keys (from
-- leagues and from teams) are only ever checked when their value changes,
-- which only the setters below do.
--
-- WHAT THE PUBLIC SEES. organisations is readable like leagues and teams:
-- names, kinds and structure, the same things BE's own regions page and
-- PlayHQ's public API publish, and no contact details (a club's contact is
-- usually a volunteer's own email, and stays on 0036's closed team_contacts).
-- A hidden organisation (PlayHQ's visible / includeInFinder) is left out.
-- Affiliations are records kept by staff: the public sees only "affiliated"
-- and the accreditation level, through org_tree().
--
-- WHERE THIS FILE GOES BEYOND THE LETTER OF THE CONTRACT, each for a reason
-- given where it happens:
--   * the tree trigger also fires on kind, status and a hand-edited path, so
--     the parent-kind table and "nothing live under a dissolved parent" hold
--     whichever column a writer changes;
--   * a move that would change an organisation's tenant is refused outright
--     (section 4.3 and open question 11: the controller-change procedure is not
--     designed). 0122 may narrow this to "while the subtree holds people";
--   * a league's organiser is a national body, region, association or partner,
--     and a team's club is a club or school, and a later change of kind may not
--     break either;
--   * an affiliation that goes (the contract's keys cascade from seasons and
--     organisations, and a league admin may delete a season) leaves an audit row;
--   * section 8 waits at most five seconds for its locks;
--   * org_kind_may_parent, org_slug_from and org_affiliations_removed are small
--     helpers the contract does not name.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. WHAT ANONYMOUS VISITORS COULD SEE BEFORE THIS FILE, kept for the
--    self-test at the bottom: the row counts of leagues and teams signed out
--    (and as the owner, so a row the ingest adds meanwhile is not mistaken for
--    a change), and every foreign key between two public tables, so the test
--    can prove no new PostgREST embed path appeared between existing tables.
--    Held in a session setting because nothing else survives from one
--    statement of a migration to the next; the self-test clears it.
-- ----------------------------------------------------------------------------
do $before$
declare
  orig    text := current_user;
  lg_all  bigint;
  tm_all  bigint;
  lg_anon bigint;
  tm_anon bigint;
  fks     text;
begin
  select count(*) into lg_all from public.leagues;
  select count(*) into tm_all from public.teams;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into lg_anon from public.leagues;
  select count(*) into tm_anon from public.teams;
  execute format('set local role %I', orig);

  select coalesce(string_agg(x.pair, ',' order by x.pair), '') into fks
    from (select distinct a.relname::text || '>' || b.relname::text as pair
            from pg_constraint c
            join pg_class a on a.oid = c.conrelid
            join pg_class b on b.oid = c.confrelid
           where c.contype = 'f'
             and a.relnamespace = 'public'::regnamespace
             and b.relnamespace = 'public'::regnamespace
             and a.relname not in ('organisations', 'org_affiliations')
             and b.relname not in ('organisations', 'org_affiliations')) x;

  perform set_config('epinoia.t119_before', jsonb_build_object(
    'leagues_all', lg_all, 'teams_all', tm_all,
    'leagues_anon', lg_anon, 'teams_anon', tm_anon,
    'fks', fks)::text, false);
end $before$;

-- ----------------------------------------------------------------------------
-- 1. THE ORGANISATIONS
--
-- One table for the whole tree, with each row's own path from its root, rather
-- than a closure table (foundations 0.4 row 5): ancestors are the row's path,
-- descendants are `path @> array[x]` on a GIN index, and about 1,200 BE
-- organisations make that trivial. The ROOT of a tree is a tenant: a data
-- controller (Basketball England; later Basketball Scotland, or an independent
-- league), and every row carries its root as tenant_id.
--
-- Rights will inherit only along parent_id (from 0123). Affiliations, which are
-- relationships a club has with bodies it does not sit under, are dated rows in
-- org_affiliations and grant nothing.
-- ----------------------------------------------------------------------------
create table if not exists public.organisations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,                     -- the root; = id for a root. Set by trigger
  parent_id     uuid references public.organisations on delete restrict,
  path          uuid[] not null,                   -- root..self. Set by trigger
  kind          text not null check (kind in
                  ('national_body','region','association','club','school','partner')),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  short_name    text not null default '' check (char_length(short_name) <= 40),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  status        text not null default 'active'
                  check (status in ('pending','active','suspended','lapsed','dissolved','merged')),
  merged_into   uuid references public.organisations on delete restrict,
  visible       boolean not null default true,     -- PlayHQ visible / includeInFinder
  country       char(2) not null default 'GB',
  home_nation   text check (home_nation in ('ENG','SCO','WAL','NIR')),
  time_zone     text not null default 'Europe/London',
  website       text check (website is null or website ~ '^https://'),
  logo_path     text,
  registered_no text check (char_length(registered_no) <= 40),  -- company / charity / CASC: public registers
  settings      jsonb not null default '{}'::jsonb,              -- roots only; keys in foundations 4.4
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint org_tenant_fk      foreign key (tenant_id) references public.organisations
                                deferrable initially deferred,
  constraint org_root_ck        check ((parent_id is null) = (tenant_id = id)),
  constraint org_root_kind_ck   check (parent_id is not null or kind in ('national_body','association')),
  constraint org_settings_ck    check (parent_id is null or settings = '{}'::jsonb),
  constraint org_merged_ck      check ((status = 'merged') = (merged_into is not null))
);
create index if not exists organisations_parent on public.organisations (parent_id);
create index if not exists organisations_path   on public.organisations using gin (path);
create index if not exists organisations_kind   on public.organisations (tenant_id, kind);

comment on table public.organisations is
  'The governing structure: national bodies, regions, local league bodies (association), clubs, '
  'schools and partners. The root of each tree is a tenant (a data controller). Public, like '
  'leagues; hidden rows are left out. Written only by the platform console''s RPCs (0119).';

/* Which kind may sit under which (foundations 3.1). Pure, and the only copy of
   the table: the tree trigger, the setters and the console's refusals all ask
   it, so the rule cannot be two rules.

     national_body   none (a tenant)
     region          national_body
     association     none (a tenant), national_body, region
     club, school    national_body, region, association
     partner         national_body

   It follows from the table that no cycle can be built from legal kinds; the
   trigger checks for one anyway, because a kind can be changed. */
create or replace function public.org_kind_may_parent(p_kind text, p_parent_kind text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(case p_kind
    when 'national_body' then p_parent_kind is null
    when 'region'        then p_parent_kind = 'national_body'
    when 'association'   then p_parent_kind is null or p_parent_kind in ('national_body', 'region')
    when 'club'          then p_parent_kind in ('national_body', 'region', 'association')
    when 'school'        then p_parent_kind in ('national_body', 'region', 'association')
    when 'partner'       then p_parent_kind = 'national_body'
  end, false);
$$;

/* THE TREE TRIGGER. tenant_id and path are never taken from a writer: they are
   worked out from the parent every time the row's place could have changed.
   It refuses:
     * a parent that does not exist;
     * a cycle (the row is already on its new parent's path);
     * a parent of a kind the table above does not allow;
     * a dissolved or merged parent, when the row is new, is moving, or is
       itself coming back from dissolved or merged;
     * a change of tenant. Moving an organisation into another tree, making a
       tenant part of another one, or cutting a branch loose as a tenant of its
       own all change who controls its data. That is a procedure of its own
       (foundations 4.3, open question 11) and is not designed, so it is refused
       here for every writer. 0122 may narrow it to "while the subtree holds
       persons, registrations or organisation roles";
     * a kind change that would strand what already sits below, or leave a
       league run by, or a team belonging to, a kind the setters would refuse
       (set_league_organiser, set_team_club). Affiliations are not held to this:
       they are dated records with no way to remove one from the console, and
       record_affiliation checks both kinds again on any change to one;
     * dissolving or merging an organisation that still has something live
       below it, which is how "no live organisation under a dissolved parent"
       stays true whichever column changes;
     * a change of id, which every descendant's path is made of.

   Beyond the contract's "OF parent_id" it also fires on kind, status and a
   hand-edited tenant_id or path, for exactly those reasons: a hand-edited path
   is simply put back.

   The one thing it lets through untouched is its own branch rewrite (the AFTER
   trigger below), recognised by a transaction-local setting AND by nothing but
   path moving. Security invoker: only postgres-owned RPCs and the service role
   can write the table at all. */
create or replace function public.organisations_tree()
returns trigger language plpgsql set search_path = public as $$
declare
  v_parent record;
  v_child  record;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'an organisation keeps its id: the path of everything below it is made of it'
        using errcode = '23514';
    end if;
    if coalesce(current_setting('epinoia.org_tree_rewrite', true), '') = 'on'
       and new.parent_id is not distinct from old.parent_id
       and new.kind = old.kind and new.status = old.status
       and new.tenant_id = old.tenant_id then
      return new;
    end if;
  end if;

  if new.parent_id is null then
    if not public.org_kind_may_parent(new.kind, null) then
      raise exception '"%" (%) cannot stand on its own: only a national body or an association is a tenant',
        new.name, replace(new.kind, '_', ' ')
        using errcode = '23514';
    end if;
    new.tenant_id := new.id;
    new.path := array[new.id];
  else
    select o.id, o.tenant_id, o.path, o.kind, o.status, o.name
      into v_parent
      from organisations o
     where o.id = new.parent_id;
    if not found then
      raise exception 'no such parent organisation' using errcode = '23503';
    end if;
    if new.id = any (v_parent.path) then
      raise exception '"%" cannot sit inside itself: "%" is already below it', new.name, v_parent.name
        using errcode = '23514';
    end if;
    if not public.org_kind_may_parent(new.kind, v_parent.kind) then
      raise exception '"%" (%) may not sit under "%" (%)',
        new.name, replace(new.kind, '_', ' '), v_parent.name, replace(v_parent.kind, '_', ' ')
        using errcode = '23514';
    end if;
    if v_parent.status in ('dissolved', 'merged')
       and (tg_op = 'INSERT'
            or new.parent_id is distinct from old.parent_id
            or (new.status not in ('dissolved', 'merged') and old.status in ('dissolved', 'merged'))) then
      raise exception '"%" is % and takes nothing new below it', v_parent.name, v_parent.status
        using errcode = '23514';
    end if;
    new.tenant_id := v_parent.tenant_id;
    new.path := v_parent.path || new.id;
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'moving "%" would put it in another tenant, which changes who controls its data. That is a procedure of its own (foundations 4.3, open question 11), not a move',
        new.name
        using errcode = '23514';
    end if;
    if new.kind <> old.kind then
      select c.name, c.kind into v_child
        from organisations c
       where c.parent_id = new.id
         and not public.org_kind_may_parent(c.kind, new.kind)
       limit 1;
      if found then
        raise exception '"%" (now %) may not hold "%" (%), which sits under it; move that first',
          new.name, replace(new.kind, '_', ' '), v_child.name, replace(v_child.kind, '_', ' ')
          using errcode = '23514';
      end if;
      -- the setters' rules, kept whichever side changes (leagues_organiser and teams_club serve these)
      if new.kind not in ('national_body', 'region', 'association', 'partner')
         and exists (select 1 from leagues l where l.organiser_id = new.id) then
        raise exception '"%" (now %) runs a league, which only a national body, region, association or partner does; record another organiser first',
          new.name, replace(new.kind, '_', ' ')
          using errcode = '23514';
      end if;
      if new.kind not in ('club', 'school')
         and exists (select 1 from teams t where t.club_id = new.id) then
        raise exception '"%" (now %) has teams, which only a club or school has; unlink them first',
          new.name, replace(new.kind, '_', ' ')
          using errcode = '23514';
      end if;
    end if;
    if new.status in ('dissolved', 'merged') and new.status is distinct from old.status then
      select c.name into v_child
        from organisations c
       where c.parent_id = new.id
         and c.status not in ('dissolved', 'merged')
       limit 1;
      if found then
        raise exception '"%" still has "%" below it: move or dissolve what sits below it first',
          new.name, v_child.name
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists organisations_tree on public.organisations;
create trigger organisations_tree
  before insert or update of id, parent_id, kind, status, tenant_id, path on public.organisations
  for each row execute function public.organisations_tree();

/* A moved organisation takes its branch with it: every descendant's path is
   the new path followed by whatever sat below the moved row. Worked out from
   the moved row alone, in one statement, because the order in which a
   statement updates rows is not defined and a descendant cannot trust its
   parent to have been rewritten first. The tenant cannot change (above). */
create or replace function public.organisations_tree_descendants()
returns trigger language plpgsql set search_path = public as $$
begin
  perform set_config('epinoia.org_tree_rewrite', 'on', true);
  update organisations d
     set path = new.path || d.path[array_position(d.path, new.id) + 1 :]
   where d.path @> array[new.id]
     and d.id <> new.id;
  perform set_config('epinoia.org_tree_rewrite', 'off', true);
  return null;
end; $$;

drop trigger if exists organisations_tree_descendants on public.organisations;
create trigger organisations_tree_descendants
  after update of parent_id on public.organisations
  for each row when (old.parent_id is distinct from new.parent_id)
  execute function public.organisations_tree_descendants();

/* A tenant's settings (foundations 4.4), validated by trigger so an import
   writing with the service role meets the same rule as the console. Only the
   named keys, each with its own type and range, and the three ages in order:
   own login <= publication consent <= minor. Absent keys take the contract's
   defaults when read (restricted.tenant_setting, 0122). Non-roots carry none at
   all: org_settings_ck. */
create or replace function public.organisations_settings_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_key   text;
  v_val   jsonb;
  v_int   int;
  v_login int := 13;
  v_pub   int := 16;
  v_minor int := 18;
  v_m     int;
  v_d     int;
  v_names constant text[] := array['ethnicity', 'disability', 'disability_detail', 'religion',
                                   'sexual_orientation', 'gender_identity_same_as_birth'];
begin
  if new.settings is null or new.settings = '{}'::jsonb then
    return new;
  end if;
  if jsonb_typeof(new.settings) <> 'object' then
    raise exception 'a tenant''s settings are an object of named values' using errcode = '23514';
  end if;

  for v_key, v_val in select s.key, s.value from jsonb_each(new.settings) as s loop
    if v_key in ('minor_age', 'own_login_min_age', 'publication_consent_age', 'merge_min_fields') then
      if jsonb_typeof(v_val) <> 'number' or v_val::text !~ '^[0-9]{1,2}$' then
        raise exception 'the setting % is a whole number, not %', v_key, v_val using errcode = '23514';
      end if;
      v_int := (v_val::text)::int;
      if (v_key = 'minor_age' and v_int not between 16 and 21)
         or (v_key in ('own_login_min_age', 'publication_consent_age') and v_int not between 13 and 18)
         or (v_key = 'merge_min_fields' and v_int not between 2 and 6) then
        raise exception 'the setting % cannot be %', v_key, v_int using errcode = '23514';
      end if;
      if v_key = 'minor_age' then
        v_minor := v_int;
      elsif v_key = 'own_login_min_age' then
        v_login := v_int;
      elsif v_key = 'publication_consent_age' then
        v_pub := v_int;
      end if;
    elsif v_key = 'age_cutoff' then
      if jsonb_typeof(v_val) <> 'string'
         or (v_val #>> '{}') !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
        raise exception 'age_cutoff is a month and day written MM-DD, such as "09-01", not %', v_val
          using errcode = '23514';
      end if;
      v_m := split_part(v_val #>> '{}', '-', 1)::int;
      v_d := split_part(v_val #>> '{}', '-', 2)::int;
      if v_d > extract(day from make_date(2001, v_m, 1) + interval '1 month' - interval '1 day')::int then
        raise exception 'there is no % in a common year, so it cannot be the age cut-off', v_val #>> '{}'
          using errcode = '23514';
      end if;
    elsif v_key = 'import_special_category' then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'import_special_category is true or false' using errcode = '23514';
      end if;
    elsif v_key = 'sensitive_fields' then
      if jsonb_typeof(v_val) <> 'array'
         or exists (select 1 from jsonb_array_elements(v_val) as x(v)
                     where jsonb_typeof(x.v) <> 'string' or not ((x.v #>> '{}') = any (v_names)))
         or jsonb_array_length(v_val) <> (select count(distinct x.v) from jsonb_array_elements(v_val) as x(v)) then
        raise exception 'sensitive_fields lists, once each, only these: %', array_to_string(v_names, ', ')
          using errcode = '23514';
      end if;
    elsif v_key = 'equality_condition' then
      if jsonb_typeof(v_val) <> 'string'
         or (v_val #>> '{}') not in ('explicit_consent', 'dpa2018_sch1_para8') then
        raise exception 'equality_condition is "explicit_consent" or "dpa2018_sch1_para8"' using errcode = '23514';
      end if;
    elsif v_key = 'dpo_contact' then
      if jsonb_typeof(v_val) not in ('string', 'null')
         or char_length(coalesce(v_val #>> '{}', '')) > 200 then
        raise exception 'dpo_contact is a line of text of at most 200 characters' using errcode = '23514';
      end if;
    else
      raise exception 'a tenant has no setting called "%"; the settings are minor_age, own_login_min_age, publication_consent_age, age_cutoff, merge_min_fields, import_special_category, sensitive_fields, equality_condition and dpo_contact',
        v_key
        using errcode = '23514';
    end if;
  end loop;

  if not (v_login <= v_pub and v_pub <= v_minor) then
    raise exception 'a tenant''s ages run own login (%) <= publication consent (%) <= minor (%)',
      v_login, v_pub, v_minor
      using errcode = '23514';
  end if;
  return new;
end; $$;

drop trigger if exists organisations_settings_guard on public.organisations;
create trigger organisations_settings_guard
  before insert or update of settings on public.organisations
  for each row execute function public.organisations_settings_guard();

-- updated_at, kept honest whoever writes: 0117's generic touch function.
drop trigger if exists organisations_touch on public.organisations;
create trigger organisations_touch before update on public.organisations
  for each row execute function public.access_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. AFFILIATIONS: RECORDS, NOT RIGHTS
--
-- A club's relationships with bodies it does not sit under, dated per season:
--   governing_body  the annual affiliation to BE (the £120), with Level 1/2
--                   accreditation on it;
--   league_member   a club's membership of a local league;
--   season_invite   PlayHQ's "club accepted season invite", naming the season.
-- Across tenants is allowed and expected: an independent league that affiliates
-- to BE is a row here, and BE sees the affiliation, not the people.
--
-- No policy at all. Staff read it through organisation_admin(); the public sees
-- "affiliated" and the level through org_tree().
-- ----------------------------------------------------------------------------
create table if not exists public.org_affiliations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations on delete cascade,  -- the club or association joining
  to_org_id     uuid not null references public.organisations on delete cascade,  -- BE, a region, a local league body
  kind          text not null check (kind in ('governing_body','league_member','season_invite')),
  season_label  text not null check (season_label ~ '^[0-9]{4}/[0-9]{2}$'),
  season_id     uuid references public.seasons on delete cascade,                 -- season_invite only
  valid_from    date not null,
  valid_to      date,
  status        text not null default 'pending'
                  check (status in ('pending','active','lapsed','suspended','refused','withdrawn')),
  reference     text check (char_length(reference) <= 40),                         -- affiliation number
  accreditation text not null default 'none' check (accreditation in ('none','level_1','level_2')),
  decided_by    uuid references auth.users on delete set null,
  decided_at    timestamptz,
  note          text not null default '' check (char_length(note) <= 400),
  created_at    timestamptz not null default now(),
  constraint aff_distinct_ck check (org_id <> to_org_id),
  constraint aff_invite_ck   check ((kind = 'season_invite') = (season_id is not null)),
  constraint aff_dates_ck    check (valid_to is null or valid_to >= valid_from),
  constraint aff_accred_ck   check (accreditation = 'none' or kind = 'governing_body'),
  unique (org_id, to_org_id, kind, season_label)
);
-- the unique key leads with org_id; these serve the other direction and the cascades
create index if not exists org_affiliations_to     on public.org_affiliations (to_org_id, kind, status);
create index if not exists org_affiliations_season on public.org_affiliations (season_id) where season_id is not null;

/* AN AFFILIATION THAT GOES LEAVES A TRAIL. Nothing in the console deletes one,
   but the contract's keys cascade (foundations 3.1): a league administrator
   deleting a season of their league, or the league itself (seasons_write,
   leagues_write, 0001), takes that season's invites with it, and deleting an
   organisation (the owner or the service role only) takes its records. Whether
   a season's invite should instead block the delete is the contract's call;
   until it says so, each removal is written to the audit log as
   org.affiliation_removed with the whole row and whoever asked, so a platform
   administrator can see it went and record it again.

   Security definer, pinned to postgres, so the row is written whoever's delete
   it was. The actor is kept only while that account exists, so a stale token
   cannot turn the audit row's foreign key into a refused delete. */
create or replace function public.org_affiliations_removed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, subject, subject_id, detail)
  values ((select u.id from auth.users u where u.id = auth.uid()),
          'org.affiliation_removed', 'org_affiliation', old.id::text,
          to_jsonb(old));
  return null;
end; $$;

drop trigger if exists org_affiliations_removed on public.org_affiliations;
create trigger org_affiliations_removed
  after delete on public.org_affiliations
  for each row execute function public.org_affiliations_removed();

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY, and the table privileges behind it.
--
-- organisations: read like leagues, hidden rows for platform admins only, and
-- no write policy at all. The explicit revokes are belt and braces over RLS: a
-- browser write is refused outright, not answered with zero rows, so a policy
-- added by mistake later still cannot open it (the game_shares pattern, 0093).
-- org_affiliations: RLS on, no policy, no browser privilege.
-- ----------------------------------------------------------------------------
alter table public.organisations    enable row level security;
alter table public.org_affiliations enable row level security;

drop policy if exists org_read on public.organisations;
create policy org_read on public.organisations for select
  using (visible or (select public.is_platform_admin()));

revoke all on table public.organisations, public.org_affiliations from anon, authenticated;
grant select on table public.organisations to anon, authenticated;
grant all on table public.organisations, public.org_affiliations to service_role;

-- ----------------------------------------------------------------------------
-- 4. AGES (foundations 3.2), for eligibility and for the born window of a
--    division. Immutable, and callable by anybody: they are arithmetic.
--
--   season_age     age on the day BEFORE the cut-off in the season's start year
--                  (with the default 09-01: on 31 August);
--   age_band_born  the dates of birth an age band covers: from the cut-off in
--                  year start - band to the day before it in year start - band + 2.
--                  U18 in 2026/27 is 2008-09-01 to 2010-08-31, as Appendix 2
--                  quotes. Returned as a daterange, which Postgres writes
--                  half-open: [2008-09-01,2010-09-01).
--
-- A cut-off is MM-DD, and must exist in a common year: 02-29 is refused rather
-- than silently moved in three years out of four.
-- ----------------------------------------------------------------------------
create or replace function public.season_age(p_dob date, p_start_year int, p_cutoff text default '09-01')
returns int language plpgsql immutable set search_path = public as $$
declare
  v_m int;
  v_d int;
begin
  if p_cutoff is null or p_cutoff !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
    raise exception 'an age cut-off is a month and day written MM-DD, such as 09-01, not "%"', p_cutoff
      using errcode = '22023';
  end if;
  v_m := split_part(p_cutoff, '-', 1)::int;
  v_d := split_part(p_cutoff, '-', 2)::int;
  if v_d > extract(day from make_date(2001, v_m, 1) + interval '1 month' - interval '1 day')::int then
    raise exception 'there is no % in a common year, so it cannot be an age cut-off', p_cutoff
      using errcode = '22023';
  end if;
  if p_start_year is not null and p_start_year not between 1900 and 2200 then
    raise exception 'a season starts in a year from 1900 to 2200, not %', p_start_year
      using errcode = '22023';
  end if;
  if p_dob is null or p_start_year is null then
    return null;
  end if;
  -- timestamps without time zone, so the answer never depends on the session's zone
  return extract(year from age((make_date(p_start_year, v_m, v_d) - 1)::timestamp,
                               p_dob::timestamp))::int;
end; $$;

create or replace function public.age_band_born(p_band int, p_start_year int, p_cutoff text default '09-01')
returns daterange language plpgsql immutable set search_path = public as $$
declare
  v_m int;
  v_d int;
begin
  if p_cutoff is null or p_cutoff !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
    raise exception 'an age cut-off is a month and day written MM-DD, such as 09-01, not "%"', p_cutoff
      using errcode = '22023';
  end if;
  v_m := split_part(p_cutoff, '-', 1)::int;
  v_d := split_part(p_cutoff, '-', 2)::int;
  if v_d > extract(day from make_date(2001, v_m, 1) + interval '1 month' - interval '1 day')::int then
    raise exception 'there is no % in a common year, so it cannot be an age cut-off', p_cutoff
      using errcode = '22023';
  end if;
  if p_band is not null and p_band not between 1 and 99 then
    raise exception 'an age band is U1 to U99, not U%', p_band using errcode = '22023';
  end if;
  if p_start_year is not null and p_start_year not between 1900 and 2200 then
    raise exception 'a season starts in a year from 1900 to 2200, not %', p_start_year
      using errcode = '22023';
  end if;
  if p_band is null or p_start_year is null then
    return null;
  end if;
  return daterange(make_date(p_start_year - p_band, v_m, v_d),
                   make_date(p_start_year - p_band + 2, v_m, v_d), '[)');
end; $$;

-- ----------------------------------------------------------------------------
-- 5. READING THE TREE
-- ----------------------------------------------------------------------------

/* An address from a name: lower case, the common Latin diacritics folded
   (no unaccent extension is assumed: foundations 0.4 row 20), everything else
   a hyphen, at most 80 characters. Null when that leaves under two. */
create or replace function public.org_slug_from(p_name text)
returns text language sql immutable set search_path = public as $$
  select case when char_length(x.s) >= 2 then x.s end
    from (select btrim(left(btrim(regexp_replace(
                   translate(lower(coalesce(p_name, '')),
                             'àáâãäåāăąçćčďèéêëēėęěìíîïīįłñńňòóôõöøōőŕřśšşťùúûüūůűýÿźżž',
                             'aaaaaaaaacccdeeeeeeeeiiiiiilnnnoooooooorrssstuuuuuuuyyzzz'),
                   '[^a-z0-9]+', '-', 'g'), '-'), 80), '-') as s) x;
$$;

/* THE PUBLIC TREE, for a club directory. Visible organisations only, in the
   subtree of p_root when one is named, parents before children. What an
   affiliation shows the public is two things: whether a governing-body
   affiliation is active and in force today (London), and the best
   accreditation level on one. Not the reference, the dates, the note, or who
   decided it. */
create or replace function public.org_tree(p_root uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.depth, x.name, x.id), '[]'::jsonb)
    from (select o.id, o.name, cardinality(o.path) - 1 as depth,
                 jsonb_build_object(
                   'id', o.id, 'tenant_id', o.tenant_id, 'parent_id', o.parent_id,
                   'kind', o.kind, 'name', o.name, 'short_name', o.short_name, 'slug', o.slug,
                   'status', o.status, 'country', o.country, 'home_nation', o.home_nation,
                   'website', o.website, 'logo_path', o.logo_path,
                   'registered_no', o.registered_no,
                   'depth', cardinality(o.path) - 1,
                   'affiliated', a.level is not null,
                   'accreditation', coalesce(a.level, 'none')) as j
            from organisations o
            left join lateral (
              select case max(case f.accreditation when 'level_2' then 2 when 'level_1' then 1 else 0 end)
                       when 2 then 'level_2' when 1 then 'level_1' when 0 then 'none' end as level
                from org_affiliations f
               where f.org_id = o.id
                 and f.kind = 'governing_body'
                 and f.status = 'active'
                 and f.valid_from <= (now() at time zone 'Europe/London')::date
                 and (f.valid_to is null or f.valid_to >= (now() at time zone 'Europe/London')::date)) a on true
           where o.visible
             and (p_root is null or o.path @> array[p_root])) x;
$$;

/* THE PLATFORM CONSOLE'S ORGANISATIONS TAB. Platform administrators only until
   0123 widens it to org.read in scope.

   Without an organisation: every organisation (hidden ones too), each with its
   depth, counts and affiliation state, ordered as a tree (by the names along
   its path); every league with its organiser, for the pickers; and the totals.

   With one: the row itself, its ancestors, its children, every affiliation in
   either direction, the leagues it runs and the teams that belong to it. */
create or replace function public.organisation_admin(p_org uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
  v_org   public.organisations;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  if p_org is null then
    return jsonb_build_object(
      'today', v_today,
      'organisations', coalesce((
        select jsonb_agg(x.j order by x.sort_key)
          from (select jsonb_build_object(
                         'id', o.id, 'tenant_id', o.tenant_id, 'parent_id', o.parent_id,
                         'kind', o.kind, 'name', o.name, 'short_name', o.short_name,
                         'slug', o.slug, 'status', o.status, 'visible', o.visible,
                         'merged_into', o.merged_into,
                         'depth', cardinality(o.path) - 1,
                         'path', to_jsonb(o.path),
                         'children', (select count(*) from organisations c where c.parent_id = o.id),
                         'leagues', (select count(*) from leagues l where l.organiser_id = o.id),
                         'teams', (select count(*) from teams t where t.club_id = o.id),
                         'affiliated', a.level is not null,
                         'accreditation', coalesce(a.level, 'none')) as j,
                       (select array_agg(lower(p.name) || ' ' || p.id::text order by u.ord)
                          from unnest(o.path) with ordinality as u(id, ord)
                          join organisations p on p.id = u.id) as sort_key
                  from organisations o
                  left join lateral (
                    select case max(case f.accreditation when 'level_2' then 2 when 'level_1' then 1 else 0 end)
                             when 2 then 'level_2' when 1 then 'level_1' when 0 then 'none' end as level
                      from org_affiliations f
                     where f.org_id = o.id
                       and f.kind = 'governing_body'
                       and f.status = 'active'
                       and f.valid_from <= v_today
                       and (f.valid_to is null or f.valid_to >= v_today)) a on true) x), '[]'::jsonb),
      'leagues', coalesce((
        select jsonb_agg(jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name,
                                            'organiser_id', l.organiser_id)
                         order by l.name)
          from leagues l), '[]'::jsonb),
      'counts', jsonb_build_object(
        'organisations', (select count(*) from organisations),
        'tenants', (select count(*) from organisations where parent_id is null),
        'clubs', (select count(*) from organisations where kind in ('club', 'school')),
        'hidden', (select count(*) from organisations where not visible),
        'leagues', (select count(*) from leagues),
        'leagues_linked', (select count(*) from leagues where organiser_id is not null),
        'teams', (select count(*) from teams),
        'teams_linked', (select count(*) from teams where club_id is not null),
        'affiliated', (select count(distinct f.org_id) from org_affiliations f
                        where f.kind = 'governing_body' and f.status = 'active'
                          and f.valid_from <= v_today
                          and (f.valid_to is null or f.valid_to >= v_today))));
  end if;

  select * into v_org from organisations where id = p_org;
  if not found then
    raise exception 'no such organisation' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'today', v_today,
    'organisation', to_jsonb(v_org)
                    || jsonb_build_object('depth', cardinality(v_org.path) - 1,
                                          'is_root', v_org.parent_id is null),
    'ancestors', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'slug', a.slug)
                       order by u.ord)
        from unnest(v_org.path) with ordinality as u(id, ord)
        join organisations a on a.id = u.id
       where u.id <> v_org.id), '[]'::jsonb),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'slug', c.slug,
                                          'status', c.status, 'visible', c.visible)
                       order by c.name)
        from organisations c
       where c.parent_id = v_org.id), '[]'::jsonb),
    'affiliations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'direction', case when f.org_id = v_org.id then 'out' else 'in' end,
               'org_id', f.org_id, 'org_name', fo.name,
               'to_org_id', f.to_org_id, 'to_org_name', ft.name,
               'kind', f.kind, 'season_label', f.season_label,
               'season_id', f.season_id, 'season_name', s.name, 'league_name', sl.name,
               'valid_from', f.valid_from, 'valid_to', f.valid_to, 'status', f.status,
               'reference', f.reference, 'accreditation', f.accreditation, 'note', f.note,
               'decided_at', f.decided_at,
               'in_force', f.status = 'active' and f.valid_from <= v_today
                           and (f.valid_to is null or f.valid_to >= v_today))
             order by f.season_label desc, f.kind, fo.name, ft.name)
        from org_affiliations f
        join organisations fo on fo.id = f.org_id
        join organisations ft on ft.id = f.to_org_id
        left join seasons s on s.id = f.season_id
        left join leagues sl on sl.id = s.league_id
       where f.org_id = v_org.id or f.to_org_id = v_org.id), '[]'::jsonb),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name) order by l.name)
        from leagues l
       where l.organiser_id = v_org.id), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name,
                                          'league_id', t.league_id, 'league_name', l.name,
                                          'age_group', t.age_group, 'gender', t.gender)
                       order by l.name, t.name)
        from teams t
        left join leagues l on l.id = t.league_id
       where t.club_id = v_org.id), '[]'::jsonb));
end; $$;

-- ----------------------------------------------------------------------------
-- 6. BUILDING THE TREE
-- ----------------------------------------------------------------------------

/* Create an organisation (no id) or change one (id). A key that is absent is
   left alone; a present key wins (save_access_plan's rule, 0117).

   Where it sits is decided at creation (parent_id) and changed only by
   platform_move_organisation, which checks the whole branch. The slug, when
   not given, comes from the name. status 'merged' names what it merged into,
   in the same tenant, never itself or something below it. settings belong to a
   tenant only, and are checked key by key by the settings trigger. */
create or replace function public.platform_save_organisation(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uuid_re     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_old       public.organisations;
  v_parent    public.organisations;
  v_target    public.organisations;
  v_id        uuid;
  v_txt       text;
  v_parent_id uuid;
  v_kind      text;
  v_name      text;
  v_short     text;
  v_slug      text;
  v_status    text;
  v_merged    uuid;
  v_visible   boolean;
  v_country   text;
  v_nation    text;
  v_tz        text;
  v_web       text;
  v_logo      text;
  v_regno     text;
  v_settings  jsonb;
  v_taken     text;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'an organisation is sent as an object of its fields' using errcode = '22023';
  end if;

  -- ---- which organisation, and where it sits --------------------------------
  v_txt := lower(nullif(btrim(coalesce(p->>'id', '')), ''));
  if v_txt is not null then
    if v_txt !~ uuid_re then
      raise exception 'that organisation id is not an id' using errcode = '22023';
    end if;
    select * into v_old from organisations where id = v_txt::uuid for update;
    if not found then
      raise exception 'no such organisation' using errcode = '22023';
    end if;
    v_id := v_old.id;
    if p ? 'parent_id'
       and lower(nullif(btrim(coalesce(p->>'parent_id', '')), '')) is distinct from v_old.parent_id::text then
      raise exception 'an organisation is moved with platform_move_organisation, which checks the whole branch below it'
        using errcode = '22023';
    end if;
    v_parent_id := v_old.parent_id;
  else
    v_txt := lower(nullif(btrim(coalesce(p->>'parent_id', '')), ''));
    if v_txt is not null then
      if v_txt !~ uuid_re then
        raise exception 'that parent id is not an id' using errcode = '22023';
      end if;
      v_parent_id := v_txt::uuid;
    end if;
  end if;
  if v_parent_id is not null then
    select * into v_parent from organisations where id = v_parent_id;
    if not found then
      raise exception 'no such parent organisation' using errcode = '22023';
    end if;
  end if;

  -- ---- the fields: present keys win, absent keys keep ----------------------
  v_kind := case when p ? 'kind' then lower(nullif(btrim(coalesce(p->>'kind', '')), '')) else v_old.kind end;
  if v_kind is null
     or v_kind not in ('national_body', 'region', 'association', 'club', 'school', 'partner') then
    raise exception 'an organisation is a national_body, region, association, club, school or partner, not "%"',
      coalesce(p->>'kind', '')
      using errcode = '22023';
  end if;
  if not public.org_kind_may_parent(v_kind, v_parent.kind) then
    if v_parent_id is null then
      raise exception 'only a national body or an association stands on its own as a tenant; this % needs the organisation it sits under (parent_id)',
        replace(v_kind, '_', ' ')
        using errcode = '22023';
    end if;
    raise exception 'this % may not sit under "%" (%)', replace(v_kind, '_', ' '),
      v_parent.name, replace(v_parent.kind, '_', ' ')
      using errcode = '22023';
  end if;
  -- a change of kind keeps the setters' rules; the tree trigger holds the same line for other writers
  if v_old.id is not null and v_kind <> v_old.kind then
    if v_kind not in ('national_body', 'region', 'association', 'partner')
       and exists (select 1 from leagues l where l.organiser_id = v_old.id) then
      raise exception '"%" runs a league, which only a national body, region, association or partner does, so it cannot be changed to %; record another organiser for the league first',
        v_old.name, replace(v_kind, '_', ' ')
        using errcode = '22023';
    end if;
    if v_kind not in ('club', 'school')
       and exists (select 1 from teams t where t.club_id = v_old.id) then
      raise exception '"%" has teams, which only a club or a school has, so it cannot be changed to %; unlink them first',
        v_old.name, replace(v_kind, '_', ' ')
        using errcode = '22023';
    end if;
  end if;

  v_name := case when p ? 'name' then btrim(coalesce(p->>'name', '')) else v_old.name end;
  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception 'an organisation needs a name of 2 to 120 characters' using errcode = '22023';
  end if;

  v_short := case when p ? 'short_name' then btrim(coalesce(p->>'short_name', ''))
                  else coalesce(v_old.short_name, '') end;
  if char_length(v_short) > 40 then
    raise exception 'a short name is at most 40 characters' using errcode = '22023';
  end if;

  v_slug := case when p ? 'slug' then lower(nullif(btrim(coalesce(p->>'slug', '')), '')) else v_old.slug end;
  if v_slug is null then
    v_slug := public.org_slug_from(v_name);
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' then
    raise exception 'an address (slug) is 2 to 80 lower-case letters, digits and hyphens, starting with a letter or digit'
      using errcode = '22023';
  end if;
  select o.name into v_taken from organisations o where o.slug = v_slug and o.id is distinct from v_id;
  if found then
    raise exception 'the address "%" is already used by "%"', v_slug, v_taken using errcode = '22023';
  end if;

  v_status := case when p ? 'status' then lower(nullif(btrim(coalesce(p->>'status', '')), ''))
                   else coalesce(v_old.status, 'active') end;
  if v_status is null
     or v_status not in ('pending', 'active', 'suspended', 'lapsed', 'dissolved', 'merged') then
    raise exception 'an organisation is pending, active, suspended, lapsed, dissolved or merged'
      using errcode = '22023';
  end if;

  if v_status = 'merged' then
    if v_old.id is null then
      raise exception 'an organisation is created as it is now; record a merge on the one that already exists'
        using errcode = '22023';
    end if;
    v_txt := case when p ? 'merged_into' then lower(nullif(btrim(coalesce(p->>'merged_into', '')), ''))
                  else v_old.merged_into::text end;
    if v_txt is null or v_txt !~ uuid_re then
      raise exception 'a merged organisation names the one it merged into (merged_into)' using errcode = '22023';
    end if;
    select * into v_target from organisations where id = v_txt::uuid;
    if not found then
      raise exception 'no such organisation to merge into' using errcode = '22023';
    end if;
    if v_old.id = any (v_target.path) then
      raise exception 'an organisation cannot merge into itself or into something below it' using errcode = '22023';
    end if;
    if v_target.tenant_id <> v_old.tenant_id then
      raise exception 'an organisation merges only into one in its own tenant' using errcode = '22023';
    end if;
    if v_target.status in ('dissolved', 'merged') then
      raise exception '"%" is % itself', v_target.name, v_target.status using errcode = '22023';
    end if;
    v_merged := v_target.id;
  else
    if p ? 'merged_into' and nullif(btrim(coalesce(p->>'merged_into', '')), '') is not null then
      raise exception 'only a merged organisation names what it merged into' using errcode = '22023';
    end if;
    v_merged := null;
  end if;

  if p ? 'visible' then
    if jsonb_typeof(p->'visible') <> 'boolean' then
      raise exception 'visible is true or false' using errcode = '22023';
    end if;
    v_visible := (p->>'visible')::boolean;
  else
    v_visible := coalesce(v_old.visible, true);
  end if;

  v_country := case when p ? 'country' then upper(nullif(btrim(coalesce(p->>'country', '')), ''))
                    else coalesce(v_old.country::text, 'GB') end;
  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    raise exception 'a country is a two-letter code, such as GB' using errcode = '22023';
  end if;

  v_nation := case when p ? 'home_nation' then upper(nullif(btrim(coalesce(p->>'home_nation', '')), ''))
                   else v_old.home_nation end;
  if v_nation is not null and v_nation not in ('ENG', 'SCO', 'WAL', 'NIR') then
    raise exception 'a home nation is ENG, SCO, WAL or NIR' using errcode = '22023';
  end if;

  v_tz := coalesce(case when p ? 'time_zone' then nullif(btrim(coalesce(p->>'time_zone', '')), '')
                        else v_old.time_zone end, 'Europe/London');
  begin
    perform now() at time zone v_tz;
  exception when invalid_parameter_value then
    raise exception '"%" is not a time zone Postgres knows; use a name such as Europe/London', v_tz
      using errcode = '22023';
  end;

  v_web := case when p ? 'website' then nullif(btrim(coalesce(p->>'website', '')), '') else v_old.website end;
  if v_web is not null and (v_web !~ '^https://[^[:space:]]+$' or char_length(v_web) > 300) then
    raise exception 'a website is a full https:// address' using errcode = '22023';
  end if;

  v_logo := case when p ? 'logo_path' then nullif(btrim(coalesce(p->>'logo_path', '')), '') else v_old.logo_path end;
  if char_length(v_logo) > 500 then
    raise exception 'a logo path is at most 500 characters' using errcode = '22023';
  end if;

  v_regno := case when p ? 'registered_no' then nullif(btrim(coalesce(p->>'registered_no', '')), '')
                  else v_old.registered_no end;
  if char_length(v_regno) > 40 then
    raise exception 'a registered number is at most 40 characters' using errcode = '22023';
  end if;

  if p ? 'settings' then
    v_settings := coalesce(nullif(p->'settings', 'null'::jsonb), '{}'::jsonb);
    if jsonb_typeof(v_settings) <> 'object' then
      raise exception 'settings are an object of named values' using errcode = '22023';
    end if;
  else
    v_settings := coalesce(v_old.settings, '{}'::jsonb);
  end if;
  if v_parent_id is not null and v_settings <> '{}'::jsonb then
    raise exception 'settings belong to a tenant (the organisation at the top of its tree), not to "%"', v_name
      using errcode = '22023';
  end if;

  -- ---- write ----------------------------------------------------------------
  if v_old.id is null then
    insert into organisations (parent_id, kind, name, short_name, slug, status, merged_into, visible,
                               country, home_nation, time_zone, website, logo_path, registered_no,
                               settings, created_by)
    values (v_parent_id, v_kind, v_name, v_short, v_slug, v_status, v_merged, v_visible,
            v_country, v_nation, v_tz, v_web, v_logo, v_regno, v_settings, auth.uid())
    returning id into v_id;
  else
    update organisations
       set kind = v_kind, name = v_name, short_name = v_short, slug = v_slug, status = v_status,
           merged_into = v_merged, visible = v_visible, country = v_country, home_nation = v_nation,
           time_zone = v_tz, website = v_web, logo_path = v_logo, registered_no = v_regno,
           settings = v_settings
     where id = v_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), case when v_old.id is null then 'org.create' else 'org.update' end,
          'organisation', v_id::text,
          jsonb_build_object('tenant_id', (select o.tenant_id from organisations o where o.id = v_id),
                             'parent_id', v_parent_id, 'kind', v_kind, 'name', v_name, 'slug', v_slug,
                             'status', v_status, 'visible', v_visible,
                             'fields', (select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb)
                                          from jsonb_object_keys(p) as k(key)
                                         where k.key <> 'id')));
  return v_id;
end; $$;

/* Move an organisation, and its whole branch, under another parent in the same
   tenant. The same refusals the tree trigger makes, asked first so the console
   gets a plain answer, and one it makes on its own: nothing leaves or joins a
   tenant here (see the header). */
create or replace function public.platform_move_organisation(p_org uuid, p_parent uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org    public.organisations;
  v_parent public.organisations;
  v_path   uuid[];
  v_below  int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  select * into v_org from organisations where id = p_org for update;
  if not found then
    raise exception 'no such organisation' using errcode = '22023';
  end if;
  if p_parent is not distinct from v_org.parent_id then
    return jsonb_build_object('ok', true, 'moved', false, 'parent_id', v_org.parent_id,
                              'path', to_jsonb(v_org.path), 'descendants', 0);
  end if;
  if p_parent is null or v_org.parent_id is null then
    raise exception '"%" would %: a new data controller for everything in it. That is a procedure of its own (foundations 4.3, open question 11), not a move',
      v_org.name,
      case when p_parent is null then 'become a tenant of its own' else 'stop being a tenant and join another' end
      using errcode = '22023';
  end if;

  select * into v_parent from organisations where id = p_parent;
  if not found then
    raise exception 'no such parent organisation' using errcode = '22023';
  end if;
  if v_parent.tenant_id <> v_org.tenant_id then
    raise exception '"%" is in another tenant, and moving "%" there would change who controls its data (foundations 4.3, open question 11)',
      v_parent.name, v_org.name
      using errcode = '22023';
  end if;
  if p_org = any (v_parent.path) then
    raise exception '"%" cannot move inside itself: "%" is below it', v_org.name, v_parent.name
      using errcode = '22023';
  end if;
  if not public.org_kind_may_parent(v_org.kind, v_parent.kind) then
    raise exception '"%" (%) may not sit under "%" (%)', v_org.name, replace(v_org.kind, '_', ' '),
      v_parent.name, replace(v_parent.kind, '_', ' ')
      using errcode = '22023';
  end if;
  if v_parent.status in ('dissolved', 'merged') then
    raise exception '"%" is % and takes nothing new below it', v_parent.name, v_parent.status
      using errcode = '22023';
  end if;

  select count(*) into v_below from organisations d where d.path @> array[p_org] and d.id <> p_org;

  update organisations set parent_id = p_parent where id = p_org
  returning path into v_path;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'org.move', 'organisation', p_org::text,
          jsonb_build_object('tenant_id', v_org.tenant_id, 'from', v_org.parent_id, 'to', p_parent,
                             'descendants', v_below));

  return jsonb_build_object('ok', true, 'moved', true, 'parent_id', p_parent,
                            'path', to_jsonb(v_path), 'descendants', v_below);
end; $$;

-- ----------------------------------------------------------------------------
-- 7. RECORDING AFFILIATIONS AND ACCREDITATION
--
-- Records the affiliation of one organisation to another for a season, or
-- changes it (by id, or by the same four: organisation, to whom, kind, season —
-- recording the same four again is a change to that record, never a second
-- one). Who, to whom, what and which season never change once recorded.
--
--   * accreditation (Level 1 or 2) sits only on the governing-body affiliation;
--   * a season invite names its season, and nothing else does; it WARNS, not
--     refuses, when that season's league is run by another organisation or by
--     none recorded yet, because an import may arrive before the organiser;
--   * a season is written 2026/27, and the two halves are consecutive years;
--   * valid_from defaults to today (London);
--   * whoever changes the status is recorded as having decided it.
-- ----------------------------------------------------------------------------
create or replace function public.record_affiliation(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uuid_re    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  date_re    constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_today    constant date := (now() at time zone 'Europe/London')::date;
  v_old      public.org_affiliations;
  v_org      public.organisations;
  v_to       public.organisations;
  v_id       uuid;
  v_txt      text;
  v_org_id   uuid;
  v_to_id    uuid;
  v_kind     text;
  v_label    text;
  v_season   uuid;
  v_from     date;
  v_until    date;
  v_status   text;
  v_ref      text;
  v_accred   text;
  v_note     text;
  v_decided  boolean;
  v_created  boolean := false;
  v_warnings text[] := '{}';
  v_s_org    uuid;
  v_s_league text;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'an affiliation is sent as an object of its fields' using errcode = '22023';
  end if;

  -- ---- which record ---------------------------------------------------------
  v_txt := lower(nullif(btrim(coalesce(p->>'id', '')), ''));
  if v_txt is not null then
    if v_txt !~ uuid_re then
      raise exception 'that affiliation id is not an id' using errcode = '22023';
    end if;
    select * into v_old from org_affiliations where id = v_txt::uuid for update;
    if not found then
      raise exception 'no such affiliation' using errcode = '22023';
    end if;
    if (p ? 'org_id' and lower(btrim(coalesce(p->>'org_id', ''))) <> v_old.org_id::text)
       or (p ? 'to_org_id' and lower(btrim(coalesce(p->>'to_org_id', ''))) <> v_old.to_org_id::text)
       or (p ? 'kind' and lower(btrim(coalesce(p->>'kind', ''))) <> v_old.kind)
       or (p ? 'season_label' and btrim(coalesce(p->>'season_label', '')) <> v_old.season_label) then
      raise exception 'an affiliation keeps who, to whom, what and which season it was recorded for; record a new one instead'
        using errcode = '22023';
    end if;
    v_org_id := v_old.org_id;
    v_to_id  := v_old.to_org_id;
    v_kind   := v_old.kind;
    v_label  := v_old.season_label;
  else
    v_txt := lower(nullif(btrim(coalesce(p->>'org_id', '')), ''));
    if v_txt is null or v_txt !~ uuid_re then
      raise exception 'say which organisation is affiliating (org_id)' using errcode = '22023';
    end if;
    v_org_id := v_txt::uuid;
    v_txt := lower(nullif(btrim(coalesce(p->>'to_org_id', '')), ''));
    if v_txt is null or v_txt !~ uuid_re then
      raise exception 'say which organisation it affiliates to (to_org_id)' using errcode = '22023';
    end if;
    v_to_id := v_txt::uuid;
    v_kind  := lower(nullif(btrim(coalesce(p->>'kind', '')), ''));
    v_label := nullif(btrim(coalesce(p->>'season_label', '')), '');

    select * into v_old
      from org_affiliations a
     where a.org_id = v_org_id and a.to_org_id = v_to_id
       and a.kind = v_kind and a.season_label = v_label
       for update;
  end if;

  -- ---- who, to whom, what, when ---------------------------------------------
  if v_kind is null or v_kind not in ('governing_body', 'league_member', 'season_invite') then
    raise exception 'an affiliation is to a governing_body, a league (league_member) or a season_invite'
      using errcode = '22023';
  end if;
  select * into v_org from organisations where id = v_org_id;
  if not found then
    raise exception 'no such organisation' using errcode = '22023';
  end if;
  select * into v_to from organisations where id = v_to_id;
  if not found then
    raise exception 'no such organisation to affiliate to' using errcode = '22023';
  end if;
  if v_org_id = v_to_id then
    raise exception 'an organisation does not affiliate to itself' using errcode = '22023';
  end if;
  if v_org.kind not in ('association', 'club', 'school', 'partner') then
    raise exception '"%" (%) does not affiliate: clubs, schools, associations and partners do',
      v_org.name, replace(v_org.kind, '_', ' ')
      using errcode = '22023';
  end if;
  if v_to.kind not in ('national_body', 'region', 'association') then
    raise exception 'an affiliation is to a national body, a region or an association, not to "%" (%)',
      v_to.name, replace(v_to.kind, '_', ' ')
      using errcode = '22023';
  end if;
  -- two statements: the casts must never be reached (or folded) before the shape is known
  if v_label is null or v_label !~ '^[0-9]{4}/[0-9]{2}$' then
    raise exception 'a season is written as two consecutive years, such as 2026/27, not "%"', coalesce(v_label, '')
      using errcode = '22023';
  end if;
  if right(v_label, 2)::int <> (left(v_label, 4)::int + 1) % 100 then
    raise exception 'a season is written as two consecutive years, such as 2026/27, not "%"', v_label
      using errcode = '22023';
  end if;

  if p ? 'season_id' then
    v_txt := lower(nullif(btrim(coalesce(p->>'season_id', '')), ''));
    if v_txt is not null and v_txt !~ uuid_re then
      raise exception 'that season id is not an id' using errcode = '22023';
    end if;
    v_season := v_txt::uuid;
  else
    v_season := v_old.season_id;
  end if;
  if v_kind = 'season_invite' then
    if v_season is null then
      raise exception 'a season invite names the season it is for (season_id)' using errcode = '22023';
    end if;
    select l.organiser_id, l.name into v_s_org, v_s_league
      from seasons s join leagues l on l.id = s.league_id
     where s.id = v_season;
    if not found then
      raise exception 'no such season' using errcode = '22023';
    end if;
    if v_s_org is null then
      v_warnings := v_warnings ||
        ('No organiser is recorded for ' || v_s_league || ' yet, so nothing says this invite came from "' || v_to.name || '".');
    elsif v_s_org <> v_to_id then
      v_warnings := v_warnings ||
        (v_s_league || ' is run by another organisation, not by "' || v_to.name || '", which this invite is recorded against.');
    end if;
  elsif v_season is not null then
    raise exception 'only a season invite names a season' using errcode = '22023';
  end if;

  if p ? 'valid_from' then
    v_txt := nullif(btrim(coalesce(p->>'valid_from', '')), '');
    if v_txt is null or v_txt !~ date_re then
      raise exception 'valid_from is a date written 2026-09-01' using errcode = '22023';
    end if;
    begin
      v_from := v_txt::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'there is no date %', v_txt using errcode = '22023';
    end;
  else
    v_from := coalesce(v_old.valid_from, v_today);
  end if;

  if p ? 'valid_to' then
    v_txt := nullif(btrim(coalesce(p->>'valid_to', '')), '');
    if v_txt is not null and v_txt !~ date_re then
      raise exception 'valid_to is a date written 2027-08-31, or empty' using errcode = '22023';
    end if;
    begin
      v_until := v_txt::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'there is no date %', v_txt using errcode = '22023';
    end;
  else
    v_until := v_old.valid_to;
  end if;
  if v_until is not null and v_until < v_from then
    raise exception 'an affiliation cannot end (%) before it starts (%)', v_until, v_from using errcode = '22023';
  end if;

  v_status := case when p ? 'status' then lower(nullif(btrim(coalesce(p->>'status', '')), ''))
                   else coalesce(v_old.status, 'pending') end;
  if v_status is null
     or v_status not in ('pending', 'active', 'lapsed', 'suspended', 'refused', 'withdrawn') then
    raise exception 'an affiliation is pending, active, lapsed, suspended, refused or withdrawn' using errcode = '22023';
  end if;

  v_ref := case when p ? 'reference' then nullif(btrim(coalesce(p->>'reference', '')), '') else v_old.reference end;
  if char_length(v_ref) > 40 then
    raise exception 'an affiliation number is at most 40 characters' using errcode = '22023';
  end if;

  v_accred := coalesce(case when p ? 'accreditation' then lower(nullif(btrim(coalesce(p->>'accreditation', '')), ''))
                            else v_old.accreditation end, 'none');
  if v_accred not in ('none', 'level_1', 'level_2') then
    raise exception 'accreditation is none, level_1 or level_2' using errcode = '22023';
  end if;
  if v_accred <> 'none' and v_kind <> 'governing_body' then
    raise exception 'accreditation is recorded on the affiliation to the governing body, not on a league membership or a season invite'
      using errcode = '22023';
  end if;

  v_note := case when p ? 'note' then btrim(coalesce(p->>'note', '')) else coalesce(v_old.note, '') end;
  if char_length(v_note) > 400 then
    raise exception 'a note is at most 400 characters' using errcode = '22023';
  end if;

  if v_status = 'active' and v_until is not null and v_until < v_today then
    v_warnings := v_warnings || 'It is recorded as active, but its dates have already ended, so it is not in force.'::text;
  end if;

  v_decided := case when v_old.id is null then v_status <> 'pending'
                    else v_status is distinct from v_old.status end;

  -- ---- write ----------------------------------------------------------------
  if v_old.id is null then
    insert into org_affiliations (org_id, to_org_id, kind, season_label, season_id, valid_from, valid_to,
                                  status, reference, accreditation, note, decided_by, decided_at)
    values (v_org_id, v_to_id, v_kind, v_label, v_season, v_from, v_until,
            v_status, v_ref, v_accred, v_note,
            case when v_decided then auth.uid() end,
            case when v_decided then now() end)
    returning id into v_id;
    v_created := true;
  else
    v_id := v_old.id;
    update org_affiliations a
       set season_id = v_season, valid_from = v_from, valid_to = v_until, status = v_status,
           reference = v_ref, accreditation = v_accred, note = v_note,
           decided_by = case when not v_decided then a.decided_by
                             when v_status = 'pending' then null else auth.uid() end,
           decided_at = case when not v_decided then a.decided_at
                             when v_status = 'pending' then null else now() end
     where a.id = v_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'org.affiliation', 'org_affiliation', v_id::text,
          jsonb_build_object('created', v_created, 'tenant_id', v_org.tenant_id,
                             'org_id', v_org_id, 'to_org_id', v_to_id, 'kind', v_kind,
                             'season_label', v_label,
                             'status_from', v_old.status, 'status', v_status,
                             'accreditation_from', v_old.accreditation, 'accreditation', v_accred));

  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_created, 'status', v_status,
                            'accreditation', v_accred, 'warnings', to_jsonb(v_warnings));
end; $$;

-- ----------------------------------------------------------------------------
-- 8. HANGING COMPETITIONS ON THE TREE (foundations 3.2)
--
-- These ALTERs take ACCESS EXCLUSIVE on leagues, teams, competitions,
-- competition_teams and external_identities until the migration commits, so
-- they come after everything that does not need them. competition_teams.id has
-- a volatile default and rewrites that (small) table.
--
-- They wait at most five seconds for each lock. An ALTER queued behind a long
-- read holds up every later reader of that table for as long as it waits, so a
-- busy moment fails the push (run it again) instead of stalling public pages.
-- ----------------------------------------------------------------------------
set local lock_timeout = '5s';

alter table public.leagues
  add column if not exists organiser_id uuid references public.organisations on delete restrict;
create index if not exists leagues_organiser on public.leagues (organiser_id) where organiser_id is not null;

alter table public.teams
  add column if not exists club_id   uuid references public.organisations on delete restrict,
  add column if not exists age_group text check (age_group is null or age_group ~ '^(U[0-9]{1,2}|senior|masters|open)$'),
  add column if not exists gender    text check (gender is null or gender in ('men','women','boys','girls','mixed','open'));
create index if not exists teams_club on public.teams (club_id) where club_id is not null;

alter table public.competitions
  add column if not exists age_group text check (age_group is null or age_group ~ '^(U[0-9]{1,2}|senior|masters|open)$'),
  add column if not exists gender    text check (gender is null or gender in ('men','women','boys','girls','mixed','open')),
  add column if not exists level     text check (level is null or char_length(level) <= 40),
  add column if not exists born_from date,
  add column if not exists born_to   date;
do $$ begin
  alter table public.competitions add constraint competitions_born_ck
    check (born_from is null or born_to is null or born_from <= born_to);
exception when duplicate_object then null; end $$;

/* A PlayHQ team id is one season's entry in one division, not a club side, so
   it needs a row of its own to hang an external identity on (foundations 3.2),
   which leaves 0077's one-id-per-entity rule intact. The primary key stays the
   pair every writer upserts on; the id is only a handle. */
alter table public.competition_teams
  add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists competition_teams_id on public.competition_teams (id);

comment on column public.leagues.organiser_id is
  'The organisation that runs this league (null: none recorded, as before). Changed only through '
  'set_league_organiser. See 0119.';
comment on column public.teams.club_id is
  'The club or school this team belongs to (null: none recorded). With age_group and gender, changed '
  'only through set_team_club. See 0119.';
comment on column public.competition_teams.id is
  'A handle for one team''s entry in one competition (a PlayHQ team id attaches here). The primary key '
  'is still (competition_id, team_id).';

/* external_identities (0077) learns the new entity types. The inline check has
   Postgres's generated name; it is found by that name (or, if a database was
   built differently, by what it says) and put back under the same name, wider.

   And a person's or registration's identity keeps the id only. payload is
   "kept verbatim" (0077), and a PlayHQ profile payload carries guardians,
   emergency contacts and disability answers. */
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.external_identities'::regclass
       and con.contype = 'c'
       and (con.conname = 'external_identities_entity_type_check'
            or (pg_get_constraintdef(con.oid) like '%entity_type%'
                and pg_get_constraintdef(con.oid) like '%''venue''%'))
  loop
    execute format('alter table public.external_identities drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.external_identities
  add constraint external_identities_entity_type_check
  check (entity_type in ('player','team','competition','venue','person','organisation','league','season',
                         'competition_team','registration'));
do $$ begin
  alter table public.external_identities add constraint ext_ident_personal_payload_ck
    check (entity_type not in ('person','registration') or payload = '{}'::jsonb);
exception when duplicate_object then null; end $$;

/* THE GUARD (ground rule 5). leagues_write (0001) is FOR ALL for a league's
   admins and teams_write (0028) lets a club's manager PATCH any column of their
   team, so without this a league admin could put their league under any
   organisation, and a manager could attach their team to any club — and from
   0123, when rights inherit down the tree, walk themselves into that
   organisation's inheritance.

   Refused only when a value actually CHANGES (or an insert sets one): a console
   that PATCHes a whole row back unchanged is not trying to move anything.
   Allowed when epinoia.org_rpc is on, which only set_league_organiser,
   set_team_club and adopt_clubs set, around their own UPDATE. It judges every
   writer, the service role and the owner included. Those setters are platform
   administrators' only (they refuse a caller with no auth.uid()), so in this
   slice an import cannot link a club at all; a later slice that gives imports
   that job does it through a definer function of its own that sets the switch
   the same way. The columns it watches are the trigger's arguments, so a later
   slice extends it by naming more. */
create or replace function public.org_links_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_col text;
begin
  if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
    return new;
  end if;
  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;
  foreach v_col in array tg_argv loop
    if (tg_op = 'INSERT' and coalesce(v_new -> v_col, 'null'::jsonb) <> 'null'::jsonb)
       or (tg_op = 'UPDATE' and (v_new -> v_col) is distinct from (v_old -> v_col)) then
      raise exception '%', case tg_table_name
          when 'leagues' then 'a league''s organiser is set through set_league_organiser, not by editing the league row'
          else 'a team''s club, age group and gender are set through set_team_club, not by editing the team row'
        end
        using errcode = '42501';
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists org_links_guard on public.leagues;
create trigger org_links_guard
  before insert or update of organiser_id on public.leagues
  for each row execute function public.org_links_guard('organiser_id');

drop trigger if exists org_links_guard on public.teams;
create trigger org_links_guard
  before insert or update of club_id, age_group, gender on public.teams
  for each row execute function public.org_links_guard('club_id', 'age_group', 'gender');

-- ----------------------------------------------------------------------------
-- 9. THE SETTERS. Platform administrators only until 0123 (competitions.manage
--    in scope for organisers; a club's own officers for its teams).
-- ----------------------------------------------------------------------------

/* Who runs a league: a national body, a region, an association (a local league
   body, or an independent league's organiser) or a partner (AoC Sport runs
   EABL). A club or a school runs none. Null takes the organiser away. */
create or replace function public.set_league_organiser(p_league uuid, p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old uuid;
  v_org public.organisations;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  select l.organiser_id into v_old from leagues l where l.id = p_league for update;
  if not found then
    raise exception 'no such league' using errcode = '22023';
  end if;
  if p_org is not null then
    select * into v_org from organisations where id = p_org;
    if not found then
      raise exception 'no such organisation' using errcode = '22023';
    end if;
    if v_org.kind not in ('national_body', 'region', 'association', 'partner') then
      raise exception 'a league is run by a national body, a region, an association or a partner, not by "%" (%)',
        v_org.name, replace(v_org.kind, '_', ' ')
        using errcode = '22023';
    end if;
    if v_org.status in ('dissolved', 'merged') then
      raise exception '"%" is % and runs nothing new', v_org.name, v_org.status using errcode = '22023';
    end if;
  end if;

  if v_old is not distinct from p_org then
    return jsonb_build_object('ok', true, 'changed', false, 'organiser_id', p_org);
  end if;

  /* On for exactly one statement. Left on, it would let a direct PATCH later
     in the same transaction through the guard. */
  perform set_config('epinoia.org_rpc', 'on', true);
  update leagues set organiser_id = p_org where id = p_league;
  perform set_config('epinoia.org_rpc', 'off', true);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'org.league_organiser', 'league', p_league::text,
          jsonb_build_object('from', v_old, 'to', p_org, 'tenant_id', v_org.tenant_id));

  return jsonb_build_object('ok', true, 'changed', true, 'organiser_id', p_org,
                            'organiser_name', v_org.name);
end; $$;

/* Which club or school a team belongs to, and its age group and gender. All
   three are set together (null clears), which is what the console sends. An age
   group is written U18 whatever case it arrives in; senior, masters and open
   are lower case. A club in the NBL and in a local league is one organisation
   with two teams rows, both carrying the same club, age group and gender
   (foundations 4.2). */
create or replace function public.set_team_club(p_team uuid, p_club uuid, p_age_group text, p_gender text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team   record;
  v_club   public.organisations;
  v_age    text := nullif(btrim(coalesce(p_age_group, '')), '');
  v_gender text := lower(nullif(btrim(coalesce(p_gender, '')), ''));
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  select t.id, t.name, t.league_id, t.club_id, t.age_group, t.gender
    into v_team
    from teams t where t.id = p_team
     for update;
  if not found then
    raise exception 'no such team' using errcode = '22023';
  end if;
  if p_club is not null then
    select * into v_club from organisations where id = p_club;
    if not found then
      raise exception 'no such club' using errcode = '22023';
    end if;
    if v_club.kind not in ('club', 'school') then
      raise exception 'a team belongs to a club or a school, not to "%" (%)', v_club.name, replace(v_club.kind, '_', ' ')
        using errcode = '22023';
    end if;
    if v_club.status in ('dissolved', 'merged') then
      raise exception '"%" is % and takes no teams', v_club.name, v_club.status using errcode = '22023';
    end if;
  end if;

  if v_age ~* '^u[0-9]{1,2}$' then
    v_age := upper(v_age);
  else
    v_age := lower(v_age);
  end if;
  if v_age is not null and v_age !~ '^(U[0-9]{1,2}|senior|masters|open)$' then
    raise exception 'an age group is U and the age (U12, U18), senior, masters or open, not "%"', p_age_group
      using errcode = '22023';
  end if;
  if v_gender is not null and v_gender not in ('men', 'women', 'boys', 'girls', 'mixed', 'open') then
    raise exception 'a team''s gender is men, women, boys, girls, mixed or open, not "%"', p_gender
      using errcode = '22023';
  end if;

  if v_team.club_id is not distinct from p_club
     and v_team.age_group is not distinct from v_age
     and v_team.gender is not distinct from v_gender then
    return jsonb_build_object('ok', true, 'changed', false, 'club_id', p_club,
                              'age_group', v_age, 'gender', v_gender);
  end if;

  perform set_config('epinoia.org_rpc', 'on', true);
  update teams set club_id = p_club, age_group = v_age, gender = v_gender where id = p_team;
  perform set_config('epinoia.org_rpc', 'off', true);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'org.team_club', 'team', p_team::text,
          jsonb_build_object('league_id', v_team.league_id, 'tenant_id', v_club.tenant_id,
                             'club_from', v_team.club_id, 'club', p_club,
                             'age_group_from', v_team.age_group, 'age_group', v_age,
                             'gender_from', v_team.gender, 'gender', v_gender));

  return jsonb_build_object('ok', true, 'changed', true, 'club_id', p_club, 'club_name', v_club.name,
                            'age_group', v_age, 'gender', v_gender);
end; $$;

/* ONE CLUB PER UNLINKED TEAM, PROPOSED FIRST (foundations 8.1). Today a team
   is the club; this turns a league's teams into club organisations under a
   parent a platform admin chooses, and links them.

   Without p_pick it only PROPOSES, and writes nothing: for every team in the
   league with no club, the name, short name and crest it would take, an
   address from the name, and what would happen:
     create    no organisation has that address;
     link      a live club or school already has it (in the parent's tenant,
               when a parent is named): the team joins it;
     conflict  something else has it.

   With p_pick (a list of {team_id, name?, slug?, short_name?}, or bare team
   ids; at most 500) and p_parent (the national body, region or association the
   new clubs sit under) it APPLIES: each picked team either joins the live club
   or school at that address in the parent's tenant or gets a new club there,
   named as picked. A team not in the league, already linked, or whose address
   is taken by anything else is skipped and reported, never guessed at. Two
   picks with the same address make one club with two teams, which is how a
   club's NBL side and its local-league side become one organisation. */
create or replace function public.adopt_clubs(p_league uuid, p_parent uuid default null, p_pick jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uuid_re   constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_parent  public.organisations;
  v_exist   public.organisations;
  v_item    jsonb;
  v_obj     boolean;
  v_txt     text;
  v_team    record;
  v_name    text;
  v_short   text;
  v_slug    text;
  v_club    uuid;
  v_created jsonb := '[]'::jsonb;
  v_linked  jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from leagues l where l.id = p_league) then
    raise exception 'no such league' using errcode = '22023';
  end if;
  if p_parent is not null then
    select * into v_parent from organisations where id = p_parent;
    if not found then
      raise exception 'no such parent organisation' using errcode = '22023';
    end if;
    if v_parent.kind not in ('national_body', 'region', 'association') then
      raise exception 'clubs sit under a national body, a region or an association, not under "%" (%)',
        v_parent.name, replace(v_parent.kind, '_', ' ')
        using errcode = '22023';
    end if;
    if v_parent.status in ('dissolved', 'merged') then
      raise exception '"%" is % and takes nothing new below it', v_parent.name, v_parent.status
        using errcode = '22023';
    end if;
  end if;

  -- ---- propose ---------------------------------------------------------------
  if p_pick is null then
    return jsonb_build_object(
      'ok', true, 'applied', false, 'league_id', p_league, 'parent_id', p_parent,
      'proposals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'team_id', t.id, 'team_name', t.name, 'team_slug', t.slug,
                 'logo_path', t.logo_path,
                 'name', btrim(t.name), 'short_name', left(btrim(t.short_name), 40),
                 'slug', s.slug,
                 'existing', case when o.id is not null then jsonb_build_object(
                                 'id', o.id, 'name', o.name, 'kind', o.kind, 'status', o.status,
                                 'tenant_id', o.tenant_id) end,
                 'action', case
                   when o.id is null then 'create'
                   when o.kind in ('club', 'school') and o.status not in ('dissolved', 'merged')
                        and (p_parent is null or o.tenant_id = v_parent.tenant_id) then 'link'
                   else 'conflict' end)
               order by t.name, t.id)
          from teams t
          cross join lateral (select coalesce(public.org_slug_from(t.name),
                                              'club-' || left(t.id::text, 8)) as slug) s
          left join organisations o on o.slug = s.slug
         where t.league_id = p_league
           and t.club_id is null), '[]'::jsonb));
  end if;

  -- ---- apply -----------------------------------------------------------------
  if p_parent is null then
    raise exception 'say where the new clubs sit: the national body, region or association above them (p_parent)'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_pick) <> 'array' or jsonb_array_length(p_pick) = 0 then
    raise exception 'pick the teams to adopt, as a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pick) > 500 then
    raise exception 'at most 500 teams at a time' using errcode = '22023';
  end if;

  for v_item in select x.v from jsonb_array_elements(p_pick) as x(v) loop
    v_obj := jsonb_typeof(v_item) = 'object';
    v_txt := lower(nullif(btrim(coalesce(case when v_obj then v_item->>'team_id' else v_item #>> '{}' end, '')), ''));
    if v_txt is null or v_txt !~ uuid_re then
      v_skipped := v_skipped || jsonb_build_object('team_id', v_txt, 'reason', 'not_a_team');
      continue;
    end if;

    select t.id, t.name, t.short_name, t.logo_path, t.league_id, t.club_id
      into v_team
      from teams t where t.id = v_txt::uuid
       for update;
    if not found or v_team.league_id is distinct from p_league then
      v_skipped := v_skipped || jsonb_build_object('team_id', v_txt, 'reason', 'not_in_league');
      continue;
    end if;
    if v_team.club_id is not null then
      v_skipped := v_skipped || jsonb_build_object('team_id', v_team.id, 'reason', 'already_linked');
      continue;
    end if;

    v_name := btrim(coalesce(case when v_obj then nullif(btrim(coalesce(v_item->>'name', '')), '') end, v_team.name));
    if char_length(v_name) not between 2 and 120 then
      v_skipped := v_skipped || jsonb_build_object('team_id', v_team.id, 'reason', 'name_length');
      continue;
    end if;
    v_short := left(btrim(coalesce(case when v_obj then v_item->>'short_name' end, v_team.short_name, '')), 40);
    v_slug := coalesce(case when v_obj then lower(nullif(btrim(coalesce(v_item->>'slug', '')), '')) end,
                       public.org_slug_from(v_name),
                       'club-' || left(v_team.id::text, 8));
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' then
      v_skipped := v_skipped || jsonb_build_object('team_id', v_team.id, 'reason', 'bad_slug');
      continue;
    end if;

    select * into v_exist from organisations o where o.slug = v_slug;
    if found then
      if v_exist.kind in ('club', 'school') and v_exist.status not in ('dissolved', 'merged')
         and v_exist.tenant_id = v_parent.tenant_id then
        v_club := v_exist.id;
        v_linked := v_linked || jsonb_build_object('team_id', v_team.id, 'org_id', v_club, 'slug', v_slug);
      else
        v_skipped := v_skipped || jsonb_build_object('team_id', v_team.id, 'reason', 'slug_taken', 'slug', v_slug);
        continue;
      end if;
    else
      insert into organisations (parent_id, kind, name, short_name, slug, logo_path, created_by)
      values (p_parent, 'club', v_name, v_short, v_slug, v_team.logo_path, auth.uid())
      returning id into v_club;
      v_created := v_created || jsonb_build_object('team_id', v_team.id, 'org_id', v_club,
                                                   'slug', v_slug, 'name', v_name);
    end if;

    perform set_config('epinoia.org_rpc', 'on', true);
    update teams set club_id = v_club where id = v_team.id;
    perform set_config('epinoia.org_rpc', 'off', true);
  end loop;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'org.adopt_clubs', 'league', p_league::text,
          jsonb_build_object('parent_id', p_parent, 'tenant_id', v_parent.tenant_id,
                             'created', v_created, 'linked', v_linked, 'skipped', v_skipped));

  return jsonb_build_object('ok', true, 'applied', true, 'league_id', p_league, 'parent_id', p_parent,
                            'created', v_created, 'linked', v_linked, 'skipped', v_skipped);
end; $$;

-- ----------------------------------------------------------------------------
-- 10. GRANTS AND OWNERSHIP
--
-- Postgres grants EXECUTE to PUBLIC on every new function and Supabase adds
-- anon and authenticated by default privileges, so every function here says who
-- may call it, and the self-test reads the result back with
-- has_function_privilege rather than trusting this list.
-- ----------------------------------------------------------------------------

-- arithmetic and the public tree: anybody
revoke all on function public.season_age(date, int, text) from public;
grant execute on function public.season_age(date, int, text) to anon, authenticated, service_role;
revoke all on function public.age_band_born(int, int, text) from public;
grant execute on function public.age_band_born(int, int, text) to anon, authenticated, service_role;
revoke all on function public.org_kind_may_parent(text, text) from public;
grant execute on function public.org_kind_may_parent(text, text) to anon, authenticated, service_role;
revoke all on function public.org_tree(uuid) from public;
grant execute on function public.org_tree(uuid) to anon, authenticated, service_role;

-- plumbing
revoke all on function public.org_slug_from(text) from public, anon, authenticated;
grant execute on function public.org_slug_from(text) to service_role;
revoke all on function public.organisations_tree() from public, anon, authenticated;
revoke all on function public.organisations_tree_descendants() from public, anon, authenticated;
revoke all on function public.organisations_settings_guard() from public, anon, authenticated;
revoke all on function public.org_links_guard() from public, anon, authenticated;
revoke all on function public.org_affiliations_removed() from public, anon, authenticated;

-- signed in; each checks its own rights inside
do $$
declare f text;
begin
  foreach f in array array[
    'organisation_admin(uuid)',
    'platform_save_organisation(jsonb)',
    'platform_move_organisation(uuid,uuid)',
    'record_affiliation(jsonb)',
    'set_league_organiser(uuid,uuid)',
    'set_team_club(uuid,uuid,text,text)',
    'adopt_clubs(uuid,uuid,jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

/* A security definer function runs with its OWNER's rights, and the CLI applies
   migrations through a temporary login role (0115), so every function here is
   pinned to postgres. */
alter function public.org_kind_may_parent(text, text) owner to postgres;
alter function public.organisations_tree() owner to postgres;
alter function public.organisations_tree_descendants() owner to postgres;
alter function public.organisations_settings_guard() owner to postgres;
alter function public.season_age(date, int, text) owner to postgres;
alter function public.age_band_born(int, int, text) owner to postgres;
alter function public.org_slug_from(text) owner to postgres;
alter function public.org_tree(uuid) owner to postgres;
alter function public.organisation_admin(uuid) owner to postgres;
alter function public.platform_save_organisation(jsonb) owner to postgres;
alter function public.platform_move_organisation(uuid, uuid) owner to postgres;
alter function public.record_affiliation(jsonb) owner to postgres;
alter function public.org_links_guard() owner to postgres;
alter function public.org_affiliations_removed() owner to postgres;
alter function public.set_league_organiser(uuid, uuid) owner to postgres;
alter function public.set_team_club(uuid, uuid, text, text) owner to postgres;
alter function public.adopt_clubs(uuid, uuid, jsonb) owner to postgres;

-- ============================================================================
-- SELF-TEST — the tree, the guards and the console's calls, as the roles that
-- will make them (foundations section 9, 0119).
--
-- Always, whatever role runs this file:
--   * the catalogue: who may call what, who owns it, the table privileges, RLS
--     and its one policy, that no other policy or view reads the tree or the
--     restricted schema (ground rule 2), that no foreign key joins two tables
--     that existed before (so no new PostgREST embed path), the widened
--     external_identities check, competition_teams' id, the guards;
--   * the ages: U18 in 2026/27 is 2008-09-01 to 2010-08-31;
--   * as the owner: a three-level tree builds the right paths; a cycle, a region
--     under a club, a club on its own and a cross-tenant parent are refused;
--     moving an association to another region rewrites its clubs' paths (a
--     region itself can only move to another national body, which is another
--     tenant, and refused); a hand-edited path is put back; a dissolved parent
--     takes nothing new, brings nothing below it back to life, and is not
--     dissolved over live children; a kind change may not strand a child, a
--     league the organisation runs or a team that belongs to it; tenant settings
--     are checked key by key; the guards refuse even the owner without the
--     setters' switch; a competition_teams insert without an id gets one; a
--     person identity with a payload is refused;
--   * signed out: the visible organisations read, the hidden one does not,
--     org_tree (with a root and without) leaves it out, and every write and
--     every console call is refused;
--   * a signed-in stranger: the same refusals.
-- With a real account (fresh where this role may create auth.users rows, and
-- otherwise borrowed from profiles that hold no role, inside the same
-- rolled-back block, as 0117 does):
--   * a platform admin builds a tree, moves, links, affiliates and adopts
--     through the RPCs, with every refusal the console can meet (a kind change
--     that strands a league or a team among them), each setter leaves the
--     guard's switch off behind it, only an active, in-force governing-body
--     affiliation reads as affiliated, an address held in another tenant is
--     never linked, and each leaves its audit row;
--   * a league admin PATCHing organiser_id gets 42501, while the same PATCH with
--     the value unchanged (and a rename) succeeds; entering, grouping and
--     withdrawing a team on competition_teams still works; deleting a season
--     still works, and the invite it takes with it leaves an audit row;
--   * a club manager PATCHing club_id, age_group or gender gets 42501, while
--     saving the team with them unchanged succeeds.
-- As the service role, where this role may become it: the ingest's league and
-- team creation and competition_teams upsert, and membership-sync's upsert,
-- still succeed; linking a club by inserting the row does not.
--
-- EVERYTHING HAPPENS INSIDE A BLOCK THAT IS ALWAYS ROLLED BACK (the P0115
-- pattern): rows seeded with the migration's own rights first, roles switched
-- with SET LOCAL ROLE and a forged request.jwt.claims, back to the captured
-- role (never RESET ROLE), and the block ends by raising P0119, which its
-- handler swallows. Refusals are caught by SQLSTATE only, never `others`.
-- Afterwards: the test rows are gone, both switches are off, and the anonymous
-- row counts of leagues and teams match the ones taken at the top of the file.
-- ============================================================================
do $test$
declare
  who          text := current_user || ' (session ' || session_user || ')';
  orig         text := current_user;
  snap         jsonb := nullif(current_setting('epinoia.t119_before', true), '')::jsonb;
  u_padmin     uuid := gen_random_uuid();
  u_ladmin     uuid := gen_random_uuid();
  u_mgr        uuid := gen_random_uuid();
  u_out        uuid := gen_random_uuid();   -- signed in, nothing else, and never needs a row
  half         text := 'fresh test accounts';
  service_half text := 'ran';
  borrowed     uuid[];
  have_users   boolean := true;
  have_service boolean := true;
  o_be   uuid;
  o_r1   uuid;
  o_r2   uuid;
  o_a1   uuid;
  o_c1   uuid;
  o_c2   uuid;
  o_hid  uuid;
  o_ind  uuid;
  o_body uuid;
  o_reg  uuid;
  o_club uuid;
  o_sch  uuid;
  o_new  uuid;
  o_old  uuid;
  o_prt  uuid;
  o_x    uuid;
  lg     uuid;
  lg_feed uuid;
  t1     uuid;
  t2     uuid;
  t3     uuid;
  sn     uuid;
  sn2    uuid;
  cp     uuid;
  ct_id  uuid;
  aff    uuid;
  aff_inv uuid;
  rng    daterange;
  rt     record;
  calls  text[];
  j      jsonb;
  e      jsonb;
  f      text;
  s      text;
  k      int;
  n      bigint;
  v_txt  text;
  v_path uuid[];
  v_acts text[];
  lg_all  bigint;
  tm_all  bigint;
  lg_anon bigint;
  tm_anon bigint;
begin
  if snap is null then
    raise exception '0119: the snapshot taken at the top of this file is missing, so "nothing anonymous changed" cannot be checked';
  end if;

  -- ---- who can reach what, read back from the catalogue ---------------------
  foreach f in array array['season_age(date,integer,text)', 'age_band_born(integer,integer,text)',
                           'org_tree(uuid)', 'org_kind_may_parent(text,text)'] loop
    if not has_function_privilege('anon', 'public.' || f, 'execute')
       or not has_function_privilege('authenticated', 'public.' || f, 'execute')
       or not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0119: % must be callable signed out, signed in and by the service role', f;
    end if;
  end loop;

  foreach f in array array['organisation_admin(uuid)', 'platform_save_organisation(jsonb)',
                           'platform_move_organisation(uuid,uuid)', 'record_affiliation(jsonb)',
                           'set_league_organiser(uuid,uuid)', 'set_team_club(uuid,uuid,text,text)',
                           'adopt_clubs(uuid,uuid,jsonb)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception '0119: % is callable signed out', f;
    end if;
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0119: % is not callable signed in, so the console cannot reach it', f;
    end if;
  end loop;

  foreach f in array array['org_slug_from(text)', 'organisations_tree()', 'organisations_tree_descendants()',
                           'organisations_settings_guard()', 'org_links_guard()', 'org_affiliations_removed()'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute')
       or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0119: % is plumbing, but a browser role can call it', f;
    end if;
  end loop;

  select string_agg(p.oid::regprocedure::text, ', ') into v_txt
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('org_kind_may_parent', 'organisations_tree', 'organisations_tree_descendants',
                       'organisations_settings_guard', 'season_age', 'age_band_born', 'org_slug_from',
                       'org_tree', 'organisation_admin', 'platform_save_organisation',
                       'platform_move_organisation', 'record_affiliation', 'org_links_guard',
                       'set_league_organiser', 'set_team_club', 'adopt_clubs', 'org_affiliations_removed')
     and pg_get_userbyid(p.proowner) <> 'postgres';
  if v_txt is not null then
    raise exception '0119: not owned by postgres, so a definer function would run with the wrong rights: %', v_txt;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('platform_save_organisation', 'platform_move_organisation', 'record_affiliation',
                           'set_league_organiser', 'set_team_club', 'adopt_clubs', 'organisation_admin',
                           'org_tree')
         and p.prosecdef) <> 8 then
    raise exception '0119: every console RPC and org_tree must be security definer';
  end if;

  -- ---- the tables ------------------------------------------------------------
  if not has_table_privilege('anon', 'public.organisations', 'select')
     or not has_table_privilege('authenticated', 'public.organisations', 'select') then
    raise exception '0119: the organisations are not readable signed out and signed in';
  end if;
  foreach f in array array['insert', 'update', 'delete', 'truncate'] loop
    if has_table_privilege('anon', 'public.organisations', f)
       or has_table_privilege('authenticated', 'public.organisations', f) then
      raise exception '0119: a browser role holds % on organisations', f;
    end if;
  end loop;
  foreach f in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
    if has_table_privilege('anon', 'public.org_affiliations', f)
       or has_table_privilege('authenticated', 'public.org_affiliations', f) then
      raise exception '0119: a browser role holds % on org_affiliations', f;
    end if;
  end loop;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.organisations'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.org_affiliations'::regclass) then
    raise exception '0119: row-level security is off on a new table';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'org_affiliations') then
    raise exception '0119: org_affiliations has a policy; it is read only through the RPCs';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'organisations') <> 1
     or not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'organisations'
                       and policyname = 'org_read' and cmd = 'SELECT') then
    raise exception '0119: organisations must have exactly one policy, org_read, for SELECT (no FOR ALL, no write policy)';
  end if;

  -- ---- ground rule 2: the hot path never reads the tree or restricted --------
  select string_agg(format('%s.%s (%s)', p.schemaname, p.tablename, p.policyname), ', ') into v_txt
    from pg_policies p
   where coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
         ~* '\m(organisations|org_affiliations)\M|\mrestricted\.';
  if v_txt is not null then
    raise exception '0119: a table policy reads the organisation tree or the restricted schema, which puts it on the hot path: %', v_txt;
  end if;
  select string_agg(format('%s.%s', v.schemaname, v.viewname), ', ') into v_txt
    from pg_views v
   where v.schemaname = 'public'
     and v.definition ~* '\m(organisations|org_affiliations)\M|\mrestricted\.';
  if v_txt is not null then
    raise exception '0119: a public view reads the organisation tree or the restricted schema: %', v_txt;
  end if;

  -- ---- no new foreign-key path between tables that existed before -----------
  select coalesce(string_agg(x.pair, ',' order by x.pair), '') into v_txt
    from (select distinct a.relname::text || '>' || b.relname::text as pair
            from pg_constraint c
            join pg_class a on a.oid = c.conrelid
            join pg_class b on b.oid = c.confrelid
           where c.contype = 'f'
             and a.relnamespace = 'public'::regnamespace
             and b.relnamespace = 'public'::regnamespace
             and a.relname not in ('organisations', 'org_affiliations')
             and b.relname not in ('organisations', 'org_affiliations')) x;
  if v_txt <> snap->>'fks' then
    raise exception '0119: the foreign keys between existing tables changed, which changes PostgREST''s embeds: before [%] after [%]',
      snap->>'fks', v_txt;
  end if;

  -- ---- the competition layer's catalogue -------------------------------------
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.external_identities'::regclass
                    and c.conname = 'external_identities_entity_type_check'
                    and pg_get_constraintdef(c.oid) like '%competition_team%'
                    and pg_get_constraintdef(c.oid) like '%registration%')
     or (select count(*) from pg_constraint c
          where c.conrelid = 'public.external_identities'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) like '%''venue''%') <> 1
     or not exists (select 1 from pg_constraint c
                     where c.conrelid = 'public.external_identities'::regclass
                       and c.conname = 'ext_ident_personal_payload_ck') then
    raise exception '0119: external_identities does not carry exactly one widened entity_type check and the payload check';
  end if;
  if (select count(*) from pg_constraint c
       where c.conrelid = 'public.external_identities'::regclass and c.contype = 'u') <> 2 then
    raise exception '0119: external_identities no longer has both of 0077''s unique keys';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = 'public.competition_teams'::regclass
                    and a.attname = 'id' and a.attnotnull and not a.attisdropped)
     or not exists (select 1 from pg_index i
                     where i.indexrelid = 'public.competition_teams_id'::regclass and i.indisunique)
     or not exists (select 1 from pg_constraint c
                     where c.conrelid = 'public.competition_teams'::regclass and c.contype = 'p'
                       and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (competition_id, team_id)') then
    raise exception '0119: competition_teams must gain a unique, not-null id and keep (competition_id, team_id) as its key';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.leagues'::regclass
                  and tgname = 'org_links_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.teams'::regclass
                     and tgname = 'org_links_guard' and not tgisinternal) then
    raise exception '0119: org_links_guard is missing from leagues or teams';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.org_affiliations'::regclass
                  and tgname = 'org_affiliations_removed' and not tgisinternal) then
    raise exception '0119: org_affiliations_removed is missing, so a cascaded affiliation would go without a trail';
  end if;

  -- ---- the ages ---------------------------------------------------------------
  rng := public.age_band_born(18, 2026);
  if lower(rng) <> date '2008-09-01' or upper(rng) - 1 <> date '2010-08-31' then
    raise exception '0119: U18 in 2026/27 is %, not 2008-09-01 to 2010-08-31 as Appendix 2 quotes', rng;
  end if;
  if not (date '2008-09-01' <@ rng) or not (date '2010-08-31' <@ rng)
     or date '2008-08-31' <@ rng or date '2010-09-01' <@ rng then
    raise exception '0119: the U18 2026/27 band % has the wrong edges', rng;
  end if;
  if public.season_age(date '2008-09-01', 2026) <> 17
     or public.season_age(date '2008-08-31', 2026) <> 18
     or public.season_age(date '2010-08-31', 2026) <> 16
     or public.season_age(date '2008-02-29', 2026) <> 18 then
    raise exception '0119: season_age does not count the age on 31 August 2026';
  end if;
  if public.season_age(null, 2026) is not null or public.age_band_born(null, 2026) is not null then
    raise exception '0119: an unknown date of birth or band was given an age';
  end if;
  if public.age_band_born(12, 2026, '01-01') <> daterange(date '2014-01-01', date '2016-01-01')
     or public.season_age(date '2014-01-01', 2026, '01-01') <> 11 then
    raise exception '0119: a 1 January cut-off was not honoured';
  end if;
  foreach f in array array['select public.season_age(date ''2010-01-01'', 2026, ''02-30'')',
                           'select public.season_age(date ''2010-01-01'', 2026, ''02-29'')',
                           'select public.season_age(date ''2010-01-01'', 2026, ''9-1'')',
                           'select public.age_band_born(0, 2026)',
                           'select public.age_band_born(18, 2026, ''13-01'')',
                           'select public.age_band_born(18, 9999)'] loop
    begin
      execute f;
      raise exception '0119: % was accepted', f;
    exception when invalid_parameter_value then null;
    end;
  end loop;

  begin
    -- ======================================================= the tree, as the owner
    insert into organisations (kind, name, slug)
      values ('national_body', '0119 Body', 'zz-t119-body') returning id into o_be;
    insert into organisations (parent_id, kind, name, slug)
      values (o_be, 'region', '0119 North', 'zz-t119-north') returning id into o_r1;
    insert into organisations (parent_id, kind, name, slug)
      values (o_be, 'region', '0119 South', 'zz-t119-south') returning id into o_r2;
    insert into organisations (parent_id, kind, name, slug)
      values (o_r1, 'association', '0119 North League', 'zz-t119-north-league') returning id into o_a1;
    insert into organisations (parent_id, kind, name, slug)
      values (o_r1, 'club', '0119 Rovers', 'zz-t119-rovers') returning id into o_c1;
    insert into organisations (parent_id, kind, name, slug)
      values (o_a1, 'club', '0119 Town', 'zz-t119-town') returning id into o_c2;
    insert into organisations (parent_id, kind, name, slug, visible)
      values (o_r1, 'club', '0119 Hidden', 'zz-t119-hidden', false) returning id into o_hid;
    insert into organisations (kind, name, slug)
      values ('association', '0119 Independent', 'zz-t119-independent') returning id into o_ind;

    select o.path into v_path from organisations o where o.id = o_c2;
    if v_path is distinct from array[o_be, o_r1, o_a1, o_c2] then
      raise exception '0119: a club two levels down has the path %, not body > region > association > club', v_path;
    end if;
    if (select o.path from organisations o where o.id = o_be) is distinct from array[o_be]
       or (select o.tenant_id from organisations o where o.id = o_be) <> o_be
       or (select o.tenant_id from organisations o where o.id = o_c2) <> o_be
       or (select o.tenant_id from organisations o where o.id = o_ind) <> o_ind then
      raise exception '0119: a root is not its own tenant, or a club does not carry its root as tenant';
    end if;

    -- a cycle, and an organisation as its own parent
    foreach f in array array[format('update public.organisations set parent_id = %L where id = %L', o_c2, o_a1),
                             format('update public.organisations set parent_id = %L where id = %L', o_c1, o_c1)] loop
      begin
        execute f;
        raise exception '0119: a cycle was stored: %', f;
      exception when check_violation then
        get stacked diagnostics v_txt = message_text;
        if v_txt not like '%inside itself%' then
          raise exception '0119: a cycle was refused, but not as a cycle (%): %', f, v_txt;
        end if;
      end;
    end loop;

    -- a region under a club, and a club standing alone
    begin
      insert into organisations (parent_id, kind, name, slug)
        values (o_c1, 'region', '0119 Bad Region', 'zz-t119-bad-region');
      raise exception '0119: a region was stored under a club';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%may not sit under%' then
        raise exception '0119: a region under a club was refused for the wrong reason: %', v_txt;
      end if;
    end;
    begin
      insert into organisations (kind, name, slug) values ('club', '0119 Bad Club', 'zz-t119-bad-club');
      raise exception '0119: a club was stored as a tenant of its own';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%cannot stand on its own%' then
        raise exception '0119: a club on its own was refused for the wrong reason: %', v_txt;
      end if;
    end;

    -- a cross-tenant parent: a club into another tree, and a tenant into another
    foreach f in array array[format('update public.organisations set parent_id = %L where id = %L', o_ind, o_c1),
                             format('update public.organisations set parent_id = %L where id = %L', o_be, o_ind),
                             format('update public.organisations set parent_id = null where id = %L', o_a1)] loop
      begin
        execute f;
        raise exception '0119: an organisation changed tenant: %', f;
      exception when check_violation then
        get stacked diagnostics v_txt = message_text;
        if v_txt not like '%another tenant%' then
          raise exception '0119: a tenant change was refused for the wrong reason (%): %', f, v_txt;
        end if;
      end;
    end loop;

    -- moving a branch rewrites every path below it
    update organisations set parent_id = o_r2 where id = o_a1;
    if (select o.path from organisations o where o.id = o_a1) is distinct from array[o_be, o_r2, o_a1]
       or (select o.path from organisations o where o.id = o_c2) is distinct from array[o_be, o_r2, o_a1, o_c2] then
      raise exception '0119: moving an association to another region did not rewrite its clubs'' paths: %',
        (select o.path from organisations o where o.id = o_c2);
    end if;
    if coalesce(current_setting('epinoia.org_tree_rewrite', true), '') = 'on' then
      raise exception '0119: the branch rewrite left its switch on';
    end if;
    -- a hand-edited path or tenant is put back
    update organisations set path = array[o_c2], tenant_id = o_c2 where id = o_c2;
    if (select o.path from organisations o where o.id = o_c2) is distinct from array[o_be, o_r2, o_a1, o_c2]
       or (select o.tenant_id from organisations o where o.id = o_c2) <> o_be then
      raise exception '0119: a hand-edited path was kept';
    end if;

    -- dissolved: not over something live, and then nothing new below it
    begin
      update organisations set status = 'dissolved' where id = o_r2;
      raise exception '0119: a region was dissolved with an association still in it';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%still has%' then
        raise exception '0119: dissolving over a live child was refused for the wrong reason: %', v_txt;
      end if;
    end;
    update organisations set parent_id = o_r1 where id = o_a1;
    if (select o.path from organisations o where o.id = o_c2) is distinct from array[o_be, o_r1, o_a1, o_c2] then
      raise exception '0119: moving the association back did not rewrite its club''s path';
    end if;
    -- a club dissolved first does not stop its region being dissolved after it
    insert into organisations (parent_id, kind, name, slug)
      values (o_r2, 'club', '0119 Old Club', 'zz-t119-old-club') returning id into o_old;
    update organisations set status = 'dissolved' where id = o_old;
    update organisations set status = 'dissolved' where id = o_r2;
    begin
      insert into organisations (parent_id, kind, name, slug)
        values (o_r2, 'club', '0119 Late Club', 'zz-t119-late');
      raise exception '0119: a club was put under a dissolved region';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%takes nothing new%' then
        raise exception '0119: a club under a dissolved region was refused for the wrong reason: %', v_txt;
      end if;
    end;
    -- nor does anything already below it come back to life
    foreach s in array array['active', 'pending'] loop
      begin
        update organisations set status = s where id = o_old;
        raise exception '0119: a dissolved club became % again under its dissolved region', s;
      exception when check_violation then
        get stacked diagnostics v_txt = message_text;
        if v_txt not like '%takes nothing new%' then
          raise exception '0119: bringing a club back under a dissolved region was refused for the wrong reason: %', v_txt;
        end if;
      end;
    end loop;
    delete from organisations where id = o_old;   -- the counts below are of the original eight
    -- a kind change that would strand what sits below
    begin
      update organisations set kind = 'club' where id = o_a1;
      raise exception '0119: an association with a club in it became a club';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%may not hold%' then
        raise exception '0119: stranding a club was refused for the wrong reason: %', v_txt;
      end if;
    end;

    -- tenant settings: the named keys, typed, and on a root only
    update organisations
       set settings = '{"minor_age": 18, "own_login_min_age": 13, "publication_consent_age": 16,
                        "age_cutoff": "09-01", "merge_min_fields": 3, "import_special_category": false,
                        "sensitive_fields": ["ethnicity", "disability"],
                        "equality_condition": "explicit_consent", "dpo_contact": "dpo@example.invalid"}'::jsonb
     where id = o_be;
    foreach s in array array['{"minor_age": "18"}', '{"age_cutoff": "02-30"}', '{"age_cutoff": "9-1"}',
                             '{"sensitive_fields": ["shoe_size"]}', '{"sensitive_fields": ["religion", "religion"]}',
                             '{"favourite_colour": "green"}', '{"own_login_min_age": 17, "publication_consent_age": 16}',
                             '{"merge_min_fields": 9}', '{"import_special_category": "yes"}'] loop
      begin
        update organisations set settings = s::jsonb where id = o_be;
        raise exception '0119: the tenant settings % were accepted', s;
      exception when check_violation then null;
      end;
    end loop;
    begin
      update organisations set settings = '{"minor_age": 18}'::jsonb where id = o_r1;
      raise exception '0119: a region was given tenant settings';
    exception when check_violation then null;
    end;

    -- ======================================================= the competition layer
    insert into leagues (slug, name) values ('zz-t119-league', '0119 League') returning id into lg;
    insert into seasons (league_id, name) values (lg, '2026/27') returning id into sn;
    insert into seasons (league_id, name) values (lg, '2027/28') returning id into sn2;
    insert into competitions (season_id, name) values (sn, '0119 Division') returning id into cp;
    insert into teams (league_id, slug, name) values (lg, 'zz-t119-team-a', '0119 Rovers U18 Women') returning id into t1;
    insert into teams (league_id, slug, name) values (lg, 'zz-t119-team-b', '0119 Rangers Seniors') returning id into t2;
    insert into teams (league_id, slug, name) values (lg, 'zz-t119-team-c', '0119 Town Men') returning id into t3;

    -- the guards judge the owner too; only the setters' switch lets a change through
    foreach f in array array[format('update public.leagues set organiser_id = %L where id = %L', o_be, lg),
                             format('insert into public.teams (league_id, slug, name, club_id) values (%L, %L, %L, %L)',
                                    lg, 'zz-t119-team-x', '0119 X', o_c1),
                             format('update public.teams set gender = %L where id = %L', 'women', t1),
                             format('update public.teams set age_group = %L where id = %L', 'U18', t1)] loop
      begin
        execute f;
        raise exception '0119: the guard let a direct change through: %', f;
      exception when insufficient_privilege then null;
      end;
    end loop;
    update leagues set organiser_id = null where id = lg;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception '0119: an unchanged organiser_id was refused';
    end if;
    perform set_config('epinoia.org_rpc', 'on', true);
    update teams set club_id = o_c2, age_group = 'senior', gender = 'men' where id = t3;
    perform set_config('epinoia.org_rpc', 'off', true);

    -- a kind change may not leave a league run by, or a team belonging to, a kind the setters refuse
    insert into organisations (parent_id, kind, name, slug)
      values (o_be, 'partner', '0119 Partner', 'zz-t119-partner') returning id into o_prt;
    perform set_config('epinoia.org_rpc', 'on', true);
    update leagues set organiser_id = o_prt where id = lg;
    update teams set club_id = o_c1 where id = t2;
    perform set_config('epinoia.org_rpc', 'off', true);
    begin
      update organisations set kind = 'club' where id = o_prt;
      raise exception '0119: a partner that runs a league became a club';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%runs a league%' then
        raise exception '0119: a kind change under a league was refused for the wrong reason: %', v_txt;
      end if;
    end;
    begin
      update organisations set kind = 'association' where id = o_c1;
      raise exception '0119: a club with a team became an association';
    exception when check_violation then
      get stacked diagnostics v_txt = message_text;
      if v_txt not like '%has teams%' then
        raise exception '0119: a kind change under a team was refused for the wrong reason: %', v_txt;
      end if;
    end;
    update organisations set kind = 'school' where id = o_c1;   -- a school has teams too
    update organisations set kind = 'club' where id = o_c1;
    perform set_config('epinoia.org_rpc', 'on', true);
    update leagues set organiser_id = null where id = lg;
    update teams set club_id = null where id = t2;
    perform set_config('epinoia.org_rpc', 'off', true);
    delete from organisations where id = o_prt;   -- the counts below are of the original eight

    -- competition_teams: an insert that names no id gets one
    insert into competition_teams (competition_id, team_id) values (cp, t1) returning id into ct_id;
    if ct_id is null then
      raise exception '0119: a competition_teams row inserted without an id has none';
    end if;

    -- external identities: the new kinds, and no personal payload
    insert into external_sources (id, label) values ('__t119', '0119 self-test');
    insert into external_identities (source_id, entity_type, entity_id, external_id)
    values ('__t119', 'person', gen_random_uuid(), 'P-119'),
           ('__t119', 'registration', gen_random_uuid(), 'R-119'),
           ('__t119', 'organisation', o_be, 'O-119'),
           ('__t119', 'league', lg, 'L-119'),
           ('__t119', 'season', sn, 'S-119'),
           ('__t119', 'competition_team', ct_id, 'CT-119');
    foreach f in array array[
      format('insert into public.external_identities (source_id, entity_type, entity_id, external_id, payload) values (%L, %L, %L, %L, %L)',
             '__t119', 'person', gen_random_uuid(), 'P-119b', '{"participantDateOfBirth": "27/04/2015"}'),
      format('insert into public.external_identities (source_id, entity_type, entity_id, external_id, payload) values (%L, %L, %L, %L, %L)',
             '__t119', 'registration', gen_random_uuid(), 'R-119b', '{"emergencyContactMobile": "07700900000"}'),
      format('insert into public.external_identities (source_id, entity_type, entity_id, external_id) values (%L, %L, %L, %L)',
             '__t119', 'widget', gen_random_uuid(), 'W-119')] loop
      begin
        execute f;
        raise exception '0119: external_identities accepted %', f;
      exception when check_violation then null;
      end;
    end loop;

    -- ======================================================= the accounts: fresh, or borrowed
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_padmin, 't119-padmin@example.invalid'),
                     (u_ladmin, 't119-ladmin@example.invalid'),
                     (u_mgr,    't119-mgr@example.invalid')) as x(id, email);
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
               where not exists (select 1 from public.memberships m where m.user_id = p.id)
                 and not exists (select 1 from public.league_writers w where w.user_id = p.id)
                 and not exists (select 1 from public.game_officials go where go.user_id = p.id)
               order by p.created_at
               limit 3) x;
      if coalesce(cardinality(borrowed), 0) = 3 then
        u_padmin := borrowed[1];
        u_ladmin := borrowed[2];
        u_mgr    := borrowed[3];
        have_users := true;
        half := 'three borrowed profiles';
      else
        half := 'NOT RUN: ' || who || ' may not create auth.users rows and only '
                || coalesce(cardinality(borrowed), 0) || ' of 3 clean profiles exist';
      end if;
    end if;

    if have_users then
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_padmin, 'platform_admin', 'platform', null),
             (u_ladmin, 'league_admin',   'league',   lg),
             (u_mgr,    'team_manager',   'team',     t1);
    end if;

    -- every console call, for the refusals below
    calls := array[
      format('select public.platform_save_organisation(%L::jsonb)',
             jsonb_build_object('kind', 'club', 'name', '0119 Nope', 'slug', 'zz-t119-nope', 'parent_id', o_r1)),
      format('select public.platform_move_organisation(%L::uuid, %L::uuid)', o_c2, o_r1),
      format('select public.set_league_organiser(%L::uuid, %L::uuid)', lg, o_be),
      format('select public.set_team_club(%L::uuid, %L::uuid, null, null)', t2, o_c1),
      format('select public.record_affiliation(%L::jsonb)',
             jsonb_build_object('org_id', o_c1, 'to_org_id', o_be, 'kind', 'governing_body',
                                'season_label', '2026/27', 'status', 'active')),
      format('select public.adopt_clubs(%L::uuid, null, null)', lg),
      format('select public.adopt_clubs(%L::uuid, %L::uuid, %L::jsonb)', lg, o_r1, jsonb_build_array(t2)),
      'select public.organisation_admin(null)'];

    -- ========================================================== signed out
    perform set_config('request.jwt.claims', '', true);
    set local role anon;

    select count(*) into n from organisations o where o.slug like 'zz-t119-%';
    if n <> 7 then
      raise exception '0119: signed out, % of the self-test''s organisations are readable; the seven visible ones should be, and the hidden one not', n;
    end if;
    if exists (select 1 from organisations o where o.id = o_hid) then
      raise exception '0119: ANON CAN READ A HIDDEN ORGANISATION';
    end if;
    j := public.org_tree(o_be);
    if jsonb_array_length(j) <> 6
       or exists (select 1 from jsonb_array_elements(j) x where x->>'id' = o_hid::text) then
      raise exception '0119: org_tree for the test body answered %; it should list its six visible organisations', j;
    end if;
    if (j->0->>'id') <> o_be::text then
      raise exception '0119: org_tree did not put the root first';
    end if;
    j := public.org_tree();
    if exists (select 1 from jsonb_array_elements(j) x where x->>'id' = o_hid::text) then
      raise exception '0119: ANON SEES A HIDDEN ORGANISATION IN org_tree() WITHOUT A ROOT';
    end if;
    if (select count(*) from jsonb_array_elements(j) x where x->>'id' in (o_be::text, o_ind::text, o_c2::text)) <> 3 then
      raise exception '0119: org_tree() without a root left out a visible organisation';
    end if;
    if public.season_age(date '2008-09-01', 2026) <> 17 then
      raise exception '0119: season_age is not callable signed out';
    end if;
    foreach f in array array[
      'insert into public.organisations (kind, name, slug) values (''national_body'', ''0119 Anon'', ''zz-t119-anon'')',
      format('update public.organisations set name = %L where id = %L', '0119 Hijacked', o_be),
      format('delete from public.organisations where id = %L', o_c1),
      'select 1 from public.org_affiliations limit 1',
      format('insert into public.org_affiliations (org_id, to_org_id, kind, season_label, valid_from) values (%L, %L, %L, %L, current_date)',
             o_c1, o_be, 'governing_body', '2026/27')] || calls loop
      begin
        execute f;
        raise exception '0119: signed out, this ran: %', f;
      exception when insufficient_privilege then null;
      end;
    end loop;

    execute format('set local role %I', orig);

    -- ========================================================== a signed-in stranger
    perform set_config('request.jwt.claims',
      json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into n from organisations o where o.slug like 'zz-t119-%';
    if n <> 7 then
      raise exception '0119: a signed-in stranger reads % of the self-test''s organisations, not the seven visible ones', n;
    end if;
    foreach f in array array[
      'insert into public.organisations (kind, name, slug) values (''national_body'', ''0119 Stranger'', ''zz-t119-stranger'')',
      format('update public.organisations set visible = true where id = %L', o_hid),
      'select 1 from public.org_affiliations limit 1'] || calls loop
      begin
        execute f;
        raise exception '0119: a signed-in stranger ran: %', f;
      exception when insufficient_privilege then null;
      end;
    end loop;

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
      -- the feed ingest creating a league, a team and an entry, as it does today
      insert into leagues (slug, name) values ('zz-t119-feed', '0119 Feed League') returning id into lg_feed;
      insert into teams (league_id, slug, name) values (lg_feed, 'zz-t119-feed-team', '0119 Feed Team');
      for k in 1..2 loop
        insert into competition_teams (competition_id, team_id) values (cp, t2)
        on conflict (competition_id, team_id)
        do update set competition_id = excluded.competition_id, team_id = excluded.team_id;
      end loop;
      -- membership-sync's upsert, twice
      for k in 1..2 loop
        insert into external_identities (source_id, entity_type, entity_id, external_id, payload, synced_at)
        values ('__t119', 'player', t1, 'M-119', jsonb_build_object('run', k), now())
        on conflict (source_id, entity_type, external_id)
        do update set entity_id = excluded.entity_id, payload = excluded.payload, synced_at = excluded.synced_at;
      end loop;
      -- and it links a club only through the setters, like everybody else
      begin
        insert into teams (league_id, slug, name, club_id)
          values (lg_feed, 'zz-t119-feed-club', '0119 Feed Club', o_c1);
        raise exception '0119: the service role linked a team to a club by inserting the row';
      exception when insufficient_privilege then null;
      end;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
    end if;

    if have_users then
      -- ======================================================== the platform admin
      perform set_config('request.jwt.claims',
        json_build_object('sub', u_padmin, 'role', 'authenticated')::text, true);
      set local role authenticated;

      -- a tree through the console's calls
      o_body := public.platform_save_organisation(jsonb_build_object(
        'kind', 'national_body', 'name', '0119 Console Body', 'slug', 'zz-t119-console-body',
        'home_nation', 'eng', 'settings', jsonb_build_object('age_cutoff', '09-01')));
      o_reg := public.platform_save_organisation(jsonb_build_object(
        'kind', 'region', 'name', '0119 Console Region', 'parent_id', o_body));
      o_club := public.platform_save_organisation(jsonb_build_object(
        'kind', 'club', 'name', '0119 Côte Śląsk Łódź Ústí Žilina', 'short_name', 'CÔTE', 'parent_id', o_reg,
        'website', 'https://example.invalid'));
      o_sch := public.platform_save_organisation(jsonb_build_object(
        'kind', 'school', 'name', '0119 School', 'slug', 'zz-t119-school', 'parent_id', o_reg));

      select o.slug, o.home_nation, o.path, o.tenant_id into rt from organisations o where o.id = o_reg;
      if rt.slug <> '0119-console-region' then
        raise exception '0119: the address was not made from the name: %', rt.slug;
      end if;
      if rt.path is distinct from array[o_body, o_reg] or rt.tenant_id <> o_body then
        raise exception '0119: a region saved through the console has path % and tenant %', rt.path, rt.tenant_id;
      end if;
      if (select o.slug from organisations o where o.id = o_club) <> '0119-cote-slask-lodz-usti-zilina'
         or (select o.home_nation from organisations o where o.id = o_body) <> 'ENG' then
        raise exception '0119: the diacritics were not folded out of the address (%), or the home nation was not upper-cased',
          (select o.slug from organisations o where o.id = o_club);
      end if;

      -- a change: present keys win, absent keys keep
      perform public.platform_save_organisation(jsonb_build_object('id', o_club, 'name', '0119 Coast Club', 'visible', false));
      select o.name, o.visible, o.website, o.short_name into rt from organisations o where o.id = o_club;
      if rt.name <> '0119 Coast Club' or rt.visible or rt.website <> 'https://example.invalid' or rt.short_name <> 'CÔTE' then
        raise exception '0119: saving two fields changed others, or not those two: %', rt;
      end if;

      -- every refusal the console can meet, each with a plain reason
      foreach f in array array[
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('kind', 'galaxy', 'name', '0119 Nope', 'parent_id', o_reg)),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('kind', 'club', 'name', '0119 Nope', 'slug', 'zz-t119-console-body', 'parent_id', o_reg)),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('kind', 'club', 'name', '0119 Nope')),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('kind', 'region', 'name', '0119 Nope', 'parent_id', o_club)),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('kind', 'club', 'name', 'X', 'parent_id', o_reg)),
        format('select public.platform_save_organisation(%L::jsonb)', jsonb_build_object('id', o_club, 'parent_id', o_be)),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('id', o_club, 'settings', jsonb_build_object('minor_age', 18))),
        format('select public.platform_save_organisation(%L::jsonb)', jsonb_build_object('id', o_club, 'website', 'http://example.invalid')),
        format('select public.platform_save_organisation(%L::jsonb)', jsonb_build_object('id', o_club, 'time_zone', 'Mars/Olympus_Mons')),
        format('select public.platform_save_organisation(%L::jsonb)', jsonb_build_object('id', o_club, 'status', 'merged')),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('id', o_reg, 'status', 'merged', 'merged_into', o_club)),
        format('select public.platform_save_organisation(%L::jsonb)',
               jsonb_build_object('id', o_club, 'status', 'merged', 'merged_into', o_c1)),
        format('select public.platform_save_organisation(%L::jsonb)', jsonb_build_object('id', o_club, 'visible', 'no')),
        format('select public.platform_move_organisation(%L::uuid, %L::uuid)', o_club, o_ind),
        format('select public.platform_move_organisation(%L::uuid, null)', o_club),
        format('select public.platform_move_organisation(%L::uuid, %L::uuid)', o_body, o_be),
        format('select public.platform_move_organisation(%L::uuid, %L::uuid)', o_reg, o_club),
        format('select public.platform_move_organisation(%L::uuid, %L::uuid)', o_reg, o_sch),
        format('select public.set_league_organiser(%L::uuid, %L::uuid)', lg, o_club),
        format('select public.set_league_organiser(%L::uuid, %L::uuid)', lg, o_r2),
        format('select public.set_league_organiser(%L::uuid, %L::uuid)', gen_random_uuid(), o_be),
        format('select public.set_team_club(%L::uuid, %L::uuid, null, null)', t2, o_reg),
        format('select public.set_team_club(%L::uuid, %L::uuid, %L, null)', t2, o_club, 'under 18'),
        format('select public.set_team_club(%L::uuid, %L::uuid, null, %L)', t2, o_club, 'ladies'),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_club, 'to_org_id', o_body, 'kind', 'league_member',
                                  'season_label', '2026/27', 'accreditation', 'level_2')),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_club, 'to_org_id', o_body, 'kind', 'governing_body', 'season_label', '2026/28')),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_club, 'to_org_id', o_body, 'kind', 'season_invite', 'season_label', '2026/27')),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_club, 'to_org_id', o_body, 'kind', 'governing_body',
                                  'season_label', '2026/27', 'season_id', sn)),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_body, 'to_org_id', o_club, 'kind', 'governing_body', 'season_label', '2026/27')),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_club, 'to_org_id', o_body, 'kind', 'governing_body',
                                  'season_label', '2026/27', 'valid_from', '2026-09-01', 'valid_to', '2026-08-01')),
        format('select public.record_affiliation(%L::jsonb)',
               jsonb_build_object('org_id', o_club, 'to_org_id', o_body, 'kind', 'governing_body',
                                  'season_label', '2026/27', 'valid_from', '2026-02-30')),
        format('select public.adopt_clubs(%L::uuid, null, %L::jsonb)', lg, '[]'),
        format('select public.adopt_clubs(%L::uuid, %L::uuid, %L::jsonb)', lg, o_club, jsonb_build_array(t2)),
        format('select public.adopt_clubs(%L::uuid, %L::uuid, %L::jsonb)', lg, o_r1, '[]'),
        format('select public.organisation_admin(%L::uuid)', gen_random_uuid())] loop
        begin
          execute f;
          raise exception '0119: the platform admin was allowed: %', f;
        exception when invalid_parameter_value then null;
        end;
      end loop;

      -- a move inside the tenant, and the same parent again is no move
      j := public.platform_move_organisation(o_sch, o_body);
      if not (j->>'moved')::boolean
         or (select o.path from organisations o where o.id = o_sch) is distinct from array[o_body, o_sch] then
        raise exception '0119: moving a school up to its national body answered %', j;
      end if;
      j := public.platform_move_organisation(o_c2, o_r1);   -- a club out of its association, up to the region
      if not (j->>'moved')::boolean
         or (select o.path from organisations o where o.id = o_c2) is distinct from array[o_be, o_r1, o_c2] then
        raise exception '0119: moving a club from its association to the region answered %', j;
      end if;
      j := public.platform_move_organisation(o_c2, o_a1);
      j := public.platform_move_organisation(o_a1, o_r1);
      if (j->>'moved')::boolean then
        raise exception '0119: moving an organisation to the parent it already has was a move';
      end if;

      -- who runs the league. Every setter must switch the guard off again behind
      -- itself, or a direct PATCH later in the same transaction would get through.
      j := public.set_league_organiser(lg, o_be);
      if not (j->>'changed')::boolean
         or (select l.organiser_id from leagues l where l.id = lg) is distinct from o_be then
        raise exception '0119: set_league_organiser answered % and did not set the organiser', j;
      end if;
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: set_league_organiser left epinoia.org_rpc switched on';
      end if;
      j := public.set_league_organiser(lg, o_be);
      if (j->>'changed')::boolean then
        raise exception '0119: setting the same organiser again was a change';
      end if;

      -- a partner running the league cannot be turned into a club from the console
      o_prt := public.platform_save_organisation(jsonb_build_object(
        'kind', 'partner', 'name', '0119 Console Partner', 'slug', 'zz-t119-console-partner', 'parent_id', o_body));
      j := public.set_league_organiser(lg, o_prt);
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: set_league_organiser left epinoia.org_rpc switched on';
      end if;
      begin
        perform public.platform_save_organisation(jsonb_build_object('id', o_prt, 'kind', 'club'));
        raise exception '0119: the console turned a partner that runs a league into a club';
      exception when invalid_parameter_value then
        get stacked diagnostics v_txt = message_text;
        if v_txt not like '%runs a league%' then
          raise exception '0119: the console refused a kind change under a league for the wrong reason: %', v_txt;
        end if;
      end;
      j := public.set_league_organiser(lg, o_be);
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: set_league_organiser left epinoia.org_rpc switched on';
      end if;

      -- which club a team belongs to, normalised
      j := public.set_team_club(t1, o_c1, 'u18', ' Women ');
      select t.club_id, t.age_group, t.gender into rt from teams t where t.id = t1;
      if rt.club_id is distinct from o_c1 or rt.age_group <> 'U18' or rt.gender <> 'women' then
        raise exception '0119: set_team_club stored %', rt;
      end if;
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: set_team_club left epinoia.org_rpc switched on';
      end if;
      begin
        perform public.platform_save_organisation(jsonb_build_object('id', o_c1, 'kind', 'association'));
        raise exception '0119: the console turned a club with a team into an association';
      exception when invalid_parameter_value then
        get stacked diagnostics v_txt = message_text;
        if v_txt not like '%has teams%' then
          raise exception '0119: the console refused a kind change under a team for the wrong reason: %', v_txt;
        end if;
      end;
      j := public.set_team_club(t2, o_sch, 'U16', 'mixed');
      if (select t.club_id from teams t where t.id = t2) is distinct from o_sch then
        raise exception '0119: a school could not field a team';
      end if;
      j := public.set_team_club(t2, null, null, null);
      if (select t.club_id from teams t where t.id = t2) is not null then
        raise exception '0119: a team could not be unlinked';
      end if;
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: set_team_club left epinoia.org_rpc switched on';
      end if;

      -- affiliations and accreditation
      j := public.record_affiliation(jsonb_build_object(
        'org_id', o_c1, 'to_org_id', o_be, 'kind', 'governing_body', 'season_label', '2026/27',
        'valid_from', ((now() at time zone 'Europe/London')::date - 30)::text,
        'status', 'active', 'accreditation', 'level_1', 'reference', 'BE-119'));
      aff := (j->>'id')::uuid;
      if aff is null or not (j->>'created')::boolean then
        raise exception '0119: recording an affiliation answered %', j;
      end if;
      j := public.record_affiliation(jsonb_build_object(
        'org_id', o_c1, 'to_org_id', o_be, 'kind', 'governing_body', 'season_label', '2026/27',
        'accreditation', 'level_2'));
      if (j->>'created')::boolean or (j->>'id')::uuid is distinct from aff
         or j->>'accreditation' <> 'level_2' or j->>'status' <> 'active' then
        raise exception '0119: recording the same affiliation again did not change that record: %', j;
      end if;
      perform public.record_affiliation(jsonb_build_object(
        'org_id', o_c1, 'to_org_id', o_a1, 'kind', 'league_member', 'season_label', '2026/27', 'status', 'active'));
      j := public.record_affiliation(jsonb_build_object(
        'org_id', o_c1, 'to_org_id', o_ind, 'kind', 'season_invite', 'season_label', '2026/27', 'season_id', sn));
      if jsonb_array_length(j->'warnings') = 0 then
        raise exception '0119: a season invite against an organisation that does not run that league came with no warning';
      end if;
      j := public.record_affiliation(jsonb_build_object(
        'org_id', o_c2, 'to_org_id', o_be, 'kind', 'season_invite', 'season_label', '2027/28',
        'season_id', sn2, 'status', 'active'));
      aff_inv := (j->>'id')::uuid;
      if aff_inv is null or jsonb_array_length(j->'warnings') <> 0 then
        raise exception '0119: a season invite from the league''s own organiser answered %', j;
      end if;
      -- governing-body records that are not in force: one still pending, one active whose dates have ended
      perform public.record_affiliation(jsonb_build_object(
        'org_id', o_c2, 'to_org_id', o_be, 'kind', 'governing_body', 'season_label', '2026/27',
        'status', 'pending', 'accreditation', 'level_1'));
      j := public.record_affiliation(jsonb_build_object(
        'org_id', o_c2, 'to_org_id', o_be, 'kind', 'governing_body', 'season_label', '2025/26',
        'status', 'active', 'accreditation', 'level_2',
        'valid_from', ((now() at time zone 'Europe/London')::date - 400)::text,
        'valid_to', ((now() at time zone 'Europe/London')::date - 1)::text));
      if jsonb_array_length(j->'warnings') = 0 then
        raise exception '0119: an active affiliation whose dates have ended came with no warning';
      end if;
      begin
        perform public.record_affiliation(jsonb_build_object('id', aff, 'kind', 'league_member'));
        raise exception '0119: an affiliation''s kind was changed after it was recorded';
      exception when invalid_parameter_value then null;
      end;

      -- what the public sees of it
      j := public.org_tree(o_be);
      select x into e from jsonb_array_elements(j) x where x->>'id' = o_c1::text;
      if e is null or not (e->>'affiliated')::boolean or e->>'accreditation' <> 'level_2'
         or e ? 'reference' or e ? 'note' then
        raise exception '0119: org_tree shows the affiliated club as %', e;
      end if;
      select x into e from jsonb_array_elements(j) x where x->>'id' = o_c2::text;
      if e is null or (e->>'affiliated')::boolean or e->>'accreditation' <> 'none' then
        raise exception '0119: a club whose only governing-body records are pending or ended reads as %', e;
      end if;

      -- the staff view
      j := public.organisation_admin(null);
      if not (j ? 'organisations' and j ? 'leagues' and j ? 'counts')
         or not exists (select 1 from jsonb_array_elements(j->'organisations') x where x->>'id' = o_hid::text) then
        raise exception '0119: organisation_admin() does not list everything, hidden organisations included';
      end if;
      if not exists (select 1 from jsonb_array_elements(j->'organisations') x
                      where x->>'id' = o_c1::text and (x->>'affiliated')::boolean and x->>'accreditation' = 'level_2')
         or not exists (select 1 from jsonb_array_elements(j->'organisations') x
                         where x->>'id' = o_c2::text and not (x->>'affiliated')::boolean and x->>'accreditation' = 'none') then
        raise exception '0119: organisation_admin() shows affiliation differently from org_tree for the in-force and not-in-force clubs';
      end if;
      j := public.organisation_admin(o_c1);
      if jsonb_array_length(j->'teams') <> 1 or j->'teams'->0->>'id' <> t1::text
         or jsonb_array_length(j->'ancestors') <> 2
         or jsonb_array_length(j->'affiliations') <> 3 then
        raise exception '0119: organisation_admin(club) answered %', j;
      end if;
      select x into e from jsonb_array_elements(j->'affiliations') x where x->>'id' = aff::text;
      if e is null or e->>'decided_at' is null or not (e->>'in_force')::boolean or e->>'reference' <> 'BE-119' then
        raise exception '0119: the staff view of the affiliation is %', e;
      end if;
      j := public.organisation_admin(o_be);
      if jsonb_array_length(j->'leagues') <> 1 or jsonb_array_length(j->'children') <> 2 then
        raise exception '0119: organisation_admin(body) answered %', j;
      end if;

      -- adopting a league's teams as clubs: proposing writes nothing
      select count(*) into n from organisations;
      j := public.adopt_clubs(lg, null, null);
      if (select count(*) from organisations) <> n then
        raise exception '0119: proposing clubs wrote organisations';
      end if;
      if jsonb_array_length(j->'proposals') <> 1 or j->'proposals'->0->>'team_id' <> t2::text
         or j->'proposals'->0->>'action' <> 'create' then
        raise exception '0119: adopt_clubs proposed %; only the one unlinked team', j->'proposals';
      end if;
      j := public.adopt_clubs(lg, o_r1, jsonb_build_array(
             jsonb_build_object('team_id', t2, 'name', '0119 Rangers', 'slug', 'zz-t119-rangers'),
             jsonb_build_object('team_id', t1),
             to_jsonb('not-a-team'::text)));
      if jsonb_array_length(j->'created') <> 1 or jsonb_array_length(j->'skipped') <> 2 then
        raise exception '0119: adopt_clubs applied as %', j;
      end if;
      o_new := (j->'created'->0->>'org_id')::uuid;
      select o.parent_id, o.kind, o.name, o.slug into rt from organisations o where o.id = o_new;
      if rt.parent_id is distinct from o_r1 or rt.kind <> 'club' or rt.name <> '0119 Rangers'
         or (select t.club_id from teams t where t.id = t2) is distinct from o_new then
        raise exception '0119: the adopted club is % and the team points at %', rt,
          (select t.club_id from teams t where t.id = t2);
      end if;
      -- a second team at the same address joins that club rather than making another
      j := public.set_team_club(t2, null, null, null);
      j := public.adopt_clubs(lg, o_r1, jsonb_build_array(jsonb_build_object('team_id', t2, 'slug', 'zz-t119-rangers')));
      if jsonb_array_length(j->'linked') <> 1 or jsonb_array_length(j->'created') <> 0
         or (select t.club_id from teams t where t.id = t2) is distinct from o_new then
        raise exception '0119: a team adopted at an existing club''s address answered %', j;
      end if;
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: adopt_clubs left epinoia.org_rpc switched on';
      end if;
      -- an address a club holds in ANOTHER tenant is a conflict, never a link
      j := public.set_team_club(t2, null, null, null);
      o_x := public.platform_save_organisation(jsonb_build_object(
        'kind', 'club', 'name', '0119 Rangers Seniors', 'parent_id', o_ind));
      if (select o.slug from organisations o where o.id = o_x) <> '0119-rangers-seniors' then
        raise exception '0119: the independent club did not take the address the team''s name makes';
      end if;
      j := public.adopt_clubs(lg, o_r1, null);
      select x into e from jsonb_array_elements(j->'proposals') x where x->>'team_id' = t2::text;
      if e is null or e->>'slug' <> '0119-rangers-seniors' or e->>'action' <> 'conflict' then
        raise exception '0119: a team whose address is held in another tenant was proposed as %', e;
      end if;
      j := public.adopt_clubs(lg, o_r1, jsonb_build_array(t2));
      if jsonb_array_length(j->'linked') <> 0 or jsonb_array_length(j->'created') <> 0
         or jsonb_array_length(j->'skipped') <> 1 or j->'skipped'->0->>'reason' <> 'slug_taken'
         or (select t.club_id from teams t where t.id = t2) is not null then
        raise exception '0119: adopting a team at an address held in another tenant answered %', j;
      end if;

      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      -- every one of those left its trail
      select array_agg(distinct a.action order by a.action) into v_acts
        from audit_log a
       where a.actor = u_padmin and a.action like 'org.%';
      if v_acts is null
         or not v_acts @> array['org.adopt_clubs', 'org.affiliation', 'org.create', 'org.league_organiser',
                                'org.move', 'org.team_club', 'org.update'] then
        raise exception '0119: the organisation audit trail holds only %', v_acts;
      end if;
      if (select f2.decided_by from org_affiliations f2 where f2.id = aff) is distinct from u_padmin then
        raise exception '0119: the affiliation does not record who decided it';
      end if;
      if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on' then
        raise exception '0119: a setter left epinoia.org_rpc switched on';
      end if;

      -- ======================================================== the league admin
      perform set_config('request.jwt.claims',
        json_build_object('sub', u_ladmin, 'role', 'authenticated')::text, true);
      set local role authenticated;

      foreach f in array array[format('update public.leagues set organiser_id = null where id = %L', lg),
                               format('update public.leagues set organiser_id = %L where id = %L', o_ind, lg)] loop
        begin
          execute f;
          raise exception '0119: a league admin moved their league between organisers by PATCHing the row: %', f;
        exception when insufficient_privilege then null;
        end;
      end loop;
      update leagues set organiser_id = o_be, name = '0119 League Renamed' where id = lg;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0119: a league admin could not rename their league with its organiser unchanged (% rows)', n;
      end if;
      -- entering, grouping and withdrawing a team (adm/admin.js, formats-ui.js)
      ct_id := null;
      insert into competition_teams (competition_id, team_id) values (cp, t3) returning id into ct_id;
      if ct_id is null then
        raise exception '0119: a league admin''s entry into a competition came back without an id';
      end if;
      update competition_teams set group_name = 'A' where competition_id = cp and team_id = t3;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0119: a league admin could not save a team''s group';
      end if;
      delete from competition_teams where competition_id = cp and team_id = t3;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0119: a league admin could not withdraw a team';
      end if;
      -- deleting a season of their own still works, with an invite recorded against it
      delete from seasons where id = sn2;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0119: a league admin could not delete a season that holds a club''s invite';
      end if;
      -- and the platform's calls stay the platform's
      foreach f in array calls loop
        begin
          execute f;
          raise exception '0119: a league admin ran a platform call: %', f;
        exception when insufficient_privilege then null;
        end;
      end loop;

      execute format('set local role %I', orig);

      -- the invite went with its season (foundations 3.1), and left its trail
      if exists (select 1 from org_affiliations f2 where f2.id = aff_inv) then
        raise exception '0119: an invite outlived the season it names';
      end if;
      if not exists (select 1 from audit_log a
                      where a.action = 'org.affiliation_removed' and a.subject = 'org_affiliation'
                        and a.subject_id = aff_inv::text and a.actor = u_ladmin
                        and a.detail->>'season_id' = sn2::text and a.detail->>'kind' = 'season_invite') then
        raise exception '0119: a season''s invite went with it and left no audit row naming who deleted it';
      end if;

      -- ======================================================== the club manager
      perform set_config('request.jwt.claims',
        json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
      set local role authenticated;

      foreach f in array array['club_id = null', 'age_group = ''U16''', 'gender = ''men''',
                               'club_id = ' || quote_literal(o_c2)] loop
        begin
          execute format('update public.teams set %s where id = %L', f, t1);
          raise exception '0119: a club manager changed % on their own team by PATCHing the row', f;
        exception when insufficient_privilege then null;
        end;
      end loop;
      update teams
         set club_id = o_c1, age_group = 'U18', gender = 'women', name = '0119 Rovers Women'
       where id = t1;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0119: a club manager could not save their team with its club, age group and gender unchanged (% rows)', n;
      end if;

      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
      half := half || ' (every setter left the switch off, only in-force affiliations read as affiliated, '
                   || 'an address in another tenant was not adopted, a kind change under a league or a team was refused, '
                   || 'a league admin''s season delete audited the invite it took)';
    end if;

    raise exception using errcode = 'P0119', message = '0119 passed; rolling its test rows back';
  exception
    when sqlstate 'P0119' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  -- ---- afterwards ---------------------------------------------------------------
  if exists (select 1 from organisations o where o.slug like 'zz-t119-%' or o.name like '0119 %')
     or exists (select 1 from leagues l where l.slug like 'zz-t119-%')
     or exists (select 1 from external_sources x where x.id = '__t119') then
    raise exception '0119: the test rows outlived their rollback';
  end if;
  if coalesce(current_setting('epinoia.org_rpc', true), '') = 'on'
     or coalesce(current_setting('epinoia.org_tree_rewrite', true), '') = 'on' then
    raise exception '0119: the self-test left a switch on';
  end if;

  /* The anonymous row counts of leagues and teams, against the top of the file.
     Identical, apart from rows somebody else wrote meanwhile, which show up in
     the owner's count by exactly as much. */
  select count(*) into lg_all from public.leagues;
  select count(*) into tm_all from public.teams;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into lg_anon from public.leagues;
  select count(*) into tm_anon from public.teams;
  execute format('set local role %I', orig);
  if lg_anon - (snap->>'leagues_anon')::bigint <> lg_all - (snap->>'leagues_all')::bigint
     or tm_anon - (snap->>'teams_anon')::bigint <> tm_all - (snap->>'teams_all')::bigint then
    raise exception '0119: signed out, leagues went from % to % and teams from % to %, while as the owner they went from % to % and % to %',
      snap->>'leagues_anon', lg_anon, snap->>'teams_anon', tm_anon,
      snap->>'leagues_all', lg_all, snap->>'teams_all', tm_all;
  end if;
  perform set_config('epinoia.t119_before', '', false);

  raise notice '0119 ok: the tree builds root-to-self paths and one tenant per root; cycles, a region under a club, a club on its own, '
               'a cross-tenant parent, a dissolved parent (new, moved in, or brought back below it) and a stranded child are refused; '
               'a kind change that strands a league or a team is refused; moving a branch rewrites every path below it; '
               'tenant settings are checked key by key; U18 in 2026/27 is 2008-09-01 to 2010-08-31';
  raise notice '0119 ok: organiser_id, club_id, age_group and gender change only through the setters (a league admin''s and a manager''s '
               'PATCH gets 42501, the same PATCH unchanged succeeds); anon reads visible organisations and writes nothing; no policy or view '
               'reads the tree; no new embed path; competition_teams rows get an id; person identities keep no payload; anonymous row counts unchanged';
  raise notice '0119: the catalogue, the ages, the owner''s tree, anon and the signed-in stranger ran; the platform admin, league admin and '
               'manager half ran with %; the service-role half %', half, service_half;
end $test$;
