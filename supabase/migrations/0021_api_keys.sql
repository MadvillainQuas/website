-- ============================================================================
-- COURTSIDE NETWORK — Phase 4: a read-only JSON API with keys and quotas
--
-- Clubs want the table on their own site; a local paper wants last night's
-- scores; somebody eventually wants to build something we have not thought of.
-- All of that is public data already — the pages serve it to anonymous
-- visitors — so the key is not a secret gate. It is an IDENTITY, so that
-- traffic can be attributed, a runaway script can be stopped without taking
-- the site down with it, and someone can be told their integration broke.
--
-- Two rules the design follows:
--
--   THE KEY IS NEVER STORED. Only its SHA-256 and an eight-character prefix
--   for display. A leaked database gives an attacker nothing they could not
--   already read anonymously, and nobody — including a platform admin — can
--   look up a key after issue. It is shown once, at creation, and that is the
--   only time it exists in readable form.
--
--   THE QUOTA IS COUNTED IN THE DATABASE, not in the function. Two concurrent
--   requests incrementing a counter in application code is the oldest race
--   there is; an upsert with `n = n + 1` and a returning clause is atomic and
--   costs one round trip.
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid references public.leagues on delete cascade,
  name         text not null,
  key_hash     text not null unique,      -- sha256 hex; the key itself is never here
  prefix       text not null,             -- first 8 chars, so a person can tell keys apart
  rate_limit   int  not null default 1000,-- requests per hour
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_keys_league on public.api_keys (league_id);

-- Usage is bucketed by the hour. One row per key per hour is a few hundred
-- rows a year per key, so there is nothing to prune for a long time — and when
-- there is, deleting old buckets is a one-line job with no consistency risk.
create table if not exists public.api_usage (
  key_id     uuid not null references public.api_keys on delete cascade,
  hour_start timestamptz not null,
  n          int not null default 0,
  primary key (key_id, hour_start)
);

alter table public.api_keys  enable row level security;
alter table public.api_usage enable row level security;

-- A league admin may see THEIR OWN league's keys — the metadata, never the key,
-- which is not stored anyway. Everything else is closed; the API function
-- reaches these tables with the service role.
drop policy if exists api_keys_read on public.api_keys;
create policy api_keys_read on public.api_keys for select
  using (league_id is not null and public.is_league_admin(league_id));

-- api_usage has no policy at all: default-deny. Even a league admin reads
-- their usage through the function below rather than the table, so the shape
-- of the counter stays an implementation detail.

-- ---------------------------------------------------------------------------
-- issue_api_key — mints a key and returns it ONCE.
--
-- The plaintext exists only in this function's return value. There is no way
-- to recover it afterwards; a lost key is replaced, not looked up. That is a
-- deliberate inconvenience and the reason a leaked backup is not an incident.
-- ---------------------------------------------------------------------------
create or replace function public.issue_api_key(
  p_league uuid, p_name text, p_rate int default 1000)
returns table (id uuid, api_key text, prefix text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_id  uuid;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'only an administrator of that league may issue keys'
      using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a key needs a name, so it can be told apart from the others';
  end if;
  if p_rate < 1 or p_rate > 100000 then
    raise exception 'rate limit must be between 1 and 100000 requests per hour';
  end if;

  -- 24 bytes of CSPRNG, base64url, prefixed so a leaked key is recognisable
  -- in a log or a repository and can be searched for
  v_key := 'csk_' || replace(replace(encode(extensions.gen_random_bytes(24), 'base64'),
                                     '+', '-'), '/', '_');
  v_key := replace(v_key, '=', '');

  insert into api_keys (league_id, name, key_hash, prefix, rate_limit, created_by)
  values (p_league, trim(p_name),
          encode(extensions.digest(v_key, 'sha256'), 'hex'),
          substr(v_key, 1, 12), p_rate, auth.uid())
  returning api_keys.id, api_keys.prefix into v_id, prefix;

  id := v_id; api_key := v_key;
  return next;
end; $$;

create or replace function public.revoke_api_key(p_key_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid;
begin
  select league_id into v_league from api_keys where id = p_key_id;
  if v_league is null or not public.is_league_admin(v_league) then
    raise exception 'not yours to revoke' using errcode = '42501';
  end if;
  update api_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
end; $$;

-- ---------------------------------------------------------------------------
-- api_key_check — authenticate and meter in one atomic step.
--
-- Called by the Edge Function with the service role. Returns a verdict rather
-- than raising, because "over quota" is an ordinary 429 rather than an error
-- condition, and the caller needs the numbers to put in the response headers.
--
-- The counter increments on EVERY accepted call including the one that tips
-- over the limit, so a client hammering a 429 does not get free requests.
-- ---------------------------------------------------------------------------
create or replace function public.api_key_check(p_key text)
returns table (ok boolean, reason text, key_id uuid, league_id uuid,
               used int, rate_limit int, resets_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  k record;
  v_hour timestamptz := date_trunc('hour', now());
  v_n int;
begin
  ok := false; used := 0; rate_limit := 0;
  key_id := null; league_id := null;
  resets_at := v_hour + interval '1 hour';

  if p_key is null or p_key = '' then
    reason := 'no key'; return next; return;
  end if;

  select * into k from api_keys
   where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');

  if not found then
    -- deliberately the same message as a revoked key: telling an attacker
    -- which of the two it is tells them whether a key ever existed
    reason := 'invalid key'; return next; return;
  end if;
  if k.revoked_at is not null then
    reason := 'invalid key'; return next; return;
  end if;

  key_id := k.id; league_id := k.league_id; rate_limit := k.rate_limit;

  insert into api_usage (key_id, hour_start, n)
  values (k.id, v_hour, 1)
  on conflict (key_id, hour_start) do update set n = api_usage.n + 1
  returning api_usage.n into v_n;

  used := v_n;
  if v_n > k.rate_limit then
    reason := 'rate limit exceeded'; return next; return;
  end if;

  update api_keys set last_used_at = now() where id = k.id;
  ok := true; reason := '';
  return next;
end; $$;

-- what a league admin sees about their own keys, including usage
create or replace function public.api_key_list(p_league uuid)
returns table (id uuid, name text, prefix text, rate_limit int,
               created_at timestamptz, last_used_at timestamptz,
               revoked_at timestamptz, used_this_hour int)
language sql security definer set search_path = public as $$
  select k.id, k.name, k.prefix, k.rate_limit, k.created_at, k.last_used_at,
         k.revoked_at,
         coalesce((select u.n from api_usage u
                    where u.key_id = k.id
                      and u.hour_start = date_trunc('hour', now())), 0)::int
    from api_keys k
   where k.league_id = p_league
     and public.is_league_admin(p_league)
   order by k.created_at desc;
$$;

-- api_key_check is for the service role only: it is the thing that decides
-- whether a key is real, and it must not be callable as an oracle
revoke execute on function public.api_key_check(text) from anon, authenticated, public;

revoke execute on function public.issue_api_key(uuid, text, int) from anon, public;
grant  execute on function public.issue_api_key(uuid, text, int) to authenticated;
revoke execute on function public.revoke_api_key(uuid) from anon, public;
grant  execute on function public.revoke_api_key(uuid) to authenticated;
revoke execute on function public.api_key_list(uuid) from anon, public;
grant  execute on function public.api_key_list(uuid) to authenticated;
