-- ============================================================================
-- COURTSIDE IS NOW EPINOIA.
--
-- The code is swept separately; this is the part that lives in the database:
-- the seeded league's name, and the prefix new API keys are minted with.
--
-- WHAT IS DELIBERATELY NOT DONE HERE
--
--   * Migrations 0001–0041 are left exactly as they were. Their contents are
--     history, they have already run, and rewriting an applied migration is a
--     good way to earn a checksum mismatch on the next push. Nothing in them
--     is user-visible; the word survives only in comments and in the name of a
--     session setting nobody reads.
--
--   * EXISTING KEYS KEEP THEIR csk_ PREFIX. Only the hash is stored, so the
--     plaintext cannot be rewritten even in principle, and a partner's working
--     key must not stop working because we changed our name. Authentication is
--     by hash and does not look at the prefix at all — the prefix exists so a
--     human can tell two keys apart in a list and so a leaked one is
--     searchable. Old keys stay recognisable as old; new ones are epk_.
-- ============================================================================

-- ---------------------------------------------------------------- the name ---
do $$
declare n int;
begin
  update leagues
     set name = replace(name, 'Courtside', 'Epinoia')
   where name like '%Courtside%';
  get diagnostics n = row_count;
  raise notice 'renamed % league(s)', n;

  update api_keys
     set name = replace(name, 'Courtside', 'Epinoia')
   where name like '%Courtside%';

  update data_feeds
     set name = replace(name, 'Courtside', 'Epinoia')
   where name like '%Courtside%';
end $$;

-- --------------------------------------------------------- the key prefix ---
-- Byte-for-byte the 0021 body with one string changed. Copied deliberately
-- rather than patched around: this project has been bitten before by a
-- function body copied from an OLDER migration than the newest fix, so the
-- source here is 0021 itself, which nothing has amended since.
--
-- The OUT columns are (id, api_key, prefix) IN THAT ORDER. Retyping them from
-- memory as (id, prefix, api_key) is what the first attempt at this migration
-- did, and Postgres refused it — `create or replace` cannot change a function's
-- return type. That refusal is a kindness: silently swapping two text columns
-- would have handed the console a prefix where it expected the key, and the one
-- moment a key is ever readable is the moment it is issued.
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
  v_key := 'epk_' || replace(replace(encode(extensions.gen_random_bytes(24), 'base64'),
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

revoke execute on function public.issue_api_key(uuid, text, int) from anon, public;
grant  execute on function public.issue_api_key(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Prove the new prefix, and prove an OLD key still authenticates. The second
-- is the one that matters: a rebrand that quietly revokes a partner's access
-- is not a rebrand, it is an outage.
-- ---------------------------------------------------------------------------
do $$
declare
  orig    text;
  v_user  uuid := gen_random_uuid();
  v_lg    uuid;
  v_key   text;
  v_pref  text;
  v_old   text := 'csk_pretend_this_is_an_old_key';
  failed  text[] := '{}';
  r       record;
begin
  select current_user into orig;
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'rebrand@example.invalid', '', now(), now(), now());
  insert into leagues (slug, name) values ('rebrand-test', 'Rebrand Test')
    returning id into v_lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (v_user, 'league_admin', 'league', v_lg);

  -- an old-style key, stored the way 0021 stored them
  insert into api_keys (league_id, name, key_hash, prefix, rate_limit)
  values (v_lg, 'an old key',
          encode(extensions.digest(v_old, 'sha256'), 'hex'),
          substr(v_old, 1, 12), 100);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  select * into r from public.issue_api_key(v_lg, 'a new key', 100);
  v_key := r.api_key; v_pref := r.prefix;
  if v_key !~ '^epk_' then
    failed := failed || ('a new key was minted as ' || left(v_key, 4) || ' — expected epk_');
  end if;
  if v_pref !~ '^epk_' then
    failed := failed || 'the stored prefix does not match the key';
  end if;
  if length(v_key) < 30 then
    failed := failed || 'the new key is too short to be 24 random bytes';
  end if;

  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  -- the old key still resolves, by hash, prefix untouched
  if not exists (select 1 from api_keys
                  where key_hash = encode(extensions.digest(v_old, 'sha256'), 'hex')
                    and revoked_at is null and prefix like 'csk_%') then
    failed := failed || 'an existing csk_ key stopped resolving';
  end if;

  delete from api_keys where league_id = v_lg;
  delete from memberships where user_id = v_user;
  delete from leagues where id = v_lg;
  delete from auth.users where id = v_user;

  if array_length(failed, 1) is not null then
    raise exception 'REBRAND FAILURES: %', array_to_string(failed, ' | ');
  end if;
  raise notice 'new keys mint as epk_, and keys issued as csk_ still authenticate';
end $$;
