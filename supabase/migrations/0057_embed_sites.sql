-- ============================================================================
-- 0057 — AN EMBED CONFIGURED BY WHERE IT IS PLANTED.
--
-- The embeds take their settings from the URL: ?l=slug&n=24&kind=standings. That
-- works, and it stays working — but it means the person who pastes the snippet
-- into a club's website is the person who decides what it shows, and if the
-- league later wants that club's site to show only that club's fixtures,
-- somebody has to go round and edit the markup on every site.
--
-- So a league administrator can register a HOST and say what the embed should
-- do there. An embed with no ?l= asks who is hosting it and gets an answer.
-- Anything still given in the URL wins, so nothing already planted changes
-- behaviour.
--
-- HOW THE HOST IS ESTABLISHED, and its limits, stated plainly. The embed reads
-- location.ancestorOrigins where it exists and falls back to document.referrer.
-- Both are supplied by the embedding page, so a site can claim to be another
-- site. That is worth being clear about rather than papering over: this is a
-- convenience for arranging PUBLIC information, not an access control. Nothing
-- behind it is private — every fixture and score this can select was already
-- readable by anyone with the URL — so the worst a spoofed host achieves is
-- showing itself somebody else's public fixture list, which it could do by
-- typing that league's slug into the snippet anyway.
--
-- Rules are therefore readable by anon: the embed is anonymous by definition.
-- Writing one is league-admin only, and a host can be claimed once, so two
-- leagues cannot both point the same club's website at themselves.
-- ============================================================================
create table if not exists public.embed_sites (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues on delete cascade,
  host       text not null,
  -- null means "the whole league"; set, means this club only
  team_id    uuid references public.teams on delete cascade,
  -- which embed the rule is for. 'any' applies to all of them.
  kind       text not null default 'any',
  max_items  int,
  theme      text,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint embed_kind_ck check (kind in ('any','strip','table','game','merch')),
  constraint embed_theme_ck check (theme is null or theme in ('dark','light')),
  constraint embed_items_ck check (max_items is null or (max_items between 1 and 60)),
  -- A HOST IS CLAIMED ONCE PER EMBED KIND. Without this the same site could be
  -- pointed at two leagues and which one answered would depend on row order,
  -- which is the kind of bug that only appears in production.
  unique (host, kind)
);
create index if not exists embed_sites_league on public.embed_sites (league_id);

alter table public.embed_sites enable row level security;

-- The embed is anonymous, so the rules have to be readable anonymously. They
-- contain no more than a hostname and a pointer to public rows.
drop policy if exists embed_sites_read on public.embed_sites;
create policy embed_sites_read on public.embed_sites for select using (true);

-- Writes go through the functions below, which check who is asking.
-- Deliberately no write policy on the table.

/* A hostname, normalised the one way. Whatever an administrator types — a full
   URL, a scheme, a www., a trailing slash, capitals — becomes the bare host, so
   the lookup at render time is a plain equality against something the browser
   will actually report. Getting this wrong in either direction produces a rule
   that silently never matches, which is the worst outcome available: the embed
   looks configured and behaves as though it is not. */
create or replace function public.norm_host(p text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(trim(p), '')), '^[a-z][a-z0-9+.-]*://', ''),
        '/.*$', ''),
      '^www\.', ''),
    '');
$$;

create or replace function public.set_embed_site(
  p_league uuid, p_host text, p_team uuid default null,
  p_kind text default 'any', p_max int default null, p_theme text default null,
  p_note text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_host text; v_id uuid;
begin
  if not (public.is_platform_admin() or public.is_league_admin(p_league)) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  v_host := public.norm_host(p_host);
  if v_host is null then
    raise exception 'give the website address, e.g. neoncitybasketball.co.uk'
      using errcode = '22023';
  end if;
  /* a bare label is almost always a typo for a domain, and a rule that can
     never match is worse than an error */
  if position('.' in v_host) = 0 then
    raise exception 'that does not look like a website address' using errcode = '22023';
  end if;

  if p_team is not null and not exists (
    select 1 from teams where id = p_team and league_id = p_league) then
    raise exception 'that club is not in this league' using errcode = '22023';
  end if;

  insert into embed_sites (league_id, host, team_id, kind, max_items, theme, note)
  values (p_league, v_host, p_team, coalesce(p_kind, 'any'), p_max, p_theme, coalesce(p_note, ''))
  on conflict (host, kind) do update
    set league_id = excluded.league_id,
        team_id   = excluded.team_id,
        max_items = excluded.max_items,
        theme     = excluded.theme,
        note      = excluded.note
    /* ...but only if the row being replaced is one this administrator owns.
       Without the WHERE, on-conflict-do-update would let any league admin take
       over another league's host by inserting the same one. */
    where embed_sites.league_id = p_league or public.is_platform_admin()
  returning id into v_id;

  if v_id is null then
    raise exception 'another league has already claimed %', v_host using errcode = '42501';
  end if;
  return v_id;
end; $$;

create or replace function public.delete_embed_site(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from embed_sites where id = p_id;
  if not found then return 'gone already'; end if;
  if not (public.is_platform_admin() or public.is_league_admin(r.league_id)) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  delete from embed_sites where id = p_id;
  return 'removed';
end; $$;

create or replace function public.embed_sites_list(p_league uuid)
returns table (id uuid, host text, team_id uuid, team_name text, kind text,
               max_items int, theme text, note text)
language sql stable security definer set search_path = public as $$
  select e.id, e.host, e.team_id, t.name, e.kind, e.max_items, e.theme, e.note
    from embed_sites e
    left join teams t on t.id = e.team_id
   where e.league_id = p_league
     and (public.is_platform_admin() or public.is_league_admin(p_league))
   order by e.host, e.kind;
$$;

/* WHAT THE EMBED ASKS. One round trip, anonymous, and it answers with slugs
   rather than ids because that is what the embed's own URLs are built from.

   The specific rule wins over the general one: a rule written for the strip
   beats a rule written for 'any' on the same host. */
create or replace function public.embed_config(p_host text, p_kind text default 'any')
returns table (league_slug text, league_name text, team_slug text, team_name text,
               max_items int, theme text)
language sql stable security definer set search_path = public as $$
  select l.slug, l.name, t.slug, t.name, e.max_items, e.theme
    from embed_sites e
    join leagues l on l.id = e.league_id
    left join teams t on t.id = e.team_id
   where e.host = public.norm_host(p_host)
     and e.kind in (coalesce(p_kind, 'any'), 'any')
   order by (e.kind <> 'any')::int desc      -- the specific rule first
   limit 1;
$$;

revoke execute on function public.set_embed_site(uuid, text, uuid, text, int, text, text) from anon, public;
grant  execute on function public.set_embed_site(uuid, text, uuid, text, int, text, text) to authenticated;
revoke execute on function public.delete_embed_site(uuid) from anon, public;
grant  execute on function public.delete_embed_site(uuid) to authenticated;
revoke execute on function public.embed_sites_list(uuid) from anon, public;
grant  execute on function public.embed_sites_list(uuid) to authenticated;
grant  execute on function public.embed_config(text, text) to anon, authenticated;
grant  execute on function public.norm_host(text) to anon, authenticated;

-- ------------------------------------------------------------- assertions ---
-- plpgsql is not checked at creation, so everything above is called once here.
--
-- THE MIGRATION RUNS AS NOBODY'S ADMINISTRATOR — auth.uid() is null here — so
-- set_embed_site and delete_embed_site cannot be called for their happy path.
-- That is not a gap to work around: it is the first thing worth asserting, so
-- the refusal is proved rather than assumed. The read paths, which are the ones
-- an anonymous embed actually uses, are then exercised against a row seeded
-- directly.
do $$
declare v_league uuid; v_team uuid; n int; r record; refused boolean;
begin
  -- ---- normalisation: every spelling of a host lands on the same string ----
  if public.norm_host('HTTPS://WWW.Example.co.uk/fixtures?a=1') <> 'example.co.uk' then
    raise exception 'ASSERT norm_host url: got %',
      public.norm_host('HTTPS://WWW.Example.co.uk/fixtures?a=1');
  end if;
  if public.norm_host('Example.co.uk') <> 'example.co.uk' then
    raise exception 'ASSERT norm_host bare';
  end if;
  if public.norm_host('   ') is not null then raise exception 'ASSERT blank host'; end if;

  -- ---- the write path refuses somebody who administers nothing ----
  select id into v_league from leagues limit 1;
  if v_league is null then raise notice '0057: no league to test against'; return; end if;
  select id into v_team from teams where league_id = v_league limit 1;

  begin
    perform public.set_embed_site(v_league, 'zz-probe.example', null, 'strip', 8, 'light', 'probe');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then
    delete from embed_sites where host = 'zz-probe.example';
    raise exception 'ASSERT set_embed_site let a non-administrator write';
  end if;

  -- ---- the read path, against a row seeded directly ----
  insert into embed_sites (league_id, host, team_id, kind, max_items, theme, note)
  values (v_league, 'zz-probe.example', v_team, 'strip', 8, 'light', 'probe');
  -- and a general rule on the same host, to prove the specific one wins
  insert into embed_sites (league_id, host, team_id, kind, max_items, note)
  values (v_league, 'zz-probe.example', null, 'any', 30, 'probe');

  select * into r from public.embed_config('https://WWW.ZZ-Probe.example/x', 'strip');
  if r.league_slug is null then raise exception 'ASSERT embed_config found nothing'; end if;
  if v_team is not null and r.team_slug is null then
    raise exception 'ASSERT embed_config lost the club';
  end if;
  if r.max_items <> 8 then
    raise exception 'ASSERT the specific rule did not win (max_items %)', r.max_items;
  end if;

  -- a kind with no rule of its own falls back to the general one
  select * into r from public.embed_config('zz-probe.example', 'table');
  if r.max_items <> 30 then raise exception 'ASSERT fallback to the any rule'; end if;

  -- an unknown host answers with nothing rather than a default
  select count(*) into n from public.embed_config('nobody.example', 'strip');
  if n <> 0 then raise exception 'ASSERT unknown host returned a row'; end if;

  delete from embed_sites where host = 'zz-probe.example';
  raise notice '0057: refusal proved, and the anonymous read path proved';
end $$;
