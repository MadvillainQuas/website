-- ============================================================================
-- FEDERATION MEMBERSHIP — the seam between somebody else's register and ours.
--
-- A national federation already knows who every player is. It has a membership
-- number, a date of birth it has verified, a club they are registered to, and
-- a licence that is valid or is not. None of that is ours to decide, and a
-- competition run under that federation cannot have two answers to "is this
-- player registered" — which is exactly what happens the moment a league
-- administrator retypes a squad list.
--
-- THE DIVISION OF AUTHORITY, WRITTEN DOWN ONCE SO IT IS NOT ARGUED PER FIELD:
--
--   the federation owns IDENTITY and ELIGIBILITY
--     who this person is, how old they are, which club they are registered to,
--     whether their licence is valid on a given date
--
--   Epinoia owns WHAT HAPPENED ON COURT
--     every event, every derived figure, the shirt they wore on the night
--
-- Neither writes into the other's half. A sync updates a name and a licence
-- state; it never touches a box score. A game never writes back a date of
-- birth. Where the two disagree about identity, the federation wins and the
-- difference is recorded rather than silently applied, because a name that
-- changes on its own is how a club loses confidence in a system.
--
-- WHY A TABLE AND NOT COLUMNS ON players. Three reasons, and the third is the
-- one that decides it:
--   1. a club can be affiliated to more than one body (a national federation
--      and a regional association) with a different number in each
--   2. teams and competitions need the same treatment, and three sets of
--      parallel columns is the same table written three times
--   3. an external id is not a property of a player, it is a statement by a
--      SOURCE about a player, and it has to be revocable without touching the
--      player at all
-- ============================================================================

create table if not exists public.external_sources (
  id          text primary key,                 -- 'basketball-england'
  label       text not null,                    -- 'Basketball England'
  kind        text not null default 'federation'
              check (kind in ('federation','association','club-system','other')),
  base_url    text,
  /* Per-source policy. Whether a sync may create a player who is not here yet,
     and whether an eligibility refusal is advisory or blocking, differ between
     bodies and are the first thing an integration argues about. */
  config      jsonb not null default
              '{"may_create_players":true,"eligibility":"advisory","name_case":"as-given"}'::jsonb,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.external_identities (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null references public.external_sources on delete cascade,
  entity_type  text not null check (entity_type in ('player','team','competition','venue')),
  entity_id    uuid not null,
  external_id  text not null,                   -- their membership/licence number
  /* Whatever else the source said, kept verbatim. A federation's own payload is
     the evidence for anything this platform later asserts, and throwing it away
     means a disagreement cannot be investigated. */
  payload      jsonb not null default '{}'::jsonb,
  synced_at    timestamptz,
  created_at   timestamptz not null default now(),

  /* One source cannot claim the same membership number for two people, and
     one entity cannot hold two numbers from the same source. Both directions,
     because a duplicate in either is a data-entry error that would otherwise
     surface months later as a player with half a season of statistics. */
  unique (source_id, entity_type, external_id),
  unique (source_id, entity_type, entity_id)
);
create index if not exists ext_ident_entity on public.external_identities (entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- ELIGIBILITY — a cache of somebody else's answer, never our own opinion.
--
-- The federation decides. This records what it said and when, so a fixture on
-- Saturday is not gated on the federation's API being up at 14:00 — and so a
-- refusal can be shown with a date attached rather than as a bare "no".
-- ----------------------------------------------------------------------------
create table if not exists public.membership_eligibility (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null references public.external_sources on delete cascade,
  player_id     uuid not null references public.players on delete cascade,
  valid_from    date,
  valid_to      date,
  status        text not null default 'unknown'
                check (status in ('eligible','suspended','lapsed','unregistered','unknown')),
  reason        text not null default '',
  checked_at    timestamptz not null default now(),
  unique (source_id, player_id)
);

-- ----------------------------------------------------------------------------
-- A RUN IS A RECORD, NOT A SIDE EFFECT.
--
-- An import that quietly renamed forty players is indistinguishable from one
-- that did nothing, until somebody notices. Every sync writes what it found,
-- what it changed and what it refused, so the answer to "why is this player
-- called that now" is one query rather than an afternoon.
-- ----------------------------------------------------------------------------
create table if not exists public.membership_syncs (
  id          uuid primary key default gen_random_uuid(),
  source_id   text not null references public.external_sources on delete cascade,
  league_id   uuid references public.leagues on delete set null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  seen        int not null default 0,
  created     int not null default 0,
  updated     int not null default 0,
  skipped     int not null default 0,
  conflicts   jsonb not null default '[]'::jsonb,
  error       text,
  run_by      uuid references auth.users on delete set null
);
create index if not exists membership_syncs_src on public.membership_syncs (source_id, started_at desc);

-- ============================================================================
-- WHO MAY SEE AND DO ANY OF THIS
--
-- Nothing here is public. An external membership number is personal data about
-- somebody who never agreed to appear on a results website, and a sync log
-- names players by id. Default deny, and read only for administrators.
-- ============================================================================
alter table public.external_sources       enable row level security;
alter table public.external_identities    enable row level security;
alter table public.membership_eligibility enable row level security;
alter table public.membership_syncs       enable row level security;

drop policy if exists ext_sources_read on public.external_sources;
create policy ext_sources_read on public.external_sources for select
  using (public.is_platform_admin());
drop policy if exists ext_sources_write on public.external_sources;
create policy ext_sources_write on public.external_sources for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists ext_ident_read on public.external_identities;
create policy ext_ident_read on public.external_identities for select
  using (public.is_platform_admin());

drop policy if exists elig_read on public.membership_eligibility;
create policy elig_read on public.membership_eligibility for select
  using (public.is_platform_admin());

drop policy if exists syncs_read on public.membership_syncs;
create policy syncs_read on public.membership_syncs for select
  using (public.is_platform_admin());

-- Writes come from the sync runner with the service role, which bypasses RLS.
-- No policy is granted for insert or update on purpose: there is no path by
-- which a browser session can claim a player belongs to a federation.

-- ----------------------------------------------------------------------------
-- The one question a fixture actually needs to ask.
--
-- Deliberately answers 'unknown' rather than 'no' when nothing is recorded: a
-- league that has not connected a federation must not have every player refused,
-- and a source configured as advisory must not block a game on a Saturday
-- because an API was down on Friday.
-- ----------------------------------------------------------------------------
create or replace function public.membership_status(p_player uuid, p_on date default current_date)
returns table (source_id text, status text, reason text, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.source_id,
         case
           when e.status <> 'eligible' then e.status
           when e.valid_from is not null and p_on < e.valid_from then 'lapsed'
           when e.valid_to   is not null and p_on > e.valid_to   then 'lapsed'
           else 'eligible'
         end,
         e.reason, e.checked_at
  from public.membership_eligibility e
  join public.external_sources s on s.id = e.source_id and s.enabled
  where e.player_id = p_player;
$$;
grant execute on function public.membership_status(uuid, date) to authenticated;

-- ============================================================================
-- SELF-TEST — the two uniqueness rules, and the date window.
-- ============================================================================
do $$
declare
  pid uuid;
  n   int;
begin
  insert into public.external_sources (id, label)
  values ('__selftest', 'Self test') on conflict (id) do nothing;

  select id into pid from public.players limit 1;
  if pid is null then
    delete from public.external_sources where id = '__selftest';
    raise notice '0077 self-test skipped: no players';
    return;
  end if;

  insert into public.external_identities (source_id, entity_type, entity_id, external_id)
  values ('__selftest', 'player', pid, 'M-1');

  -- the same number claimed for a second person must be refused
  begin
    insert into public.external_identities (source_id, entity_type, entity_id, external_id)
    values ('__selftest', 'player', gen_random_uuid(), 'M-1');
    raise exception '0077: a duplicate membership number was accepted';
  exception when unique_violation then null; end;

  -- and the same person given a second number by the same source
  begin
    insert into public.external_identities (source_id, entity_type, entity_id, external_id)
    values ('__selftest', 'player', pid, 'M-2');
    raise exception '0077: a second number for one player was accepted';
  exception when unique_violation then null; end;

  -- an expired window reads as lapsed, not as eligible
  insert into public.membership_eligibility
    (source_id, player_id, status, valid_from, valid_to)
  values ('__selftest', pid, 'eligible', date '2020-01-01', date '2020-12-31');

  select count(*) into n from public.membership_status(pid, date '2026-01-01')
   where status = 'lapsed';
  if n <> 1 then raise exception '0077: an expired licence did not read as lapsed'; end if;

  select count(*) into n from public.membership_status(pid, date '2020-06-01')
   where status = 'eligible';
  if n <> 1 then raise exception '0077: a licence inside its window did not read as eligible'; end if;

  delete from public.external_sources where id = '__selftest';   -- cascades
  raise notice '0077 ok: identities are unique both ways, and a window is honoured';
end $$;
