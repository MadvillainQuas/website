-- ============================================================================
-- A key for the demo league, so the API can be exercised end to end.
--
-- ONLY THE HASH IS HERE, which is the whole point of the design: this file is
-- in a public repository and it gives a reader nothing. The key itself was
-- generated outside the database, used to verify the endpoints, and never
-- written down anywhere that is committed.
--
-- It is rate limited to 120 requests an hour — enough to test with, not enough
-- to be worth stealing even if the plaintext escaped — and it can be revoked
-- from the admin console like any other.
--
-- Revoke it whenever you like:
--   update api_keys set revoked_at = now() where prefix = 'csk_tjtCi98Q';
-- ============================================================================
insert into public.api_keys (league_id, name, key_hash, prefix, rate_limit)
select l.id, 'demo key (verification)',
       '8b32d20c4143fc5a1f5a4e4e48e401f83fbe43852e17af98e9d5d83062895a9a',
       'csk_tjtCi98Q', 120
  from public.leagues l
 where l.slug = 'demo-league'
on conflict (key_hash) do nothing;
