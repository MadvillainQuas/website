-- ============================================================================
-- Fix: api_key_check raised 'column reference "key_id" is ambiguous'.
--
-- The function returns a table whose columns include key_id, and plpgsql
-- treats those OUT parameters as variables inside the body. The upsert's
-- conflict target then reads as ambiguous:
--
--     on conflict (key_id, hour_start)     -- the column, or the OUT param?
--
-- Postgres cannot tell, and refuses. This is the same class of trap as the
-- max(boolean) one in 0002: plpgsql accepts the body at creation and only
-- raises when something calls it, so a deployed function that has never been
-- exercised is not a working function.
--
-- Naming the constraint sidesteps the ambiguity without renaming the OUT
-- parameters, which are the API's response shape and should not change to
-- work around a scoping rule.
-- ============================================================================
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
   where api_keys.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');

  -- an unknown key and a revoked key get the same message on purpose: telling
  -- an attacker which it is tells them whether that key ever existed
  if not found or k.revoked_at is not null then
    reason := 'invalid key'; return next; return;
  end if;

  key_id := k.id; league_id := k.league_id; rate_limit := k.rate_limit;

  insert into api_usage as u (key_id, hour_start, n)
  values (k.id, v_hour, 1)
  on conflict on constraint api_usage_pkey do update set n = u.n + 1
  returning u.n into v_n;

  used := v_n;
  -- the counter moves on every accepted call INCLUDING the one that tips over,
  -- so hammering a 429 does not buy free requests
  if v_n > k.rate_limit then
    reason := 'rate limit exceeded'; return next; return;
  end if;

  update api_keys set last_used_at = now() where api_keys.id = k.id;
  ok := true; reason := '';
  return next;
end; $$;

revoke execute on function public.api_key_check(text) from anon, authenticated, public;

-- Prove it runs. The whole point of this migration is that creating a plpgsql
-- function is not evidence it works, so calling it here is the evidence.
do $$
declare r record;
begin
  select * into r from public.api_key_check('csk_definitely_not_real');
  if r.ok or r.reason <> 'invalid key' then
    raise exception 'api_key_check mishandled a bogus key: ok=% reason=%', r.ok, r.reason;
  end if;
  select * into r from public.api_key_check('');
  if r.ok or r.reason <> 'no key' then
    raise exception 'api_key_check mishandled an empty key: ok=% reason=%', r.ok, r.reason;
  end if;
  raise notice 'api_key_check answers correctly for the refusal cases';
end $$;
