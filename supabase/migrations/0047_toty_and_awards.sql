-- ============================================================================
-- 0047 — CHOSEN AWARDS, THE TEAM OF THE YEAR, AND A PUBLIC BALLOT.
--
-- Every award on this platform so far has been COMPUTED: MVP by box
-- plus/minus, the rest by per-game leaders. That is the right default and it
-- is not how leagues actually hand out trophies. Coach of the Year is a vote.
-- Most Improved is an opinion. And a Team of the Year is a selection somebody
-- argues about in a room, which is most of the point of having one.
--
-- Two mechanisms, kept apart on purpose:
--
--   AN OVERRIDE is an editorial decision recorded ALONGSIDE the computed
--   award, never in place of it. season_awards keeps being rebuilt from the
--   event log by compute_season_awards, which deletes and re-inserts the whole
--   set — so an override written into that table would survive exactly until
--   the next finalised game. It lives in its own table and the resolver
--   prefers it, which also means "what did the numbers say" is still
--   answerable after somebody overrules them.
--
--   A BALLOT is a vote with two electorates. The public vote from the site;
--   the league's own officials vote with a weight the league sets. Neither is
--   allowed to be the whole answer by default, because a pure public vote is a
--   popularity contest and a pure official vote is not worth putting a "VOTE"
--   button on a website for.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. OVERRIDES
-- ---------------------------------------------------------------------------
create table if not exists public.season_award_overrides (
  competition_id uuid not null references public.competitions on delete cascade,
  code           text not null,
  player_id      uuid references public.players on delete cascade,
  team_id        uuid references public.teams on delete cascade,
  title          text not null default '',     -- for a code the platform does not compute
  detail         text not null default '',
  decided_by     uuid references auth.users on delete set null,
  decided_at     timestamptz not null default now(),
  primary key (competition_id, code)
);

alter table public.season_award_overrides enable row level security;
drop policy if exists award_override_read on public.season_award_overrides;
create policy award_override_read on public.season_award_overrides for select using (true);

create or replace function public.set_award_override(
  p_competition uuid, p_code text, p_player uuid default null,
  p_team uuid default null, p_title text default '', p_detail text default ''
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;
  if p_player is null and p_team is null then
    raise exception 'an award goes to a player or a club' using errcode = '22023';
  end if;

  insert into season_award_overrides
    (competition_id, code, player_id, team_id, title, detail, decided_by, decided_at)
  values (p_competition, p_code, p_player, p_team,
          coalesce(p_title, ''), coalesce(p_detail, ''), auth.uid(), now())
  on conflict (competition_id, code) do update
    set player_id = excluded.player_id, team_id = excluded.team_id,
        title = excluded.title, detail = excluded.detail,
        decided_by = excluded.decided_by, decided_at = now();

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_award_override', 'competition', p_competition::text,
          jsonb_build_object('code', p_code, 'player', p_player, 'team', p_team));
  return 'saved';
end; $$;

create or replace function public.clear_award_override(p_competition uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;
  delete from season_award_overrides where competition_id = p_competition and code = p_code;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'clear_award_override', 'competition', p_competition::text,
          jsonb_build_object('code', p_code));
  return 'back to the computed winner';
end; $$;

-- The merged view the public page reads: the computed set, with an override
-- replacing a code where one exists and appended where it is a code nothing
-- computes. `chosen` says which it is, because a reader is entitled to know
-- whether a trophy came out of the numbers or out of a room.
create or replace function public.season_awards_resolved(p_competition uuid)
returns table (
  code text, title text, player_id uuid, team_id uuid,
  value numeric, detail text, chosen boolean
) language sql stable security definer set search_path = public as $$
  select a.code, o.title, coalesce(o.player_id, a.player_id),
         coalesce(o.team_id, a.team_id),
         case when o.code is null then a.value end,
         coalesce(nullif(o.detail, ''), a.detail),
         o.code is not null
    from season_awards a
    left join season_award_overrides o
           on o.competition_id = a.competition_id and o.code = a.code
   where a.competition_id = p_competition
  union all
  select o.code, o.title, o.player_id, o.team_id, null, o.detail, true
    from season_award_overrides o
   where o.competition_id = p_competition
     and not exists (select 1 from season_awards a
                      where a.competition_id = o.competition_id and a.code = o.code);
$$;

-- ---------------------------------------------------------------------------
-- 2. THE BALLOT
-- ---------------------------------------------------------------------------
create table if not exists public.toty_ballots (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions on delete cascade,
  title           text not null default 'Team of the Year',
  slots           int  not null default 5,
  opens_at        timestamptz,
  closes_at       timestamptz,
  -- how the two electorates are mixed. They do not have to sum to one; each
  -- side's share of ITS OWN electorate is scaled by its weight, so 60/40 means
  -- what it looks like whether nine officials vote or ninety.
  public_weight   numeric not null default 0.4,
  official_weight numeric not null default 0.6,
  status          text not null default 'draft',
  published_at    timestamptz,
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  constraint toty_status_ck check (status in ('draft','open','closed','published')),
  constraint toty_slots_ck  check (slots between 1 and 15),
  constraint toty_weights_ck check (public_weight >= 0 and official_weight >= 0
                                    and public_weight + official_weight > 0)
);
create index if not exists toty_comp on public.toty_ballots (competition_id);

create table if not exists public.toty_candidates (
  ballot_id uuid not null references public.toty_ballots on delete cascade,
  player_id uuid not null references public.players on delete cascade,
  team_id   uuid references public.teams on delete set null,
  primary key (ballot_id, player_id)
);

-- One row per voter per player. The unique key is what stops a public voter
-- picking the same player five times to spend all their slots on one name.
create table if not exists public.toty_votes (
  id         bigserial primary key,
  ballot_id  uuid not null references public.toty_ballots on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  source     text not null default 'public',
  voter_key  text not null,
  weight     numeric not null default 1,
  created_at timestamptz not null default now(),
  constraint toty_source_ck check (source in ('public','official')),
  unique (ballot_id, voter_key, player_id)
);
create index if not exists toty_votes_ballot on public.toty_votes (ballot_id, source);

create table if not exists public.toty_results (
  ballot_id      uuid not null references public.toty_ballots on delete cascade,
  player_id      uuid not null references public.players on delete cascade,
  team_id        uuid references public.teams on delete set null,
  rank           int not null,
  score          numeric not null,
  public_share   numeric not null default 0,
  official_share numeric not null default 0,
  primary key (ballot_id, player_id)
);

alter table public.toty_ballots    enable row level security;
alter table public.toty_candidates enable row level security;
alter table public.toty_votes      enable row level security;
alter table public.toty_results    enable row level security;

-- A draft ballot is not public — a league lining up candidates should not have
-- the site announce it. Everything from 'open' onwards is.
drop policy if exists toty_ballot_read on public.toty_ballots;
create policy toty_ballot_read on public.toty_ballots for select
  using (status <> 'draft' or public.is_competition_admin(competition_id));

drop policy if exists toty_cand_read on public.toty_candidates;
create policy toty_cand_read on public.toty_candidates for select
  using (exists (select 1 from toty_ballots b where b.id = ballot_id
                  and (b.status <> 'draft' or public.is_competition_admin(b.competition_id))));

-- VOTES ARE NEVER READABLE, by anybody, through the table. A per-voter row is
-- a record of what one person picked, and there is no version of this feature
-- that needs that published. The tallies come out of compute_toty.
drop policy if exists toty_votes_read on public.toty_votes;

drop policy if exists toty_result_read on public.toty_results;
create policy toty_result_read on public.toty_results for select
  using (exists (select 1 from toty_ballots b where b.id = ballot_id
                  and (b.status = 'published' or public.is_competition_admin(b.competition_id))));

-- ---------------------------------------------------------------------------
-- 3. RUNNING ONE
-- ---------------------------------------------------------------------------
create or replace function public.toty_upsert(
  p_ballot uuid, p_competition uuid,
  p_title text default 'Team of the Year', p_slots int default 5,
  p_opens timestamptz default null, p_closes timestamptz default null,
  p_public_weight numeric default 0.4, p_official_weight numeric default 0.6,
  p_status text default 'draft'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  if p_ballot is null then
    insert into toty_ballots (competition_id, title, slots, opens_at, closes_at,
                              public_weight, official_weight, status, created_by)
    values (p_competition, p_title, p_slots, p_opens, p_closes,
            p_public_weight, p_official_weight, p_status, auth.uid())
    returning id into v_id;
  else
    update toty_ballots set
      title = p_title, slots = p_slots, opens_at = p_opens, closes_at = p_closes,
      public_weight = p_public_weight, official_weight = p_official_weight,
      status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, now()) end
     where id = p_ballot and competition_id = p_competition
    returning id into v_id;
    if v_id is null then raise exception 'no such ballot' using errcode = '22023'; end if;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'toty_upsert', 'ballot', v_id::text,
          jsonb_build_object('status', p_status, 'slots', p_slots));
  return v_id;
end; $$;

-- The shortlist. Given no list, it takes the leading players by box
-- plus/minus, which is the same number the Stars section ranks by — a
-- shortlist that disagreed with the podium two sections above it would need
-- explaining every time.
create or replace function public.toty_set_candidates(
  p_ballot uuid, p_players uuid[] default null, p_top int default 20
) returns int language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_n int;
begin
  select competition_id into v_comp from toty_ballots where id = p_ballot;
  if v_comp is null then raise exception 'no such ballot' using errcode = '22023'; end if;
  if not public.is_competition_admin(v_comp) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  delete from toty_candidates where ballot_id = p_ballot;

  if p_players is not null and array_length(p_players, 1) > 0 then
    insert into toty_candidates (ballot_id, player_id, team_id)
    select p_ballot, p, (select r.team_id from roster_entries r
                          where r.player_id = p and r.active
                          order by r.created_at desc limit 1)
      from unnest(p_players) p
    on conflict do nothing;
  else
    insert into toty_candidates (ballot_id, player_id, team_id)
    select p_ballot, s.player_uuid,
           (select r.team_id from roster_entries r
             where r.player_id = s.player_uuid and r.active
             order by r.created_at desc limit 1)
      from player_season_stats s
     where s.competition_id = v_comp and s.player_uuid is not null
     order by s.pts desc
     limit greatest(1, coalesce(p_top, 20))
    on conflict do nothing;
  end if;

  select count(*) into v_n from toty_candidates where ballot_id = p_ballot;
  return v_n;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. VOTING.
--
-- The public one is callable by anon, which is the entire point, so it has to
-- be careful about everything a browser controls. It:
--   refuses a ballot that is not open, or is outside its window
--   refuses a player who is not on the shortlist
--   refuses more picks than there are slots
--   de-duplicates within a submission, so five copies of one name is one vote
--   REPLACES that voter's previous ballot rather than adding to it
--
-- The voter key is a random identifier the browser keeps. That is not
-- identity and this is not an election: it stops the accidental double
-- submission and the idle refresh, not somebody determined to clear their
-- storage. A fan vote that claimed otherwise would be lying, so the weighting
-- exists — the officials' half is the half that cannot be farmed.
-- ---------------------------------------------------------------------------
create or replace function public.cast_toty_vote(
  p_ballot uuid, p_players uuid[], p_voter text
) returns text language plpgsql security definer set search_path = public as $$
declare b record; v_n int; v_ok int;
begin
  select * into b from toty_ballots where id = p_ballot;
  if b is null then raise exception 'no such ballot' using errcode = '22023'; end if;
  if b.status <> 'open' then
    raise exception 'voting is not open' using errcode = '22023';
  end if;
  if b.opens_at is not null and now() < b.opens_at then
    raise exception 'voting has not opened yet' using errcode = '22023';
  end if;
  if b.closes_at is not null and now() > b.closes_at then
    raise exception 'voting has closed' using errcode = '22023';
  end if;
  if p_voter is null or length(trim(p_voter)) < 8 then
    raise exception 'a vote needs a voter key' using errcode = '22023';
  end if;

  select count(distinct p) into v_n from unnest(coalesce(p_players, '{}'::uuid[])) p;
  if v_n = 0 then raise exception 'pick somebody' using errcode = '22023'; end if;
  if v_n > b.slots then
    raise exception 'this ballot has % slots, you picked %', b.slots, v_n
      using errcode = '22023';
  end if;

  select count(*) into v_ok from toty_candidates c
   where c.ballot_id = p_ballot and c.player_id = any(p_players);
  if v_ok < v_n then
    raise exception 'somebody on that ballot is not a candidate' using errcode = '22023';
  end if;

  delete from toty_votes
   where ballot_id = p_ballot and voter_key = trim(p_voter) and source = 'public';

  insert into toty_votes (ballot_id, player_id, source, voter_key, weight)
  select distinct p_ballot, p, 'public', trim(p_voter), 1
    from unnest(p_players) p;

  return 'thank you — ' || v_n || ' vote' || case when v_n = 1 then '' else 's' end || ' recorded';
end; $$;

-- The league's own electorate. Entered by hand or pasted from a spreadsheet;
-- either way it arrives here as one array of {voter, players, weight}, and a
-- voter named twice REPLACES their earlier ballot rather than voting twice.
create or replace function public.toty_official_votes(p_ballot uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid; r jsonb; v_key text; v_w numeric; v_n int := 0; pid uuid;
begin
  select competition_id into v_comp from toty_ballots where id = p_ballot;
  if v_comp is null then raise exception 'no such ballot' using errcode = '22023'; end if;
  if not public.is_competition_admin(v_comp) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_key := trim(coalesce(r->>'voter', ''));
    if v_key = '' then
      raise exception 'every official ballot needs a name to attribute it to'
        using errcode = '22023';
    end if;
    v_w := coalesce((r->>'weight')::numeric, 1);

    delete from toty_votes
     where ballot_id = p_ballot and source = 'official' and voter_key = v_key;

    for pid in select distinct value::uuid from jsonb_array_elements_text(r->'players') loop
      if not exists (select 1 from toty_candidates c
                      where c.ballot_id = p_ballot and c.player_id = pid) then
        raise exception 'that ballot names somebody who is not a candidate'
          using errcode = '22023';
      end if;
      insert into toty_votes (ballot_id, player_id, source, voter_key, weight)
      values (p_ballot, pid, 'official', v_key, v_w)
      on conflict do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'toty_official_votes', 'ballot', p_ballot::text,
          jsonb_build_object('votes', v_n));
  return v_n;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. THE COUNT.
--
-- Each electorate is scored as a SHARE OF ITSELF and the two shares are then
-- mixed by the ballot's weights. Adding raw counts instead would mean nine
-- officials get drowned by four hundred fans whatever the weights say, which
-- is the failure mode of every badly built fan vote.
--
-- THE DENOMINATOR IS THE VOTERS, NOT THE VOTES. On a five-slot ballot every
-- voter casts five, so dividing by the votes cast caps a unanimous player at
-- one fifth and makes the number unreadable — the first version of this did
-- exactly that and gave a player named by both officials a share of 0.5.
-- Dividing by the weight of the ELECTORATE instead means the share is the
-- fraction of ballots a player appears on, which is both correct and the
-- thing a reader would assume it was.
-- ---------------------------------------------------------------------------
create or replace function public.compute_toty(p_ballot uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  b record; v_pub numeric; v_off numeric; v_n int;
begin
  select * into b from toty_ballots where id = p_ballot;
  if b is null then raise exception 'no such ballot' using errcode = '22023'; end if;
  if not public.is_competition_admin(b.competition_id) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  select coalesce(sum(w), 0) into v_pub from (
    select max(weight) as w from toty_votes
     where ballot_id = p_ballot and source = 'public' group by voter_key) e;
  select coalesce(sum(w), 0) into v_off from (
    select max(weight) as w from toty_votes
     where ballot_id = p_ballot and source = 'official' group by voter_key) e;

  delete from toty_results where ballot_id = p_ballot;

  insert into toty_results (ballot_id, player_id, team_id, rank, score,
                            public_share, official_share)
  select p_ballot, t.player_id,
         (select c.team_id from toty_candidates c
           where c.ballot_id = p_ballot and c.player_id = t.player_id),
         row_number() over (order by t.score desc, t.player_id),
         t.score, t.ps, t.os
    from (
      select v.player_id,
             coalesce(sum(v.weight) filter (where v.source = 'public'), 0)
               / nullif(v_pub, 0) as ps_raw,
             coalesce(sum(v.weight) filter (where v.source = 'official'), 0)
               / nullif(v_off, 0) as os_raw,
             coalesce(coalesce(sum(v.weight) filter (where v.source = 'public'), 0)
               / nullif(v_pub, 0), 0) as ps,
             coalesce(coalesce(sum(v.weight) filter (where v.source = 'official'), 0)
               / nullif(v_off, 0), 0) as os,
             b.public_weight * coalesce(coalesce(sum(v.weight)
               filter (where v.source = 'public'), 0) / nullif(v_pub, 0), 0)
           + b.official_weight * coalesce(coalesce(sum(v.weight)
               filter (where v.source = 'official'), 0) / nullif(v_off, 0), 0) as score
        from toty_votes v
       where v.ballot_id = p_ballot
       group by v.player_id
    ) t;

  select count(*) into v_n from toty_results where ballot_id = p_ballot;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'compute_toty', 'ballot', p_ballot::text,
          jsonb_build_object('counted', v_n, 'public_weight_total', v_pub,
                             'official_weight_total', v_off));
  return v_n;
end; $$;

-- What the public page draws: the winning XI (or V), names and clubs, only
-- once the league has published it.
create or replace function public.toty_public(p_competition uuid)
returns table (
  ballot_id uuid, title text, slots int, status text, closes_at timestamptz,
  rank int, player_id uuid, player_name text, player_slug text,
  team_id uuid, team_name text, team_colour text, team_slug text, score numeric
) language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.slots, b.status, b.closes_at,
         r.rank, r.player_id, trim(p.first_name || ' ' || p.last_name), p.slug,
         r.team_id, t.name, t.colour, t.slug, r.score
    from toty_ballots b
    /* AND ONLY ONCE PUBLISHED. This is a SECURITY DEFINER function, so the
       policy on toty_results does not apply inside it — the condition has to
       be repeated here or a count that has been run but not announced leaks
       out of an open ballot. Caught by the self-test below, which is the
       reason it asserts on the unpublished state before the published one. */
    left join toty_results r on r.ballot_id = b.id and r.rank <= b.slots
                            and b.status = 'published'
    left join players p on p.id = r.player_id
    left join teams t on t.id = r.team_id
   where b.competition_id = p_competition
     and b.status in ('open','closed','published')
     /* A MINOR IS NEVER NAMED on a public page, whatever a vote decided.
        The ballot cannot be used as a way round the youth protection the rest
        of the platform enforces. */
     and (p.id is null or not p.is_minor)
   order by b.created_at desc, r.rank;
$$;

-- The shortlist a voter picks from.
create or replace function public.toty_ballot_public(p_competition uuid)
returns table (
  ballot_id uuid, title text, slots int, status text,
  opens_at timestamptz, closes_at timestamptz,
  player_id uuid, player_name text, team_name text, team_colour text
) language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.slots, b.status, b.opens_at, b.closes_at,
         c.player_id, trim(p.first_name || ' ' || p.last_name),
         coalesce(t.name, ''), coalesce(t.colour, '#93f2bf')
    from toty_ballots b
    join toty_candidates c on c.ballot_id = b.id
    join players p on p.id = c.player_id and not p.is_minor
    left join teams t on t.id = c.team_id
   where b.competition_id = p_competition and b.status = 'open'
   order by b.created_at desc, 8;
$$;

-- The admin's view of the count, before anybody publishes it.
create or replace function public.toty_standings(p_ballot uuid)
returns table (
  rank int, player_id uuid, player_name text, team_name text,
  score numeric, public_share numeric, official_share numeric
) language plpgsql stable security definer set search_path = public as $$
declare v_comp uuid;
begin
  select competition_id into v_comp from toty_ballots where id = p_ballot;
  if v_comp is null or not public.is_competition_admin(v_comp) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;
  return query
  select r.rank, r.player_id, trim(p.first_name || ' ' || p.last_name),
         coalesce(t.name, '—'), r.score, r.public_share, r.official_share
    from toty_results r
    join players p on p.id = r.player_id
    left join teams t on t.id = r.team_id
   where r.ballot_id = p_ballot
   order by r.rank;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'set_award_override(uuid,text,uuid,uuid,text,text)',
    'clear_award_override(uuid,text)',
    'toty_upsert(uuid,uuid,text,int,timestamptz,timestamptz,numeric,numeric,text)',
    'toty_set_candidates(uuid,uuid[],int)',
    'toty_official_votes(uuid,jsonb)', 'compute_toty(uuid)', 'toty_standings(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Anonymous by design: the whole feature is a button on a public page.
grant execute on function public.season_awards_resolved(uuid) to anon, authenticated;
grant execute on function public.toty_public(uuid)            to anon, authenticated;
grant execute on function public.toty_ballot_public(uuid)     to anon, authenticated;
grant execute on function public.cast_toty_vote(uuid,uuid[],text) to anon, authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  adm uuid := gen_random_uuid();
  lg uuid; ss uuid; cp uuid; tm uuid; bal uuid;
  pl uuid[] := '{}'; p uuid;
  orig text; failed text[] := '{}';
  i int; n int; t text; sc numeric; who text;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'toty-admin@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('toty-test', 'ToTY Test') returning id into lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);
  insert into seasons (league_id, name) values (lg, 'TY') returning id into ss;
  insert into competitions (season_id, name) values (ss, 'Div') returning id into cp;
  insert into teams (league_id, slug, name) values (lg, 'toty-club', 'Club') returning id into tm;

  for i in 1 .. 6 loop
    insert into players (slug, first_name, last_name, is_minor)
    values ('toty-p' || i, 'Player', i::text, i = 6)      -- number six is a minor
    returning id into p;
    pl := pl || p;
    insert into roster_entries (team_id, player_id, season_id, jersey)
    values (tm, p, ss, i::text);
  end loop;

  /* Seeded BEFORE the role switch. season_awards is read-only to everybody
     through RLS — it is written by compute_season_awards, a definer function —
     so standing in a computed award as `authenticated` is refused, and that
     refusal is the policy working rather than a fault in this test. */
  insert into season_awards (competition_id, code, player_id, value, detail)
  values (cp, 'mvp', pl[1], 7.5, 'computed');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  -- ---- overrides -----------------------------------------------------------
  t := public.set_award_override(cp, 'mvp', pl[2], null, 'Most Valuable Player', 'voted');
  select player_id into p from public.season_awards_resolved(cp) where code = 'mvp';
  if p <> pl[2] then failed := array_append(failed, 'the override did not win'); end if;
  select count(*) into n from public.season_awards_resolved(cp) where code = 'mvp' and chosen;
  if n <> 1 then failed := array_append(failed, 'the override is not marked as chosen'); end if;

  -- a code nothing computes still appears
  t := public.set_award_override(cp, 'coach', null, tm, 'Coach of the Year', '');
  select count(*) into n from public.season_awards_resolved(cp) where code = 'coach';
  if n <> 1 then failed := array_append(failed, 'an override-only award did not appear'); end if;

  -- and the computed answer is still there underneath
  t := public.clear_award_override(cp, 'mvp');
  select player_id into p from public.season_awards_resolved(cp) where code = 'mvp';
  if p <> pl[1] then failed := array_append(failed, 'clearing did not restore the computed winner'); end if;

  -- ---- the ballot ----------------------------------------------------------
  bal := public.toty_upsert(null, cp, 'Team of the Year', 3,
                            now() - interval '1 day', now() + interval '7 days',
                            0.4, 0.6, 'draft');
  n := public.toty_set_candidates(bal, pl, 20);
  if n <> 6 then failed := array_append(failed, ('six candidates expected, got ' || n)); end if;

  -- a draft ballot must not be votable
  begin perform public.cast_toty_vote(bal, array[pl[1]], 'voter-aaaaaaa1');
    failed := array_append(failed, 'a draft ballot accepted a vote');
  exception when others then null; end;

  bal := public.toty_upsert(bal, cp, 'Team of the Year', 3,
                            now() - interval '1 day', now() + interval '7 days',
                            0.4, 0.6, 'open');

  -- ---- as the public -------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  t := public.cast_toty_vote(bal, array[pl[1], pl[2], pl[3]], 'voter-aaaaaaa1');
  t := public.cast_toty_vote(bal, array[pl[1], pl[2], pl[4]], 'voter-aaaaaaa2');
  t := public.cast_toty_vote(bal, array[pl[1], pl[3], pl[4]], 'voter-aaaaaaa3');

  -- the same voter again REPLACES, it does not add
  t := public.cast_toty_vote(bal, array[pl[5]], 'voter-aaaaaaa3');

  -- five copies of one name is one vote
  t := public.cast_toty_vote(bal, array[pl[1], pl[1], pl[1]], 'voter-aaaaaaa4');

  begin perform public.cast_toty_vote(bal, array[pl[1], pl[2], pl[3], pl[4]], 'voter-aaaaaaa5');
    failed := array_append(failed, 'a four-name ballot fitted into three slots');
  exception when others then null; end;

  begin perform public.cast_toty_vote(bal, array[pl[1]], 'short');
    failed := array_append(failed, 'a nonsense voter key was accepted');
  exception when others then null; end;

  -- the shortlist must not offer the minor
  select count(*) into n from public.toty_ballot_public(cp);
  if n <> 5 then
    failed := array_append(failed, ('the shortlist should hide the minor and show 5, got ' || n));
  end if;

  -- votes are not readable, by anybody, through the table
  begin
    select count(*) into n from toty_votes;
    if n > 0 then failed := array_append(failed, 'anon could read the individual votes'); end if;
  exception when insufficient_privilege then null; end;

  -- ---- back to the admin, and the count ------------------------------------
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  n := public.toty_official_votes(bal, jsonb_build_array(
    jsonb_build_object('voter', 'Head of Officiating',
                       'players', jsonb_build_array(pl[5], pl[4], pl[3]), 'weight', 1),
    jsonb_build_object('voter', 'Statistician',
                       'players', jsonb_build_array(pl[5], pl[4], pl[2]), 'weight', 1)));
  if n <> 6 then failed := array_append(failed, ('six official votes expected, got ' || n)); end if;

  /* Naming a voter twice must REPLACE their ballot, not add a second one.
     Counting rows in toty_votes would be the direct test and cannot be done:
     the table has no select policy at all, on purpose, so even the admin sees
     nothing through it. The tally is the observable, which is the right thing
     to assert on anyway — after the Statistician re-votes for five alone,
     five is on both official ballots and four is on one. */
  n := public.toty_official_votes(bal, jsonb_build_array(
    jsonb_build_object('voter', 'Statistician',
                       'players', jsonb_build_array(pl[5]), 'weight', 1)));

  n := public.compute_toty(bal);
  if n < 5 then failed := array_append(failed, ('the count returned only ' || n || ' players')); end if;

  select official_share into sc from public.toty_standings(bal) where player_id = pl[5];
  if sc is null or abs(sc - 1) > 0.001 then
    failed := array_append(failed,
      'player five should hold both official ballots, share came back ' ||
      coalesce(sc::text, 'null'));
  end if;
  select official_share into sc from public.toty_standings(bal) where player_id = pl[4];
  if sc is null or abs(sc - 0.5) > 0.001 then
    failed := array_append(failed,
      'the replaced official ballot still counts — player four''s share is ' ||
      coalesce(sc::text, 'null'));
  end if;

  /* Player 5 got one public vote out of four public ballots, and BOTH official
     ones. Player 1 got three public votes and no official one. With the
     official side weighted 0.6, five has to finish above one — that is the
     whole reason the weighting exists, and if the shares were added as raw
     counts instead it would come out the other way. */
  select player_name into who from public.toty_standings(bal) where rank = 1;
  if who <> 'Player 5' then
    failed := array_append(failed,
      'the weighting did not carry the officials'' pick to the top (got ' ||
      coalesce(who, 'nobody') || ')');
  end if;

  -- results stay unpublished until the league says so
  reset role; set local role anon;
  select count(*) into n from public.toty_public(cp);
  if n > 0 and exists (select 1 from public.toty_public(cp) where player_id is not null) then
    failed := array_append(failed, 'an unpublished result was visible');
  end if;

  reset role; set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  bal := public.toty_upsert(bal, cp, 'Team of the Year', 3, null, null, 0.4, 0.6, 'published');

  reset role; set local role anon;
  select count(*) into n from public.toty_public(cp) where player_id is not null;
  if n <> 3 then
    failed := array_append(failed, ('the published team should be 3 players, got ' || n));
  end if;

  -- --------------------------------------------------------------- tidy up ---
  reset role;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from toty_results where ballot_id = bal;
  delete from toty_votes where ballot_id = bal;
  delete from toty_candidates where ballot_id = bal;
  delete from toty_ballots where competition_id = cp;
  delete from season_award_overrides where competition_id = cp;
  delete from season_awards where competition_id = cp;
  delete from roster_entries where team_id = tm;
  delete from players where slug like 'toty-p%';
  delete from teams where id = tm;
  delete from competitions where id = cp;
  delete from seasons where id = ss;
  delete from memberships where user_id = adm;
  delete from leagues where id = lg;
  delete from audit_log where actor = adm;
  delete from auth.users where id = adm;

  if array_length(failed, 1) > 0 then
    raise exception E'TEAM OF THE YEAR SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
